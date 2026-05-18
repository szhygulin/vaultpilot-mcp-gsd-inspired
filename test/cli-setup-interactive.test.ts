// test/cli-setup-interactive.test.ts — Phase 10 / Plan 10-03 (DIST-42).
//
// Coverage for `src/cli/setup-prompts.ts` interactive wizard. The prompt
// library `@clack/prompts` is mocked via `vi.mock(...)` so each test
// scripts the responses for the 6 wizard steps and asserts the resulting
// payload / envelope shape. Ledger-pairing delegation per Assumption A4
// is exercised by registering a fake tool entry with the same handler
// signature that the real `pair_ledger_live_start` / `_wait` handlers
// expose.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { _paths } from "../src/config/config-file.js";
import { _resetRegistryForTesting, registerTool } from "../src/tools/index.js";

// ---------------------------------------------------------------------------
// vi.mock the @clack/prompts module surface. The mock returns a stateful
// script that consumes one response per `text` / `select` / `multiselect`
// / `confirm` call in the order they are invoked.
// ---------------------------------------------------------------------------

interface ScriptState {
  text: unknown[];
  select: unknown[];
  multiselect: unknown[];
  confirm: boolean[];
}

const script: ScriptState = {
  text: [],
  select: [],
  multiselect: [],
  confirm: [],
};

vi.mock("@clack/prompts", () => {
  return {
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    isCancel: (v: unknown) => v === Symbol.for("clack-cancel"),
    text: vi.fn(async () => {
      if (script.text.length === 0) return "";
      return script.text.shift();
    }),
    select: vi.fn(async () => {
      if (script.select.length === 0) return undefined;
      return script.select.shift();
    }),
    multiselect: vi.fn(async () => {
      if (script.multiselect.length === 0) return [];
      return script.multiselect.shift();
    }),
    confirm: vi.fn(async () => {
      if (script.confirm.length === 0) return true;
      return script.confirm.shift();
    }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function suppressStderr(): () => void {
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (() => true) as typeof process.stderr.write;
  return () => {
    process.stderr.write = original;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("setup-prompts — interactive wizard 6-step flow", () => {
  let tempDir: string;
  let cfgPath: string;
  let pathSpy: MockInstance;
  let captured: CapturedStdout;
  let restoreStderr: () => void;

  beforeEach(() => {
    // Reset the script between tests.
    script.text = [];
    script.select = [];
    script.multiselect = [];
    script.confirm = [];

    tempDir = mkdtempSync(join(tmpdir(), "vp-wizard-"));
    cfgPath = join(tempDir, "config.json");
    pathSpy = vi.spyOn(_paths, "getConfigPath").mockReturnValue(cfgPath);
    captured = captureStdout();
    restoreStderr = suppressStderr();

    _resetRegistryForTesting();
  });

  afterEach(() => {
    captured.restore();
    restoreStderr();
    pathSpy.mockRestore();
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("Test 1 — full happy-path: WC + Infura key + skip Ledger + skip Etherscan + skip register + confirm → writes config", async () => {
    // Step 1: WALLETCONNECT_PROJECT_ID
    script.text.push("wc-test-12345-abcdef");
    // Step 2a: select rpcProvider → infura
    script.select.push("infura");
    // Step 2b: rpcApiKey text
    script.text.push("rpc-api-key-12345");
    // Step 3: pair Ledger? → false (skip)
    script.confirm.push(false);
    // Step 4: Etherscan key → empty (skip)
    script.text.push("");
    // Step 5: multiselect register → []
    script.multiselect.push([]);
    // Step 6: confirm → true
    script.confirm.push(true);

    const { runInteractive } = await import("../src/cli/setup-prompts.js");
    const exit = await runInteractive({
      args: [],
      dryRun: false,
      jsonMode: true,
    });

    expect(exit).toBe(0);
    const envelope = JSON.parse(captured.text);
    expect(envelope.status).toMatch(/ok|warn/);
    expect(
      envelope.checks.some((c: { id: string }) => c.id === "config-file-write"),
    ).toBe(true);
  });

  it("Test 2 — Step 6 decline (confirm=false) → envelope status warn, NO writeConfigFile call", async () => {
    script.text.push(""); // wc empty
    script.select.push("publicnode"); // rpc
    script.confirm.push(false); // pair ledger? no
    script.text.push(""); // etherscan empty
    script.multiselect.push([]); // register []
    script.confirm.push(false); // decline at Step 6 → cancel

    const { runInteractive } = await import("../src/cli/setup-prompts.js");
    const exit = await runInteractive({
      args: [],
      dryRun: false,
      jsonMode: true,
    });

    // Decline path returns 0 (user-cancellation is not an error per
    // CheckResult.level semantics) and no config.json was written.
    expect(exit).toBe(0);
    let wrote = true;
    try {
      readFileSync(cfgPath, "utf8");
    } catch {
      wrote = false;
    }
    expect(wrote).toBe(false);

    const envelope = JSON.parse(captured.text);
    // The cancel branch emits a warn-level config-file-write check.
    expect(
      envelope.checks.some(
        (c: { id: string; level: string }) =>
          c.id === "config-file-write" && c.level === "warn",
      ),
    ).toBe(true);
  });

  it("Test 3 — Ledger pairing accepted: delegates to pair_ledger_live_start + _wait via tool registry (Assumption A4)", async () => {
    // Register fake handlers that match the real tool surface.
    const startSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "URI" }],
      structuredContent: {
        wcUri: "wc:abc...",
        pairingHandle: "handle-123",
      },
    }));
    const waitSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "VERIFY-ON-DEVICE: 0x..." }],
      structuredContent: {
        address: "0xabc",
        accounts: ["0xabc"],
        chainId: 1,
        sessionTopicLast8: "abcdef12",
      },
    }));
    registerTool(
      "pair_ledger_live_start",
      "Phase-1 of the two-phase Ledger pairing flow. Call this FIRST to obtain the WalletConnect URI that the user pastes into Ledger Live → Settings → WalletConnect → Connect.",
      { type: "object", properties: {}, additionalProperties: false },
      startSpy,
    );
    registerTool(
      "pair_ledger_live_wait",
      "Phase-2 of the two-phase Ledger pairing flow. Call this AFTER pair_ledger_live_start once the user has pasted the URI into Ledger Live and approved on-device.",
      {
        type: "object",
        properties: { pairingHandle: { type: "string" } },
        required: ["pairingHandle"],
        additionalProperties: false,
      },
      waitSpy,
    );

    script.text.push(""); // wc empty
    script.select.push("publicnode");
    script.confirm.push(true); // pair Ledger? yes
    script.text.push(""); // etherscan empty
    script.multiselect.push([]); // register []
    script.confirm.push(true); // Step 6 confirm yes

    const { runInteractive } = await import("../src/cli/setup-prompts.js");
    const exit = await runInteractive({
      args: [],
      dryRun: false,
      jsonMode: true,
    });

    expect(exit).toBe(0);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(waitSpy).toHaveBeenCalledTimes(1);
    // The handle returned by `start` is passed verbatim to `wait`.
    expect(waitSpy.mock.calls[0]![0]).toEqual({ pairingHandle: "handle-123" });

    const envelope = JSON.parse(captured.text);
    const ledger = envelope.checks.find(
      (c: { id: string }) => c.id === "ledger-pairing",
    );
    expect(ledger).toBeDefined();
    expect(ledger.level).toBe("ok");
  });

  it("Test 4 — Ledger pairing accepted but handlers absent → warn-level ledger-pairing check", async () => {
    // No tool registration. Registry stays empty.
    script.text.push(""); // wc empty
    script.select.push("publicnode");
    script.confirm.push(true); // pair Ledger? yes
    script.text.push(""); // etherscan empty
    script.multiselect.push([]); // register []
    script.confirm.push(true); // Step 6 yes

    const { runInteractive } = await import("../src/cli/setup-prompts.js");
    const exit = await runInteractive({
      args: [],
      dryRun: false,
      jsonMode: true,
    });

    expect(exit).toBe(0);
    const envelope = JSON.parse(captured.text);
    const ledger = envelope.checks.find(
      (c: { id: string }) => c.id === "ledger-pairing",
    );
    expect(ledger).toBeDefined();
    expect(ledger.level).toBe("warn");
    expect(ledger.message).toMatch(/not in registry/);
  });

  it("Test 5 — wizard --dry-run skips writeConfigFile AND ledger pairing", async () => {
    script.text.push(""); // wc empty
    script.select.push("publicnode");
    script.confirm.push(true); // pair Ledger? yes — but dry-run still skips
    script.text.push(""); // etherscan empty
    script.multiselect.push([]); // register []
    script.confirm.push(true); // Step 6 yes

    const { runInteractive } = await import("../src/cli/setup-prompts.js");
    const exit = await runInteractive({
      args: [],
      dryRun: true,
      jsonMode: true,
    });

    expect(exit).toBe(0);
    let wrote = true;
    try {
      readFileSync(cfgPath, "utf8");
    } catch {
      wrote = false;
    }
    expect(wrote).toBe(false);

    const envelope = JSON.parse(captured.text);
    const writeCheck = envelope.checks.find(
      (c: { id: string }) => c.id === "config-file-write",
    );
    expect(writeCheck.message.toLowerCase()).toContain("dry-run");
    const ledger = envelope.checks.find(
      (c: { id: string }) => c.id === "ledger-pairing",
    );
    expect(ledger.message.toLowerCase()).toContain("dry-run");
  });

  it("Test 6 — explicit RPC URL path: select=explicit + text=https://… → payload.rpcUrl set", async () => {
    script.text.push(""); // wc empty
    script.select.push("explicit");
    script.text.push("https://my-eth.example/v2/key"); // rpcUrl
    script.confirm.push(false); // skip Ledger
    script.text.push(""); // skip Etherscan
    script.multiselect.push([]); // skip register
    script.confirm.push(true); // Step 6 yes

    const { runInteractive } = await import("../src/cli/setup-prompts.js");
    const exit = await runInteractive({
      args: [],
      dryRun: false,
      jsonMode: true,
    });

    expect(exit).toBe(0);
    const onDisk = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(onDisk.rpcUrl).toBe("https://my-eth.example/v2/key");

    const envelope = JSON.parse(captured.text);
    // T-CONFIG-LEAK-1: the redacted payload never echoes the rpcUrl back.
    expect(envelope.payload.rpcUrl).toBe("***REDACTED***");
  });

  it("Test 7 — confirmation summary on stderr is REDACTED (T-CONFIG-LEAK-1 at the wizard surface)", async () => {
    // Re-route stderr so we can inspect what the wizard echoed at Step 6.
    const stderrChunks: string[] = [];
    const originalStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown): boolean => {
      stderrChunks.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write;
    // Also temporarily silence console.error (which used to be suppressed
    // globally by `suppressStderr` above) — re-route it to stderr so our
    // capture catches the wizard's Step-6 echo block.
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      const text = args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      stderrChunks.push(text + "\n");
    };

    try {
      const SENTINEL = "sentinel-wc-stderr-12345";
      script.text.push(SENTINEL); // WC id with sentinel
      script.select.push("publicnode");
      script.confirm.push(false); // skip Ledger
      script.text.push(""); // skip Etherscan
      script.multiselect.push([]); // skip register
      script.confirm.push(true); // Step 6 yes

      const { runInteractive } = await import("../src/cli/setup-prompts.js");
      const exit = await runInteractive({
        args: [],
        dryRun: true, // dry-run: don't persist the sentinel
        jsonMode: true,
      });

      expect(exit).toBe(0);
      const allStderr = stderrChunks.join("");
      // The Step 6 review block is REDACTED — the raw sentinel must not
      // appear in stderr, only the ***REDACTED*** placeholder.
      expect(allStderr).not.toContain(SENTINEL);
      expect(allStderr).toContain("***REDACTED***");
    } finally {
      process.stderr.write = originalStderr;
      console.error = originalConsoleError;
    }
  });
});
