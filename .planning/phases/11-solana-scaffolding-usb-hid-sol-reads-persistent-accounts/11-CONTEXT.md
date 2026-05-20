# Phase 11: Solana scaffolding — USB-HID transport + SOL reads + persistent non-EVM account cache — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 11`)

<domain>
## Phase Boundary

USB-HID Ledger pairing for Solana works; SOL + SPL balances readable via a free public RPC; paired non-EVM accounts persist to `~/.vaultpilot-mcp/non-evm-accounts.json` and restore on MCP restart (mirroring the v1.x WC-session-persistence pattern from PR #61). Demo mode extends with a curated Solana persona. Multi-chain `get_portfolio_summary` extends to include Solana when configured.

No signing yet — Phase 12 lands the Solana trust pipeline. No DeFi yet — Phase 13+ lands MarginFi / Kamino / Jupiter / staking.

This is the v2.0 entry phase: it adds Solana to the chain registry, lights up the first USB-HID transport, and introduces the persistent-account-cache infrastructure that v2.1 TRON + v2.2 BTC/LTC will both reuse.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 11`. Anchor candidates:

- **Solana SDK choice (DF)**: `@solana/web3.js` (mature, broad ecosystem, used by every Solana project to date) vs `@solana/kit` (newer; surfaces new Anchor v0.30+ types and slimmer bundle). Researcher should scope-probe both at execute time per the `rnd` skill discipline.
- **USB-HID transport**: `@ledgerhq/hw-transport-node-hid` is the canonical Node-side transport; `@ledgerhq/hw-app-solana` is the Ledger Solana app interface.
- **Persistent account cache location**: `~/.vaultpilot-mcp/non-evm-accounts.json` — same directory as `~/.vaultpilot-mcp/wc-storage/` so all VaultPilot state lives in one well-known place.
- **Eager-init pattern**: mirror PR #61 (`src/wallet/session-manager.ts` eager-init at `startServer`) — call `loadNonEvmAccounts()` BEFORE `server.connect(transport)` so first `get_solana_status` after cold boot returns `paired: true` without requiring a re-pair.
- **Schema**: per-chain record `{ chain: "solana"|"tron"|"bitcoin"|"litecoin", address, derivationPath, pairedAt: <ISO-8601>, displayName?: string }`. Atomic-write via tempfile + rename. 0o700 dir, 0o600 file.
- **Opt-out**: `VAULTPILOT_NON_EVM_STORAGE=memory` mirrors `VAULTPILOT_WC_STORAGE=memory` from quick task 260513-c8e.
- **Stale-session detection**: accounts whose `pairedAt` is older than 30 days surface `staleAccountWarning: true` with a re-pair hint.
- **Demo persona**: add a known Solana whale persona (e.g. a top-50 SOL holder); demo-mode signing on Solana simulates via `simulateTransaction` rather than `eth_call` (Phase 12 wires the simulation envelope shape).
- **Multi-chain portfolio**: `get_portfolio_summary` fan-out adds Solana when configured; per-row `chain: "solana"` field follows the Phase 8 multi-EVM convention.

### Claude's Discretion

- Internal helper names (`NonEvmAccountStore`, `SolanaRpcClient`, etc. — bikeshedding free)
- Test mocking strategy for USB-HID (the upstream Ledger SDK has its own mock transport; researcher scope-probe will determine which)
- Whether the curated SPL mint registry ships at 40-50 entries (Phase 8 precedent: per-chain registries shipped at 40-41 entries, `>= 40` minimum per "curation over padding" pattern)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — stack choices, conventions, architecture diagram
- `CONTEXT.md` — domain glossary, threat model, distribution shape
- `.planning/PROJECT.md` — v2.0 Active requirements (USB-HID transport, persistent non-EVM cache)
- `.planning/REQUIREMENTS.md` §PAIR-NEV-01..07 + §SOL-01..05 — exact Phase 11 requirement surface
- `.planning/ROADMAP.md` Phase 11 — Goal / Depends on / Requirements / Success Criteria / Plans

### Pattern references (v1.x precedents to mirror)
- `src/wallet/session-manager.ts` — WC session manager + `_storage` spy-affordance indirection (canonical persistence shape — Phase 11's `non-evm-account-store.ts` mirrors this)
- `src/wallet/walletconnect-client.ts` — `_wcStorage` indirection + lazy SignClient singleton (eager-init pattern source)
- PR [#61](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/pull/61) — eager-init at `startServer()` before `server.connect(transport)` — race-defense rationale
- Quick task 260513-c8e — `~/.vaultpilot-mcp/wc-storage/` 0o700 dir / opt-out env var convention

### External
- `@solana/web3.js` — https://solana-labs.github.io/solana-web3.js/
- `@solana/kit` — https://github.com/anza-xyz/kit (researcher to scope-probe vs web3.js)
- `@ledgerhq/hw-app-solana` — https://www.npmjs.com/package/@ledgerhq/hw-app-solana
- `@ledgerhq/hw-transport-node-hid` — https://www.npmjs.com/package/@ledgerhq/hw-transport-node-hid
- Solana RPC endpoints — https://solana.com/docs/core/clusters
- DefiLlama coins API — Solana keying `solana:<mint>` documented at https://defillama.com/docs/api

</canonical_refs>

<specifics>
## Specific Ideas

- Mirror the WC eager-init pattern in PR #61 exactly: skip silently if no Solana RPC configured (mirrors WC's "skip if no PROJECT_ID"); skip if storage mode is "memory"; otherwise load and restore; catch failures with stderr warn-level log so a missing Ledger device doesn't abort startup.
- The persistent cache holds account RECORDS (address + derivation path + paired-at), NOT cryptographic material. The Ledger remains the only thing holding private keys — the cache just remembers "which slot on which device the user paired".
- `list_paired_non_evm_accounts` should return chain names + addresses + paired-at timestamps, never derivation paths in the user-visible output (defense against shoulder-surfing — derivation path leaks the BIP44 account index).

</specifics>

<deferred>
## Deferred Ideas

- TRON / Bitcoin / Litecoin `pair_*_ledger` tools — v2.1 / v2.2 (this phase ships the cache infrastructure; v2.1+ consumers register through it)
- Solana `prepare_*` / `preview_send` / `send_transaction` — Phase 12 (this phase is reads + pairing only)
- MarginFi / Kamino / Jupiter / Marinade / Jito reads + writes — Phases 13-15
- Solana staking accounts probe (`get_solana_setup_status`) — Phase 16
- LiFi bridging — Phase 16
- Multi-address-per-chain Ledger flow (multiple derivation slots) — defer concrete UX to verify-phase feedback
- Account-cache encryption at rest — defer; the cache holds no private keys, only public addresses + derivation paths. Disk perms (0o600) match the v1.x WC-storage shape.

</deferred>

---

*Phase: 11-solana-scaffolding-usb-hid-sol-reads-persistent-accounts*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 11` time)*
