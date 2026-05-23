// prepare_eigenlayer_deposit tests — Phase 31 Plan 31-02 (EIG-02).
//
// Cases:
//   T1: Ethereum happy path — handle + tx shape + 3-block response
//   T2: Fixture Z fingerprint cross-link (anchors byte-identity with
//       test/signing-fingerprint.test.ts Fixture Z literal)
//   T3: Chain refusal — CHAIN_ID_MISMATCH (15); no RPC call fires
//   T4: LST off-list refusal — INVALID_INPUT + hintTool: request_capability
//   T5: D-05 LST allowance insufficient — INVALID_INPUT + hintTool:
//       prepare_token_approve + hintArgs.spender === StrategyManager
//   T6: D-06 cap pre-flight — MAX_UINT256 sentinel skip (Pitfall 6 mitigated)
//   T7: D-06 cap pre-flight — finite-cap-at-cap refusal +
//       hintTool: request_capability with feature mentioning LST symbol
//   T8: Invalid amount — INVALID_INPUT
//   T9: D-06 catch arm — maxTotalDeposits revert silently treated as
//       MAX_UINT256 (defensive fallback)
//   T10: LEDGER NOTICE block emitted verbatim (D-13)
//   T11: D-10 slashing-risk line emitted verbatim in CHECKS PERFORMED
//   T12: From-independence — same calldata + tx → same payloadFingerprint
//        regardless of `from` (Fixture Z is from-INDEPENDENT)
//   T13: register-all wiring smoke

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";

const { getStatusSpy, createHandleSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  createHandleSpy: vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from prepare_eigenlayer_deposit tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<typeof import("../src/signing/handle-store.js")>(
    "../src/signing/handle-store.js",
  );
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (...args: Parameters<typeof actual.createHandle>) => createHandleSpy(...args),
  };
});

const mockReadContract = vi.fn();

vi.mock("../src/chains/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../src/chains/registry.js")>(
    "../src/chains/registry.js",
  );
  return {
    ...actual,
    getChainClient: vi.fn(() => ({ readContract: mockReadContract })),
  };
});

import {
  getEigenLayerStrategyManagerAddress,
  getEigenLayerStrategyAddress,
  getEigenLayerLstTokenAddress,
} from "../src/config/contracts.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import {
  EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE,
  LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE,
} from "../src/signing/blocks.js";
import { encodeDepositIntoStrategy } from "../src/protocols/eigenlayer.js";
import { computePayloadFingerprint } from "../src/signing/payload-fingerprint.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

import "../src/tools/prepare_eigenlayer_deposit.js";

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_eigenlayer_deposit");
  if (!tool) throw new Error("prepare_eigenlayer_deposit not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged) as Promise<ToolHandlerResult>;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ANVIL_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;
const ANVIL_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [ANVIL_1],
  activeAccount: ANVIL_1,
  address: ANVIL_1,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [ANVIL_1] } as Record<number, `0x${string}`[]>,
};

const STRATEGY_MANAGER: Address = getEigenLayerStrategyManagerAddress(1)!;
const STETH_STRATEGY: Address = getEigenLayerStrategyAddress(1, "stETH")!;
const STETH_TOKEN: Address = getEigenLayerLstTokenAddress(1, "stETH")!;
const DEPOSIT_SELECTOR = "0xe7a050aa";

// Fixture Z — Phase 31 Plan 31-02 anchor (from test/signing-fingerprint.test.ts).
// StrategyManager.depositIntoStrategy(stETH-Strategy, stETH, 1e18) on Ethereum mainnet.
// Fixture Z is from-INDEPENDENT (strategy + token + amount in calldata; no
// `from` slot in the preimage).
const FIXTURE_Z_FINGERPRINT =
  "0x2c36a77f8e39c8d0f8d276f88169608e1a247bb288117da00f90b1f7dd158684";
const FIXTURE_Z_AMOUNT = "1";

const SUFFICIENT_ALLOWANCE = 2_000_000_000_000_000_000n; // 2 stETH
const UNLIMITED_CAP = 2n ** 256n - 1n;

/**
 * Happy-path mock: allowance OK, totalShares low, maxTotalDeposits sentinel
 * (MAX_UINT256 = unlimited).
 */
function setupHappyPathMocks() {
  getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
  mockReadContract.mockImplementation(({ functionName }: { functionName: string }) => {
    if (functionName === "allowance") return Promise.resolve(SUFFICIENT_ALLOWANCE);
    if (functionName === "totalShares") return Promise.resolve(100n);
    if (functionName === "maxTotalDeposits") return Promise.resolve(UNLIMITED_CAP);
    return Promise.resolve(0n);
  });
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

beforeEach(() => {
  getStatusSpy.mockReset();
  createHandleSpy.mockClear();
  mockReadContract.mockReset();
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
});

// ---------------------------------------------------------------------------
// T1: Ethereum happy path
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — Ethereum happy path", () => {
  it("stETH deposit 1 → handle + tx shape + 3-block response", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", lst: "stETH", amount: FIXTURE_Z_AMOUNT });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chainId: number;
      to: string;
      valueWei: string;
      data: string;
      payloadFingerprint: string;
    };

    expect(sc.chainId).toBe(1);
    expect(sc.to).toBe(STRATEGY_MANAGER);
    expect(sc.valueWei).toBe("0");
    expect(sc.data.slice(0, 10).toLowerCase()).toBe(DEPOSIT_SELECTOR);
    expect(sc.data.length).toBe(202);

    // 3 content blocks: PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE
    expect(result.content.length).toBe(3);
    expect(result.content[0]?.text ?? "").toMatch(/PREPARE RECEIPT/);
    expect(result.content[1]?.text ?? "").toMatch(/CHECKS PERFORMED/);
    expect(result.content[2]?.text ?? "").toMatch(/LEDGER NOTICE/);
  });
});

// ---------------------------------------------------------------------------
// T2: Fixture Z fingerprint cross-link (byte-identity anchor)
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — Fixture Z fingerprint cross-link", () => {
  it("payloadFingerprint === Fixture Z literal from test/signing-fingerprint.test.ts", async () => {
    setupHappyPathMocks();

    const result = await callTool({ chain: "ethereum", lst: "stETH", amount: FIXTURE_Z_AMOUNT });
    const sc = result.structuredContent as { payloadFingerprint: string };
    // Byte-identity re-anchor — drift in preimage assembly breaks this AND
    // the Fixture Z test in test/signing-fingerprint.test.ts.
    expect(sc.payloadFingerprint).toBe(FIXTURE_Z_FINGERPRINT);

    // Independent re-computation: the prepare-tool flow MUST produce the same
    // fingerprint as the standalone Fixture Z scenario.
    const data = encodeDepositIntoStrategy(
      STETH_STRATEGY,
      STETH_TOKEN,
      1_000_000_000_000_000_000n,
    );
    const fp = computePayloadFingerprint({
      chainId: 1,
      to: STRATEGY_MANAGER,
      valueWei: 0n,
      data,
    });
    expect(fp).toBe(FIXTURE_Z_FINGERPRINT);
    expect(sc.payloadFingerprint).toBe(fp);
  });
});

// ---------------------------------------------------------------------------
// T3: Chain refusal — CHAIN_ID_MISMATCH (D-03)
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — chain refusal (D-03)", () => {
  it("chain: 'arbitrum' → CHAIN_ID_MISMATCH; createHandle NEVER called; no RPC fired", async () => {
    const result = await callTool({ chain: "arbitrum", lst: "stETH", amount: FIXTURE_Z_AMOUNT });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "CHAIN_ID_MISMATCH",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
    expect(mockReadContract).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T4: LST off-list refusal (D-04 + Pitfall 3)
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — LST off-list refusal (D-04 + Pitfall 3)", () => {
  it("lst: 'ankrETH' → INVALID_INPUT + hintTool: request_capability + feature mentions LST symbol", async () => {
    const result = await callTool({ chain: "ethereum", lst: "ankrETH", amount: FIXTURE_Z_AMOUNT });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      hintTool: string;
      hintArgs: { feature: string };
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("request_capability");
    expect(sc.hintArgs.feature).toMatch(/ankrETH/);
    expect(createHandleSpy).not.toHaveBeenCalled();
    expect(mockReadContract).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T5: D-05 LST allowance insufficient
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — D-05 LST allowance insufficient", () => {
  it("allowance < amount → INVALID_INPUT + hintTool: prepare_token_approve + spender = StrategyManager", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    // 0.5 stETH approved; 1 stETH requested → insufficient
    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "allowance") return Promise.resolve(500_000_000_000_000_000n);
      if (functionName === "totalShares") return Promise.resolve(100n);
      if (functionName === "maxTotalDeposits") return Promise.resolve(UNLIMITED_CAP);
      return Promise.resolve(0n);
    });

    const result = await callTool({ chain: "ethereum", lst: "stETH", amount: FIXTURE_Z_AMOUNT });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      hintTool: string;
      hintArgs: { tokenAddress: string; spender: string; amount: string };
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_token_approve");
    expect(sc.hintArgs.tokenAddress).toBe(STETH_TOKEN);
    // CRITICAL D-05 spec: spender for deposit = StrategyManager (NOT the
    // per-strategy proxy)
    expect(sc.hintArgs.spender).toBe(STRATEGY_MANAGER);
    expect(sc.hintArgs.amount).toBe("1");
    expect(createHandleSpy).not.toHaveBeenCalled();
    // stETH-specific Pitfall 4 note in the error text
    expect(result.content[0]?.text ?? "").toMatch(/rebase/i);
  });

  it("non-stETH LST insufficient allowance does NOT emit the rebase note", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "allowance") return Promise.resolve(0n);
      if (functionName === "totalShares") return Promise.resolve(100n);
      if (functionName === "maxTotalDeposits") return Promise.resolve(UNLIMITED_CAP);
      return Promise.resolve(0n);
    });
    const result = await callTool({ chain: "ethereum", lst: "rETH", amount: "1" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? "").not.toMatch(/rebase/i);
  });
});

// ---------------------------------------------------------------------------
// T6: D-06 cap pre-flight — MAX_UINT256 sentinel skip (Pitfall 6 mitigated)
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — D-06 sentinel skip (Pitfall 6)", () => {
  it("maxTotalDeposits === 2^256-1 → tool PROCEEDS (no cap refusal)", async () => {
    setupHappyPathMocks();
    const result = await callTool({ chain: "ethereum", lst: "stETH", amount: FIXTURE_Z_AMOUNT });
    expect(result.isError).toBeFalsy();
    const checksText = result.content[1]?.text ?? "";
    // Asserts the sentinel-skip arm fired (text mentions MAX_UINT256 / unlimited).
    expect(checksText).toMatch(/MAX_UINT256|unlimited/i);
  });
});

// ---------------------------------------------------------------------------
// T7: D-06 finite-cap-at-cap refusal
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — D-06 finite-cap-at-cap refusal", () => {
  it("maxTotalDeposits=1000, currentTotalShares=1000 → INVALID_INPUT + hintTool: request_capability", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "allowance") return Promise.resolve(SUFFICIENT_ALLOWANCE);
      if (functionName === "totalShares") return Promise.resolve(1000n);
      if (functionName === "maxTotalDeposits") return Promise.resolve(1000n);
      return Promise.resolve(0n);
    });
    const result = await callTool({ chain: "ethereum", lst: "stETH", amount: FIXTURE_Z_AMOUNT });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      hintTool: string;
      hintArgs: { feature: string };
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("request_capability");
    expect(sc.hintArgs.feature).toMatch(/stETH/);
    expect(sc.hintArgs.feature).toMatch(/unpause/);
    expect(createHandleSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T8: Invalid amount
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — invalid amount", () => {
  it("amount: 'abc' → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result = await callTool({ chain: "ethereum", lst: "stETH", amount: "abc" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
    expect(createHandleSpy).not.toHaveBeenCalled();
  });

  it("amount: '1.12345678901234567890' (19 fractional digits) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      lst: "stETH",
      amount: "1.12345678901234567890",
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------
// T9: D-06 catch arm — maxTotalDeposits revert → treated as MAX_UINT256
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — D-06 maxTotalDeposits revert defensive fallback", () => {
  it("maxTotalDeposits throws → treated as MAX_UINT256; tool proceeds", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "allowance") return Promise.resolve(SUFFICIENT_ALLOWANCE);
      if (functionName === "totalShares") return Promise.resolve(100n);
      if (functionName === "maxTotalDeposits") {
        return Promise.reject(new Error("execution reverted"));
      }
      return Promise.resolve(0n);
    });
    const result = await callTool({ chain: "ethereum", lst: "stETH", amount: FIXTURE_Z_AMOUNT });
    expect(result.isError).toBeFalsy();
    const checksText = result.content[1]?.text ?? "";
    expect(checksText).toMatch(/MAX_UINT256|unlimited/i);
  });
});

// ---------------------------------------------------------------------------
// T10: LEDGER NOTICE block emitted verbatim (D-13)
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — LEDGER NOTICE verbatim (D-13)", () => {
  it("response includes LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE byte-identical", async () => {
    setupHappyPathMocks();
    const result = await callTool({ chain: "ethereum", lst: "stETH", amount: FIXTURE_Z_AMOUNT });
    expect(result.isError).toBeFalsy();
    const noticeBlock = result.content[2]?.text ?? "";
    expect(noticeBlock).toBe(LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE);

    // Spot-check key load-bearing substrings (verbatim per RESEARCH § Topic 8):
    expect(noticeBlock).toContain(
      "EigenLayer depositIntoStrategy is NOT covered by the Ledger Ethereum app's clear-sign plugins.",
    );
    expect(noticeBlock).toContain("BLIND-SIGN");
    expect(noticeBlock).toContain("Settings → Blind signing → Enabled");
    expect(noticeBlock).toContain("character-for-character");
  });
});

// ---------------------------------------------------------------------------
// T11: D-10 slashing-risk informational line — VERBATIM in CHECKS PERFORMED
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — D-10 slashing-risk line verbatim", () => {
  it("CHECKS PERFORMED block contains the verbatim slashing-risk template", async () => {
    setupHappyPathMocks();
    const result = await callTool({ chain: "ethereum", lst: "stETH", amount: FIXTURE_Z_AMOUNT });
    expect(result.isError).toBeFalsy();
    const checks = result.content[1]?.text ?? "";
    // Verbatim text per 31-02-PLAN.md <verified_values> D-10 line.
    expect(checks).toContain(
      "EigenLayer restaking: deposited LST shares are subject to slashing by AVS operators the user later delegates to.",
    );
    expect(checks).toContain(
      "Phase 31 ships deposit only — operator delegation is a separate tool (deferred to v2.x).",
    );
    expect(checks).toContain("Informational; no enforcement gate.");
  });
});

// ---------------------------------------------------------------------------
// T12: Fixture Z from-independence
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — Fixture Z from-independence", () => {
  it("payloadFingerprint is identical across different `from` addresses (Z is from-INDEPENDENT)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "allowance") return Promise.resolve(SUFFICIENT_ALLOWANCE);
      if (functionName === "totalShares") return Promise.resolve(100n);
      if (functionName === "maxTotalDeposits") return Promise.resolve(UNLIMITED_CAP);
      return Promise.resolve(0n);
    });
    const result1 = await callTool({ chain: "ethereum", lst: "stETH", amount: FIXTURE_Z_AMOUNT });
    const fp1 = (result1.structuredContent as { payloadFingerprint: string }).payloadFingerprint;

    _resetHandleStoreForTesting();

    const MULTI_ACCOUNT_STATUS = {
      ...PAIRED_STATUS,
      accounts: [ANVIL_1, ANVIL_0],
      accountsByChain: { 1: [ANVIL_1, ANVIL_0] } as Record<number, `0x${string}`[]>,
    };
    getStatusSpy.mockResolvedValueOnce(MULTI_ACCOUNT_STATUS);
    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "allowance") return Promise.resolve(SUFFICIENT_ALLOWANCE);
      if (functionName === "totalShares") return Promise.resolve(100n);
      if (functionName === "maxTotalDeposits") return Promise.resolve(UNLIMITED_CAP);
      return Promise.resolve(0n);
    });
    const result2 = await callTool({
      chain: "ethereum",
      lst: "stETH",
      amount: FIXTURE_Z_AMOUNT,
      from: ANVIL_0,
    });
    const fp2 = (result2.structuredContent as { payloadFingerprint: string }).payloadFingerprint;

    expect(fp1).toBe(FIXTURE_Z_FINGERPRINT);
    expect(fp2).toBe(FIXTURE_Z_FINGERPRINT);
    expect(fp1).toBe(fp2);
  });
});

// ---------------------------------------------------------------------------
// T13: register-all wiring + handle store shape
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — register-all wiring", () => {
  it("prepare_eigenlayer_deposit is registered after register-all import", async () => {
    await import("../src/tools/register-all.js");
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_eigenlayer_deposit");
  });

  it("inputSchema requires chain + lst + amount; chain enum is ['ethereum']; lst enum has 7 members", () => {
    const tool = getRegisteredTool("prepare_eigenlayer_deposit");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "lst", "amount"]);
    expect(tool.inputSchema.properties?.chain).toMatchObject({
      type: "string",
      enum: ["ethereum"],
    });
    const lstSchema = tool.inputSchema.properties?.lst as { enum: string[] };
    expect(lstSchema.enum).toEqual(["stETH", "rETH", "cbETH", "ETHx", "wBETH", "sfrxETH", "mETH"]);
  });

  it("handle stored shape: tx.to === StrategyManager; valueWei === 0n; data starts with deposit selector", async () => {
    setupHappyPathMocks();
    const result = await callTool({ chain: "ethereum", lst: "stETH", amount: FIXTURE_Z_AMOUNT });
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.tx.chainId).toBe(1);
    expect(record.tx.to).toBe(STRATEGY_MANAGER);
    expect(record.tx.valueWei).toBe(0n);
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(DEPOSIT_SELECTOR);
    expect(record.tx.data.length).toBe(202);
    expect(record.payloadFingerprint).toBe(FIXTURE_Z_FINGERPRINT);
  });
});

// ---------------------------------------------------------------------------
// PREPARE RECEIPT verbatim (PREP-02 / T-PREP-RCPT-1)
// ---------------------------------------------------------------------------
describe("prepare_eigenlayer_deposit — PREPARE RECEIPT verbatim", () => {
  it("receipt text matches EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE byte-identically", async () => {
    setupHappyPathMocks();
    const result = await callTool({ chain: "ethereum", lst: "stETH", amount: FIXTURE_Z_AMOUNT });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{STRATEGY_MANAGER}", STRATEGY_MANAGER)
      .replace("{STRATEGY}", STETH_STRATEGY)
      .replace(/\{LST_SYMBOL\}/g, "stETH")
      .replace("{LST_TOKEN}", STETH_TOKEN)
      .replace("{AMOUNT}", FIXTURE_Z_AMOUNT);
    expect(text).toBe(expected);
  });
});
