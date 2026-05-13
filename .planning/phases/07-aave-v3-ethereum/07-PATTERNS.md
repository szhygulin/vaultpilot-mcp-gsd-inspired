# Phase 7: Aave V3 (Ethereum) — Pattern Map

**Mapped:** 2026-05-13
**Phase scope:** READ-20, READ-21, PREP-23, PREP-24, PREP-25
**Files in scope:** 6 new src/, 1 new client, 4 modifications, ~7 new tests
**Analogs found:** strong matches for every new file (≥1 role-match each); one greenfield item (`simulate_position_change`) names its closest design analog

Phase 6 cleared most of the structural ground Phase 7 needs:

- The `src/protocols/` shelf has two occupants (`erc20.ts`, `weth9.ts`) — Phase 7's `aave-v3.ts` is occupant #3, byte-shape locked.
- The `src/config/contracts.ts` SOT is a first-occupant with a Phase-7-aware regression-test (`length >= 11`, see test/config-contracts.test.ts:44) — extending the table and adding a parallel `AAVE_V3_ADDRESSES` const does NOT churn the test.
- The 12th `KNOWN_SPENDERS_ETHEREUM` slot is open by the count-anchor's design; **note however that the Aave V3 Pool row is ALREADY seeded** at `src/config/contracts.ts:85-88` (Phase 6 Wave 3 pre-populated it). The "12th slot reserved" framing in the user prompt is therefore obsolete on inspection — Aave V3 Pool already exists in `KNOWN_SPENDERS_ETHEREUM[0]`. **Plan 07-01 should NOT re-add the row**; it adds the Aave-protocol-specific records as a NEW const `AAVE_V3_ADDRESSES` (Pool + PoolAddressesProvider + UiPoolDataProviderV3 + AaveOracle). See § Modification Touchpoints for the corrected migration.
- The `prepare_*` mechanical-clone pattern is rehearsed 4 times across Phase 6 (`prepare_token_send`, `prepare_token_approve` + `prepare_revoke_approval`, `prepare_weth_unwrap`). Bounded diffs only: schema, encoder, `tx.to`, `valueWei`, RECEIPT template.
- The cryptographic-binding chain (`payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts` state machine, `send_transaction.ts` three gates) is FROZEN; Phase 7 adds NO new shapes to the preimage assembly. Fixtures G + H are byte-literal anchors only.
- `preview_send.ts` is the ONE trust-pipeline file Phase 7 touches — additive selector dispatch + additive LEDGER NOTICE conditional (if Aave clear-sign coverage uncertain, A1 mitigation pattern from 06-04).

## 1. File-to-Analog Mapping

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality | Bounded Diffs |
|---|---|---|---|---|---|
| `src/tools/get_lending_positions.ts` (READ-20) | read tool | request-response + multicall | `src/tools/get_portfolio_summary.ts` | role-match | UiPoolDataProviderV3 (one contract, two methods) instead of multicall over 50 ERC-20s; per-asset rows decoded from packed reserve-data tuples; health-factor math runs server-side; rpcDegraded surfacing identical |
| `src/tools/prepare_aave_supply.ts` (PREP-23) | prepare tool | request-response | `src/tools/prepare_weth_unwrap.ts` | exact | Input schema `{ asset, amount }`; encoder = `encodeAaveSupply(asset, amountWei, onBehalfOf, referralCode=0)`; `tx.to = getAaveV3PoolAddress(1)`; `valueWei = 0n`; RECEIPT template parallels WETH unwrap with `asset` + `amount` slots |
| `src/tools/prepare_aave_withdraw.ts` (PREP-24) | prepare tool | request-response | `src/tools/prepare_weth_unwrap.ts` | exact | Same shape as supply; encoder = `encodeAaveWithdraw(asset, amount-or-MAX_UINT256, to=fromAddress)`; `"max"` sentinel re-uses the `prepare_token_approve` precedent (T-MAX-SPELLING-1 strict equality) — Aave treats `MAX_UINT256` as "withdraw entire balance" |
| `src/tools/simulate_position_change.ts` (PREP-25) | read tool (compute-only) | request-response + RPC reads | NO PERFECT ANALOG — closest is `get_lending_positions` for the read leg + research § Topic 4 Option A for the math | role-match (read leg) / greenfield (math leg) | Reads current account-data via UiPoolDataProviderV3, applies a delta in-memory, recomputes health factor off-chain. NO state mutation. See § Greenfield Design Notes below |
| `src/tools/check_contract_security.ts` (READ-21) | read tool | request-response + external API | `src/clients/fourbyte.ts` for the client surface; tool wrapper closest to `get_token_metadata.ts` | role-match | Wraps Etherscan V2 API; verified-source + age + privileged-role enumeration; best-effort surfacing (4 kinds: ok / not-verified / error / not-applicable) mirrors `FourbyteResult` discriminated union |
| `src/protocols/aave-v3.ts` | protocol module | encode + decode + selector table | `src/protocols/weth9.ts` (single-protocol, single-file, ABI const + encoder + selectors) | exact | Exports: `AAVE_V3_POOL_ABI` (parseAbi fragment for supply / withdraw), `AAVE_V3_SELECTORS` (4-byte selector table), `encodeAaveSupply` + `encodeAaveWithdraw` (canonical `encodeFunctionData` path — NEVER hand-rolled), and (additive) `AAVE_V3_DECODE_FRAGMENT` for preview_send's combined-ABI decode |
| `src/clients/etherscan.ts` | external client | external API + LRU cache | `src/clients/fourbyte.ts` | exact | Rate-limited HTTP wrapper; `EtherscanResult` discriminated union (4 kinds: `ok` / `not-verified` / `error` / `not-applicable`); never-throws contract; module-scope LRU cache (256-entry default); `_resetEtherscanCacheForTesting` underscore-prefixed escape hatch |
| `src/config/contracts.ts` (modify) | config SOT | static data | n/a (extends own pattern) | n/a | Add Aave-protocol records as a NEW const `AAVE_V3_ADDRESSES` (NOT `KNOWN_SPENDERS_ETHEREUM` — that row is already seeded). Extend `ContractsForChain` interface with `aavePool` (or expose only via `getAaveV3PoolAddress`); use the same `getAddress(...)` corrupted-snapshot guard at every literal site |
| `src/tools/preview_send.ts` (modify) | trust-pipeline tool | request-response | n/a (extends own pattern) | n/a | Two selector branches added (`supply`, `withdraw`); LEDGER NOTICE conditional (Aave clear-sign coverage — IF research § Topic 5 surfaces uncertainty); decodedArgs JSON serialization extended; **the file's structure remains FROZEN — selector dispatch + block emission only** |
| `src/signing/blocks.ts` (modify) | format SOT | static templates | n/a (extends own pattern) | n/a | Append-only: `AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE`, `AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE`, `DECODED_ARGS_TEMPLATE_AAVE_SUPPLY`, `DECODED_ARGS_TEMPLATE_AAVE_WITHDRAW`, optional `LEDGER_NOTICE_AAVE_TEMPLATE`. **DO NOT modify any existing template** — Phase 4 + Phase 6 callers must remain byte-identical |
| `src/tools/register-all.ts` (modify) | bootstrap | side-effect imports | n/a (extends own pattern) | n/a | +5 import lines (one per new tool). Sequential-by-plan-wave carve below avoids same-line conflicts |

## 2. Pattern Assignments — Concrete Code to Copy

### `src/tools/get_lending_positions.ts` (READ-20) — analog: `get_portfolio_summary.ts`

**Imports + DESCRIPTION shape** (lines 1-34):
```typescript
import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { getEthereumClient, isPublicNodeFallback } from "../chains/ethereum.js";
import { getAaveV3PoolAddressesProvider, getAaveV3UiPoolDataProvider } from "../config/contracts.js";  // NEW Phase 7 exports
import { getPrices, type PriceQuote } from "../pricing/defillama.js";
import { registerTool } from "./index.js";
// (DESCRIPTION array shape: 5-7 sentences; "Use when…", "Do NOT use for…", "Returns `{...}`", "Failure modes:")
```

**Concurrent on-chain read pattern** (`get_portfolio_summary.ts:109-125`):
```typescript
try {
  [nativeBalanceRaw, erc20Balances] = await Promise.all([
    client.getBalance({ address: wallet }),
    scanErc20Balances(wallet),
  ]);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [...],
    isError: true,
  };
}
```
Phase 7 substitutes `UiPoolDataProviderV3.getUserReservesData(...)` + `getReservesList(...)` for the two-call concurrent read. Use viem's `readContract` (not multicall — UiPoolDataProviderV3 returns the full per-asset packed tuple in one call).

**`rpcDegraded` surfacing** (`get_portfolio_summary.ts:219`):
```typescript
if (isPublicNodeFallback()) result.rpcDegraded = true;
```
Phase 7 copies verbatim; same hooked function from `src/chains/ethereum.ts`.

**No analog for the health-factor math itself.** Topic 4 of RESEARCH.md will name the formula and the precision class (bigint, RAY = 1e27 fixed-point). Pattern: a private helper `computeHealthFactor(collateralInBaseCurrency, debtInBaseCurrency, currentLiquidationThreshold): bigint` colocated in this file (not exported — Phase 7 has no second consumer). Mirror of `buildRow` in `get_portfolio_summary.ts:242-265` — module-private helper, full type signature, single responsibility.

---

### `src/tools/prepare_aave_supply.ts` (PREP-23) — analog: `prepare_weth_unwrap.ts`

**Mechanical clone with the bounded diffs:**

| Slot | WETH unwrap (analog) | Aave supply (new) |
|---|---|---|
| Input schema | `{ amount: string }` | `{ asset: Address, amount: string }` (chain implicit = 1, on-behalf-of = sender) |
| Decimal resolution | `WETH9_DECIMALS = 18` (hard-coded) | Registry-cache-first via `loadEthereumTokenRegistry`; live RPC `decimals()` on miss (mirror of `prepare_token_send.ts:99-114`) |
| Encoder | `encodeWethWithdraw(amountWei)` | `encodeAaveSupply(assetAddr, amountWei, onBehalfOf=fromAddress, referralCode=0)` |
| `tx.to` | `getWethAddress(1)` | `getAaveV3PoolAddress(1)` |
| `tx.valueWei` | `0n` | `0n` |
| RECEIPT template | `WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE` | `AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE` (NEW; see § Blocks) |
| `"max"` sentinel? | NO — rejected as INVALID_INPUT | NO — supply takes a concrete amount; the `"max"` sentinel only applies to withdraw |

**Auth / pairing branch** (`prepare_weth_unwrap.ts:104-140`) — copy verbatim, no changes:
```typescript
let fromAddress: Address;
if (isDemoMode()) {
  const persona = getActivePersona();
  if (persona === null) { /* WRONG_MODE structured refusal */ }
  fromAddress = persona.address;
} else {
  const status = await getStatus();
  if (status === null) { /* WALLET_NOT_PAIRED structured refusal */ }
  fromAddress = status.activeAccount;
}
```

**createHandle + RECEIPT** (`prepare_weth_unwrap.ts:188-214`) — copy verbatim, change template + structured fields:
```typescript
const handle = createHandle({
  args: { to: "", valueWei: "0", tokenAddress: rawAsset, amount: rawAmount },  // Phase 7: tokenAddress = the supplied asset
  tx,
  payloadFingerprint,
});

const receipt = AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE
  .replace("{ASSET}", rawAsset)
  .replace("{AMOUNT}", rawAmount);

return {
  content: [{ type: "text", text: receipt }],
  structuredContent: {
    handle,
    chainId: 1,
    from: fromAddress,
    asset: rawAsset,
    amount: rawAmount,
    amountWei: amountWei.toString(),
    payloadFingerprint,
  },
};
```

---

### `src/tools/prepare_aave_withdraw.ts` (PREP-24) — analog: `prepare_weth_unwrap.ts` + `prepare_token_approve.ts` (for `"max"`)

**Same mechanical clone as supply** with two additional bounded diffs:

1. **`"max"` sentinel handling** — copy `prepare_token_approve.ts:281-332`:
   ```typescript
   let amountWei: bigint;
   if (rawAmount === "max") {
     amountWei = MAX_UINT256;  // Aave Pool.withdraw treats type(uint256).max as "withdraw entire balance"
   } else {
     // resolveDecimals + parseAmountStrict — same shape as supply
   }
   ```
   T-MAX-SPELLING-1 mitigation parity: ONLY `"max"` (lowercase) is the unlimited sentinel; `"MAX"`, `"unlimited"`, `"infinite"` reject as INVALID_INPUT (kind: "format") via parseAmountStrict's regex.

2. **Encoder signature** — `encodeAaveWithdraw(assetAddr, amountWeiOrMax, to=fromAddress)`. Aave Pool.withdraw signature: `withdraw(address asset, uint256 amount, address to)`. The `to` argument is the recipient — Phase 7 hard-codes it to `fromAddress` (Q-style decision: explicit-self-recipient; users withdrawing to a different account is a v2.x concern, plan can flag this as Deferred).

---

### `src/tools/simulate_position_change.ts` (PREP-25) — NO PERFECT ANALOG — design notes

**Closest design analogs:**
- **Read leg** (current position): `get_lending_positions.ts` (Phase 7 sibling — Plan 07-02 must ship FIRST so 07-03 can import its internal `getUserReservesData` helper)
- **Math leg** (apply delta + recompute HF): `get_portfolio_summary.ts:242-265` `buildRow` pattern — pure helper, module-private, single responsibility

**Pattern decision (planner's call, flagged here):** SHOULD this be a separate tool, a sub-feature of `get_lending_positions`, or a flag on `prepare_aave_supply/withdraw`?

- **Separate tool** (recommended): agent-routing clarity — "simulate" is a distinct intent from "prepare". Mirror of `prepare_revoke_approval` precedent (Phase 6 retro line 146: "distinct intent-routed tool with shared internal helper"). The shared helper here is `getUserAccountData(user)` — exported (or via `_internal` indirection) from `get_lending_positions.ts`.
- **Sub-feature** (rejected): would force `get_lending_positions` to grow optional `simulateDelta` input; violates single-responsibility.
- **Flag on prepare**: rejected — `prepare_*` must be deterministic; mixing simulation into prepare widens the contract.

**Input schema:**
```typescript
{ asset: Address, deltaAmount: string }  // deltaAmount: decimal-string in human units; sign embedded as "100" (supply) vs "-100" (withdraw)
```
OR (strict-mode parity):
```typescript
{ asset: Address, action: "supply" | "withdraw", amount: string }
```
Plan-checker decides; the second shape is more agent-friendly (no signed-decimal parsing) and aligns with the project's `enum` discipline in `userDecision`.

**Output schema:**
```typescript
{
  currentHealthFactor: string,  // bigint formatted via formatUnits with 18 decimals
  projectedHealthFactor: string,
  liquidationThreshold: string,
  warning?: "would-liquidate" | "near-liquidation",  // structured advisory; NOT a refusal
}
```

**Trust-boundary note** — name this in the description: simulation is informational, NEVER a signing precondition. `prepare_aave_withdraw` does NOT call `simulate_position_change` internally — the agent decides whether to surface a warning. Same trust-anchor discipline as `runPreviewSimulation` (`src/signing/simulation.ts:18-24`):
> "TRUST-BOUNDARY INVARIANT: the SIMULATION block is a USABILITY signal, NEVER the trust anchor."

---

### `src/tools/check_contract_security.ts` (READ-21) — analog: `src/clients/fourbyte.ts` (for client surface) + `src/tools/get_token_metadata.ts` (for tool surface)

**Tool wrapper shape** — copy `get_token_metadata.ts:1-58`:
```typescript
const DESCRIPTION = [
  "Read contract security signals for an Ethereum address — verification status, deployment age, and privileged-role enumeration via Etherscan V2 API.",
  "Call BEFORE prepare_aave_supply / prepare_token_approve for an unfamiliar contract to surface red flags (unverified source, recent deployment, owner-only mint/pause functions).",
  "Returns `{ verified, contractName?, deployedAt?, ageInDays?, privilegedRoles?, rpcDegraded? }`. Unverified contracts return `{ verified: false }` with no further fields.",
  "Best-effort surfacing — Etherscan API failures return `{ verified: false, error: <verbatim> }`; agent sees the failure mode, not a fake \"unverified\".",
  "Failure modes: INVALID_INPUT for a malformed address, ETHERSCAN_UNREACHABLE on API timeout / 5xx.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "..." },
  },
  required: ["address"],
  additionalProperties: false,
};
```

**Client wrapping pattern** — internal call goes through `src/clients/etherscan.ts` (NEW; see below). Tool handler does input validation + delegation + envelope shaping. NEVER inlines an HTTP fetch.

---

### `src/clients/etherscan.ts` — analog: `src/clients/fourbyte.ts`

**Module-scope LRU cache + never-throws pattern** (`fourbyte.ts:52-148`):
```typescript
const cache = new Map<Address, EtherscanResult>();
const CACHE_MAX_ENTRIES = 256;
const ETHERSCAN_TIMEOUT_MS = 3000;  // 2× fourbyte (3rd-party API; Etherscan latency higher)

export type EtherscanResult =
  | { kind: "not-applicable" }
  | { kind: "ok"; verified: true; contractName: string; deployedAt: number; privilegedRoles: string[] }
  | { kind: "not-verified" }
  | { kind: "error"; message: string };

export async function checkContractSecurity(address: Address | null): Promise<EtherscanResult> {
  // cache check + AbortController timer + fetch + try/catch + cacheInsert
  // (mirror fourbyte.ts:69-148 verbatim with Etherscan API URL substituted)
}

export function _resetEtherscanCacheForTesting(): void {
  cache.clear();
}
```

**Critical inheritance**: NEVER throws (`fourbyte.ts:69` documents this contract); errors → `{ kind: "error", message }` so the caller (the tool handler) treats it as best-effort. Same `clearTimeout` discipline in the `finally` block (`fourbyte.ts:140-143`) so timers don't leak.

**Etherscan-specific concerns** (research must validate):
- API key: read from `process.env.ETHERSCAN_API_KEY`; absent → fall back to public rate limit (5 req/sec, 100k req/day); surface as a degraded mode (analogous to `isPublicNodeFallback`).
- Endpoint: V2 unified-API (`https://api.etherscan.io/v2/api?chainid=1&...`). Phase 8 widens via the `chainid` query param.
- Rate-limit pattern: simple in-process throttler OR delegate to the public limit and let 429s flow through as `{ kind: "error", message: "rate-limited" }`.
- Privileged-role enumeration: research § Topic 7 (or wherever the methodology lands) must name the ABI introspection approach — `owner()` + `Ownable2Step` + `AccessControl` `DEFAULT_ADMIN_ROLE` + `Pausable.paused()`.

---

### `src/protocols/aave-v3.ts` — analog: `src/protocols/weth9.ts`

**Module header + ABI const + selectors + encoder shape** — copy `weth9.ts:1-94` structurally:
```typescript
// Third occupant of `src/protocols/` — Aave V3 Pool primitives for Phase 7.
// Consumed by:
//   - src/tools/prepare_aave_supply.ts   (encodeAaveSupply)
//   - src/tools/prepare_aave_withdraw.ts (encodeAaveWithdraw)
//   - src/tools/preview_send.ts          (combined-ABI decode — supply + withdraw selectors)
//   - src/signing/blocks.ts              (DECODED ARGS templates for supply + withdraw)

import { type Address, type Hex, encodeFunctionData, parseAbi } from "viem";

import { getAaveV3PoolAddress, type ChainId } from "../config/contracts.js";

export const AAVE_V3_POOL_ABI = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
]);

export const AAVE_V3_SELECTORS = {
  supply: "0x617ba037" as Hex,    // VERIFY at execute time via viem.toFunctionSelector
  withdraw: "0x69328dec" as Hex,  // VERIFY at execute time via viem.toFunctionSelector
} as const;

export function encodeAaveSupply(
  asset: Address,
  amount: bigint,
  onBehalfOf: Address,
  referralCode = 0,
): Hex {
  return encodeFunctionData({
    abi: AAVE_V3_POOL_ABI,
    functionName: "supply",
    args: [asset, amount, onBehalfOf, referralCode],
  });
}

export function encodeAaveWithdraw(asset: Address, amount: bigint, to: Address): Hex {
  return encodeFunctionData({
    abi: AAVE_V3_POOL_ABI,
    functionName: "withdraw",
    args: [asset, amount, to],
  });
}
```

**Combined-ABI decode fragment** (for preview_send extension; mirrors `erc20.ts:62-76`):
```typescript
// Decode-only fragment for preview_send.ts combined-ABI dispatch. Encoder side
// uses AAVE_V3_POOL_ABI; the decode side joins this fragment into
// AAVE_V3_COMBINED_DECODE_ABI to extend the existing dispatcher.
export const AAVE_V3_DECODE_FRAGMENT = AAVE_V3_POOL_ABI;  // identical for Aave (unlike WETH9 split)
```

**Discriminated-union decode** (mirrors `erc20.ts:115-172` shape):
```typescript
export type AaveV3Decoded =
  | { kind: "supply"; asset: Address; amount: bigint; onBehalfOf: Address; referralCode: number }
  | { kind: "withdraw"; asset: Address; amount: bigint; to: Address; isMax: boolean }
  | { kind: "unknown"; selector: Hex };

export function decodeAaveV3Call(data: Hex): AaveV3Decoded {
  // Mirror erc20.ts:138-172 verbatim with the two cases above.
  // isMax: amount === MAX_UINT256 for withdraw — surfaces "ENTIRE BALANCE" in DECODED ARGS.
}

// ESM spy-affordance per project CLAUDE.md.
export const _protocols = { decodeAaveV3Call };
```

**Selector verification** — Plan 07-01 must include a regression test `test/protocols-aave-v3.test.ts` mirroring `test/protocols-erc20.test.ts` that asserts the 4-byte selectors against `viem.toFunctionSelector(...)`. Pattern: hard-coded literal anchor (same fixture discipline as Phase 4/6).

## 3. Modification Touchpoints

### `src/config/contracts.ts` — Plan 07-01

**Current state** (lines 27-31):
```typescript
export interface ContractsForChain {
  weth: Address;
  // Phase 7 will add: aavePool: Address;
  // Phase 7+ may add: lido, eigenLayer, ...
}
```

**Phase 7 extension** — add `aavePool` to the interface AND a parallel const for the surrounding contracts:
```typescript
export interface ContractsForChain {
  weth: Address;
  aavePool: Address;
  aaveUiPoolDataProvider: Address;
  aavePoolAddressesProvider: Address;
  aaveOracle: Address;
}

const CONTRACTS_RAW: Record<ChainId, ContractsForChain> = {
  1: {
    weth: getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
    aavePool: getAddress("0x87870Bca3F3fd6335C3F4ce8392D69350B4fA4E2"),
    aaveUiPoolDataProvider: getAddress("0x..."),     // verified by researcher
    aavePoolAddressesProvider: getAddress("0x..."),  // verified by researcher
    aaveOracle: getAddress("0x..."),                 // verified by researcher
  },
};

export function getAaveV3PoolAddress(chainId: ChainId): Address {
  return CONTRACTS_RAW[chainId].aavePool;
}
// ... + getAaveV3UiPoolDataProvider, getAaveV3PoolAddressesProvider, getAaveV3Oracle
```

**KNOWN_SPENDERS_ETHEREUM correction** — the user prompt says "12th slot reserved for Phase 7". On inspection (lines 84-89), **Aave V3 Pool is already entry #1 of the seeded 11**. Plan 07-01 must NOT re-add it. The "12th slot" framing in the prompt is obsolete — the table already includes Aave. The regression-test `length >= 11` (test/config-contracts.test.ts:44) tolerates growth without churn IF Phase 7 adds a NEW spender (e.g. an Aave-related contract beyond the Pool, like the aTokens or the WrappedTokenGateway, if WrappedTokenGateway clear-sign coverage matters). **Recommendation for the planner**: if Phase 7 adds a WrappedTokenGateway spender (Aave's ETH-direct entry point — out of scope for the supply/withdraw against WETH path), it goes here. Otherwise, NO change to `KNOWN_SPENDERS_ETHEREUM`.

**Comment update**: line 79-82 anchors should be edited to remove the obsolete "12th candidate slot is reserved for Phase 7" framing. Replace with the actual table-extensibility rationale (`length >= 11` permits growth without churn).

---

### `src/tools/preview_send.ts` — Plan 07-03 (or split across 07-02 + 07-03)

**Current selector dispatch** (lines 318-343):
```typescript
const decodedArgs: Erc20Decoded = _protocols.decodeErc20Call(record.tx.data);
let tokenContext: { symbol: string; decimals: number } | null = null;
if (decodedArgs.kind === "transfer" || decodedArgs.kind === "approve") {
  const registry = loadEthereumTokenRegistry();
  const entry = registry.find((e) => e.address === record.tx.to);
  tokenContext = entry ? { symbol: entry.symbol, decimals: entry.decimals } : null;
}
// Plan 06-04 fills the withdraw branch — WETH context from contracts.ts
```

**Phase 7 extension** — two-tier selector dispatch:
1. Try ERC-20 decode first (existing path).
2. On `kind: "unknown"`, try Aave decode (NEW path).
3. On `kind: "unknown"` from Aave too, fall through to the generic 4byte cross-check (existing behavior).

```typescript
let decodedArgs: Erc20Decoded | AaveV3Decoded = _protocols.decodeErc20Call(record.tx.data);
if (decodedArgs.kind === "unknown") {
  const aaveDecoded = _aaveProtocols.decodeAaveV3Call(record.tx.data);
  if (aaveDecoded.kind !== "unknown") decodedArgs = aaveDecoded;
}
```

**Aave-specific tokenContext resolution**: for supply / withdraw, `decodedArgs.asset` (NOT `record.tx.to`) is the token contract — `record.tx.to` is the Pool address. The lookup MUST use `asset`, not `to`. This is the Phase-6-style T-TX-TO-CONFUSION-1 mitigation pattern adapted for Aave (where `tx.to` is the Pool, not the asset).

**LEDGER NOTICE conditional** — IF research § Topic 5-equivalent surfaces uncertainty about Aave clear-sign coverage on Ledger devices, emit `LEDGER_NOTICE_AAVE_TEMPLATE` ABOVE the LEDGER BLIND-SIGN HASH for the supply / withdraw selectors. Two-pronged condition mirrors WETH unwrap (preview_send.ts:391-395):
```typescript
const isAaveSupply = selector === AAVE_V3_SELECTORS.supply && record.tx.to === getAaveV3PoolAddress(1);
const isAaveWithdraw = selector === AAVE_V3_SELECTORS.withdraw && record.tx.to === getAaveV3PoolAddress(1);
const ledgerNoticeBlock: string | null = (isAaveSupply || isAaveWithdraw)
  ? LEDGER_NOTICE_AAVE_TEMPLATE
  : null;
```
**Research-pending decision**: if Aave V3 Pool has a Ledger clear-sign plugin and coverage is confirmed for `supply` + `withdraw`, the NOTICE block is NOT emitted (clean path). If coverage is uncertain or device-version-dependent, the NOTICE block fires. The plan can ship the conditional infrastructure either way; the boolean expression resolves to false on the confirmed-clear-sign path.

**JSON serialization extension** (preview_send.ts:419-431) — add the two new branches:
```typescript
const decodedArgsForJson =
  decodedArgs.kind === "supply"
    ? { kind: "supply" as const, asset: decodedArgs.asset, amount: decodedArgs.amount.toString(), onBehalfOf: decodedArgs.onBehalfOf, referralCode: decodedArgs.referralCode }
    : decodedArgs.kind === "withdraw" && "to" in decodedArgs  // discriminator: Aave withdraw has `to`, WETH9 withdraw doesn't
      ? { kind: "aave-withdraw" as const, asset: decodedArgs.asset, amount: decodedArgs.amount.toString(), to: decodedArgs.to, isMax: decodedArgs.isMax }
      : /* ...existing branches... */;
```

**FROZEN-area assertion**: The order of cross-check blocks (LEDGER → AGENT TASK → 4BYTE → DECODED ARGS → SIMULATION → VERIFY) MUST NOT change. The `presignHash` compute, the `previewToken` mint, the `transitionToPreviewed` call — all stay byte-identical. ONLY the decoded-args branch grows.

---

### `src/signing/blocks.ts` — Plan 07-03

**Append-only extensions** (mirror the Plan 06-02 / 06-03 / 06-04 additive shape; existing templates stay byte-identical):

```typescript
// Phase 7 — Plan 07-03. Append-only after Plan 06-04 templates. The Phase 4 +
// Phase 6 templates above stay unchanged (FROZEN).

export const AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  operation:    Aave V3 supply",
  "  asset:        {ASSET}",
  "  amount:       {AMOUNT}",
].join("\n");

export const AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  operation:    Aave V3 withdraw",
  "  asset:        {ASSET}",
  "  amount:       {AMOUNT}",
  "  to:           {TO}",  // self-recipient in v1.1; documented in description
].join("\n");

export const DECODED_ARGS_TEMPLATE_AAVE_SUPPLY: string = [
  "DECODED ARGS",
  "  function:     supply",
  "  pool:         {POOL_ADDRESS} (Aave V3 Pool — canonical)",
  "  asset:        {ASSET}",
  "  amount:       {AMOUNT_HUMAN}",
  "  amountWei:    {AMOUNT_WEI}",
  "  onBehalfOf:   {ON_BEHALF_OF}",
  "  referralCode: {REFERRAL_CODE}",
].join("\n");

export const DECODED_ARGS_TEMPLATE_AAVE_WITHDRAW: string = [
  "DECODED ARGS",
  "  function:  withdraw",
  "  pool:      {POOL_ADDRESS} (Aave V3 Pool — canonical)",
  "  asset:     {ASSET}",
  "  amount:    {AMOUNT_HUMAN}",
  "  amountWei: {AMOUNT_WEI}",
  "  to:        {TO}",
].join("\n");

// Optional — only emitted if Aave clear-sign coverage is uncertain (mirror of
// LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE; research must validate).
export const LEDGER_NOTICE_AAVE_TEMPLATE: string = [
  "LEDGER NOTICE",
  "  Aave V3 supply/withdraw clear-sign coverage is device-version-dependent.",
  "  Your device may BLIND-SIGN this transaction (display a raw hash, no decoded args).",
  "  If your device refuses with \"Blind signing is not enabled\":",
  "    1. Open the Ethereum app on your device",
  "    2. Settings → Blind signing → Enabled",
  "    3. Retry send_transaction",
  "  Match the LEDGER BLIND-SIGN HASH below CHARACTER-FOR-CHARACTER against",
  "  the value your device displays — this is the cryptographic anchor.",
].join("\n");
```

**Render-helper extension** (blocks.ts:338-416) — `buildDecodedArgsBlock` grows two branches OR (more honestly) Phase 7 ships a parallel `buildAaveDecodedArgsBlock(decoded, poolAddress)`. Preferred: parallel helper (cleaner separation; preview_send calls one OR the other based on which decoder returned non-`unknown`). This keeps `Erc20Decoded` and `AaveV3Decoded` as separate types, no widening.

**Format-fanout-sentinel**: every new template is referenced by exactly ONE call site — the corresponding prepare_* OR preview_send branch. Phase 6 retro line 142 codifies this discipline.

---

### `src/tools/register-all.ts` — touched by Plans 07-02 + 07-03 + 07-04

**Current shape** (register-all.ts:1-23) — 23 import lines, alphabetic by file but de-facto grouped by phase:
```typescript
import "./get_lending_positions.js";       // Plan 07-02
import "./check_contract_security.js";     // Plan 07-04
import "./prepare_aave_supply.js";         // Plan 07-03
import "./prepare_aave_withdraw.js";       // Plan 07-03
import "./simulate_position_change.js";    // Plan 07-03
```

**Conflict-avoidance carve** (Phase 4 retro line 124 — Plan 04-02 + 04-05 trivially conflicted on same final position):
- **Plan 07-02** owns insertion AFTER `get_portfolio_summary` (group: reads).
- **Plan 07-03** owns insertion BEFORE `preview_send` (group: prepare_*).
- **Plan 07-04** owns insertion AFTER `get_token_metadata` (group: reads — defense / metadata).

This carve avoids same-line-position conflicts. Worst case: trivial rebase per Phase 4's experience (30 seconds). Plan-checker can flag this discipline.

## 4. Reusable Primitives — Phase 7 MUST Consume, NOT Reimplement

Per § Phase 6 retro line 142 ("mechanical-clone pattern held up across 4 tools") + the `<cryptographic_binding>` invariant.

| Primitive | Source | Phase 7 caller(s) | Call sketch |
|---|---|---|---|
| `createHandle({ args, tx, payloadFingerprint })` | `src/signing/handle-store.ts:128-144` | All 3 prepare_aave_* tools | `createHandle({ args: { to: "", valueWei: "0", tokenAddress: rawAsset, amount: rawAmount }, tx, payloadFingerprint })` |
| `computePayloadFingerprint({ chainId, to, valueWei, data })` | `src/signing/payload-fingerprint.ts:36-49` | All 3 prepare_aave_* tools | `computePayloadFingerprint({ chainId: 1, to: getAaveV3PoolAddress(1), valueWei: 0n, data })` — FROZEN, do NOT add new fields to the preimage |
| `parseAmountStrict(amountStr, decimals)` | `src/signing/amount.ts:77-106` | `prepare_aave_supply`, `prepare_aave_withdraw` (the non-"max" branch) | `parseAmountStrict(rawAmount, decimals)` — throws `InvalidAmountError` on empty/format/fractional-overflow; caller converts to structured `INVALID_INPUT` envelope |
| `MAX_UINT256` | `src/protocols/erc20.ts:58` | `prepare_aave_withdraw` (the `"max"` branch) | `amountWei = MAX_UINT256` — Aave Pool treats `type(uint256).max` as "withdraw entire balance" |
| `runPreviewSimulation({ client, sender, tx })` | `src/signing/simulation.ts:55-83` | INHERITED by Aave prepare_* via `preview_send` | NO direct call — `preview_send` runs it for ALL tx shapes (Phase 6 retro line 140: "Phase 4 native sends got preview-time simulation for free") |
| `lookupSpender(spender)` | `src/config/contracts.ts:155-158` | INHERITED — Phase 7 does NOT add new spender labels (Aave Pool is already entry #1) | n/a |
| `getEthereumClient()` | `src/chains/ethereum.ts:13-33` | `get_lending_positions`, `simulate_position_change`, `prepare_aave_supply` (for decimals lookup on off-list asset), `check_contract_security` (for deployment-age block-number reads) | `const client = getEthereumClient(); await client.readContract({...})` |
| `isPublicNodeFallback()` | `src/chains/ethereum.ts:35-38` | All read tools | `if (isPublicNodeFallback()) result.rpcDegraded = true;` |
| `loadEthereumTokenRegistry()` | `src/tokens/registry.ts` | `prepare_aave_supply`, `prepare_aave_withdraw` (registry-cache-first decimals lookup) | Mirror `prepare_token_send.ts:102-114` resolveDecimals helper |
| `makeStructuredError(code, message, cause?)` | `src/signing/error-codes.ts:71-76` | All 5 new tools | `errEnvelope("INVALID_INPUT", "invalid 'asset': ...")` — uniform envelope shape across the codebase |
| `getActivePersona()` + `isDemoMode()` | `src/demo/state.ts` + `src/config/env.ts` | All 3 prepare_aave_* tools | Verbatim copy of `prepare_weth_unwrap.ts:104-140` SENDER resolution branch |
| `getStatus()` (WC session) | `src/wallet/session-manager.ts` | All 3 prepare_aave_* tools (real-mode branch) | Same verbatim copy |
| `transitionToPreviewed` / `transitionToSent` / `transitionToCancelled` | `src/signing/handle-store.ts:167-211` | INHERITED via `preview_send` + `send_transaction` | NO direct call from Phase 7 code |
| `_protocols.decodeErc20Call` (existing) | `src/protocols/erc20.ts:180` | `preview_send` extension | Existing call; Phase 7 chains `_aaveProtocols.decodeAaveV3Call` AFTER on `unknown` fall-through |

**Error codes** — Phase 7 reuses the locked 15-code set in `src/signing/error-codes.ts:37-52`. No new codes needed unless `check_contract_security` introduces `ETHERSCAN_UNREACHABLE` as a distinct surface; reasonable-call is to fold it into the existing `INTERNAL_ERROR` with a `cause` field (mirrors fourbyte's `BROADCAST_FAILED` → `INTERNAL_ERROR` precedent).

## 5. Anti-Patterns Phase 7 MUST NOT Repeat (from Phase 1-6 retros)

1. **No inline contract addresses.** Every Aave address (Pool, PoolAddressesProvider, UiPoolDataProviderV3, AaveOracle) lives in `src/config/contracts.ts` ONLY, `getAddress`-checksummed at the literal site. Regression-tested via `test/config-contracts.test.ts`. Phase 6 retro line 148 codified this; Phase 7 inherits.
2. **No soft schema checks for `userDecision`-class enums.** `prepare_aave_withdraw`'s `"max"` sentinel is enforced via strict equality (`rawAmount === "max"` only), with non-canonical spellings (`"MAX"`, `"unlimited"`) rejected through `parseAmountStrict`'s regex. Plan 06-03's T-MAX-SPELLING-1 lesson.
3. **No `beforeAll`-snapshot fixtures.** Fixtures G + H (Aave supply + withdraw) are hardcoded `0x...` literals in `test/signing-fingerprint.test.ts`. Project CLAUDE.md Conventions section codifies this; Phase 6 retro line 144 reinforced.
4. **No reimplementation of `prepare_*` scaffolding.** The mechanical-clone pattern (Phase 6 retro line 141) prescribes bounded diffs only: schema, encoder, `tx.to`, `valueWei`, RECEIPT template. The handle/fingerprint/error-envelope scaffolding is byte-identical to `prepare_weth_unwrap.ts`.
5. **ESM spy-affordance pre-emptively.** `src/protocols/aave-v3.ts` ships `export const _protocols = { decodeAaveV3Call };` from the first commit. Plan 05-01 retro line 130 codified the "add at write time, not retroactively" rule.
6. **FROZEN-area discipline in every plan's `<success_criteria>`.** Each Phase 7 plan asserts zero-diff on: `src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/signing/handle-store.ts` state machine, `src/tools/send_transaction.ts` three gates. Plan-checker dimension. Phase 6 retro line 142 + 06-01 BLOCK precedent.

## 6. Cryptographic-Binding Chain Delta

### What Phase 7 changes
- **`preview_send.ts` selector dispatch** — additive only. The existing `_protocols.decodeErc20Call` path stays; Phase 7 chains `_aaveProtocols.decodeAaveV3Call` AFTER on `unknown` fall-through.
- **`src/signing/blocks.ts`** — append-only template additions (4 new templates + optional LEDGER NOTICE). Existing templates byte-identical.
- **`src/config/contracts.ts`** — `ContractsForChain` interface widens with 4 new fields; `KNOWN_SPENDERS_ETHEREUM` UNCHANGED (Aave Pool already seeded).

### What Phase 7 does NOT touch (FROZEN)
- **`src/signing/payload-fingerprint.ts`** — preimage assembly `DOMAIN_TAG ‖ chainId ‖ to ‖ value ‖ data` byte-frozen. Phase 7 adds no new fields.
- **`src/signing/presign-hash.ts`** — EIP-1559 pre-sign hash compute byte-frozen.
- **`src/signing/handle-store.ts` state machine** — `prepared → previewed → sent | cancelled` byte-frozen. Phase 7 may extend `PrepareArgs` with an optional `asset` field IF the planner decides not to alias-onto `tokenAddress` — but the OPTIONAL-widening discipline from Plan 06-02 (handle-store.ts:48-58) keeps existing callers byte-identical.
- **`src/tools/send_transaction.ts`** — three-gate refusal logic byte-frozen. The handler builds `txParams` from `record.tx` + `record.pinned` ONLY; agent args never influence the tx envelope (send_transaction.ts:430-446).
- **`src/signing/error-codes.ts`** — 15-code locked union byte-frozen (no new codes for Phase 7).

### Fixture additions
- **Fixture G** — `Pool.supply(asset=USDC, amount=100e6, onBehalfOf=<known>, referralCode=0)` `payloadFingerprint` as hardcoded literal in `test/signing-fingerprint.test.ts`. Computed once at execute time against the in-tree `computePayloadFingerprint`, pinned forever. Cross-linked from `test/prepare-aave-supply.test.ts` + `test/aave-v3-lifecycle.integration.test.ts`.
- **Fixture H** — `Pool.withdraw(asset=USDC, amount=MAX_UINT256, to=<known>)` `payloadFingerprint` as hardcoded literal. Same shape. Cross-linked from `test/prepare-aave-withdraw.test.ts` + `test/aave-v3-lifecycle.integration.test.ts`.

Both fixtures honor the project CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals" convention.

## 7. Test Surface Notes

### New test files
| Test File | Scope | Mirrors |
|---|---|---|
| `test/protocols-aave-v3.test.ts` | Selector byte-identity + encoder round-trips + decode discriminated-union exhaustiveness | `test/protocols-erc20.test.ts` + `test/protocols-weth9.test.ts` |
| `test/config-contracts.test.ts` (extend, not new) | Aave V3 Pool + UiPoolDataProvider + AddressesProvider + Oracle byte-identity assertions | Existing patterns at lines 28-72 |
| `test/clients-etherscan.test.ts` | Rate-limit (cache hit / miss); 4-kind discriminated-union surfacing (ok / not-verified / error / not-applicable); never-throws contract | `test/fourbyte.test.ts` |
| `test/get-lending-positions.test.ts` | UiPoolDataProviderV3 read mocked; per-asset rows + health-factor math + rpcDegraded surface | `test/get-portfolio-summary.test.ts` |
| `test/prepare-aave-supply.test.ts` | Schema validation + parseAmountStrict + encoder + RECEIPT byte-identity + Fixture G anchor | `test/prepare-weth-unwrap.test.ts` |
| `test/prepare-aave-withdraw.test.ts` | Same + `"max"` sentinel branch (T-MAX-SPELLING-1) + Fixture H anchor | `test/prepare-weth-unwrap.test.ts` + `test/prepare-token-approve.test.ts` |
| `test/simulate-position-change.test.ts` | Read-leg + math-leg + warning surfacing; NEVER mutates state | `test/get-portfolio-summary.test.ts` (read-leg shape) |
| `test/check-contract-security.test.ts` | Etherscan client wrapper; verified / unverified / error envelope; agent-facing structuredContent shape | `test/get-token-metadata.test.ts` |
| `test/preview-send.aave.test.ts` | Selector-routed DECODED ARGS for supply + withdraw; tokenContext resolution from `decodedArgs.asset` (not `tx.to`); LEDGER NOTICE conditional | `test/preview-send.erc20.test.ts` |
| `test/aave-v3-lifecycle.integration.test.ts` | Full prepare → preview → send simulation pipeline; persona-cycle `from`-independence (Fixtures G + H byte-identical across whale ↔ stable-saver ↔ defi-degen) | `test/erc20-lifecycle.integration.test.ts` |

### `test/signing-fingerprint.test.ts` extension
Add two `it(...)` blocks following the Fixture F shape (signing-fingerprint.test.ts:91-111):
- `"Fixture G — Aave V3 supply(USDC, 100e6, onBehalfOf, 0) fingerprint (hardcoded literal anchor, Phase 7 / Plan 07-03)"` — anchors `0x{...}`
- `"Fixture H — Aave V3 withdraw(USDC, MAX_UINT256, to) fingerprint (hardcoded literal anchor, Phase 7 / Plan 07-03)"` — anchors `0x{...}`

Cross-linked from per-tool tests + integration test. T-INTEGRATION-FROM-DRIFT-1 mitigation extends: drift in the preimage assembly for ANY of Aave's 2 calldata shapes breaks one of these.

### Integration-test load-bearing assertion
Mirror `test/erc20-lifecycle.integration.test.ts:381-478` shape:
```typescript
describe("Aave V3 lifecycle integration — Fixtures G/H from-independence across personas", () => {
  it("Fixture G (Aave supply USDC 100): same payloadFingerprint across whale ↔ stable-saver ↔ defi-degen", async () => {
    const fingerprintsByPersona = new Map<string, string>();
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);
      const result = await callTool("prepare_aave_supply", { asset: USDC, amount: "100" });
      const sc = result.structuredContent as { from: string; payloadFingerprint: string };
      expect(sc.from).toBe(personaAddress(persona));
      fingerprintsByPersona.set(persona, sc.payloadFingerprint);
    }
    for (const persona of PERSONAS_UNDER_TEST) {
      expect(fingerprintsByPersona.get(persona)).toBe(FIXTURE_G_FINGERPRINT);
    }
  });
  // ... + Fixture H block
});
```

**STOP-THE-LINE**: any fingerprint mismatch across personas means the cryptographic-binding chain became `from`-dependent. Release blocker (same T-INTEGRATION-FROM-DRIFT-1 invariant).

## 8. Greenfield Design Notes — `simulate_position_change`

The only file in scope without a perfect analog. Surfacing the open design decisions for the planner:

1. **Tool granularity** — Recommendation: SEPARATE TOOL (not a sub-feature of `get_lending_positions`, not a flag on prepare_*). Mirrors `prepare_revoke_approval` precedent: distinct intent → distinct named tool. Cost: one extra tool registration.
2. **Input shape** — Recommendation: `{ asset, action: "supply" | "withdraw", amount }` (enum-locked direction). Aligned with project CLAUDE.md "strict-mode parity with userDecision's enum lock" convention.
3. **Health-factor math** — Off-chain bigint compute against Aave's RAY (1e27 fixed-point) precision. Research § Topic 4 (or equivalent) will name the formula:
   - `healthFactor = (totalCollateralInBase × averageLiquidationThreshold) / totalDebtInBase`
   - All inputs come from `UiPoolDataProviderV3.getUserAccountData(user)` — a single RPC read.
4. **Trust-boundary surface** — The tool's description MUST name simulation as a USABILITY signal, never a signing precondition. Mirror `src/signing/simulation.ts:18-24` invariant prose.
5. **Shared helper with `get_lending_positions`** — `getUserAccountData(user, client)` lives in `get_lending_positions.ts` as a non-exported helper IF Plan 07-02 ships first; OR moves to `src/chains/aave-v3.ts` (new file — analog of `src/chains/erc20-scanner.ts`) IF the planner prefers a sibling-shelf shape. Recommendation: sibling-shelf shape — `src/chains/aave-v3.ts` exports `getUserAccountData` + `getUserReservesData`; both `get_lending_positions` and `simulate_position_change` import. Mirror of `src/chains/erc20-scanner.ts` precedent (which both `get_portfolio_summary` and `get_token_balance` consume).

## 9. Plan Carve Recommendation (planner's call — flagged here for the orchestrator)

ROADMAP.md proposes 4 plans (07-01 → 07-04). Pattern-mapper validates this split:

- **Plan 07-01** — SOT extension (`src/config/contracts.ts` + Aave records + regression test). Sequential prerequisite — every other plan imports `getAaveV3PoolAddress`. Minimum 1 atomic commit.
- **Plan 07-02** — `get_lending_positions` + `src/chains/aave-v3.ts` (sibling-shelf helper) + health-factor math + Plan 07-02-PATTERNS-style fixture. Depends on 07-01.
- **Plan 07-03** — `prepare_aave_supply` + `prepare_aave_withdraw` + `simulate_position_change` + `src/protocols/aave-v3.ts` + `preview_send` selector-dispatch extension + `blocks.ts` template additions + Fixtures G + H + lifecycle integration test. Depends on 07-01 + 07-02. **Largest plan** — research-pending design forks (LEDGER NOTICE conditional, simulate granularity) resolve here.
- **Plan 07-04** — `check_contract_security` + `src/clients/etherscan.ts` + Etherscan API config wiring. Independent of 07-02 + 07-03; CAN ship parallel to 07-03 IF the orchestrator wants Phase-4-style parallelism (Phase 4 retro line 124).

**Recommended carve order**: 07-01 → 07-02 → (07-03 ∥ 07-04) → close-out. Parallelism IS possible at the 07-03 ∥ 07-04 boundary — both depend only on 07-01.

## Metadata

**Analog search scope**: `src/tools/*.ts`, `src/protocols/*.ts`, `src/signing/*.ts`, `src/clients/*.ts`, `src/chains/*.ts`, `src/config/*.ts`, `test/*.test.ts`
**Files scanned**: 24 source files + 3 test files (full read on 7 critical analogs; targeted reads on 4 supporting files)
**Pattern extraction date**: 2026-05-13
**No-analog items**: 1 (`simulate_position_change` — design notes in § 8)
**FROZEN-area assertion files**: 4 (`payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts` state machine, `send_transaction.ts` three gates)
