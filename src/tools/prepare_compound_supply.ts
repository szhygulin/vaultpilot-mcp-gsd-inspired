// MCP tool: prepare_compound_supply({ chain, comet, asset, amount, from? })
//
// Phase 28 — Plan 28-02 (CMP-03 supply leg). Mechanical clone of
// `prepare_aave_supply.ts` with bounded deviations:
//
//   (a) input schema is `{ chain: "ethereum", comet, asset, amount, from? }`.
//       v2.3 lock — Compound V3 mainnet only; v2.3.x widens to Polygon /
//       Arbitrum / Base / Optimism.
//   (b) `comet` field REQUIRED — no implicit default. The agent passes one of
//       the 6 canonical Ethereum mainnet Comets (cUSDCv3 / cUSDTv3 / cWETHv3 /
//       cUSDSv3 / cwstETHv3 / cWBTCv3) explicitly. Cheap allowlist gate fires
//       BEFORE any RPC read.
//   (c) Decimal resolution: registry-cache-first via `loadTokenRegistry(chainId)`
//       (verbatim mirror of `prepare_aave_supply.ts` decimals path); live RPC
//       fallback for off-list assets.
//   (d) Encoder = `encodeCompoundSupply(asset, amountWei)` from Plan 28-01.
//       NO `onBehalfOf` / `referralCode` — Compound implicitly supplies to
//       msg.sender (research § Topic 3 Decision lock).
//   (e) `tx.to = getAddress(args.comet)` — the canonical Comet address the
//       agent supplies + the cheap-gate validates. NEVER inlined; the SOT
//       getter `getAllCompoundCometsForChain(1)` returns the allowlist.
//   (f) `tx.valueWei = 0n`. Supply doesn't transfer native ETH.
//   (g) Intent-gate prologue (NEW — Aave didn't need this). Runs BEFORE
//       `parseAmountStrict` + the encoder. Discriminator: `_compoundChains.
//       deriveIntent("supply", ...)`. If the real intent is `repay-debt`
//       (asset === baseToken AND borrowBalance > 0), REFUSE with INVALID_INPUT
//       + `structuredContent.hintTool: "prepare_compound_repay"`. The hint
//       surfaces at the per-tool level (NOT via error-codes envelope
//       extension) — keeps `src/signing/error-codes.ts` FROZEN.
//   (h) `amount: "max"` is NOT accepted (research § Topic 4 — Compound's
//       `supply(base, MAX_UINT256)` IS the full-repay sentinel; resolves at
//       the `prepare_compound_repay` tool in Plan 28-03, NOT here). parse
//       AmountStrict's regex naturally rejects `"max"` as INVALID_INPUT kind
//       `"format"`.
//   (i) PREPARE RECEIPT uses `COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE` —
//       4-slot (chain + comet + asset + amount).
//
// NO LEDGER NOTICE block at prepare time. Compound calldata is NOT in the
// Ledger ERC-7730 clear-sign registry (research § Topic 8) — the device
// blind-signs — but the NOTICE surfaces at preview time (Plan 28-04), not
// prepare time.

import { type Address, type Hex, erc20Abi, getAddress } from "viem";

import { _compoundChains } from "../chains/compound-v3.js";
import { getChainClient } from "../chains/registry.js";
import {
  chainIdFromName,
  getAllCompoundCometsForChain,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { encodeCompoundSupply } from "../protocols/compound-v3.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
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
  "Prepare an unsigned Compound V3 supply(asset, amount) call on the specified chain — deposits the agent-supplied asset into a specified Compound V3 Comet to earn interest (base-asset supply / lender position) OR as collateral against future borrows (collateral supply). Supported chains: ethereum, arbitrum, polygon, base, optimism.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to deposit an asset into a Compound V3 Comet. Supports BOTH base-asset supply (user holds the Comet's base token with NO outstanding debt — earns supply APY) AND collateral supply (user holds a configured collateral asset like wstETH / WBTC against a cUSDCv3 borrow position).",
  "REFUSES with INVALID_INPUT + structuredContent.hintTool: \"prepare_compound_repay\" when the asset is the Comet's base asset AND the wallet has outstanding debt. That combination is a repay, not a supply — Compound's protocol applies the deposit against the debt first. Call prepare_compound_repay with the same args.",
  "Do NOT use for borrow / withdraw / repay — call prepare_compound_borrow / prepare_compound_withdraw / prepare_compound_repay respectively.",
  "Do NOT use for non-Compound lending — Aave V3 is `prepare_aave_supply`; Morpho / Spark / etc. are v2.4+ scope.",
  "`chain` is REQUIRED — one of: ethereum, arbitrum, polygon, base, optimism. No default-pick.",
  "`comet` is REQUIRED — the explicit Comet contract address for the target chain. The server validates against the per-chain canonical Comet allowlist (`getAllCompoundCometsForChain(chainId)`) BEFORE any RPC read. A non-canonical Comet address refuses with INVALID_INPUT before consuming RPC budget.",
  "`asset` is the underlying ERC-20 contract address. `amount` is a DECIMAL STRING in human units (e.g. \"100.5\" for 100.5 USDC). The server resolves the asset's decimals via the registry (top-50 tokens cached) or live RPC `decimals()` for long-tail assets.",
  "`amount: \"max\"` is NOT accepted by this tool — Compound's `supply(base, MAX_UINT256)` IS the full-position-close sentinel for repays (handled by prepare_compound_repay). Pass a concrete decimal here.",
  "If preview-time simulation reveals an allowance shortfall (`SIMULATION status: revert` with an `ERC20: insufficient allowance` reason), call `prepare_token_approve({ chain, tokenAddress: asset, spender: <comet>, amount: 'max' })` first, sign the approve on device, then retry this prepare.",
  "Compound V3 calldata is NOT covered by the Ledger ERC-7730 clear-sign registry — the device will BLIND-SIGN (display a raw hash). preview_send emits a LEDGER NOTICE block at preview time explaining the blind-sign expectation; the cryptographic anchor is the on-device hash match against the PREDICTED hash this tool produces.",
  "Pass `from` when the user wants to act from a non-default approved account (visible in `get_ledger_status.accountsByChain[chainId]`); otherwise omit and the active account is used. PREPARE RECEIPT surfaces `From:` only when caller-supplied.",
  "Requires a paired Ledger (real mode) or active persona (demo mode).",
  "Returns `{ handle, chain, chainId, comet, from, asset, amount, amountWei, intent, payloadFingerprint }` plus a PREPARE RECEIPT text block surfacing the verbatim args.",
  "Failure modes: WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode is on but no persona set OR `from` doesn't match the active persona, INVALID_INPUT if chain/comet/asset/amount/from malformed (including non-canonical Comet, intent-mismatch repay routing with hintTool, \"max\" rejection, fractional-overflow vs token decimals), INVALID_ACCOUNT if `from` is not in the per-chain approved set, INTERNAL_ERROR if RPC fails resolving asset decimals OR the intent-gate baseToken / borrowBalanceOf reads.",
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
    comet: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "The Compound V3 Comet contract address (required). MUST be a canonical Comet for the specified chain. Refused (INVALID_INPUT) if not in the per-chain canonical allowlist.",
    },
    asset: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "ERC-20 asset address — the token being supplied. 0x-prefixed 20-byte hex.",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in human units (e.g. \"100.5\"). The literal \"max\" is NOT accepted (use prepare_compound_repay if the intent is full-position repay).",
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

registerTool("prepare_compound_supply", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const chainName = args.chain as ChainName;
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

    // CHEAP GATE — Comet allowlist validation BEFORE any RPC read. Refusing
    // here saves an RPC round-trip for a clearly-malformed agent invocation.
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

    // SENDER resolution (Plan 05-02 + Issue #62): delegated to shared
    // resolveFrom helper. See prepare_native_send.ts for the full routing.
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    // Checksum the asset address (server-internal correctness). The receipt
    // surfaces the RAW agent string (T-PREP-RCPT-1 — no normalization).
    const assetAddr = getAddress(rawAsset) as Address;

    // Intent-gate prologue — runs BEFORE the encoder (research § Topic 3
    // Decision lock). Discriminates supply-collateral vs repay-debt via
    // `_compoundChains.deriveIntent("supply", ...)`. Short-circuits with a
    // structured refusal + hintTool when the real intent is repay (no handle
    // created; no calldata encoding).
    const client = getChainClient(chainId);
    let intent: Awaited<ReturnType<typeof _compoundChains.deriveIntent>>;
    try {
      intent = await _compoundChains.deriveIntent(
        client,
        cometAddr,
        fromAddress,
        "supply",
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

    if (intent === "repay-debt") {
      const refusalMessage =
        `prepare_compound_supply received the Comet's base asset (${rawAsset}) while the wallet has outstanding debt on ${cometAddr}. ` +
        "This is a repay, not a supply — Compound applies the deposit against the debt first. " +
        "Call prepare_compound_repay with the same args.";
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${refusalMessage}` }],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", refusalMessage),
          hintTool: "prepare_compound_repay",
        },
      };
    }

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
    // "format") — supply does NOT accept the MAX_UINT256 sentinel.
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

    const data: Hex = encodeCompoundSupply(assetAddr, amountWei);

    const tx = {
      chainId,
      to: cometAddr,
      valueWei: 0n,
      data,
    };

    // PREP-03 + T-BIND-1: compute the binding fingerprint at prepare time.
    const payloadFingerprint = computePayloadFingerprint(tx);

    // PREP-02: args carries the RAW agent strings. tokenAddress field
    // re-purposed for the asset (mirror of Phase 7 Aave pattern). The
    // agent-relayed `comet` is recorded in `args.to` — tx.to IS the comet
    // address.
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

    const baseReceipt = COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE
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
        { type: "text", text: `error: prepare_compound_supply failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_compound_supply failed", message),
    };
  }
});
