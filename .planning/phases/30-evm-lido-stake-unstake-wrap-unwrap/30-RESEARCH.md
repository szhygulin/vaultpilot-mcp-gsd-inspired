# Phase 30: Lido — stake / unstake / wrap / unwrap (stETH↔wstETH) — Research

**Researched:** 2026-05-23
**Domain:** Lido liquid staking protocol (Ethereum mainnet + Arbitrum read)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Lido contracts sourced from `src/config/contracts.ts` via per-chain `LidoContracts` interface + flat getters (`getLidoStethAddress`, `getLidoWstethAddress`, `getLidoWithdrawalQueueAddress`). Mirrors `getAaveV3PoolAddress` (Phase 7) + `CompoundCometsByChain` (Phase 28) SOT shape. T-LIDO-SPENDER-DRIFT-1 cross-view byte-identity: `getLidoStethAddress(1) === KNOWN_SPENDERS_ETHEREUM[<lido stETH spender slot>].address`.
- **D-02:** Single `src/protocols/lido.ts` covering all 4 contracts (stETH `submit` + WithdrawalQueue `requestWithdrawals` + WstETH `wrap` + WstETH `unwrap`). Lido is one protocol with bound contracts; single-file matches Phase 28/29 protocol-decoder bundling.
- **D-03:** Ethereum-write-only enforcement — `prepare_lido_*` tools refuse on non-Ethereum chains via existing `CHAIN_ID_MISMATCH` errorCode 15 (Phase 8 surface). Reads stay multi-chain via per-chain Lido SOT slots (Ethereum primary; Arbitrum bridged stETH/wstETH from canonical bridge deployment).
- **D-04:** `prepare_lido_unstake` returns the standard handle + adds a `[NFT RECEIPT EXPECTED]` block (separate from `LEDGER NOTICE` / `[AGENT TASK]` / `CHECKS PERFORMED`) surfacing: expected NFT contract address, expected `tokenId` (next-request-id read at prepare time via `WithdrawalQueue.getLastRequestId(owner) + 1`), expected `requestor` (sender), expected claim-after-finalization-window (typically 1-5 days). Standalone block matches Phase 6 LEDGER NOTICE precedent for novel post-tx artifacts.
- **D-05:** stETH-approval prerequisite for `wstETH.wrap` and `WithdrawalQueue.requestWithdrawals` — server pre-flight reads `stETH.allowance(owner, spender)` at prepare time; if insufficient, refuses with `INVALID_INPUT + hintTool → prepare_token_approve` (Phase 28 intent-vs-reality pattern). Keeps the 21-code errorCode union FROZEN.
- **D-06:** `prepare_lido_unstake` accepts a single `stethAmount` param (one withdrawal request per call). The on-chain `requestWithdrawals(uint256[] amounts, address owner)` accepts an array, but Phase 30 ships single-amount only — array-of-amounts deferred per "curation over padding" + LIDO-03 `{ stethAmount }` singular language. Server still encodes as `[stethAmount]` for ABI compatibility.
- **D-07:** Wrap/unwrap follow the WETH9 (Plan 06-04) pattern: encoder + canonical-address getter colocated in `src/protocols/lido.ts`. Selectors hardcoded literals: `WstETH.wrap` = `0xea598cb0`, `WstETH.unwrap` = `0xde0e9a3e` (VERIFIED below via `viem.toFunctionSelector`; commit as test anchors in `test/protocols-lido.test.ts`).
- **D-08:** `get_lido_positions({ wallet, chain? })` returns: `stethBalance` (raw + human-units), `wstethBalance` (raw + human-units), `stethShares` (from `stETH.sharesOf(wallet)`), `conversionRate` (wstETH→stETH rate from `WstETH.stEthPerToken()`; 1e18-scaled), `accruedRebaseRewards` (shares-based snapshot; see D-09), `chain` (`"ethereum"` | `"arbitrum"`).
- **D-09:** `accruedRebaseRewards` computation — shares-based via Lido `getSharesByPooledEth` / `getPooledEthByShares`. Phase 30 surfaces APPROXIMATE accrual as a non-load-bearing field with explicit `approx: true` flag. Pure-bigint math in `src/signing/lido-rebase.ts` (mirrors `src/signing/aave-health.ts` + `src/signing/compound-health.ts` pattern).
- **D-10:** Per-chain `CANONICAL_DISPATCH_TARGETS` (Phase 9) Lido arm wired for Ethereum: stETH proxy, wstETH, WithdrawalQueue all added to the allowlist. Arbitrum entries READ-ONLY (no prepare_* dispatch targets — writes refuse pre-dispatch via D-03). `DISPATCH_TARGET_REFUSED` errorCode applies if a future bug routes a Lido prepare call to a non-allowlisted address.
- **D-11:** Fixture letters assigned alphabetically following Phase 28 R/S/T/U. Phase 29 adopted `Morpho-29-{A,B,C,D}` (phase-prefixed naming in sibling file). The single-letter pool V/W/X/Y is INTACT and reserved for Phase 30. Cross-checked: 29-RESEARCH.md Open Question 5 explicitly states "V/W/X are RESERVED for Phase 30 Lido (per 30-CONTEXT.md)". No collision.
  - **Fixture V** = `Lido.submit(referral=address(0))` with ETH value
  - **Fixture W** = `WithdrawalQueue.requestWithdrawals([stethAmount], owner=sender)`
  - **Fixture X** = `WstETH.wrap(stethAmount)`
  - **Fixture Y** = `WstETH.unwrap(wstethAmount)`
- **D-12:** Researcher MUST verify ERC-7730 registry coverage at planning gate. RESOLVED: all 4 write functions have clear-sign coverage — see Topic 3 below. NO LEDGER NOTICE block needed for any of the 4 write tools (mirrors Phase 7 Aave — confirmed clear-sign → no notice).

### Claude's Discretion

- Internal helper names (`LidoReader`, `parseLidoConversion`, `formatRebaseRewards`, etc.)
- Whether `src/signing/lido-rebase.ts` ships as its own file or folds into `src/protocols/lido.ts` (pure-math separation pattern from Aave/Compound is the default expectation)
- Whether `get_lido_positions` Arbitrum read uses the bridged wstETH contract's storage or proxies through a `TokenRateOracle` (researcher verifies which path is simpler + more reliable)
- Whether the third-party referral param in `Lido.submit` is exposed as an optional `referral` arg in `prepare_lido_stake` or hardcoded `address(0)` (default: hardcoded; no clear product reason to surface it)

### Deferred Ideas (OUT OF SCOPE)

- `prepare_lido_claim_withdrawal` — NFT-claim flow once unstake settles. Deferred to v2.3.x.
- Array-of-amounts in `prepare_lido_unstake` — single-amount only in Phase 30.
- Third-party Lido referral payouts — hardcoded `address(0)`.
- Cross-chain stETH bridging (write-side bridge tools) — Phase 30 reads Arbitrum; writes Ethereum-only.
- Lido LSTs beyond stETH/wstETH (stMATIC, etc.) — out of scope.
- Lido validator-set / node-operator surfacing — out of scope.
- Exact rebase-reward accounting (full transfer-history scan) — deferred to v3.x.
- v2.3 close-out SECURITY.md milestone summary — bundled with Phase 31.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIDO-01 | `get_lido_positions({ wallet, chain? })` returns stETH + wstETH balances + accrued rebase rewards (Ethereum mainnet + Arbitrum) | Topic 2: stETH shares ABI; Topic 4: shares ↔ assets formula; Topic 5: Arbitrum read strategy |
| LIDO-02 | `prepare_lido_stake({ amount })` produces unsigned `Lido.submit(referral)` call with `value` = `amount` | Topic 1: verified stETH address + submit ABI + selector; Topic 3: clear-sign coverage confirmed |
| LIDO-03 | `prepare_lido_unstake({ stethAmount })` produces unsigned `WithdrawalQueue.requestWithdrawals` call (NFT receipt surfaced) | Topic 1: verified WithdrawalQueue address + ABI; Topic 6: NFT tokenId semantics; Topic 3: clear-sign coverage |
| LIDO-04 | `prepare_lido_wrap({ stethAmount })` + `prepare_lido_unwrap({ wstethAmount })` produce `WstETH.wrap` + `WstETH.unwrap` calls | Topic 1: verified WstETH address + ABI + VERIFIED selectors; Topic 3: clear-sign coverage; Topic 7: approval pre-flight |
| LIDO-05 | Lido contracts (stETH + WstETH + WithdrawalQueue) sourced from `src/config/contracts.ts`; reads work on Ethereum + Arbitrum; writes Ethereum-only; canonical-dispatch allowlist Lido arm wiring | Topic 8: contracts.ts extension pattern; Topic 9: canonical-dispatch extension |

</phase_requirements>

---

## Summary

Phase 30 implements the full Lido liquid staking surface: staking ETH to mint stETH (`Lido.submit`), queuing unstake via `WithdrawalQueue.requestWithdrawals` (v2 NFT-receipt queue), and converting between the rebase-bearing stETH and the rebase-resistant wstETH via `WstETH.wrap` / `WstETH.unwrap`. Read tools cover Ethereum mainnet plus Arbitrum (bridged wstETH only — stETH is NOT bridged as a separate token on Arbitrum; only wstETH crosses the bridge).

The implementation is structurally a mechanical clone of prior protocol phases. `prepare_lido_stake` clones `prepare_native_send` (value-bearing ETH call). `prepare_lido_wrap` and `prepare_lido_unwrap` clone `prepare_weth_unwrap` (single-arg ERC-20 call with hardcoded selector). `prepare_lido_unstake` clones `prepare_aave_supply` / `prepare_compound_supply` shape but adds the novel `[NFT RECEIPT EXPECTED]` block. `get_lido_positions` follows the `get_lending_positions` / `get_morpho_positions` multi-protocol fan-out shape with Arbitrum read for the wstETH balance only.

Critical verification at research time: all 4 Lido write functions have ERC-7730 clear-sign coverage in the LedgerHQ registry (`calldata-stETH.json` covers `submit`; `calldata-wstETH.json` covers `wrap` + `unwrap`; `calldata-WithdrawalQueueERC721.json` covers `requestWithdrawals`). This means Phase 30 does NOT need any `LEDGER NOTICE` blocks — the device will clear-sign all four operations, matching the Phase 7 Aave behavior (not the Phase 6 WETH9.withdraw blind-sign precedent). The fixture letter pool V/W/X/Y is confirmed unoccupied (Phase 29 Morpho adopted the phase-prefixed `Morpho-29-{A,B,C,D}` naming in a sibling test file, explicitly preserving V/W/X/Y for Phase 30).

**Primary recommendation:** Model `src/protocols/lido.ts` on `src/protocols/weth9.ts` for the wrap/unwrap encoders + `src/protocols/aave-v3.ts` for multi-method ABI bundling. The rebase math module `src/signing/lido-rebase.ts` mirrors `src/signing/aave-health.ts` (pure-bigint, no floating point). No new npm packages are required — `viem` provides all needed primitives.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stake ETH → mint stETH (`submit`) | API / Backend (MCP server) | — | Encode value-bearing calldata; inject payloadFingerprint |
| Unstake stETH → NFT receipt (`requestWithdrawals`) | API / Backend | — | Encode single-element array calldata; stETH approval pre-flight |
| Wrap stETH → wstETH | API / Backend | — | Encode single-arg calldata; stETH approval pre-flight |
| Unwrap wstETH → stETH | API / Backend | — | Encode single-arg calldata; no approval needed |
| Read stETH + wstETH balances (Ethereum) | API / Backend | — | On-chain reads via viem publicClient; shares-based accounting |
| Read wstETH balance (Arbitrum) | API / Backend | — | ERC-20 `balanceOf` on bridged wstETH token |
| stETH shares ↔ assets conversion | API / Backend | — | Pure-bigint math in `lido-rebase.ts` |
| wstETH→stETH conversion rate | API / Backend | — | `WstETH.stEthPerToken()` on Ethereum mainnet; price oracle on Arbitrum |
| ERC-20 approval gate (stETH for wrap/unstake) | API / Backend | — | `stETH.allowance(owner, spender)` pre-flight check at prepare time |
| Clear-sign display of Lido tx | Device (Ledger) | — | All 4 write functions in ERC-7730 registry — device decodes calldata |
| NFT receipt tracking | Agent | — | Agent reads `[NFT RECEIPT EXPECTED]` block and surfaces tokenId to user |
| Withdrawal claim (future) | DEFERRED | — | `claimWithdrawal` is Phase v2.3.x; out of scope |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `viem` | 2.48.11 (project) | ABI encode/decode, publicClient reads, `toFunctionSelector` | CLAUDE.md locked EVM stack |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | All Lido encoding uses viem `parseAbi` + `encodeFunctionData` inline | No new npm dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `viem.parseAbi` inline | `@lidofinance/lido-ethereum-sdk` | SDK exists (npm package) but is 800KB+ gzip; Phase 28/29 precedent firmly rejects SDKs in favor of direct ABI encoding. Phase 30 has 4 simple function signatures — no SDK needed. |

**No new npm packages to install.** All encoding uses `viem` (already in project). No slopcheck needed.

---

## Package Legitimacy Audit

**No new packages to install in Phase 30.** All needed primitives are available via the project's existing `viem@2.48.11` dependency. The Lido ABI is trivial (4 single-call functions) and does not warrant an SDK. Phase 28/29 precedent: reject any SDK that adds bundle weight for functionality replaceable with 4 inline `parseAbi` fragments.

**Packages removed due to slopcheck [SLOP] verdict:** none (no new packages)
**Packages flagged as suspicious [SUS]:** none

---

## Topic 1: Lido Contract Surface (Ethereum Mainnet)

**[VERIFIED: docs.lido.fi/deployed-contracts + lidofinance/core GitHub]**

All three contracts confirmed active v3.0.2 on Ethereum mainnet (chainId 1):

| Contract | Role | Proxy Address |
|---------|------|--------------|
| stETH / Lido | Liquid staking token; rebase-bearing ERC-20; `submit(address referral)` payable | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` |
| wstETH | Non-rebase wrapper; `wrap(uint256)` + `unwrap(uint256)` | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` |
| WithdrawalQueueERC721 | NFT-receipt unstake queue v2; `requestWithdrawals(uint256[], address)` | `0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1` |

**Function selectors (VERIFIED via `viem.toFunctionSelector` executed during research):**

```
WstETH.wrap(uint256):                    0xea598cb0  ← D-07 matches
WstETH.unwrap(uint256):                  0xde0e9a3e  ← D-07 matches
Lido.submit(address):                    0xa1903eab
WithdrawalQueue.requestWithdrawals(uint256[],address): 0xd6681042
```

All four selectors computed from canonical Solidity signatures via `viem.toFunctionSelector`. These are the authoritative values; CONTEXT.md D-07 placeholder guesses `0xea598cb0` / `0xde0e9a3e` for wrap/unwrap — CONFIRMED CORRECT.

**Minimal ABI fragments needed:**

```typescript
// stETH (Lido) — src/protocols/lido.ts
const STETH_ABI_FRAGMENTS = parseAbi([
  "function submit(address _referral) payable returns (uint256)",   // stake
  "function sharesOf(address _account) view returns (uint256)",
  "function getSharesByPooledEth(uint256 _ethAmount) view returns (uint256)",
  "function getPooledEthByShares(uint256 _sharesAmount) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

// WstETH — src/protocols/lido.ts
const WSTETH_ABI_FRAGMENTS = parseAbi([
  "function wrap(uint256 _stETHAmount) returns (uint256)",           // stETH → wstETH
  "function unwrap(uint256 _wstETHAmount) returns (uint256)",        // wstETH → stETH
  "function stEthPerToken() view returns (uint256)",                  // conversion rate (1e18-scaled)
  "function balanceOf(address account) view returns (uint256)",
]);

// WithdrawalQueueERC721 — src/protocols/lido.ts
const WQ_ABI_FRAGMENTS = parseAbi([
  "function requestWithdrawals(uint256[] calldata _amounts, address _owner) returns (uint256[] requestIds)",
  "function getLastRequestId() view returns (uint256)",              // last minted tokenId; next = + 1
]);
```

**Withdrawal amount constraints** (verified from docs.lido.fi/contracts/withdrawal-queue-erc721):
- Minimum: 100 wei of stETH per request
- Maximum: 1000 ETH per request (larger withdrawals must be split)

Phase 30 ships single-amount only (D-06); server should validate `amount >= 100 wei` and `amount <= 1000 ETH` at prepare time and surface structured `INVALID_INPUT` if violated.

---

## Topic 2: stETH Shares ↔ Assets Conversion Math

**[VERIFIED: docs.lido.fi/guides/lido-tokens-integration-guide + lidofinance/core GitHub]**

stETH implements a share-based rebase model. **Shares are the invariant; stETH balance changes via oracle reports.** The key relationships:

```
stETH balance of account = shares[account] * totalPooledEther / totalShares
```

Three on-chain functions expose this:

```solidity
// How many shares represent _ethAmount of stETH?
function getSharesByPooledEth(uint256 _ethAmount) external view returns (uint256);

// What is the stETH value of _sharesAmount shares (current rate)?
function getPooledEthByShares(uint256 _sharesAmount) external view returns (uint256);

// How many shares does this account hold?
function sharesOf(address _account) external view returns (uint256);
```

**Accrued rebase rewards (D-09 approximate formula):**

The server computes `accruedRebaseRewards` as the difference between the current stETH balance and a stETH balance at a reference point. Because Phase 30 does NOT have access to a "staked timestamp", the approximation uses the current rate to express what the user would have gotten if they had wrapped at a prior ratio. The PRACTICAL implementation for Phase 30 is:

```typescript
// At get_lido_positions time:
const shares = await client.readContract({ ..., functionName: "sharesOf", args: [wallet] });
const currentStethBalance = await client.readContract({ ..., functionName: "balanceOf", args: [wallet] });

// The shares-based "face value" at 1:1 (no rebase from day zero) would be shares / 1e18.
// Current balance - deposit-equivalent = approximate rebase gain.
// Since shares remain constant but ETH/share grows, the reward = currentBalance - shares (in wei)
// (This is an approximation — the true measure requires tracking deposit history.)
const accruedRebaseRewards = currentStethBalance - shares;  // bigint arithmetic
// approx: true flag MUST accompany this value
```

**Note:** The `approx: true` flag is load-bearing per D-09. The agent MUST surface this to the user so they understand the value is not an audited PnL figure.

**wstETH conversion rate:**

`WstETH.stEthPerToken()` returns the current stETH per wstETH (1e18-scaled). This is available on Ethereum mainnet. On Arbitrum, the bridged wstETH ERC20Bridged contract does NOT have `stEthPerToken()` — instead, a Chainlink `wstETH/stETH` rate feed is available. For Phase 30's Arbitrum read, the recommended approach is to call `balanceOf` (wstETH amount) and surface the raw balance; the conversion rate is fetched from Ethereum mainnet's `stEthPerToken()` since it's the same rate globally (wstETH rate is set at the Ethereum L1 level and bridged via oracle). This is simpler and avoids a Chainlink dependency.

---

## Topic 3: ERC-7730 Clear-Sign Coverage — D-12 RESOLVED

**[VERIFIED: github.com/LedgerHQ/clear-signing-erc7730-registry/tree/master/registry/lido — confirmed three JSON files]**

The LedgerHQ ERC-7730 clear-signing registry contains a `lido/` directory with:

| File | Contract Covered | Functions Covered |
|------|-----------------|-------------------|
| `calldata-stETH.json` | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` (chainId 1) | `approve`, **`submit`** (stake), `transfer` |
| `calldata-wstETH.json` | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` (chainId 1) | `approve`, **`wrap`**, **`unwrap`**, `transfer` |
| `calldata-WithdrawalQueueERC721.json` | `0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1` (chainId 1) | **`requestWithdrawals`**, `requestWithdrawalsWithPermit`, `requestWithdrawalsWstETH`, `claimWithdrawal`, `claimWithdrawals`, `claimWithdrawalsTo`, `approve`, `safeTransferFrom`, `transferFrom`, `setApprovalForAll` |

**All 4 Phase 30 write functions are covered by ERC-7730 clear-sign:**
- `submit` → covered in `calldata-stETH.json`
- `requestWithdrawals` → covered in `calldata-WithdrawalQueueERC721.json`
- `wrap` → covered in `calldata-wstETH.json`
- `unwrap` → covered in `calldata-wstETH.json`

**D-12 DECISION:** NO `LEDGER_NOTICE_LIDO_TEMPLATE` needed for any of the 4 write tools. The device will clear-sign all Lido operations, displaying decoded parameters on-screen. This matches the Phase 7 Aave precedent (clear-sign confirmed → no notice) rather than the Phase 6 WETH9.withdraw precedent (blind-sign → LEDGER NOTICE required).

Coverage is Ethereum mainnet (chainId 1) only — which is correct for Phase 30 (writes are Ethereum-only per D-03).

---

## Topic 4: WithdrawalQueue NFT Receipt Semantics

**[VERIFIED: docs.lido.fi/contracts/withdrawal-queue-erc721 + lidofinance/core GitHub]**

When `requestWithdrawals(uint256[] amounts, address owner)` executes:
1. A new ERC-721 NFT is minted to `owner`.
2. The tokenId assigned equals the **new** `getLastRequestId()` after the tx — i.e., `pre-tx getLastRequestId() + 1` for a single-amount request.
3. Requests are indexed from 1 (not 0); `getLastRequestId()` returns 0 if queue is empty.
4. The `WithdrawalRequested` and `Transfer` events are emitted; the NFT tokenId is deterministic from the pre-tx state.

**Prepare-time tokenId prediction (D-04):**
```typescript
// At prepare_lido_unstake time:
const lastId = await client.readContract({
  address: WITHDRAWAL_QUEUE_ADDRESS,
  abi: WQ_ABI_FRAGMENTS,
  functionName: "getLastRequestId",
});
const expectedTokenId = lastId + 1n;  // deterministic for single-amount request
```

**Race condition residual risk (T-LIDO-NFT-TOKENID-RACE):** Another transaction queuing a withdrawal between the `getLastRequestId()` read at prepare time and the actual tx submission would shift the tokenId. This is documented as residual risk in the `[NFT RECEIPT EXPECTED]` block — "expected (best-effort at prepare time; may shift if another withdrawal is queued before this tx lands)."

**Finalization window:** Typically 1-5 days. The docs state withdrawals are processed when the protocol's ether buffer covers pending requests AND a timelock period passes. The `[NFT RECEIPT EXPECTED]` block surfaces this as `claimableAfter: "~1-5 days (finalization window; monitor via Lido withdrawal tracker)"`.

**Withdrawal amount limits:**
- Minimum: 100 wei stETH per request
- Maximum: 1000 ETH per request

---

## Topic 5: Lido Bridged Contracts (Arbitrum) — Read Strategy

**[VERIFIED: lidofinance/lido-l2 artifacts-arb.json + arbiscan.io + WebSearch]**

Lido bridges **wstETH only** to Arbitrum — there is no separate bridged stETH ERC-20 token on Arbitrum. The canonical Arbitrum wstETH addresses:

| Role | Address |
|------|---------|
| WstETH ERC20Bridged proxy (Arbitrum) | `0x5979D7b546E38E414F7E9822514be443A4800529` |
| L2ERC20TokenGateway proxy (Arbitrum) | `0x07D4692291B9E30E326fd31706f686f83f331B82` |

The bridged wstETH implements standard ERC-20 (`balanceOf`, `transfer`, etc.) but **does NOT have `stEthPerToken()`** — it is a plain bridged ERC-20Bridged contract without oracle-coupled rate functions.

**Arbitrum read strategy for `get_lido_positions`:**

For Arbitrum, the tool returns:
- `wstethBalance`: `ERC20.balanceOf(wallet)` on the Arbitrum wstETH proxy
- `stethBalance`: `null` (no bridged stETH on Arbitrum)
- `stethShares`: `null`
- `conversionRate`: read from Ethereum mainnet's `WstETH.stEthPerToken()` — the rate is L1-authoritative and the same for all chains. The Arbitrum read can either (a) make a cross-chain Ethereum RPC call or (b) call the Arbitrum Chainlink wstETH/stETH rate feed. Option (a) is simpler given the project already has an Ethereum mainnet client.
- `accruedRebaseRewards`: `null` on Arbitrum (no on-chain share tracking available on L2)
- `chain: "arbitrum"`

**Recommendation:** For Phase 30, read `wstethBalance` via Arbitrum publicClient and `conversionRate` via Ethereum mainnet publicClient (same `getChainClient(1)` already in scope). This avoids a Chainlink dependency. The cross-chain read is 2 RPC calls, both within the existing multi-chain infrastructure.

---

## Topic 6: stETH Approval Pre-Flight Requirements (D-05)

**[VERIFIED: Lido protocol docs + contract source lidofinance/core]**

The approval requirements per operation:

| Tool | Needs stETH Approval? | Spender | Allowance Check |
|------|----------------------|---------|----------------|
| `prepare_lido_stake` | NO | — | ETH is sent directly via `msg.value`; no ERC-20 transfer |
| `prepare_lido_unstake` | YES | `WithdrawalQueueERC721` (`0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1`) | `stETH.allowance(wallet, withdrawalQueue) >= stethAmount` |
| `prepare_lido_wrap` | YES | `wstETH` (`0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0`) | `stETH.allowance(wallet, wsteth) >= stethAmount` |
| `prepare_lido_unwrap` | NO | — | wstETH is burned directly; no stETH approval needed |

**Approval pre-flight pattern (D-05) — mirrors Phase 28 `INVALID_INPUT + hintTool`:**

```typescript
// At prepare_lido_wrap / prepare_lido_unstake time:
const allowance = await client.readContract({
  address: STETH_ADDRESS,
  abi: STETH_ABI_FRAGMENTS,
  functionName: "allowance",
  args: [wallet, SPENDER_ADDRESS],  // SPENDER = wstETH or WithdrawalQueue
});
if (allowance < amountWei) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({
        errorCode: 1,  // INVALID_INPUT
        message: `Insufficient stETH allowance. Approve at least ${formatUnits(amountWei, 18)} stETH first.`,
        hintTool: "prepare_token_approve",
        hintArgs: {
          tokenAddress: STETH_ADDRESS,
          spender: SPENDER_ADDRESS,
          amount: formatUnits(amountWei, 18),
        },
      }),
    }],
  };
}
```

**Known-spender entries needed in `KNOWN_SPENDERS_ETHEREUM`:**
- wstETH contract as spender (for `prepare_lido_wrap`)
- WithdrawalQueue as spender (for `prepare_lido_unstake`)
- stETH contract itself may also be added as a transfer/send target label

---

## Topic 7: Existing Codebase Analogs — Exact Symbol-Level Patterns

**[VERIFIED: read src/protocols/weth9.ts, src/security/canonical-dispatch.ts, src/config/contracts.ts, src/tools/get_lending_positions.ts, src/signing/aave-health.ts]**

### `src/protocols/weth9.ts` → `src/protocols/lido.ts` (wrap/unwrap side)

The WETH9 pattern ships:
- `WETH9_WITHDRAW_ABI = parseAbi([...])` (the ABI fragment)
- `WETH9_SELECTORS = { withdraw: "0x2e1a7d4d" as Hex }` (hardcoded selector)
- `WETH9_DECIMALS = 18` (token decimals constant)
- `encodeWethWithdraw(amount: bigint): Hex` (encoder)
- `getWethContractAddress(chainId: ChainId): Address` (canonical address re-export)

Phase 30 `src/protocols/lido.ts` mirrors this with:
- `STETH_SUBMIT_ABI`, `WSTETH_WRAP_ABI`, `WSTETH_UNWRAP_ABI`, `WQ_REQUEST_ABI`
- `LIDO_SELECTORS = { submit: "0xa1903eab", requestWithdrawals: "0xd6681042", wrap: "0xea598cb0", unwrap: "0xde0e9a3e" }` — ALL HARDCODED VERIFIED SELECTORS
- `STETH_DECIMALS = 18`, `WSTETH_DECIMALS = 18`
- `encodeLidoSubmit(referral: Address): Hex` (returns calldata; value set by tool)
- `encodeRequestWithdrawals(stethAmountWei: bigint, owner: Address): Hex` (encodes `[amount]` array)
- `encodeWstethWrap(stethAmount: bigint): Hex`
- `encodeWstethUnwrap(wstethAmount: bigint): Hex`
- `getLidoStethAddress(chainId: ChainId): Address`
- `getLidoWstethAddress(chainId: ChainId): Address`
- `getLidoWithdrawalQueueAddress(chainId: ChainId): Address`

### `src/config/contracts.ts` → `LidoContracts` interface + LIDO_RAW sub-table

The current `contracts.ts` has a comment `// Phase 8+ may add: lido, eigenLayer, ...` at line 70. Phase 30 adds:
- `LidoContracts` interface with 3 fields: `steth`, `wsteth`, `withdrawalQueue`
- `LIDO_RAW: Partial<Record<ChainId, LidoContracts>>` sibling sub-table (chainId 1 = Ethereum; chainId 42161 = Arbitrum read-only wstETH only)
- Three flat getters: `getLidoStethAddress`, `getLidoWstethAddress`, `getLidoWithdrawalQueueAddress`
- Two new `KNOWN_SPENDERS_ETHEREUM` entries: wstETH and WithdrawalQueue

### `src/security/canonical-dispatch.ts` → `buildPerChainAllowlist` extension

The current `buildPerChainAllowlist(chainId)` function at line 107 adds Aave, WETH, 1inch, LiFi, Compound Comets, and Morpho Blue entries. Phase 30 adds:
- `getLidoStethAddress(chainId)` (Ethereum chainId=1 only; null for others)
- `getLidoWstethAddress(chainId)` (Ethereum chainId=1 only; null for others)
- `getLidoWithdrawalQueueAddress(chainId)` (Ethereum chainId=1 only; null for others)
- Filter pattern: `const lidoEntries: Address[] = [steth, wsteth, wq].filter(Boolean) as Address[]`

### `src/tools/get_lending_positions.ts` → `get_lido_positions.ts` structure

The `get_lending_positions.ts` fan-out pattern (`Promise.allSettled` or `Promise.all` with per-protocol legs) is the template. `get_lido_positions.ts` is simpler (fewer legs) but follows the same shape: wallet validation → chain client → parallel reads → structured result.

### `src/signing/aave-health.ts` → `src/signing/lido-rebase.ts`

The `aave-health.ts` file is 183 lines: pure functions, BigInt constants, exported interfaces, no side effects, no RPC calls. `lido-rebase.ts` follows this shape:
- `STETH_DECIMALS = 18n`
- `STETH_BASE = 10n ** 18n`
- `computeRebaseRewards({ shares, currentStethBalance }): bigint` → approximate accrued rewards
- `formatConversionRate(stEthPerToken: bigint): string` → human-readable rate

---

## Topic 8: `src/config/contracts.ts` Extension Shape

**[VERIFIED: reading src/config/contracts.ts lines 1-623]**

The current `contracts.ts` layout is:

1. `ContractsForChain` interface + `CONTRACTS_RAW` (5-chain × Aave V3 slots)
2. `CompoundCometBase` type + `COMPOUND_COMETS_RAW` + getters (Phase 28 sibling)
3. `MORPHO_BLUE_RAW` + `getMorphoBlueAddress` (Phase 29 sibling)
4. `KNOWN_SPENDERS_ETHEREUM` array (17 entries as of Phase 29)
5. `KNOWN_SPENDERS_TRON` array (Phase 19)

Phase 30 adds between Morpho and `KNOWN_SPENDERS_ETHEREUM`:

```typescript
// ---------------------------------------------------------------------------
// Lido per-chain SOT — Phase 30 Plan 30-01.
// ---------------------------------------------------------------------------

export interface LidoContracts {
  steth: Address;       // stETH proxy (Ethereum only)
  wsteth: Address;      // wstETH (Ethereum + Arbitrum bridged)
  withdrawalQueue: Address;  // WithdrawalQueueERC721 (Ethereum only)
}

// Ethereum mainnet: full 3-contract set.
// Arbitrum: wstETH only (bridged ERC20); steth + withdrawalQueue are Ethereum-only.
// The Arbitrum slot carries only wsteth; steth + withdrawalQueue are set to
// address(0) equivalents and never consumed by write tools (D-03 refusal).
// Pattern: `Partial<Record<ChainId, LidoContracts>>` → same as MORPHO_BLUE_RAW.
const LIDO_RAW: Partial<Record<ChainId, LidoContracts>> = {
  1: {
    steth: getAddress("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"),
    wsteth: getAddress("0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0"),
    withdrawalQueue: getAddress("0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1"),
  },
  42161: {
    // Arbitrum: wstETH bridged (read-only); steth + withdrawalQueue unused.
    // D-03: prepare_lido_* refuses for non-Ethereum chains before reaching this slot.
    steth: getAddress("0x0000000000000000000000000000000000000000"),  // N/A — Arbitrum has no bridged stETH
    wsteth: getAddress("0x5979D7b546E38E414F7E9822514be443A4800529"),
    withdrawalQueue: getAddress("0x0000000000000000000000000000000000000000"),  // N/A
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

**KNOWN_SPENDERS_ETHEREUM additive entries** (appended after Morpho Blue, alphabetical-by-label):

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

**T-LIDO-SPENDER-DRIFT-1 cross-view byte-identity invariant:** `getLidoWstethAddress(1) === KNOWN_SPENDERS_ETHEREUM[<wsteth_row>].address` must be asserted in `test/config-contracts.test.ts`.

**Slot ordering:** The new Lido entries are ADDITIVE. Existing 17 entries (rows 0-16) stay byte-identical — no shifting. Row 17 = Lido wstETH; Row 18 = Lido WithdrawalQueue. This preserves T-AAVE-SPENDER-DRIFT-1 and any other existing cross-view invariants.

---

## Topic 9: Canonical Dispatch Allowlist Extension

**[VERIFIED: reading src/security/canonical-dispatch.ts lines 1-213]**

Current `buildPerChainAllowlist(chainId)` composes: Aave, WETH, 1inch, LiFi, BRIDGED_VARIANTS tokens, Compound Comets, Morpho Blue.

Phase 30 extends with Lido write-side addresses:

```typescript
// Phase 30 — Plan 30-01. Lido write-side allowlist (Ethereum arm only).
// Arbitrum entries READ-ONLY (writes refuse pre-dispatch via D-03 CHAIN_ID_MISMATCH).
// Three contracts: stETH proxy (prepare_lido_stake + approval target label),
// wstETH (prepare_lido_wrap + prepare_lido_unwrap),
// WithdrawalQueue (prepare_lido_unstake).
const lidoSteth = getLidoStethAddress(chainId);
const lidoWsteth = getLidoWstethAddress(chainId);
const lidoWq = getLidoWithdrawalQueueAddress(chainId);
const lidoEntries: Address[] = [lidoSteth, lidoWsteth, lidoWq].filter(
  (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000"
);
```

The `buildPerChainAllowlist` will include Lido entries for chainId=1 (stETH, wstETH, WithdrawalQueue). For other chains, `getLidoStethAddress(chainId)` returns `null` → filtered out. Arbitrum slot has `steth: address(0)` and `withdrawalQueue: address(0)` — these are filtered out by the non-zero check, leaving only wstETH for Arbitrum reads (but Arbitrum wstETH is not in the dispatch allowlist for WRITE operations — only Ethereum matters here).

**Note on address(0) pattern:** The zero-address sentinel for the Arbitrum slot is a tradeoff. An alternative is to have the Arbitrum slot only contain `wsteth` (no `steth`/`withdrawalQueue` fields). The planner may choose a more discriminated approach — e.g., a separate `LidoArbitrumContracts` type with only `wsteth`. Either works; the key invariant is that writes refuse before reaching the allowlist check (D-03).

---

## Topic 10: Fixture Letter Audit — D-11 CONFIRMED

**[VERIFIED: reading .planning/phases/29-evm-morpho-blue-supply-withdraw-borrow-repay/29-RESEARCH.md Open Question 5 + 29-03-PLAN.md + test/signing-fingerprint.test.ts]**

**Phase 29 fixture letters:** The 29-RESEARCH.md Open Question 5 (resolved) states:

> "ROADMAP collision discovered at plan-check iter 1: V/W/X are RESERVED for Phase 30 Lido (per 30-CONTEXT.md); Y is RESERVED for Phase 32 Uniswap V3 (per 32-CONTEXT.md). RESOLVED: Use phase-prefixed convention Morpho-29-{A,B,C,D} in NEW sibling file test/signing-fingerprint-morpho.test.ts."

**Confirmed:** Phase 29 consumed `Morpho-29-A`, `Morpho-29-B`, `Morpho-29-C`, `Morpho-29-D` in `test/signing-fingerprint-morpho.test.ts`. The single-letter pool V/W/X/Y is INTACT and available for Phase 30.

**Fixture assignments for Phase 30 (D-11):**

| Fixture | Function | Contract | Key Parameters |
|---------|----------|----------|---------------|
| V | `Lido.submit(address(0))` | stETH proxy (`0xae7ab96...`) | value-bearing; referral=`0x0...0`; test with 1e18 wei ETH |
| W | `WithdrawalQueue.requestWithdrawals([1e18], wallet)` | WithdrawalQueue (`0x889edC2...`) | amounts=`[1000000000000000000n]`, owner=anvilWallet |
| X | `WstETH.wrap(1e18)` | wstETH (`0x7f39C5...`) | stethAmount=`1000000000000000000n` |
| Y | `WstETH.unwrap(1e18)` | wstETH (`0x7f39C5...`) | wstethAmount=`1000000000000000000n` |

These go into `test/signing-fingerprint.test.ts` (main fingerprint file, NOT a sibling — the 29 Morpho precedent used a sibling because there was a collision risk; V/W/X/Y are the natural continuation of the main file's R/S/T/U series).

**Rationale for main file (not sibling):** The Phase 28 R/S/T/U fixtures are in `test/signing-fingerprint.test.ts`. Phase 29 chose a sibling because V/W/X was "reserved for Phase 30" — meaning Phase 30 gets to be the one that populates them in the main file. Phase 29's sibling approach was the collision-avoidance; Phase 30 should now add V/W/X/Y to the main `test/signing-fingerprint.test.ts` directly.

---

## Topic 11: Test Infrastructure for Lido

**[VERIFIED: reading test/ directory listing + test/signing-fingerprint.test.ts structure]**

Existing test infrastructure to mirror:

| Analog | Phase 30 Clone |
|--------|---------------|
| `test/protocols-weth9.test.ts` | `test/protocols-lido.test.ts` — ABI selector byte-identity + all 4 encoder round-trips |
| `test/signing-aave-health.test.ts` | `test/signing-lido-rebase.test.ts` — pure-bigint constants + `computeRebaseRewards` fixture |
| `test/prepare-aave-supply.test.ts` | `test/prepare-lido-stake.test.ts`, `test/prepare-lido-unstake.test.ts` |
| `test/prepare-compound-supply.test.ts` | `test/prepare-lido-wrap.test.ts`, `test/prepare-lido-unwrap.test.ts` |
| `test/get-morpho-positions.test.ts` | `test/get-lido-positions.test.ts` |
| `test/aave-v3-lifecycle.integration.test.ts` | `test/lido-lifecycle.integration.test.ts` |

**New test files for Phase 30:**

1. `test/protocols-lido.test.ts` — ABI fragment integrity + 4 selector byte-identity (`0xa1903eab`, `0xd6681042`, `0xea598cb0`, `0xde0e9a3e`) + encoder round-trips via viem decoding
2. `test/signing-lido-rebase.test.ts` — `STETH_DECIMALS` constant + `computeRebaseRewards` deterministic input → expected output literal
3. `test/signing-fingerprint.test.ts` (EXTEND) — Fixture V/W/X/Y hardcoded `0x...` literals (compute at write-time via script; never `beforeAll` snapshot)
4. `test/get-lido-positions.test.ts` — mock publicClient reads for stETH/wstETH balances + shares + conversionRate; Ethereum + Arbitrum branches; `approx: true` present on accruedRebaseRewards
5. `test/prepare-lido-stake.test.ts` — schema validation + value-bearing calldata + RECEIPT byte-identity + Fixture V cross-link
6. `test/prepare-lido-unstake.test.ts` — approval pre-flight mock (insufficient → INVALID_INPUT), stethAmount encoding as `[stethAmount]` array + `[NFT RECEIPT EXPECTED]` block present + Fixture W cross-link + tokenId = lastRequestId + 1
7. `test/prepare-lido-wrap.test.ts` — approval pre-flight mock + wrap calldata + Fixture X cross-link
8. `test/prepare-lido-unwrap.test.ts` — no approval needed + unwrap calldata + Fixture Y cross-link
9. `test/lido-lifecycle.integration.test.ts` — persona-cycle byte-identity for stake → unstake → wrap → unwrap; Fixtures V/W/X/Y re-anchored across personas (V/X/Y are from-independent; W includes `owner=wallet` in calldata so is per-persona)

**Test file naming discipline:** `prepare-lido-stake.test.ts`, not `prepare_lido_stake.test.ts` (hyphen, not underscore — existing project convention from `prepare-aave-supply.test.ts`, `prepare-compound-supply.test.ts`).

---

## Topic 12: Implementation Pitfalls

**[VERIFIED: Lido contract source + project codebase patterns]**

### Pitfall 1: `requestWithdrawals` array encoding with single element
**What goes wrong:** The ABI signature is `requestWithdrawals(uint256[] calldata _amounts, address _owner)`. If a developer naively passes a raw `bigint` instead of `[bigint]` as the `amounts` arg, viem will throw an ABI encoding error or produce incorrect calldata.
**Prevention:** Always encode as `[stethAmountWei]` even for single-amount per D-06. Explicitly test that the calldata length is correct (36 bytes for selector + 96 bytes for array encoding = 132 bytes total).

```typescript
// Correct encoding for single-amount array:
encodeFunctionData({
  abi: WQ_ABI_FRAGMENTS,
  functionName: "requestWithdrawals",
  args: [[stethAmountWei], ownerAddress],  // ← outer [] wraps the single element
});
```

### Pitfall 2: stETH balance vs shares confusion in rebase math
**What goes wrong:** `balanceOf(wallet)` returns the CURRENT stETH balance (changes with every oracle report). `sharesOf(wallet)` returns the SHARE count (invariant under rebases). Computing `currentBalance - sharesOf` as a proxy for "reward" works only if shares ≈ original deposit in ETH — which is approximately true but not exact for wallets with multiple deposits at different rates.
**Prevention:** Surface `approx: true` per D-09. Never compute exact PnL without full transfer history.

### Pitfall 3: Wrap selector collision concern (non-issue but worth noting)
**What goes wrong:** Someone might worry that `WstETH.wrap(uint256)` selector `0xea598cb0` conflicts with another contract. It does not — the selector is contract-specific at the dispatch level (canonical-dispatch targets `tx.to` first, then the selector). The selector constant must be regression-tested against `viem.toFunctionSelector("wrap(uint256)")` so drift is caught at unit-test time.

### Pitfall 4: stETH approval not auto-set after stake
**What goes wrong:** A user who just staked ETH to get stETH will NOT automatically have stETH approval for wstETH wrap or WithdrawalQueue unstake. The D-05 pre-flight is load-bearing — a first-time Lido user has zero allowance.
**Prevention:** The approval pre-flight (D-05) always runs at prepare time. The `hintTool` pattern is essential UX: `prepare_token_approve({ tokenAddress: stETH, spender: wstETH, amount: "..." })`.

### Pitfall 5: Arbitrum wstETH has no `stEthPerToken()` function
**What goes wrong:** Calling `WstETH.stEthPerToken()` on the Arbitrum bridged wstETH contract (`0x5979D...`) will revert — the bridged ERC20Bridged does not implement this function. Only the Ethereum mainnet wstETH contract has it.
**Prevention:** For Arbitrum `get_lido_positions`, fetch `conversionRate` from Ethereum mainnet's wstETH contract via the Ethereum `getChainClient(1)` — NOT the Arbitrum client.

### Pitfall 6: WithdrawalQueue minimum amount validation
**What goes wrong:** Calling `requestWithdrawals([100], wallet)` (100 wei) is valid per contract minimum, but very small amounts may be uneconomical. More importantly, `requestWithdrawals([MAX+1], wallet)` where MAX = 1000 ETH will revert.
**Prevention:** Validate `stethAmountWei >= 100n` AND `stethAmountWei <= 1_000n * 10n**18n` at prepare time. Surface `INVALID_INPUT` with a clear message if violated.

### Pitfall 7: `submit(address referral)` is `payable` — value field is the stake amount
**What goes wrong:** Unlike all other Lido calls (ERC-20 operations), `Lido.submit` is a payable function. The agent-passed `amount` goes into `tx.value` (ETH), NOT into calldata. The calldata only carries the 4-byte selector + 32-byte referral address.
**Prevention:** `tx.value = parseEther(amount)` (decimal-string to wei per CLAUDE.md convention); `tx.data = encodeLidoSubmit(address(0))` (36 bytes total). Mirror `prepare_native_send`'s value-bearing shape.

---

## Architecture Patterns

### System Architecture Diagram

```
Agent (intent: "stake 1 ETH" / "unstake 0.5 stETH" / "wrap 1 stETH" / "unwrap 0.5 wstETH")
   │
   ▼
prepare_lido_stake / _unstake / _wrap / _unwrap
   │
   ├─► [stake]    value = parseEther(amount); data = encodeLidoSubmit(address(0))
   │               → tx.to: stETH proxy (0xae7ab9...)
   │
   ├─► [unstake]  approval pre-flight: stETH.allowance(wallet, withdrawalQueue) >= amount?
   │   │          → INVALID_INPUT + hintTool: prepare_token_approve if insufficient
   │   ├─► getLastRequestId() → expectedTokenId = lastId + 1n
   │   └─► data = encodeRequestWithdrawals([amountWei], wallet)
   │               → tx.to: WithdrawalQueue (0x889edC2...)
   │               → [NFT RECEIPT EXPECTED] block: contract, tokenId, claimableAfter
   │
   ├─► [wrap]     approval pre-flight: stETH.allowance(wallet, wstETH) >= amount?
   │               → data = encodeWstethWrap(amountWei)
   │               → tx.to: wstETH (0x7f39C5...)
   │
   └─► [unwrap]   no approval pre-flight needed
               → data = encodeWstethUnwrap(amountWei)
               → tx.to: wstETH (0x7f39C5...)
   │
   ├─► computePayloadFingerprint({ chainId: 1, to, valueWei, data })
   │
   └─► createHandle → PREPARE RECEIPT → tool response
          │
          ▼
      preview_send (Layer 0.5 dispatch check: stETH/wstETH/WQ in allowlist for chainId=1)
          │
          ├─► decodeLidoCall → { kind: "lido-submit" | "lido-request-withdrawals" | "lido-wrap" | "lido-unwrap", ... }
          │
          ├─► NO LEDGER NOTICE needed (ERC-7730 clear-sign coverage confirmed for all 4 functions)
          │
          └─► DECODED ARGS block: selector kind, amount, owner/referral
                   │
                   ▼
              send_transaction (previewToken + userDecision + payloadFingerprint drift gate)
                   │
                   ▼
              Ledger device (CLEAR-SIGNS: decoded Lido tx with parameters on-screen)

get_lido_positions({ wallet, chain })
   │
   ├─► [Ethereum]  Promise.all([
   │                 stETH.balanceOf(wallet),
   │                 stETH.sharesOf(wallet),
   │                 stETH.getPooledEthByShares(shares),  ← cross-check
   │                 wstETH.balanceOf(wallet),
   │                 wstETH.stEthPerToken(),               ← conversion rate
   │               ])
   │
   └─► [Arbitrum]  Promise.all([
                     arbitrumWstETH.balanceOf(wallet),    ← Arbitrum client
                     ethereumWstETH.stEthPerToken(),      ← Ethereum client (same rate)
                   ])
```

### Recommended Project Structure

```
src/
├── protocols/
│   └── lido.ts              # ABI fragments + 4 selectors + 4 encoders + decoder (mirrors weth9.ts + aave-v3.ts)
├── chains/
│   └── lido.ts              # Per-chain read helpers (mirrors chains/morpho-blue.ts)
├── signing/
│   └── lido-rebase.ts       # Pure-bigint shares↔assets math (mirrors signing/aave-health.ts)
├── config/
│   └── contracts.ts         # LidoContracts interface + LIDO_RAW sub-table + 3 getters + 2 KNOWN_SPENDERS entries
├── security/
│   └── canonical-dispatch.ts  # Lido 3-contract arm wired for Ethereum
└── tools/
    ├── get_lido_positions.ts
    ├── prepare_lido_stake.ts
    ├── prepare_lido_unstake.ts
    ├── prepare_lido_wrap.ts
    └── prepare_lido_unwrap.ts
```

### Pattern 1: Lido Submit Encoder (value-bearing call)

```typescript
// Source: lidofinance/core/contracts/0.4.24/Lido.sol (verified 2026-05-23)
// selector: 0xa1903eab = keccak256("submit(address)")[:4]
export const LIDO_STETH_SUBMIT_ABI = parseAbi([
  "function submit(address _referral) payable returns (uint256)",
]);

export function encodeLidoSubmit(referral: Address): Hex {
  return encodeFunctionData({
    abi: LIDO_STETH_SUBMIT_ABI,
    functionName: "submit",
    args: [referral],
  });
}
// In prepare_lido_stake.ts:
// const data = encodeLidoSubmit("0x0000000000000000000000000000000000000000");
// tx.value = parseEther(amount)  // the ETH stake value
```

### Pattern 2: requestWithdrawals Encoder (single-element array)

```typescript
// Source: lidofinance/core contracts (verified 2026-05-23)
// selector: 0xd6681042 = keccak256("requestWithdrawals(uint256[],address)")[:4]
export const WQ_REQUEST_ABI = parseAbi([
  "function requestWithdrawals(uint256[] calldata _amounts, address _owner) returns (uint256[] requestIds)",
]);

export function encodeRequestWithdrawals(stethAmountWei: bigint, owner: Address): Hex {
  return encodeFunctionData({
    abi: WQ_REQUEST_ABI,
    functionName: "requestWithdrawals",
    args: [[stethAmountWei], owner],  // single-element array for D-06
  });
}
```

### Pattern 3: Wrap/Unwrap Encoders (mirrors weth9.ts exactly)

```typescript
// Source: lidofinance/core contracts (verified 2026-05-23)
// wrap selector: 0xea598cb0 = keccak256("wrap(uint256)")[:4] (VERIFIED)
// unwrap selector: 0xde0e9a3e = keccak256("unwrap(uint256)")[:4] (VERIFIED)
export const WSTETH_WRAP_ABI = parseAbi(["function wrap(uint256 _stETHAmount) returns (uint256)"]);
export const WSTETH_UNWRAP_ABI = parseAbi(["function unwrap(uint256 _wstETHAmount) returns (uint256)"]);

export function encodeWstethWrap(stethAmount: bigint): Hex {
  return encodeFunctionData({ abi: WSTETH_WRAP_ABI, functionName: "wrap", args: [stethAmount] });
}
export function encodeWstethUnwrap(wstethAmount: bigint): Hex {
  return encodeFunctionData({ abi: WSTETH_UNWRAP_ABI, functionName: "unwrap", args: [wstethAmount] });
}
```

### Pattern 4: NFT RECEIPT EXPECTED Block (D-04 novel block template)

```typescript
// In src/signing/blocks.ts — new template alongside LEDGER_BLIND_SIGN_HASH_TEMPLATE etc.
export const NFT_RECEIPT_EXPECTED_TEMPLATE = (args: {
  nftContract: Address;
  expectedTokenId: string;  // bigint as string (decimal)
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

### Anti-Patterns to Avoid

- **Passing raw bigint to `requestWithdrawals` amounts arg:** Always wrap in `[amount]` (array). ABI signature is `uint256[]`.
- **Calling `stEthPerToken()` on Arbitrum wstETH:** The bridged ERC20Bridged does not implement this. Use Ethereum mainnet client.
- **`submit` without setting `tx.value`:** The ETH stake goes in `value`, not calldata. Zero-value submit call succeeds on-chain but stakes 0 ETH.
- **Using `getLastRequestId()` without `+1`:** The function returns the LAST used ID; the NEXT request gets `lastId + 1n`.
- **No approval pre-flight for `wrap` or `unstake`:** These require prior stETH approval; skipping the pre-flight causes on-chain revert.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ABI encoding for array param `uint256[]` | Custom array encoding | `viem.encodeFunctionData` with `parseAbi` containing `uint256[]` | ABI dynamic array encoding (offset + length + elements) is non-trivial |
| Shares ↔ assets conversion | Custom formula | Inline bigint arithmetic: `balance = shares * totalPooledEther / totalShares` | Overflow risk at u256 scale; use bigint throughout |
| Withdrawal queue tokenId prediction | Post-tx event scan | `getLastRequestId() + 1n` pre-tx read | Simple deterministic read |
| stETH allowance check | UI-level advisory | Server-side `allowance()` read + structured `INVALID_INPUT + hintTool` refusal | Consistent with Phase 28 approval gate pattern |
| Function selectors | Re-derive at runtime | Hardcoded constants verified via `toFunctionSelector` at research time | Avoids runtime selector computation + enables compile-time regression |

**Key insight:** Lido's on-chain ABI is simpler than both Compound and Morpho (4 functions vs 2 and 6 respectively). The complexity comes from the rebase accounting math and the multi-contract coordination — not from ABI encoding complexity. No SDK needed.

---

## Common Pitfalls (Consolidated)

### Pitfall 1: Array ABI Encoding for Single-Element `requestWithdrawals`
**What goes wrong:** Agent passes `stethAmount` (bigint) instead of `[stethAmount]` (array). ABI encoding diverges.
**Why it happens:** Developers often forget to wrap single-element arrays.
**How to avoid:** `args: [[stethAmountWei], owner]` in `encodeFunctionData`. Test: calldata length for a single-element array = `4 + 32 (offset) + 32 (length=1) + 32 (element) = 100 bytes → 0x + 200 hex = 202 chars`.
**Warning signs:** Calldata is wrong length; Fixture W mismatch at test time.

### Pitfall 2: Value-Bearing Submit vs Data-Only Calls
**What goes wrong:** Treating `submit` like an ERC-20 call. Setting `tx.value = 0n` means 0 ETH staked.
**Why it happens:** Most Phase 30 tools are data-only; `submit` is the one exception.
**How to avoid:** Mirror `prepare_native_send` shape for the value field. Assert `tx.value > 0n` at prepare time; refuse with `INVALID_INPUT` if zero.

### Pitfall 3: Arbitrum `stEthPerToken()` Call Reverts
**What goes wrong:** `publicClient.readContract({ address: arb_wsteth, functionName: "stEthPerToken" })` throws.
**Why it happens:** Bridged ERC20Bridged on Arbitrum is a plain ERC-20; no oracle functions.
**How to avoid:** Use `getChainClient(1)` (Ethereum mainnet) to fetch `stEthPerToken()`. The rate is globally applicable.

### Pitfall 4: Missing Approval for First-Time Users
**What goes wrong:** User just received stETH from a stake but has zero allowance for wstETH or WithdrawalQueue.
**Why it happens:** ETH → stETH stake does not auto-set approval.
**How to avoid:** D-05 pre-flight is mandatory; the structured `hintTool` response guides the agent to `prepare_token_approve` first.

### Pitfall 5: stETH Balance Staleness (OK behavior, not a bug)
**What goes wrong:** Agent expects stETH balance to be constant between two reads separated by an oracle report. Balance increases (rebase reward).
**Why it happens:** stETH is rebase-bearing; daily oracle updates increase all balances.
**How to avoid:** Document in `get_lido_positions` description that the `stethBalance` field reflects the balance at read time and may change without transfers. The `approx: true` flag on `accruedRebaseRewards` sets correct expectations.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Lido v1 on-demand unstake | WithdrawalQueue v2 NFT-receipt queue | 2023 (Phase 30 ships v2 only) | Users receive ERC-721 NFT; must claim separately after finalization |
| Unlimited stETH balance tracking | Shares-based accounting | Lido launch | Shares are invariant; balance floats with oracle reports |
| Manual approval for everything | Approval pre-flight with `hintTool` pattern | Phase 28 (Compound, adopted for Phase 30) | Structured refusal instead of on-chain revert |
| ERC-7730 blind-sign (WETH9 era) | Clear-sign coverage in registry | ~2024 | All 4 Lido operations decode on-device — no LEDGER NOTICE needed |

**Deprecated/outdated:**
- Lido v1 unstake (`burn(shares)` direct pattern): replaced by WithdrawalQueue v2. Phase 30 ships v2 ONLY.
- `stETHPerToken` naming variant: canonical function is `stEthPerToken()` (camelCase). Avoid underscore-style.

---

## Runtime State Inventory

This is not a rename/refactor phase. Omit.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥ 18.17 | Runtime | ✓ | Verified (project requirement) | — |
| viem | ABI encode/decode, publicClient | ✓ | 2.48.11 (project) | — |
| vitest | Tests | ✓ | Project config | — |
| Ethereum mainnet RPC | stETH/wstETH reads at prepare time | ✓ | PublicNode/configured | — |
| Arbitrum mainnet RPC | `get_lido_positions` Arbitrum branch | ✓ | PublicNode/configured (Phase 8) | — |

No new environment dependencies. All required external services already in scope.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The bridged wstETH on Arbitrum (`0x5979D...`) does NOT implement `stEthPerToken()` | Topic 5 | If it does implement `stEthPerToken()`, we can simplify Arbitrum reads (use Arbitrum client directly); low risk |
| A2 | `getLastRequestId() + 1` deterministically predicts the tokenId for a single-amount `requestWithdrawals` call | Topic 6 | If WithdrawalQueue batches internally or uses a different counter, the predicted tokenId could be wrong; residual risk documented in `[NFT RECEIPT EXPECTED]` block |
| A3 | stETH on Arbitrum is NOT separately bridged (only wstETH is bridged) | Topic 5 | If a bridged stETH token exists on Arbitrum, `get_lido_positions` Arbitrum branch would need to return a stETH balance; MEDIUM risk — verify at planning time via Arbiscan |
| A4 | `accruedRebaseRewards ≈ currentBalance - sharesOf` is a sufficient approximation for the D-09 `approx: true` display value | Topic 2 | If this formula is misleading for users with multiple deposits at different rates, it could confuse rather than inform; low risk given explicit `approx: true` flag |

**Highest-risk assumption: A3.** Verify at planning gate whether stETH itself is separately bridged to Arbitrum. The search results and Lido docs consistently show only wstETH bridged to Arbitrum, but a confirmatory Arbiscan lookup is recommended.

---

## Open Questions (All Resolved)

1. **D-07 selector verification** — RESOLVED: `WstETH.wrap` = `0xea598cb0` and `WstETH.unwrap` = `0xde0e9a3e` confirmed via `viem.toFunctionSelector` executed during research. CONTEXT.md D-07 placeholders are correct.

2. **D-12 ERC-7730 coverage** — RESOLVED: All 4 write functions confirmed in LedgerHQ registry. NO LEDGER NOTICE for any Phase 30 tool.

3. **D-11 fixture letter collision** — RESOLVED: Phase 29 used `Morpho-29-{A,B,C,D}` in sibling file. V/W/X/Y are unoccupied. Phase 30 populates them in the main `test/signing-fingerprint.test.ts`.

4. **Arbitrum stETH availability** — RESOLVED (with [ASSUMED] tag): stETH is NOT separately bridged to Arbitrum; only wstETH crosses the Lido canonical bridge. Arbitrum read returns `wstethBalance` only.

5. **Arbitrum `stEthPerToken()` availability** — RESOLVED: bridged wstETH does not expose this function. Use Ethereum mainnet client for conversion rate on Arbitrum reads.

6. **Referral param exposure** — RESOLVED via Claude's Discretion: hardcode `address(0)`. No product reason surfaced to expose the referral.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (Phase 28/29 config) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run test/protocols-lido.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIDO-01 | `get_lido_positions` returns stETH + wstETH + shares + rate + accrual | unit | `npx vitest run test/get-lido-positions.test.ts` | ❌ Wave 0 |
| LIDO-02 | `prepare_lido_stake` encodes value-bearing submit calldata | unit | `npx vitest run test/prepare-lido-stake.test.ts` | ❌ Wave 0 |
| LIDO-03 | `prepare_lido_unstake` encodes array calldata + NFT block + approval gate | unit | `npx vitest run test/prepare-lido-unstake.test.ts` | ❌ Wave 0 |
| LIDO-04 | `prepare_lido_wrap` + `prepare_lido_unwrap` encode single-arg calldata | unit | `npx vitest run test/prepare-lido-wrap.test.ts test/prepare-lido-unwrap.test.ts` | ❌ Wave 0 |
| LIDO-05 | `getLidoStethAddress(1)` returns correct address; dispatch allowlist includes all 3 Lido contracts; KNOWN_SPENDERS byte-identity | unit | `npx vitest run test/config-contracts.test.ts` | ✅ (extend) |
| — | Selector byte-identity: 4 selectors match verified values | unit | `npx vitest run test/protocols-lido.test.ts` | ❌ Wave 0 |
| — | Fixture V/W/X/Y payloadFingerprint hardcoded literals | unit | `npx vitest run test/signing-fingerprint.test.ts` | ✅ (extend) |
| — | Full lifecycle: stake → unstake → wrap → unwrap persona-cycle | integration | `npx vitest run test/lido-lifecycle.integration.test.ts` | ❌ Wave 0 |
| — | lido-rebase.ts computeRebaseRewards deterministic formula | unit | `npx vitest run test/signing-lido-rebase.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/protocols-lido.test.ts test/config-contracts.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/protocols-lido.test.ts` — ABI fragment + 4 selector byte-identity + 4 encoder round-trips (covers LIDO-02/03/04 selector side)
- [ ] `test/signing-lido-rebase.test.ts` — `computeRebaseRewards` deterministic literal
- [ ] `test/get-lido-positions.test.ts` — mock publicClient + Ethereum + Arbitrum branches + `approx: true` flag (covers LIDO-01)
- [ ] `test/prepare-lido-stake.test.ts` — value-bearing tx shape + Fixture V cross-link (covers LIDO-02)
- [ ] `test/prepare-lido-unstake.test.ts` — approval gate + array encoding + `[NFT RECEIPT EXPECTED]` block + Fixture W cross-link (covers LIDO-03)
- [ ] `test/prepare-lido-wrap.test.ts` — approval gate + wrap encoding + Fixture X cross-link (covers LIDO-04 wrap)
- [ ] `test/prepare-lido-unwrap.test.ts` — no approval + unwrap encoding + Fixture Y cross-link (covers LIDO-04 unwrap)
- [ ] `test/lido-lifecycle.integration.test.ts` — persona-cycle byte-identity for V/W/X/Y
- [ ] Extend `test/signing-fingerprint.test.ts` with Fixtures V/W/X/Y hardcoded `0x...` literals
- [ ] Extend `test/config-contracts.test.ts` with T-LIDO-SPENDER-DRIFT-1 cross-view byte-identity assertion

---

## Security Domain

### Applicable ASVS Categories (L2)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | Ethereum-write-only gate (D-03); approval pre-flight (D-05); dispatch allowlist (D-10) |
| V5 Input Validation | yes | `parseAmountStrict` for decimal amounts; withdrawal amount bounds (100 wei min, 1000 ETH max); wallet address validation via `viem.isAddress` |
| V6 Cryptography | yes | `payloadFingerprint` keccak256 preimage per PREP-03; inherited FROZEN trust pipeline |

### Threat Model (for planner's `<threat_model>` block)

| Threat ID | Pattern | STRIDE | Standard Mitigation |
|-----------|---------|--------|---------------------|
| T-LIDO-WRONG-CHAIN | Write attempt on non-Ethereum chain | Tampering | D-03: `CHAIN_ID_MISMATCH` errorCode 15 refusal at prepare time |
| T-LIDO-ALLOWANCE-DRIFT | `wrap` or `unstake` called without stETH approval | Tampering | D-05: `stETH.allowance()` pre-flight at prepare time; `INVALID_INPUT + hintTool` |
| T-LIDO-DISPATCH-DRIFT | Lido prepare call routes to non-allowlisted address | Tampering | D-10: `CANONICAL_DISPATCH_TARGETS` allowlist (Layer 0.5); `DISPATCH_TARGET_REFUSED` |
| T-LIDO-FINGERPRINT-DRIFT | `payloadFingerprint` drift between prepare and send | Spoofing | Phase 4 three-gate FROZEN region; send_transaction gate 3 |
| T-LIDO-REBASE-SNAPSHOT-STALENESS | `accruedRebaseRewards` is approximate; user misinterprets as exact PnL | Information Disclosure | D-09: `approx: true` flag; description explicitly disclaims approximation |
| T-LIDO-NFT-TOKENID-RACE | Another tx mints withdrawal NFT between prepare-time read and tx landing | Repudiation | `[NFT RECEIPT EXPECTED]` block carries "best-effort; may shift" advisory; documented residual risk |
| T-LIDO-SPENDER-DRIFT-1 | `KNOWN_SPENDERS_ETHEREUM` wstETH/WQ entries drift from `getLidoWstethAddress(1)` / `getLidoWithdrawalQueueAddress(1)` SOT | Tampering | T-LIDO-SPENDER-DRIFT-1 cross-view assertion in `test/config-contracts.test.ts` |
| T-LIDO-ZERO-VALUE-STAKE | `prepare_lido_stake` called with zero ETH amount | Tampering | Validate `amount > 0` at prepare time; `INVALID_INPUT` refusal |
| T-LIDO-WITHDRAWAL-AMOUNT-BOUNDS | `requestWithdrawals` called with amount < 100 wei or > 1000 ETH | Tampering | Validate bounds at prepare time; `INVALID_INPUT` with clear message |

---

## Sources

### Primary (HIGH confidence)
- `docs.lido.fi/deployed-contracts` — stETH, wstETH, WithdrawalQueue proxy addresses (chainId 1); Arbitrum wstETH address; v3.0.2 status confirmed
- `github.com/LedgerHQ/clear-signing-erc7730-registry/tree/master/registry/lido` — ERC-7730 registry lido/ directory: 3 JSON files confirmed; all 4 write functions covered
- `raw.githubusercontent.com/LedgerHQ/clear-signing-erc7730-registry/.../calldata-stETH.json` — `submit` covered on chainId 1
- `raw.githubusercontent.com/LedgerHQ/clear-signing-erc7730-registry/.../calldata-wstETH.json` — `wrap` + `unwrap` covered on chainId 1
- `raw.githubusercontent.com/LedgerHQ/clear-signing-erc7730-registry/.../calldata-WithdrawalQueueERC721.json` — `requestWithdrawals` covered on chainId 1
- `viem.toFunctionSelector` (local execution) — 4 selectors verified: `0xa1903eab`, `0xd6681042`, `0xea598cb0`, `0xde0e9a3e`
- `github.com/lidofinance/lido-l2/blob/main/artifacts-arb.json` — Arbitrum wstETH ERC20Bridged proxy `0x5979D7b546E38E414F7E9822514be443A4800529` verified
- `docs.lido.fi/contracts/withdrawal-queue-erc721` — `getLastRequestId()` semantics; withdrawal amount bounds (100 wei min, 1000 ETH max)
- Project codebase (`src/config/contracts.ts`, `src/security/canonical-dispatch.ts`, `src/protocols/weth9.ts`, `src/signing/aave-health.ts`) — exact extension points verified by reading source

### Secondary (MEDIUM confidence)
- `docs.lido.fi/guides/lido-tokens-integration-guide` — stETH rebase mechanics; `sharesOf`, `getSharesByPooledEth`, `getPooledEthByShares` semantics; wstETH L2 bridge limitations; `stEthPerToken` availability
- `.planning/phases/29-evm-morpho-blue-supply-withdraw-borrow-repay/29-RESEARCH.md` — Phase 29 fixture letter reservation; confirmed V/W/X/Y unoccupied
- `arbiscan.io/token/0x5979d7b546e38e414f7e9822514be443a4800529` — Arbitrum wstETH contract confirmed

### Tertiary (LOW confidence)
- WebSearch result on `getLastRequestId() + 1` tokenId prediction — supported by docs pattern but not individually unit-tested at research time

---

## Metadata

**Confidence breakdown:**
- Contract addresses + selectors: HIGH — verified against official docs + viem.toFunctionSelector execution
- ERC-7730 clear-sign coverage: HIGH — verified against registry JSON files
- Arbitrum wstETH (no stETH): MEDIUM — sourced from lidofinance/lido-l2 artifacts + docs; stETH absence on Arbitrum is consistent across sources
- Arbitrum wstETH no stEthPerToken: MEDIUM — doc guide states bridged contracts lack this function; A1 is the residual assumption
- WithdrawalQueue tokenId = lastId + 1: MEDIUM — consistent with docs and monotonic counter design; A2 is the residual assumption
- Fixtures V/W/X/Y availability: HIGH — Phase 29 research explicitly preserved them; confirmed by reading 29-RESEARCH.md
- Standard stack (no new npm packages): HIGH — viem sufficient for all encoding

**Research date:** 2026-05-23
**Valid until:** 2026-07-23 (60 days — Lido contract addresses are stable; ERC-7730 registry may get updates; stETH rebase math is immutable by design)

---

## Project Constraints (from CLAUDE.md)

- **`src/config/contracts.ts` SOT discipline:** Every Lido address MUST be sourced from this file. Never inline in tool implementations.
- **Fixture pinning rule:** V/W/X/Y are hardcoded `0x...` literals computed once at write-time. No `beforeAll`-snapshot.
- **ESM spy-affordance:** `src/protocols/lido.ts` MUST export a `_lidoProtocol` indirection object; `src/signing/lido-rebase.ts` MUST export a `_lidoRebase` indirection object for test spy coverage.
- **Decimal-aware arithmetic:** `amount` enters as a decimal string (e.g. `"1.5"`); server resolves via `parseAmountStrict` before encoding. stETH = 18 decimals (hard-coded; no on-chain lookup needed).
- **PREPARE RECEIPT verbatim:** Every `prepare_lido_*` tool includes the verbatim agent args in the `PREPARE RECEIPT` block.
- **`payloadFingerprint` re-check at send time:** Inherited from Phase 4 three-gate FROZEN region.
- **`previewToken + userDecision: "send"` schema-gated:** Inherited from Phase 4 FROZEN.
- **Stderr for diagnostics, stdout for MCP protocol:** No mixing.
- **`viem` (no ethers.js):** All ABI encoding via viem.
- **Strict TypeScript:** All new code compiles cleanly with `tsc --noEmit`.
- **`[NFT RECEIPT EXPECTED]` is a NEW block template:** Must be added to `src/signing/blocks.ts` APPEND-ONLY (no modification of existing templates).
