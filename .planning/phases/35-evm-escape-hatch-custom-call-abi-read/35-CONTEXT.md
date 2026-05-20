# Phase 35: Escape hatch — `prepare_custom_call` + `get_contract_abi` + `read_contract` — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 35`)

<domain>
## Phase Boundary

User can prepare arbitrary verified-contract calls outside the protocol-aware safety net. `acknowledgeNonProtocolTarget: true` is the user-acknowledgment they're operating outside the canonical-dispatch allowlist. Companion tools `get_contract_abi` (Etherscan-sourced) and `read_contract` (eth_call to a view function) give the agent the visibility needed to construct the call safely.

The escape hatch is intentionally outside the canonical-dispatch allowlist — power-user feature for advanced interactions (claim rewards on niche protocols, interact with arbitrary verified contracts) that the agent's safety net otherwise blocks.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 35`. Anchor candidates:

- **`acknowledgeNonProtocolTarget: true` gate**: schema-level required parameter; missing → structured refusal naming the safety implication + listing canonical-dispatch tools the user could use instead. Refusal text includes the canonical alternative when one exists (e.g. "If you're trying to supply to Aave, use `prepare_aave_supply` instead").
- **`[WARN — NON-PROTOCOL TARGET]` block**: emitted ABOVE the standard preview blocks at `preview_send`. Surfaces the bypass-allowlist warning verbatim every time.
- **Etherscan ABI client extension**: existing `src/clients/etherscan.ts` has a per-chain `chainid` plumbing gap from v1.2 (Phase 8 left it Ethereum-only). Phase 35 widens it to multi-chain to support `get_contract_abi({ chain, address })`. Cost: small (the v1.2 gap was a deferred FROZEN constraint that's now Phase 35's first task).
- **ABI-driven `read_contract`**: fetches ABI via Etherscan, encodes the function call via viem, executes via `eth_call`. Returns decoded result. Refuses on non-view functions (state-mutating reads aren't `read_contract`'s remit — they'd belong in `prepare_custom_call`).
- **Best-effort decode at preview**: when `prepare_custom_call` follows a `get_contract_abi` call (within the same handle's lifetime?), the preview surfaces ABI-decoded args in CHECKS PERFORMED. When ABI is unavailable → blind-sign-only.

### Claude's Discretion

- Internal helper names (`getEtherscanAbi`, `decodeCustomCalldata`, etc.)
- Whether `prepare_custom_call` and `read_contract` cache fetched ABIs in-memory (within a session) — researcher to assess cache-hit-rate benefit
- Whether `[WARN — NON-PROTOCOL TARGET]` block surfaces in `prepare_*` response too (not just `preview_send`) — defense-in-depth

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — escape-hatch convention; canonical-dispatch allowlist bypass
- `.planning/REQUIREMENTS.md` §CUSTOM-01..03 — exact Phase 35 surface
- `.planning/ROADMAP.md` Phase 35
- `src/clients/etherscan.ts` (Phase 7 Plan 07-04) — Etherscan client base; Phase 35 widens to multi-chain
- `src/security/canonical-dispatch.ts` (Plan 09-04) — allowlist source; Phase 35 explicitly bypasses

</canonical_refs>

<specifics>
## Specific Ideas

- The escape hatch is a defense-in-depth concern: bypassing the canonical-dispatch allowlist is intentional for power users but a footgun for naive ones. The `acknowledgeNonProtocolTarget: true` + `[WARN — NON-PROTOCOL TARGET]` + structured-refusal-when-canonical-alternative-exists pattern is the load-bearing defense.
- `get_contract_abi` returns `{ status: "ok" | "not-verified" | "rate-limited" | "error", abi?: ContractAbi, sourceCodeUrl?: string }` — 4-arm discriminated union. The agent sees verification status explicitly and surfaces it to the user.
- `read_contract` is intentionally NOT a `prepare_*` tool — it doesn't produce a handle; it's a one-shot eth_call. The naming (`read_contract` vs `call_contract`) reflects that it's a read-only operation.
- Etherscan multi-chain widening lifts the FROZEN constraint from Phase 8 (`check_contract_security` v1.2-ethereum-only because `etherscan.ts` had no `chainid` plumbing). Phase 35 unblocks `check_contract_security` extending to multi-chain as a free downstream effect.

</specifics>

<deferred>
## Deferred Ideas

- ABI caching across sessions (persistent ABI cache) — defer; per-session cache suffices
- `prepare_custom_call` to non-verified contracts — out of scope; verification status is a hard gate
- `read_contract` for state-mutating reads (eth_call + state override) — defer; corner case
- `prepare_custom_call` for delegatecalls / proxy upgrades — out of scope (use Safe v2.5 enableModule path for module operations; for proxy upgrades, the escape hatch is appropriate but high-risk)

</deferred>

---

*Phase: 35-evm-escape-hatch-custom-call-abi-read*
*Context placeholder: 2026-05-20*
