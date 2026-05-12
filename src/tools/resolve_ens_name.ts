import { resolveEnsName } from "../ens/resolver.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Resolve an ENS name (e.g. `vitalik.eth`) to its primary Ethereum address using the ENS Universal Resolver.",
  "Use this when the user references a wallet by its ENS name and you need the 0x address before calling another read tool —",
  "for example, before `get_token_balance` or any tool that takes a wallet address.",
  "Returns `{ address: \"0x...\" | null }`; null means the name has no address record (unregistered, expired, or no resolver set).",
  "Forward-resolution only — for the inverse direction use `reverse_resolve_ens`.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    name: {
      type: "string",
      description: "ENS name to resolve, e.g. `vitalik.eth`. Subdomains supported.",
      minLength: 1,
    },
  },
  required: ["name"],
  additionalProperties: false,
};

registerTool("resolve_ens_name", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const name = args.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return {
      content: [{ type: "text", text: "error: `name` must be a non-empty string" }],
      isError: true,
    };
  }

  try {
    const address = await resolveEnsName(name);
    const structured = { address };
    return {
      content: [
        {
          type: "text",
          text:
            address === null
              ? `ENS name \`${name}\` does not resolve to any address`
              : `${name} → ${address}`,
        },
      ],
      structuredContent: structured,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `error: failed to resolve ENS name \`${name}\`: ${message}` }],
      isError: true,
    };
  }
});
