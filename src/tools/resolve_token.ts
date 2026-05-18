// resolve_token — agent-facing ERC-20 symbol → canonical contract address
// disambiguation. Phase 8 — Plan 08-04 (READ-42).
//
// Curated-table lookup against `src/tokens/bridged-variants.ts` — NO RPC
// call. The BRIDGED_VARIANTS table IS the SOT for the ~15 commonly-
// disambiguated symbols × 5 chains; uncovered symbols fall through to
// INVALID_INPUT with the supported-symbol set named in the cause.
//
// T-USDC-USDC.E mitigation (HIGH): for a symbol with a bridged variant on a
// given chain (e.g. USDC on Polygon / Arbitrum / Optimism), the tool returns
// BOTH rows — Circle-native canonical AND USDC.e bridged — with explicit
// `variantNote` text naming the bridge mechanism. The agent surfaces both
// to the user; the user picks. Sending to the wrong variant is irreversible.
//
// Out of scope: long-tail token discovery. v1.2 covers stablecoin + wrapped
// + governance + LST symbols; uncovered symbols are INVALID_INPUT and the
// user supplies the address directly via `get_token_metadata({ address,
// chain })`.

import {
  _bridgedVariants,
  type BridgedVariant,
} from "../tokens/bridged-variants.js";
import {
  chainIdFromName,
  chainNameFromId,
  type ChainName,
} from "../config/contracts.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  'Resolve an ERC-20 symbol (e.g. "USDC", "WETH") to its canonical contract address(es) across supported chains.',
  "Call BEFORE prepare_token_send / prepare_token_approve when the user names a token by symbol — bridged variants (USDC vs USDC.e on Polygon/Arbitrum/Optimism; USDbC on Base) disambiguate via the curated table.",
  "Returns rows of `{ canonicalSymbol, variantSymbol, address, chain, variant: \"canonical\" | \"bridged\", variantNote, originChain? }`.",
  "Omitting `chain` returns ALL chains' rows — supports cross-chain symbol discovery.",
  "Providing `chain` returns rows for that chain only (1 row for unambiguous symbols like ARB on Arbitrum; 2 rows when bridged variant exists like USDC + USDC.e on Polygon).",
  "Failure modes: INVALID_INPUT for unrecognized symbol (response names the supported symbol set).",
  "Out of scope: long-tail token discovery — the curated table covers stablecoin + wrapped-asset + governance + LST symbols × 5 chains; uncovered symbols fall through to INVALID_INPUT — user supplies address directly via get_token_metadata({ address, chain }).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    symbol: {
      type: "string",
      description: "ERC-20 symbol; case-insensitive (e.g. \"USDC\", \"WETH\", \"USDC.e\").",
    },
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description:
        "Optional chain identifier. Omit to return rows for ALL chains. Supported: ethereum, arbitrum, polygon, base, optimism.",
    },
  },
  required: ["symbol"],
  additionalProperties: false,
};

/**
 * Per-row response shape — `chain` is resolved from `chainId` via
 * `chainNameFromId` so the agent sees the canonical ChainName slug, not the
 * raw numeric chainId. `originChain` is present only on bridged variants.
 */
interface ResolveTokenRow {
  canonicalSymbol: string;
  variantSymbol: string;
  address: string;
  chain: ChainName;
  variant: "canonical" | "bridged";
  variantNote: string;
  originChain?: ChainName;
}

function variantToRow(v: BridgedVariant): ResolveTokenRow {
  const row: ResolveTokenRow = {
    canonicalSymbol: v.canonicalSymbol,
    variantSymbol: v.variantSymbol,
    address: v.address,
    chain: chainNameFromId(v.chainId),
    variant: v.variant,
    variantNote: v.variantNote,
  };
  if (v.originChain !== undefined) {
    row.originChain = v.originChain;
  }
  return row;
}

registerTool("resolve_token", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const symbolRaw = args.symbol;
  if (typeof symbolRaw !== "string" || symbolRaw.trim().length === 0) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "error: `symbol` must be a non-empty string",
        },
      ],
      structuredContent: {
        ...makeStructuredError(
          "INVALID_INPUT",
          "`symbol` must be a non-empty string",
        ),
      },
    };
  }

  // chain is OPTIONAL — when omitted, return rows for ALL chains (DF-1
  // Option A locked at planning gate). The JSON-schema enum gate at the
  // dispatcher already rejected anything outside the 5-chain set when
  // chain WAS provided.
  let chainId: number | undefined;
  if (typeof args.chain === "string") {
    chainId = chainIdFromName(args.chain as ChainName);
  }

  const rows = _bridgedVariants.lookupBridgedVariant(
    symbolRaw,
    chainId as 1 | 42161 | 137 | 8453 | 10 | undefined,
  );

  if (rows.length === 0) {
    // Canonical supported-symbol list — kept in sync with the curated table
    // (see test/bridged-variants.test.ts coverage anchor). The list helps
    // the agent self-correct without a second call: it sees the supported
    // set verbatim in the error message and can route the user to
    // `get_token_metadata({ address, chain })` for long-tail tokens.
    const supportedNote =
      "supported symbols (curated table): USDC, USDC.e, USDbC, USDT, DAI, WETH, WBTC, WMATIC, ARB, OP, cbETH, stMATIC, MaticX, LINK, UNI, AAVE, FRAX, LDO, wstETH, rETH, MKR, CRV, SUSHI, GMX, BAL. For long-tail tokens call get_token_metadata({ address, chain }) with the contract address directly.";
    const detail =
      args.chain !== undefined
        ? `symbol "${symbolRaw}" not in curated bridged-variants table for chain "${String(args.chain)}"`
        : `symbol "${symbolRaw}" not in curated bridged-variants table`;
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${detail}. ${supportedNote}` }],
      structuredContent: {
        ...makeStructuredError("INVALID_INPUT", detail, supportedNote),
      },
    };
  }

  const responseRows = rows.map(variantToRow);

  // Human-readable summary: one line per row with the variantNote text so
  // the agent has all the disambiguation context in `content[0].text`.
  const summaryLines = responseRows.map(
    (r) =>
      `${r.canonicalSymbol} (${r.variantSymbol}) @ ${r.chain}: ${r.address} [${r.variant}] — ${r.variantNote}`,
  );

  return {
    content: [
      {
        type: "text",
        text: summaryLines.join("\n"),
      },
    ],
    structuredContent: {
      symbol: symbolRaw,
      rows: responseRows,
    },
  };
});
