# Phase 37: Safe three-step signing flow — `prepare_safe_tx_propose` + `_approve` + `_execute` + `submit_safe_tx_signature` — Context

**Gathered:** 2026-05-27
**Status:** Decisions locked (auto-mode) — ready for `/gsd-plan-phase 37`

<domain>
## Phase Boundary

Three distinct named tools that surface the Safe multisig signing lifecycle to the agent, plus a Tx Service signature-submission tool. Each step is gated by the prior step's artifacts; the agent routes by intent and cannot accidentally skip steps.

1. `prepare_safe_tx_propose({ chain, safeAddress, to, value, data, operation })` — off-chain. Builds the SafeTx hash (EIP-712 typed-data digest per Safe v1.3.0 / v1.4.1 domain) + the full typed-data structure for Ledger display. Returns a `PreparedTxSafeTypedData` handle. User signs typed-data via Ledger ETH app over WalletConnect; signature returned to agent.
2. `prepare_safe_tx_approve({ chain, safeAddress, safeTxHash })` — off-chain. Fetches the pending SafeTx from Phase 36's Tx Service client, surfaces decoded operation in CHECKS PERFORMED, builds the same EIP-712 typed-data structure (chain/safe-derived domain) for the user to sign. Returns a `PreparedTxSafeTypedData` handle.
3. `submit_safe_tx_signature({ chain, safeAddress, safeTxHash, signature, userDecision })` — off-chain Tx Service API call. ECDSA-recovers the signature against the SafeTx hash, verifies the recovered signer is a paired WC wallet, posts the signature to Tx Service via `postSignature` (new client method extending Phase 36's `safe-tx-service.ts`). Transitions the propose/approve handle (if present in store by `(chain, safeAddress, safeTxHash)`) to `"sent"`.
4. `prepare_safe_tx_execute({ chain, safeAddress, safeTxHash })` — **on-chain**. Builds the standard `PreparedTxEvm` calling `execTransaction(...)` on the Safe Singleton with signatures assembled from Tx Service state (sorted by signer address per Safe convention). Flows through the existing `preview_send` + `send_transaction` pipeline.

**Out of scope at Phase 37 (deferred):** `enableModule` + `delegateCall: true` hard-trigger second-LLM check (Phase 38 owns Inv #12.5). Safe owner-management (`addOwner` / `removeOwner` / `changeThreshold`) — v2.5.x. Batched Safe ops via `MultiSend` / `MultiSendCallOnly` — v2.5.x. Safe creation via `ProxyFactory` — v3.x.

</domain>

<decisions>
## Implementation Decisions

### Two `prepare_*` shapes — typed-data vs on-chain
- `prepare_safe_tx_propose` and `prepare_safe_tx_approve` produce a **typed-data signature** — no on-chain tx, no broadcast, no nonce, no gas. They cannot share `PreparedTxEvm`'s shape (which assumes tx broadcast). NEW discriminant: `PreparedTxSafeTypedData` (added to `src/signing/handle-store.ts` `PreparedTx` union; sibling to EVM/Solana/TRON/BTC/LTC/BTC-LIFI variants).
- `prepare_safe_tx_execute` IS a real on-chain transaction (`execTransaction` calldata to the Safe Singleton). Reuses `PreparedTxEvm` + the existing `preview_send` + `send_transaction` pipeline unchanged.
- Handle-discriminant routing enforces correctness: `send_transaction(handle)` STRUCTURED-REFUSAL if handle resolves to `PreparedTxSafeTypedData`; `submit_safe_tx_signature` STRUCTURED-REFUSAL if the looked-up handle is `PreparedTxEvm`. Mis-routing impossible by type.

### `PreparedTxSafeTypedData` shape
- Fields: `kind: "safe-typed-data"`, `chain: ChainId`, `safeAddress: Address`, `safeVersion: "1.3.0" | "1.4.1"`, `safeTxHash: Hex` (the EIP-712 typed-data digest), `nonce: bigint`, `operation: "call" | "delegatecall"`, `to: Address`, `value: bigint`, `data: Hex`, `payloadFingerprint: Hex`, `typedDataStructure: SafeEIP712TypedData` (full domain + types + message for transparency / agent inspection).
- Reuses existing `payloadFingerprint` re-check discipline at submission time (Layer 1 fingerprint binding extends to typed-data flows).
- Handle TTL same as EVM (15 minutes).

### `payloadFingerprint` domain tag for SafeTx typed-data
- NEW tag: `VaultPilot-safetx-v1:`. Sibling to `VaultPilot-txverify-v1:` (EVM), `VaultPilot-soltx-v1:` (Solana), `VaultPilot-trontx-v1:` (TRON), `VaultPilot-btctx-v1:` (BTC), etc.
- Binding preimage: domain tag || chain (uint64 LE) || safeAddress (20 bytes) || safeVersion (string sentinel: `"v1.3.0"` or `"v1.4.1"`) || safeTxHash (32 bytes) || nonce (uint256 BE) || operation (uint8: 0=call, 1=delegatecall) || to (20 bytes) || value (uint256 BE) || keccak(data) (32 bytes).
- All EVM `prepare_safe_tx_execute` handles reuse the existing `VaultPilot-txverify-v1:` tag — execute IS a normal EVM tx by construction. NO new tag for execute.
- Fixture SAFE-A pins this preimage shape as a hardcoded `0x…` literal in `test/signing-fingerprint.test.ts` per CLAUDE.md convention.

### `src/signing/safe-tx-hash.ts` — EIP-712 typed-data digest computation
- Pure function: `computeSafeTxHash({ chain, safeAddress, safeVersion, to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce })` → `Hex` (the 32-byte EIP-712 digest = the "SafeTx hash").
- Domain shape per Safe v1.3.0 and v1.4.1 (both still in active use; Phase 36 cross-check captures `version` per Safe so Phase 37 routes correctly):
  - v1.3.0 domain: `{ chainId, verifyingContract: safeAddress }` — chainId IS in the domain (per Safe v1.3.0 deployment; researcher confirms via `safe-deployments` package).
  - v1.4.1 domain: `{ chainId, verifyingContract: safeAddress }` — same shape (v1.4.1 maintained chainId discipline).
  - Pre-v1.3.0 Safes: explicitly REFUSED at `prepare_safe_tx_propose` (`UNSUPPORTED_SAFE_VERSION` structured error; matches Phase 36 `txServiceDrift` posture).
- Typed-data `SafeTx` type matches Safe Smart Account spec: `(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce)`.
- Built on `viem.hashTypedData` (canonical implementation; no hand-rolled EIP-712 encoder).
- Regression-tested against fixture SafeTx hashes pulled from real mainnet Safes (researcher captures 2-3 fixtures at plan-phase: one v1.3.0 mainnet Safe, one v1.4.1 mainnet Safe, one delegatecall SafeTx).

### Cryptographic-binding fixtures — Fixture SAFE-A + SAFE-B + SAFE-C
- **Fixture SAFE-A** (EIP-712 typed-data digest for a v1.3.0 SafeTx, call operation): hardcoded `0x…` literal in `test/signing-presign-hash.test.ts` (new test file: `test/signing-safe-tx-hash.test.ts`). Cross-linked from `test/prepare-safe-tx-propose.test.ts`.
- **Fixture SAFE-B** (EIP-712 typed-data digest for a v1.4.1 SafeTx, call operation): hardcoded `0x…` literal — same file.
- **Fixture SAFE-C** (EIP-712 typed-data digest for a v1.3.0 SafeTx, **delegatecall** operation): hardcoded `0x…` literal — same file. Anchors the delegatecall-discriminant path (used by Phase 38 hard-trigger detection).
- **Fixture SAFE-D** (payloadFingerprint binding over SAFE-A): hardcoded `0x…` literal in `test/signing-fingerprint.test.ts` — anchors the `VaultPilot-safetx-v1:` preimage assembly. Cross-linked from `test/prepare-safe-tx-propose.test.ts` and `test/submit-safe-tx-signature.test.ts`.
- All fixtures captured from real mainnet Safes (or computed via canonical Safe SDK + cross-checked against on-chain `getTransactionHash` if researcher pulls a real example) — NO `beforeAll`-snapshot per CLAUDE.md convention.

### WalletConnect namespace — add `eth_signTypedData_v4`
- `src/wallet/session-manager.ts` proposal builder currently lists `methods: ["eth_sendTransaction", "personal_sign"]`. Phase 37 extends to `["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"]`.
- Existing paired sessions (pre-Phase 37) lack `eth_signTypedData_v4` in their namespace. At first Safe-typed-data call against a session without the method, the WC SDK returns a method-not-supported error. The MCP surfaces this as a structured refusal: `INVALID_INPUT + hint = "Re-pair Ledger Live: pair_ledger_live({ force: true }) to enable Safe typed-data signing."`
- New pairings post-Phase 37 register `eth_signTypedData_v4` automatically; no re-pair needed for fresh users.

### Typed-data signing transport — Ledger ETH app via WC
- Agent receives the typed-data structure (`typedDataStructure: SafeEIP712TypedData`) from `prepare_safe_tx_propose` / `_approve`. Agent invokes `eth_signTypedData_v4` via `signClient.request<Hex>({ topic, chainId, request: { method: "eth_signTypedData_v4", params: [walletAddress, JSON.stringify(typedData)] } })` (mirror of the existing `eth_sendTransaction` request pattern in `src/tools/send_transaction.ts`).
- Ledger ETH app displays:
  - **Clear-sign mode** (if CAL/EIP-712 filter file present for this Safe): field-by-field SafeTx display ("To: 0x…", "Value: 1.5 ETH", "Data: …") + the 32-byte EIP-712 digest at the end.
  - **Blind-sign mode** (CAL coverage missing): the 32-byte digest ONLY ("Sign Hash: 0x…"). Documented as accepted residual risk in SECURITY.md — Phase 37 surfaces the `LEDGER BLIND-SIGN HASH` block matching the safeTxHash so the user can visually confirm digest match on-device.
- Phase 37 does NOT attempt to detect CAL coverage server-side (no public API; coverage varies per Safe contract + Ledger firmware version). The `LEDGER DISPLAY` block in `prepare_safe_tx_propose` response surfaces BOTH possible displays so the agent can relay both to the user.

### `submit_safe_tx_signature` — signer-recovery + Tx Service POST
- Input: `{ chain, safeAddress, safeTxHash, signature, userDecision }` — matches ROADMAP success criteria #3.
- `userDecision: "send"` schema-level required (mirrors `send_transaction` gate; even though no on-chain tx, the user explicitly chose to publish their signature).
- **ECDSA-recover BEFORE posting**: server recovers the signer address from `signature` over `safeTxHash` (via `viem.recoverAddress`). Refuses if the recovered signer:
  - Is NOT a currently-paired WC wallet address (`INVALID_INPUT + hint = "Signature recovered to {addr}; not a paired Ledger. Re-sign via the correct wallet."`).
  - Is NOT an owner of the Safe (cross-check against on-chain `getOwners()` — Phase 36's `src/chains/safe.ts` already exposes this).
- Handle-store lookup by `(chain, safeAddress, safeTxHash)` — if a `PreparedTxSafeTypedData` handle exists, verify `payloadFingerprint` matches the re-computed fingerprint over current args, then transition the handle to `"sent"`. If no handle exists (e.g. agent restarted between prepare and submit), proceed with the signer-recovery + on-chain owner check only; surface `handleNotFound: true` in the response (informational).
- Posts to Tx Service via NEW client method `postSignature({ chain, safeAddress, safeTxHash, signature })` extending `src/clients/safe-tx-service.ts` — POST to `/api/v1/multisig-transactions/{safeTxHash}/confirmations/` per Tx Service REST API.
- 5-arm union return mirror of Phase 36 client shape: `ok / not-found / rate-limited / error / unsupported-chain`. Never throws.

### `prepare_safe_tx_execute` — signature assembly + Singleton dispatch
- Input: `{ chain, safeAddress, safeTxHash }` — fetches the pending SafeTx (via Phase 36's `getMultisigTransaction`) + all collected signatures (`confirmations[]`).
- **Refuses early** if `confirmations.length < threshold` (`INSUFFICIENT_SIGNATURES + hint = "Need {N} more signatures. Use prepare_safe_tx_approve to collect more."`). On-chain `execTransaction` would revert anyway — refuse client-side for clarity.
- **Signature assembly**: sort `confirmations[]` by signer address ascending (Safe contract requires this — `checkSignatures` iterates signatures by ascending owner order). Concatenate signature bytes (65 bytes per ECDSA sig, mode-aware: `v == 0` for contract signatures, `v == 1` for pre-approved, `v >= 27` for ECDSA — Phase 37 surfaces only ECDSA mode; EIP-1271 contract signatures deferred to v3.x).
- Builds `execTransaction` calldata: `execTransaction(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures)` — all fields read from the Tx Service SafeTx record (same fields that went into the SafeTx hash + the assembled signatures).
- Returns standard `PreparedTxEvm` handle. Composite-tx preview shape (Phase 33 precedent — `prepare_uniswap_v3_rebalance`): the `decodedAction` block surfaces the encapsulated `to/value/data/operation` so the user sees what the Safe will execute (not just "execTransaction(…)").
- `payloadFingerprint` uses the existing `VaultPilot-txverify-v1:` tag (execTransaction is a normal EVM tx).
- Canonical-dispatch allowlist: target = Safe Singleton (already wired in Phase 36's `SAFE_SINGLETON_DISPATCH_ALLOWLIST`). Layer 0.5 gate passes by construction.

### Three-step flow naming + agent-routing discipline
- Tool descriptions explicitly name the lifecycle stage:
  - `prepare_safe_tx_propose` — "Use FIRST when initiating a Safe multisig transaction. Off-chain typed-data sign. Returns a handle the user signs via Ledger; agent then calls `submit_safe_tx_signature` to publish the signature."
  - `prepare_safe_tx_approve` — "Use when ANOTHER owner proposed a Safe tx and the user wants to co-sign. Off-chain typed-data sign. Routes signature via `submit_safe_tx_signature`."
  - `submit_safe_tx_signature` — "Posts a typed-data signature (from `prepare_safe_tx_propose` or `_approve`) to the Safe Tx Service. Not an on-chain tx — does NOT route through `send_transaction`."
  - `prepare_safe_tx_execute` — "Use AFTER enough signatures collected. Builds the on-chain `execTransaction` call. Routes through `send_transaction` like a normal EVM tx."
- Each description is precise about WHEN to use vs NOT — per CLAUDE.md "Tool descriptions are agent routing prompts" convention.

### CHECKS PERFORMED block — Safe-specific surfaces
- `prepare_safe_tx_propose` CHECKS PERFORMED:
  - Safe version detected (v1.3.0 / v1.4.1) + EIP-712 domain hash verified against on-chain `domainSeparator()` (extends Phase 36's `src/chains/safe.ts` minimal ABI surface with `domainSeparator()`).
  - On-chain `getOwners()` includes the requesting wallet → ownership confirmed.
  - On-chain `nonce()` matches the proposed nonce → no nonce collision.
  - Calldata best-effort decode via 4byte.ts + etherscan.ts (already in `get_safe_transaction` shape from Phase 36).
- `prepare_safe_tx_approve` CHECKS PERFORMED:
  - SafeTx fetched from Tx Service; on-chain `domainSeparator()` re-verifies EIP-712 domain.
  - Decoded operation surfaced (`call` / `delegatecall` discriminant) — flags delegatecall as "Phase 38 will hard-trigger second-LLM check here" (informational at Phase 37; the actual hard-trigger lands Phase 38).
  - Wallet is a Safe owner AND has not already signed this SafeTx (cross-check `confirmations[]` from Tx Service — duplicate sign warning).
- `prepare_safe_tx_execute` CHECKS PERFORMED:
  - Signature count ≥ threshold.
  - All signatures recovered to current owners (defends against stale signatures after `removeOwner`).
  - Composite-tx preview of the encapsulated operation (encapsulated to/value/data/operation decoded if calldata recognized).
  - On-chain `nonce()` still matches (defends against another execTransaction landing between approve + execute).

### Plan structure (3 plans matching ROADMAP)
- **Plan 37-01** — `src/signing/safe-tx-hash.ts` (EIP-712 typed-data digest computation for SafeTx v1.3.0 + v1.4.1) + `PreparedTxSafeTypedData` discriminant added to `src/signing/handle-store.ts` + `VaultPilot-safetx-v1:` domain tag added to `src/signing/payload-fingerprint.ts` (new function `computeSafeTxPayloadFingerprint`) + `prepare_safe_tx_propose` tool + WC session-manager `eth_signTypedData_v4` namespace extension + Fixtures SAFE-A / SAFE-B / SAFE-C / SAFE-D.
- **Plan 37-02** — `prepare_safe_tx_approve` tool (reuses Phase 37-01 typed-data plumbing + safe-tx-hash module; depends on 37-01) + `submit_safe_tx_signature` tool + `postSignature` method extending `src/clients/safe-tx-service.ts` + ECDSA-recover + on-chain owner cross-check + handle-store transition.
- **Plan 37-03** — `prepare_safe_tx_execute` tool (signature assembly + sorting + `execTransaction` calldata builder + composite-tx preview shape via Phase 33 pattern) + full three-step integration test (`test/integration/safe-three-step-flow.test.ts`: propose → submit → approve × N → submit × N → execute, all fetch/multicall-stubbed; depends on 37-01 and 37-02).

### Wave dependency graph
- W1: 37-01 (foundational — safe-tx-hash + handle-store discriminant + propose tool).
- W2: 37-02 (approve + submit_safe_tx_signature — depends on 37-01 for typed-data plumbing).
- W3: 37-03 (execute + integration test — depends on 37-01 for safe-tx-hash regression, and on 37-02 for the propose-approve-execute integration test).
- Sequential waves only — no plan-level parallelism in Phase 37 (each plan depends on artifacts from the prior plan).

### FROZEN-area zero-diff invariant
- `src/signing/send_transaction.ts` UNTOUCHED in Plans 37-01 + 37-02. Plan 37-03 extends `send_transaction` only via the existing `PreparedTxEvm` path (no new branches; execTransaction is a normal EVM tx).
- `src/signing/preview_send.ts` UNTOUCHED in Plans 37-01 + 37-02. Plan 37-03 reuses unchanged.
- Existing canonical fixtures (A/B/C/D/E/F/G/H/CRV-A/B/C/UNI-A/B/C/LP-A/B/C/COMP-A/B/Lido-A/B/C/D/EL-A/B/RP-A/B/CompV3-A/B/P/CUSTOM-A/B etc.) FROZEN. Phase 37 only ADDS SAFE-A/B/C/D — does not modify existing fixtures.
- Acceptance gate Test 18-equivalent: `git diff` of `src/signing/send_transaction.ts` + `src/signing/preview_send.ts` is zero across Plan 37-01 + 37-02 commits.

### Claude's Discretion
- Internal helper names (`SafeTxHashCalculator`, `assembleSafeSignatures`, `recoverSafeSigner`, etc.) — executor's call.
- Whether `prepare_safe_tx_propose` and `_approve` pre-fill `safeTxGas` / `baseGas` / `gasPrice` / `gasToken` / `refundReceiver` defaults (all-zero is the standard for non-relayed Safe txs) — executor's call; default to all-zero per Safe's `execTransaction` convention.
- Exact LRU cache reuse — `postSignature` does not cache (writes don't benefit); pending-tx reads invalidate cache on signature post.
- Whether the `LEDGER DISPLAY` block in `prepare_safe_tx_propose` response is a single block or split (clear-sign expected display + blind-sign fallback display) — executor's call; default to a single block with both subsections.

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — conventions: handle-store discipline, payloadFingerprint domain-tag pattern, cryptographic-binding fixture pinning, FROZEN-area zero-diff invariant, composite-tx preview shape
- `.planning/PROJECT.md` — project context + trust-pipeline invariants
- `.planning/REQUIREMENTS.md` §SAFE-05..08 — exact Phase 37 surface
- `.planning/ROADMAP.md` Phase 37 entry — goal + 6 success criteria + plan-count estimate
- `.planning/phases/36-safe-positions-tx-service/36-CONTEXT.md` — Phase 36 foundation decisions (Tx Service client shape, Safe Singleton SOT, canonical-dispatch Safe arm, on-chain cross-check pattern)
- `.planning/phases/36-safe-positions-tx-service/36-01-PLAN.md` — `src/clients/safe-tx-service.ts` 5-arm union + per-chain endpoint table + cache (Phase 37 extends with `postSignature`)
- `.planning/phases/36-safe-positions-tx-service/36-02-PLAN.md` — `src/chains/safe.ts` minimal ABI reader (Phase 37 extends with `domainSeparator()` + `getTransactionHash` view for cross-verification)
- `.planning/phases/33-uniswap-v3-lp/33-CONTEXT.md` — composite-tx preview shape precedent (`prepare_uniswap_v3_rebalance` encapsulated-op display) for `prepare_safe_tx_execute`
- `.planning/phases/35-evm-escape-hatch-custom-call-abi-read/35-CONTEXT.md` — `prepare_custom_call` shape + `PreparedTxEvm` extension pattern; `getCachedEtherscanAbi` cache-only seam reuse for `get_safe_transaction` decoded ops
- `src/signing/handle-store.ts` — `PreparedTx` discriminated union (extend with `PreparedTxSafeTypedData`)
- `src/signing/payload-fingerprint.ts` — `FINGERPRINT_DOMAIN_TAG` pattern (add `VaultPilot-safetx-v1:`)
- `src/signing/presign-hash.ts` — closest analog for `safe-tx-hash.ts` shape (pure-function digest computation)
- `src/signing/send_transaction.ts` — WC `signClient.request` invocation pattern (mirror for `eth_signTypedData_v4`)
- `src/wallet/session-manager.ts` — WC namespace methods (extend with `eth_signTypedData_v4`)
- `src/clients/safe-tx-service.ts` — Phase 36 client (extend with `postSignature` POST method)
- `src/chains/safe.ts` — Phase 36 minimal ABI reader (extend with `domainSeparator()` + `getTransactionHash`)
- `src/tools/get_safe_positions.ts`, `src/tools/get_safe_transaction.ts` — Phase 36 reads (Phase 37 builds prepare/submit/execute on top)
- `src/security/canonical-dispatch.ts` — `SAFE_SINGLETON_DISPATCH_ALLOWLIST` (Phase 36 wired; Phase 37 `prepare_safe_tx_execute` is the first consumer)
- `test/signing-fingerprint.test.ts` — fixture-pin file for Fixture SAFE-D
- `test/signing-presign-hash.test.ts` — closest analog for new `test/signing-safe-tx-hash.test.ts` (Fixtures SAFE-A / B / C)
- Safe Smart Account contracts — https://github.com/safe-global/safe-smart-account (canonical `execTransaction` + `domainSeparator` + `getTransactionHash` ABI)
- Safe Transaction Service API (signature POST endpoint) — https://docs.safe.global/core-api/transaction-service-overview#confirmations
- Safe EIP-712 domain spec — https://docs.safe.global/safe-core-protocol/safe-account#eip-712-typed-data-signatures
- viem `hashTypedData` reference — https://viem.sh/docs/utilities/hashTypedData

</canonical_refs>

<specifics>
## Specific Ideas

- The three-step flow's existence is itself a defense layer: proposers, approvers, and executors can be different agents/users, each verifying the SafeTx independently. The MCP surfaces decoded args in CHECKS PERFORMED at each step — every step is a fresh attestation, not a transitive trust hop.
- EIP-712 typed-data signing on Ledger ETH app shows the digest verbatim ALWAYS — even in blind-sign mode the user sees the 32-byte hash. The `LEDGER BLIND-SIGN HASH` surface from Phase 35's `prepare_custom_call` precedent transfers cleanly: surface the digest the device WILL display, so the user can visually confirm match.
- `submit_safe_tx_signature` is the only Phase 37 tool that doesn't route through `send_transaction` — no on-chain tx, just an HTTPS POST to Tx Service. But it retains `userDecision: "send"` discipline because the user explicitly chose to publish their signature (a "send" in the abstract sense; the data leaves the MCP boundary).
- Safe v1.3.0 vs v1.4.1 share EIP-712 domain shape (chainId + verifyingContract) — but they have different deployed Singleton addresses + minor ABI differences (mostly internal). Phase 37 cares ONLY about the typed-data digest path; the v1.3.0 / v1.4.1 routing is mechanical (Phase 36 captures `version` per Safe — Phase 37 reads it).
- Pre-v1.3.0 Safes use a DIFFERENT EIP-712 domain (no chainId — exposes cross-chain replay risk). Refused at `prepare_safe_tx_propose` with `UNSUPPORTED_SAFE_VERSION` — matches Phase 36's `txServiceDrift` posture (older Safes are explicitly NOT supported in v2.5).
- The `safeTxGas`, `baseGas`, `gasPrice`, `gasToken`, `refundReceiver` fields in SafeTx are legacy gas-relay fields. Modern Safes (v1.3.0+) typically set all to zero for non-relayed txs. `prepare_safe_tx_propose` defaults these to zero unless the agent explicitly overrides (researcher confirms the schema flexibility — most callers won't touch them).
- `prepare_safe_tx_execute` is the FIRST production consumer of `SAFE_SINGLETON_DISPATCH_ALLOWLIST` (wired in Phase 36 but unconsumed). Layer 0.5 gate validates the Singleton target by construction.
- 1-of-1 Safes (single owner) are a degenerate but valid case: propose → sign → submit → execute (or propose-and-execute in a single flow if optimized). Phase 37 handles 1-of-1 correctly because `threshold == 1` and signature assembly trivially has 1 entry.
- ECDSA signatures over EIP-712 digests: the recovery is `recoverAddress({ hash: safeTxHash, signature })` — viem exposes this directly. The signed digest IS the SafeTx hash, NOT a separate `personal_sign` wrapping.

</specifics>

<deferred>
## Deferred Ideas

- **`enableModule(...)` calldata detection + `[HARD-TRIGGER — MODULE ENABLE]` block** — Phase 38.
- **`operation: 1` (delegatecall) hard-trigger + `[HARD-TRIGGER — DELEGATECALL]` block** — Phase 38.
- **Inv #12.5 second-LLM check codification in SECURITY.md** — Phase 38.
- **Companion `vaultpilot-preflight` skill Inv #12.5 encoding** — Phase 38 (sister-repo coordinated bump).
- **EIP-1271 contract signature mode** (Safe-as-signer of another Safe — nested multisig) — v3.x.
- **Pre-v1.3.0 Safe version support** — explicitly NOT supported (cross-chain replay risk via missing chainId in domain). `txServiceDrift: true` + `driftReasons: ["unsupported-version"]` from Phase 36 covers detection.
- **Batched Safe ops via `MultiSend` / `MultiSendCallOnly`** — v2.5.x (architecture supports it via `prepare_safe_tx_propose`'s `to` = MultiSendCallOnly address + encoded batch in `data`, but no convenience tool until usage demands).
- **Safe owner-management tools** (`prepare_safe_add_owner` / `_remove_owner` / `_change_threshold`) — v2.5.x.
- **Safe creation via ProxyFactory** — out of scope for v2.5; users create Safes via the official Safe UI.
- **Account Abstraction (4337) integration** — v3.x.
- **Persistent (cross-session) handle storage** — defer; 15-minute TTL in-memory matches v1.x signing discipline.
- **Server-side CAL coverage probe** for typed-data clear-sign — no public Ledger API; defer.
- **Auto-submit signature on `prepare_safe_tx_propose` success** (skip the explicit `submit_safe_tx_signature` step) — explicitly REJECTED: the agent-explicit `submit_safe_tx_signature` step is a load-bearing defense surface (the user sees one more CHECKS PERFORMED block before publishing).

</deferred>

---

*Phase: 37-safe-three-step-signing-flow*
*Decisions captured (auto-mode): 2026-05-27*
