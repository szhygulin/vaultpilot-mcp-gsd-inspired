# Phase 35: evm-escape-hatch-custom-call-abi-read — Research

**Researched:** 2026-05-26
**Domain:** EVM escape-hatch trust pipeline + Etherscan V2 ABI fetch + ABI-driven viem read
**Confidence:** HIGH — every load-bearing claim is verified against in-tree source files; documented residuals listed in Assumptions Log.

## Summary

Phase 35 ships the v2.4 escape hatch — three tools (`get_contract_abi`, `read_contract`, `prepare_custom_call`) that together let the agent reach arbitrary verified contracts outside the canonical-dispatch allowlist. The cryptographic-binding chain (`payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts` state machine, `send_transaction.ts` three gates) stays byte-frozen; the escape hatch composes via three mechanisms already in the codebase: (a) the `_canonicalDispatch.checkDispatchTarget` indirection in `preview_send.ts:792-814` gets a single-line bypass branch reading a new `record.acknowledgeNonProtocolTarget` flag; (b) the existing Etherscan V2 client widens from hardcoded `chainid=1` to a `chainId: ChainId` parameter; (c) two new APPEND-ONLY templates land in `signing/blocks.ts` (one WARN block, one structured refusal).

Project-skill conventions (CLAUDE.md) anchor every additive surface: (i) the new ABI client mirrors `clients/fourbyte.ts` shape (never-throws contract + LRU cache + per-session rate counter + 4-arm discriminated union); (ii) Fixture P joins the hardcoded-literal pattern in `test/signing-fingerprint.test.ts`; (iii) `src/config/contracts.ts` remains untouched (the escape hatch INTENTIONALLY bypasses canonical SOTs); (iv) decimal-string discipline does NOT apply (the escape hatch ships raw calldata + valueWei).

**Primary recommendation:** Implement the 3-plan structure from CONTEXT.md verbatim. Plan 35-01 widens `etherscan.ts` to multi-chain + ships `get_contract_abi` + lifts the v1.2 FROZEN runtime refusal in `check_contract_security` as a free downstream effect. Plan 35-02 ships `read_contract` via `viem.encodeFunctionData` + `publicClient.call({ to, data })` + `viem.decodeFunctionResult` (gas-free, no broadcast). Plan 35-03 ships `prepare_custom_call` + the canonical-dispatch bypass branch + the WARN template + Fixture P + integration test + v2.4 close-out.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **`acknowledgeNonProtocolTarget: true` gate:** Schema-level required parameter on `prepare_custom_call`. Zod literal `z.literal(true)`. Missing / `false` → structured refusal with error code `NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED`. Refusal text uses the function-selector against `KNOWN_SPENDERS_ETHEREUM` / Aave Pool / Lido / etc. to suggest the closest protocol-aware tool. When no canonical alternative exists, the refusal lists the categories and instructs the agent to re-call with the ack flag.
- **Canonical-dispatch allowlist bypass:** `prepare_custom_call` writes `record.acknowledgeNonProtocolTarget = true` onto the handle. `preview_send` at the `_canonicalDispatch.checkDispatchTarget` site (`src/tools/preview_send.ts:792-814`) short-circuits the refusal when this flag is set. The flag is set by `prepare_custom_call` ONLY — enforced by grep-guard test asserting exactly one `acknowledgeNonProtocolTarget = true` assignment outside the type defn.
- **`[WARN — NON-PROTOCOL TARGET]` block:** Emitted in BOTH `prepare_custom_call` response AND `preview_send`. Block lives above all other preview blocks. APPEND-ONLY template in `src/signing/blocks.ts`. Names: bypass-allowlist warning, target address, best-effort decoded function name (when ABI fetched in session), single-line "If unsure, decline on-device" hint.
- **Etherscan ABI client extension — multi-chain widening:** `src/clients/etherscan.ts` currently hardcodes `chainid=1` (lines 217-218). Phase 35 adds `chainId: ChainId` parameter. Cache key includes `chainId` (currently `Address` alone; widen to `${chainId}:${address}`). Per-session rate limit (5 calls/sec / 5 calls/session) is GLOBAL across chains (Etherscan V2 enforces per API key). New `fetchEtherscanAbi(chainId, address)` helper alongside `fetchEtherscanContractInfo`, reuses rate counter + cache. Returns 4-arm DU: `ok | not-verified | rate-limited | error` (NO `not-applicable` — ABI fetch is always applicable when called).
- **`check_contract_security` widens to multi-chain** in the same plan that widens the client (free downstream effect — lifts the v1.2 FROZEN runtime refusal at `check_contract_security.ts:105-122`).
- **`get_contract_abi` tool:** Returns 4-arm DU mirroring `EtherscanAbiResult`: `{ status, abi?, sourceCodeUrl? }`. `abi` is a parsed `viem.Abi` JSON array (parsed once at the client layer; consumers never re-parse). No handle. Read-only. Populates per-session ABI cache.
- **Per-session ABI cache:** In-memory LRU keyed by `${chainId}:${address}`, max ~64 entries, mirror of `cache` in `fourbyte.ts` / `etherscan.ts`. Lives in `src/clients/etherscan.ts` (reuses existing cache infrastructure — ABI is already cached inside `EtherscanResult.ok.abi`, so the ABI cache is a DERIVED VIEW, not a separate store). Survives across `get_contract_abi` → `read_contract` → `prepare_custom_call` within a session. Resets on MCP server restart.
- **`read_contract` tool:** Fetches ABI via per-session cache; on miss calls Etherscan. Encodes via `viem.encodeFunctionData`; executes via `viem.publicClient.call({ to, data })`. Decodes via `viem.decodeFunctionResult`. Refuses non-view at runtime: inspect ABI entry; if `stateMutability` ∉ `{"view", "pure"}` → structured refusal with `NON_VIEW_FUNCTION`, text directs agent to `prepare_custom_call`. Refuses on ABI-fetch failure (`not-verified` / `rate-limited` / `error`) — surface underlying verbatim. NO blind-call fallback. Per-call timeout 5s.
- **Best-effort ABI-decode at preview:** `preview_send` extends the `prepare_custom_call` branch via selector dispatch on `record.preparedBy === "prepare_custom_call"`. Lookup ABI from per-session cache via `${chainId}:${to}` key. HIT → `viem.decodeFunctionData(abi, calldata)` → surface `decodedFunctionName(decodedArgs...)` in CHECKS PERFORMED. MISS → `Blind sign — no ABI available. The selector 0x{first 4 bytes} is shown on-device.` NO 4byte fallback (absence of ABI is itself meaningful information for the user).
- **`payloadFingerprint` shape:** Standard PREP-03 envelope (`chainId, from, to, value, data, ...gas`) — NO escape-hatch-specific carve-out. The dispatch bypass is a separate flag on the record, NOT a fingerprint dimension. Fingerprint Fixture P (escape-hatch baseline) hardcoded literal in `test/signing-fingerprint.test.ts`. Persona-cycle byte-identity test: same `(chain, to, data, value)` from two personas → same fingerprint (re-anchors `from`-independence invariant).
- **`[WARN — NON-PROTOCOL TARGET]` in BOTH prepare receipt + preview:** Drift between the two would be a tamper signal — integration test asserts byte-identical block text appears in both response paths.
- **Tests anchor (cross-tool integration):** `test/integration/escape-hatch.test.ts` — end-to-end: `get_contract_abi` populates cache, `prepare_custom_call` succeeds with `acknowledgeNonProtocolTarget: true`, `preview_send` surfaces decoded args + WARN block, `send_transaction` fingerprint matches. Plus: missing flag → `NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED`; non-view → `NON_VIEW_FUNCTION`; ABI cache miss at preview → `Blind sign — no ABI available`; bypass flag CANNOT be set by any tool other than `prepare_custom_call` (grep-guard test).

### Claude's Discretion

- **Whether to refuse on non-verified targets** when the user hasn't explicitly read the bytecode. CONTEXT lists this as deferred but explicitly invites researcher confirmation. **Recommendation (RESOLVED):** DO NOT refuse. The `[WARN — NON-PROTOCOL TARGET]` block surfaces verification status (one line: `verified: yes/no`); the call proceeds because the user has acknowledged the bypass. Refusing on non-verified would defeat the escape-hatch use-case (calling niche protocols with non-verified bytecode is a legitimate power-user scenario — and the user already acknowledged via the gate flag). Recommendation reasoning: the warning is a per-call informational surface; the structural defense is the ack-flag schema gate plus the WARN block, not verification status. SECURITY.md residual: documented.
- **Where the selector → canonical-alternative lookup table lives.** Options: (a) inline in `prepare_custom_call.ts`; (b) shared `src/security/canonical-alternatives.ts` for future v2.x extension. **Recommendation: option (b)** — extract to `src/security/canonical-alternatives.ts`. Two reasons: (i) the lookup table grows with each new protocol arm landed (v2.5 Safe, v2.6 bridges, etc.) — a shared file avoids re-touching `prepare_custom_call.ts` on every additive arm; (ii) the table is a SECURITY concern (suggesting wrong tool surfaces a UX-level mishap, not a signing-level one — but the discipline matches `canonical-dispatch.ts` factoring). Module is pure data + a one-line `lookupCanonicalAlternative(selector: Hex): { tool: string; reason: string } | null`.
- **Whether to memoize parsed `viem.Abi` separately or re-parse on each cache hit.** CONTEXT defers to researcher. **Recommendation (RESOLVED):** Parse ONCE at the client layer; cache the parsed array. Rationale: `JSON.parse` on a typical 5-50KB ABI string is ~1-3ms; `viem.decodeFunctionData` against the parsed array is sub-millisecond. The cache-hit path (preview_send + read_contract + prepare_custom_call all hitting the same `(chainId, address)` in one session) is the common case; parsing 3-5× per session is measurable. Implementation: extend `EtherscanResult.ok` with an optional `parsedAbi?: viem.Abi` field (set when first parsed lazily on `.abi` access); OR (cleaner) introduce a parallel `abiCache: Map<string, viem.Abi>` keyed by `${chainId}:${address}` populated at first parse. The parallel Map is the recommendation — it stays out of `EtherscanResult` (which is shape-stable for `check_contract_security` callers) and makes the cache contract explicit.

### Deferred Ideas (OUT OF SCOPE)

- ABI caching across sessions (persistent ABI cache) — defer; per-session in-memory cache suffices for the agent-session-scoped workflow.
- `prepare_custom_call` for delegatecalls / proxy upgrades — out of scope. (Safe v2.5 `enableModule` covers module operations; for proxy upgrades, the escape hatch is technically appropriate but high-risk. Documented residual.)
- `read_contract` for state-mutating reads (eth_call + state override) — defer; corner case.
- Auto-decode of fallback function arguments (when calldata length doesn't match any ABI entry) — defer; the `Blind sign — no ABI available` message is sufficient.
- 4byte selector fallback when ABI is unavailable — explicitly NOT included. Absence of ABI is itself meaningful information for the user, not a degraded-mode signal.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CUSTOM-01 | `prepare_custom_call({ chain, to, data, value?, acknowledgeNonProtocolTarget: true })` produces an unsigned tx that BYPASSES canonical-dispatch; missing flag → structured refusal; preview surfaces `[WARN — NON-PROTOCOL TARGET]` block above standard blocks | Topic 3 (schema + bypass mechanism), Topic 4 (refusal + canonical-alt lookup), Topic 7 (WARN template), Topic 8 (Fixture P) |
| CUSTOM-02 | `get_contract_abi({ chain, address })` returns verified ABI from Etherscan (per-chain explorer); `not-verified` arm surfaced verbatim | Topic 1 (Etherscan V2 multi-chain ABI fetch), Topic 2 (per-session cache), Topic 9 (downstream `check_contract_security` widening) |
| CUSTOM-03 | `read_contract({ chain, address, functionName, args })` calls a view function via `eth_call`; encodes/decodes via verified ABI; per-call ABI-decode best-effort surfacing in CHECKS PERFORMED when ABI fetched via `get_contract_abi`; blind-sign-only when ABI unavailable | Topic 5 (view-only refusal + viem surface), Topic 6 (error arms) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `get_contract_abi` Etherscan fetch | `src/clients/` (network boundary) | — | Mirrors `fourbyte.ts` + existing `etherscan.ts` pattern; never-throws contract; cache + rate limit live here |
| Per-session ABI cache | `src/clients/etherscan.ts` (parallel `abiCache: Map`) | — | Cache is process-scoped; cache key `${chainId}:${address}` matches Etherscan call domain |
| `get_contract_abi` MCP tool surface | `src/tools/` | `src/clients/etherscan.ts` | Tool is thin (validate args → call client → render 4-arm DU); business logic is in client |
| `read_contract` MCP tool surface | `src/tools/` | `src/chains/registry.ts` (RPC client) + `src/clients/etherscan.ts` (ABI fetch) | Tool composes ABI fetch + viem encode + `publicClient.call({ to, data })` + viem decode |
| Selector → canonical-alternative lookup | `src/security/canonical-alternatives.ts` (NEW) | `src/tools/prepare_custom_call.ts` | Security-domain table; grows with each new protocol arm; factored out so prepare_custom_call stays small |
| Canonical-dispatch bypass branch | `src/tools/preview_send.ts` (EVM block only, ~lines 792-814) | `src/signing/handle-store.ts` (record carries the flag) | Single-line bypass at the existing `_canonicalDispatch.checkDispatchTarget` gate; reads `record.acknowledgeNonProtocolTarget` |
| `[WARN — NON-PROTOCOL TARGET]` template | `src/signing/blocks.ts` (APPEND-ONLY) | — | Single-block-single-home format-fanout-sentinel rule; both prepare AND preview import the same const |
| Fixture P payloadFingerprint anchor | `test/signing-fingerprint.test.ts` | — | Mirrors Fixtures A/B/C/D/E/F/G/H/V/W/X/Y/Z/AA/CRV-A/UNI-A pattern |
| `prepare_custom_call` MCP tool | `src/tools/prepare_custom_call.ts` (NEW) | `src/security/canonical-alternatives.ts` (refusal text) + `src/signing/blocks.ts` (WARN block) + `src/signing/handle-store.ts` (record flag) + `src/signing/payload-fingerprint.ts` (FROZEN; consumed not modified) | Mechanical clone of `prepare_native_send.ts` shape; adds raw `data` passthrough + ack-flag schema gate + WARN block emission + record flag write |

## Project Constraints (from CLAUDE.md)

| Constraint | Application to Phase 35 |
|------------|------------------------|
| `prepare_*` always returns a handle | `prepare_custom_call` returns a handle (does NOT skip handle creation despite bypassing dispatch). `get_contract_abi` + `read_contract` are NOT prepare tools → no handle. |
| `PREPARE RECEIPT` block in every `prepare_*` | `prepare_custom_call` emits a PREPARE RECEIPT with verbatim agent args (`chain`, `to`, `data`, `valueWei`, `acknowledgeNonProtocolTarget: true`). NEW template `CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE` in `signing/blocks.ts`. |
| `payloadFingerprint` computed at prepare time, re-checked at send time | Standard PREP-03 envelope; FROZEN compute path unchanged. Fixture P anchors the literal. |
| `previewToken` + `userDecision: "send"` required on `send_transaction` | NO CHANGE — `send_transaction.ts` three gates unchanged. Escape hatch flows through same gates. |
| No private key material crosses any boundary | NO CHANGE — escape hatch ships raw calldata; key material never enters this codebase. |
| `src/config/contracts.ts` is the SOT for canonical addresses | UNCHANGED. The escape hatch INTENTIONALLY bypasses this — that's the whole point of the design. |
| Stderr for diagnostics, stdout for MCP protocol | Phase 35 logs use `log()` from `src/diagnostics/logger.ts` (stderr). |
| Decimal-aware arithmetic (token amounts as strings) | NOT APPLICABLE — escape hatch deals with raw calldata + raw `valueWei` (as decimal-string-of-wei, same as `prepare_native_send`). |
| ESM spy-affordance indirection for cross-export internal calls | If `prepare_custom_call.ts` exports any internal function called by another export, wrap in `_<scope>` indirection. Likely NOT load-bearing for Phase 35 (each tool is self-contained); apply only if a test seam emerges. For the new `src/clients/etherscan.ts` `fetchEtherscanAbi` surface, the network seam is `vi.stubGlobal("fetch", …)` per CLAUDE.md rule. |
| Cryptographic-binding fixtures pinned as hardcoded literals | Fixture P hardcoded `0x...` literal in `test/signing-fingerprint.test.ts`. NO `beforeAll`-snapshot. Cross-link from `test/prepare-custom-call.test.ts` + `test/preview-send.custom-call.test.ts` + `test/integration/escape-hatch.test.ts`. |
| FROZEN cryptographic-binding chain | `payload-fingerprint.ts` / `presign-hash.ts` / `handle-store.ts` state machine / `send_transaction.ts` three gates UNCHANGED. Only ADDITIVE change is the new optional `acknowledgeNonProtocolTarget?: true` field on `HandleRecord` (or on a parallel record key — see Topic 3) — this is type-surface widening, not state-machine modification. |

## Standard Stack

### Core (already in tree)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `viem` | latest (in tree) | `encodeFunctionData` / `decodeFunctionData` / `decodeFunctionResult` / `publicClient.call` / `Abi` type | Project EVM client; already widely used (e.g. `protocols/lido.ts`, `protocols/rocketpool.ts`, `clients/sunswap.ts`) |
| `@noble/hashes` via `viem` | latest (in tree) | keccak256 for payloadFingerprint | FROZEN; consumed not modified |
| `zod` | latest (in tree) | `z.literal(true)` for `acknowledgeNonProtocolTarget` schema gate | Existing tool input schemas use JSON-Schema; if `prepare_custom_call` uses JSON-Schema (matching project convention), express `acknowledgeNonProtocolTarget` as `{ const: true, type: "boolean" }`. Researcher note: tooling here uses raw `INPUT_SCHEMA` JSON-Schema objects (see `prepare_native_send.ts`); use that shape, NOT zod. |

### Supporting (already in tree)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing `src/clients/etherscan.ts` infra | n/a | LRU cache + per-session rate counter + 4-arm DU + never-throws contract | Phase 35 extends; new `fetchEtherscanAbi` reuses cache + counter |
| Existing `src/diagnostics/logger.ts` (`log()`) | n/a | stderr-only diagnostics | All new clients log via this surface |
| Existing `src/chains/registry.ts` (`getChainClient`) | n/a | Per-chain viem `PublicClient` | `read_contract` consumes |
| Existing `src/signing/error-codes.ts` | n/a | Single source of truth for `ErrorCode` union | Phase 35 appends `NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED` + `NON_VIEW_FUNCTION` + `ABI_NOT_AVAILABLE` (see Topic 6) |
| Existing `src/signing/blocks.ts` | n/a | APPEND-ONLY block templates | Phase 35 appends WARN_NON_PROTOCOL_TARGET_TEMPLATE + CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE + (potentially) READ_CONTRACT_REFUSAL_TEMPLATE |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `viem.publicClient.call({ to, data })` (manual encode + decode) | `viem.publicClient.readContract({ address, abi, functionName, args })` | `readContract` is more concise but loses fine-grained control of error surfaces. The locked design (CONTEXT) needs to distinguish ABI-not-verified / rate-limited / fetch-error / non-view / RPC-error → using `readContract` collapses several of these into one viem throw shape. Stay with `call({ to, data })` + manual encode/decode for error-arm clarity. CONTEXT pre-locks this. |
| Re-parse `JSON.parse(abi)` on every cache hit | Memoize parsed `viem.Abi` | Memoize. ~1-3ms per parse vs sub-ms decode; 3-5 hits per session adds up. See "Claude's Discretion" reasoning above. |
| Add `acknowledgeNonProtocolTarget` to `HandleRecord` top-level | Add to a sub-record or parallel `escape-hatch-flags` Map | Top-level optional field on `HandleRecord` is the natural location — mirrors `pinned?: PreviewPinned` and `sentAt?: number`. Keeps the data inline with the record it modifies. Type-surface change is one optional field. |

**Installation:**
No new npm packages required. All capabilities (`viem.encodeFunctionData` / `viem.decodeFunctionData` / `viem.decodeFunctionResult` / `viem.publicClient.call`) are already in the in-tree `viem` dependency.

**Version verification:** Not applicable — no new dependencies to verify. `viem` is the project's standard EVM client (referenced in CLAUDE.md Technology Stack), already imported across 80+ source files.

## Package Legitimacy Audit

Phase 35 installs **no external packages**. All required surfaces (`viem.encodeFunctionData` / `viem.decodeFunctionData` / `viem.decodeFunctionResult` / `viem.publicClient.call` / `viem.Abi`) are exported from the existing in-tree `viem` dependency. No `npm install` step is part of this phase.

slopcheck not run — N/A (no packages to verify).

## Architecture Patterns

### System Architecture Diagram

```
Agent
  │ stdio (MCP protocol)
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 35 surfaces (NEW)                                         │
│                                                                 │
│  get_contract_abi(chain, address)                               │
│    │                                                            │
│    ▼                                                            │
│  src/clients/etherscan.ts                                       │
│    fetchEtherscanAbi(chainId, address)  ←── 4-arm DU            │
│    cache: Map<`${chainId}:${address}`, EtherscanAbiResult>      │
│    abiCache: Map<`${chainId}:${address}`, viem.Abi> (parsed)    │
│    agentSessionCallCount (shared with existing source-fetch)    │
│    │                                                            │
│    ▼                                                            │
│  Etherscan V2 API (chainid={N}&module=contract&action=getabi)   │
│                                                                 │
│                                                                 │
│  read_contract(chain, address, functionName, args)              │
│    │                                                            │
│    ▼                                                            │
│  src/tools/read_contract.ts                                     │
│    1. fetchEtherscanAbi → 4-arm DU                              │
│    2. inspect ABI entry → reject if not view/pure               │
│    3. viem.encodeFunctionData(abi, fn, args)                    │
│    4. publicClient.call({ to, data })                           │
│    5. viem.decodeFunctionResult(abi, fn, returnData)            │
│                                                                 │
│                                                                 │
│  prepare_custom_call(chain, to, data, value?, ack: true)        │
│    │                                                            │
│    ▼                                                            │
│  src/tools/prepare_custom_call.ts                               │
│    1. schema gate: ack === true (else NON_PROTOCOL_TARGET_NOT_ACK)
│    2. compute payloadFingerprint (FROZEN PREP-03 envelope)      │
│    3. createHandle({ ..., acknowledgeNonProtocolTarget: true }) │
│    4. emit PREPARE RECEIPT + [WARN — NON-PROTOCOL TARGET] block │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

         │ (handle flows through standard pipeline)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Existing pipeline (UNCHANGED except ONE branch in preview_send)  │
│                                                                 │
│  preview_send(handle, chain?)                                   │
│    Layer 0.5 dispatch-target check:                             │
│      if (record.tx.data !== "0x") {                             │
│        if (record.acknowledgeNonProtocolTarget) {               │
│          // BYPASS — emit WARN block instead of refusal          │
│        } else {                                                 │
│          _canonicalDispatch.checkDispatchTarget(...)            │
│        }                                                        │
│      }                                                          │
│    Layer 2 chain-mismatch (UNCHANGED)                           │
│    ... rest of pipeline UNCHANGED ...                           │
│    Custom-call branch (NEW):                                    │
│      if (record.preparedBy === "prepare_custom_call") {         │
│        lookup ABI from abiCache via `${chainId}:${to}`          │
│        cache HIT → viem.decodeFunctionData → CHECKS PERFORMED   │
│        cache MISS → "Blind sign — no ABI available. selector=…" │
│      }                                                          │
│                                                                 │
│  send_transaction (FROZEN three gates — UNCHANGED)              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── clients/
│   └── etherscan.ts             # EXTEND — add fetchEtherscanAbi() + abiCache + chainId param widening
├── tools/
│   ├── get_contract_abi.ts      # NEW — thin tool surface over fetchEtherscanAbi
│   ├── read_contract.ts         # NEW — ABI fetch + encodeFunctionData + publicClient.call + decodeFunctionResult
│   ├── prepare_custom_call.ts   # NEW — clone of prepare_native_send.ts + ack-flag gate + data passthrough + WARN block
│   ├── preview_send.ts          # EXTEND — 1 bypass branch (lines 792-814) + 1 custom-call decode branch
│   ├── check_contract_security.ts # EXTEND — lift v1.2-Ethereum-only runtime refusal (free downstream)
│   └── index.ts                 # EXTEND — register new tools
├── security/
│   └── canonical-alternatives.ts # NEW — selector → canonical tool lookup table + lookupCanonicalAlternative() helper
├── signing/
│   ├── blocks.ts                # APPEND-ONLY — 3 new templates (WARN_NON_PROTOCOL_TARGET + CUSTOM_CALL_PREPARE_RECEIPT + NON_PROTOCOL_TARGET_REFUSAL)
│   ├── handle-store.ts          # ADDITIVE-TYPE-SURFACE — add `acknowledgeNonProtocolTarget?: true` + `preparedBy?: string` to HandleRecord
│   ├── payload-fingerprint.ts   # FROZEN — UNCHANGED
│   ├── presign-hash.ts          # FROZEN — UNCHANGED
│   └── error-codes.ts           # APPEND-ONLY — 3 new codes (NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED + NON_VIEW_FUNCTION + ABI_NOT_AVAILABLE)
└── ... (everything else unchanged)

test/
├── signing-fingerprint.test.ts  # APPEND Fixture P hardcoded literal anchor
├── prepare-custom-call.test.ts  # NEW — schema gate + ack-false refusal + ack-true success + record flag + Fixture P cross-link
├── read-contract.test.ts        # NEW — view-only refusal + ABI-fetch error arms + happy path
├── get-contract-abi.test.ts     # NEW — multi-chain Etherscan fetch + 4-arm DU
├── preview-send.custom-call.test.ts # NEW — bypass branch + WARN block + decode-HIT + decode-MISS
├── clients-etherscan-multichain.test.ts # NEW — chainId widening + per-chain cache + shared rate counter
├── security-canonical-alternatives.test.ts # NEW — selector lookup table + collision case
└── integration/
    └── escape-hatch.test.ts     # NEW — end-to-end abi-fetch → prepare → preview-with-decode → send-fingerprint-match
```

### Pattern 1: Mirror `fourbyte.ts` for the new ABI client

**What:** New `fetchEtherscanAbi(chainId, address)` mirrors `clients/fourbyte.ts` shape — never-throws contract, AbortController timeout, 4-arm DU, LRU cache, stderr-only logging via `log()`, `vi.stubGlobal("fetch", …)` test seam at the network boundary.

**When to use:** ALWAYS for this phase. CONTEXT pre-locks: "mirror of `cache` in `fourbyte.ts` / `etherscan.ts`".

**Example (research-extracted shape):**
```typescript
// src/clients/etherscan.ts (extension)

export type EtherscanAbiResult =
  | { kind: "ok"; abi: viem.Abi; rawAbiJson: string; sourceCodeUrl: string }
  | { kind: "not-verified" }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

const ETHERSCAN_API_URL = "https://api.etherscan.io/v2/api";
const ABI_CACHE_MAX_ENTRIES = 64;

// Parallel to existing `cache: Map<Address, EtherscanResult>` —
// keyed by `${chainId}:${address}` to support multi-chain.
// Existing rate counter `agentSessionCallCount` is REUSED (shared bucket per Etherscan V2 design).
const abiCache = new Map<string, EtherscanAbiResult>();

export async function fetchEtherscanAbi(
  chainId: ChainId,
  address: Address,
  apiKey: string,
): Promise<EtherscanAbiResult> {
  const cacheKey = `${chainId}:${address}`;
  const cached = abiCache.get(cacheKey);
  if (cached) return cached;

  if (agentSessionCallCount >= PER_SESSION_CALL_LIMIT) {
    return { kind: "rate-limited", message: `per-session limit (${PER_SESSION_CALL_LIMIT} calls) exceeded; resets at MCP server restart.` };
  }
  agentSessionCallCount += 1;

  const url = `${ETHERSCAN_API_URL}?chainid=${chainId}&apikey=${apiKey}&module=contract&action=getabi&address=${address}`;
  // ... fetch + AbortController(3000ms) + 4-arm DU ...
  // Etherscan V2 `getabi` response shape (verified 2026-05-26 docs.etherscan.io):
  //   { status: "1", message: "OK", result: <stringified JSON ABI array> }   → kind: "ok"
  //   { status: "0", message: "NOTOK", result: "Contract source code not verified" } → kind: "not-verified"
  // Parse via JSON.parse + cast to viem.Abi (parse-once memoization).
  // sourceCodeUrl = `https://etherscan.io/address/${address}#code` for chainId=1; per-chain explorer base URL for others.
}
```

### Pattern 2: Widen existing `fetchEtherscanContractInfo` to multi-chain

**What:** The existing `checkContractSecurity(address: Address, apiKey: string)` function in `src/clients/etherscan.ts` hardcodes `chainid=1` (lines 217-218). Phase 35-01 adds `chainId: ChainId` parameter as the FIRST positional arg.

**Backwards-compat strategy:** None needed. The function is only consumed by `check_contract_security.ts:168` — one call site — which is also being widened in the same plan. Type-system enforces the change.

**Cache-key widening:** Current `cache: Map<Address, EtherscanResult>` → new `cache: Map<string, EtherscanResult>` keyed by `${chainId}:${address}`. Mirror in the rate counter narrative: counter STAYS GLOBAL (verified from Etherscan docs — rate limit applies per API key, not per chain).

**Example call-site change:**
```typescript
// Before (check_contract_security.ts:168)
const result = await etherscanCheckContractSecurity(address, apiKey);

// After
const result = await etherscanCheckContractSecurity(chainId, address, apiKey);
```

### Pattern 3: `prepare_custom_call` clone of `prepare_native_send`

**What:** `prepare_custom_call.ts` mirrors `prepare_native_send.ts` shape. Key deltas:

1. Schema additions: `to`, `data` (Hex), `value` (optional, default `"0"`), `acknowledgeNonProtocolTarget: { const: true }` (JSON-Schema literal).
2. Schema gate FIRST: refuse with `NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED` if flag missing/false. Refusal text invokes `lookupCanonicalAlternative(selector)` → either suggests a specific tool or lists categories.
3. Build `tx = { chainId, to: getAddress(args.to), valueWei: BigInt(args.value ?? "0"), data: args.data as Hex }`.
4. Compute payloadFingerprint via FROZEN `computePayloadFingerprint(tx)`.
5. `createHandle({ args, tx, payloadFingerprint, acknowledgeNonProtocolTarget: true, preparedBy: "prepare_custom_call" })` — last two are NEW HandleRecord fields.
6. Emit response: `CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE` (NEW) followed by `WARN_NON_PROTOCOL_TARGET_TEMPLATE` (NEW). WARN block contains: address, "this bypasses the canonical-dispatch allowlist", decoded function name when ABI is cached, "If unsure, decline on-device".

### Pattern 4: `read_contract` via low-level `publicClient.call({ to, data })`

**What:** The view-function read tool uses LOW-LEVEL `publicClient.call` (not `readContract`) for fine-grained error-arm control. Confirmed via viem.sh docs: `call({ to, data })` returns raw hex bytes, gas-free, no broadcast.

**Sequence:**
```typescript
// 1. Fetch ABI (cache-first via fetchEtherscanAbi)
const abiResult = await fetchEtherscanAbi(chainId, to, etherscanApiKey);
if (abiResult.kind !== "ok") {
  // Return verbatim refusal: NOT_VERIFIED / RATE_LIMITED / ERROR — NO blind-call fallback
  return abiNotAvailableRefusal(abiResult);
}

// 2. Find function entry in ABI; refuse if not view/pure
const abi = abiResult.abi;
const entry = abi.find((e) => e.type === "function" && e.name === args.functionName);
if (!entry) return functionNotFoundRefusal(args.functionName, abi);
if (entry.stateMutability !== "view" && entry.stateMutability !== "pure") {
  return nonViewRefusal(entry); // NON_VIEW_FUNCTION error code; directs to prepare_custom_call
}

// 3. Encode + call + decode
const data = viem.encodeFunctionData({ abi, functionName: args.functionName, args: args.args });
const client = getChainClient(chainId);
const { data: returnData } = await client.call({ to: getAddress(args.address), data }); // gas-free, no broadcast
const decoded = viem.decodeFunctionResult({ abi, functionName: args.functionName, data: returnData });

// 4. Return decoded result + ABI source URL
return { decoded, sourceCodeUrl: abiResult.sourceCodeUrl };
```

**Per-call timeout:** 5s wall-clock (1 RPC + 1 Etherscan call worst case; mirrors per-RPC ceiling). Implement via `AbortController` wrapping both fetches.

### Anti-Patterns to Avoid

- **Treating ABI cache miss at preview as a tamper signal.** Cache MISS is the legitimate "agent didn't call `get_contract_abi` first" path — emit `Blind sign — no ABI available. The selector 0x{first 4 bytes} is shown on-device.` MUST NOT refuse on cache MISS. CONTEXT pre-locks.
- **Falling back to 4byte.directory for selector lookup when ABI is unavailable.** Explicitly NOT included per CONTEXT. Absence of ABI is itself meaningful information for the user; degraded-mode lookup obscures this.
- **Re-parsing `JSON.parse(abi)` on every consumer call.** Parse ONCE at `fetchEtherscanAbi` client layer; cache the parsed array. Consumers receive `viem.Abi` directly.
- **Inlining canonical contract addresses for selector lookup.** Selectors are derived from `KNOWN_SPENDERS_ETHEREUM` + Aave Pool + Lido + etc. — but the LOOKUP TABLE lives in `src/security/canonical-alternatives.ts`, NOT in `prepare_custom_call.ts` and NOT in `src/config/contracts.ts`. `contracts.ts` stays canonical-address-SOT; `canonical-alternatives.ts` is the selector→tool routing.
- **Setting `acknowledgeNonProtocolTarget = true` from any tool other than `prepare_custom_call`.** Grep-guard test asserts exactly one assignment site outside `handle-store.ts` (type defn). Test passes only when no other `prepare_*` tool can mint a bypass-flagged handle.
- **Touching `payload-fingerprint.ts` / `presign-hash.ts` / `handle-store.ts` state machine / `send_transaction.ts` three gates.** FROZEN. The only `handle-store.ts` change permitted is ADDITIVE TYPE SURFACE (`acknowledgeNonProtocolTarget?: true` + `preparedBy?: string` as optional `HandleRecord` fields).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ABI parsing from JSON | Custom AST traversal | `JSON.parse(abiString) as viem.Abi` | viem.Abi is a thin TypeScript type over JSON ABI arrays; structural typing |
| Function-data encoding | Hand-rolled abi.encodeWithSignature | `viem.encodeFunctionData({ abi, functionName, args })` | viem handles ABIv2 complexities (dynamic arrays, structs, etc.) and matches the on-chain encoder byte-for-byte |
| Function-result decoding | Manual response-data slicing | `viem.decodeFunctionResult({ abi, functionName, data })` | Same — pairs perfectly with encodeFunctionData and handles return-tuple shapes |
| view/pure detection | Heuristic name matching | Inspect `entry.stateMutability` directly | The ABI carries this verbatim; no inference needed |
| Gas-free RPC read | Custom JSON-RPC eth_call composer | `publicClient.call({ to, data })` | viem normalizes block-tag, account, and error-shape handling |
| LRU cache | Custom Map+age-tracking | `Map` with insertion-order eviction (mirror of `fourbyte.ts` cache) | Existing pattern; review-tested; <50 lines |
| Etherscan rate limiter | Custom token bucket | Reuse existing `agentSessionCallCount` in `etherscan.ts` (single bucket per CONTEXT lock) | Etherscan V2 enforces per-API-key, not per-chain |
| Selector → canonical-tool routing | Custom dispatch parser | `src/security/canonical-alternatives.ts` lookup table (NEW; pure data + 1 helper) | The same pattern as `KNOWN_SPENDERS_ETHEREUM` row mapping; small, append-only, regression-tested |
| Domain-tagged keccak preimage | Hand-rolled | EXISTING `computePayloadFingerprint(tx)` from `src/signing/payload-fingerprint.ts` (FROZEN) | The escape hatch's whole point is that it composes with the standard PREP-03 envelope — no new fingerprint shape |

**Key insight:** Phase 35 is mostly composition over EXISTING infrastructure. The only genuine NEW logic is (a) the `fetchEtherscanAbi` 4-arm DU + per-session ABI cache; (b) the selector → canonical-alternative lookup table; (c) the WARN block template; (d) the 1-line bypass branch in `preview_send`. Everything else is mechanical clone.

## Runtime State Inventory

Not applicable — Phase 35 is a feature addition, not a rename/refactor/migration. No existing strings or stored state require updating.

## Common Pitfalls

### Pitfall 1: Putting the bypass flag on the WRONG dispatch-check call site

**What goes wrong:** `preview_send.ts` calls `_canonicalDispatch.checkDispatchTarget` at the EVM block (~line 793) AND has structurally similar refusal blocks in the Solana branch (line 2082), TRON branch (line 2811), and elsewhere. If the bypass branch is added to ALL dispatch sites instead of just the EVM one, the escape hatch leaks into non-EVM chains where Phase 35 has no schema gate, no Fixture P, and no integration test.

**Why it happens:** Search-and-replace mindset; the EVM block looks structurally identical to the Solana/TRON blocks because of CONTEXT D-09 design parity.

**How to avoid:** The bypass flag check applies ONLY to the EVM dispatch site at `preview_send.ts:792-814`. The Solana / TRON / BTC dispatch sites (lines 2082, 2811, 2933) MUST NOT read `record.acknowledgeNonProtocolTarget`. Plan-checker assertion: grep for `acknowledgeNonProtocolTarget` in `preview_send.ts` — exactly ONE hit (the EVM branch).

**Warning signs:** Test `test/preview-send.custom-call.test.ts` should include a NEGATIVE assertion: a Solana / TRON handle with `acknowledgeNonProtocolTarget: true` SHOULD NOT bypass canonical-dispatch (because no Solana/TRON tool produces such a handle in Phase 35, so the field is always absent; the negative test confirms even synthetic injection fails because the branches don't read it).

### Pitfall 2: Computing `payloadFingerprint` with a different shape for custom calls

**What goes wrong:** The escape hatch tempts a "custom-call-specific" fingerprint shape (e.g., adding an `acknowledgeNonProtocolTarget` byte to the preimage). This breaks the cryptographic-binding guarantee — `send_transaction`'s Layer 3 drift gate re-runs `computePayloadFingerprint` over `record.tx` and would silently mismatch.

**Why it happens:** Confusion between "bypass flag" (a record-level annotation) and "fingerprint dimension" (a calldata-level binding).

**How to avoid:** CONTEXT pre-locks: `payloadFingerprint` over standard PREP-03 envelope (`{ chainId, to, valueWei, data }`). The bypass flag is a SEPARATE record field. Fixture P verifies byte-identity with the existing envelope shape; persona-cycle test confirms `from`-independence (same args from two personas → same fingerprint).

**Warning signs:** If `prepare_custom_call.ts` imports anything other than `computePayloadFingerprint` from `src/signing/payload-fingerprint.ts`, that's a red flag.

### Pitfall 3: Per-session ABI cache leaking across sessions or chains

**What goes wrong:** Two scenarios:
1. Cache keyed by `Address` alone (current `etherscan.ts:89` shape) — Etherscan returns the wrong ABI on chain 2 if the address happens to exist on both chains with different contracts.
2. Cache persists across MCP server restart — agent reads a stale ABI after a deploy.

**Why it happens:** Plumbing oversight; the existing `cache: Map<Address, EtherscanResult>` was Ethereum-only by design and didn't need chain-keying.

**How to avoid:** Widen the cache key to `${chainId}:${address}` for the new `abiCache`. Existing `cache` (for `checkContractSecurity`) ALSO widens — same plan, same widening (free downstream effect). Per-MCP-restart reset is intentional and matches existing pattern (in-memory `Map` dies with the process). CONTEXT pre-locks.

**Warning signs:** Test `test/clients-etherscan-multichain.test.ts` should have a "same address, two chains" assertion: `fetchEtherscanAbi(1, 0xABC, key)` and `fetchEtherscanAbi(137, 0xABC, key)` MUST hit the network twice (no cross-chain cache hit).

### Pitfall 4: ABI-decode-at-preview emitting decoded args when there is no ABI cache hit

**What goes wrong:** The `preview_send` custom-call branch falls through to a degraded-mode decode (e.g., 4byte fallback) when the ABI cache misses. This obscures the "no ABI" signal — the user might assume the args are validated when they aren't.

**Why it happens:** Engineer instinct to "always show SOMETHING" rather than the deliberate "absence of ABI is meaningful information" design.

**How to avoid:** CONTEXT pre-locks: cache MISS → CHECKS PERFORMED literally says `Blind sign — no ABI available. The selector 0x{first 4 bytes} is shown on-device.` NO fallback. Plan-checker: grep `prepare_custom_call` arm of `preview_send.ts` for any 4byte / fourbyte / selector-lookup call — must be zero.

**Warning signs:** Test asserts the literal "Blind sign — no ABI available" string appears in the preview response when the cache is empty.

### Pitfall 5: The WARN block drifting between `prepare_custom_call` response and `preview_send` response

**What goes wrong:** The WARN block emits in BOTH places (defense-in-depth — agent sees it at prepare; user sees it again at preview). If the two emissions drift (different wording, different field labels, etc.), an attacker can't be detected via a simple cross-check.

**Why it happens:** Two callers, two paths, two opportunities to drift.

**How to avoid:** Format-fanout-sentinel pattern (CLAUDE.md rule). `WARN_NON_PROTOCOL_TARGET_TEMPLATE` lives in `src/signing/blocks.ts` as the SINGLE source. Both callers import and substitute via `.replace(...)`. Integration test `test/integration/escape-hatch.test.ts` asserts byte-identical block text in both responses. Per CONTEXT: "drift between the two is itself a tamper signal — integration test asserts byte-identity".

**Warning signs:** Any inline string literal containing `[WARN — NON-PROTOCOL TARGET]` outside `blocks.ts` is a violation. Grep test enforces.

### Pitfall 6: Etherscan V2 ABI endpoint returning the same "not-verified" string Etherscan v1 returned

**What goes wrong:** The `getabi` endpoint returns `{ status: "0", message: "NOTOK", result: "Contract source code not verified" }` for unverified contracts (verified 2026-05-26 docs.etherscan.io). If the client treats `status: "0"` as `kind: "error"` instead of `kind: "not-verified"`, the user sees a confusing "Etherscan unreachable" message when the real issue is the contract isn't verified.

**Why it happens:** Conflating HTTP errors (5xx, timeouts) with API-level "status: 0" responses.

**How to avoid:** Inspect `result` field text on `status: "0"`. If `result === "Contract source code not verified"` → `kind: "not-verified"`. ALL OTHER `status: "0"` shapes → `kind: "error"` with verbatim `message` or `result`. Mirror of how the existing `checkContractSecurity` handles `getsourcecode`'s `sourceCode === ""` sentinel.

**Warning signs:** Test `test/clients-etherscan-multichain.test.ts` includes a "not-verified" arm test that mocks the exact response shape and asserts `kind === "not-verified"`.

### Pitfall 7: The `acknowledgeNonProtocolTarget` schema being a regular boolean instead of `const: true`

**What goes wrong:** If the schema accepts `boolean`, the JSON-Schema validator passes `acknowledgeNonProtocolTarget: false` at the dispatch boundary. The in-handler refusal still catches it — but the schema is the LOAD-BEARING gate, not a defense-in-depth check.

**Why it happens:** JSON-Schema `type: "boolean"` is the default reach; engineer reads "required boolean" as `type: "boolean"`.

**How to avoid:** Use `{ const: true, type: "boolean" }` in the JSON-Schema. The dispatch boundary refuses any other value before the handler runs. Test asserts that `acknowledgeNonProtocolTarget: false` returns the dispatch-boundary-level refusal (not the in-handler one).

**Warning signs:** Test `test/prepare-custom-call.test.ts` has an explicit case for `acknowledgeNonProtocolTarget: false` and asserts the JSON-Schema validation error shape.

## Code Examples

### Example 1: `fetchEtherscanAbi` — never-throws contract + 4-arm DU + cache

```typescript
// src/clients/etherscan.ts (Phase 35 extension; mirrors checkContractSecurity shape)

import type { Abi } from "viem";

export type EtherscanAbiResult =
  | { kind: "ok"; abi: Abi; rawAbiJson: string; sourceCodeUrl: string }
  | { kind: "not-verified" }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

const abiCache = new Map<string, EtherscanAbiResult>();
const ABI_CACHE_MAX_ENTRIES = 64;

// Per-chain explorer base — extends to a small table once non-Ethereum chains
// land. v1.2-Ethereum-only baseline (CONTEXT — multi-chain widening is the
// primary scope of Phase 35-01).
function buildSourceCodeUrl(chainId: number, address: string): string {
  switch (chainId) {
    case 1: return `https://etherscan.io/address/${address}#code`;
    case 42161: return `https://arbiscan.io/address/${address}#code`;
    case 137: return `https://polygonscan.com/address/${address}#code`;
    case 8453: return `https://basescan.org/address/${address}#code`;
    case 10: return `https://optimistic.etherscan.io/address/${address}#code`;
    default: return `https://etherscan.io/address/${address}#code`;
  }
}

export async function fetchEtherscanAbi(
  chainId: ChainId,
  address: Address,
  apiKey: string,
): Promise<EtherscanAbiResult> {
  const cacheKey = `${chainId}:${address}`;
  const cached = abiCache.get(cacheKey);
  if (cached) return cached;

  // Shared rate counter with checkContractSecurity (Etherscan V2 per-API-key).
  if (agentSessionCallCount >= PER_SESSION_CALL_LIMIT) {
    return {
      kind: "rate-limited",
      message: `per-session limit (${PER_SESSION_CALL_LIMIT} calls) exceeded; resets at MCP server restart.`,
    };
  }
  agentSessionCallCount += 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ETHERSCAN_TIMEOUT_MS);

  const url = `${ETHERSCAN_API_URL}?chainid=${chainId}&apikey=${apiKey}&module=contract&action=getabi&address=${address}`;

  let result: EtherscanAbiResult;
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      result = { kind: "error", message: `Etherscan V2 returned HTTP ${resp.status}` };
    } else {
      const body = await resp.json() as { status?: string; message?: string; result?: string };
      if (body.status === "1" && typeof body.result === "string") {
        try {
          const abi = JSON.parse(body.result) as Abi;
          if (!Array.isArray(abi)) throw new Error("ABI is not an array");
          result = {
            kind: "ok",
            abi,
            rawAbiJson: body.result,
            sourceCodeUrl: buildSourceCodeUrl(chainId, address),
          };
        } catch (parseErr) {
          result = { kind: "error", message: `ABI JSON parse failed: ${String(parseErr)}` };
        }
      } else if (body.status === "0" && body.result === "Contract source code not verified") {
        result = { kind: "not-verified" };
      } else {
        result = { kind: "error", message: `Etherscan getabi failed: ${body.message ?? body.result ?? "unknown"}` };
      }
    }
  } catch (err) {
    const e = err as Error;
    if (e?.name === "AbortError") {
      result = { kind: "error", message: `Etherscan V2 unreachable (timeout ${ETHERSCAN_TIMEOUT_MS}ms)` };
    } else {
      result = { kind: "error", message: `Etherscan V2 unreachable: ${e?.message ?? String(err)}` };
    }
    log("warn", `Etherscan V2 ABI lookup failed for ${chainId}:${address}: ${result.message}`);
  } finally {
    clearTimeout(timer);
  }

  abiCacheInsert(cacheKey, result);
  return result;
}

function abiCacheInsert(key: string, result: EtherscanAbiResult): void {
  if (abiCache.size >= ABI_CACHE_MAX_ENTRIES) {
    const oldestKey = abiCache.keys().next().value;
    if (oldestKey !== undefined) abiCache.delete(oldestKey);
  }
  abiCache.set(key, result);
}

export function _resetEtherscanAbiCacheForTesting(): void {
  abiCache.clear();
}
```

### Example 2: `prepare_custom_call` schema gate + handle flag

```typescript
// src/tools/prepare_custom_call.ts (NEW; clone of prepare_native_send.ts shape)

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"] },
    to: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    data: { type: "string", pattern: "^0x[0-9a-fA-F]*$" },
    value: { type: "string", description: "WEI as decimal string. Default \"0\"." },
    acknowledgeNonProtocolTarget: { const: true, type: "boolean" }, // LITERAL true — JSON-Schema gate
    from: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
  },
  required: ["chain", "to", "data", "acknowledgeNonProtocolTarget"],
  additionalProperties: false,
};

registerTool("prepare_custom_call", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // The JSON-Schema literal gate catches `acknowledgeNonProtocolTarget !== true`
  // at the dispatch boundary; in-handler check is defense-in-depth.
  if (args.acknowledgeNonProtocolTarget !== true) {
    const selectorHex = (args.data as string).slice(0, 10) as Hex;  // 0x + 8 hex
    const alternative = lookupCanonicalAlternative(selectorHex);
    const refusalText = NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE
      .replace("{TO}", String(args.to))
      .replace("{SELECTOR}", selectorHex)
      .replace("{SUGGESTION}", alternative
        ? `Use ${alternative.tool} instead (canonical-dispatch routed; ${alternative.reason}).`
        : "No canonical alternative recognized for this selector. If the user has explicitly confirmed they want to call this non-protocol contract, re-call with acknowledgeNonProtocolTarget: true.");
    return errEnvelope("NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED", refusalText);
  }

  // ... resolve chainId / from / validate inputs (mechanical clone of prepare_native_send.ts) ...

  const tx: PreparedTxEvm = {
    chainId,
    to: getAddress(args.to as string),
    valueWei: BigInt(args.value ?? "0"),
    data: args.data as Hex,
  };
  const payloadFingerprint = computePayloadFingerprint(tx);  // FROZEN

  // NEW HandleRecord fields: acknowledgeNonProtocolTarget + preparedBy.
  const handle = createHandle({
    args: { to: String(args.to), valueWei: String(args.value ?? "0"), data: args.data as string },
    tx,
    payloadFingerprint,
    acknowledgeNonProtocolTarget: true,  // NEW
    preparedBy: "prepare_custom_call",    // NEW
  });

  // Emit PREPARE RECEIPT + WARN block. The same WARN block text re-emits in preview_send.
  const warnBlock = buildWarnNonProtocolTargetBlock({
    chain: args.chain as string,
    to: args.to as string,
    decodedFunctionName: tryBestEffortDecodeName(chainId, args.to as Address, args.data as Hex), // null if no ABI cached
  });
  const receipt = CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE
    .replace("{CHAIN}", `${args.chain} (chainId ${chainId})`)
    .replace("{TO}", String(args.to))
    .replace("{VALUE}", String(args.value ?? "0"))
    .replace("{DATA}", String(args.data));
  return {
    content: [{ type: "text", text: [warnBlock, receipt].join("\n\n") }],
    structuredContent: { handle, chain: args.chain, chainId, to: args.to, value: args.value ?? "0", data: args.data, payloadFingerprint, acknowledgeNonProtocolTarget: true },
  };
});
```

### Example 3: `preview_send` bypass branch (single 4-line addition)

```typescript
// src/tools/preview_send.ts (modification at lines 792-814 EVM dispatch site)

// CURRENT (Phase 9 / 09-04):
if (record.tx.data !== "0x") {
  const dispatchCheck = _canonicalDispatch.checkDispatchTarget(
    record.tx.chainId as ChainId,
    record.tx.to,
  );
  if (dispatchCheck.kind === "refused") {
    // ... DISPATCH_TARGET_REFUSED refusal ...
  }
}

// AFTER Phase 35-03:
if (record.tx.data !== "0x") {
  if (record.acknowledgeNonProtocolTarget === true) {
    // Bypass dispatch-target check — the prepare_custom_call schema gate
    // is the load-bearing defense (user acknowledged at prepare time).
    // Fall through to standard preview flow; the WARN block emits below.
  } else {
    const dispatchCheck = _canonicalDispatch.checkDispatchTarget(
      record.tx.chainId as ChainId,
      record.tx.to,
    );
    if (dispatchCheck.kind === "refused") {
      // ... DISPATCH_TARGET_REFUSED refusal (UNCHANGED) ...
    }
  }
}

// LATER in preview_send (after standard blocks assembled), the custom-call
// branch adds the WARN block + best-effort decode:
if (record.preparedBy === "prepare_custom_call") {
  const warnBlock = buildWarnNonProtocolTargetBlock({ chain, to: record.tx.to, decodedFunctionName: bestEffortDecode(record.tx.chainId, record.tx.to, record.tx.data) });
  const decodeBlock = buildCustomCallDecodeBlock(record.tx);  // either decoded args or "Blind sign — no ABI available"
  // Prepend warnBlock; insert decodeBlock into the standard CHECKS PERFORMED area.
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded `chainid=1` in `etherscan.ts` (v1.2 FROZEN) | `chainId: ChainId` parameter + per-chain explorer URLs + `${chainId}:${address}` cache key | Phase 35-01 | `check_contract_security` lifts its v1.2-Ethereum-only runtime refusal (FREE downstream) |
| `EtherscanResult` 5-arm DU (ok / not-applicable / not-verified / rate-limited / error) | NEW parallel `EtherscanAbiResult` 4-arm DU (ok / not-verified / rate-limited / error — NO `not-applicable`) | Phase 35-01 | ABI fetch is always applicable when called; `not-applicable` would never fire |
| No per-session ABI cache (each tool re-fetches) | LRU `abiCache: Map<string, EtherscanAbiResult>` keyed by `${chainId}:${address}` | Phase 35-01 | Cross-tool session: `get_contract_abi` → `read_contract` → `prepare_custom_call` decodes at preview without re-fetching |
| Canonical-dispatch allowlist enforced UNIFORMLY (Phase 9 Layer 0.5) | One additional bypass branch via `record.acknowledgeNonProtocolTarget` | Phase 35-03 | Power-user escape hatch with schema-level user acknowledgment as the load-bearing gate |
| Selector-only fallback via 4byte for blind-sign args | NO fallback for custom calls (cache HIT = decode; MISS = "Blind sign — no ABI available") | Phase 35-03 | Absence of ABI surfaces as meaningful info; user knows when they're truly blind-signing |

**Deprecated/outdated:** None for this phase. The Phase 9 dispatch allowlist remains the default path for all protocol-routed tools; Phase 35 is strictly additive.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Etherscan V2 `module=contract&action=getabi` returns `{ status: "1", message: "OK", result: <stringified JSON ABI> }` on success and `{ status: "0", message: "NOTOK", result: "Contract source code not verified" }` for unverified contracts | Topic 1 + Pitfall 6 | LOW — confirmed via docs.etherscan.io + paradigmxyz/reth issue #17140 search; happy-path test against a known-verified contract (Aave V3 Pool 0x87870Bca…) will catch any drift at execute time |
| A2 | The Etherscan V2 5-req/sec rate limit applies per API key, NOT per chain (single bucket across all chains) | Topic 1 | LOW — verified via Etherscan info center documentation; same-bucket behavior is what `etherscan.ts` already assumes for `getsourcecode` |
| A3 | `viem.publicClient.call({ to, data })` is gas-free, returns raw hex bytes, and does NOT broadcast | Topic 5 + Pattern 4 | VERY LOW — confirmed via viem.sh docs; same surface already used by `src/clients/sunswap.ts` for Solana-side reads |
| A4 | The `viem.Abi` type is structurally `Array<{ type: string; name?: string; ... }>` and can be parsed via `JSON.parse(...)` with cast | Topic 2 | LOW — confirmed in `src/clients/etherscan.ts:143` (`JSON.parse(abiJson) as AbiEntry[]`) and dozens of `parseAbi(...)` call sites |
| A5 | `record.tx.data !== "0x"` is the correct guard for "this is a contract call (not native send)" in the preview_send bypass branch | Topic 3 | VERY LOW — this is the existing guard used by the Phase 9 Layer 0.5 dispatch-target check at `preview_send.ts:792`; mirrors it exactly |
| A6 | The Etherscan V2 ABI endpoint returns the SAME 3-second-ceiling latency as `getsourcecode` (we share `ETHERSCAN_TIMEOUT_MS = 3000`) | Topic 1 | LOW — ABI fetch is a single-row response (no source-code body); should be FASTER than `getsourcecode`. 3s is conservative |
| A7 | The user's payloadFingerprint comparison invariant survives when escape-hatch is used — i.e., calling the same `(chain, to, data, value)` from two personas produces the same fingerprint | Topic 8 | VERY LOW — `from` is NOT in the PREP-03 preimage by design (see `src/signing/payload-fingerprint.ts:26-29`); the persona-cycle test re-anchors the existing invariant |
| A8 | `JSON.parse(abi)` on a typical 5-50KB ABI string costs 1-3ms; memoizing the parsed array is worth doing | Topic 2 | LOW — not benchmarked here, but order-of-magnitude correct for V8 JSON.parse. Caching saves ~3-5 parses per session — small but cheap |
| A9 | Phase 35 does not require adding the per-chain explorer URL base table to `src/config/contracts.ts` — keeping it inline in `etherscan.ts` is acceptable | Code Example 1 (`buildSourceCodeUrl`) | LOW — these are SOURCE-LINK URLs, not contract addresses. The CLAUDE.md SOT rule applies to "canonical contract addresses (Aave Pool, Lido, etc.)" — explorer URLs are a different concern |
| A10 | A future Solana / TRON / BTC escape-hatch is out of scope for v2.4; the bypass flag CANNOT leak into non-EVM dispatch sites because the dispatch sites at `preview_send.ts:2082, 2811, 2933` are not modified | Topic 3 + Pitfall 1 | VERY LOW — the negative-test pattern (asserting non-EVM handles with synthetic `acknowledgeNonProtocolTarget: true` still refuse) catches any future regression |

**If this table is empty:** Not applicable. 10 assumptions listed; A1, A6, A8 carry the most uncertainty and benefit from execute-time tests against real Etherscan responses.

## Open Questions

1. **Should `read_contract` accept a `block: bigint | "latest"` parameter for historical reads?**
   - What we know: viem's `publicClient.call` accepts `blockNumber` / `blockTag` for historical state.
   - What's unclear: CONTEXT doesn't enumerate this — the implicit default is `"latest"`.
   - Recommendation: **Defer to v2.4.x.** Phase 35 ships `read_contract` against `"latest"` only. Historical reads are a separate UX surface and would require additional verification text in the response. CONTEXT's deferred list doesn't mention this explicitly, but the `Deferred Ideas` "corner case" theme covers it.

2. **What happens if `lookupCanonicalAlternative(selector)` finds MULTIPLE matches (selector collision)?**
   - What we know: 4-byte function selectors collide intentionally (`0x00000000` famously has dozens of matches in 4byte.directory).
   - What's unclear: For our SHORT lookup table (Aave Pool / Lido / WETH9 / Uniswap / Curve / etc.), are there real selector collisions?
   - Recommendation: **At write time, audit the selector table for collisions.** If two protocol arms share a selector (e.g., `WETH9.withdraw(uint256)` and any other `withdraw(uint256)`), the lookup MUST return BOTH suggestions, not the first one — otherwise the refusal mis-routes. Implementation: `lookupCanonicalAlternative(selector): Array<{ tool: string; reason: string }>` (returns array, may be empty, may have 2+). Plan-checker assertion: regression test ensures no selector in the table maps to >1 entry unless the entries are FULLY-DISAMBIGUATED via a secondary `recipient` check.

3. **Should the bypass flag also short-circuit Layer 2 (Phase 8 chain-name mismatch refusal)?**
   - What we know: Phase 8 Layer 2 fires at `preview_send.ts:831-849` — refuses when agent's `chain` arg disagrees with `record.tx.chainId`.
   - What's unclear: Should `prepare_custom_call` users get the same chain-mismatch defense?
   - Recommendation: **YES — keep Layer 2 active for escape-hatch handles.** Layer 2 is a state-consistency check (agent's claim ≠ bytes), NOT a security gate on the target. Escape-hatch users benefit from this defense as much as protocol-routed users. NO change to Layer 2 logic. CONTEXT implicitly supports this — only Layer 0.5 is named as bypass-eligible.

## Environment Availability

Phase 35 depends on:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `ETHERSCAN_API_KEY` env var | `get_contract_abi`, `read_contract` (via `fetchEtherscanAbi`) | Configurable — same key as Phase 7 `check_contract_security` | n/a | None — missing key returns INTERNAL_ERROR with signup URL (mirror of `check_contract_security.ts:148-166`) |
| Etherscan V2 API (5 supported chains) | ABI fetch path | Online (HTTP) | V2 | None — error arm surfaces verbatim |
| Per-chain viem `PublicClient` via `getChainClient(chainId)` | `read_contract` `publicClient.call` | EXISTING infrastructure | n/a | Existing per-chain RPC fallback (PublicNode) |
| `viem` (`encodeFunctionData` / `decodeFunctionData` / `decodeFunctionResult` / `Abi` / `publicClient.call`) | All three new tools | In-tree | latest | None needed |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None — phase composes over existing infrastructure.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (in tree; per CLAUDE.md Technology Stack) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run test/prepare-custom-call.test.ts test/read-contract.test.ts test/get-contract-abi.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CUSTOM-01 | `prepare_custom_call` schema gate refuses without ack flag | unit | `npx vitest run test/prepare-custom-call.test.ts -t "schema gate"` | ❌ Wave 0 |
| CUSTOM-01 | `prepare_custom_call` writes `acknowledgeNonProtocolTarget = true` to handle on success | unit | `npx vitest run test/prepare-custom-call.test.ts -t "record flag"` | ❌ Wave 0 |
| CUSTOM-01 | Bypass branch in `preview_send` short-circuits canonical-dispatch when flag is set | unit | `npx vitest run test/preview-send.custom-call.test.ts -t "bypass"` | ❌ Wave 0 |
| CUSTOM-01 | `[WARN — NON-PROTOCOL TARGET]` block byte-identical between prepare and preview | integration | `npx vitest run test/integration/escape-hatch.test.ts -t "WARN byte-identity"` | ❌ Wave 0 |
| CUSTOM-01 | Fixture P payloadFingerprint hardcoded literal anchor | unit | `npx vitest run test/signing-fingerprint.test.ts -t "Fixture P"` | ❌ Wave 0 (existing test file; append fixture) |
| CUSTOM-01 | Grep-guard: only `prepare_custom_call.ts` writes `acknowledgeNonProtocolTarget = true` | unit | `npx vitest run test/prepare-custom-call.test.ts -t "grep-guard"` | ❌ Wave 0 |
| CUSTOM-02 | Etherscan V2 multi-chain ABI fetch — 4-arm DU | unit | `npx vitest run test/clients-etherscan-multichain.test.ts -t "fetchEtherscanAbi"` | ❌ Wave 0 |
| CUSTOM-02 | Per-session ABI cache keyed by `${chainId}:${address}` (no cross-chain leak) | unit | `npx vitest run test/clients-etherscan-multichain.test.ts -t "per-chain cache"` | ❌ Wave 0 |
| CUSTOM-02 | `get_contract_abi` returns 4-arm DU mirroring client | unit | `npx vitest run test/get-contract-abi.test.ts` | ❌ Wave 0 |
| CUSTOM-02 | `check_contract_security` v1.2 Ethereum-only refusal LIFTED (multi-chain) | unit | `npx vitest run test/check-contract-security.test.ts -t "multi-chain"` | ✅ existing test file; extend |
| CUSTOM-03 | `read_contract` view-only refusal with `NON_VIEW_FUNCTION` code | unit | `npx vitest run test/read-contract.test.ts -t "non-view"` | ❌ Wave 0 |
| CUSTOM-03 | `read_contract` happy path with cache HIT | unit | `npx vitest run test/read-contract.test.ts -t "cache hit"` | ❌ Wave 0 |
| CUSTOM-03 | `read_contract` ABI-not-verified refusal surfaces verbatim | unit | `npx vitest run test/read-contract.test.ts -t "not-verified"` | ❌ Wave 0 |
| CUSTOM-03 | `preview_send` custom-call branch decodes args when cache HIT | unit | `npx vitest run test/preview-send.custom-call.test.ts -t "decode HIT"` | ❌ Wave 0 |
| CUSTOM-03 | `preview_send` custom-call branch emits "Blind sign — no ABI available" when cache MISS | unit | `npx vitest run test/preview-send.custom-call.test.ts -t "decode MISS"` | ❌ Wave 0 |
| (cross-cut) | End-to-end: abi-fetch → prepare → preview-decode → send-fingerprint-match | integration | `npx vitest run test/integration/escape-hatch.test.ts` | ❌ Wave 0 |
| (cross-cut) | Selector → canonical-alternative lookup table — no false positives, no collisions | unit | `npx vitest run test/security-canonical-alternatives.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run <changed-file>.test.ts` (each plan's task scope)
- **Per wave merge:** `npx vitest run test/prepare-custom-call.test.ts test/read-contract.test.ts test/get-contract-abi.test.ts test/preview-send.custom-call.test.ts test/clients-etherscan-multichain.test.ts test/security-canonical-alternatives.test.ts test/signing-fingerprint.test.ts test/integration/escape-hatch.test.ts test/check-contract-security.test.ts`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/prepare-custom-call.test.ts` — covers CUSTOM-01 (schema gate + record flag + grep-guard + ack-false refusal arm)
- [ ] `test/read-contract.test.ts` — covers CUSTOM-03 (non-view refusal + happy path + ABI-not-verified)
- [ ] `test/get-contract-abi.test.ts` — covers CUSTOM-02 (4-arm DU + multi-chain)
- [ ] `test/clients-etherscan-multichain.test.ts` — covers `fetchEtherscanAbi` + per-chain cache + shared rate counter
- [ ] `test/preview-send.custom-call.test.ts` — covers bypass branch + WARN block + decode HIT/MISS
- [ ] `test/security-canonical-alternatives.test.ts` — covers selector lookup + collision handling
- [ ] `test/integration/escape-hatch.test.ts` — end-to-end byte-identity (Fixture P + WARN block + decoded args)
- [ ] Fixture P literal anchor APPENDED to `test/signing-fingerprint.test.ts` (existing file)
- [ ] `test/check-contract-security.test.ts` — EXTEND existing file with multi-chain happy-path

Framework install: not needed (`vitest` already in tree).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 35 is read + prepare (no auth surface change; user-signing via Ledger is unchanged) |
| V3 Session Management | partial | Per-session ABI cache is in-memory; resets at MCP restart by design — matches existing fourbyte / etherscan / handle-store pattern |
| V4 Access Control | yes | `acknowledgeNonProtocolTarget: true` schema gate is the load-bearing access-control boundary for the escape hatch. Defense-in-depth: WARN block + in-handler re-check |
| V5 Input Validation | yes | JSON-Schema validates `to` (regex), `data` (hex regex), `value` (decimal string), `acknowledgeNonProtocolTarget` (literal true), `chain` (enum) |
| V6 Cryptography | partial | FROZEN: payloadFingerprint via `computePayloadFingerprint` (PREP-03 envelope). NO new crypto in Phase 35 |
| V8 Data Protection | yes | API key never logged (existing T-ETHERSCAN-KEY-LEAK-1 mitigation); URLs containing the key not surfaced in stderr |

### Known Threat Patterns for VaultPilot Escape Hatch (Phase 35)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| **T-CUSTOM-A: Bypass flag set on a non-prepare_custom_call handle** (an attacker-influenced future tool mints a handle with `acknowledgeNonProtocolTarget = true`) | Elevation of Privilege | Grep-guard test: assert exactly ONE source line writes `acknowledgeNonProtocolTarget: true` to a handle, and that line is in `src/tools/prepare_custom_call.ts`. Plan-checker validates per Plan 35-03 success criteria |
| **T-CUSTOM-B: WARN block drift between prepare and preview** (an attacker tampers with the agent's relay of the WARN block so the user sees different text at the two emission points) | Tampering | Single-source template in `signing/blocks.ts` (format-fanout-sentinel rule). Integration test asserts byte-identical block text in `prepare_custom_call` response AND `preview_send` response |
| **T-CUSTOM-C: Selector collision in canonical-alternative lookup gives wrong tool suggestion** (refusal text routes the agent to the wrong protocol-aware tool) | Repudiation / UX failure (NOT signing failure) | At write time, audit the selector table for collisions. If two protocol arms share a selector, return BOTH suggestions. Unit test in `test/security-canonical-alternatives.test.ts` enforces |
| **T-CUSTOM-D: ABI cache poisoning** (a tampered Etherscan response yields a different ABI than the user expects) | Tampering | Out of scope. Etherscan is the trust source; if Etherscan is compromised, the trust anchor remains the on-device hash match. Documented residual in SECURITY.md (existing — Phase 7 already lists Etherscan as trust source for `check_contract_security`) |
| **T-CUSTOM-E: Non-view function called via `read_contract` consuming gas** (concern would be: the call costs the user money) | (False alarm) | NOT a real threat: `eth_call` is GAS-FREE per Ethereum spec (verified via viem.sh docs). The `NON_VIEW_FUNCTION` refusal is a CORRECTNESS gate, not an economic one — calling a state-mutating function via `eth_call` would either revert or return misleading state-from-simulation, NOT cost gas. |
| **T-CUSTOM-F: Bypass flag leaking into non-EVM dispatch sites** (Solana / TRON / BTC pickup the flag) | Elevation of Privilege | The bypass branch is added ONLY to the EVM dispatch site at `preview_send.ts:792-814`. Non-EVM branches (lines 2082, 2811, 2933) are NOT modified. Plan-checker: grep `acknowledgeNonProtocolTarget` in `preview_send.ts` — exactly ONE hit |
| **T-CUSTOM-G: Schema gate bypass via JSON-Schema oversight** (`acknowledgeNonProtocolTarget: false` reaches the handler because the schema is `type: "boolean"` instead of `const: true`) | Elevation of Privilege | Use JSON-Schema `{ const: true, type: "boolean" }`. Defense-in-depth: in-handler re-check returns `NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED`. Test asserts dispatch-boundary refusal shape for `false` input |

## Sources

### Primary (HIGH confidence)

- `src/clients/etherscan.ts` — EXISTING client; mirror pattern for new `fetchEtherscanAbi`. Lines 217-218 are the `chainid=1` hardcode to widen
- `src/clients/fourbyte.ts` — EXISTING canonical never-throws-contract pattern for ABI client to mirror (4-arm DU + LRU + AbortController)
- `src/security/canonical-dispatch.ts` — EXISTING `_canonicalDispatch.checkDispatchTarget` indirection; line 273-286 is the dispatch surface, line 298 is the spy-affordance object
- `src/tools/preview_send.ts` — EXISTING — line 792-814 is the EVM dispatch-check site; lines 2082 / 2811 / 2933 are the non-EVM analogs (NOT modified by Phase 35)
- `src/signing/blocks.ts` — EXISTING APPEND-ONLY template surface; line 868-886 (`DISPATCH_TARGET_REFUSAL_TEMPLATE`) is the closest structural analog for the new WARN block
- `src/tools/prepare_native_send.ts` — EXISTING — mechanical clone target for `prepare_custom_call`
- `src/tools/prepare_weth_unwrap.ts` — EXISTING — analog for a prepare tool that emits a special block (`LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` at `signing/blocks.ts:389-400`)
- `src/tools/get_token_metadata.ts` — EXISTING — analog for a read-only viem-call tool with `getChainClient(chainId).readContract(...)`
- `src/tools/check_contract_security.ts` — EXISTING — direct consumer of `etherscan.ts`; the v1.2 FROZEN runtime refusal at lines 105-122 lifts as Phase 35-01 free downstream effect
- `src/signing/payload-fingerprint.ts` — FROZEN. Lines 36-49 are the load-bearing `computePayloadFingerprint` used unchanged for Fixture P
- `src/signing/handle-store.ts` — EXISTING — lines 312-323 (`PreparedTxEvm`), 948-966 (`HandleRecord`) — extend `HandleRecord` with two optional fields (`acknowledgeNonProtocolTarget?: true` + `preparedBy?: string`)
- `src/signing/error-codes.ts` — EXISTING SOT for ErrorCode union; APPEND `NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED` + `NON_VIEW_FUNCTION` + `ABI_NOT_AVAILABLE`
- `test/signing-fingerprint.test.ts` — EXISTING — append Fixture P pattern (verified pattern from Fixtures A/B/D/E/F/G/H/V/W/X/Y/Z/AA/UNI-A/CRV-A)
- `.planning/phases/35-evm-escape-hatch-custom-call-abi-read/35-CONTEXT.md` — locks all design decisions

### Secondary (MEDIUM confidence)

- [viem.sh — publicClient.call](https://viem.sh/docs/actions/public/call) — confirms `call({ to, data })` is gas-free, returns raw hex bytes (verified 2026-05-26)
- [Etherscan V2 — Contracts endpoint](https://docs.etherscan.io/etherscan-v2/api-endpoints/contracts) — `module=contract&action=getabi` exists; response shape `status: "1"/"0"`
- [Etherscan V2 — Common Error Messages](https://docs.etherscan.io/etherscan-v2/support/common-error-messages) — "Contract source code not verified" is the canonical not-verified sentinel
- [paradigmxyz/reth issue #17140](https://github.com/paradigmxyz/reth/issues/17140) — confirms Etherscan V2 rate limit is per-API-key, not per-chain

### Tertiary (LOW confidence)

- General awareness of Etherscan rate-limit response shape — verified via search but not against live API in this research session

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies are in tree and well-understood
- Architecture: HIGH — Phase 35 composes over existing patterns (`etherscan.ts` mirror, `prepare_native_send.ts` clone, `signing/blocks.ts` APPEND-ONLY, `_canonicalDispatch` indirection)
- Pitfalls: HIGH — surfaced 7 specific pitfalls, each tied to a concrete file:line in the codebase or to a CONTEXT-locked rule
- Etherscan V2 ABI endpoint behavior: MEDIUM — researcher confirmed via docs + GitHub issues; happy-path test at execute time provides final verification
- Selector → canonical-alternative collision risk: MEDIUM — needs write-time audit (Open Question 2)

**Research date:** 2026-05-26
**Valid until:** 2026-06-25 (30-day estimate; stack is stable; only risk is Etherscan V2 API drift)
