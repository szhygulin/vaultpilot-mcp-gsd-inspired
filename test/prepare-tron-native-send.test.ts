// `prepare_tron_native_send` end-to-end regression. Phase 18 — Plan 18-02.
//
// Load-bearing invariants:
//
//   1. **Fixture M consumer re-anchor** — the canonical Fixture M inputs
//      (TRON-whale persona sender + canonical recipient + 1_000_000 sun +
//      pinned ref-block) produce the hardcoded literal
//      `0xaa8305509481b97e50acb9e4d582bb53a1db1c99f9c357febe1fbf7389ffd4fa`
//      pinned in `test/signing-fingerprint-tron.test.ts`. Drift in this tool's
//      preimage assembly surfaces HERE, at this exact assertion — load-bearing
//      redundancy per CLAUDE.md fixture discipline + CONTEXT D-08d.
//
//   2. **INVALID_INPUT FIRST** — `to` validated before any state read; `sun`
//      validated before any RPC call. Demo/real mode checks happen AFTER.
//
//   3. **PREPARE RECEIPT verbatim** (PREP-02) — receipt reads from raw agent
//      strings (no normalization, no decimal scaling). Substituted from the
//      format-fanout-sentinel `PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE` const.
//
//   4. **Demo-mode FIRST** — in demo mode, `getActiveTronPersona()` is consulted
//      BEFORE `listAccounts`. `listAccounts` is NEVER called in demo mode.
//
// Mocks:
//   - `_tronRegistry.getTronWeb()` returns a stub TronWeb whose
//     `transactionBuilder.sendTrx` and `extendExpiration` are `vi.fn`.
//   - `non-evm-account-store.listAccounts` mocked to control real-mode
//     pairing state.
//   - TRON persona state controlled via `setActiveTronPersonaBySlug` /
//     `_resetActivePersonaForTesting`.
//
// Fixture M cross-link:
//   FROM            = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" (USDT deployer —
//                     NOTE: Fixture M uses the USDT deployer as FROM, but the
//                     tron-whale persona "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb"
//                     is used as the demo FROM in the re-anchor test. The
//                     fingerprint is SENDER-DEPENDENT — the re-anchor test mocks
//                     the encoder to return Fixture M bytes regardless of sender
//                     because the mock pins the raw_data_hex directly.
//                     The sender-dependence full integration test lands in Plan 18-04.)
//   TO              = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8"
//   sun             = "1000000"
//   raw_data_hex    = Fixture M literal
//   payloadFingerprint = 0xaa8305509481b97e50acb9e4d582bb53a1db1c99f9c357febe1fbf7389ffd4fa

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy, createHandleSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  createHandleSpy:
    vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

// Mock non-evm-account-store's `listAccounts` (TRON pairing surface).
vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (
      ...args: Parameters<typeof actual.listAccounts>
    ) => listAccountsSpy(...args),
  };
});

// Mock handle-store's `createHandle` as a spy that delegates to real impl.
vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (
      ...args: Parameters<typeof actual.createHandle>
    ) => createHandleSpy(...args),
  };
});

import { _tronRegistry } from "../src/chains/tron/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveTronPersonaBySlug,
} from "../src/demo/state.js";
import { PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE } from "../src/signing/blocks-tron.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  lookup,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_tron_native_send");
  if (!tool) throw new Error("prepare_tron_native_send not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// ============================================================================
// Fixture M constants — must align with `test/signing-fingerprint-tron.test.ts`
// ============================================================================
// Fixture M TO address (USDC contract — valid TRON address used as canonical recipient)
const FIXTURE_M_TO = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const FIXTURE_M_SUN = "1000000";
const FIXTURE_M_REF_BLOCK_BYTES = "00ad";
const FIXTURE_M_REF_BLOCK_HASH = "8e5e7df4e3c8b9a2";
const FIXTURE_M_EXPIRATION_BASE = 1779268134000;
const FIXTURE_M_TIMESTAMP = 1779268074000;

// Fixture M raw_data_hex — pinned at `test/signing-fingerprint-tron.test.ts`.
const FIXTURE_M_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c1215413487b63d30b5b2c87fb7ffa8bcfade38eaac1abe18c0843d7090f490a5e433";

// Fixture M payloadFingerprint — hardcoded literal anchor from Plan 18-01.
// Cross-linked from `test/signing-fingerprint-tron.test.ts:Fixture M`.
// Drift in preimage assembly MUST fail at this EXACT line (load-bearing redundancy).
const FIXTURE_M_FINGERPRINT =
  "0xaa8305509481b97e50acb9e4d582bb53a1db1c99f9c357febe1fbf7389ffd4fa";

// hex-encoded owner/to addresses as they appear in tronweb's decoded parameter.value
const FIXTURE_M_OWNER_ADDR_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const FIXTURE_M_TO_ADDR_HEX = "413487b63d30b5b2c87fb7ffa8bcfade38eaac1abe";

// TRON-whale persona address (Plan 17-05 — "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb")
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";

// A canonical paired TRON account (real-mode shape from pair_tron_ledger).
const PAIRED_TRON_ACCOUNT = {
  chain: "tron" as const,
  address: TRON_WHALE_ADDR,
  derivationPath: "44'/195'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

/**
 * Build a stub TronWeb that returns Fixture-M-shaped tx from `sendTrx` and
 * the same tx (with expiration extended by 900_000ms) from `extendExpiration`.
 *
 * IMPORTANT: for the Fixture M consumer re-anchor, `extendExpiration` returns
 * a tx with the SAME `raw_data_hex` as the base tx. This matches the fixture
 * computation approach: the fingerprint is derived from the pinned hex literal,
 * which is what the mock always returns regardless of the expiration mutation.
 * In production, tronweb re-serializes the Protobuf after extension, producing
 * a different hex. The mock pins the hex for byte-stable fingerprint assertion.
 */
function buildFixtureMTronWeb(): {
  transactionBuilder: { sendTrx: ReturnType<typeof vi.fn>; extendExpiration: ReturnType<typeof vi.fn> };
} {
  const baseTx = {
    raw_data_hex: FIXTURE_M_RAW_DATA_HEX,
    raw_data: {
      contract: [
        {
          type: "TransferContract",
          parameter: {
            value: {
              owner_address: FIXTURE_M_OWNER_ADDR_HEX,
              to_address: FIXTURE_M_TO_ADDR_HEX,
              amount: Number(FIXTURE_M_SUN),
            },
          },
        },
      ],
      ref_block_bytes: FIXTURE_M_REF_BLOCK_BYTES,
      ref_block_hash: FIXTURE_M_REF_BLOCK_HASH,
      expiration: FIXTURE_M_EXPIRATION_BASE,
      timestamp: FIXTURE_M_TIMESTAMP,
    },
  };

  // extendExpiration mock: keeps the same raw_data_hex (pinned for re-anchor)
  // but updates expiration by +900_000ms.
  const extendedTx = {
    ...baseTx,
    raw_data: {
      ...baseTx.raw_data,
      expiration: FIXTURE_M_EXPIRATION_BASE + 900_000,
    },
  };

  return {
    transactionBuilder: {
      sendTrx: vi.fn().mockResolvedValue(baseTx),
      extendExpiration: vi.fn().mockResolvedValue(extendedTx),
    },
  };
}

beforeEach(async () => {
  listAccountsSpy.mockReset();
  createHandleSpy.mockClear();
  const realHandleStore = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(realHandleStore.createHandle);
  _resetHandleStoreForTesting();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  vi.restoreAllMocks();
});

// ============================================================================
// Happy path — real mode + paired TRON account
// ============================================================================

describe("prepare_tron_native_send — happy path (real mode + paired TRON account)", () => {
  it("returns { handle, chain, to, sun, refBlockBytes, refBlockHash, expiration, payloadFingerprint, prepareReceipt } with PREPARE RECEIPT body", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({
      to: FIXTURE_M_TO,
      sun: FIXTURE_M_SUN,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chain: string;
      to: string;
      sun: string;
      refBlockBytes: string;
      refBlockHash: string;
      expiration: number;
      payloadFingerprint: string;
      prepareReceipt: string;
      txType: string;
    };

    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sc.chain).toBe("tron");
    expect(sc.to).toBe(FIXTURE_M_TO);
    expect(sc.sun).toBe(FIXTURE_M_SUN);
    expect(sc.refBlockBytes).toBe(FIXTURE_M_REF_BLOCK_BYTES);
    expect(sc.refBlockHash).toBe(FIXTURE_M_REF_BLOCK_HASH);
    expect(sc.expiration).toBe(FIXTURE_M_EXPIRATION_BASE + 900_000);
    expect(sc.txType).toBe("tron");

    // listAccounts was consulted exactly once with chainFilter: "tron".
    expect(listAccountsSpy).toHaveBeenCalledTimes(1);
    expect(listAccountsSpy).toHaveBeenCalledWith({ chainFilter: "tron" });
  });
});

// ============================================================================
// Fixture M consumer re-anchor (LOAD-BEARING per CLAUDE.md fixture discipline)
// ============================================================================

describe("prepare_tron_native_send — Fixture M consumer re-anchor (PAYLOAD_FINGERPRINT_DRIFT regression)", () => {
  it("byte-identical fingerprint to the literal pinned in signing-fingerprint-tron.test.ts (FIXTURE_M_FINGERPRINT)", async () => {
    // Use demo mode so we have a deterministic from address without needing the
    // full real-mode TRON account setup. The mock encoder returns the Fixture M
    // raw_data_hex regardless of the from address used.
    //
    // NOTE: the TRON fingerprint IS sender-dependent by construction (owner_address
    // is inside the Protobuf). The Fixture M bytes encode FROM=USDT-deployer.
    // The mock pins those bytes, so the fingerprint assertion is byte-stable
    // regardless of which sender the tool uses. The full persona-cycle
    // sender-dependence integration test lands in Plan 18-04.
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({
      to: FIXTURE_M_TO,
      sun: FIXTURE_M_SUN,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };

    // LOAD-BEARING ASSERTION — if this fails, drift is in `prepare_tron_native_send`
    // preimage assembly. Check:
    //   1. Does the mock still return FIXTURE_M_RAW_DATA_HEX?
    //   2. Does _tronNative.encodeTronTransfer propagate rawDataBytes correctly?
    //   3. Does _tronFingerprint.computeTronPayloadFingerprint receive the right bytes?
    expect(sc.payloadFingerprint).toBe(FIXTURE_M_FINGERPRINT);
  });
});

// ============================================================================
// PREPARE RECEIPT shape pin (PREP-02 verbatim invariant)
// ============================================================================

describe("prepare_tron_native_send — PREPARE RECEIPT verbatim invariant (PREP-02)", () => {
  it("PREPARE RECEIPT substituted from PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE byte-for-byte", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({
      to: FIXTURE_M_TO,
      sun: FIXTURE_M_SUN,
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expectedReceipt = PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE
      .replace("{TO}", FIXTURE_M_TO)
      .replace("{SUN}", FIXTURE_M_SUN)
      .replace("{REF_BLOCK_BYTES}", FIXTURE_M_REF_BLOCK_BYTES)
      .replace("{REF_BLOCK_HASH}", FIXTURE_M_REF_BLOCK_HASH)
      .replace("{EXPIRATION}", String(FIXTURE_M_EXPIRATION_BASE + 900_000));

    // The receipt block must appear in the text response verbatim.
    expect(text).toContain(expectedReceipt);

    // Spot checks: specific fields present in receipt.
    expect(text).toContain("PREPARE RECEIPT (TRON — native transfer)");
    expect(text).toContain(FIXTURE_M_TO);
    expect(text).toContain(FIXTURE_M_SUN);
    expect(text).toContain(FIXTURE_M_REF_BLOCK_BYTES);
    expect(text).toContain(FIXTURE_M_REF_BLOCK_HASH);
    expect(text).toContain(String(FIXTURE_M_EXPIRATION_BASE + 900_000));

    // Verbatim invariant: raw agent strings, NOT normalized.
    // structuredContent.prepareReceipt must match the template substitution.
    const sc = result.structuredContent as { prepareReceipt: string };
    expect(sc.prepareReceipt).toBe(expectedReceipt);
  });

  it("text response includes handle + payloadFingerprint + next-step instruction", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    const sc = result.structuredContent as { handle: string; payloadFingerprint: string };

    expect(text).toContain(`Handle: ${sc.handle}`);
    expect(text).toContain(`payloadFingerprint: ${sc.payloadFingerprint}`);
    expect(text).toContain("preview_send");
  });
});

// ============================================================================
// Ref-block surfacing assertions
// ============================================================================

describe("prepare_tron_native_send — ref-block surfacing + expiration", () => {
  it("structuredContent carries refBlockBytes + refBlockHash + extended expiration", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      refBlockBytes: string;
      refBlockHash: string;
      expiration: number;
    };

    expect(sc.refBlockBytes).toBe(FIXTURE_M_REF_BLOCK_BYTES);
    expect(sc.refBlockHash).toBe(FIXTURE_M_REF_BLOCK_HASH);
    // Expiration is the EXTENDED value (base + 900_000ms).
    expect(sc.expiration).toBe(FIXTURE_M_EXPIRATION_BASE + 900_000);
  });

  it("handle record.args carries refBlockBytes + refBlockHash + expiration (PREP-02 pinning)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.args.refBlockBytes).toBe(FIXTURE_M_REF_BLOCK_BYTES);
    expect(record.args.refBlockHash).toBe(FIXTURE_M_REF_BLOCK_HASH);
    expect(record.args.expiration).toBe(String(FIXTURE_M_EXPIRATION_BASE + 900_000));
    expect(record.args.sun).toBe(FIXTURE_M_SUN);
  });

  it("handle record.tx is PreparedTxTron with kind:native + rawDataHex + expiration", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.tx.txType).toBe("tron");
    if (record.tx.txType !== "tron") return;
    expect(record.tx.kind).toBe("native");
    expect(record.tx.rawDataHex).toBe(FIXTURE_M_RAW_DATA_HEX);
    expect(record.tx.expiration).toBe(FIXTURE_M_EXPIRATION_BASE + 900_000);
    expect(record.tx.refBlockBytes).toBe(FIXTURE_M_REF_BLOCK_BYTES);
    expect(record.tx.refBlockHash).toBe(FIXTURE_M_REF_BLOCK_HASH);
    expect(record.tx.instructionSummary).toBeDefined();
    expect(record.tx.instructionSummary?.[0]?.kind).toBe("native-transfer");

    // Sentinel EVM fields (defensive — Layer 0.5 catches before reaching these).
    expect(record.tx.chainId).toBe(0);
    expect(record.tx.valueWei).toBe(0n);
    expect(record.tx.data).toBe("0x");
  });
});

// ============================================================================
// Demo-mode persona resolution
// ============================================================================

describe("prepare_tron_native_send — demo mode + active TRON persona", () => {
  it("succeeds with from = tron-whale persona address; listAccounts NEVER called (demo-FIRST contract)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });

    expect(result.isError).toBeFalsy();
    // Defense: listAccounts is NEVER called in demo mode.
    expect(listAccountsSpy).toHaveBeenCalledTimes(0);
    // createHandle IS called — handle flows through preview + send simulation.
    expect(createHandleSpy).toHaveBeenCalledTimes(1);

    // encodeTronTransfer was called with the tron-whale address as `from`.
    const sendTrxCall = mockTronWeb.transactionBuilder.sendTrx.mock.calls[0];
    expect(sendTrxCall?.[2]).toBe(TRON_WHALE_ADDR);
  });
});

// ============================================================================
// Persona-cycle sender-dependent fingerprint (mini-regression — Plan 18-04 full integration)
// ============================================================================

describe("prepare_tron_native_send — persona-cycle sender-dependence (mini-regression)", () => {
  it("different from addresses produce different sendTrx calls (sender-dependence by construction)", async () => {
    // In production, encodeTronTransfer returns different raw_data_hex for
    // different owner_address values because owner_address is a Protobuf field
    // inside TransferContract. This test verifies the `from` arg passes through
    // correctly (the mock always returns the same hex, so we assert on the call arg,
    // not the fingerprint — the full fingerprint sender-dependence test is Plan 18-04).
    const altAddress = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // USDT deployer (not the whale)

    // Persona 1: tron-whale
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");
    const mock1 = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mock1 as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );
    const result1 = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });
    expect(result1.isError).toBeFalsy();
    const fromArg1 = mock1.transactionBuilder.sendTrx.mock.calls[0]?.[2];
    expect(fromArg1).toBe(TRON_WHALE_ADDR);

    vi.restoreAllMocks();
    _resetActivePersonaForTesting();
    _resetHandleStoreForTesting();

    // Persona 2: inject a mock persona with a different address via real-mode
    // (using a paired account with the USDT deployer address).
    process.env[DEMO_KEY] = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReturnValue([
      {
        chain: "tron" as const,
        address: altAddress,
        derivationPath: "44'/195'/0'/0/0",
        pairedAt: new Date().toISOString(),
      },
    ]);
    const mock2 = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mock2 as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );
    const result2 = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });
    expect(result2.isError).toBeFalsy();
    const fromArg2 = mock2.transactionBuilder.sendTrx.mock.calls[0]?.[2];
    expect(fromArg2).toBe(altAddress);

    // The two `from` values are different — sender-dependence asserted.
    expect(fromArg1).not.toBe(fromArg2);
  });
});

// ============================================================================
// WALLET_NOT_PAIRED refusal (real mode, zero accounts)
// ============================================================================

describe("prepare_tron_native_send — WALLET_NOT_PAIRED refusal (real mode, zero accounts)", () => {
  it("refuses with WALLET_NOT_PAIRED when listAccounts returns []; createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
    expect(result.content[0]?.text ?? "").toMatch(/pair_tron_ledger/);

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

// ============================================================================
// WRONG_MODE refusal (demo mode without active TRON persona)
// ============================================================================

describe("prepare_tron_native_send — WRONG_MODE refusal (demo mode + no TRON persona)", () => {
  it("refuses with WRONG_MODE when demo mode is on but no TRON persona is set; listAccounts NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting(); // ensure no TRON persona active

    const result = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);
    expect(text).toMatch(/set_demo_wallet/);

    // Defense-in-depth: NEITHER downstream is touched in the WRONG_MODE branch.
    expect(listAccountsSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

// ============================================================================
// INVALID_INPUT refusals
// ============================================================================

describe("prepare_tron_native_send — INVALID_INPUT refusals", () => {
  it("refuses with INVALID_INPUT for bad `to` (not a TRON address); createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    const result = await callTool({ to: "not-an-address", sun: FIXTURE_M_SUN });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/to|address/i);

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT for an EVM 0x address (not a valid TRON base58check)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    const result = await callTool({
      to: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      sun: FIXTURE_M_SUN,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT for fractional sun \"1.5\" (decimals=0 off-by-decimal guard); cause = fractional-overflow", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({ to: FIXTURE_M_TO, sun: "1.5" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("fractional-overflow");
    expect(result.content[0]?.text ?? "").toMatch(/sun/i);

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT for sun overflow (2^64 = u64-overflow kind)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    // 2^64 = 18446744073709551616 — exceeds u64 max
    const result = await callTool({
      to: FIXTURE_M_TO,
      sun: "18446744073709551616",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("u64-overflow");

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT for empty sun; cause = empty", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({ to: FIXTURE_M_TO, sun: "" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("empty");

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT for negative sun \"-1\" (format guard)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({ to: FIXTURE_M_TO, sun: "-1" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("INVALID_INPUT for bad `to` fires BEFORE any mode check (input validation first)", async () => {
    // Even in demo mode without a persona, bad `to` fires INVALID_INPUT not WRONG_MODE.
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();

    const result = await callTool({ to: "bad-address", sun: FIXTURE_M_SUN });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
  });
});

// ============================================================================
// Handle round-trip (record shape + ref-block pinning)
// ============================================================================

describe("prepare_tron_native_send — handle round-trip lookup", () => {
  it("lookup(handle) succeeds; record.status === 'prepared'; record.tx.txType === 'tron'", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });
    const sc = result.structuredContent as { handle: string };
    const lookupResult = lookup(sc.handle);
    expect(lookupResult.ok).toBe(true);
    if (!lookupResult.ok) return;
    expect(lookupResult.record.status).toBe("prepared");
    expect(lookupResult.record.tx.txType).toBe("tron");
    expect(lookupResult.record.pinned).toBeUndefined();
  });

  it("structuredContent.refBlockBytes === record.args.refBlockBytes (pinning contract)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");
    const mockTronWeb = buildFixtureMTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });
    const sc = result.structuredContent as {
      handle: string;
      refBlockBytes: string;
      refBlockHash: string;
    };
    const lookupResult = lookup(sc.handle);
    expect(lookupResult.ok).toBe(true);
    if (!lookupResult.ok) return;
    expect(sc.refBlockBytes).toBe(lookupResult.record.args.refBlockBytes);
    expect(sc.refBlockHash).toBe(lookupResult.record.args.refBlockHash);
  });
});

// ============================================================================
// register-all.ts wiring smoke test
// ============================================================================

describe("prepare_tron_native_send — register-all.ts wiring (smoke)", () => {
  it("prepare_tron_native_send is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_tron_native_send");
  });
});

// ============================================================================
// errorCode envelope set (no new codes introduced)
// ============================================================================

describe("prepare_tron_native_send — errorCode envelope set (locked set)", () => {
  it("all error responses use only the locked set: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT, INTERNAL_ERROR", async () => {
    const ALLOWED = new Set([
      "WALLET_NOT_PAIRED",
      "WRONG_MODE",
      "INVALID_INPUT",
      "INTERNAL_ERROR",
    ]);

    // WALLET_NOT_PAIRED arm.
    process.env[DEMO_KEY] = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReturnValue([]);
    const r1 = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });
    expect(ALLOWED.has((r1.structuredContent as { errorCode: string }).errorCode)).toBe(true);

    // WRONG_MODE arm.
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();
    const r2 = await callTool({ to: FIXTURE_M_TO, sun: FIXTURE_M_SUN });
    expect(ALLOWED.has((r2.structuredContent as { errorCode: string }).errorCode)).toBe(true);

    // INVALID_INPUT arm (bad `to`).
    process.env[DEMO_KEY] = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const r3 = await callTool({ to: "garbage!!", sun: FIXTURE_M_SUN });
    expect(ALLOWED.has((r3.structuredContent as { errorCode: string }).errorCode)).toBe(true);
  });
});
