# Phase 21: TRON diagnostics + v2.1 milestone close-out — Context

**Gathered:** 2026-05-20
**Status:** Ready for planning
**Mode:** auto-discuss (decisions derived from ROADMAP success criteria + Phase 17/18/19/20 precedent + project conventions)

<domain>
## Phase Boundary

`get_tron_setup_status({ wallet })` probes Ledger TRX-app version + on-device address verify + Stake 2.0 resource state per-wallet (analogous to v2.0 SOL-DIAG-01 `get_solana_setup_status`). v2.1 milestone close-out — SECURITY.md TRON threat-model section finalized.

**Scope narrowed** per Phase 17 close-out FLAG-1 — `TRON-READ-04` (`get_portfolio_summary` TRON leg + curated TRC-20 registry + DefiLlama TRON pricing + multi-chain portfolio TRON branch) **already shipped in Plan 17-04**, ahead of the original Phase 21 placement. Phase 21's ROADMAP SC#2 and SC#3 are retained for documentation traceability only — no new code in these areas.

1 new MCP tool lands in this phase: `get_tron_setup_status`. All consume the Phase 17 USB-HID + base58check `fetchTronAddress` shelf and Phase 18 `TronGrid` client.

**Out of Phase 21:**
- TRON multi-account-per-wallet UX (multiple derivation paths) — verify-phase feedback driven; PAIR-NEV-03 schema already supports multi-record-per-chain
- Per-block forensic chain reads (analogous to BTC-FORENSIC-* in v2.2 Phase 27) — TRON has chain-tip API at TronGrid; defer as v2.x backlog
- TRC-20 transfer history aggregation — defer; the agent can run `get_transaction_status` per-txid on demand
- LiFi TRON facet readiness (carried forward from Phase 20 D-04b deferral) — TRON-W-11 + TRON-W-12 LiFi portion reschedule with v2.2.x BTC-LIFI-01
- Real-Ledger USB-HID TRON-app verify-phase smoke — separate manual UAT phase per the existing v2.1 verify-phase scope (bundled with Phase 17 USB-HID smoke per Phase 17 deferred items)

</domain>

<decisions>
## Implementation Decisions

### D-01: `get_tron_setup_status` surface

- **D-01a:** Tool signature: `get_tron_setup_status({ wallet?: string })`. `wallet` is optional — defaults to the currently-paired TRON address from PAIR-NEV-* persistent store. Returns the shape:
  ```typescript
  {
    chain: "tron",
    walletAddress: string,                 // base58check
    ledgerTrxAppVersion: string | null,    // e.g. "0.5.0" or null if Ledger not connected
    walletAddressOnDevice: string | null,  // base58check; null if Ledger not connected
    addressVerified: boolean,              // walletAddress === walletAddressOnDevice
    resourceAccountPresent: boolean,       // exists in tronWeb.trx.getAccount()
    frozenEnergyAmount: string,            // SUN units as decimal string (e.g. "1000000000" = 1000 TRX); "0" if absent
    frozenBandwidthAmount: string,         // SUN units as decimal string; "0" if absent
    rpcDegraded?: { reason: string },      // surfaces TronGrid failures per READ-05 pattern
    deviceStatus?: { reason: string }      // surfaces Ledger USB-HID connection state ("disconnected" | "trx-app-closed" | etc.)
  }
  ```
- **D-01b:** Mirror v2.0 SOL-DIAG-01 (`get_solana_setup_status`) surface shape — per-wallet diagnostic + on-device pubkey verify + Ledger app version + chain-specific account/resource state. The TRON-specific state is the Stake 2.0 frozen-resource amounts (Energy + Bandwidth separate fields — D-01c).
- **D-01c:** Frozen amounts surfaced SEPARATELY (`frozenEnergyAmount` + `frozenBandwidthAmount`) — NOT composite. Rationale: TRON's Stake 2.0 has two distinct resource types and users freeze for one or the other (or both); aggregating loses the per-resource breakdown that's load-bearing for the user's UX choice (which type to freeze/unfreeze).
- **D-01d:** TronGrid `/wallet/getaccount` returns a `frozenV2: Array<{ type?: "ENERGY" | "BANDWIDTH" | undefined, amount: number }>` array (per Phase 19 RESEARCH). The tool reads this array, finds the entries with `type === "ENERGY"` and `type === "BANDWIDTH"` respectively, and returns their `amount` field as decimal strings. Entries without `type` field implicitly default to `"BANDWIDTH"` per TRON Stake 2.0 spec (resource-less freeze defaults to bandwidth).

### D-02: Lazy probe — no boot-time RPC

- **D-02a:** `get_tron_setup_status` does NOT fire any RPC at server boot. All probes (`fetchTronAddress` USB-HID, `tronWeb.trx.getAccount`, `getAppVersion`) happen at tool-invocation time only.
- **D-02b:** Mirrors v1.4 `request_capability` lazy-loading discipline + v2.0 SOL-DIAG-01 lazy probe — server stays bootable when peripherals are absent.
- **D-02c:** Per-probe timeouts: TronGrid `getAccount` 5s; Ledger USB-HID `fetchTronAddress` 10s (covers user pressing the device button); Ledger `getAppVersion` 5s. Tool overall returns within ~25s worst-case.

### D-03: Ledger TRX-app version probe — best-effort, demote-to-null

- **D-03a:** Ledger TRX-app version surfaced via `@ledgerhq/hw-app-trx`'s `getAppConfiguration()` (or equivalent — researcher confirms at execute time). Demote to `ledgerTrxAppVersion: null` on USB-HID failure + surface `deviceStatus.reason: "disconnected" | "trx-app-closed" | "not-paired"`.
- **D-03b:** No version-gating in v2.1 (`ledgerTrxAppVersion` is INFORMATIONAL only — for the user to compare against Ledger's minimum version recommendations). Future v2.x phase may add a `request_capability` integration that gates on minimum version; out of scope here.
- **D-03c:** Address verify check (`walletAddress === walletAddressOnDevice`) is the LOAD-BEARING assertion — surfaces `addressVerified: false` if Ledger Live's pairing-time address ever drifts from the on-device pubkey-derived address. T-PAIRING-DRIFT (MEDIUM) mitigation.

### D-04: SECURITY.md v2.1 milestone finalization (close-out)

- **D-04a:** SECURITY.md TRON section (§6) gets a `### v2.1 milestone close-out summary` sub-section appended at the end (APPEND-ONLY; existing Phase 17/18/19/20 sub-sections BYTE-IDENTICAL). The new sub-section consolidates:
  - The 4 milestone PRs shipped (Phase 17/18/19/20 SunSwap)
  - The accepted-residual list (LiFi TRON-W-11 + TRON-W-12 LiFi portion DEFERRED to v2.2.x per Phase 20 D-04b; verify-phase real-Ledger USB-HID smoke pending; SR registry snapshot refresh cadence undocumented — backlog)
  - Trust-shape recap (USB-HID direct broadcast + WC-bridge-NOT-used + domain-tagged `VaultPilot-trontx-v1:` payloadFingerprint + SHA-256 presign hash = TRON consensus tx-id = Ledger TRX-app blind-sign display)
  - 21-code error union FROZEN — `INVALID_INPUT + hintTool` pattern adopted by all 4 phases (Phase 19 intent-vs-reality gates; Phase 20 sandwich-MEV; Phase 20 ROADMAP SC#6 design)
- **D-04b:** v2.1 verify-phase scope documented inline in the new sub-section (real-Ledger USB-HID TRON-app small-amount mainnet broadcast for native TRX + TRC-20 transfer + Stake 2.0 freeze + claim-rewards). Marked as the open milestone-completion gate (NOT auto-resolved by Phase 21).

### D-05: Plan structure — 1 plan + close-out chore

- **D-05a:** ROADMAP estimate of 1 plan accepted as-is. No parallelism opportunity within the phase.
- **D-05b:** Plan 21-01: `get_tron_setup_status` MCP tool + SECURITY.md §6 v2.1 milestone close-out sub-section. Single execute PR.
- **D-05c:** Close-out chore PR (separate, post-execute) updates STATE.md / ROADMAP.md / REQUIREMENTS.md for v2.1 milestone completion (Phases 17-21 ✅ — Phase 20 LiFi portion DEFERRED is tracked status, not a v2.1 blocker; verify-phase is the auto-completion gate).

### D-06: FROZEN-vs-additive-widening (re-affirmation)

Phase 21 modifies VERY LITTLE source surface:
- NEW: `src/tools/get_tron_setup_status.ts`
- NEW: `test/get-tron-setup-status.test.ts`
- ADDITIVE: `src/tools/register-all.ts` (+1 line — tool import)
- ADDITIVE (APPEND-ONLY): `SECURITY.md` §6 v2.1 milestone close-out sub-section

All other files BYTE-UNTOUCHED — no preview_send / send_transaction / handle-store / blocks-tron / canonical-dispatch / contracts.ts / protocol-module / prepare-tool changes. `get_tron_setup_status` is a READ-ONLY tool; it does NOT create handles or interact with the trust pipeline.

Existing 21-code error union BYTE-UNTOUCHED — RPC failures demote-to-null per pattern; no new error codes needed.

### D-07: Out-of-scope (re-confirmed)

- TRON multi-account-per-wallet UX — defer
- Forensic chain reads — defer
- TRC-20 transfer history aggregation — defer
- LiFi TRON facet readiness — deferred per Phase 20 D-04b; reschedules with v2.2.x
- Real-Ledger USB-HID verify-phase smoke — separate manual UAT phase

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — diagnostic-tool conventions (lazy probe; demote-to-null on RPC failure; stderr for diagnostics, stdout for MCP protocol; tool descriptions as agent routing prompts)
- `.planning/REQUIREMENTS.md` §TRON-DIAG-01 — exact Phase 21 surface; TRON-READ-04 already DONE per Phase 17
- `.planning/ROADMAP.md` Phase 21 — Goal / Success Criteria / Plans (1-plan scope post-narrowing)

### Pattern references
- `src/tools/get_solana_setup_status.ts` (Plan 16-02 — NOTE: Phase 16 may not yet be on `main`; researcher to verify and use Phase 11's `get_solana_status` if needed as analog) — per-wallet diagnostic-tool template; Phase 21 mirrors for TRON. **If `get_solana_setup_status.ts` is NOT yet on main**, use `src/tools/get_evm_setup_status.ts` (Plan 09 verify tools) OR `src/tools/get_solana_pair_status.ts` (Plan 11-03 if shipped) as the closest in-repo analog.
- `src/chains/tron/index.ts` + `src/chains/tron/account.ts` (Plans 17-01 + 17-02) — Phase 17 TRON shelf; `fetchTronAddress` returns base58check string DIRECTLY (NO `bs58.encode` step); 5-level BIP-44 path `m/44'/195'/<n>'/0/0`
- `src/clients/tron-grid.ts` (Plan 18-01 or earlier) — `tronWeb.trx.getAccount` shape for Stake 2.0 `frozenV2` array reads
- `SECURITY.md` §5 (v2.0 Solana close-out) — structural analog for Phase 21's §6 v2.1 milestone close-out

### External references
- TRON Stake 2.0 `frozenV2` array shape — confirmed in Phase 19 RESEARCH §Topic 4
- TRON `wallet/getaccount` API — https://developers.tron.network/reference/walletgetaccount
- `@ledgerhq/hw-app-trx` `getAppConfiguration` — researcher verifies at execute time

</canonical_refs>

<specifics>
## Specific Ideas

### Stake 2.0 `frozenV2` array decoding

TronGrid `/wallet/getaccount` returns `frozenV2: Array<{ type?: "ENERGY" | "BANDWIDTH", amount: number }>`. Missing `type` field implies `"BANDWIDTH"` (resource-less freeze defaults to bandwidth per Stake 2.0 spec). The tool finds entries by `type`:
```typescript
const energyEntry = frozenV2.find(e => e.type === "ENERGY");
const bandwidthEntry = frozenV2.find(e => !e.type || e.type === "BANDWIDTH");
const frozenEnergyAmount = energyEntry ? String(energyEntry.amount) : "0";
const frozenBandwidthAmount = bandwidthEntry ? String(bandwidthEntry.amount) : "0";
```
Note: `amount` is `number` (per Phase 19 Surprise — Protobuf `int64` deserialized as JS `number`; for read-only display this is safe because the value is bounded by user-stake size; no `Number()` overflow guard needed because we render as decimal string then stringify, NOT compute on it).

### Address verify on-device

Phase 17 ships `fetchTronAddress({ accountIndex, display: false })` for silent on-device pubkey-derived address. For Phase 21's `walletAddressOnDevice`, the same call (`display: false` because the verify is server-side comparison, not user-confirmation-on-device). T-PAIRING-DRIFT mitigation surfaces `addressVerified: false` when device-derived address differs from PAIR-NEV-store record.

### Surface comparison vs Solana

| Field | Solana SOL-DIAG-01 | TRON Phase 21 |
|-------|---------------------|---------------|
| `chain` | `"solana"` | `"tron"` |
| `walletAddress` | base58 | base58check |
| `ledgerAppVersion` | Solana app version | TRX app version |
| `walletAddressOnDevice` | base58 | base58check |
| `addressVerified` | boolean | boolean |
| Resource state | N/A (Solana has no Stake 2.0) | `resourceAccountPresent` + `frozenEnergyAmount` + `frozenBandwidthAmount` |
| `rpcDegraded` | Solana RPC degraded | TronGrid degraded |
| `deviceStatus` | Solana app open / etc. | TRX app open / etc. |

### v2.1 SECURITY.md milestone close-out

The new `### v2.1 milestone close-out summary` sub-section in SECURITY.md §6 should be ~30-50 lines:
- 4 milestone PRs (Phase 17/18/19/20-SunSwap) listed with PR refs
- accepted-residual (LiFi TRON-W-11 + TRON-W-12 LiFi portion DEFERRED; SR registry snapshot refresh cadence; verify-phase pending real-Ledger USB-HID smoke)
- trust-shape recap (USB-HID direct broadcast; WC-bridge-NOT-used; domain-tag; presign hash)
- 21-code error union FROZEN — pattern carried by Phase 19 + Phase 20

</specifics>

<deferred>
## Deferred Ideas

- TRON multi-account-per-wallet UX (multiple derivation paths) — verify-phase feedback driven
- Forensic chain reads (block tip / chain reorg detection) — v2.x backlog
- TRC-20 transfer history aggregation — defer
- LiFi TRON facet readiness (TRON-W-11 + TRON-W-12 LiFi portion) — DEFERRED to v2.2.x per Phase 20 D-04b
- Real-Ledger USB-HID verify-phase smoke — separate manual UAT
- TRX-app minimum-version gating via `request_capability` — v2.x backlog

</deferred>

---

*Phase: 21-tron-diagnostics-multi-chain-portfolio*
*Context gathered: 2026-05-20 via auto-discuss mode (placeholder expanded into LOCKED decisions; derived from ROADMAP success criteria + Phase 17/18/19/20 precedent; scope narrowed per Phase 17 FLAG-1 — TRON-READ-04 already shipped in 17-04)*
