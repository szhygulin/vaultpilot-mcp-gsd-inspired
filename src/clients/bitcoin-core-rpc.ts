// src/clients/bitcoin-core-rpc.ts — Phase 27 Plan 27-01 (BTC-FORENSIC-01).
//
// NEVER-throws Bitcoin Core JSON-RPC HTTP client.
// Sibling of src/clients/lifi.ts (NEVER-throws shape + vi.stubGlobal test seam)
// and src/clients/etherscan.ts (5-arm discriminated union + HTTP-500-as-RPC-error
// handling).
//
// The client is chain-agnostic — parameterized by URL + credentials so it
// serves both Bitcoin Core (BITCOIN_CORE_RPC_URL) and Litecoin Core
// (LITECOIN_CORE_RPC_URL) without duplication.
//
// NEVER-throws contract: every network failure, HTTP error, JSON parse error,
// AbortController timeout, or unexpected response shape returns a
// `BitcoinCoreRpcResult<T>` discriminated union — never throws.
//
// Test seam: vi.stubGlobal("fetch", …) at the OUTER network boundary per
// CLAUDE.md convention (same as lifi.ts + etherscan.ts). Do NOT add a
// _bitcoinCoreRpcClient indirection wrapper — that convention applies to
// modules whose internal exports call each other, not to external HTTP
// clients (per CLAUDE.md "For external network clients … prefer
// vi.stubGlobal(\"fetch\", …) at the network boundary").
//
// Security notes:
//   - NEVER log the full RPC URL — it may carry embedded user:pass@host form.
//     Log only the method name and error message (T-27-01 mitigation).
//   - NEVER include the URL or credentials (user/pass) in structuredContent
//     or content text. Credentials stay internal (T-27-02 mitigation).
//   - Authorization header is built only when BOTH user AND pass are present.
//     When either is missing, the header is omitted — supports IP-allowlisted
//     Bitcoin Core nodes (RESEARCH §Pitfall 4).
//   - HTTP 500 is the Bitcoin Core RPC-error path (not a transport failure).
//     The client parses the JSON body to extract error.code + error.message
//     before emitting the rpc-error arm (RESEARCH §Pitfall 2 / T-27-03 anchor).

import { log } from "../diagnostics/logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const BITCOIN_CORE_RPC_TIMEOUT_MS = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * NEVER-throws discriminated union for Bitcoin Core (and Litecoin Core) JSON-RPC results.
 *
 * - `not-configured`  — URL is null; no network call was made.
 * - `ok`              — 2xx HTTP + valid JSON-RPC result field.
 * - `rpc-error`       — JSON-RPC application-level error (HTTP 500 body with error.code/message,
 *                       or 2xx body with non-null error field).
 * - `rate-limited`    — HTTP 429 (rate limit; Bitcoin Core may return this with a proxy).
 * - `network-error`   — Transport failure: AbortError timeout, fetch throws, or JSON parse error.
 */
export type BitcoinCoreRpcResult<T> =
  | { kind: "not-configured" }
  | { kind: "ok"; result: T }
  | { kind: "rpc-error"; code: number; message: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "network-error"; message: string };

// ─── Internal JSON-RPC response shape ────────────────────────────────────────

interface RpcResponseBody<T> {
  result?: T;
  error?: { code?: unknown; message?: unknown } | null;
  id?: unknown;
}

// ─── callBitcoinCoreRpc ───────────────────────────────────────────────────────

/**
 * Send a single JSON-RPC 1.0 request to a Bitcoin Core (or Litecoin Core) node.
 * NEVER throws — returns a `BitcoinCoreRpcResult<T>` discriminated union.
 *
 * @param url     Full URL of the Core RPC endpoint (e.g. "http://localhost:8332").
 *                Pass `null` to get an immediate `{ kind: "not-configured" }` without
 *                any network call.
 * @param user    RPC username from BITCOIN_CORE_RPC_USER (or LITECOIN_CORE_RPC_USER).
 *                Pass `undefined` to omit the Authorization header.
 * @param pass    RPC password from BITCOIN_CORE_RPC_PASS (or LITECOIN_CORE_RPC_PASS).
 *                Pass `undefined` to omit the Authorization header.
 * @param method  JSON-RPC method name (e.g. "getblockchaininfo").
 * @param params  Positional parameters array (e.g. [] or [blockHash]).
 */
export async function callBitcoinCoreRpc<T>(
  url: string | null,
  user: string | undefined,
  pass: string | undefined,
  method: string,
  params: unknown[],
): Promise<BitcoinCoreRpcResult<T>> {
  // not-configured arm — url is null means Core is not set up.
  if (url === null) return { kind: "not-configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BITCOIN_CORE_RPC_TIMEOUT_MS);

  // Build Basic auth header only when BOTH user AND pass are present.
  // When either is missing, omit the header entirely (supports IP-allowlisted
  // Core nodes per RESEARCH §Pitfall 4). NEVER log the credential values.
  const authHeader =
    user !== undefined && pass !== undefined
      ? "Basic " + Buffer.from(`${user}:${pass}`).toString("base64")
      : undefined;

  let result: BitcoinCoreRpcResult<T>;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader !== undefined ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({ jsonrpc: "1.0", id: "vaultpilot", method, params }),
      signal: controller.signal,
    });

    if (resp.status === 429) {
      result = { kind: "rate-limited", message: "Bitcoin Core RPC rate-limited (429)" };
      log("warn", `Bitcoin Core RPC rate-limited (429): method=${method}`);
    } else if (!resp.ok) {
      // CRITICAL: Bitcoin Core uses HTTP 500 for JSON-RPC application-level errors
      // (method not found, wrong params, auth failure, etc.). Parse the body to
      // extract error.code + error.message before falling back to a generic error
      // (RESEARCH §Pitfall 2 / T-27-03 anchor). Misclassifying as network-error
      // would hide method-not-found and auth-failure conditions.
      let body: RpcResponseBody<T> | null = null;
      try {
        body = (await resp.json()) as RpcResponseBody<T>;
      } catch {
        /* ignore parse error — use status code fallback below */
      }
      // WR-03: require error to be an object-shaped envelope before reading
      // .code/.message. A malformed proxy injecting `error: "string"` or
      // `error: 42` previously coerced to {code: resp.status, message: "HTTP N"}
      // — indistinguishable from a real Core rpc-error. Tighten to object-only.
      const errVal500 = body?.error;
      const isWellFormedError500 =
        errVal500 !== undefined &&
        errVal500 !== null &&
        typeof errVal500 === "object" &&
        !Array.isArray(errVal500);
      if (errVal500 != null && !isWellFormedError500) {
        // Non-null non-object error envelope — route to network-error so a
        // malformed upstream proxy doesn't masquerade as a Core rpc-error.
        result = {
          kind: "network-error",
          message: `Malformed JSON-RPC envelope: error field has unexpected type ${typeof errVal500}`,
        };
        log("warn", `Bitcoin Core RPC malformed error envelope (HTTP ${resp.status}): method=${method} errorType=${typeof errVal500}`);
      } else {
        const rpcCode =
          isWellFormedError500 && typeof (errVal500 as { code?: unknown }).code === "number"
            ? (errVal500 as { code: number }).code
            : resp.status;
        const rpcMsg =
          isWellFormedError500 && typeof (errVal500 as { message?: unknown }).message === "string"
            ? (errVal500 as { message: string }).message
            : `HTTP ${resp.status}`;
        result = { kind: "rpc-error", code: rpcCode, message: rpcMsg };
        log("warn", `Bitcoin Core RPC error (HTTP ${resp.status}): method=${method} code=${rpcCode} msg=${rpcMsg}`);
      }
    } else {
      // 2xx response — parse the JSON-RPC body.
      let body: RpcResponseBody<T>;
      try {
        body = (await resp.json()) as RpcResponseBody<T>;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result = { kind: "network-error", message: `JSON parse error: ${msg}` };
        log("warn", `Bitcoin Core RPC JSON parse failed: method=${method} err=${msg}`);
        return result; // early exit before finally; clearTimeout in finally still runs
      }

      // WR-03: require error to be an object-shaped envelope before treating
      // it as rpc-error. A non-null non-object value (e.g. `error: "string"`
      // or `error: 42`) is a malformed envelope, not a legitimate RPC error;
      // route to network-error so the agent can distinguish "RPC method failed"
      // from "response shape is malformed".
      const errVal = body.error;
      const isWellFormedError =
        errVal !== undefined &&
        errVal !== null &&
        typeof errVal === "object" &&
        !Array.isArray(errVal);
      if (isWellFormedError) {
        // 2xx response but JSON-RPC error field is a well-formed object.
        const code =
          typeof (errVal as { code?: unknown }).code === "number"
            ? (errVal as { code: number }).code
            : -1;
        const message =
          typeof (errVal as { message?: unknown }).message === "string"
            ? (errVal as { message: string }).message
            : "unknown RPC error";
        result = { kind: "rpc-error", code, message };
        log("warn", `Bitcoin Core RPC 2xx with error body: method=${method} code=${code} msg=${message}`);
      } else if (errVal != null) {
        // Malformed JSON-RPC envelope — parse-level failure.
        result = {
          kind: "network-error",
          message: `Malformed JSON-RPC envelope: error field has unexpected type ${typeof errVal}`,
        };
        log("warn", `Bitcoin Core RPC malformed error envelope (2xx): method=${method} errorType=${typeof errVal}`);
      } else {
        result = { kind: "ok", result: body.result as T };
        log("debug", `Bitcoin Core RPC ok: method=${method}`);
      }
    }
  } catch (err) {
    const e = err as Error;
    if (e?.name === "AbortError") {
      result = {
        kind: "network-error",
        message: `Bitcoin Core RPC timeout (${BITCOIN_CORE_RPC_TIMEOUT_MS}ms)`,
      };
    } else {
      result = {
        kind: "network-error",
        message: `Bitcoin Core RPC unreachable: ${e?.message ?? String(err)}`,
      };
    }
    log("warn", `Bitcoin Core RPC fetch failed: method=${method} err=${result.message}`);
  } finally {
    clearTimeout(timer); // mirror: lifi.ts line 240, etherscan.ts timeout pattern
  }

  return result;
}
