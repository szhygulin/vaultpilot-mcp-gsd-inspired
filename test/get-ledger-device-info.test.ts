// Plan 05-03 — get_ledger_device_info tool tests (DIAG-02 + T-DEVICE-INFO-CLAIM-1).
//
// Four tests:
//   1. Paired branch — full envelope shape with last-8 suffix + CAIP-2-inferred appOpen
//   2. Unpaired branch — null fields + actionable hint mentioning pair_ledger_live
//   3. T-DEVICE-INFO-CLAIM-1 (LOAD-BEARING) — `deviceConnected`/`firmware`
//      are LITERAL "unknown" across both branches; `appOpen` is one of the
//      two locked strings
//   4. Tool description names the inferred-state limitation explicitly
//      (routing-prompt teaches the agent the limitation)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import * as sessionManager from "../src/wallet/session-manager.js";

// Side-effect register the tool.
await import("../src/tools/get_ledger_device_info.js");

async function callTool(): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_ledger_device_info");
  if (!tool) throw new Error("get_ledger_device_info not registered");
  return tool.handler({});
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("get_ledger_device_info — paired branch (DIAG-02)", () => {
  it("Test 1 — getStatus returns a session → full envelope with last-8 suffix + inferred appOpen", async () => {
    vi.spyOn(sessionManager, "getStatus").mockResolvedValue({
      paired: true,
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      chainId: 1,
      sessionTopicLast8: "deadbeef",
    });

    const result = await callTool();
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      paired: boolean;
      address: string;
      chainId: number;
      sessionTopicSuffix: string;
      deviceConnected: string;
      appOpen: string;
      firmware: string;
      hint: string;
    };

    expect(sc.paired).toBe(true);
    expect(sc.address).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(sc.chainId).toBe(1);
    expect(sc.sessionTopicSuffix).toBe("deadbeef");
    expect(sc.deviceConnected).toBe("unknown");
    expect(sc.appOpen).toBe("Ethereum (inferred from CAIP-2 namespace)");
    expect(sc.firmware).toBe("unknown");
    expect(sc.hint).toMatch(/Ledger Live/);
  });
});

describe("get_ledger_device_info — unpaired branch", () => {
  it("Test 2 — getStatus returns null → null fields + pair_ledger_live hint", async () => {
    vi.spyOn(sessionManager, "getStatus").mockResolvedValue(null);

    const result = await callTool();
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      paired: boolean;
      address: string | null;
      chainId: number | null;
      sessionTopicSuffix: string | null;
      deviceConnected: string;
      appOpen: string;
      firmware: string;
      hint: string;
    };

    expect(sc.paired).toBe(false);
    expect(sc.address).toBeNull();
    expect(sc.chainId).toBeNull();
    expect(sc.sessionTopicSuffix).toBeNull();
    expect(sc.deviceConnected).toBe("unknown");
    expect(sc.appOpen).toBe("unknown");
    expect(sc.firmware).toBe("unknown");
    expect(sc.hint).toMatch(/pair_ledger_live/);
  });
});

describe("get_ledger_device_info — inferred-state lock (T-DEVICE-INFO-CLAIM-1)", () => {
  it("Test 3 (LOAD-BEARING) — deviceConnected/firmware ALWAYS 'unknown'; appOpen one of two locked strings", async () => {
    // Paired branch: assert each forbidden value individually.
    vi.spyOn(sessionManager, "getStatus").mockResolvedValue({
      paired: true,
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      chainId: 1,
      sessionTopicLast8: "abcdef01",
    });

    const paired = await callTool();
    const pairedSc = paired.structuredContent as {
      deviceConnected: string;
      appOpen: string;
      firmware: string;
    };

    // deviceConnected MUST be literal "unknown" — NEVER "connected" /
    // "disconnected" / a boolean / a status string. A future contributor
    // who adds a "helpful" probe would fail this test.
    expect(pairedSc.deviceConnected).toBe("unknown");
    expect(pairedSc.deviceConnected).not.toBe("connected");
    expect(pairedSc.deviceConnected).not.toBe("disconnected");

    // firmware MUST be literal "unknown" — NEVER a version string like
    // "2.2.1" or "Nano X 2.2.1".
    expect(pairedSc.firmware).toBe("unknown");
    expect(pairedSc.firmware).not.toMatch(/^\d+\.\d+/);

    // appOpen MUST be one of TWO locked strings.
    expect([
      "Ethereum (inferred from CAIP-2 namespace)",
      "unknown",
    ]).toContain(pairedSc.appOpen);

    // Unpaired branch — same three fields, same constraints; appOpen
    // collapses to "unknown" specifically when no session.
    vi.spyOn(sessionManager, "getStatus").mockResolvedValue(null);
    const unpaired = await callTool();
    const unpairedSc = unpaired.structuredContent as {
      deviceConnected: string;
      appOpen: string;
      firmware: string;
    };
    expect(unpairedSc.deviceConnected).toBe("unknown");
    expect(unpairedSc.firmware).toBe("unknown");
    expect(unpairedSc.appOpen).toBe("unknown");
  });
});

describe("get_ledger_device_info — tool description names limitation", () => {
  it("Test 4 — routing-prompt teaches the agent the inferred-state limitation", () => {
    const tool = getRegisteredTool("get_ledger_device_info");
    if (!tool) throw new Error("get_ledger_device_info not registered");

    // The description MUST name the limitation explicitly so the routing
    // agent understands "this isn't a real probe."
    expect(tool.description).toMatch(/does NOT probe|WalletConnect.*no method|INFERRED-STATE/i);
    expect(tool.description).toMatch(/Ledger Live/);
    // Minimum description length — registerTool warns under 100 chars; the
    // description SHOULD comfortably exceed that.
    expect(tool.description.length).toBeGreaterThanOrEqual(100);
  });
});
