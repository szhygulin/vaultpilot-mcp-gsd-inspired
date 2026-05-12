// Auto-demo NOTICE block — Plan 05-03 / DEMO-07.
//
// One static template (`AUTO_DEMO_NOTICE_TEMPLATE`) lives here as the single
// source of truth. The dispatcher wrap at `src/server.ts` consumes it via
// `consumeAutoDemoNotice()` on the FIRST tool response of the session ONLY
// when the demo-mode resolver picked the auto-detect arm (`isAutoDemo()`
// true — NOT explicit env/config demo, which the user already knows about).
//
// Format-fanout-regex-sync rule: the template lives ONCE; tests import the
// const rather than re-declaring the multi-line string. A future contributor
// editing the template doesn't have to chase test fixtures.
//
// Race-defense (T-NOTICE-RACE-1 / research § Pitfall 4):
//   `consumeAutoDemoNotice()` sets `firstResponseEmitted = true` BEFORE
//   returning the template. Node's single-threaded event loop means two
//   concurrent CallToolRequest dispatches CANNOT both see the unset flag —
//   the first synchronous read-and-set wins; the second sees `true` and
//   returns null. Test 2 in `test/notice.test.ts` locks this with
//   `Promise.all([consumeAutoDemoNotice(), …])` — exactly one result equals
//   the template.

export const AUTO_DEMO_NOTICE_TEMPLATE: string = [
  "VAULTPILOT NOTICE — Auto demo mode active",
  "",
  "  No config file at ~/.vaultpilot-mcp/config.json and VAULTPILOT_DEMO is unset.",
  "  Booting into demo mode with curated personas. Read tools work against real",
  "  Ethereum RPC against the active persona's address; signing tools simulate",
  "  via eth_call and never broadcast.",
  "",
  "  Active persona seed: whale (vitalik.eth). Switch via:",
  "    set_demo_wallet({ persona: \"whale\" | \"defi-degen\" | \"stable-saver\" | \"staking-maxi\" })",
  "",
  "  To exit demo mode: set VAULTPILOT_DEMO=false in your env, OR create",
  "  ~/.vaultpilot-mcp/config.json with { \"demo\": false }.",
].join("\n");

let firstResponseEmitted = false;

/**
 * Returns the AUTO_DEMO NOTICE block on the FIRST call only; `null` on every
 * subsequent call within the same process. Sets the flag BEFORE returning,
 * not after — defense against the race condition where two concurrent tool
 * dispatches both check the flag, both see `false`, and both return the
 * template. The first wins; the second gets `null`. Node's single-threaded
 * event loop makes this byte-deterministic.
 */
export function consumeAutoDemoNotice(): string | null {
  if (firstResponseEmitted) return null;
  firstResponseEmitted = true; // Pitfall 4 mitigation: set BEFORE returning
  return AUTO_DEMO_NOTICE_TEMPLATE;
}

/**
 * Test-only helper. Production code MUST NOT call this — the "first response"
 * is a once-per-process semantic. Tests use this to restart the flag between
 * scenarios.
 */
export function _resetAutoDemoNoticeForTesting(): void {
  firstResponseEmitted = false;
}
