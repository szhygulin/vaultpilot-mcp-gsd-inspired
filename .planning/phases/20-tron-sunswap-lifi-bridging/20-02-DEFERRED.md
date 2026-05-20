# Plan 20-02 — DEFERRED to v2.2.x (LiFi TRON↔EVM bridging)

**Status:** DEFERRED (not a plan — a deferral note)
**Reschedule target:** v2.2.x (follow-up phase after Phase 21 closes v2.1)
**Deferral rationale:** CONTEXT D-04b triggered — LiFi TRON facet NOT confirmable as of 2026-05-20 (verified by researcher at planning time).
**Original scope:** TRON-W-10 (LiFi bi-directional bridge) + TRON-W-11 (Inv #6b decodedFinalRecipient assertion)

---

## Why deferred (D-04b verification at planning time, 2026-05-20)

Researcher attempted three independent verifications of LiFi's on-chain TRON facet deployment. All three failed:

1. **Live LiFi `/v1/chains` API** — `curl -s "https://li.quest/v1/chains"` returned 69 chains, ALL `chainType: "EVM"`. **No TRON entry.** TRON, Solana, Bitcoin all absent from the live chain list.
2. **GitHub `lifinance/contracts/deployments/` directory** — WebFetch against the LiFi Diamond deployment manifest returned no `tron*.json` deployment file. The Diamond proxy contract architecture LiFi uses for EVM chains has no analogous TRON deployment artifact in the official repo.
3. **`/v1/quote?fromChain=TRX`** — direct quote API call returned error `1011 — /fromChain must be equal to one of the allowed values`. The string `"TRX"` (and `"tron"`) is not in LiFi's allowed-values enum.

**Interpretation:** the April 2026 press release announcing "TRON added to LiFi" describes API-level route aggregation (LiFi's HTTP quote API may route transactions involving TRON via custodial/MPC intermediaries) — NOT a deployed on-chain LiFi Diamond facet on TRON that users sign TriggerSmartContract transactions to. The Diamond proxy pattern (which Inv #6b's `_bridgeData.receiver` decoder requires) is not publicly documented with a contract address as of 2026-05-20.

Per D-04b: **Phase 20 ships Plan 20-01 (SunSwap V2) ONLY**; LiFi work (originally Plan 20-02) reschedules to v2.2.x as a follow-up phase. Phase 20 close-out chore PR amends `.planning/REQUIREMENTS.md` + `.planning/ROADMAP.md` to reflect the deferral; TRON-W-10 + TRON-W-11 carry forward unchecked with the deferral noted inline.

---

## Pre-conditions to revisit (Phase 20-02-reschedule trigger gate)

The deferral lifts when **either** of the following confirms an on-chain TRON facet for user-signed TriggerSmartContract bridging:

1. **LiFi adds TRON to `/v1/chains` API** — `curl -s "https://li.quest/v1/chains" | jq '.chains[] | select(.key == "TRX")'` returns a non-empty result with `chainType: "TRON"` (or equivalent non-EVM enum) AND a `diamondAddress` field (or facet address) populated; OR
2. **LiFi publishes TRON facet address in GitHub deployment manifest** — `github.com/lifinance/contracts/blob/main/deployments/tron.diamond.json` (or equivalent path) exists with a base58check `T...` TRON address for the Diamond proxy + the `_bridgeData.receiver` ABI; OR
3. **LiFi documentation lists TRON contract addresses** — `docs.li.fi/introduction/lifi-architecture/smart-contract-addresses` includes a TRON section with a verifiable base58check contract.

Researcher MUST re-run the three verification commands above + WebFetch against the docs page at the start of the reschedule phase. If two of the three checks pass with the same TRON contract address, the planner proceeds with the original Plan 20-02 scope (see "Original Plan 20-02 scope" below). If only one source confirms, escalate to a `checkpoint:human-verify` task before committing the facet address to `src/config/contracts.ts`.

---

## Reschedule phase shape (when triggered)

The reschedule phase MUST open with a **`checkpoint:human-verify` gate as Task 0** before any code-writing task. The gate verifies the LiFi TRON facet address against the public deployment manifest at the time of the reschedule. Recommended `checkpoint:human-verify` task signature for the eventual replan:

```xml
<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 0: Verify LiFi TRON Diamond facet address against public deployment manifest</name>
  <what-built>
    Researcher pre-staged verification artifacts:
      1. `curl -s "https://li.quest/v1/chains" > /tmp/lifi-chains.json` — verify TRON entry present + chainType
      2. `gh api repos/lifinance/contracts/contents/deployments` — verify tron*.json file exists
      3. WebFetch against `docs.li.fi/introduction/lifi-architecture/smart-contract-addresses` — confirm TRON section + address
      4. Cross-check that all three sources agree on the SAME base58check address
  </what-built>
  <how-to-verify>
    1. Read /tmp/lifi-chains.json — confirm `chains[].key === "TRX"` exists with `diamondAddress` populated
    2. Read the tron*.json file via `gh api .../deployments/tron.diamond.json` — confirm Diamond contract address
    3. Read the docs.li.fi page — confirm the TRON section contains the same address as steps 1-2
    4. Run `tronUtils.address.isAddress(<address>)` against the confirmed address — must return true
    5. Cross-verify via TRONSCAN (`tronscan.org/#/contract/<address>`) — contract must exist on TRON mainnet
  </how-to-verify>
  <resume-signal>
    Type "approved: TRON-LIFI-FACET = <base58check-address>" (e.g. `approved: TRON-LIFI-FACET = TXyZAbCdE...`)
    OR describe the verification failure + recommend whether to re-defer.
  </resume-signal>
</task>
```

If the checkpoint approves, the reschedule phase proceeds with the original Plan 20-02 scope; if it refuses, the plan re-defers and the reschedule phase ships only its own scope (e.g. v2.2 BTC work — orthogonal).

---

## Original Plan 20-02 scope (FOR REFERENCE — re-derive at reschedule time)

When the reschedule phase fires, the planner should re-derive scope from a fresh re-read of `20-CONTEXT.md` D-04..D-06 + D-08b (LiFi half) + D-09 + 20-RESEARCH.md (re-research first — RESEARCH.md staleness > 6 months at reschedule time triggers a `/gsd-research-phase` invocation). At time of Phase 20 close (2026-05-20), the locked scope was:

**Files Plan 20-02 was to ship:**
- `src/clients/lifi.ts` (NEW shared client — first introducer; designed for re-use by future v2.0 Phase 16 Solana LiFi + v2.4 EVM LiFi)
- `src/protocols/bridge-decoders/lifi-tron.ts` (Inv #6b `_bridgeData.receiver` decoder)
- `src/tools/prepare_tron_lifi_swap.ts` (TRON → EVM direction; EVM → TRON deferred to v2.4 per D-05c)

**Files Plan 20-02 was to widen (additive):**
- `src/config/contracts.ts` `KNOWN_SPENDERS_TRON` — extend with LiFi TRON Diamond facet entry (5 → 6 entries)
- `src/security/canonical-dispatch-tron.ts` `TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST` — extend with LiFi facet (1 → 2 entries; Plan 20-01 design naturally accommodates this addition with no function-body change)
- `src/signing/handle-store.ts` — `TronInstructionSummary` variant `"lifi-bridge"` + `PreparedTxTron.kind` value `"lifi-bridge"`
- `src/signing/blocks-tron.ts` — APPEND `PREPARE_RECEIPT_TRON_LIFI_TEMPLATE` + `BRIDGE_RECIPIENT_DRIFT_REFUSAL_TRON_TEMPLATE`
- `src/tools/preview_send.ts` TRON branch — additive `lifi-bridge` decode arm with Inv #6b assertion (`decodedFinalRecipient == userSuppliedToAddress` strict-equality refusal via `INVALID_INPUT + hintTool`)
- `src/tools/send_transaction.ts` + `src/tools/get_tx_verification.ts` — additive dispatch arms
- `src/tools/register-all.ts` — 1 new tool import
- `SECURITY.md` §6 — APPEND-ONLY new sub-section `### TRON Phase 20-LiFi (vN.x.x — rescheduled from Phase 20)` documenting Inv #6b enforcement

**Fixture Tron-20-B** — hardcoded `0x...` literal anchor for the LiFi bridge TriggerSmartContract calldata in NEW sibling file `test/signing-fingerprint-tron-20.test.ts` (extends Plan 20-01's sibling file with a second fixture; Phase 19's fingerprint test file BYTE-FROZEN).

**Threats Plan 20-02 was to address:**
- T-BRIDGE-RECIPIENT-DRIFT (Tampering / Elevation of Privilege) — Inv #6b mitigation
- T-LIFI-FACET-DRIFT (Tampering) — KNOWN_SPENDERS_TRON SOT + TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST extension
- T-EVM-TO-TRON-DIRECTION-CONFUSION (Spoofing) — `INVALID_INPUT + hintTool` refusal for EVM → TRON direction in Phase 20 scope (deferred per D-05c)

---

## TRON-W-10 + TRON-W-11 status at Phase 20 close

| ID | Status | Plan 20-01 disposition | Reschedule target |
|----|--------|------------------------|-------------------|
| TRON-W-09 | ✅ COVERED by Plan 20-01 (SunSwap V2 swap + sandwich-MEV defense + smartcontract dispatch allowlist) | shipping | — |
| TRON-W-10 | 🟡 DEFERRED per D-04b | not shipping; documented in Plan 20-01 frontmatter `requirements:` with inline `# deferred per D-04b` annotation | v2.2.x reschedule phase |
| TRON-W-11 | 🟡 DEFERRED per D-04b (depends on TRON-W-10) | not shipping; documented in Plan 20-01 frontmatter `requirements:` with inline `# deferred per D-04b` annotation | v2.2.x reschedule phase (bundled with TRON-W-10) |

**REQUIREMENTS.md + ROADMAP.md amendments required at Phase 20 close-out:**
- Mark TRON-W-10 + TRON-W-11 with `🟡 DEFERRED to v2.2.x (per Phase 20 D-04b — LiFi TRON facet not confirmable 2026-05-20)` annotation
- Phase 20 entry in ROADMAP.md reflects 1-plan scope (SunSwap only) with explicit note: "LiFi rescheduled to v2.2.x — see 20-02-DEFERRED.md"
- Phase 20 plan count: `**Plans:** 1 plan (LiFi originally planned as Plan 20-02 — DEFERRED to v2.2.x per D-04b)`

---

## Cross-references

- `20-CONTEXT.md` D-04..D-06 — locked decisions for LiFi scope
- `20-CONTEXT.md` D-08b — original 2-plan split (SunSwap Plan 20-01 + LiFi Plan 20-02)
- `20-CONTEXT.md` D-08c — explicit deferral path: "If Plan 20-02 defers per D-04b: Phase 20 ships only Plan 20-01 + a phase close-out chore PR"
- `20-RESEARCH.md` § Topic 5 — researcher's three-source verification + interpretation gap (CRITICAL FINDING)
- `20-RESEARCH.md` § Topic 5 § "What the April 2026 integration likely means" — LiFi may route TRON through custodial/MPC bridge intermediary (not user-signed TriggerSmartContract) OR through a non-Diamond architecture
- `20-RESEARCH.md` § Open Question 3 — "Is LiFi's TRON integration accessible via an EVM-side contract that deposits into TRON? (EVM → TRON direction only?)"
- `20-01-PLAN.md` — sibling plan that DID ship in Phase 20

---

*This file is NOT a PLAN.md — it is a deferral note. Reschedule planner re-reads CONTEXT.md + re-runs RESEARCH.md, then creates a fresh `<phase>-NN-PLAN.md` at the reschedule phase's directory.*
