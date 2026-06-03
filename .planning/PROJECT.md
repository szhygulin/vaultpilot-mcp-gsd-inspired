# VaultPilot MCP (GSD-inspired)

> **Defensive security tool.** This document specifies the design of a hardware-wallet-anchored signing assistant. Every threat scenario named below is named so the system can refuse, detect, or surface it to the user before any transaction is authorized. The product never holds keys, never broadcasts without explicit user confirmation, and treats the upstream agent as a potentially-unreliable component rather than a trusted authority.

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

<!-- v2.0 Solana. Building toward these. v1.x MVP requirements moved to Validated below (code-complete; verify-phases open). -->

- [ ] User can pair a Ledger over USB-HID for Solana (no WalletConnect — Solana has no WC v2 bridge to Ledger) and the paired account persists across MCP restart
- [ ] User can ask the agent for their Solana portfolio (SOL + SPL balances + USD totals) against a free public RPC
- [ ] User can send SOL and SPL tokens; the prepare → preview → send trust pipeline reused from v1.x extends with Solana-specific `payloadFingerprint` over serialized-message bytes, mandatory `simulateTransaction` gate at preview, and per-wallet durable-nonce setup
- [ ] User can supply / withdraw / borrow / repay on MarginFi and Kamino lending; positions readable via `get_marginfi_positions` and `get_kamino_positions`
- [ ] User can swap on Jupiter v6 with explicit slippage hint; sandwich-MEV refusal at >2% price impact without explicit `slippageBps`
- [ ] User can stake on Marinade (with immediate-unstake) and Jito (deposit-only; unstake-gap deferred), and run the native SOL delegate / deactivate / withdraw flow
- [ ] User can bridge between EVM chains and Solana via LiFi (`prepare_solana_lifi_swap`) with server-side `decodedFinalRecipient` assertion at preview time
- [ ] Persistent non-EVM account cache at `~/.vaultpilot-mcp/non-evm-accounts.json` mirrors the WC-session-persistence pattern (PR #61) — paired Solana / TRON / BTC / LTC accounts survive MCP restart; eager-init at `startServer()` before the transport connects

### Validated

<!-- v1.x — shipped code-complete; verify-phases (real-Ledger smoke) deferred per 2026-05-16 user directive. -->

- [x] User can install the MCP via `npx` and register it with Claude Code in one command (v1.0 Phase 1)
- [x] User can ask the agent for their Ethereum portfolio (native ETH balance + ERC-20 balances + USD totals) on a free public RPC, no API keys required (v1.0 Phase 2)
- [x] User can pair their Ledger via WalletConnect once per session and see the paired address surfaced verbatim (v1.0 Phase 3)
- [x] User can ask the agent to send native ETH; flow produces an unsigned tx, a `LEDGER BLIND-SIGN HASH` block, and a `payloadFingerprint` that survives the prepare→preview→send transition unchanged (v1.0 Phase 4)
- [x] User signs on the device after matching the on-screen hash against the agent-relayed hash; bytes substitution at any layer between MCP and the device produces a visible mismatch (v1.0 Phase 4)
- [x] On a fresh install with no config and no Ledger, the server boots into auto-demo (real RPC reads against curated personas; signing tools refuse) so first contact works without setup (v1.0 Phase 5)
- [x] ERC-20 lifecycle (transfer + approve + revoke + WETH unwrap) (v1.1 Phase 6)
- [x] Aave V3 supply / withdraw / health-factor simulation (v1.1 Phase 7)
- [x] Multi-EVM fan-out (Arbitrum / Polygon / Base / Optimism + Ethereum) + `resolve_token` + `get_token_allowances` (v1.2 Phase 8)
- [x] Companion `vaultpilot-preflight` skill + three verification tools (`get_verification_artifact` / `verify_tx_decode` / `get_tx_verification`) + canonical dispatch allowlist (v1.3 Phase 9)
- [x] Per-platform binaries + install scripts + setup wizard + `request_capability` tool (v1.4 Phase 10)

### Future Milestones

<!-- In-scope eventually — each is its own milestone in ROADMAP.md. Not Out of Scope, not Active. v2.1-v2.6 scaffolded (full phase breakdown + requirement enumeration) on 2026-05-20; planned but not in-flight. -->

- **v2.1 TRON** (Phases 17-21, scaffolded) — TRX + TRC-20 trust pipeline + Stake 2.0 + SunSwap + LiFi bridging. Reuses v2.0 Phase 11's persistent non-EVM account cache (PAIR-NEV-*).
- **v2.2 Bitcoin + Litecoin** (Phases 22-27, scaffolded — one milestone per the "shared Esplora + Ledger BTC infra" decision) — UTXO-model trust pipeline (PSBT-based); native segwit + taproot + RBF + BIP-137 + PSBT multisig + LiFi BTC bridging + optional Core RPC forensic reads.
- **v2.3 EVM lending+staking expansion** (Phases 28-31, scaffolded) — Compound V3 / Morpho Blue / Lido / EigenLayer / Rocket Pool.
- **v2.4 EVM DEX + LP + escape hatch** (Phases 32-35, scaffolded) — Uniswap V3 swap+LP / Curve / `prepare_custom_call`.
- **v2.5 Safe (Gnosis) multisig** (Phases 36-38, scaffolded) — three-step flow (propose → approve → execute) + `enableModule`/`delegateCall` hard-trigger second-LLM check (Inv #12.5).
- **v2.6 Bridge facet decoders + cross-chain hardening** (Phases 39-40, scaffolded) — Tier-1 Wormhole / Mayan / NEAR Intents / Across V3; Tier-2 deferred; sandwich-MEV per-L2 thresholds.
- **v2.7 Bittensor (TAO subnet staking)** (Phases 46-49, scaffolded 2026-06-03; feasibility GO-WITH-CONSTRAINTS) — the project's first **Substrate** chain. Goal: a user pairs a Ledger over USB-HID for Bittensor via the **Polkadot Generic app** (a NEW ed25519 coldkey — the Ledger SE can't sign sr25519, subtensor accepts `MultiSignature::Ed25519`), reads TAO + per-subnet alpha staking positions, sends native TAO, and enters/exits dTAO subnet stakes with slippage protection on the AMM-priced TAO↔alpha conversion. Target features by phase: (46) USB-HID pairing + TAO/stake reads + persistent `chain: "bittensor"` account cache; (47) native + stake **trust pipeline** — the signing-binding lands (`payloadFingerprint` over the unsigned `SignerPayload` SCALE bytes, domain tag `VaultPilot-taotx-v1:`; blake2-256 presign-display hash; `(pallet, call)`-only dispatch allowlist; slippage-guarded `add_stake_limit` / `remove_stake_limit` as the DEFAULT); (48) subnet/dTAO depth — plain unguarded add/remove + `move_stake` / `swap_stake` / custody-changing `transfer_stake`; (49) diagnostics + SECURITY.md v2.7 close-out. FROZEN cryptographic-binding siblings untouched — the chain ADDS sibling files. Reuses v2.0 Phase 11's PAIR-NEV-* cache.
- v3.0 Hosted MCP (HTTP/SSE + OAuth 2.1) — unblocks claude.ai web/desktop
- v3.1 NFT reads, v3.2 contacts + read-only sharing, v3.3 device-trust attestation, v3.4 ergonomics surface, v3.5 multi-hardware-wallet (Trezor / Keystone / GridPlus Lattice)

### Out of Scope

<!-- Explicit boundaries. Not coming. Broader scope lives in ROADMAP.md milestones. -->

- All EVM chains except the v1.2 five (Ethereum + Arbitrum + Polygon + Base + Optimism) — deferred to v2.x+ as usage data justifies; never a hard blocker.
- Companion skill (`vaultpilot-preflight`) shipped at v1.3 — closed.
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
| Bittensor (v2.7) signs via the Polkadot Generic app with a NEW ed25519 Ledger coldkey — feasibility GO-WITH-CONSTRAINTS | Scope-probed at SDK source 2026-06-03. There is no dedicated TAO Ledger app; the Zondax Polkadot Generic app signs any Substrate chain. Bittensor coldkeys default to sr25519, which the Ledger SE cannot sign — but subtensor accepts `MultiSignature::Ed25519`, so the Ledger account is a valid (ed25519) coldkey from the start. `@polkadot/api` builds the unsigned `SignerPayload` keyless; `@zondax/ledger-substrate` `signWithMetadataEd25519` returns a detached 64-byte sig attached via `tx.addSignature` — the same unsigned-payload shape as Solana/TRON, so the key never crosses a boundary. Constraints: ship a new ed25519 coldkey (no sr25519-migration tooling — impossible behind a Ledger); lead with slippage-guarded `add_stake_limit` / `remove_stake_limit` as the DEFAULT (TAO↔alpha is AMM-priced); ship even if staking calls blind-sign on-device, with a `(pallet, call)`-only dispatch allowlist + documented residual risk (consistent with Solana/TRON). Trust integrity is chain-enforced by subtensor's `CheckMetadataHash` (metadata service untrusted-by-construction). | — Pending (validates at v2.7 ship) |

---
*Last updated: 2026-05-20 — v2.1-v2.6 milestone scaffolding (chore/v2-1-thru-6-scaffolding); 24 new phases (17-40) + ~110 new requirements across TRON / BTC+LTC / EVM lending+staking / DEX+LP+escape / Safe / Bridge+MEV.*
*Last updated: 2026-06-03 — v2.7 Bittensor (TAO subnet staking) milestone appended (docs/bittensor-milestone); Phases 46-49 + 20 TAO-* requirements (first Substrate chain; ed25519 Ledger coldkey via Polkadot Generic app; VaultPilot-taotx-v1: binding over unsigned SignerPayload; blake2-256 device hash; *_limit slippage-guarded staking as default; (pallet,call) dispatch allowlist). Feasibility GO-WITH-CONSTRAINTS. STATE stays v2.6/maintenance — no milestone switch.*

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
