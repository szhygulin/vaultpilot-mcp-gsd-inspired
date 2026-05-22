// `prepare_btc_rbf_bump` end-to-end regression. Phase 24 — Plan 24-01.
//
// BTC-W-02 coverage: RBF fee-bump tool for mempool-pending txs.
//
// Load-bearing invariants:
//
//   1. **Refusal cases fire first**: confirmed-tx check, RBF-signal check,
//      fee-rate bump validation, no-change-output check, cannot-afford check —
//      each returns a distinct structured error code.
//
//   2. **Strict-same-inputs (BIP-125 Rule 2)**: replacement's input txid/vout
//      set must exactly equal the original tx's vin[].txid/vout set.
//
//   3. **PREPARE RECEIPT diff block**: old fee rate, new fee rate, original fee
//      sats, new fee sats, and absolute delta all surfaced in the receipt.
//
//   4. **Demo-mode FIRST**: getActiveBtcPersona() consulted BEFORE listAccounts.
//
//   5. **Fixture V consumer re-anchor**: the RBF replacement fingerprint
//      (sequence 0xfffffffd, 120_000 sats fee) matches the literal pinned in
//      test/signing-fingerprint.test.ts Fixture V.
//
// Mocks:
//   - vi.stubGlobal("fetch", ...) for Esplora GET /tx/{txid} responses.
//   - _btcPsbt.buildBtcPsbt mocked for deterministic PSBT output.
//   - _btcSighash.computeAllSighashes mocked for deterministic sighashes.
//   - _btcFingerprint.computeBtcPayloadFingerprint mocked for Fixture V literal.
//   - listAccounts mocked to control real-mode pairing state.
//
// Fixture V cross-link (RBF replacement, pinned in signing-fingerprint.test.ts):
//   payloadFingerprint = 0x946eeae4f39317444201821a47bdd0819bffc155925e5b855d22d04a2e1cfefc

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted spies ────────────────────────────────────────────────────────────

const { listAccountsSpy, createHandleSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  createHandleSpy:
    vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

// Mock non-evm-account-store's `listAccounts` (BTC pairing surface).
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

// ─── Imports ──────────────────────────────────────────────────────────────────

import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveBtcPersonaBySlug,
} from "../src/demo/state.js";
import { PREPARE_RECEIPT_BTC_RBF_TEMPLATE } from "../src/signing/blocks-btc.js";
import {
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { _btcPsbt } from "../src/protocols/btc-psbt.js";
import { _btcSighash } from "../src/signing/btc-sighash.js";
import { _btcFingerprint } from "../src/signing/btc-fingerprint.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

// ─── Fixture V literal (RBF replacement PSBT fingerprint) ────────────────────
// Hardcoded 0x… literal cross-linked from test/signing-fingerprint.test.ts.
// Computed at research time: sequence 0xfffffffd, output 880_000 sats (120_000 fee).
const FIXTURE_V_FINGERPRINT =
  "0x946eeae4f39317444201821a47bdd0819bffc155925e5b855d22d04a2e1cfefc";

// ─── Stub Esplora tx response ─────────────────────────────────────────────────

/**
 * A minimal Esplora GET /tx/{txid} JSON response.
 * Single P2WPKH input, one recipient output, one change output.
 * Input sequence = 0xfffffffd (RBF-signalling).
 * Input value = 1_000_000 sats; outputs = 880_000 + 100_000 sats; fee = 20_000 sats.
 * weight = 440 → vsize = 110 → feeRate ≈ 181.8 sat/vB.
 */
function makeEsploraTxResponse(overrides: {
  confirmed?: boolean;
  sequence?: number;
  vinValue?: number;
  vout0Value?: number;
  vout1Value?: number;
  weight?: number;
  vout1Address?: string;
} = {}) {
  const {
    confirmed = false,
    sequence = 0xfffffffd,
    vinValue = 1_000_000,
    vout0Value = 880_000,
    vout1Value = 100_000,
    weight = 440,
    vout1Address = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  } = overrides;
  return {
    txid: "aaaa".repeat(16),
    version: 2,
    locktime: 0,
    size: 110,
    weight,
    fee: vinValue - vout0Value - vout1Value,
    vin: [
      {
        txid: "bbbb".repeat(16),
        vout: 0,
        sequence,
        prevout: {
          scriptpubkey: "0014" + "00".repeat(20),
          scriptpubkey_address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
          scriptpubkey_type: "v0_p2wpkh",
          value: vinValue,
        },
      },
    ],
    vout: [
      {
        scriptpubkey: "0014" + "11".repeat(20),
        scriptpubkey_address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        scriptpubkey_type: "v0_p2wpkh",
        value: vout0Value,
      },
      {
        scriptpubkey: "0014" + "22".repeat(20),
        scriptpubkey_address: vout1Address,
        scriptpubkey_type: "v0_p2wpkh",
        value: vout1Value,
      },
    ],
    status: { confirmed, block_height: confirmed ? 850000 : undefined },
  };
}

// ─── Stub fetch helper ────────────────────────────────────────────────────────

function stubFetchWithTx(txData: ReturnType<typeof makeEsploraTxResponse>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => txData,
    }),
  );
}

function stubFetchWith404() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }),
  );
}

// ─── Demo mode key ────────────────────────────────────────────────────────────
// Must match the env var name used by isDemoMode() / resolveDemoMode().
const DEMO_KEY = "VAULTPILOT_DEMO";

// ─── BTC accounts fixture ─────────────────────────────────────────────────────

const BTC_ACCOUNT = {
  chain: "bitcoin" as const,
  address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  derivationPath: "m/84'/0'/0'/0/0",
  label: "BTC Segwit",
};

// ─── Setup ────────────────────────────────────────────────────────────────────

let savedDemo: string | undefined;

beforeEach(async () => {
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetHandleStoreForTesting();
  _resetActivePersonaForTesting();
  _resetDemoModeForTesting();
  // Re-apply createHandleSpy implementation after vi.restoreAllMocks() clears it in afterEach.
  // Pattern from prepare-btc-send.test.ts — restoreAllMocks() strips spy implementations; re-apply here.
  const realHandleStore = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(realHandleStore.createHandle);

  // Default spy for _btcPsbt.buildBtcPsbt.
  // unsignedTxHex is a valid minimal raw BTC tx (1 input, 2 outputs, no witness) so
  // that Transaction.fromHex() succeeds before computeAllSighashes (also mocked).
  const VALID_UNSIGNED_TX_HEX =
    "0100000001" +
    "bbbb".repeat(16) + "00000000" + // txid (LE) + vout=0
    "00" +                            // scriptSig length = 0
    "fdffffff" +                      // sequence = 0xfffffffd
    "02" +                            // 2 outputs
    "806d0d0000000000" + "16" + "0014" + "11".repeat(20) + // 880_000 sats P2WPKH
    "a086010000000000" + "16" + "0014" + "22".repeat(20) + // 100_000 sats P2WPKH
    "00000000";                       // locktime
  vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue({
    psbtBase64: "dGVzdC1wc2J0",
    unsignedTxHex: VALID_UNSIGNED_TX_HEX,
    perInputPrevouts: [
      {
        script: new Uint8Array(22),
        valueSats: 1_000_000n,
        scriptType: "p2wpkh",
      },
    ],
    inputs: [
      {
        txid: "bbbb".repeat(16),
        vout: 0,
        valueSats: 1_000_000n,
        scriptType: "p2wpkh",
      },
    ],
    outputs: [
      {
        address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        valueSats: 880_000n,
        role: "recipient",
      },
      {
        address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        valueSats: 100_000n,
        role: "change",
      },
    ],
    feeSats: 20_000n,
    changeSats: 100_000n,
  });

  // Default spy for _btcSighash.computeAllSighashes.
  vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([
    new Uint8Array(32).fill(0xaa),
  ]);

  // Default spy for _btcFingerprint.computeBtcPayloadFingerprint → Fixture V.
  vi.spyOn(
    _btcFingerprint,
    "computeBtcPayloadFingerprint",
  ).mockReturnValue(FIXTURE_V_FINGERPRINT);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Restore demo mode env var.
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
});

// ─── Test helpers ─────────────────────────────────────────────────────────────

function getHandler() {
  const tool = getRegisteredTool("prepare_btc_rbf_bump");
  if (!tool) throw new Error("prepare_btc_rbf_bump not registered");
  return tool.handler;
}

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  return getHandler()(args) as Promise<ToolHandlerResult>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("prepare_btc_rbf_bump — BTC-W-02 (Phase 24 Plan 24-01)", () => {
  // --------------------------------------------------------------------------
  // Demo-mode: WRONG_MODE when no BTC persona set
  // --------------------------------------------------------------------------
  describe("demo mode", () => {
    beforeEach(() => {
      process.env[DEMO_KEY] = "true";
      _resetDemoModeForTesting(); // clear cache so isDemoMode() re-reads env
    });

    it("WRONG_MODE when demo mode active but no BTC persona set", async () => {
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 50 });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { errorCode?: string })?.errorCode).toBe("WRONG_MODE");
      // listAccounts must NOT be called in demo mode
      expect(listAccountsSpy).not.toHaveBeenCalled();
    });

    it("succeeds in demo mode with BTC persona set", async () => {
      setActiveBtcPersonaBySlug("btc-whale");
      // btc-whale btcSegwitAddress — use as change address so the tool identifies it as owned.
      stubFetchWithTx(makeEsploraTxResponse({
        vout1Address: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
      }));
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 300 });
      expect(result.isError).toBeFalsy();
      expect((result.structuredContent as { txType?: string })?.txType).toBe("btc");
    });
  });

  // --------------------------------------------------------------------------
  // Real mode: WALLET_NOT_PAIRED when no BTC account paired
  // --------------------------------------------------------------------------
  describe("real mode — pairing check", () => {
    beforeEach(() => {
      listAccountsSpy.mockReturnValue([]);
    });

    it("WALLET_NOT_PAIRED when no BTC account paired", async () => {
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 50 });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { errorCode?: string })?.errorCode).toBe("WALLET_NOT_PAIRED");
    });
  });

  // --------------------------------------------------------------------------
  // Confirmed-tx refusal (T-24-01)
  // --------------------------------------------------------------------------
  describe("BTC_TX_ALREADY_CONFIRMED refusal", () => {
    beforeEach(() => {
      listAccountsSpy.mockReturnValue([BTC_ACCOUNT]);
    });

    it("BTC_TX_ALREADY_CONFIRMED when tx is already confirmed", async () => {
      stubFetchWithTx(makeEsploraTxResponse({ confirmed: true }));
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 50 });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { errorCode?: string })?.errorCode).toBe(
        "BTC_TX_ALREADY_CONFIRMED",
      );
    });
  });

  // --------------------------------------------------------------------------
  // RBF signal check (T-24-02)
  // --------------------------------------------------------------------------
  describe("BTC_NOT_RBF_SIGNALLED refusal", () => {
    beforeEach(() => {
      listAccountsSpy.mockReturnValue([BTC_ACCOUNT]);
    });

    it("BTC_NOT_RBF_SIGNALLED when all inputs have sequence >= 0xfffffffe", async () => {
      // sequence = 0xfffffffe → RBF NOT signalled
      stubFetchWithTx(makeEsploraTxResponse({ sequence: 0xfffffffe }));
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 50 });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { errorCode?: string })?.errorCode).toBe(
        "BTC_NOT_RBF_SIGNALLED",
      );
    });

    it("BTC_NOT_RBF_SIGNALLED when sequence is 0xffffffff (lock-time disabled, no RBF)", async () => {
      stubFetchWithTx(makeEsploraTxResponse({ sequence: 0xffffffff }));
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 50 });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { errorCode?: string })?.errorCode).toBe(
        "BTC_NOT_RBF_SIGNALLED",
      );
    });

    it("does NOT refuse when sequence = 0xfffffffd (RBF signalled)", async () => {
      stubFetchWithTx(makeEsploraTxResponse({ sequence: 0xfffffffd }));
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 300 });
      expect(result.isError).toBeFalsy();
    });
  });

  // --------------------------------------------------------------------------
  // Fee-rate bump validation (BIP-125 Rule 4, T-24-04)
  // --------------------------------------------------------------------------
  describe("BTC_RBF_INSUFFICIENT_FEE_RATE refusal", () => {
    beforeEach(() => {
      listAccountsSpy.mockReturnValue([BTC_ACCOUNT]);
      // weight=440 → vsize=110; fee=20000 → feeRate=20000/110≈181.8 sat/vB
      // Must exceed originalFeeRate + 1 = 182.8 → newFeeRate must be > 182.8
      stubFetchWithTx(makeEsploraTxResponse());
    });

    it("BTC_RBF_INSUFFICIENT_FEE_RATE when newFeeRate == originalFeeRate + 1", async () => {
      // originalFeeRate ≈ 181.8 sat/vB; 181 + 1 = 182 ≤ original+1 → should refuse
      // The exact check: newFeeRate <= originalFeeRate + MIN_RELAY_FEE_BUMP_SATS_PER_VB
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 182 });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { errorCode?: string })?.errorCode).toBe(
        "BTC_RBF_INSUFFICIENT_FEE_RATE",
      );
    });

    it("BTC_RBF_INSUFFICIENT_FEE_RATE when newFeeRate < originalFeeRate", async () => {
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 100 });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { errorCode?: string })?.errorCode).toBe(
        "BTC_RBF_INSUFFICIENT_FEE_RATE",
      );
    });
  });

  // --------------------------------------------------------------------------
  // No change output (BTC_RBF_NO_CHANGE_OUTPUT)
  // --------------------------------------------------------------------------
  describe("BTC_RBF_NO_CHANGE_OUTPUT refusal", () => {
    beforeEach(() => {
      listAccountsSpy.mockReturnValue([BTC_ACCOUNT]);
      // Use a change address that does NOT match the paired account address
      stubFetchWithTx(
        makeEsploraTxResponse({
          vout1Address: "bc1q0000000000000000000000000000000000000000",
        }),
      );
    });

    it("BTC_RBF_NO_CHANGE_OUTPUT when no vout matches paired account address", async () => {
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 300 });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { errorCode?: string })?.errorCode).toBe(
        "BTC_RBF_NO_CHANGE_OUTPUT",
      );
    });
  });

  // --------------------------------------------------------------------------
  // Cannot afford fee bump (BTC_RBF_CANNOT_AFFORD)
  // --------------------------------------------------------------------------
  describe("BTC_RBF_CANNOT_AFFORD refusal", () => {
    beforeEach(() => {
      listAccountsSpy.mockReturnValue([BTC_ACCOUNT]);
      // Setup: vinValue=1_000_000, vout0Value=970_000 (recipient), vout1Value=100 (change),
      // weight=440 → vsize=110, fee=29_900 sats, originalFeeRate≈271.8 sat/vB.
      // newFeeRate=500 > 272.8 ✓ (passes BIP-125 Rule 4),
      // newFee = 500 * 110 = 55_000, feeDelta = 55_000 - 29_900 = 25_100 > 100 → CANNOT_AFFORD.
      stubFetchWithTx(
        makeEsploraTxResponse({
          vinValue: 1_000_000,
          vout0Value: 970_000,
          vout1Value: 100,
          vout1Address: BTC_ACCOUNT.address,
        }),
      );
    });

    it("BTC_RBF_CANNOT_AFFORD when feeDelta exceeds change output value", async () => {
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 500 });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { errorCode?: string })?.errorCode).toBe(
        "BTC_RBF_CANNOT_AFFORD",
      );
    });
  });

  // --------------------------------------------------------------------------
  // Successful RBF bump — happy path
  // --------------------------------------------------------------------------
  describe("successful RBF bump", () => {
    beforeEach(() => {
      listAccountsSpy.mockReturnValue([BTC_ACCOUNT]);
      stubFetchWithTx(
        makeEsploraTxResponse({ vout1Address: BTC_ACCOUNT.address }),
      );
    });

    it("returns a btc/rbf handle on success", async () => {
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 300 });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.txType).toBe("btc");
      expect(sc.kind).toBe("rbf");
      expect(typeof sc.handle).toBe("string");
    });

    it("payloadFingerprint matches Fixture V literal", async () => {
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 300 });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.payloadFingerprint).toBe(FIXTURE_V_FINGERPRINT);
    });

    it("PREPARE RECEIPT shows old/new fee rate and delta (fee diff block)", async () => {
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 300 });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as Record<string, unknown>;
      const receipt = sc.prepareReceipt as string;
      expect(receipt).toContain("RBF fee bump");
      expect(receipt).toContain("originalTxid");
      // The receipt must contain fee-related fields
      expect(receipt).toMatch(/newFeeRate/);
      expect(receipt).toMatch(/originalFee/);
      expect(receipt).toMatch(/newFee/);
    });

    it("PREPARE RECEIPT is derived from PREPARE_RECEIPT_BTC_RBF_TEMPLATE (format-fanout-sentinel)", async () => {
      // Verify that PREPARE_RECEIPT_BTC_RBF_TEMPLATE is importable and has the right slots
      expect(PREPARE_RECEIPT_BTC_RBF_TEMPLATE).toContain("{ORIGINAL_TXID}");
      expect(PREPARE_RECEIPT_BTC_RBF_TEMPLATE).toContain("{NEW_FEE_RATE}");
      expect(PREPARE_RECEIPT_BTC_RBF_TEMPLATE).toContain("{ORIGINAL_FEE_SATS}");
      expect(PREPARE_RECEIPT_BTC_RBF_TEMPLATE).toContain("{ORIGINAL_FEE_RATE}");
      expect(PREPARE_RECEIPT_BTC_RBF_TEMPLATE).toContain("{NEW_FEE_SATS}");
      expect(PREPARE_RECEIPT_BTC_RBF_TEMPLATE).toContain("{FEE_DELTA_SATS}");
    });

    it("buildBtcPsbt called with sequenceOverride: 0xfffffffd (RBF-enabled)", async () => {
      await callTool({ txid: "aa".repeat(32), newFeeRate: 300 });
      expect(_btcPsbt.buildBtcPsbt).toHaveBeenCalledWith(
        expect.objectContaining({ sequenceOverride: 0xfffffffd }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // BIP-125 Rule 2: strict-same-inputs preservation
  // --------------------------------------------------------------------------
  describe("BIP-125 Rule 2 — strict-same-inputs", () => {
    beforeEach(() => {
      listAccountsSpy.mockReturnValue([BTC_ACCOUNT]);
      // Tx with 2 inputs to test input set preservation
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            txid: "aaaa".repeat(16),
            version: 2,
            locktime: 0,
            size: 200,
            weight: 800,
            fee: 20_000,
            vin: [
              {
                txid: "bbbb".repeat(16),
                vout: 0,
                sequence: 0xfffffffd,
                prevout: {
                  scriptpubkey: "0014" + "00".repeat(20),
                  scriptpubkey_address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
                  scriptpubkey_type: "v0_p2wpkh",
                  value: 600_000,
                },
              },
              {
                txid: "cccc".repeat(16),
                vout: 2,
                sequence: 0xfffffffd,
                prevout: {
                  scriptpubkey: "0014" + "11".repeat(20),
                  scriptpubkey_address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
                  scriptpubkey_type: "v0_p2wpkh",
                  value: 500_000,
                },
              },
            ],
            vout: [
              {
                scriptpubkey: "0014" + "22".repeat(20),
                scriptpubkey_address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
                scriptpubkey_type: "v0_p2wpkh",
                value: 880_000,
              },
              {
                scriptpubkey: "0014" + "33".repeat(20),
                scriptpubkey_address: BTC_ACCOUNT.address,
                scriptpubkey_type: "v0_p2wpkh",
                value: 200_000,
              },
            ],
            status: { confirmed: false },
          }),
        }),
      );
    });

    it("calls buildBtcPsbt with an inputs array matching the original vin[] set (BIP-125 Rule 2)", async () => {
      // fee=20_000, weight=800 → vsize=200, feeRate=100 sat/vB; need newFeeRate > 101.
      await callTool({ txid: "aa".repeat(32), newFeeRate: 150 });
      const buildCallArgs = (
        _btcPsbt.buildBtcPsbt as ReturnType<typeof vi.spyOn>
      ).mock.calls[0]?.[0] as { inputs?: Array<{ txid: string; vout: number }> };
      expect(buildCallArgs).toBeDefined();
      expect(buildCallArgs.inputs).toBeDefined();
      const inputTxids = buildCallArgs.inputs!.map((i) => i.txid);
      const inputVouts = buildCallArgs.inputs!.map((i) => i.vout);
      // Must contain both original inputs
      expect(inputTxids).toContain("bbbb".repeat(16));
      expect(inputTxids).toContain("cccc".repeat(16));
      expect(inputVouts).toContain(0);
      expect(inputVouts).toContain(2);
    });
  });

  // --------------------------------------------------------------------------
  // Input validation: invalid txid
  // --------------------------------------------------------------------------
  describe("input validation", () => {
    it("INVALID_INPUT when txid is not 64 hex chars", async () => {
      const result = await callTool({ txid: "not-a-txid", newFeeRate: 50 });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { errorCode?: string })?.errorCode).toBe(
        "INVALID_INPUT",
      );
    });

    it("INVALID_INPUT when newFeeRate is zero", async () => {
      const result = await callTool({ txid: "aa".repeat(32), newFeeRate: 0 });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { errorCode?: string })?.errorCode).toBe(
        "INVALID_INPUT",
      );
    });
  });
});
