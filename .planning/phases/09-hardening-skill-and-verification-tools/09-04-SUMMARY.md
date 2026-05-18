---
phase: 09
plan: 04
subsystem: src/security/canonical-dispatch.ts per-chain dispatch allowlist + preview_send Layer 0.5 refusal + BRIDGED_VARIANTS consumption for Phase 6 ERC-20 lifecycle compatibility
tags: [canonical-dispatch, sec-35, dispatch-allowlist, layer-0.5, preview-send, bridged-variants-consumption, option-b-partial, eip-55, erc20-compatibility, phase-9, wave-b]
requirements: [SEC-35]
wave: 2
status: complete
completed: 2026-05-18
dependency-graph:
  requires:
    - "Plan 09-01 (procedural — phase orchestrator's wave structure; no artifact coupling)"
    - "Plan 06-03 contracts.ts SOT (getAaveV3PoolAddress + getWethAddress per-chain getters + KNOWN_SPENDERS_ETHEREUM rows 2/3 for 1inch + LiFi cross-check)"
    - "Plan 08-04 BRIDGED_VARIANTS curated SOT (73 rows × 23 unique symbols × 5 chains; consumed by `buildPerChainAllowlist`)"
  provides:
    - "src/security/canonical-dispatch.ts (NEW — 168 lines) — `CANONICAL_DISPATCH_TARGETS: Readonly<Record<ChainId, ReadonlySet<Address>>>` per-chain allowlist (5 chains, 8-22 entries per chain after BRIDGED_VARIANTS dedup); `DispatchCheckResult` 2-arm discriminated union (`ok` / `refused`); `checkDispatchTarget(chainId, to)` EIP-55-normalizing membership check; `_canonicalDispatch = { checkDispatchTarget }` ESM spy-affordance per CLAUDE.md Conventions; `buildPerChainAllowlist(chainId)` helper consuming existing SOT getters + BRIDGED_VARIANTS; `ONEINCH_V6_ROUTER_ALL_CHAINS` (`0x111111125421cA6dc452d289314280a0f8842A65`) + `LIFI_DIAMOND_ALL_CHAINS` (`0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`) inline literals (cross-chain canonical per RESEARCH § A3)"
    - "src/tools/preview_send.ts — Layer 0.5 wiring inserted BETWEEN handle lookup (line 144-156 region) and Phase 8 Layer 2 chain-name mismatch (lines 173-191 BYTE-FROZEN); fires ONLY when `record.tx.data !== \"0x\"` — native sends bypass per RESEARCH § Topic 6 lines 539-541 lock; refusal emits `DISPATCH_TARGET_REFUSED` envelope with verbatim per-chain allowlist surfacing for agent self-correction"
    - "src/signing/blocks.ts +43 lines APPEND-ONLY — DISPATCH_TARGET_REFUSAL_TEMPLATE (slots: {CHAIN} / {TO} / {ALLOWLIST}); existing 22 templates (Phase 4 + 6 + 7 + 8 + 08-04 + 09-02 + 09-03) BYTE-FROZEN"
    - "src/signing/error-codes.ts +13 lines APPEND-ONLY — DISPATCH_TARGET_REFUSED in `ErrorCode` union (17 → 18 codes); producer-map comment extended naming Plan 09-04"
    - "test/security-canonical-dispatch.test.ts (NEW — 217 lines, 21 cases) — T-CANONICAL-DISPATCH-COVERAGE-1 anchor + per-chain × per-canonical-entry membership + EIP-55 round-trip + ESM spy round-trip + cross-chain 1inch/LiFi consistency + T-ERC20-TOKEN-COMPATIBILITY-1 anchor"
    - "test/preview-send.dispatch-allowlist.test.ts (NEW — 348 lines, 9 cases) — T-DISPATCH-ALLOWLIST-1 anchor (Layer 0.5 BEFORE Layer 2 ordering) + T-DISPATCH-MISMATCH-1 / T-NATIVE-SEND-FALSE-REFUSAL-1 (native-send bypass) + DISPATCH_TARGET_REFUSAL_TEMPLATE byte-identity + Aave + WETH canonical happy paths + T-ERC20-TOKEN-COMPATIBILITY-1 USDC ERC-20 transfer + ESM spy round-trip + Phase 8 Layer 2 fall-through"
  affects:
    - "test/preview-send.test.ts (+13 lines — `_canonicalDispatch` spy-stub to `{ kind: \"ok\" }` in beforeEach + `vi.restoreAllMocks()` in afterEach; isolates legacy Phase 4 Test 5 which uses Fixture C EOA as tx.to for an ERC-20-shape data fixture)"
    - "test/preview-send.erc20.test.ts (+12 lines — same `_canonicalDispatch` spy-stub pattern; isolates Phase 6 off-list-token-registry test using `0xdeadbeef00…` as tx.to)"
    - "test/preview-send.aave.test.ts (+11 lines — same `_canonicalDispatch` spy-stub pattern; isolates Plan 07-03 unknown-selector test using `0x1111…1111` as tx.to)"
  unblocks:
    - "Plan 09-05 (get_tx_verification re-spec) — additive `dispatchCheckResult` field at structuredContent will consume `_canonicalDispatch.checkDispatchTarget` for the re-emit cross-check (parallel surface to the Plan 09-04 Layer 0.5 refusal at preview-time)"
    - "v2.4 prepare_custom_call({ acknowledgeNonProtocolTarget: true }) escape hatch — extends Layer 0.5 with a per-handle bypass flag for verified-source custom contracts; out of scope for v1.3"
    - "v2.3 Compound V3 entries in CANONICAL_DISPATCH_TARGETS — additive per-chain getter (`getCompoundV3Address(chainId)`) + table extension; no Layer 0.5 logic change required"
    - "v2.4 per-chain DEX router widening — Uniswap V3 / Curve / Sushi per-chain routers as canonical entries; today covered indirectly via 1inch aggregator pattern"
tech-stack:
  added: []
  patterns:
    - "PARALLEL SOT table per DF-2 Option A — `CANONICAL_DISPATCH_TARGETS` is a NEW table, NOT a widening of `KNOWN_SPENDERS_ETHEREUM`. Rationale (RESEARCH § Topic 6 line 568-580): spender-labels is a UI concern (DECODED ARGS approve template); dispatch-allowlist is a security concern (Layer 0.5 refusal gate). Two tables, two purposes, two evolution cadences. The 1inch + LiFi inline literals appear in BOTH tables (intentional duplication — separate audit surfaces with separate test coverage)."
    - "Option (b) PARTIAL BRIDGED_VARIANTS consumption — `buildPerChainAllowlist(chainId)` consumes `BRIDGED_VARIANTS.filter(v => v.chainId === chainId).map(v => v.address)` to restore Phase 6 ERC-20 lifecycle compatibility. WITHOUT this, `prepare_token_send` to USDC contract address would refuse at Layer 0.5 (USDC isn't a protocol entrypoint). With option (b), the 73-row Plan 08-04 BRIDGED_VARIANTS SOT is the per-chain known-token-contract registry; the Set absorbs duplicates (e.g. WETH9 on Base/Optimism shares the `0x4200…0006` predeploy with the BRIDGED_VARIANTS WETH row). Long-tail tokens NOT in BRIDGED_VARIANTS still hit Layer 0.5 — user routes via `resolve_token` / `get_token_metadata` to discover the canonical address."
    - "Layer 0.5 placement BETWEEN handle lookup and Phase 8 Layer 2 — security gate fires FIRST. Rationale (RESEARCH § Topic 10 layer table): dispatch-target is a SECURITY GATE (`DISPATCH_TARGET_REFUSED`); chain-mismatch is a STATE CONSISTENCY check (`CHAIN_ID_MISMATCH`). A refusal that triggers BOTH surfaces DISPATCH_TARGET_REFUSED — the more fundamental issue. Test 1 of `test/preview-send.dispatch-allowlist.test.ts` (T-DISPATCH-ALLOWLIST-1 anchor) locks this property with a fixture that triggers both layers and asserts `errorCode === \"DISPATCH_TARGET_REFUSED\"`."
    - "Native-send bypass via `record.tx.data !== \"0x\"` fence — any `to` is valid for a native value transfer. Native sends bypass entirely; the Layer 0.5 check ONLY fires for contract calls. Test 2 (T-DISPATCH-MISMATCH-1 / T-NATIVE-SEND-FALSE-REFUSAL-1 anchor) locks this: a prepared native send to a random EOA succeeds at preview_send."
    - "EIP-55-normalized membership check — `checkDispatchTarget` applies `getAddress(to)` BEFORE the Set membership lookup so a lowercase / mixed-case input matches a checksummed allowlist entry. Defense against silent case-mismatch refusals (T-SPENDER-CASE-1 analog). Test 9 of `test/security-canonical-dispatch.test.ts` locks this with a lowercase Aave Pool input."
    - "ESM spy-affordance per CLAUDE.md Conventions — `_canonicalDispatch = { checkDispatchTarget }` indirection lets `vi.spyOn(_canonicalDispatch, \"checkDispatchTarget\")` intercept the production callsite at `preview_send.ts:184`. Direct spy on the named export would be a no-op (ESM named-export bindings are immutable). Test 10 of `test/security-canonical-dispatch.test.ts` + Test 8 of `test/preview-send.dispatch-allowlist.test.ts` cover the spy round-trip end-to-end."
    - "Legacy-test spy-stub for new gate behavior — `vi.spyOn(_canonicalDispatch, \"checkDispatchTarget\").mockReturnValue({ kind: \"ok\" })` in beforeEach of the 3 pre-existing preview_send test files. Pattern mirror of Plan 09-02's `_skillIntegrity` stub for legacy auto-demo tests (Rule 1 — test crosstalk caused by new production behavior, not a real regression in the existing tools). Separation-of-concerns preserved: legacy tests assert their original behavior in isolation; dedicated Layer 0.5 coverage lives in the new dispatch-allowlist test file."
    - "APPEND-ONLY discipline on shared format-fanout-sentinel files — `src/signing/blocks.ts` (22 templates byte-frozen; Plan 09-04 appends 1 template at end-of-file) + `src/signing/error-codes.ts` (17 codes byte-frozen; Plan 09-04 appends 1 code at end-of-union). Zero source-line collision with Plan 09-02 (parallel Wave B) which appends to distinct end-of-file regions of the same two files — trivial rebase if both branches push concurrently."
key-files:
  created:
    - "src/security/canonical-dispatch.ts (NEW — 168 lines)"
    - "test/security-canonical-dispatch.test.ts (NEW — 217 lines, 21 cases)"
    - "test/preview-send.dispatch-allowlist.test.ts (NEW — 348 lines, 9 cases)"
    - ".planning/phases/09-hardening-skill-and-verification-tools/09-04-SUMMARY.md (NEW — this file)"
  modified:
    - "src/tools/preview_send.ts (+44 lines — Layer 0.5 wiring inserted between handle lookup and Phase 8 Layer 2 region; FROZEN Phase 8 Layer 2 lines 173-191 UNCHANGED)"
    - "src/signing/blocks.ts (+43 lines APPEND-ONLY — DISPATCH_TARGET_REFUSAL_TEMPLATE; existing 22 templates byte-frozen)"
    - "src/signing/error-codes.ts (+13/-1 lines APPEND-ONLY — DISPATCH_TARGET_REFUSED in ErrorCode union; the 1 deletion is the semicolon termination on the prior `\"SKILL_INTEGRITY_FAILURE\";` line, unavoidable when appending to a TS union literal — same pattern Plan 09-02 used)"
    - "test/preview-send.test.ts (+13 lines — `_canonicalDispatch` spy-stub in beforeEach + restoreAllMocks in afterEach)"
    - "test/preview-send.erc20.test.ts (+12 lines — same pattern)"
    - "test/preview-send.aave.test.ts (+11 lines — same pattern)"
decisions:
  - "**LOCKED option (b) PARTIAL — CANONICAL_DISPATCH_TARGETS consumes BRIDGED_VARIANTS for Phase 6 ERC-20 lifecycle compatibility.** Plan 09-04's `<implementation_guidance>` flagged a hard design contradiction: a strict 4-entry-per-chain allowlist (Aave Pool + WETH9 + 1inch V6 + LiFi Diamond) would REFUSE every Phase 6 ERC-20 transaction at Layer 0.5 because the token contract IS the dispatch target for `prepare_token_send` / `prepare_token_approve` / `prepare_revoke_approval`. Without intervention, v1.3 would BREAK every ERC-20 flow shipped in v1.1. The planner's LOCKED resolution was option (b) PARTIAL: extend `buildPerChainAllowlist(chainId)` to additionally include `BRIDGED_VARIANTS.filter(v => v.chainId === chainId).map(v => v.address)`. The Plan 08-04 BRIDGED_VARIANTS table IS the per-chain known-token-contract SOT (73 rows × 23 unique symbols × 5 chains); the dispatch-allowlist consumes it as the v1.3 token-contract coverage. Long-tail tokens NOT in BRIDGED_VARIANTS still hit Layer 0.5 — user routes via `resolve_token` to discover the canonical address (which is in BRIDGED_VARIANTS by design). Implementation surface: 3 added lines in `buildPerChainAllowlist` (filter + map + spread). Per-chain Set sizes after dedup: Ethereum 20 / Arbitrum 21 / Polygon 22 / Base 8 / Optimism 17."
  - "**Per-chain Set size lower bounds asserted at `>= 15` (Ethereum) + `>= 8` (L2s).** Plan body's success criterion specified these as test lower bounds for T-CANONICAL-DISPATCH-COVERAGE-1. At execute time, actual Set sizes are: Ethereum 20 (4 canonical + 17 BRIDGED_VARIANTS Ethereum rows − 1 WETH overlap), Arbitrum 21 (4 + 18 − 1), Polygon 22 (4 + 19 − 1), Base 8 (4 + 5 − 1), Optimism 17 (4 + 14 − 1). All chains meet the planned lower bounds. Base is the tightest at 8 entries; future BRIDGED_VARIANTS extensions for Base (cbBTC / coinbase-wrapped variants) would widen the gap."
  - "**1inch V6 inline literal re-keyed to EIP-55 canonical (`0x111111125421cA6dc452d289314280a0f8842A65`).** The plan body and `KNOWN_SPENDERS_ETHEREUM` (Plan 06-03 row 3) both used the mixed-case form `0x...a0F8842A65` (capital F). The EIP-55 checksum algorithm yields lowercase `f` for that position; `viem.getAddress` accepts the mixed-case input as a re-normalization (does NOT throw on a non-canonical-checksummed input) but the OUT bytes are the canonical form. My initial implementation used the plan's literal form; the first test run failed Test 3 of `test/preview-send.dispatch-allowlist.test.ts` because the refusal text contained the post-normalization form while the assertion checked for the pre-normalization form. Fixed by re-keying the source file's inline literal to the canonical EIP-55 form (matches what `getAddress` produces). KNOWN_SPENDERS_ETHEREUM continues to use the mixed-case form — it's wrapped in `getAddress` at the literal site so the in-memory bytes are identical; this is harmless drift between two surfaces, but flagging here for the next plan that touches either table to consider unifying. Out of scope for 09-04."
  - "**1inch V6 + LiFi cross-chain canonical addresses re-verified at execute time (2026-05-18).** Per plan body's step 1: `0x111111125421cA6dc452d289314280a0f8842A65` confirmed as 1inch V6 Router on all 5 chains via portal.1inch.dev cross-check + KNOWN_SPENDERS_ETHEREUM row 3 cross-link; `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` confirmed as LiFi Diamond on all 5 chains via docs.li.fi cross-check + KNOWN_SPENDERS_ETHEREUM row 2 cross-link. Both addresses are byte-identical with the existing KNOWN_SPENDERS Ethereum rows (after EIP-55 normalization). RESEARCH § A3 documents the cross-chain reuse pattern (single deployer governance + CREATE2 deterministic addressing) — the per-chain check is therefore a self-consistency assertion, not an empirical re-discovery."
  - "**Three pre-existing preview_send test files extended with spy-stub pattern (Rule 1 fix).** First `npm test` run after landing the production change surfaced 3 regressions: (1) `test/preview-send.test.ts` Test 5 (4byte error VERBATIM) — uses Fixture C's EOA address `0x70997970…79C8` as tx.to for an ERC-20-shape transfer fixture (the test deliberately doesn't care about tx.to; it cares about the 4byte block); (2) `test/preview-send.erc20.test.ts` Test for off-list token (`seedOffListTransferHandle`) — uses `0xdeadbeef00…` as tx.to to deliberately exercise the off-list-token-REGISTRY fallback; (3) `test/preview-send.aave.test.ts` unknown-selector test (`seedUnknownSelectorHandle`) — uses `0x1111…1111` as tx.to to exercise the decoder fall-through. All three predate Plan 09-04 by multiple phases and use addresses chosen for purposes unrelated to dispatch-allowlist membership. Fixed by adding `vi.spyOn(_canonicalDispatch, \"checkDispatchTarget\").mockReturnValue({ kind: \"ok\" })` to each file's beforeEach + `vi.restoreAllMocks()` in afterEach. Mirror of Plan 09-02's `_skillIntegrity` stub for legacy auto-demo tests. Separation-of-concerns preserved: legacy tests assert their original behavior in isolation; dedicated Layer 0.5 coverage lives in the new `test/preview-send.dispatch-allowlist.test.ts` (9 cases)."
metrics:
  duration: "~35 minutes (single execution wave; one rework on the EIP-55 canonical-checksum drift in Test 3 — caught at first new-test run; resolved by re-keying the source inline literal to the EIP-55 canonical form)"
  completed: 2026-05-18
  tasks_completed: 1
  files_created: 4
  files_modified: 6
  loc_added: "+1001 / -1 (single atomic commit 677749d)"
  tests_before: 828
  tests_after: 858
  tests_delta: 30
  test_count_trajectory: "828 → 858 (+30)"
---

# Phase 9 Plan 04 Summary: `src/security/canonical-dispatch.ts` per-chain Allowlist + `preview_send` Layer 0.5 Refusal + Phase 6 Compatibility via BRIDGED_VARIANTS

## One-liner

Per-chain outer dispatch-target allowlist at preview_send Layer 0.5 (Aave Pool + WETH9 + 1inch V6 + LiFi Diamond canonicals via SOT getters + 73-row Plan 08-04 BRIDGED_VARIANTS consumption); refuses contract calls to non-canonical addresses with verbatim allowlist surfacing; native sends bypass; locks Phase 6 ERC-20 lifecycle compatibility (option (b) PARTIAL). Closes SEC-35.

## What Landed

### 1. `src/security/canonical-dispatch.ts` (NEW — 168 LOC)

```typescript
const ONEINCH_V6_ROUTER_ALL_CHAINS: Address = getAddress(
  "0x111111125421cA6dc452d289314280a0f8842A65",
);
const LIFI_DIAMOND_ALL_CHAINS: Address = getAddress(
  "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
);

function buildPerChainAllowlist(chainId: ChainId): ReadonlySet<Address> {
  const tokenContracts = BRIDGED_VARIANTS
    .filter((v) => v.chainId === chainId)
    .map((v) => v.address);
  return new Set<Address>([
    getAaveV3PoolAddress(chainId),
    getWethAddress(chainId),
    ONEINCH_V6_ROUTER_ALL_CHAINS,
    LIFI_DIAMOND_ALL_CHAINS,
    ...tokenContracts,
  ]);
}

export const CANONICAL_DISPATCH_TARGETS: Readonly<
  Record<ChainId, ReadonlySet<Address>>
> = {
  1: buildPerChainAllowlist(1),
  42161: buildPerChainAllowlist(42161),
  137: buildPerChainAllowlist(137),
  8453: buildPerChainAllowlist(8453),
  10: buildPerChainAllowlist(10),
};

export type DispatchCheckResult =
  | { kind: "ok" }
  | { kind: "refused"; chain: ChainId; to: Address; allowlist: Address[] };

export function checkDispatchTarget(chainId: ChainId, to: Address): DispatchCheckResult {
  const checksummed = getAddress(to);  // EIP-55 normalization
  const allowlist = CANONICAL_DISPATCH_TARGETS[chainId];
  if (allowlist.has(checksummed)) return { kind: "ok" };
  return { kind: "refused", chain: chainId, to: checksummed, allowlist: [...allowlist] };
}

export const _canonicalDispatch = { checkDispatchTarget };
```

Per-chain Set sizes (post-BRIDGED_VARIANTS dedup):

| Chain | Set size | Canonical (4) | BRIDGED_VARIANTS rows | Overlap |
|-------|----------|---------------|-----------------------|---------|
| Ethereum (1)   | **20** | 4 | 17 | 1 (WETH9) |
| Arbitrum (42161) | **21** | 4 | 18 | 1 (WETH)   |
| Polygon (137)    | **22** | 4 | 19 | 1 (WETH)   |
| Base (8453)      | **8**  | 4 | 5  | 1 (OP-Stack WETH `0x4200…0006`) |
| Optimism (10)    | **17** | 4 | 14 | 1 (OP-Stack WETH `0x4200…0006`) |

### 2. `src/tools/preview_send.ts` Layer 0.5 wiring

Inserted BETWEEN handle lookup (line 144-156 region) and Phase 8 Layer 2 chain-name mismatch (lines 173-191 BYTE-FROZEN):

```typescript
if (record.tx.data !== "0x") {
  const dispatchCheck = _canonicalDispatch.checkDispatchTarget(
    record.tx.chainId as ChainId,
    record.tx.to,
  );
  if (dispatchCheck.kind === "refused") {
    const chainLabel = `${chainNameFromId(record.tx.chainId as ChainId)} (chainId ${record.tx.chainId})`;
    const refusalText = DISPATCH_TARGET_REFUSAL_TEMPLATE
      .replace("{CHAIN}", chainLabel)
      .replace("{TO}", dispatchCheck.to)
      .replace("{ALLOWLIST}", dispatchCheck.allowlist.join("\n    "));
    return {
      isError: true,
      content: [{ type: "text", text: refusalText }],
      structuredContent: errEnvelope(
        "DISPATCH_TARGET_REFUSED",
        `tx.to ${dispatchCheck.to} is not in the v1.3 canonical dispatch allowlist for chain ${record.tx.chainId}`,
      ),
    };
  }
}
```

NEW imports: `_canonicalDispatch` from `../security/canonical-dispatch.js`; `DISPATCH_TARGET_REFUSAL_TEMPLATE` added to the existing `../signing/blocks.js` import block.

### 3. `src/signing/blocks.ts` (APPEND-ONLY, +43 lines)

`DISPATCH_TARGET_REFUSAL_TEMPLATE` — 17-line template with `{CHAIN}` / `{TO}` / `{ALLOWLIST}` slots:

```
DISPATCH TARGET REFUSED
  chain:     {CHAIN}
  tx.to:     {TO}
  reason:    tx.to is NOT in the v1.3 canonical dispatch allowlist.

  Canonical allowlist for this chain:
    {ALLOWLIST}

  Remediation:
    1. Re-prepare the transaction targeting one of the canonical addresses above.
    2. If you intend to call a non-canonical contract (e.g. a verified-source
       custom contract not in the v1.3-covered protocols), the v2.4+
       prepare_custom_call({ acknowledgeNonProtocolTarget: true }) escape hatch
       will be the path — currently out of scope for v1.3.

  Native sends (data === "0x") bypass this allowlist — any `to` is valid for
  a value transfer.
```

Existing 22 templates BYTE-FROZEN — `git diff origin/main -- src/signing/blocks.ts | grep '^-' | grep -v '^---'` returns 0 deletion lines.

### 4. `src/signing/error-codes.ts` (APPEND-ONLY, +13 / -1 lines)

`ErrorCode` union extended from 17 → 18 entries:

```typescript
export type ErrorCode =
  | "WALLET_NOT_PAIRED"
  | ... // 15 existing codes byte-frozen
  | "CHAIN_ID_MISMATCH"
  | "SKILL_INTEGRITY_FAILURE"
  | "DISPATCH_TARGET_REFUSED";  // Phase 9 Plan 09-04
```

The 1 deletion is the semicolon termination on the prior `"SKILL_INTEGRITY_FAILURE";` line — unavoidable when appending to a TypeScript union literal; same pattern Plan 09-02 used to append `SKILL_INTEGRITY_FAILURE` itself.

Producer-map comment extended with a Plan 09-04 entry naming the Layer 0.5 placement + native-send bypass + Layer-0.5-fires-before-Layer-2 ordering invariant.

### 5. `test/security-canonical-dispatch.test.ts` (NEW — 21 cases)

| # | Test | What it locks |
|---|------|---------------|
| 1-5 | T-CANONICAL-DISPATCH-COVERAGE-1 anchor (per-chain Set size lower bounds) | Ethereum >= 15, L2s >= 8 |
| 6 | Aave V3 Pool membership across 5 chains | 5 assertions in one test |
| 7 | WETH9 membership across 5 chains | 5 assertions |
| 8 | 1inch V6 cross-chain canonical membership | 5 assertions |
| 9 | LiFi Diamond cross-chain canonical membership | 5 assertions |
| 10 | Ethereum Aave Pool → `{ kind: "ok" }` | Happy path |
| 11 | Polygon WETH9 → `{ kind: "ok" }` | Happy path |
| 12 | Random EOA on Ethereum → `{ kind: "refused" }` with verbatim allowlist | Refusal envelope shape |
| 13 | Lowercase Aave Pool address → `{ kind: "ok" }` | EIP-55 normalization |
| 14 | Mixed-case WETH9 address → `{ kind: "ok" }` | EIP-55 normalization (alternating-case mutation) |
| 15 | ESM spy round-trip via `_canonicalDispatch` | Spy seam works |
| 16 | 1inch V6 resolves to `ok` on every chain via `checkDispatchTarget` | Cross-chain consistency |
| 17 | LiFi Diamond resolves to `ok` on every chain | Cross-chain consistency |
| 18 | Ethereum USDC (Circle-native) reaches `{ kind: "ok" }` via BRIDGED_VARIANTS | T-ERC20-TOKEN-COMPATIBILITY-1 anchor |
| 19 | Polygon USDT reaches `{ kind: "ok" }` via BRIDGED_VARIANTS | T-ERC20-TOKEN-COMPATIBILITY-1 |
| 20 | Arbitrum WETH (canonical) reaches `{ kind: "ok" }` | Canonical-SOT-getter path |
| 21 | Long-tail token (NOT in BRIDGED_VARIANTS) → `{ kind: "refused" }` | Acceptance of refusal for unknown tokens |

### 6. `test/preview-send.dispatch-allowlist.test.ts` (NEW — 9 cases)

| # | Test | What it locks |
|---|------|---------------|
| 1 | T-DISPATCH-ALLOWLIST-1 anchor — Layer 0.5 BEFORE Layer 2 ordering | A refusal that triggers BOTH surfaces `DISPATCH_TARGET_REFUSED` (not `CHAIN_ID_MISMATCH`) |
| 2 | T-DISPATCH-MISMATCH-1 / T-NATIVE-SEND-FALSE-REFUSAL-1 — native-send bypass | Prepared native send to random EOA succeeds at `preview_send` |
| 3 | Contract-call refusal happy path with verbatim allowlist surfacing | Refusal text contains chain + tx.to + 4-canonical entries + remediation prose |
| 4 | Aave V3 Pool call (Ethereum) → no refusal | Canonical-target happy path |
| 5 | WETH9.withdraw on Polygon → no refusal | Cross-chain canonical happy path |
| 6 | T-ERC20-TOKEN-COMPATIBILITY-1 anchor — USDC ERC-20 transfer | Phase 6 ERC-20 lifecycle preserved via BRIDGED_VARIANTS |
| 7 | DISPATCH_TARGET_REFUSAL_TEMPLATE byte-identity | Refusal text byte-equal to template-substitution result |
| 8 | ESM spy round-trip via `_canonicalDispatch` | `vi.spyOn` short-circuits the refusal end-to-end through `preview_send` |
| 9 | Phase 8 Layer 2 fall-through — canonical tx.to + wrong chain → `CHAIN_ID_MISMATCH` | Layer ordering invariant proves Layer 2 still fires when Layer 0.5 passes |

### 7. Legacy test isolation — `_canonicalDispatch` spy-stub pattern

Three pre-existing preview_send test files now apply the `vi.spyOn(_canonicalDispatch, "checkDispatchTarget").mockReturnValue({ kind: "ok" })` stub in beforeEach + `vi.restoreAllMocks()` in afterEach:

| File | Affected test | Original tx.to fixture (NOT in allowlist) |
|------|---------------|-------------------------------------------|
| `test/preview-send.test.ts` | Test 5 (4byte error VERBATIM) | Fixture C EOA `0x70997970…79C8` with `transferData` ERC-20 calldata |
| `test/preview-send.erc20.test.ts` | DECODED ARGS off-list token fallback | `0xdeadbeef00…` (deliberately off-list per the test's intent) |
| `test/preview-send.aave.test.ts` | Unknown-selector fall-through | `0x1111…1111` (deliberately off-list) |

All three predate Plan 09-04 by multiple phases and use those addresses for purposes unrelated to dispatch-allowlist membership. Mirror of Plan 09-02's `_skillIntegrity` stub for legacy auto-demo tests. Separation-of-concerns preserved.

## Layer 0.5 firing order vs Layer 2 vs Layer 3

| Layer | Plan | Component | When | Refusal Code | Trust Anchor |
|-------|------|-----------|------|--------------|--------------|
| Layer 1 | (schema) | JSON-schema enum at MCP dispatch boundary | bogus chain names rejected | (schema error) | Server boundary |
| **Layer 0.5** | **09-04 (THIS)** | `preview_send` outer dispatch-target allowlist | AFTER handle lookup, BEFORE Layer 2 | `DISPATCH_TARGET_REFUSED` | Server boundary |
| Layer 2 | 08-02 | `preview_send` chain-name MISMATCH | AFTER Layer 0.5, BEFORE the three gates | `CHAIN_ID_MISMATCH` | Server boundary |
| Layer 3 | 04-01 (FROZEN) | `send_transaction` payloadFingerprint preimage chainId slot | At send time | `PAYLOAD_FINGERPRINT_DRIFT` | Cryptographic |
| Layer 4 | (Ledger) | Device `Network:` clear-sign display | On-device | — | Ledger screen |

Despite the half-step name, Layer 0.5 is named to preserve the established Phase 8 Layer 1 / Layer 2 / Layer 3 / Layer 4 numbering without renumbering downstream documentation. The semantic is: "fires before Layer 2; logically the first security gate AFTER schema validation."

## FROZEN-area assertion

```bash
git diff origin/main -- \
  src/signing/payload-fingerprint.ts \
  src/signing/presign-hash.ts \
  src/signing/handle-store.ts \
  src/tools/send_transaction.ts \
  src/clients/etherscan.ts \
  src/clients/fourbyte.ts \
  src/protocols/aave-v3.ts \
  src/protocols/erc20.ts \
  src/protocols/weth9.ts \
  src/signing/aave-health.ts \
  src/signing/amount.ts \
  src/signing/simulation.ts | wc -l
#        0
```

12-file FROZEN list zero-diff. Phase 8 Layer 2 chain-mismatch region in `preview_send.ts:173-191` UNCHANGED (Plan 09-04 inserts Layer 0.5 at lines BEFORE that region). `src/signing/blocks.ts` shows only the additive `DISPATCH_TARGET_REFUSAL_TEMPLATE` append (zero deletion lines). `src/signing/error-codes.ts` shows additive `DISPATCH_TARGET_REFUSED` (1 unavoidable semicolon-termination deletion when extending the TS union literal).

## Test trajectory

| Stage | Test count | Delta |
|-------|------------|-------|
| Phase 9 baseline (post-Plan 09-03 merge, HEAD `3bd1565`) | 828 | — |
| Post-Plan-09-04 implementation | **858** | **+30** |

Plan estimate was 38 cases (`tests_added_estimate: 38`); landed at 30 (21 unit + 9 integration). The lower count vs estimate reflects condensing the 4-entry × 5-chain membership matrix into 4 unit tests (one per canonical-entry class, each asserting across all 5 chains in a single loop) rather than 20 separate test cases. Zero pre-existing tests regressed (3 fixed via the `_canonicalDispatch` spy-stub pattern — Rule 1 auto-fix). `npm run typecheck` + `npm run build` clean.

## EXPECTED_DISPATCH single-SOT discipline

```bash
grep -rl "ONEINCH_V6_ROUTER_ALL_CHAINS" src/
# src/security/canonical-dispatch.ts
grep -rl "LIFI_DIAMOND_ALL_CHAINS" src/
# src/security/canonical-dispatch.ts
```

Exactly 1 src file each. The 1inch + LiFi inline literals are PRIVATE to `canonical-dispatch.ts`; they intentionally duplicate the `KNOWN_SPENDERS_ETHEREUM` row addresses (Plan 06-03) — TWO SOT surfaces for the same address (UI label table + security allowlist), DF-2 LOCKED at planning gate per RESEARCH § Topic 6 lines 568-580 (concerns intentionally separated).

## Trust Boundaries Closed

| Boundary | Status | How |
|----------|--------|-----|
| Agent → `prepare_*` → `record.tx.to` | ✅ | Layer 0.5 refusal at preview_send catches hallucinated `to` outside the per-chain canonical allowlist |
| `record.tx.to` → Layer 0.5 dispatch check | ✅ | `_canonicalDispatch.checkDispatchTarget(chainId, to)` Set membership lookup; EIP-55-normalized for case-insensitive match |
| `CANONICAL_DISPATCH_TARGETS` curated table → module load | ✅ | Aave + WETH entries sourced via existing per-chain SOT getters; 1inch + LiFi inline literals `getAddress`-wrapped at literal site (corrupted-snapshot guard) |
| `BRIDGED_VARIANTS` table → Layer 0.5 allowlist | ✅ | Plan 08-04 curated table consumed via filter+map; per-row EIP-55 + non-empty `variantNote` integrity already enforced at the SOT (Plan 08-04 tests) |
| `DISPATCH_TARGET_REFUSAL_TEMPLATE` → user-facing text | ✅ | Slot substitution surfaces verbatim per-chain allowlist for agent self-correction; remediation prose names the v2.4 escape hatch + native-send bypass |
| Native sends → bypass | ✅ | `record.tx.data === "0x"` fence; any `to` valid for value transfer per RESEARCH § Topic 6 lines 539-541 |

## Threat Register — Mitigations Asserted

| ID | Severity | Status | How asserted |
|----|----------|--------|--------------|
| **T-DISPATCH-MISMATCH-1** | high | ✅ asserted | `test/preview-send.dispatch-allowlist.test.ts` Tests 1+3+6 — off-list `tx.to` triggers `DISPATCH_TARGET_REFUSED` at Layer 0.5 with verbatim allowlist surfacing |
| **T-DISPATCH-ALLOWLIST-1** | medium | ✅ asserted | Cross-test against `test/config-contracts.test.ts` (Aave + WETH SOT integrity) + `test/bridged-variants.test.ts` (token-contract integrity) + `test/security-canonical-dispatch.test.ts` Test 16-17 (cross-chain consistency) |
| **T-CANONICAL-DISPATCH-COVERAGE-1** | high | ✅ asserted | `test/security-canonical-dispatch.test.ts` Tests 1-9 — per-chain × per-canonical-entry membership (4 entries × 5 chains coverage); per-chain Set size lower bounds locked at `>= 15` Ethereum + `>= 8` L2s |
| **T-LAYER-ORDER-INVERSION-1** | high | ✅ asserted | `test/preview-send.dispatch-allowlist.test.ts` Test 1 — a refusal that triggers BOTH Layer 0.5 AND Layer 2 surfaces `DISPATCH_TARGET_REFUSED`; drift in line ordering (Layer 2 first) breaks the test |
| **T-NATIVE-SEND-FALSE-REFUSAL-1** | high | ✅ asserted | `test/preview-send.dispatch-allowlist.test.ts` Test 2 — prepared native send to random EOA succeeds at `preview_send`; drift in the `data !== "0x"` fence breaks the test |
| **T-ERC20-TOKEN-COMPATIBILITY-1** | high | ✅ asserted (option (b) PARTIAL) | `test/security-canonical-dispatch.test.ts` Tests 18-20 + `test/preview-send.dispatch-allowlist.test.ts` Test 6 — USDC / USDT / WETH ERC-20 paths reach preview_send without refusal via BRIDGED_VARIANTS coverage; long-tail tokens (Test 21) still refuse |
| **T-COMPROMISED-MCP-1** (cross-plan) | high | ✅ asserted (defense-in-depth) | Plan 09-04's MCP-side Layer 0.5 + Plan 09-01's SKILL.md Step 2 agent-side parallel allowlist check + Plan 09-02 NOTICE for skill absence |
| **T-FROZEN-SIGNING-1 (STOP-THE-LINE)** | high | ✅ asserted | EMPTY `git diff` against 12-file FROZEN list (asserted at execute time) |

## Hooks for Plan 09-05

When executing Plan 09-05 (`get_tx_verification` re-spec + `sessionTopicLast8` surfacing at send success):

1. **`dispatchCheckResult` additive structuredContent field** — Plan 09-05's `get_tx_verification` re-emit will consume `_canonicalDispatch.checkDispatchTarget(record.tx.chainId, record.tx.to)` at re-emit time and surface the result as an additive `dispatchCheckResult: DispatchCheckResult` field. This is a parallel surface to Plan 09-04's Layer 0.5 refusal at preview-time: Layer 0.5 is the active gate; the `dispatchCheckResult` re-emit is the diagnostic view (lets the agent and/or skill cross-check what the server's allowlist says without re-deriving). Plan 09-05 imports `_canonicalDispatch` directly — no need for a new helper.

2. **Plan 09-05's `register-all.ts` import edit** — Plan 09-05 owns the consolidated import line addition for BOTH `./verify_tx_decode.js` AND `./get_verification_artifact.js` per Plan 09-03's hand-off note. Plan 09-04 does NOT touch `register-all.ts` (canonical-dispatch is a library module, not a tool); zero coordination required.

3. **APPEND-ONLY rebase safety** — Plans 09-04 + 09-05 both append to `src/signing/blocks.ts` + `src/signing/error-codes.ts` at end-of-file regions. No source-line collision; trivial rebase if 09-05 lands on a feature branch that started before 09-04 merged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] EIP-55 canonical-checksum drift in 1inch V6 inline literal**

- **Found during:** First `npm test` run on the new test files; Test 3 of `test/preview-send.dispatch-allowlist.test.ts` failed because the refusal text contained the canonical post-`getAddress` form `0x111111125421cA6dc452d289314280a0f8842A65` (lowercase f) while my test fixture asserted the plan body's mixed-case form `0x...a0F8842A65` (capital F).
- **Issue:** EIP-55 checksum is deterministic — `viem.getAddress` accepts mixed-case input as a re-normalization but emits the canonical form. Plan body + `KNOWN_SPENDERS_ETHEREUM` (Plan 06-03 row 3) both use the mixed-case form (harmless at runtime since `getAddress` re-normalizes both, but visible drift in error message text).
- **Fix:** Re-keyed the source inline literal AND the test fixture to the canonical EIP-55 form. Documented in comment block of `canonical-dispatch.ts`.
- **Files modified:** `src/security/canonical-dispatch.ts` + `test/security-canonical-dispatch.test.ts` + `test/preview-send.dispatch-allowlist.test.ts` — all 3 single-line edits.
- **Commit:** rolled into the single Task 1 atomic commit (`677749d`).

**2. [Rule 1 — Test crosstalk] Three pre-existing `preview_send` tests broke under new Layer 0.5 gate**

- **Found during:** First full `npm test` run after landing the production change.
- **Issue:** `test/preview-send.test.ts` Test 5 (4byte error VERBATIM) seeds a handle with Fixture C's EOA address as tx.to + ERC-20-shape transfer calldata to exercise the 4byte block. `test/preview-send.erc20.test.ts` ("DECODED ARGS off-list token fallback") uses `0xdeadbeef00…` as tx.to to deliberately exercise the off-list-token-REGISTRY decode path. `test/preview-send.aave.test.ts` ("unknown selector fall-through") uses `0x1111…1111` as tx.to to exercise the decoder fall-through to `kind: "unknown"`. All three predate Plan 09-04 by multiple phases — they pick those addresses for purposes unrelated to dispatch-allowlist membership. After Plan 09-04, all three contract-call shapes refuse at Layer 0.5 with `DISPATCH_TARGET_REFUSED`.
- **Fix:** Added `vi.spyOn(_canonicalDispatch, "checkDispatchTarget").mockReturnValue({ kind: "ok" })` to each affected file's `beforeEach` + `vi.restoreAllMocks()` to the `afterEach`. Mirror of Plan 09-02's `_skillIntegrity` stub for legacy auto-demo tests. Separation-of-concerns preserved — legacy tests assert their original behavior in isolation; dedicated Layer 0.5 coverage lives in the new `test/preview-send.dispatch-allowlist.test.ts` (9 cases).
- **Files modified:** `test/preview-send.test.ts` (+13 lines beforeEach stub + afterEach reset + import line); `test/preview-send.erc20.test.ts` (+12 lines, same pattern); `test/preview-send.aave.test.ts` (+11 lines, same pattern).
- **Commit:** rolled into the single Task 1 atomic commit.

### Plan Body Observations (not deviations)

- **Plan estimate of 38 tests landed at 30.** The 4-entry × 5-chain canonical membership matrix was condensed into 4 unit tests (one per canonical-entry class, each iterating across all 5 chains in a single loop) rather than 20 separate test cases. The functional coverage is identical — every assertion still fires.
- **Single atomic commit shape ships as requested.** Plan 09-04's `<execution_context>` specified ONE atomic main-repo commit covering the 4 src files + 2 NEW test files + 3 legacy test files. Commit `677749d` captures all 9 file changes atomically.

## Accepted Residuals

- **Long-tail token contracts hit `DISPATCH_TARGET_REFUSED`** (per plan). Tokens NOT in BRIDGED_VARIANTS (newer launches, niche assets) fail the Layer 0.5 gate. User remediation: `resolve_token({ symbol, chain? })` discovers the canonical address; if it's in BRIDGED_VARIANTS, the next prepare succeeds. v2.4+ `prepare_custom_call` escape hatch is the documented future path.
- **1inch V6 + LiFi inline literals duplicate `KNOWN_SPENDERS_ETHEREUM` rows 2 + 3** (per plan — DF-2 LOCKED). Two SOT surfaces for the same address (UI label table + security allowlist). Concerns intentionally separated.
- **Minor EIP-55 canonical-form drift between `KNOWN_SPENDERS_ETHEREUM` (mixed-case) and `canonical-dispatch.ts` (canonical-case) on the 1inch V6 address.** Both surfaces are wrapped in `getAddress` at the literal site so in-memory bytes are identical; the drift is visible only in source-code reading and would not affect runtime behavior. Unification is out of scope for 09-04; flagged for the next plan that touches either table.
- **`buildPerChainAllowlist` rebuilds the Set on every `CANONICAL_DISPATCH_TARGETS` access pattern.** The constant is module-scope and evaluated ONCE at module load (Records are not lazy in TypeScript). Performance cost is constant-time amortized over the whole module lifetime — not load-bearing.
- **EIP-55 normalization via `getAddress` at every `checkDispatchTarget` call.** ~1µs per call; negligible. The case-insensitive defense is worth the cost.
- **Compound V3 entries deferred to v2.3** (per ROADMAP). Future additive extension; no Layer 0.5 logic change required.
- **v2.4 per-chain DEX router widening** (Uniswap V3 / Curve / Sushi per-chain routers as canonical entries) — v1.3 covers DEX flows indirectly via the 1inch aggregator + LiFi bridge patterns.

## Phase 9 Progress

Phase 9 = 5 plans (this is the 4th):

- **09-01** ✅ Sister repo bootstrap + SKILL.md + Step 0 + invariants encoded
- **09-02** ✅ `src/security/skill-integrity.ts` + EXPECTED_SKILL_SHA256 + dispatcher-wrap VAULTPILOT NOTICE + sister-repo v1.3.0 coordinated release
- **09-03** ✅ `get_verification_artifact` tool + PASTEABLE_BLOCK_TEMPLATE + canned second-LLM decode prompt
- **09-04** ✅ `src/security/canonical-dispatch.ts` + Layer 0.5 dispatch-allowlist refusal + BRIDGED_VARIANTS consumption for Phase 6 compatibility (THIS PLAN)
- 09-05 ⏳ `get_tx_verification` re-spec + `sessionTopicLast8` surfacing at send success + `register-all.ts` consolidated import

## Self-Check: PASSED

- `src/security/canonical-dispatch.ts` exists (168 lines); exports `CANONICAL_DISPATCH_TARGETS` + `checkDispatchTarget` + `_canonicalDispatch` + `DispatchCheckResult`.
- `src/tools/preview_send.ts` Layer 0.5 wiring at lines BEFORE Phase 8 Layer 2; FROZEN region UNCHANGED.
- `src/signing/blocks.ts` has additive `DISPATCH_TARGET_REFUSAL_TEMPLATE`; 0 deletions on existing 22 templates.
- `src/signing/error-codes.ts` has `DISPATCH_TARGET_REFUSED` appended to union (17 → 18 codes); producer-map comment extended.
- `test/security-canonical-dispatch.test.ts` exists (21 cases green).
- `test/preview-send.dispatch-allowlist.test.ts` exists (9 cases green).
- Three legacy test files (`preview-send.test.ts` / `preview-send.erc20.test.ts` / `preview-send.aave.test.ts`) extended with `_canonicalDispatch` spy-stub — all pre-existing tests green.
- 12-file FROZEN list zero-diff via `git diff origin/main -- <12 files> | wc -l == 0`.
- `npm run typecheck` clean (no output).
- `npm run build` clean (no errors).
- Test suite GREEN: **858 / 858** (828 baseline + 30 new) across 78 test files.
- Main-repo branch correct: `feat/09-04-canonical-dispatch-allowlist`.
- Worktree path correct: `/Users/s/dev/vaultpilot/vaultpilot-mcp-gsd-inspired/.claude/worktrees/feat-09-04-canonical-dispatch-allowlist`.
- Main-repo commit landed: `677749d feat(09-04): canonical-dispatch allowlist + Layer 0.5 preview_send refusal + DISPATCH_TARGET_REJECTED errorCode`.
