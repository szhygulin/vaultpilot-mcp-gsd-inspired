# Phase 27: Optional Bitcoin/Litecoin Core RPC + `build_incident_report` + diagnostics — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 27`)

<domain>
## Phase Boundary

Optional Bitcoin Core / Litecoin Core JSON-RPC support unlocks forensic chain reads that Esplora can't serve — chain tips, full mempool census, fee percentiles per-block, segwit/taproot adoption stats. Absent → forensic tools return `coreNotConfigured` envelope (never silent failure). `build_incident_report` bundles BTC/LTC chain-tip + mempool-anomaly signals with EVM market-incident bits for cross-chain security-event triage.

v2.2 milestone close-out: SECURITY.md BTC/LTC threat-model finalization.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 27`. Anchor candidates:

- **Bitcoin Core JSON-RPC client shape**: mirrors `src/clients/etherscan.ts` (never-throws, basic-auth via `BITCOIN_CORE_RPC_USER` + `_PASS`, 5-arm discriminated union — `not-configured | ok | rpc-error | rate-limited | network-error`).
- **`coreNotConfigured` envelope**: when `BITCOIN_CORE_RPC_URL` is absent, every forensic tool returns a structured `{ status: "core-not-configured", message: "Set BITCOIN_CORE_RPC_URL to enable forensic reads", esploraFallbackAvailable: <bool> }` envelope. Tools that have an Esplora fallback (e.g. `get_btc_block_tip` can serve a tip-only response from Esplora) surface the fallback shape; tools that don't (e.g. `get_btc_mempool_summary` needs Core RPC) refuse cleanly.
- **`build_incident_report` shape**: aggregates per-chain anomaly signals — chain-tip lag, recent reorg events (Core RPC `getchaintips`), mempool size deviations from baseline, large unconfirmed-balance changes for known wallets. Cross-chain bundling: EVM chains (via existing Phase 8 multi-chain RPC) + BTC + LTC. Returns `{ chainsProbed[], anomaliesDetected[], reportTimestamp }`.
- **SECURITY.md v2.2 finalization**: BTC/LTC threat-model section covers PSBT serialization trust shape + per-input BIP-143 sighash binding + Bitcoin Core RPC trust shape (private-node deployment recommended for forensic queries — public-RPC Core nodes are rare). LTC threat model is brief — mirrors BTC with chain-specific endpoints.

### Claude's Discretion

- Internal helper names (`BitcoinCoreRpcClient`, `IncidentReportBuilder`, etc.)
- Anomaly-detection thresholds (mempool-size deviation, large unconfirmed-balance — Phase 27 ships sensible defaults; configurable via env in future)
- Whether `build_incident_report` ships in Phase 27 or splits to a separate v2.2.x follow-up phase

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — never-throws HTTP client shape; secret-safety scan conventions for env-key surfacing
- `.planning/REQUIREMENTS.md` §BTC-FORENSIC-* + §LTC-FORENSIC-* + §BTC-INC-01 — exact Phase 27 surface
- `.planning/ROADMAP.md` Phase 27 — Goal / Success Criteria / Plans

### Pattern references (Phase 22-26 + v1.x precedents to mirror)
- `src/clients/etherscan.ts` (Plan 07-04) — never-throws + 5-arm union + basic-auth pattern; Phase 27's `bitcoin-core-rpc.ts` mirrors with JSON-RPC envelope
- `src/clients/jupiter.ts` + `src/clients/fourbyte.ts` — HTTP client shapes; Phase 27 inherits
- v1.0 DIAG-01 `get_vaultpilot_config_status` — boolean-only surfacing pattern; Phase 27's `bitcoinCoreConfigured` + `litecoinCoreConfigured` booleans follow the same convention

### External
- Bitcoin Core JSON-RPC docs — https://developer.bitcoin.org/reference/rpc/
- Litecoin Core JSON-RPC docs — https://litecoin.info/index.php/Litecoin (LTC RPC surface is BTC-compatible)

</canonical_refs>

<specifics>
## Specific Ideas

- Bitcoin Core RPC requires the user to run their own Core node (or use a hosted service like QuickNode). Phase 27 documents the setup path in SECURITY.md + README — it's an optional power-user feature, not a default.
- `get_btc_mempool_summary` is the prototypical Core-RPC-only tool (Esplora's mempool view is limited to recent-tx counts; Core RPC's `getmempoolinfo` + `getrawmempool` give the full mempool census). Phase 27 plan-checker should call out which forensic tools have Esplora fallbacks and which are Core-only.
- `build_incident_report` should be agent-friendly: structured `{ anomalies: [...] }` output that the agent can render to the user in a summary. Anomaly shapes are tagged with chain + severity + detection-method so the agent can prioritize.
- Multi-chain anomaly aggregation in `build_incident_report`: per-chain probes run in parallel via `Promise.allSettled` (mirrors Phase 8 + Phase 11 multi-chain fan-out pattern); per-chain timeout is 10s.

</specifics>

<deferred>
## Deferred Ideas

- Private/Bitcoin-Core-hosted-service auto-detection — defer; users explicitly set `BITCOIN_CORE_RPC_URL`
- Real-time mempool subscription (WebSocket from mempool.space / Core) — defer; on-demand probes suffice
- `build_incident_report` historical-window scans (last N days of anomalies) — defer; v2.2 ships point-in-time snapshot only
- Cross-chain reorg-detection alerting (push notifications when a watched chain reorgs deeper than N blocks) — defer; v2.2 ships pull-only
- LiFi/cross-chain bridge anomaly detection (volume spikes, stuck transactions) — defer to v2.6 BRIDGE-T1 follow-up

</deferred>

---

*Phase: 27-btc-ltc-core-rpc-incident-report-diagnostics*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 27` time)*
