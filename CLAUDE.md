# vaultpilot-mcp-gsd-inspired

<!-- GSD:project-start source:PROJECT.md -->
## Project

A Model Context Protocol (MCP) server that lets AI coding agents read on-chain crypto positions and prepare transactions the user signs on a Ledger hardware wallet. The agent proposes; the user approves on-device. Self-custodial — keys never leave the Ledger.

Built fresh from product specs using GSD. Vertical-slice MVP first (one chain, one signing flow, full security skeleton end-to-end), then chain/protocol breadth.

**Core value:** the user trusts what the Ledger screen shows — nothing else. Every byte the device signs is cryptographically bound across each layer (agent → MCP → transport → device) so tampering at any single layer produces a visible mismatch on-device.

See `.planning/PROJECT.md` for full context, `.planning/REQUIREMENTS.md` for v1.x scope, `.planning/ROADMAP.md` for milestones.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

- **Runtime:** Node.js ≥ 18.17, TypeScript (strict mode)
- **MCP server:** `@modelcontextprotocol/sdk` (canonical SDK; stdio transport in v1.x)
- **EVM client:** `viem` (native bigint, modern API, smaller bundle than ethers.js)
- **WalletConnect:** `@walletconnect/sign-client` (v2 only)
- **Ledger:** `@ledgerhq/hw-app-eth` over the WC bridge (no direct USB-HID transport in v1.x — that's a v2.x concern when Solana / TRON / BTC land)
- **Pricing:** DefiLlama HTTP API (no key required)
- **Tests:** vitest
- **Hash math:** `@noble/hashes` for keccak (`viem` re-exports the right functions)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

- **Single-context repo.** `CONTEXT.md` + `docs/adr/` at the root. No per-package CLAUDE.md proliferation. Same convention as upstream and as GSD itself.
- **Tool descriptions are agent routing prompts.** Be precise about when to use vs not. State each idea once. Cut hedging adjectives.
- **`prepare_*` always returns a handle.** The handle is opaque to the agent; everything the agent needs to relay is also in the response.
- **`PREPARE RECEIPT` block** in every `prepare_*` response — verbatim args the agent passed in. Never elide.
- **`payloadFingerprint`** computed at prepare time, re-checked at send time. Drift → structured refusal.
- **`previewToken` + `userDecision: "send"`** required on every `send_transaction`. Schema-level gate; not a soft check.
- **No private key material crosses any boundary in this codebase.** Ever. If you find yourself writing code that touches a private key, stop.
- **`src/config/contracts.ts`** is the single source of truth for canonical contract addresses (Aave Pool, Lido, etc.). Regression-tested. Never inline an address in a tool implementation.
- **Stderr for diagnostics, stdout for MCP protocol.** Crossing the wires breaks the client.
- **Decimal-aware arithmetic.** All token amounts cross the agent boundary as decimal strings (e.g. `"100.5"`); the server resolves decimals via `get_token_metadata`. Off-by-decimal is the most common user-facing bug class.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

```
agent (Claude Code / Cursor / Desktop)
   │  stdio  (MCP protocol)
   ▼
vaultpilot-mcp (this codebase)
   ├── tools/         — read + prepare + send tool handlers
   ├── chains/        — per-chain RPC clients (viem)
   ├── protocols/     — per-protocol decoders + ABI (Aave, etc.)
   ├── signing/       — handle store + payloadFingerprint + preview/send gates
   ├── wallet/        — WalletConnect session manager
   ├── security/      — canonical-dispatch + integrity + checks-performed blocks
   ├── demo/          — persona registry + simulation envelopes
   └── config/        — env / config.json resolution + contracts SOT
   │
   │  WalletConnect v2 (HTTP)
   ▼
Ledger Live  →  USB  →  Ledger device  (the only trusted display)
```

The trust boundary is the Ledger screen. Everything to the left of it can be compromised. The signing flow is structured so any single-layer compromise produces a visible mismatch on-device.

See `docs/adr/` for load-bearing decisions.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found yet. The companion `vaultpilot-preflight` skill ships in v1.3 — until then, defense-in-depth is MCP-side only (documented residual risk in SECURITY.md).
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` — do not edit manually.
<!-- GSD:profile-end -->
