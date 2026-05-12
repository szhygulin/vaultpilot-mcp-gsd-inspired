# VaultPilot MCP (GSD-inspired)

## What This Is

A Model Context Protocol (MCP) server that lets AI coding agents read on-chain crypto positions and prepare transactions the user signs on a Ledger hardware wallet. The agent proposes; the user approves on-device. Self-custodial — keys never leave the Ledger.

Built fresh from product specs using GSD. Same product space as the upstream `vaultpilot-mcp`, but planned as a vertical-slice MVP first (one chain, one signing flow, full security skeleton end-to-end) so the load-bearing trust pipeline is proven before adding chain/protocol breadth.

## Core Value

**The user trusts what the Ledger screen shows — nothing else.** Every byte the device signs is cryptographically bound across each layer (agent → MCP → transport → device) so tampering at any single layer produces a visible mismatch on-device. If the trust pipeline doesn't hold, nothing else in this product matters.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- v1.0 MVP. Building toward these. -->

- [ ] User can install the MCP via `npx` and register it with Claude Code in one command
- [ ] User can ask the agent for their Ethereum portfolio (native ETH balance + ERC-20 balances + USD totals) on a free public RPC, no API keys required
- [ ] User can pair their Ledger via WalletConnect once per session and see the paired address surfaced verbatim
- [ ] User can ask the agent to send native ETH; flow produces an unsigned tx, a `LEDGER BLIND-SIGN HASH` block, and a `payloadFingerprint` that survives the prepare→preview→send transition unchanged
- [ ] User signs on the device after matching the on-screen hash against the agent-relayed hash; bytes substitution at any layer between MCP and the device produces a visible mismatch
- [ ] On a fresh install with no config and no Ledger, the server boots into auto-demo (real RPC reads against curated personas; signing tools refuse) so first contact works without setup

### Out of Scope

<!-- Explicit boundaries. v1.0 only — broader scope lives in ROADMAP.md milestones. -->

- All non-EVM chains (Solana, TRON, Bitcoin, Litecoin) — deferred to v2.x; each chain is its own milestone because the signing transport differs (USB-HID vs WC) and the security defenses don't carry over.
- All EVM chains except Ethereum mainnet — deferred to v1.2; mainnet is the validation target for the security pipeline before fan-out to L2s.
- All DeFi protocols (Aave, Compound, Morpho, Uniswap, Curve, Lido, EigenLayer, Rocket Pool, Safe multisig, etc.) — deferred to v1.1+; native sends are the smallest signing flow and exercise the full trust pipeline.
- Companion skill (`vaultpilot-preflight`) — deferred to v1.3 hardening milestone; until then the MCP-emitted `CHECKS PERFORMED` block is the only enforcement layer (documented residual risk).
- Second-LLM verification, set-level enumeration, dispatch-target allowlist, bridge-facet decoders — all v1.3+ hardening.
- Ergonomics surface (`get_pnl_summary`, `get_daily_briefing`, `get_portfolio_diff`, `compare_yields`, `explain_tx`) — deferred to v3.x; not load-bearing for the trust pipeline.
- Contacts + read-only sharing (signed address-book, scoped read-only links) — deferred to v3.x.
- Device-trust attestation (`verify_ledger_attestation` / `_firmware` / `_live_codesign`) — deferred to v3.x.
- Hosted MCP endpoint, OAuth, multi-tenant — deferred to v3.x.
- NFT reads (portfolio, collection metadata, listings, history) — deferred to v3.x; not core to the self-custodial DeFi value prop, but no architectural reason they can't ship later.
- NFT marketplace fills (Seaport / Blur), perps, options, validator deposits — out of scope until typed-data signing infrastructure lands (`prepare_eip2612_permit`, `prepare_permit2_*`, `sign_typed_data_v4`); these need Inv #1b/#2b and a Ledger app that clear-signs typed data, neither of which is on the v1.x–v3.x roadmap.

## Context

**Product space.** The upstream `vaultpilot-mcp` is a mature MCP server (~80 tools, 9 chains, 6+ DeFi protocols, 15+ named security invariants). Building a from-scratch clone is a multi-milestone effort; this project follows GSD's "small enough to execute in a fresh context" principle by collapsing v1.0 to the smallest end-to-end vertical slice that proves the trust pipeline.

**MCP runtime.** Stdio transport is the only target for v1.x — Claude Code CLI, Cursor, Claude Desktop. Hosted HTTP transport (claude.ai chat) is a v3.x deployment-mode milestone, not v1.x scope.

**Threat model (anchor for every milestone).** The agent, MCP server, and host computer can all be attacker-controlled. The agent compromise model covers both **adversarial threat actors** (prompt injection, rogue subagent in a delegation chain, malicious skill, deliberately rogue agent) AND **non-adversarial honest-model-error cases** (hallucinated addresses, stale knowledge of upgraded contracts, post-cutoff protocols missing entirely, long-context attention drift, capitulation under user pressure, off-by-decimal arithmetic, tool-name confusion). For threat-modeling purposes both are equivalent: the agent emits bytes that don't match user intent. Only the Ledger is trusted. Every defense maps to a specific compromise scenario:

- Compromised MCP swaps bytes between prepare and send → caught by `payloadFingerprint` (server-side) + `LEDGER BLIND-SIGN HASH` (device-recomputed).
- Compromised middle layer (WC relay, Ledger Live, USB) substitutes bytes → device's local hash diverges from agent-relayed hash; user sees mismatch on-screen.
- Narrow agent compromise mutates `prepare_*` args → `PREPARE RECEIPT` block surfaces verbatim args, bypassing the agent's natural-language retelling.
- Honest model error (off-by-decimal, hallucinated address, wrong-chain default) → same `PREPARE RECEIPT` + on-device decoded display + Inv #2.5 chain-must-be-explicit refusal; "high-confidence agent response" gets no more trust than an adversarial one.
- WalletConnect peer impersonation → session-topic cross-check (user verifies last-8-chars in Ledger Live → Settings → Connected Apps).
- Fully-coordinated agent compromise (args + output filter) → no software-only defense; documented as residual risk; `get_verification_artifact` + `verify_tx_decode` (v1.3) narrow via second-LLM cross-check.

**Architectural shape (GSD-driven choices).** The upstream ships everything monolithically; this project ships in vertical slices. Rationale: each slice's `verify-phase` step exercises a complete user flow end-to-end, surfacing trust-pipeline bugs at the milestone where they're cheapest to fix. The downside (more milestones, slower breadth) is the cost of using GSD's verification model honestly.

## Constraints

- **Tech stack**: TypeScript + Node.js ≥ 18.17 + `@modelcontextprotocol/sdk` (canonical MCP server SDK). EVM via `viem`. WalletConnect via `@walletconnect/sign-client`. Ledger via `@ledgerhq/hw-app-eth` only on the WC bridge — no direct USB-HID transport in v1.x.
- **Trust boundary**: server never holds keys. No private key material crosses any boundary in this project; all signing happens off-process on the Ledger device.
- **Distribution**: npm package + bundled binary (later milestone). v1.0 is npm-only; binary distribution moves to v1.4.
- **License**: BUSL-1.1, mirroring upstream. Personal/internal use free; hosted services require commercial license. Auto-converts to Apache 2.0 in 2030.
- **Transport**: stdio only in v1.x. HTTP/SSE deferred to v3.x.

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vertical-slice MVP (one chain, one flow, full security skeleton) instead of breadth-first | GSD's "verify-phase per milestone" only catches trust-pipeline bugs if each milestone exercises a real end-to-end flow. Shipping read-only EVM portfolio across 5 chains first leaves signing un-validated until much later. | — Pending (validates at v1.0 ship) |
| `@modelcontextprotocol/sdk` over FastMCP | Canonical SDK; FastMCP's ergonomics are real but its routing/validation polish is non-load-bearing for the v1.x trust-pipeline focus. Revisit at v3.x if hosted-MCP needs FastMCP's HTTP support. | — Pending |
| `viem` over ethers.js | Native bigint, smaller bundle, modern API, used by the upstream successfully. | — Pending |
| BUSL-1.1 from day one | Matches upstream license model. Avoids a relicense churn later. | — Pending |
| Single-context repo (`CONTEXT.md` + `docs/adr/` at root) | Same convention as the upstream and as the GSD project itself. Avoids per-package CLAUDE.md proliferation. | — Pending |
| Defer companion skill (`vaultpilot-preflight`) to v1.3 | The skill is a critical defense against compromised-MCP scenarios but it's a *separate distribution surface* with its own integrity-pin loop. Adding it before the MCP itself is stable doubles the moving parts. The v1.0–v1.2 residual risk (no skill) is documented in SECURITY.md from day one. | — Pending |
| Three-tool verification surface in v1.3: `get_verification_artifact` + `verify_tx_decode` + `get_tx_verification` | Upstream ships these as distinct tools because they cover different attacker models. `get_verification_artifact` is the second-LLM cross-check (coordinated-agent narrowing); `verify_tx_decode` is server-side cross-check of the agent's claimed bytes-to-intent decode (catches narrow agent decode lies); `get_tx_verification` is 15-min-TTL handle re-emit (context-eviction recovery). Collapsing them into one would conflate threat models. | — Pending |
| NFT reads land at v3.x, not v1.x or v2.x | Original Out of Scope flatly excluded NFTs. Upstream walked that back to "read-only NFT tooling shipped, marketplace fills deferred". This rebuild adopts the same: NFT portfolio / collection / history / listings as v3.x ergonomics; Seaport / Blur fills stay deferred until the typed-data signing surface (Inv #1b/#2b + Ledger typed-data clear-sign) lands. | — Pending |
| Bitcoin / Litecoin support is one milestone, not two | Esplora client + Ledger BTC app + LiFi BTC routing share enough infrastructure that splitting BTC and LTC into separate milestones would force two duplicated `pair_ledger_*` flows and two Esplora wrappers. Ship them together at v2.2 with LTC riding the BTC scaffolding. | — Pending |

---
*Last updated: 2026-05-12 after upstream docs sync (PR #672 — tool surface ~80→~190, NFT reads in scope, BTC/LTC fully shipped, honest-model-error class added)*

## Evolution

PROJECT.md evolves throughout the project lifecycle.

**After each phase transition:**
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone:**
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state (users, feedback, metrics)
