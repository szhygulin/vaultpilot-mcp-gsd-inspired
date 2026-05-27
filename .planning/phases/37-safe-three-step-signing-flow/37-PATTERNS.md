# Phase 37: Safe three-step signing flow — Pattern Map

**Mapped:** 2026-05-27
**Files analyzed:** 18 (6 NEW source, 6 NEW test, 5 MODIFIED source, 2 MODIFIED test, 1 modified register-all)
**Analogs found:** 18 / 18 (every file has either an exact analog or a role-match analog inside the repo; nothing falls through to RESEARCH.md)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/signing/safe-tx-hash.ts` (NEW) | signing utility | pure-function digest (transform) | `src/signing/presign-hash.ts` | exact (same role: pure-function digest computation over canonical struct inputs) |
| `src/signing/payload-fingerprint.ts` (MODIFIED — add `VaultPilot-safetx-v1:` tag + `computeSafeTxPayloadFingerprint`) | signing utility | pure-function fingerprint | `src/signing/payload-fingerprint.ts` itself (extend existing pattern) | exact — extend in place; `FINGERPRINT_DOMAIN_TAG` / `computePayloadFingerprint` is the template |
| `src/signing/handle-store.ts` (MODIFIED — add `PreparedTxSafeTypedData` discriminant) | signing state machine | additive type widening | `PreparedTxBtcLifi` (handle-store.ts:879) — most recent sentinel-fields widening | exact (newest precedent in the same file; same "EVM-shape sentinel fields + chain-specific binding fields" template) |
| `src/tools/prepare_safe_tx_propose.ts` (NEW) | tool (prepare) | request-response + read-on-chain + handle-mint | `src/tools/prepare_custom_call.ts` (Phase 35) | role-match (escape-hatch precedent for `acknowledgeNonProtocolTarget`-style schema gate, `PREPARE RECEIPT` template, `createHandle` with annotation field; closest non-canonical prepare_*) — supplemented by `prepare_uniswap_v3_rebalance.ts` (Phase 33) for composite-tx shape |
| `src/tools/prepare_safe_tx_approve.ts` (NEW) | tool (prepare) | request-response + Tx Service read + handle-mint | `src/tools/prepare_safe_tx_propose.ts` (sibling tool in same plan) → `prepare_custom_call.ts` | role-match (sibling-of-propose; fetches via `safeTxService.getMultisigTransaction` like `get_safe_transaction.ts:193`) |
| `src/tools/submit_safe_tx_signature.ts` (NEW) | tool (submit) | request-response + HTTPS POST + handle-transition | NO exact analog. Closest hybrid: `src/tools/send_transaction.ts` (for `userDecision: "send"` schema gate + handle lookup + transition) + `get_safe_transaction.ts` (for Tx Service client invocation 5-arm dispatch) | hybrid (first POST-to-service tool; documented residual) |
| `src/tools/prepare_safe_tx_execute.ts` (NEW) | tool (prepare) | request-response + Tx Service read + composite-tx preview + handle-mint | `src/tools/prepare_uniswap_v3_rebalance.ts` (Phase 33) | exact (composite-tx preview shape precedent — single `PreparedTxEvm` whose `tx.data` wraps an inner operation that decodes at preview-time) |
| `src/wallet/session-manager.ts` (MODIFIED — add `eth_signTypedData_v4` to `REQUIRED_NAMESPACES.methods`) | wallet config | additive const list | `src/wallet/session-manager.ts:80` itself | exact (one-line addition to existing `methods: ["eth_sendTransaction", "personal_sign"]`) |
| `src/clients/safe-tx-service.ts` (MODIFIED — add `postSignature` POST method) | external client | request-response (HTTPS POST) | existing GET methods in the same file (`getMultisigTransaction` at lines 552-621) | exact (same file's 5-arm DU convention; first WRITE method) |
| `src/chains/safe.ts` (MODIFIED — add `domainSeparator()` + `getTransactionHash` views to ABI) | chain reader | additive ABI surface + view read | `src/chains/safe.ts:59-65` itself (existing `safeSingletonAbi` parseAbi block + `getOnchainSafeInfo`) | exact (extend the existing `parseAbi` array; add a sibling reader function) |
| `src/tools/register-all.ts` (MODIFIED — add 4 side-effect imports) | registration index | side-effect import | `src/tools/register-all.ts:117-118` (Phase 36 added `get_safe_positions` + `get_safe_transaction` lines) | exact (one-line additions per tool in the same block) |
| `src/security/canonical-dispatch.ts` (NO MODIFICATION — Phase 36's `SAFE_SINGLETON_DISPATCH_ALLOWLIST` arm is the first production consumer at Phase 37 via `prepare_safe_tx_execute`) | security gate | existing dispatch check | `src/security/canonical-dispatch.ts:207-220, 290-303` (existing Safe singleton allowlist + `checkDispatchTarget`) | exact (no code change; just consumer wiring) |
| `src/tools/send_transaction.ts` (MODIFIED — STRUCTURED-REFUSAL when handle resolves to `PreparedTxSafeTypedData`) | tool (send) | handle-discriminant routing | `src/tools/send_transaction.ts:352-394` (existing `txType ?? "evm"` discriminant routing) | exact (extend the existing `txType` switch with a `safe-typed-data` arm that returns a structured refusal instead of dispatching) |
| `test/signing-safe-tx-hash.test.ts` (NEW) | test (unit, crypto fixtures) | hardcoded fixture pin | `test/signing-presign-hash.test.ts` | exact (same shape: input → byte-for-byte literal output assertion + sanity-different-inputs test) |
| `test/signing-fingerprint.test.ts` (MODIFIED — add Fixture SAFE-D) | test (unit, fingerprint fixtures) | hardcoded fixture pin | `test/signing-fingerprint.test.ts:117-118` itself (Fixture P + CRV-A/B/C exports) | exact (extend the existing `EXPORTED const FIXTURE_*_FP = "0x…";` pattern) |
| `test/prepare-safe-tx-propose.test.ts` (NEW) | test (unit, tool-level) | mock-based unit | `test/prepare-custom-call.test.ts` | role-match (closest existing prepare_* test; same handle-creation + structured-content assertions) |
| `test/prepare-safe-tx-approve.test.ts` (NEW) | test (unit, tool-level) | mock-based unit | `test/prepare-custom-call.test.ts` + `test/integration/safe-get-transaction.test.ts` | role-match (sibling-of-propose; adds Tx Service fetch stub) |
| `test/submit-safe-tx-signature.test.ts` (NEW) | test (unit, tool-level) | mock-based unit (fetch + recoverAddress) | `test/clients-safe-tx-service.test.ts` (for fetch-stub patterns) + `test/send-transaction.test.ts` (handle/transition assertions; not loaded but referenced) | role-match (hybrid pattern; fetch-stub via `vi.stubGlobal("fetch", …)` per Phase 36) |
| `test/prepare-safe-tx-execute.test.ts` (NEW) | test (unit, tool-level) | mock-based unit | `test/integration/uniswap-v3-lp-rebalance.integration.test.ts` (composite-tx preview shape — not yet inspected but matches Plan 33-03 pattern) → fallback `test/prepare-custom-call.test.ts` | role-match (composite-tx preview shape) |
| `test/integration/safe-three-step-flow.test.ts` (NEW) | test (integration) | end-to-end with stubs | `test/integration/safe-positions.test.ts` (Phase 36) | role-match (newest Safe-domain integration test; same fetch-stub + `_safeChains` spy pattern) |
| `test/clients-safe-tx-service.test.ts` (MODIFIED — add `postSignature` test paths) | test (unit, client) | mock-based unit (fetch-stub) | `test/clients-safe-tx-service.test.ts:69-93` itself (existing `buildFetch` helper) | exact (extend the existing test file with a 5-arm DU × `postSignature` × idempotent-201/200 path matrix) |

---

## Pattern Assignments

### `src/signing/safe-tx-hash.ts` (signing utility, pure-function digest)

**Analog:** `src/signing/presign-hash.ts` (full file is 57 lines; the entire file IS the template)

**Imports pattern** (presign-hash.ts:15-16):
```typescript
import { keccak256, serializeTransaction } from "viem";
import type { Address, Hex } from "viem";
```

**Pure-function digest pattern** (presign-hash.ts:34-57):
```typescript
/**
 * Compute the keccak256 of the EIP-1559 transaction envelope BEFORE signing.
 * […load-bearing context comment block describing inputs / outputs / consumers…]
 */
export function computePresignHash(input: {
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gas: bigint;
  to: Address;
  value: bigint;
  data: Hex;
}): { serialized: Hex; presignHash: Hex } {
  const serialized = serializeTransaction({
    type: "eip1559",
    chainId: input.chainId,
    /* … pass-through fields */
    accessList: [],
  });
  return { serialized, presignHash: keccak256(serialized) };
}
```

**For Phase 37:** mirror this shape exactly. `import { hashTypedData } from "viem"` instead of `serializeTransaction`. Export `computeSafeTxHash(input: { chain, safeAddress, safeVersion, to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce }): Hex`. Use the typed-data shape from RESEARCH.md Example 1 (lines 477-583) verbatim — that section already gives the executor the full struct.

**No try/catch.** Viem throws on malformed Hex inputs; the caller handles. Matches the presign-hash discipline.

---

### `src/signing/payload-fingerprint.ts` (signing utility, fingerprint)

**Analog:** the same file, lines 21-49 — extend in place.

**Existing template** (payload-fingerprint.ts:21-49):
```typescript
export const FINGERPRINT_DOMAIN_TAG = "VaultPilot-txverify-v1:";

export function computePayloadFingerprint(input: {
  chainId: number;
  to: Address;
  valueWei: bigint;
  data: Hex;
}): Hex {
  const tag = toBytes(FINGERPRINT_DOMAIN_TAG); // 23 bytes utf-8
  const chainIdBytes = numberToBytes(input.chainId, { size: 32 });
  const toBytes20 = hexToBytes(input.to);
  const valueBytes = numberToBytes(input.valueWei, { size: 32 });
  const dataBytes = hexToBytes(input.data);
  const preimage = concat([tag, chainIdBytes, toBytes20, valueBytes, dataBytes]);
  return keccak256(preimage);
}
```

**For Phase 37:** add a sibling export `SAFE_TX_FINGERPRINT_DOMAIN_TAG = "VaultPilot-safetx-v1:"` + `computeSafeTxPayloadFingerprint(...)` whose preimage assembly matches CONTEXT lock (37-CONTEXT.md §"`payloadFingerprint` domain tag for SafeTx typed-data" and RESEARCH §Pattern 2 lines 294-325). Preserve the inline `// uint64 LE` / `// 20 bytes` / `// uint256 BE` comments per field — they are load-bearing per the audit pattern.

**Endianness warning** (RESEARCH Pitfall A4): `numberToBytes(chain, { size: 8 })` defaults to **big-endian**; CONTEXT locks the SAFE preimage at `chain (uint64 LE)`. Executor MUST pass `{ size: 8, endian: "little" }` or equivalent `.reverse()` step. Fixture SAFE-D is the regression anchor.

---

### `src/signing/handle-store.ts` (state machine, type widening)

**Analog:** `PreparedTxBtcLifi` (handle-store.ts:879-938) — the newest sentinel-fields widening; the cleanest template.

**Sentinel-fields template** (handle-store.ts:879-905):
```typescript
export interface PreparedTxBtcLifi {
  /** Required discriminator — BTC LiFi bridge shape. */
  txType: "btc-lifi";

  // -----------------------------------------------------------------------
  // EVM-shape sentinel fields (set to zero / empty values for btc-lifi handles).
  // -----------------------------------------------------------------------
  /** Sentinel — BTC LiFi has no EVM chainId. Always 0. */
  chainId: number;
  /** Sentinel — BTC addresses are bech32, not 0x-prefixed. Always the zero address. */
  to: Address;
  /** Sentinel — BTC uses satoshi, not valueWei. Always 0n. */
  valueWei: bigint;
  /** Sentinel — BTC LiFi has no EVM calldata. Always "0x". */
  data: Hex;
  /** Sentinel — no EVM nonce. Always undefined. */
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;

  // -----------------------------------------------------------------------
  // <chain>-specific cryptographic-binding fields.
  // -----------------------------------------------------------------------
  /* … chain-specific fields here */
}
```

**Union widening site** (handle-store.ts:940):
```typescript
export type PreparedTx = PreparedTxEvm | PreparedTxSolana | PreparedTxTron | PreparedTxBtc | PreparedTxLtc | PreparedTxBtcLifi;
```

**For Phase 37:** add `PreparedTxSafeTypedData` after `PreparedTxBtcLifi` (line 938). Append `| PreparedTxSafeTypedData` to the union at line 940. Fields per CONTEXT lock (§"`PreparedTxSafeTypedData` shape", lines 28-31) — the executor receives the full field list from CONTEXT.md plus RESEARCH Pattern 1 (lines 230-281) which already drafts the TS interface. Discriminator: `txType: "safe-typed-data"`.

**FROZEN guard:** the state-machine + TTL + `createHandle` / `lookup` / `transitionToPreviewed` / `transitionToSent` / `transitionToCancelled` functions are BYTE-IDENTICAL — only type-surface widening. Lines 958-1107 must produce zero diff under Plan 37-01.

---

### `src/tools/prepare_safe_tx_propose.ts` (tool, prepare + on-chain reads + handle-mint)

**Analog:** `src/tools/prepare_custom_call.ts` (Phase 35) — closest non-canonical prepare_* with a literal-true schema gate and a WARN-block convention. Supplemented by composite-tx-preview shape from `src/tools/prepare_uniswap_v3_rebalance.ts` (Phase 33) for the inner-op surface.

**Imports pattern** (prepare_custom_call.ts:47-65):
```typescript
import { type Address, type Hex, getAddress } from "viem";

import { chainIdFromName, type ChainName } from "../config/contracts.js";
import {
  CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE,
  /* … */
} from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import { registerTool } from "./index.js";
```

**`errEnvelope` boilerplate** (prepare_custom_call.ts:68-78 — copy verbatim):
```typescript
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<
    string,
    unknown
  > &
    StructuredError;
}
```

**Tool DESCRIPTION pattern** (prepare_custom_call.ts:80-93) — multi-line string array `.join(" ")` with these load-bearing components:
- Lead sentence with WHEN-to-use vs NOT-use.
- Required-fields enumeration.
- Optional-fields enumeration with defaults.
- "Returns `{ … }` plus the … TEMPLATE text blocks" line.
- "Failure modes: CODE1 (cause), CODE2 (cause), …" line.

For Phase 37 propose specifically: name the lifecycle stage explicitly ("Use FIRST when initiating a Safe multisig transaction. Off-chain typed-data sign. …") per CONTEXT lock §"Three-step flow naming + agent-routing discipline".

**INPUT_SCHEMA pattern** (prepare_custom_call.ts:95-138) — `chain` enum (`["ethereum", "arbitrum", "polygon", "base", "optimism"]`) + `pattern: "^0x[0-9a-fA-F]{40}$"` regex for addresses + `pattern: "^0x[0-9a-fA-F]*$"` for calldata. Mark every required field in the `required` array. `additionalProperties: false`.

**Handler skeleton** (prepare_custom_call.ts:140-358):
1. Parse `chain` → `chainId` via `chainIdFromName`.
2. Defense-in-depth shape validation of every arg (don't rely on schema alone — direct-invocation test path bypasses it).
3. Resolve sender via `await resolveFrom({ rawFrom, chainId })`.
4. Build the `tx` object.
5. Compute `payloadFingerprint = computePayloadFingerprint(tx)` (for Phase 37, use `computeSafeTxPayloadFingerprint(...)`).
6. Mint handle via `createHandle({ args, tx, payloadFingerprint, … })`.
7. Compose response: text blocks (PREPARE RECEIPT, CHECKS PERFORMED, LEDGER NOTICE/DISPLAY) joined with `\n\n`; `structuredContent` with `{ handle, chain, chainId, from, …, payloadFingerprint }`.
8. Outer try/catch wraps INTERNAL_ERROR.

**Handle creation pattern** (prepare_custom_call.ts:280-294):
```typescript
const handle = createHandle({
  args: {
    to: rawTo,
    valueWei: rawValue,
    data: rawData,
  },
  tx,
  payloadFingerprint,
  // (escape-hatch-only annotations omitted for Phase 37 propose)
});
```

**For Phase 37 propose:** `tx` is `PreparedTxSafeTypedData` (not `PreparedTxEvm`). The on-chain prefetch (`domainSeparator()` / `getOwners()` / `nonce()` / `VERSION()`) happens BEFORE `createHandle` — see `prepare_uniswap_v3_rebalance.ts:255-271` for the `await Promise.all([ client.readContract(...), client.readContract(...) ])` pattern. CHECKS PERFORMED block per CONTEXT §"CHECKS PERFORMED block — Safe-specific surfaces" (lines 96-100).

---

### `src/tools/prepare_safe_tx_approve.ts` (tool, prepare + Tx Service read + handle-mint)

**Analog:** sibling-of-propose; the propose tool IS the template. The only new shape is the Tx Service fetch.

**Tx Service fetch pattern** (get_safe_transaction.ts:193-238):
```typescript
const txResult = await safeTxService.getMultisigTransaction(chainId, safeTxHash);

if (txResult.kind === "unsupported-chain") { /* return error */ }
if (txResult.kind === "not-found")        { /* return error */ }
if (txResult.kind === "rate-limited")     { /* return error */ }
if (txResult.kind === "error")            { /* return error */ }

const tx = txResult.tx;
// Pitfall 6 — `confirmations` is OPTIONAL; defensive `?? []` at every site.
const confirmationsRaw = tx.confirmations ?? [];
// Operation discriminator — CONTEXT lock. NOT raw 0/1 in the response.
const operation: "call" | "delegatecall" =
  tx.operation === 1 ? "delegatecall" : "call";
```

**For Phase 37 approve:** import `* as safeTxService from "../clients/safe-tx-service.js"` (same pattern as get_safe_transaction.ts:33). 5-arm DU dispatch as above. Re-derive `typedDataStructure` from the fetched SafeTx fields. Cross-check `confirmations[]` for duplicate-sign warning per CONTEXT lock §"CHECKS PERFORMED block".

---

### `src/tools/submit_safe_tx_signature.ts` (tool, submit + HTTPS POST + handle-transition)

**Analog:** hybrid — no clean exact analog (first POST-to-service tool). Closest patterns:
1. `src/tools/send_transaction.ts` for `userDecision: "send"` schema gate + handle lookup + payloadFingerprint re-check + state transition.
2. `get_safe_transaction.ts:193-238` for the 5-arm DU dispatch over the Tx Service client.
3. RESEARCH §Example 2 (lines 587-651) provides the full draft.

**`userDecision: "send"` schema gate** (send_transaction.ts:188-197):
```typescript
const INPUT_SCHEMA: ToolInputSchema = {
  type: "object",
  properties: {
    /* … */
    userDecision: {
      type: "string",
      enum: ["send", "cancel"],
      description:
        "Must be exactly \"send\" to broadcast, or \"cancel\" for a clean exit (handle transitions to terminal cancelled state).",
    },
  },
  required: ["handle", "previewToken", "userDecision"],
  additionalProperties: false,
};
```

**For Phase 37 submit:** schema `enum: ["send", "cancel"]` per the same convention. CONTEXT locks `userDecision: "send"` as required (the user explicitly chose to publish their signature — "send" in the abstract sense).

**Handle lookup pattern** (send_transaction.ts:230-241):
```typescript
const lookupResult = lookup(handleArg);
if (!lookupResult.ok) { /* HANDLE_NOT_FOUND / HANDLE_EXPIRED structured refusal */ }
const record = lookupResult.record;
```

**Payload-fingerprint recompute + drift gate** (send_transaction.ts:352-409 — extend the existing `txType` switch with a `safe-typed-data` arm):
```typescript
const txType = record.tx.txType ?? "evm";
const recomputed =
  txType === "solana" ? computeSolanaPayloadFingerprint({...})
  : txType === "tron"  ? computeTronPayloadFingerprint({...})
  : /* … */
  : computePayloadFingerprint({...});
if (recomputed !== record.payloadFingerprint) {
  return { /* PAYLOAD_FINGERPRINT_DRIFT structured refusal */ };
}
```

**For Phase 37 submit:** because `submit_safe_tx_signature` does NOT route through `send_transaction.ts`, it executes its OWN handle-lookup + drift-gate locally. Handle-store lookup is by `(chain, safeAddress, safeTxHash)` not by handle ID — there is no separate handle-by-tx-fields lookup helper in `handle-store.ts` yet. The executor either iterates over the store (via a NEW `_peekHandleForTesting`-style accessor OR via a new public iterator) or simply matches by `safeTxHash` linearly. CONTEXT lock says "if no handle exists, proceed with the signer-recovery + on-chain owner check only; surface `handleNotFound: true` informationally."

**ECDSA recovery pattern** (NEW — no in-repo precedent for `recoverAddress`; viem direct call per RESEARCH Example 2):
```typescript
import { recoverAddress } from "viem";
const recovered = await recoverAddress({
  hash: input.safeTxHash,    // raw 32-byte digest — NOT personal_sign wrapped
  signature: input.signature,
});
```

**Tx Service client invocation** — call the NEW `postSignature` method (defined in next section). 5-arm DU dispatch matches `getMultisigTransaction`'s call site.

**Handle transition on success** (send_transaction.ts:80,1096-1107 — `transitionToSent`):
```typescript
import { transitionToSent } from "../signing/handle-store.js";
const trans = transitionToSent(handleArg, input.safeTxHash);
if (!trans.ok) { /* WRONG_STATUS structured refusal */ }
```

**For Phase 37 submit:** pass `input.safeTxHash` as the `txHash` argument — the field was widened to `string` in Plan 12-05 (handle-store.ts:973) explicitly to accept non-EVM identifiers. RESEARCH Open Question 1 confirms.

---

### `src/tools/prepare_safe_tx_execute.ts` (tool, prepare + Tx Service read + composite-tx preview)

**Analog:** `src/tools/prepare_uniswap_v3_rebalance.ts` (Phase 33) — the canonical composite-tx precedent.

**Composite-tx preview shape** (prepare_uniswap_v3_rebalance.ts:481-495):
```typescript
// Step 12 — Build tx + single payloadFingerprint over the FULL outer
// multicall calldata (CONTEXT.md D-06 + RESEARCH § Topic 9 — single
// hash; cryptographic-binding chain UNCHANGED from Phase 4).
const tx = { chainId, to: npmAddress, valueWei: 0n, data };
const payloadFingerprint = computePayloadFingerprint(tx);
const handle = createHandle({
  args: {
    to: npmAddress,
    valueWei: "0",
    tokenAddress: token0,
    amount: existingLiquidity.toString(),
  },
  tx,
  payloadFingerprint,
});
```

**CHECKS PERFORMED with inner-step decode** (prepare_uniswap_v3_rebalance.ts:518-535):
```typescript
const checksPerformed = [
  "CHECKS PERFORMED",
  `  tokenId:            ${tokenId.toString()} (owner verified === from)`,
  /* … */
  `  outerSelector:      0xac9650d8 (multicall(bytes[]) — NPM IMulticall overload; DISTINCT from Phase 32 SwapRouter02 deadline-overload)`,
  `  innerSteps:         3 — decreaseLiquidity (0x0c49ccbe) → collect (0xfc6f7865) → mint (0x88316456); LOAD-BEARING order`,
].join("\n");
```

**For Phase 37 execute:** the outer selector is `execTransaction` = `0x6a761202`. The inner step is the encapsulated `(to, value, data, operation)` quartet. Build `data` via `encodeFunctionData({ abi: execTransactionAbi, functionName: "execTransaction", args: [...] })`. The signature blob is assembled per RESEARCH §Pitfall 5 (lines 416-430) — sort `confirmations[]` ascending by `owner.toLowerCase()`, concat 65-byte ECDSA signatures.

**Refusal pre-flights pattern** (prepare_uniswap_v3_rebalance.ts:164-228) — sequence of guard `if` blocks each returning early with `errEnvelope("INVALID_INPUT", msg)`. For Phase 37: `confirmations.length < threshold` → `INSUFFICIENT_SIGNATURES`; any `v ∈ {0, 1}` in confirmations → `INVALID_SIGNATURE_MODE`; any signer no longer in `getOwners()` → `STALE_SIGNATURE`.

---

### `src/wallet/session-manager.ts` (modified — namespace methods)

**Existing line** (session-manager.ts:80):
```typescript
methods: ["eth_sendTransaction", "personal_sign"],
```

**For Phase 37:** extend to
```typescript
methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"],
```

That is the entire change. The surrounding `REQUIRED_NAMESPACES` const (lines 75-83) and the comment block at lines 56-72 stay byte-identical.

---

### `src/clients/safe-tx-service.ts` (modified — add `postSignature` POST method)

**Analog:** the existing GET method `getMultisigTransaction` in the same file (lines 552-621).

**Endpoint constant + 5-arm DU pattern** (already present in the file; mirror it):
```typescript
export type SafeTxResult =
  | { kind: "ok"; tx: SafeMultisigTransactionResponse }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string; retryAfterMs?: number }
  | { kind: "error"; message: string }
  | { kind: "unsupported-chain"; chainId: ChainId };
```

**For Phase 37 `postSignature`:** add the 6-arm DU per RESEARCH Example 3 (lines 658-664) — `{ kind: "ok" } | { kind: "duplicate" } | { kind: "not-found" } | { kind: "rate-limited" } | { kind: "error" } | { kind: "unsupported-chain" }`. The `duplicate` arm is the Tx Service's HTTP 200 idempotent re-post path (vs 201 = first post).

**HTTP request skeleton** (getMultisigTransaction:566-621 → adapt for POST):
```typescript
const endpoint = SAFE_TX_SERVICE_ENDPOINTS[input.chain];
if (!endpoint) return { kind: "unsupported-chain", chainId: input.chain };

if (agentSessionCallCount >= PER_SESSION_CALL_LIMIT) return ceilingExceededArm();
agentSessionCallCount += 1;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), SAFE_TX_SERVICE_TIMEOUT_MS);

try {
  const url = `${endpoint}/v1/multisig-transactions/${input.safeTxHash}/confirmations/`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ signature: input.signature }),
    signal: controller.signal,
  });
  /* 201 → ok ; 200 → duplicate ; 404 → not-found ; 429 → rate-limited ; else error */
} catch (err) {
  return networkErrorToArm(err);
} finally {
  clearTimeout(timer);
}
```

**Cache invalidation note:** RESEARCH Example 3 line 703-704 — drop `safeTxCache` entries for this safe (pending-tx reads stale after signature post). Match the convention. The `getPendingTransactions` results are NOT cached per the existing file's design (lines 460-470) — only `safeTxCache` needs invalidation.

**Body shape** is just `{ signature }` — server derives owner via ECDSA recovery server-side (RESEARCH §Topic 3 + serializers.py source).

---

### `src/chains/safe.ts` (modified — extend ABI + reader)

**Existing `safeSingletonAbi`** (safe.ts:59-65):
```typescript
export const safeSingletonAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] modules, address next)",
]);
```

**For Phase 37:** append two function fragments:
```typescript
  "function domainSeparator() view returns (bytes32)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
```

Named-return discipline (Pitfall 10) — `bytes32` returns don't need explicit names. The 10-arg signature mirrors RESEARCH §A5 (verified against safe-smart-account@v1.4.1 source).

**Sibling reader function** (safe.ts:78-93 — `getOnchainSafeInfo` is the template):
```typescript
export async function getOnchainSafeInfo(
  client: PublicClient,
  _chainId: ChainId,
  safe: Address,
): Promise<{ owners: readonly Address[]; threshold: bigint; nonce: bigint; version: string }> {
  const [owners, threshold, nonceVal, version] = await client.multicall({
    contracts: [
      { address: safe, abi: safeSingletonAbi, functionName: "getOwners" },
      /* … */
    ],
    allowFailure: false,
  });
  return { owners, threshold, nonce: nonceVal, version };
}
```

**For Phase 37:** add `getOnchainDomainSeparator(client, _chainId, safe): Promise<Hex>` using `client.readContract({ … functionName: "domainSeparator" })`. Wrap into `_safeChains` indirection at the bottom (safe.ts:137):
```typescript
export const _safeChains = { getOnchainSafeInfo, getEnabledModules, getOnchainDomainSeparator };
```

**ESM spy-affordance** (CLAUDE.md mandatory; safe.ts:128-137 doc-block already establishes the pattern).

---

### `src/tools/register-all.ts` (modified — 4 side-effect imports)

**Existing Safe block** (register-all.ts:117-118):
```typescript
import "./get_safe_positions.js";                    // Phase 36 Plan 36-02 (SAFE-01) — multi-chain Safe enumeration + on-chain cross-check + Tx Service drift detection
import "./get_safe_transaction.js";                  // Phase 36 Plan 36-02 (SAFE-02) — single Safe-tx detail + best-effort cached-ABI decode + operation discriminator
```

**For Phase 37:** append after line 118 (before `simulate_position_change.js` at line 119):
```typescript
import "./prepare_safe_tx_propose.ts";    // Phase 37 Plan 37-01 (SAFE-05) — Safe multisig tx propose + EIP-712 typed-data signing
import "./prepare_safe_tx_approve.ts";    // Phase 37 Plan 37-02 (SAFE-06) — Safe multisig tx approve (co-sign) + EIP-712 typed-data signing
import "./submit_safe_tx_signature.ts";   // Phase 37 Plan 37-02 (SAFE-07) — Safe Tx Service signature POST + ECDSA recovery + owner cross-check
import "./prepare_safe_tx_execute.ts";    // Phase 37 Plan 37-03 (SAFE-08) — Safe execTransaction (on-chain) + signature assembly + composite-tx preview
```

**Note** the existing imports use `.js` extensions in the side-effect imports — match that convention.

---

### `src/security/canonical-dispatch.ts` (NO MODIFICATION — Phase 37 is the first consumer)

**Existing Safe singleton arm** (canonical-dispatch.ts:207-220, 233-236):
```typescript
// Phase 36 — Plan 36-01. Safe Singleton dispatch allowlist arm. […]
const safeSingletonEntries: Address[] = getSafeSingletonAddresses(chainId);
/* … */
return new Set<Address>([
  /* … */
  ...safeSingletonEntries, // Phase 36
]);
```

**Existing `checkDispatchTarget`** (canonical-dispatch.ts:290-303):
```typescript
export function checkDispatchTarget(
  chainId: ChainId,
  to: Address,
): DispatchCheckResult {
  const checksummed = getAddress(to);
  const allowlist = CANONICAL_DISPATCH_TARGETS[chainId];
  if (allowlist.has(checksummed)) return { kind: "ok" };
  return { kind: "refused", chain: chainId, to: checksummed, allowlist: [...allowlist] };
}
```

**For Phase 37:** `prepare_safe_tx_execute` builds a `PreparedTxEvm` whose `tx.to` is the Safe Singleton. The Layer 0.5 gate in `preview_send.ts` (wired existing) already calls `checkDispatchTarget(chainId, tx.to)` and the Singleton-addresses arm (already populated) passes by construction. **Zero diff required** in this file.

---

### `src/tools/send_transaction.ts` (modified — STRUCTURED-REFUSAL on safe-typed-data)

**Existing `txType` discriminant routing** (send_transaction.ts:352-440):
```typescript
const txType = record.tx.txType ?? "evm";
const recomputed =
  txType === "solana"   ? computeSolanaPayloadFingerprint({ … })
  : txType === "tron"   ? computeTronPayloadFingerprint({ … })
  : txType === "btc"    ? computeBtcPayloadFingerprint( … )
  : txType === "litecoin" ? computeLtcPayloadFingerprint( … )
  : txType === "btc-lifi" ? _btcLifiFingerprint.computeBtcLifiPayloadFingerprint( … )
  : computePayloadFingerprint({ chainId: record.tx.chainId, … });
/* … drift check … */

if (txType === "solana")  return await sendTransactionSolanaBranch(record, handleArg);
if (txType === "tron")    return await sendTransactionTronBranch( … );
if (txType === "btc")     return await sendTransactionBtcBranch( … );
if (txType === "litecoin") return await sendTransactionLtcBranch( … );
if (txType === "btc-lifi") return await sendTransactionBtcLifiBranch( … );
```

**For Phase 37:** add a `txType === "safe-typed-data"` arm BEFORE the EVM fallthrough that returns a structured refusal:
```typescript
if (txType === "safe-typed-data") {
  const text = "error: send_transaction does not handle Safe typed-data handles. Use submit_safe_tx_signature to publish your signature to the Safe Tx Service. send_transaction is for on-chain EVM broadcasts only.";
  return {
    isError: true,
    content: [{ type: "text", text }],
    structuredContent: errEnvelope("WRONG_HANDLE_KIND", text.replace(/^error: /, "")),
  };
}
```

**Insertion site:** lines 411-415 (just above the `if (txType === "solana")` line, OR equivalently in the recompute switch above) — the executor's call which side. Following the existing precedent (each chain has both a recompute arm AND a dispatch arm), the cleanest insertion is BEFORE the recompute (handle-shape refusal precedes drift check). New `ErrorCode` value `WRONG_HANDLE_KIND` likely needs to be added to `src/signing/error-codes.ts` — executor checks.

**FROZEN-area note:** CONTEXT lock §"FROZEN-area zero-diff invariant" says `src/signing/send_transaction.ts` is UNTOUCHED in Plans 37-01 + 37-02. The modification above lands in **Plan 37-03** (which also touches `send_transaction` via the existing `PreparedTxEvm` path for execute — no new branches). Confirm with the planner. (Note: the file `src/signing/send_transaction.ts` does not exist — only `src/tools/send_transaction.ts`. CONTEXT.md has a path typo; the file under discussion is the tools file at line 122 of register-all.ts.)

---

### `test/signing-safe-tx-hash.test.ts` (NEW — Fixtures SAFE-A/B/C)

**Analog:** `test/signing-presign-hash.test.ts` — the entire 67-line file IS the template.

**Imports + fixture-pin pattern** (signing-presign-hash.test.ts:1-32):
```typescript
import { describe, expect, it } from "vitest";
import { keccak256, parseTransaction, serializeTransaction } from "viem";
import type { Address } from "viem";

import { computePresignHash } from "../src/signing/presign-hash.js";

const FIXTURE_C = {
  chainId: 1,
  nonce: 7,
  gas: 21000n,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 1_500_000_000n,
  to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
  value: 1000000000000000000n,
  data: "0x" as const,
};

describe("computePresignHash — PREP-04 + T-PRESIGN-1", () => {
  it("Fixture C → serialized + presignHash byte-for-byte", () => {
    const result = computePresignHash(FIXTURE_C);
    expect(result.serialized).toBe(
      "0x02f001078459682f008506fc23ac008252089470997970c51812dc3a010c7d01b50e0d17dc79c8880de0b6b3a764000080c0",
    );
    expect(result.presignHash).toBe(
      "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85",
    );
  });

  it("different inputs produce different hashes (sanity — catches constant-output bugs)", () => {
    const a = computePresignHash({ ...FIXTURE_C, value: 1000000000000000000n });
    const b = computePresignHash({ ...FIXTURE_C, value: 2000000000000000000n });
    expect(a.presignHash).not.toBe(b.presignHash);
  });
});
```

**For Phase 37:** three fixtures per CONTEXT §"Fixtures SAFE-A + SAFE-B + SAFE-C":
- SAFE-A: v1.3.0 call, hardcoded `0x…` literal.
- SAFE-B: v1.4.1 call, hardcoded `0x…` literal.
- SAFE-C: v1.3.0 delegatecall (operation=1), hardcoded `0x…` literal.
- Sanity test: different `safeVersion` (per RESEARCH §1) produces IDENTICAL digest — anchors the byte-identity finding.
- Sanity test: different `nonce` produces DIFFERENT digest.

**Anti-pattern reminder (CLAUDE.md):** NO `beforeAll`-snapshot. Hardcoded literal per fixture. Placeholder-literal workflow per the existing CRV fixtures (signing-fingerprint.test.ts:88-94):
```
(1) wrote with "0xPLACEHOLDER", (2) ran vitest, (3) copied actual fp,
(4) pinned literal, (5) re-ran — green.
```

---

### `test/signing-fingerprint.test.ts` (modified — add Fixture SAFE-D)

**Existing pattern** (signing-fingerprint.test.ts:91-117 — Fixture P + CRV exports):
```typescript
/** Fixture P (escape-hatch baseline, Phase 35 / Plan 35-03 / CUSTOM-01): […]
 *
 * EXPORTED so test/prepare-custom-call.test.ts + test/preview-send.custom-call.test.ts
 * + test/integration/escape-hatch.test.ts can cross-link. */
export const FIXTURE_P_FP = "0xb137028a94f1af0a98dc0f96102101ad4efc756784fa54dc0a8fc10d5a8a1701";
```

**For Phase 37:** add a new EXPORTED const after the existing FIXTURE_P_FP line:
```typescript
/** Fixture SAFE-D (Phase 37 / Plan 37-01 / SAFE-05):
 * `VaultPilot-safetx-v1:` payloadFingerprint over the SAFE-A SafeTx
 * (v1.3.0 call, deterministic inputs from test/signing-safe-tx-hash.test.ts).
 * Anchors the `chain(uint64 LE) || safeAddress(20) || safeVersion(string)
 * || safeTxHash(32) || nonce(uint256 BE) || operation(uint8) || to(20)
 * || value(uint256 BE) || keccak(data)(32)` preimage assembly.
 *
 * EXPORTED so test/prepare-safe-tx-propose.test.ts and
 * test/submit-safe-tx-signature.test.ts can cross-link. */
export const FIXTURE_SAFE_D_FP = "0x…";  // computed via placeholder-literal workflow
```

Plus an `it("Fixture SAFE-D — …", () => { … })` block invoking `computeSafeTxPayloadFingerprint({…})` and asserting byte-for-byte equality to `FIXTURE_SAFE_D_FP`.

---

### `test/prepare-safe-tx-propose.test.ts` (NEW — tool-level unit)

**Analog:** `test/prepare-custom-call.test.ts` (Phase 35 — not loaded in this context but mentioned in CONTEXT.md; same prepare-tool test shape).

**Pattern:** Use the registered tool handler via `registerTool` indirection (the handler returns `{ content, structuredContent }`). Stub on-chain reads via `_safeChains` spies (chains-safe.test.ts:189-220 establishes the pattern). Stub `safeTxService.getMultisigTransaction` if the propose tool needs to cross-check (it doesn't — propose is the first step).

**Key assertions:**
1. Happy path: returns `{ handle, safeTxHash, typedDataStructure, payloadFingerprint }` in `structuredContent`; PREPARE RECEIPT block in `content`; CHECKS PERFORMED block in `content`.
2. Cross-link to Fixture SAFE-A: invoke with the SAFE-A inputs and assert `structuredContent.safeTxHash === FIXTURE_SAFE_A_HASH`.
3. Cross-link to Fixture SAFE-D: assert `structuredContent.payloadFingerprint === FIXTURE_SAFE_D_FP`.
4. Refusal paths: pre-v1.3.0 Safe (UNSUPPORTED_SAFE_VERSION), unpaired wallet, non-owner sender.

---

### `test/prepare-safe-tx-approve.test.ts` (NEW — tool-level unit)

**Analog:** propose test (same shape) + Tx Service fetch stub via `vi.stubGlobal("fetch", …)` per Phase 36 convention.

**Pattern:**
1. Stub Tx Service `getMultisigTransaction` to return a fixture SafeTx (re-use `MULTISIG_TX_OK_FIXTURE` from `test/fixtures/safe-tx-service-responses.ts` — already exists per `test/clients-safe-tx-service.test.ts:34-46`).
2. Spy `_safeChains.getOnchainSafeInfo` + `_safeChains.getOnchainDomainSeparator` (the new Phase 37 reader).
3. Assert the re-derived `safeTxHash` matches the Tx Service's `safeTxHash` (cross-check anchor).
4. Refusal paths: `txServiceDrift`, duplicate-sign warning (wallet already in `confirmations[]`).

---

### `test/submit-safe-tx-signature.test.ts` (NEW — tool-level unit)

**Analog:** hybrid — fetch-stub pattern from `test/clients-safe-tx-service.test.ts` + handle-transition assertion from `test/send-transaction.test.ts` (file not loaded but well-established by the codebase).

**Fetch-stub pattern** (clients-safe-tx-service.test.ts:69-93):
```typescript
function buildFetch(opts: FetchOpts): ReturnType<typeof vi.fn> {
  return vi.fn(async (_input: unknown, init?: { signal?: AbortSignal }) => {
    if (opts.hang) { /* … timeout-via-abort path */ }
    if (opts.reject) throw opts.reject;
    return {
      ok: opts.ok ?? (opts.status === undefined || (opts.status >= 200 && opts.status < 300)),
      status: opts.status ?? 200,
      headers: { get: (name) => name.toLowerCase() === "retry-after" && opts.retryAfter !== undefined ? opts.retryAfter : null },
      json: async () => opts.payload,
    };
  });
}
```

**Setup/teardown pattern** (clients-safe-tx-service.test.ts:101-122):
```typescript
beforeEach(() => {
  _resetSafeTxServiceCachesForTesting();
  _resetSafeTxServiceRateCounterForTesting();
  /* save/clear SAFE_TX_SERVICE_API_KEY */
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetSafeTxServiceCachesForTesting();
  _resetSafeTxServiceRateCounterForTesting();
  /* restore env */
});
```

**Key assertions for submit:**
1. ECDSA recovery happy path: signature recovers to a paired-and-owner address → POST succeeds → handle transitions to "sent".
2. Recovery to non-paired address → INVALID_INPUT refusal (no POST).
3. Recovery to non-owner address → INVALID_INPUT refusal (no POST).
4. `v ∈ {0, 1}` signature → INVALID_SIGNATURE_MODE refusal.
5. `payloadFingerprint` drift between prepare and submit → PAYLOAD_FINGERPRINT_DRIFT.
6. Handle-not-found path: still proceeds with signer-recovery + on-chain owner check; surfaces `handleNotFound: true` informationally.
7. Tx Service 201 → `kind: "ok"`; 200 → `kind: "duplicate"`; 404 → `kind: "not-found"`.

---

### `test/prepare-safe-tx-execute.test.ts` (NEW — tool-level unit)

**Analog:** `test/prepare-custom-call.test.ts` for the prepare-tool shape + the composite-tx preview shape from Phase 33's `prepare_uniswap_v3_rebalance` tests (not loaded but the implementation file at `prepare_uniswap_v3_rebalance.ts:518-571` is the template for the CHECKS PERFORMED + composite preview assertions).

**Key assertions:**
1. Happy path 1-of-1: returns `PreparedTxEvm` handle whose `tx.to === Safe Singleton`, `tx.data` decodes as `execTransaction(...)` with the encapsulated `(to, value, data, operation)` quartet matching the input SafeTx.
2. Happy path 2-of-3: signatures sorted ascending by signer address; concat byte-equality verified.
3. Refusal: `confirmations.length < threshold` → INSUFFICIENT_SIGNATURES.
4. Refusal: any confirmation with `v ∈ {0, 1}` → INVALID_SIGNATURE_MODE.
5. Refusal: any signer no longer in `getOwners()` → STALE_SIGNATURE.
6. CHECKS PERFORMED block surfaces the encapsulated operation decoded.
7. `payloadFingerprint` uses existing `VaultPilot-txverify-v1:` tag (NOT the new safetx tag — execute IS a normal EVM tx).

---

### `test/integration/safe-three-step-flow.test.ts` (NEW — integration)

**Analog:** `test/integration/safe-positions.test.ts` (Phase 36 — head loaded above) — closest in-domain integration test.

**Stubbing strategy** (safe-positions.test.ts:1-29):
```typescript
// Stubbing strategy (per CLAUDE.md):
//   - Tx Service: `vi.stubGlobal("fetch", ...)` at the OUTER network boundary
//     (matches `src/clients/safe-tx-service.ts` test seam).
//   - On-chain reads: `vi.spyOn(_safeChains, "getOnchainSafeInfo")` +
//     `vi.spyOn(_safeChains, "getEnabledModules")` — the Task 1 ESM
//     indirection seam.
//   - Chain registry: vi.mock at module load time — same shape as
//     test/get-portfolio-summary.cross-chain.test.ts.
```

**For Phase 37:** the same stubbing strategy plus:
- Stub WalletConnect `signClient.request` to return canned ECDSA signatures for the typed-data calls.
- Stub `recoverAddress` is NOT needed (the real viem implementation runs deterministically against the canned signatures).
- Per RESEARCH Open Question 5: **two fixtures** — a 1-of-1 Safe (degenerate case; single signature) AND a 2-of-3 Safe (ascending-sort discipline + multi-signer assembly). Both in the same file.

**Flow:** propose → submit → approve × N (where N = threshold − 1) → submit × N → execute. Assert at each step:
- Handle store contains the expected handle.
- `payloadFingerprint` byte-identity across the propose-and-approve-co-derivation path.
- Tx Service POST body shape (just `{ signature }`).
- Final `execTransaction` calldata byte-identical to a hardcoded fixture.

---

### `test/clients-safe-tx-service.test.ts` (modified — add `postSignature` tests)

**Analog:** the same file's existing test matrix — `buildFetch` helper at lines 69-93 is the seam.

**Pattern:** extend the existing test groups with a new `describe("Safe Tx Service client — postSignature", ...)` block covering:
- 201 → `kind: "ok"`.
- 200 → `kind: "duplicate"` (idempotent re-post).
- 404 → `kind: "not-found"`.
- 429 → `kind: "rate-limited"` with `retryAfterMs` extracted.
- 5xx → `kind: "error"`.
- Unsupported chain → `kind: "unsupported-chain"` short-circuit without fetch.
- Per-session ceiling: 30 calls then 31st returns rate-limited without fetch.
- POST body shape: assert `{ signature: "0x…" }` (no `owner` field, no `signatureType` field).
- POST URL shape: assert `…/v1/multisig-transactions/{safeTxHash}/confirmations/` with the trailing slash (Django REST router requirement per RESEARCH §3).
- `Content-Type: application/json` header set.
- Cache invalidation: a pending-tx cache entry for the same safe is dropped after a successful POST.

---

## Shared Patterns

### Error envelope (every tool file)

**Source:** `src/signing/error-codes.ts` + the inline `errEnvelope` boilerplate replicated in every prepare/submit tool.

**Verbatim copy** (prepare_custom_call.ts:68-78):
```typescript
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<
    string,
    unknown
  > &
    StructuredError;
}
```

Apply to: every Phase 37 tool file.

### `handle-store` API

**Source:** `src/signing/handle-store.ts` (createHandle / lookup / transitionToPreviewed / transitionToSent / transitionToCancelled).

**For Phase 37:** propose + approve call `createHandle`; submit calls `lookup` (by handle ID) and `transitionToSent` (terminal). Execute calls `createHandle` (`PreparedTxEvm` shape) and the resulting handle flows through the existing `preview_send` + `send_transaction` pipeline unchanged.

Apply to: every prepare_* and submit tool file.

### ESM spy-affordance indirection (CLAUDE.md mandatory)

**Source:** `src/chains/safe.ts:128-137` (`_safeChains`); `src/security/canonical-dispatch.ts:305-315` (`_canonicalDispatch`); `src/signing/btc-lifi-fingerprint.ts` (`_btcLifiFingerprint`).

**For Phase 37:**
- `src/chains/safe.ts`: extend `_safeChains` to include `getOnchainDomainSeparator`.
- Phase 37 internal-call surfaces in NEW files: if propose/approve/execute call each other's helpers (e.g. `assembleSafeSignatures` exported from execute called by integration test), wrap in an `_<scope>` indirection at write-time.
- External network clients (`postSignature` in `safe-tx-service.ts`): stick with `vi.stubGlobal("fetch", …)` per CLAUDE.md ("For external network clients, prefer `vi.stubGlobal` at the network boundary over an internal indirection — the test seam is at the OUTER edge").

### Fixture pinning (CLAUDE.md mandatory)

**Source:** `test/signing-fingerprint.test.ts` (Fixture A/B/C/D/E/F/CRV-A/B/C/P) + `test/signing-presign-hash.test.ts` (Fixture C).

**For Phase 37:** Fixtures SAFE-A/B/C anchor `computeSafeTxHash`; Fixture SAFE-D anchors `computeSafeTxPayloadFingerprint`. NO `beforeAll`-snapshot. EXPORTED `const FIXTURE_SAFE_*_*` so consumer tests cross-link by import.

Apply to: `test/signing-safe-tx-hash.test.ts`, `test/signing-fingerprint.test.ts` (extension), and every consumer test (cross-link via `import { FIXTURE_SAFE_A_HASH, … } from "./signing-safe-tx-hash";`).

### viem typed-data + recovery (RESEARCH §"Don't Hand-Roll")

**For Phase 37:** `import { hashTypedData, recoverAddress, encodeFunctionData } from "viem";` — no hand-rolled EIP-712 encoder, no hand-rolled EC recovery, no hand-rolled ABI assembly. RESEARCH lines 357-367 enumerate the surface.

Apply to: `safe-tx-hash.ts`, `submit_safe_tx_signature.ts`, `prepare_safe_tx_execute.ts`.

---

## No Analog Found

None. Every Phase 37 file maps to a strong in-repo analog. The closest gap is `submit_safe_tx_signature.ts` — first POST-to-service tool — but the execution boundary fully decomposes into known patterns (Tx Service client invocation à la `get_safe_transaction`, `userDecision: "send"` schema gate à la `send_transaction`, handle-store transition à la `send_transaction`).

---

## Metadata

**Analog search scope:**
- `src/signing/` (every file inspected by directory listing; `presign-hash.ts`, `payload-fingerprint.ts`, `handle-store.ts` read in full)
- `src/tools/` (full listing; `prepare_custom_call.ts`, `send_transaction.ts` ranges, `prepare_uniswap_v3_rebalance.ts`, `get_safe_transaction.ts`, `register-all.ts` read)
- `src/chains/safe.ts` read in full
- `src/clients/safe-tx-service.ts` read in full
- `src/wallet/session-manager.ts` (REQUIRED_NAMESPACES section)
- `src/security/canonical-dispatch.ts` read in full
- `test/signing-presign-hash.test.ts` read in full
- `test/signing-fingerprint.test.ts` (Phase 35 / CRV / P fixture region)
- `test/clients-safe-tx-service.test.ts` (helper + setup/teardown region)
- `test/integration/safe-positions.test.ts` (stubbing-strategy preamble)
- `test/chains-safe.test.ts` (spy patterns)

**Files scanned:** 18 analog source/test files (read or targeted-grep) plus 6 directory listings.

**Pattern extraction date:** 2026-05-27
