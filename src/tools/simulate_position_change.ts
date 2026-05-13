// MCP tool: simulate_position_change({ asset, action, amount })
//
// Phase 7 — Plan 07-03 (PREP-25). READ-ONLY simulation of a hypothetical Aave
// V3 position change. NEVER mutates state, NEVER calls any prepare_* tool,
// NEVER imports createHandle. Module-load grep guard asserts these invariants
// in test/simulate-position-change.test.ts (T-SIMULATE-MUTATES-STATE-1
// mitigation).
//
// Math: Option A (research § Topic 4 locked decision) — pure off-chain bigint
// projection. Reads current state via Plan 07-02's `_aaveChains` helpers,
// projects a delta onto the local position vector, re-runs `computeHealthFactor`
// on the projected state. Sub-bp index drift is accepted (research § Topic 4
// A2 — verify-phase cross-check against `Pool.getUserAccountData` will catch
// any compounding error at signing time).
//
// 4-action enum: supply / withdraw / borrow / repay. Phase 7 only ships the
// supply / withdraw prepare tools; borrow / repay are v2.3 — the simulation
// surface widens early to support "what if I borrow?" risk previews on the
// agent side (T-SIMULATE-BORROW-FAKE-COVERAGE-1 accepted residual; tool
// description names the asymmetry).
//
// Like get_lending_positions (Plan 07-02), this is informational. The trust
// anchor remains the LEDGER BLIND-SIGN HASH match at signing time — the
// simulation projection NEVER affects the prepare → preview → send pipeline.

import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { _aaveChains } from "../chains/aave-v3.js";
import { getEthereumClient, isPublicNodeFallback } from "../chains/ethereum.js";
import type { ChainId } from "../config/contracts.js";
import { isDemoMode } from "../config/env.js";
import { getActivePersona } from "../demo/state.js";
import {
  classifyLiquidationRisk,
  computeHealthFactor,
  RAY,
  type CollateralPosition,
  type DebtPosition,
  type HealthFactorInput,
  type LiquidationRisk,
} from "../signing/aave-health.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { loadEthereumTokenRegistry } from "../tokens/registry.js";
import { getStatus } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";

const ETHEREUM_CHAIN_ID: ChainId = 1;

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> &
    StructuredError;
}

const DESCRIPTION = [
  "Simulate the health-factor impact of a hypothetical Aave V3 position change on Ethereum mainnet. READ-ONLY — never stages a transaction; never modifies on-chain state.",
  "Returns the user's current health factor and the projected health factor after the hypothetical action, plus a liquidation-risk classification for both.",
  "Use when the user asks 'what if I supply / withdraw / borrow / repay X?' or to surface a risk warning BEFORE the agent prepares the actual transaction.",
  "Do NOT use this as a signing precondition — the trust anchor is the on-device hash match at send_transaction. The simulation is informational only.",
  "Do NOT use to project non-Aave changes (Compound / Morpho are v2.3+ scope).",
  "`action: \"supply\" | \"withdraw\" | \"borrow\" | \"repay\"`. supply / withdraw ship as prepare_aave_supply / prepare_aave_withdraw in Phase 7; borrow / repay are v2.3 — the simulation surface widens early to support 'what if I borrow?' risk previews even before the prepare tools exist.",
  "`amount` is a DECIMAL STRING in human units (e.g. \"100.5\" USDC). The server resolves the asset's decimals via the registry / live RPC.",
  "Returns `{ chain: \"ethereum\", asset, action, amount, healthFactorBefore, healthFactorAfter, liquidationRiskBefore, liquidationRiskAfter, warning?, rpcDegraded? }`.",
  "`warning` surfaces `\"would-liquidate\"` when the projected state transitions to `danger` from a non-danger state, or `\"near-liquidation\"` when transitioning from `safe` to `warning`.",
  "`healthFactor*` are formatted as decimal strings (1e18 scale; e.g. \"1.50\") or `null` when there is no debt.",
  "Math: pure off-chain bigint projection (Aave V3 indices RAY-scaled; per-asset liquidation thresholds). Accepts sub-bp index-drift error vs an on-chain `getUserAccountData` cross-check.",
  "Failure modes: INVALID_INPUT (malformed asset / action / amount), WRONG_MODE if demo mode is on but no persona set, WALLET_NOT_PAIRED if no live session in real mode, INTERNAL_ERROR if RPC fails.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    asset: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "ERC-20 underlying asset address (e.g. USDC `0xA0b8…`). 0x-prefixed 20-byte hex.",
    },
    action: {
      type: "string",
      enum: ["supply", "withdraw", "borrow", "repay"] as const,
      description:
        "Hypothetical action to project. supply / withdraw ship as prepare_* tools in Phase 7; borrow / repay are v2.3 — the simulation surface widens early to support 'what if I borrow?' risk previews.",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in human units (e.g. \"100.5\"). The server resolves the asset's decimals via the registry / live RPC.",
    },
  },
  required: ["asset", "action", "amount"],
  additionalProperties: false,
};

type Action = "supply" | "withdraw" | "borrow" | "repay";

interface SimulateResult {
  chain: "ethereum";
  asset: string;
  action: Action;
  amount: string;
  healthFactorBefore: string | null;
  healthFactorAfter: string | null;
  liquidationRiskBefore: LiquidationRisk;
  liquidationRiskAfter: LiquidationRisk;
  warning?: "would-liquidate" | "near-liquidation";
  rpcDegraded?: boolean;
}

registerTool("simulate_position_change", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const rawAsset = typeof args.asset === "string" ? args.asset : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawAsset) || !isAddress(rawAsset, { strict: false })) {
      return {
        isError: true,
        content: [
          { type: "text", text: `error: invalid 'asset': expected 0x-prefixed 20-byte hex, got "${rawAsset}"` },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'asset': ${rawAsset}`),
      };
    }

    const rawAction = typeof args.action === "string" ? args.action : "";
    if (
      rawAction !== "supply" &&
      rawAction !== "withdraw" &&
      rawAction !== "borrow" &&
      rawAction !== "repay"
    ) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'action': expected supply|withdraw|borrow|repay, got "${rawAction}"`,
          },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'action': ${rawAction}`),
      };
    }
    const action: Action = rawAction;

    const rawAmount = typeof args.amount === "string" ? args.amount : "";

    // SENDER resolution mirror — read-only. Use the persona address (demo) or
    // the paired Ledger's active account (real) as the user being simulated.
    let userAddress: Address;
    if (isDemoMode()) {
      const persona = getActivePersona();
      if (persona === null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: demo mode is active but no persona set. Call `set_demo_wallet({ persona: \"whale\" | \"defi-degen\" | \"stable-saver\" | \"staking-maxi\" })` first.",
            },
          ],
          structuredContent: errEnvelope(
            "WRONG_MODE",
            "demo mode active but no persona set; call set_demo_wallet first",
          ),
        };
      }
      userAddress = persona.address;
    } else {
      const status = await getStatus();
      if (status === null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: no live Ledger session. Call `pair_ledger_live` to pair a Ledger via WalletConnect, then retry.",
            },
          ],
          structuredContent: errEnvelope("WALLET_NOT_PAIRED", "no live Ledger session"),
        };
      }
      userAddress = status.activeAccount;
    }

    const assetAddr = getAddress(rawAsset) as Address;

    // Resolve decimals (registry-first; live RPC fallback is folded into the
    // get_lending_positions decimals path — we use the protocol's
    // `reserve.decimals` directly below since we already fetch reserves data).
    const registry = loadEthereumTokenRegistry();
    const registryHit = registry.find((entry) => entry.address === assetAddr);

    const client = getEthereumClient();

    let reservesData: Awaited<ReturnType<typeof _aaveChains.getReservesData>>;
    let userReservesData: Awaited<ReturnType<typeof _aaveChains.getUserReservesData>>;
    try {
      [reservesData, userReservesData] = await Promise.all([
        _aaveChains.getReservesData(client, ETHEREUM_CHAIN_ID),
        _aaveChains.getUserReservesData(client, ETHEREUM_CHAIN_ID, userAddress),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: failed to read Aave V3 state for ${userAddress}: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `failed to read Aave V3 state for ${userAddress}`,
          message,
        ),
      };
    }

    // Locate the reserve row for the simulated asset. The asset MUST exist in
    // the Aave V3 reserve set — a non-Aave ERC-20 address is INVALID_INPUT.
    const reserve = reservesData.reserves.find(
      (r) => getAddress(r.underlyingAsset) === assetAddr,
    );
    if (!reserve) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: asset ${assetAddr} is not an Aave V3 mainnet reserve; only listed reserves can be simulated`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `asset ${assetAddr} is not an Aave V3 reserve`,
        ),
      };
    }

    const decimals = registryHit ? registryHit.decimals : Number(reserve.decimals);

    // Parse amount strictly against the resolved decimals.
    let amountWei: bigint;
    try {
      amountWei = parseAmountStrict(rawAmount, decimals);
    } catch (err) {
      const message =
        err instanceof InvalidAmountError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        isError: true,
        content: [
          { type: "text", text: `error: invalid 'amount': ${message}` },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'amount': ${message}`),
      };
    }

    // Build the current HealthFactorInput from the live (reserves, userReserves)
    // pair. Mirror of get_lending_positions.ts:140-198 loop — single shape across
    // the read tool and this projection tool.
    const reserveByAsset = new Map(
      reservesData.reserves.map((r) => [getAddress(r.underlyingAsset), r] as const),
    );

    const collateralPositions: CollateralPosition[] = [];
    const debtPositions: DebtPosition[] = [];
    // Track per-asset position index so applyDelta can locate-or-create.
    const collateralByAsset = new Map<Address, number>(); // assetAddr → index
    const debtByAsset = new Map<Address, number>();

    for (const ur of userReservesData.userReserves) {
      const underlying = getAddress(ur.underlyingAsset);
      const r = reserveByAsset.get(underlying);
      if (!r) continue;
      const dec = Number(r.decimals);
      if (ur.scaledATokenBalance > 0n) {
        collateralByAsset.set(underlying, collateralPositions.length);
        collateralPositions.push({
          scaledBalance: ur.scaledATokenBalance,
          index: r.liquidityIndex,
          price: r.priceInMarketReferenceCurrency,
          decimals: dec,
          liquidationThresholdBps: r.reserveLiquidationThreshold,
        });
      }
      if (ur.scaledVariableDebt > 0n) {
        debtByAsset.set(underlying, debtPositions.length);
        debtPositions.push({
          scaledDebt: ur.scaledVariableDebt,
          index: r.variableBorrowIndex,
          price: r.priceInMarketReferenceCurrency,
          decimals: dec,
        });
      }
    }

    const before = computeHealthFactor({ collateralPositions, debtPositions });

    // Project the delta. Cloning the arrays keeps the input pure across the
    // before / after compute calls. T-SIMULATE-MUTATES-STATE-1: the projection
    // mutates ONLY local clones; the upstream reads are untouched.
    const projectedCollateral: CollateralPosition[] = collateralPositions.map((c) => ({ ...c }));
    const projectedDebt: DebtPosition[] = debtPositions.map((d) => ({ ...d }));

    // Scaled delta = amountWei * RAY / index. The user-facing delta is in
    // underlying-asset wei; Aave stores positions as RAY-scaled "scaled
    // balance" units, so we convert at the index boundary.
    if (action === "supply") {
      const scaledDelta = (amountWei * RAY) / reserve.liquidityIndex;
      const idx = collateralByAsset.get(assetAddr);
      if (idx !== undefined) {
        const current = projectedCollateral[idx]!;
        projectedCollateral[idx] = {
          ...current,
          scaledBalance: current.scaledBalance + scaledDelta,
        };
      } else {
        projectedCollateral.push({
          scaledBalance: scaledDelta,
          index: reserve.liquidityIndex,
          price: reserve.priceInMarketReferenceCurrency,
          decimals: Number(reserve.decimals),
          liquidationThresholdBps: reserve.reserveLiquidationThreshold,
        });
      }
    } else if (action === "withdraw") {
      const scaledDelta = (amountWei * RAY) / reserve.liquidityIndex;
      const idx = collateralByAsset.get(assetAddr);
      if (idx !== undefined) {
        const current = projectedCollateral[idx]!;
        const next = current.scaledBalance - scaledDelta;
        projectedCollateral[idx] = {
          ...current,
          scaledBalance: next < 0n ? 0n : next,
        };
      }
      // Withdraw of a never-supplied asset → no change to projected state.
    } else if (action === "borrow") {
      const scaledDelta = (amountWei * RAY) / reserve.variableBorrowIndex;
      const idx = debtByAsset.get(assetAddr);
      if (idx !== undefined) {
        const current = projectedDebt[idx]!;
        projectedDebt[idx] = {
          ...current,
          scaledDebt: current.scaledDebt + scaledDelta,
        };
      } else {
        projectedDebt.push({
          scaledDebt: scaledDelta,
          index: reserve.variableBorrowIndex,
          price: reserve.priceInMarketReferenceCurrency,
          decimals: Number(reserve.decimals),
        });
      }
    } else {
      // repay
      const scaledDelta = (amountWei * RAY) / reserve.variableBorrowIndex;
      const idx = debtByAsset.get(assetAddr);
      if (idx !== undefined) {
        const current = projectedDebt[idx]!;
        const next = current.scaledDebt - scaledDelta;
        projectedDebt[idx] = {
          ...current,
          scaledDebt: next < 0n ? 0n : next,
        };
      }
      // Repay of a never-borrowed asset → no change.
    }

    const after = computeHealthFactor({
      collateralPositions: projectedCollateral,
      debtPositions: projectedDebt,
    });

    const riskBefore = classifyLiquidationRisk(before.healthFactorScaled, before.noDebt);
    const riskAfter = classifyLiquidationRisk(after.healthFactorScaled, after.noDebt);

    let warning: "would-liquidate" | "near-liquidation" | undefined;
    if (riskAfter === "danger" && riskBefore !== "danger") warning = "would-liquidate";
    else if (riskAfter === "warning" && riskBefore === "safe") warning = "near-liquidation";

    const healthFactorBefore =
      before.healthFactorScaled === null ? null : formatUnits(before.healthFactorScaled, 18);
    const healthFactorAfter =
      after.healthFactorScaled === null ? null : formatUnits(after.healthFactorScaled, 18);

    const result: SimulateResult = {
      chain: "ethereum",
      asset: rawAsset,
      action,
      amount: rawAmount,
      healthFactorBefore,
      healthFactorAfter,
      liquidationRiskBefore: riskBefore,
      liquidationRiskAfter: riskAfter,
    };
    if (warning !== undefined) result.warning = warning;
    if (isPublicNodeFallback()) result.rpcDegraded = true;

    const beforeHuman =
      healthFactorBefore === null ? "noDebt" : Number(healthFactorBefore).toFixed(4);
    const afterHuman =
      healthFactorAfter === null ? "noDebt" : Number(healthFactorAfter).toFixed(4);
    const symbol = registryHit?.symbol ?? reserve.symbol;
    const summary =
      `simulate ${action} ${rawAmount} ${symbol} (${rawAsset}): HF ${beforeHuman} (${riskBefore}) → ${afterHuman} (${riskAfter})` +
      (warning ? `; warning: ${warning}` : "");

    return {
      content: [{ type: "text", text: summary }],
      structuredContent: { ...result },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: simulate_position_change failed: ${message}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "simulate_position_change failed",
        message,
      ),
    };
  }
});

// Suppress unused-import warnings; HealthFactorInput is referenced indirectly
// via computeHealthFactor's parameter type. The explicit re-export discipline
// keeps tests from importing it from internals if they ever need to construct
// fixtures directly.
export type { HealthFactorInput };
