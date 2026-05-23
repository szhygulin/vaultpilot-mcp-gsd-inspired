// prepare_lido_unwrap tests — Phase 30 Plan 30-03 (LIDO-04).
//
// 8 cases covering:
//   T1: Ethereum happy path — handle created; tx shape correct; PREPARE RECEIPT verbatim
//   T2: Fixture Y fingerprint anchor (cross-link to test/signing-fingerprint.test.ts)
//   T3: Polygon refusal — CHAIN_ID_MISMATCH (15) (D-03)
//   T4: Invalid amount — INVALID_INPUT from parseAmountStrict
//   T5: NO allowance pre-flight (no readContract call with functionName: "allowance")
//   T6: NO LEDGER NOTICE in text content (D-12 — clear-sign confirmed)
//   T7: Zero amount accepted (wstETH.unwrap(0) is valid — no zero guard needed for unwrap)
//   T8: register-all wiring smoke

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      throw new Error("pair should not be called from prepare_lido_unwrap tests");
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

// Track readContract calls to assert no allowance check for unwrap
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
  getLidoWstethAddress,
} from "../src/config/contracts.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { LIDO_UNWRAP_PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
} from "../src/demo/state.js";

await import("../src/tools/register-all.js");
// Direct import to trigger tool registration (register-all.ts adds this in Task 3;
// until then, direct import ensures the tool is registered in this test file).
await import("../src/tools/prepare_lido_unwrap.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_lido_unwrap");
  if (!tool) throw new Error("prepare_lido_unwrap not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const ANVIL_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [ANVIL_1],
  activeAccount: ANVIL_1,
  address: ANVIL_1,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [ANVIL_1] } as Record<number, `0x${string}`[]>,
};

// Fixture Y — Phase 30 Plan 30-01 anchor (from test/signing-fingerprint.test.ts).
// WstETH.unwrap(1e18) on Ethereum mainnet.
// Cross-link: this re-anchor proves the preimage assembly is byte-identical.
const FIXTURE_Y_FINGERPRINT =
  "0x6d0dff107199edaf752aa542f219edbf26db1319f206aec4dc4027b368476089";
const FIXTURE_Y_AMOUNT = "1.0";
const FIXTURE_Y_AMOUNT_WEI = "1000000000000000000"; // 1e18

// Lido wstETH contract (EIP-55 checksummed from contracts.ts SOT)
const WSTETH_ADDR = getLidoWstethAddress(1)!;
// unwrap selector
const UNWRAP_SELECTOR = "0xde0e9a3e";

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
describe("prepare_lido_unwrap — Ethereum happy path", () => {
  it("wstethAmount: '1.0' → handle + correct tx shape + PREPARE RECEIPT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", wstethAmount: FIXTURE_Y_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chainId: number;
      to: string;
      valueWei: string;
      data: string;
      payloadFingerprint: string;
    };

    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sc.chainId).toBe(1);
    expect(sc.to).toBe(WSTETH_ADDR);
    expect(sc.valueWei).toBe("0");
    expect(sc.data.slice(0, 10).toLowerCase()).toBe(UNWRAP_SELECTOR);
    expect(sc.data.length).toBe(74); // 36 bytes = 4 selector + 32 amount

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT");
    expect(text).toContain(WSTETH_ADDR);
    expect(text).toContain(FIXTURE_Y_AMOUNT);
  });
});

// ---------------------------------------------------------------------------
// T2: Fixture Y fingerprint anchor (PREP-03 + T-BIND-1)
// ---------------------------------------------------------------------------
describe("prepare_lido_unwrap — Fixture Y fingerprint anchor", () => {
  it("payloadFingerprint === Fixture Y literal (cross-link to signing-fingerprint.test.ts)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", wstethAmount: FIXTURE_Y_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    // Byte-identity re-anchor — drift in preimage assembly breaks this AND the
    // Fixture Y test in test/signing-fingerprint.test.ts.
    expect(sc.payloadFingerprint).toBe(FIXTURE_Y_FINGERPRINT);
  });
});

// ---------------------------------------------------------------------------
// T3: Polygon refusal — CHAIN_ID_MISMATCH (D-03)
// ---------------------------------------------------------------------------
describe("prepare_lido_unwrap — Polygon refusal (D-03)", () => {
  it("chain: 'polygon' → CHAIN_ID_MISMATCH; createHandle NEVER called", async () => {
    const result = await callTool({ chain: "polygon", wstethAmount: FIXTURE_Y_AMOUNT });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "CHAIN_ID_MISMATCH",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// T4: Invalid amount — INVALID_INPUT
// ---------------------------------------------------------------------------
describe("prepare_lido_unwrap — invalid amount", () => {
  it("wstethAmount: 'abc' → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", wstethAmount: "abc" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("wstethAmount: '1.1234567890123456789' (19 frac digits) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", wstethAmount: "1.1234567890123456789" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------
// T5: NO allowance pre-flight — assert no readContract call with "allowance"
// ---------------------------------------------------------------------------
describe("prepare_lido_unwrap — no allowance pre-flight", () => {
  it("happy path: readContract is NEVER called with functionName: 'allowance'", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    mockReadContract.mockResolvedValue(0n); // should not be called

    const result = await callTool({ chain: "ethereum", wstethAmount: FIXTURE_Y_AMOUNT });

    expect(result.isError).toBeFalsy();

    // Verify no allowance readContract call was made
    const allowanceCalls = mockReadContract.mock.calls.filter(
      (call) => (call[0] as { functionName?: string }).functionName === "allowance",
    );
    expect(allowanceCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T6: NO LEDGER NOTICE (D-12 — clear-sign confirmed)
// ---------------------------------------------------------------------------
describe("prepare_lido_unwrap — NO LEDGER NOTICE (D-12)", () => {
  it("success response text does NOT contain 'LEDGER NOTICE' substring", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", wstethAmount: FIXTURE_Y_AMOUNT });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toMatch(/LEDGER.?NOTICE/i);
  });
});

// ---------------------------------------------------------------------------
// T7: Zero amount accepted
// ---------------------------------------------------------------------------
describe("prepare_lido_unwrap — zero amount accepted", () => {
  it("wstethAmount: '0' → success; valueWei === '0'; data starts with unwrap selector", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", wstethAmount: "0" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { valueWei: string; data: string };
    expect(sc.valueWei).toBe("0");
    expect(sc.data.slice(0, 10).toLowerCase()).toBe(UNWRAP_SELECTOR);
  });
});

// ---------------------------------------------------------------------------
// T8: register-all wiring smoke
// ---------------------------------------------------------------------------
describe("prepare_lido_unwrap — register-all wiring", () => {
  it("prepare_lido_unwrap is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_lido_unwrap");
  });

  it("inputSchema requires chain + wstethAmount; chain enum is ['ethereum']", () => {
    const tool = getRegisteredTool("prepare_lido_unwrap");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "wstethAmount"]);
    expect(tool.inputSchema.properties?.chain).toMatchObject({
      type: "string",
      enum: ["ethereum"],
    });
  });

  it("handle stored shape: tx.to === getLidoWstethAddress(1); valueWei === 0n; data starts with unwrap selector", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", wstethAmount: FIXTURE_Y_AMOUNT });
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.tx.chainId).toBe(1);
    expect(record.tx.to).toBe(WSTETH_ADDR);
    expect(record.tx.valueWei).toBe(0n);
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(UNWRAP_SELECTOR);
    expect(record.tx.data.length).toBe(74);
    expect(record.payloadFingerprint).toBe(FIXTURE_Y_FINGERPRINT);
  });
});

// ---------------------------------------------------------------------------
// PREPARE RECEIPT verbatim
// ---------------------------------------------------------------------------
describe("prepare_lido_unwrap — PREPARE RECEIPT verbatim", () => {
  it("receipt text matches LIDO_UNWRAP_PREPARE_RECEIPT_TEMPLATE byte-identically", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ chain: "ethereum", wstethAmount: FIXTURE_Y_AMOUNT });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = LIDO_UNWRAP_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{WSTETH_CONTRACT}", WSTETH_ADDR)
      .replace("{AMOUNT}", FIXTURE_Y_AMOUNT);
    expect(text).toBe(expected);
  });
});
