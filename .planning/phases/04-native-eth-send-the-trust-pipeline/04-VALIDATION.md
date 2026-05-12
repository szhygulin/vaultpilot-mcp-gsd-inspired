---
phase: 4
slug: native-eth-send-the-trust-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-12
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `04-RESEARCH.md` § Validation Architecture (lines 1074–1123). Phase 4 is the load-bearing trust-pipeline milestone — verification map is denser than prior phases.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@^2.1.0` (already configured) |
| **Config file** | None — vitest defaults; tests in `test/` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npm run typecheck && npm run build` |
| **Estimated runtime** | ~6–8 seconds (Phase 4 adds ~7 test files + ~40 new cases on top of the existing 90; includes one integration test) |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test && npm run typecheck && npm run build`
- **Before `/gsd-verify-work`:** Full suite green + Phase 4 verify-phase manual flow (real Ledger via WC + a small live broadcast on mainnet)
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

> Mirrors `04-RESEARCH.md` § Phase Requirements → Test Map. Plans 04-01..05 own their respective rows; task IDs are anticipated and the planner finalizes them in each PLAN.md.

| Task ID (anticipated) | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|----|----|----|----|----|----|----|----|----|----|
| 04-01-W0a | 01 | 0 | All | — | `mock-public-client.ts` helper installed (extends Wave 0 contract) | infra | `npm test -- helpers/mock-public-client` | ❌ W0 | ⬜ pending |
| 04-01-W0b | 01 | 0 | PREP-09 | — | `mock-sign-client.ts` extended with `_setRequestResponse` / `_setRequestRejection` | infra | `npm test -- helpers/mock-sign-client` | ❌ W0 | ⬜ pending |
| 04-01-01 | 01 | 1 | PREP-03 | T-BIND-1 | `payloadFingerprint` matches Code Example 1 fixture for native send (`data === "0x"`) | unit | `npm test -- signing-fingerprint` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | PREP-03 | T-BIND-1 | Forward-looking: `payloadFingerprint` matches an ERC-20 transfer 68-byte-data fixture (locks Phase 6 reusability) | unit | `npm test -- signing-fingerprint` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | — | — | Non-address `to` (`"0xnotahex"`) throws via `viem.hexToBytes` — error message wraps with handle context | unit | `npm test -- signing-fingerprint` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | PREP-01 | T-STATE-1 | Handle store state machine: `prepared → previewed → sent`; reject illegal transitions with `WRONG_STATUS` | unit | `npm test -- signing-handle-store` | ❌ W0 | ⬜ pending |
| 04-01-05 | 01 | 1 | PREP-10 | T-STATE-2 | Lazy TTL eviction: `Date.now() > createdAt + 15*60*1000` → `HANDLE_EXPIRED` on lookup | unit (fake timers) | `npm test -- signing-handle-store` | ❌ W0 | ⬜ pending |
| 04-01-06 | 01 | 1 | PREP-02 | T-PREP-RCPT-1 | `PREPARE_RECEIPT_TEMPLATE` exported const; verbatim args (no normalization) confirmed by byte-identical string assert | unit | `npm test -- signing-blocks` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | PREP-01 | — | `prepare_native_send({ to, valueWei })` returns the documented tuple shape; handle stored | unit (mocked public client) | `npm test -- prepare-native-send` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | PREP-01 | T-PAIR-1 | Unpaired wallet → `WALLET_NOT_PAIRED` refusal (depends on session-manager.getStatus()) | unit | `npm test -- prepare-native-send` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 2 | — | T-ADDR-1 | Invalid `to` (not 0x-hex 20 bytes) → structured refusal at handler boundary | unit | `npm test -- prepare-native-send` | ❌ W0 | ⬜ pending |
| 04-02-04 | 02 | 2 | PREP-02 | T-PREP-RCPT-1 | Response `content[0].text` carries the `PREPARE_RECEIPT_TEMPLATE` substituted block; test imports the const | unit | `npm test -- prepare-native-send` | ❌ W0 | ⬜ pending |
| 04-02-05 | 02 | 2 | — | — | Demo-mode short-circuit: `VAULTPILOT_DEMO=true` AND demo persona active → simulation envelope, no real RPC nonce read | unit | `npm test -- prepare-native-send` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 3 | PREP-04 | T-PIN-1 | `preview_send({ handle })` pins nonce + gas + maxFeePerGas + maxPriorityFeePerGas on handle | unit (mocked public client) | `npm test -- preview-send` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 3 | PREP-04 | — | `previewToken` is a UUID v4 (regex assert); stored on handle for send-time match | unit | `npm test -- preview-send` | ❌ W0 | ⬜ pending |
| 04-03-03 | 03 | 3 | PREP-04 | T-PRESIGN-1 | `LEDGER BLIND-SIGN HASH` matches Code Example 2 fixture (full hex + 4-char-chunked form per A1 mitigation) | unit | `npm test -- signing-presign-hash` + `npm test -- preview-send` | ❌ W0 | ⬜ pending |
| 04-03-04 | 03 | 3 | PREP-05 | T-AGENT-1 | `[AGENT TASK — RUN THESE CHECKS NOW]` block emitted verbatim; test imports `AGENT_TASK_TEMPLATE` const | unit | `npm test -- preview-send` | ❌ W0 | ⬜ pending |
| 04-03-05 | 03 | 3 | — | — | Idempotent re-preview: second `preview_send` re-pins fresh values + mints fresh `previewToken`; old token invalidated | unit | `npm test -- preview-send` | ❌ W0 | ⬜ pending |
| 04-03-06 | 03 | 3 | — | T-STATE-3 | `preview_send` against `sent` handle → `WRONG_STATUS` | unit | `npm test -- preview-send` | ❌ W0 | ⬜ pending |
| 04-03-07 | 03 | 3 | — | — | `preview_send` against unknown handle → `HANDLE_NOT_FOUND` | unit | `npm test -- preview-send` | ❌ W0 | ⬜ pending |
| 04-03-08 | 03 | 3 | — | — | `preview_send` against expired handle → `HANDLE_EXPIRED` | unit (fake timers) | `npm test -- preview-send` | ❌ W0 | ⬜ pending |
| 04-03-09 | 03 | 3 | PREP-06 | T-4BYTE-1 | 4byte cross-check block: `data === "0x"` → block shows `"not-applicable"` verbatim | unit | `npm test -- preview-send` | ❌ W0 | ⬜ pending |
| 04-04-01 | 04 | 4 | PREP-07 (schema) | T-GATE-1 | MCP boundary rejects `userDecision: "yes"` via `enum: ["send", "cancel"]` ajv enforcement (handler never invoked) | unit | `npm test -- send-transaction` | ❌ W0 | ⬜ pending |
| 04-04-02 | 04 | 4 | PREP-07 (token) | T-GATE-2 | Wrong `previewToken` → `PREVIEW_TOKEN_MISMATCH` structured refusal | unit | `npm test -- send-transaction` | ❌ W0 | ⬜ pending |
| 04-04-03 | 04 | 4 | PREP-07 (state) | T-STATE-4 | `prepared` handle (no preview ran) → `PREVIEW_REQUIRED` | unit | `npm test -- send-transaction` | ❌ W0 | ⬜ pending |
| 04-04-04 | 04 | 4 | PREP-08 | T-DRIFT-1 | `payloadFingerprint` re-check at send: forcibly mutate stored fingerprint → `PAYLOAD_FINGERPRINT_DRIFT` refusal | unit | `npm test -- send-transaction` | ❌ W0 | ⬜ pending |
| 04-04-05 | 04 | 4 | PREP-09 | T-WC-FWD-1 | `signClient.request({ method: "eth_sendTransaction", chainId: "eip155:1", params: [pinned-tx] })` called with the pinned-then-derived params | unit (mocked sign-client) | `npm test -- send-transaction` | ❌ W0 | ⬜ pending |
| 04-04-06 | 04 | 4 | PREP-09 | — | Mock returns `txHash` → tool returns `{ txHash, broadcastedAt }` | unit | `npm test -- send-transaction` | ❌ W0 | ⬜ pending |
| 04-04-07 | 04 | 4 | — | T-LEDGER-REJ-1 | User rejects on device → Ledger Live error bubbles up as `LEDGER_REJECTED` (verbatim message attached) | unit | `npm test -- send-transaction` | ❌ W0 | ⬜ pending |
| 04-04-08 | 04 | 4 | — | T-CANCEL-1 | `userDecision: "cancel"` → structured `userCancelled: true` non-error; handle transitions to terminal `cancelled` | unit | `npm test -- send-transaction` | ❌ W0 | ⬜ pending |
| 04-04-09 | 04 | 4 | All (pipeline) | T-INTEG-1 | Trust-pipeline integration: `prepare_native_send → preview_send → send_transaction` end-to-end against mocked viem + mocked WC, with pre-computed fixture for fingerprint + presign hash + mock-tx-hash | integration | `npm test -- trust-pipeline.integration` | ❌ W0 | ⬜ pending |
| 04-04-10 | 04 | 4 | — | — | Demo-mode `send_transaction` runs `eth_call` for revert detection; returns `{ simulated: true, ... }` envelope; nothing broadcast | unit | `npm test -- send-transaction` | ❌ W0 | ⬜ pending |
| 04-05-01 | 05 | 2 (parallel) | PREP-06 | T-4BYTE-1 | 4byte returns valid `text_signature` → cross-check block shows it | unit (mocked fetch) | `npm test -- fourbyte` | ❌ W0 | ⬜ pending |
| 04-05-02 | 05 | 2 (parallel) | PREP-06 | T-4BYTE-2 | 4byte 5xx or timeout (1.5s AbortController) → block shows `"error: 4byte.directory unreachable"` verbatim, NOT masked | unit | `npm test -- fourbyte` | ❌ W0 | ⬜ pending |
| 04-05-03 | 05 | 2 (parallel) | PREP-06 | — | LRU cache hit on second call to same selector — single network call | unit | `npm test -- fourbyte` | ❌ W0 | ⬜ pending |
| 04-05-04 | 05 | 2 (parallel) | PREP-10 | T-REEMIT-1 | `get_tx_verification(handle)` after preview re-emits same `LEDGER BLIND-SIGN HASH` + `AGENT TASK` blocks; template-import equality | unit | `npm test -- get-tx-verification` | ❌ W0 | ⬜ pending |
| 04-05-05 | 05 | 2 (parallel) | PREP-10 | — | `get_tx_verification` past 15-min TTL → `HANDLE_EXPIRED` | unit (fake timers) | `npm test -- get-tx-verification` | ❌ W0 | ⬜ pending |
| 04-VERIFY | — | — | End-to-end | All | Real WC relay + real Ledger device + real RPC; `prepare_native_send` for a small mainnet broadcast to a return-able address; device shows pre-sign hash matching `LEDGER BLIND-SIGN HASH` block | manual | verify-phase | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/helpers/mock-public-client.ts` — `createMockPublicClient()` with `_setNonce(n)`, `_setFees({ maxFee, maxPriority })`, `_setGasEstimate(g)`, `_setCallResponse(hex)` (DEMO-05 simulation). Used across `prepare-native-send`, `preview-send`, `send-transaction`, and the integration test.
- [ ] Extend `test/helpers/mock-sign-client.ts` (already exists from Phase 3) with `_setRequestResponse(method, hash)` and `_setRequestRejection(method, err)` so plan 04-04 + integration test can script the `signClient.request("eth_sendTransaction", ...)` response.
- [ ] `test/signing-fingerprint.test.ts` — anchors against Code Example 1 fixture (native send + ERC-20-shape forward-looking + invalid-input rejection)
- [ ] `test/signing-presign-hash.test.ts` — anchors against Code Example 2 fixture, includes `viem.parseTransaction(serialized)` round-trip
- [ ] `test/signing-handle-store.test.ts` — state machine transitions, lazy TTL eviction, `_resetHandleStoreForTesting` isolation
- [ ] `test/signing-blocks.test.ts` — verbatim template assertions for `PREPARE_RECEIPT_TEMPLATE`, `LEDGER_BLIND_SIGN_HASH_TEMPLATE`, `AGENT_TASK_TEMPLATE`
- [ ] `test/fourbyte.test.ts` — found / not-found / error / not-applicable / cache hit / timeout
- [ ] `test/trust-pipeline.integration.test.ts` — full prepare→preview→send walk against the two mock helpers above

*Mocking strategy:* vitest module-level `vi.mock` per existing convention. The Wave 0 helpers are the single source of truth; tests script scenarios via the `_set*` API. The integration test composes both helpers without re-mocking anything.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Ledger blind-sign hash matches `LEDGER BLIND-SIGN HASH` block character-for-character (Assumption A1) | PREP-04 | Requires a real Ledger device; A1 (does the device show full hex or a chunked/truncated form?) is only verifiable against hardware | 1. `WALLETCONNECT_PROJECT_ID=<real> ETHEREUM_RPC_URL=<key> npm start` 2. `pair_ledger_live` → approve on device 3. `prepare_native_send({ to: <your-own-test-addr>, valueWei: "1000" })` 4. `preview_send({ handle })` 5. Compare `LEDGER BLIND-SIGN HASH` block (both full-hex + 4-char-chunked forms) against the device screen; record exact representation 6. If device shows neither — revise `LEDGER_BLIND_SIGN_HASH_TEMPLATE` to match (e.g. checksummed display) |
| Real `eth_sendTransaction` round-trip returns `txHash` (Assumption A3) | PREP-09 | Confirms Ledger Live broadcasts internally and returns the hash, not signed bytes | After preview, `send_transaction({ handle, previewToken, userDecision: "send" })`; user approves on device; assert returned `txHash` matches Etherscan |
| RPC fee estimation viable against PublicNode for live tx (Assumption A5) | PREP-04 | Only confirmable with a real broadcast | Same manual flow; broadcast succeeds without "underpriced" error |
| User-rejected-on-device path (T-LEDGER-REJ-1) | — | Requires a real "reject" interaction on the device | Same flow but reject at device; tool returns `LEDGER_REJECTED` envelope with bubbled-up message |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (manual-only items explicitly enumerated above)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (verified — every code task pairs with a unit test in the same wave; integration test in wave 4 binds the whole pipeline)
- [ ] Wave 0 covers all MISSING references (mock-public-client + extended mock-sign-client + 8 test files)
- [ ] No watch-mode flags (`npm test` runs vitest with `run` semantics — single-pass)
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter after plan-checker green

**Approval:** pending — flip to approved after plan-checker green.
