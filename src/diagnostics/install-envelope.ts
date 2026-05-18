export const ENVELOPE_VERSION = 1;

export type CheckLevel = "ok" | "warn" | "error";

export type CheckId =
  | "node-version"
  | "binary-spawn"
  | "wallet-connect-key"
  | "ethereum-rpc"
  | "config-file"
  // ── Phase 10 / Plan 10-03 (setup wizard + MCP client register) ──
  | "config-file-write"
  | "mcp-client-register-claude-code"
  | "mcp-client-register-claude-desktop"
  | "mcp-client-register-cursor"
  | "ledger-pairing"
  // ── Phase 10 / Plan 10-02 (install.sh + install.ps1) ──
  | "binary-download"
  | "binary-install"
  | "path-presence"
  | "quarantine-attr";

export interface CheckResult {
  id: CheckId;
  level: CheckLevel;
  message: string;
}

export interface InstallEnvelope {
  envelope_version: typeof ENVELOPE_VERSION;
  status: CheckLevel;
  checks: CheckResult[];
  metadata: {
    vaultpilot_mcp_version: string;
    node_version: string;
  };
}

export function escalateStatus(checks: CheckResult[]): CheckLevel {
  if (checks.some((c) => c.level === "error")) return "error";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "ok";
}
