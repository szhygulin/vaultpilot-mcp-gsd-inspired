# Milestone Hygiene Plan

**Created:** 2026-05-29 · **Status:** NOT STARTED (plan only — execute in a fresh context)
**Owner action:** the user will `/clear` then run this. Do NOT execute the steps below from the session that wrote this file.

---

## Why this is needed

`.planning/STATE.md` tracking has drifted far from reality and has never been reconciled. The frontmatter `milestone` field has lagged repeatedly (the STATE "Roadmap Evolution" log already notes it was bumped late after Phases 9/10 and again at the v2.0 start). No milestone has ever been formally archived — `ROADMAP.md` still holds all 41 phases and there is no `MILESTONES.md` archive cycle. This makes `gsd-sdk query roadmap.analyze` and `/gsd-progress` resolve against the wrong milestone (they scoped to v2.5 / phases 36-38 during the Phase 41 work).

## Drift evidence (captured 2026-05-29, verify it still holds before acting)

STATE.md frontmatter (stale):
```
milestone: v2.5                       # reality: v2.6 shipped (#160/#162) + v2.3.x backfill Phase 41 shipped (#163/#164)
milestone_name: Safe positions + Tx Service
current_plan: 2
status: verifying
progress: { total_phases: 3, completed_phases: 1, total_plans: 8, completed_plans: 6, percent: 33 }   # scoped to v2.5 only; "completed_phases: 1" is wrong — 36/37/38 all code-complete
```
- STATE.md body "Current Position" says Phase 41 "ready for verification" — outdated; Phase 41 is verified + merged (`49f7641`, PR #164).
- `ROADMAP.md` "Progress → Execution Order" line ends at `… → 40` — missing Phase 41.
- Git reality: latest is `feat(41) … (#164)`; v2.6 close-out was `feat(40) … (#162)`. Phases 1-41 are all code-complete; real-Ledger verify-phases are deferred per the 2026-05-16 bundled-verify directive (tracked in per-phase `*-HUMAN-UAT.md`).

## Decisions to make FIRST (ask the user before editing)

1. **Archiving scope** — two viable shapes:
   - **(A) Light reconcile (recommended default):** fix the STATE.md frontmatter + body + the ROADMAP Execution-Order line to reflect reality. Leave ROADMAP.md intact (all phases visible in one file). No `MILESTONES.md` archival. Lowest risk; matches how this project has always operated (single ROADMAP, deferred verify-phases).
   - **(B) Full archival:** run `/gsd-complete-milestone` per completed milestone to move each milestone's ROADMAP section into `MILESTONES.md`. Heavier; restructures ROADMAP.md. ⚠ Caveat: this project ships milestones **code-complete with verify-phases deferred** — confirm `/gsd-complete-milestone` tolerates open `*-HUMAN-UAT.md` debt before running it, or it may refuse / mis-mark. If chosen, archive in order (v1.0 → … → v2.6, then the v2.3.x Phase-41 backfill).
2. **What should `milestone` point to now?** The next *active* work is the **Deferred Backlog** (see ROADMAP "Deferred Backlog" section), not a numbered milestone. Options: set `milestone: v2.6` (last numbered milestone shipped) with a `status` of `maintenance`/`backlog`; or introduce a `milestone: backlog` sentinel. Pick whichever keeps `gsd-progress` routing sane.

## Recommended steps (Option A — light reconcile)

> Switch to Option B only if the user explicitly wants ROADMAP→MILESTONES archival.

0. **Sync + branch (PR-based, never commit to main):**
   `git fetch origin main && git checkout -b docs/milestone-hygiene origin/main`
1. **Diagnose:** run `/gsd-health` (read-only) for the authoritative planning-dir health report; reconcile its findings against the drift evidence above.
2. **Reconcile STATE.md frontmatter:**
   - `milestone` / `milestone_name` → per decision #2.
   - `status` → reality (e.g. `code-complete; verify-phases deferred`).
   - `current_plan` → clear / N-A.
   - `progress` block → recompute project-wide (use `gsd-sdk query progress` / `progress.bar`) rather than the stale v2.5-scoped counts; or drop to a project-wide rollup.
3. **Reconcile STATE.md body:** update "Current focus" + "Current Position" to reflect: Phase 41 merged; next work = Deferred Backlog. Prepend a Roadmap-Evolution note dated 2026-05-29 recording the reconciliation.
4. **Fix ROADMAP.md "Execution Order"** line in the Progress section — append `→ 41`.
5. **Coherence check:** `gsd-sdk query roadmap.analyze` and `/gsd-progress` should now resolve to the correct current position and route to the Deferred Backlog (or whatever decision #2 set). Iterate until they agree with reality.
6. **Commit → push → docs PR → watch CI → admin-merge** (docs-only; main is green; established cadence: squash + `--admin` + `--delete-branch`).

## Constraints

- PR-based; never commit to `main`.
- Roadmap/state docs only — **no code changes** in the hygiene PR.
- Do NOT delete or resolve verify-phase debt (`*-HUMAN-UAT.md`) — it is tracked hardware-test work, surfaced via `/gsd-audit-uat`, not something hygiene clears.
- Do NOT touch the FROZEN cryptographic-binding files or any `src/`.

## Pointers

- Skills: `/gsd-health` (diagnose + optional repair), `/gsd-complete-milestone` (Option B), `/gsd-audit-uat` (verify-phase debt view), `/gsd-progress` (routing sanity check).
- The Deferred Backlog (the actual next work) lives in `ROADMAP.md` → "Deferred Backlog (planned follow-ups)" section, added 2026-05-29.
- Companion-skill context: the real preflight skill is `vaultpilot-skill` (v0.13.0), NOT the stale `vaultpilot-preflight-skill` referenced in older planning docs — irrelevant to hygiene but don't get nerd-sniped by the Phase 38-02 sister-repo TODO (it is moot; Inv #12.5 already ships in `vaultpilot-skill`).
