---
phase: 31-evm-eigenlayer-rocket-pool
verified: 2026-05-23T13:30:00Z
status: human_needed
score: 6/6 success criteria + 4/4 REQ-IDs + 15/15 D-decisions verified
overrides_applied: 0
human_verification:
  - test: "EIG-02 — small-amount StrategyManager.depositIntoStrategy via prepare_eigenlayer_deposit on Ethereum mainnet through physical Ledger device"
    expected: "Ledger device displays BLIND-SIGN HASH (no ERC-7730 coverage) that matches character-for-character the LEDGER BLIND-SIGN HASH block in preview_send; LEDGER NOTICE template surfaces blind-sign-required precondition (Settings → Blind signing → Enabled) BEFORE signing; tx broadcasts and lands on-chain; allowance is consumed."
    why_human: "Real-Ledger USB-HID broadcast requires a physical device + user-controlled Ethereum-app state. Cryptographic-binding chain is anchored by on-device hash match against the blind-sign hash — only a human with the device can verify the character-for-character match. Bundled per the 2026-05-16 directive: Phases 28/29/30/31 mainnet broadcast across 4 protocols."
  - test: "RP-02 stake — small-amount RocketDepositPool.deposit() via prepare_rocketpool_stake on Ethereum mainnet through physical Ledger device"
    expected: "Ledger device displays BLIND-SIGN HASH that matches preview_send; D-13 LEDGER NOTICE (SHARED template) emitted; tx broadcasts and mints rETH proportional to msg.value at current exchange rate."
    why_human: "Real-Ledger USB-HID broadcast; on-device hash-match is the cryptographic anchor. Bundled per the 2026-05-16 directive."
  - test: "RP-02 unstake — small-amount rETH.burn(amount) via prepare_rocketpool_unstake on Ethereum mainnet through physical Ledger device (deposit-pool liquidity confirmed sufficient at send time)"
    expected: "Ledger device displays BLIND-SIGN HASH for rETH.burn; D-13 LEDGER NOTICE (SHARED template — same as stake — symmetric blind-sign UX) emitted; tx broadcasts; rETH burned; ETH returned to msg.sender; D-08 pre-flight outcome verified post-send (no Pitfall 5 race-window revert)."
    why_human: "Real-Ledger USB-HID broadcast; on-device hash-match is the cryptographic anchor. Also exercises Pitfall 5 race-window residual disclosure (T-ROCKETPOOL-LIQUIDITY-RACE). Bundled per the 2026-05-16 directive."
  - test: "Phase 28 (Compound V3) — small-amount supply/withdraw/borrow/repay against one curated Comet through physical Ledger device"
    expected: "Per-tool LEDGER NOTICE (Compound V3 is NOT in ERC-7730 registry); on-device hash match for each of the 4 selectors; intent-vs-reality refusals fire correctly when allowance/collateral/repay-max boundaries are exercised."
    why_human: "Bundled v2.3 verify-phase smoke per 2026-05-16 directive — full milestone close-out requires real-device validation across all 4 lending/staking protocols."
  - test: "Phase 29 (Morpho Blue) — small-amount supply/withdraw/supplyCollateral/withdrawCollateral/borrow/repay against one isolated market through physical Ledger device"
    expected: "Clear-sign decoded args (Morpho IS in ERC-7730 registry — NO LEDGER NOTICE); on-device DECODED ARGS match preview_send; all 6 market-write selectors verified."
    why_human: "Bundled v2.3 verify-phase smoke — only protocol in v2.3 with ERC-7730 clear-sign coverage; on-device decoded-args match is the cryptographic anchor (no blind-sign hash fallback)."
  - test: "Phase 30 (Lido) — small-amount stake/unstake-via-NFT/wrap/unwrap on Ethereum mainnet through physical Ledger device"
    expected: "Clear-sign decoded args (Lido IS in ERC-7730 registry — NO LEDGER NOTICE per D-12); on-device DECODED ARGS match preview_send for all 4 selectors; NFT withdrawal-receipt surface (expectedTokenId via getLastRequestId() + 1) verified end-to-end (T-LIDO-NFT-TOKENID-RACE accepted residual exercised)."
    why_human: "Bundled v2.3 verify-phase smoke — NFT-receipt flow + rebase-bearing token shelf only validates end-to-end against a real device."
---

# Phase 31: EigenLayer + Rocket Pool Verification Report

**Phase Goal:** "User can deposit LSTs into EigenLayer for restaking, and stake / unstake on Rocket Pool (rETH). EigenLayer is Ethereum-only; Rocket Pool is Ethereum-only."

**Verified:** 2026-05-23T13:30:00Z
**Status:** human_needed (code-complete; real-Ledger USB-HID smoke deferred per the 2026-05-16 bundled-verification directive)
**Re-verification:** No — initial verification

## Goal Achievement

### Success Criteria (ROADMAP.md — must all be TRUE)

| #   | Criterion                                                                                         | Status     | Evidence                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `get_eigenlayer_positions({ wallet })` returns EigenLayer strategy-level deposits                 | ✓ VERIFIED | `src/tools/get_eigenlayer_positions.ts` (181 lines) — registerTool wires to `_eigenLayerChains.readEthereumPositions`; 8 tests pass in `test/get-eigenlayer-positions.test.ts`                                                 |
| 2   | `prepare_eigenlayer_deposit({ strategy, lst, amount })` produces unsigned `depositIntoStrategy`   | ✓ VERIFIED | `src/tools/prepare_eigenlayer_deposit.ts:118` DESCRIPTION + lines 21-24 construct `tx.to = StrategyManager`, `tx.valueWei = 0n`, `tx.data = encodeDepositIntoStrategy(...)`; 18 tests in `test/prepare-eigenlayer-deposit.test.ts`; Fixture Z literal `0x2c36a77f8e39c8d0f8d276f88169608e1a247bb288117da00f90b1f7dd158684` pinned at `test/signing-fingerprint.test.ts:452` |
| 3   | `get_rocketpool_positions({ wallet })` returns rETH balance + accrued value                       | ✓ VERIFIED | `src/tools/get_rocketpool_positions.ts` (176 lines); returns `{rethBalance, exchangeRate, ethEquivalent, chain, chainId}`; 6 tests pass in `test/get-rocketpool-positions.test.ts`                                              |
| 4   | `prepare_rocketpool_stake({ amount })` produces unsigned `RocketDepositPool.deposit` call         | ✓ VERIFIED | `src/tools/prepare_rocketpool_stake.ts:129` registerTool; builds `tx.to = depositPool, tx.valueWei = amountWei, tx.data = "0xd0e30db0"`; Fixture AA-RP literal `0x615683fb...` at `test/signing-fingerprint.test.ts:491`; 10 tests pass |
| 5   | `prepare_rocketpool_unstake({ rethAmount })` produces unsigned `rETH.burn(amount)` call           | ✓ VERIFIED | `src/tools/prepare_rocketpool_unstake.ts:128` registerTool, line 255 calls `encodeRocketPoolBurn(rethAmountWei)`; tx.to=rETH, tx.valueWei=0n; Fixture AB-RP literal `0xd1214423...` at `test/signing-fingerprint.test.ts:526`; 9 tests pass |
| 6   | EigenLayer + Rocket Pool contracts sourced from `src/config/contracts.ts`; dispatch allowlist extended | ✓ VERIFIED | `src/config/contracts.ts:505-506` (EigenLayer SM + DM), `:521` (rETH cross-SOT), `:649-655` (Rocket Pool SOT incl. settingsDeposit `0x227BE8dD...`); 3 KNOWN_SPENDERS rows at `:821, :826, :831`; `src/security/canonical-dispatch.ts:158-184` adds `eigenEntries + rocketEntries` arms; CANONICAL_DISPATCH_TARGETS[1].size === 38 asserted at `test/security-canonical-dispatch.test.ts:356, :451` |

**Score:** 6/6 ROADMAP success criteria verified.

### Required Artifacts

| Artifact                                       | Expected                                                          | Status     | Details                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `src/protocols/eigenlayer.ts`                  | 3 ABI fragments + 5 hardcoded selectors + `encodeDepositIntoStrategy` | ✓ VERIFIED | 9,275 bytes; 5 selector literals (0xe7a050aa / 0x7a7e0d92 / 0x7a8b2637 / 0x553ca5f8 / 0x5dd68579)     |
| `src/protocols/rocketpool.ts`                  | 3 ABI fragments + 2 selectors + 2 encoders                        | ✓ VERIFIED | 11,266 bytes; `ROCKETPOOL_SELECTORS.deposit=0xd0e30db0`, `.burn=0x42966c68`                          |
| `src/chains/eigenlayer.ts`                     | `readEthereumPositions` 3-pass fan-out                            | ✓ VERIFIED | 11,469 bytes; `_eigenLayerChains` spy-affordance                                                     |
| `src/chains/rocketpool.ts`                     | `readEthereumPositions` Promise.all of balanceOf + getExchangeRate | ✓ VERIFIED | 4,568 bytes; `_rocketPoolChains` spy-affordance                                                      |
| `src/signing/eigenlayer-shares.ts`             | `SHARES_SCALE` + `convertSharesToUnderlying` with `approx:true`   | ✓ VERIFIED | 5,360 bytes                                                                                          |
| `src/signing/rocketpool-rate.ts`               | `RETH_SCALE` + `computeEthEquivalent` (no approx)                 | ✓ VERIFIED | 4,199 bytes                                                                                          |
| `src/tools/get_eigenlayer_positions.ts`        | MCP tool registration                                             | ✓ VERIFIED | 7,782 bytes; `registerTool("get_eigenlayer_positions", ...)`                                         |
| `src/tools/prepare_eigenlayer_deposit.ts`      | MCP tool + LEDGER NOTICE + D-05/D-06/D-10                         | ✓ VERIFIED | 18,851 bytes; imports `LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE`                                    |
| `src/tools/get_rocketpool_positions.ts`        | MCP tool                                                          | ✓ VERIFIED | 6,720 bytes                                                                                          |
| `src/tools/prepare_rocketpool_stake.ts`        | MCP tool + D-07 + LEDGER NOTICE                                   | ✓ VERIFIED | 13,386 bytes; uses `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE` (SHARED)                                      |
| `src/tools/prepare_rocketpool_unstake.ts`      | MCP tool + D-08 + LEDGER NOTICE                                   | ✓ VERIFIED | 14,034 bytes; uses `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE` (SHARED)                                      |
| `src/tools/register-all.ts`                    | 5 new tool imports (EIG-01/EIG-02/RP-01/RP-02-stake/RP-02-unstake) | ✓ VERIFIED | Lines 97-101 all 5 imports present                                                                   |
| `src/tools/preview_send.ts`                    | (to, selector) tuple-dispatch for Pitfall 1 + Pitfall 2 + EigenLayer | ✓ VERIFIED | Lines 93-100 imports; line 720 EigenLayer arm; line 741 `ROCKETPOOL_SELECTORS.deposit` arm (Pitfall 1); line 762 `ROCKETPOOL_SELECTORS.burn` arm (Pitfall 2); both gated by `record.tx.to === SOT-getter(...)` |
| `src/signing/blocks.ts`                        | EigenLayer + Rocket Pool templates appended (+120 + +158 lines)   | ✓ VERIFIED | 5 references to LEDGER_NOTICE_* templates                                                            |
| `src/config/contracts.ts`                      | EigenLayer + Rocket Pool SOT + 3 KNOWN_SPENDERS rows              | ✓ VERIFIED | 11 SOT exports counted; 3 verbatim labels at lines 821/826/831                                       |
| `src/security/canonical-dispatch.ts`           | `eigenEntries` + `rocketEntries` + Set spread                     | ✓ VERIFIED | Lines 158-184: declarations + Set spread `...eigenEntries, ...rocketEntries`                         |
| `test/signing-fingerprint.test.ts`             | Fixture Z + AA-RP + AB-RP hardcoded literals (NO beforeAll)       | ✓ VERIFIED | Literals at lines 452, 491, 526; no `beforeAll` snapshot — only doc comments invoking the rule       |
| `SECURITY.md`                                  | v2.3 milestone close-out section with 6 subsections + real PR numbers | ✓ VERIFIED | Section at line 487; subsections at 491, 498, 505, 512, 524; real PR numbers cited (#82/#86/#90/#94/#95; #118/#135; #137/#141; "(this PR)" for 31) — NO `#<TBD>` placeholders |

### Key Link Verification

| From                                             | To                                                                  | Via                                                              | Status   | Details                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `src/tools/prepare_eigenlayer_deposit.ts`        | `src/protocols/eigenlayer.ts (encodeDepositIntoStrategy)`           | named import + tx.data assignment                                | ✓ WIRED  | Line 52 `encodeDepositIntoStrategy` import; uses StrategyManager getter line 54                     |
| `src/tools/prepare_rocketpool_stake.ts`          | `src/protocols/rocketpool.ts (encodeRocketPoolDeposit)`             | named import + tx.data = "0xd0e30db0"                            | ✓ WIRED  | Comment line 26 documents semantics; tx assembly in handler                                         |
| `src/tools/prepare_rocketpool_unstake.ts`        | `src/protocols/rocketpool.ts (encodeRocketPoolBurn)`                | named import + tx.data = encodeRocketPoolBurn(rethAmountWei)     | ✓ WIRED  | Line 55 import; line 255 call                                                                       |
| `src/tools/preview_send.ts`                      | `getRocketPoolDepositPoolAddress(1) + ROCKETPOOL_SELECTORS.deposit` | tuple-dispatch on (to, selector)                                 | ✓ WIRED  | Lines 741-762 — Pitfall 1 + Pitfall 2 mitigations live                                              |
| `src/tools/preview_send.ts`                      | `getEigenLayerStrategyManagerAddress(1) + EIGENLAYER_SELECTORS.depositIntoStrategy` | tuple-dispatch                                                   | ✓ WIRED  | Line 720 — EigenLayer arm                                                                            |
| `test/signing-fingerprint.test.ts (Fixture Z)`   | `payload-fingerprint.ts → computePayloadFingerprint`                | hardcoded `0x2c36a77f...658684` literal                          | ✓ WIRED  | Line 452 `expect(fp).toBe(...)` — drift fails at THIS line                                          |
| `test/signing-fingerprint.test.ts (Fixture AA-RP)` | `payload-fingerprint.ts`                                          | hardcoded `0x615683fb...0ca3` literal                            | ✓ WIRED  | Line 491                                                                                            |
| `test/signing-fingerprint.test.ts (Fixture AB-RP)` | `payload-fingerprint.ts`                                          | hardcoded `0xd1214423...4edc` literal                            | ✓ WIRED  | Line 526                                                                                            |
| `KNOWN_SPENDERS_ETHEREUM rows`                   | EigenLayer + Rocket Pool SOT getters                                | `address: getEigenLayerStrategyManagerAddress(1)!` etc.          | ✓ WIRED  | Cross-view byte-identity (T-EIGENLAYER-SPENDER-DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1a/b) by construction |
| EIGENLAYER_RAW[1].lstTokens.stETH                | LIDO_RAW[1].steth                                                   | Both literals = `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`     | ✓ WIRED  | Cross-SOT byte-identity anchored in test                                                            |
| EIGENLAYER_RAW[1].lstTokens.rETH                 | ROCKETPOOL_RAW[1].reth                                              | Both literals = `0xae78736Cd615f374D3085123A210448E74Fc6393`     | ✓ WIRED  | Cross-SOT byte-identity anchored in test                                                            |

### Data-Flow Trace (Level 4)

| Artifact                                       | Data Variable                | Source                                                              | Produces Real Data | Status |
| ---------------------------------------------- | ---------------------------- | ------------------------------------------------------------------- | ------------------ | ------ |
| `get_eigenlayer_positions`                     | `deposits`, `pendingWithdrawals`, `totalEthEquivalent` | `_eigenLayerChains.readEthereumPositions` — 3-pass viem `client.readContract` fan-out across StrategyManager + each strategy + DelegationManager | Yes | ✓ FLOWING |
| `get_rocketpool_positions`                     | `rethBalance`, `exchangeRate`, `ethEquivalent` | `_rocketPoolChains.readEthereumPositions` — `Promise.all([rETH.balanceOf, rETH.getExchangeRate])` via viem | Yes | ✓ FLOWING |
| `prepare_eigenlayer_deposit`                   | `tx.data`                    | `encodeDepositIntoStrategy(strategy, lstToken, amountWei)` resolved via SOT getters | Yes | ✓ FLOWING |
| `prepare_eigenlayer_deposit` (D-05 pre-flight) | `allowance`                  | `client.readContract({address: lstTokenAddr, function: allowance, args: [from, StrategyManager]})` | Yes | ✓ FLOWING |
| `prepare_eigenlayer_deposit` (D-06 pre-flight) | `currentTotalShares`, `maxTotalDeposits` | `Promise.all([Strategy.totalShares, Strategy.maxTotalDeposits.catch(() => MAX_UINT256)])` | Yes | ✓ FLOWING |
| `prepare_rocketpool_stake` (D-07 pre-flight)   | `minimumDeposit`             | `client.readContract({...getMinimumDeposit}).catch(() => ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI)` | Yes | ✓ FLOWING |
| `prepare_rocketpool_unstake` (D-08 pre-flight) | `poolBalance`, `ethEquivalent` | `Promise.all([RocketDepositPool.getBalance, rETH.getEthValue(rethAmount)])` | Yes | ✓ FLOWING |

All read paths fan out through viem `client.readContract` to live RPC; no static returns; no hardcoded empty fallback to render.

### Behavioral Spot-Checks

| Behavior                              | Command                                                         | Result                                       | Status   |
| ------------------------------------- | --------------------------------------------------------------- | -------------------------------------------- | -------- |
| TypeScript strict compile             | `npx tsc --noEmit`                                              | exit 0, no output                            | ✓ PASS   |
| Full vitest suite                     | `npx vitest run`                                                | 287 files, 3683 passed, 1 skipped, exit 0    | ✓ PASS   |
| Phase 31 focused test files (7)       | `npx vitest run test/(config-contracts|protocols-eigenlayer|protocols-rocketpool|signing-fingerprint|preview-send.rocketpool|integration-eigenlayer-rocketpool|security-canonical-dispatch).test.ts` | 7 files, 239 tests passed                    | ✓ PASS   |
| FROZEN regions zero-diff vs origin/main | `git diff --stat origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts` | empty output                                 | ✓ PASS   |

### Probe Execution

No declared `scripts/*/tests/probe-*.sh` probes in this phase. Per project convention, Phase 31 uses `npx vitest run` + `npx tsc --noEmit` as the canonical regression surface, executed above under Behavioral Spot-Checks. Probe execution: N/A.

### Requirements Coverage

| Requirement | Source Plan      | Description                                                                                                   | Status     | Evidence                                                                              |
| ----------- | ---------------- | ------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| EIG-01      | Plan 31-02       | `get_eigenlayer_positions({ wallet })` returns EigenLayer strategy-level deposits (per LST or native restaking) | ✓ SATISFIED | `src/tools/get_eigenlayer_positions.ts` + `src/chains/eigenlayer.ts` 3-pass fan-out  |
| EIG-02      | Plan 31-02       | `prepare_eigenlayer_deposit({ strategy, lst, amount })` → `StrategyManager.depositIntoStrategy`; Ethereum-only | ✓ SATISFIED | `src/tools/prepare_eigenlayer_deposit.ts` + Fixture Z + D-13 LEDGER NOTICE             |
| RP-01       | Plan 31-03       | `get_rocketpool_positions({ wallet })` returns rETH balance + accrued value                                    | ✓ SATISFIED | `src/tools/get_rocketpool_positions.ts` + `src/chains/rocketpool.ts`                  |
| RP-02       | Plan 31-03       | `prepare_rocketpool_stake({ amount })` + `prepare_rocketpool_unstake({ rethAmount })` → `RocketDepositPool.deposit` + `rETH.burn`; Ethereum-only | ✓ SATISFIED | Both prepare tools wired with D-07/D-08 pre-flights + shared D-13 LEDGER NOTICE; Fixtures AA-RP + AB-RP |

No orphaned REQ-IDs. REQUIREMENTS.md line 496 lists "EIG-01/02, RP-01/02 → Phase 31 (v2.3) → Pending" — Phase 31 plans claim all 4; all 4 satisfied; the "Pending" line is the REQUIREMENTS.md tracking row that downstream automation flips on milestone close.

### CONTEXT.md Decisions (D-01 through D-15)

| Decision | Description                                                                | Status     | Evidence                                                                                                                                                                |
| -------- | -------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01     | Per-chain `EigenLayerContracts` + `RocketPoolContracts` SOT shape          | ✓ HONORED  | `src/config/contracts.ts` — interface + Partial<Record<ChainId, ...>> shape mirrors Lido + Morpho analogs                                                              |
| D-02     | Separate `src/protocols/eigenlayer.ts` + `src/protocols/rocketpool.ts`     | ✓ HONORED  | Both files created (9,275 + 11,266 bytes); independent ABI sets                                                                                                        |
| D-03     | Ethereum-write-only enforcement via `CHAIN_ID_MISMATCH` errorCode 15       | ✓ HONORED  | All 3 prepare tools have `chain: ["ethereum"]` JSON-schema enum + defensive runtime gate; tests assert errorCode 15 on non-Ethereum                                    |
| D-04     | Curated 7-LST registry (stETH/rETH/cbETH/ETHx/wBETH/sfrxETH/mETH)         | ✓ HONORED  | `type EigenLayerLst` literal-union committed in `src/config/contracts.ts` Plan 31-01; `getAllEigenLayerStrategiesForChain(1).length === 7` asserted in test            |
| D-05     | LST-allowance pre-flight with StrategyManager spender                      | ✓ HONORED  | `prepare_eigenlayer_deposit` D-05 arm; spender = StrategyManager (NOT per-strategy proxy) asserted in T5a                                                              |
| D-06     | Cap pre-flight with MAX_UINT256 sentinel BEFORE arithmetic                 | ✓ HONORED  | `prepare_eigenlayer_deposit.ts` — `MAX_UINT256` referenced 9 times; sentinel-skip + at-cap-refusal + revert-fallback arms all tested (T6 + T7 + T9)                    |
| D-07     | Minimum-deposit pre-flight + `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI`    | ✓ HONORED  | `prepare_rocketpool_stake.ts` — live `getMinimumDeposit()` read + fallback constant `10_000_000_000_000_000n`; CHECKS PERFORMED labels source                          |
| D-08     | Deposit-pool-liquidity pre-flight with verbatim DEX-swap hint              | ✓ HONORED  | `prepare_rocketpool_unstake.ts` — `Promise.all([getBalance, getEthValue])`; verbatim error "Swap rETH on a DEX (Uniswap V3, Curve)…"                                   |
| D-09     | No NFT receipt — standard PREPARE RECEIPT layout                           | ✓ HONORED  | Neither EigenLayer nor Rocket Pool tool emits an NFT_RECEIPT block; all 3 tools use standard 3-block layout                                                            |
| D-10     | EigenLayer slashing-risk informational line in CHECKS PERFORMED            | ✓ HONORED  | Verbatim line ("EigenLayer restaking: deposited LST shares are subject to slashing…") in `prepare_eigenlayer_deposit.ts`; asserted in test                              |
| D-11     | `deposits + pendingWithdrawals + approx:true` for EigenLayer; rETH read shape for Rocket Pool | ✓ HONORED  | `get_eigenlayer_positions` always returns `approx: true`; `get_rocketpool_positions` returns `{rethBalance, exchangeRate, ethEquivalent}` per spec                    |
| D-12     | Canonical-dispatch Ethereum arm extended with StrategyManager + 7 strategies + RocketDepositPool + rETH | ✓ HONORED  | `src/security/canonical-dispatch.ts:158-184` `eigenEntries + rocketEntries`; CANONICAL_DISPATCH_TARGETS[1].size = 38 (was 29; net +9 with BRIDGED_VARIANTS rETH dedup as documented in 31-01 SUMMARY) |
| D-12a    | 3 KNOWN_SPENDERS_ETHEREUM additive rows; SOT cross-view byte-identity      | ✓ HONORED  | Rows at `src/config/contracts.ts:821, :826, :831`; cross-view byte-identity asserted by T-EIGENLAYER-SPENDER-DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1a/b                  |
| D-13     | LEDGER NOTICE templates for EigenLayer deposit + Rocket Pool stake + Rocket Pool unstake | ✓ HONORED  | `LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE` (3 referenced in `prepare_eigenlayer_deposit.ts`); `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE` SHARED between stake + unstake (4 refs each tool) |
| D-14     | Fixture Z + AA + AB hardcoded payloadFingerprint literals (NO beforeAll-snapshot) | ✓ HONORED (with documented disambiguation) | Fixture Z literal + AA-RP literal + AB-RP literal at `test/signing-fingerprint.test.ts:452, 491, 526`. Suffix `-RP` resolves name collision with pre-existing Phase 26 BTC LiFi Fixture AA (documented in 31-03 SUMMARY deviation #2) |
| D-15     | SECURITY.md §6 v2.3 milestone close-out summary section                    | ✓ HONORED  | `SECURITY.md:487` "## EVM lending + staking v2.3 milestone close-out summary"; 6 subsections at 491, 498, 505, 512, 524; real PR numbers (#82/#86/#90/#94/#95; #118/#135; #137/#141; (this PR)) — NO `#<TBD>` |

### Critical Regression Coverage

| Item                                                                       | Status    | Evidence                                                                                                                                          |
| -------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-13 LEDGER NOTICE for all 3 write tools                                   | ✓ PASS    | EigenLayer: 3 refs in `prepare_eigenlayer_deposit.ts`; Rocket Pool stake: 4 refs; Rocket Pool unstake: 4 refs (SHARED `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE`) |
| Pitfall 1 (0xd0e30db0 WETH9.deposit ↔ RocketDepositPool.deposit) tuple-dispatch | ✓ PASS    | `src/tools/preview_send.ts:741-761` `ROCKETPOOL_SELECTORS.deposit` arm gated by `record.tx.to === depositPoolAddr`; verified at `test/preview-send.rocketpool.test.ts` T1 + T2 |
| Pitfall 2 (0x42966c68 generic ERC-20 burn ↔ rETH.burn) tuple-dispatch       | ✓ PASS    | `src/tools/preview_send.ts:762-779` `ROCKETPOOL_SELECTORS.burn` arm gated by `record.tx.to === rethAddr`; verified at `test/preview-send.rocketpool.test.ts` T3 + T4 |
| D-12a KNOWN_SPENDERS_ETHEREUM 3 additive rows                              | ✓ PASS    | `src/config/contracts.ts:821 "EigenLayer StrategyManager"`, `:826 "Rocket Pool RocketDepositPool (stake — value-bearing)"`, `:831 "Rocket Pool rETH token (burn target)"`; all addresses delegate to SOT getters |
| D-15 v2.3 SECURITY.md close-out with real PR numbers (NOT `#<TBD>`)        | ✓ PASS    | `SECURITY.md:493-496` cites #82/#86/#90/#94/#95 (P28), #118/#135 (P29), #137/#141 (P30), "(this PR)" (P31) — no `<TBD>` placeholders             |
| Fixtures Z + AA-RP + AB-RP hardcoded literals (NO beforeAll-snapshot)      | ✓ PASS    | Literals at `test/signing-fingerprint.test.ts:452, 491, 526`; only beforeAll mentions are documentation comments invoking CLAUDE.md "NO beforeAll" rule |
| T-EIGENLAYER-SPENDER-DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1 cross-view tests | ✓ PASS    | `test/config-contracts.test.ts` describe blocks pass (120 tests in file; full file green)                                                          |
| FROZEN regions zero-diff vs origin/main                                    | ✓ PASS    | `git diff --stat origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts` returns empty |
| 5 new MCP tools registered in `src/tools/register-all.ts`                  | ✓ PASS    | Lines 97-101: get_eigenlayer_positions / prepare_eigenlayer_deposit / get_rocketpool_positions / prepare_rocketpool_stake / prepare_rocketpool_unstake |
| Full test suite: `npm test` → 287 files / 3683 tests green                 | ✓ PASS    | `npx vitest run` → "Test Files 287 passed (287); Tests 3683 passed | 1 skipped (3684)"                                                          |
| `npx tsc --noEmit` clean                                                   | ✓ PASS    | Exit 0; no output                                                                                                                                  |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| —    | —    | —       | —        | No unreferenced TBD/FIXME/XXX debt markers detected across any Phase 31 src file. Stale `dist/security/canonical-dispatch.js` build artifact predates Phase 31 source — informational only (not consumed by tests; vitest transforms TypeScript directly). |

### Human Verification Required

See `human_verification` in YAML frontmatter — 6 bundled real-Ledger USB-HID smoke items spanning Phases 28 / 29 / 30 / 31 per the 2026-05-16 directive. All code-side regression coverage is green; the remaining trust anchor is the on-device hash match (blind-sign) or decoded-args match (clear-sign), which only a human with the physical Ledger device + Ethereum app can verify.

The v2.3 milestone close-out summary in `SECURITY.md:514` explicitly names this as the open milestone-completion gate: "v2.3 verify-phase pending real-Ledger Ethereum-app smoke against mainnet — all four protocols (Compound V3 supply/withdraw/borrow/repay; Morpho Blue six writes; Lido four writes; EigenLayer stETH deposit; Rocket Pool stake + burn) require a small-amount mainnet broadcast against a physical Ledger device with the Ethereum app running."

### Gaps Summary

No gaps. Phase 31 goal is achieved code-side:

- All 6 ROADMAP success criteria observably TRUE in the codebase.
- All 4 REQ-IDs (EIG-01, EIG-02, RP-01, RP-02) satisfied with concrete tool + test coverage.
- All 15 CONTEXT.md decisions (D-01 through D-15) honored, with one documented deviation (D-14 `-RP` suffix) explained in 31-03 SUMMARY.
- Critical regression coverage all PASS: D-13 LEDGER NOTICE, Pitfall 1+2 tuple dispatch, KNOWN_SPENDERS additive rows, D-15 SECURITY.md v2.3 close-out with real PR numbers, fixtures Z/AA-RP/AB-RP hardcoded literals, FROZEN zero-diff, 5 new tools registered, 287 files / 3683 tests green, tsc clean.
- Documented allowlist-size deviation: net +9 (not +10) due to rETH BRIDGED_VARIANTS de-dup — benign per 31-01 SUMMARY (same shape as Phase 30 wstETH precedent); cross-view byte-identity preserved.
- Documented Fixture name deviation: `Fixture AA-RP` / `Fixture AB-RP` suffixes avoid collision with pre-existing BTC LiFi Fixture AA (Phase 26 Plan 26-03); literals + cross-link semantics unchanged.

The phase is code-complete. The remaining work is the bundled v2.3 verify-phase real-Ledger smoke across Phases 28/29/30/31 (in `human_verification` above).

---

_Verified: 2026-05-23T13:30:00Z_
_Verifier: Claude (gsd-verifier, Opus 4.7 1M)_
