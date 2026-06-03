---
phase: 47
plan: 03
subsystem: security
tags: [bittensor, dispatch-allowlist, dry-run, preview-send, layer-0.5, layer-0.7]
requires: ["47-01", "47-02"]
provides:
  - checkBittensorDispatch + BITTENSOR_DISPATCH_ALLOWLIST (TAO-W-04, Layer 0.5)
  - runBittensorPreviewSimulation (TAO-PREP-02, Layer 0.7 advisory)
  - preview_send Bittensor arm (DECODED ARGS + blake2-256 BLIND-SIGN HASH)
affects:
  - src/tools/preview_send.ts (additive bittensor arm; existing arms byte-identical)
tech-stack:
  added: []
  patterns: [sibling-set (section,method) allowlist, advisory never-throws classifier, additive preview arm, _canonicalDispatchBittensor + _simulationBittensor spy seams]
key-files:
  created:
    - src/security/canonical-dispatch-bittensor.ts
    - src/signing/simulation-bittensor.ts
    - test/security-canonical-dispatch-bittensor.test.ts
    - test/simulation-bittensor.test.ts
  modified:
    - src/tools/preview_send.ts
decisions:
  - "OQ-2: dry-run is ADVISORY (EVM-style) — a non-ok status is a CHECKS PERFORMED warning, NEVER a refusal. The classifier never throws (RPC down → advisory error)."
  - "Allowlist keyed in camelCase (subtensorModule.addStakeLimit) matching what record.tx carries; snake_case echoed in the user-facing receipt."
  - "blake2-256 presign recomputed over the SAME signableBlob the fingerprint binds (the one Substrate divergence from the SHA-256 Solana/TRON siblings)."
metrics:
  duration: ~salvaged (prior executor hung on a blocked RPC socket before committing 47-03; code salvaged at c5909ad)
  completed: 2026-06-03
---

# Phase 47 Plan 03: Bittensor Dispatch Allowlist + Dry-Run + Preview Arm Summary

The Layer 0.5 `(section,method)` dispatch allowlist + the Layer 0.7 advisory dry-run classifier + the ADDITIVE `preview_send` Bittensor arm — the middle leg of the trust pipeline between the prepare tools (47-02) and the send arm (47-04).

> SUMMARY-provenance note: Plan 47-03's code was committed by a prior executor at `c5909ad` (salvaged from a Wave-2/3 checkpoint that hung on a blocked WsProvider RPC socket before writing this SUMMARY). This SUMMARY is authored retroactively against the committed artifacts; the code itself was not re-touched by Plan 47-04.

## What was built

- **`canonical-dispatch-bittensor.ts`** (TAO-W-04, Layer 0.5) — `BITTENSOR_DISPATCH_ALLOWLIST: ReadonlySet<string>` of exactly three `"section.method"` pairs (`subtensorModule.addStakeLimit`, `subtensorModule.removeStakeLimit`, `balances.transferKeepAlive`), keyed in **camelCase** to match what `record.tx` carries. `checkBittensorDispatch(section, method)` → `{ kind: "allowed" }` | `{ kind: "refused"; offender; allowlist }`. Sibling-set pattern (mirrors `canonical-dispatch-tron`). `_canonicalDispatchBittensor` spy seam. Arg-level allowlisting (hotkey/netuid value checks) explicitly deferred.
- **`simulation-bittensor.ts`** (TAO-PREP-02, Layer 0.7) — `runBittensorPreviewSimulation({ signableBlob })` classifies `ok | invalid | error`. **ADVISORY + never-throws**: a `getApi` rejection (RPC down), an undecorated `dryRun`, or a `dryRun` throw all demote to an advisory `error`/`invalid` status — NEVER a hard refusal. `_simulationBittensor` spy seam. All RPC through `_bittensorRegistry.getApi` (no live socket in tests).
- **`preview_send.ts` Bittensor arm** — ADDITIVE `if (txType === "bittensor") return previewSendBittensorBranch(...)`. Layer 0.5 allowlist refusal (`DISPATCH_TARGET_REFUSED`) → Layer 0.7 advisory dry-run (CHECKS PERFORMED block) → mint `previewToken` + `transitionToPreviewed` + recompute blake2-256 presign over the SAME `signableBlob` → emit DECODED ARGS (per-extrinsic unit labels: add = "TAO/RAO", remove = "ALPHA", limit_price direction labeled) + LEDGER BLIND-SIGN HASH (Bittensor, blake2-256) + VERIFY BEFORE SIGNING. The Safe early-return + the EVM + Solana + TRON + BTC + LTC arms are byte-identical.

## Open-question resolutions (with evidence)

- **OQ-2 (dry-run posture):** RESOLVED ADVISORY. Evidence: the chain-enforced `CheckMetadataHash` + the on-device blake2-256 hash match are the real trust anchors (47-RESEARCH §Probe 4 / OQ-2), so a sim failure surfaces a usability warning but does not block preview. Falsifier-tested: `getApi` reject / undecorated `dryRun` / `dryRun` throw all resolve (never reject) to an advisory status.

## Tasks completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | canonical-dispatch-bittensor + test | c5909ad | allowlist + test |
| 2 | simulation-bittensor + test | c5909ad | classifier + test |
| 3 | preview_send Bittensor arm (additive) | c5909ad | preview_send.ts |

## Deviations from Plan

- None functional. SUMMARY authored retroactively (see provenance note above) — the prior executor committed the code at `c5909ad` but hung before writing the SUMMARY.

## Verification

- `npx tsc --noEmit` — RC=0
- `npx vitest run` security-canonical-dispatch-bittensor (9) + simulation-bittensor (6) — green
- `preview_send.ts` — additive-only (existing arms byte-identical)
- FROZEN zero-diff (EVM/Solana/TRON binding + send_transaction three-gate) — clean

## Self-Check: PASSED

- FOUND: src/security/canonical-dispatch-bittensor.ts, src/signing/simulation-bittensor.ts, test/security-canonical-dispatch-bittensor.test.ts, test/simulation-bittensor.test.ts
- FOUND: preview_send.ts bittensor arm (grep `previewSendBittensorBranch`)
- FOUND: commit c5909ad
