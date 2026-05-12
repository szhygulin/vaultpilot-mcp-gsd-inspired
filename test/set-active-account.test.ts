// set_active_account tool tests — happy path + WRONG_MODE + INVALID_ACCOUNT
// + INVALID_INPUT, mirroring the structure of `test/set-demo-wallet.test.ts`.
//
// The session-manager's `setActiveAccount` export is mocked at the module
// level so the tests don't have to drive a real WC pairing. The mock is
// scripted per-test via `mockResolvedValueOnce` / `mockRejectedValueOnce`;
// the real error classes (NotPairedError / AccountNotInSessionError) are
// re-imported from the mocked module (vi.importActual preserves them) so
// the handler's `instanceof` checks still work.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setActiveAccountSpy = vi.fn();

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    setActiveAccount: (...args: Parameters<typeof actual.setActiveAccount>) =>
      setActiveAccountSpy(...args),
    // Defensive stubs — these MUST NOT be called from set_active_account tests.
    pair: vi.fn(async () => {
      throw new Error("pair not expected from set_active_account tests");
    }),
    getStatus: vi.fn(async () => null),
    disconnect: vi.fn(async () => undefined),
  };
});

import {
  AccountNotInSessionError,
  NotPairedError,
} from "../src/wallet/session-manager.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

// Side-effect register all tools so the registry is populated.
await import("../src/tools/register-all.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const ACCOUNTS = [
  "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
] as const;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("set_active_account");
  if (!tool) throw new Error("set_active_account not registered");
  return tool.handler(args);
}

beforeEach(() => {
  setActiveAccountSpy.mockReset();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
});

describe("set_active_account — happy path", () => {
  it("returns { address, accounts } and a confirmation text block with the Ledger-screen note", async () => {
    setActiveAccountSpy.mockResolvedValueOnce({
      paired: true,
      accounts: [...ACCOUNTS],
      activeAccount: ACCOUNTS[1],
      address: ACCOUNTS[1],
      chainId: 1,
      sessionTopicLast8: "deadbeef",
    });

    const result = await callTool({ address: ACCOUNTS[1] });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      address: ACCOUNTS[1],
      accounts: [...ACCOUNTS],
    });

    const text = result.content[0]?.text ?? "";
    expect(text).toContain(`active account set to: ${ACCOUNTS[1]}`);
    // Trust-anchor reminder — the Ledger screen remains SOT at signing time.
    expect(text).toMatch(/Ledger screen|trust|source of truth/i);

    expect(setActiveAccountSpy).toHaveBeenCalledTimes(1);
    expect(setActiveAccountSpy).toHaveBeenCalledWith(ACCOUNTS[1]);
  });
});

describe("set_active_account — WRONG_MODE in demo mode", () => {
  it("refuses with WRONG_MODE when VAULTPILOT_DEMO=true; setActiveAccount NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callTool({ address: ACCOUNTS[0] });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WRONG_MODE",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);
    expect(text).toMatch(/set_demo_wallet/);

    // Critical: state-mutating call must NOT have run.
    expect(setActiveAccountSpy).toHaveBeenCalledTimes(0);
  });
});

describe("set_active_account — INVALID_ACCOUNT when address not in session", () => {
  it("maps AccountNotInSessionError → INVALID_ACCOUNT; envelope surfaces the in-session list", async () => {
    const stranger = "0x0000000000000000000000000000000000000001";
    setActiveAccountSpy.mockRejectedValueOnce(
      new AccountNotInSessionError(stranger, [...ACCOUNTS]),
    );

    const result = await callTool({ address: stranger });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("INVALID_ACCOUNT");

    const text = result.content[0]?.text ?? "";
    // Self-correction surface: the agent sees the approved set in the text.
    expect(text).toContain(stranger);
    for (const a of ACCOUNTS) expect(text).toContain(a);

    // Same surface in the structuredContent message.
    expect(sc.message).toContain(ACCOUNTS[0]);
  });
});

describe("set_active_account — WALLET_NOT_PAIRED when no live session", () => {
  it("maps NotPairedError → WALLET_NOT_PAIRED", async () => {
    setActiveAccountSpy.mockRejectedValueOnce(new NotPairedError());

    const result = await callTool({ address: ACCOUNTS[0] });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(result.content[0]?.text ?? "").toMatch(/pair_ledger_live/);
  });
});

describe("set_active_account — INVALID_INPUT for malformed address (defense-in-depth)", () => {
  it("refuses with INVALID_INPUT when address fails the 0x40-hex regex (direct handler call)", async () => {
    // Direct handler invocation bypasses the SDK schema gate, exercising
    // the in-handler regex defense-in-depth check. The SDK pipeline (real
    // production) rejects this at the protocol boundary with -32602 before
    // the handler is invoked.
    const result = await callTool({ address: "0xnotahex" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("0xnotahex");

    // setActiveAccount must NOT have been called — the regex fires before
    // the session-manager call.
    expect(setActiveAccountSpy).toHaveBeenCalledTimes(0);
  });
});

describe("set_active_account — register-all wiring (smoke)", () => {
  it("set_active_account is registered after register-all import", () => {
    expect(getRegisteredTool("set_active_account")).toBeDefined();
  });
});
