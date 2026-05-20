# Phase 19: TRC-20 approve + Stake 2.0 (freeze/unfreeze/withdraw-expire-unfreeze/vote/claim) — Context

**Gathered:** 2026-05-20
**Status:** Ready for planning

<domain>
## Phase Boundary

User can approve TRC-20 spenders (with the `⚠ UNLIMITED APPROVAL` surfacing pattern from Phase 6 ERC-20) and run the full TRON Stake 2.0 lifecycle — freeze TRX for resources (Energy or Bandwidth), unfreeze, withdraw-expire-unfreeze after the 14-day waiting period, vote for super representatives, and claim accumulated voting rewards.

Strictly **Stake 2.0** — `FreezeBalanceV2Contract` / `UnfreezeBalanceV2Contract` / `WithdrawExpireUnfreezeContract`. Legacy Stake 1.0 (`FreezeBalanceContract`) is deprecated by TRON network as of `tronprotocol/java-tron@4.6.0` and explicitly out of scope.

7 new MCP tools land in this phase: `prepare_tron_token_approve`, `prepare_tron_revoke_approval`, `prepare_tron_stake_freeze`, `prepare_tron_stake_unfreeze`, `prepare_tron_withdraw_expire_unfreeze`, `prepare_tron_stake_vote`, `prepare_tron_stake_claim_rewards`. All consume the Phase 18 TRON primitives shelf (`_tronFingerprint` + `_tronPresign` + `parseTronAmountStrict` + `extendExpiration` + `canonical-dispatch-tron` + `blocks-tron`) — no new primitives ship in Phase 19.

No DEX yet — Phase 20 lands SunSwap + LiFi bridging. No diagnostics — Phase 21.

**Out of Phase 19:** Stake 1.0 legacy support; Stake 2.0 delegate-to-other-account flow (delegating Energy/Bandwidth to a third party — deferred); TRC-721 / TRC-1155 approve (NFT support is v3.1); voting power transfer between SRs in a single tx.

</domain>

<decisions>
## Implementation Decisions

### D-01: TRC-20 approve byte-identity invariant

- **D-01a:** Shared internal helper `prepareTronApproveInternal({ from, tokenAddress, spender, amount })` enforces by construction that `prepare_tron_revoke_approval({T, S})` produces the byte-identical `raw_data_hex` + `payloadFingerprint` as `prepare_tron_token_approve({T, S, amount: "0"})`. Mirrors v1.1 Phase 6 `prepareApproveInternal` shape exactly.
- **D-01b:** Byte-identity asserted via T-TRON-REVOKE-DRIFT-1 test: build both transactions, assert `rawDataHex` equality + `payloadFingerprint` equality at the byte level. Mirrors v1.1 T-REVOKE-DRIFT-1.
- **D-01c:** Distinct tool registrations for `prepare_tron_token_approve` and `prepare_tron_revoke_approval` so the agent calls each by intent (mirrors v1.1 PREP-27 design discipline).

### D-02: Unlimited-approval surfacing

- **D-02a:** Strict-equality `amount === "115792089237316195423570985008687907853269984665640564039457584007913129639935"` (MAX_UINT256 decimal string) → `⚠ UNLIMITED APPROVAL` label at preview. Mirrors v1.1 PREP-29 exact shape. Reject case variants (`"max"` is accepted as the sentinel ALIAS that converts to MAX_UINT256 — same `"max"` literal as Phase 28 Compound's repay-all per CMP-05 wording).
- **D-02b:** Sentinel-aliasing: `amount: "max"` → MAX_UINT256 (lowercase strict-equality; rejects `"MAX"` / `"unlimited"` / `"infinite"`). Reuses Phase 28's anti-typo defense pattern.
- **D-02c:** PREPARE RECEIPT surfaces the canonical decimal-string `amount` value verbatim (the agent's input — not the resolved MAX_UINT256 expansion). The on-device clear-sign label is what the user sees; surfacing the agent's literal in PREPARE RECEIPT preserves the audit trail.

### D-03: Stake 2.0 only — Energy + Bandwidth resource enum

- **D-03a:** Phase 19 ships ONLY Stake 2.0 (`FreezeBalanceV2Contract`). Stake 1.0 (`FreezeBalanceContract`) is deprecated by TRON and explicitly out of scope (no fallback, no compat shim).
- **D-03b:** `prepare_tron_stake_freeze({ amount, resource: "ENERGY" | "BANDWIDTH" })` — single tool with enum, NOT two sibling tools. Resource enum surfaced verbatim in `CHECKS PERFORMED` block (e.g. `"resource: ENERGY (freezes TRX for TRC-20/contract-call resource)"`).
- **D-03c:** `prepare_tron_stake_unfreeze({ amount, resource })` mirrors. `prepare_tron_withdraw_expire_unfreeze` is a no-arg tool (the contract takes no parameters; the protocol auto-withdraws all expired-unfreeze records for the caller).

### D-04: 14-day waiting period — informational surfacing only

- **D-04a:** 14-day unfreeze waiting period is NOT enforced server-side. `CHECKS PERFORMED` block emits explicit text: `"Unfreeze becomes withdrawable after 14 days; this tx initiates the waiting period."`.
- **D-04b:** `prepare_tron_withdraw_expire_unfreeze` does NOT pre-check waitlist state at prepare time. The simulation gate (Layer 0.7 — `triggerconstantcontract` via simulation-tron) catches "no withdrawable balance" at preview time and surfaces the failure verbatim. No server-side time-tracker.
- **D-04c:** Cheaper than building a time-tracker; honoring "preview is the gate" discipline. Users who submit too early get the simulation refusal envelope at preview, not at broadcast.

### D-05: Super-representative validation — hybrid registry (live + snapshot fallback)

- **D-05a:** SR registry hybrid policy: primary fetch via `tronWeb.trx.listSuperRepresentatives()` (TronGrid `wallet/listwitnesses` endpoint) at prepare time; on RPC failure, demote to bundled snapshot fallback `src/tokens/tron-srs.json`.
- **D-05b:** Response surfaces `srSource: "live" | "snapshot-fallback"` in CHECKS PERFORMED block per-call so the trust source is unambiguous (mirrors `rpcDegraded` surfacing pattern from READ-05). Snapshot files are committed alongside `tron-top-25.json` curation discipline and refreshed on each release.
- **D-05c:** Per-SR labeling: known SR (in registry) → `(SR: <name> — vote rank <N>)`; unknown SR → `(unverified SR — confirm address)`. Labels are advisory UI hints; the actual `srAddress` in calldata is the trust anchor that Ledger displays for user approval on-device.
- **D-05d:** Out-of-scope: SR-rotation-detection alerts (6-hour rotation cadence — drift between snapshot and live is bounded by release cadence; not worth gate-level enforcement).

### D-06: Voting rewards — advisory `estimatedRewardSun` (best-effort, demote-to-null on failure)

- **D-06a:** `prepare_tron_stake_claim_rewards` is a no-arg tool producing `WithdrawBalanceContract()` (the protocol takes no parameters). Calldata carries NO user intent; the reward amount is computed by the protocol at broadcast time.
- **D-06b:** Best-effort `getRewardInfo(address)` fetch at prepare time (TronGrid `wallet/getrewardinfo` endpoint). Surface as ADVISORY: (1) `CHECKS PERFORMED` block emits `"estimated reward at prepare time: X SUN; final amount computed at broadcast"`; (2) typed nullable field `estimatedRewardSun: string | null` in the structured response. Fetch failure demotes to `estimatedRewardSun: null` + `"estimate unavailable (RPC failure)"` in CHECKS PERFORMED.
- **D-06c:** NO intent-vs-reality gate (deliberate departure from Phase 28 Compound's `INVALID_INPUT + hintTool` pattern). Calldata has NO args to mismatch against — `WithdrawBalanceContract()` is zero-arg; there's nothing to gate. Surfacing the estimate is information for the user, not a refusal trigger.

### D-07: Spender labels table extension

- **D-07a:** `src/config/contracts.ts` extends with TRON sub-table `KNOWN_SPENDERS_TRON`. Entries: SunSwap V2 router (`TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax`), LiFi TRON facet (verified address from LiFi's deployment manifest at planning time), canonical TRC-20 stablecoins (USDT-TRC20 / USDC-TRC20 / USDD / TUSD as KnownSpender entries — although these are token contracts not spenders in the typical sense, surfacing them avoids the `(unknown spender)` fallback when a user approves a token to itself for some self-allowance flow).
- **D-07b:** Unknown spender → `(unknown spender — no prior interaction recorded)` label (mirrors v1.1 PREP-30 known-spender pattern verbatim).
- **D-07c:** SOT for canonical addresses remains `src/config/contracts.ts` (no inline addresses in tool implementations per CLAUDE.md convention).

### D-08: Fixture naming — sibling carve `Tron-19-{A,B,C,D}`

- **D-08a:** Phase 19 fixtures use NEW phase-prefixed naming convention: `Tron-19-A` (TRC-20 approve), `Tron-19-B` (FreezeBalanceV2 freeze), `Tron-19-C` (VoteWitnessContract vote), `Tron-19-D` (WithdrawBalanceContract claim). Departs from the EVM-side A-F + Phase 12 K-L + Phase 18 M-N single-letter convention.
- **D-08b:** Rationale: Phase 19 ships 4 distinct tx shapes — reserving 4 single letters per phase doesn't scale through v2.x. Phase-prefixed names anchor each fixture to its source phase + leaves the single-letter pool for cross-chain primitives. Future TRON phases (20 SunSwap, 21 diagnostics) will use `Tron-20-{X}` / `Tron-21-{X}` sibling-carve.
- **D-08c:** Hardcoded `0x...` literal anchors land in NEW sibling file `test/signing-fingerprint-tron-19.test.ts` (NOT extending `test/signing-fingerprint-tron.test.ts` which holds Phase 18's M + N anchors — keeps Phase 18's fingerprint test file BYTE-UNTOUCHED per FROZEN-area discipline). NO `beforeAll`-snapshot — drift must fail at a specific line.
- **D-08d:** Cross-link from consumer tests (`prepare-tron-token-approve.test.ts`, `prepare-tron-stake-freeze.test.ts`, etc.) via T9-style re-anchor — each consumer rebuilds the TX and asserts the literal matches at the consumer call site.

### D-09: Plan structure — 4 plans strict-sequential

- **D-09a:** ROADMAP estimate of 4 plans accepted as-is. Strict-sequential cadence per Phase 18 precedent (no parallel-eligible waves).
- **D-09b:** Plan split:
  - **19-01**: `prepare_tron_token_approve` + `prepare_tron_revoke_approval` + shared `prepareTronApproveInternal` helper + Fixture Tron-19-A literal anchor + TRON spender table extension
  - **19-02**: `prepare_tron_stake_freeze` + `prepare_tron_stake_unfreeze` + `prepare_tron_withdraw_expire_unfreeze` (Stake 2.0 Protobuf contracts) + Fixture Tron-19-B literal anchor
  - **19-03**: `prepare_tron_stake_vote` + `prepare_tron_stake_claim_rewards` + SR registry hybrid loader + Fixtures Tron-19-C + Tron-19-D literal anchors
  - **19-04**: Lifecycle integration test (freeze → unfreeze → withdraw-expire-unfreeze multi-tx flow with `vi.setSystemTime` mocking the 14-day waiting period) + cross-plan FROZEN-area assertions + SECURITY.md TRON-19 sub-section update

### D-10: Lifecycle integration test in Wave 4

- **D-10a:** Lifecycle integration test ships in this phase (Plan 19-04), NOT deferred to Phase 21 v2.1 close-out. Mirrors Phase 18's pattern (load-bearing integration test in the last wave).
- **D-10b:** `test/lifecycle-tron-stake-19.integration.test.ts` covers freeze → unfreeze → 14-day-elapsed → withdraw-expire-unfreeze multi-tx flow. `vi.setSystemTime` advances the test clock past the 14-day window between unfreeze and withdraw.
- **D-10c:** Persona-cycle byte-identity NOT load-bearing here (Phase 18 already proved this for native TRX + TRC-20). Phase 19 integration test focuses on multi-tx lifecycle correctness + Stake 2.0 contract Protobuf round-trip.

### D-11: FROZEN-area discipline

- **D-11a:** Phase 18 TRON primitives shelf BYTE-FROZEN: all `src/signing/*-tron.ts` + `src/protocols/tron-native.ts` + `src/protocols/tron-trc20.ts` + `src/security/canonical-dispatch-tron.ts` + `src/signing/handle-store.ts` + Phase 18 prepare tools. Phase 19 CONSUMES; never modifies.
- **D-11b:** v1.1 EVM approve/revoke siblings BYTE-FROZEN: `src/tools/prepare_token_approve.ts` + `src/tools/prepare_revoke_approval.ts` + their shared helper `prepareApproveInternal`. Phase 19 NEVER extends — the v1.x approve surface is the analog reference, not a base class.
- **D-11c:** Three-gate FROZEN region of `send_transaction.ts` BYTE-IDENTICAL — Phase 19 adds NO new dispatch arms (all 7 new tools are `prepare_*` only; they create handles consumed by the existing TRON dispatch arm at preview/send time).
- **D-11d:** `test/signing-fingerprint-tron.test.ts` (Phase 18 M + N anchors) BYTE-UNTOUCHED — Phase 19 uses NEW sibling file `test/signing-fingerprint-tron-19.test.ts`.
- **D-11e:** `src/signing/error-codes.ts` 23-code locked union UNCHANGED. Phase 19 reuses existing codes (`INVALID_INPUT`, `DISPATCH_TARGET_REFUSED`, `SIMULATION_REFUSED`, `LEDGER_REJECTED`, `BROADCAST_FAILED`).

### Claude's Discretion

- Internal helper names: `prepareTronApproveInternal` (mirrors `prepareApproveInternal`), `prepareTronStakeInternal` (shared shape for the freeze/unfreeze/withdraw-expire triple), `buildTronVoteContract`, `buildTronClaimContract`.
- Per-fixture literal anchor values — researcher computes via `node -e` at execute time and pins as hardcoded literals.
- `tron-srs.json` snapshot file shape — researcher selects a structure that mirrors `tron-top-25.json`'s discipline; per-entry decimals/labels are open.
- LiFi TRON facet exact address — researcher verifies against LiFi's deployment manifest at planning time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher + planner) MUST read these before acting.**

### Project context
- `CLAUDE.md` — ESM spy-affordance + cryptographic-binding fixture pinning + decimal-aware arithmetic conventions
- `SECURITY.md` — TRON section (Phase 18) + threat model + three-gate FROZEN region invariant
- `.planning/REQUIREMENTS.md` §TRON-PREP-05 + §TRON-W-03..08 — exact Phase 19 surface
- `.planning/ROADMAP.md` Phase 19 — Goal / Success Criteria / Plans
- `.planning/phases/18-tron-native-trc20-trust-pipeline/18-CONTEXT.md` + `18-RESEARCH.md` — TRON primitives that Phase 19 consumes
- `.planning/phases/18-tron-native-trc20-trust-pipeline/18-04-SUMMARY.md` — preview/send/verification TRON branches that Phase 19 plugs into

### Pattern references (mirror exactly)
- `src/tools/prepare_token_approve.ts` + `src/tools/prepare_revoke_approval.ts` (Plan 06-03) — shared-helper byte-identity invariant; TRON sibling clones the shape exactly
- `src/signing/blocks.ts` `UNLIMITED_APPROVAL_TEMPLATE` (Plan 06-03) — strict-equality MAX_UINT256 surfacing
- `src/config/contracts.ts` KNOWN_SPENDERS_* (Plan 06-03) — known-spender table extension pattern; TRON sub-table extends
- `src/signing/blocks-tron.ts` (Plan 18-01) — 7 templates; Phase 19 likely adds 2-3 new templates (UNLIMITED_APPROVAL_TRON_TEMPLATE, STAKE_RESOURCE_TRON_TEMPLATE, REWARD_ESTIMATE_TRON_TEMPLATE)
- `src/signing/payload-fingerprint-tron.ts` + `src/signing/presign-hash-tron.ts` (Plan 18-01) — consumed unchanged
- `test/signing-fingerprint-tron.test.ts` (Plan 18-01) — Phase 18's Fixtures M + N anchor pattern; Phase 19 ships sibling file with Tron-19-{A,B,C,D}

### Phase 28 anti-pattern reference (deliberate departure)
- `src/tools/prepare_compound_repay.ts` (Plan 28-03) — `INVALID_INPUT + hintTool` intent-vs-reality gate. **Phase 19 deliberately does NOT replicate this for `prepare_tron_stake_claim_rewards`**: calldata is zero-arg `WithdrawBalanceContract()`; no user intent to gate against (per D-06c).

### External
- TRON Stake 2.0 mechanism — https://tronprotocol.github.io/documentation-en/mechanism-algorithm/stake2.0/
- TRON Super Representative list (live endpoint) — https://api.trongrid.io/wallet/listwitnesses
- TRON `getRewardInfo` (voting rewards) — https://api.trongrid.io/wallet/getrewardinfo
- TRC-20 standard — https://github.com/tronprotocol/tips/blob/master/tip-20.md
- LiFi deployment manifest (TRON facet) — https://github.com/lifinance/contracts (verify at research time)
- TIP-491 (Stake 2.0 spec) — https://github.com/tronprotocol/tips/blob/master/tip-491.md

</canonical_refs>

<specifics>
## Specific Ideas

- **Byte-identity invariant** for approve/revoke is the load-bearing test contract — without it, an attacker who tampers with the agent's revoke call could substitute `approve(spender, very-large-value)` and the user wouldn't see the difference unless they read the on-device clear-sign value byte-for-byte. The shared internal helper enforces by construction.
- **14-day waiting-period UX**: Phase 19 doesn't block re-submission. Users who submit `prepare_tron_withdraw_expire_unfreeze` too early get the simulation refusal envelope at preview-time (Phase 18's Layer 0.7 gate fires because `triggerconstantcontract` against `WithdrawExpireUnfreezeContract` with no withdrawable balance returns `REVERT` with `"no withdrawable balance"`). Cheaper than building a server-side time-tracker.
- **Lifecycle integration test** uses `vi.setSystemTime(originalTime + 15 * 86400 * 1000)` to mock the 14-day elapsed window between the unfreeze tx and the withdraw-expire tx. The test asserts that within a single test run, the freeze → unfreeze → mock-time-advance → withdraw flow produces the expected sequence of `payloadFingerprint` values + the simulation envelope at each preview gate evolves from "no withdrawable balance" → "withdrawable balance found" across the time advance.
- **Energy vs Bandwidth distinction surface**: Energy is consumed by TRC-20 transfers and contract calls; Bandwidth is consumed by transaction broadcast (signature). Freezing for Energy reduces TRC-20 transfer costs; freezing for Bandwidth reduces native send costs. The resource enum is surfaced verbatim in `CHECKS PERFORMED` so users see which resource market they're entering.
- **SR rotation cadence** (6 hours) is significantly faster than our snapshot refresh cadence (per-release, ~weeks). The hybrid policy is deliberately tolerant of this drift — the SR label is advisory; the actual `srAddress` in calldata is what the Ledger displays for user approval, so a stale label is degraded UX, not a trust-boundary failure.
- **Voting rewards estimate** is computed by `getRewardInfo` which reads the protocol's `votes` mapping × current SR reward rate. The protocol may revise the rate between estimate-time and broadcast-time; the actual reward is what `WithdrawBalanceContract()` resolves to at broadcast. Surface the estimate as advisory in CHECKS PERFORMED + typed nullable field; never gate on it.

</specifics>

<deferred>
## Deferred Ideas

- **SunSwap V2 swap + LiFi TRON bridging** — Phase 20
- **TRON multi-chain portfolio extension + setup diagnostic** — Phase 21
- **Legacy Stake 1.0 support** — out of scope (deprecated by TRON network; no v3.x reconsideration)
- **Stake 2.0 delegate-to-other-account flow** (delegating Energy/Bandwidth to a third party) — defer; surface as future work in REQUIREMENTS.md if cross-account staking becomes a user request
- **TRC-721 / TRC-1155 approve** — out of scope (NFT support is v3.1)
- **Voting power transfer between SRs in a single tx** — out of scope (TRON's `VoteWitnessContract` requires unvote-then-vote sequence; single-tx vote-transfer not supported by protocol)
- **SR-rotation-detection alerts** — out of scope (6-hour rotation cadence; snapshot drift is bounded by release cadence and labels are advisory not trust-boundary)
- **Stake-claim accounting auto-reconciliation** — out of scope (the typed `estimatedRewardSun` field is sufficient surface; downstream agents can build "claim if > X" patterns on top)

</deferred>

---

*Phase: 19-tron-approve-stake2*
*Context gathered: 2026-05-20 (consolidated from placeholder + Phase 18 lessons + advisor-research on SR caching + voting rewards surfacing)*
