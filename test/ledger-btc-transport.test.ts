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
  signBtcPsbt,
  type BtcPsbtSignInput,
  type KnownAddressDerivation,
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

// xpub fixtures derived from BIP-32 test seed (000102030405060708090a0b0c0d0e0f)
// at m/84'/0'/0' (segwit) and m/86'/0'/0' (taproot) — both parseable by bip32@^5.
// Not real-wallet keys; chosen for deterministic test vectors.
const XPUB_FIXTURE_SEGWIT =
  "xpub6C1HVMz946r433QEjZGpYYWYcspxXXBPys5PBGkmQboRXE6RLfFiStEkKbWKCZaPgDrzZh9nUEunxuiuy6MNdw23du2Ek7GoKYMJVH8eK5E";
const XPUB_FIXTURE_TAPROOT =
  "xpub6DRX1xNPHKaApgDnqaMNxJ8Lz35KCn3mRcW3LUep3JKhxWisRwaZJPn4BuZiaJ4kJ3cdqwbn4vZcsGiLGJJabZbqa65LGX2uhU9CtPWSgEn";

interface MockBtcApp {
  getAppConfiguration: ReturnType<typeof vi.fn>;
  getWalletPublicKey: ReturnType<typeof vi.fn>;
  /** CR-02 / CR-03: account-level xpub fetch (added to mock for Phase 23 fix).
   *  Optional on stubs that throw before reaching this APDU. */
  getWalletXpub?: ReturnType<typeof vi.fn>;
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
  // CR-02 / CR-03: `getWalletXpub` returns the account-level xpub for the given path.
  const getWalletXpub = vi.fn(async ({ path }: { path: string; xpubVersion: number }) => {
    if (path === "84'/0'/0'") return XPUB_FIXTURE_SEGWIT;
    if (path === "86'/0'/0'") return XPUB_FIXTURE_TAPROOT;
    throw new Error(`unexpected getWalletXpub path: ${path}`);
  });
  return {
    getAppConfiguration: vi.fn(async () => ({ version })),
    getWalletPublicKey,
    getWalletXpub,
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
    // CR-02 / CR-03: xpubs now returned alongside addresses.
    expect(result.segwit.xpub).toBe(XPUB_FIXTURE_SEGWIT);
    expect(result.taproot.xpub).toBe(XPUB_FIXTURE_TAPROOT);

    // ONE transport open + ONE close for BOTH addresses + xpubs (Pitfall 5).
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
    // TWO getWalletPublicKey calls + TWO getWalletXpub calls within ONE session.
    expect(stubApp.getWalletPublicKey).toHaveBeenCalledTimes(2);
    expect(stubApp.getWalletXpub).toHaveBeenCalledTimes(2);
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
      // CR-02 / CR-03: getWalletXpub is called after both getWalletPublicKey calls.
      getWalletXpub: vi.fn(async ({ path }: { path: string }) =>
        path === "84'/0'/0'" ? XPUB_FIXTURE_SEGWIT : XPUB_FIXTURE_TAPROOT,
      ),
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
      // CR-02 / CR-03: must be present for fetchBtcAddresses to complete.
      getWalletXpub: vi.fn(async ({ path }: { path: string }) =>
        path === "84'/0'/0'" ? XPUB_FIXTURE_SEGWIT : XPUB_FIXTURE_TAPROOT,
      ),
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

// ===========================================================================
// Phase 23 Plan 23-04 — signBtcPsbt two-pass mixed-input signing tests
// ===========================================================================
//
// These tests mock the Ledger BTC app `signPsbtBuffer` call and verify:
//   1. Segwit-only PSBT → exactly ONE signPsbtBuffer call (bech32 path).
//   2. Taproot-only PSBT → exactly ONE signPsbtBuffer call (bech32m path).
//   3. Mixed segwit+taproot PSBT → exactly TWO signPsbtBuffer calls.
//   4. Every signPsbtBuffer call receives a knownAddressDerivations that
//      includes the change address.
//   5. Transport-open failure → LedgerBtcAppNotOpenError; close() is called.
//
// Mock strategy: vi.spyOn(_transport, "buildBtcApp") to inject a mock BTC
// app with a spy on signPsbtBuffer.
//
// Since we need a real PSBT to pass through `signBtcPsbt`, we use a
// minimal valid PSBT constructed via bitcoinjs-lib in a helper.
// The mock signPsbtBuffer returns the SAME psbt buffer (pre-signed stub),
// so combine + finalizeAllInputs + extractTransaction can work on it.
// We use a pre-built raw tx hex stub for the "signed" result.
//
// IMPORTANT: bitcoinjs-lib Psbt.finalizeAllInputs() requires the inputs
// to have partial sigs. For these unit tests, we mock signPsbtBuffer to
// return a PSBT that has the finalScriptWitness already set on inputs
// (simulating a finalized-by-device PSBT), and we call finalizeAllInputs()
// on that. Since we can't easily do that without real signing, we instead
// mock the app to return a PSBT that can be finalized by setting
// finalScriptWitness directly on the buffer.
//
// Simplest approach: mock signPsbtBuffer to return a buffer that when
// parsed has finalScriptWitness set on all inputs in the group.
// We use the bitcoinjs-lib PSBT internals to build a mock that will
// finalizeAllInputs without error.

import { Psbt, Transaction, networks, payments } from "bitcoinjs-lib";

// Build a minimal valid PSBT for test purposes.
// The PSBT has the specified number of segwit/taproot inputs.
// Since we mock signPsbtBuffer to return a buffer with finalScriptWitness set,
// finalizeAllInputs works on it directly.
//
// Helper: build a minimal PSBT buffer for test use (not sent to a real device).
function buildTestPsbt(options: {
  segwitCount: number;
  taprootCount: number;
}): {
  psbtBase64: string;
  inputs: BtcPsbtSignInput[];
  knownAddressDerivations: KnownAddressDerivation[];
} {
  const { segwitCount, taprootCount } = options;

  // Minimal compressed pubkey for tests (not a real secp256k1 key — only used
  // for bip32Derivation metadata in the PSBT, which the mock device ignores).
  // The PSBT will have witnessUtxo set on all inputs.
  const pubkey = Buffer.from("03" + "ab".repeat(32), "hex");
  const xOnlyPubkey = Buffer.from("ab".repeat(32), "hex");
  const masterFp = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

  const psbt = new Psbt({ network: networks.bitcoin });

  const totalInputs = segwitCount + taprootCount;
  const inputs: BtcPsbtSignInput[] = [];

  for (let i = 0; i < totalInputs; i++) {
    const isSegwit = i < segwitCount;
    const txidBuf = Buffer.alloc(32, i + 1);

    if (isSegwit) {
      const p2wpkh = payments.p2wpkh({ pubkey, network: networks.bitcoin });
      psbt.addInput({
        hash: txidBuf,
        index: 0,
        sequence: 0xfffffffe,
        witnessUtxo: {
          script: p2wpkh.output!,
          value: BigInt(100000),
        },
        bip32Derivation: [
          {
            masterFingerprint: masterFp,
            pubkey,
            path: `m/84'/0'/0'/0/${i}`,
          },
        ],
      });
      inputs.push({
        index: i,
        scriptType: "p2wpkh",
        bip32Path: `m/84'/0'/0'/0/${i}`,
        pubkey: new Uint8Array(pubkey),
        masterFingerprint: new Uint8Array(masterFp),
      });
    } else {
      // Taproot — we can't use payments.p2tr without a real secp256k1 point,
      // but we can construct a minimal P2TR output script directly.
      // P2TR output: OP_1 <32-byte x-only-pubkey>
      const p2trScript = Buffer.concat([Buffer.from([0x51, 0x20]), xOnlyPubkey]);
      // tapBip32Derivation.pubkey must be 32-byte x-only key; wrapping in
      // a Buffer so bip174 sees it as the proper type.
      psbt.addInput({
        hash: txidBuf,
        index: 0,
        sequence: 0xfffffffe,
        witnessUtxo: {
          script: p2trScript,
          value: BigInt(100000),
        },
        tapInternalKey: xOnlyPubkey,
        tapBip32Derivation: [
          {
            masterFingerprint: masterFp,
            pubkey: xOnlyPubkey, // 32-byte x-only for tapBip32Derivation
            path: `m/86'/0'/0'/0/${i - segwitCount}`,
            leafHashes: [] as Buffer[],
          },
        ],
      });
      inputs.push({
        index: i,
        scriptType: "p2tr",
        bip32Path: `m/86'/0'/0'/0/${i - segwitCount}`,
        pubkey: new Uint8Array(xOnlyPubkey),
        masterFingerprint: new Uint8Array(masterFp),
      });
    }
  }

  // Add a dummy output.
  const changeScript = Buffer.concat([
    Buffer.from([0x00, 0x14]),
    Buffer.alloc(20, 0xcc),
  ]);
  psbt.addOutput({ script: changeScript, value: BigInt(90000) });

  // Change address scriptPubKey hash for knownAddressDerivations.
  const changeScriptPubKeyHashHex = "cc".repeat(20);

  const knownAddressDerivations: KnownAddressDerivation[] = [
    {
      scriptPubKeyHashHex: changeScriptPubKeyHashHex,
      pubkey: new Uint8Array(pubkey),
      path: "m/84'/0'/0'/1/0",
    },
  ];

  return {
    psbtBase64: psbt.toBase64(),
    inputs,
    knownAddressDerivations,
  };
}

// Build a mock signPsbtBuffer that returns a PSBT buffer with
// finalScriptWitness set on the group's inputs (simulating device signing).
function makeMockSignPsbtBuffer(
  signedTxHex: string = "02000000000101" + "aa".repeat(32) + "00000000" + "fe" + "ff" + "ff" + "ff" + "0090f40100000000001600" + "14" + "75".repeat(20) + "02" + "47" + "30".repeat(71) + "21" + "02".repeat(33) + "00000000",
): ReturnType<typeof vi.fn> {
  return vi.fn(async (psbtBuffer: Buffer) => {
    // Parse the group PSBT and add dummy finalScriptWitness on each input
    // that has bip32Derivation or tapBip32Derivation set.
    const psbt = Psbt.fromBuffer(psbtBuffer);
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      const inp = psbt.data.inputs[i]!;
      const hasDerivation =
        (inp.bip32Derivation && inp.bip32Derivation.length > 0) ||
        (inp.tapBip32Derivation && inp.tapBip32Derivation.length > 0);
      if (hasDerivation) {
        // Set finalScriptWitness to a valid P2WPKH witness stack stub.
        // OP_0 <72-byte sig> <33-byte pubkey> — standard P2WPKH witness.
        const sigStub = Buffer.alloc(72, 0x30);
        const pubkeyStub = Buffer.alloc(33, 0x02);
        // Encode as witness: varint(items) + varint(len)+data per item.
        const witness = Buffer.concat([
          Buffer.from([0x02]), // 2 items
          Buffer.from([0x48]), // 72 bytes
          sigStub,
          Buffer.from([0x21]), // 33 bytes
          pubkeyStub,
        ]);
        inp.finalScriptWitness = witness;
        // Clear derivation (signed inputs lose derivation after signing).
        // Use delete — setting to undefined causes bip174's keyValsFromMap
        // to iterate the key, find a non-undefined converter, then call
        // converter.encode(undefined) which crashes on undefined.pubkey.
        delete inp.bip32Derivation;
        delete inp.tapBip32Derivation;
      }
    }
    return { psbt: psbt.toBuffer() };
  });
}

// Minimal raw tx hex used as the extracted transaction stub.
// A valid 1-input segwit tx: version=2, 1 input, 1 output, locktime=0.
const SIGNED_TX_HEX_STUB =
  "02000000" + // version
  "00" + // segwit marker
  "01" + // segwit flag
  "01" + // 1 input
  "aa".repeat(32) + // txid
  "00000000" + // vout
  "00" + // script sig (empty)
  "feffffff" + // sequence
  "01" + // 1 output
  "905f010000000000" + // value 90000 sats LE
  "16" + // scriptPubKey length
  "0014" + "75".repeat(20) + // P2WPKH
  "02" + "47" + "30".repeat(71) + "21" + "02".repeat(33) + // witness
  "00000000"; // locktime

describe("signBtcPsbt — two-pass mixed-input signing (Phase 23 Plan 23-04)", () => {
  beforeEach(() => {
    _resetLedgerBtcTransportForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("segwit-only PSBT → exactly ONE signPsbtBuffer call with accountPath m/84'/0'/0' and addressFormat bech32", async () => {
    const { psbtBase64, inputs, knownAddressDerivations } = buildTestPsbt({
      segwitCount: 1,
      taprootCount: 0,
    });

    const mockTransport = makeMockTransport();
    const signPsbtBufferSpy = makeMockSignPsbtBuffer();
    const mockApp = {
      getAppConfiguration: vi.fn(async () => ({ version: "2.1.3" })),
      signPsbtBuffer: signPsbtBufferSpy,
    };

    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{}]);
    vi.spyOn(_transport, "open").mockResolvedValue(mockTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(mockApp);

    const result = await signBtcPsbt(psbtBase64, inputs, knownAddressDerivations);

    expect(signPsbtBufferSpy).toHaveBeenCalledTimes(1);
    const callArgs = signPsbtBufferSpy.mock.calls[0];
    expect(callArgs[1]).toMatchObject({
      accountPath: "m/84'/0'/0'",
      addressFormat: "bech32",
      finalizePsbt: false,
    });
    expect(typeof result.rawTxHex).toBe("string");
    expect(result.rawTxHex.length).toBeGreaterThan(0);
  });

  it("taproot-only PSBT → exactly ONE signPsbtBuffer call with accountPath m/86'/0'/0' and addressFormat bech32m", async () => {
    const { psbtBase64, inputs, knownAddressDerivations } = buildTestPsbt({
      segwitCount: 0,
      taprootCount: 1,
    });

    const mockTransport = makeMockTransport();
    const signPsbtBufferSpy = makeMockSignPsbtBuffer();
    const mockApp = {
      getAppConfiguration: vi.fn(async () => ({ version: "2.1.3" })),
      signPsbtBuffer: signPsbtBufferSpy,
    };

    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{}]);
    vi.spyOn(_transport, "open").mockResolvedValue(mockTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(mockApp);

    const result = await signBtcPsbt(psbtBase64, inputs, knownAddressDerivations);

    expect(signPsbtBufferSpy).toHaveBeenCalledTimes(1);
    const callArgs = signPsbtBufferSpy.mock.calls[0];
    expect(callArgs[1]).toMatchObject({
      accountPath: "m/86'/0'/0'",
      addressFormat: "bech32m",
      finalizePsbt: false,
    });
    expect(typeof result.rawTxHex).toBe("string");
  });

  it("mixed segwit+taproot PSBT → exactly TWO signPsbtBuffer calls (one per script-type group)", async () => {
    const { psbtBase64, inputs, knownAddressDerivations } = buildTestPsbt({
      segwitCount: 1,
      taprootCount: 1,
    });

    const mockTransport = makeMockTransport();
    const signPsbtBufferSpy = makeMockSignPsbtBuffer();
    const mockApp = {
      getAppConfiguration: vi.fn(async () => ({ version: "2.1.3" })),
      signPsbtBuffer: signPsbtBufferSpy,
    };

    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{}]);
    vi.spyOn(_transport, "open").mockResolvedValue(mockTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(mockApp);

    const result = await signBtcPsbt(psbtBase64, inputs, knownAddressDerivations);

    // SC#5 / BTC-PSBT-02: exactly TWO signPsbtBuffer calls for mixed inputs.
    expect(signPsbtBufferSpy).toHaveBeenCalledTimes(2);

    const call0Args = signPsbtBufferSpy.mock.calls[0];
    const call1Args = signPsbtBufferSpy.mock.calls[1];

    // First call: segwit group.
    expect(call0Args[1]).toMatchObject({
      accountPath: "m/84'/0'/0'",
      addressFormat: "bech32",
      finalizePsbt: false,
    });
    // Second call: taproot group.
    expect(call1Args[1]).toMatchObject({
      accountPath: "m/86'/0'/0'",
      addressFormat: "bech32m",
      finalizePsbt: false,
    });

    expect(typeof result.rawTxHex).toBe("string");
  });

  it("every signPsbtBuffer call receives a non-empty knownAddressDerivations that includes the change address", async () => {
    const { psbtBase64, inputs, knownAddressDerivations } = buildTestPsbt({
      segwitCount: 1,
      taprootCount: 1,
    });

    const mockTransport = makeMockTransport();
    const signPsbtBufferSpy = makeMockSignPsbtBuffer();
    const mockApp = {
      getAppConfiguration: vi.fn(async () => ({ version: "2.1.3" })),
      signPsbtBuffer: signPsbtBufferSpy,
    };

    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{}]);
    vi.spyOn(_transport, "open").mockResolvedValue(mockTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(mockApp);

    await signBtcPsbt(psbtBase64, inputs, knownAddressDerivations);

    // Both calls must have a non-empty knownAddressDerivations Map containing
    // the change address (Pitfall 6 — T-23-17 mitigation).
    for (const call of signPsbtBufferSpy.mock.calls) {
      const kad = call[1].knownAddressDerivations as Map<string, unknown>;
      expect(kad).toBeInstanceOf(Map);
      expect(kad.size).toBeGreaterThan(0);
      // The change address scriptPubKey hash must be present.
      expect(kad.has(knownAddressDerivations[0]!.scriptPubKeyHashHex)).toBe(true);
    }
  });

  it("transport-open failure → throws LedgerDeviceNotConnectedError; transport.close() called in finally", async () => {
    const mockTransport = makeMockTransport();
    const signPsbtBufferSpy = vi.fn();
    const mockAppFails = {
      // getAppConfiguration throws → LedgerBtcAppNotOpenError
      getAppConfiguration: vi.fn(async () => {
        throw new Error("transport error");
      }),
      signPsbtBuffer: signPsbtBufferSpy,
    };

    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{}]);
    vi.spyOn(_transport, "open").mockResolvedValue(mockTransport);
    vi.spyOn(_transport, "buildBtcApp").mockReturnValue(mockAppFails);

    const { psbtBase64, inputs, knownAddressDerivations } = buildTestPsbt({
      segwitCount: 1,
      taprootCount: 0,
    });

    await expect(
      signBtcPsbt(psbtBase64, inputs, knownAddressDerivations),
    ).rejects.toBeInstanceOf(LedgerBtcAppNotOpenError);

    // Transport MUST be closed in the finally block even on the error path.
    expect(mockTransport.close).toHaveBeenCalledTimes(1);
    expect(signPsbtBufferSpy).not.toHaveBeenCalled();
  });

  it("_btcLedgerTransport.signBtcPsbt is exposed for vi.spyOn (ESM spy-affordance)", () => {
    expect(typeof _btcLedgerTransport.signBtcPsbt).toBe("function");
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

  it("verify: true appears exactly 4 times in non-comment code (2 BTC segwit+taproot + 2 LTC legacy+segwit getWalletPublicKey calls)", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const sourcePath = resolve(__dirname, "..", "src", "wallet", "ledger-btc-transport.ts");
    const source = readFileSync(sourcePath, "utf8");
    // Strip single-line comments so a doc-string mention of `verify: true`
    // doesn't inflate the count. The four non-comment matches are the
    // explicit { format, verify } argument objects on getWalletPublicKey:
    // 2 for BTC (fetchBtcAddresses: segwit + taproot) +
    // 2 for LTC (fetchLtcAddresses: legacy + segwit) — Phase 26.
    const stripped = source
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    const matches = stripped.match(/verify:\s*true/g) ?? [];
    expect(matches.length).toBe(4);
  });
});
