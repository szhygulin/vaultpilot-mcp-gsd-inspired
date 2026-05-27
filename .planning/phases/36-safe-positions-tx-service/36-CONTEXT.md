# Phase 36: Safe positions + Tx Service API integration + `get_safe_positions` — Context

**Gathered:** 2026-05-27
**Status:** Decisions locked (auto-mode) — ready for `/gsd-plan-phase 36`

<domain>
## Phase Boundary

Two read-only tools + the v2.5 Safe trust-pipeline foundation:

1. `get_safe_positions({ wallet, chain? })` — lists Safes where `wallet` is an owner. Per-Safe surfaces address + owners[] + threshold + nonce + pendingTransactions[] (compact form) + enabledModules[] + Safe version. Multi-chain fan-out across configured EVM chains by default (Ethereum + Arbitrum + Polygon + Base + Optimism); explicit `chain` narrows.
2. `get_safe_transaction({ chain, safeAddress, safeTxHash })` — full SafeTx detail (to + value + data + operation + collected signatures + required threshold + execution-ready boolean).

Two foundation pieces wired in:

3. `src/clients/safe-tx-service.ts` — per-chain Safe Tx Service HTTP client mirroring `etherscan.ts` shape (5-arm discriminated union, lazy `SAFE_TX_SERVICE_API_KEY` env probe, never-throws). No API key required by Safe Tx Service at this phase (public endpoints), but the slot exists so v3.x can flip to authenticated tier without a schema change.
4. `src/security/canonical-dispatch.ts` Safe arm — Singleton-address allowlist per chain. Phase 37 propose/approve/execute and Phase 38 hard-trigger checks reuse this arm; the on-chain dispatch target for every Safe operation is the Singleton (`execTransaction` lives there).

**Out of scope at Phase 36 (deferred):** SafeTx hash computation (Phase 37), typed-data signing flow (Phase 37), signature submission to Tx Service (Phase 37), `enableModule` / `delegateCall` hard-trigger (Phase 38), Safe creation via ProxyFactory (v3.x), LP-USD-style aggregate Safe portfolio value (v3.x portfolio enhancement).

</domain>

<decisions>
## Implementation Decisions

### Multi-chain default scope
- `get_safe_positions({ wallet, chain? })`: `chain` is **OPTIONAL**. Omitted → fan out across `configuredChains` (mirrors Phase 8 `get_portfolio_summary` fan-out via `Promise.allSettled` + per-chain `AbortController` 10s timeout).
- `chain` provided → narrow to that single chain. Schema rejects chains where the Safe Tx Service has no endpoint (see `unsupported-chain` arm below).
- Per-chain failures surface in a `degradedChains: ChainId[]` field with a sibling `degradedReasons` map (`{ [chainId]: "rate-limited" | "error" | "timeout" }`). Partial results never throw — the user still sees Safes from healthy chains.
- `get_safe_transaction({ chain, ... })`: `chain` is **REQUIRED** (no fan-out — a `safeTxHash` is chain-scoped, asking for it without a chain is undefined).

### Safe Tx Service per-chain endpoint registry
- Hardcoded per-chain table in `src/clients/safe-tx-service.ts` (no env-override at this phase — matches `RPC_URL_BY_CHAIN` discipline; v3.x may add env-override if private Safe Tx Service deployments emerge).
- Endpoints (verified via safe-global.com docs at planning time):
  - Ethereum (1) → `https://safe-transaction-mainnet.safe.global`
  - Arbitrum (42161) → `https://safe-transaction-arbitrum.safe.global`
  - Polygon (137) → `https://safe-transaction-polygon.safe.global`
  - Base (8453) → `https://safe-transaction-base.safe.global`
  - Optimism (10) → `https://safe-transaction-optimism.safe.global`
- API base path: `/api/v1` (Safe Transaction Service REST API). Researcher confirms exact v1 vs v2 paths during plan-phase and may correct.
- Per-chain client returns the 5-arm union below; the unsupported-chain arm short-circuits before any network call.

### Safe Tx Service client — 5-arm discriminated union
- Mirrors `src/clients/etherscan.ts` shape (Phase 7 Plan 07-04 precedent + Phase 35 Plan 35-01 `EtherscanAbiResult` analog):
  - `ok { status: "ok", data: <typed payload> }`
  - `not-found { status: "not-found" }` — Safe / SafeTx hash not registered in Tx Service
  - `rate-limited { status: "rate-limited", retryAfterMs?: number }` — 429 from Safe Tx Service (per-IP throttling exists even without API key)
  - `error { status: "error", reason: string }` — network / 5xx / malformed JSON
  - `unsupported-chain { status: "unsupported-chain", chainId: ChainId }` — chain not in the per-chain endpoint table
- Per-session call counter (mirror of `agentSessionCallCount` in `etherscan.ts`); soft ceiling at 30 calls/session (rough budget — researcher tunes). Exceeded → `error { reason: "session-call-ceiling" }`.
- Never throws — all error paths surface as discriminated-union arms (CLAUDE.md never-throws client invariant).
- `fetch`-based; test seam at `vi.stubGlobal("fetch", …)` boundary per CLAUDE.md "external network clients" convention. No ESM internal-indirection needed.
- Cache: per-`(chainId, safeAddress)` Safe-info LRU (max ~32 entries) + per-`(chainId, safeTxHash)` SafeTx LRU (max ~64 entries). Both reset on MCP server restart.

### Safe Singleton + ProxyFactory address SOT
- `src/config/contracts.ts` — new `SafeContracts` sub-table per chain id, matching the `AaveV3Contracts` (Phase 7) / `UniswapV3Contracts` (Phase 32) / `CurvePools` (Phase 34) curated-registry pattern.
- Per-chain fields: `singleton: Address`, `proxyFactory: Address`, `multiSend: Address`, `multiSendCallOnly: Address`, `signMessageLib: Address`, `compatibilityFallbackHandler: Address`.
- Source: Safe's `safe-deployments` package canonical-deployment JSON; researcher pins the exact versions (Safe v1.3.0 and v1.4.1 — both still in active use; agent must handle either when reading a user's Safe).
- The `singleton` field is the canonical-dispatch target. `multiSend` + `multiSendCallOnly` are NOT direct dispatch targets at Phase 36 (Phase 37 `prepare_safe_tx_propose` may route through `multiSend` for batched ops — out of scope here).
- Most chains share deterministic Singleton addresses across deployments; per-chain table is defensive against alternates and lets Phase 37/38 wire trust-pipeline gates per-chain without re-keying.

### Canonical-dispatch Safe arm
- New `SAFE_SINGLETON_DISPATCH_ALLOWLIST` per-chain table in `src/security/canonical-dispatch.ts`, sibling to existing protocol arms (Aave / Uniswap V3 / Compound / Lido / Curve / etc.).
- Allowlist entries: every `singleton` address from `SafeContracts` per chain (5 entries × 2 Safe versions = up to 10 rows; researcher confirms whether both v1.3.0 and v1.4.1 singletons are simultaneously live on a given chain).
- Phase 36 wires the allowlist only — no Safe `prepare_*` tools exist yet, so no live dispatch consumer until Phase 37 lands. The wiring is load-bearing for the v2.5 trust-pipeline foundation.
- Layer 0.5 dispatch-allowlist gate (`preview_send.ts` site) sees the Safe Singleton as a known target the instant Phase 37 produces a handle pointing at it.

### Safe-finding strategy (Tx Service + on-chain cross-check)
- `get_safe_positions` enumeration: query `GET /api/v1/owners/{address}/safes/` to list Safe addresses where the wallet is an owner. Returns `{ safes: Address[] }`.
- **Mandatory on-chain cross-check** (load-bearing for trust pipeline): for every Safe returned by Tx Service, the server reads `getOwners()` + `getThreshold()` + `nonce()` + `getModulesPaginated(SENTINEL_MODULE, 100)` + `VERSION()` on-chain via multicall against the Safe Singleton ABI. Per-Safe output uses the on-chain values, not the Tx Service values.
- Mismatch detection: if Tx Service's reported owners/threshold/version disagrees with on-chain, set `txServiceDrift: true` on the per-Safe entry + surface `driftReasons: string[]` naming which fields disagreed. Defends against compromised or stale Tx Service responses.
- Wallet-not-owner sanity check: if on-chain `getOwners()` does NOT include the requested wallet, the Safe is silently dropped from the output (Tx Service may have stale ownership records after recent `removeOwner` calls).
- ENS / human-readable owner labels: out of scope at Phase 36 (use `resolve_token` precedent for v3.x portfolio enhancement). Raw addresses only.

### Pending-transactions surface depth (compact vs full)
- `get_safe_positions` per-Safe `pendingTransactions[]` is **COMPACT** — only `safeTxHash + nonce + collectedSignatures + requiredSignatures + isExecutable`. NO `to/value/data` payload, NO decoded operation.
- Full decoded operation surfaces only via the explicit `get_safe_transaction({ chain, safeAddress, safeTxHash })` call. Keeps `get_safe_positions` payload bounded for wallets that own many Safes with many pending txs.
- Per-Safe `pendingTransactions[]` length capped at the 20 lowest-nonce pending (Safe Tx Service paginated query). Larger queues are surfaced as `pendingTransactionsTruncated: true` + `pendingTransactionsTotalCount: number`.

### Module list surface depth
- `enabledModules[]` per Safe = on-chain address list from `getModulesPaginated(SENTINEL, 100)` (Sentinel-linked-list pagination — Safe's standard module enumeration).
- Phase 36 surfaces addresses only. NO `check_contract_security` integration (deferred to Phase 38 hard-trigger flow per ROADMAP — Phase 38 owns the Inv #12.5 second-LLM check on `enableModule` writes).
- Empty `enabledModules: []` is the safe case and surfaces literally. Non-empty list is informational at this phase (agent can decide to flag modules to the user, but no MCP-side warning block emits — that's Phase 38's job).
- Module sentinel address (`0x0...001`) filtered out of the returned list.

### `get_safe_transaction` shape
- Returns the full Safe Tx Service tx record: `to + value + data + operation (0=Call, 1=DelegateCall) + safeTxGas + baseGas + gasPrice + gasToken + refundReceiver + nonce + safeTxHash + confirmations[] (per-signer address + signature bytes) + requiredConfirmations + isExecutable`.
- Operation discriminator surfaced as a named field: `operation: "call" | "delegatecall"` (NOT raw 0/1) for agent-routing clarity. Phase 38's hard-trigger detection cares about `delegatecall`.
- `confirmations[]` returned as-is from Tx Service (Phase 37 signature submission flows write into this surface; Phase 36 only reads).
- Best-effort `decodedOperation` via existing `4byte.ts` + `etherscan.ts` ABI cache when calldata is non-empty (mirrors Phase 35's best-effort decode approach). Cache HIT → `decodedFunctionName(args...)` string. Cache MISS → `null` (no blocking probe — keep `get_safe_transaction` snappy).

### Safe ABI sourcing
- `src/chains/safe.ts` — new per-chain Safe state reader module. Imports Safe Singleton ABI from `viem.parseAbi` literal (precedent: `src/chains/aave-v3.ts` parseAbi struct refs from Phase 7).
- Minimal ABI surface for Phase 36 reads only: `getOwners() / getThreshold() / nonce() / VERSION() / getModulesPaginated(address,uint256)`. Phase 37 + 38 extend with `execTransaction` + `domainSeparator` + `getTransactionHash`.
- No on-chain pending-tx enumeration (Safe pending txs are off-chain in Tx Service until executed — no on-chain `getPendingTransactions()` view exists).

### Plan structure (2 plans, sequential)
- **Plan 36-01:** `src/clients/safe-tx-service.ts` 5-arm union client + per-chain endpoint table + per-session call counter + cache + `src/config/contracts.ts` `SafeContracts` per-chain table + `src/security/canonical-dispatch.ts` `SAFE_SINGLETON_DISPATCH_ALLOWLIST` arm wiring + foundation tests (client mock-fetch happy / not-found / rate-limited / error / unsupported-chain; canonical-dispatch contains-singleton property test per chain).
- **Plan 36-02:** `src/chains/safe.ts` minimal Safe-Singleton ABI reader + `get_safe_positions` (Tx Service `/owners/{address}/safes` query + on-chain cross-check via multicall + drift detection + compact pending-tx surface + module list) + `get_safe_transaction` (Tx Service tx detail fetch + best-effort decode) + integration tests (real Safe address fixtures from mainnet — read-only, no signing).

### Tests anchor (Safe trust-pipeline foundation regression)
- `test/clients-safe-tx-service.test.ts` — `fetch`-stubbed happy / 404 / 429 / 500 / unsupported-chain / cache-hit / call-ceiling. Mirror of `test/clients-etherscan.test.ts`.
- `test/security-canonical-dispatch-safe.test.ts` — every `SafeContracts[chain].singleton` is contained in `SAFE_SINGLETON_DISPATCH_ALLOWLIST[chain]`. Property test (loop over `configuredChains`).
- `test/integration/safe-positions.test.ts` — read-only end-to-end with `fetch`-stubbed Tx Service + `viem` public-client stubbed multicall. Fixtures: 1-of-1 Safe (single owner, no pending txs, no modules), 2-of-3 Safe (3 owners, threshold 2, 1 pending tx, 1 enabled module), Tx-Service-drift Safe (Tx Service reports threshold 1, on-chain threshold 2 → `txServiceDrift: true`).
- `test/integration/safe-get-transaction.test.ts` — `get_safe_transaction` with call op + delegatecall op + decoded calldata (cached ABI) + undecoded calldata (cache miss). Validates `operation: "call" | "delegatecall"` shape.

### NO cryptographic-binding fixture at Phase 36
- Phase 36 is read-only. NO `payloadFingerprint` / `presignHash` surface added. The canonical fixture set (A/B/C/D/E/F/G/H/CRV-A/B/C/UNI-A/B/C/LP-A/B/C/COMP-A/B/Lido-A/B/C/D/EL-A/B/RP-A/B/CompV3-A/B/P/etc.) remains unchanged.
- Phase 37 introduces Fixture SAFE-A (EIP-712 typed-data digest for SafeTx hash) as the first cryptographic-binding fixture in the v2.5 trust pipeline.

### Claude's Discretion
- Internal helper names (`SafeTxServiceClient`, `SafeStateReader`, `crossCheckSafe`, `decodeSafeTxOperation`) — at executor's call.
- Exact LRU sizes (~32 / ~64); per-session call ceiling (~30) — researcher / executor may tune.
- Whether `get_safe_positions` surfaces a top-level `txServiceConfigured: boolean` (analogous to `etherscanApiKeyPresent` in `get_vaultpilot_config_status`) — Claude's discretion at execute time; the Tx Service requires no key, so the field's load-bearing-ness is marginal.
- Exact field ordering in the per-Safe output (TS interface property order is cosmetic; downstream consumers key by name).
- Whether the canonical-dispatch Safe arm uses a flat `Set<Address>` per chain or an `Address[]`-with-set-membership-helper (matches the existing arm shapes in `canonical-dispatch.ts` — executor mirrors whichever convention is currently dominant).

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — conventions: `src/config/contracts.ts` SOT, never-throws external clients, `fetch`-stub test seam, ESM spy-affordance indirection NOT needed for network clients
- `.planning/PROJECT.md` — project context + trust-pipeline invariants
- `.planning/REQUIREMENTS.md` §SAFE-01..04 — exact Phase 36 surface
- `.planning/ROADMAP.md` Phase 36 entry — goal + 4 success criteria + plan-count estimate
- `.planning/phases/35-evm-escape-hatch-custom-call-abi-read/35-CONTEXT.md` — Plan 35-01 Etherscan client multi-chain widening precedent (5-arm union pattern, per-session call counter, cache layer)
- `.planning/phases/07-aave-v3-ethereum/07-CONTEXT.md` — `src/clients/etherscan.ts` foundational shape (Plan 07-04); `src/chains/aave-v3.ts` parseAbi struct-ref convention
- `.planning/phases/09-hardening-skill-verification-tools-dispatch-allowlist/09-04-PLAN.md` — `CANONICAL_DISPATCH_TARGETS` per-chain table wiring pattern
- `src/config/contracts.ts` — canonical contract-address SOT (extend with `SafeContracts`)
- `src/clients/etherscan.ts` — closest never-throws + 5-arm union analog for `safe-tx-service.ts`
- `src/security/canonical-dispatch.ts` — Layer 0.5 dispatch-allowlist gate (add Safe Singleton arm)
- `src/chains/aave-v3.ts` — closest per-chain ABI-reader-module analog for `src/chains/safe.ts` (parseAbi struct refs)
- `src/tools/get_lending_positions.ts` — closest read-only-positions analog for `get_safe_positions` (multicall + zero-filter + per-position shape)
- Safe Transaction Service API docs — https://docs.safe.global/core-api/transaction-service-overview
- Safe canonical deployments — https://github.com/safe-global/safe-deployments (v1.3.0 + v1.4.1 Singleton + ProxyFactory + MultiSend addresses per chain)
- Safe Smart Account contracts — https://github.com/safe-global/safe-smart-account (ABI surface)

</canonical_refs>

<specifics>
## Specific Ideas

- The Safe trust-pipeline foundation is the load-bearing concept at Phase 36. The on-chain cross-check (owners + threshold + nonce + version + modules read via multicall against the Singleton ABI) is what makes the v2.5 milestone defensible — the user trusts what the Ledger screen shows in Phase 37+ ONLY because the read surface in Phase 36 has already proven on-chain truth independent of Tx Service.
- `txServiceDrift: true` flag per Safe is the cheap observable for a compromised / stale Tx Service. Surfaces as agent-readable signal; no MCP-side refusal (read is best-effort by definition).
- Safe v1.3.0 vs v1.4.1 dispatch matters at Phase 37 (different EIP-712 domain separators). Phase 36 captures `version` per Safe so Phase 37 can route correctly; Phase 36 itself is version-agnostic for read operations.
- The `MultiSendCallOnly` contract (singleton-deployed) is the safe variant of `MultiSend` — it refuses `delegatecall` operations in the batched payload. Phase 36 lists it in `SafeContracts` per chain but does NOT canonical-dispatch-allowlist it; Phase 37 decides whether `prepare_safe_tx_propose` routes batched ops through it.
- Pagination via Sentinel-linked-list for `getModulesPaginated` is a Safe convention — the function returns `(modules[], next)` where `next == SENTINEL` signals end. Phase 36's reader follows the linked-list once with a hard cap (100 modules) to bound the loop; >100-module Safes are extreme outliers.
- Safe Tx Service supports `?nonce__gte={current}` query to limit pending-tx results to non-executed (lowest-nonce) entries. Use this to bound the compact `pendingTransactions[]` surface naturally.
- The `EXECUTED` arm of the SafeTx state machine is filtered server-side (don't surface executed transactions in `pendingTransactions[]` — they're noise). Tx Service exposes `?executed=false` query for this.
- Safe Tx Service paginates with `?limit=20&offset=0` — researcher confirms current pagination defaults at plan-phase.
- Some Safes are 1-of-1 (single owner, single-signer flow). The phase MUST handle 1-of-1 Safes correctly because they're the most common personal-use case. The 1-of-1 fixture in `test/integration/safe-positions.test.ts` anchors this.

</specifics>

<deferred>
## Deferred Ideas

- **SafeTx hash computation** (`src/signing/safe-tx-hash.ts` EIP-712 typed-data digest) — Phase 37.
- **Typed-data signing flow** via Ledger ETH app — Phase 37 (depends on Ledger ETH app clear-sign-typed-data coverage; accepted-residual otherwise).
- **`prepare_safe_tx_propose / _approve / _execute`** — Phase 37.
- **`submit_safe_tx_signature`** — Phase 37 (off-chain Tx Service signature submission).
- **`enableModule` + `delegateCall: true` hard-trigger second-LLM check** (Inv #12.5) — Phase 38.
- **Safe creation via ProxyFactory** — out of scope for v2.5; users create Safes via the Safe UI.
- **ENS-resolved owner labels** in `get_safe_positions` output — v3.x portfolio enhancement.
- **LP-style aggregate Safe portfolio value** (USD value of Safe-held assets across chains) — v3.x portfolio enhancement.
- **Private Safe Tx Service deployments** (`SAFE_TX_SERVICE_URL` env override) — v3.x if private deployments emerge.
- **Safe v1.1.x and older versions** — explicitly NOT supported. v1.3.0 and v1.4.1 are the live versions in active use; older versions surface as `txServiceDrift: true` with `driftReasons: ["unsupported-version"]` and a `version` field that doesn't match the supported set.
- **`check_contract_security` integration on module addresses** — Phase 38 hard-trigger detection owns this.
- **Persistent (cross-session) Safe-info cache** — defer; per-session in-memory LRU suffices.

</deferred>

---

*Phase: 36-safe-positions-tx-service*
*Decisions captured (auto-mode): 2026-05-27*
</content>
</invoke>