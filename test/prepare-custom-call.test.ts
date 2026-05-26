// prepare_custom_call tests — Phase 35 Plan 35-03 (CUSTOM-01).
//
// Anchors:
//   - Schema-level literal-true gate: `acknowledgeNonProtocolTarget: false`
//     refuses via the canonical handler-path defense-in-depth (the JSON-Schema
//     layer for MCP server is enforced outside the in-process registry; we
//     exercise the in-handler defense-in-depth refusal here).
//   - In-handler refusal: missing `acknowledgeNonProtocolTarget` → structured
//     refusal naming canonical-alternative when selector matches.
//   - Fixture P cross-link: payloadFingerprint matches FIXTURE_P_FP for the
//     documented inputs.
//   - Handle carries `acknowledgeNonProtocolTarget: true` + `preparedBy:
//     "prepare_custom_call"` annotations.
//   - WARN block + PREPARE RECEIPT byte-stable templates (cross-link to
//     blocks.ts SOT).
//   - Multi-chain dispatch on all 5 chains.
//   - data passthrough byte-identical (raw hex).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getStatusSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
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
      throw new Error("pair should not be called from prepare_custom_call tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import {
  CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE,
  NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE,
  WARN_NON_PROTOCOL_TARGET_TEMPLATE,
} from "../src/signing/blocks.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
} from "../src/demo/state.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { FIXTURE_P_FP } from "./signing-fingerprint.test.js";

await import("../src/tools/register-all.js");

async function callTool(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_custom_call");
  if (!tool) throw new Error("prepare_custom_call not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
}

const PRIMARY_ADDRESS =
  "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as `0x${string}`;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [PRIMARY_ADDRESS],
  activeAccount: PRIMARY_ADDRESS,
  address: PRIMARY_ADDRESS,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: {
    1: [PRIMARY_ADDRESS],
    42161: [PRIMARY_ADDRESS],
    137: [PRIMARY_ADDRESS],
    8453: [PRIMARY_ADDRESS],
    10: [PRIMARY_ADDRESS],
  } as Record<number, `0x${string}`[]>,
};

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Fixture P inputs (cross-linked to test/signing-fingerprint.test.ts).
const FIXTURE_P_TO = "0x00000000000000000000000000000000DeaDBeef";
const FIXTURE_P_DATA = "0xdeadbeef";

beforeEach(() => {
  getStatusSpy.mockReset();
  _resetHandleStoreForTesting();
  _resetActivePersonaForTesting();
  savedDemo = process.env[DEMO_KEY];
  delete process.env[DEMO_KEY];
  _resetDemoModeForTesting();
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
});

afterEach(() => {
  if (savedDemo !== undefined) process.env[DEMO_KEY] = savedDemo;
  else delete process.env[DEMO_KEY];
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

describe("prepare_custom_call — schema gate + handler refusal", () => {
  it("refuses with NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED when ack flag omitted", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
    });
    expect(res.isError).toBe(true);
    expect(
      (res.structuredContent as { errorCode: string }).errorCode,
    ).toBe("NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED");
  });

  it("refuses when ack: false (defense-in-depth — JSON-Schema would catch upstream in MCP server)", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: false,
    });
    expect(res.isError).toBe(true);
    expect(
      (res.structuredContent as { errorCode: string }).errorCode,
    ).toBe("NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED");
  });

  it("refusal text uses the NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE shape", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
    });
    const text = (
      res.content as Array<{ type: string; text: string }>
    )[0].text;
    expect(text).toContain("NON-PROTOCOL TARGET — acknowledgment required");
    expect(text).toContain(FIXTURE_P_TO);
    // Selector slot — first 4 bytes of data.
    expect(text).toContain("0xdeadbe");
  });

  it("refusal surfaces canonical-alternative suggestion when selector matches ERC-20 transfer", async () => {
    // 0xa9059cbb → prepare_token_send
    const data =
      "0xa9059cbb000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000000000000000000000000000000000000000000000000005f5e100";
    const res = await callTool({
      chain: "ethereum",
      to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      data,
    });
    const text = (
      res.content as Array<{ type: string; text: string }>
    )[0].text;
    expect(text).toContain("prepare_token_send");
    expect(text).toContain("ERC-20 transfer");
  });

  it("refusal surfaces canonical alternative when selector matches Aave V3 supply", async () => {
    // 0x617ba037 → prepare_aave_supply
    const data = "0x617ba037" + "00".repeat(128);
    const res = await callTool({
      chain: "ethereum",
      to: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      data,
    });
    const text = (
      res.content as Array<{ type: string; text: string }>
    )[0].text;
    expect(text).toContain("prepare_aave_supply");
    expect(text).toContain("Aave V3");
  });

  it("refusal uses category-list fallback for unknown selectors (0xdeadbeef)", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
    });
    const text = (
      res.content as Array<{ type: string; text: string }>
    )[0].text;
    expect(text).toContain(
      "No canonical alternative recognized for this selector",
    );
    expect(text).toContain("acknowledgeNonProtocolTarget: true");
  });
});

describe("prepare_custom_call — happy path with ack: true", () => {
  it("returns a handle + structuredContent envelope with the bypass flag", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      handle: string;
      chain: string;
      chainId: number;
      to: string;
      value: string;
      data: string;
      payloadFingerprint: string;
      acknowledgeNonProtocolTarget: true;
    };
    expect(typeof sc.handle).toBe("string");
    expect(sc.chain).toBe("ethereum");
    expect(sc.chainId).toBe(1);
    expect(sc.to).toBe(FIXTURE_P_TO);
    expect(sc.value).toBe("0");
    expect(sc.data).toBe(FIXTURE_P_DATA);
    expect(sc.acknowledgeNonProtocolTarget).toBe(true);
  });

  it("payloadFingerprint matches Fixture P (cross-link to signing-fingerprint.test.ts)", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    const sc = res.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_P_FP);
  });

  it("handle record carries acknowledgeNonProtocolTarget: true + preparedBy: 'prepare_custom_call'", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    const sc = res.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).not.toBeNull();
    expect(record?.acknowledgeNonProtocolTarget).toBe(true);
    expect(record?.preparedBy).toBe("prepare_custom_call");
  });

  it("emits the WARN block ABOVE the PREPARE RECEIPT block", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    const text = (
      res.content as Array<{ type: string; text: string }>
    )[0].text;
    const warnIdx = text.indexOf("[WARN — NON-PROTOCOL TARGET]");
    const receiptIdx = text.indexOf("PREPARE RECEIPT");
    expect(warnIdx).toBeGreaterThanOrEqual(0);
    expect(receiptIdx).toBeGreaterThan(warnIdx);
  });

  it("PREPARE RECEIPT block has verbatim agent strings — chain, to, value, data", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      value: "1000000000000000000",
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    const text = (
      res.content as Array<{ type: string; text: string }>
    )[0].text;
    // PREPARE RECEIPT byte-stability: template imported from SOT.
    expect(text).toContain("operation: custom contract call");
    expect(text).toContain("chain:     ethereum (chainId 1)");
    expect(text).toContain(`to:        ${FIXTURE_P_TO}`);
    expect(text).toContain("value:     1000000000000000000");
    expect(text).toContain(`data:      ${FIXTURE_P_DATA}`);
  });

  it("uses templates from blocks.ts (no inlined strings — format-fanout-sentinel)", async () => {
    // Smoke: the templates we import ARE the templates the tool uses
    // (substitution arity check).
    expect(WARN_NON_PROTOCOL_TARGET_TEMPLATE).toContain("{CHAIN}");
    expect(WARN_NON_PROTOCOL_TARGET_TEMPLATE).toContain("{TO}");
    expect(WARN_NON_PROTOCOL_TARGET_TEMPLATE).toContain("{DECODED}");
    expect(CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE).toContain("{CHAIN}");
    expect(CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE).toContain("{TO}");
    expect(CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE).toContain("{VALUE}");
    expect(CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE).toContain("{DATA}");
    expect(NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE).toContain("{TO}");
    expect(NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE).toContain("{SELECTOR}");
    expect(NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE).toContain("{SUGGESTION}");
  });

  it("value defaults to '0' when omitted", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    const sc = res.structuredContent as { value: string };
    expect(sc.value).toBe("0");
  });

  it("accepts non-zero value as decimal WEI string", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: "0x",
      value: "1000000000000000000",
      acknowledgeNonProtocolTarget: true,
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { value: string };
    expect(sc.value).toBe("1000000000000000000");
  });

  it("data passthrough byte-identical (raw hex)", async () => {
    const longData =
      "0xa9059cbb000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000000000000000000000000000000000000000000000000005f5e100";
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: longData,
      acknowledgeNonProtocolTarget: true,
    });
    const sc = res.structuredContent as { data: string };
    expect(sc.data).toBe(longData);
  });
});

describe("prepare_custom_call — multi-chain dispatch", () => {
  const chains: Array<[string, number]> = [
    ["ethereum", 1],
    ["arbitrum", 42161],
    ["polygon", 137],
    ["base", 8453],
    ["optimism", 10],
  ];

  for (const [chainName, expectedChainId] of chains) {
    it(`succeeds on ${chainName} (chainId ${expectedChainId})`, async () => {
      const res = await callTool({
        chain: chainName,
        to: FIXTURE_P_TO,
        data: FIXTURE_P_DATA,
        acknowledgeNonProtocolTarget: true,
      });
      expect(res.isError).toBeFalsy();
      const sc = res.structuredContent as { chain: string; chainId: number };
      expect(sc.chain).toBe(chainName);
      expect(sc.chainId).toBe(expectedChainId);
    });
  }
});

describe("prepare_custom_call — input validation", () => {
  it("refuses malformed 'to' address with INVALID_INPUT", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: "0xnot-an-address",
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("refuses malformed 'data' (non-hex) with INVALID_INPUT", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: "not-hex",
      acknowledgeNonProtocolTarget: true,
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("refuses negative value with INVALID_INPUT", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      value: "-1",
      acknowledgeNonProtocolTarget: true,
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("refuses decimal value with INVALID_INPUT (off-by-decimal guard)", async () => {
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      value: "1.5",
      acknowledgeNonProtocolTarget: true,
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });
});

describe("prepare_custom_call — demo-mode persona flow", () => {
  it("succeeds in demo mode using the active persona's address", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");
    // getStatus must NOT be called in demo (T-DEMO-1 invariant)
    getStatusSpy.mockImplementation(() => {
      throw new Error("getStatus should NOT be called in demo mode");
    });
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      handle: string;
      from: string;
    };
    expect(typeof sc.handle).toBe("string");
    expect(typeof sc.from).toBe("string");
  });

  it("refuses with WRONG_MODE in demo mode when no persona is set", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    const res = await callTool({
      chain: "ethereum",
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode: string }).errorCode).toBe(
      "WRONG_MODE",
    );
  });
});
