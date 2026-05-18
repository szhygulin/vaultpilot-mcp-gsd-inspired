// src/cli/setup-non-interactive.ts — Phase 10 / Plan 10-03 (DIST-42).
//
// `vaultpilot-mcp setup --non-interactive` path. Reads a JSON payload from
// either stdin (default) or `--config <path>`, validates against the SOT
// `SetupPayloadSchema` from `setup-schema.ts`, merges into the existing
// `~/.vaultpilot-mcp/config.json` (via Phase 5's FROZEN `readConfigFile()`)
// and writes back via the ADDITIVE `writeConfigFile()`. Optionally
// registers `vaultpilot-mcp` with detected MCP clients via the helpers in
// `setup-mcp-clients.ts`.
//
// Output discipline:
//   - **stdout:** the InstallEnvelope JSON, with every secret-bearing
//     field replaced by `***REDACTED***` via `redactForEnvelope()`
//     (T-CONFIG-LEAK-1).
//   - **stderr:** diagnostic messages (per CLAUDE.md `Stderr for
//     diagnostics, stdout for MCP protocol`).
//
// `--dry-run` skips both `writeConfigFile()` and the MCP-client register
// invocations; the envelope still emits but with `would_write` and
// `would_register_with` keys so the caller can preview the effect.

import { readFileSync } from "node:fs";

import { readConfigFile, writeConfigFile } from "../config/config-file.js";
import type { ConfigFile } from "../config/config-file.js";
import {
  ENVELOPE_VERSION,
  type CheckResult,
  type InstallEnvelope,
  escalateStatus,
} from "../diagnostics/install-envelope.js";

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
  type McpClientName,
} from "./setup-mcp-clients.js";

export interface NonInteractiveOptions {
  args: string[];
  dryRun: boolean;
  jsonMode: boolean;
}

/**
 * Spy-affordance — tests redirect stdin / process-exit-relevant pieces via
 * `vi.spyOn(_io, …)`. The default `readStdin()` slurps the full stdin
 * payload synchronously (the wizard caller passes a small JSON blob — we
 * never expect more than a few KB).
 */
export const _io = {
  async readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  },
  readFile(path: string): string {
    return readFileSync(path, "utf8");
  },
  writeStdout(text: string): void {
    process.stdout.write(text);
  },
  writeStderr(text: string): void {
    process.stderr.write(text);
  },
};

function parseConfigFlag(args: string[]): string | null {
  const idx = args.indexOf("--config");
  if (idx === -1) return null;
  const value = args[idx + 1];
  return typeof value === "string" ? value : null;
}

function mergePayloadIntoConfig(
  existing: ConfigFile,
  payload: SetupPayload,
): ConfigFile {
  // Only fields the public ConfigFile shape understands flow back to disk.
  // Other payload fields (`registerWith`, `skipLedgerPairing`,
  // `rpcProvider`, `rpcApiKey`, `walletConnectProjectId`,
  // `etherscanApiKey`) drive side-effects (env vars / MCP-client
  // registration) but are NOT persisted to config.json in v1.4 — the
  // existing Phase 5 schema only carries `demo` and `rpcUrl`.
  const merged: ConfigFile = { ...existing };
  if (payload.rpcUrl !== undefined) {
    merged.rpcUrl = payload.rpcUrl;
  }
  return merged;
}

function shouldWrapForWindows(): boolean {
  return process.platform === "win32";
}

function resolveBinaryPath(): string {
  // Prefer the spawning binary path (`argv[0]`) when invoked from the
  // installed `vaultpilot-mcp` CLI; fall back to "vaultpilot-mcp" so the
  // shell-PATH resolver wins when invoked via `npx`/`pnpm dlx`/etc.
  return process.execPath.endsWith("node") ? "vaultpilot-mcp" : process.execPath;
}

function registerCheckFromError(
  name: McpClientName,
  err: unknown,
): CheckResult {
  const id = `mcp-client-register-${name}` as const;
  const message = err instanceof Error ? err.message : String(err);
  return { id, level: "error", message };
}

function registerOkCheck(name: McpClientName, dryRun: boolean): CheckResult {
  const id = `mcp-client-register-${name}` as const;
  return {
    id,
    level: "ok",
    message: dryRun
      ? `would register vaultpilot-mcp with ${name}`
      : `registered vaultpilot-mcp with ${name}`,
  };
}

/**
 * Entry point. Returns the process exit code (0 / 1).
 *
 * On Zod parse failure: emits `status: "error"` envelope, returns 1.
 * On unknown stdin read failure: emits `status: "error"` envelope,
 * returns 1.
 * On success: emits envelope (with secrets redacted), returns 0.
 */
export async function runNonInteractive(
  opts: NonInteractiveOptions,
): Promise<number> {
  let raw: string;
  const configPath = parseConfigFlag(opts.args);
  try {
    raw =
      configPath !== null
        ? _io.readFile(configPath)
        : await _io.readStdin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const envelope = buildErrorEnvelope(
      `failed to read payload: ${message}`,
    );
    emitEnvelope(envelope, opts);
    return 1;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const envelope = buildErrorEnvelope(`payload is not valid JSON: ${message}`);
    emitEnvelope(envelope, opts);
    return 1;
  }

  const parseResult = SetupPayloadSchema.safeParse(parsedJson);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    const envelope = buildErrorEnvelope(`payload validation failed: ${issues}`);
    emitEnvelope(envelope, opts);
    return 1;
  }
  const payload = parseResult.data;

  const checks: CheckResult[] = [];

  // ── writeConfigFile (or dry-run preview) ──
  const existingResult = readConfigFile();
  const existing: ConfigFile =
    existingResult.ok ? existingResult.parsed : {};
  const merged = mergePayloadIntoConfig(existing, payload);

  if (opts.dryRun) {
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
      const message = err instanceof Error ? err.message : String(err);
      checks.push({
        id: "config-file-write",
        level: "error",
        message: `failed to write config.json: ${message}`,
      });
    }
  }

  // ── MCP client registration ──
  if (payload.registerWith && payload.registerWith.length > 0) {
    const detected = detectMcpClients();
    const binaryPath = resolveBinaryPath();
    const wrapForWindows = shouldWrapForWindows();
    for (const name of payload.registerWith) {
      if (opts.dryRun) {
        checks.push(registerOkCheck(name, true));
        continue;
      }
      try {
        if (name === "claude-code") {
          // Only attempt the shell-out when the CLI was detected; otherwise
          // surface a clean error rather than letting `execSync` throw.
          const entry = detected.find((d) => d.name === "claude-code");
          if (!entry || !entry.detected) {
            throw new Error(
              "claude CLI not on PATH — install Claude Code CLI first",
            );
          }
          registerWithClaudeCode(binaryPath);
        } else {
          const configPathForClient = getClientConfigPath(name);
          if (configPathForClient === null) {
            // Unreachable — every non-claude-code client has a path. Defensive.
            throw new Error(`no config path for client: ${name}`);
          }
          registerWithJsonConfig(
            configPathForClient,
            binaryPath,
            wrapForWindows,
          );
        }
        checks.push(registerOkCheck(name, false));
      } catch (err) {
        checks.push(registerCheckFromError(name, err));
      }
    }
  }

  // ── Ledger pairing — non-interactive path SKIPS automated pairing. ──
  // Pairing requires the user to physically approve on-device, which the
  // non-interactive path cannot orchestrate. The check is informational
  // only: it tells the caller pairing was skipped.
  if (payload.skipLedgerPairing !== false) {
    checks.push({
      id: "ledger-pairing",
      level: "ok",
      message: "skipped (non-interactive path)",
    });
  }

  const envelope: InstallEnvelope & {
    payload: SetupPayload;
    metadata: { vaultpilot_mcp_version: string; node_version: string };
  } = {
    envelope_version: ENVELOPE_VERSION,
    status: escalateStatus(checks),
    checks,
    payload: redactForEnvelope(payload),
    metadata: {
      vaultpilot_mcp_version: await readPackageVersion(),
      node_version: process.versions.node,
    },
  };

  emitEnvelope(envelope, opts);
  return envelope.status === "error" ? 1 : 0;
}

function buildErrorEnvelope(message: string): InstallEnvelope {
  return {
    envelope_version: ENVELOPE_VERSION,
    status: "error",
    checks: [
      {
        id: "config-file-write",
        level: "error",
        message,
      },
    ],
    metadata: {
      vaultpilot_mcp_version: "0.0.0",
      node_version: process.versions.node,
    },
  };
}

function emitEnvelope(envelope: unknown, opts: NonInteractiveOptions): void {
  if (opts.jsonMode) {
    _io.writeStdout(`${JSON.stringify(envelope)}\n`);
  } else {
    // Human-readable text for terminal users who pipe without `--json`.
    const env = envelope as InstallEnvelope;
    const lines: string[] = [];
    lines.push(`vaultpilot-mcp setup — status: ${env.status}`);
    for (const c of env.checks) {
      lines.push(`  [${c.level}] ${c.id}: ${c.message}`);
    }
    _io.writeStdout(`${lines.join("\n")}\n`);
  }
}

async function readPackageVersion(): Promise<string> {
  try {
    const pkg = (await import("../../package.json", {
      with: { type: "json" },
    })) as { default: { version: string } };
    return pkg.default.version;
  } catch {
    return "0.0.0";
  }
}
