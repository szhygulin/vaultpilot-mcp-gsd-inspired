# Phase 41: Compound V3 Multi-Chain Expansion — Research

**Researched:** 2026-05-29
**Domain:** Compound V3 Comet per-chain deployment data + additive SOT + tool chain-gate widening
**Confidence:** HIGH (Comet addresses verified against compound-finance/comet GitHub canonical repo)

---

## Summary

Phase 41 lifts the deferral from Phase 28 (Compound V3 Ethereum-only). The core architecture
is already fully in place: `COMPOUND_COMETS_RAW` is a `Partial<Record<ChainId, Partial<Record<CompoundCometBase, Address>>>>` that currently has a single `chainId=1` row; `getAllCompoundCometsForChain(chainId)` already feeds `buildPerChainAllowlist` in `canonical-dispatch.ts` for every chain, returning `[]` for chains with no rows; all 7 tools already receive a `chain` parameter. The Phase 28 tools hard-gate on `chainName !== "ethereum"` at the handler level and use `enum: ["ethereum"]` in the JSON-Schema `chain` field — those are the specific software barriers to remove.

The work is three separable concerns: (1) populate verified Comet data for Polygon/Arbitrum/Base/Optimism into `COMPOUND_COMETS_RAW` and widen `CompoundCometBase` for new symbols, (2) remove the `chainName !== "ethereum"` hard-gates and widen the `chain` enum in the 6 tools (`prepare_compound_supply/withdraw/borrow/repay`, `get_compound_market_info`, `simulate_position_change`) plus update the `chainId === 1` guard in `get_lending_positions`, (3) add per-chain dispatch-coverage tests and cross-chain-fingerprint-distinctness fixtures.

Ethereum behavior is byte-identical by construction: `COMPOUND_COMETS_RAW[1]` is append-only (never mutated), Fixtures R/S/T/U harden against the chainId=1 USDC Comet address which does not change.

**Primary recommendation:** 2-plan structure. Plan 41-01 = SOT extension (addresses + type widening). Plan 41-02 = tool gate removal + test coverage (dispatch tests + cross-chain fixtures). The plans are strictly sequential because the tools' `getAllCompoundCometsForChain` calls depend on the SOT rows existing first.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Comet address registry | `src/config/contracts.ts` (SOT) | — | Phase 28 pattern: all Comet addresses live ONLY in COMPOUND_COMETS_RAW; no inline literals in tools |
| Canonical-dispatch allowlist | `src/security/canonical-dispatch.ts` | SOT via getAllCompoundCometsForChain | Already data-driven; adding SOT rows auto-extends the allowlist — zero code change in dispatch |
| Chain-gate enforcement | Per-tool handler (chainName check + JSON-Schema enum) | — | 5 locations: 4 prepare tools + get_compound_market_info; simulate_position_change and get_lending_positions use `chainId === 1` guards |
| RPC reads (deriveIntent gates) | `src/chains/compound-v3.ts` | `getChainClient(chainId)` from registry | Uses per-chain viem clients already registered for all 5 chains; no new client code needed |
| Test regression anchors | `test/signing-fingerprint.test.ts` | Per-tool test files | Fixtures R/S/T/U = Ethereum byte-identity; new cross-chain-distinctness fixtures = Phase 41 additions |

---

## Per-Chain Verified Comet Table

All Comet proxy addresses verified against the canonical `compound-finance/comet` GitHub repo at
`deployments/<network>/<base-asset>/roots.json` as of 2026-05-29. [VERIFIED: compound-finance/comet GitHub]

Base token addresses verified against `deployments/<network>/<base-asset>/configuration.json`. [VERIFIED: compound-finance/comet GitHub]

### Arbitrum (chainId 42161) — 4 Comets

| Base Asset Symbol | Comet Proxy | Base Token Address | Decimals | Status | Notes |
|---|---|---|---|---|---|
| `USDC` | `0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 | ACTIVE | Native Circle USDC (launched Jan 2026); highest TVL Arbitrum Comet |
| `USDC.e` | `0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA` | `0xff970a61a04b1ca14834a43f5de4533ebddb5cc8` | 6 | ACTIVE (legacy) | Bridged USDC.e; older market runs alongside to avoid liquidity shock |
| `USDT` | `0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07` | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 | ACTIVE | |
| `WETH` | `0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486` | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | 18 | ACTIVE | Same WETH address as `CONTRACTS_RAW[42161].weth` — cross-SOT consistency check required |

**IMPORTANT NOTE — Address collision with Base:** The Arbitrum `USDC` Comet proxy
`0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf` is also the address of the Base `USDbC` Comet on
chainId 8453. This is a real cross-chain coincidence (identical `CREATE2` salt or governance
reuse) — both addresses are genuine Comet proxies on their respective chains. The
`CANONICAL_DISPATCH_TARGETS` `Set<Address>` is per-chain, so the collision is harmless:
`CANONICAL_DISPATCH_TARGETS[42161]` and `CANONICAL_DISPATCH_TARGETS[8453]` are separate sets.
The planner must add a comment in the SOT code noting the cross-chain address coincidence.

### Base (chainId 8453) — 5 Comets (4 recommended + 1 deprecated)

| Base Asset Symbol | Comet Proxy | Base Token Address | Decimals | Status | Notes |
|---|---|---|---|---|---|
| `USDC` | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 | ACTIVE | Native Circle USDC on Base |
| `WETH` | `0x46e6b214b524310239732D51387075E0e70970bf` | `0x4200000000000000000000000000000000000006` | 18 | ACTIVE | OP-Stack WETH predeploy; same address as `CONTRACTS_RAW[8453].weth` |
| `USDS` | `0x2c776041CCFe903071AF44aa147368a9c8EEA518` | `0x820C137fa70C8691f0e44Dc420a5e53c168921Dc` | 18 | ACTIVE | Sky/Maker USDS on Base |
| `AERO` | `0x784efeB622244d2348d4F2522f8860B96fbEcE89` | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` | 18 | ACTIVE | Aerodrome Finance token; non-stablecoin base asset — unusual Comet design |
| `USDbC` | `0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf` | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA` | 6 | DEPRECATED (low TVL ~$82k) | Gauntlet Dec 2024 deprecation recommendation; still operational but being wound down |

**Planner decision required:** Whether to include `USDbC` and `AERO` Comets in the Phase 41 SOT.
Recommendation: **INCLUDE** `USDC`, `WETH`, `USDS`. **INCLUDE** `AERO` with a comment noting
it is a volatile base-asset market. **EXCLUDE** `USDbC` — Gauntlet formally recommended
deprecation (Dec 2024), TVL ~$82k, users are being migrated to native USDC; including a
deprecated market creates support burden. The planner should confirm this exclusion decision.

### Polygon (chainId 137) — 2 Comets

| Base Asset Symbol | Comet Proxy | Base Token Address | Decimals | Status | Notes |
|---|---|---|---|---|---|
| `USDC` | `0xF25212E676D1F7F89Cd72fFEe66158f541246445` | `0x2791bca1f2de4661ed88a30c99a7a9449aa84174` | 6 | ACTIVE (legacy) | **BASE TOKEN IS USDC.e (bridged), NOT native Circle USDC** — the comet repo names this directory "usdc" but the configuration.json shows bridged USDC.e. Native USDC on Polygon is `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`. There is NO native USDC Comet on Polygon per the comet repo directory listing (only "usdc" and "usdt"). The `CompoundCometBase` key for this Comet must be `"USDC.e"` to avoid misleading the agent into thinking the base token is native USDC. |
| `USDT` | `0xaeB318360f27748Acb200CE616E389A6C9409a07` | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | 6 | ACTIVE | Bridged USDT on Polygon |

**IMPORTANT:** The Polygon "usdc" Comet uses **bridged USDC.e** (`0x2791...`), not native Circle USDC
(`0x3c499c...`). This distinction is security-relevant for the agent: the base token address returned
by `Comet.baseToken()` on Polygon will be `0x2791...` not `0x3c499c...`. If the user supplies native
USDC to the Polygon `USDC` Comet, the intent gate will see a mismatch between the supplied asset and
the `baseToken()` return, and correctly route it as collateral-supply rather than base-supply/repay.
The `CompoundCometBase` type literal for this row MUST be `"USDC.e"` (not `"USDC"`) to make the
distinction visible in the type system. [VERIFIED: compound-finance/comet configuration.json]

### Optimism (chainId 10) — 3 Comets

| Base Asset Symbol | Comet Proxy | Base Token Address | Decimals | Status | Notes |
|---|---|---|---|---|---|
| `USDC` | `0x2e44e174f7D53F0212823acC11C01A11d58c5bCB` | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 | ACTIVE | Native Circle USDC on Optimism |
| `USDT` | `0x995E394b8B2437aC8Ce61Ee0bC610D617962B214` | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | 6 | ACTIVE | |
| `WETH` | `0xE36A30D249f7761327fd973001A32010b521b6Fd` | `0x4200000000000000000000000000000000000006` | 18 | ACTIVE | OP-Stack WETH predeploy; same address as `CONTRACTS_RAW[10].weth` |

---

## CompoundCometBase Type Extension

The current type in `src/config/contracts.ts` line 244:

```typescript
export type CompoundCometBase = "USDC" | "USDT" | "WETH" | "USDS" | "wstETH" | "WBTC";
```

Phase 41 extends it with new symbols needed for L2 Comets:

```typescript
export type CompoundCometBase =
  | "USDC"     // Ethereum (cUSDCv3), Arbitrum native, Base native, Optimism native
  | "USDT"     // Ethereum (cUSDTv3), Arbitrum, Polygon, Optimism
  | "WETH"     // Ethereum (cWETHv3), Arbitrum, Base, Optimism
  | "USDS"     // Ethereum (cUSDSv3), Base
  | "wstETH"   // Ethereum (cwstETHv3)
  | "WBTC"     // Ethereum (cWBTCv3)
  | "USDC.e"   // Arbitrum bridged USDC + Polygon bridged USDC (NEW Phase 41)
  | "AERO";    // Base Aerodrome AERO (NEW Phase 41 — only if planner includes AERO Comet)
```

**Rationale for `"USDC.e"` key:** Both Arbitrum and Polygon have a bridged USDC Comet. Using
a distinct key avoids the ambiguity of multiple `"USDC"` rows on different chains pointing to
different token addresses. The `getCompoundCometAddress(chainId, "USDC")` call returns the
native USDC Comet where available (Arbitrum, Base, Optimism) and `null` on Polygon (where only
`"USDC.e"` exists). This is type-safe and correct.

**Note on `"USDbC"`:** If the planner decides to EXCLUDE the deprecated Base USDbC Comet (recommended),
no `"USDbC"` key is needed. If included anyway, add `| "USDbC"` to the type.

### Extended COMPOUND_COMETS_RAW (proposed shape)

```typescript
const COMPOUND_COMETS_RAW: Partial<Record<ChainId, Partial<Record<CompoundCometBase, Address>>>> = {
  1: {
    // UNCHANGED — Fixtures R/S/T/U are hardcoded against these addresses
    USDC:   getAddress("0xc3d688B66703497DAA19211EEdff47f25384cdc3"),
    USDT:   getAddress("0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840"),
    WETH:   getAddress("0xA17581A9E3356d9A858b789D68B4d866e593aE94"),
    USDS:   getAddress("0x5D409e56D886231aDAf00c8775665AD0f9897b56"),
    wstETH: getAddress("0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3"),
    WBTC:   getAddress("0xe85Dc543813B8c2CFEaAc371517b925a166a9293"),
  },
  // Arbitrum One (chainId 42161) — Phase 41 Plan 41-01
  42161: {
    USDC:   getAddress("0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf"),  // native USDC
    "USDC.e": getAddress("0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA"), // bridged USDC.e (legacy)
    USDT:   getAddress("0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07"),
    WETH:   getAddress("0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486"),
  },
  // Polygon PoS (chainId 137) — Phase 41 Plan 41-01
  137: {
    "USDC.e": getAddress("0xF25212E676D1F7F89Cd72fFEe66158f541246445"), // base token = 0x2791... (USDC.e)
    USDT:    getAddress("0xaeB318360f27748Acb200CE616E389A6C9409a07"),
  },
  // Base (chainId 8453) — Phase 41 Plan 41-01
  8453: {
    USDC: getAddress("0xb125E6687d4313864e53df431d5425969c15Eb2F"),
    WETH: getAddress("0x46e6b214b524310239732D51387075E0e70970bf"),
    USDS: getAddress("0x2c776041CCFe903071AF44aa147368a9c8EEA518"),
    AERO: getAddress("0x784efeB622244d2348d4F2522f8860B96fbEcE89"),  // include/exclude: planner decision
  },
  // OP Mainnet (chainId 10) — Phase 41 Plan 41-01
  10: {
    USDC: getAddress("0x2e44e174f7D53F0212823acC11C01A11d58c5bCB"),
    USDT: getAddress("0x995E394b8B2437aC8Ce61Ee0bC610D617962B214"),
    WETH: getAddress("0xE36A30D249f7761327fd973001A32010b521b6Fd"),
  },
};
```

**Total new Comet addresses:** 13 (recommended) or 12 (if AERO excluded) or 14 (if USDbC included).
**Impact on canonical-dispatch:** `getAllCompoundCometsForChain` is already called for every chain in
`buildPerChainAllowlist`. Adding rows to `COMPOUND_COMETS_RAW` extends the dispatch allowlist for the
corresponding chains with ZERO code change to `canonical-dispatch.ts`. [VERIFIED: src/security/canonical-dispatch.ts line 128]

---

## Chain-Gate Gap Analysis — What the Tools Currently Block

Every tool that was chain-gated in Phase 28 has the same pattern in two locations:

### JSON-Schema `chain` field

```typescript
chain: {
  enum: ["ethereum"],  // MUST widen to ["ethereum","arbitrum","polygon","base","optimism"]
  ...
}
```

Files to update: `prepare_compound_supply.ts`, `prepare_compound_withdraw.ts`,
`prepare_compound_borrow.ts`, `prepare_compound_repay.ts`, `get_compound_market_info.ts`.

### Handler-level chain check

```typescript
if (chainName !== "ethereum") {
  return { isError: true, content: [{ type: "text",
    text: `error: invalid 'chain': Compound V3 v2.3 supports only 'ethereum', got "${chainName}"` }] };
}
```

**Replacement:** Remove the `if (chainName !== "ethereum")` block entirely. The downstream
`getAllCompoundCometsForChain(chainId)` already handles "no Comets on this chain" by returning `[]`,
which the tools use as the canonical-validation list — a non-canonical Comet address on any chain
(including chains with zero Comets) will naturally produce an `INVALID_INPUT` refusal at the
`canonicalComets.includes(cometAddress)` check.

**Tool description string update:** The `chain` description in each tool currently says
`"v2.3-locked to \"ethereum\""` — update to describe all 5 chains.

### `get_lending_positions.ts` hard-gate

```typescript
// Line 469: chainId !== 1 → empty compound positions
if (chainId !== 1) { return []; }
// Lines 628-640: Promise.all fan-out skips Compound on non-mainnet
chainId === 1
  ? _compoundChains.getAllCometStates(...)
  : Promise.resolve([])
```

**Replacement:** Remove `chainId !== 1` guard; call `getAllCometStates` for all chains that have
Comets (i.e., `getAllCompoundCometsForChain(chainId).length > 0`). The `getAllCometStates` call
already takes a generic `client + chainId`; it will work identically on L2 chains.

### `simulate_position_change.ts` hard-gate

```typescript
// Line 527: "Compound V3 v2.3 scope: Ethereum mainnet only."
if (input.chainId !== 1) {
  return { isError: true, ... `protocol "compound-v3" requires chainId 1 (got ${input.chainId})` };
}
```

**Replacement:** Remove the `input.chainId !== 1` guard. Replace the validation logic with:
check that `getAllCompoundCometsForChain(input.chainId).length > 0` AND that the supplied
`cometAddress` is in that list. An unsupported chain (e.g., Scroll) will produce an `INVALID_INPUT`
at the cometAddress validation step, not a chain-ID hard-gate.

### `get_compound_market_info.ts` — NO hard chainId guard found

The file uses `enum: ["ethereum"]` in the schema and calls `getAllCompoundCometsForChain(chainId)` for
validation — but does NOT have an explicit `chainName !== "ethereum"` handler check (unlike the
prepare tools). The only chain restriction is the `enum: ["ethereum"]` schema field. Widening the
enum is sufficient here.

---

## Canonical-Dispatch Extension Pattern

The canonical-dispatch.ts file requires **ZERO code changes** for Phase 41. The existing code at
lines 122-128 already reads:

```typescript
// Phase 28 — Plan 28-04. Compound V3 Comets via the SOT getter (`getAllCompoundCometsForChain`
// — Plan 28-01). NO inline literals here. Phase 28 ships ONLY the Ethereum arm (chainId === 1
// → 6 Comets); other chains return `[]` per the SOT contract. v2.3.x adds Polygon / Arbitrum /
// Base / Optimism Comets, at which point the SOT getter widens and this builder picks them up
// automatically — zero code change here.
const compoundComets = getAllCompoundCometsForChain(chainId);
```

This comment explicitly anticipates Phase 41. Adding rows to `COMPOUND_COMETS_RAW` for Arbitrum /
Polygon / Base / Optimism causes `getAllCompoundCometsForChain(42161)` etc. to return non-empty
arrays, which are spread into the respective `Set<Address>` in `buildPerChainAllowlist`. [VERIFIED: src/security/canonical-dispatch.ts]

**Dispatch allowlist size impact (post-Phase 41):**

| Chain | Pre-Phase-41 | Compound Additions | Post-Phase-41 |
|---|---|---|---|
| Ethereum (1) | 44 | 0 | 44 (unchanged) |
| Arbitrum (42161) | 25 | +4 (USDC, USDC.e, USDT, WETH) | 29 |
| Polygon (137) | 26 | +2 (USDC.e, USDT) | 28 |
| Base (8453) | 12 | +3 or +4 (USDC, WETH, USDS, ±AERO) | 15 or 16 |
| Optimism (10) | 21 | +3 (USDC, USDT, WETH) | 24 |

The comment at lines 249-253 in canonical-dispatch.ts documents current counts per chain — the planner
must update these counts in the canonical-dispatch.ts comment block after the SOT is populated.

---

## ABI Compatibility: L2 Comet ABI Is Identical to Mainnet

The Compound V3 Comet ABI is uniform across all chains. The 8 functions in
`COMPOUND_V3_COMET_ABI` (`supply`, `withdraw`, `baseToken`, `balanceOf`, `borrowBalanceOf`,
`collateralBalanceOf`, `isBorrowCollateralized`, `isLiquidatable`) plus the 9 read-tool additions
are guaranteed consistent across deployments — all Comets are deployed from the same
`CometMainInterface.sol` source regardless of chain.

**`_compoundChains.deriveIntent` works unchanged on L2:** The function only calls
`readBaseToken(client, comet)`, `readBorrowBalance(client, comet, user)`, and
`readBaseBalance(client, comet, user)` — all of which use `client.readContract` with the
`COMPOUND_V3_COMET_ABI`. Since `getChainClient(chainId)` in `src/chains/registry.ts` already
provides viem clients for chainId 42161, 137, 8453, and 10, there is NO new client code needed.
[VERIFIED: src/chains/compound-v3.ts; src/chains/registry.ts]

**Comet reward token differences:** The Compound `CometRewards` contract distributes COMP on
Ethereum. On L2s, the reward token may differ (e.g., COMP bridged version or a different token).
Phase 28's `get_compound_market_info` does NOT surface reward APR — it reads supply/borrow APR
only. Reward differences are therefore not a concern for Phase 41 scope.

---

## Per-Chain Gotchas

### Gotcha 1: Polygon "USDC" Comet uses bridged USDC.e, not native USDC

The comet repo directory is named `usdc` but `configuration.json` shows
`baseToken: 0x2791bca1f2de4661ed88a30c99a7a9449aa84174` — the bridged USDC.e token.
Native Circle USDC on Polygon is `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` and has NO
separate Compound Comet. The `CompoundCometBase` key for this row MUST be `"USDC.e"` to avoid
an agent erroneously supplying native USDC expecting it to be the base asset.

### Gotcha 2: Cross-chain address coincidence (Arbitrum USDC = Base USDbC proxy)

Both `deployments/arbitrum/usdc/roots.json` and `deployments/base/usdbc/roots.json` return
`comet: 0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf`. This is a real fact verified from two
independent files. It is harmless for dispatch (per-chain sets) but the SOT code must have a
comment explaining the coincidence so future reviewers do not assume a copy-paste error.

### Gotcha 3: Base USDbC Comet is in active deprecation (Gauntlet Dec 2024)

TVL ~$82k as of Nov 2025. Gauntlet formally recommended deprecation via parameter changes.
The Comet is still operational but being wound down. **Recommendation: exclude from Phase 41.**
Including it creates a permanent SOT entry for a market users are being migrated away from.

### Gotcha 4: Base AERO Comet is a volatile-base-asset market

AERO (Aerodrome token) is the base asset of one Compound V3 Comet on Base. This is atypical —
most Comets use stablecoins or ETH as the base. The volatility means borrow APR dynamics differ
significantly from stablecoin Comets. The tool works identically (same ABI), but the
`LEDGER_NOTICE_COMPOUND_TEMPLATE` applies uniformly. **Decision for planner:** include or exclude.
Including is safe from a code perspective; it just adds one more address to the Base dispatch arm.

### Gotcha 5: WETH coincidence on Base and Optimism

The Base WETH Comet base token (`0x4200000000000000000000000000000000000006`) is the same
address as `CONTRACTS_RAW[8453].weth` and `CONTRACTS_RAW[10].weth`. Similarly for Optimism WETH
Comet. The Arbitrum WETH Comet base token (`0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`) is
the same as `CONTRACTS_RAW[42161].weth`. The planner must add a cross-SOT consistency comment
(or test assertion) confirming these are the same values — mirroring the EigenLayer/Lido
cross-SOT pattern from Phase 31.

### Gotcha 6: `getChainClient` for Polygon/Base/Optimism already registered

`src/chains/registry.ts` already registers clients for all 5 chain IDs
(1, 42161, 137, 8453, 10). `_compoundChains.deriveIntent` takes a `client: PublicClient` arg —
the tools call `getChainClient(chainId)` and pass the result. No registry changes needed.

### Gotcha 7: Token registry coverage for L2 base tokens

`loadTokenRegistry(chainId)` is used by prepare tools for decimal resolution. The L2 top-50
token registries (from Phase 8 Plan 08-03) include the main stablecoins and WETH for Arbitrum,
Polygon, Base, and Optimism. However, `AERO` (Base) and bridged `USDC.e` on Arbitrum/Polygon
may not be in the top-50 lists. The tools fall back to `resolveDecimals` via RPC when a token
is not in the registry — this is the Phase 28 path and works correctly. No new token registry
entries are strictly required, but the planner may choose to add them for performance.

---

## FROZEN Constraints

These files and regions MUST show zero git diff versus `origin/main` after Phase 41 merges:

| File | Region | Constraint |
|---|---|---|
| `src/signing/payload-fingerprint.ts` | Entire file | BYTE-FROZEN — no changes |
| `src/signing/presign-hash.ts` | Entire file | BYTE-FROZEN — no changes |
| `src/signing/handle-store.ts` | State machine | BYTE-FROZEN — no changes |
| `src/tools/send_transaction.ts` | 3-gate region | BYTE-FROZEN — no changes |
| `test/signing-fingerprint.test.ts` | Fixtures R, S, T, U literal values | Hardcoded `0x...` anchors — MUST NOT CHANGE |
| `src/protocols/compound-v3.ts` | ABI + selectors | APPEND-ONLY — no selector changes |
| `src/security/canonical-dispatch.ts` | `buildPerChainAllowlist` function | ZERO CODE CHANGE needed |

**Error-code union stays FROZEN at 21 codes.** No new error codes for Phase 41. L2 refusals for
non-canonical Comet addresses reuse `INVALID_INPUT + hintTool`, same as Phase 28 Ethereum pattern.

---

## Fixture-Addition Pattern for Phase 41

Phase 28 established Fixtures R/S/T/U as Ethereum byte-identity anchors. Phase 41 must add
cross-chain-distinctness fixtures per ROADMAP § Phase 41 Success Criterion 6:

> "cross-chain fingerprint distinctness asserted (same Comet shape on different chains yields distinct `payloadFingerprint`)"

### Pattern

Following the Phase 28 template in `test/signing-fingerprint.test.ts`:

1. Pick ONE representative Comet per chain (e.g., USDC on each chain that has it).
2. Run `encodeCompoundSupply(usdcAddress, 100e6)` with the per-chain USDC address.
3. Compute `computePayloadFingerprint({ chainId, to: cometAddress, value: 0n, data })`.
4. Hardcode the resulting `0x...` as a literal anchor (name: `FIXTURE_CMP_ARB_A`, etc.).
5. Assert `distinctness`: all per-chain fingerprints plus Fixture R must be in a `Set` of
   unique values (the 4-chain fan-out for the same logical operation must produce 4 distinct
   fingerprints because `chainId` and `to` both flow into the preimage).

**Fixture naming convention (recommended):**

| Name | Chain | Shape | Description |
|---|---|---|---|
| `FIXTURE_CMP_ARB_A` | Arbitrum | supply(native-USDC, 100e6) on cUSDCv3-arb | Cross-chain distinctness anchor |
| `FIXTURE_CMP_BASE_A` | Base | supply(USDC, 100e6) on cUSDCv3-base | Cross-chain distinctness anchor |
| `FIXTURE_CMP_OPT_A` | Optimism | supply(USDC, 100e6) on cUSDCv3-opt | Cross-chain distinctness anchor |
| `FIXTURE_CMP_POLY_A` | Polygon | supply(USDC.e, 100e6) on cUSDCe-poly | Cross-chain distinctness anchor |

The distinctness test: `new Set([FIXTURE_R_fp, FIXTURE_CMP_ARB_A_fp, FIXTURE_CMP_BASE_A_fp, FIXTURE_CMP_OPT_A_fp, FIXTURE_CMP_POLY_A_fp]).size === 5`.

**DO NOT use `beforeAll`-snapshot** — per CLAUDE.md fixture-pinning rule, values must be
hardcoded literals at write-time so drift in preimage assembly fails at a specific line, not
against a self-snapshotted value.

---

## Dispatch-Coverage Tests

Phase 41 Success Criterion 7: "Per-chain dispatch-coverage tests added (each new Comet address
resolves through `checkDispatchTarget` on its chain)".

Pattern (mirrors Phase 28 Plan 28-04 dispatch test):

```typescript
// test/canonical-dispatch-compound-l2.test.ts (new file)
import { CANONICAL_DISPATCH_TARGETS } from "../src/security/canonical-dispatch.js";
import { getAllCompoundCometsForChain } from "../src/config/contracts.js";

describe("Compound L2 Comet dispatch coverage", () => {
  for (const chainId of [42161, 137, 8453, 10] as const) {
    const comets = getAllCompoundCometsForChain(chainId);
    const allowlist = CANONICAL_DISPATCH_TARGETS[chainId];
    for (const comet of comets) {
      it(`chainId ${chainId} Comet ${comet} resolves through checkDispatchTarget`, () => {
        expect(allowlist.has(comet)).toBe(true);
      });
    }
  }
});
```

This is O(N_new_comets) unit tests, all synchronous, no mocking needed.

---

## Architecture Patterns

### Recommended Project Structure Changes

```
src/config/contracts.ts     — EXTEND COMPOUND_COMETS_RAW + widen CompoundCometBase type
src/tools/prepare_compound_supply.ts     — Remove chain gate + widen enum
src/tools/prepare_compound_withdraw.ts   — Remove chain gate + widen enum
src/tools/prepare_compound_borrow.ts     — Remove chain gate + widen enum
src/tools/prepare_compound_repay.ts      — Remove chain gate + widen enum
src/tools/get_compound_market_info.ts    — Widen enum (no handler gate to remove)
src/tools/get_lending_positions.ts       — Remove chainId !== 1 guard (2 locations)
src/tools/simulate_position_change.ts    — Remove chainId !== 1 guard
test/signing-fingerprint.test.ts         — Add Fixtures CMP_ARB_A / CMP_BASE_A / CMP_OPT_A / CMP_POLY_A
test/canonical-dispatch-compound-l2.test.ts  — NEW: dispatch-coverage tests
```

**Files NOT changed:**
- `src/security/canonical-dispatch.ts` — zero changes (data-driven, SOT getter already wired)
- `src/protocols/compound-v3.ts` — zero changes (ABI is chain-agnostic)
- `src/chains/compound-v3.ts` — zero changes (reads are generic, use client param)
- `src/chains/registry.ts` — zero changes (all 5 chains already registered)

---

## Recommended Plan Breakdown

### Plan 41-01: SOT Extension + `CompoundCometBase` type widening

**What:** Extend `COMPOUND_COMETS_RAW` with verified Comet rows for Arbitrum, Polygon, Base,
Optimism. Widen `CompoundCometBase` type literal union with `"USDC.e"` (and `"AERO"` if the
planner includes it). Add comments explaining address coincidences (Arb-USDC = Base-USDbC
proxy address on different chains; WETH Comet base tokens = CONTRACTS_RAW WETH addresses).

**Artifacts touched:** `src/config/contracts.ts` only.

**Tests:** `test/config-contracts.test.ts` — add:
  - `getAllCompoundCometsForChain(42161).length === 4` (or expected count)
  - `getAllCompoundCometsForChain(137).length === 2`
  - `getAllCompoundCometsForChain(8453).length === 3` (or 4 with AERO)
  - `getAllCompoundCometsForChain(10).length === 3`
  - Cross-SOT WETH consistency: `getCompoundCometAddress(8453, "WETH")!` baseToken equals `getWethAddress(8453)` — via comment (the actual base-token address is verified in configuration.json, not at runtime)

**NOT in this plan:** Tool gate changes, new fixture literals, dispatch tests.

**Wave:** Wave 1 (no dependency on other Phase 41 work).

**Parallelism:** Cannot parallelize with 41-02 (41-02 depends on SOT rows existing for tests to pass).

---

### Plan 41-02: Tool gate removal + regression coverage

**What:** Remove `chainName !== "ethereum"` hard-gates in 4 prepare tools; widen `chain`
enum to all 5 chain names; update tool description strings; remove `chainId !== 1` Compound
guards in `get_lending_positions` and `simulate_position_change`; widen `get_compound_market_info`
chain enum. Add cross-chain-distinctness Fixtures in `test/signing-fingerprint.test.ts`.
Add `test/canonical-dispatch-compound-l2.test.ts` dispatch-coverage tests.

**Artifacts touched:** 6 tool files + 2 test files (1 existing + 1 new).

**Shared-SOT-file collision risk with Plan 41-01:** NO shared file collision — 41-01 only
touches `src/config/contracts.ts`; 41-02 only touches `src/tools/*` and `test/*`. Plans can be
PRed in sequence with zero conflict risk.

**Integration test extension:** The existing `test/compound-v3-lifecycle.integration.test.ts`
should be extended or a new per-chain integration test added. The minimum required by the phase
goal is one lifecycle round-trip per L2 chain using the correct Comet address. The planner
should decide whether to extend the existing test (adding L2 branches after the Ethereum loop)
or create a separate file.

**Wave:** Wave 2 (depends on Wave 1 / Plan 41-01 merging so the SOT rows are in place).

---

### Parallelism Assessment

| Plan | Dependencies | Parallelizable? |
|---|---|---|
| 41-01 (SOT) | None (purely additive) | Yes — can start immediately |
| 41-02 (tools + tests) | Requires 41-01 SOT rows to exist | No — sequential after 41-01 |

There is no safe path to parallelize 41-01 and 41-02 because 41-02's dispatch-coverage tests
call `getAllCompoundCometsForChain(42161)` etc., which return `[]` until 41-01 merges.

---

## Validation Architecture

`nyquist_validation: true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|---|---|
| Framework | vitest 2.1.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/config-contracts.test.ts test/canonical-dispatch-compound-l2.test.ts test/signing-fingerprint.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| CMP-06 (multi-chain) | COMPOUND_COMETS_RAW has L2 rows | unit | `npx vitest run test/config-contracts.test.ts` | ✅ (extend) |
| Phase 41 SC-4 | Dispatch arms extended for L2 Comets | unit | `npx vitest run test/canonical-dispatch-compound-l2.test.ts` | ❌ Wave 2 new file |
| Phase 41 SC-6 | Fixtures R/S/T/U unchanged + cross-chain distinctness | unit | `npx vitest run test/signing-fingerprint.test.ts` | ✅ (extend) |
| Phase 41 SC-7 | checkDispatchTarget resolves all new Comet addresses | unit | `npx vitest run test/canonical-dispatch-compound-l2.test.ts` | ❌ Wave 2 new file |
| Phase 41 SC-3 | prepare_compound_* accept L2 chains + fire deriveIntent | integration | `npx vitest run test/compound-v3-lifecycle.integration.test.ts` | ✅ (extend) |

### Wave 0 Gaps

- [ ] `test/canonical-dispatch-compound-l2.test.ts` — NEW dispatch-coverage test file (Plan 41-02)
- [ ] `test/signing-fingerprint.test.ts` fixtures `CMP_ARB_A` / `CMP_BASE_A` / `CMP_OPT_A` / `CMP_POLY_A` — 4 new hardcoded literals (Plan 41-02)

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 2` in config.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V5 Input Validation | YES | `getAllCompoundCometsForChain(chainId)` allowlist check on `cometAddress` arg; rejects non-canonical addresses before any RPC spend |
| V4 Access Control | YES | `checkDispatchTarget` Layer 0.5 gate in `preview_send.ts`; new L2 Comet addresses extend the allowlist additively |
| V2 Authentication | NO | Chain expansion does not affect auth surface |
| V6 Cryptography | NO — FROZEN | `payload-fingerprint.ts` UNCHANGED; cross-chain distinctness is a test assertion, not a code change |

### Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Agent supplies wrong-chain Comet address | Tampering | `getAddress`-wrapped EIP-55 check + allowlist gate; non-canonical address refuses BEFORE any RPC spend |
| Agent claims `supply` on Arbitrum but real intent is `repay-debt` | Tampering | `_compoundChains.deriveIntent` fires per-chain using `getChainClient(chainId)` RPC — same gate as Ethereum |
| Comet address slip between chains (agent uses Ethereum USDC Comet on Arbitrum) | Tampering | Per-chain `getAllCompoundCometsForChain(chainId)` validation; cross-chain address reuse `0x9c4ec768...` (Arb-USDC / Base-USDbC coincidence) is disambiguated by the chain parameter — the canonical-dispatch check is per-chain-specific |
| Wrong base-token assumption on Polygon USDC.e | Spoofing | `CompoundCometBase` key `"USDC.e"` makes it explicit in the type system; `baseToken()` RPC read in `deriveIntent` confirms at runtime |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Per-chain Comet address lookup | Custom mapping in tool handler | `getCompoundCometAddress(chainId, base)` SOT getter | Already exists; inline literals are forbidden by CLAUDE.md |
| Chain validation | Per-tool `if (chainId !== X)` enumerations | `getAllCompoundCometsForChain(chainId).length > 0` (implicit) | Chains without rows auto-refuse at the cometAddress validation step |
| Dispatch allowlist extension | Manually adding addresses to canonical-dispatch.ts | Add SOT rows; getter picks up automatically | Phase 28 architect explicitly designed for this — zero code change in dispatch |

---

## Open Questions (RESOLVED)

> All three resolved at the planning gate (2026-05-29) by the orchestrator per the Phase 41 locked-scope decisions. Recorded here for audit trail.

1. **Include AERO Comet on Base?** — **RESOLVED: INCLUDED.**
   - What we know: `0x784efeB622244d2348d4F2522f8860B96fbEcE89`, base token AERO (18 dec), active and deployed
   - Decision: Include it — code complexity is identical; it just adds one address to the Base dispatch arm. The `LEDGER_NOTICE_COMPOUND_TEMPLATE` fires for all Compound interactions anyway. SOT row carries a "volatile base asset" comment.

2. **Exclude deprecated Base USDbC Comet?** — **RESOLVED: EXCLUDED.**
   - What we know: In deprecation since Gauntlet Dec 2024 recommendation, TVL ~$82k
   - Decision: Exclude — permanent SOT entry for a market being shut down creates long-term maintenance burden. Users with an existing USDbC position exit via the `prepare_custom_call` escape hatch (Phase 35). SOT carries a deliberate-exclusion comment; a Task-2 negative assertion proves the address is absent from the Base dispatch arm.

3. **`USDC.e` as a `CompoundCometBase` key vs reusing `"USDC"` for bridged markets** — **RESOLVED: distinct `"USDC.e"` key adopted.**
   - Decision: Use `"USDC.e"` as a distinct key for both the Arbitrum legacy bridged market and the Polygon market (whose "usdc" Comet base token IS bridged USDC.e `0x2791…`, not native USDC). On Polygon specifically, the user may have native USDC in their wallet expecting to supply it to the USDC Comet — the `deriveIntent` gate would correctly classify native USDC as collateral, but a distinct type key at the SOT level makes the distinction explicit and prevents symbol confusion.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Base USDbC Comet TVL is ~$82k and actively being deprecated as of research date | Per-chain gotchas | If it has recovered TVL, exclusion creates a gap for users with existing USDbC positions |
| A2 | Arbitrum USDC.e Comet `0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA` remains operational alongside native USDC | Arbitrum comet table | If USDC.e is deprecated, including it creates a support burden |
| A3 | AERO decimals are 18 (standard for ERC-20 governance tokens) | Base comet table | If wrong (unlikely), `resolveDecimals` RPC fallback corrects it at runtime |

---

## Sources

### Primary (HIGH confidence)
- `compound-finance/comet` GitHub `deployments/*/roots.json` — all 12 Comet proxy addresses verified via direct WebFetch of raw JSON
- `compound-finance/comet` GitHub `deployments/*/configuration.json` — all base token addresses verified
- `src/security/canonical-dispatch.ts` (codebase) — confirmed `getAllCompoundCometsForChain` is already called per chain
- `src/config/contracts.ts` (codebase) — confirmed `COMPOUND_COMETS_RAW` shape and `CompoundCometBase` type
- `src/tools/prepare_compound_*.ts` (codebase) — confirmed exact `chainName !== "ethereum"` guard locations

### Secondary (MEDIUM confidence)
- [compound-react.mintlify.app/concepts/networks-markets](https://compound-react.mintlify.app/concepts/networks-markets) — cross-verified Arbitrum USDC.e and USDC Comet addresses; confirmed Base USDC and WETH Comet addresses
- [Gauntlet Base USDbC deprecation thread](https://www.comp.xyz/t/gauntlet-base-usdbc-deprecation-recommendations-12-5-24/6029) — deprecation recommendation (confirmed in WebSearch result; direct fetch returned 403)

### Tertiary (LOW confidence — WebSearch)
- Compound V3 AERO Comet on Base — existence confirmed via directory listing from GitHub; TVL not independently verified

---

## Metadata

**Confidence breakdown:**
- Comet addresses: HIGH — verified via direct WebFetch of `compound-finance/comet` `roots.json` files
- Base-token addresses: HIGH — verified via `configuration.json` files
- USDbC deprecation status: MEDIUM — WebSearch confirmed Gauntlet recommendation; exact current status uncertain
- ABI compatibility: HIGH — Compound V3 ABI is uniform across chains (single CometMainInterface.sol)
- Chain-threading completeness: HIGH — codebase confirmed all 5 chains have `getChainClient` entries

**Research date:** 2026-05-29
**Valid until:** 2026-08-29 (Comet deployments are stable; check for new Comet additions or deprecations at planning time)
