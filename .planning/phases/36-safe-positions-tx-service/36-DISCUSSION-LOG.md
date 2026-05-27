# Phase 36 Discussion Log

**Mode:** `--auto --chain` (autonomous selection, no AskUserQuestion prompts)
**Date:** 2026-05-27
**Phase:** 36 — Safe positions + Tx Service API integration + `get_safe_positions`

## Auto-resolved gray areas

`--auto` mode selected the recommended option (first / safest / consistent-with-prior-phase) for each gray area without invoking AskUserQuestion. Each selection logged here for audit.

### Area 1: Multi-chain default scope for `get_safe_positions`

**Question:** Default fan-out across configured chains, default single-chain, or no default (require explicit chain)?

**Options considered:**
- Fan out across `configuredChains` by default (recommended — Phase 8 `get_portfolio_summary` precedent)
- Default to `"ethereum"`; explicit chain required to widen
- No default; `chain` schema-required

**[auto] Selected:** Fan out across `configuredChains` by default (recommended). `chain` optional → narrows when provided.

**Rationale (audit):** Phase 8 already established `Promise.allSettled` + per-chain `AbortController` 10s timeout for `get_portfolio_summary` cross-chain reads. Safe positions are conceptually identical (per-chain enumeration + per-Safe aggregate state) — using the same pattern keeps the surface consistent and preserves partial-failure semantics (`degradedChains[]`).

---

### Area 2: Tx Service vs on-chain trust hierarchy

**Question:** Trust Tx Service responses verbatim, or always cross-check against on-chain Singleton reads?

**Options considered:**
- Always cross-check on-chain (recommended — trust-pipeline ethos)
- Trust Tx Service verbatim; on-chain cross-check opt-in via param
- Hybrid: cross-check on positions, trust on tx details

**[auto] Selected:** Always cross-check on-chain (recommended). On-chain is authoritative; Tx Service drift surfaces as `txServiceDrift: true` per Safe.

**Rationale (audit):** Project core value is "the user trusts what the Ledger screen shows — nothing else." Trusting a centralized off-chain service for read state is incompatible with that ethos — the on-chain cross-check is the load-bearing trust-pipeline foundation that Phase 37 signing flows depend on.

---

### Area 3: Pending-transaction surface depth in `get_safe_positions`

**Question:** Surface full SafeTx detail per pending tx, or compact form + separate `get_safe_transaction` lookup?

**Options considered:**
- Compact (safeTxHash + nonce + signature counts + isExecutable) — recommended; full detail via explicit `get_safe_transaction` call
- Full SafeTx detail inline per pending tx
- User-configurable depth param

**[auto] Selected:** Compact form (recommended). Full decoded operation surfaces only via the explicit `get_safe_transaction({ chain, safeAddress, safeTxHash })` call.

**Rationale (audit):** Wallets that own many Safes with many pending transactions could blow up payload sizes. Compact-with-explicit-drilldown is the standard MCP read-tool pattern (precedent: `get_lending_positions` aggregates positions; `simulate_position_change` is the explicit deep-dive call).

---

### Area 4: Module list surface depth

**Question:** Just enabled-module addresses, or run `check_contract_security` per module inline?

**Options considered:**
- Addresses only at this phase (recommended); security check is Phase 38's job
- Inline `check_contract_security` per module
- Optional via `verifyModules: true` param

**[auto] Selected:** Addresses only at this phase (recommended). Phase 38 owns the `enableModule` hard-trigger second-LLM check per ROADMAP.

**Rationale (audit):** Phase 38 owns Inv #12.5 hard-trigger detection on `enableModule` writes. Doing inline security checks here would (a) blow up Etherscan rate-limit budget across every `get_safe_positions` call, (b) duplicate Phase 38's responsibility surface, and (c) couple read latency to external API.

---

### Area 5: Per-chain Safe Tx Service endpoint discovery

**Question:** Hardcoded per-chain table or `SAFE_TX_SERVICE_URL` env override?

**Options considered:**
- Hardcoded per-chain table (recommended — `RPC_URL_BY_CHAIN` precedent)
- `SAFE_TX_SERVICE_URL` env override (per-chain map)
- Hybrid: hardcoded defaults + env override

**[auto] Selected:** Hardcoded per-chain table (recommended). NO env-override at this phase; deferred to v3.x if private deployments emerge.

**Rationale (audit):** Safe Tx Service's `safe-transaction-{chain}.safe.global` domain pattern is stable and well-known. Env override would be premature optimization — no user has requested private Tx Service support, and the centralized endpoint policy mirrors how RPC endpoints are configured (`RPC_URL_BY_CHAIN`).

---

### Area 6: Client discriminated-union shape

**Question:** 4-arm (omit `unsupported-chain`), 5-arm (with `unsupported-chain`), or different shape than `etherscan.ts`?

**Options considered:**
- 5-arm: `ok | not-found | rate-limited | error | unsupported-chain` (recommended — extends etherscan.ts shape)
- 4-arm: omit `unsupported-chain`, fold into `error`
- Bespoke shape (not aligned to etherscan.ts)

**[auto] Selected:** 5-arm union (recommended). `unsupported-chain` is its own arm — short-circuits before any network call.

**Rationale (audit):** `unsupported-chain` is distinct from `error` because it's a static schema fact (chain has no Safe Tx Service endpoint), not a runtime failure. Surfacing it as its own arm lets agents route on it cleanly without parsing error strings. Matches Phase 35's 4-arm `EtherscanAbiResult` precedent — same conventions, one extra arm for Phase 36's chain-coverage need.

---

### Area 7: Canonical-dispatch Safe arm — per-chain Singleton vs wildcard

**Question:** Per-chain Singleton entries in allowlist, or wildcard against on-chain `_isValid` introspection?

**Options considered:**
- Per-chain Singleton allowlist entries (recommended — explicit, auditable)
- Wildcard with on-chain introspection
- Hybrid: allowlist + on-chain fallback

**[auto] Selected:** Per-chain Singleton allowlist entries (recommended). v1.3.0 + v1.4.1 Singleton addresses per chain.

**Rationale (audit):** Canonical-dispatch is a trust-boundary gate; allowlist entries are auditable and version-pinned. Wildcard introspection would mean trusting RPC responses to validate a trust gate — circular and weaker. Phase 36 enumerates Singletons explicitly from `safe-deployments` package canonical JSON.

---

### Area 8: Safe ABI version dispatch in reader

**Question:** Surface Safe version in output and dispatch reader logic per version, or just surface version?

**Options considered:**
- Surface version; reader is version-agnostic for reads (recommended — Phase 37 cares about version, not Phase 36)
- Per-version reader dispatch (forward compat for Phase 37)
- Refuse unsupported versions

**[auto] Selected:** Surface version; reader is version-agnostic (recommended). Phase 37 routes typed-data domain separator per version.

**Rationale (audit):** Phase 36 reads are version-independent (`getOwners() / getThreshold() / nonce() / VERSION() / getModulesPaginated` exist in both v1.3.0 and v1.4.1 with identical signatures). Premature version dispatch would add complexity for no Phase 36 surface benefit; Phase 37's EIP-712 domain separator is the first place version actually changes ABI surface.

---

## Folded TODOs

None — `gsd-sdk query todo.match-phase 36` returned zero matches.

## Reviewed but not folded TODOs

None.

## Deferred ideas surfaced during selection

Captured in CONTEXT.md `<deferred>` section. Highlights:

- SafeTx hash computation, typed-data signing, propose / approve / execute, signature submission — Phase 37
- `enableModule` + `delegateCall` hard-trigger second-LLM check — Phase 38
- Safe creation via ProxyFactory, ENS owner labels, USD aggregate value, private Tx Service deployments — v3.x
- Safe v1.1.x and older versions — explicitly NOT supported (surface as `txServiceDrift`)

## Claude's Discretion items

- Internal helper names (`SafeTxServiceClient`, `SafeStateReader`, `crossCheckSafe`, `decodeSafeTxOperation`)
- LRU sizes (~32 Safe-info, ~64 SafeTx); per-session call ceiling (~30)
- `txServiceConfigured` boolean field — load-bearing-ness is marginal (no API key required)
- Field ordering in per-Safe output (cosmetic)
- Allowlist data structure (Set vs Address[]) — mirrors current dominant convention in canonical-dispatch.ts

---

*Auto-mode discuss complete. Proceeding to plan-phase.*
</content>
</invoke>