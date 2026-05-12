import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the session-manager module's `pair` export. The four error classes
// stay real (we re-export them from the mock factory so production code's
// `err instanceof PendingPairingError` checks still work). The `getStatus`
// + `disconnect` exports are not consumed by pair_ledger_live but the mock
// factory still surfaces them as no-op spies so an inadvertent future
// import doesn't crash test setup.
const pairSpy = vi.fn();

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    pair: (...args: Parameters<typeof actual.pair>) => pairSpy(...args),
    getStatus: vi.fn(async () => null),
    disconnect: vi.fn(async () => undefined),
  };
});

// Keep MissingProjectIdError real (it's an Error subclass; the handler
// uses `instanceof` to dispatch). No mock needed.

import {
  ApprovalTimeoutError,
  PendingPairingError,
  UserRejectedPairingError,
} from "../src/wallet/session-manager.js";
import { MissingProjectIdError } from "../src/wallet/walletconnect-client.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { VERIFY_ON_DEVICE_TEMPLATE } from "../src/tools/pair_ledger_live.js";

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Re-import the tool module ONCE — the registerTool side effect at module
// top level fires the first time the file is imported in this test
// process. Module isolation per-test via `vi.resetModules()` would force
// a re-register; instead we rely on the registry being non-empty across
// tests (the `pair_ledger_live` tool is registered once and its handler
// closure uses the module-scoped `pairSpy`, so each test's scenario is
// fully driven by `pairSpy.mockResolvedValueOnce` / `mockRejectedValueOnce`).
// This mirrors the get-token-balance test pattern.
await import("../src/tools/pair_ledger_live.js");

async function callTool(args: Record<string, unknown> = {}): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("pair_ledger_live");
  if (!tool) throw new Error("pair_ledger_live not registered");
  return tool.handler(args);
}

const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as const;
const SESSION_TOPIC_LAST8 = "f06b9d00";

beforeEach(() => {
  pairSpy.mockReset();
  savedDemo = process.env[DEMO_KEY];
  delete process.env[DEMO_KEY];
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  void _resetRegistryForTesting; // referenced for consistency with sibling test files
});

describe("pair_ledger_live tool — VERIFY-ON-DEVICE + success envelope (PAIR-01, PAIR-03)", () => {
  it("returns the verbatim VERIFY-ON-DEVICE block with substituted placeholders + structuredContent", async () => {
    pairSpy.mockResolvedValueOnce({
      wcUri: "wc:test-uri",
      status: {
        paired: true,
        address: ADDRESS,
        chainId: 1,
        sessionTopicLast8: SESSION_TOPIC_LAST8,
      },
    });

    const result = await callTool({ force: false });

    // Happy-path envelope shape.
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      wcUri: "wc:test-uri",
      address: ADDRESS,
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
    });

    const text = result.content[0]?.text ?? "";

    // Surface-level sanity (cross-line tokens use `\s+`, not literal space,
    // per the format-fanout / string-template pitfalls rules — the block
    // is line-joined with `\n` so a literal space would never match the
    // line-boundary region).
    expect(text).toContain("VERIFY-ON-DEVICE");
    expect(text).toMatch(/Address:\s+0x742d35Cc/);
    expect(text).toMatch(/Session topic.*last 8.*f06b9d00/i);
    expect(text).toMatch(/Ledger Live\s+→\s+Settings\s+→\s+Connected Apps/);

    // Format-fanout sentinel: prod + test reference the SAME const.
    // The substitution mechanism (plain String.prototype.replace, NOT a
    // template literal) is asserted by building the expected block here
    // with the same call shape as the production handler.
    const expectedSubstituted = VERIFY_ON_DEVICE_TEMPLATE
      .replace("{ADDRESS}", ADDRESS)
      .replace("{SESSION_TOPIC_LAST8}", SESSION_TOPIC_LAST8);
    expect(text.includes(expectedSubstituted)).toBe(true);
  });
});

describe("pair_ledger_live tool — error envelopes (locked-5 errorCodes)", () => {
  it("maps MissingProjectIdError → errorCode: MISSING_PROJECT_ID + env var + WC dashboard URL", async () => {
    pairSpy.mockRejectedValueOnce(new MissingProjectIdError());

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "MISSING_PROJECT_ID",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/WALLETCONNECT_PROJECT_ID/);
    expect(text).toMatch(/cloud\.walletconnect\.com/);
  });

  it("maps ApprovalTimeoutError → errorCode: APPROVAL_TIMEOUT + 60-seconds text", async () => {
    pairSpy.mockRejectedValueOnce(new ApprovalTimeoutError());

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "APPROVAL_TIMEOUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/60\s+seconds/);
  });

  it("maps UserRejectedPairingError → errorCode: USER_REJECTED + Ledger Live + re-call text", async () => {
    pairSpy.mockRejectedValueOnce(new UserRejectedPairingError({ code: 5000 }));

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "USER_REJECTED",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/rejected/i);
    expect(text).toMatch(/Ledger Live/);
    expect(text).toMatch(/re-call/i);
  });

  it("maps PendingPairingError → errorCode: PAIRING_IN_PROGRESS + force: true escape hatch", async () => {
    pairSpy.mockRejectedValueOnce(new PendingPairingError());

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "PAIRING_IN_PROGRESS",
    );
    expect(result.content[0]?.text ?? "").toMatch(/force:\s+true/);
  });

  it("maps unknown Error → errorCode: INTERNAL_ERROR (defensive catch-all, NOT in locked-5)", async () => {
    pairSpy.mockRejectedValueOnce(new Error("relay unreachable"));

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INTERNAL_ERROR",
    );
    const text = result.content[0]?.text ?? "";
    expect(text.startsWith("error: ")).toBe(true);
    expect(text).toMatch(/relay unreachable/);
  });
});

describe("pair_ledger_live tool — demo-mode refusal (DEMO-06 anticipated)", () => {
  it("refuses with errorCode: DEMO_MODE_REFUSED when VAULTPILOT_DEMO=true; session-manager.pair NEVER called", async () => {
    process.env[DEMO_KEY] = "true";

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "DEMO_MODE_REFUSED",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);
    expect(text).toMatch(/set_demo_wallet/);

    // Critical T-DEMO-1 mitigation assertion: the session manager is
    // NEVER touched in demo mode. A future bug that reorders the demo
    // check below the pair() call would silently leak WC state.
    expect(pairSpy).toHaveBeenCalledTimes(0);
  });

  it("DEMO-01 strict-literal predicate: VAULTPILOT_DEMO='True' (capitalized) does NOT trigger refusal", async () => {
    process.env[DEMO_KEY] = "True"; // capital T — should NOT match
    pairSpy.mockResolvedValueOnce({
      wcUri: "wc:test-uri",
      status: {
        paired: true,
        address: ADDRESS,
        chainId: 1,
        sessionTopicLast8: SESSION_TOPIC_LAST8,
      },
    });

    const result = await callTool({});

    // Should reach the happy path — `isDemoMode()` returned false because
    // the predicate is `=== "true"` (literal match, NOT `.toLowerCase()`).
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { errorCode?: string }).errorCode).toBeUndefined();
    expect(pairSpy).toHaveBeenCalledTimes(1);
  });
});

describe("pair_ledger_live tool — force passthrough (PAIR-05)", () => {
  it("passes { force: true } to session-manager.pair when args.force === true", async () => {
    pairSpy.mockResolvedValueOnce({
      wcUri: "wc:test-uri",
      status: {
        paired: true,
        address: ADDRESS,
        chainId: 1,
        sessionTopicLast8: SESSION_TOPIC_LAST8,
      },
    });

    await callTool({ force: true });

    expect(pairSpy).toHaveBeenCalledTimes(1);
    expect(pairSpy).toHaveBeenCalledWith({ force: true });
  });

  it("passes { force: false } when args.force is missing (default)", async () => {
    pairSpy.mockResolvedValueOnce({
      wcUri: "wc:test-uri",
      status: {
        paired: true,
        address: ADDRESS,
        chainId: 1,
        sessionTopicLast8: SESSION_TOPIC_LAST8,
      },
    });

    await callTool({});

    expect(pairSpy).toHaveBeenCalledTimes(1);
    expect(pairSpy).toHaveBeenCalledWith({ force: false });
  });
});
