# vaultpilot-mcp-gsd-inspired

Self-custodial DeFi for AI agents — built fresh from product specs, planned with [GSD](https://github.com/gsd-build/get-shit-done).

The agent proposes; you approve on your Ledger. Designed for the threat model where the agent, MCP server, and host can all be compromised. Only the device is trusted; private keys never leave it.

> **Status: pre-v1.0.** This repo currently contains the GSD planning artifacts (`PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`) and architecture decision records (`docs/adr/`). No code shipped yet — Phase 1 ("Server skeleton + install") is ready to plan.

## Why a from-scratch rebuild

The upstream [`vaultpilot-mcp`](https://github.com/szhygulin/vaultpilot-mcp) is a mature MCP server with ~80 tools across 9 chains. Its v1.0 shipped that breadth at once. This rebuild collapses v1.0 to a **vertical slice MVP** — one chain, one signing flow, full security skeleton end-to-end — so GSD's per-milestone verify-phase discipline catches trust-pipeline bugs at the cheapest moment to fix them.

See [`docs/adr/0001-vertical-slice-mvp.md`](./docs/adr/0001-vertical-slice-mvp.md) for the rationale.

## Roadmap (high-level)

| Milestone | Phases | Goal                                                                         |
| --------- | ------ | ---------------------------------------------------------------------------- |
| **v1.0 MVP**             | 1-5  | Ethereum native sends, Ledger via WalletConnect, demo mode, install + diagnostics |
| **v1.1 ERC-20 lifecycle**| 6-7  | Transfer + approve + revoke + WETH unwrap + Aave V3 (smallest DeFi surface)  |
| **v1.2 Multi-EVM**       | 8    | 5 EVM chains + `resolve_token` + `get_token_allowances`                      |
| **v1.3 Hardening**       | 9    | Companion `vaultpilot-preflight` skill + three verification tools (`get_verification_artifact`, `verify_tx_decode`, `get_tx_verification`) + dispatch allowlist |
| **v1.4 Distribution**    | 10   | Bundled binaries, install scripts, setup wizard                              |
| **v2.0**                 | —    | Solana (MarginFi / Kamino / Jupiter / Marinade / Jito / native staking / LiFi-routed bridging) |
| **v2.1**                 | —    | TRON (TRX / TRC-20 / Stake 2.0 / SunSwap / LiFi bridging)                    |
| **v2.2**                 | —    | Bitcoin + Litecoin (Esplora reads / RBF / PSBT multisig / BIP-137 / LiFi BTC routing / optional Core RPC) |
| **v2.3**                 | —    | EVM lending+staking expansion (Compound / Morpho / Lido wrap / EigenLayer / Rocket Pool) |
| **v2.4**                 | —    | EVM DEX + LP + escape hatch (Uniswap V3 LP / Curve / `prepare_custom_call`)  |
| **v2.5**                 | —    | Safe (Gnosis) multisig                                                       |
| **v2.6**                 | —    | Bridge facet decoders + cross-chain hardening (Tier-1 + Tier-2 / sandwich-MEV per-L2) |
| **v3.0+**                | —    | Hosted MCP / NFT reads / contacts + sharing / device-trust / ergonomics / multi-hardware-wallet |

Full breakdown: [`.planning/ROADMAP.md`](./.planning/ROADMAP.md).

## Core value

The user trusts what the Ledger screen shows — nothing else. Every byte the device signs is cryptographically bound across each layer (agent → MCP → transport → device) so tampering at any single layer produces a visible mismatch on-device. If the trust pipeline doesn't hold, nothing else in this product matters.

## Architecture

```
agent (Claude Code / Cursor / Desktop)
   │  stdio  (MCP protocol)
   ▼
vaultpilot-mcp
   ├── tools/        — read + prepare + send tool handlers
   ├── chains/       — per-chain RPC clients (viem)
   ├── protocols/    — per-protocol decoders + ABI
   ├── signing/      — handle store + payloadFingerprint + preview/send gates
   ├── wallet/       — WalletConnect session manager
   ├── security/     — canonical-dispatch + integrity + checks-performed blocks
   ├── demo/         — persona registry + simulation envelopes
   └── config/       — env / config.json resolution + contracts SOT
   │
   │  WalletConnect v2 (HTTP)
   ▼
Ledger Live  →  USB  →  Ledger device  (the only trusted display)
```

See [`CONTEXT.md`](./CONTEXT.md) for the threat model and glossary; [`CLAUDE.md`](./CLAUDE.md) for stack and conventions.

## Working on this project

GSD-driven. Standard loop:

```bash
/gsd-discuss-phase <N>   # capture implementation decisions
/gsd-plan-phase <N>      # research + plan + verify
/gsd-execute-phase <N>   # parallel-wave execution in fresh subagent contexts
/gsd-verify-work <N>     # walk-through acceptance testing (and a real Ledger signing flow at Phase 4)
/gsd-ship <N>            # PR
```

Phase 1 (`Server skeleton + install`) has its CONTEXT pre-populated at [`.planning/phases/01-server-skeleton/01-CONTEXT.md`](./.planning/phases/01-server-skeleton/01-CONTEXT.md) — `/gsd-plan-phase 1` is the next step.

## License

BUSL-1.1 (planned, mirroring upstream). Personal/internal use free; hosted services require commercial license. Auto-converts to Apache 2.0 in 2030. License file lands in Phase 1.
