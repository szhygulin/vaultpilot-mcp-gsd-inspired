// src/tools/get_bittensor_validators.ts — Phase 46 Plan 46-03 (TAO-R-03).
//
// Validator enumeration for a Bittensor subnet via the decoded
// neuronInfoRuntimeApi.getNeuronsLite runtime API (the lowest-round-trip
// path — Open Question 2, resolved in 46-01). One call returns all neurons
// for a netuid; this tool filters validatorPermit === true and surfaces
// hotkey (SS58) + uid + take%.
//
// TAO-R-05 ENRICHED (Phase 48): each permit-holding validator row now carries
// the on-chain delegate identity name, the take% commission (from the decoded
// DelegateInfo), and the per-netuid registration set — sourced from
// delegateInfoRuntimeApi.getDelegate + identitiesV2 (coldkey-keyed). A
// null/absent identity is tolerated (OQ-1).
//
// `netuid` is required-in-practice: getNeuronsLite is per-subnet. The
// requirement text writes `{netuid?}`; we accept the arg as optional in the
// schema but the handler refuses with INVALID_INPUT when it is absent (a
// chain-wide validator scan would be N round-trips — out of scope for the
// minimal v2.7 enumeration; call get_bittensor_subnets first to pick a
// netuid).
//
// Locked errorCode set:
//   - INVALID_INPUT          — netuid missing / not a non-negative integer
//   - BITTENSOR_RPC_FAILED   — BittensorRpcError rethrown by tao-rpc-client
//   - INTERNAL_ERROR         — defensive catch-all

import {
  BittensorRpcError,
  getValidators,
} from "../chains/bittensor/tao-rpc-client.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Enumerates the validators of a Bittensor subnet via the decoded neuronInfoRuntimeApi.getNeuronsLite runtime API. Returns the hotkeys (SS58) that hold a validator permit on the given netuid, each with its uid, validatorPermit flag, take percentage (commission), on-chain delegate identity name, and the subnets it is registered on.",
  "Uses the configured subtensor RPC (BITTENSOR_RPC_URL override, else the public Finney fallback).",
  "ENRICHED (TAO-R-05): each row carries the on-chain delegate identity (from identitiesV2, coldkey-keyed), the take% commission (from the decoded DelegateInfo), and the per-netuid registration set. Validators with no on-chain identity show \"(no on-chain identity)\". Use get_bittensor_subnets to discover netuids first.",
  "`netuid` is REQUIRED in practice (validator sets are per-subnet); the handler refuses with INVALID_INPUT when it is absent.",
  "Take is normalized to a 0-100 percentage string from the on-chain u16 delegate-take fraction.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    netuid: {
      type: "integer",
      minimum: 0,
      description:
        "Subnet ID (netuid) whose validators to enumerate. Per-subnet — discover netuids via get_bittensor_subnets.",
    },
  },
  // `netuid?` per the requirement text — optional in the schema, gated in
  // the handler (a chain-wide scan is out of scope for the minimal v2.7
  // enumeration).
  additionalProperties: false,
};

registerTool(
  "get_bittensor_validators",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    const netuidRaw = args.netuid;
    if (
      netuidRaw === undefined ||
      netuidRaw === null ||
      typeof netuidRaw !== "number" ||
      !Number.isInteger(netuidRaw) ||
      netuidRaw < 0
    ) {
      return {
        content: [
          {
            type: "text",
            text: "error: `netuid` is required (a non-negative integer). Validator sets are per-subnet — call get_bittensor_subnets to discover netuids.",
          },
        ],
        isError: true,
        structuredContent: {
          errorCode: "INVALID_INPUT",
          message: "`netuid` must be a non-negative integer",
        },
      };
    }
    const netuid = netuidRaw;

    try {
      const validators = await getValidators(netuid);

      const lines: string[] = [];
      if (validators.length === 0) {
        lines.push(`netuid ${netuid}: no permitted validators returned.`);
      } else {
        lines.push(
          `netuid ${netuid} — ${validators.length} validator${validators.length === 1 ? "" : "s"} (permit-holding hotkeys, identity + commission enriched):`,
        );
        for (const v of validators) {
          const take = v.takePercent === null ? "?" : `${v.takePercent}%`;
          const name = v.identity ?? "(no on-chain identity)";
          lines.push(
            `  uid ${v.uid} · ${name} · hotkey ${v.hotkey} · take ${take}`,
          );
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: {
          netuid,
          validatorCount: validators.length,
          validators: validators.map((v) => ({
            uid: v.uid,
            hotkey: v.hotkey,
            validatorPermit: v.validatorPermit,
            takePercent: v.takePercent,
            identity: v.identity,
            registeredNetuids: v.registeredNetuids,
          })),
          note:
            "Enriched (TAO-R-05): delegate identity (identitiesV2, coldkey-keyed) + take% commission + per-netuid registration set. Null identity tolerated.",
        },
      };
    } catch (err) {
      if (err instanceof BittensorRpcError) {
        return {
          content: [
            {
              type: "text",
              text: `error: failed to enumerate validators for netuid ${netuid}: ${err.message}`,
            },
          ],
          isError: true,
          structuredContent: {
            errorCode: err.errorCode,
            message: err.message,
          },
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `error: failed to enumerate validators for netuid ${netuid}: ${message}`,
          },
        ],
        isError: true,
        structuredContent: {
          errorCode: "INTERNAL_ERROR",
          message,
        },
      };
    }
  },
);
