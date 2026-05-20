# Phase 30: Lido — stake / unstake / wrap / unwrap (stETH↔wstETH) — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 30`)

<domain>
## Phase Boundary

User can stake ETH (mints stETH), unstake stETH (queues withdrawal via the WithdrawalQueue NFT), wrap stETH→wstETH (rebase-resistant wrapped form), and unwrap wstETH→stETH. Reads on Ethereum mainnet + Arbitrum (bridged stETH/wstETH); writes Ethereum-only.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 30`. Anchor candidates:

- **WithdrawalQueue NFT surfacing**: `prepare_lido_unstake` returns an NFT receipt (the WithdrawalQueue mints a position NFT when the user queues a withdrawal). The NFT becomes claimable once the unstake settles (variable: hours to days). CHECKS PERFORMED surfaces the NFT-receipt expectation.
- **stETH rebase vs wstETH non-rebase**: stETH is a rebasing token (balance increases over time as Lido validators earn); wstETH is the non-rebasing wrapped form preferred for DeFi composability. Phase 30 surfaces both balances in `get_lido_positions` + the conversion-rate at read time.
- **Ethereum-write-only**: stETH/wstETH bridged variants exist on Arbitrum (and other L2s) but minting via `Lido.submit` is Ethereum-only. Phase 30 refuses writes on non-Ethereum chains with structured error pointing at the EVM bridge path.
- **stETH rebase reward decoding**: `accruedRebaseRewards` in `get_lido_positions` is computed from the rebase delta between the wallet's first stETH-receipt block and now. Approximate (exact accounting needs full transfer history).

### Claude's Discretion

- Internal helper names (`LidoReader`, `parseLidoConversion`, etc.)
- Fixture V/W/X literal anchor values
- Whether NFT-receipt surfacing ships as a separate `[NFT RECEIPT EXPECTED]` block or inline in CHECKS PERFORMED

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — `src/config/contracts.ts` SOT discipline
- `.planning/REQUIREMENTS.md` §LIDO-01..05 — exact Phase 30 surface
- `.planning/ROADMAP.md` Phase 30
- `src/protocols/weth9.ts` (Plan 06-04) — wrap/unwrap protocol-decoder pattern; Phase 30 mirrors for stETH↔wstETH
- Lido docs — https://docs.lido.fi/

</canonical_refs>

<specifics>
## Specific Ideas

- Lido's WithdrawalQueue v2 (deployed 2023) replaces the legacy on-demand unstake with a queue-based + NFT-receipt model. Phase 30 ships against the v2 contract; v1 is deprecated.
- Conversion rate stETH ↔ wstETH is non-1:1 (wstETH represents a share of the stETH supply; the share's stETH value grows as Lido earns rebase rewards). `get_lido_positions` surfaces the current rate so the agent can show users the equivalent value.
- Phase 30 uses standard prepare/preview/send pipeline; no special primitives needed. CHECKS PERFORMED surfaces the decoded `submit` / `requestWithdrawals` / `wrap` / `unwrap` args.

</specifics>

<deferred>
## Deferred Ideas

- WithdrawalQueue NFT claim flow (`prepare_lido_claim_withdrawal`) — defer until v2.3 verify-phase validates user demand
- Cross-chain stETH bridging (Lido's stETH is on multiple L2s; Phase 30 reads on Arbitrum; bridge tools live in v2.6 BRIDGE-T1)
- Lido staked LST receipts (stMATIC, etc.) — out of scope; v2.3 LIDO-* is stETH/wstETH only

</deferred>

---

*Phase: 30-evm-lido-stake-unstake-wrap-unwrap*
*Context placeholder: 2026-05-20*
