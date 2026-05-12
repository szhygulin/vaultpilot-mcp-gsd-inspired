import { _paths, readConfigFile } from "../config/config-file.js";
import {
  ENVELOPE_VERSION,
  type CheckResult,
  type InstallEnvelope,
  escalateStatus,
} from "./install-envelope.js";

export interface RunCheckOptions {
  json: boolean;
}

const MIN_NODE_MAJOR = 18;
const MIN_NODE_MINOR = 17;

export async function runCheck(opts: RunCheckOptions): Promise<number> {
  const checks: CheckResult[] = [
    checkNodeVersion(),
    checkBinarySpawn(),
    checkWalletConnectKey(),
    checkEthereumRpc(),
    checkConfigFile(),
  ];

  const status = escalateStatus(checks);
  const envelope: InstallEnvelope = {
    envelope_version: ENVELOPE_VERSION,
    status,
    checks,
    metadata: {
      vaultpilot_mcp_version: await readPackageVersion(),
      node_version: process.versions.node,
    },
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
  } else {
    writeHumanOutput(envelope);
  }

  return status === "error" ? 1 : 0;
}

function checkNodeVersion(): CheckResult {
  const nodeVersion = process.versions.node;
  const parts = nodeVersion.split(".");
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const ok =
    major > MIN_NODE_MAJOR ||
    (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);

  return {
    id: "node-version",
    level: ok ? "ok" : "error",
    message: ok
      ? `Node ${nodeVersion}`
      : `Node ${nodeVersion} — requires >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}`,
  };
}

function checkBinarySpawn(): CheckResult {
  return {
    id: "binary-spawn",
    level: "ok",
    message: "Binary spawned successfully",
  };
}

function checkWalletConnectKey(): CheckResult {
  const present = Boolean(process.env.WALLETCONNECT_PROJECT_ID);
  return {
    id: "wallet-connect-key",
    level: present ? "ok" : "warn",
    message: present
      ? "WALLETCONNECT_PROJECT_ID set"
      : "WALLETCONNECT_PROJECT_ID not set — Phase 3+ requires this; not needed for read-only use",
  };
}

function checkEthereumRpc(): CheckResult {
  const present = Boolean(process.env.ETHEREUM_RPC_URL);
  return {
    id: "ethereum-rpc",
    level: present ? "ok" : "warn",
    message: present
      ? "ETHEREUM_RPC_URL set"
      : "ETHEREUM_RPC_URL not set — will fall back to PublicNode public RPC",
  };
}

function checkConfigFile(): CheckResult {
  // Path + I/O delegated to the format-fanout-sentinel helper at
  // `src/config/config-file.ts`. The three text branches below stay
  // BYTE-IDENTICAL to the Phase 1 implementation so any existing
  // `--check` text assertions remain green.
  const path = _paths.getConfigPath();
  const result = readConfigFile();
  if (result.ok) {
    return {
      id: "config-file",
      level: "ok",
      message: `${path} parsed`,
    };
  }
  if (result.reason === "missing") {
    return {
      id: "config-file",
      level: "ok",
      message: `${path} (absent — auto-demo will run)`,
    };
  }
  return {
    id: "config-file",
    level: "warn",
    message: `${path} malformed: ${result.cause}`,
  };
}

const LEVEL_GLYPH: Record<CheckResult["level"], string> = {
  ok: "✓",
  warn: "⚠",
  error: "✗",
};

function writeHumanOutput(envelope: InstallEnvelope): void {
  const lines: string[] = [];
  lines.push(`vaultpilot-mcp ${envelope.metadata.vaultpilot_mcp_version} — install check`);
  lines.push("");
  for (const check of envelope.checks) {
    lines.push(`${LEVEL_GLYPH[check.level]} ${check.id}: ${check.message}`);
  }
  lines.push("");
  lines.push(`Status: ${envelope.status}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function readPackageVersion(): Promise<string> {
  try {
    const pkg = (await import("../../package.json", { with: { type: "json" } })) as {
      default: { version: string };
    };
    return pkg.default.version;
  } catch {
    return "0.0.0";
  }
}
