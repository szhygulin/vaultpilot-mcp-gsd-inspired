// src/config/env.ts — `getTronRpcUrl()` reader (Phase 17 Plan 17-01).
//
// Mirrors `test/config-env-solana.test.ts` byte-for-byte. The return
// shape is plan-locked to `string | null` (NOT `undefined`) — the
// downstream consumer in `src/chains/tron/registry.ts::resolveTronRpcUrl`
// pattern-matches on `null` to switch to the public TronGrid fallback arm.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getTronRpcUrl } from "../src/config/env.js";

const ENV_KEYS = ["TRON_RPC_URL"] as const;

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

describe("src/config/env.ts — getTronRpcUrl (Phase 17 Plan 17-01)", () => {
  it("Test 1 — returns null when TRON_RPC_URL unset", () => {
    expect(getTronRpcUrl()).toBeNull();
  });

  it("Test 2 — returns the trimmed value when set", () => {
    process.env.TRON_RPC_URL = "  https://my.tron.node  ";
    expect(getTronRpcUrl()).toBe("https://my.tron.node");
  });

  it("Test 3 — returns null for empty / whitespace-only values", () => {
    process.env.TRON_RPC_URL = "";
    expect(getTronRpcUrl()).toBeNull();
    process.env.TRON_RPC_URL = "   ";
    expect(getTronRpcUrl()).toBeNull();
    process.env.TRON_RPC_URL = "\n\t";
    expect(getTronRpcUrl()).toBeNull();
  });

  it("Test 4 — return type is string | null (NOT undefined) — downstream null-arm matters", () => {
    // Sanity: unset → null. The TRON registry's `resolveTronRpcUrl`
    // pattern-matches on `null` (not `undefined`) to flip to the public
    // fallback arm; if this helper drifted to `undefined`, the fallback
    // would silently no-op.
    const v = getTronRpcUrl();
    expect(v === null).toBe(true);
    expect(v).not.toBeUndefined();
  });
});
