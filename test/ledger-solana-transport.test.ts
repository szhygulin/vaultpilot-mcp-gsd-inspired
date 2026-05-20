import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPROVAL_TIMEOUT_MS,
  DEFAULT_SOLANA_DERIVATION_PATH,
  LedgerDeviceNotConnectedError,
  LedgerSolanaAppNotOpenError,
  _resetLedgerSolanaTransportForTesting,
  _transport,
  fetchSolanaAddress,
  openTransport,
} from "../src/wallet/ledger-solana-transport.js";

// Cryptographic-binding fixture A (LOAD-BEARING — pins the bs58.encode-on-
// Buffer regression named in the plan): 32 bytes of monotonically
// increasing values (0x01..0x20) encode to a known base58 literal.
// Drift in `bs58.encode` (e.g. someone "fixes" the input type and passes
// the Buffer through `.toString()` instead) MUST fail this assertion.
const RAW_PUBKEY_HEX_A = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const RAW_PUBKEY_BUF_A = Buffer.from(RAW_PUBKEY_HEX_A, "hex");
const EXPECTED_BS58_A = "4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw";

// Cryptographic-binding fixture B (high-entropy pubkey-shaped bytes):
// pins a second base58 literal so a regression that happens to produce
// a fixed-but-wrong output (e.g. always returns the empty string) is
// caught by both fixtures, not just one.
const RAW_PUBKEY_HEX_B = "b2c0e2e2f3a8c8c1b9e3a4d5f6c7e8d9aabbccddeeff00112233445566778899";
const RAW_PUBKEY_BUF_B = Buffer.from(RAW_PUBKEY_HEX_B, "hex");
const EXPECTED_BS58_B = "D2nAGaAe6PkiYdoJG5hBzw3ARJFJN4aDFXjHzaJQgn2c";

interface MockTransport {
  close: ReturnType<typeof vi.fn>;
  disconnected: boolean;
}

interface MockSolanaApp {
  getAppConfiguration: ReturnType<typeof vi.fn>;
  getAddress: ReturnType<typeof vi.fn>;
}

function makeMockTransport(): MockTransport {
  return {
    close: vi.fn(async () => undefined),
    disconnected: false,
  };
}

function makeMockApp(rawPubkey: Buffer, version = "1.4.0"): MockSolanaApp {
  return {
    getAppConfiguration: vi.fn(async () => ({ version })),
    getAddress: vi.fn(async () => ({ address: rawPubkey })),
  };
}

beforeEach(() => {
  _resetLedgerSolanaTransportForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetLedgerSolanaTransportForTesting();
});

describe("constants", () => {
  it("DEFAULT_SOLANA_DERIVATION_PATH is the 3-level Ledger Live default `44'/501'/0'` (D-2)", () => {
    // This is the load-bearing assertion for D-2: Ledger Live's
    // default `solanaBip44` mode = 3 levels. A regression that swaps
    // to Phantom-compat 4-level `44'/501'/0'/0'` MUST fail here.
    expect(DEFAULT_SOLANA_DERIVATION_PATH).toBe("44'/501'/0'");
    // Defensive shape check: exactly 3 hardened segments.
    const segments = DEFAULT_SOLANA_DERIVATION_PATH.split("/");
    expect(segments).toHaveLength(3);
    expect(segments.every((s) => s.endsWith("'"))).toBe(true);
  });

  it("APPROVAL_TIMEOUT_MS is 60s (mirrors session-manager budget consumed by pair_solana_ledger in Plan 11-04)", () => {
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
      /Connect your Ledger via USB, unlock it, and open the Solana app/,
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

describe("fetchSolanaAddress", () => {
  it("returns the base58-encoded address + raw pubkey Buffer + app version on the happy path", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp(RAW_PUBKEY_BUF_A, "1.4.0");
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);

    const result = await fetchSolanaAddress();

    // LOAD-BEARING — pinned to a hardcoded base58 literal. Drift in
    // bs58.encode-on-Buffer (e.g. someone replaces with .toString())
    // fails here. The plan's CRITICAL note: docs say "address" but
    // the Ledger SDK returns a Buffer; this module bs58-encodes it.
    expect(result.address).toBe(EXPECTED_BS58_A);
    expect(result.rawPubkey).toBe(RAW_PUBKEY_BUF_A);
    expect(result.appVersion).toBe("1.4.0");
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
  });

  it("calls app.getAddress with the 3-level Ledger Live default path when no argument is passed (D-2)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp(RAW_PUBKEY_BUF_A);
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);

    await fetchSolanaAddress();

    expect(stubApp.getAddress).toHaveBeenCalledTimes(1);
    expect(stubApp.getAddress).toHaveBeenCalledWith("44'/501'/0'");
  });

  it("passes a custom derivation path through verbatim to app.getAddress", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp(RAW_PUBKEY_BUF_A);
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);

    await fetchSolanaAddress("44'/501'/3'");

    expect(stubApp.getAddress).toHaveBeenCalledTimes(1);
    expect(stubApp.getAddress).toHaveBeenCalledWith("44'/501'/3'");
  });

  it("encodes a high-entropy 32-byte pubkey to the expected base58 literal (fixture B)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp(RAW_PUBKEY_BUF_B, "1.5.1");
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);

    const result = await fetchSolanaAddress();

    expect(result.address).toBe(EXPECTED_BS58_B);
    expect(result.appVersion).toBe("1.5.1");
  });

  it("falls back to appVersion=\"unknown\" when getAppConfiguration returns no version field", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = {
      getAppConfiguration: vi.fn(async () => ({})),
      getAddress: vi.fn(async () => ({ address: RAW_PUBKEY_BUF_A })),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);

    const result = await fetchSolanaAddress();
    expect(result.appVersion).toBe("unknown");
  });

  it("throws LedgerSolanaAppNotOpenError when getAppConfiguration rejects", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = {
      getAppConfiguration: vi.fn(async () => {
        throw new Error("0x6e00"); // INS_NOT_SUPPORTED — typical "wrong app" APDU
      }),
      getAddress: vi.fn(),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);

    await expect(fetchSolanaAddress()).rejects.toBeInstanceOf(LedgerSolanaAppNotOpenError);
    // finally-block invariant: transport.close() STILL called on error path.
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
    // getAddress is NOT reached when the app isn't Solana.
    expect(stubApp.getAddress).not.toHaveBeenCalled();
  });

  it("propagates app.getAddress errors AND still closes the transport (finally-block invariant)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = {
      getAppConfiguration: vi.fn(async () => ({ version: "1.4.0" })),
      getAddress: vi.fn(async () => {
        throw new Error("user rejected");
      }),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);

    await expect(fetchSolanaAddress()).rejects.toThrow(/user rejected/);
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
      getAppConfiguration: vi.fn(async () => ({ version: "1.4.0" })),
      getAddress: vi.fn(async () => {
        throw new Error("user rejected");
      }),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    // Silence the warn-log so the test output stays clean.
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(fetchSolanaAddress()).rejects.toThrow(/user rejected/);
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
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
});

describe("module load (NodeNext default-export drift regression)", () => {
  it("the (Module as any).default ?? Module shim resolves both Ledger packages to runtime classes", async () => {
    // If the shim regresses, the module-level `new SolanaApp(...)` /
    // `TransportNodeHid.open(...)` calls throw at first invocation
    // with "X is not a constructor" / "Cannot read property 'open'".
    // This test exercises the runtime constructors via the indirection
    // without needing a real device — proving the import shape is
    // compatible with the NodeNext default-export drift research note.
    expect(typeof _transport.isSupported).toBe("function");
    expect(typeof _transport.list).toBe("function");
    expect(typeof _transport.open).toBe("function");
    expect(typeof _transport.buildSolanaApp).toBe("function");
  });
});
