import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the session-manager module's `pairWait` export. The error classes
// stay real (instanceof checks in the handler use them).
const pairWaitSpy = vi.fn();

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    pairWait: (...args: Parameters<typeof actual.pairWait>) => pairWaitSpy(...args),
    pairStart: vi.fn(async () => { throw new Error("pairStart not expected"); }),
    pair: vi.fn(async () => { throw new Error("pair not expected"); }),
    getStatus: vi.fn(async () => null),
    disconnect: vi.fn(async () => undefined),
  };
});

import {
  ApprovalTimeoutError,
  InvalidPairingHandleError,
  UserRejectedPairingError,
} from "../src/wallet/session-manager.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { VERIFY_ON_DEVICE_TEMPLATE } from "../src/tools/pair_ledger_live.js";
import { _resetDemoModeForTesting, isDemoMode } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Import the tool module once — registerTool side effect fires on first import.
await import("../src/tools/pair_ledger_live_wait.js");

async function callTool(args: Record<string, unknown> = {}): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("pair_ledger_live_wait");
  if (!tool) throw new Error("pair_ledger_live_wait not registered");
  return tool.handler(args);
}

const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as const;
const SESSION_TOPIC_LAST8 = "f06b9d00";
const HANDLE = "wch-1-1234567890";

beforeEach(() => {
  pairWaitSpy.mockReset();
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

describe("pair_ledger_live_wait — VERIFY-ON-DEVICE block + success envelope (PAIR-03)", () => {
  it("returns the verbatim VERIFY-ON-DEVICE block with substituted placeholders", async () => {
    pairWaitSpy.mockResolvedValueOnce({
      paired: true,
      accounts: [ADDRESS],
      activeAccount: ADDRESS,
      address: ADDRESS,
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
    });

    const result = await callTool({ pairingHandle: HANDLE });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      address: ADDRESS,
      accounts: [ADDRESS],
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
    });

    const text = result.content[0]?.text ?? "";

    expect(text).toContain("VERIFY-ON-DEVICE");
    expect(text).toMatch(/Address:\s+0x742d35Cc/);
    expect(text).toMatch(/Session topic.*last 8.*f06b9d00/i);
    expect(text).toMatch(/Ledger Live\s+→\s+Settings\s+→\s+Connected Apps/);

    // Format-fanout sentinel: prod + test reference the SAME const
    // (imported from pair_ledger_live.ts, the single source of truth).
    const expectedSubstituted = VERIFY_ON_DEVICE_TEMPLATE
      .replace("{ADDRESS}", ADDRESS)
      .replace("{SESSION_TOPIC_LAST8}", SESSION_TOPIC_LAST8);
    expect(text.includes(expectedSubstituted)).toBe(true);
  });

  it("passes the handle verbatim to pairWait", async () => {
    pairWaitSpy.mockResolvedValueOnce({
      paired: true,
      accounts: [ADDRESS],
      activeAccount: ADDRESS,
      address: ADDRESS,
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
    });

    await callTool({ pairingHandle: HANDLE });

    expect(pairWaitSpy).toHaveBeenCalledWith(HANDLE);
  });

  it("multi-account session: structuredContent.accounts has all approved addresses; VERIFY-ON-DEVICE lists active only", async () => {
    const ACCOUNTS = [
      ADDRESS,
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const,
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const,
    ];
    pairWaitSpy.mockResolvedValueOnce({
      paired: true,
      accounts: ACCOUNTS,
      activeAccount: ACCOUNTS[0],
      address: ACCOUNTS[0],
      chainId: 1,
      sessionTopicLast8: SESSION_TOPIC_LAST8,
    });

    const result = await callTool({ pairingHandle: HANDLE });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      address: string;
      accounts: string[];
    };
    expect(sc.address).toBe(ACCOUNTS[0]);
    expect(sc.accounts).toEqual(ACCOUNTS);

    // The VERIFY-ON-DEVICE block must surface ONLY the active address —
    // listing the full array in the on-device verification block would
    // be noisy and the device can only sign with one address per
    // request anyway. The non-active addresses must NOT appear inside
    // the verify block.
    const text = result.content[0]?.text ?? "";
    const verifyBlock = VERIFY_ON_DEVICE_TEMPLATE
      .replace("{ADDRESS}", ACCOUNTS[0])
      .replace("{SESSION_TOPIC_LAST8}", SESSION_TOPIC_LAST8);
    expect(text).toContain(verifyBlock);
    // Slice out the verify block and assert it does NOT contain the
    // non-active accounts.
    const blockStart = text.indexOf(verifyBlock);
    const blockEnd = blockStart + verifyBlock.length;
    const verifyOnly = text.slice(blockStart, blockEnd);
    expect(verifyOnly).not.toContain(ACCOUNTS[1]);
    expect(verifyOnly).not.toContain(ACCOUNTS[2]);

    // The accounts line lives OUTSIDE the verify block in the text body.
    expect(text).toContain(ACCOUNTS[1]);
    expect(text).toContain(ACCOUNTS[2]);
  });
});

describe("pair_ledger_live_wait — error envelopes", () => {
  it("maps InvalidPairingHandleError → errorCode: INVALID_HANDLE + re-call start text", async () => {
    pairWaitSpy.mockRejectedValueOnce(new InvalidPairingHandleError(HANDLE));

    const result = await callTool({ pairingHandle: HANDLE });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_HANDLE");
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/pair_ledger_live_start/);
  });

  it("returns INVALID_HANDLE when pairingHandle is missing", async () => {
    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_HANDLE");
    // pairWait should NOT be called — the guard fires before session-manager.
    expect(pairWaitSpy).toHaveBeenCalledTimes(0);
  });

  it("maps ApprovalTimeoutError → errorCode: APPROVAL_TIMEOUT + 60-seconds text", async () => {
    pairWaitSpy.mockRejectedValueOnce(new ApprovalTimeoutError());

    const result = await callTool({ pairingHandle: HANDLE });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("APPROVAL_TIMEOUT");
    expect(result.content[0]?.text ?? "").toMatch(/60\s+seconds/);
  });

  it("maps UserRejectedPairingError → errorCode: USER_REJECTED + Ledger Live + re-call text", async () => {
    pairWaitSpy.mockRejectedValueOnce(new UserRejectedPairingError({ code: 5000 }));

    const result = await callTool({ pairingHandle: HANDLE });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("USER_REJECTED");
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/rejected/i);
    expect(text).toMatch(/Ledger Live/);
    expect(text).toMatch(/re-call/i);
  });

  it("maps unknown Error → errorCode: INTERNAL_ERROR (defensive catch-all)", async () => {
    pairWaitSpy.mockRejectedValueOnce(new Error("relay dropped"));

    const result = await callTool({ pairingHandle: HANDLE });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INTERNAL_ERROR");
    expect(result.content[0]?.text ?? "").toMatch(/relay dropped/);
  });
});

describe("pair_ledger_live_wait — demo-mode refusal (T-DEMO-1 extension)", () => {
  it("refuses with DEMO_MODE_REFUSED when VAULTPILOT_DEMO=true; pairWait NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callTool({ pairingHandle: HANDLE });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "DEMO_MODE_REFUSED",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);
    expect(text).toMatch(/set_demo_wallet/);

    expect(pairWaitSpy).toHaveBeenCalledTimes(0);
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
