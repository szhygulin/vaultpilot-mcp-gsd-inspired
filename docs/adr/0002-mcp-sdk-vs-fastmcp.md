# ADR-0002: `@modelcontextprotocol/sdk` over FastMCP for v1.x

**Status:** Accepted (2026-05-12)
**Context:** Initial project scaffolding

## Decision

v1.x uses `@modelcontextprotocol/sdk` as the MCP server foundation. FastMCP is not adopted in v1.x.

## Rationale

FastMCP offers ergonomic improvements (declarative tool registration, typed handlers, progress notifications, typed UserError split). These are real but **non-load-bearing for the v1.x trust-pipeline focus**. The load-bearing v1.x complexity is:

1. The handle store + payloadFingerprint computation
2. The preview-step `previewToken` minting and re-check semantics
3. The `LEDGER BLIND-SIGN HASH` recomputation matching what the device displays
4. The WC session-topic surfacing and pairing lifecycle
5. The auto-demo runtime-flag resolution and signing intercepts

None of those are improved by FastMCP. All of them benefit from the canonical SDK's stability.

## Revisit triggers

- v3.x hosted-MCP work needs HTTP/SSE transport — FastMCP's HTTP support may be load-bearing then. Re-evaluate at v3.0 planning.
- A real "feels stuck" report in v1.x ergonomics (per the upstream's own deferred-fastmcp note) — re-evaluate then, not before.

## Consequences

- Tool descriptions are written in the SDK's verbose-string format; FastMCP-style declarative wrappers don't apply.
- Progress notifications (MCP `_meta.progressToken`) are deferred; long-running fanout tools (multi-chain `get_portfolio_summary`) just block in v1.x.
- Typed UserError vs programmer Error split is a v3.x concern, not v1.x.
