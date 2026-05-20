// MCP tool: set_demo_wallet({ persona }) — Plan 05-01 / DEMO-04.
//
// Activates one of the four curated demo personas as the simulation
// "active wallet." State is process-local (`src/demo/state.ts`); process
// restart drops it (T-NO-PERSIST-1, accepted by design).
//
// Handler invariants:
//   1. **Demo-mode check FIRST** (mirror Phase 3 + Phase 4 ordering
//      precedent — `pair_ledger_live`, `prepare_native_send`). If
//      `!isDemoMode()` → `WRONG_MODE` envelope; state NOT mutated.
//      T-PERSONA-CONFUSION-1 mitigation.
//   2. **Slug validation** as defense-in-depth behind the JSON-Schema
//      enum gate at `src/server.ts:55-66`. Unreachable in production
//      through the MCP protocol boundary (the AjvJsonSchemaValidator
//      rejects unknown slugs at JSON-RPC `-32602` before the handler
//      runs); the in-handler check guards against test-direct
//      invocations and hypothetical future SDK regressions.
//   3. **Activation via `setActivePersona`** — the only writer to the
//      module-scoped `activePersona` state.

import { isDemoMode } from "../config/env.js";
import { PERSONAS } from "../demo/personas.js";
import { findSolanaPersona } from "../demo/solana-persona.js";
import { findTronPersona } from "../demo/tron-persona.js";
import {
  setActivePersona,
  setActiveSolanaPersonaBySlug,
  setActiveTronPersonaBySlug,
} from "../demo/state.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { registerTool } from "./index.js";

// Mirror Plan 04-02's `errEnvelope` wrapper. `ToolHandlerResult.structuredContent`
// is `Record<string, unknown>`; `StructuredError` is an explicit interface
// without an index signature. Cast at the boundary so `makeStructuredError`
// stays the single envelope constructor.
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}

const DESCRIPTION = [
  "Activate a curated demo wallet persona for simulation flows.",
  "Use this AFTER get_demo_wallet lists the available personas and the user has picked one (4 EVM: whale / defi-degen / stable-saver / staking-maxi; 1 Solana: solana-whale; 1 TRON: tron-whale).",
  "EVM, Solana, and TRON active personas are INDEPENDENT — setting one chain's slug does not affect the others. Demo-mode EVM read tools route through the active EVM persona; Solana read tools through the active Solana persona; TRON read tools through the active TRON persona.",
  "Do NOT use this in real mode — refuses with WRONG_MODE when no demo-mode signal is active (VAULTPILOT_DEMO env or ~/.vaultpilot-mcp/config.json).",
  "Do NOT pass arbitrary addresses — the schema enum locks the six slugs; unknown values are rejected at the protocol boundary with -32602 InvalidParams.",
  "Returns `{ active: { chain, slug, address, description } }` plus a confirmation text block. `chain` is `\"ethereum\"` for EVM personas, `\"solana\"` for the Solana persona, `\"tron\"` for the TRON persona; `address` is 0x-hex for EVM, base58 for Solana, base58check T-prefixed for TRON.",
  "State is process-local — restarting the server drops the active personas; re-call this tool to re-activate.",
  "Failure modes: WRONG_MODE in real mode, INVALID_INPUT for unknown slug (defense-in-depth behind the schema enum).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    persona: {
      type: "string",
      enum: [
        "whale",
        "defi-degen",
        "stable-saver",
        "staking-maxi",
        "solana-whale",
        "tron-whale",
      ],
      description:
        "Persona slug from get_demo_wallet's output. EVM: whale, defi-degen, stable-saver, staking-maxi. Solana: solana-whale. TRON: tron-whale.",
    },
  },
  required: ["persona"],
  additionalProperties: false,
};

registerTool("set_demo_wallet", DESCRIPTION, INPUT_SCHEMA, (args) => {
  try {
    // T-PERSONA-CONFUSION-1 mitigation: demo-mode check FIRST, BEFORE
    // touching the persona state. A future contributor that reorders the
    // mode check below the activation would silently mutate state across
    // the demo/real boundary.
    if (!isDemoMode()) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: set_demo_wallet only works in demo mode. Set VAULTPILOT_DEMO=true, or remove ~/.vaultpilot-mcp/config.json to opt into auto-demo.",
          },
        ],
        structuredContent: errEnvelope(
          "WRONG_MODE",
          "set_demo_wallet requires demo mode; no demo signal active",
        ),
      };
    }

    // Defense-in-depth slug validation. The JSON-Schema enum at the
    // protocol boundary (src/server.ts) already rejects unknown slugs
    // with JSON-RPC -32602 — this branch is unreachable in production.
    // Test 5 in `test/set-demo-wallet.test.ts` exercises it via direct
    // handler invocation. The TRON branch (Plan 17-05) routes
    // `tron-whale` to the TRON persona registry; the Solana branch
    // (Plan 11-06) routes `solana-whale` to the Solana persona registry;
    // the existing 4 EVM slugs keep the existing path (back-compat).
    //
    // Branch ordering: non-EVM branches BEFORE the EVM fallthrough so
    // chain-specific lookups short-circuit cleanly. TRON precedes Solana
    // (Plan 17-05 ordering — most-recent chain first, mirroring the
    // PAIR-NEV-* convention).
    const slug = typeof args.persona === "string" ? args.persona : "";

    const tronPersona = findTronPersona(slug);
    if (tronPersona) {
      const activated = setActiveTronPersonaBySlug(tronPersona.slug);
      return {
        content: [
          {
            type: "text",
            text: `active persona set: ${activated.slug} (${activated.tronAddress})`,
          },
        ],
        structuredContent: {
          active: {
            chain: "tron",
            slug: activated.slug,
            address: activated.tronAddress,
            description: activated.description,
          },
        },
      };
    }

    const solanaPersona = findSolanaPersona(slug);
    if (solanaPersona) {
      const activated = setActiveSolanaPersonaBySlug(solanaPersona.slug);
      return {
        content: [
          {
            type: "text",
            text: `active persona set: ${activated.slug} (${activated.solanaAddress})`,
          },
        ],
        structuredContent: {
          active: {
            chain: "solana",
            slug: activated.slug,
            address: activated.solanaAddress,
            description: activated.description,
          },
        },
      };
    }

    const persona = PERSONAS.find((p) => p.slug === slug);
    if (!persona) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: unknown persona slug "${slug}". Call get_demo_wallet to list the valid slugs.`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `unknown persona slug: ${slug}`,
        ),
      };
    }

    const activated = setActivePersona(persona.slug);

    return {
      content: [
        {
          type: "text",
          text: `active persona set: ${activated.slug} (${activated.address})`,
        },
      ],
      structuredContent: {
        active: {
          chain: "ethereum",
          slug: activated.slug,
          address: activated.address,
          description: activated.description,
        },
      },
    };
  } catch (err) {
    // Defensive catch-all (matches Plan 04-02 precedent). The two explicit
    // refusal paths above cover all expected failures; INTERNAL_ERROR is
    // the unstructured fallback for genuinely unexpected throws (e.g. a
    // future helper that grows a throw path).
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: set_demo_wallet failed: ${message}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "set_demo_wallet failed",
        message,
      ),
    };
  }
});
