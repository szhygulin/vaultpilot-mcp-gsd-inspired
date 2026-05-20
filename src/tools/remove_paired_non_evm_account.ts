// MCP tool: remove_paired_non_evm_account({ chain, address }) — Plan 11-04
// (PAIR-NEV-05).
//
// Idempotent removal — `{ removed: false }` when no matching record
// exists, never throws. Mirrors the shape of
// `session-manager.disconnect`'s idempotent-clear contract (the device
// is never touched; this is purely a local-store mutation, agnostic to
// demo mode).
//
// No demo-mode gate: the local store is OS-side state with no
// cryptographic surface; demo mode neither writes nor reads from it for
// real Ledger pairings, so a `remove_paired_non_evm_account` call in
// demo mode is harmlessly a no-op when there's nothing to remove.

import {
  type NonEvmChain,
  removeAccount,
} from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Removes a paired non-EVM Ledger account by (chain, address). Idempotent — removing a non-existent record returns { removed: false } rather than erroring.",
  "Use this when the user wants to forget a pairing (e.g. lost device, slot rotation, switching to a different Ledger).",
  "Does not interact with the device — pure local-store operation; no USB-HID transport open, no APDU exchange.",
  "Returns { removed: boolean, chain, address }. The chain enum is locked to solana / tron / bitcoin / litecoin.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["solana", "tron", "bitcoin", "litecoin"],
      description:
        "The non-EVM chain the paired account belongs to. Must match the value used at pair time.",
    },
    address: {
      type: "string",
      minLength: 1,
      description:
        "The base58 / base58check address (verbatim) the record was saved under. Case-sensitive.",
    },
  },
  required: ["chain", "address"],
  additionalProperties: false,
};

registerTool(
  "remove_paired_non_evm_account",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    // Defense-in-depth narrowing — the registerTool framework does not
    // currently enforce schema-level validation at the call site
    // (that's the MCP transport's job), so we re-validate here.
    const chain = args.chain;
    const address = args.address;
    if (typeof chain !== "string") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "error: `chain` must be a string (solana / tron / bitcoin / litecoin)",
          },
        ],
        structuredContent: { errorCode: "INVALID_INPUT" },
      };
    }
    if (
      chain !== "solana" &&
      chain !== "tron" &&
      chain !== "bitcoin" &&
      chain !== "litecoin"
    ) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: \`chain\` must be one of solana / tron / bitcoin / litecoin; got "${chain}"`,
          },
        ],
        structuredContent: { errorCode: "INVALID_INPUT" },
      };
    }
    if (typeof address !== "string" || address.length === 0) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "error: `address` must be a non-empty string",
          },
        ],
        structuredContent: { errorCode: "INVALID_INPUT" },
      };
    }

    const result = removeAccount(chain as NonEvmChain, address);

    const text = result.removed
      ? `removed paired ${chain} account: ${address}`
      : `no paired ${chain} account matching ${address} (no-op)`;

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        removed: result.removed,
        chain,
        address,
      },
    };
  },
);
