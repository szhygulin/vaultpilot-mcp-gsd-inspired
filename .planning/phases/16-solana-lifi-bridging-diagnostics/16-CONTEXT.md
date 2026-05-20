# Phase 16: LiFi-routed EVM↔Solana bridging + Solana diagnostics — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 16`)

<domain>
## Phase Boundary

User can bridge between EVM chains and Solana via LiFi. Cross-chain destination decode lands here (Inv #6b — server-side mechanical assertion that the decoded `finalRecipient` matches the user-supplied `to`). `get_solana_setup_status` probes durable-nonce + lending-account PDA presence (analogous to v1.0 DIAG-01 `get_vaultpilot_config_status` but Solana-scoped).

This is the v2.0 milestone close-out — SECURITY.md updated with Solana-side bridge facet-decode rationale + Inv #6b extension scope. After Phase 16, v2.0 is code-complete and the v2.0 verify-phase awaits real-Ledger smoke against mainnet.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 16`. Anchor candidates:

- **LiFi SDK adoption**: LiFi exposes a `@lifi/sdk` JS package. Researcher to scope-probe at execute time — confirm UNSIGNED tx output (Ledger-compatible), Solana-side route support, and `decodedFinalRecipient` exposure in the response shape.
- **Inv #6b extension to Solana**: server-side `decodedFinalRecipient == userSuppliedToAddress` mechanical assertion at preview time, refusal on mismatch. Mirrors v2.6 BRIDGE-T1 EVM facet decoders but applied to the Solana-side decoder (different decode mechanism, same invariant).
- **Direction support**: works both directions (EVM → Solana AND Solana → EVM). Implementation likely splits at the source-chain check.
- **Allowlist extension**: LiFi program/contract IDs added to canonical-dispatch allowlist. EVM-side already present from v1.3; Solana arm is new.
- **`get_solana_setup_status` probe surface**: `{ nonceAccountPresent, marginfiAccountPresent, kaminoObligationPresent, ledgerSolAppVersion?, walletPublicKeyOnDevice }`. The probe verifies setup state without modifying anything.
- **SECURITY.md close-out**: Solana threat-model section gets a final pass — names the residual risk of cross-chain bridging (relayer trust assumptions, LiFi-routed value-in-flight, Solana-side `decodedFinalRecipient` decoder coverage gaps).

### Claude's Discretion

- Whether `prepare_solana_lifi_swap` ships as a single tool with `toChain` Zod enum widened to include `"solana"` (extending the existing EVM bridge enum) or as a distinct `prepare_lifi_evm_to_solana` + `prepare_lifi_solana_to_evm` pair. Single-tool with widened enum is the more uniform shape; researcher to confirm LiFi SDK supports both directions in one API.

</decisions>

<canonical_refs>
## Canonical References

### Project context
- `.planning/REQUIREMENTS.md` §SOL-W-21, §SOL-DIAG-01 — exact Phase 16 requirement surface
- `.planning/ROADMAP.md` Phase 16 — Success Criteria + Plans list
- `SECURITY.md` (project root) — Inv #6b cross-chain destination decode invariant + v2.0 Solana extension scope

### Pattern references
- v1.3 `src/security/canonical-dispatch.ts` — Layer 0.5 dispatch allowlist (Phase 16 extends Solana arm with LiFi)
- v1.0 `get_vaultpilot_config_status` — diagnostic-tool shape (Phase 16's `get_solana_setup_status` mirrors)
- v2.6 BRIDGE-T1 (planned) — Tier-1 facet decoders for Wormhole / Mayan / NEAR Intents / Across V3; Phase 16's LiFi Solana-side decoder is a parallel concern with the same invariant

### External
- LiFi docs — https://docs.li.fi/
- `@lifi/sdk` — https://github.com/lifinance/sdk
- LiFi Solana support announcement — researcher to surface canonical doc
- Solana CCTP (Circle Cross-Chain Transfer Protocol) — relevant for USDC bridging via LiFi routes

</canonical_refs>

<specifics>
## Specific Ideas

- The `decodedFinalRecipient` assertion is the load-bearing security property of this phase. If LiFi's Solana-side decoder doesn't expose the final recipient in machine-readable form, Phase 16 must either parse it from the serialized message OR refuse to support LiFi until upstream exposure lands (don't ship a defense-in-name-only check).
- `get_solana_setup_status` is read-only by construction — no `createHandle` import; module-load grep guard mirrors Phase 7 `T-SIMULATE-NO-HANDLE-1`.
- v2.0 milestone close-out: a final SECURITY.md pass + close-out PR mirroring Phase 10's "v1.x FULLY CODE-COMPLETE" close-out.

</specifics>

<deferred>
## Deferred Ideas

- Bridges other than LiFi (Wormhole direct, Mayan direct, Allbridge, Portal) — defer to v2.6 (parallel to EVM-side BRIDGE-T1 / BRIDGE-T2 buckets)
- BTC↔Solana bridging — defer to v2.2 (Bitcoin milestone)
- TRON↔Solana bridging — defer to v2.1 (TRON milestone)
- Cross-chain swap MEV defenses beyond Inv #6b — defer to v2.6
- Real-time Solana validator-set probe (slashing risk surfacing) — defer to v3.4 ergonomics

</deferred>

---

*Phase: 16-solana-lifi-bridging-diagnostics*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 16` time)*
