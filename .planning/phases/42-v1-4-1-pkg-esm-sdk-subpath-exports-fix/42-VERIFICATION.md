---
phase: 42
slug: v1-4-1-pkg-esm-sdk-subpath-exports-fix
status: passed
verified_by: orchestrator (independent re-run of every gate on fresh npm ci)
verified: 2026-05-29
criteria_total: 8
criteria_met: 8
---

# Phase 42 — Verification

Goal-backward verification of the 8 ROADMAP success criteria. The orchestrator served as the independent verification layer: it caught a false-pass in the executor's `Self-Check` (typecheck reported clean but was failing), root-caused and fixed it (`508e98e`), then re-ran **every** gate from a clean `npm ci`. All evidence below is from those fresh runs, not the executor's self-report.

## Success Criteria

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Root cause confirmed empirically before fix | ✅ | RESEARCH built+ran each candidate; baseline `ERR_MODULE_NOT_FOUND` reproduced; root cause = pkg's non-SEA bootstrap doesn't patch Node's native ESM resolver (C++ `getPackageJSONURL`) |
| 2 | Recovery option selected by empirical build+run, not assertion | ✅ | `pkg.sea=true` + tronweb CJS patch built and ran on linux-x64; option (c) `pkg.assets` glob proven-fail; option (b) FROZEN-rejected. Binary-smoke output captured verbatim in SUMMARY |
| 3 | `build:binary:<native>` → `--version` exit 0 AND MCP stdio startup, no module-resolution error | ✅ | `./dist-binaries/vaultpilot-mcp --version` → exit 0, prints `0.0.0`; MCP `initialize` → clean JSON-RPC result with full serverInfo, **no `ERR_MODULE_NOT_FOUND`** (re-run by orchestrator) |
| 4 | FROZEN-area zero-diff (`git diff origin/main -- src/` = 0) | ✅ | `git diff origin/main -- src/` → **0 lines**; `test/signing-fingerprint*` → 0. Fix is config-only (package.json + patches/). The one place the fix *threatened* a src/ touch (typecheck regression) was resolved in the patch instead — zero src/ touched |
| 5 | Full test suite + typecheck + tsc clean | ✅ | After fix: `npm run typecheck` → **0 errors** (exit 0); `npm run build` (tsc) → clean; `npm test` → **5254 passed, 1 skipped** (349 files). (Pre-fix typecheck was failing — see Deviation below) |
| 6 | release.yml byte-identical unless build-invocation change needed | ✅ | `git diff origin/main -- .github/workflows/release.yml` → 0; template → 0. No flag change needed (pkg reads `sea` from package.json) |
| 7 | SECURITY.md reconciled if SEA posture warrants | ✅ | One-line addendum to the existing supply-chain row (SEA postject injection; Node binary from nodejs.org/dist via pkg-fetch checksum). No new row, no restructure |
| 8 | v1.4.0 GA tag no longer blocked; documented in SUMMARY | ✅ | `ERR_MODULE_NOT_FOUND` resolved on linux-x64; SUMMARY "v1.4.0 GA Gate Cleared" section. Cross-platform (macOS-arm64, windows-x64) binaries deferred to HUMAN-UAT / CI per this criterion — not a code-completion blocker |

**8/8 criteria met.**

## Key Deviation (caught + corrected in verification)

The Task 4 iterative-interop contingency expanded beyond the adjudicated tronweb patch — 4 additional interop fixes (rpc-websockets→uuid@8.3.2 nested override; multiformats/uint8arrays + @ledgerhq `pkg.scripts` CJS globs; usb/node-hid/@serialport `pkg.assets` native-prebuild entries). All are config-scoped (package.json), all the same mechanical CJS/native-snapshot class, zero `src/`. This nudged past the plan's "~3 deps" soft bound; the executor pushed through rather than escalating. Accepted on review because: (a) all same class, (b) zero FROZEN touch (the hard bound held), (c) the binary runs.

The executor's `Self-Check` then **falsely reported typecheck clean** while it was failing (3 `TS2722` errors caused by the tronweb CJS `.d.ts` resolution under NodeNext). The orchestrator caught this on independent re-run, root-caused it, and fixed it inside the patch via a `"types"` exports condition (`508e98e`) — runtime stays CJS, TS resolves the validated ESM `.d.ts`, zero `src/` touch.

## Residual / Deferred (not blockers)

- **Cross-platform binaries** (macOS-arm64, windows-x64) unverified on this Linux host — deferred to HUMAN-UAT / CI per SC#8. The release workflow exercises all 4 targets on tag push.
- **Binary `--version` reports `0.0.0`** — pre-existing (package.json version, unchanged since Phase 10); orthogonal to the ERR_MODULE_NOT_FOUND fix. A version-string bump belongs to the actual v1.4.0 release cut, not this fix.
- **Binary size** ~141 MB → ~238 MB (SEA backend) — documented, acceptable for v1.4.x.

## Verdict

**PASSED.** The pkg-built linux-x64 binary runs end-to-end with no SDK module-resolution error; the cryptographic-binding chain is byte-identical; the full suite is green. The v1.4.0 GA binary tag is unblocked for linux-x64, with cross-platform smoke as documented HUMAN-UAT debt.
