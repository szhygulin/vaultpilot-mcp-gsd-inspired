// src/clients/lifi.ts — Phase 26 Plan 26-03 (BTC-LIFI-01).
//
// NEVER-throws LiFi /v1/quote HTTP client for BTC-source bridge quotes.
// Sibling of src/clients/fourbyte.ts (NEVER-throws shape + vi.stubGlobal test seam)
// and src/clients/etherscan.ts (more discriminated-union arms).
//
// The LiFi HTTP API is called with raw fetch — NO @lifi/sdk installed.
// RESEARCH: @lifi/sdk v3.x brings 13+ transitive deps (Solana, SUI, NEAR,
// bitcoin, bech32, bigmi/core) and assumes it controls wallet signing.
// Raw fetch is sufficient and consistent with how all other HTTP clients
// in this project work (fourbyte.ts, etherscan.ts, esplora-client.ts).
//
// NEVER-throws contract: every network failure, HTTP error, JSON parse
// error, AbortController timeout, or unexpected response shape returns a
// `LifiBtcQuoteResult` discriminated union — never throws.
//
// Test seam: vi.stubGlobal("fetch", …) at the OUTER network boundary per
// CLAUDE.md convention (same as fourbyte.ts + esplora-client.ts). Do NOT
// add a _lifiClient indirection wrapper — that convention applies to
// modules whose internal exports call each other, not to external HTTP
// clients (per CLAUDE.md "For external network clients … prefer
// vi.stubGlobal(\"fetch\", …) at the network boundary").
//
// Security notes:
//   - mapLifiResponse extracts ONLY action.toAddress + transactionRequest.{to,data,value};
//     all other fields in the LiFi response body are ignored (T-26-13 mitigation).
//   - fromToken="bitcoin" (token-address form, NOT "BTC" symbol) per RESEARCH Open Q #1.
//   - fromAddress is always a single bech32 address, never an xpub or
//     semicolon list (RESEARCH Pitfall 4 — HTTP 400 code 1011 on xpub form).
//   - No cache — LiFi quotes are live market data; a stale PSBT carries a stale
//     fee/output set and must not be reused across requests.
//
// LIFI_BTC_CHAIN_ID = "20000000000001" — verified live 2026-05-22 via
//   GET https://li.quest/v1/chains?chainTypes=UTXO (RESEARCH Assumption A3).

import { log } from "../diagnostics/logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const LIFI_API_BASE = "https://li.quest";
export const LIFI_TIMEOUT_MS = 10_000;

/**
 * LiFi BTC chain ID — verified live 2026-05-22 via
 * GET https://li.quest/v1/chains?chainTypes=UTXO.
 * Stable assumption (A3): this is the production chain ID for Bitcoin mainnet,
 * not a test/staging artifact.
 */
export const LIFI_BTC_CHAIN_ID = "20000000000001";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The subset of fields extracted from a LiFi BTC quote response.
 * Only these fields cross the security boundary (T-26-13 — response injection).
 * All other fields in the raw LiFi JSON body are discarded by mapLifiResponse.
 */
export interface LifiBtcQuote {
  /** Final destination address on the target chain (ETH/SOL/etc). */
  action: {
    toAddress: string;
  };
  transactionRequest: {
    /** Bridge vault BTC deposit address — the PSBT's first output goes here. */
    to: string;
    /** PSBT hex starting with "70736274ff" (psbt magic bytes). Output order is load-bearing. */
    data: string;
    /** Satoshi amount as string (LiFi returns string, NOT BigInt). */
    value: string;
  };
}

/**
 * NEVER-throws discriminated union for LiFi /v1/quote results.
 *
 * - `ok`           — 200 HTTP OK + valid quote shape.
 * - `not-found`    — 404 HTTP (no route found for the requested swap).
 * - `rate-limited` — 429 HTTP (LiFi public-API rate limit exhausted).
 * - `error`        — Any other HTTP error, timeout, AbortError, JSON parse failure,
 *                    or unexpected response shape.
 */
export type LifiBtcQuoteResult =
  | { kind: "ok"; quote: LifiBtcQuote }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

// ─── Internal types ───────────────────────────────────────────────────────────

// Raw LiFi response body shape — only used internally by mapLifiResponse.
// We use `unknown` first, then narrow via mapLifiResponse so unexpected
// fields never leak into LifiBtcQuote.
interface RawLifiAction {
  toAddress?: unknown;
  [key: string]: unknown;
}

interface RawLifiTransactionRequest {
  to?: unknown;
  data?: unknown;
  value?: unknown;
  [key: string]: unknown;
}

interface RawLifiBody {
  action?: RawLifiAction;
  transactionRequest?: RawLifiTransactionRequest;
  [key: string]: unknown;
}

// ─── mapLifiResponse — strict field extraction (T-26-13 mitigation) ─────────

/**
 * Extract ONLY the fields VaultPilot needs from the raw LiFi API response body.
 * All other fields are discarded (T-26-13 LiFi API response injection mitigation).
 *
 * Returns null if any required field is missing or not a string.
 */
function mapLifiResponse(body: RawLifiBody): LifiBtcQuote | null {
  const toAddress = body.action?.toAddress;
  const tr = body.transactionRequest;
  const trTo = tr?.to;
  const trData = tr?.data;
  const trValue = tr?.value;

  if (
    typeof toAddress !== "string" ||
    typeof trTo !== "string" ||
    typeof trData !== "string" ||
    typeof trValue !== "string"
  ) {
    return null;
  }

  return {
    action: { toAddress },
    transactionRequest: { to: trTo, data: trData, value: trValue },
  };
}

// ─── fetchBtcLifiQuote ────────────────────────────────────────────────────────

/**
 * Fetch a BTC-source LiFi bridge quote. NEVER throws — returns a
 * `LifiBtcQuoteResult` discriminated union.
 *
 * @param params.btcAddress  Single bech32 segwit address (bc1q… / bc1p…).
 *                           NEVER an xpub or semicolon-separated list
 *                           (RESEARCH Pitfall 4 — causes HTTP 400 code 1011).
 * @param params.amountSatoshi  Amount in satoshi as bigint.
 * @param params.toChain     Target chain symbol: "ETH", "ARB", "POL", "SOL", etc.
 * @param params.toToken     Target token address or symbol.
 * @param params.toAddress   Destination address on the target chain.
 *
 * URL shape (RESEARCH Pattern 4, Open Q #1):
 *   GET https://li.quest/v1/quote
 *   ?fromChain=BTC (chainId 20000000000001)
 *   &fromToken=bitcoin  ← token-address form, NOT the "BTC" symbol
 *   &fromAddress=<btcAddress>
 *   &fromAmount=<satoshi as string>
 *   &toChain=<toChain>
 *   &toToken=<toToken>
 *   &toAddress=<toAddress>
 *   &integrator=vaultpilot-mcp
 */
// ─── fetchLifiQuote (generic sibling — SOL-W-21, Phase 16 Plan 16-02) ───────────
//
// SIBLING to fetchBtcLifiQuote — a GENERIC /v1/quote client used for the Solana
// bridge flows (Solana→EVM outbound + EVM→Solana inbound). NOT a reuse of
// fetchBtcLifiQuote, which hardcodes fromChain=BTC + the PSBT shape.
//
// Same NEVER-throws envelope discipline (200→ok, 404→not-found, 429→rate-limited,
// abort/timeout/other→error). Strict field extraction via mapLifiQuoteResponse
// (clone of mapLifiResponse's T-26-13 discipline) — ONLY action.toAddress +
// action.{fromChainId,toChainId} + transactionRequest.{to,data,value} survive;
// every other body field is discarded.

/**
 * The subset of fields extracted from a generic LiFi quote response. Carries the
 * raw `transactionRequest` (the EVM-side outbound tx for Solana→EVM) plus
 * `action.toAddress` + chain IDs for direction detection. All other body fields
 * are discarded by mapLifiQuoteResponse (T-26-13 response-injection mitigation).
 */
export interface LifiQuote {
  action: {
    toAddress: string;
  };
  /** Source chain ID from action.fromChainId — used for direction detection. */
  fromChainId: number;
  /** Target chain ID from action.toChainId. LiFi Solana chain id = 1151111081099710. */
  toChainId: number;
  transactionRequest: {
    /** Dispatch target (EVM LiFi Diamond for an outbound EVM-side tx). */
    to: string;
    /** Calldata (EVM) or base64 (Solana inbound) the device signs. */
    data: string;
    /** Native value as string (LiFi returns string, never BigInt). */
    value: string;
  };
}

/**
 * NEVER-throws discriminated union for the generic LiFi /v1/quote client.
 */
export type LifiQuoteResult =
  | { kind: "ok"; quote: LifiQuote }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

interface RawLifiActionGeneric {
  toAddress?: unknown;
  fromChainId?: unknown;
  toChainId?: unknown;
  [key: string]: unknown;
}

interface RawLifiBodyGeneric {
  action?: RawLifiActionGeneric;
  transactionRequest?: RawLifiTransactionRequest;
  [key: string]: unknown;
}

/**
 * Strict field extraction for a generic LiFi quote (T-26-13). Returns null if
 * any required field is missing or the wrong type. Discards all other fields.
 */
function mapLifiQuoteResponse(body: RawLifiBodyGeneric): LifiQuote | null {
  const toAddress = body.action?.toAddress;
  const fromChainId = body.action?.fromChainId;
  const toChainId = body.action?.toChainId;
  const tr = body.transactionRequest;
  const trTo = tr?.to;
  const trData = tr?.data;
  const trValue = tr?.value;

  if (
    typeof toAddress !== "string" ||
    typeof fromChainId !== "number" ||
    typeof toChainId !== "number" ||
    typeof trTo !== "string" ||
    typeof trData !== "string" ||
    typeof trValue !== "string"
  ) {
    return null;
  }

  return {
    action: { toAddress },
    fromChainId,
    toChainId,
    transactionRequest: { to: trTo, data: trData, value: trValue },
  };
}

/**
 * Fetch a generic LiFi bridge quote. NEVER throws — returns a `LifiQuoteResult`.
 *
 * URL shape:
 *   GET https://li.quest/v1/quote
 *   ?fromChain=<fromChain>&fromToken=<fromToken>&fromAddress=<fromAddress>
 *   &fromAmount=<fromAmount>&toChain=<toChain>&toToken=<toToken>
 *   &toAddress=<toAddress>&integrator=vaultpilot-mcp
 */
export async function fetchLifiQuote(params: {
  fromChain: string;
  fromToken: string;
  fromAddress: string;
  fromAmount: string;
  toChain: string;
  toToken: string;
  toAddress: string;
}): Promise<LifiQuoteResult> {
  const url = new URL(`${LIFI_API_BASE}/v1/quote`);
  url.searchParams.set("fromChain", params.fromChain);
  url.searchParams.set("fromToken", params.fromToken);
  url.searchParams.set("fromAddress", params.fromAddress);
  url.searchParams.set("fromAmount", params.fromAmount);
  url.searchParams.set("toChain", params.toChain);
  url.searchParams.set("toToken", params.toToken);
  url.searchParams.set("toAddress", params.toAddress);
  url.searchParams.set("integrator", "vaultpilot-mcp");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIFI_TIMEOUT_MS);

  let result: LifiQuoteResult;
  try {
    const resp = await fetch(url.toString(), { signal: controller.signal });
    if (!resp.ok) {
      if (resp.status === 404) {
        result = { kind: "not-found" };
        log("info", `LiFi: no route found (404) for ${params.fromChain}→${params.toChain}`);
      } else if (resp.status === 429) {
        const message = `LiFi rate-limited (429) — integrator=vaultpilot-mcp`;
        result = { kind: "rate-limited", message };
        log("warn", `LiFi rate limit hit: ${message}`);
      } else {
        const message = `LiFi returned HTTP ${resp.status}`;
        result = { kind: "error", message };
        log("warn", `LiFi error: ${message}`);
      }
    } else {
      let body: RawLifiBodyGeneric;
      try {
        body = (await resp.json()) as RawLifiBodyGeneric;
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        result = { kind: "error", message: `LiFi invalid JSON response: ${msg}` };
        log("warn", `LiFi JSON parse failed: ${result.message}`);
        return result;
      }
      const quote = mapLifiQuoteResponse(body);
      if (quote === null) {
        result = {
          kind: "error",
          message:
            "LiFi response missing required fields (action.{toAddress,fromChainId,toChainId} or transactionRequest.{to,data,value})",
        };
        log("warn", `LiFi invalid response shape: ${result.message}`);
      } else {
        result = { kind: "ok", quote };
        log(
          "debug",
          `LiFi quote OK: toAddress=${quote.action.toAddress} from=${quote.fromChainId} to=${quote.toChainId}`,
        );
      }
    }
  } catch (err) {
    const errorObj = err as Error;
    if (errorObj?.name === "AbortError") {
      result = { kind: "error", message: `LiFi unreachable (timeout ${LIFI_TIMEOUT_MS}ms)` };
    } else {
      result = { kind: "error", message: `LiFi unreachable: ${errorObj?.message ?? String(err)}` };
    }
    log("warn", `LiFi fetch failed: ${result.message}`);
  } finally {
    clearTimeout(timer);
  }

  return result;
}

export async function fetchBtcLifiQuote(params: {
  btcAddress: string;
  amountSatoshi: bigint;
  toChain: string;
  toToken: string;
  toAddress: string;
}): Promise<LifiBtcQuoteResult> {
  const url = new URL(`${LIFI_API_BASE}/v1/quote`);
  url.searchParams.set("fromChain", "BTC");
  url.searchParams.set("fromToken", "bitcoin"); // token-address form per RESEARCH Open Q #1
  url.searchParams.set("fromAddress", params.btcAddress); // single address, never xpub
  url.searchParams.set("fromAmount", params.amountSatoshi.toString());
  url.searchParams.set("toChain", params.toChain);
  url.searchParams.set("toToken", params.toToken);
  url.searchParams.set("toAddress", params.toAddress);
  url.searchParams.set("integrator", "vaultpilot-mcp");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIFI_TIMEOUT_MS);

  let result: LifiBtcQuoteResult;
  try {
    const resp = await fetch(url.toString(), { signal: controller.signal });
    if (!resp.ok) {
      if (resp.status === 404) {
        result = { kind: "not-found" };
        log("info", `LiFi: no route found (404) for BTC→${params.toChain} ${params.toToken}`);
      } else if (resp.status === 429) {
        const message = `LiFi rate-limited (429) — integrator=vaultpilot-mcp`;
        result = { kind: "rate-limited", message };
        log("warn", `LiFi rate limit hit: ${message}`);
      } else {
        const message = `LiFi returned HTTP ${resp.status}`;
        result = { kind: "error", message };
        log("warn", `LiFi error: ${message}`);
      }
    } else {
      let body: RawLifiBody;
      try {
        body = (await resp.json()) as RawLifiBody;
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        result = { kind: "error", message: `LiFi invalid JSON response: ${msg}` };
        log("warn", `LiFi JSON parse failed: ${result.message}`);
        return result;
      }
      const quote = mapLifiResponse(body);
      if (quote === null) {
        result = {
          kind: "error",
          message: "LiFi response missing required fields (action.toAddress or transactionRequest.{to,data,value})",
        };
        log("warn", `LiFi invalid response shape: ${result.message}`);
      } else {
        result = { kind: "ok", quote };
        log("debug", `LiFi quote OK: toAddress=${quote.action.toAddress} psbtHexLen=${quote.transactionRequest.data.length}`);
      }
    }
  } catch (err) {
    const errorObj = err as Error;
    if (errorObj?.name === "AbortError") {
      result = {
        kind: "error",
        message: `LiFi unreachable (timeout ${LIFI_TIMEOUT_MS}ms)`,
      };
    } else {
      result = {
        kind: "error",
        message: `LiFi unreachable: ${errorObj?.message ?? String(err)}`,
      };
    }
    log("warn", `LiFi fetch failed: ${result.message}`);
  } finally {
    clearTimeout(timer);
  }

  return result;
}
