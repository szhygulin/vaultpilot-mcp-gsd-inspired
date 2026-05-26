# Phase 35: Escape hatch — `prepare_custom_call` + `get_contract_abi` + `read_contract` — Context

**Gathered:** 2026-05-26
**Status:** Decisions locked — ready for `/gsd-plan-phase 35`

<domain>
## Phase Boundary

Three tools that together let the agent prepare arbitrary verified-contract calls outside the protocol-aware safety net:

- `get_contract_abi({ chain, address })` — Etherscan-sourced ABI fetcher; 4-arm discriminated union mirroring `check_contract_security` shape.
- `read_contract({ chain, address, functionName, args })` — ABI-driven `eth_call` to view functions; refuses state-mutating writes.
- `prepare_custom_call({ chain, to, data, value?, acknowledgeNonProtocolTarget: true })` — produces an unsigned transaction that BYPASSES the canonical-dispatch allowlist by design. Schema-level required flag is the user-acknowledgment they're operating outside the safety net.

The bypass is intentional. The `acknowledgeNonProtocolTarget: true` schema flag, the structured-refusal-with-canonical-alternative on missing flag, the `[WARN — NON-PROTOCOL TARGET]` preview block, and the best-effort ABI-decode-when-available are the load-bearing defenses.

</domain>

<decisions>
## Implementation Decisions

### `acknowledgeNonProtocolTarget: true` gate (load-bearing)
- Schema-level required parameter on `prepare_custom_call`. Zod literal `z.literal(true)`.
- Missing / `false` → structured refusal naming the safety implication + listing canonical-dispatch tools the user could use instead (e.g. "If you're trying to supply to Aave, use `prepare_aave_supply`").
- Refusal text uses the function-selector against `KNOWN_SPENDERS_ETHEREUM` / Aave Pool / Lido / etc. to suggest the closest protocol-aware tool when one exists. When no canonical alternative exists, the refusal just lists the categories ("`prepare_aave_*`, `prepare_uniswap_swap`, `prepare_token_send`, …") and instructs the agent to re-call with `acknowledgeNonProtocolTarget: true` if the user has confirmed the bypass.
- Error code: `NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED`.

### Canonical-dispatch allowlist bypass
- `prepare_custom_call` writes `record.acknowledgeNonProtocolTarget = true` onto the handle. `preview_send` at the `_canonicalDispatch.checkDispatchTarget` site (`src/tools/preview_send.ts:792-814`) short-circuits the refusal when this flag is set on the record.
- The flag is set by `prepare_custom_call` ONLY. No other prepare tool can set it. Enforced by grep guard (test) — search the codebase for `acknowledgeNonProtocolTarget = true` assignments; assert exactly one site outside `prepare_custom_call.ts` itself (the type defn).

### `[WARN — NON-PROTOCOL TARGET]` block
- Defense-in-depth: emitted in BOTH `prepare_custom_call` response (so the agent sees it in the prepare receipt) AND `preview_send` (so it survives any agent paraphrasing).
- Block lives above all other preview blocks. APPEND-ONLY template in `src/signing/blocks.ts` (mirror of how `LEDGER NOTICE` blocks were added in Phase 6 Plan 06-04).
- Block text names: bypass-allowlist warning, the target address, the best-effort decoded function name (when ABI was fetched within the session), and a single-line "If unsure, decline on-device" hint.

### Etherscan ABI client extension — widen to multi-chain
- `src/clients/etherscan.ts` currently hardcodes `chainid=1` (lines 217-218). Phase 35 first task widens it.
- Add `chainId: ChainId` parameter to the existing `fetchEtherscanContractInfo()` (or split — researcher decides). The cache key includes `chainId` (currently keyed by `Address` alone; widen to `${chainId}:${address}`).
- Per-session rate limit (5 calls/sec) is GLOBAL across chains — Etherscan V2 enforces the limit per API key, not per chain. The existing `agentSessionCallCount` stays as-is.
- Lifts the FROZEN constraint from Phase 8 (`check_contract_security` v1.2-ethereum-only) as a free downstream effect — `check_contract_security` widens to multi-chain in the same plan that widens the client.
- New ABI-specific helper `fetchEtherscanAbi(chainId, address)` lives alongside `fetchEtherscanContractInfo` and reuses the same rate-limit counter + cache. Returns 4-arm discriminated union: `ok | not-verified | rate-limited | error`. NO `not-applicable` arm — ABI fetch is always applicable when called.

### `get_contract_abi` tool
- Returns 4-arm discriminated union mirroring `EtherscanAbiResult`: `{ status, abi?, sourceCodeUrl? }`.
- The `abi` is a parsed `viem.Abi` JSON array (parsed once at the client layer; consumers never re-parse). `sourceCodeUrl` is the Etherscan source-code page for the verified contract.
- No handle. Read-only operation. Per-session ABI cache (see below) is populated from this call.

### Per-session ABI cache
- In-memory LRU keyed by `${chainId}:${address}`, max ~64 entries, mirror of `cache` in `fourbyte.ts` / `etherscan.ts`.
- Lives in `src/clients/etherscan.ts` (reuses existing cache infrastructure — the ABI is already cached inside `EtherscanResult.ok.abi`, so the ABI cache is a derived view, not a separate store).
- Cache survives across `get_contract_abi` → `read_contract` → `prepare_custom_call` within a session, enabling the best-effort decode at preview.
- Resets on MCP server restart by design.

### `read_contract` tool
- Fetches ABI via the per-session cache; on cache miss, calls Etherscan.
- Encodes function call via `viem.encodeFunctionData`; executes via `viem.publicClient.call({ to, data })`.
- Decodes result via `viem.decodeFunctionResult`.
- Refuses non-view functions at runtime: inspect the ABI entry; if `stateMutability` ∉ `{"view", "pure"}` → structured refusal with `NON_VIEW_FUNCTION` error code, text directs agent to `prepare_custom_call` for state-mutating calls.
- Refuses on ABI-fetch failure (`not-verified` / `rate-limited` / `error`) — surface the underlying error verbatim. NO blind-call fallback (the agent doesn't know the selector layout without ABI).
- Per-call timeout: 5s (1 RPC + 1 Etherscan call worst case; 5s is the per-RPC ceiling already used elsewhere).

### Best-effort ABI-decode at preview
- `preview_send` extends the prepare_custom_call branch (selector dispatch on `record.preparedBy === "prepare_custom_call"`).
- Lookup ABI from per-session cache via `${chainId}:${to}` key. Cache HIT → `viem.decodeFunctionData(abi, calldata)` → surface `decodedFunctionName(decodedArgs...)` in CHECKS PERFORMED.
- Cache MISS → CHECKS PERFORMED says `Blind sign — no ABI available. The selector 0x{first 4 bytes} is shown on-device.` No fallback to 4byte (4byte selector lookup is for protocol-routed paths; for the escape hatch, the absence of ABI is itself meaningful information for the user).

### `prepare_custom_call` calldata + fingerprint shape
- `payloadFingerprint` over the standard PREP-03 envelope (`{ chainId, from, to, value, data, ...gas }`) — no escape-hatch-specific carve-out. The dispatch bypass is a separate flag on the record, NOT a fingerprint dimension.
- Fingerprint Fixture P (escape-hatch baseline) hardcoded literal in `test/signing-fingerprint.test.ts`. Persona-cycle byte-identity test: same `(chain, to, data, value)` from two personas → same fingerprint, different from-derivation surface. Re-anchors the `from`-independence invariant.

### `[WARN — NON-PROTOCOL TARGET]` in prepare receipt
- The block emits in the `prepare_custom_call` response above the standard PREPARE RECEIPT (defense-in-depth — agent sees the warning before passing the handle to `preview_send`).
- The same block re-emits at `preview_send` (the Ledger-trip-charging path). Drift between the two would be a tamper signal — assertion in integration test that the byte-identical block text appears in both response paths.

### Tests anchor (cross-tool integration)
- `test/integration/escape-hatch.test.ts` — end-to-end: `get_contract_abi` populates cache, `prepare_custom_call` succeeds with `acknowledgeNonProtocolTarget: true`, `preview_send` surfaces decoded args + WARN block, `send_transaction` fingerprint matches.
- Missing flag → structured refusal with `NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED`.
- Non-view `read_contract` → `NON_VIEW_FUNCTION` refusal.
- ABI cache miss at preview → `Blind sign — no ABI available` in CHECKS PERFORMED.
- Bypass flag CANNOT be set by any tool other than `prepare_custom_call` (grep-guard test).

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — escape-hatch convention; canonical-dispatch allowlist bypass discipline; FROZEN-area cryptographic-binding rules
- `.planning/REQUIREMENTS.md` §CUSTOM-01..03 — exact Phase 35 surface (lines 355-357)
- `.planning/ROADMAP.md` Phase 35 (lines 975-997) — goal + 6 success criteria
- `src/clients/etherscan.ts` (Phase 7 Plan 07-04) — Etherscan V2 client base; `chainid=1` hardcode at lines 217-218 is the v1.2 plumbing gap Phase 35 widens
- `src/security/canonical-dispatch.ts` (Plan 09-04) — allowlist source; Phase 35 explicitly bypasses via `record.acknowledgeNonProtocolTarget`
- `src/tools/preview_send.ts:792-814` — dispatch-check call site; bypass branch lands here
- `src/signing/blocks.ts` — APPEND-ONLY block templates; `[WARN — NON-PROTOCOL TARGET]` lands here
- `src/signing/payload-fingerprint.ts` (FROZEN, except for additive Fixture P anchor) — fingerprint shape unchanged
- `test/signing-fingerprint.test.ts` — Fixture P (escape-hatch baseline) hardcoded literal anchor

</canonical_refs>

<specifics>
## Specific Ideas

- The escape hatch is intentionally outside canonical-dispatch — power-user feature for niche protocols and arbitrary verified contracts. Defense is the `acknowledgeNonProtocolTarget: true` schema gate + `[WARN — NON-PROTOCOL TARGET]` block + best-effort decode + structured-refusal-with-canonical-alternative pattern.
- `read_contract` is intentionally NOT a `prepare_*` tool — it doesn't produce a handle; it's a one-shot read. The naming reflects read-only intent.
- Etherscan multi-chain widening lifts the FROZEN constraint from Phase 8 (`check_contract_security` v1.2-ethereum-only). Phase 35 unblocks `check_contract_security` extending to multi-chain as a free downstream effect — same plan that widens the client also widens `check_contract_security` to honor the `chain` parameter end-to-end.
- The per-session ABI cache is a derived view over the existing `EtherscanResult.ok.abi` field — no new storage. Researcher to confirm `viem.Abi` parsing cost vs cache-hit rate to decide whether to memoize the parsed array separately.
- `[WARN — NON-PROTOCOL TARGET]` emits in both `prepare_custom_call` AND `preview_send` — drift between the two is itself a tamper signal (integration test asserts byte-identity).
- Plan structure (3 plans, mirrors ROADMAP):
  - **35-01**: `get_contract_abi` + Etherscan client multi-chain widening + `check_contract_security` chain-honoring extension (free downstream effect).
  - **35-02**: `read_contract` + ABI-driven `eth_call` helper + non-view refusal + `src/chains/contract-read.ts` module.
  - **35-03**: `prepare_custom_call` + canonical-dispatch bypass flag + `[WARN — NON-PROTOCOL TARGET]` block + best-effort decode at preview + Fixture P + integration test + v2.4 milestone close-out.

</specifics>

<deferred>
## Deferred Ideas

- ABI caching across sessions (persistent ABI cache) — defer; per-session in-memory cache suffices for the agent-session-scoped workflow.
- `prepare_custom_call` to non-verified contracts — out of scope; verification status is NOT a hard gate (the `[WARN — NON-PROTOCOL TARGET]` block surfaces verification status, but the call still proceeds because the user has acknowledged the bypass). Researcher to confirm — there may be a case for refusing on non-verified targets when the user hasn't explicitly read the bytecode; defer to research.
- `read_contract` for state-mutating reads (eth_call + state override) — defer; corner case.
- `prepare_custom_call` for delegatecalls / proxy upgrades — out of scope (use Safe v2.5 enableModule path for module operations; for proxy upgrades, the escape hatch is technically appropriate but high-risk — researcher may surface a follow-up gate).
- Auto-decode of fallback function arguments (when calldata length doesn't match any ABI entry) — defer; the `Blind sign — no ABI available` message is sufficient.
- 4byte selector fallback when ABI is unavailable — explicitly NOT included; absence of ABI is itself meaningful information for the user, not a degraded-mode signal.

</deferred>

---

*Phase: 35-evm-escape-hatch-custom-call-abi-read*
*Decisions captured: 2026-05-26*
