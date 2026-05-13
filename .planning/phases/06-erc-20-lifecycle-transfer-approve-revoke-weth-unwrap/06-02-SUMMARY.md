---
phase: 06
plan: 02
slug: prepare-token-send-and-preview-decode
status: complete
completed: 2026-05-13
requirements: [PREP-20, PREP-21]
tags: [erc-20, prepare-tool, preview-decode, simulation, df-1-locked]
dependency_graph:
  requires:
    - "src/signing/amount.ts::parseAmountStrict (Plan 06-01)"
    - "src/tokens/registry.ts::loadEthereumTokenRegistry (pre-Phase 6)"
    - "src/signing/payload-fingerprint.ts (Phase 4 — FROZEN)"
    - "src/signing/presign-hash.ts (Phase 4 — FROZEN)"
    - "src/signing/handle-store.ts (Phase 4 — PrepareArgs additively widened)"
    - "src/tools/send_transaction.ts (Phase 4 — FROZEN; three send-time gates)"
  provides:
    - "src/protocols/erc20.ts (first occupant of src/protocols/; consumed by 06-03 + 06-04)"
    - "src/signing/simulation.ts::runPreviewSimulation (DF-1 LOCKED; consumed by 06-03 + 06-04)"
    - "src/tools/prepare_token_send.ts (PREP-20)"
    - "src/signing/blocks.ts::buildDecodedArgsBlock + buildSimulationBlock (PREP-21)"
  affects:
    - "preview_send.ts now emits DECODED ARGS + SIMULATION for all tx shapes"
    - "Phase 4 native sends retroactively get preview-time simulation"
tech_stack:
  added: []  # No new runtime deps — all viem.
  patterns:
    - "ESM spy-affordance indirection: _protocols (src/protocols/erc20.ts) + _simulation (src/signing/simulation.ts)"
    - "Selector-routed decode via discriminated union (Erc20Decoded)"
    - "Combined-ABI decode (erc20Abi ∪ WETH9 withdraw fragment) — preview_send single dispatch path"
    - "Block-filter-and-join in preview_send composing 5 blocks (LEDGER / AGENT TASK / 4byte / DECODED ARGS / SIMULATION) — empty strings filtered for unknown-kind decoded args"
key_files:
  created:
    - "src/protocols/erc20.ts"
    - "src/signing/simulation.ts"
    - "src/tools/prepare_token_send.ts"
    - "test/protocols-erc20.test.ts"
    - "test/signing-simulation.test.ts"
    - "test/prepare-token-send.test.ts"
    - "test/preview-send.erc20.test.ts"
  modified:
    - "src/signing/blocks.ts (additive — new templates + builders)"
    - "src/signing/handle-store.ts (additive — PrepareArgs +3 optional fields)"
    - "src/tools/preview_send.ts (selector-routed decode + DECODED ARGS + SIMULATION blocks)"
    - "src/tools/register-all.ts (+1 import)"
    - "test/signing-fingerprint.test.ts (+Fixture D anchor)"
    - "test/demo-flow.integration.test.ts (call-count expectations — preview-time simulation)"
decisions:
  - "Fixture D = 0x52f396cfab6f8f4dfbf10b36734e7d22e944d54657a72dc2c8d67e91f8c49f85 (USDC transfer to 0x70997970..., amount 100 → 100_000_000n at decimals=6)"
  - "DF-1 LOCKED: src/signing/simulation.ts is the shared wide eth_call helper; native sends retroactively get preview-time simulation"
  - "Selector table SOT in src/protocols/erc20.ts (no inline slice(0,10) magic anywhere)"
  - "amount: 'max' rejected by prepare_token_send (transfer's domain); approve gets the unlimited sentinel in 06-03"
metrics:
  duration_minutes: 35
  tasks_completed: 1
  files_created: 7
  files_modified: 6
  test_count_before: 354
  test_count_after: 397
  test_count_delta: 43
---

# Phase 06 Plan 02 — prepare_token_send + preview_send decoded-arg + ERC-20 protocol primitives + wide eth_call simulation Summary

## One-liner

Ships the first contract-call shape over the Phase 4 trust pipeline — `prepare_token_send` (PREP-20) — plus the protocol-primitive `src/protocols/erc20.ts` (first occupant of `src/protocols/`), the DF-1 LOCKED wide eth_call simulation helper `src/signing/simulation.ts`, and the `preview_send` extension (PREP-21) that surfaces decoded `transfer(to, amount)` args in a new DECODED ARGS block and a uniform SIMULATION block emitted for every tx shape. Native sends retroactively benefit from preview-time simulation. The cryptographic-binding chain (`payload-fingerprint.ts`, `presign-hash.ts`, `send_transaction.ts` gates) is FROZEN — zero git-diff against `origin/main` confirmed.

## Files shipped

### New source files (3)

- **`src/protocols/erc20.ts`** — first occupant of `src/protocols/`. Exports `ERC20_SELECTORS` (transfer `0xa9059cbb`, approve `0x095ea7b3`), `MAX_UINT256` ((1n << 256n) − 1n) unlimited-approval sentinel, `ERC20_COMBINED_DECODE_ABI` (viem's `erc20Abi` ∪ a `parseAbi(["function withdraw(uint256)"])` fragment for Plan 06-04's WETH unwrap decode), `encodeErc20Transfer(to, amount)`, `encodeErc20Approve(spender, amount)`, the `Erc20Decoded` discriminated-union type, and `decodeErc20Call(data)`. The decode function catches viem's `AbiFunctionSignatureNotFoundError` and surfaces an `{ kind: "unknown" }` fallback so preview_send's existing 4byte block still fires for unrecognized selectors. `_protocols = { decodeErc20Call }` ships per the CLAUDE.md ESM spy-affordance indirection convention.

- **`src/signing/simulation.ts`** — DF-1 LOCKED placement on the signing shelf. Exports `SimulationStatus = "ok" | "revert" | "error"`, `SimulationResult`, and `runPreviewSimulation({ client, sender, tx })`. The helper wraps `viem/actions.call` in try/catch — NEVER throws. Revert detection via case-insensitive regex `/revert|execution reverted/i` against the error message; non-revert errors classified as `status: "error"`. T-SIMULATION-RPC-FAIL-1 mitigation: the function is structurally non-blocking — preview_send emits the LEDGER + AGENT TASK + 4byte blocks regardless of RPC outcome. `_simulation = { runPreviewSimulation }` ESM indirection for tests.

- **`src/tools/prepare_token_send.ts`** — MCP tool, registers `prepare_token_send`. Mechanical clone of `prepare_native_send.ts` with bounded diffs: (a) input schema `{ to, tokenAddress, amount }` (no `valueWei`), (b) calldata via `encodeErc20Transfer(getAddress(to), amountWei)`, (c) `tx.to = getAddress(tokenAddress)` — THE TOKEN CONTRACT, NOT the recipient (T-TX-TO-CONFUSION-1 mitigation), (d) `tx.valueWei = 0n`, (e) PREPARE RECEIPT via `ERC20_PREPARE_RECEIPT_TEMPLATE`, (f) decimal resolution registry-cache-first via `loadEthereumTokenRegistry` then live RPC `readContract({ functionName: "decimals" | "symbol" })` on miss, (g) `parseAmountStrict(rawAmount, decimals)` with `InvalidAmountError → INVALID_INPUT` envelope. Demo-mode persona-as-from arm mirrors Plan 05-02 Option B byte-for-byte. Tool description follows CLAUDE.md "tool descriptions are agent routing prompts" — names `tokenAddress` (not a wallet address) + decimal-string `amount` (not wei) explicitly.

### Modified source files (4, additive only)

- **`src/signing/blocks.ts`** — appended: `ERC20_PREPARE_RECEIPT_TEMPLATE` (parallel template per 06-PATTERNS.md line 97; tokenAddress/to/amount slots), `DECODED_ARGS_TEMPLATE_TRANSFER` (function/token/recipient/amount-human/amount-wei slots), `buildDecodedArgsBlock(decoded, tokenContext)` (transfer branch renders `formatUnits` against registry decimals; off-list tokens get raw bigint + "(decimals unknown — call get_token_metadata)" note; approve + withdraw branches are stubs that Plans 06-03 / 06-04 replace; unknown branch returns empty string so preview_send filters it from the join), `buildSimulationBlock(result)` (status + result/revert/error + trust-boundary note prose). Phase 4 templates (PREPARE_RECEIPT_TEMPLATE, LEDGER_BLIND_SIGN_HASH_TEMPLATE, AGENT_TASK_TEMPLATE, VERIFY_BEFORE_SIGNING_TEMPLATE, build4byteBlock, chunkHex) byte-identical.

- **`src/signing/handle-store.ts`** — `PrepareArgs` widened by 3 optional fields: `tokenAddress?: string`, `amount?: string`, `spender?: string`. Type-only additive extension — no transitions / TTL / state-machine logic changed. JSDoc block grew to name Phase 6 as the introducer + reiterate the format-fanout-sentinel guard (every new field is `string`, NOT Address / NOT bigint, so the type system blocks normalization at the storage boundary).

- **`src/tools/preview_send.ts`** — selector-routed decode via `_protocols.decodeErc20Call(record.tx.data)`; registry-cache lookup against `record.tx.to` for `tokenContext` when decoded.kind is `transfer` or `approve`; `buildDecodedArgsBlock(decodedArgs, tokenContext)` rendered; `_simulation.runPreviewSimulation({ client, sender: senderAddress, tx: { to, valueWei, data } })` invoked; `buildSimulationBlock(simulationResult)` rendered. Block-filter-and-join composes the new ordering: LEDGER → AGENT TASK → 4byte → (DECODED ARGS, if non-empty) → SIMULATION → VERIFY BEFORE SIGNING. structuredContent gains `decodedArgs` (bigint serialized via .toString()) and `simulation` ({ status, resultData, errorMessage }) fields. The Phase 4 native-send shape — `selector === null`, empty DECODED ARGS block filtered out — keeps Fixture C `presignHash = 0xb28e4824...` byte-identical.

- **`src/tools/register-all.ts`** — +1 line: `import "./prepare_token_send.js";` placed adjacent to `prepare_native_send.js`.

### New test files (4) + modifications (2)

- **`test/protocols-erc20.test.ts`** — 13 cases: selector regression anchors (transfer + approve), MAX_UINT256 equality + hex form, `encodeErc20Transfer` round-trip cross-linked to Fixture B's data literal (lowercased comparison; hexToBytes is case-insensitive), `encodeErc20Approve` selector starts with `0x095ea7b3`, `decodeErc20Call` discriminated-union coverage (transfer / approve unlimited / approve non-unlimited / withdraw via encoded calldata round-trip is implicit / unknown for `"0x"` / unknown for unrecognized selector + truncated data), and the combined ABI includes a `withdraw` entry for Plan 06-04.

- **`test/signing-simulation.test.ts`** — 7 cases: happy-path ok with verbatim resultData + call args (account/to/value/data), resultData `"0x"` fallback when `call` returns `{ data: undefined }`, revert detection via `execution reverted` + case-insensitive `Reverted with reason: …`, non-revert RPC error classification (`network timeout`, non-Error string throw), and the NEVER-throws invariant via `.resolves.toMatchObject({ status: "error" })`.

- **`test/prepare-token-send.test.ts`** — 14 cases: pair-required real-mode → WALLET_NOT_PAIRED + createHandle not called, demo-mode persona success (whale → from === WHALE_ADDRESS, amountWei === "100000000", payloadFingerprint === Fixture D), demo + null persona → WRONG_MODE, INVALID_INPUT branches (malformed to, malformed tokenAddress, scientific-notation `"100.5e6"`, fractional-overflow `"100.1234567"` against USDC decimals=6), `"max"` rejected at transfer (approve territory only), Fixture D fingerprint anchor in structuredContent, verbatim PREPARE RECEIPT (lowercase round-trip — `record.tx.to` checksummed but receipt text reads from `args` raw), handle-stored split args/tx shape with `tx.to === USDC_CHECKSUMMED` + `tx.valueWei === 0n` + `tx.data.startsWith("0xa9059cbb")` + `tx.data.length === 138` + args fields raw + payloadFingerprint binding to the args via tx shape, register-all wiring smoke + inputSchema.required + side-effect-import string presence.

- **`test/preview-send.erc20.test.ts`** — 8 cases: DECODED ARGS block contents (function/token/recipient/amount-human-with-symbol/amountWei), structuredContent.decodedArgs (kind transfer + bigint serialized as string + decoder-returned recipient in EIP-55), off-list token fallback (DECODED ARGS shows `(off-list token)` + `(decimals unknown — call get_token_metadata)` + raw bigint), SIMULATION block status ok with non-empty resultData, SIMULATION status revert NON-BLOCKING (preview_send returns 200, LEDGER + AGENT TASK + 4byte blocks present), SIMULATION status error NON-BLOCKING for non-revert RPC failure, native-send Phase-4 regression (data === `"0x"` → decodedArgs.kind === "unknown" → DECODED ARGS block filtered out; SIMULATION still emitted; presignHash === Fixture C `0xb28e4824...` byte-identical — load-bearing "didn't break native sends" assertion), call() invocation args cross-check (account = sender, to = record.tx.to, value/data verbatim).

- **`test/signing-fingerprint.test.ts`** — extended with Fixture D test. The literal `0x52f396cfab6f8f4dfbf10b36734e7d22e944d54657a72dc2c8d67e91f8c49f85` was computed once at execute-time via `node -e "import('./dist/signing/payload-fingerprint.js')..."` against the documented USDC transfer inputs (chainId=1, to=USDC contract, valueWei=0n, data=transfer(0x70997970..., 100_000_000n)), pinned forever.

- **`test/demo-flow.integration.test.ts`** — updated call-count expectations. Test 1+2+3 (full demo chain) now expects 2 viem.call invocations (preview-time simulation + send-time simulation; both with `account: WHALE_ADDRESS`). Test 4 (cancel path) now expects 1 viem.call invocation (the preview-time simulation that ran BEFORE the cancel branch fired in send_transaction). signClient.request still NEVER called in both flows.

## Test counts (before / after)

| Stage | Test files | Tests |
|---|---:|---:|
| Pre-plan (HEAD = aa08ab3, Wave 1 merged) | 41 | 354 |
| Post-plan (HEAD = 037355a) | 45 | 397 |
| Net new | +4 | +43 |

Net-new cases: protocols-erc20 (13) + signing-simulation (7) + prepare-token-send (14) + preview-send.erc20 (8) + signing-fingerprint (+1 = Fixture D) = 43 new cases.

## Key decisions

### Fixture D = `0x52f396cfab6f8f4dfbf10b36734e7d22e944d54657a72dc2c8d67e91f8c49f85`

Computed via the in-tree `computePayloadFingerprint`:

```
chainId   = 1
to        = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48   (USDC, EIP-55)
valueWei  = 0n
data      = 0xa9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000005f5e100
            (canonical viem-encoded transfer(0x70997970..., 100_000_000n))
```

Drift in the fingerprint preimage assembly for non-empty `data` now breaks Fixture B (Plan 06-01 pinned) AND Fixture D (this plan) simultaneously — two anchors covering the same code path.

### DF-1 LOCKED placement: `src/signing/simulation.ts` (not `src/protocols/`)

The wide eth_call helper lives on the signing shelf next to `payload-fingerprint.ts` and `presign-hash.ts`, NOT under `src/protocols/`. Rationale: simulation is a cross-protocol concern (native + ERC-20 + WETH unwrap all simulate identically — same `eth_call` shape, same revert classification). Co-locating it with the other preview-time signing concerns matches the conceptual home; `src/protocols/` is reserved for per-protocol ABI encode/decode primitives.

### Native sends ALSO simulate at preview time (Phase 4 retroactive benefit)

Research § Topic 9 (DF-1 LOCKED) calls this out as defense-in-depth uniform: every preview-time tx — including Phase 4 native sends — gets the SIMULATION block emitted. A native send to a non-existent address would surface as `status: "ok"` (eth_call always succeeds for value transfers), but a transfer to a contract that reverts in `receive()` surfaces as `status: "revert"` BEFORE the user is asked to blind-sign. The trust anchor remains the device hash match — the simulation is informational.

The behavioral change is visible at the integration-test boundary: `test/demo-flow.integration.test.ts`'s viem.call call-count assertions updated from 1 to 2 (preview + send) for the happy path and from 0 to 1 (preview only) for the cancel path. signClient.request still NEVER called in demo mode — Plan 05-02 invariant intact.

### Block-filter-and-join in preview_send

Rather than always emitting a DECODED ARGS block (which would render as an awkward `DECODED ARGS\n  function: (unknown)\n  ...` for native sends), `buildDecodedArgsBlock(unknown, …)` returns an empty string and preview_send's text-array composition filters it out:

```typescript
const blocks: string[] = [
  ledgerBlock, "", agentBlock, "", fourbyteBlock,
  ...(decodedArgsBlock !== "" ? ["", decodedArgsBlock] : []),
  "", simulationBlock, "", VERIFY_BEFORE_SIGNING_TEMPLATE,
];
```

The native-send response text passes the load-bearing `expect(text).not.toMatch(/DECODED ARGS\s*\n\s*function:/)` assertion in `test/preview-send.erc20.test.ts` Test 5.

### `amount: "max"` rejected by prepare_token_send

`transfer` does not take an unlimited sentinel — that's `approve`'s territory (PREP-29, lands in Plan 06-03). `"max"` hits the `parseAmountStrict` format-regex (fails `/^[0-9]+(\.[0-9]+)?$/`), surfacing as `INVALID_INPUT` with the `kind: "format"` message. A future contributor who silently special-cased `"max"` in `prepare_token_send` would be caught by the test case `rejects 'max' as a non-decimal-shape amount`.

## FROZEN-area zero-diff confirmation

```
$ git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/tools/send_transaction.ts
(empty)

$ git diff origin/main -- src/signing/handle-store.ts
(only additive type widening — 3 optional fields on PrepareArgs + JSDoc; no transitions / TTL / state-machine logic changed)

$ git diff origin/main -- src/signing/blocks.ts
(only appended templates + builders + 1-line import change; Phase 4 templates byte-identical)
```

The cryptographic-binding chain (compute payloadFingerprint, compute presignHash, three send-time gates) is untouched. Plans 06-03 and 06-04 inherit the FROZEN guarantee.

## Deviations from plan

**None.** The plan's `<interfaces>` block locked the call surfaces; `viem@2.48.11` matched the documented signatures (`encodeFunctionData`, `decodeFunctionData`, `erc20Abi`, `parseAbi`, `formatUnits`, `getAddress`, `call`); the `loadEthereumTokenRegistry`, `getEthereumClient`, Phase 4 signing primitives, and Plan 06-01's `parseAmountStrict` + `InvalidAmountError` matched the documented contracts. The Fixture D literal was computed via the exact node-eval recipe in the plan's § Step 5 against the in-tree `computePayloadFingerprint`.

One small operational deviation: the plan's § Behavior calls out 11 cases in `test/prepare-token-send.test.ts`; the shipped file has 14 (the `amount: "max"` rejection assertion was elevated from "implicit in the format-regex" to its own named case for clarity; the register-all wiring smoke was split into 3 sub-cases — registry membership, inputSchema.required, side-effect-import string presence — for finer regression coverage). Net behavior identical to the plan's intent; case count higher.

The DF-1 simulation helper IS consumed by `prepare_token_send` in this plan — but TRANSITIVELY via `preview_send`. `prepare_token_send` builds the handle; `preview_send` runs the simulation against the handle's tx fields. The DECODED ARGS surface for transfer flows through `preview_send.ts`'s selector-routed dispatch, NOT through `prepare_token_send.ts` directly — same architectural shape as the Phase 4 native-send pipeline.

## Commit

```
037355a feat(06-02): prepare_token_send + preview_send decoded-arg + ERC-20 protocol primitives + wide eth_call simulation
```

Single atomic commit per the Phase 4 / 5 / 6-01 cadence. 13 files changed, 1941 insertions(+), 7 deletions(-).

## Self-Check: PASSED

- All 7 created files present at expected paths.
- All 6 modified files diffed against origin/main; modifications are additive / byte-identical-except-for-named-extensions as documented.
- Commit `037355a` present on `feat/06-02-prepare-token-send-and-preview-decode`.
- `npm run typecheck`, `npm run build`, `npm test` all green.
- FROZEN-area zero-diff verified for payload-fingerprint.ts, presign-hash.ts, send_transaction.ts.
- `git diff origin/main -- src/signing/handle-store.ts` shows ONLY additive PrepareArgs widening.
- `git diff origin/main -- src/signing/blocks.ts` shows ONLY appended templates + builders.
- `git diff origin/main -- src/tools/register-all.ts` shows exactly 1 added line.
- Fixture D literal pinned at `0x52f396cfab6f8f4dfbf10b36734e7d22e944d54657a72dc2c8d67e91f8c49f85`.
- Test counts: 354 → 397 (+43); 41 files → 45 files (+4).
