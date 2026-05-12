# Phase 2: Ethereum read-only portfolio — Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

User can ask the agent for their Ethereum portfolio (native ETH balance + ERC-20 balances + USD totals) against a free public RPC, no API keys required. Adds the RPC client foundation, top-50 token registry, DefiLlama pricing, and the small standalone read tools (ENS forward + reverse, single-token balance, tx status). All Phase 1 tooling continues to apply; no signing flows are touched in Phase 2.

</domain>

<decisions>
## Implementation Decisions

### RPC client
- `viem ^2.x` — modern bigint-native, smaller bundle than ethers.js
- Default: PublicNode (`https://ethereum-rpc.publicnode.com`) — free, no key
- Custom: `ETHEREUM_RPC_URL` env var override
- Degraded-state surfacing: every read tool response carries an `rpcDegraded` field when the RPC is the public fallback OR when a request errored and a fallback served
- Multicall via `viem.multicall` — one round-trip per per-wallet scan, not per-token

### Token registry
- Hardcoded JSON in `src/tokens/ethereum-top-50.json` (top-50 by trading volume on Ethereum mainnet)
- Schema: `{ address, symbol, decimals, name }`
- Address normalization: viem-checksummed
- Refresh process is a Phase 10 concern; v1.0 ships with a static snapshot

### Pricing
- DefiLlama (`https://coins.llama.fi`) — free, no key
- Endpoint: `GET /prices/current/{chain}:{address}` (e.g. `ethereum:0x...`)
- Missing prices: row carries `priceUnknown: true`, NOT zero (zero implies "no value", which is wrong)
- 60-second in-memory cache to avoid hammering on rapid-fire portfolio reads
- USD aggregation: per-row USD = balance × price; total = sum; rows with `priceUnknown` contribute 0 to the total but are listed

### Balance dust filter
- Default threshold: USD 0.01
- Override: `dustThreshold` parameter on `get_portfolio_summary` (default 0.01); pass 0 to disable

### Standalone tools (02-04)
- `get_token_balance({ wallet, tokenAddress })` — single-token balance via the same multicall infrastructure
- `get_transaction_status({ txHash })` — `viem.getTransactionReceipt` mapped to `{pending|success|reverted}`
- `resolve_ens_name({ name })` — `viem.getEnsAddress`
- `reverse_resolve_ens({ address })` — `viem.getEnsName`

### Decimal handling
- Token amounts cross the API boundary as decimal strings (e.g. `"100.5"`) — never numbers (precision loss)
- Internally `bigint`; decimal-string formatting at the response boundary via `viem.formatUnits`

### Error shape
- Tool handlers return `{ isError: true, content: [{ type: "text", text: "..." }] }` per the v1.x convention
- RPC failures surface a one-line `reason` (HTTP status + endpoint name); no raw stack traces

### Tool registration pattern
- Each tool module calls `registerTool(...)` at module top-level (side-effect on import)
- `src/tools/register-all.ts` is just an import list; new tools = one line addition
- This avoids a central registry-of-registries that would be the merge-conflict surface for parallel agents

### Claude's Discretion
- Internal helper names (BalanceScanner, PriceClient, etc. — bikeshedding free)
- Test mocking strategy (vitest + viem's mock transport vs MSW)

</decisions>

<canonical_refs>
## Canonical References

### Project context
- `CLAUDE.md` — stack + conventions
- `CONTEXT.md` — domain glossary + trust model
- `.planning/REQUIREMENTS.md` §READ-01..06 — exact Phase 2 requirements
- `.planning/ROADMAP.md` Phase 2 — success criteria + plan ordering

### External
- viem docs: https://viem.sh
- DefiLlama coins API: https://defillama.com/docs/api
- ENS docs: https://docs.ens.domains
- PublicNode: https://www.publicnode.com/
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1)
- `registerTool(name, description, inputSchema, handler)` from `src/tools/index.ts`
- `log(level, msg)` from `src/diagnostics/logger.ts` — stderr-only
- `buildServer()` from `src/server.ts` — already wires the registry; will need a one-line addition to call `registerAllTools()` once at boot

### Established Patterns
- Tool handlers return `{ content: [{ type: "text", text: "..." }], structuredContent?: ... }`
- Stderr for diagnostics, stdout reserved for MCP transport
- Tool descriptions ≥ 100 chars (warn-only)
- Decimal-string at API boundary, bigint internally
- Atomic commit per plan, conventional-commit format

### Integration Points
- `src/tools/register-all.ts` (created in 02-01) is the single import point — every later tool module appears as one import line here
- `src/server.ts` calls `registerAllTools()` once at boot via `buildServer()`
</code_context>

<deferred>
## Deferred Ideas

- Token registry refresh automation — Phase 10
- `RPC_PROVIDER=infura|alchemy + RPC_API_KEY` shorthand — Phase 8 multi-EVM
- Multi-RPC fallback chain (PublicNode → Cloudflare ETH → ...) — Phase 8
- DefiLlama key rotation when rate-limited — defer until it's a real problem
- Caching beyond 60-second in-memory — defer until usage justifies
- ENS profile records (avatar, description) — out of v1.x scope
- `get_token_metadata` standalone tool — Phase 6 (when token-send needs decimals lookup)
</deferred>

---

*Phase: 02-ethereum-portfolio*
*Context gathered: 2026-05-12*
