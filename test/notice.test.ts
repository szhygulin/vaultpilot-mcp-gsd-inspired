// Plan 05-03 — auto-demo NOTICE module tests (DEMO-07 + T-NOTICE-RACE-1).
//
// Three tests:
//   1. Template content — `AUTO_DEMO_NOTICE_TEMPLATE` contains the required
//      sentinels for an agent / human reader to recognize the block.
//   2. First call returns template; second call returns null — once-per-process
//      semantic (DEMO-07).
//   3. Concurrent calls — exactly one of N parallel `Promise.all`
//      invocations returns the template; the other N-1 return null (race
//      defense per T-NOTICE-RACE-1 / research § Pitfall 4).

import { beforeEach, describe, expect, it } from "vitest";

import {
  AUTO_DEMO_NOTICE_TEMPLATE,
  consumeAutoDemoNotice,
  _resetAutoDemoNoticeForTesting,
} from "../src/diagnostics/notice.js";

beforeEach(() => {
  _resetAutoDemoNoticeForTesting();
});

describe("AUTO_DEMO_NOTICE_TEMPLATE — required sentinels", () => {
  it("Test 1 — template contains the required header + opt-out hints", () => {
    expect(AUTO_DEMO_NOTICE_TEMPLATE).toContain("VAULTPILOT NOTICE");
    expect(AUTO_DEMO_NOTICE_TEMPLATE).toContain("Auto demo mode active");
    expect(AUTO_DEMO_NOTICE_TEMPLATE).toContain("set_demo_wallet");
    expect(AUTO_DEMO_NOTICE_TEMPLATE).toContain("VAULTPILOT_DEMO=false");
    // The template is multi-line — the `.join("\n")` shape is the format-
    // fanout sentinel for tests that wrap it (e.g. server-dispatcher-wrap).
    expect(AUTO_DEMO_NOTICE_TEMPLATE.split("\n").length).toBeGreaterThanOrEqual(5);
  });
});

describe("consumeAutoDemoNotice — once-per-process semantic (DEMO-07)", () => {
  it("Test 2 — first call returns template; subsequent calls return null", () => {
    const first = consumeAutoDemoNotice();
    expect(first).toBe(AUTO_DEMO_NOTICE_TEMPLATE);

    expect(consumeAutoDemoNotice()).toBeNull();
    expect(consumeAutoDemoNotice()).toBeNull();
    expect(consumeAutoDemoNotice()).toBeNull();
  });
});

describe("consumeAutoDemoNotice — race defense (T-NOTICE-RACE-1)", () => {
  it("Test 3 — Promise.all of 5 concurrent calls: exactly one returns template", async () => {
    // Node's single-threaded event loop + set-before-return makes this
    // byte-deterministic: each `consumeAutoDemoNotice` synchronously
    // reads-and-sets the flag; only the first call sees `false`.
    // `Promise.all` here is the strict-concurrent invocation pattern;
    // the function is synchronous so all 5 invocations execute one
    // after another in the same macrotask.
    const results = await Promise.all([
      Promise.resolve().then(() => consumeAutoDemoNotice()),
      Promise.resolve().then(() => consumeAutoDemoNotice()),
      Promise.resolve().then(() => consumeAutoDemoNotice()),
      Promise.resolve().then(() => consumeAutoDemoNotice()),
      Promise.resolve().then(() => consumeAutoDemoNotice()),
    ]);

    const templateHits = results.filter((r) => r === AUTO_DEMO_NOTICE_TEMPLATE);
    const nullHits = results.filter((r) => r === null);

    expect(templateHits).toHaveLength(1);
    expect(nullHits).toHaveLength(4);
  });
});
