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

import { erc20Abi, formatUnits, getAddress, isAddress, type Address } from "viem";

import { _aaveChains } from "../chains/aave-v3.js";
import { _compoundChains } from "../chains/compound-v3.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import {
  chainIdFromName,
  getAllCompoundCometsForChain,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
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
  computeCompoundCollateralization,
  type CompoundCollateralPosition,
} from "../signing/compound-collateralization.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { loadTokenRegistry } from "../tokens/registry.js";
import { getStatus } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> &
    StructuredError;
}

const DESCRIPTION = [
  "Simulate the health-factor (Aave V3) or collateralization-ratio (Compound V3) impact of a hypothetical position change on the specified EVM chain. READ-ONLY — never stages a transaction; never modifies on-chain state.",
  "Returns the user's current state, projected state after the hypothetical action, and a liquidation-risk classification for both.",
  "Use when the user asks 'what if I supply / withdraw / borrow / repay X?' or to surface a risk warning BEFORE the agent prepares the actual transaction.",
  "Do NOT use this as a signing precondition — the trust anchor is the on-device hash match at send_transaction. The simulation is informational only.",
  "`chain` is REQUIRED — pass one of ethereum, arbitrum, polygon, base, optimism. No default-pick; omitting the arg refuses at the dispatch boundary.",
  "`protocol` is OPTIONAL — `\"aave-v3\"` (default for back-compat) or `\"compound-v3\"`. Compound V3 is supported on any chain with Comets: ethereum, arbitrum, polygon, base, optimism.",
  "`cometAddress` is REQUIRED when `protocol: \"compound-v3\"` — must be a canonical Comet for the specified chain (validated against the per-chain allowlist before any RPC read).",
  "`action: \"supply\" | \"withdraw\" | \"borrow\" | \"repay\"`.",
  "`amount` is a DECIMAL STRING in human units (e.g. \"100.5\" USDC). The server resolves the asset's decimals via the registry / live RPC.",
  "Returns (Aave) `{ chain, chainId, protocol: \"aave-v3\", asset, action, amount, healthFactorBefore, healthFactorAfter, liquidationRiskBefore, liquidationRiskAfter, warning?, rpcDegraded? }`.",
  "Returns (Compound) `{ chain, chainId, protocol: \"compound-v3\", comet, asset, action, amount, currentRatio, projectedRatio, isBorrowCollateralizedCurrent, isBorrowCollateralizedProjected, isLiquidatableCurrent, isLiquidatableProjected, liquidationRiskCurrent, liquidationRiskProjected, warning?, rpcDegraded? }`.",
  "`warning` surfaces `\"would-liquidate\"` when the projected state transitions to `danger` from a non-danger state, or `\"near-liquidation\"` when transitioning from `safe` to `warning`.",
  "Math: pure off-chain bigint projection (Aave V3 RAY-scaled indices + per-asset LT; Compound V3 PRICE_FEED_SCALE + COLLATERAL_FACTOR_SCALE + RATIO_SCALE). Accepts sub-bp index-drift error vs an on-chain cross-check.",
  "Failure modes: INVALID_INPUT (malformed chain / protocol / asset / action / amount / cometAddress), WRONG_MODE if demo mode is on but no persona set, WALLET_NOT_PAIRED if no live session in real mode, INTERNAL_ERROR if RPC fails.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description:
        "Chain identifier (required). Supported: ethereum, arbitrum, polygon, base, optimism.",
    },
    protocol: {
      type: "string",
      enum: ["aave-v3", "compound-v3"] as const,
      description:
        "Lending protocol to simulate against (optional; defaults to \"aave-v3\" for back-compat). \"compound-v3\" is supported on any chain with Comets and requires cometAddress.",
    },
    cometAddress: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Required when `protocol: \"compound-v3\"`. Must be a canonical Compound V3 Comet for the specified chain.",
    },
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
  required: ["chain", "asset", "action", "amount"],
  additionalProperties: false,
};

type Action = "supply" | "withdraw" | "borrow" | "repay";

interface SimulateResult {
  chain: ChainName;
  chainId: number;
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
    // Phase 8 — Plan 08-02: chainId from the agent's `chain` arg. JSON-schema
    // enum is the dispatch-boundary gate.
    const chainName = args.chain as ChainName;
    const chainId = chainIdFromName(chainName);

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

    // Phase 28 — Plan 28-04. Protocol dispatcher. Default is `"aave-v3"` for
    // back-compat (Phase 7 callers); Compound branch fires when the agent
    // explicitly passes `protocol: "compound-v3"` + a canonical `cometAddress`.
    const protocol = (typeof args.protocol === "string" ? args.protocol : "aave-v3") as
      | "aave-v3"
      | "compound-v3";

    if (protocol === "compound-v3") {
      const result = await simulateCompoundV3({
        chainName,
        chainId,
        rawAsset,
        assetAddr,
        action,
        rawAmount,
        userAddress,
        cometAddressRaw: typeof args.cometAddress === "string" ? args.cometAddress : "",
      });
      return result;
    }

    // Resolve decimals (registry-first; live RPC fallback is folded into the
    // get_lending_positions decimals path — we use the protocol's
    // `reserve.decimals` directly below since we already fetch reserves data).
    const registry = loadTokenRegistry(chainId);
    const registryHit = registry.find((entry) => entry.address === assetAddr);

    const client = getChainClient(chainId);

    let reservesData: Awaited<ReturnType<typeof _aaveChains.getReservesData>>;
    let userReservesData: Awaited<ReturnType<typeof _aaveChains.getUserReservesData>>;
    try {
      [reservesData, userReservesData] = await Promise.all([
        _aaveChains.getReservesData(client, chainId),
        _aaveChains.getUserReservesData(client, chainId, userAddress),
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
            text: `error: asset ${assetAddr} is not an Aave V3 reserve on ${chainName} (chainId ${chainId}); only listed reserves can be simulated`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `asset ${assetAddr} is not an Aave V3 reserve on ${chainName}`,
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
      chain: chainName,
      chainId,
      asset: rawAsset,
      action,
      amount: rawAmount,
      healthFactorBefore,
      healthFactorAfter,
      liquidationRiskBefore: riskBefore,
      liquidationRiskAfter: riskAfter,
    };
    if (warning !== undefined) result.warning = warning;
    if (isPublicNodeFallback(chainId)) result.rpcDegraded = true;

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

// ---------------------------------------------------------------------------
// Phase 28 — Plan 28-04. Compound V3 dispatcher arm. Pure off-chain bigint
// projection: reads current Comet state via `_compoundChains.getCometState` +
// `getCometCollateralPositions`, applies a 4-action delta in-memory, recomputes
// `computeCompoundCollateralization` over the projected state.
//
// TRUST-BOUNDARY invariant unchanged from Aave path: simulation is a
// USABILITY signal, NEVER a signing precondition. The on-device LEDGER
// BLIND-SIGN HASH match is the cryptographic anchor.
// ---------------------------------------------------------------------------

interface SimulateCompoundInput {
  chainName: ChainName;
  chainId: ChainId;
  rawAsset: string;
  assetAddr: Address;
  action: Action;
  rawAmount: string;
  userAddress: Address;
  cometAddressRaw: string;
}

async function simulateCompoundV3(input: SimulateCompoundInput) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.cometAddressRaw) ||
      !isAddress(input.cometAddressRaw, { strict: false })) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `error: protocol \"compound-v3\" requires cometAddress (0x-prefixed 20-byte hex)`,
        },
      ],
      structuredContent: errEnvelope(
        "INVALID_INPUT",
        "protocol \"compound-v3\" requires cometAddress (0x-prefixed 20-byte hex)",
      ),
    };
  }

  const cometAddr = getAddress(input.cometAddressRaw);
  const allowlist = getAllCompoundCometsForChain(input.chainId);
  if (!allowlist.includes(cometAddr)) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `error: cometAddress ${cometAddr} is not in the canonical Compound V3 allowlist for chain ${input.chainName} (${allowlist.length} entries)`,
        },
      ],
      structuredContent: errEnvelope(
        "INVALID_INPUT",
        `cometAddress ${cometAddr} not in canonical Compound V3 allowlist for chainId ${input.chainId}`,
      ),
    };
  }

  const client = getChainClient(input.chainId);

  let state: Awaited<ReturnType<typeof _compoundChains.getCometState>>;
  let collateral: Awaited<ReturnType<typeof _compoundChains.getCometCollateralPositions>>;
  try {
    state = await _compoundChains.getCometState(client, cometAddr, input.userAddress);
    collateral = await _compoundChains.getCometCollateralPositions(
      client,
      cometAddr,
      input.userAddress,
      state.numAssets,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `error: failed to read Compound V3 state for ${input.userAddress}: ${message}`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        `failed to read Compound V3 state for ${input.userAddress}`,
        message,
      ),
    };
  }

  // Resolve asset decimals. Use the collateral row when the asset is a
  // configured collateral; otherwise fall back to the base token decimals via
  // ERC-20 RPC (live read; mirror get_lending_positions resolveBaseToken).
  let assetDecimals: number;
  const collateralRow = collateral.find((c) => c.asset === input.assetAddr);
  const isBaseAsset = getAddress(state.baseToken) === input.assetAddr;
  if (collateralRow) {
    assetDecimals = collateralRow.decimals;
  } else if (isBaseAsset) {
    try {
      const dec = await client.readContract({
        address: state.baseToken,
        abi: erc20Abi,
        functionName: "decimals",
      });
      assetDecimals = Number(dec);
    } catch {
      assetDecimals = 18;
    }
  } else {
    // Asset is neither the base nor a configured collateral on this Comet.
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `error: asset ${input.assetAddr} is neither the base token nor a configured collateral on Comet ${cometAddr}`,
        },
      ],
      structuredContent: errEnvelope(
        "INVALID_INPUT",
        `asset ${input.assetAddr} is neither base nor collateral on Comet ${cometAddr}`,
      ),
    };
  }

  // Parse amount strictly against the resolved decimals.
  let amountWei: bigint;
  try {
    amountWei = parseAmountStrict(input.rawAmount, assetDecimals);
  } catch (err) {
    const message =
      err instanceof InvalidAmountError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `error: invalid 'amount': ${message}` }],
      structuredContent: errEnvelope("INVALID_INPUT", `invalid 'amount': ${message}`),
    };
  }

  // Build CURRENT collateral input.
  const currentCollateralInput: CompoundCollateralPosition[] = collateral.map((c) => ({
    balance: c.balance,
    priceUsd: c.priceUsd,
    decimals: c.decimals,
    borrowCollateralFactor: c.borrowCollateralFactor,
    liquidateCollateralFactor: c.liquidateCollateralFactor,
  }));

  // We need the base token decimals for the base position. If the asset is the
  // base, we already resolved decimals; otherwise read separately.
  let baseDecimals: number;
  if (isBaseAsset) {
    baseDecimals = assetDecimals;
  } else {
    try {
      const dec = await client.readContract({
        address: state.baseToken,
        abi: erc20Abi,
        functionName: "decimals",
      });
      baseDecimals = Number(dec);
    } catch {
      baseDecimals = 18;
    }
  }

  const currentBaseInput = {
    baseBorrowed: state.baseBorrowed,
    basePriceUsd: state.baseTokenPriceUsd,
    baseDecimals,
  };

  const currentMetrics = computeCompoundCollateralization({
    collateral: currentCollateralInput,
    base: currentBaseInput,
  });

  // Project the delta. Compound V3 has TWO position-modification surfaces:
  //   - base-asset position: supply (collateralized lender), withdraw,
  //     borrow (decrements supply OR mints debt), repay (clears debt first,
  //     then supply).
  //   - collateral-asset position: supply (adds collateral), withdraw
  //     (removes collateral). Compound doesn't borrow against an isolated
  //     collateral asset — debt is always in the base.
  //
  // Phase 28 simplifies: each action is a single-asset delta (the canonical
  // Compound semantics). The 4-action projection mirrors Aave's pure off-
  // chain projection — sub-bp index-drift accepted per research § Topic 9 A2.
  const projectedCollateralInput: CompoundCollateralPosition[] = currentCollateralInput.map(
    (c) => ({ ...c }),
  );
  let projectedBaseBorrowed = state.baseBorrowed;

  if (input.action === "supply") {
    if (isBaseAsset) {
      // Supplying the base asset: in Compound, this reduces debt FIRST (any
      // outstanding borrow), then deposits surplus into the supply position.
      // For the projection, we model the debt-reduction component as it's the
      // load-bearing case for collateralization (the supply side has no CF in
      // Compound's gate).
      const debtReduction = amountWei > state.baseBorrowed ? state.baseBorrowed : amountWei;
      projectedBaseBorrowed = state.baseBorrowed - debtReduction;
    } else {
      // Supplying a collateral asset.
      const idx = collateral.findIndex((c) => c.asset === input.assetAddr);
      if (idx !== -1) {
        const c = projectedCollateralInput[idx]!;
        projectedCollateralInput[idx] = { ...c, balance: c.balance + amountWei };
      } else {
        // Fresh collateral position — surface the configured asset row so the
        // projection includes it. For Phase 28 simplicity, refuse: supplying
        // a non-configured collateral would never land on-chain.
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `error: asset ${input.assetAddr} is not a configured collateral on Comet ${cometAddr}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `asset ${input.assetAddr} is not a configured collateral on Comet ${cometAddr}`,
          ),
        };
      }
    }
  } else if (input.action === "withdraw") {
    if (isBaseAsset) {
      // Withdrawing the base asset: in Compound V3, withdrawing more than the
      // supply balance MINTS debt (borrow). For the projection, we model the
      // debt-mint component.
      const debtMint = amountWei > state.baseSupplied ? amountWei - state.baseSupplied : 0n;
      projectedBaseBorrowed = state.baseBorrowed + debtMint;
    } else {
      // Withdrawing a collateral asset.
      const idx = collateral.findIndex((c) => c.asset === input.assetAddr);
      if (idx !== -1) {
        const c = projectedCollateralInput[idx]!;
        const nextBalance = c.balance > amountWei ? c.balance - amountWei : 0n;
        projectedCollateralInput[idx] = { ...c, balance: nextBalance };
      }
      // No-op if not a configured collateral row — wallet had zero already.
    }
  } else if (input.action === "borrow") {
    if (!isBaseAsset) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `error: borrow projection requires the base token (got ${input.assetAddr}; base is ${state.baseToken})`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `borrow projection requires the base token; got ${input.assetAddr}`,
        ),
      };
    }
    projectedBaseBorrowed = state.baseBorrowed + amountWei;
  } else {
    // repay
    if (!isBaseAsset) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `error: repay projection requires the base token (got ${input.assetAddr}; base is ${state.baseToken})`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `repay projection requires the base token; got ${input.assetAddr}`,
        ),
      };
    }
    const debtReduction = amountWei > state.baseBorrowed ? state.baseBorrowed : amountWei;
    projectedBaseBorrowed = state.baseBorrowed - debtReduction;
  }

  const projectedMetrics = computeCompoundCollateralization({
    collateral: projectedCollateralInput,
    base: { ...currentBaseInput, baseBorrowed: projectedBaseBorrowed },
  });

  const riskBefore = currentMetrics.liquidationRisk;
  const riskAfter = projectedMetrics.liquidationRisk;
  let warning: "would-liquidate" | "near-liquidation" | undefined;
  if (riskAfter === "danger" && riskBefore !== "danger") warning = "would-liquidate";
  else if (riskAfter === "warning" && riskBefore === "safe") warning = "near-liquidation";

  const currentRatio =
    currentMetrics.ratioScaled === null
      ? null
      : formatUnits(currentMetrics.ratioScaled, 18);
  const projectedRatio =
    projectedMetrics.ratioScaled === null
      ? null
      : formatUnits(projectedMetrics.ratioScaled, 18);

  const result = {
    chain: input.chainName,
    chainId: input.chainId,
    protocol: "compound-v3" as const,
    comet: cometAddr,
    asset: input.rawAsset,
    action: input.action,
    amount: input.rawAmount,
    currentRatio,
    projectedRatio,
    isBorrowCollateralizedCurrent: currentMetrics.isBorrowCollateralized,
    isBorrowCollateralizedProjected: projectedMetrics.isBorrowCollateralized,
    isLiquidatableCurrent: currentMetrics.isLiquidatable,
    isLiquidatableProjected: projectedMetrics.isLiquidatable,
    liquidationRiskCurrent: riskBefore,
    liquidationRiskProjected: riskAfter,
    ...(warning ? { warning } : {}),
    ...(isPublicNodeFallback(1) ? { rpcDegraded: true as const } : {}),
  };

  const beforeHuman = currentRatio === null ? "noDebt" : Number(currentRatio).toFixed(4);
  const afterHuman = projectedRatio === null ? "noDebt" : Number(projectedRatio).toFixed(4);
  const summary =
    `simulate ${input.action} ${input.rawAmount} ${input.assetAddr} on Compound V3 ${cometAddr}: ratio ${beforeHuman} (${riskBefore}) → ${afterHuman} (${riskAfter})` +
    (warning ? `; warning: ${warning}` : "");

  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent: { ...result } as Record<string, unknown>,
  };
}
