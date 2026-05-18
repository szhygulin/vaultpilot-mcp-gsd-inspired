---
phase: 10
plan: 03
subsystem: "src/cli/ shelf (5 NEW files) + `vaultpilot-mcp setup` subcommand + Zod schema SOT shared by interactive + non-interactive paths + ADDITIVE writeConfigFile() after line 95 of config-file.ts + MCP client auto-registration (claude-code / claude-desktop / cursor)"
tags: [setup-wizard, clack-prompts, df-2-locked, zod-sot, t-config-leak-1, t-wizard-schema-sot-1, t-wizard-config-corrupt-1, t-malformed-mcp-client-config-1, t-mcp-client-overwrite-1, t-ledger-pairing-duplication-1, t-mode-permissions-leak-1, atomic-write, mode-0o600, _paths-spy-affordance, install-envelope-widening, first-occupant-src-cli, dist-42, phase-10, wave-1, v1.4]
requirements: [DIST-42]
wave: 1
status: complete
completed: 2026-05-18
dependency-graph:
  requires:
    - "Phase 1 install-envelope.ts surface (ENVELOPE_VERSION / CheckLevel / CheckResult / InstallEnvelope / escalateStatus) — APPEND-ONLY widening of the CheckId union, no version bump"
    - "Phase 1 src/index.ts arg-routing block — APPEND-ONLY `setup` subcommand inserted between `--version` block and `startServer()`"
    - "Phase 1 src/diagnostics/check.ts::runCheck() shape — mirror for setup.ts dispatch + per-step CheckResult accumulation"
    - "Phase 3 pair_ledger_live_start + pair_ledger_live_wait tool handlers + Phase 4 tool registry (`registerTool` / `getRegisteredTool` from src/tools/index.ts) — wizard Step 3 delegation per Assumption A4"
    - "Phase 5 readConfigFile() + _paths indirection + ConfigFile / ConfigFileResult types — companion APPEND-ONLY writeConfigFile() AFTER line 95"
    - "main HEAD 666baf2 (Phase 10 Plan 10-01 — @yao-pkg/pkg binary build pipeline + release.yml — independent, parallel-eligible)"
  provides:
    - "src/cli/ NEW shelf (first occupant — mirrors Phase 9's first-occupancy of src/security/) with 5 NEW files: setup.ts (entry-point dispatch), setup-prompts.ts (6-step @clack/prompts wizard), setup-non-interactive.ts (stdin JSON reader), setup-mcp-clients.ts (claude-code / claude-desktop / cursor detection + JSON merge), setup-schema.ts (Zod SOT + redactForEnvelope)"
    - "vaultpilot-mcp setup CLI subcommand routed from src/index.ts AFTER --version block and BEFORE startServer()"
    - "src/config/config-file.ts ADDITIVE writeConfigFile(merged: ConfigFile): Promise<void> AFTER line 95 — atomic-write tmp + POSIX rename, mode 0o600 at write time, routed through _paths.getConfigPath() spy-affordance; FROZEN readConfigFile + _paths + ConfigFile + ConfigFileResult at lines 1-95 BYTE-FROZEN"
    - "src/diagnostics/install-envelope.ts +5 NEW CheckId literals (config-file-write + mcp-client-register-claude-code + mcp-client-register-claude-desktop + mcp-client-register-cursor + ledger-pairing) — ENVELOPE_VERSION + CheckLevel + CheckResult + InstallEnvelope + escalateStatus BYTE-FROZEN; no version bump (T-INSTALL-ENVELOPE-COMPAT-1)"
    - "package.json +2 dependencies (@clack/prompts ^1.4.0 + zod ^4.4.3); existing Phase 1-9 deps + Plan 10-01 pkg config + devDeps BYTE-FROZEN; package-lock.json regenerated"
    - "README.md +1 NEW ## Setup section — 3 invocation forms (interactive, non-interactive --json, --dry-run); existing Phase 1-9 README + Plan 10-01 ## Install section BYTE-FROZEN"
  affects:
    - "test/cli-setup-schema.test.ts (NEW — 11 cases; T-WIZARD-SCHEMA-SOT-1 cross-test Case 11)"
    - "test/cli-setup-mcp-clients.test.ts (NEW — 18 cases; T-MALFORMED-MCP-CLIENT-CONFIG-1 + T-MCP-CLIENT-OVERWRITE-1 mitigations)"
    - "test/cli-setup-non-interactive.test.ts (NEW — 11 cases; T-CONFIG-LEAK-1 3-sentinel scan at Test 5 + negative-control Test 6)"
    - "test/cli-setup-interactive.test.ts (NEW — 7 cases; @clack/prompts vi.mock script; T-LEDGER-PAIRING-DUPLICATION-1 mitigation at Test 3; T-CONFIG-LEAK-1 wizard-stderr sentinel scan at Test 7)"
    - "test/config-file-write.test.ts (NEW — 8 cases; T-WIZARD-CONFIG-CORRUPT-1 atomic-write + T-MODE-PERMISSIONS-LEAK-1 mode 0o600 mitigations)"
  unblocks:
    - "Plan 10-02 install.sh + install.ps1 — install scripts import detectMcpClients + registerWithJsonConfig from src/cli/setup-mcp-clients.ts (via the installed binary's `vaultpilot-mcp setup --non-interactive --json` flow), and append 4 NEW install-stage CheckId literals to the SAME install-envelope.ts union (APPEND-ONLY at end-of-union — Plan 10-03's 5 literals + Plan 10-02's 4 literals coexist without merge conflict)"
    - "Plan 10-04 request_capability — independent additive surface in src/tools/ + src/security/; no Plan 10-03 coupling"
    - "v1.4 GA — first end-to-end install flow: `npm install -g vaultpilot-mcp` (or curl-pipe per Plan 10-01) → `vaultpilot-mcp setup` (interactive) → registered with detected MCP clients"
tech-stack:
  added:
    - "@clack/prompts@^1.4.0 (dependency; ESM-first; 0 native deps; pulls @clack/core + sisteransi + picocolors as transitive). DF-2 LOCKED at planning gate; re-verified `npm view @clack/prompts version` returned `1.4.0` at execute time — caret-pin honored."
    - "zod@^4.4.3 (dependency; NEW — confirmed ABSENT in pre-edit package.json per RESEARCH § Topic 9 line 1026 verification step; freshly added at latest stable). Powers SetupPayloadSchema SOT for both interactive + non-interactive validation paths."
  patterns:
    - "DF-2 LOCKED @clack/prompts@^1.4.0 over prompts + @inquirer/prompts + native Node readline per RESEARCH § DF-2: (a) ESM-first matches project posture (Phases 1-9 are pure ESM); (b) cleanest API for multi-step wizards — intro/text/select/multiselect/confirm/outro map 1:1 to the 6 wizard steps; (c) 0 native deps — clean binary-bundle story for the pkg-built binary in Plan 10-01; (d) clean non-interactive separation — `setup-non-interactive.ts` never imports @clack/prompts, so CI / piped invocations don't pay the load cost."
    - "First-occupant-of-`src/cli/`-shelf discipline. Verified at execute time `src/cli/` did not exist (`ls src/cli/ 2>/dev/null` empty); created via `mkdir -p src/cli`; carved as 5-file shelf: setup.ts (dispatch), setup-prompts.ts (interactive), setup-non-interactive.ts (stdin JSON), setup-mcp-clients.ts (per-client detection + merge), setup-schema.ts (Zod SOT). Mirrors Phase 9's first-occupancy of `src/security/`."
    - "Single Zod SOT across interactive + non-interactive paths (T-WIZARD-SCHEMA-SOT-1). Without single SOT the two paths drift; non-interactive users get a different config shape than interactive users. setup-schema.ts exports `SetupPayloadSchema` + `SetupPayload` type + `redactForEnvelope`. Both `setup-prompts.ts` (after wizard step collection) and `setup-non-interactive.ts` (after JSON.parse) call `SetupPayloadSchema.safeParse(...)` against the SAME schema. Cross-test in cli-setup-schema.test.ts Case 11 greps both consumer files for the `SetupPayloadSchema` import — drift in either consumer's schema-import path breaks the assertion."
    - "T-CONFIG-LEAK-1 3-sentinel substring scan (Plan 05-03 + Plan 08-01 precedent). cli-setup-non-interactive.test.ts Case 5 feeds payload with 3 distinguishable sentinel values (`sentinel-WC-12345-do-not-leak`, `sentinel-RPC-ABCDE-do-not-leak`, `SENTINELETHERSCAN12345ABCDE`), captures the FULL stdout byte-stream, and asserts NONE appear anywhere in the emitted JSON. `***REDACTED***` literal MUST appear (positive proof the redaction path executed). Case 6 is the negative-control: a real (non-dry-run) write DOES persist the secret to `~/.vaultpilot-mcp/config.json` (the disk is where secrets belong) — secret-on-disk vs secret-in-stdout is the correctness boundary."
    - "Atomic-write via tmp + POSIX rename (T-WIZARD-CONFIG-CORRUPT-1). Tmp file lives in `dirname(path)` — SAME filesystem as the target — so POSIX `rename()` atomicity holds. Using `os.tmpdir()` would EXDEV-fail when `/tmp` is tmpfs and `~/.vaultpilot-mcp/` is on the user's home filesystem. Mode 0o600 (owner-only) is passed to `writeFile` AT WRITE TIME — no post-write `chmod` race window where the file is world-readable. config-file-write.test.ts Test 3 asserts `lstatSync(cfgPath).mode & 0o777 === 0o600`."
    - "_paths spy-affordance reuse (Phase 5 pattern). writeConfigFile routes through the SAME `_paths.getConfigPath()` indirection as readConfigFile — a single `vi.spyOn(_paths, 'getConfigPath').mockReturnValue(tmpPath)` in the test redirects BOTH reads and writes to the per-test temp directory. ESM named-export bindings are immutable; the `_paths` object is the test seam. Sister to Plan 05-01's `_paths` introduction; Plan 10-03 lights up the write-side."
    - "MCP client JSON merge: read existing → spread-merge → preserve every non-`vaultpilot-mcp` `mcpServers.*` key + every non-`mcpServers` top-level key → replace `mcpServers.vaultpilot-mcp` entry. T-MCP-CLIENT-OVERWRITE-1 mitigation. Spread-merge over `existing.mcpServers ?? {}` makes the merge total-correctness over both 'fresh file' and 'pre-existing file with other servers' cases."
    - "Malformed-JSON refusal (T-MALFORMED-MCP-CLIENT-CONFIG-1). Pre-existing claude_desktop_config.json with invalid JSON triggers `throw new Error('Refused — ${configPath} is malformed JSON. Fix the file first, then re-run vaultpilot-mcp setup.')`. Silent overwrite would destroy the user's other registrations; explicit refusal makes the user remediate by hand. The test (cli-setup-mcp-clients.test.ts Test 10) asserts the malformed file stays untouched after the throw."
    - "Windows `cmd /c` wrap (Phase 1 INST-04 + RESEARCH § Topic 6 line 463). When the host is win32, the registered entry is `{ command: 'cmd', args: ['/c', binaryPath] }` instead of `{ command: binaryPath }`. Claude Desktop on Windows spawns `command` non-shell; `cmd /c` is required for `.exe` resolution + quoted-path handling. The branch is exercised deterministically by passing `wrapForWindows: true` to `registerWithJsonConfig` — no need to actually run on Windows."
    - "Ledger pairing delegation per Assumption A4 — wizard Step 3 reads `pair_ledger_live_start` + `pair_ledger_live_wait` handlers from the registered tool map (via `getRegisteredTool(...)` from `src/tools/index.ts`) and invokes them DIRECTLY. NO duplicated pairing logic. cli-setup-interactive.test.ts Test 3 registers fake handlers that match the real surface and asserts both spies fire (T-LEDGER-PAIRING-DUPLICATION-1 mitigation). Test 4 asserts that when handlers aren't registered, the wizard surfaces a clean `level: warn` message instead of crashing."
    - "tool-registry-getter pre-existed (`getRegisteredTool` in src/tools/index.ts, Phase 1-4 surface). No registry-getter additive refactor was needed at execute time — Assumption A4 verification passed first-shot."
    - "install-envelope CheckId APPEND-ONLY widening. ENVELOPE_VERSION stays at 1 (T-INSTALL-ENVELOPE-COMPAT-1 per RESEARCH § Topic 9 line 923) — Phase 1 `--check --json` consumers see byte-identical envelope shape; only the optional `checks[].id` discriminator grows. Plan 10-03 adds 5 literals; Plan 10-02 will append 4 more in the SAME union — APPEND-ONLY at end-of-union avoids merge collision."
    - "Stderr/stdout discipline (CLAUDE.md Conventions). `@clack/prompts` writes interactively to stderr (verified empirically at execute time); the wizard's Step 6 review block also goes to stderr (via `console.error(...)`); the final InstallEnvelope JSON in `--json` mode goes to stdout. cli-setup-interactive.test.ts Test 7 asserts the Step 6 review block IS redacted (the WC-id sentinel never appears on stderr even though it was the user's input — proof that the REDACTED summary path runs before the echo, not after)."
key-files:
  created:
    - "src/cli/setup.ts (NEW — 51 LOC; entry-point dispatch on `--non-interactive` flag; conditional `await import` of `./setup-prompts.js` or `./setup-non-interactive.js` keeps @clack/prompts off the load path when non-interactive)"
    - "src/cli/setup-prompts.ts (NEW — 432 LOC; 6-step @clack/prompts wizard; Step 3 Ledger pairing delegated via `getRegisteredTool('pair_ledger_live_start'|'_wait')` per Assumption A4; Step 6 REDACTED review block on stderr; conditional MCP client registration loop; passes the assembled payload through `SetupPayloadSchema.safeParse` BEFORE write — same SOT as the non-interactive path)"
    - "src/cli/setup-non-interactive.ts (NEW — 324 LOC; reads from process.stdin async iterator OR --config <path> flag; SetupPayloadSchema.safeParse; merge with existing config via FROZEN readConfigFile(); writeConfigFile() unless --dry-run; per-client register loop (claude-code shells out `claude mcp add` via the helper, claude-desktop / cursor via registerWithJsonConfig); emits InstallEnvelope to stdout with `redactForEnvelope(payload)` applied)"
    - "src/cli/setup-mcp-clients.ts (NEW — 200 LOC; `_clientEnv` spy-affordance object wrapping `platform` / `homedir` / `commandExists` so tests can simulate darwin / linux / win32 + claude-CLI-present without touching real OS state; `detectMcpClients()` returns 3 entries; `getClientConfigPath(name)` returns the canonical path even for undetected clients; `registerWithJsonConfig(configPath, binaryPath, wrapForWindows)` read-merge-write with malformed-JSON refusal; `registerWithClaudeCode(binaryPath)` idempotent `claude mcp remove` best-effort → `claude mcp add` chain)"
    - "src/cli/setup-schema.ts (NEW — 88 LOC; SetupPayloadSchema Zod object — strict mode; 7 optional fields: walletConnectProjectId / rpcUrl (https://-prefixed) / rpcProvider enum / rpcApiKey / etherscanApiKey (hex pattern) / registerWith enum-array / skipLedgerPairing; SetupPayload type inference; REDACTED_LITERAL = '***REDACTED***' export; `redactForEnvelope(payload)` replaces 4 secret-bearing fields with the literal — walletConnectProjectId, rpcUrl, rpcApiKey, etherscanApiKey)"
    - "test/cli-setup-schema.test.ts (NEW — 11 cases; round-trip / rejects-bad-rpcUrl / rejects-non-URL / rejects-bad-etherscan / accepts-empty-payload / rejects-extra-fields / rejects-bad-registerWith / redact-all-secrets / redact-undefined-stays-undefined / redact-3-sentinel-substring-scan / T-WIZARD-SCHEMA-SOT-1 cross-test-both-wizard-files-import-SetupPayloadSchema)"
    - "test/cli-setup-mcp-clients.test.ts (NEW — 18 cases; per-platform paths darwin / linux / win32 / claude-code-detected / claude-code-not-detected / getClientConfigPath / happy-path / preserves-other-server / preserves-top-level / REFUSES-malformed / Windows-wrap / POSIX-shape / idempotent-re-register / file-not-exist / 2-space-indent-trailing-newline / path-stability / throws-parent-missing / integration-mkdir-then-register)"
    - "test/cli-setup-non-interactive.test.ts (NEW — 11 cases; happy-path / Zod-rejects-http-url / invalid-JSON / --config-flag / **T-CONFIG-LEAK-1 3-sentinel substring scan (Test 5)** / **secrets-on-disk-but-not-stdout-negative-control (Test 6)** / --dry-run-skips-write / registerWith-3-clients / skipLedger-default / envelope-shape / _paths-spy-round-trip)"
    - "test/cli-setup-interactive.test.ts (NEW — 7 cases; full-happy-path / Step-6-decline / **Ledger-delegation-via-getRegisteredTool (Test 3 — T-LEDGER-PAIRING-DUPLICATION-1 mitigation)** / Ledger-handlers-absent / --dry-run-skips-write-AND-pairing / explicit-rpcUrl-path / **Step-6-review-on-stderr-IS-REDACTED (Test 7 — T-CONFIG-LEAK-1 at the wizard surface)**)"
    - "test/config-file-write.test.ts (NEW — 8 cases; writes-spied-path / 2-space-indent-trailing-newline / **mode-0o600 (T-MODE-PERMISSIONS-LEAK-1)** / creates-parent-recursively / **same-filesystem-tmp-no-orphan (T-WIZARD-CONFIG-CORRUPT-1)** / round-trip-with-readConfigFile / overwrite / empty-config)"
    - ".planning/phases/10-distribution-and-ergonomics/10-03-SUMMARY.md (NEW — this file)"
  modified:
    - "src/config/config-file.ts (+50 lines additive; +3 NEW imports `writeFile`/`mkdir`/`rename` from `node:fs/promises` + `dirname` from `node:path`; +1 NEW `writeConfigFile()` export AFTER line 95. Lines 1-95 — FROZEN `readConfigFile()` + `_paths` + `ConfigFile` + `ConfigFileResult` — BYTE-FROZEN per plan-checker dimension)"
    - "src/diagnostics/install-envelope.ts (+7 lines additive — `// ── Phase 10 / Plan 10-03 (setup wizard + MCP client register) ──` comment-block + 5 NEW CheckId literals appended at end-of-union. ENVELOPE_VERSION / CheckLevel / CheckResult / InstallEnvelope / escalateStatus BYTE-FROZEN; no version bump preserves Phase 1 `--check --json` byte-compat (T-INSTALL-ENVELOPE-COMPAT-1))"
    - "src/index.ts (+6 lines additive — +1 NEW `import { runSetup } from './cli/setup.js'` + 1 NEW conditional `if (args[0] === 'setup')` block inserted between `--version` block and `startServer()`. Existing `--check` block + `--version` block + `await startServer()` BYTE-FROZEN)"
    - "package.json (+3 lines additive — `@clack/prompts: ^1.4.0` + `zod: ^4.4.3` in `dependencies`. Existing Phase 1-9 deps + Plan 10-01 `pkg` config + 5 `build:binary*` scripts + `@yao-pkg/pkg` devDep BYTE-FROZEN — section-separated within the JSON file; trivial git auto-merge with Plans 10-01 + 10-04)"
    - "package-lock.json (regenerated — adds @clack/prompts + 4 transitive deps + zod). Existing Phase 1-9 + Plan 10-01 dep lock entries byte-frozen at the package-level."
    - "README.md (+19 lines additive — `## Setup` section above `## License` with 3 invocation forms — interactive, non-interactive --json, --dry-run. Existing Phase 1-9 README + Plan 10-01 `## Install` section BYTE-FROZEN)"
decisions:
  - "**DF-2 LOCKED @clack/prompts@^1.4.0 over prompts + @inquirer/prompts + native readline** — load-bearing for the wizard's UX shape AND the binary-bundle story. ESM-first design matches Phase 1-9 project posture (no CommonJS interop shims); intro/text/select/multiselect/confirm/outro API maps 1:1 to the 6 wizard steps; 0 native deps — important when Plan 10-01's pkg binary bundles the prompt library (no compile-from-source friction in cross-compile); clean non-interactive separation — `setup-non-interactive.ts` never imports @clack/prompts so CI / piped invocations don't pay the load cost. Locked at planning gate per RESEARCH § DF-2; re-verified `npm view @clack/prompts version` → `1.4.0` at execute time."
  - "**zod presence verification: ABSENT in pre-edit package.json — freshly added at @^4.4.3** (latest stable per `npm view zod version` at execute time). Per RESEARCH § Topic 9 line 1026 verification step. No version conflict; Phase 1-9 dep typings don't depend on a specific zod major. zod is the SOT for SetupPayloadSchema."
  - "**T-WIZARD-SCHEMA-SOT-1 invariant locked via single Zod schema** — `SetupPayloadSchema` in src/cli/setup-schema.ts. Both `setup-prompts.ts` (after wizard step collection) and `setup-non-interactive.ts` (after `JSON.parse`) call `SetupPayloadSchema.safeParse(...)`. Cross-test in cli-setup-schema.test.ts Case 11 greps both consumer files for the import — drift in either path breaks the assertion. Schema is `.strict()` — unknown extra fields rejected; this catches typos AND prevents stealth-config injection via misnamed keys."
  - "**T-CONFIG-LEAK-1 mitigated via redactForEnvelope() + 3-sentinel substring scan** (Plan 05-03 + Plan 08-01 precedent). 4 secret-bearing fields (walletConnectProjectId, rpcUrl, rpcApiKey, etherscanApiKey) get replaced with the literal `***REDACTED***` BEFORE any stdout emission. Test anchor at cli-setup-non-interactive.test.ts Test 5 — 3 distinguishable sentinels seeded; full captured stdout scanned; none appear. Negative-control Test 6 confirms non-dry-run writes DO persist secrets to disk (the disk is where secrets belong). Wizard-side anchor at cli-setup-interactive.test.ts Test 7 — Step-6 review block on stderr also redacted (the WC-id sentinel never echoed back even though the user typed it)."
  - "**T-WIZARD-CONFIG-CORRUPT-1 mitigated via atomic-write tmp + POSIX rename + mode 0o600 at write time** (NOT post-write chmod). tmp file lives in `dirname(path)` for same-filesystem requirement — `os.tmpdir()` would EXDEV-fail when /tmp is tmpfs. Mode passed to `writeFile` directly — no narrow race window where file is world-readable. config-file-write.test.ts Test 3 asserts `lstatSync(cfgPath).mode & 0o777 === 0o600`; Test 5 asserts the dir has exactly one new file post-write (no orphaned `.tmp-…` file)."
  - "**T-MALFORMED-MCP-CLIENT-CONFIG-1 mitigated via explicit refusal** — pre-existing claude_desktop_config.json / cursor mcp.json with malformed JSON triggers `throw new Error('Refused — … is malformed JSON. Fix the file first, then re-run vaultpilot-mcp setup.')`. cli-setup-mcp-clients.test.ts Test 10 asserts the malformed file stays untouched after the throw. Silent overwrite would destroy the user's other MCP-server registrations; explicit refusal forces remediation."
  - "**T-MCP-CLIENT-OVERWRITE-1 mitigated via spread-merge over `existing.mcpServers`** — every non-`vaultpilot-mcp` key in `mcpServers` is preserved; every non-`mcpServers` top-level key is preserved. cli-setup-mcp-clients.test.ts Test 8 (other-server-preserved) + Test 9 (top-level-key-preserved) + Test 13 (idempotent-re-register) cover the merge semantics."
  - "**T-LEDGER-PAIRING-DUPLICATION-1 mitigated via Assumption A4 delegation** — wizard Step 3 reads `pair_ledger_live_start` + `pair_ledger_live_wait` from the tool registry (`getRegisteredTool(...)` from src/tools/index.ts — pre-existing Phase 1-4 surface; no registry-getter additive refactor needed at execute time) and invokes them directly. NO duplicated pairing logic. cli-setup-interactive.test.ts Test 3 registers fake handlers and asserts both spies fire with the right argument shape (`pairingHandle` from start passed verbatim to wait). Test 4 covers the degraded-mode path: handlers absent → wizard surfaces `level: warn` ledger-pairing check, doesn't crash."
  - "**Install-envelope CheckId APPEND-ONLY widening (no version bump per RESEARCH § Topic 9 line 923 / T-INSTALL-ENVELOPE-COMPAT-1).** ENVELOPE_VERSION stays at 1. Phase 1 `--check --json` consumers see byte-identical envelope shape; only the optional `checks[].id` discriminator union grows. Plan 10-03 adds 5 literals (config-file-write + mcp-client-register-{claude-code,claude-desktop,cursor} + ledger-pairing); Plan 10-02 will append 4 more (install.sh batch — binary-download + binary-install + path-presence + quarantine-attr) at the SAME end-of-union — APPEND-ONLY discipline avoids merge collision."
  - "**FROZEN-area assertion (LARGEST FROZEN-area boundary of any phase to date — co-equal with Plan 10-01).** `git diff origin/main -- src/signing/ src/tools/prepare_*.ts src/tools/preview_send.ts src/tools/send_transaction.ts src/tools/verify_tx_decode.ts src/tools/get_verification_artifact.ts src/tools/get_tx_verification.ts src/protocols/ src/clients/ src/security/ src/wallet/ src/chains/ src/config/contracts.ts src/config/env.ts` returns ZERO lines. ONLY FROZEN-area touch is the ADDITIVE `writeConfigFile()` export AFTER line 95 of src/config/config-file.ts — `git diff -U0` shows ONLY 3 NEW imports + 1 NEW export hunk; lines 1-95 (FROZEN readConfigFile + _paths + ConfigFile + ConfigFileResult) BYTE-FROZEN. Cryptographic-binding chain — payloadFingerprint, presignHash, the three send_transaction gates, the canonical-dispatch allowlist — all UNTOUCHED."
  - "**src/cli/ first-occupancy carve.** Verified at execute time `src/cli/` did not exist on origin/main; carved as 5-file shelf in this plan. Mirrors Phase 9's first-occupancy of `src/security/`. Future v1.5+ ergonomics plans (`--reset`, `--uninstall`, `--register-clients-only`, multi-profile) extend this shelf rather than scattering CLI surfaces across `src/`."
metrics:
  duration: "~18 minutes (single execution wave; zero deviations beyond reading + writing the planned surfaces; pre-existing `getRegisteredTool` made Assumption A4 a first-shot pass — no additive registry-getter refactor needed)"
  completed: 2026-05-18
  tasks_completed: 1
  files_created: 11 (5 NEW src/cli/ files + 5 NEW test/ files + 10-03-SUMMARY.md)
  files_modified: 6 (src/config/config-file.ts + src/diagnostics/install-envelope.ts + src/index.ts + package.json + package-lock.json + README.md)
  files_deleted: 0
  tests_before: 890
  tests_after: 945
  tests_delta: "+55 (cli-setup-schema 11 + cli-setup-mcp-clients 18 + cli-setup-non-interactive 11 + cli-setup-interactive 7 + config-file-write 8 = 55 NEW; plan estimate was +30-50; within scope-sanity boundary noted in 10-CHECK W-1 — the +5 beyond the high estimate comes from breaking out the negative-control + integration-light cases the threat-model required)"
  loc_delta: "+1,238 LOC across 5 NEW src/cli/ files; +50 LOC additive in config-file.ts; +6 LOC additive in src/index.ts; +7 LOC additive in install-envelope.ts; +19 LOC additive in README.md; +3 LOC additive in package.json; +~1,200 LOC across 5 NEW test files; package-lock.json regeneration dominates the line-count addition"
  frozen_diff_lines: 0 (FROZEN-area zero-diff assertion — LARGEST FROZEN-area boundary of any phase to date — co-equal with Plan 10-01 — `git diff origin/main` against the FROZEN list returns ZERO lines; ONLY additive surface is writeConfigFile() AFTER line 95 of config-file.ts)
---

# Phase 10 Plan 03: `src/cli/` Shelf + `vaultpilot-mcp setup` Wizard + `writeConfigFile()` Summary

Wave 1 of Phase 10 — third plan of the Distribution + Ergonomics milestone. Closes DIST-42 (`vaultpilot-mcp setup` interactive wizard validates RPC keys, optionally pairs Ledger, writes `~/.vaultpilot-mcp/config.json`). Ships the entire `src/cli/` shelf (first occupant — mirrors Phase 9's first-occupancy of `src/security/`) + ADDITIVE `writeConfigFile()` after line 95 of FROZEN `src/config/config-file.ts` + ADDITIVE `setup` subcommand routing in `src/index.ts` + APPEND-ONLY 5-literal widening of `install-envelope.ts` CheckId union. DF-2 LOCKED `@clack/prompts@^1.4.0` over `prompts` + `@inquirer/prompts` + native `readline` at the planning gate; re-verified at execute time. Single Zod SOT (`SetupPayloadSchema` in `setup-schema.ts`) shared by both interactive + non-interactive validation paths — T-WIZARD-SCHEMA-SOT-1 invariant. Test trajectory 890 → 945 (+55).

## What Shipped

### 1. `src/cli/setup-schema.ts` (NEW — 88 LOC)

Single Zod Source of Truth for the `vaultpilot-mcp setup` payload. Both the interactive wizard (`setup-prompts.ts`) and the non-interactive stdin reader (`setup-non-interactive.ts`) call `SetupPayloadSchema.safeParse(...)` on the same schema instance — T-WIZARD-SCHEMA-SOT-1 invariant.

Schema fields:

| Field | Type | Notes |
|-------|------|-------|
| `walletConnectProjectId` | `z.string().min(8).optional()` | UUID-like from WalletConnect Cloud |
| `rpcUrl` | `z.string().url().startsWith("https://").optional()` | https:// only — reject http:// |
| `rpcProvider` | `z.enum(["infura","alchemy","publicnode","explicit"]).optional()` | shorthand name; pair with `rpcApiKey` |
| `rpcApiKey` | `z.string().min(8).optional()` | API key for the shorthand provider |
| `etherscanApiKey` | `z.string().regex(/^[A-Z0-9]{20,40}$/).optional()` | Etherscan Multichain V2 key format |
| `registerWith` | `z.array(z.enum(["claude-code","claude-desktop","cursor"])).optional()` | which MCP client(s) to auto-register |
| `skipLedgerPairing` | `z.boolean().optional()` | skip wizard Step 3 (interactive only) |

Strict mode — unknown extra fields rejected. `redactForEnvelope(payload)` replaces 4 secret-bearing fields (`walletConnectProjectId`, `rpcUrl`, `rpcApiKey`, `etherscanApiKey`) with the `***REDACTED***` literal before stdout emission. `rpcProvider`, `registerWith`, `skipLedgerPairing` pass through unchanged (`rpcProvider` is just a shorthand NAME — never the API key VALUE).

### 2. `src/cli/setup-mcp-clients.ts` (NEW — 200 LOC)

Per-platform MCP-client detection + JSON-merge for auto-registration. Three clients:

| Client | Detection | Registration |
|--------|-----------|--------------|
| `claude-code` | `commandExists("claude")` shell-out | `claude mcp remove vaultpilot-mcp` (best-effort) → `claude mcp add vaultpilot-mcp -- <binaryPath>` |
| `claude-desktop` | `existsSync(<per-platform-path>)` | JSON read-merge-write at `~/Library/Application Support/Claude/claude_desktop_config.json` (darwin), `~/.config/Claude/...` (linux), `$APPDATA/Claude/...` (win32) |
| `cursor` | `existsSync(~/.cursor/mcp.json)` | JSON read-merge-write at `~/.cursor/mcp.json` |

`_clientEnv` spy-affordance object wraps `platform`, `homedir`, `commandExists` — tests redirect them via `vi.spyOn(_clientEnv, …)` to simulate darwin / linux / win32 + `claude` CLI present/absent without touching real OS state. The Windows `cmd /c` wrap branch (per Phase 1 INST-04) is exercised by passing `wrapForWindows: true` directly — no need to run on Windows.

Malformed pre-existing JSON triggers explicit refusal: `throw new Error('Refused — ${configPath} is malformed JSON. Fix the file first, then re-run vaultpilot-mcp setup.')`. T-MALFORMED-MCP-CLIENT-CONFIG-1 mitigation.

### 3. `src/cli/setup-non-interactive.ts` (NEW — 324 LOC)

Non-interactive path: reads JSON payload from `process.stdin` async iterator OR `--config <path>` flag, validates against `SetupPayloadSchema`, merges into existing config via FROZEN `readConfigFile()`, persists via ADDITIVE `writeConfigFile()` unless `--dry-run`, then conditionally registers `vaultpilot-mcp` with selected MCP clients. The InstallEnvelope emitted to stdout has every secret-bearing field replaced by `***REDACTED***` via `redactForEnvelope(payload)`.

`_io` spy-affordance object wraps `readStdin` / `readFile` / `writeStdout` / `writeStderr` — tests redirect them to capture stdout for assertion + script stdin without touching the real I/O streams.

### 4. `src/cli/setup-prompts.ts` (NEW — 432 LOC)

Interactive 6-step wizard via `@clack/prompts@^1.4.0`:

| Step | Prompt | Skip semantics |
|------|--------|----------------|
| 1 | `text` — WalletConnect Project ID | empty input skips |
| 2 | `select` — RPC provider (publicnode / infura / alchemy / explicit); conditional `text` for API key or URL | — |
| 3 | `confirm` — Pair Ledger via WalletConnect now? | false → `skipLedgerPairing = true` |
| 4 | `text` — Etherscan Multichain V2 API key | empty input skips |
| 5 | `multiselect` — Auto-register with which MCP clients? | empty multiselect → no register |
| 6 | `confirm` — Proceed with this configuration? | false → wizard cancels, no write |

The Step 6 review block emits to stderr via `console.error(...)` with the payload passed through `redactForEnvelope` — secrets are NEVER echoed back to the user even at confirmation time. T-CONFIG-LEAK-1 anchor at the wizard surface, asserted by cli-setup-interactive.test.ts Test 7.

Step 3 Ledger pairing delegates per Assumption A4: reads `pair_ledger_live_start` + `pair_ledger_live_wait` from the tool registry via `getRegisteredTool(...)` from `src/tools/index.ts` (pre-existing Phase 1-4 surface; no additive registry-getter refactor was needed at execute time — first-shot verification pass). Invokes the handlers directly; `pairingHandle` returned by `start` is passed verbatim to `wait`. NO duplicated pairing logic — T-LEDGER-PAIRING-DUPLICATION-1 mitigation.

### 5. `src/cli/setup.ts` (NEW — 51 LOC)

Entry-point dispatch. Mirrors `src/diagnostics/check.ts::runCheck()` shape: parses `--non-interactive` / `--dry-run` / `--json` flags from `args`, then conditionally dynamic-imports `./setup-non-interactive.js` or `./setup-prompts.js`. The conditional dynamic import keeps `@clack/prompts` off the load path when the caller passed `--non-interactive` — useful in CI pipelines, the Plan 10-02 install scripts, or piped CLI use where TTY libs would just bloat cold-start.

### 6. `src/config/config-file.ts` (MODIFY — APPEND-ONLY `writeConfigFile()` after line 95)

```typescript
export async function writeConfigFile(merged: ConfigFile): Promise<void> {
  const path = _paths.getConfigPath();
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(merged, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(tmpPath, path);
}
```

- **Atomic via tmp + POSIX rename.** Tmp file lives in `dirname(path)` — SAME filesystem as the target — so `rename()` atomicity holds. Using `os.tmpdir()` would EXDEV-fail when `/tmp` is tmpfs and `~/.vaultpilot-mcp/` is on the user's home filesystem. T-WIZARD-CONFIG-CORRUPT-1 mitigation.
- **Mode 0o600 at write time.** Owner-only read/write per `~/.netrc` convention. Passed to `writeFile` AT WRITE TIME — no post-write `chmod` race window. T-MODE-PERMISSIONS-LEAK-1 mitigation.
- **`_paths.getConfigPath()` spy-affordance.** A single `vi.spyOn(_paths, "getConfigPath").mockReturnValue(tmpPath)` in tests redirects BOTH reads and writes to the per-test temp directory.

Lines 1-95 (FROZEN `readConfigFile()` + `_paths` + `ConfigFile` + `ConfigFileResult`) BYTE-FROZEN per plan-checker dimension. `git diff -U0 origin/main -- src/config/config-file.ts` shows ONLY 3 NEW import hunks + 1 NEW `writeConfigFile` export hunk.

### 7. `src/index.ts` (MODIFY — APPEND `setup` subcommand routing)

```typescript
import { runSetup } from "./cli/setup.js";
// … existing --check + --version blocks BYTE-FROZEN …
if (args[0] === "setup") {
  const exitCode = await runSetup(args.slice(1));
  process.exit(exitCode);
}
await startServer();  // BYTE-FROZEN
```

Positional `setup` subcommand (not `--setup` flag) mirrors `git checkout` / `npm install` / `claude mcp add` convention. Inserted AFTER `--version` block and BEFORE `startServer()`. Existing `--check` + `--version` BYTE-FROZEN.

### 8. `src/diagnostics/install-envelope.ts` (MODIFY — APPEND 5 NEW CheckId literals)

```typescript
export type CheckId =
  | "node-version"
  | "binary-spawn"
  | "wallet-connect-key"
  | "ethereum-rpc"
  | "config-file"
  // ── Phase 10 / Plan 10-03 (setup wizard + MCP client register) ──
  | "config-file-write"
  | "mcp-client-register-claude-code"
  | "mcp-client-register-claude-desktop"
  | "mcp-client-register-cursor"
  | "ledger-pairing";
```

`ENVELOPE_VERSION` (still 1), `CheckLevel`, `CheckResult`, `InstallEnvelope`, `escalateStatus` BYTE-FROZEN per RESEARCH § Topic 9 line 923 (T-INSTALL-ENVELOPE-COMPAT-1 — no version bump preserves Phase 1 `--check --json` byte-compat). Plan 10-02 will append 4 more literals (`binary-download`, `binary-install`, `path-presence`, `quarantine-attr`) at the SAME end-of-union — APPEND-ONLY discipline avoids merge collision.

### 9. `package.json` (+2 dependencies)

```jsonc
"dependencies": {
  "@clack/prompts": "^1.4.0",   // NEW — DF-2 LOCKED
  "@modelcontextprotocol/sdk": "^1.29.0",
  "@walletconnect/sign-client": "^2.23.9",
  "@walletconnect/utils": "^2.23.9",
  "viem": "^2.48.0",
  "zod": "^4.4.3"               // NEW — Zod SOT for SetupPayloadSchema
}
```

Existing Phase 1-9 deps + Plan 10-01 `pkg` config + 5 `build:binary*` scripts + `@yao-pkg/pkg` devDep BYTE-FROZEN — section-separated within the JSON file; trivial git auto-merge with Plans 10-01 + 10-04.

### 10. `README.md` (+ ## Setup section)

3 invocation forms above the License section (per CLAUDE.md `Documentation Style — concise, non-redundant, sharp`):

```bash
# Interactive
vaultpilot-mcp setup

# Non-interactive (read JSON payload from stdin)
cat config-payload.json | vaultpilot-mcp setup --non-interactive --json

# Dry-run (preview without writing config or registering clients)
vaultpilot-mcp setup --dry-run
```

## Deviations from Plan

None. Plan executed exactly as written. Verification gates:

- DF-2 `@clack/prompts@^1.4.0` re-verified at execute time (`npm view @clack/prompts version` → `1.4.0`).
- `zod` presence check: ABSENT in pre-edit package.json; freshly added at `^4.4.3` (latest stable per `npm view zod version`).
- Tool-registry-getter check: `getRegisteredTool` already exported by `src/tools/index.ts` (pre-existing Phase 1-4 surface) — Assumption A4 verification passed first-shot; no additive registry-getter refactor needed.

## FROZEN-Area Assertion: LARGEST of Any Phase (co-equal with Plan 10-01)

`git diff origin/main` against the FROZEN list returns ZERO lines:

- ALL `src/signing/*` (Phases 4/6/7/9 cryptographic-binding chain) UNCHANGED
- ALL `src/tools/prepare_*.ts` (9 prepare tools — Phases 4/6/7/8) UNCHANGED
- `src/tools/preview_send.ts`, `src/tools/send_transaction.ts`, `src/tools/verify_tx_decode.ts`, `src/tools/get_verification_artifact.ts`, `src/tools/get_tx_verification.ts` UNCHANGED
- ALL `src/protocols/*.ts` UNCHANGED
- ALL `src/security/*.ts` (Phase 9 surface) UNCHANGED
- `src/wallet/session-manager.ts`, `src/chains/registry.ts`, `src/config/contracts.ts`, `src/config/env.ts` UNCHANGED
- Fixtures A-F (`test/signing-fingerprint.test.ts` hardcoded literals) UNCHANGED — Plan 10-03 doesn't touch the trust pipeline at all

ONLY FROZEN-area touch is the ADDITIVE `writeConfigFile()` export AFTER line 95 of `src/config/config-file.ts`. Plan-checker dimension verified: `git diff -U0 origin/main -- src/config/config-file.ts` shows ONLY 3 NEW import hunks + 1 NEW export hunk; lines 1-95 BYTE-FROZEN.

## Test Trajectory: 890 → 945 (+55)

```
✓ Test Files  84 passed (84)
✓ Tests       945 passed (945)
   Start at  18:19:22
   Duration  8.12s
```

| File | Cases | Anchors |
|------|-------|---------|
| `test/cli-setup-schema.test.ts` | 11 | Test 10 — 3-sentinel substring scan on redacted output; Test 11 — **T-WIZARD-SCHEMA-SOT-1 cross-test (both wizard files import SetupPayloadSchema)** |
| `test/cli-setup-mcp-clients.test.ts` | 18 | Test 10 — **T-MALFORMED-MCP-CLIENT-CONFIG-1 (refusal on malformed JSON; file stays untouched)**; Test 8/9 — **T-MCP-CLIENT-OVERWRITE-1 (preserves non-vaultpilot keys)**; Test 11 — Windows `cmd /c` wrap; Test 13 — idempotent re-register |
| `test/cli-setup-non-interactive.test.ts` | 11 | Test 5 — **T-CONFIG-LEAK-1 3-sentinel substring scan**; Test 6 — negative-control (secrets on disk but NOT in stdout); Test 11 — `_paths` spy round-trip |
| `test/cli-setup-interactive.test.ts` | 7 | Test 3 — **T-LEDGER-PAIRING-DUPLICATION-1 (Assumption A4 delegation via getRegisteredTool)**; Test 4 — degraded-mode (handlers absent → warn-level check); Test 7 — **T-CONFIG-LEAK-1 wizard-stderr sentinel scan (Step-6 review IS redacted)** |
| `test/config-file-write.test.ts` | 8 | Test 3 — **T-MODE-PERMISSIONS-LEAK-1 (mode 0o600 at write time)**; Test 5 — **T-WIZARD-CONFIG-CORRUPT-1 (same-filesystem tmp + no orphan)**; Test 6 — round-trip with FROZEN readConfigFile |

`npm run typecheck` clean. `npm run build` (tsc → `dist/`) clean. Full `npm test` 945 passed (Phase 1-9 ~890 baseline + Plan 10-03 +55 = 945). No flaky tests; no test isolation regressions.

## Threat-Coverage Self-Check

| Threat | Severity | Mitigation | Asserted by |
|--------|----------|-----------|-------------|
| **T-CONFIG-LEAK-1** | high (STOP-THE-LINE) | `redactForEnvelope()` replaces 4 secret fields with `***REDACTED***` before stdout emission | cli-setup-non-interactive Test 5 + cli-setup-interactive Test 7 + cli-setup-schema Test 10 |
| **T-WIZARD-SCHEMA-SOT-1** | high (STOP-THE-LINE) | Single Zod SOT consumed by both paths | cli-setup-schema Test 11 cross-test |
| **T-WIZARD-CONFIG-CORRUPT-1** | high | Atomic write tmp + POSIX rename + mode 0o600 at write time + same-filesystem tmp | config-file-write Tests 3 + 5 |
| **T-MALFORMED-MCP-CLIENT-CONFIG-1** | high | Explicit refusal on malformed JSON; file stays untouched | cli-setup-mcp-clients Test 10 |
| **T-MCP-CLIENT-OVERWRITE-1** | medium | Spread-merge preserves non-vaultpilot keys + top-level keys | cli-setup-mcp-clients Tests 8 + 9 + 13 |
| **T-LEDGER-PAIRING-DUPLICATION-1** | high | Wizard delegates to existing tool handlers via tool registry — NO duplicated pairing logic | cli-setup-interactive Tests 3 + 4 |
| **T-MODE-PERMISSIONS-LEAK-1** | high | Mode 0o600 passed to `writeFile` at write time | config-file-write Test 3 |
| **T-FROZEN-SIGNING-1** | high (STOP-THE-LINE) | `git diff origin/main` against FROZEN list returns ZERO lines | execute-time grep against the FROZEN file list |
| **T-INSTALL-ENVELOPE-COMPAT-1** | medium | `ENVELOPE_VERSION` stays 1; APPEND-ONLY CheckId widening | install-envelope.ts byte-diff inspection |

## Hooks for Plan 10-02 (install.sh + install.ps1)

- **Shared `setup-mcp-clients.ts`.** Plan 10-02 install.sh / install.ps1 consume the same `detectMcpClients` + `registerWithJsonConfig` + `registerWithClaudeCode` helpers via the installed binary's `vaultpilot-mcp setup --non-interactive --json` flow. Plan 10-03 OWNS the file; Plan 10-02 imports through the installed binary (no source-level import — install scripts run BEFORE Node deps are guaranteed to resolve).
- **APPEND-ONLY install-envelope CheckId widening.** Plan 10-03 appended 5 literals in a `// ── Phase 10 / Plan 10-03 ──` comment-block at end-of-union. Plan 10-02 will append 4 more (`binary-download`, `binary-install`, `path-presence`, `quarantine-attr`) in a fresh `// ── Phase 10 / Plan 10-02 ──` comment-block AT THE SAME end-of-union. APPEND-ONLY discipline avoids merge collision if both plans race.
- **`@clack/prompts` is NOT a Plan 10-02 dep.** Plan 10-02 install scripts are bash/PowerShell — they don't load Node deps. The conditional dynamic-import in `src/cli/setup.ts` ensures `@clack/prompts` only loads when the interactive wizard path is taken (not when install.sh invokes `--non-interactive`).

## Hooks for Plan 10-04 (request_capability)

- **Independent surfaces.** Plan 10-04 ships `src/tools/request_capability.ts` + `src/security/request-capability-rate-limit.ts`. Neither touches `src/cli/` or `src/config/config-file.ts`. Plan 10-03's edits in `package.json` (`dependencies` section) and `src/diagnostics/install-envelope.ts` (CheckId union) are section-separated from Plan 10-04's expected edits — trivial git auto-merge.

## Accepted Residuals

- **`@clack/prompts` non-TTY fallback isn't tested in v1.4.** If a user accidentally pipes stdin to `vaultpilot-mcp setup` (without `--non-interactive`), `@clack/prompts` errors at the first prompt; the wizard surfaces a `level: error` envelope. v1.5+ may auto-detect TTY and dispatch accordingly.
- **`detectMcpClients()` shells out `command -v claude` synchronously.** Tiny perf cost (~5-20ms); only at wizard Step 5 entry / non-interactive register step. Acceptable.
- **`claude mcp add` requires Claude Code CLI installed.** If `claude` isn't on PATH but the user passed `registerWith: ['claude-code']`, the non-interactive path emits `level: error` mcp-client-register-claude-code check with the remediation message "install Claude Code CLI first". The interactive wizard guards the same branch.
- **`registerWithJsonConfig` does NOT `mkdir -p` the parent directory.** Callers must point at an already-existing parent. The wizard guards this via Step 5's multiselect — only DETECTED clients are offered, and detection requires the file (and therefore the parent directory) to exist. cli-setup-mcp-clients Test 17 anchors the contract; Test 18 anchors the caller-mkdir-then-register pattern.
- **`writeConfigFile()` atomic-write requires SAME-FILESYSTEM tmp.** Tmp file in `dirname(path)` (not `os.tmpdir()`). Cross-filesystem rename fails with EXDEV; user remediates by not symlinking `~/.vaultpilot-mcp/` across filesystems (rare edge case; documented).
- **Mode 0o600 only applies to newly-written files.** Pre-existing config.json with broader mode (e.g. 0o644 from manual editing) keeps its broader mode until the next wizard write. The rename replaces the inode, so the new file's mode wins. Acceptable v1.4 — if the user has a world-readable config.json, the wizard write fixes it on the next run.
- **Wizard's `--json` mode emits envelope to stdout while prompts go to stderr.** Per CLAUDE.md `Stderr for diagnostics, stdout for MCP protocol`. `@clack/prompts` writes to stderr by default — verified empirically at execute time. If `@clack/prompts` defaults change in a future minor version, the wizard would need a `process.stderr` wrap.

## Deferred (v1.4.1+ / v1.5+)

- **`vaultpilot-mcp setup --register-clients-only`** — v1.4.1+ ergonomics. Lets the user re-run client registration without re-walking the full wizard. v1.4 ships full-wizard-only flow; Plan 10-02 install.sh achieves the equivalent via `--non-interactive --json` with a minimal payload.
- **`vaultpilot-mcp setup --reset`** — v1.5+ ergonomics. Backup-and-replace existing config with fresh wizard run.
- **`vaultpilot-mcp setup --uninstall`** — v1.5+ ergonomics. Removes config + de-registers from MCP clients.
- **Multi-config-profile support** (`vaultpilot-mcp setup --profile production`) — v2.x scope.
- **Per-chain RPC URL prompts** (currently grouped as one provider select + one URL) — v1.5+ granularity.
- **Wizard ANSI-color theming + reduced-motion mode** — v1.5+ a11y.

## Self-Check: PASSED

- [x] `src/cli/` directory exists with 5 NEW files: `setup.ts`, `setup-prompts.ts`, `setup-non-interactive.ts`, `setup-mcp-clients.ts`, `setup-schema.ts`
- [x] `src/cli/setup-schema.ts` exports `SetupPayloadSchema`, `SetupPayload`, `REDACTED_LITERAL`, `redactForEnvelope`
- [x] `src/cli/setup-mcp-clients.ts` exports `detectMcpClients`, `getClientConfigPath`, `registerWithJsonConfig`, `registerWithClaudeCode`, `_clientEnv` spy-affordance, plus refuses on malformed JSON
- [x] `src/cli/setup-non-interactive.ts` exports `runNonInteractive` + imports `SetupPayloadSchema` + `redactForEnvelope` + `writeConfigFile`
- [x] `src/cli/setup-prompts.ts` exports `runInteractive` + imports `@clack/prompts` + `pair_ledger_live` delegation via `getRegisteredTool`
- [x] `src/cli/setup.ts` exports `runSetup` + parses `--non-interactive` / `--dry-run` / `--json`
- [x] `src/config/config-file.ts` exports `writeConfigFile` with `mode: 0o600` and `rename`; lines 1-95 byte-frozen
- [x] `src/index.ts` has `if (args[0] === "setup")` routing block + `runSetup` import; existing blocks byte-frozen
- [x] `src/diagnostics/install-envelope.ts` has 5 NEW CheckId literals (`config-file-write`, `mcp-client-register-claude-code`, `mcp-client-register-claude-desktop`, `mcp-client-register-cursor`, `ledger-pairing`); `ENVELOPE_VERSION` still `1`
- [x] `package.json` has `@clack/prompts: ^1.4.0` + `zod: ^4.4.3` in `dependencies`
- [x] `package-lock.json` regenerated
- [x] `README.md` has `## Setup` section with 3 invocation forms
- [x] `git diff origin/main` against FROZEN list returns ZERO lines (FROZEN-area assertion)
- [x] `git diff -U0 origin/main -- src/config/config-file.ts` shows ONLY additive hunks (lines 1-95 byte-frozen — plan-checker dimension)
- [x] `npm run typecheck` clean
- [x] `npm run build` clean
- [x] `npm test` 945 passed (+55 from 890 baseline; plan estimate was +30-50; within scope-sanity boundary per 10-CHECK W-1)
- [x] T-CONFIG-LEAK-1 3-sentinel substring scan PASSES (cli-setup-non-interactive Test 5 + cli-setup-interactive Test 7)
- [x] T-WIZARD-SCHEMA-SOT-1 cross-test PASSES (cli-setup-schema Test 11 — both wizard files import `SetupPayloadSchema`)
- [x] T-LEDGER-PAIRING-DUPLICATION-1 delegation verified via Assumption A4 (cli-setup-interactive Test 3 — both spies fire with correct argument shape)

All Plan 10-03 success criteria met. Plan 10-02 install scripts can now consume `setup-mcp-clients.ts` helpers via the installed binary's `--non-interactive --json` flow; Plan 10-04 ships in parallel without coupling.
