import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPROVAL_TIMEOUT_MS,
  DEFAULT_TRON_DERIVATION_PATH,
  LedgerDeviceNotConnectedError,
  LedgerTronAppNotOpenError,
  _resetLedgerTronTransportForTesting,
  _transport,
  fetchTronAddress,
  openTransport,
} from "../src/wallet/ledger-tron-transport.js";

// LOAD-BEARING REGRESSION ANCHOR (research § Topic 2, Pitfall 2):
// the Ledger TRON app's `getAddress` returns `{ address: string }`
// where `address` is ALREADY base58check T-prefixed — NO `bs58.encode`
// step needed in our transport. Compare to `ledger-solana-transport.ts`
// which receives `{ address: Buffer }` of raw ed25519 bytes and MUST
// apply `bs58.encode(buf)` to produce a base58 string. Copy-pasting
// the Solana shape into the TRON transport would double-process the
// already-encoded string and produce a garbled non-TRON value.
//
// This fixture pins a real-looking base58check TRON address. The test
// asserts the return value EQUALS this string verbatim — string-equal
// at byte level. A `bs58.encode(string)` step would mutate it and
// break the assertion. The hardcoded literal also guards against a
// regression that "fixes" the type by passing through `.toString()`.
const TRON_ADDRESS_FIXTURE_A = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const TRON_PUBLIC_KEY_FIXTURE_A =
  "04abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

// Second fixture (different TRON address shape) so a regression that
// happens to produce a fixed-but-wrong output (always returns the
// empty string, or always returns fixture A) is caught.
const TRON_ADDRESS_FIXTURE_B = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

interface MockTransport {
  close: ReturnType<typeof vi.fn>;
  disconnected: boolean;
}

interface MockTrxApp {
  getAppConfiguration: ReturnType<typeof vi.fn>;
  getAddress: ReturnType<typeof vi.fn>;
}

function makeMockTransport(): MockTransport {
  return {
    close: vi.fn(async () => undefined),
    disconnected: false,
  };
}

function makeMockApp(
  address: string,
  publicKey: string = TRON_PUBLIC_KEY_FIXTURE_A,
  version = "0.5.0",
): MockTrxApp {
  return {
    getAppConfiguration: vi.fn(async () => ({ version })),
    getAddress: vi.fn(async () => ({ address, publicKey })),
  };
}

beforeEach(() => {
  _resetLedgerTronTransportForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetLedgerTronTransportForTesting();
});

describe("constants", () => {
  it("DEFAULT_TRON_DERIVATION_PATH is the 5-level BIP-44 default `44'/195'/0'/0/0`", () => {
    // Load-bearing assertion: 5-level (NOT 3-level Solana shape).
    // The canonical TronLink/Klever/Math wallet path and the doc
    // example shape in `@ledgerhq/hw-app-trx/Trx.d.ts`. Research §
    // Topic 3.
    expect(DEFAULT_TRON_DERIVATION_PATH).toBe("44'/195'/0'/0/0");
    // Defensive shape check: exactly 5 segments, first 3 hardened,
    // last 2 unhardened (the BIP-44 `change` + `address_index` legs).
    const segments = DEFAULT_TRON_DERIVATION_PATH.split("/");
    expect(segments).toHaveLength(5);
    expect(segments[0]).toBe("44'");
    expect(segments[1]).toBe("195'");
    expect(segments[2]).toBe("0'");
    expect(segments[3]).toBe("0");
    expect(segments[4]).toBe("0");
  });

  it("APPROVAL_TIMEOUT_MS is 60s (parity with ledger-solana-transport.ts; consumed by pair_tron_ledger in Plan 17-03)", () => {
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
      /Connect your Ledger via USB, unlock it, and open the TRON app/,
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

describe("fetchTronAddress", () => {
  it("LOAD-BEARING REGRESSION ANCHOR — returns the device's `address` field VERBATIM (no bs58.encode step; research Pitfall 2)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp(TRON_ADDRESS_FIXTURE_A, TRON_PUBLIC_KEY_FIXTURE_A, "0.5.0");
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildTrxApp").mockReturnValue(stubApp);

    const result = await fetchTronAddress();

    // CRITICAL: byte-identical string equality. A `bs58.encode(string)`
    // step (copy-pasted from the Solana transport) would mutate this
    // value and break the assertion. The Ledger TRON app does the
    // SHA-256-double + base58 encode on-device; we receive the final
    // base58check string. This is the load-bearing regression test
    // named in 17-PATTERNS.md § Plan 17-02.
    expect(result.address).toBe(TRON_ADDRESS_FIXTURE_A);
    expect(result.publicKey).toBe(TRON_PUBLIC_KEY_FIXTURE_A);
    expect(result.appVersion).toBe("0.5.0");
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
  });

  it("calls app.getAddress with the 5-level BIP-44 default path when no argument is passed", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp(TRON_ADDRESS_FIXTURE_A);
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildTrxApp").mockReturnValue(stubApp);

    await fetchTronAddress();

    expect(stubApp.getAddress).toHaveBeenCalledTimes(1);
    expect(stubApp.getAddress).toHaveBeenCalledWith("44'/195'/0'/0/0");
  });

  it("passes a custom derivation path through verbatim to app.getAddress (slot 3)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp(TRON_ADDRESS_FIXTURE_B);
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildTrxApp").mockReturnValue(stubApp);

    const result = await fetchTronAddress("44'/195'/3'/0/0");

    expect(stubApp.getAddress).toHaveBeenCalledTimes(1);
    expect(stubApp.getAddress).toHaveBeenCalledWith("44'/195'/3'/0/0");
    // Second-fixture byte-identity: catches a regression that always
    // returns fixture A regardless of input.
    expect(result.address).toBe(TRON_ADDRESS_FIXTURE_B);
  });

  it("falls back to appVersion=\"unknown\" when getAppConfiguration returns no version field", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = {
      getAppConfiguration: vi.fn(async () => ({})),
      getAddress: vi.fn(async () => ({
        address: TRON_ADDRESS_FIXTURE_A,
        publicKey: TRON_PUBLIC_KEY_FIXTURE_A,
      })),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildTrxApp").mockReturnValue(stubApp);

    const result = await fetchTronAddress();
    expect(result.appVersion).toBe("unknown");
  });

  it("throws LedgerTronAppNotOpenError when getAppConfiguration rejects (NOT the underlying error)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = {
      getAppConfiguration: vi.fn(async () => {
        throw new Error("0x6e00"); // INS_NOT_SUPPORTED — "wrong app" APDU
      }),
      getAddress: vi.fn(),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildTrxApp").mockReturnValue(stubApp);

    await expect(fetchTronAddress()).rejects.toBeInstanceOf(LedgerTronAppNotOpenError);
    // finally-block invariant: transport.close() STILL called on error path.
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
    // getAddress is NOT reached when the app isn't TRON.
    expect(stubApp.getAddress).not.toHaveBeenCalled();
  });

  it("propagates app.getAddress errors AND still closes the transport (finally-block invariant)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = {
      getAppConfiguration: vi.fn(async () => ({ version: "0.5.0" })),
      getAddress: vi.fn(async () => {
        throw new Error("user rejected");
      }),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildTrxApp").mockReturnValue(stubApp);

    await expect(fetchTronAddress()).rejects.toThrow(/user rejected/);
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
  });

  it("swallows transport.close() errors so the original APDU error reaches the caller", async () => {
    // Without the swallow, a `close()` rejection in the finally block
    // would mask the upstream APDU error (last throw wins). The
    // logger.ts stderr write absorbs the diagnostic instead.
    const stubTransport: MockTransport = {
      close: vi.fn(async () => {
        throw new Error("device gone");
      }),
      disconnected: false,
    };
    const stubApp = {
      getAppConfiguration: vi.fn(async () => ({ version: "0.5.0" })),
      getAddress: vi.fn(async () => {
        throw new Error("user rejected");
      }),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildTrxApp").mockReturnValue(stubApp);
    // Silence the warn-log so the test output stays clean.
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(fetchTronAddress()).rejects.toThrow(/user rejected/);
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
  });

  it("transport.close() failure on the happy path is logged, not thrown (Promise still resolves)", async () => {
    const stubTransport: MockTransport = {
      close: vi.fn(async () => {
        throw new Error("usb-detached");
      }),
      disconnected: false,
    };
    const stubApp = makeMockApp(TRON_ADDRESS_FIXTURE_A);
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildTrxApp").mockReturnValue(stubApp);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await fetchTronAddress();

    // Promise resolves with the address payload (close failure does not bubble).
    expect(result.address).toBe(TRON_ADDRESS_FIXTURE_A);
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
    // log("warn", ...) writes to stderr; assert the message body.
    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(stderrCalls.some((s) => s.includes("transport.close() failed during cleanup"))).toBe(
      true,
    );
  });
});

describe("_transport spy-affordance regression", () => {
  it("vi.spyOn(_transport, 'open') intercepts internal calls (ESM binding-immutability regression)", async () => {
    // Per CLAUDE.md: spying on the bare `TransportNodeHid.open` import
    // silently no-ops because ESM named-export bindings are immutable.
    // The `_transport` indirection is the only seam that catches the
    // call. This test fails if someone removes the indirection and
    // calls `TransportNodeHid.open(...)` directly from `openTransport`.
    const stubTransport = makeMockTransport();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    const spy = vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);

    const result = await openTransport();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBe(stubTransport);
  });

  it("the (Module as any).default ?? Module shim resolves both Ledger packages to runtime functions", () => {
    // If the shim regresses, the module-level `new TrxApp(...)` /
    // `TransportNodeHid.open(...)` calls throw at first invocation
    // with "X is not a constructor" / "Cannot read property 'open'".
    // This test exercises the runtime constructors via the indirection
    // without needing a real device — proving the import shape is
    // compatible with the NodeNext default-export drift research note.
    expect(typeof _transport.isSupported).toBe("function");
    expect(typeof _transport.list).toBe("function");
    expect(typeof _transport.open).toBe("function");
    expect(typeof _transport.buildTrxApp).toBe("function");
  });
});

describe("no-bs58-import source-level regression", () => {
  it("ledger-tron-transport.ts MUST NOT import `bs58` (research Pitfall 2 defense-in-depth)", () => {
    // The Ledger TRON app returns the `address` field as a base58check
    // string ALREADY ENCODED on-device. A `bs58` import in this file
    // is a regression smell — typically copy-pasted from
    // `ledger-solana-transport.ts` without reading the .d.ts. This
    // assertion is defense-in-depth: even if every unit test passes
    // with a bogus `bs58.encode(string)` (because base58 of a base58
    // string is also a string), this catches the import statement at
    // the source level.
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const sourcePath = resolve(__dirname, "..", "src", "wallet", "ledger-tron-transport.ts");
    const source = readFileSync(sourcePath, "utf8");
    // Match either single- or double-quoted import shapes.
    expect(source).not.toMatch(/from\s+["']bs58["']/);
    expect(source).not.toMatch(/require\(["']bs58["']\)/);
  });
});
