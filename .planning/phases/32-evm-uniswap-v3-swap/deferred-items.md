## Deferred Items — Phase 32 Plan 32-01

### Pre-existing flake (NOT caused by Phase 32 changes)

**test/non-evm-store.eager-init.test.ts > order-of-operations regression** — 10s timeout in full-suite run. Passes in isolation (`npx vitest run test/non-evm-store.eager-init.test.ts` → 9/9 green in 3.8s). Confirmed pre-existing — appeared identically on `git stash` baseline (Task 1 commit). Unrelated to Uniswap V3 / SOT / dispatch work. Race condition under concurrent load. Triage anchor: this same test runs green in CI on main per latest commit log. Out of scope for Phase 32.

