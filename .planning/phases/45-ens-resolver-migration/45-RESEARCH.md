# Phase 45 — Research

Tags: `[SOURCE]` cited file/line or external doc. `[CONF: H/M/L]` confidence.

## 1. The two shim importers — corrected against the code

`grep -rn 'from "../chains/ethereum' src/` → exactly two RUNTIME importers,
both pulling the SAME symbol `getEthereumClient`:

```
src/ens/resolver.ts:4            import { getEthereumClient } from "../chains/ethereum.js";
src/tools/send_transaction.ts:58 import { getEthereumClient } from "../chains/ethereum.js";
```
[SOURCE: grep over src/ — 2 hits] [CONF: H]

`src/chains/ethereum.ts` exports: `PUBLICNODE_ETHEREUM_RPC_URL`,
`getEthereumClient()`, `isPublicNodeFallback()`,
`_resetEthereumClientForTesting()`. **There is NO `getEthereumChainId`
export.** The shim is already a thin delegate — `getEthereumClient()`
returns `getChainClient(1)`.
[SOURCE: src/chains/ethereum.ts:35-47] [CONF: H]

> Correction to the phase brief: the brief assumed the importers pull
> DIFFERENT symbols and that send_transaction imports `getEthereumChainId`.
> Neither is true. Both pull `getEthereumClient`; no `getEthereumChainId`
> exists anywhere. The plan is built on the code, not the brief.
[CONF: H]

## 2. The FROZEN boundary — whole-file zero-diff, not a marked region

`src/tools/send_transaction.ts` has NO `// BEGIN/END FROZEN` text markers.
The freeze is a CI/acceptance gate inherited from Phase 37 / 41 / 42:

- Phase 42 plan frontmatter: "git diff origin/main --
  src/tools/send_transaction.ts must show ZERO diff (FROZEN: 3-gate region
  + EVM arm + WC routing + DEMO-05)"; "Phase 42 mandates ZERO diff on
  send_transaction.ts (its 3-gate region is byte-frozen)".
[SOURCE: .planning/phases/42-.../42-01-PLAN.md:28-32] [CONF: H]
- The in-file comments describe the conceptual frozen surface: the three
  gates (lines ~271-436), the "EVM branch (FROZEN — DEMO-05 + WC routing
  unchanged)" (line 470), and the additive-arms-only invariant
  (lines 253-258, Phase 37).
[SOURCE: src/tools/send_transaction.ts:253-258, 438-470] [CONF: H]

The shim symbol `getEthereumClient` is consumed at line 503
(`const client = getEthereumClient();`) inside the demo-mode EVM branch —
squarely inside the FROZEN EVM arm.
[SOURCE: src/tools/send_transaction.ts:503] [CONF: H]

**Conclusion (the core finding):** the import on line 58 lives in the
SAME file that Phase 42 froze to a whole-file zero-diff. Unlike the
brief's assumption, there is no "above the marker, therefore free" zone —
the entire file is the frozen unit. Editing line 58 ⇒ non-empty
`git diff origin/main -- src/tools/send_transaction.ts` ⇒ breaks the
established gate. Therefore send_transaction's importer CANNOT be removed
without an explicit unfreeze + re-anchor of that file, which is a
deliberate security-review event out of this phase's scope.
[CONF: H]

## 3. The registry replacement symbol

`src/chains/registry.ts` exports `getChainClient(chainId: ChainId): PublicClient`
(memoised per-chain). It does NOT export `getMainnetClient` or
`MAINNET_CHAIN_ID`. The mainnet client is `getChainClient(1)` — exactly
what the shim's `getEthereumClient()` already returns.
[SOURCE: grep `getMainnetClient\|MAINNET_CHAIN_ID` over registry.ts → no
match; src/chains/registry.ts:287 `export function getChainClient`;
src/chains/ethereum.ts:37-39] [CONF: H]

> Correction to the phase brief: the brief named `getMainnetClient()` as
> the registry drop-in. That function does not exist. Use
> `getChainClient(1)`.
[CONF: H]

## 4. Resolver migration shape

`src/ens/resolver.ts` calls `getEthereumClient()` at lines 14 and 27, then
`client.getEnsAddress({ name })` / `client.getEnsName({ address })`.
Exports: `resolveEnsName`, `reverseResolveEns`, plus a re-export of
`getEnsName`. Migration:

```ts
import { getChainClient } from "../chains/registry.js";  // was getEthereumClient from chains/ethereum
...
const client = getChainClient(1);                         // both functions (lines 14, 27)
```

ENS calls + `normalize()` + the `getEnsName` re-export unchanged.
[SOURCE: src/ens/resolver.ts:1-33] [CONF: H]

### viem ENS API (re-confirmed)

`getEnsAddress({ name })` (forward) + `getEnsName({ address })` (reverse)
are mainnet-public-client actions; reverse resolution requires a mainnet
client regardless of the active chain. viem 2.51.3.
[SOURCE: 08-RESEARCH.md "ENS API"; viem ENS docs; package grep viem 2.51.3]
[CONF: H]
Note: this repo is a GSD planning skeleton (no `package.json` /
`node_modules` tracked under the worktree), so the ENS API is confirmed
from the Phase 8 research record + viem docs, not a local `.d.ts` probe.
The execution phase runs in the real buildable tree where `tsc` + `vitest`
validate it.
[CONF: H]

## 5. ENS test impact — test already exists

`test/ens-resolver.test.ts` ALREADY exists. It currently mocks the SHIM:

```ts
vi.mock("../src/chains/ethereum.js", () => ({ getEthereumClient: () => client, __setClient: ... }));
import { resolveEnsName, reverseResolveEns } from "../src/ens/resolver.js";
```
It has two cases: forward (`resolveEnsName("vitalik.eth")` →
`getEnsAddress({ name })`) and reverse (`reverseResolveEns(addr)` →
`getEnsName({ address })`).
[SOURCE: test/ens-resolver.test.ts] [CONF: H]

> Correction to the brief: there IS an existing ENS test; the plan
> MIGRATES it (re-point the mock at the registry / `getChainClient`),
> rather than adding a new one. Note the test currently asserts
> `getEnsAddress` is called with the RAW name `"vitalik.eth"`, while the
> resolver passes `normalize(name)`; for `vitalik.eth` these are equal, so
> the assertion holds. Preserve that behaviour on migration.
[CONF: H]

`send_transaction` tests (`test/send-transaction.test.ts` etc.) keep
passing untouched — the file is not modified, so the demo-mode EVM branch
still resolves `getEthereumClient()` through the (kept) shim.
[SOURCE: src/tools/send_transaction.ts unchanged] [CONF: H]

`test/chains-ethereum.test.ts` exercises the shim's `getEthereumClient`
directly — it MUST keep passing (the shim is kept), so no churn there.
[SOURCE: test/chains-ethereum.test.ts:6,45-84] [CONF: H]

## 6. Pitfalls

1. **Touching `send_transaction.ts`.** The single biggest risk. The brief
   invites an import-line edit; the Phase-42 whole-file zero-diff forbids
   it. Do NOT touch the file. [CONF: H]
2. **Assuming `getMainnetClient` exists.** It doesn't — use
   `getChainClient(1)`. [CONF: H]
3. **Deleting the shim.** It still has 1 importer (FROZEN send_transaction)
   + a direct test. Deleting it breaks the build AND
   `test/chains-ethereum.test.ts`. Do NOT delete this phase. [CONF: H]
4. **Re-writing the existing ENS test from scratch.** Migrate the mock
   seam in place; keep both existing assertions. [CONF: H]
5. **Dropping the `normalize()` call or the `null`-mapping.** Behaviour
   must be preserved exactly. [CONF: H]

## Validation Architecture

Measure of success: **the ENS resolver no longer depends on the shim, ENS
still resolves both directions, and the FROZEN signing file is provably
untouched.** Three independent falsifiable checks, none self-reported:

### V1 — FROZEN zero-diff on send_transaction.ts (primary safety oracle)
- `git diff origin/main -- src/tools/send_transaction.ts` is EMPTY.
  (Same gate Phase 42 used; this phase must not regress it.)
- Falsifier: ANY diff hunk on that file → fail. Source of truth =
  `origin/main` baseline; comparand = the working file (file-side drift
  away from the frozen baseline).

### V2 — ENS forward + reverse resolution still works
- Migrated `test/ens-resolver.test.ts` passes against a mocked REGISTRY
  client: `resolveEnsName("vitalik.eth")` returns the stubbed address and
  calls `getEnsAddress({ name })`; `reverseResolveEns(addr)` returns the
  stubbed name and calls `getEnsName({ address })`.
- Falsifier: resolver wired to a non-mainnet client (`getChainClient(n≠1)`),
  or the mock still pointing at the shim, or a dropped assertion → fail.

### V3 — resolver no longer imports the shim; build clean
- `grep -rn 'chains/ethereum' src/ens/` → zero hits.
- `grep -rn 'chains/ethereum' src/` → exactly ONE hit
  (`src/tools/send_transaction.ts:58`) — the FROZEN importer, intentionally
  retained.
- `grep -rn 'chains/ethereum' test/ens-resolver.test.ts` → zero hits
  (migrated to the registry mock).
- `tsc --noEmit` clean; full `vitest` run green.
- Falsifier: resolver still references the shim path, OR the shim's
  importer count drops to 0 unexpectedly (would mean send_transaction was
  touched — cross-checks V1), OR a dangling import. 

### Overlapping-detector note (CLAUDE.md discipline)
- V1 (`git diff` zero-diff): checks the FROZEN FILE against the
  `origin/main` baseline (direction: file-side drift). Pre-existing gate
  class (Phase 37/41/42).
- V3 grep: checks the SHIM MODULE PATH's importer set (direction:
  consumer-side; asserts the resolver left AND the FROZEN importer stayed).
  Distinct axis — one guards signing-file bytes, the other guards which
  modules still reference the shim. No overlap.
