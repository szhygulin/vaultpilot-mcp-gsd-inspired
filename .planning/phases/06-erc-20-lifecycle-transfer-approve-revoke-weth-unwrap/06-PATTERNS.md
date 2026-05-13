# Phase 6: ERC-20 lifecycle (transfer + approve + revoke + WETH unwrap) — Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** 7 new source + 5 new test + 4 file extensions
**Analogs found:** 6 / 7 new source files have an exact analog; `src/config/contracts.ts` and `src/protocols/` are both first-of-their-kind in the codebase (greenfield, but the shape is pre-cemented by `src/tokens/registry.ts` + `src/clients/fourbyte.ts`).

## Executive Summary

Phase 6 introduces the `src/protocols/` directory (first occupant) and the long-promised `src/config/contracts.ts` SOT (also first occupant — Phase 6 is the first feature with a canonical contract address requirement). Every other touchpoint is a near-exact mirror of a Phase 4/Phase 5 pattern:

- **Four new `prepare_*` tools** are mechanical clones of `src/tools/prepare_native_send.ts`. Each diff against the analog is small and predictable: (a) input schema (token-specific args), (b) `data: Hex` is encoded ABI calldata (not `"0x"`), (c) `to` is the contract address (not the user's recipient), (d) `valueWei` is `0n` (except WETH wrap if scoped here, which isn't), (e) demo / pairing / fingerprint / handle / receipt are byte-identical.
- **`get_token_metadata`** is a stripped-down `get_token_balance.ts` (drop `balanceOf`; keep `decimals` + `symbol` + `name`). The viem read-pattern + caching question are both already answered upstream (top-50 registry caches metadata; only off-list tokens fetch live).
- **`src/tools/preview_send.ts` extension** is the only file in the trust pipeline that gets touched. The selector-routed decode happens here; the `AGENT_TASK_TEMPLATE` text (already substituted with `{TO}`/`{VALUE_WEI}`/`{PRESIGN_HASH}`) gains an additional ERC-20-decoded-args section the agent re-emits in its `CHECKS PERFORMED` reply. Two paths to extend (planner's call): widen the existing template, OR ship a second `ERC20_AGENT_TASK_TEMPLATE` and switch on `selector`. The format-fanout-sentinel rule mandates ONE template per emission path, not duplication.
- **`src/signing/payload-fingerprint.ts` already supports non-empty `data`** — Fixture B in `test/signing-fingerprint.test.ts` (lines 23-41) is the forward-looking ERC-20-shape anchor, already shipped and passing. Phase 6 reuses it directly.
- **The signing primitives (`src/signing/*`), the gate (`send_transaction`), and the security envelope (`error-codes.ts`) are NOT touched.** Phase 6 is a contract-call shape over the same pipeline — the cryptographic-binding chain is `from`-independent AND `data`-shape-independent (Fixture B already proves this).

Two patterns are genuinely new in Phase 6 and must be locked here so later phases don't restyle them: (1) the `src/protocols/<protocol>.ts` shape — per-protocol ABI const + encode helpers + decode helpers + selector-table export, mirrored against `src/clients/fourbyte.ts`'s single-purpose module shape; (2) the `src/config/contracts.ts` shape — per-chain-keyed Record of canonical addresses with regression test via fixed-string assertions.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/tools/get_token_metadata.ts` | tool (read — multicall) | request-response | `src/tools/get_token_balance.ts:40-105` | exact (drop `balanceOf`; keep the parallel `decimals`/`symbol` reads; add `name`) |
| `src/tools/prepare_token_send.ts` | tool (signing — prepare) | request-response | `src/tools/prepare_native_send.ts` (full file) | exact (signing-flow shape) — diff: encode `transfer(to, amount)` calldata; `tx.to` is token contract; `tx.valueWei = 0n` |
| `src/tools/prepare_token_approve.ts` | tool (signing — prepare) | request-response | `src/tools/prepare_native_send.ts` | exact — diff: encode `approve(spender, amount)`; unlimited-approval input path |
| `src/tools/prepare_revoke_approval.ts` | tool (signing — prepare) | request-response | `src/tools/prepare_token_approve.ts` (sibling once shipped) | exact — diff: `amount = 0n` hard-coded; thin wrapper over the approve encoder |
| `src/tools/prepare_weth_unwrap.ts` | tool (signing — prepare) | request-response | `src/tools/prepare_native_send.ts` | exact — diff: encode `WETH9.withdraw(amount)`; `tx.to = WETH_ADDRESS` from contracts SOT |
| `src/protocols/erc20.ts` | protocol-primitive (ABI + encode + decode + selector table) | transform | `src/clients/fourbyte.ts` (single-purpose module, pure fns + exported consts) | partial role; new domain (decoded-arg shape is greenfield) |
| `src/protocols/weth9.ts` | protocol-primitive (1-function ABI + per-chain address lookup) | transform | `src/protocols/erc20.ts` (sibling once shipped) | exact (smaller surface — just `withdraw(uint256)` + address lookup) |
| `src/config/contracts.ts` | config (canonical addresses SOT, per-chain-keyed) | constants | `src/tokens/registry.ts:1-86` (typed validator + checksummed addresses + cached load) | partial — borrow validator + checksum-on-load; per-chain key is greenfield |
| `src/tools/preview_send.ts` (extend) | tool (signing — gate) | request-response | self (existing file) — extension point at the selector-decode + `agentBlock` construction | exact (same file) |
| `src/tools/register-all.ts` (+5 imports) | config (import list) | side-effect | self (existing file, lines 1-19) | exact |
| `test/get-token-metadata.test.ts` | test (unit — multicall) | unit | `test/get-token-balance.test.ts` | exact |
| `test/prepare-token-send.test.ts` | test (unit — prepare-tool 10-case ladder) | unit | `test/prepare-native-send.test.ts` | exact |
| `test/prepare-token-approve.test.ts` | test (unit) | unit | `test/prepare-native-send.test.ts` | exact |
| `test/prepare-revoke-approval.test.ts` | test (unit) | unit | `test/prepare-native-send.test.ts` | exact |
| `test/prepare-weth-unwrap.test.ts` | test (unit) | unit | `test/prepare-native-send.test.ts` | exact |
| `test/protocols-erc20.test.ts` | test (unit — pure encode/decode fixtures) | unit | `test/signing-fingerprint.test.ts` (fixture-anchored pure-fn pattern) | exact role |
| `test/config-contracts.test.ts` | test (unit — SOT regression) | unit | `test/get-portfolio-summary.test.ts` registry-shape assertions + `test/signing-fingerprint.test.ts` Fixture A discipline | partial |
| `test/preview-send.test.ts` (extend) | test (extend — decoded-args path) | unit | self (existing file — same test scaffolding, new it() block per case) | exact |
| `test/erc20-lifecycle.integration.test.ts` | test (integration — full pipeline in demo) | integration | `test/demo-flow.integration.test.ts` (full prepare→preview→send in demo) | exact |

## Pattern Assignments

### `src/tools/get_token_metadata.ts` (PREP-22 supporting tool)

**Analog:** `src/tools/get_token_balance.ts` (entire file — same shape, one fewer field).

**Imports + viem read pattern** (`src/tools/get_token_balance.ts:1-4, 40-78`):
```typescript
import { type Address, erc20Abi, getAddress, isAddress } from "viem";
import { getEthereumClient, isPublicNodeFallback } from "../chains/ethereum.js";
import { registerTool } from "./index.js";

// ...
const client = getEthereumClient();
try {
  const [decimals, symbol, name] = await Promise.all([
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "name" }),
  ]);
  // ...
```

**Cache-from-registry-first optimization** (this is a Phase 6 design call, not a borrow): before issuing the three `readContract` calls, check `loadEthereumTokenRegistry()` for the address — top-50 tokens have decimals/symbol/name cached in `src/tokens/ethereum-top-50.json`. Live RPC only for off-list tokens. The registry validator (`src/tokens/registry.ts:42-80`) already proves the JSON shape carries decimals + symbol + name.

**Error envelope:** match `get_token_balance.ts:43-53` (returns plain `isError: true` with text — NOT a structured `errorCode` envelope; read-only tools in this codebase don't use the `makeStructuredError` envelope; that's reserved for the signing-flow tools). Confirmed by the existing `get_token_balance.ts` source.

---

### `src/tools/prepare_token_send.ts` (PREP-20)

**Analog:** `src/tools/prepare_native_send.ts` (entire file — identical shape; the diff is bounded to four lines).

**What to copy verbatim:**
- Imports (`prepare_native_send.ts:52-65`) — same modules, plus add `import { encodeErc20Transfer } from "../protocols/erc20.js"`.
- `errEnvelope` wrapper (`prepare_native_send.ts:73-79`) — byte-identical.
- Demo-mode-first / pairing-check / sender resolution (`prepare_native_send.ts:174-231`) — byte-identical.
- `payloadFingerprint` + `createHandle` (`prepare_native_send.ts:253-265`) — byte-identical. Fixture B in `test/signing-fingerprint.test.ts:23-41` already proves the fingerprint computes correctly for ERC-20-shape data.
- `PREPARE_RECEIPT_TEMPLATE` substitution + return shape (`prepare_native_send.ts:273-292`) — diff is which placeholders to substitute (token, recipient, amount) — see "PREPARE RECEIPT extension" below.

**What to adapt:**

1. **Input schema** — `{ tokenAddress, to, amount }` where `amount` is a decimal string per PREP-22 (CLAUDE.md: "Decimal strings cross the boundary"). The pattern is the same `^0x[0-9a-fA-F]{40}$` regex for both address fields; `amount` validates as a non-empty decimal-or-integer string (NOT BigInt — BigInt rejects decimals; that's the wrong gate here because users SHOULD pass `"100.5"`).

2. **Decimal resolution** — call `get_token_metadata({ chain: 1, address: tokenAddress }).decimals`, then `viem.parseUnits(amount, decimals)` → `bigint amountWei`. Off-by-decimal failure mode lands here.

3. **Calldata** — `data = encodeErc20Transfer(to, amountWei)` from `src/protocols/erc20.ts`. The encoder returns `Hex` (the 68-byte transfer calldata, shape locked by Fixture B).

4. **`tx` construction** — `tx.to = getAddress(tokenAddress)` (the TOKEN CONTRACT), `tx.valueWei = 0n` (no native value), `tx.data = data` (the encoded calldata). The recipient is in the calldata, NOT in `tx.to`.

5. **`PREPARE RECEIPT` extension** — the format-fanout-sentinel `PREPARE_RECEIPT_TEMPLATE` in `src/signing/blocks.ts:28-32` only carries `{TO}` + `{VALUE_WEI}`. Phase 6 needs to surface `tokenAddress`, decoded `recipient`, decoded `amount` (decimal form + raw wei form). Two paths — planner's call:
   - **(a) Widen the existing template** to carry optional `{TOKEN}`/`{RECIPIENT}`/`{AMOUNT}` slots that native sends leave blank. Cheap; touches one file; the format-fanout regex sync stays trivial.
   - **(b) Ship a parallel `ERC20_PREPARE_RECEIPT_TEMPLATE`** in `blocks.ts` and switch in each prepare tool. Cleaner; each template is single-purpose; doubles the surface area `get_tx_verification.ts` re-emit has to handle.

Recommendation: (b). The receipt for native vs ERC-20 carries semantically different fields (recipient inside calldata, not in `tx.to`); a single widened template invites confusion on which fields are populated when. Locked in `src/signing/blocks.ts` as the format-fanout-sentinel SOT.

---

### `src/tools/prepare_token_approve.ts` (PREP-26)

**Analog:** `src/tools/prepare_token_send.ts` (once shipped) — identical shape; diff bounded to encoder choice + the unlimited-approval sentinel.

**Diff vs `prepare_token_send.ts`:**
- Encoder is `encodeErc20Approve(spender, amount)` (not `encodeErc20Transfer`).
- Input schema is `{ tokenAddress, spender, amount }` where `amount` accepts either a decimal string OR the literal `"max"` / `"unlimited"` (PREP-29 → `2^256 - 1`). Planner's call on the magic-string set; the `MAX_UINT256` constant lives in `src/protocols/erc20.ts`.
- `PREPARE RECEIPT` extension carries `tokenAddress` + `spender` + `amount` (decimal) + raw wei. The `⚠ UNLIMITED APPROVAL` label per PREP-29 lives in `preview_send.ts`'s decoded-args surfacing, NOT in the prepare-time receipt (the receipt is verbatim agent args; the warning is a server-side derived signal).

---

### `src/tools/prepare_revoke_approval.ts` (PREP-27)

**Analog:** `src/tools/prepare_token_approve.ts` (once shipped) — a 2-arg shortcut over the 3-arg approve.

**Diff vs `prepare_token_approve.ts`:**
- Input schema: `{ tokenAddress, spender }` only. No `amount`.
- Hard-codes `amount = 0n` before calling `encodeErc20Approve(spender, 0n)`.
- Tool DESCRIPTION specifies "Use when the user says 'revoke' or 'cancel approval'" — distinct intent surface for agent routing (PREP-27 rationale).
- Test fixture parallels `prepare_token_approve.test.ts` but with `amount = 0`.

---

### `src/tools/prepare_weth_unwrap.ts` (PREP-28)

**Analog:** `src/tools/prepare_native_send.ts` — same demo + pairing + fingerprint + handle scaffolding.

**Diff vs `prepare_native_send.ts`:**
- Input schema: `{ amount }` only (decimal string in WETH units = ETH units; decimals=18 from the canonical WETH9 metadata).
- `tx.to = getWethAddress(1)` from `src/config/contracts.ts` (chain 1 = mainnet, hard-coded per Phase 8 deferment). No agent input controls the contract address — it's the SOT.
- `tx.valueWei = 0n` (withdraw burns WETH, doesn't move native value into the call).
- `tx.data = encodeWethWithdraw(amountWei)` from `src/protocols/weth9.ts`.
- `PREPARE RECEIPT` extension shows the canonical WETH address (so the user can confirm the SOT-resolved address matches what they expect) + the unwrap amount.

---

### `src/protocols/erc20.ts` (new module — first protocol primitive)

**Analog:** `src/clients/fourbyte.ts` (single-purpose module — pure fns + exported consts, no class wrappers). Listed in `04-PATTERNS.md` as the canonical single-purpose-module shape.

**Module shape:**

```typescript
// src/protocols/erc20.ts
import { type Address, type Hex, encodeFunctionData, decodeFunctionData, parseAbi } from "viem";

// Single-line ABI consts for clarity; named exports so callers don't import a default object.
export const ERC20_TRANSFER_ABI = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
export const ERC20_APPROVE_ABI  = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

// Selector table — exported so preview_send.ts can switch on it without duplicating slice(0,10) magic.
export const ERC20_SELECTORS = {
  transfer: "0xa9059cbb" as Hex, // keccak("transfer(address,uint256)")[0..4]
  approve:  "0x095ea7b3" as Hex, // keccak("approve(address,uint256)")[0..4]
} as const;

export const MAX_UINT256 = (1n << 256n) - 1n; // PREP-29 unlimited-approval sentinel

export function encodeErc20Transfer(to: Address, amount: bigint): Hex { /* viem.encodeFunctionData */ }
export function encodeErc20Approve(spender: Address, amount: bigint): Hex { /* viem.encodeFunctionData */ }

// Decoder for preview_send.ts → CHECKS PERFORMED surfacing.
// Returns a discriminated union so the caller switches on `.kind` (mirror
// of FourbyteResult shape in src/clients/fourbyte.ts).
export type Erc20Decoded =
  | { kind: "transfer"; to: Address; amount: bigint }
  | { kind: "approve"; spender: Address; amount: bigint; isUnlimited: boolean }
  | { kind: "unknown"; selector: Hex };

export function decodeErc20Call(data: Hex): Erc20Decoded { /* viem.decodeFunctionData */ }
```

**Discriminated-union return shape:** mirror `FourbyteResult` in `src/clients/fourbyte.ts` — `kind: "found" | "not-found" | "error" | "not-applicable"`. Phase 4's PATTERNS.md confirms this is the codebase convention for "result-shape varies by selector".

**Selector-table SOT:** `ERC20_SELECTORS` lives in this file. `preview_send.ts`'s selector branching imports the table; it does NOT inline `"0xa9059cbb"` (CLAUDE.md Conventions: never inline canonical values).

---

### `src/protocols/weth9.ts` (new module)

**Analog:** `src/protocols/erc20.ts` (sibling once shipped) — narrower surface.

**Module shape:**

```typescript
// src/protocols/weth9.ts
import { type Address, type Hex, encodeFunctionData, parseAbi } from "viem";
import { getWethAddress } from "../config/contracts.js";

export const WETH9_WITHDRAW_ABI = parseAbi(["function withdraw(uint256 amount)"]);
export const WETH9_SELECTORS = { withdraw: "0x2e1a7d4d" as Hex } as const;

export function encodeWethWithdraw(amount: bigint): Hex { /* viem.encodeFunctionData */ }

// Decoder for preview_send.ts; same discriminated-union shape as erc20.ts.
export type Weth9Decoded = { kind: "withdraw"; amount: bigint } | { kind: "unknown"; selector: Hex };
export function decodeWeth9Call(data: Hex): Weth9Decoded { /* viem.decodeFunctionData */ }
```

The per-chain WETH address lookup lives in `src/config/contracts.ts` (the SOT). This module never inlines an address — it imports `getWethAddress(chainId)`.

---

### `src/config/contracts.ts` (new SOT — first occupant)

**Analog (partial):** `src/tokens/registry.ts:1-86` — typed validator, checksummed-on-load, cached load. The shape is the same; the data model is per-chain instead of per-token.

**Module shape:**

```typescript
// src/config/contracts.ts
import { getAddress, type Address } from "viem";

// Per-chain canonical contract registry. The TYPE of the value is what
// makes this SOT — `getWethAddress(1)` is type-safe; an unknown chain
// triggers a compile error rather than a runtime undefined.
//
// Phase 8 (multi-chain) will extend `Chain` and the inner records; Phase 6
// only ships chainId=1 entries.
export type ChainId = 1; // Phase 8 widens this
interface ContractsForChain {
  weth: Address;
  // Phase 7 adds: aavePool, lidoStaking, ...
}

const CONTRACTS_RAW: Record<ChainId, ContractsForChain> = {
  1: {
    weth: getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
  },
};

// Lookup fns — exported per-contract so callers grep `getWethAddress`,
// not `CONTRACTS[1].weth`. Mirrors `loadEthereumTokenRegistry()` shape.
export function getWethAddress(chainId: ChainId): Address {
  return CONTRACTS_RAW[chainId].weth;
}

// Known-spender table for approval-class surfacing (PREP-29). Per chain.
// Plan-level decision: ship a curated small list (Uniswap V3 SwapRouter,
// Aave V3 Pool, common bridges). Format-fanout: lookup goes through a
// single exported `getKnownSpender(chainId, address): string | null`.
const KNOWN_SPENDERS_RAW: Record<ChainId, Record<Address, string>> = {
  1: {
    [getAddress("0xE592427A0AEce92De3Edee1F18E0157C05861564")]: "Uniswap V3 SwapRouter",
    // ... Plan 06-03 decides the seed list
  },
};

export function getKnownSpender(chainId: ChainId, address: Address): string | null {
  const normalized = getAddress(address);
  return KNOWN_SPENDERS_RAW[chainId]?.[normalized] ?? null;
}
```

**Regression test pattern:** mirror `test/signing-fingerprint.test.ts`'s Fixture A discipline — hardcode the canonical WETH address as a literal in `test/config-contracts.test.ts`, assert `getWethAddress(1)` matches byte-for-byte. The whole point of the SOT is regression-resistance.

---

### `src/tools/preview_send.ts` (EXTENSION)

**Insertion point — selector decode:** after the `selector` derivation at `preview_send.ts:250-251`, branch on the selector value:

```typescript
// Existing:
const selector: Hex | null =
  record.tx.data === "0x" ? null : (record.tx.data.slice(0, 10) as Hex);

// Phase 6 addition (after the existing `selector` line, before the previewToken mint):
let decodedArgs: { kind: "transfer" | "approve" | "withdraw" | "unknown"; ... } | null = null;
if (selector !== null) {
  if (selector === ERC20_SELECTORS.transfer || selector === ERC20_SELECTORS.approve) {
    decodedArgs = decodeErc20Call(record.tx.data);
  } else if (selector === WETH9_SELECTORS.withdraw && record.tx.to === getWethAddress(1)) {
    decodedArgs = decodeWeth9Call(record.tx.data);
  }
  // Unknown selector: leave decodedArgs null; the 4byte block still fires.
}
```

**Insertion point — agent-task block extension:** at `preview_send.ts:321-325` (the existing `AGENT_TASK_TEMPLATE` substitution), extend the block emission to include the decoded args. Two paths:
- **(a) Widen `AGENT_TASK_TEMPLATE`** to carry optional `{DECODED_ARGS_BLOCK}` slot that native sends substitute with empty string.
- **(b) Append a second block** `DECODED_ARGS_TEMPLATE` (with sub-templates per-call-shape) AFTER the agent-task block in the `text` array at `preview_send.ts:332-340`.

Recommendation: (b). Each block is one-emission-purpose; the format-fanout-sentinel discipline gets stronger when blocks stay narrow. The CHECKS PERFORMED block that the AGENT re-emits in its reply naturally widens to include the new fields without server-side coupling.

**Approval-class surfacing (PREP-29):** when `decodedArgs.kind === "approve"`:
- `isUnlimited = amount === MAX_UINT256` → label `⚠ UNLIMITED APPROVAL` + one-line revoke hint `(call prepare_revoke_approval with the same tokenAddress + spender to revoke)`.
- `knownSpender = getKnownSpender(record.tx.chainId, spender)` → if non-null, surface the human name alongside the address. If null, surface the address + `(unknown spender — verify with the user)`.

These both live in the new decoded-args block, NOT in `AGENT_TASK_TEMPLATE` (which stays generic to the trust pipeline).

**Idempotency:** the existing re-preview semantics (Q4 — overwrites pinned state, mints fresh previewToken) carry over unchanged. The decoded-args block is recomputed on every preview call (deterministic from `record.tx.data` which is fixed at prepare time).

**`structuredContent` extension:** add `decodedArgs?` field carrying the same shape. The send-time gate (`send_transaction`) does NOT consume this field — it stays a presentation artifact.

---

### `src/tools/register-all.ts` (EXTENSION)

**Insertion point:** add 5 side-effect imports above the existing comment at line 21. Mirror the existing 19 import-only lines:

```typescript
import "./get_token_metadata.js";
import "./prepare_token_send.js";
import "./prepare_token_approve.js";
import "./prepare_revoke_approval.js";
import "./prepare_weth_unwrap.js";
```

That's the entire diff. The body function stays unchanged (its job is just to be the import-target that triggers transitive side-effect registration).

## Modification Touchpoints

| File | Function / Lines | What slots in |
|---|---|---|
| `src/tools/preview_send.ts` | After line 251 (selector derivation) | Selector-routed decode via `src/protocols/erc20.ts` + `weth9.ts` |
| `src/tools/preview_send.ts` | At lines 321-340 (block emission) | Append decoded-args block to the `text` array; add `decodedArgs` to `structuredContent` |
| `src/tools/preview_send.ts` | Tool DESCRIPTION (lines 89-98) | Add one sentence: "For ERC-20 `transfer` / `approve` and WETH `withdraw`, the response includes a DECODED ARGS block surfacing the function arguments in human form (token symbol, recipient/spender, amount with decimals)." |
| `src/tools/register-all.ts` | Lines 1-19 (existing import block) | +5 side-effect imports |
| `src/config/contracts.ts` | New file | First occupant — see § Pattern Assignments |
| `src/signing/blocks.ts` | Add `ERC20_PREPARE_RECEIPT_TEMPLATE` + `DECODED_ARGS_TEMPLATE` (planner's call on naming) | Per format-fanout-sentinel: every multi-line block is a `const` in this file, never inlined |

## Reusable Primitives — MUST call, NEVER re-implement

Phase 6 tools call these existing exports. Re-implementing any of them is a CLAUDE.md violation ("`src/signing/*`... is the single source of truth").

- **`computePayloadFingerprint(input)`** from `src/signing/payload-fingerprint.ts` — call exactly as `prepare_native_send.ts:253` does. The preimage already accommodates non-empty `data`; Fixture B (`test/signing-fingerprint.test.ts:23-41`) is the regression anchor.
- **`createHandle({ args, tx, payloadFingerprint })`** from `src/signing/handle-store.ts` — call exactly as `prepare_native_send.ts:261-265`. The `args` field's `PrepareArgs` type is `{ to: string; valueWei: string }` — Phase 6 needs to either WIDEN `PrepareArgs` (add optional `{ tokenAddress?, amount?, spender? }` fields) OR ship a second `PrepareErc20Args` type. Planner's call. The handle store itself does not need new transitions — `prepared → previewed → sent | cancelled` covers ERC-20 flows identically.
- **`PREPARE_RECEIPT_TEMPLATE` substitution** from `src/signing/blocks.ts:28-32` — substitute via `.replace("{TO}", ...).replace("{VALUE_WEI}", ...)`. For ERC-20: either ship parallel templates (recommended) or substitute the existing one with `tokenAddress` semantics (fragile — confuses the contract).
- **`LEDGER_BLIND_SIGN_HASH_TEMPLATE` + `chunkHex` + `build4byteBlock`** from `src/signing/blocks.ts` — `preview_send.ts` already calls these; Phase 6 inherits unchanged. No new code path.
- **`makeStructuredError(code, message, cause?)`** from `src/signing/error-codes.ts` — every signing-flow tool wraps via `errEnvelope` helper. Mirror byte-identically from `prepare_native_send.ts:73-79`.
- **`isDemoMode()` + `getActivePersona()`** — gate every signing-flow tool the same way `prepare_native_send.ts:190-208` does. The demo branch:
  - SKIPS `getStatus()` (no WC pairing in demo).
  - DOES call `createHandle` (the demo flow rehearses the same pipeline — Q-CONTRADICTION-PREP Option B locked in Phase 5).
  - Refuses with `WRONG_MODE` if persona is null.
- **`getStatus()`** from `src/wallet/session-manager.ts` — real-mode pairing check; same call site as `prepare_native_send.ts:213`.
- **`getEthereumClient()`** from `src/chains/ethereum.ts` — the viem PublicClient for all RPC reads (used by `get_token_metadata` and existing `preview_send.ts` gas/nonce/fees resolution).
- **`loadEthereumTokenRegistry()`** from `src/tokens/registry.ts` — `get_token_metadata` checks this for cached decimals/symbol/name before live RPC. Hot-path optimization.
- **`viem.parseUnits(amount, decimals)`** — decimal-string → bigint wei. The decimal-aware-arithmetic gate (CLAUDE.md Conventions) lives here.
- **`viem.encodeFunctionData` + `viem.decodeFunctionData`** — the canonical ABI encode/decode. NEVER hand-roll selectors or 32-byte padding; viem is the source of truth.
- **`viem.parseAbi(["function ..."])`** — one-line ABI const. Used by `src/chains/erc20-scanner.ts:23-25` as the existing precedent.

## Anti-Patterns to Avoid

From Phase 1-5 retros + CLAUDE.md conventions:

1. **Never inline a canonical contract address.** WETH address is `getWethAddress(1)` from `src/config/contracts.ts` — every consumer goes through the SOT. The `WETH_ADDRESS` literal currently inlined at `src/tools/get_portfolio_summary.ts:17` is a Phase 6 cleanup target (migrate to `getWethAddress(1)` in the same PR).

2. **Never normalize the RAW agent args at the storage boundary.** `PrepareArgs` is `{ string, string }` deliberately — the type system blocks accidental checksum-casing or trimming. If you extend `PrepareArgs` for ERC-20 fields, keep every new field typed as `string` (not `Address`, not `bigint`). The verbatim-receipt invariant (`prepare_native_send.ts:255-275`) is load-bearing.

3. **Never bypass `payloadFingerprint`.** Even for "obvious" calldata shapes, `data` MUST flow through `computePayloadFingerprint`. The send-time re-check (`send_transaction.ts:295-316`) compares the recomputed fingerprint against the stored value; any drift is the `PAYLOAD_FINGERPRINT_DRIFT` refusal.

4. **Never make the demo branch call `getStatus()`.** `prepare_native_send.ts:190` short-circuits before pairing — the test scaffolding asserts the spy observes zero calls in the demo arm (T-DEMO-1). Reproducing this defense per-tool is non-negotiable.

5. **Never use a soft check for the previewToken / userDecision gates.** The schema-level `enum: ["send", "cancel"]` at `send_transaction.ts:140-144` is the gate — the per-tool handler is unreachable when the input violates the schema. Phase 6 prepare tools do NOT add new schema gates to `send_transaction`; ERC-20 send is the same `userDecision` shape.

6. **Never duplicate a format-fanout sentinel.** If Phase 6 adds `ERC20_PREPARE_RECEIPT_TEMPLATE`, it lives in `src/signing/blocks.ts` only. No inline copy in `prepare_token_send.ts`; tests import the same const. The widening-vs-parallel-template decision (above) gets re-checked against this rule.

7. **Never let an unknown selector silently fall through to "OK".** When `preview_send.ts` decodes calldata and hits an unrecognized selector, the existing 4byte block (`build4byteBlock` in `src/signing/blocks.ts:131-157`) still fires — that's the catch-all cross-check. The new decoded-args block emits "unknown selector — verify via 4byte" or omits the block entirely (planner's call). What it MUST NOT do is print "decoded successfully" for data it didn't actually decode.

## Cryptographic-Binding Chain Delta

**What Phase 6 CHANGES in the trust pipeline:**

- `preview_send.ts` gains a selector-routed decode step that surfaces decoded ERC-20 / WETH9 args in a new block (presentation only).
- `preview_send.ts`'s `structuredContent` gains an optional `decodedArgs` field (presentation only — the send-time gate does not read it).
- `PREPARE RECEIPT` text widens to include `tokenAddress` / `spender` / `amount` (verbatim agent args, NEVER normalized).
- The `data` field on `record.tx` becomes non-`"0x"` for the four new prepare tools. The fingerprint preimage assembly already accommodates this (Fixture B proves it).
- `src/config/contracts.ts` becomes the canonical address SOT — first occupant.

**What Phase 6 DOES NOT touch:**

- `src/signing/payload-fingerprint.ts` — frozen. The preimage shape (`tag || chainId || to || valueWei || data`) accommodates the new shapes natively. Fixture A (`test/signing-fingerprint.test.ts:10-21`) value `0x7e1867b2...` STILL holds for native sends; Fixture B (`test/signing-fingerprint.test.ts:23-41`) is the ERC-20-shape anchor and STILL holds for any ERC-20 call against the same fixture inputs.
- `src/signing/presign-hash.ts` — frozen. The EIP-1559 serialization is agnostic to `data` shape. Fixture C (`test/signing-presign-hash.test.ts:7-16`) value `0xb28e4824...` is the trust-pipeline anchor for native sends and stays unchanged.
- `src/signing/handle-store.ts` — state machine (`prepared → previewed → sent | cancelled`) and the 15-min TTL are unchanged. The `PrepareArgs` type may widen (additive — never breaking).
- `src/signing/error-codes.ts` — the 15 codes cover Phase 6's failure modes. No new codes needed (`INVALID_INPUT` covers decimal-parse + unknown-token; `INTERNAL_ERROR` is the catch-all). If a new code is genuinely needed, the union widens — but plans should default to reuse.
- `src/tools/send_transaction.ts` — the THREE GATES (schema → state-machine → fingerprint-drift) are byte-identical for ERC-20 sends. Calldata flows through `record.tx.data` untouched; viem hex-encodes it for the WC `eth_sendTransaction` params at line 444. The demo simulation path (`call(client, { ... data })` at line 357) works identically — `eth_call` for ERC-20 calldata simulates the revert path the same way it does for native sends.
- `src/tools/get_tx_verification.ts` — re-emits the prepare/preview artifacts. Will pick up the new decoded-args block automatically because the block is built fresh from `record.tx.data` on re-emit. If a parallel `ERC20_PREPARE_RECEIPT_TEMPLATE` is shipped, `get_tx_verification.ts` gains a switch on `record.tx.data === "0x"` to pick the right template (minor extension; not load-bearing).
- `src/server.ts` — no dispatcher-wrap changes. The demo intercept lives per-tool, NOT at the server boundary (verified at `src/server.ts:102-163` — the request handler just routes to the registered tool's handler; the demo branching is inside each tool's `isDemoMode()` check, locked in Phase 5).

**Load-bearing executor self-check:** if a Phase 6 task adds or modifies anything under `src/signing/*` (other than block-template constants in `src/signing/blocks.ts`), STOP. The pipeline shape is frozen at Phase 4/5; Phase 6 is a contract-call shape over the SAME pipeline. The cryptographic-binding chain is `from`-independent AND `data`-shape-independent.

## Test Surface Notes

**Existing fixtures Phase 6 reuses byte-for-byte:**

- **Fixture A** (`test/signing-fingerprint.test.ts:10-21`) — native send `payloadFingerprint = 0x7e1867b2...`. Phase 6 does NOT touch this; it remains the regression anchor that proves Phase 6 didn't accidentally break native sends.
- **Fixture B** (`test/signing-fingerprint.test.ts:23-41`) — ERC-20-shape `data` fingerprint (68-byte `transfer` calldata against the same `to` and chain). This is the snapshot anchor; Phase 6 builds on it directly. Plan should NAME this fixture by handle in `prepare_token_send`'s test (Test "Fixture B inputs flow end-to-end through prepare → handle record → structuredContent").
- **Fixture C** (`test/signing-presign-hash.test.ts:7-16`) — native send `presignHash = 0xb28e4824...`. Phase 6's preview-send extension test must NOT change Fixture C's expected value; assert byte-equality.
- **`from`-independence assertion** (`test/demo-flow.integration.test.ts:11-26` comments) — Phase 6 inherits this property automatically. The demo integration test for ERC-20 (new file below) re-anchors the property on ERC-20-shape calldata.

**New fixtures Phase 6 needs (planner's call on naming):**

- **Fixture D (suggested name)** — ERC-20 `transfer` end-to-end through `prepare_token_send`. Inputs:
  - `tokenAddress`: USDC canonical (`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`) — pinned address proves the `get_token_metadata` decimals=6 path.
  - `to`: same `0x70997970...` recipient as Fixture A/B for cross-fixture consistency.
  - `amount`: `"100"` (decimal string) → `100_000_000n` wei after decimals=6 normalization.
  - Expected: `data = encodeErc20Transfer(...)` byte-string, `tx.to = USDC contract`, `tx.valueWei = 0n`, `payloadFingerprint = <computed at fixture authoring time, locked literal>`.
- **Fixture E (suggested name)** — `prepare_token_approve` unlimited path. Inputs: WETH + Uniswap V3 Router spender + `amount = "max"`. Expected: `isUnlimited = true` on the decoded-args block; `⚠ UNLIMITED APPROVAL` label in the preview-send extension test.
- **Fixture F (suggested name)** — `prepare_weth_unwrap`. Inputs: `amount = "1.0"` → `1_000_000_000_000_000_000n` wei. Expected: `tx.to = getWethAddress(1)`, `tx.data = encodeWethWithdraw(1e18)`, `tx.valueWei = 0n`, `payloadFingerprint = <literal>`.

**Per-tool unit test pattern** — mirror `test/prepare-native-send.test.ts` for each of the four new `prepare_*` tools:
- Hoisted spy declarations via `vi.hoisted({ getStatusSpy, createHandleSpy })` at lines 1-11.
- `vi.mock` for `session-manager.js` + `handle-store.js` (carry through real `lookup` + `_resetHandleStoreForTesting`).
- 10-case ladder: pair-required (real mode), demo-mode (persona set), demo-mode (persona null → WRONG_MODE), invalid-address, invalid-amount, fingerprint-anchor, receipt-verbatim, handle-stored, register-all smoke, idempotency.

**ERC-20 integration test** — new file `test/erc20-lifecycle.integration.test.ts`, mirror of `test/demo-flow.integration.test.ts`:
- Same mock scaffolding (`getStatusSpy` + `getActiveSessionTopicSpy` + `mockPublicHolder` + `mockSignClientHolder`).
- Run the full pipeline: `prepare_token_send` → `preview_send` (assert decoded-args block + CHECKS PERFORMED prose) → `send_transaction` with `userDecision: "send"` in demo mode (assert simulation envelope, ZERO `signClient.request` calls).
- Re-anchor `from`-independence: assert that `payloadFingerprint` value matches across modes for the same `{ to, valueWei, chainId, data }`. With ERC-20 calldata, `to = USDC contract` AND `data = transfer(recipient, amount)` — the binding is on the CONTRACT address + the CALLDATA, not the recipient. This is the load-bearing proof that approval-style transactions can't be silently re-pointed at a different recipient between prepare and send.

**Protocols-erc20 unit test** — `test/protocols-erc20.test.ts`:
- Pure-fn fixtures, no mocks. Mirror `test/signing-fingerprint.test.ts`'s discipline.
- Hardcode expected encoded calldata for `transfer(0x...dEAD, 1e18)` matching Fixture B's `data` field (cross-link: the `data` literal at `test/signing-fingerprint.test.ts:26` should pass through `encodeErc20Transfer` to the same byte-string).
- Assert `ERC20_SELECTORS.transfer === "0xa9059cbb"` and `ERC20_SELECTORS.approve === "0x095ea7b3"` byte-for-byte. These are universal ERC-20 selectors — any drift in this test is a regression in viem's keccak or our selector const.
- Assert `MAX_UINT256 === (1n << 256n) - 1n` and `decodeErc20Call(approveMaxCalldata).isUnlimited === true`.

**Config-contracts test** — `test/config-contracts.test.ts`:
- Hardcode `getWethAddress(1) === "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"` (the canonical mainnet WETH; same byte-string currently inlined at `src/tools/get_portfolio_summary.ts:17`).
- Assert `getKnownSpender(1, <uniswap router>) !== null`.
- Assert `getKnownSpender(1, <random address>) === null`.
- Assert `getWethAddress` is type-safe — `getWethAddress(999)` is a tsc compile error (negative compile-time assertion; mirrors the type-level breaking-change discipline from `src/signing/error-codes.ts`).

**preview-send.test.ts extension** — add a Test N (existing scaffolding):
- Stage: a prepared handle with `tx.data = <Fixture B transfer calldata>`, `tx.to = <USDC contract>`.
- Assert: the response `text` contains the new DECODED ARGS block (or the widened AGENT TASK block, per the (a) vs (b) decision).
- Assert: `structuredContent.decodedArgs.kind === "transfer"`, `recipient === "0x...dEAD"`, `amount === <literal>`.
- Approve unlimited variant: assert `⚠ UNLIMITED APPROVAL` text appears + revoke hint contains the literal `prepare_revoke_approval`.

## Metadata

**Analog search scope:** `src/tools/`, `src/signing/`, `src/config/`, `src/chains/`, `src/tokens/`, `src/clients/`, `src/demo/`, `src/server.ts`, `test/*.ts`, `.planning/phases/04-*/04-PATTERNS.md`.
**Files scanned (read):** 11 source files + 4 test files + 1 prior PATTERNS.md + roadmap/requirements extracts.
**Pattern extraction date:** 2026-05-13.
