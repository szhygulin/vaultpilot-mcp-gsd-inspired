---
name: vaultpilot-preflight
description: |
  Pre-sign integrity checks for vaultpilot-mcp signing flows. Encodes invariants
  #1 (outer dispatch-target allowlist), #2 (payloadFingerprint re-derivation),
  #2.5 (chain must be explicit), #5 (final on-device match), #11 (decoded action
  matches user-intent), #14 (revoke-flow completeness via [SET-LEVEL ENUMERATION]).
  Runs automatically before any vaultpilot-mcp prepare/preview/send sequence.
allowed-tools: Bash(sha256sum *) Bash(shasum *)
disable-model-invocation: false
---

# vaultpilot-preflight

Companion pre-sign integrity check skill for [vaultpilot-mcp](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired).

This skill is the LOAD-BEARING defense against a compromised MCP server. It encodes the invariants documented in vaultpilot-mcp's `SECURITY.md` and runs them at the AGENT runtime layer, independent of the MCP server. Defense-in-depth: MCP-side checks fail closed (FROZEN three-gate + Layer 0.5 dispatch allowlist + Layer 2 chain mismatch); skill-side checks re-derive the same invariants from independent inputs. A compromised MCP that lies about its checks is caught by the skill.

The trust anchor is the Ledger device screen. This skill helps the user reach that anchor with a documented chain of verifications; it does not replace the device check.

## Step 0 — Mandatory integrity self-check (run FIRST, every invocation)

Before performing any invariant check, verify this SKILL.md has not been tampered with.

1. Run: `sha256sum ~/.claude/skills/vaultpilot-preflight/SKILL.md` (Linux)
   OR: `shasum -a 256 ~/.claude/skills/vaultpilot-preflight/SKILL.md` (macOS)
2. Compare the output against the EXPECTED_SKILL_SHA256 below:

   EXPECTED_SKILL_SHA256 = `EXPECTED_SKILL_SHA256_PLACEHOLDER`

3. If the computed SHA-256 ≠ EXPECTED_SKILL_SHA256:
   - Emit verbatim: `DO NOT SIGN.`
   - Explain: "vaultpilot-preflight skill integrity check FAILED. The skill
     content at ~/.claude/skills/vaultpilot-preflight/SKILL.md differs from
     the version this skill expects. Either the skill was tampered with locally
     (re-clone or reset to the pinned tag) OR you have an older skill version
     than this MCP server (git checkout v1.3.0)."
   - HALT — do NOT proceed to Steps 1-6. Do NOT relay any signing-flow output.
4. If the computed SHA-256 == EXPECTED_SKILL_SHA256:
   - Proceed silently to Step 1 — do not narrate the check success (avoids noise).

This Step 0 is SELF-REFERENTIAL — a tampered skill that modifies Step 0 to skip
this check will ALSO change the SHA-256, so the MCP server's parallel SHA pin
(at first tool dispatch) will surface a `VAULTPILOT NOTICE — skill integrity`
block independently. Defense-in-depth across two layers.

## Step 1 — Inv #2.5: chain must be explicit

Before any `prepare_*` call:
- Confirm the agent passed `chain: "ethereum" | "arbitrum" | "polygon" | "base" | "optimism"`.
- If the agent intends to call a `prepare_*` tool without an explicit `chain`,
  emit `DO NOT SIGN. — chain arg missing (Inv #2.5).` and HALT.

The MCP-side schema gate (Phase 8 Layer 1) and chain-id mismatch refusal
(Phase 8 Layer 2) catch this on the server side; skill-side is defense-in-depth.

## Step 2 — Inv #1: outer dispatch-target allowlist (canonical contracts)

After `preview_send` returns, before relaying the response to the user:
- Read `record.tx.to` from the preview response.
- Confirm `tx.to ∈ allowlist(chain)`. The allowlist comprises Aave V3 Pool,
  WETH9, 1inch V6 Router (`0x111111125421cA6dc452d289314280a0F8842A65`), LiFi
  Diamond (`0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`).
- If `tx.to` is not in the allowlist, emit `DO NOT SIGN. — tx.to not in
  canonical dispatch allowlist (Inv #1).` and HALT.

The MCP-side `src/security/canonical-dispatch.ts` (Plan 09-04) enforces this
at preview time independently. Skill-side is defense-in-depth.

## Step 3 — Inv #2: payloadFingerprint re-derivation

After `preview_send`:
- Re-derive: `payloadFingerprint = keccak256("VaultPilot-txverify-v1:" ‖
  chainId(32-byte BE) ‖ to(20 bytes) ‖ value(32-byte BE) ‖ data)`.
- Compare against MCP-emitted `payloadFingerprint` in the response.
- On mismatch, emit `DO NOT SIGN. — payloadFingerprint mismatch (Inv #2).` HALT.

The MCP-side PREP-08 fingerprint re-check at send time (Phase 4 FROZEN
three-gate) is the cryptographic anchor; skill re-derivation catches a
compromised MCP that lies about the fingerprint.

## Step 4 — Inv #11: decoded action matches user-intent

Call `verify_tx_decode({ handle, claimedDecode: { to, action, args } })` where
`claimedDecode` is YOUR (the agent's) understanding of what the tx does.

- `kind: "ok"` → proceed to Step 5.
- `kind: "divergence"` → emit `DO NOT SIGN. — decoded action diverges from agent
  claim (Inv #11):` + verbatim divergence list. HALT.
- `kind: "decode-unsupported"` → call `get_verification_artifact({ handle })`
  to fall back to the second-LLM out-of-band ritual. Surface the pasteableBlock
  to the user verbatim; do NOT proceed to Step 5 until the user confirms the
  second-LLM verdict.

## Step 5 — Inv #5: final on-device match

Before instructing the user to approve on the Ledger device:
- Surface the `LEDGER BLIND-SIGN HASH` block from the preview response verbatim.
- Instruct the user: "Confirm the hash above matches what your Ledger device
  displays on screen (both forms — full hex AND the chunked groups — match
  either; the device may render either form). If they don't match, press
  REJECT on the device."

This is the TRUST ANCHOR — the Ledger device screen is the only thing the user
can fully trust. Skill-side reminds the user of the ritual; MCP-side emits the
hash. The match is the user's manual ritual.

## Step 6 — Inv #14: revoke-flow completeness (when applicable)

When the user requests a revoke (`prepare_revoke_approval`):
- First call `get_token_allowances({ wallet, chain })` to enumerate outstanding
  allowances.
- Parse the `[SET-LEVEL ENUMERATION]` block in `content[0].text` of the
  response. Split each `  │  <field>: <value>` line on `: ` to extract per-row
  fields.
- Confirm the spender the user wants to revoke IS in the enumerated set.
- If the spender is NOT in the enumerated set: either the enumeration was wrong
  (RPC degraded — `rpcDegraded: true` flag surfaces in response) OR the revoke
  target was hallucinated by the agent. Emit `DO NOT SIGN. — revoke target not
  in enumerated allowance set (Inv #14).` HALT.
- If `rpcDegraded === true`, instruct the user: "Look-back window was limited;
  the revoke target may exist outside the window. To rescan with deeper
  history, set RPC_PROVIDER + RPC_API_KEY and re-call get_token_allowances."

Block shape is LOAD-BEARING (Plan 08-04 ships the byte-frozen
`SET_LEVEL_ENUMERATION_TEMPLATE`). Drift breaks the parser; Plan 08-04's
Test 4 byte-level fixture prevents drift at PR-review time.
