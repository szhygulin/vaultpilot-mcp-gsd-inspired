---
status: partial
phase: 33-evm-uniswap-v3-lp-verb-set
source: [33-VERIFICATION.md]
deferred_to_milestone: v2.4
deferred_per_directive: 2026-05-16 (gsd-pr-workflow memory — v2.x phases ship code-complete; real-Ledger UAT bundled into milestone close-out)
started: 2026-05-24
updated: 2026-05-24
---

# Phase 33 — Human UAT (deferred to v2.4 milestone close-out)

Per the gsd-pr-workflow memory: **v2.x phases ship "code-complete" with the real-Ledger verify-phase deferred** (bundled per the 2026-05-16 directive). These 4 end-to-end flows MUST run against a real Ledger device + live position before the v2.4 milestone closes.

## Current Test

[awaiting human testing — bundled into v2.4 milestone close-out]

## Tests

### 1. End-to-end mint via Ledger hardware wallet — UNI-05, UNI-10

**Test:** User runs `prepare_uniswap_v3_mint` for a USDC/WETH 0.05% position on Ethereum mainnet; presents handle to `send_transaction`; signs on Ledger device.

**Expected:**
- Ledger displays BLIND-SIGN HASH (NPM is not in the ERC-7730 registry — confirmed at planning time)
- User manually compares against the `payloadFingerprint` surfaced in `prepare` + `preview_send` response
- User approves on-device
- Tx confirms on Ethereum mainnet
- New NFT position appears in user's wallet
- `get_lp_positions` returns the new position with correct envelope

**Status:** pending

### 2. End-to-end rebalance (composite multicall) via Ledger — UNI-09 (load-bearing for v2.5 Safe convention)

**Test:** User has existing position; runs `prepare_uniswap_v3_rebalance({tokenId, newPriceLower, newPriceUpper})`; reviews PREPARE RECEIPT + CHECKS PERFORMED (3 step sub-blocks); signs once on Ledger.

**Expected:**
- Single Ledger signature authorizes the 3-step rebalance
- BLIND-SIGN HASH matches the single `payloadFingerprint` shown in preview (cryptographic-binding chain UNCHANGED — Phase 4 invariant verified end-to-end across composite shape)
- Tx broadcasts
- Old position emptied (liquidity=0, tokensOwed=0)
- New position minted at the new range
- `get_lp_positions` reflects the transition

**Status:** pending

### 3. Lifecycle: mint → increase → decrease → collect → burn against a live position — UNI-05..UNI-08

**Test:** User exercises full position lifecycle on a small position.

**Expected:**
- Each step prepared, signed on Ledger, confirms on-chain
- `get_lp_positions` envelope reflects state transitions correctly (liquidity adjusts; accruedFees + IL estimate update sensibly across steps)
- Burn pre-flight refuses non-empty position (T-BURN-PRECONDITION) with correct `INVALID_INPUT + hintTool` routing pointing back to `prepare_uniswap_v3_decrease_liquidity` + `_collect`

**Status:** pending

### 4. Real Ledger BLIND-SIGN HASH presentation matches LEDGER_NOTICE template instruction — T-LEDGER-BLIND-SIGN-NPM

**Test:** During any of the 6 prepare flows (mint / increase / decrease / collect / burn / rebalance), confirm the BLIND-SIGN HASH that appears on the Ledger device screen exactly matches the `payloadFingerprint` value that `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` instructs the user to compare against.

**Expected:**
- LEDGER_NOTICE block surfaces the correct comparison instruction in machine-readable form
- The hex string the user reads on-device byte-for-byte matches the hex string the agent relayed
- Single-character drift would be caught by the user — verify that the NOTICE's instruction is unambiguous enough that a non-technical user could perform the comparison

**Status:** pending

## Gaps

None — all 4 items are deferred end-to-end flows, not gaps blocking phase progression. Per v2.x phase contract, these are the canonical close-out hook for HUMAN-UAT at the milestone boundary, not per-phase blockers.

## v2.4 milestone close-out bundle

Bundle Phase 33's 4 UAT items with the other deferred v2.x UAT items per the 2026-05-16 directive:
- Phase 32 (Uniswap V3 swap) — verify-phase pending real-Ledger USB-HID + small mainnet broadcast
- Phase 33 (this phase) — 4 items above
- Future v2.4 phases (34 Curve, 35 escape hatch) — TBD
