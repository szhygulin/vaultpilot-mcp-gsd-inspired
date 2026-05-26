// Etherscan V2 unified-API client. Surface used by `check_contract_security`
// (Plan 07-04). Best-effort never-throws contract; mirror of
// `src/clients/fourbyte.ts` shape.
//
// Etherscan V2 endpoint:
//   https://api.etherscan.io/v2/api?chainid={N}&apikey={KEY}&module={M}&action={A}&...
//
// Free tier rate limits (verified 2026-05-13):
//   - 5 calls/sec
//   - 100k calls/day
//   - ONE API key works across ALL supported chains (Phase 8 inherits;
//     v1.1 hardcodes chainid=1).
//
// Per-session rate limit (research § Topic 7): 5 calls per agent session,
// soft refusal with `{ kind: "rate-limited", ... }` envelope when exceeded.
// Counter increments BEFORE the network call; cached hits do NOT consume.
//
// Per the "no silent fallbacks" CLAUDE.md rule + research § Topic 7:
//   - error / not-applicable / not-verified / rate-limited / ok are FIVE
//     DISTINCT members of the discriminated union; `error` is structurally
//     different from `not-verified`. A future contributor cannot
//     accidentally mask a 5xx / timeout / network failure as
//     `not-verified` — the type system would catch it. T-ETHERSCAN-MASK-1.
//   - HTTP 5xx, AbortController timeout, network unreachable, JSON
//     parse failure all return `{ kind: "error", message: <verbatim> }`.
//
// The function NEVER throws — callers (Plan 07-04 `check_contract_security`)
// treat it as best-effort.
//
// All diagnostic logs go through `src/diagnostics/logger.ts` →
// `process.stderr`. NEVER `console.*` — stdout carries the MCP
// protocol; crossing the wires breaks the client. The API key is NEVER
// logged (T-ETHERSCAN-KEY-LEAK-1) — log messages reference the address only.

import { type Abi, type Address } from "viem";

import { type ChainId } from "../config/contracts.js";
import { log } from "../diagnostics/logger.js";

const ETHERSCAN_API_URL = "https://api.etherscan.io/v2/api";
const ETHERSCAN_TIMEOUT_MS = 3000; // 2× fourbyte — Etherscan V2 latency higher.
const CACHE_MAX_ENTRIES = 256;
const ABI_CACHE_MAX_ENTRIES = 64;
const PER_SESSION_CALL_LIMIT = 5;

export type EtherscanResult =
  | { kind: "not-applicable" }
  | {
      kind: "ok";
      verified: true;
      proxy: boolean;
      implementation?: Address;
      contractName: string;
      compilerVersion: string;
      creatorAddress: Address;
      creationTxHash: string;
      creationTimestamp: number;
      ageDays: number | "unknown";
      privilegedFunctions: string[];
      accessControlMarkers: string[];
      abi?: string;
    }
  | { kind: "not-verified" }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

interface EtherscanSourceCodeEntry {
  SourceCode?: string;
  ABI?: string;
  ContractName?: string;
  CompilerVersion?: string;
  Proxy?: string;
  Implementation?: string;
}

interface EtherscanCreationEntry {
  contractCreator?: string;
  txHash?: string;
  timestamp?: string;
}

interface EtherscanApiResponse<T> {
  status?: string;
  message?: string;
  result?: T[] | string;
}

// Module-scope LRU cache. Process-local; dies with the process by design
// (no persistence). Insertion-order iteration on `Map` is equivalent to
// LRU when we never touch entries after insertion.
//
// Phase 35 Plan 35-01 — key widened from `Address` to `${chainId}:${address}`
// so the cache survives multi-chain dispatch (T-35-01-C mitigation).
const cache = new Map<string, EtherscanResult>();

// Module-scope per-session counter. Counts network calls only — cached
// hits don't consume the budget (they return before the counter check).
// Resets when the MCP server process restarts. T-ETHERSCAN-RATE-1 mitigation.
let agentSessionCallCount = 0;

// Name-pattern privileged set (research § Topic 7). Functions whose NAME
// matches this set are surfaced under `privilegedFunctions`. Heuristic —
// custom modifier names like `onlyKeeper` slip through; documented
// residual T-ETHERSCAN-PRIV-ROLE-FALSE-NEG-1 (v1.3 widens via
// vaultpilot-preflight skill).
const PRIVILEGED_NAMES: ReadonlySet<string> = new Set([
  "upgradeTo",
  "upgradeToAndCall",
  "setAdmin",
  "transferOwnership",
  "renounceOwnership",
  "setImplementation",
  "pause",
  "unpause",
  "mint",
  "burn",
  "blacklist",
  "freeze",
]);

// AccessControl interface markers (OpenZeppelin's AccessControl pattern).
// Distinct from name-pattern privileged set so the agent reads both —
// research § Topic 7 lock: NEVER a single boolean (Ownable vs
// AccessControl pattern distinction matters to the user).
const ACCESS_CONTROL_NAMES: ReadonlySet<string> = new Set([
  "hasRole",
  "getRoleAdmin",
  "grantRole",
  "revokeRole",
  "renounceRole",
  "DEFAULT_ADMIN_ROLE",
  "paused",
]);

interface AbiEntry {
  type?: string;
  name?: string;
  inputs?: Array<{ type?: string }>;
}

function parseAbiForPrivilegedRoles(abiJson: string): {
  privilegedFunctions: string[];
  accessControlMarkers: string[];
} {
  const privilegedFunctions: string[] = [];
  const accessControlMarkers: string[] = [];
  try {
    const abi = JSON.parse(abiJson) as AbiEntry[];
    if (!Array.isArray(abi)) {
      return { privilegedFunctions, accessControlMarkers };
    }
    for (const fn of abi) {
      if (!fn || typeof fn !== "object") continue;
      if (fn.type !== "function" || typeof fn.name !== "string") continue;
      const inputs = Array.isArray(fn.inputs) ? fn.inputs : [];
      const sig = `${fn.name}(${inputs
        .map((i) => (typeof i?.type === "string" ? i.type : ""))
        .join(",")})`;
      if (PRIVILEGED_NAMES.has(fn.name)) privilegedFunctions.push(sig);
      if (ACCESS_CONTROL_NAMES.has(fn.name)) accessControlMarkers.push(sig);
    }
  } catch {
    // ABI parse failure (corrupt / non-JSON ABI field) — surface empty
    // arrays; the verified flag stays true. Defensive: don't fail the
    // whole probe over an unparseable ABI.
  }
  return { privilegedFunctions, accessControlMarkers };
}

/**
 * Best-effort contract security probe. Never throws; returns one of the
 * five discriminated-union arms.
 *
 * - `address === null` → `not-applicable` (no network call; defensive
 *   guard).
 * - Both Etherscan calls succeed + source verified → `ok` with parsed
 *   fields.
 * - Both calls succeed + source unverified → `not-verified`.
 * - Either call fails (HTTP 5xx / 4xx / timeout / parse failure /
 *   Etherscan status="0") → `error` with verbatim upstream message.
 * - Per-session call budget exhausted → `rate-limited`.
 *
 * Two parallel Etherscan V2 calls via Promise.all:
 *   - getsourcecode → verified-source flag + ABI + Proxy/Implementation
 *     + compiler version + contract name
 *   - getcontractcreation → creator address + creation tx hash + creation
 *     timestamp
 *
 * Privileged-role heuristic: parse the ABI, scan for functions whose name
 * matches PRIVILEGED_NAMES, separately scan for ACCESS_CONTROL_NAMES.
 * Surface as TWO arrays — agent reads both; never collapsed to a single
 * boolean.
 *
 * Age computation: `ageDays = floor((now - creationTimestamp) / 86400)`.
 * Defensive surfacing: `creationTimestamp === 0` (very-old contracts
 * pre-Etherscan indexer coverage) → `ageDays: "unknown"`.
 */
export async function checkContractSecurity(
  chainId: ChainId,
  address: Address | null,
  apiKey: string,
): Promise<EtherscanResult> {
  if (address === null) return { kind: "not-applicable" };

  const cacheKey = `${chainId}:${address}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Budget check BEFORE the network call. Cached hits never reach here,
  // so a cached call does NOT consume the budget.
  if (agentSessionCallCount >= PER_SESSION_CALL_LIMIT) {
    return {
      kind: "rate-limited",
      message: `per-session limit (${PER_SESSION_CALL_LIMIT} calls) exceeded; resets at MCP server restart. Free Etherscan tier allows 100k/day; raise via paid plan if needed.`,
    };
  }
  agentSessionCallCount += 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ETHERSCAN_TIMEOUT_MS);

  // URLs carry the API key in the query string. NEVER log the URL — log
  // the address + error message only. T-ETHERSCAN-KEY-LEAK-1 mitigation.
  //
  // Phase 35 Plan 35-01 — chainid widened from hardcoded 1 to the agent's
  // `chain` arg threaded through `chainIdFromName`. Etherscan V2 enforces
  // the rate limit per API key across all chains (NOT per chain), so the
  // existing `agentSessionCallCount` global counter stays as-is.
  const sourceUrl = `${ETHERSCAN_API_URL}?chainid=${chainId}&apikey=${apiKey}&module=contract&action=getsourcecode&address=${address}`;
  const creationUrl = `${ETHERSCAN_API_URL}?chainid=${chainId}&apikey=${apiKey}&module=contract&action=getcontractcreation&contractaddresses=${address}`;

  let result: EtherscanResult;
  try {
    const [sourceResp, creationResp] = await Promise.all([
      fetch(sourceUrl, { signal: controller.signal }),
      fetch(creationUrl, { signal: controller.signal }),
    ]);

    if (!sourceResp.ok || !creationResp.ok) {
      const status = !sourceResp.ok ? sourceResp.status : creationResp.status;
      result = {
        kind: "error",
        message: `Etherscan V2 returned HTTP ${status}`,
      };
      log("warn", `Etherscan V2 lookup failed for ${address}: ${result.message}`);
    } else {
      let sourceBody: EtherscanApiResponse<EtherscanSourceCodeEntry>;
      let creationBody: EtherscanApiResponse<EtherscanCreationEntry>;
      try {
        sourceBody = (await sourceResp.json()) as EtherscanApiResponse<EtherscanSourceCodeEntry>;
        creationBody = (await creationResp.json()) as EtherscanApiResponse<EtherscanCreationEntry>;
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        result = {
          kind: "error",
          message: `Etherscan V2 invalid response shape: ${msg}`,
        };
        log("warn", `Etherscan V2 lookup failed for ${address}: ${result.message}`);
        cacheInsert(cacheKey, result);
        return result;
      }

      if (
        sourceBody.status !== "1" ||
        !Array.isArray(sourceBody.result) ||
        sourceBody.result.length === 0
      ) {
        const detail =
          typeof sourceBody.result === "string"
            ? sourceBody.result
            : JSON.stringify(sourceBody.result ?? sourceBody.message ?? "");
        result = {
          kind: "error",
          message: `Etherscan getsourcecode failed: ${detail}`,
        };
        log("warn", `Etherscan V2 lookup failed for ${address}: ${result.message}`);
      } else {
        const src = sourceBody.result[0] ?? {};
        const sourceCode = src.SourceCode ?? "";
        const verified =
          sourceCode !== "" && sourceCode !== "Contract source code not verified";
        if (!verified) {
          result = { kind: "not-verified" };
        } else {
          const { privilegedFunctions, accessControlMarkers } = parseAbiForPrivilegedRoles(
            src.ABI ?? "[]",
          );

          // Creation data — soft-fail (some very-old contracts have no
          // creation record in Etherscan's indexer). Surface zero values
          // + ageDays: "unknown" rather than failing the whole probe.
          let creatorAddress = "0x0000000000000000000000000000000000000000" as Address;
          let creationTxHash = "0x";
          let creationTimestamp = 0;
          if (
            creationBody.status === "1" &&
            Array.isArray(creationBody.result) &&
            creationBody.result.length > 0
          ) {
            const c = creationBody.result[0] ?? {};
            if (typeof c.contractCreator === "string") {
              creatorAddress = c.contractCreator as Address;
            }
            if (typeof c.txHash === "string") {
              creationTxHash = c.txHash;
            }
            const tsRaw = c.timestamp;
            if (typeof tsRaw === "string") {
              const parsed = Number(tsRaw);
              if (Number.isFinite(parsed)) creationTimestamp = parsed;
            }
          }

          const ageDays: number | "unknown" =
            creationTimestamp === 0
              ? "unknown"
              : Math.floor((Date.now() / 1000 - creationTimestamp) / 86400);

          const proxy = src.Proxy === "1";
          const implementationRaw = src.Implementation ?? "";
          const implementation =
            implementationRaw !== "" && implementationRaw !== "0x"
              ? (implementationRaw as Address)
              : undefined;

          result = {
            kind: "ok",
            verified: true,
            proxy,
            implementation,
            contractName: src.ContractName ?? "",
            compilerVersion: src.CompilerVersion ?? "",
            creatorAddress,
            creationTxHash,
            creationTimestamp,
            ageDays,
            privilegedFunctions,
            accessControlMarkers,
            abi: src.ABI,
          };
        }
      }
    }
  } catch (err) {
    const errorObj = err as Error;
    if (errorObj?.name === "AbortError") {
      result = {
        kind: "error",
        message: `Etherscan V2 unreachable (timeout ${ETHERSCAN_TIMEOUT_MS}ms)`,
      };
    } else {
      result = {
        kind: "error",
        message: `Etherscan V2 unreachable: ${errorObj?.message ?? String(err)}`,
      };
    }
    log("warn", `Etherscan V2 lookup failed for ${address}: ${result.message}`);
  } finally {
    // ALWAYS clear the timer to prevent a timer leak on the happy path
    // (otherwise `setTimeout` keeps the event loop alive for ~3s after
    // a fast response).
    clearTimeout(timer);
  }

  cacheInsert(cacheKey, result);
  return result;
}

function cacheInsert(cacheKey: string, result: EtherscanResult): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Insertion-order iteration → first key is the oldest. Evict one
    // entry to make room.
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(cacheKey, result);
}

/**
 * Clear the module-scope cache. Test-only — production code never
 * calls this. Underscore-prefix convention matches Phase 4's
 * `_resetFourbyteCacheForTesting` + Phase 2's `_resetPriceCacheForTesting`.
 */
export function _resetEtherscanCacheForTesting(): void {
  cache.clear();
}

/**
 * Reset the per-session rate-limit counter. Test-only — production
 * code never calls this; the counter resets at MCP server restart by
 * design. Tests use this to verify the rate-limit boundary explicitly.
 */
export function _resetEtherscanRateCounterForTesting(): void {
  agentSessionCallCount = 0;
}

// ---------------------------------------------------------------------------
// Phase 35 Plan 35-01 — fetchEtherscanAbi (CUSTOM-02)
//
// New surface alongside `checkContractSecurity` for the escape-hatch tools
// (Plans 35-02 `read_contract` + 35-03 `prepare_custom_call`'s preview-time
// decode). Mirror of the never-throws / 4-arm DU / LRU pattern from
// `src/clients/fourbyte.ts`.
//
// Rate counter is SHARED with checkContractSecurity — Etherscan V2 enforces
// rate limit per API key across all chains (T-35-01-B mitigation).
// Cache key is `${chainId}:${address}` — same address on a different chain
// fetches independently (T-35-01-C mitigation).
//
// `not-applicable` arm is INTENTIONALLY OMITTED: ABI fetch is always
// applicable when called (the consumer has already validated address shape
// + supplied a non-null address).
//
// Disambiguation (Pitfall 6 / 35-RESEARCH.md): the v2 endpoint returns
// `status: "0"` for BOTH "not verified" and other failure modes — match on
// `result === "Contract source code not verified"` exactly to surface the
// `not-verified` arm; everything else → `error`.
// ---------------------------------------------------------------------------

export type EtherscanAbiResult =
  | { kind: "ok"; abi: Abi; rawAbiJson: string; sourceCodeUrl: string }
  | { kind: "not-verified" }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

interface EtherscanGetAbiResponse {
  status?: string;
  message?: string;
  result?: string;
}

// Module-scope per-chain ABI cache. Keyed by `${chainId}:${address}` so a
// `(1, 0xUSDC)` lookup never collides with a `(137, 0xUSDC)` proxy on
// Polygon. Max 64 entries — smaller than the security cache because ABIs
// are larger (a 256-entry ABI cache could be >5MB for proxy-heavy
// sessions).
const abiCache = new Map<string, EtherscanAbiResult>();

/**
 * Per-chain block-explorer URL table. Inline here (NOT in
 * `src/config/contracts.ts`) per RESEARCH § A9: this is a client-internal
 * presentation concern, not a contract-address SOT entry.
 *
 * Base + Optimism use distinct domains despite sharing the OP-Stack —
 * basescan.org and optimistic.etherscan.io are independent explorers.
 */
function buildSourceCodeUrl(chainId: ChainId, address: Address): string {
  switch (chainId) {
    case 1:
      return `https://etherscan.io/address/${address}#code`;
    case 42161:
      return `https://arbiscan.io/address/${address}#code`;
    case 137:
      return `https://polygonscan.com/address/${address}#code`;
    case 8453:
      return `https://basescan.org/address/${address}#code`;
    case 10:
      return `https://optimistic.etherscan.io/address/${address}#code`;
  }
}

/**
 * Best-effort verified-ABI fetch. Never throws; returns one of the four
 * `EtherscanAbiResult` arms.
 *
 * - 200 OK + status="1" → `ok` with parsed `viem.Abi` (parsed ONCE at this
 *   layer; consumers never re-parse).
 * - 200 OK + status="0" + result === "Contract source code not verified"
 *   → `not-verified`.
 * - 200 OK + status="0" + any other result → `error` with verbatim
 *   message (a future contributor cannot accidentally mask a 5xx or
 *   network failure as `not-verified` — Pitfall 6).
 * - HTTP 5xx / 4xx / AbortController timeout / network unreachable /
 *   JSON-parse failure → `error` with verbatim upstream message.
 * - Per-session call budget exhausted → `rate-limited`.
 *
 * Caches all four kinds (LRU with `ABI_CACHE_MAX_ENTRIES = 64`).
 * Resets at MCP server restart by design.
 *
 * URL carries the API key in the query string; NEVER logged
 * (T-ETHERSCAN-KEY-LEAK-1 mitigation — log address + status only).
 */
export async function fetchEtherscanAbi(
  chainId: ChainId,
  address: Address,
  apiKey: string,
): Promise<EtherscanAbiResult> {
  const cacheKey = `${chainId}:${address}`;
  const cached = abiCache.get(cacheKey);
  if (cached) return cached;

  // Budget check BEFORE the network call. Cached hits never reach here,
  // so a cached call does NOT consume the budget. Shared counter with
  // checkContractSecurity (Etherscan V2 limits per API key, not per chain).
  if (agentSessionCallCount >= PER_SESSION_CALL_LIMIT) {
    return {
      kind: "rate-limited",
      message: `per-session limit (${PER_SESSION_CALL_LIMIT} calls) exceeded; resets at MCP server restart. Free Etherscan tier allows 100k/day; raise via paid plan if needed.`,
    };
  }
  agentSessionCallCount += 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ETHERSCAN_TIMEOUT_MS);

  const url = `${ETHERSCAN_API_URL}?chainid=${chainId}&apikey=${apiKey}&module=contract&action=getabi&address=${address}`;

  let result: EtherscanAbiResult;
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      result = {
        kind: "error",
        message: `Etherscan V2 returned HTTP ${resp.status}`,
      };
      log("warn", `Etherscan V2 ABI lookup failed for ${address}: ${result.message}`);
    } else {
      let body: EtherscanGetAbiResponse;
      try {
        body = (await resp.json()) as EtherscanGetAbiResponse;
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        result = {
          kind: "error",
          message: `Etherscan V2 invalid response shape: ${msg}`,
        };
        log("warn", `Etherscan V2 ABI lookup failed for ${address}: ${result.message}`);
        abiCacheInsert(cacheKey, result);
        return result;
      }

      if (body.status === "1" && typeof body.result === "string") {
        // Parse the ABI ONCE at this layer. Cache the parsed `Abi` array on
        // the result; downstream consumers (read_contract, preview_send
        // decode) never re-parse. JSON.parse failure → `error` arm (the
        // ABI string is corrupt — surface verbatim).
        let parsed: Abi;
        try {
          parsed = JSON.parse(body.result) as Abi;
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          result = {
            kind: "error",
            message: `Etherscan getabi returned unparseable JSON: ${msg}`,
          };
          log("warn", `Etherscan V2 ABI lookup failed for ${address}: ${result.message}`);
          abiCacheInsert(cacheKey, result);
          return result;
        }
        result = {
          kind: "ok",
          abi: parsed,
          rawAbiJson: body.result,
          sourceCodeUrl: buildSourceCodeUrl(chainId, address),
        };
      } else if (
        body.status === "0" &&
        typeof body.result === "string" &&
        body.result === "Contract source code not verified"
      ) {
        // Pitfall 6 — match the upstream `result` text EXACTLY. Any other
        // status="0" payload is a failure mode, NOT a "not verified" answer.
        result = { kind: "not-verified" };
      } else {
        const detail = typeof body.result === "string" ? body.result : JSON.stringify(body.result ?? body.message ?? "");
        result = {
          kind: "error",
          message: `Etherscan getabi failed: ${detail}`,
        };
        log("warn", `Etherscan V2 ABI lookup failed for ${address}: ${result.message}`);
      }
    }
  } catch (err) {
    const errorObj = err as Error;
    if (errorObj?.name === "AbortError") {
      result = {
        kind: "error",
        message: `Etherscan V2 unreachable (timeout ${ETHERSCAN_TIMEOUT_MS}ms)`,
      };
    } else {
      result = {
        kind: "error",
        message: `Etherscan V2 unreachable: ${errorObj?.message ?? String(err)}`,
      };
    }
    log("warn", `Etherscan V2 ABI lookup failed for ${address}: ${result.message}`);
  } finally {
    clearTimeout(timer);
  }

  abiCacheInsert(cacheKey, result);
  return result;
}

function abiCacheInsert(cacheKey: string, result: EtherscanAbiResult): void {
  if (abiCache.size >= ABI_CACHE_MAX_ENTRIES) {
    const oldestKey = abiCache.keys().next().value;
    if (oldestKey !== undefined) abiCache.delete(oldestKey);
  }
  abiCache.set(cacheKey, result);
}

/**
 * Cache-only ABI lookup. Returns the cached `ok` arm if present; otherwise
 * returns null WITHOUT making a network call. Used by `preview_send` at
 * the prepare_custom_call DECODED ARGS branch (Plan 35-03) — preview is
 * a synchronous-budget path that MUST NOT trigger network I/O.
 */
export function getCachedEtherscanAbi(
  chainId: ChainId,
  address: Address,
): EtherscanAbiResult | null {
  const cacheKey = `${chainId}:${address}`;
  return abiCache.get(cacheKey) ?? null;
}

/**
 * Clear the ABI cache. Test-only — production code never calls this.
 * Mirror of `_resetEtherscanCacheForTesting` + `_resetFourbyteCacheForTesting`.
 */
export function _resetEtherscanAbiCacheForTesting(): void {
  abiCache.clear();
}
