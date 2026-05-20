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

import {
  isAutoDemo,
  isDemoMode,
  getRpcProvider,
  getSolanaRpcUrl,
} from "../config/env.js";
import { getConfigPath, readConfigFile } from "../config/config-file.js";
import { getNonEvmStorageMode } from "../config/non-evm-storage.js";
import { getWalletConnectStorageMode } from "../config/wc-storage.js";
import { _registry } from "../chains/registry.js";
import { getActivePersona } from "../demo/state.js";
import {
  _skillIntegrity,
  type SkillIntegrityState,
} from "../security/skill-integrity.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { getStatus } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";

// Phase 9 / Plan 09-02 (SEC-31): diagnostic surface for the companion-skill
// SHA-256 integrity state. Secret-safe — surfaces `kind` + `path` (on found
// arms) + `sha256` (on the ok arm) only. Never surfaces `computed` /
// `expected` on the tampered arm (those bytes are internal-only diagnostic;
// the user sees them via the `VAULTPILOT NOTICE` dispatcher-wrap block at
// dispatch time, not via this tool). Never surfaces `pathsProbed` on the
// missing arm (keeps the diagnostic compact; user runs `ls ~/.claude/skills/`
// to diagnose paths).
type SkillIntegritySummary =
  | { kind: "ok"; path: string; sha256: string }
  | { kind: "missing" }
  | { kind: "tampered"; path: string };

function summarizeSkillIntegrity(
  state: SkillIntegrityState,
): SkillIntegritySummary {
  if (state.kind === "ok") {
    return { kind: "ok", path: state.path, sha256: state.sha256 };
  }
  if (state.kind === "missing") {
    return { kind: "missing" };
  }
  return { kind: "tampered", path: state.path };
}

const DESCRIPTION = [
  "Returns a summary of vaultpilot-mcp's current configuration state — demo mode flag, env-var presence (as booleans), paired-account count, WC session-topic suffix (last 8 chars only), WC session persistence flag (boolean), config-file path + presence/malformed flags, Node version, package version, active persona slug, update-check suppression flag, companion-skill integrity state.",
  "Use this when debugging install configuration — 'why is demo mode active?', 'is my RPC URL set?', 'what version am I on?', 'which persona is active?', 'is my Ledger session persisted across restarts?', 'is the vaultpilot-preflight companion skill installed and intact?'.",
  "Do NOT use this to retrieve the actual config values (RPC URL, WC project ID, full session topic) — those are NEVER returned by this tool. For RPC URL: read the `ETHEREUM_RPC_URL` env var directly via your shell. For WC project ID: same — `WALLETCONNECT_PROJECT_ID`.",
  "Returns `{ demoMode, isAutoDemo, activePersonaSlug, walletConnectProjectIdPresent, ethereumRpcUrlPresent, etherscanApiKeyPresent, rpcProvider, configuredChains, solanaRpcConfigured, pairedAccountCount, pairedNonEvmChains, pairedNonEvmAccountCount, nonEvmStoragePersistent, wcSessionTopicSuffix, walletConnectStoragePersistent, configFilePath, configFileExists, configFileMalformed, nodeVersion, packageVersion, updateCheckSuppressed, skillIntegrity }`. `rpcProvider` is the verbatim shorthand name (`infura` / `alchemy`) or null when `RPC_PROVIDER` is unset — the API key VALUE is NEVER surfaced. `configuredChains` is a per-chain map (`ethereum / arbitrum / polygon / base / optimism`) of booleans reflecting whether a chain-specific override OR the shorthand resolves a URL (false ⇒ PublicNode fallback for that chain). `solanaRpcConfigured` is true ONLY when `SOLANA_RPC_URL` is explicitly set; the public-RPC fallback does NOT count as configured (mirrors Phase 8 `configuredChains` boolean semantics). `pairedNonEvmChains` is the sorted unique list of non-EVM chains with at least one paired account (chain names only, NEVER raw addresses). `pairedNonEvmAccountCount` is the total record count across all non-EVM chains. `nonEvmStoragePersistent` reflects `VAULTPILOT_NON_EVM_STORAGE`. `skillIntegrity` is a discriminated union: `{ kind: 'ok', path, sha256 }` when the companion `vaultpilot-preflight` skill SHA-256 matches the MCP-pinned value; `{ kind: 'missing' }` when the skill is not installed at any probe path; `{ kind: 'tampered', path }` when the SHA differs (the actual computed vs expected hex is surfaced via the `VAULTPILOT NOTICE` dispatcher block, never via this tool — secret-safe).",
  "Secret-safety: response contains only booleans, counts, suffixes, paths, and PUBLIC values (Node version, package version, persona slug, config file path, skill-integrity kind/path). No secret values are returned — verifiable by the agent via JSON inspection.",
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
    // Plan 07-04 — Q-CONFIG-LEAK extension. Boolean ONLY; the key value
    // NEVER appears in the response (asserted by Test 14 in
    // test/get-vaultpilot-config-status.test.ts).
    const etherscanApiKeyPresent = Boolean(process.env.ETHERSCAN_API_KEY);

    // Plan 08-01 — multi-chain diagnostic surface. The provider NAME is
    // PUBLIC (it's just `infura` / `alchemy`); the API key VALUE is the
    // secret material and is NEVER surfaced (Q-CONFIG-LEAK extends —
    // asserted by the T-RPC-API-KEY-LEAK-1 3-sentinel scan).
    // `configuredChains` reflects per-chain RPC resolution: true ⇒ EITHER
    // chain-specific env var OR a recognized RPC_PROVIDER + RPC_API_KEY
    // pair resolves a URL; false ⇒ PublicNode fallback would fire.
    const rpcProvider = getRpcProvider() ?? null;
    const configuredChains = {
      ethereum: _registry.hasRpcConfiguredForChain(1),
      arbitrum: _registry.hasRpcConfiguredForChain(42161),
      polygon: _registry.hasRpcConfiguredForChain(137),
      base: _registry.hasRpcConfiguredForChain(8453),
      optimism: _registry.hasRpcConfiguredForChain(10),
    };

    const status = await getStatus();
    const pairedAccountCount = status === null ? 0 : 1;
    const wcSessionTopicSuffix = status === null ? null : status.sessionTopicLast8;
    const walletConnectStoragePersistent =
      getWalletConnectStorageMode() === "persist";

    // Plan 11-04 (PAIR-NEV-07 + ROADMAP Success Criterion #13). Non-EVM
    // diagnostic surface: chain names + counts + booleans only. The store
    // values themselves (raw base58 addresses, derivation paths) NEVER
    // surface here — the per-chain status tool (`get_solana_status`) and
    // the cross-chain list (`list_paired_non_evm_accounts`) are the
    // surfaces for that detail, each with its own scrub discipline.
    //
    // `solanaRpcConfigured` mirrors Phase 8 `configuredChains` semantics:
    // TRUE iff the env URL is explicitly set; the public-RPC fallback
    // (`https://api.mainnet-beta.solana.com`) does NOT count as
    // configured. Lets operators distinguish "running on production-
    // managed RPC" from "running on the rate-limited public fallback" at
    // a glance.
    const nonEvmRecords = listAccounts();
    const pairedNonEvmChains = [
      ...new Set(nonEvmRecords.map((r) => r.chain)),
    ].sort();
    const pairedNonEvmAccountCount = nonEvmRecords.length;
    const nonEvmStoragePersistent = getNonEvmStorageMode() === "persist";
    const solanaRpcConfigured = getSolanaRpcUrl() !== null;

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

    // Phase 9 / Plan 09-02 (SEC-31). Lazy-memoized SHA-256 probe — the FIRST
    // call (across the whole process) does the IO; subsequent calls return
    // the cached state at near-zero cost. The dispatcher-wrap in
    // `src/server.ts` is the typical first caller; this tool calling the
    // probe is harmless (memoization absorbs the duplicate call).
    const skillIntegrityState = await _skillIntegrity.checkSkillIntegrity();
    const skillIntegrity = summarizeSkillIntegrity(skillIntegrityState);

    const structured = {
      demoMode,
      isAutoDemo: isAutoDemoArm,
      activePersonaSlug,
      walletConnectProjectIdPresent,
      ethereumRpcUrlPresent,
      etherscanApiKeyPresent,
      rpcProvider,
      configuredChains,
      solanaRpcConfigured,
      pairedAccountCount,
      pairedNonEvmChains,
      pairedNonEvmAccountCount,
      nonEvmStoragePersistent,
      wcSessionTopicSuffix,
      walletConnectStoragePersistent,
      configFilePath,
      configFileExists,
      configFileMalformed,
      nodeVersion,
      packageVersion,
      updateCheckSuppressed,
      skillIntegrity,
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
    lines.push(`  etherscanApiKeyPresent:          ${etherscanApiKeyPresent}`);
    lines.push(`  rpcProvider:                     ${rpcProvider ?? "(none)"}`);
    lines.push(
      `  configuredChains:                ethereum=${configuredChains.ethereum} arbitrum=${configuredChains.arbitrum} polygon=${configuredChains.polygon} base=${configuredChains.base} optimism=${configuredChains.optimism}`,
    );
    lines.push(`  solanaRpcConfigured:             ${solanaRpcConfigured}`);
    lines.push(`  pairedAccountCount:              ${pairedAccountCount}`);
    lines.push(
      `  pairedNonEvmChains:              [${pairedNonEvmChains.join(", ")}]`,
    );
    lines.push(`  pairedNonEvmAccountCount:        ${pairedNonEvmAccountCount}`);
    lines.push(`  nonEvmStoragePersistent:         ${nonEvmStoragePersistent}`);
    lines.push(`  wcSessionTopicSuffix:            ${wcSessionTopicSuffix ?? "(none)"}`);
    lines.push(`  walletConnectStoragePersistent:  ${walletConnectStoragePersistent}`);
    lines.push(`  configFilePath:                  ${configFilePath}`);
    lines.push(`  configFileExists:                ${configFileExists}`);
    lines.push(`  configFileMalformed:             ${configFileMalformed}`);
    lines.push(`  nodeVersion:                     ${nodeVersion}`);
    lines.push(`  packageVersion:                  ${packageVersion}`);
    lines.push(`  updateCheckSuppressed:           ${updateCheckSuppressed}`);
    // Phase 9 / Plan 09-02 (SEC-31). Text-block line surfaces `kind` only —
    // the `path` + `sha256` (on the ok arm) are in `structuredContent` for
    // programmatic inspection; the text block stays compact.
    lines.push(`  skillIntegrity:                  ${skillIntegrity.kind}`);

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: structured,
    };
  },
);
