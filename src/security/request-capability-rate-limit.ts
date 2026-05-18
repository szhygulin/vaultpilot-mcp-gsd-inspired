// Plan 10-04 (DIST-43) — sliding-window 3-per-hour rate-limit for the
// `request_capability` MCP tool.
//
// Module-scoped state (in-memory; per-process; restart resets per Assumption
// A5 documented residual — RESEARCH § Topic 8 line 825 lock + SECURITY.md
// row owned by Plan 10-01). The bypass cost (restart MCP server, lose all
// session state including paired Ledger session-topic) is high enough to
// deter casual abuse — friction-not-fortress.
//
// Sliding-window > fixed-window (RESEARCH § Topic 8 line 823 lock): a
// fixed-window (0-60 / 60-120 min buckets) lets a user burst 3 at minute 59
// + 3 at minute 61 = 6 in 2 min. Sliding-window prevents this — oldest
// call falls out of the window only after a FULL 60 min from THAT call's
// timestamp. Cost: one extra array filter per check, trivial.
//
// Mirrors Phase 9 `src/security/skill-integrity.ts` + `src/security/
// canonical-dispatch.ts` ESM spy-affordance shape per CLAUDE.md Convention
// — `vi.spyOn` intercepts via the `_rateLimit` object (ESM named-export
// bindings are immutable; direct spies on the `check` / `record` exports
// are no-ops for internal cross-export calls inside this codebase).
// Adding the indirection at WRITE time, not retroactively, per CLAUDE.md
// Convention.

const HOUR_MS = 60 * 60 * 1000;
const LIMIT = 3;

let timestamps: number[] = [];

/**
 * Result of a rate-limit `check()`. `allowed` is the gate; `remaining` is
 * the count of further calls available in the current window (always 0 on
 * refusal); `retryAfterMs` is the ms until the OLDEST in-window call falls
 * out and a fresh slot opens (always 0 when `allowed`).
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Peek at the rate-limit gate WITHOUT mutating state. Prunes entries
 * older than 1 hour first, then tests `length >= LIMIT`. Callers MUST
 * follow gate-then-record discipline: call `record()` only AFTER a
 * passing gate AND after deciding to commit the request — never on
 * refusal, never speculatively.
 */
export function check(): RateLimitResult {
  const now = Date.now();
  // Prune entries older than 1 hour BEFORE length check (sliding-window
  // semantics). Non-monotonic clock edge: if the system clock jumped
  // backward, `now - t` can be negative; `< HOUR_MS` still evaluates true
  // for negative deltas so the entry remains in-window. Acceptable —
  // sliding window stays consistent under clock skew without ejecting
  // entries that are still "young" by absolute wall-clock measure.
  timestamps = timestamps.filter((t) => now - t < HOUR_MS);
  if (timestamps.length >= LIMIT) {
    const oldest = timestamps[0]!;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: HOUR_MS - (now - oldest),
    };
  }
  return {
    allowed: true,
    remaining: LIMIT - timestamps.length,
    retryAfterMs: 0,
  };
}

/**
 * Commit a rate-limit slot. Pushes `Date.now()` onto the in-memory
 * timestamps array. Called by `request_capability` ONLY after `check()`
 * returned `allowed: true`. Gate-then-record discipline keeps `check()`
 * pure (peek without mutate) so consumers can call it speculatively
 * without polluting the counter.
 */
export function record(): void {
  timestamps.push(Date.now());
}

/**
 * ESM spy-affordance object per CLAUDE.md Convention. Consumers (the
 * `request_capability` tool handler) call THROUGH this object so
 * `vi.spyOn(_rateLimit, "check")` / `vi.spyOn(_rateLimit, "record")`
 * intercepts at the consumer call site. Without the indirection ESM
 * named-export immutability makes a direct `vi.spyOn(check)` a silent
 * no-op for internal cross-export calls.
 *
 * Mirror of Phase 9 `_skillIntegrity = { checkSkillIntegrity }` +
 * `_canonicalDispatch` shape (PATTERNS.md § 2 lines 118-124).
 */
export const _rateLimit = { check, record };

/**
 * Test-only helper. Production code MUST NOT call this — the module-
 * scoped `timestamps` array is once-per-process semantics (resets only
 * on MCP server restart, per Assumption A5). Tests use this to restart
 * state between scenarios so each `describe` block starts from a fresh
 * counter.
 *
 * Mirror of Phase 9 `_resetSkillIntegrityForTesting()`.
 */
export function _resetForTesting(): void {
  timestamps = [];
}
