# Phase 42: pkg ESM `@modelcontextprotocol/sdk` Subpath-Export Resolution Fix — Research

**Researched:** 2026-05-29
**Domain:** `@yao-pkg/pkg@6.19.0` ESM module resolution, Node.js 22 ESM loader internals, patch-package, Node SEA (Single Executable Application)
**Confidence:** HIGH on root cause + empirical verdicts; MEDIUM on recommended fix (SEA+tronweb patch) because the tronweb patch step was not run to completion (node_modules edit blocked by auto-mode; root-cause logic is solid)

---

## Summary

Phase 42 lifts the Phase 10-01 deferral that gates the v1.4.0 GA binary tag. All four per-platform binaries build cleanly but fail at runtime with `ERR_MODULE_NOT_FOUND` because the `@modelcontextprotocol/sdk` package uses an `exports`-only map (no `main` field) and pkg's snapshot filesystem cannot intercept the ESM resolver's native C++ package-lookup binding.

**Root cause confirmed empirically [VERIFIED: built+ran]:** pkg's bootstrap patches `require()` and `Module._resolveFilename` (CJS loader) but explicitly does NOT patch Node's ESM loader (comment in bootstrap.js line 1772: `// TODO esm modules along with cjs`). When `dist/server.js` (an ESM module shipped as source via `--fallback-to-source`) is loaded at runtime, Node's native ESM resolver runs and calls `getPackageJSONURL` via a C++ binding (`node:internal/modules/package_json_reader`) that bypasses all of pkg's `fs.readFileSync` patching. No amount of `pkg.assets` can bridge this — the native binding reads directly from the real or snapshot filesystem through a path that user-space code cannot intercept.

**Recommended fix: `pkg.sea = true` in `package.json` + a `patches/tronweb+6.3.0.patch` via patch-package.** The SEA backend uses Node's native SEA module loader (not pkg's bootstrap shim), which properly handles ESM imports from within the snapshot. This resolves the `@modelcontextprotocol/sdk` ERR_MODULE_NOT_FOUND. A second issue — `tronweb` loading its ESM entry which imports `{ BigNumber }` from `bignumber.js` as a named export that doesn't exist in bignumber's ESM build — is fixed by a patch-package patch removing the `"import"` condition from tronweb's `package.json` exports map, forcing the CJS entry. The `patches/` directory already exists and the `postinstall` script already runs `patch-package`. This is the established pattern in this codebase (three existing `@ledgerhq` patches).

**Primary recommendation:** `pkg.sea = true` in `package.json` (one-line additive change) + `patches/tronweb+6.3.0.patch` (removes `"import"` from tronweb exports). Zero FROZEN file touches. Binary size increases ~53% (216 MB vs 141 MB on linux-x64); build time increases ~1-2 min on CI for Node binary download (cached on repeat runs).

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DIST-40 | Bundled binary distribution per platform — runtime-correctness completion | The runtime half of DIST-40: build pipeline already works (Phase 10-01); this phase makes the binaries actually execute. Recommended fix (SEA + tronweb patch) resolves the ERR_MODULE_NOT_FOUND and the subsequent tronweb ESM interop error, enabling `--version` and full MCP stdio startup. |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

- **FROZEN cryptographic-binding chain:** `src/signing/*`, `src/tools/send_transaction.ts` (3-gate region), `src/tools/preview_send.ts`, all `src/tools/prepare_*`, `test/signing-fingerprint*.test.ts` Fixtures A-F must stay BYTE-IDENTICAL. `git diff origin/main -- src/` must remain ZERO.
- **DF-1 LOCKED:** `@yao-pkg/pkg` is the binary backend. Do NOT swap to Bun/nexe.
- **Option (b) REJECTED up front:** Deep CJS import paths in `src/server.ts` — rejected because it edits the FROZEN `src/server.ts`.
- **Stderr for diagnostics, stdout for MCP protocol.** Do not cross the wires.
- **patch-package established pattern:** Three existing `patches/@ledgerhq*.patch` files confirm patch-package is the approved approach for patching node_modules in this codebase.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Binary bundling | Build-time (`@yao-pkg/pkg` pkg.sea=true) | Node SEA blob injection via postject | SEA backend uses Node's native module loader, which handles ESM imports from snapshot correctly |
| SDK subpath resolution at runtime | Node SEA module loader (in-binary) | pkg snapshot VFS | ESM imports in fallback-to-source files go through Node's native ESM resolver; SEA makes the snapshot accessible to it |
| tronweb CJS/ESM disambiguation | patch-package (`patches/tronweb+6.3.0.patch`) | Node module condition selection | Removing "import" condition forces Node to use tronweb's CJS entry in all contexts |
| Build script invocation | `package.json` `pkg` config + `build:binary:*` scripts | `.github/workflows/release.yml` | `pkg.sea` lives in `package.json pkg` block; no script flag change needed |
| Supply-chain / security posture | SECURITY.md `## v1.4 Residual Risks` | New row for SEA backend change | SEA uses a different injection mechanism (postject); warrants a note in the existing residual-risks section |

---

## Root Cause Analysis

### The Failure Chain

```
pkg binary starts
  → bootstrap.js runs (CJS shim)
  → patches require() + Module._resolveFilename + fs.readFileSync
  → bootstrap DOES NOT patch Node's ESM loader (// TODO esm modules along with cjs)
  → Module.runMain() loads dist/index.js
  → dist/index.js has ESM imports → Node detects ESM → switches to ESM loader
  → ESM loader loads dist/server.js (fallback-to-source — shipped as ESM source)
  → dist/server.js has static import '@modelcontextprotocol/sdk/server/index.js'
  → ESM loader calls getPackageJSONURL()
  → getPackageJSONURL uses C++ binding (node:internal/modules/package_json_reader:317)
  → C++ binding cannot see pkg snapshot VFS (bypasses fs.readFileSync patch)
  → ERR_MODULE_NOT_FOUND: Cannot find package '@modelcontextprotocol/sdk'
```

### Why the SDK Specifically

`@modelcontextprotocol/sdk` has `"type": "module"` and **no `"main"` field** (only an `"exports"` map). The build-time warning "Entry 'main' not found" confirms pkg's resolver tried the traditional `main` path and found nothing. pkg's build-time `resolver.js` uses `resolve.exports` to find the CJS files correctly (confirmed: `resolve.exports(pkg, './server/index.js', {require: true})` → `['./dist/cjs/server/index.js']`), so the CJS files ARE bundled. But at runtime, the native ESM resolver needs to find the package boundary via `package_json_reader`, which the snapshot VFS cannot serve.

SDK version in use: `@modelcontextprotocol/sdk@1.29.0` [VERIFIED: npm view / node_modules read].

SDK exports map (relevant subpaths): [VERIFIED: node_modules/@modelcontextprotocol/sdk/package.json read]
- `./server` → `{ import: ./dist/esm/server/index.js, require: ./dist/cjs/server/index.js }`
- `./server/stdio.js` → matched by `./*` wildcard → `{ import: ./dist/esm/server/stdio.js, require: ... }`  
- `./validation/ajv` → `{ import: ./dist/esm/validation/ajv-provider.js, require: ... }`

All ESM and CJS target files exist on disk [VERIFIED: fs.existsSync checks]. The problem is resolution, not file presence.

---

## Recovery-Option Comparison Table

| Option | What it changes | Empirical result | Binary size (linux-x64) | FROZEN-safe? | Confidence |
|--------|----------------|-----------------|------------------------|-------------|------------|
| **Baseline (current)** | Nothing | FAIL: `ERR_MODULE_NOT_FOUND` for `@modelcontextprotocol/sdk`, exit 1 | 141 MB | N/A | [VERIFIED: built+ran] |
| **(b) Deep CJS imports in `src/server.ts`** | Edits FROZEN `src/server.ts` | **REJECTED — touches FROZEN file** | — | **NO** | Rejected pre-test |
| **(a) `pkg.sea = true` only** | `package.json`: `"pkg": { "sea": true }` | FAIL: different error — `SyntaxError: The requested module 'bignumber.js' does not provide an export named 'BigNumber'` in `tronweb/lib/esm/utils/validations.js:1`, exit 1. SDK error gone. | 216 MB | YES | [VERIFIED: built+ran] |
| **(c) `pkg.assets` glob `node_modules/@modelcontextprotocol/sdk/**/*`** | `package.json`: extends `"assets"` array | FAIL: same `ERR_MODULE_NOT_FOUND` as baseline. Native C++ binding bypasses `fs.readFileSync` patch entirely. | 141 MB | YES | [VERIFIED: built+ran] |
| **(RECOMMENDED) `pkg.sea = true` + tronweb patch** | `package.json`: `"pkg": { "sea": true }` + `patches/tronweb+6.3.0.patch` removing `"import"` from tronweb exports | NOT YET RUN (blocked by auto-mode on node_modules edit — see note below). Root-cause analysis shows this must work: SEA resolves SDK; tronweb patch forces CJS entry avoiding the bignumber named-export mismatch. | ~216 MB | YES | [ASSUMED — strong root-cause basis; HIGH confidence in analysis] |

**Note on the recommended option not being fully run:** The final empirical step — applying the tronweb patch and running `--version` — was blocked because auto-mode does not allow in-place edits to `node_modules/tronweb/package.json` without explicit permission. The executor MUST complete the empirical verification before declaring success (Success Criterion #2 in the Phase 42 ROADMAP entry). The patch creation pattern is identical to the three existing `@ledgerhq` patches and carries a HIGH confidence verdict based on the root-cause chain.

---

## Recommended Fix — Exact Changes

### Change 1: `package.json` — add `"sea": true` to `pkg` block

```json
"pkg": {
  "scripts": [
    "dist/**/*.js"
  ],
  "assets": [
    "package.json"
  ],
  "sea": true
}
```

**Diff shape:**
```diff
   "pkg": {
     "scripts": [
       "dist/**/*.js"
     ],
     "assets": [
       "package.json"
-    ]
+    ],
+    "sea": true
   },
```

**Files touched:** `package.json` (1 line additive, non-frozen). `package-lock.json` — NOT changed (no new dependency).

**Does this require build script changes?** No. The existing `build:binary:*` scripts call `pkg . --fallback-to-source --target ... --out-path dist-binaries`. The `sea` flag in `package.json` `pkg` block is read by pkg automatically. No CLI flag change needed. [VERIFIED: pkg types.d.ts confirms `sea?: boolean` in `PkgOptions` interface which maps to the `package.json` `pkg` block]

**Does `.github/workflows/release.yml` need updating?** No. The build invocations are unchanged. The SEA build takes longer (~1-2 min extra per target on CI due to Node binary download; cached after first run). If the CI timeout is tight, the release.yml comments may need a note — check if `ubuntu-latest` runner has any 1-hour job timeout concern. The current release.yml has no explicit timeout set.

---

### Change 2: `patches/tronweb+6.3.0.patch` — remove `"import"` condition from tronweb exports

**What the patch does:** Modifies `node_modules/tronweb/package.json` to remove the `"import": "./lib/esm/index.js"` condition from the root exports entry, leaving only `"require": "./lib/commonjs/index.js"` (plus optional `"default"` pointing to CJS). This forces Node's module condition resolution to always use tronweb's CJS build.

**Why this is safe:** tronweb's CJS build (`lib/commonjs/index.js`) is fully functional. The ESM build (`lib/esm/index.js`) has a broken dependency: it does `import { BigNumber } from 'bignumber.js'` but `bignumber.js@9.3.1`'s ESM entry (`bignumber.mjs`) only exports a default. This is a tronweb packaging bug. The CJS build uses `require("bignumber.js")` which correctly gets the CJS default export. No production functionality is lost.

**Patch file content (for executor to create via `npx patch-package tronweb` after editing):**
```diff
diff --git a/node_modules/tronweb/package.json b/node_modules/tronweb/package.json
index <hash>..<hash> 100644
--- a/node_modules/tronweb/package.json
+++ b/node_modules/tronweb/package.json
@@ -X,8 +X,7 @@
   "exports": {
     ".": {
-      "import": "./lib/esm/index.js",
-      "require": "./lib/commonjs/index.js"
+      "require": "./lib/commonjs/index.js",
+      "default": "./lib/commonjs/index.js"
     }
   },
```

**Exact executor steps for patch creation:**
1. Edit `node_modules/tronweb/package.json` — remove the `"import"` line from `exports["."]`, add `"default": "./lib/commonjs/index.js"` as a safety net.
2. Run: `npx patch-package tronweb` (generates `patches/tronweb+6.3.0.patch` automatically)
3. Verify `patches/tronweb+6.3.0.patch` was created with the expected diff.
4. The existing `"postinstall": "patch-package"` script ensures this is applied on every `npm install`.

**Files touched:** `patches/tronweb+6.3.0.patch` (NEW, non-frozen). `node_modules/tronweb/package.json` (modified as the mechanism for patch creation, not committed).

---

### SECURITY.md update (if SEA posture warrants it)

The Phase 10-01 SECURITY.md `## v1.4 Residual Risks (Distribution)` section already exists with 3 rows. The SEA backend change does not introduce new security risks — SEA is Node's own official single-executable mechanism. However, the supply-chain row should be noted: SEA uses `postject` to inject the blob into the Node binary. This is an additional build step but not a new attack surface (the Node binary comes from `nodejs.org/dist` via pkg-fetch, same as non-SEA mode). **SECURITY.md change: likely no new row needed; add a clarifying note to the existing supply-chain residual row if the executor judges it material.** This is a judgment call for the executor — not a hard requirement.

---

## Pitfalls the Planner and Executor Must Guard Against

### Pitfall 1: Other ESM packages with CJS/ESM interop issues in SEA mode

**What could go wrong:** After fixing tronweb, another package might fail with a similar ESM interop error. The executor must run the full smoke test (`./dist-binaries/vaultpilot-mcp --version` AND a brief MCP stdio handshake test) and capture any subsequent errors.

**Risk assessment:** LOW. Checked the major production dependency chain [VERIFIED: node_modules package.json reads]:
- `@walletconnect/core` and `@walletconnect/utils`: `"type": "module"` but exports use `"default"` → CJS. No "import" condition. Safe.
- `bitcoinjs-lib`, `bip32`: have "import" → ESM, but ESM entries use correct ES module patterns (no CJS named-import destructuring issues observed).
- `@solana/web3.js`, `@solana/spl-token`: CJS main; no ESM entry issues expected.
- `@ledgerhq/*`: Already patched via existing `patches/@ledgerhq*.patch` files.
- `viem`: `"main": "./_cjs/index.js"` — pure CJS fallback, no ESM issues.

**How to avoid:** Run `./dist-binaries/vaultpilot-mcp --version` → if it passes, run a 2-second MCP stdio handshake (`echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}' | timeout 5 ./dist-binaries/vaultpilot-mcp`). Capture any subsequent errors and address them with additional patches.

### Pitfall 2: SEA binary size regression

**What could go wrong:** 216 MB (linux-x64) vs 141 MB (non-SEA) — a 53% increase. This affects:
- GitHub release asset download time for users.
- GitHub Releases storage (each platform × 4 targets = ~864 MB vs ~564 MB per release tag).
- The `install.sh` download step may time out on slow connections.

**Mitigation:** Document in release notes. The existing `install.sh` has no timeout; the download proceeds until complete. For GitHub Releases, the storage is within free limits for public repos. Acceptable for v1.4.x; v1.5+ can explore `--compress GZip` flag (already on the non-SEA `build:binary` all-targets script; per-target scripts don't use it — add it if size is a concern, but that's executor scope).

### Pitfall 3: `--fallback-to-source` interaction with SEA mode

**What could go wrong:** In SEA mode, `--fallback-to-source` means the server.js source is still shipped as-is (not V8 bytecode). The SEA blob includes it. This is the DESIRED behavior — the bytecode compilation would fail (top-level await + export combo in server.ts). `--fallback-to-source` correctly ships source. Keep this flag.

**Confirmed:** The SEA build output showed `--fallback-to-source` flag still operating correctly — `dist/server.js` was included as source in the SEA blob. The SDK resolution then worked because SEA's module loader handles ESM properly.

### Pitfall 4: Cold-start regression in SEA mode

**What could go wrong:** SEA mode may have slower cold-start than non-SEA because the module loading strategy differs. For an MCP server (long-running process), this is low impact. For `--version` and `--check` (one-shot invocations), a 200-500ms cold-start difference is acceptable. No data to quantify; flag as LOW risk.

### Pitfall 5: Node version mismatch in SEA blob

**What could go wrong:** The SEA blob is created using the Node binary downloaded by pkg-fetch (`v22.22.3` in our test). If the host system runs a different Node version, the SEA blob might be incompatible. However, since the binary IS a self-contained executable (it embeds the Node runtime), the host Node version is irrelevant. The embedded Node is always `22.22.x` (the target from `node22-*` pkg flags). No version mismatch risk.

### Pitfall 6: `patches/tronweb+6.3.0.patch` must be version-pinned

**What could go wrong:** If `tronweb` is upgraded (current: `^6.3.0` in package.json, installed `6.3.0`), the patch will fail to apply on `npm install`. 

**Mitigation:** Pin `tronweb` to exactly `6.3.0` in package.json (change `^6.3.0` to `6.3.0`). This is a separate 1-line change. The executor should make this change alongside the patch creation. If tronweb is later upgraded, the patch must be regenerated.

Actually check — is tronweb already pinned exactly?

```json
"tronweb": "^6.3.0"  ← semver range, NOT pinned
```

**Required additional change:** `package.json` `dependencies.tronweb`: change `"^6.3.0"` to `"6.3.0"` so the patch file version matches the installed package.

### Pitfall 7: FROZEN-area zero-diff must be asserted

**What must be true at the end:** `git diff origin/main -- src/` returns ZERO lines. The executor MUST run this command as the final verification step. The recommended fix touches only `package.json` (2 lines changed: `sea: true` + optional tronweb version pin) and `patches/tronweb+6.3.0.patch` (new file) — zero src/ changes.

---

## Code Examples

### Exact `package.json` `pkg` block after the change

```json
"pkg": {
  "scripts": [
    "dist/**/*.js"
  ],
  "assets": [
    "package.json"
  ],
  "sea": true
}
```

[Source: `@yao-pkg/pkg@6.19.0` `lib-es5/types.d.ts` PkgOptions interface — `sea?: boolean` confirmed]

### SEA build output (what the executor should see)

```
> pkg@6.19.0
> Walking dependencies...
> Warning Cannot find module '@modelcontextprotocol/sdk/...' ...  ← still appears at build time (OK)
> Refining file records...
> Downloading nodejs executable from https://nodejs.org/dist/v22.22.3/node-v22.22.3-linux-x64.tar.gz
> Verifying checksum of node-v22.22.3-linux-x64.tar.gz
> Extracting node binary from node-v22.22.3-linux-x64.tar.gz
> Generating SEA assets...
> Creating sea-config.json file...
> Generating the blob...
> Creating executable for node22-linux-x64....
> Injecting the blob into .../dist-binaries/vaultpilot-mcp...
```

The build-time "Cannot find module" warnings for SDK subpaths **remain** — these are from pkg's static analysis walker and do NOT indicate the runtime fix failed. With SEA mode, the runtime ESM loader handles these correctly regardless of the build-time warnings.

### Smoke test commands (verification recipe)

```bash
# 1. Build the linux-x64 binary (native target)
npm run build:binary:linux-x64

# 2. Run --version (must exit 0 and print version)
./dist-binaries/vaultpilot-mcp --version
# Expected: "0.0.0" (or whatever version string), exit 0

# 3. MCP stdio handshake (must not error on module resolution)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}' \
  | timeout 5 ./dist-binaries/vaultpilot-mcp 2>/dev/null \
  | head -1
# Expected: A JSON response starting with {"jsonrpc":"2.0","id":1,"result":...}

# 4. FROZEN-area assertion (must return ZERO)
git diff origin/main -- src/ | wc -l
# Expected: 0

# 5. Test suite must pass
npm test
# Expected: all tests pass (no regression from package.json change)

# 6. TypeScript build must be clean
npm run typecheck && npm run build
# Expected: no errors
```

---

## Standard Stack

### Core (Phase 42)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@yao-pkg/pkg` | `^6.19.0` (installed: `6.19.0`) | Binary bundler (DF-1 LOCKED) | Already in devDeps; SEA flag is a config switch, no version change needed |
| `patch-package` | `^8.0.0` (already in devDeps) | Apply `patches/tronweb+6.3.0.patch` on postinstall | Already established pattern (three `@ledgerhq` patches exist) |
| `tronweb` | `6.3.0` (pin from `^6.3.0`) | Production dep; patch targets this version | Pinning ensures patch version matches installed version |

### No New Packages

Phase 42 adds zero new dependencies. The fix is configuration-only (`package.json` `pkg.sea`) plus a patch file.

### Package Legitimacy Audit

No new packages to audit. The `pkg.sea = true` flag uses `postject` (already a transitive dep of `@yao-pkg/pkg` — `postject@^1.0.0-alpha.6` is listed in pkg's dependency tree, verified at Phase 10-01 probe time). No additional package installs required.

---

## Architecture Patterns

### System Architecture Diagram

```
pkg CLI invocation (npm run build:binary:linux-x64)
  │
  ├── reads package.json → finds pkg.sea = true
  │
  ├── BUILD PHASE: Walker traverses dist/**/*.js + package.json asset
  │   ├── resolver.js: resolve.exports handles SDK subpaths → bundles CJS files
  │   ├── dist/server.js: top-level await + export → fallback-to-source (shipped as ESM)
  │   └── tronweb: patch-package has removed "import" condition → resolver uses CJS entry
  │
  ├── SEA PHASE:
  │   ├── Downloads node-v22.22.3-linux-x64.tar.gz
  │   ├── Creates sea-config.json with useSnapshot=true
  │   ├── node --experimental-sea-config sea-config.json → generates blob
  │   └── postject injects blob into Node binary → dist-binaries/vaultpilot-mcp
  │
  └── RUNTIME (inside binary):
      ├── Node SEA module loader activates (NOT pkg's bootstrap CJS shim)
      ├── Loads dist/index.js (ESM)
      │   └── Loads dist/server.js (ESM, fallback-to-source)
      │       ├── import "@modelcontextprotocol/sdk/server/index.js"
      │       │   → SEA loader resolves via snapshot → SUCCEEDS [VERIFIED: option-a test]
      │       ├── import "@modelcontextprotocol/sdk/server/stdio.js" → SUCCEEDS
      │       └── import "@modelcontextprotocol/sdk/validation/ajv" → SUCCEEDS
      └── Loads tronweb (via require, CJS condition)
          → "import" condition removed by patch → uses lib/commonjs/index.js → SUCCEEDS [ASSUMED]
```

### Recommended Project Structure Changes

```
patches/
├── @ledgerhq+errors+6.35.0.patch    (existing)
├── @ledgerhq+hw-app-btc+10.22.1.patch (existing)
├── @ledgerhq+psbtv2+0.5.0.patch    (existing)
└── tronweb+6.3.0.patch              ← NEW (Phase 42)
```

```
package.json                          ← modified (pkg.sea=true, tronweb pin)
```

No `src/` changes. No `test/` changes. No `.github/workflows/release.yml` changes (unless CI timeout is a concern).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ESM-in-snapshot module resolution | Custom VFS/loader patches | `pkg.sea = true` | SEA is Node's official mechanism; any hand-rolled loader patch would break on Node upgrades |
| Tronweb ESM interop | Fork tronweb or vendor its CJS files | `patch-package` | Already the project's established approach for node_modules fixes |
| SDK subpath shimming | Create redirect files in node_modules | `pkg.sea` (resolution just works) | Shims would be fragile across SDK versions and break the snapshot VFS |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pkg non-SEA (Phase 10-01 default) | pkg SEA mode | Phase 42 | Binary size +53%; ESM resolution fixed; Node binary embedded directly |
| No tronweb patch | `patches/tronweb+6.3.0.patch` | Phase 42 | Forces CJS entry; fixes bignumber.js named export mismatch |

**Deprecated/outdated:**
- `--fallback-to-source` as the ONLY workaround for `src/server.ts` top-level await: Still needed (SEA still can't V8-bytecode-compile the top-level-await+export combo). Keep the flag.

---

## Validation Architecture

`nyquist_validation: true` in `.planning/config.json` — section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest `^2.1.0` |
| Config file | none (vitest auto-discovers tests) |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIST-40 | `npm run build:binary:linux-x64` produces a binary that runs `--version` (exit 0) | smoke (manual binary exec) | `npm run build:binary:linux-x64 && ./dist-binaries/vaultpilot-mcp --version` | ❌ Wave 0 (new; no existing binary smoke test) |
| DIST-40 | MCP stdio handshake completes without `ERR_MODULE_NOT_FOUND` | smoke (manual) | See verification recipe above | ❌ Wave 0 |
| DIST-40 | FROZEN-area zero-diff | assertion | `git diff origin/main -- src/ \| wc -l` → 0 | ✅ (pattern from Phase 10-01) |
| DIST-40 | Full test suite green after package.json change | regression | `npm test` | ✅ 890 tests exist |

### Sampling Rate

- **Per task commit:** `npm test` (890 tests, ~8s)
- **Per wave merge:** `npm test` + `npm run build:binary:linux-x64` + `./dist-binaries/vaultpilot-mcp --version`
- **Phase gate:** Full test suite green + binary `--version` exit 0 + FROZEN-area zero-diff assertion, all three before `/gsd-verify-work`

### Wave 0 Gaps

The binary smoke test is a build-time + runtime integration test, not a vitest unit test. The vitest suite cannot test pkg binary execution. The executor should:

1. Run `npm run build:binary:linux-x64` manually during the wave
2. Execute `./dist-binaries/vaultpilot-mcp --version` and capture exit code + output
3. Execute the MCP stdio handshake (see verification recipe)
4. Document results in SUMMARY.md

This is intentionally a manual smoke test (no Wave 0 file gap to fill in vitest).

---

## Security Domain

`security_enforcement: true` in config — section required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no | Build-tooling phase; no new input surfaces |
| V6 Cryptography | no | No cryptographic changes; FROZEN signing chain unchanged |
| V14 Configuration | yes (marginal) | pkg.sea changes the binary injection mechanism (postject); same-origin Node binary |

### Known Threat Patterns for Binary Distribution

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Supply chain — Node binary source | Tampering | `pkg-fetch` downloads from `nodejs.org/dist` with verified checksum (existing control, unchanged) |
| Supply chain — postject injection | Tampering | Same binary + blob from the same build process; per-asset SHA-256 (existing, Phase 10-01) |
| tronweb patch changing behavior | Tampering | Patch is code-reviewed during PR; removes one exports condition, no logic change |

The SEA mode change does not introduce new attack surface. The binary supply-chain posture is unchanged: per-asset `.sha256` companions + combined `SHA256SUMS.txt` (Phase 10-01) remain the baseline. Binary signing (Apple Developer cert / Authenticode) remains deferred to v1.5+ (existing accepted residual).

**SECURITY.md change:** Executor should assess whether the SEA mode warrants a note in the existing `## v1.4 Residual Risks (Distribution)` supply-chain row. Judgment call; likely a one-line addendum: "Binary uses Node SEA injection (postject); Node binary sourced from nodejs.org/dist with pkg-fetch checksum verification."

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | SEA mode + tronweb patch resolves all runtime errors, producing a working `--version` and MCP stdio startup | Recommended Fix; Empirical Mandate | If wrong: other packages have similar ESM interop failures; executor must identify and patch them one-by-one using the same pattern |
| A2 | No other production dependency has a CJS/ESM named-export mismatch like tronweb/bignumber | Pitfall 1; Security Domain | If wrong: additional `patches/*.patch` files needed; each follows the same pattern |
| A3 | `tronweb@6.3.0` CJS build is functionally equivalent to the ESM build for all use cases in this codebase | Change 2 description | If wrong: TRON features may behave differently; needs a TRON-functional integration test (already in the codebase via Phase 17-21) |
| A4 | `pkg-fetch` caches the downloaded Node binary between CI runs (reducing SEA build time to ~same as non-SEA on repeat runs) | Pitfall 2 | If wrong: every CI release build adds ~2 min download; acceptable for v1.4; consider adding `actions/cache` for the pkg-fetch cache dir |

---

## Open Questions

1. **Are there other ESM/CJS interop failures after tronweb is patched?**
   - What we know: Checked major deps (@walletconnect, viem, bitcoinjs-lib, @solana, @ledgerhq); no obvious bignumber-pattern failures.
   - What's unclear: Packages not directly inspected may have similar issues.
   - Recommendation: Run the full smoke test. If new errors appear, apply additional patches using the same pattern.

2. **Does the SEA build work cross-platform (macOS-arm64, Windows-x64)?**
   - What we know: Tested linux-x64 empirically. Cross-compile uses the same SEA injection mechanism via pkg-fetch per-target Node binaries.
   - What's unclear: Platform-specific module loading behavior may differ.
   - Recommendation: Run `npm run build:binary:macos-arm64` + `npm run build:binary:windows-x64` in the release workflow and verify the binaries in the CI log. The existing release.yml will exercise all 4 targets.

3. **Should `tronweb` be pinned to exactly `6.3.0` or use `^6.3.0` with a note?**
   - What we know: patch-package version matching requires the installed version to match the patch filename.
   - Recommendation: Pin to `6.3.0` (exact) in package.json. Small but necessary.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@yao-pkg/pkg` | Binary build | ✓ | 6.19.0 | — |
| `patch-package` | tronweb patch | ✓ | 8.x (in devDeps) | — |
| Node.js | Build + test | ✓ | 22.22.2 | — |
| `nodejs.org/dist` CDN | SEA build (Node binary download) | ✓ (internet-connected) | 22.22.3 fetched | pkg-fetch local cache on repeat runs |
| `npm test` / vitest | Regression testing | ✓ | vitest ^2.1.0 | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

---

## Sources

### Primary (HIGH confidence)
- `node_modules/@yao-pkg/pkg/lib-es5/resolver.js` — read directly [VERIFIED: source read]; confirms `resolve.exports` used at build time; CJS target files bundled correctly
- `node_modules/@yao-pkg/pkg/prelude/bootstrap.js` — read directly [VERIFIED: source read]; confirms ESM loader NOT patched ("// TODO esm modules along with cjs" comment; Module._resolveFilename only patches CJS path)
- `node_modules/@modelcontextprotocol/sdk/package.json` — read directly [VERIFIED: node -e read]; exports map confirmed; no "main" field confirmed
- Empirical binary builds and runtime tests:
  - Baseline: `npm run build:binary:linux-x64` + `./dist-binaries/vaultpilot-mcp --version` [VERIFIED: built+ran — exit 1, ERR_MODULE_NOT_FOUND]
  - Option (a): `pkg.sea=true` + same build + run [VERIFIED: built+ran — exit 1, tronweb/bignumber.js SyntaxError]
  - Option (c): `pkg.assets` glob + same build + run [VERIFIED: built+ran — exit 1, same ERR_MODULE_NOT_FOUND]
- `node_modules/tronweb/package.json` + `node_modules/tronweb/lib/esm/index.js` — read directly [VERIFIED]; confirms ESM entry imports `{ BigNumber }` from bignumber.js
- `node_modules/bignumber.js/package.json` — read directly [VERIFIED]; ESM entry `bignumber.mjs` has only default export (no named `BigNumber`)
- Existing `patches/` directory with `@ledgerhq+*.patch` files [VERIFIED: ls patches/]
- `package.json` `"postinstall": "patch-package"` [VERIFIED: read package.json]
- Node.js ESM error stack: `"at Object.getPackageJSONURL (node:internal/modules/package_json_reader:317:9)"` — confirms C++ binding is the resolution mechanism, not user-space fs

### Secondary (MEDIUM confidence)
- `@yao-pkg/pkg` types.d.ts `PkgOptions.sea?: boolean` — confirms the option exists in the pkg config
- Phase 10-01 SUMMARY.md — documents the deferred regression + recovery options + Phase 10 smoke test results
- `resolve.exports` behavior confirmed via `node -e` test [VERIFIED: ran] — CJS target paths resolved correctly at build time

### Tertiary (LOW confidence)
- Assessment that SEA mode's Node module loader properly handles the snapshot for ESM imports — inferred from the empirical SEA test passing the SDK import and failing only at tronweb. Direct confirmation would require the tronweb patch + re-run which was blocked.

---

## Metadata

**Confidence breakdown:**
- Root cause: HIGH — empirically confirmed; bootstrap.js source read confirms ESM loader not patched; runtime error stack confirms C++ native binding is the mechanism
- Option (a) verdict: HIGH — empirically built+ran; SDK error gone, tronweb error confirmed
- Option (c) verdict: HIGH — empirically built+ran; same error as baseline
- Recommended fix (SEA + tronweb patch): MEDIUM — SDK fix confirmed by option (a) test; tronweb patch is a logical extrapolation of the established patch-package pattern; not fully run due to auto-mode restriction on node_modules edit
- Other packages after tronweb: LOW — checked major deps, no obvious issues, but not exhaustively tested

**Research date:** 2026-05-29
**Valid until:** 2026-06-28 (30 days; `@modelcontextprotocol/sdk` and `@yao-pkg/pkg` versions could update; re-verify if either is upgraded before Phase 42 executes)
