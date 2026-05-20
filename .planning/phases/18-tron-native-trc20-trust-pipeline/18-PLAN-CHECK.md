# Phase 18 Plan-Check Report

**Checked:** 2026-05-20
**Plans:** 18-01 → 18-04 (4 plans, strict-sequential)
**Checker:** goal-backward verification against ROADMAP Phase 18 Success Criteria (7) + REQUIREMENTS TRON-PREP-01..05 + TRON-W-01/W-02 + CONTEXT D-01..12

## Overall verdict

**PASS WITH 3 FLAGS + 2 NITS (inline-fixable)** — no BLOCKers. The 4-plan strict-sequential chain delivers the load-bearing TRON trust pipeline coherently; FROZEN-area discipline applied uniformly; CONTEXT decisions D-01 through D-12 propagated correctly with one research-driven correction (D-06b expiration window — RESEARCH §Topic 5). The flags are upstream-document drift (ROADMAP fixture names + ROADMAP expiration framing) and one research-finding surface that should land in the relevant plan body, not stay in RESEARCH only.

## Dimension verdicts (10)

1. **Requirements coverage** — **PASS**.
   - TRON-PREP-01 (payloadFingerprint over Protobuf raw_data; domain-tagged) → 18-01 (helper) + 18-02 + 18-03 (consumers).
   - TRON-PREP-02 (preview_send Layer 0.7 — TRC-20 mandatory triggerconstantcontract; native no-sim advisory) → 18-04.
   - TRON-PREP-03 (send_transaction TRON branch with three-gate enforcement) → 18-04.
   - TRON-PREP-04 (USB-HID transport surfacing in get_tron_status) → Phase 17 wired; 18-04 consumes via `_tronLedgerTransport.signTransaction`.
   - TRON-PREP-05 (TRC-20 approve) → **EXPLICITLY OUT OF PHASE 18** per CONTEXT D-04 + ROADMAP Phase 19. Plans correctly defer.
   - TRON-W-01 (prepare_tron_native_send) → 18-02.
   - TRON-W-02 (prepare_tron_trc20_send) → 18-03.

   All 6 in-scope requirement IDs (PREP-01/02/03/04 + W-01/W-02) covered. TRON-PREP-05 (approve) correctly deferred to Phase 19.

2. **Wave-order soundness** — **PASS**.
   - 18-01 `depends_on=[]` wave 1.
   - 18-02 `depends_on=[18-01]` wave 2 — consumes `_tronFingerprint` + `PreparedTxTron` + `PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE` + `parseTronAmountStrict("u64")`.
   - 18-03 `depends_on=[18-01, 18-02]` wave 3 — consumes the same primitives + 18-02's register-all coordination + ref-block-encoder pattern.
   - 18-04 `depends_on=[18-01, 18-02, 18-03]` wave 4 — consumes ALL upstream primitives + both prepare tools.
   - Every plan declares `<parallel_eligible>none</parallel_eligible>`. **Strict-sequential chain confirmed.** Mirrors Phase 12 Solana chain shape.

3. **FROZEN-area discipline** — **PASS**.
   - Every plan asserts EVM-side `payload-fingerprint.ts` / `presign-hash.ts` / `simulation.ts` / `blocks.ts` / `amount.ts` / `canonical-dispatch.ts` byte-untouched (`git diff origin/main -- <path>` empty).
   - Solana siblings (`*-solana.ts`) likewise asserted byte-untouched.
   - 18-01 widens `handle-store.ts` ADDITIVELY (literal-union widening only — state machine + TTL + handle lifecycle BYTE-IDENTICAL). Mirrors Phase 12 Plan 12-01's additive shape.
   - 18-04 dispatcher widening in `preview_send.ts` + `send_transaction.ts` + `get_tx_verification.ts` is additive arm on existing `txType` switch — EVM + Solana branches BYTE-FROZEN.
   - **Three-gate FROZEN region** (`send_transaction.ts:210-340`) explicitly named in 18-04 as BYTE-IDENTICAL. Plan body documents the dispatcher widening lives BELOW the FROZEN range (~line 350+). Phase 12 Plan 12-05 set this precedent successfully.
   - **23-code `ErrorCode` union BYTE-FROZEN** — every plan asserts. Phase 18 reuses existing codes (`SIMULATION_REFUSED` 16 from Phase 12, `DISPATCH_TARGET_REFUSED` from v1.3, `LEDGER_REJECTED` / `BROADCAST_FAILED` / `LEDGER_NOT_CONNECTED` / `INVALID_INPUT` from earlier phases). Adds zero new codes.

4. **Test methodology** — **PASS**.
   - 18-01 ships NEW `test/signing-fingerprint-tron.test.ts` with Fixtures M + N as hardcoded `0x...` literals (NOT extending the FROZEN `test/signing-fingerprint.test.ts` Phase 8 anchor OR `test/signing-fingerprint-solana.test.ts` Phase 12 K + L anchor). NO `beforeAll`-snapshot per CLAUDE.md.
   - 18-02 cross-anchors Fixture M at `test/prepare-tron-native-send.test.ts` consumer site (load-bearing redundancy per CLAUDE.md fixture discipline).
   - 18-03 cross-anchors Fixture N at `test/prepare-tron-trc20-send.test.ts` consumer site.
   - 18-04 ships LOAD-BEARING `test/trust-pipeline-tron.integration.test.ts` with `[STOP-THE-LINE]` comment + persona-cycle byte-identity assertions for BOTH native + TRC-20 + three-gate FROZEN region regression + Layer 0.5 + Layer 0.7 + demo-mode + handle TTL + get_tx_verification re-emit regression. **13+ test cases** per the plan body — comparable depth to Phase 12's 15-test integration suite.
   - Per-plan unit tests cover encoder byte-stability + decoder shape regression + ESM spy-affordance regression.

5. **Research-finding propagation (D-01..D-12)** — **PASS** with one research-driven CORRECTION:
   - **D-01** ✓ — 18-01 implements `keccak256("VaultPilot-trontx-v1:" ‖ rawDataBytes)`; domain tag 21 UTF-8 bytes.
   - **D-02** ✓ — 18-01 implements SHA-256 of `rawDataBytes`; RESEARCH §Topic 4 confirms TRON consensus tx-id IS this hash; integration test cross-verifies `presignHash.slice(2) === transaction.txID`.
   - **D-03** ✓ — 18-01 simulation-tron.ts classifier-vs-consumer split; 18-04 consumer enforces TRC-20 mandatory + native advisory asymmetry.
   - **D-04** ✓ — 18-01 ships `LEDGER_NOTICE_TRON_TEMPLATE` pre-staged for Phase 19+; 18-04 emits conditionally (Phase 18 stablecoin set in bundled registry, no emit).
   - **D-05** ✓ — 18-03 + 18-04 assert sender-dependent fingerprint for BOTH native + TRC-20 (owner_address in Protobuf preimage; calldata `to` is invariant — defense-in-depth check per CONTEXT D-05b).
   - **D-06a** ✓ — 18-02 + 18-03 read ref-block via tronweb's `transactionBuilder.*` (which calls `getBlock("latest")` internally).
   - **D-06b CORRECTED** — RESEARCH §Topic 5 surfaced that tronweb's default `expiration` is 60 seconds, NOT 1 hour. CONTEXT D-06b ambiguously framed "1-hour ref-block window > 15-min TTL" — research confirms this is the TAPOS replay window, NOT the transaction expiration. **Plans 18-02 + 18-03 MUST call `extendExpiration(tx, 900)` after `transactionBuilder.*` returns** so expiration matches handle TTL. ✓ This is documented in both plan bodies (18-02 step 1 sub-step 2 + 18-03 step 1 sub-step 2) AND in the LOAD-BEARING regression test (`assert tronWeb.transactionBuilder.extendExpiration was called with (tx, 900)`). See FLAG-2 below for the upstream-doc fix.
   - **D-06c** ✓ — 18-04 widens `get_tx_verification` with `blockHeader` + `refBlockHash` + `rawDataHex`.
   - **D-07** ✓ — 18-01 `parseTronAmountStrict(amountStr, decimals, overflowBound: "u64" | "u256")`; consumers in 18-02 (native, u64) + 18-03 (TRC-20, u256).
   - **D-08** ✓ — 18-01 ships Fixtures M + N as hardcoded literals (CONTEXT D-08a/b/c/d propagated).
   - **D-09** ✓ — NEW sibling test files; EVM + Solana test files BYTE-UNTOUCHED.
   - **D-10** ✓ — 18-04 `sendTransactionTron` via `tronweb.trx.sendRawTransaction`; three-gate FROZEN region BYTE-IDENTICAL.
   - **D-11** ✓ — 18-01 ships `canonical-dispatch-tron.ts` (4-entry stablecoin allowlist from `tron-top-25.json`); 18-04 wires Layer 0.5 at preview_send TRON branch; native skips.
   - **D-12** ✓ — 18-04 SECURITY.md TRON section with 6 sub-sections per CONTEXT D-12a (USB-HID + Protobuf-vs-RLP + SHA-256-vs-keccak256 + TRX clear-sign coverage + Layer 0.7 asymmetry + ref-block/expiration window).

6. **`feePayer`-equivalent in preimage (sender-dependence)** — **PASS**. 18-RESEARCH §Topic 1 confirms `owner_address` is in `TransferContract` Protobuf preimage (TRON's `owner_address` is the analog of Solana's `feePayer`). 18-03 + 18-04 integration tests assert sender-dependent fingerprint for BOTH native AND TRC-20 (CONTEXT D-05a/b correctly captured).

7. **`tokenSignatures: []` on `signTransaction`** — **PASS**. RESEARCH §Topic 2 + CONTEXT D-04a confirm Phase 18's stablecoin set is in the TRX app's bundled token registry (USDT/USDC/USDD/TUSD); empty `tokenSignatures` array is valid. 18-04 passes `tokenSignatures: []` at sign time. Phase 19's TRC-20 approve may extend this surface for non-bundled tokens.

8. **TriggerSmartContract over raw transfer calls** — **PASS**. 18-03 explicitly uses `transactionBuilder.triggerSmartContract` with `transfer(address,uint256)` ABI; NEVER inlines selector encoding manually. RESEARCH §Topic 8 confirms TRC-20 calldata is ABI-identical to ERC-20 at the calldata level.

9. **`txHash` field type** — **PASS**. Phase 12 already widened `handle-store.ts`'s `txHash: Hex → string` for Solana cross-chain compat. TRON tx-id is hex (no `0x` prefix per TRON convention) — fits the widened `string` type without further changes. 18-04 surfaces `txHash: result.txid` (raw hex string per TRON convention) AND `txID: result.txid` (TRON-name alias for ergonomic agent-side use).

10. **Domain-tag byte length** — **PASS, plans canonically correct at 21 bytes**. `Buffer.byteLength("VaultPilot-trontx-v1:", "utf8") === 21` (verified by character count: `V·a·u·l·t·P·i·l·o·t·-·t·r·o·n·t·x·-·v·1·:` = 21). 18-01 + 18-RESEARCH + 18-PATTERNS all correctly state 21 bytes. Phase 12 had RESEARCH/PATTERNS drift on the Solana 20-byte count (RESEARCH said "22"/"21") that the planner caught and corrected; Phase 18's drafts agree on 21 from the start.

## Per-plan verdicts

- **18-01: PASS** — TRON primitives shelf + Fixtures M + N + handle-store discriminator widening + canonical-dispatch-tron + amount-tron with dual-overflow guard. ZERO modifications to FROZEN files; 1 additive modification to `handle-store.ts`. `_tronFingerprint` + `_tronPresign` + `_simulationTron` + `_canonicalDispatchTron` ESM spy-affordances all present. 23-code error-codes union BYTE-FROZEN (no additions).

- **18-02: PASS** — `prepare_tron_native_send` + `tron-native` encoder/decoder + register-all wiring (1 additive line). `extendExpiration(tx, 900)` enforced post-`sendTrx` per LOAD-BEARING RESEARCH §Topic 5 finding. Overflow guard on `sun > Number.MAX_SAFE_INTEGER` before tronweb truncation (Phase 17 Pitfall 1 reuse). Fixture M consumer re-anchor at test site. Demo + real mode resolution mirrors Phase 12 Plan 12-02 pattern.

- **18-03: PASS** — `prepare_tron_trc20_send` + `tron-trc20` encoder/decoder + register-all wiring (1 additive line, adjacent to 18-02's). `feeLimit: 100_000_000, callValue: 0` hardcoded per CONTEXT D-11 + RESEARCH §Topic 3. ABI selector regression test pins `0xa9059cbb`. Fixture N consumer re-anchor. Persona-cycle sender-dependence mini-regression. `extendExpiration(tx, 900)` enforced.

- **18-04: PASS** — `preview_send` + `send_transaction` + `get_tx_verification` TRON branches additive; three-gate FROZEN region BYTE-IDENTICAL. Layer 0.5 canonical-dispatch + Layer 0.7 mandatory-vs-advisory simulation asymmetry correctly enforced. SECURITY.md TRON section APPEND-ONLY with 6 sub-sections. LOAD-BEARING integration test ships with `[STOP-THE-LINE]` comment + 13+ test cases covering persona-cycle, three-gate, Layer 0.5, Layer 0.7, demo, handle TTL, get_tx_verification re-emit. **One FLAG below**: 18-04 LEDGER_NOTICE_TRON_TEMPLATE emit logic could be slightly tighter — currently the body has `const ledgerNoticeBlock = record.tx.kind === "trc20" ? "" : ""` which always renders empty for Phase 18; if the bundled-registry check ever needs to fire dynamically, the wiring needs a real predicate. Documented inline as Phase 19+ extension surface — see FLAG-1.

## BLOCKERs (must replan before execute)

**None.**

## FLAGs (cheap inline fixes before execute)

1. **18-04 `LEDGER_NOTICE_TRON_TEMPLATE` emit logic is a static-empty placeholder.** Plan 18-04 body sketches:
   ```typescript
   const ledgerNoticeBlock = record.tx.kind === "trc20"
     ? "" // Phase 18 TRC-20 set is in bundled registry — no NOTICE needed
     : ""; // native TransferContract clear-signs unconditionally
   ```
   This is correct for Phase 18 (all 4 stablecoins in bundled registry; native clear-signs). But the template is pre-staged for Phase 19+ consumers (CONTEXT D-04c). **Fix**: Either (a) drop the variable entirely in 18-04 (since both branches emit empty string; emit nothing inline at the `responseText` join site), OR (b) add a one-line predicate function `function shouldEmitTronLedgerNotice(record: PreparedTxTron): { emit: boolean; reason: string }` that returns `{ emit: false, reason: "Phase 18 set in bundled registry" }` for now; Phase 19 widens the predicate when approve / Stake 2.0 calls land. Recommend (b) — the predicate is the cleaner extension surface for Phase 19+ and surfaces the NOTICE-deferral decision in code.

2. **ROADMAP Phase 18 SC #6 names "Fixture K + L in `test/signing-fingerprint.test.ts`"; plans correctly use "Fixture M + N in NEW sibling `test/signing-fingerprint-tron.test.ts`"** per CONTEXT D-08 + PATTERNS meta-decision #4. K + L are Phase 12 Solana fixtures (already taken). The ROADMAP entry has stale fixture names + stale file path. **Fix**: at execute-phase sign-off, update ROADMAP line 437 + Phase 18 success criterion #6 to say:
   > Fixture M (native TRX transfer fingerprint) + Fixture N (TRC-20 transfer fingerprint) hardcoded as `0x...` literals in NEW sibling `test/signing-fingerprint-tron.test.ts` (NOT the FROZEN `test/signing-fingerprint.test.ts` Phase 8 anchor; mirrors Phase 12's K + L carve into `test/signing-fingerprint-solana.test.ts`). Cross-linked from `prepare-tron-*` consumer tests.

   This is upstream-document hygiene, same pattern as Phase 12 Plan-Check Flag 3 (ROADMAP SC #7 referenced I + J + `test/signing-fingerprint.test.ts`; plans correctly used K + L in sibling file).

3. **ROADMAP Phase 18 framing "TRON's 1-hour ref-block window" (line 443) conflates TAPOS with expiration.** RESEARCH §Topic 5 surfaced that tronweb's default `expiration` is 60 seconds (NOT 1 hour); the 1-hour figure refers to the TAPOS replay window. Plans 18-02 + 18-03 correctly extend expiration to 900 seconds via `extendExpiration(tx, 900)` to match handle TTL — load-bearing finding documented in PATTERNS §Risk surface + each prepare-plan body. **Fix**: update ROADMAP line 443 (Phase 18 Plan 18-02 sub-entry) to:
   > 18-02: `prepare_tron_native_send` + TRON `PREPARE RECEIPT` template + `src/protocols/tron-native.ts` (TransferContract Protobuf encoder via tronweb); ref-block read via `getBlock("latest")` (tronweb internal) + **extended expiration via `transactionBuilder.extendExpiration(tx, 900)` per RESEARCH §Topic 5 — tronweb's default 60s expiration would expire before 15-min handle TTL**.

   This is upstream-document hygiene — plans + RESEARCH correctly capture the finding; ROADMAP language needs the same correction.

## NITs (record-only)

1. **18-01 step 6 (`canonical-dispatch-tron.ts`) hardcodes 4 base58 contract literals in the plan body** for documentation purposes. The actual implementation should read from `src/tokens/tron-top-25.json` at module load (the plan body says "pull these literal addresses from `src/tokens/tron-top-25.json` rather than hardcoding") — make sure the executor honors this on write. If the JSON's schema doesn't expose a `tokenAddress` field by the contract address (e.g. JSON keys are symbols not addresses), add a filter helper. No execute-time impact if executor reads the plan body carefully.

2. **18-04 dispatcher widening sketch in plan body is illustrative pseudocode** (e.g. `else if (txType === "tron")` syntax). The actual `preview_send.ts` + `send_transaction.ts` files use slightly different patterns (e.g. `if (txType === "solana") { return previewSendSolana(...); }` followed by an unconditional EVM return). Plan body's pseudocode preserves the dispatch INTENT (route TRON to TRON branch; EVM body unchanged); executor should match the existing style of the dispatcher block. No execute-time impact.

## Cross-plan concerns

- **`record.tx.rawDataObject: unknown` typing**: 18-01 widens `PreparedTxTron` with `rawDataObject: unknown`. Plan 18-04 `sendTransactionTron` reads this back to reconstruct the broadcast envelope. The `unknown` type means consumers MUST narrow (or cast) — defensible per RESEARCH §Topic 7 (tronweb's internal `raw_data` shape is SDK-version-dependent; widening to a typed shape would couple us to a specific tronweb minor version). Document at write time that the cast is a load-bearing trust assumption.

- **Demo-mode TRON broadcast envelope**: 18-04 `buildTronDemoSimulationResponse` is sketched but not detailed. The full body should mirror Phase 12 + Phase 5 patterns — re-run the simulation envelope shape from preview as the response; surface `[DEMO MODE]` advisory block. Add detail at write time.

- **`extendExpiration` test mock coordination**: 18-02 + 18-03 both call `extendExpiration(tx, 900)`. The mock setup in tests needs to either (a) stub `tronWeb.transactionBuilder.extendExpiration` to a pass-through that doesn't modify `tx` (keeping `expiration` at the original mocked value) OR (b) advance `expiration` by 900_000ms in the mock so the assertion `expiration === originalExpiration + 900_000` lines up. Choose (b) — matches production behavior. Document at write time.

- **`sendTransactionTron` reuses `record.payloadFingerprint` as `txID`** — the `signedTransaction` envelope's `txID` field is set to `record.payloadFingerprint.slice(2)`. **WAIT — this is WRONG**. `payloadFingerprint` is `keccak256(domain-tag ‖ raw_data)`; TRON's `txID` is `SHA-256(raw_data)` (= `presignHash`). 18-04 should use `record.pinned!.presignHash.slice(2)` for the `txID` field, NOT `record.payloadFingerprint.slice(2)`. **CROSS-PLAN CONCERN BLOCKER**: Fix the field source in 18-04 step 2c at execute time. See FLAG-1.5 below.

## FLAG-1.5 (cheap inline-fix, found during cross-plan review)

**18-04 `sendTransactionTron` envelope `txID` field source** — Plan body sketches:
```typescript
const signedTransaction = {
  visible: true,
  txID: record.payloadFingerprint.slice(2),  // strip 0x prefix; TRON tx-id == SHA-256(raw_data) hex
  raw_data: record.tx.rawDataObject,
  raw_data_hex: record.tx.rawDataHex,
  signature: [signature],
};
```

But `record.payloadFingerprint` is `keccak256(domain-tag ‖ raw_data)` (the VaultPilot binding hash), NOT the TRON tx-id (which is `SHA-256(raw_data)` per RESEARCH §Topic 4). The plan body's comment is RIGHT (TRON tx-id == SHA-256(raw_data)), but the FIELD SOURCE is wrong. **Fix**: change `txID: record.payloadFingerprint.slice(2)` → `txID: record.pinned!.presignHash.slice(2)` (the presign hash IS the SHA-256 = TRON tx-id). Cross-reference: `record.pinned.presignHash` is populated by Plan 18-04's previewSendTron at line 5 step 1 ("Recompute presign hash for LEDGER BLIND-SIGN HASH block").

This is a one-line correction. Surface as inline FLAG, not BLOCK — the plan's RESEARCH §Topic 4 quote + RESEARCH §Topic 7 envelope shape get this right; the plan body has a one-line transcription drift that the executor would catch at typecheck time anyway (`record.payloadFingerprint` vs `record.pinned.presignHash` would compile but produce a wrong `txID` field; tronweb broadcast may accept it because the TronGrid backend recomputes the tx-id from raw_data and uses ITS computed value, not the client-supplied `txID` — but the user-facing `LEDGER BLIND-SIGN HASH` block + `txHash` response field would then disagree with the chain's actual txid; tamper signal for an honest send).

**Recommended inline fix during execute**: change one line in 18-04 `sendTransactionTron` to use `record.pinned!.presignHash`.

## FLAGs (consolidated count)

- **FLAG-1**: LEDGER_NOTICE_TRON_TEMPLATE emit logic placeholder cleanup (cosmetic; recommendation (b) ships a predicate function for Phase 19+ extension).
- **FLAG-1.5**: `sendTransactionTron` envelope `txID` field source — change `record.payloadFingerprint.slice(2)` → `record.pinned!.presignHash.slice(2)`. ONE LINE.
- **FLAG-2**: ROADMAP Phase 18 SC #6 stale fixture names (K + L → M + N) + stale file path (`test/signing-fingerprint.test.ts` → `test/signing-fingerprint-tron.test.ts`). Upstream-doc hygiene.
- **FLAG-3**: ROADMAP Phase 18 Plan 18-02 entry stale framing ("TRON's 1-hour ref-block window") — should name `extendExpiration(tx, 900)` per RESEARCH §Topic 5. Upstream-doc hygiene.

**3 FLAGs (FLAG-1, FLAG-2, FLAG-3) for upstream-doc cleanup + 1 inline-fix code correction (FLAG-1.5).** None block execute.

## NIT count: 2 (record-only).

## Iteration count: 1 (no replan triggered).

---

## Recommended actions before `/gsd-execute-phase 18`:

1. **FLAG-1.5 (inline-fixed in this artifact set)**: 18-04 `sendTransactionTron` envelope `txID` field source corrected from `record.payloadFingerprint.slice(2)` → `record.pinned!.presignHash.slice(2)` per RESEARCH §Topic 4 — TRON consensus tx-id IS the SHA-256 presign hash, NOT the keccak256 binding fingerprint. The inline correction includes a cross-reference comment.
2. **FLAG-1 (inline-fixed in this artifact set)**: 18-04 `ledgerNoticeBlock` static-empty ternary replaced with `shouldEmitTronLedgerNotice(tx)` predicate function (defined inline in 18-04 plan body). Phase 18 cases all return `{ emit: false }`; Phase 19+ extends the predicate when approve/stake/swap variants land. Pre-staged extension surface.
3. **Upstream-doc FLAG-2 + FLAG-3**: at execute-phase sign-off (NOT now), update ROADMAP Phase 18 Plan 18-02 + SC #6 entries to match the corrected fixture names (M + N in NEW sibling file) + expiration framing (extended via `extendExpiration(tx, 900)`).

**FLAG-1 + FLAG-1.5 inline-fixed; FLAG-2 + FLAG-3 are upstream-doc hygiene scheduled for execute-phase sign-off.** Plans are execute-ready.

---

*Phase 18 plan-check complete.*
*4 plans + 2 supporting artifacts (PATTERNS + RESEARCH) deliver TRON-PREP-01..04 + TRON-W-01/W-02 + load-bearing trust pipeline.*
*Strict-sequential chain confirmed; FROZEN-area discipline verified; CONTEXT D-01..D-12 propagated with one research-driven correction (D-06b extended-expiration).*
*Goal-backward verification against ROADMAP Phase 18's 7 Success Criteria: all 7 covered (#6 with documented fixture-name correction per CONTEXT D-08).*
