// MCP tool: prepare_morpho_supply_collateral({ chain, marketId, asset, amount, onBehalf?, from? })
//
// Phase 29 — Plan 29-03 (MOR-03 collateral leg). Asset-match gate verifies
// asset === marketParams.collateralToken (opposite side of supply). Encoder
// is `encodeMorphoSupplyCollateral(params, amountWei, onBehalf, "0x")` — no
// shares field (Morpho's collateral slot is a raw uint128, NOT a shares
// receipt; research § Topic 2 + § Pitfall 4).
//
// "max" NOT accepted (no canonical sentinel for collateral posts).
//
// Approval pre-flight runs on the collateralToken — required because Morpho
// calls `safeTransferFrom` on the collateral.

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
  encodeMorphoSupplyCollateral,
  type MorphoMarketParams,
} from "../protocols/morpho-blue.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { MORPHO_SUPPLY_COLLATERAL_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
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
  "Prepare an unsigned Morpho Blue supplyCollateral(marketParams, assets, onBehalf, 0x) call on Ethereum mainnet — posts COLLATERAL to a market (does NOT earn interest — collateral is raw amount, not shares).",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to post collateral to enable borrowing on a Morpho market. Asset MUST match the market's collateralToken — REFUSED with INVALID_INPUT + hintTool: \"prepare_morpho_supply\" if the agent passes the loanToken (the agent meant to supply for yield).",
  "REQUIRES prior ERC-20 approval of the collateralToken for the Morpho Blue contract — the server emits a PRE-FLIGHT NOTE in CHECKS PERFORMED if allowance is insufficient.",
  "`chain` is REQUIRED and v2.3-locked to \"ethereum\". `marketId` REQUIRED — 32-byte hex.",
  "`asset` MUST be marketParams.collateralToken. `onBehalf` defaults to the resolved sender — the account whose collateral position the deposit credits. NO `receiver` field — supplyCollateral has no receiver arg (collateral lives in the market on behalf of `onBehalf`).",
  "`amount` is a DECIMAL STRING (e.g. \"1.5\" for 1.5 wstETH). \"max\" is NOT accepted (no canonical sentinel for collateral posts).",
  "Morpho Blue calldata IS in the Ledger ERC-7730 clear-sign registry — device clear-signs decoded MarketParams + amount + onBehalf. No blind-sign.",
  "Returns `{ handle, chain, chainId, marketId, marketLabel?, asset, amount, amountWei, onBehalf, from, payloadFingerprint, preFlightNote? }` plus a PREPARE RECEIPT.",
  "Failure modes: WALLET_NOT_PAIRED / WRONG_MODE / INVALID_INPUT (chain/marketId/asset/amount/onBehalf/from malformed; non-existent market; asset-match gate refusal with hintTool; \"max\" rejection; fractional-overflow) / INVALID_ACCOUNT / INTERNAL_ERROR (RPC failure resolving params / allowance / decimals; marketId drift).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum"] },
    marketId: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{64}$",
      description: "32-byte Morpho Blue marketId hex.",
    },
    asset: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "ERC-20 asset address — MUST be marketParams.collateralToken. Refused with hintTool: prepare_morpho_supply if it matches the loanToken.",
    },
    amount: {
      type: "string",
      description: "Decimal string in human units. \"max\" NOT accepted.",
    },
    onBehalf: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    from: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
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

async function readAllowance(
  client: ReturnType<typeof getChainClient>,
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint | null> {
  try {
    const result = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    });
    return result as bigint;
  } catch {
    return null;
  }
}

function buildPreFlightNote(
  asset: string,
  spender: Address,
  currentAllowance: bigint,
  required: bigint,
): string {
  return (
    `PRE-FLIGHT NOTE: ERC-20 allowance(${asset}, ${spender}) is ${currentAllowance.toString()} ` +
    `but this tx requires ${required.toString()}. Call prepare_token_approve({ tokenAddress: ${asset}, ` +
    `spender: ${spender}, amount: 'max' }) before sending this transaction — without sufficient allowance ` +
    `the on-chain call will revert.`
  );
}

registerTool("prepare_morpho_supply_collateral", DESCRIPTION, INPUT_SCHEMA, async (args) => {
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
        content: [{ type: "text", text: `error: invalid 'marketId': ${rawMarketId}` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'marketId': ${rawMarketId}`),
      };
    }
    const marketId = rawMarketId as Hex;

    const rawAsset = typeof args.asset === "string" ? args.asset : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawAsset)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: invalid 'asset': ${rawAsset}` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'asset': ${rawAsset}`),
      };
    }

    const rawAmount = typeof args.amount === "string" ? args.amount : "";

    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") return fromResolution.result;
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

    // Asset-match gate — asset MUST be collateralToken; hint at supply if
    // loanToken.
    if (getAddress(assetAddr) !== getAddress(params.collateralToken)) {
      const isLoan = getAddress(assetAddr) === getAddress(params.loanToken);
      const refusalMessage = isLoan
        ? `prepare_morpho_supply_collateral received the market's loanToken (${rawAsset}); supplyCollateral expects the collateralToken (${params.collateralToken}). ` +
          "This is a lender-position supply, not a collateral post — call prepare_morpho_supply."
        : `prepare_morpho_supply_collateral asset ${rawAsset} matches neither loanToken (${params.loanToken}) nor collateralToken (${params.collateralToken}). ` +
          "Verify the marketId / asset combination.";
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${refusalMessage}` }],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", refusalMessage),
          hintTool: "prepare_morpho_supply",
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
        content: [{ type: "text", text: `error: invalid 'amount': ${message}` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'amount': ${message}`),
      };
    }

    // Approval pre-flight on the collateralToken.
    const allowance = await readAllowance(client, assetAddr, onBehalf, morpho);
    const preFlightNote =
      allowance !== null && allowance < amountWei
        ? buildPreFlightNote(rawAsset, morpho, allowance, amountWei)
        : null;

    const data: Hex = encodeMorphoSupplyCollateral(params, amountWei, onBehalf, "0x");

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
    const baseReceipt = MORPHO_SUPPLY_COLLATERAL_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
      .replace("{MARKET_ID}", marketId)
      .replace("{MARKET_LABEL}", marketLabel)
      .replace("{ASSET}", rawAsset)
      .replace("{AMOUNT}", rawAmount)
      .replace("{ONBEHALF}", onBehalf);
    const receiptWithFrom = fromCallerSupplied
      ? `${baseReceipt}\n  from:         ${rawFrom}`
      : baseReceipt;
    const receipt =
      preFlightNote !== null
        ? `${receiptWithFrom}\n\nCHECKS PERFORMED\n  ${preFlightNote}`
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
      from: fromAddress,
      payloadFingerprint,
    };
    if (preFlightNote !== null) structuredContent.preFlightNote = preFlightNote;

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: prepare_morpho_supply_collateral failed: ${message}`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "prepare_morpho_supply_collateral failed",
        message,
      ),
    };
  }
});
