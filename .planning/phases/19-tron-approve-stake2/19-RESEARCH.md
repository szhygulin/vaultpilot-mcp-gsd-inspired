# Phase 19: TRC-20 approve + Stake 2.0 — Research

**Researched:** 2026-05-20
**Domain:** TRON Stake 2.0 Protobuf contracts, TRC-20 approve ABI, SR registry API, voting rewards, vitest fake timers
**Confidence:** HIGH on tronweb 6.3.0 API surface (verified against installed `.d.ts`), TRON contract type shapes (verified against `Contract.d.ts`), and TRC-20 approve ABI (confirmed EVM-identical selector). MEDIUM on `getRewardInfo` TronGrid endpoint shape (TronGrid docs; not a tronweb SDK method). LOW on LiFi TRON facet exact address (not confirmed in official docs at research time).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: TRC-20 approve byte-identity invariant**
- Shared internal helper `prepareTronApproveInternal({ from, tokenAddress, spender, amount })` enforces by construction that `prepare_tron_revoke_approval({T, S})` produces byte-identical `raw_data_hex` + `payloadFingerprint` as `prepare_tron_token_approve({T, S, amount: "0"})`.
- T-TRON-REVOKE-DRIFT-1 test asserts `rawDataHex` equality + `payloadFingerprint` equality.
- Distinct tool registrations for `prepare_tron_token_approve` and `prepare_tron_revoke_approval`.

**D-02: Unlimited-approval surfacing**
- Strict-equality `amount === "115792089237316195423570985008687907853269984665640564039457584007913129639935"` → `⚠ UNLIMITED APPROVAL`.
- Sentinel-aliasing: `amount: "max"` → MAX_UINT256 (lowercase strict-equality only; rejects `"MAX"` / `"unlimited"` / `"infinite"`).
- PREPARE RECEIPT surfaces the canonical decimal-string `amount` value verbatim (the agent's input).

**D-03: Stake 2.0 only — Energy + Bandwidth resource enum**
- Phase 19 ships ONLY `FreezeBalanceV2Contract`. `FreezeBalanceContract` (Stake 1.0) is out of scope.
- `prepare_tron_stake_freeze({ amount, resource: "ENERGY" | "BANDWIDTH" })` — single tool with enum.
- `prepare_tron_stake_unfreeze({ amount, resource })` mirrors. `prepare_tron_withdraw_expire_unfreeze` is no-arg.

**D-04: 14-day waiting period — informational surfacing only**
- 14-day unfreeze waiting period is NOT enforced server-side.
- `CHECKS PERFORMED` emits: `"Unfreeze becomes withdrawable after 14 days; this tx initiates the waiting period."`.
- `prepare_tron_withdraw_expire_unfreeze` does NOT pre-check waitlist state at prepare time. Layer 0.7 (`triggerconstantcontract` REVERT) catches "no withdrawable balance" at preview time.

**D-05: Super-representative validation — hybrid registry (live + snapshot fallback)**
- Primary fetch via `tronWeb.trx.listSuperRepresentatives()` at prepare time; on RPC failure, demote to bundled snapshot `src/tokens/tron-srs.json`.
- Response surfaces `srSource: "live" | "snapshot-fallback"` in CHECKS PERFORMED block.
- Per-SR labeling: known SR → `(SR: <name> — vote rank <N>)`; unknown SR → `(unverified SR — confirm address)`.

**D-06: Voting rewards — advisory `estimatedRewardSun` (best-effort, demote-to-null on failure)**
- `prepare_tron_stake_claim_rewards` is no-arg, producing `WithdrawBalanceContract()`.
- Best-effort `getRewardInfo(address)` fetch at prepare time. Surface as advisory `estimatedRewardSun: string | null`.
- NO intent-vs-reality gate — calldata has no args to mismatch against.

**D-07: Spender labels table extension**
- `src/config/contracts.ts` extends with TRON sub-table `KNOWN_SPENDERS_TRON`.
- Entries: SunSwap V2 router, LiFi TRON facet (address to verify), canonical TRC-20 stablecoins (USDT/USDC/USDD/TUSD).
- Unknown spender → `(unknown spender — no prior interaction recorded)`.

**D-08: Fixture naming — sibling carve `Tron-19-{A,B,C,D}`**
- Fixtures Tron-19-A (TRC-20 approve), Tron-19-B (FreezeBalanceV2 freeze), Tron-19-C (VoteWitnessContract), Tron-19-D (WithdrawBalanceContract).
- New sibling file `test/signing-fingerprint-tron-19.test.ts` — `test/signing-fingerprint-tron.test.ts` BYTE-UNTOUCHED.
- NO `beforeAll`-snapshot — hardcoded `0x...` literals only.

**D-09: Plan structure — 4 plans strict-sequential**
- 19-01: `prepare_tron_token_approve` + `prepare_tron_revoke_approval` + shared helper + Fixture Tron-19-A + TRON spender table
- 19-02: `prepare_tron_stake_freeze` + `prepare_tron_stake_unfreeze` + `prepare_tron_withdraw_expire_unfreeze` + Fixture Tron-19-B
- 19-03: `prepare_tron_stake_vote` + `prepare_tron_stake_claim_rewards` + SR registry hybrid loader + Fixtures Tron-19-C + Tron-19-D
- 19-04: Lifecycle integration test + FROZEN-area assertions + SECURITY.md update

**D-10: Lifecycle integration test in Wave 4**
- `test/lifecycle-tron-stake-19.integration.test.ts` — freeze → unfreeze → 14-day-elapsed → withdraw-expire flow.
- `vi.setSystemTime` advances test clock past the 14-day window.

**D-11: FROZEN-area discipline**
- Phase 18 primitives BYTE-FROZEN: all `src/signing/*-tron.ts` + `src/protocols/tron-native.ts` + `src/protocols/tron-trc20.ts` + `src/security/canonical-dispatch-tron.ts` + `src/signing/handle-store.ts` + Phase 18 prepare tools.
- EVM approve/revoke siblings BYTE-FROZEN.
- Three-gate FROZEN region of `send_transaction.ts` BYTE-IDENTICAL.
- `test/signing-fingerprint-tron.test.ts` BYTE-UNTOUCHED.
- `src/signing/error-codes.ts` 23-code locked union UNCHANGED.

### Claude's Discretion

- Internal helper names: `prepareTronApproveInternal`, `prepareTronStakeInternal`, `buildTronVoteContract`, `buildTronClaimContract`.
- Per-fixture literal anchor values — computed via `node -e` at execute time.
- `tron-srs.json` snapshot file shape — mirrors `tron-top-25.json` discipline.
- LiFi TRON facet exact address — researcher verifies against LiFi deployment manifest at planning time.

### Deferred Ideas (OUT OF SCOPE)

- SunSwap V2 swap + LiFi TRON bridging — Phase 20.
- TRON multi-chain portfolio extension + setup diagnostic — Phase 21.
- Legacy Stake 1.0 support — out of scope.
- Stake 2.0 delegate-to-other-account flow — deferred.
- TRC-721 / TRC-1155 approve — v3.1 NFT support.
- Voting power transfer between SRs in a single tx — out of scope.
- SR-rotation-detection alerts — out of scope.
- Stake-claim accounting auto-reconciliation — out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRON-PREP-05 | `prepare_tron_token_approve({ tokenAddress, spender, amount })` — TRC-20 `approve(spender, amount)` TriggerSmartContract; `amount: "max"` → MAX_UINT256; preview labels unlimited approvals `⚠ UNLIMITED APPROVAL` | Topic 6 (ABI selector confirmed), Topic 1 (shared helper pattern), D-01/D-02 |
| TRON-W-03 | `prepare_tron_revoke_approval({ tokenAddress, spender })` — shortcut for `approve(spender, 0)`, byte-identical calldata to TRON-PREP-05 with `amount: "0"` | Topic 1 (byte-identity pattern), D-01 |
| TRON-W-04 | `prepare_tron_stake_freeze({ amount, resource: "ENERGY"\|"BANDWIDTH" })` — `FreezeBalanceV2Contract` (Stake 2.0) | Topic 2 (Protobuf shape confirmed in `.d.ts`), Topic 3 |
| TRON-W-05 | `prepare_tron_stake_unfreeze({ amount, resource })` + `prepare_tron_withdraw_expire_unfreeze` — 14-day lifecycle; withdraw is zero-arg | Topic 3 (Protobuf confirmed, `WithdrawExpireUnfreezeContract.owner_address` only), D-04 |
| TRON-W-06 | `prepare_tron_stake_vote({ votes: [{ srAddress, count }] })` — `VoteWitnessContract` with SR registry lookup | Topic 4 (VoteInfo shape confirmed in `.d.ts`), Topic 7 (SR registry API) |
| TRON-W-07 | `prepare_tron_stake_claim_rewards` — `WithdrawBalanceContract()` for accumulated voting rewards | Topic 5 (zero-arg confirmed in `.d.ts`), Topic 8 (`getReward` API) |
| TRON-W-08 | TRON-specific spender-label table extends `src/config/contracts.ts` | Topic 7 (SunSwap V2 router address confirmed), D-07 |
</phase_requirements>

---

## Summary

Phase 19 ships 7 new MCP prepare tools that sit entirely on top of the Phase 18 primitives shelf. No new signing primitives are needed; the research confirms all 7 tools can be built by calling tronweb 6.3.0's `transactionBuilder.*` methods (verified against installed `.d.ts`) + reusing `_tronFingerprint`, `_tronPresign`, `parseTronAmountStrict`, `extendExpiration`, `canonical-dispatch-tron`, and `handle-store.ts` unchanged.

The most critical findings: (1) `FreezeBalanceV2Contract` and `UnfreezeBalanceV2Contract` are fully present in tronweb 6.3.0 via `transactionBuilder.freezeBalanceV2` / `unfreezeBalanceV2` — Stake 2.0 is a first-class supported API. (2) `WithdrawExpireUnfreezeContract` is zero-arg at the builder level (`transactionBuilder.withdrawExpireUnfreeze(ownerAddress)` — no `amount` parameter exists). (3) `VoteInfo` is a `Record<string, number>` (srAddress → vote_count) map passed to `transactionBuilder.vote(voteInfo, voterAddress)`. (4) `tronweb.trx.getReward(address)` returns a `Promise<number>` (SUN units) — this is the reward estimate for `WithdrawBalanceContract`. (5) `tronweb.trx.listSuperRepresentatives()` returns `Promise<Witness[]>` where each `Witness` carries `address`, `url`, `voteCount`, `isJobs` — confirms D-05's hybrid registry design. (6) TRC-20 `approve(spender, uint256)` selector is `0x095ea7b3` — confirmed ABI-identical to EVM ERC-20 via the standard `keccak256("approve(address,uint256)")[0:4]` derivation.

The one significant design nuance: tronweb's `vote()` builder takes a `VoteInfo` object (`{ [srAddress: string]: number }`) — NOT an array. Phase 19's `prepare_tron_stake_vote` input takes `{ votes: [{ srAddress, count }] }` (array) but must convert to `VoteInfo` before calling the builder.

**Primary recommendation:** Build Phase 19 strictly as a consumer of Phase 18 primitives. Every new tool follows the `encodeTronTrc20Transfer` pattern: call `transactionBuilder.*`, extend expiration to 900s, extract `rawDataHex`, compute fingerprint via `_tronFingerprint`, store handle. No Protobuf hand-rolling needed — tronweb handles all encoding.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TRC-20 approve calldata encoding | Protocol (`src/protocols/tron-approve.ts`) | tronweb `transactionBuilder.triggerSmartContract("approve(address,uint256)", ...)` | Mirrors `tron-trc20.ts` pattern; tronweb handles ABI encoding |
| Approve/revoke byte-identity | Protocol (`prepareTronApproveInternal` helper) | — | Shared helper construction enforces invariant by design |
| Unlimited approval detection | Signing (`src/signing/blocks-tron.ts` template) | `parseTronAmountStrict` MAX_UINT256 comparison | Strict-equality sentinel per D-02; template in blocks-tron.ts |
| FreezeBalanceV2 encoding | Protocol (`src/protocols/tron-stake.ts`) | tronweb `transactionBuilder.freezeBalanceV2` | Stake 2.0 builder confirmed in `.d.ts`; no Protobuf hand-rolling |
| UnfreezeBalanceV2 encoding | Protocol (same `tron-stake.ts`) | tronweb `transactionBuilder.unfreezeBalanceV2` | Same module — logically grouped with freeze |
| WithdrawExpireUnfreeze encoding | Protocol (same `tron-stake.ts`) | tronweb `transactionBuilder.withdrawExpireUnfreeze` | Zero-arg builder; `owner_address` is the only Protobuf field |
| VoteWitnessContract encoding | Protocol (`src/protocols/tron-vote.ts` or same stake module) | tronweb `transactionBuilder.vote(VoteInfo, voterAddress)` | VoteInfo = `{ [srAddress]: count }` map; array-to-map conversion at protocol layer |
| WithdrawBalanceContract encoding | Protocol (vote module) | tronweb `transactionBuilder.withdrawBlockRewards(ownerAddress)` | Zero-arg builder; `owner_address` only |
| SR registry hybrid loader | Protocol (`src/protocols/tron-sr-registry.ts`) | `tronWeb.trx.listSuperRepresentatives()` + `src/tokens/tron-srs.json` fallback | D-05 hybrid policy |
| Voting reward estimate | Protocol (same vote tools) | `tronWeb.trx.getReward(address)` returns SUN as `number` | Advisory only; demote-to-null on failure |
| `payloadFingerprint` | Signing (`src/signing/payload-fingerprint-tron.ts`) FROZEN | `_tronFingerprint.computeTronPayloadFingerprint` | Phase 18 primitive; Phase 19 consumes unchanged |
| Expiration extension | Protocol layer | `tronWeb.transactionBuilder.extendExpiration(tx, 900)` | Load-bearing per Phase 18 research Topic 5; must call after every builder call |
| Spender label lookup | Config (`src/config/contracts.ts`) | New `KNOWN_SPENDERS_TRON` sub-table | SOT extension per D-07; mirrors `KNOWN_SPENDERS_ETHEREUM` shape |
| LEDGER NOTICE emission | Signing (`src/signing/blocks-tron.ts`) | `LEDGER_NOTICE_TRON_TEMPLATE` (pre-staged in Phase 18) | TRC-20 approve + Stake 2.0 contracts are NOT in TRX app bundled registry — NOTICE fires for every Phase 19 tool |

---

## § Topic 1: Shared `prepareTronApproveInternal` helper pattern

**Confirmed design:** The EVM Phase 6 pattern in `src/tools/prepare_token_approve.ts` exports `prepareApproveInternal` as a named helper; `prepare_revoke_approval.ts` imports it and calls with `amountWei: 0n`. This produces byte-identical calldata + fingerprint. Phase 19 mirrors exactly.

**TRON implementation shape:**

```typescript
// src/protocols/tron-approve.ts (new — Plan 19-01)
export async function prepareTronApproveInternal(input: {
  tronWeb: TronWeb;
  from: string;          // base58check
  tokenAddress: string;  // base58check
  spender: string;       // base58check
  amount: bigint;        // 0n for revoke, MAX_UINT256 for unlimited, parsed for bounded
}): Promise<TronApproveEncodeResult> {
  // tronweb ABI-encodes approve(address,uint256) via triggerSmartContract
  const rawResult = await input.tronWeb.transactionBuilder.triggerSmartContract(
    input.tokenAddress,              // base58check
    "approve(address,uint256)",      // function selector = 0x095ea7b3
    { feeLimit: 100_000_000, callValue: 0 },
    [
      { type: "address", value: input.spender },
      { type: "uint256", value: input.amount.toString() },  // CRITICAL: .toString() not bigint
    ],
    input.from,
  );
  // ... verify result.result.result === true
  // ... extendExpiration(tx, 900)
  // ... return { rawDataHex, rawDataBytes, rawDataObject, ... }
}
```

**Byte-identity enforcement by construction:** Both `prepare_tron_token_approve` and `prepare_tron_revoke_approval` call `prepareTronApproveInternal` with pre-parsed `amount` bigint. The external tool validates input shape + resolves decimals + converts `"max"` sentinel; the internal helper sees only the bigint. Neither tool can drift the calldata. `[VERIFIED: src/tools/prepare_token_approve.ts — direct code inspection]`

**`amount.toString()` is load-bearing:** tronweb's `ContractFunctionParameter` expects `value: unknown` but the ABI encoder coerces via `JSON.stringify` for uint256. Passing a `bigint` directly causes silent precision loss above `Number.MAX_SAFE_INTEGER`. The `.toString()` call ensures the full decimal string is preserved. `[VERIFIED: src/protocols/tron-trc20.ts — existing Phase 18 pattern line 108]`

---

## § Topic 2: `FreezeBalanceV2Contract` and `UnfreezeBalanceV2Contract` Protobuf shapes

**Verified against installed `node_modules/tronweb/lib/esm/types/Contract.d.ts`:**

```typescript
// Contract.d.ts (installed tronweb 6.3.0)
export interface FreezeBalanceV2Contract {
  owner_address: string;   // base58check
  frozen_balance: number;  // SUN (NOT TRX — 6-decimal unit)
  resource?: Resource;     // "ENERGY" | "BANDWIDTH"
}

export interface UnfreezeBalanceV2Contract {
  owner_address: string;
  unfreeze_balance: number;  // SUN — the amount to unfreeze
  resource?: Resource;
}

export interface WithdrawExpireUnfreezeContract {
  owner_address: string;   // NO amount field — withdraws ALL expired records
}

export interface WithdrawBalanceContract {
  owner_address: string;   // NO amount field — withdraws ALL accumulated rewards
}
```

**TransactionBuilder methods (verified `TransactionBuilder.d.ts`):**

```typescript
freezeBalanceV2(
  amount?: number,       // SUN
  resource?: Resource,   // "ENERGY" | "BANDWIDTH"
  address?: string,      // owner — base58check
  options?: TransactionCommonOptions,
): Promise<Transaction<FreezeBalanceV2Contract>>;

unfreezeBalanceV2(
  amount?: number,       // SUN
  resource?: Resource,
  address?: string,
  options?: TransactionCommonOptions,
): Promise<Transaction<UnfreezeBalanceV2Contract>>;

withdrawExpireUnfreeze(
  address?: string,      // owner — no amount
  options?: TransactionCommonOptions,
): Promise<Transaction<WithdrawExpireUnfreezeContract>>;

withdrawBlockRewards(
  address?: string,      // owner — no amount
  options?: TransactionCommonOptions,
): Promise<Transaction<WithdrawBalanceContract>>;
```

`[VERIFIED: node_modules/tronweb/lib/esm/lib/TransactionBuilder/TransactionBuilder.d.ts + node_modules/tronweb/lib/esm/types/Contract.d.ts]`

**Stake 2.0 vs Stake 1.0 distinction:**
- Stake 1.0: `FreezeBalanceContract` — has `frozen_duration: number` field (days). `ContractType.FreezeBalanceContract = "FreezeBalanceContract"`.
- Stake 2.0: `FreezeBalanceV2Contract` — NO duration field; freeze is for indefinite period until unfrozen. `ContractType.FreezeBalanceV2Contract = "FreezeBalanceV2Contract"`.

These are DIFFERENT contract types with DIFFERENT Protobuf field encodings. Stake 1.0 builder: `transactionBuilder.freezeBalance(amount, duration, resource, ownerAddress)`. Stake 2.0 builder: `transactionBuilder.freezeBalanceV2(amount, resource, ownerAddress)`. Using the wrong builder silently produces the wrong Protobuf contract type in `raw_data.contract[0].type`.

**`frozen_balance` is in SUN (not TRX):** The builder's first arg is `amount?: number` (SUN). `parseTronAmountStrict(args.amount, 0, "u64")` is the right call since the user provides TRX as decimal (e.g. `"100"` meaning 100 TRX) and the tool scales by 1,000,000. This follows the `prepare_tron_native_send` pattern exactly. `[VERIFIED: tronweb SDK + existing Phase 18 pattern]`

**CRITICAL: tronweb builder `amount` is JavaScript `number` not `bigint`:** The `TransactionBuilder` typed API uses `number` for `frozen_balance`. For Phase 19's practical freeze amounts (≤ total TRX supply of ~90B TRX = 90_000_000_000_000_000 SUN), `Number.MAX_SAFE_INTEGER` (~9×10¹⁵) is barely sufficient. For safety: after `parseTronAmountStrict` returns a `bigint`, convert to `Number(scaled)` but assert `scaled <= BigInt(Number.MAX_SAFE_INTEGER)` to catch overflow. This is the same concern as in `prepare_tron_native_send`. `[ASSUMED — inferred from type declaration; safer than silent coercion]`

---

## § Topic 3: `WithdrawExpireUnfreezeContract` semantics and simulation behavior

**Zero-arg confirmation:** `WithdrawExpireUnfreezeContract` has ONLY `owner_address` — NO `amount` parameter. The protocol automatically identifies all records in the owner's `unfrozenV2` list where `unfreeze_expire_time <= now` and withdraws the sum. `[VERIFIED: Contract.d.ts — interface has no `amount` field]`

**14-day waiting period tracking:** The `Account.unfrozenV2` field is `UnFreezeV2[]` where each record has:
```typescript
interface UnFreezeV2 {
  type: Resource;               // "ENERGY" | "BANDWIDTH"
  unfreeze_amount: number;      // SUN
  unfreeze_expire_time: number; // milliseconds epoch — when this record becomes claimable
}
```
`[VERIFIED: Trx.d.ts line 63-70]`

**Simulation gate behavior for early withdrawal:** When `prepare_tron_withdraw_expire_unfreeze` is called before any records mature, `preview_send` fires `triggerconstantcontract` and receives a `REVERT` with reason `"no withdrawable balance"` (or similar; TRON VM revert reasons from Solidity `require(...)` errors encode as `Error(string)` in `constant_result[0]`). This fires the existing `SIMULATION_REFUSED` path in `simulation-tron.ts`. The Phase 18 simulation gate already handles this — no new code needed. `[ASSUMED — based on TRON VM behavior for Solidity require() + Phase 18 simulation handler design]`

**No server-side time-tracker needed:** The simulation gate is the enforcement mechanism. If the user calls `prepare_tron_withdraw_expire_unfreeze` after both unfreeze tx AND 14-day wait have elapsed, `triggerconstantcontract` returns `SUCCESS` and the SIMULATION_BLOCK_TRON_TEMPLATE shows `status: ok`. If called too early: `status: revert`, refusal fires. `[VERIFIED: Phase 18 D-04 design + confirmed builder is zero-arg]`

---

## § Topic 4: `VoteWitnessContract` Protobuf shape and `vote()` builder API

**Contract shape (verified `Contract.d.ts`):**
```typescript
export interface VoteWitnessContract {
  owner_address: string;
  votes: {
    vote_address: string;   // SR address — base58check (tronweb convention)
    vote_count: number;
  }[];
}
```

**Builder API (verified `TransactionBuilder.d.ts`):**
```typescript
vote(
  votes?: VoteInfo,       // { [srAddress: string]: number } — a plain object map
  voterAddress?: string,
  options?: TransactionCommonOptions,
): Promise<Transaction<VoteWitnessContract>>;
```

Where `VoteInfo` is defined in `TransactionBuilder.d.ts`:
```typescript
export interface VoteInfo {
  [srAddress: string]: number;  // key = SR base58check address, value = vote_count
}
```

**Array-to-object conversion at the protocol layer:** Phase 19's `prepare_tron_stake_vote` takes `{ votes: [{ srAddress, count }] }` (array) from the agent. The protocol layer must convert to `VoteInfo` before calling:
```typescript
const voteInfo: VoteInfo = {};
for (const v of input.votes) {
  voteInfo[v.srAddress] = v.count;
}
const tx = await tronWeb.transactionBuilder.vote(voteInfo, input.from);
```

**SR address format:** tronweb's `vote()` builder accepts base58check SR addresses in the `VoteInfo` keys — the same format Phase 17/18 patterns use (`tronweb.utils.address.isAddress()` validates them). The resulting Protobuf `vote_address` field in `VoteWitnessContract.votes[]` will also be base58check. `[VERIFIED: TransactionBuilder.d.ts type signature + Trx.d.ts Vote interface]`

**Vote count limits:** Total vote count is bounded by the owner's TRON Power (= total frozen TRX in Stake 2.0). Each 1 TRX frozen = 1 TRON Power = 1 vote. Exceeding available power causes the transaction to fail at broadcast (not at simulation). `[CITED: https://tronprotocol.github.io/documentation-en/mechanism-algorithm/stake2.0/]`

---

## § Topic 5: `WithdrawBalanceContract` and voting rewards

**Zero-arg confirmation:** `WithdrawBalanceContract` has ONLY `owner_address`. The `withdrawBlockRewards(ownerAddress)` builder confirms. `[VERIFIED: Contract.d.ts + TransactionBuilder.d.ts]`

**`getReward` tronweb API:**
```typescript
// lib/esm/lib/trx.d.ts
getReward(address: Address, options?: { confirmed?: boolean }): Promise<number>;
```
Returns SUN as a `number`. This is the reward the `WithdrawBalanceContract` will claim. Called at prepare time for the advisory `estimatedRewardSun`. `[VERIFIED: trx.d.ts line 299-301]`

**Return value semantics:** `getReward` returns accumulated voting rewards in SUN (not TRX). To surface as advisory: `estimatedRewardSun: result.toString()` (string representation of the SUN value). To demote on failure: `estimatedRewardSun: null`. `[VERIFIED: trx.d.ts]`

**CHECKS PERFORMED pattern for claim:**
```
CHECKS PERFORMED (TRON — Stake 2.0 claim rewards)
  estimatedRewardSun:  <N>  (advisory — final amount computed at broadcast time)
  rewardSource:        live (or "snapshot-unavailable — estimate omitted")
  WithdrawBalanceContract is zero-arg — no user intent to gate against
```

**`[WARN]` on reward estimate:** D-06c explicitly says NO intent-vs-reality gate. The estimate is informational. A user who calls claim when `getReward` returns 0 will just broadcast a valid transaction that transfers 0 SUN. That's not an error from the protocol's perspective. `[VERIFIED: CONTEXT D-06c]`

---

## § Topic 6: TRC-20 `approve(spender, uint256)` ABI — selector and encoding

**Selector confirmed:** `keccak256("approve(address,uint256)")[0:4] = 0x095ea7b3` — ABI-identical to ERC-20. This is the standard approve selector per the ABI specification; TRON's TRC-20 standard inherits from ERC-20 without modification. `[VERIFIED: Phase 18 RESEARCH §Topic 8 — "TRC-20 calldata is ABI-identical to ERC-20" + Ethereum ABI spec]`

**Full calldata encoding:**
```
Selector:  0x095ea7b3                                     (4 bytes)
Param 1:   <32-byte left-padded spender address (20 bytes)>
Param 2:   <32-byte big-endian uint256 amount>
Total:     68 bytes = 136 hex chars
```

**MAX_UINT256 encoding:** `2^256 - 1` as 32-byte big-endian = 64 hex characters of `ff`. As decimal string: `"115792089237316195423570985008687907853269984665640564039457584007913129639935"`. `[VERIFIED: src/protocols/erc20.ts — `export const MAX_UINT256: bigint = (1n << 256n) - 1n`]`

**`"max"` sentinel handling:**
```typescript
// In prepare_tron_token_approve tool handler (before calling prepareTronApproveInternal):
let amountBigint: bigint;
if (rawAmount === "max") {
  amountBigint = MAX_UINT256;  // from src/signing/amount-tron.ts or from U256_MAX constant
} else {
  // resolve token decimals → parseTronAmountStrict(rawAmount, decimals, "u256")
}
```
`rawAmount === "max"` is strict lowercase equality per D-02b. `rawAmount === "MAX"` falls through to `parseTronAmountStrict` which rejects it with `kind: "format"`. `[VERIFIED: src/tools/prepare_token_approve.ts — direct code inspection of T-MAX-SPELLING-1 pattern]`

**`amount.toString()` for tronweb:** Same discipline as Phase 18 TRC-20 transfer — pass `amount.toString()` (decimal string) to the `type: "uint256"` parameter, NOT the bigint directly. `[VERIFIED: src/protocols/tron-trc20.ts line 108]`

**PREPARE RECEIPT for approve:** The PREPARE RECEIPT surfaces the raw agent-supplied `amount` string — NOT the resolved MAX_UINT256 decimal expansion. If the user passed `"max"`, the PREPARE RECEIPT shows `amount: max`. The on-device label in CHECKS PERFORMED shows `amountResolved: 115792...39935 (unlimited)`. `[VERIFIED: D-02c]`

---

## § Topic 7: Super Representative registry — `listSuperRepresentatives` endpoint

**tronweb API (verified `trx.d.ts`):**
```typescript
listSuperRepresentatives(): Promise<Witness[]>;
```

Where `Witness extends BaseWitness`:
```typescript
// Trx.d.ts
export interface BaseWitness {
  address: string;      // base58check T-prefix
  voteCount: number;
  url: string;          // SR website URL
  totalProduced: number;
  totalMissed: number;
  latestBlockNum: number;
  latestSlotNum: number;
  isJobs: boolean;      // true = SR candidate in "jobs" position
}
export interface Witness extends BaseWitness {
  pubKey: string;
}
```
`[VERIFIED: node_modules/tronweb/lib/esm/types/Trx.d.ts]`

**SR snapshot file shape:** Mirrors `tron-top-25.json` discipline. Recommended structure:
```json
[
  {
    "address": "T...",
    "name": "Binance Staking",
    "url": "https://www.binance.com",
    "rank": 1,
    "voteCount": 12345678
  }
]
```
Import via `tron-srs.json` at `src/tokens/tron-srs.json`. The snapshot includes `name` (human-readable) where known; `address` is the primary key. `[ASSUMED — structure inferred from `tron-top-25.json` discipline; exact field names at implementer's discretion per Claude's Discretion]`

**Polling cadence:** `listSuperRepresentatives()` is called once per `prepare_tron_stake_vote` invocation at prepare time (NOT cached between calls). The 6-hour SR rotation cadence is faster than our snapshot refresh but the live-primary / snapshot-fallback design means: (1) if TronGrid is up → always live data; (2) if TronGrid is down → snapshot (stale but functional). No per-session caching needed. `[VERIFIED: D-05 + trx.d.ts]`

**SunSwap V2 Router address:** `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax` — confirmed via TRON DAO documentation and multiple independent sources. `[ASSUMED — discovered via WebSearch + confirmed address matches what CONTEXT D-07a already specifies; requires final verification against https://docs.sun.io before commit]`

**LiFi TRON facet address:** Not confirmed in official LiFi docs at research time. The LiFi Diamond entryway on EVM is `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` but TRON is not EVM — would require a separate deployment. **MUST verify against https://github.com/lifinance/contracts deployments folder before writing to `contracts.ts`.** `[LOW confidence — not confirmed; requires human verification]`

---

## § Topic 8: `getRewardInfo` endpoint and tronweb `getReward`

**tronweb SDK method (verified `.d.ts`):**
```typescript
getReward(address: Address, options?: { confirmed?: boolean }): Promise<number>;
```
This calls TronGrid's `wallet/getrewardinfo` endpoint internally. The response is a plain `number` (SUN units) — tronweb extracts the relevant field.

**Direct TronGrid endpoint (for reference):**
```
GET https://api.trongrid.io/wallet/getrewardinfo?address=<base58address>&visible=true
Response: { "reward": 12345 }  // SUN as integer
```

**Usage pattern in `prepare_tron_stake_claim_rewards`:**
```typescript
let estimatedRewardSun: string | null;
try {
  const rewardSun = await _tronReward.getRewardInfo(fromAddress);
  estimatedRewardSun = String(rewardSun);
} catch {
  estimatedRewardSun = null;
}
```

The `_tronReward` indirection object provides the ESM spy seam for tests. `[VERIFIED: trx.d.ts line 299-301 + Phase 18 _tronRegistry pattern]`

**Demote-to-null semantics:** Any thrown exception (network failure, unexpected response shape, TronGrid rate-limit) catches to `null`. The `CHECKS PERFORMED` block then shows `"estimate unavailable (RPC failure)"` per D-06b. `[VERIFIED: D-06]`

---

## § Topic 9: `vi.setSystemTime` integration with vitest fake timers

**Canonical project pattern:** The project already uses `vi.useFakeTimers()` + `vi.setSystemTime()` in `test/request-capability-rate-limit.test.ts` and `test/signing-handle-store.test.ts`. Pattern:
```typescript
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(t0);
});
afterEach(() => {
  vi.useRealTimers();
});
```
`[VERIFIED: grep against test/ directory]`

**For lifecycle integration test — 14-day mock:**
```typescript
// test/lifecycle-tron-stake-19.integration.test.ts
const t0 = Date.now();
vi.useFakeTimers();
vi.setSystemTime(t0);

// ... freeze tx, unfreeze tx ...

// Mock 14-day + 1-hour elapsed
vi.setSystemTime(t0 + (14 * 86400 + 3600) * 1000);

// ... prepare_tron_withdraw_expire_unfreeze should now succeed simulation
```

**Critical nuance — simulation-tron.ts uses `Date.now()`?** The simulation gate calls `triggerconstantcontract` via TronGrid RPC — it does NOT use `Date.now()`. The fake timer doesn't affect network calls. For the lifecycle test, the simulation must be MOCKED (via `vi.spyOn(_simulationTron, "simulateTronTrigger")`): before time advance, mock returns `{ status: "revert", revertReason: "no withdrawable balance" }`; after time advance, mock returns `{ status: "ok" }`. The `vi.setSystemTime` advance models the user's experience across a 14-day window even though no actual time passes in the test. `[VERIFIED: test/trust-pipeline-tron.integration.test.ts mock pattern — `_simulationTron` spy-affordance used]`

**Do NOT rely on `vi.setSystemTime` to make `triggerconstantcontract` aware of elapsed time.** The mock is the right mechanism. `vi.setSystemTime` can be used to advance TTL checks (e.g., `HANDLE_TTL_MS = 15 * 60 * 1000` in handle-store.ts) and to simulate elapsed time in any code that calls `Date.now()` internally, but the simulation gate's behavior is driven by the mocked return value. `[VERIFIED: handle-store.ts uses `Date.now()` for TTL eviction — fake timers DO apply there]`

---

## § Topic 10: Top 5 pitfalls to flag in plan-check

### Pitfall 1: Using Stake 1.0 builder instead of Stake 2.0

**What goes wrong:** Calling `transactionBuilder.freezeBalance(amount, duration, resource, owner)` (Stake 1.0) instead of `transactionBuilder.freezeBalanceV2(amount, resource, owner)` (Stake 2.0). The Stake 1.0 builder silently produces `FreezeBalanceContract` in `raw_data.contract[0].type`; the TRON network rejects it at broadcast with `"Stake 1.0 is deprecated"` error. This cannot be caught by `triggerconstantcontract` simulation because Stake 1.0 deprecation is enforced at the validator level, not the VM level.

**Prevention:** Test assertion on `raw_data.contract[0].type === "FreezeBalanceV2Contract"` in every stake fixture. Fixture Tron-19-B hardcoded literal anchor makes regression impossible. Plan checker asserts no call to `transactionBuilder.freezeBalance` (Stake 1.0 method) in Phase 19 files.

### Pitfall 2: SR address format mismatch (passing hex to `vote()`)

**What goes wrong:** `transactionBuilder.vote(VoteInfo, voterAddress)` expects base58check addresses in `VoteInfo` keys. If `srAddress` from the SR registry response comes back as 0x41-prefixed hex (as tronweb sometimes returns from `raw_data.contract[*].parameter.value.*_address` decoded fields), passing it directly to `vote()` produces a transaction with wrong Protobuf field values. The fingerprint would be different from expected, and the Ledger display would show a mangled address.

**Prevention:** Normalize all `srAddress` values via `tronweb.utils.address.isAddress()` + `formatTronAddress(hex)` before building the `VoteInfo` object. Phase 17's `src/chains/tron/address.ts` has the converters — use them. `listSuperRepresentatives()` returns `address` in base58check already (confirmed from `BaseWitness.address: string`); the risk is when vote addresses are read from other sources.

### Pitfall 3: `WithdrawExpireUnfreezeContract` has no `amount` argument

**What goes wrong:** Writing `transactionBuilder.withdrawExpireUnfreeze(ownerAddress, amount)` thinking it takes an amount like the EVM pattern. `withdrawExpireUnfreeze` takes only the owner address — the second arg is `options?: TransactionCommonOptions`, not an amount. Passing a number as the second arg passes it as `permissionId` in options (a silent partial-options coercion).

**Prevention:** `[VERIFIED: TransactionBuilder.d.ts]` — `withdrawExpireUnfreeze(address?: string, options?: TransactionCommonOptions)`. No amount. Fixture Tron-19-B tests the full lifecycle; if `amount` was accidentally threaded, the transaction would likely pass but withdraw a different amount (whatever the protocol decides for all expired records). The test asserting `raw_data.contract[0].type === "WithdrawExpireUnfreezeContract"` catches structural issues; amount-independence is structural to the contract.

### Pitfall 4: MAX_UINT256 as decimal string — surfacing vs encoding

**What goes wrong:** The PREPARE RECEIPT surfaces `amount: max` (verbatim agent input per D-02c). The CHECKS PERFORMED block surfaces `amountResolved: 115792...` (the 78-digit decimal). If a developer accidentally surfaces the expanded decimal in the PREPARE RECEIPT, or the raw `"max"` string in the on-device hash derivation, the cryptographic binding is wrong in one direction and the UX is confusing in the other.

**Prevention:** Two separate surfaces: (1) `args.amount = rawAmount = "max"` (what goes into PREPARE RECEIPT and `handle.args`); (2) `tx.approvedAmount = amountBigint` (what encodes into the TriggerSmartContract calldata and goes into `raw_data_hex`). The `payloadFingerprint` commits to the calldata bytes (MAX_UINT256 encoded), which is correct — the user sees the unlimited decimal on-device via CHECKS PERFORMED. PREPARE RECEIPT shows the agent's original intent (`"max"`).

### Pitfall 5: `transactionBuilder.vote()` takes `VoteInfo` map not array

**What goes wrong:** Passing the agent's `votes` array directly to `transactionBuilder.vote(votes, voterAddress)`. The TypeScript types would catch this at compile time if the plan uses strict types, but if the plan uses `as unknown as VoteInfo` or a similar cast, the array is silently misinterpreted. The tronweb builder's param validation may throw or produce malformed calldata.

**Prevention:** The protocol layer MUST convert: `const voteInfo: VoteInfo = Object.fromEntries(input.votes.map(v => [v.srAddress, v.count]))`. This is a one-liner. The Fixture Tron-19-C hardcoded literal catches downstream fingerprint drift. Plan checker asserts the conversion is explicit in the implementation.

---

## Standard Stack

### Core (Phase 19 consumers — FROZEN primitives from Phase 18)

| Library / Module | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tronweb` | 6.3.0 (locked Phase 17) | `transactionBuilder.freezeBalanceV2`, `unfreezeBalanceV2`, `withdrawExpireUnfreeze`, `withdrawBlockRewards`, `vote`, `triggerSmartContract` for approve | Locked version; Stake 2.0 builders confirmed in installed `.d.ts` |
| `src/signing/payload-fingerprint-tron.ts` | Phase 18 FROZEN | `_tronFingerprint.computeTronPayloadFingerprint` | Phase 18 primitive; consumed unchanged |
| `src/signing/presign-hash-tron.ts` | Phase 18 FROZEN | `_tronPresign.computeTronPresignHash` | Phase 18 primitive; consumed unchanged |
| `src/signing/amount-tron.ts` | Phase 18 FROZEN | `parseTronAmountStrict`, `U256_MAX` | Phase 18 primitive; `U256_MAX` is the MAX_UINT256 value |
| `src/signing/blocks-tron.ts` | Phase 18 FROZEN (append-only) | New templates appended for Phase 19 | Format-fanout-sentinel; 3 new templates land here |
| `src/signing/handle-store.ts` | Phase 18 FROZEN (union-widening) | New `TronInstructionSummary` kinds for approve + stake | Additive-only |

### New Files (Phase 19 ships)

| File | Purpose |
|------|---------|
| `src/protocols/tron-approve.ts` | `prepareTronApproveInternal` shared helper + `encodeTronTrc20Approve` + `decodeTronTrc20ApproveCall` |
| `src/protocols/tron-stake.ts` | `encodeTronFreezeV2` + `encodeTronUnfreezeV2` + `encodeTronWithdrawExpireUnfreeze` |
| `src/protocols/tron-vote.ts` | `encodeTronVoteWitness` + `encodeTronWithdrawRewards` |
| `src/protocols/tron-sr-registry.ts` | `loadSrRegistry()` — hybrid live/snapshot loader with `srSource` tagging |
| `src/tokens/tron-srs.json` | Bundled SR snapshot (top ~27 SRs with name + address + rank) |
| `src/tools/prepare_tron_token_approve.ts` | Tool handler — TRON-PREP-05 |
| `src/tools/prepare_tron_revoke_approval.ts` | Tool handler — TRON-W-03 |
| `src/tools/prepare_tron_stake_freeze.ts` | Tool handler — TRON-W-04 |
| `src/tools/prepare_tron_stake_unfreeze.ts` | Tool handler — TRON-W-04 sibling |
| `src/tools/prepare_tron_withdraw_expire_unfreeze.ts` | Tool handler — TRON-W-05 |
| `src/tools/prepare_tron_stake_vote.ts` | Tool handler — TRON-W-06 |
| `src/tools/prepare_tron_stake_claim_rewards.ts` | Tool handler — TRON-W-07 |
| `test/signing-fingerprint-tron-19.test.ts` | Fixture anchors Tron-19-{A,B,C,D} |
| `test/lifecycle-tron-stake-19.integration.test.ts` | Lifecycle integration test — Plan 19-04 |

### New Templates in `src/signing/blocks-tron.ts` (append-only)

Three new templates land in `blocks-tron.ts` below the Phase 18 templates. They are append-only:

1. **`UNLIMITED_APPROVAL_TRON_TEMPLATE`** — conditional block emitted in CHECKS PERFORMED when `amount === MAX_UINT256`. Mirrors EVM `DECODED_ARGS_TEMPLATE_APPROVE`'s `⚠ UNLIMITED APPROVAL` section.

2. **`STAKE_RESOURCE_TRON_TEMPLATE`** — CHECKS PERFORMED block for freeze/unfreeze tools. Surfaces resource type, amount, and informational note.

3. **`REWARD_ESTIMATE_TRON_TEMPLATE`** — CHECKS PERFORMED block for claim_rewards tool. Surfaces `estimatedRewardSun` (or unavailable) and advisory note.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stake 2.0 Protobuf encoding | Custom Protobuf FreezeBalanceV2 serializer | `transactionBuilder.freezeBalanceV2(amount, resource, owner)` | tronweb encodes all Protobuf fields correctly; hand-rolling risks field-order issues |
| VoteWitnessContract encoding | Custom votes-array serializer | `transactionBuilder.vote(VoteInfo, voterAddress)` | tronweb handles `VoteInfo` map → Protobuf `votes[]` conversion |
| TRC-20 approve calldata | Custom ABI encoding for `0x095ea7b3` | `transactionBuilder.triggerSmartContract("approve(address,uint256)", ...)` | Same discipline as Phase 18 TRC-20 transfer |
| SR data fetch + caching layer | Custom HTTP client + TTL cache | `tronweb.trx.listSuperRepresentatives()` + bundled snapshot JSON | tronweb wraps TronGrid consistently; snapshot is the fallback |
| Voting reward fetch | Custom `fetch("wallet/getrewardinfo")` | `tronweb.trx.getReward(address)` | tronweb wraps and normalizes the response |
| MAX_UINT256 definition | Re-derive `(1n << 256n) - 1n` inline | Import `U256_MAX` from `src/signing/amount-tron.ts` | Already defined; import prevents duplication |

**Key insight:** All Phase 19 Protobuf encoding is delegated entirely to tronweb's `transactionBuilder.*` methods, the same as Phase 18. The "protocol layer" in this project is purely a wrapping adapter that calls the SDK and extracts `rawDataHex`.

---

## Architecture Patterns

### System Architecture Diagram

```
Agent (prepare_tron_stake_freeze args)
   │
   ▼
Tool handler (validate args, resolve demo/real mode, get paired address)
   │
   ├── parseTronAmountStrict(amount, 0, "u64") — SUN validation
   ├── tronWeb.transactionBuilder.freezeBalanceV2(sunAmount, resource, owner)
   ├── tronWeb.transactionBuilder.extendExpiration(tx, 900) — LOAD-BEARING
   └── extract rawDataHex → rawDataBytes
   │
   ▼
_tronFingerprint.computeTronPayloadFingerprint({ rawDataBytes })
   │
   ▼
createHandle({ args, tx: PreparedTxTron, payloadFingerprint })
   │
   ▼
PREPARE RECEIPT (blocks-tron.ts template substitution)
   │
   ▼
structuredContent { handle, chain: "tron", ..., payloadFingerprint }
```

For `prepare_tron_stake_vote`:
```
Agent (votes: [{ srAddress, count }])
   │
   ├── validate each srAddress via tronweb.utils.address.isAddress
   ├── _tronSrRegistry.loadSrRegistry() — live + snapshot fallback
   │     ├── tronweb.trx.listSuperRepresentatives() [PRIMARY]
   │     └── src/tokens/tron-srs.json [FALLBACK]
   ├── for each vote: label SR as known/unverified
   ├── convert [ { srAddress, count } ] → VoteInfo map
   ├── tronWeb.transactionBuilder.vote(voteInfo, voterAddress)
   ├── extendExpiration(tx, 900)
   └── extract rawDataHex → rawDataBytes
   │
   ▼
(same fingerprint → handle → receipt flow as above)
```

### Recommended Project Structure (new files only)

```
src/
├── protocols/
│   ├── tron-approve.ts        # prepareTronApproveInternal + encode/decode
│   ├── tron-stake.ts          # encodeTronFreezeV2, UnfreezeV2, WithdrawExpireUnfreeze
│   ├── tron-vote.ts           # encodeTronVoteWitness, encodeTronWithdrawRewards
│   └── tron-sr-registry.ts    # loadSrRegistry() hybrid loader
├── tokens/
│   └── tron-srs.json          # bundled SR snapshot
├── config/
│   └── contracts.ts           # KNOWN_SPENDERS_TRON sub-table (extends existing)
├── tools/
│   ├── prepare_tron_token_approve.ts
│   ├── prepare_tron_revoke_approval.ts
│   ├── prepare_tron_stake_freeze.ts
│   ├── prepare_tron_stake_unfreeze.ts
│   ├── prepare_tron_withdraw_expire_unfreeze.ts
│   ├── prepare_tron_stake_vote.ts
│   └── prepare_tron_stake_claim_rewards.ts
test/
├── signing-fingerprint-tron-19.test.ts   # Fixtures Tron-19-{A,B,C,D}
└── lifecycle-tron-stake-19.integration.test.ts
```

### Pattern 1: approve encoder mirrors trc20 transfer encoder

```typescript
// src/protocols/tron-approve.ts — mirrors encodeTronTrc20Transfer from tron-trc20.ts
export async function encodeTronTrc20Approve(input: {
  tronWeb: TronWeb;
  from: string;          // base58check
  tokenAddress: string;  // base58check
  spender: string;       // base58check
  amount: bigint;        // 0n | bounded | U256_MAX
}): Promise<TronApproveEncodeResult> {
  const rawResult = await input.tronWeb.transactionBuilder.triggerSmartContract(
    input.tokenAddress,
    "approve(address,uint256)",       // selector = 0x095ea7b3
    { feeLimit: 100_000_000, callValue: 0 },
    [
      { type: "address", value: input.spender },
      { type: "uint256", value: input.amount.toString() },  // CRITICAL: .toString()
    ],
    input.from,
  );
  // ... verify, extendExpiration(tx, 900), extract fields
}
```
`// Source: mirrors tron-trc20.ts:107-116 + TransactionBuilder.d.ts`

### Pattern 2: freeze encoder with `Number()` conversion

```typescript
// src/protocols/tron-stake.ts
export async function encodeTronFreezeV2(input: {
  tronWeb: TronWeb;
  from: string;
  amountSun: bigint;    // already scaled to SUN by parseTronAmountStrict
  resource: "ENERGY" | "BANDWIDTH";
}): Promise<TronFreezeEncodeResult> {
  // CRITICAL: tronweb builder takes `number` not `bigint` for amount
  // Guard overflow before conversion
  if (input.amountSun > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`freeze amount ${input.amountSun} SUN exceeds safe integer range`);
  }
  const amountNum = Number(input.amountSun);

  const tx = await input.tronWeb.transactionBuilder.freezeBalanceV2(
    amountNum,
    input.resource,
    input.from,
  );
  // ... extendExpiration(tx, 900), extract rawDataHex ...
}
```
`// Source: TransactionBuilder.d.ts freezeBalanceV2 signature`

### Pattern 3: vote encoder with array-to-VoteInfo conversion

```typescript
// src/protocols/tron-vote.ts
export async function encodeTronVoteWitness(input: {
  tronWeb: TronWeb;
  from: string;
  votes: Array<{ srAddress: string; count: number }>;
}): Promise<TronVoteEncodeResult> {
  // Convert array to VoteInfo map — CRITICAL step
  const voteInfo: Record<string, number> = {};
  for (const v of input.votes) {
    voteInfo[v.srAddress] = v.count;
  }
  const tx = await input.tronWeb.transactionBuilder.vote(voteInfo, input.from);
  // ... extendExpiration(tx, 900), extract rawDataHex ...
}
```
`// Source: TransactionBuilder.d.ts VoteInfo type + vote() signature`

### Pattern 4: KNOWN_SPENDERS_TRON extension in contracts.ts

```typescript
// src/config/contracts.ts — new sub-table (append after KNOWN_SPENDERS_ETHEREUM)
export interface KnownSpenderTron {
  address: string;  // base58check (NOT 0x-prefixed EVM address)
  label: string;
  source: string;
}

export const KNOWN_SPENDERS_TRON: readonly KnownSpenderTron[] = [
  {
    address: "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax",
    label: "SunSwap V2 Router",
    source: "https://docs.sun.io/developers/swap/smart-router",
  },
  // LiFi TRON facet — [WARNING: address not confirmed at research time; MUST verify]
  {
    address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",  // [ASSUMED placeholder — replace]
    label: "USDT-TRC20",
    source: "https://tron.network",
  },
  // ... USDC, USDD, TUSD entries from tron-top-25.json
];

export function lookupSpenderTron(address: string): KnownSpenderTron | undefined {
  return KNOWN_SPENDERS_TRON.find(s => s.address === address);
}
```

**Note:** TRON addresses do NOT use EVM `getAddress()` checksumming. The lookup is exact string equality on base58check. `[VERIFIED: Phase 17/18 address handling convention]`

### Anti-Patterns to Avoid

- **Stake 1.0 builder:** Never call `transactionBuilder.freezeBalance(amount, duration, resource)` — that's Stake 1.0 with a `frozen_duration` field. Always use `transactionBuilder.freezeBalanceV2`.
- **Protobuf hand-rolling:** Never manually encode `FreezeBalanceV2Contract` Protobuf fields. tronweb's builder is the SOT.
- **`getAddress()` on TRON addresses:** `viem.getAddress()` is EVM-only (EIP-55 checksumming). TRON uses base58check. Never call `getAddress(tronBase58Address)`.
- **`bigint` directly to tronweb builder:** Always call `.toString()` for `type: "uint256"` parameters, and `Number(scaledBigint)` for the Stake 2.0 `amount` argument (with overflow guard).
- **Direct spy on named exports:** All new protocol modules MUST export `_<scope>` indirection objects per CLAUDE.md. Example: `export const _tronApprove = { encodeTronTrc20Approve, prepareTronApproveInternal }`.

---

## Package Legitimacy Audit

> No new npm packages are installed in Phase 19. All tooling is from Phase 17/18 (tronweb@6.3.0, @ledgerhq/hw-app-trx@6.36.1, @ledgerhq/hw-transport-node-hid) which were already audited. Phase 19 is consumers-only.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**New packages:** none

---

## Common Pitfalls (Expanded)

### Pitfall 1: Stake 1.0 vs Stake 2.0 contract type confusion

**What goes wrong:** Using `transactionBuilder.freezeBalance` (Stake 1.0) or manually encoding `FreezeBalanceContract`. The fingerprint anchor test (Fixture Tron-19-B) would PASS (it verifies the literal) but the TRON network would REJECT the transaction at broadcast.

**Why it happens:** Both builders are present in tronweb; Stake 1.0 was the original API and is heavily documented in older tutorials. "Freeze balance" Google searches surface Stake 1.0 content.

**How to avoid:** Use the `V2` suffixed methods only. Plan checker asserts `grep -r "freezeBalance\b" src/tools/prepare_tron_stake` returns empty (only `freezeBalanceV2` is acceptable).

**Warning signs:** `raw_data.contract[0].type === "FreezeBalanceContract"` in the encoded transaction.

### Pitfall 2: SR address format mismatch producing wrong fingerprint

**What goes wrong:** An SR address from some source comes in as 0x41-prefixed hex rather than base58check. The `VoteInfo` map key would be a hex string, and the Protobuf encoding would put a different byte sequence in `vote_address`. The fingerprint would be wrong.

**Why it happens:** `listSuperRepresentatives()` returns base58check but some internal tronweb decoded-param fields return 0x41-prefixed hex. If an SR address is read from `raw_data.contract[0].parameter.value.votes[i].vote_address` (decoded form), it comes back hex-encoded.

**How to avoid:** Validate all SR addresses with `tronweb.utils.address.isAddress(address)` before passing to `vote()`. Use `formatTronAddress(hex)` from Phase 17 if the hex form appears.

**Warning signs:** `vote_address` in the fingerprint test differs from the input base58check string.

### Pitfall 3: `WithdrawExpireUnfreezeContract` treated as having an `amount` parameter

**What goes wrong:** Writing `transactionBuilder.withdrawExpireUnfreeze(owner, amountSun)`. The second param is `options?: TransactionCommonOptions`. Passing a number silently populates `permissionId` or is ignored. The transaction goes to chain and withdraws ALL expired records (correct) or fails silently.

**Why it happens:** Pattern-matching from other contracts that take amount. The "withdraw" word suggests an amount.

**How to avoid:** Contract interface has ONLY `owner_address`. No amount. Test fixture asserts the raw_data encodes with zero extra fields.

**Warning signs:** TypeScript compile error if strict types are used (second arg type mismatch); the `.d.ts` unambiguously shows no amount param.

### Pitfall 4: `tronweb.trx.getReward` returns `number` not `bigint`

**What goes wrong:** Converting the reward to string via `BigInt(reward).toString()` causes no issue, but directly comparing to a threshold with bigint math could fail if the developer expects bigint semantics.

**Why it happens:** The API returns a plain JavaScript `number`. Large reward values could lose precision above `Number.MAX_SAFE_INTEGER` (~9×10¹⁵ SUN = 9 billion TRX — practically impossible for individual accounts).

**How to avoid:** Call `String(reward)` directly for the `estimatedRewardSun: string | null` field. No bigint conversion needed.

**Warning signs:** Reward estimate shows as `0e+15` or scientific notation in the response.

### Pitfall 5: `vi.setSystemTime` used to advance TRON blockchain time in simulation

**What goes wrong:** Assuming `vi.setSystemTime(t0 + 15 * 86400_000)` makes `triggerconstantcontract` return "now the balance is withdrawable." The simulated blockchain call happens against a mocked response — `Date.now()` on the server side is irrelevant to TronGrid's view of the blockchain state.

**Why it happens:** The integration test uses fake timers for the handle TTL + lifecycle story, creating the impression that advancing the clock affects all time-dependent behavior.

**How to avoid:** The lifecycle integration test MUST mock `_simulationTron.simulateTronTrigger` to return `revert` before the time advance and `ok` after. `vi.setSystemTime` is used only to model the user's experience (the TTL of handles, etc.) and to test the lifecycle story. The simulation mock is independent.

**Warning signs:** The lifecycle test passes only because the simulation mock is at the wrong granularity (returns `ok` unconditionally).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (project standard) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run test/signing-fingerprint-tron-19.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRON-PREP-05 | `prepare_tron_token_approve` produces `approve(spender,amount)` with correct selector | unit | `npx vitest run test/prepare-tron-token-approve.test.ts -x` | ❌ Wave 0 |
| TRON-PREP-05 | `amount: "max"` → MAX_UINT256 encoding | unit | same file | ❌ Wave 0 |
| TRON-PREP-05 | Byte-identity: approve({T,S,amount:"0"}) === revoke({T,S}) | unit | `npx vitest run test/prepare-tron-revoke-approval.test.ts -x` | ❌ Wave 0 |
| TRON-PREP-05 | Fixture Tron-19-A literal anchor | unit | `npx vitest run test/signing-fingerprint-tron-19.test.ts -x` | ❌ Wave 0 |
| TRON-W-03 | `prepare_tron_revoke_approval` produces `approve(spender,0)` | unit | `npx vitest run test/prepare-tron-revoke-approval.test.ts -x` | ❌ Wave 0 |
| TRON-W-04 | `prepare_tron_stake_freeze` builds `FreezeBalanceV2Contract` (NOT Stake 1.0) | unit | `npx vitest run test/prepare-tron-stake-freeze.test.ts -x` | ❌ Wave 0 |
| TRON-W-04 | Fixture Tron-19-B literal anchor | unit | `npx vitest run test/signing-fingerprint-tron-19.test.ts -x` | ❌ Wave 0 |
| TRON-W-05 | `prepare_tron_withdraw_expire_unfreeze` is zero-arg; simulation gate catches early withdrawal | unit | `npx vitest run test/prepare-tron-withdraw-expire-unfreeze.test.ts -x` | ❌ Wave 0 |
| TRON-W-06 | `prepare_tron_stake_vote` converts `votes[]` to VoteInfo map correctly | unit | `npx vitest run test/prepare-tron-stake-vote.test.ts -x` | ❌ Wave 0 |
| TRON-W-06 | Fixture Tron-19-C literal anchor | unit | `npx vitest run test/signing-fingerprint-tron-19.test.ts -x` | ❌ Wave 0 |
| TRON-W-07 | `prepare_tron_stake_claim_rewards` is zero-arg + advisory `estimatedRewardSun` | unit | `npx vitest run test/prepare-tron-stake-claim-rewards.test.ts -x` | ❌ Wave 0 |
| TRON-W-07 | Fixture Tron-19-D literal anchor | unit | `npx vitest run test/signing-fingerprint-tron-19.test.ts -x` | ❌ Wave 0 |
| TRON-W-08 | `KNOWN_SPENDERS_TRON` sub-table in contracts.ts | unit | `npx vitest run test/config-contracts.test.ts -x` | ✅ extends |
| D-10 | Lifecycle: freeze → unfreeze → 14d elapsed → withdraw | integration | `npx vitest run test/lifecycle-tron-stake-19.integration.test.ts -x` | ❌ Wave 0 |
| D-11 | FROZEN-area zero-diff | manual + git | `git diff origin/main -- src/signing/payload-fingerprint-tron.ts` | ✅ existing |

### Sampling Rate

- **Per task commit:** `npx vitest run test/signing-fingerprint-tron-19.test.ts test/prepare-tron-*.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `test/signing-fingerprint-tron-19.test.ts` — Fixtures Tron-19-{A,B,C,D} literal anchors (covers all 4 plans)
- [ ] `test/prepare-tron-token-approve.test.ts` — TRON-PREP-05 unit tests
- [ ] `test/prepare-tron-revoke-approval.test.ts` — TRON-W-03 + byte-identity T-TRON-REVOKE-DRIFT-1
- [ ] `test/prepare-tron-stake-freeze.test.ts` — TRON-W-04 (including Stake 1.0 anti-regression)
- [ ] `test/prepare-tron-stake-unfreeze.test.ts` — TRON-W-04 sibling
- [ ] `test/prepare-tron-withdraw-expire-unfreeze.test.ts` — TRON-W-05 (zero-arg + simulation gate)
- [ ] `test/prepare-tron-stake-vote.test.ts` — TRON-W-06 (array-to-VoteInfo conversion)
- [ ] `test/prepare-tron-stake-claim-rewards.test.ts` — TRON-W-07 (advisory reward estimate)
- [ ] `test/lifecycle-tron-stake-19.integration.test.ts` — D-10 multi-tx lifecycle

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a — TRON pairing via Phase 17/18 primitives |
| V3 Session Management | no | Handle TTL via Phase 18 handle-store.ts |
| V4 Access Control | no | Canonical-dispatch-tron allowlist (Phase 18) |
| V5 Input Validation | yes | `parseTronAmountStrict` + `tronweb.utils.address.isAddress` + strict `"max"` sentinel |
| V6 Cryptography | yes | `_tronFingerprint` (keccak256) + `_tronPresign` (SHA-256) — Phase 18 FROZEN primitives |

### Known Threat Patterns for TRON Stake 2.0 + approve

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent substitutes `approve(attacker, MAX_UINT256)` for `approve(safe-spender, bounded)` | Tampering | `payloadFingerprint` + PREPARE RECEIPT byte-binding; user reads PREPARE RECEIPT before signing |
| Agent calls `revoke_approval` but substitutes large amount in calldata | Tampering | `T-TRON-REVOKE-DRIFT-1` byte-identity test; shared `prepareTronApproveInternal` enforces by construction |
| Stake 1.0 contract used instead of Stake 2.0 (silent network rejection) | Tampering / Spoofing | Fixture Tron-19-B `raw_data.contract[0].type` assertion; plan-check grep for `freezeBalance\b` without `V2` |
| Unknown SR in votes (phishing SR) | Spoofing | SR registry hybrid loader labels unknowns `(unverified SR — confirm address)`; on-device `vote_address` is the final anchor |
| `estimatedRewardSun` used as a gate when reward is 0 | Repudiation | D-06c explicitly forbids any gate on reward estimate — advisory only |
| `WithdrawExpireUnfreezeContract` submitted with no withdrawable balance | Denial of Service (self) | Layer 0.7 simulation gate fires `SIMULATION_REFUSED` before Ledger sees the tx |
| TRON approve for non-allowlisted contract (`prepare_tron_token_approve` for exotic token) | Tampering | `canonical-dispatch-tron.ts` Layer 0.5 fires at preview; approve transactions go through the existing TRON dispatch check |

**SECURITY.md update scope (Plan 19-04):** Add TRON Phase 19 sub-section extending Phase 18's section with: (1) TRC-20 approve `⚠ UNLIMITED APPROVAL` surfacing + revoke path; (2) Stake 2.0 resource semantics (Energy vs Bandwidth); (3) 14-day waiting period and Layer 0.7 enforcement; (4) SR registry trust source surfacing; (5) Voting rewards advisory (no gate); (6) `LEDGER NOTICE (TRON)` emitted for ALL Phase 19 tools (none are in TRX app bundled clear-sign registry).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | LiFi TRON facet address is NOT confirmed — no authoritative source found | Topic 7, D-07a | Incorrect address in KNOWN_SPENDERS_TRON produces wrong spender label (not a safety failure — label is advisory, on-device address is the trust anchor) |
| A2 | SunSwap V2 Router is `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax` | Topic 7 | Wrong spender label for SunSwap approvals (advisory only, same residual risk as A1) |
| A3 | `transactionBuilder.freezeBalanceV2` `amount` param is `number` (not bigint) | Topic 2 | Silent precision loss for very large amounts; `Number()` conversion guard mitigates |
| A4 | `triggerconstantcontract` returns `REVERT` with reason "no withdrawable balance" when called for `WithdrawExpireUnfreezeContract` with no expired records | Topic 3 | Different revert reason may require updating the simulation-tron.ts classifier; does not affect the security model |
| A5 | `tronweb.trx.getReward(address)` returns the same value as `wallet/getrewardinfo` endpoint `reward` field | Topic 8 | Advisory estimate could be different units or format; null-demote fallback means this is degraded-only, not a failure |

**If this table is empty:** It is not empty — 5 assumptions logged above, all advisory-only risks.

---

## Open Questions (RESOLVED)

1. **LiFi TRON facet address**
   - What we know: LiFi Diamond is `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` on EVM; TRON is not EVM
   - What's unclear: Whether LiFi has a TRON deployment at all; if so, what address
   - Recommendation: Planner should add a `checkpoint:human-verify` task in Plan 19-01 before the LiFi address is committed to `contracts.ts`. If no TRON deployment is found, omit the LiFi entry from `KNOWN_SPENDERS_TRON` for Phase 19 and add it in Phase 20 (when LiFi TRON bridging ships). CONTEXT D-07a says "LiFi TRON facet (verified address from LiFi's deployment manifest at planning time)" — this must be done.
   - **RESOLVED:** LiFi TRON facet deferred to Phase 20 per `checkpoint:decision` Task 0 in Plan 19-01. `KNOWN_SPENDERS_TRON` ships 5 entries in Phase 19 (SunSwap V2 router + 4 stablecoins). LiFi entry returns when Phase 20 ships LiFi TRON bridging.

2. **`tron-srs.json` initial snapshot size and curation discipline**
   - What we know: `tron-top-25.json` has 25 entries; TRON has ~27 elected Super Representatives + ~100+ candidates
   - What's unclear: Whether to snapshot all 27 SRs or top N; how to determine "name" field for each
   - Recommendation: Snapshot the current top ~30 by voteCount from a live `listSuperRepresentatives()` call at plan-write time. Include `address`, `name` (from `url` parsing or known aliases), `url`, and `rank`. Name can be derived heuristically from the `url` field (e.g. `"binance.com"` → `"Binance Staking"`).
   - **RESOLVED:** Top ~30 by voteCount snapshot per Plan 19-03 Task 1. Fields: `address` (base58), `name` (heuristic from `url`), `rank`, `url`, `voteCount`. Hybrid fallback at runtime: live `listSuperRepresentatives()` primary, snapshot secondary; `srSource` always surfaced.

3. **`TronInstructionSummary` union extension for stake/approve/vote kinds**
   - What we know: Phase 18 defined `TronInstructionSummary` in `handle-store.ts` with `"native-transfer"` and `"trc20-transfer"` kinds
   - What's unclear: The exact new kinds and field shapes for approve/stake/vote/claim
   - Recommendation: Add 7 new kinds to `TronInstructionSummary`: `"trc20-approve"`, `"trc20-revoke"`, `"stake-freeze-v2"`, `"stake-unfreeze-v2"`, `"stake-withdraw-expire"`, `"stake-vote"`, `"stake-claim-rewards"`. This follows the `SolanaInstructionSummary` precedent of one kind per operation. The planner can define the exact field shapes at implementation time per Claude's Discretion.
   - **RESOLVED:** 7 new `TronInstructionSummary` kinds adopted per CONTEXT D-11a amendment + Plan 19-01 Task 1 (`"trc20-approve"`, `"trc20-revoke"`), Plan 19-02 Task 1 (`"stake-freeze-v2"`, `"stake-unfreeze-v2"`, `"stake-withdraw-expire"`), Plan 19-03 Task 1 (`"stake-vote"`, `"stake-claim-rewards"`). Field shapes defined at implementation time per Claude's Discretion.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| tronweb | All 7 prepare tools | ✓ | 6.3.0 (locked) | — |
| `transactionBuilder.freezeBalanceV2` | TRON-W-04 | ✓ | confirmed in `.d.ts` | — |
| `transactionBuilder.vote` | TRON-W-06 | ✓ | confirmed in `.d.ts` | — |
| `transactionBuilder.withdrawBlockRewards` | TRON-W-07 | ✓ | confirmed in `.d.ts` | — |
| `transactionBuilder.withdrawExpireUnfreeze` | TRON-W-05 | ✓ | confirmed in `.d.ts` | — |
| `tronWeb.trx.listSuperRepresentatives()` | D-05 SR registry | ✓ | confirmed in `trx.d.ts` | `src/tokens/tron-srs.json` snapshot |
| `tronWeb.trx.getReward(address)` | D-06 reward estimate | ✓ | confirmed in `trx.d.ts` | `null` (demote-to-null) |
| vitest | All tests | ✓ | project standard | — |

**Missing dependencies with no fallback:** none

**Missing dependencies with fallback:**
- `tronWeb.trx.listSuperRepresentatives()` has `tron-srs.json` snapshot fallback (D-05b)
- `tronWeb.trx.getReward(address)` demotes to `null` on failure (D-06b)

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| TRON Stake 1.0 (`FreezeBalanceContract` with `frozen_duration`) | Stake 2.0 (`FreezeBalanceV2Contract` — no duration, indefinite) | java-tron v4.6.0 (~2022) | Phase 19 must use Stake 2.0 ONLY; Stake 1.0 deprecated by network |
| `tronweb.trx.freezeBalance()` (Stake 1.0 convenience method) | `tronweb.transactionBuilder.freezeBalanceV2()` (Stake 2.0) | tronweb 6.x | Use `transactionBuilder.*` for unsigned tx; `trx.*` convenience methods broadcast directly |

**Deprecated/outdated:**
- `FreezeBalanceContract` (Stake 1.0): rejected at broadcast by TRON network as of java-tron 4.6.0+; tronweb still exposes the builder for backward compatibility but actual broadcast fails
- `tronweb.trx.freezeBalance()` + `tronweb.trx.unfreezeBalance()`: these are the Stake 1.0 broadcast-direct methods (auto-sign + submit); Phase 19 uses `transactionBuilder.*` for unsigned-only output (Ledger signing)

---

## Sources

### Primary (HIGH confidence)
- Installed `node_modules/tronweb/lib/esm/lib/TransactionBuilder/TransactionBuilder.d.ts` — `freezeBalanceV2`, `unfreezeBalanceV2`, `withdrawExpireUnfreeze`, `withdrawBlockRewards`, `vote` exact signatures `[VERIFIED: installed .d.ts]`
- Installed `node_modules/tronweb/lib/esm/types/Contract.d.ts` — `FreezeBalanceV2Contract`, `UnfreezeBalanceV2Contract`, `WithdrawExpireUnfreezeContract`, `WithdrawBalanceContract`, `VoteWitnessContract` interface shapes `[VERIFIED: installed .d.ts]`
- Installed `node_modules/tronweb/lib/esm/lib/trx.d.ts` — `listSuperRepresentatives() → Promise<Witness[]>`, `getReward(address) → Promise<number>` `[VERIFIED: installed .d.ts]`
- Installed `node_modules/tronweb/lib/esm/types/Trx.d.ts` — `FreezeV2`, `UnFreezeV2`, `Vote`, `BaseWitness`, `Witness` interface shapes `[VERIFIED: installed .d.ts]`
- `src/protocols/tron-trc20.ts` — `amount.toString()` discipline for uint256 encoding, Phase 18 extendExpiration pattern `[VERIFIED: direct code inspection]`
- `src/tools/prepare_token_approve.ts` + `src/tools/prepare_revoke_approval.ts` — `prepareApproveInternal` shared-helper pattern, MAX_UINT256 sentinel handling `[VERIFIED: direct code inspection]`
- Phase 18 RESEARCH.md §Topic 5 — `extendExpiration(tx, 900)` load-bearing finding `[CITED: project research file]`
- Phase 18 RESEARCH.md §Topic 8 — TRC-20 ABI-identical to ERC-20, selector `0xa9059cbb` for transfer, `0x095ea7b3` for approve `[CITED: project research file]`

### Secondary (MEDIUM confidence)
- TronGrid `wallet/listwitnesses` — confirmed via `listSuperRepresentatives()` tronweb wrapper shape
- [TRON Stake 2.0 documentation](https://tronprotocol.github.io/documentation-en/mechanism-algorithm/stake2.0/) — ENERGY/BANDWIDTH resource semantics, 14-day waiting period, TRON Power = 1 vote per 1 TRX frozen
- [TIP-491](https://github.com/tronprotocol/tips/blob/master/tip-491.md) — Stake 2.0 spec (deferred verification; SDK types are the authoritative source)

### Tertiary (LOW confidence — marked [ASSUMED] inline)
- SunSwap V2 router `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax` — from WebSearch; requires final verification at plan-write time against https://docs.sun.io
- LiFi TRON facet address — NOT confirmed; `[WARNING: must be verified before commit]`

---

## Metadata

**Confidence breakdown:**
- Standard stack (tronweb 6.3.0 API): HIGH — all key methods verified against installed `.d.ts`
- Architecture: HIGH — directly mirrors Phase 18 patterns with confirmed SDK support
- Pitfalls: HIGH — derived from code inspection, type analysis, and Phase 18 lessons
- SR registry: MEDIUM — tronweb API confirmed; snapshot structure is `[ASSUMED]`
- LiFi TRON address: LOW — not found in official sources

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (30 days — tronweb 6.3.0 is locked by Phase 17; API is stable)
