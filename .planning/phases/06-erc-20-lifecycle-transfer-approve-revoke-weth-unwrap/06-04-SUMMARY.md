---
phase: 06
plan: 04
subsystem: tools/weth9
tags: [weth9, unwrap, withdraw, ledger-blind-sign, sot-migration, integration-test, phase-6-closer]
requires: [06-01, 06-02, 06-03]
provides:
  - src/protocols/weth9.ts (WETH9 ABI fragment + WETH9_SELECTORS + WETH9_DECIMALS + encodeWethWithdraw + getWethContractAddress)
  - src/tools/prepare_weth_unwrap.ts (PREP-28 — { amount }-only schema; tx.to from SOT)
  - DECODED_ARGS_TEMPLATE_WITHDRAW + LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE + WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE in src/signing/blocks.ts
  - withdraw branch in buildDecodedArgsBlock with formatUnits(amount, 18) + "(WETH9 — canonical)" label
  - LEDGER NOTICE block insertion in preview_send for the withdraw selector (research § Topic 5 A2 mitigation)
  - structuredContent.ledgerNotice tag in preview_send (forward-looking for get_tx_verification re-emit)
  - Fixture F payloadFingerprint anchor (0x81a70e4a703de01b67ad1aaff7d97be8dde3ae6703a652a462f7de9e30e36596) — WETH9.withdraw(1e18)
  - test/erc20-lifecycle.integration.test.ts (full pipeline + from-independence regression across personas for Fixtures D/E/F)
affects:
  - src/tools/get_portfolio_summary.ts (line 17 SOT migration — inline WETH literal → getWethAddress(1); closes CONFIG-LITERAL-MIGRATION-1)
  - src/tools/register-all.ts (+1 import line)
  - src/signing/blocks.ts (replaces Plan 06-02's withdraw TODO stub)
tech-stack:
  added: []
  patterns:
    - "Tool with NO contract-address input — server reads SOT directly (T-WETH-ADDR-INLINE-1 defense: agent boundary cannot redirect to a malicious clone contract)"
    - "WETH9 ABI via parseAbi (research § Topic 2 — viem does not export weth9Abi)"
    - "Hard-coded constant decimals over registry/RPC lookup (WETH9_DECIMALS = 18 — canonical contract is immutable on mainnet)"
    - "Two-pronged LEDGER NOTICE condition (selector === withdraw AND tx.to === canonical WETH9) — defense against unrelated contracts that happen to expose a withdraw(uint256) selector"
    - "Non-cryptographic UX defense (LEDGER NOTICE prose) above the cryptographic anchor (LEDGER BLIND-SIGN HASH) — actionable prerequisites precede artifacts to verify"
    - "Persona-cycle from-independence integration test (T-INTEGRATION-FROM-DRIFT-1 STOP-THE-LINE assertion)"
key-files:
  created:
    - src/protocols/weth9.ts
    - src/tools/prepare_weth_unwrap.ts
    - test/protocols-weth9.test.ts
    - test/prepare-weth-unwrap.test.ts
    - test/erc20-lifecycle.integration.test.ts
  modified:
    - src/signing/blocks.ts
    - src/tools/preview_send.ts
    - src/tools/get_portfolio_summary.ts
    - src/tools/register-all.ts
    - test/preview-send.erc20.test.ts
    - test/signing-fingerprint.test.ts
decisions:
  - "WETH9_WITHDRAW_ABI includes BOTH withdraw + deposit fragments — forward-compat for a future prepare_weth_wrap (v2+); avoids evolving this const when wrap lands. Only withdraw is used in v1.x."
  - "WETH9_DECIMALS lives in src/protocols/weth9.ts (not pulled from the top-50 registry at call time) — saves one registry lookup on the hot path and decouples prepare_weth_unwrap from registry availability. Registry has the row too; both sources are constant 18."
  - "prepare_weth_unwrap has NO tokenAddress input parameter — server reads tx.to from getWethAddress(1) directly. Agent tampering at the boundary cannot redirect the call to a malicious clone contract. The receipt still surfaces tokenAddress so the user can cross-check the address on-device."
  - "amount: 'max' rejected (no max-balance sentinel). Unlike approve where 'max' means MAX_UINT256, withdraw has no analogous semantic — the user must pass a concrete decimal. parseAmountStrict's regex rejects 'max' with kind: format, surfacing as INVALID_INPUT."
  - "WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE is distinct from the existing transfer/approve receipt templates — withdraw has no recipient (no 'to:' slot) and no spender (no 'spender:' slot). Format-fanout-sentinel: one block, one shape, one home."
  - "LEDGER NOTICE block emits ABOVE the LEDGER BLIND-SIGN HASH block (top-of-response) — actionable prerequisites (enable blind-sign in settings) precede artifacts to verify (the device hash match). The block re-anchors the hash match in its closing line so trust-boundary clarity is preserved."
  - "structuredContent.ledgerNotice is a canonical tag string ('weth-unwrap-blind-sign') or null — NOT the prose. Forward-looking: Plan 04-05's get_tx_verification re-emit will need to pick up this branch in Phase 9; the tag lets it reproduce the block shape without parsing the prose."
  - "buildDecodedArgsBlock's withdraw branch ignores tokenContext — WETH9_DECIMALS is a constant. The function signature stays widened (tokenContext: { symbol; decimals } | null) for transfer/approve paths; withdraw passes null at the call site."
  - "Persona-cycle integration test uses 3 personas (whale + stable-saver + defi-degen) — three is sufficient to prove from-independence; staking-maxi would only add redundancy. The four prepare_* tools all walk the cycle."
metrics:
  duration: "~45 min"
  completed: "2026-05-13"
  tasks_completed: 1
  tasks_total: 1
  tests_before: 440
  tests_after: 474
  tests_added: 34
---

# Phase 6 Plan 04: prepare_weth_unwrap + WETH9 protocol primitives + LEDGER NOTICE block + canonical WETH SOT migration + ERC-20 lifecycle integration test — Summary

`prepare_weth_unwrap` (PREP-28) ships the third contract-call shape over the Phase 4 trust pipeline — WETH9.withdraw against the canonical SOT-resolved contract address, with NO agent-supplied contract slot. The LEDGER NOTICE block (research § Topic 5 A2 mitigation) defends the most-likely UX failure mode by surfacing the exact Ledger UI navigation path BEFORE the user attempts to blind-sign. The full ERC-20 lifecycle integration test re-anchors Fixtures D/E/F byte-identical across persona swaps, extending the Phase 5 `from`-independence regression to the entire ERC-20 surface. The `src/tools/get_portfolio_summary.ts:17` inline WETH literal migrates to `getWethAddress(1)`, closing Plan 06-03's `CONFIG-LITERAL-MIGRATION-1` residual and leaving `src/config/contracts.ts` as the sole holder of the address literal in `.ts` source files.

## What shipped

**Source files (2 NEW + 4 MODIFY):**

- **`src/protocols/weth9.ts`** (NEW, second occupant of `src/protocols/`):
  - `WETH9_WITHDRAW_ABI` via `parseAbi(["function withdraw(uint256 amount)", "function deposit() payable"])` — viem does not export a `weth9Abi` const (research § Topic 2). Both fragments included for forward-compat with a v2+ `prepare_weth_wrap`; only `withdraw` is consumed in v1.x.
  - `WETH9_SELECTORS.withdraw = "0x2e1a7d4d"` — universal selector; format-fanout-sentinel for cross-module dispatch.
  - `WETH9_DECIMALS = 18` — hard-coded constant (the contract is immutable on mainnet); saves one registry/RPC lookup on the hot path.
  - `encodeWethWithdraw(amount: bigint): Hex` — canonical viem-encoded 36-byte calldata (selector + 32-byte amount). Byte-identity asserted against Fixture F.
  - `getWethContractAddress(chainId): Address` — convenience re-export delegating to `getWethAddress` in `src/config/contracts.ts` (SOT remains there).
- **`src/tools/prepare_weth_unwrap.ts`** (NEW): mechanical clone of `prepare_token_send.ts` with bounded deviations:
  - Input schema is `{ amount }` ONLY — no `to`, no `tokenAddress`. The server reads `tx.to` from `getWethAddress(1)` directly.
  - Decimal resolution: hard-coded to `WETH9_DECIMALS=18` (no registry / on-chain `decimals()` call).
  - Encoder is `encodeWethWithdraw(amountWei)`.
  - `tx.valueWei = 0n`. Withdraw burns WETH for ETH at the contract level; no native value is moved IN the call.
  - PREPARE RECEIPT uses `WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE` (two slots: `tokenAddress` + `amount` — no `to`, no `spender`).
  - `amount: "max"` rejected via `parseAmountStrict`'s regex (no max-balance sentinel for unwrap).
- **`src/signing/blocks.ts`** (MODIFY):
  - Adds `DECODED_ARGS_TEMPLATE_WITHDRAW` + `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` + `WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE` const exports.
  - Replaces Plan 06-02's withdraw TODO stub in `buildDecodedArgsBlock`: surfaces `function: withdraw`, `token: <recordTxTo> (WETH9 — canonical)`, `amount: <formatUnits(amount, 18)> WETH`, `amountWei: <bigint>`. Imports `WETH9_DECIMALS` directly so no registry/`tokenContext` dependency exists for this branch.
- **`src/tools/preview_send.ts`** (MODIFY):
  - Imports `WETH9_SELECTORS` + `getWethAddress` + `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE`.
  - Two-pronged condition: `selector === WETH9_SELECTORS.withdraw && record.tx.to === getWethAddress(1)`. Both must match — defense against unrelated contracts that happen to expose the same selector.
  - When the condition fires, the NOTICE block is emitted AT THE TOP of the text-array composition (before the LEDGER BLIND-SIGN HASH block).
  - `structuredContent.ledgerNotice` carries the canonical tag `"weth-unwrap-blind-sign"` when the block is emitted; `null` otherwise.
- **`src/tools/get_portfolio_summary.ts`** (MODIFY): line 17's `const WETH_ADDRESS: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"` migrates to `const WETH_ADDRESS: Address = getWethAddress(1)`. Byte-identical address value; consolidates the SOT. **Closes Plan 06-03's CONFIG-LITERAL-MIGRATION-1.**
- **`src/tools/register-all.ts`**: exactly +1 line — `import "./prepare_weth_unwrap.js";` (slotted between `prepare_revoke_approval.js` and `preview_send.js`).

**Test files (3 NEW + 2 EXTEND):**

- **`test/protocols-weth9.test.ts`** (NEW, 6 cases): selector + decimals + encode round-trip (Fixture F cross-link) + decode via combined ABI + SOT delegation.
- **`test/prepare-weth-unwrap.test.ts`** (NEW, 13 cases): pair-required real mode / demo persona happy path / demo null-persona WRONG_MODE / 3 INVALID_INPUT branches (format + fractional-overflow + "max" rejection) / zero-unwrap accepted / Fixture F fingerprint anchor / verbatim PREPARE RECEIPT / handle stored shape (T-WETH-ADDR-INLINE-1 cross-import) / register-all wiring smoke.
- **`test/preview-send.erc20.test.ts`** (EXTEND, +5 cases): DECODED ARGS withdraw surface; LEDGER NOTICE present-for-withdraw / absent-for-transfer / absent-for-approve / absent-for-native; insufficient-WETH revert simulation.
- **`test/signing-fingerprint.test.ts`** (EXTEND, +1 case): Fixture F hardcoded literal `0x81a70e4a703de01b67ad1aaff7d97be8dde3ae6703a652a462f7de9e30e36596` (computed at execute time, pinned forever).
- **`test/erc20-lifecycle.integration.test.ts`** (NEW, 8 cases): full pipeline in demo mode for each of the four ERC-20 ops (transfer + approve + revoke + WETH unwrap → preview → send simulation), each asserting `signClient.request` stays at 0 calls. Then a persona-cycle (`whale ↔ stable-saver ↔ defi-degen`) for Fixtures D/E/F + revoke — load-bearing `from`-independence regression (T-INTEGRATION-FROM-DRIFT-1).

## Fixture F (Plan 06-04 anchor)

```
payloadFingerprint = 0x81a70e4a703de01b67ad1aaff7d97be8dde3ae6703a652a462f7de9e30e36596
inputs:
  chainId  = 1
  to       = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2  (WETH9, canonical SOT)
  valueWei = 0n
  data     = 0x2e1a7d4d0000000000000000000000000000000000000000000000000de0b6b3a7640000
             (= WETH9.withdraw(1_000_000_000_000_000_000n))
```

Computed via `node -e` against `dist/signing/payload-fingerprint.js` at execute time; pinned in `test/signing-fingerprint.test.ts` + `test/prepare-weth-unwrap.test.ts` + `test/erc20-lifecycle.integration.test.ts` (also cross-referenced by `test/preview-send.erc20.test.ts` for the withdraw handle seed).

## LEDGER NOTICE block (verbatim)

```
LEDGER NOTICE
  WETH unwrap is NOT covered by the Ledger Ethereum app's ERC-20 clear-sign plugin.
  Your device will likely BLIND-SIGN this transaction (display a raw hash, no decoded args).
  If your device refuses with "Blind signing is not enabled":
    1. Open the Ethereum app on your device
    2. Settings → Blind signing → Enabled
    3. Retry send_transaction
  Match the LEDGER BLIND-SIGN HASH below CHARACTER-FOR-CHARACTER against
  the value your device displays — this is the cryptographic anchor.
```

The block re-anchors the trust boundary in its closing line — the NOTICE prose is UX defense (non-cryptographic), and the user's verification ritual remains the device hash match. **Wording is appropriate for the 2026-05 Ledger Ethereum app UI; can be refined at verify-phase if device labels have shifted upstream.**

## Threat-model mitigations satisfied

- **T-WETH-ADDR-INLINE-1**: `prepare_weth_unwrap.ts` has no `tokenAddress` input — agent boundary cannot redirect to a clone contract. Test 9 asserts `record.tx.to === getWethAddress(1)` cross-import (drift in the SOT also fails this assertion).
- **T-LEDGER-NOTICE-AGENT-DROP-1**: NOTICE block is part of `preview_send`'s server-side response (verbatim from `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE`); the agent's chat reply is out of scope per PROJECT.md trust boundary. Test in `preview-send.erc20.test.ts` asserts the NOTICE prose appears in the response text for the withdraw selector.
- **T-WETH-DECIMALS-DRIFT-1**: `WETH9_DECIMALS === 18` asserted byte-identical in `test/protocols-weth9.test.ts`.
- **T-INSUFFICIENT-WETH-NO-WARN-1**: `runPreviewSimulation` (Plan 06-02) catches the underflow at preview time; `test/preview-send.erc20.test.ts` Test 15 asserts SIMULATION shows `status: revert` while LEDGER + NOTICE blocks stay intact.
- **T-INTEGRATION-FROM-DRIFT-1**: `test/erc20-lifecycle.integration.test.ts` cycles three personas across the four ERC-20 calldata shapes — drift in the PREP-03 preimage assembly for ANY shape breaks one of these tests at PR-review time. STOP-THE-LINE invariant.

## Phase 6 closure

Plan 06-04 is the final wave of Phase 6. After this PR merges:
- Phase 6 is **code-complete**: PREP-20 + PREP-21 (06-02) + PREP-22 (06-01) + PREP-26 + PREP-27 + PREP-30 (06-03) + PREP-28 + PREP-29 (06-04) all green.
- `src/config/contracts.ts` SOT has both per-chain entries (Plan 06-03 + Plan 06-04 consolidation) and known-spender entries (11 seeded; Phase 7 extends with `aavePool`).
- The trust pipeline (Phase 4) now covers four contract-call shapes: native send + ERC-20 transfer + ERC-20 approve/revoke + WETH unwrap. Phase 7 (Aave V3 Pool) extends the same pattern to lending ops.

## Verification

- `npm run build`: clean
- `npm run typecheck`: clean
- `npm test`: **474 / 474** passing across 51 test files (was 440 / 440 at Wave 3; +34 tests / 3 new test files / 2 extensions).
- `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts`: empty (all four FROZEN areas zero-diff).
- `git diff origin/main -- src/tools/register-all.ts`: exactly 1 added line.
- `grep -rn "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" src/ --include="*.ts"`: only `src/config/contracts.ts` (lines 40 + 135 — the canonical-address row + the known-spender row, both via `getAddress` re-checksum).

## Deviations from plan

None. The plan's `<interfaces>` block matched the installed code + SDK exactly; the LEDGER NOTICE wording mirrors the plan text verbatim. No `Rule 1-4` deviations triggered.

## Self-Check: PASSED

Files: `src/protocols/weth9.ts`, `src/tools/prepare_weth_unwrap.ts`, `test/protocols-weth9.test.ts`, `test/prepare-weth-unwrap.test.ts`, `test/erc20-lifecycle.integration.test.ts` — all exist. Commit `88fdd03` recorded on `feat/06-04-prepare-weth-unwrap` branch.
