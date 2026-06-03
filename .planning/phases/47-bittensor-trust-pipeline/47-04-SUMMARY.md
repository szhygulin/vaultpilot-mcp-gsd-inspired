---
phase: 47
plan: 04
subsystem: signing
tags: [bittensor, send-transaction, ed25519, addSignature, trust-pipeline, frozen-region]
requires: ["47-01", "47-02", "47-03"]
provides:
  - signBittensorTransaction + signWithMetadataEd25519ViaApp (transport seam)
  - send_transaction Bittensor arm (TAO-PREP-03 — 3 gates + ed25519 assembly + broadcast)
  - bittensor-trust-pipeline integration test (TAO-PREP-03 / TAO-W-05)
affects:
  - src/tools/send_transaction.ts (additive recompute-ternary arm + dispatch case + branch; three-gate region byte-unchanged)
  - src/wallet/ledger-bittensor-transport.ts (additive sign helper + _transport seam widening; Phase 46 pairing path byte-unchanged)
  - test/_helpers/mock-bittensor-api.ts (additive send-path widening; backward-compatible)
tech-stack:
  added: []
  patterns: [additive send-branch (mirror sendTransactionTronBranch), ed25519 detached-sig assembly via tx.addSignature, _transport spy seam, synthetic-sig unit assertion, persona-cycle byte-identity re-anchor]
key-files:
  created:
    - test/bittensor-trust-pipeline.integration.test.ts
  modified:
    - src/wallet/ledger-bittensor-transport.ts
    - src/tools/send_transaction.ts
    - test/_helpers/mock-bittensor-api.ts
decisions:
  - "A5 (addSignature payload-arg form): pass the pinned signerPayloadJSON (ExtrinsicPayloadValue form) with a try/catch fallback to the raw signableBlob hex; a wrong form surfaces as BadProof→BROADCAST_FAILED, never silently swallowed."
  - "txMetadata for signWithMetadataEd25519: empty Uint8Array for mode:0 (CheckMetadataHash disabled — the v2.7 GA pin); the metadataHash bytes for mode:1 (wired-but-gated)."
  - "OQ-1 (limit_price direction): the send arm passes the prepared limitPrice through UNCHANGED (it lives inside the pinned call hex); direction was 47-02's concern, resolved there (add=ceiling, remove=floor)."
  - "send_transaction FROZEN zero-deletion: getActiveBittensorPersona added on its OWN import line so the existing demo-state import stays byte-identical (the committed test asserts ZERO deletion markers in the whole-file diff, not just the three-gate region)."
metrics:
  duration: ~45min
  completed: 2026-06-03
---

# Phase 47 Plan 04: Bittensor Send Arm + ed25519 Assembly Summary

The final send leg of the Bittensor trust pipeline (TAO-PREP-03 + TAO-W-05): the `signWithMetadataEd25519` transport wrapper, the ADDITIVE `send_transaction` Bittensor arm (three FROZEN gates byte-unchanged → ed25519 detached-sig assembly → `author.submitExtrinsic` broadcast), and the full prepare→preview→send integration test proving the ed25519 assembly + the persona-cycle byte-identity re-anchor. No private key material crosses this codebase — the device returns only a detached 64-byte signature.

## What was built

- **`ledger-bittensor-transport.ts`** (Task 1, additive) — `_transport.signWithMetadataEd25519ViaApp(app, path, txBlob, txMetadata)` (the non-deprecated `*Ed25519` variant; `signWithMetadata` non-suffixed is `@deprecated` in 2.3.4). `signBittensorTransaction({ signableBlob, txMetadata, derivationPath })` opens a fresh transport → builds the generic app → probes `getVersion()` (throw → `LedgerBittensorAppNotOpenError`) → signs → closes-in-`finally`. The `txBlob` is `record.tx.signableBlob` VERBATIM (T-47-11 — the device signs the fingerprint preimage). New `LedgerBittensorUserRejectedError` sibling (maps `0x6986`/`/reject/i`). The Phase 46 pairing path (`fetchBittensorAddress`) is byte-unchanged.
- **`send_transaction.ts`** (Task 2, additive) —
  - Recompute ternary: ADD `txType === "bittensor"` arm → `computeBittensorPayloadFingerprint({ signableBytes: signableBlob })` before the EVM default. The drift gate recomputes over the **STORED** `signableBlob` (T-47-10). The `PAYLOAD_FINGERPRINT_DRIFT` envelope/errorCode/message are byte-identical.
  - Dispatch switch: ADD `if (txType === "bittensor") return sendTransactionBittensorBranch(...)`.
  - `sendTransactionBittensorBranch` (mirrors `sendTransactionTronBranch`): demo short-circuit (advisory envelope, NOTHING signed) → pairing (`chainFilter: "bittensor"`) → rebuild the `SubmittableExtrinsic` from the pinned `signerPayloadJSON.method` via `api.tx(methodHex)` → sign the STORED blob via the Ledger Generic app → `sigHex = "0x00" + u8aToHex(sig).slice(2)` (`'0x00'` = `MultiSignature::Ed25519`) → `tx.addSignature(ss58Address, sigHex, payload)` → `api.rpc.author.submitExtrinsic(signedTx.toHex())` → `transitionToSent(handle, extrinsicHash)`. Device-error mapping: not-connected → `LEDGER_NOT_CONNECTED`; app-not-open / user-reject → `LEDGER_REJECTED`; broadcast failure → `BROADCAST_FAILED`. A defensive 64-byte signature-length check.
- **`bittensor-trust-pipeline.integration.test.ts`** (Task 3) — full prepare→preview→send for `add_stake_limit` (fp = Fixture TAO-B), everything mocked at the indirection seams (NO live RPC socket, NO real device — the anti-hang discipline). Proves: (1) happy path — the device signs the STORED blob verbatim, `addSignature` is called with `"0x00"+<synthetic 64-byte sig>`, a well-formed signed hex reaches `submitExtrinsic`; (2) the three FROZEN gates refuse identically (`PREVIEW_REQUIRED` / `PREVIEW_TOKEN_MISMATCH` / STORED-fingerprint `PAYLOAD_FINGERPRINT_DRIFT` — the EVM Test-4 attack model) with NO device sign on any refusal; (3) the cancel path; (4) the **persona-cycle re-anchor** — the unsigned-payload fingerprint is byte-identical across two different paired persona senders (sender-INDEPENDENT Substrate binding; contrast Solana whose feePayer is in the bytes).
- **`mock-bittensor-api.ts`** (additive) — widened for the send path: `tx` is now callable (`api.tx(hex)` → `addSignature`/`toHex`) while retaining the section/method factories (builder path); added `rpc.author.submitExtrinsic` + `rpc.system.dryRun`. Prepare tests stay green (backward-compatible).

## Open-question / assumption resolutions (with evidence)

- **A5 (addSignature payload-arg form):** RESOLVED. `.d.ts` accepts `ExtrinsicPayloadValue | Uint8Array | HexString`. We pass the pinned `signerPayloadJSON` object (the `ExtrinsicPayloadValue` form — it carries the exact era/nonce/tip/mode/metadataHash the blob was built from). Wrapped in a try/catch: a throw on the object form falls back to the raw `signableBlob` hex. Falsifier: a wrong form yields a `BadProof` at broadcast → surfaced as `BROADCAST_FAILED`, never swallowed. (The integration test exercises the object form; the real-runtime `BadProof` falsifier is a v2.7 verify-phase item — a synthetic mock cannot reproduce consensus-level `BadProof`.)
- **OQ-1 (limit_price direction):** the send arm passes the prepared `limitPrice` through UNCHANGED — it lives inside the pinned call hex (`signerPayloadJSON.method`), which the send arm rebuilds verbatim via `api.tx(methodHex)`. Direction (add=ceiling, remove=floor) was 47-02's concern, resolved there.
- **A3 (mode:0 mainnet acceptance) + the on-device blake2 hash match:** VERIFY-PHASE items (real Ledger). Unit tests use a synthetic 64-byte signature per the 47-VALIDATION Manual-Only note.

## Tasks completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | signWithMetadataEd25519 wrapper + signBittensorTransaction | 41aa2bf | ledger-bittensor-transport.ts |
| 2 | send_transaction additive Bittensor arm + ed25519 assembly | c7cfeae | send_transaction.ts |
| 3 | trust-pipeline integration test + mock send-path widening | cb75410 | integration test + mock helper + send_transaction import-line fix |

## Deviations from Plan

- **[Rule 3 — Blocking issue] send_transaction FROZEN zero-deletion.** The committed `test/signing-fingerprint-bittensor.test.ts` FROZEN describe block asserts the `send_transaction.ts` whole-file diff has ZERO deletion markers (not just the three-gate region). The initial Task-2 edit appended `getActiveBittensorPersona` to the existing demo-state import line, which registered as a `-`/`+` pair → the test failed. Fixed by moving `getActiveBittensorPersona` to its OWN additive import line, leaving the existing import byte-identical. Diff is now purely additive. Fixed in commit cb75410.
- **No `txMetadata` / `signerPayloadRaw` fields on `PreparedTxBittensor`** (vs the plan's interface sketch naming `signerPayloadRaw`). The handle stores `signerPayloadJSON` (the `ExtrinsicPayloadValue` source) + `signableBlob`; the send arm derives the `txMetadata` (empty for mode:0) and uses `signerPayloadJSON` as the `addSignature` payload. No interface change needed — the existing 47-01 fields suffice. Documented, not a structural deviation.

## Threat-model coverage

- **T-47-10** (unsigned-payload tamper prepare→send): the drift gate recomputes the fingerprint over the STORED `signableBlob` before any device call → `PAYLOAD_FINGERPRINT_DRIFT`. Integration-tested (the EVM Test-4 STORED-mutation attack model; NO device sign on refusal).
- **T-47-11** (wrong bytes to device vs preimage): `signBittensorTransaction` passes `record.tx.signableBlob` VERBATIM. Integration-tested (`signArgs[2] === storedBlob`, same reference).
- **T-47-13** (private key in codebase): the device returns ONLY the detached 64-byte sig; `addSignature` assembles; no secret crosses any boundary.
- **T-47-FROZEN** (three-gate region + sibling arms): additive-only — `git diff origin/main` zero-deletion verified; the EVM three-gate regression `test/send-transaction.test.ts` green (19/19, incl. the stored-fingerprint-mutation attack).

## TDD Gate Compliance

This plan is `type: execute` (not `type: tdd`). The integration test is written alongside the implementation; the FROZEN binding-module fixtures (TAO-A/B/C) were pinned in 47-01/47-02. Behavior is asserted by the integration + EVM-regression suites.

## Verification

- `npx tsc --noEmit` — RC=0
- Full bittensor sweep (fingerprint 14 + presign 3 + native 5 + add 3 + remove 2 + dispatch 9 + simulation 6 + integration 6) — **48 passed**
- EVM regression `test/send-transaction.test.ts` — **19 passed** (FROZEN three-gate + stored-fingerprint-mutation attack)
- FROZEN binding modules (`payload-fingerprint{,-solana,-tron}.ts`, `presign-hash{,-solana}.ts`) — **ZERO diff** vs origin/main
- `send_transaction.ts` + `ledger-bittensor-transport.ts` — **additive-only** (zero deletion markers)
- No live RPC/WsProvider/ApiPromise/transport constructed in any test (anti-hang held — integration suite 33–44ms)

## Known Stubs

None that block the plan's goal. The real 64-byte device signature + the on-device blake2-256 hash match + mode:0-vs-mode:1 mainnet acceptance are v2.7 real-Ledger verify-phase captures (47-VALIDATION Manual-Only) — intentional, by design, not stubs in the codebase.

## Residual risk (carry to SECURITY.md / v2.7 close-out)

- **Blind-sign residual (TAO-W-05):** the Polkadot Generic app may blind-sign the Bittensor payload on devices without clear-sign metadata. The trust anchors are the preview-emitted blake2-256 hash (the user verifies it on-device) + the chain-enforced `CheckMetadataHash`. The companion preflight skill + the real-Ledger clear-sign verify-phase are the v2.7 close-out / Phase 49 items.

## Self-Check: PASSED

- FOUND: src/wallet/ledger-bittensor-transport.ts (signBittensorTransaction, signWithMetadataEd25519ViaApp, LedgerBittensorUserRejectedError)
- FOUND: src/tools/send_transaction.ts (sendTransactionBittensorBranch, computeBittensorPayloadFingerprint, author.submitExtrinsic, addSignature)
- FOUND: test/bittensor-trust-pipeline.integration.test.ts
- FOUND: commits 41aa2bf, c7cfeae, cb75410
