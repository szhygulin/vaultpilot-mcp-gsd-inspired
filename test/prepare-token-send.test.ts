// prepare_token_send tests — 11-case ladder mirroring prepare-native-send.test.ts.
// Phase 6 — Plan 06-02.
//
// Anchors:
//   - Real-mode pair-required (WALLET_NOT_PAIRED)
//   - Demo-mode persona-as-from (Plan 05-02 Option B) + null-persona WRONG_MODE
//   - INVALID_INPUT branches: malformed to, tokenAddress, amount (format),
//     amount (fractional-overflow vs decimals=6 for USDC)
//   - Fixture D fingerprint anchor (cross-link to signing-fingerprint.test.ts)
//   - Verbatim PREPARE RECEIPT (T-TX-TO-CONFUSION-1 / T-PREP-RCPT-1 mitigation)
//   - Handle stored with split args / tx shapes
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
      throw new Error("pair should not be called from prepare_token_send tests");
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
import { ERC20_PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
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
  const tool = getRegisteredTool("prepare_token_send");
  if (!tool) throw new Error("prepare_token_send not registered");
  // Phase 8 — Plan 08-02: chain arg REQUIRED; default to "ethereum" so the
  // Fixture D / E pre-Plan-08-02 anchors continue to flow.
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
const RECIPIENT_CHECKSUMMED = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT_LOWERCASE = RECIPIENT_CHECKSUMMED.toLowerCase();

// Fixture D — Plan 06-02 execute-time anchor (cross-link to
// test/signing-fingerprint.test.ts).
const FIXTURE_D_FINGERPRINT =
  "0x52f396cfab6f8f4dfbf10b36734e7d22e944d54657a72dc2c8d67e91f8c49f85";
const FIXTURE_D_AMOUNT = "100";
const FIXTURE_D_AMOUNT_WEI = "100000000"; // 100 * 10^6

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

describe("prepare_token_send — pair-required (real mode, T-PAIR-1)", () => {
  it("getStatus returns null → WALLET_NOT_PAIRED; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(null);

    const result = await callTool({
      to: RECIPIENT_CHECKSUMMED,
      tokenAddress: USDC_CHECKSUMMED,
      amount: FIXTURE_D_AMOUNT,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_token_send — demo mode succeeds with active persona (Plan 05-02 Option B)", () => {
  const WHALE_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  it("demo + whale active → success; from === whale; amountWei === 100000000; payloadFingerprint === Fixture D", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");

    const result = await callTool({
      to: RECIPIENT_CHECKSUMMED,
      tokenAddress: USDC_CHECKSUMMED,
      amount: FIXTURE_D_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chainId: number;
      from: string;
      to: string;
      tokenAddress: string;
      amount: string;
      amountWei: string;
      payloadFingerprint: string;
    };
    expect(sc.from).toBe(WHALE_ADDRESS);
    expect(sc.chainId).toBe(1);
    expect(sc.to).toBe(RECIPIENT_CHECKSUMMED);
    expect(sc.tokenAddress).toBe(USDC_CHECKSUMMED);
    expect(sc.amount).toBe(FIXTURE_D_AMOUNT);
    expect(sc.amountWei).toBe(FIXTURE_D_AMOUNT_WEI);
    expect(sc.payloadFingerprint).toBe(FIXTURE_D_FINGERPRINT);
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // T-DEMO-1: getStatus is NEVER called in demo mode.
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(1);
  });
});

describe("prepare_token_send — demo mode WRONG_MODE on null persona (T-NULL-PERSONA-1)", () => {
  it("demo + no persona → WRONG_MODE; getStatus + createHandle NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();

    const result = await callTool({
      to: RECIPIENT_CHECKSUMMED,
      tokenAddress: USDC_CHECKSUMMED,
      amount: FIXTURE_D_AMOUNT,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WRONG_MODE",
    );
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_token_send — INVALID_INPUT branches", () => {
  it("invalid 'to' (0xnotanaddress) → INVALID_INPUT; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      to: "0xnotanaddress",
      tokenAddress: USDC_CHECKSUMMED,
      amount: FIXTURE_D_AMOUNT,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/to|address/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("invalid 'tokenAddress' (0xnotacontract) → INVALID_INPUT; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      to: RECIPIENT_CHECKSUMMED,
      tokenAddress: "0xnotacontract",
      amount: FIXTURE_D_AMOUNT,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/tokenAddress/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("invalid 'amount' format (100.5e6 — scientific) → INVALID_INPUT (kind: format)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      to: RECIPIENT_CHECKSUMMED,
      tokenAddress: USDC_CHECKSUMMED,
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
      to: RECIPIENT_CHECKSUMMED,
      tokenAddress: USDC_CHECKSUMMED,
      amount: "100.1234567",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/fractional|decimals|amount/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("rejects 'max' as a non-decimal-shape amount (PREP-29 is approve territory, not transfer)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      to: RECIPIENT_CHECKSUMMED,
      tokenAddress: USDC_CHECKSUMMED,
      amount: "max",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });
});

describe("prepare_token_send — Fixture D fingerprint anchor (PREP-03 + T-BIND-1)", () => {
  it("real-mode end-to-end: structuredContent.payloadFingerprint === Fixture D literal", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      to: RECIPIENT_CHECKSUMMED,
      tokenAddress: USDC_CHECKSUMMED,
      amount: FIXTURE_D_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_D_FINGERPRINT);
  });
});

describe("prepare_token_send — verbatim PREPARE RECEIPT (PREP-02 + T-TX-TO-CONFUSION-1)", () => {
  it("lowercase token + lowercase recipient inputs round-trip byte-identically in the receipt", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      to: RECIPIENT_LOWERCASE,
      tokenAddress: USDC_LOWERCASE,
      amount: FIXTURE_D_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = ERC20_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{TOKEN_ADDRESS}", USDC_LOWERCASE)
      .replace("{TO}", RECIPIENT_LOWERCASE)
      .replace("{AMOUNT}", FIXTURE_D_AMOUNT);
    expect(text).toBe(expected);

    // T-TX-TO-CONFUSION-1: the receipt labels tokenAddress + to DISTINCTLY.
    // A future contributor surfacing record.tx.to as "recipient" would
    // break the lowercase round-trip below (record.tx.to is checksummed).
    expect(text).toContain(USDC_LOWERCASE);
    expect(text).toContain(RECIPIENT_LOWERCASE);
    expect(text).not.toContain(USDC_CHECKSUMMED);
    expect(text).not.toContain(RECIPIENT_CHECKSUMMED);

    // structuredContent.to + structuredContent.tokenAddress also verbatim.
    const sc = result.structuredContent as { to: string; tokenAddress: string };
    expect(sc.to).toBe(RECIPIENT_LOWERCASE);
    expect(sc.tokenAddress).toBe(USDC_LOWERCASE);
  });
});

describe("prepare_token_send — handle stored with split args / tx shape (PREP-02)", () => {
  it("record.args carries RAW agent strings; record.tx carries viem-typed values; tx.to is TOKEN CONTRACT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      to: RECIPIENT_LOWERCASE,
      tokenAddress: USDC_LOWERCASE,
      amount: FIXTURE_D_AMOUNT,
    });
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.status).toBe("prepared");
    expect(record.pinned).toBeUndefined();

    // tx fields — viem-typed. tx.to is the TOKEN CONTRACT (checksummed),
    // tx.valueWei is 0n, tx.data starts with the transfer selector.
    expect(record.tx.chainId).toBe(1);
    expect(record.tx.to).toBe(USDC_CHECKSUMMED);
    expect(record.tx.valueWei).toBe(0n);
    expect(record.tx.data.startsWith("0xa9059cbb")).toBe(true);
    expect(record.tx.data.length).toBe(138);

    // args fields — RAW agent strings (NO normalization).
    expect(record.args.to).toBe(RECIPIENT_LOWERCASE);
    expect(record.args.tokenAddress).toBe(USDC_LOWERCASE);
    expect(record.args.amount).toBe(FIXTURE_D_AMOUNT);
    expect(record.args.valueWei).toBe("0");

    // payloadFingerprint binding to args (via the tx shape).
    expect(record.payloadFingerprint).toBe(FIXTURE_D_FINGERPRINT);
  });
});

describe("prepare_token_send — register-all wiring (smoke)", () => {
  it("prepare_token_send is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_token_send");
  });

  it("inputSchema requires chain + to + tokenAddress + amount (Plan 08-02)", () => {
    const tool = getRegisteredTool("prepare_token_send");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "to", "tokenAddress", "amount"]);
    const props = tool.inputSchema.properties ?? {};
    expect(props.chain).toMatchObject({
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
    });
  });

  it("register-all.ts contains the side-effect import line for ./prepare_token_send.js", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = url.fileURLToPath(new URL(".", import.meta.url));
    const target = path.resolve(here, "..", "src", "tools", "register-all.ts");
    const source = await fs.readFile(target, "utf8");
    expect(source).toContain('import "./prepare_token_send.js";');
  });
});
