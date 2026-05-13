// MCP tool: get_vaultpilot_config_status({}) — Plan 05-03 / DIAG-01.
//
// Returns a structured summary of vaultpilot-mcp's current configuration
// state. The response contract is BOOLEANS / COUNTS / SUFFIXES / PATHS /
// PUBLIC values ONLY — NEVER a secret value. T-CONFIG-LEAK-1 mitigation.
//
// The tool description names the contract explicitly so the routing agent
// learns "this tool does NOT return env-var VALUES — only their presence
// as booleans." The handler enforces the same by construction: every
// surfaced field is structurally non-secret (booleans, counts, last-8-suffix,
// file paths, Node version, package version, persona slug).
//
// What this tool does NOT return:
//   - `ETHEREUM_RPC_URL` value (may contain an API key in the path)
//   - `WALLETCONNECT_PROJECT_ID` value (technically public per WC docs,
//     but defense-in-depth: surface only the boolean)
//   - The full WC session topic (only the last-8 suffix, mirroring the
//     PAIR-02 / get_ledger_status contract)
//   - The config file CONTENT (only its path + presence/malformed flags)

import { isAutoDemo, isDemoMode } from "../config/env.js";
import { getConfigPath, readConfigFile } from "../config/config-file.js";
import { getWalletConnectStorageMode } from "../config/wc-storage.js";
import { getActivePersona } from "../demo/state.js";
import { getStatus } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns a summary of vaultpilot-mcp's current configuration state — demo mode flag, env-var presence (as booleans), paired-account count, WC session-topic suffix (last 8 chars only), WC session persistence flag (boolean), config-file path + presence/malformed flags, Node version, package version, active persona slug, update-check suppression flag.",
  "Use this when debugging install configuration — 'why is demo mode active?', 'is my RPC URL set?', 'what version am I on?', 'which persona is active?', 'is my Ledger session persisted across restarts?'.",
  "Do NOT use this to retrieve the actual config values (RPC URL, WC project ID, full session topic) — those are NEVER returned by this tool. For RPC URL: read the `ETHEREUM_RPC_URL` env var directly via your shell. For WC project ID: same — `WALLETCONNECT_PROJECT_ID`.",
  "Returns `{ demoMode, isAutoDemo, activePersonaSlug, walletConnectProjectIdPresent, ethereumRpcUrlPresent, pairedAccountCount, wcSessionTopicSuffix, walletConnectStoragePersistent, configFilePath, configFileExists, configFileMalformed, nodeVersion, packageVersion, updateCheckSuppressed }`.",
  "Secret-safety: response contains only booleans, counts, suffixes, paths, and PUBLIC values (Node version, package version, persona slug, config file path). No secret values are returned — verifiable by the agent via JSON inspection.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

async function readPackageVersion(): Promise<string> {
  // Same pattern as `src/diagnostics/check.ts::readPackageVersion()` — the
  // dynamic-import-with-JSON-attribute keeps `tsc`'s `rootDir: "src"` happy
  // (a static `import pkg from "../../package.json" with { type: "json" }`
  // pulls package.json into the rootDir tree and breaks the build).
  try {
    const pkg = (await import("../../package.json", { with: { type: "json" } })) as {
      default: { version: string };
    };
    return pkg.default.version;
  } catch {
    return "0.0.0";
  }
}

async function readPackageName(): Promise<string> {
  try {
    const pkg = (await import("../../package.json", { with: { type: "json" } })) as {
      default: { name: string };
    };
    return pkg.default.name;
  } catch {
    return "vaultpilot-mcp";
  }
}

registerTool(
  "get_vaultpilot_config_status",
  DESCRIPTION,
  INPUT_SCHEMA,
  async () => {
    const demoMode = isDemoMode();
    const isAutoDemoArm = isAutoDemo();
    const activePersonaSlug = getActivePersona()?.slug ?? null;
    const walletConnectProjectIdPresent = Boolean(
      process.env.WALLETCONNECT_PROJECT_ID,
    );
    const ethereumRpcUrlPresent = Boolean(process.env.ETHEREUM_RPC_URL);

    const status = await getStatus();
    const pairedAccountCount = status === null ? 0 : 1;
    const wcSessionTopicSuffix = status === null ? null : status.sessionTopicLast8;
    const walletConnectStoragePersistent =
      getWalletConnectStorageMode() === "persist";

    // Q-CONFIG-LEAK lock: surface presence + malformed flags ONLY; the file
    // CONTENT (and the parse-error `cause` string, which may quote raw file
    // bytes) NEVER reaches the response.
    const configResult = readConfigFile();
    const configFilePath = getConfigPath();
    const configFileExists =
      configResult.ok || configResult.reason === "malformed";
    const configFileMalformed =
      !configResult.ok && configResult.reason === "malformed";

    const nodeVersion = process.versions.node;
    const packageVersion = await readPackageVersion();
    const packageName = await readPackageName();
    const updateCheckSuppressed =
      process.env.VAULTPILOT_DISABLE_UPDATE_CHECK === "1";

    const structured = {
      demoMode,
      isAutoDemo: isAutoDemoArm,
      activePersonaSlug,
      walletConnectProjectIdPresent,
      ethereumRpcUrlPresent,
      pairedAccountCount,
      wcSessionTopicSuffix,
      walletConnectStoragePersistent,
      configFilePath,
      configFileExists,
      configFileMalformed,
      nodeVersion,
      packageVersion,
      updateCheckSuppressed,
    };

    // Pretty-printed text block for human inspection. The structuredContent
    // is the machine-readable surface; this is the inline-renderable summary.
    const lines: string[] = [`vaultpilot-mcp ${packageName} v${packageVersion} — config status`];
    lines.push("");
    lines.push(`  demoMode:                        ${demoMode}`);
    lines.push(`  isAutoDemo:                      ${isAutoDemoArm}`);
    lines.push(`  activePersonaSlug:               ${activePersonaSlug ?? "(none)"}`);
    lines.push(`  walletConnectProjectIdPresent:   ${walletConnectProjectIdPresent}`);
    lines.push(`  ethereumRpcUrlPresent:           ${ethereumRpcUrlPresent}`);
    lines.push(`  pairedAccountCount:              ${pairedAccountCount}`);
    lines.push(`  wcSessionTopicSuffix:            ${wcSessionTopicSuffix ?? "(none)"}`);
    lines.push(`  walletConnectStoragePersistent:  ${walletConnectStoragePersistent}`);
    lines.push(`  configFilePath:                  ${configFilePath}`);
    lines.push(`  configFileExists:                ${configFileExists}`);
    lines.push(`  configFileMalformed:             ${configFileMalformed}`);
    lines.push(`  nodeVersion:                     ${nodeVersion}`);
    lines.push(`  packageVersion:                  ${packageVersion}`);
    lines.push(`  updateCheckSuppressed:           ${updateCheckSuppressed}`);

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: structured,
    };
  },
);
