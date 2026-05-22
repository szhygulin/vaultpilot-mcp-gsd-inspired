---
phase: "24"
plan: "02"
subsystem: "btc-signing"
tags: ["bitcoin", "bip137", "message-signing", "ledger", "direct-sign", "bip-137"]
dependency_graph:
  requires:
    - "24-01"  # signBtcMessage added to ledger-btc-transport.ts (extends _btcLedgerTransport)
    - "23-03"  # prepare_btc_send + PSBT pipeline (Phase 23)
  provides:
    - "BTC-W-03"  # sign_message_btc tool — BIP-137 compact message signing
  affects:
    - "src/wallet/ledger-btc-transport.ts"  # signBtcMessage + _btcLedgerTransport extension
    - "src/signing/blocks-btc.ts"           # LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE appended
    - "src/tools/register-all.ts"           # sign_message_btc.js import added
tech_stack:
  added: []
  patterns:
    - "BIP-137 double-SHA256 message hash via @noble/hashes/sha256 (transitive dep)"
    - "65-byte compact signature: [header=v+39][32 r][32 s] for P2WPKH bech32"
    - "Direct-sign tool pattern (no handle, no prepare/preview/send pipeline)"
    - "_btcLedgerTransport ESM spy-affordance extended with signBtcMessage"
key_files:
  created:
    - "src/tools/sign_message_btc.ts"
    - "test/signing-bip137.test.ts"
    - "test/tools-sign-message-btc.test.ts"
  modified:
    - "src/wallet/ledger-btc-transport.ts"  # signBtcMessage exported + _btcLedgerTransport extended
    - "src/signing/blocks-btc.ts"           # LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE appended
    - "src/tools/register-all.ts"           # sign_message_btc.js import
decisions:
  - "Demo mode → DEMO_MODE_REFUSED (not WRONG_MODE): direct-sign tools have no persona fallback"
  - "Wallet-not-matched → INVALID_INPUT (not WALLET_NOT_PAIRED): the wallet arg is invalid for this server's paired accounts"
  - "MESSAGE_MAX_BYTES = 256: covers KYC nonces and login challenges; stays well within varint uint16 range"
  - "Fixture W = 0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e (double-SHA256, NOT keccak256)"
  - "signBtcMessage uses positional-arg form app.signMessage(path, messageHex) — Btc wrapper routes to BtcNew internally"
metrics:
  duration: "~35 min"
  completed: "2026-05-22T16:39:00Z"
  tasks: 3
  files: 6
---

# Phase 24 Plan 02: `sign_message_btc` — BIP-137 Message Signing Summary

BIP-137 compact message signing via the Ledger BTC app: `sign_message_btc({ wallet, message })` produces a 65-byte base64 signature over the segwit address without any prepare/preview/send pipeline (direct-sign, no handle).

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 0 | Failing test scaffolds + Fixture W anchor | 6006c26 | test/signing-bip137.test.ts, test/tools-sign-message-btc.test.ts |
| 1 | signBtcMessage + LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE | 051dab8 | ledger-btc-transport.ts, blocks-btc.ts |
| 2 | Implement sign_message_btc tool | 8374f3a | sign_message_btc.ts, register-all.ts |

## Key Decisions Made

1. **DEMO_MODE_REFUSED (not WRONG_MODE)**: `sign_message_btc` is a direct-sign tool with no demo-mode persona fallback. Unlike `prepare_btc_send` (which uses a BTC persona for PSBT simulation), message signing strictly requires a physical Ledger device. `DEMO_MODE_REFUSED` is the correct refusal code.

2. **Wallet not matched → INVALID_INPUT**: When the `wallet` arg is a valid bech32 address but doesn't match any paired account, the refusal uses `INVALID_INPUT` (the wallet argument is invalid for this server's state — it may be a real BTC address but we don't have a key for it). This is distinct from `WALLET_NOT_PAIRED` (no accounts at all).

3. **MESSAGE_MAX_BYTES = 256**: Caps the message at 256 UTF-8 bytes. This covers all practical use cases (KYC nonces, login challenges, ownership attestations) while staying within Ledger device display constraints. The varint encoding supports up to 0xffff bytes but device+agent constraints make 256 sensible.

4. **Fixture W = 0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e**: Pinned as a hardcoded literal in `test/signing-bip137.test.ts` (NOT a beforeAll-snapshot) and cross-linked from `test/tools-sign-message-btc.test.ts`. Annotated clearly as double-SHA256, NOT keccak256 payloadFingerprint.

5. **Positional-arg form for `app.signMessage`**: The `Btc` wrapper class (returned by `buildBtcApp`) exposes `signMessage(path, messageHex)` with positional args. It routes to `BtcNew.signMessage({ path, messageHex })` internally for `currency: "bitcoin"`. Using the wrong named-arg form would have caused a type/runtime error.

## Deviations from Plan

None — plan executed exactly as written.

## Fixture W Cross-Link

Fixture W = `0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e`

BIP-137 double-SHA256 message hash for `"Hello VaultPilot"` (16 UTF-8 bytes).
Preimage: `[0x18] ‖ "Bitcoin Signed Message:\n" ‖ [0x10] ‖ "Hello VaultPilot"` (42 bytes).
Hash: SHA-256(SHA-256(preimage)).

Pinned in `test/signing-bip137.test.ts` (commit 6006c26) and re-anchored in `test/tools-sign-message-btc.test.ts` (commit 8374f3a, `messageHash` field assertion).

## Threat Mitigations Implemented

| Threat ID | Mitigation |
|-----------|-----------|
| T-24-07 | Device applies magic prefix internally; a BIP-137 message signature is non-spendable by Bitcoin consensus (LEDGER BLIND-SIGN HASH block surfaces message text for user inspection) |
| T-24-08 | Test asserts `messageHex` passed to device contains NO `"Bitcoin Signed Message:\n"` hex substring; raw bytes only |
| T-24-09 | Server computes double-SHA256 hash independently and surfaces it in LEDGER BLIND-SIGN HASH block; Fixture W pins the computation |
| T-24-10 | Unit test pins `header = v + 39` for v=0→39 and v=1→40; 65-byte length asserted |
| T-24-11 | Tool resolves derivation path ONLY from matching paired account; unmatched wallet refused with INVALID_INPUT |

## Test Summary

| Test file | Tests | Status |
|-----------|-------|--------|
| test/signing-bip137.test.ts | 9 | PASS |
| test/tools-sign-message-btc.test.ts | 14 | PASS |
| Full suite | 2829 pass / 3 pre-existing flaky | Pre-existing flaky: wallet-session-manager (timing-sensitive, passes in isolation) |

## Known Stubs

None. The tool is fully wired: input validation → demo-mode check → pairing check → server-side hash computation → device APDU call → compact signature assembly → structured response.

## Threat Flags

None. No new network endpoints, no new auth paths, no new trust boundaries. The `signBtcMessage` function follows the same `openTransport` + try/finally pattern as `signBtcPsbt` — established Phase 23 pattern.

## Self-Check: PASSED

Files created:
- [x] src/tools/sign_message_btc.ts EXISTS
- [x] src/wallet/ledger-btc-transport.ts modified (signBtcMessage + _btcLedgerTransport)
- [x] src/signing/blocks-btc.ts modified (LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE)
- [x] test/signing-bip137.test.ts EXISTS
- [x] test/tools-sign-message-btc.test.ts EXISTS
- [x] src/tools/register-all.ts modified (sign_message_btc.js import)

Commits verified:
- [x] 6006c26 — test(24-02): failing scaffold + Fixture W
- [x] 051dab8 — feat(24-02): signBtcMessage + template
- [x] 8374f3a — feat(24-02): sign_message_btc tool

Acceptance criteria:
- [x] test/tools-sign-message-btc.test.ts 14/14 PASS
- [x] test/signing-bip137.test.ts 9/9 PASS
- [x] Fixture W literal 0xca329b... present and annotated
- [x] No createHandle in sign_message_btc.ts
- [x] sign_message_btc registered in register-all.ts
- [x] npx tsc --noEmit clean
