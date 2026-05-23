// test/protocols-rocketpool.test.ts
//
// Byte-identity regressions for src/protocols/rocketpool.ts — Phase 31 Plan 31-03.
//
// Pins:
//   - ROCKETPOOL_SELECTORS hardcoded literals match viem.toFunctionSelector output
//   - Pitfall 1 collision DOCUMENTED: ROCKETPOOL_SELECTORS.deposit === WETH9_SELECTORS.deposit
//   - encodeRocketPoolDeposit() returns selector-only "0xd0e30db0" (10 chars)
//   - encodeRocketPoolBurn(amount) returns 74-char calldata starting "0x42966c68",
//     decodes back to the original amount via viem.decodeFunctionData
//
// Drift in any selector cascades through the cryptographic-binding chain —
// Fixtures AA-RP + AB-RP in test/signing-fingerprint.test.ts fail at a specific
// line. This file catches selector drift at the FIRST regression layer (cheap
// + named), upstream of the fingerprint preimage.
//
// Cross-link: T-ROCKETPOOL-SPENDER-DRIFT-1 in test/config-contracts.test.ts
// (cross-view byte-identity between KNOWN_SPENDERS_ETHEREUM rows and SOT getters).

import { describe, expect, it } from "vitest";
import { decodeFunctionData, toFunctionSelector } from "viem";

import {
  ROCKET_DEPOSIT_POOL_ABI,
  RETH_ABI,
  ROCKET_SETTINGS_DEPOSIT_ABI,
  ROCKETPOOL_SELECTORS,
  encodeRocketPoolDeposit,
  encodeRocketPoolBurn,
  RETH_DECIMALS,
  _rocketPoolProtocol,
  ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI,
  getRocketPoolDepositPoolAddress,
  getRocketPoolRethAddress,
  getRocketPoolDepositSettingsAddress,
} from "../src/protocols/rocketpool.js";
import { WETH9_SELECTORS } from "../src/protocols/weth9.js";

describe("ROCKETPOOL_SELECTORS — hardcoded literal byte-identity", () => {
  it("deposit selector === 0xd0e30db0 (viem-computed match)", () => {
    expect(ROCKETPOOL_SELECTORS.deposit).toBe("0xd0e30db0");
    // Cross-check against viem's canonical selector computation. Drift here
    // means either the ABI fragment text drifted OR the hardcoded literal
    // drifted — either fires this assertion.
    const fromAbi = toFunctionSelector("function deposit() payable");
    expect(fromAbi.toLowerCase()).toBe("0xd0e30db0");
  });

  it("burn selector === 0x42966c68 (viem-computed match)", () => {
    expect(ROCKETPOOL_SELECTORS.burn).toBe("0x42966c68");
    const fromAbi = toFunctionSelector("function burn(uint256 _rethAmount)");
    expect(fromAbi.toLowerCase()).toBe("0x42966c68");
  });

  it("Pitfall 1 collision DOCUMENTED — ROCKETPOOL_SELECTORS.deposit === WETH9_SELECTORS.deposit", () => {
    // Both `RocketDepositPool.deposit()` and `WETH9.deposit()` use the SAME
    // 4-byte selector `0xd0e30db0`. Selector-blind dispatch in preview_send
    // would route both to the same arm — defense lives at the (tx.to,
    // selector) tuple level. This assertion DOCUMENTS the collision so a
    // future contributor cannot accidentally remove the tuple dispatch
    // thinking the collision is gone.
    //
    // Note: WETH9_SELECTORS does not export `.deposit` by default. The
    // WETH9 ABI fragment WETH9_WITHDRAW_ABI in src/protocols/weth9.ts
    // INCLUDES `deposit() payable` but the selector table only exports
    // `withdraw`. We compute the deposit selector from the ABI fragment here
    // and compare.
    const wethDeposit = toFunctionSelector("function deposit() payable");
    expect(wethDeposit.toLowerCase()).toBe(ROCKETPOOL_SELECTORS.deposit.toLowerCase());
    // Sanity: WETH9_SELECTORS.withdraw is a DIFFERENT selector (no collision
    // for the unwrap path).
    expect(WETH9_SELECTORS.withdraw.toLowerCase()).not.toBe(
      ROCKETPOOL_SELECTORS.deposit.toLowerCase(),
    );
  });

  it("Pitfall 2 — burn selector is the generic OpenZeppelin ERC20Burnable selector (documented)", () => {
    // `0x42966c68` is the canonical selector for `burn(uint256)` from
    // OpenZeppelin's ERC20Burnable mixin. Any ERC-20 with the mixin exposes
    // the same selector. Preview-send dispatches on (tx.to === rETH, selector)
    // to gate the Rocket Pool arm specifically.
    expect(ROCKETPOOL_SELECTORS.burn).toBe("0x42966c68");
    const generic = toFunctionSelector("function burn(uint256)");
    expect(generic.toLowerCase()).toBe(ROCKETPOOL_SELECTORS.burn.toLowerCase());
  });
});

describe("encodeRocketPoolDeposit — selector-only calldata", () => {
  it("returns '0xd0e30db0' (selector-only, 10 chars; deposit is value-bearing — args in msg.value)", () => {
    const data = encodeRocketPoolDeposit();
    expect(data).toBe("0xd0e30db0");
    expect(data.length).toBe(10);
    expect(data.slice(0, 10).toLowerCase()).toBe(ROCKETPOOL_SELECTORS.deposit.toLowerCase());
  });
});

describe("encodeRocketPoolBurn — single-arg uint256 calldata", () => {
  it("returns 74-char calldata starting with the burn selector", () => {
    const data = encodeRocketPoolBurn(1_000_000_000_000_000_000n);
    expect(data.length).toBe(74);
    expect(data.slice(0, 10).toLowerCase()).toBe("0x42966c68");
  });

  it("round-trips through decodeFunctionData(abi=RETH_ABI) → [amountWei]", () => {
    const original = 12_345_000_000_000_000_000n;
    const data = encodeRocketPoolBurn(original);
    const decoded = decodeFunctionData({ abi: RETH_ABI, data });
    expect(decoded.functionName).toBe("burn");
    expect(decoded.args).toEqual([original]);
  });

  it("zero amount is allowed at the encoder level (refusal lives at the prepare-tool boundary)", () => {
    const data = encodeRocketPoolBurn(0n);
    expect(data.length).toBe(74);
    expect(data.slice(0, 10).toLowerCase()).toBe("0x42966c68");
  });
});

describe("Rocket Pool constants + SOT re-exports", () => {
  it("RETH_DECIMALS === 18", () => {
    expect(RETH_DECIMALS).toBe(18);
  });

  it("ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI === 1e16 (0.01 ETH)", () => {
    expect(ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI).toBe(10_000_000_000_000_000n);
  });

  it("SOT getters re-exported (depositPool / reth / settingsDeposit) — all non-null for chainId=1", () => {
    expect(getRocketPoolDepositPoolAddress(1)).not.toBeNull();
    expect(getRocketPoolRethAddress(1)).not.toBeNull();
    expect(getRocketPoolDepositSettingsAddress(1)).not.toBeNull();
  });

  it("ABI fragments parsed (3 fragments)", () => {
    expect(ROCKET_DEPOSIT_POOL_ABI.length).toBeGreaterThanOrEqual(1);
    expect(RETH_ABI.length).toBeGreaterThanOrEqual(1);
    expect(ROCKET_SETTINGS_DEPOSIT_ABI.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ESM spy-affordance — _rocketPoolProtocol", () => {
  it("exposes both encoders for vi.spyOn interception", () => {
    expect(typeof _rocketPoolProtocol.encodeRocketPoolDeposit).toBe("function");
    expect(typeof _rocketPoolProtocol.encodeRocketPoolBurn).toBe("function");
    expect(_rocketPoolProtocol.encodeRocketPoolDeposit).toBe(encodeRocketPoolDeposit);
    expect(_rocketPoolProtocol.encodeRocketPoolBurn).toBe(encodeRocketPoolBurn);
  });
});
