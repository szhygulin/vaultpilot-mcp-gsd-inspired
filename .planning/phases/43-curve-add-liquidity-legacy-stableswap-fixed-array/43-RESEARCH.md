# Phase 43: Curve legacy `add_liquidity` (fixed-array) — Research

**Researched:** 2026-05-30
**Domain:** Curve Finance legacy StableSwap (`StableSwapSTETH.vy`) `add_liquidity` — Ethereum mainnet, the single registered legacy pool stETH/ETH (`0xDC24316b9AE028F1497c275EB9192a3Ea0f67022`)
**Confidence:** HIGH. All load-bearing ABI shapes and both new 4-byte selectors are VERIFIED against three independent primary sources that agree byte-for-byte: the `StableSwapSTETH.vy` Vyper source (GitHub raw, curvefi/curve-contract), the deployed contract ABI on Etherscan, and a local `viem.toFunctionSelector` computation.

> **Verification provenance (rnd discipline — sources named before facts):**
> - **`StableSwapSTETH.vy` (GitHub raw):** `N_COINS: constant(int128) = 2`; `@payable @external @nonreentrant('lock') def add_liquidity(amounts: uint256[N_COINS], min_mint_amount: uint256) -> uint256`; `@view @external def calc_token_amount(amounts: uint256[N_COINS], is_deposit: bool) -> uint256`; `@payable ... def exchange(i, j, dx, min_dy) -> uint256`; `@view def get_virtual_price() -> uint256`.
> - **Etherscan deployed contract `0xDC24316…`:** `add_liquidity(uint256[2],uint256)` payable, method id `0x0b4c7e4d`; `calc_token_amount(uint256[2], bool is_deposit)`.
> - **Local `viem.toFunctionSelector` (node v22.19.0 + project viem):** `add_liquidity(uint256[2],uint256)` = `0x0b4c7e4d` (matches Etherscan exactly); `calc_token_amount(uint256[2],bool)` = `0xed8e84f3`; `get_virtual_price()` = `0xbb7b8b80`; stable_ng `add_liquidity(uint256[],uint256)` = `0xb72df5de` (distinctness confirmed).
>
> Selectors are stated below as VERIFIED literals. The plan still pins them via the byte-identity test (`expect(...).toBe(toFunctionSelector(...))`) per the cryptographic-binding-fixture rule — that test is the permanent drift guard, not a one-time check.

---

## 1. Summary of findings (load-bearing)

- **The whole phase is additive and surgical.** The stable_ng `add_liquidity` path already works end-to-end (encoder, decoder, tool arm, preview block, Fixture CRV-C). Phase 43 replaces ONE refusal block (`prepare_curve_add_liquidity.ts:176-191`) with a two-arm `abiVersion` dispatch and bolts on a parallel legacy surface (ABI shelf entry, encoder, selector, decoder branch, fixtures). The pattern to mirror — `prepare_curve_swap.ts` lines 320-369 — is already in-tree and proven by Fixtures CRV-A/B.
- **OQ-1 verdict (load-bearing): `calc_token_amount` IS usable on the legacy pool, fixed-array signature `calc_token_amount(uint256[2] amounts, bool is_deposit) view returns (uint256)`, selector `0xed8e84f3`** [VERIFIED: StableSwapSTETH.vy + Etherscan + viem]. The legacy stETH pool predates stable_ng's dynamic `uint256[]`; its array param is fixed `uint256[2]` (N_COINS=2). The `is_deposit` bool IS present (exact param name confirmed from Vyper source). A new ABI shelf entry `CURVE_LEGACY_CALC_TOKEN_AMOUNT_ABI` + a new `_curveChain` reader is required — the existing `getCurveCalcTokenAmount` uses the dynamic `uint256[]` ABI and will mis-encode against the fixed-array contract.
- **OQ-2 verdict: legacy `add_liquidity(uint256[2] amounts, uint256 min_mint_amount) payable returns (uint256)`, selector `0x0b4c7e4d`** [VERIFIED: StableSwapSTETH.vy + Etherscan method id + viem — all three agree]. Fixed-size 2-array, `@payable`, returns minted LP (`uint256`, NOT void). The ABI string matches CONTEXT D-04 verbatim. DISTINCT from stable_ng `0xb72df5de`.
- **OQ-3 verdict: the tuple-dispatch negative is structurally guaranteed** by the existing `decodeCurveCall` design (`src/protocols/curve.ts:214-305`) — every branch guards on `(pool.abiVersion, sel)`. The new branch is `("legacy", "0x0b4c7e4d")`; the negative test feeds that selector against a stable_ng pool address (PayPool) → `null` (no `("stable_ng", 0x0b4c7e4d)` tuple). Exact insertion slot identified in §4.
- **ETH-in is the materially-new behavior** vs the frozen stable_ng arm: legacy `add_liquidity` is `@payable`, so `valueWei = parsedAmounts[0]` when `amounts[0] > 0` (coin 0 = ETH sentinel), and the ERC-20 allowance pre-flight MUST skip index 0. Exact mirror of `prepare_curve_swap`'s `isEthIn` logic (`prepare_curve_swap.ts:322-326, 350-369`). `valueWei` is a `payloadFingerprint` dimension → two fixtures (ETH-in CRV-D + stETH-only CRV-E) are warranted (§6).
- **FROZEN-area zero-diff holds** (CONTEXT D-06): `payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts`, `send_transaction.ts` untouched. `preview_send.ts` additive-only (new selector in the Curve arm's selector set + new `"add_liquidity-legacy"` case in `buildCurveDecodedArgsBlock`).

**Primary recommendation:** Single plan (43-01), TDD, mirroring `prepare_curve_swap`'s legacy/stable_ng split for `add_liquidity`. Add a SEPARATE legacy `calc_token_amount` ABI + reader (do not reuse the dynamic-array reader). Selectors VERIFIED: `addLiquidityLegacy = 0x0b4c7e4d`, `calcTokenAmountLegacy = 0xed8e84f3` (pin via byte-identity test). Ship two fixtures (CRV-D ETH-in, CRV-E stETH-only).

---

## 2. OQ-1 verdict — `calc_token_amount` on the legacy stETH/ETH pool

| Field | Verdict | Source |
|-------|---------|--------|
| **Exact signature** | `calc_token_amount(uint256[2] amounts, bool is_deposit) view returns (uint256)` | [VERIFIED: StableSwapSTETH.vy `@view @external def calc_token_amount(amounts: uint256[N_COINS], is_deposit: bool) -> uint256`, N_COINS=2] |
| **Selector** | `0xed8e84f3` | [VERIFIED: viem.toFunctionSelector("function calc_token_amount(uint256[2],bool)")] |
| **Array shape** | FIXED-SIZE `uint256[2]` — NOT the dynamic `uint256[]` the stable_ng reader uses. | [VERIFIED: N_COINS=2 fixed array in Vyper source] |
| **Has bool?** | YES — param name `is_deposit`. Pass `true` for deposit direction, identical to stable_ng arm. | [VERIFIED: Vyper source + curve.readthedocs] |
| **`view`?** | YES — read-only quote, callable via `eth_call` at prepare time. | [VERIFIED: `@view` decorator] |
| **Usable to derive `min_mint_amount`?** | YES. `quotedLp = calc_token_amount([eth, steth], true)`, then `minMintAmount = (quotedLp * (10000n - BigInt(slippageBps))) / 10000n` — identical bigint math to the stable_ng arm (`prepare_curve_add_liquidity.ts:289`). | — |
| **Exact ABI string to add** | `CURVE_LEGACY_CALC_TOKEN_AMOUNT_ABI = parseAbi(["function calc_token_amount(uint256[2] amounts, bool is_deposit) view returns (uint256)"])` in `src/chains/curve.ts`. | [VERIFIED] |
| **New reader required?** | YES — `getCurveLegacyCalcTokenAmount(client, poolAddress, amounts: [bigint, bigint]): Promise<bigint>` wired through `_curveChain`. Do NOT reuse `getCurveCalcTokenAmount` — its `uint256[]` ABI encodes a dynamic-array offset+length the legacy fixed-array contract does not expect → revert or wrong decode. | — |

**Source-of-truth (all VERIFIED this session against primary artifacts):**
- `[VERIFIED: StableSwapSTETH.vy GitHub raw]` — `N_COINS=2`; `@view @external def calc_token_amount(amounts: uint256[N_COINS], is_deposit: bool) -> uint256`. Exact bool param name is `is_deposit`.
- `[VERIFIED: Etherscan 0xDC24316… ABI]` — `calc_token_amount(uint256[2] amounts, bool is_deposit)` present on the deployed contract.
- `[VERIFIED: curve.readthedocs.io/exchange-pools.html]` — plain StableSwap `calc_token_amount(_amounts: uint256[N_COINS], _is_deposit: bool) → uint256: view`.
- `[VERIFIED: viem.toFunctionSelector local run]` — selector `0xed8e84f3`.

**Fallback:** NOT NEEDED. `calc_token_amount(uint256[2], bool)` is confirmed present and usable by three independent sources. (`get_virtual_price()` exists too — selector `0xbb7b8b80` per viem — but is not required.)

---

## 3. OQ-2 verdict — exact legacy `add_liquidity` signature + selector

| Field | Verdict | Source |
|-------|---------|--------|
| **Exact signature** | `add_liquidity(uint256[2] amounts, uint256 min_mint_amount) payable returns (uint256)` | [VERIFIED: StableSwapSTETH.vy `@payable @external @nonreentrant('lock') def add_liquidity(amounts: uint256[N_COINS], min_mint_amount: uint256) -> uint256`] |
| **Selector** | `0x0b4c7e4d` | [VERIFIED: Etherscan method id `0x0b4c7e4d` AND viem.toFunctionSelector("function add_liquidity(uint256[2],uint256)") — both agree] |
| **Array shape** | FIXED-SIZE `uint256[2]` (the 2-coin stETH pool, N_COINS=2). | [VERIFIED] |
| **`@payable`?** | YES — required for the ETH leg (coin 0 = ETH sentinel). `msg.value` carries the ETH. | [VERIFIED: `@payable` decorator; Etherscan marks payable] |
| **Returns?** | `uint256` (minted LP amount) — NOT void. | [VERIFIED: `-> uint256` in Vyper source] |
| **ABI string to add** | `CURVE_LEGACY_ADD_LIQUIDITY_ABI = parseAbi(["function add_liquidity(uint256[2] amounts, uint256 min_mint_amount) payable returns (uint256)"])` (matches CONTEXT D-04 verbatim). | [VERIFIED] |
| **Distinct from stable_ng?** | YES — `0x0b4c7e4d` (legacy `uint256[2]`) ≠ `0xb72df5de` (stable_ng `uint256[]`). | [VERIFIED: viem computed both] |

**Selector pin discipline (permanent drift guard — do NOT skip even though VERIFIED):**
`0x0b4c7e4d` is confirmed by Etherscan + viem this session. Task 1 still pins it via the byte-identity test, mirroring how all 5 existing `CURVE_SELECTORS` are anchored (`src/protocols/curve.ts:70-81` + byte-identity describe block):
```ts
expect(CURVE_SELECTORS.addLiquidityLegacy).toBe(
  toFunctionSelector("function add_liquidity(uint256[2],uint256)"),  // → 0x0b4c7e4d
);
expect(CURVE_SELECTORS.addLiquidityLegacy).not.toBe(CURVE_SELECTORS.addLiquidityNg); // 0x0b4c7e4d ≠ 0xb72df5de
```
The Etherscan/viem verification was a one-time SOT check; the test is the forever guard.

**Source-of-truth (all VERIFIED this session):**
- `[VERIFIED: StableSwapSTETH.vy GitHub raw]` — `@payable`, fixed `uint256[2]` (N_COINS=2), `-> uint256` return.
- `[VERIFIED: Etherscan 0xDC24316…]` — `add_liquidity(uint256[2],uint256)`, payable, method id `0x0b4c7e4d`.
- `[VERIFIED: viem.toFunctionSelector]` — `0x0b4c7e4d` (matches Etherscan).
- `[VERIFIED: CONTEXT.md D-04]` — ABI string pre-locked; now confirmed correct against the deployed contract.

---

## 4. OQ-3 verdict — tuple-dispatch negative slot

**Where the new decode branch goes** (`src/protocols/curve.ts`):
- **`CURVE_SELECTORS` table (lines 70-81):** add a 6th entry `addLiquidityLegacy: "0x0b4c7e4d" as Hex` [VERIFIED] with doc comment `/** Legacy add_liquidity(uint256[2],uint256) — stETH/ETH pool. selector = 0x0b4c7e4d */`.
- **`CurveDecoded` union (lines 162-190):** add a 4th variant:
  ```ts
  | {
      kind: "add_liquidity-legacy";
      pool: CurvePoolEntry;
      amounts: [bigint, bigint];   // fixed 2-tuple
      minMintAmount: bigint;
      isEthIn: boolean;            // amounts[0] > 0 && coins[0] === ETH_SENTINEL
    }
  ```
- **`decodeCurveCall` dispatch (lines 226-300):** insert a NEW guarded branch AFTER the `("stable_ng", addLiquidityNg)` branch (lines 281-297) and BEFORE the final `return null` (line 300):
  ```ts
  if (pool.abiVersion === "legacy" && sel === CURVE_SELECTORS.addLiquidityLegacy) {
    const { args } = decodeFunctionData({ abi: CURVE_LEGACY_ADD_LIQUIDITY_ABI, data });
    const [amounts, minMintAmount] = args as [readonly [bigint, bigint], bigint];
    const isEthIn =
      amounts[0] > 0n && getAddress(pool.coins[0] as Address) === ETH_SENTINEL;
    return {
      kind: "add_liquidity-legacy",
      pool,
      amounts: [amounts[0], amounts[1]],
      minMintAmount,
      isEthIn,
    };
  }
  ```
  Import `CURVE_LEGACY_ADD_LIQUIDITY_ABI` from `../chains/curve.js` (add to the import block at lines 34-38). `ETH_SENTINEL` already exists at `src/protocols/curve.ts:195`.

**Where the negative-test slot goes** (`test/protocols-curve.test.ts`, existing `describe("decodeCurveCall — (tx.to, selector) tuple dispatch")` block — analog to the add_liquidity negative at 34-03-PLAN.md line 248):
- POSITIVE: decode legacy add_liquidity calldata against the stETH/ETH pool (`0xDC24316…`) → `kind: "add_liquidity-legacy"`, `amounts` extracted, `isEthIn === true` for `[1e18, 0]`.
- **NEGATIVE (load-bearing):** decode the SAME legacy calldata against a stable_ng pool (PayPool `0x383E6b…`) → `null`. No `("stable_ng", 0x0b4c7e4d)` branch exists; the `("stable_ng", addLiquidityNg)` guard does not match `0x0b4c7e4d`.
- **REVERSE NEGATIVE (already exists, keep):** stable_ng `add_liquidity` (`0xb72df5de`) against the legacy stETH pool → `null` (no `("legacy", addLiquidityNg)` branch). Phase 34 test (34-03-PLAN.md line 248) stays green unchanged — confirm it still passes.

---

## 5. Implementation guidance (per file)

### 5.1 `src/chains/curve.ts` — ABI shelf + readers (additive)
Add after `CURVE_NG_CALC_TOKEN_AMOUNT_ABI` (line 100):
```ts
/** Legacy stETH/ETH pool add_liquidity ABI. Source: StableSwapSTETH.vy — @payable,
 *  fixed uint256[2], returns uint256. Selector 0x0b4c7e4d (VERIFIED Etherscan + viem),
 *  distinct from stable_ng 0xb72df5de.
 *  Caller note: when amounts[0] > 0 (ETH-in), set tx.value = amounts[0] (@payable). */
export const CURVE_LEGACY_ADD_LIQUIDITY_ABI = parseAbi([
  "function add_liquidity(uint256[2] amounts, uint256 min_mint_amount) payable returns (uint256)",
]);

/** Legacy stETH/ETH pool calc_token_amount ABI. Fixed uint256[2] + bool is_deposit.
 *  Selector 0xed8e84f3 (VERIFIED viem). Distinct from the stable_ng dynamic uint256[]
 *  form — do NOT reuse the NG reader. */
export const CURVE_LEGACY_CALC_TOKEN_AMOUNT_ABI = parseAbi([
  "function calc_token_amount(uint256[2] amounts, bool is_deposit) view returns (uint256)",
]);
```
Add a reader mirroring `getCurveCalcTokenAmount` (lines 159-170) but with the fixed-array ABI + 2-tuple args:
```ts
export async function getCurveLegacyCalcTokenAmount(
  client: PublicClient,
  poolAddress: Address,
  amounts: [bigint, bigint],
): Promise<bigint> {
  return (await client.readContract({
    address: poolAddress,
    abi: CURVE_LEGACY_CALC_TOKEN_AMOUNT_ABI,
    functionName: "calc_token_amount",
    args: [amounts, true], // true = deposit direction
  })) as bigint;
}
```
Extend `_curveChain` (line 205): `export const _curveChain = { getCurveGetDy, getCurveCalcTokenAmount, getCurveLegacyCalcTokenAmount, getCurveLpBalance };`

### 5.2 `src/protocols/curve.ts` — encoder + selector + decoder branch (additive)
- Import `CURVE_LEGACY_ADD_LIQUIDITY_ABI` (add to lines 34-38 import block).
- `CURVE_SELECTORS` (lines 70-81): add `addLiquidityLegacy: "0x0b4c7e4d" as Hex` [VERIFIED]. (Optionally add `calcTokenAmountLegacy: "0xed8e84f3" as Hex` only if a test asserts the legacy quote selector — not required, since the reader uses the ABI directly.)
- Add the param interface:
  ```ts
  export interface AddLiquidityLegacyParams {
    amounts: [bigint, bigint];
    minMintAmount: bigint;
  }
  ```
- Add the encoder (mirror `encodeAddLiquidityStableNg` at lines 150-156):
  ```ts
  export function encodeAddLiquidityLegacy(params: AddLiquidityLegacyParams): Hex {
    return encodeFunctionData({
      abi: CURVE_LEGACY_ADD_LIQUIDITY_ABI,
      functionName: "add_liquidity",
      args: [params.amounts, params.minMintAmount],
    });
  }
  ```
  NOTE: viem encodes `uint256[2]` as a fixed 2-word inline tuple (NO offset/length prefix), distinct from `uint256[]` which encodes offset + length + elements. This is the byte-shape distinction the fixtures anchor (§7 Pitfalls).
- Add the `CurveDecoded` variant + decode branch per OQ-3 §4.
- Extend `_curveProtocol` (lines 315-320): add `encodeAddLiquidityLegacy` to the indirection object AT WRITE TIME (CLAUDE.md ESM spy-affordance rule — at write time, not retroactively).

### 5.3 `src/tools/prepare_curve_add_liquidity.ts` — replace refusal with dispatch arm
- Add the `ETH_SENTINEL` constant (copy from `prepare_curve_swap.ts:127-129`):
  ```ts
  const ETH_SENTINEL: Address = getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
  ```
- **Delete the refusal block (lines 176-191).** The handler then proceeds to amounts validation for BOTH abiVersions; the legacy/stable_ng split happens at the QUOTE + ENCODE steps:
  - **Step 8 (quote) becomes abiVersion-dispatched:**
    ```ts
    let quotedLp: bigint;
    if (pool.abiVersion === "legacy") {
      quotedLp = await _curveChain.getCurveLegacyCalcTokenAmount(
        client, pool.address, [parsedAmounts[0]!, parsedAmounts[1]!],
      );
    } else {
      quotedLp = await _curveChain.getCurveCalcTokenAmount(client, pool.address, parsedAmounts);
    }
    ```
  - **Step 10 (encode + valueWei) becomes the two-arm dispatch** (mirror `prepare_curve_swap.ts:320-344`):
    ```ts
    const isEthIn =
      pool.abiVersion === "legacy" &&
      parsedAmounts[0]! > 0n &&
      getAddress(pool.coins[0]!) === ETH_SENTINEL;
    let data: Hex;
    let valueWei: bigint;
    if (pool.abiVersion === "legacy") {
      data = _curveProtocol.encodeAddLiquidityLegacy({
        amounts: [parsedAmounts[0]!, parsedAmounts[1]!],
        minMintAmount,
      });
      valueWei = isEthIn ? parsedAmounts[0]! : 0n;
    } else {
      data = _curveProtocol.encodeAddLiquidityStableNg({ amounts: parsedAmounts, minMintAmount });
      valueWei = 0n;
    }
    ```
    The stable_ng arm is BYTE-IDENTICAL to the current lines 295-299 (`valueWei = 0n`) — Fixture CRV-C must still pass unchanged.
  - **Step 11 (approval pre-flight) skips the ETH-sentinel coin** (D-03). The existing loop (lines 306-335) already skips `coinAmount === 0n` (line 309); ADD a sentinel guard so the ETH leg never triggers an ERC-20 `allowance` read:
    ```ts
    if (coinAmount === 0n) continue;
    if (getAddress(coinAddr) === ETH_SENTINEL) {
      approvalHints.push(`Coin[${idx}] is native ETH (sentinel) — no ERC-20 approval needed; tx.value carries the ETH.`);
      continue;
    }
    ```
- **DESCRIPTION + CHECKS PERFORMED text:** remove "REFUSED for: legacy pools (deferred…)" from the DESCRIPTION (lines 66-77). The "Legacy refusal: not triggered" line in CHECKS PERFORMED (line 377) becomes a live `abiVersion` echo + `ETH-in path: ${isEthIn}` + `tx.value (valueWei): ${valueWei}` (currently hard-coded `0` at line 382 — make it dynamic). Keep the Sandwich-MEV line.
- **Handle args:** include `valueWei: valueWei.toString()` in the `createHandle` args — valueWei now varies (was always 0), so surface it in the receipt.

### 5.4 `src/tools/preview_send.ts` — additive decode case (D-06)
- Add `CURVE_SELECTORS.addLiquidityLegacy` (`0x0b4c7e4d`) to the Curve arm's selector-set membership test so the `(tx.to ∈ Curve registry AND selector ∈ CURVE_SELECTORS)` tuple gate admits the new selector.
- In `buildCurveDecodedArgsBlock`, add a `case "add_liquidity-legacy":` arm rendering a `[CURVE ADD LIQUIDITY]` block with per-coin amounts, `minMintAmount`, `ETH-in: <bool>`, `tx.value`, and the Sandwich-MEV documentation line. Mirror the existing `"add_liquidity-stable_ng"` case. If the existing `else if` selector union can't extend additively without restructuring, prefer a clean separate-arm restructure over an in-place rewrite that risks the stable_ng path (CONTEXT D-06).

### 5.5 No `register-all.ts` change
The tool is already registered (Phase 34). No new MCP tool, no new error code, no import slot.

---

## 6. Fixtures (CLAUDE.md hardcoded-0x-literal discipline)

Add to `test/signing-fingerprint.test.ts`, exported, placeholder-literal workflow, NO `beforeAll`-snapshot. Both anchor the stETH/ETH legacy pool (`0xDC24316…`) and the new `encodeAddLiquidityLegacy` encoder.

**Fixture CRV-D — ETH-in path (REQUIRED, D-05):**
- Inputs: `amounts = [1_000000000000000000n /* 1 ETH */, 0n]`, `minMintAmount = 950_000000000000000n` (fixed literal, deposit-direction).
- `tx = { chainId: 1, to: stETHPool, valueWei: 1_000000000000000000n, data: encodeAddLiquidityLegacy(...) }`.
- Anchors: (a) the `uint256[2]` fixed-array calldata byte-shape (no dynamic offset/length), (b) `valueWei > 0` flowing into the fingerprint preimage, (c) the selector prefix — assert `data.slice(0,10) === "0x0b4c7e4d"` BEFORE the fp assertion (mirrors the Compound/Lido fixture style at e.g. lines 342, 535).

**Fixture CRV-E — stETH-only path (WARRANTED — add it, D-05a lean = yes):**
- Inputs: `amounts = [0n, 1_000000000000000000n /* 1 stETH */]`, same `minMintAmount`.
- `tx = { ..., valueWei: 0n, data: encodeAddLiquidityLegacy(...) }`.
- Anchors the `valueWei = 0n` branch. **Justification:** `valueWei` is a `payloadFingerprint` dimension (`computePayloadFingerprint({chainId,to,valueWei,data})` — `prepare_curve_add_liquidity.ts:340-341`). CRV-D and CRV-E share an encoder but differ in `valueWei` AND `amounts` ordering → DIFFERENT fingerprints. This is exactly the preimage-divergence class the fixture discipline exists to catch (cf. Compound Fixture S vs T, Phase 28). Add a distinctness assertion `expect(new Set([CRV_D, CRV_E]).size).toBe(2)`.

**Cross-links (per CLAUDE.md):**
- `test/protocols-curve.test.ts`: re-compute both via `_curveProtocol.encodeAddLiquidityLegacy` + `computePayloadFingerprint`, assert === imported `FIXTURE_CRV_D_FP` / `FIXTURE_CRV_E_FP` (encoder-layer regression).
- `test/prepare-curve-add-liquidity.test.ts`: call the handler with CRV-D inputs (ETH-in, `amounts: ["1","0"]`, stETH/ETH pool, stub `getCurveLegacyCalcTokenAmount`), assert `structuredContent.payloadFingerprint === FIXTURE_CRV_D_FP` AND `valueWei === "1000000000000000000"` (tool-layer end-to-end). Repeat for CRV-E (`amounts: ["0","1"]`, `valueWei === "0"`).

Do NOT invent a different regression style — follow the existing CRV-A/B/C pattern exactly (export the const, assert selector-before-fp, cross-link from consumer tests).

---

## 7. Pitfalls

1. **Fixed `uint256[2]` vs dynamic `uint256[]` viem encoding (LOAD-BEARING).** viem encodes `uint256[2]` as TWO inline 32-byte words with NO offset/length prefix; `uint256[]` encodes an offset word + length word + elements. Reusing the stable_ng encoder/reader/ABI against the legacy fixed-array contract produces wrong calldata → on-chain revert or wrong decode. This is WHY separate `CURVE_LEGACY_ADD_LIQUIDITY_ABI` + `CURVE_LEGACY_CALC_TOKEN_AMOUNT_ABI` + separate reader are mandatory — not optional cleanliness. The fixtures anchor the fixed-array byte-shape.
2. **`@payable` requires `msg.value == amounts[0]` for the ETH leg.** Legacy `add_liquidity` reverts if `valueWei !== amounts[0]` when coin 0 is ETH. Set `valueWei = parsedAmounts[0]` exactly (NOT the sum, NOT rounded). Mirror `prepare_curve_swap.ts:333`.
3. **ETH sentinel index is 0 for this pool, but guard by ADDRESS not index.** coins[0] = `0xEeee…` sentinel. `isEthIn` must compare `getAddress(pool.coins[0]) === ETH_SENTINEL` (not just `index === 0`) — defensive. Mirror `prepare_curve_swap.ts:323-326`.
4. **`calc_token_amount` direction bool.** Pass `true` (deposit). `false` computes a withdrawal-direction estimate — wrong bound for `add_liquidity` (same trap as `src/chains/curve.ts:94-96`).
5. **Selector collision discipline.** `add_liquidity(uint256[2],uint256)` = `0x0b4c7e4d` ≠ `add_liquidity(uint256[],uint256)` = `0xb72df5de`. Pin via byte-identity test; also assert distinctness `expect(...addLiquidityLegacy).not.toBe(...addLiquidityNg)`.
6. **Return clause is `uint256` (VERIFIED), not void.** `add_liquidity(...) -> uint256` per the Vyper source; the ABI string includes `returns (uint256)`. (The `returns` clause never enters the selector or encoded calldata, so the fixtures are robust regardless — but the verified clause is `uint256`.)
7. **Stable_ng arm must stay byte-frozen.** Fixture CRV-C (`0x2762d8…`) must pass unchanged after the refactor. Run `npx vitest run test/signing-fingerprint.test.ts` and confirm CRV-C green BEFORE and AFTER the dispatch-arm edit. Any CRV-C drift means the stable_ng path was accidentally touched.
8. **Approval pre-flight must skip the ETH leg.** Reading `ERC20.allowance` on the ETH sentinel address (`0xEeee…`) is meaningless and will RPC-error. Skip index 0 when it's the sentinel (D-03).
9. **FROZEN zero-diff.** Assert `git diff --stat origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts` returns ZERO lines in success criteria (CONTEXT D-06).

---

## 8. Validation Architecture

> nyquist_validation = true (config.json). REQUIRED — generates VALIDATION.md.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (project-pinned) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/protocols-curve.test.ts test/signing-fingerprint.test.ts test/prepare-curve-add-liquidity.test.ts` |
| Full suite command | `npx vitest run` |

### Behaviors needing tests → test map
| Behavior | Test type | File | Anchor |
|----------|-----------|------|--------|
| Legacy `add_liquidity` selector === `0x0b4c7e4d` byte-identity vs `viem.toFunctionSelector` | unit | `test/protocols-curve.test.ts` | OQ-2 |
| Legacy selector ≠ stable_ng selector (`0x0b4c7e4d` ≠ `0xb72df5de`) | unit | `test/protocols-curve.test.ts` | Pitfall 5 |
| `encodeAddLiquidityLegacy` calldata shape — fixed `uint256[2]` (no dynamic offset/length), selector prefix | unit | `test/protocols-curve.test.ts` | Pitfall 1 |
| `decodeCurveCall("legacy", 0x0b4c7e4d)` on stETH pool → `add_liquidity-legacy`, amounts + isEthIn extracted | unit | `test/protocols-curve.test.ts` | OQ-3 positive |
| `decodeCurveCall(legacy add_liquidity calldata, stable_ng pool addr)` → `null` | unit | `test/protocols-curve.test.ts` | OQ-3 negative (LOAD-BEARING) |
| `decodeCurveCall(stable_ng add_liquidity 0xb72df5de, legacy pool addr)` → `null` | unit | `test/protocols-curve.test.ts` | OQ-3 reverse negative (Phase 34 test stays green) |
| `_curveProtocol` indirection has `encodeAddLiquidityLegacy` key | unit | `test/protocols-curve.test.ts` | spy-affordance drift gate |
| Fixture CRV-D (ETH-in) hardcoded fp + selector-before-fp | unit | `test/signing-fingerprint.test.ts` | §6 |
| Fixture CRV-E (stETH-only) hardcoded fp | unit | `test/signing-fingerprint.test.ts` | §6 |
| CRV-D ≠ CRV-E fingerprint distinctness | unit | `test/signing-fingerprint.test.ts` | valueWei is a fingerprint dimension |
| CRV-C (stable_ng) still green (byte-frozen) | unit | `test/signing-fingerprint.test.ts` | Pitfall 7 |
| Encoder cross-link: `_curveProtocol.encodeAddLiquidityLegacy` + fp === CRV-D / CRV-E | unit | `test/protocols-curve.test.ts` | encoder-layer regression |
| Tool ETH-in path: handler `amounts:["1","0"]` on stETH pool → `valueWei === "1000000000000000000"`, selector `0x0b4c7e4d`, fp === CRV-D | unit | `test/prepare-curve-add-liquidity.test.ts` | tool-layer cross-link (LOAD-BEARING) |
| Tool stETH-only path: handler `amounts:["0","1"]` → `valueWei === "0"`, fp === CRV-E | unit | `test/prepare-curve-add-liquidity.test.ts` | §6 |
| Tool approval pre-flight SKIPS ETH sentinel coin (no allowance read on `0xEeee…`) | unit | `test/prepare-curve-add-liquidity.test.ts` | Pitfall 8 / D-03 |
| Tool legacy quote uses `getCurveLegacyCalcTokenAmount` (fixed-array reader), NOT the NG reader | unit | `test/prepare-curve-add-liquidity.test.ts` | OQ-1; spy `_curveChain.getCurveLegacyCalcTokenAmount` |
| Stable_ng arm UNCHANGED: handler on PayPool still `valueWei === "0"`, selector `0xb72df5de` | unit | `test/prepare-curve-add-liquidity.test.ts` | Pitfall 7 |
| Legacy refusal GONE: handler on stETH pool no longer returns INVALID_INPUT "deferred" | unit | `test/prepare-curve-add-liquidity.test.ts` | the gap being lifted |
| preview_send `[CURVE ADD LIQUIDITY]` block for legacy decode + ETH-in surface + MEV line | unit | `test/preview-send-curve.test.ts` | §5.4 |
| preview_send tuple gate admits `0x0b4c7e4d` only with a registered Curve `tx.to` | unit | `test/preview-send-curve.test.ts` | D-06 |
| FROZEN zero-diff on signing chain | shell gate | success criteria | Pitfall 9 |

### Sampling rate
- **Per task commit:** `npx vitest run test/protocols-curve.test.ts test/signing-fingerprint.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** full suite green before `/gsd-verify-work`; FROZEN zero-diff asserted.

### Wave 0 gaps
None — all four target test files already exist (Phase 34). This phase EXTENDS them with the legacy cases. No new framework install, no new test file, no shared-fixture file.

---

## 9. Package Legitimacy Audit

**No new packages.** All encoding/decoding uses the project's existing `viem` (`encodeFunctionData`, `decodeFunctionData`, `parseAbi`, `toFunctionSelector`, `getAddress`). slopcheck N/A — zero external packages introduced.

| Package | Registry | Disposition |
|---------|----------|-------------|
| viem | npm | Already installed (project dep) — no new install, no re-audit |

---

## 10. Security Domain

> security_enforcement = true, ASVS L2.

| ASVS Category | Applies | Control |
|---------------|---------|---------|
| V4 Access Control | yes | Canonical-dispatch (Layer 0.5) gates the stETH pool `tx.to`; preview_send tuple gate `(tx.to ∈ registry AND selector ∈ CURVE_SELECTORS)` admits `0x0b4c7e4d` only for the registered pool |
| V5 Input Validation | yes | `amounts.length === pool.coins.length` (existing, line 198); `slippageBps ∈ [1,5000]` (existing, line 219); per-element `parseAmountStrict` (existing, line 244) |
| V6 Cryptography | yes | `payloadFingerprint` over `{chainId,to,valueWei,data}` now covers the legacy fixed-array calldata AND the ETH-in `valueWei`; Fixtures CRV-D/E anchor byte-stability |

| Threat | STRIDE | Mitigation |
|--------|--------|-----------|
| Wrong ABI (legacy fixed-array vs stable_ng dynamic) → malformed signed calldata | Tampering | Separate `CURVE_LEGACY_ADD_LIQUIDITY_ABI`; Fixtures CRV-D/E anchor the fixed-array byte-shape; selector byte-identity test |
| ETH-in `valueWei` drift between prepare and send | Tampering | `valueWei` in `payloadFingerprint` preimage; PREP-08 send-time re-check refuses drift (FROZEN send path unchanged) |
| Legacy selector mis-routed as stable_ng (or vice versa) | Tampering | `(abiVersion, selector)` tuple dispatch; OQ-3 negative tests |
| `min_mint_amount = 0` via loose slippage | Tampering | `slippageBps ≤ 5000` footgun cap (existing); CHECKS PERFORMED surfaces exact `min_mint_amount` |

---

## 11. Open questions remaining

| # | Question | Resolution | Blocks plan? |
|---|----------|------------|--------------|
| RQ-1 | Exact `calc_token_amount` param name / `add_liquidity` return clause on the deployed contract | RESOLVED: param `is_deposit`; `add_liquidity` returns `uint256`. [VERIFIED: StableSwapSTETH.vy + Etherscan] | NO |
| RQ-2 | The two new `0x` selectors | RESOLVED: `addLiquidityLegacy = 0x0b4c7e4d`, `calc_token_amount(uint256[2],bool) = 0xed8e84f3`. [VERIFIED: Etherscan + viem] Still pinned via byte-identity test (permanent drift guard). | NO |
| RQ-3 | Real-Ledger UAT: ETH-in legacy add_liquidity signs with correct on-device `msg.value` display | `/gsd-verify-work` hardware smoke (1 ETH stETH/ETH add_liquidity) | NO — hardware-UAT item, not a plan blocker |

No remaining unverified ABI claims.

---

## Sources

### Primary (HIGH — VERIFIED this session against primary artifacts)
- **`StableSwapSTETH.vy` (curvefi/curve-contract, GitHub raw)** — `N_COINS=2`; `@payable @external @nonreentrant('lock') def add_liquidity(amounts: uint256[N_COINS], min_mint_amount: uint256) -> uint256`; `@view @external def calc_token_amount(amounts: uint256[N_COINS], is_deposit: bool) -> uint256`; `@payable ... def exchange(i, j, dx, min_dy) -> uint256`; `@view def get_virtual_price() -> uint256`.
- **Etherscan deployed contract `0xDC24316b9AE028F1497c275EB9192a3Ea0f67022`** — `add_liquidity(uint256[2],uint256)` payable, method id `0x0b4c7e4d`; `calc_token_amount(uint256[2], bool is_deposit)`.
- **viem.toFunctionSelector (local, node v22.19.0 + project viem)** — `add_liquidity(uint256[2],uint256)=0x0b4c7e4d` (matches Etherscan), `calc_token_amount(uint256[2],bool)=0xed8e84f3`, `get_virtual_price()=0xbb7b8b80`, stable_ng `add_liquidity(uint256[],uint256)=0xb72df5de` (distinctness confirmed).
- **curve.readthedocs.io/exchange-pools.html** — plain StableSwap `add_liquidity(uint256[N_COINS], uint256) → uint256`, `calc_token_amount(uint256[N_COINS], bool _is_deposit) → uint256: view`.
- `.planning/phases/34-evm-curve-swap-add-liquidity/34-RESEARCH.md` lines 288, 560, 572, 582-585 — in-repo prior research, now corroborated by the above.

### In-repo (HIGH — code read in full this session)
- `src/protocols/curve.ts`, `src/chains/curve.ts`, `src/tools/prepare_curve_swap.ts`, `src/tools/prepare_curve_add_liquidity.ts`, `src/config/contracts.ts` (registry 933-1109), `test/signing-fingerprint.test.ts` (CRV-A/B/C convention), `43-CONTEXT.md` (D-01..D-06).

## Metadata
- **Confidence:** OQ-1 HIGH (VERIFIED 3 sources); OQ-2 HIGH (VERIFIED selector + ABI, 3 sources); OQ-3 HIGH (structural). Implementation guidance HIGH (mirrors proven in-tree swap pattern). No remaining unverified ABI claims.
- **Research date:** 2026-05-30
- **Valid until:** 2026-06-29 (stable — single registered pool, no TVL-drift dependency; ABI shapes are immutable deployed-contract facts).
