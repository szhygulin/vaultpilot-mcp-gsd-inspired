// Phase 22 Plan 22-02 — `src/wallet/ledger-btc-transport.ts` tests.
//
// Mirror of `test/ledger-tron-transport.test.ts` with ONE divergence:
// TWO sequential `getWalletPublicKey` calls in ONE try/finally close
// (segwit BIP-84 + taproot BIP-86). The dual-fetch shape is the NEW
// shape this phase introduces; pair Solana / TRON each ship ONE address
// per device session.
//
// LOAD-BEARING REGRESSION ANCHORS:
//   - bech32 + bech32m prefix invariants (Pitfall 7 — Ledger BTC app
//     returns the address ALREADY ENCODED in the requested format; NO
//     client-side bech32 step).
//   - APDU table overlap with Litecoin (Pitfall 2 — `getAppConfiguration`
//     runs FIRST; map throw to `LedgerBtcAppNotOpenError`).
//   - try/finally close on BOTH `getWalletPublicKey` error paths
//     (Pitfall 5 — single transport open wraps both calls).
//   - 5-level BIP-44 paths (Meta-Decision 2 — copy-paste defense from
//     Solana 3-level; defense lives in the source-level grep gate +
//     header-comment assertion below).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPROVAL_TIMEOUT_MS,
  DEFAULT_BTC_SEGWIT_PATH,
  DEFAULT_BTC_TAPROOT_PATH,
  LedgerBtcAppNotOpenError,
  LedgerDeviceNotConnectedError,
  _btcLedgerTransport,
  _resetLedgerBtcTransportForTesting,
  _transport,
  fetchBtcAddresses,
  openTransport,
} from "../src/wallet/ledger-btc-transport.js";

// Address fixtures pinned to recognizable bc1q / bc1p shapes. NOT real
// on-chain keys — chosen for prefix-shape regression coverage.
// bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq is a well-known sample
// segwit P2WPKH address (Esplora docs example); we substitute custom
// 5x-prefix bc1q fixtures for tests so the assertion shape is obvious.
const SEGWIT_FIXTURE = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const TAPROOT_FIXTURE =
  "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";
const PUBKEY_FIXTURE_A =
  "03abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const PUBKEY_FIXTURE_B =
  "03fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const CHAINCODE_FIXTURE =
  "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";

interface MockTransport {
  close: ReturnType<typeof vi.fn>;
  disconnected: boolean;
}

interface MockBtcApp {
  getAppConfiguration: ReturnType<typeof vi.fn>;
  getWalletPublicKey: ReturnType<typeof vi.fn>;
}

function makeMockTransport(): MockTransport {
  return {
    close: vi.fn(async () => undefined),
    disconnected: false,
  };
}

function makeMockApp(
  segwitAddr: string = SEGWIT_FIXTURE,
  taprootAddr: string = TAPROOT_FIXTURE,
  version = "2.1.3",
): MockBtcApp {
  const getWalletPublicKey = vi.fn(async (_path: string, opts?: { format?: string; verify?: boolean }) => {
    if (opts?.format === "bech32") {
      return { publicKey: PUBKEY_FIXTURE_A, bitcoinAddress: segwitAddr, chainCode: CHAINCODE_FIXTURE };
    }
    if (opts?.format === "bech32m") {
      return { publicKey: PUBKEY_FIXTURE_B, bitcoinAddress: taprootAddr, chainCode: CHAINCODE_FIXTURE };
    }
    throw new Error(`unexpected format: ${String(opts?.format)}`);
  });
  return {
    getAppConfiguration: vi.fn(async () => ({ version })),
    getWalletPublicKey,
  };
}

beforeEach(() => {
  _resetLedgerBtcTransportForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetLedgerBtcTransportForTesting();
});

describe("constants — 5-level BIP-44 path regression anchor (Meta-Decision 2)", () => {
  it("DEFAULT_BTC_SEGWIT_PATH is the 5-level BIP-84 default `84'/0'/0'/0/0` (NOT Solana 3-level shape)", () => {
    // Load-bearing assertion: 5-level (purpose/coin_type/account/change/address_index).
    // Distinct from Solana's 3-level "44'/501'/0'" — copy-paste regression
    // defense per RESEARCH § Plan 22-02 #1.
    expect(DEFAULT_BTC_SEGWIT_PATH).toBe("84'/0'/0'/0/0");
    const segments = DEFAULT_BTC_SEGWIT_PATH.split("/");
    expect(segments).toHaveLength(5);
    expect(segments[0]).toBe("84'");
    expect(segments[1]).toBe("0'");
    expect(segments[2]).toBe("0'");
    expect(segments[3]).toBe("0");
    expect(segments[4]).toBe("0");
  });

  it("DEFAULT_BTC_TAPROOT_PATH is the 5-level BIP-86 default `86'/0'/0'/0/0`", () => {
    expect(DEFAULT_BTC_TAPROOT_PATH).toBe("86'/0'/0'/0/0");
    const segments = DEFAULT_BTC_TAPROOT_PATH.split("/");
    expect(segments).toHaveLength(5);
    expect(segments[0]).toBe("86'");
    expect(segments[1]).toBe("0'");
    expect(segments[2]).toBe("0'");
    expect(segments[3]).toBe("0");
    expect(segments[4]).toBe("0");
  });

  it("APPROVAL_TIMEOUT_MS is 60s (parity with TRON + Solana)", () => {
    expect(APPROVAL_TIMEOUT_MS).toBe(60_000);
  });
});

describe("openTransport", () => {
  it("returns the opened transport on the happy path", async () => {
    const stubTransport = makeMockTransport();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    const openSpy = vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);

    const transport = await openTransport();

    expect(transport).toBe(stubTransport);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(null);
  });

  it("throws LedgerDeviceNotConnectedError when the platform lacks node-hid support", async () => {
    vi.spyOn(_transport, "isSupported").mockResolvedValue(false);

    await expect(openTransport()).rejects.toBeInstanceOf(LedgerDeviceNotConnectedError);
    await expect(openTransport()).rejects.toThrow(
      /Connect your Ledger via USB, unlock it, and open the Bitcoin app/,
    );
  });

  it("throws LedgerDeviceNotConnectedError when the device list is empty", async () => {
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([]);

    await expect(openTransport()).rejects.toBeInstanceOf(LedgerDeviceNotConnectedError);
  });

  it("does NOT invoke open() when the device list is empty (pre-state check)", async () => {
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([]);
    const openSpy = vi.spyOn(_transport, "open");

    await expect(openTransport()).rejects.toBeInstanceOf(LedgerDeviceNotConnectedError);
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe("fetchBtcAddresses — dual-address fetch in ONE try/finally close", () => {
  it("LOAD-BEARING — returns BOTH segwit AND taproot addresses in ONE device session", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp(SEGWIT_FIXTURE, TAPROOT_FIXTURE, "2.1.3");
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);

    const result = await fetchBtcAddresses();

    // CRITICAL: addresses returned VERBATIM from Ledger BTC app — no
    // client-side bech32 step (Pitfall 7).
    expect(result.segwit.address).toBe(SEGWIT_FIXTURE);
    expect(result.taproot.address).toBe(TAPROOT_FIXTURE);
    expect(result.segwit.publicKey).toBe(PUBKEY_FIXTURE_A);
    expect(result.taproot.publicKey).toBe(PUBKEY_FIXTURE_B);
    expect(result.segwit.chainCode).toBe(CHAINCODE_FIXTURE);
    expect(result.taproot.chainCode).toBe(CHAINCODE_FIXTURE);
    expect(result.segwit.derivationPath).toBe("84'/0'/0'/0/0");
    expect(result.taproot.derivationPath).toBe("86'/0'/0'/0/0");
    expect(result.appVersion).toBe("2.1.3");

    // ONE transport open + ONE close for BOTH addresses (Pitfall 5).
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
    // TWO getWalletPublicKey calls within ONE session.
    expect(stubApp.getWalletPublicKey).toHaveBeenCalledTimes(2);
  });

  it("address-prefix regression anchor — segwit starts with `bc1q`, taproot with `bc1p` (Pitfall 7)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp(SEGWIT_FIXTURE, TAPROOT_FIXTURE, "2.1.3");
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);

    const result = await fetchBtcAddresses();

    expect(result.segwit.address.startsWith("bc1q")).toBe(true);
    expect(result.taproot.address.startsWith("bc1p")).toBe(true);
  });

  it("calls getWalletPublicKey with `format: \"bech32\"` for segwit + `verify: true`", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);

    await fetchBtcAddresses();

    // Find the bech32 call.
    const segwitCall = stubApp.getWalletPublicKey.mock.calls.find(
      (c) => (c[1] as { format?: string } | undefined)?.format === "bech32",
    );
    expect(segwitCall).toBeDefined();
    expect(segwitCall![0]).toBe("84'/0'/0'/0/0");
    expect(segwitCall![1]).toMatchObject({ format: "bech32", verify: true });
  });

  it("calls getWalletPublicKey with `format: \"bech32m\"` for taproot + `verify: true`", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);

    await fetchBtcAddresses();

    const taprootCall = stubApp.getWalletPublicKey.mock.calls.find(
      (c) => (c[1] as { format?: string } | undefined)?.format === "bech32m",
    );
    expect(taprootCall).toBeDefined();
    expect(taprootCall![0]).toBe("86'/0'/0'/0/0");
    expect(taprootCall![1]).toMatchObject({ format: "bech32m", verify: true });
  });

  it("custom paths pass through verbatim to getWalletPublicKey", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);

    await fetchBtcAddresses("84'/0'/3'/0/0", "86'/0'/3'/0/0");

    const calls = stubApp.getWalletPublicKey.mock.calls;
    expect(calls.find((c) => c[0] === "84'/0'/3'/0/0")).toBeDefined();
    expect(calls.find((c) => c[0] === "86'/0'/3'/0/0")).toBeDefined();
  });

  it("calls getAppConfiguration BEFORE either getWalletPublicKey (Pitfall 2 ordering)", async () => {
    const stubTransport = makeMockTransport();
    const callOrder: string[] = [];
    const stubApp: MockBtcApp = {
      getAppConfiguration: vi.fn(async () => {
        callOrder.push("getAppConfiguration");
        return { version: "2.1.3" };
      }),
      getWalletPublicKey: vi.fn(async (_path: string, opts?: { format?: string }) => {
        callOrder.push(`getWalletPublicKey:${opts?.format}`);
        return { publicKey: PUBKEY_FIXTURE_A, bitcoinAddress: opts?.format === "bech32" ? SEGWIT_FIXTURE : TAPROOT_FIXTURE, chainCode: CHAINCODE_FIXTURE };
      }),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);

    await fetchBtcAddresses();

    expect(callOrder[0]).toBe("getAppConfiguration");
    expect(callOrder).toContain("getWalletPublicKey:bech32");
    expect(callOrder).toContain("getWalletPublicKey:bech32m");
  });

  it("falls back to appVersion=\"unknown\" when getAppConfiguration returns no version field", async () => {
    const stubTransport = makeMockTransport();
    const stubApp: MockBtcApp = {
      getAppConfiguration: vi.fn(async () => ({})),
      getWalletPublicKey: vi.fn(async (_p, opts?: { format?: string }) => ({
        publicKey: PUBKEY_FIXTURE_A,
        bitcoinAddress: opts?.format === "bech32" ? SEGWIT_FIXTURE : TAPROOT_FIXTURE,
        chainCode: CHAINCODE_FIXTURE,
      })),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);

    const result = await fetchBtcAddresses();
    expect(result.appVersion).toBe("unknown");
  });

  it("throws LedgerBtcAppNotOpenError when getAppConfiguration rejects (Pitfall 2 — BTC/LTC APDU overlap)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp: MockBtcApp = {
      getAppConfiguration: vi.fn(async () => {
        throw new Error("0x6e00"); // INS_NOT_SUPPORTED — "wrong app" APDU
      }),
      getWalletPublicKey: vi.fn(),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);

    await expect(fetchBtcAddresses()).rejects.toBeInstanceOf(LedgerBtcAppNotOpenError);
    // finally-block invariant: transport.close() STILL called on error path.
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
    // Neither getWalletPublicKey is reached when the app isn't BTC.
    expect(stubApp.getWalletPublicKey).not.toHaveBeenCalled();
  });

  it("propagates getWalletPublicKey errors AND still closes the transport (Pitfall 5 — single try/finally wraps BOTH calls)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp: MockBtcApp = {
      getAppConfiguration: vi.fn(async () => ({ version: "2.1.3" })),
      getWalletPublicKey: vi.fn(async () => {
        throw new Error("user rejected");
      }),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);

    await expect(fetchBtcAddresses()).rejects.toThrow(/user rejected/);
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
  });

  it("Pitfall 5 — taproot getWalletPublicKey failure (AFTER segwit succeeds) STILL closes the transport", async () => {
    const stubTransport = makeMockTransport();
    let callCount = 0;
    const stubApp: MockBtcApp = {
      getAppConfiguration: vi.fn(async () => ({ version: "2.1.3" })),
      getWalletPublicKey: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          return { publicKey: PUBKEY_FIXTURE_A, bitcoinAddress: SEGWIT_FIXTURE, chainCode: CHAINCODE_FIXTURE };
        }
        // Second call (taproot) fails — single try/finally MUST still close.
        throw new Error("user rejected taproot");
      }),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);

    await expect(fetchBtcAddresses()).rejects.toThrow(/user rejected taproot/);
    // Single transport.close call wraps BOTH getWalletPublicKey error paths.
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
  });

  it("swallows transport.close() errors so the original APDU error reaches the caller", async () => {
    const stubTransport: MockTransport = {
      close: vi.fn(async () => {
        throw new Error("device gone");
      }),
      disconnected: false,
    };
    const stubApp: MockBtcApp = {
      getAppConfiguration: vi.fn(async () => ({ version: "2.1.3" })),
      getWalletPublicKey: vi.fn(async () => {
        throw new Error("user rejected");
      }),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(fetchBtcAddresses()).rejects.toThrow(/user rejected/);
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
  });

  it("transport.close() failure on the happy path is logged, not thrown (Promise still resolves)", async () => {
    const stubTransport: MockTransport = {
      close: vi.fn(async () => {
        throw new Error("usb-detached");
      }),
      disconnected: false,
    };
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await fetchBtcAddresses();

    expect(result.segwit.address).toBe(SEGWIT_FIXTURE);
    expect(result.taproot.address).toBe(TAPROOT_FIXTURE);
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(stderrCalls.some((s) => s.includes("transport.close() failed during cleanup"))).toBe(
      true,
    );
  });
});

describe("_transport spy-affordance regression (RESEARCH A6 — named-arg ctor)", () => {
  it("vi.spyOn(_transport, 'open') intercepts internal calls (ESM binding-immutability regression)", async () => {
    const stubTransport = makeMockTransport();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    const spy = vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);

    const result = await openTransport();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBe(stubTransport);
  });

  it("the (Module as any).default ?? Module shim resolves both Ledger packages to runtime functions", () => {
    expect(typeof _transport.isSupported).toBe("function");
    expect(typeof _transport.list).toBe("function");
    expect(typeof _transport.open).toBe("function");
    expect(typeof _transport.buildBtcApp).toBe("function");
  });

  it("_transport.buildBtcApp constructs BtcApp with named-arg `{ transport, currency: \"bitcoin\" }` (RESEARCH A6)", () => {
    // Source-level grep: confirms the construction is named-arg (Phase 26
    // LTC sharing decision deferred — single point of change here).
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const sourcePath = resolve(__dirname, "..", "src", "wallet", "ledger-btc-transport.ts");
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toMatch(/currency:\s*["']bitcoin["']/);
  });
});

describe("_btcLedgerTransport spy seam (Plan 22-04 status surface)", () => {
  it("_btcLedgerTransport.fetchBtcAddresses wraps fetchBtcAddresses (mirror of _tronLedgerTransport pattern)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(stubApp);

    const result = await _btcLedgerTransport.fetchBtcAddresses();

    expect(result.segwit.address).toBe(SEGWIT_FIXTURE);
    expect(result.taproot.address).toBe(TAPROOT_FIXTURE);
  });
});

describe("source-level regression anchors", () => {
  it("ledger-btc-transport.ts MUST NOT import `bs58` (Pitfall 7 — Ledger BTC app returns address already encoded)", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const sourcePath = resolve(__dirname, "..", "src", "wallet", "ledger-btc-transport.ts");
    const source = readFileSync(sourcePath, "utf8");
    // Match either single- or double-quoted import shapes.
    expect(source).not.toMatch(/from\s+["']bs58["']/);
    expect(source).not.toMatch(/require\(["']bs58["']\)/);
  });

  it("5-level BIP-44 shape named in header comment (Meta-Decision 2 regression anchor)", () => {
    // Source-level grep: the file MUST contain the literal "5-level"
    // string in a comment, naming the BIP-44 shape so a future
    // contributor can't silently mutate to Solana 3-level.
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const sourcePath = resolve(__dirname, "..", "src", "wallet", "ledger-btc-transport.ts");
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toMatch(/5-level/);
  });

  it("verify: true appears exactly twice in non-comment code (one per getWalletPublicKey call — segwit + taproot)", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const sourcePath = resolve(__dirname, "..", "src", "wallet", "ledger-btc-transport.ts");
    const source = readFileSync(sourcePath, "utf8");
    // Strip single-line comments so a doc-string mention of `verify: true`
    // doesn't inflate the count. The two non-comment matches are the
    // explicit { format, verify } argument objects on getWalletPublicKey.
    const stripped = source
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    const matches = stripped.match(/verify:\s*true/g) ?? [];
    expect(matches.length).toBe(2);
  });
});
