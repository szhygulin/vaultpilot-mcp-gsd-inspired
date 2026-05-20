# Phase 39: Tier-1 bridge facet decoders + final-recipient assertion (Inv #6b) — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 39`)

<domain>
## Phase Boundary

Tier-1 bridge facet decoders for Inv #6b. Each decoder extracts the final-recipient field from the bridge's calldata; the server mechanically asserts equality against the user-supplied `to` / `toAddress` before previewing. Mismatch → structured refusal `[REFUSED — DECODED RECIPIENT DRIFT]`.

Tier-1 set: Wormhole (`transferTokensWithPayload`), Mayan (`nonEvmRecipient`), NEAR Intents (`intent.receiver`), Across V3 (`depositV3.recipient`). These cover the cross-VM + non-EVM-destination paths where final-recipient drift is hardest for users to verify visually.

Tier-2 (deBridge, Stargate composeMsg, Hop, Symbiosis) explicitly deferred — REQUIREMENTS.md notes them but no decoder ships in Phase 39.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 39`. Anchor candidates:

- **Decoder module shape**: each decoder is a module at `src/protocols/bridge-decoders/<bridge>.ts` exporting `{ decode(calldata: Hex): { finalRecipient: string, ...metadata } | null }` (returns null if calldata doesn't match the bridge's known selectors). Per-bridge module shape mirrors `src/protocols/erc20.ts` / `src/protocols/aave-v3.ts` convention.
- **Wiring at preview**: `preview_send` checks each bridge decoder against the calldata (cheap — selector-prefix match short-circuits non-bridge calldata); if a decoder matches, the assertion runs. Multiple decoders matching the same calldata (impossible by selector-distinctness but defensive) → error.
- **Decoder regression test discipline**: each decoder has a calldata-fixture-pinned regression test with known-good calldata from a real bridge transaction on mainnet. Drift in upstream bridge ABI surface caught at test time, not at user-tx time.
- **Companion-skill update**: sister `vaultpilot-preflight` repo gets a coordinated bump adding Inv #6b skill-side encoding (the skill enforces "before signing, verify the decoded recipient matches the user's stated recipient"). v1.3.x or v1.4 coordinated bump mirroring v2.5 Phase 38's sister-repo pattern.

### Claude's Discretion

- Internal helper names per-bridge (`decodeWormholeTransfer`, etc.)
- Test calldata fixtures per-bridge (sourced from real mainnet transactions at planning time)
- Whether the decoder regression tests live in `test/bridge-decoders/<bridge>.test.ts` or co-located with the protocol module

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — `src/protocols/*.ts` per-protocol convention; FROZEN-area discipline
- `.planning/REQUIREMENTS.md` §BRIDGE-T1-01..06 — exact Phase 39 surface
- `.planning/ROADMAP.md` Phase 39
- `src/protocols/aave-v3.ts` (Phase 7) — protocol-decoder module pattern Phase 39 mirrors per-bridge
- `src/tools/preview_send.ts` Layer 0.5 canonical-dispatch wiring (Plan 09-04) — preview-time assertion shape Phase 39 mirrors with a sibling layer
- Wormhole docs — https://wormhole.com/docs/
- Mayan docs — https://docs.mayan.finance/
- NEAR Intents — https://near.org/intents
- Across V3 docs — https://docs.across.to/

</canonical_refs>

<specifics>
## Specific Ideas

- Inv #6b mechanically asserts the bytes the device will sign route to the user's stated recipient. Without it, a compromised agent can pass a clean-looking `to` to the user's eyes but encode a different recipient inside the bridge calldata. The Ledger device displays the EOA transaction (calling the bridge contract) — but the device CAN'T decode the bridge calldata to show the user the actual final recipient.
- Tier-1 selection rationale: these four bridges cover the cross-VM (EVM ↔ Solana / EVM ↔ NEAR / EVM ↔ BTC / EVM ↔ Cosmos) paths where the recipient is "encoded inside" the EVM calldata and can't be visually verified on-device. Tier-2 bridges cover EVM-to-EVM cases where the recipient is typically a clean EVM address the device DOES display.
- Layer order at preview: Inv #6b assertion sits at Layer 0.6 — between v1.3's Layer 0.5 (canonical-dispatch allowlist) and v2.0 Layer 0.7 (Solana simulateTransaction gate). Mismatch refuses BEFORE the simulation runs. Plan-checker should call out the layer ordering invariant.
- Each Tier-1 decoder is per-bridge; the calldata format diverges per bridge. Sharing a common `BridgeDecoder` interface is fine; sharing implementation is not (the decoders are too divergent).

</specifics>

<deferred>
## Deferred Ideas

- Tier-2 facet decoders (deBridge / DLN, Stargate composeMsg, Hop, Symbiosis) — v2.6.x or v2.7 depending on usage-data
- Per-L2 sandwich-MEV thresholds — Phase 40
- Cross-chain reorg-detection / refund-flow tooling — v2.x backlog
- Dynamic bridge-decoder discovery (Etherscan ABI fetch + selector match) — defer; the per-bridge curated decoder set has higher integrity guarantees

</deferred>

---

*Phase: 39-bridge-tier-1-facet-decoders-final-recipient-assertion*
*Context placeholder: 2026-05-20*
