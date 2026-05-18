// src/cli/setup-mcp-clients.ts — Phase 10 / Plan 10-03 (DIST-42).
//
// Per-platform MCP-client detection + JSON merge for auto-registration
// during `vaultpilot-mcp setup`. Three clients are recognized:
//
//   - `claude-code`    — Claude Code CLI (registered via `claude mcp add`).
//   - `claude-desktop` — Claude Desktop (registered via JSON config merge).
//   - `cursor`         — Cursor IDE (registered via JSON config merge).
//
// Per-platform paths follow RESEARCH § Topic 6 lines 461-464 verbatim.
// Windows path resolution uses `process.env.APPDATA` (Roaming) — the
// canonical location for application-level config on Windows.
//
// JSON merge semantics (T-MCP-CLIENT-OVERWRITE-1 mitigation): every existing
// `mcpServers.*` key is preserved; only the `vaultpilot-mcp` entry is
// replaced. A pre-existing config file with malformed JSON is REFUSED
// (T-MALFORMED-MCP-CLIENT-CONFIG-1) — silent overwrite would destroy the
// user's other registered MCP servers.
//
// Windows binary-invocation wrap (Phase 1 INST-04 / RESEARCH § Topic 6 line
// 463): when `wrapForWindows: true`, the entry is `{ command: "cmd", args:
// ["/c", binaryPath] }`. Claude Desktop on Windows spawns `command` as a
// non-shell process; `cmd /c` is required for `.exe` resolution and
// quoted-path handling.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export type McpClientName = "claude-code" | "claude-desktop" | "cursor";

export interface DetectedClient {
  name: McpClientName;
  /**
   * Filesystem path of the client's config JSON.
   * `null` for `claude-code` — that client is CLI-managed via `claude mcp
   * add` and has no static JSON file to merge into.
   */
  configPath: string | null;
  detected: boolean;
}

/**
 * Spy-affordance indirection (per CLAUDE.md convention). Tests redirect
 * `commandExists` / `platform` / `homedir` via `vi.spyOn(_clientEnv, ...)`
 * to simulate macOS / linux / win32 paths and `claude` CLI presence
 * without touching the real OS state.
 */
export const _clientEnv = {
  platform,
  homedir,
  commandExists(cmd: string): boolean {
    try {
      execSync(`command -v ${cmd}`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  },
};

function claudeDesktopConfigPath(): string {
  const home = _clientEnv.homedir();
  const plat = _clientEnv.platform();
  if (plat === "darwin") {
    return join(
      home,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  if (plat === "win32") {
    const appdata = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appdata, "Claude", "claude_desktop_config.json");
  }
  return join(home, ".config", "Claude", "claude_desktop_config.json");
}

function cursorConfigPath(): string {
  return join(_clientEnv.homedir(), ".cursor", "mcp.json");
}

/**
 * Detect which MCP clients are installed on this host. Each entry carries
 * the canonical config path (or `null` for CLI-managed clients) and a
 * boolean `detected` flag. Callers offer detected clients to the user via
 * multiselect; undetected clients are still listed (greyed-out) so the
 * user can see what's recognized without scrolling docs.
 */
export function detectMcpClients(): DetectedClient[] {
  const claudeDesktopPath = claudeDesktopConfigPath();
  const cursorPath = cursorConfigPath();
  return [
    {
      name: "claude-code",
      configPath: null,
      detected: _clientEnv.commandExists("claude"),
    },
    {
      name: "claude-desktop",
      configPath: claudeDesktopPath,
      detected: existsSync(claudeDesktopPath),
    },
    {
      name: "cursor",
      configPath: cursorPath,
      detected: existsSync(cursorPath),
    },
  ];
}

/**
 * Returns the canonical config path for a given client without checking
 * whether the file exists. Lets the wizard show the path it WOULD write to
 * even when the client is not yet installed.
 */
export function getClientConfigPath(name: McpClientName): string | null {
  if (name === "claude-code") return null;
  if (name === "claude-desktop") return claudeDesktopConfigPath();
  return cursorConfigPath();
}

interface McpServerEntry {
  command: string;
  args?: string[];
}

interface ClientConfigShape {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

/**
 * Register `vaultpilot-mcp` with a JSON-config-based MCP client (Claude
 * Desktop or Cursor). Read-merge-write preserves every non-`vaultpilot-mcp`
 * key in `mcpServers` and every top-level non-`mcpServers` key in the file.
 *
 * Refuses on malformed pre-existing JSON (T-MALFORMED-MCP-CLIENT-CONFIG-1):
 * a silent overwrite would destroy the user's other MCP-server
 * registrations. The user must fix the file by hand, then re-run setup.
 *
 * Windows wrap: `wrapForWindows: true` ⇒ `{ command: "cmd", args: ["/c",
 * binaryPath] }`. Required by Claude Desktop on Windows per Phase 1 INST-04
 * + RESEARCH § Topic 6 line 463.
 */
export function registerWithJsonConfig(
  configPath: string,
  binaryPath: string,
  wrapForWindows: boolean,
): void {
  let existing: ClientConfigShape = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf8");
    try {
      existing = JSON.parse(raw) as ClientConfigShape;
    } catch {
      throw new Error(
        `Refused — ${configPath} is malformed JSON. Fix the file first, then re-run \`vaultpilot-mcp setup\`.`,
      );
    }
  }

  const serverEntry: McpServerEntry = wrapForWindows
    ? { command: "cmd", args: ["/c", binaryPath] }
    : { command: binaryPath };

  const merged: ClientConfigShape = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      "vaultpilot-mcp": serverEntry,
    },
  };

  writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n");
}

/**
 * Register `vaultpilot-mcp` with the Claude Code CLI. Idempotent — invokes
 * `claude mcp remove vaultpilot-mcp` best-effort first (so the subsequent
 * `add` doesn't fail with "already registered"), then `claude mcp add`.
 *
 * Throws if `claude` is not on PATH or `claude mcp add` exits non-zero
 * (the caller's wizard catches and surfaces a remediation message).
 */
export function registerWithClaudeCode(binaryPath: string): void {
  // best-effort remove — swallow exceptions (not-registered is the common
  // case on first install; we want `add` to succeed on a clean slate)
  try {
    execSync(`claude mcp remove vaultpilot-mcp`, { stdio: "ignore" });
  } catch {
    // ignore — not-registered is fine
  }
  execSync(`claude mcp add vaultpilot-mcp -- ${binaryPath}`, {
    stdio: "inherit",
  });
}
