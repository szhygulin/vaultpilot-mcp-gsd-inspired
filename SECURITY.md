# vaultpilot-mcp — Security & Threat Model

## Trust Anchor

The Ledger device screen is the only trusted display. Every byte the device
signs is cryptographically bound across the agent → MCP → transport → device
chain via `payloadFingerprint` (PREP-03), `LEDGER BLIND-SIGN HASH` (PREP-04),
`PREPARE RECEIPT` (PREP-02), and the `previewToken` + `userDecision`
schema-level gates (PREP-07 / PREP-08). Tampering at any single layer
produces a visible mismatch on-device.

## Compromise Model

The threat register names what each component does when an adversary
controls it:

- **Cooperating agent + cooperating MCP (honest-MCP threat model)** — fully
  documented and defended in v1.0. The agent and MCP behave as specified;
  the user verifies the final transaction on the Ledger screen.
- **Compromised agent** — bounded by the on-device confirm step. A
  malicious agent cannot force a sign; it can only present transactions
  the user must visually approve. Address-substitution + payload-drift
  attacks are caught by the `payloadFingerprint` re-check at send time
  and by the Ledger screen rendering the actual recipient.
- **Compromised MCP** — the residual risk. The companion
  `vaultpilot-preflight` skill (BUSL-1.1, planned v1.3, deferred per
  ADR 0003) provides defense-in-depth by re-deriving + re-rendering the
  payload on the agent side. Until then, the trust assumption is "this
  MCP build is the one you installed."

## Residual Risks (v1.x)

- **Compromised MCP** — closed in v1.3 via the `vaultpilot-preflight`
  skill. Until then: install from a pinned source you trust.
- **Compromised agent** — bounded by Ledger on-device confirmation; the
  user must read the screen for amount + recipient + chain on every send.
- **WalletConnect session persistence (v1.0.1+)** — see the dedicated
  section below.

## WalletConnect Session Persistence (v1.0.1+)

By default, vaultpilot-mcp persists the WalletConnect v2 session under
`~/.vaultpilot-mcp/wc-storage/` with `0o700` permissions. This eliminates
re-pairing on every MCP cold-boot, at the cost of a filesystem-trust
assumption: a process that can read that directory can resume a paired
WC session against your Ledger Live install.

### What this directory contains and does NOT contain

- **Contains**: WC v2 session symmetric keys (relay-side
  message-encryption keys) + session metadata (topic, namespaces, expiry,
  approved CAIP-10 accounts).
- **Does NOT contain**: your Ledger device's private keys (those NEVER
  leave the device); your seed phrase; any signing material.

### Mitigations

- `0o700` permissions (owner read / write / execute only) set on first
  create.
- Stderr warning on permission drift (does not auto-chmod — the operator
  is surfaced the deviation and decides whether to tighten).
- Opt-out via `VAULTPILOT_WC_STORAGE=memory` (restores the pre-v1.0.1
  `:memory:` default).
- `pair_ledger_live_start({ force: true })` tears down both the live
  session AND the persisted directory — a force re-pair cannot resurrect
  the prior session on the next cold-boot.

### Residual Risk

An adversary with filesystem read access to `~/.vaultpilot-mcp/wc-storage/`
can re-derive the WC session symmetric keys and observe relay traffic
for that session. They CANNOT sign transactions on your behalf — that
requires physical Ledger device approval. The trust anchor (Ledger
screen) is unaffected.

### Recommendations

- **Default (persist)** — primary developer machine under single-user
  control. Filesystem isolation is the trust boundary; standard host
  hygiene applies.
- **Opt out (`VAULTPILOT_WC_STORAGE=memory`)** — shared hosts, ephemeral
  containers, security-sensitive environments where the user accepts
  re-pairing every cold-boot.

## Documented Constraints (Out of Scope for v1.x)

- Cross-machine session sync (the WC session is host-local; restoring on
  a different machine is not supported).
- Encrypting the WC store at rest beyond filesystem permissions
  (`0o700` + host disk encryption is the assumed layer).
- Per-session expiry shortening (WC v2 default applies — currently 7 days).
- Runtime mode switching (the storage mode is selected once at
  `SignClient.init` and captured for the lifetime of the singleton; a
  mode change requires an MCP restart).
- Full STRIDE register / ASVS mapping (planned v1.3+ as the
  defense-in-depth model expands; the per-plan threat-register blocks
  in `.planning/phases/**/PLAN.md` are the working surface today).
