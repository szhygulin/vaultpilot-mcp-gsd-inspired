// prepare_weth_unwrap tests — 10-case ladder mirroring prepare-token-approve.
// Phase 6 — Plan 06-04 (PREP-28).
//
// Anchors:
//   - Real-mode pair-required (WALLET_NOT_PAIRED)
//   - Demo-mode persona-as-from (Plan 05-02 Option B) + null-persona WRONG_MODE
//   - INVALID_INPUT branches: malformed amount (format / fractional-overflow /
//     "max" sentinel rejection)
//   - amount: "0" accepted (zero-unwrap is the no-op success path)
//   - Fixture F fingerprint anchor (cross-link to signing-fingerprint.test.ts)
//   - Verbatim PREPARE RECEIPT (PREP-02 / T-PREP-RCPT-1 mitigation)
//   - Handle stored shape: tx.to === getWethAddress(1) byte-identically
//     (T-WETH-ADDR-INLINE-1 cross-import assertion)
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
      throw new Error("pair should not be called from prepare_weth_unwrap tests");
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

import { getWethAddress } from "../src/config/contracts.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
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
  const tool = getRegisteredTool("prepare_weth_unwrap");
  if (!tool) throw new Error("prepare_weth_unwrap not registered");
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

const WETH_CHECKSUMMED = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Fixture F — Plan 06-04 execute-time anchor (cross-link to
// test/signing-fingerprint.test.ts).
const FIXTURE_F_FINGERPRINT =
  "0x81a70e4a703de01b67ad1aaff7d97be8dde3ae6703a652a462f7de9e30e36596";
const FIXTURE_F_AMOUNT = "1.0";
const FIXTURE_F_AMOUNT_WEI = "1000000000000000000"; // 1e18

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

describe("prepare_weth_unwrap — pair-required (real mode, T-PAIR-1)", () => {
  it("getStatus returns null → WALLET_NOT_PAIRED; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(null);

    const result = await callTool({ amount: FIXTURE_F_AMOUNT });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_weth_unwrap — demo mode succeeds with active persona (Plan 05-02 Option B)", () => {
  const WHALE_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  it("demo + whale → success; from === whale; amount=1.0 → amountWei=1e18; getStatus NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");

    const result = await callTool({ amount: FIXTURE_F_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chainId: number;
      from: string;
      tokenAddress: string;
      amount: string;
      amountWei: string;
      payloadFingerprint: string;
    };
    expect(sc.from).toBe(WHALE_ADDRESS);
    expect(sc.chainId).toBe(1);
    expect(sc.tokenAddress).toBe(WETH_CHECKSUMMED);
    expect(sc.amount).toBe(FIXTURE_F_AMOUNT);
    expect(sc.amountWei).toBe(FIXTURE_F_AMOUNT_WEI);
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // T-DEMO-1: getStatus is NEVER called in demo mode.
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(1);
  });
});

describe("prepare_weth_unwrap — demo mode WRONG_MODE on null persona (T-NULL-PERSONA-1)", () => {
  it("demo + no persona → WRONG_MODE; getStatus + createHandle NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();

    const result = await callTool({ amount: FIXTURE_F_AMOUNT });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("WRONG_MODE");
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_weth_unwrap — INVALID_INPUT branches", () => {
  it("invalid 'amount' format (scientific 1e6) → INVALID_INPUT (kind: format)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ amount: "1e6" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/amount/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("invalid 'amount' fractional-overflow (19 fractional digits vs decimals=18) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    // 19 fractional digits — 1 more than WETH9_DECIMALS=18.
    const result = await callTool({ amount: "1.1234567890123456789" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/fractional|decimals|amount/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("amount: 'max' rejected (no max-balance sentinel; pass concrete decimal)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ amount: "max" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_weth_unwrap — zero-unwrap success path (amount: '0' accepted)", () => {
  it("amount: '0' → success; amountWei === '0'; data starts with withdraw selector", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ amount: "0" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { amount: string; amountWei: string };
    expect(sc.amount).toBe("0");
    expect(sc.amountWei).toBe("0");
    expect(createHandleSpy).toHaveBeenCalledTimes(1);
  });
});

describe("prepare_weth_unwrap — Fixture F fingerprint anchor (PREP-03 + T-BIND-1)", () => {
  it("real-mode end-to-end: structuredContent.payloadFingerprint === Fixture F literal", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ amount: FIXTURE_F_AMOUNT });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_F_FINGERPRINT);
  });
});

describe("prepare_weth_unwrap — verbatim PREPARE RECEIPT (PREP-02 / T-PREP-RCPT-1)", () => {
  it("amount input round-trips byte-identically; tokenAddress is the canonical SOT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ amount: FIXTURE_F_AMOUNT });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{TOKEN_ADDRESS}", WETH_CHECKSUMMED)
      .replace("{AMOUNT}", FIXTURE_F_AMOUNT);
    expect(text).toBe(expected);

    // The token address surfaced in the receipt is the canonical SOT
    // (checksummed). This is the verbatim cross-check for the on-device
    // hash match.
    expect(text).toContain(WETH_CHECKSUMMED);
    expect(text).toContain(FIXTURE_F_AMOUNT);
  });
});

describe("prepare_weth_unwrap — handle stored shape (T-WETH-ADDR-INLINE-1 cross-import)", () => {
  it("record.tx.to === getWethAddress(1) byte-identically; tx.data starts with withdraw selector", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ amount: FIXTURE_F_AMOUNT });
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.status).toBe("prepared");
    expect(record.pinned).toBeUndefined();

    // T-WETH-ADDR-INLINE-1: tx.to is the SOT-canonical WETH9 address —
    // byte-identical to getWethAddress(1) which delegates to
    // src/config/contracts.ts. Drift in the SOT ALSO fails this assertion.
    expect(record.tx.chainId).toBe(1);
    expect(record.tx.to).toBe(getWethAddress(1));
    expect(record.tx.valueWei).toBe(0n);
    expect(record.tx.data.startsWith("0x2e1a7d4d")).toBe(true);
    expect(record.tx.data.length).toBe(74);

    // args fields — RAW agent strings (no normalization).
    expect(record.args.tokenAddress).toBe(WETH_CHECKSUMMED);
    expect(record.args.amount).toBe(FIXTURE_F_AMOUNT);
    expect(record.args.to).toBe(""); // withdraw has no recipient
    expect(record.args.valueWei).toBe("0");

    // payloadFingerprint binding (Fixture F for this exact input shape).
    expect(record.payloadFingerprint).toBe(FIXTURE_F_FINGERPRINT);
  });
});

describe("prepare_weth_unwrap — register-all wiring (smoke)", () => {
  it("prepare_weth_unwrap is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_weth_unwrap");
  });

  it("inputSchema requires chain + amount (no `to`, no `tokenAddress`) — Plan 08-02 adds chain", () => {
    const tool = getRegisteredTool("prepare_weth_unwrap");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "amount"]);
    expect(tool.inputSchema.properties?.chain).toMatchObject({
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
    });
  });

  it("register-all.ts contains the side-effect import line for ./prepare_weth_unwrap.js", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = url.fileURLToPath(new URL(".", import.meta.url));
    const target = path.resolve(here, "..", "src", "tools", "register-all.ts");
    const source = await fs.readFile(target, "utf8");
    expect(source).toContain('import "./prepare_weth_unwrap.js";');
  });
});
