// prepare_token_approve tests — 13-case ladder mirroring prepare-token-send.
// Phase 6 — Plan 06-03 (PREP-26).
//
// Anchors:
//   - Real-mode pair-required (WALLET_NOT_PAIRED)
//   - Demo-mode persona-as-from (Plan 05-02 Option B) + null-persona WRONG_MODE
//   - INVALID_INPUT branches: malformed tokenAddress / spender / amount
//     (format, fractional-overflow, strict-spelling "MAX" / "unlimited")
//   - `amount: "max"` → MAX_UINT256 (T-MAX-SPELLING-1 mitigation parity)
//   - Fixture E fingerprint anchor (cross-link to signing-fingerprint.test.ts)
//   - Verbatim PREPARE RECEIPT (PREP-02 / T-PREP-RCPT-1 mitigation)
//   - Handle stored shape (record.args has split fields; record.tx.data
//     starts with the approve selector 0x095ea7b3)
//   - register-all wiring smoke

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
      throw new Error("pair should not be called from prepare_token_approve tests");
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

import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { APPROVE_PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
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
  const tool = getRegisteredTool("prepare_token_approve");
  if (!tool) throw new Error("prepare_token_approve not registered");
  // Phase 8 — Plan 08-02: chain arg REQUIRED; default to "ethereum".
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const PRIMARY_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as `0x${string}`;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [PRIMARY_ADDRESS],
  activeAccount: PRIMARY_ADDRESS,
  address: PRIMARY_ADDRESS,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

// USDC top-50 registry hit (decimals=6, symbol="USDC").
const USDC_CHECKSUMMED = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDC_LOWERCASE = USDC_CHECKSUMMED.toLowerCase();
// Uniswap V3 SwapRouter — the canonical known spender used in tests
// throughout this suite + the Fixture E literal.
const UNI_V3_CHECKSUMMED = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const UNI_V3_LOWERCASE = UNI_V3_CHECKSUMMED.toLowerCase();
// WETH9 — used for the Fixture E cross-link.
const WETH_CHECKSUMMED = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Fixture E — Plan 06-03 execute-time anchor (cross-link to
// test/signing-fingerprint.test.ts).
const FIXTURE_E_FINGERPRINT =
  "0x46e20ff806defcabda8eb090f6cba368cb5b84ad058ff9eefd08c662185a8f5a";
const MAX_UINT256_STR = ((1n << 256n) - 1n).toString();

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

describe("prepare_token_approve — pair-required (real mode, T-PAIR-1)", () => {
  it("getStatus returns null → WALLET_NOT_PAIRED; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(null);

    const result = await callTool({
      tokenAddress: USDC_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_token_approve — demo mode succeeds with active persona (Plan 05-02 Option B)", () => {
  const WHALE_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  it("demo + whale → success; from === whale; amount=100 → amountWei=100000000; getStatus NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");

    const result = await callTool({
      tokenAddress: USDC_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chainId: number;
      from: string;
      spender: string;
      tokenAddress: string;
      amount: string;
      amountWei: string;
      payloadFingerprint: string;
    };
    expect(sc.from).toBe(WHALE_ADDRESS);
    expect(sc.chainId).toBe(1);
    expect(sc.spender).toBe(UNI_V3_CHECKSUMMED);
    expect(sc.tokenAddress).toBe(USDC_CHECKSUMMED);
    expect(sc.amount).toBe("100");
    expect(sc.amountWei).toBe("100000000");
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // T-DEMO-1: getStatus is NEVER called in demo mode.
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(1);
  });
});

describe("prepare_token_approve — demo mode WRONG_MODE on null persona (T-NULL-PERSONA-1)", () => {
  it("demo + no persona → WRONG_MODE; getStatus + createHandle NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();

    const result = await callTool({
      tokenAddress: USDC_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("WRONG_MODE");
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_token_approve — INVALID_INPUT branches", () => {
  it("invalid 'tokenAddress' (0xnotacontract) → INVALID_INPUT; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      tokenAddress: "0xnotacontract",
      spender: UNI_V3_CHECKSUMMED,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/tokenAddress/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("invalid 'spender' (0xnotaspender) → INVALID_INPUT; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      tokenAddress: USDC_CHECKSUMMED,
      spender: "0xnotaspender",
      amount: "100",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/spender/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("invalid 'amount' format (100.5e6 — scientific) → INVALID_INPUT (kind: format)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      tokenAddress: USDC_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
      amount: "100.5e6",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/amount/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("invalid 'amount' fractional-overflow (100.1234567 vs USDC decimals=6) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      tokenAddress: USDC_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
      amount: "100.1234567",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/fractional|decimals|amount/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_token_approve — `max` sentinel (PREP-26 / T-MAX-SPELLING-1)", () => {
  it("amount: \"max\" → amountWei === 2^256-1; createHandle called once", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      tokenAddress: USDC_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
      amount: "max",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { amountWei: string; amount: string };
    expect(sc.amountWei).toBe(MAX_UINT256_STR);
    expect(sc.amount).toBe("max"); // raw agent string preserved
    expect(createHandleSpy).toHaveBeenCalledTimes(1);
  });

  it("amount: \"MAX\" (capital) REJECTED → INVALID_INPUT (T-MAX-SPELLING-1)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      tokenAddress: USDC_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
      amount: "MAX",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("amount: \"unlimited\" REJECTED → INVALID_INPUT (T-MAX-SPELLING-1)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      tokenAddress: USDC_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
      amount: "unlimited",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_token_approve — Fixture E fingerprint anchor (PREP-03 + T-BIND-1)", () => {
  it("WETH approve(Uniswap V3, max) → structuredContent.payloadFingerprint === Fixture E", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      tokenAddress: WETH_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
      amount: "max",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_E_FINGERPRINT);
  });
});

describe("prepare_token_approve — verbatim PREPARE RECEIPT (PREP-02 / T-PREP-RCPT-1)", () => {
  it("lowercase token + lowercase spender round-trip byte-identically in the receipt", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      tokenAddress: USDC_LOWERCASE,
      spender: UNI_V3_LOWERCASE,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = APPROVE_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{TOKEN_ADDRESS}", USDC_LOWERCASE)
      .replace("{SPENDER}", UNI_V3_LOWERCASE)
      .replace("{AMOUNT}", "100");
    expect(text).toBe(expected);

    // Verbatim — checksummed forms must NOT appear in the receipt.
    expect(text).toContain(USDC_LOWERCASE);
    expect(text).toContain(UNI_V3_LOWERCASE);
    expect(text).not.toContain(USDC_CHECKSUMMED);
    expect(text).not.toContain(UNI_V3_CHECKSUMMED);

    const sc = result.structuredContent as { tokenAddress: string; spender: string };
    expect(sc.tokenAddress).toBe(USDC_LOWERCASE);
    expect(sc.spender).toBe(UNI_V3_LOWERCASE);
  });
});

describe("prepare_token_approve — handle stored shape (PREP-02 + T-TX-TO-CONFUSION-1)", () => {
  it("record.args carries RAW agent strings; record.tx.to is TOKEN CONTRACT; data starts with approve selector", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      tokenAddress: WETH_CHECKSUMMED.toLowerCase(),
      spender: UNI_V3_LOWERCASE,
      amount: "max",
    });
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.status).toBe("prepared");
    expect(record.pinned).toBeUndefined();

    // tx fields — viem-typed. tx.to is the TOKEN CONTRACT (checksummed),
    // tx.valueWei is 0n, tx.data starts with the approve selector
    // 0x095ea7b3.
    expect(record.tx.chainId).toBe(1);
    expect(record.tx.to).toBe(WETH_CHECKSUMMED);
    expect(record.tx.valueWei).toBe(0n);
    expect(record.tx.data.startsWith("0x095ea7b3")).toBe(true);
    expect(record.tx.data.length).toBe(138);

    // args fields — RAW agent strings (NO normalization).
    expect(record.args.tokenAddress).toBe(WETH_CHECKSUMMED.toLowerCase());
    expect(record.args.spender).toBe(UNI_V3_LOWERCASE);
    expect(record.args.amount).toBe("max");
    expect(record.args.valueWei).toBe("0");
    expect(record.args.to).toBe(""); // approve has no recipient — only a spender

    // payloadFingerprint binding (Fixture E for this exact input shape).
    expect(record.payloadFingerprint).toBe(FIXTURE_E_FINGERPRINT);
  });
});

describe("prepare_token_approve — register-all wiring (smoke)", () => {
  it("prepare_token_approve is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_token_approve");
  });

  it("inputSchema requires chain + tokenAddress + spender + amount (Plan 08-02)", () => {
    const tool = getRegisteredTool("prepare_token_approve");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "tokenAddress", "spender", "amount"]);
    const props = tool.inputSchema.properties ?? {};
    expect(props.chain).toMatchObject({
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
    });
  });

  it("register-all.ts contains the side-effect import line for ./prepare_token_approve.js", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = url.fileURLToPath(new URL(".", import.meta.url));
    const target = path.resolve(here, "..", "src", "tools", "register-all.ts");
    const source = await fs.readFile(target, "utf8");
    expect(source).toContain('import "./prepare_token_approve.js";');
  });
});
