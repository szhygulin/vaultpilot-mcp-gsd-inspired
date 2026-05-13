---
phase: 06
plan: 01
slug: token-metadata-and-parse-amount-strict
status: complete
completed: 2026-05-13
requirements: [PREP-22]
---

# Phase 06 Plan 01 — parseAmountStrict + get_token_metadata + Fixture B literal anchor

## One-liner

Ships the two foundations Phase 6's three downstream signing plans (06-02 / 06-03 / 06-04) all consume: a strict pre-validation guard `parseAmountStrict` in `src/signing/amount.ts` that closes the 9 known `viem.parseUnits` weakness cases (especially silent fractional rounding — the off-by-decimal class CLAUDE.md flags as the most common user-facing bug), and a cache-first `get_token_metadata` MCP tool that resolves `decimals` / `symbol` / `name` for any Ethereum mainnet ERC-20. As a cross-cutting bonus, Fixture B in `test/signing-fingerprint.test.ts` migrates from a self-referencing `beforeAll`-snapshot to a hardcoded 0x literal — Phase 4 Fixture A/C discipline applied to B.

## Files shipped

### New source files (2)

- `src/signing/amount.ts` — `class InvalidAmountError extends Error` (carries `kind: "empty" | "format" | "fractional-overflow"`) + `function parseAmountStrict(amountStr: string, decimals: number): bigint`. Three-step gate: (1) empty/whitespace check, (2) strict regex `/^[0-9]+(\.[0-9]+)?$/`, (3) fractional-digit-count vs decimals. Delegates byte-identically to `viem.parseUnits` for accepted shapes. DF-2 LOCKED placement on the `src/signing/` shelf next to `payload-fingerprint.ts` / `presign-hash.ts` / `handle-store.ts`.

- `src/tools/get_token_metadata.ts` — MCP tool, registers `get_token_metadata`. Input schema: `chain` (string literal enum `["ethereum"]`) + `address` (regex-validated 0x-prefixed 40-hex). Cache-first lookup via `loadEthereumTokenRegistry()` (top-50 Ethereum; no RPC on common path); live RPC fallback on cache miss reads `decimals()` + `symbol()` + `name()` via `erc20Abi` in parallel. Returns `{ decimals, symbol, name, rpcDegraded? }`. INVALID_INPUT on shape failure; INTERNAL_ERROR with `rpcDegraded: true` on RPC throw. No demo-mode gate (public-metadata reads work in any mode — mirrors `get_token_balance` precedent).

### Modified source files (1)

- `src/tools/register-all.ts` — exactly +1 line: `import "./get_token_metadata.js";`. Placed adjacent to existing tool imports (next to `get_token_balance.js`). No re-ordering.

### New test files (2)

- `test/parse-amount-strict.test.ts` — 17 tests covering the empirical Topic 3 ladder:
  - **4 ACCEPTED cases** (delegation-invariant cross-check — `result === parseUnits(input, decimals)`):
    - case 1: `"100.5"` decimals=6 → 100_500_000n
    - case 2: `"1.123456"` decimals=6 → 1_123_456n (exact precision)
    - case 3: `"0"` decimals=18 → 0n
    - case 4: `"100"` decimals=6 → 100_000_000n (integer-only)
  - **2 REJECTED kind: "empty"** — `""`, `"   "`
  - **6 REJECTED kind: "format"** — `".5"` (leading dot), `"100."` (trailing dot), `"-1"` (negative), `"1e6"` (scientific), `"1,000"` (comma-grouped), `"abc"` (alpha) — plus `"1.2.3"` defense-in-depth
  - **3 REJECTED kind: "fractional-overflow"** — `"1.23456789"` against decimals=6 (the load-bearing T-PARSE-AMOUNT-1 mitigation), `"100.5"` decimals=0 (the silent-round case viem produces `101n` for), `"1.123…01"` against decimals=18 (21 fractional digits)
  - **1 InvalidAmountError shape check** — name + kind discriminator

- `test/get-token-metadata.test.ts` — 8 tests:
  - case 1: cache hit (USDC) → no RPC, returns registry decimals/symbol/name
  - case 2: cache hit with mixed-case input → checksum normalizes, same result
  - case 3: cache miss + live RPC → exactly 3 readContract calls
  - case 4: invalid address → INVALID_INPUT, no RPC
  - case 5: live RPC failure → INTERNAL_ERROR + rpcDegraded: true (T-RPC-METADATA-FAIL-1)
  - case 6: rpcDegraded bubbles through cache hit when fallback in use
  - invalid chain enum → INVALID_INPUT (defense-in-depth behind the schema)
  - register-all wiring smoke (`getRegisteredTool("get_token_metadata")` defined)

### Modified test files (1)

- `test/signing-fingerprint.test.ts` — Fixture B migration. Removed the `beforeAll(() => …)` block at lines 56-66 + the `let EXPECTED_ERC20_FINGERPRINT: Hex = "0x"` declaration. Replaced `expect(fp).toBe(EXPECTED_ERC20_FINGERPRINT)` (line 40) with `expect(fp).toBe("0x20fe784f2025af75b0f47cbb71c217c7c121caee89bb64a91b6419282348108c")`. Test name updated: `"Fixture B — ERC-20 transfer fingerprint (hardcoded literal anchor, Phase 6 hardened)"`. Fixture A unchanged. The literal was computed once at execute-time via `node -e "import('./dist/signing/payload-fingerprint.js')…"`; pinned forever — drift in the preimage assembly for non-empty `data` now breaks this assertion at PR-review time, not at Phase 6+ verify-phase.

## Test count

**354 passing (329 inherited + 25 net new), 0 failing.** Full suite runs in ~4.5s.

```
test/parse-amount-strict.test.ts   — 17 tests
test/get-token-metadata.test.ts    —  8 tests
test/signing-fingerprint.test.ts   —  3 tests (unchanged count; Fixture B replaced in place)
```

## Key decisions

### Fixture B literal pinned: `0x20fe784f2025af75b0f47cbb71c217c7c121caee89bb64a91b6419282348108c`

Computed via the in-tree `computePayloadFingerprint` against the documented ERC-20-shape inputs:

```
chainId   = 1
to        = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
valueWei  = 0n
data      = 0xa9059cbb000000000000000000000000000000000000000000000000000000000000dEAD0000000000000000000000000000000000000000000000000DE0B6B3A7640000
            (138-char standard ERC-20 transfer(0x…dEAD, 1e18) calldata)
```

This IS the value the previous `beforeAll`-snapshot was computing — byte-equivalent in behavior. The change is the regression mechanism, not the assertion content. Any future Phase that modifies `payload-fingerprint.ts`'s preimage assembly for non-empty `data` breaks this exact line. Phase 4 deferred this hardening to Phase 6 (research line 327); now landed.

### Three-kind discriminator on InvalidAmountError (not flat Error)

`InvalidAmountError.kind: "empty" | "format" | "fractional-overflow"` lets prepare_* tool handlers in 06-02/03/04 produce different user-facing messages without re-parsing `.message`. `"fractional-overflow"` is the singular load-bearing kind — it's the only weakness viem.parseUnits handles via SILENT ROUNDING rather than a thrown error, which is why the project CLAUDE.md "Decimal-aware arithmetic" rule names off-by-decimal as the most common user-facing bug class.

### `chain` parameter shipped as string literal enum, not free string

`{ type: "string", enum: ["ethereum"] }` instead of `{ type: "string" }` — Phase 8 widens the enum (Solana / TRON / BTC), so the schema-level enum constraint avoids a contract-break revisit when Phase 8 lands. Downside: 06-01 ships ethereum-only, but the JSON-schema enum makes that explicit at the MCP boundary. Defense-in-depth: the handler also runs an explicit `chainRaw !== "ethereum"` check that returns INVALID_INPUT — covers a schema-bypass call path (e.g. `getRegisteredTool().handler({...})` direct invocation in tests).

### Cache-first, live RPC on miss — no demo-mode gate

Public-metadata reads work against PublicNode in any mode; the demo-mode gate adds no value here and mismatches `get_token_balance`'s precedent. The threat-model § T-METADATA-DRIFT-1 documents that an off-list malicious clone returns its own `symbol()` via live RPC — accepted residual because the cryptographic-binding pipeline pins the address byte-for-byte via `payloadFingerprint` and the user sees the address on the Ledger screen (PREPARE RECEIPT). Companion preflight skill (v1.3) closes the labeling concern out-of-band.

## FROZEN-area zero-diff confirmation

```
$ git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts | wc -l
0
```

The cryptographic-binding chain is untouched. Only net-new module added to `src/signing/` in this plan is `src/signing/amount.ts`.

## Deviations from plan

**None.** The plan's `<interfaces>` block locked the call surfaces; the installed `viem@2.48.11` matched the `parseUnits` / `erc20Abi` / `getAddress` / `isAddress` signatures as named; the `loadEthereumTokenRegistry` + `getEthereumClient` + `isPublicNodeFallback` exports matched the plan's documented contracts. The Fixture B literal `0x20fe784f...` was computed via the exact node-eval recipe in the plan's § Interfaces.

One small textual choice: the plan's `<verify>` block runs `grep -c "beforeAll" test/signing-fingerprint.test.ts` and expects 0. The Fixture B replacement comment originally referenced `(beforeAll-snapshot) anti-pattern` as the named anti-pattern; this would have left grep counting 1. Reworded to `(self-referencing-snapshot) anti-pattern` to keep both the verify gate and the documentary purpose. Not a deviation — a textual-comment substitution preserving exact meaning.

## Test counts (before/after)

| Stage | Test files | Tests |
|---|---:|---:|
| Pre-plan (origin/main HEAD = aa3157a) | 39 | 329 |
| Post-plan (HEAD = 7ef4cd7) | 41 | 354 |
| Net new | +2 | +25 |

## Commit

```
7ef4cd7 feat(06-01): parseAmountStrict + get_token_metadata + Fixture B literal anchor
```

Single atomic commit per the Phase 4/5 cadence. 6 files changed, 631 insertions(+), 19 deletions(-).

## Self-Check: PASSED

All files exist at the expected paths; the commit `7ef4cd7` is present on `feat/06-01-token-metadata-and-parse-amount-strict`; `npm run typecheck` + `npm run build` + `npm test` all green; FROZEN-area zero-diff verified.
