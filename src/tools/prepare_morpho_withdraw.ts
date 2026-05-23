// MCP tool: prepare_morpho_withdraw({ chain, marketId, asset, amount, onBehalf?, receiver?, from? })
//
// Phase 29 — Plan 29-03 (MOR-03 withdraw leg). Mechanical sibling of
// `prepare_morpho_supply.ts` with two deltas:
//
//   (a) `amount: "max"` IS accepted (lowercase strict-equality only — T-MAX-
//       SPELLING-1 discipline). Server reads
//       `_morphoChains.readPosition(marketId, onBehalf).supplyShares` at
//       prepare time + uses `_morphoChains.readMarket(marketId)` totals to
//       compute `amountWei = toAssetsDown(supplyShares, totalSupplyAssets,
//       totalSupplyShares)` — rounded DOWN, conservative (under-reports what
//       user CAN withdraw against the stale market state). The encoder
//       receives the resolved assets value with shares=0n.
//   (b) Encoder = `encodeMorphoWithdraw(params, amountWei, 0n, onBehalf,
//       receiver ?? onBehalf)`.
//
// Asset-match gate refusal hints at `prepare_morpho_withdraw_collateral` (the
// withdraw-side counterpart of supply ↔ supplyCollateral).

import { type Address, type Hex, erc20Abi, getAddress } from "viem";

import { _morphoChains } from "../chains/morpho-blue.js";
import { getChainClient } from "../chains/registry.js";
import {
  chainIdFromName,
  getMorphoBlueAddress,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import {
  _morphoBlue,
  encodeMorphoWithdraw,
  type MorphoMarketParams,
} from "../protocols/morpho-blue.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { MORPHO_WITHDRAW_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { toAssetsDown } from "../signing/morpho-shares-math.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import morphoRegistryRaw from "../tokens/morpho-markets-ethereum.json" with { type: "json" };
import { loadTokenRegistry } from "../tokens/registry.js";
import { registerTool } from "./index.js";

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> & StructuredError {
  return makeStructuredError(code, message, cause) as Record<string, unknown> &
    StructuredError;
}

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

interface MorphoMarketRegistryEntry {
  marketId: Hex;
  loanToken: { address: Address; symbol: string; decimals: number };
  collateralToken: { address: Address; symbol: string; decimals: number };
  oracle: Address;
  irm: Address;
  lltv: string;
  label: string;
}

const REGISTRY: ReadonlyMap<string, MorphoMarketRegistryEntry> = (() => {
  const m = new Map<string, MorphoMarketRegistryEntry>();
  for (const raw of morphoRegistryRaw as readonly MorphoMarketRegistryEntry[]) {
    m.set(raw.marketId.toLowerCase(), raw);
  }
  return m;
})();

function lookupMarketLabel(marketId: Hex): string {
  return REGISTRY.get(marketId.toLowerCase())?.label ?? "(unlabeled market)";
}

const DESCRIPTION = [
  "Prepare an unsigned Morpho Blue withdraw(marketParams, assets, 0, onBehalf, receiver) call on Ethereum mainnet — withdraws the LOAN ASSET from a Morpho Blue market (closes part or all of a lender position).",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to close or reduce a Morpho lender position. Asset MUST match the market's loanToken — REFUSED with INVALID_INPUT + structuredContent.hintTool: \"prepare_morpho_withdraw_collateral\" if the agent passes the collateralToken.",
  "Do NOT use for supply / borrow / repay / supplyCollateral / withdrawCollateral.",
  "Accepts amount: \"max\" (lowercase only — T-MAX-SPELLING-1 strict-equality) to withdraw the FULL lender position. Server resolves via SharesMathLib.toAssetsDown(position.supplyShares, totalSupplyAssets, totalSupplyShares) — rounded DOWN; under-reports what user CAN withdraw against the stale market state (the on-chain accrueInterest at tx time may add slightly more).",
  "`chain` is REQUIRED and v2.3-locked to \"ethereum\". `marketId` REQUIRED — 32-byte hex; server cross-checks via idToMarketParams.",
  "`asset` MUST be marketParams.loanToken (refused otherwise). `onBehalf` defaults to the resolved sender. `receiver` defaults to onBehalf (the loanToken transfer destination).",
  "Morpho Blue calldata IS in the Ledger ERC-7730 clear-sign registry — device clear-signs decoded MarketParams + amount/shares + receiver. No blind-sign.",
  "Requires a paired Ledger (real mode) or active persona (demo mode).",
  "Returns `{ handle, chain, chainId, marketId, marketLabel?, asset, amount, amountWei, onBehalf, receiver, from, payloadFingerprint }` plus a PREPARE RECEIPT (renders `amount: max` VERBATIM when the agent passes \"max\"; the resolved assets value surfaces in DECODED ARGS at preview time).",
  "Failure modes: WALLET_NOT_PAIRED / WRONG_MODE / INVALID_INPUT (chain/marketId/asset/amount/onBehalf/receiver/from malformed; non-existent market; asset-match gate refusal; \"max\" with zero supplyShares; fractional-overflow) / INVALID_ACCOUNT / INTERNAL_ERROR (RPC failure resolving params / position / market totals / decimals; marketId drift).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description: "Chain identifier (required). v2.3 supports ONLY ethereum.",
    },
    marketId: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{64}$",
      description: "32-byte Morpho Blue marketId hex.",
    },
    asset: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "ERC-20 asset address — MUST be marketParams.loanToken. Refused with hintTool: prepare_morpho_withdraw_collateral if it matches the collateralToken.",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in human units (e.g. \"50\") OR the literal lowercase \"max\" to close the full lender position (resolved server-side via toAssetsDown on position.supplyShares).",
    },
    onBehalf: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional — the account whose lender position the withdraw debits. Defaults to the resolved sender.",
    },
    receiver: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional — the recipient of the loanToken transfer. Defaults to onBehalf.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts.",
    },
  },
  required: ["chain", "marketId", "asset", "amount"],
  additionalProperties: false,
};

async function resolveDecimals(
  assetAddress: Address,
  chainId: ChainId,
): Promise<{ decimals: number; symbol: string }> {
  const registry = loadTokenRegistry(chainId);
  const cached = registry.find((entry) => entry.address === assetAddress);
  if (cached) {
    return { decimals: cached.decimals, symbol: cached.symbol };
  }
  const client = getChainClient(chainId);
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: assetAddress, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: assetAddress, abi: erc20Abi, functionName: "symbol" }),
  ]);
  return { decimals, symbol };
}

registerTool("prepare_morpho_withdraw", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const chainName = args.chain as ChainName;
    if (chainName !== "ethereum") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'chain': Morpho Blue v2.3 supports only 'ethereum', got "${chainName}"`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'chain': Morpho Blue v2.3 supports only 'ethereum', got "${chainName}"`,
        ),
      };
    }
    const chainId = chainIdFromName(chainName);

    const rawMarketId = typeof args.marketId === "string" ? args.marketId : "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(rawMarketId)) {
      return {
        isError: true,
        content: [
          { type: "text", text: `error: invalid 'marketId': got "${rawMarketId}"` },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'marketId': ${rawMarketId}`),
      };
    }
    const marketId = rawMarketId as Hex;

    const rawAsset = typeof args.asset === "string" ? args.asset : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawAsset)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: invalid 'asset': got "${rawAsset}"` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'asset': ${rawAsset}`),
      };
    }

    const rawAmount = typeof args.amount === "string" ? args.amount : "";

    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    const rawOnBehalf = typeof args.onBehalf === "string" ? args.onBehalf : undefined;
    if (rawOnBehalf !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(rawOnBehalf)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: invalid 'onBehalf': ${rawOnBehalf}` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'onBehalf': ${rawOnBehalf}`),
      };
    }
    const onBehalf: Address = rawOnBehalf ? getAddress(rawOnBehalf) : fromAddress;

    const rawReceiver = typeof args.receiver === "string" ? args.receiver : undefined;
    if (rawReceiver !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(rawReceiver)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: invalid 'receiver': ${rawReceiver}` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'receiver': ${rawReceiver}`),
      };
    }
    const receiver: Address = rawReceiver ? getAddress(rawReceiver) : onBehalf;

    const assetAddr = getAddress(rawAsset) as Address;
    const morpho = getMorphoBlueAddress(chainId);
    if (!morpho) {
      return {
        isError: true,
        content: [{ type: "text", text: "error: Morpho Blue address unavailable" }],
        structuredContent: errEnvelope("INTERNAL_ERROR", "Morpho Blue address unavailable"),
      };
    }

    const client = getChainClient(chainId);
    let params: MorphoMarketParams;
    try {
      params = await _morphoChains.readMarketParams(client, morpho, marketId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: failed to read Morpho marketParams for ${marketId}: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `failed to read Morpho marketParams for ${marketId}`,
          message,
        ),
      };
    }

    if (getAddress(params.loanToken) === getAddress(ZERO_ADDRESS)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: Morpho market ${marketId} does not exist on this chain`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `Morpho market ${marketId} does not exist on this chain`,
        ),
      };
    }

    const derivedMarketId = _morphoBlue.deriveMarketId(params);
    if (derivedMarketId.toLowerCase() !== marketId.toLowerCase()) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: Morpho market-id drift — input=${marketId} derived=${derivedMarketId}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `Morpho market-id drift: input=${marketId} derived=${derivedMarketId}`,
        ),
      };
    }

    // Asset-match gate — asset MUST be loanToken; hint at withdraw_collateral
    // if collateralToken.
    if (getAddress(assetAddr) !== getAddress(params.loanToken)) {
      const isCollateral = getAddress(assetAddr) === getAddress(params.collateralToken);
      const refusalMessage = isCollateral
        ? `prepare_morpho_withdraw received the market's collateralToken (${rawAsset}); withdraw expects the loanToken (${params.loanToken}). ` +
          "Call prepare_morpho_withdraw_collateral to withdraw collateral."
        : `prepare_morpho_withdraw asset ${rawAsset} matches neither loanToken (${params.loanToken}) nor collateralToken (${params.collateralToken}). ` +
          "Verify the marketId / asset combination — for collateral withdrawal, call prepare_morpho_withdraw_collateral.";
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${refusalMessage}` }],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", refusalMessage),
          hintTool: "prepare_morpho_withdraw_collateral",
        },
      };
    }

    let decimals: number;
    try {
      const meta = await resolveDecimals(assetAddr, chainId);
      decimals = meta.decimals;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: failed to resolve asset decimals for ${assetAddr}: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `failed to resolve asset decimals for ${assetAddr}`,
          message,
        ),
      };
    }

    // "max" path — read position + market totals; compute toAssetsDown.
    let amountWei: bigint;
    let resolvedMaxAssets: bigint | null = null;
    if (rawAmount === "max") {
      let pos: { supplyShares: bigint; borrowShares: bigint; collateral: bigint };
      let mkt: {
        totalSupplyAssets: bigint;
        totalSupplyShares: bigint;
        totalBorrowAssets: bigint;
        totalBorrowShares: bigint;
        lastUpdate: bigint;
        fee: bigint;
      };
      try {
        [pos, mkt] = await Promise.all([
          _morphoChains.readPosition(client, morpho, marketId, onBehalf),
          _morphoChains.readMarket(client, morpho, marketId),
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to read Morpho position+market for max-withdraw: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            "failed to read Morpho position+market for max-withdraw",
            message,
          ),
        };
      }
      if (pos.supplyShares === 0n) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: cannot withdraw \"max\" — no supply position on this market (supplyShares === 0n)",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "no supply position to withdraw — supplyShares === 0n",
          ),
        };
      }
      amountWei = toAssetsDown(pos.supplyShares, mkt.totalSupplyAssets, mkt.totalSupplyShares);
      resolvedMaxAssets = amountWei;
    } else {
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
          content: [{ type: "text", text: `error: invalid 'amount': ${message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", `invalid 'amount': ${message}`),
        };
      }
    }

    const data: Hex = encodeMorphoWithdraw(params, amountWei, 0n, onBehalf, receiver);

    const tx = {
      chainId,
      to: morpho,
      valueWei: 0n,
      data,
    };

    const payloadFingerprint = computePayloadFingerprint(tx);

    const handle = createHandle({
      args: {
        to: morpho,
        valueWei: "0",
        tokenAddress: rawAsset,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    const marketLabel = lookupMarketLabel(marketId);
    const baseReceipt = MORPHO_WITHDRAW_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
      .replace("{MARKET_ID}", marketId)
      .replace("{MARKET_LABEL}", marketLabel)
      .replace("{ASSET}", rawAsset)
      .replace("{AMOUNT}", rawAmount)
      .replace("{ONBEHALF}", onBehalf)
      .replace("{RECEIVER}", receiver);
    const receiptWithFrom = fromCallerSupplied
      ? `${baseReceipt}\n  from:         ${rawFrom}`
      : baseReceipt;
    const receipt =
      resolvedMaxAssets !== null
        ? `${receiptWithFrom}\n\nCHECKS PERFORMED\n  Withdraw-max resolved: assets=${resolvedMaxAssets.toString()} (toAssetsDown(supplyShares, totals); rounded DOWN, conservative).`
        : receiptWithFrom;

    const structuredContent: Record<string, unknown> = {
      handle,
      chain: chainName,
      chainId,
      marketId,
      marketLabel: REGISTRY.get(marketId.toLowerCase())?.label ?? null,
      asset: rawAsset,
      amount: rawAmount,
      amountWei: amountWei.toString(),
      onBehalf,
      receiver,
      from: fromAddress,
      payloadFingerprint,
    };
    if (resolvedMaxAssets !== null) {
      structuredContent.resolvedMaxAssets = resolvedMaxAssets.toString();
    }

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_morpho_withdraw failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_morpho_withdraw failed", message),
    };
  }
});
