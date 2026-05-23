// src/tools/build_incident_report.ts — Phase 27 Plan 27-03 (BTC-INC-01).
//
// Cross-chain anomaly aggregator. Fans out across configured BTC + LTC chains
// via Promise.allSettled with a per-chain AbortController 10s timeout, then
// surfaces typed AnomalySignal rows in a single agent-consumable response.
//
// Mirrors the Phase 8 get_portfolio_summary.ts:438–457 fan-out idiom so the
// codebase keeps one cross-chain shape.
//
// NEVER-throws contract. Every code path either returns a fulfilled response
// or surfaces failure via a `probe-failed` AnomalySignal + chainProbeStatus.
// The plan's source-grep regression asserts zero raise statements in this
// file (T-27-INCIDENT-NEVER-THROWS).
//
// Default anomaly thresholds are Claude's discretion per CONTEXT.md and
// RESEARCH §Default Anomaly Thresholds:
//   - MEMPOOL_SPIKE_FACTOR_DEFAULT      = 3       (size / baseline >= 3 ⇒ spike)
//   - BTC_MEMPOOL_BASELINE_TXS_DEFAULT  = 100_000 (2026-era BTC mempool baseline)
//   - LTC_MEMPOOL_BASELINE_TXS_DEFAULT  = 5_000   (LTC mempool ~1 order smaller)
//   - CHAIN_TIP_LAG_BLOCKS_DEFAULT      = 2       (> 2 blocks behind wall-clock ⇒ lag)
// Env-driven overrides are deferred per CONTEXT.md — Phase 27 ships static
// defaults; tuning is a v2.2.x or v3.x concern (T-27-INCIDENT-BASELINE-DRIFT
// accepted residual).
//
// Wall-clock derivation uses Date.now() against Core's mediantime field.
// A skewed local clock or natural block-time variance can produce false-positive
// chain-tip-lag signals (T-27-INCIDENT-WALL-CLOCK accepted residual — surfaced
// to the agent via the AnomalySignal.note field).
//
// Security: Bitcoin Core / Litecoin Core RPC URLs and credentials NEVER appear
// in structuredContent or content text (T-27-CORE-CRED-LEAK mitigation).

import { callBitcoinCoreRpc } from "../clients/bitcoin-core-rpc.js";
import {
  getBitcoinCoreRpcUrl,
  getBitcoinCoreRpcUser,
  getBitcoinCoreRpcPass,
  getLitecoinCoreRpcUrl,
  getLitecoinCoreRpcUser,
  getLitecoinCoreRpcPass,
} from "../config/bitcoin-core-env.js";
import { registerTool } from "./index.js";

// ─── Module constants ─────────────────────────────────────────────────────────

/**
 * Per-chain probe budget. Mirrors PER_CHAIN_TIMEOUT_MS in
 * src/tools/get_portfolio_summary.ts:79 — one slow chain MUST NOT block the
 * whole response.
 */
const INCIDENT_REPORT_CHAIN_TIMEOUT_MS = 10_000;

const MEMPOOL_SPIKE_FACTOR_DEFAULT = 3;
const BTC_MEMPOOL_BASELINE_TXS_DEFAULT = 100_000;
const LTC_MEMPOOL_BASELINE_TXS_DEFAULT = 5_000;
const CHAIN_TIP_LAG_BLOCKS_DEFAULT = 2;

/** BTC ~10-min target block time. */
const BTC_TARGET_BLOCK_TIME_SECS = 600;
/** LTC ~2.5-min target block time (well-known LTC parameter). */
const LTC_TARGET_BLOCK_TIME_SECS = 150;

const SUPPORTED_CHAINS = ["bitcoin", "litecoin"] as const;
type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

// ─── AnomalySignal discriminated union ────────────────────────────────────────

export type AnomalySignal =
  | {
      type: "chain-tip-lag";
      chain: string;
      detectedLagBlocks: number;
      expectedBlocks: number;
      note: string;
    }
  | {
      type: "reorg-detected";
      chain: string;
      forkBranchLen: number;
      forkTipHash: string;
      forkStatus: "valid-fork" | "valid-headers" | "headers-only";
    }
  | {
      type: "mempool-spike";
      chain: string;
      currentSizeTxs: number;
      baselineSizeTxs: number;
      spikeFactor: number;
    }
  | {
      type: "probe-failed";
      chain: string;
      reason: string;
    };

// ─── Core RPC response shapes (subset used here) ─────────────────────────────

interface GetBlockchainInfoResult {
  blocks: number;
  bestblockhash: string;
  mediantime: number;
  [key: string]: unknown;
}

interface ChainTip {
  hash: string;
  height: number;
  branchlen: number;
  status: "active" | "valid-fork" | "valid-headers" | "headers-only" | "invalid";
}

interface GetMempoolInfoResult {
  size: number;
  bytes: number;
  // Index signature absorbs LTC MWEB fields (mweb_usage, mweb_size, …) so the
  // shared shape works for BTC + LTC alike.
  [key: string]: unknown;
}

// ─── Probe-result envelope ───────────────────────────────────────────────────

type ProbeStatus = "ok" | "core-not-configured";
type ChainProbeStatus = "ok" | "probe-failed" | "core-not-configured" | "not-included";

interface ProbeResult {
  status: ProbeStatus;
  anomalies: AnomalySignal[];
}

interface Probe {
  chain: SupportedChain;
  run: () => Promise<ProbeResult>;
}

// ─── Tool registration ────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Aggregates cross-chain on-chain anomaly signals for the agent's single-call security-event triage.",
  "Fans out across configured Bitcoin and Litecoin chains via Promise.allSettled with a per-chain 10s AbortController timeout — one slow chain never blocks the whole response.",
  "Each probe returns AnomalySignal[] or rejects; a rejection becomes a `probe-failed` row, NEVER re-thrown.",
  "Emits four typed anomaly variants: `chain-tip-lag` (wall-clock derived against Core's mediantime), `reorg-detected` (any non-active getchaintips tip with branchlen >= 1), `mempool-spike` (current mempool size >= baseline * 3), and `probe-failed`.",
  "When Core RPC is unset for a chain, the probe gracefully reports `core-not-configured` with no anomalies — Core absent is configuration state, not an incident.",
  "Use this when the agent needs cross-chain anomaly correlation (\"is anything weird happening on-chain?\"). Phase 27 ships BTC + LTC; EVM-chain probes are deferred.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    includeChains: {
      type: "array",
      items: { type: "string", enum: ["bitcoin", "litecoin"] },
      description:
        "Optional chain allowlist; omit to fan out across all supported chains (bitcoin, litecoin). EVM-chain aggregation is deferred — Phase 27 ships BTC + LTC only.",
    },
  },
  required: [],
  additionalProperties: false,
};

registerTool("build_incident_report", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // ─── Resolve chain allowlist ─────────────────────────────────────────────
  const requestedRaw = Array.isArray(args.includeChains) ? args.includeChains : null;
  let chainsRequested: SupportedChain[];
  if (requestedRaw !== null && requestedRaw.length > 0) {
    const filtered = requestedRaw.filter(
      (c): c is SupportedChain =>
        typeof c === "string" && (SUPPORTED_CHAINS as readonly string[]).includes(c),
    );
    // De-duplicate + sort for response determinism.
    chainsRequested = Array.from(new Set(filtered)).sort() as SupportedChain[];
    if (chainsRequested.length === 0) {
      // includeChains supplied but no valid entry — degrade to the full allowlist.
      chainsRequested = [...SUPPORTED_CHAINS];
    }
  } else {
    chainsRequested = [...SUPPORTED_CHAINS];
  }

  // ─── Build probe list ────────────────────────────────────────────────────
  const probes: Probe[] = chainsRequested.map((chain) => ({
    chain,
    run: chain === "bitcoin" ? runBtcProbe : runLtcProbe,
  }));

  // ─── Fan out with per-chain timeout ──────────────────────────────────────
  const settled = await Promise.allSettled(
    probes.map((p) => runProbeWithTimeout(p, INCIDENT_REPORT_CHAIN_TIMEOUT_MS)),
  );

  // ─── Aggregate ───────────────────────────────────────────────────────────
  const anomaliesDetected: AnomalySignal[] = [];
  const chainProbeStatus: Record<string, ChainProbeStatus> = {};

  for (let i = 0; i < settled.length; i++) {
    const probe = probes[i]!;
    const r = settled[i]!;
    if (r.status === "fulfilled") {
      if (r.value.status === "ok") {
        chainProbeStatus[probe.chain] = "ok";
        for (const a of r.value.anomalies) anomaliesDetected.push(a);
      } else {
        // core-not-configured
        chainProbeStatus[probe.chain] = "core-not-configured";
      }
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      chainProbeStatus[probe.chain] = "probe-failed";
      anomaliesDetected.push({ type: "probe-failed", chain: probe.chain, reason });
    }
  }

  const reportTimestamp = new Date().toISOString();

  // ─── Render text content ─────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`Cross-chain incident report (${reportTimestamp})`);
  lines.push(`  chainsProbed: ${chainsRequested.join(", ")}`);
  for (const chain of chainsRequested) {
    const status = chainProbeStatus[chain] ?? "not-included";
    lines.push(`  ${chain}: ${status}`);
    const chainAnomalies = anomaliesDetected.filter((a) => a.chain === chain).slice(0, 10);
    for (const a of chainAnomalies) {
      lines.push(`    ${renderAnomalyLine(a)}`);
    }
  }
  if (anomaliesDetected.length === 0) {
    lines.push("  anomaliesDetected: none");
  } else {
    lines.push(`  anomaliesDetected: ${anomaliesDetected.length} total`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      reportTimestamp,
      chainsProbed: chainsRequested,
      anomaliesDetected,
      chainProbeStatus,
    },
  };
});

// ─── Per-probe timeout wrapper ───────────────────────────────────────────────

/**
 * Race the probe against an AbortController 10s timeout. Mirrors
 * `readChainPortfolioWithTimeout` in src/tools/get_portfolio_summary.ts:438–457.
 *
 * The outer 10s Promise.race wins on aggregate probe latency; the inner
 * callBitcoinCoreRpc has its own BITCOIN_CORE_RPC_TIMEOUT_MS so in-flight
 * fetches are cancelled independently. No external signal is threaded —
 * explicit by design.
 */
async function runProbeWithTimeout(probe: Probe, timeoutMs: number): Promise<ProbeResult> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    return await Promise.race<ProbeResult>([
      probe.run(),
      new Promise<ProbeResult>((_, reject) => {
        abort.signal.addEventListener("abort", () => {
          reject(new Error(`timeout after ${timeoutMs}ms`));
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Chain-parameterized core probe ──────────────────────────────────────────
//
// WR-05: BTC + LTC probes were line-for-line identical except for the chain
// literal, env readers, mempool baseline, and target block time. Extract a
// single runCoreProbe(cfg) so a future sub-probe addition (e.g. verifychain)
// or partial-success-aggregation tweak touches one site, not two.
//
// IN-06 note: the `kind !== "not-configured"` guards on each non-ok arm are
// defensive — callBitcoinCoreRpc only emits the not-configured arm when its
// URL argument is null (client line 92), and runCoreProbe short-circuits on
// `url === null` above before any RPC call. The guards keep type-narrowing
// tidy (rpcMessage cannot consume the not-configured arm).

interface ChainProbeConfig {
  chain: SupportedChain;
  getUrl: () => string | null;
  getUser: () => string | undefined;
  getPass: () => string | undefined;
  mempoolBaselineTxs: number;
  targetBlockTimeSecs: number;
}

const BTC_PROBE_CONFIG: ChainProbeConfig = {
  chain: "bitcoin",
  getUrl: getBitcoinCoreRpcUrl,
  getUser: getBitcoinCoreRpcUser,
  getPass: getBitcoinCoreRpcPass,
  mempoolBaselineTxs: BTC_MEMPOOL_BASELINE_TXS_DEFAULT,
  targetBlockTimeSecs: BTC_TARGET_BLOCK_TIME_SECS,
};

const LTC_PROBE_CONFIG: ChainProbeConfig = {
  chain: "litecoin",
  getUrl: getLitecoinCoreRpcUrl,
  getUser: getLitecoinCoreRpcUser,
  getPass: getLitecoinCoreRpcPass,
  mempoolBaselineTxs: LTC_MEMPOOL_BASELINE_TXS_DEFAULT,
  targetBlockTimeSecs: LTC_TARGET_BLOCK_TIME_SECS,
};

async function runCoreProbe(cfg: ChainProbeConfig): Promise<ProbeResult> {
  const url = cfg.getUrl();
  if (url === null) {
    return { status: "core-not-configured", anomalies: [] };
  }
  const user = cfg.getUser();
  const pass = cfg.getPass();

  // Three parallel RPC calls. Partial-success aggregation — one failed sub-call
  // contributes a `probe-failed` anomaly tagged to its method but the OTHER
  // probes proceed.
  const [infoRes, tipsRes, memRes] = await Promise.all([
    callBitcoinCoreRpc<GetBlockchainInfoResult>(url, user, pass, "getblockchaininfo", []),
    callBitcoinCoreRpc<ChainTip[]>(url, user, pass, "getchaintips", []),
    callBitcoinCoreRpc<GetMempoolInfoResult>(url, user, pass, "getmempoolinfo", []),
  ]);

  const anomalies: AnomalySignal[] = [];

  // chain-tip-lag
  if (infoRes.kind === "ok") {
    const lagAnomaly = deriveTipLag(cfg.chain, infoRes.result, cfg.targetBlockTimeSecs);
    if (lagAnomaly !== null) anomalies.push(lagAnomaly);
  } else if (infoRes.kind !== "not-configured") {
    anomalies.push({
      type: "probe-failed",
      chain: cfg.chain,
      reason: `getblockchaininfo: ${rpcMessage(infoRes)}`,
    });
  }

  // reorg-detected
  if (tipsRes.kind === "ok") {
    for (const tip of tipsRes.result) {
      if (tip.status !== "active" && tip.branchlen >= 1 && tip.status !== "invalid") {
        anomalies.push({
          type: "reorg-detected",
          chain: cfg.chain,
          forkBranchLen: tip.branchlen,
          forkTipHash: tip.hash,
          forkStatus: tip.status,
        });
      }
    }
  } else if (tipsRes.kind !== "not-configured") {
    anomalies.push({
      type: "probe-failed",
      chain: cfg.chain,
      reason: `getchaintips: ${rpcMessage(tipsRes)}`,
    });
  }

  // mempool-spike
  if (memRes.kind === "ok") {
    const spike = deriveMempoolSpike(cfg.chain, memRes.result.size, cfg.mempoolBaselineTxs);
    if (spike !== null) anomalies.push(spike);
  } else if (memRes.kind !== "not-configured") {
    anomalies.push({
      type: "probe-failed",
      chain: cfg.chain,
      reason: `getmempoolinfo: ${rpcMessage(memRes)}`,
    });
  }

  return { status: "ok", anomalies };
}

async function runBtcProbe(): Promise<ProbeResult> {
  return runCoreProbe(BTC_PROBE_CONFIG);
}

async function runLtcProbe(): Promise<ProbeResult> {
  return runCoreProbe(LTC_PROBE_CONFIG);
}

// ─── Anomaly derivation helpers ──────────────────────────────────────────────

/**
 * Wall-clock-derived chain-tip-lag detection.
 *
 * expectedHeight = blocks + floor((now - mediantime) / targetBlockTimeSecs).
 * If expectedHeight - blocks > CHAIN_TIP_LAG_BLOCKS_DEFAULT (2), emit anomaly.
 *
 * The mediantime field is Core's median-of-last-11-block timestamps; it is more
 * stable than the tip block's own timestamp. The local clock is the residual
 * trust input (T-27-INCIDENT-WALL-CLOCK accepted residual).
 */
function deriveTipLag(
  chain: string,
  info: GetBlockchainInfoResult,
  targetBlockTimeSecs: number,
): AnomalySignal | null {
  const now = Math.floor(Date.now() / 1000);
  const elapsedSecs = now - info.mediantime;
  if (elapsedSecs <= 0) return null; // mediantime in the future — clock skew or test fixture; no signal.
  const expectedHeight = info.blocks + Math.floor(elapsedSecs / targetBlockTimeSecs);
  const detectedLagBlocks = expectedHeight - info.blocks;
  if (detectedLagBlocks <= CHAIN_TIP_LAG_BLOCKS_DEFAULT) return null;
  return {
    type: "chain-tip-lag",
    chain,
    detectedLagBlocks,
    expectedBlocks: expectedHeight,
    note: `Wall-clock derived; assumes ~${targetBlockTimeSecs}s target block time and a trustworthy local clock`,
  };
}

/**
 * Mempool-size spike detection — size / baseline >= MEMPOOL_SPIKE_FACTOR_DEFAULT.
 */
function deriveMempoolSpike(
  chain: string,
  currentSizeTxs: number,
  baselineSizeTxs: number,
): AnomalySignal | null {
  if (baselineSizeTxs <= 0) return null;
  if (currentSizeTxs < baselineSizeTxs * MEMPOOL_SPIKE_FACTOR_DEFAULT) return null;
  return {
    type: "mempool-spike",
    chain,
    currentSizeTxs,
    baselineSizeTxs,
    spikeFactor: currentSizeTxs / baselineSizeTxs,
  };
}

/** Render a stable message for a non-ok BitcoinCoreRpcResult arm. */
function rpcMessage(
  res:
    | { kind: "rpc-error"; code: number; message: string }
    | { kind: "rate-limited"; message: string }
    | { kind: "network-error"; message: string },
): string {
  if (res.kind === "rpc-error") return `code=${res.code} ${res.message}`;
  return res.message;
}

/** One-line agent-friendly anomaly renderer. */
function renderAnomalyLine(a: AnomalySignal): string {
  switch (a.type) {
    case "chain-tip-lag":
      return `chain-tip-lag detectedLagBlocks=${a.detectedLagBlocks} expectedBlocks=${a.expectedBlocks}`;
    case "reorg-detected":
      return `reorg-detected forkStatus=${a.forkStatus} forkBranchLen=${a.forkBranchLen} forkTipHash=${a.forkTipHash}`;
    case "mempool-spike":
      return `mempool-spike currentSizeTxs=${a.currentSizeTxs} baselineSizeTxs=${a.baselineSizeTxs} spikeFactor=${a.spikeFactor.toFixed(2)}`;
    case "probe-failed":
      return `probe-failed reason=${a.reason}`;
  }
}
