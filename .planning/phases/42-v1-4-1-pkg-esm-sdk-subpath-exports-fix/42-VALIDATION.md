---
phase: 42
slug: v1-4-1-pkg-esm-sdk-subpath-exports-fix
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-29
---

# Phase 42 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

This is a build-tooling / packaging-config phase. The cryptographic-binding chain is FROZEN; no `src/` behavior changes. The load-bearing verification is a **binary-execution smoke test** (pkg-built binary runs without `ERR_MODULE_NOT_FOUND`), which vitest cannot express — it is a manual build+run integration check. The vitest suite's role here is purely regression (prove the `package.json` change broke nothing).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest `^2.1.0` |
| **Config file** | none — vitest auto-discovers |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~8 seconds (existing suite, 890+ tests) |

---

## Sampling Rate

- **After every task commit:** `npm test`
- **After every plan wave:** `npm test` + `npm run build:binary:linux-x64` + `./dist-binaries/vaultpilot-mcp --version`
- **Before `/gsd-verify-work`:** Full suite green + binary `--version` exit 0 + MCP stdio handshake clean + FROZEN zero-diff = 0
- **Max feedback latency:** ~8s (vitest); build smoke ~5-10 min (manual, per-wave)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 42-01 (config) | 01 | 1 | DIST-40 | T-42-SUPPLY (tronweb patch reviewed) | `package.json` carries `pkg.sea=true` + tronweb pinned `6.3.0`; no logic change | assertion | `grep -q '"sea": true' package.json && grep -q '"tronweb": "6.3.0"' package.json` | ❌ W0 | ⬜ pending |
| 42-01 (patch) | 01 | 1 | DIST-40 | T-42-SUPPLY | `patches/tronweb+6.3.0.patch` removes only the `"import"` exports condition (CJS forced); applied via existing `postinstall: patch-package` | assertion | `test -f patches/tronweb+6.3.0.patch && npm ci 2>&1 \| grep -q tronweb` | ❌ W0 | ⬜ pending |
| 42-01 (binary smoke) | 01 | 1 | DIST-40 | — | pkg binary resolves SDK subpaths at runtime; `--version` exits 0; MCP stdio `initialize` returns without `ERR_MODULE_NOT_FOUND` | smoke (manual build+run) | `npm run build:binary:linux-x64 && ./dist-binaries/vaultpilot-mcp --version; echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \| timeout 5 ./dist-binaries/vaultpilot-mcp` | ❌ W0 | ⬜ pending |
| 42-01 (regression) | 01 | 1 | DIST-40 | — | All existing tests green; tsc + build clean | regression | `npm test && npm run typecheck && npm run build` | ✅ 890+ exist | ⬜ pending |
| 42-01 (FROZEN) | 01 | 1 | DIST-40 | T-42-FROZEN | Zero `src/` diff vs origin/main (cryptographic-binding chain byte-identical) | assertion | `test "$(git diff origin/main -- src/ \| wc -l)" -eq 0` | ✅ (Phase 10-01 pattern) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] No new vitest test files required — the binary smoke is a manual build+run integration check (vitest cannot exec a pkg binary).
- [ ] FROZEN zero-diff assertion reuses the Phase 10-01 pattern (`git diff origin/main -- src/`).

*The binary-execution smoke is intentionally manual; there is no Wave 0 vitest gap to fill.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| pkg binary runs without `ERR_MODULE_NOT_FOUND` | DIST-40 | vitest runs in-process under Node; it cannot build or exec a pkg SEA binary | `npm run build:binary:linux-x64` → `./dist-binaries/vaultpilot-mcp --version` (expect exit 0 + version) → pipe an `initialize` JSON-RPC frame and confirm a JSON response, no module-resolution error |
| Cross-target SEA binaries (macOS-arm64, windows-x64) run | DIST-40 | Requires native macOS / Windows hosts (cross-compiled SEA binaries unverifiable on the Linux build host) | Deferred to v1.4 HUMAN-UAT / CI; NOT a code-completion blocker (criterion #8) |
| Further ESM/CJS interop failures (other deps) surface only at binary runtime | DIST-40 | Only observable by running the built binary, not in vitest | Run the stdio handshake smoke; if a new `does not provide an export named` error appears, patch that dep via `patch-package` following the `@ledgerhq` pattern, re-run |

---

## Validation Sign-Off

- [ ] Binary smoke (build + `--version` + stdio handshake) executed and captured in SUMMARY.md — completes the empirical mandate research could not finish (Success Criterion #2)
- [ ] Full vitest suite green; tsc + build clean
- [ ] FROZEN zero-diff = 0 lines
- [ ] tronweb patch applies cleanly on a fresh `npm ci`
- [ ] `nyquist_compliant: true` set in frontmatter once the above hold

**Approval:** pending
