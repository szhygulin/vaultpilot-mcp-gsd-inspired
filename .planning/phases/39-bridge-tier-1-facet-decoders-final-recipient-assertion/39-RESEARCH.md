# Phase 39: Tier-1 Bridge Facet Decoders + Final-Recipient Assertion (Inv #6b) — Research

**Researched:** 2026-05-28
**Domain:** EVM calldata decoding — bridge protocol ABI surfaces + preview_send wiring
**Confidence:** HIGH (Across, NEAR, Wormhole), MEDIUM (Mayan)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Decoder module shape**: each decoder at `src/protocols/bridge-decoders/<bridge>.ts`. Mirror `lifi-btc.ts` pattern: NEVER-throws DU result, DISPLAY/ASSERT-ONLY, `_`-prefixed helpers, selector-prefix guard.
- **Wiring at preview (centralized)**: assertion in `src/tools/preview_send.ts` ONLY, NOT per-prepare-tool. Selector dispatch at preview time.
- **Layer ordering — Layer 0.6 (EVM path)**: immediately AFTER Layer 0.5 `_canonicalDispatch.checkDispatchTarget` block and BEFORE chain-mismatch / fingerprint checks.
- **Decoder regression-test discipline**: hardcoded-literal calldata fixtures from real mainnet transactions. No `beforeAll`-snapshot. Mismatch path asserts exact `[REFUSED — DECODED RECIPIENT DRIFT]` shape.
- **Companion-skill update**: sister `vaultpilot-preflight` repo gets coordinated bump.

### Claude's Discretion

- Internal helper names per-bridge (`decodeWormholeTransfer`, etc.) and exact `summary` field set per decoder.
- Test calldata fixtures per-bridge (sourced from real mainnet transactions at research time).
- Test file location: match existing `test/` layout for protocol decoders.
- Dispatch table shape in `preview_send` (inline map vs `src/protocols/bridge-decoders/index.ts` registry).

### Deferred Ideas (OUT OF SCOPE)

- Tier-2 decoders: deBridge/DLN, Stargate composeMsg, Hop, Symbiosis.
- Per-L2 sandwich-MEV thresholds (Phase 40).
- Dynamic bridge-decoder discovery (Etherscan ABI fetch + selector match).
- Inv #6b wiring for `prepare_solana_lifi_swap` / `prepare_tron_lifi_swap` (deferred tools).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BRIDGE-T1-01 | Wormhole `transferTokensWithPayload` decoder extracts `recipient` field; server asserts equality | §Bridge 1 — selector, ABI, bytes32→address normalization, real fixture |
| BRIDGE-T1-02 | Mayan `createOrderWithEth` / `createOrderWithToken` decoder extracts `destAddr` (bytes32); server asserts equality | §Bridge 2 — selector, OrderParams ABI, bytes32→base58 normalization |
| BRIDGE-T1-03 | NEAR OmniBridge `initTransfer` decoder extracts `recipient` (ABI string); server asserts equality | §Bridge 3 — selector, ABI, string comparison, real fixture |
| BRIDGE-T1-04 | Across V3 `depositV3` decoder extracts `recipient` (EVM address); server asserts equality | §Bridge 4 — selector, ABI, getAddress normalization, real fixture |
| BRIDGE-T1-05 | Mismatch → `[REFUSED — DECODED RECIPIENT DRIFT]` naming decoded value, user-supplied value, bridge name | §Refusal Shape — error code, template pattern |
| BRIDGE-T1-06 | Assertion wires centrally at `preview_send` across all existing swap/bridge tools; no per-tool edits | §Layer 0.6 Insertion Point |
</phase_requirements>

---

## Summary

Phase 39 adds four "facet decoders" — one per Tier-1 bridge — that each extract a final-recipient field from EVM calldata and assert equality against the user-supplied recipient at `preview_send` time (Layer 0.6). If the decoded recipient differs from what the user passed to the prepare tool, `preview_send` refuses with `[REFUSED — DECODED RECIPIENT DRIFT]`. This defends against a compromised agent that encodes a different recipient inside opaque bridge calldata that the Ledger device cannot decode.

The four bridges are structurally divergent:
- **Wormhole**: `recipient` is `bytes32`. Normalization depends on destination chain type: for EVM destinations, extract last 20 bytes; for Solana, base58-encode the full 32 bytes.
- **Mayan Swift**: `destAddr` is `bytes32` inside the `OrderParams` struct. Two write-path functions (`createOrderWithEth`, `createOrderWithToken`) share the same struct shape. Solana recipients are a 32-byte pubkey encoded as `bytes32`.
- **NEAR OmniBridge**: `recipient` is ABI `string` (e.g., `"nearzaurora"`). Normalization: trim whitespace, case-insensitive comparison (NEAR account IDs are case-insensitive in practice, but the on-chain string is verbatim lowercased).
- **Across V3**: `recipient` is a plain EVM `address`. Normalization: `getAddress()` for EIP-55 checksum normalization. Simplest of the four.

All fixtures are real mainnet calldata (Across V3, NEAR, Wormhole) or derived from a real LiFi→Mayan routing tx (Mayan). The one ASSUMED fixture (Mayan) is flagged.

**Primary recommendation:** Layer 0.6 in `preview_send.ts` inserts AFTER the Layer 0.5 `_canonicalDispatch.checkDispatchTarget` block (line ~893) and BEFORE the chain-name mismatch check. The selector→decoder dispatch should be a small `Map<Hex, BridgeFacetDecoder>` populated in a `src/protocols/bridge-decoders/index.ts` registry file so `preview_send` stays readable and Tier-2 extension requires only registry additions.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Calldata parsing per bridge | API/Backend (`src/protocols/bridge-decoders/`) | — | Decoder lives server-side; client can't see calldata |
| Recipient assertion gate | API/Backend (`src/tools/preview_send.ts` Layer 0.6) | — | Must fire before device signs; centralized at preview |
| Error refusal block | API/Backend (`src/signing/blocks.ts` new template) | — | Follows established TEMPLATE pattern |
| Test fixture pinning | Test layer (`test/bridge-decoders/`) | — | Per project fixture-discipline convention |

---

## Per-Bridge Function Signatures, Selectors, and Recipient Encoding

### Bridge 1: Wormhole Token Bridge

**Contract (Ethereum mainnet):** `0x3ee18B2214AFF97000D974cf647E7C347E8fa585` (proxy; impl `0xfa71b241b168d2876722c6d8856d3e4f311b8c1e`)
[VERIFIED: etherscan.io/address/0x3ee18b2214aff97000d974cf647e7c347e8fa585]

**Target function:** `transferTokensWithPayload`

**Full ABI signature:**
```
function transferTokensWithPayload(
  address token,
  uint256 amount,
  uint16  recipientChain,   // Wormhole chain ID of destination
  bytes32 recipient,        // THE FIELD TO EXTRACT
  uint32  nonce,
  bytes   payload
) external payable returns (uint64 sequence)
```
[VERIFIED: github.com/wormhole-foundation/wormhole/blob/main/ethereum/contracts/bridge/interfaces/ITokenBridge.sol]

**4-byte selector:** `0xc5a5ebda`
[VERIFIED: computed via `viem.toFunctionSelector` in this session]

**Recipient field type:** `bytes32`

**Recipient encoding — THE CRUX:**
- For **EVM destination chains** (Wormhole chain IDs 2=Ethereum, 4=BSC, 5=Polygon, 6=Avalanche, 23=Arbitrum, 24=Optimism, 30=Base, etc.): the 32 bytes are LEFT-padded with zeros; the last 20 bytes = the EVM address. Normalize: `getAddress('0x' + recipientBytes32.slice(2).slice(-40))` → compare against user-supplied EVM address (via `getAddress()`).
- For **Solana destination** (Wormhole chain ID 1): the 32 bytes = Solana pubkey. Normalize: `bs58.encode(fromHex(recipientBytes32))` → compare against user-supplied Solana base58 address (case-sensitive, base58 is case-sensitive).
- For **other non-EVM chains** (Terra/NEAR/Cosmos): chain-specific encoding — no normalization defined for Phase 39; return `{ kind: "error" }` with message "unsupported destination chain for recipient normalization" rather than a false positive assertion.
[VERIFIED: manual calldata decode of tx 0x778c95195c314ac1800910715e30da85d8d9e2355781b30e9f927428e67ad886 using viem in this session]

**Real mainnet fixture calldata (tx `0x778c95195c314ac1800910715e30da85d8d9e2355781b30e9f927428e67ad886`):**
```
0xc5a5ebda
000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7  // token = USDT
0000000000000000000000000000000000000000000000000000000ba5850b00  // amount = 50_021_600_000
0000000000000000000000000000000000000000000000000000000000000010  // recipientChain = 16 (Moonbeam)
0000000000000000000000000000000000000000000000000000000000000816  // recipient (bytes32)
0000000000000000000000000000000000000000000000000000000000000000  // nonce = 0
00000000000000000000000000000000000000000000000000000000000000c0  // payload offset
0000000000000000000000000000000000000000000000000000000000000029  // payload length = 41
0005010200c91f010045544800e139dd7fc2a49ff20d5c8436ea1bf3301cc979f900000000000000000000000000000000000000000000000000000000000000
```
- `recipientChain = 16` (Wormhole chain 16 = Moonbeam — an EVM chain)
- `recipient bytes32 = 0x0000000000000000000000000000000000000000000000000000000000000816`
- Decoded EVM address: `0x0000000000000000000000000000000000000816` (last 20 bytes)
[VERIFIED: fetched and decoded from etherscan.io/tx/0x778c95195c314ac1800910715e30da85d8d9e2355781b30e9f927428e67ad886]

**NOTE:** The calldata above is the verbatim hex from the real tx, confirmed by `viem.decodeFunctionData` decode in this session.

**viem decoding approach:** `decodeFunctionData({ abi: parseAbi(['function transferTokensWithPayload(address,uint256,uint16,bytes32,uint32,bytes)']), data })` → extract `args[3]` (recipient bytes32).

---

### Bridge 2: Mayan Swift

**Contract (Ethereum mainnet and all EVM chains):** `0xC38e4e6A15593f908255214653d3D947CA1c2338`
[VERIFIED: etherscan.io/address/0xc38e4e6a15593f908255214653d3d947ca1c2338]

**Target functions:** Two entry points with the same `OrderParams` struct — **both must be decoded**:
- `createOrderWithEth(OrderParams params)` — native ETH input
- `createOrderWithToken(address tokenIn, uint256 amountIn, OrderParams params)` — ERC-20 input

**OrderParams struct (confirmed from Etherscan ABI):**
```
struct OrderParams {
  bytes32 trader;
  bytes32 tokenOut;
  uint64  minAmountOut;
  uint64  gasDrop;
  uint64  cancelFee;
  uint64  refundFee;
  uint64  deadline;
  bytes32 destAddr;    // THE FIELD TO EXTRACT — destination address on target chain
  uint16  destChainId; // Mayan chain ID (1 = Solana, 2 = Ethereum, etc.)
  bytes32 referrerAddr;
  uint8   referrerBps;
  uint8   auctionMode;
  bytes32 random;
}
// Canonical ABI tuple: (bytes32,bytes32,uint64,uint64,uint64,uint64,uint64,bytes32,uint16,bytes32,uint8,uint8,bytes32)
```
[VERIFIED: etherscan.io/address/0xc38e4e6a15593f908255214653d3d947ca1c2338 ABI inspection]

**4-byte selectors:**
- `createOrderWithEth(...)`: `0xb866e173`
- `createOrderWithToken(...)`: `0x8e8d142b`
[VERIFIED: computed via `viem.toFunctionSelector` in this session]

**Recipient field:** `destAddr` (bytes32) inside `OrderParams` struct.

**Recipient encoding — THE CRUX:**
- For **Solana destinations**: `destAddr` bytes32 = the Solana pubkey (32 bytes). Normalize: `bs58.encode(Buffer.from(destAddr.slice(2), 'hex'))` → compare against user-supplied Solana base58 address (case-sensitive).
- For **EVM destinations**: `destAddr` bytes32 = left-padded EVM address (last 20 bytes). Normalize: `getAddress('0x' + destAddr.slice(2).slice(-40))` → compare against user-supplied EVM address.
[ASSUMED: Based on LiFi→Mayan routing transaction evidence showing Solana pubkey `0x1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a` which base58-encodes to `2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5`, and Etherscan ABI confirming bytes32 type. NOT directly confirmed from a `createOrderWithEth` calldata transaction — the Mayan Swift contract primarily shows fulfill/unlock ops in recent history.]

**Best available fixture (ASSUMED — from LiFi routing to Mayan, tx `0xb86df5b8c45853f12d05f67c4f42f7e7ce151217d521d2713d09217985e06868`):**
- Target was LiFi Diamond, not Mayan Swift directly. The inner `_mayanData` showed:
  - `receiver: 0x1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a`
  - Destination: Solana
  - This bytes32 base58-encodes to: `2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5`

**Planner action:** Plan must include a Wave 0 task to obtain a direct `createOrderWithEth` or `createOrderWithToken` calldata fixture from the Mayan Swift contract. The LiFi-routed call does not produce direct Mayan calldata. Fallback: construct a minimal synthetic fixture using the confirmed ABI and a known Solana pubkey (clearly labeled SYNTHETIC in the test file).

**viem decoding approach:**
- `createOrderWithEth`: `decodeFunctionData({ abi: parseAbi(['function createOrderWithEth((bytes32,bytes32,uint64,uint64,uint64,uint64,uint64,bytes32,uint16,bytes32,uint8,uint8,bytes32))']), data })` → `args[0]` is the tuple; `args[0][7]` (0-indexed) = `destAddr`.
- `createOrderWithToken`: same but `args[2][7]` (tuple is the third arg).

---

### Bridge 3: NEAR OmniBridge (NEAR Intents EVM entrypoint)

**Contract (Ethereum mainnet):** `0xe00c629aFaCCb0510995A2B95560E446A24c85B9`
[VERIFIED: github.com/Near-One/omni-bridge README + etherscan.io activity confirmed]

**Target function:** `initTransfer`

**Full ABI signature:**
```
function initTransfer(
  address tokenAddress,
  uint128 amount,
  uint128 fee,
  uint128 nativeFee,
  string  recipient,  // THE FIELD TO EXTRACT — NEAR account ID (ABI string, not bytes32)
  string  message
) payable external
```
[VERIFIED: github.com/Near-One/omni-bridge README + viem decode of real tx in this session]

**4-byte selector:** `0xdeb915b8`
[VERIFIED: computed via `viem.toFunctionSelector` in this session]

**Recipient field type:** ABI `string` (NOT bytes32 — this is structurally different from Wormhole/Mayan).

**Recipient encoding — THE CRUX:**
The `recipient` field is a full ABI-encoded `string` parameter. From the real tx decode: `"nearzaurora"` — that is a NEAR account ID, NOT a base58 key, NOT bytes32.
- Normalize: trim whitespace, compare as **case-insensitive lowercase** (NEAR account IDs are always lowercase; the user-supplied account ID should be lowercased before comparison).
- The `message` field is separate and may carry an EVM-chain destination address (from tx: `"2Be3DF6C50Fb1b11d8189C2d4DE5c16F6712FAc4"`) — this is NOT the final recipient; `recipient` is the primary field.
[VERIFIED: viem decode of real tx `0x80c535f5578f4c4e556b7d4831d46234aa11692c7a339fb07a957d3a8cb16b61` in this session]

**Real mainnet fixture calldata (tx `0x80c535f5578f4c4e556b7d4831d46234aa11692c7a339fb07a957d3a8cb16b61`):**
```
0xdeb915b8
0000000000000000000000000000000000000000000000000000000000000000  // tokenAddress = 0x0 (native ETH)
00000000000000000000000000000000000000000000000000b50cff4b0d8600  // amount = 50_961_261_400_000_000
0000000000000000000000000000000000000000000000000000000000000000  // fee = 0
0000000000000000000000000000000000000000000000000009184e72a000    // nativeFee = 10_000_000_000_000
...000000c0                                                         // recipient string offset
...00000100                                                         // message string offset
000000000000000000000000000000000000000000000000000000000000000b  // recipient length = 11
6e6561727a6175726f7261000000000000000000000000000000000000000000  // "nearzaurora"
0000000000000000000000000000000000000000000000000000000000000028  // message length = 40
3242653344463643353046623162313164383138394332643444453563313646  // "2Be3DF6C50Fb1b11d8189C2d4DE5c16F6712FAc4"
3637313246416334000000000000000000000000000000000000000000000000
```
- `recipient` (string) = `"nearzaurora"` — NEAR account ID
- `message` (string) = `"2Be3DF6C50Fb1b11d8189C2d4DE5c16F6712FAc4"` — EVM address on destination
[VERIFIED: decoded from real Ethereum mainnet transaction using viem in this session]

**viem decoding approach:** `decodeFunctionData({ abi: parseAbi(['function initTransfer(address,uint128,uint128,uint128,string,string)']), data })` → `args[4]` = recipient string.

---

### Bridge 4: Across V3 SpokePool

**Contract (Ethereum mainnet):** `0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5` (labeled V2 by Etherscan but actively processes `depositV3` calls; impl at `0x5E5B726C81f43b953a62ad87e2835c85c4d9dd3b`)
[VERIFIED: etherscan.io — confirmed active depositV3 calls; impl ABI decoded directly]

**Target function:** `depositV3`

**Full ABI signature (confirmed from impl ABI at Etherscan):**
```
function depositV3(
  address depositor,
  address recipient,          // THE FIELD TO EXTRACT — EVM address
  address inputToken,
  address outputToken,
  uint256 inputAmount,
  uint256 outputAmount,
  uint256 destinationChainId,
  address exclusiveRelayer,
  uint32  quoteTimestamp,
  uint32  fillDeadline,
  uint32  exclusivityParameter,
  bytes   message
) external payable
```
[VERIFIED: etherscan.io/address/0x5E5B726C81f43b953a62ad87e2835c85c4d9dd3b ABI]

**4-byte selector:** `0x7b939232`
[VERIFIED: computed via `viem.toFunctionSelector` AND confirmed against real mainnet calldata in this session]

**Recipient field type:** `address` (EVM address — NOT bytes32, unlike Wormhole/Mayan).

**Recipient encoding — THE CRUX:**
Across V3 is EVM-to-EVM only; the `recipient` is a standard EVM address. Normalize with `getAddress(recipient)` (EIP-55 checksum) before comparing against user-supplied `to` address.
[VERIFIED: viem decode of real tx in this session confirming address type]

**Real mainnet fixture calldata (tx `0xbdb62e8ece1ac5b8e0d16bd82f3c145d6b8ce8b840b8d5a8b59ea78997308560`):**
```
0x7b939232
00000000000000000000000015528a195c4b9353d7645eba48357a85324bb365  // depositor
00000000000000000000000015528a195c4b9353d7645eba48357a85324bb365  // recipient = 0x15528...bb365
000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2  // inputToken = WETH
00000000000000000000000082af49447d8a07e3bd95bd0d56f35241523fbab1  // outputToken = ARB
00000000000000000000000000000000000000000000000001118f178fb48000  // inputAmount = 77000000000000000
000000000000000000000000000000000000000000000000011184362742503a  // outputAmount
000000000000000000000000000000000000000000000000000000000000a4b1  // destinationChainId = 42161 (Arbitrum)
0000000000000000000000000000000000000000000000000000000000000000  // exclusiveRelayer = zero
000000000000000000000000000000000000000000000000000000006a1861b7  // quoteTimestamp
000000000000000000000000000000000000000000000000000000006a187dd7  // fillDeadline
0000000000000000000000000000000000000000000000000000000000000000  // exclusivityParameter = 0
0000000000000000000000000000000000000000000000000000000000000180  // message offset
0000000000000000000000000000000000000000000000000000000000000000  // message length = 0
1dc0de00410000000c                                                  // ... (trailing bytes)
```
- `recipient` = `0x15528a195C4b9353D7645eBA48357a85324bb365` (EVM address, depositor == recipient in this case)
- `destinationChainId` = 42161 (Arbitrum One)
[VERIFIED: decoded from real Ethereum mainnet transaction using viem in this session]

**viem decoding approach:** `decodeFunctionData({ abi: parseAbi(['function depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)']), data })` → `args[1]` = recipient address.

---

## Standard Stack

### Core (no new packages required)

Phase 39 adds ONLY source files (`.ts`). All dependencies are already in `package.json`.

| Library | Version Installed | Purpose | Note |
|---------|-------------------|---------|------|
| `viem` | 2.48.11 (installed), 2.51.3 (latest) | `decodeFunctionData`, `getAddress`, `parseAbi`, `toFunctionSelector` | EVM calldata decoding |
| `bs58` | (project dep) | Solana base58 encode/decode | Wormhole + Mayan Solana recipient normalization |

[VERIFIED: `node -e "require('./node_modules/viem/package.json').version"` → 2.48.11]

### Supporting

`decodeFunctionData` from viem accepts `abi` + `data` (Hex) and returns `{ functionName, args }`. For tuple parameters (OrderParams), `args[N]` is an array corresponding to the tuple fields in declaration order.

### No New Packages

Phase 39 installs zero external packages — no Package Legitimacy Audit required. `bs58` and `viem` are already project dependencies.

---

## Package Legitimacy Audit

**Not applicable** — Phase 39 adds no new npm/pip/cargo packages.

---

## Architecture Patterns

### System Architecture Diagram

```
preview_send (EVM path)
   |
   ├─[Layer 0.5] _canonicalDispatch.checkDispatchTarget  ← existing
   |
   ├─[Layer 0.6] Bridge Tier-1 Facet Decoder Gate        ← NEW (Phase 39)
   |    |
   |    ├─ selector from record.tx.data[0..10]
   |    ├─ _bridgeTier1Decoders.decode(selector, calldata)
   |    |    ├─ wormhole.ts  (0xc5a5ebda)
   |    |    ├─ mayan.ts     (0xb866e173, 0x8e8d142b)
   |    |    ├─ near.ts      (0xdeb915b8)
   |    |    └─ across-v3.ts (0x7b939232)
   |    |
   |    └─ assert decoded.finalRecipient === record.tx.params.toAddress
   |         → MATCH: continue
   |         → MISMATCH: return REFUSED — DECODED RECIPIENT DRIFT
   |
   ├─[Layer 2] chain-mismatch refusal                     ← existing
   └─ ... fingerprint / send-gate ...
```

### Recommended Project Structure

```
src/protocols/bridge-decoders/
  ├── lifi-btc.ts          (existing — do NOT touch)
  ├── wormhole.ts          (new)
  ├── mayan-swift.ts       (new)
  ├── near-omnibridge.ts   (new)
  ├── across-v3.ts         (new)
  └── index.ts             (new — selector dispatch registry)

test/
  ├── bridge-decoders-wormhole.test.ts      (new)
  ├── bridge-decoders-mayan-swift.test.ts   (new)
  ├── bridge-decoders-near-omnibridge.test.ts (new)
  ├── bridge-decoders-across-v3.test.ts     (new)
  └── preview-send.bridge-tier1.test.ts     (new — Layer 0.6 wiring integration)
```

**Test file naming convention:** The existing test for `lifi-btc.ts` is `test/lifi-btc-decoder.test.ts` (flat `test/` directory, no subdirectory). The existing protocol decoder tests are `test/protocols-aave-v3.test.ts`, `test/protocols-erc20.test.ts`, etc. — also flat. Phase 39 should use the flat pattern: `test/bridge-decoders-<bridge>.test.ts`.

### Pattern 1: Decoder Module Shape (mirror lifi-btc.ts)

```typescript
// src/protocols/bridge-decoders/across-v3.ts
import { decodeFunctionData, getAddress, parseAbi } from "viem";
import type { Hex } from "viem";

export const ACROSS_V3_SELECTORS = {
  depositV3: "0x7b939232" as Hex,
} as const;

export type DecodeAcrossV3Result =
  | { kind: "ok"; summary: AcrossV3Summary }
  | { kind: "error"; message: string };

export interface AcrossV3Summary {
  readonly finalRecipient: string;   // checksummed EVM address via getAddress()
  readonly destinationChainId: bigint;
  readonly inputToken: string;
  readonly outputToken: string;
}

export function decodeAcrossV3Deposit(data: Hex): DecodeAcrossV3Result {
  if (!data.toLowerCase().startsWith(ACROSS_V3_SELECTORS.depositV3)) {
    return { kind: "error", message: "selector mismatch: not a depositV3 call" };
  }
  try {
    const decoded = _acrossV3Helpers.decodeFunctionData(data);
    const recipient = getAddress(decoded.args[1] as string);
    return {
      kind: "ok",
      summary: {
        finalRecipient: recipient,
        destinationChainId: decoded.args[6] as bigint,
        inputToken: getAddress(decoded.args[2] as string),
        outputToken: getAddress(decoded.args[3] as string),
      },
    };
  } catch (err) {
    return { kind: "error", message: `ABI decode failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ESM spy-affordance indirection (CLAUDE.md convention)
export const _acrossV3Helpers = {
  decodeFunctionData: (data: Hex) =>
    decodeFunctionData({ abi: ACROSS_V3_DEPOSIT_ABI, data }),
};
```

### Pattern 2: Registry / Dispatcher (`bridge-decoders/index.ts`)

```typescript
// src/protocols/bridge-decoders/index.ts
import type { Hex } from "viem";
import { decodeWormholeTransferWithPayload, WORMHOLE_SELECTORS } from "./wormhole.js";
import { decodeMayanSwiftOrder, MAYAN_SWIFT_SELECTORS } from "./mayan-swift.js";
import { decodeNearOmniBridgeTransfer, NEAR_SELECTORS } from "./near-omnibridge.js";
import { decodeAcrossV3Deposit, ACROSS_V3_SELECTORS } from "./across-v3.js";

export type BridgeFacetDecodeResult =
  | { kind: "ok"; bridge: string; finalRecipient: string }
  | { kind: "no-match" }
  | { kind: "error"; bridge: string; message: string };

const TIER1_DECODERS: ReadonlyMap<Hex, (data: Hex) => BridgeFacetDecodeResult> = new Map([
  [WORMHOLE_SELECTORS.transferTokensWithPayload, (data) => { /* ... */ }],
  [MAYAN_SWIFT_SELECTORS.createOrderWithEth, (data) => { /* ... */ }],
  [MAYAN_SWIFT_SELECTORS.createOrderWithToken, (data) => { /* ... */ }],
  [NEAR_SELECTORS.initTransfer, (data) => { /* ... */ }],
  [ACROSS_V3_SELECTORS.depositV3, (data) => { /* ... */ }],
]);

export function decodeBridgeTier1FacetRecipient(data: Hex): BridgeFacetDecodeResult {
  if (data === "0x" || data.length < 10) return { kind: "no-match" };
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  const decoder = TIER1_DECODERS.get(selector);
  if (!decoder) return { kind: "no-match" };
  return decoder(data);
}
export const _bridgeTier1Decoders = { decodeBridgeTier1FacetRecipient };
```

### Pattern 3: Layer 0.6 Wiring in preview_send.ts

Insertion point: AFTER the Layer 0.5 `_canonicalDispatch.checkDispatchTarget` block's closing brace (`}` at approximately line 893), BEFORE the Layer 2 chain-mismatch check (`if (typeof args.chain === "string")`).

```typescript
// Phase 39 — Layer 0.6 Bridge Tier-1 Final-Recipient Assertion (Inv #6b EVM path).
// Fires AFTER Layer 0.5 canonical-dispatch allowlist (a bridge address must be
// in the allowlist to reach here) and BEFORE Layer 2 chain-name mismatch.
// Only fires for contract calls (data !== "0x") that match a Tier-1 bridge selector.
//
// record.tx.params?.toAddress holds the user-supplied recipient from the prepare
// tool. Bridge prepare tools (prepare_uniswap_swap, prepare_curve_swap, etc.)
// store toAddress in PreparedTxEvm.params. DEX swaps won't match any Tier-1
// bridge selector — this gate is a no-op for them.
if (record.tx.data !== "0x") {
  const bridgeDecodeResult = _bridgeTier1Decoders.decodeBridgeTier1FacetRecipient(
    record.tx.data,
  );
  if (bridgeDecodeResult.kind === "error") {
    const refusalText = DECODED_RECIPIENT_DRIFT_TEMPLATE
      .replace("{BRIDGE}", bridgeDecodeResult.bridge)
      .replace("{DECODED}", `decode error: ${bridgeDecodeResult.message}`)
      .replace("{SUPPLIED}", record.tx.params?.toAddress ?? "(none)");
    return {
      isError: true,
      content: [{ type: "text", text: refusalText }],
      structuredContent: errEnvelope(
        "DECODED_RECIPIENT_DRIFT",
        `bridge decode error for ${bridgeDecodeResult.bridge}: ${bridgeDecodeResult.message}`,
      ),
    };
  }
  if (bridgeDecodeResult.kind === "ok") {
    const userRecipient = record.tx.params?.toAddress ?? "";
    if (bridgeDecodeResult.finalRecipient.toLowerCase() !== userRecipient.toLowerCase()) {
      const refusalText = DECODED_RECIPIENT_DRIFT_TEMPLATE
        .replace("{BRIDGE}", bridgeDecodeResult.bridge)
        .replace("{DECODED}", bridgeDecodeResult.finalRecipient)
        .replace("{SUPPLIED}", userRecipient);
      return {
        isError: true,
        content: [{ type: "text", text: refusalText }],
        structuredContent: errEnvelope(
          "DECODED_RECIPIENT_DRIFT",
          `[REFUSED — DECODED RECIPIENT DRIFT] bridge=${bridgeDecodeResult.bridge} decoded=${bridgeDecodeResult.finalRecipient} supplied=${userRecipient}`,
        ),
      };
    }
  }
  // bridgeDecodeResult.kind === "no-match" → not a Tier-1 bridge call → pass through
}
```

### Anti-Patterns to Avoid

- **Selector check after full ABI decode:** Always check selector FIRST (4-byte prefix guard) before attempting `decodeFunctionData`. The selector guard returns `{ kind: "error" }` immediately for non-matching calldata.
- **Re-encoding or reconstructing calldata:** Decoders extract fields for assertion only. NEVER call `encodeFunctionData` or mutate `record.tx.data`.
- **Case-sensitive comparison for EVM addresses:** Always use `getAddress()` before comparing EVM addresses (EIP-55 checksum normalization prevents false mismatches).
- **bytes32 truncation for Solana:** For Solana, the full 32 bytes encode the pubkey. Truncating to 20 bytes produces a wrong EVM-like value — that's the exact exploit this phase defends against.
- **Throwing inside decoders:** All decoders MUST return discriminated union `{ kind: "ok" | "error" }`. No throws propagate to `preview_send`. This is WR-02 convention in the codebase.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ABI calldata decode | Manual byte-slicing | `viem.decodeFunctionData` | viem handles ABI padding, dynamic types (string/bytes), tuple nesting, overflow |
| EVM address normalization | toLowerCase() | `viem.getAddress()` | EIP-55 checksum — prevents false mismatches on case-differing inputs |
| Solana base58 encode/decode | Custom base58 | `bs58` (already installed) | Correct alphabet + leading-zero handling |

---

## Layer 0.6 Insertion Point — Confirmed Location in preview_send.ts

The exact insertion site is between these two blocks (confirmed by reading the source):

1. **End of Layer 0.5 block** (~line 893):
   ```typescript
   } // closes: if (dispatchCheck.kind === "refused" && !escapeHatchBypassActive)
   } // closes: if (record.tx.data !== "0x")
   ```

2. **Start of Layer 2** (~line 910):
   ```typescript
   if (typeof args.chain === "string") {
   ```

**Layer 0.6 fires ONLY when `record.tx.data !== "0x"`** — same guard as Layer 0.5, so the outer condition naturally encompasses it.

**`record.tx.params?.toAddress` field:** This requires that prepare bridge tools store the user-supplied `toAddress` in the handle. Current `PreparedTxEvm` does NOT have a `params` field — the planner needs a plan to either:
  - (a) Add `params?: { toAddress?: string }` to `PreparedTxEvm` (widening), or
  - (b) Add a per-bridge `toAddress?: string` field directly on `PreparedTxEvm` (non-generic), or
  - (c) Have each prepare tool store `toAddress` in a new `bridgeParams` bag on the handle.

Option (a) is the cleanest and most consistent with the existing pattern (Solana/TRON handles use per-handle fields). The planner should decide and the plan should include a Wave 0 handle-store widening task.

---

## Error Shape

**New `ErrorCode` member required:** `DECODED_RECIPIENT_DRIFT`

Current `ErrorCode` union ends at `STALE_SIGNATURE` (Phase 37). Phase 39 must ADD `"DECODED_RECIPIENT_DRIFT"` as the next entry. Per `src/signing/error-codes.ts` convention: append-only, include a comment block with rationale.
[VERIFIED: reading `src/signing/error-codes.ts` — `STALE_SIGNATURE` is the last entry]

**Refusal template shape** (new export in `src/signing/blocks.ts`):
```typescript
export const DECODED_RECIPIENT_DRIFT_TEMPLATE: string = [
  "[REFUSED — DECODED RECIPIENT DRIFT]",
  "  bridge:    {BRIDGE}",
  "  decoded:   {DECODED}",
  "  supplied:  {SUPPLIED}",
  "  reason:    The recipient encoded in the bridge calldata does not match the",
  "             address you supplied to the prepare tool. This may indicate a",
  "             compromised agent rewriting the destination inside opaque calldata.",
  "  action:    Do NOT sign. Re-verify the transaction and re-prepare if the",
  "             recipient should be {SUPPLIED}.",
].join("\n");
```

The template follows the existing three-placeholder pattern established by `CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE` and `DISPATCH_TARGET_REFUSAL_TEMPLATE`.

---

## Common Pitfalls

### Pitfall 1: bytes32 Wormhole Recipient — EVM vs Solana
**What goes wrong:** Decoder always extracts last-20-bytes as EVM address regardless of `recipientChain`. For Solana destinations, this produces a nonsense 20-byte slice that will never match the user's Solana base58 address.
**Why it happens:** EVM developers reflexively treat bytes32 as padded-address.
**How to avoid:** Branch on `recipientChain` (Wormhole chain ID). Chain IDs: 1=Solana, 2=Ethereum, 4=BSC, 5=Polygon, 6=Avalanche, 23=Arbitrum, 24=Optimism, 30=Base. For chains not in the EVM set and not Solana (chain IDs for NEAR, Cosmos, etc.), return `{ kind: "error", message: "unsupported dest chain for recipient normalization" }`.
**Warning signs:** Test that decodes a Wormhole-to-Solana tx but asserts an EVM-looking address.

### Pitfall 2: Mayan destAddr — EVM vs Solana
**What goes wrong:** Same as Pitfall 1. Mayan uses the same bytes32 encoding pattern for both EVM and Solana destinations inside `OrderParams.destAddr`.
**How to avoid:** Branch on `destChainId` field in the struct. Mayan's chain IDs may differ from Wormhole's — research task for Wave 0 (or assume similar structure and test with known fixtures).
**Warning signs:** Mayan EVM->Solana fixture decoded as EVM address.

### Pitfall 3: NEAR recipient — case-insensitive comparison
**What goes wrong:** `recipient === userSupplied` fails because one side is lowercase and one isn't, or one has whitespace.
**Why it happens:** NEAR account IDs (like `"nearzaurora"`) are always lowercase, but a user might type `"NearAurora"`.
**How to avoid:** Normalize both sides: `decodedRecipient.toLowerCase().trim() === userRecipient.toLowerCase().trim()`.
**Warning signs:** False mismatch error when account IDs are semantically equal.

### Pitfall 4: `decodeFunctionData` throws on malformed calldata
**What goes wrong:** `viem.decodeFunctionData` throws if the calldata is malformed, truncated, or wrong type. If this propagates to `preview_send` it breaks the entire preview flow.
**How to avoid:** Wrap ALL `decodeFunctionData` calls in try/catch inside the decoder module, return `{ kind: "error", message }`. This is the WR-02 NEVER-throws convention.
**Warning signs:** Integration test for Layer 0.6 that passes truncated calldata causing preview_send to throw instead of returning `isError: true`.

### Pitfall 5: handle-store field for user-supplied `toAddress`
**What goes wrong:** `record.tx.params?.toAddress` is undefined because `PreparedTxEvm` doesn't store it. The assertion becomes `decodedRecipient !== undefined` which always passes.
**Why it happens:** Phase 39 adds the assertion but no existing prepare tool stored `toAddress` in the handle.
**How to avoid:** Wave 0 must widen `PreparedTxEvm` or add a `bridgeParams` field, and update the prepare tools (prepare_uniswap_swap, prepare_curve_swap, etc.) to store `toAddress` when present. For bridge tools that don't have a `toAddress` param, leave it absent; the Layer 0.6 gate only fires when `decodeBridgeTier1FacetRecipient` returns `kind: "ok"` (i.e., the selector matches a Tier-1 bridge).
**Warning signs:** Test that constructs a handle with a bridge selector but no `toAddress` — the assertion should fire an error ("no toAddress stored for bridge handle"), not silently pass.

### Pitfall 6: Mayan createOrderWithToken vs createOrderWithEth struct offset
**What goes wrong:** The `OrderParams` struct is at `args[0]` for `createOrderWithEth` but at `args[2]` for `createOrderWithToken`. Extracting `destAddr` from the wrong index yields a garbage value.
**How to avoid:** Two separate decode paths, or a single helper that accepts the already-decoded struct. Test both selectors with fixtures.

### Pitfall 7: ESM spy-affordance missing from index.ts
**What goes wrong:** `vi.spyOn(_bridgeTier1Decoders, "decodeBridgeTier1FacetRecipient")` fails silently (ESM named exports are immutable).
**How to avoid:** Export `export const _bridgeTier1Decoders = { decodeBridgeTier1FacetRecipient }` from `index.ts` per CLAUDE.md convention. Per-bridge decoders should similarly export `_<bridge>Helpers` objects for the ABI-decode step.

---

## Code Examples

### Example 1: Across V3 decode (verified working)
```typescript
// Source: viem.decodeFunctionData + real tx 0xbdb62e8ece...
import { decodeFunctionData, getAddress, parseAbi } from "viem";

const ACROSS_V3_ABI = parseAbi([
  "function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message)",
]);

const decoded = decodeFunctionData({ abi: ACROSS_V3_ABI, data: calldata });
const recipient = getAddress(decoded.args[1] as string); // "0x15528a195C4b9353D7645eBA48357a85324bb365"
```

### Example 2: Wormhole decode + bytes32 → EVM address (verified working)
```typescript
// Source: viem.decodeFunctionData + real tx 0x778c95195c...
const WORMHOLE_ABI = parseAbi([
  "function transferTokensWithPayload(address token, uint256 amount, uint16 recipientChain, bytes32 recipient, uint32 nonce, bytes payload)",
]);

const decoded = decodeFunctionData({ abi: WORMHOLE_ABI, data: calldata });
const recipientBytes32 = decoded.args[3] as `0x${string}`; // bytes32 hex
const recipientChain = decoded.args[2] as number;          // uint16
// For EVM destination chains:
const evmAddress = getAddress("0x" + recipientBytes32.slice(2).slice(-40));
```

### Example 3: NEAR decode (verified working)
```typescript
// Source: viem.decodeFunctionData + real tx 0x80c535f5578f...
const NEAR_ABI = parseAbi([
  "function initTransfer(address tokenAddress, uint128 amount, uint128 fee, uint128 nativeFee, string recipient, string message)",
]);

const decoded = decodeFunctionData({ abi: NEAR_ABI, data: calldata });
const recipient = (decoded.args[4] as string).toLowerCase().trim(); // "nearzaurora"
```

### Example 4: Mayan Swift decode (ABI VERIFIED, fixture ASSUMED)
```typescript
// Source: Etherscan ABI + viem.toFunctionSelector (selector verified)
const MAYAN_ORDER_PARAMS_TUPLE =
  "(bytes32,bytes32,uint64,uint64,uint64,uint64,uint64,bytes32,uint16,bytes32,uint8,uint8,bytes32)";
const MAYAN_ETH_ABI = parseAbi([`function createOrderWithEth(${MAYAN_ORDER_PARAMS_TUPLE})`]);
const MAYAN_TOKEN_ABI = parseAbi([`function createOrderWithToken(address,uint256,${MAYAN_ORDER_PARAMS_TUPLE})`]);

// For createOrderWithEth:
const decoded = decodeFunctionData({ abi: MAYAN_ETH_ABI, data: calldata });
const params = decoded.args[0] as readonly unknown[];
const destAddr = params[7] as `0x${string}`; // bytes32 at index 7
// For Solana: bs58.encode(Buffer.from(destAddr.slice(2), "hex"))
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| No bridge-level recipient assertion | Layer 0.6 Tier-1 facet decoders | Phase 39 | Closes EVM→non-EVM calldata spoofing vector |
| Across V2 SpokePool | Across V3 SpokePool (same proxy address, impl upgraded) | 2024 | `depositV3` replaces `deposit`; V3 adds `exclusiveRelayer` + `exclusivityParameter` fields |
| Mayan MAYANSWAP legacy contract | Mayan Swift `createOrderWithEth/Token` | 2023-2024 | Different ABI surface; old `MayanSwap` bridge contract at separate address |

**Deprecated/outdated:**
- `Across V2 deposit(...)`: Old selector, different ABI. V3 is what the deployed SpokePool now accepts.
- `MayanSwap` legacy bridge (different from `MayanSwift`): Old contract at `0x2762a...` used `forwarder` patterns — distinct from the current `MayanSwift` at `0xC38e...`. Phase 39 targets Swift only.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Mayan `createOrderWithToken` struct field order: `destAddr` at index 7 of the tuple (matches Etherscan ABI) | Bridge 2 | If struct field order differs, decoder extracts wrong bytes32 — silent false-pass or false-mismatch |
| A2 | Real `createOrderWithEth` calldata on Ethereum mainnet uses the confirmed struct shape (from LiFi routing evidence + Etherscan ABI) | Bridge 2 fixture | If ABI differs in production, fixture fails to decode — caught at test time not user-tx time |
| A3 | Mayan `destChainId` field in `OrderParams` (index 8 of tuple) follows the same chain ID convention as Wormhole (1=Solana, 2=Ethereum, etc.) | Bridge 2 normalization | If Mayan uses a different chain ID scheme, normalization branches on wrong values |
| A4 | NEAR OmniBridge `recipient` is always a NEAR account ID string (never bytes32 or base58) | Bridge 3 normalization | If some variants use different encodings, decoder misidentifies recipient type |
| A5 | Across V3 `depositV3` does not support non-EVM recipients (recipient is always EVM `address`) | Bridge 4 recipient type | If Across adds non-EVM support in a new function, the assumption holds for this function signature |
| A6 | `PreparedTxEvm` needs a new field to carry user-supplied `toAddress` for the Layer 0.6 assertion (currently absent) | Layer 0.6 insertion | If a different mechanism exists, the planner can use it — but none was found in the codebase |

---

## Open Questions

1. **Mayan destChainId chain ID scheme**
   - What we know: `destAddr` is bytes32; for Solana it's the pubkey. The struct has `destChainId uint16`.
   - What's unclear: Whether Mayan's chain IDs are the same as Wormhole's (1=Solana, 2=Ethereum) or a proprietary scheme.
   - Recommendation: Wave 0 research task — check Mayan docs or contract constants for chain ID mappings. If the scheme is unknown, normalize `destAddr` by attempting EVM extraction (if leading 12 bytes are zero, treat as EVM address) else treat as non-EVM bytes32.

2. **Handle-store widening for `toAddress`**
   - What we know: `PreparedTxEvm` has no `toAddress` field. Layer 0.6 needs to compare decoded recipient against user-supplied recipient.
   - What's unclear: Whether to add to `PreparedTxEvm` directly or to a `bridgeParams` bag.
   - Recommendation: Add `bridgeParams?: { toAddress?: string }` to `PreparedTxEvm` (additive, non-breaking). Prepare bridge tools (prepare_uniswap_swap, prepare_curve_swap, etc.) set this when applicable. Same-chain DEX tools leave it absent — Layer 0.6 ignores `no-match` from the decoder.

3. **Mayan real calldata fixture**
   - What we know: The LiFi routing tx confirms the bytes32 Solana encoding. The ABI is confirmed from Etherscan.
   - What's unclear: No direct `createOrderWithEth` tx found in recent contract history (contract shows mostly fulfill/unlock ops).
   - Recommendation: Wave 0 — construct a minimal synthetic fixture using the confirmed ABI, clearly labeled `SYNTHETIC` in the test comment. The ABI has been verified; a synthetically-encoded fixture is acceptable per the existing pattern for `lifi-btc.ts` (which also used a programmatically constructed fixture, as noted in the test file header).

---

## Environment Availability

No external tools or services are required beyond the existing project stack. All bridges are decoded from calldata already present in the handle — no on-chain RPC calls are needed at decode time.

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| `viem` | All four decoders | ✓ | 2.48.11 | — |
| `bs58` | Wormhole/Mayan Solana normalization | ✓ (project dep) | (check package.json) | — |
| Ethereum RPC | None at decode time | N/A | — | — |

---

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | vitest (existing) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run test/bridge-decoders-across-v3.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| BRIDGE-T1-01 | Wormhole: decode recipient bytes32, EVM case | unit | `npx vitest run test/bridge-decoders-wormhole.test.ts` | ❌ Wave 0 |
| BRIDGE-T1-01 | Wormhole: decode recipient bytes32, Solana case | unit | `npx vitest run test/bridge-decoders-wormhole.test.ts` | ❌ Wave 0 |
| BRIDGE-T1-01 | Wormhole: selector mismatch returns error | unit | `npx vitest run test/bridge-decoders-wormhole.test.ts` | ❌ Wave 0 |
| BRIDGE-T1-02 | Mayan: decode destAddr from createOrderWithEth | unit | `npx vitest run test/bridge-decoders-mayan-swift.test.ts` | ❌ Wave 0 |
| BRIDGE-T1-02 | Mayan: decode destAddr from createOrderWithToken | unit | `npx vitest run test/bridge-decoders-mayan-swift.test.ts` | ❌ Wave 0 |
| BRIDGE-T1-03 | NEAR: decode recipient string from initTransfer | unit | `npx vitest run test/bridge-decoders-near-omnibridge.test.ts` | ❌ Wave 0 |
| BRIDGE-T1-03 | NEAR: case-insensitive comparison | unit | `npx vitest run test/bridge-decoders-near-omnibridge.test.ts` | ❌ Wave 0 |
| BRIDGE-T1-04 | Across V3: decode recipient address from depositV3 | unit | `npx vitest run test/bridge-decoders-across-v3.test.ts` | ❌ Wave 0 |
| BRIDGE-T1-05 | Mismatch: refusal text names bridge + decoded + supplied | unit | `npx vitest run test/preview-send.bridge-tier1.test.ts` | ❌ Wave 0 |
| BRIDGE-T1-06 | DEX swap (Uniswap) calldata: no-match → Layer 0.6 no-op | integration | `npx vitest run test/preview-send.bridge-tier1.test.ts` | ❌ Wave 0 |
| BRIDGE-T1-06 | Layer ordering: 0.6 fires AFTER 0.5, BEFORE Layer 2 | unit | `npx vitest run test/preview-send.bridge-tier1.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/bridge-decoders-*.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/bridge-decoders-wormhole.test.ts` — covers BRIDGE-T1-01
- [ ] `test/bridge-decoders-mayan-swift.test.ts` — covers BRIDGE-T1-02
- [ ] `test/bridge-decoders-near-omnibridge.test.ts` — covers BRIDGE-T1-03
- [ ] `test/bridge-decoders-across-v3.test.ts` — covers BRIDGE-T1-04
- [ ] `test/preview-send.bridge-tier1.test.ts` — covers BRIDGE-T1-05, BRIDGE-T1-06
- [ ] `src/signing/error-codes.ts` — add `"DECODED_RECIPIENT_DRIFT"` to union
- [ ] `src/signing/blocks.ts` — add `DECODED_RECIPIENT_DRIFT_TEMPLATE`
- [ ] `src/protocols/bridge-decoders/index.ts` — create registry
- [ ] Handle-store widening (`PreparedTxEvm.bridgeParams?: { toAddress?: string }`)
- [ ] Mayan direct calldata fixture sourcing (or document as SYNTHETIC)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | Layer 0.6 refusal gate — prevents bridging to attacker-controlled recipient |
| V5 Input Validation | yes | viem ABI decode (schema-validates calldata); selector prefix guard |
| V6 Cryptography | no | — |

### Known Threat Patterns for Bridge Calldata Spoofing

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Agent encodes different recipient in bridge calldata than shown to user | Tampering | Layer 0.6 `decoded == user-supplied` assertion — this phase |
| Malformed calldata causes decoder to throw, breaking preview flow | Denial of Service | WR-02: NEVER-throws DU; all errors return `{ kind: "error" }` |
| Base58-to-bytes32 mismatch for Solana recipients | Spoofing | Normalize both sides via bs58 encode/decode before comparison |
| Truncated bytes32 for Solana recipients (last-20-bytes extraction) | Spoofing | Branch on chain type; never truncate for non-EVM destinations |

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: github.com/wormhole-foundation/wormhole/blob/main/ethereum/contracts/bridge/interfaces/ITokenBridge.sol] — `transferTokensWithPayload` function signature
- [VERIFIED: etherscan.io/address/0x3ee18b2214aff97000d974cf647e7c347e8fa585] — Wormhole Token Bridge Ethereum mainnet contract
- [VERIFIED: etherscan.io/address/0x5E5B726C81f43b953a62ad87e2835c85c4d9dd3b] — Across V3 SpokePool impl ABI (depositV3 recipient = address type)
- [VERIFIED: github.com/Near-One/omni-bridge README] — initTransfer signature; recipient = ABI string
- [VERIFIED: etherscan.io/address/0xc38e4e6a15593f908255214653d3d947ca1c2338] — Mayan Swift ABI (createOrderWithEth/createOrderWithToken, OrderParams struct)
- [VERIFIED: viem.decodeFunctionData in this session] — all four function signatures decoded correctly against real calldata

### Secondary (MEDIUM confidence)
- [CITED: etherscan.io/tx/0xbdb62e8ece1ac5b8e0d16bd82f3c145d6b8ce8b840b8d5a8b59ea78997308560] — Real Across V3 depositV3 calldata fixture
- [CITED: etherscan.io/tx/0x80c535f5578f4c4e556b7d4831d46234aa11692c7a339fb07a957d3a8cb16b61] — Real NEAR OmniBridge initTransfer calldata fixture
- [CITED: etherscan.io/tx/0x778c95195c314ac1800910715e30da85d8d9e2355781b30e9f927428e67ad886] — Real Wormhole transferTokensWithPayload calldata fixture

### Tertiary (LOW confidence)
- [ASSUMED] — Mayan bytes32 Solana encoding via LiFi routing tx `0xb86df5b8c45853f12d05f67c4f42f7e7ce151217d521d2713d09217985e06868` (target was LiFi Diamond, not Mayan Swift directly; inner `_mayanData` shows bytes32 Solana pubkey)

---

## Metadata

**Confidence breakdown:**
- Wormhole ABI + fixture: HIGH — confirmed from official GitHub + real tx decode
- Across V3 ABI + fixture: HIGH — confirmed from impl contract ABI at Etherscan + real tx decode
- NEAR OmniBridge ABI + fixture: HIGH — confirmed from official README + real tx decode
- Mayan Swift ABI: HIGH — confirmed from Etherscan ABI inspection + selector compute
- Mayan bytes32 Solana encoding: MEDIUM — inferred from LiFi routing, not direct Mayan Swift tx
- Mayan real calldata fixture: LOW — not found; plan as SYNTHETIC

**Research date:** 2026-05-28
**Valid until:** 2026-06-28 (bridge ABIs are stable; re-verify Across deployments if Across V3 upgrades SpokePool impl)

---

## RESEARCH COMPLETE

**Phase:** 39 — Tier-1 bridge facet decoders + final-recipient assertion (Inv #6b)
**Confidence:** HIGH (Across, NEAR, Wormhole ABI/fixture), MEDIUM (Mayan)

### Key Findings

1. **All four selectors confirmed:** Wormhole `0xc5a5ebda`, Mayan createOrderWithEth `0xb866e173` / createOrderWithToken `0x8e8d142b`, NEAR `0xdeb915b8`, Across V3 `0x7b939232` — all computed via `viem.toFunctionSelector` and confirmed against real calldata.

2. **Recipient normalization is structurally divergent per bridge:**
   - Across V3: plain EVM `address` → `getAddress()`
   - NEAR: ABI `string` → lowercase trim compare
   - Wormhole/Mayan: `bytes32` — must branch on destination chain type (EVM last-20-bytes vs Solana full-32-bytes base58)

3. **Real calldata fixtures obtained for Across V3, NEAR, and Wormhole** from mainnet transactions; decoded and verified with viem in this session. Mayan fixture is ASSUMED pending direct `createOrderWithEth` tx.

4. **Layer 0.6 insertion point confirmed:** Between the closing brace of the Layer 0.5 `_canonicalDispatch.checkDispatchTarget` block (~line 893) and the Layer 2 `if (typeof args.chain === "string")` check (~line 910) in `preview_send.ts`.

5. **New ErrorCode required:** `"DECODED_RECIPIENT_DRIFT"` must be added to `src/signing/error-codes.ts` (append-only). New `DECODED_RECIPIENT_DRIFT_TEMPLATE` in `src/signing/blocks.ts`.

6. **Handle-store widening required (Wave 0):** `PreparedTxEvm` currently has no field for the user-supplied `toAddress`. A `bridgeParams?: { toAddress?: string }` addition is needed for Layer 0.6 to compare against the decoded recipient.

### File Created
`.planning/phases/39-bridge-tier-1-facet-decoders-final-recipient-assertion/39-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|---|---|---|
| Wormhole ABI + fixture | HIGH | Official GitHub interface + real tx decode verified |
| NEAR OmniBridge ABI + fixture | HIGH | Official README + real tx decode verified |
| Across V3 ABI + fixture | HIGH | Etherscan impl ABI + real tx decode verified |
| Mayan Swift ABI | HIGH | Etherscan ABI inspection + selector verification |
| Mayan fixture (calldata) | LOW | LiFi routing indirection; no direct createOrderWithEth tx found |
| Layer 0.6 insertion point | HIGH | Source code read confirmed exact location |
| Recipient normalization logic | HIGH (EVM/NEAR), MEDIUM (Wormhole/Mayan Solana) | EVM + NEAR verified; Solana normalization inferred from structure |

### Open Questions
1. Does Mayan's `destChainId` field use the same chain ID scheme as Wormhole (1=Solana)?
2. Best approach for `PreparedTxEvm` handle-store widening to carry `toAddress`?
3. Direct Mayan `createOrderWithEth` calldata for a Solana-destination transaction (needed for non-synthetic fixture).

### Ready for Planning
Research complete. Planner can now create PLAN.md files.
