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

import { type Address } from "viem";

import { log } from "../diagnostics/logger.js";

const ETHERSCAN_API_URL = "https://api.etherscan.io/v2/api";
const ETHERSCAN_TIMEOUT_MS = 3000; // 2× fourbyte — Etherscan V2 latency higher.
const CACHE_MAX_ENTRIES = 256;
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
const cache = new Map<Address, EtherscanResult>();

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
  address: Address | null,
  apiKey: string,
): Promise<EtherscanResult> {
  if (address === null) return { kind: "not-applicable" };

  const cached = cache.get(address);
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
  const sourceUrl = `${ETHERSCAN_API_URL}?chainid=1&apikey=${apiKey}&module=contract&action=getsourcecode&address=${address}`;
  const creationUrl = `${ETHERSCAN_API_URL}?chainid=1&apikey=${apiKey}&module=contract&action=getcontractcreation&contractaddresses=${address}`;

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
        cacheInsert(address, result);
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

  cacheInsert(address, result);
  return result;
}

function cacheInsert(address: Address, result: EtherscanResult): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Insertion-order iteration → first key is the oldest. Evict one
    // entry to make room.
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(address, result);
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
