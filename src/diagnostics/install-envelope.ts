export const ENVELOPE_VERSION = 1;

export type CheckLevel = "ok" | "warn" | "error";

export type CheckId =
  | "node-version"
  | "binary-spawn"
  | "wallet-connect-key"
  | "ethereum-rpc"
  | "config-file";

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
