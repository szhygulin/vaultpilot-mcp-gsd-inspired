import { type Address, isAddress, getAddress } from "viem";

import { reverseResolveEns } from "../ens/resolver.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Reverse-resolve an Ethereum address to its primary ENS name.",
  "Use this when displaying a wallet to the user and you want a human-readable label —",
  "for example, after `get_token_balance` or `get_transaction_status` returns an address you want to surface in prose.",
  "Returns `{ name: \"...\" | null }`; null is the common case (most addresses have no primary name set).",
  "viem performs the forward-lookup round-trip automatically, so a non-null result is guaranteed to forward-resolve back to this address.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    address: {
      type: "string",
      description: "Ethereum address (0x-prefixed, 40 hex chars). Mixed case accepted; checksum is normalized.",
      pattern: "^0x[0-9a-fA-F]{40}$",
    },
  },
  required: ["address"],
  additionalProperties: false,
};

registerTool("reverse_resolve_ens", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const raw = args.address;
  if (typeof raw !== "string" || !isAddress(raw, { strict: false })) {
    return {
      content: [{ type: "text", text: "error: `address` must be a valid 0x-prefixed Ethereum address" }],
      isError: true,
    };
  }
  const address: Address = getAddress(raw);

  try {
    const name = await reverseResolveEns(address);
    return {
      content: [
        {
          type: "text",
          text:
            name === null
              ? `${address} has no primary ENS name set`
              : `${address} → ${name}`,
        },
      ],
      structuredContent: { name },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `error: failed to reverse-resolve ${address}: ${message}` }],
      isError: true,
    };
  }
});
