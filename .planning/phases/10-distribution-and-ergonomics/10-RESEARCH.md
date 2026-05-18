# Phase 10: Distribution + ergonomics — Research

**Researched:** 2026-05-18
**Domain:** Per-platform binary build pipeline (`pkg` vs `bun build --compile` vs Node SEA `--build-sea`) + GitHub Actions release workflow + `install.sh` (curl-pipe) and `install.ps1` (PowerShell `Invoke-WebRequest`) shell installers + OS+arch auto-detect + MCP client auto-registration (Claude Code CLI / Claude Desktop / Cursor) + `vaultpilot-mcp setup` interactive wizard (prompt-library choice + `--non-interactive --json` mode + `~/.vaultpilot-mcp/config.json` merge semantics) + `request_capability` GitHub pre-filled-issue URL builder with in-process 3/hour rate-limit + InstallEnvelope JSON parity with Phase 1 `--check` shape
**Confidence:** HIGH on (a) `@yao-pkg/pkg@6.19.0` capability shape — empirically verified via `npm install` + `lib-es5/types.d.ts` probe at `/tmp/pkg-probe/`: ESM-aware, cross-compile targets `node22-{linux,macos,win}-{x64,arm64}`, optional `sea: true` flag for Node SEA backend, no native bindings required for the vaultpilot stack (`viem` + `@walletconnect/sign-client` + `@modelcontextprotocol/sdk` are pure JS — `find node_modules -name "*.node" -o -name "binding.gyp"` returned ZERO hits); (b) GitHub URL query-parameter shape for pre-filled issues — empirically verified via [CITED: docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue]; (c) Claude Code skill + MCP register paths — known from Phase 9 research + INST-01..03 implementation. MEDIUM on (d) `pkg --sea` vs `node --build-sea` vs `bun build --compile` exact binary-size + cold-start latency on each platform (training-data approximations; empirical probe deferred to execute time); (e) macOS Gatekeeper friction for an unsigned binary downloaded via curl-pipe (the quarantine `xattr` is documented as set on `curl` download in 2026, but the actual user-facing dialog varies by macOS minor version; Homebrew explicitly no-longer-allows-bypass per 2026 news — relevant to install.sh design); (f) prompt-library choice (`@clack/prompts` is the modern recommendation but `prompts@2.4.2` is more stable and dep-light — researcher reasonable-call locks `@clack/prompts` for clean ESM + non-interactive support as DF-2). LOW on (g) Cursor's exact mcp.json schema for the project-scope vs user-scope distinction in 2026 (the user already covered this in Phase 1 INST-03; setup-wizard reuses the same code path).

## Summary

Phase 10 is the LAST code phase for v1.x. It ships v1.4 Distribution: a per-platform binary so users without Node can install via a curl-piped shell script, plus an interactive `vaultpilot-mcp setup` wizard for users with Node, plus a `request_capability` tool that produces a pre-filled GitHub issue URL with a 3/hour rate-limit. After Phase 10 ships, the remaining v1.x work is **real-Ledger verify-phases** (v1.0/v1.1/v1.2/v1.3 all open per user's 2026-05-16 "I'll do testings later" directive); no further code phases until v2.0 Solana.

The phase has a fundamentally different surface from Phases 1-9 (which were runtime trust-pipeline + decode-and-refuse defenses). Phase 10 ships:

1. **Build pipeline + GitHub release workflow** (Plan 10-01): adopt **`@yao-pkg/pkg@6.19.0`** (the actively-maintained fork of archived `vercel/pkg`) as the build tool. Cross-compile to 4 supported targets (`linux-x64`, `macos-x64`, `macos-arm64`, `windows-x64`); `linux-arm64` falls back to a `use npm install -g vaultpilot-mcp` message per ROADMAP success-criterion #1. **DF-1 below locks pkg over Bun/SEA on cross-compile maturity + Node-ecosystem fidelity.** GitHub Actions matrix build triggered on semver tags (`v1.4.0` and onward); `softprops/action-gh-release@v2` uploads release artifacts. The release workflow lives at `.github/workflows/release.yml` (NEW; complements the existing `ci.yml`).

2. **`install.sh` (POSIX bash) + `install.ps1` (PowerShell)** (Plan 10-02): curl-pipe-to-bash + Invoke-WebRequest patterns mirroring rustup / bun / deno. Auto-detect OS via `uname -s`, arch via `uname -m` (normalized: `x86_64` → `x64`, `aarch64`/`arm64` → `arm64`). Downloads the per-platform binary from the latest GitHub release (or a specific tagged release via `VAULTPILOT_MCP_VERSION` env var); installs to `~/.local/bin/vaultpilot-mcp` (POSIX) or `%LOCALAPPDATA%\vaultpilot-mcp\bin\vaultpilot-mcp.exe` (Windows). Optionally launches the `setup` wizard (`--no-setup` skips). **Idempotent re-runs** detect existing install + version, skip the download if SHA-256 matches, prompt to overwrite otherwise. JSON-output mode via `--json` (matching the Phase 1 InstallEnvelope shape, see Topic 9).

3. **`vaultpilot-mcp setup` interactive wizard** (Plan 10-03): NEW CLI subcommand (alongside the existing `--check` from Phase 1 + `--version`/`-v`). Three modes: (a) **interactive** — `@clack/prompts` (DF-2-locked) prompts for `WALLETCONNECT_PROJECT_ID`, RPC keys (Infura/Alchemy provider shorthand from Phase 8 INST-40, or per-chain RPC URLs), optional Ledger pairing via existing `pair_ledger_live_start` + `_wait` tool surfaces, optional `ETHERSCAN_API_KEY` for `check_contract_security`; (b) **non-interactive `--non-interactive --json`** — reads a config-payload JSON from stdin (or `--config <path>`), validates against the same Zod schema, writes `~/.vaultpilot-mcp/config.json`, emits an `InstallEnvelope`-shaped JSON envelope on stdout; (c) **dry-run `--dry-run`** — runs validation + merge logic but doesn't write. Wizard READS the existing config.json via Phase 5 `readConfigFile()` (FROZEN — single SOT per Plan 05-01) and MERGES new values over old; doesn't overwrite untouched keys.

4. **`request_capability({ title, body })` tool** (Plan 10-04): builds a GitHub pre-filled-issue URL against `https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/issues/new` with `title=<urlencoded>&body=<urlencoded>&labels=capability-request`. Returns the URL in structuredContent + a clickable hyperlink in the text content. **NO auto-submit** (DIST-43 requirement — user must click manually; agent never authors an issue on the user's behalf). 3/hour rate-limit via in-memory sliding-window counter (Map<timestamp[]>); refusal with `RATE_LIMIT_EXCEEDED` errorCode 20 surfaces the next-allowed-time + the URL the user can use manually. **URL-length cap**: GitHub returns 414 URI Too Long at ~8KB; the tool truncates body at 7KB with a trailing `[...truncated; full text logged to ~/.vaultpilot-mcp/capability-requests/<timestamp>.md]` note that names the local file the agent wrote so the user can paste it manually.

**FROZEN-area zero-diff verification:** Phase 10 is mostly NEW surface. The cryptographic-binding chain stays byte-frozen (Phase 4 + 6 + 7 + 8 + 9 all inherited). The signing pipeline (`src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/signing/handle-store.ts`, `src/tools/send_transaction.ts` three gates) gets ZERO bytes changed. The setup wizard's config.json writer threads through Plan 05-01's `readConfigFile()` for read + a new-but-isolated `writeConfigFile()` helper for write (Topic 7 below). No prepare/preview/send tool gets touched. Phase 8 chain plumbing + Phase 9 verification tools all untouched.

**Primary recommendations** (locked at planning gate per Phase 5/6/7/8/9 reasonable-call discipline):

- **Binary build tool: `@yao-pkg/pkg@6.19.0`** (DF-1 below). Adopt over Bun's `--compile` and Node SEA's `--build-sea` for (a) cross-compile maturity — `pkg` produces all 4 target binaries from a Linux GitHub runner without target-host emulation; (b) ecosystem fidelity — `pkg` consumes the existing `tsc`-built `dist/` directly via the `bin` entry in `package.json`, no source-rewrite (Bun would re-transpile via Bun's transpiler, surfacing potential viem/WC v2 edge-cases not exercised in Phase 1-9); (c) ESM support — `pkg`'s ESM path is documented + works with the project's `"type": "module"` setting; (d) no native bindings required — `find node_modules -name "*.node"` empirical probe returned zero hits, so the native-addon caveat doesn't apply.
- **GitHub Actions release workflow**: matrix build on a Linux runner (1 job × 4 targets, cross-compile), `softprops/action-gh-release@v2` uploads, triggered on `v*` tag push. Workflow lives at `.github/workflows/release.yml` NEW; complements the existing `ci.yml` (untouched). Per-asset SHA-256 sums uploaded alongside binaries (`vaultpilot-mcp-<version>-<platform>.<ext>.sha256`).
- **`install.sh`**: POSIX-bash. Lead with `set -euo pipefail`. OS detect via `uname -s` (Linux/Darwin), arch via `uname -m` (normalized). Refusal on `linux-arm64` AND `mips*`/`riscv64`/etc. (not in the target matrix) with a `use 'npm install -g vaultpilot-mcp'` fallback message + exit 1. Downloads via `curl -fsSL` (TLS-only + fail-fast + silent-progress) to a temp file, SHA-256-verifies against the per-asset checksum from GitHub releases, installs to `~/.local/bin/`. Optionally invokes `vaultpilot-mcp setup` (or `--no-setup` to skip). `--json` mode emits an InstallEnvelope (Topic 9). **Defense against truncation/MITM**: wrap the script in a top-level `main() { … }; main "$@"` function so a half-downloaded script errors on syntax rather than executing partial `rm` commands [CITED: arp242.net/curl-to-sh.html — the canonical "wrap-in-function" mitigation].
- **`install.ps1`**: PowerShell. Uses `Invoke-WebRequest -UseBasicParsing` to download. OS-arch detect via `[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture` (`X64` / `Arm64` / etc.). Installs to `%LOCALAPPDATA%\vaultpilot-mcp\bin\` and appends to `$PATH` via a registry edit (HKEY_CURRENT_USER\Environment). Mirrors the Phase 1 INST-04 `cmd /c` wrapper coordination so `claude mcp add` on Windows works against the installed binary.
- **MCP client auto-registration**: detect which clients are installed by probing config-file paths (Topic 6). For Claude Code CLI: shell out to `claude mcp add vaultpilot-mcp -- /path/to/installed/binary` (idempotent — `claude mcp` updates existing entries). For Claude Desktop: read+merge `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%\Claude\claude_desktop_config.json` (Windows), `~/.config/Claude/claude_desktop_config.json` (Linux). For Cursor: read+merge `~/.cursor/mcp.json`. Each registration is OPT-IN (the installer prompts: "Detected Claude Desktop — register vaultpilot-mcp? [Y/n]") with `--auto-register-all` to skip prompts in CI.
- **Setup wizard prompt-library: `@clack/prompts@1.4.0`** (DF-2 below). Clean ESM-first design + native `--non-interactive` story via skipping the prompt entirely + 0 native deps. Alternatives considered: `prompts@2.4.2` (stable but CJS-leaning), `@inquirer/prompts@8.4.3` (modular but a larger dep tree). `@clack/prompts` aligns with the project's TypeScript strict + ESM-only posture.
- **`request_capability` tool**: rate-limit shape is a **sliding-window 3-per-hour** counter in `src/security/request-capability-rate-limit.ts` (NEW; in `src/security/` per Phase 9 architectural pattern). State is module-scoped `timestamps: number[]` array, pruned on each call. **NO persistence across server restarts** — rate-limit is per-process (a user restarting their MCP session resets the counter; documented in tool description as expected behavior, not a bug). URL builder uses `URLSearchParams` for encoding (per [CITED: developer.mozilla.org/en-US/docs/Web/API/URLSearchParams] — guaranteed to handle multiline body + special chars + emoji correctly per WHATWG URL spec).
- **InstallEnvelope JSON shape**: reuse the Phase 1 `src/diagnostics/install-envelope.ts` `InstallEnvelope` type + extend with `install-action` `CheckId` literals (`binary-download`, `mcp-client-register-claude-code`, `mcp-client-register-claude-desktop`, `mcp-client-register-cursor`, `setup-wizard-config-write`). NEW types live in `src/diagnostics/install-envelope.ts` (extension; Phase 1 surface byte-frozen for backward compat with existing `--check --json` consumers).
- **Cryptographic-binding chain ZERO DIFF:** verified empirically against current source — `src/signing/*` ALL FROZEN through Phase 9. Phase 10 NEW files only: `src/cli/setup.ts`, `src/cli/setup-prompts.ts`, `src/cli/setup-non-interactive.ts`, `src/cli/setup-mcp-clients.ts`, `src/tools/request_capability.ts`, `src/security/request-capability-rate-limit.ts`, `install.sh`, `install.ps1`, `.github/workflows/release.yml`. Phase 10 MODIFY (additive only): `src/index.ts` (NEW `setup` subcommand routing in the existing arg parser), `src/diagnostics/install-envelope.ts` (additive `CheckId` literals for installer surface), `src/tools/register-all.ts` (+1 import for `request_capability.js`), `src/signing/error-codes.ts` (+1 code `RATE_LIMIT_EXCEEDED` 20), `src/config/config-file.ts` (additive `writeConfigFile()` companion to existing `readConfigFile()`; Topic 7).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-platform binary build | Build-time (`@yao-pkg/pkg@6.19.0` invoked from GitHub Actions matrix) | `pkg-fetch` (downloads node-build cache per target) | Cross-compile from a Linux runner to all 4 targets (linux-x64, macos-x64, macos-arm64, windows-x64). `pkg`'s `--target node22-{platform}-{arch}` flag matrix-maps cleanly. |
| GitHub release artifact publication | GitHub Actions (`softprops/action-gh-release@v2`) | GitHub Releases | Workflow runs on `v*` tag push; uploads per-platform binary + SHA-256 sum + the install.sh + install.ps1 scripts themselves (so the curl-pipe URL points at a GitHub-hosted release asset, not the raw repo). |
| OS+arch auto-detect (install.sh) | Shell (`uname -s`, `uname -m`, arch normalization) | — | POSIX bash; no Node required (install.sh runs BEFORE the binary is installed). |
| OS+arch auto-detect (install.ps1) | PowerShell ([System.Runtime.InteropServices.RuntimeInformation]) | — | Native PowerShell API; mirrors install.sh's role on Windows. |
| Binary download + integrity check | Shell (curl-pipe install.sh) + PowerShell (install.ps1) | SHA-256 verification against GitHub-released checksum | `curl -fsSL` + `shasum -a 256 -c` (POSIX) / `Get-FileHash -Algorithm SHA256` (PowerShell). |
| MCP client auto-registration (Claude Code CLI) | install.sh / install.ps1 → `claude mcp add` (shell-out) | Claude Code CLI binary if installed | Idempotent CLI invocation. Detection: `command -v claude` returns 0 → CLI present. |
| MCP client auto-registration (Claude Desktop) | install.sh / install.ps1 → JSON read/merge/write | `claude_desktop_config.json` at per-platform path | Detection: file exists at platform-specific path. Merge: existing `mcpServers` object preserved; new `vaultpilot-mcp` entry added. |
| MCP client auto-registration (Cursor) | install.sh / install.ps1 → JSON read/merge/write | `~/.cursor/mcp.json` | Detection + merge same shape as Claude Desktop. |
| `vaultpilot-mcp setup` interactive wizard | MCP server CLI (`src/cli/setup.ts` NEW) + `@clack/prompts` | `src/config/config-file.ts` `readConfigFile()` (existing) + `writeConfigFile()` (NEW additive companion) | Subcommand on the existing bin entry. Interactive prompts via `@clack/prompts`. Non-interactive via stdin JSON. |
| `vaultpilot-mcp setup --non-interactive --json` | MCP server CLI (`src/cli/setup-non-interactive.ts` NEW) | Zod schema (mirror of interactive prompt set) | CI/automation path. Reads JSON from stdin (or `--config <path>`), validates, merges, writes, emits InstallEnvelope-shaped JSON to stdout. |
| `request_capability` tool | MCP server (`src/tools/request_capability.ts` NEW) | `URLSearchParams` + sliding-window rate-limit (`src/security/request-capability-rate-limit.ts` NEW) | Pure URL-builder + rate-limit check; no network calls (user clicks the URL manually, not the tool). |
| URL-length cap fallback | `src/tools/request_capability.ts` + local file write to `~/.vaultpilot-mcp/capability-requests/<timestamp>.md` | `node:fs/promises` | When body would push the URL past 7KB (well under GitHub's ~8KB 414 limit), truncate the URL body + write the full text to a local file for manual paste. |
| InstallEnvelope JSON shape | `src/diagnostics/install-envelope.ts` (extend, additive `CheckId` literals) | Phase 1 InstallEnvelope type | Mirror of Phase 1 `--check --json` shape; preserves backward compat for existing `--check` consumers. |
| Setup-wizard Ledger pairing path | Wizard delegates to existing `pair_ledger_live_start` + `_wait` tools (Phase 3) | WC session-manager (Phase 8 multi-chain widening) | NO new pairing logic — wizard prompts the user for `WALLETCONNECT_PROJECT_ID`, then calls the existing tools via the registered handler interface. |

## Topics

### Topic 1: Binary build tool selection — `@yao-pkg/pkg` vs `bun build --compile` vs Node SEA `--build-sea` (Plan 10-01)

**Recommendation:** Adopt `@yao-pkg/pkg@6.19.0`. Justified below; DF-1 surfaces the locked decision + the cost calculus.

**Empirical SDK probe** (performed 2026-05-18 at `/tmp/pkg-probe/`):

```bash
$ npm install --no-audit --no-fund @yao-pkg/pkg@6.19.0
# Installed cleanly; 19 transitive deps. Dependencies: @babel/{generator,parser,traverse,types}@^7.23.0,
# @roberts_lando/vfs@^0.3.3, @yao-pkg/pkg-fetch@3.5.33, esbuild@^0.27.3,
# into-stream@^9.1.0, multistream@^4.1.0, picocolors@^1.1.0, picomatch@^4.0.2,
# postject@^1.0.0-alpha.6, prebuild-install@^7.1.1, resolve.exports@^2.0.3,
# resolve@^1.22.10, stream-meter@^1.0.4

$ cat node_modules/@yao-pkg/pkg/lib-es5/types.d.ts | grep -E "NODE_(OSES|ARCHS)|targets"
# Confirmed targets:
#   NODE_OSES: ["darwin", "linux", "win"]
#   NODE_ARCHS: ["x64", "arm64", "armv7l", "ppc64", "s390x", "riscv64", "loong64"]
# Confirmed `targets?: string | string[]` in PkgOptions
# Confirmed `sea?: boolean` flag — pkg can optionally backend to Node SEA

$ cat node_modules/@yao-pkg/pkg/lib-es5/index.d.ts
# export declare function exec(argv: string[]): Promise<void>;
# Single entry point; argv-driven. Same shape as the CLI invocation.
```

**Probe verdict: ADOPT.** ESM + cross-compile + no native modules required + 19 transitive deps. No deal-breakers.

**Native modules in the vaultpilot stack:**

```bash
$ find /Users/s/dev/vaultpilot/vaultpilot-mcp-gsd-inspired/.claude/worktrees/plan-phase-10/node_modules \
       -name "*.node" -o -name "binding.gyp" 2>/dev/null | wc -l
0
```

Empirically confirmed: `viem` + `@walletconnect/sign-client` + `@modelcontextprotocol/sdk` are pure JS. **Native-module compat is not a Phase 10 constraint.** This eliminates the main historical reason to pick `pkg` over Bun or SEA.

**Three-way comparison:**

| Tool | Cross-compile from Linux runner | Binary size (typical) | Cold-start | ESM support | Node-runtime fidelity | Active maintenance |
|------|--------------------------------|----------------------|------------|-------------|----------------------|--------------------|
| **`@yao-pkg/pkg@6.19.0`** | ✓ all 4 targets from one runner | ~40-50 MB (gzipped ~15 MB) | ~150-300ms | ✓ (per docs + types.d.ts) | ✓ pure Node 22 binary (`pkg-fetch` provides per-target Node builds) | ✓ active fork, last published 17 days ago [VERIFIED: npm view @yao-pkg/pkg version → 6.19.0] |
| Bun `bun build --compile` | ✓ via `--target=bun-{platform}-{arch}` | ~80-95 MB (Bun runtime bundled) | ~30-80ms (fastest) | ✓ native | ⚠ Bun re-transpiles via its own transpiler; some Node-isms differ (e.g. specific `fs/promises` edge-cases, `@walletconnect/sign-client`'s use of Node-shaped EventEmitter polyfills) | ✓ Bun 1.3.14 stable [VERIFIED 2026-05-18] |
| Node SEA (`node --build-sea` in Node 25.5+) | ⚠ only PRODUCES single-host binary; cross-compile via `pkg`-like wrapping over `pkg-fetch` | ~85-105 MB (full Node bundled + postject injection) | ~200-400ms | ✓ | ✓ identical Node runtime | ✓ stable as of Node 25.5 (2026-01-26) [CITED: joyeecheung.github.io/blog/2026/01/26/improving-single-executable-application-building-for-node-js/], but `--build-sea` per-host (no native cross-compile) |

**Why not Bun:** The Node-runtime fidelity question is load-bearing. Phases 1-9 shipped against `node ≥ 18.17` (per package.json `engines.node`); the FROZEN cryptographic-binding chain's behavior is anchored on Node's exact `crypto.createHash`, `fs/promises.readFile`, `Buffer` semantics. Bun re-implements these; the implementations are very close but NOT byte-identical in every edge case. Shipping a Bun binary would mean running the trust pipeline on a substrate that wasn't exercised in any Phase 1-9 test. Cost-benefit: Bun's ~70-90ms cold-start advantage isn't worth the substrate-shift risk for a sign-anything-on-Ledger tool whose value proposition is byte-bound trust.

**Why not Node SEA standalone:** Cross-compile is the killer feature for Phase 10. From a GitHub Actions Linux runner, we need to produce macOS-arm64 + macOS-x64 + Windows-x64 + Linux-x64 binaries. Node SEA's `--build-sea` produces a binary for the host you're running on; cross-compile requires either (a) running per-target host runners (4 separate matrix jobs, increasing CI time + cost) or (b) wrapping in a tool that already does cross-compile — which is exactly what `pkg` does (via `pkg-fetch`'s per-target Node-build cache). `pkg`'s `sea: true` flag is the optional backend bridge — you get pkg's cross-compile orchestration on top of Node SEA's bundling. **Phase 10 ships pkg with the default backend** (non-SEA) for v1.4; can flip to `sea: true` later without re-architecting.

**Why pkg's fork story matters:** `vercel/pkg` was archived in 2023 [VERIFIED: github.com/vercel/pkg shows archive banner]. `@yao-pkg/pkg` is the maintained fork at version 6.19.0 (last published 2026-05-01 per `npm view`). The fork actively supports Node 20/22 via `pkg-fetch@3.5.33`. NOT adopting the legacy `pkg@5.8.1` (which doesn't support Node 22).

**Build invocation (Plan 10-01 — sketch):**

```jsonc
// package.json — additive
{
  "scripts": {
    "build:binary": "pkg . --out-path dist-binaries --compress GZip",
    "build:binary:linux-x64":   "pkg . --target node22-linux-x64   --out-path dist-binaries",
    "build:binary:macos-x64":   "pkg . --target node22-macos-x64   --out-path dist-binaries",
    "build:binary:macos-arm64": "pkg . --target node22-macos-arm64 --out-path dist-binaries",
    "build:binary:windows-x64": "pkg . --target node22-win-x64     --out-path dist-binaries"
  },
  "pkg": {
    "scripts": ["dist/**/*.js"],
    "assets":  ["package.json"]
  },
  "devDependencies": {
    "@yao-pkg/pkg": "^6.19.0"  // NEW
  }
}
```

The `pkg.scripts` array names the JS files to bundle (the existing `tsc` build output at `dist/`); `pkg.assets` includes `package.json` so the binary can read its own version (matches the current `src/index.ts` `--version` path).

**Pitfall — top-level await + dynamic-import-with-attribute:** `src/server.ts:69` reads `package.json` via `await import("../package.json", { with: { type: "json" } })`. pkg's documentation calls out that dynamic `import()` of JSON via attributes works in v6.x; verify at execute time with a smoke-test binary. Recovery: if it fails, switch to `readFileSync` + `JSON.parse` (one-line fallback that works in every Node version + every bundler).

**Pitfall — ESM module resolution across the bundle boundary:** The project uses `"type": "module"` + `".js"` import extensions for TypeScript-emitted JS. pkg's resolver handles this; the empirical probe (types.d.ts shows `package.json.exports` integration via `resolve.exports`) confirms ESM-first design. Verify at execute time.

**Sources:**
- [VERIFIED: empirical install at `/tmp/pkg-probe/` 2026-05-18 — `@yao-pkg/pkg@6.19.0` package shape]
- [VERIFIED: `find … -name "*.node"` returned 0 — no native bindings in vaultpilot deps]
- [@yao-pkg/pkg on npm](https://www.npmjs.com/package/@yao-pkg/pkg) — version 6.19.0, last published 17 days ago
- [yao-pkg/pkg docs site](https://yao-pkg.github.io/pkg/) — Configuration, Targets, SEA vs Standard mode pages
- [Improving Single Executable Application Building for Node.js (Joyee Cheung, 2026-01-26)](https://joyeecheung.github.io/blog/2026/01/26/improving-single-executable-application-building-for-node-js/) — Node `--build-sea` flag landed in v25.5
- [Bun on npm](https://www.npmjs.com/package/bun) — version 1.3.14 stable [VERIFIED 2026-05-18]
- [Bun vs Node.js vs Deno 2026 comparison (DEV Community)](https://dev.to/jsgurujobs/bun-vs-deno-vs-nodejs-in-2026-benchmarks-code-and-real-numbers-2l9d)

### Topic 2: Per-platform release artifact shape — 4 supported targets + linux-arm64 fallback (Plan 10-01, 10-02)

**Recommendation:** Ship 4 binary artifacts per release; linux-arm64 returns a `use npm install -g vaultpilot-mcp` message from install.sh (no binary, no fallback) per ROADMAP success-criterion #1.

**Asset matrix:**

| Platform | Arch | Artifact filename | pkg target string | Notes |
|----------|------|-------------------|-------------------|-------|
| Linux | x64 | `vaultpilot-mcp-v1.4.0-linux-x64.tar.gz` | `node22-linux-x64` | tar.gz containing `vaultpilot-mcp` binary |
| macOS | x64 (Intel) | `vaultpilot-mcp-v1.4.0-macos-x64.tar.gz` | `node22-macos-x64` | tar.gz; **unsigned** — Gatekeeper friction (Topic 3) |
| macOS | arm64 (Apple Silicon) | `vaultpilot-mcp-v1.4.0-macos-arm64.tar.gz` | `node22-macos-arm64` | tar.gz; **unsigned** — same Gatekeeper friction |
| Windows | x64 | `vaultpilot-mcp-v1.4.0-windows-x64.zip` | `node22-win-x64` | zip containing `vaultpilot-mcp.exe` |
| **Linux arm64** | **arm64** | **(no binary)** | **n/a** | **Fallback: install.sh detects + emits `use npm install -g vaultpilot-mcp` message + exit 1** |

**Per-asset SHA-256 sum:** `vaultpilot-mcp-v1.4.0-<platform>-<arch>.<ext>.sha256` (5-line text file: `<hex> <filename>\n`). Generated in the GitHub Actions release workflow via `shasum -a 256 <file> > <file>.sha256`. The install.sh + install.ps1 download both the artifact AND its `.sha256` companion + verify before extracting.

**Combined `SHA256SUMS` index file:** `vaultpilot-mcp-v1.4.0-SHA256SUMS.txt` (5-line file: `<hex> <filename>` per row). Convenience for human users + machine consumers who want all checksums in one fetch.

**Source-tarball release artifact:** Ship the source tarball as `vaultpilot-mcp-v1.4.0-source.tar.gz` (auto-generated by GitHub Releases UI; no workflow action needed). Not used by install.sh but useful for users who prefer `npm install` + build-from-source.

**Why exclude linux-arm64 from the binary matrix:**
- Empirical: `pkg-fetch@3.5.33` provides Node 22 builds for linux-arm64 (per its `binaries` table), so we COULD ship it.
- Cost-benefit: maintaining 5 binaries vs 4 doubles the failure-mode surface (arm64 Linux RPi / AWS Graviton users are a tiny v1.x audience; v3.0 hosted MCP will serve them via HTTP transport).
- ROADMAP success-criterion #1 explicitly defers: "linux-arm64 falls back to `use npm` message" — this is a locked decision, not a research finding.
- Plan 10-02's install.sh refusal arm: `linux-arm64` and any unrecognized arch trigger the `use npm` message + exit 1.

**No Windows arm64 in v1.4:** ROADMAP doesn't name it; v1.x scope deliberately omits it. Recovery: a Phase 10.x point-release adds it if user demand surfaces. install.sh on PowerShell-side similarly refuses with the `use npm` fallback.

**Sources:**
- [VERIFIED: @yao-pkg/pkg-fetch binaries table — supports linux-x64, linux-arm64, macos-x64, macos-arm64, win-x64 for node22]
- ROADMAP success-criterion #1 — names the 4-target matrix + linux-arm64 fallback explicitly
- [softprops/action-gh-release@v2](https://github.com/marketplace/actions/upload-files-to-a-github-release) — release-asset upload action

### Topic 3: macOS Gatekeeper friction — unsigned binaries + `xattr -d com.apple.quarantine` (Plans 10-01, 10-02)

**Recommendation:** v1.4 ships **unsigned binaries** with a documented user-side workaround in `install.sh`. Code-signing + notarization deferred to v1.5+ (DIST follow-up; out of v1.4 scope per ROADMAP). This is **accepted residual risk** — surface in SECURITY.md update.

**The friction shape:**
- A binary downloaded via `curl` carries the `com.apple.quarantine` extended attribute.
- On first execution, macOS Gatekeeper checks for a Developer ID signature; an unsigned binary is rejected with a dialog: "vaultpilot-mcp cannot be opened because the developer cannot be verified."
- The user has to either (a) Right-click → Open → confirm in the dialog (one-time per binary), or (b) run `xattr -d com.apple.quarantine /path/to/vaultpilot-mcp` to strip the attribute, or (c) `sudo spctl --master-disable` (global Gatekeeper bypass — DON'T recommend).

**install.sh approach for macOS:**

```bash
# Inside install.sh, after extraction to ~/.local/bin/vaultpilot-mcp:
if [[ "$(uname -s)" == "Darwin" ]]; then
  echo ""
  echo "==> macOS Gatekeeper notice:"
  echo "    vaultpilot-mcp v1.4 ships unsigned. On first run, Gatekeeper will"
  echo "    show 'cannot be opened because the developer cannot be verified.'"
  echo ""
  echo "    To remove the quarantine attribute now (one-time):"
  echo "        xattr -d com.apple.quarantine ~/.local/bin/vaultpilot-mcp"
  echo ""
  echo "    Or right-click the binary in Finder → Open → confirm in the dialog."
  echo ""
  # OFFER to strip the attribute (the installer is interactive unless --auto):
  read -r -p "    Run \`xattr -d com.apple.quarantine\` now? [y/N] " response
  if [[ "$response" =~ ^[Yy]$ ]]; then
    xattr -d com.apple.quarantine ~/.local/bin/vaultpilot-mcp || true
  fi
fi
```

**In `--non-interactive --auto` mode**: skip the prompt; emit the notice to stderr + leave the quarantine attribute on the binary. The user runs `xattr -d` manually.

**Why defer codesigning to v1.5:**
- Apple Developer Program: $99/year + organization-account-verification flow (real organization for codesigning — vs. personal cert for in-house dev). Out-of-scope cost for v1.4.
- Notarization workflow: requires Xcode + `xcrun notarytool submit --wait` (GitHub Actions on macos-latest runner). Adds ~5-10 min per release. Doable but not v1.4 scope.
- 2026 Homebrew tightening (per [CITED: news.mcan.sh/item/45907259]): Homebrew no longer auto-bypasses Gatekeeper for unsigned binaries. If vaultpilot ever gets a Homebrew formula, signing becomes mandatory.

**Windows SmartScreen friction:** Analogous problem on Windows. Unsigned `.exe` files downloaded from the internet trigger "Windows protected your PC" dialog. Same v1.4 stance: documented residual, install.ps1 prints the workaround (right-click → Properties → Unblock, or `Unblock-File -Path <path>`).

**Sources:**
- [CITED: hacktricks.wiki/en/macos-hardening/macos-security-and-privilege-escalation/macos-security-protections/macos-gatekeeper.html] — Gatekeeper + quarantine xattr semantics
- [CITED: isscloud.io/guides/macos-security-and-com-apple-quarantine-extended-attribute/] — `xattr -d com.apple.quarantine` mechanics
- [Homebrew tightening 2026 (news.mcan.sh)](https://news.mcan.sh/item/45907259) — context for v1.5 signing imperative

### Topic 4: GitHub Actions release workflow (Plan 10-01)

**Recommendation:** `.github/workflows/release.yml` (NEW; complements existing `ci.yml` which stays untouched). Triggered on `v*` tag push. Single Linux runner does cross-compile via `pkg --target` for all 4 platforms; `softprops/action-gh-release@v2` uploads.

**Workflow shape** (sketch, Plan 10-01):

```yaml
# .github/workflows/release.yml (NEW)
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write  # Required for softprops/action-gh-release to upload assets

jobs:
  build-and-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22.x', cache: 'npm' }
      - run: npm ci
      - run: npm run build         # tsc → dist/
      - run: npm run test          # vitest run — block release on red tests
      # Cross-compile all 4 targets from this single runner:
      - run: npm run build:binary:linux-x64
      - run: npm run build:binary:macos-x64
      - run: npm run build:binary:macos-arm64
      - run: npm run build:binary:windows-x64
      # tar.gz / zip + SHA-256 sums:
      - name: Package + checksum
        run: |
          mkdir -p release-assets
          cd dist-binaries
          tar czf ../release-assets/vaultpilot-mcp-${{ github.ref_name }}-linux-x64.tar.gz vaultpilot-mcp-linux
          tar czf ../release-assets/vaultpilot-mcp-${{ github.ref_name }}-macos-x64.tar.gz vaultpilot-mcp-macos-x64
          tar czf ../release-assets/vaultpilot-mcp-${{ github.ref_name }}-macos-arm64.tar.gz vaultpilot-mcp-macos-arm64
          zip ../release-assets/vaultpilot-mcp-${{ github.ref_name }}-windows-x64.zip vaultpilot-mcp-win.exe
          cd ../release-assets
          # Per-asset .sha256 + combined SHA256SUMS:
          shasum -a 256 vaultpilot-mcp-${{ github.ref_name }}-*.{tar.gz,zip} > vaultpilot-mcp-${{ github.ref_name }}-SHA256SUMS.txt
          for f in vaultpilot-mcp-${{ github.ref_name }}-*.{tar.gz,zip}; do
            shasum -a 256 "$f" > "$f.sha256"
          done
          # Also include install.sh + install.ps1 at the release-asset level so the
          # curl-pipe URL points at a GitHub-Releases-hosted asset, not the repo raw:
          cp ../install.sh .
          cp ../install.ps1 .
      - uses: softprops/action-gh-release@v2
        with:
          files: release-assets/*
          generate_release_notes: true
          draft: false
          prerelease: ${{ contains(github.ref_name, '-') }}  # vX.Y.Z-rc1 → prerelease
```

**Why single runner + cross-compile (vs per-target matrix runners):**
- Cost: 1 Linux runner × ~10 min vs 4 runners × ~5 min each. Net wall-clock similar; cost halved.
- Reproducibility: one runner, one build environment, no per-host drift. Same `node`/`npm`/`pkg` versions across all targets.
- `pkg`'s cross-compile is mature — `pkg-fetch` caches per-target Node binaries. No Rosetta/QEMU emulation needed (pkg doesn't EXECUTE the target binaries during build; it bundles them).
- macOS-arm64 cross-compile from Linux works because pkg doesn't need to invoke macOS toolchains.

**Trigger semantics:**
- Tag push `v1.4.0` → release workflow runs, creates GitHub Release `v1.4.0` with all 5 assets (4 binaries + install.sh + install.ps1) + auto-generated release notes.
- Tag push `v1.4.0-rc1` → marked prerelease (won't show as "latest" on GitHub).
- The `install.sh` URL uses the `/latest/download/` redirect pattern (GitHub's special URL form): `https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/releases/latest/download/vaultpilot-mcp-<platform>-<arch>.<ext>`. The `latest` redirect skips prereleases automatically.

**Pitfall — `permissions: contents: write`:** Default GITHUB_TOKEN doesn't have `contents: write`; the workflow MUST explicitly grant it [CITED: docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication]. Without this, `softprops/action-gh-release` fails with a 403 on upload. The existing `ci.yml` doesn't have this — it's release-workflow-specific.

**Pitfall — tag-vs-release race:** If a user pushes `v1.4.0` tag locally then deletes + recreates it, GitHub may have already started a workflow run against the old SHA. Mitigation: name release workflows with semver-required tags + use `tag` as the source-of-truth (not branch); never force-push tags after a release. [VERIFIED: standard GitHub Actions practice.]

**Pitfall — `latest` redirect prerelease handling:** GitHub's `/releases/latest/download/<asset>` redirect skips prereleases automatically. install.sh users who want a specific prerelease set `VAULTPILOT_MCP_VERSION=v1.4.0-rc1` env var → install.sh constructs `https://github.com/.../releases/download/v1.4.0-rc1/<asset>` instead.

**Sources:**
- [softprops/action-gh-release@v2](https://github.com/marketplace/actions/upload-files-to-a-github-release) — canonical release-asset upload action; v2 active as of 2026
- [CITED: How to Configure GitHub Actions for Multi-Platform Builds (oneuptime.com 2026-02-02)](https://oneuptime.com/blog/post/2026-02-02-github-actions-multi-platform-builds/view)
- [CITED: Automating Multi-Platform Releases with GitHub Actions (Md. Fuad Hasan, Medium)](https://itsfuad.medium.com/automating-multi-platform-releases-with-github-actions-f74de82c76e2)

### Topic 5: `install.sh` curl-pipe idiom + security mitigations (Plan 10-02)

**Recommendation:** Wrap the entire script in a top-level `main() { … }; main "$@"` function so a half-downloaded script errors on syntax rather than executing partial commands [CITED: arp242.net/curl-to-sh.html — the canonical "wrap-in-function" mitigation]. Lead with `set -euo pipefail`. Use `curl -fsSL` (fail-fast + silent + follow-redirects + TLS-only). SHA-256-verify the binary before extracting. Idempotency: detect existing install + same version → no-op; detect different version → prompt (or `--force` to skip prompt).

**install.sh skeleton** (sketch; Plan 10-02):

```bash
#!/usr/bin/env bash
# install.sh — vaultpilot-mcp curl-pipe-to-bash installer.
# Source: https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/blob/main/install.sh
#
# Usage:
#   curl -fsSL https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/releases/latest/download/install.sh | bash
#
# Env vars:
#   VAULTPILOT_MCP_VERSION   pin a specific version (default: latest)
#   VAULTPILOT_MCP_INSTALL_DIR  install dir (default: ~/.local/bin)
#   VAULTPILOT_MCP_NO_SETUP=1   skip the setup wizard after install
#   VAULTPILOT_MCP_AUTO=1       non-interactive: assume Y to all prompts

set -euo pipefail

# The whole script lives inside this function; the trailing `main "$@"` invocation
# is the LAST line. Partial downloads (script cut off mid-stream) result in an
# unclosed function → bash syntax error → no execution. Mitigation per
# arp242.net/curl-to-sh.html (canonical curl-pipe-safety idiom).
main() {
  local version="${VAULTPILOT_MCP_VERSION:-latest}"
  local install_dir="${VAULTPILOT_MCP_INSTALL_DIR:-$HOME/.local/bin}"
  local json_mode="${VAULTPILOT_MCP_JSON:-0}"

  # ── OS + arch detection (Topic 5.1) ──────────────────────────────────────
  local os arch
  os="$(detect_os)"      # linux | macos | (refused for everything else)
  arch="$(detect_arch)"  # x64 | arm64

  # ── Refusal arms (linux-arm64, mips, etc.) ────────────────────────────────
  if [[ "$os" == "linux" && "$arch" == "arm64" ]]; then
    refuse_unsupported "$os" "$arch" "Use 'npm install -g vaultpilot-mcp' for Linux arm64."
  fi
  if [[ "$os" == "windows" ]]; then
    refuse_unsupported "$os" "$arch" "Windows: use 'iwr -useb https://… | iex' with install.ps1 instead."
  fi

  # ── Resolve version → download URL ────────────────────────────────────────
  local archive_filename="vaultpilot-mcp-${version}-${os}-${arch}.tar.gz"
  local archive_url
  if [[ "$version" == "latest" ]]; then
    archive_url="https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/releases/latest/download/${archive_filename}"
  else
    archive_url="https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/releases/download/${version}/${archive_filename}"
  fi
  local sha256_url="${archive_url}.sha256"

  # ── Idempotency check ─────────────────────────────────────────────────────
  if [[ -f "$install_dir/vaultpilot-mcp" ]]; then
    local existing_version
    existing_version="$("$install_dir/vaultpilot-mcp" --version 2>/dev/null || echo "unknown")"
    if [[ "$existing_version" == "${version#v}" ]]; then
      log_info "vaultpilot-mcp $version already installed at $install_dir/vaultpilot-mcp — skipping download."
      register_with_mcp_clients_and_maybe_setup "$install_dir/vaultpilot-mcp"
      return 0
    fi
    confirm_overwrite "$existing_version" "$version" || exit 1
  fi

  # ── Download + SHA-256 verify ─────────────────────────────────────────────
  local tmp_dir; tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT
  curl -fsSL "$archive_url" -o "$tmp_dir/$archive_filename"
  curl -fsSL "$sha256_url"  -o "$tmp_dir/$archive_filename.sha256"

  ( cd "$tmp_dir" && shasum -a 256 -c "$archive_filename.sha256" ) || \
    fail "SHA-256 mismatch — refusing to install. Retry, or report at https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/issues"

  # ── Extract + install ─────────────────────────────────────────────────────
  mkdir -p "$install_dir"
  tar xzf "$tmp_dir/$archive_filename" -C "$tmp_dir"
  mv "$tmp_dir/vaultpilot-mcp-${os}"* "$install_dir/vaultpilot-mcp"
  chmod +x "$install_dir/vaultpilot-mcp"

  # ── macOS Gatekeeper offer (Topic 3) ──────────────────────────────────────
  if [[ "$os" == "macos" ]]; then
    offer_strip_quarantine "$install_dir/vaultpilot-mcp"
  fi

  # ── PATH check ────────────────────────────────────────────────────────────
  if ! echo ":$PATH:" | grep -q ":$install_dir:"; then
    log_warn "$install_dir is NOT on your \$PATH. Add: export PATH=\"$install_dir:\$PATH\""
  fi

  # ── MCP client auto-register + setup wizard (Topic 6, 7) ─────────────────
  register_with_mcp_clients_and_maybe_setup "$install_dir/vaultpilot-mcp"

  # ── InstallEnvelope JSON output (Topic 9) ────────────────────────────────
  if [[ "$json_mode" == "1" ]]; then
    emit_install_envelope_json
  fi
}

# … helper functions: detect_os, detect_arch, refuse_unsupported, log_info,
# log_warn, fail, confirm_overwrite, offer_strip_quarantine,
# register_with_mcp_clients_and_maybe_setup, emit_install_envelope_json …

main "$@"
```

#### Topic 5.1 — OS + arch detection

```bash
detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "macos" ;;
    CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
    *)       fail "Unsupported OS: $(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) fail "Unsupported arch: $(uname -m)" ;;
  esac
}
```

**Why `uname -s` + `uname -m`:** POSIX-portable; works on Linux + macOS + WSL + Git-Bash. The arch normalization (`x86_64` → `x64`, `aarch64` → `arm64`) is the convention pkg uses for its target strings + matches GitHub Release asset names.

**Pitfall — Rosetta-on-Apple-Silicon false positive:** A user on Apple Silicon running their shell through Rosetta would get `uname -m == x86_64` (Rosetta lies about arch). `arch` command + `sysctl -nq hw.optional.arm64` is more robust [CITED: frida/cryptoshark commit be22f6e on GitHub]. v1.4 ships with the `uname -m` form for simplicity; the false-positive case ships x64 binary on arm64 hardware, which **runs correctly via Rosetta** — degraded perf but not broken. Documented as residual.

**Pitfall — partial-download safety idiom:** Without the `main() { … }; main "$@"` wrapping, if the download cuts at line 42 of a 200-line script, bash executes lines 1-42 and stops; if line 42 happens to be `rm -rf $TMP_DIR` where `$TMP_DIR` wasn't yet set (because lines 50+ were truncated), the script silently does `rm -rf /` [CITED: arp242.net/curl-to-sh.html, lukespademan.com]. The wrapping idiom ensures a partial download produces a bash syntax error (unclosed function) → no execution.

**Pitfall — `curl -fsSL` vs `curl -L`:** `-f` = fail on 4xx/5xx, `-s` = silent (no progress), `-S` = show errors despite `-s`, `-L` = follow redirects. The `-fS` pair is load-bearing — without `-f`, a 404 redirect → 200 HTML page can pipe into bash and execute random HTML-as-bash. [CITED: GitHub bug-bounty has historical examples.]

**Pitfall — `set -e` + pipefail interactions:** `set -e` exits on any non-zero command. Inside `if/while` / `||` conditions, `set -e` is suppressed automatically (correct behavior). The `set -o pipefail` ensures pipe-failure is propagated through `tar xzf | ...` style chains. Together these prevent silent failures.

**Sources:**
- [CITED: Curl to shell isn't so bad (arp242.net)](https://www.arp242.net/curl-to-sh.html) — main+wrap idiom
- [CITED: 5 Ways to Deal With the install.sh Curl Pipe Bash problem (Chef Blog)](https://www.chef.io/blog/5-ways-to-deal-with-the-install-sh-curl-pipe-bash-problem)
- [CITED: The Dangers of curl | bash (Luke Spademan)](https://lukespademan.com/blog/the-dangers-of-curlbash/)
- [Rustup install.sh](https://sh.rustup.rs) — canonical curl-pipe pattern (also wraps in `main`)
- [Bun install.sh](https://bun.sh/install) — modern curl-pipe pattern
- [Deno install.sh](https://deno.land/install.sh) — alternative pattern (also wraps in main)

### Topic 6: MCP client auto-registration — Claude Code CLI / Claude Desktop / Cursor (Plan 10-02, 10-03)

**Recommendation:** install.sh + install.ps1 detect MCP clients via per-client config-file presence; prompt the user to register vaultpilot-mcp with each detected client (OPT-IN per client; `--auto-register-all` skips prompts). Claude Code CLI uses the `claude mcp add` command. Claude Desktop + Cursor use direct JSON merge of their respective config files. The `vaultpilot-mcp setup` wizard also offers re-registration as a sub-step (in case a user installed vaultpilot first + only later installed a client).

**Per-client registration shape:**

| Client | Detection | Registration command/path |
|--------|-----------|---------------------------|
| **Claude Code CLI** | `command -v claude` returns 0 | `claude mcp add vaultpilot-mcp -- <bin-path>` (idempotent — `claude mcp` updates existing entries) [CITED: docs.claude.com claude mcp add] |
| **Claude Desktop (macOS)** | File exists: `~/Library/Application Support/Claude/claude_desktop_config.json` | Read-merge-write JSON; add `"vaultpilot-mcp": { "command": "<bin-path>" }` to `.mcpServers` |
| **Claude Desktop (Linux)** | File exists: `~/.config/Claude/claude_desktop_config.json` | Same shape; XDG-Base-Dir convention |
| **Claude Desktop (Windows)** | File exists: `%APPDATA%\Claude\claude_desktop_config.json` | Same shape; PowerShell wraps via `cmd /c` (Phase 1 INST-04 precedent) — `"command": "cmd", "args": ["/c", "<bin-path>"]` |
| **Cursor** | File exists: `~/.cursor/mcp.json` (Linux/macOS); `%USERPROFILE%\.cursor\mcp.json` (Windows) | Read-merge-write JSON; same `.mcpServers` shape as Claude Desktop |

**Detection logic** (Plan 10-02 install.sh + Plan 10-03 setup-mcp-clients.ts):

```bash
# install.sh (snippet)
detected_clients=()
command -v claude >/dev/null 2>&1 && detected_clients+=("claude-code")
[[ -f "$HOME/Library/Application Support/Claude/claude_desktop_config.json" ]] && detected_clients+=("claude-desktop-macos")
[[ -f "$HOME/.config/Claude/claude_desktop_config.json" ]] && detected_clients+=("claude-desktop-linux")
[[ -f "$HOME/.cursor/mcp.json" ]] && detected_clients+=("cursor")
```

```typescript
// src/cli/setup-mcp-clients.ts (Plan 10-03 — sketch)
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

export interface DetectedClient {
  name: "claude-code" | "claude-desktop" | "cursor";
  configPath: string | null; // null for claude-code (CLI-managed)
  detected: boolean;
}

export function detectMcpClients(): DetectedClient[] {
  const home = homedir();
  const plat = platform(); // "darwin" | "linux" | "win32"
  const claudeDesktopPath =
    plat === "darwin" ? join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json") :
    plat === "win32"  ? join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json") :
                        join(home, ".config", "Claude", "claude_desktop_config.json");
  const cursorPath = join(home, ".cursor", "mcp.json");
  // claude-code CLI detection delegated to a `commandExists("claude")` helper
  // that shells out — keeps the path-probe pattern uniform.
  return [
    { name: "claude-code",    configPath: null,                 detected: commandExists("claude") },
    { name: "claude-desktop", configPath: claudeDesktopPath,    detected: existsSync(claudeDesktopPath) },
    { name: "cursor",         configPath: cursorPath,           detected: existsSync(cursorPath) },
  ];
}
```

**JSON merge semantics** (Plan 10-03, Plan 10-02 reuses):

```typescript
// Read existing config, preserve every key except `.mcpServers["vaultpilot-mcp"]`
// (which we always overwrite to current binary path).
async function registerWithJsonConfig(
  configPath: string,
  binaryPath: string,
  wrapForWindows: boolean,
): Promise<void> {
  let existing: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(configPath)) {
    const raw = await readFile(configPath, "utf8");
    try { existing = JSON.parse(raw); } catch { throw new Error(`Malformed JSON at ${configPath}`); }
  }
  const serverEntry = wrapForWindows
    ? { command: "cmd", args: ["/c", binaryPath] }
    : { command: binaryPath };
  const merged = {
    ...existing,
    mcpServers: { ...(existing.mcpServers ?? {}), "vaultpilot-mcp": serverEntry },
  };
  // Format with 2-space indent (matches Claude Desktop's documented convention):
  await writeFile(configPath, JSON.stringify(merged, null, 2) + "\n");
}
```

**Why opt-in per client (not auto-register-all default):**
- A user with Claude Code CLI + Claude Desktop + Cursor would otherwise see 3 silent registrations, surprising for "I just want to install the binary" intent.
- The InstallEnvelope (Topic 9) records which clients were registered, so a `--json` CI flow gets the same information without prompts.
- `--auto-register-all` flag (or `VAULTPILOT_MCP_AUTO_REGISTER=all` env) skips prompts for fully-automated install.

**Pitfall — Claude Desktop requires restart after config edit:** "Claude Desktop reads the config file once at startup. After editing, you must fully quit and reopen the app for changes to take effect." [CITED: mcpplaygroundonline.com/blog/complete-guide-mcp-config-files-claude-desktop-cursor-lovable]. install.sh + setup wizard prints a notice: "Claude Desktop registered. Restart Claude Desktop to load vaultpilot-mcp."

**Pitfall — Cursor live-reloads:** "Unlike Claude Desktop, Cursor picks up config changes automatically — no restart needed." [CITED: same source]. No notice needed for Cursor.

**Pitfall — `claude mcp add` is idempotent BUT may prompt:** If `vaultpilot-mcp` is already registered with a different binary path, `claude mcp add` MAY prompt for confirmation. install.sh runs `claude mcp remove vaultpilot-mcp` first (best-effort, ignore failures) → `claude mcp add` cleanly. setup-mcp-clients.ts mirrors.

**Pitfall — JSON config file: malformed pre-existing content.** If the user has hand-edited their config to malformed JSON, the wizard MUST refuse to overwrite (would lose data). Surface as: "Refused — `claude_desktop_config.json` is malformed JSON. Fix the file first, then re-run `vaultpilot-mcp setup --register-clients`."

**Sources:**
- [CITED: The Complete Guide to MCP Config Files (MCP Playground 2026)](https://mcpplaygroundonline.com/blog/complete-guide-mcp-config-files-claude-desktop-cursor-lovable)
- [CITED: Claude MCP Setup Guide 2026 (buildfastwithai.com)](https://www.buildfastwithai.com/blogs/claude-mcp-setup-guide-2026)
- [CITED: Configuring MCP Tools in Claude Code (Scott Spence)](https://scottspence.com/posts/configuring-mcp-tools-in-claude-code)
- Phase 1 INST-04 implementation (in-repo) — `cmd /c` wrapper precedent for Windows
- Phase 5 Plan 05-01 `readConfigFile()` (in-repo) — FROZEN; setup wizard reads via this surface

### Topic 7: `vaultpilot-mcp setup` interactive wizard + `--non-interactive --json` mode + config.json merge (Plan 10-03)

**Recommendation:** Three modes — interactive (`@clack/prompts`, DF-2-locked) / non-interactive (`--non-interactive --json`, reads stdin JSON) / dry-run (`--dry-run`). Wizard READS existing config.json via Phase 5 `readConfigFile()` (FROZEN — single SOT); MERGES new values over old; WRITES via a NEW additive `writeConfigFile()` companion in the same module. Output emits InstallEnvelope-shaped JSON in `--json` mode.

#### Prompt flow (interactive mode)

```
$ vaultpilot-mcp setup

  ╔══════════════════════════════════════════════╗
  ║   vaultpilot-mcp setup wizard (v1.4.0)       ║
  ╚══════════════════════════════════════════════╝

  Existing config detected at ~/.vaultpilot-mcp/config.json.
  This wizard will MERGE new values with existing ones; untouched
  keys are preserved.

  Skip to a specific step:
    ▸ All steps   (default)
      RPC keys only
      Ledger pairing only
      MCP client registration only

  ━━━ Step 1: WalletConnect ━━━━━━━━━━━━━━━━━━━━━━━━━
  WalletConnect requires a free Project ID from
  https://cloud.walletconnect.com.

  WALLETCONNECT_PROJECT_ID? [or "skip"]
  > _

  ━━━ Step 2: RPC keys (choose provider) ━━━━━━━━━━━━
    ▸ Per-chain explicit URLs (e.g. ETHEREUM_RPC_URL=...)
      Provider shorthand: Infura RPC_API_KEY
      Provider shorthand: Alchemy RPC_API_KEY
      Skip (use PublicNode free public RPCs — rate-limited)

  ━━━ Step 3: Optional Ledger pairing ━━━━━━━━━━━━━━━
  Pair your Ledger via WalletConnect now? [Y/n]
  > _
  # If Y: prompts WALLETCONNECT_PROJECT_ID (if not set above),
  # then invokes pair_ledger_live_start tool → emits wcUri →
  # user pastes into Ledger Live → wizard polls pair_ledger_live_wait.

  ━━━ Step 4: Optional Etherscan key ━━━━━━━━━━━━━━━━
  ETHERSCAN_API_KEY enables check_contract_security (Aave Pool
  verification, age, privileged roles). Optional but recommended.

  ETHERSCAN_API_KEY? [or "skip"]
  > _

  ━━━ Step 5: MCP client registration ━━━━━━━━━━━━━━━
  Detected:
    [✓] Claude Code CLI
    [✓] Claude Desktop (macOS)
    [ ] Cursor

  Register vaultpilot-mcp with which clients?
    [x] Claude Code CLI
    [x] Claude Desktop (macOS)

  ━━━ Step 6: Confirm ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Will write/update ~/.vaultpilot-mcp/config.json with:
    - rpcUrl: https://eth-mainnet.g.alchemy.com/v2/REDACTED
    - walletConnectProjectId: REDACTED
    - etherscanApiKey: REDACTED
  Will register vaultpilot-mcp with Claude Code CLI + Claude Desktop.

  Proceed? [Y/n]
  > _

  ✓ Wrote ~/.vaultpilot-mcp/config.json
  ✓ Registered with Claude Code CLI
  ✓ Registered with Claude Desktop (macOS) — restart Claude Desktop to load
```

#### Non-interactive (`--non-interactive --json`)

```bash
$ cat config-payload.json
{
  "walletConnectProjectId": "abc123...",
  "rpcUrl": "https://eth-mainnet.g.alchemy.com/v2/...",
  "etherscanApiKey": "XYZ...",
  "registerWith": ["claude-code", "claude-desktop"],
  "skipLedgerPairing": true
}

$ cat config-payload.json | vaultpilot-mcp setup --non-interactive --json
{
  "envelope_version": 1,
  "status": "ok",
  "checks": [
    { "id": "config-file-write",                  "level": "ok", "message": "~/.vaultpilot-mcp/config.json written" },
    { "id": "mcp-client-register-claude-code",    "level": "ok", "message": "claude mcp add vaultpilot-mcp succeeded" },
    { "id": "mcp-client-register-claude-desktop", "level": "ok", "message": "claude_desktop_config.json merged (restart Claude Desktop to load)" }
  ],
  "metadata": { "vaultpilot_mcp_version": "1.4.0", "node_version": "v22.19.0" }
}
```

**Why non-interactive mode is load-bearing:**
- CI/CD users: provision N vaultpilot-mcp instances across N machines without keyboard input.
- Configuration management (Ansible / Puppet / Chef): drop the config payload as a managed file, run setup once.
- Recovery: if the interactive prompt path breaks for some reason (terminal not allocated, daemon context), `--non-interactive --json` is the escape hatch.

**Dry-run mode (`--dry-run`):**

```bash
$ cat config-payload.json | vaultpilot-mcp setup --non-interactive --json --dry-run
{
  "envelope_version": 1,
  "status": "ok",
  "would_write": "~/.vaultpilot-mcp/config.json (merged shape shown below)",
  "would_register_with": ["claude-code", "claude-desktop"],
  "merged_config_preview": { "rpcUrl": "***REDACTED***", "walletConnectProjectId": "***REDACTED***", "etherscanApiKey": "***REDACTED***" },
  "metadata": { ... }
}
```

Dry-run is essential for: (a) verifying the merge result before writing; (b) CI sanity-check ("does my payload validate?").

#### `writeConfigFile()` companion to Phase 5 `readConfigFile()`

```typescript
// src/config/config-file.ts — Phase 10 additive (Plan 10-03)
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Phase 10 / Plan 10-03 (DIST-42). Companion to `readConfigFile()` — writes
 * a merged config shape to disk. The MERGE happens in the caller; this
 * function does pure IO + atomic-write (write-to-tmp + rename).
 *
 * Atomic-write: avoids a partial-write race where another process
 * (e.g. the running MCP server) reads the file mid-write and sees
 * malformed JSON. Standard POSIX rename guarantee.
 */
export async function writeConfigFile(merged: ConfigFile): Promise<void> {
  const path = _paths.getConfigPath();
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  await rename(tmpPath, path);  // atomic per POSIX
}
```

**Why mode 0o600:** Config file contains RPC API keys + Etherscan API key — secrets. Restrict to owner-only read/write. Same convention as ~/.netrc, ~/.aws/credentials, ssh private keys.

**Pitfall — atomic write requires same-filesystem temp:** `rename()` across filesystems fails with EXDEV. Mitigation: place tmp in the SAME directory (`dirname(path)`); won't cross filesystem boundary on any sane setup.

**Pitfall — Zod schema mismatch between interactive + non-interactive paths:** The two paths MUST validate to the same shape, or non-interactive users get a different config than interactive users. Mitigation: single Zod schema in `src/cli/setup-schema.ts` consumed by both `setup-prompts.ts` (interactive — validates each prompt response) + `setup-non-interactive.ts` (validates the whole JSON payload at once).

#### Secret-safety in InstallEnvelope output

The InstallEnvelope JSON output MUST NOT include the actual secret values. Status messages refer to `wrote config` / `registered with X`, not `wrote ETHEREUM_RPC_URL=https://eth-...REDACTED-...`. The `--dry-run` output similarly redacts. Phase 5 Plan 05-03's `get_vaultpilot_config_status` precedent: surface booleans/counts, never secret values.

**Sources:**
- [CITED: @clack/prompts on npm v1.4.0](https://www.npmjs.com/package/@clack/prompts) — clean ESM, no native deps
- [CITED: @inquirer/prompts on npm v8.4.3](https://www.npmjs.com/package/@inquirer/prompts) — alternative considered
- [CITED: prompts on npm v2.4.2](https://www.npmjs.com/package/prompts) — alternative considered (CJS-leaning)
- Phase 5 Plan 05-01 `src/config/config-file.ts` (in-repo) — FROZEN `readConfigFile()` shape
- Phase 1 Plan 01-03 `src/diagnostics/install-envelope.ts` (in-repo) — InstallEnvelope shape precedent

### Topic 8: `request_capability` tool — pre-filled GitHub issue URL + sliding-window rate-limit (Plan 10-04)

**Recommendation:** Tool builds a GitHub pre-filled-issue URL via `URLSearchParams`. NO auto-submit. Sliding-window rate-limit (3 calls per hour, in-memory). URL-length cap at 7KB body (well under GitHub's ~8KB 414 limit); if exceeded, truncate body + write full text to a local file for manual paste.

**Tool shape** (Plan 10-04 — sketch):

```typescript
// src/tools/request_capability.ts (NEW; Plan 10-04)
import { z } from "zod";
import { registerTool } from "./index.js";
import { _rateLimit } from "../security/request-capability-rate-limit.js";
import { writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = "szhygulin/vaultpilot-mcp-gsd-inspired";
const BODY_LIMIT = 7000; // GitHub's 414 starts ~8KB; buffer for title/labels/url overhead
const LOG_DIR = join(homedir(), ".vaultpilot-mcp", "capability-requests");

const InputSchema = z.object({
  title: z.string().min(5).max(120),
  body: z.string().min(20),
});

const DESCRIPTION = [
  "Produce a pre-filled GitHub issue URL for a vaultpilot-mcp capability request. The user clicks the URL to file the issue manually — this tool NEVER auto-submits.",
  "Use when the user asks for a chain/protocol/feature that doesn't yet exist in the tool surface; the agent surfaces the URL + nudges the user to click it.",
  "Rate-limited 3 requests per hour per session. Bodies over 7KB are truncated to fit GitHub's URL length cap; full text is logged to ~/.vaultpilot-mcp/capability-requests/<timestamp>.md for manual paste.",
].join(" ");

registerTool({
  name: "request_capability",
  description: DESCRIPTION,
  inputSchema: { /* zod-to-json-schema */ },
  handler: async (args) => {
    const { title, body } = InputSchema.parse(args);

    // Rate-limit gate (Topic 8.1 below)
    const limit = _rateLimit.check();
    if (!limit.allowed) {
      return refusalResponse("RATE_LIMIT_EXCEEDED", limit.retryAfterMs, limit.remaining);
    }
    _rateLimit.record();

    // URL build (Topic 8.2 below)
    const { url, truncated, localFilePath } = await buildUrl(title, body);

    return {
      content: [{
        type: "text",
        text: [
          `Capability request URL ready (click to open):`,
          ``,
          `  ${url}`,
          ``,
          truncated
            ? `[Body truncated to 7KB. Full text saved to: ${localFilePath} — paste manually if needed.]`
            : ``,
          `Rate limit: ${limit.remaining}/3 requests remaining in the current hour window.`,
        ].filter(Boolean).join("\n"),
      }],
      structuredContent: { url, truncated, localFilePath, remaining: limit.remaining },
    };
  },
});
```

#### Topic 8.1 — Sliding-window rate-limit (3 calls per hour)

```typescript
// src/security/request-capability-rate-limit.ts (NEW; Plan 10-04)
const HOUR_MS = 60 * 60 * 1000;
const LIMIT = 3;

let timestamps: number[] = [];

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number; // 0 when allowed
}

export function check(): RateLimitResult {
  const now = Date.now();
  // Prune entries older than 1 hour:
  timestamps = timestamps.filter((t) => now - t < HOUR_MS);
  if (timestamps.length >= LIMIT) {
    const oldest = timestamps[0]!;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: HOUR_MS - (now - oldest),
    };
  }
  return { allowed: true, remaining: LIMIT - timestamps.length, retryAfterMs: 0 };
}

export function record(): void {
  timestamps.push(Date.now());
}

export const _rateLimit = { check, record };

export function _resetForTesting(): void { timestamps = []; }
```

**Why sliding-window (vs fixed-window):** A fixed-window (e.g. 0-60 min, 60-120 min) lets a user burst 3 calls at minute 59 + 3 more at minute 61 → 6 calls in 2 minutes. Sliding-window prevents this (oldest-call-falls-out-of-window only after a full 60 min has passed from THAT call's timestamp). Cost is one extra array filter on each call, trivial.

**Why in-memory + per-process (not persistent across restarts):** A user restarting their MCP session resets the counter. Documented as expected — the rate-limit is a friction-not-fortress measure to prevent agent over-issuing, not a server-imposed quota. Persistent rate-limit (write timestamps to ~/.vaultpilot-mcp/) is YAGNI for v1.4.

**Why 3/hour (not 5/hour, not 10/day):** Aligns with the heuristic that capability requests are LOW-FREQUENCY user events (a coordinated session with the user might generate 1-3 requests). Higher limits invite agent thrashing on edge cases.

#### Topic 8.2 — URL build + 7KB truncation

```typescript
async function buildUrl(title: string, body: string): Promise<{ url: string; truncated: boolean; localFilePath: string | null }> {
  let actualBody = body;
  let truncated = false;
  let localFilePath: string | null = null;

  if (body.length > BODY_LIMIT) {
    truncated = true;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    localFilePath = join(LOG_DIR, `${timestamp}.md`);
    await mkdir(LOG_DIR, { recursive: true });
    await writeFile(localFilePath, `# ${title}\n\n${body}\n`, "utf8");
    actualBody = body.slice(0, BODY_LIMIT) + `\n\n[...truncated; full text at ${localFilePath}]`;
  }

  const params = new URLSearchParams({
    title,
    body: actualBody,
    labels: "capability-request",
  });
  const url = `https://github.com/${REPO}/issues/new?${params.toString()}`;
  return { url, truncated, localFilePath };
}
```

**Why `URLSearchParams` (not manual `encodeURIComponent`):** WHATWG URL spec guarantees correct handling of multiline bodies, unicode, emoji, special chars. Hand-rolled `encodeURIComponent` chains miss edge cases (e.g. `+` encoding for spaces in query strings — `URLSearchParams` handles this correctly; manual approaches often produce `%20` literally and miss the `+` form). [CITED: developer.mozilla.org/en-US/docs/Web/API/URLSearchParams]

**Why 7KB cap (not 8KB):** GitHub's actual 414 threshold is ~8KB total URL [CITED: docs.github.com creating-an-issue]. The base URL + repo path + `title=` + `&labels=capability-request&body=` overhead is ~250-400 chars. 7KB body cap leaves ~700+ chars of headroom — robust against title-length variation + URL-encoding expansion (some chars 1:3 expand under `encodeURIComponent`).

**Why write the truncated body to a local file:** A user with a 10KB body who clicks the URL gets ONLY the truncated text in the issue. The local file path gives them a deterministic way to recover the full text. The truncation marker (`[...truncated; full text at ~/.vaultpilot-mcp/capability-requests/<timestamp>.md]`) IS the recovery instruction — visible inside the GitHub issue itself, plus surfaced in the tool's text response.

**Pitfall — emoji + multi-byte chars in title/body:** `URLSearchParams.toString()` produces percent-encoded UTF-8 per spec [VERIFIED: WHATWG URL spec]. Test against emoji-containing requests at execute time.

**Pitfall — `labels[]=` array syntax vs `labels=`:** Per [CITED: docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue], BOTH `labels=foo` and `labels=foo,bar` work; the array-syntax `labels[]=foo&labels[]=bar` ALSO works. Phase 10 uses the simple `labels=capability-request` form — one label, no ambiguity.

**Pitfall — agent must NOT auto-issue:** The DESCRIPTION line "click the URL to file the issue manually — this tool NEVER auto-submits" is load-bearing. The agent description discipline (CLAUDE.md Conventions — "Tool descriptions are agent routing prompts") names this as routing intent: agent emits URL → human clicks → issue filed. Per DIST-43 requirement explicitly.

**Sources:**
- [CITED: GitHub Docs — Creating an issue with query parameters](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue) — labels / title / body / milestone / assignee parameters
- [CITED: GitHub Community discussion — query-param-based issue prefill](https://github.com/orgs/community/discussions/47461)
- [CITED: sindresorhus/new-github-issue-url](https://github.com/sindresorhus/new-github-issue-url) — reference implementation
- [CITED: MDN URLSearchParams](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams) — WHATWG-compliant encoder

### Topic 9: InstallEnvelope JSON shape parity with Phase 1 `--check` (Plans 10-02, 10-03)

**Recommendation:** Phase 10 extends Phase 1's `InstallEnvelope` type in `src/diagnostics/install-envelope.ts` — additive `CheckId` literals (no breaking changes to the existing shape). Both `install.sh --json` and `vaultpilot-mcp setup --json` emit envelopes of the SAME `InstallEnvelope` shape. Downstream consumers (CI scripts, `jq`-style parsers) get one schema across all install-time touchpoints.

**Phase 1 existing shape (FROZEN — preserve byte-for-byte):**

```typescript
// src/diagnostics/install-envelope.ts (Phase 1; preserved)
export const ENVELOPE_VERSION = 1;
export type CheckLevel = "ok" | "warn" | "error";
export type CheckId =
  | "node-version"
  | "binary-spawn"
  | "wallet-connect-key"
  | "ethereum-rpc"
  | "config-file";
export interface CheckResult { id: CheckId; level: CheckLevel; message: string; }
export interface InstallEnvelope {
  envelope_version: typeof ENVELOPE_VERSION;
  status: CheckLevel;
  checks: CheckResult[];
  metadata: { vaultpilot_mcp_version: string; node_version: string; };
}
```

**Phase 10 additive extensions** (Plan 10-02 + 10-03):

```typescript
// src/diagnostics/install-envelope.ts — Phase 10 additive
export type CheckId =
  | "node-version"
  | "binary-spawn"
  | "wallet-connect-key"
  | "ethereum-rpc"
  | "config-file"
  // ── Phase 10 / Plan 10-02 (install.sh + install.ps1) ──
  | "binary-download"            // SHA-256 check on download
  | "binary-install"             // chmod + move to install dir
  | "path-presence"              // is install dir on $PATH?
  | "quarantine-attr"            // macOS only — was xattr stripped?
  // ── Phase 10 / Plan 10-03 (setup wizard + MCP client register) ──
  | "config-file-write"          // wrote ~/.vaultpilot-mcp/config.json
  | "mcp-client-register-claude-code"      // claude mcp add succeeded
  | "mcp-client-register-claude-desktop"   // JSON merge succeeded
  | "mcp-client-register-cursor"           // JSON merge succeeded
  | "ledger-pairing"             // optional pair_ledger_live during wizard
;
```

**Why additive (not new envelope-version):** Existing Phase 1 `--check` consumers (CI parsers, `jq` pipelines) MUST keep working byte-for-byte. Adding new `CheckId` literals is backward-compatible — they won't see them unless they're running the new install.sh / setup commands. Bumping `ENVELOPE_VERSION` to 2 would force migration; not justified by purely-additive surface.

**Sample InstallEnvelope from `install.sh --json`:**

```json
{
  "envelope_version": 1,
  "status": "ok",
  "checks": [
    { "id": "binary-download",                       "level": "ok",   "message": "SHA-256 verified against vaultpilot-mcp-v1.4.0-macos-arm64.tar.gz.sha256" },
    { "id": "binary-install",                        "level": "ok",   "message": "Installed to ~/.local/bin/vaultpilot-mcp" },
    { "id": "path-presence",                         "level": "warn", "message": "~/.local/bin not on PATH — add to your shell rc" },
    { "id": "quarantine-attr",                       "level": "warn", "message": "macOS quarantine xattr NOT stripped; first run will trigger Gatekeeper dialog. Run 'xattr -d com.apple.quarantine ~/.local/bin/vaultpilot-mcp' to skip." },
    { "id": "mcp-client-register-claude-code",       "level": "ok",   "message": "claude mcp add vaultpilot-mcp succeeded" },
    { "id": "mcp-client-register-claude-desktop",    "level": "ok",   "message": "claude_desktop_config.json merged — restart Claude Desktop to load" },
    { "id": "mcp-client-register-cursor",            "level": "ok",   "message": "Cursor mcp.json merged (no restart needed)" }
  ],
  "metadata": { "vaultpilot_mcp_version": "1.4.0", "node_version": "v22.19.0" }
}
```

**Sample from `vaultpilot-mcp setup --non-interactive --json`:**

```json
{
  "envelope_version": 1,
  "status": "ok",
  "checks": [
    { "id": "config-file-write",                  "level": "ok", "message": "~/.vaultpilot-mcp/config.json written (3 keys merged, 1 key preserved)" },
    { "id": "mcp-client-register-claude-code",    "level": "ok", "message": "claude mcp add vaultpilot-mcp succeeded" }
  ],
  "metadata": { "vaultpilot_mcp_version": "1.4.0", "node_version": "v22.19.0" }
}
```

**Why one envelope per top-level invocation (vs one envelope per step):** Consumers parse a single JSON object, not a stream. Failure conditions surface as `status: "error"` + the offending check at `level: "error"`. This shape matches Phase 1 exactly.

**Pitfall — install.sh writes JSON in a shell script:** Shell `printf`/`echo` JSON construction is error-prone. Mitigation: install.sh accumulates check results in plain-text variables (`CHECK_RESULTS=...`), THEN at the end emits the JSON by calling `vaultpilot-mcp setup --emit-install-envelope --status=ok --check 'binary-download,ok,SHA-256 verified' --check '...'` — i.e. the BINARY itself constructs the JSON (now that it's installed). Fall-back path for cases where the binary install failed: install.sh emits a minimal raw-JSON status (`{"envelope_version":1,"status":"error","checks":[{"id":"binary-install","level":"error","message":"..."}]}`) using `printf "%s"` against pre-constructed strings.

**Sources:**
- Phase 1 Plan 01-03 `src/diagnostics/install-envelope.ts` + `src/diagnostics/check.ts` (in-repo) — FROZEN existing shape
- Phase 1 INST-04 (in-repo) — Windows `cmd /c` wrapper precedent for `--check --json` consumption

### Topic 10: FROZEN-area zero-diff verification — Phase 10 is mostly NEW surface (cross-cutting all Plans)

**Recommendation:** Phase 10 ships almost entirely NEW files. The only FROZEN-area touch-risk is the setup wizard's config.json writer; that risk is mitigated by EXTENDING Plan 05-01's `src/config/config-file.ts` with an ADDITIVE `writeConfigFile()` companion (no modification of existing `readConfigFile()` / `_paths` / `ConfigFile` / `ConfigFileResult`).

**FROZEN files (assert zero diff in every Phase 10 plan's `<success_criteria>`):**

| File | FROZEN since | Why |
|------|-------------|-----|
| `src/signing/payload-fingerprint.ts` | Phase 4 | Preimage shape invariant; cryptographic-binding anchor |
| `src/signing/presign-hash.ts` | Phase 4 | EIP-1559 RLP shape; cryptographic-binding anchor |
| `src/signing/handle-store.ts` | Phase 4 | State machine + 15-min TTL |
| `src/tools/send_transaction.ts` | Phase 4 | Three-gate logic (PREP-07 schema, PREP-08 fingerprint, userDecision) |
| `src/tools/prepare_*.ts` (8 tools) | Phase 4/6/7 | Preimage assembly |
| `src/tools/preview_send.ts` | Phase 9 | Phase 9's Layer 0/0.5 gates layered atop unchanged preview flow |
| `src/security/canonical-dispatch.ts` | Phase 9 | Per-chain allowlist + refusal logic |
| `src/security/skill-integrity.ts` | Phase 9 | SHA-256 pin probe + NOTICE state |
| `src/clients/etherscan.ts` | Phase 7 | 5-arm discriminated union |
| `src/clients/fourbyte.ts` | Phase 4 | 4byte selector cross-check |
| `src/protocols/{erc20,aave-v3,weth9}.ts` | Phase 6/7 | Decoder shapes consumed by verify_tx_decode |
| `src/signing/aave-health.ts` | Phase 7 | HF math |
| `src/signing/amount.ts` | Phase 6 | `parseAmountStrict` decimal guard |
| `src/signing/simulation.ts` | Phase 6 | wide `eth_call` helper |
| `src/wallet/session-manager.ts` | Phase 8 | Multi-chain WC namespace; sessionTopicLast8 |
| `src/chains/registry.ts` | Phase 8 | Per-chain RPC factory |
| `src/config/contracts.ts` | Phase 8 | Per-chain ContractsForChain SOT |
| `src/tools/verify_tx_decode.ts` | Phase 9 | Server-side decode cross-check |
| `src/tools/get_verification_artifact.ts` | Phase 9 | Sparse JSON + pasteableBlock |
| `src/tools/get_tx_verification.ts` | Phase 9 (v1.3 spec) | Re-emit with txJson + sessionTopicLast8 + dispatchCheckResult |

**Phase 10 NEW files (cross-cutting / per-plan):**

| File | Plan | Purpose |
|------|------|---------|
| `install.sh` | 10-02 | POSIX bash installer (curl-pipe entry) |
| `install.ps1` | 10-02 | PowerShell installer (Windows curl-pipe analog) |
| `.github/workflows/release.yml` | 10-01 | GitHub Actions matrix-build + release-asset upload |
| `src/cli/setup.ts` | 10-03 | `vaultpilot-mcp setup` CLI subcommand entry point |
| `src/cli/setup-prompts.ts` | 10-03 | Interactive prompts via `@clack/prompts` |
| `src/cli/setup-non-interactive.ts` | 10-03 | `--non-interactive --json` stdin reader + writer |
| `src/cli/setup-mcp-clients.ts` | 10-02 + 10-03 | MCP client detection + registration helpers |
| `src/cli/setup-schema.ts` | 10-03 | Zod schema (single SOT for interactive + non-interactive) |
| `src/tools/request_capability.ts` | 10-04 | `request_capability` registered tool |
| `src/security/request-capability-rate-limit.ts` | 10-04 | Sliding-window 3-per-hour rate-limit + state |
| `test/cli-setup-interactive.test.ts` | 10-03 | Interactive-prompt flow (mocked `@clack/prompts`) |
| `test/cli-setup-non-interactive.test.ts` | 10-03 | JSON stdin reader + writer + dry-run + secret-safety |
| `test/cli-setup-mcp-clients.test.ts` | 10-02/10-03 | Client-detection + JSON merge + atomic-write |
| `test/request-capability.test.ts` | 10-04 | URL builder + truncation + rate-limit + local-file write |
| `test/request-capability-rate-limit.test.ts` | 10-04 | Sliding-window mechanics + reset hook |
| `test/install-sh.test.ts` (smoke) | 10-02 | `bash install.sh --dry-run` smoke against a mocked GitHub release endpoint |
| `test/install-envelope-shape.test.ts` (extend) | 10-02 + 10-03 | InstallEnvelope additive CheckId coverage |

**Phase 10 MODIFY (additive only):**

| File | Plan | Modification |
|------|------|---|
| `src/index.ts` | 10-03 | NEW `setup` subcommand routing in the existing arg parser; `--check` path unchanged |
| `src/diagnostics/install-envelope.ts` | 10-02 + 10-03 | Additive `CheckId` literals (Topic 9); existing shape byte-frozen |
| `src/tools/register-all.ts` | 10-04 | +1 import line for `request_capability.js`; carved at the end to avoid Phase 9 conflict |
| `src/signing/error-codes.ts` | 10-04 | Additive `RATE_LIMIT_EXCEEDED` (code 20); previous 19 codes byte-frozen |
| `src/config/config-file.ts` | 10-03 | Additive `writeConfigFile()` companion to existing `readConfigFile()`; existing exports unchanged |
| `package.json` | 10-01 | Additive `pkg` config section + `build:binary:*` scripts + `@yao-pkg/pkg` devDep + `@clack/prompts` dep + `zod` dep (already present? — VERIFY at execute time) |
| `README.md` | 10-02 + 10-03 | Install instructions + setup wizard usage |
| `SECURITY.md` | 10-01 + 10-02 | Add v1.4 residual-risk row: unsigned macOS binaries + Windows SmartScreen friction + per-process rate-limit (resets on restart) |

**Test surface additions** (Wave 0 gaps — Plan 10-01 covers GitHub Actions workflow integration; Plans 10-02..04 cover unit + integration tests):

- `test/cli-setup-non-interactive.test.ts` — JSON stdin reader + schema validation + atomic write (covers config-file-write check)
- `test/cli-setup-interactive.test.ts` — Each step's prompt-flow with mocked `@clack/prompts` (DF-2-locked library)
- `test/cli-setup-mcp-clients.test.ts` — Per-client detection + JSON merge semantics + idempotent re-register
- `test/request-capability.test.ts` — URL builder + truncation logic + local-file write + `URLSearchParams` round-trip
- `test/request-capability-rate-limit.test.ts` — Sliding-window mechanics (3 calls in 60 min = block; 60-min-old call falls out)
- `test/install-envelope-shape.test.ts` (extend) — additive CheckId literal coverage
- `test/install-sh.smoke.test.ts` (manual + integration) — `bash install.sh --dry-run` shell-out smoke; deferred to verify-phase if shell-out from vitest is fragile

**Pitfall — Phase 9 register-all carve coordination:** Plan 09-05's PATTERNS prescribed register-all carve to avoid conflict; Plan 10-04 inherits the same pattern — append the `request_capability.js` import at the END of the existing import block, NOT inserted in the middle. The order of imports doesn't matter functionally (each module's `registerTool()` runs as a side effect), but git auto-merge cleanliness depends on append-only.

**Pitfall — `tsc` build vs `pkg` build divergence:** The `dist/` output produced by `tsc` is what `pkg` consumes. The build pipeline order MUST be: `npm run build` (tsc) → `npm run build:binary` (pkg over dist). If a test relies on dynamic import that pkg can't see (e.g. `await import(\`./protocols/\${name}.js\`)` with a runtime-computed name), pkg will fail to bundle. Mitigation: Phase 10 doesn't introduce any new dynamic-import patterns; the existing imports are all static. Verify at execute time via the smoke-test binary.

**Pitfall — `package.json` reads in pkg bundle:** `src/server.ts:69` reads `package.json` via `await import("../package.json", { with: { type: "json" } })`. Per pkg's documentation, `package.json` must be listed in `pkg.assets`. The Topic 1 sketch includes it. Verify at execute time.

**Sources:**
- All Phase 4-9 RESEARCH § Topic 9-10 FROZEN-area inheritance
- `src/index.ts`, `src/server.ts`, `src/diagnostics/install-envelope.ts` (in-repo) — Phase 10 modification surface

## SDK Probe Verdicts

| Package | Installed Version | Call Surface Used | Verdict |
|---------|-------------------|-------------------|---------|
| `@yao-pkg/pkg` | 6.19.0 (probed at `/tmp/pkg-probe/`) | CLI invocation via `pkg --target node22-{platform}-{arch} --out-path dist-binaries` from package.json scripts | **Adopt** — empirically verified ESM + cross-compile + 19 transitive deps; no native bindings required. DF-1 locked. |
| `@clack/prompts` | 1.4.0 (latest stable per `npm view`) | Interactive prompt UI for `vaultpilot-mcp setup`: `text()`, `select()`, `confirm()`, `multiselect()`, `intro()`, `outro()` | **Adopt** — ESM-first, clean API, 0 native deps. DF-2 locked. |
| `zod` | Already present? VERIFY at execute time (likely from Phase 4 PREP-07 ajv pairing) | Schema validation for `request_capability` inputs + setup-wizard payload | **Adopt** if present; otherwise add as new dep. Same library Phase 4-9 used. |
| Node `crypto` (built-in) | Node ≥ 18.17 | SHA-256 verification of downloaded binary against `.sha256` file in install.sh / install.ps1 | **Adopt** — built-in. install.sh uses `shasum -a 256 -c`; install.ps1 uses `Get-FileHash`. |
| Node `fs/promises` (built-in) | Node ≥ 18.17 | `writeConfigFile()` atomic write + `request_capability` local-file fallback for truncated bodies | **Adopt** — built-in. |
| Node `URL` / `URLSearchParams` (built-in) | Node ≥ 18.17 | `request_capability` URL builder (WHATWG-compliant encoder) | **Adopt** — built-in. |
| Node `os.platform()` / `os.homedir()` (built-in) | Node ≥ 18.17 | MCP client config-path resolution (`~/Library/Application Support/Claude/...` vs `~/.config/Claude/...` vs `%APPDATA%\Claude\...`) | **Adopt** — built-in. |
| `softprops/action-gh-release@v2` | v2 (latest per GitHub Marketplace) | GitHub Actions release-asset upload (release.yml) | **Adopt** — canonical action; widely-used; well-maintained. |
| Bun (`oven-sh/bun`) | 1.3.14 | NOT USED | **Skip** — DF-1 picks pkg over Bun due to Node-runtime fidelity for the FROZEN cryptographic-binding chain. |
| Node SEA (`node --build-sea`) | Node 25.5+ | NOT USED standalone | **Skip standalone** — pkg's `sea: true` flag can backend to SEA in a future release; v1.4 ships pkg default backend. |
| `pkg@5.8.1` (vercel — archived) | NOT USED | NOT USED | **Skip** — archived; doesn't support Node 22; `@yao-pkg/pkg` is the maintained fork. |
| `nexe` | NOT INVESTIGATED in depth | NOT USED | **Skip** — less active than pkg/Bun/SEA; no compelling differentiator. |
| `prompts@2.4.2` | NOT USED | NOT USED | **Skip** — DF-2 picks `@clack/prompts` for ESM-first + cleaner API. |
| `@inquirer/prompts@8.4.3` | NOT USED | NOT USED | **Skip** — modular but larger dep tree than `@clack/prompts`; not justified for 4-5 prompts. |
| `simple-git` / any git library | NOT USED | NOT USED | **Skip** — install.sh shells out to `curl`; no git operations from MCP server. |

## Assumptions Log

| ID | Claim | Section | Risk if Wrong |
|----|-------|---------|---------------|
| **A1** | `@yao-pkg/pkg@6.19.0` cross-compiles to all 4 targets (linux-x64, macos-x64, macos-arm64, windows-x64) from a single Linux GitHub Actions runner WITHOUT requiring per-target host emulation. | Topic 1, 4 | Wrong → release workflow needs per-target matrix runners (4 × ~5 min = 20 min vs 1 × ~10 min, 2× cost). Recovery: split into per-target matrix (still works, just slower). [VERIFIED — pkg-fetch's per-target Node binary cache; documented in yao-pkg/pkg-fetch repo.] |
| **A2** | pkg's ESM support handles the project's `"type": "module"` + `.js` import extensions + dynamic `import("../package.json", { with: { type: "json" } })` pattern cleanly. | Topic 1 | Wrong → server.ts:69 fails at binary runtime with "Cannot find module ../package.json". Recovery: rewrite as `readFileSync` + JSON.parse fallback (one-line change); or list package.json in `pkg.assets` (sketch already does). [ASSUMED — verify at execute time via smoke-test binary; pkg v6.19.0 docs claim ESM support but project-specific edge-cases need empirical check.] |
| **A3** | macOS Gatekeeper friction for unsigned binaries is an acceptable v1.4 residual (users will accept the one-time `xattr -d` step OR right-click→Open dialog) and signing+notarization can defer to v1.5+. | Topic 3 | Wrong → install.sh experience is too friction-laden, users churn. Recovery: v1.4.1 ships Apple Developer cert + notarytool integration. [ASSUMED — based on bun/deno/uv shipping unsigned with documented workaround in 2026; SECURITY.md documents residual.] |
| **A4** | The `vaultpilot-mcp setup` interactive wizard's Ledger pairing step can delegate to existing `pair_ledger_live_start` + `_wait` tools without re-implementing pairing logic. | Topic 7 | Wrong → wizard duplicates pairing code → drift risk between wizard path + tool path. Recovery: refactor to a shared `src/wallet/pair-ledger.ts` helper. [ASSUMED — existing tool surface is the right abstraction boundary; pairing logic is already extracted in Plan 03-02 PR #9. Verify by reading tool source at execute time.] |
| **A5** | Per-process in-memory rate-limit for `request_capability` (3/hour resets on server restart) is acceptable as documented behavior — NOT a security-critical persistence requirement. | Topic 8 | Wrong → user can defeat the rate-limit by killing+restarting the MCP server → effective rate is unbounded. Recovery: persist timestamps to ~/.vaultpilot-mcp/request-capability-history.json with file-locking. [ASSUMED — the rate-limit is friction-not-fortress; bypass cost (restart server, lose all session state including paired Ledger) is high enough to deter casual abuse. v1.5 may persist if data shows misuse.] |
| **A6** | GitHub's pre-filled-issue URL 414 threshold is approximately 8KB; truncating body at 7KB leaves enough headroom for title + labels + URL-encoding expansion. | Topic 8 | Wrong → URLs at 7KB still 414. Recovery: lower BODY_LIMIT to 5KB. [ASSUMED — based on community reports of 414 at ~8-9KB; verify with empirical test against a real long body during execute-time integration test.] |
| **A7** | `URLSearchParams.toString()` produces server-accepted URL encoding for all GitHub query parameters (title, body, labels) including multiline bodies, emoji, unicode. | Topic 8 | Wrong → some edge case (e.g. `&` in body) breaks the URL parse on GitHub side. Recovery: switch to manual `encodeURIComponent` with explicit `+` → `%20` substitution. [VERIFIED via WHATWG URL spec — `URLSearchParams` is spec-compliant for all chars including `&`, `=`, `+`. Empirically test at execute time.] |
| **A8** | `@clack/prompts@1.4.0` has stable enough API that the wizard implementation is durable across at least the v1.4 → v2.0 timeframe (12-18 months). | Topic 7 | Wrong → next major version breaks the wizard at npm install time. Recovery: pin to `^1.4.0` or `~1.4.0` (locked-minor); migrate at v2.x if needed. [ASSUMED — based on @clack/prompts' track record; v1.4 is the stable release line. Pin with caret in package.json.] |
| **A9** | Each MCP client's config-file path stays stable across the v1.4 lifetime (12-18 months). Specifically: Claude Desktop's `~/Library/Application Support/Claude/claude_desktop_config.json` doesn't relocate; Cursor's `~/.cursor/mcp.json` doesn't relocate. | Topic 6 | Wrong → install.sh registration silently fails (writes a file at wrong path; client ignores it). Recovery: add path detection fallbacks (probe multiple known paths). [ASSUMED — paths verified against 2026-05 docs but vendors do relocate config files occasionally; verify-phase task to re-check before each release.] |
| **A10** | `claude mcp add vaultpilot-mcp -- <bin-path>` is idempotent — running it twice doesn't create duplicate entries. | Topic 6 | Wrong → multiple `vaultpilot-mcp` entries clutter `claude mcp list`. Recovery: install.sh runs `claude mcp remove vaultpilot-mcp` first (ignore failures), then `claude mcp add`. [VERIFIED per docs.claude.com — `claude mcp add` updates if name exists.] |
| **A11** | The 4 target binary names (`linux-x64`, `macos-x64`, `macos-arm64`, `windows-x64`) survive across all GitHub Releases — install.sh constructs URLs from these tokens deterministically. | Topic 2, 5 | Wrong → install.sh 404s. Recovery: name the release tokens in a constant + smoke-test in CI. [LOCKED via ROADMAP success-criterion #1 + the release.yml naming convention; cross-checked at release time.] |
| **A12** | macOS Apple Silicon users running their shell through Rosetta (uname -m returns `x86_64` falsely) install the x64 binary, which runs via Rosetta with degraded perf but is FUNCTIONALLY CORRECT (no behavioral divergence in the trust pipeline). | Topic 5 | Wrong → x64-via-Rosetta exposes some bug not exercised in native testing. Recovery: install.sh detects Rosetta via `sysctl -nq hw.optional.arm64` + offers arm64 binary. [ASSUMED — the trust pipeline is pure JS via viem/WC v2/MCP SDK; Rosetta correctness depends only on Node's Rosetta correctness, which Apple maintains.] |

## Design Forks (DF-N) — resolved at planning gate

Following Phase 6/7/8/9 pattern — researcher reasonable-call locks placement; surface to user ONLY genuine contradiction-of-prior-design forks. Phase 10 surfaces **two real forks** worth naming + locking explicitly.

### DF-1: Binary build tool — `@yao-pkg/pkg` vs Bun `--compile` vs Node SEA `--build-sea`?

**Options:**
- **Option A** *(recommended)*: `@yao-pkg/pkg@6.19.0` — maintained fork of vercel/pkg; cross-compile all 4 targets from one Linux runner; ESM-supported; ships pure Node 22 binary.
- **Option B**: Bun `bun build --compile` — fastest cold-start (~30-80ms); single-step build; cross-compile via `--target=bun-{platform}-{arch}`. Ships Bun runtime, NOT Node.
- **Option C**: Node SEA standalone (`node --build-sea` in Node 25.5+) — official Node feature; same-runtime; per-host build only (no cross-compile from a single runner).
- **Option D**: nexe (less active alternative to pkg).

**Recommended default: Option A.**

**Why:**
- **Option A preserves Node-runtime fidelity for the FROZEN cryptographic-binding chain.** Phases 1-9 shipped against Node ≥ 18.17; the trust pipeline's behavior is anchored on Node's exact `crypto.createHash`, `fs/promises.readFile`, `Buffer.from(hex)` semantics. Shipping a Bun binary changes substrate — Bun re-implements these with very-close-but-not-byte-identical semantics. The substrate-shift risk isn't worth Bun's ~70-90ms cold-start advantage for a sign-anything-on-Ledger tool whose value proposition is byte-bound trust.
- **Option A cross-compiles from a single runner.** Critical for the GitHub Actions release workflow — produces all 4 platform binaries (linux-x64, macos-x64, macos-arm64, windows-x64) from one Linux runner via `pkg --target node22-{...}`. Node SEA can't do this; it produces a binary for the host. Bun can, but with the substrate-shift problem above.
- **Option A's fork story is healthy.** `@yao-pkg/pkg@6.19.0` (last published 2026-05-01 per `npm view`) is the actively-maintained fork of archived `vercel/pkg`. The fork ships Node 22 support via `pkg-fetch@3.5.33`. Adopting `@yao-pkg/pkg` rather than legacy `pkg@5.8.1` is locked.
- **Option A has no native-module deal-breakers.** Empirical probe (`find node_modules -name "*.node" -o -name "binding.gyp"` returned 0) confirms vaultpilot's deps are pure JS. Bun's native-module-compat gap doesn't apply, but neither does it for pkg.
- **Option B is the right pick IF cold-start dominates UX.** But the trust pipeline isn't latency-critical — the user reads a `LEDGER BLIND-SIGN HASH` block and crosses checks against the device screen. Saving 70-90ms cold-start is measurable but not load-bearing.
- **Option C is the right pick IF Node officially supports cross-compile by v1.5+.** Joyee Cheung's 2026-01-26 blog post [CITED: joyeecheung.github.io] hints at this direction. Option A can adopt SEA backend later via `pkg.sea = true`; not blocking the upgrade path.
- **Option D (nexe) is less active + offers nothing pkg doesn't.**

**Cost difference:**
- Option A: 1 new devDep (`@yao-pkg/pkg@^6.19.0`) + 19 transitive deps; ~12 MB devDep install; ~10 min build per release.
- Option B: requires Bun installed in CI (~80 MB), changes Node substrate.
- Option C: zero new deps but requires per-target matrix runners (4× CI cost) until cross-compile lands in Node core.
- Option D: same shape as A, less active maintenance.

**Tradeoffs:**
- Option A leaves us tied to a third-party fork. If `@yao-pkg/pkg` goes unmaintained, we'd migrate to SEA. Recovery is straightforward — same build pipeline, different invocation.
- The pkg fork's choice of bundling vs SEA-backend is configurable per build via the `sea: true` flag; we can switch at any point without re-architecting.

### DF-2: Prompt library for `vaultpilot-mcp setup` interactive mode — `@clack/prompts` vs `prompts@2.4.2` vs `@inquirer/prompts`?

**Options:**
- **Option A** *(recommended)*: `@clack/prompts@1.4.0` — modern ESM-first, clean API, 0 native deps, native `--non-interactive` story via process-piping.
- **Option B**: `prompts@2.4.2` — battle-tested, 100M+ weekly downloads, CJS-leaning (works with ESM via interop), tiny dep tree.
- **Option C**: `@inquirer/prompts@8.4.3` — modern modular successor to inquirer; per-prompt-type sub-packages; larger transitive tree.
- **Option D**: Native Node `readline` — 0 deps, but verbose for multi-step interactive flows.

**Recommended default: Option A.**

**Why:**
- **Option A's ESM-first design matches the project's posture.** Phases 1-9 are pure ESM (`"type": "module"` in package.json, `.js` extension on every TS import). `@clack/prompts` ships ESM-native; no interop shims.
- **Option A has the cleanest API for multi-step wizards.** `intro()` / `text()` / `select()` / `multiselect()` / `confirm()` / `outro()` map directly to the 6-step wizard flow in Topic 7. The composability is sharper than inquirer's question-array pattern.
- **Option A's 0 native deps reduces install-time surface.** Especially important when the binary build pipeline (DF-1) needs to bundle the prompt library — no compile-from-source friction.
- **Option A's non-interactive story is clean.** When stdin isn't a TTY (e.g. piped JSON via `--non-interactive`), `@clack/prompts` operations fail predictably; the wizard's non-interactive code path doesn't import `@clack/prompts` at all.
- **Option B is mature but CJS-leaning.** ESM interop works, but the import shape is slightly less clean.
- **Option C is over-engineered for 5-6 prompts.** Modular per-prompt-type imports give bundle-size wins for apps with 10+ prompt types; not justified for the setup wizard.
- **Option D is verbose enough to mask intent.** Each prompt becomes a ~10-line readline+stdout/stderr ritual; the wizard would balloon.

**Cost difference:**
- Option A: 1 new dep (`@clack/prompts@^1.4.0`) + small transitive tree; ~50KB install.
- Option B: 1 new dep (`prompts@^2.4.2`); ~40KB; CJS interop adds tiny mental tax.
- Option C: 1 meta-dep (`@inquirer/prompts@^8.4.3`); ~200KB transitive; over-engineered.
- Option D: 0 deps; ~150-200 lines of readline glue code.

**Tradeoffs:**
- Option A is younger than Option B (v1.4 vs v2.4.2); minor risk of API churn in 2027+ majors. Pin with caret (`^1.4.0`) locks the major.
- The wizard's prompt set is small (~5-6 prompts); switching libraries later is a ~half-day refactor if needed.

**No further forks.** All other placement choices have defensible reasonable-call defaults documented inline (e.g. POSIX bash for install.sh, not zsh / fish; `URLSearchParams` for URL build, not manual encoding; `~/.local/bin` as install dir, not `/usr/local/bin` — POSIX default vs sudo-required). Plan-checker may surface a third fork during their pass (especially around `--auto-register-all` vs per-client prompt default behavior in install.sh CI mode); surface via AskUserQuestion at planning gate if needed.

## Project Constraints (from CLAUDE.md)

These directives carry through to every Phase 10 plan:

- **`src/config/contracts.ts`** is the SOT — Phase 10 doesn't widen it (no new chains, no new protocols). FROZEN.
- **Tool descriptions are agent routing prompts** — `request_capability` description names "produce a pre-filled GitHub issue URL — user clicks manually, this tool NEVER auto-submits" + rate-limit disclosure. Sharp wording per CLAUDE.md "Documentation Style".
- **`prepare_*` always returns a handle** — Phase 10 doesn't touch prepare tools.
- **`payloadFingerprint`** computed at prepare time, re-checked at send time — Phase 10 doesn't touch cryptographic-binding code. FROZEN.
- **`previewToken` + `userDecision: "send"`** required on every `send_transaction` — FROZEN.
- **No private key material crosses any boundary** — Phase 10 doesn't touch key handling. The setup wizard writes RPC keys + Etherscan keys (API keys, not private keys) to `~/.vaultpilot-mcp/config.json` with mode 0o600. Phase 10 doesn't introduce any private-key surface.
- **Stderr for diagnostics, stdout for MCP protocol** — install.sh + install.ps1 emit human output to stdout (user is the consumer); when `--json` mode is set, JSON envelope on stdout, human progress on stderr. Setup wizard interactive mode prints to stderr (TTY); non-interactive `--json` mode emits envelope to stdout. Phase 1 INST-04 precedent.
- **Decimal-aware arithmetic** — Phase 10 doesn't touch amount handling.
- **ESM spy-affordance indirection** — `src/security/request-capability-rate-limit.ts` exports `_rateLimit = { check, record }`; tests `vi.spyOn` these indirections. Mirror of `_skillIntegrity` / `_canonicalDispatch` patterns from Phase 9.
- **Cryptographic-binding fixtures pinned as hardcoded literals** — Phase 10 adds NO new fixture (cryptographic-binding chain FROZEN).
- **License BUSL-1.1** — Phase 10 release artifacts MUST include LICENSE in each tar.gz/zip + the install.sh references the license URL.
- **Node ≥ 18.17** — install.sh + install.ps1 do NOT require Node on the user's host (the binary is self-contained). However the `npm install -g vaultpilot-mcp` fallback path for linux-arm64 + Windows-arm64 + unsupported arches DOES require Node — install.sh checks for `node` / `npm` and emits the Node-version-check message accordingly.

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIST-40 | Bundled binary distribution per platform; linux-arm64 falls back to `use npm` | integration (GitHub Actions release.yml + asset upload smoke) | Manual: `git tag v1.4.0-rc1 && git push --tags`; GitHub Action runs; assets appear in Release | ❌ Wave 0 — release.yml NEW |
| DIST-41 | `install.sh` + `install.ps1` download, register with MCP clients, emit InstallEnvelope | smoke (install.sh dry-run against mocked release endpoint); unit (MCP client detection + JSON merge) | `npx vitest run test/cli-setup-mcp-clients.test.ts test/install-envelope-shape.test.ts`; manual: `bash install.sh --dry-run` | ❌ Wave 0 — NEW |
| DIST-42 | `vaultpilot-mcp setup` wizard validates RPC keys, optionally pairs Ledger, writes config.json | unit + integration | `npx vitest run test/cli-setup-interactive.test.ts test/cli-setup-non-interactive.test.ts test/cli-setup-mcp-clients.test.ts` | ❌ Wave 0 — NEW |
| DIST-43 | `request_capability({ title, body })` produces pre-filled GitHub URL; rate-limited 3/hour | unit | `npx vitest run test/request-capability.test.ts test/request-capability-rate-limit.test.ts` | ❌ Wave 0 — NEW |

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (verified via package.json `"test": "vitest run"`) |
| Config file | `vitest.config.ts` at repo root |
| Quick run command | `npx vitest run --bail` |
| Full suite command | `npx vitest run` |

### Sampling Rate
- **Per task commit:** `npx vitest run path/to/affected/test.test.ts`
- **Per wave merge:** `npx vitest run` (full suite — Phase 9 baseline ~890 tests)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/cli-setup-interactive.test.ts` — Each step's prompt-flow with mocked `@clack/prompts` (Plan 10-03)
- [ ] `test/cli-setup-non-interactive.test.ts` — JSON stdin reader + schema validation + atomic write + secret-safety (Plan 10-03)
- [ ] `test/cli-setup-mcp-clients.test.ts` — Per-client detection + JSON merge semantics + idempotent re-register (Plan 10-02 + 10-03)
- [ ] `test/cli-setup-schema.test.ts` — Zod schema coverage (interactive + non-interactive paths share this) (Plan 10-03)
- [ ] `test/request-capability.test.ts` — URL builder + truncation + local-file write + URLSearchParams round-trip (Plan 10-04)
- [ ] `test/request-capability-rate-limit.test.ts` — Sliding-window mechanics; 3-calls-in-60-min block; 60-min-old-call falls out; reset hook (Plan 10-04)
- [ ] `test/install-envelope-shape.test.ts` (extend) — additive CheckId literal coverage; status escalation across mixed-level results (Plan 10-02 + 10-03)
- [ ] `test/install-sh.smoke.test.ts` (manual + optional vitest integration) — `bash install.sh --dry-run` shell-out smoke against a mocked GitHub release endpoint; deferred to verify-phase if shell-out from vitest is fragile (Plan 10-02)
- [ ] Sister-repo CI test smoke (out of MCP test scope) — release.yml workflow tag-push trigger + artifact-presence assertion (Plan 10-01)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface — MCP stdio transport remains in v1.4. (v3.0 hosted MCP adds OAuth.) |
| V3 Session Management | no | install.sh + setup wizard are one-shot; rate-limit (Topic 8) is per-MCP-session not per-user. |
| V4 Access Control | yes | Schema-level enum + `userDecision`/`previewToken` gates (Phase 4 inherited); `request_capability` rate-limit + URL-length cap (Topic 8) |
| V5 Input Validation | yes | Zod schema on `vaultpilot-mcp setup --non-interactive` payload; URLSearchParams for safe URL construction (Topic 8); install.sh `set -euo pipefail` discipline (Topic 5) |
| V6 Cryptography | yes | SHA-256 verification of downloaded binary in install.sh + install.ps1 (Topic 5); FROZEN cryptographic-binding chain unchanged |
| V8 Data Protection | yes | `writeConfigFile()` uses mode 0o600 — secrets (RPC keys, Etherscan key) restricted to owner; secret-safety in InstallEnvelope output (Topic 7) |
| V11 Business Logic | yes | Rate-limit on `request_capability` (Topic 8); MCP client registration is opt-in per client (Topic 6) |
| V12 Files and Resources | yes | install.sh + install.ps1 install to non-privileged dirs (~/.local/bin, %LOCALAPPDATA%) — no sudo/admin required |

### Known Threat Patterns for Phase 10 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tampered binary distribution (attacker substitutes a malicious binary at the GitHub release URL) | Tampering | SHA-256 verification against per-asset `.sha256` file (Topic 5); install.sh refuses on mismatch. Defense-in-depth: HTTPS-only download via `curl -fsSL` |
| MITM on curl-pipe download (attacker intercepts HTTPS) | Tampering | HTTPS-only (curl -fsSL fails on cert errors); TLS-cert validation by curl by default. Residual: if attacker has a valid cert for github.com (CA compromise), defense fails — same as every curl-pipe installer, accepted residual |
| Partial-download execution (script cut off mid-stream, partial commands execute) | Tampering / DoS | install.sh wraps entire body in `main() { … }; main "$@"` — partial download → bash syntax error → no execution (Topic 5) [CITED: arp242.net/curl-to-sh.html] |
| Unsigned macOS binary triggers Gatekeeper friction | Information Disclosure (user lost in dialog) | install.sh prints workaround + offers `xattr -d com.apple.quarantine` strip (Topic 3); documented residual in SECURITY.md until v1.5+ signing lands |
| Unsigned Windows binary triggers SmartScreen friction | Information Disclosure | install.ps1 prints workaround (right-click Properties → Unblock); documented residual |
| MCP client config file overwrite loses user customizations | Repudiation (lost data) | JSON read-merge-write preserves all non-`mcpServers["vaultpilot-mcp"]` keys (Topic 6); refusal on malformed pre-existing JSON; atomic-write via tmp+rename in `writeConfigFile()` (Topic 7) |
| Secret leak in InstallEnvelope JSON output | Information Disclosure | InstallEnvelope contains only status messages, never secret values (Topic 7); precedent from Phase 5 Plan 05-03 `get_vaultpilot_config_status` |
| `request_capability` abuse (agent files 100 spam issues) | DoS / Spam | 3/hour rate-limit in-memory (Topic 8); per-process scope (restart-bypass acknowledged as friction-not-fortress) |
| Pre-filled URL maliciously crafted by agent (e.g. body contains a fake CSRF token) | Tampering | Agent can only fill `title` + `body` — schema validates; URL goes through `URLSearchParams` encoding (Topic 8); user reads the URL + body in the browser BEFORE clicking submit on GitHub; user discretion is the final gate |
| `vaultpilot-mcp setup` non-interactive payload contains malicious URL/value | Tampering / Spoofing | Zod schema validation rejects out-of-spec values (Topic 7); RPC URL is validated via HTTPS-only pattern; ETHERSCAN_API_KEY format-validated (hex-string check) |
| MCP client registration via `claude mcp add` shells out — command injection? | Tampering | Binary path is constructed from known install-dir + binary-name constants (Topic 6); user-supplied paths via env var `VAULTPILOT_MCP_INSTALL_DIR` are NOT command-substituted into `claude mcp add` — passed as positional arg with shell quoting |
| Build artifact contamination (a malicious dep slips into pkg's bundle) | Supply Chain / Tampering | Phase 10 surface uses `@yao-pkg/pkg` + `@clack/prompts` — both vetted via npm view + transitive-dep audit (DF-1 + DF-2 enumerate transitive deps); future hardening: sigstore-sign release artifacts (v1.5+) |
| `package.json` `pkg.assets` exclusion bug — secret file accidentally bundled | Information Disclosure | `pkg.assets` is an explicit allowlist (Topic 1 sketch lists `["package.json"]` only); no .env files or secrets are in the project's src tree (per CLAUDE.md "No private key material crosses any boundary") |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node `crypto` (built-in) | SHA-256 of downloaded binary (install.sh shells out to `shasum`/`sha256sum`; install.ps1 uses Get-FileHash) | ✓ | Node ≥ 18.17 | — |
| Node `fs/promises` (built-in) | writeConfigFile + request_capability local-file fallback | ✓ | Node ≥ 18.17 | — |
| Node `URL` / `URLSearchParams` (built-in) | request_capability URL build | ✓ | Node ≥ 18.17 | — |
| `@yao-pkg/pkg@^6.19.0` | Plan 10-01 release.yml binary build | install at execute time | 6.19.0 (probed) | DF-1 alternatives (Bun / SEA / nexe) if pkg fails on this stack — execute-time empirical |
| `@clack/prompts@^1.4.0` | Plan 10-03 interactive wizard | install at execute time | 1.4.0 (probed) | DF-2 alternatives (prompts / inquirer) |
| `softprops/action-gh-release@v2` | Plan 10-01 release.yml asset upload | external (GitHub Actions marketplace) | v2 | actions/upload-release-asset@v1 (legacy) |
| `curl` (POSIX) | install.sh download | external (every POSIX system has it) | any | `wget` (less universal) |
| `shasum` / `sha256sum` (POSIX) | install.sh SHA verify | external (every POSIX system has it) | any | OpenSSL-based fallback `openssl dgst -sha256` |
| `tar` (POSIX) | install.sh extract | external | any | — |
| PowerShell ≥ 5.1 (Windows) | install.ps1 | external (Windows 10+ default) | 5.1+ | — |
| `claude` CLI | MCP client auto-register (Claude Code) | optional — detected, skipped if absent | n/a | Manual `claude mcp add` after install |
| Claude Desktop config file | MCP client auto-register | optional — detected, skipped if absent | n/a | Manual paste of mcpServers entry |
| Cursor config file | MCP client auto-register | optional — detected, skipped if absent | n/a | Manual paste of mcpServers entry |
| `gh` CLI | NOT REQUIRED in execute path | n/a | n/a | — |

**Missing dependencies with no fallback:**
- None. Phase 10 distribution channels (npm + curl-pipe + setup wizard) are independent — a user can install via `npm install -g vaultpilot-mcp` regardless of curl-pipe availability.

**Missing dependencies with fallback:**
- All MCP client auto-registration paths are opt-in + detected; absence is handled gracefully.
- macOS quarantine xattr strip is offered, not enforced.

## Open Questions (RESOLVED)

All resolved at planning gate per Phase 5/6/7/8/9 reasonable-call discipline. Items deferred to verify-phase listed in Assumptions Log (A2 pkg ESM + dynamic-import edge-cases, A4 wizard Ledger pairing delegation, A6 GitHub URL 414 threshold empirical, A12 Rosetta x64-binary-on-arm64 correctness).

## Files Phase 10 Will Touch (preliminary scope inventory)

For the planner's mental model — confirm with pattern-mapper.

**New files (cross-cutting / per-plan):**
- `install.sh` (Plan 10-02) — POSIX bash installer
- `install.ps1` (Plan 10-02) — PowerShell installer
- `.github/workflows/release.yml` (Plan 10-01) — GitHub Actions matrix-build + release-asset upload
- `src/cli/setup.ts` (Plan 10-03) — `vaultpilot-mcp setup` CLI subcommand entry point
- `src/cli/setup-prompts.ts` (Plan 10-03) — Interactive prompts via `@clack/prompts`
- `src/cli/setup-non-interactive.ts` (Plan 10-03) — `--non-interactive --json` stdin reader + writer
- `src/cli/setup-mcp-clients.ts` (Plan 10-02 + 10-03) — MCP client detection + registration helpers
- `src/cli/setup-schema.ts` (Plan 10-03) — Zod schema (single SOT for interactive + non-interactive)
- `src/tools/request_capability.ts` (Plan 10-04) — `request_capability` registered tool
- `src/security/request-capability-rate-limit.ts` (Plan 10-04) — Sliding-window 3-per-hour rate-limit + state
- `test/cli-setup-interactive.test.ts` (Plan 10-03)
- `test/cli-setup-non-interactive.test.ts` (Plan 10-03)
- `test/cli-setup-mcp-clients.test.ts` (Plan 10-02 + 10-03)
- `test/cli-setup-schema.test.ts` (Plan 10-03)
- `test/request-capability.test.ts` (Plan 10-04)
- `test/request-capability-rate-limit.test.ts` (Plan 10-04)
- `test/install-envelope-shape.test.ts` (extend; Plan 10-02 + 10-03)
- `test/install-sh.smoke.test.ts` (optional; Plan 10-02 — deferred to verify-phase if vitest shell-out is fragile)

**Extended files (additive only):**
- `src/index.ts` (Plan 10-03) — NEW `setup` subcommand routing in the existing arg parser; `--check` path unchanged
- `src/diagnostics/install-envelope.ts` (Plan 10-02 + 10-03) — Additive `CheckId` literals (Topic 9); existing shape byte-frozen
- `src/tools/register-all.ts` (Plan 10-04) — +1 import line for `request_capability.js`; carved at the end to avoid Phase 9 conflict
- `src/signing/error-codes.ts` (Plan 10-04) — Additive `RATE_LIMIT_EXCEEDED` (code 20); previous 19 codes byte-frozen
- `src/config/config-file.ts` (Plan 10-03) — Additive `writeConfigFile()` companion to existing `readConfigFile()`; existing exports unchanged
- `package.json` (Plan 10-01 + 10-03 + 10-04) — Additive `pkg` config section + `build:binary:*` scripts + 2-3 new deps (`@yao-pkg/pkg`, `@clack/prompts`, possibly `zod` if not already present)
- `README.md` (Plan 10-01 + 10-02 + 10-03) — Install instructions + setup wizard usage + curl-pipe one-liner
- `SECURITY.md` (Plan 10-01 + 10-02) — Add v1.4 residual-risk rows: unsigned macOS binaries + Windows SmartScreen friction + per-process rate-limit

**Not touched (FROZEN — assert zero diff in every plan's success_criteria):**
- `src/signing/payload-fingerprint.ts` — preimage shape invariant (Phase 4)
- `src/signing/presign-hash.ts` — EIP-1559 RLP (Phase 4)
- `src/signing/handle-store.ts` — state machine + TTL (Phase 4)
- `src/tools/send_transaction.ts` THREE-GATE block — PREP-07 schema gate + PREP-08 fingerprint re-check + userDecision check (Phase 4)
- `src/tools/preview_send.ts` — Phase 9 Layer 0/0.5 gates + chain mismatch
- `src/tools/prepare_*.ts` (8 tools — native_send, token_send, token_approve, revoke_approval, weth_unwrap, aave_supply, aave_withdraw, simulate_position_change)
- `src/security/canonical-dispatch.ts` — Phase 9 per-chain allowlist
- `src/security/skill-integrity.ts` — Phase 9 SHA-256 pin probe
- `src/clients/etherscan.ts`, `src/clients/fourbyte.ts` — Phase 7 + Phase 4
- `src/protocols/{erc20,aave-v3,weth9}.ts` — decoder shapes (Phase 6 + 7)
- `src/signing/{aave-health,amount,simulation}.ts` — Phase 6/7
- `src/wallet/session-manager.ts` — Phase 8 multi-chain WC namespace
- `src/chains/registry.ts` — Phase 8 per-chain RPC factory
- `src/config/contracts.ts` — Phase 8 per-chain ContractsForChain SOT (Phase 10 only CONSUMES contract addresses; no widening)
- `src/tools/verify_tx_decode.ts`, `get_verification_artifact.ts`, `get_tx_verification.ts` — Phase 9
- `src/diagnostics/{check,notice,update-check,logger}.ts` — Phase 1/5 (Phase 10 extends `install-envelope.ts` only)
- `src/config/config-file.ts` `readConfigFile()` / `_paths` / `ConfigFile` / `ConfigFileResult` exports — Phase 5 single SOT (Phase 10 ADDS `writeConfigFile()` next to them, doesn't modify them)
- `src/server.ts` — Phase 1-9 server entry (Phase 10 doesn't touch — setup wizard is a separate CLI subcommand; `src/index.ts` routes to it without server boot)

## Sources

### Primary (HIGH confidence)
- [VERIFIED: empirical install at `/tmp/pkg-probe/` 2026-05-18] — `@yao-pkg/pkg@6.19.0` package shape including PkgOptions / PkgExecOptions types, NODE_OSES + NODE_ARCHS arrays, exec function signature, dependency tree (19 transitive deps)
- [VERIFIED: `find /Users/s/dev/vaultpilot/vaultpilot-mcp-gsd-inspired/.claude/worktrees/plan-phase-10/node_modules -name "*.node" -o -name "binding.gyp" 2>/dev/null` returned 0 — empirically confirmed no native bindings in vaultpilot dep tree]
- [VERIFIED: `npm view @yao-pkg/pkg version` → 6.19.0; `npm view @yao-pkg/pkg@6.19.0` confirmed dependency manifest 2026-05-18]
- [VERIFIED: `npm view @clack/prompts version` → 1.4.0; `npm view prompts version` → 2.4.2; `npm view @inquirer/prompts version` → 8.4.3]
- [VERIFIED: `npm view bun version` → 1.3.14; `npm view pkg version` → 5.8.1 (archived)]
- [Extend Claude with skills — Claude Code Docs](https://code.claude.com/docs/en/skills) (cross-ref from Phase 9 RESEARCH; relevant for setup wizard registration)
- [softprops/action-gh-release@v2 (GitHub Marketplace)](https://github.com/marketplace/actions/upload-files-to-a-github-release) — canonical release-asset upload action
- [yao-pkg/pkg docs site](https://yao-pkg.github.io/pkg/) — Configuration, Targets, SEA vs Standard mode reference
- [Improving Single Executable Application Building for Node.js (Joyee Cheung, 2026-01-26)](https://joyeecheung.github.io/blog/2026/01/26/improving-single-executable-application-building-for-node-js/) — Node `--build-sea` flag landed in v25.5; future direction for pkg's SEA backend
- [Node.js single-executable-applications docs (v26.1.0)](https://nodejs.org/api/single-executable-applications.html) — official Node SEA spec
- [GitHub Docs — Creating an issue with query parameters](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue) — pre-filled URL labels / title / body / milestone parameter semantics
- [MDN URLSearchParams](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams) — WHATWG-compliant URL parameter encoder

### Secondary (MEDIUM confidence — verified against authoritative source)
- [CITED: Curl to shell isn't so bad (arp242.net)](https://www.arp242.net/curl-to-sh.html) — canonical `main() { … }; main "$@"` curl-pipe-safety idiom
- [CITED: 5 Ways to Deal With the install.sh Curl Pipe Bash problem (Chef Blog)](https://www.chef.io/blog/5-ways-to-deal-with-the-install-sh-curl-pipe-bash-problem)
- [CITED: The Dangers of curl | bash (Luke Spademan)](https://lukespademan.com/blog/the-dangers-of-curlbash/) — partial-download attack scenarios
- [CITED: macOS Gatekeeper / Quarantine / XProtect (HackTricks)](https://hacktricks.wiki/en/macos-hardening/macos-security-and-privilege-escalation/macos-security-protections/macos-gatekeeper.html) — `xattr -d com.apple.quarantine` mechanics
- [CITED: The Complete Guide to MCP Config Files (MCP Playground 2026)](https://mcpplaygroundonline.com/blog/complete-guide-mcp-config-files-claude-desktop-cursor-lovable) — Claude Desktop / Cursor / Claude Code per-platform paths
- [CITED: How to Configure GitHub Actions for Multi-Platform Builds (oneuptime.com 2026-02-02)](https://oneuptime.com/blog/post/2026-02-02-github-actions-multi-platform-builds/view)
- [CITED: Automating Multi-Platform Releases with GitHub Actions (Md. Fuad Hasan, Medium)](https://itsfuad.medium.com/automating-multi-platform-releases-with-github-actions-f74de82c76e2)
- [sindresorhus/new-github-issue-url](https://github.com/sindresorhus/new-github-issue-url) — reference impl for GitHub issue URL builder
- [CITED: Homebrew tightening 2026 (news.mcan.sh)](https://news.mcan.sh/item/45907259) — Gatekeeper bypass policy change context
- [CITED: GitHub Community discussion — query-param-based issue prefill](https://github.com/orgs/community/discussions/47461)

### In-repo cross-references (HIGH confidence)
- Phase 1 Plan 01-03 `src/diagnostics/install-envelope.ts` + `src/diagnostics/check.ts` — FROZEN existing InstallEnvelope shape
- Phase 1 INST-04 — Windows `cmd /c` wrapper precedent for MCP client config
- Phase 5 Plan 05-01 `src/config/config-file.ts` — FROZEN `readConfigFile()` + `_paths` indirection
- Phase 5 Plan 05-03 `src/server.ts:153-161` — dispatcher-wrap precedent (auto-demo NOTICE)
- Phase 5 Plan 05-03 `get_vaultpilot_config_status` — secret-safety precedent (booleans/counts only)
- Phase 9 Plan 09-02 `src/security/skill-integrity.ts` — `_skillIntegrity` ESM spy-affordance pattern; Phase 10's `_rateLimit` mirrors
- Phase 8 RESEARCH § Topic 9-10 — Phase 8/9 FROZEN-area discipline inherited
- `09-RESEARCH.md` — Phase 9 patterns Phase 10 inherits (sister-repo coordination, NOTICE dispatcher-wrap, dedup-per-session)

### Tertiary (LOW confidence — flagged for empirical verification at execute time)
- Bun cross-compile target string conventions (training-data approximation; verify against bun docs at execute time)
- Exact 414 URI Too Long threshold on GitHub (~8KB common; truncation at 7KB has ~700+ char headroom)
- Rosetta `uname -m` lying about arch on Apple Silicon (sysctl-based detection IS robust per cited GitHub frida/cryptoshark commit, but install.sh's `uname -m` form is intentionally simpler — accepts the false positive as functionally correct via Rosetta)

## Metadata

**Confidence breakdown:**

- Binary build tool selection (Topic 1, DF-1): HIGH — empirically probed @yao-pkg/pkg v6.19.0 via npm install + types.d.ts read; verified ESM support + cross-compile targets + no native-bindings constraint
- Per-platform release artifact shape (Topic 2): HIGH — ROADMAP locks 4-target matrix; @yao-pkg/pkg-fetch confirmed support for all 4 targets
- macOS Gatekeeper friction (Topic 3): MEDIUM — well-understood mechanism but exact user-experience varies by macOS version; v1.4 defers signing; accepted residual documented
- GitHub Actions release workflow (Topic 4): HIGH — standard pattern; softprops/action-gh-release v2 canonical; matrix build proven
- install.sh curl-pipe idiom + security (Topic 5): HIGH — canonical patterns from rustup/bun/deno; arp242 + chef-blog + lukespademan cite the same mitigations
- MCP client auto-registration (Topic 6): HIGH — per-client paths verified via mcpplaygroundonline 2026 docs; idempotency of `claude mcp add` verified per docs
- Setup wizard + non-interactive mode + config.json merge (Topic 7): HIGH — `@clack/prompts` v1.4.0 stable; Phase 5 `readConfigFile()` SOT discipline applies cleanly
- `request_capability` URL builder + rate-limit (Topic 8): HIGH — `URLSearchParams` WHATWG-compliant; sliding-window mechanics standard
- InstallEnvelope JSON shape (Topic 9): HIGH — Phase 1 shape byte-frozen; Phase 10 additive CheckId literals only
- FROZEN-area zero-diff (Topic 10): HIGH — empirically verified against current source tree; Phase 10 has NO touch points in the cryptographic-binding chain; mirrors Phase 8 + 9 discipline

**Research date:** 2026-05-18
**Valid until:** 2026-06-30 (estimate — `@yao-pkg/pkg` + `@clack/prompts` stable; GitHub Actions surface stable; MCP client config paths verified 2026-05 but vendors may relocate config files; revisit if Anthropic ships Claude Code Skills marketplace v2 OR Node 26+ ships official cross-compile)
