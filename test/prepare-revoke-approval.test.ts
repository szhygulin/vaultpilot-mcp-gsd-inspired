// prepare_revoke_approval tests. Phase 6 — Plan 06-03 (PREP-27).
//
// Anchors:
//   - Happy-path demo persona (amount === "0", amountWei === "0")
//   - Real-mode pair-required (WALLET_NOT_PAIRED)
//   - INVALID_INPUT on malformed tokenAddress / spender
//   - BYTE-IDENTITY INVARIANT (T-REVOKE-DRIFT-1 mitigation — LOAD-BEARING):
//       prepare_revoke_approval({T, S})
//         .structuredContent.payloadFingerprint
//       ===
//       prepare_token_approve({T, S, amount: "0"})
//         .structuredContent.payloadFingerprint
//     AND record.tx.data byte-identical AND amountWei === "0" in both
//   - register-all wiring smoke

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getStatusSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from prepare_revoke_approval tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
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

async function callRevoke(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_revoke_approval");
  if (!tool) throw new Error("prepare_revoke_approval not registered");
  // Phase 8 — Plan 08-02: chain arg REQUIRED; default to "ethereum" for
  // back-compat with the existing byte-identity invariants.
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
}

async function callApprove(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_token_approve");
  if (!tool) throw new Error("prepare_token_approve not registered");
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

const USDC_CHECKSUMMED = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const UNI_V3_CHECKSUMMED = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

beforeEach(() => {
  getStatusSpy.mockReset();
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

describe("prepare_revoke_approval — happy path (demo mode)", () => {
  it("demo + whale → success; amount === \"0\"; amountWei === \"0\"; data starts with approve selector", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");

    const result = await callRevoke({
      tokenAddress: USDC_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      spender: string;
      tokenAddress: string;
      amount: string;
      amountWei: string;
      payloadFingerprint: string;
    };
    expect(sc.amount).toBe("0");
    expect(sc.amountWei).toBe("0");
    expect(sc.spender).toBe(UNI_V3_CHECKSUMMED);
    expect(sc.tokenAddress).toBe(USDC_CHECKSUMMED);

    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.tx.data.startsWith("0x095ea7b3")).toBe(true);
    expect(record.tx.valueWei).toBe(0n);

    // T-DEMO-1: getStatus NEVER called in demo mode.
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_revoke_approval — pair-required (real mode)", () => {
  it("getStatus returns null → WALLET_NOT_PAIRED", async () => {
    getStatusSpy.mockResolvedValueOnce(null);

    const result = await callRevoke({
      tokenAddress: USDC_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
  });
});

describe("prepare_revoke_approval — INVALID_INPUT branches", () => {
  it("invalid tokenAddress → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callRevoke({
      tokenAddress: "0xnotacontract",
      spender: UNI_V3_CHECKSUMMED,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/tokenAddress/i);
  });

  it("invalid spender → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callRevoke({
      tokenAddress: USDC_CHECKSUMMED,
      spender: "0xnotaspender",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/spender/i);
  });
});

describe("prepare_revoke_approval — BYTE-IDENTITY INVARIANT (T-REVOKE-DRIFT-1)", () => {
  it("revoke({T,S}).fingerprint === approve({T,S,amount:\"0\"}).fingerprint; tx.data byte-identical", async () => {
    // Both calls in the same setup. Demo mode + whale persona so the
    // sender resolution path is identical between the two tools (no
    // getStatus differences between calls).
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");

    const revokeResult = await callRevoke({
      tokenAddress: USDC_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
    });

    const approveResult = await callApprove({
      tokenAddress: USDC_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
      amount: "0",
    });

    expect(revokeResult.isError).toBeFalsy();
    expect(approveResult.isError).toBeFalsy();

    const revokeSc = revokeResult.structuredContent as {
      handle: string;
      amountWei: string;
      payloadFingerprint: string;
    };
    const approveSc = approveResult.structuredContent as {
      handle: string;
      amountWei: string;
      payloadFingerprint: string;
    };

    // Byte-identity in the trust-binding fingerprint — drift in either
    // tool's tx construction fails this assertion.
    expect(revokeSc.payloadFingerprint).toBe(approveSc.payloadFingerprint);

    // Byte-identity in the encoded calldata.
    const revokeRecord = _peekHandleForTesting(revokeSc.handle);
    const approveRecord = _peekHandleForTesting(approveSc.handle);
    expect(revokeRecord).toBeDefined();
    expect(approveRecord).toBeDefined();
    if (!revokeRecord || !approveRecord) return;

    expect(revokeRecord.tx.data).toBe(approveRecord.tx.data);
    expect(revokeRecord.tx.to).toBe(approveRecord.tx.to);
    expect(revokeRecord.tx.valueWei).toBe(approveRecord.tx.valueWei);
    expect(revokeRecord.tx.chainId).toBe(approveRecord.tx.chainId);

    // Both surface amountWei === "0" in the structured content.
    expect(revokeSc.amountWei).toBe("0");
    expect(approveSc.amountWei).toBe("0");
  });
});

describe("prepare_revoke_approval — register-all wiring (smoke)", () => {
  it("prepare_revoke_approval is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_revoke_approval");
  });

  it("inputSchema requires chain + tokenAddress + spender (NO amount) — Plan 08-02 adds chain", () => {
    const tool = getRegisteredTool("prepare_revoke_approval");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "tokenAddress", "spender"]);
    // Schema MUST NOT accept `amount` — revoke is approve(spender, 0) only.
    expect(tool.inputSchema.properties?.amount).toBeUndefined();
    expect(tool.inputSchema.properties?.chain).toMatchObject({
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
    });
  });

  it("register-all.ts contains the side-effect import line for ./prepare_revoke_approval.js", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = url.fileURLToPath(new URL(".", import.meta.url));
    const target = path.resolve(here, "..", "src", "tools", "register-all.ts");
    const source = await fs.readFile(target, "utf8");
    expect(source).toContain('import "./prepare_revoke_approval.js";');
  });
});
