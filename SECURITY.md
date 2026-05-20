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

## Solana Trust Pipeline (v2.0 — Phase 12)

Phase 12 (v2.0) adds the Solana arm of the prepare → preview → send pipeline.
The trust anchor stays the on-device hash match — the user reads the
"Message Hash" line on their Ledger and compares it character-for-character
against the `LEDGER BLIND-SIGN HASH (Solana)` block the server emits. The
five overrides below name where the Solana arm diverges from the v1.x EVM
arm; the cryptographic-binding chain (agent → MCP → transport → device)
holds end-to-end.

See § Trust Anchor above for the cross-chain framing; the EVM trust-pipeline
narrative in Phase 4 + Phase 6 stays canonical for ERC-20 / Aave / Compound
flows. See § Solana Trust Pipeline for the Solana-specific overrides
(distinct domain tag, SHA-256 blind-sign hash, mandatory simulation gate,
direct broadcast, sender-DEPENDENT fingerprint).

1. **Distinct domain tag.** Solana `payloadFingerprint` uses the version-
   stamped domain tag `"VaultPilot-soltx-v1:"` (20 UTF-8 bytes,
   `keccak256`-prefixed); EVM uses `"VaultPilot-txverify-v1:"` (23 UTF-8
   bytes). The two preimage shapes cannot collide even under crafted-input
   attack — the tag bytes are distinct AND the keccak preimage shapes
   differ. Cross-chain preimage-collision defense vs. the v1.x EVM tag.

2. **SHA-256 message-bytes blind-sign hash.** The Ledger Solana app
   displays `SHA-256(messageBytes)` on the device screen (per
   `LedgerHQ/app-solana/src/handle_sign_message.c`). The MCP emits the
   SAME hash unconditionally in the `LEDGER BLIND-SIGN HASH (Solana)`
   block at preview time, so the user can byte-compare the device-shown
   hash against the agent-shown hash. EVM uses `keccak256` of the
   EIP-1559 envelope; Solana uses `SHA-256` of the serialized message
   bytes. Both flow through the `presignHash` field with the same trust
   semantics.

3. **Mandatory `simulateTransaction` gate (DF-4).** Solana `preview_send`
   refuses the entire preview (no `previewToken` minted; no LEDGER
   BLIND-SIGN HASH block emitted) when `simulateTransaction.err !== null`
   — a HARD refusal, not advisory. Rationale: the Ledger Solana app does
   NOT clear-sign SPL instruction data (the user sees the message hash
   but cannot read recipient + amount on-device for SPL transfers), so
   the server-side simulation is the only pre-broadcast semantic check.
   Contrast with EVM `eth_call` which stays ADVISORY (false reverts from
   stale nonce / flaky RPC are common; the user can override).
   Surfaces via the `SIMULATION_REFUSED` errorCode.

4. **USB-HID direct broadcast bypass of WC relay.** Solana has no
   WalletConnect-mediated broadcast — Ledger Live does not expose a
   sign-and-broadcast equivalent to `eth_sendTransaction` for Solana.
   The MCP calls `signSolanaTransaction(...)` directly over USB-HID
   (Plan 12-04 transport), attaches the signature to the transaction,
   and broadcasts via `connection.sendRawTransaction(...)`. The broadcast
   trust boundary collapses from "relay + RPC + device" (EVM) to
   "RPC + device" (Solana). Per-call HID open/close discipline mirrors
   Phase 11's `fetchSolanaAddress` shape — no transport singleton; no
   stale handles.

5. **`feePayer`-in-preimage sender-DEPENDENCE.** Solana's legacy
   `Transaction.serializeMessage()` includes `feePayer` at
   `account_keys[0]`, so the message bytes (and thus the
   `payloadFingerprint` preimage) are sender-DEPENDENT. This overrides
   CONTEXT.md's "sender-independent" framing (which holds for EVM
   EIP-1559 because `from` is NOT in the EIP-1559 preimage). Defense
   against mid-flow persona swaps: at send time the Solana branch
   asserts `accounts[0].address === record.tx.feePayer` BEFORE the
   Ledger sign step; a mismatch refuses with `INTERNAL_ERROR` and names
   the discrepancy. This is layered ON TOP of the existing
   `PAYLOAD_FINGERPRINT_DRIFT` gate, which would also catch any
   message-byte mutation.

## v1.4 Residual Risks (Distribution)

Phase 10 (v1.4) introduces the per-platform binary distribution pipeline
(`@yao-pkg/pkg` build + curl-pipe installers). The signing chain stays
byte-frozen across this surface. The new residual risks are install-time
friction + supply-chain visibility — not trust-boundary degradation.

| Risk | Disposition | Mitigation Path |
|------|-------------|-----------------|
| **Unsigned macOS binaries** trigger Gatekeeper "cannot be opened because the developer cannot be verified" dialog on first run. The curl-pipe download carries the `com.apple.quarantine` extended attribute. | accept (v1.4) → mitigate (v1.5+) | install.sh OFFERS `xattr -d com.apple.quarantine ~/.local/bin/vaultpilot-mcp` interactively; user can alternatively right-click → Open → confirm (one-time per binary). v1.5+ adopts an Apple Developer cert ($99/year) + `xcrun notarytool submit --wait` (~5-10 min added per release). Documented as residual risk, not as a trust-boundary degradation — the Ledger screen remains the trust anchor regardless of binary signing state. |
| **Unsigned Windows `.exe`** triggers SmartScreen "Windows protected your PC" dialog on first run. Mark-of-the-Web persists on the downloaded file. | accept (v1.4) → mitigate (v1.5+) | install.ps1 documents `Unblock-File -Path <path>`; user can alternatively right-click → Properties → Unblock. v1.5+ adopts Authenticode signing via EV cert (DigiCert / Sectigo) + `signtool` integration. |
| **Supply-chain risk** — pkg-bundled npm-installed deps are pinned by hash in `package-lock.json` only; no SLSA provenance or sigstore signatures on release assets in v1.4. A compromised npm dep would land in the binary. | accept (v1.4) → mitigate (v1.5+) | v1.4 baseline: `package-lock.json` SHA-512 hashes (Phase 1-9 baseline) + per-asset SHA-256 sums + combined SHA256SUMS.txt published with each release. v1.5+ adds sigstore SLSA provenance + Cosign signatures on every release asset (RESEARCH § Topic 10 line 1232). |

The trust anchor (Ledger device screen) is unaffected by any of the above.
A compromised binary cannot force a sign — it can only present
transactions the user must visually approve on-device. The
`payloadFingerprint` re-check at send time + the on-screen recipient
rendering still catch tampering at the binary layer.


## TRON (v2.1 — Phase 18)

The v2.1 TRON trust pipeline mirrors v2.0's Solana shape with TRON-specific cryptographic-binding primitives. The same Layer 1 / Layer 2 / Layer 3 defenses apply identically; the per-chain primitives differ at the binding layer.

### (1) USB-HID transport trust shape

TRON signing uses `@ledgerhq/hw-app-trx` over `@ledgerhq/hw-transport-node-hid` — same USB-HID transport as Phase 12 Solana, no WalletConnect bridge. Per-call transport open + `try/finally` close (mirrors Phase 12 + Phase 17 patterns). The agent → MCP path runs over stdio; the MCP → Ledger path runs over USB-HID. The Ledger device's physical screen is the trust anchor.

### (2) Protobuf raw_data preimage vs EVM RLP

TRON's transaction binding hash runs over Protobuf-serialized `raw_data` bytes (`tronweb.transaction.raw_data_hex` → `Buffer.from(hex, "hex")`). This is structurally distinct from EVM's RLP-serialized EIP-1559 envelope: TRON's bytes describe an array of contract-instructions with explicit type discriminators (`TransferContract`, `TriggerSmartContract`, etc.); EVM's bytes are a single-tuple `[chainId, nonce, maxPriorityFee, maxFee, gas, to, value, data, accessList]`. Both hash via keccak256 at the VaultPilot binding layer; the domain tag (`"VaultPilot-trontx-v1:"` — 21 UTF-8 bytes, distinct from EVM 23 + Solana 20) makes cross-chain reuse impossible by construction.

### (3) SHA-256 tx-id (TRON consensus) vs EVM keccak256

TRON consensus computes `tx_id = SHA-256(raw_data)` (NOT keccak256 — TRON predates Ethereum's RLP-keccak combo and uses a distinct hash). The Ledger TRX app displays this exact 32-byte SHA-256 hash on blind-sign mode, labeled `"Transaction ID"`. The `LEDGER BLIND-SIGN HASH (TRON)` block in `preview_send` shows the same hash for character-for-character on-device comparison. Within the cryptographic-binding chain: `payloadFingerprint = keccak256(domain-tag ‖ raw_data)` is the agent↔MCP binding; `ledgerBlindSignHash = SHA-256(raw_data)` is the MCP↔device binding. Same input bytes; different hash functions for layer-appropriate uniqueness.

### (4) TRX app clear-sign coverage + bundled token registry

The Ledger TRX app v0.5+ ships a bundled token registry that clear-signs `transfer(address,uint256)` calldata for the bundled tokens: USDT-TRC20, USDC-TRC20, USDD, TUSD (the Phase 18 allowlist). For these tokens, the device displays `To`, `Token`, `Amount` decoded — the user sees the same data the PREPARE RECEIPT block surfaced server-side. For non-bundled tokens (Phase 19+), the app falls back to blind-sign mode (displays only the SHA-256 tx-id); Phase 18 + future phases emit `LEDGER NOTICE (TRON)` block above the BLIND-SIGN HASH block to warn the user.

`prepare_tron_token_approve` (Phase 19 — TRC-20 `approve(spender, amount)`) is a distinct ABI from `transfer` and is NOT in the bundled registry; the conditional NOTICE fires for every approve. `prepare_tron_stake_*` (Phase 19 — Stake 2.0 FreezeBalanceV2Contract) is a different Protobuf shape entirely from TriggerSmartContract; the app blind-signs the consensus tx-id and the NOTICE fires. `prepare_sunswap_*` (Phase 20 — SunSwap router calls) are TriggerSmartContract calls to NON-allowlist contracts; the NOTICE fires.

### (5) Layer 0.7 asymmetry — TRC-20 mandatory refusal, native TRX advisory only (accepted residual)

The Layer 0.7 simulation gate behaves asymmetrically between TRC-20 and native TRX. **TRC-20**: `preview_send` calls `triggerconstantcontract` against TronGrid and refuses with `SIMULATION_REFUSED` if the simulated execution reverts. **Native TRX (`TransferContract`)**: TronGrid has no simulation API for non-contract calls — the `triggerconstantcontract` endpoint is for smart-contract `view`/`pure` calls only. `preview_send` emits an explicit `CHECKS PERFORMED (TRON — no simulation available)` block instead of refusing.

**Accepted residual risk.** A native TRX transfer's defense at preview time relies entirely on (1) PREPARE RECEIPT byte-binding the agent's args verbatim + (2) LEDGER BLIND-SIGN HASH on-device match. A compromised agent that swaps the `to` address between the user's natural-language ask and the prepare call would be caught by PREPARE RECEIPT (the user reads the verbatim args in the response); a compromised MCP that swaps bytes between prepare and send would be caught by `payloadFingerprint` drift detection (PREP-08, Layer 3). The on-device tx-id is the final anchor. The asymmetry is surfaced visibly to the user via the `NO_SIMULATION_AVAILABLE_TRON` block — accepted residual; documented residual.

### (6) Ref-block + expiration window — TAPOS replay protection + extended expiration

TRON transactions carry two time-bounded fields:
- `ref_block_bytes` + `ref_block_hash` — TAPOS (Transactions-as-Proof-of-Stake) replay protection. The transaction references the latest solidified block at build time; validators reject the transaction if the referenced block falls outside their recent-solidified-chain cache (~15-30 minutes empirically).
- `expiration` — absolute millisecond timestamp at which the broadcast endpoint refuses the transaction. tronweb defaults to `block_timestamp + 60_000ms` (60 seconds).

Phase 18 prepare tools extend the expiration to **900 seconds (15 minutes)** via `tronweb.transactionBuilder.extendExpiration(tx, 900)` to match the 15-minute handle TTL (`HANDLE_TTL_MS`). Without the extension, a user who pauses ~5 minutes between prepare and send would broadcast a stale transaction and receive `BROADCAST_FAILED: TRANSACTION_EXPIRATION_ERROR`.

The 15-minute window sits inside the TAPOS replay window — both are valid for the same duration window. Past 15 minutes, the handle expires (`HANDLE_EXPIRED` envelope on `preview_send` / `send_transaction`), the user re-runs `prepare_tron_*` for a fresh handle with fresh ref-block + expiration fields. Defense-in-depth: the Layer 3 fingerprint-drift gate also catches any post-prepare in-process state corruption.
