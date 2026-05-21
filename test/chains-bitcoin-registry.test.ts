// src/chains/bitcoin/registry.ts — lazy Esplora URL singleton (Phase 22
// Plan 22-01). Mirror of `test/chains-tron-registry.test.ts` shape,
// narrowed to the single-endpoint Esplora resolution (env override +
// public blockstream.info fallback; no shorthand fan-out).
//
// Coverage:
//   1. Env override wins (`BTC_ESPLORA_URL` → registry returns that URL)
//   2. Public Esplora fallback (env unset → `blockstream.info/api`)
//   3. Once-per-process warn-latch (first fallback call warns; second
//      does NOT re-warn)
//   4. Lazy memoization (two calls return the same cached URL)
//   5. `_resetBitcoinRegistryForTesting` clears cache AND warn-latch
//   6. `_bitcoinRegistry` ESM spy-affordance — vi.spyOn intercepts (proves
//      the indirection works; direct ESM module spies would silently
//      no-op per CLAUDE.md)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PUBLIC_ESPLORA_FALLBACK,
  _bitcoinRegistry,
  _resetBitcoinRegistryForTesting,
  getEsploraBaseUrl,
} from "../src/chains/bitcoin/registry.js";

const ENV_KEYS = ["BTC_ESPLORA_URL"] as const;

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
  _resetBitcoinRegistryForTesting();
  captureStderr();
});

afterEach(() => {
  restoreStderr();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetBitcoinRegistryForTesting();
  vi.restoreAllMocks();
});

describe("src/chains/bitcoin/registry.ts — resolution priority", () => {
  it("Test 1 — BTC_ESPLORA_URL env override wins: getEsploraBaseUrl() returns that URL; no fallback warn fires", () => {
    process.env.BTC_ESPLORA_URL = "https://custom.esplora.example/api";
    const url = getEsploraBaseUrl();
    expect(url).toBe("https://custom.esplora.example/api");
    expect(stderrBuf).not.toMatch(/public Esplora fallback/);
  });

  it("Test 2 — public Esplora fallback fires when env unset: getEsploraBaseUrl() returns `blockstream.info/api`; stderr warn fires once", () => {
    const url = getEsploraBaseUrl();
    expect(url).toBe(PUBLIC_ESPLORA_FALLBACK);
    expect(PUBLIC_ESPLORA_FALLBACK).toBe("https://blockstream.info/api");
    expect(stderrBuf).toMatch(/Using public Esplora fallback/);
    expect(stderrBuf).toMatch(/https:\/\/blockstream\.info\/api/);
    expect(stderrBuf).toMatch(/set BTC_ESPLORA_URL for production reliability/);
  });

  it("Test 3 — once-per-process warn-latch: subsequent getEsploraBaseUrl() calls do NOT re-warn", () => {
    getEsploraBaseUrl();
    const after1 = stderrBuf;
    expect(stderrBuf).toMatch(/Using public Esplora fallback/);
    getEsploraBaseUrl();
    getEsploraBaseUrl();
    expect(stderrBuf).toBe(after1);
    const matches = (stderrBuf.match(/Using public Esplora fallback/g) ?? [])
      .length;
    expect(matches).toBe(1);
  });
});

describe("src/chains/bitcoin/registry.ts — lazy memoization", () => {
  it("Test 4 — two getEsploraBaseUrl() calls return the SAME URL (memoization)", () => {
    const a = getEsploraBaseUrl();
    const b = getEsploraBaseUrl();
    expect(a).toBe(b);
  });

  it("Test 4b — env override + memoization: second call after env-override resolution returns same URL", () => {
    process.env.BTC_ESPLORA_URL = "https://custom.example/api";
    const a = getEsploraBaseUrl();
    const b = getEsploraBaseUrl();
    expect(a).toBe(b);
    expect(a).toBe("https://custom.example/api");
  });
});

describe("src/chains/bitcoin/registry.ts — reset helper", () => {
  it("Test 5 — _resetBitcoinRegistryForTesting clears cache AND warn-latch (re-warns after reset)", () => {
    getEsploraBaseUrl();
    expect(stderrBuf).toMatch(/Using public Esplora fallback/);
    _resetBitcoinRegistryForTesting();
    stderrBuf = "";
    getEsploraBaseUrl();
    expect(stderrBuf).toMatch(/Using public Esplora fallback/);
  });

  it("Test 5b — reset clears the cached URL (env-override case)", () => {
    process.env.BTC_ESPLORA_URL = "https://first.example/api";
    expect(getEsploraBaseUrl()).toBe("https://first.example/api");
    _resetBitcoinRegistryForTesting();
    process.env.BTC_ESPLORA_URL = "https://second.example/api";
    expect(getEsploraBaseUrl()).toBe("https://second.example/api");
  });
});

describe("src/chains/bitcoin/registry.ts — ESM spy-affordance (_bitcoinRegistry)", () => {
  it("Test 6 — vi.spyOn(_bitcoinRegistry, 'getEsploraBaseUrl') intercepts when consumers route through the indirection (proves ESM spy seam)", () => {
    const spy = vi
      .spyOn(_bitcoinRegistry, "getEsploraBaseUrl")
      .mockReturnValue("https://intercepted.example/api");

    const result = _bitcoinRegistry.getEsploraBaseUrl();
    expect(spy).toHaveBeenCalled();
    expect(result).toBe("https://intercepted.example/api");
  });

  it("Test 6b — _bitcoinRegistry exposes the three public surface members", () => {
    expect(typeof _bitcoinRegistry.getEsploraBaseUrl).toBe("function");
    expect(typeof _bitcoinRegistry.getResolvedEsploraUrl).toBe("function");
    expect(typeof _bitcoinRegistry.getBtcEsploraUrl).toBe("function");
  });

  it("Test 6c — getResolvedEsploraUrl is an alias for getEsploraBaseUrl (diagnostics surface; Plan 22-04 anchor)", () => {
    process.env.BTC_ESPLORA_URL = "https://alias.example/api";
    expect(_bitcoinRegistry.getResolvedEsploraUrl()).toBe(
      _bitcoinRegistry.getEsploraBaseUrl(),
    );
  });
});
