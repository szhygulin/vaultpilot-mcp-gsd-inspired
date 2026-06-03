// test/chains-bittensor-rpc.test.ts — Phase 46 Plan 46-01 Task 2.
//
// Covers the src/chains/bittensor/ shelf shape (TAO-R-04 shelf row):
//   - formatRaoToTao pure-bigint formatter edge cases (mirror of
//     formatLamportsToSol — 9 decimals, trailing-zero trim, u128 safe)
//   - assertSs58Address accept (valid prefix-42 "5…") + reject
//     (wrong-checksum / look-alike) via decodeAddress (V5 input gate)
//   - _bittensorRegistry.getResolvedRpcUrl() resolves the env-or-fallback
//     URL STRING WITHOUT forcing a live WS connection (Pitfall 5 — status
//     must never hang offline; getApi must NOT be invoked)
//
// SS58 anchors are deterministic offline derivations via
// encodeAddress(_, 42); pinned in test/chains-bittensor-ss58.test.ts
// (Plan 46-02). Here we use the RESEARCH-verified "01".repeat(32) anchor.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PUBLIC_RPC_FALLBACK,
  _bittensorRegistry,
  _resetBittensorRegistryForTesting,
} from "../src/chains/bittensor/registry.js";
import {
  BITTENSOR_SS58_PREFIX,
  assertSs58Address,
} from "../src/chains/bittensor/types.js";
import { _taoRpcInternals } from "../src/chains/bittensor/tao-rpc-client.js";

const ENV_KEY = "BITTENSOR_RPC_URL";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  _resetBittensorRegistryForTesting();
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
  _resetBittensorRegistryForTesting();
  vi.restoreAllMocks();
});

describe("formatRaoToTao — 9-decimal RAO → decimal-string (mirror formatLamportsToSol)", () => {
  const { formatRaoToTao, RAO_PER_TAO } = _taoRpcInternals;

  it("RAO_PER_TAO is 1_000_000_000n (9 decimals, TAO protocol unit)", () => {
    expect(RAO_PER_TAO).toBe(1_000_000_000n);
  });

  it("0n → \"0\"", () => {
    expect(formatRaoToTao(0n)).toBe("0");
  });

  it("1_000_000_000n → \"1\" (exactly 1 TAO)", () => {
    expect(formatRaoToTao(1_000_000_000n)).toBe("1");
  });

  it("2_500_000_000n → \"2.5\"", () => {
    expect(formatRaoToTao(2_500_000_000n)).toBe("2.5");
  });

  it("1n → \"0.000000001\" (no precision loss — RAO is u128, never via Number)", () => {
    expect(formatRaoToTao(1n)).toBe("0.000000001");
  });

  it("1_500_000_000_000n → \"1500\" (trailing-zero trim, whole part > 1 TAO)", () => {
    expect(formatRaoToTao(1_500_000_000_000n)).toBe("1500");
  });

  it("u128-scale value formats without precision loss (Number would lose this)", () => {
    // 9_007_199_254_740_993 RAO = beyond Number.MAX_SAFE_INTEGER.
    const rao = 9_007_199_254_740_993n;
    expect(formatRaoToTao(rao)).toBe("9007199.254740993");
  });
});

describe("assertSs58Address — prefix-42 decodeAddress checksum gate (V5 input validation)", () => {
  it("BITTENSOR_SS58_PREFIX is 42", () => {
    expect(BITTENSOR_SS58_PREFIX).toBe(42);
  });

  it("accepts a valid prefix-42 \"5…\" address (returns the branded string)", () => {
    // encodeAddress(hexToU8a("0x"+"01".repeat(32)), 42) — RESEARCH anchor.
    const valid = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";
    expect(assertSs58Address(valid)).toBe(valid);
  });

  it("rejects a wrong-checksum / look-alike string (decodeAddress throws)", () => {
    const bad = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFX"; // last char flipped
    expect(() => assertSs58Address(bad)).toThrow();
  });

  it("rejects an obviously malformed string", () => {
    expect(() => assertSs58Address("not-an-address")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => assertSs58Address("")).toThrow();
  });
});

describe("_bittensorRegistry.getResolvedRpcUrl — resolves URL WITHOUT a live connect (Pitfall 5)", () => {
  it("returns the env override URL string without calling getApi()", () => {
    process.env[ENV_KEY] = "wss://my-subtensor.example:443";
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    const url = _bittensorRegistry.getResolvedRpcUrl();
    expect(url).toBe("wss://my-subtensor.example:443");
    expect(getApiSpy).not.toHaveBeenCalled();
  });

  it("returns the public fallback URL string when env unset, without calling getApi()", () => {
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    const url = _bittensorRegistry.getResolvedRpcUrl();
    expect(url).toBe(PUBLIC_RPC_FALLBACK);
    expect(PUBLIC_RPC_FALLBACK).toBe("wss://entrypoint-finney.opentensor.ai:443");
    expect(getApiSpy).not.toHaveBeenCalled();
  });
});
