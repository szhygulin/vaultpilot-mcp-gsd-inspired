// MCP tool: prepare_morpho_supply({ chain, marketId, asset, amount, onBehalf?, from? })
//
// Phase 29 — Plan 29-03 (MOR-02 supply leg). Structural mirror of
// `prepare_compound_supply.ts` (Phase 28 Plan 28-02) with Morpho-specific
// deviations:
//
//   (a) Input schema: `{ chain: "ethereum", marketId: bytes32-hex, asset,
//       amount, onBehalf?, from? }`. v2.3 mainnet-only; v2.3.x widens to
//       Base + Polygon.
//   (b) tx.to = `getMorphoBlueAddress(1)!` (single singleton; NOT a Comet
//       allowlist — Morpho has ONE contract).
//   (c) Intent-vs-reality gate (research § Pattern 2): read
//       `_morphoChains.readMarketParams(marketId)`. If `loanToken === 0x0...0`
//       → INVALID_INPUT "market does not exist". Defense-in-depth — re-derive
//       `_morphoBlue.deriveMarketId(returnedParams)` and assert equality with
//       input marketId; mismatch → INTERNAL_ERROR (should never fire).
//   (d) Asset-match gate (research § Pitfall 2): `args.asset === marketParams.
//       loanToken`. Mismatch → INVALID_INPUT + `structuredContent.hintTool:
//       "prepare_morpho_supply_collateral"` (if asset === collateralToken)
//       OR a generic correction (if asset matches neither). The asset-match
//       gate is the canonical defense against supply-vs-supplyCollateral
//       confusion.
//   (e) Approval pre-flight (research § Pitfall 6): read
//       `ERC20.allowance(onBehalf, getMorphoBlueAddress(1)!)`. If
//       `allowance < amountWei`, set `preFlightNote` with a structured
//       template; ADVISORY ONLY — never a refusal (mirrors Phase 19 SunSwap).
//   (f) Encoder: `encodeMorphoSupply(params, amountWei, 0n, onBehalf, "0x")`
//       — asset-based supply; shares=0n.
//   (g) "max" NOT accepted — parseAmountStrict rejects via regex
//       (kind: "format"). Only `prepare_morpho_withdraw` + `prepare_morpho_repay`
//       accept "max".
//   (h) PREPARE RECEIPT via `MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE` — verbatim
//       agent args (CLAUDE.md Conventions).
//
// NO LEDGER NOTICE block at prepare time. Morpho IS in the LedgerHQ ERC-7730
// clear-signing registry — opposite of Phase 28 Compound. The device
// clear-signs the decoded MarketParams + amount + onBehalf fields.

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
  encodeMorphoSupply,
  type MorphoMarketParams,
} from "../protocols/morpho-blue.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
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

/**
 * Module-scope registry lookup keyed by lowercased marketId. Loaded once at
 * import time from the 25-entry curated registry (Plan 29-01). Consumers
 * use the helper `lookupMarketLabel` to surface the label slot in PREPARE
 * RECEIPT; off-list markets emit `"(unlabeled market)"`.
 */
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
  "Prepare an unsigned Morpho Blue supply(marketParams, assets, 0, onBehalf, 0x) call on Ethereum mainnet — deposits the agent-supplied LOAN ASSET into a specified isolated market to earn interest (lender position).",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to lend into a Morpho Blue market. Asset MUST match the market's loanToken — REFUSED with INVALID_INPUT + structuredContent.hintTool: \"prepare_morpho_supply_collateral\" if the agent passes the collateralToken (the agent meant to post collateral, not supply).",
  "Do NOT use for supplyCollateral / withdraw / borrow / repay / withdrawCollateral — call prepare_morpho_supply_collateral / prepare_morpho_withdraw / prepare_morpho_borrow / prepare_morpho_repay / prepare_morpho_withdraw_collateral respectively.",
  "Do NOT use for Aave / Compound — call prepare_aave_supply / prepare_compound_supply respectively.",
  "`chain` is REQUIRED and v2.3-locked to \"ethereum\". v2.3.x widens to Base + Polygon once Morpho deployments are seeded for those chains.",
  "`marketId` is REQUIRED — the 32-byte hex marketId (e.g. 0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc for wstETH/USDC). The server cross-checks via Morpho's idToMarketParams(marketId) read; non-existent markets refuse with INVALID_INPUT \"market does not exist\".",
  "`asset` is the loanToken ERC-20 contract address — MUST match marketParams.loanToken (refused otherwise with hintTool pointing at prepare_morpho_supply_collateral).",
  "`amount` is a DECIMAL STRING in human units (e.g. \"100.5\" for 100.5 USDC). The literal \"max\" is NOT accepted (only prepare_morpho_withdraw + prepare_morpho_repay accept it).",
  "REQUIRES prior ERC-20 approval of the loanToken for the Morpho Blue contract — the server emits a PRE-FLIGHT NOTE in CHECKS PERFORMED if allowance(onBehalf, Morpho) < amount; call prepare_token_approve first if so.",
  "`onBehalf` defaults to the resolved sender (`from` or active account). Pass explicitly to supply on behalf of a different account.",
  "Morpho Blue calldata IS covered by the Ledger ERC-7730 clear-sign registry — the device clear-signs the decoded MarketParams + amount + onBehalf fields. No blind-sign blast.",
  "Requires a paired Ledger (real mode) or active persona (demo mode).",
  "Returns `{ handle, chain, chainId, marketId, marketLabel?, asset, amount, amountWei, onBehalf, from, payloadFingerprint, preFlightNote? }` plus a PREPARE RECEIPT text block surfacing the verbatim args.",
  "Failure modes: WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode is on but no persona set OR `from` doesn't match the active persona, INVALID_INPUT if chain/marketId/asset/amount/onBehalf/from malformed (including non-existent market, asset-match gate refusal with hintTool, \"max\" rejection, fractional-overflow vs token decimals), INVALID_ACCOUNT if `from` is not in the per-chain approved set, INTERNAL_ERROR if RPC fails resolving market params OR allowance OR asset decimals OR if deriveMarketId(params) disagrees with the input marketId.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier (required). v2.3 supports ONLY ethereum; v2.3.x widens to Base + Polygon.",
    },
    marketId: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{64}$",
      description:
        "32-byte Morpho Blue marketId hex. The server cross-checks against the on-chain idToMarketParams mapping.",
    },
    asset: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "ERC-20 asset address — MUST be the market's loanToken. Refused with hintTool: prepare_morpho_supply_collateral if it matches the collateralToken.",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in human units (e.g. \"100.5\"). The literal \"max\" is NOT accepted (use prepare_morpho_withdraw or prepare_morpho_repay if the intent is full-position close).",
    },
    onBehalf: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional — the account whose lender position the supply credits. Defaults to the resolved sender.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts in `get_ledger_status.accountsByChain[chainId]`. Omit to use the active account.",
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

/**
 * Read ERC-20 allowance(owner, spender). Returns `null` on RPC failure — the
 * pre-flight note is ADVISORY, not load-bearing; a failed read leaves the
 * note unset (the tx may revert on-chain, which the user sees via simulation
 * at preview time).
 */
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

registerTool("prepare_morpho_supply", DESCRIPTION, INPUT_SCHEMA, async (args) => {
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
          {
            type: "text",
            text: `error: invalid 'marketId': expected 0x-prefixed 32-byte hex, got "${rawMarketId}"`,
          },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'marketId': ${rawMarketId}`),
      };
    }
    const marketId = rawMarketId as Hex;

    const rawAsset = typeof args.asset === "string" ? args.asset : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawAsset)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'asset': expected 0x-prefixed 20-byte hex, got "${rawAsset}"`,
          },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'asset': ${rawAsset}`),
      };
    }

    const rawAmount = typeof args.amount === "string" ? args.amount : "";

    // SENDER resolution (verbatim from Phase 28 prepare_compound_*).
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    // onBehalf defaults to the resolved sender — Morpho's lender position
    // ledger credits the `onBehalf` account.
    const rawOnBehalf = typeof args.onBehalf === "string" ? args.onBehalf : undefined;
    if (rawOnBehalf !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(rawOnBehalf)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'onBehalf': expected 0x-prefixed 20-byte hex, got "${rawOnBehalf}"`,
          },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'onBehalf': ${rawOnBehalf}`),
      };
    }
    const onBehalf: Address = rawOnBehalf ? getAddress(rawOnBehalf) : fromAddress;

    const assetAddr = getAddress(rawAsset) as Address;
    const morpho = getMorphoBlueAddress(chainId);
    if (!morpho) {
      // Defense in depth — schema enum + chainName check above guarantee
      // chainId === 1; getMorphoBlueAddress(1) is statically populated.
      return {
        isError: true,
        content: [{ type: "text", text: "error: Morpho Blue address unavailable" }],
        structuredContent: errEnvelope("INTERNAL_ERROR", "Morpho Blue address unavailable"),
      };
    }

    // Intent-vs-reality gate — read on-chain MarketParams; refuse if the
    // market does not exist (zero-address loanToken). Defense-in-depth:
    // re-derive marketId and assert equality with input.
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
            text: `error: Morpho market ${marketId} does not exist on this chain (idToMarketParams returned zero-address loanToken)`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `Morpho market ${marketId} does not exist on this chain`,
        ),
      };
    }

    // Defense-in-depth marketId re-derivation (T-MARKET-ID-DRIFT mitigation).
    const derivedMarketId = _morphoBlue.deriveMarketId(params);
    if (derivedMarketId.toLowerCase() !== marketId.toLowerCase()) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `error: Morpho market-id drift — input marketId=${marketId} but ` +
              `deriveMarketId(returnedParams)=${derivedMarketId}. This indicates an on-chain bug; ` +
              `should never fire in practice.`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `Morpho market-id drift: input=${marketId} derived=${derivedMarketId}`,
        ),
      };
    }

    // Asset-match gate — for `prepare_morpho_supply`, asset MUST match
    // loanToken. Mismatch with collateralToken → hint at supply_collateral;
    // mismatch with neither → generic correction.
    if (getAddress(assetAddr) !== getAddress(params.loanToken)) {
      const isCollateral = getAddress(assetAddr) === getAddress(params.collateralToken);
      const refusalMessage = isCollateral
        ? `prepare_morpho_supply received the market's collateralToken (${rawAsset}) but supply expects the loanToken (${params.loanToken}). ` +
          "This is a collateral post, not a supply — call prepare_morpho_supply_collateral with the same args."
        : `prepare_morpho_supply asset ${rawAsset} matches neither marketParams.loanToken (${params.loanToken}) nor collateralToken (${params.collateralToken}). ` +
          "Verify the marketId / asset combination — for a collateral post, call prepare_morpho_supply_collateral.";
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${refusalMessage}` }],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", refusalMessage),
          hintTool: "prepare_morpho_supply_collateral",
        },
      };
    }

    // Resolve decimals against the loanToken. Registry-cache-first; live RPC
    // on miss.
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

    // Parse amount strictly. "max" rejects via the strict regex (kind:
    // "format") — supply does NOT accept the lowercase sentinel.
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

    // Approval pre-flight (research § Pitfall 6) — ADVISORY, never a refusal.
    const allowance = await readAllowance(client, assetAddr, onBehalf, morpho);
    const preFlightNote =
      allowance !== null && allowance < amountWei
        ? buildPreFlightNote(rawAsset, morpho, allowance, amountWei)
        : null;

    // Encoder — asset-based supply (shares=0n).
    const data: Hex = encodeMorphoSupply(params, amountWei, 0n, onBehalf, "0x");

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
    const baseReceipt = MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE
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
        { type: "text", text: `error: prepare_morpho_supply failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_morpho_supply failed", message),
    };
  }
});
