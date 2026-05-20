# Phase 17: TRON scaffolding — USB-HID transport + TRX reads + persistent TRON account — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 17`)

<domain>
## Phase Boundary

USB-HID Ledger pairing for TRON works; TRX balance readable via TronGrid (default) or `TRON_RPC_URL` override; paired TRON account persists via the v2.0 Phase 11 `non-evm-account-store.ts` infrastructure under `chain: "tron"` record key (zero infrastructure change — the cache schema already supports `"tron"` per PAIR-NEV-03). Demo mode extends with a curated TRON whale persona.

No signing yet — Phase 18 lands the TRON trust pipeline. No DeFi yet — Phases 19-20 land approvals + staking + SunSwap + LiFi bridging.

This is the v2.1 entry phase: it adds TRON to the chain registry, lights up the second USB-HID transport consumer (after Solana), and proves the v2.0 PAIR-NEV-* cache infrastructure scales to a second non-EVM chain without schema changes.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 17`. Anchor candidates:

- **TRON SDK choice (DF)**: `tronweb` (mature, broad ecosystem, used by every TRON dApp to date) vs `@tronprotocol/sdk` (newer official SDK). Researcher should scope-probe both at execute time per the `rnd` skill discipline; verify Protobuf raw_data serialization access (NEEDED for `payloadFingerprint` in Phase 18 — both libraries expose it but via different APIs).
- **USB-HID transport reuse**: `@ledgerhq/hw-transport-node-hid` is already the canonical Node-side transport (Phase 11 Solana); `@ledgerhq/hw-app-trx` is the Ledger TRON app interface.
- **PAIR-NEV-* schema reuse**: Phase 11's per-chain record schema already supports `chain: "tron"` via PAIR-NEV-03. Zero schema change required. `chain: "tron"` record key + derivation path BIP-44 m/44'/195'/0' (TRON's SLIP-0044 coin type).
- **TRON address format**: base58check with 0x41 version byte → "T"-prefixed addresses (e.g. `TQrZ8tQyZ8…`). Same byte representation as EVM 20-byte addresses internally (TRON uses Ethereum-derived address derivation), but external display format differs.
- **TRC-20 stablecoin set**: USDT-TRC20 + USDC-TRC20 + USDD + TUSD (curated by TVL at planning time; researcher to verify which are still active and high-volume).
- **Default RPC endpoint**: TronGrid (api.trongrid.io) public node — no API key required for reads. `TRON_RPC_URL` override supports private node deployments.
- **Demo persona**: add a TRON whale persona (e.g. a known top-50 TRX holder); demo-mode signing on TRON simulates via TRON's `triggerconstantcontract` (analog of EVM `eth_call`) rather than the EVM eth_call path (Phase 18 wires the simulation envelope shape).

### Claude's Discretion

- Internal helper names (`TronRpcClient`, `TronGridClient`, etc. — bikeshedding free)
- Whether the curated TRC-20 mint registry ships at 20-30 entries (Phase 8/11 precedent: per-chain registries shipped at 40-41 entries minimum, but TRON's relevant token surface is narrower — propose `>= 20` per the "curation over padding" pattern)
- Test mocking strategy for USB-HID (same upstream Ledger SDK as v2.0 Phase 11; reuse the mock transport pattern Phase 11 established)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — stack choices, conventions, architecture diagram
- `.planning/PROJECT.md` — v2.1 Active requirements (USB-HID transport + persistent non-EVM cache reuse + multi-chain portfolio)
- `.planning/REQUIREMENTS.md` §TRON-PAIR-* + §TRON-READ-* — exact Phase 17 requirement surface
- `.planning/ROADMAP.md` Phase 17 — Goal / Depends on / Requirements / Success Criteria / Plans

### Pattern references (v1.x + v2.0 precedents to mirror)
- `src/wallet/non-evm-account-store.ts` (v2.0 Phase 11 Plan 11-02) — canonical persistence shape; Phase 17 adds `"tron"` to the chain enum, no schema change
- `src/chains/solana/` (v2.0 Phase 11 Plan 11-01) — non-EVM chain-shelf shape; Phase 17 adds `src/chains/tron/` mirroring this exactly
- `src/tools/pair_solana_ledger.ts` (v2.0 Phase 11 Plan 11-03) — pair-tool template; Phase 17 clones for TRON with TRX-app-specific address derivation
- PR [#61](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/pull/61) — eager-init at `startServer()` before `server.connect(transport)` — race-defense rationale

### External
- `tronweb` — https://tronweb.network/docu/docs/intro/ (researcher to verify raw_data serialization API surface)
- `@tronprotocol/sdk` — alternative SDK; scope-probe at research time
- `@ledgerhq/hw-app-trx` — https://www.npmjs.com/package/@ledgerhq/hw-app-trx
- TronGrid API — https://developers.tron.network/reference (Esplora-equivalent for TRON)
- DefiLlama coins API — TRON keying `tron:<address>` documented at https://defillama.com/docs/api

</canonical_refs>

<specifics>
## Specific Ideas

- Mirror the Phase 11 Solana eager-init pattern exactly: skip silently if no TRON RPC configured; skip if storage mode is "memory"; otherwise load and restore; stderr warn-level log on failure.
- TRON addresses are 21 bytes (0x41 version + 20-byte hash). When persisting, store the base58check string form (T-prefixed); when comparing, decode to bytes. Phase 17 plans should NOT inline the address format — wrap it in a `formatTronAddress` / `parseTronAddress` helper in `src/chains/tron/address.ts`.
- The TRON ref-block window is 1 hour — `pair_tron_ledger` does NOT need ref-block handling, but Phase 18's `prepare_tron_native_send` will need it (block_header pinning at prepare-time + ref-block expiry handling at send-time).
- `list_paired_non_evm_accounts` from v2.0 already returns chain names + addresses; Phase 17 adds `"tron"` to the chain enum at the v2.0 list-tool boundary. No new list tool needed.

</specifics>

<deferred>
## Deferred Ideas

- TRON `prepare_*` / `preview_send` / `send_transaction` — Phase 18 (this phase is reads + pairing only)
- TRC-20 approve + Stake 2.0 — Phase 19
- SunSwap + LiFi TRON bridging — Phase 20
- TRON setup status diagnostic + multi-chain portfolio extension — Phase 21
- Multi-address-per-chain TRON Ledger flow (multiple derivation slots) — defer concrete UX to verify-phase feedback
- TRC-721 / TRC-1155 NFT reads — out of scope for v2.x (general NFT support is v3.1)

</deferred>

---

*Phase: 17-tron-scaffolding-usb-hid-trx-reads-persistent-accounts*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 17` time)*
