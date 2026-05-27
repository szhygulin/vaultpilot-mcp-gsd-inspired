// Companion-skill SHA-256 integrity probe — Phase 9 / Plan 09-02 (SEC-31).
//
// Lazy first-dispatch probe of the `vaultpilot-preflight` companion skill at
// the two canonical install paths (personal scope + project scope). Computes
// SHA-256 against `EXPECTED_SKILL_SHA256` (pinned at build time as part of the
// coordinated v1.3.x sister-repo tag release) and emits a `VAULTPILOT NOTICE`
// block on the FIRST tool response that detects a non-OK state — missing OR
// tampered. Subsequent dispatches in the same session are no-ops at near-zero
// cost (dedup-per-session via the `noticeEmitted` flag).
//
// Mirror of `src/diagnostics/notice.ts::consumeAutoDemoNotice` (dedup pattern)
// + `src/diagnostics/update-check.ts::runUpdateCheckOnce` (lazy-on-first-
// dispatch pattern). Boot-time IO is deliberately AVOIDED: blocking the MCP
// `initialize` handshake is observable to the client (Phase 5 retro / research
// § Pitfall 3).
//
// EXPECTED_SKILL_SHA256 is the format-fanout-sentinel SOT for the SHA pin —
// `grep -c <hex>` across `src/` returns 1 in this file plus 1 in
// `src/server.ts` (the INSTRUCTIONS interpolation surfaces the constant to
// the agent at `initialize` time for the skill's Step 0 self-check). Any
// drift between the MCP constant + sister-repo SKILL.md content + README
// integrity-check section is caught either by this probe (SKILL.md vs MCP
// constant) or by the skill's Step 0 self-check (locally-installed SKILL.md
// vs README-documented SHA).
//
// SKILL.md content NEVER contains the SHA — Step 0 of the skill instructs
// the agent to look up the EXPECTED_SKILL_SHA256 from the MCP `instructions`
// field OR the sister-repo README (the SHA cannot self-reference by
// construction; any value embedded in the hashed file would alter its own
// SHA, breaking the check).
//
// Race-defense: `consumeSkillIntegrityNotice` sets `noticeEmitted = true`
// BEFORE returning the template (same Pitfall 4 mitigation as
// `src/diagnostics/notice.ts:48`). Two concurrent first-dispatches CANNOT
// both emit — Node's single-threaded event loop + synchronous read-and-set
// means exactly one wins; the loser returns null.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  VAULTPILOT_NOTICE_TEMPLATE_MISSING,
  VAULTPILOT_NOTICE_TEMPLATE_TAMPERED,
} from "../signing/blocks.js";

/**
 * Pinned SHA-256 of the v1.4 companion skill (`SKILL.md` at sister repo
 * `szhygulin/vaultpilot-preflight-skill`, byte-identical to
 * `.planning/phases/38-safe-enable-module-delegate-call-second-llm/38-02-SKILL-TEMPLATE.md`).
 *
 * Updated as a coordinated bump with each tagged release of the sister repo
 * (Plan 38-01 REPLACES the v1.3.x pin per DF-2 — single constant, NOT
 * promoted to a multi-version additive list; the integrity probe enforces
 * strict equality against the current pinned hex).
 *
 * Format-fanout-sentinel: `grep -rl "<hex>" src/` returns exactly 2 files —
 * this constant + the `src/server.ts` `INSTRUCTIONS` interpolation. The
 * second occurrence is a template-literal interpolation (`${EXPECTED_SKILL_SHA256}`),
 * not a hardcoded re-declaration, so any change here propagates automatically.
 */
export const EXPECTED_SKILL_SHA256 =
  "8eb8ba90fb4c7a21ac5579a4533d9221cc136b8d188b0daa6b652b5743da9a4f";

/**
 * Probe paths in priority order. Personal scope (`~/.claude/skills/...`) is
 * the v1.3 primary install target per the sister-repo README install one-
 * liner. Project scope (`<cwd>/.claude/skills/...`) is the per-project
 * override per Claude Code skills runtime probe (RESEARCH § Topic 1).
 *
 * Path-factory closures (not pre-resolved strings) — `homedir()` /
 * `process.cwd()` evaluated at probe time so tests can stub `homedir` via
 * `vi.spyOn` before calling `checkSkillIntegrity`.
 */
const PROBE_PATHS: ReadonlyArray<() => string> = [
  () => join(homedir(), ".claude", "skills", "vaultpilot-preflight", "SKILL.md"),
  () => join(process.cwd(), ".claude", "skills", "vaultpilot-preflight", "SKILL.md"),
] as const;

/**
 * Discriminated-union result of the SHA-256 probe.
 *
 *   - `ok`        — SKILL.md found at `path`; its SHA-256 (`sha256`) matches
 *                   the pinned `EXPECTED_SKILL_SHA256` constant.
 *   - `missing`   — No SKILL.md at any of the probe paths in `pathsProbed`.
 *                   ENOENT (or any read error) on every path.
 *   - `tampered`  — SKILL.md found at `path`; its SHA (`computed`) differs
 *                   from `expected`. Cause unknown — could be local tamper,
 *                   newer/older skill version, or filesystem corruption.
 *                   NOTICE block surfaces all three likely causes.
 */
export type SkillIntegrityState =
  | { kind: "ok"; path: string; sha256: string }
  | { kind: "missing"; pathsProbed: string[] }
  | { kind: "tampered"; path: string; computed: string; expected: string };

let cachedState: SkillIntegrityState | null = null;
let noticeEmitted = false;

/**
 * Lazy SHA-256 integrity probe — fires on the FIRST tool dispatch of the
 * session, then memoizes for the life of the process.
 *
 * Probe order: personal scope → project scope. The first path whose
 * `readFile` succeeds wins (state = ok OR tampered depending on SHA match);
 * if ALL paths ENOENT, state = missing (with `pathsProbed` listing every path
 * that was tried, so the NOTICE block can surface them to the user).
 *
 * Returns a `Promise<SkillIntegrityState>`. Caller is `src/server.ts`
 * dispatcher-wrap (mirror of the auto-demo NOTICE wrap at lines 142-161); the
 * wrap awaits the probe before consuming the NOTICE.
 */
export async function checkSkillIntegrity(): Promise<SkillIntegrityState> {
  if (cachedState !== null) return cachedState;
  const probed: string[] = [];
  for (const pathFn of PROBE_PATHS) {
    const path = pathFn();
    probed.push(path);
    let content: Buffer;
    try {
      content = await readFile(path);
    } catch {
      // ENOENT or any other read error — try the next probe path.
      continue;
    }
    const computed = createHash("sha256").update(content).digest("hex");
    cachedState =
      computed === EXPECTED_SKILL_SHA256
        ? { kind: "ok", path, sha256: computed }
        : { kind: "tampered", path, computed, expected: EXPECTED_SKILL_SHA256 };
    return cachedState;
  }
  cachedState = { kind: "missing", pathsProbed: probed };
  return cachedState;
}

/**
 * ESM spy-affordance — wrap the internal-call surface in a mutable object so
 * `vi.spyOn(_skillIntegrity, "checkSkillIntegrity")` can intercept. Per
 * CLAUDE.md § Conventions: ESM named-export bindings are immutable; a direct
 * `vi.spyOn` on the named export is a no-op for internal calls. Indirection
 * here keeps the test seam open without retroactive refactoring.
 *
 * Production callers (`src/server.ts` dispatcher-wrap,
 * `src/tools/get_vaultpilot_config_status.ts`) call through this object so
 * the spy applies to them.
 */
export const _skillIntegrity = { checkSkillIntegrity };

/**
 * Return the appropriate `VAULTPILOT NOTICE` block on the FIRST non-OK state
 * of the session; `null` on every subsequent call OR when state is `ok`.
 *
 * Race-defense: `noticeEmitted` is set to `true` BEFORE returning the
 * template (Pitfall 4 mitigation, mirror of `src/diagnostics/notice.ts:48`).
 * Two concurrent calls cannot both emit — Node's single-threaded event loop
 * means exactly one synchronous read-and-set wins.
 *
 * State → NOTICE mapping:
 *   - `ok`        → `null` (no NOTICE on healthy state)
 *   - `missing`   → `VAULTPILOT_NOTICE_TEMPLATE_MISSING` with `{PATHS}`
 *                   substituted by the newline-indented list from
 *                   `state.pathsProbed`
 *   - `tampered`  → `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` with `{PATH}`,
 *                   `{COMPUTED}`, `{EXPECTED}` substituted from the state
 */
export function consumeSkillIntegrityNotice(
  state: SkillIntegrityState,
): string | null {
  if (noticeEmitted) return null;
  if (state.kind === "ok") return null;
  noticeEmitted = true; // SET BEFORE RETURN — race-defense per Pitfall 4
  if (state.kind === "missing") {
    return VAULTPILOT_NOTICE_TEMPLATE_MISSING.replace(
      "{PATHS}",
      state.pathsProbed.join("\n    "),
    );
  }
  return VAULTPILOT_NOTICE_TEMPLATE_TAMPERED
    .replace("{PATH}", state.path)
    .replace("{COMPUTED}", state.computed)
    .replace("{EXPECTED}", state.expected);
}

/**
 * Test-only helper. Production code MUST NOT call this — the cached-state +
 * `noticeEmitted` flags are once-per-process semantics. Tests use this to
 * restart both flags between scenarios.
 */
export function _resetSkillIntegrityForTesting(): void {
  cachedState = null;
  noticeEmitted = false;
}
