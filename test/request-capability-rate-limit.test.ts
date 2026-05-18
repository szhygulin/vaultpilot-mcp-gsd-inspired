// Plan 10-04 (DIST-43) — sliding-window 3-per-hour rate-limit tests.
//
// 10 cases covering the gate semantics + sliding-window mechanics +
// `_resetForTesting` + ESM spy round-trip + edge cases.
//
// Mirror of `test/security-skill-integrity.test.ts` (Phase 9 spy-affordance
// shape) + `test/security-canonical-dispatch.test.ts` (parallel-state
// discipline). Uses `vi.useFakeTimers()` + `vi.setSystemTime()` for the
// sliding-window proof because `Date.now()` is a static method (not
// monkey-patchable via `vi.spyOn(Date, "now")` in strict-mode Node 22).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _rateLimit,
  _resetForTesting,
  check,
  record,
} from "../src/security/request-capability-rate-limit.js";

beforeEach(() => {
  _resetForTesting();
});

afterEach(() => {
  _resetForTesting();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("request-capability-rate-limit — sliding-window 3-per-hour", () => {
  it("Case 1 — T-CAPABILITY-SPAM-1 anchor: 3 sequential check+record passes; 4th refuses", () => {
    // 3 calls within the same window — all allowed; counters drop 3 → 2 → 1 → 0.
    const r1 = check();
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(3);
    expect(r1.retryAfterMs).toBe(0);
    record();

    const r2 = check();
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(2);
    record();

    const r3 = check();
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(1);
    record();

    // 4th — refusal.
    const r4 = check();
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterMs).toBeGreaterThan(0);
  });

  it("Case 2 — sliding-window: 60-min-old call falls out → 4th allowed (NOT fixed-window)", () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-05-18T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    // 3 calls within the first minute.
    record();
    vi.setSystemTime(t0 + 1000);
    record();
    vi.setSystemTime(t0 + 2000);
    record();

    // Gate at t0 + 3 sec — still in window; 4th refused.
    const refused = check();
    expect(refused.allowed).toBe(false);

    // Advance just past 1 hour from t0 — oldest call falls out.
    vi.setSystemTime(t0 + 60 * 60 * 1000 + 1);

    const allowedNow = check();
    expect(allowedNow.allowed).toBe(true);
    // Two timestamps still in window (the ones at t0+1000 and t0+2000):
    // remaining = LIMIT (3) - in-window (2) = 1.
    expect(allowedNow.remaining).toBe(1);
  });

  it("Case 3 — _resetForTesting clears state; next check returns full remaining", () => {
    record();
    record();
    record();
    expect(check().allowed).toBe(false);

    _resetForTesting();

    const fresh = check();
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(3);
    expect(fresh.retryAfterMs).toBe(0);
  });

  it("Case 4 — retryAfterMs accuracy: equals HOUR_MS - (now - oldest)", () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-05-18T12:00:00Z").getTime();
    vi.setSystemTime(t0);
    record();
    vi.setSystemTime(t0 + 1000);
    record();
    vi.setSystemTime(t0 + 2000);
    record();

    // At t0 + 3000, 4th check refused; oldest = t0, age = 3000ms.
    vi.setSystemTime(t0 + 3000);
    const refused = check();
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBe(60 * 60 * 1000 - 3000);
  });

  it("Case 5 — remaining accuracy across the full 0 → LIMIT count", () => {
    expect(check().remaining).toBe(3);
    record();
    expect(check().remaining).toBe(2);
    record();
    expect(check().remaining).toBe(1);
    record();
    const r = check();
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("Case 6 — ESM spy round-trip on _rateLimit.check (proves indirection works)", () => {
    const spy = vi
      .spyOn(_rateLimit, "check")
      .mockReturnValue({ allowed: false, remaining: 0, retryAfterMs: 12345 });

    const r = _rateLimit.check();
    expect(r).toEqual({ allowed: false, remaining: 0, retryAfterMs: 12345 });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("Case 7 — ESM spy round-trip on _rateLimit.record (call count tracked)", () => {
    const spy = vi.spyOn(_rateLimit, "record");
    _rateLimit.record();
    _rateLimit.record();
    _rateLimit.record();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("Case 8 — prune-then-test ordering: 60-min-old entries fall out BEFORE length check", () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-05-18T12:00:00Z").getTime();
    vi.setSystemTime(t0);
    record();
    record();
    record();

    // Advance just past 1 hour — ALL three entries fall out simultaneously.
    vi.setSystemTime(t0 + 60 * 60 * 1000 + 1);
    const r = check();
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(3); // 0 in-window after prune
  });

  it("Case 9 — synchronous check+record chain is atomic under single-threaded JS", () => {
    // Three back-to-back synchronous calls in the same JS turn — Node's
    // event loop guarantees no interleaving; all three records land.
    record();
    record();
    record();
    const r = check();
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("Case 10 — non-monotonic clock edge: backward jump keeps in-window entries (documented)", () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-05-18T12:00:00Z").getTime();
    vi.setSystemTime(t0);
    record();
    record();
    record();

    // System clock jumps BACKWARD (NTP adjustment, manual user change).
    // `now - t < HOUR_MS` evaluates true for negative deltas, so entries
    // remain in-window — gate stays consistent under clock skew.
    vi.setSystemTime(t0 - 5000);
    const r = check();
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });
});
