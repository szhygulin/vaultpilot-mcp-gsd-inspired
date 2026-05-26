# Phase 35: evm-escape-hatch-custom-call-abi-read — Pattern Map

**Mapped:** 2026-05-26
**Files analyzed:** 14 (8 NEW + 6 MODIFIED)
**Analogs found:** 14 / 14 — every new/modified file has a strong in-tree analog

## File Classification

| File | Role | NEW / MOD / FROZEN-additive | Data Flow | Closest Analog | Match Quality |
|------|------|------------------------------|-----------|----------------|---------------|
| `src/tools/prepare_custom_call.ts` | tool (prepare_*) | NEW | request-response + handle-mint | `src/tools/prepare_native_send.ts` (+ `prepare_weth_unwrap.ts` for special-block emission) | exact-shape clone (mechanical) |
| `src/tools/get_contract_abi.ts` | tool (read) | NEW | request-response (DU return) | `src/tools/check_contract_security.ts` | exact (4-arm DU + Etherscan + chain enum) |
| `src/tools/read_contract.ts` | tool (read) | NEW | request-response (ABI-encode → eth_call → decode) | `src/tools/get_token_metadata.ts` (RPC-call shape) + `check_contract_security.ts` (ABI-fetch shape) | partial (compose of two analogs — most-novel file in the phase) |
| `src/security/canonical-alternatives.ts` | security data table + lookup | NEW | lookup table (selector → tool) | `src/security/canonical-dispatch.ts` + `KNOWN_SPENDERS_ETHEREUM` table in `src/config/contracts.ts:1056` | role-match (same "curated security table + 1-helper" shape) |
| `src/clients/etherscan.ts` | client | FROZEN-additive (chainid + new export) | network-fetch + cache + rate-limit | self (mirror existing `checkContractSecurity` shape for `fetchEtherscanAbi`) + `src/clients/fourbyte.ts` (never-throws contract) | exact — extend in place |
| `src/signing/blocks.ts` | template SOT | APPEND-ONLY | string templates | self (line 346 `WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE`, line 389 `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE`, line 868 `DISPATCH_TARGET_REFUSAL_TEMPLATE`) | exact — same APPEND-ONLY discipline |
| `src/signing/handle-store.ts` | record type | ADDITIVE-TYPE-SURFACE-ONLY | type defn | self (line 948 `HandleRecord` — append two `?:` fields) | exact — same pattern as `pinned?: PreviewPinned` |
| `src/signing/error-codes.ts` | enum SOT | APPEND-ONLY | type union | self (line 107 `ErrorCode` union — append 3 codes) | exact — every prior phase appends here |
| `src/tools/preview_send.ts` | tool (preview) | MOD (2 surgical insertions, EVM branch only) | dispatch | self (line 792-814 bypass branch; line 1040+ custom-call decode branch mirrors line 1235 Uniswap arm) | exact — bypass branch slots beside existing dispatch check |
| `src/tools/check_contract_security.ts` | tool (read) | MOD (lift v1.2 refusal) | request-response | self (line 105-122 v1.2 runtime refusal — DELETE; line 168 call site widens to pass `chainId`) | exact — free downstream effect |
| `src/tools/register-all.ts` | side-effect import list | APPEND-ONLY | static imports | self (lines 1-115 — append three imports) | exact — every phase appends 1-3 lines |
| `test/signing-fingerprint.test.ts` | test (cryptographic-binding fixtures) | APPEND-ONLY | hardcoded-literal assertion | self (Fixture A line 107, Fixture B line 120, Fixture D line 142, Fixture E line 165, Fixture F line 188) | exact — same `0x...` literal pattern, Fixture P appends |
| `test/integration/escape-hatch.test.ts` | integration test | NEW | end-to-end persona cycle | `test/erc20-lifecycle.integration.test.ts` (+ `aave-v3-lifecycle.integration.test.ts`) | exact — same shape (vi.hoisted spies + persona-cycle + Fixture-anchor) |
| `test/prepare-custom-call.test.ts` / `test/read-contract.test.ts` / `test/get-contract-abi.test.ts` / `test/preview-send.custom-call.test.ts` / `test/clients-etherscan-multichain.test.ts` / `test/security-canonical-alternatives.test.ts` | unit tests | NEW | unit assertions | `test/prepare-weth-unwrap.test.ts` / `test/get-token-metadata.test.ts` / `test/check-contract-security.test.ts` / `test/security-canonical-dispatch.test.ts` (line 1-80) / `test/fourbyte.test.ts` | exact per-tool analog |

---

## Pattern Assignments

### `src/tools/prepare_custom_call.ts` (NEW, prepare_* tool, request-response + handle-mint)

**Primary analog:** `src/tools/prepare_native_send.ts` (mechanical clone)
**Secondary analog:** `src/tools/prepare_weth_unwrap.ts` (emits a special block beside PREPARE RECEIPT)

**Imports pattern** (clone of `prepare_native_send.ts` lines 55-67; add 1 import for canonical-alternatives):
```typescript
import { type Address, type Hex, getAddress } from "viem";

import { chainIdFromName, type ChainName } from "../config/contracts.js";
import { lookupCanonicalAlternative } from "../security/canonical-alternatives.js"; // NEW
import {
  CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE,
  NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE,
  WARN_NON_PROTOCOL_TARGET_TEMPLATE,
} from "../signing/blocks.js";                                                     // NEW templates
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";    // FROZEN
import { resolveFrom } from "../signing/resolve-from.js";
import { registerTool } from "./index.js";
```

**`errEnvelope` helper** (verbatim from `prepare_native_send.ts:75-81`):
```typescript
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}
```

**INPUT_SCHEMA — JSON-Schema literal-true gate** (extend `prepare_native_send.ts:101-130` shape with `data` + `value?` + `acknowledgeNonProtocolTarget`):
```typescript
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"] },
    to:    { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    data:  { type: "string", pattern: "^0x[0-9a-fA-F]*$" },
    value: { type: "string", description: "WEI as decimal string. Default \"0\"." },
    acknowledgeNonProtocolTarget: { const: true, type: "boolean" }, // LITERAL — dispatch-boundary gate
    from:  { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
  },
  required: ["chain", "to", "data", "acknowledgeNonProtocolTarget"],
  additionalProperties: false,
};
```
**What's DIFFERENT vs `prepare_native_send.ts:101-130`:** adds `data` (hex regex), `value` optional decimal-string, AND the literal-true `acknowledgeNonProtocolTarget` gate. The JSON-Schema `{ const: true, type: "boolean" }` is THE load-bearing security boundary — defeats `acknowledgeNonProtocolTarget: false` at dispatch BEFORE the handler runs.

**Handler body — clone of `prepare_native_send.ts:132-279`, key deltas:**

1. **Refusal arm FIRST** (NEW — no analog in `prepare_native_send.ts`; closest precedent is the demo-mode short-circuit at top of every prepare tool):
```typescript
if (args.acknowledgeNonProtocolTarget !== true) {
  const selectorHex = (args.data as string).slice(0, 10) as Hex;
  const alternative = lookupCanonicalAlternative(selectorHex);
  const refusalText = NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE
    .replace("{TO}", String(args.to))
    .replace("{SELECTOR}", selectorHex)
    .replace("{SUGGESTION}", alternative
      ? `Use ${alternative.tool} instead (canonical-dispatch routed; ${alternative.reason}).`
      : "No canonical alternative recognized for this selector. If the user has explicitly confirmed they want to call this non-protocol contract, re-call with acknowledgeNonProtocolTarget: true.");
  return { isError: true, content: [{ type: "text", text: refusalText }], structuredContent: errEnvelope("NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED", refusalText) };
}
```

2. **`tx` build — clone of `prepare_weth_unwrap.ts:157-162` shape with agent-supplied `data`:**
```typescript
const tx: PreparedTxEvm = {
  chainId,
  to: getAddress(args.to as string),
  valueWei: BigInt((args.value as string | undefined) ?? "0"),
  data: args.data as Hex,
};
const payloadFingerprint = computePayloadFingerprint(tx);  // FROZEN — Fixture P anchor
```

3. **`createHandle` — extend `prepare_native_send.ts:235-239` with TWO new optional fields:**
```typescript
const handle = createHandle({
  args: { to: String(args.to), valueWei: String(args.value ?? "0"), data: String(args.data) },
  tx,
  payloadFingerprint,
  acknowledgeNonProtocolTarget: true,  // NEW — see handle-store.ts MOD
  preparedBy: "prepare_custom_call",    // NEW — selector for preview_send branch
});
```

4. **Response — TWO blocks (WARN above PREPARE RECEIPT)**, mirror of `prepare_weth_unwrap.ts` which emits a NOTICE in `preview_send` only; this tool emits the WARN at BOTH `prepare_custom_call` response AND `preview_send` response:
```typescript
const warnBlock = WARN_NON_PROTOCOL_TARGET_TEMPLATE
  .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
  .replace("{TO}", String(args.to))
  .replace("{DECODED}", /* best-effort decode from per-session ABI cache, or "(no ABI cached — call get_contract_abi first)" */);
const receipt = CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE
  .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
  .replace("{TO}", String(args.to))
  .replace("{VALUE}", String(args.value ?? "0"))
  .replace("{DATA}", String(args.data));
return {
  content: [{ type: "text", text: [warnBlock, receipt].join("\n\n") }],
  structuredContent: { handle, chain: chainName, chainId, from: fromAddress, to: args.to, value: args.value ?? "0", data: args.data, payloadFingerprint, acknowledgeNonProtocolTarget: true },
};
```

**Grep-guard test surface:** the line `acknowledgeNonProtocolTarget: true` must appear in exactly TWO places in `src/`: this file AND the `HandleRecord` defn in `handle-store.ts`. Test asserts via filesystem grep.

---

### `src/tools/get_contract_abi.ts` (NEW, read tool, request-response DU)

**Primary analog:** `src/tools/check_contract_security.ts`

**Imports pattern** (verbatim shape from `check_contract_security.ts:21-32`):
```typescript
import { type Address, getAddress, isAddress } from "viem";

import { fetchEtherscanAbi } from "../clients/etherscan.js";    // NEW export
import { chainIdFromName, type ChainName } from "../config/contracts.js";
import { getEtherscanApiKey } from "../config/env.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";
```

**INPUT_SCHEMA** (verbatim from `check_contract_security.ts:47-65`):
```typescript
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"], description: "Chain identifier (required)." },
    address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Contract address (0x-prefixed)." },
  },
  required: ["chain", "address"],
  additionalProperties: false,
};
```

**Handler body — 4-arm DU return** (mirror of `check_contract_security.ts:90-225` shape, COLLAPSED — only 4 arms not 5; no `not-applicable` since ABI fetch is always applicable):
```typescript
const chainName = args.chain as ChainName;
const chainId = chainIdFromName(chainName);
// NOTE: NO v1.2 chainId !== 1 refusal here — Phase 35 ships multi-chain natively.
const address: Address = getAddress(addressRaw);
const apiKey = getEtherscanApiKey();
if (apiKey === undefined) return /* INTERNAL_ERROR with signup URL — verbatim from check_contract_security.ts:148-166 */;

const result = await fetchEtherscanAbi(chainId, address, apiKey);

if (result.kind === "rate-limited") return /* INTERNAL_ERROR cause "rate-limit" — verbatim shape from check_contract_security.ts:170-178 */;
if (result.kind === "error")        return /* INTERNAL_ERROR cause "etherscan-unreachable" — verbatim shape from check_contract_security.ts:180-191 */;
if (result.kind === "not-verified") return { content: [{ type: "text", text: `${address}: NOT verified on Etherscan.` }], structuredContent: { chain: chainName, chainId, address, verified: false } };
// kind === "ok"
return {
  content: [{ type: "text", text: `${address}: verified. ABI fetched (${result.abi.length} entries). Source: ${result.sourceCodeUrl}` }],
  structuredContent: { chain: chainName, chainId, address, verified: true, abi: result.abi, sourceCodeUrl: result.sourceCodeUrl },
};
```

**What's DIFFERENT vs `check_contract_security.ts`:** (a) NO v1.2 ethereum-only refusal at the top (multi-chain from day one); (b) calls `fetchEtherscanAbi` not `etherscanCheckContractSecurity`; (c) 4-arm DU (no `not-applicable`); (d) success arm surfaces `abi` + `sourceCodeUrl` not the privileged-role decomposition.

---

### `src/tools/read_contract.ts` (NEW, read tool, ABI-driven eth_call) — MOST NOVEL FILE

**Primary analog:** `src/tools/get_token_metadata.ts` (RPC-call shape — `getChainClient` + `client.readContract`)
**Secondary analog:** `src/tools/check_contract_security.ts` (ABI-fetch error arms)

**There is no exact analog** — `read_contract` composes ABI fetch + viem encode + low-level `publicClient.call` + decode. The two analogs cover the two halves; the composition is novel.

**Imports** (compose from both analogs):
```typescript
import { type Address, type Hex, encodeFunctionData, decodeFunctionResult, getAddress, isAddress } from "viem";

import { getChainClient } from "../chains/registry.js";                          // FROM get_token_metadata.ts:21
import { fetchEtherscanAbi } from "../clients/etherscan.js";                     // FROM (new) check_contract_security analog
import { chainIdFromName, type ChainName } from "../config/contracts.js";        // FROM get_token_metadata.ts:22
import { getEtherscanApiKey } from "../config/env.js";                           // FROM check_contract_security.ts:30
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";
```

**INPUT_SCHEMA** (extend `get_token_metadata.ts:35-53` shape with `functionName` + `args`):
```typescript
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain:        { type: "string", enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"] },
    address:      { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    functionName: { type: "string", description: "Name of the view/pure function on the contract." },
    args:         { type: "array",  items: {}, default: [] },
  },
  required: ["chain", "address", "functionName"],
  additionalProperties: false,
};
```

**Handler body — compose ABI fetch + view-gate + viem `call({ to, data })`:**
```typescript
// 1. ABI fetch — same 4-arm DU handling as get_contract_abi.ts; NO blind-call fallback.
const abiResult = await fetchEtherscanAbi(chainId, address, apiKey);
if (abiResult.kind === "not-verified") return /* INTERNAL_ERROR with verbatim "Contract source code not verified" */;
if (abiResult.kind === "rate-limited") return /* same INTERNAL_ERROR/rate-limit shape as check_contract_security.ts:170-178 */;
if (abiResult.kind === "error")        return /* same INTERNAL_ERROR/etherscan-unreachable shape */;
const abi = abiResult.abi;

// 2. View-gate — NEW (no analog; locked spec).
const entry = abi.find((e) => e.type === "function" && e.name === args.functionName);
if (!entry) return /* INTERNAL_ERROR ABI_NOT_AVAILABLE "function not found in ABI" */;
if (entry.stateMutability !== "view" && entry.stateMutability !== "pure") {
  return { isError: true, content: [{ type: "text", text: `error: read_contract refuses non-view function "${args.functionName}" (stateMutability: ${entry.stateMutability}). Use prepare_custom_call for state-mutating calls.` }],
           structuredContent: makeStructuredError("NON_VIEW_FUNCTION", `function ${args.functionName} is ${entry.stateMutability}; not callable via read_contract`) };
}

// 3. Encode → call → decode. Pattern from get_token_metadata.ts:116-122 with low-level
//    publicClient.call (NOT readContract) for fine-grained error-arm control.
const data = encodeFunctionData({ abi, functionName: args.functionName, args: args.args ?? [] });
const client = getChainClient(chainId);
try {
  const { data: returnData } = await client.call({ to: address, data });
  const decoded = decodeFunctionResult({ abi, functionName: args.functionName, data: returnData ?? "0x" });
  return { content: [{ type: "text", text: `${address}.${args.functionName}() → ${JSON.stringify(decoded, (_, v) => typeof v === "bigint" ? v.toString() : v)}` }],
           structuredContent: { chain: chainName, chainId, address, functionName: args.functionName, decoded, sourceCodeUrl: abiResult.sourceCodeUrl } };
} catch (err) {
  // Pattern from get_token_metadata.ts:134-151 — INTERNAL_ERROR with verbatim message.
}
```

**What's DIFFERENT:**
- Uses LOW-LEVEL `publicClient.call({ to, data })` not `readContract` — explicit per CONTEXT (fine-grained error-arm control).
- Refuses non-view at runtime via `entry.stateMutability` inspection — NEW gate, no analog.
- NO blind-call fallback if ABI fetch fails — surface the verbatim refusal.

---

### `src/security/canonical-alternatives.ts` (NEW, security lookup table)

**Primary analog:** `src/security/canonical-dispatch.ts` (lines 1-298) — same "curated security table + 1 helper + ESM spy-affordance" shape
**Secondary analog:** `KNOWN_SPENDERS_ETHEREUM` in `src/config/contracts.ts:1056-1180` — same per-row `{ address/selector, label, source }` shape

**Imports + table shape — clone of `KNOWN_SPENDERS_ETHEREUM` (contracts.ts:1056-1180) for the row shape; clone of `canonical-dispatch.ts` for the lookup-helper + spy-affordance pattern:**
```typescript
import type { Hex } from "viem";

/**
 * Selector → canonical-tool routing table. NOT a widening of KNOWN_SPENDERS_ETHEREUM
 * (which is per-address labels for approval UI). This table maps 4-byte function
 * SELECTORS to the protocol-aware prepare_* tool that handles them.
 *
 * Each row: `{ selector, tool, reason }`. Multi-match arms allowed (selector
 * collision case — see Open Question 2 in 35-RESEARCH.md).
 */
export interface CanonicalAlternative {
  selector: Hex;     // 0x-prefixed 8-hex (4 bytes)
  tool: string;      // "prepare_aave_supply" etc.
  reason: string;    // human-readable rationale
}

export const CANONICAL_ALTERNATIVES: readonly CanonicalAlternative[] = [
  // Aave V3 Pool
  { selector: "0x617ba037", tool: "prepare_aave_supply",   reason: "Aave V3 Pool.supply(asset, amount, onBehalfOf, referralCode)" },
  { selector: "0x69328dec", tool: "prepare_aave_withdraw", reason: "Aave V3 Pool.withdraw(asset, amount, to)" },
  // ERC-20
  { selector: "0xa9059cbb", tool: "prepare_token_send",    reason: "ERC-20 transfer(to, amount)" },
  { selector: "0x095ea7b3", tool: "prepare_token_approve", reason: "ERC-20 approve(spender, amount)" },
  // WETH9
  { selector: "0x2e1a7d4d", tool: "prepare_weth_unwrap",   reason: "WETH9.withdraw(amount)" },
  // Lido / Compound / Morpho / EigenLayer / Rocket Pool / Uniswap V3 / Curve — populate per audit
];

export function lookupCanonicalAlternative(selector: Hex): CanonicalAlternative | null {
  const normalized = selector.toLowerCase();
  const match = CANONICAL_ALTERNATIVES.find((c) => c.selector.toLowerCase() === normalized);
  return match ?? null;
}

// ESM spy-affordance (mirror of canonical-dispatch.ts:298)
export const _canonicalAlternatives = { lookupCanonicalAlternative };
```

**What's DIFFERENT vs `canonical-dispatch.ts`:** (a) keyed by 4-byte selector not address; (b) target is a tool name (string), not a Set membership predicate; (c) much smaller — pure static data, no per-chain composition.

**Open Question 2 (RESEARCH §) — selector collision handling:** if two entries share a selector, audit at write-time and EITHER return both as an array OR disambiguate via a secondary `recipient` check. Plan-checker assertion: regression test (`test/security-canonical-alternatives.test.ts`) ensures no selector maps to >1 entry unless disambiguated.

---

### `src/clients/etherscan.ts` (FROZEN-additive: chainid widening + new export `fetchEtherscanAbi` + per-session ABI cache)

**Primary analog:** the file itself + `src/clients/fourbyte.ts` (lines 30-167) for the never-throws / 4-arm DU / LRU pattern

**Three coordinated changes:**

1. **Cache-key widening** (current line 89): `Map<Address, EtherscanResult>` → `Map<string, EtherscanResult>` keyed by `${chainId}:${address}`. The same plan widens the consumer call site (line 168 of `check_contract_security.ts`).

2. **`chainid=N` parameter** (current lines 217-218 — `chainid=1` hardcoded): introduce a `ChainId` first-positional parameter to `checkContractSecurity` and substitute in the URL template.

3. **NEW `fetchEtherscanAbi` export** — mirror the `fetchSelector` shape from `fourbyte.ts:69-148` with the never-throws contract:

```typescript
// NEW — append to etherscan.ts. Mirror of fourbyte.ts:38-42 4-arm DU + cache shape.
export type EtherscanAbiResult =
  | { kind: "ok"; abi: Abi; rawAbiJson: string; sourceCodeUrl: string }
  | { kind: "not-verified" }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

const abiCache = new Map<string, EtherscanAbiResult>();  // keyed by `${chainId}:${address}`

export async function fetchEtherscanAbi(chainId: ChainId, address: Address, apiKey: string): Promise<EtherscanAbiResult> {
  const cacheKey = `${chainId}:${address}`;
  const cached = abiCache.get(cacheKey);
  if (cached) return cached;

  // Shared rate counter with checkContractSecurity (Etherscan V2 enforces per-API-key,
  // not per-chain) — Pattern from etherscan.ts:204-210.
  if (agentSessionCallCount >= PER_SESSION_CALL_LIMIT) {
    return { kind: "rate-limited", message: `per-session limit (${PER_SESSION_CALL_LIMIT} calls) exceeded; resets at MCP server restart.` };
  }
  agentSessionCallCount += 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ETHERSCAN_TIMEOUT_MS);
  const url = `${ETHERSCAN_API_URL}?chainid=${chainId}&apikey=${apiKey}&module=contract&action=getabi&address=${address}`;
  // ... fetch + parse `status === "1"` (ok) / `status === "0" && result === "Contract source code not verified"` (not-verified) / other → error
  // ... mirror of etherscan.ts:221-355 never-throws scaffolding.
}

export function _resetEtherscanAbiCacheForTesting(): void {
  abiCache.clear();
}
```

**Per-chain explorer URL table** (inline in `etherscan.ts` per RESEARCH § A9 — NOT in `src/config/contracts.ts`):
```typescript
function buildSourceCodeUrl(chainId: ChainId, address: Address): string {
  switch (chainId) {
    case 1:     return `https://etherscan.io/address/${address}#code`;
    case 42161: return `https://arbiscan.io/address/${address}#code`;
    case 137:   return `https://polygonscan.com/address/${address}#code`;
    case 8453:  return `https://basescan.org/address/${address}#code`;
    case 10:    return `https://optimistic.etherscan.io/address/${address}#code`;
    default:    return `https://etherscan.io/address/${address}#code`;
  }
}
```

**Coordination note:** this file is touched by BOTH Plan 35-01 (Etherscan extension + chainid widening) AND Plan 35-02 (read_contract consumes `fetchEtherscanAbi`). Plan 35-01 lands first; 35-02 only IMPORTS the new export. No write collision.

---

### `src/signing/blocks.ts` (APPEND-ONLY — three new templates)

**Primary analog:** lines 346-352 (`WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE`), 389-400 (`LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE`), 868-886 (`DISPATCH_TARGET_REFUSAL_TEMPLATE`)

**Three templates to APPEND at end-of-file (mirror byte-discipline at line 868):**

1. **`WARN_NON_PROTOCOL_TARGET_TEMPLATE`** — mirror of `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` shape (lines 389-400):
```typescript
export const WARN_NON_PROTOCOL_TARGET_TEMPLATE: string = [
  "[WARN — NON-PROTOCOL TARGET]",
  "  chain:    {CHAIN}",
  "  to:       {TO}",
  "  decoded:  {DECODED}",
  "",
  "  This call BYPASSES the canonical-dispatch allowlist. You explicitly",
  "  acknowledged this at prepare time (acknowledgeNonProtocolTarget: true).",
  "  If unsure, decline on-device.",
].join("\n");
```

2. **`CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE`** — mirror of `WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE` shape (lines 346-352):
```typescript
export const CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  operation: custom contract call",
  "  chain:     {CHAIN}",
  "  to:        {TO}",
  "  value:     {VALUE}",
  "  data:      {DATA}",
].join("\n");
```

3. **`NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE`** — mirror of `DISPATCH_TARGET_REFUSAL_TEMPLATE` shape (lines 868-886):
```typescript
export const NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE: string = [
  "NON-PROTOCOL TARGET — acknowledgment required",
  "  to:        {TO}",
  "  selector:  {SELECTOR}",
  "",
  "  prepare_custom_call requires acknowledgeNonProtocolTarget: true because",
  "  it BYPASSES the canonical-dispatch allowlist.",
  "",
  "  {SUGGESTION}",
].join("\n");
```

**Coordination note:** APPEND-ONLY. Existing 35+ templates BYTE-FROZEN. Each template touches a distinct end-of-file region — no source-line collision with prior Phase 33 / 34 appends.

---

### `src/signing/handle-store.ts` (ADDITIVE-TYPE-SURFACE-ONLY)

**Primary analog:** self (line 948-966) — same shape as `pinned?: PreviewPinned` (line 955) + `sentAt?: number` (line 956)

**Add two OPTIONAL fields to `HandleRecord`:**
```typescript
export interface HandleRecord {
  handle: string;
  args: PrepareArgs;
  tx: PreparedTx;
  payloadFingerprint: Hex;
  status: HandleStatus;
  createdAt: number;
  pinned?: PreviewPinned;
  sentAt?: number;
  txHash?: string;
  cancelledAt?: number;
  acknowledgeNonProtocolTarget?: true;  // NEW — set ONLY by prepare_custom_call.ts
  preparedBy?: string;                  // NEW — "prepare_custom_call" enables preview_send branch
}
```

**Extend `createHandle` signature** (lines 991-1007) to accept the two NEW optional fields and copy onto the record:
```typescript
export function createHandle(input: {
  args: PrepareArgs;
  tx: PreparedTx;
  payloadFingerprint: Hex;
  acknowledgeNonProtocolTarget?: true;  // NEW
  preparedBy?: string;                   // NEW
}): string {
  const record: HandleRecord = {
    /* existing fields */,
    ...(input.acknowledgeNonProtocolTarget && { acknowledgeNonProtocolTarget: true }),
    ...(input.preparedBy && { preparedBy: input.preparedBy }),
  };
  /* ... */
}
```

**FROZEN constraints preserved:** state machine + TTL + `transitionToPreviewed` / `transitionToSent` / `lookup` ALL UNCHANGED. Type-surface widening only.

---

### `src/signing/error-codes.ts` (APPEND-ONLY — three new codes)

**Primary analog:** self (line 107 `ErrorCode` union — every prior phase appends here)

**Append three codes to the union** (mirror of `LIDO_STAKE` / `BTC_DUST_OUTPUT` / etc. additive style):
```typescript
export type ErrorCode =
  | /* ... 50+ existing codes ... */
  | "NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED"  // Plan 35-03 — prepare_custom_call missing ack flag
  | "NON_VIEW_FUNCTION"                      // Plan 35-02 — read_contract refuses state-mutating function
  | "ABI_NOT_AVAILABLE";                     // Plan 35-02 — read_contract / get_contract_abi ABI fetch failure
```

---

### `src/tools/preview_send.ts` (MOD — two surgical insertions, EVM block only)

**Primary analog:** self — lines 792-814 (existing dispatch-check at the EXACT site to add bypass) + lines 1235-1280 (Uniswap V3 SwapRouter02 DECODED ARGS arm as the model for the new custom-call decode arm)

**Insertion 1 — Bypass branch at lines 792-814** (THE SINGLE LOAD-BEARING SURGICAL EDIT for the escape hatch):

CURRENT (lines 792-814):
```typescript
if (record.tx.data !== "0x") {
  const dispatchCheck = _canonicalDispatch.checkDispatchTarget(
    record.tx.chainId as ChainId,
    record.tx.to,
  );
  if (dispatchCheck.kind === "refused") {
    // ... DISPATCH_TARGET_REFUSED refusal ...
  }
}
```

AFTER:
```typescript
if (record.tx.data !== "0x") {
  if (record.acknowledgeNonProtocolTarget === true) {
    // Phase 35 escape hatch — bypass canonical-dispatch.
    // Set ONLY by prepare_custom_call.ts (grep-guard test enforces).
    // The WARN block emits below in the custom-call branch — defense-in-depth.
  } else {
    const dispatchCheck = _canonicalDispatch.checkDispatchTarget(
      record.tx.chainId as ChainId,
      record.tx.to,
    );
    if (dispatchCheck.kind === "refused") {
      // ... existing DISPATCH_TARGET_REFUSED refusal UNCHANGED ...
    }
  }
}
```

**CRITICAL — Pitfall 1 from RESEARCH:** the bypass branch fires ONLY at the EVM dispatch site (lines 792-814). The Solana / TRON / BTC dispatch sites (lines 2082, 2811, 2933) MUST NOT read `record.acknowledgeNonProtocolTarget`. Plan-checker: `grep -c "acknowledgeNonProtocolTarget" src/tools/preview_send.ts` → exactly 1.

**Insertion 2 — Custom-call DECODED ARGS branch** (mirror of the Uniswap V3 arm at lines 1235-1280):
```typescript
// Phase 35 Plan 35-03 — prepare_custom_call DECODED ARGS arm.
// Mirror of the Uniswap V3 tuple-dispatch arm (lines 1235-1280): selector on
// record.preparedBy === "prepare_custom_call" instead of (tx.to, selector).
if (record.preparedBy === "prepare_custom_call") {
  const cacheKey = `${record.tx.chainId}:${record.tx.to}`;
  const cachedAbi = /* look up per-session ABI cache via fetchEtherscanAbi cache-hit-only API (no network) */;
  const decodeBlock = cachedAbi
    ? renderCustomCallDecodeBlock(cachedAbi, record.tx.data)  // viem.decodeFunctionData
    : `Blind sign — no ABI available. The selector 0x${record.tx.data.slice(2, 10)} is shown on-device.`;
  const warnBlock = WARN_NON_PROTOCOL_TARGET_TEMPLATE
    .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
    .replace("{TO}", record.tx.to)
    .replace("{DECODED}", cachedAbi ? "(see DECODED ARGS below)" : "(no ABI cached — call get_contract_abi first)");
  // PREPEND warnBlock to the response text-array.
  // INSERT decodeBlock into the CHECKS PERFORMED region.
}
```

**Coordination note for wave-vs-sequential:** the `acknowledgeNonProtocolTarget` field on `HandleRecord` and the `preparedBy` field BOTH need to land in Plan 35-03 (`prepare_custom_call`) BEFORE Insertion 1 + 2 can be authored. Plan 35-01 and 35-02 do NOT touch `preview_send.ts`. Therefore **35-02 ∥ 35-03 is SAFE for `preview_send.ts` writes** — only 35-03 touches the file.

---

### `src/tools/check_contract_security.ts` (MOD — lift v1.2 refusal + thread chainId)

**Primary analog:** self

**Two surgical edits:**

1. **DELETE lines 105-122** (the `chainId !== 1` v1.2 runtime refusal block).
2. **MODIFY line 168** — thread `chainId` through:
```typescript
// Before:
const result = await etherscanCheckContractSecurity(address, apiKey);
// After:
const result = await etherscanCheckContractSecurity(chainId, address, apiKey);
```

**Free downstream effect.** Locked in CONTEXT — same plan that widens the client also widens this consumer.

---

### `src/tools/register-all.ts` (APPEND-ONLY)

**Primary analog:** self (lines 1-114 — every prior phase appends 1-3 lines)

**Append three imports** (between lines 5 and 6, or just append at the end of the prepare-tool block ~line 114):
```typescript
import "./get_contract_abi.js";   // Phase 35 Plan 35-01 (CUSTOM-02)
import "./read_contract.js";      // Phase 35 Plan 35-02 (CUSTOM-03)
import "./prepare_custom_call.js";// Phase 35 Plan 35-03 (CUSTOM-01)
```

**Coordination note for wave-vs-sequential:** THIS FILE IS A SHARED EDIT across 35-01 / 35-02 / 35-03. Each plan adds ONE import line. The lines are NON-OVERLAPPING (3 distinct new lines, each at end-of-block per convention). **If 35-02 ∥ 35-03 run in parallel they BOTH touch `register-all.ts`** — git will likely auto-merge (different lines), but to be safe:
- **Option A (safer):** strict sequential 35-01 → 35-02 → 35-03.
- **Option B (parallel-safe):** 35-02 ∥ 35-03 with each appending its own line at EOF of the prepare-tool block; rebase resolution is trivial (both lines kept).

Given the other file already coordinated above (`preview_send.ts` is 35-03-only), recommendation is **35-02 ∥ 35-03 with Option B coordination** — but the executor should be told to expect a 1-line rebase conflict on `register-all.ts`.

---

### `test/signing-fingerprint.test.ts` (APPEND-ONLY — Fixture P)

**Primary analog:** self — Fixtures A (line 107), B (line 120), D (line 142), E (line 165), F (line 188), G (line 210), H (line 237), CRV-A (line 94), CRV-B (line 99), CRV-C (line 104), etc.

**Append Fixture P** (mirror of Fixture F at line 188-208 — the WETH9.withdraw fixture is the closest single-call-with-data analog):
```typescript
it("Fixture P — prepare_custom_call escape-hatch baseline (hardcoded literal anchor, Phase 35 / Plan 35-03)", () => {
  // Same shape as Fixture B/D/E/F — `payloadFingerprint` over PREP-03 envelope
  // (chainId || to || valueWei || data). NO escape-hatch-specific dimension —
  // the bypass flag lives on the record, NOT in the preimage. This fixture
  // verifies byte-identity with the existing PREP-03 envelope shape.
  const TO = "0x0000000000000000000000000000000000DeaDBeef" as Address;
  // Arbitrary calldata — any non-canonical contract call shape works.
  const escapeData = "0xdeadbeef" as Hex;
  const fp = computePayloadFingerprint({ chainId: 1, to: TO, valueWei: 0n, data: escapeData });
  // Write-time placeholder workflow: (1) put "0xPLACEHOLDER", (2) run test, (3) copy actual.
  expect(fp).toBe("0x<computed-at-write-time>");
});
```

**Cross-link from:** `test/prepare-custom-call.test.ts`, `test/preview-send.custom-call.test.ts`, `test/integration/escape-hatch.test.ts` (mirror of how Fixture D is cross-linked from prepare-token-send / preview-send.erc20 / erc20-lifecycle.integration).

---

### `test/integration/escape-hatch.test.ts` (NEW — end-to-end persona cycle)

**Primary analog:** `test/erc20-lifecycle.integration.test.ts` (482 lines, persona cycle for ERC-20 lifecycle)
**Secondary analog:** `test/aave-v3-lifecycle.integration.test.ts` (similar shape for Aave)

**Imports + vi.hoisted spies** (verbatim from `erc20-lifecycle.integration.test.ts:29-103`):
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockPublicClient,
  type MockPublicClient,
} from "./helpers/mock-public-client.js";
import {
  createMockSignClient,
  type MockSignClient,
} from "./helpers/mock-sign-client.js";

const { getStatusSpy, getActiveSessionTopicSpy, mockPublicHolder, mockSignClientHolder } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getActiveSessionTopicSpy: vi.fn<[], string | null>(),
  mockPublicHolder: { current: null as MockPublicClient | null },
  mockSignClientHolder: { current: null as MockSignClient | null },
}));

vi.mock("../src/wallet/session-manager.js", async () => { /* identical to lines 52-65 */ });
vi.mock("../src/wallet/walletconnect-client.js", async () => { /* identical to lines 67-80 */ });
vi.mock("viem/actions", async () => { /* identical to lines 82-103 — adds `call` spy */ });
```

**Test scaffolding** (verbatim from lines 105-198 of erc20-lifecycle):
- `_resetHandleStoreForTesting` import
- `await import("../src/tools/register-all.js")` side-effect
- `DEMO_KEY = "VAULTPILOT_DEMO"` toggle
- FIXTURE_NONCE / FIXTURE_GAS / FIXTURE_MAX_FEE / FIXTURE_MAX_PRIO RPC pins
- `callTool` helper (auto-injects `chain: "ethereum"` on `prepare_*` + `get_*` + `simulate_*` + `check_*`)
- `personaAddress` helper
- `PERSONAS_UNDER_TEST` array (whale + stable-saver + defi-degen)
- `beforeEach` + `afterEach` reset blocks

**Five test cases** — mirror the structure of erc20-lifecycle.integration.test.ts lines 205-482:

1. **Happy path under whale** — `get_contract_abi → prepare_custom_call(ack: true) → preview_send (decoded args from cache) → send_transaction (demo simulation); Fixture P fingerprint holds; signClient.request at 0 calls.**

2. **Schema gate refusal** — `prepare_custom_call({ acknowledgeNonProtocolTarget: false, ... })` → structured refusal with `NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED`; refusal text mentions canonical alternative when selector matches.

3. **WARN byte-identity** — prepare response WARN block === preview response WARN block (byte-identical). Drift = tamper signal.

4. **ABI cache miss at preview** — `prepare_custom_call` without prior `get_contract_abi` → preview surfaces `Blind sign — no ABI available. The selector 0xXXXXXXXX is shown on-device.`

5. **Persona-cycle `from`-independence** (mirror of lines 350-482 of erc20-lifecycle):
   - same `(chain, to, data, value)` from whale → Fixture P fingerprint.
   - same args from stable-saver → SAME Fixture P fingerprint (proves from-independent).
   - same args from defi-degen → SAME Fixture P fingerprint.
   - Cross-link: anchored against Fixture P from `signing-fingerprint.test.ts`.

6. **Grep-guard test** (cross-cutting — could live here or in a dedicated `test/prepare-custom-call.test.ts`):
   - read `src/**/*.ts` recursively; grep for `acknowledgeNonProtocolTarget: true` and `acknowledgeNonProtocolTarget = true` assignments; assert exactly TWO hits: `src/tools/prepare_custom_call.ts` AND `src/signing/handle-store.ts` (type defn).

7. **Non-EVM bypass-flag leak negative test** — synthetic Solana / TRON handle with `acknowledgeNonProtocolTarget: true` should NOT bypass canonical-dispatch-solana / canonical-dispatch-tron (because those branches don't read the flag).

---

### Unit tests — NEW (per-tool, mirror existing unit tests)

| New test file | Closest analog | What's UNIQUE |
|---------------|----------------|---------------|
| `test/prepare-custom-call.test.ts` | `test/prepare-weth-unwrap.test.ts` | schema gate (ack: false → dispatch-boundary refusal); ack: true → handle minted with `acknowledgeNonProtocolTarget: true`; PREPARE RECEIPT + WARN block byte-identity; canonical-alternative suggestion in refusal text |
| `test/get-contract-abi.test.ts` | `test/check-contract-security.test.ts` | 4-arm DU per kind: `ok` / `not-verified` / `rate-limited` / `error`; multi-chain (chainId 1 + 42161 + 137 + 8453 + 10) |
| `test/read-contract.test.ts` | `test/get-token-metadata.test.ts` | view/pure happy path; non-view stateMutability refusal → `NON_VIEW_FUNCTION`; ABI-not-verified → `INTERNAL_ERROR` verbatim; cache HIT vs MISS |
| `test/preview-send.custom-call.test.ts` | `test/preview-send.dispatch-allowlist.test.ts` (DISPATCH_TARGET_REFUSED tests) | bypass branch fires when `acknowledgeNonProtocolTarget: true`; WARN block emitted; decode HIT vs MISS branches |
| `test/clients-etherscan-multichain.test.ts` | `test/clients-etherscan.test.ts` (existing — extend) + `test/fourbyte.test.ts` | per-chain cache (same address, two chains → 2 network hits); shared rate counter across chains; `fetchEtherscanAbi` 4-arm DU |
| `test/security-canonical-alternatives.test.ts` | `test/security-canonical-dispatch.test.ts` (lines 1-80) | selector → tool lookup; no-match returns null; collision-audit assertion (no selector maps to >1 entry); ESM spy round-trip via `_canonicalAlternatives` |

---

## Shared Patterns

### Pattern A — `errEnvelope` helper (used by every prepare_* and tool handler)
**Source:** `src/tools/prepare_native_send.ts:75-81` (verbatim across all prepare_* tools)
**Apply to:** `prepare_custom_call.ts`, `get_contract_abi.ts`, `read_contract.ts`
```typescript
function errEnvelope(code: ErrorCode, message: string, cause?: string): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}
```

### Pattern B — JSON-Schema dispatch-boundary gate
**Source:** `src/tools/prepare_native_send.ts:101-130`
**Apply to:** all three NEW tools (the `acknowledgeNonProtocolTarget: { const: true, type: "boolean" }` literal in `prepare_custom_call` is the load-bearing dispatch gate; the `chain` enum is the per-tool gate)

### Pattern C — Never-throws client contract (4-arm DU + LRU + AbortController)
**Source:** `src/clients/fourbyte.ts:30-167` + `src/clients/etherscan.ts:39-355`
**Apply to:** the new `fetchEtherscanAbi` export

### Pattern D — Format-fanout-sentinel (single block, single home, byte-identity assertion)
**Source:** `src/signing/blocks.ts:346-352` + lines 389-400 + lines 868-886
**Apply to:** all three new templates land in `blocks.ts` and are IMPORTED by both `prepare_custom_call.ts` and `preview_send.ts`. NEVER inline the strings. Grep-test enforces.

### Pattern E — APPEND-ONLY type-surface widening
**Source:** `src/signing/handle-store.ts:948-966` (`pinned?` + `sentAt?` pattern) + `src/signing/error-codes.ts:107` (every prior phase appends)
**Apply to:** `HandleRecord` gets two new `?:` fields; `ErrorCode` gets three new arms

### Pattern F — Hardcoded `0x...` literal fingerprint fixtures
**Source:** `test/signing-fingerprint.test.ts:107` (Fixture A — native send) ... line 188 (Fixture F — WETH9 withdraw) ... line 94 (FIXTURE_CRV_A_FP exported for cross-link)
**Apply to:** Fixture P. NO `beforeAll`-snapshot. Cross-linked from `prepare-custom-call.test.ts` + `preview-send.custom-call.test.ts` + `escape-hatch.test.ts`.

### Pattern G — Persona-cycle `from`-independence anchor
**Source:** `test/erc20-lifecycle.integration.test.ts:205-482` (full Fixture B/D/E/F persona cycle)
**Apply to:** `test/integration/escape-hatch.test.ts` — re-anchors Fixture P across PERSONAS_UNDER_TEST.

### Pattern H — ESM spy-affordance indirection
**Source:** `src/security/canonical-dispatch.ts:298` (`export const _canonicalDispatch = { checkDispatchTarget };`)
**Apply to:** `src/security/canonical-alternatives.ts` — `_canonicalAlternatives = { lookupCanonicalAlternative };`

---

## No Analog Found

Files with NO existing close match (planner falls back to RESEARCH.md patterns):

| File | Reason | Mitigation |
|------|--------|------------|
| `src/tools/read_contract.ts` | No existing tool composes `fetchEtherscanAbi` + `viem.encodeFunctionData` + `publicClient.call({ to, data })` + `viem.decodeFunctionResult`. The two halves exist (`get_token_metadata.ts` for the RPC half; `check_contract_security.ts` for the Etherscan half) but the composition is novel. | Compose patterns from BOTH analogs (cross-referenced above); state-mutability gate has NO analog (NEW gate). |

---

## Wave Coordination Summary

| File | Plan 35-01 | Plan 35-02 | Plan 35-03 | Conflict Risk |
|------|------------|------------|------------|---------------|
| `src/clients/etherscan.ts` | EXTEND (chainid + `fetchEtherscanAbi`) | IMPORT only | IMPORT only (for preview cache lookup) | LOW — 35-01 writes once; 35-02/03 import |
| `src/tools/get_contract_abi.ts` | NEW | — | — | NONE |
| `src/tools/read_contract.ts` | — | NEW | — | NONE |
| `src/tools/prepare_custom_call.ts` | — | — | NEW | NONE |
| `src/security/canonical-alternatives.ts` | — | — | NEW | NONE |
| `src/signing/blocks.ts` | — | — | APPEND (3 templates) | NONE |
| `src/signing/handle-store.ts` | — | — | APPEND (2 type fields) | NONE |
| `src/signing/error-codes.ts` | APPEND `ABI_NOT_AVAILABLE`? | APPEND `NON_VIEW_FUNCTION` + `ABI_NOT_AVAILABLE` | APPEND `NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED` | LOW — distinct lines; trivial rebase if parallel |
| `src/tools/preview_send.ts` | — | — | MOD (bypass + decode branches) | NONE — 35-03 only |
| `src/tools/check_contract_security.ts` | MOD (free downstream) | — | — | NONE |
| `src/tools/register-all.ts` | APPEND 1 line (`get_contract_abi`) | APPEND 1 line (`read_contract`) | APPEND 1 line (`prepare_custom_call`) | LOW — 3 distinct lines at EOF of block; trivial rebase |
| `test/signing-fingerprint.test.ts` | — | — | APPEND Fixture P | NONE |
| `test/integration/escape-hatch.test.ts` | — | — | NEW | NONE |

**Recommendation:** **35-02 ∥ 35-03 is SAFE** given the analysis above. Both touch `register-all.ts` (1 line each) and `error-codes.ts` (`ABI_NOT_AVAILABLE` could land in either — assign to 35-02). All other files are partitioned cleanly. The only shared touchpoint is `register-all.ts` — 1-line rebase is trivial.

**Strict sequential 35-01 → 35-02 → 35-03 remains the safest option** if the executor wants zero rebase friction. The recommendation hinges on user tolerance for a single 1-line auto-rebase.

---

## Metadata

**Analog search scope:** `src/{tools,clients,security,signing,config,chains}/` + `test/{signing-fingerprint.test.ts, erc20-lifecycle.integration.test.ts, security-canonical-dispatch.test.ts, fourbyte.test.ts}`
**Files scanned:** ~25 (verbatim Read) + Glob results (~150 file paths surveyed)
**Pattern extraction date:** 2026-05-26
