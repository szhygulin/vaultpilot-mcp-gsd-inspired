---
phase: 42-v1-4-1-pkg-esm-sdk-subpath-exports-fix
plan: 01
subsystem: infra
tags: [pkg, sea, binary-distribution, patch-package, tronweb, node-hid, esm, cjs]

# Dependency graph
requires:
  - phase: 10-01
    provides: "@yao-pkg/pkg binary build pipeline for all 4 platforms + per-asset SHA-256 sums"
provides:
  - "linux-x64 binary that starts and completes MCP stdio initialize handshake without ERR_MODULE_NOT_FOUND"
  - "pkg.sea=true in package.json enabling Node native SEA module loader for ESM subpath resolution"
  - "patches/tronweb+6.3.0.patch removing ESM import condition, forcing CJS entry"
  - "npm override rpc-websockets->uuid@8.3.2 to eliminate pure-ESM uuid@14 in snapshot"
  - "pkg scripts glob patterns for multiformats/uint8arrays/ledgerhq CJS files not auto-walked"
  - "pkg assets for usb/node-hid native .node prebuilds for SEA dlopen extraction"
  - "SECURITY.md supply-chain row addendum noting postject SEA injection posture"
affects: [release, v1.4.0-ga, binary-distribution, ledger-transport]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "pkg SEA mode: use sea=true in package.json pkg block; no CLI flag change needed"
    - "pkg scripts glob for CJS deps not auto-walked: add node_modules/<pkg>/cjs/**/*.js to pkg.scripts"
    - "pkg assets for native .node prebuilds: add node_modules/<pkg>/prebuilds/** to pkg.assets for SEA dlopen extraction"
    - "npm nested overrides for transitive ESM-only deps: overrides.<parent>.dep = version"
    - "patch-package for CJS-forcing: edit node_modules/<pkg>/package.json to remove 'import' condition, run npx patch-package <pkg> --exclude '' (default excludes package.json — use --exclude '' to allow it; or create patch manually via git diff in temp repo)"

key-files:
  created:
    - patches/tronweb+6.3.0.patch
    - .planning/phases/42-v1-4-1-pkg-esm-sdk-subpath-exports-fix/42-01-SUMMARY.md
  modified:
    - package.json
    - package-lock.json
    - SECURITY.md

key-decisions:
  - "pkg.sea=true is the correct fix for @modelcontextprotocol/sdk ESM subpath resolution in binaries (option a confirmed; option b FROZEN-rejected; option c assets-glob proven-fail)"
  - "tronweb patch: patch-package default excludes package.json in CREATION phase (--exclude pattern); create patch manually via git diff in temp repo instead"
  - "rpc-websockets/uuid@14 (pure ESM, no CJS build): fix via npm nested override rpc-websockets.uuid=8.3.2, NOT patch-package (no CJS build to force)"
  - "multiformats/uint8arrays/@ledgerhq CJS snapshot gaps: add pkg.scripts glob patterns for the specific CJS directories pkg's walker misses"
  - "usb/node-hid native .node prebuilds: add to pkg.assets; pkg SEA bootstrap patches process.dlopen to extract .node from snapshot to ~/.cache/pkg/<hash>/"
  - "SECURITY.md supply-chain row: one-line addendum appended (judgment: material, postject adds an explicit build step worth noting)"

patterns-established:
  - "Pattern: native .node addons in SEA mode require prebuilds/** in pkg.assets for dlopen extraction"
  - "Pattern: patch-package create MUST use --exclude '' or manual git-diff method to include package.json in patch"

requirements-completed: [DIST-40]

# Metrics
duration: ~120min
completed: 2026-05-29
---

# Phase 42 Plan 01: pkg ESM SDK Subpath-Exports Runtime Fix Summary

**linux-x64 binary now starts and completes MCP stdio `initialize` handshake without any `ERR_MODULE_NOT_FOUND` error: pkg.sea=true + tronweb CJS patch + 4 iterative interop fixes across 5 dependency chains**

## Performance

- **Duration:** ~120 min
- **Started:** 2026-05-29T08:42:00Z
- **Completed:** 2026-05-29T12:25:00Z
- **Tasks:** 5 (Tasks 1-5 all executed; Task 4 was active — iterative interop contingency applied)
- **Files modified:** 4 (package.json, package-lock.json, patches/tronweb+6.3.0.patch, SECURITY.md)

## Accomplishments

- `pkg.sea=true` added to `package.json` pkg block: enables Node SEA module loader which resolves `@modelcontextprotocol/sdk` ESM subpath exports at runtime (root cause per RESEARCH — pkg bootstrap does NOT patch Node's ESM C++ binding; SEA uses the native loader which handles snapshot correctly)
- `patches/tronweb+6.3.0.patch` created: removes `"import": "./lib/esm/index.js"` from tronweb exports["."], adds `"default": "./lib/commonjs/index.js"` as safety net — fixes bignumber.js named-export mismatch in tronweb's ESM build
- Binary smoke test PASSED: `./dist-binaries/vaultpilot-mcp --version` exits 0, prints `0.0.0`; MCP stdio `initialize` returns clean JSON-RPC with full server capabilities
- FROZEN cryptographic-binding chain zero-diff confirmed: `git diff origin/main -- src/ | wc -l` = 0

## Binary Smoke Output (empirical mandate)

### `--version` test
```
bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)
0.0.0
EXIT CODE: 0
```
(The `bigint: Failed to load bindings` message is from tiny-secp256k1 graceful fallback to pure JS — expected, non-blocking)

### MCP stdio `initialize` handshake
```json
{"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"vaultpilot-mcp","version":"0.0.0"},"instructions":"VaultPilot MCP is a self-custodial DeFi tool for AI agents: read tools surface on-chain positions, prices, and metadata; prepare/preview/send tools author unsigned Ethereum transactions for the user to sign on a Ledger hardware wallet via WalletConnect. The trust anchor is the Ledger screen — every byte the device signs is cryptographically bound across the agent → MCP → transport → device chain via `payloadFingerprint` (PREP-03), `LEDGER BLIND-SIGN HASH` (PREP-04), `PREPARE RECEIPT` (PREP-02), `previewToken` + `userDecision` gates (PREP-07/08). Demo mode: a brand-new install (no config + no env) boots into demo with curated personas; read tools work against real RPC, signing tools simulate via eth_call. Use `set_demo_wallet` to switch personas; `get_vaultpilot_config_status` to inspect state. See ./SECURITY.md for the full threat model, the prepare → preview → send pipeline invariants, and the documented residual risks (compromised-MCP threat closed in v1.3 via companion `vaultpilot-preflight` skill). vaultpilot-preflight skill v1.4 expected SHA-256: 8eb8ba90fb4c7a21ac5579a4533d9221cc136b8d188b0daa6b652b5743da9a4f (install: git clone https://github.com/szhygulin/vaultpilot-preflight-skill ~/.claude/skills/vaultpilot-preflight && cd ~/.claude/skills/vaultpilot-preflight && git checkout v1.4)."},"jsonrpc":"2.0","id":1}
```
No `ERR_MODULE_NOT_FOUND`. No `does not provide an export named`. Full server capabilities returned. **HANDSHAKE_OK.**

## Task Commits

1. **Task 1: pkg.sea=true + tronweb pin** - `57dfa0a` (chore)
2. **Task 2: patches/tronweb+6.3.0.patch** - `80ac949` (feat)
3. **Task 3: Binary smoke — build + run** - (no separate commit; smoke output captured here; control passed to Task 4 due to interop failures)
4. **Task 4: Iterative interop fixes** - `a5ea042` (fix)
5. **Task 5: SECURITY.md + FROZEN gate** - `b88b918` (docs)

## Files Created/Modified

- `package.json` — added `"sea": true` to pkg block; pinned tronweb to `6.3.0`; added npm override `rpc-websockets.uuid=8.3.2`; added 5 pkg.scripts glob patterns for CJS deps; added 3 pkg.assets patterns for native .node prebuilds
- `package-lock.json` — updated by npm install after tronweb pin + rpc-websockets/uuid override
- `patches/tronweb+6.3.0.patch` — NEW: removes `"import"` ESM condition from tronweb exports["."]
- `SECURITY.md` — one-line addendum to supply-chain row noting SEA postject injection posture

## SECURITY.md Decision

**Applied one-line addendum** to the existing `## v1.4 Residual Risks (Distribution)` supply-chain row's Mitigation Path cell:

> "Binary uses Node SEA injection via postject (v1.4.1+); the Node binary is sourced from nodejs.org/dist with pkg-fetch checksum verification — same supply-chain posture as Phase 10-01, no new attack surface."

Rationale: The postject SEA injection is a new build step introduced in v1.4.1. While it does not introduce new attack surface (same Node binary origin, same pkg-fetch checksum controls), the explicit documentation is material for users reviewing the security posture. RESEARCH called this a judgment call; applied as a one-line note per RESEARCH guidance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] patch-package default excludes package.json during patch CREATION**
- **Found during:** Task 2 (Create tronweb CJS-forcing patch)
- **Issue:** `npx patch-package tronweb` reported "no changes" because patch-package's default `excludePaths` is `/^package\.json$/` — it strips `package.json` from both the clean comparison version and the modified version before diffing, resulting in a false "no changes" verdict even when the file was edited.
- **Fix:** Created the patch manually using `git diff` in a temp git repo with the clean tronweb@6.3.0 committed, then our modification applied. The patch content is equivalent to what patch-package would have generated. Verified that `npm ci` correctly applies the patch (`tronweb@6.3.0 ✔` in patch-package output) and that exports["."] no longer has the `"import"` condition after apply.
- **Files modified:** `patches/tronweb+6.3.0.patch`
- **Committed in:** `80ac949` (Task 2 commit)

**2. [Rule 3 - Blocking] Task 4 iterative interop contingency triggered — 4 additional dep failures beyond tronweb**

The binary smoke (Task 3) surfaced 4 additional interop failures after tronweb was fixed. Each was within the ~3 dep bound (treated as one batch): 

| # | Dep | Error Type | Fix Applied |
|---|-----|-----------|-------------|
| 1 | rpc-websockets / uuid@14.0.0 | Pure ESM package (type:module), no CJS build; rpc-websockets does require('uuid') which loads uuid@14 as ESM via Node 22's require(esm); ESM static imports of ./max.js etc. cause ERR_VM_MODULE_LINK_FAILURE in snapshot | npm nested override: `overrides["rpc-websockets"] = {"uuid": "8.3.2"}` forces uuid@8.3.2 (has proper CJS "require" condition) |
| 2 | multiformats/uint8arrays | CJS wrapper file (multiformats/basics) requires './cjs/src/basics.js' but pkg's walker didn't bundle the target; relative CJS require from snapshot file fails | Added `node_modules/multiformats/cjs/src/**/*.js` and `node_modules/uint8arrays/cjs/src/**/*.js` to pkg.scripts |
| 3 | @ledgerhq/devices, @ledgerhq/hw-transport, @ledgerhq/errors | Same pattern as multiformats: glob exports (./lib/*) resolved in snapshot but target lib files not bundled | Added lib/**/*.js for each @ledgerhq package to pkg.scripts |
| 4 | usb + node-hid native .node prebuilds | node-gyp-build uses fs.readdirSync (patched by pkg SEA bootstrap) to find .node prebuilds; prebuilds exist in node_modules but not in pkg snapshot assets; pkg SEA dlopen extractor can handle them if present in assets | Added `node_modules/usb/prebuilds/**`, `node_modules/@serialport/bindings-cpp/prebuilds/**`, `node_modules/node-hid/build/**` to pkg.assets |

- **Files modified:** `package.json` (pkg.scripts, pkg.assets, overrides), `package-lock.json`
- **Committed in:** `a5ea042` (Task 4 commit)
- **Note:** The RESEARCH's "HIGH confidence" assessment for the recommended fix was optimistic. The research tested option (a) SEA-only and stopped at the tronweb/bignumber error, not seeing the deeper chain. The full fix required more steps than anticipated but all within scope (no src/ touches, no architectural changes).

---

**Total deviations:** 2 (1 Rule 1 bug in patch-package workflow; 1 Rule 3 blocking multi-dep interop chain)
**Impact on plan:** All fixes necessary. No scope creep. FROZEN constraint maintained throughout.

## FROZEN Zero-Diff Gate

```
git diff origin/main -- src/ | wc -l
0
```

**FROZEN cryptographic-binding chain: BYTE-IDENTICAL to origin/main.** Zero lines changed in src/.

## v1.4.0 GA Gate Cleared

The `ERR_MODULE_NOT_FOUND` regression that blocked the v1.4.0 GA binary tag is resolved. The linux-x64 binary starts, responds to `--version`, and completes a full MCP stdio `initialize` handshake. Cross-platform binaries (macOS-arm64, windows-x64) remain deferred to HUMAN-UAT / CI per Success Criterion #8 — not a code-completion blocker.

## Issues Encountered

- **patch-package excludes package.json by default** (see Deviation 1). This is not documented in patch-package README. The correct workaround is manual `git diff` in a temp repo.
- **Test suite has 1-3 pre-existing timeout flaky tests** (`test/non-evm-store.eager-init.test.ts`, `test/get-btc-status.test.ts`, `test/verify-tx-decode.test.ts`) — all files identical to origin/main (0 diff lines), all timeout due to network calls to real APIs (api.safe.global ENOTFOUND). NOT introduced by this phase.
- **typecheck has 3 pre-existing TS errors** in `src/chains/tron/tron-rpc-client.ts` and `src/tools/get_tron_token_balance.ts` — files identical to origin/main. `tsc --noEmit` exits 0 despite reporting these (pre-existing).

## Next Phase Readiness

- Binary distribution (DIST-40) unblocked for v1.4.0 GA tag
- Cross-platform real-binary UAT (macOS-arm64, windows-x64) needed before tagging GA — deferred to human testers
- pkg.scripts CJS bundling pattern documented in SUMMARY for use in future phases if new CJS-gap deps are discovered
- No FROZEN src/ touches — cryptographic-binding chain fully intact

---
*Phase: 42-v1-4-1-pkg-esm-sdk-subpath-exports-fix*
*Completed: 2026-05-29*
