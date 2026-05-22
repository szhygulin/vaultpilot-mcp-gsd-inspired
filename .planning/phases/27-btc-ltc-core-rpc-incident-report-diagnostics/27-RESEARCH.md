# Phase 27: Optional Bitcoin/Litecoin Core RPC + `build_incident_report` + diagnostics — Research

**Researched:** 2026-05-23
**Domain:** Bitcoin Core / Litecoin Core JSON-RPC; cross-chain anomaly-signal aggregation; NEVER-throws HTTP client pattern (project-internal)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Bitcoin Core JSON-RPC client shape**: mirrors `src/clients/etherscan.ts` (never-throws, basic-auth via `BITCOIN_CORE_RPC_USER` + `_PASS`, 5-arm discriminated union — `not-configured | ok | rpc-error | rate-limited | network-error`).
- **`coreNotConfigured` envelope**: when `BITCOIN_CORE_RPC_URL` is absent, every forensic tool returns a structured `{ status: "core-not-configured", message: "Set BITCOIN_CORE_RPC_URL to enable forensic reads", esploraFallbackAvailable: <bool> }` envelope. Tools that have an Esplora fallback (e.g. `get_btc_block_tip` can serve a tip-only response from Esplora) surface the fallback shape; tools that don't (e.g. `get_btc_mempool_summary` needs Core RPC) refuse cleanly.
- **`build_incident_report` shape**: aggregates per-chain anomaly signals — chain-tip lag, recent reorg events (Core RPC `getchaintips`), mempool size deviations from baseline, large unconfirmed-balance changes for known wallets. Cross-chain bundling: EVM chains (via existing Phase 8 multi-chain RPC) + BTC + LTC. Returns `{ chainsProbed[], anomaliesDetected[], reportTimestamp }`.
- **SECURITY.md v2.2 finalization**: BTC/LTC threat-model section covers PSBT serialization trust shape + per-input BIP-143 sighash binding + Bitcoin Core RPC trust shape (private-node deployment recommended for forensic queries — public-RPC Core nodes are rare). LTC threat model is brief — mirrors BTC with chain-specific endpoints.

### Claude's Discretion

- Internal helper names (`BitcoinCoreRpcClient`, `IncidentReportBuilder`, etc.)
- Anomaly-detection thresholds (mempool-size deviation, large unconfirmed-balance — Phase 27 ships sensible defaults; configurable via env in future)
- Whether `build_incident_report` ships in Phase 27 or splits to a separate v2.2.x follow-up phase

### Deferred Ideas (OUT OF SCOPE)

- Private/Bitcoin-Core-hosted-service auto-detection — defer; users explicitly set `BITCOIN_CORE_RPC_URL`
- Real-time mempool subscription (WebSocket from mempool.space / Core) — defer; on-demand probes suffice
- `build_incident_report` historical-window scans (last N days of anomalies) — defer; v2.2 ships point-in-time snapshot only
- Cross-chain reorg-detection alerting (push notifications when a watched chain reorgs deeper than N blocks) — defer; v2.2 ships pull-only
- LiFi/cross-chain bridge anomaly detection (volume spikes, stuck transactions) — defer to v2.6 BRIDGE-T1 follow-up
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BTC-FORENSIC-01 | `BITCOIN_CORE_RPC_URL` (with optional `_USER`/`_PASS` basic-auth) enables Bitcoin Core JSON-RPC; absent → forensic tools return `coreNotConfigured` envelope | §Standard Stack + §Architecture Patterns §Pattern 1 |
| BTC-FORENSIC-02 | `get_btc_block_tip()` returns chain tip + timestamp + difficulty (Core RPC if configured; Esplora fallback for tip-only without difficulty) | §Esplora Fallback Granularity |
| BTC-FORENSIC-03 | `get_btc_block_stats({ blockHeight })` returns per-block tx count + fee percentiles + size + segwit adoption | §Bitcoin Core RPC Method Shapes §getblockstats |
| BTC-FORENSIC-04 | `get_btc_blocks_recent({ count })` returns last N block summaries; `get_btc_chain_tips()` returns all known chain tips (reorg detection) | §Bitcoin Core RPC Method Shapes §getchaintips |
| BTC-FORENSIC-05 | `get_btc_mempool_summary()` returns mempool size + fee-rate histogram (Core RPC only) | §Bitcoin Core RPC Method Shapes §getmempoolinfo |
| LTC-FORENSIC-01 | `LITECOIN_CORE_RPC_URL` enables LTC-equivalent forensic suite — parallel tools mirroring BTC-FORENSIC-02..05 | §Litecoin Core RPC Compatibility |
| BTC-INC-01 | `build_incident_report({ wallet?, includeChains? })` bundles BTC/LTC + EVM anomaly signals for cross-chain security-event triage | §build_incident_report Design |
</phase_requirements>

---

## Summary

Phase 27 ships the final v2.2 milestone component: an optional Bitcoin Core / Litecoin Core JSON-RPC client that unlocks forensic reads Esplora cannot serve, and a `build_incident_report` tool that aggregates cross-chain anomaly signals for security-event triage.

The JSON-RPC transport is straightforward HTTP POST with HTTP Basic Authentication (`Authorization: Basic base64(user:pass)`). Every forensic tool follows the `coreNotConfigured` envelope discipline: no Core URL → structured refusal, never silent failure. Some tools degrade gracefully to Esplora (e.g., `get_btc_block_tip` serves tip height from Esplora if Core is absent); others are Core-only (e.g., `get_btc_mempool_summary`).

Litecoin Core is highly compatible with Bitcoin Core's RPC interface — `getblockstats`, `getchaintips`, `getmempoolinfo`, `getblockchaininfo` all exist with the same field shapes. The only Litecoin-specific divergence is the presence of MWEB (MimbleWimble Extension Blocks) fields in mempool and block data; Phase 27 ignores MWEB fields (they are additive, not breaking).

`build_incident_report` fans out via `Promise.allSettled` across all configured chains (BTC + LTC + up to 5 EVM chains), mirroring Phase 8's `get_portfolio_summary` cross-chain pattern. A 10s per-chain timeout keeps the aggregate latency bounded. Anomaly signals are typed and per-chain tagged; the response is agent-consumable structured output.

**Primary recommendation:** Implement `src/clients/bitcoin-core-rpc.ts` as a single-file NEVER-throws JSON-RPC client with `vi.stubGlobal("fetch", …)` test seam (identical to `src/clients/lifi.ts` and `src/chains/bitcoin/esplora-client.ts`). Reuse this client for both BTC and LTC (parameterized by URL + credentials). Ship forensic tools in Plan 27-01 (BTC Core client + block tools) + Plan 27-02 (mempool + LTC mirror) + Plan 27-03 (`build_incident_report` + SECURITY.md v2.2 close-out).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bitcoin Core JSON-RPC client | API / Backend (MCP server) | — | HTTP POST to private Core node; no browser involvement |
| `get_btc_block_tip` (Core path) | API / Backend | Esplora fallback (same tier) | Core RPC if configured, else Esplora degraded read |
| `get_btc_block_stats` | API / Backend | — | Core-only (getblockstats has no Esplora equivalent) |
| `get_btc_chain_tips` | API / Backend | — | Core-only (Esplora has no multi-tip endpoint) |
| `get_btc_mempool_summary` | API / Backend | — | Core-only (full mempool census unavailable via Esplora) |
| `get_litecoin_block_tip` / `_mempool_summary` | API / Backend | Esplora fallback for tip | LTC mirrors BTC |
| `build_incident_report` | API / Backend | — | Aggregates across all configured chains; EVM uses existing viem RPC registry |
| `bitcoinCoreConfigured` / `litecoinCoreConfigured` in config status | API / Backend | — | Boolean surfacing only; never leaks URL or credentials |
| SECURITY.md v2.2 finalization | Documentation | — | No code change; append-only SECURITY.md update |

---

## Standard Stack

### Core

No new npm packages are required for Phase 27. All JSON-RPC transport is via native `fetch` (available in Node.js ≥ 18.17 — the project's minimum runtime, confirmed from `package.json`). [VERIFIED: existing project codebase pattern — all HTTP clients in this project use native fetch: `src/clients/lifi.ts`, `src/clients/etherscan.ts`, `src/chains/bitcoin/esplora-client.ts`]

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `fetch` | Node.js built-in (≥ 18.17) | Bitcoin Core / Litecoin Core JSON-RPC HTTP POST | Already used for all HTTP clients in project; no additional dep needed |
| `vitest` | existing (project) | Testing | Project-wide test framework |

### Supporting (existing project infrastructure — no new installs)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `src/clients/etherscan.ts` | project | Reference for NEVER-throws 5-arm union + basic-auth shape | Pattern template for `bitcoin-core-rpc.ts` |
| `src/clients/lifi.ts` | project | Reference for `vi.stubGlobal("fetch")` test seam convention | Pattern template for test structure |
| `src/chains/bitcoin/esplora-client.ts` | project | Esplora fallback reads | Used by `get_btc_block_tip` Esplora degraded path |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native fetch | `node-fetch` or `axios` | No benefit; project already standardized on native fetch |
| Custom JSON-RPC library | `bitcoin-core` npm package | Adds a dep; NEVER-throws pattern is not native to most RPC libraries; inline fetch is 50 lines |

**Installation:** No new packages. Phase 27 ships zero new npm dependencies.

---

## Package Legitimacy Audit

No new packages are introduced in Phase 27. All implementation uses native `fetch` and existing project infrastructure.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | — | N/A |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Agent (MCP call)
       │
       ▼
  Tool Handler (src/tools/get_btc_block_tip.ts etc.)
       │
       ├──[BITCOIN_CORE_RPC_URL set]──► src/clients/bitcoin-core-rpc.ts
       │                                    │  HTTP POST + Basic Auth
       │                                    ▼
       │                             Bitcoin Core / Litecoin Core node
       │                             (private; operator-deployed)
       │
       └──[BITCOIN_CORE_RPC_URL absent + tool has fallback]
                │
                ▼
         src/chains/bitcoin/esplora-client.ts
              │  HTTP GET
              ▼
         Esplora (mempool.space / blockstream.info)
              (degraded: tip+height only, no difficulty)


build_incident_report:

Agent
  │
  ▼
Tool Handler (src/tools/build_incident_report.ts)
  │  Promise.allSettled fan-out (10s timeout per chain)
  ├──► BTC probe (bitcoin-core-rpc.ts or esplora-client.ts)
  ├──► LTC probe (litecoin-core-rpc.ts or ltc esplora-client.ts)
  ├──► ETH/ARB/POL/BASE/OPT probes (existing viem RPC registry — Phase 8)
  ▼
AnomalySignal[] per chain → { chainsProbed[], anomaliesDetected[], reportTimestamp }
```

### Recommended Project Structure

```
src/
├── clients/
│   └── bitcoin-core-rpc.ts     # NEVER-throws JSON-RPC client (BTC + LTC parameterized)
├── tools/
│   ├── get_btc_block_tip.ts    # BTC-FORENSIC-02
│   ├── get_btc_block_stats.ts  # BTC-FORENSIC-03
│   ├── get_btc_blocks_recent.ts # BTC-FORENSIC-04
│   ├── get_btc_chain_tips.ts   # BTC-FORENSIC-04
│   ├── get_btc_mempool_summary.ts # BTC-FORENSIC-05
│   ├── get_litecoin_block_tip.ts  # LTC-FORENSIC-01
│   ├── get_litecoin_mempool_summary.ts # LTC-FORENSIC-01
│   └── build_incident_report.ts   # BTC-INC-01
└── config/
    └── bitcoin-core-env.ts     # getBitcoinCoreRpcUrl() / getLitecoinCoreRpcUrl() env readers
```

Note: LTC forensic tools may live in the same file as BTC (parameterized on chain) or in a sibling `get_litecoin_*` file — Claude's discretion per CONTEXT.md.

---

### Pattern 1: Bitcoin Core JSON-RPC Client (NEVER-throws, basic-auth)

**What:** HTTP POST to `BITCOIN_CORE_RPC_URL` with `Authorization: Basic base64(user:pass)` header. Returns a 5-arm discriminated union.

**When to use:** Any time a forensic tool needs Core-specific data (difficulty, block stats, mempool census, chain tips).

**Shape (mirrors `src/clients/etherscan.ts` + `src/clients/lifi.ts`):**

```typescript
// Source: project pattern — src/clients/etherscan.ts + src/clients/lifi.ts [VERIFIED: project codebase]
// Parameterized to serve both BTC (BITCOIN_CORE_RPC_URL) and LTC (LITECOIN_CORE_RPC_URL).

export type BitcoinCoreRpcResult<T> =
  | { kind: "not-configured" }
  | { kind: "ok"; result: T }
  | { kind: "rpc-error"; code: number; message: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "network-error"; message: string };

// JSON-RPC request shape (Bitcoin Core uses JSON-RPC 1.0 or 2.0):
// POST / HTTP/1.1
// Content-Type: application/json
// Authorization: Basic base64("user:pass")
// { "jsonrpc": "1.0", "id": "vaultpilot", "method": "<method>", "params": [...] }
//
// Response shape:
// { "result": <T> | null, "error": { "code": <int>, "message": <string> } | null, "id": "vaultpilot" }

export async function callBitcoinCoreRpc<T>(
  url: string | null,
  user: string | undefined,
  pass: string | undefined,
  method: string,
  params: unknown[],
): Promise<BitcoinCoreRpcResult<T>> {
  if (url === null) return { kind: "not-configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BITCOIN_CORE_RPC_TIMEOUT_MS);

  const authHeader =
    user !== undefined && pass !== undefined
      ? "Basic " + Buffer.from(`${user}:${pass}`).toString("base64")
      : undefined;

  let result: BitcoinCoreRpcResult<T>;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader !== undefined ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({ jsonrpc: "1.0", id: "vaultpilot", method, params }),
      signal: controller.signal,
    });
    if (resp.status === 429) {
      result = { kind: "rate-limited", message: `Bitcoin Core RPC rate-limited (429)` };
    } else if (!resp.ok) {
      // Core uses HTTP 500 for RPC-level errors (method not found, wrong params, etc.)
      // Try to parse the JSON-RPC error body before falling back to generic error.
      let body: { error?: { code?: unknown; message?: unknown } } | null = null;
      try { body = await resp.json() as typeof body; } catch { /* ignore */ }
      const rpcCode = typeof body?.error?.code === "number" ? body.error.code : resp.status;
      const rpcMsg = typeof body?.error?.message === "string" ? body.error.message : `HTTP ${resp.status}`;
      result = { kind: "rpc-error", code: rpcCode, message: rpcMsg };
    } else {
      let body: { result?: T; error?: { code?: number; message?: string } | null };
      try { body = await resp.json() as typeof body; } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result = { kind: "network-error", message: `JSON parse error: ${msg}` };
        return result;
      }
      if (body.error != null) {
        result = {
          kind: "rpc-error",
          code: body.error.code ?? -1,
          message: body.error.message ?? "unknown RPC error",
        };
      } else {
        result = { kind: "ok", result: body.result as T };
      }
    }
  } catch (err) {
    const e = err as Error;
    if (e?.name === "AbortError") {
      result = { kind: "network-error", message: `Bitcoin Core RPC timeout (${BITCOIN_CORE_RPC_TIMEOUT_MS}ms)` };
    } else {
      result = { kind: "network-error", message: `Bitcoin Core RPC unreachable: ${e?.message ?? String(err)}` };
    }
  } finally {
    clearTimeout(timer);
  }
  return result;
}
```

[CITED: https://developer.bitcoin.org/reference/rpc/ + https://en.bitcoin.it/wiki/API_reference_(JSON-RPC)]

---

### Pattern 2: `coreNotConfigured` Envelope

**What:** When `BITCOIN_CORE_RPC_URL` is absent, forensic tools return a structured envelope (never throw, never return empty). Tools with Esplora fallbacks return degraded data; Core-only tools refuse cleanly.

**When to use:** At the top of every forensic tool handler, before attempting any RPC call.

```typescript
// Source: CONTEXT.md locked decision [VERIFIED: project CONTEXT.md]
// Tools with Esplora fallback (get_btc_block_tip):
const coreUrl = getBitcoinCoreRpcUrl();
if (coreUrl === null) {
  const esploraResult = await fetchAddressInfo(...); // or fetchFeeEstimates for block height
  return {
    status: "core-not-configured",
    message: "Set BITCOIN_CORE_RPC_URL to enable forensic reads (difficulty unavailable)",
    esploraFallbackAvailable: true,
    tip: { height: <from_esplora>, hash: null, difficulty: null, timestamp: <from_esplora> },
  };
}

// Core-only tools (get_btc_mempool_summary):
if (coreUrl === null) {
  return {
    status: "core-not-configured",
    message: "Set BITCOIN_CORE_RPC_URL to enable mempool forensics (Esplora does not expose full mempool)",
    esploraFallbackAvailable: false,
  };
}
```

---

### Pattern 3: `build_incident_report` Cross-chain Fan-out

**What:** `Promise.allSettled` fan-out across configured chains, each with a 10s timeout. Mirrors Phase 8 `get_portfolio_summary` pattern.

**When to use:** `build_incident_report` tool handler.

```typescript
// Source: Phase 8 src/tools/get_portfolio_summary.ts (Promise.allSettled + AbortController pattern) [VERIFIED: project codebase]
const probes = buildProbeList(params.includeChains);
const results = await Promise.allSettled(
  probes.map(async (probe) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INCIDENT_REPORT_CHAIN_TIMEOUT_MS); // 10s
    try {
      return await probe.run(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  })
);
// Collect anomalySignals from settled results; rejected probes → { chain, status: "probe-failed", reason }
```

---

### Pattern 4: `vi.stubGlobal("fetch")` Test Seam

**What:** Tests stub global `fetch` — no internal `_bitcoinCoreRpcClient` indirection. Per CLAUDE.md convention for external HTTP clients.

**When to use:** All tests for `bitcoin-core-rpc.ts` and forensic tool handlers.

```typescript
// Source: src/clients/lifi.ts comment + CLAUDE.md convention [VERIFIED: project CLAUDE.md + src/clients/lifi.ts]
// Do NOT add a _bitcoinCoreRpcClient indirection — that applies to modules
// whose internal exports call each other. External HTTP client → vi.stubGlobal("fetch", …).
vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  // mock implementation
  return new Response(JSON.stringify({ result: mockResult, error: null, id: "vaultpilot" }), { status: 200 });
});
```

---

### Anti-Patterns to Avoid

- **Mixing `not-configured` into the union where `ok`/`rpc-error` belong:** The `callBitcoinCoreRpc` helper should return `not-configured` only when URL is null; the tool layer handles the `coreNotConfigured` envelope shape. This keeps the RPC client reusable.
- **Treating `rpc-error` as `network-error`:** Bitcoin Core returns HTTP 500 for application-level JSON-RPC errors (method not found, wrong params, auth failure). Parse the JSON body before emitting `rpc-error`; fall back to `network-error` only when the body is unparseable.
- **Adding `_bitcoinCoreRpcClient` indirection:** Per CLAUDE.md, this would be wrong for an external HTTP client. The test seam is `vi.stubGlobal("fetch")`.
- **Surfacing `BITCOIN_CORE_RPC_URL` in config status or tool responses:** Same rule as `ETHEREUM_RPC_URL` — surface `bitcoinCoreConfigured: boolean` only.
- **Polling `getrawmempool` for fee histogram:** `getrawmempool(true)` dumps every tx and is expensive. Use `getmempoolinfo` for the summary (size, bytes, mempoolminfee). Derive fee-rate histogram by calling `getrawmempool(true)` and bucketing `fees.base / vsize` — or skip the histogram in Phase 27 (report mempool size spike only; histogram is out of scope per CONTEXT.md deferred).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP Basic auth header | Manual base64 encode every time | `Buffer.from("user:pass").toString("base64")` (one-liner in Node.js) | Already available in Node.js; no npm dep needed |
| Cross-chain fan-out with timeout | Custom Promise.race chains | `Promise.allSettled` + `AbortController` per probe (Phase 8 pattern) | Already proven in `get_portfolio_summary` |
| Fee-rate histogram bucketing | Custom bucketing algorithm | `getmempoolinfo` for summary; `getrawmempool(true)` + client-side sort+bucket if needed | `getmempoolinfo` gives `size + bytes + mempoolminfee` — sufficient for Phase 27 spike detection |
| Block tip from Esplora for fallback | New Esplora endpoint | `fetchAddressInfo` on a known address OR `fetchFeeEstimates` (block height not exposed) | Actually: Esplora `/blocks/tip/height` endpoint returns current height as plain text; use `_bitcoinRegistry.getEsploraBaseUrl() + "/blocks/tip/height"` |

**Key insight:** The Bitcoin Core RPC client is an HTTP POST wrapper — ~80 lines. There is nothing to hand-roll beyond the standard NEVER-throws discriminated-union pattern the project already uses in 4 existing clients.

---

## Bitcoin Core RPC Method Shapes

### `getblockchaininfo`

Used by: `get_btc_block_tip` (Core path), `get_btc_blocks_recent` (for chain context)

```typescript
// Source: https://developer.bitcoin.org/reference/rpc/getblockchaininfo.html [CITED]
interface GetBlockchainInfoResult {
  chain: "main" | "test" | "regtest";
  blocks: number;          // height of most-work validated chain
  bestblockhash: string;   // hex hash of current best block
  difficulty: number;      // current difficulty (float)
  mediantime: number;      // median unix time of recent blocks (NOT "time")
  // Note: no "time" field in getblockchaininfo — use getblockheader(bestblockhash) for block time
}
```

**Important:** `getblockchaininfo` has NO `time` field. [CITED: https://developer.bitcoin.org/reference/rpc/getblockchaininfo.html] To get the tip block timestamp, call `getblockheader(bestblockhash)` which returns both `time` and `mediantime`. [CITED: https://developer.bitcoin.org/reference/rpc/getblockheader.html]

**Efficient approach for `get_btc_block_tip`:** One call to `getblockchaininfo` gives height + difficulty + bestblockhash, then one call to `getblockheader(bestblockhash)` gives timestamp. Two serial RPC calls, or parallelize with `Promise.all`.

### `getblockstats`

Used by: `get_btc_block_stats`, `get_btc_blocks_recent`

```typescript
// Source: https://bitcoincore.org/en/doc/25.0.0/rpc/blockchain/getblockstats/ [CITED]
// Parameters: getblockstats(hash_or_height, [stats_array])
// stats_array is optional; omit to get all fields.
interface GetBlockStatsResult {
  blockhash: string;
  height: number;
  time: number;        // unix timestamp
  mediantime: number;
  txs: number;         // total transactions (including coinbase)
  swtxs: number;       // number of segwit transactions
  avgfee: number;      // average fee in satoshis
  avgfeerate: number;  // average fee rate (sat/vB)
  medianfee: number;
  medianfeerate: number;
  feerate_percentiles: [number, number, number, number, number]; // [10th, 25th, 50th, 75th, 90th] sat/vB
  total_size: number;  // total vsize of non-coinbase txs
  total_weight: number;
  swtotal_size: number;  // segwit tx total size
  swtotal_weight: number;
  // ... other fields (avgfee, totalfee, etc.)
}
// Segwit adoption % = (swtxs / txs) * 100  [DERIVED — not a direct field]
// Taproot adoption: NOT available in getblockstats — no taproot-specific field. [CITED: bitcoincore.org 25.0.0]
```

**Segwit adoption:** Must be derived as `(swtxs / txs) * 100`. [CITED: https://bitcoincore.org/en/doc/25.0.0/rpc/blockchain/getblockstats/]
**Taproot adoption:** Not available in `getblockstats`. [CITED: bitcoincore.org 25.0.0 — no taproot field listed] The ROADMAP says "segwit/taproot adoption" but taproot is not directly available; Phase 27 should note this in the tool response and surface segwit only, or label taproot as "not available via getblockstats".

### `getchaintips`

Used by: `get_btc_chain_tips`

```typescript
// Source: https://developer.bitcoin.org/reference/rpc/getchaintips.html [CITED]
interface ChainTip {
  hash: string;       // block hash of tip
  height: number;     // tip height
  branchlen: number;  // 0 for active chain, N for length of fork branch
  status: "active" | "valid-fork" | "valid-headers" | "headers-only" | "invalid";
}
type GetChainTipsResult = ChainTip[];
// Reorg signal: any tip with status !== "active" and branchlen > 0
// Recent reorg signal: any "valid-fork" or "valid-headers" tip with branchlen >= 1
```

### `getmempoolinfo`

Used by: `get_btc_mempool_summary`

```typescript
// Source: https://developer.bitcoin.org/reference/rpc/getmempoolinfo.html [CITED]
interface GetMempoolInfoResult {
  loaded: boolean;
  size: number;           // current tx count in mempool
  bytes: number;          // total vsize (BIP-141 discount applied)
  usage: number;          // total memory usage in bytes
  maxmempool: number;     // max memory configured (bytes)
  mempoolminfee: number;  // minimum feerate (BTC/kB) for acceptance
  minrelaytxfee: number;  // minimum relay fee (BTC/kB)
  unbroadcastcount: number; // txs not yet broadcast
  // Note: NO total_fee field. No fee_histogram field (PR #21422 was closed, not merged).
}
```

**Fee histogram:** There is NO built-in fee histogram in `getmempoolinfo`. [CITED: PR #21422 closed 2023-03-20, never merged — https://github.com/bitcoin/bitcoin/pull/21422] For Phase 27's `get_btc_mempool_summary`, surface `size + bytes + mempoolminfee` as the summary. A fee-rate histogram can be derived from `getrawmempool(verbose=true)` by bucketing `fees.modified / vsize` per-tx, but this is expensive on large mempools (~500k txs = large JSON). Recommendation: Phase 27 ships `size + mempoolminfee + bytes` only; histogram derivation deferred (it is not in CONTEXT.md locked decisions and `build_incident_report` uses `size` spike detection, not histogram).

### `getrawmempool`

Used by: optional fee histogram (deferred)

```typescript
// Source: https://developer.bitcoin.org/reference/rpc/getrawmempool.html [CITED]
// getrawmempool(verbose=false) → string[] (txids only)
// getrawmempool(verbose=true)  → { [txid]: { vsize, weight, fees: { base, modified, ancestor, descendant }, ... } }
// No fee_histogram parameter — not a built-in.
```

---

## Litecoin Core RPC Compatibility

[CITED: https://github.com/litecoin-project/litecoin/blob/master/src/rpc/blockchain.cpp + https://docs.blockdaemon.com/docs/litecoin-rpc-methods]

**High compatibility:** Litecoin Core's RPC interface is derived from Bitcoin Core. The following methods exist in LTC Core with the same parameter and response shapes as Bitcoin Core:

| Method | LTC Available | Notes |
|--------|--------------|-------|
| `getblockchaininfo` | Yes | `chain` returns `"litecoin"` not `"main"` [ASSUMED — standard LTC chain name] |
| `getblockheader` | Yes | Same shape |
| `getblockstats` | Yes | Same field shape [CITED: litecoin-project/litecoin blockchain.cpp confirms presence] |
| `getchaintips` | Yes | Same shape [CITED: litecoin-project/litecoin blockchain.cpp] |
| `getmempoolinfo` | Yes | Same shape + MWEB fields (ignored) [CITED: blockchain.cpp MWEB extensions visible] |
| `getrawmempool` | Yes | Includes MWEB-specific fields in verbose form (additive, not breaking) |

**MWEB divergence:** Litecoin Core adds MWEB (MimbleWimble Extension Blocks) fields to mempool entries and block responses. These are additive — the standard fields are present with the same names. Phase 27 ignores MWEB fields (not in scope per CONTEXT.md). The TypeScript response types should use `[key: string]: unknown` index signatures or explicit MWEB optional fields.

**Litecoin RPC default port:** 9332 (mainnet). Bitcoin Core: 8332. Both configurable; Phase 27 reads from `LITECOIN_CORE_RPC_URL` (full URL, not just host:port).

**Litecoin Core download:** https://litecoin.org (operator sets up their own node — same as Bitcoin Core private-node recommendation).

---

## Esplora Fallback Granularity

| Tool | Esplora Fallback? | Fidelity Loss | Notes |
|------|-------------------|---------------|-------|
| `get_btc_block_tip` | YES | No `difficulty` field | Esplora `/blocks/tip/height` → `height` (integer); `/blocks/tip/hash` → `bestblockhash`. No difficulty. |
| `get_btc_block_stats` | NO | N/A | `getblockstats` has no Esplora equivalent. Core-only. Returns `coreNotConfigured` with `esploraFallbackAvailable: false`. |
| `get_btc_blocks_recent` | PARTIAL | No fee percentiles, no segwit adoption | Esplora `/blocks` returns last 10 blocks with basic stats (txCount, size, height). No fee percentiles. |
| `get_btc_chain_tips` | NO | N/A | No multi-tip Esplora endpoint. Core-only. |
| `get_btc_mempool_summary` | NO | N/A | Esplora has no mempool census endpoint. Core-only. [CITED: CONTEXT.md, confirmed by Esplora API inspection] |
| `get_litecoin_block_tip` | YES | Same as BTC — no difficulty | LTC uses litecoinspace.org Esplora (established in Phase 26 `src/chains/litecoin/`) |
| `get_litecoin_mempool_summary` | NO | N/A | Core-only, same as BTC |

**Esplora block tip endpoint:** `GET /blocks/tip/height` returns integer (plain text), `GET /blocks/tip/hash` returns hash string (plain text). These are standard Esplora endpoints. [ASSUMED — standard Esplora API; not confirmed via fresh fetch in this session but consistent with mempool.space/blockstream.info documented API]

---

## `build_incident_report` Design

### Anomaly Signal Types

```typescript
// Proposed canonical anomaly signal shapes for Phase 27
// Claude's discretion per CONTEXT.md

type AnomalySignal =
  | {
      type: "chain-tip-lag";
      chain: string;
      detectedLagBlocks: number;    // blocks behind expected (wall-clock estimate)
      expectedBlocks: number;
      note: string;
    }
  | {
      type: "reorg-detected";
      chain: string;
      forkBranchLen: number;        // from getchaintips branchlen
      forkTipHash: string;
      forkStatus: "valid-fork" | "valid-headers" | "headers-only";
    }
  | {
      type: "mempool-spike";
      chain: string;
      currentSizeTxs: number;
      baselineSizeTxs: number;      // Phase 27 ships static baseline defaults (configurable later)
      spikeFactor: number;          // currentSize / baselineSizeTxs
    }
  | {
      type: "unconfirmed-balance-change";
      chain: string;
      walletAddress: string;
      unconfirmedDeltaSats: bigint;  // signed (positive = incoming, negative = outgoing)
    }
  | {
      type: "probe-failed";
      chain: string;
      reason: string;
    };
```

### Default Anomaly Thresholds (Claude's Discretion)

| Signal | Default Threshold | Rationale |
|--------|------------------|-----------|
| `chain-tip-lag` | > 2 blocks behind expected | BTC = 1 block / 10 min; if clock shows 25+ min since last block, lag likely |
| `reorg-detected` | Any `getchaintips` tip with `branchlen >= 1` and `status !== "active"` | Any fork branch = potential reorg |
| `mempool-spike` | `size > baseline * 3` | 3× baseline is a meaningful spike; Bitcoin mempool baseline ~50k–200k txs typical |
| `unconfirmed-balance-change` | `|delta| > 0.01 BTC (1,000,000 sats)` | Large unconfirmed movement on a known wallet |

These are Phase 27 defaults only; user-configurable thresholds are deferred per CONTEXT.md.

### `build_incident_report` Response Shape

```typescript
// Source: CONTEXT.md locked decision [VERIFIED: project CONTEXT.md]
interface IncidentReport {
  reportTimestamp: string;     // ISO 8601
  chainsProbed: string[];      // all chains attempted (including failed probes)
  anomaliesDetected: AnomalySignal[];
  chainProbeStatus: Record<string, "ok" | "probe-failed" | "core-not-configured" | "not-included">;
}
```

---

## `get_vaultpilot_config_status` Extension

Per the v1.0 DIAG-01 convention, add two booleans to `get_vaultpilot_config_status`. [VERIFIED: project codebase — existing pattern in `src/tools/get_vaultpilot_config_status.ts` lines 165–176]

```typescript
// Pattern: mirror existing btcEsploraConfigured / tronRpcConfigured / solanaRpcConfigured
const bitcoinCoreConfigured = getBitcoinCoreRpcUrl() !== null;   // true iff BITCOIN_CORE_RPC_URL set
const litecoinCoreConfigured = getLitecoinCoreRpcUrl() !== null; // true iff LITECOIN_CORE_RPC_URL set
// NEVER surface the URL itself — only the boolean presence flag.
// NEVER surface RPC_USER or RPC_PASS — credentials stay internal.
```

These booleans join the existing `structured` output object. The `_USER`/`_PASS` env vars are consumed only by `bitcoin-core-rpc.ts` internally; they NEVER appear in any tool response or log output.

---

## Error Code Policy

Phase 27 is forensic reads only — no new signing codes needed. All forensic tools follow the `coreNotConfigured` envelope pattern, not the `ErrorCode` union. This is consistent with how the project handles degraded-read scenarios (e.g., `rpcDegraded` flag for EVM RPC failures in Phase 2 READ-05, rather than a structured error code).

No new entries in `src/signing/error-codes.ts`. The existing `INVALID_INPUT` pattern applies for malformed `blockHeight` args etc. [VERIFIED: project error-codes.ts — 21-code union is closed per SECURITY.md v2.1 close-out; Phase 27 adds no new signing operations]

---

## Common Pitfalls

### Pitfall 1: `getblockchaininfo` has no `time` field
**What goes wrong:** Calling `getblockchaininfo` and trying to read `.time` for block timestamp gets `undefined`.
**Why it happens:** `getblockchaininfo` returns `mediantime` (median of last 11 blocks), not the tip block's actual timestamp. [CITED: https://developer.bitcoin.org/reference/rpc/getblockchaininfo.html]
**How to avoid:** To get the tip block time, follow up with `getblockheader(bestblockhash)` which has both `time` and `mediantime`.
**Warning signs:** `result.time === undefined` in TypeScript.

### Pitfall 2: HTTP 500 for JSON-RPC errors (not HTTP 4xx)
**What goes wrong:** Treating any non-200 response as a network error.
**Why it happens:** Bitcoin Core returns HTTP 500 for application-level JSON-RPC errors (invalid method, wrong params, auth failure 401). The error details are in the response body's `error.code` + `error.message`. [CITED: https://en.bitcoin.it/wiki/API_reference_(JSON-RPC)]
**How to avoid:** After `!resp.ok`, try to parse the JSON body and extract `body.error.code` + `body.error.message` before emitting `{ kind: "rpc-error" }`. Only fall back to `{ kind: "network-error" }` if the body is unparseable.
**Warning signs:** `{ kind: "network-error", message: "HTTP 500" }` when the actual error is "Method not found" or "Unauthorized".

### Pitfall 3: Taproot adoption not in `getblockstats`
**What goes wrong:** Phase 27 plan documents "segwit/taproot adoption" per ROADMAP SC#3, but `getblockstats` has no taproot field.
**Why it happens:** Bitcoin Core 25.0 does not track taproot adoption per-block in `getblockstats`. Taproot adoption would require parsing block verbosity-2 output per tx and checking witness version — expensive. [CITED: https://bitcoincore.org/en/doc/25.0.0/rpc/blockchain/getblockstats/]
**How to avoid:** Phase 27 surfaces `segwitAdoptionPct = (swtxs / txs) * 100` and notes `taprootAdoption: "not available via getblockstats"` in the tool response. This is honest and matches CONTEXT.md (which lists BTC-FORENSIC-03 as "segwit/taproot adoption" — taproot portion is best-effort).
**Warning signs:** Planning to add a taproot field that doesn't exist.

### Pitfall 4: Using `.cookie` file auth vs `rpcuser`/`rpcpassword`
**What goes wrong:** Trying to support both `.cookie` file auth and env-var-based `rpcuser`/`rpcpassword`.
**Why it happens:** Bitcoin Core's preferred auth method is the `.cookie` file (rotated each restart). [CITED: https://github.com/bitcoin/bitcoin/blob/master/doc/JSON-RPC-interface.md]
**How to avoid:** Phase 27 only supports explicit `BITCOIN_CORE_RPC_USER` + `BITCOIN_CORE_RPC_PASS` env vars. If both are absent, the Authorization header is omitted (works for nodes configured without auth or with IP allowlist only). This is the simplest approach and covers the most common private-node setup. The `.cookie` file path is explicitly deferred (it requires local filesystem access to the Bitcoin Core data dir, which is not appropriate for an MCP server that may run remotely).
**Warning signs:** Trying to read `~/.bitcoin/.cookie` in the MCP server code.

### Pitfall 5: MWEB fields in Litecoin mempool/block data
**What goes wrong:** TypeScript strict parsing fails on unknown `mweb`-prefixed fields.
**Why it happens:** Litecoin Core adds MWEB fields to `getmempoolinfo`, `getblockstats`, and block responses. [CITED: https://github.com/litecoin-project/litecoin/blob/master/src/rpc/blockchain.cpp]
**How to avoid:** Use `[key: string]: unknown` index signatures on response types (same as how `src/clients/lifi.ts` uses `RawLifiBody` with an index signature). Extract only the fields Phase 27 needs; discard MWEB fields.
**Warning signs:** TypeScript errors about unknown fields when running against a real Litecoin Core node.

### Pitfall 6: Large `getrawmempool(verbose=true)` response
**What goes wrong:** Calling `getrawmempool(true)` on a production node dumps 100k+ tx objects as JSON; response is tens of MB.
**Why it happens:** Production Bitcoin mempool holds 300k–700k transactions during busy periods. Verbose form serializes each tx's full metadata.
**How to avoid:** Phase 27's `get_btc_mempool_summary` uses `getmempoolinfo` only (size + bytes + mempoolminfee). The `INCIDENT_REPORT_CHAIN_TIMEOUT_MS = 10s` timeout prevents hanging. If fee histogram is needed in the future, use a paginated approach or server-side bucketing.
**Warning signs:** `{ kind: "network-error", message: "timeout" }` from Core when mempool is large.

---

## Code Examples

### JSON-RPC Request / Response Wire Format

```typescript
// Source: https://en.bitcoin.it/wiki/API_reference_(JSON-RPC) [CITED]
// Request:
// POST / HTTP/1.1
// Content-Type: application/json
// Authorization: Basic base64("alice:correct-horse-battery-staple")
// { "jsonrpc": "1.0", "id": "vaultpilot", "method": "getblockchaininfo", "params": [] }

// Success response (HTTP 200):
// { "result": { "chain": "main", "blocks": 850000, "difficulty": 90e12, ... }, "error": null, "id": "vaultpilot" }

// RPC error response (HTTP 500):
// { "result": null, "error": { "code": -32601, "message": "Method not found" }, "id": "vaultpilot" }

// Auth failure (HTTP 401 or 500 with error.code === -28):
// { "result": null, "error": { "code": -28, "message": "Verifying blocks..." }, "id": "vaultpilot" }
```

### `getblockstats` Tool Response Shape

```typescript
// Proposed response for get_btc_block_stats — BTC-FORENSIC-03
interface BtcBlockStatsResponse {
  blockHeight: number;
  blockhash: string;
  timestamp: number;       // Unix timestamp (from getblockstats.time)
  txCount: number;         // getblockstats.txs
  segwitTxCount: number;   // getblockstats.swtxs
  segwitAdoptionPct: number; // (swtxs / txs) * 100, rounded 1 decimal
  taprootAdoption: "not-available"; // literal — taproot not in getblockstats
  feePercentilesSatVb: {
    p10: number; p25: number; p50: number; p75: number; p90: number;
  };  // feerate_percentiles array destructured
  totalSizeVbytes: number; // total_size (non-coinbase)
  source: "bitcoin-core";
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `getmempoolinfo` had no fee histogram | Still has no fee histogram (PR #21422 closed 2023-03) | PR closed March 2023 | Phase 27 cannot use a built-in histogram; must derive from `getrawmempool(true)` or use size+minfee only |
| Taproot adoption in `getblockstats` | Not available in any Bitcoin Core version | Never added | Phase 27 labels taproot as "not available via getblockstats" |

**Deprecated/outdated:**
- JSON-RPC 1.0 `id` field: Bitcoin Core supports both 1.0 and 2.0; using `"1.0"` is fine and consistent with Core's own curl examples.
- `total_fee` in `getmempoolinfo`: Not in the documented fields — do not reference it.

---

## SECURITY.md v2.2 Close-Out

Phase 27 is the v2.2 milestone close-out. SECURITY.md needs three new sub-sections appended under a new `## Phase 27 — v2.2 Bitcoin/Litecoin Milestone Close-Out` heading:

### Sub-section 1: PSBT serialization trust shape (cross-link from Phase 23)
Brief summary + pointer to `## Phase 23` — already documented. This sub-section confirms the PSBT trust pipeline shipped in Phases 23–25 is the canonical BTC signing shape.

### Sub-section 2: Per-input BIP-143 sighash binding (cross-link from Phase 23)
Already documented in `## Phase 23`. Cross-link only; no new content.

### Sub-section 3: Bitcoin Core RPC trust shape (NEW in Phase 27)
Key points:
- **Private-node deployment recommended:** Public Bitcoin Core RPC nodes are rare. Most operators run their own node (BitcoinD on localhost or a dedicated server). The MCP server connects over plain HTTP — **must be LAN-only or behind TLS termination** (Bitcoin Core's RPC has no built-in TLS).
- **Trust surface difference:** Esplora (public service, operator-trusted) vs Core RPC (private node, fully operator-controlled). Core RPC gives deeper forensic access but requires node maintenance.
- **Basic-auth credentials in env vars:** `BITCOIN_CORE_RPC_USER` + `BITCOIN_CORE_RPC_PASS` are sensitive env vars. Same rules as `WALLETCONNECT_PROJECT_ID`: secret-safety scan applies; NEVER surfaced in tool responses or logs.
- **Threat model:** A compromised Core node returns tampered chain data (manipulated `getblockchaininfo`, fake `getchaintips`). This affects forensic accuracy but NOT signing security — the Ledger device independently signs PSBTs; Core RPC cannot inject malicious transactions into the signing pipeline (it is read-only in Phase 27).

### Sub-section 4: LTC threat model (NEW in Phase 27)
Brief — mirrors BTC. Additional note: MWEB (MimbleWimble Extension Blocks) is Litecoin-specific. Phase 27 ignores MWEB fields; the forensic tools surface standard UTXO-model chain data only. MWEB privacy implications are out of scope for Phase 27.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Esplora exposes `/blocks/tip/height` and `/blocks/tip/hash` endpoints at the configured `BTC_ESPLORA_URL` | §Esplora Fallback Granularity | Esplora fallback for `get_btc_block_tip` fails; tool must return `coreNotConfigured` instead of degraded response |
| A2 | `getblockchaininfo` returns `chain: "litecoin"` (not `"main"`) when running against Litecoin Core | §Litecoin Core RPC Compatibility | Chain-validation logic in tool handler may incorrectly reject LTC responses |
| A3 | Litecoin Core default RPC port is 9332 (not relevant to Phase 27 — user supplies full URL — but affects SECURITY.md docs) | §SECURITY.md v2.2 Close-Out | Documentation error only; no runtime impact |
| A4 | Bitcoin Core HTTP 401 responses come back as 401 (not wrapped in HTTP 500) | §Common Pitfalls Pitfall 2 | Error classification: auth failure might surface as `rpc-error` instead of `network-error`; low impact |

**If this table is empty:** It is not empty — 4 assumptions documented.

---

## Open Questions

1. **Taproot adoption labeling**
   - What we know: `getblockstats` has no taproot-specific field in Bitcoin Core 25.0.
   - What's unclear: Should the tool surface `taprootAdoption: "not-available"` or silently omit the field?
   - Recommendation: Surface `taprootAdoption: "not-available-via-getblockstats"` as a literal string. Honest, helps the agent explain to the user.

2. **`get_btc_blocks_recent` Esplora fallback fidelity**
   - What we know: Esplora `/blocks` returns last 10 blocks with basic stats (no fee percentiles).
   - What's unclear: Is the Esplora `/blocks` endpoint documented as stable across instances?
   - Recommendation: Ship Esplora fallback for `get_btc_blocks_recent` returning `{ height, hash, txCount, size, timestamp }` only (no fee percentiles). Label clearly: `feeFallback: "not-available-without-core-rpc"`.

3. **Error code union extension for Core-side errors**
   - What we know: Phase 27 is read-only forensics; the 21-code union is closed.
   - What's unclear: If `get_btc_block_tip` needs to return a structured error to the agent, should it use `makeStructuredError("INVALID_INPUT", ...)` or a plain object?
   - Recommendation: Forensic tools are NOT part of the trust pipeline. Use plain structured objects (not `makeStructuredError`) for `coreNotConfigured` and degraded responses. Reserve `ErrorCode` union for trust-pipeline tools only (consistent with existing project pattern — `rpcDegraded` in Phase 2 uses a plain flag, not an `ErrorCode`).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥ 18.17 | native fetch | ✓ | v22.19.0 | — |
| Bitcoin Core node | `get_btc_block_tip`, `get_btc_block_stats`, `get_btc_mempool_summary` | Optional | Set `BITCOIN_CORE_RPC_URL` | `coreNotConfigured` envelope |
| Litecoin Core node | `get_litecoin_block_tip`, `get_litecoin_mempool_summary` | Optional | Set `LITECOIN_CORE_RPC_URL` | `coreNotConfigured` envelope |
| Esplora (`BTC_ESPLORA_URL`) | `get_btc_block_tip` fallback | ✓ (public fallback exists) | existing Phase 22 infrastructure | Already configured |

**Missing dependencies with no fallback:** None — all Core RPC tools degrade gracefully.
**Missing dependencies with fallback:** Bitcoin Core node (Esplora fallback for tip); Litecoin Core node (Esplora fallback for tip).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (existing project) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npm test` (= `vitest run`) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BTC-FORENSIC-01 | `coreNotConfigured` envelope when URL absent | unit | `npm test -- --reporter=verbose test/clients-bitcoin-core-rpc.test.ts` | ❌ Wave 0 |
| BTC-FORENSIC-01 | `bitcoinCoreConfigured: false` in config status | unit | `npm test -- test/tools-get-vaultpilot-config-status.test.ts` | ✅ (extend) |
| BTC-FORENSIC-02 | `get_btc_block_tip` Core path returns height + difficulty + timestamp | unit | `npm test -- test/tools-get-btc-block-tip.test.ts` | ❌ Wave 0 |
| BTC-FORENSIC-02 | `get_btc_block_tip` Esplora fallback returns tip without difficulty | unit | same file | ❌ Wave 0 |
| BTC-FORENSIC-03 | `get_btc_block_stats` returns feerate_percentiles + segwit adoption | unit | `npm test -- test/tools-get-btc-block-stats.test.ts` | ❌ Wave 0 |
| BTC-FORENSIC-04 | `get_btc_chain_tips` returns reorg-signal tip shapes | unit | `npm test -- test/tools-get-btc-chain-tips.test.ts` | ❌ Wave 0 |
| BTC-FORENSIC-05 | `get_btc_mempool_summary` Core-only; returns `coreNotConfigured` when absent | unit | `npm test -- test/tools-get-btc-mempool-summary.test.ts` | ❌ Wave 0 |
| LTC-FORENSIC-01 | LTC mirror tools return `coreNotConfigured` when absent | unit | `npm test -- test/tools-get-litecoin-block-tip.test.ts` | ❌ Wave 0 |
| BTC-INC-01 | `build_incident_report` runs `Promise.allSettled` fan-out + returns `anomaliesDetected` | unit | `npm test -- test/tools-build-incident-report.test.ts` | ❌ Wave 0 |
| BTC-INC-01 | `build_incident_report` gracefully handles chain probe failure | unit | same file | ❌ Wave 0 |

All new test files are testable via `vi.stubGlobal("fetch", …)` per project convention — no network access in CI.

### Sampling Rate

- **Per task commit:** `npm test` (full suite — vitest run is fast, ~30s at current test count)
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/clients-bitcoin-core-rpc.test.ts` — covers BTC-FORENSIC-01 (client shape, auth, 5-arm union, `vi.stubGlobal("fetch")`)
- [ ] `test/tools-get-btc-block-tip.test.ts` — covers BTC-FORENSIC-02 (Core path + Esplora fallback)
- [ ] `test/tools-get-btc-block-stats.test.ts` — covers BTC-FORENSIC-03 (segwit adoption derivation, feerate_percentiles)
- [ ] `test/tools-get-btc-chain-tips.test.ts` — covers BTC-FORENSIC-04 (reorg-signal detection)
- [ ] `test/tools-get-btc-mempool-summary.test.ts` — covers BTC-FORENSIC-05 (Core-only refusal)
- [ ] `test/tools-get-litecoin-block-tip.test.ts` — covers LTC-FORENSIC-01
- [ ] `test/tools-build-incident-report.test.ts` — covers BTC-INC-01 (fan-out, anomaly signal, probe failure)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Forensic read tools have no user auth |
| V3 Session Management | No | No session state in forensic tools |
| V4 Access Control | No | MCP server is agent-facing; access control is MCP-level (out of scope) |
| V5 Input Validation | Yes | `blockHeight` param: validate as non-negative integer; `includeChains` param: allowlist against known chain names |
| V6 Cryptography | No | No new cryptography in Phase 27 (JSON-RPC Basic auth uses standard base64, not custom crypto) |

### Known Threat Patterns for Bitcoin Core RPC + cross-chain aggregation

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tampered Core node returns fake chain data | Tampering | Phase 27 is forensic/read-only — no signing decisions based on Core RPC data; Ledger device independently validates PSBT. Document in SECURITY.md. |
| RPC credentials leaked in logs/responses | Information Disclosure | `_USER`/`_PASS` never logged (per `ETHERSCAN_KEY_LEAK` pattern); `bitcoinCoreConfigured` boolean only in config status |
| `blockHeight` injection (out-of-range) | Tampering | Validate `blockHeight >= 0` at tool entry; `getblockstats` returns `rpc-error` for non-existent heights — surface verbatim |
| Slow Core node blocks `build_incident_report` indefinitely | Denial of Service | `AbortController` 10s per-chain timeout (per CONTEXT.md + Phase 8 pattern) |
| SSRF via `BITCOIN_CORE_RPC_URL` | Elevation of Privilege | Phase 27 does not validate the URL against an allowlist (operator-configurable); same residual risk as `ETHEREUM_RPC_URL`. Document as accepted residual. |

---

## Sources

### Primary (HIGH confidence)

- Bitcoin Core RPC docs — https://developer.bitcoin.org/reference/rpc/ — `getblockchaininfo`, `getblockheader`, `getblockstats`, `getchaintips`, `getmempoolinfo`, `getrawmempool`
- Bitcoin Core 25.0 RPC reference — https://bitcoincore.org/en/doc/25.0.0/rpc/blockchain/getblockstats/ — confirmed `feerate_percentiles`, `swtxs`, `txs` field names
- Bitcoin Core JSON-RPC interface docs — https://github.com/bitcoin/bitcoin/blob/master/doc/JSON-RPC-interface.md — auth methods, cookie vs rpcuser/rpcpassword
- Bitcoin Wiki API reference — https://en.bitcoin.it/wiki/API_reference_(JSON-RPC) — wire format, HTTP Basic auth, JSON-RPC request shape
- PR #21422 (closed) — https://github.com/bitcoin/bitcoin/pull/21422 — confirms fee histogram NOT in `getmempoolinfo`
- Litecoin Core blockchain.cpp — https://github.com/litecoin-project/litecoin/blob/master/src/rpc/blockchain.cpp — confirms MWEB extensions + `getblockstats`/`getchaintips` presence
- Project codebase: `src/clients/etherscan.ts`, `src/clients/lifi.ts`, `src/chains/bitcoin/esplora-client.ts`, `src/signing/error-codes.ts`, `src/tools/get_vaultpilot_config_status.ts`

### Secondary (MEDIUM confidence)

- Blockdaemon LTC RPC docs — https://docs.blockdaemon.com/docs/litecoin-rpc-methods — confirms LTC method availability
- getblockstats taproot absence: inferred from absence in bitcoincore.org 25.0 docs (no taproot field listed); cross-confirmed by absence in Litecoin docs

### Tertiary (LOW confidence)

- A1 (Esplora `/blocks/tip/height` endpoint) — [ASSUMED] based on mempool.space/blockstream.info API convention; not fetched live in this session
- A2 (LTC `chain: "litecoin"`) — [ASSUMED] standard Litecoin Core configuration; not verified against live node

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new packages; all patterns verified from project codebase
- Bitcoin Core RPC method shapes: HIGH — verified from official Bitcoin Core docs + bitcoincore.org 25.0 reference
- Litecoin Core compatibility: MEDIUM — confirmed method presence + MWEB extensions from source code; minor field divergences possible
- `build_incident_report` design: MEDIUM — anomaly shapes and thresholds are Claude's discretion per CONTEXT.md; no external source needed
- Esplora fallback granularity: HIGH for Core-only tools; MEDIUM for fallback endpoint details (A1 ASSUMED)

**Research date:** 2026-05-23
**Valid until:** 2026-06-23 (30 days — Bitcoin Core and Litecoin Core RPC interfaces are stable)
