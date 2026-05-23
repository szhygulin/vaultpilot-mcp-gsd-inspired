// MCP tool: prepare_morpho_repay({ chain, marketId, asset, amount, onBehalf?, from? })
//
// Phase 29 — Plan 29-03 (MOR-04 repay leg). The most complex prepare tool of
// the 6 due to the repay-max idiom (research § Topic 5 + § Pitfall 3):
//
//   - args.amount === "max" → read `position.borrowShares` at prepare time
//     via `_morphoChains.readPosition`; encode
//     `repay(params, 0n, borrowShares, onBehalf, "0x")` (assets=0; shares =
//     actual-borrowShares). NOT MAX_UINT256 — Morpho does not honor that
//     sentinel (the encoder's exactlyOneZero invariant would catch it, but
//     the tool-layer rejects MAX_UINT256 explicitly).
//   - PREPARE RECEIPT renders `amount: max` VERBATIM (CLAUDE.md Conventions);
//     the CHECKS PERFORMED block surfaces the resolved borrowShares for
//     transparency.
//   - args.amount === MAX_UINT256.toString() → INVALID_INPUT pointing at the
//     documented "max" lowercase string sentinel (research § Pitfall 3 anti-
//     pattern).
//
// Asset-match against loanToken; approval pre-flight against loanToken
// (Morpho calls safeTransferFrom on the loanToken to clear debt).

import { type Address, type Hex, erc20Abi, getAddress } from "viem";

import { _morphoChains } from "../chains/morpho-blue.js";
import { getChainClient } from "../chains/registry.js";
import {
  chainIdFromName,
  getMorphoBlueAddress,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { MAX_UINT256 } from "../protocols/erc20.js";
import {
  _morphoBlue,
  encodeMorphoRepay,
  type MorphoMarketParams,
} from "../protocols/morpho-blue.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { MORPHO_REPAY_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { toAssetsUp } from "../signing/morpho-shares-math.js";
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

// MAX_UINT256 decimal-string for the anti-pattern rejection check
// (research § Pitfall 3). The agent must NOT pass this — the lowercase "max"
// sentinel is the canonical idiom; the server resolves to actual
// borrowShares at prepare time.
const MAX_UINT256_DECIMAL_STRING =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

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
  "Prepare an unsigned Morpho Blue repay call on Ethereum mainnet — repays outstanding debt on a market.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to repay debt on a Morpho market. Asset MUST match the market's loanToken — REFUSED with INVALID_INPUT + hintTool: \"prepare_morpho_supply_collateral\" if asset does not match (typically because the agent confused the side; supply_collateral is the generic correction for the borrow-prep family).",
  "Accepts amount: \"max\" (LOWERCASE only — T-MAX-SPELLING-1) to close the full debt position — server reads position.borrowShares at prepare time and encodes the exact share count via encodeMorphoRepay(params, 0n, borrowShares, onBehalf, \"0x\"). NOT MAX_UINT256 — Morpho does NOT honor that sentinel; the server explicitly rejects the MAX_UINT256 decimal string with INVALID_INPUT pointing at the \"max\" sentinel (research § Pitfall 3).",
  "REQUIRES prior ERC-20 approval of the loanToken for the Morpho Blue contract — the server emits a PRE-FLIGHT NOTE in CHECKS PERFORMED if allowance is insufficient.",
  "PREPARE RECEIPT renders amount: max VERBATIM (NOT the resolved share count). The DECODED ARGS block at preview time surfaces the resolved shares value.",
  "`chain` REQUIRED — v2.3-locked to \"ethereum\". `marketId` REQUIRED — 32-byte hex.",
  "`asset` MUST be marketParams.loanToken. `onBehalf` defaults to the resolved sender (the borrower whose debt is reduced). NO `receiver` field — repay has no receiver arg.",
  "Returns `{ handle, chain, chainId, marketId, marketLabel?, asset, amount, amountWei (resolved-assets-equivalent for max; original for concrete), resolvedBorrowShares? (only for max), onBehalf, from, payloadFingerprint, preFlightNote? }` plus a PREPARE RECEIPT.",
  "Failure modes: WALLET_NOT_PAIRED / WRONG_MODE / INVALID_INPUT (chain/marketId/asset/amount/onBehalf/from malformed; non-existent market; asset-match gate; MAX_UINT256 anti-pattern; \"max\" with zero borrowShares; fractional-overflow) / INVALID_ACCOUNT / INTERNAL_ERROR (RPC failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum"] },
    marketId: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
    asset: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "ERC-20 asset address — MUST be marketParams.loanToken.",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in human units OR the literal lowercase \"max\" (resolves to position.borrowShares server-side; NOT MAX_UINT256 — Morpho does not honor that sentinel).",
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

/**
 * Phase 29 WR-03: repay-max pre-flight note. The repay-max branch encodes
 * share-based repay (assets=0, shares=borrowShares) so the on-chain
 * safeTransferFrom pulls the assetsRepaid value resolved at tx time AFTER
 * accrueInterest — a value strictly >= the stale prepare-time toAssetsUp
 * figure for accruing markets. The canonical idiom is therefore to approve
 * MAX_UINT256: any allowance short of that may revert when accrued interest
 * pushes the asset requirement above the stale snapshot.
 */
function buildRepayMaxPreFlightNote(
  asset: string,
  spender: Address,
  currentAllowance: bigint,
  staleAssetsEstimate: bigint,
): string {
  return (
    `PRE-FLIGHT NOTE (repay-max): share-based repay-max encodes shares directly; the on-chain ` +
    `safeTransferFrom pulls assetsRepaid resolved at tx time AFTER accrueInterest, NOT the ` +
    `pre-flight estimate ${staleAssetsEstimate.toString()} (which is toAssetsUp against STALE ` +
    `market totals). Current ERC-20 allowance(${asset}, ${spender}) is ${currentAllowance.toString()} — ` +
    `for repay-max the canonical idiom is a MAX_UINT256 approval. Call prepare_token_approve({ ` +
    `tokenAddress: ${asset}, spender: ${spender}, amount: 'max' }) before sending this transaction — ` +
    `without max approval an accrued-interest gap between prepare time and tx time can cause revert.`
  );
}

registerTool("prepare_morpho_repay", DESCRIPTION, INPUT_SCHEMA, async (args) => {
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

    // MAX_UINT256 anti-pattern rejection (research § Pitfall 3) — fires
    // BEFORE the RPC reads to short-circuit the wrong-sentinel attempt with a
    // structured hint.
    if (rawAmount === MAX_UINT256_DECIMAL_STRING) {
      const refusalMessage =
        "prepare_morpho_repay does NOT accept MAX_UINT256 (Compound's sentinel). Morpho's canonical " +
        "repay-max idiom is share-based: pass amount: \"max\" (lowercase string sentinel); the server " +
        "reads position.borrowShares at prepare time and encodes repay(params, 0, borrowShares, ...).";
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${refusalMessage}` }],
        structuredContent: errEnvelope("INVALID_INPUT", refusalMessage),
      };
    }

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

    // Asset-match gate — asset MUST be loanToken.
    if (getAddress(assetAddr) !== getAddress(params.loanToken)) {
      const refusalMessage =
        `prepare_morpho_repay asset ${rawAsset} does not match marketParams.loanToken (${params.loanToken}). ` +
        "Repay reduces debt denominated in the loanToken — verify the marketId / asset combination.";
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

    // Two paths:
    //   - args.amount === "max" → read position.borrowShares, encode
    //     share-based repay (assets=0, shares=borrowShares).
    //   - concrete amount → parseAmountStrict, encode asset-based repay
    //     (assets=amountWei, shares=0).
    let data: Hex;
    let amountWei: bigint;
    let resolvedBorrowShares: bigint | null = null;
    let assetsForApprovalThreshold: bigint;

    if (rawAmount === "max") {
      let position: { supplyShares: bigint; borrowShares: bigint; collateral: bigint };
      let mkt: {
        totalSupplyAssets: bigint;
        totalSupplyShares: bigint;
        totalBorrowAssets: bigint;
        totalBorrowShares: bigint;
        lastUpdate: bigint;
        fee: bigint;
      };
      try {
        [position, mkt] = await Promise.all([
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
              text: `error: failed to read Morpho position+market for repay-max: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            "failed to read Morpho position+market for repay-max",
            message,
          ),
        };
      }
      if (position.borrowShares === 0n) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: No outstanding borrow on this market (position.borrowShares === 0n) — nothing to repay",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "No outstanding borrow on this market — nothing to repay",
          ),
        };
      }
      resolvedBorrowShares = position.borrowShares;
      // Approval threshold for the pre-flight note — use toAssetsUp (rounded
      // UP, conservative; the actual on-chain transfer may be slightly less).
      assetsForApprovalThreshold = toAssetsUp(
        position.borrowShares,
        mkt.totalBorrowAssets,
        mkt.totalBorrowShares,
      );
      amountWei = assetsForApprovalThreshold;
      data = encodeMorphoRepay(params, 0n, position.borrowShares, onBehalf, "0x");
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
      assetsForApprovalThreshold = amountWei;
      data = encodeMorphoRepay(params, amountWei, 0n, onBehalf, "0x");
    }

    // Approval pre-flight on the loanToken — Morpho calls safeTransferFrom
    // to pull tokens IN from the borrower.
    //
    // Phase 29 WR-03: the repay-max branch encodes shares (not assets); the
    // on-chain assetsRepaid is post-accrueInterest, strictly >= the stale
    // toAssetsUp figure. The threshold comparison is therefore
    //   `allowance < MAX_UINT256`
    // — any partial approval may revert when interest accrues between prepare
    // time and tx time. The fixed-amount branch keeps the existing
    // `allowance < amountWei` comparison since the asset transfer is the
    // encoded value exactly.
    const allowance = await readAllowance(client, assetAddr, onBehalf, morpho);
    const isRepayMax = resolvedBorrowShares !== null;
    let preFlightNote: string | null = null;
    if (allowance !== null) {
      if (isRepayMax) {
        if (allowance < MAX_UINT256) {
          preFlightNote = buildRepayMaxPreFlightNote(
            rawAsset,
            morpho,
            allowance,
            assetsForApprovalThreshold,
          );
        }
      } else if (allowance < assetsForApprovalThreshold) {
        preFlightNote = buildPreFlightNote(
          rawAsset,
          morpho,
          allowance,
          assetsForApprovalThreshold,
        );
      }
    }

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
    const baseReceipt = MORPHO_REPAY_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
      .replace("{MARKET_ID}", marketId)
      .replace("{MARKET_LABEL}", marketLabel)
      .replace("{ASSET}", rawAsset)
      .replace("{AMOUNT}", rawAmount)
      .replace("{ONBEHALF}", onBehalf);
    const receiptWithFrom = fromCallerSupplied
      ? `${baseReceipt}\n  from:         ${rawFrom}`
      : baseReceipt;

    const checksLines: string[] = [];
    if (resolvedBorrowShares !== null) {
      checksLines.push(
        `Repay-max resolved: borrowShares=${resolvedBorrowShares.toString()} (read at prepare time; ` +
          `on-chain accrueInterest at tx time may add small additional debt — share-based encoding ` +
          `closes the position exactly per SharesMathLib.toAssetsUp).`,
      );
    }
    if (preFlightNote !== null) {
      checksLines.push(preFlightNote);
    }
    const receipt =
      checksLines.length > 0
        ? `${receiptWithFrom}\n\nCHECKS PERFORMED\n  ${checksLines.join("\n  ")}`
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
    if (resolvedBorrowShares !== null) {
      structuredContent.resolvedBorrowShares = resolvedBorrowShares.toString();
      // Phase 29 WR-03: annotate the amountWei semantic explicitly for the
      // repay-max path. amountWei here carries the pre-flight toAssetsUp
      // approval-threshold estimate against STALE market totals — NOT the
      // encoded calldata value (which is shares; surfaced separately as
      // resolvedBorrowShares) and NOT the actual on-chain transfer amount
      // (which is assetsRepaid at tx time, post-accrueInterest, generally
      // slightly higher).
      structuredContent.repayMaxAmountWeiNote =
        "amountWei is the pre-flight toAssetsUp approval-threshold estimate against STALE market " +
        "totals — NOT the encoded calldata value (which is shares; see resolvedBorrowShares) and " +
        "NOT the actual on-chain transfer amount (assetsRepaid at tx time after accrueInterest, " +
        "generally slightly higher). The canonical repay-max approval is MAX_UINT256.";
    }
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
        { type: "text", text: `error: prepare_morpho_repay failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_morpho_repay failed", message),
    };
  }
});
