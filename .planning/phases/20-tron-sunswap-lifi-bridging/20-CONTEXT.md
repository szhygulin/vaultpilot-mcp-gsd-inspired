# Phase 20: SunSwap + LiFi-routed TRON↔EVM bridging — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 20`)

<domain>
## Phase Boundary

User can swap TRX↔TRC-20 on SunSwap (same-chain) and bridge TRON↔EVM via LiFi. `prepare_sunswap_swap` consumes the SunSwap V2 router; `prepare_tron_lifi_swap` consumes the LiFi quote API and serializes the returned TRON transaction. Sandwich-MEV defense at >2% price impact mirrors Phase 14 (Jupiter) + v2.6 MEV-01 (EVM).

This phase introduces a **shared `src/clients/lifi.ts` shelf** that should be factored if not already factored at v2.0 Phase 16 — v2.0 SOL-W-21, v2.1 TRON-W-11, v2.2 BTC-LIFI-01, and v2.6 BRIDGE-T1 facet decoders all consume the same upstream LiFi quote API.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 20`. Anchor candidates:

- **SunSwap V2 router**: address sourced from `src/config/contracts.ts` TRON sub-table; canonical-dispatch allowlist TRON arm wiring. Verify the V2 router address against SunSwap's official docs at research time (mainnet vs Nile testnet — Phase 20 ships mainnet first).
- **Default slippage hint**: 50 bps (mirrors Phase 14 Jupiter + Phase 32 Uniswap V3); refuses without explicit `slippageBps` when price impact > 2% (sandwich-MEV defense).
- **LiFi shared shelf (DF)**: factor `src/clients/lifi.ts` as a shared client (HTTP wrapper around LiFi quote API + tx serialization). v2.0 Phase 16 lands the Solana branch; Phase 20 reuses + extends with TRON. If v2.0 Phase 16 didn't factor cleanly, Phase 20 plan-checker should call out the refactor as a Plan 20-02 dependency.
- **Inv #6b extension**: `decodedFinalRecipient == userSuppliedToAddress` assertion at preview time. Mirrors v2.0 SOL-W-21 and v2.6 BRIDGE-T1. Decoder lives in `src/protocols/bridge-decoders/lifi-tron.ts` (mirrors v2.6 `bridge-decoders/*.ts` per-bridge module shape).
- **Cross-chain `toChain` Zod enum**: widens from `"solana"` (v2.0) to include `"tron"` (v2.1) — additive, no breaking change.

### Claude's Discretion

- Internal helper names (`SunSwapClient`, `LifiTronDecoder`, etc.)
- Whether `get_sunswap_quote` is a single tool or a Quoter-pattern tool with parameters
- Test mocking strategy for SunSwap (fetch-stub at the network boundary per CLAUDE.md ESM convention)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — sandwich-MEV refusal pattern; canonical-dispatch allowlist Layer 0.5
- `.planning/REQUIREMENTS.md` §TRON-W-09..12 — exact Phase 20 surface
- `.planning/ROADMAP.md` Phase 20 — Goal / Success Criteria / Plans

### Pattern references (v1.x + v2.0 precedents to mirror)
- `src/clients/jupiter.ts` (Plan 14-01) — HTTP client shape for swap-aggregator; Phase 20 mirrors for SunSwap
- `src/clients/lifi.ts` (Plan 16-01 if factored at v2.0; otherwise refactor in Phase 20) — shared LiFi client
- `src/tools/prepare_solana_lifi_swap.ts` (Plan 16-01) — LiFi-routed bridge tool template; Phase 20 clones for TRON with TRON-side decoder
- `src/security/canonical-dispatch.ts` (Plan 09-04) — Layer 0.5 dispatch-allowlist wiring pattern; Phase 20 adds TRON arm entries

### External
- SunSwap V2 — https://sunswap.com/ ; router contract docs at https://docs.sun.io/
- LiFi quote API — https://docs.li.fi/li.fi-api ; TRON-side support docs

</canonical_refs>

<specifics>
## Specific Ideas

- SunSwap V2 is a Uniswap V2-fork — similar `swapExactTokensForTokens` / `swapExactETHForTokens` ABI shape. Phase 20 can leverage existing Uniswap V2 decoders if they exist or factor a minimal SunSwap-specific decoder.
- Sandwich-MEV gate: `prepare_sunswap_swap` MUST refuse with structured `SANDWICH_MEV_REFUSED` errorCode (mirrors Phase 14 Jupiter + v2.6) when `slippageBps` is omitted AND price impact > 2%. Default `slippageBps` (when not refused) is 50 bps.
- LiFi shared shelf factoring rule: if v2.0 Phase 16 shipped `src/clients/lifi.ts` already, Phase 20 just extends. If not, Phase 20 Plan 20-02 factors it AND THEN extends. Plan-checker should detect at Phase 20 planning time and call out the dependency.
- Bridge facet decoder per Inv #6b: TRON LiFi decoder extracts `toAddress` from the calldata (after function-selector + per-step destination encoding), asserts equality against the user-supplied `toAddress`. Mismatch → structured refusal `[REFUSED — DECODED RECIPIENT DRIFT]`. Decoder regression test pins known-good calldata fixtures.

</specifics>

<deferred>
## Deferred Ideas

- TRON setup-status diagnostic + multi-chain portfolio TRON branch — Phase 21
- SunPump / other TRON-native AMMs — out of scope for v2.1
- Cross-chain TRC-20 → Solana SPL via LiFi multi-hop — works through v2.0 SOL-W-21 + Phase 20 TRON-W-11 by composition; no new tool needed
- TRON-native bridges (NTRN / SUN / similar) — defer; LiFi covers the dominant cross-chain volume

</deferred>

---

*Phase: 20-tron-sunswap-lifi-bridging*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 20` time)*
