// MCP tool: prepare_morpho_borrow({ chain, marketId, asset, amount, onBehalf?, receiver?, from? })
//
// Phase 29 — Plan 29-03 (MOR-03 borrow leg). Asset-match against loanToken
// (borrow returns the loanToken to the receiver) PLUS a Morpho-specific
// pre-encode gate: collateral-present check (research § Pattern 2). If
// `position.collateral === 0n`, the on-chain borrow reverts (no collateral →
// undercollateralized). The prepare-time check surfaces a structured refusal
// + hintTool: "prepare_morpho_supply_collateral" so the agent can self-correct.
//
// NO approval pre-flight — borrow transfers tokens TO user, not FROM user.
// "max" NOT accepted — borrowing the entire credit ceiling is an anti-pattern.

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
  encodeMorphoBorrow,
  type MorphoMarketParams,
} from "../protocols/morpho-blue.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { MORPHO_BORROW_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
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
  "Prepare an unsigned Morpho Blue borrow(marketParams, assets, 0, onBehalf, receiver) call on Ethereum mainnet — borrows the LOAN ASSET from a market against posted collateral.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to open or increase a debt position. Asset MUST match the market's loanToken — REFUSED with INVALID_INPUT + hintTool: \"prepare_morpho_supply_collateral\" if the agent passes a non-loanToken (typically because the agent meant to post collateral first).",
  "REQUIRES collateral already posted via prepare_morpho_supply_collateral — REFUSED with INVALID_INPUT + hintTool: \"prepare_morpho_supply_collateral\" if position.collateral === 0n (research § Pattern 2; the on-chain borrow reverts otherwise).",
  "NO approval pre-flight — borrow transfers tokens FROM Morpho TO the receiver; no allowance required.",
  "`chain` is REQUIRED and v2.3-locked to \"ethereum\". `marketId` REQUIRED — 32-byte hex.",
  "`asset` MUST be marketParams.loanToken. `onBehalf` defaults to the resolved sender (the borrower; debt sits on position(id, onBehalf).borrowShares). `receiver` defaults to onBehalf (the recipient of the borrowed tokens).",
  "`amount` is a DECIMAL STRING (e.g. \"50\" for 50 USDC). \"max\" NOT accepted — borrowing the entire credit ceiling pushes to liquidation.",
  "Morpho Blue calldata IS in the Ledger ERC-7730 clear-sign registry — device clear-signs decoded MarketParams + amount + receiver. No blind-sign.",
  "Returns `{ handle, chain, chainId, marketId, marketLabel?, asset, amount, amountWei, onBehalf, receiver, from, payloadFingerprint }` plus a PREPARE RECEIPT.",
  "Failure modes: WALLET_NOT_PAIRED / WRONG_MODE / INVALID_INPUT (chain/marketId/asset/amount/onBehalf/receiver/from malformed; non-existent market; asset-match gate refusal with hintTool; no-collateral gate refusal with hintTool; \"max\" rejection; fractional-overflow) / INVALID_ACCOUNT / INTERNAL_ERROR (RPC failure resolving params / position / decimals; marketId drift).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum"] },
    marketId: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
    asset: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "ERC-20 asset address — MUST be marketParams.loanToken. Refused with hintTool: prepare_morpho_supply_collateral if it does not match.",
    },
    amount: {
      type: "string",
      description: "Decimal string in human units. \"max\" NOT accepted.",
    },
    onBehalf: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    receiver: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
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

registerTool("prepare_morpho_borrow", DESCRIPTION, INPUT_SCHEMA, async (args) => {
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

    // Asset-match gate — asset MUST be loanToken; hint at supply_collateral
    // as the universal correction (the borrow-prep entry point).
    if (getAddress(assetAddr) !== getAddress(params.loanToken)) {
      const refusalMessage =
        `prepare_morpho_borrow asset ${rawAsset} does not match marketParams.loanToken (${params.loanToken}). ` +
        "Borrowing returns the loanToken — verify the marketId / asset combination; for posting collateral, " +
        "call prepare_morpho_supply_collateral.";
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${refusalMessage}` }],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", refusalMessage),
          hintTool: "prepare_morpho_supply_collateral",
        },
      };
    }

    // Collateral-present check (research § Pattern 2) — refuse pre-encode if
    // position.collateral === 0n (the on-chain borrow would revert).
    let position: { supplyShares: bigint; borrowShares: bigint; collateral: bigint };
    try {
      position = await _morphoChains.readPosition(client, morpho, marketId, onBehalf);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: failed to read Morpho position for ${onBehalf} on ${marketId}: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `failed to read Morpho position for ${onBehalf} on ${marketId}`,
          message,
        ),
      };
    }
    if (position.collateral === 0n) {
      const refusalMessage =
        `prepare_morpho_borrow refused: no collateral posted on market ${marketId} for ${onBehalf} ` +
        `(position.collateral === 0n). Post collateral first via prepare_morpho_supply_collateral, ` +
        `then retry the borrow.`;
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${refusalMessage}` }],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", refusalMessage),
          hintTool: "prepare_morpho_supply_collateral",
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

    const data: Hex = encodeMorphoBorrow(params, amountWei, 0n, onBehalf, receiver);

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
    const baseReceipt = MORPHO_BORROW_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
      .replace("{MARKET_ID}", marketId)
      .replace("{MARKET_LABEL}", marketLabel)
      .replace("{ASSET}", rawAsset)
      .replace("{AMOUNT}", rawAmount)
      .replace("{ONBEHALF}", onBehalf)
      .replace("{RECEIVER}", receiver);
    const receipt = fromCallerSupplied
      ? `${baseReceipt}\n  from:         ${rawFrom}`
      : baseReceipt;

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
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
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_morpho_borrow failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_morpho_borrow failed", message),
    };
  }
});
