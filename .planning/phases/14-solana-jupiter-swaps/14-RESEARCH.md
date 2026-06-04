# Phase 14: Jupiter v6 swaps — Research

**Researched:** 2026-06-04
**Domain:** Solana DEX-aggregator integration (Jupiter v6) over the FROZEN Phase-12 Solana trust pipeline
**Confidence:** HIGH (rnd scope-probe + FROZEN-binding compat both resolved against primary artifacts)

## Summary

Phase 14 adds two tools — `get_jupiter_quote` (read) and `prepare_jupiter_swap` (prepare) — that consume Jupiter's v6 Swap API and route the **Jupiter-returned serialized transaction** through the existing Phase-12 Solana trust pipeline. Unlike every prior Solana phase, the message bytes here are constructed by a **third party** (Jupiter's hosted Metis router), not hand-assembled in this codebase. The whole phase hinges on one compat question and one security model.

**The rnd verdict:** No new dependency. The Jupiter v6 API is plain HTTP JSON (`GET /quote` + `POST /swap`); `@jup-ag/api@6.0.48` is a zero-runtime-dep OpenAPI wrapper around exactly those two calls and adds nothing the codebase doesn't already have. The keyless free host `https://lite-api.jup.ag/swap/v1` requires no API key. Deserialize the returned base64 transaction with the already-installed `@solana/web3.js@1.98.4`.

**★ The load-bearing FROZEN-compat resolution (Q2):** Jupiter `/swap` returns a base64 **VersionedTransaction (v0, with Address Lookup Tables)** *by default*. The FROZEN binding (`payload-fingerprint-solana.ts` + `presign-hash-solana.ts`) accepts **only legacy `Transaction.serializeMessage()` bytes** — its anti-pattern guard names legacy `Transaction` explicitly, and the Ledger blind-sign SHA-256 is computed over those same legacy message bytes. **Resolution path: request `asLegacyTransaction: true` on BOTH `/quote` and `/swap`** (documented param, default `false`). This forces Jupiter to build a legacy transaction whose `serializeMessage()` output flows through the FROZEN binding UNCHANGED — exactly as the Phase-13 MarginFi `assembleMarginfiTx` legacy path already does. **This is NOT a blocker.** There is one residual risk to gate (legacy-tx size overflow on complex routes — see Pitfall 1).

**Primary recommendation:** Build `src/clients/jupiter.ts` (never-throws, LRU-cached, fetch-stub-at-boundary — `fourbyte.ts` shape, 3-arm union). Always pass `asLegacyTransaction: true`. Deserialize the legacy tx, extract its `serializeMessage()` bytes, and feed them to the FROZEN `computeSolanaPayloadFingerprint` unchanged. Decode the legacy tx's instructions to enumerate every invoked program for the canonical-dispatch allowlist; surface swap economics (`From`/`To`/price-impact) from the **quote** envelope, not the opaque tx. MEV gate mirrors EVM MEV-01.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

> Note: `14-CONTEXT.md` is a **placeholder** ("context-gathering pending — run `/gsd-discuss-phase 14`"). The "Implementation Decisions" below are CONTEXT *anchor candidates*, not finalized locked decisions. Where this research resolves a Claude's-Discretion item or upgrades an anchor candidate to a verified fact, it is noted inline. The planner should treat anchor candidates as strong defaults; a `/gsd-discuss-phase 14` pass may still adjust them.

### Locked Decisions (anchor candidates — pending discuss-phase confirmation)
- **Jupiter API client shape**: `src/clients/jupiter.ts` mirrors `fourbyte.ts` / `etherscan.ts` — never-throws, LRU cache, `_resetJupiter_ForTesting` hook, fetch-stub at network boundary per CLAUDE.md.
- **Quote → transaction flow**: Jupiter v6 returns a serialized transaction the user signs unchanged. `prepare_jupiter_swap` wraps quote → tx serialization + applies the standard Solana trust pipeline (Phase 12 primitives).
- **Sandwich-MEV gate**: refuses without explicit `slippageBps` when quoted price impact > 2%. Below 2%, default 50-bps hint applies. Matches v2.6 MEV-01.
- **Decoded swap args**: `CHECKS PERFORMED` surfaces `From: X SYMBOL`, `To: Y SYMBOL`, `Price impact: Z%`, `Route: A → B → C`.
- **Allowlist extension**: Jupiter v6 program ID added to `SOLANA_DISPATCH_ALLOWLIST` from Phase 13. The Jupiter **routing** program (not the inner DEX programs) is the canonical dispatch target — but see § Security Model: inner DEX programs run as INNER instructions (CPI) under the single outer Jupiter call, so the top-level instruction set is small and enumerable.
- **Fixture K**: Jupiter swap fingerprint hardcoded literal in `test/signing-fingerprint.test.ts`.

### Claude's Discretion (resolved by this research)
- **Jupiter quote endpoint version** → RESOLVED: v6 is current; the public surface is now hosted at `…/swap/v1` paths (`GET /quote`, `POST /swap`) routing to the v6 "Metis" engine. The v6 **aggregator program ID** `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` is the on-chain target. [CITED]
- **Slippage hint default (50 bps)** → CONFIRMED reasonable; mirrors the EVM ethereum-arm `defaultSlippageBps: 50` SOT and matches Phantom/Solflare/Backpack defaults. [ASSUMED — wallet-default claim not re-verified; the 50-bps choice is independently justified by the EVM SOT mirror]
- **Whether `get_jupiter_quote` ships an `[AGENT TASK]` block** instructing a price-impact recheck before user confirm → RECOMMEND yes (see § Architecture Patterns, Pattern 3).

### Deferred Ideas (OUT OF SCOPE)
- Limit orders — defer to v3.x ergonomics.
- Jupiter DCA / VA — defer.
- Sandwich-MEV protection beyond slippage refusal (Jupiter ShieldHopper RFQ etc.) — defer.
- Per-DEX swap routing override — defer; Jupiter auto-routing is the load-bearing UX.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SOL-W-11 | `get_jupiter_quote({ inputMint, outputMint, amount, slippageBps? })` returns the v6 quote envelope (out amount, route plan, price impact, slippage) | `GET /quote` returns `inAmount`, `outAmount`, `otherAmountThreshold`, `priceImpactPct`, `slippageBps`, `routePlan[]`, `contextSlot` — all VERIFIED in the Jupiter swagger.yaml primary artifact (§ Code Examples). Envelope clones the Phase-32 `get_uniswap_quote` shape. |
| SOL-W-12 | `prepare_jupiter_swap({ inputMint, outputMint, amount, slippageBps })` returns an unsigned serialized tx the user signs via the standard Solana trust pipeline | `POST /swap` with `asLegacyTransaction: true` → base64 legacy tx → `Transaction.from()` deserialize → `.serializeMessage()` → FROZEN `computeSolanaPayloadFingerprint` UNCHANGED (Q2 resolution). Exactly the `assembleMarginfiTx` legacy path. |
| SOL-W-13 | Sandwich-MEV defense — default 50 bps; refuse without explicit `slippageBps` when price impact > 2% | Mirror EVM `getSandwichThresholds` SOT pattern; gate fires on quote `priceImpactPct` parsed to a percentage. `priceImpactPct` is a string fraction (e.g. `"0.0001"` = 0.01%), NOT bps — conversion is `Number(priceImpactPct) * 100` to get percent (Pitfall 3). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Quote fetch + route economics | API/Backend (this MCP, `jupiter.ts` client) | Jupiter hosted Metis router | Server owns the HTTP call + never-throws envelope; Jupiter owns routing math. |
| Legacy-tx forcing (`asLegacyTransaction`) | API/Backend (the `/swap` request body) | — | The compat constraint lives entirely in the request param the server sends. |
| Fingerprint binding | API/Backend (FROZEN `payload-fingerprint-solana.ts`) | — | The legacy message bytes are bound server-side at prepare; re-checked at send. |
| Dispatch allowlist (program enumeration) | API/Backend (`canonical-dispatch-solana.ts`) | — | Server decodes the third-party tx's TOP-LEVEL programs and refuses unknowns. |
| Swap-economics surfacing (`From`/`To`/impact) | API/Backend (CHECKS PERFORMED block) | Agent (relays verbatim) | Sourced from the QUOTE envelope; the agent reads it to the user before sign. |
| On-device verification (the trust anchor) | Ledger device (SHA-256 "Message Hash" blind-sign) | — | Unchanged FROZEN trust boundary; the user matches the on-device hash. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@solana/web3.js` | `^1.98.4` (ALREADY INSTALLED) | `Transaction.from(buf)` to deserialize the legacy tx; `.serializeMessage()` for the binding bytes; instruction decode for dispatch enumeration | Already the codebase's pinned Solana SDK (DF-1 lock, `registry.ts`). The legacy `Transaction` class is exactly what the FROZEN binding consumes. |
| `node:fetch` (global, Node ≥18.17) | runtime built-in | HTTP GET `/quote` + POST `/swap` against `lite-api.jup.ag` | Same network-boundary primitive used by `fourbyte.ts` / `etherscan.ts`. No new dep. |
| `node:crypto` createHash | runtime built-in | (FROZEN — already used by `presign-hash-solana.ts`) | No change. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `viem` (`keccak256`/`toBytes`/`concat`) | `^2.48.0` (INSTALLED) | (FROZEN binding internals) | Already imported by `payload-fingerprint-solana.ts`; no change. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain `fetch` + `@solana/web3.js` deserialize | `@jup-ag/api@6.0.48` SDK | The SDK is a zero-runtime-dep OpenAPI-generated client (`createJupiterApiClient()`) wrapping the same two HTTP calls. It adds a supply-chain install (65 versions, official `jup-ag` org, **0 deps / 0 peerDeps**) for ZERO functional gain — the response shapes are identical JSON either way. **REJECT** per the no-new-dependency preference; the fetch path is strictly leaner and matches the established `fourbyte.ts` client convention. |
| `asLegacyTransaction: true` (legacy) | Native v0 / MessageV0 support in the binding | Would require editing the FROZEN binding (forbidden) — a v2-fingerprint wire-shape break. REJECT. |

**Installation:**
```bash
# NONE. No new dependency. @solana/web3.js@1.98.4 + native fetch already satisfy the phase.
```

**Version verification (no install performed):**
- `npm view @jup-ag/api version` → `6.0.48` (registry read, no install) [VERIFIED: npm registry — but NOT adopted; see Alternatives]
- `@solana/web3.js` → `^1.98.4` present in `package.json` dependencies [VERIFIED: package.json]
- `@jup-ag/api` → **ABSENT** from `package.json` and intentionally stays absent [VERIFIED: package.json]

## Package Legitimacy Audit

> slopcheck install was **denied by the sandbox classifier** (correctly — unauthorized supply-chain install). Per the graceful-degradation protocol, packages are tagged by provenance and any new install must be gated behind a `checkpoint:human-verify` task. **However, Phase 14 introduces NO new package**, so the audit's only row is the rejected SDK alternative, documented for completeness.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@solana/web3.js@^1.98.4` | npm | already installed (Phase 11) | n/a | github.com/solana-labs/solana-web3.js | unavailable | Approved — pre-existing, no change |
| `@jup-ag/api@6.0.48` | npm | created 2022-03-16, modified 2026-03-12, 65 versions | n/a | github.com/jup-ag/jupiter-quote-api-node | unavailable | **NOT ADOPTED** — fetch path chosen; no install |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck unavailable; no new packages anyway)
**Packages flagged as suspicious [SUS]:** none
**New installs this phase:** **NONE.** If a future discuss-phase pass elects the SDK after all, the planner MUST gate `@jup-ag/api` behind a `checkpoint:human-verify` task before install (tag it `[ASSUMED]` until verified — registry existence alone is not `[VERIFIED]`).

## Architecture Patterns

### System Architecture Diagram

```
agent (Claude Code / Cursor)
   │  get_jupiter_quote({inputMint, outputMint, amount, slippageBps?})
   ▼
get_jupiter_quote tool ─────────────────────────────────────────────┐
   │  jupiter.ts client: GET lite-api.jup.ag/swap/v1/quote           │
   │    ?inputMint&outputMint&amount&slippageBps&asLegacyTransaction=true
   │  3-arm union: ok | rate-limited | error  (never throws)         │
   ▼                                                                  │
quote envelope {inAmount,outAmount,priceImpactPct,routePlan,…}       │
   │  → MEV WARNING block if priceImpactPct*100 > 2%  (quote-time)    │
   ▼  (agent relays to user; rechecks impact before confirm)         │
─────────────────────────────────────────────────────────────────────┘
   │  prepare_jupiter_swap({inputMint, outputMint, amount, slippageBps})
   ▼
prepare_jupiter_swap tool
   │  demo-mode FIRST refusal (getActiveSolanaPersona) ─ feePayer
   │  → re-quote (GET /quote, asLegacyTransaction=true)
   │  → MEV REFUSAL GATE: if priceImpactPct*100 > 2% AND slippageBps
   │     not explicitly supplied → SANDWICH_MEV_REFUSED (no handle)
   │  → POST /swap {quoteResponse, userPublicKey: feePayer,
   │       asLegacyTransaction:true, wrapAndUnwrapSol:true}
   ▼
base64 swapTransaction (LEGACY)
   │  Transaction.from(Buffer.from(b64,'base64'))      ← web3.js v1
   │  decode .instructions → programIds[]  (TOP-LEVEL only)
   │  messageBytes = tx.serializeMessage()             ← FROZEN preimage
   ▼
computeSolanaPayloadFingerprint({messageBytes})  ← FROZEN, UNCHANGED
   │  createHandle({args: raw agent strings, tx: {txType:"solana",
   │     messageBytes, feePayer, programIds, instructionSummary}})
   ▼
{handle, payloadFingerprint, PREPARE RECEIPT + CHECKS PERFORMED}
   │  (agent → preview_send → send_transaction)
   ▼
preview_send Solana branch
   │  Layer 0.5: checkSolanaDispatchTarget(programIds)  ← Jupiter pid
   │     in SOLANA_DISPATCH_ALLOWLIST or DISPATCH_TARGET_REFUSED
   │  Layer 0.7: mandatory simulation
   │  presignHash = SHA-256(messageBytes)  ← FROZEN
   ▼
Ledger device — blind-sign "Message Hash" (the trust anchor)
```

### Recommended Project Structure
```
src/
├── clients/
│   └── jupiter.ts            # NEW — never-throws HTTP client (3-arm union), LRU cache, _resetJupiter_ForTesting
├── protocols/
│   └── jupiter.ts            # NEW — deserialize legacy tx + enumerate top-level programIds + build instructionSummary
├── tools/
│   ├── get_jupiter_quote.ts  # NEW — read companion (SOL-W-11)
│   └── prepare_jupiter_swap.ts # NEW — quote→swap→FROZEN-binding (SOL-W-12/13)
├── config/
│   └── contracts.ts          # EDIT — add getJupiterV6Program() to SOLANA_CONTRACTS_RAW
└── security/
    └── canonical-dispatch-solana.ts  # EDIT — add Jupiter v6 pid (+ inner-program slot, see Security Model)
```

### Pattern 1: Never-throws 3-arm HTTP client (jupiter.ts)
**What:** Module-scope LRU cache + AbortController timeout + a discriminated union `{kind:"ok",…} | {kind:"rate-limited",…} | {kind:"error",message}`. Two functions: `getQuote(params)` and `getSwapTransaction(quoteResponse, userPublicKey)`.
**When to use:** Both Jupiter HTTP calls. 3 arms suffice (CONTEXT anchor) — fewer than etherscan's 5 (no `not-verified`/`not-applicable` concepts for a quote).
**Example:** See `src/clients/fourbyte.ts` (caching + timer-cleanup + `log("warn", …)` to stderr) — `jupiter.ts` is a structural clone with two endpoints instead of one.

### Pattern 2: Legacy-tx forcing + FROZEN-binding flow (the make-or-break)
**What:** ALWAYS send `asLegacyTransaction: true` to BOTH `/quote` and `/swap`. Deserialize the returned base64 with web3.js v1 `Transaction.from()` (the LEGACY class, NOT `VersionedTransaction.deserialize()`), then take `.serializeMessage()` for the binding.
**When to use:** Every `prepare_jupiter_swap` call — non-negotiable for FROZEN compat.
**Example:**
```typescript
// Source: project src/protocols/marginfi.ts assembleMarginfiTx (the legacy-tx → FROZEN binding template)
//         + Jupiter swagger.yaml (asLegacyTransaction param)
import { Transaction } from "@solana/web3.js";
import { computeSolanaPayloadFingerprint } from "../signing/payload-fingerprint-solana.js";

const swapB64: string = swapResponse.swapTransaction;           // base64, LEGACY (because asLegacyTransaction:true)
const tx = Transaction.from(Buffer.from(swapB64, "base64"));    // web3.js v1 legacy class — NOT VersionedTransaction
// feePayer + recentBlockhash are already populated by Jupiter; do NOT mutate.
const messageBytes = new Uint8Array(tx.serializeMessage());     // SAME preimage MarginFi/SPL produce
const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes }); // FROZEN, UNCHANGED
```

### Pattern 3: `[AGENT TASK]` price-impact recheck on the quote (recommended)
**What:** `get_jupiter_quote` emits an `[AGENT TASK]` line instructing the agent to re-fetch the quote (impact moves with pool state) before asking the user to confirm. Mirrors the get-uniswap-quote D-08 WARNING posture (WARNING at quote time, REFUSAL at prepare time).
**When to use:** `get_jupiter_quote` only. The hard REFUSAL lives in `prepare_jupiter_swap`.

### Anti-Patterns to Avoid
- **Passing the full `tx.serialize()` (signed-envelope) bytes to the binding.** The FROZEN guard forbids it — zero-filled signature region drifts the fingerprint post-sign. Use `serializeMessage()` ONLY. (Same guard the binding's own header comment names.)
- **Calling `VersionedTransaction.deserialize()`.** Only correct if you DIDN'T force legacy — and a v0 tx's message bytes do NOT match the FROZEN binding. Forcing legacy + `Transaction.from()` is the ONLY compatible path.
- **Mutating the Jupiter-returned tx** (re-setting blockhash/feePayer, re-ordering ix). Any mutation changes `serializeMessage()` → fingerprint no longer reflects what Jupiter built → defeats the bind. Treat the returned tx as immutable.
- **Sourcing `From`/`To`/impact from the decoded opaque tx.** The swap economics live in the QUOTE envelope (`inAmount`/`outAmount`/`priceImpactPct` + token metadata), not in the (opaque, inner-CPI) instruction data. Decode the tx ONLY for program enumeration.
- **Allowlisting the inner DEX programs as top-level dispatch targets.** A Jupiter swap is ONE outer call into the Jupiter program; the DEX hops are INNER (CPI) instructions invisible at the top level. The allowlist checks `record.tx.programIds` = the TOP-LEVEL set. See Security Model.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DEX routing / best-price discovery | A custom multi-DEX router | Jupiter `/quote` | Routing across Raydium/Orca/Meteora/Phoenix is Jupiter's entire product; reimplementing is infeasible and unsafe. |
| Swap tx assembly | Hand-encoded swap instructions | Jupiter `/swap` returns the serialized tx | Inner CPI swap-math per DEX is opaque and version-churning; Jupiter builds the whole tx. |
| Legacy-vs-v0 forcing | Manual ALT-stripping / message-version downgrade | `asLegacyTransaction: true` request param | Jupiter builds the legacy form server-side; never re-encode a v0 message into legacy yourself. |
| Tx deserialize | A custom base64 message parser | `@solana/web3.js` `Transaction.from()` | The pinned SDK's legacy deserializer is the exact inverse of `serializeMessage()`. |
| MEV threshold resolution | A new threshold constant | Mirror the `sandwich-mev-thresholds.ts` SOT pattern (50/2.0) | One canonical posture across EVM + Solana; Solana has a single "cluster" so a single `{defaultSlippageBps:50, priceImpactRefusalPct:2.0}` constant suffices (no per-chain map). |

**Key insight:** Phase 14's job is NOT to build a swap — it's to **bind and gate a swap someone else built**. The novel surface is the trust pipeline around a third-party tx, not the swap mechanics.

## Runtime State Inventory

> N/A — Phase 14 is purely additive code (two new tools + one client + one decoder + two small edits to contracts/dispatch). No rename, no migration, no stored-state mutation. **None — verified: no existing identifier is renamed; the FROZEN binding files are not touched; the dispatch allowlist is appended-to, not rekeyed.**

## Common Pitfalls

### Pitfall 1: Legacy-tx size overflow on complex routes (THE residual risk of the Q2 resolution)
**What goes wrong:** Forcing `asLegacyTransaction: true` removes Address Lookup Tables. A complex multi-hop route can exceed Solana's 1232-byte transaction size limit and the `/swap` call fails (or returns a too-large tx that won't broadcast).
**Why it happens:** ALTs exist precisely to pack more accounts into v0 txs; legacy txs inline every account pubkey. The Jupiter docs note `asLegacyTransaction` "must be used together with `asLegacyTransaction` in `/quote`, otherwise the transaction might be too large" — passing it on `/quote` too makes the router prefer routes that FIT a legacy tx. [CITED: Jupiter swap-api docs]
**How to avoid:** Pass `asLegacyTransaction: true` on BOTH endpoints (so the router constrains route selection to legacy-fittable paths). On a `/swap` size failure, surface a structured refusal (e.g. `INVALID_INPUT` / a `JUPITER_ROUTE_TOO_LARGE`-style envelope) advising a smaller amount or a more-liquid pair — DO NOT silently fall back to a v0 tx (that would break FROZEN compat). Test this path with a mocked oversize-route error.
**Warning signs:** `/swap` returns an error mentioning transaction size; a deserialized tx with an unusually long account list.

### Pitfall 2: Treating `priceImpactPct` as bps
**What goes wrong:** `priceImpactPct` is a **string decimal fraction** (e.g. `"0.0001"` = 0.01%, `"0.025"` = 2.5%), NOT basis points and NOT an already-percent number. Comparing it directly against `2` (the 2% threshold) would mis-fire the MEV gate by 100×.
**Why it happens:** The field name says "Pct" but the value is a fraction. The EVM side uses `priceImpactBps` (already-bps); Jupiter does not.
**How to avoid:** Compute percent as `Number(priceImpactPct) * 100`, then compare against `priceImpactRefusalPct` (= 2.0). Anchor this conversion in a unit test with a `"0.025"` fixture asserting it refuses and a `"0.001"` fixture asserting it passes. [VERIFIED: Jupiter swagger.yaml example shows `priceImpactPct: "0.0001"` alongside `outAmount: "17057460"`]
**Warning signs:** MEV gate never fires, or fires on every swap.

### Pitfall 3: Demo-mode env leak across tests (the just-fixed CI-failure class)
**What goes wrong:** A Solana prepare-tool test that doesn't pin `VAULTPILOT_DEMO` inherits whatever the previous test set, so the demo-FIRST refusal branch fires (or doesn't) nondeterministically → flaky CI.
**Why it happens:** `isDemoMode()` reads `process.env.VAULTPILOT_DEMO` at call time; vitest shares the process across files.
**How to avoid:** EXACT pattern from `test/prepare-marginfi-supply.test.ts`: in `beforeEach`, `savedDemo = process.env.VAULTPILOT_DEMO; process.env.VAULTPILOT_DEMO = "false";` and in `afterEach`, restore (`delete` if it was `undefined`, else reassign). Force `"false"` for the real-mode prepare tests; set the Solana persona explicitly for the demo-mode tests. [VERIFIED: codebase grep — Phase-13 marginfi tests use exactly this]
**Warning signs:** Test passes alone, fails in the full suite (or vice versa).

### Pitfall 4: Quote/swap mint+amount drift between the two HTTP calls
**What goes wrong:** `prepare_jupiter_swap` quotes, then swaps. If the `quoteResponse` POSTed to `/swap` isn't the EXACT object returned by `/quote`, the built tx won't match the surfaced economics.
**Why it happens:** `/swap` takes the whole `quoteResponse` object back as its request body; reconstructing it loses fields.
**How to avoid:** Pass the verbatim `quoteResponse` JSON from the `/quote` call straight into the `/swap` body — never rebuild it. The CHECKS PERFORMED economics come from that same quote object.

## Code Examples

### get_jupiter_quote — quote envelope fields (the read companion)
```jsonc
// Source: Jupiter v6 OpenAPI swagger.yaml (jup-ag/jupiter-quote-api-node) — VERIFIED primary artifact
// GET https://lite-api.jup.ag/swap/v1/quote?inputMint=…&outputMint=…&amount=…&slippageBps=50&asLegacyTransaction=true
{
  "inputMint": "So11111111111111111111111111111111111111112",
  "inAmount": "100000000",
  "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "outAmount": "17057460",
  "otherAmountThreshold": "16886885",   // = outAmount after slippageBps
  "swapMode": "ExactIn",
  "slippageBps": 50,
  "priceImpactPct": "0.0001",           // STRING FRACTION (0.01%), NOT bps — *100 for percent
  "routePlan": [
    { "swapInfo": { "ammKey": "...", "label": "Orca", "inputMint": "...", "outputMint": "...",
                    "inAmount": "...", "outAmount": "...", "feeAmount": "...", "feeMint": "..." },
      "percent": 100 }
  ],
  "contextSlot": 0
}
```

### prepare_jupiter_swap — swap request + legacy deserialize (the binding flow)
```typescript
// Source: Jupiter swagger.yaml (POST /swap body) + project marginfi.ts (legacy → FROZEN binding)
// POST https://lite-api.jup.ag/swap/v1/swap
const swapBody = {
  quoteResponse,                  // VERBATIM object from GET /quote (Pitfall 4)
  userPublicKey: feePayerBase58,  // demo persona or paired Solana account
  asLegacyTransaction: true,      // ★ FROZEN-COMPAT — forces legacy (default false → v0)
  wrapAndUnwrapSol: true,         // default — auto wrap/unwrap SOL (adds System + Token ix; see Security Model)
};
// response: { swapTransaction: "<base64>" }  — LEGACY because asLegacyTransaction:true
const tx = Transaction.from(Buffer.from(resp.swapTransaction, "base64"));
const messageBytes = new Uint8Array(tx.serializeMessage());
const programIds = [...new Set(tx.instructions.map((ix) => ix.programId.toBase58()))]; // TOP-LEVEL only
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `quote-api.jup.ag/v6/quote` host/paths | `lite-api.jup.ag/swap/v1/*` (keyless) + `api.jup.ag/swap/v1/*` (keyed) — same v6 Metis engine | 2025 API-platform migration | Use `lite-api.jup.ag` (keyless) for v1.x; the `/v6/` path label is superseded by `/swap/v1/` but the engine + program ID are v6. |
| `@jup-ag/api` SDK as the "official" integration | Plain HTTP is first-class; the SDK is a thin generated wrapper | ongoing | No reason to install the SDK; HTTP is the leaner, dep-free path. |
| Jupiter free tier fully open | Free tier on `lite-api.jup.ag` (no key); legacy portal rate limits grandfathered until **2026-06-30** | 2025 portal change | v1.x uses keyless `lite-api`; document the keyed `api.jup.ag` + `JUPITER_API_KEY` env as an optional override (mirror `SOLANA_RPC_URL` pattern) if rate limits bite. [CITED] |

**Deprecated/outdated:**
- Direct `/v6/` host paths in older guides — superseded by `/swap/v1/` on the new hosts (engine unchanged).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 50-bps default matches Phantom/Solflare/Backpack wallet defaults | User Constraints / Discretion | LOW — the 50-bps choice is independently justified by mirroring the EVM ethereum SOT; the wallet-default claim is corroborating colour, not load-bearing. |
| A2 | `lite-api.jup.ag` keyless host remains free + un-keyed through v1.x ship | State of the Art | MEDIUM — if Jupiter gates the keyless host, the client needs a `JUPITER_API_KEY` env override (already recommended as a fallback). Plan should build the env-override seam now to de-risk. |
| A3 | A legacy-forced route exists for common pairs (SOL↔USDC etc.) without size overflow | Pitfall 1 | MEDIUM — common pairs route in 1-2 hops and fit legacy comfortably; exotic long-tail pairs may overflow. Mitigated by the structured size-overflow refusal (Pitfall 1) — fail-safe, not silent. |
| A4 | `wrapAndUnwrapSol: true` adds only System + SPL-Token (+ ATA) top-level programs, all already in the allowlist | Security Model | LOW-MEDIUM — needs an empirical decode confirmation at plan/execution time (a mocked-fixture decode of a real captured SOL→USDC legacy tx). If wrap/unwrap surfaces an unexpected top-level program, the allowlist must enumerate it. See Open Question 1. |

## Open Questions

1. **Exact TOP-LEVEL program set of a `wrapAndUnwrapSol:true` legacy Jupiter swap.**
   - What we know: The swap is one outer call into Jupiter `JUP6Lkb…` (inner DEX hops are CPI, invisible at top level). `wrapAndUnwrapSol:true` typically prepends a System-program SOL→wSOL wrap + an SPL-Token close to unwrap, and ComputeBudget ix are commonly present.
   - What's unclear: Whether ComputeBudget program (`ComputeBudget111111111111111111111111111111`) appears as a TOP-LEVEL instruction (it usually does on Jupiter txs) and must therefore be added to `SOLANA_DISPATCH_ALLOWLIST`.
   - Recommendation: At execution time, decode a captured legacy SOL→USDC swap tx (a pinned base64 fixture — NO live call) and enumerate its top-level `programIds`. Add to the allowlist EXACTLY the set observed (likely: Jupiter v6 + System + SPL-Token + Associated-Token + ComputeBudget). Enumerate from the actual decoded tx — NOT guessed (mirror the Phase-13 "enumerated from the actual built instruction vector, NOT guessed" discipline). This is the auxiliary-program slot pattern from `canonical-dispatch-solana.ts` Phase-13 Kamino arm.

2. **Does `asLegacyTransaction` measurably degrade quote quality for the demo personas' likely pairs?**
   - What we know: Legacy forcing constrains routes; for liquid majors the price difference is negligible.
   - Recommendation: Out of scope to optimize; document the trade-off in SECURITY.md / tool description ("legacy-tx forcing for hardware-wallet compat may yield a marginally less-optimal route on exotic pairs").

## Security Domain

> `security_enforcement` is enabled (no `false` in config). Phase 14 signs a THIRD-PARTY-CONSTRUCTED transaction — this is the highest-trust-sensitivity Solana phase so far.

### The Decode-for-Trust Security Model (load-bearing)

A Jupiter swap is **ONE outer instruction** into the Jupiter aggregator program `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`; the actual DEX swaps (Raydium, Orca Whirlpool, Meteora DLMM, Phoenix) run as **inner (CPI) instructions** under that outer call and are invisible at the top level. [CITED — corroborated by Bitquery + QuickNode Jupiter guides]. Therefore:

- **Canonical-dispatch (Layer 0.5) checks the TOP-LEVEL program set** (`record.tx.programIds`), which is small and enumerable: Jupiter v6 + (from `wrapAndUnwrapSol`) System + SPL-Token + Associated-Token + (typically) ComputeBudget. The allowlist must permit EXACTLY this set; an unexpected top-level program → `DISPATCH_TARGET_REFUSED`. The inner DEX programs are NOT (and cannot be) top-level dispatch targets — the trust is "the user is calling the Jupiter aggregator, which the server allowlists, and the device shows the message hash."
- **The user's trust anchor remains the on-device SHA-256 "Message Hash"** (FROZEN `presign-hash-solana.ts`). The Ledger Solana app blind-signs; the user matches the hash. The MCP-side decode + economics surfacing is defense-in-depth, NOT the primary trust boundary.
- **Economics surfacing is from the QUOTE, not the tx.** `From: X SYMBOL`, `To: Y SYMBOL`, `Price impact: Z%`, `Route: A→B→C` all come from the quote envelope (`inAmount`/`outAmount`/`priceImpactPct`/`routePlan[].swapInfo.label` + token metadata via the curated registry / `get_solana_token_metadata`). The opaque tx is decoded ONLY to enumerate programs.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | base58 mint regex (mirror `prepare_solana_spl_send` `BASE58_PUBKEY_REGEX`); decimal-string amount via `parseSolanaAmountStrict`; `slippageBps` integer-bounds parse (mirror EVM 1..10000) |
| V6 Cryptography | yes | FROZEN `computeSolanaPayloadFingerprint` (keccak256) + `computeSolanaPresignHash` (SHA-256) — NEVER hand-roll, NEVER edit |
| V4 Access Control | yes (server-side) | demo-FIRST refusal + WALLET_NOT_PAIRED real-mode gate (mirror `prepare_solana_spl_send`); canonical-dispatch allowlist (Layer 0.5) |
| V11 Business Logic (API abuse) | yes | sandwich-MEV REFUSAL gate (SOL-W-13); never-throws client with per-call timeout |

### Known Threat Patterns for Jupiter-routed Solana swaps
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Sandwich MEV (frontrun + backrun) | Tampering | `priceImpactPct*100 > 2%` REFUSAL absent explicit `slippageBps`; 50-bps default `otherAmountThreshold` floor (SOL-W-13) |
| Malicious/unexpected program in the returned tx | Tampering / Elevation | Layer-0.5 dispatch allowlist over TOP-LEVEL programIds → `DISPATCH_TARGET_REFUSED` |
| Tx mutation between prepare and send | Tampering | FROZEN `payloadFingerprint` computed at prepare, re-checked at send → `PAYLOAD_FINGERPRINT_DRIFT` |
| Jupiter API returning a tx that doesn't match the quoted economics | Tampering / Spoofing | Pass verbatim `quoteResponse` to `/swap` (Pitfall 4); mandatory simulation gate (Layer 0.7); user matches on-device Message Hash |
| Legacy-tx size overflow used to force a v0 fallback | Tampering (compat-break) | Hard refusal on size failure — NEVER silently fall back to v0 (Pitfall 1) |
| Decimal-place amount error | (user-facing) | `parseSolanaAmountStrict` against resolved decimals (project decimal-aware rule) |

## Validation Architecture

> `workflow.nyquist_validation` not set to false — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest `^2.1.0` |
| Config file | (project root vitest config — existing) |
| Quick run command | `npx vitest run test/prepare-jupiter-swap.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SOL-W-11 | quote envelope shape (out/threshold/impact/route) | unit | `npx vitest run test/get-jupiter-quote.test.ts` | ❌ Wave 0 |
| SOL-W-12 | legacy tx → FROZEN binding fingerprint byte-identity | unit | `npx vitest run test/prepare-jupiter-swap.test.ts` | ❌ Wave 0 |
| SOL-W-12 | Fixture K — Jupiter swap fingerprint hardcoded literal | unit | `npx vitest run test/signing-fingerprint.test.ts` | ✅ (add Fixture K) |
| SOL-W-13 | MEV refusal at `priceImpactPct*100 > 2%` w/o explicit slippage | unit | `npx vitest run test/prepare-jupiter-swap.test.ts` | ❌ Wave 0 |
| SC #5 | Jupiter pid in dispatch allowlist; unknown top-level pid refuses | unit | `npx vitest run test/canonical-dispatch-solana.test.ts` | ✅ (extend) |
| SC #4 | CHECKS PERFORMED surfaces From/To/impact from quote | unit | `npx vitest run test/prepare-jupiter-swap.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/prepare-jupiter-swap.test.ts test/get-jupiter-quote.test.ts`
- **Per wave merge:** `npx vitest run test/signing-fingerprint.test.ts test/canonical-dispatch-solana.test.ts` + the two new files
- **Phase gate:** Full suite green + FROZEN-binding tests untouched-and-passing before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/clients-jupiter.test.ts` — covers the never-throws 3-arm client (ok / rate-limited / error) via `vi.stubGlobal("fetch", …)` at the network boundary (per CLAUDE.md: external clients stub fetch, NOT internal indirection)
- [ ] `test/get-jupiter-quote.test.ts` — covers SOL-W-11 envelope + MEV WARNING-at-quote
- [ ] `test/prepare-jupiter-swap.test.ts` — covers SOL-W-12 binding + SOL-W-13 refusal + CHECKS PERFORMED; mock the Jupiter fetch boundary AND `Transaction.from` input; `VAULTPILOT_DEMO` pinned in `beforeEach`/restored in `afterEach` (Pitfall 3)
- [ ] `test/protocols-jupiter.test.ts` — covers the legacy-tx deserialize + top-level program enumeration against a PINNED base64 fixture (no live call)
- [ ] Fixture K literal added to `test/signing-fingerprint.test.ts` (computed at write-time, NO `beforeAll`-snapshot — per CLAUDE.md cryptographic-binding rule)
- [ ] `canonical-dispatch-solana.test.ts` extended for the Jupiter pid + the wrap/unwrap auxiliary programs

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@solana/web3.js` | tx deserialize + binding | ✓ | ^1.98.4 (package.json) | — |
| native `fetch` | Jupiter HTTP | ✓ | Node ≥18.17 (project floor) | — |
| Jupiter `lite-api.jup.ag` | quote + swap (runtime + integration tests only) | n/a at research (NO live calls per directive) | v6/swap-v1 | keyed `api.jup.ag` + `JUPITER_API_KEY` env override (A2) |
| `@jup-ag/api` SDK | (not adopted) | ✗ (absent, intentional) | — | n/a — fetch path chosen |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Jupiter keyless host (A2) → keyed host via `JUPITER_API_KEY` env (build the seam now).

## Proposed Plan Structure (2 plans — matches ROADMAP)

**14-01 — Read companion + client + dispatch arm.**
- `src/clients/jupiter.ts` — never-throws 3-arm HTTP client (`getQuote` + `getSwapTransaction`), LRU cache, AbortController timeout, `_resetJupiter_ForTesting`, stderr `log("warn")`. Always sets `asLegacyTransaction: true`. Keyless `lite-api.jup.ag` default + `JUPITER_API_KEY`→`api.jup.ag` env seam (A2).
- `get_jupiter_quote` tool (SOL-W-11) — envelope clone of `get_uniswap_quote` shape + MEV WARNING-at-quote + recommended `[AGENT TASK]` recheck.
- `src/config/contracts.ts` — `getJupiterV6Program()` returning `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` in `SOLANA_CONTRACTS_RAW`.
- `canonical-dispatch-solana.ts` — append the Jupiter pid (+ the wrap/unwrap auxiliary slot, enumerated from the Open-Question-1 decode).
- `register-all.ts` wiring; `test/clients-jupiter.test.ts` + `test/get-jupiter-quote.test.ts` + dispatch test extension.

**14-02 — `prepare_jupiter_swap` + binding + MEV gate + fixtures.**
- `src/protocols/jupiter.ts` — `Transaction.from()` legacy deserialize + top-level `programIds` enumeration + `instructionSummary` (`_jupiter` ESM indirection for the decode seam, OR fetch-stub if the only seam is network — likely a hybrid: stub fetch in the client, spy `_jupiter` for the decode).
- `prepare_jupiter_swap` tool (SOL-W-12/13) — demo-FIRST refusal → re-quote → **MEV REFUSAL GATE** (`priceImpactPct*100 > 2%` + no explicit `slippageBps` → `SANDWICH_MEV_REFUSED`, no handle) → POST `/swap` (verbatim quoteResponse) → legacy deserialize → FROZEN `computeSolanaPayloadFingerprint` UNCHANGED → `createHandle` → PREPARE RECEIPT + CHECKS PERFORMED (From/To/impact/route from the quote).
- Fixture K (hardcoded literal) in `test/signing-fingerprint.test.ts`; pinned base64 legacy-swap fixture in `test/protocols-jupiter.test.ts`; `test/prepare-jupiter-swap.test.ts` (binding byte-identity + MEV refusal + CHECKS PERFORMED; `VAULTPILOT_DEMO` pinned/restored).
- Phase-final register-all verify + FROZEN-binding-untouched gate + full suite.

## Sources

### Primary (HIGH confidence)
- `jup-ag/jupiter-quote-api-node` swagger.yaml (OpenAPI primary artifact) — quote response schema (`inAmount`/`outAmount`/`otherAmountThreshold`/`priceImpactPct`/`routePlan`/`contextSlot`/`swapMode`/`slippageBps`), swap request body (`asLegacyTransaction` default `false`, `wrapAndUnwrapSol` default `true`, `userPublicKey`, `dynamicComputeUnitLimit`, `quoteResponse`), `swapTransaction` base64 response. Base host `https://api.jup.ag/swap/v1`.
- npm registry direct read — `@jup-ag/api@6.0.48`: 0 deps, 0 peerDeps, type=CJS, 65 versions, created 2022-03-16, modified 2026-03-12.
- Project codebase (authoritative for FROZEN binding + patterns): `src/signing/payload-fingerprint-solana.ts`, `src/signing/presign-hash-solana.ts`, `src/protocols/marginfi.ts` (legacy-tx → binding template), `src/security/canonical-dispatch-solana.ts`, `src/tools/prepare_solana_spl_send.ts`, `src/clients/fourbyte.ts` + `etherscan.ts`, `src/config/sandwich-mev-thresholds.ts`, `src/tools/get_uniswap_quote.ts`, `test/signing-fingerprint.test.ts`, `test/prepare-marginfi-supply.test.ts`.

### Secondary (MEDIUM confidence)
- Jupiter Developers docs (`dev.jup.ag` / `developers.jup.ag`) — `asLegacyTransaction` description + "must be used together with asLegacyTransaction in /quote, otherwise the transaction might be too large" caveat; default-versioned-transaction statement; `lite-api.jup.ag` (keyless free) vs `api.jup.ag` (keyed) host split; portal grandfathered rate limits until 2026-06-30.
- Solana Explorer anchor-program page + Bitquery + QuickNode Jupiter guide — program ID `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` = Jupiter Aggregator v6; outer-call-with-inner-CPI-DEX-hops structure (corroborated across ≥3 independent indexers).

### Tertiary (LOW confidence)
- WebSearch general results on `asLegacyTransaction` usage / `VersionedTransaction.deserialize` snippet — used only to corroborate the default-v0 fact already confirmed in the swagger/docs.

## Metadata

**Confidence breakdown:**
- Standard stack (no-new-dep, web3.js + fetch): HIGH — verified against package.json + npm registry directly.
- FROZEN-binding compat (Q2 resolution): HIGH — FROZEN files read directly (legacy-only, with explicit anti-pattern guard) + `asLegacyTransaction` confirmed in the Jupiter OpenAPI primary artifact + docs. The legacy-tx → `serializeMessage()` → binding path is already exercised by Phase-13 MarginFi.
- Security model (decode-for-trust, dispatch enumeration): MEDIUM-HIGH — the outer/inner-CPI structure is well-corroborated; the EXACT top-level program set under `wrapAndUnwrapSol` needs an execution-time decode of a pinned fixture (Open Question 1).
- MEV gate: HIGH — mirrors the verified EVM `sandwich-mev-thresholds.ts` SOT; the `priceImpactPct`-is-a-fraction conversion is the one trap (Pitfall 2), anchored to the swagger example.
- Pitfalls: HIGH — legacy-size-overflow caveat is from the Jupiter docs verbatim; demo-env-leak is from the just-fixed Phase-13 test pattern.

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (30 days; but note the Jupiter portal rate-limit grandfather expiry 2026-06-30 — re-verify the keyless-host policy if shipping after that date — A2)
