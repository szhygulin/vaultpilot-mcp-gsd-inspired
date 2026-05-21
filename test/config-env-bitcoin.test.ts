// src/config/env.ts — `getBtcEsploraUrl()` reader (Phase 22 Plan 22-01).
//
// Mirrors `test/config-env-tron.test.ts` byte-for-byte. The return shape
// is plan-locked to `string | null` (NOT `undefined`) — the downstream
// consumer in `src/chains/bitcoin/registry.ts::resolveEsploraUrl`
// pattern-matches on `null` to switch to the public Esplora fallback arm.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getBtcEsploraUrl } from "../src/config/env.js";

const ENV_KEYS = ["BTC_ESPLORA_URL"] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("src/config/env.ts — getBtcEsploraUrl (Phase 22 Plan 22-01)", () => {
  it("Test 1 — returns null when BTC_ESPLORA_URL unset", () => {
    expect(getBtcEsploraUrl()).toBeNull();
  });

  it("Test 2 — returns the trimmed value when set", () => {
    process.env.BTC_ESPLORA_URL = "  https://my.esplora.example/api  ";
    expect(getBtcEsploraUrl()).toBe("https://my.esplora.example/api");
  });

  it("Test 3 — returns null for empty / whitespace-only values", () => {
    process.env.BTC_ESPLORA_URL = "";
    expect(getBtcEsploraUrl()).toBeNull();
    process.env.BTC_ESPLORA_URL = "   ";
    expect(getBtcEsploraUrl()).toBeNull();
    process.env.BTC_ESPLORA_URL = "\n\t";
    expect(getBtcEsploraUrl()).toBeNull();
  });

  it("Test 4 — return type is string | null (NOT undefined) — downstream null-arm matters", () => {
    // Sanity: unset → null. The BTC registry's `resolveEsploraUrl`
    // pattern-matches on `null` (not `undefined`) to flip to the public
    // fallback arm; if this helper drifted to `undefined`, the fallback
    // would silently no-op.
    const v = getBtcEsploraUrl();
    expect(v === null).toBe(true);
    expect(v).not.toBeUndefined();
  });
});
