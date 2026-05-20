// src/config/env.ts — `getSolanaRpcUrl()` reader (Phase 11 Plan 11-02).
//
// Mirrors `test/config-env.test.ts` for the EVM RPC URL readers, but the
// return shape is plan-locked to `string | null` (NOT `undefined`) — the
// downstream consumer in `src/chains/solana/registry.ts::resolveSolanaRpcUrl`
// pattern-matches on `null` to switch to the public fallback arm.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSolanaRpcUrl } from "../src/config/env.js";

const ENV_KEYS = ["SOLANA_RPC_URL"] as const;

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

describe("src/config/env.ts — getSolanaRpcUrl (Phase 11 Plan 11-02)", () => {
  it("Test 1 — returns null when SOLANA_RPC_URL unset", () => {
    expect(getSolanaRpcUrl()).toBeNull();
  });

  it("Test 2 — returns the trimmed value when set", () => {
    process.env.SOLANA_RPC_URL = "  https://my-solana.example/rpc  ";
    expect(getSolanaRpcUrl()).toBe("https://my-solana.example/rpc");
  });

  it("Test 3 — returns null for empty / whitespace-only values", () => {
    process.env.SOLANA_RPC_URL = "";
    expect(getSolanaRpcUrl()).toBeNull();
    process.env.SOLANA_RPC_URL = "   ";
    expect(getSolanaRpcUrl()).toBeNull();
    process.env.SOLANA_RPC_URL = "\n\t";
    expect(getSolanaRpcUrl()).toBeNull();
  });

  it("Test 4 — return type is string | null (NOT undefined) — downstream null-arm matters", () => {
    // Sanity: unset → null. The Solana registry's `resolveSolanaRpcUrl`
    // pattern-matches on `null` (not `undefined`) to flip to the public
    // fallback arm; if this helper drifted to `undefined`, the fallback
    // would silently no-op.
    const v = getSolanaRpcUrl();
    expect(v === null).toBe(true);
    expect(v).not.toBeUndefined();
  });
});
