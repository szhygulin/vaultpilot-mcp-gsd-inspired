// Update check — Plan 05-03 / DIAG-04.
//
// Fire-and-forget HTTPS GET to `registry.npmjs.org/<pkg>/latest`. Fires
// ONCE per session on the first tool dispatch (NOT on `initialize` —
// research § Pitfall 3: blocking the initialize handshake is observable
// to the client). All failure modes (network unreachable, DNS error, 4xx,
// 5xx, unparseable JSON, AbortController timeout) are silent — an update
// check failure must NEVER surface as an error.
//
// Suppression: `VAULTPILOT_DISABLE_UPDATE_CHECK=1` short-circuits before
// the fetch. The stderr "update available" message itself names this env
// var so devs see the recovery path inline.
//
// Q-NPM upstream collision (research § Q10): `npm view vaultpilot-mcp
// version` returns `0.14.4` — the UPSTREAM project, not this rebuild at
// `0.0.0`. Pre-1.0 dev versions will see noisy "update available" stderr
// logs. The fix is environmental; the suppress-env hint in the warn
// message is the inline recovery path. NO special-case version-prefix
// gating — that would compound the upstream-collision risk.
//
// All diagnostics through `src/diagnostics/logger.ts` → stderr. Stdout
// carries the MCP protocol; crossing wires breaks the client.

import { log } from "./logger.js";

const NPM_REGISTRY_URL = "https://registry.npmjs.org";
const TIMEOUT_MS = 2000;

let fired = false;

/**
 * Fire-and-forget update check. Returns synchronously (void); the fetch
 * runs in the background and NEVER blocks the caller. Once-per-process —
 * subsequent calls are no-ops.
 *
 * Suppress via `VAULTPILOT_DISABLE_UPDATE_CHECK=1` (logs the suppression
 * to stderr at info level so devs see why the check didn't fire).
 */
export function runUpdateCheckOnce(
  currentVersion: string,
  packageName: string,
): void {
  if (fired) return;
  fired = true;
  if (process.env.VAULTPILOT_DISABLE_UPDATE_CHECK === "1") {
    log("info", "update check suppressed (VAULTPILOT_DISABLE_UPDATE_CHECK=1)");
    return;
  }
  // Fire-and-forget; never block the caller. The catch is defense-in-depth
  // — `doFetch` is already silent on every failure mode, but a future
  // contributor that throws synchronously inside it would otherwise produce
  // an unhandled rejection.
  doFetch(packageName, currentVersion).catch(() => {
    // Silent — network down should NEVER surface as an error.
  });
}

async function doFetch(packageName: string, currentVersion: string): Promise<void> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}/latest`;
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
  } catch {
    return; // network / abort — silent
  }
  if (!response.ok) return; // 4xx/5xx — silent
  let body: { version?: unknown };
  try {
    body = (await response.json()) as { version?: unknown };
  } catch {
    return; // unparseable JSON — silent
  }
  if (typeof body.version !== "string") return;
  if (body.version === currentVersion) {
    log("info", `vaultpilot-mcp is up to date (v${currentVersion})`);
    return;
  }
  // Q-NPM acknowledged: pre-1.0 dev versions will see noisy "update
  // available" because npm view vaultpilot-mcp returns 0.14.4 (upstream
  // collision). Suppressible via VAULTPILOT_DISABLE_UPDATE_CHECK=1 — the
  // hint is named inline so devs see the recovery path.
  log(
    "warn",
    `vaultpilot-mcp v${currentVersion} → v${body.version} available; run \`npm i -g vaultpilot-mcp\` to update (set VAULTPILOT_DISABLE_UPDATE_CHECK=1 to suppress)`,
  );
}

/**
 * Test-only helper. Production code MUST NOT call this — the "fired" flag
 * is a once-per-process semantic. Tests use this to restart between
 * scenarios.
 */
export function _resetUpdateCheckForTesting(): void {
  fired = false;
}
