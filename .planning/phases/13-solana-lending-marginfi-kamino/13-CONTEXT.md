# Phase 13: Solana lending — MarginFi + Kamino - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

User can read MarginFi + Kamino lending positions and supply/withdraw/borrow/repay assets on both protocols. Per-wallet lending-account PDA setup tools (MarginFi `MarginfiAccount`, Kamino `Obligation`) ship here. Canonical dispatch allowlist extends to Solana programs (Layer 0.5, mirrors v1.3 SEC-35 EVM dispatch-target enforcement). MarginFi + Kamino program addresses sourced from a new `src/config/contracts.ts` Solana sub-table.

Requirements: SOL-W-03..10 (REQUIREMENTS.md).

No swaps yet — Phase 14 lands Jupiter. No staking yet — Phase 15 lands Marinade / Jito / native SOL.

</domain>

<decisions>
## Implementation Decisions

### SDK adoption + unsigned-instruction fallback (the primary execution risk)
- **D-01 (LOCKED):** If a protocol SDK (`@mrgnlabs/marginfi-client-v2`, Kamino klend SDK) does NOT expose UNSIGNED instruction output (i.e. only internally-signing helpers), the fallback is to **hand-encode instructions from the program's Anchor IDL** using `@coral-xyz/anchor`'s `BorshInstructionCoder` (no signer) — the same approach already used for SPL/system instruction encoding in Phases 12/44. Full control, guaranteed unsigned output, Ledger-safe. Keeps BOTH protocols in-phase regardless of SDK signing assumptions. The IDL is the canonical encoding source (mirrors how `contracts.ts` is the address SOT — never inline an encoding).
- **D-02:** SDK account DECODERS may be used for reads (`get_marginfi_positions` / `get_kamino_positions`) even where the SDK can't build unsigned writes — decoding is read-only, no signing surface. The hand-encode-from-IDL rule (D-01) applies specifically to the write/tx-building path.
- **Researcher scope-probe (per `rnd` discipline):** at research time, confirm for EACH SDK: (a) whether it exposes unsigned instruction builders or only signer-bound helpers; (b) the IDL availability + program version pin; (c) account-decoder surface for positions reads. Document SDK / version / red flags / decision (adopt-builder / decoder-only / hand-encode) in RESEARCH.md. Type-check call sketches against the installed `.d.ts`, not just docs.

### Account-init UX (trust-boundary)
- **D-03 (LOCKED):** When a user calls `prepare_marginfi_supply`/`_borrow`/etc. (or the Kamino equivalents) but the per-wallet PDA (`MarginfiAccount` / `Obligation`) does NOT exist yet, the tool returns a **structured refusal with NO handle minted**, instructing the agent to call `prepare_marginfi_account_init` / `prepare_kamino_obligation_init` first. **Two explicit, separately-approved transactions** — each Ledger screen shows ONE clear intent (create account; then supply). Do NOT auto-bundle account-init into the supply tx. Rationale: matches the project core value ("user trusts what the Ledger screen shows"), avoids multi-instruction blind-sign opacity, and follows the distinct-intent-tool pattern (v1.1 `prepare_revoke_approval`).
- **D-04:** The PDA-presence check that drives D-03 is a read (RPC `getAccountInfo` on the derived PDA). Absent → refuse-and-redirect. Present → proceed. The refusal is a structured error code (new Solana-lending code in the `solanaErrorCode` local-constant pattern from Phase 44 — NOT a fabricated central registry).

### Contracts SOT + canonical dispatch (locked by prior-phase precedent + roadmap)
- **D-05:** `src/config/contracts.ts` gains a Solana sub-table — `Record<"solana", SolanaContracts>` mirroring the EVM `Record<ChainId, ContractsForChain>` shape. New typed slots: `marginfiProgram`, `kaminoLendProgram`, + per-protocol PDA-derivation helpers. Program IDs NEVER inlined in tool code (CLAUDE.md SOT convention). Regression-tested (SOL-W-10).
- **D-06:** `src/security/canonical-dispatch.ts` gains a Solana arm. **Critical (from codebase research):** this must be a SIBLING function (e.g. `checkSolanaDispatchTarget` / `CANONICAL_DISPATCH_TARGETS_SOLANA`) — NOT a parameterization of the EVM path. The EVM `checkDispatchTarget` normalizes via `getAddress` (EIP-55); Solana program IDs are base58 and must use their own membership check with no EIP-55 normalization. Layer 0.5 refusal at preview time (SOL-W-09).

### Health-factor math (Claude's discretion → decided by precedent; researcher locks formulas)
- **D-07:** Replicate each protocol's health math **on-chain-accurate** (re-derive the exact formula), NOT a documented approximation. Rationale: liquidation-risk display is a trust surface; an approximation would undermine it. Per-protocol pure-bigint modules `src/signing/marginfi-health.ts` + `src/signing/kamino-health.ts` mirror the `src/signing/aave-health.ts` shape (Phase 7). Researcher locks the exact formulas at planning gate: MarginFi uses risk-weighted asset/liability weights; Kamino uses per-reserve LTV / liquidation-threshold. These differ from Aave AND from each other.

### Claude's Discretion
- Internal helper names; per-protocol module internal structure.
- **Phase split sizing:** deferred to the planner. RECORDED CONCERN: the roadmap's 4-plan sketch bundles 10 prepare tools (4 MarginFi + 4 Kamino + 2 init) into plan 13-04 — that is heavy. A per-protocol split (e.g. 13-04 MarginFi prepares + init, 13-05 Kamino prepares + init) is PREFERRED for smaller execute units and earlier MarginFi-only verification. Planner decides 4 vs 5-6 plans on the conflict-graph + execute-weight basis.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `.planning/REQUIREMENTS.md` §SOL-W-03..10 — exact Phase 13 requirement surface
- `.planning/ROADMAP.md` Phase 13 (§ line ~375) — Goal + 7 Success Criteria + 4-plan sketch
- `.planning/phases/12-solana-trust-pipeline-native-spl-transfers/12-CONTEXT.md` — upstream Solana trust pipeline already wired
- `.planning/phases/44-solana-durable-nonce/44-01-SUMMARY.md` — most recent Solana tool precedent (handle/receipt/fingerprint flow, `solanaErrorCode` local-constant pattern, no-handle-on-refusal)

### Pattern references (clone/mirror sources)
- `src/config/contracts.ts` — EVM contracts SOT (Phase 13 adds Solana sub-table; structure mirrors). NOTE: currently EVM-only (`ChainId = 1|42161|137|8453|10`) + a TRON spender table; NO Solana sub-table exists yet — Phase 13 plan 13-01 creates it.
- `src/security/canonical-dispatch.ts` — EVM dispatch allowlist (`CANONICAL_DISPATCH_TARGETS`, EIP-55 `getAddress`). Phase 13 adds a base58 Solana SIBLING (see D-06). NO Solana arm exists yet.
- `src/tools/prepare_solana_spl_send.ts` — canonical clone source for each new `prepare_*` tool (schema, encoder, program ID, PDA accounts diffs).
- `src/protocols/solana-system.ts` + `src/protocols/solana-spl.ts` — protocol decoder + `_solana*` ESM-indirection shape; new `marginfi.ts` / `kamino.ts` follow it.
- `src/signing/aave-health.ts` (Phase 7) — pure-bigint health math shape; `marginfi-health.ts` / `kamino-health.ts` mirror it.
- `src/chains/solana/sol-rpc-client.ts` — Solana RPC client (`getAccountInfo`-style reads for PDA-presence + position decode).
- `test/signing-fingerprint.test.ts` (or `-solana` variant) — hardcoded `0x…` fingerprint fixtures; each new tx shape adds a pinned literal (CLAUDE.md fixture discipline, NO beforeAll-snapshot).

### FROZEN (do NOT touch — reuse as-is)
- `src/signing/payload-fingerprint-solana.ts` (`computeSolanaPayloadFingerprint`, DF-1 LOCKED), `src/signing/presign-hash-solana.ts` (DF-2 LOCKED), `src/signing/blocks-solana.ts` (PREPARE RECEIPT / LEDGER NOTICE / SIMULATION / VERIFY templates), `src/signing/simulation-solana.ts` (DF-4 LOCKED), `src/signing/handle-store.ts`. New tx shapes pass `Transaction.serializeMessage()` bytes through the existing binding — do NOT invent new binding math.

### External (researcher to scope-probe per `rnd` + D-01)
- MarginFi docs — https://docs.marginfi.com/
- `@mrgnlabs/marginfi-client-v2` — https://github.com/mrgnlabs/marginfi-client-v2
- Kamino docs — https://docs.kamino.finance/
- Kamino lending program (klend) — https://github.com/Kamino-Finance/klend
- `@coral-xyz/anchor` `BorshInstructionCoder` — the hand-encode-from-IDL fallback path (D-01)
- Ledger SOL app CAL / clear-signing registry — researcher to surface MarginFi/Kamino instruction coverage at planning gate (drives conditional LEDGER NOTICE, SC-7)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (shipped by Phases 11/12/44 — verified at discuss time)
- Solana RPC client (`src/chains/solana/sol-rpc-client.ts`): `getNativeBalance`, `getSplTokenAccounts`, `getMintDecimals`, `getMinimumBalanceForRentExemption`, `SolanaRpcError`, `_solRpcInternals`.
- Registry (`src/chains/solana/registry.ts`): session/account registry + `_resetSolanaRegistryForTesting`.
- Protocols: `solana-system.ts` (`_solanaSystem` indirection + nonce builders), `solana-spl.ts` (`deriveAtaForOwner`, `maybeAppendCreateAtaInstruction`, `encodeSplTransferChecked`, `_solanaSpl`).
- Amount parsing: `src/signing/amount-solana.ts` (`parseSolanaAmountStrict`) — decimal-string → bigint, decimal-aware.
- Demo: `src/demo/solana-persona.ts` — one persona (`"solana-whale"`); multi-persona expansion was explicitly deferred "to Phase 13+" → Phase 13 may add lending-position personas.
- Deps installed: `@ledgerhq/hw-app-solana@7.9.0`, `@solana/spl-token@^0.4.14`, `@solana/web3.js@^1.98.4`. `@coral-xyz/anchor` likely needs adding for IDL encoding (D-01) — researcher confirms.

### Established Patterns
- prepare_* contract: opaque handle + PREPARE RECEIPT (verbatim args) + payloadFingerprint at prepare time, re-checked at send. Refusal → NO handle (D-03 relies on this).
- ESM spy-affordance: internal cross-export calls route through an `_<scope>` indirection object (`_solanaSystem`, `_solanaSpl`). New `marginfi`/`kamino` protocol modules add their own.
- Error codes: `solanaErrorCode` local-constant pattern (Phase 44) — NOT a central `SOLANA_ERROR_CODES` registry (doesn't exist). New lending refusal codes follow this.

### Integration Points (the two NEW shared structures Phase 13 creates — conflict-graph hot spots)
- `src/config/contracts.ts` — add Solana sub-table (13-01). Shared append target for Phases 14/15/16 → serialize.
- `src/security/canonical-dispatch.ts` — add base58 Solana sibling arm (13-01). Shared append target for 14/15/16 → serialize.
- `src/tools/register-all.ts` — register new tools. Shared append target for 14/15/16 → serialize.
- These three files are why v2.0 Solana phases run 13 → 14 → 15 → 16 sequentially (13 scaffolds; 14/15/16 extend).

</code_context>

<specifics>
## Specific Ideas

- PDA-init tools are DISTINCT from supply/withdraw tools because user-facing intent differs ("set me up to use MarginFi" vs "supply 100 USDC") — v1.1 `prepare_revoke_approval` precedent.
- Each protocol's program ID lives in the Solana SOT — never inlined (CLAUDE.md).
- Health math for MarginFi (risk-weighted) and Kamino (per-reserve LTV) differs from Aave's and from each other — separate pure-bigint modules, on-chain-accurate (D-07).
- Hand-encode-from-IDL (D-01) is the same technique already proven for SPL/system encoding — not a new pattern, an application of an existing one.

</specifics>

<deferred>
## Deferred Ideas

- Other Solana lending protocols (Solend, etc.) — v2.x backlog as usage data justifies.
- Cross-protocol position aggregation — v3.x ergonomics (ERG-04 `compare_yields`, ERG-06 `get_health_alerts` already track multi-protocol scans).
- E-mode / per-asset borrowing caps surfacing — verify-phase feedback per the Aave Phase 7 precedent.
- Multi-persona Solana demo expansion beyond what Phase 13 needs — as later phases require.

</deferred>

---

*Phase: 13-solana-lending-marginfi-kamino*
*Context gathered: 2026-06-02*
