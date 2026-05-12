# Phase 1: Server skeleton + install — Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

A boot-able MCP server registered with Claude Code CLI, Claude Desktop, and Cursor, emitting a `--check` doctor pass on stdout. No tools that do anything yet — just the bones: `initialize` handler, tool registration framework, server-level `instructions` field, and the install/doctor surface. Read tools and signing flows are subsequent phases.

</domain>

<decisions>
## Implementation Decisions

### Project layout
- `src/index.ts` — bin entrypoint (handles `--check` subcommand vs default stdio server boot)
- `src/server.ts` — MCP server construction + tool registration framework
- `src/tools/` — per-tool handlers (empty in Phase 1; populated from Phase 2)
- `src/config/` — env / config.json resolution (stub in Phase 1; populated as needed)
- `src/diagnostics/` — `--check` doctor pass logic
- `test/` — vitest suites

### MCP SDK wiring
- Use `@modelcontextprotocol/sdk` `Server` + `StdioServerTransport`
- Tool registration via `server.tool(name, description, inputSchema, handler)` style or whatever the current SDK API is — the framework wraps it for consistency
- Server-level `instructions` field carries: one paragraph on what tools do, the security model anchor sentence, link to SECURITY.md
- Stderr logging only; stdout is the MCP transport

### `--check` doctor pass
- Validates Node version ≥ 18.17 → `✓` line, else `✗`
- Validates the binary can spawn (i.e. `--check` itself ran) → `✓`
- Reports any obvious config issues (malformed `~/.vaultpilot-mcp/config.json`) → `⚠` or `✗`
- Reports presence of optional env vars (`WALLETCONNECT_PROJECT_ID`, `ETHEREUM_RPC_URL`) → `⚠` if absent (advisory; Phase 1 doesn't need them but later phases will)
- `--json` flag emits a structured envelope: `{ status: "ok" | "warn" | "error", checks: [{ id, level, message }...], envelope_version: 1 }`
- Exit code: 0 on `ok` or `warn`, 1 on `error`

### Install registration
- Phase 1 is just "the server registers cleanly when the user pastes the right config." No auto-register wizard yet (that's Phase 10's setup wizard).
- README + INSTALL.md show the three paths (Claude Code CLI, Claude Desktop, Cursor) with the exact commands per OS
- Windows Claude Desktop needs the `cmd /c` wrapper for `npx`; document it explicitly

### Claude's Discretion
- Tool registration framework's internal API (handler signature, error wrapping)
- Stderr log format (timestamp / level / message ordering)
- Whether `--check` runs RPC connectivity probes (Phase 1 likely doesn't need network calls; Phase 2 will add a `RPC reachable` check)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — stack choices, conventions, architecture diagram
- `CONTEXT.md` — domain glossary, threat model, distribution shape
- `.planning/PROJECT.md` — Core Value, requirements, key decisions
- `.planning/REQUIREMENTS.md` §INST-01..05 — exact install + doctor surface to ship

### Architecture decisions
- `docs/adr/0001-vertical-slice-mvp.md` — why Phase 1 doesn't ship any tools that do anything yet
- `docs/adr/0002-mcp-sdk-vs-fastmcp.md` — SDK choice rationale (locked)

### External
- `@modelcontextprotocol/sdk` README and TypeScript reference (current version on npm)
- MCP protocol spec (https://spec.modelcontextprotocol.io/) for `initialize`, `tools/list`, server-level `instructions` field semantics

</canonical_refs>

<specifics>
## Specific Ideas

- The doctor pass should feel like `pnpm doctor` or `bundle doctor` — clear ✓ / ⚠ / ✗ lines, summary at the bottom
- `--json` output should be parseable by an agent at install time (the agent calls `--check --json` first and adapts based on the envelope)
- Install commands in README should be copy-pasteable — no `<placeholder>` text the user has to substitute in v1.0 (env vars come later)

</specifics>

<deferred>
## Deferred Ideas

- Auto-register wizard (`vaultpilot-mcp setup`) — Phase 10
- RPC reachability probe in `--check` — Phase 2 (when there's actually an RPC dependency to check)
- Update check against `registry.npmjs.org` — Phase 5 (DIAG-04 requirement)
- Bundled binary distribution — Phase 10
- `request_capability` tool — Phase 10

</deferred>

---

*Phase: 01-server-skeleton*
*Context gathered: 2026-05-12*
