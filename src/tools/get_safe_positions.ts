// src/tools/get_safe_positions.ts
//
// Phase 36 Plan 36-02 (SAFE-01) — MCP tool: get_safe_positions({ wallet, chain? }).
//
// Read-only enumeration of Safes where `wallet` is an owner. Multi-chain by
// default (Promise.allSettled fan-out across Ethereum + Arbitrum + Polygon +
// Base + Optimism with a per-chain 10s AbortController timeout); explicit
// `chain` narrows.
//
// Trust-pipeline foundation (CONTEXT lock): per-Safe output uses ON-CHAIN
// values for owners / threshold / nonce / version / modules. Tx Service
// values are advisory — mismatches surface as `txServiceDrift: true` +
// `driftReasons[]` semantic labels. The wallet-not-owner Safes (Tx Service
// stale after a recent `removeOwner`) are silently dropped — the on-chain
// `getOwners()` filter is the access boundary.
//
// Closest analogs:
//   - `src/tools/get_portfolio_summary.ts` for the cross-chain fan-out
//     (Promise.allSettled + per-chain AbortController + chainErrors)
//   - `src/tools/get_lending_positions.ts` for the per-chain handler scaffold
//     (chain resolution → wallet validation → reader call → result assembly)
//
// Per-Safe surface (compact pendingTransactions, sentinel-filtered modules):
//   - pendingTransactions[] capped at 20 lowest-nonce; total count surfaces
//     as `pendingTransactionsTotalCount` + `pendingTransactionsTruncated`
//   - enabledModules[] sentinel-filtered (SENTINEL never appears in output)
//   - txServiceDrift + driftReasons (owners-set-mismatch / threshold-mismatch
//     / version-mismatch / nonce-stale / modules-set-mismatch /
//     unsupported-version)
//
// FROZEN-area discipline: this tool composes the Plan 36-01 client + Plan
// 36-02 chain reader + the existing chain registry. Zero new imports against
// `src/signing/*`, `src/tools/send_transaction.ts`, `src/tools/preview_send.ts`,
// or any test under `test/signing-*`.

import { getAddress, isAddress, type Address } from "viem";

import { _safeChains } from "../chains/safe.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import * as safeTxService from "../clients/safe-tx-service.js";
import {
  chainIdFromName,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { getSafeTxServiceApiKey } from "../config/env.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Read Safe multisig positions on a supported EVM chain (or fan out across all 5) for a wallet that is a current owner.",
  "Returns per-Safe rows with ON-CHAIN values for owners / threshold / nonce / version / enabledModules (Singleton multicall) — Tx Service values are advisory and feed `txServiceDrift: true` + `driftReasons[]` (semantic labels: owners-set-mismatch, threshold-mismatch, version-mismatch, nonce-stale, modules-set-mismatch, unsupported-version).",
  "Use when the user asks about their Safe multisigs, owner sets, pending transactions, or enabled modules. The compact `pendingTransactions[]` (max 20 lowest-nonce) surfaces `safeTxHash + nonce + collectedSignatures + requiredSignatures + isExecutable` — call `get_safe_transaction({ chain, safeAddress, safeTxHash })` for full tx detail including decoded calldata.",
  "Do NOT use for signing or proposing — that arrives in Phase 37 (`prepare_safe_tx_propose` / `prepare_safe_tx_approve` / `prepare_safe_tx_execute`). Do NOT use for module security audits — that arrives in Phase 38 (enableModule hard-trigger).",
  "`chain` is OPTIONAL — omit to fan out across all 5 configured EVM chains via Promise.allSettled with a per-chain 10s AbortController timeout. Per-chain failures surface in `degradedChains: ChainId[]` + `degradedReasons: { [chainId]: string }` without throwing.",
  "Safes where the wallet is NO LONGER a current owner (Tx Service stale after a recent `removeOwner`) are silently dropped — the on-chain `getOwners()` filter is the access boundary.",
  "`enabledModules[]` is sentinel-filtered (`0x0...001` never appears in output). >100-module Safes surface `enabledModulesTruncated: true` + `enabledModulesPaginationCursor` (extreme outliers).",
  "Returns `{ wallet, safesByChain: [{ chain, chainId, safes: SafePositionRow[] }], degradedChains: ChainId[], degradedReasons: Record<number, string>, safeTxServiceApiKeyPresent: boolean }`.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description:
        "OPTIONAL. Omit to fan out across all 5 configured EVM chains (per-chain 10s timeout). Pass one to narrow.",
    },
    wallet: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "EVM wallet address (EIP-55 not required; case-insensitive).",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

const PER_CHAIN_TIMEOUT_MS = 10_000;
const ALL_CHAIN_NAMES: readonly ChainName[] = [
  "ethereum",
  "arbitrum",
  "polygon",
  "base",
  "optimism",
] as const;
const PENDING_TX_LIMIT = 20;
const NONCE_STALE_TOLERANCE = 3n;

// SENTINEL is the Safe module-list head/tail anchor. Filtered defensively at
// the consumer site (belt-and-suspenders with `src/chains/safe.ts`).
const SAFE_SENTINEL_MODULES_LOWER =
  "0x0000000000000000000000000000000000000001";

interface PendingTxCompact {
  safeTxHash: string;
  nonce: string;
  collectedSignatures: number;
  requiredSignatures: number;
  isExecutable: boolean;
}

interface SafePositionRow {
  safeAddress: Address;
  owners: readonly Address[];
  threshold: number;
  nonce: string;
  version: string;
  enabledModules: Address[];
  enabledModulesTruncated: boolean;
  enabledModulesPaginationCursor?: Address;
  pendingTransactions: PendingTxCompact[];
  pendingTransactionsTruncated: boolean;
  pendingTransactionsTotalCount: number;
  txServiceDrift: boolean;
  driftReasons: string[];
  rpcDegraded?: boolean;
}

interface SafesByChainRow {
  chain: ChainName;
  chainId: ChainId;
  safes: SafePositionRow[];
}

interface GetSafePositionsResult {
  wallet: Address;
  safesByChain: SafesByChainRow[];
  degradedChains: ChainId[];
  degradedReasons: Record<number, string>;
  safeTxServiceApiKeyPresent: boolean;
}

/**
 * Set-equality compare on lowercase address arrays. Used for owners-set and
 * modules-set drift detection. O(n) — both Safes are small (Safe practical
 * owner-count is single-digit; module-count is typically 0-3).
 */
function addressSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map((x) => x.toLowerCase()));
  for (const x of b) {
    if (!setA.has(x.toLowerCase())) return false;
  }
  return true;
}

/**
 * Versions starting with "1.0" or "1.1" are deprecated and unsupported by
 * Phase 36 (CONTEXT lock — older Safe variants surface `unsupported-version`
 * drift signal). v1.2.x and earlier exist on-chain but are no longer in
 * active maintenance.
 */
function isUnsupportedVersion(version: string): boolean {
  return version.startsWith("1.0") || version.startsWith("1.1");
}

/**
 * Compute the per-Safe `driftReasons[]` semantic labels by comparing the
 * Tx Service shape against the on-chain truth. The on-chain values are
 * the SOT — `driftReasons` is informational only.
 *
 * RESEARCH § Open Question 2 lock — labels: owners-set-mismatch,
 * threshold-mismatch, version-mismatch (string compare per § A7),
 * nonce-stale (delta > 3 — small lag tolerated), modules-set-mismatch
 * (sentinel-filtered both sides), unsupported-version (CONTEXT lock).
 */
function computeDriftReasons(
  txServiceInfo: safeTxService.SafeInfoResponseDecoded | null,
  onchainOwners: readonly Address[],
  onchainThreshold: bigint,
  onchainNonce: bigint,
  onchainVersion: string,
  onchainModules: readonly Address[],
): string[] {
  const reasons: string[] = [];
  if (isUnsupportedVersion(onchainVersion)) {
    reasons.push("unsupported-version");
  }
  if (!txServiceInfo) {
    return reasons;
  }
  if (!addressSetsEqual(txServiceInfo.owners, onchainOwners as readonly string[])) {
    reasons.push("owners-set-mismatch");
  }
  if (Number(txServiceInfo.threshold) !== Number(onchainThreshold)) {
    reasons.push("threshold-mismatch");
  }
  if (txServiceInfo.version !== onchainVersion) {
    reasons.push("version-mismatch");
  }
  try {
    const txServiceNonce = BigInt(txServiceInfo.nonce);
    const delta = txServiceNonce > onchainNonce
      ? txServiceNonce - onchainNonce
      : onchainNonce - txServiceNonce;
    if (delta > NONCE_STALE_TOLERANCE) {
      reasons.push("nonce-stale");
    }
  } catch {
    // Malformed nonce string — skip silently; the broader malformed-shape
    // check at the client tier should have caught this.
  }
  // Tx Service modules vs on-chain modules (sentinel-filtered both sides).
  const txServiceModulesFiltered = txServiceInfo.modules.filter(
    (m) => m.toLowerCase() !== SAFE_SENTINEL_MODULES_LOWER,
  );
  if (!addressSetsEqual(txServiceModulesFiltered, onchainModules as readonly string[])) {
    reasons.push("modules-set-mismatch");
  }
  return reasons;
}

/**
 * Build one compact pending-tx row from a Tx Service multisig-transaction
 * record. Pitfall 6 — `confirmations` is OPTIONAL on the wire; use `?? []`
 * at every access site. Pitfall 3 — `nonce` is a decimal string; preserve
 * verbatim.
 */
function buildPendingTxCompact(
  tx: safeTxService.SafeMultisigTransactionResponse,
  onchainNonce: bigint,
  requiredSignaturesFallback: number,
): PendingTxCompact {
  const confirmations = tx.confirmations ?? [];
  const collectedSignatures = confirmations.length;
  const requiredSignatures =
    typeof tx.confirmationsRequired === "number"
      ? tx.confirmationsRequired
      : requiredSignaturesFallback;
  let isExecutable = false;
  try {
    isExecutable =
      collectedSignatures >= requiredSignatures &&
      BigInt(tx.nonce) === onchainNonce;
  } catch {
    isExecutable = false;
  }
  return {
    safeTxHash: tx.safeTxHash,
    nonce: tx.nonce,
    collectedSignatures,
    requiredSignatures,
    isExecutable,
  };
}

/**
 * Per-chain read leg. Returns the SafePositionRow[] for one chain — wallet-
 * not-owner Safes are silently dropped, per-Safe read failures are dropped
 * gracefully (not surfaced as chain-level degradation). Chain-level failures
 * (unsupported-chain / rate-limited / error from `getSafesByOwner`) throw,
 * surfacing in `degradedChains` via the Promise.allSettled wrapper.
 */
async function readSafesForChain(
  chainName: ChainName,
  wallet: Address,
): Promise<SafePositionRow[]> {
  const chainId = chainIdFromName(chainName);
  const safesByOwnerResult = await safeTxService.getSafesByOwner(chainId, wallet);
  if (safesByOwnerResult.kind === "not-found") {
    // Pitfall 7 — Tx Service 404 maps to "no Safes" at the consumer tier.
    return [];
  }
  if (safesByOwnerResult.kind === "unsupported-chain") {
    throw new Error(`Safe Tx Service has no endpoint for chain ${chainName}`);
  }
  if (safesByOwnerResult.kind === "rate-limited") {
    throw new Error(safesByOwnerResult.message);
  }
  if (safesByOwnerResult.kind === "error") {
    throw new Error(safesByOwnerResult.message);
  }

  const client = getChainClient(chainId);
  const rpcDegraded = isPublicNodeFallback(chainId);

  const rows = await Promise.all(
    safesByOwnerResult.safes.map((safeAddr) =>
      readOneSafe(chainName, chainId, client, wallet, safeAddr, rpcDegraded).catch(
        // Per-Safe read failure → drop the row silently. A single Safe whose
        // multicall reverts (e.g. self-destructed proxy) should not poison
        // the whole chain leg.
        () => null,
      ),
    ),
  );
  return rows.filter((r): r is SafePositionRow => r !== null);
}

/**
 * Read one Safe end-to-end: Tx Service safe-info + on-chain multicall +
 * module enumeration + pending-tx list. Returns null when the wallet is
 * NOT a current on-chain owner (Tx Service stale post `removeOwner`).
 */
async function readOneSafe(
  _chainName: ChainName,
  chainId: ChainId,
  client: ReturnType<typeof getChainClient>,
  wallet: Address,
  safeAddrRaw: Address,
  rpcDegraded: boolean,
): Promise<SafePositionRow | null> {
  const safeAddr = getAddress(safeAddrRaw);

  // On-chain reads first — they're the SOT for the wallet-not-owner gate.
  const [onchainInfo, modulesResult] = await Promise.all([
    _safeChains.getOnchainSafeInfo(client, chainId, safeAddr),
    _safeChains.getEnabledModules(client, chainId, safeAddr),
  ]);

  // Wallet-not-owner silent-drop (CONTEXT lock — defends against stale Tx
  // Service post a recent `removeOwner` mainnet tx).
  const walletLower = wallet.toLowerCase();
  if (!onchainInfo.owners.some((o) => o.toLowerCase() === walletLower)) {
    return null;
  }

  // Defensive: filter SENTINEL again at the consumer site (belt-and-suspenders
  // with Task 1's filter in `src/chains/safe.ts`).
  const enabledModules = modulesResult.modules.filter(
    (m) => m.toLowerCase() !== SAFE_SENTINEL_MODULES_LOWER,
  );

  // Tx Service safe-info — advisory only. Drift detection feeds
  // `txServiceDrift` + `driftReasons`; per-Safe values come from on-chain.
  const txServiceInfoResult = await safeTxService.getSafeInfo(chainId, safeAddr);
  const txServiceInfo =
    txServiceInfoResult.kind === "ok" ? txServiceInfoResult.safe : null;

  const driftReasons = computeDriftReasons(
    txServiceInfo,
    onchainInfo.owners,
    onchainInfo.threshold,
    onchainInfo.nonce,
    onchainInfo.version,
    enabledModules,
  );

  // Pending transactions — paginated query bounded to `currentNonce` window.
  const pendingResult = await safeTxService.getPendingTransactions(chainId, safeAddr, {
    currentNonce: onchainInfo.nonce,
    limit: PENDING_TX_LIMIT,
  });
  let pendingTransactions: PendingTxCompact[] = [];
  let pendingTransactionsTotalCount = 0;
  let pendingTransactionsTruncated = false;
  if (pendingResult.kind === "ok") {
    const required = Number(onchainInfo.threshold);
    pendingTransactions = pendingResult.pending.map((tx) =>
      buildPendingTxCompact(tx, onchainInfo.nonce, required),
    );
    pendingTransactionsTotalCount = pendingResult.totalCount;
    pendingTransactionsTruncated =
      pendingResult.totalCount > pendingTransactions.length;
  }

  const row: SafePositionRow = {
    safeAddress: safeAddr,
    owners: onchainInfo.owners.map((o) => getAddress(o)),
    threshold: Number(onchainInfo.threshold),
    nonce: onchainInfo.nonce.toString(),
    version: onchainInfo.version,
    enabledModules,
    enabledModulesTruncated: modulesResult.truncated,
    pendingTransactions,
    pendingTransactionsTruncated,
    pendingTransactionsTotalCount,
    txServiceDrift: driftReasons.length > 0,
    driftReasons,
  };
  if (modulesResult.nextCursor !== null) {
    row.enabledModulesPaginationCursor = modulesResult.nextCursor;
  }
  if (rpcDegraded) row.rpcDegraded = true;
  return row;
}

/**
 * Wrap the per-chain read in a 10s AbortController timeout. The
 * `AbortController` is intentionally not threaded into viem RPC calls — viem
 * doesn't accept abort signals on `multicall`/`readContract` (yet). The leg's
 * promise will continue running in the background after the race rejects.
 * Mirror of `readChainPortfolioWithTimeout` in `get_portfolio_summary.ts:438`.
 */
async function readSafesForChainWithTimeout(
  chainName: ChainName,
  wallet: Address,
): Promise<SafePositionRow[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PER_CHAIN_TIMEOUT_MS);
  try {
    return await Promise.race<SafePositionRow[]>([
      readSafesForChain(chainName, wallet),
      new Promise<SafePositionRow[]>((_, reject) => {
        abort.signal.addEventListener("abort", () => {
          reject(new Error(`timeout after ${PER_CHAIN_TIMEOUT_MS}ms`));
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Render a human-readable summary line for the text content. Mirror of
 * `get_lending_positions.ts:729` style — one-line per chain + total.
 */
function renderSummary(result: GetSafePositionsResult): string {
  const totalSafes = result.safesByChain.reduce(
    (acc, row) => acc + row.safes.length,
    0,
  );
  const chainBreakdown = result.safesByChain
    .filter((row) => row.safes.length > 0)
    .map((row) => `${row.chain}=${row.safes.length}`)
    .join(", ");
  const degraded =
    result.degradedChains.length > 0
      ? ` (degraded chains: ${result.degradedChains.join(",")})`
      : "";
  return `wallet ${result.wallet} owns ${totalSafes} Safe${totalSafes === 1 ? "" : "s"}${chainBreakdown ? ` [${chainBreakdown}]` : ""}${degraded}`;
}

registerTool("get_safe_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
    return {
      content: [
        {
          type: "text",
          text: "error: `wallet` must be a valid 0x-prefixed EVM address",
        },
      ],
      isError: true,
    };
  }
  const wallet: Address = getAddress(walletRaw);

  // Resolve target chains — explicit `chain` arg narrows; omitted → all 5.
  const chainArgRaw = args.chain;
  let targetChains: readonly ChainName[];
  if (chainArgRaw === undefined) {
    targetChains = ALL_CHAIN_NAMES;
  } else {
    if (
      typeof chainArgRaw !== "string" ||
      !ALL_CHAIN_NAMES.includes(chainArgRaw as ChainName)
    ) {
      return {
        content: [
          {
            type: "text",
            text: `error: \`chain\` must be one of ${ALL_CHAIN_NAMES.join(", ")}`,
          },
        ],
        isError: true,
      };
    }
    targetChains = [chainArgRaw as ChainName];
  }

  const perChainResults = await Promise.allSettled(
    targetChains.map((chainName) => readSafesForChainWithTimeout(chainName, wallet)),
  );

  const safesByChain: SafesByChainRow[] = [];
  const degradedChains: ChainId[] = [];
  const degradedReasons: Record<number, string> = {};

  perChainResults.forEach((r, i) => {
    const chainName = targetChains[i]!;
    const chainId = chainIdFromName(chainName);
    if (r.status === "fulfilled") {
      safesByChain.push({ chain: chainName, chainId, safes: r.value });
    } else {
      degradedChains.push(chainId);
      degradedReasons[chainId] =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
  });

  const result: GetSafePositionsResult = {
    wallet,
    safesByChain,
    degradedChains,
    degradedReasons,
    safeTxServiceApiKeyPresent: Boolean(getSafeTxServiceApiKey()),
  };

  return {
    content: [{ type: "text", text: renderSummary(result) }],
    structuredContent: { ...result },
  };
});
