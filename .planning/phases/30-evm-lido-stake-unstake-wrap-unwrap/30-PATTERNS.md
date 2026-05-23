# Phase 30: Lido — stake / unstake / wrap / unwrap — Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 19 new/modified files (9 source, 10 test)
**Analogs found:** 19 / 19

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/protocols/lido.ts` | protocol-decoder | request-response (encode + decode) | `src/protocols/weth9.ts` + `src/protocols/aave-v3.ts` | exact (structural merge) |
| `src/config/contracts.ts` (extend) | SOT-table | CRUD | Existing Morpho/Compound sibling sub-tables in same file | exact |
| `src/security/canonical-dispatch.ts` (extend) | middleware | request-response | Existing Morpho arm at lines 120–136 | exact |
| `src/chains/lido.ts` | service | request-response (multi-chain fan-out) | `src/tools/get_lending_positions.ts` (multi-chain reads) | role-match |
| `src/signing/lido-rebase.ts` | pure-math | transform | `src/signing/aave-health.ts` | exact |
| `src/tools/get_lido_positions.ts` | tool (read) | request-response | `src/tools/get_lending_positions.ts` | exact |
| `src/tools/prepare_lido_stake.ts` | tool (write, value-bearing) | request-response | `src/tools/prepare_native_send.ts` | exact |
| `src/tools/prepare_lido_unstake.ts` | tool (write, approval-gated, NFT) | request-response | `src/tools/prepare_compound_supply.ts` + `src/tools/prepare_weth_unwrap.ts` | role-match |
| `src/tools/prepare_lido_wrap.ts` | tool (write, approval-gated) | request-response | `src/tools/prepare_compound_supply.ts` | role-match |
| `src/tools/prepare_lido_unwrap.ts` | tool (write) | request-response | `src/tools/prepare_weth_unwrap.ts` | exact |
| `src/signing/blocks.ts` (extend) | template-store | transform | Existing Phase 29 append-only tail (line 1164+) | exact |
| `src/tools/register-all.ts` (extend) | config | — | Existing Phase 28/29 additive import lines 82–91 | exact |
| `test/protocols-lido.test.ts` | test | — | `test/protocols-weth9.test.ts` | exact |
| `test/signing-lido-rebase.test.ts` | test | — | `test/signing-aave-health.test.ts` | exact |
| `test/get-lido-positions.test.ts` | test | — | `test/get-lending-positions.test.ts` | exact |
| `test/prepare-lido-stake.test.ts` | test | — | `test/prepare-aave-supply.test.ts` | role-match |
| `test/prepare-lido-unstake.test.ts` | test | — | `test/prepare-compound-supply.test.ts` | role-match |
| `test/prepare-lido-wrap.test.ts` | test | — | `test/prepare-compound-supply.test.ts` | role-match |
| `test/prepare-lido-unwrap.test.ts` | test | — | `test/prepare-weth-unwrap.test.ts` + `test/prepare-aave-supply.test.ts` | role-match |
| `test/lido-lifecycle.integration.test.ts` | test (integration) | — | `test/aave-v3-lifecycle.integration.test.ts` | exact |
| `test/signing-fingerprint.test.ts` (extend) | test-fixture | — | Existing Fixture R/S/T/U block at lines 211–295 | exact |
| `test/config-contracts.test.ts` (extend) | test | — | T-29-01-T-FROZEN cross-view block at lines 528–553 | exact |

---

## Pattern Assignments

### `src/protocols/lido.ts` (protocol-decoder, encode + decode)

**Analogs:** `src/protocols/weth9.ts` (full), `src/protocols/aave-v3.ts` (lines 1–58)

This is a structural merge: weth9.ts gives the single-method ABI + selector-const + encoder function shape; aave-v3.ts gives the multi-method ABI + multi-selector table extension. Phase 30 combines both.

**Imports pattern** (from `src/protocols/weth9.ts` lines 25–27):
```typescript
import { type Address, type Hex, encodeFunctionData, parseAbi } from "viem";
import { getLidoStethAddress, getLidoWstethAddress, getLidoWithdrawalQueueAddress, type ChainId } from "../config/contracts.js";
```

**ABI fragment + selector table pattern** (from `src/protocols/weth9.ts` lines 41–53, `src/protocols/aave-v3.ts` lines 43–58):
```typescript
// weth9.ts pattern — one ABI per distinct function, hardcoded selector const
export const WETH9_WITHDRAW_ABI = parseAbi([
  "function withdraw(uint256 amount)",
  "function deposit() payable",
]);
export const WETH9_SELECTORS = {
  withdraw: "0x2e1a7d4d" as Hex,
} as const;

// aave-v3.ts extension — multi-method selector table
export const AAVE_V3_SELECTORS = {
  supply: "0x617ba037" as Hex,
  withdraw: "0x69328dec" as Hex,
} as const;
```

**Phase 30 mirrors this as:**
```typescript
// src/protocols/lido.ts — 4 ABI fragments + 4 hardcoded verified selectors
export const LIDO_SELECTORS = {
  submit: "0xa1903eab" as Hex,           // Lido.submit(address)
  requestWithdrawals: "0xd6681042" as Hex, // WithdrawalQueue.requestWithdrawals(uint256[],address)
  wrap: "0xea598cb0" as Hex,              // WstETH.wrap(uint256) — VERIFIED
  unwrap: "0xde0e9a3e" as Hex,            // WstETH.unwrap(uint256) — VERIFIED
} as const;
```

**Encoder function pattern** (from `src/protocols/weth9.ts` lines 76–82):
```typescript
export function encodeWethWithdraw(amount: bigint): Hex {
  return encodeFunctionData({
    abi: WETH9_WITHDRAW_ABI,
    functionName: "withdraw",
    args: [amount],
  });
}
```

**Phase 30 mirrors this with 4 encoder functions.** For `requestWithdrawals` the single-element array is critical (Pitfall 1 from RESEARCH.md):
```typescript
export function encodeRequestWithdrawals(stethAmountWei: bigint, owner: Address): Hex {
  return encodeFunctionData({
    abi: WQ_REQUEST_ABI,
    functionName: "requestWithdrawals",
    args: [[stethAmountWei], owner],  // [stethAmountWei] — ALWAYS single-element array per D-06
  });
}
```

**Canonical address re-export pattern** (from `src/protocols/weth9.ts` lines 91–93):
```typescript
export function getWethContractAddress(chainId: ChainId): Address {
  return getWethAddress(chainId);  // delegates to SOT
}
```

**ESM spy-affordance:** `src/protocols/lido.ts` MUST export `_lidoProtocol` indirection object wrapping all encoder functions (CLAUDE.md convention). Mirror `_aaveProtocols` in `src/protocols/aave-v3.ts`.

---

### `src/config/contracts.ts` — LidoContracts interface + LIDO_RAW + 3 getters + 2 KNOWN_SPENDERS entries (SOT-table extension)

**Analog:** Morpho Blue sub-table at lines 298–348, Compound sub-table at lines 221–296

**Interface + raw table pattern** (from `src/config/contracts.ts` lines 331–348):
```typescript
// Morpho Blue pattern — Partial<Record<ChainId, Address>> sibling sub-table
const MORPHO_BLUE_RAW: Partial<Record<ChainId, Address>> = {
  1: getAddress("0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"),
};
export function getMorphoBlueAddress(chainId: ChainId): Address | null {
  return MORPHO_BLUE_RAW[chainId] ?? null;
}
```

**Phase 30 uses a 3-field struct (not a scalar Address) so it mirrors Compound's inner-record shape but at the chain level:**
```typescript
// src/config/contracts.ts — Phase 30 Plan 30-01 append (after Morpho Blue SOT, before KNOWN_SPENDERS_ETHEREUM)
export interface LidoContracts {
  steth: Address;           // stETH proxy (Ethereum + placeholder zero on Arbitrum)
  wsteth: Address;          // wstETH (Ethereum + Arbitrum bridged)
  withdrawalQueue: Address; // WithdrawalQueueERC721 (Ethereum only)
}
const LIDO_RAW: Partial<Record<ChainId, LidoContracts>> = {
  1: {
    steth: getAddress("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"),
    wsteth: getAddress("0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0"),
    withdrawalQueue: getAddress("0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1"),
  },
  42161: {
    steth: getAddress("0x0000000000000000000000000000000000000000"),
    wsteth: getAddress("0x5979D7b546E38E414F7E9822514be443A4800529"),
    withdrawalQueue: getAddress("0x0000000000000000000000000000000000000000"),
  },
};
export function getLidoStethAddress(chainId: ChainId): Address | null {
  return LIDO_RAW[chainId]?.steth ?? null;
}
export function getLidoWstethAddress(chainId: ChainId): Address | null {
  return LIDO_RAW[chainId]?.wsteth ?? null;
}
export function getLidoWithdrawalQueueAddress(chainId: ChainId): Address | null {
  return LIDO_RAW[chainId]?.withdrawalQueue ?? null;
}
```

**KNOWN_SPENDERS_ETHEREUM append pattern** (from `src/config/contracts.ts` lines 430–440):
```typescript
// Morpho Blue row — existing pattern to copy
{
  address: getMorphoBlueAddress(1)!,
  label: "Morpho Blue",
  source: "https://docs.morpho.org/addresses",
},
```

**Phase 30 appends 2 rows after the Morpho row** (rows 17 and 18 in the zero-indexed array — existing rows 0–16 stay byte-identical):
```typescript
{
  address: getLidoWstethAddress(1)!,
  label: "Lido wstETH (for stETH wrap)",
  source: "https://docs.lido.fi/deployed-contracts/",
},
{
  address: getLidoWithdrawalQueueAddress(1)!,
  label: "Lido WithdrawalQueueERC721 (for stETH unstake)",
  source: "https://docs.lido.fi/deployed-contracts/",
},
```

**Insertion point:** After line 440 (`getMorphoBlueAddress(1)! "Morpho Blue"` closing brace), before the `1inch Aggregation Router V6` row. The `!` non-null assertion is safe because `LIDO_RAW[1]` is populated at module load.

---

### `src/security/canonical-dispatch.ts` — Lido arm extension (middleware, request-response)

**Analog:** Morpho Blue arm at lines 119–134

**Morpho arm pattern** (lines 120–136):
```typescript
// Phase 29 — Plan 29-03. Morpho Blue is a SINGLE singleton contract per chain.
const morphoBlue = getMorphoBlueAddress(chainId);
const morphoEntries: Address[] = morphoBlue ? [morphoBlue] : [];
return new Set<Address>([
  getAaveV3PoolAddress(chainId),
  getWethAddress(chainId),
  ONEINCH_V6_ROUTER_ALL_CHAINS,
  LIFI_DIAMOND_ALL_CHAINS,
  ...tokenContracts,
  ...compoundComets,
  ...morphoEntries,   // ← last arm before closing Set constructor
]);
```

**Phase 30 extends `buildPerChainAllowlist` to add Lido BEFORE the `new Set` return** (appended imports at top of file: `getLidoStethAddress`, `getLidoWstethAddress`, `getLidoWithdrawalQueueAddress`):
```typescript
// Phase 30 — Plan 30-01. Lido write-side allowlist (Ethereum arm only).
// Arbitrum wstETH has a non-zero slot but zero steth/withdrawalQueue — filtered.
const lidoSteth = getLidoStethAddress(chainId);
const lidoWsteth = getLidoWstethAddress(chainId);
const lidoWq = getLidoWithdrawalQueueAddress(chainId);
const lidoEntries: Address[] = [lidoSteth, lidoWsteth, lidoWq].filter(
  (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000",
);
```

Then include `...lidoEntries` inside the `new Set<Address>([...])` constructor alongside `...morphoEntries`.

**Imports to add at file top** (mirrors existing pattern at line 60–66):
```typescript
import {
  getLidoStethAddress,
  getLidoWstethAddress,
  getLidoWithdrawalQueueAddress,
  // ... existing imports
} from "../config/contracts.js";
```

---

### `src/chains/lido.ts` (service, request-response multi-chain fan-out)

**Analog:** `src/tools/get_lending_positions.ts` — multi-chain Promise.all + per-chain publicClient pattern (lines 1–54 for import shape; body uses `getChainClient(chainId)`)

**Multi-chain client fan-out pattern** (from `src/tools/get_lending_positions.ts` imports, lines 27–54):
```typescript
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { chainIdFromName, type ChainId, type ChainName } from "../config/contracts.js";
```

**Per-chain read pattern** (from `src/tools/get_lending_positions.ts` body shape):
```typescript
const client = getChainClient(chainId);
const [balanceOf, sharesOf] = await Promise.all([
  client.readContract({ address: stethAddr, abi: STETH_READ_ABI, functionName: "balanceOf", args: [wallet] }),
  client.readContract({ address: stethAddr, abi: STETH_READ_ABI, functionName: "sharesOf", args: [wallet] }),
]);
```

**Arbitrum cross-chain read pattern** (novel for Phase 30 — Arbitrum wstETH uses Ethereum mainnet for `stEthPerToken`):
```typescript
// For Arbitrum: wstethBalance from Arbitrum client; conversionRate from Ethereum mainnet client
const arbClient = getChainClient(42161);
const ethClient = getChainClient(1);
const [wstethBalance, conversionRate] = await Promise.all([
  arbClient.readContract({ address: arbWstethAddr, abi: WSTETH_BALANCEOF_ABI, functionName: "balanceOf", args: [wallet] }),
  ethClient.readContract({ address: ethWstethAddr, abi: WSTETH_READ_ABI, functionName: "stEthPerToken" }),
]);
```

**ESM spy-affordance:** Export `_lidoChains` indirection object (mirrors `_aaveChains` in `src/chains/aave-v3.ts` and `_morphoChains` in `src/chains/morpho-blue.ts`).

---

### `src/signing/lido-rebase.ts` (pure-math, transform)

**Analog:** `src/signing/aave-health.ts` (full file, 183 lines)

**Structure to mirror exactly** (from `src/signing/aave-health.ts` lines 1–41):
```typescript
// Pure-bigint math. NO side effects. NO RPC reads. NO module-load state.
// Shared by get_lido_positions (accrued rebase rewards display).

export const STETH_BASE: bigint = 10n ** 18n;
export const STETH_DECIMALS: bigint = 18n;

export interface LidoRebaseInput {
  shares: bigint;           // sharesOf(wallet) — invariant under rebases
  currentStethBalance: bigint; // balanceOf(wallet) — changes with oracle reports
}
export interface LidoRebaseOutput {
  accruedRebaseRewards: bigint; // approximate: currentBalance - shares
  approx: true;                 // D-09 load-bearing flag — never false
}
export function computeRebaseRewards(input: LidoRebaseInput): LidoRebaseOutput {
  return {
    accruedRebaseRewards: input.currentStethBalance - input.shares,
    approx: true,  // per D-09 — never exact without transfer history
  };
}
```

**Constant declaration pattern** (from `src/signing/aave-health.ts` lines 27–40):
```typescript
// Export constants as bigint — byte-identical to research § Topic N lock.
// Drift in these constants cascades through every consumer.
export const RAY: bigint = 10n ** 27n;
export const BPS_SCALE: bigint = 10000n;
export const HF_SCALE: bigint = 10n ** 18n;
```

**ESM spy-affordance:** Export `_lidoRebase` indirection object wrapping `computeRebaseRewards` (mirrors `_aaveChains` pattern for internal-call test interception).

---

### `src/tools/get_lido_positions.ts` (tool read, request-response)

**Analog:** `src/tools/get_lending_positions.ts` (full tool shape, lines 1–54 + body structure)

**Tool description + INPUT_SCHEMA pattern** (from `src/tools/get_lending_positions.ts` lines 56–80):
```typescript
const DESCRIPTION = [
  "Read DeFi lending positions on a supported EVM chain for a wallet address...",
  // ...one concern per sentence
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description: "Chain identifier (required)...",
    },
    wallet: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "..." },
  },
  required: ["chain", "wallet"],
  additionalProperties: false,
};
```

**Phase 30 `get_lido_positions` INPUT_SCHEMA** narrows `chain` to `["ethereum", "arbitrum"]` (reads only on these two per D-01/D-03).

**Registration pattern** (same `registerTool` call shape from `src/tools/get_lending_positions.ts`):
```typescript
import { registerTool } from "./index.js";
registerTool("get_lido_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // wallet validation → chain client → parallel reads → structured result
});
```

**Structured response shape** (mirrors `get_lending_positions` but Lido-specific per D-08):
```typescript
return {
  content: [{ type: "text", text: summary }],
  structuredContent: {
    chain: chainName,
    chainId,
    wallet: walletAddr,
    stethBalance: stethBalance?.toString() ?? null,
    stethBalanceHuman: stethBalance ? formatUnits(stethBalance, 18) : null,
    wstethBalance: wstethBalance.toString(),
    wstethBalanceHuman: formatUnits(wstethBalance, 18),
    stethShares: stethShares?.toString() ?? null,
    conversionRate: conversionRate.toString(),
    accruedRebaseRewards: accruedRebaseRewards?.toString() ?? null,
    approx: true,  // D-09 load-bearing
    rpcDegraded: isPublicNodeFallback(),
  },
};
```

---

### `src/tools/prepare_lido_stake.ts` (tool write, value-bearing, request-response)

**Analog:** `src/tools/prepare_native_send.ts` (full file — value-bearing shape)
**Secondary analog:** `src/tools/prepare_weth_unwrap.ts` (for `resolveFrom` + error envelope shape)

**Value-bearing tx pattern** (from `src/tools/prepare_native_send.ts` lines 132–200):
```typescript
registerTool("prepare_native_send", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const chainName = args.chain as ChainName;
    const chainId = chainIdFromName(chainName);
    // ... address + valueWei validation
    const tx = {
      chainId,
      to: toAddr,   // ← for stake: to = getLidoStethAddress(1) from SOT
      valueWei: valueWei,  // ← ETH stake amount goes here, NOT calldata
      data: data,   // ← for stake: encodeLidoSubmit("0x0...0") — referral = address(0)
    };
    const payloadFingerprint = computePayloadFingerprint(tx);
    const handle = createHandle({ args: { ... }, tx, payloadFingerprint });
    const receipt = LIDO_STAKE_PREPARE_RECEIPT_TEMPLATE.replace(...).replace(...);
    return { content: [{ type: "text", text: receipt }], structuredContent: { handle, ... } };
  } catch (err) { /* INTERNAL_ERROR envelope */ }
});
```

**Key deviation from `prepare_native_send`:** chain is locked to `ethereum` only (D-03). Refuse non-Ethereum with `CHAIN_ID_MISMATCH` errorCode 15 (same pattern as `prepare_compound_supply` line 154–168):
```typescript
if (chainName !== "ethereum") {
  return {
    isError: true,
    content: [{ type: "text", text: `error: invalid 'chain': Lido stake supports only 'ethereum', got "${chainName}"` }],
    structuredContent: errEnvelope("CHAIN_ID_MISMATCH", `...`),
  };
}
```

**Zero-value guard** (new for stake — D-09, Pitfall 7):
```typescript
if (amountWei === 0n) {
  return { isError: true, content: [...], structuredContent: errEnvelope("INVALID_INPUT", "stake amount must be > 0") };
}
```

**PREPARE RECEIPT template** (new `LIDO_STAKE_PREPARE_RECEIPT_TEMPLATE` in `src/signing/blocks.ts` — mirrors `AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE` lines 606–612):
```typescript
export const LIDO_STAKE_PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  operation:    Lido stake (ETH → stETH)",
  "  chain:        {CHAIN}",
  "  stethContract: {STETH_CONTRACT}",
  "  amount:       {AMOUNT} ETH",
].join("\n");
```

---

### `src/tools/prepare_lido_unstake.ts` (tool write, approval-gated, NFT receipt, request-response)

**Analog:** `src/tools/prepare_compound_supply.ts` (approval pre-flight pattern) + `src/tools/prepare_weth_unwrap.ts` (single-arg calldata shape)

**Approval pre-flight pattern** (from `src/tools/prepare_compound_supply.ts` body — intent-gate shape):
```typescript
// CHEAP GATE — validate input + chain BEFORE any RPC read
const canonicalComets = getAllCompoundCometsForChain(chainId);
if (!canonicalComets.includes(cometAddr)) {
  return { isError: true, content: [...], structuredContent: errEnvelope("INVALID_INPUT", "...") };
}
// THEN RPC reads
const client = getChainClient(chainId);
// intent gate uses readContract calls — mirrors the stETH allowance check
```

**Phase 30 approval pre-flight for `prepare_lido_unstake`** (mirrors RESEARCH.md Topic 6 pattern):
```typescript
// D-05: stETH allowance pre-flight for WithdrawalQueue spender
const client = getChainClient(chainId);
const allowance = await client.readContract({
  address: stethAddr,
  abi: STETH_ALLOWANCE_ABI,
  functionName: "allowance",
  args: [fromAddress, withdrawalQueueAddr],
});
if (allowance < amountWei) {
  return {
    isError: true,
    content: [{ type: "text", text: `error: insufficient stETH allowance...` }],
    structuredContent: {
      ...errEnvelope("INVALID_INPUT", `insufficient stETH allowance for WithdrawalQueue...`),
      hintTool: "prepare_token_approve",
      hintArgs: { tokenAddress: stethAddr, spender: withdrawalQueueAddr, amount: formatUnits(amountWei, 18) },
    },
  };
}
```

**NFT receipt block** (D-04 novel block — new template `NFT_RECEIPT_EXPECTED_TEMPLATE` in `src/signing/blocks.ts`):
```typescript
// At prepare_lido_unstake time — predict expected tokenId
const lastId = await client.readContract({
  address: withdrawalQueueAddr, abi: WQ_READ_ABI, functionName: "getLastRequestId",
});
const expectedTokenId = lastId + 1n;  // deterministic for single-amount request

// Build NFT block — appended AFTER the normal PREPARE RECEIPT
const nftBlock = NFT_RECEIPT_EXPECTED_TEMPLATE({
  nftContract: withdrawalQueueAddr,
  expectedTokenId: expectedTokenId.toString(),
  requestor: fromAddress,
  claimableAfter: "~1-5 days (finalization window; monitor via Lido withdrawal tracker)",
});
```

**Amount bounds validation** (RESEARCH.md Topic 4 — 100 wei min, 1000 ETH max):
```typescript
const MIN_WITHDRAWAL = 100n;
const MAX_WITHDRAWAL = 1_000n * 10n ** 18n;
if (amountWei < MIN_WITHDRAWAL || amountWei > MAX_WITHDRAWAL) {
  return { isError: true, ..., structuredContent: errEnvelope("INVALID_INPUT", "stethAmount out of bounds [100 wei, 1000 ETH]") };
}
```

---

### `src/tools/prepare_lido_wrap.ts` (tool write, approval-gated, request-response)

**Analog:** `src/tools/prepare_weth_unwrap.ts` (single-arg ERC-20 call shape) + approval pre-flight from `prepare_lido_unstake`

**Single-arg calldata pattern** (from `src/tools/prepare_weth_unwrap.ts` lines 152–166):
```typescript
const wethAddress: Address = getWethAddress(chainId);
const data: Hex = encodeWethWithdraw(amountWei);
const tx = {
  chainId,
  to: wethAddress,
  valueWei: 0n,   // ← wrap is NOT value-bearing; stETH is consumed as ERC-20
  data,
};
```

**Phase 30 wrap clones this with:**
- `to = getLidoWstethAddress(1)` from SOT
- `data = encodeWstethWrap(amountWei)`
- **Plus stETH allowance pre-flight for wstETH spender** (mirrors `prepare_lido_unstake` pattern, `spender = getLidoWstethAddress(1)`)

**No deviation from the weth_unwrap shape** except: Ethereum-only chain gate (D-03) + stETH approval pre-flight (D-05).

---

### `src/tools/prepare_lido_unwrap.ts` (tool write, request-response)

**Analog:** `src/tools/prepare_weth_unwrap.ts` (mechanical clone — no approval needed for unwrap)

**Mechanical clone** (from `src/tools/prepare_weth_unwrap.ts` lines 105–216):
```typescript
// Deviations from weth_unwrap.ts:
// (a) chain locked to "ethereum" only (D-03 gate)
// (b) to = getLidoWstethAddress(1) (NOT getWethAddress)
// (c) encoder = encodeWstethUnwrap(amountWei) (NOT encodeWethWithdraw)
// (d) NO allowance pre-flight — wstETH is the user's own token; no spender approval needed
// (e) PREPARE RECEIPT uses LIDO_UNWRAP_PREPARE_RECEIPT_TEMPLATE
// (f) NO LEDGER NOTICE — clear-sign coverage confirmed (D-12)
// Everything else verbatim: resolveFrom → parseAmountStrict → tx → payloadFingerprint → createHandle
```

---

### `src/signing/blocks.ts` — extensions (append-only, template-store)

**Analog:** Phase 29 append region at lines 1164–1555 (tail of file)

**Append region header pattern** (from lines 888–903):
```typescript
// -----------------------------------------------------------------------------
// Phase 28 — Plan 28-02 additive extensions (APPEND-ONLY). All Phase 4 / 6 /
// 7 / 8 / 9 templates above stay byte-identical (FROZEN). Two new PREPARE
// RECEIPT templates back the `prepare_compound_supply` + `prepare_compound_
// withdraw` tools.
// -----------------------------------------------------------------------------
```

**PREPARE RECEIPT template shape** (from `src/signing/blocks.ts` lines 921–928):
```typescript
export const COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  operation:    Compound V3 supply",
  "  chain:        {CHAIN}",
  "  comet:        {COMET}",
  "  asset:        {ASSET}",
  "  amount:       {AMOUNT}",
].join("\n");
```

**Phase 30 appends after line 1555** (current end of file):
1. Four `LIDO_*_PREPARE_RECEIPT_TEMPLATE` constants (stake / unstake / wrap / unwrap)
2. `NFT_RECEIPT_EXPECTED_TEMPLATE` function (D-04 novel block — parameterized, not string-join):
```typescript
// RESEARCH.md Pattern 4 — exact shape to copy
export const NFT_RECEIPT_EXPECTED_TEMPLATE = (args: {
  nftContract: Address;
  expectedTokenId: string;
  requestor: Address;
  claimableAfter: string;
}) =>
  [
    `[NFT RECEIPT EXPECTED]`,
    `NFT contract:  ${args.nftContract}`,
    `Expected token ID: ${args.expectedTokenId}  (best-effort at prepare time; may shift if another withdrawal queues before this tx lands)`,
    `Requestor:     ${args.requestor}`,
    `Claimable:     ${args.claimableAfter}`,
  ].join("\n");
```
3. `DECODED_ARGS_TEMPLATE_LIDO_*` templates for `preview_send` selector dispatch
4. A `buildLidoDecodedArgsBlock` function (mirrors `buildAaveDecodedArgsBlock` at line 691)

---

### `src/tools/register-all.ts` — additive imports (config)

**Analog:** Lines 82–91 (Phase 28/29 additive block)

**Extension pattern** (from `src/tools/register-all.ts` lines 82–91):
```typescript
import "./prepare_compound_supply.js";   // Phase 28 Plan 28-02 (CMP-03) — Compound V3 supply
import "./prepare_compound_withdraw.js"; // Phase 28 Plan 28-02 (CMP-04) — Compound V3 withdraw
import "./prepare_compound_borrow.js";   // Phase 28 Plan 28-03 (CMP-05) — Compound V3 borrow
import "./prepare_compound_repay.js";    // Phase 28 Plan 28-03 (CMP-05) — Compound V3 repay
import "./prepare_morpho_borrow.js";              // Phase 29 Plan 29-03 (MOR-03)
// ...
```

**Phase 30 appends after the last Morpho import line** (after line 91):
```typescript
import "./get_lido_positions.js";         // Phase 30 Plan 30-02 (LIDO-01) — stETH + wstETH positions (Ethereum + Arbitrum)
import "./prepare_lido_stake.js";         // Phase 30 Plan 30-03 (LIDO-02) — ETH → stETH (Lido.submit value-bearing)
import "./prepare_lido_unstake.js";       // Phase 30 Plan 30-03 (LIDO-03) — stETH withdrawal queue (NFT receipt)
import "./prepare_lido_wrap.js";          // Phase 30 Plan 30-03 (LIDO-04) — stETH → wstETH (WstETH.wrap)
import "./prepare_lido_unwrap.js";        // Phase 30 Plan 30-03 (LIDO-04) — wstETH → stETH (WstETH.unwrap)
```

---

## Test Pattern Assignments

### `test/protocols-lido.test.ts` (NEW)

**Analog:** `test/protocols-weth9.test.ts` (full file, 79 lines)

**Test structure to mirror** (from `test/protocols-weth9.test.ts` lines 1–79):
```typescript
import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { LIDO_SELECTORS, STETH_DECIMALS, encodeLidoSubmit, encodeRequestWithdrawals,
         encodeWstethWrap, encodeWstethUnwrap, getLidoStethAddress } from "../src/protocols/lido.js";

describe("LIDO_SELECTORS — 4-selector regression anchor", () => {
  it("submit === 0xa1903eab byte-identical", () => { expect(LIDO_SELECTORS.submit).toBe("0xa1903eab"); });
  it("requestWithdrawals === 0xd6681042 byte-identical", () => { expect(LIDO_SELECTORS.requestWithdrawals).toBe("0xd6681042"); });
  it("wrap === 0xea598cb0 byte-identical", () => { expect(LIDO_SELECTORS.wrap).toBe("0xea598cb0"); });
  it("unwrap === 0xde0e9a3e byte-identical", () => { expect(LIDO_SELECTORS.unwrap).toBe("0xde0e9a3e"); });
});

describe("encodeWstethWrap — 36-byte calldata (Fixture X cross-link)", () => {
  it("encodes wrap(1e18) matching Fixture X's data field byte-identically", () => {
    const data = encodeWstethWrap(1_000_000_000_000_000_000n);
    expect(data.slice(0, 10)).toBe(LIDO_SELECTORS.wrap);
    expect(data.length).toBe(74);  // 0x + 8 selector + 64 amount = 74 chars
  });
});
// + similar for encodeWstethUnwrap, encodeLidoSubmit (36 bytes), encodeRequestWithdrawals (100 bytes)
// + requestWithdrawals calldata length = 4 + 32 (offset) + 32 (length=1) + 32 (element) = 100 bytes
```

**Key new test:** array encoding check for `requestWithdrawals` (Pitfall 1):
```typescript
it("encodeRequestWithdrawals produces 100-byte calldata (4 + 32 offset + 32 length + 32 element)", () => {
  const data = encodeRequestWithdrawals(1_000_000_000_000_000_000n, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address);
  // 0x + 8 (selector) + 64 (offset) + 64 (length=1) + 64 (element) = 202 chars
  expect(data.length).toBe(202);
  expect(data.slice(0, 10)).toBe(LIDO_SELECTORS.requestWithdrawals);
});
```

---

### `test/signing-lido-rebase.test.ts` (NEW)

**Analog:** `test/signing-aave-health.test.ts` (full file)

**Deterministic literal anchor pattern** (from `test/signing-aave-health.test.ts` lines 1–60):
```typescript
import { describe, expect, it } from "vitest";
import { STETH_BASE, STETH_DECIMALS, computeRebaseRewards } from "../src/signing/lido-rebase.js";

describe("lido-rebase constants (T-LIDO-REBASE-SNAPSHOT-STALENESS mitigation)", () => {
  it("STETH_BASE === 10n ** 18n byte-identical", () => {
    expect(STETH_BASE).toBe(10n ** 18n);
    expect(STETH_BASE).toBe(1000000000000000000n);
  });
});

describe("computeRebaseRewards — deterministic literal anchor (D-09)", () => {
  it("shares=1e18 + currentBalance=1.05e18 → accruedRebaseRewards=0.05e18 + approx=true", () => {
    const result = computeRebaseRewards({
      shares: 1_000_000_000_000_000_000n,
      currentStethBalance: 1_050_000_000_000_000_000n,
    });
    expect(result.accruedRebaseRewards).toBe(50_000_000_000_000_000n);
    expect(result.approx).toBe(true);
  });
});
```

---

### `test/signing-fingerprint.test.ts` — Fixtures V/W/X/Y extension (EXTEND)

**Analog:** Fixture R/S/T/U block at lines 211–295 (Phase 28 extension pattern)

**Extension insertion point:** After the Fixture U block (line 295), before any BTC/LTC fixtures. Phase 30 adds 4 new `it(...)` calls inside the existing `computePayloadFingerprint — PREP-03 + T-BIND-1` describe block.

**Pattern to mirror** (from lines 211–233):
```typescript
it("Fixture R — Compound V3 supply(USDC, 100e6) on cUSDCv3 fingerprint (hardcoded literal anchor, Phase 28 / Plan 28-01)", () => {
  const cUSDCv3 = getCompoundCometAddress(1, "USDC")!;
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
  const supplyData = encodeCompoundSupply(USDC, 100_000_000n);
  expect(supplyData.length).toBe(138);
  expect(supplyData.slice(0, 10).toLowerCase()).toBe("0xf2b9fdb8");

  const fp = computePayloadFingerprint({
    chainId: 1,
    to: cUSDCv3,
    valueWei: 0n,
    data: supplyData,
  });
  // Hardcoded literal anchor (Plan 28-01 hardening — compute at write-time, pin forever).
  expect(fp).toBe("0x09410c3060d1da3b7434450f172e9951928c22b838193be3f7b9956a603dfa9d");
});
```

**Phase 30 Fixture V/W/X/Y shape:**
```typescript
// Add imports at top of file:
import { getLidoStethAddress, getLidoWstethAddress, getLidoWithdrawalQueueAddress } from "../src/config/contracts.js";
import { encodeLidoSubmit, encodeRequestWithdrawals, encodeWstethWrap, encodeWstethUnwrap } from "../src/protocols/lido.js";

// Fixture V — Lido.submit(address(0)) with 1e18 ETH value
it("Fixture V — Lido.submit(referral=address(0)) with value=1e18 fingerprint (hardcoded literal anchor, Phase 30 Plan 30-01)", () => {
  const steth = getLidoStethAddress(1)!;
  const submitData = encodeLidoSubmit("0x0000000000000000000000000000000000000000");
  // 36 bytes = 4 selector + 32 referral
  expect(submitData.length).toBe(74);
  expect(submitData.slice(0, 10).toLowerCase()).toBe("0xa1903eab");
  const fp = computePayloadFingerprint({ chainId: 1, to: steth, valueWei: 1_000_000_000_000_000_000n, data: submitData });
  // Hardcoded literal — compute at write-time via dist/ build + pin forever. Cross-linked from test/prepare-lido-stake.test.ts.
  expect(fp).toBe("0x<COMPUTED_AT_WRITE_TIME>");
});
// Fixture W — WithdrawalQueue.requestWithdrawals([1e18], wallet)
// Fixture X — WstETH.wrap(1e18)
// Fixture Y — WstETH.unwrap(1e18)
```

**Note:** The `0x<COMPUTED_AT_WRITE_TIME>` placeholder must be replaced with the actual value computed by running the function at implementation time. Do NOT use `beforeAll` snapshot per CLAUDE.md cryptographic-binding fixture discipline.

---

### `test/config-contracts.test.ts` — T-LIDO-SPENDER-DRIFT-1 extension (EXTEND)

**Analog:** T-29-01-T-FROZEN cross-view block at lines 528–553

**Morpho cross-view pattern** (from lines 529–534):
```typescript
it("Test 3 — KNOWN_SPENDERS_ETHEREUM 'Morpho Blue' row ↔ getMorphoBlueAddress(1) byte-identical", () => {
  const morphoRow = KNOWN_SPENDERS_ETHEREUM.find((r) => r.label === "Morpho Blue");
  expect(morphoRow).toBeDefined();
  expect(morphoRow?.address).toBe(getMorphoBlueAddress(1));
});
```

**Phase 30 T-LIDO-SPENDER-DRIFT-1 pattern** (3 cross-view assertions — one per SOT getter):
```typescript
// Add imports at top of file:
import { getLidoWstethAddress, getLidoWithdrawalQueueAddress } from "../src/config/contracts.js";

describe("src/config/contracts.ts — Lido SOT (Phase 30 Plan 30-01)", () => {
  it("T-LIDO-SPENDER-DRIFT-1a — getLidoWstethAddress(1) ↔ KNOWN_SPENDERS_ETHEREUM 'Lido wstETH' row byte-identical", () => {
    const row = KNOWN_SPENDERS_ETHEREUM.find((r) => r.label === "Lido wstETH (for stETH wrap)");
    expect(row).toBeDefined();
    expect(row?.address).toBe(getLidoWstethAddress(1));
  });
  it("T-LIDO-SPENDER-DRIFT-1b — getLidoWithdrawalQueueAddress(1) ↔ KNOWN_SPENDERS_ETHEREUM 'Lido WithdrawalQueueERC721' row byte-identical", () => {
    const row = KNOWN_SPENDERS_ETHEREUM.find((r) => r.label === "Lido WithdrawalQueueERC721 (for stETH unstake)");
    expect(row).toBeDefined();
    expect(row?.address).toBe(getLidoWithdrawalQueueAddress(1));
  });
  it("getLidoStethAddress(1) returns the canonical stETH proxy byte-identical to research literal", () => {
    expect(getLidoStethAddress(1)).toBe(getAddress("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"));
  });
  it("getLidoWstethAddress(42161) returns the canonical Arbitrum bridged wstETH", () => {
    expect(getLidoWstethAddress(42161)).toBe(getAddress("0x5979D7b546E38E414F7E9822514be443A4800529"));
  });
  it("getLidoWithdrawalQueueAddress(42161) returns null-equivalent (zero address is N/A marker)", () => {
    // The Arbitrum slot carries address(0) for steth + withdrawalQueue; the dispatch
    // filter removes them before the allowlist. This test documents the sentinel.
    const addr = getLidoWithdrawalQueueAddress(42161);
    expect(addr).toBe(getAddress("0x0000000000000000000000000000000000000000"));
  });
});
```

---

### `test/lido-lifecycle.integration.test.ts` (NEW)

**Analog:** `test/aave-v3-lifecycle.integration.test.ts` (full file)

**Integration test scaffold pattern** (from `test/aave-v3-lifecycle.integration.test.ts` lines 44–133):
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// 1. vi.mock("../src/wallet/session-manager.js", ...) — mock WC session
// 2. vi.mock("../src/wallet/walletconnect-client.js", ...) — mock WC client
// 3. vi.mock("viem/actions", ...) — mock readContract for on-chain reads
// 4. import "../src/tools/register-all.js" — load all tools
// 5. _resetHandleStoreForTesting() + _resetDemoModeForTesting() in beforeEach

// Persona-cycle pattern:
it("full Lido lifecycle — stake → unstake → wrap → unwrap — byte-identity across persona Alice", async () => {
  // 1. set_demo_wallet → persona Alice
  // 2. prepare_lido_stake({ chain: "ethereum", amount: "1.0" }) → Fixture V cross-check
  // 3. prepare_lido_unstake({ chain: "ethereum", stethAmount: "1.0" }) → Fixture W cross-check
  // 4. prepare_lido_wrap({ chain: "ethereum", stethAmount: "1.0" }) → Fixture X cross-check
  // 5. prepare_lido_unwrap({ chain: "ethereum", wstethAmount: "1.0" }) → Fixture Y cross-check
  // Assert payloadFingerprint byte-identical to hardcoded Fixture V/W/X/Y literals across personas
});
```

**Mock pattern for on-chain reads** (from `test/aave-v3-lifecycle.integration.test.ts` lines 98–118):
```typescript
vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>("viem/actions");
  return {
    ...actual,
    readContract: vi.fn().mockImplementation(async (client, { functionName }) => {
      // Per-function mock returns for stETH/wstETH reads:
      // balanceOf → 1e18, sharesOf → 9.5e17, stEthPerToken → 1.05e18, allowance → 1e18, getLastRequestId → 42n
      if (functionName === "balanceOf") return 1_000_000_000_000_000_000n;
      if (functionName === "sharesOf") return 950_000_000_000_000_000n;
      if (functionName === "stEthPerToken") return 1_050_000_000_000_000_000n;
      if (functionName === "allowance") return 2_000_000_000_000_000_000n; // > 1e18 → approval satisfied
      if (functionName === "getLastRequestId") return 42n;
      return 0n;
    }),
  };
});
```

---

## Shared Patterns

### Ethereum-write-only gate (D-03)
**Source:** `src/tools/prepare_compound_supply.ts` lines 151–168
**Apply to:** `prepare_lido_stake`, `prepare_lido_unstake`, `prepare_lido_wrap`, `prepare_lido_unwrap`
```typescript
if (chainName !== "ethereum") {
  return {
    isError: true,
    content: [{ type: "text", text: `error: invalid 'chain': Lido tools support only 'ethereum', got "${chainName}"` }],
    structuredContent: errEnvelope("CHAIN_ID_MISMATCH", `Lido write operations are Ethereum-only`),
  };
}
```

### Error envelope
**Source:** `src/tools/prepare_weth_unwrap.ts` lines 54–61
**Apply to:** All 4 `prepare_lido_*` tools + `get_lido_positions`
```typescript
function errEnvelope(code: ErrorCode, message: string, cause?: string): Record<string, unknown> & StructuredError {
  return makeStructuredError(code, message, cause) as Record<string, unknown> & StructuredError;
}
```

### PREPARE RECEIPT verbatim relay (CLAUDE.md rule)
**Source:** `src/tools/prepare_weth_unwrap.ts` lines 184–191
**Apply to:** All 4 `prepare_lido_*` tools
```typescript
// Substitution of template slots with agent-supplied raw strings (NOT server-resolved values)
const receipt = LIDO_STAKE_PREPARE_RECEIPT_TEMPLATE
  .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
  .replace("{AMOUNT}", rawAmount);  // rawAmount = args.amount as-is
// Append `from: ${rawFrom}` line ONLY when caller-supplied (Issue #62 pattern)
const finalReceipt = fromCallerSupplied ? `${receipt}\n  from:         ${rawFrom}` : receipt;
```

### Allowance pre-flight INVALID_INPUT + hintTool (D-05)
**Source:** RESEARCH.md Topic 6 pattern (D-05); mirrored in `prepare_compound_supply.ts` intent-gate shape
**Apply to:** `prepare_lido_unstake` (spender = WithdrawalQueue), `prepare_lido_wrap` (spender = wstETH)
```typescript
// structuredContent must include hintTool + hintArgs alongside the errorCode envelope
structuredContent: {
  ...errEnvelope("INVALID_INPUT", `insufficient stETH allowance...`),
  hintTool: "prepare_token_approve",
  hintArgs: { tokenAddress: stethAddr, spender: spenderAddr, amount: formatUnits(amountWei, 18) },
},
```

### payloadFingerprint computation (FROZEN trust pipeline)
**Source:** `src/tools/prepare_weth_unwrap.ts` lines 164–166
**Apply to:** All 4 `prepare_lido_*` tools
```typescript
const payloadFingerprint = computePayloadFingerprint(tx);
```

### ESM spy-affordance indirection (CLAUDE.md convention)
**Source:** `src/security/canonical-dispatch.ts` line 212 (`_canonicalDispatch`)
**Apply to:** `src/protocols/lido.ts` (`_lidoProtocol`), `src/signing/lido-rebase.ts` (`_lidoRebase`), `src/chains/lido.ts` (`_lidoChains`)
```typescript
// At end of each module — wraps exported functions for vi.spyOn interception
export const _lidoProtocol = { encodeLidoSubmit, encodeRequestWithdrawals, encodeWstethWrap, encodeWstethUnwrap };
export const _lidoRebase = { computeRebaseRewards };
export const _lidoChains = { readEthereumPositions, readArbitrumPositions };
```

### SOT address delegation (never inline)
**Source:** `src/protocols/weth9.ts` lines 91–93
**Apply to:** All `prepare_lido_*` tools — `tx.to` from SOT getters only
```typescript
const stethAddr = getLidoStethAddress(chainId);  // NOT hardcoded "0xae7a..."
const wstethAddr = getLidoWstethAddress(chainId);
const wqAddr = getLidoWithdrawalQueueAddress(chainId);
```

### No LEDGER NOTICE block (D-12 — clear-sign confirmed)
**Source:** Phase 7 Aave precedent (no LEDGER NOTICE in `prepare_aave_supply.ts`)
**Apply to:** All 4 `prepare_lido_*` tools — NO `LEDGER_NOTICE_LIDO_TEMPLATE` needed. Contrast with `src/tools/prepare_weth_unwrap.ts` which DOES emit a notice (blind-sign).

---

## No Analog Found

No files in Phase 30 lack a codebase analog. All patterns have direct precedents from Phases 6, 7, 28, and 29.

---

## Extension Point Line Numbers

| File | Insert After | What to Insert |
|---|---|---|
| `src/config/contracts.ts` | Line 348 (end of Morpho Blue SOT section) | `LidoContracts` interface + `LIDO_RAW` + 3 getters |
| `src/config/contracts.ts` | Line 440 (closing brace of Morpho Blue KNOWN_SPENDERS row) | 2 new KNOWN_SPENDERS rows (wstETH + WithdrawalQueue) |
| `src/security/canonical-dispatch.ts` | Lines 60–66 (existing import block) | Add Lido getter imports |
| `src/security/canonical-dispatch.ts` | Line 125–126 (morphoEntries declaration) | Lido entries construction (`lidoEntries`) |
| `src/security/canonical-dispatch.ts` | Line 134 (`...morphoEntries,`) | Add `...lidoEntries,` |
| `src/signing/blocks.ts` | Line 1555 (current end of file) | Phase 30 templates (append-only) |
| `src/tools/register-all.ts` | Line 91 (last Morpho import) | 5 new Lido tool imports |
| `test/signing-fingerprint.test.ts` | After Fixture U block (~line 295) | Fixtures V/W/X/Y `it(...)` blocks |
| `test/config-contracts.test.ts` | After T-29-01-T-FROZEN section (~line 553) | T-LIDO-SPENDER-DRIFT-1 describe block |

---

## Metadata

**Analog search scope:** `src/protocols/`, `src/config/`, `src/security/`, `src/chains/`, `src/signing/`, `src/tools/`, `test/`
**Files scanned:** 14 source files, 5 test files
**Pattern extraction date:** 2026-05-23
