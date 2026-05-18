# Phase 10: Distribution + ergonomics — Pattern Map

**Mapped:** 2026-05-18
**Phase scope:** 10-01 (binary build + release.yml), 10-02 (install.sh + install.ps1 + MCP client auto-register), 10-03 (`vaultpilot-mcp setup` wizard + `writeConfigFile()`), 10-04 (`request_capability` + sliding-window rate-limit)
**Files in scope:** 9 NEW src files (5 in NEW `src/cli/`, 1 new tool, 1 new security module) + 2 NEW shell installers + 1 NEW GitHub workflow + 7 NEW test files + 6 ADDITIVE src/docs modifications
**Analogs found:** every NEW src file has a strong in-tree analog. Shell + workflow files have NO in-tree analog (first occupants of their shelves) — copy from RESEARCH § Topics 4-5 verbatim.

## Executive Summary — phase shape is GREENFIELD DISTRIBUTION + ZERO TRUST-PIPELINE TOUCH

Phase 10 is fundamentally different in carve from prior phases. Phases 1-3 built the trust-pipeline scaffold; Phases 4-7 added preview/send gates + decoders; Phase 8 widened chain plumbing; Phase 9 added defense-in-depth layers. **Phase 10 is distribution + ergonomics** — almost entirely NEW surface OUTSIDE the trust pipeline. Build pipeline, shell installers, interactive wizard, GitHub-issue URL builder.

Dominant primitives:

- **Six NEW `src/cli/` files** (first occupant of the long-planned `src/cli/` shelf — analog to Phase 9's first occupancy of `src/security/`). All consume Phase 5 `readConfigFile()` (FROZEN) + NEW `writeConfigFile()` (additive companion in same module).
- **One NEW MCP tool** (`request_capability`) + ONE NEW security module (`request-capability-rate-limit.ts`) — both follow Phase 9 `_skillIntegrity`/`_canonicalDispatch` spy-affordance shape.
- **One NEW CLI subcommand** (`vaultpilot-mcp setup`) added to `src/index.ts` — mirror of the existing `--check` block at `src/index.ts:9-13`.
- **One NEW error code** (`RATE_LIMIT_EXCEEDED`) appended (19 → 20 codes).
- **9 NEW `CheckId` literals** appended in two grouped batches (install.sh + setup-wizard) to Phase 1's FROZEN `CheckId` union (no `ENVELOPE_VERSION` bump per Topic 9 lock).
- **One NEW GitHub Actions workflow** + **two NEW shell installers** — NO in-tree precedent (`.github/workflows/` directory does not yet exist; no prior shell scripts in repo).

Implications for executor coordination:

- **FROZEN-area discipline empirically holds end-to-end.** All `src/signing/*`, all `src/tools/prepare_*`, `preview_send.ts`, `send_transaction.ts`, all `src/protocols/*`, all `src/security/*` (Phase 9 surface), `src/wallet/session-manager.ts`, `src/chains/registry.ts`, `src/config/contracts.ts` → ZERO bytes changed in every Phase 10 plan's `<success_criteria>`. The ONLY FROZEN-area touch is the ADDITIVE `writeConfigFile()` export in `src/config/config-file.ts` (sits next to FROZEN `readConfigFile()` at line 79; existing `_paths`/`ConfigFile`/`ConfigFileResult` byte-frozen).
- **No SDK probe needed** — `@yao-pkg/pkg@6.19.0` (DF-1) + `@clack/prompts@1.4.0` (DF-2) already empirically probed in RESEARCH § Topic 1. Pure ESM; 0 native deps in vaultpilot stack (`find … -name "*.node"` returned 0).
- **Distribution channels are independent** — `npm install -g vaultpilot-mcp` works regardless of curl-pipe pipeline. Plan 10-01 (build pipeline) is technically optional for v1.4 functionality.

## 1. File-to-Analog Mapping

### New files

| New File | Role | Closest Analog | Match | Bounded Diffs |
|---|---|---|---|---|
| `.github/workflows/release.yml` (10-01) | GitHub-Actions-workflow | NO in-tree (no workflows dir exists); RESEARCH § Topic 4 sketch lines 232-282 | greenfield | Single Linux runner; cross-compile via `pkg --target node22-{linux,macos,win}-{x64,arm64}`; `softprops/action-gh-release@v2`; `permissions: contents: write` required (Pitfall — Topic 4 line 295); `v*` tag trigger; prerelease auto-detect for `vX.Y.Z-rcN` |
| `install.sh` (10-02) | shell-script / POSIX installer | NO in-tree; RESEARCH § Topic 5 sketch lines 312-411 | greenfield | `set -euo pipefail`; `main() { … }; main "$@"` partial-download safety wrap (Topic 5 line 438); `curl -fsSL`; SHA-256 verify via `shasum -a 256 -c` BEFORE extract; `~/.local/bin` install dir; macOS `xattr -d com.apple.quarantine` OFFER; linux-arm64 + Windows + unknown-arch refuse with `use npm install -g vaultpilot-mcp` fallback (ROADMAP success-criterion #1 lock) |
| `install.ps1` (10-02) | shell-script / PowerShell installer | NO in-tree; RESEARCH § Topic 3 line 217 + Topic 5 (PowerShell adaptation) | greenfield | `Invoke-WebRequest -UseBasicParsing`; `[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture`; `Get-FileHash -Algorithm SHA256` verify; install to `%LOCALAPPDATA%\vaultpilot-mcp\bin\`; SmartScreen `Unblock-File` notice; HKEY_CURRENT_USER\Environment PATH-append |
| `src/cli/setup.ts` (10-03) | CLI-subcommand / entry point | `src/diagnostics/check.ts::runCheck()` at lines 9-43 | role-match | Mode dispatch via arg parser: `--non-interactive` → `setup-non-interactive.ts`; `--dry-run` flag; default → `setup-prompts.ts`; returns exit code (mirror of `runCheck()` return-shape at check.ts:42) |
| `src/cli/setup-prompts.ts` (10-03) | CLI-subcommand / interactive | NO in-tree (first `@clack/prompts` consumer); RESEARCH § Topic 7 flow sketch lines 561-627 | greenfield | `@clack/prompts` calls: `intro()` / `text()` / `select()` / `multiselect()` / `confirm()` / `outro()`; 6 wizard steps; delegates Ledger pairing to existing `pair_ledger_live_start` + `_wait` handlers (Assumption A4 — Topic 7); merges via `setup-schema.ts` → `writeConfigFile()` |
| `src/cli/setup-non-interactive.ts` (10-03) | CLI-subcommand / JSON I/O | `src/diagnostics/check.ts:36-37` (`process.stdout.write(JSON.stringify(envelope) + "\n")`) for envelope emit | role-match | Read stdin via `process.stdin` async iterator OR `--config <path>` flag; validate via `setup-schema.ts` Zod schema; `--dry-run` skips write; emit InstallEnvelope (Topic 9 shape) on stdout; secret-safety: status names keys + counts, never values (Topic 7 line 706-708 lock) |
| `src/cli/setup-mcp-clients.ts` (10-02 + 10-03 — SHARED) | CLI-subcommand / client detection | NO in-tree; RESEARCH § Topic 6 sketch lines 477-531 | greenfield | `detectMcpClients()` returns `DetectedClient[]` (claude-code, claude-desktop, cursor); per-platform path via `os.platform()`+`os.homedir()`+`process.env.APPDATA`; JSON read-merge-write preserves non-`vaultpilot-mcp` keys; Windows `cmd /c` wrapper (Phase 1 INST-04 precedent — Topic 6 line 463); refuse on malformed pre-existing JSON (Topic 6 line 545); claude-code: shell-out `claude mcp remove` (best-effort) → `claude mcp add` (idempotent — Topic 6 line 543) |
| `src/cli/setup-schema.ts` (10-03) | CLI-subcommand / validation | NO direct in-tree (first Zod schema IF zod not yet present; Phase 4 ajv pairing may already have it — VERIFY at execute time per Topic 9 line 1026) | role-match | Single SOT for interactive + non-interactive validation (Topic 7 line 704 lock — without single SOT, paths drift). Fields: `walletConnectProjectId?`, `rpcUrl?` (https-prefix), `rpcProvider?` (enum: infura/alchemy/publicnode/explicit), `etherscanApiKey?` (hex pattern), `registerWith?` (array enum), `skipLedgerPairing?` |
| `src/tools/request_capability.ts` (10-04) | MCP-tool | `src/tools/check_contract_security.ts` (DESCRIPTION + registerTool shape); Phase 9 `verify_tx_decode.ts` as fresh analog; RESEARCH § Topic 8 sketch lines 723-781 | role-match | Input via Zod (title 5-120, body ≥ 20); `_rateLimit.check()` BEFORE URL build (refuse with `RATE_LIMIT_EXCEEDED` + retry-after in `cause`); `URLSearchParams` URL encoding (WHATWG-compliant — Topic 8 line 856 Pitfall avoidance); 7KB body cap → truncate + write full text to `~/.vaultpilot-mcp/capability-requests/<timestamp>.md`; DESCRIPTION names "NEVER auto-submits" (DIST-43 lock — Topic 8 line 866) per CLAUDE.md "tool descriptions are agent routing prompts" |
| `src/security/request-capability-rate-limit.ts` (10-04) | security-rate-limiter | `src/security/skill-integrity.ts` (Phase 9 `_skillIntegrity = { checkSkillIntegrity }` + module-scoped state + `_resetForTesting`) | exact | Module-scoped `timestamps: number[]` array (per-process; restart resets — Topic 8 line 826 documented residual); `HOUR_MS`, `LIMIT = 3`; `check()` returns `{ allowed, remaining, retryAfterMs }`; sliding-window prune via `filter((t) => now - t < HOUR_MS)`; `_rateLimit = { check, record }` spy-affordance per CLAUDE.md Conventions; `_resetForTesting()` mirrors Phase 9 shape |

### Modified (existing) files — ADDITIVE only

| Modified File | Self-Extension | Bounded Diff |
|---|---|---|
| `src/index.ts` (10-03) | NEW `setup` subcommand routing AFTER `--version` block at lines 15-19 and BEFORE `startServer()` at line 21 | +1 import (`runSetup`); +1 conditional block (`if (args[0] === "setup")`); existing `--check` and `--version` byte-frozen. Positional `setup` (not `--setup`) — mirrors `git checkout` / `npm install` / `claude mcp add` subcommand style |
| `src/config/config-file.ts` (10-03) | APPEND-ONLY `writeConfigFile()` export next to FROZEN `readConfigFile()` at line 79 | +3 imports (`writeFile`/`mkdir`/`rename` from `node:fs/promises`; `dirname` from `node:path`); +1 export per Topic 7 sketch lines 691-697: atomic-write via tmp+rename (POSIX), mode 0o600 (secret-safety — Topic 7 line 700), `mkdir({ recursive: true })`. Routes through `_paths.getConfigPath()` indirection so existing test helpers redirect both reads + writes in one spy. **Plan-checker dimension:** `git diff` shows ONLY new exports/imports; lines 1-95 untouched |
| `src/diagnostics/install-envelope.ts` (10-02 + 10-03) | APPEND-ONLY to FROZEN `CheckId` union at lines 5-10; Phase 1 shape FROZEN (no `ENVELOPE_VERSION` bump per Topic 9 line 923) | 9 NEW literals in two grouped blocks: install.sh batch (`binary-download`, `binary-install`, `path-presence`, `quarantine-attr`); setup-wizard batch (`config-file-write`, `mcp-client-register-claude-code`, `mcp-client-register-claude-desktop`, `mcp-client-register-cursor`, `ledger-pairing`). `CheckLevel`/`CheckResult`/`InstallEnvelope`/`escalateStatus` byte-frozen |
| `src/tools/register-all.ts` (10-04) | APPEND-ONLY: +1 import at END of list (after line 32 `get_ledger_device_info.js`) | `import "./request_capability.js";` appended; preserves Phase 9 carve discipline (Topic 10 line 1040). Order doesn't matter functionally (side-effect imports); append-only avoids git auto-merge conflicts |
| `src/signing/error-codes.ts` (10-04) | APPEND-ONLY entry: `RATE_LIMIT_EXCEEDED` (19 → 20 codes); producer-map comment-block extended per Phase 8/9 precedent | 19 prior codes byte-frozen (including Phase 9 `SKILL_INTEGRITY_FAILURE`/`DISPATCH_TARGET_REFUSED`/`DECODE_DIVERGENCE`). Exhaustive `switch` over `ErrorCode` in any consumer fails to typecheck — surfaces omission before merge (Phase 4 lock at error-codes.ts:1-9) |
| `package.json` (10-01 + 10-03 + 10-04) | Additive: NEW `pkg` config section + `build:binary:*` scripts (Plan 10-01); NEW deps (Plans 10-03 + 10-04) | `pkg` section per Topic 1 lines 110-128: `{ scripts: ["dist/**/*.js"], assets: ["package.json"] }`. New devDep: `@yao-pkg/pkg` (^6.19.0 — DF-1). New deps: `@clack/prompts` (^1.4.0 — DF-2); `zod` (latest — VERIFY presence per Topic 9 line 1026). 5 NEW scripts: `build:binary` + 4 per-target |
| `README.md` (10-01 + 10-02 + 10-03) | Additive: curl-pipe one-liner + setup wizard usage | Per CLAUDE.md Documentation Style — concise, lead with strongest sentence, no redundancy. 1 curl-pipe POSIX + 1 PowerShell Windows + npm fallback for unsupported arches |
| `SECURITY.md` (10-01 + 10-02) | Additive: v1.4 residual-risk rows | Per user-global CLAUDE.md "Security Documentation Vocabulary" — name "residual risk" explicitly. Rows: unsigned macOS + Windows SmartScreen (Topic 3 — defer signing to v1.5+); per-process rate-limit (Topic 8 — restart-bypass acknowledged friction-not-fortress); supply-chain risk (Topic 1 — future sigstore-sign per Topic 10 line 1232) |

### NOT TOUCHED (FROZEN — zero-diff asserted by every Plan's `<success_criteria>`)

| File | Last touched |
|---|---|
| `src/signing/payload-fingerprint.ts` (PREP-03 preimage; Fixtures A/D/E/F/G/H anchor) | Phase 4 |
| `src/signing/presign-hash.ts` (PREP-04 EIP-1559 RLP; Fixture C anchor) | Phase 4 |
| `src/signing/handle-store.ts` (state machine + 15-min `HANDLE_TTL_MS`) | Phase 4; Phase 6 additive |
| `src/tools/send_transaction.ts` (PREP-07 schema + PREP-08 fingerprint + userDecision gates) | Phase 9 |
| `src/tools/preview_send.ts` (Phase 9 Layer 0.5 dispatch-allowlist + Phase 8 Layer 2 chain-mismatch) | Phase 9 |
| `src/tools/prepare_*.ts` (8 tools — preimage assembly) | Phase 6/7/8 |
| `src/security/{skill-integrity,canonical-dispatch}.ts` (Phase 9 defense layers) | Phase 9 |
| `src/clients/{etherscan,fourbyte}.ts` (decode cross-check) | Phase 7 + Phase 4 |
| `src/protocols/{erc20,aave-v3,weth9}.ts` (decoder shapes) | Phase 6/7 |
| `src/signing/{aave-health,amount,simulation,blocks,error-codes}.ts` (only error-codes gets +1 code; blocks untouched) | Phase 9 |
| `src/wallet/session-manager.ts`, `src/chains/registry.ts`, `src/config/{contracts,env}.ts` | Phase 8 |
| `src/config/config-file.ts` lines 1-95 (existing `readConfigFile`/`_paths`/`ConfigFile`/`ConfigFileResult`) | Phase 5; Phase 10 ADDS `writeConfigFile()` after these without touching them |
| `src/server.ts` (Phase 1-9 dispatcher; setup wizard is separate CLI subcommand routed via `src/index.ts` without `startServer()` boot) | Phase 9 |
| `src/diagnostics/{check,notice,update-check,logger}.ts` (only `install-envelope.ts` extended) | Phase 5 |
| `src/tools/{verify_tx_decode,get_verification_artifact,get_tx_verification,pair_ledger_live*,get_vaultpilot_config_status}.ts` | Phase 3/9 |

## 2. Pattern Assignments — Concrete Code to Copy

### `src/index.ts` `setup` subcommand routing (10-03) — analog: `--check` at lines 9-13

**Current FROZEN shape** (`src/index.ts:1-22`):
```typescript
if (args.includes("--check")) { … process.exit(exitCode); }
if (args.includes("--version") || args.includes("-v")) { … process.exit(0); }
await startServer();
```

**Phase 10 widening** — positional `setup` subcommand AFTER `--version`, BEFORE `startServer()`:
```typescript
import { runSetup } from "./cli/setup.js";
…
if (args[0] === "setup") {
  const exitCode = await runSetup(args.slice(1));
  process.exit(exitCode);
}
await startServer();
```

### `src/cli/setup.ts` (10-03) — analog: `src/diagnostics/check.ts::runCheck()` at lines 9-43

Mirror the `runCheck` exit-code/envelope discipline. Dispatch on `--non-interactive` flag to either `setup-prompts.ts` (TTY) or `setup-non-interactive.ts` (stdin JSON). `--dry-run` skips write. Both inner runners build an `InstallEnvelope` with the NEW `CheckId` literals and return exit code per `escalateStatus` result.

### `src/config/config-file.ts` `writeConfigFile()` (10-03) — analog: `readConfigFile()` at lines 79-95 (FROZEN — sits ABOVE)

Per Topic 7 sketch lines 691-697:
```typescript
export async function writeConfigFile(merged: ConfigFile): Promise<void> {
  const path = _paths.getConfigPath();  // route through spy-affordance
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  await rename(tmpPath, path);  // atomic per POSIX; same-filesystem requirement (Topic 7 line 702)
}
```

Mode 0o600 — secrets (RPC keys, Etherscan key) restricted to owner per ~/.netrc / ~/.aws/credentials convention (Topic 7 line 700).

### `src/security/request-capability-rate-limit.ts` (10-04) — analog: `src/security/skill-integrity.ts` Phase 9 spy-affordance

Per Topic 8.1 sketch lines 786-820: module-scoped `timestamps: number[]`; `check()` prunes + tests `length >= LIMIT`; `_rateLimit = { check, record }` indirection; `_resetForTesting()` mirror of Phase 9 `_resetSkillIntegrityForTesting`. Sliding-window > fixed-window prevents burst-at-boundary (3 calls at min 59 + 3 at min 61 = 6 in 2 min under fixed-window per Topic 8 line 823).

### `src/tools/request_capability.ts` (10-04) — analog: `check_contract_security.ts` tool-wrapper + RESEARCH § Topic 8 sketch lines 723-781

DESCRIPTION discipline per CLAUDE.md "Tool descriptions are agent routing prompts": (a) what it does, (b) when to use, (c) **"NEVER auto-submits"** (DIST-43 lock — Topic 8 line 866), (d) rate-limit + truncation. URL build via `URLSearchParams` (WHATWG-compliant — Topic 8 line 856 Pitfall avoidance). Refusal via `makeStructuredError("RATE_LIMIT_EXCEEDED", message, retryAfterMs.toString())` — standard envelope shape (`BROADCAST_FAILED`/`LEDGER_REJECTED` precedent at error-codes.ts:111).

### `src/cli/setup-mcp-clients.ts` (10-02 + 10-03) — analog: NO in-tree; RESEARCH § Topic 6 sketch lines 477-531 verbatim

Per-platform paths via `os.platform()`+`os.homedir()`+`process.env.APPDATA`. JSON read-merge-write preserves every `existing.mcpServers` key except `vaultpilot-mcp`. Refuses on malformed pre-existing JSON (Topic 6 line 545 — would lose user data on silent overwrite). Windows `cmd /c` wrapper per Phase 1 INST-04 (Topic 6 line 463). Restart-needed notice for Claude Desktop only (Cursor live-reloads per Topic 6 line 541).

### `.github/workflows/release.yml` (10-01) — analog: NO in-tree; RESEARCH § Topic 4 sketch lines 232-282

Mandatory invariants: `permissions: contents: write` (Topic 4 line 295 Pitfall — softprops/action-gh-release fails 403 without it); single Linux runner cross-compile (1×10min vs 4×5min; pkg-fetch caches per-target Node binaries — no QEMU); per-asset `.sha256` + combined `SHA256SUMS.txt` (Topic 2 line 159); prerelease auto-detect via `contains(github.ref_name, '-')` (Topic 4 line 281); install.sh + install.ps1 shipped AS release assets (Topic 4 line 272 — versioned + immutable; curl-pipe points at release-hosted asset, not raw repo branch).

### `install.sh` (10-02) — analog: NO in-tree; RESEARCH § Topic 5 sketch lines 312-411 verbatim

Mandatory invariants (Topic 5 Pitfalls):

1. **`set -euo pipefail` at top** — exit on non-zero, error on unset, propagate pipe failures.
2. **`main() { … }; main "$@"` wrap** (Topic 5 line 438 — arp242 canonical) — partial-download → unclosed function → bash syntax error → no execution. Without this, truncated download executes partial commands (`rm -rf $TMP_DIR` with unset `$TMP_DIR` → `rm -rf /`).
3. **`curl -fsSL`** (NOT `curl -L`) — `-f` fails on 4xx/5xx (404→200-HTML can pipe-into-bash without `-f`); `-S` shows errors despite silent; `-L` follows GitHub redirects.
4. **SHA-256 verify BEFORE extract** (Topic 5 line 378) — `shasum -a 256 -c "$archive.sha256"`; refuse on mismatch + name support URL.
5. **Idempotency via version-check** (Topic 5 line 362) — if existing binary `--version` matches target, skip download.
6. **macOS Gatekeeper OFFER** (Topic 5 line 387) — interactive `read -r -p`; auto-mode prints NOTICE + skips. Documented residual per Topic 3.
7. **PATH check** (Topic 5 line 393) — warn only; don't auto-edit shell rc (invasive).
8. **Refusal arms** (Topic 5 line 343) — linux-arm64 + Windows + unknown OS/arch → `use npm install -g vaultpilot-mcp` fallback + exit 1 (ROADMAP success-criterion #1 lock).

### InstallEnvelope `CheckId` widening (10-02 + 10-03) — analog: FROZEN union at `install-envelope.ts:5-10`

APPEND-ONLY 9 new literals per Topic 9 line 923 lock (no `ENVELOPE_VERSION` bump — existing Phase 1 `--check --json` consumers keep working byte-for-byte). Group in TWO comment-blocks (install.sh batch + setup-wizard batch) so a future reader sees the additive provenance.

## 3. Reusable Primitives — Phase 10 MUST Consume, NOT Reimplement

| Primitive | Source | Phase 10 caller(s) |
|---|---|---|
| `readConfigFile()` + `_paths.getConfigPath()` | `src/config/config-file.ts:54,79` FROZEN | `setup-prompts.ts`, `setup-non-interactive.ts` (READ existing config before merge) |
| `ENVELOPE_VERSION`/`CheckLevel`/`CheckResult`/`InstallEnvelope`/`escalateStatus` | `src/diagnostics/install-envelope.ts:1-32` FROZEN (only `CheckId` widens) | `setup.ts`, `setup-non-interactive.ts`, `setup-mcp-clients.ts`, install.sh (via `vaultpilot-mcp setup --emit-install-envelope`) |
| `makeStructuredError(code, message, cause?)` | `src/signing/error-codes.ts:109` | `request_capability.ts` (rate-limit refusal — `retryAfterMs` in `cause`) |
| `registerTool({ name, description, inputSchema, handler })` | `src/tools/index.ts` | `request_capability.ts` |
| `pair_ledger_live_start` + `pair_ledger_live_wait` handlers | `src/tools/pair_ledger_live_*.ts` FROZEN | `setup-prompts.ts` Step 3 (delegate Ledger pairing — Assumption A4) |
| `os.platform()` / `os.homedir()` / `process.env.APPDATA` | Node built-in | `setup-mcp-clients.ts` per-platform path resolution |
| `URLSearchParams` (WHATWG) | Node built-in | `request_capability.ts` — multiline/emoji/special-char safe (Topic 8 line 856) |
| `_skillIntegrity`/`_canonicalDispatch` spy-affordance shape | `src/security/{skill-integrity,canonical-dispatch}.ts` Phase 9 | `_rateLimit` in `request-capability-rate-limit.ts` — CLAUDE.md "Add indirection at write time, not retroactively" |

## 4. Anti-Patterns Phase 10 MUST NOT Repeat (from Phase 1-9 retros)

1. **No inline contract addresses** (CLAUDE.md). Phase 10 doesn't touch contract addresses at all.
2. **No new cryptographic-binding fixtures** (CLAUDE.md). Trust pipeline FROZEN; Fixtures A-J byte-identity hold.
3. **`writeConfigFile()` is ATOMIC** — tmp + rename per POSIX. Partial write (process killed mid-flush) would leave malformed JSON that `readConfigFile()` then refuses. Same-filesystem requirement: tmp in `dirname(path)`, NOT `os.tmpdir()` (would EXDEV-fail per Topic 7 line 702).
4. **`writeConfigFile()` uses mode 0o600** — RPC keys + Etherscan key restricted to owner (Topic 7 line 700).
5. **InstallEnvelope contains NO secret values** (Topic 7 line 706 — Phase 5 `get_vaultpilot_config_status` precedent). Status names `wrote config` / `registered with X`, never the value.
6. **`request_capability` DESCRIPTION names "NEVER auto-submits"** (DIST-43 lock — Topic 8 line 866). The DESCRIPTION IS the agent routing prompt; without naming the invariant, an LLM with web-fetch tools could plausibly POST to the GitHub API.
7. **`install.sh` MUST wrap in `main() { … }; main "$@"`** (Topic 5 line 438). Same idiom in install.ps1.
8. **`install.sh` MUST verify SHA-256 BEFORE extract** (Topic 5 line 378). Defense-in-depth beyond TLS cert.
9. **`@yao-pkg/pkg`, NOT archived `vercel/pkg`** (DF-1 line 1104). `pkg@5.8.1` archived 2023; doesn't support Node 22.
10. **`@clack/prompts`, NOT `prompts@2.4.2`/`@inquirer/prompts`** (DF-2 line 1130). ESM-first; 0 native deps; cleaner API for multi-step wizards.
11. **`register-all.ts` import APPEND-ONLY** (Phase 9 carve — Topic 10 line 1040). New `request_capability.js` at END of list.
12. **NO ENVELOPE_VERSION bump** (Topic 9 line 923). Additive `CheckId` widening only.
13. **Setup wizard non-interactive + interactive paths SHARE Zod schema** (Topic 7 line 704). Without single SOT, paths drift; non-interactive users get different config shape than interactive.

## 5. Cryptographic-Binding Chain Delta

### What Phase 10 changes

**Nothing.** Phase 10 is entirely OUTSIDE the cryptographic-binding chain. No prepare tool touched. No preimage assembly. No fingerprint computation. No state machine. No three-gate logic.

### What Phase 10 does NOT touch (FROZEN — assertion in every Plan)

All Phase 4-9 trust-pipeline bytes-frozen (see § 1 NOT TOUCHED table). Phase 10 has the LARGEST FROZEN-area boundary of any phase to date — appropriate for a v1.x-closing distribution layer.

### Plan-checker dimension

Every Phase 10 plan's `<success_criteria>` MUST include: "`git diff src/signing/ src/security/ src/tools/prepare_*.ts src/tools/preview_send.ts src/tools/send_transaction.ts src/tools/verify_tx_decode.ts src/tools/get_verification_artifact.ts src/tools/get_tx_verification.ts src/protocols/ src/clients/ src/wallet/ src/chains/ src/config/contracts.ts src/config/env.ts` returns ZERO lines." Plan 10-03's `<success_criteria>` additionally scopes `src/config/config-file.ts` diff to the new export + new imports only (lines 1-95 untouched).

## 6. Test Surface Notes

| Test File | Scope | Mirrors |
|---|---|---|
| `test/cli-setup-interactive.test.ts` (NEW) | 6-step wizard with `vi.mock("@clack/prompts", …)` | NO direct analog (first `@clack/prompts` test) |
| `test/cli-setup-non-interactive.test.ts` (NEW) | JSON stdin + Zod validation + `--dry-run` + secret-safety + atomic-write | `test/check.test.ts` Phase 1 envelope test |
| `test/cli-setup-mcp-clients.test.ts` (NEW) | Per-client detection + JSON merge preserves non-vaultpilot keys + idempotent re-register + malformed-JSON refusal + Windows `cmd /c` wrapper | NO direct analog; copy Topic 6 sketch shapes |
| `test/cli-setup-schema.test.ts` (NEW) | Zod schema field coverage; out-of-spec rejections (RPC URL without https://, malformed Etherscan key) | NO direct analog |
| `test/request-capability.test.ts` (NEW) | URL build via `URLSearchParams` round-trip + 7KB truncation + local-file write + DESCRIPTION names "NEVER auto-submits" | `test/verify-tx-decode.test.ts` Phase 9 tool-wrapper shape |
| `test/request-capability-rate-limit.test.ts` (NEW) | Sliding-window: 3 allowed → 4th refused; 60-min-old call falls out → 4th allowed; `_resetForTesting`; `vi.spyOn(_rateLimit)` round-trip | `test/security-skill-integrity.test.ts` Phase 9 spy-affordance |
| `test/install-envelope-shape.test.ts` (EXTEND) | Additive `CheckId` literal coverage; `escalateStatus` mixed-level | `test/check.test.ts` Phase 1 extension |
| `test/install-sh.smoke.test.ts` (OPTIONAL) | `bash install.sh --dry-run` shell-out against mocked GitHub release endpoint | NO in-tree; DEFERRED to verify-phase if vitest shell-out is fragile (Topic 10 line 1038) |

**No new HTTP-client modules.** `request_capability` has NO fetch boundary — pure URL build. install.sh / install.ps1 use OS-native `curl`/`Invoke-WebRequest` (NOT Node fetch — binary isn't installed yet when they run).

## 7. Parallelism Opportunities + Wave Structure Recommendation

### File-touch overlap matrix

| | 10-01 | 10-02 | 10-03 | 10-04 |
|---|---|---|---|---|
| 10-01 | — | none | shares `package.json` (different sections — `pkg`/scripts vs deps) — section-separated, no line conflict | none |
| 10-02 | | — | **OVERLAPS on `setup-mcp-clients.ts` (same NEW file) AND `install-envelope.ts` (both widen union with different literal batches → guaranteed merge conflict on closing `;`)** | none |
| 10-03 | shares `package.json` | shares `setup-mcp-clients.ts` + `install-envelope.ts` | — | none |
| 10-04 | | | | — |

### Recommended carve order: **(10-01 ∥ 10-03 ∥ 10-04) → 10-02**

- **10-01 ∥ 10-03 ∥ 10-04** — safe 3-way parallel. 10-01's `package.json` edits are in `pkg` config + scripts; 10-03's in `dependencies` — section-separated; no line conflict. 10-04 is fully independent (only touches `register-all.ts` + `error-codes.ts` append-only).
- **10-02 sequential AFTER 10-03** — to inherit `setup-mcp-clients.ts` (10-03 creates it; 10-02 consumes its `detectMcpClients` + `registerWithJsonConfig` exports) AND the install.sh batch of `CheckId` literals (10-02 adds them; 10-03 adds the setup-wizard batch in the same union).

**Refinement from RESEARCH suggestion**: The prompt's "10-02 ∥ 10-03" would COLLIDE on `setup-mcp-clients.ts` + `install-envelope.ts`. Pattern-mapper serializes 10-02 AFTER 10-03 instead.

### Resource-cost note (global CLAUDE.md "Phase Resource-Intensive Parallel Work Sequentially")

3-way parallel (10-01 ∥ 10-03 ∥ 10-04) is lightweight: 10-01 is pure tooling (no `tsc` against src); 10-03 + 10-04 are `tsc`-bounded with new test files. No build saturation risk. Wall-clock estimate: ~1.5-2x the sequential time of the longest plan (10-03).

If executor capacity is tight: serialize as 10-04 → 10-01 → 10-03 → 10-02 (10-04 smallest + fully independent; 10-01 no src/ touch; 10-03 sets up shared surface 10-02 needs; 10-02 last).

## Metadata

**Analog search scope:** `src/index.ts`, `src/diagnostics/{check,install-envelope}.ts`, `src/config/config-file.ts`, `src/security/{skill-integrity,canonical-dispatch}.ts`, `src/tools/{register-all,check_contract_security,pair_ledger_live_start,get_vaultpilot_config_status}.ts`, `src/signing/error-codes.ts`, `src/server.ts`, `package.json`; confirmed via `ls`: `.github/workflows/` does NOT exist + `src/cli/` does NOT exist (both first-occupancies); cross-referenced 08-PATTERNS.md (full) + 09-PATTERNS.md (partial, 300 lines for voice anchor) + 10-RESEARCH.md (full)
**Files scanned:** 12 source files (full read on 9; targeted reads on 3) + 2 prior PATTERNS.md + 10-RESEARCH.md
**Pattern extraction date:** 2026-05-18
**No-analog items:** 4 — `.github/workflows/release.yml` + `install.sh` + `install.ps1` + `src/cli/setup-prompts.ts` (first `@clack/prompts` consumer). All four covered by verbatim-copyable sketches in RESEARCH § Topics 4, 5, 6, 7
**FROZEN-area boundary:** LARGEST of any phase to date — ALL `src/signing/*`, ALL `src/tools/prepare_*` + preview + send + verify, ALL `src/protocols/*`, ALL Phase 9 `src/security/*`, `src/wallet/session-manager.ts`, `src/chains/registry.ts`, `src/config/{contracts,env}.ts`, `src/config/config-file.ts` lines 1-95
**Wave-parallelism boundary:** 10-01 ∥ 10-03 ∥ 10-04 safe; 10-02 sequential AFTER 10-03 (file-overlap on `setup-mcp-clients.ts` + `install-envelope.ts` union widening)
