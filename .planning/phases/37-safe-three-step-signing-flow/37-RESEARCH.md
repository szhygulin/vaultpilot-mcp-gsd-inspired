# Phase 37: Safe three-step signing flow — Research

**Researched:** 2026-05-27
**Domain:** EIP-712 typed-data signing + Safe multisig coordination + execTransaction signature assembly
**Confidence:** HIGH on Safe v1.3.0/v1.4.1 canonical encoding (verified against Safe smart-account source); HIGH on integration points (read directly from codebase); MEDIUM on WalletConnect/Ledger ETH app behavioral edges (verified across multiple sources, no native test fixtures available)

## Summary

Phase 37 introduces the first EIP-712 typed-data signing path into the existing handle-store + payloadFingerprint + preview/send pipeline. Three of the four new tools (`prepare_safe_tx_propose`, `prepare_safe_tx_approve`, `submit_safe_tx_signature`) operate entirely off-chain — they coordinate ECDSA signatures over a 32-byte EIP-712 digest via the Safe Tx Service. The fourth (`prepare_safe_tx_execute`) is a normal on-chain EVM transaction calling `execTransaction(...)` on the Safe Singleton, reusing the existing `PreparedTxEvm` + `preview_send` + `send_transaction` pipeline unchanged.

The load-bearing finding: **Safe v1.3.0 and v1.4.1 share byte-identical EIP-712 typehashes** for both `EIP712Domain` and `SafeTx`. The v1.3.0 and v1.4.1 Safe contracts ship the same hardcoded constants — `SAFE_TX_TYPEHASH = 0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8` and `DOMAIN_SEPARATOR_TYPEHASH = 0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218`. This means the `safe-tx-hash.ts` module needs ONE digest path, not two — the version-based fork in CONTEXT.md collapses at the encoding layer. The version distinction is still load-bearing for **refusal** (pre-v1.3.0 Safes have a `EIP712Domain` without `chainId` and so enable cross-chain replay — refused at `prepare_safe_tx_propose`).

The second load-bearing finding: **the Safe Tx Service `postSignature` body is just `{ signature: "0x..." }`** — the owner address is derived server-side via ECDSA recovery against the on-chain Safe owners. This matches Phase 37's design (`submit_safe_tx_signature` recovers locally for the refusal gate and the Tx Service recovers independently for storage). No `signatureType` field, no `owner` field on the wire.

**Primary recommendation:** Build `src/signing/safe-tx-hash.ts` as a single pure function using `viem.hashTypedData`. Build `PreparedTxSafeTypedData` as the 6th discriminant of the `PreparedTx` union with sentinel EVM fields (matches Phase 12 Solana / Phase 18 TRON / Phase 23 BTC sentinel pattern). Build `submit_safe_tx_signature` as a tool that does NOT route through `send_transaction` (no on-chain tx) but DOES retain `userDecision: "send"` discipline (data leaves the MCP boundary). Build `prepare_safe_tx_execute` as a pure `PreparedTxEvm` producer with composite-tx preview (mirrors Phase 33 `prepare_uniswap_v3_rebalance` shape).

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Two `prepare_*` shapes — typed-data vs on-chain:**
- `prepare_safe_tx_propose` + `prepare_safe_tx_approve` produce typed-data signatures (no on-chain tx). NEW discriminant: `PreparedTxSafeTypedData`. Refuse `send_transaction` on these handles.
- `prepare_safe_tx_execute` is a real on-chain EVM tx — reuses `PreparedTxEvm` + existing pipeline unchanged.
- Mis-routing impossible by handle-discriminant type.

**`PreparedTxSafeTypedData` shape:**
Fields: `kind: "safe-typed-data"`, `chain: ChainId`, `safeAddress: Address`, `safeVersion: "1.3.0" | "1.4.1"`, `safeTxHash: Hex`, `nonce: bigint`, `operation: "call" | "delegatecall"`, `to: Address`, `value: bigint`, `data: Hex`, `payloadFingerprint: Hex`, `typedDataStructure: SafeEIP712TypedData`. 15-min TTL.

**`payloadFingerprint` domain tag:** NEW `VaultPilot-safetx-v1:` for typed-data flows. Binding preimage: `tag || chain(uint64 LE) || safeAddress(20) || safeVersion(string) || safeTxHash(32) || nonce(uint256 BE) || operation(uint8) || to(20) || value(uint256 BE) || keccak(data)(32)`. Execute uses existing `VaultPilot-txverify-v1:` tag (normal EVM tx).

**`src/signing/safe-tx-hash.ts`:** Pure function `computeSafeTxHash({chain, safeAddress, safeVersion, to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce})` → `Hex`. Built on `viem.hashTypedData`. v1.3.0 and v1.4.1 both use `{chainId, verifyingContract}` domain. Pre-v1.3.0 refused with `UNSUPPORTED_SAFE_VERSION`.

**Fixtures SAFE-A/B/C/D:** Hardcoded `0x…` literals — A (v1.3.0 call), B (v1.4.1 call), C (v1.3.0 delegatecall), D (`VaultPilot-safetx-v1:` payloadFingerprint over SAFE-A). All captured from real mainnet Safes or canonical Safe SDK output. NO `beforeAll`-snapshot.

**WalletConnect namespace extension:** `methods: ["eth_sendTransaction", "personal_sign"]` → `["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"]`. Pre-Phase-37 sessions surface `INVALID_INPUT + hint = "Re-pair Ledger Live..."` on first Safe typed-data call.

**Typed-data signing transport:** Agent invokes `signClient.request<Hex>({topic, chainId, request: {method: "eth_signTypedData_v4", params: [walletAddress, JSON.stringify(typedData)]}})`. Ledger displays clear-sign or blind-sign mode depending on CAL coverage; the `LEDGER DISPLAY` block surfaces both possible displays.

**`submit_safe_tx_signature`:** Input `{chain, safeAddress, safeTxHash, signature, userDecision}`. `userDecision: "send"` schema-level required. ECDSA-recover BEFORE posting; refuses if signer is not a paired WC wallet OR not an on-chain owner. Handle-store lookup by `(chain, safeAddress, safeTxHash)` — transitions to `"sent"` if handle exists; surfaces `handleNotFound: true` otherwise. Posts via new `postSignature` client method.

**`prepare_safe_tx_execute`:** Refuses early if `confirmations.length < threshold`. Sorts confirmations by signer address ascending. Concatenates 65-byte ECDSA signatures. Builds `execTransaction(...)` calldata. Returns standard `PreparedTxEvm`. Composite-tx preview shape per Phase 33 precedent. Uses existing `VaultPilot-txverify-v1:` fingerprint tag. Layer 0.5 dispatch allowlist passes via Phase 36's `SAFE_SINGLETON_DISPATCH_ALLOWLIST`.

**Plan structure (3 plans, sequential):**
- **37-01:** safe-tx-hash.ts + PreparedTxSafeTypedData discriminant + VaultPilot-safetx-v1 tag + prepare_safe_tx_propose + WC namespace extension + Fixtures SAFE-A/B/C/D.
- **37-02:** prepare_safe_tx_approve + submit_safe_tx_signature + postSignature method + ECDSA recover + handle transition.
- **37-03:** prepare_safe_tx_execute + signature assembly + composite-tx preview + full three-step integration test.

**FROZEN-area zero-diff invariant:** `src/signing/send_transaction.ts` + `src/signing/preview_send.ts` UNTOUCHED in 37-01 + 37-02. Plan 37-03 extends only via existing `PreparedTxEvm` path. Existing canonical fixtures FROZEN. Acceptance gate Test 18-equivalent across the phase.

### Claude's Discretion

- Internal helper names (`SafeTxHashCalculator`, `assembleSafeSignatures`, `recoverSafeSigner`, etc.)
- Whether to pre-fill `safeTxGas` / `baseGas` / `gasPrice` / `gasToken` / `refundReceiver` defaults (all-zero is standard for non-relayed Safe txs)
- Exact LRU cache reuse (`postSignature` does not cache; pending-tx reads invalidate on signature post)
- Whether `LEDGER DISPLAY` block is single-block or split (clear-sign + blind-sign subsections)

### Deferred Ideas (OUT OF SCOPE)

- `enableModule` + `delegatecall` hard-trigger second-LLM check (Inv #12.5) — Phase 38
- SECURITY.md Inv #12.5 codification — Phase 38
- EIP-1271 contract signature mode (`v == 0`) — v3.x
- Pre-1.3.0 Safe version support — explicitly NOT supported (refused with `UNSUPPORTED_SAFE_VERSION`)
- `MultiSend` / `MultiSendCallOnly` batched ops — v2.5.x
- Safe owner-management (`addOwner`/`removeOwner`/`changeThreshold`) — v2.5.x
- Safe creation via ProxyFactory — v3.x
- Account Abstraction (4337) — v3.x
- Persistent cross-session handle storage — keep 15-min TTL in-memory
- Server-side CAL coverage probe — no public Ledger API
- Auto-submit on `prepare_safe_tx_propose` success — explicitly REJECTED (load-bearing defense surface)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SAFE-05 | `prepare_safe_tx_propose({chain, safeAddress, to, value, data, operation})` builds SafeTx hash + EIP-712 typed-data structure; user signs via Ledger; SafeTx hash in `src/signing/safe-tx-hash.ts` regression-tested | §1 EIP-712 canonical encoding; §2 WC signTypedData transport; §5 handle-store + payloadFingerprint integration; §9 Plan 37-01 boundary |
| SAFE-06 | `prepare_safe_tx_approve({chain, safeAddress, safeTxHash})` fetches pending SafeTx, surfaces decoded op in CHECKS PERFORMED, prepares signature | §3 reuses Phase 36 `getMultisigTransaction`; §5 typed-data plumbing; §9 Plan 37-02 boundary |
| SAFE-07 | `submit_safe_tx_signature({chain, safeAddress, safeTxHash, signature})` submits signature to Tx Service (off-chain, no on-chain tx) | §3 postSignature API shape; §7 ECDSA signer recovery; §9 Plan 37-02 boundary |
| SAFE-08 | `prepare_safe_tx_execute({chain, safeAddress, safeTxHash})` builds on-chain execution tx once threshold met; signatures-bytes assembled from Tx Service state | §4 execTransaction ABI + signature blob format; §6 composite-tx preview shape; §9 Plan 37-03 boundary |

## Project Constraints (from CLAUDE.md)

- **Handle-store discipline:** `prepare_*` always returns a handle. Handle is opaque to agent; everything agent needs to relay is in response.
- **PREPARE RECEIPT block:** Every `prepare_*` response. Verbatim agent args. Never elide.
- **payloadFingerprint:** Computed at prepare time, re-checked at send time. Drift → structured refusal. New tag `VaultPilot-safetx-v1:` for typed-data; reuse `VaultPilot-txverify-v1:` for execute.
- **previewToken + userDecision: "send":** Required on every `send_transaction`. SCHEMA-level gate. `submit_safe_tx_signature` also requires `userDecision: "send"` (CONTEXT lock).
- **No private key material crosses any boundary.** Ever.
- **`src/config/contracts.ts`:** Single source of truth for canonical contract addresses. SafeContracts SOT already populated in Phase 36; Phase 37 reads only.
- **Stderr for diagnostics, stdout for MCP protocol.** Crossing breaks the client.
- **Decimal-aware arithmetic:** All token amounts cross agent boundary as decimal strings. (Phase 37 surface uses `value: string` decimal-wei from agent perspective; SafeTx fields are hex-wei internally.)
- **ESM spy-affordance indirection:** `_safeChains` already exists in `src/chains/safe.ts` (Phase 36). Phase 37 extensions to that file follow the same pattern. For `src/clients/safe-tx-service.ts` POST, use `vi.stubGlobal("fetch", …)` at the network boundary (matches Phase 36 client convention).
- **Cryptographic-binding fixtures pinned as hardcoded literals:** Fixtures SAFE-A/B/C/D mandatory. Cross-link from `prepare-safe-tx-*.test.ts` + `submit-safe-tx-signature.test.ts`. NO `beforeAll`-snapshot.
- **GSD Workflow Enforcement:** All file edits via planned phase work — applies to Plan 37-01/02/03 execution.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| EIP-712 typed-data digest computation | Signing (`src/signing/safe-tx-hash.ts`) | — | Pure function; no I/O; canonical encoding lives next to `presign-hash.ts` |
| Handle discriminant + state machine | Signing (`src/signing/handle-store.ts`) | — | Existing pattern; 6th discriminant added; FROZEN core state machine |
| WalletConnect typed-data request transport | Tool tier (`src/tools/prepare_safe_tx_propose.ts` + `_approve.ts`) | Wallet (`src/wallet/session-manager.ts` namespace extension) | Mirrors `send_transaction`'s `signClient.request` pattern |
| Safe Tx Service signature POST | Client (`src/clients/safe-tx-service.ts` extension) | Tool (`src/tools/submit_safe_tx_signature.ts`) | Extend the 5-arm DU client with the first write method |
| ECDSA signer recovery (cross-check) | Tool (`src/tools/submit_safe_tx_signature.ts`) | Viem `recoverAddress` | Pure crypto; no I/O beyond on-chain `getOwners()` lookup |
| On-chain `domainSeparator()` cross-check | Chain reader (`src/chains/safe.ts` extension) | Tool (CHECKS PERFORMED block) | Extends Phase 36's minimal Safe ABI; reads only |
| `execTransaction` calldata assembly | Tool (`src/tools/prepare_safe_tx_execute.ts`) | Signing (`computePayloadFingerprint`) | Composite-tx preview; reuses existing EVM tx pipeline |
| Layer 0.5 canonical-dispatch gate | Security (`src/security/canonical-dispatch.ts`) | — | Already wired in Phase 36; Phase 37 is first consumer |

## Standard Stack

### Core (already installed; Phase 37 adds no new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `viem` | `^2.x` (existing) | EIP-712 hashing (`hashTypedData`), ECDSA recovery (`recoverAddress`), keccak/concat/numberToBytes, ABI encoding (`encodeFunctionData`) | Already the canonical EVM client in this codebase; native bigint; canonical EIP-712 encoder |
| `@walletconnect/sign-client` | `^2.x` (existing) | `eth_signTypedData_v4` request transport (mirror of `eth_sendTransaction` pattern) | Existing WC v2 SDK; no upgrade needed |
| `@noble/hashes` | `^1.x` (existing) | Re-exported by viem for keccak math | Phase 37 uses viem re-exports; no direct dependency |

**Installation:** None. All required functionality is already in the existing dependency set.

**Version verification:** Confirmed by inspection of existing imports in `src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/wallet/session-manager.ts`, `src/tools/send_transaction.ts`. `[VERIFIED: codebase grep]`

## Package Legitimacy Audit

**Not applicable.** Phase 37 adds zero new npm packages. All required functionality is provided by `viem` and `@walletconnect/sign-client` which are existing dependencies vetted at earlier phases (Phase 1 server skeleton + Phase 3 WC pairing). No `[SLOP]` / `[SUS]` / `[OK]` triage required.

## Architecture Patterns

### System Architecture Diagram (Phase 37 dataflow)

```
agent (Claude Code) ─────────────────────────────────────────────────────────────────
   │
   │  STEP 1 — propose (off-chain)
   │  prepare_safe_tx_propose({chain, safeAddress, to, value, data, operation})
   ▼
src/tools/prepare_safe_tx_propose.ts
   ├── reads on-chain: getOwners() / getThreshold() / nonce() / VERSION() / domainSeparator() via src/chains/safe.ts
   ├── computes:  safeTxHash = src/signing/safe-tx-hash.ts::computeSafeTxHash(...)
   ├── computes:  payloadFingerprint = VaultPilot-safetx-v1:‖chain‖safeAddress‖version‖safeTxHash‖nonce‖operation‖to‖value‖keccak(data)
   ├── builds:    typedDataStructure (domain + types + message)
   ├── creates:   PreparedTxSafeTypedData handle
   └── returns:   { handle, safeTxHash, typedDataStructure, PREPARE RECEIPT, CHECKS PERFORMED, LEDGER DISPLAY }
                  │
                  │  agent invokes via WC
                  ▼
   signClient.request<Hex>({ topic, chainId: "eip155:<chain>", request: {
                              method: "eth_signTypedData_v4",
                              params: [walletAddress, JSON.stringify(typedDataStructure)] }})
                  │
                  ▼
   Ledger Live  →  USB  →  Ledger ETH app  →  clear-sign OR blind-sign display
                  │  (user approves)
                  ▼  returns: 0x{r:32 || s:32 || v:1}  (65 bytes; v ∈ {27, 28} legacy ECDSA)
   │
   │  STEP 2 — submit (off-chain)
   │  submit_safe_tx_signature({chain, safeAddress, safeTxHash, signature, userDecision: "send"})
   ▼
src/tools/submit_safe_tx_signature.ts
   ├── handle-store lookup by (chain, safeAddress, safeTxHash) — optional; surfaces handleNotFound on miss
   ├── if found: re-computes payloadFingerprint and verifies match (Layer 1 drift gate)
   ├── ECDSA-recovers: viem.recoverAddress({hash: safeTxHash, signature}) — refuses if not paired AND not on-chain owner
   ├── posts to Tx Service: POST {endpoint}/v1/multisig-transactions/{safeTxHash}/confirmations/ body: { signature }
   └── if handle present: transitionToSent(handle, safeTxHash)  ─── reuses existing state machine
                  │
                  │  (other owners repeat propose → submit via approve flow)
                  │
                  │  STEP 3 — approve (off-chain — co-signer flow)
                  │  prepare_safe_tx_approve({chain, safeAddress, safeTxHash})
                  ▼
src/tools/prepare_safe_tx_approve.ts
   ├── fetches:    SafeTx record via Phase 36's getMultisigTransaction(chain, safeTxHash)
   ├── re-derives: typedDataStructure from {to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce}
   ├── (same plumbing as propose; routes via submit_safe_tx_signature)
   └── CHECKS PERFORMED includes: "wallet has not already signed this SafeTx" (cross-checks confirmations[])
                  │
                  │  (once collected signatures ≥ threshold)
                  │
                  │  STEP 4 — execute (ON-CHAIN)
                  │  prepare_safe_tx_execute({chain, safeAddress, safeTxHash})
                  ▼
src/tools/prepare_safe_tx_execute.ts
   ├── fetches:    SafeTx + confirmations[] via Phase 36 client
   ├── refuses:    if confirmations.length < threshold (INSUFFICIENT_SIGNATURES)
   ├── recovers:   each confirmation.signature against safeTxHash — refuses if any signer no longer an owner
   ├── sorts:      confirmations[] by signer address ascending (Safe convention)
   ├── concats:    65-byte ECDSA signatures (r||s||v; v ∈ {27, 28}) → "signatures" bytes blob
   ├── encodes:    execTransaction(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures)
   ├── computes:   payloadFingerprint via existing VaultPilot-txverify-v1: tag (it IS a normal EVM tx)
   ├── creates:    PreparedTxEvm handle  ─── reuses existing pipeline
   └── returns:    { handle, decodedAction: <encapsulated op surface>, PREPARE RECEIPT, CHECKS PERFORMED }
                  │
                  │  routes through existing pipeline
                  ▼
src/tools/preview_send.ts (unchanged) → src/tools/send_transaction.ts (unchanged)
                  │
                  ▼
   Ledger ETH app signs eth_sendTransaction → broadcasts to chain → execTransaction executes on Safe Singleton
```

### Recommended Project Structure (additive — Phase 37 new files)

```
src/
├── signing/
│   ├── safe-tx-hash.ts                NEW — pure EIP-712 digest computation
│   ├── handle-store.ts                EXTEND — add PreparedTxSafeTypedData discriminant
│   └── payload-fingerprint.ts         EXTEND — add VaultPilot-safetx-v1 tag + computeSafeTxPayloadFingerprint
├── tools/
│   ├── prepare_safe_tx_propose.ts     NEW (Plan 37-01)
│   ├── prepare_safe_tx_approve.ts     NEW (Plan 37-02)
│   ├── submit_safe_tx_signature.ts    NEW (Plan 37-02)
│   ├── prepare_safe_tx_execute.ts     NEW (Plan 37-03)
│   └── register-all.ts                EXTEND — side-effect imports for 4 new tools
├── chains/
│   └── safe.ts                        EXTEND — add domainSeparator() + getTransactionHash views
├── clients/
│   └── safe-tx-service.ts             EXTEND — add postSignature POST method
└── wallet/
    └── session-manager.ts             EXTEND — add eth_signTypedData_v4 to REQUIRED_NAMESPACES.methods

test/
├── signing-safe-tx-hash.test.ts                       NEW — Fixtures SAFE-A/B/C
├── signing-fingerprint.test.ts                        EXTEND — Fixture SAFE-D
├── prepare-safe-tx-propose.test.ts                    NEW (Plan 37-01)
├── prepare-safe-tx-approve.test.ts                    NEW (Plan 37-02)
├── submit-safe-tx-signature.test.ts                   NEW (Plan 37-02)
├── prepare-safe-tx-execute.test.ts                    NEW (Plan 37-03)
└── integration/safe-three-step-flow.test.ts           NEW (Plan 37-03)
```

### Pattern 1: New PreparedTx discriminant (mirror of Phase 12/18/23 sentinel pattern)

**What:** Adding a 6th member to the `PreparedTx` discriminated union for the typed-data signing shape.

**When to use:** Any new chain or signing flow that does NOT produce an on-chain transaction broadcast through `send_transaction`.

**Example:**
```typescript
// src/signing/handle-store.ts (extension; lines after PreparedTxBtcLifi at L879)
export interface PreparedTxSafeTypedData {
  /** Required discriminator — Safe EIP-712 typed-data shape (off-chain signing only). */
  txType: "safe-typed-data";

  // EVM-shape sentinel fields (same pattern as PreparedTxSolana sentinels at L370-405).
  // Set to zero/empty values so the union is accessible without narrowing at every EVM
  // call site. The discriminant routes BEFORE any read reaches these sentinels.
  chainId: number;                  // sentinel — always 0
  to: Address;                      // sentinel — always 0x000...
  valueWei: bigint;                 // sentinel — always 0n
  data: Hex;                        // sentinel — always "0x"
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;

  // Safe-specific cryptographic-binding fields
  chain: ChainId;                              // real chain (vs sentinel chainId above)
  safeAddress: Address;
  safeVersion: "1.3.0" | "1.4.1";              // pre-1.3.0 refused before reaching this shape
  safeTxHash: Hex;                             // the 32-byte EIP-712 digest
  safeNonce: bigint;                           // SafeTx nonce (NOT the EVM nonce sentinel above)
  operation: "call" | "delegatecall";
  safeTxTo: Address;                           // encapsulated tx target
  safeTxValue: bigint;
  safeTxData: Hex;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: Address;
  refundReceiver: Address;
  typedDataStructure: SafeEIP712TypedData;     // full domain + types + message (agent inspectable)
}

export type PreparedTx =
  | PreparedTxEvm
  | PreparedTxSolana
  | PreparedTxTron
  | PreparedTxBtc
  | PreparedTxLtc
  | PreparedTxBtcLifi
  | PreparedTxSafeTypedData;   // 7th discriminant (CONTEXT.md "6th"; codebase actually has 6 already, this makes 7)
// Source: src/signing/handle-store.ts:940 (existing union)
```

**Note:** CONTEXT.md says "6th discriminant" — the codebase actually has 6 already (EVM/Solana/TRON/BTC/LTC/BTC-LiFi), so this is the 7th. Off-by-one in CONTEXT.md prose only; no impact on implementation.

### Pattern 2: payloadFingerprint domain tag for new flow type (mirror of Phase 18 TRON / Phase 23 BTC)

**What:** New keccak preimage tag for a non-EVM signing flow.

**When to use:** Any signing flow whose preimage shape differs from the EVM `(chainId, to, valueWei, data)` quartet.

**Example:**
```typescript
// src/signing/payload-fingerprint.ts (extension; new function alongside existing)
export const SAFE_TX_FINGERPRINT_DOMAIN_TAG = "VaultPilot-safetx-v1:";

export function computeSafeTxPayloadFingerprint(input: {
  chain: ChainId;             // uint64 LE
  safeAddress: Address;       // 20 bytes
  safeVersion: "1.3.0" | "1.4.1";  // utf-8 string sentinel
  safeTxHash: Hex;            // 32 bytes
  nonce: bigint;              // uint256 BE
  operation: 0 | 1;           // uint8 (0=call, 1=delegatecall)
  to: Address;                // 20 bytes
  value: bigint;              // uint256 BE
  data: Hex;                  // → keccak256(data): 32 bytes
}): Hex {
  const tag = toBytes(SAFE_TX_FINGERPRINT_DOMAIN_TAG);
  const chainBytes = numberToBytes(input.chain, { size: 8 });  // uint64 LE per CONTEXT
  // ⚠ CONTEXT says "uint64 LE" — viem `numberToBytes` defaults to BE; verify endianness at write-time
  const safeAddressBytes = hexToBytes(input.safeAddress);
  const versionBytes = toBytes(`v${input.safeVersion}`);  // "v1.3.0" / "v1.4.1" per CONTEXT
  const safeTxHashBytes = hexToBytes(input.safeTxHash);
  const nonceBytes = numberToBytes(input.nonce, { size: 32 });
  const operationBytes = numberToBytes(input.operation, { size: 1 });
  const toBytes20 = hexToBytes(input.to);
  const valueBytes = numberToBytes(input.value, { size: 32 });
  const dataKeccak = keccak256(hexToBytes(input.data));
  const preimage = concat([
    tag, chainBytes, safeAddressBytes, versionBytes, safeTxHashBytes,
    nonceBytes, operationBytes, toBytes20, valueBytes, hexToBytes(dataKeccak),
  ]);
  return keccak256(preimage);
}
// Source: mirrors src/signing/payload-fingerprint.ts:36-49 existing pattern
```

**Endianness gotcha:** CONTEXT.md says `chain (uint64 LE)` — viem `numberToBytes` defaults to **big-endian**. The implementer MUST pass `{ size: 8, endian: "little" }` (or use `numberToBytes(chain, { size: 8 }).reverse()`). The current `computePayloadFingerprint` uses BE for chainId (uint256 BE); the SAFE tag intentionally uses uint64 LE per CONTEXT lock — this is a deliberate choice, not an oversight.

### Pattern 3: Composite-tx preview shape (mirror of Phase 33 `prepare_uniswap_v3_rebalance`)

**What:** A single `PreparedTxEvm` whose preview surfaces multiple decoded sub-steps.

**When to use:** Any tool whose `tx.data` calldata wraps an inner operation the user needs to see.

**Phase 33 precedent (lines 1298-1343 of `src/tools/preview_send.ts`):** `(tx.to === NPM, sel === 0xac9650d8)` tuple dispatch routes to `decodeFunctionData({abi: UNISWAP_V3_LP_MULTICALL_BYTES_ABI})` which extracts inner calls; each inner call recurses through `decodeSingleNpmCall`. The result is a `{kind: "uniswap-v3-lp-composite-multicall", subCalls: [...]}` shape that the DECODED ARGS block renders as `step 1 / step 2 / step 3` sub-blocks.

**For Phase 37 `prepare_safe_tx_execute`:**
- Outer selector: `execTransaction(...)` = `0x6a761202` (Safe Singleton's standard signature; verified by 4byte lookup at planning time)
- (tx.to, selector) tuple: `(SAFE_SINGLETON_DISPATCH_ALLOWLIST[chain].has(record.tx.to), sel === 0x6a761202)` — adopted from the Phase 33 + Phase 34 dispatch convention
- Inner decode: the `(to, value, data, operation)` quartet inside the calldata is the "encapsulated op". The CHECKS PERFORMED + DECODED ARGS blocks expose:
  - `step 1 / 1: execTransaction → {operation} to {to} with value {value}`
  - sub-decode of `data` via the existing decoder chain (4byte / Etherscan ABI cache) — call recursively into `decodeSafeInner(data, to)` if the inner target is a known protocol; "(undecoded — selector 0xXXXXXXXX shown on-device)" otherwise
- payloadFingerprint stays over the outer calldata (the standard PREP-03 envelope); composite preview is rendering only, NOT a fingerprint dimension (same discipline as Phase 33).

### Anti-Patterns to Avoid

- **Hand-rolled EIP-712 encoder.** Don't. Use `viem.hashTypedData`. The encoder gets the typehash / domain separator / hashStruct sequencing right by construction. Hand-rolling has bitten every protocol that has tried — see EIP-712 v1/v2/v3/v4 confusion in MetaMask history.
- **Separate digest paths for v1.3.0 vs v1.4.1.** They share byte-identical typehashes — one digest function handles both. Branching on version inside the digest path is dead code that ages badly.
- **Pre-fetching domainSeparator from on-chain and using it instead of recomputing.** The whole point of EIP-712 is the client computes the domain independently from `{chainId, verifyingContract}`. Use the on-chain value for the CHECKS PERFORMED cross-verification ONLY — never as the source-of-truth for the digest.
- **Recovering signer with personal_sign wrapping.** Safe EIP-712 signatures are recovered against the **raw 32-byte digest** (the `safeTxHash`), NOT a `\x19Ethereum Signed Message:\n32` wrapping. `viem.recoverAddress({hash: safeTxHash, signature})` — not `verifyMessage`.
- **Accepting `v == 0` or `v == 1` signatures at submit time.** These are Safe's contract-signature and pre-approved modes. Phase 37 surfaces only ECDSA mode (`v ∈ {27, 28}`). Reject explicitly with `INVALID_INPUT + hint = "Only ECDSA signatures (v=27/28) accepted at this phase. Contract signatures (v=0) and pre-approved (v=1) deferred to v3.x."`
- **Mutating `record.tx.to` / `record.tx.data` after handle creation.** The handle-store discipline is BYTE-IDENTICAL across the existing 6 chains. PreparedTxSafeTypedData follows the same rule.
- **Auto-submitting on `prepare_safe_tx_propose` success.** Explicitly REJECTED in CONTEXT.md — the agent-explicit `submit_safe_tx_signature` step is a load-bearing defense surface (one more CHECKS PERFORMED block before publishing).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| EIP-712 typed-data digest | Manual keccak / RLP / ABI-encoder | `viem.hashTypedData({domain, types, primaryType, message})` | One canonical implementation; auto-handles typehash computation + domain separator + hashStruct |
| Signer recovery from ECDSA signature | Manual EC math / `noble-curves` | `viem.recoverAddress({hash, signature})` | viem wraps `noble-curves` correctly; handles `v ∈ {27, 28}` directly |
| Multi-signer signature blob assembly | String concatenation by hand | Sort `confirmations[]` by `signer.toLowerCase()` ascending, then `concat(sigs.map(s => hexToBytes(s.signature)))` via viem | Safe contract iterates ascending; mis-ordering causes `INVALID_OWNER` revert on-chain |
| ECDSA `v` byte normalization | Custom `if (v < 27) v += 27` logic | Trust the Ledger ETH app's return value | Safe contract expects legacy 27/28 for EIP-712; Ledger returns this directly for typed-data signing (NOT EIP-155 chain-doubled `v`) |
| HTTP retry logic for Tx Service | Custom retry loop | `safe-tx-service.ts` existing 5-arm DU client behavior (`rate-limited` arm with `retryAfterMs`) | Phase 36 client already handles 429 / timeout / 5xx via the never-throws DU |
| `execTransaction` ABI encoding | Manual ABI byte assembly | `viem.encodeFunctionData({abi, functionName: "execTransaction", args: [...]})` with the 10-arg signature | viem is the canonical encoder used everywhere else in this codebase |
| domainSeparator computation | Manual hashing | `viem.hashDomain({domain})` OR don't compute at all — use `hashTypedData` which encapsulates it | Same library, one canonical implementation |

**Key insight:** Phase 37 is almost entirely a viem composition. The only Safe-specific knowledge that lives in this codebase is (a) the SafeTx struct field list + order, (b) the v-byte refusal discipline for `v ∈ {0, 1}`, (c) the ascending-signer-address sort for signature assembly. Everything else delegates to viem.

## Runtime State Inventory

> Phase 37 is greenfield code addition (no rename/refactor/migration). Section omitted intentionally.

## Common Pitfalls

### Pitfall 1: EIP-712 domain misencoding (the v1.3.0 vs v1.4.1 false fork)

**What goes wrong:** Implementer branches the digest function on `safeVersion` assuming the domains differ.

**Why it happens:** Pre-v1.3.0 Safes used a `EIP712Domain` WITHOUT `chainId` (enabling cross-chain replay). The natural assumption is that v1.3.0 and v1.4.1 also differ. They don't — both use `EIP712Domain(uint256 chainId,address verifyingContract)` byte-identically. `[VERIFIED: Safe v1.3.0 + v1.4.1 source — DOMAIN_SEPARATOR_TYPEHASH = 0x47e79534... in both]`

**How to avoid:** Single digest path. `safeVersion` is used ONLY at the prepare-time gate to refuse pre-v1.3.0 (`UNSUPPORTED_SAFE_VERSION`). Once accepted, the digest is identical.

**Warning signs:** Two functions `computeSafeTxHashV13` and `computeSafeTxHashV14` in `safe-tx-hash.ts` → red flag, collapse to one.

### Pitfall 2: `chainId` type mismatch in viem.hashTypedData

**What goes wrong:** Passing `chainId` as `number` when viem expects `bigint`, or vice versa, produces a silent wrong digest.

**Why it happens:** `viem.TypedDataDomain.chainId` is typed `number | bigint`. viem's runtime encodes it as a `uint256` regardless — but if the agent supplies a string-ish value that JS coerces wrong, the digest drifts undetectably.

**How to avoid:** Always pass `chainId: Number(input.chain)` (or `BigInt(input.chain)` — both work, but be CONSISTENT). Pin the choice in `safe-tx-hash.ts` and document at write-time. Fixtures SAFE-A/B/C anchor the byte-for-byte correctness.

**Warning signs:** Different digests for `chainId: 1` and `chainId: 1n` in a property test → viem version-specific bug, file upstream.

### Pitfall 3: WalletConnect `eth_signTypedData_v4` param order

**What goes wrong:** Some references show `[typedData, address]`; others show `[address, typedData]`.

**Why it happens:** Historical WC SDK inconsistency. Current consensus and EIP-712 reference implementations use `[address, typedData]` where typedData is a JSON string. `[VERIFIED: MetaMask docs + Safe SDK source + WalletConnect monorepo issue #264 resolved to address-first]`

**How to avoid:** Always `[walletAddress, JSON.stringify(typedDataStructure)]`. Mock the response in tests to verify the param ordering at the integration boundary.

**Warning signs:** Wallet returns "invalid params" or "method not supported" → re-check order, then re-check namespace registration.

### Pitfall 4: Ledger ETH app returns legacy v (27/28) for typed-data, NOT EIP-155

**What goes wrong:** Implementer assumes typed-data signatures use chain-doubled `v` (per EIP-155). They don't. EIP-155 applies only to **transaction** signatures, not to off-chain typed-data signatures. Ledger ETH app returns `v ∈ {27, 28}` for `eth_signTypedData_v4`.

**Why it happens:** EIP-155 history conflates transaction signing with message signing. Safe's contract `checkSignatures` expects `v ∈ {27, 28}` for EIP-712 mode — chain-doubled `v` would route to the eth_sign-prefixed mode (`v ∈ {31, 32}`).

**How to avoid:** Pass through the Ledger-returned signature verbatim. NO `v` normalization. Cross-verify in the integration test by ECDSA-recovering and confirming the signer address matches expectations.

**Warning signs:** Safe `execTransaction` reverts with `GS026` (`Invalid owner provided`) when the signature WAS recovered to a valid owner locally → almost certainly a `v` mismatch; check `signature.slice(130, 132)` against `1b` or `1c`.

### Pitfall 5: Signature blob ordering for `execTransaction`

**What goes wrong:** Concatenating `confirmations[].signature` in Tx Service order instead of ascending signer order.

**Why it happens:** Tx Service returns confirmations in DB-insertion order (whoever signed first appears first). Safe's `checkSignatures` iterates the blob expecting signers in **ascending address order** — wrong order causes `GS026` revert.

**How to avoid:**
```typescript
const sorted = confirmations.toSorted((a, b) =>
  a.owner.toLowerCase().localeCompare(b.owner.toLowerCase())
);
const signaturesBytes = concat(sorted.map(c => hexToBytes(c.signature)));
```

**Warning signs:** Same signatures in different orders produce different transaction bytes; `execTransaction` works on mainnet sometimes and reverts other times depending on which co-signer signed first.

### Pitfall 6: `v == 0` and `v == 1` signature modes on the wire

**What goes wrong:** Tx Service returns signatures with `v ∈ {0, 1}` — these are Safe's contract-signature (EIP-1271) and pre-approved-hash modes, NOT standard ECDSA. ECDSA-recovering them produces garbage addresses.

**Why it happens:** Multi-org Safes use EIP-1271 (a Safe-as-signer of another Safe). Tx Service stores them as raw confirmations.

**How to avoid:** At `prepare_safe_tx_execute`: filter confirmations to `v ∈ {27, 28, 31, 32}` (ECDSA + eth_sign modes). Refuse with `INVALID_SIGNATURE_MODE` if any confirmation has `v ∈ {0, 1}`. v3.x will add EIP-1271 support; v2.5 surfaces only ECDSA per CONTEXT lock.

**Warning signs:** ECDSA-recover returns an unexpected address that happens to map to `0x000...01` or `0x000...02` → `v == 0/1` signature; refuse.

### Pitfall 7: SafeTx field default for `safeTxGas` / `baseGas` / `gasPrice` / `gasToken` / `refundReceiver`

**What goes wrong:** Implementer omits these fields or sets them to non-zero defaults, breaking the digest match with the standard Safe UI flow (which sets all to zero for non-relayed txs).

**Why it happens:** These are LEGACY gas-relay fields (Safe v1.0 era). v1.3.0+ non-relayed txs always set all to zero. The standard Safe UI uses zero; any other value produces a digest that the user's other co-signers will reject as `txServiceDrift`.

**How to avoid:** Default ALL FIVE to zero at `prepare_safe_tx_propose`. Document in tool description. Allow agent override but log a WARN block if any non-zero (Claude's discretion per CONTEXT).

**Warning signs:** Co-signer's `prepare_safe_tx_approve` produces a DIFFERENT `safeTxHash` than `prepare_safe_tx_propose` → almost always a default-mismatch on these 5 fields.

### Pitfall 8: ECDSA recovery against typed-data digest, NOT personal_sign wrapping

**What goes wrong:** Implementer uses `viem.verifyMessage` or wraps the digest in `\x19Ethereum Signed Message:\n32` before recovering.

**Why it happens:** Conflation with `personal_sign` (eth_sign) which DOES wrap. EIP-712 explicitly does NOT.

**How to avoid:** `viem.recoverAddress({ hash: safeTxHash, signature })` — the `hash` is the raw 32-byte digest. NO wrapping.

**Warning signs:** Recovery produces an address that's not in `getOwners()` and not in the pairedWalletAddresses → check wrapping convention.

### Pitfall 9: `chain` vs `chainId` field naming divergence

**What goes wrong:** Phase 36's `safe-tx-service.ts` uses `chainId: ChainId`; the Safe SDK uses `chainId` in domain (bigint); Phase 8's tool surface uses `chain: "ethereum" | "arbitrum" | ...`. Phase 37's `PreparedTxSafeTypedData` has both `chainId` (sentinel) AND `chain: ChainId` (real value).

**Why it happens:** Three layers, three conventions. Easy to grab the wrong one.

**How to avoid:** Document in `PreparedTxSafeTypedData` doc-comment: `chainId` is the EVM sentinel (always 0), `chain` is the real ChainId. Cross-reference Phase 36 client signature.

**Warning signs:** `record.tx.chainId` reads `0` in a Safe handler → expected (sentinel); use `record.tx.chain` instead.

## Code Examples

### Example 1: viem.hashTypedData for Safe v1.3.0/v1.4.1 SafeTx

```typescript
// src/signing/safe-tx-hash.ts (NEW, Plan 37-01)
import { hashTypedData, type Address, type Hex } from "viem";
import type { ChainId } from "../config/contracts.js";

export type SafeOperation = 0 | 1; // 0 = Call, 1 = DelegateCall (Safe Enum.Operation)
export type SupportedSafeVersion = "1.3.0" | "1.4.1";

export interface SafeEIP712TypedData {
  domain: {
    chainId: number;            // viem accepts number|bigint; pick number for codebase consistency
    verifyingContract: Address;
  };
  types: {
    EIP712Domain: [
      { name: "chainId"; type: "uint256" },
      { name: "verifyingContract"; type: "address" },
    ];
    SafeTx: [
      { name: "to"; type: "address" },
      { name: "value"; type: "uint256" },
      { name: "data"; type: "bytes" },
      { name: "operation"; type: "uint8" },
      { name: "safeTxGas"; type: "uint256" },
      { name: "baseGas"; type: "uint256" },
      { name: "gasPrice"; type: "uint256" },
      { name: "gasToken"; type: "address" },
      { name: "refundReceiver"; type: "address" },
      { name: "nonce"; type: "uint256" },
    ];
  };
  primaryType: "SafeTx";
  message: {
    to: Address;
    value: bigint;
    data: Hex;
    operation: SafeOperation;
    safeTxGas: bigint;
    baseGas: bigint;
    gasPrice: bigint;
    gasToken: Address;
    refundReceiver: Address;
    nonce: bigint;
  };
}

export function buildSafeEIP712TypedData(input: {
  chain: ChainId;
  safeAddress: Address;
  safeVersion: SupportedSafeVersion;
  to: Address;
  value: bigint;
  data: Hex;
  operation: SafeOperation;
  safeTxGas?: bigint;
  baseGas?: bigint;
  gasPrice?: bigint;
  gasToken?: Address;
  refundReceiver?: Address;
  nonce: bigint;
}): SafeEIP712TypedData {
  // safeVersion is load-bearing for the REFUSAL gate (pre-1.3.0 has no chainId in domain
  // → cross-chain replay risk). At digest time, v1.3.0 and v1.4.1 share byte-identical
  // typehashes — same encoding path.
  return {
    domain: {
      chainId: input.chain,
      verifyingContract: input.safeAddress,
    },
    types: {
      EIP712Domain: [
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "SafeTx",
    message: {
      to: input.to,
      value: input.value,
      data: input.data,
      operation: input.operation,
      safeTxGas: input.safeTxGas ?? 0n,
      baseGas: input.baseGas ?? 0n,
      gasPrice: input.gasPrice ?? 0n,
      gasToken: input.gasToken ?? ("0x0000000000000000000000000000000000000000" as Address),
      refundReceiver: input.refundReceiver ?? ("0x0000000000000000000000000000000000000000" as Address),
      nonce: input.nonce,
    },
  };
}

export function computeSafeTxHash(input: Parameters<typeof buildSafeEIP712TypedData>[0]): Hex {
  return hashTypedData(buildSafeEIP712TypedData(input));
}
// Source: viem.hashTypedData docs + Safe v1.4.1 SAFE_TX_TYPEHASH at safe-smart-account/Safe.sol
```

### Example 2: ECDSA recovery + Safe Tx Service POST

```typescript
// src/tools/submit_safe_tx_signature.ts (NEW, Plan 37-02)
import { recoverAddress, type Address, type Hex } from "viem";

import { getMultisigTransaction, postSignature } from "../clients/safe-tx-service.js";
import { _safeChains } from "../chains/safe.js";  // existing ESM spy seam
// ...

async function handle(input: {
  chain: ChainId;
  safeAddress: Address;
  safeTxHash: Hex;
  signature: Hex;       // 65 bytes (r || s || v); v ∈ {27, 28} for ECDSA
  userDecision: "send"; // schema-level gate per CONTEXT
}) {
  // 1. ECDSA-recover the signer locally — defense in depth.
  //    viem.recoverAddress takes the RAW 32-byte digest (NOT personal_sign wrapped).
  const recovered = await recoverAddress({
    hash: input.safeTxHash,
    signature: input.signature,
  });

  // 2. Cross-check: recovered signer ∈ paired WC wallets.
  const status = getLedgerStatus();
  const pairedSet = new Set(status.accounts.map(a => a.toLowerCase()));
  if (!pairedSet.has(recovered.toLowerCase())) {
    return errEnvelope("INVALID_INPUT",
      `Signature recovered to ${recovered}; not a paired Ledger. Re-sign via the correct wallet.`);
  }

  // 3. Cross-check: recovered signer ∈ on-chain Safe owners.
  const onchain = await _safeChains.getOnchainSafeInfo(
    getPublicClient(input.chain), input.chain, input.safeAddress,
  );
  const ownerSet = new Set(onchain.owners.map(o => o.toLowerCase()));
  if (!ownerSet.has(recovered.toLowerCase())) {
    return errEnvelope("INVALID_INPUT",
      `Recovered signer ${recovered} is not an owner of Safe ${input.safeAddress}.`);
  }

  // 4. Optional handle-store lookup + fingerprint re-check (informational if missing).
  const handleEntry = findHandleBySafeTxHash(input.chain, input.safeAddress, input.safeTxHash);
  if (handleEntry) {
    const recomputed = computeSafeTxPayloadFingerprint({/* … */});
    if (recomputed !== handleEntry.record.payloadFingerprint) {
      return errEnvelope("PAYLOAD_FINGERPRINT_DRIFT", "...");
    }
  }

  // 5. POST to Tx Service. Body is JUST { signature } — server derives owner from ECDSA recovery.
  const result = await postSignature({
    chain: input.chain,
    safeTxHash: input.safeTxHash,
    signature: input.signature,
  });

  // 6. If handle present, transition to "sent" (the typed-data signature published).
  if (handleEntry) {
    transitionToSent(handleEntry.handle, input.safeTxHash);
  }

  return {/* PREPARE RECEIPT + CHECKS PERFORMED + submission outcome */};
}
// Source: viem.recoverAddress docs + safe-transaction-service serializers.py POST schema
```

### Example 3: postSignature client method (extension of Phase 36 client)

```typescript
// src/clients/safe-tx-service.ts (NEW method appended to existing 5-arm DU client)

export type PostSignatureResult =
  | { kind: "ok" }
  | { kind: "duplicate" }             // server detected idempotent re-post
  | { kind: "not-found" }             // safeTxHash unknown to Tx Service
  | { kind: "rate-limited"; message: string; retryAfterMs?: number }
  | { kind: "error"; message: string }
  | { kind: "unsupported-chain"; chainId: ChainId };

export async function postSignature(input: {
  chain: ChainId;
  safeTxHash: Hex;
  signature: Hex;  // 65 bytes; ECDSA only at Phase 37 (v ∈ {27,28} or eth_sign v ∈ {31,32})
}): Promise<PostSignatureResult> {
  const endpoint = SAFE_TX_SERVICE_ENDPOINTS[input.chain];
  if (!endpoint) return { kind: "unsupported-chain", chainId: input.chain };

  if (agentSessionCallCount >= PER_SESSION_CALL_LIMIT) {
    return ceilingExceededArm();
  }
  agentSessionCallCount += 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAFE_TX_SERVICE_TIMEOUT_MS);

  try {
    // URL: POST {endpoint}/v1/multisig-transactions/{safeTxHash}/confirmations/
    // Note trailing slash — required by Django REST router.
    // Body: just { signature } — server derives owner from ECDSA recovery.
    const url = `${endpoint}/v1/multisig-transactions/${input.safeTxHash}/confirmations/`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { ...buildHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ signature: input.signature }),
      signal: controller.signal,
    });
    // 201 Created — accepted; 200 OK on idempotent re-post (per safe-transaction-service code review);
    // 400 if signature recovery fails server-side; 404 if safeTxHash unknown; 422 on processing error.
    if (resp.status === 201) return { kind: "ok" };
    if (resp.status === 200) return { kind: "duplicate" };
    if (resp.status === 404) return { kind: "not-found" };
    if (resp.status === 429) {/* rate-limited arm — mirror existing */}
    // …
  } catch (err) {
    return networkErrorToArm(err);
  } finally { clearTimeout(timer); }
  // Pending-tx cache invalidation: drop entries for this safeAddress (signature post
  // changes the confirmations list returned by getPendingTransactions).
}
// Source: safe-transaction-service serializers.py + views.py + the existing client conventions
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pre-v1.3.0 Safe: `EIP712Domain` without chainId | v1.3.0+: chainId in domain (`EIP712Domain(uint256 chainId,address verifyingContract)`) | Safe v1.3.0 release (May 2022) | Cross-chain replay defended by construction |
| Hand-rolled EIP-712 encoders | viem.hashTypedData / ethers ._signTypedData | 2021-2022 | Canonical encoders eliminate the v1/v2/v3/v4 confusion era |
| Direct USB-HID Ledger transport for typed-data | WC v2 bridge with `eth_signTypedData_v4` | 2023 | Phase 37 uses WC bridge per project architecture (USB-HID is v2.x scope) |
| Safe Transaction Service at `safe-transaction-{chain}.safe.global` | `api.safe.global/tx-service/{shortname}/api` | 2025 (Phase 36 RESEARCH confirmed migration; old hosts 308-redirect) | Phase 36 client already on new URL pattern |

**Deprecated/outdated:**
- Pre-v1.3.0 Safe support: explicitly refused at `prepare_safe_tx_propose` (`UNSUPPORTED_SAFE_VERSION`)
- EIP-1271 contract signatures (`v == 0`): deferred to v3.x; refused at `prepare_safe_tx_execute` if any confirmation has `v ∈ {0, 1}`
- Pre-approved hashes (`v == 1`): deferred to v3.x; refused at execute

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | WC SDK `signClient.request` param order for `eth_signTypedData_v4` is `[address, JSON.stringify(typedData)]` (address-first, JSON-stringified) | Pitfall 3 | Wallet returns "invalid params"; UI cannot complete signing flow. Mitigation: test against real Ledger Live in v2.5 verify-phase before claiming code-complete. |
| A2 | Ledger ETH app returns legacy `v ∈ {27, 28}` for typed-data signatures (NOT EIP-155 chain-doubled) | Pitfall 4 | `execTransaction` reverts with `GS026`. Mitigation: integration test ECDSA-recovers and confirms; real-Ledger UAT in v2.5 verify-phase. |
| A3 | `postSignature` returns HTTP 200 on duplicate (idempotent re-post) and 201 on first post | Example 3 + §3 | Confusion between `kind: "ok"` and `kind: "duplicate"` arms in client. Mitigation: read safe-transaction-service serializers.py + manual test against real Tx Service. Low risk — UX-only impact. |
| A4 | viem `numberToBytes(n, {size: 8})` defaults to big-endian; little-endian requires explicit option | Pattern 2 | If implementer expects LE and viem gives BE, all SAFE-D fingerprints drift. Mitigation: explicit option pass at write-time; Fixture SAFE-D is the regression anchor. |
| A5 | Safe Singleton `domainSeparator()` is a `view returns (bytes32)` function — extending the existing 5-fn ABI in `src/chains/safe.ts` is mechanical | §5 | If Safe Singleton's `domainSeparator()` ABI shape differs across v1.3.0 and v1.4.1, the cross-verification call may revert on one version. Mitigation: read safe-smart-account@v1.4.1 source AND @v1.3.0 source at plan-execute time. |
| A6 | `execTransaction` 4-byte selector is `0x6a761202` | Pattern 3 + §4 | Wrong selector breaks the composite-tx preview dispatch. Verifiable trivially via 4byte.directory lookup or `keccak256("execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)").slice(0, 10)`. Mitigation: anchor the selector in a test fixture. |
| A7 | Safe v1.3.0 and v1.4.1 share identical SAFE_TX_TYPEHASH and DOMAIN_SEPARATOR_TYPEHASH bytes | §1 | If wrong, the digest function must branch on version. Mitigation: VERIFIED at both Safe source files; cross-confirmed via typehash byte values. Low risk. |

## Open Questions (RESOLVED)

All five questions resolved at plan-time (2026-05-27); resolutions flow into the 3 PLAN.md files.

1. **Should `submit_safe_tx_signature`'s handle-store transition update `txHash` to the `safeTxHash` or leave it null?**
   - What we know: existing `transitionToSent` requires a `txHash` argument; the field name `txHash` carries the historical EVM connotation but was widened to `string` in Phase 12 for cross-chain.
   - What's unclear: whether storing the SafeTx hash here (which is NOT an on-chain tx hash) confuses downstream consumers like `get_tx_verification`.
   - RESOLVED: pass the `safeTxHash` (the EIP-712 digest) as `txHash` to `transitionToSent`. Document in `PreparedTxSafeTypedData` doc-comment that "txHash on a Safe-typed-data handle is the SafeTx hash, NOT an on-chain tx hash." Same field, different semantic — matches the BTC `txHash` widening pattern.

2. **Should the `LEDGER DISPLAY` block be one block or two (clear-sign + blind-sign subsections)?**
   - What we know: CONTEXT.md says executor's call; default to single block with both subsections.
   - What's unclear: whether the agent can intelligently route based on CAL coverage (no — no public API).
   - RESOLVED: single block with both subsections. The user sees both possible displays and can match whichever the Ledger actually shows. Matches Phase 35 `prepare_custom_call`'s `LEDGER BLIND-SIGN HASH` precedent.

3. **Should `prepare_safe_tx_execute` re-ECDSA-recover every confirmation at prepare time, or trust the Tx Service?**
   - What we know: Stale signatures after `removeOwner` are a real attack class — CONTEXT explicitly says "all signatures recovered to current owners (defends against stale signatures after removeOwner)".
   - What's unclear: cost of recovery for high-threshold Safes (a 5-of-7 means 5 recoveries; negligible compute).
   - RESOLVED: re-recover every confirmation. Anchor in CHECKS PERFORMED. The cost is zero in latency (no I/O), the defense is real.

4. **Should `submit_safe_tx_signature` retry on `rate-limited` response, or surface verbatim?**
   - What we know: Phase 36 client never retries; returns the `rate-limited` arm verbatim with `retryAfterMs`.
   - What's unclear: whether write operations (POST) deserve a different retry posture than reads.
   - RESOLVED: surface verbatim. Let the agent decide whether to retry. Matches the "never-throws + never-retries" Phase 36 convention.

5. **Does the integration test in Plan 37-03 need a co-signer persona to be realistic?**
   - What we know: CONTEXT.md says "propose → submit → approve × N → submit × N → execute, all fetch/multicall-stubbed".
   - What's unclear: whether the integration test ALSO needs to exercise a 2-of-3 threshold (multi-signer signature assembly) vs only a 1-of-1 Safe.
   - RESOLVED: BOTH. 1-of-1 anchors the degenerate case (single signature blob); 2-of-3 anchors the ascending-sort discipline + signer-recovery cross-check. Two test fixtures, one file.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `viem` | EIP-712 hashing + ECDSA recovery + ABI encoding | ✓ (existing) | ^2.x | — |
| `@walletconnect/sign-client` | typed-data request transport | ✓ (existing) | ^2.x | — |
| Node.js ≥ 18.17 | runtime | ✓ (project requirement) | per package.json engines | — |
| TypeScript strict mode | type-check | ✓ (existing) | per tsconfig | — |
| vitest | test runner | ✓ (existing) | per package.json | — |
| Safe Transaction Service mainnet endpoint | live signature submission (real-Ledger UAT only) | n/a at unit-test layer | — | fetch stub via `vi.stubGlobal("fetch", …)` |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None for code-complete; real-Ledger UAT for v2.5 verify-phase requires real Safe + co-signer (per Phase 38 CONTEXT cadence).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing; pinned per package.json) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run test/signing-safe-tx-hash.test.ts test/prepare-safe-tx-propose.test.ts` (per-file during Plan 37-01 dev) |
| Full suite command | `npx vitest run` (full suite at phase merge gate) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SAFE-05 | `prepare_safe_tx_propose` builds correct SafeTx hash + EIP-712 structure | unit | `npx vitest run test/signing-safe-tx-hash.test.ts` (Fixtures SAFE-A/B/C) | ❌ Wave 0 |
| SAFE-05 | `prepare_safe_tx_propose` tool returns handle + LEDGER DISPLAY + CHECKS PERFORMED | unit | `npx vitest run test/prepare-safe-tx-propose.test.ts` | ❌ Wave 0 |
| SAFE-05 | `payloadFingerprint` over `VaultPilot-safetx-v1:` tag is byte-stable | unit | `npx vitest run test/signing-fingerprint.test.ts -t "Fixture SAFE-D"` | ❌ Wave 0 (extends existing file) |
| SAFE-05 | WC session-manager namespace includes `eth_signTypedData_v4` post-Phase-37 | unit | `npx vitest run test/wallet-session-manager.test.ts` (extend existing) | ❌ Wave 0 (extends existing file) |
| SAFE-06 | `prepare_safe_tx_approve` fetches SafeTx, re-derives typed-data, returns handle | unit | `npx vitest run test/prepare-safe-tx-approve.test.ts` | ❌ Wave 0 |
| SAFE-06 | CHECKS PERFORMED includes "wallet has not already signed" cross-check | unit | as above, `-t "duplicate-sign warning"` | ❌ Wave 0 |
| SAFE-07 | `submit_safe_tx_signature` ECDSA-recovers, cross-checks owners + paired wallets, posts | unit | `npx vitest run test/submit-safe-tx-signature.test.ts` | ❌ Wave 0 |
| SAFE-07 | Refuses on signer not in paired wallets / not an on-chain owner | unit | as above, `-t "refusal"` | ❌ Wave 0 |
| SAFE-07 | Refuses on `v ∈ {0, 1}` (contract-sig + pre-approved deferred) | unit | as above | ❌ Wave 0 |
| SAFE-07 | Handle-store transition to `"sent"` on successful POST | unit | as above, `-t "handle transition"` | ❌ Wave 0 |
| SAFE-08 | `prepare_safe_tx_execute` refuses if `confirmations.length < threshold` | unit | `npx vitest run test/prepare-safe-tx-execute.test.ts -t "INSUFFICIENT_SIGNATURES"` | ❌ Wave 0 |
| SAFE-08 | Signature blob sorted ascending by signer address | unit | as above, `-t "ascending"` | ❌ Wave 0 |
| SAFE-08 | `execTransaction` calldata encodes 10 args correctly | unit | as above, `-t "calldata"` (anchor against canonical 4byte selector + ABI shape) | ❌ Wave 0 |
| SAFE-08 | `payloadFingerprint` uses existing `VaultPilot-txverify-v1:` tag (execute IS a normal EVM tx) | unit | as above, `-t "fingerprint"` | ❌ Wave 0 |
| SAFE-08 | Composite-tx preview surfaces encapsulated `to/value/data/operation` | unit | extend `test/preview-send.test.ts` for the new `(tx.to, 0x6a761202)` dispatch arm | ❌ Wave 0 (extends existing file) |
| SAFE-05..08 | Full three-step flow: propose → submit → approve × N → submit × N → execute | integration | `npx vitest run test/integration/safe-three-step-flow.test.ts` | ❌ Wave 0 (1-of-1 + 2-of-3 fixtures) |
| SAFE-05..08 | FROZEN-area zero-diff across Plans 37-01 + 37-02 | regression | `git diff --stat origin/main -- src/signing/send_transaction.ts src/signing/preview_send.ts` returns empty | n/a (assertion in integration test per Phase 36 precedent) |

### Sampling Rate
- **Per task commit:** `npx vitest run test/<file>.test.ts` for the file(s) the commit touched (per-file in seconds).
- **Per wave merge:** `npx vitest run test/signing-safe-tx-hash.test.ts test/prepare-safe-tx-*.test.ts test/submit-safe-tx-signature.test.ts test/integration/safe-three-step-flow.test.ts` (Phase 37 surface).
- **Phase gate:** Full suite green (`npx vitest run`) before `/gsd-verify-phase`. Test count delta projected ~+50 to +70 across the 3 plans, similar to Phase 36's +105.

### Wave 0 Gaps
- [ ] `test/signing-safe-tx-hash.test.ts` — Fixtures SAFE-A/B/C (v1.3.0 call + v1.4.1 call + v1.3.0 delegatecall) — covers SAFE-05
- [ ] `test/prepare-safe-tx-propose.test.ts` — tool-level — covers SAFE-05
- [ ] `test/prepare-safe-tx-approve.test.ts` — tool-level — covers SAFE-06
- [ ] `test/submit-safe-tx-signature.test.ts` — tool-level — covers SAFE-07
- [ ] `test/prepare-safe-tx-execute.test.ts` — tool-level — covers SAFE-08
- [ ] `test/integration/safe-three-step-flow.test.ts` — integration — covers SAFE-05..08 end-to-end (fetch + multicall stubbed)
- [ ] `test/signing-fingerprint.test.ts` extension — Fixture SAFE-D (`VaultPilot-safetx-v1:` preimage)
- [ ] `test/wallet-session-manager.test.ts` extension — `eth_signTypedData_v4` in namespace
- [ ] `test/preview-send.test.ts` extension — composite-tx preview arm for `execTransaction`

### Minimum bar to claim "code-complete"
All seven new test files pass + Phase 36 + earlier-phase suites stay green + FROZEN-area zero-diff held. Real-Ledger smoke test (mainnet 1-of-1 Safe propose → submit → execute) deferred to v2.5 verify-phase per Phase 36 close-out cadence (CONTEXT.md "v2.5 verify-phase requires a real Safe wallet on mainnet + a co-signer + small balance for execution").

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | WC v2 session ownership; user authenticates by physical Ledger hardware approval |
| V3 Session Management | yes | WC v2 session expiry + per-method namespace |
| V4 Access Control | yes | On-chain owner set cross-check at every step |
| V5 Input Validation | yes | viem typing for Hex / Address / bigint; zod schemas on tool surface; explicit `v ∈ {27, 28}` refusal |
| V6 Cryptography | yes | viem.hashTypedData (no hand-rolled EIP-712); viem.recoverAddress (no hand-rolled ECDSA) |
| V8 Data Protection | n/a | No private key material crosses this codebase boundary (CLAUDE.md invariant) |
| V9 Communication | yes | HTTPS to Safe Tx Service; WSS via WC relay (existing Phase 3 surface) |

### Known Threat Patterns for Safe multisig + EIP-712 typed-data

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-chain replay (signature valid on chainA used on chainB) | T (Tampering) | `chainId` in EIP-712 domain (v1.3.0+); pre-v1.3.0 Safes REFUSED |
| Same-Safe nonce collision (replay across Safe txs at same nonce) | T | `nonce` in `SafeTx` typed-data → distinct digest per nonce |
| Stale signature post-`removeOwner` | T + R (Repudiation defense) | `prepare_safe_tx_execute` re-recovers every confirmation; refuses if any signer no longer an owner |
| Fake Tx Service response (compromised Tx Service serves wrong tx) | T + I (Information disclosure) | On-chain `domainSeparator()` cross-verification at `prepare_safe_tx_approve` + `_execute`; on-chain `nonce()` cross-check at `_execute` |
| Wrong signer (agent claims signature is from wallet X but it's from wallet Y) | S (Spoofing) | ECDSA recovery at `submit_safe_tx_signature`; refuse if not paired AND not on-chain owner |
| `v == 0` / `v == 1` contract-sig + pre-approved attack vectors | E (Elevation of privilege) | Refuse at `submit_safe_tx_signature` AND at `prepare_safe_tx_execute`; defer EIP-1271 to v3.x |
| Ascending-signer-address sort drift (signatures concatenated wrong) | T | Explicit `.toSorted(localeCompare)` discipline; integration test fixture with 2-of-3 |
| `safeTxGas` / `baseGas` defaults drift (digest mismatch between propose + approve) | T | Default all to zero; document in tool description |
| Calldata embeds module-enable / delegatecall (high-blast-radius op slipping through) | T + E | Phase 38 hard-trigger second-LLM check (DEFERRED per CONTEXT); Phase 37 surfaces delegatecall as informational only |
| Blind-sign mode on Ledger (no clear-sign coverage; user signs unparseable hash) | T (Mitigated by user attention) | `LEDGER BLIND-SIGN HASH` block matches the safeTxHash; user visually confirms on-device — accepted residual (documented in SECURITY.md) |
| Drift between propose-time fingerprint and submit-time recompute | T | Layer 1 `payloadFingerprint` re-check at `submit_safe_tx_signature` |

## Sources

### Primary (HIGH confidence)

- Safe v1.4.1 source (`safe-smart-account/contracts/Safe.sol`) — DOMAIN_SEPARATOR_TYPEHASH + SAFE_TX_TYPEHASH + execTransaction signature `[VERIFIED: GitHub via WebFetch 2026-05-27]`
- Safe v1.3.0 source (`safe-contracts/contracts/GnosisSafe.sol`) — typehash byte-identity with v1.4.1 `[VERIFIED: GitHub via WebFetch 2026-05-27]`
- safe-transaction-service serializers.py (`SafeMultisigConfirmationSerializer`) — POST body is `{ signature }` only `[VERIFIED: GitHub via WebFetch 2026-05-27]`
- safe-transaction-service views.py (`SafeMultisigConfirmationsView`) — endpoint behavior 201/200/400/422 `[VERIFIED: GitHub via WebFetch 2026-05-27]`
- safe-core-sdk protocol-kit utils/signatures/utils.ts — Safe signature byte layout + v-byte conventions + ascending sort `[VERIFIED: GitHub via WebFetch 2026-05-27]`
- viem docs hashTypedData + recoverAddress `[CITED: viem.sh/docs/utilities/hashTypedData + viem.sh/docs/utilities/recoverAddress]`
- Project codebase: `src/signing/handle-store.ts`, `src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/clients/safe-tx-service.ts`, `src/chains/safe.ts`, `src/wallet/session-manager.ts`, `src/tools/send_transaction.ts`, `src/tools/prepare_uniswap_v3_rebalance.ts`, `src/tools/preview_send.ts`, `src/config/contracts.ts`, `test/helpers/mock-sign-client.ts`, `test/signing-fingerprint.test.ts`, `test/signing-presign-hash.test.ts`, `test/chains-safe.test.ts` `[VERIFIED: codebase Read 2026-05-27]`
- Phase 36 SUMMARY documents (`36-01-SUMMARY.md`, `36-02-SUMMARY.md`) — Phase 36 exports + pitfalls + ESM seam pattern `[VERIFIED: codebase Read 2026-05-27]`

### Secondary (MEDIUM confidence)

- WalletConnect monorepo issue #264 — `eth_signTypedData` param order resolution `[CITED: github.com/WalletConnect/walletconnect-monorepo/issues/264]`
- MetaMask docs `eth_signTypedData_v4` — `[address, JSON.stringify(typedData)]` order `[CITED: docs.metamask.io/wallet/reference/json-rpc-methods/eth_signtypeddata_v4/]`
- Ledger Developer Portal — Ethereum Signer Kit signature return shape `[CITED: developers.ledger.com/docs/device-interaction/references/signers/eth]`
- Safe Docs Transaction Service overview `[CITED: docs.safe.global/core-api/transaction-service-overview]`

### Tertiary (LOW confidence)

- General EIP-712 signing tutorials (Hashnode, MyCrypto blog) — used only to cross-confirm consensus on param order and v-byte conventions; NOT primary sources for any factual claim in this document.

## Metadata

**Confidence breakdown:**
- Safe v1.3.0/v1.4.1 EIP-712 typehash byte-identity: HIGH — verified at both source files; typehash byte values cross-confirmed.
- Safe Tx Service `postSignature` body shape: HIGH — read from serializers.py.
- WalletConnect `eth_signTypedData_v4` param order: MEDIUM — community consensus + WC issue resolution; not in the v1.x codebase yet (first introduction). Mitigation: A1 in Assumptions Log.
- Ledger ETH app `v` byte mode for typed-data: MEDIUM — Ledger docs + community consensus; not in codebase yet. Mitigation: A2 in Assumptions Log, real-Ledger UAT in v2.5 verify.
- Codebase integration points: HIGH — read directly from source files in the worktree.
- Composite-tx preview shape (Phase 33 precedent): HIGH — read directly from `src/tools/preview_send.ts` and `src/tools/prepare_uniswap_v3_rebalance.ts`.

**Research date:** 2026-05-27
**Valid until:** 2026-06-27 (30 days for the stable EIP-712 + Safe contract surface; sooner if Safe v1.5.x or breaking Tx Service migration drops)
