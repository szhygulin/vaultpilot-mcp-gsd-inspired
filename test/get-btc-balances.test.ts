// test/get-btc-balances.test.ts — Phase 22 Plan 22-03 Task 2 (BTC-READ-02).
//
// MCP tool: parallel segwit + taproot BalanceReports for a paired
// Ledger wallet (or explicit `{ segwit, taproot }` object). Uses
// `Promise.allSettled` so a one-side rate-limit does NOT tank the
// whole call.
//
// Coverage:
//   1. Happy path: both segwit + taproot return kind:"ok"; both
//      Esplora calls fire in parallel
//   2. One-side rate-limit: segwit succeeds, taproot returns
//      kind:"rate-limited" — tool surfaces BOTH reports
//   3. Default-to-paired-wallet from listAccounts({ chainFilter:
//      "bitcoin" }) when wallet arg omitted
//   4. Explicit { segwit, taproot } object overrides paired default

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetBitcoinRegistryForTesting } from "../src/chains/bitcoin/registry.js";
import { _resetEsploraCacheForTesting } from "../src/chains/bitcoin/esplora-client.js";
import * as nonEvmStore from "../src/wallet/non-evm-account-store.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const SEGWIT_ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const TAPROOT_ADDR =
  "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

interface RouteConfig {
  status?: number;
  payload?: unknown;
  delayMs?: number;
}

// URL→config mock. Maps EITHER `/address/{addr}` (chain-stats), `/utxo`
// suffix, or a one-call fallback.
function buildAddressFetch(routes: {
  segwitInfo?: RouteConfig;
  segwitUtxos?: RouteConfig;
  taprootInfo?: RouteConfig;
  taprootUtxos?: RouteConfig;
}): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    let cfg: RouteConfig | undefined;
    if (url.includes(`/address/${SEGWIT_ADDR}/utxo`)) cfg = routes.segwitUtxos;
    else if (url.includes(`/address/${TAPROOT_ADDR}/utxo`)) cfg = routes.taprootUtxos;
    else if (url.includes(`/address/${SEGWIT_ADDR}`)) cfg = routes.segwitInfo;
    else if (url.includes(`/address/${TAPROOT_ADDR}`)) cfg = routes.taprootInfo;

    if (cfg?.delayMs !== undefined) {
      await new Promise((r) => setTimeout(r, cfg!.delayMs!));
    }

    const status = cfg?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => cfg?.payload ?? null,
    } satisfies MockResponse;
  });
}

const okInfo = {
  chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 0, tx_count: 1 },
  mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
};

const otherInfo = {
  chain_stats: { funded_txo_sum: 250000, spent_txo_sum: 0, tx_count: 2 },
  mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
};

beforeEach(() => {
  _resetEsploraCacheForTesting();
  _resetBitcoinRegistryForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetEsploraCacheForTesting();
  _resetBitcoinRegistryForTesting();
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_btc_balances");
  if (!tool) throw new Error("get_btc_balances not registered");
  return tool.handler(args);
}

describe("get_btc_balances (BTC-READ-02)", () => {
  it("happy path: both segwit + taproot return kind:'ok'", async () => {
    vi.stubGlobal(
      "fetch",
      buildAddressFetch({
        segwitInfo: { payload: okInfo },
        segwitUtxos: { payload: [] },
        taprootInfo: { payload: otherInfo },
        taprootUtxos: { payload: [] },
      }),
    );

    const result = await callTool({
      wallet: { segwit: SEGWIT_ADDR, taproot: TAPROOT_ADDR },
    });
    expect(result.isError).toBeUndefined();
    const s = result.structuredContent as Record<string, unknown>;
    const segwit = s.segwit as Record<string, unknown>;
    const taproot = s.taproot as Record<string, unknown>;
    expect(segwit.kind).toBe("ok");
    expect(segwit.confirmedBalanceSats).toBe("100000");
    expect(taproot.kind).toBe("ok");
    expect(taproot.confirmedBalanceSats).toBe("250000");
  });

  it("one-side rate-limit doesn't tank the whole call — segwit ok, taproot rate-limited", async () => {
    vi.stubGlobal(
      "fetch",
      buildAddressFetch({
        segwitInfo: { payload: okInfo },
        segwitUtxos: { payload: [] },
        taprootInfo: { status: 429 },
      }),
    );

    const result = await callTool({
      wallet: { segwit: SEGWIT_ADDR, taproot: TAPROOT_ADDR },
    });
    expect(result.isError).toBeUndefined(); // tool-level not error
    const s = result.structuredContent as Record<string, unknown>;
    const segwit = s.segwit as Record<string, unknown>;
    const taproot = s.taproot as Record<string, unknown>;
    expect(segwit.kind).toBe("ok");
    expect(taproot.kind).toBe("rate-limited");
    expect(typeof taproot.message).toBe("string");
  });

  it("uses Promise.allSettled — calls fire in parallel (NOT sequential)", async () => {
    // segwit takes 100ms, taproot takes 100ms — total wall time should
    // be ≈100ms (parallel), NOT ≈200ms (sequential).
    vi.stubGlobal(
      "fetch",
      buildAddressFetch({
        segwitInfo: { payload: okInfo, delayMs: 100 },
        segwitUtxos: { payload: [] },
        taprootInfo: { payload: otherInfo, delayMs: 100 },
        taprootUtxos: { payload: [] },
      }),
    );

    const start = Date.now();
    await callTool({ wallet: { segwit: SEGWIT_ADDR, taproot: TAPROOT_ADDR } });
    const elapsed = Date.now() - start;

    // Parallel wall time ≤ 175ms; sequential would be ≥ 200ms.
    expect(elapsed).toBeLessThan(175);
  });

  it("defaults to paired wallet from listAccounts({ chainFilter: 'bitcoin' }) when wallet omitted", async () => {
    vi.spyOn(nonEvmStore, "listAccounts").mockReturnValue([
      {
        chain: "bitcoin",
        address: SEGWIT_ADDR,
        derivationPath: "84'/0'/0'/0/0",
        pairedAt: new Date().toISOString(),
      },
      {
        chain: "bitcoin",
        address: TAPROOT_ADDR,
        derivationPath: "86'/0'/0'/0/0",
        pairedAt: new Date().toISOString(),
      },
    ]);

    vi.stubGlobal(
      "fetch",
      buildAddressFetch({
        segwitInfo: { payload: okInfo },
        segwitUtxos: { payload: [] },
        taprootInfo: { payload: otherInfo },
        taprootUtxos: { payload: [] },
      }),
    );

    const result = await callTool({});
    expect(result.isError).toBeUndefined();
    const s = result.structuredContent as Record<string, unknown>;
    expect((s.segwit as Record<string, unknown>).address).toBe(SEGWIT_ADDR);
    expect((s.taproot as Record<string, unknown>).address).toBe(TAPROOT_ADDR);
  });

  it("returns NOT_PAIRED envelope when no wallet arg and no paired bitcoin records", async () => {
    vi.spyOn(nonEvmStore, "listAccounts").mockReturnValue([]);

    const result = await callTool({});
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>).errorCode).toBe(
      "NOT_PAIRED",
    );
  });

  it("INPUT_SCHEMA: wallet is optional object with segwit + taproot fields", () => {
    const tool = getRegisteredTool("get_btc_balances");
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as Record<string, unknown>;
    expect(schema.required).toBeUndefined(); // wallet is optional (paired default)
  });
});
