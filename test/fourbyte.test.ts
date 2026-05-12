// Plan 04-05 Task 1 — 4byte.directory client tests (PREP-06).
//
// Tests assert the four-kind discriminated union (`not-applicable` / `found` /
// `not-found` / `error`) — `error` NEVER collapses to `not-found` (T-4BYTE-MASK-1).
// The 1.5s AbortController timeout, LRU cache (256-entry cap, error caching),
// adversarial-input verbatim surfacing, and stderr-only logging are all
// covered. Fetch is stubbed via `vi.stubGlobal("fetch", ...)`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";

import {
  _resetFourbyteCacheForTesting,
  lookupSelector,
  type FourbyteResult,
} from "../src/clients/fourbyte.js";

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
}): ReturnType<typeof vi.fn> {
  return vi.fn(async (_input: unknown, init?: { signal?: AbortSignal }) => {
    if (opts.hang) {
      // Resolve only when the abort signal fires; throw `AbortError` to match
      // the real `fetch` behavior under AbortController.
      return new Promise<MockResponse>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The user aborted a request.");
          err.name = "AbortError";
          reject(err);
        });
      });
    }
    if (opts.reject) throw opts.reject;
    return {
      ok: opts.ok ?? true,
      status: opts.status,
      json: async () => opts.payload,
    } satisfies MockResponse;
  });
}

beforeEach(() => {
  _resetFourbyteCacheForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  _resetFourbyteCacheForTesting();
});

describe("lookupSelector — not-applicable for null selector (PREP-06)", () => {
  it("returns kind: 'not-applicable' synchronously and does NOT call fetch", async () => {
    const fetchMock = buildFetch({ payload: { count: 0, results: [] } });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupSelector(null);

    expect(result.kind).toBe("not-applicable");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

describe("lookupSelector — found happy path (T-4BYTE-1, PREP-06)", () => {
  it("returns kind: 'found' with the first result's text_signature", async () => {
    const fetchMock = buildFetch({
      payload: {
        count: 1,
        results: [
          {
            id: 31781,
            text_signature: "transfer(address,uint256)",
            hex_signature: "0xa9059cbb",
          },
        ],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupSelector("0xa9059cbb" as Hex);

    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.textSignature).toBe("transfer(address,uint256)");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toBe(
      "https://www.4byte.directory/api/v1/signatures/?hex_signature=0xa9059cbb",
    );
  });
});

describe("lookupSelector — not-found for empty results", () => {
  it("returns kind: 'not-found' when 200 OK and results is empty", async () => {
    const fetchMock = buildFetch({ payload: { count: 0, results: [] } });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupSelector("0xdeadbeef" as Hex);

    expect(result.kind).toBe("not-found");
  });
});

describe("lookupSelector — error for HTTP 5xx (T-4BYTE-MASK-1)", () => {
  it("returns kind: 'error' (NEVER 'not-found') with verbatim status message", async () => {
    const fetchMock = buildFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupSelector("0xa9059cbb" as Hex);

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("4byte.directory returned HTTP 503");
    }
  });
});

describe("lookupSelector — error for AbortController timeout (T-4BYTE-2, T-4BYTE-MASK-1)", () => {
  it("aborts at 1.5s and returns kind: 'error' with verbatim timeout message", async () => {
    vi.useFakeTimers();
    const fetchMock = buildFetch({ hang: true });
    vi.stubGlobal("fetch", fetchMock);

    const promise = lookupSelector("0xa9059cbb" as Hex);
    // Advance to the timeout boundary. `setTimeout` fires `controller.abort()`,
    // which rejects the hung fetch promise with AbortError.
    await vi.advanceTimersByTimeAsync(1501);

    const result = await promise;

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("4byte.directory unreachable (timeout 1.5s)");
    }
  });
});

describe("lookupSelector — error for network unreachable (T-4BYTE-MASK-1)", () => {
  it("returns kind: 'error' with verbatim upstream message", async () => {
    const fetchMock = buildFetch({ reject: new Error("getaddrinfo ENOTFOUND") });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupSelector("0xa9059cbb" as Hex);

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe(
        "4byte.directory unreachable: getaddrinfo ENOTFOUND",
      );
    }
  });
});

describe("lookupSelector — LRU cache hit", () => {
  it("returns the cached result on the second call (single network call)", async () => {
    const fetchMock = buildFetch({
      payload: {
        count: 1,
        results: [
          { text_signature: "transfer(address,uint256)", hex_signature: "0xa9059cbb" },
        ],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await lookupSelector("0xa9059cbb" as Hex);
    const second = await lookupSelector("0xa9059cbb" as Hex);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("lookupSelector — LRU cache evicts at 257th distinct selector", () => {
  it("re-fetches the first selector after 256 more distinct selectors fill the cache", async () => {
    // Build a fetch that always returns a fresh `found` keyed by the URL.
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      const selectorMatch = url.match(/hex_signature=(0x[0-9a-fA-F]+)/);
      const selector = selectorMatch?.[1] ?? "0x00000000";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          count: 1,
          results: [{ text_signature: `fn_${selector}()`, hex_signature: selector }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    // 1st selector — fills slot 1.
    const first: Hex = "0x10000000";
    await lookupSelector(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Confirm cache hit on second call to `first`.
    await lookupSelector(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Fill the remaining 255 cache slots with distinct selectors → cache now
    // holds 256 entries (slot 1 = `first`, slots 2..256 = these new ones).
    for (let i = 0; i < 255; i++) {
      const hex = `0x2${i.toString(16).padStart(7, "0")}` as Hex;
      await lookupSelector(hex);
    }
    expect(fetchMock).toHaveBeenCalledTimes(256);

    // Insert the 257th distinct selector — cache is FULL, so the oldest entry
    // (`first`) gets evicted per insertion-order LRU.
    await lookupSelector("0x30000000" as Hex);
    expect(fetchMock).toHaveBeenCalledTimes(257);

    // `first` is no longer cached: this call fetches again.
    await lookupSelector(first);
    expect(fetchMock).toHaveBeenCalledTimes(258);
  });
});

describe("lookupSelector — error results are cached (T-4BYTE-2)", () => {
  it("two calls to a 5xx-returning endpoint result in a single fetch", async () => {
    const fetchMock = buildFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const first = await lookupSelector("0xa9059cbb" as Hex);
    const second = await lookupSelector("0xa9059cbb" as Hex);

    expect(first.kind).toBe("error");
    expect(second.kind).toBe("error");
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("lookupSelector — adversarial text_signature surfaces verbatim (T-4BYTE-1)", () => {
  it("returns the text_signature character-for-character — never parsed, never sanitized", async () => {
    const adversarial = "transfer(address,uint256) /* injected */";
    const fetchMock = buildFetch({
      payload: {
        count: 1,
        results: [{ text_signature: adversarial, hex_signature: "0xa9059cbb" }],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupSelector("0xa9059cbb" as Hex);

    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.textSignature).toBe(adversarial);
    }
  });
});

describe("lookupSelector — no console.* writes (stderr-only via logger)", () => {
  it("triggers an error path and asserts no console.log / console.warn / console.error call", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = buildFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const result: FourbyteResult = await lookupSelector("0xa9059cbb" as Hex);
    expect(result.kind).toBe("error");

    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
