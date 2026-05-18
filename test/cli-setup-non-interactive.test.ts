// test/cli-setup-non-interactive.test.ts — Phase 10 / Plan 10-03 (DIST-42).
//
// Coverage for `src/cli/setup-non-interactive.ts`. Key anchors:
//
//   - T-CONFIG-LEAK-1 3-sentinel substring scan (Case 5): feed payload
//     with three distinguishable sentinel values; capture stdout; assert
//     NONE appear anywhere in the JSON output. Mirror of Plan 05-03 +
//     Plan 08-01 sentinel-scan precedent.
//   - Zod validation rejection emits `status: error` envelope + exit 1.
//   - --dry-run skips the writeConfigFile() invocation; envelope still
//     emits with `level: ok` + message containing "would write" / "dry-run".
//   - `_paths.getConfigPath` spy round-trip — writeConfigFile lands at
//     the spied temp dir, never the real `~/.vaultpilot-mcp/`.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _io, runNonInteractive } from "../src/cli/setup-non-interactive.js";
import { _paths } from "../src/config/config-file.js";

interface CapturedStdout {
  readonly text: string;
  restore(): void;
}

function captureStdout(): CapturedStdout {
  let text = "";
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown): boolean => {
    text += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  }) as typeof process.stdout.write;
  return {
    get text() {
      return text;
    },
    restore: () => {
      process.stdout.write = original;
    },
  };
}

describe("setup-non-interactive — happy path + Zod validation", () => {
  let tempDir: string;
  let cfgPath: string;
  let pathSpy: ReturnType<typeof vi.spyOn>;
  let captured: CapturedStdout;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vp-noninter-"));
    cfgPath = join(tempDir, "config.json");
    pathSpy = vi.spyOn(_paths, "getConfigPath").mockReturnValue(cfgPath);
    captured = captureStdout();
  });

  afterEach(() => {
    captured.restore();
    pathSpy.mockRestore();
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("Test 1 — valid stdin JSON writes config + emits status:ok envelope", async () => {
    vi.spyOn(_io, "readStdin").mockResolvedValue(
      JSON.stringify({ rpcUrl: "https://eth.example/v2/key" }),
    );

    const exit = await runNonInteractive({
      args: [],
      dryRun: false,
      jsonMode: true,
    });

    expect(exit).toBe(0);
    const envelope = JSON.parse(captured.text);
    expect(envelope.status).toBe("ok");
    expect(envelope.checks.some((c: { id: string }) => c.id === "config-file-write")).toBe(true);
    const parsed = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(parsed.rpcUrl).toBe("https://eth.example/v2/key");
  });

  it("Test 2 — Zod rejects rpcUrl without https:// prefix → status:error + exit 1", async () => {
    vi.spyOn(_io, "readStdin").mockResolvedValue(
      JSON.stringify({ rpcUrl: "http://insecure.example/v2/key" }),
    );

    const exit = await runNonInteractive({
      args: [],
      dryRun: false,
      jsonMode: true,
    });

    expect(exit).toBe(1);
    const envelope = JSON.parse(captured.text);
    expect(envelope.status).toBe("error");
  });

  it("Test 3 — invalid JSON payload → status:error + exit 1", async () => {
    vi.spyOn(_io, "readStdin").mockResolvedValue("{ broken json");

    const exit = await runNonInteractive({
      args: [],
      dryRun: false,
      jsonMode: true,
    });

    expect(exit).toBe(1);
    const envelope = JSON.parse(captured.text);
    expect(envelope.status).toBe("error");
    expect(
      envelope.checks.some((c: { message: string }) =>
        c.message.includes("not valid JSON"),
      ),
    ).toBe(true);
  });

  it("Test 4 — --config <path> flag reads payload from file (not stdin)", async () => {
    const payloadPath = join(tempDir, "payload.json");
    writeFileSync(
      payloadPath,
      JSON.stringify({ rpcUrl: "https://from-file.example/v2/k" }),
    );
    const stdinSpy = vi.spyOn(_io, "readStdin").mockResolvedValue("UNUSED");

    const exit = await runNonInteractive({
      args: ["--config", payloadPath],
      dryRun: false,
      jsonMode: true,
    });

    expect(exit).toBe(0);
    expect(stdinSpy).not.toHaveBeenCalled();
    expect(readFileSync(cfgPath, "utf8")).toContain("from-file.example");
  });
});

describe("setup-non-interactive — T-CONFIG-LEAK-1 3-sentinel substring scan", () => {
  let tempDir: string;
  let cfgPath: string;
  let pathSpy: ReturnType<typeof vi.spyOn>;
  let captured: CapturedStdout;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vp-leak-"));
    cfgPath = join(tempDir, "config.json");
    pathSpy = vi.spyOn(_paths, "getConfigPath").mockReturnValue(cfgPath);
    captured = captureStdout();
  });

  afterEach(() => {
    captured.restore();
    pathSpy.mockRestore();
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // The CRITICAL anchor of this plan. Mirror of Plan 05-03 + Plan 08-01
  // precedent. Three distinguishable sentinel values seeded into the
  // payload; captured stdout MUST NOT contain any of them.
  it("Test 5 — NONE of the three sentinel secrets appear in stdout JSON", async () => {
    const SENTINEL_WC = "sentinel-WC-12345-do-not-leak";
    const SENTINEL_RPC_KEY = "sentinel-RPC-ABCDE-do-not-leak";
    const SENTINEL_ES = "SENTINELETHERSCAN12345ABCDE";

    vi.spyOn(_io, "readStdin").mockResolvedValue(
      JSON.stringify({
        walletConnectProjectId: SENTINEL_WC,
        rpcUrl: `https://eth-mainnet.example/v2/${SENTINEL_RPC_KEY}`,
        etherscanApiKey: SENTINEL_ES,
      }),
    );

    const exit = await runNonInteractive({
      args: [],
      dryRun: true, // dry-run to avoid persisting the sentinels to disk
      jsonMode: true,
    });

    expect(exit).toBe(0);
    // 3-sentinel substring scan over the raw stdout bytes:
    expect(captured.text).not.toContain(SENTINEL_WC);
    expect(captured.text).not.toContain(SENTINEL_RPC_KEY);
    expect(captured.text).not.toContain(SENTINEL_ES);
    // And confirm the redacted literal is present (positive proof the
    // redaction path actually ran rather than just dropping the fields).
    expect(captured.text).toContain("***REDACTED***");
  });

  it("Test 6 — secrets DO get written to config.json on a real (non-dry-run) write", async () => {
    // Negative control: confirm the redaction only protects stdout, NOT
    // the on-disk write (the disk file is where the secrets belong).
    const SENTINEL_RPC_PATH = "sentinel-on-disk-RPC-12345";
    vi.spyOn(_io, "readStdin").mockResolvedValue(
      JSON.stringify({
        rpcUrl: `https://eth.example/v2/${SENTINEL_RPC_PATH}`,
      }),
    );

    const exit = await runNonInteractive({
      args: [],
      dryRun: false,
      jsonMode: true,
    });

    expect(exit).toBe(0);
    // On-disk: secret present (intended).
    expect(readFileSync(cfgPath, "utf8")).toContain(SENTINEL_RPC_PATH);
    // Stdout: secret absent (T-CONFIG-LEAK-1).
    expect(captured.text).not.toContain(SENTINEL_RPC_PATH);
  });
});

describe("setup-non-interactive — --dry-run + MCP client check emission", () => {
  let tempDir: string;
  let cfgPath: string;
  let pathSpy: ReturnType<typeof vi.spyOn>;
  let captured: CapturedStdout;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vp-dry-"));
    cfgPath = join(tempDir, "config.json");
    pathSpy = vi.spyOn(_paths, "getConfigPath").mockReturnValue(cfgPath);
    captured = captureStdout();
  });

  afterEach(() => {
    captured.restore();
    pathSpy.mockRestore();
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("Test 7 — --dry-run SKIPS the on-disk writeConfigFile invocation", async () => {
    vi.spyOn(_io, "readStdin").mockResolvedValue(
      JSON.stringify({ rpcUrl: "https://eth.example/v2/dry" }),
    );

    const exit = await runNonInteractive({
      args: [],
      dryRun: true,
      jsonMode: true,
    });

    expect(exit).toBe(0);
    // No file written to the spied path.
    let threw = false;
    try {
      readFileSync(cfgPath, "utf8");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const envelope = JSON.parse(captured.text);
    const writeCheck = envelope.checks.find(
      (c: { id: string }) => c.id === "config-file-write",
    );
    expect(writeCheck.level).toBe("ok");
    expect(writeCheck.message.toLowerCase()).toContain("would write");
  });

  it("Test 8 — registerWith emits per-client checks in --dry-run mode", async () => {
    vi.spyOn(_io, "readStdin").mockResolvedValue(
      JSON.stringify({
        registerWith: ["claude-code", "claude-desktop", "cursor"],
      }),
    );

    const exit = await runNonInteractive({
      args: [],
      dryRun: true,
      jsonMode: true,
    });

    expect(exit).toBe(0);
    const envelope = JSON.parse(captured.text);
    const ids = envelope.checks.map((c: { id: string }) => c.id);
    expect(ids).toContain("mcp-client-register-claude-code");
    expect(ids).toContain("mcp-client-register-claude-desktop");
    expect(ids).toContain("mcp-client-register-cursor");
  });

  it("Test 9 — skipLedgerPairing default → ledger-pairing check emits at level:ok", async () => {
    vi.spyOn(_io, "readStdin").mockResolvedValue(JSON.stringify({}));

    const exit = await runNonInteractive({
      args: [],
      dryRun: true,
      jsonMode: true,
    });

    expect(exit).toBe(0);
    const envelope = JSON.parse(captured.text);
    const ledger = envelope.checks.find(
      (c: { id: string }) => c.id === "ledger-pairing",
    );
    expect(ledger).toBeDefined();
    expect(ledger.level).toBe("ok");
    expect(ledger.message.toLowerCase()).toContain("skipped");
  });

  it("Test 10 — envelope shape: envelope_version + status + checks + payload + metadata", async () => {
    vi.spyOn(_io, "readStdin").mockResolvedValue(JSON.stringify({}));

    const exit = await runNonInteractive({
      args: [],
      dryRun: true,
      jsonMode: true,
    });

    expect(exit).toBe(0);
    const envelope = JSON.parse(captured.text);
    expect(envelope.envelope_version).toBe(1);
    expect(envelope.status).toMatch(/ok|warn|error/);
    expect(Array.isArray(envelope.checks)).toBe(true);
    expect(envelope.metadata.node_version).toBe(process.versions.node);
    expect(envelope.payload).toBeDefined();
  });
});

describe("setup-non-interactive — _paths spy round-trip", () => {
  it("Test 11 — writeConfigFile lands at _paths.getConfigPath spy target", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "vp-roundtrip-"));
    const cfgPath = join(tempDir, "config.json");
    const pathSpy = vi.spyOn(_paths, "getConfigPath").mockReturnValue(cfgPath);
    const captured = captureStdout();
    try {
      vi.spyOn(_io, "readStdin").mockResolvedValue(
        JSON.stringify({ rpcUrl: "https://eth.example/v2/rt" }),
      );

      await runNonInteractive({ args: [], dryRun: false, jsonMode: true });

      expect(readFileSync(cfgPath, "utf8")).toContain("https://eth.example");
      expect(pathSpy).toHaveBeenCalled();
    } finally {
      captured.restore();
      pathSpy.mockRestore();
      vi.restoreAllMocks();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
