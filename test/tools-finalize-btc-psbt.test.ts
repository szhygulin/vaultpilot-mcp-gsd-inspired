// test/tools-finalize-btc-psbt.test.ts — Phase 25 Plan 25-03 (TDD RED)
//
// Tests for the finalize_btc_psbt MCP tool handler.
//
// Covers (behavior block from Plan 25-03):
//   - Returns PSBT_THRESHOLD_NOT_MET with under-threshold input indices when any
//     input has fewer than M signatures.
//   - Returns finalPsbtBase64 + txHex on a fully-signed PSBT.
//   - INVALID_INPUT for missing/wrong-type psbt or threshold arguments.
//   - INTERNAL_ERROR for a malformed PSBT base64.
//
// Seam: vi.spyOn(_btcPsbt, "finalizeBtcPsbt") — direct-transform tool, no handle.
// No Ledger transport required. No createHandle or payloadFingerprint used.

import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

beforeAll(() => {
  process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "memory";
});

afterEach(() => {
  vi.restoreAllMocks();
});

import { _btcPsbt } from "../src/protocols/btc-psbt.js";
import "../src/tools/finalize_btc_psbt.js";
import { getRegisteredTool } from "../src/tools/index.js";

function getHandler(name: string) {
  const tool = getRegisteredTool(name);
  if (!tool) return undefined;
  return (args: Record<string, unknown>) => tool.handler(args);
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("finalize_btc_psbt tool", () => {
  it("is registered", () => {
    const tool = getRegisteredTool("finalize_btc_psbt");
    expect(tool).toBeDefined();
  });

  it("returns INVALID_INPUT when psbt is missing", async () => {
    const handler = getHandler("finalize_btc_psbt");
    expect(handler).toBeDefined();
    const result = await handler!({ threshold: 2 });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when psbt is not a string", async () => {
    const handler = getHandler("finalize_btc_psbt");
    const result = await handler!({ psbt: 123, threshold: 2 });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when psbt is empty string", async () => {
    const handler = getHandler("finalize_btc_psbt");
    const result = await handler!({ psbt: "", threshold: 2 });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when threshold is missing", async () => {
    const handler = getHandler("finalize_btc_psbt");
    const result = await handler!({ psbt: "abc" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when threshold is less than 1", async () => {
    const handler = getHandler("finalize_btc_psbt");
    const result = await handler!({ psbt: "abc", threshold: 0 });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when threshold is not a number", async () => {
    const handler = getHandler("finalize_btc_psbt");
    const result = await handler!({ psbt: "abc", threshold: "two" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("returns PSBT_THRESHOLD_NOT_MET when finalizeBtcPsbt returns threshold-not-met", async () => {
    const handler = getHandler("finalize_btc_psbt");
    vi.spyOn(_btcPsbt, "finalizeBtcPsbt").mockReturnValue({
      kind: "threshold-not-met",
      underThresholdInputs: [0, 2],
    });

    const result = await handler!({ psbt: "dGVzdA==", threshold: 2 });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("PSBT_THRESHOLD_NOT_MET");
    // Should surface the under-threshold input indices
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/0/);
    expect(text).toMatch(/2/);
  });

  it("returns INTERNAL_ERROR when finalizeBtcPsbt returns error", async () => {
    const handler = getHandler("finalize_btc_psbt");
    vi.spyOn(_btcPsbt, "finalizeBtcPsbt").mockReturnValue({
      kind: "error",
      message: "PSBT parse failure",
    });

    const result = await handler!({ psbt: "dGVzdA==", threshold: 2 });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INTERNAL_ERROR");
  });

  it("returns finalPsbtBase64 and txHex on success", async () => {
    const handler = getHandler("finalize_btc_psbt");
    const FAKE_FINAL_PSBT = "ZmluYWw=";
    const FAKE_TX_HEX = "deadbeef";
    vi.spyOn(_btcPsbt, "finalizeBtcPsbt").mockReturnValue({
      kind: "ok",
      finalPsbtBase64: FAKE_FINAL_PSBT,
      txHex: FAKE_TX_HEX,
    });

    const result = await handler!({ psbt: "dGVzdA==", threshold: 2 });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["finalPsbtBase64"]).toBe(FAKE_FINAL_PSBT);
    expect(sc["txHex"]).toBe(FAKE_TX_HEX);
  });

  it("does NOT reference createHandle or payloadFingerprint (direct transform)", async () => {
    // This is verified by the grep check in acceptance criteria.
    // The test simply asserts the tool produces no handle in its structuredContent.
    const handler = getHandler("finalize_btc_psbt");
    vi.spyOn(_btcPsbt, "finalizeBtcPsbt").mockReturnValue({
      kind: "ok",
      finalPsbtBase64: "ZmluYWw=",
      txHex: "deadbeef",
    });

    const result = await handler!({ psbt: "dGVzdA==", threshold: 2 });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["handle"]).toBeUndefined();
    expect(sc["payloadFingerprint"]).toBeUndefined();
  });

  it("passes psbt and threshold to finalizeBtcPsbt spy", async () => {
    const handler = getHandler("finalize_btc_psbt");
    const spy = vi.spyOn(_btcPsbt, "finalizeBtcPsbt").mockReturnValue({
      kind: "ok",
      finalPsbtBase64: "ZmluYWw=",
      txHex: "ff",
    });

    await handler!({ psbt: "dGVzdA==", threshold: 3 });
    expect(spy).toHaveBeenCalledWith("dGVzdA==", 3);
  });
});
