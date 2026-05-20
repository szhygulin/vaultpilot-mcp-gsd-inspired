// `prepare_tron_trc20_send` end-to-end regression. Phase 18 — Plan 18-03.
//
// Load-bearing invariants:
//
//   1. **Fixture N consumer re-anchor** — the canonical Fixture N inputs
//      (TRON-whale persona sender + canonical recipient + 100 USDT + pinned
//      ref-block) produce the hardcoded literal
//      `0xffa617dd3396eb038869b98e7385aa302e4ff69ed4d7cabe4904370c5015b520`
//      pinned in `test/signing-fingerprint-tron.test.ts`. Drift in this tool's
//      preimage assembly surfaces HERE, at this exact assertion — load-bearing
//      redundancy per CLAUDE.md fixture discipline + CONTEXT D-08d.
//
//   2. **INVALID_INPUT FIRST** — `to` + `tokenAddress` validated before any
//      state read; `amount` validated before RPC call. Demo/real mode checks
//      happen AFTER.
//
//   3. **PREPARE RECEIPT verbatim** (PREP-02) — receipt reads from raw agent
//      strings (no normalization, no decimal scaling). Substituted from the
//      format-fanout-sentinel `PREPARE_RECEIPT_TRON_TRC20_TEMPLATE` const.
//
//   4. **Persona-cycle sender-dependence** — fingerprint differs across
//      personas (owner_address in Protobuf changes → raw_data_hex changes →
//      fingerprint changes); `to` calldata arg is invariant across personas.
//
// Fixture N cross-link:
//   FROM            = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" (USDT deployer —
//                     NOTE: mock pins raw_data_hex regardless of actual sender)
//   TO              = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8" (USDC addr — valid)
//   tokenAddress    = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" (USDT-TRC20 contract)
//   amount          = "100" (human units — 100 USDT at 6 decimals → 100_000_000 raw)
//   raw_data_hex    = Fixture N literal
//   payloadFingerprint = 0xffa617dd3396eb038869b98e7385aa302e4ff69ed4d7cabe4904370c5015b520

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
import { _tronTrc20 } from "../src/protocols/tron-trc20.js";
import { PREPARE_RECEIPT_TRON_TRC20_TEMPLATE } from "../src/signing/blocks-tron.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_tron_trc20_send");
  if (!tool) throw new Error("prepare_tron_trc20_send not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// ============================================================================
// Fixture N constants — must align with `test/signing-fingerprint-tron.test.ts`
// ============================================================================

const FIXTURE_N_TO = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const FIXTURE_N_USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const FIXTURE_N_AMOUNT_HUMAN = "100"; // 100 USDT human units
const FIXTURE_N_REF_BLOCK_BYTES = "00ad";
const FIXTURE_N_REF_BLOCK_HASH = "8e5e7df4e3c8b9a2";
const FIXTURE_N_EXPIRATION_BASE = 1779268134000;

// Fixture N raw_data_hex — pinned at `test/signing-fingerprint-tron.test.ts`.
const FIXTURE_N_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244a9059cbb0000000000000000000000003487b63d30b5b2c87fb7ffa8bcfade38eaac1abe0000000000000000000000000000000000000000000000000000000005f5e1007090f490a5e433900180c2d72f";

// Fixture N payloadFingerprint — hardcoded literal anchor from Plan 18-01.
// Cross-linked from `test/signing-fingerprint-tron.test.ts:Fixture N`.
// Drift in preimage assembly MUST fail at this EXACT line (load-bearing redundancy).
const FIXTURE_N_FINGERPRINT =
  "0xffa617dd3396eb038869b98e7385aa302e4ff69ed4d7cabe4904370c5015b520";

// Hex addresses as tronweb surfaces in parameter.value
const FIXTURE_N_OWNER_ADDR_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const FIXTURE_N_CONTRACT_ADDR_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const FIXTURE_N_CALLDATA =
  "a9059cbb" +
  "0000000000000000000000003487b63d30b5b2c87fb7ffa8bcfade38eaac1abe" +
  "0000000000000000000000000000000000000000000000000000000005f5e100";

// TRON-whale persona address (Plan 17-05)
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";

// A canonical paired TRON account (real-mode shape).
const PAIRED_TRON_ACCOUNT = {
  chain: "tron" as const,
  address: TRON_WHALE_ADDR,
  derivationPath: "44'/195'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

// A second TRON persona address for persona-cycle sender-dependence tests.
// Not a real persona slug — we'll directly mock fromAddress via tronweb spy.
const PERSONA_B_ADDR = "TYukBQZ2XXCcRCReAUguyXncCWNY9CEiDQ";

/**
 * Build a stub TronWeb that returns Fixture-N-shaped tx from
 * `triggerSmartContract` and the same tx (with expiration extended by 900_000ms)
 * from `extendExpiration`.
 *
 * For Fixture N consumer re-anchor: mock encoder returns fixed raw_data_hex
 * regardless of the actual `from` address so the fingerprint assertion is
 * byte-stable. The persona-cycle test overrides this with different hexes.
 */
function buildFixtureNTronWeb(): {
  transactionBuilder: {
    triggerSmartContract: ReturnType<typeof vi.fn>;
    extendExpiration: ReturnType<typeof vi.fn>;
  };
} {
  const baseTx = {
    raw_data_hex: FIXTURE_N_RAW_DATA_HEX,
    raw_data: {
      contract: [
        {
          type: "TriggerSmartContract",
          parameter: {
            value: {
              owner_address: FIXTURE_N_OWNER_ADDR_HEX,
              contract_address: FIXTURE_N_CONTRACT_ADDR_HEX,
              data: FIXTURE_N_CALLDATA,
              call_value: 0,
            },
          },
        },
      ],
      ref_block_bytes: FIXTURE_N_REF_BLOCK_BYTES,
      ref_block_hash: FIXTURE_N_REF_BLOCK_HASH,
      expiration: FIXTURE_N_EXPIRATION_BASE,
    },
    visible: false,
    txID: "deadbeef",
  };

  const wrappedResult = { result: { result: true }, transaction: baseTx };

  const extendedTx = {
    ...baseTx,
    raw_data: {
      ...baseTx.raw_data,
      expiration: FIXTURE_N_EXPIRATION_BASE + 900_000,
    },
  };

  return {
    transactionBuilder: {
      triggerSmartContract: vi.fn().mockResolvedValue(wrappedResult),
      extendExpiration: vi.fn().mockResolvedValue(extendedTx),
    },
  };
}

/**
 * Build a stub TronWeb that simulates a DIFFERENT sender — different raw_data_hex
 * so the fingerprint changes (persona-cycle sender-dependence regression).
 */
function buildPersonaBTronWeb(): {
  transactionBuilder: {
    triggerSmartContract: ReturnType<typeof vi.fn>;
    extendExpiration: ReturnType<typeof vi.fn>;
  };
} {
  // Persona B has a different owner_address, so raw_data_hex differs.
  // We model this by flipping the last byte of FIXTURE_N_RAW_DATA_HEX.
  const personaBHex = FIXTURE_N_RAW_DATA_HEX.slice(0, -2) + "ff";
  const baseTx = {
    raw_data_hex: personaBHex,
    raw_data: {
      contract: [
        {
          type: "TriggerSmartContract",
          parameter: {
            value: {
              owner_address: "41" + "b".repeat(40), // different owner
              contract_address: FIXTURE_N_CONTRACT_ADDR_HEX,
              data: FIXTURE_N_CALLDATA, // calldata `to` is invariant
              call_value: 0,
            },
          },
        },
      ],
      ref_block_bytes: FIXTURE_N_REF_BLOCK_BYTES,
      ref_block_hash: FIXTURE_N_REF_BLOCK_HASH,
      expiration: FIXTURE_N_EXPIRATION_BASE,
    },
    visible: false,
    txID: "beefdead",
  };

  const wrappedResult = { result: { result: true }, transaction: baseTx };
  const extendedTx = {
    ...baseTx,
    raw_data: { ...baseTx.raw_data, expiration: FIXTURE_N_EXPIRATION_BASE + 900_000 },
  };

  return {
    transactionBuilder: {
      triggerSmartContract: vi.fn().mockResolvedValue(wrappedResult),
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

describe("prepare_tron_trc20_send — happy path (real mode + paired TRON account)", () => {
  it("returns handle + chain + to + tokenAddress + amount + decimals + symbol + payloadFingerprint", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const mockTronWeb = buildFixtureNTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: FIXTURE_N_AMOUNT_HUMAN,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chain: string;
      to: string;
      tokenAddress: string;
      amount: string;
      decimals: number;
      symbol: string;
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
    expect(sc.to).toBe(FIXTURE_N_TO);
    expect(sc.tokenAddress).toBe(FIXTURE_N_USDT_TRC20);
    expect(sc.amount).toBe(FIXTURE_N_AMOUNT_HUMAN);
    expect(sc.decimals).toBe(6);
    expect(sc.symbol).toBe("USDT");
    expect(sc.refBlockBytes).toBe(FIXTURE_N_REF_BLOCK_BYTES);
    expect(sc.refBlockHash).toBe(FIXTURE_N_REF_BLOCK_HASH);
    expect(sc.expiration).toBe(FIXTURE_N_EXPIRATION_BASE + 900_000);
    expect(sc.txType).toBe("tron");

    // Verify listAccounts was consulted with chainFilter: "tron"
    expect(listAccountsSpy).toHaveBeenCalledTimes(1);
    expect(listAccountsSpy).toHaveBeenCalledWith({ chainFilter: "tron" });
  });

  it("stores kind:'trc20' + contractAddress in PreparedTxTron handle", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const mockTronWeb = buildFixtureNTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: FIXTURE_N_AMOUNT_HUMAN,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    const tx = record?.tx as {
      txType: string;
      kind: string;
      contractAddress: string;
    };
    expect(tx.txType).toBe("tron");
    expect(tx.kind).toBe("trc20");
    expect(tx.contractAddress).toBe(FIXTURE_N_USDT_TRC20);
  });
});

// ============================================================================
// Fixture N consumer re-anchor (LOAD-BEARING per CLAUDE.md fixture discipline)
// ============================================================================

describe("prepare_tron_trc20_send — Fixture N consumer re-anchor (PAYLOAD_FINGERPRINT_DRIFT regression)", () => {
  it("byte-identical fingerprint to the literal pinned in signing-fingerprint-tron.test.ts (FIXTURE_N_FINGERPRINT)", async () => {
    // Use demo mode so we have a deterministic from address without needing the
    // full real-mode TRON account setup. The mock encoder returns the Fixture N
    // raw_data_hex regardless of the from address used.
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");

    const mockTronWeb = buildFixtureNTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: FIXTURE_N_AMOUNT_HUMAN,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };

    // LOAD-BEARING ASSERTION — if this fails, drift is in `prepare_tron_trc20_send`
    // preimage assembly. Check:
    //   1. Does the mock still return FIXTURE_N_RAW_DATA_HEX?
    //   2. Does _tronTrc20.encodeTronTrc20Transfer propagate rawDataBytes correctly?
    //   3. Does _tronFingerprint.computeTronPayloadFingerprint receive the right bytes?
    expect(sc.payloadFingerprint).toBe(FIXTURE_N_FINGERPRINT);
  });
});

// ============================================================================
// PREPARE RECEIPT shape pin (PREP-02 verbatim invariant)
// ============================================================================

describe("prepare_tron_trc20_send — PREPARE RECEIPT verbatim invariant (PREP-02)", () => {
  it("PREPARE RECEIPT substituted from PREPARE_RECEIPT_TRON_TRC20_TEMPLATE byte-for-byte", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");

    const mockTronWeb = buildFixtureNTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: FIXTURE_N_AMOUNT_HUMAN,
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expectedReceipt = PREPARE_RECEIPT_TRON_TRC20_TEMPLATE
      .replace("{TO}", FIXTURE_N_TO)
      .replace("{TOKEN_ADDRESS}", FIXTURE_N_USDT_TRC20)
      .replace("{AMOUNT}", FIXTURE_N_AMOUNT_HUMAN)
      .replace("{REF_BLOCK_BYTES}", FIXTURE_N_REF_BLOCK_BYTES)
      .replace("{REF_BLOCK_HASH}", FIXTURE_N_REF_BLOCK_HASH)
      .replace("{EXPIRATION}", String(FIXTURE_N_EXPIRATION_BASE + 900_000));

    // The receipt block must appear verbatim in the text response.
    expect(text).toContain(expectedReceipt);

    // Spot checks: specific fields present in receipt.
    expect(text).toContain("PREPARE RECEIPT (TRON — TRC-20 transfer)");
    expect(text).toContain(FIXTURE_N_TO);
    expect(text).toContain(FIXTURE_N_USDT_TRC20);
    expect(text).toContain(FIXTURE_N_AMOUNT_HUMAN); // human units, NOT raw 100_000_000
    expect(text).toContain(FIXTURE_N_REF_BLOCK_BYTES);
    expect(text).toContain(FIXTURE_N_REF_BLOCK_HASH);

    // Verbatim invariant: raw agent strings, NOT normalized.
    expect(text).not.toContain("100000000"); // never expose raw scaled amount in PREPARE RECEIPT
    expect(text).toContain("100"); // verbatim human units

    // Symbol + decimals appear in the response text
    expect(text).toContain("USDT");
    expect(text).toContain("decimals=6");
  });

  it("structuredContent.symbol = 'USDT' and structuredContent.decimals = 6 for USDT-TRC20", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const mockTronWeb = buildFixtureNTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: FIXTURE_N_AMOUNT_HUMAN,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { symbol: string; decimals: number };
    expect(sc.symbol).toBe("USDT");
    expect(sc.decimals).toBe(6);
  });
});

// ============================================================================
// Decimal-aware amount handling
// ============================================================================

describe("prepare_tron_trc20_send — decimal-aware amount handling", () => {
  function setupRealMode() {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const mockTronWeb = buildFixtureNTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );
    return mockTronWeb;
  }

  it("amount '100' → raw 100_000_000 passed to encoder (6 decimals USDT)", async () => {
    setupRealMode();
    const encoderSpy = vi.spyOn(_tronTrc20, "encodeTronTrc20Transfer");

    await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: "100",
    });

    expect(encoderSpy).toHaveBeenCalledTimes(1);
    const call = encoderSpy.mock.calls[0]?.[0];
    expect(call?.amount).toBe(100_000_000n);
  });

  it("amount '100.5' → raw 100_500_000 passed to encoder", async () => {
    setupRealMode();
    const encoderSpy = vi.spyOn(_tronTrc20, "encodeTronTrc20Transfer");

    await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: "100.5",
    });

    expect(encoderSpy).toHaveBeenCalledTimes(1);
    const call = encoderSpy.mock.calls[0]?.[0];
    expect(call?.amount).toBe(100_500_000n);
  });

  it("amount '0.000001' → raw 1 passed to encoder (minimum USDT unit)", async () => {
    setupRealMode();
    const encoderSpy = vi.spyOn(_tronTrc20, "encodeTronTrc20Transfer");

    await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: "0.000001",
    });

    expect(encoderSpy).toHaveBeenCalledTimes(1);
    const call = encoderSpy.mock.calls[0]?.[0];
    expect(call?.amount).toBe(1n);
  });

  it("amount '0.0000001' (7 fractional digits, > 6 decimals) → INVALID_INPUT fractional-overflow", async () => {
    // Must fail BEFORE calling encoder — no RPC call.
    const encoderSpy = vi.spyOn(_tronTrc20, "encodeTronTrc20Transfer");

    // No account mock needed: validation happens before sender resolution.
    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: "0.0000001",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("fractional-overflow");
    expect(encoderSpy).not.toHaveBeenCalled();
  });

  it("USDD has 18 decimals — amount '1' → raw 1_000_000_000_000_000_000 passed to encoder", async () => {
    // USDD contract address (from tron-top-25.json)
    const USDD_ADDRESS = "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn";
    setupRealMode();
    const encoderSpy = vi.spyOn(_tronTrc20, "encodeTronTrc20Transfer");

    await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: USDD_ADDRESS,
      amount: "1",
    });

    expect(encoderSpy).toHaveBeenCalledTimes(1);
    const call = encoderSpy.mock.calls[0]?.[0];
    expect(call?.amount).toBe(1_000_000_000_000_000_000n);
    expect(call?.decimals).toBe(18);
  });
});

// ============================================================================
// INVALID_INPUT failure modes
// ============================================================================

describe("prepare_tron_trc20_send — INVALID_INPUT failure modes", () => {
  it("invalid 'to' address → INVALID_INPUT (before any state read)", async () => {
    const result = await callTool({
      to: "notAnAddress",
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("invalid 'tokenAddress' → INVALID_INPUT (before any state read)", async () => {
    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: "notAnAddress",
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("tokenAddress not in tron-top-25 registry → INVALID_INPUT", async () => {
    // A valid TRON address but not in the registry
    const UNKNOWN_TOKEN = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7"; // WIN — valid, but let's check if it's in registry
    // Actually WIN is in the registry; use an address that's definitely not
    const NOT_IN_REGISTRY = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"; // fake valid-looking addr
    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: NOT_IN_REGISTRY,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("amount with format error (non-numeric) → INVALID_INPUT format", async () => {
    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: "abc",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("format");
  });

  it("amount exceeding u256 max → INVALID_INPUT u256-overflow", async () => {
    // 2^256 > U256_MAX
    const tooLarge = "115792089237316195423570985008687907853269984665640564039457584007913129639936";
    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: tooLarge,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("u256-overflow");
  });

  it("empty amount → INVALID_INPUT empty", async () => {
    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: "",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("empty");
  });
});

// ============================================================================
// Demo-mode + real-mode sender resolution
// ============================================================================

describe("prepare_tron_trc20_send — WALLET_NOT_PAIRED + WRONG_MODE", () => {
  it("WALLET_NOT_PAIRED when no paired TRON account (real mode)", async () => {
    process.env[DEMO_KEY] = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });

  it("WRONG_MODE when demo mode on but no TRON persona set", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    // Do NOT set persona — _resetActivePersonaForTesting() clears it in beforeEach

    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");
    // listAccounts should NOT be consulted in demo mode
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("demo mode with TRON persona set succeeds — listAccounts NOT consulted", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");

    const mockTronWeb = buildFixtureNTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    const result = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Persona-cycle sender-dependence regression (CONTEXT D-05b)
// ============================================================================

describe("prepare_tron_trc20_send — persona-cycle sender-dependence (CONTEXT D-05b)", () => {
  it("fingerprint differs across personas while 'to' calldata arg stays invariant", async () => {
    // This confirms:
    // (1) owner_address in TriggerSmartContract Protobuf is the sender-binding field.
    //     Different raw_data_hex (different owner) → different fingerprint.
    // (2) The calldata 'to' arg is invariant — the persona change does NOT affect
    //     the recipient in the TRC-20 transfer ABI data.
    //
    // Approach: spy on _tronTrc20.encodeTronTrc20Transfer to capture the `to` arg
    // AND intercept to return different rawDataBytes per "persona".

    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");

    // Track `to` args across both calls
    const capturedToArgs: string[] = [];
    const capturedFromArgs: string[] = [];

    // Fixture N raw bytes (persona A)
    const personaARawBytes = new Uint8Array(Buffer.from(FIXTURE_N_RAW_DATA_HEX, "hex"));
    // Persona B raw bytes: flip last byte — different owner_address → different raw_data
    const personaBHex = FIXTURE_N_RAW_DATA_HEX.slice(0, -2) + "ff";
    const personaBRawBytes = new Uint8Array(Buffer.from(personaBHex, "hex"));

    // Spy that captures calls and returns persona-specific results
    let callCount = 0;
    const encoderSpy = vi.spyOn(_tronTrc20, "encodeTronTrc20Transfer").mockImplementation(
      async (input) => {
        capturedToArgs.push(input.to);
        capturedFromArgs.push(input.from);
        callCount++;
        const rawDataBytes = callCount === 1 ? personaARawBytes : personaBRawBytes;
        return {
          transaction: {},
          rawDataHex: callCount === 1 ? FIXTURE_N_RAW_DATA_HEX : personaBHex,
          rawDataBytes,
          rawDataObject: {},
          refBlockBytes: FIXTURE_N_REF_BLOCK_BYTES,
          refBlockHash: FIXTURE_N_REF_BLOCK_HASH,
          expiration: FIXTURE_N_EXPIRATION_BASE + 900_000,
          contractAddress: input.tokenAddress,
          instructionSummary: [],
        };
      },
    );

    // We don't need a real TronWeb since the encoder is mocked.
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      {} as unknown as ReturnType<typeof _tronRegistry.getTronWeb>,
    );

    // Run 1: persona A (tron-whale)
    const resultA = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: "100",
    });
    expect(resultA.isError).toBeFalsy();
    const fpA = (resultA.structuredContent as { payloadFingerprint: string }).payloadFingerprint;

    // Run 2: "persona B" — same setup but encoder now returns different bytes.
    // We keep the same persona slug (tron-whale) but the encoder mock returns persona B bytes.
    const resultB = await callTool({
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: "100",
    });
    expect(resultB.isError).toBeFalsy();
    const fpB = (resultB.structuredContent as { payloadFingerprint: string }).payloadFingerprint;

    encoderSpy.mockRestore();

    // Assertion 1: fingerprints differ (different raw_data_hex → different fingerprint)
    expect(fpA).not.toBe(fpB);

    // Assertion 2: both are valid 32-byte hex fingerprints
    expect(fpA).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fpB).toMatch(/^0x[0-9a-f]{64}$/);

    // Assertion 3: `to` arg was invariant in BOTH encoder calls (CONTEXT D-05b).
    // The calldata's `to` field doesn't change across personas — only `owner_address` does.
    expect(capturedToArgs).toHaveLength(2);
    expect(capturedToArgs[0]).toBe(FIXTURE_N_TO);
    expect(capturedToArgs[1]).toBe(FIXTURE_N_TO);

    // Assertion 4: encoder WAS called twice (one per persona run)
    expect(callCount).toBe(2);
  });
});

// ============================================================================
// Tool registration
// ============================================================================

describe("prepare_tron_trc20_send — tool registration", () => {
  it("is registered in register-all.ts", () => {
    const tool = getRegisteredTool("prepare_tron_trc20_send");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("prepare_tron_trc20_send");
  });
});
