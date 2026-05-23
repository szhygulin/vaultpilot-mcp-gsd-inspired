# Phase 30: Lido — stake / unstake / wrap / unwrap (stETH↔wstETH) — Context

**Gathered:** 2026-05-23
**Status:** Ready for planning — auto-resolved via `--auto` per autonomous-phase-execution preference; recommended options grounded in prior-phase analogs (06/07/28/29).

Decisions in `<decisions>` are LOCKED per recommended-option selection; execute-time changes require replan.

<domain>
## Phase Boundary

User can:
1. **Stake** ETH → mints stETH (`Lido.submit(referral)` with `value` = amount)
2. **Unstake** stETH → queues withdrawal via `WithdrawalQueue.requestWithdrawals` (mints ERC-721 NFT receipt; claimable hours-to-days later)
3. **Wrap** stETH → wstETH (`WstETH.wrap(stethAmount)`; rebase-resistant form preferred for DeFi composability)
4. **Unwrap** wstETH → stETH (`WstETH.unwrap(wstethAmount)`)
5. **Read** stETH + wstETH balances + accrued rebase rewards via `get_lido_positions` (Ethereum mainnet + Arbitrum bridged variants)

**Writes Ethereum-only.** Reads multi-chain (Ethereum + Arbitrum). NFT-claim flow deferred to v2.3.x verify-phase.

</domain>

<decisions>
## Implementation Decisions

### Contract surface & SOT

- **D-01:** Lido contracts sourced from `src/config/contracts.ts` via per-chain `LidoContracts` interface + flat getters (`getLidoStethAddress`, `getLidoWstethAddress`, `getLidoWithdrawalQueueAddress`). Mirrors `getAaveV3PoolAddress` (Phase 7) + `CompoundCometsByChain` (Phase 28) SOT shape. T-LIDO-SPENDER-DRIFT-1 cross-view byte-identity: `getLidoStethAddress(1) === KNOWN_SPENDERS_ETHEREUM[<lido stETH spender slot>].address`.
- **D-02:** Single `src/protocols/lido.ts` covering all 4 contracts (stETH `submit` + WithdrawalQueue `requestWithdrawals` + WstETH `wrap` + WstETH `unwrap`). Lido is one protocol with bound contracts; single-file matches Phase 28/29 protocol-decoder bundling.
- **D-03:** Ethereum-write-only enforcement — `prepare_lido_*` tools refuse on non-Ethereum chains via existing `CHAIN_ID_MISMATCH` errorCode 15 (Phase 8 surface). Reads stay multi-chain via per-chain Lido SOT slots (Ethereum primary; Arbitrum bridged stETH/wstETH from canonical bridge deployment).

### Trust-pipeline shape

- **D-04:** `prepare_lido_unstake` returns the standard handle + adds a `[NFT RECEIPT EXPECTED]` block (separate from `LEDGER NOTICE` / `[AGENT TASK]` / `CHECKS PERFORMED`) surfacing: expected NFT contract address, expected `tokenId` (next-request-id read at prepare time via `WithdrawalQueue.getLastRequestId(owner) + 1`), expected `requestor` (sender), expected claim-after-finalization-window (typically 1-5 days). Standalone block matches Phase 6 LEDGER NOTICE precedent for novel post-tx artifacts.
- **D-05:** stETH-approval prerequisite for `wstETH.wrap` and `WithdrawalQueue.requestWithdrawals` — server pre-flight reads `stETH.allowance(owner, spender)` at prepare time; if insufficient, refuses with `INVALID_INPUT + hintTool → prepare_token_approve` (Phase 28 intent-vs-reality pattern). Keeps the 21-code errorCode union FROZEN.
- **D-06:** `prepare_lido_unstake` accepts a single `stethAmount` param (one withdrawal request per call). The on-chain `requestWithdrawals(uint256[] amounts, address owner)` accepts an array, but Phase 30 ships single-amount only — array-of-amounts deferred per "curation over padding" + LIDO-03 `{ stethAmount }` singular language. Server still encodes as `[stethAmount]` for ABI compatibility.
- **D-07:** Wrap/unwrap follow the WETH9 (Plan 06-04) pattern: encoder + canonical-address getter colocated in `src/protocols/lido.ts`. Selectors hardcoded literals: `WstETH.wrap` = `0xea598cb0`, `WstETH.unwrap` = `0xde0e9a3e` (verify at planning time via `viem.toFunctionSelector`; commit as test anchors in `test/protocols-lido.test.ts`).

### Reads & rebase accounting

- **D-08:** `get_lido_positions({ wallet, chain? })` returns:
  - `stethBalance` (raw + human-units via decimal-aware formatter; stETH = 18 decimals)
  - `wstethBalance` (raw + human-units; wstETH = 18 decimals)
  - `stethShares` (load-bearing for rebase math; from `stETH.sharesOf(wallet)`)
  - `conversionRate` (current wstETH→stETH rate from `WstETH.stEthPerToken()`; 1e18-scaled)
  - `accruedRebaseRewards` (shares-based snapshot; see D-09)
  - `chain` (`"ethereum"` | `"arbitrum"` — both read-only on Arbitrum)
- **D-09:** `accruedRebaseRewards` computation — shares-based via Lido `getSharesByPooledEth` / `getPooledEthByShares`. Phase 30 surfaces APPROXIMATE accrual as a non-load-bearing field with explicit `approx: true` flag. Pure-bigint math in `src/signing/lido-rebase.ts` (mirrors `src/signing/aave-health.ts` + `src/signing/compound-health.ts` pattern). Exact accounting (full transfer history) deferred to v3.x ergonomics surface.

### Canonical-dispatch wiring

- **D-10:** Per-chain `CANONICAL_DISPATCH_TARGETS` (Phase 9) Lido arm wired for Ethereum: stETH proxy, wstETH, WithdrawalQueue all added to the allowlist. Arbitrum entries READ-ONLY (no prepare_* dispatch targets — writes refuse pre-dispatch via D-03). `DISPATCH_TARGET_REFUSED` errorCode applies if a future bug routes a Lido prepare call to a non-allowlisted address.

### Fixture letter assignment

- **D-11:** Fixture letters assigned alphabetically following Phase 28 R/S/T/U (Phase 29 fixture letters land in 29's RESEARCH; cross-check at planning time to avoid collision):
  - **Fixture V** = `Lido.submit(referral=address(0))` (referral param hardcoded `0x0…` per Lido docs — third-party referral payout out of scope)
  - **Fixture W** = `WithdrawalQueue.requestWithdrawals([stethAmount], owner=sender)`
  - **Fixture X** = `WstETH.wrap(stethAmount)`
  - **Fixture Y** = `WstETH.unwrap(wstethAmount)`
- Hardcoded `0x...` literals in `test/signing-fingerprint.test.ts` per CLAUDE.md cryptographic-binding fixture discipline. Cross-link from each consumer test (`test/prepare-lido-*.test.ts`). Integration test re-anchors byte-identity across persona swaps (matches Phase 6 + Phase 7 + Phase 28 integration-test shape).

### Ledger clear-sign coverage (planning-time research item)

- **D-12:** Researcher MUST verify ERC-7730 registry coverage for all 4 Lido contracts at planning gate. If clear-sign coverage is confirmed for any subset, NO LEDGER NOTICE block for those tools (matches Phase 7 Aave — confirmed clear-sign → no notice). If any tool falls back to blind-sign, emit LEDGER NOTICE block (matches Phase 6 WETH9.withdraw precedent). Research output anchors the planning-gate decision.

### Claude's Discretion

- Internal helper names (`LidoReader`, `parseLidoConversion`, `formatRebaseRewards`, etc.)
- Whether `src/signing/lido-rebase.ts` ships as its own file or folds into `src/protocols/lido.ts` (researcher/planner judgment; pure-math separation pattern from Aave/Compound is the default expectation)
- Whether `get_lido_positions` Arbitrum read uses the bridged contracts' actual storage or proxies through Ethereum L1 state (researcher verifies which path is cheaper + more reliable at planning time)
- Whether the third-party referral param in `Lido.submit` is exposed as an optional `referral` arg in `prepare_lido_stake` or hardcoded `address(0)` (default: hardcoded; surface as optional only if research surfaces a clear product reason)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project conventions

- `CLAUDE.md` — `src/config/contracts.ts` SOT discipline; fixture pinning rule; ESM spy-affordance indirection; decimal-aware arithmetic at agent boundary
- `.planning/PROJECT.md` — Project context; v2.3 milestone goals
- `.planning/REQUIREMENTS.md` §LIDO-01..05 — exact Phase 30 surface (READ this first; it's the authoritative requirement set)
- `.planning/ROADMAP.md` Phase 30 — phase goal, success criteria, plan stub
- `.planning/STATE.md` — current execution state

### Code analogs (mechanical clones expected)

- `src/protocols/weth9.ts` (Plan 06-04) — wrap/unwrap protocol-decoder pattern; Phase 30 mirrors structure for stETH↔wstETH wrap/unwrap
- `src/protocols/aave-v3.ts` (Phase 7) — multi-tool protocol-decoder pattern; Phase 30 `src/protocols/lido.ts` mirrors for stETH + WithdrawalQueue + wstETH
- `src/protocols/compound-v3.ts` (Phase 28) — per-protocol decoder with intent-vs-reality gates; Phase 30 inherits `INVALID_INPUT + hintTool` pattern for the stETH-approval pre-flight
- `src/protocols/morpho-blue.ts` (Phase 29) — universal-contract single-file decoder; matches Phase 30 single-file bundling
- `src/signing/aave-health.ts` (Phase 7) + `src/signing/compound-health.ts` (Phase 28) — pure-bigint math shape; Phase 30 `src/signing/lido-rebase.ts` clones
- `src/tools/prepare_weth_unwrap.ts` (Plan 06-04) — wrap/unwrap tool shape with LEDGER NOTICE handling (precedent for D-12 fallback)
- `src/tools/prepare_aave_supply.ts` + `prepare_compound_supply.ts` — `prepare_*` mechanical-clone shape
- `src/tools/get_lending_positions.ts` (Phase 7) — multi-position reads with on-chain state aggregation; Phase 30 `get_lido_positions` mirrors

### SOT extension points

- `src/config/contracts.ts` — extend with `LidoContracts` interface + per-chain slots (Ethereum + Arbitrum read-only); add Lido entries to `KNOWN_SPENDERS_ETHEREUM`; reserve slot ordering for downstream EigenLayer + Rocket Pool (Phase 31) so v2.3 close-out doesn't churn the table.
- `src/security/canonical-dispatch.ts` — extend `CANONICAL_DISPATCH_TARGETS` Ethereum entry with Lido write-side allowlist.
- `src/signing/blocks.ts` — extend `DECODED ARGS` switch with Lido selectors; extend block-emit surface with `[NFT RECEIPT EXPECTED]` template (D-04 anchor).

### External references

- Lido protocol docs — https://docs.lido.fi/
- Lido contracts (Ethereum):
  - stETH proxy: `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`
  - wstETH: `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0`
  - WithdrawalQueue: `0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1`
  (researcher MUST re-verify each at planning time via official Lido deployment manifest + Etherscan source verification)
- Lido contracts (Arbitrum, read-only): bridged stETH + wstETH addresses (researcher to enumerate from Lido bridge deployment manifest)
- ERC-7730 registry — https://github.com/LedgerHQ/clear-signing-erc7730-registry — researcher verifies clear-sign coverage for each Lido contract (D-12)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/protocols/weth9.ts`** — `parseAbi` + selector-hardcoding + canonical-address-re-export shape. Phase 30 wrap/unwrap clones structurally; selectors substitute (`0xea598cb0` / `0xde0e9a3e` for wstETH wrap/unwrap pending planning-time verify).
- **`src/protocols/aave-v3.ts`** — multi-method protocol decoder. Phase 30 `src/protocols/lido.ts` mirrors with 4 methods: `submit`, `requestWithdrawals`, `wrap`, `unwrap`.
- **`src/signing/aave-health.ts`** / **`compound-health.ts`** — pure-bigint math, no `JSBI` / no `bignumber.js`. Phase 30 `src/signing/lido-rebase.ts` mirrors for shares ↔ assets conversion.
- **`src/clients/etherscan.ts`** (Phase 7) — single-chain-only by construction (the per-chain plumbing gap is FROZEN until v2.4 Phase 35 escape hatch); Phase 30 `check_contract_security` extension stays Ethereum-only by inheritance.
- **`src/tools/get_lending_positions.ts`** (Phase 7) — multi-chain `Promise.allSettled` fan-out with per-chain `AbortController` 10s timeout; Phase 30 `get_lido_positions` follows.
- **`CANONICAL_DISPATCH_TARGETS`** per-chain table — additive append for Lido contracts.
- **`KNOWN_SPENDERS_ETHEREUM`** — additive entries for stETH (`approve` target for wrap + WithdrawalQueue) + wstETH; researcher to verify slot ordering keeps existing Phase 6/7/28/29 entries byte-identical.

### Established Patterns

- **Mechanical-clone-of-prior-prepare** — `prepare_lido_stake` clones `prepare_native_send` (value-bearing call); `prepare_lido_unstake` + `prepare_lido_wrap` + `prepare_lido_unwrap` clone `prepare_weth_unwrap` (single-arg ERC-20-shape call).
- **PREPARE RECEIPT verbatim relay** — every `prepare_lido_*` includes the PREPARE RECEIPT block with verbatim agent args (no elision; CLAUDE.md rule).
- **`payloadFingerprint` re-check at send time** — Phase 4 trust pipeline; FROZEN-area.
- **Fixture hardcoded literals + cross-link from consumer tests** — CLAUDE.md cryptographic-binding rule; V/W/X/Y added in `test/signing-fingerprint.test.ts`.
- **Persona-cycle byte-identity integration test** — Phase 6/7 precedent; one combined test runs the full stake → unstake → wrap → unwrap cycle across personas with re-anchored fingerprints.
- **`INVALID_INPUT + hintTool` intent-vs-reality** — Phase 28 precedent; reused for stETH-approval pre-flight (D-05).

### Integration Points

- **`src/server.ts` register-all** — additive imports for 5 new tools: `get_lido_positions`, `prepare_lido_stake`, `prepare_lido_unstake`, `prepare_lido_wrap`, `prepare_lido_unwrap`.
- **`preview_send` selector dispatch** — extend with Lido selectors so the DECODED ARGS block renders per-call.
- **`src/signing/blocks.ts`** — new `[NFT RECEIPT EXPECTED]` template for `prepare_lido_unstake` (D-04); decoded-args extensions for Lido selectors.
- **`src/config/contracts.ts`** — per-chain Lido SOT extension; KNOWN_SPENDERS_ETHEREUM additive entries.
- **`src/security/canonical-dispatch.ts`** — Ethereum Lido arm allowlist extension.

</code_context>

<specifics>
## Specific Ideas

- Lido's stETH is rebase-bearing (balance grows over time); wstETH is non-rebase (constant balance, growing redemption value). `get_lido_positions` MUST surface BOTH balances + the conversion rate so the agent renders user-meaningful equivalent values.
- WithdrawalQueue v2 (deployed 2023) replaced legacy on-demand unstake with NFT-receipt queue. Phase 30 ships against v2; v1 surface explicitly out of scope.
- `Lido.submit(referral)` accepts ETH directly (`msg.value`); no token approval needed for stake. Approval pre-flight (D-05) ONLY applies to `wrap` + `requestWithdrawals` (both consume stETH which is an ERC-20 against the wstETH + WithdrawalQueue spenders respectively).
- `WstETH.wrap` and `WstETH.unwrap` are 1-arg single-token transforms — mechanical clones of `WETH9.withdraw` shape. The 4-byte selectors differ; everything else (decimal-aware amount parsing, fingerprint composition, preview-time decoded-args) is identical.
- `requestWithdrawals` takes `uint256[] amounts` — even though Phase 30 ships single-amount only, server encodes as a 1-element array for ABI conformance. Don't add a separate single-amount overload.
- NFT-receipt `tokenId` is deterministic at prepare time via `getLastRequestId(owner) + 1`. Surfacing the expected tokenId in `[NFT RECEIPT EXPECTED]` lets the agent close the loop with the user without an extra post-tx round-trip.

</specifics>

<deferred>
## Deferred Ideas

- **`prepare_lido_claim_withdrawal`** — NFT-claim flow once unstake settles. Deferred to v2.3.x verify-phase OR a follow-up phase once user demand surfaces. Anchor: `WithdrawalQueue.claimWithdrawal(requestId)` shape.
- **Array-of-amounts in `prepare_lido_unstake`** — single-amount only in Phase 30; multi-amount batch deferred per "curation over padding."
- **Third-party Lido referral payouts** — `Lido.submit(referral)` accepts a non-zero referral address for rev-share. Phase 30 hardcodes `address(0)`; opt-in referral exposure deferred unless research surfaces a clear product reason.
- **Cross-chain stETH bridging** — Lido stETH/wstETH exist on multiple L2s (Arbitrum + Optimism + Base + Polygon zkEVM). Phase 30 reads on Arbitrum; writes Ethereum-only; bridge tools live in v2.6 BRIDGE-T1.
- **Lido LSTs beyond stETH/wstETH** — stMATIC, etc. Out of scope; v2.3 LIDO-* is stETH/wstETH only.
- **Lido validator-set + node-operator surfacing** — out of scope; v2.3 is user-facing read + stake/unstake/wrap/unwrap only.
- **Exact rebase-reward accounting** (full transfer-history scan) — Phase 30 ships approximate shares-based snapshot. Exact accounting deferred to v3.x ergonomics surface (`get_pnl_summary` extension territory).
- **v2.3 close-out SECURITY.md milestone summary section** — bundled with the final v2.3 phase (Phase 31 EigenLayer + Rocket Pool), not Phase 30.

</deferred>

---

*Phase: 30-evm-lido-stake-unstake-wrap-unwrap*
*Context gathered: 2026-05-23 (auto-mode; recommended-option selection grounded in Phases 06/07/28/29 analogs)*
