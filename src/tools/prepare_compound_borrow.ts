// MCP tool: prepare_compound_borrow({ chain, comet, asset, amount, from? })
//
// Phase 28 — Plan 28-03 (CMP-05 borrow leg). Mechanical clone of
// `prepare_compound_withdraw.ts` (Plan 28-02) with bounded deviations:
//
//   (a) Encoder = `encodeCompoundWithdraw(asset, amountWei)` from Plan 28-01.
//       SAME selector as `prepare_compound_withdraw`: research § Topic 3
//       Decision lock — Compound V3's `Comet.withdraw(asset, amount)` against
//       a wallet with zero base supply IS the borrow operation at the
//       protocol level (the protocol mints debt to satisfy the transfer,
//       collateralized by other supplied assets). The 2 selectors / 4 intents
//       structure is intentional: the calldata is identical for
//       withdraw-collateral / base-withdraw / borrow; the agent-facing INTENT
//       discriminator lives at the tool name + the intent-gate.
//   (b) Intent-gate prologue uses `selector: "withdraw"` and REFUSES on
//       `intent === "withdraw-collateral"`. The reverse direction of
//       `prepare_compound_withdraw`: this tool routes BORROW; an intent of
//       "withdraw-collateral" means the agent's args describe a withdraw
//       (either a non-base asset OR base asset with an existing supply
//       position) — refuse with INVALID_INPUT + `structuredContent.hintTool:
//       "prepare_compound_withdraw"`.
//   (c) `amount: "max"` is NOT accepted. Research § Topic 4 — borrowing the
//       entire credit ceiling is an anti-pattern: it over-borrows to
//       liquidation; not a meaningful default. parseAmountStrict's regex
//       rejects `"max"` (and other spellings) as INVALID_INPUT kind
//       `"format"`. No special-cased branch needed in this handler.
//   (d) PREPARE RECEIPT uses `COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE` —
//       4-slot (chain + comet + asset + amount). The `{AMOUNT}` slot renders
//       the verbatim agent decimal string.
//   (e) `structuredContent.intent: "borrow"` (the only happy-path label —
//       the deriveIntent helper returns "borrow" exactly when (selector ===
//       "withdraw") AND (asset === baseToken) AND (balanceOf === 0n)).
//
// Refusal-path optimization: when the intent gate refuses, the handler makes
// ONE extra RPC read (`readBaseToken`) to surface the actual base-asset
// address in the human-readable refusal message — agent self-correction
// signal. The extra read costs nothing on the happy path. Documented in
// 28-03-PLAN.md execution_context.
//
// NO LEDGER NOTICE block at prepare time — Compound calldata is not in the
// Ledger ERC-7730 clear-sign registry; the NOTICE surfaces at preview time
// (Plan 28-04), not prepare time.

import { type Address, type Hex, erc20Abi, getAddress } from "viem";

import { _compoundChains } from "../chains/compound-v3.js";
import { getChainClient } from "../chains/registry.js";
import {
  chainIdFromName,
  getAllCompoundCometsForChain,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { encodeCompoundWithdraw } from "../protocols/compound-v3.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
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

const DESCRIPTION = [
  "Prepare an unsigned Compound V3 borrow on Ethereum mainnet — borrows the Comet's base asset against a healthy collateral position. Compound V3's withdraw(base, amount) against a wallet with zero base-supply position IS the borrow operation at the protocol level; this tool emits that exact calldata with the agent-facing intent named explicitly as `borrow`.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to borrow the Comet's base asset (USDC for cUSDCv3; WETH for cWETHv3; etc.) against collateral they've previously supplied to the same Comet.",
  "REQUIRES the Comet's base asset. REFUSES with INVALID_INPUT + structuredContent.hintTool: \"prepare_compound_withdraw\" in two scenarios: (a) `asset` is a collateral asset (non-base) — that's a collateral withdraw, call prepare_compound_withdraw; (b) `asset` is the base asset AND the wallet has an existing supply position — Compound treats that as a base-asset withdraw (returns supplied principal), not a new borrow.",
  "Does NOT accept amount: \"max\" — borrowing the entire credit ceiling is an anti-pattern (over-borrows to liquidation; not a meaningful default). Pass a concrete decimal amount.",
  "Do NOT use for supply / withdraw / repay — call prepare_compound_supply / prepare_compound_withdraw / prepare_compound_repay respectively.",
  "Do NOT use for non-Compound lending — Aave V3 doesn't have a prepare_aave_borrow tool in v1.x (v2.4+ scope); Morpho / Spark / etc. are v2.4+ scope.",
  "`chain` is REQUIRED and v2.3-locked to \"ethereum\". v2.3.x widens to Polygon / Arbitrum / Base / Optimism once Compound V3 mainnet markets are seeded for those chains.",
  "`comet` is REQUIRED — the explicit Comet address (one of 6 canonical Ethereum mainnet markets: cUSDCv3 / cUSDTv3 / cWETHv3 / cUSDSv3 / cwstETHv3 / cWBTCv3). The server validates against the canonical allowlist BEFORE any RPC read.",
  "`asset` is the underlying ERC-20 contract address — MUST be the Comet's base asset (cUSDCv3 → USDC; cWETHv3 → WETH; cUSDTv3 → USDT; cUSDSv3 → USDS; cwstETHv3 → wstETH; cWBTCv3 → WBTC). `amount` is a DECIMAL STRING in human units (e.g. \"100.5\" for 100.5 USDC).",
  "Compound V3 calldata is NOT covered by the Ledger ERC-7730 clear-sign registry — the device will BLIND-SIGN (display a raw hash). preview_send emits a LEDGER NOTICE block at preview time explaining the blind-sign expectation; the cryptographic anchor is the on-device hash match against the PREDICTED hash this tool produces.",
  "Pass `from` when the user wants to act from a non-default approved account (visible in `get_ledger_status.accountsByChain[chainId]`); otherwise omit and the active account is used. The borrowed tokens are transferred to msg.sender — passing `from` redirects both the sender and the recipient to that account.",
  "Requires a paired Ledger (real mode) or active persona (demo mode).",
  "Returns `{ handle, chain, chainId, comet, from, asset, amount, amountWei, intent, payloadFingerprint }` plus a PREPARE RECEIPT text block surfacing the verbatim args.",
  "Failure modes: WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode is on but no persona set OR `from` doesn't match the active persona, INVALID_INPUT if chain/comet/asset/amount/from malformed (including non-canonical Comet, intent-mismatch withdraw routing with hintTool, \"max\" rejection, fractional-overflow vs token decimals), INVALID_ACCOUNT if `from` is not in the per-chain approved set, INTERNAL_ERROR if RPC fails resolving asset decimals OR the intent-gate baseToken / balanceOf reads.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier (required). v2.3 supports ONLY ethereum; v2.3.x widens to Polygon / Arbitrum / Base / Optimism.",
    },
    comet: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "The Compound V3 Comet contract address (required). MUST be one of the 6 canonical Ethereum mainnet markets: cUSDCv3 / cUSDTv3 / cWETHv3 / cUSDSv3 / cwstETHv3 / cWBTCv3. Refused (INVALID_INPUT) if not in the canonical allowlist.",
    },
    asset: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "ERC-20 asset address — MUST be the Comet's base asset (the only borrowable asset in the market). Refused with INVALID_INPUT + hintTool prepare_compound_withdraw if a collateral asset is passed.",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in human units (e.g. \"100.5\"). The literal \"max\" is NOT accepted — borrowing the entire credit ceiling is an anti-pattern. Pass a concrete decimal.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts in `get_ledger_status.accountsByChain[chainId]`. Omit to use the active account. In demo mode, must match the active persona's address.",
    },
  },
  required: ["chain", "comet", "asset", "amount"],
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

registerTool("prepare_compound_borrow", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const chainName = args.chain as ChainName;
    if (chainName !== "ethereum") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'chain': Compound V3 v2.3 supports only 'ethereum', got "${chainName}"`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'chain': Compound V3 v2.3 supports only 'ethereum', got "${chainName}"`,
        ),
      };
    }
    const chainId = chainIdFromName(chainName);

    const rawComet = typeof args.comet === "string" ? args.comet : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawComet)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'comet': expected 0x-prefixed 20-byte hex, got "${rawComet}"`,
          },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'comet': ${rawComet}`),
      };
    }

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

    // CHEAP GATE — Comet allowlist validation BEFORE any RPC read.
    const cometAddr = getAddress(rawComet);
    const canonicalComets = getAllCompoundCometsForChain(chainId);
    if (!canonicalComets.includes(cometAddr)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `error: 'comet' address ${rawComet} is not in the canonical Compound V3 mainnet allowlist ` +
              "(6 Comets: cUSDCv3 / cUSDTv3 / cWETHv3 / cUSDSv3 / cwstETHv3 / cWBTCv3). " +
              "Pass one of the canonical Comet addresses from src/config/contracts.ts.",
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `'comet' address not in canonical Compound V3 mainnet allowlist (6 Comets: cUSDCv3 / cUSDTv3 / cWETHv3 / cUSDSv3 / cwstETHv3 / cWBTCv3): ${rawComet}`,
        ),
      };
    }

    // SENDER resolution.
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    const assetAddr = getAddress(rawAsset) as Address;

    // Intent-gate prologue — runs BEFORE the encoder. The borrow tool refuses
    // on `intent === "withdraw-collateral"` (the reverse direction of
    // `prepare_compound_withdraw`'s refusal on `"borrow"`). Two scenarios
    // land in "withdraw-collateral":
    //   - asset !== baseToken  (the agent passed a collateral asset)
    //   - asset === baseToken AND balanceOf > 0n  (the wallet has supply)
    // Both are withdraws, not borrows.
    const client = getChainClient(chainId);
    let intent: Awaited<ReturnType<typeof _compoundChains.deriveIntent>>;
    try {
      intent = await _compoundChains.deriveIntent(
        client,
        cometAddr,
        fromAddress,
        "withdraw",
        assetAddr,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: failed to derive Compound intent for ${cometAddr}: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `failed to derive Compound intent for ${cometAddr}`,
          message,
        ),
      };
    }

    if (intent === "withdraw-collateral") {
      // One extra RPC read on the refusal path to surface the actual base
      // token in the human-readable message. The happy path skips this — the
      // deriveIntent helper already read baseToken internally, but the value
      // doesn't flow out (helper returns the bare label). Documented design
      // choice in 28-03-PLAN.md execution_context.
      let baseToken: Address;
      try {
        baseToken = await _compoundChains.readBaseToken(client, cometAddr);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to read Compound baseToken for ${cometAddr}: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            `failed to read Compound baseToken for ${cometAddr}`,
            message,
          ),
        };
      }
      const isBase = getAddress(assetAddr) === getAddress(baseToken);
      const refusalMessage = isBase
        ? `prepare_compound_borrow received the Comet's base asset (${rawAsset}) but the wallet has an existing supply position on ${cometAddr}. ` +
          "This is a withdraw, not a borrow — Compound returns the supplied principal first. " +
          "Call prepare_compound_withdraw with the same args."
        : `prepare_compound_borrow requires the Comet's base asset; received ${rawAsset} (collateral asset, baseToken is ${baseToken}). ` +
          "Call prepare_compound_withdraw to withdraw collateral.";
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${refusalMessage}` }],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", refusalMessage),
          hintTool: "prepare_compound_withdraw",
        },
      };
    }

    // intent === "borrow" — proceed with encoder.
    // Resolve decimals. Registry-cache-first; live RPC on miss.
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
    // "format") — borrow does NOT accept the MAX_UINT256 sentinel.
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

    // SAME encoder as prepare_compound_withdraw — research § Topic 3
    // Decision lock: borrow and base-asset withdraw are byte-identical at
    // the calldata layer; the discriminator is the intent gate.
    const data: Hex = encodeCompoundWithdraw(assetAddr, amountWei);

    const tx = {
      chainId,
      to: cometAddr,
      valueWei: 0n,
      data,
    };

    const payloadFingerprint = computePayloadFingerprint(tx);

    const handle = createHandle({
      args: {
        to: rawComet,
        valueWei: "0",
        tokenAddress: rawAsset,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    const baseReceipt = COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
      .replace("{COMET}", rawComet)
      .replace("{ASSET}", rawAsset)
      .replace("{AMOUNT}", rawAmount);
    const receipt = fromCallerSupplied
      ? `${baseReceipt}\n  from:         ${rawFrom}`
      : baseReceipt;

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        chain: chainName,
        chainId,
        comet: rawComet,
        from: fromAddress,
        asset: rawAsset,
        amount: rawAmount,
        amountWei: amountWei.toString(),
        intent,
        payloadFingerprint,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_compound_borrow failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_compound_borrow failed", message),
    };
  }
});
