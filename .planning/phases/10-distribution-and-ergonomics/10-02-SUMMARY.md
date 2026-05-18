---
phase: 10
plan: 02
subsystem: "install.sh (NEW — FIRST shell script in repo; POSIX bash; 8 mandatory invariants per RESEARCH § Topic 5) + install.ps1 (NEW — FIRST PowerShell script in repo; Windows analog) + src/diagnostics/install-envelope.ts APPEND-ONLY 4 install.sh-batch CheckId literals (no ENVELOPE_VERSION bump)"
tags: [install-sh, install-ps1, curl-pipe, sha256-verify-before-extract, t-sha256-verify-before-extract-1, t-install-envelope-compat-1, t-partial-download-1, t-curl-pipe-404-html-1, t-install-mitm-1, t-macos-quarantine-1, t-windows-smartscreen-1, t-path-auto-edit-1, arp242-main-wrap, append-only-checkid-widening, mcp-client-delegation-to-installed-binary, dist-41, dist-42-completion, phase-10, wave-2, v1.4, last-execute-plan-for-phase-10, v1x-code-complete]
requirements: [DIST-41, DIST-42]
wave: 2
status: complete
completed: 2026-05-18
dependency-graph:
  requires:
    - "Plan 10-01 (release.yml + per-asset .sha256 + combined SHA256SUMS — install.sh fetches the .sha256 companion at install time; release.yml `cp ../install.sh release-assets/` + `cp ../install.ps1 release-assets/` upload the install scripts AS versioned + immutable release assets)"
    - "Plan 10-03 (src/cli/setup.ts + src/cli/setup-mcp-clients.ts + src/index.ts `setup` subcommand routing — install.sh delegates MCP client registration via `\"$binary_path\" setup --non-interactive --json`)"
    - "Plan 10-03 (src/diagnostics/install-envelope.ts pre-widened with 5 setup-wizard CheckId literals at Wave 1 — Plan 10-02 APPENDS 4 install.sh-batch literals in a SEPARATE comment-block at end-of-union per W-2 mitigation)"
    - "main HEAD 3e14ca8 (Phase 10 plans 01 + 03 + 04 all merged; Phase 10 plan 02 is the FINAL execute plan)"
  provides:
    - "install.sh (NEW at repo root — 262 lines POSIX bash; executable bit set 0755; all 8 mandatory invariants per RESEARCH § Topic 5; ships AS release asset via Plan 10-01 release.yml cp step)"
    - "install.ps1 (NEW at repo root — 176 lines PowerShell; Windows analog with SmartScreen Unblock-File NOTICE + HKCU PATH-append + .NET RuntimeInformation arch detect; ships AS release asset via Plan 10-01 release.yml cp step)"
    - "src/diagnostics/install-envelope.ts (+5 lines additive — 4 install.sh-batch CheckId literals in a Plan 10-02 comment-block AFTER Plan 10-03's setup-wizard comment-block: binary-download + binary-install + path-presence + quarantine-attr. Union: 14 entries total. ENVELOPE_VERSION still 1 — T-INSTALL-ENVELOPE-COMPAT-1 preserved)"
    - "test/install-envelope-shape.test.ts (NEW — 18 cases covering all 14 CheckId literals + ENVELOPE_VERSION === 1 + escalateStatus precedence + sample envelope shapes from install.sh / install.ps1 / setup wizard + Phase 1 consumer forward-compat)"
  affects:
    - "MCP client auto-registration via curl-pipe install path (DIST-42 completion — install.sh / install.ps1 invoke installed binary's `setup --non-interactive --json`)"
    - "Phase 10 close-out posture: Plan 10-02 is the LAST execute plan in the v1.x roadmap; phase-completion chore is the next step (`/gsd-mark-phase-complete 10`)"
  unblocks:
    - "v1.4.0-rc1 prerelease tag — Plans 10-01 + 10-02 + 10-03 + 10-04 are all merged; the first `v1.4.0-rc1` push exercises the release workflow end-to-end (release.yml `cp ../install.sh release-assets/` step now resolves because install.sh exists at repo root)"
    - "v1.4.1 follow-up plan (carry-forward from 10-01 SUMMARY) — pkg ESM @modelcontextprotocol/sdk subpath-export resolution regression still gates v1.4.0 GA; recovery options enumerated in 10-01 SUMMARY (pkg.sea = true, deep CJS imports in src/server.ts, or package.json `imports` field map). NOT touched by Plan 10-02 (FROZEN-area)"
    - "v1.4.1 ergonomic backlog: install.sh `--dry-run` flag (env-var form supported in v1.4); `--register-only` + `--force-overwrite` + `--emit-install-envelope` (raw printf form supported in v1.4)"
tech-stack:
  added:
    - "(none — pure shell + PowerShell + additive TypeScript surface; no new npm deps; no new GitHub Actions)"
  patterns:
    - "arp242 canonical `main() { … }; main \"$@\"` partial-download safety idiom (RESEARCH § Topic 5 line 438) — non-negotiable for curl-pipe scripts. Partial download → unclosed function → bash syntax error at parse time → NO execution. Without this idiom, a truncated download could execute partial commands (`rm -rf $TMP_DIR` with unset `$TMP_DIR` → `rm -rf /`). T-PARTIAL-DOWNLOAD-1 mitigation. install.ps1 mirrors via `Invoke-VaultPilotInstall { … }; Invoke-VaultPilotInstall` function wrap."
    - "SHA-256 verify BEFORE extract (T-SHA256-VERIFY-BEFORE-EXTRACT-1, HIGH STOP-THE-LINE). install.sh runs `shasum -a 256 -c \"$archive.sha256\"` BEFORE `tar xzf`; install.ps1 runs `Get-FileHash -Algorithm SHA256` BEFORE `Expand-Archive`. Verifying AFTER extract would let malicious tar entries write to `~/.local/bin/` first. Defense-in-depth beyond TLS cert chain. Cross-plan with Plan 10-01 (release.yml produces the per-asset .sha256 companion files)."
    - "`curl -fsSL` (NOT `curl -L` alone) — `-f` is load-bearing (T-CURL-PIPE-404-HTML-1). Without `-f`, GitHub's 404 'Not Found' HTML response (which returns HTTP 200 from the CDN) would pipe HTML into bash as commands. `-S` shows errors despite `-s` silent; `-L` follows GitHub's redirect chain to the actual asset. install.ps1 mirrors via `Invoke-WebRequest -UseBasicParsing` which throws on non-200 by default."
    - "APPEND-ONLY CheckId union widening across two plans in two grouped comment-blocks. Plan 10-03 landed 5 setup-wizard literals first in Wave 1; Plan 10-02 appends 4 install.sh-batch literals in a SEPARATE comment-block at end-of-union (W-2 mitigation from 10-CHECK). Merge collision avoided; provenance visible to future readers via the two comment-blocks. ENVELOPE_VERSION stays at 1 — Phase 1 `--check --json` consumers stay byte-compatible (T-INSTALL-ENVELOPE-COMPAT-1)."
    - "MCP client registration DELEGATED to installed binary's `vaultpilot-mcp setup --non-interactive --json` subcommand (Plan 10-03 surface). install.sh + install.ps1 do NOT re-implement per-platform detection + JSON-merge — that lives in `src/cli/setup-mcp-clients.ts` (Plan 10-03 OWNS it). install scripts shell out to the binary AFTER install + emit JSON payload on stdin. DIST-42 closure across the curl-pipe install path."
    - "Idempotency via existing-binary `--version` check (RESEARCH § Topic 5 line 362). If `~/.local/bin/vaultpilot-mcp --version` matches target, skip download + proceed to MCP client registration. Perf optimization for re-running install.sh (e.g. after `claude mcp add` failed and user re-runs). Does NOT compromise SHA-256 verification when a download IS needed."
    - "macOS Gatekeeper interactive OFFER (T-MACOS-QUARANTINE-1 accepted residual). install.sh prints a multi-line NOTICE block + interactive `read -r -p \"Run xattr -d com.apple.quarantine now? [y/N] \"`. In auto mode (`VAULTPILOT_MCP_AUTO=1`), prints NOTICE to stderr + skips the prompt. install.ps1 equivalent is the SmartScreen `Unblock-File` NOTICE (T-WINDOWS-SMARTSCREEN-1)."
    - "PATH check warn-only on POSIX (T-PATH-AUTO-EDIT-1 mitigation). install.sh does NOT auto-edit `~/.bashrc` / `~/.zshrc` / `~/.profile` — invasive; conflicts with user's shell config. Surfaces the export command for the user to add manually. install.ps1 USES `[Environment]::SetEnvironmentVariable('PATH', …, 'User')` which is the Windows-idiomatic non-invasive PATH-append (HKCU registry; no admin required; opens a new shell to take effect)."
    - "Refusal arms for unsupported OS+arch combinations (ROADMAP success-criterion #1 lock). install.sh refuses linux-arm64 + Windows-via-bash + unknown via `\"Unsupported platform <os>-<arch>. Use 'npm install -g vaultpilot-mcp' for $os-$arch.\"` + exit 1. install.ps1 refuses windows-arm64 + non-x64. The npm fallback path requires Node ≥ 18.17 (enforced at npm install time per package.json engines.node)."
    - "Source-grep + tsc-compile-time gate test discipline (test/install-envelope-shape.test.ts pattern). Each CheckId literal asserted by both (a) source-level string presence (catches deletion of the union entry); (b) `assertCheckId(id)` compile-time gate (catches union shape drift — tsc errors). Belt-and-braces: a drift in the source file that satisfies grep but breaks the type fails the test at compile time, not just at runtime."
key-files:
  created:
    - "install.sh (NEW — 262 lines POSIX bash at repo root; executable bit set 0755; #!/usr/bin/env bash shebang; set -euo pipefail at top; main() { … }; main \"$@\" wrap; helpers detect_os + detect_arch + log_info/warn/fail + confirm_overwrite + offer_strip_quarantine + register_with_mcp_clients_and_maybe_setup + maybe_emit_envelope; --dry-run via VAULTPILOT_MCP_DRY_RUN=1 env; --json via VAULTPILOT_MCP_JSON=1 env; --auto via VAULTPILOT_MCP_AUTO=1 env; --no-setup via VAULTPILOT_MCP_NO_SETUP=1 env; pinned version via VAULTPILOT_MCP_VERSION env)"
    - "install.ps1 (NEW — 176 lines PowerShell at repo root; $ErrorActionPreference = 'Stop'; Invoke-VaultPilotInstall function wrap; helpers Write-VpInfo + Write-VpWarn + Invoke-RegisterMcpClients + Write-InstallEnvelope; arch detect via [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture; refusal for non-x64 with npm fallback; SmartScreen NOTICE; HKCU PATH-append via [Environment]::SetEnvironmentVariable('PATH', …, 'User'))"
    - "test/install-envelope-shape.test.ts (NEW — 300 lines; 18 cases; T-INSTALL-ENVELOPE-COMPAT-1 anchors at Cases 1 + 17; all 14 CheckId literals covered via source-grep + tsc compile-time gate; escalateStatus precedence ok/warn/error/empty; sample envelope shapes from install.sh + install.ps1 + setup wizard parse + escalate; Case 18 anchors comment-block provenance discipline for both Plan 10-03 + Plan 10-02)"
    - ".planning/phases/10-distribution-and-ergonomics/10-02-SUMMARY.md (NEW — this file)"
  modified:
    - "src/diagnostics/install-envelope.ts (+5 lines additive — 1-line comment-block header `// ── Phase 10 / Plan 10-02 (install.sh + install.ps1) ──` + 4 NEW CheckId literals (binary-download + binary-install + path-presence + quarantine-attr) at end-of-union. ENVELOPE_VERSION + CheckLevel + CheckResult + InstallEnvelope + escalateStatus BYTE-FROZEN. Plan 10-03's 5 setup-wizard literals preserved at lines 11-16; Plan 10-02's 4 literals appended at lines 17-21 in a SEPARATE comment-block per W-2 mitigation. Union: 14 entries total (5 Phase 1 + 5 Plan 10-03 + 4 Plan 10-02). T-INSTALL-ENVELOPE-COMPAT-1 invariant preserved.)"
decisions:
  - "**SECURITY.md + README.md INTENTIONALLY UNCHANGED.** Plan 10-01's `## v1.4 Residual Risks (Distribution)` section (SECURITY.md lines 99-116) already names verbatim: install.sh `OFFERS xattr -d com.apple.quarantine ~/.local/bin/vaultpilot-mcp interactively` (line 108) + install.ps1 `documents Unblock-File -Path <path>` (line 109). Adding a Plan 10-02 cross-reference paragraph would duplicate the row content — direct CLAUDE.md `Documentation Style — concise, non-redundant, sharp` violation (`State each idea once, in its most natural place`). The most natural place is the row that already names the mechanism. Same for README.md — Plan 10-01's `## Install` section's 3 one-liners + Plan 10-03's `## Setup` section already cover the user-facing surface; no install.sh + install.ps1 behavior note is non-obvious. The plan's `<action>` Step 6 + Step 7 explicitly allowed `IF NEEDED` conditional surfaces — both not needed. Recorded here as a decision for traceability; Plan 10-02 SECURITY/README state is by-design no-op."
  - "**install.sh emits InstallEnvelope JSON via raw `printf` (v1.4 ergonomic limitation; documented residual).** The `vaultpilot-mcp setup --emit-install-envelope` flag (per RESEARCH § Topic 9 line 960) is a v1.4.1+ ergonomic; v1.4 install.sh uses `printf '%s'` against pre-constructed strings with belt-and-braces JSON-escape for backslash + double-quote (the message strings are static literals built by the script, not user input, so the escape is defensive not load-bearing). ~25 lines of shell. The trade is in-script complexity (small) vs Plan 10-03 surface complexity (would have to ship the flag in v1.4). v1.4.1 routes through the installed binary for cleaner JSON construction. Deferred per plan `<deferred>` block + plan body `<implementation_guidance>` Topic 9 ergonomic limitation."
  - "**Idempotency check stays in v1.4 scope.** RESEARCH § Topic 5 line 362 flagged this as `perf optimization; OK to skip if smoke-test is hard.` In-scope decision: smoke-test isn't hard (existing-binary `--version` shell-out is cheap, deterministic, and tested via the dry-run path on the dev machine). The idempotency path is a no-op for fresh installs; for re-runs (e.g. after `claude mcp add` failed and user re-runs install.sh), it skips the ~141MB tarball download. Worth the ~25 lines of shell."
  - "**MCP client registration delegation to installed binary's `vaultpilot-mcp setup --non-interactive --json`** (DIST-42 closure across the curl-pipe install path). install.sh / install.ps1 do NOT re-implement per-platform detection + JSON-merge logic — that logic lives in `src/cli/setup-mcp-clients.ts` (Plan 10-03 OWNS it; FROZEN per Plan 10-02 boundary). The delegation pattern keeps the v1.4 install scripts thin + the v1.4.1+ ergonomic surface (`--register-only`, `--force-overwrite`, profile management) all land in the binary, not in the install scripts."
  - "**Refusal arms for linux-arm64 + Windows + non-x64 stay strict.** Per ROADMAP success-criterion #1 (no install on unsupported platforms — refuse with npm fallback message). install.sh's refusal arm fires before any download attempt; install.ps1's fires before any Invoke-WebRequest. The npm fallback path requires Node ≥ 18.17 (enforced at npm install time per package.json engines.node). The strict refusal posture preserves the SHA-256 verify chain (no fallback to source-build on unsupported platforms) AND surfaces the platform-mismatch as a structured error (exit code 1) instead of a wrong-binary install that fails opaque-ly at runtime."
  - "**FROZEN-area assertion: LARGEST FROZEN-area boundary of any Phase 10 plan.** `git diff origin/main -- src/signing/ src/tools/ src/protocols/ src/clients/ src/security/ src/wallet/ src/chains/ src/config/ src/cli/ src/index.ts src/server.ts` returns EMPTY. Only src/ touch in Plan 10-02 is the +5-line CheckId widening in `src/diagnostics/install-envelope.ts`. ALL Plan 10-01 (release.yml + pkg) + Plan 10-03 (src/cli/ + writeConfigFile + setup subcommand routing) + Plan 10-04 (request_capability + rate-limit) surfaces UNTOUCHED. Cryptographic-binding chain UNTOUCHED. Fixtures A-J UNTOUCHED."
  - "**Bash `bash -n` syntax check + dry-run smoke test passed at execute time** on the dev machine (macos-arm64 host). `VAULTPILOT_MCP_DRY_RUN=1 VAULTPILOT_MCP_JSON=1 bash install.sh` emits well-formed envelope to stdout: `{\"envelope_version\":1,\"status\":\"ok\",\"checks\":[{\"id\":\"binary-download\",\"level\":\"ok\",\"message\":\"dry-run: skipped download\"},…]}`. Stderr carries the [install.sh] log lines (CLAUDE.md `Stderr for diagnostics, stdout for MCP protocol` analogue). Full integration smoke (`bash install.sh` against a real `v1.4.0-rc1` release tag on a fresh Linux container) deferred to verify-phase per RESEARCH § Topic 10 line 1038."
metrics:
  duration: "~12 minutes (single execution wave; zero deviations; dry-run smoke green first-shot; bash syntax check first-shot; tsc strict first-shot; full test suite green first-shot — the 18 NEW test cases came in green without iteration thanks to the source-grep + assertCheckId belt-and-braces discipline)"
  completed: 2026-05-18
  tasks_completed: 1
  files_created: 4 (install.sh + install.ps1 + test/install-envelope-shape.test.ts + 10-02-SUMMARY.md)
  files_modified: 1 (src/diagnostics/install-envelope.ts +5 lines additive)
  files_deleted: 0
  tests_before: 970
  tests_after: 988
  tests_delta: "+18 (matches plan estimate exactly; 5 + 5 + 4 = 14 literals × case + 4 escalateStatus precedence cases + sample envelope shapes × 3 + shape sanity × 2 + comment-block provenance = 18)"
  loc_delta: "+744 across 1 impl commit (install.sh 262 + install.ps1 176 + test/install-envelope-shape.test.ts 300 + src/diagnostics/install-envelope.ts +6/-1)"
  frozen_diff_lines: 0 (LARGEST FROZEN-area boundary for Phase 10: git diff origin/main against ALL src/signing/, src/tools/, src/protocols/, src/clients/, src/security/, src/wallet/, src/chains/, src/config/, src/cli/, src/index.ts, src/server.ts returns EMPTY)
  impl_commit: 6a8a673
---

# Phase 10 Plan 02: `install.sh` + `install.ps1` + `install-envelope.ts` CheckId Widening Summary

Wave 2 of Phase 10 — sequential after Plan 10-03. Closes DIST-41 + completes DIST-42 closure for the curl-pipe install path. **FINAL execute plan in Phase 10 — v1.x is code-complete after this lands.** Ships `install.sh` (NEW — FIRST shell script in repo; POSIX bash; all 8 RESEARCH § Topic 5 mandatory invariants) + `install.ps1` (NEW — FIRST PowerShell script in repo; Windows analog) + APPEND-ONLY widening of `src/diagnostics/install-envelope.ts` CheckId union with 4 install.sh-batch literals in a separate comment-block AFTER Plan 10-03's 5 setup-wizard literals. T-SHA256-VERIFY-BEFORE-EXTRACT-1 + T-PARTIAL-DOWNLOAD-1 + T-CURL-PIPE-404-HTML-1 + T-INSTALL-MITM-1 (cross-plan) + T-INSTALL-ENVELOPE-COMPAT-1 (no ENVELOPE_VERSION bump) STOP-THE-LINE invariants all asserted. macOS Gatekeeper + Windows SmartScreen accepted residuals UX-mitigated via interactive OFFER + NOTICE. MCP client registration delegated to installed binary's `vaultpilot-mcp setup --non-interactive --json` subcommand (Plan 10-03 surface). Test trajectory 970 → 988 (+18, matches plan estimate exactly). **LARGEST FROZEN-area boundary of any Phase 10 plan: only src/ touch is +5 lines in `src/diagnostics/install-envelope.ts`.**

## What Shipped

### 1. `install.sh` (NEW — 262 LOC POSIX bash; FIRST shell script in repo)

Ships AS release asset via Plan 10-01 release.yml `cp ../install.sh release-assets/` step — the curl-pipe URL `https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/releases/latest/download/install.sh` resolves to the **versioned + immutable** release asset, NOT the mutable `main` branch raw file. A `main`-branch update to install.sh does NOT change curl-pipe behavior until the next tagged release — accepted v1.4 behavior; documented in install.sh top-of-file comment.

All 8 mandatory invariants from RESEARCH § Topic 5 Pitfalls verified at execute time:

| # | Invariant | install.sh line | Threat mitigated |
|---|-----------|-----------------|------------------|
| 1 | `set -euo pipefail` at top | line 41 | general error-propagation discipline |
| 2 | `main() { … }; main "$@"` wrap (arp242 canonical idiom) | lines 138 + 261 | **T-PARTIAL-DOWNLOAD-1** — partial download → unclosed function → bash syntax error → NO execution. Without this, truncated download could execute `rm -rf $TMP_DIR` with unset `$TMP_DIR` → `rm -rf /`. |
| 3 | `curl -fsSL` (NOT `curl -L`) | lines 197, 198 | **T-CURL-PIPE-404-HTML-1** — `-f` fails on 4xx/5xx; without it, GitHub's 404 HTML page could pipe into bash. `-S` shows errors despite `-s` silent; `-L` follows GitHub's redirect chain. |
| 4 | SHA-256 verify BEFORE `tar xzf` extract | lines 201-202 (verify) vs 207 (extract) | **T-SHA256-VERIFY-BEFORE-EXTRACT-1 (HIGH, STOP-THE-LINE)** — verifying AFTER extract would let malicious tar entries write to `~/.local/bin/` first. Cross-plan with Plan 10-01 (release.yml produces per-asset `.sha256` companion). |
| 5 | Idempotency via existing-binary `--version` check | lines 165-180 | perf optimization — skip ~141MB download when target version already installed |
| 6 | macOS Gatekeeper interactive OFFER (`xattr -d com.apple.quarantine`); auto-mode prints NOTICE + skips | lines 80-100 (helper) + 220-222 (call site) | **T-MACOS-QUARANTINE-1 (LOW, accepted residual)** — Plan 10-01 SECURITY.md row owns the v1.5+ mitigation path (Apple Developer cert + notarytool) |
| 7 | PATH check warn-only — does NOT auto-edit `~/.bashrc` / `~/.zshrc` | lines 225-227 | **T-PATH-AUTO-EDIT-1 (MEDIUM)** — auto-editing user's shell rc would conflict with user's own shell config |
| 8 | Refusal arms for linux-arm64 + Windows + unknown OS/arch with `use 'npm install -g vaultpilot-mcp'` fallback | lines 151-156 + helper `refuse_unsupported` line 73 | **ROADMAP success-criterion #1 lock** — strict refusal preserves SHA-256 verify chain (no fallback to source-build on unsupported platforms) |

Helper functions (per `<implementation_guidance>` detail): `detect_os` + `detect_arch` + `refuse_unsupported` + `log_info` / `log_warn` / `fail` + `confirm_overwrite` + `offer_strip_quarantine` + `register_with_mcp_clients_and_maybe_setup` + `maybe_emit_envelope`.

Env-var-driven mode flags (no positional flag parsing in v1.4):

| Env var | Default | Effect |
|---------|---------|--------|
| `VAULTPILOT_MCP_VERSION` | `latest` | Pin a specific release tag (e.g. `v1.4.0-rc1`) |
| `VAULTPILOT_MCP_INSTALL_DIR` | `~/.local/bin` | Override install directory |
| `VAULTPILOT_MCP_NO_SETUP=1` | unset | Skip MCP client registration after install |
| `VAULTPILOT_MCP_AUTO=1` | unset | Non-interactive — assume Y to all prompts (Gatekeeper, overwrite) |
| `VAULTPILOT_MCP_JSON=1` | unset | Emit InstallEnvelope JSON to stdout |
| `VAULTPILOT_MCP_DRY_RUN=1` | unset | Resolve URL + arch only; skip download/install (smoke-test path) |

The `--dry-run` / `--register-only` / `--force-overwrite` flag forms are v1.4.1+ ergonomics (documented in `<deferred>`).

### 2. `install.ps1` (NEW — 176 LOC PowerShell; FIRST PowerShell script in repo)

Ships AS release asset via Plan 10-01 release.yml `cp ../install.ps1 release-assets/` step. PowerShell idiomatic mirror of install.sh:

| install.sh primitive | install.ps1 equivalent |
|---------------------|------------------------|
| `set -euo pipefail` | `$ErrorActionPreference = 'Stop'` |
| `main() { … }; main "$@"` | `function Invoke-VaultPilotInstall { … }; Invoke-VaultPilotInstall` (lines 56 + 175 — partial-download safety) |
| `curl -fsSL` | `Invoke-WebRequest -UseBasicParsing` (line 109; `-UseBasicParsing` avoids IE engine dep; throws on non-200 by default) |
| `shasum -a 256 -c` | `Get-FileHash -Algorithm SHA256` + Compare against `.sha256` companion (lines 114-118) |
| `tar xzf` | `Expand-Archive -Path … -DestinationPath … -Force` (line 124) |
| `xattr -d com.apple.quarantine` OFFER | `Unblock-File -Path` NOTICE (lines 127-131 — T-WINDOWS-SMARTSCREEN-1) |
| `export PATH=…` warn | `[Environment]::SetEnvironmentVariable('PATH', …, 'User')` (lines 133-139 — HKCU; no admin) |
| `detect_arch` | `[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture` (line 70) |
| `refuse_unsupported` | `Write-Error … ; exit 1` for non-x64 (lines 71-79) |

Arch detection via .NET's `RuntimeInformation` handles the Rosetta-on-Apple-Silicon edge case correctly on Windows (no false `x86_64` reading); refuses `Arm64` cleanly with the npm fallback message.

The `Invoke-RegisterMcpClients` function (lines 35-44) pipes a JSON payload (`{"registerWith":["claude-code","claude-desktop","cursor"]}`) into the installed binary's `setup --non-interactive --json` subcommand — same delegation pattern as install.sh's `register_with_mcp_clients_and_maybe_setup` helper.

### 3. `src/diagnostics/install-envelope.ts` (+5 lines additive — APPEND-ONLY)

```typescript
export type CheckId =
  | "node-version"                           // FROZEN Phase 1
  | "binary-spawn"                           // FROZEN Phase 1
  | "wallet-connect-key"                     // FROZEN Phase 1
  | "ethereum-rpc"                           // FROZEN Phase 1
  | "config-file"                            // FROZEN Phase 1
  // ── Phase 10 / Plan 10-03 (setup wizard + MCP client register) ──
  | "config-file-write"
  | "mcp-client-register-claude-code"
  | "mcp-client-register-claude-desktop"
  | "mcp-client-register-cursor"
  | "ledger-pairing"
  // ── Phase 10 / Plan 10-02 (install.sh + install.ps1) ──
  | "binary-download"                        // Plan 10-02 — SHA-256 verified download
  | "binary-install"                         // chmod + move to install dir
  | "path-presence"                          // is install dir on $PATH?
  | "quarantine-attr";                       // macOS — was xattr stripped?
```

Union: 14 entries total (5 Phase 1 + 5 Plan 10-03 + 4 Plan 10-02). **`ENVELOPE_VERSION` stays at 1 — T-INSTALL-ENVELOPE-COMPAT-1 invariant preserved.** Phase 1 `--check --json` consumers stay byte-compatible — they see `envelope_version: 1` and parse `checks[]` as an array of `{id, level, message}` objects; new `id` literals don't break parsing (the `id` field is opaque to the consumer's POV).

`CheckLevel` + `CheckResult` + `InstallEnvelope` + `escalateStatus` BYTE-FROZEN. Plan 10-03's setup-wizard comment-block at lines 11-16 preserved verbatim; Plan 10-02's install.sh-batch comment-block APPENDED at lines 17-21 (W-2 mitigation from 10-CHECK — APPEND-ONLY at end-of-union avoids merge collision and makes the additive provenance visible to future readers).

### 4. `test/install-envelope-shape.test.ts` (NEW — 18 cases, 300 LOC)

Source-grep + tsc-compile-time gate discipline: each CheckId literal asserted by both (a) source-level string presence via `ENVELOPE_SOURCE.toContain(\`"${id}"\`)`; (b) `assertCheckId(id)` compile-time gate (drift in the union shape errors at tsc time). Belt-and-braces: a source-file drift that satisfies grep but breaks the type fails at compile time, not just at runtime.

| Case | Anchor |
|------|--------|
| 1 | **T-INSTALL-ENVELOPE-COMPAT-1 — `ENVELOPE_VERSION === 1`** (no version bump per RESEARCH § Topic 9 line 923) |
| 2 | All 5 Phase 1 CheckId literals present (source-grep + assertCheckId) |
| 3 | All 5 Plan 10-03 setup-wizard literals present |
| 4 | All 4 Plan 10-02 install.sh-batch literals present |
| 5 | CheckId union has 14 entries total |
| 6 | `escalateStatus` all-ok → `'ok'` |
| 7 | `escalateStatus` ok + warn → `'warn'` |
| 8 | `escalateStatus` ok + warn + error → `'error'` |
| 9 | `escalateStatus` empty → `'ok'` (Phase 1 baseline) |
| 10 | `InstallEnvelope` shape: envelope_version + status + checks + metadata |
| 11 | metadata sub-shape: vaultpilot_mcp_version + node_version (Phase 1 FROZEN keys) |
| 12 | Sample install.sh `--json` envelope (POSIX path) parses + escalates correctly |
| 13 | Sample install.ps1 `--Json` envelope (Windows path) parses + escalates correctly |
| 14 | Sample setup-wizard `--non-interactive --json` envelope (Plan 10-03 cross-test) parses |
| 15 | `CheckResult` shape: id + level + message |
| 16 | `CheckLevel` union has 3 entries (`ok` / `warn` / `error`); source-grep proves frozen shape |
| 17 | **T-INSTALL-ENVELOPE-COMPAT-1 forward-compat — Phase 1 consumer parses a post-Phase-10 envelope without error** (new CheckId literals don't break parsing) |
| 18 | Comment-block provenance discipline preserved — both Plan 10-03 + Plan 10-02 headers present |

## Deviations from Plan

None. Plan executed exactly as written.

The plan's `<action>` Step 6 + Step 7 (`SECURITY.md` + `README.md` additive notes "IF NEEDED") were explicitly conditional. Both not needed:

- **SECURITY.md**: Plan 10-01's `## v1.4 Residual Risks (Distribution)` rows (lines 108-109) already name the install.sh xattr OFFER + install.ps1 `Unblock-File` mechanisms verbatim. An additive Plan 10-02 cross-reference paragraph would duplicate the row content — direct CLAUDE.md `Documentation Style — concise, non-redundant, sharp` violation. Recorded as a decision for traceability.
- **README.md**: Plan 10-01's `## Install` section (lines 78-92, 3 one-liners) + Plan 10-03's `## Setup` section already cover the user-facing surface. No install.sh / install.ps1 behavior note is non-obvious from the one-liners themselves.

## FROZEN-Area Assertion: LARGEST of Any Phase 10 Plan

`git diff origin/main` against the FROZEN list returns EMPTY:

- ALL `src/signing/*` (cryptographic-binding chain + Plan 10-04's `RATE_LIMIT_EXCEEDED` error code) UNCHANGED
- ALL `src/tools/*` (8 prepare tools + preview_send + send_transaction + verify_tx_decode + get_verification_artifact + get_tx_verification + request_capability + register-all + pair_ledger_live_* + read tools) UNCHANGED
- ALL `src/protocols/*` (ERC-20, WETH9, Aave V3) UNCHANGED
- ALL `src/clients/*` (etherscan, fourbyte, defillama) UNCHANGED
- ALL `src/security/*` (Phase 9 surface + Plan 10-04 request-capability-rate-limit) UNCHANGED
- `src/wallet/session-manager.ts`, `src/chains/registry.ts` UNCHANGED
- ALL `src/config/*` (contracts.ts + env.ts + config-file.ts entirety — Plan 10-03's writeConfigFile preserved) UNCHANGED
- ALL `src/cli/*` (Plan 10-03 surface — 5 files) UNCHANGED
- `src/index.ts` (Plan 10-03's `setup` subcommand routing preserved), `src/server.ts` UNCHANGED

ONLY src/ touch in Plan 10-02 is the +5-line CheckId widening in `src/diagnostics/install-envelope.ts`. Fixtures A-J (test/signing-fingerprint.test.ts + test/signing-presign-hash.test.ts hardcoded literals) UNCHANGED.

## Test Trajectory: 970 → 988 (+18, matches plan estimate exactly)

```
✓ Test Files  87 passed (87)
✓ Tests       988 passed (988)
   Start at  18:50:58
   Duration  9.74s
```

`npm run typecheck` clean. `npm run build` (existing tsc → dist/) clean. `bash -n install.sh` syntax check clean. Local dry-run smoke (`VAULTPILOT_MCP_DRY_RUN=1 VAULTPILOT_MCP_JSON=1 bash install.sh` on macos-arm64 host) emits well-formed envelope to stdout — log lines to stderr, JSON to stdout (CLAUDE.md `Stderr for diagnostics, stdout for MCP protocol` analogue holds).

## Threat-Coverage Self-Check

| Threat | Severity | Mitigation | Asserted by |
|--------|----------|-----------|-------------|
| **T-SHA256-VERIFY-BEFORE-EXTRACT-1** | high (STOP-THE-LINE) | `shasum -a 256 -c` BEFORE `tar xzf` (install.sh); `Get-FileHash` BEFORE `Expand-Archive` (install.ps1) | install.sh lines 201-202 vs 207; install.ps1 lines 114-118 vs 124 |
| **T-INSTALL-ENVELOPE-COMPAT-1** | high (STOP-THE-LINE) | `ENVELOPE_VERSION` stays 1; APPEND-ONLY CheckId widening | test/install-envelope-shape.test.ts Cases 1 + 17 |
| **T-PARTIAL-DOWNLOAD-1** | high | `main() { … }; main "$@"` arp242 idiom (install.sh); `Invoke-VaultPilotInstall { … }; Invoke-VaultPilotInstall` function wrap (install.ps1) | install.sh line 138 + 261; install.ps1 line 56 + 175 |
| **T-INSTALL-MITM-1** (cross-plan with Plan 10-01) | high | `curl -fsSL` (TLS + fail-fast) + SHA-256 verify against per-asset .sha256 (produced by Plan 10-01 release.yml) | install.sh `curl -fsSL` + `shasum -c` chain; install.ps1 `Invoke-WebRequest` + `Get-FileHash` chain |
| **T-CURL-PIPE-404-HTML-1** | high | `curl -fsSL` — `-f` fails on 4xx/5xx; without it 404 HTML pipes into bash | install.sh lines 197, 198 |
| **T-MACOS-QUARANTINE-1** | low (accept v1.4) | install.sh interactive OFFER (`offer_strip_quarantine` helper); auto-mode prints NOTICE + skips | install.sh lines 80-100 + 220-222 |
| **T-WINDOWS-SMARTSCREEN-1** | low (accept v1.4) | install.ps1 SmartScreen `Unblock-File` NOTICE block | install.ps1 lines 127-131 |
| **T-PATH-AUTO-EDIT-1** | medium | install.sh warn-only (no shell rc edit); install.ps1 uses HKCU User-scope (non-invasive) | install.sh lines 225-227; install.ps1 lines 133-139 |
| **T-FROZEN-SIGNING-1** | high (STOP-THE-LINE) | `git diff origin/main` against FROZEN list returns EMPTY | execute-time inline gate (Plan's `<verify>` block) |

## Hooks for Phase 10 Close-Out

**Plan 10-02 is the LAST execute plan in Phase 10.** v1.x is code-complete after this lands.

Next steps (Phase 10 close-out chore, owned by orchestrator / next session):

1. **Phase 10 close-out chore** — `/gsd-mark-phase-complete 10` (or equivalent orchestrator gate) to flip ROADMAP.md Phase 10 status to `code-complete` + write the phase-level SUMMARY-of-summaries linking 10-01, 10-02, 10-03, 10-04.
2. **v1.4.0-rc1 prerelease tag** — first end-to-end exercise of the release pipeline. `git tag v1.4.0-rc1 && git push --tags` triggers Plan 10-01's release.yml; produces 4 cross-compiled binaries + per-asset .sha256 + combined SHA256SUMS.txt + install.sh + install.ps1 as release assets. Validates the curl-pipe URL resolution end-to-end.
3. **v1.4.1 follow-up plan** (carry-forward from 10-01 SUMMARY) — pkg ESM `@modelcontextprotocol/sdk` subpath-export resolution regression still gates v1.4.0 GA. Recovery options enumerated in 10-01 SUMMARY: (a) flip `pkg.sea = true` in package.json; (b) refactor `src/server.ts` SDK imports to deep CJS paths (touches FROZEN — needs its own gate); (c) package.json `imports` field map. NOT in Plan 10-02 scope.
4. **Verify-phase manual integration smoke** — `bash install.sh` on a fresh Linux container (Ubuntu 22.04 / Alpine 3.20) against the `v1.4.0-rc1` tag. Validates download + SHA-256 verify + extract + install + MCP client registration delegation end-to-end. Deferred per RESEARCH § Topic 10 line 1038 (vitest's child_process piping is fragile for bash + PowerShell; manual smoke against a real release tag is the v1.4 integration test posture).

## Carry-Forward Loose Ends (NOT Plan 10-02 Scope; Surfaced for Phase 10 Close-Out)

These loose ends are documented in prior summaries; surfacing them here so the Phase 10 close-out chore can sweep them in one place:

- **v1.4.1 — pkg ESM @modelcontextprotocol/sdk subpath-export resolution regression** (10-01 SUMMARY). Build pipeline produces all 4 binaries; binaries fail at runtime with `Cannot find package '@modelcontextprotocol/sdk'`. Gates v1.4.0 GA. Recovery options enumerated.
- **Sister-repo CI workflow scope loose-end** (09-01 + 10-01 SUMMARY). The Phase 9 vaultpilot-preflight skill repo's CI workflow needs to ship before v1.3+ defense-in-depth claims hold end-to-end. NOT a main-repo plan; deferred to v1.5+ planning gate.
- **Subagent-cwd discipline 3rd recurrence pattern surfaced in 10-03** (per 10-03 SUMMARY). Multiple times across Phase 10 wave-1 execute agents have drifted out of the worktree mid-task and committed to main. Plan 10-02 executor enforced the `<pre_commit_head_assertion>` + `<cwd-drift assertion>` gates at every commit; verified clean. Worth a global CLAUDE.md `Subagent-cwd discipline` rule? Surfaced for user lessons-learned proposal at Phase 10 close-out.

## Accepted Residuals (v1.4)

- **macOS Gatekeeper friction on first run** (T-MACOS-QUARANTINE-1, low). install.sh OFFERS `xattr -d com.apple.quarantine`; user remediation: accept the prompt OR run `xattr -d` manually OR right-click → Open → confirm. v1.5+ Apple Developer cert + notarytool mitigates. Documented in Plan 10-01 SECURITY.md row 108.
- **Windows SmartScreen friction on first run** (T-WINDOWS-SMARTSCREEN-1, low). install.ps1 NOTICE for `Unblock-File`; user remediation: right-click → Properties → Unblock. v1.5+ Authenticode mitigates. Documented in Plan 10-01 SECURITY.md row 109.
- **install.sh emits raw-JSON envelope via `printf`** (v1.4 ergonomic limitation). `vaultpilot-mcp setup --emit-install-envelope` flag is v1.4.1+; v1.4 install.sh uses `printf` with belt-and-braces JSON-escape against pre-constructed strings (~25 lines of shell). install.ps1 uses `ConvertTo-Json -Compress -Depth 4`.
- **install.sh has no `--dry-run` flag** (only env var `VAULTPILOT_MCP_DRY_RUN=1`). Flag form is v1.4.1+ sugar. v1.4 env-var form is functionally equivalent.
- **install.sh shell-out smoke tests DEFERRED to verify-phase** (RESEARCH § Topic 10 line 1038). vitest child_process piping for bash + PowerShell is fragile (line-buffering + signal handling + STDIN-not-TTY edge cases). Manual smoke against `v1.4.0-rc1` on a fresh Linux container IS the v1.4 integration test.
- **install.sh PATH check is warn-only** (T-PATH-AUTO-EDIT-1 mitigation). User adds `export PATH="$HOME/.local/bin:$PATH"` manually. install.ps1 USES HKCU PATH-append (non-invasive); install.sh skips the analogous touch on POSIX where shell rc files are more diverse + user-curated.
- **Apple Silicon users running shell through Rosetta get the x64 binary** (Assumption A12). `uname -m` returns `x86_64` falsely under Rosetta; install.sh ships x64 binary; the x64 binary runs via Rosetta with degraded perf but is FUNCTIONALLY CORRECT (pure JS via viem/WC v2/MCP SDK; Rosetta correctness anchors on Node's Rosetta correctness which Apple maintains). v1.5+ may detect via `sysctl -nq hw.optional.arm64`.
- **curl-pipe URL points at versioned release asset, NOT mutable main branch raw file**. A main-branch update to install.sh does NOT change curl-pipe behavior until the next tagged release. Documented in install.sh top-of-file comment + Plan 10-01 release.yml `cp` step.

## Deferred (v1.4.1+ / v1.5+)

- **install.sh `--dry-run` flag** — v1.4.1 ergonomic. v1.4 env-var form (`VAULTPILOT_MCP_DRY_RUN=1`) is functionally equivalent.
- **install.sh `--register-only` flag** — v1.4.1 ergonomic. v1.4 ships full install + register; re-register requires re-run.
- **install.sh `--force-overwrite` flag** — v1.4.1 ergonomic. v1.4 auto-overwrites in `VAULTPILOT_MCP_AUTO=1` mode; interactive mode prompts.
- **`vaultpilot-mcp setup --emit-install-envelope` flag** (RESEARCH § Topic 9 line 960) — v1.4.1 ergonomic. install.sh emits raw-JSON envelope via `printf` for v1.4; v1.4.1 routes through the binary for cleaner construction.
- **install.sh / install.ps1 vitest shell-out smoke tests** — DEFERRED to verify-phase manual integration test per RESEARCH § Topic 10 line 1038.
- **Cosign signature verification on install.sh download** — v1.5+ scope. Aligned with Plan 10-01 sigstore SLSA mitigation path.
- **install.sh auto-edit shell rc (`~/.bashrc` / `~/.zshrc`)** — DELIBERATELY OUT OF SCOPE for v1.x. Invasive; conflicts with user's shell config. v1.4 ships warn-only.
- **install.sh download progress bar** — v1.5+ ergonomic. v1.4 `curl -fsSL` is silent.
- **install.sh Homebrew formula** — v1.5+ scope. Homebrew 2026 tightening (RESEARCH § Topic 3 line 215) requires signing.
- **Per-platform binary auto-update mechanism** — v3.x scope. v1.x users re-run install.sh manually for upgrades.
- **install.sh telemetry / install metrics** — DELIBERATELY OUT OF SCOPE. Self-custodial-only positioning; no install-time call-home.

## Self-Check: PASSED

- [x] `install.sh` exists at repo root with shebang `#!/usr/bin/env bash`; executable bit set (`100755`)
- [x] `install.sh` opens with `set -euo pipefail` at top (line 41)
- [x] `install.sh` body wrapped in `main() { … }; main "$@"` per arp242 canonical idiom (T-PARTIAL-DOWNLOAD-1; lines 138 + 261)
- [x] `install.sh` uses `curl -fsSL` (NOT `curl -L`) for ALL downloads (T-CURL-PIPE-404-HTML-1; lines 197, 198)
- [x] `install.sh` verifies SHA-256 via `shasum -a 256 -c "$archive.sha256"` BEFORE `tar xzf` extraction (T-SHA256-VERIFY-BEFORE-EXTRACT-1; lines 201-202 vs 207)
- [x] `install.sh` has idempotency via existing-binary `--version` check (lines 165-180)
- [x] `install.sh` has macOS Gatekeeper interactive OFFER + auto-mode NOTICE fallback (`offer_strip_quarantine` helper lines 80-100; call site lines 220-222)
- [x] `install.sh` PATH check is warn-only (lines 225-227)
- [x] `install.sh` has refusal arms for linux-arm64 + Windows + unknown OS/arch with `use 'npm install -g vaultpilot-mcp'` fallback (lines 151-156 + helper line 73)
- [x] `install.sh` invokes installed binary's `vaultpilot-mcp setup --non-interactive --json` for MCP client registration (`register_with_mcp_clients_and_maybe_setup` helper lines 105-115; call site line 232)
- [x] `install.sh` `--json` mode (via `VAULTPILOT_MCP_JSON=1` env) emits InstallEnvelope-shaped JSON to stdout (`maybe_emit_envelope` helper lines 119-136)
- [x] `install.ps1` exists at repo root with `$ErrorActionPreference = 'Stop'` (line 33)
- [x] `install.ps1` uses `Invoke-WebRequest -UseBasicParsing` for downloads (lines 109-110)
- [x] `install.ps1` verifies SHA-256 via `Get-FileHash -Algorithm SHA256` BEFORE `Expand-Archive` (lines 114-118 vs 124)
- [x] `install.ps1` has SmartScreen `Unblock-File` workaround NOTICE (lines 127-131)
- [x] `install.ps1` adds install dir to user PATH via `[Environment]::SetEnvironmentVariable('PATH', …, 'User')` (HKCU; non-admin; lines 133-139)
- [x] `install.ps1` has refusal for Windows-arm64 + non-x64 with npm fallback (lines 71-79)
- [x] `src/diagnostics/install-envelope.ts` has 4 NEW install.sh-batch CheckId literals in a grouped Plan 10-02 comment-block AFTER Plan 10-03's 5 setup-wizard literals; union has 14 entries total (5 Phase 1 + 5 Plan 10-03 + 4 Plan 10-02)
- [x] `ENVELOPE_VERSION === 1` (T-INSTALL-ENVELOPE-COMPAT-1 — no version bump)
- [x] `CheckLevel` + `CheckResult` + `InstallEnvelope` + `escalateStatus` BYTE-FROZEN
- [x] `SECURITY.md` UNCHANGED (Plan 10-01 row 108-109 already names mechanism; CLAUDE.md `state each idea once` decision)
- [x] `README.md` UNCHANGED (Plan 10-01 + Plan 10-03 one-liners sufficient; CLAUDE.md decision)
- [x] `test/install-envelope-shape.test.ts` 18 cases all green; T-INSTALL-ENVELOPE-COMPAT-1 anchors at Cases 1 + 17; all 14 CheckId literals covered; escalateStatus mixed-level; sample envelope shapes from install.sh + install.ps1 + setup-wizard parsing; comment-block provenance discipline (Case 18)
- [x] `npm run typecheck` + `npm run build` clean
- [x] Full `npm test` green (970 → 988, +18 matches plan estimate exactly)
- [x] `bash -n install.sh` syntax check clean
- [x] Local dry-run smoke (`VAULTPILOT_MCP_DRY_RUN=1 VAULTPILOT_MCP_JSON=1 bash install.sh` on macos-arm64 host) emits well-formed envelope; stderr carries `[install.sh]` log lines; stdout carries JSON
- [x] **FROZEN-area assertion (LARGEST for Phase 10)**: `git diff origin/main -- src/signing/ src/tools/ src/protocols/ src/clients/ src/security/ src/wallet/ src/chains/ src/config/ src/cli/ src/index.ts src/server.ts` returns EMPTY
- [x] `src/diagnostics/install-envelope.ts` plan-checker dimension: `git diff origin/main -- src/diagnostics/install-envelope.ts` shows ONLY additive 4 install.sh-batch CheckId literals + Plan 10-02 comment-block (Plan 10-03's 5 literals preserved from Wave 1)
- [x] Atomic impl commit `6a8a673` recorded; install.sh landed as `100755` (executable bit preserved through git)

All Plan 10-02 success criteria met. **Phase 10 is now CODE-COMPLETE pending the v1.4.1 follow-up plan (pkg ESM SDK resolution regression) and the verify-phase manual integration smoke against `v1.4.0-rc1`.** v1.x is code-complete after Phase 10 close-out chore lands.
