// prepare_kamino_obligation_init — Phase 13 Plan 13-06 Task 2 (SOL-W-08).
//
// NO-LIVE-RPC (blockhash mocked). The init tool does NOT gate on
// Obligation-presence (it CREATES the obligation — D-03's VP_S007 refuse applies
// to the OP tools). Returns handle + receipt + FROZEN fingerprint (Fixture X–Y
// cross-link) + blind-sign LEDGER NOTICE. Also asserts ALL Phase 13 tools are
// registered (the register-all append chain is closed here).
// Demo-mode isolation: VAULTPILOT_DEMO forced to "false".

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { createHandleSpy, listAccountsSpy } = vi.hoisted(() => ({
  createHandleSpy: vi.fn(),
  listAccountsSpy: vi.fn(),
}));
vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (...args: Parameters<typeof actual.createHandle>) =>
      createHandleSpy(...args),
  };
});
vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (...args: Parameters<typeof actual.listAccounts>) =>
      listAccountsSpy(...args),
  };
});

import { type Connection } from "@solana/web3.js";

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  deriveKaminoObligationPda,
  deriveKaminoUserMetadataPda,
  getKaminoLendProgram,
  getKaminoMainMarket,
} from "../src/config/contracts.js";
import { checkSolanaDispatchTarget } from "../src/security/canonical-dispatch-solana.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

const realHandleStore = await vi.importActual<
  typeof import("../src/signing/handle-store.js")
>("../src/signing/handle-store.js");

const WHALE = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const FIXED_BLOCKHASH = "11111111111111111111111111111111";

const PAIRED = {
  chain: "solana" as const,
  address: WHALE,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

function stubConnection(): Connection {
  return {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: FIXED_BLOCKHASH, lastValidBlockHeight: 1 })),
  } as unknown as Connection;
}

let savedDemo: string | undefined;

async function callTool(): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_kamino_obligation_init");
  if (!tool) throw new Error("prepare_kamino_obligation_init not registered");
  return tool.handler({});
}

describe("prepare_kamino_obligation_init (SOL-W-08, D-01 + V9 2-step, no presence-gate)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetHandleStoreForTesting();
    savedDemo = process.env.VAULTPILOT_DEMO;
    process.env.VAULTPILOT_DEMO = "false";
    _resetDemoModeForTesting();
    createHandleSpy.mockClear();
    createHandleSpy.mockImplementation(realHandleStore.createHandle);
    listAccountsSpy.mockReset();
    listAccountsSpy.mockReturnValue([PAIRED]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection());
  });

  afterEach(() => {
    if (savedDemo === undefined) delete process.env.VAULTPILOT_DEMO;
    else process.env.VAULTPILOT_DEMO = savedDemo;
    _resetDemoModeForTesting();
  });

  it("returns a handle + the seed-tagged PDAs + blind-sign NOTICE; NO presence-gate", async () => {
    const res = await callTool();
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.handle).toBe("string");
    expect(sc.owner).toBe(WHALE);
    expect(sc.obligationPda).toBe(deriveKaminoObligationPda(getKaminoMainMarket(), WHALE));
    expect(sc.userMetadataPda).toBe(deriveKaminoUserMetadataPda(WHALE));
    expect(sc.blindSign).toBe(true);
    expect(sc.clearSign).toBe(false);
    expect((sc.payloadFingerprint as string)).toMatch(/^0x[0-9a-f]{64}$/);

    // only the lending program is touched (no oracle refresh for init) → allowlisted.
    expect(sc.programIds).toEqual([getKaminoLendProgram()]);
    expect(checkSolanaDispatchTarget(sc.programIds as string[])).toEqual({ kind: "allowed" });

    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/initUserMetadata, then initObligation/);
    expect(text).toMatch(/LEDGER NOTICE/);
    expect(text).not.toMatch(/clear-?signs? this/i);
  });

  it("fingerprint is deterministic (FROZEN binding, fixed blockhash)", async () => {
    const a = (await callTool()).structuredContent as Record<string, unknown>;
    const b = (await callTool()).structuredContent as Record<string, unknown>;
    expect(a.payloadFingerprint).toBe(b.payloadFingerprint);
  });

  it("WRONG_MODE when demo on with no persona", async () => {
    process.env.VAULTPILOT_DEMO = "true";
    _resetDemoModeForTesting();
    const res = await callTool();
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("WRONG_MODE");
  });

  it("WALLET_NOT_PAIRED when no Solana account paired (real mode)", async () => {
    listAccountsSpy.mockReturnValue([]);
    const res = await callTool();
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe("WALLET_NOT_PAIRED");
  });
});

describe("Phase 13 register-all — ALL 11 Solana lending tools registered", () => {
  const PHASE_13_TOOLS = [
    "get_marginfi_positions",
    "prepare_marginfi_account_init",
    "prepare_marginfi_supply",
    "prepare_marginfi_withdraw",
    "prepare_marginfi_borrow",
    "prepare_marginfi_repay",
    "get_kamino_positions",
    "prepare_kamino_supply",
    "prepare_kamino_withdraw",
    "prepare_kamino_borrow",
    "prepare_kamino_repay",
    "prepare_kamino_obligation_init",
  ];

  for (const name of PHASE_13_TOOLS) {
    it(`${name} is registered`, () => {
      expect(getRegisteredTool(name)).toBeTruthy();
    });
  }
});
