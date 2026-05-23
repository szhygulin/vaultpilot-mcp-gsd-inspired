---
phase: 30-evm-lido-stake-unstake-wrap-unwrap
reviewed: 2026-05-23T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - src/chains/lido.ts
  - src/config/contracts.ts
  - src/protocols/lido.ts
  - src/security/canonical-dispatch.ts
  - src/signing/blocks.ts
  - src/signing/lido-rebase.ts
  - src/tools/get_lido_positions.ts
  - src/tools/prepare_lido_stake.ts
  - src/tools/prepare_lido_unstake.ts
  - src/tools/prepare_lido_unwrap.ts
  - src/tools/prepare_lido_wrap.ts
  - src/tools/preview_send.ts
  - src/tools/register-all.ts
  - test/config-contracts.test.ts
  - test/get-lido-positions.test.ts
  - test/lido-lifecycle.integration.test.ts
  - test/prepare-lido-stake.test.ts
  - test/prepare-lido-unstake.test.ts
  - test/prepare-lido-unwrap.test.ts
  - test/prepare-lido-wrap.test.ts
  - test/protocols-lido.test.ts
  - test/security-canonical-dispatch.test.ts
  - test/signing-fingerprint.test.ts
  - test/signing-lido-rebase.test.ts
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 30: Code Review Report

**Reviewed:** 2026-05-23
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Phase 30 ships Lido stETH/wstETH on Ethereum mainnet (writes) with multi-chain
reads (Ethereum + Arbitrum). The cryptographic-binding chain is well anchored:
Fixtures V/W/X/Y are hardcoded `0x...` literals re-anchored in 4 prepare tests
plus the integration test (persona-swap byte-identity check). D-03 / D-04 / D-05
/ D-06 / D-09 / D-12 invariants are enforced and tested.

No CRITICAL findings. The 4 WARNINGs surface defense-in-depth gaps and one
documentation invariant that overstates the math safety (slashing can produce
negative rebase deltas). 4 INFO items cover minor cleanups.

The FROZEN cryptographic substrate (`payload-fingerprint.ts`, `presign-hash.ts`,
`handle-store.ts`, `send_transaction.ts`) was correctly left untouched.

## Warnings

### WR-01: `accruedRebaseRewards` invariant overstates Lido balance monotonicity

**File:** `src/signing/lido-rebase.ts:60-62`, `src/signing/lido-rebase.ts:19`
**Issue:** The doc-comment on `LidoRebaseOutput.accruedRebaseRewards` asserts:
"NEVER negative by invariant — Lido balances grow monotonically per share."
This invariant is false. Lido post-Shapella supports validator slashing /
oracle negative-rebase events; `getPooledEthByShares(shares)` can decrease when
a slashing rebase is applied. With `shares: 1e18` and
`currentStethBalance: 0.999e18` (post-slashing), the formula yields a NEGATIVE
bigint. The math itself doesn't crash (bigint handles signs), but downstream
consumers and the agent's prompt — which trusts the "NEVER negative" doc — may
mis-render the value (e.g. `formatUnits(-50n, 18)` → `"-0.00000000000000005"`)
without context, and the agent could present it to the user as a bug rather
than a slashing signal.
**Fix:** Soften the invariant in the doc-comment AND consider explicitly
surfacing the sign in the agent-facing field name when negative. Minimal:

```ts
   * Approximate accrued rebase rewards in stETH wei.
   * Formula: currentStethBalance - shares  (D-09; bigint subtraction; no float).
   * Can be 0n for fresh deposits and CAN BE NEGATIVE during slashing /
   * negative-rebase oracle events. The agent should surface the sign verbatim
   * — a negative value indicates a slashing-period drawdown, not a math bug.
```

Optional follow-up: add a `signHint: "positive" | "zero" | "negative"` field
to the output (literal-narrowed like `approx: true`) so the agent prompt can
branch without re-doing the comparison.

### WR-02: Lido-decode arm in `preview_send` lacks chainId gate — produces address(0) contractAddress on Arbitrum

**File:** `src/tools/preview_send.ts:621-687`
**Issue:** The 4-arm Lido selector dispatch (lines 625-687) calls
`_getLidoStethAddress(record.tx.chainId as ChainId)` and only checks the result
for truthiness via `if (stethAddr)`. For `chainId === 42161` (Arbitrum), the
SOT returns `getAddress("0x0000…0000")` — the address(0) sentinel — which is
TRUTHY (a non-empty string). The branch then constructs a `lidoDecoded` record
with `contractAddress: 0x0000…0000`, which the DECODED ARGS block renders as
the user-facing `stethContract: 0x0000…0000`. This is unreachable through
normal flow because the Layer 0.5 dispatch allowlist (lines 343-365) refuses
non-Ethereum Lido write contracts BEFORE reaching the decoder. But the decoder
relies on an upstream gate for safety — a single skipped or future-edited
upstream check would surface a bogus zero-address label to the user.

The Compound NOTICE check at lines 945-950 demonstrates the correct shape:
`record.tx.chainId === 1` is part of the condition.
**Fix:** Gate the Lido decode arms on chainId, and treat the address(0)
sentinel as a non-match:

```ts
} else if (sel === LIDO_SELECTORS.submit && record.tx.chainId === 1) {
  // ...existing decode, plus:
  const stethAddr = _getLidoStethAddress(1);
  if (stethAddr && stethAddr !== "0x0000000000000000000000000000000000000000") {
    lidoDecoded = { /* ... */ };
  }
}
```

Apply analogously to `requestWithdrawals` (chainId-gated; `wqAddr` zero-check)
and `wrap`/`unwrap` (wstETH is non-zero on Arbitrum but the write-side decode
should still be gated to chainId 1 to match the prepare-tool surface).

### WR-03: Arbitrum-arm allowlist filter not asserted by any regression test

**File:** `src/security/canonical-dispatch.ts:138-143`, `test/security-canonical-dispatch.test.ts`
**Issue:** The Arbitrum allowlist explicitly filters address(0) sentinels via
`a !== "0x0000000000000000000000000000000000000000"` so the Arbitrum branch
gets no Lido write contracts. The Ethereum-arm size test
(`test/security-canonical-dispatch.test.ts:337-346`) asserts a pinned count of
29 for Ethereum but no symmetric test asserts:

1. The Arbitrum allowlist does NOT contain `getLidoStethAddress(1)` (mainnet
   stETH address must NOT leak onto L2).
2. The Arbitrum allowlist does NOT contain `getLidoWithdrawalQueueAddress(1)`.
3. The filter actually drops the zero-address sentinels (rather than relying
   on the assumption that `getAddress("0x000…000") === "0x000…000"` — which
   we verified holds because all-zero address has no mixed-case form, but is
   undocumented in the test seam).

If a future refactor changes `LIDO_RAW[42161].steth` to a non-zero sentinel
(or a developer types `if (a !== "0x...0001")` typo), the regression would not
fire.
**Fix:** Add negative-membership assertions to
`test/security-canonical-dispatch.test.ts` in the existing Phase 30 block:

```ts
it("Arbitrum allowlist does NOT contain Lido write contracts (D-03 enforcement)", () => {
  const ethSteth = getLidoStethAddress(1)!;
  const ethWq = getLidoWithdrawalQueueAddress(1)!;
  expect(CANONICAL_DISPATCH_TARGETS[42161].has(ethSteth)).toBe(false);
  expect(CANONICAL_DISPATCH_TARGETS[42161].has(ethWq)).toBe(false);
});

it("address(0) sentinel is NOT in any per-chain allowlist", () => {
  const zero = "0x0000000000000000000000000000000000000000" as Address;
  for (const id of [1, 42161, 137, 8453, 10] as const) {
    expect(CANONICAL_DISPATCH_TARGETS[id].has(zero)).toBe(false);
  }
});
```

### WR-04: `prepare_lido_unstake` allowance + getLastRequestId RPC reads are sequential — preventable TOCTOU drift window

**File:** `src/tools/prepare_lido_unstake.ts:191-227`
**Issue:** The two preview-time RPC reads (allowance at L191; getLastRequestId
at L222) execute sequentially. Two consequences:

1. **TOCTOU width.** Both reads ought to be observed at the same block height
   for the prediction to be coherent. Sequential reads can observe two
   different blocks, increasing the chance the predicted tokenId is already
   stale by the time the user signs.
2. **Latency.** Two serial round-trips to the RPC vs. one concurrent batch on
   the same connection.

Performance is out of v1 scope, but the correctness concern (the predicted
tokenId from `getLastRequestId() + 1n` is more likely to drift when the read
is taken at an earlier block than the allowance read) IS a correctness signal
the user-facing `[NFT RECEIPT EXPECTED]` block trusts.
**Fix:** Read both concurrently via `Promise.all`:

```ts
const [allowance, lastId]: [bigint, bigint] = await Promise.all([
  client.readContract({ address: stethAddr, abi: erc20Abi, functionName: "allowance", args: [fromAddress, wqAddr] }),
  client.readContract({ address: wqAddr, abi: WQ_GET_LAST_REQUEST_ID_ABI, functionName: "getLastRequestId" }),
]);
// Then the allowance gate uses `allowance`, and the NFT block uses `lastId`.
```

If the allowance-insufficient path should short-circuit before paying for the
`getLastRequestId` call, leave them sequential — but document the TOCTOU
trade-off in the inline comment at L188.

## Info

### IN-01: Duplicate `STETH_DECIMALS` symbol across two modules (one `number`, one `bigint`)

**File:** `src/protocols/lido.ts:59` (export `STETH_DECIMALS = 18`),
`src/signing/lido-rebase.ts:41` (export `STETH_DECIMALS: bigint = 18n`)
**Issue:** Two distinct exports named `STETH_DECIMALS` exist in two modules
with different types. Currently disambiguated by import path, but a future
contributor adding an import that grabs the wrong one would get a silent
type-error or runtime mis-behavior (e.g., passing the `bigint` to
`parseAmountStrict` which expects `number`).
**Fix:** Rename one of them, e.g. `STETH_BASE_DECIMALS_BIGINT` in
`lido-rebase.ts`, or import `STETH_DECIMALS` from `src/protocols/lido.ts` and
construct the bigint inline (`BigInt(STETH_DECIMALS)`) where needed.

### IN-02: `signing-lido-rebase.test.ts` literal-narrowed `approx: true` assertion lacks compile-time test

**File:** `test/signing-lido-rebase.test.ts:48-62`
**Issue:** The test at L58-61 asserts `expect(result.approx).toBe(true)` and
`expect(typeof result.approx).toBe("boolean")`. Both pass for a widened
`boolean` type. The CLAUDE.md D-09 requirement is that the TS LITERAL TYPE is
`true` — the test cannot detect a widening to `boolean` because vitest runs
post-compile. The inline comment at L51-52 acknowledges this gap.
**Fix:** Add a TypeScript compile-time assertion using a type-equality test
(e.g., via `expectTypeOf` from vitest, or a satisfies-style assertion):

```ts
import { expectTypeOf } from "vitest";
// ...
expectTypeOf(result.approx).toEqualTypeOf<true>();
```

This would fire at typecheck time if the field is widened.

### IN-03: Lido decoded args block silently substitutes `0n` for missing array element

**File:** `src/signing/blocks.ts:1753`
**Issue:** `const amountWei = decoded.amounts[0] ?? 0n;` — if a future change
allows zero-length `amounts` arrays (currently prevented by `D-06`
single-element-array discipline at encode time), the block would silently emit
`0 stETH` instead of refusing or flagging the empty case.
**Fix:** Either harden to throw on empty (since D-06 is supposed to guarantee
non-empty), or surface "(empty amounts array — unexpected)" explicitly:

```ts
case "lido-unstake": {
  if (decoded.amounts.length !== 1) {
    throw new Error("buildLidoDecodedArgsBlock: amounts array must be single-element per D-06");
  }
  const amountWei = decoded.amounts[0]!;
  // ...
}
```

### IN-04: Verbose duplicated CHAIN_ID_MISMATCH branch across 4 prepare_lido_* tools

**File:** `src/tools/prepare_lido_stake.ts:107-122`,
`src/tools/prepare_lido_unstake.ts:118-133`,
`src/tools/prepare_lido_wrap.ts:101-117`,
`src/tools/prepare_lido_unwrap.ts:98-114`
**Issue:** Four near-identical CHAIN_ID_MISMATCH-defense blocks duplicate the
same gate. The duplication is intentional (clear per-tool error surface) but
each block carries a hand-edited string literal, so a copy-paste edit in one
location and forget in another would cause inconsistent agent-visible error
messages.
**Fix:** Extract a shared helper:

```ts
// e.g. src/tools/_lido-shared.ts
export function ethereumOnlyGuard(chain: unknown): ToolHandlerResult | null {
  if (typeof chain !== "string" || chain !== "ethereum") {
    const got = typeof chain === "string" ? chain : "";
    return {
      isError: true,
      content: [{ type: "text", text: `error: invalid 'chain': Lido write operations support only 'ethereum', got "${got}"` }],
      structuredContent: makeStructuredError("CHAIN_ID_MISMATCH", `invalid 'chain': Lido write operations support only 'ethereum', got "${got}"`),
    };
  }
  return null;
}
```

Optional — current shape is functional and tested; the duplication risk is
small.

---

_Reviewed: 2026-05-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
