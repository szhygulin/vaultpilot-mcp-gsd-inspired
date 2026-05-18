// src/config/env.ts — chain-specific RPC URL readers (Phase 8 Plan 08-01).
//
// The existing demo-mode resolution chain is covered in test/demo-resolution.test.ts.
// This file covers the simple `read(name)`-backed helpers added by Plan 08-01
// (`getArbitrumRpcUrl`, `getPolygonRpcUrl`, `getBaseRpcUrl`,
// `getOptimismRpcUrl`) plus a Phase 7 byte-frozen regression on
// `getEthereumRpcUrl` to lock its shape.
//
// Each helper mirrors `getEthereumRpcUrl` verbatim — trims whitespace,
// returns `undefined` for missing/empty/whitespace-only values, returns
// the trimmed string otherwise.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getArbitrumRpcUrl,
  getBaseRpcUrl,
  getEthereumRpcUrl,
  getOptimismRpcUrl,
  getPolygonRpcUrl,
} from "../src/config/env.js";

const ENV_KEYS = [
  "ETHEREUM_RPC_URL",
  "ARBITRUM_RPC_URL",
  "POLYGON_RPC_URL",
  "BASE_RPC_URL",
  "OPTIMISM_RPC_URL",
] as const;

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

describe("src/config/env.ts — getEthereumRpcUrl (Phase 2 byte-frozen)", () => {
  it("returns undefined when unset", () => {
    expect(getEthereumRpcUrl()).toBeUndefined();
  });
  it("returns the trimmed value when set", () => {
    process.env.ETHEREUM_RPC_URL = "  https://eth.example/abc  ";
    expect(getEthereumRpcUrl()).toBe("https://eth.example/abc");
  });
  it("returns undefined for empty / whitespace-only values", () => {
    process.env.ETHEREUM_RPC_URL = "";
    expect(getEthereumRpcUrl()).toBeUndefined();
    process.env.ETHEREUM_RPC_URL = "   ";
    expect(getEthereumRpcUrl()).toBeUndefined();
  });
});

describe("src/config/env.ts — getArbitrumRpcUrl (Plan 08-01)", () => {
  it("Test 31a — returns undefined when ARBITRUM_RPC_URL unset", () => {
    expect(getArbitrumRpcUrl()).toBeUndefined();
  });
  it("Test 31b — returns the trimmed value when set", () => {
    process.env.ARBITRUM_RPC_URL = "  https://arb.example/v3/key  ";
    expect(getArbitrumRpcUrl()).toBe("https://arb.example/v3/key");
  });
  it("Test 31c — returns undefined for empty / whitespace-only values", () => {
    process.env.ARBITRUM_RPC_URL = "";
    expect(getArbitrumRpcUrl()).toBeUndefined();
    process.env.ARBITRUM_RPC_URL = "    ";
    expect(getArbitrumRpcUrl()).toBeUndefined();
  });
});

describe("src/config/env.ts — getPolygonRpcUrl (Plan 08-01)", () => {
  it("Test 32a — returns undefined when POLYGON_RPC_URL unset", () => {
    expect(getPolygonRpcUrl()).toBeUndefined();
  });
  it("Test 32b — returns the trimmed value when set", () => {
    process.env.POLYGON_RPC_URL = "  https://polygon.example/v3/key  ";
    expect(getPolygonRpcUrl()).toBe("https://polygon.example/v3/key");
  });
  it("Test 32c — returns undefined for empty / whitespace-only values", () => {
    process.env.POLYGON_RPC_URL = "";
    expect(getPolygonRpcUrl()).toBeUndefined();
    process.env.POLYGON_RPC_URL = "  \t  ";
    expect(getPolygonRpcUrl()).toBeUndefined();
  });
});

describe("src/config/env.ts — getBaseRpcUrl (Plan 08-01)", () => {
  it("Test 33a — returns undefined when BASE_RPC_URL unset", () => {
    expect(getBaseRpcUrl()).toBeUndefined();
  });
  it("Test 33b — returns the trimmed value when set", () => {
    process.env.BASE_RPC_URL = "  https://base.example/v3/key  ";
    expect(getBaseRpcUrl()).toBe("https://base.example/v3/key");
  });
  it("Test 33c — returns undefined for empty / whitespace-only values", () => {
    process.env.BASE_RPC_URL = "";
    expect(getBaseRpcUrl()).toBeUndefined();
    process.env.BASE_RPC_URL = " ";
    expect(getBaseRpcUrl()).toBeUndefined();
  });
});

describe("src/config/env.ts — getOptimismRpcUrl (Plan 08-01)", () => {
  it("Test 34a — returns undefined when OPTIMISM_RPC_URL unset", () => {
    expect(getOptimismRpcUrl()).toBeUndefined();
  });
  it("Test 34b — returns the trimmed value when set", () => {
    process.env.OPTIMISM_RPC_URL = "  https://opt.example/v3/key  ";
    expect(getOptimismRpcUrl()).toBe("https://opt.example/v3/key");
  });
  it("Test 34c — returns undefined for empty / whitespace-only values", () => {
    process.env.OPTIMISM_RPC_URL = "";
    expect(getOptimismRpcUrl()).toBeUndefined();
    process.env.OPTIMISM_RPC_URL = "\n";
    expect(getOptimismRpcUrl()).toBeUndefined();
  });
});
