// test/get-litecoin-tx-history.test.ts — Phase 26 Plan 26-01 (LTC-READ-02).
//
// MCP tool: paginated tx history for a LTC address via litecoinspace.org
// Esplora `/address/{addr}/txs[/chain/<cursor>]`. Stripped-down per-row
// shape `{ txid, blockHeight?, confirmedAt?, fee }`.
//
// Coverage:
//   1. limit defaults to 25 when omitted
//   2. limit overrides the slice length (default 25 → custom 10)
//   3. pagination via `cursor` (afterTxid) — appended to URL
//   4. nextCursor present when page returned full limit-count
//   5. nextCursor absent when fewer than limit returned
//   6. TxRow shape: txid, blockHeight?, confirmedAt?, fee (stripped)
//   7. rate-limited → ESPLORA_RATE_LIMITED envelope

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetLitecoinRegistryForTesting } from "../src/chains/litecoin/registry.js";
import { _resetEsploraCacheForTesting } from "../src/chains/litecoin/esplora-client.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const SEGWIT_ADDR = "ltc1q" + "a".repeat(38); // valid ltc1q pattern

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

function buildTx(opts: { txid: string; height?: number; time?: number; fee?: number }) {
  return {
    txid: opts.txid,
    status:
      opts.height !== undefined
        ? {
            confirmed: true,
            block_height: opts.height,
            block_time: opts.time ?? 1700000000,
          }
        : { confirmed: false },
    fee: opts.fee ?? 1000,
  };
}

beforeEach(() => {
  _resetEsploraCacheForTesting();
  _resetLitecoinRegistryForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetEsploraCacheForTesting();
  _resetLitecoinRegistryForTesting();
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_litecoin_tx_history");
  if (!tool) throw new Error("get_litecoin_tx_history not registered");
  return tool.handler(args);
}

describe("get_litecoin_tx_history (LTC-READ-02)", () => {
  it("limit defaults to 25 when omitted", async () => {
    // Return 30 rows; tool should slice to 25.
    const rows = Array.from({ length: 30 }, (_, i) =>
      buildTx({ txid: `tx${i}`, height: 2_500_000 - i }),
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => rows,
    } satisfies MockResponse)));

    const result = await callTool({ wallet: SEGWIT_ADDR });
    const s = result.structuredContent as Record<string, unknown>;
    const txs = s.transactions as unknown[];
    expect(txs.length).toBe(25);
    expect(s.nextCursor).toBeDefined();
  });

  it("custom limit overrides default — limit=10 slices to 10", async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      buildTx({ txid: `tx${i}`, height: 2_500_000 - i }),
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => rows,
    } satisfies MockResponse)));

    const result = await callTool({ wallet: SEGWIT_ADDR, limit: 10 });
    const s = result.structuredContent as Record<string, unknown>;
    const txs = s.transactions as unknown[];
    expect(txs.length).toBe(10);
  });

  it("pagination via `cursor` — appended to URL as /chain/<txid>", async () => {
    const seenUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        seenUrls.push(String(input));
        return {
          ok: true,
          status: 200,
          json: async () => [buildTx({ txid: "txnew", height: 2_500_000 })],
        } satisfies MockResponse;
      }),
    );

    await callTool({ wallet: SEGWIT_ADDR, cursor: "abc123" });
    expect(seenUrls.some((u) => u.includes("/chain/abc123"))).toBe(true);
  });

  it("nextCursor absent when fewer than limit returned (last page)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [buildTx({ txid: "onlytx", height: 2_500_000 })],
    } satisfies MockResponse)));

    const result = await callTool({ wallet: SEGWIT_ADDR, limit: 25 });
    const s = result.structuredContent as Record<string, unknown>;
    expect(s.nextCursor).toBeUndefined();
  });

  it("TxRow shape: txid + blockHeight + confirmedAt + fee (stripped)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        buildTx({ txid: "txconfirmed", height: 2_500_000, time: 1700000000, fee: 2500 }),
      ],
    } satisfies MockResponse)));

    const result = await callTool({ wallet: SEGWIT_ADDR });
    const s = result.structuredContent as Record<string, unknown>;
    const txs = s.transactions as Array<Record<string, unknown>>;
    expect(txs[0]?.txid).toBe("txconfirmed");
    expect(txs[0]?.blockHeight).toBe(2_500_000);
    expect(txs[0]?.confirmedAt).toBe(1700000000);
    expect(txs[0]?.fee).toBe("2500"); // bigint → string
    // Stripped: no vin/vout fields
    expect(txs[0]?.vin).toBeUndefined();
    expect(txs[0]?.vout).toBeUndefined();
  });

  it("rate-limited → ESPLORA_RATE_LIMITED envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    } satisfies MockResponse)));

    const result = await callTool({ wallet: SEGWIT_ADDR });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>).errorCode).toBe(
      "ESPLORA_RATE_LIMITED",
    );
  });

  it("INPUT_SCHEMA: wallet pattern + optional limit + optional cursor", () => {
    const tool = getRegisteredTool("get_litecoin_tx_history");
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.wallet?.pattern).toBe(
      "^(ltc1q[02-9ac-hj-np-z]{38}|L[1-9A-HJ-NP-Za-km-z]{26,33})$",
    );
    expect(props.limit?.maximum).toBe(100);
  });
});
