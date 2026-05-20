# Phase 12 Plan-Check Report

**Checked:** 2026-05-20
**Plans:** 12-01 → 12-05 (5 plans, strict-sequential)

## Overall verdict

**FLAG-WITH-INLINE-FIXES** — no blockers, 3 flags + 2 nits. Plans deliver the locked Phase 12 scope (DF-1..4) coherently; the gaps are upstream-document drift (RESEARCH/PATTERNS/CONTEXT vs. the corrected plan numbers) and one documented success-criterion deferral that should be acknowledged on the phase artifact, not silently dropped.

## Dimension verdicts (10)

1. **Requirements coverage** — **PASS**. SOL-PREP-01 (12-01) · SOL-PREP-02 (12-01 scaffolding + 12-04 enforcement) · SOL-PREP-03 (12-05) · SOL-PREP-04 explicitly DEFERRED per orchestrator DF-3 override (acknowledged in 12-02 + 12-04 + 12-05) · SOL-PREP-05 (12-04 + 12-05) · SOL-W-01 (12-02) · SOL-W-02 (12-03). All 6 in-scope requirement IDs covered.

2. **Wave-order soundness** — **PASS**. 12-01 `depends_on=[]` wave 1; 12-02 `[12-01]` wave 2; 12-03 `[12-01, 12-02]` wave 3; 12-04 `[12-01, 12-02, 12-03]` wave 4; 12-05 `[12-01, 12-02, 12-03, 12-04]` wave 5. Every plan declares `<parallel_eligible>none</parallel_eligible>`. Strict-sequential chain confirmed.

3. **FROZEN-area discipline** — **PASS**. Every plan asserts the EVM-side `payload-fingerprint.ts` / `presign-hash.ts` / `simulation.ts` / `blocks.ts` / EVM body of `send_transaction.ts` byte-untouched (`git diff origin/main -- … returns EMPTY`). Plan 12-01 widens `handle-store.ts` ADDITIVELY (txType discriminator defaults to `"evm"`). Plan 12-05 widens the FROZEN three-gate region with a single `if/else` at the PAYLOAD_FINGERPRINT_DRIFT recompute call — acknowledged as the one byte-level addition inside the FROZEN region per PATTERNS line 455. Solana branch is additive AFTER the FROZEN region.

4. **Test methodology** — **PASS**. 12-01 ships NEW `test/signing-fingerprint-solana.test.ts` with Fixtures K + L as hardcoded `0x...` literals (NOT extending the Phase-8-FROZEN `test/signing-fingerprint.test.ts`) — domain-tag length pin + calldata-embedding regression + spy-affordance regression. NO `beforeAll`-snapshot per CLAUDE.md. 12-02 cross-anchors Fixture K at `test/prepare-solana-native-send.test.ts:3`. 12-03 cross-anchors Fixture L at `test/prepare-solana-spl-send.test.ts:3` + sender-dependence unit anchor. 12-04 ships `test/preview-send.solana.test.ts` with mandatory-vs-advisory regression. 12-05 ships LOAD-BEARING `test/solana-trust-pipeline.integration.test.ts` with 15 tests + STOP-THE-LINE comment.

5. **Research-finding propagation (DF-1..4)** — **PASS**. DF-1 preimage shape locked in 12-01 (`keccak256("VaultPilot-soltx-v1:" ‖ messageBytes)`). DF-2 SHA-256 blind-sign hash in 12-01 + unconditional emission in 12-04. DF-3 durable-nonce **deferred** — verified: no `prepare_solana_nonce_init/close` tools in any plan; 12-02 explicitly forbids `useDurableNonce` schema field. DF-4 mandatory simulation gate in 12-04 with `SIMULATION_REFUSED` errorCode (widened in 12-01).

6. **`feePayer` in preimage** — **PASS**. 12-01 line 38 + 12-02 line 37 + 12-03 lines 30 + 155 acknowledge "Solana fingerprint is sender-DEPENDENT" (legacy `Transaction.serializeMessage()` puts feePayer at `account_keys[0]`). 12-05 integration tests 4-7 assert per-persona-deterministic + cross-persona-distinct for BOTH native SOL AND SPL. This correctly overrides the CONTEXT.md `<decisions>` line 25 stale framing ("sender-independent for native SOL") — orchestrator override propagated through 12-05 integration plan.

7. **`userInputType: "sol"` on `signTransaction`** — **PASS**. 12-04 plan step 2 wires the `userInputType` parameter through `_transport.signTransactionViaApp`; defaults to `"sol"`. 12-04 tests 2-3 assert default `"sol"` and explicit `"ata"` override. 12-05 step 1 passes `userInputType: "sol"` at sign time; test 14 spies the call.

8. **`TransferChecked` over `Transfer`** — **PASS**. 12-03 plan step 1 imports `createTransferCheckedInstruction` (NOT `createTransferInstruction`) — line 61 explicit. Line 68 names "RESEARCH Topic 6 explicit: TransferChecked (NOT Transfer) — on-chain decimals + mint verification is the load-bearing defense-in-depth." Test 4 asserts `data.length === 12` for the encoded TransferChecked instruction.

9. **Both `txHash` AND `txSignature` in send response** — **PASS**. 12-05 plan step 1 sub-step 2 step 8 returns `{ txHash: txSignature, txSignature: txSignature, … }`. Success criterion line 322 explicit. Integration test 12 asserts `structuredContent.txHash === structuredContent.txSignature` (same base58 under both names).

10. **Domain-tag byte length** — **PASS, plans canonically correct at 20 bytes**. Confirmed by inspection AND `Buffer.byteLength("VaultPilot-soltx-v1:", "utf8") = 20`. Plan 12-01 line 64 + line 170 assert `length === 20` — CORRECT. RESEARCH lines 40, 567, 591 say "22 UTF-8 bytes" — INCORRECT (research artifact drift). PATTERNS line 72 + 345 + 374 + 397 say "21-byte UTF-8" — INCORRECT. Plans are right; upstream docs have arithmetic drift. See Nit 1 below.

## Per-plan verdicts

- **12-01: PASS** — primitives + Fixtures K + L + handle-store discriminator + errorCode widening complete. Note: plan step 7 sketches a one-shot generation script for the `0x...` literals — that's the right shape per CLAUDE.md "hardcoded-literal" discipline.
- **12-02: PASS** — `prepare_solana_native_send` + System Program encoder + amount-solana; `register-all.ts` insertion-position deterministic; no `useDurableNonce` flag (DF-3 honored).
- **12-03: PASS** — `prepare_solana_spl_send` uses TransferChecked + ATA derivation server-side + conditional createATA prepending; `userInputType: "sol"` precondition satisfied (handle stores wallet, not ATA).
- **12-04: PASS** — `preview_send` Solana branch via discriminator dispatch; MANDATORY simulation refusal (not advisory) — DF-4 honored; `canonical-dispatch-solana.ts` allowlist = 3 program IDs (System + Token + Associated Token, no durable-nonce — DF-3 honored); `signSolanaTransaction` per-call USB-HID.
- **12-05: FLAG** — three-gate region widening + USB-HID broadcast + load-bearing integration test complete; **FLAG-1 below**: success criterion 8 (SECURITY.md Solana threat-model update) marked as DEFERRED to a follow-up commit at planner discretion — the ROADMAP Phase 12 success criterion is explicit, the plan should either land the update in this commit or surface a tracked follow-up issue, not defer-to-discretion.

## BLOCKERs (must replan before execute)

None.

## FLAGs (cheap inline fixes before execute)

1. **12-05 success criterion 8 — SECURITY.md Solana threat-model section is deferred to "planner discretion"** (12-05 lines 333-335). ROADMAP Phase 12 success criterion #8 names it explicitly; "planner discretion" is not a defer mechanism. Fix: either (a) add a 7th task to 12-05 that writes the SECURITY.md section in the same commit, OR (b) name an explicit follow-up commit shape (e.g. `docs(12-sec): SECURITY.md Solana threat-model section`) referenced as a tracked carryover before Phase 13 starts. Recommend (a) — same commit; the threat-model text is ~30 lines and the integration test plan already names the trust-shape elements verbatim.

2. **ROADMAP success criterion #6 (durable-nonce tools) vs orchestrator DF-3 override** — Plans correctly defer (no nonce tools), but the ROADMAP entry still names `prepare_solana_nonce_init/close` as a Phase 12 success criterion. Fix: at execute-phase sign-off, update ROADMAP line 309 + line 316 to mark criterion #6 as deferred-to-v2.0.x with a one-line carryover note. This is upstream-document hygiene, not a plan defect — plans correctly honor the orchestrator override.

3. **ROADMAP success criterion #7 + CONTEXT.md `<decisions>` line 24 still name Fixtures I + J + "in `test/signing-fingerprint.test.ts`"** — plans correctly use Fixtures K + L in a NEW sibling `test/signing-fingerprint-solana.test.ts` per PATTERNS meta-decision #5 + RESEARCH OQ-2 (Phase 8 already took J). Fix: same path as Flag 2 — update ROADMAP + CONTEXT.md at execute-phase sign-off so future readers don't grep `signing-fingerprint.test.ts` looking for Fixture I.

## NITs (record-only)

1. **RESEARCH.md domain-tag byte count drift (3 occurrences)** — lines 40, 567, 591 say "22 UTF-8 bytes"; PATTERNS lines 72, 345, 374, 397 say "21-byte UTF-8"; the canonical answer is **20 bytes** (confirmed by `Buffer.byteLength("VaultPilot-soltx-v1:", "utf8") = 20` and `V=1 a=2 u=3 l=4 t=5 P=6 i=7 l=8 o=9 t=10 -=11 s=12 o=13 l=14 t=15 x=16 -=17 v=18 1=19 :=20`). Plan 12-01 correctly asserts 20 — no execution-time impact (the value is computed from `FINGERPRINT_DOMAIN_TAG_SOLANA.length`, not hardcoded from prose). Opportunistic fix when next editing RESEARCH/PATTERNS.

2. **CONTEXT.md is a placeholder** — line 4 says "Status: Placeholder — context-gathering pending (run `/gsd-discuss-phase 12`)". The `<decisions>` section is "Anchor candidates" not locked decisions. Plans operate from RESEARCH DFs + orchestrator overrides instead, which is correct for the actual decision set. No execute-time impact; record-only.

## Cross-plan concerns

- **`record.tx.feePayer` referenced in 12-04 `signSolanaTransaction` return shape (line 94) — verify at write time**. Plan 12-04 step 2 sketches `return { signature, pubkey: record.tx.feePayer /* caller passes */ }` but `record` is not in scope of `signSolanaTransaction`. The note at line 99 already flags "simplify return shape to `{ signature: Uint8Array }`" — recommend committing to the simpler shape and reading `feePayer` from the caller (Plan 12-05 already has it via `record.tx.feePayer`). NIT-level — plan body acknowledges the open point.

- **Handle-store `txHash` field type** — Plan 12-05 line 174 + RESEARCH Topic 7 flag the EVM `txHash: Hex` field type. Solana signatures are base58 (not hex). Plan recommends widening to `string` for cross-chain; the alt of `"0x"+hex(signature)` is messy. Cross-plan: Plan 12-01 widens `PreparedTx` but does NOT widen `handle-store`'s `txHash` field. Recommend: 12-05 includes the `txHash: Hex → string` widening (one-line type change) in the same commit as the Solana branch. Already implied by 12-05 line 174 "widen to `string` in this plan with a comment explaining cross-chain rationale" — make this explicit in the success criteria.

- **`canonical-dispatch-solana.ts` allowlist for SystemProgram covers ALL instructions** (nonceInitialize/Advance/Withdraw/Authorize too, since the allowlist keys on program ID not instruction discriminant). DF-3 deferral is honored at the prepare-tool layer (no nonce tools ship), but the allowlist itself does not narrow per-instruction. Acceptable — Phase 13 will narrow if needed; record-only.
