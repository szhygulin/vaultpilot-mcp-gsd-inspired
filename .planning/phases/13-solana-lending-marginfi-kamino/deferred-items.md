# Deferred items — Phase 13 (Kamino batch 13-04/05/06)

## Pre-existing full-suite parallel-load timeout flake (OUT OF SCOPE)

**Discovered during:** 13-06 phase-final full-suite gate.

**Symptom:** `npx vitest run --no-coverage` fails with exactly ONE test timing out
at the default 10s `testTimeout`, but the failing test is **non-deterministic**
across runs:
- Run 1: `test/verify-tx-decode.test.ts` (Phase 9 register-all wire-check)
- Run 2: `test/get-btc-status.test.ts` (Phase 22 register-all wire-check)

**Root cause:** Several `register-all` wire-check assertions across phases import the
full tool module graph and individually run 7–9s (verify-tx-decode 9.0s,
get_tx_verification 7.7s, prepare_eigenlayer_deposit 7.2s under load). The global
`testTimeout` is 10_000ms (`vitest.config.ts`). Under saturated parallel
collection (~394 test files, aggregate collect ~2270s), one of these
already-slow import assertions randomly tips past 10s. The machine is CPU/IO
saturated during collection, not the test logic.

**Evidence it is NOT a Kamino defect:**
- Each affected file passes in isolation (verify-tx-decode 3.8s, get-btc-status
  within budget; both green when run alone).
- The Kamino additions add ~5ms to the register-all import graph (measured:
  kamino protocol import 1ms, kamino chain/klend-codegen import 4ms).
- All Kamino test files pass under BOTH the default mode AND `VAULTPILOT_DEMO=true`.
- The failing files are Phase 9 / Phase 22 / EigenLayer wire-checks, unrelated to
  Solana Kamino lending.

**Why deferred (SCOPE BOUNDARY):** These are pre-existing register-all wire-check
assertions on a global 10s timeout that pre-dates this batch (e.g.
`get-btc-status.test.ts` is from #123, on main). Raising their per-test timeout or
restructuring the harness's parallel-collection budget is a cross-phase harness
change, not Kamino work. Touching Phase 9/22 test files violates the executor
scope boundary.

**Suggested fix (separate maintenance PR):** Either bump `testTimeout` for the
`register-all wiring` assertion family (they legitimately import the whole graph),
or split the cold register-all import into a shared `beforeAll` so the cost is
paid once per file rather than inside a 10s-bounded `it`.
