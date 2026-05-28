# Phase 39: Tier-1 bridge facet decoders + final-recipient assertion (Inv #6b) — Context

**Gathered:** 2026-05-28
**Status:** Context gathered — ready for `/gsd-plan-phase 39`

<domain>
## Phase Boundary

Tier-1 bridge facet decoders for Inv #6b. Each decoder extracts the final-recipient field from the bridge's EVM calldata; the server mechanically asserts equality against the user-supplied `to` / `toAddress` before previewing. Mismatch → structured refusal `[REFUSED — DECODED RECIPIENT DRIFT]`.

Tier-1 set: Wormhole (`transferTokensWithPayload`), Mayan (`nonEvmRecipient`), NEAR Intents (`intent.receiver`), Across V3 (`depositV3.recipient`). These cover the cross-VM + non-EVM-destination paths where final-recipient drift is hardest for users to verify visually — the recipient is encoded *inside* the EVM calldata and the Ledger device can't decode it to show the user.

Tier-2 (deBridge, Stargate composeMsg, Hop, Symbiosis) explicitly deferred — REQUIREMENTS.md notes them but no decoder ships in Phase 39.

</domain>

<decisions>
## Implementation Decisions (LOCKED)

- **Decoder module shape**: each decoder is a module at `src/protocols/bridge-decoders/<bridge>.ts`. **Mirror the existing `src/protocols/bridge-decoders/lifi-btc.ts`** (Phase 26 — the first and only file currently in this directory; it is the canonical in-directory precedent, more directly than `aave-v3.ts`). Specifically inherit from `lifi-btc.ts`:
  - **NEVER-throws discriminated-union result** `type Decode<Bridge>Result = { kind: "ok"; summary: … } | { kind: "error"; message: string }` (WR-02 convention — parsers never throw).
  - **DISPLAY/ASSERT-ONLY discipline** — decoders extract fields for assertion + receipt display; they NEVER reconstruct, re-encode, or mutate calldata.
  - **`_`-prefixed internal helpers** for sub-decode steps.
  - A selector-prefix guard that returns `{ kind: "error" }` (or a null/no-match sentinel) when the calldata's leading 4-byte selector doesn't match the bridge's known function selector — cheap short-circuit for non-matching calldata.
  - Each decoder exposes its known selector(s) so the preview-time dispatcher can route by selector before attempting a full decode.

- **Wiring at preview (centralized, tool-agnostic)**: the Inv #6b assertion lives in `src/tools/preview_send.ts`, NOT per-prepare-tool. `preview_send` matches the handle's calldata selector against the Tier-1 decoder set; on a match it decodes, extracts `finalRecipient`, and asserts equality against the user-supplied recipient. This single placement satisfies REQUIREMENTS BRIDGE-T1-06 for *every* current and future swap/bridge tool that routes through `preview_send` — no per-tool edits needed. Multiple decoders matching the same calldata (impossible by selector-distinctness, but defensive) → error.

- **Layer ordering — Layer 0.6 (EVM path)**: the Inv #6b assertion sits at Layer 0.6, immediately **after** v1.3's Layer 0.5 canonical-dispatch allowlist check (the EVM `_canonicalDispatch.checkDispatchTarget` block in `preview_send.ts`) and **before** the chain-mismatch / fingerprint checks. (Layer 0.7 — the Solana `simulateTransaction` gate — is Solana-path-only; on the EVM path 0.6 is the last allowlist-class gate before fingerprint re-check.) Plan-checker MUST assert this ordering invariant.

- **Decoder regression-test discipline**: each decoder gets a calldata-fixture-pinned regression test with known-good calldata sourced from a real mainnet bridge transaction at planning/research time. Drift in upstream bridge ABI surface is caught at test time, not user-tx time. Follow the project's hardcoded-literal fixture convention (no `beforeAll`-snapshot). Mismatch-path test asserts the exact `[REFUSED — DECODED RECIPIENT DRIFT]` error shape names the decoded value, the user-supplied value, and the bridge name (BRIDGE-T1-05).

- **Companion-skill update**: sister `vaultpilot-preflight` repo gets a coordinated bump adding Inv #6b skill-side encoding ("before signing, verify the decoded recipient matches the user's stated recipient"). Coordinated version bump mirroring v2.5 Phase 38's sister-repo pattern.

### Codebase reality folded in (factual grounding for the planner — not open questions)

- **`src/protocols/bridge-decoders/` already exists** with one file: `lifi-btc.ts`. Phase 39 adds the four EVM decoders alongside it — do NOT create the directory; do NOT touch `lifi-btc.ts` (its Inv#6b assertion already lives in `prepare_btc_lifi_swap.ts`, a deliberate exception because the BTC PSBT's OP_RETURN is a binary memo, not an extractable recipient).
- **Of the tools BRIDGE-T1-06 enumerates, three do NOT exist**: `prepare_swap`, `prepare_solana_lifi_swap`, `prepare_tron_lifi_swap` are absent (LiFi Solana/TRON deferred per ROADMAP v2.1/v2.0 notes). The swap/bridge prepare tools that DO exist and route through `preview_send`: `prepare_btc_lifi_swap`, `prepare_uniswap_swap`, `prepare_curve_swap`, `prepare_sunswap_swap`. Because the assertion is centralized at `preview_send`, the deferred tools inherit Inv #6b automatically when they later land — Phase 39 wires nothing per-tool and adds a forward-reference note instead. Same-chain DEX swaps (Uniswap/Curve/SunSwap) simply won't match a Tier-1 bridge selector, so the gate is a no-op for them.

### Claude's Discretion

- Internal helper names per-bridge (`decodeWormholeTransfer`, etc.) and the exact `summary` field set per decoder beyond the mandatory `finalRecipient`.
- Test calldata fixtures per-bridge (sourced from real mainnet transactions at research time).
- Whether decoder regression tests live in `test/bridge-decoders/<bridge>.test.ts` or co-located — match whatever the existing `test/` layout does for protocol decoders.
- The exact shape of the selector→decoder dispatch table in `preview_send` (inline map vs a small `src/protocols/bridge-decoders/index.ts` registry) — pick whichever keeps `preview_send` readable and the decoder set extensible for Tier-2.

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — `src/protocols/*.ts` per-protocol convention; FROZEN-area discipline; hardcoded-literal fixture convention
- `.planning/REQUIREMENTS.md` §BRIDGE-T1-01..06 — exact Phase 39 surface (BRIDGE-T2-* deferred)
- `.planning/ROADMAP.md` Phase 39 — success criteria 1-8
- `src/protocols/bridge-decoders/lifi-btc.ts` — **PRIMARY pattern**: NEVER-throws DU result, DISPLAY/ASSERT-only, `_`-helpers, in-directory precedent
- `src/protocols/aave-v3.ts` (Phase 7) — secondary per-protocol decoder-module reference
- `src/tools/preview_send.ts` — Layer 0.5 canonical-dispatch wiring (`_canonicalDispatch.checkDispatchTarget`, EVM path); Phase 39 adds the sibling Layer 0.6 assertion here
- `src/security/canonical-dispatch.ts` — allowlist-gate shape Layer 0.6 mirrors
- `src/tools/prepare_btc_lifi_swap.ts` — the existing per-tool Inv#6b assertion (the BTC exception); informs the EVM centralized approach by contrast
- Wormhole docs — https://wormhole.com/docs/
- Mayan docs — https://docs.mayan.finance/
- NEAR Intents — https://near.org/intents
- Across V3 docs — https://docs.across.to/

</canonical_refs>

<specifics>
## Specific Ideas

- Inv #6b mechanically asserts the bytes the device will sign route to the user's stated recipient. Without it, a compromised agent can pass a clean-looking `to` to the user's eyes but encode a different recipient inside the bridge calldata. The Ledger device displays the EOA transaction (calling the bridge contract) — but the device CAN'T decode the bridge calldata to show the user the actual final recipient.
- Tier-1 selection rationale: these four bridges cover the cross-VM (EVM ↔ Solana / EVM ↔ NEAR / EVM ↔ BTC / EVM ↔ Cosmos) paths where the recipient is "encoded inside" the EVM calldata and can't be visually verified on-device. Tier-2 bridges cover EVM-to-EVM cases where the recipient is typically a clean EVM address the device DOES display.
- Each Tier-1 decoder is per-bridge; the calldata format diverges per bridge. Sharing a common `BridgeDecoder` interface is fine; sharing implementation is not (the decoders are too divergent).
- Non-EVM recipient comparison (Mayan, NEAR): the decoded recipient may be a Solana base58 / TRON base58 / NEAR account string, not a 20-byte EVM hex. The equality assertion must normalize both sides to the same encoding before comparing (case-sensitivity + encoding-form). Research must pin how Mayan/NEAR encode the destination in the EVM calldata (raw bytes32 vs ABI string) so the decoder normalizes correctly — this is the highest-risk correctness detail of the phase.

</specifics>

<deferred>
## Deferred Ideas

- Tier-2 facet decoders (deBridge / DLN, Stargate composeMsg, Hop, Symbiosis) — v2.6.x or v2.7 depending on usage-data
- Per-L2 sandwich-MEV thresholds — Phase 40
- Cross-chain reorg-detection / refund-flow tooling — v2.x backlog
- Dynamic bridge-decoder discovery (Etherscan ABI fetch + selector match) — defer; the per-bridge curated decoder set has higher integrity guarantees
- Inv #6b wiring for `prepare_solana_lifi_swap` / `prepare_tron_lifi_swap` — those tools don't exist yet (LiFi Solana/TRON deferred); they inherit the centralized `preview_send` assertion automatically if/when they land

</deferred>

---

*Phase: 39-bridge-tier-1-facet-decoders-final-recipient-assertion*
*Context gathered: 2026-05-28 (decisions anchored from placeholder + codebase grounding; no open design forks)*
