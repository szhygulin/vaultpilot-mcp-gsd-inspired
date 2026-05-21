---
phase: 22-btc-scaffolding-esplora-usb-hid-persistent-accounts
plan: 03
subsystem: chain-shelf
tags: [bitcoin, esplora, bip32, bip84, bip86, taproot, segwit, xpub, gap-limit, mcp-tools]

requires:
  - phase: 22-01
    provides: Esplora HTTP client (5-arm union, never-throws), BTC address types + branded segwit/taproot, BalanceReport + UtxoRow types
  - phase: 22-02
    provides: non-EVM account store extension (multi-record-per-chain), pair_btc_ledger persisting segwit + taproot records
provides:
  - get_btc_balance (single-address BalanceReport via Esplora; bech32/bech32m)
  - get_btc_balances (parallel segwit + taproot via Promise.allSettled; defaults to paired wallet)
  - get_btc_account_balance (xpub gap-limit-respecting scan; BIP-84 zpub + BIP-86 xpub; 5min TTL cache)
  - get_btc_tx_history (paginated tx history via Esplora :last_seen_txid cursor; stripped-down per-row shape)
  - get_btc_fee_estimates (Esplora /fee-estimates → 5-key {1,2,3,6,144} sat/vB projection per ROADMAP SC#7)
  - src/chains/bitcoin/xpub-scan.ts greenfield: gap-limit-20 termination on combined chain+mempool tx_count, concurrency-5 batched fetches, per-(xpub, scriptType) TTL cache
affects: [phase-23-btc-prepare-send, phase-23-coin-selection, phase-24-btc-tx-detail, phase-27-btc-portfolio-summary]

tech-stack:
  added: [bip32@^5.0.1, bs58check@^4.0.0]
  patterns:
    - "BIP-32 deterministic-derivation hardcoded literal anchors (extends CLAUDE.md cryptographic-binding-fixture convention to xpub→address fixtures)"
    - "BIP-84 zpub → xpub version-byte swap via bs58check (transparent normalization; same derivation tree)"
    - "Gap-limit termination on COMBINED chain_stats.tx_count + mempool_stats.tx_count (RESEARCH § Plan 22-03 risks)"
    - "Concurrency-capped batched fetch (5 parallel) — rate-limit defense for public Esplora"
    - "5-arm union pattern-match in MCP tools (NEVER try/catch — esplora-client never throws)"

key-files:
  created:
    - src/chains/bitcoin/xpub-scan.ts (gap-limit scanner; BIP-84 zpub support; greenfield)
    - src/tools/get_btc_balance.ts (single-address BalanceReport)
    - src/tools/get_btc_balances.ts (parallel segwit + taproot)
    - src/tools/get_btc_account_balance.ts (xpub aggregator)
    - src/tools/get_btc_tx_history.ts (paginated tx list)
    - src/tools/get_btc_fee_estimates.ts (24-key → 5-key projection)
    - test/chains-bitcoin-xpub-scan.test.ts (14 tests; BIP-32 Test Vector anchors)
    - test/get-btc-balance.test.ts (8 tests)
    - test/get-btc-balances.test.ts (6 tests)
    - test/get-btc-account-balance.test.ts (7 tests)
    - test/get-btc-tx-history.test.ts (7 tests)
    - test/get-btc-fee-estimates.test.ts (5 tests)
  modified:
    - src/tools/register-all.ts (5 additive imports; mirrors Phase 17 TRON additive style)
    - package.json + package-lock.json (added bip32 + bs58check direct deps)

key-decisions:
  - "Adopted bip32@^5.0.1 (BIP32Factory pattern) over @scure/bip32 — the plan's prescribed call surface uses `bip32.fromBase58(...).derive(0).derive(i)`; bip32 is the canonical bitcoinjs-supplied wrapper. tiny-secp256k1 was already a direct dep."
  - "Added bs58check@^4.0.0 as a direct dep (was transitive at v2.1.2; pinned at v4 for stability) — needed for zpub→xpub version-byte swap since bip32@5 rejects non-xpub mainnet prefixes."
  - "Combined chain+mempool tx_count for gap-limit termination — addresses with mempool-only pending receives are correctly classified as in-use (not empty). RESEARCH § Plan 22-03 risks anchor."
  - "Hardcoded address literals NOT beforeAll-snapshot in xpub-scan tests — drift in bitcoinjs-lib payment helpers (p2wpkh, p2tr) fails at a specific line. Extends CLAUDE.md cryptographic-binding-fixture convention to deterministic-derivation outputs (PATTERNS Meta-Decision 3)."
  - "BIP-44 gap-limit termination invariant tested at exact boundary: 20 consecutive empties = stop (not 19, not 21). 'Active address at i=21' test rewritten to 'active at i=20 after 19-empty run' — the original phrasing (active at i=21 after 20 empties) contradicted the BIP-44 standard."

patterns-established:
  - "Per-tool commit cadence within a multi-tool task: 5 incremental commits (one per tool) + final commit folds in remaining wiring. Each per-tool commit included its register-all line additively."
  - "Schema-level base58 prefix gate (^(xpub|zpub)[1-9A-HJ-NP-Za-km-z]{107}$, total 111 chars) + structured INVALID_XPUB envelope wrapping bip32.fromBase58 throws."
  - "Promise.allSettled fan-out for multi-address tools (segwit + taproot, or future LTC + LTC-shielded) — one-side failure does NOT collapse the call. Per-slot kind reflects per-side state."

requirements-completed: [BTC-READ-01, BTC-READ-02, BTC-READ-03, BTC-READ-04, BTC-READ-05]

duration: 14min
completed: 2026-05-21
---

# Phase 22 Plan 22-03: Esplora-Backed BTC Read Tools + xpub Gap-Limit Scanner Summary

**5 MCP read tools (balance, balances, account-balance, tx-history, fee-estimates) + greenfield xpub-scan with BIP-32 Test Vector deterministic anchor — UTXO-shape BalanceReport flows through to Phase 23 coin-selection without refactor.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-05-21T09:10:00Z (approx — first commit at 09:12:25)
- **Completed:** 2026-05-21T09:24:31Z (final commit timestamp)
- **Tasks:** 2 (1 + 1; Task 2 shipped as 5 incremental commits)
- **Commits:** 7 (1 RED test + 1 GREEN impl for xpub-scan; 5 per-tool feat commits)
- **Files created:** 11 (1 chain-shelf module + 5 MCP tools + 6 test files including xpub-scan)
- **Files modified:** 3 (register-all.ts; package.json + package-lock.json)
- **Tests added:** 47 (14 xpub-scan + 8 balance + 6 balances + 7 account-balance + 7 tx-history + 5 fee-estimates)

## Accomplishments

- **`xpub-scan.ts` greenfield** — BIP-32 Test Vector deterministic anchor (10 hardcoded literals across BIP-84 + BIP-86 spec xpubs), gap-limit-20 termination on combined chain+mempool tx_count, concurrency-cap-5 batched fetches, per-(xpub, scriptType) TTL cache 5min. BIP-84 zpub transparently normalized to xpub via bs58check version-byte swap.
- **5 MCP read tools** registered + tested — all pattern-match on the 5-arm Esplora client union (NEVER try/catch). Decimal-string bigint boundary preserved (CLAUDE.md decimal-aware). UTXO-shape BalanceReport from `get_btc_balance` + `get_btc_balances` is the load-bearing surface for Phase 23 coin-selection (zero refactor needed).
- **xpub-scan caching** — second scan within TTL returns cached result without re-fetching Esplora; cache reset after TTL or via `_resetXpubScanCacheForTesting`.
- **Fee-estimate projection** — Esplora's 24-key `/fee-estimates` projected to canonical 5-key `{1,2,3,6,144}` sat/vB shape per ROADMAP SC#7. Anti-pattern guard: NEVER hits mempool.space's proprietary `/v1/fees/recommended`.
- **Schema-level INVALID_XPUB envelope** — `^(xpub|zpub)[1-9A-HJ-NP-Za-km-z]{107}$` (111 chars total) regex catches base58 prefix mismatches at the schema layer; `bip32.fromBase58` throws (bad checksum) caught by tool-boundary try/catch → structured `INVALID_XPUB` envelope (5-arm convention).

## Task Commits

1. **Task 1 RED — failing tests for xpub-scan** — `9d68904` (test)
2. **Task 1 GREEN — xpub-scan implementation** — `eded3bc` (feat)
3. **Task 2.1 — get_btc_balance** — `be60b5b` (feat)
4. **Task 2.2 — get_btc_balances** — `b52c531` (feat)
5. **Task 2.3 — get_btc_account_balance** — `b3b27d1` (feat)
6. **Task 2.4 — get_btc_tx_history** — `1adba10` (feat)
7. **Task 2.5 — get_btc_fee_estimates + finalize register-all** — `d047d7c` (feat)

## Files Created/Modified

### Created
- `src/chains/bitcoin/xpub-scan.ts` — Gap-limit-respecting xpub scanner (greenfield; no in-tree analog). Exports `scanXpub`, `BIP44_GAP_LIMIT=20`, `SCAN_CONCURRENCY=5`, `SCAN_TTL_MS=5min`, `_resetXpubScanCacheForTesting`.
- `src/tools/get_btc_balance.ts` — Single-address BalanceReport via `fetchAddressInfo` + `fetchAddressUtxos` (Esplora 5-arm union).
- `src/tools/get_btc_balances.ts` — 4-call Promise.allSettled fan-out (segwit + taproot info + utxos); defaults to paired-wallet from `listAccounts({ chainFilter: "bitcoin" })`.
- `src/tools/get_btc_account_balance.ts` — Wraps `scanXpub`; schema base58 prefix gate + INVALID_XPUB envelope around `bip32.fromBase58` throw.
- `src/tools/get_btc_tx_history.ts` — Paginated tx list via Esplora `:last_seen_txid` cursor; stripped-down `{ txid, blockHeight?, confirmedAt?, fee }` per row.
- `src/tools/get_btc_fee_estimates.ts` — 24-key → 5-key projection with missing-key guard.
- `test/chains-bitcoin-xpub-scan.test.ts` — 14 tests (BIP-32 anchors + gap-limit boundary + concurrency cap + TTL cache).
- `test/get-btc-balance.test.ts` — 8 tests.
- `test/get-btc-balances.test.ts` — 6 tests (incl. parallel wall-time assertion).
- `test/get-btc-account-balance.test.ts` — 7 tests.
- `test/get-btc-tx-history.test.ts` — 7 tests.
- `test/get-btc-fee-estimates.test.ts` — 5 tests.

### Modified
- `src/tools/register-all.ts` — 5 additive imports below `pair_btc_ledger` line; preserves Phase 17 TRON additive style; verified via `grep -c 'import "./get_btc_' = 5`.
- `package.json` + `package-lock.json` — `bip32@^5.0.1` + `bs58check@^4.0.0` direct deps.

## BIP-32 Test Vector 1 Anchor (regression reference)

The hardcoded literal anchors below originate from the BIP-39 mnemonic `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about` (canonical BIP-39 zero-seed test vector, referenced in BIP-84 + BIP-86 specs). Drift in bitcoinjs-lib's derivation OR in the payment helpers (p2wpkh, p2tr) will fail at a specific line — NOT against a self-snapshot.

**BIP-84 segwit account-level zpub** (path `m/84'/0'/0'`, BIP-84 spec Test Vector 1):
```
zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs
```

Expected first 5 `bc1q…` addresses at `m/0/i` for i=0..4 (after zpub→xpub version-byte swap):
- i=0: `bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu`
- i=1: `bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g`
- i=2: `bc1qp59yckz4ae5c4efgw2s5wfyvrz0ala7rgvuz8z`
- i=3: `bc1qgl5vlg0zdl7yvprgxj9fevsc6q6x5dmcyk3cn3`
- i=4: `bc1qm97vqzgj934vnaq9s53ynkyf9dgr05rargr04n`

**BIP-86 taproot account-level xpub** (path `m/86'/0'/0'`, BIP-86 spec Test Vector 1):
```
xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ
```

Expected first 5 `bc1p…` addresses at `m/0/i` for i=0..4 (taproot internal pubkey = compressed pubkey bytes [1..33]):
- i=0: `bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr` (BIP-86 spec directly)
- i=1: `bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh`
- i=2: `bc1p0d0rhyynq0awa9m8cqrcr8f5nxqx3aw29w4ru5u9my3h0sfygnzs9khxz8`
- i=3: `bc1py0vryk8aqusz65yzuudypggvswzkcpwtau8q0sjm0stctwup0xlqkkxler`
- i=4: `bc1pjpp8nwqvhkx6kdna6vpujdqglvz2304twfd308ve5ppyxpmcjufs7k6xyr`

## FROZEN-Area Zero-Diff Confirmation

Verified byte-identical against base commit `a681903`:
- `src/chains/bitcoin/registry.ts` — byte-identical (Plan 22-01)
- `src/chains/bitcoin/esplora-client.ts` — byte-identical (Plan 22-01)
- `src/chains/bitcoin/types.ts` — byte-identical (Plan 22-01)
- `src/wallet/non-evm-account-store.ts` — byte-identical (Plan 22-02 dual-record support inherited; no changes needed)
- `src/wallet/ledger-btc-transport.ts` — byte-identical (Plan 22-02)
- `src/tools/pair_btc_ledger.ts` — byte-identical (Plan 22-02)
- `src/chains/solana/*` + `src/chains/tron/*` — byte-identical (sampled sol-rpc-client, tron registry, tron-rpc-client)

The only modified pre-existing files are `src/tools/register-all.ts` (5 additive imports), `package.json`, and `package-lock.json` (dep additions).

## Decisions Made

- **`bip32@^5.0.1` over `@scure/bip32`**: The plan's prescribed call surface (`bip32.fromBase58(xpub).derive(0).derive(i)`) matches the bitcoinjs-supplied `bip32` package's `BIP32Interface`. `@scure/bip32` exposes a different API surface (`HDKey.fromExtendedKey` + `deriveChild`). Choosing `bip32` keeps the call surface aligned with the bitcoinjs-lib ecosystem; `tiny-secp256k1` was already a direct dep (used by `types.ts:initEccLib`).
- **`bs58check@^4.0.0` as direct dep**: zpub→xpub normalization requires bs58check decode + version-swap + encode. The transitive `bs58check@2.1.2` already in `node_modules` is from another lib's tree; pinning a direct dep at v4 (the version bitcoinjs-lib itself uses) keeps the API surface stable across future dep upgrades.
- **Gap-limit termination on COMBINED tx_count**: `fetchAddressInfo` already sums `chain_stats.tx_count + mempool_stats.tx_count` into a single `txCount` field. The scanner checks `txCount > 0` for "in use" — addresses with mempool-only pending receives are correctly classified as in-use (NOT empty, which would prematurely advance the gap-limit counter).
- **Hardcoded literal anchors** (NOT `beforeAll`-snapshot): Per CLAUDE.md cryptographic-binding-fixture convention extended to deterministic xpub→address derivations (PATTERNS Meta-Decision 3). Drift in `bitcoinjs-lib`'s payment helpers or in `bip32` derivation fails at a specific test line, NOT against a value snapshotted from the same library at run time.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing `bip32` package**
- **Found during:** Task 1 RED (test imports `BIP32Factory` from "bip32")
- **Issue:** `bip32` package not in `package.json` despite plan calling for `BIP32Factory(ecc)` pattern. `@scure/bip32` was available transitively but exposes a different API.
- **Fix:** `npm install bip32@^5.0.1 bs58check@^4.0.0 --save` — both added as direct deps. `tiny-secp256k1` was already direct.
- **Files modified:** `package.json`, `package-lock.json`
- **Verification:** RED test imports resolve; GREEN implementation derives canonical BIP-86 Test Vector 1 address verbatim.
- **Committed in:** `9d68904` (Task 1 RED commit)

**2. [Rule 1 - Bug] Test for "scan continues to i=21 when active address at i=21" contradicted BIP-44 standard**
- **Found during:** Task 1 GREEN (verifying RED→GREEN transition)
- **Issue:** Original test asserted scan continues past 20 empties to discover i=21. BIP-44 says scan STOPS at 20 consecutive empties — by construction, i=21 is never fetched if i=1..20 are all empty.
- **Fix:** Rewrote test to assert the actually-valid invariant: 19 empties in a row does NOT terminate; the scan reaches i=20 and finds the active address there. Same Pitfall 4 defense (counter only resets on in-use, never on first-empty); cleaner boundary.
- **Files modified:** `test/chains-bitcoin-xpub-scan.test.ts`
- **Verification:** All 14 xpub-scan tests green; gap-limit-boundary test (exactly 20 fetches on 20 empties) still anchors the BIP-44 termination invariant.
- **Committed in:** `eded3bc` (Task 1 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 blocking dep install, 1 test mis-specification)
**Impact on plan:** Both auto-fixes essential for plan execution. No scope creep — added deps are minimal and pinned to bitcoinjs ecosystem versions; test correction tightens (not loosens) the BIP-44 invariant.

## Issues Encountered

- **`bip32` package vs `@scure/bip32` ambiguity**: Plan's `import { BIP32Factory } from "bip32"` was unambiguous on inspection, but the installed transitives included `@scure/bip32` (different API). Resolved by adding `bip32@^5.0.1` as a direct dep — the canonical bitcoinjs choice.
- **bs58check ESM/CJS interop**: bs58check@4 is `"type": "module"` with a default export. Added an interop shim in `xpub-scan.ts` (`const bs58check = bs58checkModule.default ?? bs58checkModule`) to handle both shapes — same pattern used elsewhere in the codebase for `@ledgerhq/hw-transport-node-hid`.

## Self-Check: PASSED

All claimed files exist:
- `src/chains/bitcoin/xpub-scan.ts` — FOUND
- `src/tools/get_btc_balance.ts` — FOUND
- `src/tools/get_btc_balances.ts` — FOUND
- `src/tools/get_btc_account_balance.ts` — FOUND
- `src/tools/get_btc_tx_history.ts` — FOUND
- `src/tools/get_btc_fee_estimates.ts` — FOUND
- 6 test files — all FOUND

All claimed commits exist:
- `9d68904`, `eded3bc`, `be60b5b`, `b52c531`, `b3b27d1`, `1adba10`, `d047d7c` — all FOUND in git log

Acceptance criteria verified:
- `BIP44_GAP_LIMIT === 20`, `SCAN_CONCURRENCY === 5`, `SCAN_TTL_MS === 5 * 60 * 1000` — all match
- `grep "chain_stats.tx_count + mempool_stats.tx_count" src/chains/bitcoin/xpub-scan.ts` — 1 match (combined-count termination doc)
- `grep "20 consecutive" src/chains/bitcoin/xpub-scan.ts` — 1 match (anti-pattern comment)
- `grep -E "\"bc1[qp]" test/chains-bitcoin-xpub-scan.test.ts` — 11 matches (10 derived + 1 in BIP-86 spec assertion)
- `grep -c 'import "./get_btc_' src/tools/register-all.ts` — 5 (all 5 BTC read tools registered)
- `grep -rE "Psbt" src/chains/bitcoin/ src/tools/get_btc_*.ts` — 0 matches (Phase 22 anti-pattern enforced)
- `grep -c "result.kind ===" src/tools/get_btc_*.ts` — multiple matches (4/5 tools; `get_btc_account_balance` wraps `scanXpub` which has no union return)
- `grep -c "try.*await fetchAddress" src/tools/get_btc_*.ts` — 0 (no try/catch on never-throws client)
- Test suite: 2613 tests pass (47 new), 1 skipped, 0 failures
- `tsc --noEmit` — clean

## Next Phase Readiness

- BTC read surface complete (5 tools); UTXO-shape BalanceReport flows through to Phase 23 coin-selection without refactor.
- Phase 22 Plan 22-04 is next: `get_btc_status` + `get_vaultpilot_config_status` BTC surfacing + BTC whale persona. No blockers — frozen-area zero-diff preserved through this plan.
- Phase 23 (BTC prepare/send) will introduce `Psbt` imports for the first time; the no-Psbt grep gate established here remains valid for the Phase 22 closure but is intentionally rescinded at Phase 23.

---
*Phase: 22-btc-scaffolding-esplora-usb-hid-persistent-accounts*
*Completed: 2026-05-21*
