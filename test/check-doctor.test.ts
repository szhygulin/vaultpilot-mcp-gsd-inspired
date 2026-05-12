import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCheck } from "../src/diagnostics/check.js";
import {
  ENVELOPE_VERSION,
  type InstallEnvelope,
} from "../src/diagnostics/install-envelope.js";

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

function makeTempHome(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "vp-mcp-check-"));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const ENV_KEYS = [
  "WALLETCONNECT_PROJECT_ID",
  "ETHEREUM_RPC_URL",
  "HOME",
  "USERPROFILE",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
  delete process.env.WALLETCONNECT_PROJECT_ID;
  delete process.env.ETHEREUM_RPC_URL;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("runCheck — JSON output", () => {
  it("warn outcome: bare environment, no env vars, no config file", async () => {
    const home = makeTempHome();
    const cap = captureStdout();
    let exitCode: number;
    try {
      exitCode = await runCheck({ json: true });
    } finally {
      cap.restore();
      home.cleanup();
    }

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(cap.text) as InstallEnvelope;
    expect(envelope.envelope_version).toBe(ENVELOPE_VERSION);
    expect(envelope.status).toBe("warn");
    expect(envelope.metadata.node_version).toBe(process.versions.node);
    expect(typeof envelope.metadata.vaultpilot_mcp_version).toBe("string");

    const ids = envelope.checks.map((c) => c.id);
    expect(ids).toEqual([
      "node-version",
      "binary-spawn",
      "wallet-connect-key",
      "ethereum-rpc",
      "config-file",
    ]);

    const byId = Object.fromEntries(envelope.checks.map((c) => [c.id, c]));
    expect(byId["node-version"]?.level).toBe("ok");
    expect(byId["binary-spawn"]?.level).toBe("ok");
    expect(byId["wallet-connect-key"]?.level).toBe("warn");
    expect(byId["wallet-connect-key"]?.message).toMatch(/Phase 3\+/);
    expect(byId["ethereum-rpc"]?.level).toBe("warn");
    expect(byId["ethereum-rpc"]?.message).toMatch(/PublicNode/);
    expect(byId["config-file"]?.level).toBe("ok");
    expect(byId["config-file"]?.message).toMatch(/absent.*auto-demo/);
  });

  it("ok outcome: all env vars set, valid config file present", async () => {
    process.env.WALLETCONNECT_PROJECT_ID = "fake";
    process.env.ETHEREUM_RPC_URL = "https://eth.publicnode.com";
    const home = makeTempHome();
    mkdirSync(join(home.dir, ".vaultpilot-mcp"), { recursive: true });
    writeFileSync(
      join(home.dir, ".vaultpilot-mcp", "config.json"),
      JSON.stringify({ chains: {} }),
      "utf8",
    );

    const cap = captureStdout();
    let exitCode: number;
    try {
      exitCode = await runCheck({ json: true });
    } finally {
      cap.restore();
      home.cleanup();
    }

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(cap.text) as InstallEnvelope;
    expect(envelope.status).toBe("ok");
    expect(envelope.checks.every((c) => c.level === "ok")).toBe(true);
  });

  it("warn outcome (escalated): malformed config file present", async () => {
    const home = makeTempHome();
    mkdirSync(join(home.dir, ".vaultpilot-mcp"), { recursive: true });
    writeFileSync(
      join(home.dir, ".vaultpilot-mcp", "config.json"),
      "{ this is not json",
      "utf8",
    );

    const cap = captureStdout();
    let exitCode: number;
    try {
      exitCode = await runCheck({ json: true });
    } finally {
      cap.restore();
      home.cleanup();
    }

    expect(exitCode).toBe(0);
    const envelope = JSON.parse(cap.text) as InstallEnvelope;
    expect(envelope.status).toBe("warn");
    const configCheck = envelope.checks.find((c) => c.id === "config-file");
    expect(configCheck?.level).toBe("warn");
    expect(configCheck?.message).toMatch(/malformed/);
  });

  it("error outcome: simulated old node version escalates to exit 1", async () => {
    const home = makeTempHome();
    process.env.WALLETCONNECT_PROJECT_ID = "fake";
    process.env.ETHEREUM_RPC_URL = "https://eth.publicnode.com";

    const originalNode = process.versions.node;
    Object.defineProperty(process.versions, "node", {
      value: "16.0.0",
      configurable: true,
    });

    const cap = captureStdout();
    let exitCode: number;
    try {
      exitCode = await runCheck({ json: true });
    } finally {
      Object.defineProperty(process.versions, "node", {
        value: originalNode,
        configurable: true,
      });
      cap.restore();
      home.cleanup();
    }

    expect(exitCode).toBe(1);
    const envelope = JSON.parse(cap.text) as InstallEnvelope;
    expect(envelope.status).toBe("error");
    const nodeCheck = envelope.checks.find((c) => c.id === "node-version");
    expect(nodeCheck?.level).toBe("error");
    expect(nodeCheck?.message).toMatch(/16\.0\.0/);
  });
});

describe("runCheck — human output", () => {
  it("emits header, glyph-prefixed check lines, and status footer", async () => {
    const home = makeTempHome();
    const cap = captureStdout();
    let exitCode: number;
    try {
      exitCode = await runCheck({ json: false });
    } finally {
      cap.restore();
      home.cleanup();
    }

    expect(exitCode).toBe(0);
    expect(cap.text).toMatch(/vaultpilot-mcp .* install check/);
    expect(cap.text).toMatch(/✓ node-version/);
    expect(cap.text).toMatch(/✓ binary-spawn/);
    expect(cap.text).toMatch(/⚠ wallet-connect-key/);
    expect(cap.text).toMatch(/⚠ ethereum-rpc/);
    expect(cap.text).toMatch(/✓ config-file/);
    expect(cap.text).toMatch(/Status:\s+warn/);
  });
});
