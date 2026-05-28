# Phase 39: Tier-1 Bridge Facet Decoders + Final-Recipient Assertion — Pattern Map

**Mapped:** 2026-05-28
**Files analyzed:** 15 (10 create, 5 modify)
**Analogs found:** 15 / 15

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/protocols/bridge-decoders/wormhole.ts` | protocol-decoder | transform | `src/protocols/bridge-decoders/lifi-btc.ts` | exact (same dir, same DU shape) |
| `src/protocols/bridge-decoders/mayan-swift.ts` | protocol-decoder | transform | `src/protocols/bridge-decoders/lifi-btc.ts` | exact |
| `src/protocols/bridge-decoders/near-omnibridge.ts` | protocol-decoder | transform | `src/protocols/bridge-decoders/lifi-btc.ts` | exact |
| `src/protocols/bridge-decoders/across-v3.ts` | protocol-decoder | transform | `src/protocols/bridge-decoders/lifi-btc.ts` | exact |
| `src/protocols/bridge-decoders/index.ts` | registry/dispatcher | request-response | `src/security/canonical-dispatch.ts` (ESM _-indirection); `src/protocols/aave-v3.ts` (SELECTORS pattern) | role-match |
| `test/bridge-decoders-wormhole.test.ts` | test | transform | `test/lifi-btc-decoder.test.ts` | exact |
| `test/bridge-decoders-mayan-swift.test.ts` | test | transform | `test/lifi-btc-decoder.test.ts` | exact |
| `test/bridge-decoders-near-omnibridge.test.ts` | test | transform | `test/lifi-btc-decoder.test.ts` | exact |
| `test/bridge-decoders-across-v3.test.ts` | test | transform | `test/lifi-btc-decoder.test.ts` | exact |
| `test/preview-send.bridge-tier1.test.ts` | test | request-response | `test/preview-send.dispatch-allowlist.test.ts` | exact |
| `src/tools/preview_send.ts` (modify) | tool/middleware | request-response | self (Layer 0.5 block at lines 868-893) | self-analog |
| `src/signing/error-codes.ts` (modify) | config/types | — | self (append-only union at line 340) | self-analog |
| `src/signing/blocks.ts` (modify) | config/templates | — | `DISPATCH_TARGET_REFUSAL_TEMPLATE` (line 868) | exact |
| `src/signing/handle-store.ts` (modify) | types/model | — | `PreparedTxBtcLifi.toAddress` pattern (line 924); `PreparedTxEvm` interface (line 328) | role-match |
| `SECURITY.md` (modify) | docs | — | existing residual-risk sections | docs |

---

## Pattern Assignments

### `src/protocols/bridge-decoders/wormhole.ts` (protocol-decoder, transform)

**Analog:** `src/protocols/bridge-decoders/lifi-btc.ts`

**File header comment pattern** (lifi-btc.ts lines 1-26):
```typescript
// src/protocols/bridge-decoders/wormhole.ts — Phase 39 Plan XX (BRIDGE-T1-01).
//
// Wormhole Token Bridge `transferTokensWithPayload` calldata decoder.
// Extracts the `recipient` (bytes32) field and normalizes it to the
// destination-chain recipient address for Inv #6b assertion.
//
// DISPLAY/ASSERT-ONLY — does NOT reconstruct or re-encode calldata.
// NEVER-throws discriminated union result (WR-02 compliance).
```

**Imports pattern** (lifi-btc.ts lines 27-29 — adapt for EVM decoder):
```typescript
import { decodeFunctionData, getAddress, parseAbi } from "viem";
import type { Hex } from "viem";
import bs58 from "bs58";
```

**Selector constants pattern** (aave-v3.ts lines 55-58):
```typescript
export const WORMHOLE_SELECTORS = {
  transferTokensWithPayload: "0xc5a5ebda" as Hex,
} as const;
```

**Discriminated-union result type pattern** (lifi-btc.ts lines 62-64):
```typescript
export type DecodeWormholeResult =
  | { kind: "ok"; summary: WormholeSummary }
  | { kind: "error"; message: string };
```

**Summary interface pattern** (lifi-btc.ts lines 40-54 — readonly fields):
```typescript
export interface WormholeSummary {
  readonly finalRecipient: string;   // normalized address or base58 pubkey
  readonly recipientChain: number;   // Wormhole chain ID
  readonly destinationType: "evm" | "solana" | "unsupported";
}
```

**Core decode function pattern — selector-prefix guard + try/catch** (lifi-btc.ts lines 78-133):
```typescript
export function decodeWormholeTransferWithPayload(data: Hex): DecodeWormholeResult {
  // Selector-prefix guard — cheap short-circuit (CONTEXT decision).
  if (!data.toLowerCase().startsWith(WORMHOLE_SELECTORS.transferTokensWithPayload)) {
    return { kind: "error", message: "selector mismatch: not a transferTokensWithPayload call" };
  }
  try {
    const decoded = _wormholeHelpers.decodeFunctionData(data);
    // ... extract args, normalize recipient based on recipientChain ...
    return { kind: "ok", summary: { finalRecipient, recipientChain, destinationType } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "error", message: `ABI decode failed: ${msg}` };
  }
}
```

**ESM spy-affordance `_<scope>Helpers` indirection pattern** (CLAUDE.md convention; no direct analog in lifi-btc.ts since it doesn't use viem decodeFunctionData — use aave-v3.ts `_aaveProtocols` as the shape model):
```typescript
// ESM spy-affordance indirection (CLAUDE.md convention).
// vi.spyOn(_wormholeHelpers, "decodeFunctionData") works; direct spy on the
// named export would be a no-op (ESM bindings are immutable).
export const _wormholeHelpers = {
  decodeFunctionData: (data: Hex) =>
    decodeFunctionData({ abi: WORMHOLE_TRANSFER_ABI, data }),
};
```

---

### `src/protocols/bridge-decoders/mayan-swift.ts` (protocol-decoder, transform)

**Analog:** `src/protocols/bridge-decoders/lifi-btc.ts` (shape), RESEARCH.md §Bridge 2 (ABI)

**Two-selector pattern** (same module, different selectors):
```typescript
export const MAYAN_SWIFT_SELECTORS = {
  createOrderWithEth:   "0xb866e173" as Hex,
  createOrderWithToken: "0x8e8d142b" as Hex,
} as const;
```

**OrderParams tuple index discipline** (RESEARCH.md §Pitfall 6 — struct offset differs per function):
```typescript
// createOrderWithEth:   args[0] is the OrderParams tuple; destAddr at tuple index 7
// createOrderWithToken: args[2] is the OrderParams tuple; destAddr at tuple index 7
// Both paths MUST be decoded separately — see RESEARCH §Pitfall 6.
```

**Shared selector guard across both selectors**:
```typescript
export function decodeMayanSwiftOrder(data: Hex): DecodeMayanResult {
  const lower = data.toLowerCase();
  const isEth   = lower.startsWith(MAYAN_SWIFT_SELECTORS.createOrderWithEth);
  const isToken = lower.startsWith(MAYAN_SWIFT_SELECTORS.createOrderWithToken);
  if (!isEth && !isToken) {
    return { kind: "error", message: "selector mismatch: not a Mayan createOrder call" };
  }
  // ... two decode paths branching on isEth vs isToken ...
}
```

**`_mayanSwiftHelpers` indirection** (same shape as `_wormholeHelpers` above — one per decode path):
```typescript
export const _mayanSwiftHelpers = {
  decodeWithEth:   (data: Hex) => decodeFunctionData({ abi: MAYAN_ETH_ABI,   data }),
  decodeWithToken: (data: Hex) => decodeFunctionData({ abi: MAYAN_TOKEN_ABI, data }),
};
```

---

### `src/protocols/bridge-decoders/near-omnibridge.ts` (protocol-decoder, transform)

**Analog:** `src/protocols/bridge-decoders/lifi-btc.ts`

**String-type recipient — differs from Wormhole/Mayan bytes32**:
```typescript
export const NEAR_SELECTORS = {
  initTransfer: "0xdeb915b8" as Hex,
} as const;

// recipient is ABI string (args[4]), NOT bytes32.
// Normalize: decodedRecipient.toLowerCase().trim()
// RESEARCH §Pitfall 3: NEAR account IDs are always lowercase; user may
// provide mixed-case → normalize BOTH sides before comparison.
```

**Summary interface**:
```typescript
export interface NearOmniBridgeSummary {
  readonly finalRecipient: string;  // NEAR account ID, lowercased + trimmed
  readonly message: string;         // args[5] — EVM-chain destination (advisory only)
}
```

**`_nearHelpers` indirection**:
```typescript
export const _nearHelpers = {
  decodeFunctionData: (data: Hex) =>
    decodeFunctionData({ abi: NEAR_INIT_TRANSFER_ABI, data }),
};
```

---

### `src/protocols/bridge-decoders/across-v3.ts` (protocol-decoder, transform)

**Analog:** `src/protocols/bridge-decoders/lifi-btc.ts` — simplest of the four (recipient is plain EVM address)

**Selector + summary**:
```typescript
export const ACROSS_V3_SELECTORS = {
  depositV3: "0x7b939232" as Hex,
} as const;

export interface AcrossV3Summary {
  readonly finalRecipient: string;    // checksummed EVM address (getAddress())
  readonly destinationChainId: bigint;
  readonly inputToken: string;
  readonly outputToken: string;
}
```

**`_acrossV3Helpers` indirection**:
```typescript
export const _acrossV3Helpers = {
  decodeFunctionData: (data: Hex) =>
    decodeFunctionData({ abi: ACROSS_V3_DEPOSIT_ABI, data }),
};
```

---

### `src/protocols/bridge-decoders/index.ts` (registry, request-response)

**Analog:** `src/security/canonical-dispatch.ts` (ESM `_canonicalDispatch` indirection shape); `src/protocols/aave-v3.ts` (SELECTORS re-export pattern)

**Registry + dispatcher + `_bridgeTier1Decoders` ESM seam** (RESEARCH.md §Pattern 2):
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

// Internal map — not exported. Keyed on lowercase 4-byte selector string.
// New Tier-2 decoders extend this map; preview_send.ts needs no edits.
const TIER1_DECODERS: ReadonlyMap<string, (data: Hex) => BridgeFacetDecodeResult> = ...;

export function decodeBridgeTier1FacetRecipient(data: Hex): BridgeFacetDecodeResult { ... }

// ESM spy-affordance indirection — CLAUDE.md convention.
// preview_send.ts calls _bridgeTier1Decoders.decodeBridgeTier1FacetRecipient(...)
// so vi.spyOn works in test/preview-send.bridge-tier1.test.ts.
export const _bridgeTier1Decoders = { decodeBridgeTier1FacetRecipient };
```

**`_canonicalDispatch` indirection shape in preview_send.ts** (preview_send.ts line 131 + lines 872-892 for how `_canonicalDispatch.checkDispatchTarget` is called with the `_`-object):
```typescript
// preview_send.ts line 131 (import):
import { _canonicalDispatch } from "../security/canonical-dispatch.js";

// preview_send.ts line 872 (call via indirection):
const dispatchCheck = _canonicalDispatch.checkDispatchTarget(
  record.tx.chainId as ChainId,
  record.tx.to,
);
```
Phase 39 adds the parallel import and call:
```typescript
import { _bridgeTier1Decoders } from "../protocols/bridge-decoders/index.js";
// ...
const bridgeDecodeResult = _bridgeTier1Decoders.decodeBridgeTier1FacetRecipient(record.tx.data);
```

---

### `test/bridge-decoders-wormhole.test.ts`, `...-mayan-swift.test.ts`, `...-near-omnibridge.test.ts`, `...-across-v3.test.ts` (decoder unit tests)

**Analog:** `test/lifi-btc-decoder.test.ts` (lines 1-133)

**File header pattern** (lifi-btc-decoder.test.ts lines 1-15):
```typescript
// test/bridge-decoders-across-v3.test.ts — Phase 39 Plan XX (BRIDGE-T1-04).
//
// Unit tests for src/protocols/bridge-decoders/across-v3.ts.
//
// Uses a real mainnet calldata fixture from tx
//   0xbdb62e8ece1ac5b8e0d16bd82f3c145d6b8ce8b840b8d5a8b59ea78997308560
// (Across V3 depositV3 — confirmed by viem.decodeFunctionData in research session).
//
// WR-02: decodeAcrossV3Deposit returns { kind: "ok" | "error" } — NEVER throws.
```

**Hardcoded calldata fixture pattern** (lifi-btc-decoder.test.ts lines 36-43 — NO beforeAll-snapshot):
```typescript
// Real mainnet calldata — tx 0xbdb62e8ece...
// VERIFIED: viem.decodeFunctionData in research session 2026-05-28.
const ACROSS_V3_CALLDATA =
  "0x7b939232" +
  "00000000000000000000000015528a195c4b9353d7645eba48357a85324bb365" +
  // ... full hex verbatim from RESEARCH.md §Bridge 4 ...
  "" as `0x${string}`;

const EXPECTED_RECIPIENT = "0x15528a195C4b9353D7645eBA48357a85324bb365"; // EIP-55
const EXPECTED_DEST_CHAIN_ID = 42161n; // Arbitrum
```

**Test structure pattern** (lifi-btc-decoder.test.ts lines 46-109):
```typescript
describe("decodeAcrossV3Deposit — depositV3 calldata extraction", () => {
  it("returns correct finalRecipient (EIP-55 checksummed)", () => {
    const result = decodeAcrossV3Deposit(ACROSS_V3_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.summary.finalRecipient).toBe(EXPECTED_RECIPIENT);
  });

  it("returns correct destinationChainId (42161n Arbitrum)", () => { ... });

  it("returns { kind: 'error' } on selector mismatch (WR-02: NEVER-throws)", () => {
    const result = decodeAcrossV3Deposit("0xdeadbeef" as `0x${string}`);
    expect(result.kind).toBe("error");
  });

  it("returns { kind: 'error' } on malformed calldata (WR-02: NEVER-throws)", () => {
    const result = decodeAcrossV3Deposit("0x7b939232" as `0x${string}`); // truncated
    expect(result.kind).toBe("error");
  });
});
```

**Mayan synthetic fixture labeling** (required per RESEARCH.md §Open Question 3 — clearly mark):
```typescript
// SYNTHETIC — no direct createOrderWithEth mainnet tx found in contract history
// (see RESEARCH.md §Mayan fixture). ABI confirmed from Etherscan; this fixture
// is ABI-encoded programmatically from known inputs. Acceptable per lifi-btc.ts
// Phase 26 precedent (also used a programmatically-constructed PSBT fixture).
const MAYAN_CREATEORDER_ETH_CALLDATA = "0xb866e173..." as `0x${string}`;
```

---

### `test/preview-send.bridge-tier1.test.ts` (integration test, request-response)

**Analog:** `test/preview-send.dispatch-allowlist.test.ts` (lines 1-199)

**vi.hoisted + vi.mock pattern** (preview-send.dispatch-allowlist.test.ts lines 28-87):
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type Hex } from "viem";

const {
  getStatusSpy,
  getTransactionCountSpy,
  estimateFeesPerGasSpy,
  estimateGasSpy,
  callSpy,
  lookupSelectorSpy,
  bridgeTier1DecoderSpy,    // NEW — spy on _bridgeTier1Decoders via ESM seam
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  // ...
  bridgeTier1DecoderSpy: vi.fn(),
}));

vi.mock("../src/protocols/bridge-decoders/index.js", async () => {
  const actual = await vi.importActual<...>("../src/protocols/bridge-decoders/index.js");
  return {
    ...actual,
    _bridgeTier1Decoders: {
      decodeBridgeTier1FacetRecipient: (...args: any[]) => bridgeTier1DecoderSpy(...args),
    },
  };
});
```

**Handle seeding pattern** (preview-send.dispatch-allowlist.test.ts lines 146-169):
```typescript
function buildBridgeTx(to: Address, data: Hex): PreparedTx {
  return {
    txType: "evm",
    chainId: 1,
    to,
    valueWei: 0n,
    data,
    bridgeParams: { toAddress: "0x15528a195C4b9353D7645eBA48357a85324bb365" },
  };
}

function seedBridgeHandle(to: Address, data: Hex): string {
  return createHandle({
    args: { to: to.toLowerCase(), valueWei: "0" },
    tx: buildBridgeTx(to, data),
    payloadFingerprint: FIXTURE_FINGERPRINT,
  });
}
```

**Layer 0.6 ordering test** (mirrors T-DISPATCH-ALLOWLIST-1 in dispatch-allowlist tests — asserts ordering):
```typescript
it("Layer 0.6 fires AFTER Layer 0.5 allowlist and BEFORE Layer 2 chain-mismatch", () => {
  // seed handle with Tier-1 bridge selector + allowlisted bridge contract
  // set bridgeTier1DecoderSpy to return { kind: "ok", ... mismatch ... }
  // assert result.structuredContent.errorCode === "DECODED_RECIPIENT_DRIFT"
  // NOT "DISPATCH_TARGET_REFUSED" and NOT "CHAIN_ID_MISMATCH"
});
```

**Mismatch path — exact refusal shape** (per BRIDGE-T1-05):
```typescript
it("mismatch: refusal text names bridge, decoded value, and user-supplied value", () => {
  // ...
  expect(result.content[0].text).toMatch(/DECODED RECIPIENT DRIFT/);
  expect(result.content[0].text).toMatch(/bridge:\s+Across V3/);
  expect(result.content[0].text).toMatch(/decoded:\s+0x15528a/);
  expect(result.content[0].text).toMatch(/supplied:\s+0xdeadbeef/);
});
```

---

### `src/tools/preview_send.ts` (modify — Layer 0.6 insertion)

**Insertion point:** lines 893-910 — between the closing `}` of the Layer 0.5 block and the `if (typeof args.chain === "string")` Layer 2 block.

**Mirror pattern of the Layer 0.5 block** (preview_send.ts lines 871-893):
```typescript
// Layer 0.5 pattern (existing — to be mirrored):
if (record.tx.data !== "0x") {
  const dispatchCheck = _canonicalDispatch.checkDispatchTarget(
    record.tx.chainId as ChainId,
    record.tx.to,
  );
  if (dispatchCheck.kind === "refused" && !escapeHatchBypassActive) {
    const refusalText = DISPATCH_TARGET_REFUSAL_TEMPLATE
      .replace("{CHAIN}", chainLabel)
      .replace("{TO}", dispatchCheck.to)
      .replace("{ALLOWLIST}", dispatchCheck.allowlist.join("\n    "));
    return {
      isError: true,
      content: [{ type: "text", text: refusalText }],
      structuredContent: errEnvelope(
        "DISPATCH_TARGET_REFUSED",
        `tx.to ${dispatchCheck.to} is not in ...`,
      ),
    };
  }
}
```

**Layer 0.6 follows the identical structural pattern** (RESEARCH.md §Pattern 3):
```typescript
// Phase 39 — Layer 0.6 Bridge Tier-1 Final-Recipient Assertion (Inv #6b EVM path).
// Fires AFTER Layer 0.5 canonical-dispatch allowlist (bridge addr must be allowlisted)
// and BEFORE Layer 2 chain-name mismatch.
// Only fires for contract calls (data !== "0x") matching a Tier-1 bridge selector.
if (record.tx.data !== "0x") {
  const bridgeDecodeResult = _bridgeTier1Decoders.decodeBridgeTier1FacetRecipient(
    record.tx.data,
  );
  if (bridgeDecodeResult.kind === "error") {
    const refusalText = DECODED_RECIPIENT_DRIFT_TEMPLATE
      .replace("{BRIDGE}", bridgeDecodeResult.bridge)
      .replace("{DECODED}", `decode error: ${bridgeDecodeResult.message}`)
      .replace("{SUPPLIED}", (record.tx as PreparedTxEvm).bridgeParams?.toAddress ?? "(none)");
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
    const userRecipient = (record.tx as PreparedTxEvm).bridgeParams?.toAddress ?? "";
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

**Import additions** (mirror the Layer 0.5 import for `_canonicalDispatch` at line 131):
```typescript
// Add to the existing import section — one line per import, same style:
import { _bridgeTier1Decoders } from "../protocols/bridge-decoders/index.js";
import { DECODED_RECIPIENT_DRIFT_TEMPLATE } from "../signing/blocks.js";
// Note: DECODED_RECIPIENT_DRIFT_TEMPLATE joins the existing blocks.ts imports at line 135-148
```

---

### `src/signing/error-codes.ts` (modify — append DECODED_RECIPIENT_DRIFT)

**Analog:** The existing append-only union; nearest recent additions at lines 337-340 (STALE_SIGNATURE)

**Append pattern** (error-codes.ts lines 337-340):
```typescript
  // Phase 37 Plan 37-03 — ... STALE_SIGNATURE ...
  | "INSUFFICIENT_SIGNATURES"
  | "STALE_SIGNATURE";
```

**Phase 39 appends AFTER `STALE_SIGNATURE`** following the established comment-block pattern:
```typescript
  | "INSUFFICIENT_SIGNATURES"
  | "STALE_SIGNATURE"
  //
  // Phase 39 Plan XX — Bridge Tier-1 final-recipient assertion (Inv #6b EVM path).
  // APPEND-ONLY — do not reorder existing codes above.
  //
  //   DECODED_RECIPIENT_DRIFT — preview_send Layer 0.6 refusal: the recipient
  //                        encoded in the bridge calldata (decoded from
  //                        Wormhole / Mayan Swift / NEAR OmniBridge / Across V3
  //                        `transferTokensWithPayload` / `createOrderWithEth` /
  //                        `createOrderWithToken` / `initTransfer` / `depositV3`)
  //                        does NOT match the user-supplied `toAddress` stored
  //                        in the handle at prepare time. Defends against a
  //                        compromised agent encoding a different recipient
  //                        inside opaque bridge calldata that the Ledger device
  //                        cannot decode. T-BRIDGE-T1-05 mitigation.
  | "DECODED_RECIPIENT_DRIFT";
```

---

### `src/signing/blocks.ts` (modify — append DECODED_RECIPIENT_DRIFT_TEMPLATE)

**Analog:** `DISPATCH_TARGET_REFUSAL_TEMPLATE` (blocks.ts lines 868-886) — same three-placeholder shape

**Header comment pattern** (blocks.ts lines 845-866):
```typescript
// -----------------------------------------------------------------------------
// Phase 39 Plan XX — DECODED_RECIPIENT_DRIFT_TEMPLATE (BRIDGE-T1-05).
//
// Layer 0.6 of `preview_send` (EVM path): refuses when the recipient decoded
// from a Tier-1 bridge calldata does NOT match the user-supplied `toAddress`
// stored in the PreparedTxEvm.bridgeParams handle.
//
// Three slots:
//   - `{BRIDGE}`    — bridge name (e.g. "Wormhole Token Bridge").
//   - `{DECODED}`   — decoded recipient value (address, base58 pubkey, or
//                     NEAR account ID) extracted from the calldata.
//   - `{SUPPLIED}`  — user-supplied `toAddress` from the prepare tool.
//
// APPEND-ONLY — all existing templates above stay byte-frozen.
// -----------------------------------------------------------------------------
```

**Template shape pattern** (blocks.ts lines 868-886):
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

---

### `src/signing/handle-store.ts` (modify — PreparedTxEvm widening)

**Analog:** `PreparedTxBtcLifi.toAddress` (handle-store.ts line 924) — precedent for a bridge-specific `toAddress` field on a prepared-tx shape. For `PreparedTxEvm`, the additive-widening approach is `bridgeParams?: { toAddress?: string }` (RESEARCH.md Option a recommendation).

**Widening location:** `PreparedTxEvm` interface (lines 328-339) — additive optional field, no existing fields changed:
```typescript
export interface PreparedTxEvm {
  /** Optional discriminator — absent === "evm" (back-compat with every Phase 4-11 handle). */
  txType?: "evm";
  chainId: number;
  to: Address;
  valueWei: bigint;
  data: Hex;
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  /**
   * Phase 39 Plan XX — Bridge Tier-1 Inv #6b assertion comparand.
   * Populated by bridge prepare tools (prepare_uniswap_swap, prepare_curve_swap,
   * etc.) when a user-supplied destination address exists. Consumed by
   * preview_send Layer 0.6 to compare against the decoded finalRecipient.
   * DEX swaps and non-bridge tools leave this absent — Layer 0.6 is a no-op
   * when decodeBridgeTier1FacetRecipient returns { kind: "no-match" }.
   */
  bridgeParams?: {
    toAddress?: string;
  };
}
```

**PreparedTxBtcLifi.toAddress precedent** (handle-store.ts lines 922-924):
```typescript
  /** Final destination address on the target chain. Asserted by Inv#6b at prepare time. */
  toAddress: string;
```
The EVM case uses optional `bridgeParams.toAddress` rather than a required top-level `toAddress` to avoid breaking all existing EVM handle construction sites (DEX swaps, approve, supply, etc. that have no `toAddress` concept).

---

## Shared Patterns

### NEVER-throws Discriminated Union (WR-02)
**Source:** `src/protocols/bridge-decoders/lifi-btc.ts` lines 62-64, 78-133
**Apply to:** All four decoder modules (wormhole.ts, mayan-swift.ts, near-omnibridge.ts, across-v3.ts)
```typescript
// Every decoder returns a DU — never throws. The try/catch at the
// decodeFunctionData boundary converts viem errors to { kind: "error"; message }.
export type Decode<X>Result =
  | { kind: "ok"; summary: <X>Summary }
  | { kind: "error"; message: string };
```

### ESM Spy-Affordance `_<scope>` Indirection
**Source:** CLAUDE.md convention; shape reference `src/protocols/aave-v3.ts` (`_aaveProtocols`); registry reference `src/security/canonical-dispatch.ts` (`_canonicalDispatch`)
**Apply to:** Each decoder's `_<bridge>Helpers`, index.ts's `_bridgeTier1Decoders`
```typescript
// Per CLAUDE.md: "Add the indirection at write time, not retroactively —
// the cost is one wrapping object; the cost of skipping it is a silently-
// passing test that doesn't actually spy on anything."
export const _acrossV3Helpers = {
  decodeFunctionData: (data: Hex) =>
    decodeFunctionData({ abi: ACROSS_V3_DEPOSIT_ABI, data }),
};
```

### Structured Refusal Return Shape
**Source:** `src/tools/preview_send.ts` lines 884-892 (Layer 0.5 refusal) and `errEnvelope` at line 254
**Apply to:** Layer 0.6 refusal arms in preview_send.ts
```typescript
return {
  isError: true,
  content: [{ type: "text", text: refusalText }],
  structuredContent: errEnvelope(
    "DECODED_RECIPIENT_DRIFT",
    `machine-readable message`,
  ),
};
```

### Hardcoded Literal Fixtures (no beforeAll-snapshot)
**Source:** `test/lifi-btc-decoder.test.ts` lines 36-43; `CLAUDE.md` convention
**Apply to:** All four decoder test files
```typescript
// NO beforeAll-snapshot. Each fixture is a hardcoded string literal from a
// real mainnet tx (or clearly labeled SYNTHETIC). Drift in decoder output
// fails at a specific assertion line, not against a self-snapshotted value.
const CALLDATA = "0x7b939232..." as `0x${string}`;
```

### Append-Only error-codes.ts Pattern
**Source:** `src/signing/error-codes.ts` lines 333-340 (most recent append)
**Apply to:** `DECODED_RECIPIENT_DRIFT` addition
```typescript
// APPEND-ONLY. Each new code block has a comment explaining: which plan added
// it, which tool emits it, what the recovery hint is.
```

### Test vi.mock + vi.hoisted Pattern
**Source:** `test/preview-send.dispatch-allowlist.test.ts` lines 28-87
**Apply to:** `test/preview-send.bridge-tier1.test.ts`
```typescript
// Hoist spies, mock session-manager + viem/actions + the new bridge decoder.
// Use _bridgeTier1Decoders ESM seam for the bridge decoder spy.
```

---

## No Analog Found

All 15 files have analogs. No "no analog" entries.

---

## Confirmed File Paths (verified against live codebase)

**CREATE:**
- `src/protocols/bridge-decoders/wormhole.ts`
- `src/protocols/bridge-decoders/mayan-swift.ts` (RESEARCH.md §Recommended Structure uses `mayan-swift.ts`; CONTEXT.md mentions "mayan.ts" — RESEARCH.md is more specific, use `mayan-swift.ts`)
- `src/protocols/bridge-decoders/near-omnibridge.ts` (RESEARCH.md §Recommended Structure; CONTEXT.md mentions "near-intents.ts" — RESEARCH.md is more specific, use `near-omnibridge.ts`)
- `src/protocols/bridge-decoders/across-v3.ts`
- `src/protocols/bridge-decoders/index.ts`
- `test/bridge-decoders-wormhole.test.ts`
- `test/bridge-decoders-mayan-swift.test.ts`
- `test/bridge-decoders-near-omnibridge.test.ts`
- `test/bridge-decoders-across-v3.test.ts`
- `test/preview-send.bridge-tier1.test.ts`

**MODIFY:**
- `src/tools/preview_send.ts` (Layer 0.6 insertion after line 893, new imports)
- `src/signing/error-codes.ts` (append `DECODED_RECIPIENT_DRIFT` after line 340)
- `src/signing/blocks.ts` (append `DECODED_RECIPIENT_DRIFT_TEMPLATE` at end of file)
- `src/signing/handle-store.ts` (widen `PreparedTxEvm` at line 339 with `bridgeParams?`)
- `SECURITY.md` (Inv #6b codification — docs only)

**Directory already exists:** `src/protocols/bridge-decoders/` (confirmed: contains `lifi-btc.ts`). Do NOT create the directory.
**Do NOT touch:** `src/protocols/bridge-decoders/lifi-btc.ts` (CONTEXT.md explicit constraint).

---

## Metadata

**Analog search scope:** `src/protocols/bridge-decoders/`, `src/protocols/`, `src/signing/`, `src/tools/`, `src/security/`, `test/`
**Files read:** 9 source files + 2 test files
**Pattern extraction date:** 2026-05-28
