# Phase 45 — Context

ENS-resolver migration + `src/chains/ethereum.ts` compat-shim deletion.
Promoted from Deferred Backlog **DB-2** (deferred Phase 8 / 08-01).

## Boundary

**In scope**
- Migrate `src/ens/resolver.ts` off the legacy compat shim
  (`src/chains/ethereum.ts`) onto the multi-chain registry
  (`src/chains/registry.ts`) — i.e. `getEthereumClient()` → `getChainClient(1)`.
- Migrate the existing `test/ens-resolver.test.ts` to mock the registry
  instead of the shim.
- Keep ENS forward (`resolveEnsName`) and reverse (`reverseResolveEns`)
  resolution behaviourally identical.
- Reduce the shim's runtime importers from 2 to 1 (only the FROZEN
  `send_transaction.ts` remains).

**Out of scope / explicitly NOT done this phase**
- ANY edit to `src/tools/send_transaction.ts`. Phase 42 mandates a
  WHOLE-FILE zero-diff: `git diff origin/main -- src/tools/send_transaction.ts`
  must be EMPTY (FROZEN: 3-gate region + EVM arm + WC routing + DEMO-05).
  That includes the import block — line 58 is inside the frozen file.
- **Deleting `src/chains/ethereum.ts` outright.** See the decision below —
  full deletion is BLOCKED by the FROZEN send_transaction importer and is
  deferred to the phase that re-anchors / unfreezes that file.
- Re-anchoring any cryptographic fixture (`signing-fingerprint.test.ts`
  A–F) or the `payloadFingerprint` / `presignHash` preimages.
- ENS feature work (caching, multi-coin records, CCIP-Read).

## The design fork (RESOLVED) — corrected against the actual code

The task brief assumed the two shim importers pull DIFFERENT symbols (and
that send_transaction imports `getEthereumChainId`). **The code says
otherwise.** Both runtime importers pull the SAME symbol, and the shim has
no `getEthereumChainId` export at all:

| Importer | Symbol imported | Call site |
|----------|-----------------|-----------|
| `src/ens/resolver.ts:4` | `getEthereumClient` | lines 14, 27 (function bodies) |
| `src/tools/send_transaction.ts:58` | `getEthereumClient` | line 503 (demo-mode EVM branch — FROZEN) |

Shim exports: `getEthereumClient()`, `isPublicNodeFallback()`,
`_resetEthereumClientForTesting()`, `PUBLICNODE_ETHEREUM_RPC_URL`.
Registry replacement for `getEthereumClient()` is `getChainClient(1)`
(the shim already delegates to exactly that). The registry exposes NO
`getMainnetClient` and NO `MAINNET_CHAIN_ID` — `getChainClient(1)` is the
canonical mainnet client.

### The FROZEN constraint is whole-file, not region-scoped

There are NO `// BEGIN/END FROZEN` text markers in `send_transaction.ts`.
Phase 37 / 41 / 42 enforce the freeze as a CI/acceptance gate:
`git diff origin/main -- src/tools/send_transaction.ts` shows ZERO diff
(Phase 42 plan, frontmatter: "git diff origin/main -- src/tools/send_transaction.ts
must show ZERO diff"). Any edit to line 58's import source produces a
non-empty diff → violates the established gate. So the brief's Option (a)
("change only the import line — it's above the gate region") does NOT hold
here: the whole file is frozen, the import line included.

### Locked decision — Option (b-minimal): migrate the ENS resolver only; KEEP the shim

1. **Migrate `src/ens/resolver.ts`** — replace
   `import { getEthereumClient } from "../chains/ethereum.js"` with
   `import { getChainClient } from "../chains/registry.js"`, and both call
   sites `getEthereumClient()` → `getChainClient(1)`. ENS `getEnsAddress`
   / `getEnsName` / `normalize` calls unchanged.
2. **Migrate `test/ens-resolver.test.ts`** — `vi.mock("../src/chains/registry.js")`
   exposing `getChainClient` returning the stub client (replacing the
   current `vi.mock("../src/chains/ethereum.js")` / `getEthereumClient`
   seam). Forward + reverse assertions unchanged.
3. **`src/tools/send_transaction.ts` — UNTOUCHED.** Whole-file zero-diff
   held. It keeps importing `getEthereumClient` from the shim.
4. **`src/chains/ethereum.ts` — KEPT as the thin delegating shim**, now
   with exactly ONE runtime importer (the FROZEN send_transaction). The
   shim is already a one-line delegate to `getChainClient(1)`; it carries
   no implementation to delete.

**Exactly which bytes of `send_transaction.ts` change: NONE.**
`git diff origin/main -- src/tools/send_transaction.ts` stays EMPTY.

### Why (b-minimal), and the residual

DB-2's literal goal is "delete `src/chains/ethereum.ts`." That CANNOT be
done this phase without violating the Phase-42 whole-file freeze on
`send_transaction.ts` (its last importer). Honest outcome: this phase
removes ONE of the two importers (the ENS resolver) and leaves the shim
in place for the FROZEN one. **Residual: the shim survives with 1
importer; its deletion is gated on a future re-anchor of
`send_transaction.ts` and is re-scoped accordingly (see ROADMAP note).**

Alternatives the human reviewer should weigh:
- **(a) edit only send_transaction's import line.** REJECTED — Phase 42's
  zero-diff gate is whole-file, not region-scoped; this line is inside the
  frozen file. Would require explicitly unfreezing + re-anchoring
  `send_transaction.ts`, which is a security-review event, not a cleanup.
- **(c) delete the shim + re-anchor send_transaction's import in the same
  phase.** Architecturally the "real" full-DB-2 completion, but it
  couples a trivial dependency cleanup to a deliberate edit of the
  byte-frozen signing-path file — exactly the coupling the freeze exists
  to prevent. Recommended ONLY as its own explicitly-scoped, human-
  ratified "unfreeze + re-anchor send_transaction.ts" phase, with a fresh
  zero-diff baseline taken afterward. Surfaced here for the reviewer; not
  taken by this plan.

## Locked decisions (summary)

- Registry stays the single canonical per-chain client source;
  `getChainClient(1)` is the mainnet client.
- ENS resolver imports `getChainClient` from the registry; both call
  sites use `getChainClient(1)`.
- `test/ens-resolver.test.ts` mocks the registry (`getChainClient`), not
  the shim.
- `src/tools/send_transaction.ts` is NOT modified — whole-file zero-diff
  vs `origin/main` is a first-class success criterion.
- `src/chains/ethereum.ts` is KEPT (1 remaining importer); full deletion
  is deferred to a future send_transaction re-anchor phase.

## Constraints

- viem `PublicClient` is the shared client type (viem 2.51.3, unchanged).
- ENS reverse resolution needs a mainnet client regardless of the user's
  active chain (Phase 8 research) — satisfied by `getChainClient(1)`.
- CLAUDE.md: surgical changes — touch only what the task requires; remove
  only imports your own change orphaned.
