# VaultPilot MCP — Context

Single-context repo. This file plus `docs/adr/` are the canonical domain references for every phase. Phase-specific implementation decisions live in `.planning/phases/XX-name/{phase_num}-CONTEXT.md`.

## Domain

VaultPilot MCP is a Model Context Protocol server for self-custodial cryptocurrency portfolio management. The user runs the server locally (stdio transport); the agent (Claude Code, Cursor, etc.) calls it for read tools (portfolio, positions, prices) and prepare tools (unsigned txs ready for hardware-wallet signing). The user's keys never leave the Ledger.

The product is **not** a wallet — it does not custody funds, sign on behalf of the user, or hold credentials. It is a transaction-authoring assistant whose value is concentrated entirely in the cryptographic-integrity properties of the prepare → preview → sign pipeline.

## Threat model

The agent, MCP server, and host computer can all be attacker-controlled. The agent compromise model covers both **adversarial threat actors** (prompt injection, rogue subagent in a delegation chain, malicious skill, deliberately rogue agent) AND **non-adversarial honest-model-error cases** (hallucinated addresses, stale knowledge of upgraded contracts, post-cutoff protocols missing entirely, long-context attention drift, capitulation under user pressure, off-by-decimal arithmetic, tool-name confusion). For threat-modeling purposes both are equivalent: the agent emits bytes that don't match user intent. The Ledger device is the only trusted component. Defense-in-depth catches single-layer compromises; coordinated multi-layer compromises are either caught or explicitly named as residual risk in SECURITY.md.

A benign-looking, high-confidence agent response gets no more trust than an explicitly suspicious one. The trust anchor is the Ledger screen and the skill's cryptographic-integrity invariants, not the model's confidence.

For each `prepare_*` flow the trust pipeline is:

```
user-intent
   ▼
agent (may lie OR honestly err)
   ▼
MCP server (may lie about hash, swap bytes at send time)
   ▼
WalletConnect relay / Ledger Live / USB transport (may MITM)
   ▼
Ledger device (TRUSTED — recomputes hash locally, displays decoded fields where possible)
```

Catches per layer:

| Threat                                                | What catches it (v1.0–v1.4)                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Compromised MCP swaps bytes between prepare and send  | `payloadFingerprint` (server-side, re-checked at send) + `LEDGER BLIND-SIGN HASH` (device-recomputed) |
| Compromised middle layer substitutes bytes            | `LEDGER BLIND-SIGN HASH` mismatch on-device                                  |
| Narrow agent compromise mutates `prepare_*` args      | `PREPARE RECEIPT` block surfaces verbatim args                               |
| Honest model error (off-by-decimal / hallucinated address / wrong-chain default) | Same `PREPARE RECEIPT` + on-device decoded display (native sends + clear-signed contracts) + Inv #2.5 chain-must-be-explicit refusal (v1.3) |
| Agent skips the preview-step CHECKS PERFORMED block   | `previewToken` + `userDecision: "send"` schema-level gate                    |
| Narrow agent decode lie (claims bytes do X, actually do Y) | `verify_tx_decode` server-side cross-check (v1.3)                       |
| WalletConnect peer impersonation                      | WC session-topic cross-check (user verifies in Ledger Live)                  |
| Edit-gas in Ledger Live                               | Hash mismatch is expected; in-block wording allows "accept tradeoff"         |
| Coordinated agent compromise (args + output filter)   | RESIDUAL RISK in v1.0–v1.2; `get_verification_artifact` (v1.3) narrows via second-LLM |
| Compromised MCP omits its own CHECKS PERFORMED       | RESIDUAL RISK in v1.0–v1.2; companion `vaultpilot-preflight` skill (v1.3) closes via static rules on disk |

## Glossary

- **Handle**: opaque token returned by `prepare_*`, threaded through `preview_send` → `send_transaction`. Backed by an in-memory store with 15-min TTL.
- **payloadFingerprint**: domain-tagged keccak256 over `{chainId, to, value, data}`; server-side prepare↔send integrity tag. **Not** the hash Ledger displays.
- **`LEDGER BLIND-SIGN HASH`**: the EIP-1559 pre-sign keccak256 over the full RLP `{chainId, nonce, maxFeePerGas, maxPriorityFeePerGas, gas, to, value, data}`. **This** is what the Ledger displays in blind-sign mode. Emitted by `preview_send`.
- **PREPARE RECEIPT**: a block in every `prepare_*` response containing the verbatim args the agent passed in. Defense against narrow agent-arg compromise.
- **CHECKS PERFORMED**: a block the *agent* emits at preview time, reporting the results of locally-recomputed checks (ABI decode, hash recompute). Required before user confirms.
- **previewToken**: server-minted UUID at `preview_send` time, required as input to `send_transaction`. Schema-level gate against accidental preview-step collapse.
- **userDecision**: literal string `"send"` required as input to `send_transaction`. Schema-level gate against the agent silently advancing past confirmation.
- **payload tampering**: any change to the bytes the device will sign, between any two layers. Always detectable on-device via blind-sign hash mismatch.
- **dispatch-target allowlist** (Inv #1.a, v1.3): per-(chain, action) canonical-contract table; refuses prepare flows whose outer `to` doesn't match.
- **chain-must-be-explicit** (Inv #2.5, v1.3): refuses any `prepare_*` until the user has named exactly ONE chain by canonical name. Defense against CREATE2 same-address sweepers.
- **`get_verification_artifact`** (v1.3): returns sparse JSON + `pasteableBlock` for second-LLM out-of-band cross-decode. Narrows the coordinated-agent gap.
- **`verify_tx_decode`** (v1.3): server-side cross-check of the agent's claimed bytes-to-intent decode. Catches narrow agent decode lies inline (no second-LLM round trip).
- **`get_tx_verification`** (v1.3): re-emits the VERIFY-BEFORE-SIGNING block + tx JSON for 15 minutes. Lets a context-evicted agent recover the canonical view without re-running prepare (which would change `nonce` + `payloadFingerprint`).
- **`[SET-LEVEL ENUMERATION]`** (Inv #14, server-side companion shipped at v1.2): verbatim row dump in `get_token_allowances` responses. Absence on a real allowances response is a tamper signal. The agent surfaces the rows verbatim so the user — not the agent — picks which to revoke.
- **`[AGENT TASK — RUN THESE CHECKS NOW]`**: a block in `preview_send` instructing the agent to run local checks (decode + hash recompute) and report in `CHECKS PERFORMED`. Server-authored — a compromised MCP can drop it; the v1.3 companion skill is the static-rule fallback.

## Distribution shape

- **v1.0–v1.3**: npm package only. `npx -y vaultpilot-mcp` is the install path. Setup is via env vars or `npx -y -p vaultpilot-mcp vaultpilot-mcp-setup`.
- **v1.4+**: bundled per-platform binaries from GitHub Releases; shell installer scripts (`install.sh`, `install.ps1`); setup wizard.
- **v3.0+**: hosted MCP HTTP endpoint with OAuth 2.1.

## Out-of-scope (load-bearing)

The threat model is for the **client-side** signing pipeline. The following are explicitly out of scope:

- Host OS hardening (assumes the host can be compromised; mitigates by anchoring trust at the Ledger screen)
- WalletConnect relay infrastructure (assumes the relay can be compromised; mitigates via session-topic cross-check + LEDGER BLIND-SIGN HASH)
- Library supply-chain attacks (`viem`, `@walletconnect/sign-client`, `@ledgerhq/hw-app-eth`) — defense is upstream code review + the on-device hash recomputation, which is independent of any host-side library
- Ledger firmware vulnerabilities (delegated to Ledger; the trust anchor)

## References

- `docs/adr/0001-vertical-slice-mvp.md` — why v1.0 is one chain + one signing flow, not breadth-first
- `docs/adr/0002-mcp-sdk-vs-fastmcp.md` — choice of `@modelcontextprotocol/sdk` over FastMCP for v1.x
- `docs/adr/0003-defer-companion-skill-to-v1-3.md` — why the `vaultpilot-preflight` companion skill is deferred to v1.3
- `.planning/PROJECT.md` — product vision + Core Value
- `.planning/REQUIREMENTS.md` — v1.0–v1.4 requirements + v2 backlog + out-of-scope
- `.planning/ROADMAP.md` — phase breakdown per milestone
