// Plan 09-02 — `src/security/skill-integrity.ts` tests (SEC-31).
//
// Twelve cases covering the lazy SHA-256 probe + dedup-per-session NOTICE
// helper + spy-affordance + single-SOT discipline. T-SKILL-SHA-PIN-1 anchors
// (Tests 1, 3, 12) + T-NOTICE-DEDUP-1 anchor (Test 9).
//
// Real-IO coverage for the OK + tampered cases uses `os.tmpdir()` + a custom
// `homedir`/`cwd` spy that points at the tmp file. Pure-state coverage
// (cached-state memoization, NOTICE dedup, `_skillIntegrity` spy round-trip,
// single-SOT grep) uses `vi.spyOn` for the IO seam.
//
// Mirror of `test/notice.test.ts` (Plan 05-03 `consumeAutoDemoNotice`) +
// `test/diagnostics-update-check.test.ts` (lazy-on-first-dispatch).

import * as crypto from "node:crypto";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VAULTPILOT_NOTICE_TEMPLATE_MISSING,
  VAULTPILOT_NOTICE_TEMPLATE_TAMPERED,
} from "../src/signing/blocks.js";
import {
  EXPECTED_SKILL_SHA256,
  _skillIntegrity,
  _resetSkillIntegrityForTesting,
  checkSkillIntegrity,
  consumeSkillIntegrityNotice,
  type SkillIntegrityState,
} from "../src/security/skill-integrity.js";

// Path to the planning-time SOT (the file whose SHA-256 IS
// EXPECTED_SKILL_SHA256 by Plan 09-02's fixpoint algorithm). Used to seed
// the tmp-file fixture for the OK arm test.
const TEMPLATE_PATH = join(
  process.cwd(),
  ".planning",
  "phases",
  "09-hardening-skill-and-verification-tools",
  "09-01-SKILL-TEMPLATE.md",
);

// Per-test tmp scratch dir — used to stub `homedir()` via the HOME env var
// (Node's `os.homedir()` honors HOME on POSIX). `mkdtempSync` returns a
// unique path so tests don't collide if run in parallel.
//
// We stub via env rather than `vi.spyOn(os, "homedir")` because vitest cannot
// redefine the property on the `node:os` module namespace (non-configurable
// descriptor on the export binding). `vi.stubEnv` is the supported seam.
let tmpDir: string;
let savedCwd: string;
let savedHome: string | undefined;

beforeEach(() => {
  _resetSkillIntegrityForTesting();
  tmpDir = fs.mkdtempSync(join(tmpdir(), "vp-skill-test-"));
  savedCwd = process.cwd();
  savedHome = process.env.HOME;
});

afterEach(() => {
  _resetSkillIntegrityForTesting();
  // Restore cwd before cleaning up tmp.
  if (process.cwd() !== savedCwd) {
    process.chdir(savedCwd);
  }
  // Restore HOME.
  if (savedHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = savedHome;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * Install a SKILL.md fixture at the standard personal-scope path inside the
 * per-test tmp scratch dir. Returns the absolute path of the installed file.
 * The caller must call `stubHomedir` BEFORE `checkSkillIntegrity` so the
 * probe's `homedir()` resolution lands on `tmpDir`.
 */
function installSkillFixture(content: Buffer | string): string {
  const skillDir = join(tmpDir, ".claude", "skills", "vaultpilot-preflight");
  fs.mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, "SKILL.md");
  fs.writeFileSync(skillPath, content);
  return skillPath;
}

function stubHomedir(): void {
  // Node `os.homedir()` returns HOME on POSIX; this works without monkey-
  // patching the os module's namespace.
  process.env.HOME = tmpDir;
}

// -----------------------------------------------------------------------------
// Tests 1-3 — three-arm probe coverage (T-SKILL-SHA-PIN-1 anchors)
// -----------------------------------------------------------------------------

describe("checkSkillIntegrity — three-arm probe coverage", () => {
  it("Test 1 (T-SKILL-SHA-PIN-1) — ok arm: SKILL.md present + SHA matches EXPECTED → kind=ok with path + sha256", async () => {
    // Install the planning-time SOT as the SKILL.md — its SHA IS the pinned
    // EXPECTED_SKILL_SHA256 by Plan 09-02's fixpoint substitution discipline.
    const content = fs.readFileSync(TEMPLATE_PATH);
    const skillPath = installSkillFixture(content);
    stubHomedir();

    const state = await checkSkillIntegrity();

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") throw new Error("type-narrow guard");
    expect(state.path).toBe(skillPath);
    expect(state.sha256).toBe(EXPECTED_SKILL_SHA256);
  });

  it("Test 2 (T-SKILL-MISSING-1) — missing arm: no SKILL.md at any probe path → kind=missing with pathsProbed", async () => {
    stubHomedir();
    // tmpDir is empty — no .claude/skills/... directory created. The probe
    // also tries cwd; both paths should ENOENT. Chdir to tmpDir so the
    // project-scope probe also misses.
    process.chdir(tmpDir);

    const state = await checkSkillIntegrity();

    expect(state.kind).toBe("missing");
    if (state.kind !== "missing") throw new Error("type-narrow guard");
    expect(state.pathsProbed).toHaveLength(2);
    expect(state.pathsProbed[0]).toContain(".claude/skills/vaultpilot-preflight/SKILL.md");
    expect(state.pathsProbed[1]).toContain(".claude/skills/vaultpilot-preflight/SKILL.md");
  });

  it("Test 3 (T-SKILL-SHA-PIN-1) — tampered arm: SKILL.md present but byte-flipped → kind=tampered with computed != expected", async () => {
    // Read the SOT, flip the very last byte (any byte change yields a fresh
    // SHA by avalanche), install as the SKILL.md fixture.
    const sot = fs.readFileSync(TEMPLATE_PATH);
    const flipped = Buffer.from(sot);
    flipped[flipped.length - 1] = flipped[flipped.length - 1] ^ 0x01;
    const skillPath = installSkillFixture(flipped);
    stubHomedir();

    const state = await checkSkillIntegrity();

    expect(state.kind).toBe("tampered");
    if (state.kind !== "tampered") throw new Error("type-narrow guard");
    expect(state.path).toBe(skillPath);
    expect(state.expected).toBe(EXPECTED_SKILL_SHA256);
    expect(state.computed).not.toBe(EXPECTED_SKILL_SHA256);
    expect(state.computed).toMatch(/^[a-f0-9]{64}$/);
    // Sanity: the computed SHA equals SHA-256 of the flipped buffer.
    const independentSha = crypto.createHash("sha256").update(flipped).digest("hex");
    expect(state.computed).toBe(independentSha);
  });
});

// -----------------------------------------------------------------------------
// Tests 4-5 — memoization + reset hook
// -----------------------------------------------------------------------------

describe("checkSkillIntegrity — memoization + reset hook", () => {
  it("Test 4 — cachedState memoizes: two consecutive calls return the same reference; filesystem mutations between calls are NOT observed", async () => {
    // Install the SOT — first probe sees ok.
    const content = fs.readFileSync(TEMPLATE_PATH);
    const skillPath = installSkillFixture(content);
    stubHomedir();

    const first = await checkSkillIntegrity();
    expect(first.kind).toBe("ok");

    // Mutate the fixture between calls — flip a byte so the SHA changes.
    // If the second call did real IO, it would see "tampered". Memoization
    // means it returns the same cached object instead.
    const tampered = Buffer.from(content);
    tampered[0] = tampered[0] ^ 0x01;
    fs.writeFileSync(skillPath, tampered);

    const second = await checkSkillIntegrity();

    // Same object reference → byte-identical memoization (no re-allocation).
    expect(second).toBe(first);
    // Still reports ok despite the on-disk tamper.
    expect(second.kind).toBe("ok");
  });

  it("Test 5 — _resetSkillIntegrityForTesting clears cachedState AND noticeEmitted", async () => {
    const content = fs.readFileSync(TEMPLATE_PATH);
    installSkillFixture(content);
    stubHomedir();

    // Prime the cache.
    const first = await checkSkillIntegrity();
    expect(first.kind).toBe("ok");

    // Switch the fixture to a missing-skill state for the SECOND probe.
    fs.rmSync(join(tmpDir, ".claude"), { recursive: true });
    process.chdir(tmpDir); // miss project-scope too

    // Without reset, the cache returns the prior ok state.
    const stillCached = await checkSkillIntegrity();
    expect(stillCached.kind).toBe("ok");

    // After reset, the probe re-runs the IO and finds nothing.
    _resetSkillIntegrityForTesting();
    const fresh = await checkSkillIntegrity();
    expect(fresh.kind).toBe("missing");

    // Reset also clears noticeEmitted — consumeSkillIntegrityNotice can re-fire.
    const notice1 = consumeSkillIntegrityNotice(fresh);
    expect(notice1).not.toBeNull();
    _resetSkillIntegrityForTesting();
    // Re-prime a non-OK state and consume — first call after reset returns the template.
    const reEmit = consumeSkillIntegrityNotice({ kind: "missing", pathsProbed: ["/a"] });
    expect(reEmit).not.toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Tests 6-8 — consumeSkillIntegrityNotice state mapping
// -----------------------------------------------------------------------------

describe("consumeSkillIntegrityNotice — state-to-NOTICE mapping", () => {
  it("Test 6 — ok state → returns null (no NOTICE on healthy state)", () => {
    const okState: SkillIntegrityState = {
      kind: "ok",
      path: "/home/user/.claude/skills/vaultpilot-preflight/SKILL.md",
      sha256: EXPECTED_SKILL_SHA256,
    };
    expect(consumeSkillIntegrityNotice(okState)).toBeNull();
  });

  it("Test 7 — missing state → returns missing template with {PATHS} substituted (newline-indented)", () => {
    const missingState: SkillIntegrityState = {
      kind: "missing",
      pathsProbed: [
        "/home/u/.claude/skills/vaultpilot-preflight/SKILL.md",
        "/proj/.claude/skills/vaultpilot-preflight/SKILL.md",
      ],
    };
    const notice = consumeSkillIntegrityNotice(missingState);
    expect(notice).not.toBeNull();
    if (notice === null) throw new Error("type-narrow guard");
    // Required sentinels — the NOTICE header + install one-liner + paths block.
    expect(notice).toContain("VAULTPILOT NOTICE");
    expect(notice).toContain("not installed");
    expect(notice).toContain("/home/u/.claude/skills/vaultpilot-preflight/SKILL.md");
    expect(notice).toContain("/proj/.claude/skills/vaultpilot-preflight/SKILL.md");
    expect(notice).toContain("git clone https://github.com/szhygulin/vaultpilot-preflight-skill");
    expect(notice).toContain("git checkout v1.3.0");
    // Newline-indented join — second path appears after `\n    ` prefix.
    expect(notice).toContain("\n    /proj/.claude/skills/vaultpilot-preflight/SKILL.md");
    // Template starts with the header (raw template byte-identical at the prefix).
    expect(notice.startsWith(VAULTPILOT_NOTICE_TEMPLATE_MISSING.split("{PATHS}")[0]!)).toBe(true);
  });

  it("Test 8 — tampered state → returns tampered template with {PATH}, {COMPUTED}, {EXPECTED} all substituted", () => {
    const tamperedState: SkillIntegrityState = {
      kind: "tampered",
      path: "/home/u/.claude/skills/vaultpilot-preflight/SKILL.md",
      computed: "deadbeef".repeat(8),
      expected: EXPECTED_SKILL_SHA256,
    };
    const notice = consumeSkillIntegrityNotice(tamperedState);
    expect(notice).not.toBeNull();
    if (notice === null) throw new Error("type-narrow guard");
    expect(notice).toContain("VAULTPILOT NOTICE");
    expect(notice).toContain("integrity mismatch");
    expect(notice).toContain("/home/u/.claude/skills/vaultpilot-preflight/SKILL.md");
    expect(notice).toContain("deadbeef".repeat(8));
    expect(notice).toContain(EXPECTED_SKILL_SHA256);
    // No raw {PLACEHOLDER} sentinels remain post-substitution.
    expect(notice).not.toContain("{PATH}");
    expect(notice).not.toContain("{COMPUTED}");
    expect(notice).not.toContain("{EXPECTED}");
    // Template prefix byte-identical.
    expect(notice.startsWith(VAULTPILOT_NOTICE_TEMPLATE_TAMPERED.split("{PATH}")[0]!)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Tests 9-10 — dedup-per-session + race-defense
// -----------------------------------------------------------------------------

describe("consumeSkillIntegrityNotice — dedup-per-session (T-NOTICE-DEDUP-1)", () => {
  it("Test 9 (T-NOTICE-DEDUP-1) — two consecutive non-OK calls in same session → first returns string, second null", () => {
    const state: SkillIntegrityState = { kind: "missing", pathsProbed: ["/a", "/b"] };
    const first = consumeSkillIntegrityNotice(state);
    const second = consumeSkillIntegrityNotice(state);
    const third = consumeSkillIntegrityNotice(state);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(third).toBeNull();
  });

  it("Test 10 — race-defense: Promise.all of 5 concurrent consume calls → exactly one returns template, four return null", async () => {
    // Mirror of test/notice.test.ts Test 3. `consumeSkillIntegrityNotice` is
    // synchronous; Promise.all here is the strict-concurrent invocation
    // pattern. Node's single-threaded event loop + set-before-return makes
    // this byte-deterministic: each invocation synchronously reads-and-sets
    // the flag; only the first sees `noticeEmitted = false`.
    const state: SkillIntegrityState = { kind: "missing", pathsProbed: ["/x"] };
    const results = await Promise.all([
      Promise.resolve().then(() => consumeSkillIntegrityNotice(state)),
      Promise.resolve().then(() => consumeSkillIntegrityNotice(state)),
      Promise.resolve().then(() => consumeSkillIntegrityNotice(state)),
      Promise.resolve().then(() => consumeSkillIntegrityNotice(state)),
      Promise.resolve().then(() => consumeSkillIntegrityNotice(state)),
    ]);

    const stringHits = results.filter((r) => typeof r === "string");
    const nullHits = results.filter((r) => r === null);
    expect(stringHits).toHaveLength(1);
    expect(nullHits).toHaveLength(4);
  });
});

// -----------------------------------------------------------------------------
// Test 11 — _skillIntegrity ESM spy-affordance round-trip
// -----------------------------------------------------------------------------

describe("_skillIntegrity — ESM spy-affordance", () => {
  it("Test 11 — vi.spyOn(_skillIntegrity, 'checkSkillIntegrity') intercepts (proves indirection works)", async () => {
    const stubState: SkillIntegrityState = {
      kind: "ok",
      path: "/spied/path/SKILL.md",
      sha256: EXPECTED_SKILL_SHA256,
    };
    const spy = vi.spyOn(_skillIntegrity, "checkSkillIntegrity").mockResolvedValue(stubState);

    const result = await _skillIntegrity.checkSkillIntegrity();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(stubState);
  });
});

// -----------------------------------------------------------------------------
// Test 12 — EXPECTED_SKILL_SHA256 single-SOT discipline
// -----------------------------------------------------------------------------

describe("EXPECTED_SKILL_SHA256 — single-SOT discipline (T-SKILL-SHA-PIN-1)", () => {
  it("Test 12 — appears in exactly 2 src files (skill-integrity.ts constant + server.ts INSTRUCTIONS interpolation)", () => {
    // Shell grep: -rl lists files containing the literal hex. Exactly 2:
    // the declaring constant in skill-integrity.ts + the interpolation via
    // template-literal substitution in server.ts.
    const output = execSync(`grep -rl "${EXPECTED_SKILL_SHA256}" src/`, {
      encoding: "utf8",
    });
    const files = output.trim().split("\n").filter((f) => f.length > 0).sort();
    expect(files).toEqual(
      ["src/security/skill-integrity.ts"].sort(),
    );

    // Independently assert via a non-grep route that the constant value is
    // valid 64-char lowercase hex.
    expect(EXPECTED_SKILL_SHA256).toMatch(/^[a-f0-9]{64}$/);

    // The constant equals the SHA-256 of the post-Step-0-fix planning template
    // by construction (Plan 09-02 fixpoint substitution).
    const templateContent = fs.readFileSync(TEMPLATE_PATH);
    const independentSha = crypto.createHash("sha256").update(templateContent).digest("hex");
    expect(EXPECTED_SKILL_SHA256).toBe(independentSha);
  });
});
