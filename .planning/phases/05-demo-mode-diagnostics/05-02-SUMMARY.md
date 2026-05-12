---
phase: 05
plan: 02
slug: demo-signing-intercepts
status: complete
completed: 2026-05-12
requirements: [DEMO-05, DEMO-06]
---

# Phase 05 Plan 02 — Demo-mode signing intercepts wired to persona; prepare/preview succeed in demo

## One-liner

Apply Q-CONTRADICTION-PREP Option B: REMOVE `DEMO_MODE_REFUSED` early returns from Phase 4's `prepare_native_send` + `preview_send`; route `getActivePersona().address` through as the resolved `from` (prepare) and `senderAddress` (preview); wire `account: persona.address` into `send_transaction`'s already-shipped `viem.call(...)` demo-simulation branch; add `WRONG_MODE` defensive null-persona refusal to all three tools; replace Phase 4's `DEMO_MODE_REFUSED` test assertions for prepare/preview/send with persona-aware success assertions; add a new end-to-end `test/demo-flow.integration.test.ts` exercising the full demo pipeline and asserting Fixture A + C byte-identity (from-independence of PREP-03's preimage).

## Files shipped

### New test files (1)

- `test/demo-flow.integration.test.ts` — 4 tests covering the full `prepare → preview → send (simulation)` demo chain plus the cancel path and DEMO-06 regression anchors:
  - **Test 1+2+3:** end-to-end with whale active. `from === vitalik.address` byte-identical; `payloadFingerprint === Fixture A` byte-identical (proves PREP-03 from-independence — the load-bearing claim); `presignHash === Fixture C` byte-identical under matched RPC pins; `signClient.request` spy at 0 calls; `viem.call` received `account: <whale>`.
  - **Test 4 (cancel):** `userDecision: "cancel"` under demo mode transitions handle to cancelled; no simulation, no broadcast.
  - **Test 5 (DEMO-06 regression):** `pair_ledger_live` STILL refuses in demo with `DEMO_MODE_REFUSED` (this plan does NOT touch the tool).
  - **Test 6 (DEMO-06 regression):** `get_tx_verification` STILL refuses in demo with `DEMO_MODE_REFUSED`.

### Modified source files (3)

- `src/tools/prepare_native_send.ts` — REMOVED demo-refusal early return at lines 110-131 (the `DEMO_MODE_REFUSED` arm). Added demo-aware `fromAddress` resolution: demo branch reads `getActivePersona()?.address`; null-persona path returns `WRONG_MODE`; real-mode branch reads `getStatus().address`. Added `from: fromAddress` field to `structuredContent` (NEW field). Top-of-file source comment (lines 14-34) updated to name the new contract: Plan 05-02 / Q-CONTRADICTION-PREP Option B; `getStatus` never called in demo; `createHandle` IS called in demo (the handle flows through preview + send simulation). DESCRIPTION updated: removed `DEMO_MODE_REFUSED if VAULTPILOT_DEMO=true`; added `WRONG_MODE if demo mode is on but no persona is set` + a one-liner naming the demo-against-persona behavior.
- `src/tools/preview_send.ts` — REMOVED demo-refusal early return at lines 106-127. Added demo-aware `senderAddress` resolution: demo branch reads `getActivePersona()?.address`; null-persona path returns `WRONG_MODE`; real-mode branch reads `getStatus().address`. Top-of-file source comment (lines 13-32) updated to reflect Plan 05-02 / Q-CONTRADICTION-PREP Option B + the cryptographic-binding regression note (Fixture C holds across modes under matched RPC pins). DESCRIPTION updated.
- `src/tools/send_transaction.ts` — added `import { getActivePersona }` from `../demo/state.js`. Inside the EXISTING Phase 4 demo branch (the already-shipped simulation envelope at lines 318-358), added persona-null-defense at the top (returns `WRONG_MODE` if `getActivePersona() === null`) and added `account: persona.address` as the first field of the `viem.call(...)` argument object. Demo simulation envelope shape locked at Phase 4 04-04 is preserved unchanged. Top-of-file source comment (lines 42-52) updated to name the new Plan 05-02 wiring.

### Modified test files (3, REPLACE the DEMO_MODE_REFUSED assertions per `<system-reminder>`)

- `test/prepare-native-send.test.ts` — REPLACED Test 1 (the existing `DEMO_MODE_REFUSED` describe block) with three new cases:
  - **1a:** demo + whale → success; `from === whale.address`; `payloadFingerprint === Fixture A`; `getStatus` spy at 0 calls (T-DEMO-1 unchanged); `createHandle` spy at 1 call (NEW — was 0 under old refusal).
  - **1b:** persona switch (stable-saver) → `from === stable-saver.address`; fingerprint still Fixture A (from-independence again).
  - **1c (T-NULL-PERSONA-1):** explicit demo + no persona → `WRONG_MODE`; both downstream spies at 0 calls.
- `test/preview-send.test.ts` — REPLACED Test 10 with three new cases:
  - **10a:** demo + whale → success; `presignHash === Fixture C` byte-identical (under matched RPC pins); `getTransactionCount` spy received `address: whale.address`; `estimateGas` spy received `account: whale.address`; LEDGER BLIND-SIGN HASH block emitted in text.
  - **10b:** persona switch (stable-saver) → viem reads fire with stable-saver's address.
  - **10c (T-NULL-PERSONA-1):** explicit demo + no persona → `WRONG_MODE`; all downstream spies at 0 calls.
- `test/send-transaction.test.ts` — EVOLVED Test 9 (DEMO-05 simulation envelope) to stub `setActivePersona("whale")` and assert `callSpy.mock.calls[0][1].account === whale.address`. Added NEW Test 9c (T-NULL-PERSONA-1): demo on + no persona → `WRONG_MODE`; `viem.call` + `signClient.request` both at 0 calls.

## Test count

**234 passing (225 inherited from baseline + 9 net new), 0 failing.** Suite runs in ~3.2s.

Breakdown of the +9 net:

| File | Inherited | New | Net |
|------|-----------|-----|-----|
| `test/prepare-native-send.test.ts` | 10 (1 demo refusal) | 12 (3 demo success/switch/null) | +2 |
| `test/preview-send.test.ts` | 15 (1 demo refusal) | 17 (3 demo success/switch/null) | +2 |
| `test/send-transaction.test.ts` | 16 (1 demo simulation) | 17 (1 evolved + 1 new null) | +1 |
| `test/demo-flow.integration.test.ts` | 0 | 4 | +4 |
| Other inherited test files | 184 | 184 | 0 |
| **Total** | **225** | **234** | **+9** |

## Key decisions

### Q-CONTRADICTION-PREP Option B (LOCKED at planning gate)

**Before** (`src/tools/prepare_native_send.ts:108-131` shipped at Plan 04-02):

```typescript
if (isDemoMode()) {
  return {
    isError: true,
    content: [{ type: "text", text: "error: demo mode is active; signing tools refuse..." }],
    structuredContent: errEnvelope("DEMO_MODE_REFUSED", "demo mode is active; signing tools are disabled"),
  };
}
```

**After** (`src/tools/prepare_native_send.ts` post-Plan-05-02):

```typescript
let fromAddress: Address;
if (isDemoMode()) {
  const persona = getActivePersona();
  if (persona === null) {
    return {
      isError: true,
      content: [{ type: "text", text: "error: demo mode is active but no persona set..." }],
      structuredContent: errEnvelope("WRONG_MODE", "demo mode active but no persona set; call set_demo_wallet first"),
    };
  }
  fromAddress = persona.address;
} else {
  const status = await getStatus();
  if (status === null) { /* WALLET_NOT_PAIRED */ }
  fromAddress = status.address;
}
```

Analogous shape applied to `preview_send.ts`. `send_transaction.ts` was a one-line edit inside the already-shipped Phase 4 demo branch.

### Persona-null defense pattern (T-NULL-PERSONA-1)

All three tools defend identically:

```typescript
if (isDemoMode()) {
  const persona = getActivePersona();
  if (persona === null) {
    return {
      isError: true,
      content: [{ type: "text", text: "error: demo mode is active but no persona set. Call `set_demo_wallet({ persona: \"whale\" | \"defi-degen\" | \"stable-saver\" | \"staking-maxi\" })` first." }],
      structuredContent: errEnvelope("WRONG_MODE", "demo mode active but no persona set; call set_demo_wallet first"),
    };
  }
  // ... persona-aware path
}
```

Reachable only via explicit `VAULTPILOT_DEMO=true` env WITHOUT a prior `set_demo_wallet` call. Under auto-demo, `getActivePersona()` is non-null by construction (Plan 05-01's resolver seeds `whale` on the auto-demo arm). All three tools assert the null-defense branch via Test 1c / 10c / 9c.

### Cryptographic-binding regression values hold across modes

- **Fixture A** `0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a` — `payloadFingerprint` for `{ to: 0x70997970..., valueWei: 1e18, chainId: 1, data: "0x" }`. PREP-03's preimage is `chainId || to || valueWei || data`; `from` is NOT in it. The fingerprint holds byte-identically across real-mode (Phase 4 `trust-pipeline.integration.test.ts:226-229`) and demo-mode (this plan's `demo-flow.integration.test.ts:185` — line of the `expect(prepareSc.payloadFingerprint).toBe(FIXTURE_PAYLOAD_FINGERPRINT)` assertion). **Load-bearing proof** that the cryptographic-binding chain is `from`-independent.

- **Fixture C** `0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85` — `presignHash` for Fixture A inputs + nonce 7 + gas 21000 + maxFeePerGas 30 gwei + maxPriorityFeePerGas 1.5 gwei. The persona is the SENDER for `getTransactionCount` + `estimateGas` in demo, but `from` is not in the EIP-1559 presign preimage either. Under matched RPC pins (the integration test PINS the mocked RPC to Fixture C's exact values), the demo presign hash is byte-identical to Fixture C — same anchor as real-mode (Plan 04-01 `test/signing-presign-hash.test.ts`).

### Phase 4 source-comment update (T-COMMENT-DRIFT-1 mitigation)

Phase 4 retro lesson applied in reverse: when behavior changes, in-tree comments MUST update in the same commit. Grep verification: `grep -c "remains refused" src/tools/prepare_native_send.ts src/tools/preview_send.ts` returns 0. All three signing-flow tools clear of `DEMO_MODE_REFUSED` references (`pair_ledger_live` + `get_tx_verification` still use the code — neither is touched by this plan).

### `from` field added to `prepare_native_send`'s `structuredContent` (new public surface)

Surfaces the resolved sender — persona address (demo) or paired Ledger address (real). Available to the agent as a visible source-of-truth artifact in the structured response. The `PREPARE_RECEIPT_TEMPLATE` text block is unchanged (PREP-02 invariant — receipt is shared with `get_tx_verification` re-emit, modifying it would force a Phase 4 04-05 change). Defer text-block surface to a future plan if needed.

### Test methodology: REPLACE, not delete

Per the plan and PATTERNS.md § Phase 4 Test Surface Changes: the three Phase 4 test files' `DEMO_MODE_REFUSED` assertions are REPLACED with persona-aware success assertions. Critical detail: the existing tests asserted `createHandleSpy.toHaveBeenCalledTimes(0)`; under Plan 05-02 the demo flow DOES create handles (they flow through preview + send simulation), so the assertion flips to `toHaveBeenCalledTimes(1)`. Deleting only the errorCode line would leave a contradictory test that fails on the count assertion.

### `account: persona.address` reaches viem's `call` action

viem 2.48's `CallParameters` accepts `account?: Account | Address | undefined` — passing the `Address` literal directly works. Confirmed at `node_modules/viem/_types/actions/public/call.d.ts:27`. The simulation now has a meaningful msg.sender for caller-dependent reverts (token approvals, gated staking flows). Test 9a asserts the call args byte-identically.

## Non-negotiables verified

- [x] `prepare_native_send` no longer refuses in demo mode — `grep -c "DEMO_MODE_REFUSED" src/tools/prepare_native_send.ts` → 0
- [x] `preview_send` no longer refuses in demo mode — same → 0
- [x] `send_transaction` demo branch wires `account: persona.address` — `grep -c "account: persona.address" src/tools/send_transaction.ts` → 2 (the call site + the comment reference)
- [x] In-tree comments updated to Q-CONTRADICTION-PREP Option B language (T-COMMENT-DRIFT-1)
- [x] All three tools import `getActivePersona` from `../demo/state.js`
- [x] Fixture A holds byte-identically under demo `from` (integration test ASSERTS)
- [x] Fixture C holds byte-identically under matched RPC pins (integration test ASSERTS)
- [x] `signClient.request` spy at 0 calls under demo mode (integration test Test 3 ASSERTS)
- [x] DEMO-06 regression anchors preserved — `pair_ledger_live` + `get_tx_verification` still refuse in demo (integration test Tests 5+6 ASSERT)
- [x] 234 tests passing; 0 failing; typecheck clean; build clean

## Deviations from plan

- **`createHandleSpy.toHaveBeenCalledTimes(1)` migration** — the plan's Test 1a spec asserted `expect((result.structuredContent as { handle: string }).handle).toMatch(/^[0-9a-f-]+$/)`, but the implementation went stricter and asserts a real UUID v4 regex (matches the existing happy-path test's assertion). No semantic change — the v4 regex is a tighter superset of the loose hex regex.
- **PATTERNS.md Test 10a spec** suggested mock setup via `getTransactionCountSpy.mockResolvedValueOnce(7)` (one-shot). Implementation uses `.mockResolvedValue(7)` (sticky) for symmetry with the existing happy-path tests' `scriptFixtureCMocks()` helper. Functionally equivalent for the single-call assertion.
- **No standalone Test 9c assertion that `_resetActivePersonaForTesting()` is needed** — the existing `beforeEach` in `send-transaction.test.ts` (carried over from Plan 05-01's persona-state-reset migration) already clears active persona between tests; Test 9c calls it explicitly for documentation but the beforeEach already covered it.
- **PR description must call out the behavioral change to Phase 4 shipped code** — this is in the SUMMARY above. The PR body should include the "Before / After" snippet under Key Decisions.

No other deviations. The plan was executed as written.

## What this enables next

- Plan 05-03 can now exercise the full demo `prepare → preview → send (simulation)` chain through the actual MCP tool surface for its dispatcher-wrap integration test (`auto-demo-notice.test.ts`) — without requiring test-only state-seeding bypasses.
- Manual verify-phase (combined Phase 3+4+5) can drive the demo rehearsal end-to-end: `set_demo_wallet → portfolio read → prepare → preview → send simulation` returns the simulation envelope with no broadcast.
- The agent has a meaningful "rehearsal" experience: same `PREPARE RECEIPT` block, same `LEDGER BLIND-SIGN HASH`, same `AGENT TASK`, same `4byte` cross-check the real flow produces — anchored against a curated persona address.

## Threat surface scan

No new security-relevant surface introduced beyond the threat register's existing entries. No new network endpoints, no new auth paths, no new file access patterns. The new `from` field on `prepare_native_send`'s `structuredContent` surfaces the persona address that the agent (and the user) can already obtain via `get_demo_wallet` or `set_demo_wallet`'s response; no information is disclosed that wasn't already in scope. T-DEMO-FROM-LEAK-1 mitigation noted in source comments — the SIMULATION text block in `send_transaction` and the auto-demo NOTICE (Plan 05-03) tell the user they have no key for this address.
