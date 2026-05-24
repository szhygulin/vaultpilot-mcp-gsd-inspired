// test/signing-uniswap-pool-address.test.ts
//
// Phase 33 Plan 33-01 — pure-bigint CREATE2 pool-address derivation regression.
// Anchored against multiple Etherscan-verified canonical pools (USDC/WETH
// 0.05%/0.30%, WBTC/WETH 0.30%, DAI/USDC 0.01%). Reference values computed
// at probe time via @uniswap/v3-sdk computePoolAddress (verified 2026-05-24).
//
// NO `beforeAll`-snapshot — every literal is hardcoded per CLAUDE.md.

import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

import {
  POOL_INIT_CODE_HASH,
  UNISWAP_V3_FACTORY,
  _uniswapV3PoolAddress,
  computePoolAddress,
} from "../src/signing/uniswap-pool-address.js";

// Canonical Ethereum mainnet tokens (EIP-55 checksummed).
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const WBTC = getAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599");
const DAI = getAddress("0x6B175474E89094C44Da98b954EedeAC495271d0F");

describe("uniswap-pool-address — constants", () => {
  it("UNISWAP_V3_FACTORY pinned to canonical mainnet address", () => {
    expect(UNISWAP_V3_FACTORY).toBe(
      getAddress("0x1F98431c8aD98523631AE4a59f267346ea31F984"),
    );
  });

  it("POOL_INIT_CODE_HASH pinned to canonical Uniswap V3 deployer init-code-hash", () => {
    expect(POOL_INIT_CODE_HASH).toBe(
      "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54",
    );
  });
});

describe("uniswap-pool-address — computePoolAddress (canonical reference vectors)", () => {
  it("USDC/WETH 0.05% → 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640 (Etherscan VERIFIED)", () => {
    expect(computePoolAddress(USDC, WETH, 500)).toBe(
      getAddress("0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"),
    );
  });

  it("USDC/WETH 0.30% → 0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8 (Etherscan VERIFIED)", () => {
    expect(computePoolAddress(USDC, WETH, 3000)).toBe(
      getAddress("0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8"),
    );
  });

  it("WBTC/WETH 0.30% → 0xCBCdF9626bC03E24f779434178A73a0B4bad62eD (Etherscan VERIFIED)", () => {
    expect(computePoolAddress(WBTC, WETH, 3000)).toBe(
      getAddress("0xCBCdF9626bC03E24f779434178A73a0B4bad62eD"),
    );
  });

  it("DAI/USDC 0.01% → 0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168 (Etherscan VERIFIED)", () => {
    expect(computePoolAddress(DAI, USDC, 100)).toBe(
      getAddress("0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168"),
    );
  });
});

describe("uniswap-pool-address — token0/token1 sort discipline", () => {
  it("computePoolAddress(USDC, WETH, 500) === computePoolAddress(WETH, USDC, 500) — sort is invariant under argument order", () => {
    expect(computePoolAddress(USDC, WETH, 500)).toBe(computePoolAddress(WETH, USDC, 500));
  });

  it("computePoolAddress(WBTC, WETH, 3000) === computePoolAddress(WETH, WBTC, 3000)", () => {
    expect(computePoolAddress(WBTC, WETH, 3000)).toBe(computePoolAddress(WETH, WBTC, 3000));
  });
});

describe("uniswap-pool-address — module-load self-check", () => {
  // The module's bottom-of-file self-check asserts USDC/WETH 0.05% derivation;
  // if it failed, the import at the top of this test file would have thrown.
  // This is a meta-assertion: the import succeeded → the self-check passed.
  it("module import does not throw (self-check passed)", () => {
    expect(computePoolAddress).toBeDefined();
  });
});

describe("uniswap-pool-address — _uniswapV3PoolAddress ESM spy-affordance", () => {
  it("indirection object exports computePoolAddress", () => {
    expect(typeof _uniswapV3PoolAddress.computePoolAddress).toBe("function");
  });
});
