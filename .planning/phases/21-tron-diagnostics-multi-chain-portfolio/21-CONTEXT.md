# Phase 21: TRON diagnostics + multi-chain portfolio extension — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 21`)

<domain>
## Phase Boundary

`get_tron_setup_status` probes Ledger TRX-app version + on-device address verify + Stake 2.0 resource state per-wallet (analogous to v2.0 SOL-DIAG-01 `get_solana_setup_status`). `get_portfolio_summary` extends to include TRON when configured (curated top-30 TRC-20 stablecoin registry; DefiLlama `tron:<address>` pricing). v2.1 milestone close-out — SECURITY.md TRON threat-model section finalized.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 21`. Anchor candidates:

- **Setup-status surface**: `{ ledgerTrxAppVersion?, walletAddressOnDevice, resourceAccountPresent, frozenEnergyAmount, frozenBandwidthAmount }`. Mirrors v2.0 SOL-DIAG-01 surface shape (per-wallet PDA-equivalent probe + on-device pubkey verify + Ledger app version).
- **Curated TRC-20 registry size**: 20-30 entries (`>= 20` minimum per "curation over padding"). TRON's high-volume token surface is narrower than EVM or Solana — USDT-TRC20 alone is ~40% of TRON's stablecoin volume. Registry includes USDT-TRC20, USDC-TRC20, USDD, TUSD, plus top-10 by 30d volume at planning time.
- **DefiLlama TRON keying**: `tron:<address>` (lowercase hex without T-prefix? — researcher to verify the canonical format at execute time; the address format may need transformation from base58check to hex).
- **Multi-chain portfolio TRON branch**: same `Promise.allSettled` fan-out pattern as Phase 8 EVM + Phase 11 Solana; per-chain `AbortController` 10s timeout. Per-row `chain: "tron"` field follows the multi-chain row schema.
- **SECURITY.md finalization**: TRON-side bridge facet-decode rationale (Inv #6b extension from Phase 20) + USB-HID transport trust shape vs WC v2 bridge + Stake 2.0 14-day waiting period as informational (not enforced).

### Claude's Discretion

- Whether `frozenEnergyAmount` + `frozenBandwidthAmount` are surfaced separately or as a single composite — researcher to lock based on TRON resource-API shape
- TRC-20 registry size — propose 20, 25, or 30 entries based on TVL coverage analysis at execute time
- Whether SECURITY.md updates are an atomic commit per-phase (Phase 17/18/21) or one big update at Phase 21 close-out

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — multi-chain portfolio fan-out + diagnostic-tool conventions
- `.planning/REQUIREMENTS.md` §TRON-READ-04 + §TRON-DIAG-01 — exact Phase 21 surface
- `.planning/ROADMAP.md` Phase 21 — Goal / Success Criteria / Plans

### Pattern references (v1.2 + v2.0 precedents to mirror)
- `src/tools/get_portfolio_summary.ts` (Plan 08-03 cross-chain extension + Plan 11-05 Solana branch) — multi-chain fan-out pattern; Phase 21 extends with TRON branch
- `src/tools/get_solana_setup_status.ts` (Plan 16-02) — per-wallet diagnostic-tool template; Phase 21 mirrors for TRON
- `src/tokens/solana-top-50.json` + `src/tokens/{arbitrum,polygon,base,optimism}-top-50.json` (Plan 08-03 + 11-04) — curated per-chain registry pattern; Phase 21 ships `src/tokens/tron-top-30.json`

### External
- TRON resource API — https://tronprotocol.github.io/documentation-en/api/rpc-api/walletsolidity/getaccountresource/
- DefiLlama TRON pricing — https://defillama.com/docs/api (verify TRON keying format)

</canonical_refs>

<specifics>
## Specific Ideas

- `get_tron_setup_status` lazy-loads — no extra RPC calls during boot. Probe only fires when the tool is invoked.
- DefiLlama TRON pricing may need address-format transformation (base58check → hex). Phase 21 wraps this in a `tronAddressToDefiLlamaKey` helper rather than scattering format logic through callers.
- Multi-chain portfolio TRON branch: native TRX pricing comes from DefiLlama under the chain's special key (TRON's native is `tron:0x0000…` or similar — researcher verifies).
- v2.1 milestone close-out: SECURITY.md TRON section reuses v2.0 Solana section structure (transport trust shape, fingerprint domain-tag distinction, Inv #6b extension, accepted-residual list).

</specifics>

<deferred>
## Deferred Ideas

- TRON multi-account-per-wallet UX (multiple derivation paths) — verify-phase feedback driven; PAIR-NEV-03 schema already supports multi-record-per-chain
- Per-block forensic chain reads (analogous to BTC-FORENSIC-* in v2.2 Phase 27) — TRON has chain-tip API at TronGrid; whether to ship as a separate forensic tool surface is v2.x backlog
- TRC-20 transfer history aggregation — defer; the agent can run `get_transaction_status` per-txid on demand

</deferred>

---

*Phase: 21-tron-diagnostics-multi-chain-portfolio*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 21` time)*
