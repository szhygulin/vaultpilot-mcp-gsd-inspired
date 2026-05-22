# Phase 27: Bitcoin/Litecoin Core RPC + `build_incident_report` + Diagnostics — Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 12 new/modified files
**Analogs found:** 11 / 12 (SECURITY.md has no analog — append-only doc)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/clients/bitcoin-core-rpc.ts` | client | request-response | `src/clients/lifi.ts` | exact |
| `src/config/bitcoin-core-env.ts` | config | — | `src/config/env.ts` | exact |
| `src/tools/get_btc_block_tip.ts` | tool/handler | request-response | `src/chains/bitcoin/esplora-client.ts` + `src/tools/get_vaultpilot_config_status.ts` | role-match |
| `src/tools/get_btc_block_stats.ts` | tool/handler | request-response | `src/tools/get_btc_block_tip.ts` (sibling) | role-match |
| `src/tools/get_btc_blocks_recent.ts` | tool/handler | request-response | `src/tools/get_btc_block_tip.ts` (sibling) | role-match |
| `src/tools/get_btc_chain_tips.ts` | tool/handler | request-response | `src/tools/get_btc_block_tip.ts` (sibling) | role-match |
| `src/tools/get_btc_mempool_summary.ts` | tool/handler | request-response | `src/tools/get_btc_block_tip.ts` (sibling) | role-match |
| `src/tools/get_litecoin_block_tip.ts` | tool/handler | request-response | `src/tools/get_btc_block_tip.ts` (sibling, parameterized) | exact |
| `src/tools/get_litecoin_mempool_summary.ts` | tool/handler | request-response | `src/tools/get_btc_mempool_summary.ts` (sibling) | exact |
| `src/tools/build_incident_report.ts` | tool/handler | fan-out / aggregation | `src/tools/get_portfolio_summary.ts` | role-match |
| `src/tools/get_vaultpilot_config_status.ts` | tool/handler (extend) | request-response | self | exact |
| `SECURITY.md` | documentation | — | none (append-only) | no analog |

---

## Pattern Assignments

### `src/clients/bitcoin-core-rpc.ts` (client, request-response)

**Primary analog:** `src/clients/lifi.ts` (lines 1–243)
**Secondary analog:** `src/clients/etherscan.ts` (lines 1–384) — for 5-arm union + `not-configured` arm

**Key difference from LiFi:** Bitcoin Core uses HTTP POST + JSON-RPC body + `Authorization: Basic` header instead of GET + query params. `lifi.ts` is the structural template (newest NEVER-throws shape, `vi.stubGlobal` test seam, no internal `_client` indirection); `etherscan.ts` shows the HTTP-500-as-RPC-error pattern and `AbortController` timeout placement.

**Imports pattern** (`src/clients/lifi.ts` lines 36–36):
```typescript
import { log } from "../diagnostics/logger.js";
```

**Discriminated union type** (`src/clients/lifi.ts` lines 82–86 — adapted for BTC):
```typescript
export type BitcoinCoreRpcResult<T> =
  | { kind: "not-configured" }
  | { kind: "ok"; result: T }
  | { kind: "rpc-error"; code: number; message: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "network-error"; message: string };
```
Note: `not-configured` replaces `not-found`; `rpc-error` (with code) replaces generic `error`. The 5-arm shape explicitly separates RPC-level errors (HTTP 500 with JSON body) from transport failures.

**Core client function structure** (`src/clients/lifi.ts` lines 183–243):
```typescript
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

  // Build Basic auth header only when both creds present
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
      // Bitcoin Core uses HTTP 500 for RPC-level errors (wrong method, wrong params).
      // Parse the JSON body to extract rpc-error code/message before falling back.
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
        result = { kind: "rpc-error", code: body.error.code ?? -1, message: body.error.message ?? "unknown RPC error" };
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
    clearTimeout(timer); // mirror: lifi.ts line 240, etherscan.ts line 349
  }
  return result;
}
```

**Test seam** (`src/clients/lifi.ts` lines 16–23 comment + `src/chains/bitcoin/esplora-client.ts` lines 11–16):
```typescript
// Test seam: vi.stubGlobal("fetch", …) at the OUTER network boundary.
// Do NOT add a _bitcoinCoreRpcClient indirection — that convention applies to
// modules whose internal exports call each other, not to external HTTP clients.
// Per CLAUDE.md: "For external network clients … prefer vi.stubGlobal('fetch', …)".
```

**No-cache policy:** Bitcoin Core RPC is forensic read-only, live data. No module-scope cache. Contrast with `etherscan.ts` (lines 89–94) which caches — Core RPC forensic data must be fresh.

---

### `src/config/bitcoin-core-env.ts` (config, —)

**Analog:** `src/config/env.ts` (lines 79–126 — `getSolanaRpcUrl`, `getTronRpcUrl`, `getBtcEsploraUrl` readers)

**Imports pattern** (`src/config/env.ts` lines 26–30):
```typescript
import { log } from "../diagnostics/logger.js";
```
(Not needed for simple env readers — but import `log` if any warn-on-fallback logic is added.)

**Core env-reader pattern** (`src/config/env.ts` lines 79–126):
```typescript
// Copy exactly: read() helper returns undefined for empty/missing.
// Normalize to null at the public boundary (string | null, not string | undefined).

function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

// Phase 27 — Bitcoin Core RPC URL + credentials.
// NEVER surface credentials in responses or logs (T-CORE-CRED-LEAK mitigation).
export function getBitcoinCoreRpcUrl(): string | null {
  return read("BITCOIN_CORE_RPC_URL") ?? null;
}

export function getBitcoinCoreRpcUser(): string | undefined {
  return read("BITCOIN_CORE_RPC_USER");
}

export function getBitcoinCoreRpcPass(): string | undefined {
  return read("BITCOIN_CORE_RPC_PASS");
}

// Phase 27 — Litecoin Core RPC URL + credentials. Mirror of BTC.
export function getLitecoinCoreRpcUrl(): string | null {
  return read("LITECOIN_CORE_RPC_URL") ?? null;
}

export function getLitecoinCoreRpcUser(): string | undefined {
  return read("LITECOIN_CORE_RPC_USER");
}

export function getLitecoinCoreRpcPass(): string | undefined {
  return read("LITECOIN_CORE_RPC_PASS");
}
```

**Security constraint** (`src/config/env.ts` comment + CLAUDE.md): credentials (`_USER`/`_PASS`) are consumed only by `bitcoin-core-rpc.ts` internally; they NEVER appear in tool responses or log output. Same rule as `ETHERSCAN_API_KEY` (`etherscan.ts` line 33: `// The API key is NEVER logged`).

---

### `src/tools/get_btc_block_tip.ts` (tool/handler, request-response)

**Analogs:**
- `src/tools/get_vaultpilot_config_status.ts` (lines 107–270) — for `registerTool` call structure and boolean-only config surfacing
- `src/chains/bitcoin/esplora-client.ts` (lines 1–48, 253–345) — for Esplora fallback pattern using `_bitcoinRegistry.getEsploraBaseUrl()`
- `src/clients/lifi.ts` (lines 183–243) — for NEVER-throws discriminated union result handling

**Tool registration pattern** (`src/tools/get_vaultpilot_config_status.ts` lines 107–111):
```typescript
registerTool(
  "get_btc_block_tip",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (_args) => {
```

**`coreNotConfigured` envelope + Esplora fallback** (CONTEXT.md locked pattern):
```typescript
const coreUrl = getBitcoinCoreRpcUrl();
if (coreUrl === null) {
  // Esplora fallback — tip height + hash, no difficulty.
  // Use _bitcoinRegistry.getEsploraBaseUrl() + "/blocks/tip/height"
  // (standard Esplora endpoint — RESEARCH §Esplora Fallback Granularity A1).
  const tipHeightRes = await fetch(`${_bitcoinRegistry.getEsploraBaseUrl()}/blocks/tip/height`);
  // ... handle fetch result ...
  return {
    content: [{ type: "text", text: ... }],
    structuredContent: {
      status: "core-not-configured",
      message: "Set BITCOIN_CORE_RPC_URL to enable forensic reads (difficulty unavailable)",
      esploraFallbackAvailable: true,
      tip: { height: <from_esplora>, hash: null, difficulty: null, timestamp: null },
    },
  };
}
```

**Core path — two-call sequence** (RESEARCH §getblockchaininfo note):
```typescript
// getblockchaininfo has NO .time field — must call getblockheader(bestblockhash) for timestamp.
const infoResult = await callBitcoinCoreRpc<GetBlockchainInfoResult>(
  coreUrl, getBitcoinCoreRpcUser(), getBitcoinCoreRpcPass(),
  "getblockchaininfo", []
);
if (infoResult.kind !== "ok") {
  return { structuredContent: { status: infoResult.kind, message: infoResult.message ?? "" } };
}
const headerResult = await callBitcoinCoreRpc<GetBlockHeaderResult>(
  coreUrl, getBitcoinCoreRpcUser(), getBitcoinCoreRpcPass(),
  "getblockheader", [infoResult.result.bestblockhash]
);
// Pattern-match all 5 union arms; never throw.
```

**Structured result return** (`src/tools/get_vaultpilot_config_status.ts` lines 265–269):
```typescript
return {
  content: [{ type: "text", text: lines.join("\n") }],
  structuredContent: structured,
};
```

---

### `src/tools/get_btc_block_stats.ts` (tool/handler, request-response)

**Analog:** `src/tools/get_btc_block_tip.ts` (sibling — same Core RPC pattern, Core-only, no Esplora fallback)

**Input validation pattern** (RESEARCH §Error Code Policy — use plain structured objects, not `makeStructuredError`, for forensic tools):
```typescript
const blockHeight = args.blockHeight;
if (typeof blockHeight !== "number" || !Number.isInteger(blockHeight) || blockHeight < 0) {
  return { structuredContent: { status: "invalid-input", message: "blockHeight must be a non-negative integer" } };
}
```

**Core RPC call** (`getblockstats` with `coreUrl` guard same as `get_btc_block_tip.ts`):
```typescript
const statsResult = await callBitcoinCoreRpc<GetBlockStatsResult>(
  coreUrl, getBitcoinCoreRpcUser(), getBitcoinCoreRpcPass(),
  "getblockstats", [blockHeight]
);
```

**Segwit adoption derivation** (RESEARCH §getblockstats):
```typescript
// segwitAdoptionPct = (swtxs / txs) * 100 — must derive, NOT a direct field.
const segwitAdoptionPct = statsResult.result.txs > 0
  ? Math.round((statsResult.result.swtxs / statsResult.result.txs) * 1000) / 10
  : 0;
// taprootAdoption: NOT in getblockstats — surface as literal string.
const taprootAdoption = "not-available-via-getblockstats" as const;
```

---

### `src/tools/get_btc_blocks_recent.ts` (tool/handler, request-response)

**Analog:** `src/tools/get_btc_block_tip.ts` (sibling — partial Esplora fallback for basic block list)

**Esplora fallback note** (RESEARCH §Esplora Fallback Granularity): Esplora `/blocks` returns last 10 blocks with `{ height, hash, txCount, size, timestamp }`. No fee percentiles without Core. Surface `feeFallback: "not-available-without-core-rpc"` on degraded path.

---

### `src/tools/get_btc_chain_tips.ts` (tool/handler, request-response)

**Analog:** `src/tools/get_btc_mempool_summary.ts` (sibling — Core-only, clean `coreNotConfigured` refusal, no Esplora fallback)

**Core-only `coreNotConfigured` pattern** (CONTEXT.md locked):
```typescript
if (coreUrl === null) {
  return {
    structuredContent: {
      status: "core-not-configured",
      message: "Set BITCOIN_CORE_RPC_URL to enable chain-tip forensics (Esplora has no multi-tip endpoint)",
      esploraFallbackAvailable: false,
    },
  };
}
```

**Reorg signal derivation** (RESEARCH §getchaintips):
```typescript
// Reorg signal: any tip with status !== "active" and branchlen >= 1
const reorgSignals = tips.filter(t => t.status !== "active" && t.branchlen >= 1);
```

---

### `src/tools/get_btc_mempool_summary.ts` (tool/handler, request-response)

**Analog:** `src/tools/get_btc_chain_tips.ts` (sibling — Core-only, no Esplora fallback)

**Core-only refusal** (CONTEXT.md locked):
```typescript
if (coreUrl === null) {
  return {
    structuredContent: {
      status: "core-not-configured",
      message: "Set BITCOIN_CORE_RPC_URL to enable mempool forensics (Esplora does not expose full mempool)",
      esploraFallbackAvailable: false,
    },
  };
}
```

**`getmempoolinfo` result shape** (RESEARCH §getmempoolinfo — no fee histogram, ships size+bytes+mempoolminfee only):
```typescript
// Surface size + bytes + mempoolminfee ONLY.
// Fee histogram is out of scope (CONTEXT.md deferred + getrawmempool(verbose=true) is expensive).
// build_incident_report uses size spike detection, not histogram.
```

---

### `src/tools/get_litecoin_block_tip.ts` + `src/tools/get_litecoin_mempool_summary.ts` (tool/handler, request-response)

**Analogs:** `src/tools/get_btc_block_tip.ts` and `src/tools/get_btc_mempool_summary.ts` (exact mirrors, parameterized on LTC URL/creds)

**Parameterization:** Replace all `getBitcoinCoreRpcUrl()` / `getBitcoinCoreRpcUser()` / `getBitcoinCoreRpcPass()` calls with `getLitecoinCoreRpcUrl()` / `getLitecoinCoreRpcUser()` / `getLitecoinCoreRpcPass()`. The underlying `callBitcoinCoreRpc<T>` function is chain-agnostic (parameterized by URL + credentials), so LTC tools reuse it directly.

**MWEB index signature** (RESEARCH §Litecoin Core RPC Compatibility Pitfall 5):
```typescript
// LTC Core adds MWEB fields to getmempoolinfo / getblockstats responses.
// Use index signatures to avoid TypeScript strict-mode errors on unknown fields.
interface LtcGetMempoolInfoResult {
  size: number;
  bytes: number;
  mempoolminfee: number;
  // ... other standard fields
  [key: string]: unknown; // absorbs MWEB-specific fields
}
```

**LTC Esplora fallback:** Uses `_litecoinRegistry.getEsploraBaseUrl()` (Phase 26 litecoin registry, same pattern as `_bitcoinRegistry` in `src/chains/bitcoin/esplora-client.ts` line 273).

---

### `src/tools/build_incident_report.ts` (tool/handler, fan-out / aggregation)

**Analog:** `src/tools/get_portfolio_summary.ts` (lines 346–421 — `Promise.allSettled` fan-out + `AbortController` timeout + `chainErrors` collection)

**Imports pattern** (`src/tools/get_portfolio_summary.ts` lines 1–38):
```typescript
import { registerTool } from "./index.js";
import { getBitcoinCoreRpcUrl, ... } from "../config/bitcoin-core-env.js";
import { callBitcoinCoreRpc } from "../clients/bitcoin-core-rpc.js";
import { log } from "../diagnostics/logger.js";
```

**`Promise.allSettled` fan-out with per-chain timeout** (`src/tools/get_portfolio_summary.ts` lines 346–421 and 438–457):
```typescript
const INCIDENT_REPORT_CHAIN_TIMEOUT_MS = 10_000; // mirror PER_CHAIN_TIMEOUT_MS

// Build probe list based on params.includeChains (or default: all configured chains)
const probes = buildProbeList(params);

const results = await Promise.allSettled(
  probes.map((probe) => runProbeWithTimeout(probe, INCIDENT_REPORT_CHAIN_TIMEOUT_MS))
);

const chainsProbed: string[] = probes.map(p => p.chain);
const anomaliesDetected: AnomalySignal[] = [];
const chainProbeStatus: Record<string, string> = {};

for (let i = 0; i < results.length; i++) {
  const probe = probes[i]!;
  const r = results[i]!;
  if (r.status === "fulfilled") {
    anomaliesDetected.push(...r.value.anomalies);
    chainProbeStatus[probe.chain] = r.value.status;
  } else {
    const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
    anomaliesDetected.push({ type: "probe-failed", chain: probe.chain, reason });
    chainProbeStatus[probe.chain] = "probe-failed";
  }
}
```

**Per-probe timeout wrapper** (`src/tools/get_portfolio_summary.ts` lines 438–457 — `Promise.race` + `AbortController`):
```typescript
async function runProbeWithTimeout<T>(probe: Probe, timeoutMs: number): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    return await Promise.race<T>([
      probe.run(),
      new Promise<T>((_, reject) => {
        abort.signal.addEventListener("abort", () => {
          reject(new Error(`timeout after ${timeoutMs}ms`));
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
```

**Response shape** (CONTEXT.md locked decision):
```typescript
interface IncidentReport {
  reportTimestamp: string;         // ISO 8601 — new Date().toISOString()
  chainsProbed: string[];
  anomaliesDetected: AnomalySignal[];
  chainProbeStatus: Record<string, "ok" | "probe-failed" | "core-not-configured" | "not-included">;
}
```

**Anomaly signal types** (RESEARCH §build_incident_report Design — Claude's discretion):
```typescript
type AnomalySignal =
  | { type: "chain-tip-lag"; chain: string; detectedLagBlocks: number; expectedBlocks: number; note: string }
  | { type: "reorg-detected"; chain: string; forkBranchLen: number; forkTipHash: string; forkStatus: string }
  | { type: "mempool-spike"; chain: string; currentSizeTxs: number; baselineSizeTxs: number; spikeFactor: number }
  | { type: "probe-failed"; chain: string; reason: string };
```

---

### `src/tools/get_vaultpilot_config_status.ts` — EXTEND (tool/handler)

**Analog:** self (lines 165–176 — existing `btcEsploraConfigured`, `tronRpcConfigured` pattern)

**New boolean additions** (mirror `btcEsploraConfigured` at `src/tools/get_vaultpilot_config_status.ts` lines 173–176):
```typescript
// Add after btcEsploraConfigured (line 176):
// Phase 27 Plan 27-01 — Bitcoin Core RPC configured boolean. Same semantics
// as btcEsploraConfigured: TRUE iff BITCOIN_CORE_RPC_URL is explicitly set.
// NEVER surface URL or credentials — only boolean presence.
const bitcoinCoreConfigured = getBitcoinCoreRpcUrl() !== null;
const litecoinCoreConfigured = getLitecoinCoreRpcUrl() !== null;
```

**Add to `structured` object** (lines 202–227):
```typescript
bitcoinCoreConfigured,
litecoinCoreConfigured,
```

**Add to `lines` text block** (lines 231–264, after `btcEsploraConfigured` line 245):
```typescript
lines.push(`  bitcoinCoreConfigured:           ${bitcoinCoreConfigured}`);
lines.push(`  litecoinCoreConfigured:          ${litecoinCoreConfigured}`);
```

**Secret-safety constraint** (CLAUDE.md + `src/tools/get_vaultpilot_config_status.ts` line 6): `BITCOIN_CORE_RPC_USER` and `BITCOIN_CORE_RPC_PASS` NEVER appear in the response. Boolean only.

---

### `SECURITY.md` (documentation, append-only)

**No analog.** Append a new `## Phase 27 — v2.2 Bitcoin/Litecoin Milestone Close-Out` section.

**Append location:** After the last existing phase section (currently ends at line 439). Read the end of the file before appending to match existing section heading style.

**Existing heading style** (`SECURITY.md` line 380): `## Phase 23 — Bitcoin (BTC) Native SegWit + Taproot Trust Pipeline`

**Required subsections** (RESEARCH §SECURITY.md v2.2 Close-Out):
1. PSBT serialization trust shape cross-link (points to Phase 23 section — no new content)
2. Per-input BIP-143 sighash binding cross-link (points to Phase 23 section)
3. Bitcoin Core RPC trust shape (NEW — private-node recommendation, LAN-only TLS note, credentials as env vars, tampered-node threat model)
4. LTC threat model (NEW — mirrors BTC, notes MWEB is ignored)

---

## Shared Patterns

### NEVER-throws Discriminated Union HTTP Client
**Source:** `src/clients/lifi.ts` lines 82–243
**Apply to:** `src/clients/bitcoin-core-rpc.ts`
```typescript
// Pattern: declare `let result: XResult;` before try/catch,
// assign in every branch, NEVER return inside try (except for early-exit JSON parse errors),
// ALWAYS clearTimeout(timer) in finally.
let result: BitcoinCoreRpcResult<T>;
try {
  // ... fetch + branch assignments
} catch (err) {
  const e = err as Error;
  if (e?.name === "AbortError") {
    result = { kind: "network-error", message: `... timeout` };
  } else {
    result = { kind: "network-error", message: `... unreachable: ${e?.message ?? String(err)}` };
  }
} finally {
  clearTimeout(timer);
}
return result;
```

### `vi.stubGlobal("fetch")` Test Seam
**Source:** `src/clients/lifi.ts` lines 16–23 comment; `src/chains/bitcoin/esplora-client.ts` lines 11–16 comment
**Apply to:** All test files for `bitcoin-core-rpc.ts` and all forensic tool handlers
```typescript
// In test files:
vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  return new Response(
    JSON.stringify({ result: mockData, error: null, id: "vaultpilot" }),
    { status: 200 }
  );
});
```
**Contrast:** Do NOT add `_bitcoinCoreRpcClient` indirection — per CLAUDE.md, that pattern is for modules whose exports call each other internally. The seam is global `fetch`.

### Env-reader Pattern (`string | null` return type)
**Source:** `src/config/env.ts` lines 79–126
**Apply to:** `src/config/bitcoin-core-env.ts` (all 6 new readers)
```typescript
// Private read() helper normalizes empty strings to undefined.
// Public surface returns string | null (not string | undefined) — pattern-matchable.
export function getBitcoinCoreRpcUrl(): string | null {
  return read("BITCOIN_CORE_RPC_URL") ?? null;
}
```

### Diagnostics Logging
**Source:** `src/clients/lifi.ts` lines 36, 195–237; `src/clients/fourbyte.ts` lines 87–137
**Apply to:** All new client and tool files
```typescript
import { log } from "../diagnostics/logger.js";
// Use log("warn", ...) for network failures, log("info", ...) for not-found,
// log("debug", ...) for success. NEVER console.* — stdout is MCP protocol.
// NEVER log URL when it contains credentials (BITCOIN_CORE_RPC_URL may embed user:pass in path).
// Log only: chain name, method name, error message. Never the full URL.
```

### Boolean-only Config Surface (Secret Safety)
**Source:** `src/tools/get_vaultpilot_config_status.ts` lines 165–176; `src/clients/etherscan.ts` lines 33
**Apply to:** `get_vaultpilot_config_status.ts` extension; all forensic tool responses
```typescript
// NEVER surface BITCOIN_CORE_RPC_URL, BITCOIN_CORE_RPC_USER, BITCOIN_CORE_RPC_PASS
// in any tool response, structuredContent, or log line.
// Surface only: bitcoinCoreConfigured: boolean
```

### `registerTool` Call Structure
**Source:** `src/tools/get_vaultpilot_config_status.ts` lines 107–270
**Apply to:** All new tool files
```typescript
registerTool(
  "tool_name",
  DESCRIPTION,   // multi-sentence string; use join(" ") pattern for long descriptions
  INPUT_SCHEMA,  // { type: "object", properties: {...}, additionalProperties: false }
  async (args) => {
    // ...
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: structured,
    };
  },
);
```

### `Promise.allSettled` Fan-out with Per-leg Timeout
**Source:** `src/tools/get_portfolio_summary.ts` lines 346–421, 438–457
**Apply to:** `src/tools/build_incident_report.ts`
```typescript
// Key points from get_portfolio_summary.ts:
// 1. Promise.allSettled (not Promise.all) — partial failure is not global failure
// 2. AbortController + Promise.race for per-leg timeout (not setTimeout on outer scope)
// 3. Collect errors into chainErrors/probeErrors array; successful legs accumulate results
// 4. rejected.reason instanceof Error ? reason.message : String(reason) — always string
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `SECURITY.md` (append) | documentation | — | No code pattern; append-only. Read end of file for heading style, then append new `## Phase 27` section matching existing style at line 380. |

---

## Metadata

**Analog search scope:** `src/clients/`, `src/tools/`, `src/config/`, `src/chains/bitcoin/`, `SECURITY.md`
**Files scanned:** 8 source files read in full
**Pattern extraction date:** 2026-05-23
