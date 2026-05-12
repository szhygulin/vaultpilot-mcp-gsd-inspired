import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the session-manager module's `pairStart` export. The error classes
// stay real (instanceof checks in the handler use them). `pairWait`, `pair`,
// `getStatus`, and `disconnect` are not consumed by pair_ledger_live_start
// but the mock factory surfaces them as no-op spies so inadvertent future
// imports don't crash test setup.
const pairStartSpy = vi.fn();

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    pairStart: (...args: Parameters<typeof actual.pairStart>) => pairStartSpy(...args),
    pairWait: vi.fn(async () => { throw new Error("pairWait not expected"); }),
    pair: vi.fn(async () => { throw new Error("pair not expected"); }),
    getStatus: vi.fn(async () => null),
    disconnect: vi.fn(async () => undefined),
  };
});

import {
  PendingPairingError,
} from "../src/wallet/session-manager.js";
import { MissingProjectIdError } from "../src/wallet/walletconnect-client.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting, isDemoMode } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Import the tool module once — registerTool side effect fires on first import.
await import("../src/tools/pair_ledger_live_start.js");

async function callTool(args: Record<string, unknown> = {}): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("pair_ledger_live_start");
  if (!tool) throw new Error("pair_ledger_live_start not registered");
  return tool.handler(args);
}

const WC_URI = "wc:test-uri@2?relay-protocol=irn&symKey=deadbeef";

beforeEach(() => {
  pairStartSpy.mockReset();
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
  void _resetRegistryForTesting;
});

describe("pair_ledger_live_start — happy path (new pairing)", () => {
  it("returns wcUri + pairingHandle immediately without blocking", async () => {
    pairStartSpy.mockResolvedValueOnce({
      wcUri: WC_URI,
      pairingHandle: "wch-1-1234567890",
    });

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      wcUri: WC_URI,
      pairingHandle: "wch-1-1234567890",
    });
    // Text must contain the URI so the user/agent can see it in chat.
    expect(result.content[0]?.text).toContain(WC_URI);
  });

  it("passes { force: false } by default", async () => {
    pairStartSpy.mockResolvedValueOnce({ wcUri: WC_URI, pairingHandle: "wch-1-1" });
    await callTool({});
    expect(pairStartSpy).toHaveBeenCalledWith({ force: false });
  });

  it("passes { force: true } when args.force === true", async () => {
    pairStartSpy.mockResolvedValueOnce({ wcUri: WC_URI, pairingHandle: "wch-1-2" });
    await callTool({ force: true });
    expect(pairStartSpy).toHaveBeenCalledWith({ force: true });
  });
});

describe("pair_ledger_live_start — cached session (wcUri empty)", () => {
  it("returns empty wcUri + cached sentinel; text routes agent to get_ledger_status", async () => {
    pairStartSpy.mockResolvedValueOnce({ wcUri: "", pairingHandle: "cached" });

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { wcUri: string }).wcUri).toBe("");
    expect((result.structuredContent as { pairingHandle: string }).pairingHandle).toBe("cached");
    // Tool description instructs agent to call get_ledger_status when wcUri is empty.
    expect(result.content[0]?.text).toMatch(/get_ledger_status/);
  });
});

describe("pair_ledger_live_start — error envelopes", () => {
  it("maps MissingProjectIdError → errorCode: MISSING_PROJECT_ID + env var + WC dashboard URL", async () => {
    pairStartSpy.mockRejectedValueOnce(new MissingProjectIdError());

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "MISSING_PROJECT_ID",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/WALLETCONNECT_PROJECT_ID/);
    expect(text).toMatch(/cloud\.walletconnect\.com/);
  });

  it("maps PendingPairingError → errorCode: PAIRING_IN_PROGRESS + force: true escape hatch", async () => {
    pairStartSpy.mockRejectedValueOnce(new PendingPairingError());

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "PAIRING_IN_PROGRESS",
    );
    expect(result.content[0]?.text ?? "").toMatch(/force:\s+true/);
  });

  it("maps unknown Error → errorCode: INTERNAL_ERROR (defensive catch-all)", async () => {
    pairStartSpy.mockRejectedValueOnce(new Error("relay unreachable"));

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INTERNAL_ERROR");
    expect(result.content[0]?.text ?? "").toMatch(/relay unreachable/);
  });
});

describe("pair_ledger_live_start — demo-mode refusal (T-DEMO-1 extension)", () => {
  it("refuses with DEMO_MODE_REFUSED when VAULTPILOT_DEMO=true; pairStart NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "DEMO_MODE_REFUSED",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);
    expect(text).toMatch(/set_demo_wallet/);

    // T-DEMO-1 assertion: session-manager NEVER touched in demo mode.
    expect(pairStartSpy).toHaveBeenCalledTimes(0);
  });

  it("VAULTPILOT_DEMO='True' (capital) refuses to boot per Q-STRICT (Phase 5)", () => {
    process.env[DEMO_KEY] = "True";
    _resetDemoModeForTesting();

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`mock-exit-${code ?? "undefined"}`);
      }) as never);

    expect(() => isDemoMode()).toThrow(/mock-exit-1/);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
