// preview_send Phase 37 Plan 37-03 additive sites:
//
//   (a) safe-typed-data refusal gate at the top — WRONG_HANDLE_KIND for
//       PreparedTxSafeTypedData handles.
//   (b) isSafeExecTransaction Layer 0.5 bypass extension — extends the
//       existing escape-hatch bypass at preview_send.ts:811-812 with a
//       single `||` (`record.acknowledgeNonProtocolTarget === true ||
//       record.isSafeExecTransaction === true`).
//   (c) composite-tx decode arm for selector 0x6a761202 (Safe execTransaction).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";

import type { FourbyteResult } from "../src/clients/fourbyte.js";

const {
  getStatusSpy,
  getTransactionCountSpy,
  estimateFeesPerGasSpy,
  estimateGasSpy,
  callSpy,
  lookupSelectorSpy,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getTransactionCountSpy: vi.fn(),
  estimateFeesPerGasSpy: vi.fn(),
  estimateGasSpy: vi.fn(),
  callSpy: vi.fn(),
  lookupSelectorSpy: vi.fn<[Hex | null], Promise<FourbyteResult>>(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
      "../src/wallet/session-manager.js",
    );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) =>
      getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>(
    "viem/actions",
  );
  return {
    ...actual,
    getTransactionCount: (
      ...args: Parameters<typeof actual.getTransactionCount>
    ) => getTransactionCountSpy(...args),
    estimateFeesPerGas: (
      ...args: Parameters<typeof actual.estimateFeesPerGas>
    ) => estimateFeesPerGasSpy(...args),
    estimateGas: (...args: Parameters<typeof actual.estimateGas>) =>
      estimateGasSpy(...args),
    call: (...args: Parameters<typeof actual.call>) => callSpy(...args),
  };
});

vi.mock("../src/clients/fourbyte.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/clients/fourbyte.js")>(
      "../src/clients/fourbyte.js",
    );
  return {
    ...actual,
    lookupSelector: (selector: Hex | null) => lookupSelectorSpy(selector),
  };
});

import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import { execTransactionAbi } from "../src/signing/safe-exec-decode.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  type PreparedTxEvm,
  type PreparedTxSafeTypedData,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callPreview(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

// Random EOA address — NOT in any chain's CANONICAL_DISPATCH_TARGETS.
// Stands in for a user's Safe proxy (per-user, NOT globally allowlistable).
const USER_SAFE: Address = "0x1234567890123456789012345678901234567890";
const ENCAPSULATED_TO: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SENDER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ZERO_ADDR: Address = "0x0000000000000000000000000000000000000000";
const SAFE_TX_HASH: Hex =
  "0xf5073f5eabcb7ff540becf339c3bbe2b5f41b5f9fec8ae1e42847d9a25fedf0a";

// Synthetic 65-byte signature blob — composite-decode arm is shape-only,
// not signer-recovering, so any 65-byte blob suffices for these tests.
const FAKE_SIG_BLOB: Hex = ("0x" + "ab".repeat(65)) as Hex;

const PAIRED_STATUS = {
  paired: true as const,
  accounts: [SENDER],
  activeAccount: SENDER,
  address: SENDER,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

function buildExecTransactionCalldata(opts: {
  to?: Address;
  value?: bigint;
  data?: Hex;
  operation?: 0 | 1;
}): Hex {
  return encodeFunctionData({
    abi: execTransactionAbi,
    functionName: "execTransaction",
    args: [
      opts.to ?? ENCAPSULATED_TO,
      opts.value ?? 1_000_000_000_000_000_000n,
      opts.data ?? ("0x" as Hex),
      opts.operation ?? 0,
      0n,
      0n,
      0n,
      ZERO_ADDR,
      ZERO_ADDR,
      FAKE_SIG_BLOB,
    ],
  });
}

const FIXTURE_FINGERPRINT: Hex =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a";

function seedSafeExecHandle(opts: {
  innerData?: Hex;
  operation?: 0 | 1;
  withSentinel?: boolean;
}): { handle: string; calldata: Hex } {
  const calldata = buildExecTransactionCalldata({
    data: opts.innerData,
    operation: opts.operation,
  });
  const tx: PreparedTxEvm = {
    chainId: 1,
    to: USER_SAFE,
    valueWei: 0n,
    data: calldata,
  };
  const handle = createHandle({
    args: { to: USER_SAFE, valueWei: "0" },
    tx,
    payloadFingerprint: FIXTURE_FINGERPRINT,
    ...(opts.withSentinel ? { isSafeExecTransaction: true } : {}),
  });
  return { handle, calldata };
}

function seedSafeTypedDataHandle(): string {
  const tx: PreparedTxSafeTypedData = {
    txType: "safe-typed-data",
    chainId: 0,
    to: ZERO_ADDR,
    valueWei: 0n,
    data: "0x",
    chain: 1,
    safeAddress: USER_SAFE,
    safeVersion: "1.3.0",
    safeTxHash: SAFE_TX_HASH,
    safeNonce: 42n,
    operation: "call",
    safeTxTo: ENCAPSULATED_TO,
    safeTxValue: 1_000_000_000_000_000_000n,
    safeTxData: "0x",
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZERO_ADDR,
    refundReceiver: ZERO_ADDR,
    typedDataStructure: {
      domain: { chainId: 1, verifyingContract: USER_SAFE },
      types: {} as never,
      primaryType: "SafeTx",
      message: {} as never,
    },
  };
  return createHandle({
    args: { to: USER_SAFE, valueWei: "0" },
    tx,
    payloadFingerprint: FIXTURE_FINGERPRINT,
  });
}

function scriptHappyMocks(): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getTransactionCountSpy.mockResolvedValue(7);
  estimateFeesPerGasSpy.mockResolvedValue({
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
  });
  estimateGasSpy.mockResolvedValue(150_000n);
  lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });
  callSpy.mockResolvedValue({ data: "0x" });
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

beforeEach(() => {
  getStatusSpy.mockReset();
  getTransactionCountSpy.mockReset();
  estimateFeesPerGasSpy.mockReset();
  estimateGasSpy.mockReset();
  callSpy.mockReset();
  lookupSelectorSpy.mockReset();
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

// ===========================================================================
// Site (a) — safe-typed-data refusal gate.
// ===========================================================================

describe("preview_send — Phase 37 Plan 37-03 site (a): safe-typed-data refusal", () => {
  it("refuses with WRONG_HANDLE_KIND when handle.tx.txType === 'safe-typed-data'", async () => {
    const handle = seedSafeTypedDataHandle();
    const result = await callPreview({ handle });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WRONG_HANDLE_KIND");
    expect(String(sc.message)).toMatch(/eth_signTypedData_v4|typed-data/i);
  });
});

// ===========================================================================
// Site (b) — Layer 0.5 bypass extension via isSafeExecTransaction sentinel.
// ===========================================================================

describe("preview_send — Phase 37 Plan 37-03 site (b): isSafeExecTransaction Layer 0.5 bypass", () => {
  it("Layer 0.5 bypassed when record.isSafeExecTransaction === true (USER_SAFE not in CANONICAL_DISPATCH_TARGETS)", async () => {
    scriptHappyMocks();
    const { handle } = seedSafeExecHandle({ withSentinel: true });
    const result = await callPreview({ handle });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    // No DISPATCH_TARGET_REFUSED — bypass succeeded.
    expect(sc.errorCode).toBeUndefined();
    // previewToken minted = preview_send proceeded past Layer 0.5.
    expect(sc.previewToken).toMatch(/^[0-9a-f-]+$/);
  });

  it("Layer 0.5 NOT bypassed without sentinel — refuses with DISPATCH_TARGET_REFUSED", async () => {
    scriptHappyMocks();
    // Same handle shape but WITHOUT the sentinel — the user Safe proxy is
    // not in CANONICAL_DISPATCH_TARGETS, so Layer 0.5 should refuse.
    const { handle } = seedSafeExecHandle({ withSentinel: false });
    const result = await callPreview({ handle });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("DISPATCH_TARGET_REFUSED");
  });
});

// ===========================================================================
// Site (c) — composite-tx decode arm for selector 0x6a761202.
// ===========================================================================

describe("preview_send — Phase 37 Plan 37-03 site (c): composite-tx decode arm", () => {
  it("decodes the encapsulated quartet (call to {to}) for selector 0x6a761202 calldata", async () => {
    scriptHappyMocks();
    const { handle } = seedSafeExecHandle({
      withSentinel: true,
      operation: 0,
    });
    const result = await callPreview({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    // Composite-tx preview surfaces the encapsulated quartet.
    expect(text).toMatch(/execTransaction/);
    expect(text).toContain(ENCAPSULATED_TO);
  });

  it("delegatecall path surfaces 'delegatecall' in DECODED ARGS", async () => {
    scriptHappyMocks();
    const { handle } = seedSafeExecHandle({
      withSentinel: true,
      operation: 1,
    });
    const result = await callPreview({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/delegatecall/);
  });

  it("undecoded inner data surfaces the raw selector marker", async () => {
    scriptHappyMocks();
    const { handle } = seedSafeExecHandle({
      withSentinel: true,
      operation: 0,
      innerData: "0xdeadbeef" as Hex,
    });
    const result = await callPreview({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    // Either decoded (cache hit — unlikely for 0xdeadbeef) OR undecoded
    // marker. We assert the undecoded path since 0xdeadbeef won't be in
    // the per-session ABI cache.
    expect(text).toMatch(/undecoded|0xdeadbeef/);
  });
});

// ===========================================================================
// Phase 38 Plan 38-01 — Inv #12.5 hard-trigger re-emission at preview
// ===========================================================================

const FIXTURE_SAFE_G_DATA_PREVIEW: Hex =
  "0x610b5925000000000000000000000000cafe0000000000000000000000000000cafe0001";

/**
 * Seed a handle whose inner SafeTx targets the OUTER tx.to (the user Safe
 * proxy itself). This is the safe-on-self gate for MODULE ENABLE — the
 * preview-side check verifies innerDecoded.to === record.tx.to (lowercased).
 */
function seedSafeExecHandleSelfTarget(opts: {
  innerData?: Hex;
  operation?: 0 | 1;
}): { handle: string; calldata: Hex } {
  const calldata = buildExecTransactionCalldata({
    to: USER_SAFE, // inner SafeTx targets the Safe proxy itself
    value: 0n,
    data: opts.innerData,
    operation: opts.operation,
  });
  const tx: PreparedTxEvm = {
    chainId: 1,
    to: USER_SAFE,
    valueWei: 0n,
    data: calldata,
  };
  const handle = createHandle({
    args: { to: USER_SAFE, valueWei: "0" },
    tx,
    payloadFingerprint: FIXTURE_FINGERPRINT,
    isSafeExecTransaction: true,
  });
  return { handle, calldata };
}

describe("preview_send — Phase 38 hard-trigger re-emission (Inv #12.5)", () => {
  it("MODULE ENABLE: inner data starts with 0x610b5925 AND inner to === record.tx.to emits [HARD-TRIGGER — MODULE ENABLE] block at preview", async () => {
    scriptHappyMocks();
    const { handle } = seedSafeExecHandleSelfTarget({
      innerData: FIXTURE_SAFE_G_DATA_PREVIEW,
      operation: 0,
    });
    const result = await callPreview({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("[HARD-TRIGGER — MODULE ENABLE]");
    expect(text.toLowerCase()).toContain(
      "0xcafe0000000000000000000000000000cafe0001",
    );
  });

  it("DELEGATECALL: innerDecoded.operation === 1 emits [HARD-TRIGGER — DELEGATECALL] block at preview", async () => {
    scriptHappyMocks();
    const { handle } = seedSafeExecHandle({
      withSentinel: true,
      operation: 1,
    });
    const result = await callPreview({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("[HARD-TRIGGER — DELEGATECALL]");
    expect(text).toMatch(/Inv #12\.5/);
  });

  it("composite at preview: MODULE ENABLE + DELEGATECALL emits BOTH in document order", async () => {
    scriptHappyMocks();
    const { handle } = seedSafeExecHandleSelfTarget({
      innerData: FIXTURE_SAFE_G_DATA_PREVIEW,
      operation: 1,
    });
    const result = await callPreview({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    const idxModule = text.indexOf("[HARD-TRIGGER — MODULE ENABLE]");
    const idxDelegate = text.indexOf("[HARD-TRIGGER — DELEGATECALL]");
    expect(idxModule).toBeGreaterThanOrEqual(0);
    expect(idxDelegate).toBeGreaterThanOrEqual(0);
    expect(idxModule).toBeLessThan(idxDelegate);
  });

  it("non-isSafeExecTransaction handle emits NEITHER hard-trigger block (gate is the EXEC_TRANSACTION_SELECTOR + isSafeExecTransaction arm)", async () => {
    scriptHappyMocks();
    // Build a non-Safe-exec handle — tx.data is NOT execTransaction calldata.
    const tx: PreparedTxEvm = {
      chainId: 1,
      to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH9 — in allowlist
      valueWei: 0n,
      data: "0x2e1a7d4d0000000000000000000000000000000000000000000000000de0b6b3a7640000" as Hex, // WETH9.withdraw(1e18)
    };
    const handle = createHandle({
      args: { to: tx.to, valueWei: "0" },
      tx,
      payloadFingerprint: FIXTURE_FINGERPRINT,
    });
    const result = await callPreview({ handle });
    // Result may pass or fail based on canonical-dispatch; we only care
    // about the absence of hard-trigger blocks in the response text.
    const text = (result.content[0] as { text: string }).text;
    expect(text.includes("[HARD-TRIGGER —")).toBe(false);
  });

  it("MODULE ENABLE does NOT fire when inner to !== record.tx.to (safe-on-self gate)", async () => {
    scriptHappyMocks();
    // Inner SafeTx targets ENCAPSULATED_TO (different from the outer tx.to / USER_SAFE).
    const { handle } = seedSafeExecHandle({
      withSentinel: true,
      operation: 0,
      innerData: FIXTURE_SAFE_G_DATA_PREVIEW,
    });
    const result = await callPreview({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text.includes("[HARD-TRIGGER — MODULE ENABLE]")).toBe(false);
  });

  it("hard-trigger blocks COEXIST with safeExecWarnBlock + safeExecDecodeBlock (Phase 37 invariants preserved)", async () => {
    scriptHappyMocks();
    const { handle } = seedSafeExecHandleSelfTarget({
      innerData: FIXTURE_SAFE_G_DATA_PREVIEW,
      operation: 1,
    });
    const result = await callPreview({ handle });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    // Phase 37 invariants — WARN + composite-tx DECODED ARGS still present.
    expect(text).toContain("[WARN — SAFE EXECUTE COMPOSITE-TX]");
    expect(text).toMatch(/DECODED ARGS — Safe execTransaction/);
    // Phase 38 additions present alongside.
    expect(text).toContain("[HARD-TRIGGER — MODULE ENABLE]");
    expect(text).toContain("[HARD-TRIGGER — DELEGATECALL]");
  });
});
