---
phase: 14-solana-jupiter-swaps
plan: 01
subsystem: solana-jupiter
tags: [jupiter, solana, dex-aggregator, dispatch-allowlist, mev]
requires:
  - "@solana/web3.js (already installed) — legacy Transaction decode"
  - "src/clients/fourbyte.ts shape (never-throws + LRU + AbortController)"
  - "src/config/sandwich-mev-thresholds.ts posture (50/2.0 mirrored, NOT imported)"
provides:
  - "src/clients/jupiter.ts — never-throws 3-arm Jupiter v6 HTTP client (getQuote + getSwapTransaction), asLegacyTransaction:true ALWAYS, JUPITER_API_KEY host seam"
  - "src/tools/get_jupiter_quote.ts — SOL-W-11 read companion + sandwich-MEV WARNING + [AGENT TASK] recheck"
  - "getJupiterV6Program() SOT getter"
  - "SOLANA_DISPATCH_ALLOWLIST extended (Jupiter v6 + ComputeBudget)"
  - "test/fixtures/jupiter-swap-legacy.b64.ts — the SINGLE shared pinned swap fixture (14-02 imports it)"
affects:
  - "src/security/canonical-dispatch-solana.ts (allowlist arm)"
  - "src/config/contracts.ts (Solana SOT)"
  - "src/tools/register-all.ts (wiring)"
tech-stack:
  added: []
  patterns:
    - "never-throws 3-arm HTTP client (fourbyte.ts clone)"
    - "call-time env-seam read (JUPITER_API_KEY → host flip; mirror SOLANA_RPC_URL)"
    - "ESM spy-affordance indirection (_jupiter)"
    - "single-cluster Solana MEV constant (50/2.0), NOT the per-chain EVM map"
key-files:
  created:
    - src/clients/jupiter.ts
    - src/tools/get_jupiter_quote.ts
    - test/fixtures/jupiter-swap-legacy.b64.ts
    - test/clients-jupiter.test.ts
    - test/get-jupiter-quote.test.ts
  modified:
    - src/config/contracts.ts
    - src/security/canonical-dispatch-solana.ts
    - src/tools/register-all.ts
    - test/config-contracts.test.ts
    - test/canonical-dispatch-solana.test.ts
decisions:
  - "Open Question 1 RESOLVED by enumeration: ComputeBudget IS top-level in the wrapAndUnwrapSol:true legacy swap → added to the allowlist."
  - "get_jupiter_quote `amount` is a RAW base-unit integer string forwarded verbatim to Jupiter (Jupiter is the decimals authority; the read tool does not resolve decimals)."
  - "Solana MEV posture is a single {defaultSlippageBps:50, priceImpactRefusalPct:2.0} constant in get_jupiter_quote — mirrors the EVM ethereum SOT, does NOT import the per-chain map (Solana has no EVM ChainId)."
metrics:
  duration: "~30m"
  completed: 2026-06-04
  tasks: 3
  files: 10
---

# Phase 14 Plan 14-01: Jupiter v6 quote read + foundation Summary

Never-throws 3-arm Jupiter v6 HTTP client + `get_jupiter_quote` (SOL-W-11) read companion + Jupiter v6 program ID in the contracts SOT + canonical-dispatch Solana allowlist extended (Jupiter v6 + ComputeBudget enumerated from the single owned pinned fixture), all built against a fetch-stubbed boundary with NO live HTTP / RPC.

## What shipped

- **`src/clients/jupiter.ts`** — structural clone of `fourbyte.ts`: module-scope LRU cache, AbortController per-call timeout (8s) with `clearTimeout` in `finally`, `log("warn",…)` to stderr, `_resetJupiter_ForTesting()`, `_jupiter` ESM spy seam. 3-arm union `ok | rate-limited | error`. `getQuote` (GET /quote) + `getSwapTransaction` (POST /swap). **`asLegacyTransaction:true` ALWAYS sent on both endpoints** (query param on /quote, body field on /swap; /swap also sets `wrapAndUnwrapSol:true`). `JUPITER_API_KEY` host seam read at CALL TIME: keyless `lite-api.jup.ag/swap/v1` default → keyed `api.jup.ag/swap/v1` + `x-api-key` header when set. Never throws.
- **`src/tools/get_jupiter_quote.ts`** (SOL-W-11) — quote envelope (inAmount/outAmount/otherAmountThreshold/priceImpactPct/slippageBps/routePlan) + sandwich-MEV WARNING when `Number(priceImpactPct)*100 > 2.0%` (Pitfall 2 conversion) + ALWAYS an `[AGENT TASK]` recheck line. Single-cluster MEV constant (50/2.0).
- **`getJupiterV6Program()`** in the Solana SOT (`JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`).
- **`SOLANA_DISPATCH_ALLOWLIST`** extended: `getJupiterV6Program()` + `ComputeBudgetProgram.programId.toBase58()` (allowlist size 8 → 10).
- **`test/fixtures/jupiter-swap-legacy.b64.ts`** — the SINGLE pinned SOL→USDC `wrapAndUnwrapSol:true` legacy-tx base64 (+ a v0 sample for 14-02's anti-pattern guard + the recorded top-level program set). 14-02 imports this exact literal.

## Open Question 1 — RESOLVED (by enumeration, NOT guessed)

Decoding the single owned `JUPITER_SWAP_LEGACY_B64` fixture ONCE yields the TOP-LEVEL program set:

```
ComputeBudget111111111111111111111111111111   ← ComputeBudget (DOES appear top-level)
ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL   ← Associated-Token (already allowlisted)
11111111111111111111111111111111               ← System          (already allowlisted)
TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA   ← SPL-Token       (already allowlisted)
JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4   ← Jupiter v6      (ADDED)
```

**ComputeBudget IS present top-level**, so `ComputeBudgetProgram.programId.toBase58()` was added to the allowlist (NO inlined base58 — the web3.js constant). 14-02 re-asserts this exact set against the identical imported fixture bytes. Inner DEX hops (Raydium/Orca/Meteora/Phoenix) are CPI under the single outer Jupiter ix and are invisible at the top level (correct — the allowlist is over `record.tx.programIds` = top-level).

## Fixture Z anchor (forward to 14-02)

`computeSolanaPayloadFingerprint({ messageBytes: serializeMessage(JUPITER_SWAP_LEGACY_B64 decode) })`
= `0x6d14fb2164f56333cc15386d8ca1943d86458473f14526439baf2cffba459550`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected a transcription-corrupted fixture base64 literal**
- **Found during:** Task 1 GREEN verification (the canonical-dispatch fixture-enumeration test threw "Reached end of buffer unexpectedly" at decode).
- **Issue:** The first hand-pasted `JUPITER_SWAP_LEGACY_B64` literal was off by one character (685/683 vs the correct 684) — base64 corruption from manual paste of a long unbroken string.
- **Fix:** Regenerated the fixture file programmatically (deterministic builder) so the literal is byte-exact; the decode now yields 8 instructions and the recorded top-level set. The same builder emitted the v0 sample + Fixture Z fingerprint.
- **Files modified:** test/fixtures/jupiter-swap-legacy.b64.ts
- **Commit:** (this plan's commit)

**2. [Rule 3 - Blocking] Aligned the get_jupiter_quote test amount with the raw-base-unit contract**
- **Issue:** The Wave-0 test fixture passed `amount: "1.0"` (a decimal) but Jupiter's API + the tool contract take raw base units.
- **Fix:** Test fixture uses `"100000000"` (0.1 SOL @ 9 decimals); the tool guards a positive base-unit integer string and forwards it verbatim to Jupiter.

## Verification

- `npx vitest run test/clients-jupiter.test.ts test/get-jupiter-quote.test.ts test/config-contracts.test.ts test/canonical-dispatch-solana.test.ts` → 4 files, 233 tests, all green.
- `npx tsc --noEmit` → zero errors.
- `grep -rn "lite-api.jup.ag\|api.jup.ag" src/ | grep -v jupiter.ts` → empty (host literals only in the client).
- `grep -rn "JUP6LkbZ…" src/ | grep -v contracts.ts` → empty (program ID only in the SOT).
- No test issues a live `fetch` or constructs a live `Connection` (file-scoped run ~4.4s).
