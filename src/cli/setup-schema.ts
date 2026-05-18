// src/cli/setup-schema.ts — Phase 10 / Plan 10-03 (DIST-42).
//
// SINGLE Zod Source of Truth for `vaultpilot-mcp setup` payload validation.
// Both the interactive wizard (`setup-prompts.ts`) and the non-interactive
// stdin/JSON reader (`setup-non-interactive.ts`) import `SetupPayloadSchema`
// from this file — T-WIZARD-SCHEMA-SOT-1 invariant. Without the single SOT
// the two paths drift; non-interactive users get a different config shape
// than interactive users.
//
// T-CONFIG-LEAK-1 mitigation lives here too: `redactForEnvelope()` replaces
// every secret-bearing field with the literal `***REDACTED***` BEFORE the
// caller emits the InstallEnvelope to stdout. Mirror of Plan 05-03's
// `get_vaultpilot_config_status` secret-safety contract (booleans / counts
// / provider-name only) and Plan 08-01's 3-sentinel substring scan.

import { z } from "zod";

/**
 * Setup payload accepted by both interactive and non-interactive paths.
 *
 * Every field is optional. Empty input (`{}`) is valid — the wizard runs in
 * "no-op" mode (touches nothing). The caller decides which fields are
 * required by the chosen mode (e.g. `registerWith` is meaningful only when
 * a binary is on the PATH).
 *
 * - `walletConnectProjectId` — WalletConnect Cloud project ID (8+ chars).
 * - `rpcUrl`                 — full chain RPC URL (https:// required).
 * - `rpcProvider`            — shorthand name; pair with `rpcApiKey`.
 * - `rpcApiKey`              — API key for the shorthand provider.
 * - `etherscanApiKey`        — Etherscan Multichain V2 API key.
 * - `registerWith`           — which MCP client(s) to auto-register with.
 * - `skipLedgerPairing`      — skip wizard Step 3 (interactive path only).
 */
export const SetupPayloadSchema = z
  .object({
    walletConnectProjectId: z.string().min(8).optional(),
    rpcUrl: z
      .string()
      .url()
      .startsWith("https://")
      .optional(),
    rpcProvider: z
      .enum(["infura", "alchemy", "publicnode", "explicit"])
      .optional(),
    rpcApiKey: z.string().min(8).optional(),
    etherscanApiKey: z
      .string()
      .regex(/^[A-Z0-9]{20,40}$/)
      .optional(),
    registerWith: z
      .array(z.enum(["claude-code", "claude-desktop", "cursor"]))
      .optional(),
    skipLedgerPairing: z.boolean().optional(),
  })
  .strict();

export type SetupPayload = z.infer<typeof SetupPayloadSchema>;

/**
 * The literal substituted for every secret-bearing field before envelope
 * emission. Plain ASCII so it survives JSON-stringify / shell-pipe / agent-
 * relay without escaping surprises.
 */
export const REDACTED_LITERAL = "***REDACTED***";

/**
 * T-CONFIG-LEAK-1 mitigation: replace every secret-bearing field with the
 * `***REDACTED***` literal BEFORE the caller emits the InstallEnvelope to
 * stdout. Non-secret fields (`rpcProvider`, `registerWith`,
 * `skipLedgerPairing`) pass through unchanged — `rpcProvider` is just a
 * shorthand NAME (`infura` / `alchemy`), not the API key VALUE.
 *
 * Asserted by `test/cli-setup-non-interactive.test.ts` Case "T-CONFIG-LEAK-1
 * 3-sentinel substring scan": feed a payload with three distinguishable
 * sentinel values, capture stdout, assert NONE of the three appear in the
 * JSON output. Mirror of Plan 05-03 + Plan 08-01 precedent.
 */
export function redactForEnvelope(payload: SetupPayload): SetupPayload {
  return {
    ...payload,
    walletConnectProjectId: payload.walletConnectProjectId
      ? REDACTED_LITERAL
      : undefined,
    rpcUrl: payload.rpcUrl ? REDACTED_LITERAL : undefined,
    rpcApiKey: payload.rpcApiKey ? REDACTED_LITERAL : undefined,
    etherscanApiKey: payload.etherscanApiKey ? REDACTED_LITERAL : undefined,
  };
}
