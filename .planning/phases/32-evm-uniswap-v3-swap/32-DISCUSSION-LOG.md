# Phase 32 — Discussion Log

**Phase:** 32 — EVM Uniswap V3 swap (auto-fee-tier, same-chain)
**Discussed:** 2026-05-23
**Mode:** `--auto` (autonomous per `[[autonomous-phase-execution]]` user preference)

This log is for human reference (audits, retrospectives). Downstream agents read `32-CONTEXT.md` instead.

## Gray Areas Identified

Per Phase 32 placeholder `32-CONTEXT.md` (gathered 2026-05-20) + ROADMAP.md plan stub + REQUIREMENTS.md §UNI-01/02/03/10 + §MEV-01:

1. **Router target (SwapRouter02 vs UniversalRouter)** — auto-resolved to SwapRouter02
2. **Quoter V2 vs V1** — auto-resolved to Quoter V2
3. **Auto-fee-tier selection algorithm** — auto-resolved to per-tier iteration + multi-hop with 0.5% improvement threshold
4. **Sandwich-MEV defense shape** — auto-resolved to clone of Phase 20 SunSwap pattern (50bps / 2% / explicit-slippage gate)
5. **Native ETH support (ETH-in / ETH-out)** — auto-resolved to support both via `msg.value` (ETH-in) + `multicall + unwrapWETH9` (ETH-out)
6. **Deadline enforcement** — auto-resolved to `multicall(deadline, [...])` wrapper (SwapRouter02 drops native deadline)
7. **Canonical-dispatch wiring** — auto-resolved to extend Ethereum arm + promote KNOWN_SPENDERS_ETHEREUM SwapRouter02 entry to SOT-getter
8. **Fixture letter assignment** — auto-resolved to `UNI-A` / `UNI-B` / `UNI-C` (protocol-prefix scheme matching Phase 31 `AA-RP` / `AB-RP`)
9. **Multi-hop fee-tier mapping** — surfaced to researcher (D-04 step 3); baseline hardcoded
10. **Price-impact midpoint methodology** — auto-resolved to Quoter V2 tiny-amount reference; production-grade oracle midpoint deferred to Phase 40

## Auto-Mode Selection Log

```
[auto] Router target — Q: "SwapRouter02 vs UniversalRouter?" → Selected: "SwapRouter02"
  Rationale: UniversalRouter requires Permit2-signed typed data; defer until typed-data clear-sign lands.
  Source: ROADMAP.md v2.4 UNI deferred note; REQUIREMENTS.md Permit2 carve-out.

[auto] Quoter version — Q: "Quoter V2 vs V1?" → Selected: "Quoter V2"
  Rationale: Quoter V2 is the current SOT; V1 is legacy. Verified address 0x61fFE014bA17989E743c5F6cB21bF9697530B21e against Uniswap docs.

[auto] Auto-fee-tier algorithm — Q: "Single-call to Quoter V2 vs per-tier iteration vs SOR-style algorithmic?" → Selected: "per-tier iteration + canonical multi-hop"
  Rationale: Quoter V2 doesn't auto-select fee tiers; per-tier iteration is the documented pattern. Multi-hop with canonical fee-tier mapping keeps the surface narrow at v2.4.

[auto] Sandwich-MEV gate — Q: "Clone Phase 20 SunSwap pattern (50bps default / >2% explicit-slippage refusal) vs custom?" → Selected: "Clone Phase 20 pattern"
  Rationale: Pattern is proven; REQUIREMENTS.md §UNI-03 + §MEV-01 explicitly mirror Phase 20 SunSwap + Phase 14 Jupiter.

[auto] Native ETH support — Q: "ETH-only / WETH-only / both?" → Selected: "Both ETH-in and ETH-out"
  Rationale: CONTEXT placeholder explicitly states "ERC-20↔ERC-20 (and WETH-wrapped ETH)". Standard Uniswap UX.

[auto] Deadline enforcement — Q: "Multicall-deadline wrapper vs no deadline vs router-level deadline?" → Selected: "multicall(deadline, [...])"
  Rationale: SwapRouter02 drops native deadline; multicall-deadline is the documented Uniswap pattern. Defense-in-depth against pending-tx replay.

[auto] Canonical-dispatch — Q: "Add SwapRouter02 only vs SwapRouter02 + Quoter V2?" → Selected: "SwapRouter02 only"
  Rationale: Quoter V2 is read-only via eth_call; canonical-dispatch gates the send-path only. Phase 30 Lido-arm precedent.

[auto] Fixture letters — Q: "Z/AA/AB continuation vs protocol-prefix scheme (UNI-A / UNI-B)?" → Selected: "Protocol-prefix scheme"
  Rationale: Phase 31 introduced the protocol-prefix scheme (AA-RP / AB-RP) — Phase 32 inherits. Provides per-protocol fixture-letter namespacing.

[auto] Multi-hop fee-tier mapping — Q: "Hardcoded canonical mapping (WETH/USDC=0.05%, etc.) vs iterate-all?" → Selected: "Hardcoded canonical (researcher determines exact values at planning gate)"
  Rationale: Combinatorial blowup; deferred to v3.x algorithmic-routing surface.

[auto] Price-impact midpoint — Q: "Quoter V2 tiny-amount vs Chainlink oracle vs TWAP?" → Selected: "Quoter V2 tiny-amount"
  Rationale: Quoter-midpoint is impact-free reference for the same pool; production-grade oracle midpoint deferred to Phase 40 per-L2 calibration.
```

## Deferred Items (full list in `32-CONTEXT.md` `<deferred>`)

- UniversalRouter integration (waits on typed-data clear-sign)
- Per-L2 sandwich-MEV thresholds (Phase 40 MEV-01)
- Production-grade midpoint sourcing (Phase 40)
- Multi-hop combinatorial fee-tier iteration (v3.x)
- Uniswap V2 + V4 swap surfaces
- Multi-chain Uniswap surface (may be folded into Phase 32 if researcher confirms non-disruptive SOT extension)
- Uniswap X (intent-based RFQ)
- Slippage-hint pre-calculation surface
- Token allowance auto-revoke after swap

## Claude's Discretion Items (planner/researcher judgment)

- Internal helper names (`UniswapV3Quoter`, `selectBestFeeTier`, `encodeV3Path`, etc.)
- Whether path-bytes encoder lives in `src/protocols/uniswap-v3.ts` or `src/signing/uniswap-path.ts` (pure-byte separation is default expectation)
- Plan structure — 3 plans (32-01 / 32-02 / 32-03) matches ROADMAP plan stub; researcher may propose different waveform after research gate
- Exact canonical pair-to-fee-tier mapping for multi-hop (D-04 step 3)
- Whether `multicall(deadline, [...])` is the canonical deadline-enforcement wrapper or whether SwapRouter02 ships a `selfPermit` variant Phase 32 should use instead (researcher verifies)

---

*Phase: 32-evm-uniswap-v3-swap*
*Discussion: 2026-05-23 (auto-mode)*
