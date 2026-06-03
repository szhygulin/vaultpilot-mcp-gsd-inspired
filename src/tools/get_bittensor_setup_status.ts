// MCP tool: get_bittensor_setup_status({ wallet? }) — Phase 49 Plan 49-01
// (TAO-DIAG-01). The LAST Bittensor surface of v2.7.
//
// Per-wallet Bittensor diagnostic. Returns the envelope:
//   { chain: "bittensor", walletAddress, ledgerPolkadotAppVersion,
//     walletAddressOnDevice, stakePositionsPresent, rpcDegraded?, deviceStatus? }
//
// `addressVerified` is OMITTED per spec — unlike the TRON D-01a sibling, this
// diagnostic surfaces `walletAddressOnDevice` verbatim for the agent to compare
// against the stored address, but performs NO strict-equality guard field. It
// is a diagnostic, not a guard (T-PAIRING-DRIFT disposition: accept).
//
// Near-mechanical clone of `get_tron_setup_status` with the Bittensor seams:
//   ARM A (RPC, ~5s)   — `getStakeInfo(walletAddress)` → stakePositionsPresent
//                        = rows.length > 0; reject/timeout → false + rpcDegraded.
//   ARMs B+C (device,  — `fetchBittensorSetup(derivationPath)` → ONE transport
//   ~10s)                open yielding BOTH walletAddressOnDevice (ARM B) and
//                        ledgerPolkadotAppVersion (ARM C); reject → both null +
//                        deviceStatus (classified disconnected / polkadot-app-
//                        closed / message).
//
// All probes are LAZY — fired at tool-invocation time only. `getStakeInfo`
// routes through `_bittensorRegistry.getApi()` INTERNALLY; this tool NEVER
// calls `getApi()` directly (preserves the no-boot-RPC seam — CLAUDE.md ESM
// spy-affordance convention). ZERO RPC / ZERO transport open at server boot.
//
// No-pairing precheck: no `wallet` arg AND no store record → FROZEN
// INVALID_INPUT + hintTool:"pair_bittensor_ledger", returning BEFORE any
// Promise.allSettled (NO probe fired). No new error code — reuses the FROZEN
// INVALID_INPUT.
//
// Phase 49 is READ-ONLY: this tool creates NO handle, touches NO trust
// pipeline, adds NO error code, and touches NONE of the FROZEN cryptographic-
// binding chain.

import { getStakeInfo } from "../chains/bittensor/tao-rpc-client.js";
import { type Ss58Address } from "../chains/bittensor/types.js";
import {
  DEFAULT_BITTENSOR_DERIVATION_PATH,
  LedgerBittensorAppNotOpenError,
  fetchBittensorSetup,
} from "../wallet/ledger-bittensor-transport.js";
import { LedgerDeviceNotConnectedError } from "../wallet/ledger-solana-transport.js";
import {
  listAccounts,
  type NonEvmAccountView,
} from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";
import { log } from "../diagnostics/logger.js";

// ─── Local timeout helper ─────────────────────────────────────────────────────
// Promise.race rejection timer — mirrors `get_tron_setup_status.ts`. The RPC
// (getStakeInfo, WS round-trip) gets 5s; the USB-HID device approval gets 10s.
function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
  );
}

// ─── Tool description ─────────────────────────────────────────────────────────
// Agent-routing prompt per CLAUDE.md "Tool descriptions are agent routing
// prompts" convention — verb-first, precise, mirror get_bittensor_status style.
const DESCRIPTION = [
  'Returns a Bittensor per-wallet diagnostic envelope: { chain: "bittensor", walletAddress, ledgerPolkadotAppVersion, walletAddressOnDevice, stakePositionsPresent, rpcDegraded?, deviceStatus? }.',
  "Call this BEFORE any Bittensor write tool to confirm Ledger pairing state, the on-device coldkey (walletAddressOnDevice — compare it against your stored address), the Polkadot Generic app version, and whether the coldkey has any alpha stake positions.",
  "wallet arg is optional — defaults to the paired Bittensor record in the persistent cache; omit for the common single-wallet case.",
  "Fires two independent probes lazily at invocation time (NOT at server boot): subtensor getStakeInfo over the RPC (5s timeout), and a single Ledger USB-HID device open that yields both the on-device address and the app version (10s timeout).",
  "Each probe degrades independently: RPC failure sets rpcDegraded.reason and stakePositionsPresent:false; device failure sets walletAddressOnDevice:null + ledgerPolkadotAppVersion:null + deviceStatus.reason (disconnected / polkadot-app-closed).",
  "Never introduces a new error code — failures surface via envelope fields; the only error path is INVALID_INPUT when no wallet arg is given AND no Bittensor pairing exists (hintTool: pair_bittensor_ledger).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: { type: "string" },
  },
  additionalProperties: false,
};

registerTool(
  "get_bittensor_setup_status",
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
      records = listAccounts({ chainFilter: "bittensor" });
    } catch {
      // Defense-in-depth: listAccounts() swallows IO errors internally, but we
      // wrap here so a future schema-change throw cannot break the tool.
      records = [];
    }

    let walletAddress: string;
    let derivationPath: string = DEFAULT_BITTENSOR_DERIVATION_PATH;

    if (walletArg !== null) {
      // Explicit wallet arg wins over the store record.
      walletAddress = walletArg;
      const matchingRecord = records.find((r) => r.address === walletArg);
      if (matchingRecord) {
        derivationPath = matchingRecord.derivationPath;
      }
    } else if (records.length > 0) {
      // No explicit wallet arg — use the first paired Bittensor record.
      const record = records[0]!;
      walletAddress = record.address;
      derivationPath = record.derivationPath;
    } else {
      // No wallet arg AND no store record. Refusal via the EXISTING FROZEN
      // INVALID_INPUT error code (zero new codes). Returns HERE — BEFORE any
      // Promise.allSettled — so NO probe fires (no getApi, no transport open).
      const message =
        "No Bittensor wallet address provided and no Bittensor Ledger pairing found in the persistent cache. " +
        "Call pair_bittensor_ledger to pair a Bittensor coldkey first.";
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${message}` }],
        structuredContent: {
          errorCode: "INVALID_INPUT",
          message,
          hintTool: "pair_bittensor_ledger",
        },
      };
    }

    // ── 2. Run the RPC + USB-HID probes in PARALLEL (Promise.allSettled) ──────
    // Two independent probes; sequential would double worst-case latency.
    // Mirror the get_tron_setup_status fan-out. The device arm is a SINGLE
    // transport open (fetchBittensorSetup) yielding BOTH device fields — ARMs
    // B + C share one on-device approval.
    const [rpcResult, deviceResult] = await Promise.allSettled([
      // ARM A: subtensor getStakeInfo — 5s timeout. Routes through
      // _bittensorRegistry.getApi() internally (the no-boot-RPC seam).
      Promise.race([
        getStakeInfo(walletAddress as Ss58Address),
        timeoutAfter(5000),
      ]),
      // ARMs B + C: Ledger USB-HID fetchBittensorSetup — 10s timeout. One open
      // returns { address, pubKey, appVersion }.
      Promise.race([
        fetchBittensorSetup(derivationPath),
        timeoutAfter(10000),
      ]),
    ]);

    // ── 3. Decode ARM A (RPC stake presence) ─────────────────────────────────
    let stakePositionsPresent = false;
    let rpcDegraded: { reason: string } | undefined = undefined;

    if (rpcResult.status === "fulfilled") {
      const rows = rpcResult.value as Awaited<ReturnType<typeof getStakeInfo>>;
      // Boolean only — no amount decode. Presence = at least one stake row.
      stakePositionsPresent = Array.isArray(rows) && rows.length > 0;
    } else {
      const err = rpcResult.reason as Error | unknown;
      const message = err instanceof Error ? err.message : String(err);
      log(
        "warn",
        `get_bittensor_setup_status: getStakeInfo failed: ${message}`,
      );
      rpcDegraded = { reason: `getStakeInfo failed: ${message}` };
      // Safe default: stakePositionsPresent stays false.
    }

    // ── 4. Decode ARMs B + C (single-open device probe) ───────────────────────
    let walletAddressOnDevice: string | null = null;
    let ledgerPolkadotAppVersion: string | null = null;
    let deviceStatus: { reason: string } | undefined = undefined;

    if (deviceResult.status === "fulfilled") {
      const result = deviceResult.value as {
        address: string;
        pubKey: string;
        appVersion: string;
      };
      walletAddressOnDevice = result.address;
      ledgerPolkadotAppVersion = result.appVersion;
      // pubKey is NOT surfaced — on-device address is the trust anchor and
      // surfacing cryptographic material to the agent context is unnecessary
      // (TRON precedent; CLAUDE.md "No private key material crosses any
      // boundary").
    } else {
      // Single-open helper failed — both device fields demote together.
      const err = deviceResult.reason as Error | unknown;
      log(
        "warn",
        `get_bittensor_setup_status: Ledger USB-HID probe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      walletAddressOnDevice = null;
      ledgerPolkadotAppVersion = null;
      if (err instanceof LedgerDeviceNotConnectedError) {
        deviceStatus = { reason: "disconnected" };
      } else if (err instanceof LedgerBittensorAppNotOpenError) {
        deviceStatus = { reason: "polkadot-app-closed" };
      } else {
        const message = err instanceof Error ? err.message : String(err);
        deviceStatus = { reason: `device probe failed: ${message}` };
      }
    }

    // ── 5. Build structured response envelope (addressVerified OMITTED) ───────
    const structuredContent: Record<string, unknown> = {
      chain: "bittensor",
      walletAddress,
      ledgerPolkadotAppVersion,
      walletAddressOnDevice,
      stakePositionsPresent,
    };
    if (rpcDegraded) {
      structuredContent.rpcDegraded = rpcDegraded;
    }
    if (deviceStatus) {
      structuredContent.deviceStatus = deviceStatus;
    }

    // ── 6. Human-readable summary (mirrors get_tron_setup_status line format) ─
    const lines: string[] = [
      `chain: bittensor, walletAddress: ${walletAddress}`,
      `ledgerPolkadotAppVersion: ${ledgerPolkadotAppVersion ?? "null (device unreachable)"}`,
      `walletAddressOnDevice: ${walletAddressOnDevice ?? "null (device unreachable)"}`,
      `stakePositionsPresent: ${stakePositionsPresent}`,
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
