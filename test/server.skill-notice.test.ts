// Plan 09-02 — server dispatcher wrap tests for the companion-skill SHA-256
// NOTICE prepend (SEC-31).
//
// Six end-to-end tests via `spawnServerInProcess`. The wrap composes the
// auto-demo NOTICE block (Plan 05-03) + the skill-integrity NOTICE block
// (Plan 09-02) at the SDK boundary; ordering is LOCKED — auto-demo first,
// skill second (PATTERNS.md § 2 line 200). A session triggering both emits
// auto-demo on dispatch #1 and skill on dispatch #2 (each is single-emission;
// the auto-demo wrap returns before the skill wrap on dispatch #1).
//
// Tests:
//   1. Server boot does NOT call `checkSkillIntegrity` (lazy, not boot-time)
//   2. Missing skill — first dispatch prepends NOTICE; second does NOT
//      (T-NOTICE-DEDUP-1 + T-SKILL-MISSING-1)
//   3. Tampered skill — first dispatch prepends NOTICE; second does NOT
//      (T-SKILL-TAMPER-1)
//   4. OK skill — no NOTICE prepended on any dispatch
//   5. Ordering with auto-demo NOTICE — dispatch #1 emits ONLY auto-demo,
//      dispatch #2 emits ONLY skill (each consumed once)
//   6. _resetSkillIntegrityForTesting + _resetAutoDemoNoticeForTesting clean
//      slate between cases — verify state-machine reset

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import { _resetAutoDemoNoticeForTesting } from "../src/diagnostics/notice.js";
import { _resetUpdateCheckForTesting } from "../src/diagnostics/update-check.js";
import {
  EXPECTED_SKILL_SHA256,
  _skillIntegrity,
  _resetSkillIntegrityForTesting,
  type SkillIntegrityState,
} from "../src/security/skill-integrity.js";

import {
  mockConfigFile,
  type MockConfigFile,
} from "./helpers/mock-config-file.js";
import { spawnServerInProcess, type SpawnedServer } from "./helpers/spawn-server.js";

// Ensure all tools registered so callTool routes succeed.
await import("../src/tools/register-all.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
const SUPPRESS_KEY = "VAULTPILOT_DISABLE_UPDATE_CHECK";

let savedDemo: string | undefined;
let savedSuppress: string | undefined;
let mock: MockConfigFile | undefined;
let spawned: SpawnedServer | undefined;

beforeEach(() => {
  savedDemo = process.env[DEMO_KEY];
  savedSuppress = process.env[SUPPRESS_KEY];
  // Pin away auto-demo by default (explicit env=false). Test 5 overrides.
  process.env[DEMO_KEY] = "false";
  // Suppress real npm fetch — the dispatcher wrap fires update-check too.
  process.env[SUPPRESS_KEY] = "1";

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  _resetAutoDemoNoticeForTesting();
  _resetUpdateCheckForTesting();
  _resetSkillIntegrityForTesting();
});

afterEach(async () => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  if (savedSuppress === undefined) delete process.env[SUPPRESS_KEY];
  else process.env[SUPPRESS_KEY] = savedSuppress;

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  _resetAutoDemoNoticeForTesting();
  _resetUpdateCheckForTesting();
  _resetSkillIntegrityForTesting();

  mock?.restore();
  mock = undefined;

  if (spawned) {
    await spawned.close();
    spawned = undefined;
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// CallTool result content type — `content[i]` is `{ type: "text", text: string }`.
type ContentEntry = { type: string; text?: string };

const MISSING_STATE: SkillIntegrityState = {
  kind: "missing",
  pathsProbed: [
    "/home/u/.claude/skills/vaultpilot-preflight/SKILL.md",
    "/proj/.claude/skills/vaultpilot-preflight/SKILL.md",
  ],
};

const TAMPERED_STATE: SkillIntegrityState = {
  kind: "tampered",
  path: "/home/u/.claude/skills/vaultpilot-preflight/SKILL.md",
  computed: "feedface".repeat(8),
  expected: EXPECTED_SKILL_SHA256,
};

const OK_STATE: SkillIntegrityState = {
  kind: "ok",
  path: "/home/u/.claude/skills/vaultpilot-preflight/SKILL.md",
  sha256: EXPECTED_SKILL_SHA256,
};

describe("dispatcher wrap — lazy probe (NOT boot-time)", () => {
  it("Test 1 — buildServer does NOT call checkSkillIntegrity (no IO before first dispatch)", async () => {
    const spy = vi
      .spyOn(_skillIntegrity, "checkSkillIntegrity")
      .mockResolvedValue(OK_STATE);

    spawned = await spawnServerInProcess();

    // Server is connected; no tool dispatch yet. The probe must NOT have fired.
    expect(spy).toHaveBeenCalledTimes(0);
  });
});

describe("dispatcher wrap — missing skill prepends NOTICE (T-SKILL-MISSING-1 + T-NOTICE-DEDUP-1)", () => {
  it("Test 2 — missing skill: dispatch #1 prepends NOTICE; dispatch #2 does NOT (dedup)", async () => {
    vi.spyOn(_skillIntegrity, "checkSkillIntegrity").mockResolvedValue(MISSING_STATE);

    spawned = await spawnServerInProcess();

    const first = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    const firstContent = first.content as ContentEntry[];
    expect(firstContent.length).toBeGreaterThanOrEqual(2);
    expect(firstContent[0]?.text ?? "").toContain("VAULTPILOT NOTICE");
    expect(firstContent[0]?.text ?? "").toContain("not installed");
    expect(firstContent[0]?.text ?? "").toContain(
      "/home/u/.claude/skills/vaultpilot-preflight/SKILL.md",
    );
    // Tool's normal output follows in the next content entry.
    expect(firstContent[1]?.text ?? "").toMatch(/paired:/);

    const second = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    const secondContent = second.content as ContentEntry[];
    // No NOTICE prepended on the second dispatch — dedup-per-session.
    expect(secondContent[0]?.text ?? "").not.toContain("VAULTPILOT NOTICE");
    expect(secondContent[0]?.text ?? "").toMatch(/paired:/);
  });
});

describe("dispatcher wrap — tampered skill prepends NOTICE (T-SKILL-TAMPER-1)", () => {
  it("Test 3 — tampered skill: dispatch #1 prepends NOTICE with PATH/COMPUTED/EXPECTED; dispatch #2 does NOT", async () => {
    vi.spyOn(_skillIntegrity, "checkSkillIntegrity").mockResolvedValue(TAMPERED_STATE);

    spawned = await spawnServerInProcess();

    const first = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    const firstContent = first.content as ContentEntry[];
    expect(firstContent[0]?.text ?? "").toContain("VAULTPILOT NOTICE");
    expect(firstContent[0]?.text ?? "").toContain("integrity mismatch");
    expect(firstContent[0]?.text ?? "").toContain(
      "/home/u/.claude/skills/vaultpilot-preflight/SKILL.md",
    );
    expect(firstContent[0]?.text ?? "").toContain("feedface".repeat(8));
    expect(firstContent[0]?.text ?? "").toContain(EXPECTED_SKILL_SHA256);

    const second = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    const secondContent = second.content as ContentEntry[];
    expect(secondContent[0]?.text ?? "").not.toContain("VAULTPILOT NOTICE");
  });
});

describe("dispatcher wrap — OK skill emits NO NOTICE", () => {
  it("Test 4 — ok skill: no NOTICE prepended on any dispatch (response is tool's normal output)", async () => {
    vi.spyOn(_skillIntegrity, "checkSkillIntegrity").mockResolvedValue(OK_STATE);

    spawned = await spawnServerInProcess();

    const result = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    const content = result.content as ContentEntry[];

    // First content entry should be the tool's normal output, NOT a NOTICE.
    expect(content[0]?.text ?? "").not.toContain("VAULTPILOT NOTICE");
    expect(content[0]?.text ?? "").toMatch(/paired:/);
  });
});

describe("dispatcher wrap — ordering with auto-demo NOTICE (PATTERNS.md § 2 lock)", () => {
  it("Test 5 — auto-demo + missing skill: dispatch #1 emits ONLY auto-demo; dispatch #2 emits ONLY skill", async () => {
    // Trigger auto-demo: config missing + env unset.
    mock = mockConfigFile({ kind: "missing" });
    delete process.env[DEMO_KEY];
    _resetDemoModeForTesting();

    vi.spyOn(_skillIntegrity, "checkSkillIntegrity").mockResolvedValue(MISSING_STATE);

    spawned = await spawnServerInProcess();

    // Dispatch #1 — auto-demo NOTICE prepended; the skill wrap doesn't tick
    // (the auto-demo wrap returns before reaching the skill block).
    const first = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    const firstContent = first.content as ContentEntry[];
    expect(firstContent[0]?.text ?? "").toContain("VAULTPILOT NOTICE");
    expect(firstContent[0]?.text ?? "").toContain("Auto demo mode active");
    // Skill NOTICE must NOT be prepended on dispatch #1.
    expect(firstContent[0]?.text ?? "").not.toContain("not installed");

    // Dispatch #2 — auto-demo already consumed; skill wrap fires now and
    // prepends the missing-skill NOTICE.
    const second = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    const secondContent = second.content as ContentEntry[];
    expect(secondContent[0]?.text ?? "").toContain("VAULTPILOT NOTICE");
    expect(secondContent[0]?.text ?? "").toContain("not installed");
    // Auto-demo NOTICE must NOT be re-emitted.
    expect(secondContent[0]?.text ?? "").not.toContain("Auto demo mode active");
  });
});

describe("dispatcher wrap — state reset between scenarios", () => {
  it("Test 6 — _resetSkillIntegrityForTesting clears state cleanly across spawn cycles", async () => {
    // First spawn — missing state, NOTICE emits, dedup holds.
    vi.spyOn(_skillIntegrity, "checkSkillIntegrity").mockResolvedValue(MISSING_STATE);

    spawned = await spawnServerInProcess();
    const a = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    expect((a.content as ContentEntry[])[0]?.text ?? "").toContain("VAULTPILOT NOTICE");

    const b = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    expect((b.content as ContentEntry[])[0]?.text ?? "").not.toContain("VAULTPILOT NOTICE");

    await spawned.close();
    spawned = undefined;

    // Reset between sessions — the second spawn behaves as a fresh process.
    _resetSkillIntegrityForTesting();
    _resetUpdateCheckForTesting();

    spawned = await spawnServerInProcess();
    const c = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    // After reset, the missing NOTICE re-emits on the new session's first dispatch.
    expect((c.content as ContentEntry[])[0]?.text ?? "").toContain("VAULTPILOT NOTICE");
    expect((c.content as ContentEntry[])[0]?.text ?? "").toContain("not installed");
  });
});
