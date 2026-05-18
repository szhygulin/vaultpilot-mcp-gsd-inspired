// MCP tool: verify_tx_decode({ handle, claimedDecode })
//
// Phase 9 / Plan 09-05 (SEC-37) — Layer 3.5 INLINE server-side cross-check of
// the agent's claimed bytes-to-intent decode for a prepared transaction.
//
// 3-arm discriminated-union response — tighter than `check_contract_security`
// (Plan 07-04) 5-arm shape because the decode operation is DETERMINISTIC: no
// rate-limit, no external-service error arms.
//
//   { kind: "ok" }
//     — claimed decode matches server's independent re-decode field-by-field.
//
//   { kind: "divergence"; divergences: Divergence[] }
//     — at least one field disagrees. The list carries `{ field, agentSaid,
//       serverSays }` for every mismatch so the agent's decision policy can
//       halt-or-proceed with full visibility.
//
//   { kind: "decode-unsupported"; reason: string }
//     — the prepared calldata's selector is outside v1.3 decoder coverage
//       (ERC-20 transfer/approve, WETH9 withdraw, Aave V3 supply/withdraw).
//       The `reason` field routes the agent to `get_verification_artifact`
//       for second-LLM out-of-band verification (Plan 09-03 — Layer 3.7).
//
// DECODE REUSE — SINGLE SOT (T-DECODER-SINGLE-SOT-1):
//   verify_tx_decode REUSES the in-tree decoders preview_send already uses:
//     - `_protocols.decodeErc20Call`  (src/protocols/erc20.ts — combined ABI
//       covers ERC-20 transfer/approve AND WETH9 withdraw via shared decode)
//     - `_aaveProtocols.decodeAaveV3Call` (src/protocols/aave-v3.ts)
//   A parallel ABI parser would create a divergence surface where the
//   cross-check itself becomes a foot-gun. Test 18 of
//   `test/verify-tx-decode.test.ts` asserts ZERO calls to
//   `decodeFunctionData` / `decodeAbiParameters` / `parseAbiItem` in this
//   source file at the grep layer.
//
// AMOUNT COMPARISON — LOCKED option (c) per plan:
//   Agent passes WEI strings in `claimedDecode.args.amount` (matches what
//   prepare_* returned in `record.tx.valueWei` or in the preview_send
//   DECODED ARGS block). Server compares WEI-to-WEI via `BigInt(...)`. The
//   `"max"` literal is accepted as `2^256 - 1` strict-equality for approve.
//   This avoids per-token decimals lookups at the cross-check site (the
//   agent ALREADY did decimal resolution at prepare time; reusing the WEI
//   value avoids re-doing the work AND re-introducing a divergence surface).

import { getAddress, type Address, type Hex } from "viem";

import {
  getAaveV3PoolAddress,
  getWethAddress,
  type ChainId,
} from "../config/contracts.js";
import { isDemoMode } from "../config/env.js";
import { _aaveProtocols } from "../protocols/aave-v3.js";
import { _protocols, MAX_UINT256 } from "../protocols/erc20.js";
import { lookup } from "../signing/handle-store.js";
import { registerTool } from "./index.js";

type ClaimedAction = "transfer" | "approve" | "withdraw" | "aave-supply" | "aave-withdraw";

interface ClaimedDecode {
  to: string;
  action: ClaimedAction;
  args: Record<string, string>;
}

interface Divergence {
  field: string;
  agentSaid: string;
  serverSays: string;
}

const DESCRIPTION = [
  "Server-side cross-check of the agent's claimed bytes-to-intent decode for a prepared transaction.",
  "Use AFTER preview_send and BEFORE send_transaction. The agent passes its OWN decoded view of the calldata; the server independently re-decodes via the same decoder preview_send uses and returns `{ kind: 'ok' }` on match, `{ kind: 'divergence', divergences: [{ field, agentSaid, serverSays }] }` on disagreement, or `{ kind: 'decode-unsupported' }` if v1.3 decoders do not cover the calldata.",
  "Distinct from get_verification_artifact (which is an OUT-OF-BAND second-LLM check). This tool is an INLINE server-side cross-check that catches narrow agent decode lies BEFORE the user is asked to confirm.",
  "Per-action coverage: `transfer` (recipient + amount); `approve` (spender + amount; `\"max\"` ↔ 2^256-1 strict-equality); `withdraw` (WETH9 — to=canonical-WETH-per-chain + amount); `aave-supply` (to=Aave-Pool-per-chain + asset + amount + onBehalfOf); `aave-withdraw` (to=Aave-Pool-per-chain + asset + amount + to).",
  "Amount in args.amount: pass the WEI value as a decimal string (matches what prepare_* returned in record.tx.valueWei or in the preview_send DECODED ARGS amount field). For unlimited approve, pass `\"max\"` as the literal; the server validates against 2^256-1 strict-equality.",
  "Refuses in demo mode (no real handles exist). Refuses with HANDLE_NOT_FOUND / HANDLE_EXPIRED via the standard handle-store TTL.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    handle: {
      type: "string",
      description: "Handle UUID returned by prepare_* tools.",
    },
    claimedDecode: {
      type: "object",
      properties: {
        to: {
          type: "string",
          pattern: "^0x[0-9a-fA-F]{40}$",
          description:
            "The `to` address the agent CLAIMS the prepared transaction is dispatching to. Compared against record.tx.to (EIP-55-normalized).",
        },
        action: {
          type: "string",
          enum: ["transfer", "approve", "withdraw", "aave-supply", "aave-withdraw"],
          description:
            "The action the agent CLAIMS the calldata encodes. Compared against the server's independent decode of record.tx.data.",
        },
        args: {
          type: "object",
          description:
            "Per-action claimed args. `transfer`: { recipient, amount }. `approve`: { spender, amount } (amount may be `\"max\"`). `withdraw`: { amount }. `aave-supply`: { asset, amount, onBehalfOf }. `aave-withdraw`: { asset, amount, to }. All address fields compared EIP-55-normalized; amount fields compared WEI-to-WEI via BigInt.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["to", "action", "args"],
      additionalProperties: false,
    },
  },
  required: ["handle", "claimedDecode"],
  additionalProperties: false,
};

/**
 * Safely parse a WEI string as a bigint. Returns `null` if the string is
 * malformed (non-decimal, empty, etc.). The agent passes WEI as a decimal
 * string; non-parseable input surfaces as an "amount" divergence with the
 * raw claim quoted verbatim (server side does not silently re-interpret).
 */
function tryParseWei(raw: string | undefined): bigint | null {
  if (raw === undefined || raw === "") return null;
  if (!/^[0-9]+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/**
 * Best-effort EIP-55 normalization. Returns the raw input if `getAddress`
 * throws (non-canonical input). Used so divergences carry whatever the
 * agent actually said, not a normalization of it.
 */
function tryChecksum(raw: string | undefined): string {
  if (raw === undefined || raw === "") return "";
  try {
    return getAddress(raw);
  } catch {
    return raw;
  }
}

function addressesDiffer(a: string, b: string): boolean {
  const aN = tryChecksum(a);
  const bN = tryChecksum(b);
  return aN !== bN;
}

registerTool("verify_tx_decode", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // 1. Demo-mode refusal FIRST (mirror of get_tx_verification.ts:76-88
  //    + get_verification_artifact.ts:65-81).
  if (isDemoMode()) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "error: demo mode is active; verify_tx_decode refuses — the inline cross-check is for real signing flows only",
        },
      ],
      structuredContent: {
        errorCode: "DEMO_MODE_REFUSED",
        message:
          "verify_tx_decode refuses in demo mode — inline server-side cross-check is for real signing flows only",
      },
    };
  }

  // 2. Handle lookup — mirror of get_tx_verification.ts:90-102.
  const handleArg = typeof args.handle === "string" ? args.handle : "";
  const lookupResult = lookup(handleArg);
  if (!lookupResult.ok) {
    const message =
      lookupResult.errorCode === "HANDLE_NOT_FOUND"
        ? "error: handle not found; the handle may have been issued by a different process or never existed"
        : "error: handle expired (>15min from prepare); call the appropriate prepare_* tool to mint a fresh handle";
    return {
      isError: true,
      content: [{ type: "text" as const, text: message }],
      structuredContent: { errorCode: lookupResult.errorCode, message },
    };
  }
  const { record } = lookupResult;

  // Narrow claimedDecode from `Record<string, unknown>`. The JSON-schema
  // gate at the MCP boundary already enforces shape; this read is
  // defensive (test paths invoke the handler directly without schema
  // validation, so a typeof check is the runtime guard).
  const claimed = (args as { claimedDecode?: ClaimedDecode }).claimedDecode;
  if (!claimed || typeof claimed.to !== "string" || typeof claimed.action !== "string") {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "error: claimedDecode must be an object with `to` (address), `action` (enum), and `args` (object)",
        },
      ],
      structuredContent: {
        errorCode: "INVALID_INPUT",
        message: "claimedDecode missing required shape (to + action + args)",
      },
    };
  }
  const claimedArgs = (claimed.args ?? {}) as Record<string, string>;

  // 3. Independent decode via the SAME indirections preview_send uses.
  //    SINGLE SOT (T-DECODER-SINGLE-SOT-1) — no parallel decoder in this
  //    file. The combined ERC-20 ABI also covers WETH9.withdraw (see
  //    src/protocols/erc20.ts ERC20_COMBINED_DECODE_ABI), so a `withdraw`
  //    selector surfaces as { kind: "withdraw", amount } from the ERC-20
  //    decoder.
  const data = record.tx.data;
  const erc20Decoded = _protocols.decodeErc20Call(data as Hex);
  const aaveDecoded = _aaveProtocols.decodeAaveV3Call(data as Hex);

  // 4. decode-unsupported arm — no decoder hit.
  if (erc20Decoded.kind === "unknown" && aaveDecoded.kind === "unknown") {
    const selectorLabel = data === "0x" ? "(native send)" : data.slice(0, 10);
    const reason =
      `selector ${selectorLabel} is outside v1.3 decoder coverage ` +
      "(ERC-20 transfer/approve, WETH9.withdraw, Aave V3 supply/withdraw). " +
      "Use get_verification_artifact for second-LLM out-of-band verification.";
    return {
      content: [
        {
          type: "text" as const,
          text: `decode-unsupported: ${reason}`,
        },
      ],
      structuredContent: {
        kind: "decode-unsupported" as const,
        reason,
      },
    };
  }

  // 5. Per-action comparison. The agent's `claimedDecode.action` drives the
  //    rule; an action mismatch (server's decoder finds a different kind)
  //    surfaces as the FIRST divergence so the agent sees the headline issue.
  const divergences: Divergence[] = [];
  const claimedTo = tryChecksum(claimed.to);
  const recordTo = tryChecksum(record.tx.to);
  const action = claimed.action as ClaimedAction;
  const chainId = record.tx.chainId as ChainId;

  // The "server's view of the action" for action-mismatch divergences.
  const serverAction =
    erc20Decoded.kind !== "unknown"
      ? erc20Decoded.kind
      : aaveDecoded.kind !== "unknown"
        ? aaveDecoded.kind
        : "unknown";

  if (action === "transfer" && erc20Decoded.kind === "transfer") {
    // record.tx.to is the token contract; claimedDecode.to should match it.
    if (addressesDiffer(claimedTo, recordTo)) {
      divergences.push({ field: "to", agentSaid: claimedTo, serverSays: recordTo });
    }
    const claimedRecipient = claimedArgs.recipient;
    if (claimedRecipient && addressesDiffer(claimedRecipient, erc20Decoded.to)) {
      divergences.push({
        field: "recipient",
        agentSaid: tryChecksum(claimedRecipient),
        serverSays: tryChecksum(erc20Decoded.to),
      });
    }
    const claimedAmountWei = tryParseWei(claimedArgs.amount);
    if (claimedArgs.amount !== undefined && claimedAmountWei !== erc20Decoded.amount) {
      divergences.push({
        field: "amount",
        agentSaid: claimedArgs.amount,
        serverSays: `${erc20Decoded.amount.toString()} (WEI)`,
      });
    }
  } else if (action === "approve" && erc20Decoded.kind === "approve") {
    if (addressesDiffer(claimedTo, recordTo)) {
      divergences.push({ field: "to", agentSaid: claimedTo, serverSays: recordTo });
    }
    const claimedSpender = claimedArgs.spender;
    if (claimedSpender && addressesDiffer(claimedSpender, erc20Decoded.spender)) {
      divergences.push({
        field: "spender",
        agentSaid: tryChecksum(claimedSpender),
        serverSays: tryChecksum(erc20Decoded.spender),
      });
    }
    // "max" ↔ MAX_UINT256 strict-equality. Any other string parses as WEI.
    if (claimedArgs.amount === "max") {
      if (erc20Decoded.amount !== MAX_UINT256) {
        divergences.push({
          field: "amount",
          agentSaid: "max (= 2^256-1)",
          serverSays: `${erc20Decoded.amount.toString()} (WEI)`,
        });
      }
    } else if (claimedArgs.amount !== undefined) {
      const claimedAmountWei = tryParseWei(claimedArgs.amount);
      if (claimedAmountWei !== erc20Decoded.amount) {
        divergences.push({
          field: "amount",
          agentSaid: claimedArgs.amount,
          serverSays: `${erc20Decoded.amount.toString()} (WEI)`,
        });
      }
    }
  } else if (action === "withdraw" && erc20Decoded.kind === "withdraw") {
    // WETH9.withdraw — record.tx.to must equal canonical WETH9 for this chain.
    let wethExpected: Address;
    try {
      wethExpected = getWethAddress(chainId);
    } catch {
      wethExpected = recordTo as Address;
    }
    if (recordTo !== wethExpected) {
      divergences.push({
        field: "to",
        agentSaid: recordTo,
        serverSays: `${wethExpected} (canonical WETH9 for chain ${chainId})`,
      });
    }
    if (claimedTo !== wethExpected) {
      divergences.push({
        field: "to (claimedDecode)",
        agentSaid: claimedTo,
        serverSays: wethExpected,
      });
    }
    if (claimedArgs.amount !== undefined) {
      const claimedAmountWei = tryParseWei(claimedArgs.amount);
      if (claimedAmountWei !== erc20Decoded.amount) {
        divergences.push({
          field: "amount",
          agentSaid: claimedArgs.amount,
          serverSays: `${erc20Decoded.amount.toString()} (WEI)`,
        });
      }
    }
  } else if (action === "aave-supply" && aaveDecoded.kind === "aave-supply") {
    let aaveExpected: Address;
    try {
      aaveExpected = getAaveV3PoolAddress(chainId);
    } catch {
      aaveExpected = recordTo as Address;
    }
    if (recordTo !== aaveExpected) {
      divergences.push({
        field: "to",
        agentSaid: recordTo,
        serverSays: `${aaveExpected} (canonical Aave V3 Pool for chain ${chainId})`,
      });
    }
    if (claimedTo !== aaveExpected) {
      divergences.push({
        field: "to (claimedDecode)",
        agentSaid: claimedTo,
        serverSays: aaveExpected,
      });
    }
    if (claimedArgs.asset && addressesDiffer(claimedArgs.asset, aaveDecoded.asset)) {
      divergences.push({
        field: "asset",
        agentSaid: tryChecksum(claimedArgs.asset),
        serverSays: tryChecksum(aaveDecoded.asset),
      });
    }
    if (
      claimedArgs.onBehalfOf &&
      addressesDiffer(claimedArgs.onBehalfOf, aaveDecoded.onBehalfOf)
    ) {
      divergences.push({
        field: "onBehalfOf",
        agentSaid: tryChecksum(claimedArgs.onBehalfOf),
        serverSays: tryChecksum(aaveDecoded.onBehalfOf),
      });
    }
    if (claimedArgs.amount !== undefined) {
      const claimedAmountWei = tryParseWei(claimedArgs.amount);
      if (claimedAmountWei !== aaveDecoded.amount) {
        divergences.push({
          field: "amount",
          agentSaid: claimedArgs.amount,
          serverSays: `${aaveDecoded.amount.toString()} (WEI)`,
        });
      }
    }
  } else if (action === "aave-withdraw" && aaveDecoded.kind === "aave-withdraw") {
    let aaveExpected: Address;
    try {
      aaveExpected = getAaveV3PoolAddress(chainId);
    } catch {
      aaveExpected = recordTo as Address;
    }
    if (recordTo !== aaveExpected) {
      divergences.push({
        field: "to",
        agentSaid: recordTo,
        serverSays: `${aaveExpected} (canonical Aave V3 Pool for chain ${chainId})`,
      });
    }
    if (claimedTo !== aaveExpected) {
      divergences.push({
        field: "to (claimedDecode)",
        agentSaid: claimedTo,
        serverSays: aaveExpected,
      });
    }
    if (claimedArgs.asset && addressesDiffer(claimedArgs.asset, aaveDecoded.asset)) {
      divergences.push({
        field: "asset",
        agentSaid: tryChecksum(claimedArgs.asset),
        serverSays: tryChecksum(aaveDecoded.asset),
      });
    }
    if (claimedArgs.to && addressesDiffer(claimedArgs.to, aaveDecoded.to)) {
      divergences.push({
        field: "to (recipient)",
        agentSaid: tryChecksum(claimedArgs.to),
        serverSays: tryChecksum(aaveDecoded.to),
      });
    }
    if (claimedArgs.amount !== undefined) {
      const claimedAmountWei = tryParseWei(claimedArgs.amount);
      if (claimedAmountWei !== aaveDecoded.amount) {
        divergences.push({
          field: "amount",
          agentSaid: claimedArgs.amount,
          serverSays: `${aaveDecoded.amount.toString()} (WEI)`,
        });
      }
    }
  } else {
    // Action mismatch — agent claims an action the server's decoder
    // didn't recognize for THIS calldata. Surface as a single "action"
    // divergence; downstream agent's halt-or-proceed policy reads it.
    divergences.push({
      field: "action",
      agentSaid: action,
      serverSays: serverAction,
    });
  }

  // 6. Emit either ok or divergence arm.
  if (divergences.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: "ok: agent's claimed decode matches server's independent decode",
        },
      ],
      structuredContent: { kind: "ok" as const },
    };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: `divergence: ${divergences.length} field(s) disagree between agent claim and server decode`,
      },
    ],
    structuredContent: { kind: "divergence" as const, divergences },
  };
});
