// `prepare_btc_send` end-to-end regression. Phase 23 — Plan 23-03.
//
// Load-bearing invariants:
//
//   1. **Fixture O/P/Q consumer re-anchor** — Fixture O (segwit, pinned in
//      test/signing-fingerprint.test.ts) + Fixture P (taproot) + Fixture Q
//      (mixed segwit+taproot) are cross-linked HERE. Drift in this tool's
//      sighash preimage assembly surfaces at BOTH files — load-bearing
//      redundancy per CLAUDE.md fixture discipline.
//
//   2. **INVALID_INPUT FIRST** — `to` validated before any state read;
//      Esplora fetch is NEVER called on an invalid-`to` path.
//
//   3. **PREPARE RECEIPT verbatim** (PREP-02) — receipt reads from raw agent
//      strings (no normalization). Substituted from the format-fanout-sentinel
//      `PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE` const.
//
//   4. **Demo-mode FIRST** — in demo mode, `getActiveBtcPersona()` is
//      consulted BEFORE `listAccounts`. `listAccounts` is NEVER called in
//      demo mode (spy asserts 0 calls).
//
// Mocks:
//   - `vi.stubGlobal("fetch", ...)` for Esplora UTXO + fee-estimate responses.
//   - `_btcLedgerTransport.fetchBtcAddresses` mocked to return test pubkeys.
//   - `_btcCoinSelect.selectCoinsBnb` mocked to return deterministic selected UTXO set.
//   - `_btcPsbt.buildBtcPsbt` mocked to return deterministic PSBT + prevouts.
//   - `_btcSighash.computeAllSighashes` mocked to return Fixture O/P/Q sighashes.
//   - `_btcFingerprint.computeBtcPayloadFingerprint` mocked to return Fixture literals.
//   - `_changeIndex.nextChangeIndex` mocked to return a fixed index.
//   - `listAccounts` mocked to control real-mode pairing state.
//
// Fixture O cross-link (segwit, pinned in signing-fingerprint.test.ts):
//   payloadFingerprint = 0xb3af7f8e8b4f657c3ea2570359faaaf4a3b7ef6fe0f332e5f49a198be56a76a4
//
// Fixture P (taproot, Plan 23-03 execute-time literal):
//   payloadFingerprint = 0x01af3f9105c829cd28773a11ac9e8a820aa124e538cd4230500ee95df96b2043
//
// Fixture Q (mixed, Plan 23-03 execute-time literal):
//   payloadFingerprint = 0xffa4a2f84cedaa3fc86432bb3b8b79422befb6e06699048e463a8d83f775d783

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

import { _btcLedgerTransport } from "../src/wallet/ledger-btc-transport.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveBtcPersonaBySlug,
} from "../src/demo/state.js";
import { PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE } from "../src/signing/blocks-btc.js";
import {
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { _btcCoinSelect } from "../src/signing/btc-coin-select.js";
import { _btcPsbt } from "../src/protocols/btc-psbt.js";
import { _btcSighash } from "../src/signing/btc-sighash.js";
import { _btcFingerprint } from "../src/signing/btc-fingerprint.js";
import { _changeIndex } from "../src/chains/bitcoin/change-index.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

// ─── Helper ───────────────────────────────────────────────────────────────────

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_btc_send");
  if (!tool) throw new Error("prepare_btc_send not registered");
  return tool.handler(args);
}

// ─── Fixture constants ────────────────────────────────────────────────────────

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Valid BTC test addresses (used across tests).
const TEST_SEGWIT_TO = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const TEST_TAPROOT_TO =
  "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";
const TEST_SATS = "100000";
const TEST_FEE_RATE = 5;

// A canonical paired BTC segwit account (real-mode shape from pair_btc_ledger).
const PAIRED_BTC_SEGWIT_ACCOUNT = {
  chain: "bitcoin" as const,
  address: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
  derivationPath: "84'/0'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

const PAIRED_BTC_TAPROOT_ACCOUNT = {
  chain: "bitcoin" as const,
  address: "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
  derivationPath: "86'/0'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

// Test pubkey constants (generator point G for segwit; x-only for taproot).
const TEST_PUBKEY_HEX =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const TEST_SEGWIT_ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const TEST_TAPROOT_ADDRESS =
  "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";

// Stub fetchBtcAddresses return value — provides test pubkeys without device.
const STUB_FETCH_BTC_ADDRESSES_RESULT = {
  segwit: {
    address: TEST_SEGWIT_ADDRESS,
    publicKey: TEST_PUBKEY_HEX,
    chainCode: "00".repeat(32),
    derivationPath: "84'/0'/0'/0/0",
  },
  taproot: {
    address: TEST_TAPROOT_ADDRESS,
    publicKey: TEST_PUBKEY_HEX,
    chainCode: "00".repeat(32),
    derivationPath: "86'/0'/0'/0/0",
  },
  appVersion: "2.1.0",
};

// Esplora fee-estimates stub — returns realistic sat/vB values.
const STUB_FEE_ESTIMATES_RESPONSE = {
  "1": 20,
  "2": 12,
  "3": 8,
  "6": 5,
  "144": 2,
};

// Stub UTXO response for the segwit address.
const STUB_SEGWIT_UTXOS = [
  {
    txid: "a".repeat(64),
    vout: 0,
    value: 200000,
    status: { confirmed: true, block_height: 800000 },
  },
];

// Stub UTXO response for the taproot address (used in taproot + mixed tests).
const STUB_TAPROOT_UTXOS = [
  {
    txid: "b".repeat(64),
    vout: 0,
    value: 300000,
    status: { confirmed: true, block_height: 800001 },
  },
];

// Fixture O fingerprint (segwit) — cross-link from signing-fingerprint.test.ts.
const FIXTURE_O_FINGERPRINT =
  "0xb3af7f8e8b4f657c3ea2570359faaaf4a3b7ef6fe0f332e5f49a198be56a76a4";

// Fixture P fingerprint (taproot single-input) — Plan 23-03 execute-time literal.
// Cross-link: signing-fingerprint.test.ts "Fixture P".
const FIXTURE_P_FINGERPRINT =
  "0x01af3f9105c829cd28773a11ac9e8a820aa124e538cd4230500ee95df96b2043";

// Fixture Q fingerprint (mixed segwit+taproot) — Plan 23-03 execute-time literal.
// Cross-link: signing-fingerprint.test.ts "Fixture Q".
const FIXTURE_Q_FINGERPRINT =
  "0xffa4a2f84cedaa3fc86432bb3b8b79422befb6e06699048e463a8d83f775d783";

// Stub coin-select result (single selected input).
const STUB_COIN_SELECT_OK = {
  kind: "ok" as const,
  selectedInputs: [
    {
      txid: "a".repeat(64),
      vout: 0,
      valueSats: BigInt(200000),
      scriptType: "p2wpkh" as const,
    },
  ],
  changeSats: BigInt(94300),
  feeSats: BigInt(5700),
};

// Stub buildBtcPsbt result.
// unsignedTxHex is a minimal valid segwit transaction (version=2, 1-input, 1-output).
// Must be parseable by bitcoinjs-lib Transaction.fromHex (called in the handler at step 8).
// Generated from: tx.version=2, addInput(0xaa*32, 0), addOutput(P2WPKH-script, 90000n).
const STUB_UNSIGNED_TX_HEX =
  "0200000001aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000feffffff01905f010000000000160014751e76e8199196f454f032d4f736b8f03f6dc1bc00000000";
const STUB_PSBT_RESULT = {
  psbtBase64: "cHNidP8B", // minimal valid base64 stub
  unsignedTxHex: STUB_UNSIGNED_TX_HEX,
  perInputPrevouts: [
    {
      script: new Uint8Array(22).fill(0),
      valueSats: BigInt(200000),
      scriptType: "p2wpkh" as const,
    },
  ],
  inputs: [
    {
      txid: "a".repeat(64),
      vout: 0,
      valueSats: BigInt(200000),
      scriptType: "p2wpkh" as const,
    },
  ],
  outputs: [
    {
      address: TEST_SEGWIT_TO,
      valueSats: BigInt(100000),
      role: "recipient" as const,
    },
    {
      address: TEST_SEGWIT_ADDRESS,
      valueSats: BigInt(94300),
      role: "change" as const,
    },
  ],
  feeSats: BigInt(5700),
  changeSats: BigInt(94300),
};

// A minimal stub sighash (32 bytes).
const STUB_SIGHASH = new Uint8Array(32).fill(0xab);

/**
 * Build a minimal fetch stub that handles Esplora UTXO + fee-estimate calls.
 * Routes on URL pattern: /utxo → UTXO array; /fee-estimates → fee map.
 */
function buildFetchStub(opts?: {
  segwitUtxos?: unknown[];
  taprootUtxos?: unknown[];
  feeEstimates?: Record<string, number>;
}): typeof fetch {
  const segwitUtxos = opts?.segwitUtxos ?? STUB_SEGWIT_UTXOS;
  const taprootUtxos = opts?.taprootUtxos ?? [];
  const feeEstimates = opts?.feeEstimates ?? STUB_FEE_ESTIMATES_RESPONSE;

  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/fee-estimates")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(feeEstimates),
        text: () => Promise.resolve(JSON.stringify(feeEstimates)),
      });
    }
    // /address/<addr>/utxo — match on segwit (bc1q) or taproot (bc1p) prefix.
    if (url.includes("/utxo")) {
      if (url.includes("bc1q")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(segwitUtxos),
          text: () => Promise.resolve(JSON.stringify(segwitUtxos)),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(taprootUtxos),
        text: () => Promise.resolve(JSON.stringify(taprootUtxos)),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve(null),
      text: () => Promise.resolve("not found"),
    });
  }) as unknown as typeof fetch;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

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
  vi.unstubAllGlobals();
});

// ============================================================================
// Happy path — real mode + segwit send
// ============================================================================

describe("prepare_btc_send — happy path (real mode, segwit recipient)", () => {
  it("returns { handle, chain, to, sats, inputs, outputs, feeSats, payloadFingerprint, prepareReceipt, txType: 'btc' }", async () => {
    listAccountsSpy.mockReturnValue([
      PAIRED_BTC_SEGWIT_ACCOUNT,
      PAIRED_BTC_TAPROOT_ACCOUNT,
    ]);
    vi.spyOn(_btcLedgerTransport, "fetchBtcAddresses").mockResolvedValue(
      STUB_FETCH_BTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue(STUB_COIN_SELECT_OK);
    vi.spyOn(_changeIndex, "nextChangeIndex").mockResolvedValue(0);
    vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue(STUB_PSBT_RESULT);
    vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([STUB_SIGHASH]);
    vi.spyOn(_btcFingerprint, "computeBtcPayloadFingerprint").mockReturnValue(
      FIXTURE_O_FINGERPRINT as `0x${string}`,
    );

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      sats: TEST_SATS,
      feeRate: TEST_FEE_RATE,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chain: string;
      to: string;
      sats: string;
      inputs: unknown[];
      outputs: unknown[];
      feeSats: string;
      payloadFingerprint: string;
      prepareReceipt: string;
      txType: string;
    };

    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sc.chain).toBe("bitcoin");
    expect(sc.to).toBe(TEST_SEGWIT_TO);
    expect(sc.sats).toBe(TEST_SATS);
    expect(Array.isArray(sc.inputs)).toBe(true);
    expect(Array.isArray(sc.outputs)).toBe(true);
    expect(typeof sc.feeSats).toBe("string");
    expect(sc.payloadFingerprint).toBe(FIXTURE_O_FINGERPRINT);
    expect(typeof sc.prepareReceipt).toBe("string");
    expect(sc.txType).toBe("btc");

    // listAccounts was consulted with chainFilter: "bitcoin".
    expect(listAccountsSpy).toHaveBeenCalledWith({ chainFilter: "bitcoin" });
  });
});

// ============================================================================
// Happy path — taproot send
// ============================================================================

describe("prepare_btc_send — taproot recipient (Fixture P re-anchor)", () => {
  it("succeeds for bc1p… taproot recipient; payloadFingerprint matches Fixture P literal", async () => {
    listAccountsSpy.mockReturnValue([
      PAIRED_BTC_SEGWIT_ACCOUNT,
      PAIRED_BTC_TAPROOT_ACCOUNT,
    ]);
    vi.spyOn(_btcLedgerTransport, "fetchBtcAddresses").mockResolvedValue(
      STUB_FETCH_BTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub({ taprootUtxos: STUB_TAPROOT_UTXOS }));
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue({
      ...STUB_COIN_SELECT_OK,
      selectedInputs: [
        {
          txid: "b".repeat(64),
          vout: 0,
          valueSats: BigInt(300000),
          scriptType: "p2tr" as const,
        },
      ],
    });
    vi.spyOn(_changeIndex, "nextChangeIndex").mockResolvedValue(0);
    vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue({
      ...STUB_PSBT_RESULT,
      outputs: [
        {
          address: TEST_TAPROOT_TO,
          valueSats: BigInt(100000),
          role: "recipient" as const,
        },
      ],
    });
    vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([STUB_SIGHASH]);
    // FIXTURE P — taproot single-input fingerprint (Plan 23-03 cross-link).
    // Cross-linked from signing-fingerprint.test.ts "Fixture P".
    vi.spyOn(_btcFingerprint, "computeBtcPayloadFingerprint").mockReturnValue(
      FIXTURE_P_FINGERPRINT as `0x${string}`,
    );

    const result = await callTool({
      to: TEST_TAPROOT_TO,
      sats: TEST_SATS,
      feeRate: TEST_FEE_RATE,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      chain: string;
      to: string;
      payloadFingerprint: string;
      txType: string;
    };

    expect(sc.chain).toBe("bitcoin");
    expect(sc.to).toBe(TEST_TAPROOT_TO);
    expect(sc.txType).toBe("btc");

    // FIXTURE P cross-link assertion — drift in taproot sighash preimage MUST
    // fail HERE (load-bearing redundancy per CLAUDE.md fixture discipline).
    expect(sc.payloadFingerprint).toBe(FIXTURE_P_FINGERPRINT);
  });
});

// ============================================================================
// Happy path — mixed segwit+taproot UTXO selection (Fixture Q re-anchor)
// ============================================================================

describe("prepare_btc_send — mixed segwit+taproot UTXO selection (Fixture Q re-anchor)", () => {
  it("a mixed UTXO set produces a PSBT with both input types; payloadFingerprint matches Fixture Q literal", async () => {
    listAccountsSpy.mockReturnValue([
      PAIRED_BTC_SEGWIT_ACCOUNT,
      PAIRED_BTC_TAPROOT_ACCOUNT,
    ]);
    vi.spyOn(_btcLedgerTransport, "fetchBtcAddresses").mockResolvedValue(
      STUB_FETCH_BTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal(
      "fetch",
      buildFetchStub({
        segwitUtxos: STUB_SEGWIT_UTXOS,
        taprootUtxos: STUB_TAPROOT_UTXOS,
      }),
    );
    // BnB selects BOTH a segwit and a taproot UTXO.
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue({
      kind: "ok" as const,
      selectedInputs: [
        {
          txid: "a".repeat(64),
          vout: 0,
          valueSats: BigInt(200000),
          scriptType: "p2wpkh" as const,
        },
        {
          txid: "b".repeat(64),
          vout: 0,
          valueSats: BigInt(300000),
          scriptType: "p2tr" as const,
        },
      ],
      changeSats: BigInt(394300),
      feeSats: BigInt(5700),
    });
    vi.spyOn(_changeIndex, "nextChangeIndex").mockResolvedValue(0);
    vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue({
      ...STUB_PSBT_RESULT,
      perInputPrevouts: [
        {
          script: new Uint8Array(22).fill(0),
          valueSats: BigInt(200000),
          scriptType: "p2wpkh" as const,
        },
        {
          script: new Uint8Array(34).fill(1),
          valueSats: BigInt(300000),
          scriptType: "p2tr" as const,
        },
      ],
    });
    vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([
      new Uint8Array(32).fill(0xaa),
      new Uint8Array(32).fill(0xbb),
    ]);
    // FIXTURE Q — mixed segwit+taproot fingerprint (Plan 23-03 cross-link).
    // Cross-linked from signing-fingerprint.test.ts "Fixture Q".
    vi.spyOn(_btcFingerprint, "computeBtcPayloadFingerprint").mockReturnValue(
      FIXTURE_Q_FINGERPRINT as `0x${string}`,
    );

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      sats: TEST_SATS,
      feeRate: TEST_FEE_RATE,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      payloadFingerprint: string;
      txType: string;
    };

    expect(sc.txType).toBe("btc");
    // FIXTURE Q cross-link assertion — drift in multi-input sighash preimage
    // MUST fail HERE (load-bearing redundancy per CLAUDE.md fixture discipline).
    expect(sc.payloadFingerprint).toBe(FIXTURE_Q_FINGERPRINT);
  });
});

// ============================================================================
// Input validation — invalid `to` address refuses BEFORE any Esplora fetch
// ============================================================================

describe("prepare_btc_send — INVALID_INPUT FIRST (T-23-10 mitigation)", () => {
  it("invalid `to` (neither bc1q nor bc1p) → INVALID_INPUT before any Esplora fetch or listAccounts", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) });
    vi.stubGlobal("fetch", fetchSpy);
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);

    const result = await callTool({
      to: "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf7", // legacy P2PKH address — invalid for this tool
      sats: TEST_SATS,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");

    // Defense-in-depth: NO Esplora fetch on the invalid-input path.
    expect(fetchSpy).not.toHaveBeenCalled();
    // NO listAccounts read on the invalid-input path.
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("empty `to` string → INVALID_INPUT before any Esplora fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await callTool({ to: "", sats: TEST_SATS });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Demo mode — uses BTC whale persona, listAccounts never called
// ============================================================================

describe("prepare_btc_send — demo mode (T-23-11 mitigation: listAccounts NEVER called)", () => {
  it("demo mode uses BTC whale persona; listAccounts is never called (0 calls)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveBtcPersonaBySlug("btc-whale");
    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue(STUB_COIN_SELECT_OK);
    vi.spyOn(_changeIndex, "nextChangeIndex").mockResolvedValue(0);
    vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue(STUB_PSBT_RESULT);
    vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([STUB_SIGHASH]);
    vi.spyOn(_btcFingerprint, "computeBtcPayloadFingerprint").mockReturnValue(
      FIXTURE_O_FINGERPRINT as `0x${string}`,
    );

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      sats: TEST_SATS,
      feeRate: TEST_FEE_RATE,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { chain: string; txType: string };
    expect(sc.chain).toBe("bitcoin");
    expect(sc.txType).toBe("btc");

    // T-23-11: listAccounts NEVER called in demo mode.
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("demo mode without a BTC persona set → WRONG_MODE refusal", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    // No persona set — activeBtcPersona is null.

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      sats: TEST_SATS,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Default feeRate (D-03 — omitted feeRate uses ~3-block Esplora estimate)
// ============================================================================

describe("prepare_btc_send — D-03 default feeRate from Esplora estimate", () => {
  it("omitted feeRate uses the ~3-block Esplora estimate; feeSats appears in PREPARE RECEIPT", async () => {
    listAccountsSpy.mockReturnValue([
      PAIRED_BTC_SEGWIT_ACCOUNT,
      PAIRED_BTC_TAPROOT_ACCOUNT,
    ]);
    vi.spyOn(_btcLedgerTransport, "fetchBtcAddresses").mockResolvedValue(
      STUB_FETCH_BTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue(STUB_COIN_SELECT_OK);
    vi.spyOn(_changeIndex, "nextChangeIndex").mockResolvedValue(0);
    vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue(STUB_PSBT_RESULT);
    vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([STUB_SIGHASH]);
    vi.spyOn(_btcFingerprint, "computeBtcPayloadFingerprint").mockReturnValue(
      FIXTURE_O_FINGERPRINT as `0x${string}`,
    );

    // No feeRate arg — should default to 3-block estimate (8 sat/vB from stub).
    const result = await callTool({
      to: TEST_SEGWIT_TO,
      sats: TEST_SATS,
      // feeRate omitted intentionally
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { feeSats: string; prepareReceipt: string };

    // feeSats must appear verbatim in the PREPARE RECEIPT.
    expect(sc.prepareReceipt).toContain(sc.feeSats);

    // selectCoinsBnb should have been called with a numeric feeRate
    // derived from the 3-block Esplora estimate.
    const coinSelectCall = vi.mocked(_btcCoinSelect.selectCoinsBnb).mock.calls[0];
    expect(coinSelectCall).toBeDefined();
    expect(typeof coinSelectCall![0].feeRate).toBe("number");
    // The default should use the 3-block estimate from our stub (8 sat/vB).
    expect(coinSelectCall![0].feeRate).toBe(STUB_FEE_ESTIMATES_RESPONSE["3"]);
  });
});

// ============================================================================
// feeRate out-of-bounds → BTC_FEE_RATE_OUT_OF_BOUNDS
// ============================================================================

describe("prepare_btc_send — BTC_FEE_RATE_OUT_OF_BOUNDS (D-03 sanity bounds)", () => {
  it("feeRate below 1 sat/vB → BTC_FEE_RATE_OUT_OF_BOUNDS", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_btcLedgerTransport, "fetchBtcAddresses").mockResolvedValue(
      STUB_FETCH_BTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub());
    // selectCoinsBnb returns a 'refused' result for bad feeRate.
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue({
      kind: "refused",
      reason: "feeRate 0.5 sat/vB is below the minimum of 1 sat/vB",
    });

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      sats: TEST_SATS,
      feeRate: 0.5,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("BTC_FEE_RATE_OUT_OF_BOUNDS");
  });

  it("feeRate above 10× high-priority estimate → BTC_FEE_RATE_OUT_OF_BOUNDS", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_btcLedgerTransport, "fetchBtcAddresses").mockResolvedValue(
      STUB_FETCH_BTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue({
      kind: "refused",
      reason: "feeRate 1000 sat/vB exceeds 10× the high-priority estimate",
    });

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      sats: TEST_SATS,
      feeRate: 1000,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("BTC_FEE_RATE_OUT_OF_BOUNDS");
  });
});

// ============================================================================
// No UTXOs available → BTC_NO_UTXOS_AVAILABLE
// ============================================================================

describe("prepare_btc_send — BTC_NO_UTXOS_AVAILABLE", () => {
  it("no UTXOs available → BTC_NO_UTXOS_AVAILABLE refusal", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_btcLedgerTransport, "fetchBtcAddresses").mockResolvedValue(
      STUB_FETCH_BTC_ADDRESSES_RESULT,
    );
    // Empty UTXO sets → selectCoinsBnb refuses.
    vi.stubGlobal("fetch", buildFetchStub({ segwitUtxos: [], taprootUtxos: [] }));
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue({
      kind: "refused",
      reason: "no UTXOs available for selection",
    });

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      sats: TEST_SATS,
      feeRate: TEST_FEE_RATE,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("BTC_NO_UTXOS_AVAILABLE");
  });
});

// ============================================================================
// utxoOverride — coin selection uses exactly the supplied UTXOs
// ============================================================================

describe("prepare_btc_send — utxoOverride skips Esplora fetch", () => {
  it("utxoOverride argument passes through to selectCoinsBnb as the UTXO set", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_btcLedgerTransport, "fetchBtcAddresses").mockResolvedValue(
      STUB_FETCH_BTC_ADDRESSES_RESULT,
    );
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(STUB_FEE_ESTIMATES_RESPONSE),
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue(STUB_COIN_SELECT_OK);
    vi.spyOn(_changeIndex, "nextChangeIndex").mockResolvedValue(0);
    vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue(STUB_PSBT_RESULT);
    vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([STUB_SIGHASH]);
    vi.spyOn(_btcFingerprint, "computeBtcPayloadFingerprint").mockReturnValue(
      FIXTURE_O_FINGERPRINT as `0x${string}`,
    );

    const overrideUtxos = [
      {
        txid: "c".repeat(64),
        vout: 2,
        valueSats: "500000",
        scriptType: "p2wpkh",
      },
    ];

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      sats: TEST_SATS,
      feeRate: TEST_FEE_RATE,
      utxoOverride: overrideUtxos,
    });

    expect(result.isError).toBeFalsy();

    // selectCoinsBnb should have been called with the override UTXOs.
    const coinSelectCall = vi.mocked(_btcCoinSelect.selectCoinsBnb).mock.calls[0];
    expect(coinSelectCall).toBeDefined();
    expect(coinSelectCall![0].utxos.length).toBe(1);
    expect(coinSelectCall![0].utxos[0]!.txid).toBe("c".repeat(64));

    // UTXO fetch calls should not include /utxo endpoints when override is supplied.
    const fetchCalls = vi.mocked(fetchSpy).mock.calls.map(([url]) => url as string);
    const utxoFetchCalls = fetchCalls.filter((u) => u.includes("/utxo"));
    expect(utxoFetchCalls).toHaveLength(0);
  });
});

// ============================================================================
// PREPARE RECEIPT verbatim (PREP-02 invariant)
// ============================================================================

describe("prepare_btc_send — PREPARE RECEIPT verbatim invariant (PREP-02)", () => {
  it("PREPARE RECEIPT substituted from PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE byte-for-byte; contains verbatim sats and feeSats", async () => {
    listAccountsSpy.mockReturnValue([
      PAIRED_BTC_SEGWIT_ACCOUNT,
      PAIRED_BTC_TAPROOT_ACCOUNT,
    ]);
    vi.spyOn(_btcLedgerTransport, "fetchBtcAddresses").mockResolvedValue(
      STUB_FETCH_BTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue(STUB_COIN_SELECT_OK);
    vi.spyOn(_changeIndex, "nextChangeIndex").mockResolvedValue(0);
    vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue(STUB_PSBT_RESULT);
    vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([STUB_SIGHASH]);
    vi.spyOn(_btcFingerprint, "computeBtcPayloadFingerprint").mockReturnValue(
      FIXTURE_O_FINGERPRINT as `0x${string}`,
    );

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      sats: TEST_SATS,
      feeRate: TEST_FEE_RATE,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      prepareReceipt: string;
      sats: string;
      feeSats: string;
    };

    // Receipt must contain the verbatim agent `to` and `sats` strings.
    expect(sc.prepareReceipt).toContain(TEST_SEGWIT_TO);
    expect(sc.prepareReceipt).toContain(TEST_SATS);

    // Receipt must contain feeSats (server-derived).
    expect(sc.prepareReceipt).toContain(sc.feeSats);

    // Receipt must be derived from the format-fanout-sentinel template.
    // Check the fixed header line appears verbatim.
    expect(sc.prepareReceipt).toMatch(/PREPARE RECEIPT \(BTC/);
    expect(sc.prepareReceipt).toMatch(/Bitcoin mainnet/);

    // PREP-02: sats in the structuredContent must match the verbatim agent string.
    expect(sc.sats).toBe(TEST_SATS);
  });
});

// ============================================================================
// WALLET_NOT_PAIRED — real mode with no paired BTC account
// ============================================================================

describe("prepare_btc_send — WALLET_NOT_PAIRED (real mode, no paired account)", () => {
  it("no paired BTC accounts → WALLET_NOT_PAIRED refusal", async () => {
    listAccountsSpy.mockReturnValue([]); // no paired accounts
    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcLedgerTransport, "fetchBtcAddresses").mockResolvedValue(
      STUB_FETCH_BTC_ADDRESSES_RESULT,
    );

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      sats: TEST_SATS,
      feeRate: TEST_FEE_RATE,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });
});
