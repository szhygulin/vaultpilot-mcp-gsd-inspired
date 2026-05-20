// Plan 12-04 — `signSolanaTransaction` regression file.
// Mirror of `test/ledger-solana-transport.test.ts` (Phase 11) per-call
// transport discipline shape.
//
// Load-bearing invariants:
//   - **Per-call transport** — every `signSolanaTransaction` opens fresh,
//     signs, closes in `finally` (no singleton).
//   - **`userInputType: "sol"` default** per RESEARCH § Topic 5 +
//     LedgerHQ/ledger-live PR #12199. Tests assert the SDK call site
//     receives `"sol"` (NOT `"ata"`, NOT undefined) by default.
//   - **APDU 0x6985 → LedgerSolanaUserRejectedError** mirror of EVM
//     `isUserRejectedError` (substring match on the message).
//   - **transport.close() unconditional** — fires on happy path + every
//     error class (LEDGER_NOT_CONNECTED short-circuits before open; sign
//     errors fire close in the finally block).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SOLANA_DERIVATION_PATH,
  LedgerDeviceNotConnectedError,
  LedgerSolanaAppNotOpenError,
  LedgerSolanaUserRejectedError,
  _resetLedgerSolanaTransportForTesting,
  _transport,
  signSolanaTransaction,
} from "../src/wallet/ledger-solana-transport.js";

interface MockTransport {
  close: ReturnType<typeof vi.fn>;
  disconnected: boolean;
}

interface MockSolanaApp {
  getAppConfiguration: ReturnType<typeof vi.fn>;
}

function makeMockTransport(): MockTransport {
  return {
    close: vi.fn(async () => undefined),
    disconnected: false,
  };
}

function makeMockApp(): MockSolanaApp {
  return {
    getAppConfiguration: vi.fn(async () => ({ version: "1.4.0" })),
  };
}

// Helper — pin a 64-byte signature so the test asserts byte-identity.
const SIGNATURE_64 = Buffer.alloc(64, 0xaa);

beforeEach(() => {
  _resetLedgerSolanaTransportForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetLedgerSolanaTransportForTesting();
});

describe("signSolanaTransaction — happy path (per-call transport)", () => {
  it("opens transport, signs via the Ledger Solana app, returns the 64-byte signature as Uint8Array, and closes the transport exactly once", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    const signSpy = vi
      .spyOn(_transport, "signTransactionViaApp")
      .mockResolvedValue({ signature: SIGNATURE_64 });

    const messageBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await signSolanaTransaction({ messageBytes });

    expect(result.signature).toBeInstanceOf(Uint8Array);
    expect(result.signature.length).toBe(64);
    // Byte-identical to the mocked signature.
    expect(Buffer.from(result.signature).equals(SIGNATURE_64)).toBe(true);
    // Transport closed exactly once — per-call invariant.
    expect(stubTransport.close).toHaveBeenCalledTimes(1);
    // sign was called exactly once.
    expect(signSpy).toHaveBeenCalledTimes(1);
  });
});

describe("signSolanaTransaction — userInputType arg passthrough (SOL-PREP-05 surface)", () => {
  it("defaults userInputType to \"sol\" when caller omits the field (RESEARCH § Topic 5 lock)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    const signSpy = vi
      .spyOn(_transport, "signTransactionViaApp")
      .mockResolvedValue({ signature: SIGNATURE_64 });

    await signSolanaTransaction({
      messageBytes: new Uint8Array([1, 2, 3]),
    });

    // LOAD-BEARING — the third positional arg MUST be the literal "sol".
    // Drift here (e.g. someone "fixes" the default to "ata") would silently
    // change which address the Ledger clear-sign UI displays — wallet vs.
    // ATA — and break the trust pipeline because the agent's `to` arg
    // surfaces the wallet (PREP-02 verbatim) but the device would show the
    // ATA. PR #12199 LedgerHQ/ledger-live precedent.
    expect(signSpy).toHaveBeenCalledTimes(1);
    const [, , , userInputType] = signSpy.mock.calls[0]!;
    expect(userInputType).toBe("sol");
  });

  it("passes userInputType: \"ata\" through verbatim when caller specifies it (forward-compat surface)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    const signSpy = vi
      .spyOn(_transport, "signTransactionViaApp")
      .mockResolvedValue({ signature: SIGNATURE_64 });

    await signSolanaTransaction({
      messageBytes: new Uint8Array([1, 2, 3]),
      userInputType: "ata",
    });

    const [, , , userInputType] = signSpy.mock.calls[0]!;
    expect(userInputType).toBe("ata");
  });
});

describe("signSolanaTransaction — derivationPath default + override", () => {
  it("defaults derivationPath to DEFAULT_SOLANA_DERIVATION_PATH (44'/501'/0')", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    const signSpy = vi
      .spyOn(_transport, "signTransactionViaApp")
      .mockResolvedValue({ signature: SIGNATURE_64 });

    await signSolanaTransaction({ messageBytes: new Uint8Array([1]) });

    const [, derivationPath] = signSpy.mock.calls[0]!;
    expect(derivationPath).toBe(DEFAULT_SOLANA_DERIVATION_PATH);
    expect(derivationPath).toBe("44'/501'/0'");
  });

  it("passes a custom derivationPath through verbatim", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    const signSpy = vi
      .spyOn(_transport, "signTransactionViaApp")
      .mockResolvedValue({ signature: SIGNATURE_64 });

    await signSolanaTransaction({
      messageBytes: new Uint8Array([1]),
      derivationPath: "44'/501'/3'",
    });

    const [, derivationPath] = signSpy.mock.calls[0]!;
    expect(derivationPath).toBe("44'/501'/3'");
  });
});

describe("signSolanaTransaction — messageBytes byte-identity passthrough", () => {
  it("passes Buffer.from(messageBytes) to the SDK byte-for-byte (regression against accidental mutation)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    const signSpy = vi
      .spyOn(_transport, "signTransactionViaApp")
      .mockResolvedValue({ signature: SIGNATURE_64 });

    const messageBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xfe, 0xed]);
    await signSolanaTransaction({ messageBytes });

    const [, , passedBuffer] = signSpy.mock.calls[0]!;
    expect(Buffer.isBuffer(passedBuffer)).toBe(true);
    expect(passedBuffer.equals(Buffer.from(messageBytes))).toBe(true);
  });
});

describe("signSolanaTransaction — error mapping", () => {
  it("LEDGER_NOT_CONNECTED — openTransport throws when isSupported is false; close NEVER called (transport never opened)", async () => {
    vi.spyOn(_transport, "isSupported").mockResolvedValue(false);
    // Defense-in-depth: spy on `open` to assert it was NEVER called.
    const openSpy = vi.spyOn(_transport, "open");

    await expect(
      signSolanaTransaction({ messageBytes: new Uint8Array([1]) }),
    ).rejects.toBeInstanceOf(LedgerDeviceNotConnectedError);

    expect(openSpy).not.toHaveBeenCalled();
  });

  it("SOLANA_APP_NOT_OPEN — getAppConfiguration throws → LedgerSolanaAppNotOpenError; transport STILL closed in finally", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = {
      getAppConfiguration: vi.fn(async () => {
        throw new Error("0x6e00"); // INS_NOT_SUPPORTED — wrong app on device
      }),
    };
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    // sign should NEVER be reached when the app config check fails.
    const signSpy = vi.spyOn(_transport, "signTransactionViaApp");

    await expect(
      signSolanaTransaction({ messageBytes: new Uint8Array([1]) }),
    ).rejects.toBeInstanceOf(LedgerSolanaAppNotOpenError);

    expect(stubTransport.close).toHaveBeenCalledTimes(1);
    expect(signSpy).not.toHaveBeenCalled();
  });

  it("LEDGER_REJECTED — APDU 0x6985 substring in sign error → LedgerSolanaUserRejectedError; transport STILL closed in finally", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    vi.spyOn(_transport, "signTransactionViaApp").mockRejectedValue(
      new Error("Ledger device: APDU 0x6985 — Conditions of use not satisfied"),
    );

    await expect(
      signSolanaTransaction({ messageBytes: new Uint8Array([1]) }),
    ).rejects.toBeInstanceOf(LedgerSolanaUserRejectedError);

    expect(stubTransport.close).toHaveBeenCalledTimes(1);
  });

  it("LEDGER_REJECTED — \"User rejected\" substring (case-insensitive) → LedgerSolanaUserRejectedError", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    vi.spyOn(_transport, "signTransactionViaApp").mockRejectedValue(
      new Error("User Rejected the on-device approval"),
    );

    await expect(
      signSolanaTransaction({ messageBytes: new Uint8Array([1]) }),
    ).rejects.toBeInstanceOf(LedgerSolanaUserRejectedError);

    expect(stubTransport.close).toHaveBeenCalledTimes(1);
  });

  it("INTERNAL_ERROR pass-through — unknown sign error propagates verbatim; transport STILL closed in finally", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    vi.spyOn(_transport, "signTransactionViaApp").mockRejectedValue(
      new Error("USB-HID stall"),
    );

    await expect(
      signSolanaTransaction({ messageBytes: new Uint8Array([1]) }),
    ).rejects.toThrow(/USB-HID stall/);

    expect(stubTransport.close).toHaveBeenCalledTimes(1);
  });
});

describe("signSolanaTransaction — per-call transport (no singleton)", () => {
  it("two sequential calls each open a fresh transport (Phase 11 invariant)", async () => {
    const t1 = makeMockTransport();
    const t2 = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    const openSpy = vi
      .spyOn(_transport, "open")
      .mockResolvedValueOnce(t1)
      .mockResolvedValueOnce(t2);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    vi.spyOn(_transport, "signTransactionViaApp").mockResolvedValue({
      signature: SIGNATURE_64,
    });

    await signSolanaTransaction({ messageBytes: new Uint8Array([1]) });
    await signSolanaTransaction({ messageBytes: new Uint8Array([2]) });

    expect(openSpy).toHaveBeenCalledTimes(2);
    expect(t1.close).toHaveBeenCalledTimes(1);
    expect(t2.close).toHaveBeenCalledTimes(1);
  });
});

describe("_transport.signTransactionViaApp — ESM spy-affordance regression", () => {
  it("vi.spyOn(_transport, \"signTransactionViaApp\") intercepts the production callsite (immutable-binding regression)", async () => {
    const stubTransport = makeMockTransport();
    const stubApp = makeMockApp();
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(stubTransport);
    vi.spyOn(_transport, "buildSolanaApp").mockReturnValue(stubApp);
    // The spy MUST intercept — without the indirection, calling
    // `app.signTransaction(...)` directly inside the module would silently
    // bypass the spy and the assertion below would fail.
    const spy = vi
      .spyOn(_transport, "signTransactionViaApp")
      .mockResolvedValue({ signature: SIGNATURE_64 });

    await signSolanaTransaction({ messageBytes: new Uint8Array([0xab]) });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
