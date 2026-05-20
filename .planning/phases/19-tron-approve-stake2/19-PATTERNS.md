# Phase 19: TRON Approve + Stake 2.0 — Pattern Map

**Mapped:** 2026-05-20
**Files analyzed:** 15 new/modified files (7 tools + 3 protocols + 1 token JSON + 1 blocks-tron extension + 1 contracts extension + 1 register-all extension + 11 test files)
**Analogs found:** 13 / 15 (2 files have no close analog — see § No Analog Found)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/tools/prepare_tron_token_approve.ts` | tool | request-response | `src/tools/prepare_token_approve.ts` + `src/tools/prepare_tron_trc20_send.ts` | exact (two-analog composite) |
| `src/tools/prepare_tron_revoke_approval.ts` | tool | request-response | `src/tools/prepare_revoke_approval.ts` | exact |
| `src/tools/prepare_tron_stake_freeze.ts` | tool | request-response | `src/tools/prepare_tron_native_send.ts` | role-match |
| `src/tools/prepare_tron_stake_unfreeze.ts` | tool | request-response | `src/tools/prepare_tron_native_send.ts` | role-match |
| `src/tools/prepare_tron_withdraw_expire_unfreeze.ts` | tool | request-response | `src/tools/prepare_tron_native_send.ts` | role-match |
| `src/tools/prepare_tron_stake_vote.ts` | tool | request-response | `src/tools/prepare_tron_trc20_send.ts` | role-match |
| `src/tools/prepare_tron_stake_claim_rewards.ts` | tool | request-response | `src/tools/prepare_tron_native_send.ts` | role-match |
| `src/protocols/tron-approve.ts` | protocol | transform | `src/protocols/erc20.ts` + `src/protocols/tron-trc20.ts` | exact (two-analog composite) |
| `src/protocols/tron-stake.ts` | protocol | transform | `src/protocols/tron-native.ts` | partial-match |
| `src/protocols/tron-vote.ts` | protocol | transform | `src/protocols/tron-trc20.ts` | partial-match |
| `src/tokens/tron-srs.json` | config/data | — | `src/tokens/tron-top-25.json` | exact |
| `src/signing/blocks-tron.ts` (extension) | config | — | existing `src/signing/blocks-tron.ts` (append-only) | exact |
| `src/config/contracts.ts` (extension) | config | — | existing `KNOWN_SPENDERS_ETHEREUM` + `COMPOUND_COMETS_RAW` sub-table | exact |
| `src/tools/register-all.ts` (extension) | config | — | existing TRON import cluster (lines 32–33) | exact |
| Test files (11) | test | — | `test/signing-fingerprint-tron.test.ts` + `test/prepare-tron-trc20-send.test.ts` + `test/trust-pipeline-tron.integration.test.ts` | exact |

---

## Pattern Assignments

### `src/tools/prepare_tron_token_approve.ts` (tool, request-response)

**Primary analog:** `src/tools/prepare_token_approve.ts`
**Secondary analog (TRON call pattern):** `src/tools/prepare_tron_trc20_send.ts`

The tool is a composite of the EVM approve shape (input schema, `"max"` sentinel, `prepareApproveInternal` delegation) rewritten onto the TRON encode path (tronweb `triggerSmartContract`, base58check validation, `_tronRegistry.getTronWeb()`, `_tronFingerprint`).

**Imports pattern** (`prepare_tron_trc20_send.ts` lines 65–89, adapt for approve):
```typescript
import { utils as tronUtils } from "tronweb";

import { _tronRegistry } from "../chains/tron/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActiveTronPersona } from "../demo/state.js";
import { InvalidAmountError, parseTronAmountStrict } from "../signing/amount-tron.js";
import { PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE } from "../signing/blocks-tron.js"; // new template
import { type ErrorCode, type StructuredError, makeStructuredError } from "../signing/error-codes.js";
import { type PrepareArgs, type PreparedTxTron, createHandle } from "../signing/handle-store.js";
import { _tronFingerprint } from "../signing/payload-fingerprint-tron.js";
import { _tronApprove } from "../protocols/tron-approve.js"; // new protocol module
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";
```

**`"max"` sentinel pattern** (`prepare_token_approve.ts` lines 291–336):
```typescript
// T-MAX-SPELLING-1: strict equality on the lowercase "max" sentinel.
// ANY other case ("MAX", "unlimited", "infinite") flows through
// parseTronAmountStrict and hits INVALID_INPUT.
let amountWei: bigint;
if (rawAmount === "max") {
  amountWei = MAX_UINT256_TRON; // same 2^256-1 constant, named for TRON module
} else {
  // Resolve decimals via findByAddress (tron-top-25 registry), then:
  parsedAmount = parseTronAmountStrict(rawAmount, metadata.decimals, "u256");
}
```

**Demo/real-mode guard pattern** (`prepare_tron_trc20_send.ts` lines 250–312 — copy exactly):
```typescript
const demoActive = isDemoMode();
const tronPersona = getActiveTronPersona();

let fromAddress: string;
if (demoActive) {
  if (!tronPersona) {
    return { isError: true, content: [...], structuredContent: errEnvelope("WRONG_MODE", ...) };
  }
  fromAddress = tronPersona.tronAddress;
} else {
  const accounts = listAccounts({ chainFilter: "tron" });
  if (accounts.length === 0) {
    return { isError: true, content: [...], structuredContent: errEnvelope("WALLET_NOT_PAIRED", ...) };
  }
  const account = accounts[0];
  if (!account) { /* unreachable defense */ }
  fromAddress = account.address;
}
```

**TronWeb + encode + fingerprint pattern** (`prepare_tron_trc20_send.ts` lines 314–360):
```typescript
const tronWeb = _tronRegistry.getTronWeb();

let encoded;
try {
  encoded = await _tronApprove.encodeTronTrc20Approve({
    tronWeb,
    from: fromAddress,
    tokenAddress: rawTokenAddress,
    spender: rawSpender,
    amount: parsedAmount,
  });
} catch (err) {
  const cause = err instanceof Error ? err.message : String(err);
  return { isError: true, ..., structuredContent: errEnvelope("INTERNAL_ERROR", ..., cause) };
}

const payloadFingerprint = _tronFingerprint.computeTronPayloadFingerprint(
  { rawDataBytes: encoded.rawDataBytes },
);
```

**PreparedTxTron shape** (`prepare_tron_trc20_send.ts` lines 363–381):
```typescript
const tx: PreparedTxTron = {
  txType: "tron",
  chainId: 0,
  to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  valueWei: 0n,
  data: "0x" as `0x${string}`,
  rawDataHex: encoded.rawDataHex,
  rawDataObject: encoded.rawDataObject,
  refBlockBytes: encoded.refBlockBytes,
  refBlockHash: encoded.refBlockHash,
  expiration: encoded.expiration,
  kind: "trc20",                    // approve is TriggerSmartContract = trc20 kind
  contractAddress: rawTokenAddress,
  instructionSummary: encoded.instructionSummary,
};
```

**Shared-helper delegation:** This tool also exports `prepareTronApproveInternal` (mirrors `prepareApproveInternal` from `prepare_token_approve.ts` lines 156–246). The internal helper accepts pre-parsed `amountWei: bigint` so both `prepare_tron_token_approve` and `prepare_tron_revoke_approval` call it with identical parameters. Byte-identity by construction.

**ESM spy-affordance name:** `_tronApprove` (in `src/protocols/tron-approve.ts`)

---

### `src/tools/prepare_tron_revoke_approval.ts` (tool, request-response)

**Analog:** `src/tools/prepare_revoke_approval.ts`

**Pattern** (`prepare_revoke_approval.ts` lines 78–135 — mirror exactly):
```typescript
import { registerTool } from "./index.js";
import { prepareTronApproveInternal } from "./prepare_tron_token_approve.js"; // TRON sibling import

registerTool("prepare_tron_revoke_approval", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // Validate tokenAddress + spender shapes (tronUtils.address.isAddress, NOT /^0x.../)
    // ...
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    return await prepareTronApproveInternal({
      rawTokenAddress,
      rawSpender,
      rawAmount: "0",
      amountWei: 0n,
      rawFrom,
    });
  } catch (err) { /* INTERNAL_ERROR envelope */ }
});
```

**Byte-identity invariant** (`test/prepare-revoke-approval.test.ts` lines 186–234 — T-TRON-REVOKE-DRIFT-1 mirrors T-REVOKE-DRIFT-1):
- Call `prepare_tron_revoke_approval({T, S})` and `prepare_tron_token_approve({T, S, amount: "0"})`
- Assert `payloadFingerprint` equality + `rawDataHex` equality at byte level
- This is the LOAD-BEARING invariant — do not skip

**No `"max"` sentinel:** revoke schema has no `amount` field (identical to `prepare_revoke_approval.ts` INPUT_SCHEMA which omits `amount`).

---

### `src/tools/prepare_tron_stake_freeze.ts` (tool, request-response)

**Analog:** `src/tools/prepare_tron_native_send.ts`

The structure mirrors `prepare_tron_native_send.ts` step-by-step (input validation → demo/real mode → getTronWeb → encode → fingerprint → handle → receipt → response). The only difference is the encoder calls `_tronStake.encodeFreezeBalanceV2(...)` and the PreparedTxTron shape uses `kind: "stake-freeze"` (new discriminant to extend the `kind` union in `handle-store.ts`).

**Imports pattern** (`prepare_tron_native_send.ts` lines 51–76, adapted):
```typescript
import { utils as tronUtils } from "tronweb";
import { _tronRegistry } from "../chains/tron/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActiveTronPersona } from "../demo/state.js";
import { InvalidAmountError, parseTronAmountStrict } from "../signing/amount-tron.js";
import { PREPARE_RECEIPT_TRON_STAKE_FREEZE_TEMPLATE } from "../signing/blocks-tron.js"; // new template
import { type ErrorCode, type StructuredError, makeStructuredError } from "../signing/error-codes.js";
import { type PrepareArgs, type PreparedTxTron, createHandle } from "../signing/handle-store.js";
import { _tronFingerprint } from "../signing/payload-fingerprint-tron.js";
import { _tronStake } from "../protocols/tron-stake.js"; // new protocol module
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";
```

**Resource enum validation:**
```typescript
const rawResource = typeof args.resource === "string" ? args.resource : "";
if (rawResource !== "ENERGY" && rawResource !== "BANDWIDTH") {
  return { isError: true, ..., structuredContent: errEnvelope("INVALID_INPUT",
    `invalid 'resource': expected "ENERGY" or "BANDWIDTH", got "${rawResource}"`
  )};
}
```

**`sun` parse:** use `parseTronAmountStrict(rawSun, 0, "u64")` — same as `prepare_tron_native_send.ts` lines 166–187.

**PreparedTxTron kind:** New discriminant value `"stake-freeze"` added to `PreparedTxTron.kind` union in `handle-store.ts`. This is the only handle-store change Phase 19 makes — extend the `kind` literal union to include `"stake-freeze" | "stake-unfreeze" | "stake-withdraw-expire" | "stake-vote" | "stake-claim"`.

---

### `src/tools/prepare_tron_stake_unfreeze.ts` (tool, request-response)

**Analog:** `src/tools/prepare_tron_native_send.ts`

Identical structure to `prepare_tron_stake_freeze.ts`. Same resource enum validation. Calls `_tronStake.encodeUnfreezeBalanceV2(...)`. Kind: `"stake-unfreeze"`.

**14-day waiting period surfacing** (from CONTEXT D-04a) — add to CHECKS PERFORMED block:
```typescript
// In the PREPARE RECEIPT / response text:
"Unfreeze becomes withdrawable after 14 days; this tx initiates the waiting period."
```
This is an informational string, NOT an enforcement gate. Copy the TRON simulation note pattern from `blocks-tron.ts` for the template format.

---

### `src/tools/prepare_tron_withdraw_expire_unfreeze.ts` (tool, request-response)

**Analog:** `src/tools/prepare_tron_native_send.ts`

This is the simplest of the five stake tools — NO input args (the protocol contract auto-withdraws all expired unfreeze records). Schema:
```typescript
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  required: [],
  additionalProperties: false,
};
```

No amount parsing, no resource enum. The only non-trivial step is the encode call: `_tronStake.encodeWithdrawExpireUnfreeze({ tronWeb, from: fromAddress })`. Kind: `"stake-withdraw-expire"`.

The simulation gate (Layer 0.7 via `triggerConstantcontract`) catches "no withdrawable balance" at preview time (per CONTEXT D-04b) — no server-side pre-check here.

---

### `src/tools/prepare_tron_stake_vote.ts` (tool, request-response)

**Primary analog:** `src/tools/prepare_tron_trc20_send.ts` (for TronWeb call pattern + ESM spy seam)
**Secondary analog (SR registry loader):** `src/tokens/tron-top-25.ts` (same `findByAddress` + fallback pattern)

This tool is more complex: it takes `srAddress` + `votes` (integer), validates the SR via the hybrid registry (live `tronWeb.trx.listSuperRepresentatives()` with snapshot fallback), then calls `_tronVote.buildVoteWitnessContract(...)`.

**SR validation pattern** (no existing analog — new; mirrors `findByAddress` lookup discipline):
```typescript
// Primary: live fetch
let srList: SrRegistryEntry[];
let srSource: "live" | "snapshot-fallback";
try {
  srList = await _tronVote.fetchLiveSrList(tronWeb);
  srSource = "live";
} catch {
  srList = _tronVote.getSnapshotSrList(); // bundled tron-srs.json
  srSource = "snapshot-fallback";
}
const knownSr = srList.find(sr => sr.srAddress === rawSrAddress);
const srLabel = knownSr
  ? `(SR: ${knownSr.name} — vote rank ${knownSr.rank})`
  : "(unverified SR — confirm address)";
```

**CHECKS PERFORMED surfacing** (srSource per CONTEXT D-05b — mirrors `rpcDegraded` pattern):
Include `srSource: "live" | "snapshot-fallback"` in the CHECKS PERFORMED block text.

**Kind:** `"stake-vote"`

---

### `src/tools/prepare_tron_stake_claim_rewards.ts` (tool, request-response)

**Analog:** `src/tools/prepare_tron_native_send.ts`

Zero-arg tool (mirrors `prepare_tron_withdraw_expire_unfreeze.ts` for the schema shape). Calls `_tronVote.buildWithdrawBalanceContract({ tronWeb, from: fromAddress })`. Kind: `"stake-claim"`.

**Advisory estimate pattern** (CONTEXT D-06b — new, no existing analog):
```typescript
// Best-effort getRewardInfo fetch
let estimatedRewardSun: string | null = null;
try {
  const rewardInfo = await tronWeb.trx.getRewardInfo(fromAddress);
  estimatedRewardSun = String(rewardInfo.reward ?? 0);
  checksPerformedExtra = `estimated reward at prepare time: ${estimatedRewardSun} SUN; final amount computed at broadcast`;
} catch {
  checksPerformedExtra = "estimate unavailable (RPC failure)";
}
```
Structured response includes `estimatedRewardSun: string | null` field.
**NO intent-vs-reality gate** (deliberate departure from Phase 28 Compound repay — per CONTEXT D-06c).

---

### `src/protocols/tron-approve.ts` (protocol, transform)

**Primary analog:** `src/protocols/erc20.ts` (selector table + encode/decode shape)
**Secondary analog:** `src/protocols/tron-trc20.ts` (TriggerSmartContract envelope + `_tronXxx` ESM spy pattern)

**Structure** (mirrors `tron-trc20.ts` exactly — 340 LOC target):
1. `TronApproveEncodeResult` interface — same fields as `TronTrc20EncodeResult` (`tron-trc20.ts` lines 42–61)
2. `encodeTronTrc20Approve()` — calls `triggerSmartContract` with `"approve(address,uint256)"` selector + two args `[{ type: "address", value: spender }, { type: "uint256", value: amount.toString() }]`
3. `TronApproveDecoded` discriminated-union type — `{ kind: "approve"; from; tokenAddress; spender; amount; isUnlimited }` | `{ kind: "unknown" }`
4. `decodeTronTrc20ApproveCall()` — reads selector at `data[0..8]` → `"095ea7b3"` (same 4-byte selector as `ERC20_SELECTORS.approve` in `erc20.ts`)
5. `_tronApprove` ESM spy-affordance object (mirrors `_tronTrc20` at `tron-trc20.ts` line 336)

**Selector constant** (mirrors `ERC20_SELECTORS` from `erc20.ts` lines 44–47):
```typescript
export const TRON_APPROVE_SELECTOR = "095ea7b3"; // no 0x prefix — tronweb convention
// ERC-20 approve(address,uint256) selector — ABI-identical to EVM
```

**`isUnlimited` flag** (mirrors `decodeErc20Call` from `erc20.ts` line 158):
```typescript
isUnlimited: amount === MAX_UINT256_TRON, // strict-equality, same sentinel as EVM side
```

**`feeLimit`:** Same `100_000_000` cap as `tron-trc20.ts` line 78. Approve ≈ 30k energy — same order as transfer.

**ESM spy-affordance pattern** (`tron-trc20.ts` lines 327–339):
```typescript
export const _tronApprove = {
  encodeTronTrc20Approve,
  decodeTronTrc20ApproveCall,
};
```

---

### `src/protocols/tron-stake.ts` (protocol, transform)

**Closest analog:** `src/protocols/tron-native.ts` (Protobuf-via-tronweb encoder shape)

**No exact analog.** Stake 2.0 contracts (`FreezeBalanceV2Contract`, `UnfreezeBalanceV2Contract`, `WithdrawExpireUnfreezeContract`) are Protobuf-native — they do NOT go through `triggerSmartContract` (that's TRC-20's path). They go through tronweb's `transactionBuilder.freezeBalanceV2()` / `unfreezeBalanceV2()` / `withdrawExpireUnfreeze()` — the same builder pattern as `transactionBuilder.sendTrx()` in `tron-native.ts`.

**Structure** (mirrors `tron-native.ts` — ~300 LOC target):
1. `TronFreezeEncodeResult` / `TronUnfreezeEncodeResult` / `TronWithdrawExpireEncodeResult` interfaces — same fields as `TronNativeEncodeResult` (`tron-native.ts` lines 52–69)
2. `encodeFreezeBalanceV2({ tronWeb, from, sun, resource })` — calls `transactionBuilder.freezeBalanceV2(Number(sun), resource, from)` + `extendExpiration(tx, 900)` — mirrors Steps 1–4 of `encodeTronTransfer` (`tron-native.ts` lines 89–149)
3. `encodeUnfreezeBalanceV2({ tronWeb, from, sun, resource })` — same pattern with `unfreezeBalanceV2`
4. `encodeWithdrawExpireUnfreeze({ tronWeb, from })` — no amount arg; calls `withdrawExpireUnfreeze(from)`
5. `_tronStake` ESM spy-affordance object

**SURPRISE: `sun` overflow guard** applies to freeze/unfreeze (same `> Number.MAX_SAFE_INTEGER` check as `tron-native.ts` lines 101–105) because `freezeBalanceV2` takes `number`, not `bigint`.

**SURPRISE: `resource` Protobuf enum** — tronweb's `freezeBalanceV2` accepts `"ENERGY"` or `"BANDWIDTH"` string (maps to Protobuf `ResourceCode` enum). Verify against installed tronweb `.d.ts` at execute time.

**`kind` discriminant for handle-store.ts** — extend `PreparedTxTron.kind` union:
```typescript
// Current in handle-store.ts line 318:
kind: "native" | "trc20";
// Phase 19 extends to:
kind: "native" | "trc20" | "stake-freeze" | "stake-unfreeze" | "stake-withdraw-expire" | "stake-vote" | "stake-claim";
```
This is a NON-FROZEN additive change to `handle-store.ts`. See FROZEN-area section below.

---

### `src/protocols/tron-vote.ts` (protocol, transform)

**Closest analog:** `src/protocols/tron-trc20.ts` for the encode pattern; `src/tokens/tron-top-25.ts` for the registry-loader discipline.

**No exact analog.** `VoteWitnessContract` is Protobuf-native (not TriggerSmartContract). tronweb exposes `transactionBuilder.vote(votes, voterAddress)` where `votes` is a `{ [srAddress]: number }` map.

**Structure** (~250 LOC target):
1. `SrRegistryEntry` interface — `{ srAddress: string; name: string; rank: number }`
2. `fetchLiveSrList(tronWeb)` — calls `tronWeb.trx.listSuperRepresentatives()`, maps to `SrRegistryEntry[]`
3. `getSnapshotSrList()` — imports `tron-srs.json` and returns the cached validated list
4. `buildVoteWitnessContract({ tronWeb, from, srAddress, votes })` — calls `transactionBuilder.vote({ [srAddress]: votes }, from)` + `extendExpiration(tx, 900)`
5. `buildWithdrawBalanceContract({ tronWeb, from })` — calls `transactionBuilder.withdrawBlockRewards(from)` (the `WithdrawBalanceContract` method)
6. `_tronVote` ESM spy-affordance object

**SURPRISE: `listSuperRepresentatives()` response shape** — must verify at execute time. The tronweb API returns `{ witnesses: Array<{ address, url, voteCount, ... }> }`. The `address` field is 0x41-prefixed hex; apply `formatTronAddress()` to convert to base58check before storing in the registry.

---

### `src/tokens/tron-srs.json` (config/data)

**Analog:** `src/tokens/tron-top-25.json`

**Schema** (mirrors `tron-top-25.json` entry shape — adapt field names):
```json
[
  {
    "srAddress": "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH",
    "name": "Binance Staking",
    "rank": 1,
    "url": "https://www.binance.com",
    "voteCount": 4000000000
  },
  ...
]
```

Fields: `srAddress` (base58check), `name` (string), `rank` (integer 1–N), `url` (string), `voteCount` (number). DOA validation at module load (mirrors `tron-top-25.ts` `validateEntry` pattern — `tronUtils.address.isAddress(sr.srAddress)`).

The snapshot is consumed by `tron-vote.ts`'s `getSnapshotSrList()`. File lives in `src/tokens/` alongside `tron-top-25.json` per CLAUDE.md SOT discipline.

---

### `src/signing/blocks-tron.ts` (extension — APPEND-ONLY)

**Analog:** The 7 existing templates in `src/signing/blocks-tron.ts` (lines 51–264)

**Pattern:** The file begins with a header comment listing all templates. Phase 19 APPENDS 3 new templates after the last existing template (`VERIFY_BEFORE_SIGNING_TRON_TEMPLATE` at line 240). NEVER modify or reorder existing templates.

**New templates to append** (mirrors exact array-join style of existing templates):

```typescript
// Append after VERIFY_BEFORE_SIGNING_TRON_TEMPLATE (line ~264)

export const PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE: string = [
  "PREPARE RECEIPT (TRON — TRC-20 approve)",
  "  chain:          TRON mainnet",
  "  tokenAddress:   {TOKEN_ADDRESS}",
  "  spender:        {SPENDER}",
  "  amount:         {AMOUNT}",
  "  refBlockBytes:  {REF_BLOCK_BYTES}",
  "  refBlockHash:   {REF_BLOCK_HASH}",
  "  expiration:     {EXPIRATION}",
].join("\n");

export const PREPARE_RECEIPT_TRON_STAKE_TEMPLATE: string = [
  "PREPARE RECEIPT (TRON — Stake 2.0 {OPERATION})",
  "  chain:          TRON mainnet",
  "  operation:      {OPERATION}",
  "  resource:       {RESOURCE}",
  "  sun:            {SUN}",
  "  refBlockBytes:  {REF_BLOCK_BYTES}",
  "  refBlockHash:   {REF_BLOCK_HASH}",
  "  expiration:     {EXPIRATION}",
].join("\n");

export const PREPARE_RECEIPT_TRON_CLAIM_TEMPLATE: string = [
  "PREPARE RECEIPT (TRON — Stake 2.0 claim rewards)",
  "  chain:          TRON mainnet",
  "  operation:      WithdrawBalanceContract (claim all voting rewards)",
  "  estimatedRewardSun: {ESTIMATED_REWARD_SUN}",
  "  refBlockBytes:  {REF_BLOCK_BYTES}",
  "  refBlockHash:   {REF_BLOCK_HASH}",
  "  expiration:     {EXPIRATION}",
].join("\n");
```

**Header comment update:** Add the 3 new template names to the existing block taxonomy comment at the top of the file (lines 1–35) under an append line: `//   - PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE   — Plan 19-01 (TRC-20 approve/revoke)` etc.

---

### `src/config/contracts.ts` (extension — KNOWN_SPENDERS_TRON sub-table)

**Analog:** `COMPOUND_COMETS_RAW` sub-table pattern (contracts.ts lines 222–296) and `KNOWN_SPENDERS_ETHEREUM` shape (lines 325–418).

**Pattern** (sibling sub-table, NOT widening `ContractsForChain` — mirrors the Compound V3 precedent comment at lines 224–229):
```typescript
// ---------------------------------------------------------------------------
// TRON known-spender table — Phase 19 Plan 19-01 (PREP-30 TRON surface).
// ---------------------------------------------------------------------------
//
// Sibling sub-table (NOT a widening of ContractsForChain) per Compound V3
// precedent. TRON addresses are base58check (T-prefixed, 34 chars); they
// are NOT checksummed via getAddress() — use isAddress validation instead.
// SOT for canonical TRON spender addresses.

export interface KnownSpenderTron {
  address: string; // base58check T-prefixed (NOT Address — no viem checksum)
  label: string;
  source: string;
}

export const KNOWN_SPENDERS_TRON: readonly KnownSpenderTron[] = [
  {
    address: "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax",
    label: "SunSwap V2 Router",
    source: "https://sun.io/v2 — verified at research time",
  },
  // LiFi TRON facet (address verified from LiFi deployment manifest at research time)
  {
    address: "VERIFY_AT_RESEARCH_TIME",
    label: "Li.Fi Diamond (TRON)",
    source: "https://github.com/lifinance/contracts (deployment manifest)",
  },
  // Canonical TRC-20 stablecoins (token contracts — avoid (unknown spender) label)
  {
    address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    label: "USDT-TRC20 (Tether)",
    source: "https://tronscan.org/#/token20/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  },
  // ... USDC, USDD, TUSD entries following same shape
];

export function lookupTronSpender(spender: string): KnownSpenderTron | undefined {
  return KNOWN_SPENDERS_TRON.find((s) => s.address === spender);
}

export const _contractsTron = { lookupTronSpender };
```

**Key deviation from EVM pattern:** No `getAddress()` wrapping — TRON addresses are base58check, not EIP-55. The DOA snapshot guard uses `tronUtils.address.isAddress()` at module load instead.

---

### `src/tools/register-all.ts` (extension)

**Analog:** Existing TRON import cluster at `register-all.ts` lines 32–33.

**Pattern:** Feature-grouped cluster discipline. Insert 7 lines IMMEDIATELY AFTER the `prepare_tron_trc20_send.js` import (line 33):
```typescript
import "./prepare_tron_trc20_send.js";  // Phase 18 Plan 18-03 (TRON-W-02) — TRC-20 transfer
// Phase 19 — TRC-20 approve + Stake 2.0
import "./prepare_tron_token_approve.js";            // Phase 19 Plan 19-01 (TRON-PREP-05)
import "./prepare_tron_revoke_approval.js";           // Phase 19 Plan 19-01 (TRON-W-03)
import "./prepare_tron_stake_freeze.js";              // Phase 19 Plan 19-02 (TRON-W-04)
import "./prepare_tron_stake_unfreeze.js";            // Phase 19 Plan 19-02 (TRON-W-04)
import "./prepare_tron_withdraw_expire_unfreeze.js";  // Phase 19 Plan 19-02 (TRON-W-05)
import "./prepare_tron_stake_vote.js";                // Phase 19 Plan 19-03 (TRON-W-06)
import "./prepare_tron_stake_claim_rewards.js";       // Phase 19 Plan 19-03 (TRON-W-07)
```

All other imports stay BYTE-UNTOUCHED (no reordering, no removals).

---

## Test File Patterns

### `test/signing-fingerprint-tron-19.test.ts` (NEW sibling file — Fixtures Tron-19-A/B/C/D)

**Analog:** `test/signing-fingerprint-tron.test.ts` (Phase 18 M+N anchors — FROZEN)

**Pattern** (`signing-fingerprint-tron.test.ts` lines 1–191 — mirror structure exactly, new fixture names):
```typescript
// Fixture Tron-19-A — TRC-20 approve fingerprint (TriggerSmartContract shape)
// Fixture Tron-19-B — FreezeBalanceV2 fingerprint (Protobuf-native shape)
// Fixture Tron-19-C — VoteWitnessContract fingerprint (Protobuf-native shape)
// Fixture Tron-19-D — WithdrawBalanceContract fingerprint (Protobuf-native shape)

// Each fixture:
const FIXTURE_TRON_19_A_RAW_DATA_HEX = "..."; // computed at PR-write time via node -e
const FIXTURE_TRON_19_A_FINGERPRINT = "0x..."; // hardcoded literal — NO beforeAll-snapshot

it("Fixture Tron-19-A — TRC-20 approve fingerprint (hardcoded literal anchor)", () => {
  const rawDataBytes = new Uint8Array(Buffer.from(FIXTURE_TRON_19_A_RAW_DATA_HEX, "hex"));
  expect(rawDataBytes.length).toBe(N); // stable byte-length anchor
  const fp = computeTronPayloadFingerprint({ rawDataBytes });
  expect(fp).toBe(FIXTURE_TRON_19_A_FINGERPRINT); // literal; drift fails HERE
});
```

**Critical constraints** (from CONTEXT D-08c + CLAUDE.md):
- NO `beforeAll` snapshot — every literal is hardcoded at PR-write time
- The Phase 18 file `test/signing-fingerprint-tron.test.ts` is BYTE-UNTOUCHED
- This file is the Phase 19 sibling carve only

---

### `test/prepare-tron-token-approve.test.ts` and `test/prepare-tron-revoke-approval.test.ts`

**Analog:** `test/prepare-tron-trc20-send.test.ts` + `test/prepare-revoke-approval.test.ts`

**Mock setup pattern** (`prepare-tron-trc20-send.test.ts` lines 36–86 — copy exactly):
```typescript
const { listAccountsSpy, createHandleSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  createHandleSpy: vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

vi.mock("../src/wallet/non-evm-account-store.js", async () => { ... listAccounts: listAccountsSpy ... });
vi.mock("../src/signing/handle-store.js", async () => { ... createHandle: createHandleSpy ... });
```

**Fixture re-anchor** (`prepare-tron-trc20-send.test.ts` lines 109–116 pattern):
- Define `FIXTURE_TRON_19_A_FINGERPRINT` as the same literal from `signing-fingerprint-tron-19.test.ts`
- Call the tool with the fixture inputs
- Assert `structuredContent.payloadFingerprint === FIXTURE_TRON_19_A_FINGERPRINT`

**Byte-identity test** (`prepare-revoke-approval.test.ts` lines 186–234 — adapt for TRON):
```typescript
describe("prepare_tron_revoke_approval — BYTE-IDENTITY INVARIANT (T-TRON-REVOKE-DRIFT-1)", () => {
  it("revoke({T,S}).payloadFingerprint === approve({T,S,amount:\"0\"}).payloadFingerprint + rawDataHex identical", async () => {
    // Call both tools with identical tokenAddress + spender
    // Assert payloadFingerprint equality + rawDataHex equality (byte-level)
    expect(revokeSc.payloadFingerprint).toBe(approveSc.payloadFingerprint);
    expect(revokeRecord.tx.rawDataHex).toBe(approveRecord.tx.rawDataHex);
  });
});
```

---

### `test/protocols-tron-approve.test.ts`, `test/protocols-tron-stake.test.ts`, `test/protocols-tron-vote.test.ts`

**Analog:** `test/protocols-tron-trc20.test.ts` + `test/protocols-tron-native.test.ts`

These unit-test the encoder/decoder functions in isolation with stub TronWeb. Pattern (`protocols-tron-trc20.test.ts`): mock `triggerSmartContract` return, call encoder, assert `rawDataHex` + `rawDataBytes` + `refBlockBytes` round-trip.

---

### `test/lifecycle-tron-stake-19.integration.test.ts` (LOAD-BEARING)

**Analog:** `test/trust-pipeline-tron.integration.test.ts` (Phase 18 LOAD-BEARING — lines 1–250+)

**Pattern** (mirror `trust-pipeline-tron.integration.test.ts` setup exactly):
```typescript
// [STOP-THE-LINE] Any byte-identity assertion failing in this file is a
// security regression. DO NOT mask, DO NOT skip — fix the regression.

const { listAccountsSpy, sendRawTransactionSpy } = vi.hoisted(() => ({...}));
vi.mock("../src/wallet/non-evm-account-store.js", ...);

import { _tronRegistry } from "../src/chains/tron/registry.js";
import { _tronLedgerTransport } from "../src/wallet/ledger-tron-transport.js";
// etc.

await import("../src/tools/register-all.js");
```

**Phase 19 departure from Phase 18:** persona-cycle byte-identity NOT load-bearing here (Phase 18 already proved it). Phase 19 integration test instead asserts the multi-tx lifecycle:

```typescript
// vi.setSystemTime pattern (from CONTEXT D-10c)
it("freeze → unfreeze → 14-day-elapsed → withdraw-expire full lifecycle", async () => {
  const originalTime = Date.now();
  vi.useFakeTimers();
  vi.setSystemTime(originalTime);

  // 1. freeze
  const freezeResult = await callTool("prepare_tron_stake_freeze", { ... });
  // assert Fixture Tron-19-B fingerprint

  // 2. unfreeze
  const unfreezeResult = await callTool("prepare_tron_stake_unfreeze", { ... });

  // 3. advance past 14-day window
  vi.setSystemTime(originalTime + 15 * 86400 * 1000);

  // 4. withdraw-expire — simulation mock returns "withdrawable balance found"
  const withdrawResult = await callTool("prepare_tron_withdraw_expire_unfreeze", {});
  // assert payload shapes

  vi.useRealTimers();
});
```

---

## Shared Patterns

### TRON address validation
**Source:** `src/tools/prepare_tron_native_send.ts` lines 145–159, `src/tools/prepare_tron_trc20_send.ts` lines 159–189
**Apply to:** All 7 new tool files
```typescript
if (!tronUtils.address.isAddress(rawTo)) {
  return { isError: true, content: [{ type: "text", text: `error: invalid 'to' address: ...` }],
    structuredContent: errEnvelope("INVALID_INPUT", `invalid 'to' address: "${rawTo}" is not a valid TRON base58check address`) };
}
```

### Demo/real-mode guard (TRON)
**Source:** `src/tools/prepare_tron_native_send.ts` lines 195–256
**Apply to:** All 7 new tool files (identical block — no deviation)

### ESM spy-affordance `_tronXxx` objects
**Source:** `src/protocols/tron-trc20.ts` lines 327–339, `src/protocols/tron-native.ts` lines 248–260
**Apply to:** `tron-approve.ts` (`_tronApprove`), `tron-stake.ts` (`_tronStake`), `tron-vote.ts` (`_tronVote`)
```typescript
export const _tronApprove = { encodeTronTrc20Approve, decodeTronTrc20ApproveCall };
export const _tronStake = { encodeFreezeBalanceV2, encodeUnfreezeBalanceV2, encodeWithdrawExpireUnfreeze };
export const _tronVote = { buildVoteWitnessContract, buildWithdrawBalanceContract, fetchLiveSrList, getSnapshotSrList };
```

### `extendExpiration(tx, 900)` — LOAD-BEARING
**Source:** `src/protocols/tron-native.ts` lines 114–119, `src/protocols/tron-trc20.ts` lines 133–138
**Apply to:** All encoders in `tron-stake.ts` + `tron-vote.ts`
This call is MANDATORY — without it the handle expires in 60s (tronweb default). NEVER skip.

### `payloadFingerprint` compute + binding
**Source:** `src/tools/prepare_tron_native_send.ts` lines 297–302
**Apply to:** All 7 new tool files
```typescript
const payloadFingerprint = _tronFingerprint.computeTronPayloadFingerprint(
  { rawDataBytes: encoded.rawDataBytes },
);
```

### `errEnvelope` helper pattern
**Source:** `src/tools/prepare_tron_native_send.ts` lines 83–92
**Apply to:** All 7 new tool files (copy verbatim — DO NOT re-design)
```typescript
function errEnvelope(code: ErrorCode, message: string, cause?: string): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}
```

### `PreparedTxTron` sentinel EVM fields
**Source:** `src/tools/prepare_tron_native_send.ts` lines 313–318
**Apply to:** All 7 new tools (EVM sentinel fields are always the same zeros)
```typescript
chainId: 0,
to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
valueWei: 0n,
data: "0x" as `0x${string}`,
```

### Format-fanout-sentinel template substitution
**Source:** `src/tools/prepare_tron_native_send.ts` lines 346–351
**Apply to:** All 7 new tools — import template from `blocks-tron.ts`; NEVER inline block strings in tool files
```typescript
const prepareReceipt = PREPARE_RECEIPT_TRON_STAKE_TEMPLATE
  .replace("{OPERATION}", "FreezeBalanceV2")
  .replace("{RESOURCE}", rawResource)
  .replace("{SUN}", rawSun)
  .replace("{REF_BLOCK_BYTES}", encoded.refBlockBytes)
  .replace("{REF_BLOCK_HASH}", encoded.refBlockHash)
  .replace("{EXPIRATION}", String(encoded.expiration));
```

### Cryptographic-binding fixture convention (NO `beforeAll`-snapshot)
**Source:** `test/signing-fingerprint-tron.test.ts` lines 70–121 + CLAUDE.md
**Apply to:** `test/signing-fingerprint-tron-19.test.ts`
Every `FIXTURE_TRON_19_X_RAW_DATA_HEX` and `FIXTURE_TRON_19_X_FINGERPRINT` must be hardcoded literals computed at PR-write time via discardable `node -e` script. `beforeAll` snapshots are PROHIBITED.

---

## FROZEN-Area Assertions

The following files are BYTE-UNTOUCHED by Phase 19. The planner MUST NOT propose changes to them.

| File | Reason |
|---|---|
| `src/signing/payload-fingerprint-tron.ts` | Phase 18 primitives shelf — FROZEN |
| `src/signing/presign-hash-tron.ts` | Phase 18 primitives shelf — FROZEN |
| `src/protocols/tron-native.ts` | Phase 18 primitives shelf — FROZEN |
| `src/protocols/tron-trc20.ts` | Phase 18 primitives shelf — FROZEN |
| `src/security/canonical-dispatch-tron.ts` | Phase 18 primitives shelf — FROZEN |
| `src/signing/handle-store.ts` | FROZEN **EXCEPT** the `PreparedTxTron.kind` literal union (additive extension only: add `"stake-freeze" \| "stake-unfreeze" \| "stake-withdraw-expire" \| "stake-vote" \| "stake-claim"`) |
| `src/tools/prepare_tron_native_send.ts` | Phase 18 tool — FROZEN |
| `src/tools/prepare_tron_trc20_send.ts` | Phase 18 tool — FROZEN |
| `src/tools/prepare_token_approve.ts` | Phase 6 EVM tool — FROZEN (analog reference only; never extends) |
| `src/tools/prepare_revoke_approval.ts` | Phase 6 EVM tool — FROZEN (analog reference only; never extends) |
| `src/tools/send_transaction.ts` (lines 210–340) | Three-gate FROZEN region — Phase 19 adds NO new dispatch arms |
| `test/signing-fingerprint.test.ts` | EVM anchor file — FROZEN |
| `test/signing-fingerprint-solana.test.ts` | Solana anchor file — FROZEN |
| `test/signing-fingerprint-tron.test.ts` | Phase 18 M+N anchor file — FROZEN |
| `src/signing/error-codes.ts` | 23-code locked union — FROZEN. Phase 19 reuses `INVALID_INPUT`, `DISPATCH_TARGET_REFUSED`, `SIMULATION_REFUSED`, `LEDGER_REJECTED`, `BROADCAST_FAILED` |

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/protocols/tron-stake.ts` | protocol | transform | No Stake 2.0 Protobuf-native encoder in codebase. Closest is `tron-native.ts` (same tronweb builder + extendExpiration pattern) but FreezeBalanceV2 / UnfreezeBalanceV2 / WithdrawExpireUnfreeze are distinct Protobuf contract types with `resource` enum. Planner should use `tron-native.ts` as structural template + Stake 2.0 TIP-491 spec for the contract-specific parameters. |
| `src/protocols/tron-vote.ts` | protocol | transform | No vote-witness or reward-claim encoder in codebase. The SR registry hybrid loader (live + snapshot fallback) is novel — no existing analog. Planner uses `tron-trc20.ts` shape for encoder + `tron-top-25.ts` for registry discipline. |

---

## Surprises for Planner

**Surprise 1: `handle-store.ts` requires a non-frozen additive edit**
`PreparedTxTron.kind` (line 318) is currently `"native" | "trc20"`. Phase 19 must extend this to include the 5 new Stake 2.0 + vote/claim discriminants. This is a targeted additive change to an otherwise-FROZEN file. The rest of `handle-store.ts` stays byte-identical. The planner should carve this into the appropriate plan wave (earliest wave that introduces a Stake 2.0 tool — Plan 19-02).

**Surprise 2: `preview_send.ts` TRON branch needs Stake 2.0 + vote/claim decode arms**
The existing TRON branch in `preview_send.ts` narrows on `kind: "native" | "trc20"`. With 5 new `kind` values, the preview branch needs new arms. However, per CONTEXT D-11c the three-gate FROZEN region (lines 210–340) covers only the `send_transaction.ts` three-gate, NOT `preview_send.ts`. The planner must add decode arms to `preview_send.ts` TRON branch in Plan 19-04 (or whichever wave closes out the full set). This is NOT a frozen area — it is the expected integration point.

**Surprise 3: `TronInstructionSummary` in `handle-store.ts` needs new kind variants**
The `TronInstructionSummary` discriminated union (lines 121–143) currently has `"native-transfer"` and `"trc20-transfer"`. Phase 19 needs new kinds: `"trc20-approve"`, `"stake-freeze"`, `"stake-unfreeze"`, `"stake-withdraw-expire"`, `"stake-vote"`, `"stake-claim"`. These are additive; no existing arms change. But the planner must not overlook this second additive change in `handle-store.ts`.

**Surprise 4: `canonical-dispatch-tron.ts` MAY need extension for Stake 2.0 contract types**
The existing Phase 18 canonical-dispatch-tron allowlist (FROZEN file) was designed for `"native"` and `"trc20"` kinds only. Stake 2.0 transactions are neither — they are Protobuf-native non-TriggerSmartContract calls. Whether the existing dispatch allowlist covers them (pass-through for unknown kinds) or explicitly refuses them needs verification at execute time. If the existing dispatch logic has an exhaustive check that falls through to `DISPATCH_TARGET_REFUSED` for unrecognized kinds, Phase 19 must either (a) modify the dispatch logic (touching the FROZEN file) or (b) ensure the new `kind` values route through the dispatch without triggering the refusal. This is a potential FROZEN-area carve risk. The planner should verify the `canonical-dispatch-tron.ts` source before committing to the plan.

**Surprise 5: Stake 2.0 Protobuf field names differ from tronweb v6 builder method names**
tronweb's `transactionBuilder.freezeBalanceV2(amount, resource, address)` positional args do not match the Protobuf field naming (`frozen_balance`, `resource`, `owner_address`). The builder wraps this, but the `raw_data.contract[0].type` field in the resulting tx will be `"FreezeBalanceV2Contract"` — verify against the installed `.d.ts`. The decoder in `tron-stake.ts` reads `contract[0].type` for the `kind` discriminant, so this type-string must match what tronweb produces.

---

## Metadata

**Analog search scope:** `src/tools/`, `src/protocols/`, `src/signing/`, `src/config/`, `src/tokens/`, `test/`
**Files scanned:** 12 source files + 5 test files
**Pattern extraction date:** 2026-05-20
