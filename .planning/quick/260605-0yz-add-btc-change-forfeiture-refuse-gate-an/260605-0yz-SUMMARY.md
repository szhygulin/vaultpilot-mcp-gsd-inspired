---
quick_id: 260605-0yz
slug: add-btc-change-forfeiture-refuse-gate-an
status: complete
date: 2026-06-05
---

# Summary: BTC change-forfeiture refuse-gate + disclosure (WR-04 parity)

## What changed

`src/tools/prepare_btc_send.ts` — added the BTC equivalent of LTC's WR-04 silent-forfeiture guard,
scoped to **real mode** (demo personas are exempt by design):

1. **Refuse-gate** (after change-address derivation): when `!demoActive && changeAddress === null
   && changeSats > 10_000n`, return `errEnvelope("INVALID_INPUT", …)` with a message directing the
   user to re-pair (`pair_btc_ledger`) or size the send to the full UTXO balance. The refusal fires
   **before** the PSBT is assembled — no forfeiting transaction is ever built.
2. **Disclosure** (PREPARE RECEIPT): when `!demoActive && !hasChangeOutput && changeSats > 0n`,
   append `CHANGE FORFEITED: <changeSats> sats (no xpub for change-address derivation — re-pair …)`.
   (`const prepareReceipt` → `let` to allow the append.)

`test/prepare-btc-send.test.ts` — added a `WR-04 change-forfeiture guard` describe block (4 tests):
refuse > threshold, disclose ≤ threshold, xpub-present no-false-positive, demo-exempt.

## Why real-mode only

The threat is a real-mode legacy account (paired before xpub/change-output support). Demo personas
carry no xpub *by simulation* (stub pubkeys, no real funds) — folding change to fee is a demo
artifact, not a loss — so the guard exempts demo to keep the rehearsal flow unblocked. LTC applies
its guard unconditionally only because LTC has no xpub/change path at all; BTC distinguishes the two.
Because every existing real-mode test stubs xpubs *present*, the guard is purely additive.

## Verification

- `npx vitest run test/prepare-btc-send.test.ts` → **18/18** (14 existing + 4 new).
- `npx vitest run test/btc-trust-pipeline.integration.test.ts test/tools-sign-message-btc.test.ts` → **27/27**.
- `tsc --noEmit` → 0 errors.
- No other test stubs an empty BTC xpub (only this task's new tests exercise the legacy path).

## FROZEN-area

Zero diff to the cryptographic-binding chain (`send_transaction.ts`, `payload-fingerprint*.ts`,
`presign-hash*.ts`, `handle-store.ts`). Only `prepare_btc_send.ts` + its test changed. `payloadFingerprint`
is computed over the PSBT bytes exactly as before; the guard only refuses (real-mode legacy + large
forfeit) or appends a disclosure line — it never alters the signed transaction.
