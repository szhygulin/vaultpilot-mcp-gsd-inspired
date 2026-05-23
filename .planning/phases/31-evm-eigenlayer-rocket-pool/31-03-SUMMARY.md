---
phase: 31-evm-eigenlayer-rocket-pool
plan: 03
subsystem: rocket-pool
tags:
  - rocket-pool
  - prepare-tool
  - read-tool
  - ledger-notice
  - selector-collision
  - fixture-AA-RP
  - fixture-AB-RP
  - integration-test
  - v2.3-close-out

requires:
  - phase: 31-evm-eigenlayer-rocket-pool
    plan: 01
    provides: "Rocket Pool per-chain SOT (RocketDepositPool + rETH + RocketDAOProtocolSettingsDeposit) + 3 SOT getters + ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI constant + 3 KNOWN_SPENDERS_ETHEREUM rows + Rocket Pool entries in CANONICAL_DISPATCH_TARGETS[1]"
  - phase: 31-evm-eigenlayer-rocket-pool
    plan: 02
    provides: "Plan 31-02 EigenLayer prepare tool + LEDGER NOTICE template precedent (D-13 — first absent-from-ERC-7730 multi-method protocol since Phase 6 WETH unwrap); buildEigenLayerDecodedArgsBlock + EigenLayerDecoded shape for preview_send extension; Fixture Z hardcoded literal anchor"
  - phase: 6-erc20
    provides: "LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE shape that D-13 mirrors; prepare_weth_unwrap.ts single-arg burn analog for prepare_rocketpool_unstake"
  - phase: 30-lido-stake-unstake-wrap-unwrap
    provides: "prepare_lido_stake.ts value-bearing analog for prepare_rocketpool_stake; get_lido_positions.ts read-tool analog (narrowed to Ethereum-only); src/chains/lido.ts per-chain read service shape"

provides:
  - "src/protocols/rocketpool.ts — 3 ABI fragments + ROCKETPOOL_SELECTORS table + 2 encoders + spy-affordance + 2 Pitfall-DOCUMENTATION constants"
  - "src/signing/rocketpool-rate.ts — RETH_SCALE + computeEthEquivalent pure-bigint math + _rocketPoolRate spy-affordance (NO approx flag — contrast with Lido)"
  - "src/chains/rocketpool.ts — readEthereumPositions Promise.all-fan-out + _rocketPoolChains spy-affordance"
  - "src/tools/get_rocketpool_positions.ts — MCP tool (RP-01) — Ethereum-only"
  - "src/tools/prepare_rocketpool_stake.ts — MCP tool (RP-02 stake) with D-07 minimum-deposit pre-flight + D-13 LEDGER NOTICE"
  - "src/tools/prepare_rocketpool_unstake.ts — MCP tool (RP-02 unstake) with D-08 deposit-pool-liquidity pre-flight + D-13 LEDGER NOTICE"
  - "src/signing/blocks.ts APPEND-ONLY: LEDGER_NOTICE_ROCKETPOOL_TEMPLATE (SHARED stake+unstake) + 2 PREPARE RECEIPT + 2 DECODED ARGS templates + RocketPoolDecoded discriminated union + buildRocketPoolDecodedArgsBlock"
  - "src/tools/preview_send.ts: (tx.to, selector) tuple-dispatch extension for EigenLayer + Rocket Pool — Pitfall 1 + Pitfall 2 mitigated at the DECODED ARGS dispatch layer"
  - "Fixture AA-RP hardcoded payloadFingerprint literal — 0x615683fb4b0cf540d1e5ba8f12c0766e542825557f769e60e83aa2cc76be0ca3"
  - "Fixture AB-RP hardcoded payloadFingerprint literal — 0xd12144239fb353612c20a3aa0a9dbcd9dd73de4141e1adce866ecf0974854edc"
  - "src/tools/register-all.ts — 3 new side-effect imports (get_rocketpool_positions + prepare_rocketpool_stake + prepare_rocketpool_unstake)"
  - "SECURITY.md §6 — v2.3 milestone close-out summary section per D-15 (6 subsections)"

affects:
  - "preview_send DECODED ARGS dispatch layer (Pitfall 1 + Pitfall 2 mitigation)"
  - "send_transaction blind-sign path (LEDGER NOTICE re-emitted at preview/send time for both stake + unstake)"
  - "Future v2.x: Rocket Pool node-operator minipool flows, rETH cross-chain bridges, ERC-7730 metadata submission — Phase 31 ships stake + burn only"

tech-stack:
  added: []
  patterns:
    - "(tx.to, selector) tuple-dispatch in preview_send (NEW v2.3 — Pitfall 1 + Pitfall 2 mitigations). Allowlist Set stays selector-blind; disambiguation lives at the DECODED ARGS dispatch layer."
    - "SHARED LEDGER NOTICE template between stake + unstake (D-13 symmetric blind-sign UX). Mirror of the asymmetric LEDGER NOTICE pattern (Compound emits, Lido doesn't, WETH withdraw emits, EigenLayer emits) — Rocket Pool emits for both stake AND unstake from the SAME template."
    - "On-chain read with hardcoded-constant fallback (D-07 minimum-deposit pre-flight). Try `getMinimumDeposit()` live; on RPC failure, fall back to `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI = 0.01 ETH`. CHECKS PERFORMED block labels the source (`rpc` vs `fallback`) so the user knows which path fired."
    - "Cross-protocol selector collision DOCUMENTATION in test (`test/protocols-rocketpool.test.ts` asserts `WETH9_SELECTORS.deposit === ROCKETPOOL_SELECTORS.deposit`; `toFunctionSelector('function burn(uint256)') === ROCKETPOOL_SELECTORS.burn`). Forward-compat: future contributor cannot accidentally remove the tuple dispatch."
    - "Hardcoded fixture-fingerprint disambiguation suffix (`Fixture AA-RP` / `Fixture AB-RP`) — avoids name clash with pre-existing BTC LiFi `Fixture AA` describe block (Phase 26 Plan 26-03). Documented in fixture comments + this SUMMARY."

key-files:
  created:
    - "src/protocols/rocketpool.ts (241 lines) — protocol decoder"
    - "src/signing/rocketpool-rate.ts (100 lines) — pure-bigint helper"
    - "src/chains/rocketpool.ts (120 lines) — Ethereum read service"
    - "src/tools/get_rocketpool_positions.ts (176 lines) — MCP read tool (RP-01)"
    - "src/tools/prepare_rocketpool_stake.ts (306 lines) — MCP write tool (RP-02 stake)"
    - "src/tools/prepare_rocketpool_unstake.ts (330 lines) — MCP write tool (RP-02 unstake)"
    - "test/protocols-rocketpool.test.ts (148 lines / 13 tests)"
    - "test/signing-rocketpool-rate.test.ts (91 lines / 8 tests)"
    - "test/get-rocketpool-positions.test.ts (163 lines / 6 tests)"
    - "test/prepare-rocketpool-stake.test.ts (341 lines / 10 tests)"
    - "test/prepare-rocketpool-unstake.test.ts (309 lines / 9 tests)"
    - "test/preview-send.rocketpool.test.ts (319 lines / 5 tests)"
    - "test/integration-eigenlayer-rocketpool.test.ts (404 lines / 7 tests)"
  modified:
    - "src/signing/blocks.ts (+158 lines) — Phase 31 Plan 31-03 APPEND-ONLY Rocket Pool templates"
    - "src/tools/preview_send.ts (+149 / -4 lines) — (tx.to, selector) tuple-dispatch extension for EigenLayer + Rocket Pool"
    - "src/tools/register-all.ts (+3 lines) — 3 new side-effect imports"
    - "test/signing-fingerprint.test.ts (+82 lines) — Fixture AA-RP + Fixture AB-RP hardcoded literal anchors"
    - "SECURITY.md (+59 / -0 lines) — v2.3 milestone close-out summary section"

key-decisions:
  - "D-13 SHARED LEDGER NOTICE template — `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE` is the SAME template constant emitted by `prepare_rocketpool_stake`, `prepare_rocketpool_unstake`, AND both `preview_send` Rocket Pool arms. Symmetric blind-sign UX (D-13). Format-fanout-sentinel: the verbatim 10-line body lives ONLY in the template constant; emitters reference by name."
  - "Pitfall 1 + Pitfall 2 mitigation lives at preview_send DECODED ARGS dispatch — NOT at the canonical-dispatch allowlist Set. The Set stays selector-blind by design (both addresses live in CANONICAL_DISPATCH_TARGETS[1] independently). The (tx.to, selector) tuple branch is the consumer-side disambiguation. Documented in `src/protocols/rocketpool.ts` source comments + test/protocols-rocketpool.test.ts assertions."
  - "Fixture name disambiguation `-RP` suffix — `Fixture AA` was ALREADY used in `test/signing-fingerprint.test.ts` for the Phase 26 Plan 26-03 BTC LiFi PSBT fingerprint. The plan called for `Fixture AA + AB` for Rocket Pool. Resolution: use `Fixture AA-RP` and `Fixture AB-RP` to avoid the name collision while preserving the spirit of the plan. Documented inline in both fixture blocks AND cross-link comments in `test/prepare-rocketpool-stake.test.ts` + `test/prepare-rocketpool-unstake.test.ts` + `test/integration-eigenlayer-rocketpool.test.ts`. The BTC LiFi `Fixture AA` and the Rocket Pool `Fixture AA-RP` test different functions (`computeBtcLifiPayloadFingerprint` vs `computePayloadFingerprint`) in different describe blocks — code is unambiguous; the suffix is purely a human-readability disambiguator."
  - "D-07 minimum-deposit fallback strategy — try live read `RocketDAOProtocolSettingsDeposit.getMinimumDeposit()` FIRST; on RPC failure catch + fall back to `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI = 0.01 ETH`. CHECKS PERFORMED block labels the source explicitly (`rpc` vs `fallback`) — surfaces to the agent + user which path fired. T-ROCKETPOOL-MIN-FALLBACK-DRIFT accepted residual: if Rocket Pool governance changes the on-chain minimum AND RPC fails, the constant may misfire; documented in SECURITY.md §6 v2.3 close-out."
  - "D-08 deposit-pool-liquidity pre-flight = Promise.all([RocketDepositPool.getBalance, rETH.getEthValue(rethAmount)]). Pool-empty refusal verbatim names Uniswap V3 / Curve as the DEX-swap fallback per RESEARCH § Topic 7 lines 842-848. Pitfall 5 race window (pool may drain between prepare and send) documented in CHECKS PERFORMED + accepted as residual T-ROCKETPOOL-LIQUIDITY-RACE — on-chain `require(ethBalance >= ethAmount)` is the backstop revert."
  - "register-all wiring DEFERRED from Task 1 Step 7 to Task 2 (plan-sanctioned alternative; explicitly named in Plan 31-02 Task 1 Step 7 deviation comment as the canonical pattern). The plan's Step 7 says to wire imports in Task 1; empirically vitest fails synchronously at import resolution if a register-all line references a non-existent file (encountered + documented in Plan 31-02 SUMMARY). Plan 31-03 applies the same deviation by default to keep every per-task commit's vitest suite green. Task 2 wires all 3 imports together at the moment all 3 tools exist."
  - "Fixture AA-RP + AB-RP literals computed at write-time via a one-shot Node script (cross-checked against the Fixture Z literal — same script reproduces 0x2c36a77f...658684 for the StrategyManager.depositIntoStrategy preimage). Pinned forever per CLAUDE.md 'NO beforeAll-snapshot' rule. Drift in preimage assembly OR encoder output OR SOT address fails at THIS exact line."
  - "preview_send tuple-dispatch insertion site = AFTER Lido's selector dispatch (continues the 5-tier ladder Plan 30-03 established). Adds two new branches: `else if (sel === EIGENLAYER_SELECTORS.depositIntoStrategy)` and the two Rocket Pool arms. Each arm DEFENSIVELY checks `tx.to === SOT-address` before populating its discriminated-union variable — defense against an unrelated contract with a colliding selector. Decoded-args block selection ternary chain + LEDGER NOTICE selection + `decodedArgsForJson` serialization + `ledgerNotice` structuredContent tag all extended in parallel."
  - "SECURITY.md v2.3 close-out follows Phase 21 v2.1 close-out template (6 subsections: scope + Milestone PRs + Trust-shape recap + Clear-sign coverage gap + Accepted residual risks + Phase 31 threat register summary). Milestone PRs cite Phase 28 (#82/#86/#90/#94/#95), Phase 29 (#118/#135), Phase 30 (#137/#141), Phase 31 (this PR) — extracted from `git log --all --oneline` matching against the per-feat-PR pattern. Clear-sign coverage gap is the NEW subsection for v2.3 — explicit covered/NOT-covered matrix per protocol + selector."

metrics:
  duration: "~22min"
  completed: "2026-05-23"

requirements-completed:
  - RP-01
  - RP-02
---

# Phase 31 Plan 31-03: Rocket Pool reads + stake + unstake + v2.3 close-out — Summary

**Ethereum-mainnet-only Rocket Pool half: per-account read tool (`get_rocketpool_positions`) + ETH→rETH stake (`prepare_rocketpool_stake`) + rETH→ETH burn unstake (`prepare_rocketpool_unstake`) with D-07 minimum-deposit pre-flight + on-chain-read-with-fallback resilience, D-08 deposit-pool-liquidity pre-flight, D-13 SHARED LEDGER NOTICE template across stake + unstake (symmetric blind-sign UX), `(tx.to, selector)` tuple-dispatch in `preview_send` mitigating Pitfall 1 (WETH9.deposit collision) + Pitfall 2 (generic OZ ERC20Burnable collision), Fixtures AA-RP + AB-RP cryptographic-binding anchors, persona-cycle byte-identity integration test across Fixtures Z + AA-RP + AB-RP, and the v2.3 EVM lending + staking milestone close-out summary section in SECURITY.md §6 covering Phases 28 + 29 + 30 + 31.**

## Performance

- **Duration:** ~22 min
- **Tasks:** 3 of 3 completed atomically (one commit per task)
- **Files created:** 13 (6 src/ + 7 test/)
- **Files modified:** 5 (`src/signing/blocks.ts` +158, `src/tools/preview_send.ts` +149/-4, `src/tools/register-all.ts` +3, `test/signing-fingerprint.test.ts` +82, `SECURITY.md` +59)
- **Test count delta:** 3623 (post-31-02) → 3683 (+60 net tests)

## Accomplishments

- **Protocol decoder:** `src/protocols/rocketpool.ts` (241 lines) ships 3 viem `parseAbi` fragments (ROCKET_DEPOSIT_POOL_ABI / RETH_ABI / ROCKET_SETTINGS_DEPOSIT_ABI) + `ROCKETPOOL_SELECTORS` table with 2 hardcoded `Hex` literals (deposit=`0xd0e30db0` with verbose Pitfall 1 collision-warning JSDoc; burn=`0x42966c68` with Pitfall 2 generic-OZ-burnable warning) + 2 encoders + getter re-exports + `_rocketPoolProtocol` spy-affordance.
- **Pure-math helper:** `src/signing/rocketpool-rate.ts` (100 lines) exports `RETH_SCALE` (10n ** 18n) + `RETH_DECIMALS` (18n) + `computeEthEquivalent` returning `{ ethEquivalent: bigint }`. **NO `approx` flag** — contrast with Lido's `LidoRebaseOutput` (rETH is non-rebasing; the rate is canonical at the read block, not an approximation). Documented inline.
- **Chain reader:** `src/chains/rocketpool.ts` (120 lines) implements `readEthereumPositions(client, wallet)` as a 2-read Promise.all (balanceOf + getExchangeRate) + pure-math conversion via `_rocketPoolRate.computeEthEquivalent`. Address resolution via Plan 31-01 SOT — NEVER inlined.
- **MCP read tool (RP-01):** `get_rocketpool_positions({ wallet, chain?: 'ethereum' })` returns `{rethBalance, exchangeRate, ethEquivalent, ...Human, chain, chainId, rpcDegraded?}` structured content + human-readable summary lines. Defaults to Ethereum; refuses non-Ethereum with `CHAIN_ID_MISMATCH`. Refuses malformed wallet with `INVALID_INPUT`. NO `approx` flag in structuredContent (load-bearing contrast with `get_lido_positions`).
- **MCP write tool (RP-02 stake):** `prepare_rocketpool_stake({ chain, amount, from? })` produces a handle whose `tx.to === getRocketPoolDepositPoolAddress(1)`, `tx.valueWei === amountWei` (value-bearing PAYABLE call), `tx.data === "0xd0e30db0"` (selector-only). Three-block response: PREPARE RECEIPT (verbatim agent args) + CHECKS PERFORMED (D-07 outcome + decimal-strict + Pitfall 1 awareness) + LEDGER NOTICE (D-13 verbatim 10-line block, SHARED template).
- **MCP write tool (RP-02 unstake):** `prepare_rocketpool_unstake({ chain, rethAmount, from? })` produces a handle whose `tx.to === getRocketPoolRethAddress(1)`, `tx.valueWei === 0n`, `tx.data === encodeRocketPoolBurn(rethAmountWei)` (74-char calldata starting `0x42966c68`). Three-block response: PREPARE RECEIPT + CHECKS PERFORMED (D-08 outcome with pool-balance + ETH-equivalent + Pitfall 5 residual disclosure + Pitfall 2 awareness) + LEDGER NOTICE (SHARED template — symmetric blind-sign UX per D-13).
- **`src/signing/blocks.ts` APPEND-ONLY:** +158 lines after the Plan 31-02 EigenLayer block. Phase 4 / 6 / 7 / 8 / 9 / 28 / 29 / 30 / 31-02 templates above stay byte-identical (FROZEN). 5 new exports — `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE` (SHARED 10-line block per D-13) + `ROCKETPOOL_STAKE_PREPARE_RECEIPT_TEMPLATE` + `ROCKETPOOL_UNSTAKE_PREPARE_RECEIPT_TEMPLATE` + 2 DECODED ARGS templates + `RocketPoolDecoded` discriminated union + `buildRocketPoolDecodedArgsBlock` 2-case switch.
- **`preview_send` (tx.to, selector) tuple dispatch:** `src/tools/preview_send.ts` extended with 3 new selector arms (EigenLayer deposit + Rocket Pool stake + Rocket Pool burn). Each arm DEFENSIVELY gates on `tx.to === SOT-address` before populating the discriminated-union variable. Pitfall 1 mitigated: `(tx.to, 0xd0e30db0)` tuple branches WETH9.deposit vs RocketDepositPool.deposit at the DECODED ARGS dispatch layer. Pitfall 2 mitigated: `(tx.to, 0x42966c68)` tuple branches generic OZ Burnable vs rETH.burn. The canonical-dispatch allowlist Set remains selector-blind (defense-in-depth — both contracts live independently in `CANONICAL_DISPATCH_TARGETS[1]` per Plan 31-01).
- **Fixture AA-RP + AB-RP anchors:** Hardcoded `payloadFingerprint` literals in `test/signing-fingerprint.test.ts` pin the cryptographic-binding chain for RocketDepositPool.deposit() value-bearing + rETH.burn(1e18). Computed once at write-time via a one-shot Node script (cross-checked against Fixture Z's literal — same script reproduces the existing `0x2c36a77f...` value). Cross-linked from `test/prepare-rocketpool-stake.test.ts` + `test/prepare-rocketpool-unstake.test.ts` + `test/integration-eigenlayer-rocketpool.test.ts`.
- **Persona-cycle integration test:** `test/integration-eigenlayer-rocketpool.test.ts` (404 lines / 7 tests) runs the EigenLayer-deposit + Rocket-Pool-stake + Rocket-Pool-unstake cycle across 3 personas (whale / stable-saver / defi-degen), asserting Fixture Z / AA-RP / AB-RP fingerprints are byte-identical across personas (T-BIND-1 from-INDEPENDENCE end-to-end) + cross-fixture distinctness sanity + full prepare → preview → send pipeline regression for all 3 protocols on the whale persona.
- **SECURITY.md §6 — v2.3 close-out:** New section "## EVM lending + staking v2.3 milestone close-out summary" appended after the v2.2 BTC/LTC close-out. 6 subsections per D-15: scope paragraph + Milestone PRs (Phases 28 + 29 + 30 + 31 with all merged PR numbers — #82/#86/#90/#94/#95 + #118/#135 + #137/#141 + this PR) + Trust-shape recap + Clear-sign coverage gap (NEW for v2.3 — covered/NOT-covered matrix) + Accepted residual risks (5 items) + Phase 31 threat register summary (13 rows). Mirrors the Phase 21 v2.1 close-out template shape.
- **Full vitest suite green: 3623 → 3683 (+60 net tests).** Strict `tsc --noEmit` clean. FROZEN regions (`payload-fingerprint.ts` / `presign-hash.ts` / `handle-store.ts` / `send_transaction.ts` / `clients/etherscan.ts`) byte-identical to baseline `origin/main`.

## Task Commits

1. **Task 1: Rocket Pool protocol decoder + pure-math + Fixtures AA-RP/AB-RP** — `9db9082` (feat)
   Files: `src/protocols/rocketpool.ts` (NEW 241), `src/signing/rocketpool-rate.ts` (NEW 100), `src/signing/blocks.ts` (+158), `test/protocols-rocketpool.test.ts` (NEW 148 / 13 tests), `test/signing-rocketpool-rate.test.ts` (NEW 91 / 8 tests), `test/signing-fingerprint.test.ts` (+82 — Fixtures AA-RP + AB-RP).
2. **Task 2: Rocket Pool 3 MCP tools — get_rocketpool_positions + prepare stake/unstake** — `1625a9d` (feat)
   Files: `src/chains/rocketpool.ts` (NEW 120), `src/tools/get_rocketpool_positions.ts` (NEW 176), `src/tools/prepare_rocketpool_stake.ts` (NEW 306), `src/tools/prepare_rocketpool_unstake.ts` (NEW 330), `src/tools/register-all.ts` (+3), `test/get-rocketpool-positions.test.ts` (NEW 163 / 6 tests), `test/prepare-rocketpool-stake.test.ts` (NEW 341 / 10 tests), `test/prepare-rocketpool-unstake.test.ts` (NEW 309 / 9 tests).
3. **Task 3: preview_send (tx.to, selector) tuple dispatch + integration test + v2.3 close-out** — `6bb78d8` (feat)
   Files: `src/tools/preview_send.ts` (+149 / -4), `test/preview-send.rocketpool.test.ts` (NEW 319 / 5 tests), `test/integration-eigenlayer-rocketpool.test.ts` (NEW 404 / 7 tests), `SECURITY.md` (+59 — v2.3 close-out).

## Files Created/Modified

### Created

| Path | Lines | Purpose |
|------|------:|---------|
| `src/protocols/rocketpool.ts` | 241 | 3 ABI fragments + ROCKETPOOL_SELECTORS table + 2 encoders + Pitfall-doc constants + spy-affordance |
| `src/signing/rocketpool-rate.ts` | 100 | Pure-bigint RETH_SCALE + computeEthEquivalent (NO approx flag) + spy-affordance |
| `src/chains/rocketpool.ts` | 120 | readEthereumPositions 2-read Promise.all + spy-affordance |
| `src/tools/get_rocketpool_positions.ts` | 176 | MCP read tool (RP-01) — Ethereum-only |
| `src/tools/prepare_rocketpool_stake.ts` | 306 | MCP write tool (RP-02 stake) — D-07 + D-13 |
| `src/tools/prepare_rocketpool_unstake.ts` | 330 | MCP write tool (RP-02 unstake) — D-08 + Pitfall 5 + D-13 |
| `test/protocols-rocketpool.test.ts` | 148 | 13 tests — 2 selector pins + 2 Pitfall DOCUMENTATION assertions + 3 encoder + 3 constants + spy-affordance |
| `test/signing-rocketpool-rate.test.ts` | 91 | 8 tests — constants + degenerate-zero + 2 deterministic + zero-rate + NO-approx-flag shape + spy-affordance |
| `test/get-rocketpool-positions.test.ts` | 163 | 6 tests — happy + zero-balance + chain refusal + invalid wallet + default chain + rpcDegraded |
| `test/prepare-rocketpool-stake.test.ts` | 341 | 10 tests — happy + Fixture AA-RP cross-link + D-07 refusal + D-07 RPC-failure fallback × 2 + Polygon refusal + zero-value + LEDGER NOTICE verbatim + Pitfall 1 awareness + register-all |
| `test/prepare-rocketpool-unstake.test.ts` | 309 | 9 tests — happy + Fixture AB-RP cross-link + D-08 pool-empty refusal + Polygon refusal + zero-value + LEDGER NOTICE verbatim + Pitfall 2 + Pitfall 5 residual + register-all |
| `test/preview-send.rocketpool.test.ts` | 319 | 5 tests — (RocketDepositPool, 0xd0e30db0) → Rocket Pool arm; (WETH9, 0xd0e30db0) Pitfall 1 negative; (rETH, 0x42966c68) → Rocket Pool arm; (USDC, 0x42966c68) Pitfall 2 negative; (StrategyManager, 0xe7a050aa) → EigenLayer arm + LEDGER NOTICE |
| `test/integration-eigenlayer-rocketpool.test.ts` | 404 | 7 tests — 3 fixtures × 3 personas byte-identity (Fixtures Z + AA-RP + AB-RP from-INDEPENDENCE) + cross-fixture distinctness sanity + 3 full prepare→preview→send pipeline regressions on whale persona |

### Modified

| Path | Δ | Purpose |
|------|---:|---------|
| `src/signing/blocks.ts` | +158 | APPEND-ONLY after Plan 31-02 EigenLayer block — LEDGER_NOTICE_ROCKETPOOL_TEMPLATE (SHARED stake+unstake) + 2 PREPARE RECEIPT + 2 DECODED ARGS templates + RocketPoolDecoded union + buildRocketPoolDecodedArgsBlock |
| `src/tools/preview_send.ts` | +149 / -4 | (tx.to, selector) tuple-dispatch extension — EigenLayer + 2 Rocket Pool arms wired into the 5-tier dispatch ladder + decoded-args block selection + LEDGER NOTICE selection + decodedArgsForJson serialization + ledgerNotice structuredContent tag |
| `src/tools/register-all.ts` | +3 | 3 new side-effect imports after Plan 31-02 EigenLayer imports |
| `test/signing-fingerprint.test.ts` | +82 | Fixture AA-RP + Fixture AB-RP hardcoded payloadFingerprint literal anchors + cross-link comments to prepare-tool tests + integration test |
| `SECURITY.md` | +59 | v2.3 EVM lending + staking milestone close-out summary section (6 subsections per D-15) appended after v2.2 BTC/LTC close-out |

## The 2 Verified Rocket Pool Selectors (Source-Pinned Constants)

```typescript
export const ROCKETPOOL_SELECTORS = {
  /** RocketDepositPool.deposit() — payable, no args. ETH amount in msg.value.
   *  COLLISION: equals WETH9_SELECTORS.deposit (Pitfall 1). */
  deposit: "0xd0e30db0" as Hex,
  /** rETH.burn(uint256) — single-arg unstake. NOT payable.
   *  COLLISION: generic ERC20Burnable.burn(uint256) (Pitfall 2). */
  burn: "0x42966c68" as Hex,
} as const;
```

Each cross-asserted in `test/protocols-rocketpool.test.ts` against `viem.toFunctionSelector(...)`. Drift in either one fails the corresponding `it(...)` block AND, downstream, the Fixture AA-RP / AB-RP payloadFingerprint regression.

## Fixture AA-RP + AB-RP Hardcoded Fingerprint Literals

```
Fixture AA-RP: 0x615683fb4b0cf540d1e5ba8f12c0766e542825557f769e60e83aa2cc76be0ca3
Fixture AB-RP: 0xd12144239fb353612c20a3aa0a9dbcd9dd73de4141e1adce866ecf0974854edc
```

**Fixture AA-RP inputs** (resolved via SOT getters — NEVER inlined):
- `to`: `getRocketPoolDepositPoolAddress(1)` = `0xDD3f50F8A6CafbE9b31a427582963f465E745AF8`
- `valueWei`: `1_000_000_000_000_000_000n` (1 ETH; PAYABLE deposit)
- `data`: `encodeRocketPoolDeposit()` = `"0xd0e30db0"` (selector-only; 10 chars)

**Fixture AB-RP inputs**:
- `to`: `getRocketPoolRethAddress(1)` = `0xae78736Cd615f374D3085123A210448E74Fc6393`
- `valueWei`: `0n` (NOT payable)
- `data`: `encodeRocketPoolBurn(1_000_000_000_000_000_000n)` (74-char calldata; first 10 chars `0x42966c68`)

Computed once at write-time via a `node`-eval one-shot (cross-checked against Fixture Z's existing `0x2c36a77f...658684` literal — same script reproduces the existing value, confirming the recompute logic matches `src/signing/payload-fingerprint.ts`). Pinned per CLAUDE.md "NO `beforeAll`-snapshot" rule.

**Cross-link map:**
- `test/signing-fingerprint.test.ts` Fixture AA-RP block (canonical literal)
- `test/prepare-rocketpool-stake.test.ts` T2 (re-anchor via prepare-flow path + independent encoder + fingerprint recomputation)
- `test/integration-eigenlayer-rocketpool.test.ts` "Fixture AA-RP persona-independence" describe (re-anchor across 3 personas)

Same shape for Fixture AB-RP cross-links (prepare-rocketpool-unstake.test.ts T2 + integration test "Fixture AB-RP persona-independence" describe).

## LEDGER NOTICE Shared Template (D-13 — 10 Lines)

```
LEDGER NOTICE
  Rocket Pool deposit/burn is NOT covered by the Ledger Ethereum app's clear-sign plugins.
  Your device will BLIND-SIGN this transaction (display a raw hash, no decoded args).
  If your device refuses with "Blind signing is not enabled":
    1. Open the Ethereum app on your device
    2. Settings → Blind signing → Enabled
    3. Retry send_transaction
  After send_transaction fires, compare the PREDICTED hash below to the
  value your hardware device displays — character-for-character. This
  on-device match is the cryptographic anchor.
```

**SHARED constant `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE`** in `src/signing/blocks.ts` (after the EigenLayer block). Emitted verbatim by:
- `prepare_rocketpool_stake` — third content[] item of the response
- `prepare_rocketpool_unstake` — third content[] item of the response
- `preview_send` Rocket Pool stake arm — emitted ABOVE LEDGER BLIND-SIGN HASH
- `preview_send` Rocket Pool burn arm — same

Symmetric blind-sign UX per D-13 — body line "Rocket Pool deposit/burn is NOT covered" intentionally covers BOTH operations in one phrase.

## D-08 Verbatim Pool-Empty Error Message

> "Rocket Pool deposit pool empty ({poolBalance} ETH liquidity, need {ethEquivalent} ETH for burn). Swap rETH on a DEX (Uniswap V3, Curve) instead, or wait for more deposits to refill the pool."

Surfaced in `prepare_rocketpool_unstake` when `RocketDepositPool.getBalance() < rETH.getEthValue(rethAmount)`. Error envelope includes `hintTool: "request_capability"` + `hintArgs: { feature: "Rocket Pool rETH/ETH DEX swap" }`. Verbatim per RESEARCH § Topic 7 lines 842-848.

## `(tx.to, selector)` Tuple-Dispatch Arms Added to preview_send

```typescript
// 6th tier — EigenLayer
} else if (sel === EIGENLAYER_SELECTORS.depositIntoStrategy) {
  // ABI-decode (strategy, lstToken, amount); gate on tx.to === StrategyManager
  // AND (strategy, lstToken) match the curated 7-LST registry.
  if (smAddr && record.tx.to === smAddr) {
    const match = curated.find((row) => row.strategy === strategy && row.lstToken === lstToken);
    if (match) eigenLayerDecoded = { kind: "eigenlayer-deposit", ... };
  }
}
// 7th tier — Rocket Pool stake (Pitfall 1 — same selector as WETH9.deposit)
else if (sel === ROCKETPOOL_SELECTORS.deposit) {
  if (depositPoolAddr && record.tx.to === depositPoolAddr) {
    rocketPoolDecoded = { kind: "rocketpool-stake", contractAddress: depositPoolAddr, valueWei: record.tx.valueWei };
  }
  // tx.to !== depositPool (e.g. WETH9) → falls through; generic-decode handles WETH9.
}
// 8th tier — Rocket Pool burn (Pitfall 2 — same selector as generic OZ ERC20Burnable)
else if (sel === ROCKETPOOL_SELECTORS.burn) {
  if (rethAddr && record.tx.to === rethAddr) {
    // ABI-decode amount via RETH_ABI; populate rocketpool-burn arm.
  }
  // tx.to !== rETH → falls through; generic-decode handles other Burnable ERC-20s.
}
```

Decoded-args block selection ternary chain extended in parallel; LEDGER NOTICE selection extended with `isEigenLayerDeposit` + `isRocketPool` flags; `decodedArgsForJson` extended with the new discriminants; `ledgerNotice` structuredContent tag extended with `eigenlayer-deposit-blind-sign` + `rocketpool-blind-sign` literals.

## Integration Test Coverage Summary

| Test arm | Personas | Fixture | Anchor type |
|---|---|---|---|
| `Fixture Z persona-independence (EigenLayer deposit)` | 3 (whale, stable-saver, defi-degen) | Z (`0x2c36a77f...`) | from-INDEPENDENT byte-identity |
| `Fixture AA-RP persona-independence (Rocket Pool stake)` | 3 | AA-RP (`0x615683fb...`) | from-INDEPENDENT byte-identity |
| `Fixture AB-RP persona-independence (Rocket Pool unstake)` | 3 | AB-RP (`0xd1214423...`) | from-INDEPENDENT byte-identity |
| `cross-fixture distinctness` | n/a | n/a | 3-element Set size check |
| Full pipeline: EigenLayer deposit | whale | Z | prepare → preview (NOTICE + DECODED ARGS + tag) → send_transaction simulation |
| Full pipeline: Rocket Pool stake | whale | AA-RP | prepare → preview → send |
| Full pipeline: Rocket Pool unstake | whale | AB-RP | prepare → preview → send |

**3 personas × 3 fixtures = 9 byte-identity assertions + cross-fixture distinctness + 3 pipeline regressions = 7 test cases total (the byte-identity tests loop internally over the 3 personas).**

## Threat Mitigations Wired

| Threat ID | Mitigation Wired | Verification Anchor |
|-----------|------------------|---------------------|
| T-ROCKETPOOL-MIN-DEPOSIT-1 | D-07 live `RocketDAOProtocolSettingsDeposit.getMinimumDeposit()` + hardcoded `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI = 0.01 ETH` fallback. Refusal with `INVALID_INPUT + hintTool: "request_capability"`. | `test/prepare-rocketpool-stake.test.ts` T3 (below-minimum refusal) + T4 (RPC-failure fallback) |
| T-ROCKETPOOL-LIQUIDITY-1 | D-08 `Promise.all([RocketDepositPool.getBalance, rETH.getEthValue])` pre-flight. Refusal with verbatim DEX-swap-hint error + hintTool "request_capability" + feature "Rocket Pool rETH/ETH DEX swap". | `test/prepare-rocketpool-unstake.test.ts` T3 (pool-empty refusal) |
| T-LEDGER-NOTICE-ROCKETPOOL-1 | `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE` SHARED between stake + unstake + preview_send arms (D-13 symmetric UX). Verbatim 10-line block. Cryptographic anchor: on-device blind-sign hash match. | `test/prepare-rocketpool-stake.test.ts` T7 + `test/prepare-rocketpool-unstake.test.ts` T6 + `test/preview-send.rocketpool.test.ts` T1+T3 |
| T-31-SELECTOR-COLLISION-DEPOSIT (Pitfall 1) | `preview_send` routes DECODED ARGS dispatch on `(tx.to, selector)` tuple. Allowlist Set stays selector-blind. | `test/preview-send.rocketpool.test.ts` T1 (positive) + T2 (negative WETH9.deposit) |
| T-31-SELECTOR-COLLISION-BURN (Pitfall 2) | Tuple dispatch — generic OZ ERC20Burnable falls through; rETH burn routes to Rocket Pool arm. | `test/preview-send.rocketpool.test.ts` T3 (positive) + T4 (negative USDC) |
| T-ROCKETPOOL-LIQUIDITY-RACE (Pitfall 5) | Documented residual in CHECKS PERFORMED; on-chain `require(ethBalance >= ethAmount)` backstop revert. | `test/prepare-rocketpool-unstake.test.ts` T8 (Pitfall 5 residual disclosure) |
| T-FROZEN-31 | Zero-diff invariant on FROZEN files asserted by `git diff --stat origin/main -- ...` returning empty | Verified below |

## D-XX CONTEXT.md Decisions Addressed

| Decision | Resolution |
|----------|------------|
| D-01 (separate `src/protocols/rocketpool.ts` file) | Honored — separate file, sibling to `src/protocols/eigenlayer.ts` and `src/protocols/lido.ts` |
| D-02 (separate-file confirmation) | Honored — matches D-01 |
| D-03 (chain enum locked to 'ethereum' for both prepare tools) | Honored — JSON-schema enum `["ethereum"]` + defensive runtime gate in handlers |
| D-07 (min-deposit pre-flight + fallback) | Honored — live read + `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI` fallback; CHECKS PERFORMED labels source |
| D-08 (deposit-pool-liquidity pre-flight + DEX-swap hint) | Honored — Promise.all reads + verbatim error message + hintTool: request_capability |
| D-09 (no NFT receipt — standard PREPARE RECEIPT layout) | Honored — no NFT block emitted in either tool |
| D-11 (`{rethBalance, exchangeRate, ethEquivalent}` read shape) | Honored — get_rocketpool_positions returns the 3-field shape + human-formatted variants |
| D-13 (LEDGER NOTICE template for Rocket Pool — SHARED between stake + unstake) | Honored — `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE` is the SAME constant emitted by both tools + both preview_send arms |
| D-14 (Fixtures AA + AB assignment) | Honored with `-RP` suffix disambiguation (Fixture AA + AB names ALREADY USED for BTC LiFi in `test/signing-fingerprint.test.ts` Phase 26 Plan 26-03 — collision documented + resolved inline) |
| D-15 (v2.3 milestone close-out summary in SECURITY.md) | Honored — "## EVM lending + staking v2.3 milestone close-out summary" section with 6 subsections appended to SECURITY.md §6 |

## Verification

- **vitest suite:** `npx vitest run` → 287 files, 3683 tests passing, 1 skipped. Exit 0.
- **TypeScript:** `npx tsc --noEmit` → exit 0.
- **Selector cross-anchor:** `grep -nE "0xd0e30db0|0x42966c68" src/protocols/rocketpool.ts test/protocols-rocketpool.test.ts test/signing-fingerprint.test.ts src/tools/prepare_rocketpool_stake.ts src/tools/prepare_rocketpool_unstake.ts` → matches in all 5 files.
- **LEDGER NOTICE shared template:** `grep -c "Rocket Pool deposit/burn is NOT covered" src/signing/blocks.ts src/tools/preview_send.ts` returns 1 each. `prepare_rocketpool_stake.ts` and `prepare_rocketpool_unstake.ts` import and emit `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE` by name (format-fanout-sentinel pattern — verbatim text lives only in the template constant).
- **Tuple dispatch wired:** `grep -nE "getRocketPoolDepositPoolAddress|getRocketPoolRethAddress|getEigenLayerStrategyManagerAddress" src/tools/preview_send.ts` returns 6 matches (3 imports + 3 dispatch-arm guards).
- **Fixture cross-link:** `grep -c "Fixture (Z|AA-RP|AB-RP)" test/integration-eigenlayer-rocketpool.test.ts test/prepare-eigenlayer-deposit.test.ts test/prepare-rocketpool-stake.test.ts test/prepare-rocketpool-unstake.test.ts` returns ≥ 1 in each.
- **SECURITY.md §6 v2.3:** `grep -c "EVM lending + staking v2.3 milestone close-out summary" SECURITY.md` returns 1. `grep -c "### Milestone PRs" SECURITY.md` returns 2 (v2.1 close-out + v2.3 close-out). `grep -c "### Clear-sign coverage gap (NEW for v2.3)" SECURITY.md` returns 1. `grep -c "### Phase 31 threat register summary" SECURITY.md` returns 1.
- **register-all complete:** `grep -c "get_eigenlayer_positions\|prepare_eigenlayer_deposit\|get_rocketpool_positions\|prepare_rocketpool_stake\|prepare_rocketpool_unstake" src/tools/register-all.ts` returns 5.
- **FROZEN region zero-diff:** `git diff --stat origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts` returns empty output. Confirmed byte-identical.
- **All 4 phase-31 requirement IDs addressed across the 3 plans of Phase 31:** EIG-01 + EIG-02 (Plan 31-02) + RP-01 + RP-02 (Plan 31-03).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Sequencing] register-all.ts wiring deferred from Task 1 Step 7 to Task 2**

- **Found during:** Task 1 verification design — same shape as Plan 31-02's documented deviation. Adding 3 side-effect imports for not-yet-created tool files at Task 1 would cause the full vitest suite to fail at import-resolution time (the vite transform fails synchronously before any individual test runs).
- **Issue:** The plan's Task 1 Step 7 wires the 3 imports in Task 1 to keep "sequence clarity". Empirically (Plan 31-02 SUMMARY documented this) vitest does NOT reorder around the failing import — the whole vitest run fails. Plan 31-02 applied the same deferral as a sanctioned alternative.
- **Fix:** Plan 31-03 applied the same Plan-31-02-sanctioned pattern by default — added the 3 register-all imports in Task 2 (where all 3 tool files exist) instead of Task 1. Per-task vitest suite stays green end-to-end.
- **Files modified:** `src/tools/register-all.ts` (+3 lines wired in Task 2 commit `1625a9d` instead of Task 1).
- **Verification:** Each per-task commit's vitest suite is green; full suite at HEAD: 3683 passing.
- **No security regression:** the wiring is mechanical side-effect imports; the deferred ordering does not affect the cryptographic-binding chain.

**2. [Rule 3 — Naming disambiguation] `Fixture AA-RP` + `Fixture AB-RP` suffix vs the plan's `Fixture AA + AB`**

- **Found during:** Task 1 Step 6 (adding Fixture AA + AB to `test/signing-fingerprint.test.ts`).
- **Issue:** The plan calls for `Fixture AA + Fixture AB` for Rocket Pool. But `test/signing-fingerprint.test.ts` ALREADY contains a describe block named `Fixture AA — LiFi BTC PSBT payloadFingerprint (Phase 26 Plan 26-03)` (lines 1043+). Adding a second `Fixture AA` in the same file would create human-readability confusion (the code is unambiguous — different describe blocks, different functions, different fixture types — but humans reading PR diffs / test output / commit messages would have to disambiguate by context).
- **Fix:** Use disambiguating suffix `-RP` (Rocket Pool) — `Fixture AA-RP` + `Fixture AB-RP`. Cross-link comments in fixture blocks and consumer tests explicitly name the disambiguation. The BTC LiFi `Fixture AA` (Phase 26) describes `computeBtcLifiPayloadFingerprint` (PSBT-based; 22-byte domain tag `VaultPilot-btclifi-v1:`); the Rocket Pool `Fixture AA-RP` (Phase 31) describes `computePayloadFingerprint` (EVM; 23-byte domain tag `VaultPilot-txverify-v1:`). Different functions; different describe blocks; suffix is purely a human-readability disambiguator.
- **Files modified:** `test/signing-fingerprint.test.ts` (fixture blocks + cross-link comments); `test/prepare-rocketpool-stake.test.ts` + `test/prepare-rocketpool-unstake.test.ts` + `test/integration-eigenlayer-rocketpool.test.ts` (referenced as `FIXTURE_AA_RP_FINGERPRINT` / `FIXTURE_AB_RP_FINGERPRINT` constants).
- **Verification:** All cross-link tests pass byte-identity; full suite green.
- **Plan-spec impact:** Plan's `must_haves.truths` mentions "Fixture AA hardcoded 0x..." — the suffix is a human-readable extension, not a substantive change. Both literals exist at the call sites the plan specifies.

**3. [Rule 3 — Test pattern correction] Test 4 in `test/preview-send.rocketpool.test.ts` uses USDC instead of arbitrary `0x...bEEF`**

- **Found during:** Initial test run of `test/preview-send.rocketpool.test.ts` T4 (Pitfall 2 negative case — same selector, different tx.to).
- **Issue:** Initial test used `0x000000000000000000000000000000000000bEEF` as the "arbitrary ERC-20 with OZ Burnable" target. This address is NOT in `CANONICAL_DISPATCH_TARGETS[1]`, so `preview_send`'s Layer 0.5 canonical-dispatch gate refused with `DISPATCH_TARGET_REFUSED` BEFORE reaching the DECODED ARGS dispatch chain. The test was asserting on dispatch-layer behavior, not allowlist behavior, so the refusal at Layer 0.5 made the test fail.
- **Fix:** Use USDC mainnet address (which IS in the allowlist via the BRIDGED_VARIANTS / TOKEN_CONTRACTS rows). USDC doesn't actually implement `burn(uint256)` on-chain, but `preview_send` dispatches at the calldata level (no contract simulation here) — the test correctly asserts that `(tx.to=USDC, selector=0x42966c68)` does NOT route to the Rocket Pool arm and does NOT emit the Rocket Pool LEDGER NOTICE.
- **Files modified:** `test/preview-send.rocketpool.test.ts` (replaced the placeholder with USDC + inline comment explaining the rationale).
- **No security regression:** the test is at the unit level; the SUT is the dispatch decision in `preview_send`, not on-chain reality.

## Threat Flags

No new security-relevant surface introduced outside the plan's `<threat_model>` register. All new files map to threats already enumerated.

The `(tx.to, selector)` tuple-dispatch pattern in `preview_send` is itself the mitigation for T-31-SELECTOR-COLLISION-DEPOSIT + T-31-SELECTOR-COLLISION-BURN; the pattern is new to the codebase but documented in source comments + SECURITY.md v2.3 close-out + this SUMMARY. Future protocols that introduce additional selector collisions should reuse this dispatch pattern.

## Self-Check: PASSED

- `src/protocols/rocketpool.ts` — FOUND
- `src/signing/rocketpool-rate.ts` — FOUND
- `src/chains/rocketpool.ts` — FOUND
- `src/tools/get_rocketpool_positions.ts` — FOUND
- `src/tools/prepare_rocketpool_stake.ts` — FOUND
- `src/tools/prepare_rocketpool_unstake.ts` — FOUND
- `src/signing/blocks.ts` (modified — +158 lines) — FOUND
- `src/tools/preview_send.ts` (modified — +149/-4) — FOUND
- `src/tools/register-all.ts` (modified — +3) — FOUND
- `test/protocols-rocketpool.test.ts` — FOUND
- `test/signing-rocketpool-rate.test.ts` — FOUND
- `test/get-rocketpool-positions.test.ts` — FOUND
- `test/prepare-rocketpool-stake.test.ts` — FOUND
- `test/prepare-rocketpool-unstake.test.ts` — FOUND
- `test/preview-send.rocketpool.test.ts` — FOUND
- `test/integration-eigenlayer-rocketpool.test.ts` — FOUND
- `test/signing-fingerprint.test.ts` (modified — +82 — Fixtures AA-RP + AB-RP) — FOUND
- `SECURITY.md` (modified — +59 — v2.3 close-out section) — FOUND
- Commit `9db9082` (Task 1) — FOUND in git log
- Commit `1625a9d` (Task 2) — FOUND in git log
- Commit `6bb78d8` (Task 3) — FOUND in git log
- FROZEN region zero-diff against origin/main confirmed for: `src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/signing/handle-store.ts`, `src/tools/send_transaction.ts`, `src/clients/etherscan.ts`
