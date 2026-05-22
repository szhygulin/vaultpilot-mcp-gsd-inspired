---
phase: 24-btc-bip125-rbf-bip137-message-signing
reviewed: 2026-05-22T00:00:00Z
depth: deep
files_reviewed: 10
files_reviewed_list:
  - src/tools/prepare_btc_rbf_bump.ts
  - src/tools/sign_message_btc.ts
  - src/tools/prepare_btc_send.ts
  - src/tools/preview_send.ts
  - src/protocols/btc-psbt.ts
  - src/signing/handle-store.ts
  - src/signing/error-codes.ts
  - src/signing/blocks-btc.ts
  - src/chains/bitcoin/esplora-client.ts
  - src/wallet/ledger-btc-transport.ts
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
status: fixed
---

# Phase 24: Code Review Report

**Reviewed:** 2026-05-22
**Depth:** deep
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 24 delivers BTC RBF fee bumping (`prepare_btc_rbf_bump`) and BIP-137 message signing
(`sign_message_btc`). The BIP-137 implementation is clean — magic-prefix discipline, varint
encoding, header-byte assembly, and the Fixture W anchor are all correct. The Ledger transport
`signBtcMessage` mirrors the `signBtcPsbt` try/finally lifecycle correctly.

The RBF implementation has two blockers. First, `prepare_btc_rbf_bump` silently drops all
but the first non-change output for transactions with multiple recipients, which both violates
BIP-125 Rule 2 output-preservation intent and misrepresents what the Ledger screen will show.
Second, the PREPARE RECEIPT's `{FEE_DELTA_SATS}` slot uses a pre-PSBT estimated value instead
of the actual PSBT fee, producing a wrong delta whenever sub-dust change is folded into the
miner fee. The preview_send.ts receipt computes this field correctly, creating an inconsistency
between prepare-time and preview-time receipts for this edge case.

Four warnings round out the report: missing newFeeRate upper-bound sanity check (present in
`prepare_btc_send` but absent here), a wrong BIP-32 path for taproot change outputs, a
misleading fingerprint-drift error message that always blames `prepare_btc_send`, and a plan
requirement (originalTxid in send_transaction success response) that was not implemented.

---

## Critical Issues

### CR-01: Silent truncation of multiple recipient outputs — violates BIP-125 Rule 2 and T-24-03

**File:** `src/tools/prepare_btc_rbf_bump.ts:482`

**Issue:** When the original transaction has more than one non-change output (batch payment,
OP_RETURN + recipient, etc.), `prepare_btc_rbf_bump` passes only the **first** non-change
output to `buildBtcPsbt`. All remaining recipient outputs are silently dropped from the
replacement PSBT.

```typescript
// Line 482 — picks only the first non-change output
const recipientVout = txData.vout.find((_, idx) => idx !== changeVoutIndex);
```

`buildBtcPsbt` accepts a single `recipientOutput` (not an array), so for a 3-output
original (recipient1, recipient2, change), the replacement contains only (recipient1,
change_reduced). The sats that were going to recipient2 are instead absorbed by the
increased miner fee or folded into the (now over-sized) change reduction.

Consequences:
- The replacement PSBT **does not preserve the original output set**, violating the
  stated T-24-03 mitigation ("recipient outputs are preserved byte-identically").
- The Ledger screen will show fewer outputs than the original, misleading the user.
- A malicious agent that crafts a transaction with two recipient outputs (one real,
  one a decoy) can trick the tool into replacing only the first.

The current implementation is safe only for single-recipient transactions (one non-change
output). This covers the common case but the tool provides no guard rail and no error
when given a multi-output transaction.

**Fix:**

Guard against multi-output originals at the validation layer, or extend the PSBT builder to
accept multiple recipient outputs. The minimal safe fix for Phase 24 scope:

```typescript
// After identifying changeVout at line 395, count non-change outputs
const recipientVouts = txData.vout.filter((_, idx) => idx !== changeVoutIndex);

if (recipientVouts.length === 0) {
  return { isError: true, content: [/* ... */],
    structuredContent: errEnvelope("INTERNAL_ERROR", `no recipient output in txid ${rawTxid}`) };
}

if (recipientVouts.length > 1) {
  // Cannot safely bump: would drop outputs. Refuse with a descriptive error.
  return { isError: true, content: [{ type: "text", text:
    `error: txid ${rawTxid} has ${recipientVouts.length} non-change outputs; ` +
    "prepare_btc_rbf_bump only supports single-recipient transactions in Phase 24" }],
    structuredContent: errEnvelope(
      "INVALID_INPUT",
      `txid ${rawTxid} has multiple recipient outputs; multi-output RBF deferred to Phase 25`,
    ) };
}

const recipientVout = recipientVouts[0];
```

---

### CR-02: PREPARE RECEIPT `{FEE_DELTA_SATS}` is wrong when sub-dust change is folded into fee

**File:** `src/tools/prepare_btc_rbf_bump.ts:630`

**Issue:** When the new change output falls below the dust threshold (330 sats), the code
sets `effectiveChangeSats = 0n` and drops the change output entirely. The extra sats fold
into the miner fee. However, the PREPARE RECEIPT still computes `feeDeltaSats` from the
pre-PSBT estimated `newFeeSats` rather than from the actual PSBT `psbtResult.feeSats`:

```typescript
// Line 630 — uses computed estimate, not actual PSBT fee
const feeDeltaSats = newFeeSats - originalFeeSats;

// Line 637 — {NEW_FEE_SATS} correctly uses actual PSBT fee
.replace("{NEW_FEE_SATS}", String(psbtResult.feeSats))
// Line 638 — {FEE_DELTA_SATS} is WRONG: uses estimate instead of actual
.replace("{FEE_DELTA_SATS}", String(feeDeltaSats))
```

When dust is folded (e.g. 100 sats of dust), the receipt says:

```
newFee: 2100 sats  (delta: +1000 sats)  ← WRONG: actual delta is +1100
```

`psbtResult.feeSats` already accounts for the folded dust. The preview_send.ts receipt
computes the delta correctly (`btcTx.feeSats - btcTx.originalFeeSats`), so the user
sees a different delta in the PREPARE RECEIPT vs the PREVIEW RECEIPT — a trust-breaking
discrepancy for a self-custodial signing pipeline where every number must be consistent.

The same wrong value propagates to `structuredContent.feeDeltaSats` (line 668).

**Fix:**

```typescript
// Line 630: replace
const feeDeltaSats = newFeeSats - originalFeeSats;
// with:
const feeDeltaSats = psbtResult.feeSats - originalFeeSats;
```

This uses the actual fee after potential dust folding. The `{FEE_DELTA_SATS}` slot will
then be consistent with `{NEW_FEE_SATS}` and with the preview_send receipt.

---

## Warnings

### WR-01: No upper-bound sanity check on `newFeeRate` — missing `BTC_FEE_RATE_OUT_OF_BOUNDS` guard

**File:** `src/tools/prepare_btc_rbf_bump.ts:172-186`

**Issue:** `prepare_btc_send` validates that `feeRate` is within `[1, 10× highPriorityEstimate]`
and returns `BTC_FEE_RATE_OUT_OF_BOUNDS` when violated. `prepare_btc_rbf_bump` only checks
the lower bound (`>= 1`), with no upper bound. An agent can supply `newFeeRate = 1_000_000`
(1 million sat/vB). As long as the change output is large enough to absorb the fee delta,
the tool will happily build and sign the PSBT, draining the change output to near-zero.

The only protection is `BTC_RBF_CANNOT_AFFORD` (when `feeDelta > changeValue`), but a large
change output gives the agent a wide window for unintended fee overpayment.

**Fix:**

Mirror the `prepare_btc_send` upper-bound check. After the lower-bound validation, fetch
current fee estimates and cap:

```typescript
// After Step 1 lower-bound check, before Esplora fetch:
const feeEstimatesResult = await fetchFeeEstimates();
if (feeEstimatesResult.kind === "ok") {
  const highPriority = feeEstimatesResult.estimates["1"] ?? 500;
  if (newFeeRate > highPriority * 10) {
    return { isError: true, /* ... */,
      structuredContent: errEnvelope(
        "BTC_FEE_RATE_OUT_OF_BOUNDS",
        `newFeeRate ${newFeeRate} sat/vB exceeds 10× high-priority estimate (${highPriority * 10} sat/vB)`,
      ) };
  }
}
```

---

### WR-02: Taproot change output uses segwit BIP-32 path `m/84'/0'/0'/1/0` unconditionally

**File:** `src/tools/prepare_btc_rbf_bump.ts:518,592`

**Issue:** When the change output is a P2TR (taproot) address (`scriptpubkey_type === "v1_p2tr"`),
the code still sets `bip32Path: "m/84'/0'/0'/1/0"` (the P2WPKH segwit path). Taproot
addresses derive under `m/86'/0'/0'` (BIP-86), not `m/84'/0'/0'` (BIP-84).

```typescript
// Line 515 correctly detects taproot change:
scriptType: changeVout.scriptpubkey_type === "v1_p2tr" ? "p2tr" : "p2wpkh",
// Line 518 ignores the detected scriptType and uses segwit path anyway:
bip32Path: "m/84'/0'/0'/1/0",  // WRONG for p2tr: should be "m/86'/0'/0'/1/0"
// Line 592:
changePath: changeOutput !== null ? "m/84'/0'/0'/1/0" : null,  // same bug
```

The Ledger BTC app uses the `bip32Path` in `tapBip32Derivation` to identify which output is
"yours" (change) vs. a send to another party. A wrong derivation path means the device may
display the taproot change output as a second recipient instead of change, confusing the user
or causing them to reject a valid transaction.

**Fix:**

```typescript
const changeScriptType: "p2wpkh" | "p2tr" =
  changeVout.scriptpubkey_type === "v1_p2tr" ? "p2tr" : "p2wpkh";
const changeBip32Path =
  changeScriptType === "p2tr" ? "m/86'/0'/0'/1/0" : "m/84'/0'/0'/1/0";

const changeOutput: BtcPsbtOutput | null = effectiveChangeSats > 0n
  ? {
      address: changeVout.scriptpubkey_address,
      valueSats: effectiveChangeSats,
      scriptType: changeScriptType,
      role: "change",
      pubkey: segwitPubkey,
      bip32Path: changeBip32Path,   // was hardcoded "m/84'/0'/0'/1/0"
      masterFingerprint: ZERO_MASTER_FINGERPRINT,
    }
  : null;
// ...
changePath: changeOutput !== null ? changeBip32Path : null,  // line 592
```

---

### WR-03: Fingerprint-drift error in `previewSendBtcBranch` always references `prepare_btc_send`, even for RBF handles

**File:** `src/tools/preview_send.ts:2108,2114`

**Issue:** When a payloadFingerprint drift is detected during preview of an RBF handle, the
error message instructs the user to re-run `prepare_btc_send`:

```typescript
"error: payloadFingerprint drift detected between prepare and preview; abort and re-run prepare_btc_send";
// ...
"payloadFingerprint drift (BTC preview) — re-run prepare_btc_send",
```

For a `kind: "rbf"` handle, this is wrong advice. The user should re-run
`prepare_btc_rbf_bump`. This is a UX bug rather than a security bug (the refusal itself
is correct), but in a security-sensitive flow where the user is asked to follow structured
instructions, incorrect recovery guidance erodes trust.

**Fix:**

```typescript
const rerunTool = btcTx.kind === "rbf" ? "prepare_btc_rbf_bump" : "prepare_btc_send";
const message =
  `error: payloadFingerprint drift detected between prepare and preview; abort and re-run ${rerunTool}`;
// ...
`payloadFingerprint drift (BTC preview) — re-run ${rerunTool}`,
```

---

### WR-04: `send_transaction.ts` does not include `originalTxid` in RBF success response — plan requirement unimplemented

**File:** `src/tools/send_transaction.ts` (BTC success structuredContent, line ~1594)

**Issue:** Plan 24-01 Task 2 explicitly requires:

> "Add `...(btcTx.kind === "rbf" ? { originalTxid: btcTx.originalTxid } : {})` to the success response."

The current implementation includes `kind: btcTx.kind` in the success `structuredContent`
but omits `originalTxid`. As a result, the caller cannot link the broadcast replacement tx
to the original mempool tx it is replacing — breaking the audit trail that the PREPARE RECEIPT
creates.

```typescript
// Current (missing originalTxid for rbf):
structuredContent: {
  txHash, broadcastedAt, handle: handleArg,
  txType: "btc" as const,
  kind: btcTx.kind,
  sessionTopicLast8: null,
},
```

**Fix:**

```typescript
structuredContent: {
  txHash, broadcastedAt, handle: handleArg,
  txType: "btc" as const,
  kind: btcTx.kind,
  ...(btcTx.kind === "rbf" ? { originalTxid: btcTx.originalTxid } : {}),
  sessionTopicLast8: null,
},
```

---

## Info

### IN-01: `{FEE_DELTA_SATS}` suggested minimum fee in error message is one integer too high

**File:** `src/tools/prepare_btc_rbf_bump.ts:372`

**Issue:** The error text suggests:
```
Use newFeeRate >= Math.ceil(originalFeeRate + MIN_RELAY_FEE_BUMP_SATS_PER_VB + 1)
```
For `originalFeeRate = 4.1`, this evaluates to `Math.ceil(6.1) = 7`, but `newFeeRate = 6`
(which is `> 5.1 = originalFeeRate + 1`) would be accepted by the gate condition. The
hint overestimates the required minimum by up to 1 sat/vB when `originalFeeRate` is
non-integer.

**Fix:**

```typescript
// Replace Math.ceil(originalFeeRate + MIN_RELAY_FEE_BUMP_SATS_PER_VB + 1)
// with:
Math.ceil(originalFeeRate + MIN_RELAY_FEE_BUMP_SATS_PER_VB) + 1
```

`Math.ceil(originalFeeRate + 1)` gives the smallest integer ≥ the threshold; adding 1
gives the smallest integer that strictly exceeds it.

---

### IN-02: `txid` regex comment says "lowercase" but accepts mixed-case

**File:** `src/tools/prepare_btc_rbf_bump.ts:155-156`

**Issue:** The comment on line 155 reads "must be exactly 64 **lowercase** hex characters",
but the regex `[0-9a-fA-F]{64}` accepts uppercase. Esplora canonicalizes txids to lowercase
so this is behaviorally benign, but the comment and the regex are inconsistent and could
mislead future maintainers into hardening the regex when the behavior was intentionally
accepting.

**Fix:** Either normalize to lowercase before the test (`rawTxid.toLowerCase()`) and update
the comment, or change the comment to "64 case-insensitive hex characters".

---

_Reviewed: 2026-05-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
