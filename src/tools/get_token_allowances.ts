// get_token_allowances — agent-facing enumeration of outstanding ERC-20
// allowances for a wallet on a single chain. Phase 8 — Plan 08-04 (READ-43 +
// READ-44).
//
// Two-step enumeration per research § Topic 7:
//
//   1. **Event scan** — `client.getLogs({ event: Approval(owner=wallet,
//      spender=*, value=*), fromBlock, toBlock })` over a configurable
//      look-back window. Default `lookbackBlocks: 1_000_000` (DF-2 Option A
//      — ~140 days Ethereum / ~30 days L2s). On PublicNode fallback the
//      scan chunks into 10000-block windows (research § Topic 7 line 697 +
//      § A4 — PublicNode rejects single-call ranges above ~10k blocks).
//   2. **Multicall cross-check** — per-(token, spender) `allowance(wallet,
//      spender)` reads via `client.multicall({ allowFailure: true })`. Zero-
//      allowance rows (revoked or fully-spent) are filtered out; non-zero
//      rows surface with the current on-chain value (NOT the historical
//      event value).
//
// The `[SET-LEVEL ENUMERATION]` block in `content[0].text` is the source-
// of-truth artifact for v1.3 Inv #14 (dispatch-allowlist enforcement). The
// companion `vaultpilot-preflight` skill parses this verbatim text shape
// (see `src/signing/blocks.ts` SET_LEVEL_ENUMERATION_TEMPLATE).
//
// Etherscan V2 has NO programmatic token-approvals endpoint (research §
// Topic 7 empirical verification); event-log scan is the only general-
// purpose path. Revoke.cash uses the same approach.
//
// Out of scope:
//   - Off-chain Permit2 / EIP-2612 typed-data signatures (T-PERMIT2-
//     UNCOVERED-1 — v3.x scope per ROADMAP).
//   - Per-session caching (the MCP server is stateless at this layer;
//     caching is the agent's responsibility).

import {
  getAddress,
  isAddress,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import {
  chainIdFromName,
  chainNameFromId,
  lookupSpender,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { MAX_UINT256 } from "../protocols/erc20.js";
import { SET_LEVEL_ENUMERATION_TEMPLATE } from "../signing/blocks.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";

/**
 * `keccak256("Approval(address,address,uint256)")` — the universal ERC-20
 * Approval event topic. Identical across all 5 chains; identical across all
 * ERC-20 implementations. Hardcoded as the SOT for the selector — Test 7
 * in `test/get-token-allowances.test.ts` asserts byte-identity against a
 * runtime `keccak256("Approval(address,address,uint256)")` computation.
 *
 * Single-SOT regression: `grep -c "0x8c5be1e5..." src/` must return 1
 * (this constant) — see Plan 08-04 success criteria.
 */
export const APPROVAL_EVENT_TOPIC: Hex =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";

/**
 * viem-parsed event ABI for the Approval log. Drives the `args: { owner }`
 * filter on `client.getLogs` and the typed `log.args` decoding.
 */
const APPROVAL_EVENT = parseAbiItem(
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
);

/**
 * Default look-back window — DF-2 Option A locked at planning gate
 * (research § Topic 7 line 685-691). ~140 days Ethereum / ~30 days L2s.
 * Users can override via the `lookbackBlocks` arg; `0` triggers a full-
 * history scan (paid RPC required).
 */
const DEFAULT_LOOKBACK_BLOCKS = 1_000_000n;

/**
 * PublicNode `getLogs` range ceiling (research § Topic 7 line 697 + § A4).
 * When `isPublicNodeFallback(chainId) && lookbackBlocks > this`, the scan
 * iterates in chunks of this width and the response surfaces
 * `rpcDegraded: true` + `chunksScanned: <N>` + a verbatim warning text.
 */
const PUBLICNODE_LOG_CHUNK_BLOCKS = 10_000n;

/**
 * Minimal ERC-20 ABI for the `allowance(owner, spender)` cross-check leg.
 * viem's `erc20Abi` covers this, but parseAbi keeps the surface tight.
 */
const ALLOWANCE_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
]);

const DESCRIPTION = [
  "Enumerate outstanding ERC-20 allowances for a wallet on a single chain.",
  "Two-step process: (1) eth_getLogs scan for Approval(owner=wallet, ...) events over the look-back window; (2) per-(token, spender) allowance() cross-check via multicall to filter zero-current-allowance rows (revoked or fully-spent allowances).",
  "Returns per-row `{ token, spender, spenderLabel, amount, isUnlimited, lastSeenBlock }`. The verbatim `[SET-LEVEL ENUMERATION]` block in `content[0].text` is the source-of-truth artifact for v1.3 dispatch-allowlist enforcement.",
  "Default lookbackBlocks: 1000000 (~140 days Ethereum / ~30 days L2s). Pass lookbackBlocks: 0 for full-history scan — requires paid RPC.",
  "PublicNode fallback: scan chunks into 10000-block windows (100 RPC calls for a 1M-block scan); response carries rpcDegraded: true + chunksScanned count + a ceiling warning in text content.",
  "Out of scope: off-chain Permit2 / EIP-2612 typed-data signatures (NOT on-chain Approval events; v3.x scope per ROADMAP).",
  "Call ONCE per chain per session — caching is the agent's responsibility; the MCP server does NOT cache (no per-session state at this layer).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Ethereum wallet address (EIP-55 not required; case-insensitive).",
    },
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description:
        "Chain identifier (required). Supported: ethereum, arbitrum, polygon, base, optimism.",
    },
    lookbackBlocks: {
      type: "number",
      minimum: 0,
      description:
        "Block range to scan back from the latest block. Default 1000000 (~140 days Ethereum / ~30 days L2s). Pass 0 for full-history scan (requires paid RPC).",
    },
  },
  required: ["wallet", "chain"],
  additionalProperties: false,
};

/**
 * One row in the active-allowance result set. `amount` is the CURRENT on-
 * chain allowance (multicall cross-check leg), NOT the historical event
 * value — a user who revoked between event-time and now sees the row
 * filtered out (Step 2). `isUnlimited` is strict equality to MAX_UINT256
 * (mirrors Phase 6 Plan 06-03 invariant).
 */
export interface AllowanceRow {
  token: Address;
  spender: Address;
  spenderLabel: string;
  amount: string; // bigint serialized as decimal string for the agent boundary
  isUnlimited: boolean;
  lastSeenBlock: string; // bigint serialized as decimal string
}

interface ApprovalCandidate {
  token: Address;
  spender: Address;
  lastSeenBlock: bigint;
}

interface ScanResult {
  candidates: ApprovalCandidate[];
  chunksScanned: number;
}

/**
 * Step 1: scan `Approval(owner=wallet, ...)` events over [fromBlock,
 * toBlock]. When `useChunking`, iterate in PUBLICNODE_LOG_CHUNK_BLOCKS
 * windows; otherwise issue a single `getLogs` call.
 *
 * Per-(token, spender) dedupe via Map<`${token}:${spender}`>; keep the
 * latest `blockNumber` per pair (the most recent Approval event determines
 * `lastSeenBlock`).
 */
async function scanApprovalEvents(
  client: PublicClient,
  wallet: Address,
  fromBlock: bigint,
  toBlock: bigint,
  useChunking: boolean,
): Promise<ScanResult> {
  const dedupe = new Map<string, ApprovalCandidate>();
  let chunksScanned = 0;

  const ingest = (
    logs: ReadonlyArray<{
      address: Address;
      args: { owner?: Address; spender?: Address; value?: bigint };
      blockNumber: bigint | null;
    }>,
  ): void => {
    for (const log of logs) {
      const spender = log.args.spender;
      const token = log.address;
      if (!spender || !token) continue;
      const key = `${token.toLowerCase()}:${spender.toLowerCase()}`;
      const blockNumber = log.blockNumber ?? 0n;
      const prior = dedupe.get(key);
      if (!prior || prior.lastSeenBlock < blockNumber) {
        dedupe.set(key, {
          token: getAddress(token),
          spender: getAddress(spender),
          lastSeenBlock: blockNumber,
        });
      }
    }
  };

  if (!useChunking) {
    chunksScanned = 1;
    const logs = (await client.getLogs({
      event: APPROVAL_EVENT,
      args: { owner: wallet },
      fromBlock,
      toBlock,
    })) as unknown as Parameters<typeof ingest>[0];
    ingest(logs);
  } else {
    // Iterate in 10k-block windows from fromBlock → toBlock inclusive. The
    // last chunk's `chunkTo` is clamped at `toBlock`.
    let cursor = fromBlock;
    while (cursor <= toBlock) {
      const chunkTo =
        cursor + PUBLICNODE_LOG_CHUNK_BLOCKS - 1n > toBlock
          ? toBlock
          : cursor + PUBLICNODE_LOG_CHUNK_BLOCKS - 1n;
      chunksScanned += 1;
      const logs = (await client.getLogs({
        event: APPROVAL_EVENT,
        args: { owner: wallet },
        fromBlock: cursor,
        toBlock: chunkTo,
      })) as unknown as Parameters<typeof ingest>[0];
      ingest(logs);
      cursor = chunkTo + 1n;
    }
  }

  return {
    candidates: Array.from(dedupe.values()),
    chunksScanned,
  };
}

/**
 * Step 2: cross-check candidates via multicall `allowance(wallet, spender)`
 * reads. `allowFailure: true` — per-call failures don't kill the batch;
 * they surface as filtered-out rows (we cannot prove the allowance is
 * non-zero if the read fails, so we drop). Zero-current-allowance rows are
 * filtered out (revoked or fully-spent since the event).
 *
 * `spenderLabel` via `lookupSpender(spender)` — Ethereum-only labels in
 * v1.2 per Plan 08-01 lock (research § line 1131). Cross-chain spenders
 * label as `(unknown spender — no prior interaction recorded)` (kept
 * identical to the existing Phase 6 fallback text for consistency).
 *
 * Per-chain note: `lookupSpender` does case-insensitive lookup against the
 * Ethereum-curated table; an Arbitrum / Polygon / Optimism / Base spender
 * address won't match the Ethereum entries, so the row labels as unknown.
 * This is the documented v1.2 residual — v1.3 widens to per-chain tables.
 */
async function filterActiveAllowances(
  client: PublicClient,
  wallet: Address,
  candidates: readonly ApprovalCandidate[],
): Promise<AllowanceRow[]> {
  if (candidates.length === 0) return [];

  const calls = candidates.map((c) => ({
    address: c.token,
    abi: ALLOWANCE_ABI,
    functionName: "allowance" as const,
    args: [wallet, c.spender] as const,
  }));

  const results = await client.multicall({
    contracts: calls,
    allowFailure: true,
  });

  const rows: AllowanceRow[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const r = results[i];
    const c = candidates[i];
    if (!r || !c) continue;
    if (r.status !== "success") continue;
    const amount = r.result as bigint;
    if (amount === 0n) continue;
    const spenderRow = lookupSpender(c.spender);
    const spenderLabel =
      spenderRow?.label ?? "(unknown spender — no prior interaction recorded)";
    rows.push({
      token: c.token,
      spender: c.spender,
      spenderLabel,
      amount: amount.toString(),
      isUnlimited: amount === MAX_UINT256,
      lastSeenBlock: c.lastSeenBlock.toString(),
    });
  }
  return rows;
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
 * convention. Tests `vi.spyOn(_logs, "scanApprovalEvents")` /
 * `vi.spyOn(_logs, "filterActiveAllowances")` intercept the two helpers
 * without needing to mock viem's getLogs + multicall plumbing end-to-end.
 *
 * Added at write time, not retroactively — the cost is one wrapping
 * object; the cost of skipping is a silently-passing test that doesn't
 * actually spy on anything (ESM named-export bindings are immutable).
 */
export const _logs = { scanApprovalEvents, filterActiveAllowances };

/**
 * Build the `{TABLE}` slot body for the SET-LEVEL ENUMERATION block. When
 * `rows` is empty, returns the verbatim "no active allowances" placeholder
 * — the v1.3 preflight parser handles both shapes uniformly (empty body
 * means the wallet has no active allowances within the scan window).
 *
 * Per-row shape (parser-friendly — no column-width truncation):
 *
 *     ┌─ row 1
 *     │  token:         0xA0b86991...eB48
 *     │  spender:       0xE592427A...1564
 *     │  spenderLabel:  Uniswap V3 SwapRouter
 *     │  amount:        1000000
 *     │  isUnlimited:   no
 *     │  lastSeenBlock: 18000000
 *
 * The v1.3 `vaultpilot-preflight` skill parser extracts (token, spender,
 * isUnlimited) tuples by splitting each row on `: ` and stripping leading
 * whitespace from the value. Full addresses + amounts cross the boundary
 * intact — no truncation, no precision loss on uint256 amounts.
 */
function buildAllowanceTable(rows: readonly AllowanceRow[]): string {
  if (rows.length === 0) {
    return "  (no active allowances within scan window)";
  }
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    lines.push(`  ┌─ row ${i + 1}`);
    lines.push(`  │  token:         ${r.token}`);
    lines.push(`  │  spender:       ${r.spender}`);
    lines.push(`  │  spenderLabel:  ${r.spenderLabel}`);
    lines.push(`  │  amount:        ${r.amount}`);
    lines.push(`  │  isUnlimited:   ${r.isUnlimited ? "yes" : "no"}`);
    lines.push(`  │  lastSeenBlock: ${r.lastSeenBlock}`);
  }
  return lines.join("\n");
}

/**
 * Render the full SET-LEVEL ENUMERATION block with all substitutions
 * applied. Output is a single string; consumers prepend / append additional
 * blocks (e.g. the T-LOGS-CEILING-1 warning) outside this function.
 */
function renderSetLevelBlock(args: {
  wallet: Address;
  chainName: ChainName;
  chainId: ChainId;
  fromBlock: bigint;
  toBlock: bigint;
  lookbackBlocks: bigint;
  rows: readonly AllowanceRow[];
}): string {
  return SET_LEVEL_ENUMERATION_TEMPLATE.replace("{SCOPE}", args.wallet)
    .replace("{CHAIN}", `${args.chainName} (chainId ${args.chainId})`)
    .replace("{FROM_BLOCK}", args.fromBlock.toString())
    .replace("{TO_BLOCK}", args.toBlock.toString())
    .replace("{LOOKBACK_BLOCKS}", args.lookbackBlocks.toString())
    .replace("{ROW_COUNT}", args.rows.length.toString())
    .replace("{TABLE}", buildAllowanceTable(args.rows));
}

registerTool("get_token_allowances", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "error: `wallet` must be a valid 0x-prefixed Ethereum address",
        },
      ],
      structuredContent: {
        ...makeStructuredError(
          "INVALID_INPUT",
          "`wallet` must be a valid 0x-prefixed Ethereum address",
        ),
      },
    };
  }
  const wallet: Address = getAddress(walletRaw);

  const chainName = args.chain as ChainName;
  const chainId = chainIdFromName(chainName);
  const client = getChainClient(chainId);

  // lookbackBlocks default + range validation. JSON schema enforces
  // `number` + `minimum: 0`; we coerce to bigint inline.
  const lookbackArg =
    typeof args.lookbackBlocks === "number" ? args.lookbackBlocks : undefined;
  const lookbackBlocks =
    lookbackArg !== undefined ? BigInt(Math.floor(lookbackArg)) : DEFAULT_LOOKBACK_BLOCKS;

  let latestBlock: bigint;
  try {
    latestBlock = await client.getBlockNumber();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: failed to read latest block from chain "${chainName}": ${message}`,
        },
      ],
      structuredContent: {
        ...makeStructuredError(
          "INTERNAL_ERROR",
          `failed to read latest block from chain "${chainName}"`,
          message,
        ),
        rpcDegraded: true,
      },
    };
  }

  const fromBlock = lookbackBlocks >= latestBlock ? 0n : latestBlock - lookbackBlocks;
  const toBlock = latestBlock;
  const actualLookback = toBlock - fromBlock;

  // T-LOGS-CEILING-1: chunk when on PublicNode AND the scan window
  // exceeds the 10k-block ceiling. The chunking is unconditional in this
  // branch — the warning text surfaces in content[0].text so the agent can
  // route the user to set custom RPC.
  const onFallback = isPublicNodeFallback(chainId);
  const useChunking = onFallback && actualLookback > PUBLICNODE_LOG_CHUNK_BLOCKS;

  // Step 1 — event scan.
  let scanResult: ScanResult;
  try {
    scanResult = await _logs.scanApprovalEvents(
      client,
      wallet,
      fromBlock,
      toBlock,
      useChunking,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: getLogs scan failed on chain "${chainName}": ${message}`,
        },
      ],
      structuredContent: {
        ...makeStructuredError(
          "INTERNAL_ERROR",
          `getLogs scan failed on chain "${chainName}"`,
          message,
        ),
        rpcDegraded: true,
      },
    };
  }

  // Step 2 — multicall cross-check.
  let activeRows: AllowanceRow[];
  try {
    activeRows = await _logs.filterActiveAllowances(client, wallet, scanResult.candidates);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: multicall allowance cross-check failed on chain "${chainName}": ${message}`,
        },
      ],
      structuredContent: {
        ...makeStructuredError(
          "INTERNAL_ERROR",
          `multicall allowance cross-check failed on chain "${chainName}"`,
          message,
        ),
        rpcDegraded: true,
      },
    };
  }

  const setLevelBlock = renderSetLevelBlock({
    wallet,
    chainName,
    chainId,
    fromBlock,
    toBlock,
    lookbackBlocks: actualLookback,
    rows: activeRows,
  });

  // T-LOGS-CEILING-1 warning text — appended AFTER the SET-LEVEL block so
  // the block stays parseable in isolation by the v1.3 preflight skill.
  const warningText = useChunking
    ? `\n\n⚠ Look-back scan on PublicNode RPC chunked into ${scanResult.chunksScanned} × 10k-block windows (${scanResult.chunksScanned} RPC calls). For faster scans set RPC_PROVIDER + RPC_API_KEY (Alchemy 50k chunks; Infura 10k; self-hosted unlimited).`
    : "";

  const structuredContent: Record<string, unknown> = {
    chain: chainName,
    chainId,
    wallet,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    lookbackBlocks: Number(actualLookback),
    rowCount: activeRows.length,
    rows: activeRows,
  };
  if (useChunking) {
    structuredContent.chunksScanned = scanResult.chunksScanned;
    structuredContent.rpcDegraded = true;
  } else if (onFallback) {
    // Surface the fallback flag for parity with other read tools even
    // when the look-back stayed within the single-call ceiling.
    structuredContent.rpcDegraded = true;
  }

  return {
    content: [
      {
        type: "text",
        text: setLevelBlock + warningText,
      },
    ],
    structuredContent,
  };
});
