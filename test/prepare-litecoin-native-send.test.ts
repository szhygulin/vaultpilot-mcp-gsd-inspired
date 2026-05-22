// `prepare_litecoin_native_send` end-to-end regression. Phase 26 — Plan 26-02.
//
// Load-bearing invariants:
//
//   1. **Fixture Y consumer re-anchor** — Fixture Y (LTC segwit, single-input,
//      pinned in test/signing-fingerprint.test.ts) is cross-linked HERE. Drift
//      in this tool's sighash preimage assembly surfaces at BOTH files —
//      load-bearing redundancy per CLAUDE.md fixture discipline.
//
//   2. **INVALID_INPUT FIRST** — `to` validated before any state read;
//      demo-mode check + Esplora fetch are NEVER called on an invalid-`to` path.
//
//   3. **PREPARE RECEIPT verbatim** (PREP-02) — receipt reads from raw agent
//      strings (no normalization). Substituted from `PREPARE_RECEIPT_LTC_NATIVE_TEMPLATE`.
//
//   4. **Demo-mode FIRST** — in demo mode, `getActiveLtcPersona()` is
//      consulted BEFORE `listAccounts`. `listAccounts` is NEVER called in
//      demo mode (spy asserts 0 calls).
//
//   5. **LTC_NETWORK passed to buildBtcPsbt** — T-26-09 / Pitfall 2 mitigation.
//      The test spies on `_btcPsbt.buildBtcPsbt` and asserts the `network`
//      field is present in the args.
//
// Mocks:
//   - `vi.stubGlobal("fetch", ...)` for LTC Esplora UTXO + fee-estimate responses.
//   - `_ltcLedgerTransport.fetchLtcAddresses` mocked to return test pubkeys.
//   - `_btcCoinSelect.selectCoinsBnb` mocked to return deterministic selected UTXO set.
//   - `_btcPsbt.buildBtcPsbt` mocked to return deterministic PSBT + prevouts.
//   - `_btcSighash.computeAllSighashes` mocked to return a pinned sighash.
//   - `_ltcFingerprint.computeLtcPayloadFingerprint` mocked to return Fixture Y literal.
//   - `listAccounts` mocked to control real-mode pairing state.
//
// Fixture Y cross-link (LTC segwit single-input, pinned in signing-fingerprint.test.ts):
//   payloadFingerprint = 0x105386cbe7bf6195eb74acd493e3b24213342c679f3e1bb3a6fb54d88073eff4

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted spies ────────────────────────────────────────────────────────────

const { listAccountsSpy, createHandleSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  createHandleSpy:
    vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

// Mock non-evm-account-store's `listAccounts` (LTC pairing surface).
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

import { _ltcLedgerTransport } from "../src/wallet/ledger-btc-transport.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveLtcPersonaBySlug,
} from "../src/demo/state.js";
import { PREPARE_RECEIPT_LTC_NATIVE_TEMPLATE } from "../src/signing/blocks-btc.js";
import {
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { _btcCoinSelect } from "../src/signing/btc-coin-select.js";
import { _btcPsbt } from "../src/protocols/btc-psbt.js";
import { _btcSighash } from "../src/signing/btc-sighash.js";
import { _ltcFingerprint } from "../src/signing/ltc-fingerprint.js";
import { _resetEsploraCacheForTesting } from "../src/chains/litecoin/esplora-client.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

// ─── Helper ───────────────────────────────────────────────────────────────────

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_litecoin_native_send");
  if (!tool) throw new Error("prepare_litecoin_native_send not registered");
  return tool.handler(args);
}

// ─── Fixture constants ────────────────────────────────────────────────────────

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Valid LTC bech32 test addresses (verified valid via bitcoinjs-lib + LTC_NETWORK).
// Primary recipient: arbitrary valid ltc1q address from privKey=0x01 P2WPKH.
const TEST_SEGWIT_TO = "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9";
// Secondary valid address (privKey=0x02 P2WPKH) — used for "from" address tests.
const TEST_SEGWIT_FROM = "ltc1qq6hag67dl53wl99vzg42z8eyzfz2xlkvz9zn23";
const TEST_LITOSHI = "100000";
const TEST_FEE_RATE = 5;

// A canonical paired LTC segwit account (real-mode shape from pair_litecoin_ledger).
const PAIRED_LTC_SEGWIT_ACCOUNT = {
  chain: "litecoin" as const,
  address: TEST_SEGWIT_FROM,
  derivationPath: "84'/2'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

// Test pubkey constants (generator point G, compressed — same as BTC tests).
const TEST_PUBKEY_HEX =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

// Stub fetchLtcAddresses return value — provides test pubkeys without device.
const STUB_FETCH_LTC_ADDRESSES_RESULT = {
  segwit: {
    address: TEST_SEGWIT_FROM,
    publicKey: TEST_PUBKEY_HEX,
    chainCode: "00".repeat(32),
    derivationPath: "84'/2'/0'/0/0",
  },
  appVersion: "2.1.0",
};

// LTC fee-estimates stub — mempool.space shape (litecoinspace.org /v1/fees/recommended).
// DISTINCT from BTC Esplora shape: BTC uses { "1": 20, ... } 24-key map;
// LTC uses { fastestFee, halfHourFee, hourFee, economyFee, minimumFee }.
// Pitfall 1 regression anchor: do NOT use the 24-key Esplora shape here.
const STUB_FEE_ESTIMATES_RESPONSE = {
  fastestFee: 20,
  halfHourFee: 12,
  hourFee: 8,
  economyFee: 5,
  minimumFee: 2,
};

// Stub UTXO response for the LTC segwit address (litecoinspace.org Esplora shape).
const STUB_LTC_UTXOS = [
  {
    txid: "a".repeat(64),
    vout: 0,
    value: 200000,
    status: { confirmed: true, block_height: 3000000 },
  },
];

// Fixture Y fingerprint (LTC segwit single-input) — cross-link from signing-fingerprint.test.ts.
// Drift in LTC sighash preimage assembly MUST fail HERE too (load-bearing redundancy).
const FIXTURE_Y_FINGERPRINT =
  "0x105386cbe7bf6195eb74acd493e3b24213342c679f3e1bb3a6fb54d88073eff4";

// Stub coin-select result (single selected P2WPKH input).
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
  changeSats: BigInt(0),
  feeSats: BigInt(5000),
};

// Stub buildBtcPsbt result.
// unsignedTxHex is a minimal valid segwit transaction parseable by bitcoinjs-lib Transaction.fromHex.
// Uses the same constant as prepare-btc-send.test.ts (same BTC/LTC PSBT codec).
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
  ],
  feeSats: BigInt(5000),
  changeSats: BigInt(0),
};

// A minimal stub sighash (32 bytes).
const STUB_SIGHASH = new Uint8Array(32).fill(0xab);

/**
 * Build a minimal fetch stub for LTC Esplora (litecoinspace.org).
 * Routes on URL pattern: /utxo → UTXO array; /fee-estimates → fee map.
 */
function buildFetchStub(opts?: {
  utxos?: unknown[];
  feeEstimates?: Record<string, number>;
}): typeof fetch {
  const utxos = opts?.utxos ?? STUB_LTC_UTXOS;
  const feeEstimates = opts?.feeEstimates ?? STUB_FEE_ESTIMATES_RESPONSE;

  return vi.fn().mockImplementation((url: string) => {
    // LTC fee endpoint: /v1/fees/recommended (mempool.space shape).
    // NOT /fee-estimates — that 404s on litecoinspace.org (Pitfall 1 regression anchor).
    if (url.includes("/fees/recommended")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(feeEstimates),
        text: () => Promise.resolve(JSON.stringify(feeEstimates)),
      });
    }
    if (url.includes("/utxo")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(utxos),
        text: () => Promise.resolve(JSON.stringify(utxos)),
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
  _resetEsploraCacheForTesting(); // Clear LTC Esplora UTXO/fee caches between tests.
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
// Happy path — real mode, segwit send
// ============================================================================

describe("prepare_litecoin_native_send — happy path (real mode, segwit recipient)", () => {
  it("returns { handle, chain, to, litoshi, inputs, outputs, feeSats, payloadFingerprint, prepareReceipt, txType: 'litecoin' }", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "fetchLtcAddresses").mockResolvedValue(
      STUB_FETCH_LTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue(STUB_COIN_SELECT_OK);
    vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue(STUB_PSBT_RESULT);
    vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([STUB_SIGHASH]);
    vi.spyOn(_ltcFingerprint, "computeLtcPayloadFingerprint").mockReturnValue(
      FIXTURE_Y_FINGERPRINT as `0x${string}`,
    );

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      litoshi: TEST_LITOSHI,
      feeRate: TEST_FEE_RATE,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chain: string;
      to: string;
      litoshi: string;
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
    expect(sc.chain).toBe("litecoin");
    expect(sc.to).toBe(TEST_SEGWIT_TO);
    expect(sc.litoshi).toBe(TEST_LITOSHI);
    expect(Array.isArray(sc.inputs)).toBe(true);
    expect(Array.isArray(sc.outputs)).toBe(true);
    expect(typeof sc.feeSats).toBe("string");

    // Fixture Y cross-link assertion — drift in LTC sighash preimage assembly MUST
    // fail HERE (load-bearing redundancy per CLAUDE.md fixture discipline).
    expect(sc.payloadFingerprint).toBe(FIXTURE_Y_FINGERPRINT);

    expect(typeof sc.prepareReceipt).toBe("string");
    expect(sc.txType).toBe("litecoin");

    // listAccounts was consulted with chainFilter: "litecoin".
    expect(listAccountsSpy).toHaveBeenCalledWith({ chainFilter: "litecoin" });
  });

  it("passes network: LTC_NETWORK to buildBtcPsbt (T-26-09 / Pitfall 2 mitigation)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "fetchLtcAddresses").mockResolvedValue(
      STUB_FETCH_LTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue(STUB_COIN_SELECT_OK);
    const buildSpy = vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue(STUB_PSBT_RESULT);
    vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([STUB_SIGHASH]);
    vi.spyOn(_ltcFingerprint, "computeLtcPayloadFingerprint").mockReturnValue(
      FIXTURE_Y_FINGERPRINT as `0x${string}`,
    );

    await callTool({ to: TEST_SEGWIT_TO, litoshi: TEST_LITOSHI, feeRate: TEST_FEE_RATE });

    expect(buildSpy).toHaveBeenCalledOnce();
    const buildArgs = buildSpy.mock.calls[0][0];
    // The network field MUST be present — its absence defaults to Bitcoin mainnet,
    // which silently produces bc1q addresses (RESEARCH Pitfall 2).
    expect(buildArgs).toHaveProperty("network");
    // LTC_NETWORK has bech32 = "ltc" — assert we pass the right network object.
    const network = buildArgs.network as { bech32?: string } | undefined;
    expect(network?.bech32).toBe("ltc");
  });
});

// ============================================================================
// Happy path — demo mode
// ============================================================================

describe("prepare_litecoin_native_send — demo mode", () => {
  it("succeeds in demo mode using the active LTC persona; listAccounts is NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveLtcPersonaBySlug("ltc-whale");

    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue(STUB_COIN_SELECT_OK);
    vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue(STUB_PSBT_RESULT);
    vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([STUB_SIGHASH]);
    vi.spyOn(_ltcFingerprint, "computeLtcPayloadFingerprint").mockReturnValue(
      FIXTURE_Y_FINGERPRINT as `0x${string}`,
    );

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      litoshi: TEST_LITOSHI,
      feeRate: TEST_FEE_RATE,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { chain: string; txType: string; payloadFingerprint: string };
    expect(sc.chain).toBe("litecoin");
    expect(sc.txType).toBe("litecoin");
    expect(sc.payloadFingerprint).toBe(FIXTURE_Y_FINGERPRINT);

    // listAccounts MUST NOT be called in demo mode (T-26-07 mitigation).
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("refuses (WRONG_MODE) in demo mode when no LTC persona is set", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    // No persona set — _resetActivePersonaForTesting already cleared it.

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      litoshi: TEST_LITOSHI,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Input validation — `to` address
// ============================================================================

describe("prepare_litecoin_native_send — to address validation (INVALID_INPUT FIRST)", () => {
  it("rejects a non-ltc1q address (bc1q)", async () => {
    const result = await callTool({
      to: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      litoshi: TEST_LITOSHI,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    // listAccounts and fetch MUST NOT be called when `to` is invalid.
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("rejects a legacy LTC address (L-prefix)", async () => {
    const result = await callTool({
      to: "LXuMT8GnBtJYiLPaiDPpBNVemSfEPBuHmU",
      litoshi: TEST_LITOSHI,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("rejects an empty string for `to`", async () => {
    const result = await callTool({
      to: "",
      litoshi: TEST_LITOSHI,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("rejects an ltc1q-prefixed address that fails bech32 checksum", async () => {
    // Mutated checksum — starts with ltc1q but is not valid.
    const result = await callTool({
      to: "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kXXXXXX",
      litoshi: TEST_LITOSHI,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

// ============================================================================
// Input validation — `litoshi` amount
// ============================================================================

describe("prepare_litecoin_native_send — litoshi amount validation", () => {
  it("rejects a decimal litoshi string (not an integer)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "fetchLtcAddresses").mockResolvedValue(
      STUB_FETCH_LTC_ADDRESSES_RESULT,
    );

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      litoshi: "0.001",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("rejects a zero litoshi amount (parseTronAmountStrict rejects zero → coin select → dust)", async () => {
    // parseTronAmountStrict(0, 0, "u64") does NOT throw for zero — it parses to 0n.
    // A 0-litoshi send reaches coin selection which refuses with dust error.
    // So the expected code is BTC_DUST_OUTPUT, not INVALID_INPUT.
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "fetchLtcAddresses").mockResolvedValue(
      STUB_FETCH_LTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue({
      kind: "refused" as const,
      reason: "amount 0 is below the dust threshold",
    });

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      litoshi: "0",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("BTC_DUST_OUTPUT");
  });

  it("rejects a non-numeric litoshi string", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      litoshi: "abc",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

// ============================================================================
// Real mode — wallet not paired
// ============================================================================

describe("prepare_litecoin_native_send — real mode, wallet not paired", () => {
  it("returns WALLET_NOT_PAIRED when no LTC account is paired", async () => {
    listAccountsSpy.mockReturnValue([]);
    vi.stubGlobal("fetch", buildFetchStub());

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      litoshi: TEST_LITOSHI,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });
});

// ============================================================================
// UTXO handling
// ============================================================================

describe("prepare_litecoin_native_send — UTXO handling", () => {
  it("returns BTC_NO_UTXOS_AVAILABLE when UTXO fetch returns empty list", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "fetchLtcAddresses").mockResolvedValue(
      STUB_FETCH_LTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub({ utxos: [] }));

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      litoshi: TEST_LITOSHI,
      feeRate: TEST_FEE_RATE,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("BTC_NO_UTXOS_AVAILABLE");
  });

  it("uses utxoOverride when supplied — skips Esplora UTXO fetch", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "fetchLtcAddresses").mockResolvedValue(
      STUB_FETCH_LTC_ADDRESSES_RESULT,
    );
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      // Only /fees/recommended should be called — not UTXO endpoint.
      if (url.includes("/fees/recommended")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(STUB_FEE_ESTIMATES_RESPONSE),
          text: () => Promise.resolve(JSON.stringify(STUB_FEE_ESTIMATES_RESPONSE)),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve(null),
        text: () => Promise.resolve("not found"),
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchSpy);

    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue(STUB_COIN_SELECT_OK);
    vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue(STUB_PSBT_RESULT);
    vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([STUB_SIGHASH]);
    vi.spyOn(_ltcFingerprint, "computeLtcPayloadFingerprint").mockReturnValue(
      FIXTURE_Y_FINGERPRINT as `0x${string}`,
    );

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      litoshi: TEST_LITOSHI,
      feeRate: TEST_FEE_RATE,
      utxoOverride: [
        {
          txid: "a".repeat(64),
          vout: 0,
          valueSats: "200000",
          scriptType: "p2wpkh",
        },
      ],
    });

    expect(result.isError).toBeFalsy();

    // Verify /utxo endpoint was NOT called.
    const utxoCalls = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("/utxo"),
    );
    expect(utxoCalls).toHaveLength(0);
  });
});

// ============================================================================
// Coin selection errors
// ============================================================================

describe("prepare_litecoin_native_send — coin selection errors", () => {
  it("returns BTC_NO_UTXOS_AVAILABLE when coin selection reports insufficient funds", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "fetchLtcAddresses").mockResolvedValue(
      STUB_FETCH_LTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue({
      kind: "refused" as const,
      reason: "insufficient funds to cover amount + fees",
    });

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      litoshi: "99999999999",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("BTC_NO_UTXOS_AVAILABLE");
  });

  it("returns BTC_DUST_OUTPUT when amount is below dust threshold", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "fetchLtcAddresses").mockResolvedValue(
      STUB_FETCH_LTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue({
      kind: "refused" as const,
      reason: "amount is below the dust threshold (330 litoshis)",
    });

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      litoshi: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("BTC_DUST_OUTPUT");
  });
});

// ============================================================================
// PREPARE RECEIPT format verification (PREP-02)
// ============================================================================

describe("prepare_litecoin_native_send — PREPARE RECEIPT format", () => {
  it("text response contains 'PREPARE RECEIPT' and template-substituted values", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_LTC_SEGWIT_ACCOUNT]);
    vi.spyOn(_ltcLedgerTransport, "fetchLtcAddresses").mockResolvedValue(
      STUB_FETCH_LTC_ADDRESSES_RESULT,
    );
    vi.stubGlobal("fetch", buildFetchStub());
    vi.spyOn(_btcCoinSelect, "selectCoinsBnb").mockReturnValue(STUB_COIN_SELECT_OK);
    vi.spyOn(_btcPsbt, "buildBtcPsbt").mockReturnValue(STUB_PSBT_RESULT);
    vi.spyOn(_btcSighash, "computeAllSighashes").mockReturnValue([STUB_SIGHASH]);
    vi.spyOn(_ltcFingerprint, "computeLtcPayloadFingerprint").mockReturnValue(
      FIXTURE_Y_FINGERPRINT as `0x${string}`,
    );

    const result = await callTool({
      to: TEST_SEGWIT_TO,
      litoshi: TEST_LITOSHI,
      feeRate: TEST_FEE_RATE,
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/PREPARE RECEIPT/);
    // Verbatim raw agent string — no normalization.
    expect(text).toMatch(new RegExp(TEST_SEGWIT_TO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(text).toMatch(TEST_LITOSHI);

    // PREPARE RECEIPT template must not contain unsubstituted slots.
    expect(text).not.toMatch(/\{TO\}/);
    expect(text).not.toMatch(/\{LITOSHIS\}/);
    expect(text).not.toMatch(/\{FEE_SATS\}/);
    expect(text).not.toMatch(/\{FEE_RATE\}/);
  });

  it("PREPARE_RECEIPT_LTC_NATIVE_TEMPLATE exists and is non-empty", () => {
    expect(typeof PREPARE_RECEIPT_LTC_NATIVE_TEMPLATE).toBe("string");
    expect(PREPARE_RECEIPT_LTC_NATIVE_TEMPLATE.length).toBeGreaterThan(0);
    // Verify template has the expected LTC-specific slots.
    expect(PREPARE_RECEIPT_LTC_NATIVE_TEMPLATE).toMatch(/\{LITOSHIS\}/);
    expect(PREPARE_RECEIPT_LTC_NATIVE_TEMPLATE).toMatch(/\{TO\}/);
  });
});
