---
phase: 45
plan: 01
subsystem: ens
tags: [ens, resolver, compat-shim, chains-registry, getChainClient, frozen-send-transaction, surgical-migration]
requires: [chains-registry, ens-resolver]
provides: [ens-resolver-on-registry]
affects:
  - src/ens/resolver.ts
  - test/ens-resolver.test.ts
tech-stack:
  added: []
  patterns: [importOriginal-spread-mock, frozen-file-zero-diff-gate, surgical-import-swap]
key-files:
  created:
    - .planning/phases/45-ens-resolver-migration/45-01-SUMMARY.md
  modified:
    - src/ens/resolver.ts
    - test/ens-resolver.test.ts
decisions:
  - D-01: Option (b-minimal) — migrate the ENS resolver only; KEEP src/chains/ethereum.ts (the compat shim) for its one remaining FROZEN importer
  - D-02: resolver imports getChainClient from ../chains/registry.js; both call sites use getChainClient(1) (mainnet); getEthereumClient retired from the resolver
  - D-03: send_transaction.ts NOT touched — whole-file zero-diff vs origin/main is a first-class success criterion (Phase 42 freeze, importer at line 58)
  - D-04: full shim deletion (DB-2 literal goal) deferred to a future unfreeze + re-anchor of send_transaction.ts; this phase removes ONE of the shim's two importers
  - D-05: ENS test mock retargeted to the registry via importOriginal + spread (overriding only getChainClient; all other registry exports stay real so the register-all tool graph is unperturbed)
requirements-completed: [DB-2 (partial — one of two shim importers removed)]
metrics:
  duration: "surgical two-file migration"
  completed: "2026-06-01"
---

# Phase 45 Plan 01: ENS resolver migration off the compat-shim Summary

Migrates `src/ens/resolver.ts` off the legacy `chains/ethereum.ts` compat shim onto the multi-chain registry — `getEthereumClient()` → `getChainClient(1)` — and retargets `test/ens-resolver.test.ts` to mock the registry. The shim is **retained** (Option b-minimal): the FROZEN `send_transaction.ts:58` still imports `getEthereumClient`, so full shim deletion (DB-2's literal goal) is deferred to a future unfreeze + re-anchor phase. This phase removes one of the shim's two importers; ENS forward/reverse resolution is behaviourally identical; the FROZEN signing file is provably untouched.

## Tasks Completed

Shipped as PR #174, squash commit `f5d848e`. Diff: `src/ens/resolver.ts` (+3/-3), `test/ens-resolver.test.ts` (+11/-5) — 2 files, 14 insertions, 8 deletions.

| Task | Name | Where |
| ---- | ---- | ----- |
| 45-01-1 | Migrate the ENS resolver onto the registry | `src/ens/resolver.ts` |
| 45-01-2 | Migrate the existing ENS test to mock the registry | `test/ens-resolver.test.ts` |
| 45-01-3 | Prove the FROZEN file is untouched + shim still has its one importer (verification-only) | gates |

## What Was Built

- **`src/ens/resolver.ts`:** replaced `import { getEthereumClient } from "../chains/ethereum.js"` with `import { getChainClient } from "../chains/registry.js"`; both call sites (`resolveEnsName`, `reverseResolveEns`) now use `getChainClient(1)`. The `normalize(name)` call, the `getEnsAddress` / `getEnsName` calls, the `null` return contract, and the `getEnsName` re-export are unchanged. `getChainClient(1)` is exactly what the shim's `getEthereumClient()` already delegated to, so ENS reads still hit mainnet.
- **`test/ens-resolver.test.ts`:** the mock was retargeted from `vi.mock("../src/chains/ethereum.js")` (`getEthereumClient`) to `vi.mock("../src/chains/registry.js")` via `importOriginal` + spread, overriding **only** `getChainClient` to return the stub client. Keeping all other registry exports real means the `register-all` tool graph (which imports the registry transitively) is unperturbed. Both cases preserved: forward → `getEnsAddress({ name })`; reverse → `getEnsName({ address })`. For `vitalik.eth`, `normalize` is identity, so the `{ name: "vitalik.eth" }` assertion still holds.

## Decision — Option (b-minimal), and the residual

DB-2's literal goal is "delete `src/chains/ethereum.ts`." That cannot be done this phase without violating the Phase-42 **whole-file** zero-diff freeze on `send_transaction.ts` — its last remaining importer (line 58, consumed at line 503 inside the demo-mode EVM branch). The freeze is whole-file, not region-scoped: there is no "above the marker, therefore free" zone, so the import line cannot be edited here. Editing it would require an explicit unfreeze + re-anchor of the byte-frozen signing-path file, which is a security-review event, not a dependency cleanup.

**Outcome:** this phase removes the ENS resolver as an importer and leaves the shim in place for the FROZEN one. The shim is already a one-line delegate to `getChainClient(1)` — it carries no implementation to delete. **Residual:** the shim survives with exactly 1 importer; its deletion is re-scoped to a future "unfreeze + re-anchor `send_transaction.ts`" phase (re-point the import, take a fresh zero-diff baseline, then delete the shim + `test/chains-ethereum.test.ts`). Documented in ROADMAP DB-2.

Alternatives weighed and rejected (CONTEXT §design fork): (a) edit only `send_transaction`'s import line — rejected, the zero-diff gate is whole-file; (c) delete the shim + re-anchor `send_transaction`'s import in the same phase — the architecturally "real" full-DB-2 completion, but it couples a trivial cleanup to a deliberate edit of the byte-frozen signing file, exactly the coupling the freeze exists to prevent. Recommended only as its own human-ratified phase.

## Brief Corrections (baked into the plan, confirmed against the code)

The originating brief carried three factual errors that RESEARCH corrected against the actual code:

- Both shim importers pull the **same** symbol `getEthereumClient` (the brief assumed different symbols). There is no `getEthereumChainId` export anywhere.
- The registry drop-in is `getChainClient(1)` — the brief named a nonexistent `getMainnetClient()`.
- `test/ens-resolver.test.ts` already existed; the plan **migrated** it rather than adding a new one.

## Validation Result

- **V1 — FROZEN zero-diff:** `git diff origin/main -- src/tools/send_transaction.ts` is EMPTY (primary safety oracle; same gate class as Phase 37/41/42).
- **V2 — ENS forward + reverse:** the migrated `test/ens-resolver.test.ts` passes against the mocked registry client — `resolveEnsName("vitalik.eth")` returns the stubbed address and calls `getEnsAddress({ name })`; `reverseResolveEns(addr)` returns the stubbed name and calls `getEnsName({ address })`.
- **V3 — resolver no longer imports the shim:** `grep -rn 'chains/ethereum' src/ens/` → zero hits; `grep -rn 'chains/ethereum' src/` → exactly ONE hit (`src/tools/send_transaction.ts:58`, the intentionally-retained FROZEN importer); `grep -rn 'chains/ethereum' test/ens-resolver.test.ts` → zero hits. `tsc --noEmit` clean; full `vitest` green (including the unchanged `test/chains-ethereum.test.ts` exercising the kept shim directly, and `test/send-transaction*.test.ts`).

## FROZEN Zero-Diff Gate

`git diff origin/main -- src/tools/send_transaction.ts` → **EMPTY.** The FROZEN signing file is byte-identical to `origin/main`. `src/chains/ethereum.ts` is KEPT (not deleted); the shim's runtime importer count is reduced from 2 to exactly 1.

## Self-Check: PASSED

- Squash commit `f5d848e` present on `main` (`feat(45): ENS resolver migration off compat-shim → getChainClient(1) (#174)`).
- Resolver imports `getChainClient` from the registry; both call sites use `getChainClient(1)`.
- `send_transaction.ts` whole-file zero-diff held.
- Shim retained with its single FROZEN importer; DB-2 partially advanced (full deletion deferred + documented).

---
*Phase: 45-ens-resolver-migration*
*Completed: 2026-06-01*
