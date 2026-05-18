// src/cli/setup-prompts.ts — Phase 10 / Plan 10-03 (DIST-42).
//
// Interactive `vaultpilot-mcp setup` wizard. Uses `@clack/prompts@^1.4.0`
// (DF-2 LOCKED per RESEARCH § DF-2 — ESM-first, 0 native deps, clean
// multi-step API). Six steps per RESEARCH § Topic 7:
//
//   1. WALLETCONNECT_PROJECT_ID         text() — skip via empty input
//   2. RPC provider                     select() + conditional text()
//   3. (Optional) Ledger pairing        confirm() — delegated to existing
//                                       pair_ledger_live_start + _wait
//                                       tool handlers (Assumption A4 —
//                                       NO duplicated pairing logic)
//   4. ETHERSCAN_API_KEY                text() — skip via empty input
//   5. MCP client registration          multiselect() over detectMcpClients
//   6. Confirm with REDACTED summary    confirm() — secret values NEVER
//                                       displayed even at confirmation
//
// Both interactive and non-interactive paths share `SetupPayloadSchema`
// (T-WIZARD-SCHEMA-SOT-1 invariant). The wizard collects values into a
// `SetupPayload` shape, validates the assembled payload through the same
// Zod schema as the non-interactive path, then dispatches to the same
// write + register helpers.
//
// Stdout / stderr discipline: `@clack/prompts` writes interactively to
// stderr by default; the final envelope JSON (in `--json` mode) goes to
// stdout — per CLAUDE.md `Stderr for diagnostics, stdout for MCP
// protocol`.

import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  outro,
  select,
  text,
} from "@clack/prompts";

import { readConfigFile, writeConfigFile } from "../config/config-file.js";
import type { ConfigFile } from "../config/config-file.js";
import {
  ENVELOPE_VERSION,
  type CheckResult,
  type InstallEnvelope,
  escalateStatus,
} from "../diagnostics/install-envelope.js";
import { getRegisteredTool } from "../tools/index.js";

import {
  SetupPayloadSchema,
  type SetupPayload,
  redactForEnvelope,
} from "./setup-schema.js";
import {
  detectMcpClients,
  getClientConfigPath,
  registerWithClaudeCode,
  registerWithJsonConfig,
  type DetectedClient,
  type McpClientName,
} from "./setup-mcp-clients.js";

export interface InteractiveOptions {
  args: string[];
  dryRun: boolean;
  jsonMode: boolean;
}

const REDACTED_DISPLAY = "***REDACTED***";

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function shouldWrapForWindows(): boolean {
  return process.platform === "win32";
}

function resolveBinaryPath(): string {
  return process.execPath.endsWith("node") ? "vaultpilot-mcp" : process.execPath;
}

/**
 * Spy-affordance — tests mock `@clack/prompts` via `vi.mock(...)`; this
 * indirection layer lets us redirect side-effecting helpers (env-var
 * reads, package-version) without re-mocking the whole module each test.
 */
export const _wizardEnv = {
  readPackageVersion: async (): Promise<string> => {
    try {
      const pkg = (await import("../../package.json", {
        with: { type: "json" },
      })) as { default: { version: string } };
      return pkg.default.version;
    } catch {
      return "0.0.0";
    }
  },
};

function pushAndWarnCancel(checks: CheckResult[]): boolean {
  // `@clack/prompts` returns a Symbol(cancel) when the user hits Ctrl-C.
  // Treat cancel as "abandon wizard, exit 130 (SIGINT-style)".
  checks.push({
    id: "config-file-write",
    level: "warn",
    message: "user cancelled wizard",
  });
  return true;
}

async function runWizardSteps(
  detected: DetectedClient[],
): Promise<SetupPayload | "cancelled"> {
  const payload: SetupPayload = {};

  // ── Step 1: WALLETCONNECT_PROJECT_ID ──
  const wcId = await text({
    message: "WalletConnect Project ID (leave empty to skip)",
    placeholder: "e.g. a1b2c3d4e5f6…",
  });
  if (isCancel(wcId)) return "cancelled";
  if (typeof wcId === "string" && wcId.trim().length > 0) {
    payload.walletConnectProjectId = wcId.trim();
  }

  // ── Step 2: RPC provider ──
  const rpcProvider = await select<SetupPayload["rpcProvider"]>({
    message: "RPC provider",
    options: [
      { value: "publicnode", label: "PublicNode (default — no key needed)" },
      { value: "infura", label: "Infura (single key — covers all 5 chains)" },
      { value: "alchemy", label: "Alchemy (single key — covers all 5 chains)" },
      { value: "explicit", label: "Per-chain explicit RPC URL" },
    ],
  });
  if (isCancel(rpcProvider)) return "cancelled";
  payload.rpcProvider = rpcProvider as SetupPayload["rpcProvider"];

  if (rpcProvider === "infura" || rpcProvider === "alchemy") {
    const key = await text({
      message: `${rpcProvider} API key`,
      placeholder: "(paste key)",
    });
    if (isCancel(key)) return "cancelled";
    if (typeof key === "string" && key.trim().length > 0) {
      payload.rpcApiKey = key.trim();
    }
  } else if (rpcProvider === "explicit") {
    const url = await text({
      message: "Ethereum RPC URL (https://)",
      placeholder: "https://eth-mainnet.example/v2/…",
    });
    if (isCancel(url)) return "cancelled";
    if (typeof url === "string" && url.trim().length > 0) {
      payload.rpcUrl = url.trim();
    }
  }

  // ── Step 3: Optional Ledger pairing ──
  const pairNow = await confirm({
    message: "Pair your Ledger via WalletConnect now?",
    initialValue: true,
  });
  if (isCancel(pairNow)) return "cancelled";
  payload.skipLedgerPairing = !pairNow;

  // ── Step 4: ETHERSCAN_API_KEY ──
  const esKey = await text({
    message: "Etherscan Multichain V2 API key (leave empty to skip)",
    placeholder: "e.g. ABCD1234… (uppercase hex)",
  });
  if (isCancel(esKey)) return "cancelled";
  if (typeof esKey === "string" && esKey.trim().length > 0) {
    payload.etherscanApiKey = esKey.trim();
  }

  // ── Step 5: MCP client registration ──
  const options = detected.map((d) => ({
    value: d.name,
    label: `${d.name}${d.detected ? "" : " (not detected on PATH)"}`,
    hint: d.configPath ?? "CLI-managed",
  }));
  const chosen = await multiselect<McpClientName>({
    message: "Auto-register vaultpilot-mcp with which MCP clients?",
    options,
    required: false,
  });
  if (isCancel(chosen)) return "cancelled";
  if (Array.isArray(chosen) && chosen.length > 0) {
    payload.registerWith = chosen as McpClientName[];
  }

  // ── Step 6: Confirm with REDACTED summary ──
  const summary = redactForEnvelope(payload);
  // eslint-disable-next-line no-console
  console.error(
    `\nReview (secrets redacted):\n${JSON.stringify(summary, null, 2)}\n`,
  );

  const proceed = await confirm({
    message: "Proceed with this configuration?",
    initialValue: true,
  });
  if (isCancel(proceed)) return "cancelled";
  if (!proceed) return "cancelled";

  return payload;
}

/**
 * Invoke the existing `pair_ledger_live_start` + `pair_ledger_live_wait`
 * tool handlers from the registered MCP tool registry. Per Assumption A4
 * the wizard does NOT duplicate pairing logic. If the handlers aren't
 * registered (server-import side-effects haven't been triggered yet), the
 * wizard surfaces a clean degraded-mode warning.
 */
async function attemptLedgerPairing(checks: CheckResult[]): Promise<void> {
  const start = getRegisteredTool("pair_ledger_live_start");
  const wait = getRegisteredTool("pair_ledger_live_wait");
  if (!start || !wait) {
    checks.push({
      id: "ledger-pairing",
      level: "warn",
      message:
        "pair_ledger_live_* handlers not in registry — wizard cannot drive pairing",
    });
    return;
  }
  try {
    const startResult = await start.handler({});
    const sc = startResult.structuredContent ?? {};
    const wcUri = typeof sc.wcUri === "string" ? sc.wcUri : "";
    const pairingHandle =
      typeof sc.pairingHandle === "string" ? sc.pairingHandle : "";
    if (wcUri && pairingHandle) {
      // eslint-disable-next-line no-console
      console.error(
        `\nPaste this WalletConnect URI into Ledger Live → Settings → WalletConnect → Connect:\n\n${wcUri}\n`,
      );
      const waitResult = await wait.handler({ pairingHandle });
      const isError = waitResult.isError === true;
      checks.push({
        id: "ledger-pairing",
        level: isError ? "error" : "ok",
        message: isError
          ? "Ledger pairing failed — see error block on stderr"
          : "Ledger paired",
      });
    } else {
      checks.push({
        id: "ledger-pairing",
        level: "warn",
        message:
          "pair_ledger_live_start returned empty URI — likely a cached session; run get_ledger_status",
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({
      id: "ledger-pairing",
      level: "error",
      message: `pair_ledger_live_start threw: ${msg}`,
    });
  }
}

export async function runInteractive(
  opts: InteractiveOptions,
): Promise<number> {
  const dryRun = opts.dryRun || hasFlag(opts.args, "--dry-run");

  intro("vaultpilot-mcp setup");

  const detected = detectMcpClients();
  const wizardResult = await runWizardSteps(detected);

  if (wizardResult === "cancelled") {
    const checks: CheckResult[] = [];
    pushAndWarnCancel(checks);
    cancel("setup cancelled");
    const envelope = await buildEnvelope(checks, {}, opts);
    emit(envelope, opts);
    return envelope.status === "error" ? 1 : 0;
  }

  // Validate the assembled payload through the SAME Zod schema as the
  // non-interactive path (T-WIZARD-SCHEMA-SOT-1 invariant). This catches
  // any wizard bug that produces an invalid shape.
  const parseResult = SetupPayloadSchema.safeParse(wizardResult);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    const envelope = await buildEnvelope(
      [
        {
          id: "config-file-write",
          level: "error",
          message: `wizard produced invalid payload: ${issues}`,
        },
      ],
      wizardResult,
      opts,
    );
    cancel("payload validation failed");
    emit(envelope, opts);
    return 1;
  }

  const payload = parseResult.data;
  const checks: CheckResult[] = [];

  // ── writeConfigFile ──
  const existingResult = readConfigFile();
  const existing: ConfigFile = existingResult.ok ? existingResult.parsed : {};
  const merged: ConfigFile = { ...existing };
  if (payload.rpcUrl !== undefined) merged.rpcUrl = payload.rpcUrl;

  if (dryRun) {
    checks.push({
      id: "config-file-write",
      level: "ok",
      message: "would write ~/.vaultpilot-mcp/config.json (dry-run)",
    });
  } else {
    try {
      await writeConfigFile(merged);
      checks.push({
        id: "config-file-write",
        level: "ok",
        message: "wrote ~/.vaultpilot-mcp/config.json",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({
        id: "config-file-write",
        level: "error",
        message: `failed to write config.json: ${msg}`,
      });
    }
  }

  // ── Step 3 follow-through: Ledger pairing delegation ──
  if (!payload.skipLedgerPairing && !dryRun) {
    await attemptLedgerPairing(checks);
  } else {
    checks.push({
      id: "ledger-pairing",
      level: "ok",
      message: dryRun
        ? "skipped (dry-run)"
        : "skipped (user opted out at Step 3)",
    });
  }

  // ── MCP client registration ──
  if (payload.registerWith && payload.registerWith.length > 0) {
    const binaryPath = resolveBinaryPath();
    const wrapForWindows = shouldWrapForWindows();
    for (const name of payload.registerWith) {
      const id = `mcp-client-register-${name}` as const;
      if (dryRun) {
        checks.push({
          id,
          level: "ok",
          message: `would register vaultpilot-mcp with ${name}`,
        });
        continue;
      }
      try {
        if (name === "claude-code") {
          const entry = detected.find((d) => d.name === "claude-code");
          if (!entry || !entry.detected) {
            throw new Error(
              "claude CLI not on PATH — install Claude Code CLI first",
            );
          }
          registerWithClaudeCode(binaryPath);
        } else {
          const cfgPath = getClientConfigPath(name);
          if (cfgPath === null) {
            throw new Error(`no config path for client: ${name}`);
          }
          registerWithJsonConfig(cfgPath, binaryPath, wrapForWindows);
        }
        checks.push({
          id,
          level: "ok",
          message: `registered vaultpilot-mcp with ${name}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        checks.push({ id, level: "error", message: msg });
      }
    }
  }

  outro(`done — status: ${escalateStatus(checks)}`);

  const envelope = await buildEnvelope(checks, payload, opts);
  emit(envelope, opts);
  return envelope.status === "error" ? 1 : 0;
}

async function buildEnvelope(
  checks: CheckResult[],
  payload: SetupPayload,
  _opts: InteractiveOptions,
): Promise<InstallEnvelope & { payload: SetupPayload }> {
  return {
    envelope_version: ENVELOPE_VERSION,
    status: escalateStatus(checks),
    checks,
    payload: redactForEnvelope(payload),
    metadata: {
      vaultpilot_mcp_version: await _wizardEnv.readPackageVersion(),
      node_version: process.versions.node,
    },
  };
}

function emit(envelope: unknown, opts: InteractiveOptions): void {
  if (opts.jsonMode) {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
  }
  // human-mode output already streamed via intro/outro/cancel; nothing else
  // to write here. Keep `REDACTED_DISPLAY` referenced for future use to
  // appease the unused-import / unused-const checker:
  void REDACTED_DISPLAY;
}
