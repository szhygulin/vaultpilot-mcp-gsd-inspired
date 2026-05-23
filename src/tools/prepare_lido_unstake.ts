// MCP tool: prepare_lido_unstake({ chain, stethAmount, from? })
//
// Phase 30 — Plan 30-03 (LIDO-03). Queue a stETH withdrawal via
// WithdrawalQueue.requestWithdrawals([stethAmountWei], owner=fromAddress).
// Mechanical clone of prepare_compound_supply.ts intent-gate shape combined
// with prepare_weth_unwrap.ts single-arg ERC-20 shape. Bounded deviations:
//
//   (a) chain narrowed to ["ethereum"] per D-03 — Lido writes Ethereum-only.
//   (b) D-05: stETH approval pre-flight reads stETH.allowance(from, wqAddr) at
//       prepare time; insufficient allowance refuses with INVALID_INPUT +
//       hintTool: "prepare_token_approve" + hintArgs pointing to the correct
//       spender (WithdrawalQueueERC721, NOT wstETH).
//   (c) T-LIDO-WITHDRAWAL-AMOUNT-BOUNDS: 100n <= stethAmountWei <= 1_000n * 10n**18n.
//       Refuses with INVALID_INPUT naming the bounds on out-of-range amounts.
//   (d) D-04: on success, appends an [NFT RECEIPT EXPECTED] block AFTER the
//       PREPARE RECEIPT. The expected tokenId is `getLastRequestId() + 1n` at
//       prepare time (best-effort; T-LIDO-NFT-TOKENID-RACE disclaimer baked
//       into NFT_RECEIPT_EXPECTED_TEMPLATE).
//   (e) D-06: encodeRequestWithdrawals wraps single stethAmountWei in a
//       single-element array per Pitfall 1 mitigation. calldata = 132 bytes
//       (empirically verified in Plan 30-01 tests).
//
// D-12: ERC-7730 clear-sign coverage confirmed for WithdrawalQueue.requestWithdrawals.
// No notice block emitted (matches Phase 7 Aave precedent).
//
// Fixture W cross-link: test/prepare-lido-unstake.test.ts re-anchors
// `0x5f7514...` from test/signing-fingerprint.test.ts. Fixture W is
// persona-DEPENDENT (owner=fromAddress flows into calldata).

import { type Address, type Hex, erc20Abi, formatUnits, parseAbi } from "viem";

import {
  LIDO_UNSTAKE_PREPARE_RECEIPT_TEMPLATE,
  NFT_RECEIPT_EXPECTED_TEMPLATE,
} from "../signing/blocks.js";
import {
  getLidoStethAddress,
  getLidoWithdrawalQueueAddress,
  STETH_DECIMALS,
  encodeRequestWithdrawals,
} from "../protocols/lido.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import { getChainClient } from "../chains/registry.js";
import { registerTool } from "./index.js";

// Withdrawal bounds per Lido WithdrawalQueueERC721 MIN/MAX constants.
// MIN_STETH_WITHDRAWAL_AMOUNT = 100 wei (per Lido docs).
// MAX_STETH_WITHDRAWAL_AMOUNT = 1000 ETH (1_000 * 10**18 wei).
const MIN_WITHDRAWAL = 100n;
const MAX_WITHDRAWAL = 1_000n * 10n ** 18n;

// getLastRequestId ABI fragment — WithdrawalQueueERC721.getLastRequestId().
// Returns the current NFT tokenId counter; expectedTokenId = lastId + 1n.
const WQ_GET_LAST_REQUEST_ID_ABI = parseAbi([
  "function getLastRequestId() view returns (uint256)",
]);

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> &
    StructuredError;
}

const DESCRIPTION = [
  "Prepare an unsigned WithdrawalQueue.requestWithdrawals([stethAmount], owner) call on Ethereum mainnet — queues a stETH withdrawal and mints an NFT receipt.",
  "The user receives an ERC-721 NFT representing the withdrawal queue position; the stETH is burned and ETH is claimable after finalization (~1-5 days).",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to unstake stETH back to ETH via the Lido withdrawal queue. After the withdrawal is finalized (typically 1-5 days), the user claims via prepare_lido_claim_withdrawal (future tool).",
  "REQUIRES stETH approval: the user MUST have approved the WithdrawalQueueERC721 contract to spend stETH before calling this tool. If insufficient allowance is detected, refuses with INVALID_INPUT + hintTool: prepare_token_approve with the correct spender address.",
  "Do NOT use for wstETH → stETH conversion — use prepare_lido_unwrap instead. Do NOT use on non-Ethereum chains — Lido writes are Ethereum mainnet only.",
  "`chain` is REQUIRED and locked to 'ethereum'. Non-ethereum chains refuse with CHAIN_ID_MISMATCH (errorCode 15).",
  "`stethAmount` is a DECIMAL STRING in stETH units (e.g. '1.0' queues 1 stETH). Bounds: minimum 100 wei, maximum 1000 ETH. Out-of-bounds refuses with INVALID_INPUT.",
  "On success, response includes both a PREPARE RECEIPT and an [NFT RECEIPT EXPECTED] block with the best-effort predicted tokenId (prepare-time estimate; may shift if another withdrawal queues before this tx lands).",
  "D-12: ERC-7730 clear-sign coverage confirmed for requestWithdrawals (no blind-sign notice needed).",
  "Returns { handle, chainId, to, valueWei, data, payloadFingerprint, expectedTokenId, nftContract, prepareReceipt } plus PREPARE RECEIPT + NFT RECEIPT EXPECTED text blocks.",
  "Failure modes: CHAIN_ID_MISMATCH, INVALID_INPUT (insufficient allowance with hintTool / out-of-bounds amount / malformed amount), WALLET_NOT_PAIRED, WRONG_MODE.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier (required). ONLY 'ethereum' is supported — Lido write operations are Ethereum mainnet only.",
    },
    stethAmount: {
      type: "string",
      description:
        "Amount of stETH to queue for withdrawal, as a decimal string (e.g. '1.0'). Minimum 100 wei; maximum 1000 ETH. D-06: server encodes as a single-element array for ABI compatibility.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts in get_ledger_status.accountsByChain[chainId]. Omit to use the active account.",
    },
  },
  required: ["chain", "stethAmount"],
  additionalProperties: false,
};

registerTool("prepare_lido_unstake", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // D-03: Ethereum-write-only gate (cheap gate BEFORE any RPC reads).
    const chainName = typeof args.chain === "string" ? args.chain : "";
    if (chainName !== "ethereum") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'chain': Lido write operations support only 'ethereum', got "${chainName}"`,
          },
        ],
        structuredContent: errEnvelope(
          "CHAIN_ID_MISMATCH",
          `invalid 'chain': Lido write operations support only 'ethereum', got "${chainName}"`,
        ),
      };
    }
    const chainId = 1;

    const rawAmount = typeof args.stethAmount === "string" ? args.stethAmount : "";

    // SENDER resolution (Plan 05-02 + Issue #62).
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    // Parse amount strictly — refuses empty/format/fractional-overflow.
    let amountWei: bigint;
    try {
      amountWei = parseAmountStrict(rawAmount, STETH_DECIMALS);
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
          { type: "text", text: `error: invalid 'stethAmount': ${message}` },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'stethAmount': ${message}`),
      };
    }

    // T-LIDO-WITHDRAWAL-AMOUNT-BOUNDS: validate bounds BEFORE RPC reads.
    if (amountWei < MIN_WITHDRAWAL || amountWei > MAX_WITHDRAWAL) {
      const boundsMessage =
        `stethAmount ${rawAmount} is outside the valid withdrawal bounds: ` +
        `minimum ${MIN_WITHDRAWAL.toString()} wei (100 wei), ` +
        `maximum ${formatUnits(MAX_WITHDRAWAL, 18)} stETH (1000 ETH). ` +
        `Got ${amountWei.toString()} wei.`;
      return {
        isError: true,
        content: [
          { type: "text", text: `error: ${boundsMessage}` },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", boundsMessage),
      };
    }

    // Resolve contract addresses from SOT — NEVER inlined.
    const stethAddr: Address = getLidoStethAddress(chainId)!;
    const wqAddr: Address = getLidoWithdrawalQueueAddress(chainId)!;

    // RPC reads: allowance + getLastRequestId
    const client = getChainClient(chainId);

    // D-05: stETH allowance pre-flight for WithdrawalQueueERC721.
    const allowance: bigint = await client.readContract({
      address: stethAddr,
      abi: erc20Abi,
      functionName: "allowance",
      args: [fromAddress, wqAddr],
    });

    if (allowance < amountWei) {
      const insufficientMessage =
        `insufficient stETH allowance for Lido WithdrawalQueueERC721: ` +
        `approved ${formatUnits(allowance, 18)} stETH, need ${rawAmount} stETH. ` +
        `Call prepare_token_approve with the WithdrawalQueue address as spender.`;
      return {
        isError: true,
        content: [
          { type: "text", text: `error: ${insufficientMessage}` },
        ],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", insufficientMessage),
          hintTool: "prepare_token_approve",
          hintArgs: {
            tokenAddress: stethAddr,
            spender: wqAddr,
            amount: formatUnits(amountWei, 18),
          },
        },
      };
    }

    // D-04: getLastRequestId + 1 = expected tokenId at prepare time.
    // T-LIDO-NFT-TOKENID-RACE: best-effort; disclaimer in NFT_RECEIPT_EXPECTED_TEMPLATE.
    const lastId: bigint = await client.readContract({
      address: wqAddr,
      abi: WQ_GET_LAST_REQUEST_ID_ABI,
      functionName: "getLastRequestId",
    });
    const expectedTokenId = (lastId + 1n).toString();

    // D-06: encodeRequestWithdrawals wraps in single-element array per Pitfall 1.
    const data: Hex = encodeRequestWithdrawals(amountWei, fromAddress);

    const tx = {
      chainId,
      to: wqAddr,
      valueWei: 0n,
      data,
    };

    // PREP-03 + T-BIND-1: compute the binding fingerprint at prepare time.
    // Fixture W: fingerprint is persona-DEPENDENT (owner=fromAddress in calldata).
    const payloadFingerprint = computePayloadFingerprint(tx);

    const handle = createHandle({
      args: {
        to: "",
        valueWei: "0",
        tokenAddress: stethAddr,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    // Phase 8: PREPARE RECEIPT with verbatim agent args.
    // Issue #62: append `from:` line ONLY when caller-supplied.
    const baseReceipt = LIDO_UNSTAKE_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `ethereum (chainId 1)`)
      .replace("{WQ_CONTRACT}", wqAddr)
      .replace("{AMOUNT}", rawAmount);
    const receipt = fromCallerSupplied
      ? `${baseReceipt}\n  from:         ${rawFrom}`
      : baseReceipt;

    // D-04: NFT RECEIPT EXPECTED block appended AFTER the PREPARE RECEIPT.
    const nftBlock = NFT_RECEIPT_EXPECTED_TEMPLATE({
      nftContract: wqAddr,
      expectedTokenId,
      requestor: fromAddress,
      claimableAfter: "~1-5 days (finalization window; monitor via Lido withdrawal tracker)",
    });

    const finalText = `${receipt}\n\n${nftBlock}`;

    return {
      content: [{ type: "text", text: finalText }],
      structuredContent: {
        handle,
        chainId,
        from: fromAddress,
        to: wqAddr,
        valueWei: "0",
        data: tx.data,
        payloadFingerprint,
        prepareReceipt: finalText,
        expectedTokenId,
        nftContract: wqAddr,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_lido_unstake failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_lido_unstake failed", message),
    };
  }
});
