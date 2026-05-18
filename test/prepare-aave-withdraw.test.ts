// prepare_aave_withdraw tests — 10-case ladder mirroring prepare-aave-supply.
// Phase 7 — Plan 07-03 (PREP-23 withdraw leg).
//
// Anchors:
//   - Real-mode pair-required (WALLET_NOT_PAIRED)
//   - Demo-mode persona-as-from + to hardcoded (explicit-self-recipient lock)
//     + null-persona WRONG_MODE
//   - INVALID_INPUT branches: malformed asset / format / "max" sentinel
//     rejection (research § Topic 5 lock: NO max-balance sentinel in v1.1) /
//     fractional-overflow against USDC decimals=6
//   - Fixture H fingerprint anchor (cross-link to signing-fingerprint.test.ts)
//   - Verbatim PREPARE RECEIPT (PREP-02 / T-PREP-RCPT-1 mitigation)
//   - Handle stored shape: tx.to === getAaveV3PoolAddress(1); data starts
//     with withdraw selector (0x69328dec)

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
      throw new Error("pair should not be called from prepare_aave_withdraw tests");
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

import { getAaveV3PoolAddress } from "../src/config/contracts.js";
import { AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
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

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_aave_withdraw");
  if (!tool) throw new Error("prepare_aave_withdraw not registered");
  // Phase 8 — Plan 08-02: chain arg REQUIRED; default to "ethereum".
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
};

const USDC_CHECKSUMMED = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// Fixture H anchor — Plan 07-03 execute-time computation.
const FIXTURE_H_FINGERPRINT =
  "0x782dd9aa096d47a4036b2023c01c1306d3b325fbbbbd4da8a1a5cd3ce42be40d";
const FIXTURE_H_AMOUNT = "100";
const FIXTURE_H_AMOUNT_WEI = "100000000";

beforeEach(() => {
  getStatusSpy.mockReset();
  createHandleSpy.mockClear();
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

describe("prepare_aave_withdraw — pair-required (real mode, T-PAIR-1)", () => {
  it("getStatus returns null → WALLET_NOT_PAIRED; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(null);

    const result = await callTool({ asset: USDC_CHECKSUMMED, amount: FIXTURE_H_AMOUNT });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_aave_withdraw — demo mode succeeds with active persona", () => {
  const WHALE_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  it("demo + whale → success; from === whale; amount=100 → amountWei=100000000; getStatus NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");

    const result = await callTool({ asset: USDC_CHECKSUMMED, amount: FIXTURE_H_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chainId: number;
      from: string;
      asset: string;
      amount: string;
      amountWei: string;
      payloadFingerprint: string;
    };
    expect(sc.from).toBe(WHALE_ADDRESS);
    expect(sc.chainId).toBe(1);
    expect(sc.asset).toBe(USDC_CHECKSUMMED);
    expect(sc.amount).toBe(FIXTURE_H_AMOUNT);
    expect(sc.amountWei).toBe(FIXTURE_H_AMOUNT_WEI);
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(1);
  });
});

describe("prepare_aave_withdraw — demo mode WRONG_MODE on null persona (T-NULL-PERSONA-1)", () => {
  it("demo + no persona → WRONG_MODE; getStatus + createHandle NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();

    const result = await callTool({ asset: USDC_CHECKSUMMED, amount: FIXTURE_H_AMOUNT });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("WRONG_MODE");
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_aave_withdraw — INVALID_INPUT branches", () => {
  it("invalid 'asset' (not 0x-prefixed 20-byte hex) → INVALID_INPUT (before getStatus)", async () => {
    const result = await callTool({ asset: "0xnotanaddr", amount: FIXTURE_H_AMOUNT });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("amount: 'max' rejected (research § Topic 5 v1.1 lock — no max-balance sentinel)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ asset: USDC_CHECKSUMMED, amount: "max" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/amount/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("amount: 'unlimited' rejected (format)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ asset: USDC_CHECKSUMMED, amount: "unlimited" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("invalid 'amount' fractional-overflow (7 fractional digits vs USDC decimals=6) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ asset: USDC_CHECKSUMMED, amount: "1.1234567" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_aave_withdraw — Fixture H fingerprint anchor (PREP-03 + T-BIND-1)", () => {
  it("real-mode (anvil#1 paired): structuredContent.payloadFingerprint === Fixture H literal", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ asset: USDC_CHECKSUMMED, amount: FIXTURE_H_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_H_FINGERPRINT);
  });
});

describe("prepare_aave_withdraw — verbatim PREPARE RECEIPT (PREP-02 / T-PREP-RCPT-1)", () => {
  it("asset + amount round-trip byte-identically", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ asset: USDC_CHECKSUMMED, amount: FIXTURE_H_AMOUNT });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{ASSET}", USDC_CHECKSUMMED)
      .replace("{AMOUNT}", FIXTURE_H_AMOUNT);
    expect(text).toBe(expected);
    expect(text).toContain("Aave V3 withdraw");
    expect(text).toContain(USDC_CHECKSUMMED);
    expect(text).toContain(FIXTURE_H_AMOUNT);
  });
});

describe("prepare_aave_withdraw — handle stored shape (T-AAVE-POOL-ADDR-INLINE-1 cross-import)", () => {
  it("record.tx.to === getAaveV3PoolAddress(1); tx.data starts with withdraw selector", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ asset: USDC_CHECKSUMMED, amount: FIXTURE_H_AMOUNT });
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.status).toBe("prepared");
    expect(record.pinned).toBeUndefined();

    expect(record.tx.chainId).toBe(1);
    expect(record.tx.to).toBe(getAaveV3PoolAddress(1));
    expect(record.tx.valueWei).toBe(0n);
    expect(record.tx.data.startsWith("0x69328dec")).toBe(true);
    // 100-byte calldata = 4-byte selector + 3 × 32-byte args = 0x + 200 hex.
    expect(record.tx.data.length).toBe(202);

    expect(record.args.tokenAddress).toBe(USDC_CHECKSUMMED);
    expect(record.args.amount).toBe(FIXTURE_H_AMOUNT);
    expect(record.args.to).toBe("");
    expect(record.args.valueWei).toBe("0");

    expect(record.payloadFingerprint).toBe(FIXTURE_H_FINGERPRINT);
  });
});

describe("prepare_aave_withdraw — register-all wiring (smoke)", () => {
  it("prepare_aave_withdraw is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_aave_withdraw");
  });

  it("inputSchema requires chain + asset + amount (no `to` — explicit-self-recipient lock) — Plan 08-02 adds chain", () => {
    const tool = getRegisteredTool("prepare_aave_withdraw");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "asset", "amount"]);
    expect(tool.inputSchema.properties?.chain).toMatchObject({
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
    });
  });

  it("register-all.ts contains the side-effect import line for ./prepare_aave_withdraw.js", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = url.fileURLToPath(new URL(".", import.meta.url));
    const target = path.resolve(here, "..", "src", "tools", "register-all.ts");
    const source = await fs.readFile(target, "utf8");
    expect(source).toContain('import "./prepare_aave_withdraw.js";');
  });
});
