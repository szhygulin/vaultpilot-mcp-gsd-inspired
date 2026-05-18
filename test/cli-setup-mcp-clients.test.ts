// test/cli-setup-mcp-clients.test.ts — Phase 10 / Plan 10-03 (DIST-42).
//
// Coverage for the per-platform MCP-client detection + JSON-merge helpers
// in `src/cli/setup-mcp-clients.ts`. The Windows-wrap branch is exercised
// without actually running on Windows by toggling the `wrapForWindows`
// arg directly (the function takes it as a parameter so callers can probe
// either branch deterministically).

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _clientEnv,
  detectMcpClients,
  getClientConfigPath,
  registerWithJsonConfig,
} from "../src/cli/setup-mcp-clients.js";

describe("setup-mcp-clients — detectMcpClients per-platform paths", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "vp-mcp-clients-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("Test 1 — darwin → macOS Application Support path", () => {
    vi.spyOn(_clientEnv, "platform").mockReturnValue("darwin");
    vi.spyOn(_clientEnv, "homedir").mockReturnValue(tempHome);
    vi.spyOn(_clientEnv, "commandExists").mockReturnValue(false);

    const detected = detectMcpClients();
    const desktop = detected.find((d) => d.name === "claude-desktop")!;
    expect(desktop.configPath).toBe(
      join(
        tempHome,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      ),
    );
  });

  it("Test 2 — linux → XDG ~/.config path", () => {
    vi.spyOn(_clientEnv, "platform").mockReturnValue("linux");
    vi.spyOn(_clientEnv, "homedir").mockReturnValue(tempHome);
    vi.spyOn(_clientEnv, "commandExists").mockReturnValue(false);

    const detected = detectMcpClients();
    const desktop = detected.find((d) => d.name === "claude-desktop")!;
    expect(desktop.configPath).toBe(
      join(tempHome, ".config", "Claude", "claude_desktop_config.json"),
    );
  });

  it("Test 3 — win32 → APPDATA path", () => {
    const savedAppdata = process.env.APPDATA;
    process.env.APPDATA = "C:\\Users\\Test\\AppData\\Roaming";
    try {
      vi.spyOn(_clientEnv, "platform").mockReturnValue("win32");
      vi.spyOn(_clientEnv, "homedir").mockReturnValue(tempHome);
      vi.spyOn(_clientEnv, "commandExists").mockReturnValue(false);

      const detected = detectMcpClients();
      const desktop = detected.find((d) => d.name === "claude-desktop")!;
      expect(desktop.configPath).toContain("Claude");
      expect(desktop.configPath).toContain("claude_desktop_config.json");
    } finally {
      if (savedAppdata === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = savedAppdata;
    }
  });

  it("Test 4 — claude-code detected via commandExists('claude')", () => {
    vi.spyOn(_clientEnv, "platform").mockReturnValue("linux");
    vi.spyOn(_clientEnv, "homedir").mockReturnValue(tempHome);
    const cmdSpy = vi.spyOn(_clientEnv, "commandExists").mockReturnValue(true);

    const detected = detectMcpClients();
    expect(detected.find((d) => d.name === "claude-code")?.detected).toBe(true);
    expect(cmdSpy).toHaveBeenCalledWith("claude");
  });

  it("Test 5 — claude-code not detected when commandExists returns false", () => {
    vi.spyOn(_clientEnv, "platform").mockReturnValue("linux");
    vi.spyOn(_clientEnv, "homedir").mockReturnValue(tempHome);
    vi.spyOn(_clientEnv, "commandExists").mockReturnValue(false);

    const detected = detectMcpClients();
    expect(detected.find((d) => d.name === "claude-code")?.detected).toBe(
      false,
    );
  });

  it("Test 6 — getClientConfigPath returns null for claude-code only", () => {
    vi.spyOn(_clientEnv, "platform").mockReturnValue("linux");
    vi.spyOn(_clientEnv, "homedir").mockReturnValue(tempHome);

    expect(getClientConfigPath("claude-code")).toBeNull();
    expect(getClientConfigPath("claude-desktop")).not.toBeNull();
    expect(getClientConfigPath("cursor")).not.toBeNull();
  });
});

describe("setup-mcp-clients — registerWithJsonConfig merge semantics", () => {
  let tempDir: string;
  let cfgPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vp-mcp-merge-"));
    cfgPath = join(tempDir, "claude_desktop_config.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("Test 7 — happy path: writes new mcpServers.vaultpilot-mcp to empty file", () => {
    // No existing file — registerWithJsonConfig creates it from scratch.
    registerWithJsonConfig(cfgPath, "/usr/local/bin/vaultpilot-mcp", false);
    const merged = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(merged.mcpServers["vaultpilot-mcp"]).toEqual({
      command: "/usr/local/bin/vaultpilot-mcp",
    });
  });

  it("Test 8 — preserves existing mcpServers.other-server entry (T-MCP-CLIENT-OVERWRITE-1)", () => {
    writeFileSync(
      cfgPath,
      JSON.stringify({
        mcpServers: {
          "other-server": { command: "/opt/other", args: ["--flag"] },
        },
      }),
    );

    registerWithJsonConfig(cfgPath, "/usr/local/bin/vaultpilot-mcp", false);

    const merged = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(merged.mcpServers["other-server"]).toEqual({
      command: "/opt/other",
      args: ["--flag"],
    });
    expect(merged.mcpServers["vaultpilot-mcp"]).toEqual({
      command: "/usr/local/bin/vaultpilot-mcp",
    });
  });

  it("Test 9 — preserves top-level non-mcpServers keys", () => {
    writeFileSync(
      cfgPath,
      JSON.stringify({
        ui: { theme: "dark" },
        mcpServers: {},
      }),
    );

    registerWithJsonConfig(cfgPath, "/bin/vaultpilot-mcp", false);

    const merged = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(merged.ui).toEqual({ theme: "dark" });
    expect(merged.mcpServers["vaultpilot-mcp"]).toBeDefined();
  });

  it("Test 10 — REFUSES on malformed pre-existing JSON (T-MALFORMED-MCP-CLIENT-CONFIG-1)", () => {
    writeFileSync(cfgPath, "{ this is not json");
    expect(() =>
      registerWithJsonConfig(cfgPath, "/bin/vaultpilot-mcp", false),
    ).toThrow(/malformed JSON/);
    // The malformed file MUST stay untouched — silent overwrite would have
    // destroyed the user's other registrations.
    expect(readFileSync(cfgPath, "utf8")).toBe("{ this is not json");
  });

  it("Test 11 — Windows wrap: { command: 'cmd', args: ['/c', binaryPath] }", () => {
    registerWithJsonConfig(cfgPath, "C:\\Path\\vaultpilot-mcp.exe", true);
    const merged = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(merged.mcpServers["vaultpilot-mcp"]).toEqual({
      command: "cmd",
      args: ["/c", "C:\\Path\\vaultpilot-mcp.exe"],
    });
  });

  it("Test 12 — POSIX shape: { command: binaryPath } (no args)", () => {
    registerWithJsonConfig(cfgPath, "/usr/local/bin/vaultpilot-mcp", false);
    const merged = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(merged.mcpServers["vaultpilot-mcp"]).toEqual({
      command: "/usr/local/bin/vaultpilot-mcp",
    });
    expect(merged.mcpServers["vaultpilot-mcp"].args).toBeUndefined();
  });

  it("Test 13 — idempotent re-register (no duplicate keys; latest call wins)", () => {
    registerWithJsonConfig(cfgPath, "/old/path", false);
    registerWithJsonConfig(cfgPath, "/new/path", false);
    const merged = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(merged.mcpServers["vaultpilot-mcp"]).toEqual({
      command: "/new/path",
    });
    // Exactly one entry — JSON object keys can't duplicate, but assert it
    // anyway to lock the merge semantics.
    expect(Object.keys(merged.mcpServers)).toEqual(["vaultpilot-mcp"]);
  });

  it("Test 14 — creates the file when the parent directory exists but the file does not", () => {
    // parent dir already created by mkdtempSync; file does not exist
    registerWithJsonConfig(cfgPath, "/bin/vaultpilot-mcp", false);
    expect(readFileSync(cfgPath, "utf8")).toContain("vaultpilot-mcp");
  });

  it("Test 15 — output JSON has 2-space indent and trailing newline", () => {
    registerWithJsonConfig(cfgPath, "/bin/vaultpilot-mcp", false);
    const raw = readFileSync(cfgPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "mcpServers"');
  });
});

describe("setup-mcp-clients — getClientConfigPath stability", () => {
  it("Test 16 — same homedir + platform yields stable path across calls", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vp-mcp-stability-"));
    try {
      vi.spyOn(_clientEnv, "platform").mockReturnValue("darwin");
      vi.spyOn(_clientEnv, "homedir").mockReturnValue(tempDir);

      const path1 = getClientConfigPath("claude-desktop");
      const path2 = getClientConfigPath("claude-desktop");
      expect(path1).toBe(path2);
    } finally {
      vi.restoreAllMocks();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// Sanity: subdirectory creation. registerWithJsonConfig itself does NOT
// `mkdir -p` (callers are expected to point at an already-existing parent).
// Document this contract via a dedicated test so a future refactor that
// adds mkdir-p doesn't break it without a conscious decision.
describe("setup-mcp-clients — registerWithJsonConfig parent-dir contract", () => {
  it("Test 17 — throws when parent directory does not exist (caller responsibility)", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vp-mcp-noparent-"));
    const cfgPath = join(tempDir, "nope", "claude_desktop_config.json");
    try {
      expect(() =>
        registerWithJsonConfig(cfgPath, "/bin/vaultpilot-mcp", false),
      ).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("Test 18 — caller mkdir -p + register flows together (integration-light)", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vp-mcp-mkdir-"));
    const cfgDir = join(tempDir, "Claude");
    mkdirSync(cfgDir, { recursive: true });
    const cfgPath = join(cfgDir, "claude_desktop_config.json");

    try {
      registerWithJsonConfig(cfgPath, "/bin/vaultpilot-mcp", false);
      const merged = JSON.parse(readFileSync(cfgPath, "utf8"));
      expect(merged.mcpServers["vaultpilot-mcp"].command).toBe(
        "/bin/vaultpilot-mcp",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
