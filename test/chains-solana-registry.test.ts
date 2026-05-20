// src/chains/solana/registry.ts — lazy `Connection` singleton (Phase 11
// Plan 11-02). Mirror of `test/chains-registry.test.ts` shape narrowed to
// the single-cluster Solana resolution (env override + public fallback;
// no shorthand fan-out).
//
// Coverage:
//   1. Env override wins (`SOLANA_RPC_URL` → Connection wraps that URL)
//   2. Public RPC fallback (env unset → `api.mainnet-beta.solana.com`)
//   3. Once-per-process warn-latch (first fallback call warns; second
//      does NOT re-warn)
//   4. Lazy singleton (two calls return the same Connection reference)
//   5. `_resetSolanaRegistryForTesting` clears cache AND warn-latch
//   6. `_solanaRegistry` ESM spy-affordance — vi.spyOn intercepts (proves
//      the indirection works; direct ESM module spies would silently
//      no-op per CLAUDE.md)
//   7. `getResolvedRpcUrl()` returns the cached URL after first
//      getConnection() call

import { Connection } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PUBLIC_RPC_FALLBACK,
  _resetSolanaRegistryForTesting,
  _solanaRegistry,
  getConnection,
  getResolvedRpcUrl,
} from "../src/chains/solana/registry.js";

const ENV_KEYS = ["SOLANA_RPC_URL"] as const;

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
  _resetSolanaRegistryForTesting();
  captureStderr();
});

afterEach(() => {
  restoreStderr();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetSolanaRegistryForTesting();
  vi.restoreAllMocks();
});

describe("src/chains/solana/registry.ts — resolution priority", () => {
  it("Test 1 — SOLANA_RPC_URL env override wins: getConnection() wraps that URL; no fallback warn fires", () => {
    process.env.SOLANA_RPC_URL = "https://custom-solana.example/rpc";
    const conn = getConnection();
    expect(conn).toBeInstanceOf(Connection);
    // `Connection.rpcEndpoint` is a public field surfacing the constructed URL.
    expect(conn.rpcEndpoint).toBe("https://custom-solana.example/rpc");
    expect(stderrBuf).not.toMatch(/public Solana RPC fallback/);
  });

  it("Test 2 — public RPC fallback fires when env unset: getConnection() wraps `api.mainnet-beta.solana.com`; stderr warn fires once", () => {
    const conn = getConnection();
    expect(conn).toBeInstanceOf(Connection);
    expect(conn.rpcEndpoint).toBe(PUBLIC_RPC_FALLBACK);
    expect(PUBLIC_RPC_FALLBACK).toBe("https://api.mainnet-beta.solana.com");
    expect(stderrBuf).toMatch(/Using public Solana RPC fallback/);
    expect(stderrBuf).toMatch(/https:\/\/api\.mainnet-beta\.solana\.com/);
    expect(stderrBuf).toMatch(/set SOLANA_RPC_URL for production reliability/);
  });

  it("Test 3 — once-per-process warn-latch: second getConnection() call does NOT re-warn", () => {
    getConnection();
    const after1 = stderrBuf;
    expect(stderrBuf).toMatch(/Using public Solana RPC fallback/);
    getConnection();
    getConnection();
    expect(stderrBuf).toBe(after1);
    const matches = (stderrBuf.match(/Using public Solana RPC fallback/g) ?? [])
      .length;
    expect(matches).toBe(1);
  });
});

describe("src/chains/solana/registry.ts — lazy singleton", () => {
  it("Test 4 — two getConnection() calls return the SAME Connection reference (memoization)", () => {
    const a = getConnection();
    const b = getConnection();
    expect(a).toBe(b);
  });

  it("Test 4b — env override + memoization: second call after env-override resolution returns same instance", () => {
    process.env.SOLANA_RPC_URL = "https://custom.example/rpc";
    const a = getConnection();
    const b = getConnection();
    expect(a).toBe(b);
    expect(a.rpcEndpoint).toBe("https://custom.example/rpc");
  });
});

describe("src/chains/solana/registry.ts — reset helper", () => {
  it("Test 5 — _resetSolanaRegistryForTesting clears cache AND warn-latch (re-warns after reset)", () => {
    getConnection();
    expect(stderrBuf).toMatch(/Using public Solana RPC fallback/);
    _resetSolanaRegistryForTesting();
    stderrBuf = "";
    getConnection();
    expect(stderrBuf).toMatch(/Using public Solana RPC fallback/);
  });

  it("Test 5b — reset clears the cached Connection (new instance after reset)", () => {
    const a = getConnection();
    _resetSolanaRegistryForTesting();
    const b = getConnection();
    expect(a).not.toBe(b);
  });
});

describe("src/chains/solana/registry.ts — ESM spy-affordance (_solanaRegistry)", () => {
  it("Test 6 — vi.spyOn(_solanaRegistry, 'getConnection') intercepts when consumers route through the indirection (proves ESM spy seam)", () => {
    const stub = { stubMarker: "intercepted" } as unknown as Connection;
    const spy = vi
      .spyOn(_solanaRegistry, "getConnection")
      .mockReturnValue(stub);

    const result = _solanaRegistry.getConnection();
    expect(spy).toHaveBeenCalled();
    expect(result).toBe(stub);
    expect((result as unknown as { stubMarker: string }).stubMarker).toBe(
      "intercepted",
    );
  });

  it("Test 6b — _solanaRegistry exposes the three public surface members", () => {
    expect(typeof _solanaRegistry.getConnection).toBe("function");
    expect(typeof _solanaRegistry.getResolvedRpcUrl).toBe("function");
    expect(typeof _solanaRegistry.getSolanaRpcUrl).toBe("function");
  });
});

describe("src/chains/solana/registry.ts — getResolvedRpcUrl", () => {
  it("Test 7 — getResolvedRpcUrl returns the cached URL after the first getConnection() call (env override case)", () => {
    process.env.SOLANA_RPC_URL = "https://my-solana.example/rpc";
    getConnection();
    expect(getResolvedRpcUrl()).toBe("https://my-solana.example/rpc");
  });

  it("Test 7b — getResolvedRpcUrl lazy-evaluates: returns the public fallback URL when called before getConnection()", () => {
    // No prior getConnection() — getResolvedRpcUrl must trigger
    // resolution + return the fallback URL deterministically.
    const url = getResolvedRpcUrl();
    expect(url).toBe(PUBLIC_RPC_FALLBACK);
    // The warn fires as a side effect of the lazy resolution.
    expect(stderrBuf).toMatch(/Using public Solana RPC fallback/);
  });
});
