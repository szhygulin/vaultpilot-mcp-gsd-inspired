// MCP tool: get_btc_status({}) — Phase 22 Plan 22-04 (BTC-PAIR-02).
//
// Read-only counterpart to `pair_btc_ledger`. Surfaces the persistent
// non-EVM store's BTC records as a structured envelope. Multi-record-per-
// chain shape: segwit (bc1q…) + taproot (bc1p…) records coexist under
// `chain: "bitcoin"`; this tool aggregates BOTH into a single
// `{ paired: true, addresses: { segwit, taproot }, derivationPaths: { segwit,
//    taproot }, esploraEndpoint, pairedAt, staleAccountWarning? }` envelope.
//
// `derivationPaths` IS surfaced here (the caller explicitly asked for
// their own pairing status — they can see their own slot indices). The
// shoulder-surfing defense applies to `list_paired_non_evm_accounts`,
// which iterates and would otherwise leak per-chain BIP44 indices
// across the whole non-EVM surface (T-22-18 mitigation; the
// cross-chain iterator stays scrubbed).
//
// `staleAccountWarning: true` per-record — segwit and taproot age
// INDEPENDENTLY (each record's `pairedAt` is independent in the
// non-evm-account-store). The envelope flag fires when EITHER record
// is stale (per-record OR semantics; PAIR-NEV-04 envelope-level
// disjunction). The pairing itself is cryptographically still valid —
// the warning is operational hygiene, not a correctness signal.
//
// `ledgerBtcAppVersion`: NOT surfaced. The cache record holds no
// version; Phase 22 does NOT lazy-probe the device at status-call time
// (mirror of TRON's Phase 17/21 two-tool split — `get_tron_status`
// reads the cache; `get_tron_setup_status` lazy-probes the device).
// The BTC analogue of `get_tron_setup_status` is deferred to Phase 27.
//
// No error path: a missing record / disk-unavailable store both
// surface as `{ paired: false }`. The store's `listAccounts()` swallows
// IO errors with stderr `warn` and returns `[]`, so the routing prompt
// stays simple.

import { _bitcoinRegistry } from "../chains/bitcoin/registry.js";
import {
  listAccounts,
  type NonEvmAccountView,
} from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns the BTC Ledger pairing status for the persistent non-EVM account cache.",
  "Use this to confirm a Ledger BTC pair survived restart and to read the segwit + taproot slot addresses.",
  "Returns `{ paired: false }` when no BTC records exist; otherwise `{ paired: true, addresses: { segwit, taproot }, derivationPaths: { segwit, taproot }, esploraEndpoint, pairedAt, staleAccountWarning? }`.",
  "addresses and derivationPaths are OBJECTS keyed by script type — segwit (BIP-84, bc1q…) and taproot (BIP-86, bc1p…). Either slot can be undefined if the user paired one script type only (uncommon — pair_btc_ledger pairs both in a single device session).",
  "Each script type's record ages independently — staleAccountWarning: true fires if EITHER is older than 30 days (envelope-level OR); call pair_btc_ledger to refresh both records' pairedAt.",
  "esploraEndpoint reflects the URL the BTC Esplora client is constructed against (BTC_ESPLORA_URL override or the public blockstream.info fallback).",
  "Reads cached pairing state ONLY — does NOT open a USB-HID transport to the device. The cache record holds no Ledger app version; for live on-device version queries, the Phase 27 `get_btc_setup_status` diagnostic is the place to look (mirror of TRON's `get_tron_setup_status`).",
  "Never errors — a missing record / disk-unavailable store both surface as paired:false.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_btc_status", DESCRIPTION, INPUT_SCHEMA, async () => {
  let records: NonEvmAccountView[];
  try {
    records = listAccounts({ chainFilter: "bitcoin" });
  } catch {
    // Defensive: the store's listAccounts() swallows IO errors
    // internally, but we still want a tolerant outer arm so a future
    // schema-change throw cannot break the whole tool surface.
    records = [];
  }

  if (records.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            "paired: false (no BTC Ledger pairing in the persistent cache; call pair_btc_ledger to pair)",
        },
      ],
      structuredContent: { paired: false },
    };
  }

  // Discriminate segwit vs taproot by address-prefix. bc1q = BIP-84
  // P2WPKH (bech32); bc1p = BIP-86 P2TR (bech32m). Phase 22's
  // pair_btc_ledger writes one record per script type — segwitRecord
  // and taprootRecord can each independently be undefined (single
  // script type pair edge case).
  const segwitRecord = records.find((r) => r.address.startsWith("bc1q"));
  const taprootRecord = records.find((r) => r.address.startsWith("bc1p"));

  const addresses: { segwit?: string; taproot?: string } = {};
  const derivationPaths: { segwit?: string; taproot?: string } = {};
  if (segwitRecord) {
    addresses.segwit = segwitRecord.address;
    derivationPaths.segwit = segwitRecord.derivationPath;
  }
  if (taprootRecord) {
    addresses.taproot = taprootRecord.address;
    derivationPaths.taproot = taprootRecord.derivationPath;
  }

  const esploraEndpoint = _bitcoinRegistry.getResolvedEsploraUrl();

  // Envelope-level OR — flag fires if EITHER record is stale. Each
  // record ages independently (PAIR-NEV-04 per-record aging at the
  // store level); the envelope-level disjunction surfaces ANY stale
  // slot to the agent.
  const staleAccountWarning = Boolean(
    segwitRecord?.staleAccountWarning || taprootRecord?.staleAccountWarning,
  );

  // pairedAt source: prefer segwit if both present (typically
  // identical because pair_btc_ledger writes both in the same device
  // session). Fallback to taproot for single-record cases.
  const pairedAt = segwitRecord?.pairedAt ?? taprootRecord?.pairedAt;

  const structuredContent: Record<string, unknown> = {
    paired: true,
    addresses,
    derivationPaths,
    esploraEndpoint,
    pairedAt,
  };
  if (staleAccountWarning) {
    structuredContent.staleAccountWarning = true;
  }

  const lines: string[] = [`paired: true`];
  if (segwitRecord) {
    lines.push(`segwit: ${segwitRecord.address}`);
    lines.push(`  derivationPath: ${segwitRecord.derivationPath}`);
  }
  if (taprootRecord) {
    lines.push(`taproot: ${taprootRecord.address}`);
    lines.push(`  derivationPath: ${taprootRecord.derivationPath}`);
  }
  lines.push(`esploraEndpoint: ${esploraEndpoint}`);
  if (pairedAt !== undefined) {
    lines.push(`pairedAt: ${pairedAt}`);
  }
  if (staleAccountWarning) {
    lines.push(
      "staleAccountWarning: true (either segwit or taproot pairedAt is older than 30 days; re-pair via pair_btc_ledger to refresh)",
    );
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent,
  };
});
