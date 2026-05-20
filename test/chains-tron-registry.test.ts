// src/chains/tron/registry.ts — lazy `TronWeb` singleton (Phase 17
// Plan 17-01). Mirror of `test/chains-solana-registry.test.ts` shape,
// narrowed to the single-cluster TRON resolution (env override + public
// TronGrid fallback; no shorthand fan-out).
//
// Coverage:
//   1. Env override wins (`TRON_RPC_URL` → TronWeb wraps that URL)
//   2. Public RPC fallback (env unset → `api.trongrid.io`)
//   3. Once-per-process warn-latch (first fallback call warns; second
//      does NOT re-warn)
//   4. Lazy singleton (two calls return the same TronWeb reference)
//   5. `_resetTronRegistryForTesting` clears cache AND warn-latch
//   6. `_tronRegistry` ESM spy-affordance — vi.spyOn intercepts (proves
//      the indirection works; direct ESM module spies would silently
//      no-op per CLAUDE.md)
//   7. `getResolvedRpcUrl()` returns the cached URL after first
//      getTronWeb() call

import { TronWeb } from "tronweb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PUBLIC_RPC_FALLBACK,
  _resetTronRegistryForTesting,
  _tronRegistry,
  getResolvedRpcUrl,
  getTronWeb,
} from "../src/chains/tron/registry.js";

const ENV_KEYS = ["TRON_RPC_URL"] as const;

const saved: Record<string, string | undefined> = {};
let stderrBuf: string;
let originalStderrWrite: typeof process.stderr.write;

function captureStderr(): void {
  stderrBuf = "";
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown): boolean => {
    stderrBuf += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  }) as typeof process.stderr.write;
}

function restoreStderr(): void {
  process.stderr.write = originalStderrWrite;
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  _resetTronRegistryForTesting();
  captureStderr();
});

afterEach(() => {
  restoreStderr();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetTronRegistryForTesting();
  vi.restoreAllMocks();
});

describe("src/chains/tron/registry.ts — resolution priority", () => {
  it("Test 1 — TRON_RPC_URL env override wins: getTronWeb() wraps that URL; no fallback warn fires", () => {
    process.env.TRON_RPC_URL = "https://custom-tron.example/rpc";
    const tw = getTronWeb();
    expect(tw).toBeInstanceOf(TronWeb);
    expect(getResolvedRpcUrl()).toBe("https://custom-tron.example/rpc");
    expect(stderrBuf).not.toMatch(/public TRON RPC fallback/);
  });

  it("Test 2 — public RPC fallback fires when env unset: getTronWeb() wraps `api.trongrid.io`; stderr warn fires once", () => {
    const tw = getTronWeb();
    expect(tw).toBeInstanceOf(TronWeb);
    expect(getResolvedRpcUrl()).toBe(PUBLIC_RPC_FALLBACK);
    expect(PUBLIC_RPC_FALLBACK).toBe("https://api.trongrid.io");
    expect(stderrBuf).toMatch(/Using public TRON RPC fallback/);
    expect(stderrBuf).toMatch(/https:\/\/api\.trongrid\.io/);
    expect(stderrBuf).toMatch(/set TRON_RPC_URL for production reliability/);
  });

  it("Test 3 — once-per-process warn-latch: subsequent getTronWeb() calls do NOT re-warn", () => {
    getTronWeb();
    const after1 = stderrBuf;
    expect(stderrBuf).toMatch(/Using public TRON RPC fallback/);
    getTronWeb();
    getTronWeb();
    expect(stderrBuf).toBe(after1);
    const matches = (stderrBuf.match(/Using public TRON RPC fallback/g) ?? [])
      .length;
    expect(matches).toBe(1);
  });
});

describe("src/chains/tron/registry.ts — lazy singleton", () => {
  it("Test 4 — two getTronWeb() calls return the SAME TronWeb reference (memoization)", () => {
    const a = getTronWeb();
    const b = getTronWeb();
    expect(a).toBe(b);
  });

  it("Test 4b — env override + memoization: second call after env-override resolution returns same instance", () => {
    process.env.TRON_RPC_URL = "https://custom.example/rpc";
    const a = getTronWeb();
    const b = getTronWeb();
    expect(a).toBe(b);
    expect(getResolvedRpcUrl()).toBe("https://custom.example/rpc");
  });
});

describe("src/chains/tron/registry.ts — reset helper", () => {
  it("Test 5 — _resetTronRegistryForTesting clears cache AND warn-latch (re-warns after reset)", () => {
    getTronWeb();
    expect(stderrBuf).toMatch(/Using public TRON RPC fallback/);
    _resetTronRegistryForTesting();
    stderrBuf = "";
    getTronWeb();
    expect(stderrBuf).toMatch(/Using public TRON RPC fallback/);
  });

  it("Test 5b — reset clears the cached TronWeb (new instance after reset)", () => {
    const a = getTronWeb();
    _resetTronRegistryForTesting();
    const b = getTronWeb();
    expect(a).not.toBe(b);
  });
});

describe("src/chains/tron/registry.ts — ESM spy-affordance (_tronRegistry)", () => {
  it("Test 6 — vi.spyOn(_tronRegistry, 'getTronWeb') intercepts when consumers route through the indirection (proves ESM spy seam)", () => {
    const stub = { stubMarker: "intercepted" } as unknown as TronWeb;
    const spy = vi
      .spyOn(_tronRegistry, "getTronWeb")
      .mockReturnValue(stub);

    const result = _tronRegistry.getTronWeb();
    expect(spy).toHaveBeenCalled();
    expect(result).toBe(stub);
    expect((result as unknown as { stubMarker: string }).stubMarker).toBe(
      "intercepted",
    );
  });

  it("Test 6b — _tronRegistry exposes the three public surface members", () => {
    expect(typeof _tronRegistry.getTronWeb).toBe("function");
    expect(typeof _tronRegistry.getResolvedRpcUrl).toBe("function");
    expect(typeof _tronRegistry.getTronRpcUrl).toBe("function");
  });
});

describe("src/chains/tron/registry.ts — getResolvedRpcUrl", () => {
  it("Test 7 — getResolvedRpcUrl returns the cached URL after the first getTronWeb() call (env override case)", () => {
    process.env.TRON_RPC_URL = "https://my-tron.example/rpc";
    getTronWeb();
    expect(getResolvedRpcUrl()).toBe("https://my-tron.example/rpc");
  });

  it("Test 7b — getResolvedRpcUrl lazy-evaluates: returns the public fallback URL when called before getTronWeb()", () => {
    // No prior getTronWeb() — getResolvedRpcUrl must trigger
    // resolution + return the fallback URL deterministically.
    const url = getResolvedRpcUrl();
    expect(url).toBe(PUBLIC_RPC_FALLBACK);
    // The warn fires as a side effect of the lazy resolution.
    expect(stderrBuf).toMatch(/Using public TRON RPC fallback/);
  });
});
