// MCP tool: get_solana_setup_status({ wallet? }) — Phase 16 Plan 16-01 (SOL-DIAG-01).
//
// Per-wallet Solana diagnostic. Returns:
//   { chain: "solana", walletAddress, nonceAccountPresent, marginfiAccountPresent,
//     kaminoObligationPresent, ledgerSolAppVersion, walletPublicKeyOnDevice,
//     rpcDegraded?, deviceStatus? }
//
// Faithful lazy 3-arm demote-to-null clone of get_tron_setup_status
// (TRON-DIAG-01). All probes are LAZY — they fire at tool-invocation only.
// ZERO RPC happens at server boot.
//
// Three independent probes via Promise.allSettled:
//   (1) RPC PDA presence (5s race) — MarginFi account PDA + Kamino obligation
//       PDA presence (deterministic per-authority PDAs, via the existing
//       indirection helpers) + a best-effort durable-nonce probe. Demotes the
//       three presence flags to `false` + rpcDegraded.reason on any RPC failure.
//   (2) Ledger USB-HID fetchSolanaAddress (10s race) — walletPublicKeyOnDevice =
//       address, ledgerSolAppVersion = appVersion (both from the SAME transport
//       open; getAppConfiguration().version is bundled). Demotes both to null +
//       deviceStatus.reason on failure.
//
// READ-ONLY by construction: this module imports NO handle-minting helper,
// mints NO handle, touches NO trust pipeline, adds NO error code. INVALID_INPUT
// (an existing frozen code) is reused for the no-pairing case. A module-load
// grep guard in the test asserts the write-path symbol is absent here.

import {
  DEFAULT_SOLANA_DERIVATION_PATH,
  LedgerDeviceNotConnectedError,
  LedgerSolanaAppNotOpenError,
  fetchSolanaAddress,
} from "../wallet/ledger-solana-transport.js";
import {
  listAccounts,
  type NonEvmAccountView,
} from "../wallet/non-evm-account-store.js";
import { _marginfiChain } from "../chains/solana/marginfi.js";
import { _kaminoChain } from "../chains/solana/kamino.js";
import { _solanaRegistry } from "../chains/solana/registry.js";
import {
  deriveMarginfiAccountPda,
  deriveKaminoObligationPda,
  getKaminoMainMarket,
} from "../config/contracts.js";
import { registerTool } from "./index.js";
import { log } from "../diagnostics/logger.js";
import { NonceAccount, PublicKey } from "@solana/web3.js";

// ─── Local timeout helper (mirrors get_tron_setup_status) ───────────────────────
function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
  );
}

// ─── RPC presence probe (arm 1) ─────────────────────────────────────────────────
// Reads the deterministic MarginFi account PDA + Kamino obligation PDA for the
// authority + a best-effort durable-nonce probe. Pure-ish: no boot RPC; routes
// through the indirection seams (NO live Connection in tests). Resolves the three
// presence booleans together so a single race timeout governs the whole arm.
async function probeRpcPresence(authority: string): Promise<{
  nonceAccountPresent: boolean;
  marginfiAccountPresent: boolean;
  kaminoObligationPresent: boolean;
}> {
  // MarginFi account PDA presence (account-info non-null).
  const marginfiPda = deriveMarginfiAccountPda(authority, 0);
  const marginfiRaw = await _marginfiChain.getRawAccountInfo(marginfiPda);
  const marginfiAccountPresent = marginfiRaw !== null;

  // Kamino obligation PDA presence under the main market.
  const kaminoPda = deriveKaminoObligationPda(getKaminoMainMarket(), authority);
  const kaminoRaw = await _kaminoChain.getRawAccountInfo(kaminoPda);
  const kaminoObligationPresent = kaminoRaw !== null;

  // Durable-nonce probe (best-effort): a nonce account is not a deterministic
  // per-wallet PDA — it is a separately-created account. We probe the authority
  // pubkey itself for a nonce-account shape; a wallet is never a nonce account,
  // so this resolves false in the common case, and `false` is the safe default.
  let nonceAccountPresent = false;
  try {
    const connection = _solanaRegistry.getConnection();
    const info = await connection.getAccountInfo(new PublicKey(authority));
    if (info !== null) {
      try {
        NonceAccount.fromAccountData(info.data);
        nonceAccountPresent = true;
      } catch {
        nonceAccountPresent = false; // not a nonce account (expected for a wallet)
      }
    }
  } catch {
    // Re-throw so the whole RPC arm demotes uniformly (rpcDegraded set below).
    throw new Error("nonce probe RPC failed");
  }

  return { nonceAccountPresent, marginfiAccountPresent, kaminoObligationPresent };
}

// ─── Tool description (agent-routing prompt) ────────────────────────────────────
const DESCRIPTION = [
  "Returns a Solana per-wallet diagnostic envelope: { chain: \"solana\", walletAddress, nonceAccountPresent, marginfiAccountPresent, kaminoObligationPresent, ledgerSolAppVersion, walletPublicKeyOnDevice, rpcDegraded?, deviceStatus? }.",
  "Call this BEFORE any Solana write tool to confirm Ledger pairing + the on-device public key + durable-nonce / MarginFi / Kamino account presence.",
  "wallet arg is optional — defaults to the paired Solana record; omit for the common single-wallet case.",
  "Fires three independent probes lazily at invocation time (NOT at server boot): an RPC PDA-presence probe (5s timeout) and a Ledger USB-HID fetchSolanaAddress probe (10s timeout).",
  "Each probe degrades independently: RPC failure sets rpcDegraded.reason and safe-defaults nonce/marginfi/kamino presence to false; Ledger failure sets walletPublicKeyOnDevice:null + ledgerSolAppVersion:null + deviceStatus.reason.",
  "Read-only — never mints a handle, never prepares a transaction; failures surface via envelope fields only.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: { type: "string" },
  },
  additionalProperties: false,
};

registerTool(
  "get_solana_setup_status",
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
      records = listAccounts({ chainFilter: "solana" });
    } catch {
      records = [];
    }

    let walletAddress: string;
    let derivationPath: string = DEFAULT_SOLANA_DERIVATION_PATH;

    if (walletArg !== null) {
      walletAddress = walletArg;
      const matchingRecord = records.find((r) => r.address === walletArg);
      if (matchingRecord) {
        derivationPath = matchingRecord.derivationPath;
      }
    } else if (records.length > 0) {
      const record = records[0]!;
      walletAddress = record.address;
      derivationPath = record.derivationPath;
    } else {
      // No wallet arg AND no store record — reuse the EXISTING INVALID_INPUT
      // code (no new error code per SOL-DIAG-01).
      const message =
        "No Solana wallet address provided and no Solana Ledger pairing found in the persistent cache. " +
        "Call pair_solana_ledger to pair a Solana account first.";
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${message}` }],
        structuredContent: {
          errorCode: "INVALID_INPUT",
          message,
          hintTool: "pair_solana_ledger",
        },
      };
    }

    // ── 2. Run RPC + USB-HID probes in PARALLEL (Promise.allSettled) ────────
    const [rpcResult, deviceResult] = await Promise.allSettled([
      // Arm 1: RPC PDA presence — 5s timeout.
      Promise.race([probeRpcPresence(walletAddress), timeoutAfter(5000)]),
      // Arm 2: Ledger USB-HID fetchSolanaAddress — 10s timeout. appVersion is
      // bundled in the SAME transport open via getAppConfiguration().
      Promise.race([fetchSolanaAddress(derivationPath), timeoutAfter(10000)]),
    ]);

    // ── 3. Decode RPC probe result ──────────────────────────────────────────
    let nonceAccountPresent = false;
    let marginfiAccountPresent = false;
    let kaminoObligationPresent = false;
    let rpcDegraded: { reason: string } | undefined = undefined;

    if (rpcResult.status === "fulfilled") {
      const value = rpcResult.value;
      nonceAccountPresent = value.nonceAccountPresent;
      marginfiAccountPresent = value.marginfiAccountPresent;
      kaminoObligationPresent = value.kaminoObligationPresent;
    } else {
      const err = rpcResult.reason as Error | unknown;
      const message = err instanceof Error ? err.message : String(err);
      log("warn", `get_solana_setup_status: RPC presence probe failed: ${message}`);
      rpcDegraded = { reason: `Solana RPC presence probe failed: ${message}` };
      // Safe defaults: all presence flags stay false.
    }

    // ── 4. Decode USB-HID device probe result ───────────────────────────────
    let walletPublicKeyOnDevice: string | null = null;
    let ledgerSolAppVersion: string | null = null;
    let deviceStatus: { reason: string } | undefined = undefined;

    if (deviceResult.status === "fulfilled") {
      const result = deviceResult.value as {
        address: string;
        rawPubkey: Buffer;
        appVersion: string;
      };
      walletPublicKeyOnDevice = result.address;
      ledgerSolAppVersion = result.appVersion ?? null;
    } else {
      const err = deviceResult.reason as Error | unknown;
      log(
        "warn",
        `get_solana_setup_status: Ledger USB-HID probe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      walletPublicKeyOnDevice = null;
      ledgerSolAppVersion = null;
      if (err instanceof LedgerDeviceNotConnectedError) {
        deviceStatus = { reason: "disconnected" };
      } else if (err instanceof LedgerSolanaAppNotOpenError) {
        deviceStatus = { reason: "sol-app-closed" };
      } else {
        const message = err instanceof Error ? err.message : String(err);
        deviceStatus = { reason: `device probe failed: ${message}` };
      }
    }

    // ── 5. Build structured response envelope ───────────────────────────────
    const structuredContent: Record<string, unknown> = {
      chain: "solana",
      walletAddress,
      nonceAccountPresent,
      marginfiAccountPresent,
      kaminoObligationPresent,
      ledgerSolAppVersion,
      walletPublicKeyOnDevice,
    };
    if (rpcDegraded) {
      structuredContent.rpcDegraded = rpcDegraded;
    }
    if (deviceStatus) {
      structuredContent.deviceStatus = deviceStatus;
    }

    // ── 6. Human-readable summary ───────────────────────────────────────────
    const lines: string[] = [
      `chain: solana, walletAddress: ${walletAddress}`,
      `ledgerSolAppVersion: ${ledgerSolAppVersion ?? "null (device unreachable)"}`,
      `walletPublicKeyOnDevice: ${walletPublicKeyOnDevice ?? "null (device unreachable)"}`,
      `nonceAccountPresent: ${nonceAccountPresent}`,
      `marginfiAccountPresent: ${marginfiAccountPresent}`,
      `kaminoObligationPresent: ${kaminoObligationPresent}`,
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
