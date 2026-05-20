// MCP tool: get_tron_setup_status({ wallet? }) — Phase 21 Plan 21-01 (TRON-DIAG-01).
//
// Per-wallet TRON diagnostic tool. Returns the D-01a surface shape:
//   { chain: "tron", walletAddress, ledgerTrxAppVersion, walletAddressOnDevice,
//     addressVerified, resourceAccountPresent, frozenEnergyAmount,
//     frozenBandwidthAmount, rpcDegraded?, deviceStatus? }
//
// All probes (TronGrid `getAccount` + USB-HID `fetchTronAddress` +
// Ledger `getAppConfiguration`) are LAZY — they fire at tool-invocation
// time only. ZERO RPC calls happen at server boot. Mirrors the v1.4
// `request_capability` lazy-loading discipline + v2.0 SOL-DIAG-01
// lazy probe (D-02a / D-02b).
//
// Three independent probes run in PARALLEL via `Promise.allSettled`:
//   (1) TronGrid `getAccount` — 5s timeout — reads `frozenV2` Stake 2.0
//       resource-stake records + `resourceAccountPresent`
//   (2) Ledger USB-HID `fetchTronAddress` — 10s timeout — returns address
//       + publicKey + appVersion from the SAME transport open (appVersion
//       comes from `getAppConfiguration()` bundled inside `fetchTronAddress`
//       per Phase 17 shelf design — D-03a resolved)
//   (3) Both probes demote-to-null independently on failure with explicit
//       reason strings in `rpcDegraded` / `deviceStatus` envelope fields.
//
// `addressVerified`: strict-equality between PAIR-NEV-store TRON record
// and on-device pubkey-derived address. Both base58check. T-PAIRING-DRIFT
// mitigation (D-03c). When `walletAddressOnDevice` is null (device
// unreachable), `addressVerified` evaluates to false — the correct safe
// default.
//
// Frozen amounts surfaced SEPARATELY (D-01c): `frozenEnergyAmount` +
// `frozenBandwidthAmount` as SUN-unit decimal strings. NEVER composite.
// Missing `type` field in a `frozenV2` entry defaults to "BANDWIDTH" per
// TRON Stake 2.0 spec (D-01d).
//
// Phase 21 is READ-ONLY: this tool creates NO handles, touches NO trust
// pipeline, adds NO error codes. The 21-code `errorCodes` union is FROZEN
// (D-06). Failures surface via envelope fields, never as MCP error envelopes
// (exception: INVALID_INPUT reuses the existing frozen code for the
// no-pairing case when no `wallet` arg is provided AND no store record
// exists — zero new codes).

import {
  DEFAULT_TRON_DERIVATION_PATH,
  LedgerDeviceNotConnectedError,
  LedgerTronAppNotOpenError,
  _tronLedgerTransport,
} from "../wallet/ledger-tron-transport.js";
import {
  listAccounts,
  type NonEvmAccountView,
} from "../wallet/non-evm-account-store.js";
import { _tronRegistry } from "../chains/tron/registry.js";
import { registerTool } from "./index.js";
import { log } from "../diagnostics/logger.js";

// ─── Local timeout helper ─────────────────────────────────────────────────────
// Promise.race timeout pattern — mirrors `get_portfolio_summary.ts` fan-out
// AbortController precedent; TronGrid SDK does not expose AbortController so
// we use a rejection race. Per D-02c: TronGrid 5s, USB-HID 10s.
function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
  );
}

// ─── Tool description ─────────────────────────────────────────────────────────
// Agent-routing prompt per CLAUDE.md "Tool descriptions are agent routing
// prompts" convention — verb-first, precise about when to use vs not, state
// each idea once, cut hedging adjectives, mirror get_solana_status style.
const DESCRIPTION = [
  "Returns a TRON per-wallet diagnostic envelope: { chain: \"tron\", walletAddress, ledgerTrxAppVersion, walletAddressOnDevice, addressVerified, resourceAccountPresent, frozenEnergyAmount, frozenBandwidthAmount, rpcDegraded?, deviceStatus? }.",
  "Call this BEFORE any TRON write tool to confirm Ledger pairing state, on-device address match (addressVerified), and Stake 2.0 resource balances (frozenEnergyAmount + frozenBandwidthAmount as SUN-unit decimal strings, reported separately).",
  "wallet arg is optional — defaults to the PAIR-NEV-store TRON record; omit for the common single-wallet case.",
  "Fires three independent probes lazily at invocation time (NOT at server boot): TronGrid getAccount (5s timeout), Ledger USB-HID fetchTronAddress (10s timeout).",
  "Each probe degrades independently: TronGrid failure sets rpcDegraded.reason and uses safe defaults (resourceAccountPresent:false, frozenAmounts:\"0\"); Ledger failure sets walletAddressOnDevice:null + ledgerTrxAppVersion:null + deviceStatus.reason.",
  "addressVerified:false when the stored address !== the on-device derived address (T-PAIRING-DRIFT mitigation) or when the device is unreachable.",
  "Never introduces a new error code — failures surface via envelope fields only.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: { type: "string" },
  },
  additionalProperties: false,
};

registerTool(
  "get_tron_setup_status",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    // ── 1. Resolve walletAddress ────────────────────────────────────────────
    const walletArg =
      typeof args.wallet === "string" && args.wallet.length > 0
        ? args.wallet
        : null;

    let records: NonEvmAccountView[] = [];
    try {
      records = listAccounts({ chainFilter: "tron" });
    } catch {
      // Defense-in-depth: store.listAccounts() swallows IO errors internally,
      // but we wrap here so a future schema-change throw cannot break the tool.
      records = [];
    }

    let walletAddress: string;
    let derivationPath: string = DEFAULT_TRON_DERIVATION_PATH;

    if (walletArg !== null) {
      // Explicit wallet arg wins over the store record.
      walletAddress = walletArg;
      // If the store has a TRON record matching this wallet, use its derivation
      // path for the device probe (correct slot). Otherwise fall back to the
      // default path.
      const matchingRecord = records.find((r) => r.address === walletArg);
      if (matchingRecord) {
        derivationPath = matchingRecord.derivationPath;
      }
    } else if (records.length > 0) {
      // No explicit wallet arg — use the first paired TRON record.
      const record = records[0]!;
      walletAddress = record.address;
      derivationPath = record.derivationPath;
    } else {
      // No wallet arg AND no store record. Refusal via EXISTING INVALID_INPUT
      // error code (21-code union is FROZEN per D-06 — zero new codes).
      const message =
        "No TRON wallet address provided and no TRON Ledger pairing found in the persistent cache. " +
        "Call pair_tron_ledger to pair a TRON account first.";
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${message}` }],
        structuredContent: {
          errorCode: "INVALID_INPUT",
          message,
          hintTool: "pair_tron_ledger",
        },
      };
    }

    // ── 2. Run TronGrid + USB-HID probes in PARALLEL (Promise.allSettled) ──
    // Both probes are independent network/USB calls; sequential would double
    // worst-case latency. Mirror Promise.allSettled pattern from
    // get_portfolio_summary.ts cross-chain fan-out (Plan 08-03).

    const [rpcResult, deviceResult] = await Promise.allSettled([
      // Probe A: TronGrid getAccount — 5s timeout per D-02c
      Promise.race([
        _tronRegistry.getTronWeb().trx.getAccount(walletAddress),
        timeoutAfter(5000),
      ]),
      // Probe B: Ledger USB-HID fetchTronAddress — 10s timeout per D-02c
      // fetchTronAddress already bundles getAppConfiguration() in the SAME
      // transport open + close (Phase 17 shelf design). D-03a resolved:
      // appVersion comes from this call, NOT a separate SDK round-trip.
      Promise.race([
        _tronLedgerTransport.fetchTronAddress(derivationPath),
        timeoutAfter(10000),
      ]),
    ]);

    // ── 3. Decode TronGrid probe result ─────────────────────────────────────
    let resourceAccountPresent = false;
    let frozenEnergyAmount = "0";
    let frozenBandwidthAmount = "0";
    let rpcDegraded: { reason: string } | undefined = undefined;

    if (rpcResult.status === "fulfilled") {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const account = rpcResult.value as unknown;
      const accountObj = (account as Record<string, unknown>) ?? {};
      // resourceAccountPresent: true when the account has at least one field
      // (TronGrid returns {} for a never-touched address per Phase 18 RESEARCH).
      resourceAccountPresent = Object.keys(accountObj).length > 0;

      const frozenV2 = accountObj.frozenV2;
      if (Array.isArray(frozenV2)) {
        // D-01d: entries without `type` field default to "BANDWIDTH" per
        // TRON Stake 2.0 spec (resource-less freeze defaults to bandwidth).
        const energyEntry = frozenV2.find(
          (e: { type?: string; amount?: number }) => e.type === "ENERGY",
        );
        const bandwidthEntry = frozenV2.find(
          (e: { type?: string; amount?: number }) =>
            !e.type || e.type === "BANDWIDTH",
        );
        frozenEnergyAmount = energyEntry
          ? String((energyEntry as { amount: number }).amount)
          : "0";
        frozenBandwidthAmount = bandwidthEntry
          ? String((bandwidthEntry as { amount: number }).amount)
          : "0";
      }
    } else {
      // TronGrid probe failed — set rpcDegraded + safe defaults (D-02a).
      const err = rpcResult.reason as Error | unknown;
      const message = err instanceof Error ? err.message : String(err);
      log("warn", `get_tron_setup_status: TronGrid getAccount failed: ${message}`);
      rpcDegraded = { reason: `TronGrid getAccount failed: ${message}` };
      // Safe defaults: resourceAccountPresent stays false, amounts stay "0".
    }

    // ── 4. Decode USB-HID device probe result ───────────────────────────────
    let walletAddressOnDevice: string | null = null;
    let ledgerTrxAppVersion: string | null = null;
    let deviceStatus: { reason: string } | undefined = undefined;

    if (deviceResult.status === "fulfilled") {
      const result = deviceResult.value as {
        address: string;
        publicKey: string;
        appVersion: string;
      };
      walletAddressOnDevice = result.address;
      // appVersion is always string from fetchTronAddress; D-03a: field is
      // string | null in the response type (null only on failure paths).
      ledgerTrxAppVersion = result.appVersion ?? null;
      // publicKey is NOT surfaced in the response — per CLAUDE.md "No private
      // key material crosses any boundary". The publicKey is not key material
      // per se, but surfacing it leaks cryptographic material to the agent
      // context unnecessarily; on-device address is the trust anchor.
    } else {
      // Ledger probe failed — classify by error type for the user's benefit.
      const err = deviceResult.reason as Error | unknown;
      log("warn", `get_tron_setup_status: Ledger USB-HID probe failed: ${err instanceof Error ? err.message : String(err)}`);
      walletAddressOnDevice = null;
      ledgerTrxAppVersion = null;
      if (err instanceof LedgerDeviceNotConnectedError) {
        deviceStatus = { reason: "disconnected" };
      } else if (err instanceof LedgerTronAppNotOpenError) {
        deviceStatus = { reason: "trx-app-closed" };
      } else {
        const message = err instanceof Error ? err.message : String(err);
        deviceStatus = { reason: `device probe failed: ${message}` };
      }
    }

    // ── 5. Strict-equality check (T-PAIRING-DRIFT mitigation, D-03c) ───────
    // When walletAddressOnDevice is null, `walletAddress === null` evaluates
    // to false — the correct safe default (device unreachable → cannot verify).
    const addressVerified: boolean = walletAddress === walletAddressOnDevice;

    // ── 6. Build structured response envelope ───────────────────────────────
    const structuredContent: Record<string, unknown> = {
      chain: "tron",
      walletAddress,
      ledgerTrxAppVersion,
      walletAddressOnDevice,
      addressVerified,
      resourceAccountPresent,
      frozenEnergyAmount,
      frozenBandwidthAmount,
    };
    if (rpcDegraded) {
      structuredContent.rpcDegraded = rpcDegraded;
    }
    if (deviceStatus) {
      structuredContent.deviceStatus = deviceStatus;
    }

    // ── 7. Human-readable summary (mirrors get_solana_status style) ─────────
    const lines: string[] = [
      `chain: tron, walletAddress: ${walletAddress}`,
      `ledgerTrxAppVersion: ${ledgerTrxAppVersion ?? "null (device unreachable)"}`,
      `walletAddressOnDevice: ${walletAddressOnDevice ?? "null (device unreachable)"}`,
      `addressVerified: ${addressVerified}`,
      `resourceAccountPresent: ${resourceAccountPresent}`,
      `frozenEnergyAmount: ${frozenEnergyAmount} (SUN)`,
      `frozenBandwidthAmount: ${frozenBandwidthAmount} (SUN)`,
    ];
    if (rpcDegraded) {
      lines.push(`rpcDegraded: ${rpcDegraded.reason}`);
    }
    if (deviceStatus) {
      lines.push(`deviceStatus: ${deviceStatus.reason}`);
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent,
    };
  },
);

