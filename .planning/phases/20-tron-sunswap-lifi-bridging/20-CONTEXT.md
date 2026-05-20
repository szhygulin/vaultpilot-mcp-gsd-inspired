# Phase 20: SunSwap + LiFi-routed TRON↔EVM bridging — Context

**Gathered:** 2026-05-20
**Status:** Ready for planning
**Mode:** auto-discuss (decisions derived from ROADMAP success criteria + Phase 19 precedent + project conventions; placeholder CONTEXT.md from milestone-setup PR expanded into locked decisions)

<domain>
## Phase Boundary

User can swap TRX ↔ TRC-20 on SunSwap (same-chain) and bridge TRON ↔ EVM via LiFi. `prepare_sunswap_swap` consumes the SunSwap V2 router; `prepare_tron_lifi_swap` consumes the LiFi quote API and serializes the returned TRON transaction. Sandwich-MEV defense at >2% price impact mirrors Phase 14 (Jupiter) + v2.6 MEV-01 (EVM).

3 new MCP tools land in this phase: `get_sunswap_quote`, `prepare_sunswap_swap`, `prepare_tron_lifi_swap`. All consume Phase 18 TRON primitives shelf + Phase 19 `KNOWN_SPENDERS_TRON` sub-table (extended with the LiFi facet if verifiable at planning time). One new shared client module — `src/clients/lifi.ts` — factored in Plan 20-02 (v2.0 Phase 16 Solana LiFi has NOT shipped yet — Phase 20 is the LiFi shared-shelf introducer).

**Inv #6b** (decodedFinalRecipient assertion at preview) is new server-side defense in this phase — mirrors v2.0 SOL-W-21 (deferred) and v2.6 BRIDGE-T1.

No diagnostics — Phase 21.

**Out of Phase 20:**
- SunSwap V3 (concentrated liquidity tier)
- SunSwap stableswap / SunPump / other TRON-native AMMs (LiFi covers dominant cross-chain volume)
- LiFi facets beyond TRON (Polygon LiFi, Arbitrum LiFi etc. — these land in Phase 32-35 with the EVM LiFi tool)
- LiFi advanced features: fee abstraction, smart account, gas refund — out of scope
- BTC ↔ TRON bridging — revisit at v2.2 BTC milestone
- TRON-native bridges (NTRN / SUN / similar) — defer; LiFi covers dominant volume
- EVM → TRON direction shipping in Phase 20 (deferred per D-05c — ships when EVM LiFi tool lands in Phase 32-35)

</domain>

<decisions>
## Implementation Decisions

### D-01: SunSwap quote client — `src/clients/sunswap.ts` mirroring `jupiter.ts` shape

- **D-01a:** `src/clients/sunswap.ts` mirrors `src/clients/jupiter.ts` shape — `fetchSunswapQuote(params): Promise<Quote | null>`; NEVER-throws (returns `null` on RPC failure, demoted-to-null in tool layer); per-call timeout (10s); LRU cache (10 entries; 30s TTL) keyed by `(inputToken, outputToken, amount, slippageBps)`.
- **D-01b:** Quote endpoint: SunSwap V2 router `getAmountsOut(amountIn, path)` via TronGrid `triggerconstantcontract` (read-only). NOT an HTTP API — the "client" wraps the contract-call RPC for parity with `jupiter.ts` ergonomics.
- **D-01c:** `Quote` shape: `{ inAmount, outAmount, route, priceImpactBps, slippageBps, source }`. `source` is `"live"` always for SunSwap (on-chain truth; no fallback snapshot like the SR registry). Surface verbatim in CHECKS PERFORMED.
- **D-01d:** No HTTP quote API exists for SunSwap V2 — quotes are computed by `router.getAmountsOut(amountIn, [in, WTRX, out])` on-chain. SunSwap V3 (concentrated liquidity) would be different but is out of scope.

### D-02: SunSwap V2 router — SOT address + KNOWN_SPENDERS_TRON re-use

- **D-02a:** SunSwap V2 router address `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax` already lives in `src/config/contracts.ts` `KNOWN_SPENDERS_TRON` (added in Phase 19 with 5-entry list: SunSwap V2 + 4 stablecoins). Phase 20 consumes it; does NOT duplicate or inline.
- **D-02b:** Canonical-dispatch-tron allowlist extended additively — Phase 19 left the function + 4-stablecoin allowlist BYTE-IDENTICAL with caller-side-skip for Protobuf-native kinds. Phase 20 SunSwap arm IS a TriggerSmartContract — flows through the existing Layer 0.5 gate. ADDITIVE: append SunSwap V2 router to the allowlist (4 → 5 entries; function shape BYTE-IDENTICAL).
- **D-02c:** SOT remains `src/config/contracts.ts` (no inline addresses in tool implementations per CLAUDE.md).
- **D-02d:** Researcher MUST verify the V2 router address against SunSwap's official docs at research time (mainnet vs Nile testnet — Phase 20 ships mainnet first). If the canonical V2 router address drifted between Phase 19 and Phase 20 (unlikely but possible), update `KNOWN_SPENDERS_TRON` in a pre-plan amendment.

### D-03: Sandwich-MEV defense — strict-equality slippage requirement above 2% price impact

- **D-03a:** Default slippage hint = `50` bps (0.5%). Mirrors v2.0 Jupiter / Phase 14 Solana pattern + v2.6 MEV-01 EVM pattern.
- **D-03b:** Refuse when `priceImpactBps > 200` (price impact > 2%) AND `slippageBps` was NOT explicitly supplied by the agent. Refusal envelope = `INVALID_INPUT` with `hintTool: "get_sunswap_quote"` + message: `"price impact ${X}% exceeds the 2% threshold; pass slippageBps explicitly to confirm acceptance of high price impact (sandwich-MEV defense — mirrors Phase 14 Jupiter + v2.6 MEV-01 EVM)"`. Per CLAUDE.md, keeps the 21-code error union FROZEN by surfacing via existing `INVALID_INPUT` + `hintTool`.
- **D-03c:** When `slippageBps` IS explicitly supplied at any value (even very high), the request proceeds — the user has acknowledged via parameter the acceptance of high impact. Per Phase 14 Jupiter precedent (the gate is "did the user supply slippage explicitly", not "is the slippage low enough").
- **D-03d:** `priceImpactBps` is computed at quote time via `router.getAmountsOut` comparison against the spot rate from `router.getReserves(pair)` — read-only RPC; no external API.
- **D-03e:** Out-of-scope: per-LP-tier price-impact thresholds (>2% is a flat threshold for v2.1; v2.6 BRIDGE-T1 may refine per-bridge thresholds).

### D-04: LiFi TRON facet — pre-plan checkpoint deferred from Phase 19

- **D-04a:** Phase 19's RESEARCH Q1 deferred LiFi TRON facet address verification to Phase 20. The researcher MUST add a `checkpoint:human-verify` task in Plan 20-02 BEFORE committing any LiFi facet address to `src/config/contracts.ts`. Source of truth: LiFi's deployment manifest (`lifinance/contracts/deployments/<chain>` repo) or LiFi support docs.
- **D-04b:** If LiFi TRON facet is NOT confirmable at Phase 20 planning time:
  - Phase 20 ships SunSwap (Plan 20-01) ONLY; LiFi (Plan 20-02) defers to v2.2.x as a follow-up phase
  - TRON-W-10 + TRON-W-11 (LiFi requirements) carry forward with the deferral noted in REQUIREMENTS.md + ROADMAP.md amended
- **D-04c:** If LiFi TRON facet IS confirmed: extend `KNOWN_SPENDERS_TRON` (5 → 6 entries) with the facet entry + add to `canonical-dispatch-tron` allowlist (5 → 6 entries). Facet address pinned in `src/config/contracts.ts` with full provenance comment (`// LiFi TRON Diamond — sourced from <URL> on <date>`).
- **D-04d:** This is the SAME checkpoint pattern Phase 19 deferred to Phase 20 — re-run the verification with current LiFi deployment state.

### D-05: `prepare_tron_lifi_swap` argument shape and bi-directionality

- **D-05a:** Arg shape locked by ROADMAP SC #4: `{ fromChain, fromToken, toChain, toToken, amount, toAddress }`. `fromChain` must be `"tron"` OR `toChain` must be `"tron"` (XOR — bi-directional but at least one side must be TRON). Throws `INVALID_INPUT` if neither side is TRON (this tool routes TRON-side bridges only; EVM↔EVM bridges go through the v2.x EVM LiFi tool which lands in Phase 32-35).
- **D-05b:** Bi-directional but the transaction shape differs by direction:
  - **TRON → EVM**: TriggerSmartContract to the LiFi TRON facet; user signs via the standard TRON trust pipeline (Phase 18)
  - **EVM → TRON**: EVM-side LiFi calldata; routes through the EVM LiFi facet (NOT the TRON facet)
- **D-05c:** For Phase 20 scope: ship the TRON → EVM direction first; EVM → TRON direction throws `INVALID_INPUT` with `hintTool: <tbd-evm-lifi-tool>` + message `"EVM → TRON direction ships when the EVM LiFi tool lands in v2.4 (Phase 32-35); for now use the existing EVM-side native LiFi flow"` until the EVM-side LiFi tool ships. Document the limitation in the tool description + structuredContent `directionsAvailable: ["tron→evm"]`.
- **D-05d:** `toAddress` validation: if `toChain === "tron"`, expect base58check TRON address; if `toChain` is an EVM chain (`ethereum` / `arbitrum` / `polygon` / `base` / `optimism`), expect EIP-55 address. Use existing `validateAddress` helpers in `src/chains/`.
- **D-05e:** Cross-chain `toChain` Zod enum widens from `"ethereum" | "arbitrum" | "polygon" | "base" | "optimism"` (v1.2 EVM set) + `"tron"` (this phase). Solana destination deferred to v2.0 Phase 16 (not yet built) — additive when Phase 16 ships.

### D-06: Inv #6b — server-side decodedFinalRecipient assertion at preview time

- **D-06a:** At `preview_send` time, when `tronTx.kind === "lifi-bridge"` (D-09 new kind), the preview branch MUST:
  1. Decode the calldata's LiFi facet method signature (likely `swapAndStartBridgeTokensViaXxx` per LiFi's facet shape)
  2. Extract the final-recipient address from the decoded `_bridgeData.receiver` field
  3. Compare strict-equality against the `toAddress` value stored in the handle's `record.args.toAddress`
  4. If MISMATCH: refuse with `INVALID_INPUT` + `hintTool: "prepare_tron_lifi_swap"` + message: `"[REFUSED — DECODED RECIPIENT DRIFT] calldata destination ${decoded} != agent-supplied toAddress ${supplied}; re-prepare with the canonical address (mirrors v2.0 SOL-W-21 + v2.6 BRIDGE-T1)"`
- **D-06b:** Defense rationale: protects against agent-supplied `toAddress` being silently replaced by a malicious calldata constructor between prepare and preview — the LiFi quote API returns the calldata which the agent passes to the tool; if the agent (or anything between agent and MCP) tampered with the `toAddress` field at preview time, the on-chain calldata's `_bridgeData.receiver` would differ from `record.args.toAddress` and the gate refuses.
- **D-06c:** Decoder lives in `src/protocols/bridge-decoders/lifi-tron.ts` (mirrors v2.6 `bridge-decoders/*.ts` per-bridge module shape). Decoder is the unit-tested seam; the preview arm calls into it.
- **D-06d:** Test: T-BRIDGE-RECIPIENT-DRIFT — construct a handle with `toAddress: A`, mock the LiFi calldata decoder to return a different `B`, assert refusal at preview with `INVALID_INPUT + hintTool`.
- **D-06e:** Per CLAUDE.md FROZEN-area discipline, this DOES NOT add a new error code — uses existing `INVALID_INPUT` + `hintTool` pattern (same as Phase 28 Compound + Phase 20 D-03b sandwich-MEV refusal). Keeps the 21-code error union FROZEN.

### D-07: Fixture naming — sibling carve `Tron-20-{A,B}`

- **D-07a:** Phase 20 fixtures continue the phase-prefixed sibling-carve convention from Phase 19 (D-08): `Tron-20-A` (SunSwap V2 swap TriggerSmartContract — `swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline)`), `Tron-20-B` (LiFi TRON facet bridge TriggerSmartContract — `swapAndStartBridgeTokensViaXxx(_bridgeData, _swapData)`).
- **D-07b:** Hardcoded `0x...` literal anchors land in NEW sibling file `test/signing-fingerprint-tron-20.test.ts` (NOT extending `test/signing-fingerprint-tron-19.test.ts` which is now BYTE-FROZEN per Phase 19 close-out).
- **D-07c:** Cross-link from consumer tests via T9-style re-anchor (mirrors Phase 19 D-08d).
- **D-07d:** If Plan 20-02 (LiFi) defers per D-04b, then only Fixture Tron-20-A ships in Phase 20 — Tron-20-B carries forward to the LiFi follow-up phase.

### D-08: Plan structure — 2 plans strict-sequential

- **D-08a:** ROADMAP estimate of 2 plans accepted. Strict-sequential cadence per Phase 19 precedent (no parallel-eligible waves).
- **D-08b:** Plan split:
  - **20-01**: `src/clients/sunswap.ts` (contract-call wrapper mirroring `jupiter.ts`) + `get_sunswap_quote` + `prepare_sunswap_swap` + sandwich-MEV >2% refusal (`INVALID_INPUT + hintTool`) + canonical-dispatch-tron allowlist extension (4 → 5 entries) + `TronInstructionSummary` widening (`"sunswap-swap"` kind) + `preview_send` SunSwap arm + Fixture Tron-20-A
  - **20-02**: `src/clients/lifi.ts` (NEW shared client — first introducer; designed for re-use by future v2.0 Phase 16 Solana LiFi + v2.4 EVM LiFi) + `src/protocols/bridge-decoders/lifi-tron.ts` (Inv #6b decoder) + `prepare_tron_lifi_swap` (TRON → EVM direction) + `KNOWN_SPENDERS_TRON` LiFi entry (D-04c) + canonical-dispatch-tron LiFi entry + `TronInstructionSummary` widening (`"lifi-bridge"` kind) + `preview_send` LiFi arm with decodedFinalRecipient assertion + SECURITY.md §6 update + Fixture Tron-20-B
- **D-08c:** If Plan 20-02 defers per D-04b: Phase 20 ships only Plan 20-01 + a phase close-out chore PR; LiFi work + Inv #6b decoder + new `TronInstructionSummary` kind reschedule to a follow-up phase (likely v2.2.x). ROADMAP + REQUIREMENTS amended at close-out.
- **D-08d:** Plan dependencies: 20-02 depends on 20-01 (sibling-carve sequencing — `TronInstructionSummary` widened twice, additive both times; canonical-dispatch-tron allowlist grown twice, additive both times; preview_send arms added once each).

### D-09: ADDITIVE WIDENING permitted

Following Phase 19 D-11a precedent, the following ADDITIVE widening is PERMITTED:
- `src/signing/handle-store.ts` — `TronInstructionSummary` union: 2 new kinds (`"sunswap-swap"`, `"lifi-bridge"`)
- `src/signing/blocks-tron.ts` — APPEND-ONLY: SunSwap/LiFi PREPARE RECEIPT templates + sandwich-MEV refusal block + bridge-recipient-drift refusal block
- `src/security/canonical-dispatch-tron.ts` — additive: SunSwap V2 router + LiFi TRON facet (if confirmed) appended to allowlist; function + existing 4 entries BYTE-IDENTICAL
- `src/tools/preview_send.ts` TRON branch — additive: 2 new decode arms (sunswap-swap with sandwich-MEV check; lifi-bridge with Inv #6b)
- `src/tools/send_transaction.ts` + `src/tools/get_tx_verification.ts` TRON branches — additive dispatch arms
- `src/config/contracts.ts` `KNOWN_SPENDERS_TRON` — extend with LiFi facet entry (if D-04c)
- `src/tools/register-all.ts` — 3 new tool imports
- `src/signing/error-codes.ts` — BYTE-UNTOUCHED (per D-03b + D-06e — `INVALID_INPUT + hintTool` pattern keeps the 21-code union FROZEN)

BYTE-UNTOUCHED (consume only):
- `src/signing/payload-fingerprint-tron.ts` / `presign-hash-tron.ts` / `simulation-tron.ts` / `amount-tron.ts`
- All Phase 18 + Phase 19 protocols (`tron-native`, `tron-trc20`, `tron-approve`, `tron-stake`, `tron-vote`, `tron-sr-registry`)
- All Phase 18 + Phase 19 prepare tools (9 tools total)
- `test/signing-fingerprint-tron.test.ts` (Phase 18)
- `test/signing-fingerprint-tron-19.test.ts` (Phase 19)
- `src/signing/error-codes.ts` (21-code union FROZEN per D-06e — Inv #6b uses `INVALID_INPUT + hintTool`)

### D-10: Out-of-scope items (captured for backlog)

- Multi-hop SunSwap routes (V2 path optimizer beyond pair-direct via WTRX) — V2 router's `getAmountsOut` supports arbitrary paths; ship with `[in, WTRX, out]` as default
- SunSwap V3 (concentrated liquidity tier)
- SunSwap stableswap / SunPump
- LiFi facets beyond TRON (Polygon LiFi, Arbitrum LiFi etc. — Phase 32-35 with EVM LiFi tool)
- EVM → TRON direction shipping in Phase 20 (deferred per D-05c)
- LiFi advanced features (fee abstraction, smart account, gas refund)
- BTC ↔ TRON bridging — v2.2 BTC milestone
- TRON-native bridges (NTRN / SUN / similar) — defer; LiFi covers dominant volume

### D-11: FROZEN-vs-additive-widening discipline (re-affirmation of Phase 19 D-11a)

Re-affirms Phase 19 D-11a precedent. Strict BYTE-UNTOUCHED reserved for cryptographic-binding primitives + Phase 18 + Phase 19 protocol modules + Phase 18 + Phase 19 prepare tools + Phase 18 + Phase 19 fingerprint test files + the `error-codes.ts` 21-code union. Additive widening permitted in the surface listed in D-09.

Phase 20 chooses NOT to add a new error code (`BRIDGE_RECIPIENT_DRIFT` was considered and rejected in favor of `INVALID_INPUT + hintTool` pattern per D-06e) — keeping the 21-code union FROZEN through v2.1. Future phases may add codes if the invariant warrants it; for v2.1 the existing pattern suffices.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — ESM spy-affordance + hardcoded fixture literals + decimal-aware arithmetic + PREPARE RECEIPT verbatim + FROZEN-area discipline + `src/config/contracts.ts` SOT
- `.planning/REQUIREMENTS.md` §TRON-W-09..11 — exact Phase 20 surface (TRON-W-09 SunSwap swap + sandwich-MEV defense + canonical-dispatch; TRON-W-10 LiFi bi-directional bridge; TRON-W-11 Inv #6b decodedFinalRecipient assertion)
- `.planning/ROADMAP.md` Phase 20 — Goal / Success Criteria / Plans (estimate)

### Pattern references
- `src/clients/jupiter.ts` (Plan 14-01 if shipped; currently NOT shipped per STATE.md — v2.0 Phase 14 still planned) — analog HTTP-client shape for D-01 SunSwap quote client. If `jupiter.ts` not yet on `main`, the Phase 20 planner factors `src/clients/sunswap.ts` as a NEW module without an existing analog; researcher should call this out at research time.
- `src/protocols/tron-trc20.ts` (Plan 18-03) — TriggerSmartContract encoder shape for SunSwap V2 swap calldata
- `src/protocols/tron-approve.ts` (Plan 19-01) — TRC-20 spender pattern (SunSwap router needs TRC-20 approve first; agent typically calls `prepare_tron_token_approve(spender=router, amount=swapAmount)` then `prepare_sunswap_swap(...)`)
- `src/security/canonical-dispatch-tron.ts` (Plans 18 + 19) — additive allowlist extension pattern
- `src/security/canonical-dispatch.ts` (Plan 09-04) — Layer 0.5 dispatch-allowlist wiring pattern; Phase 20 TRON arm continues the pattern
- `src/tools/preview_send.ts` TRON branch (Phase 18 + Phase 19 arms) — sibling-carve pattern for new kinds

### Project conventions documented
- `.planning/phases/19-tron-approve-stake2/19-CONTEXT.md` — D-08 fixture sibling carve + D-11a ADDITIVE-WIDENING precedent (Phase 20 inherits + re-affirms)

### External references
- SunSwap V2 — https://sunswap.com/ ; router contract docs at https://docs.sun.io/
- LiFi quote API — https://docs.li.fi/li.fi-api ; TRON-side support docs
- LiFi deployment manifest — https://github.com/lifinance/contracts (researcher verifies TRON facet at planning time)

</canonical_refs>

<specifics>
## Specific Ideas

### SunSwap V2 quote computation

`router.getAmountsOut(amountIn, path: [in, WTRX, out])` returns `[amountIn, amountIntermediate, amountOut]`. Price impact computed as `(spotRate - effectiveRate) / spotRate * 10000` where `spotRate = router.getReserves(pair).reserveOut / router.getReserves(pair).reserveIn` for direct-path; for V2 hop-through-WTRX, the worst-case of the two pair impacts.

### SunSwap V2 swap calldata

`swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline)`. `amountOutMin = expectedOut * (10000 - slippageBps) / 10000`. `deadline = now + 600` (10 min — bounded by Phase 18 `extendExpiration(tx, 900)` handle TTL + the 5-min user-pause budget).

### LiFi TRON facet calldata decode

LiFi facets typically follow the pattern `swapAndStartBridgeTokensViaXxx(_bridgeData, _swapData[])`. `_bridgeData` struct: `(transactionId, bridge, integrator, referrer, sendingAssetId, receiver, minAmount, destinationChainId, hasSourceSwaps, hasDestinationCall)`. The `receiver` field is the final-recipient that Inv #6b asserts against `toAddress`.

For the TRON-side facet (TriggerSmartContract), the calldata is the Solidity ABI of the same struct (TRON uses Solidity for smart contracts). Decode via `viem.decodeFunctionData` against the facet ABI — researcher verifies the ABI at planning time.

### Persona discipline

Re-use Phase 17 + 18 + 19 TRON whale persona for fixture anchoring. No new persona required for Phase 20.

### TRC-20 approve before SunSwap swap

SunSwap swaps require the user to approve the router for the inputToken first. The agent typically calls:
1. `prepare_tron_token_approve({ tokenAddress: inputToken, spender: <SunSwap router>, amount: <swapAmount> })` → user signs
2. `prepare_sunswap_swap({ inputToken, outputToken, amount, slippageBps })` → user signs

Phase 20 does NOT auto-prepare the approve — the agent decides whether to call it based on user intent. The tool description for `prepare_sunswap_swap` notes "ensure inputToken approval exists; use `prepare_tron_token_approve` first if needed".

### Test mocking strategy

Per CLAUDE.md, for external network clients prefer `vi.stubGlobal("fetch", ...)` at the network boundary. For SunSwap (RPC-via-`triggerconstantcontract`), the mocking happens at the `tronWeb.transactionBuilder` boundary (mock the `triggerConstantContract` method). For LiFi (HTTP quote API), `vi.stubGlobal("fetch", ...)`.

</specifics>

<deferred>
## Deferred Ideas

- TRON setup-status diagnostic + multi-chain portfolio TRON branch — Phase 21
- SunPump / other TRON-native AMMs — out of scope for v2.1
- Cross-chain TRC-20 → Solana SPL via LiFi multi-hop — composes through v2.0 Phase 16 (not yet built) + Phase 20 TRON-W-11; no new tool needed
- TRON-native bridges (NTRN / SUN / similar) — defer; LiFi covers dominant cross-chain volume
- SunSwap V3 (concentrated liquidity tier) — separate phase
- SunSwap stableswap pools — separate phase
- LiFi advanced features (fee abstraction, smart account, gas refund) — separate phase
- LiFi facets beyond TRON (Polygon LiFi, Arbitrum LiFi — Phase 32-35 with EVM LiFi tool)
- EVM → TRON direction (deferred per D-05c — ships when EVM LiFi tool lands)
- BTC ↔ TRON bridging — revisit at v2.2 BTC milestone
- Multi-hop SunSwap routes beyond `[in, WTRX, out]` direct path
- SR-rotation-detection alerts — out of scope per Phase 19 D-05d (inherited)

</deferred>

---

*Phase: 20-tron-sunswap-lifi-bridging*
*Context gathered: 2026-05-20 via auto-discuss mode (placeholder expanded into LOCKED decisions; derived from ROADMAP success criteria + Phase 19 precedent + project conventions; researcher checkpoint deferred to LiFi TRON facet address verification per D-04a)*
