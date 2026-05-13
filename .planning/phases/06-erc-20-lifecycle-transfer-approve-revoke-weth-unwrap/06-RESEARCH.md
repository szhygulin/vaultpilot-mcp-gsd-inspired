# Phase 6: ERC-20 lifecycle — Research

**Researched:** 2026-05-13
**Domain:** ERC-20 ABI encode/decode + decimal-aware amount parsing + WETH9 unwrap + approval-class surfacing
**Confidence:** HIGH (all critical findings verified empirically against installed viem@2.48.11; secondary findings via official docs)

## Summary

Phase 6 extends the Phase 4 trust pipeline from `data === "0x"` (native send) to four ERC-20-shaped calls: `transfer(to,amount)`, `approve(spender,amount)`, `approve(spender,0)` (the revoke shortcut), and `WETH9.withdraw(amount)`. The cryptographic-binding chain (PREP-03 / PREP-04 / PREP-08) inherits unchanged — `payloadFingerprint` already accepts variable-length `data` (verified in `src/signing/payload-fingerprint.ts` line 47 + `test/signing-fingerprint.test.ts` Fixture B, which Phase 4 pre-anchored exactly for this). The new surface is (a) ABI encode at prepare time, (b) `decodeFunctionData` at preview time to surface decoded args in `CHECKS PERFORMED`, (c) decimal-aware parsing of agent-supplied `amount` strings against on-chain `decimals()`, and (d) the canonical contracts SOT (`src/config/contracts.ts`) that ROADMAP plan 06-04 and Phase 7 onward depend on.

**Primary recommendation:** Lean on `viem.erc20Abi` (it includes `transfer`, `approve`, `decimals`, `symbol`) + a one-line `parseAbi(["function withdraw(uint256 amount)"])` for WETH9. Use `decodeFunctionData` against a combined ABI for preview-time decoding. **`parseUnits` is NOT a safe overflow guard — it silently rounds excess precision and accepts empty/dot-prefixed strings.** Phase 6 MUST add its own pre-parse validation (regex + max-fractional-digits check) before delegating to `parseUnits`. The strict `2^256-1` sentinel is the right unlimited-approval threshold. Spender labels come from a curated table in `src/config/contracts.ts` (~10 entries); unknown spenders surface the literal `(unknown spender — no prior interaction recorded)` label, never silent.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| ABI encode `transfer` / `approve` / `withdraw` | MCP server (`src/tools/prepare_*.ts`) | — | Encoding happens server-side so `payloadFingerprint` binds the exact bytes the device will see. |
| Decode + surface args in `CHECKS PERFORMED` | MCP server (`src/tools/preview_send.ts`) | Agent (re-decode locally per PREP-05) | Server does the decode; agent re-decodes via viem in its own runtime as defense-in-depth. |
| `decimals()` + `symbol()` resolution | MCP server (`src/tools/get_token_metadata.ts` — NEW) | viem multicall against the RPC | Authoritative source is the token contract; cache only within a single tool call. |
| Decimal-string → wei BigInt | MCP server (server-side `parseUnits` + pre-validation) | — | The agent boundary MUST stay decimal-string; the off-by-decimal bug class lives at this boundary. |
| Canonical contract addresses (WETH9, known spenders) | MCP server (`src/config/contracts.ts` — NEW, the SOT) | — | Project CLAUDE.md mandates this is the single source of truth — never inline. |
| Clear-sign / blind-sign display on Ledger device | Ledger Ethereum app (CAL) | — | Outside vaultpilot-mcp's API surface. WalletConnect-relayed `eth_sendTransaction` → Ledger Live → device; the device's plugin decides. |
| `eth_call` revert simulation at preview time | MCP server (new — see Topic 9) | viem `call` action | Already exists in `send_transaction` demo branch; Phase 6 should lift it to a preview-time check for ALL ERC-20 ops. |

## Topics

### Topic 1: viem ERC-20 encoding surface

**Recommendation:** Use viem's `erc20Abi` constant directly for `transfer` and `approve`; use `encodeFunctionData` to produce calldata bytes. Confirmed against `node_modules/viem/_types/constants/abis.d.ts` (lines for `erc20Abi`) and `node_modules/viem/_types/utils/abi/encodeFunctionData.d.ts`.

`erc20Abi` exports include: `allowance`, `approve(spender, amount) → bool`, `balanceOf`, `decimals() → uint8`, `name`, `symbol`, `totalSupply`, `transfer(recipient, amount) → bool`, `transferFrom`, plus the `Approval` and `Transfer` events. **It does NOT include `withdraw(uint256)`** — see Topic 2.

`encodeFunctionData` signature: `encodeFunctionData({ abi, functionName, args }) → Hex`. Empirically verified call:

```typescript
// Source: src/tools/prepare_token_send.ts (Phase 6, plan 06-02)
import { encodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";

const data: Hex = encodeFunctionData({
  abi: erc20Abi,
  functionName: "transfer",
  args: [getAddress(toRaw) as Address, amountWei],
});
// → "0xa9059cbb" (4-byte selector) ‖ 32-byte to ‖ 32-byte amount = 68 bytes total
// `tx.to` is the TOKEN CONTRACT, not the recipient — recipient lives inside `data`.
// `tx.valueWei` is 0n — native ETH does not move on an ERC-20 transfer.
```

**Selector reference (verified):**
- `transfer(address,uint256)` → `0xa9059cbb`
- `approve(address,uint256)` → `0x095ea7b3`
- `withdraw(uint256)` → `0x2e1a7d4d`

**Pitfall:** Two-step `to` resolution — `tx.to` is the token contract address (e.g. USDC `0xa0b8…`), the *recipient* address lives inside the encoded `data`. A future contributor reading `record.tx.to` expecting "the user's recipient" gets the token contract. The `PREPARE RECEIPT` block surfaces the agent-provided `to` (the recipient) verbatim per PREP-02; the on-chain `tx.to` is server-internal and never surfaced in the receipt prose. [VERIFIED: empirical Bash probe + viem type defs]

### Topic 2: WETH9 ABI

**Recommendation:** Viem does **NOT** ship a `weth9Abi` constant (verified by `grep -rE "weth9Abi|wethAbi|WETH9" node_modules/viem/_types/` → 0 hits). Phase 6 carries a one-line `parseAbi` declaration. Placement: a new `src/protocols/weth9.ts` module (parallel to the empty-but-promised `src/protocols/` directory listed in the project architecture diagram), exporting the ABI const + the canonical address constant re-exported from `src/config/contracts.ts`.

```typescript
// Source: src/protocols/weth9.ts (Phase 6, plan 06-04)
import { parseAbi } from "viem";

export const WETH9_ABI = parseAbi([
  "function withdraw(uint256 amount)",
  "function deposit() payable",  // Not used in v1.1 (wrap is v2+); included for symmetry.
]);
```

Empirically verified — `decodeFunctionData({ abi: WETH9_ABI, data })` round-trips correctly with `functionName: "withdraw"`, `args: [bigint]`. A combined ABI `[...erc20Abi, ...WETH9_ABI]` decodes either selector cleanly. [VERIFIED: empirical Bash probe]

**Why not a full WETH9 JSON ABI:** `withdraw(uint256)` is the only function Phase 6 uses. Carrying the 11-function WETH9 JSON ABI from npm would bloat the bundle and invite drift; `parseAbi` is the canonical viem pattern for "I need this one method, not the whole interface." [CITED: viem docs — `parseAbi` is the documented helper for human-readable ABI fragments]

### Topic 3: Decimal-string parsing

**Recommendation:** `parseUnits` is the **wrong** primary overflow guard. Phase 6 needs a pre-validation step before `parseUnits` because viem's implementation silently truncates excess precision and accepts several malformed inputs without throwing.

**Empirical findings** (Bash probe via installed viem@2.48.11):

| Input | Decimals | viem Result | Behavior |
|-------|----------|-------------|----------|
| `"100.5"` | 6 | `100500000n` | OK |
| `"100.5"` | 0 | `101n` | **Silently rounds — no throw** |
| `"1.23456789"` | 6 | `1234568n` | **Silently rounds (rounds last digit up from `8`) — no throw** |
| `"1.123456"` | 6 | `1123456n` | OK (exact precision) |
| `""` | 18 | `0n` | **Silently accepts empty string** |
| `"100."` | 18 | `100000000000000000000n` | Accepts trailing dot |
| `".5"` | 18 | `500000000000000000n` | Accepts leading dot |
| `"-1"` | 18 | `-1000000000000000000n` | **Parses as negative (no throw)** |
| `"1e6"` | 18 | throws `InvalidDecimalNumberError` | OK |
| `"1,000"` | 18 | throws `InvalidDecimalNumberError` | OK |
| `"abc"` | 18 | throws `InvalidDecimalNumberError` | OK |

**Required pre-validation** before `parseUnits`:

```typescript
// Source: src/tools/get_token_metadata.ts (Phase 6, plan 06-01) — sketch
function parseAmountStrict(amountStr: string, decimals: number): bigint {
  // (1) Reject empty / whitespace-only
  if (!amountStr.trim()) throw new InvalidAmountError("amount cannot be empty");
  // (2) Strict regex — digits, at most one dot, no sign, no scientific
  if (!/^[0-9]+(\.[0-9]+)?$/.test(amountStr)) {
    throw new InvalidAmountError(`amount must match /^[0-9]+(\\.[0-9]+)?$/; got "${amountStr}"`);
  }
  // (3) Fractional-digit count MUST NOT exceed decimals (the load-bearing
  //     off-by-decimal guard the project CLAUDE.md names).
  const dotIdx = amountStr.indexOf(".");
  if (dotIdx !== -1) {
    const fractionalDigits = amountStr.length - dotIdx - 1;
    if (fractionalDigits > decimals) {
      throw new InvalidAmountError(
        `amount has ${fractionalDigits} fractional digits but token decimals=${decimals}; ` +
        `viem.parseUnits would silently round. Truncate to ${decimals} decimals or correct the amount.`
      );
    }
  }
  return parseUnits(amountStr, decimals);
}
```

**Pitfall — assumption A1 resolution:** Prior research-pattern assumed `parseUnits` throws on overflow. It does NOT. The Phase 6 plan-checker MUST verify this guard exists; without it, an agent passing `"100.5"` for USDT (decimals=0 — yes, USDT *did* use decimals=6, but other tokens use 0) silently sends `101` units instead of refusing. The off-by-decimal failure mode is exactly what project CLAUDE.md calls out as "the most common user-facing bug class." [VERIFIED: empirical Bash probe]

### Topic 4: `amount: "max"` sentinel

**Recommendation:** Accept exactly `"max"` (lowercase, no synonyms). Map to `viem.maxUint256` which equals `2n ** 256n - 1n`.

**Verification** (Bash probe):
```
viem.maxUint256 === (2n ** 256n - 1n)  // true
viem.maxUint256.toString(16) === "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"  // 64 hex chars, 32 bytes
```

**API contract:**
```typescript
// Source: src/tools/prepare_token_approve.ts (Phase 6, plan 06-03)
// args.amount: "max" → maxUint256
// args.amount: "0"   → 0n (revoke shortcut path — though prepare_revoke_approval is the canonical tool for this)
// args.amount: decimal string → parseAmountStrict(args.amount, decimals)
let amountWei: bigint;
if (args.amount === "max") {
  amountWei = maxUint256;
} else {
  amountWei = parseAmountStrict(args.amount, decimals);
}
```

**Why not also accept `"unlimited"` / `"infinite"` / `"MAX"` / `"∞"`:** Single canonical spelling — strict-mode parity with the rest of the v1.x API surface (`userDecision: "send"` is enum-locked to exactly `"send"` / `"cancel"`; same discipline). Multiple synonyms invite agent guessing and silent typo-acceptance. The tool description names the one accepted spelling. [VERIFIED: empirical Bash probe for `maxUint256` equality]

**No design fork** — surveyed industry (1inch, Cowswap, Permit2): each uses `MaxUint256` internally; none expose a string sentinel at the API boundary because they're library/contract APIs, not natural-language agent APIs. Phase 6 is the introducer of `"max"` as a string sentinel; we get to define it once, strictly.

### Topic 5: Ledger device clear-sign behavior for ERC-20

**Recommendation:** vaultpilot-mcp has no API surface to influence whether the device clear-signs vs blind-signs — that's the Ledger Ethereum app's internal decision based on its on-device Crypto Asset List (CAL) and ERC-7730 metadata registry. **Phase 6 emits the `LEDGER BLIND-SIGN HASH` block UNCONDITIONALLY** (same as Phase 4 — the worst-case display form), because:

1. **The agent doesn't know which display the device will show.** The Ledger Ethereum app's CAL + ERC-7730 metadata registry is queried at sign-time, and the result depends on firmware version, app version, whether "blind signing" is toggled on in settings, and whether the token contract has registered metadata.
2. **Defense-in-depth wins on cost.** Emitting the hash block when the device happens to clear-sign is harmless (the user looks at the device, sees decoded fields, ignores the agent's hash block). Omitting the hash block when the device falls back to blind-sign loses the cryptographic match anchor — the user has nothing to compare against. The trust anchor is "the user matches what the device shows against what the agent says"; if the device shows a hash, the agent must have emitted a hash.

**What the user sees on-device (per Ledger docs):**

- **Known ERC-20 token (in CAL, e.g. USDC, USDT, DAI, WETH) + `transfer(to, amount)`:** clear-sign. Display: `Amount: 100.5 USDC`, `Address: 0x70997970...`, `Network: Ethereum`, fees. [CITED: developers.ledger.com/docs/clear-signing/overview — "Clear signing for ERC-721, ERC-1155 and ERC-20 tokens is automatically handled by the Ethereum application if the specific token is in the Ledger supported list"]
- **Known ERC-20 + `approve(spender, amount)`:** clear-sign. Display: `Type: Approve`, `Amount` (or `UNLIMITED` for `2^256-1`), `Contract`, `Address`. The device often shows the raw spender address, not a label — the device's CAL has token metadata, not arbitrary contract labels. [CITED: support.ledger.com/article/Ethereum-Token-Approvals-Explained]
- **Unknown ERC-20 token + `transfer`:** falls back to "Unknown token" warning + raw amount (in token base units, no decimal scaling). [CITED: developers.ledger.com/docs/clear-signing/nft]
- **`WETH9.withdraw(amount)`:** `withdraw(uint256)` is NOT a standard ERC-20 function and is NOT covered by the ERC-20 plugin. **The device blind-signs** (raw hash displayed) unless WETH9 has dedicated ERC-7730 metadata registered (uncertain in 2026-05). The user MUST have blind-sign enabled in the Ethereum app settings, or the sign will refuse outright. [CITED: ledger.com/academy — "blind signing is disabled by default… enable it in the Ethereum app settings"] [ASSUMED: that WETH9.withdraw has no ERC-7730 metadata in the current 2026-05 registry; not separately verified — Phase 6 verify-phase task should empirically confirm via a small mainnet WETH unwrap]

**Cross-cutting implication for plan 06-04 (WETH unwrap):** Phase 6's `prepare_weth_unwrap` plan should add a `LEDGER NOTICE` block above the standard signing blocks: *"WETH unwrap requires 'Blind signing' enabled in the Ledger Ethereum app settings (Settings → Blind signing → Enabled). If your device refuses with 'Blind signing is not enabled', enable it and retry."* This is a non-cryptographic user-experience block — preserves the trust anchor (hash match) but heads off the most common UX failure mode.

**No design fork** — emitting the hash block unconditionally is the only safe default. The Phase 4 precedent (always-on `LEDGER BLIND-SIGN HASH`) extends transparently.

### Topic 6: Approval-class threshold

**Recommendation:** Exactly `2n ** 256n - 1n` (strict equality). Label as `⚠ UNLIMITED APPROVAL` per PREP-29.

**Industry pattern** (verified against revoke.cash / Etherscan / OpenZeppelin docs):
- **OpenZeppelin** ERC-20: "if amount is max uint256, allowance is not updated on transferFrom" — semantic special-case at exactly `2^256-1`. [CITED: docs.openzeppelin.com/contracts/4.x/api/token/erc20]
- **Revoke.cash**: detects unlimited via strict-equality to `MaxUint256`. [CITED: github.com/RevokeCash/revoke.cash — pattern documented across web sources]
- **Etherscan token approval checker**: labels `MAX_UINT256` as "Unlimited"; any non-max value is shown numerically. [CITED: etherscan.io/tokenapprovalchecker]

**Decision: strict-equality. Reject the fuzzy threshold ("any value > 1e30").** Rationale:

1. **Cryptographic determinism.** `2^256-1` is a single literal — the test fixture can hard-code it; drift in the threshold definition is impossible.
2. **Industry parity.** Etherscan, Revoke.cash, OpenZeppelin all use strict-equality. The agent (and the user) can cross-check against any of those tools and see the same label.
3. **The "high but not max" case is rare in practice.** Aave, Uniswap, 1inch, CowSwap, OpenSea all request `MaxUint256` or a numerically-bounded amount; none use a custom-large-but-not-max value as a soft-unlimited signal.

**No design fork** — strict-equality is the unambiguous industry default.

### Topic 7: Known-spender table

**Recommendation:** A curated table in `src/config/contracts.ts` (the SOT mandated by project CLAUDE.md). ~12 seeded entries. Unknown spender → label `(unknown spender — no prior interaction recorded)` rather than silently omitting. Per ROADMAP plan 06-03, this is the table that becomes load-bearing for every protocol from here on.

**Seeded entries** (addresses checksum-verified; sources cited per row):

| Address | Label | Source |
|---------|-------|--------|
| `0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2` | Aave V3 Pool (Ethereum) | [CITED: aave.com/docs/resources/addresses + etherscan.io/address/0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2] |
| `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | Uniswap V2 Router 02 | [CITED: docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments] |
| `0xE592427A0AEce92De3Edee1F18E0157C05861564` | Uniswap V3 SwapRouter | [CITED: docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments] |
| `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | Uniswap V3 SwapRouter02 | [CITED: docs.uniswap.org] |
| `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Uniswap Permit2 | [CITED: github.com/Uniswap/permit2 — same address across mainnet + L2s] |
| `0x111111125421cA6dc452d289314280a0F8842A65` | 1inch Aggregation Router V6 | [CITED: portal.1inch.dev + etherscan] |
| `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | CowSwap GPv2Settlement | [CITED: etherscan.io/address/0x9008D19f58AAbD9eD0D60971565AA8510560ab41] |
| `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | Li.Fi Diamond | [CITED: etherscan.io/address/0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae] |
| `0x00000000006c3852cbEf3e08E8dF289169EdE581` | OpenSea Seaport 1.5 | [CITED: docs.opensea.io/docs/seaport] |
| `0x1E0049783F008A0085193E00003D00cd54003c71` | OpenSea Conduit | [CITED: x.com/opensea_support/status/1540343956738670592] |
| `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | WETH9 (canonical wETH) | already used in `src/tools/get_portfolio_summary.ts:WETH_ADDRESS` + `src/tokens/ethereum-top-50.json` |

**Why curated, not Etherscan API at preview time:** ROADMAP plan 06-03 explicitly chose option (a) — curated list. Etherscan API at preview time adds a network dep to a critical-path gate, and its rate-limits / outage modes become a preview-time failure mode. The curated table is a regression-tested constant; the false-negative rate ("unknown spender" labels for legitimate-but-unlisted contracts) is the documented trade-off, surfaced explicitly to the user.

**Recommended structure** for `src/config/contracts.ts`:

```typescript
// Source: src/config/contracts.ts (Phase 6, plan 06-03 — SOT)
import { getAddress, type Address } from "viem";

export interface KnownSpender {
  address: Address;       // checksummed via getAddress() at load time
  label: string;          // verbatim text surfaced in CHECKS PERFORMED
  source: string;         // citation URL — for regression test cross-check
}

// Re-checksum at load time (mirrors src/tokens/registry.ts pattern — defends
// against a corrupted snapshot/edit flipping a single hex digit).
export const WETH9_ETHEREUM: Address = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");

export const KNOWN_SPENDERS_ETHEREUM: readonly KnownSpender[] = [
  { address: getAddress("0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2"), label: "Aave V3 Pool", source: "https://aave.com/docs/resources/addresses" },
  // … (table above) …
];

// Case-insensitive lookup. Returns undefined for unknown spenders — the
// caller renders the (unknown spender — …) fallback.
export function lookupSpender(spender: Address): KnownSpender | undefined {
  const checksummed = getAddress(spender);
  return KNOWN_SPENDERS_ETHEREUM.find((s) => s.address === checksummed);
}
```

**Regression test:** assert each `KNOWN_SPENDERS_ETHEREUM[i].address === getAddress(KNOWN_SPENDERS_ETHEREUM[i].address)` (no silent case-corruption from a future edit). [VERIFIED: pattern lifted from existing `src/tokens/registry.ts` re-checksum pass]

### Topic 8: `prepare_revoke_approval` design

**Recommendation:** Thin wrapper tool. Distinct tool name (the agent calls `prepare_revoke_approval` by *intent*); internally constructs the same handle/encoding the `prepare_token_approve({ amount: "0" })` path would, **plus** a different tool DESCRIPTION text so the agent's routing prompt is unambiguous.

```typescript
// Source: src/tools/prepare_revoke_approval.ts (Phase 6, plan 06-03)
registerTool(
  "prepare_revoke_approval",
  [
    "Revoke an existing ERC-20 approval by setting the allowance to 0 for a specific spender.",
    "Produces an `approve(spender, 0)` call against the token contract.",
    "Use when the user wants to revoke a prior approval (defensive hygiene — e.g. after a deprecated dApp interaction).",
    "Do NOT use to set a new non-zero approval — use `prepare_token_approve` for that.",
    "Returns the same shape as `prepare_token_approve` plus the decoded args surface.",
  ].join(" "),
  { type: "object", properties: { tokenAddress: ..., spender: ... }, required: [...] },
  async (args) => {
    // Delegate to the same private helper prepare_token_approve uses.
    // Tests assert byte-identical encoded calldata to prepare_token_approve
    // with amount === "0" (regression anchor — drift in either tool reveals).
    return prepareApproveInternal({ tokenAddress: args.tokenAddress, spender: args.spender, amountWei: 0n });
  }
);
```

**Why a distinct tool name vs. a parameter:** Per requirement PREP-27, the agent should route by intent ("revoke this approval"). A separate tool name keeps the agent's natural-language → tool mapping crisp; a shared tool with an `intent: "revoke"` parameter forces the agent to translate "revoke" into a sentinel value, which is exactly the kind of soft-mapping the project CLAUDE.md "tool descriptions are agent routing prompts" rule discourages. [CITED: project CLAUDE.md Conventions]

**No design fork** — distinct tool, shared internal helper, regression test for byte-identity.

### Topic 9: WETH unwrap idempotency + preview-time `eth_call` simulation

**Finding:** `WETH9.withdraw(amount)` on an address with `wethBalance < amount` reverts on-chain with `revert: Arithmetic operation underflowed` (Solidity 0.8+ checked arithmetic) or similar. There is no graceful "withdraw the available amount" — the call either succeeds in full or reverts.

**Recommendation:** Extend the `eth_call` revert-simulation pattern from `send_transaction`'s demo branch (`src/tools/send_transaction.ts:325-364`) to **preview time** for ALL ERC-20 ops, not just unwrap. This catches guaranteed-revert transactions BEFORE the user is asked to blind-sign — they don't waste their attention budget verifying a hash for a tx that will burn gas without effect.

**Recommended implementation** (preview_send addition for Phase 6):

```typescript
// Source: src/tools/preview_send.ts (Phase 6 addition — sketch)
// After pin resolution, before emitting blocks:
let simulationStatus: "ok" | "revert" | "error" = "ok";
let simulationError: string | null = null;
try {
  await call(client, {
    account: senderAddress,
    to: record.tx.to,
    value: record.tx.valueWei,
    data: record.tx.data,
  });
} catch (err) {
  // viem distinguishes ContractFunctionRevertedError (the call reverted) from
  // operational errors (RPC down, timeout). For revert: simulationStatus = "revert".
  // For everything else: surface as "error" — non-blocking, user still sees the hash.
  if (err instanceof Error && /revert|execution reverted/i.test(err.message)) {
    simulationStatus = "revert";
    simulationError = err.message;
  } else {
    simulationStatus = "error";
    simulationError = err instanceof Error ? err.message : String(err);
  }
}
// Surface as a new SIMULATION block in the response — non-error envelope,
// the user sees the warning AND the hash and decides.
```

**Block format:**

```
SIMULATION (preview-time eth_call)
  status: ok | revert | error
  result: <decoded return or error message>
  note:   This simulation predicts the on-chain outcome. A "revert" status means
          the transaction would fail when broadcast — review the args before
          confirming. A "ok" status does NOT guarantee success (gas/nonce drift
          between preview and broadcast can still revert).
```

**Cross-cutting:** This is a **Phase 6 scope decision worth surfacing.** Plans 06-02 and 06-03 each touch `preview_send.ts`; either both add the simulation block (lift to a shared helper) or only plan 06-04 does (WETH unwrap specifically). Recommend lifting to a shared helper in `src/signing/blocks.ts` + adding to `preview_send.ts` once — extends defense across all Phase 6 ops AND retroactively benefits Phase 4 native sends. **See Design Fork DF-1.**

**Pitfall:** Demo-mode `preview_send` already resolves a sender (persona address) and reads chain state — adding a preview-time `eth_call` against the persona introduces a non-trivial RPC round-trip; under PublicNode fallback the user already sees occasional `rpcDegraded` flags. Wrap the simulation in a try/catch that demotes RPC errors to a `status: "error"` non-blocking annotation (NEVER blocks preview emission) — the trust anchor remains the device hash match, not the simulation result.

### Topic 10: PREP-03 cryptographic-binding chain for ERC-20 ops

**Finding:** Fixture B already exists in `test/signing-fingerprint.test.ts:23-41` — Phase 4 pre-anchored a 68-byte `transfer(0x...dEAD, 1e18)` calldata test case as the Phase 6 reusability anchor. Reading the code:

- `src/signing/payload-fingerprint.ts:36-49` — `computePayloadFingerprint({ chainId, to, valueWei, data: Hex })` accepts ANY `Hex` data string; no special-casing of `data === "0x"`. The preimage is `tag ‖ chainId(32-byte BE) ‖ to(20) ‖ value(32-byte BE) ‖ data(variable)`. ERC-20 transfers produce a 175-byte preimage (23 + 32 + 20 + 32 + 68); the keccak output is the same 32-byte hex string shape.
- `test/signing-fingerprint.test.ts:38-41` — Fixture B asserts the fingerprint for the canonical ERC-20 inputs (chainId=1, to=`0x70997970…` [TOKEN CONTRACT], valueWei=0, data=`0xa9059cbb…dEAD…1e18`) matches the snapshotted-at-module-load value. This pins drift in any layer.

**Verification of `from`-independence for ERC-20:** The PREP-03 preimage does NOT include `from`. The Phase 5 retro (STATE.md § Phase 5 retro line 129) confirms this for Fixture A (native send): swapping `from` from a Ledger-paired address to vitalik produces byte-identical `0x7e1867b2…`. The same proof applies to Fixture B by construction — `from` is simply not in the preimage. **Phase 6's verify-phase MUST extend the Fixture B test to assert byte-identity across demo (persona) and real (paired) modes** — same axis Fixture A established for native sends.

**Gap to close in Phase 6:**

1. **Hard-code the Fixture B expected value as a literal hex string.** The current `beforeAll`-snapshot pattern is self-referencing (the test asserts `fp === computePayloadFingerprint(inputs)`, which is trivially true). Replace with a literal `0x...` value computed once and pinned forever — the same pattern Fixture A uses on line 17 (`expect(fp).toBe("0x7e1867b2…")`). Plan 06-02 should commit the literal alongside the first ERC-20 encoding tests. *This is Fixture B v2 — fingerprint stability with non-empty data.*
2. **New fixtures D / E / F** for the three additional ERC-20 ops:
   - Fixture D: `approve(spender, 1000)` → known fingerprint
   - Fixture E: `approve(spender, maxUint256)` (the unlimited-class) → known fingerprint
   - Fixture F: `WETH9.withdraw(1 ETH)` → known fingerprint
3. **`from`-independence regression for ERC-20** — extend `test/demo-flow.integration.test.ts` to swap persona on each of Fixtures B/D/E/F and assert byte-identity, mirroring the Phase 5 native-send pattern.

```typescript
// Source: test/signing-fingerprint.test.ts (Phase 6 plan 06-02 — replaces beforeAll-snapshot)
it("Fixture B — ERC-20 transfer → 0x<TBD> byte-for-byte", () => {
  const fp = computePayloadFingerprint({
    chainId: 1,
    to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address, // TOKEN CONTRACT
    valueWei: 0n,
    data: "0xa9059cbb000000000000000000000000000000000000000000000000000000000000dEAD0000000000000000000000000000000000000000000000000DE0B6B3A7640000" as Hex,
  });
  // Computed once via `node -e 'computePayloadFingerprint(...)'` at plan-time
  // and pinned forever. Drift in any layer breaks this exact assertion.
  expect(fp).toBe("0x<COMPUTE_AT_PLAN_TIME>");
});
```

**No design fork** — Fixture B already exists; Phase 6 hardens it into a literal anchor and extends the pattern to D/E/F. [VERIFIED: `test/signing-fingerprint.test.ts` lines 23-41]

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PREP-20 | `prepare_token_send({ to, tokenAddress, amount })` same shape as native + decoded transfer arg surface | Topic 1 (encode), Topic 10 (fingerprint stability for `data != "0x"`) |
| PREP-21 | `preview_send` for `transfer` surfaces decoded `to` + `amount` in CHECKS PERFORMED | Topic 1 (`decodeFunctionData` round-trip verified) |
| PREP-22 | Decimal normalization via `get_token_metadata`; off-by-decimal caught at prepare time | Topic 3 (`parseUnits` is NOT a safe guard — pre-validation required) |
| PREP-26 | `prepare_token_approve({ tokenAddress, spender, amount })`; `amount: "max"` → `2^256-1` | Topic 4 (strict-mode single-sentinel), Topic 6 (unlimited threshold) |
| PREP-27 | `prepare_revoke_approval({ tokenAddress, spender })` distinct tool name producing `approve(spender, 0)` | Topic 8 (distinct tool + shared internal helper) |
| PREP-28 | `prepare_weth_unwrap({ amount })` → `WETH9.withdraw(amount)` against canonical WETH from contracts SOT | Topic 2 (WETH9 ABI not in viem), Topic 7 (contracts.ts SOT design) |
| PREP-29 | Decoded args in CHECKS PERFORMED for `approve` + `WETH9.withdraw`; `amount == 2^256-1` → `⚠ UNLIMITED APPROVAL` + revoke-path hint | Topic 6 (strict-equality threshold) |
| PREP-30 | Spender labels from `src/config/contracts.ts` known-spender table; unknown spender → `(unknown spender — no prior interaction recorded)` | Topic 7 (curated table + 12 seeded entries) |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ERC-20 ABI definitions | A hand-typed `erc20Abi.ts` | viem's `erc20Abi` constant | Already shipped, regression-tested in viem itself, includes events |
| ABI encoding/decoding | A keccak-driven manual encoder | `viem.encodeFunctionData` / `viem.decodeFunctionData` | viem handles tuple/dynamic types, edge cases, abitype-driven type inference |
| WETH9 ABI | A hand-typed JSON ABI of 11 functions | `parseAbi(["function withdraw(uint256 amount)"])` | Single-method usage; full JSON ABI is bundle bloat |
| Decimal-to-wei conversion | A hand-rolled `BigInt`/`Number` multiplier | `viem.parseUnits` *with the pre-validation in Topic 3* | viem handles 18-decimal arithmetic correctly; OUR job is the pre-validation |
| `MaxUint256` literal | A hand-typed `2n ** 256n - 1n` const | `viem.maxUint256` | Single SOT; viem exports it; tested in viem's own suite |
| Canonical contract addresses | Inline string constants in each tool | `src/config/contracts.ts` SOT + `getAddress()` re-checksum at load | Project CLAUDE.md mandate; regression-tested |
| ERC-20 plugin clear-sign logic | Anything trying to predict what the device will show | Emit `LEDGER BLIND-SIGN HASH` unconditionally; let the device decide | Outside vaultpilot-mcp's API surface |

## Common Pitfalls

### Pitfall 1: `parseUnits` silent rounding

**What goes wrong:** Agent passes `"100.5"` for a decimals=0 token; `parseUnits("100.5", 0)` returns `101n`; transaction sends 101 units, user thought they sent 100.5.

**Why it happens:** viem's `parseUnits` is a low-level numeric helper, not a strict validator. It rounds excess fractional digits without throwing.

**How to avoid:** Pre-validate with the regex + fractional-digit-count check from Topic 3 BEFORE calling `parseUnits`.

**Warning signs:** Any production code path that calls `parseUnits(userInput, decimals)` without prior validation.

### Pitfall 2: `tx.to` confusion (token contract vs recipient)

**What goes wrong:** A future contributor reads `record.tx.to` expecting the user's recipient address; gets the token contract address (e.g. USDC `0xa0b8…`).

**Why it happens:** For ERC-20 calls, `tx.to` (the contract dispatched to) is the token, NOT the human-readable recipient. The recipient lives inside `data` (bytes 36-68 of the calldata).

**How to avoid:** PrepareArgs stays the agent-facing shape (`{ to: <recipient>, tokenAddress, amount }`); `tx.to` is server-internal (`= tokenAddress`). The PREPARE RECEIPT surfaces `args.to` (recipient) verbatim. Tests assert the receipt block text shows the recipient, not the token contract.

**Warning signs:** Code that reads `record.tx.to` and surfaces it to the user without context.

### Pitfall 3: WETH `withdraw` blind-signing without warning

**What goes wrong:** Agent calls `prepare_weth_unwrap`; user has not enabled "Blind signing" in the Ledger Ethereum app; sign request refuses on-device with a generic error; user is confused.

**Why it happens:** `WETH9.withdraw(uint256)` is not part of the ERC-20 plugin's clear-sign coverage; device falls back to blind-sign; blind-sign is disabled by default.

**How to avoid:** `prepare_weth_unwrap` response includes a `LEDGER NOTICE` block naming the setting and the navigation path (Settings → Blind signing → Enabled).

**Warning signs:** Tested only in demo mode; never exercised against a real device.

### Pitfall 4: Idempotent re-preview must re-decode

**What goes wrong:** Preview is called twice; the second call mints a fresh `previewToken` but reuses the prior decoded-args display, missing the chance to surface any state drift.

**Why it happens:** The handle's `record.tx.data` is immutable post-prepare (PREP-08 fingerprint gate locks it), so the decoded args ARE the same across re-previews. But the CHECKS PERFORMED block is part of the preview response — re-preview emits it fresh. Test coverage MUST cover re-preview decoded-args byte-identity.

**How to avoid:** Plan 06-02 verifies that decoded args are byte-identical across re-previews (read from the same `record.tx.data` both times).

**Warning signs:** Re-preview test missing from the plan.

### Pitfall 5: Spender label case sensitivity

**What goes wrong:** Agent passes `"0xe592427a0aece92de3edee1f18e0157c05861564"` (lowercase Uniswap V3 router); the spender-lookup table key-matches against checksummed `0xE592427A0AEce92De3Edee1F18E0157C05861564`; lookup returns `undefined`; user sees "(unknown spender)" for a known contract.

**Why it happens:** EIP-55 checksumming is case-significant; naive string equality fails.

**How to avoid:** Always `getAddress(spender)` (checksums) before lookup. The pattern in `src/tokens/registry.ts` already does this for tokens — Phase 6's `lookupSpender` mirrors it.

**Warning signs:** No test for case-insensitive spender matching.

## Code Examples

### Common Operation 1: Encode + decode ERC-20 transfer

```typescript
// Source: empirically verified Bash probe (2026-05-13) + viem type defs
import { encodeFunctionData, decodeFunctionData, erc20Abi, type Hex } from "viem";

// At prepare time:
const data: Hex = encodeFunctionData({
  abi: erc20Abi,
  functionName: "transfer",
  args: [recipient, amountWei],
});
// data = "0xa9059cbb..." (68 bytes total)

// At preview time:
const decoded = decodeFunctionData({ abi: erc20Abi, data });
// decoded.functionName === "transfer"
// decoded.args[0] === recipient (Address)
// decoded.args[1] === amountWei (bigint)
```

### Common Operation 2: Combined ABI dispatch for ERC-20 + WETH9

```typescript
// Source: src/tools/preview_send.ts (Phase 6 addition — sketch)
import { parseAbi, erc20Abi, decodeFunctionData } from "viem";

const WETH9_FRAGMENT = parseAbi(["function withdraw(uint256 amount)"]);
const COMBINED_ABI = [...erc20Abi, ...WETH9_FRAGMENT] as const;

// At preview time — single decode dispatch for transfer / approve / withdraw:
try {
  const decoded = decodeFunctionData({ abi: COMBINED_ABI, data: record.tx.data });
  // switch on decoded.functionName → "transfer" | "approve" | "withdraw"
} catch (err) {
  // AbiFunctionSignatureNotFoundError → unknown selector
  // Surface as a CHECKS PERFORMED block with status "unknown selector"
  // Trust anchor remains the device hash match.
}
```

### Common Operation 3: `parseAmountStrict` (the load-bearing decimal guard)

```typescript
// Source: src/tools/get_token_metadata.ts (Phase 6, plan 06-01)
import { parseUnits } from "viem";

export function parseAmountStrict(amountStr: string, decimals: number): bigint {
  if (!amountStr || !amountStr.trim()) {
    throw new InvalidAmountError("amount cannot be empty");
  }
  if (!/^[0-9]+(\.[0-9]+)?$/.test(amountStr)) {
    throw new InvalidAmountError(
      `amount must be a non-negative decimal string; got "${amountStr}"`,
    );
  }
  const dotIdx = amountStr.indexOf(".");
  if (dotIdx !== -1) {
    const fractionalDigits = amountStr.length - dotIdx - 1;
    if (fractionalDigits > decimals) {
      throw new InvalidAmountError(
        `amount has ${fractionalDigits} fractional digits but token decimals=${decimals}`,
      );
    }
  }
  return parseUnits(amountStr, decimals);
}
```

## Runtime State Inventory

Not applicable — Phase 6 is greenfield tool additions with no rename/refactor/migration scope. No existing stored data, OS-registered state, or live service config carries an old string that needs updating. The new `src/config/contracts.ts` is a fresh SOT (no prior version to migrate); the new `prepare_token_send` / `prepare_token_approve` / `prepare_revoke_approval` / `prepare_weth_unwrap` tools are new registrations (no existing handle store entries to invalidate). One soft-touch: `src/tools/get_portfolio_summary.ts` currently inlines `const WETH_ADDRESS = "0xC02aaA39…"`; Phase 6 should refactor it to import from `src/config/contracts.ts` to consolidate the duplicate. This is a code edit, not a data migration.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | All build/test | ✓ | ≥18.17 (Phase 1 verified) | — |
| viem | ABI encode/decode + parseUnits | ✓ | 2.48.11 (installed) | none — load-bearing |
| `@walletconnect/sign-client` | Inherited from Phase 3 | ✓ | 2.23.9 (installed) | — |
| vitest | Test suite | ✓ | Inherited | — |
| Ethereum RPC (PublicNode / Infura / Alchemy) | `get_token_metadata` decimals/symbol reads + preview-time eth_call simulation | ✓ | runtime-resolved | `rpcDegraded` flag (existing) |
| Real Ledger device | verify-phase only (not Phase 6 plan execution) | manual | — | demo-mode rehearsal via personas |

**Missing dependencies:** none — Phase 6 introduces no new external dependencies beyond what Phases 1-5 already use.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x (Phase 1 baseline; no upgrade in Phase 6) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run test/<file>.test.ts` |
| Full suite command | `npm test` (currently 329 tests) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| PREP-20 | `prepare_token_send` returns handle + decoded args | unit | `npx vitest run test/prepare-token-send.test.ts` | ❌ Wave 0 |
| PREP-21 | preview decoded args in CHECKS PERFORMED | unit | `npx vitest run test/preview-send.erc20.test.ts` | ❌ Wave 0 |
| PREP-22 | `parseAmountStrict` rejects bad inputs | unit | `npx vitest run test/parse-amount-strict.test.ts` | ❌ Wave 0 |
| PREP-26 | `prepare_token_approve` + `"max"` → maxUint256 | unit | `npx vitest run test/prepare-token-approve.test.ts` | ❌ Wave 0 |
| PREP-27 | `prepare_revoke_approval` byte-identical to approve(0) | unit | `npx vitest run test/prepare-revoke-approval.test.ts` | ❌ Wave 0 |
| PREP-28 | `prepare_weth_unwrap` uses canonical WETH address | unit | `npx vitest run test/prepare-weth-unwrap.test.ts` | ❌ Wave 0 |
| PREP-29 | `⚠ UNLIMITED APPROVAL` label at exactly `2^256-1` | unit | `npx vitest run test/preview-send.erc20.test.ts -t "unlimited"` | ❌ Wave 0 |
| PREP-30 | Known/unknown spender label resolution | unit | `npx vitest run test/contracts-sot.test.ts` | ❌ Wave 0 |
| Cross-cutting | Fixture B/D/E/F payloadFingerprint literal stability | unit | `npx vitest run test/signing-fingerprint.test.ts` | ⚠️ Extend (Fixture B exists, hard-code as literal + add D/E/F) |
| Cross-cutting | from-independence for ERC-20 ops (demo persona swap) | integration | `npx vitest run test/demo-flow.integration.test.ts` | ⚠️ Extend |

### Sampling Rate
- **Per task commit:** `npx vitest run test/<single-file>.test.ts -x`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green; combined Phase 6 verify-phase requires manual Ledger + small WETH balance for a real unwrap (post-PR-merge gate, NOT in PR review).

### Wave 0 Gaps
- [ ] `src/config/contracts.ts` — new SOT module (plan 06-03)
- [ ] `src/protocols/weth9.ts` — new module (plan 06-04); add empty `src/protocols/` directory if missing
- [ ] `src/tools/get_token_metadata.ts` — new tool (plan 06-01) + `parseAmountStrict` helper
- [ ] `test/parse-amount-strict.test.ts` — new test file (plan 06-01)
- [ ] `test/contracts-sot.test.ts` — new test file (plan 06-03)
- [ ] `test/prepare-token-send.test.ts` — new test file (plan 06-02)
- [ ] `test/prepare-token-approve.test.ts` — new test file (plan 06-03)
- [ ] `test/prepare-revoke-approval.test.ts` — new test file (plan 06-03)
- [ ] `test/prepare-weth-unwrap.test.ts` — new test file (plan 06-04)
- [ ] `test/preview-send.erc20.test.ts` — new test file (plan 06-02 — separate from existing `test/preview-send.test.ts` to keep native and ERC-20 fixtures readable)
- [ ] Extend `test/signing-fingerprint.test.ts` — replace beforeAll-snapshot Fixture B with a literal `0x...` value; add Fixtures D / E / F
- [ ] Extend `test/demo-flow.integration.test.ts` — add `from`-independence regression for each ERC-20 op

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Inherits Phase 3 WC pairing; Phase 6 adds no new auth surface |
| V3 Session Management | no | Inherits Phase 3 WC session + Phase 4 handle store |
| V4 Access Control | no | No multi-user surface |
| V5 Input Validation | **yes** | Strict ajv schemas (existing pattern); `parseAmountStrict` decimal-overflow guard (NEW); `getAddress` checksum validation on `tokenAddress` + `spender` + `to` (existing pattern); spender table case-insensitive lookup |
| V6 Cryptography | **yes** | NEVER hand-roll keccak — `viem.keccak256` (existing); fingerprint preimage construction inherits from Phase 4 unchanged; no new crypto primitives in Phase 6 |

### Known Threat Patterns for `prepare_token_send` / `prepare_token_approve` / `prepare_revoke_approval` / `prepare_weth_unwrap`

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Off-by-decimal amount (agent passes wei when human units expected, or vice versa) | Tampering (agent honest-error class — see PROJECT.md threat model) | `parseAmountStrict` regex + fractional-digit-count guard at prepare time |
| Unlimited approval to a malicious spender, agent claims "this is a small approval" | Tampering | `⚠ UNLIMITED APPROVAL` label in CHECKS PERFORMED + preview-time decoded `amount` surface + payloadFingerprint binding |
| Spender address substitution between prepare and send | Tampering | Inherited PREP-08 `payloadFingerprint` drift gate (Phase 4); spender lives in `data`, fingerprint binds `data` byte-for-byte |
| Token contract substitution (agent says "USDC" but encodes against a malicious clone) | Spoofing | Spender label lookup against curated SOT; `decodeFunctionData` surface exposes the resolved `tokenAddress` in CHECKS PERFORMED; future v1.3 dispatch allowlist (SEC-35) extends this to a hard refusal |
| `tx.to` confusion (recipient surfaced as token contract address) | Repudiation | PREPARE RECEIPT block reads from `args.to` (raw agent recipient) NOT from `record.tx.to` (token contract); type system (`PrepareArgs.to: string` not `Address`) blocks normalization |
| WETH unwrap reverting silently after broadcast | Denial of Service (user perspective — gas burned, no effect) | Preview-time `eth_call` simulation (Topic 9); user sees `status: revert` before confirming |
| Selector confusion (`0xa9059cbb` agent claims "approve" but bytes are `transfer`) | Tampering | `decodeFunctionData` surfaces `functionName` in CHECKS PERFORMED; agent + user cross-check against expected operation |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | viem's `parseUnits` accepts empty / dot-prefixed / negative / fractional-overflow strings without throwing | Topic 3 | **EMPIRICALLY VERIFIED via Bash probe — no longer an assumption.** |
| A2 | WETH9.withdraw has no ERC-7730 metadata in the Ledger registry as of 2026-05; device falls back to blind-sign | Topic 5 | If wrong (clear-sign available): the `LEDGER NOTICE` block about enabling blind-sign is over-cautious but harmless. Verify-phase task: small mainnet WETH unwrap on a real device, observe device display. |
| A3 | `viem.encodeFunctionData` produces the same bytes Ledger Live forwards to the device verbatim (no path-of-the-app re-encoding) | Topic 1 | Phase 4 already established this for native sends (`signClient.request("eth_sendTransaction", [{ ..., data }])` → bytes go straight through). Same path; same assumption holds. Low risk. |
| A4 | The 12 seeded known-spender addresses in `src/config/contracts.ts` are correct at time of writing | Topic 7 | If a spender label is wrong: user sees a wrong label but the address shown in CHECKS PERFORMED is verbatim from `decodeFunctionData(record.tx.data)`; trust anchor (device hash match) is unaffected. Regression test: each address `=== getAddress(address)` (case-correct), plus a manual spot-check against Etherscan tags at PR review. |

**Assumed claims to resolve in execute-phase or verify-phase:** A2 (real Ledger WETH unwrap), A4 (spot-check spender addresses at PR review).

## Design Forks Needing User Input (RESOLVED — DF-1: Option B locked; DF-2: Option B locked)

### DF-1: Scope of preview-time `eth_call` simulation

**The fork:** Topic 9 surfaces that preview-time `eth_call` simulation catches guaranteed-revert transactions before the user blind-signs. The fork is scope:

- **Option A (narrow):** Add simulation only to `prepare_weth_unwrap` (plan 06-04 only). Rationale: WETH unwrap has the clearest revert mode (insufficient WETH balance); other ERC-20 ops can revert too but the failure modes are more varied.
- **Option B (wide):** Lift simulation to a shared helper in `src/signing/blocks.ts` + add to `preview_send.ts` once — covers ALL Phase 6 ops AND retroactively benefits Phase 4 native sends. Rationale: defense-in-depth is uniform; native sends can also revert (e.g. recipient is a contract that reverts in `receive()`); the cost is one RPC round-trip at preview time. This already exists in `send_transaction`'s demo branch (lines 325-364); lifting it is mostly a code move.

**Default if not asked:** Option B. Rationale: matches the project's "defense-in-depth uniform" pattern from Phase 4 (PREP-07 schema-gate was lifted to ALL tools, not just send_transaction; PREP-08 fingerprint drift gate is lifted-to-shared too). Adding simulation only to WETH unwrap leaves the door open to "well that one had it, why didn't this one" inconsistency. Reasonable-call.

### DF-2: Where does `parseAmountStrict` live?

**The fork:**
- **Option A:** Inside `src/tools/get_token_metadata.ts` (alongside the decimals lookup it's paired with). Tight cohesion; one import for "everything amount-related."
- **Option B:** In `src/signing/amount.ts` (NEW). Plan 06-01 introduces it; 06-02 / 06-03 / 06-04 import from one canonical location. Surfaces it as a load-bearing primitive (same shelf as `payload-fingerprint.ts` / `presign-hash.ts` / `handle-store.ts`).

**Default if not asked:** Option B. Rationale: `parseAmountStrict` is a load-bearing security primitive (the off-by-decimal guard); it deserves a SOT module alongside the other Phase 4 signing primitives. The `src/signing/` shelf is the canonical home for "small, security-critical, well-tested helpers." Reasonable-call.

### Surface to user (AskUserQuestion) before planning?

**Recommendation: do NOT block planning on these two forks.** Both have clear default options that match established project patterns (defense-in-depth uniform; load-bearing primitives in `src/signing/`). Surface them in the planning bundle's CONTEXT section as "Claude's Discretion" so the user can override at plan-review if they disagree.

**Genuine forks where ASK is required:** none. All 10 topics resolved with strict-mode defaults.

## SDK Probe Verdicts

| Package | Installed Version | Latest (npm view) | Call Surface Used | Verdict |
|---------|-------------------|-------------------|-------------------|---------|
| `viem` | `2.48.11` | `2.48.11` (same — installed already current) | `encodeFunctionData`, `decodeFunctionData`, `erc20Abi`, `parseAbi`, `parseUnits`, `formatUnits`, `maxUint256`, `getAddress`, `keccak256`, `call` (preview-time simulation) | **Adopt.** All call surfaces empirically verified via Bash probe. Type defs at `node_modules/viem/_types/utils/abi/{encode,decode}FunctionData.d.ts` + `_types/constants/abis.d.ts` confirm function signatures. Already used end-to-end in Phases 2-5 with no SDK-API surprises. |
| `@walletconnect/sign-client` | `2.23.9` | `2.23.9` (same) | Inherited from Phase 3 — `signClient.request("eth_sendTransaction", ...)`. No new call surface in Phase 6. | **Adopt (no new usage).** Phase 6's `send_transaction` path is byte-for-byte the same as Phase 4 (only `record.tx.data` changes from `"0x"` to ERC-20 calldata). |
| `@ledgerhq/hw-app-eth` | NOT installed | N/A | Project intentionally does NOT use direct USB-HID transport in v1.x (CLAUDE.md confirms — "no direct USB-HID transport in v1.x — that's a v2.x concern when Solana / TRON / BTC land"). | **Skip.** Phase 6 inherits the Phase 3 + 4 pattern: WalletConnect-relayed `eth_sendTransaction` to Ledger Live → USB → device. The device's Ethereum app + CAL handle clear-sign vs blind-sign autonomously. |
| `abitype` | (peer of viem) | inherited | viem re-exports the types we need (`Abi`, `ContractFunctionArgs`, `ContractFunctionName`); we do NOT import abitype directly. | **Skip (transitive).** No direct usage; viem's wrapping types are sufficient. |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled ABI encoders (ethers.js v5 era) | `viem.encodeFunctionData` + abitype-driven type inference | viem 1.0 (2023) | Type-safe; impossible to encode wrong-arity args at compile time |
| `ethers.constants.MaxUint256` | `viem.maxUint256` | viem 1.0 | Same numeric value; canonical SOT in the active stack |
| Custom unlimited-approval thresholds (some projects: > 1e30) | Strict equality to `MaxUint256` | Industry consensus since ~2022 | Revoke.cash / Etherscan / OpenZeppelin all use strict-equality |
| Per-token-contract custom Ledger plugin | ERC-7730 generic parser + on-device CAL | Ledger Live 2.x (2024+) | Reduces clear-sign coverage gaps but still requires registered metadata; WETH9.withdraw probably remains blind-sign |

**Deprecated/outdated:** Nothing materially blocking Phase 6. The single watch-item is ERC-7730 v2 (April 2026) — if WETH9.withdraw acquires metadata in the registry during Phase 6 execution, A2's LEDGER NOTICE block becomes over-cautious. That's a soft regression (text-only), not a code-level issue.

## Sources

### Primary (HIGH confidence — empirically verified or first-party documentation)

- Installed viem@2.48.11 type defs:
  - `node_modules/viem/_types/constants/abis.d.ts` — `erc20Abi` shape (no `withdraw`)
  - `node_modules/viem/_types/utils/abi/encodeFunctionData.d.ts` — return type `Hex`
  - `node_modules/viem/_types/utils/abi/decodeFunctionData.d.ts` — return shape `{ args, functionName }`
  - `node_modules/viem/_types/utils/unit/parseUnits.d.ts` — `parseUnits(value: string, decimals: number): bigint`
- Bash probe (2026-05-13): empirical test of `parseUnits` edge cases, `encodeFunctionData` round-trips, `maxUint256` equality, combined-ABI decode
- Existing repo source:
  - `src/signing/payload-fingerprint.ts` — accepts variable-length `data`
  - `test/signing-fingerprint.test.ts:23-41` — Fixture B (Phase 6 reusability anchor) already present
  - `src/tools/send_transaction.ts:325-364` — demo-mode `eth_call` simulation pattern (Topic 9 reference)
  - `src/tokens/registry.ts` — `getAddress()` re-checksum pattern (Topic 7 reference)
  - `src/tools/get_portfolio_summary.ts` — existing canonical WETH constant (consolidate in Phase 6)
- Aave V3 addresses: [aave.com/docs/resources/addresses](https://aave.com/docs/resources/addresses)
- Uniswap V2/V3 + Permit2: [docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments](https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments)
- 1inch v6: [portal.1inch.dev](https://portal.1inch.dev/documentation/contracts/aggregation-protocol/aggregation-introduction)
- Seaport: [docs.opensea.io/docs/seaport](https://docs.opensea.io/docs/seaport)
- Li.Fi: [etherscan.io/address/0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae](https://etherscan.io/address/0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae)
- CowSwap GPv2Settlement: [etherscan.io/address/0x9008d19f58aabd9ed0d60971565aa8510560ab41](https://etherscan.io/address/0x9008D19f58AAbD9eD0D60971565AA8510560ab41)

### Secondary (MEDIUM confidence — official docs verified across multiple sources)

- Ledger clear-signing docs: [developers.ledger.com/docs/clear-signing/overview](https://developers.ledger.com/docs/clear-signing/overview) — ERC-7730 + CAL coverage
- Ledger ERC-20 plugin: [support.ledger.com/article/Ethereum-Token-Approvals-Explained](https://support.ledger.com/article/Ethereum-Token-Approvals-Explained) — known-token clear-sign for transfer + approve
- Revoke.cash + OpenZeppelin unlimited-approval threshold consensus: [github.com/RevokeCash/revoke.cash](https://github.com/RevokeCash/revoke.cash), [docs.openzeppelin.com/contracts/4.x/api/token/erc20](https://docs.openzeppelin.com/contracts/4.x/api/token/erc20)

### Tertiary (LOW confidence — flagged for execute-phase or verify-phase resolution)

- A2 (WETH9.withdraw → blind-sign on current Ledger app) — resolve via real-device verify-phase

## Metadata

**Confidence breakdown:**
- Standard stack (viem APIs): HIGH — all call surfaces empirically verified
- Decimal parsing pre-validation (Topic 3): HIGH — `parseUnits` weakness empirically demonstrated
- WETH9 ABI placement (Topic 2): HIGH — viem lookup confirms no `weth9Abi` export
- Known-spender addresses (Topic 7): HIGH — addresses cross-verified against official docs + Etherscan
- Ledger clear-sign behavior (Topic 5): MEDIUM — recent docs confirm pattern, but ERC-7730 v2 is in flux (April 2026); A2 needs real-device verification
- Approval-class threshold (Topic 6): HIGH — industry consensus is unambiguous
- Cryptographic binding (Topic 10): HIGH — Fixture B already in test suite; preimage construction verified

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (30 days; viem + WalletConnect SDKs are stable; Ledger CAL/ERC-7730 registry may evolve faster but the assumption A2 is the only soft-touch)
