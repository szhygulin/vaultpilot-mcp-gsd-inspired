// Plan 11-04 — list_paired_non_evm_accounts tool tests (PAIR-NEV-05).
//
// Five tests:
//   1. Empty list when no records.
//   2. Multi-chain list — Solana + TRON record return both.
//   3. **LOAD-BEARING shoulder-surfing defense (3-sentinel substring scan)**:
//      records with `derivationPath: "PATH-SENTINEL-…-DO-NOT-LEAK"` MUST NOT
//      appear ANYWHERE in the response envelope (structuredContent JSON,
//      content[0].text, or any other surface). Mirrors the Q-CONFIG-LEAK
//      pattern in `test/get-vaultpilot-config-status.test.ts` Test 2 and
//      the T-SESSION-TOPIC-LEAK-1 pattern in `test/get-ledger-status.test.ts`
//      Test 11.
//   4. Surfaces `staleAccountWarning: true` per-record when applicable.
//   5. Surfaces `displayName` per-record when applicable.

import { beforeEach, describe, expect, it, vi } from "vitest";

const listAccountsSpy = vi.fn();

vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (
      ...args: Parameters<typeof actual.listAccounts>
    ) => listAccountsSpy(...args),
  };
});

import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/list_paired_non_evm_accounts.js");

async function callTool(): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("list_paired_non_evm_accounts");
  if (!tool) throw new Error("list_paired_non_evm_accounts not registered");
  return tool.handler({});
}

const SOLANA_ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TRON_ADDR = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7";

beforeEach(() => {
  listAccountsSpy.mockReset();
});

describe("list_paired_non_evm_accounts — empty + multi-chain (PAIR-NEV-05)", () => {
  it("Test 1 — empty list when no records", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool();

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ accounts: [] });
    expect(result.content[0]?.text ?? "").toMatch(/\(none\)/);
  });

  it("Test 2 — surfaces 1 Solana + 1 TRON record with chain + address + pairedAt", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "solana",
        address: SOLANA_ADDR,
        derivationPath: "44'/501'/0'",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        chain: "tron",
        address: TRON_ADDR,
        derivationPath: "44'/195'/0'/0/0",
        pairedAt: "2026-05-16T11:00:00.000Z",
      },
    ]);

    const result = await callTool();
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      accounts: Array<{
        chain: string;
        address: string;
        pairedAt: string;
      }>;
    };
    expect(sc.accounts).toHaveLength(2);
    expect(sc.accounts[0]).toEqual({
      chain: "solana",
      address: SOLANA_ADDR,
      pairedAt: "2026-05-15T10:00:00.000Z",
    });
    expect(sc.accounts[1]).toEqual({
      chain: "tron",
      address: TRON_ADDR,
      pairedAt: "2026-05-16T11:00:00.000Z",
    });
  });
});

describe("list_paired_non_evm_accounts — LOAD-BEARING shoulder-surfing defense (PAIR-NEV-05)", () => {
  it("Test 3 — derivationPath NEVER appears in any surface (3-sentinel scan)", async () => {
    // Sentinel derivation path — guaranteed not to appear in the response
    // unless the implementation leaks it. Three distinct fragments scanned
    // for separately so a regression that strips one fragment but leaks
    // another (e.g. partial scrub) still fails.
    const PATH_SENTINEL = "PATH-SENTINEL-12345-DO-NOT-LEAK";
    const PATH_SENTINEL_FRAGMENT_1 = "PATH-SENTINEL";
    const PATH_SENTINEL_FRAGMENT_2 = "DO-NOT-LEAK";

    listAccountsSpy.mockReturnValue([
      {
        chain: "solana",
        address: SOLANA_ADDR,
        derivationPath: PATH_SENTINEL,
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        chain: "tron",
        address: TRON_ADDR,
        derivationPath: PATH_SENTINEL, // Two chains, same sentinel — the
        // scrub must apply per-record, not just to the first one.
        pairedAt: "2026-05-16T11:00:00.000Z",
      },
    ]);

    const result = await callTool();

    // (a) Full sentinel scan across the entire serialized result.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(PATH_SENTINEL);
    expect(serialized).not.toContain(PATH_SENTINEL_FRAGMENT_1);
    expect(serialized).not.toContain(PATH_SENTINEL_FRAGMENT_2);

    // (b) structuredContent JSON.
    const structuredSerialized = JSON.stringify(result.structuredContent);
    expect(structuredSerialized).not.toContain(PATH_SENTINEL);
    expect(structuredSerialized).not.toContain(PATH_SENTINEL_FRAGMENT_1);
    expect(structuredSerialized).not.toContain(PATH_SENTINEL_FRAGMENT_2);

    // (c) content[0].text.
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain(PATH_SENTINEL);
    expect(text).not.toContain(PATH_SENTINEL_FRAGMENT_1);
    expect(text).not.toContain(PATH_SENTINEL_FRAGMENT_2);

    // (d) Defense-in-depth: structuredContent.accounts must not have any
    // `derivationPath` field — even renamed (the field name itself is the
    // leak signal we suppress here).
    const sc = result.structuredContent as {
      accounts: Array<Record<string, unknown>>;
    };
    for (const a of sc.accounts) {
      expect(a).not.toHaveProperty("derivationPath");
    }

    // (e) Sanity: the chains + addresses + pairedAt MUST surface (we're
    // testing scrub, not amnesia).
    expect(serialized).toContain(SOLANA_ADDR);
    expect(serialized).toContain(TRON_ADDR);
  });
});

describe("list_paired_non_evm_accounts — optional fields", () => {
  it("Test 4 — staleAccountWarning: true per-record when applicable", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "solana",
        address: SOLANA_ADDR,
        derivationPath: "44'/501'/0'",
        pairedAt: "2025-01-01T00:00:00.000Z",
        staleAccountWarning: true,
      },
    ]);

    const result = await callTool();
    const sc = result.structuredContent as {
      accounts: Array<{ staleAccountWarning?: true }>;
    };
    expect(sc.accounts[0]?.staleAccountWarning).toBe(true);
    expect(result.content[0]?.text ?? "").toMatch(/staleAccountWarning:\s+true/);
  });

  it("Test 5 — displayName surfaced when present", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "solana",
        address: SOLANA_ADDR,
        derivationPath: "44'/501'/0'",
        pairedAt: "2026-05-15T10:00:00.000Z",
        displayName: "main",
      },
    ]);

    const result = await callTool();
    const sc = result.structuredContent as {
      accounts: Array<{ displayName?: string }>;
    };
    expect(sc.accounts[0]?.displayName).toBe("main");
    expect(result.content[0]?.text ?? "").toContain("main");
  });
});
