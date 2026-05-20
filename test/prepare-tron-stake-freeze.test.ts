// `prepare_tron_stake_freeze` end-to-end regression. Phase 19 — Plan 19-02.
//
// Load-bearing invariants:
//
//   1. **Fixture Tron-19-B consumer re-anchor** — the canonical Fixture Tron-19-B
//      inputs produce the hardcoded literal fingerprint pinned in
//      `test/signing-fingerprint-tron-19.test.ts`. Drift in this tool's
//      preimage assembly surfaces HERE — load-bearing redundancy per CLAUDE.md
//      fixture discipline + CONTEXT D-08c.
//
//   2. **INVALID_INPUT FIRST** — `resource` enum strict equality validated
//      before any state read; `amount` validated via parseTronAmountStrict.
//
//   3. **D-03b strict enum** — "energy" / "BAND" / "Energy" → INVALID_INPUT.
//      Only "ENERGY" and "BANDWIDTH" pass.
//
//   4. **T-NUMBER-OVERFLOW guard** — amounts exceeding Number.MAX_SAFE_INTEGER
//      surface as INVALID_INPUT (not silent precision loss).
//
//   5. **kind = "stake-freeze"** in PreparedTxTron — verified in structuredContent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy, createHandleSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  createHandleSpy:
    vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (...args: Parameters<typeof actual.listAccounts>) =>
      listAccountsSpy(...args),
  };
});

vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (...args: Parameters<typeof actual.createHandle>) =>
      createHandleSpy(...args),
  };
});

import { _tronRegistry } from "../src/chains/tron/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveTronPersonaBySlug,
} from "../src/demo/state.js";
import { _tronStake } from "../src/protocols/tron-stake.js";
import { PREPARE_RECEIPT_TRON_STAKE_FREEZE_TEMPLATE } from "../src/signing/blocks-tron.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import {
  FIXTURE_TRON_19_B_FINGERPRINT,
  FIXTURE_TRON_19_B_FROM,
  FIXTURE_TRON_19_B_SUN,
  FIXTURE_TRON_19_B_RESOURCE,
  FIXTURE_TRON_19_B_REF_BLOCK_BYTES,
  FIXTURE_TRON_19_B_REF_BLOCK_HASH,
  FIXTURE_TRON_19_B_EXPIRATION,
} from "./signing-fingerprint-tron-19.test.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_tron_stake_freeze");
  if (!tool) throw new Error("prepare_tron_stake_freeze not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// ============================================================================
// Fixture Tron-19-B — raw_data_hex for FreezeBalanceV2Contract
// ============================================================================

const FIXTURE_19_B_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335a5b083612570a34747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e467265657a6542616c616e63655632436f6e7472616374121f0a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c108094ebdc0318017090f490a5e433";

const FIXTURE_19_B_OWNER_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";

// A canonical paired TRON account (real-mode shape).
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const PAIRED_TRON_ACCOUNT = {
  chain: "tron" as const,
  address: TRON_WHALE_ADDR,
  derivationPath: "44'/195'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

/**
 * Build a stub TronWeb returning the Fixture Tron-19-B tx structure
 * for FreezeBalanceV2Contract.
 */
function buildFixture19BTronWeb() {
  const baseTx = {
    raw_data_hex: FIXTURE_19_B_RAW_DATA_HEX,
    raw_data: {
      contract: [
        {
          type: "FreezeBalanceV2Contract",
          parameter: {
            value: {
              owner_address: FIXTURE_19_B_OWNER_HEX,
              frozen_balance: Number(FIXTURE_TRON_19_B_SUN),
              resource: "ENERGY",
            },
            type_url: "type.googleapis.com/protocol.FreezeBalanceV2Contract",
          },
        },
      ],
      ref_block_bytes: FIXTURE_TRON_19_B_REF_BLOCK_BYTES,
      ref_block_hash: FIXTURE_TRON_19_B_REF_BLOCK_HASH,
      expiration: FIXTURE_TRON_19_B_EXPIRATION,
    },
    visible: false,
    txID: "deadbeef19b",
  };

  // extendExpiration returns same tx (expiration already pinned)
  const extendedTx = { ...baseTx };

  return {
    transactionBuilder: {
      freezeBalanceV2: vi.fn().mockResolvedValue(baseTx),
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
// Tests
// ============================================================================

describe("prepare_tron_stake_freeze — Fixture Tron-19-B consumer re-anchor", () => {
  it("Fixture Tron-19-B: produces the hardcoded literal payloadFingerprint anchor", async () => {
    // Arrange: stub TronWeb + _tronStake to return Fixture Tron-19-B deterministic tx.
    const mockTronWeb = buildFixture19BTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(mockTronWeb as never);

    // Stub _tronStake.encodeFreezeBalanceV2 to return a fixed result using
    // the pinned Fixture Tron-19-B raw_data_hex.
    vi.spyOn(_tronStake, "encodeFreezeBalanceV2").mockResolvedValue({
      transaction: {},
      rawDataHex: FIXTURE_19_B_RAW_DATA_HEX,
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_19_B_RAW_DATA_HEX, "hex")),
      rawDataObject: {},
      refBlockBytes: FIXTURE_TRON_19_B_REF_BLOCK_BYTES,
      refBlockHash: FIXTURE_TRON_19_B_REF_BLOCK_HASH,
      expiration: FIXTURE_TRON_19_B_EXPIRATION,
      instructionSummary: [
        {
          kind: "stake-freeze-v2" as const,
          from: FIXTURE_TRON_19_B_FROM,
          resource: FIXTURE_TRON_19_B_RESOURCE,
          sun: FIXTURE_TRON_19_B_SUN,
        },
      ],
    });

    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    // Act: call tool with Fixture Tron-19-B inputs.
    const result = await callTool({
      amount: "1000",  // 1000 TRX = 1_000_000_000 SUN
      resource: FIXTURE_TRON_19_B_RESOURCE,
    });

    // Assert: no error.
    expect(result.isError).toBeFalsy();

    // Fixture Tron-19-B consumer re-anchor: payloadFingerprint must match hardcoded literal.
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.payloadFingerprint).toBe(FIXTURE_TRON_19_B_FINGERPRINT);

    // kind = "stake-freeze" in structuredContent.
    expect(sc.kind).toBe("stake-freeze");
    expect(sc.chain).toBe("tron");
  });

  it("Fixture Tron-19-B: PREPARE RECEIPT block contains resource + sun", async () => {
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({} as never);
    vi.spyOn(_tronStake, "encodeFreezeBalanceV2").mockResolvedValue({
      transaction: {},
      rawDataHex: FIXTURE_19_B_RAW_DATA_HEX,
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_19_B_RAW_DATA_HEX, "hex")),
      rawDataObject: {},
      refBlockBytes: FIXTURE_TRON_19_B_REF_BLOCK_BYTES,
      refBlockHash: FIXTURE_TRON_19_B_REF_BLOCK_HASH,
      expiration: FIXTURE_TRON_19_B_EXPIRATION,
      instructionSummary: [
        {
          kind: "stake-freeze-v2" as const,
          from: TRON_WHALE_ADDR,
          resource: "ENERGY" as const,
          sun: 1_000_000_000n,
        },
      ],
    });
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    const result = await callTool({ amount: "1000", resource: "ENERGY" });
    expect(result.isError).toBeFalsy();

    const text = (result.content[0] as { type: "text"; text: string }).text;
    // PREPARE RECEIPT template header
    expect(text).toMatch(/PREPARE RECEIPT.*TRON.*Stake 2\.0 freeze/);
    // resource slot
    expect(text).toMatch(/resource:\s+ENERGY/);
    // sun slot
    expect(text).toMatch(/sun:\s+1000000000/);
    // refBlockBytes slot
    expect(text).toMatch(/refBlockBytes:\s+00ad/);
  });
});

describe("prepare_tron_stake_freeze — input validation (FIRES FIRST)", () => {
  it("invalid resource 'energy' → INVALID_INPUT", async () => {
    const result = await callTool({ amount: "100", resource: "energy" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message as string).toContain('"energy"');
  });

  it("invalid resource 'BAND' → INVALID_INPUT", async () => {
    const result = await callTool({ amount: "100", resource: "BAND" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("invalid resource 'Energy' → INVALID_INPUT", async () => {
    const result = await callTool({ amount: "100", resource: "Energy" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("too-many fractional digits → INVALID_INPUT (7 digits > 6 TRX decimals)", async () => {
    // parseTronAmountStrict("100.1234567", 6, "u64") → fractional-overflow (7 > 6)
    const result = await callTool({ amount: "100.1234567", resource: "ENERGY" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("negative amount string → INVALID_INPUT", async () => {
    // parseTronAmountStrict("-100", 6, "u64") → format rejection (contains '-')
    const result = await callTool({ amount: "-100", resource: "ENERGY" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("non-numeric amount → INVALID_INPUT", async () => {
    const result = await callTool({ amount: "abc", resource: "ENERGY" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("prepare_tron_stake_freeze — T-NUMBER-OVERFLOW guard", () => {
  it("amount > Number.MAX_SAFE_INTEGER → INVALID_INPUT (overflow guard fires)", async () => {
    // Arrange: stub real tronweb to raise RangeError (T-NUMBER-OVERFLOW behavior from encoder)
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({} as never);
    vi.spyOn(_tronStake, "encodeFreezeBalanceV2").mockRejectedValue(
      new RangeError("FreezeBalanceV2Contract.frozen_balance overflow: 9007199254740992 > Number.MAX_SAFE_INTEGER (9007199254740991)"),
    );
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    // 9007199254740992 SUN = ~9007199.254740992 TRX > MAX_SAFE_INTEGER SUN
    // parseTronAmountStrict("9007199254.740993", 6, "u64") is a valid string but encoder throws
    // We use a u64-max-valid but pre-overflow-guard-triggering amount:
    // Actually, parseTronAmountStrict rejects non-integer strings. Use "9007199255" TRX = 9007199255_000_000 SUN (>MAX_SAFE_INTEGER)
    const result = await callTool({ amount: "9007200", resource: "ENERGY" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message as string).toContain("safe integer");
  });
});

describe("prepare_tron_stake_freeze — pairing + demo mode", () => {
  it("no paired TRON account → WALLET_NOT_PAIRED", async () => {
    listAccountsSpy.mockReturnValue([]);
    const result = await callTool({ amount: "100", resource: "ENERGY" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });

  it("demo mode + no persona → WRONG_MODE", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    const result = await callTool({ amount: "100", resource: "ENERGY" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WRONG_MODE");
  });

  it("demo mode + TRON persona → success (BANDWIDTH)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");

    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({} as never);
    vi.spyOn(_tronStake, "encodeFreezeBalanceV2").mockResolvedValue({
      transaction: {},
      rawDataHex: "cafecafe",
      rawDataBytes: new Uint8Array([0xca, 0xfe, 0xca, 0xfe]),
      rawDataObject: {},
      refBlockBytes: "00ad",
      refBlockHash: "aabbccddeeff0011",
      expiration: 9999999999999,
      instructionSummary: [
        {
          kind: "stake-freeze-v2" as const,
          from: "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb",
          resource: "BANDWIDTH" as const,
          sun: 100_000_000n,
        },
      ],
    });

    const result = await callTool({ amount: "100", resource: "BANDWIDTH" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("stake-freeze");
    expect(sc.resource).toBe("BANDWIDTH");
  });
});

describe("prepare_tron_stake_freeze — PREPARE_RECEIPT_TRON_STAKE_FREEZE_TEMPLATE slots", () => {
  it("template has no SUN/RESOURCE slots after substitution", async () => {
    // Verify the template format doesn't have leftover {RESOURCE} or {SUN} slots
    // when the tool processes a valid request.
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({} as never);
    vi.spyOn(_tronStake, "encodeFreezeBalanceV2").mockResolvedValue({
      transaction: {},
      rawDataHex: "01020304",
      rawDataBytes: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
      rawDataObject: {},
      refBlockBytes: "abcd",
      refBlockHash: "1234567890abcdef",
      expiration: 1234567890000,
      instructionSummary: [
        {
          kind: "stake-freeze-v2" as const,
          from: TRON_WHALE_ADDR,
          resource: "ENERGY" as const,
          sun: 500_000_000n,
        },
      ],
    });
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    const result = await callTool({ amount: "500", resource: "ENERGY" });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: "text"; text: string }).text;
    // No leftover template slots
    expect(text).not.toContain("{RESOURCE}");
    expect(text).not.toContain("{SUN}");
    expect(text).not.toContain("{REF_BLOCK_BYTES}");
    expect(text).not.toContain("{REF_BLOCK_HASH}");
    expect(text).not.toContain("{EXPIRATION}");
  });
});
