// Plan 05-03 — update check tests (DIAG-04 + T-UPDATE-CHECK-DOS-1).
//
// Seven cases:
//   1. 5xx response → silent
//   2. Network failure / AbortError → silent
//   3. Unparseable JSON → silent
//   4. Suppress env (`VAULTPILOT_DISABLE_UPDATE_CHECK=1`) → no fetch call
//   5. Once-per-session — second call skipped
//   6. Version match → "up to date" info log
//   7. Version mismatch → "update available" warn log + fire-and-forget
//      timing (call returns < 10ms even with hanging fetch)
//
// `vi.stubGlobal("fetch", ...)` mocks the global fetch. `vi.spyOn(
// process.stderr, "write")` captures stderr output for log-message
// assertions. Each test that triggers a fetch path needs a `setImmediate`
// tick to let the fire-and-forget catch run before assertions.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetUpdateCheckForTesting,
  runUpdateCheckOnce,
} from "../src/diagnostics/update-check.js";

const SUPPRESS_KEY = "VAULTPILOT_DISABLE_UPDATE_CHECK";
let savedSuppress: string | undefined;

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

function buildFetch(opts: {
  ok?: boolean;
  status?: number;
  payload?: unknown;
  reject?: Error;
  hang?: boolean;
  jsonReject?: Error;
  delayMs?: number;
}): ReturnType<typeof vi.fn> {
  return vi.fn(async (_input: unknown, init?: { signal?: AbortSignal }) => {
    if (opts.hang) {
      return new Promise<MockResponse>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The user aborted a request.");
          err.name = "AbortError";
          reject(err);
        });
      });
    }
    if (opts.reject) throw opts.reject;
    if (opts.delayMs && opts.delayMs > 0) {
      await new Promise((r) => setTimeout(r, opts.delayMs));
    }
    return {
      ok: opts.ok ?? true,
      status: opts.status,
      json: opts.jsonReject
        ? async () => {
            throw opts.jsonReject as Error;
          }
        : async () => opts.payload,
    } satisfies MockResponse;
  });
}

function captureStderr(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const spy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
  return {
    writes,
    restore: () => spy.mockRestore(),
  };
}

async function flushMicrotasks(): Promise<void> {
  // Let the fire-and-forget `doFetch(...).catch(...)` run.
  await new Promise((r) => setImmediate(r));
  // A second tick for the inner `await response.json()`.
  await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  savedSuppress = process.env[SUPPRESS_KEY];
  delete process.env[SUPPRESS_KEY];
  _resetUpdateCheckForTesting();
});

afterEach(() => {
  if (savedSuppress === undefined) delete process.env[SUPPRESS_KEY];
  else process.env[SUPPRESS_KEY] = savedSuppress;
  _resetUpdateCheckForTesting();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runUpdateCheckOnce — 5xx response is silent", () => {
  it("Test 1 — 5xx → no info/warn log, no thrown error", async () => {
    const fetchMock = buildFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const stderr = captureStderr();

    runUpdateCheckOnce("0.0.0", "vaultpilot-mcp");
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stderrText = stderr.writes.join("");
    expect(stderrText).not.toContain("up to date");
    expect(stderrText).not.toContain("available");
    stderr.restore();
  });
});

describe("runUpdateCheckOnce — network failure / AbortError silent", () => {
  it("Test 2 — fetch rejects → silent", async () => {
    const err = new Error("ECONNREFUSED");
    const fetchMock = buildFetch({ reject: err });
    vi.stubGlobal("fetch", fetchMock);
    const stderr = captureStderr();

    runUpdateCheckOnce("0.0.0", "vaultpilot-mcp");
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stderrText = stderr.writes.join("");
    expect(stderrText).not.toContain("up to date");
    expect(stderrText).not.toContain("available");
    expect(stderrText).not.toContain("ECONNREFUSED");
    stderr.restore();
  });
});

describe("runUpdateCheckOnce — unparseable JSON silent", () => {
  it("Test 3 — response.json() rejects → silent", async () => {
    const fetchMock = buildFetch({
      ok: true,
      jsonReject: new Error("not json"),
    });
    vi.stubGlobal("fetch", fetchMock);
    const stderr = captureStderr();

    runUpdateCheckOnce("0.0.0", "vaultpilot-mcp");
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stderrText = stderr.writes.join("");
    expect(stderrText).not.toContain("up to date");
    expect(stderrText).not.toContain("available");
    stderr.restore();
  });
});

describe("runUpdateCheckOnce — VAULTPILOT_DISABLE_UPDATE_CHECK=1 short-circuits", () => {
  it("Test 4 — suppress env → no fetch; stderr names the suppression", async () => {
    process.env[SUPPRESS_KEY] = "1";
    const fetchMock = buildFetch({ ok: true, payload: { version: "0.14.4" } });
    vi.stubGlobal("fetch", fetchMock);
    const stderr = captureStderr();

    runUpdateCheckOnce("0.0.0", "vaultpilot-mcp");
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(stderr.writes.join("")).toMatch(/update check suppressed/);
    stderr.restore();
  });
});

describe("runUpdateCheckOnce — once-per-session", () => {
  it("Test 5 — second call skipped (module-scoped fired flag)", async () => {
    const fetchMock = buildFetch({ ok: true, payload: { version: "0.0.0" } });
    vi.stubGlobal("fetch", fetchMock);
    const stderr = captureStderr();

    runUpdateCheckOnce("0.0.0", "vaultpilot-mcp");
    runUpdateCheckOnce("0.0.0", "vaultpilot-mcp");
    runUpdateCheckOnce("0.0.0", "vaultpilot-mcp");
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    stderr.restore();
  });
});

describe("runUpdateCheckOnce — version match → 'up to date' info log", () => {
  it("Test 6 — body.version === currentVersion → info log", async () => {
    const fetchMock = buildFetch({ ok: true, payload: { version: "0.0.0" } });
    vi.stubGlobal("fetch", fetchMock);
    const stderr = captureStderr();

    runUpdateCheckOnce("0.0.0", "vaultpilot-mcp");
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stderr.writes.join("")).toMatch(/up to date \(v0\.0\.0\)/);
    stderr.restore();
  });
});

describe("runUpdateCheckOnce — version mismatch + fire-and-forget timing (T-UPDATE-CHECK-DOS-1)", () => {
  it("Test 7 — call returns < 10ms even when fetch hangs; warn log names suppress env", async () => {
    // Fetch resolves after 100ms with a newer version. The
    // `runUpdateCheckOnce` call must NOT block — it returns synchronously.
    const fetchMock = buildFetch({
      ok: true,
      payload: { version: "0.14.4" },
      delayMs: 100,
    });
    vi.stubGlobal("fetch", fetchMock);
    const stderr = captureStderr();

    const t0 = Date.now();
    runUpdateCheckOnce("0.0.0", "vaultpilot-mcp");
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(10);

    // Wait long enough for the delayed fetch to resolve and the inner
    // `await response.json()` + `log("warn", ...)` to run.
    await new Promise((r) => setTimeout(r, 200));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("registry.npmjs.org/vaultpilot-mcp/latest"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const stderrText = stderr.writes.join("");
    expect(stderrText).toMatch(/v0\.0\.0.*0\.14\.4 available/);
    expect(stderrText).toMatch(/VAULTPILOT_DISABLE_UPDATE_CHECK/);
    stderr.restore();
  });
});
