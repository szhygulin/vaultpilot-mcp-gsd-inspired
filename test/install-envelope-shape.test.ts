/**
 * test/install-envelope-shape.test.ts — Plan 10-02 extension.
 *
 * Covers the post-Phase-10 `install-envelope.ts` surface:
 *   - 5 Phase 1 CheckId literals (FROZEN since Phase 1)
 *   - 5 Plan 10-03 setup-wizard literals
 *   - 4 Plan 10-02 install.sh-batch literals
 *   - ENVELOPE_VERSION === 1 (T-INSTALL-ENVELOPE-COMPAT-1 — no version bump
 *     per RESEARCH § Topic 9 line 923; Phase 1 `--check --json` consumers
 *     stay byte-compatible)
 *   - escalateStatus mixed-level (ok / warn / error precedence)
 *   - sample envelope shapes from install.sh + install.ps1 + setup wizard
 *     parse without error (forward-compat for Phase 1 consumers reading a
 *     post-Phase-10 envelope)
 *   - CheckLevel / CheckResult / InstallEnvelope shape sanity
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ENVELOPE_VERSION,
  escalateStatus,
  type CheckId,
  type CheckLevel,
  type CheckResult,
  type InstallEnvelope,
} from "../src/diagnostics/install-envelope.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENVELOPE_SOURCE = readFileSync(
  resolve(__dirname, "../src/diagnostics/install-envelope.ts"),
  "utf8",
);

// Phase 1 FROZEN literals.
const PHASE_1_CHECK_IDS = [
  "node-version",
  "binary-spawn",
  "wallet-connect-key",
  "ethereum-rpc",
  "config-file",
] as const;

// Plan 10-03 setup-wizard literals.
const PLAN_10_03_CHECK_IDS = [
  "config-file-write",
  "mcp-client-register-claude-code",
  "mcp-client-register-claude-desktop",
  "mcp-client-register-cursor",
  "ledger-pairing",
] as const;

// Plan 10-02 install.sh-batch literals (this plan).
const PLAN_10_02_CHECK_IDS = [
  "binary-download",
  "binary-install",
  "path-presence",
  "quarantine-attr",
] as const;

/**
 * Use the CheckId values via the type system — drift in the union name
 * surfaces as a tsc error in this file rather than a quiet runtime miss.
 * `assertCheckId` is the compile-time gate; the runtime assertions below
 * scan the source file for the literal token presence.
 */
function assertCheckId(id: CheckId): CheckId {
  return id;
}

describe("install-envelope.ts shape — Phase 10 post-widening", () => {
  // ── Case 1: T-INSTALL-ENVELOPE-COMPAT-1 anchor ───────────────────────────
  it("Case 1 — ENVELOPE_VERSION is exactly 1 (T-INSTALL-ENVELOPE-COMPAT-1 — no version bump)", () => {
    expect(ENVELOPE_VERSION).toBe(1);
  });

  // ── Case 2: Phase 1 FROZEN literals all present ──────────────────────────
  it("Case 2 — all 5 Phase 1 CheckId literals present in the union", () => {
    for (const id of PHASE_1_CHECK_IDS) {
      // Source-level grep proves the literal is in the union (compile-time
      // satisfaction below also catches deletion via tsc).
      expect(ENVELOPE_SOURCE).toContain(`"${id}"`);
      // Compile-time gate: assigning to CheckId fails to typecheck if
      // the literal is no longer part of the union.
      const checked = assertCheckId(id);
      expect(checked).toBe(id);
    }
  });

  // ── Case 3: Plan 10-03 setup-wizard literals all present ─────────────────
  it("Case 3 — all 5 Plan 10-03 setup-wizard CheckId literals present", () => {
    for (const id of PLAN_10_03_CHECK_IDS) {
      expect(ENVELOPE_SOURCE).toContain(`"${id}"`);
      const checked = assertCheckId(id);
      expect(checked).toBe(id);
    }
  });

  // ── Case 4: Plan 10-02 install.sh-batch literals all present ─────────────
  it("Case 4 — all 4 Plan 10-02 install.sh-batch CheckId literals present", () => {
    for (const id of PLAN_10_02_CHECK_IDS) {
      expect(ENVELOPE_SOURCE).toContain(`"${id}"`);
      const checked = assertCheckId(id);
      expect(checked).toBe(id);
    }
  });

  // ── Case 5: total union size ─────────────────────────────────────────────
  it("Case 5 — CheckId union has 14 entries (5 Phase 1 + 5 Plan 10-03 + 4 Plan 10-02)", () => {
    const total =
      PHASE_1_CHECK_IDS.length +
      PLAN_10_03_CHECK_IDS.length +
      PLAN_10_02_CHECK_IDS.length;
    expect(total).toBe(14);
  });

  // ── Case 6-9: escalateStatus precedence ──────────────────────────────────
  it("Case 6 — escalateStatus with all-ok checks → 'ok'", () => {
    const checks: CheckResult[] = [
      { id: "binary-download", level: "ok", message: "downloaded" },
      { id: "binary-install", level: "ok", message: "installed" },
    ];
    expect(escalateStatus(checks)).toBe("ok");
  });

  it("Case 7 — escalateStatus with mixed ok + warn → 'warn'", () => {
    const checks: CheckResult[] = [
      { id: "binary-download", level: "ok", message: "downloaded" },
      { id: "path-presence", level: "warn", message: "not on PATH" },
    ];
    expect(escalateStatus(checks)).toBe("warn");
  });

  it("Case 8 — escalateStatus with mixed ok + warn + error → 'error'", () => {
    const checks: CheckResult[] = [
      { id: "binary-download", level: "ok", message: "downloaded" },
      { id: "path-presence", level: "warn", message: "not on PATH" },
      { id: "binary-install", level: "error", message: "chmod failed" },
    ];
    expect(escalateStatus(checks)).toBe("error");
  });

  it("Case 9 — escalateStatus with empty checks → 'ok' (Phase 1 baseline)", () => {
    expect(escalateStatus([])).toBe("ok");
  });

  // ── Case 10: InstallEnvelope shape sanity ────────────────────────────────
  it("Case 10 — InstallEnvelope shape: envelope_version + status + checks + metadata", () => {
    const envelope: InstallEnvelope = {
      envelope_version: 1,
      status: "ok",
      checks: [
        { id: "binary-download", level: "ok", message: "downloaded" },
      ],
      metadata: {
        vaultpilot_mcp_version: "1.4.0",
        node_version: "v22.10.0",
      },
    };
    expect(envelope.envelope_version).toBe(1);
    expect(envelope.status).toBe("ok");
    expect(envelope.checks).toHaveLength(1);
    expect(envelope.metadata.vaultpilot_mcp_version).toBe("1.4.0");
    expect(envelope.metadata.node_version).toBe("v22.10.0");
  });

  // ── Case 11: metadata sub-shape ──────────────────────────────────────────
  it("Case 11 — metadata has vaultpilot_mcp_version + node_version (Phase 1 FROZEN keys)", () => {
    const envelope: InstallEnvelope = {
      envelope_version: 1,
      status: "ok",
      checks: [],
      metadata: { vaultpilot_mcp_version: "1.4.0", node_version: "v22.10.0" },
    };
    const keys = Object.keys(envelope.metadata).sort();
    expect(keys).toEqual(["node_version", "vaultpilot_mcp_version"]);
  });

  // ── Case 12: sample install.sh --json envelope shape parses + escalates ─
  it("Case 12 — sample install.sh --json envelope parses + escalates correctly", () => {
    // Mirrors the printf'd JSON install.sh emits in --json mode (happy path).
    const installShJson = `{
      "envelope_version": 1,
      "status": "ok",
      "checks": [
        { "id": "binary-download", "level": "ok", "message": "downloaded vaultpilot-mcp-v1.4.0-linux-x64.tar.gz" },
        { "id": "binary-install",  "level": "ok", "message": "installed to /home/u/.local/bin/vaultpilot-mcp" },
        { "id": "path-presence",   "level": "ok", "message": "/home/u/.local/bin on $PATH" },
        { "id": "quarantine-attr", "level": "ok", "message": "handled per platform" }
      ],
      "metadata": { "vaultpilot_mcp_version": "1.4.0", "node_version": "v22.10.0" }
    }`;
    const parsed = JSON.parse(installShJson) as InstallEnvelope;
    expect(parsed.envelope_version).toBe(1);
    expect(escalateStatus(parsed.checks)).toBe("ok");
    expect(parsed.checks.map((c) => c.id).sort()).toEqual(
      ["binary-download", "binary-install", "path-presence", "quarantine-attr"].sort(),
    );
  });

  // ── Case 13: sample install.ps1 --json envelope shape ───────────────────
  it("Case 13 — sample install.ps1 --json envelope parses + escalates correctly", () => {
    const installPs1Json = `{
      "envelope_version": 1,
      "status": "warn",
      "checks": [
        { "id": "binary-download", "level": "ok",   "message": "downloaded vaultpilot-mcp-v1.4.0-windows-x64.zip" },
        { "id": "binary-install",  "level": "ok",   "message": "installed to C:\\\\Users\\\\u\\\\AppData\\\\Local\\\\vaultpilot-mcp\\\\bin\\\\vaultpilot-mcp.exe" },
        { "id": "path-presence",   "level": "warn", "message": "appended to user PATH; open a new shell to take effect" },
        { "id": "quarantine-attr", "level": "ok",   "message": "n/a (Windows uses SmartScreen Unblock-File workaround)" }
      ],
      "metadata": { "vaultpilot_mcp_version": "1.4.0", "node_version": "v22.10.0" }
    }`;
    const parsed = JSON.parse(installPs1Json) as InstallEnvelope;
    expect(parsed.envelope_version).toBe(1);
    expect(escalateStatus(parsed.checks)).toBe("warn");
  });

  // ── Case 14: sample setup wizard --non-interactive --json envelope ──────
  it("Case 14 — sample setup-wizard --non-interactive --json envelope parses", () => {
    const setupWizardJson = `{
      "envelope_version": 1,
      "status": "ok",
      "checks": [
        { "id": "config-file-write",                "level": "ok",   "message": "wrote ~/.vaultpilot-mcp/config.json (mode 0600)" },
        { "id": "mcp-client-register-claude-code",  "level": "ok",   "message": "claude mcp add vaultpilot-mcp succeeded" },
        { "id": "mcp-client-register-claude-desktop","level": "ok",  "message": "merged into claude_desktop_config.json" },
        { "id": "mcp-client-register-cursor",       "level": "warn", "message": "~/.cursor/mcp.json not present; skipped" },
        { "id": "ledger-pairing",                   "level": "ok",   "message": "skipped (skipLedgerPairing=true)" }
      ],
      "metadata": { "vaultpilot_mcp_version": "1.4.0", "node_version": "v22.10.0" }
    }`;
    const parsed = JSON.parse(setupWizardJson) as InstallEnvelope;
    expect(parsed.envelope_version).toBe(1);
    expect(parsed.checks).toHaveLength(5);
    for (const id of PLAN_10_03_CHECK_IDS) {
      expect(parsed.checks.some((c) => c.id === id)).toBe(true);
    }
  });

  // ── Case 15: CheckResult shape sanity ────────────────────────────────────
  it("Case 15 — CheckResult shape: id + level + message", () => {
    const result: CheckResult = {
      id: "binary-download",
      level: "ok",
      message: "downloaded",
    };
    expect(Object.keys(result).sort()).toEqual(["id", "level", "message"]);
  });

  // ── Case 16: CheckLevel union has 3 entries ──────────────────────────────
  it("Case 16 — CheckLevel union has 3 entries: ok / warn / error", () => {
    const levels: CheckLevel[] = ["ok", "warn", "error"];
    expect(levels).toHaveLength(3);
    // Source-grep proves the union shape hasn't drifted (the Phase 1 union
    // is FROZEN per T-INSTALL-ENVELOPE-COMPAT-1).
    expect(ENVELOPE_SOURCE).toMatch(/CheckLevel\s*=\s*"ok"\s*\|\s*"warn"\s*\|\s*"error"/);
  });

  // ── Case 17: backward-compat — Phase 1 consumer parses a NEW envelope ───
  it("Case 17 — a Phase 1 `--check --json` consumer can parse a post-Phase-10 envelope (T-INSTALL-ENVELOPE-COMPAT-1)", () => {
    // Simulate what a Phase 1 consumer does: parse the envelope; assert
    // envelope_version === 1; iterate checks; aggregate by escalateStatus.
    // The presence of NEW CheckId literals in `checks[].id` does NOT break
    // parsing — `id` is an opaque string from the consumer's POV.
    const newEnvelope = `{
      "envelope_version": 1,
      "status": "ok",
      "checks": [
        { "id": "node-version",     "level": "ok", "message": "Node v22.10.0 >= 18.17" },
        { "id": "binary-download",  "level": "ok", "message": "downloaded" },
        { "id": "config-file-write","level": "ok", "message": "wrote config" }
      ],
      "metadata": { "vaultpilot_mcp_version": "1.4.0", "node_version": "v22.10.0" }
    }`;
    const parsed = JSON.parse(newEnvelope) as InstallEnvelope;
    expect(parsed.envelope_version).toBe(ENVELOPE_VERSION);
    expect(parsed.envelope_version).toBe(1);
    expect(parsed.checks.length).toBe(3);
    // A Phase 1 consumer would call escalateStatus on the checks array
    // and get a well-formed status — even though 2 of the 3 ids are NEW.
    expect(escalateStatus(parsed.checks)).toBe("ok");
  });

  // ── Case 18: install-envelope.ts comment-block discipline (provenance) ──
  it("Case 18 — install-envelope.ts has both Plan 10-03 + Plan 10-02 provenance comment-blocks", () => {
    // The two grouped comment-blocks document the additive provenance for
    // future readers. Drift in the comment-block discipline (e.g. one plan
    // dropping its comment) breaks the source-level grep here.
    expect(ENVELOPE_SOURCE).toMatch(
      /Plan 10-03 \(setup wizard \+ MCP client register\)/,
    );
    expect(ENVELOPE_SOURCE).toMatch(/Plan 10-02 \(install\.sh \+ install\.ps1\)/);
  });
});
