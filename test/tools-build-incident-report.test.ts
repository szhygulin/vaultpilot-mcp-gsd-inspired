// test/tools-build-incident-report.test.ts — Phase 27 Plan 27-03 (BTC-INC-01).
//
// Unit tests for src/tools/build_incident_report.ts — the cross-chain
// anomaly aggregator.
//
// Test seam: vi.stubGlobal("fetch", …) with per-call dispatch based on the
// JSON-RPC `method` extracted from `init.body`. Each test wires the Core RPC
// responses it expects to see; unexpected methods return HTTP 500.
//
// Env seam: process.env.BITCOIN_CORE_RPC_URL / LITECOIN_CORE_RPC_URL
// manipulation per test (cleaned in beforeEach).
//
// Coverage:
//   1.  Default invocation (no args) — both chains, both core-not-configured.
//   2.  BTC-only via includeChains.
//   3.  chain-tip-lag anomaly (BTC).
//   4.  reorg-detected anomaly (BTC).
//   5.  mempool-spike anomaly (BTC).
//   6.  No anomalies, all green (BTC).
//   7.  Probe timeout — Promise.allSettled fan-out surfaces probe-failed.
//   8.  Partial-success — one sub-call fails, others succeed, status === "ok".
//   9.  LTC distinct baseline — mempool spike at 5_000 baseline.
//   10. NEVER-throws — every handler invocation resolves cleanly.
//   11. Response timestamp is a valid round-trip ISO 8601.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/tools/build_incident_report.js";
import { getRegisteredTool } from "../src/tools/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface MethodResponse {
  status: number;
  body: unknown;
}

/**
 * Build a fetch stub that dispatches per JSON-RPC method name. Each method
 * consumes responses in order so a test can wire (e.g.) a success + failure
 * sequence for the same method.
 */
function makeMethodFetch(byMethod: Record<string, MethodResponse[]>): typeof fetch {
  const counters: Record<string, number> = {};
  return vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(init.body as string) as { method?: string }) : {};
    const method = body.method ?? "<unknown>";
    const queue = byMethod[method];
    if (!queue || queue.length === 0) {
      return Promise.resolve(
        new Response(`unexpected method: ${method}`, { status: 500 }),
      );
    }
    const idx = counters[method] ?? 0;
    counters[method] = idx + 1;
    const resp = queue[idx] ?? queue[queue.length - 1]!;
    return Promise.resolve(
      new Response(JSON.stringify(resp.body), {
        status: resp.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

/** RPC success body envelope. */
function okBody(result: unknown): unknown {
  return { result, error: null, id: "vaultpilot" };
}

async function invokeTool(args: Record<string, unknown> = {}) {
  const tool = getRegisteredTool("build_incident_report");
  if (!tool) throw new Error("Tool not registered: build_incident_report");
  return tool.handler(args);
}

/** Extract structuredContent as a typed shape (no `any`). */
interface IncidentReport {
  reportTimestamp: string;
  chainsProbed: string[];
  anomaliesDetected: Array<Record<string, unknown>>;
  chainProbeStatus: Record<string, string>;
}

function sc(result: { structuredContent?: Record<string, unknown> }): IncidentReport {
  return result.structuredContent as unknown as IncidentReport;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("build_incident_report", () => {
  beforeEach(() => {
    delete process.env.BITCOIN_CORE_RPC_URL;
    delete process.env.BITCOIN_CORE_RPC_USER;
    delete process.env.BITCOIN_CORE_RPC_PASS;
    delete process.env.LITECOIN_CORE_RPC_URL;
    delete process.env.LITECOIN_CORE_RPC_USER;
    delete process.env.LITECOIN_CORE_RPC_PASS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ─── 1. Default invocation, no Core URLs set ─────────────────────────────

  it("defaults to bitcoin + litecoin and reports core-not-configured for both when no env vars are set", async () => {
    const result = await invokeTool();
    const report = sc(result);

    expect(report.chainsProbed).toEqual(["bitcoin", "litecoin"]);
    expect(report.chainProbeStatus.bitcoin).toBe("core-not-configured");
    expect(report.chainProbeStatus.litecoin).toBe("core-not-configured");
    expect(report.anomaliesDetected).toEqual([]);
  });

  // ─── 2. BTC only via includeChains ───────────────────────────────────────

  it("respects includeChains = [\"bitcoin\"] and probes only that chain", async () => {
    const result = await invokeTool({ includeChains: ["bitcoin"] });
    const report = sc(result);

    expect(report.chainsProbed).toEqual(["bitcoin"]);
    expect(Object.keys(report.chainProbeStatus)).toEqual(["bitcoin"]);
    expect(report.chainProbeStatus.litecoin).toBeUndefined();
  });

  // ─── 3. chain-tip-lag anomaly (BTC) ──────────────────────────────────────

  it("emits chain-tip-lag when wall-clock outpaces Core's reported height", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    const nowSecs = Math.floor(Date.now() / 1000);
    // 3000s = 50 minutes elapsed since mediantime — at 600s/block that is 5
    // expected blocks, vs reported `blocks: 850000` → detectedLagBlocks = 5.
    const mediantime = nowSecs - 3000;

    vi.stubGlobal(
      "fetch",
      makeMethodFetch({
        getblockchaininfo: [
          {
            status: 200,
            body: okBody({
              blocks: 850000,
              bestblockhash: "0xtip",
              mediantime,
            }),
          },
        ],
        getchaintips: [{ status: 200, body: okBody([{ hash: "0xtip", height: 850000, branchlen: 0, status: "active" }]) }],
        getmempoolinfo: [{ status: 200, body: okBody({ size: 50000, bytes: 25_000_000 }) }],
      }),
    );

    const result = await invokeTool({ includeChains: ["bitcoin"] });
    const report = sc(result);

    expect(report.chainProbeStatus.bitcoin).toBe("ok");
    const lag = report.anomaliesDetected.find((a) => a.type === "chain-tip-lag");
    expect(lag).toBeDefined();
    expect(lag?.chain).toBe("bitcoin");
    expect(lag?.detectedLagBlocks).toBe(5);
    expect(lag?.expectedBlocks).toBe(850005);
  });

  // ─── 4. reorg-detected anomaly (BTC) ─────────────────────────────────────

  it("emits reorg-detected for every non-active getchaintips tip with branchlen >= 1", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";
    const nowSecs = Math.floor(Date.now() / 1000);

    vi.stubGlobal(
      "fetch",
      makeMethodFetch({
        getblockchaininfo: [
          { status: 200, body: okBody({ blocks: 850000, bestblockhash: "0xtip", mediantime: nowSecs - 60 }) },
        ],
        getchaintips: [
          {
            status: 200,
            body: okBody([
              { hash: "0xtip", height: 850000, branchlen: 0, status: "active" },
              { hash: "0xfork", height: 849997, branchlen: 3, status: "valid-fork" },
            ]),
          },
        ],
        getmempoolinfo: [{ status: 200, body: okBody({ size: 5000, bytes: 2_500_000 }) }],
      }),
    );

    const result = await invokeTool({ includeChains: ["bitcoin"] });
    const report = sc(result);

    expect(report.chainProbeStatus.bitcoin).toBe("ok");
    const reorgs = report.anomaliesDetected.filter((a) => a.type === "reorg-detected");
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]?.forkBranchLen).toBe(3);
    expect(reorgs[0]?.forkTipHash).toBe("0xfork");
    expect(reorgs[0]?.forkStatus).toBe("valid-fork");
  });

  // ─── 5. mempool-spike anomaly (BTC) ──────────────────────────────────────

  it("emits mempool-spike when mempool size crosses 3x BTC baseline", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";
    const nowSecs = Math.floor(Date.now() / 1000);

    vi.stubGlobal(
      "fetch",
      makeMethodFetch({
        getblockchaininfo: [
          { status: 200, body: okBody({ blocks: 850000, bestblockhash: "0xtip", mediantime: nowSecs - 60 }) },
        ],
        getchaintips: [{ status: 200, body: okBody([{ hash: "0xtip", height: 850000, branchlen: 0, status: "active" }]) }],
        getmempoolinfo: [
          { status: 200, body: okBody({ size: 350_000, bytes: 200_000_000 }) },
        ],
      }),
    );

    const result = await invokeTool({ includeChains: ["bitcoin"] });
    const report = sc(result);

    expect(report.chainProbeStatus.bitcoin).toBe("ok");
    const spike = report.anomaliesDetected.find((a) => a.type === "mempool-spike");
    expect(spike).toBeDefined();
    expect(spike?.chain).toBe("bitcoin");
    expect(spike?.currentSizeTxs).toBe(350_000);
    expect(spike?.baselineSizeTxs).toBe(100_000);
    expect(spike?.spikeFactor).toBe(3.5);
  });

  // ─── 6. All-green (no anomalies) ────────────────────────────────────────

  it("returns empty anomaliesDetected and status === ok when all probes are below thresholds", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";
    const nowSecs = Math.floor(Date.now() / 1000);

    vi.stubGlobal(
      "fetch",
      makeMethodFetch({
        getblockchaininfo: [
          { status: 200, body: okBody({ blocks: 850000, bestblockhash: "0xtip", mediantime: nowSecs - 60 }) },
        ],
        getchaintips: [{ status: 200, body: okBody([{ hash: "0xtip", height: 850000, branchlen: 0, status: "active" }]) }],
        getmempoolinfo: [{ status: 200, body: okBody({ size: 50_000, bytes: 25_000_000 }) }],
      }),
    );

    const result = await invokeTool({ includeChains: ["bitcoin"] });
    const report = sc(result);

    expect(report.chainProbeStatus.bitcoin).toBe("ok");
    expect(report.anomaliesDetected).toEqual([]);
  });

  // ─── 7. Probe timeout — fake timers drive the abort ──────────────────────

  it("surfaces probe-failed when the per-chain 10s AbortController timeout fires", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    // fetch that never resolves on its own; only rejects when the signal aborts.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: unknown, opts?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = opts?.signal as AbortSignal | undefined;
          if (signal) {
            signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted.");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }),
    );

    vi.useFakeTimers();
    const pending = invokeTool({ includeChains: ["bitcoin"] });
    // Advance past both the inner (Core RPC client) and outer (probe) 10s timeouts.
    await vi.advanceTimersByTimeAsync(10_001);
    const result = await pending;
    const report = sc(result);

    expect(report.chainProbeStatus.bitcoin).toBe("probe-failed");
    const failures = report.anomaliesDetected.filter((a) => a.type === "probe-failed");
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(failures.find((a) => a.chain === "bitcoin")).toBeDefined();
  });

  // ─── 8. Partial-success — one sub-call fails, others succeed ─────────────

  it("keeps chain status === ok when one sub-RPC fails — the failure surfaces as a probe-failed anomaly tagged by method", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";
    const nowSecs = Math.floor(Date.now() / 1000);

    vi.stubGlobal(
      "fetch",
      makeMethodFetch({
        getblockchaininfo: [
          { status: 200, body: okBody({ blocks: 850000, bestblockhash: "0xtip", mediantime: nowSecs - 60 }) },
        ],
        getchaintips: [
          // HTTP 500 → BitcoinCoreRpcResult `rpc-error` arm.
          { status: 500, body: { result: null, error: { code: -32603, message: "Internal error" }, id: "vaultpilot" } },
        ],
        getmempoolinfo: [{ status: 200, body: okBody({ size: 50_000, bytes: 25_000_000 }) }],
      }),
    );

    const result = await invokeTool({ includeChains: ["bitcoin"] });
    const report = sc(result);

    // Chain-level status remains "ok" — partial success at the chain level.
    expect(report.chainProbeStatus.bitcoin).toBe("ok");
    // The sub-call failure surfaces tagged with the method name in the reason.
    const failed = report.anomaliesDetected.find(
      (a) => a.type === "probe-failed" && a.chain === "bitcoin",
    );
    expect(failed).toBeDefined();
    expect(String(failed?.reason)).toContain("getchaintips");
  });

  // ─── 8b. WR-05 anchor: LTC partial-success mirrors the BTC partial-success ──
  // After WR-05 extracted runCoreProbe(cfg), BTC and LTC run the SAME body —
  // pin the LTC half so a future regression that breaks one chain breaks
  // the test for the other too.

  it("WR-05: LTC partial-success — one sub-RPC fails (HTTP 500) + other two succeed → status === ok + one probe-failed anomaly tagged litecoin", async () => {
    process.env.LITECOIN_CORE_RPC_URL = "http://localhost:9332";
    const nowSecs = Math.floor(Date.now() / 1000);

    vi.stubGlobal(
      "fetch",
      makeMethodFetch({
        getblockchaininfo: [
          { status: 200, body: okBody({ blocks: 3000000, bestblockhash: "0xltc", mediantime: nowSecs - 60 }) },
        ],
        getchaintips: [
          // HTTP 500 → BitcoinCoreRpcResult `rpc-error` arm.
          { status: 500, body: { result: null, error: { code: -32603, message: "Internal error" }, id: "vaultpilot" } },
        ],
        getmempoolinfo: [{ status: 200, body: okBody({ size: 5_000, bytes: 2_500_000 }) }],
      }),
    );

    const result = await invokeTool({ includeChains: ["litecoin"] });
    const report = sc(result);

    // Chain-level status remains "ok" — partial success at the chain level.
    expect(report.chainProbeStatus.litecoin).toBe("ok");
    // The sub-call failure surfaces tagged with the method name in the reason.
    const failed = report.anomaliesDetected.find(
      (a) => a.type === "probe-failed" && a.chain === "litecoin",
    );
    expect(failed).toBeDefined();
    expect(String(failed?.reason)).toContain("getchaintips");
  });

  // ─── 9. LTC distinct baseline (5_000) ────────────────────────────────────

  it("uses LTC's 5_000-tx mempool baseline for mempool-spike (distinct from BTC's 100_000)", async () => {
    process.env.LITECOIN_CORE_RPC_URL = "http://localhost:9332";
    const nowSecs = Math.floor(Date.now() / 1000);

    vi.stubGlobal(
      "fetch",
      makeMethodFetch({
        getblockchaininfo: [
          { status: 200, body: okBody({ blocks: 3000000, bestblockhash: "0xltc", mediantime: nowSecs - 60 }) },
        ],
        getchaintips: [{ status: 200, body: okBody([{ hash: "0xltc", height: 3000000, branchlen: 0, status: "active" }]) }],
        getmempoolinfo: [{ status: 200, body: okBody({ size: 18_000, bytes: 9_000_000 }) }],
      }),
    );

    const result = await invokeTool({ includeChains: ["litecoin"] });
    const report = sc(result);

    expect(report.chainProbeStatus.litecoin).toBe("ok");
    const spike = report.anomaliesDetected.find((a) => a.type === "mempool-spike");
    expect(spike).toBeDefined();
    expect(spike?.chain).toBe("litecoin");
    expect(spike?.currentSizeTxs).toBe(18_000);
    expect(spike?.baselineSizeTxs).toBe(5_000);
  });

  // ─── 10. NEVER throws — wrapper resolves on every input ─────────────────

  it("NEVER throws — handler resolves for empty args, invalid array, and partial allowlist", async () => {
    await expect(invokeTool()).resolves.toBeDefined();
    await expect(invokeTool({ includeChains: [] })).resolves.toBeDefined();
    await expect(invokeTool({ includeChains: ["bitcoin"] })).resolves.toBeDefined();
    await expect(invokeTool({ includeChains: ["litecoin"] })).resolves.toBeDefined();
    await expect(invokeTool({ includeChains: ["bitcoin", "litecoin"] })).resolves.toBeDefined();
  });

  // ─── 11. reportTimestamp round-trip ISO 8601 ────────────────────────────

  it("reportTimestamp is a valid ISO 8601 string (round-trip equal via new Date().toISOString())", async () => {
    const result = await invokeTool();
    const report = sc(result);

    expect(typeof report.reportTimestamp).toBe("string");
    expect(new Date(report.reportTimestamp).toISOString()).toBe(report.reportTimestamp);
  });
});
