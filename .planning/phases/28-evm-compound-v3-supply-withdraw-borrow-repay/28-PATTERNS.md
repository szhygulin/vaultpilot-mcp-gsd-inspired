# Phase 28: Compound V3 — Pattern Map

**Mapped:** 2026-05-20
**Phase scope:** CMP-01..06 (multi-Comet supply / withdraw / borrow / repay on Ethereum mainnet)
**Files in scope:** 7 new src/, 5 modifications, 7 new tests + 1 test extension
**Analogs found:** strong matches for every file — Phase 7 (Aave V3) is the parallel-protocol precedent the whole phase mirrors. One genuinely new pattern: **intent-vs-reality gates** (4 agent intents, 2 calldata selectors — Aave didn't need this).

Phase 7 cleared most of the structural ground Phase 28 needs:

- The `src/protocols/` shelf has three occupants (`erc20.ts`, `weth9.ts`, `aave-v3.ts`) — Phase 28's `compound-v3.ts` is occupant #4, byte-shape locked to `aave-v3.ts`.
- The `src/chains/` sibling-shelf has one Aave-shaped occupant (`aave-v3.ts` — UiPoolDataProviderV3 reads) — Phase 28's `compound-v3.ts` mirrors it for per-Comet reads.
- The `src/signing/` shelf has `aave-health.ts` (pure-bigint Aave HF math) — Phase 28's `compound-collateralization.ts` mirrors it for Compound's `isBorrowCollateralized` / `isLiquidatable` booleans + collateral-USD / borrow-USD ratio.
- The `src/config/contracts.ts` SOT has 5 typed Aave V3 slots (per chain) — Phase 28 adds 6 typed Comet slots on Ethereum only. Multi-chain v2.3.x.
- The `prepare_*` mechanical-clone pattern is rehearsed 6 times across Phases 6 + 7 — Phase 28's 4 new prepare tools (`prepare_compound_supply` / `_withdraw` / `_borrow` / `_repay`) are clones with bounded diffs plus a new intent-gate prologue.
- The cryptographic-binding chain (`payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts` state machine, `send_transaction.ts` three gates) is **FROZEN** — Phase 28 adds NO new shapes to the preimage assembly. Fixtures R / S / T / U are byte-literal anchors only.
- The `preview_send.ts` two-tier dispatch (ERC-20 → Aave fall-through) extends to three-tier: ERC-20 → Aave → Compound. Same fall-through shape.
- The `canonical-dispatch.ts` per-chain allowlist receives 6 additive Comet addresses on the Ethereum arm.
- **Locked**: `@compound-finance/compound-js` REJECTED (ethers-v5-locked, stale, returns broadcast tx envelopes not unsigned bytes) — `viem.parseAbi` inline fragments are the encoder/decoder SOT for Phase 28. Mirror of Phase 7 / Aave's verdict against ethers-v5.

## 1. File-to-Analog Mapping

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality | Bounded Diffs |
|---|---|---|---|---|---|
| `src/protocols/compound-v3.ts` (NEW) | protocol module | encode + decode + selector table | `src/protocols/aave-v3.ts` | exact | ABI fragment over Comet (`supply` / `withdraw` / `baseToken` / `borrowBalanceOf` / `balanceOf` / `isBorrowCollateralized` / `isLiquidatable` / `getSupplyRate` / `getBorrowRate` / `getReserves`); **2 calldata selectors** (`supply(address,uint256)` + `withdraw(address,uint256)`) → 4 intent kinds in the decoder discriminated union (see § Greenfield) |
| `src/chains/compound-v3.ts` (NEW) | reader sibling-shelf | RPC reads | `src/chains/aave-v3.ts` | role-match | Per-Comet reads (not a single UiPoolDataProviderV3) — one Comet = one isolated market. Helper `getCometState(client, cometAddress, user)` returns `{ baseToken, baseSupplied, baseBorrowed, isBorrowCollateralized, isLiquidatable, supplyRate, borrowRate }` per call. Fan out across Phase 28's 6 mainnet Comets via `Promise.all` (mirror of `get_portfolio_summary`'s concurrent reads) |
| `src/signing/compound-collateralization.ts` (NEW) | trust-shelf math | pure compute | `src/signing/aave-health.ts` | role-match | Pure-bigint. Output type widens to: `{ isBorrowCollateralized: boolean, isLiquidatable: boolean, collateralValueUsd: bigint, borrowValueUsd: bigint, ratioScaled: bigint \| null, noDebt: boolean }`. NOT Aave's normalized HF — Compound uses boolean gates + a ratio. Constants: PRICE_FEED_SCALE (1e8 — Compound's price feed decimals), COLLATERAL_FACTOR_SCALE (1e18) |
| `src/tools/prepare_compound_supply.ts` (NEW) | prepare tool | request-response | `src/tools/prepare_aave_supply.ts` | exact (+ intent gate) | Input schema `{ chain: "ethereum", comet: Address, asset: Address, amount }`; encoder = `encodeCompoundSupply(asset, amountWei)`; `tx.to = comet`; `tx.valueWei = 0n`; **intent-gate prologue** (see § Greenfield); RECEIPT template `COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE` (NEW; see § Blocks) |
| `src/tools/prepare_compound_withdraw.ts` (NEW) | prepare tool | request-response | `src/tools/prepare_aave_withdraw.ts` | exact (+ intent gate, reversed) | Same calldata selector as supply for collateral-withdraw OR borrow (`withdraw(asset, amount)`). Intent gate: refuse if `asset === baseToken && userSupplyBalance > 0` — point at `prepare_compound_borrow`. `to` is the Comet contract (Compound's withdraw transfers to `msg.sender` — there is NO `to` arg unlike Aave). `"max"` sentinel via MAX_UINT256 (Compound's protocol-level full-balance flag) |
| `src/tools/prepare_compound_borrow.ts` (NEW) | prepare tool | request-response | `src/tools/prepare_aave_withdraw.ts` + intent-gate prologue | role-match | Same selector as `_withdraw` (`withdraw(asset, amount)`). Intent gate: refuse if `asset !== baseToken` OR if `userSupplyBalance > 0` (this is a withdraw, not a borrow) — point at `prepare_compound_withdraw`. `"max"` NOT accepted (borrowing entire credit is not a meaningful default — borrow up to current collateralization ceiling is too dynamic to encode as max) |
| `src/tools/prepare_compound_repay.ts` (NEW) | prepare tool | request-response | `src/tools/prepare_aave_supply.ts` + intent-gate prologue | role-match | Same selector as `_supply` (`supply(asset, amount)`). Intent gate: refuse if `asset !== baseToken` OR if `userBorrowBalance === 0n` (this is a supply-collateral, not a repay-debt) — point at `prepare_compound_supply`. **`"max"` ACCEPTED** → MAX_UINT256 (Compound's protocol-level full-position-close flag); mirror Phase 6 `prepare_token_approve` T-MAX-SPELLING-1 strict-equality discipline |
| `src/tools/get_compound_market_info.ts` (NEW) | read tool | request-response + multicall | `src/tools/get_lending_positions.ts` (Phase 7 — read leg only) | role-match | Per-Comet: supply APR, borrow APR, base-token symbol, collateral factors per supported asset, liquidation factors, total-supply, total-borrow, utilization. Tool surface focused on Comet METADATA (not user position) — no wallet arg. Mirror `get_lending_positions`'s concurrent-read shape against 6 Comets |
| `src/tools/get_lending_positions.ts` (EXTEND) | read tool | request-response + multicall | n/a (extends own pattern) | n/a | Discriminated-union widening on each row: add `protocol: "aave-v3" \| "compound-v3"`. Aave rows keep existing fields; Compound rows shape: `{ protocol: "compound-v3", comet, baseToken, baseSymbol, suppliedHuman, borrowedHuman, suppliedUsd, borrowedUsd, supplyApr, borrowApr, isBorrowCollateralized, isLiquidatable }`. Top-level result extends with `sources: { aave: {...current shape...}, compound: { perComet: [...] } }`. **No breaking change** — existing `positions` array remains; new rows joined alongside. Mirror Plan 02-XX `get_portfolio_summary` discriminated-union approach. See § Greenfield for the precise shape. |
| `src/tools/simulate_position_change.ts` (EXTEND) | read tool (compute-only) | request-response + RPC reads | n/a (extends own pattern) | n/a | Add `protocol: "aave-v3" \| "compound-v3"` input slot (defaults to `"aave-v3"` for back-compat). Compound arm reads via `_compoundChains.getCometState` + applies the same 4-action delta + recomputes Compound's `isBorrowCollateralized` / `isLiquidatable` booleans + projected ratio. Output widens: existing Aave-shape unchanged; Compound shape returns `{ currentRatio, projectedRatio, isBorrowCollateralizedCurrent, isBorrowCollateralizedProjected, warning?: "would-liquidate" \| "near-liquidation" }`. Same TRUST-BOUNDARY invariant: simulation is a USABILITY signal, never a signing precondition |
| `src/config/contracts.ts` (EXTEND) | config SOT | static data | n/a (extends own pattern) | n/a | Append 6 typed slots to `ContractsForChain` interface (`compoundCometUsdcV3` / `_UsdtV3` / `_WethV3` / `_UsdsV3` / `_WstethV3` / `_WbtcV3`) — **Ethereum row only** populated; other 4 chain rows get a NEW optional shape `compoundComets?: Partial<…>` OR Phase 28 extends the interface with the 6 required-on-Ethereum / undefined-elsewhere slots via a separate per-chain Comet sub-record. Plan-checker recommends a sibling const `COMPOUND_COMETS_RAW: Partial<Record<ChainId, Record<CometBase, Address>>>` keyed by ChainId + base symbol, plus getter `getCompoundCometAddress(chainId, base)` returning `Address \| null` (null = market not deployed on this chain). Cleaner than widening `ContractsForChain` with 6 required-on-Ethereum slots when v2.3.x will add Polygon/Arbitrum/Base/Optimism arms. Format-fanout-sentinel: every literal `getAddress(...)`-wrapped. Plus parallel `KNOWN_SPENDERS_ETHEREUM` extension — add 6 Compound Comet rows (alphabetical-by-label preserved) |
| `src/security/canonical-dispatch.ts` (EXTEND) | security SOT | static data | n/a (extends own pattern) | n/a | Extend `buildPerChainAllowlist(1)` to include the 6 Ethereum Compound Comet addresses via the new `getCompoundCometAddress` SOT getter. **Ethereum arm ONLY** — other chains untouched (Phase 28 mainnet-only). Membership count grows from 20 to 26 on Ethereum |
| `src/signing/blocks.ts` (EXTEND) | format SOT | static templates | n/a (extends own pattern) | n/a | Append-only: 4 PREPARE RECEIPT templates (one per Compound prepare tool) + 2 DECODED ARGS templates (one for each calldata selector — supply / withdraw) + **`LEDGER_NOTICE_COMPOUND_TEMPLATE`** (mirror `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE`: Compound IS NOT in the LedgerHQ ERC-7730 calldata registry per research § Topic 8; the device WILL blind-sign — NOTICE block REQUIRED). **Existing templates byte-identical** |
| `src/tools/preview_send.ts` (EXTEND) | trust-pipeline tool | request-response | n/a (extends own pattern) | n/a | Three-tier dispatch: ERC-20 → Aave → Compound (fall-through on `unknown`). Additive `_compoundProtocols.decodeCompoundV3Call(data)` branch. Token-context resolution for Compound supply/withdraw uses `decoded.asset` (mirror of the T-AAVE-TX-TO-CONFUSION-1 fix — `record.tx.to` is the Comet, not the asset). LEDGER NOTICE conditional: `selector ∈ {supply, withdraw} && record.tx.to is one of the 6 Ethereum Comets` → emit `LEDGER_NOTICE_COMPOUND_TEMPLATE`. **The file's structure remains FROZEN** — selector dispatch + block emission only |
| `src/tools/register-all.ts` (EXTEND) | bootstrap | side-effect imports | n/a (extends own pattern) | n/a | +5 import lines (4 prepare tools + `get_compound_market_info`). Plan-wave carve below avoids same-line conflicts |

## 2. Pattern Assignments — Concrete Code to Copy

### `src/protocols/compound-v3.ts` (NEW) — analog: `src/protocols/aave-v3.ts`

**Header + ABI const + selectors + encoder + decoder** — mirror `aave-v3.ts:1-187` structurally:

```typescript
// Fourth occupant of `src/protocols/` — Compound V3 (Comet) primitives for
// Phase 28. Mirror of `src/protocols/aave-v3.ts` (Phase 7) shape verbatim.
//
// SDK reality (verified against viem@2.48.11 + research § Topic 1):
//   - `@compound-finance/compound-js` REJECTED — ethers-v5-locked, stale,
//     returns broadcast tx envelopes (NOT unsigned bytes).
//   - `parseAbi(...)` over the Comet ABI fragment is the canonical pattern.
//   - Selectors verified at execute-time via `viem.toFunctionSelector` in
//     `test/protocols-compound-v3.test.ts`:
//       supply(address,uint256)   → 0x...  (TBD — verify at write time)
//       withdraw(address,uint256) → 0x...  (TBD — verify at write time)
//
// Compound V3's calldata reality: ONE `supply(asset, amount)` selector covers
// both supply-collateral AND repay-debt (depending on whether `asset` is the
// Comet's `baseToken` and whether the user has a debt position). ONE
// `withdraw(asset, amount)` selector covers both withdraw-collateral AND
// borrow. The 4 agent-intent tools (supply / withdraw / borrow / repay) route
// through these 2 selectors. The decoder names the SELECTOR; the intent gate
// (in prepare_compound_*) names the INTENT. See § Greenfield for the gate.
//
// Consumed by:
//   - src/tools/prepare_compound_supply.ts    (encodeCompoundSupply)
//   - src/tools/prepare_compound_withdraw.ts  (encodeCompoundWithdraw)
//   - src/tools/prepare_compound_borrow.ts    (encodeCompoundWithdraw)
//   - src/tools/prepare_compound_repay.ts     (encodeCompoundSupply)
//   - src/tools/preview_send.ts               (decodeCompoundV3Call via _compoundProtocols)
//   - src/signing/blocks.ts                   (DECODED ARGS templates)

export const COMPOUND_V3_COMET_ABI = parseAbi([
  "function supply(address asset, uint256 amount)",
  "function withdraw(address asset, uint256 amount)",
  "function baseToken() view returns (address)",
  "function balanceOf(address account) view returns (uint256)",       // supplied base
  "function borrowBalanceOf(address account) view returns (uint256)", // outstanding debt
  "function collateralBalanceOf(address account, address asset) view returns (uint128)",
  "function isBorrowCollateralized(address account) view returns (bool)",
  "function isLiquidatable(address account) view returns (bool)",
  "function getSupplyRate(uint256 utilization) view returns (uint64)",
  "function getBorrowRate(uint256 utilization) view returns (uint64)",
  "function getUtilization() view returns (uint256)",
  // ... (reserves + collateral-factor reads per research § Topic 2)
]);

export const COMPOUND_V3_SELECTORS = {
  supply: "0x..." as Hex,   // VERIFY at execute time
  withdraw: "0x..." as Hex, // VERIFY at execute time
} as const;

export function encodeCompoundSupply(asset: Address, amount: bigint): Hex { /* ... */ }
export function encodeCompoundWithdraw(asset: Address, amount: bigint): Hex { /* ... */ }

// 4-arm discriminated union — selector is binary, but the decoder names the
// CALLDATA SHAPE. The prepare-tool intent gate names the AGENT INTENT.
export type CompoundV3Decoded =
  | { kind: "compound-supply"; asset: Address; amount: bigint; isMax: boolean }
  | { kind: "compound-withdraw"; asset: Address; amount: bigint; isMax: boolean }
  | { kind: "unknown"; selector: Hex };

export function decodeCompoundV3Call(data: Hex): CompoundV3Decoded { /* ... */ }

export const _compoundProtocols = { decodeCompoundV3Call };
```

**`isMax` detection** — same shape as Aave's withdraw (`amount === MAX_UINT256`). Compound supports MAX_UINT256 for both `supply` (full-balance-repay when asset === baseToken && user has debt) AND `withdraw` (full-position-close when asset === baseToken && user has supply).

---

### `src/chains/compound-v3.ts` (NEW) — analog: `src/chains/aave-v3.ts`

**Per-Comet reads, NOT a single UiPoolDataProviderV3** — Compound V3's read shape is per-Comet, not per-system. Each Comet exposes its own state. Phase 28 fans out across 6 Comets via `Promise.all`.

```typescript
import { type Address, type PublicClient, parseAbi } from "viem";
import { COMPOUND_V3_COMET_ABI } from "../protocols/compound-v3.js";
import { type ChainId } from "../config/contracts.js";

export interface CometStateDecoded {
  comet: Address;
  baseToken: Address;
  baseSupplied: bigint;          // balanceOf(user) — user's supplied base position
  baseBorrowed: bigint;          // borrowBalanceOf(user) — user's outstanding debt
  isBorrowCollateralized: boolean;
  isLiquidatable: boolean;
  supplyRate: bigint;            // per-second rate, scaled 1e18
  borrowRate: bigint;
  utilization: bigint;
}

export async function getCometState(
  client: PublicClient,
  cometAddress: Address,
  user: Address,
): Promise<CometStateDecoded> {
  // Multicall via viem to read 7 fields in one round-trip — mirror of
  // `getReservesData` + `getUserReservesData` parallel pattern.
  // (See research § Topic 2 for the field count + the recommended grouping.)
}

// Fan-out helper: across all 6 mainnet Comets concurrently.
export async function getAllCometStates(
  client: PublicClient,
  chainId: ChainId,
  user: Address,
): Promise<CometStateDecoded[]> {
  const comets = ALL_COMPOUND_COMETS_FOR_CHAIN(chainId);  // from contracts.ts SOT
  return Promise.all(comets.map((c) => getCometState(client, c, user)));
}

export const _compoundChains = { getCometState, getAllCometStates };
```

Mirror `src/chains/aave-v3.ts:1-43` for the imports + `parseAbi` + struct refs shape (Compound is simpler — no struct refs; flat returns).

---

### `src/signing/compound-collateralization.ts` (NEW) — analog: `src/signing/aave-health.ts`

**Pure-bigint math** — mirror `aave-health.ts:1-80` structurally. Output type widens to Compound's boolean-gate model:

```typescript
// Pure-bigint Compound V3 collateralization math per research § Topic 3.
// Shared by:
//   - src/tools/get_lending_positions.ts    (current state; Plan 28-04)
//   - src/tools/simulate_position_change.ts (projected; Plan 28-04)
//
// COMPOUND'S MODEL DIFFERS FROM AAVE'S:
//   Aave: normalized HF (collateral × LT / debt) ≥ 1.0 = safe
//   Compound: `isBorrowCollateralized(account)` boolean + per-asset
//             collateral factors; `isLiquidatable(account)` separate boolean
//             with a stricter threshold. Phase 28 surfaces BOTH booleans +
//             a derived ratio (collateralUsd / borrowUsd) for agent legibility.

export const PRICE_FEED_SCALE: bigint = 10n ** 8n;       // Compound price feed: 8 decimals
export const COLLATERAL_FACTOR_SCALE: bigint = 10n ** 18n;
export const RATIO_SCALE: bigint = 10n ** 18n;           // ratioScaled mirrors Aave's HF_SCALE

export interface CompoundCollateralInput {
  collateralAssets: Array<{
    balance: bigint;        // collateralBalanceOf(user, asset)
    price: bigint;          // PRICE_FEED_SCALE units
    decimals: number;
    collateralFactor: bigint;       // borrowCollateralFactor (1e18-scaled)
    liquidateCollateralFactor: bigint;
  }>;
  baseBorrowed: bigint;     // borrowBalanceOf
  basePrice: bigint;        // PRICE_FEED_SCALE
  baseDecimals: number;
}

export interface CompoundCollateralOutput {
  collateralValueUsd: bigint;       // Σ (balance × price × collateralFactor)
  liquidateCollateralValueUsd: bigint; // Σ (balance × price × liquidateCollateralFactor)
  borrowValueUsd: bigint;
  ratioScaled: bigint | null;       // collateralValueUsd / borrowValueUsd, scaled 1e18; null when noDebt
  isBorrowCollateralized: boolean;  // borrowValueUsd <= collateralValueUsd
  isLiquidatable: boolean;          // borrowValueUsd > liquidateCollateralValueUsd
  noDebt: boolean;
}

export function computeCompoundCollateralization(
  input: CompoundCollateralInput,
): CompoundCollateralOutput { /* ... */ }
```

**T-COMPOUND-RATIO-DRIFT-1**: PRICE_FEED_SCALE / COLLATERAL_FACTOR_SCALE / RATIO_SCALE constants are byte-identical to research § Topic 3 literals; `test/signing-compound-collateralization.test.ts` asserts the three literals AND a deterministic input → expected-output anchor. Mirror of T-AAVE-HF-MATH-DRIFT-1.

**T-COMPOUND-CROSS-CHECK-1**: pure-bigint `isBorrowCollateralized` / `isLiquidatable` re-computation should match the on-chain `Comet.isBorrowCollateralized(user)` / `Comet.isLiquidatable(user)` boolean return values BYTE-IDENTICALLY (modulo block-height latency between reads). Integration test asserts this cross-check at execute time — divergence indicates either constant drift OR a sign-error in the collateral-factor application.

---

### `src/tools/prepare_compound_supply.ts` (NEW) — analog: `prepare_aave_supply.ts`

**Mechanical clone with bounded diffs PLUS an intent-gate prologue:**

| Slot | Aave V3 supply (analog) | Compound V3 supply (new) |
|---|---|---|
| Input schema | `{ chain, asset, amount, from? }` | `{ chain: "ethereum", comet: Address, asset: Address, amount, from? }` — `comet` REQUIRED (mainnet has 6; no implicit default) |
| `chain` enum | 5 chains | `"ethereum"` only (Phase 28 mainnet-first; v2.3.x widens) |
| Intent gate | n/a — Aave has no intent ambiguity | **NEW: pre-call RPC reads + refusal** — see § Greenfield below |
| Encoder | `encodeAaveSupply(asset, amountWei, fromAddress, 0)` | `encodeCompoundSupply(assetAddr, amountWei)` — note Compound's `supply` is 2-arg (no `onBehalfOf` or `referralCode`) |
| `tx.to` | `getAaveV3PoolAddress(chainId)` | `args.comet` (validated via `_compoundProtocols.isCanonicalComet(comet)` against `getCompoundCometAddress` SOT — refuse with `INVALID_INPUT` if the agent supplied a non-canonical address) |
| `tx.valueWei` | `0n` | `0n` |
| RECEIPT template | `AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE` | `COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE` (NEW; see § Blocks) |
| `"max"` sentinel? | NO | NO (supply takes a concrete amount; only `_repay` accepts `"max"`) |

**SENDER resolution** (`prepare_aave_supply.ts:163-172`) — copy verbatim:
```typescript
const rawFrom = typeof args.from === "string" ? args.from : undefined;
const fromResolution = await resolveFrom({ rawFrom, chainId });
if (fromResolution.kind === "error") return fromResolution.result;
const fromAddress: Address = fromResolution.fromAddress;
const fromCallerSupplied = fromResolution.callerSupplied;
```

**Decimal resolution** (`prepare_aave_supply.ts:124-139` resolveDecimals helper) — copy verbatim; same registry-cache-first / live-RPC-on-miss shape.

**Intent-gate prologue** (NEW — Aave didn't need this):
```typescript
// AFTER resolveFrom, BEFORE encodeFunctionData. Reads two on-chain values
// to confirm the agent's intent ("supply-collateral") matches reality.
const cometAddr = getAddress(args.comet) as Address;
const baseToken = await _compoundChains.readBaseToken(client, cometAddr);
if (assetAddr === getAddress(baseToken)) {
  const debt = await _compoundChains.readBorrowBalance(client, cometAddr, fromAddress);
  if (debt > 0n) {
    return refusal({
      kind: "INVALID_INPUT",
      message:
        `prepare_compound_supply received the Comet's base asset (${baseToken}) ` +
        `while the user has outstanding debt (${debt} wei). This is a repay, not a supply. ` +
        `Call prepare_compound_repay with the same args instead.`,
      hint: { tool: "prepare_compound_repay" },
    });
  }
  // Supplying the base asset with zero debt IS a valid supply (lender position). Proceed.
}
```

**createHandle + RECEIPT** — copy `prepare_aave_supply.ts:241-260` verbatim with template substitutions; `comet` field added to args / structuredContent.

---

### `src/tools/prepare_compound_withdraw.ts` / `_borrow.ts` / `_repay.ts` (NEW)

Same mechanical-clone shape with **intent gates reversed / specialized**:

**`prepare_compound_withdraw`** — selector: `withdraw(asset, amount)`. Intent gate:
```typescript
if (assetAddr === getAddress(baseToken)) {
  const supplied = await _compoundChains.readBaseBalance(client, cometAddr, fromAddress);
  if (supplied === 0n) {
    return refusal({
      kind: "INVALID_INPUT",
      message: "this is a borrow (base asset, no supply position). Call prepare_compound_borrow.",
      hint: { tool: "prepare_compound_borrow" },
    });
  }
}
// Otherwise (collateral asset) — proceed with withdraw.
```

**`prepare_compound_borrow`** — same selector (`withdraw(asset, amount)`). Intent gate:
```typescript
if (assetAddr !== getAddress(baseToken)) {
  return refusal({
    kind: "INVALID_INPUT",
    message: `borrow requires the Comet's base asset (got ${assetAddr}, baseToken is ${baseToken}). Call prepare_compound_withdraw to withdraw collateral.`,
    hint: { tool: "prepare_compound_withdraw" },
  });
}
const supplied = await _compoundChains.readBaseBalance(client, cometAddr, fromAddress);
if (supplied > 0n) {
  return refusal({
    kind: "INVALID_INPUT",
    message: "this is a withdraw (base asset, has supply position). Call prepare_compound_withdraw.",
    hint: { tool: "prepare_compound_withdraw" },
  });
}
```

**`prepare_compound_repay`** — same selector as supply (`supply(asset, amount)`). Intent gate:
```typescript
if (assetAddr !== getAddress(baseToken)) {
  return refusal({ /* must be base */ });
}
const debt = await _compoundChains.readBorrowBalance(client, cometAddr, fromAddress);
if (debt === 0n) {
  return refusal({ /* no debt — call prepare_compound_supply */ });
}
```

**`"max"` sentinel — ONLY for `_repay`** — mirror `prepare_token_approve.ts:286-292` T-MAX-SPELLING-1 discipline:
```typescript
let amountWei: bigint;
if (rawAmount === "max") {
  amountWei = MAX_UINT256;  // Compound: full-position-close at protocol level
} else {
  amountWei = parseAmountStrict(rawAmount, decimals);
}
```
ONLY `"max"` (lowercase) accepted; `"MAX"` / `"unlimited"` / `"infinite"` reject as INVALID_INPUT kind: "format" via parseAmountStrict's regex.

---

### `src/tools/get_compound_market_info.ts` (NEW) — analog: `get_lending_positions.ts` (read-only leg)

**Tool surface** — no wallet arg; metadata-only:
```typescript
const DESCRIPTION = [
  "Read Compound V3 market metadata for the 6 mainnet Comets (cUSDCv3 / cUSDTv3 / cWETHv3 / cUSDSv3 / cwstETHv3 / cWBTCv3).",
  "Returns per-Comet supply APR, borrow APR, base-token symbol, supported collateral assets, collateral factors, liquidation factors, utilization, total supply, total borrow.",
  "Use BEFORE prepare_compound_supply / _borrow to surface APRs and collateral capacity.",
  "Do NOT use for per-wallet positions — call `get_lending_positions` with `chain: 'ethereum'` for that.",
  "Returns `{ chain, markets: [{ comet, baseToken, baseSymbol, supplyApr, borrowApr, utilization, totalSupply, totalBorrow, collateralAssets: [...] }], rpcDegraded? }`.",
  "Failure modes: INTERNAL_ERROR (RPC unreachable; public-node fallback path tried).",
].join(" ");
```

Read pattern: `Promise.all(comets.map((c) => readMarketInfo(client, c)))` — mirror `get_lending_positions.ts:134-137` concurrent shape against the 6 Comets.

---

### `src/tools/get_lending_positions.ts` (EXTEND) — discriminated-union widening

**Result shape — BEFORE Phase 28:**
```typescript
interface LendingPositionsResult {
  chain: ChainName;
  positions: LendingPositionRow[];   // Aave-only rows
  totalCollateralUsd: string;
  totalDebtUsd: string;
  healthFactor: string | null;       // Aave-only
  // ...
}
```

**AFTER Phase 28** — discriminated-union widening per row + top-level multi-protocol summary:
```typescript
type LendingPositionRow =
  | { protocol: "aave-v3"; /* existing fields */ }
  | { protocol: "compound-v3"; comet: Address; baseToken: Address; /* Compound shape */ };

interface LendingPositionsResult {
  chain: ChainName;
  positions: LendingPositionRow[];   // multi-protocol; agent reads `row.protocol`
  sources: {
    aave: { totalCollateralUsd, totalDebtUsd, healthFactor, liquidationRisk, noDebt };
    compound: { perComet: Array<{ comet, ratioScaled, isBorrowCollateralized, isLiquidatable, noDebt }> };
  };
  rpcDegraded?: boolean;
}
```

**Bounded diff in code** — fan out the two read legs concurrently:
```typescript
const [aaveLeg, compoundLeg] = await Promise.all([
  readAavePositions(client, chainId, wallet),       // existing helper, extracted from inline
  chainId === 1
    ? _compoundChains.getAllCometStates(client, chainId, wallet)
    : Promise.resolve([]),                          // Compound mainnet-only in Phase 28
]);
```

**Aave rows MUST stay byte-identical** — only the new `protocol: "aave-v3"` field added to each existing row. Test `test/get-lending-positions.test.ts` extends with multi-protocol assertions; existing Aave-only assertions remain.

**T-LENDING-MULTIPROTOCOL-1**: a Compound-only wallet on mainnet should return `positions: [...Compound rows]`, `sources.aave: { ...zero-anchor shape... }`, `sources.compound.perComet: [...6 rows, some active...]`. Mirror of `get_portfolio_summary`'s "zero-balance row" discipline — never silently drop a protocol arm.

---

### `src/tools/simulate_position_change.ts` (EXTEND)

Add `protocol: "aave-v3" | "compound-v3"` input slot (default `"aave-v3"` for backward compat). Compound arm:
```typescript
if (protocol === "compound-v3") {
  const cometAddr = getAddress(args.comet);
  const state = await _compoundChains.getCometState(client, cometAddr, fromAddress);
  // Apply delta in-memory, recompute via computeCompoundCollateralization, return ratio + booleans.
}
```

Output shape — discriminated-union widening on `protocol`. Aave arm output byte-identical. Compound arm output:
```typescript
{
  protocol: "compound-v3";
  comet: Address;
  currentRatio: string | null;        // formatUnits(ratioScaled, 18)
  projectedRatio: string | null;
  isBorrowCollateralizedCurrent: boolean;
  isBorrowCollateralizedProjected: boolean;
  isLiquidatableCurrent: boolean;
  isLiquidatableProjected: boolean;
  warning?: "would-liquidate" | "near-liquidation";
}
```

Same TRUST-BOUNDARY INVARIANT prose as Aave path (`simulate_position_change.ts:22-24`): simulation is a USABILITY signal, never a signing precondition.

## 3. Modification Touchpoints

### `src/config/contracts.ts` — Plan 28-01

**Recommended shape: sibling per-chain Comet sub-table**, NOT a wide `ContractsForChain` interface extension (cleaner against v2.3.x multi-chain growth):

```typescript
// Phase 28 — Plan 28-01. Compound V3 Comet addresses per (chain, base-asset).
// Ethereum-only in v2.3; v2.3.x extends to Polygon/Arbitrum/Base/Optimism.
//
// Source: docs.compound.finance/#networks + each Comet's Etherscan-verified
// proxy address (cross-checked 2026-05-20 — see research § Topic 1).

export type CompoundCometBase = "USDC" | "USDT" | "WETH" | "USDS" | "wstETH" | "WBTC";

const COMPOUND_COMETS_RAW: Partial<Record<ChainId, Partial<Record<CompoundCometBase, Address>>>> = {
  1: {
    USDC:   getAddress("0xc3d688B66703497DAA19211EEdff47f25384cdc3"),
    USDT:   getAddress("0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840"),
    WETH:   getAddress("0xA17581A9E3356d9A858b789D68B4d866e593aE94"),
    USDS:   getAddress("0x5D409e56D886231aDAf00c8775665AD0f9897b56"),
    wstETH: getAddress("0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3"),
    WBTC:   getAddress("0xe85Dc543813B8c2CFEaAc371517b925a166a9293"),
  },
};

export function getCompoundCometAddress(
  chainId: ChainId,
  base: CompoundCometBase,
): Address | null {
  return COMPOUND_COMETS_RAW[chainId]?.[base] ?? null;
}

export function getAllCompoundCometsForChain(chainId: ChainId): Address[] {
  const row = COMPOUND_COMETS_RAW[chainId];
  return row ? Object.values(row).filter((a): a is Address => !!a) : [];
}
```

**KNOWN_SPENDERS_ETHEREUM extension** — append 6 alphabetical rows for the Comet labels:
```typescript
{
  address: getAddress("0xc3d688B66703497DAA19211EEdff47f25384cdc3"),
  label: "Compound V3 cUSDCv3",
  source: "https://docs.compound.finance/#networks",
},
// + 5 more for cUSDTv3 / cWETHv3 / cUSDSv3 / cwstETHv3 / cWBTCv3
```

The regression test `test/config-contracts.test.ts` anchor `length >= 11` tolerates growth without churn (Phase 7 retro line 11).

---

### `src/security/canonical-dispatch.ts` — Plan 28-04

**Bounded diff** — extend `buildPerChainAllowlist(1)` only:
```typescript
function buildPerChainAllowlist(chainId: ChainId): ReadonlySet<Address> {
  const tokenContracts = BRIDGED_VARIANTS
    .filter((v) => v.chainId === chainId)
    .map((v) => v.address);
  const compoundComets =
    chainId === 1 ? getAllCompoundCometsForChain(1) : [];  // Phase 28: Ethereum-only
  return new Set<Address>([
    getAaveV3PoolAddress(chainId),
    getWethAddress(chainId),
    ONEINCH_V6_ROUTER_ALL_CHAINS,
    LIFI_DIAMOND_ALL_CHAINS,
    ...tokenContracts,
    ...compoundComets,
  ]);
}
```

Membership count on Ethereum grows from 20 → 26 (4 canonical + 17 BRIDGED_VARIANTS − 1 WETH overlap + 6 Comets). Update the comment block at `canonical-dispatch.ts:124-129` accordingly.

---

### `src/signing/blocks.ts` — Plan 28-04

**Append-only** (mirror Phase 6 / Phase 7 append-only discipline; ALL existing templates byte-identical):

```typescript
// Phase 28 — Plan 28-04. Compound V3 templates (append-only). Existing
// templates above STAY BYTE-IDENTICAL (FROZEN).

export const COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  operation:    Compound V3 supply",
  "  chain:        {CHAIN}",
  "  comet:        {COMET}",
  "  asset:        {ASSET}",
  "  amount:       {AMOUNT}",
].join("\n");

export const COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE: string = [/* ... */].join("\n");
export const COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE: string = [/* ... */].join("\n");
export const COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE: string = [/* ... */].join("\n");

export const DECODED_ARGS_TEMPLATE_COMPOUND_SUPPLY: string = [
  "DECODED ARGS",
  "  function:     supply",
  "  comet:        {COMET_ADDRESS} ({COMET_LABEL})",
  "  asset:        {ASSET} {ASSET_LABEL}",
  "  amount:       {AMOUNT_HUMAN}",
  "  amountWei:    {AMOUNT_WEI}",
  "  intent:       {INTENT_LABEL}",   // "supply-collateral" | "repay-debt" — surfaced from the prepare-tool gate
].join("\n");

export const DECODED_ARGS_TEMPLATE_COMPOUND_WITHDRAW: string = [/* ... + intent: "withdraw-collateral" | "borrow" */].join("\n");

// LEDGER NOTICE — REQUIRED (research § Topic 8: Compound NOT in LedgerHQ
// ERC-7730 calldata registry as of 2026-05-20). Devices will blind-sign;
// the user sees an opaque hash. Mirror of LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE.
export const LEDGER_NOTICE_COMPOUND_TEMPLATE: string = [
  "LEDGER NOTICE",
  "  Compound V3 supply / withdraw is NOT covered by the Ledger Ethereum app's ERC-7730 clear-sign registry.",
  "  Your device WILL BLIND-SIGN this transaction (display a raw hash, no decoded args).",
  "  If your device refuses with \"Blind signing is not enabled\":",
  "    1. Open the Ethereum app on your device",
  "    2. Settings → Blind signing → Enabled",
  "    3. Retry send_transaction",
  "  Match the LEDGER BLIND-SIGN HASH below CHARACTER-FOR-CHARACTER against",
  "  the value your device displays — this is the cryptographic anchor.",
].join("\n");
```

**`buildCompoundDecodedArgsBlock(decoded, tokenContext, cometAddress, intent)`** — parallel render helper, mirror of `buildAaveDecodedArgsBlock`. Takes the `intent` label from preview_send's lookup (preview_send re-derives intent by re-reading `baseToken` + `borrowBalanceOf` at preview time — defense-in-depth against agent lying about which prepare tool was used).

---

### `src/tools/preview_send.ts` — Plan 28-04

**Three-tier dispatch** — extend the existing two-tier (ERC-20 → Aave) with a third tier:
```typescript
const decodedArgs: Erc20Decoded = _protocols.decodeErc20Call(record.tx.data);

let aaveDecoded: AaveV3Decoded | null = null;
let compoundDecoded: CompoundV3Decoded | null = null;

if (decodedArgs.kind === "unknown") {
  const aave = _aaveProtocols.decodeAaveV3Call(record.tx.data);
  if (aave.kind !== "unknown") {
    aaveDecoded = aave;
  } else {
    const compound = _compoundProtocols.decodeCompoundV3Call(record.tx.data);
    if (compound.kind !== "unknown") compoundDecoded = compound;
  }
}
```

**Token-context resolution for Compound** — mirror Aave's `decoded.asset`-not-`tx.to` discipline (T-COMPOUND-TX-TO-CONFUSION-1):
```typescript
if (compoundDecoded !== null) {
  // record.tx.to is the Comet; decoded.asset is the token. Look up the token.
  const registry = loadTokenRegistry(record.tx.chainId as ChainId);
  const entry = registry.find((e) => e.address === compoundDecoded!.asset);
  tokenContext = entry ? { symbol: entry.symbol, decimals: entry.decimals } : null;
  // Live-RPC fallback for long-tail collateral assets — mirror lines 462-480.
}
```

**LEDGER NOTICE conditional** — emit ABOVE the LEDGER BLIND-SIGN HASH for Compound selectors against canonical Comets:
```typescript
const isCompound =
  compoundDecoded !== null &&
  record.tx.chainId === 1 &&
  getAllCompoundCometsForChain(1).includes(getAddress(record.tx.to));
const ledgerNoticeBlock: string | null = isCompound
  ? LEDGER_NOTICE_COMPOUND_TEMPLATE
  : (isWethUnwrap ? LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE : null);
```

**Intent-label re-derivation at preview time** (defense-in-depth):
```typescript
// preview_send does NOT trust the prepare-tool name. It re-reads baseToken +
// borrowBalanceOf at preview time and DERIVES the intent from on-chain state.
// The DECODED ARGS block surfaces the derived intent — the user sees the
// actual semantics of the call, not the agent's label.
let compoundIntent: "supply-collateral" | "repay-debt" | "withdraw-collateral" | "borrow" | "ambiguous";
if (compoundDecoded !== null) {
  const baseToken = await readBaseToken(client, record.tx.to);
  const isBase = getAddress(compoundDecoded.asset) === getAddress(baseToken);
  if (compoundDecoded.kind === "compound-supply") {
    const debt = await readBorrowBalance(client, record.tx.to, record.tx.from);
    compoundIntent = isBase && debt > 0n ? "repay-debt" : "supply-collateral";
  } else {  // compound-withdraw
    const supplied = await readBaseBalance(client, record.tx.to, record.tx.from);
    compoundIntent = isBase
      ? (supplied > 0n ? "withdraw-collateral" : "borrow")
      : "withdraw-collateral";
  }
}
```

**FROZEN-area assertion**: the order of cross-check blocks (LEDGER → AGENT TASK → 4BYTE → DECODED ARGS → SIMULATION → VERIFY) MUST NOT change. `presignHash` compute, `previewToken` mint, `transitionToPreviewed` call — byte-identical.

---

### `src/tools/register-all.ts` — Plans 28-02 + 28-03 + 28-04

**Carve** (mirror Phase 7's wave-by-wave insertion to avoid same-line conflicts):
```typescript
import "./get_lending_positions.js";       // EXISTING — Plan 28-04 extends in place
import "./get_compound_market_info.js";    // NEW — Plan 28-04 (read group, after get_lending_positions)
// ...
import "./prepare_aave_supply.js";         // EXISTING
import "./prepare_aave_withdraw.js";       // EXISTING
import "./prepare_compound_supply.js";     // NEW — Plan 28-02
import "./prepare_compound_withdraw.js";   // NEW — Plan 28-02
import "./prepare_compound_borrow.js";     // NEW — Plan 28-03
import "./prepare_compound_repay.js";      // NEW — Plan 28-03
import "./simulate_position_change.js";    // EXISTING — Plan 28-04 extends in place
```

## 4. Reusable Primitives — Phase 28 MUST Consume, NOT Reimplement

| Primitive | Source | Phase 28 caller(s) | Call sketch |
|---|---|---|---|
| `createHandle({ args, tx, payloadFingerprint })` | `src/signing/handle-store.ts:128-144` | All 4 prepare_compound_* | `createHandle({ args: { to: "", valueWei: "0", tokenAddress: rawAsset, amount: rawAmount }, tx, payloadFingerprint })` |
| `computePayloadFingerprint({ chainId, to, valueWei, data })` | `src/signing/payload-fingerprint.ts:36-49` | All 4 prepare_compound_* | `computePayloadFingerprint({ chainId: 1, to: comet, valueWei: 0n, data })` — **FROZEN**, no new fields |
| `parseAmountStrict(amountStr, decimals)` | `src/signing/amount.ts:77-106` | All 4 prepare_compound_* (non-`"max"` branch) | Verbatim |
| `MAX_UINT256` | `src/protocols/erc20.ts:58` | `prepare_compound_repay` (`"max"` branch) | `amountWei = MAX_UINT256` — Compound full-position-close at protocol level |
| `resolveFrom({ rawFrom, chainId })` | `src/signing/resolve-from.ts` | All 4 prepare_compound_* | Verbatim |
| `loadTokenRegistry(chainId)` | `src/tokens/registry.ts` | All 4 prepare_compound_* + `preview_send` extension | Verbatim |
| `getChainClient(chainId)` | `src/chains/registry.ts` | All 4 prepare_compound_* + `get_lending_positions` extension + `get_compound_market_info` + `simulate_position_change` Compound arm + `preview_send` extension | Verbatim |
| `isPublicNodeFallback()` | `src/chains/ethereum.ts:35-38` | `get_lending_positions` extension + `get_compound_market_info` + `simulate_position_change` Compound arm | `if (isPublicNodeFallback()) result.rpcDegraded = true;` |
| `makeStructuredError(code, message, cause?)` | `src/signing/error-codes.ts:71-76` | All 4 prepare_compound_* + 1 read tool | `errEnvelope("INVALID_INPUT", "intent mismatch: ...")` |
| `runPreviewSimulation({ client, sender, tx })` | `src/signing/simulation.ts:55-83` | INHERITED via `preview_send` — Phase 6 DF-1 widened the simulation to ALL tx shapes (Phase 7 retro: "Phase 4 native sends got preview-time simulation for free") | NO direct call from Phase 28 code |
| `transitionToPreviewed` / `transitionToSent` / `transitionToCancelled` | `src/signing/handle-store.ts:167-211` | INHERITED via `preview_send` + `send_transaction` | NO direct call |
| `lookupSpender(spender)` | `src/config/contracts.ts:320-323` | INHERITED via `KNOWN_SPENDERS_ETHEREUM` extension — Phase 28 adds 6 rows; existing lookup mechanism unchanged | n/a |
| `checkDispatchTarget(chainId, to)` | `src/security/canonical-dispatch.ts:166-179` | INHERITED — Phase 28 adds 6 Comet addresses to the Ethereum allowlist; gate behavior unchanged | n/a |
| `_protocols.decodeErc20Call` / `_aaveProtocols.decodeAaveV3Call` | `src/protocols/erc20.ts:180` + `src/protocols/aave-v3.ts:187` | `preview_send` extension chains AFTER both on `unknown` fall-through | Existing calls; Phase 28 chains `_compoundProtocols.decodeCompoundV3Call` AFTER Aave on `unknown` |

**Error codes** — Phase 28 reuses the locked 15-code set. The intent-gate refusals all use `INVALID_INPUT` with a `hint.tool` field naming the correct prepare tool — no new error codes.

## 5. Anti-Patterns Phase 28 MUST NOT Repeat

1. **No inline contract addresses.** All 6 Comet addresses live in `src/config/contracts.ts` ONLY, `getAddress`-checksummed at the literal site. Regression-tested via `test/config-contracts.test.ts`. T-COMPOUND-COMET-ADDR-INLINE-1 mitigation; grep-zero in success criteria.
2. **No soft schema checks for `"max"`.** `prepare_compound_repay`'s `"max"` sentinel is enforced via strict equality (`rawAmount === "max"` only), with non-canonical spellings rejected through `parseAmountStrict`'s regex. T-MAX-SPELLING-1 (Plan 06-03) discipline.
3. **No `beforeAll`-snapshot fixtures.** Fixtures R / S / T / U (Compound supply/withdraw/borrow/repay) are hardcoded `0x…` literals in `test/signing-fingerprint.test.ts`. CLAUDE.md Conventions section codifies this; Phase 7 retro reinforced.
4. **No reimplementation of `prepare_*` scaffolding.** Mechanical-clone pattern (Phase 6 retro line 141, reinforced by Phase 7): bounded diffs only. Handle/fingerprint/error-envelope scaffolding is byte-identical to `prepare_aave_supply.ts`. The **intent-gate prologue is a new section added BEFORE the encoder call** — does not modify the existing scaffolding shape.
5. **ESM spy-affordance pre-emptively.** `src/protocols/compound-v3.ts` ships `export const _compoundProtocols = { decodeCompoundV3Call };` and `src/chains/compound-v3.ts` ships `export const _compoundChains = { getCometState, getAllCometStates, readBaseToken, readBorrowBalance, readBaseBalance };` from the first commit. Plan 05-01 retro: "add at write time, not retroactively."
6. **FROZEN-area discipline in every Phase 28 plan's `<success_criteria>`.** Each plan asserts zero-diff on: `src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/signing/handle-store.ts` state machine, `src/tools/send_transaction.ts` three gates, `src/signing/error-codes.ts` 15-code union.
7. **Intent gates re-derive at preview time** (defense-in-depth). The 4 prepare tools enforce intent gates BEFORE encoding. `preview_send` ADDITIONALLY re-derives intent from on-chain state at preview time and surfaces the derived label in DECODED ARGS — the user sees the actual semantics regardless of which prepare tool the agent claimed to use. Belt + suspenders against agent-side intent confusion.

## 6. Cryptographic-Binding Chain Delta

### What Phase 28 changes
- **`preview_send.ts` selector dispatch** — additive only. Three-tier (ERC-20 → Aave → Compound) on `unknown` fall-through.
- **`src/signing/blocks.ts`** — append-only (4 PREPARE RECEIPT + 2 DECODED ARGS + 1 LEDGER NOTICE template). Existing templates byte-identical.
- **`src/config/contracts.ts`** — sibling `COMPOUND_COMETS_RAW` table + `getCompoundCometAddress` getter + 6 `KNOWN_SPENDERS_ETHEREUM` rows. Existing `ContractsForChain` interface UNCHANGED.
- **`src/security/canonical-dispatch.ts`** — Ethereum-arm allowlist grows by 6 entries via the new SOT getter.

### What Phase 28 does NOT touch (FROZEN — assert zero-diff)
- **`src/signing/payload-fingerprint.ts`** — preimage assembly `DOMAIN_TAG ‖ chainId ‖ to ‖ value ‖ data` byte-frozen. No new fields.
- **`src/signing/presign-hash.ts`** — EIP-1559 pre-sign hash compute byte-frozen.
- **`src/signing/handle-store.ts` state machine** — `prepared → previewed → sent | cancelled` byte-frozen. Phase 28 reuses existing `PrepareArgs` shape (`tokenAddress` field re-purposed for the asset; mirror Phase 7).
- **`src/tools/send_transaction.ts`** — three-gate refusal logic byte-frozen. Handler builds `txParams` from `record.tx` + `record.pinned` ONLY.
- **`src/signing/error-codes.ts`** — 15-code locked union byte-frozen. Intent-gate refusals reuse `INVALID_INPUT`.

### Fixture additions
- **Fixture R** — `Comet.supply(USDC, 100e6)` on cUSDCv3 → `payloadFingerprint` hardcoded literal. Cross-linked from `test/prepare-compound-supply.test.ts` + `test/compound-v3-lifecycle.integration.test.ts`.
- **Fixture S** — `Comet.withdraw(USDC, 100e6)` on cUSDCv3 → `payloadFingerprint` hardcoded literal. Cross-linked from `test/prepare-compound-withdraw.test.ts`.
- **Fixture T** — `Comet.withdraw(USDC, 50e6)` borrow path on cUSDCv3 → same calldata shape as S but distinct amount; proves byte-identity is selector + tx-to + amount-dependent regardless of agent intent. Cross-linked from `test/prepare-compound-borrow.test.ts`.
- **Fixture U** — `Comet.supply(USDC, MAX_UINT256)` repay full-position-close → `payloadFingerprint` hardcoded literal. Cross-linked from `test/prepare-compound-repay.test.ts`.

All 4 fixtures honor the CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals" convention.

**T-INTEGRATION-FROM-DRIFT-1** extension: `test/compound-v3-lifecycle.integration.test.ts` re-anchors Fixtures R/S/T/U byte-identical across persona swaps (whale ↔ stable-saver ↔ defi-degen). Any persona-dependence in the preimage assembly fails at execute time.

## 7. Test Surface Notes

| Test File | Scope | Mirrors |
|---|---|---|
| `test/protocols-compound-v3.test.ts` (NEW) | Selector byte-identity (`toFunctionSelector` cross-check) + encoder round-trips + decode discriminated-union exhaustiveness | `test/protocols-aave-v3.test.ts` |
| `test/chains-compound-v3.test.ts` (NEW) | parseAbi struct refs + `getCometState` multicall mock + `getAllCometStates` fan-out | `test/chains-aave-v3.test.ts` |
| `test/signing-compound-collateralization.test.ts` (NEW) | Pure-bigint math; PRICE_FEED_SCALE / COLLATERAL_FACTOR_SCALE / RATIO_SCALE literal anchors + deterministic input→output anchor + `isBorrowCollateralized` / `isLiquidatable` boolean assertions | `test/signing-aave-health.test.ts` |
| `test/config-contracts.test.ts` (EXTEND) | 6 Comet byte-identity assertions; 6 new `KNOWN_SPENDERS_ETHEREUM` rows; cross-view byte-identity (Comet getter ↔ KNOWN_SPENDERS_ETHEREUM rows) | Existing pattern at lines 28-72 |
| `test/prepare-compound-supply.test.ts` (NEW) | Schema validation + intent-gate (refuse on baseToken-with-debt) + parseAmountStrict + encoder + RECEIPT byte-identity + Fixture R anchor | `test/prepare-aave-supply.test.ts` |
| `test/prepare-compound-withdraw.test.ts` (NEW) | Same + intent-gate (refuse on baseToken-with-supply → point to borrow) + Fixture S anchor | `test/prepare-aave-withdraw.test.ts` |
| `test/prepare-compound-borrow.test.ts` (NEW) | Intent-gate (refuse on non-base asset; refuse on has-supply) + Fixture T anchor + `"max"` rejection | `test/prepare-aave-withdraw.test.ts` + NEW shape (no Aave borrow analog) |
| `test/prepare-compound-repay.test.ts` (NEW) | Intent-gate (refuse on non-base; refuse on no-debt) + `"max"` sentinel handling (T-MAX-SPELLING-1) + Fixture U anchor | `test/prepare-aave-supply.test.ts` + `test/prepare-token-approve.test.ts` (`"max"`) |
| `test/get-compound-market-info.test.ts` (NEW) | Per-Comet APR + collateral factor reads; 6-Comet fan-out + `rpcDegraded` surface | `test/get-lending-positions.test.ts` |
| `test/get-lending-positions.test.ts` (EXTEND) | Multi-protocol output (Compound branch); discriminated-union `protocol` field; Aave-only assertions remain byte-identical | n/a (extends own pattern) |
| `test/simulate-position-change.test.ts` (EXTEND) | Compound arm (protocol enum + projected booleans + warning surfacing); Aave-only tests remain byte-identical | n/a (extends own pattern) |
| `test/preview-send.compound.test.ts` (NEW) | Selector-routed DECODED ARGS for Compound supply + withdraw; tokenContext from `decoded.asset` (NOT `tx.to`); intent re-derivation at preview time; LEDGER NOTICE EMITTED (mirror of `preview-send.weth9-unwrap.test.ts` — REQUIRED notice for Compound) | `test/preview-send.aave.test.ts` + `test/preview-send.erc20.test.ts` |
| `test/preview-send.dispatch-allowlist.test.ts` (EXTEND) | 6 Comet addresses pass Layer 0.5; non-Comet addresses still refused | n/a |
| `test/compound-v3-lifecycle.integration.test.ts` (NEW) | Full prepare → preview → send pipeline for all 4 intents; Fixtures R/S/T/U byte-identical across persona swap; intent-gate refusal scenarios | `test/aave-v3-lifecycle.integration.test.ts` |
| `test/signing-fingerprint.test.ts` (EXTEND) | Fixtures R / S / T / U as `it(...)` blocks with hardcoded `0x…` literals | Existing Fixtures G / H pattern at lines 113-138 |

### Integration-test load-bearing assertion (T-INTEGRATION-FROM-DRIFT-1 extension)

```typescript
describe("Compound V3 lifecycle integration — Fixtures R/S/T/U from-independence across personas", () => {
  it("Fixture R (Compound supply USDC 100 on cUSDCv3): same payloadFingerprint across whale ↔ stable-saver ↔ defi-degen", async () => {
    const fingerprintsByPersona = new Map<string, string>();
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);
      const result = await callTool("prepare_compound_supply", {
        chain: "ethereum",
        comet: CUSDCV3_ADDRESS,
        asset: USDC,
        amount: "100",
      });
      const sc = result.structuredContent as { from: string; payloadFingerprint: string };
      fingerprintsByPersona.set(persona, sc.payloadFingerprint);
    }
    for (const persona of PERSONAS_UNDER_TEST) {
      expect(fingerprintsByPersona.get(persona)).toBe(FIXTURE_R_FINGERPRINT);
    }
  });
  // + R / S / T / U blocks
});
```

**STOP-THE-LINE**: any fingerprint mismatch across personas → cryptographic-binding chain became `from`-dependent. Release blocker.

## 8. Greenfield Design Notes — Intent-vs-Reality Gates

**The new pattern Aave didn't need.** Compound V3 maps 4 agent-facing intents to 2 calldata selectors:

| Agent Intent (tool) | Selector | Intent gate (server-side refusal condition) |
|---|---|---|
| `prepare_compound_supply` | `supply(asset, amount)` | refuse if `asset === baseToken && borrowBalanceOf(user) > 0n` → "this is a repay; call `prepare_compound_repay`" |
| `prepare_compound_withdraw` | `withdraw(asset, amount)` | refuse if `asset === baseToken && balanceOf(user) === 0n` → "this is a borrow; call `prepare_compound_borrow`" |
| `prepare_compound_borrow` | `withdraw(asset, amount)` | refuse if `asset !== baseToken` → "call `_withdraw` for collateral"; refuse if `balanceOf(user) > 0n` → "you have supply; call `_withdraw`" |
| `prepare_compound_repay` | `supply(asset, amount)` | refuse if `asset !== baseToken` → "call `_supply` for collateral"; refuse if `borrowBalanceOf(user) === 0n` → "no debt; call `_supply`" |

**Why the gate matters for the user, not just routing**: the LEDGER NOTICE block already informs the user that the device WILL blind-sign Compound calls. The user CANNOT visually distinguish a supply from a repay on the device — both surface as a `supply(asset, amount)` blob with the same selector. The intent gate is the LAST chance to catch an agent that picked the wrong tool BEFORE the user sees an opaque hash they have no way to disambiguate. Belt + suspenders: preview_send re-derives intent at preview time (defense-in-depth — even if the prepare tool's gate fails, the preview re-checks).

**Why both layers exist (NOT redundant)**:
- **Prepare-tool gate** → fast refusal, no on-chain side effect, points at the correct tool (helps agent self-correct).
- **Preview-tool re-derivation** → defense against an agent that bypasses the prepare-tool gate (e.g., reuses a handle prepared under a stale state). The DECODED ARGS block surfaces the DERIVED intent, not the prepare-tool's claimed intent.

**Reusable primitive: `_compoundChains.deriveIntent`** — pure helper (3 reads, no writes):
```typescript
export async function deriveIntent(
  client: PublicClient,
  comet: Address,
  user: Address,
  selector: "supply" | "withdraw",
  asset: Address,
): Promise<"supply-collateral" | "repay-debt" | "withdraw-collateral" | "borrow"> {
  const baseToken = await readBaseToken(client, comet);
  const isBase = getAddress(asset) === getAddress(baseToken);
  if (selector === "supply") {
    if (!isBase) return "supply-collateral";
    const debt = await readBorrowBalance(client, comet, user);
    return debt > 0n ? "repay-debt" : "supply-collateral";
  }
  // selector === "withdraw"
  if (!isBase) return "withdraw-collateral";
  const supplied = await readBaseBalance(client, comet, user);
  return supplied > 0n ? "withdraw-collateral" : "borrow";
}
```

Both prepare-tool gates AND `preview_send` consume this helper. Single source of truth for intent derivation.

## 9. Plan Carve Recommendation

**Recommended: 4 plans** (the prompt's plausible structure). 5-plan split (4-04 reads / 4-05 defense) is acceptable if the orchestrator wants finer parallel grain; pattern-mapper's verdict is 4-plan because the defense touchpoints (`canonical-dispatch.ts` + `blocks.ts` LEDGER NOTICE) are tiny additive edits that ride naturally with the read-tool wiring.

- **Plan 28-01** — SOT extension (`src/config/contracts.ts` Comet sub-table + getters + `KNOWN_SPENDERS_ETHEREUM` 6 rows + `src/protocols/compound-v3.ts` ABI + selectors + encoder + decoder + Fixtures R/S/T/U literal anchors in `test/signing-fingerprint.test.ts` + `test/protocols-compound-v3.test.ts`). Sequential prerequisite — every other plan imports `getCompoundCometAddress` and the encoders. ~1 atomic commit, ~600 LoC.

- **Plan 28-02** — `prepare_compound_supply` + `prepare_compound_withdraw` + intent-gate prologue + `src/chains/compound-v3.ts` partial (`readBaseToken` / `readBorrowBalance` / `readBaseBalance` / `deriveIntent`) + RECEIPT templates + per-tool tests. Depends on 28-01. ~1 atomic commit, ~800 LoC.

- **Plan 28-03** — `prepare_compound_borrow` + `prepare_compound_repay` + intent-gates + `"max"` sentinel for repay + RECEIPT templates + per-tool tests. Depends on 28-01 + 28-02. ~1 atomic commit, ~500 LoC.

- **Plan 28-04** — `get_compound_market_info` + `get_lending_positions` Compound branch extension (discriminated-union widening) + `simulate_position_change` Compound arm + `src/chains/compound-v3.ts` completion (`getCometState` + `getAllCometStates`) + `src/signing/compound-collateralization.ts` + `src/security/canonical-dispatch.ts` Compound Comet allowlist + `src/signing/blocks.ts` Compound NOTICE template + `src/tools/preview_send.ts` three-tier dispatch + register-all imports + lifecycle integration test. Depends on 28-01 + 28-02 + 28-03. **Largest plan** — wires the reads + defense + integration.

**Carve order**: 28-01 → 28-02 → 28-03 → 28-04. 28-02 ∥ 28-03 parallel is possible (both depend only on 28-01) IF the orchestrator wants Phase 7-style parallel waves — but the intent-gate helper (`deriveIntent`) is shared between the 4 prepare tools, and shipping it in 28-02 first avoids duplication in 28-03. **Recommendation: serial** for the 4 prepare tools; parallel risk doesn't pay for the gain.

## 10. Coordination Points

| File | Plans touching | Coordination |
|---|---|---|
| `src/config/contracts.ts` | 28-01 only | SOT extension lives in Plan 28-01 entirely |
| `src/protocols/compound-v3.ts` | 28-01 only | Created in 28-01; 28-02..04 consume |
| `src/chains/compound-v3.ts` | 28-02 (partial: intent helpers) + 28-04 (completion: getCometState + fan-out) | 28-04 extends in place. Mirror Phase 7 split between Plan 07-02 / 07-03 sibling-shelf evolution |
| `src/signing/compound-collateralization.ts` | 28-04 only | Created in 28-04 |
| `src/tools/get_lending_positions.ts` | 28-04 only | Extended in 28-04 |
| `src/tools/simulate_position_change.ts` | 28-04 only | Extended in 28-04 |
| `src/tools/preview_send.ts` | 28-04 only | Three-tier dispatch + LEDGER NOTICE + intent re-derivation all in 28-04 |
| `src/signing/blocks.ts` | 28-02 (2 templates) + 28-03 (2 templates) + 28-04 (LEDGER NOTICE + 2 DECODED ARGS) | Append-only; each plan touches a distinct line range. Trivial rebase if any of 28-02/03/04 land out of order |
| `src/security/canonical-dispatch.ts` | 28-04 only | Ethereum-arm allowlist extension via SOT getter |
| `src/tools/register-all.ts` | 28-02 (+2 imports) + 28-03 (+2 imports) + 28-04 (+1 import) | Same wave-carve discipline as Phase 7. Group by read/prepare; insertions at distinct positions |

`src/signing/simulation.ts` — **already wide enough** for any tx shape (Phase 6 DF-1 widened). Compound preview-time simulation reuses without modification. No coordination needed.

## 11. FROZEN-Area Verification

Pattern-mapper asserts (read-only inspection of all 5 files):

| FROZEN File | Phase 28 Touches? |
|---|---|
| `src/signing/payload-fingerprint.ts` | NO — preimage assembly unchanged |
| `src/signing/presign-hash.ts` | NO — EIP-1559 pre-sign compute unchanged |
| `src/signing/handle-store.ts` (state machine) | NO — reuses existing `PrepareArgs` shape (`tokenAddress` field re-purposed for asset, mirror Phase 7) |
| `src/tools/send_transaction.ts` (three gates) | NO — handler unchanged; `tx` envelope built from `record.tx` + `record.pinned` only |
| `src/signing/error-codes.ts` (15-code union) | NO — intent-gate refusals reuse `INVALID_INPUT` with `hint.tool` field |

**All 5 FROZEN areas confirmed untouched.** Each Phase 28 plan's `<success_criteria>` MUST include a zero-diff assertion on these 5 files (`git diff --quiet -- <file>` or equivalent).

## Metadata

**Analog search scope:** `src/tools/*.ts`, `src/protocols/*.ts`, `src/signing/*.ts`, `src/chains/*.ts`, `src/security/*.ts`, `src/config/*.ts`, `test/*.test.ts`
**Files scanned:** 11 critical analogs full-read + 4 supporting files targeted-read + Phase 7 PATTERNS.md reference
**Pattern extraction date:** 2026-05-20
**No-analog items:** 1 pattern is genuinely new (**intent-vs-reality gates** — § Greenfield). 0 files lack an analog — every file maps to a Phase 6/7 precedent for shape.
**FROZEN-area assertion files:** 5 (`payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts` state machine, `send_transaction.ts` three gates, `error-codes.ts` 15-code union)
**Reference PATTERNS doc:** [`.planning/phases/07-aave-v3-ethereum/07-PATTERNS.md`](../07-aave-v3-ethereum/07-PATTERNS.md)
