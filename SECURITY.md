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
| **Supply-chain risk** — pkg-bundled npm-installed deps are pinned by hash in `package-lock.json` only; no SLSA provenance or sigstore signatures on release assets in v1.4. A compromised npm dep would land in the binary. | accept (v1.4) → mitigate (v1.5+) | v1.4 baseline: `package-lock.json` SHA-512 hashes (Phase 1-9 baseline) + per-asset SHA-256 sums + combined SHA256SUMS.txt published with each release. v1.5+ adds sigstore SLSA provenance + Cosign signatures on every release asset (RESEARCH § Topic 10 line 1232). Binary uses Node SEA injection via postject (v1.4.1+); the Node binary is sourced from nodejs.org/dist with pkg-fetch checksum verification — same supply-chain posture as Phase 10-01, no new attack surface. |

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

## TRON v2.1 Phase 19 (TRC-20 approve + Stake 2.0)

Phase 19 extends the Phase 18 trust pipeline to TRC-20 approve/revoke + the full Stake 2.0 lifecycle (freeze / unfreeze / withdraw-expire / vote / claim-rewards). All 7 new MCP tools consume the Phase 18 primitives shelf unchanged; no new cryptographic-binding primitives ship.

### 1. TRC-20 approve — `⚠ UNLIMITED APPROVAL` + revoke byte-identity

`prepare_tron_token_approve` accepts `amount: "max"` (strict lowercase equality) as the sentinel for `MAX_UINT256 = 2^256 - 1` (mirrors v1.1 Phase 6 PREP-29). On unlimited approve, the response emits `⚠ UNLIMITED APPROVAL (TRON)` block in CHECKS PERFORMED. The PREPARE RECEIPT surfaces the verbatim agent input (`amount: max`) — not the expanded 78-digit decimal — preserving the audit trail of agent intent.

`prepare_tron_revoke_approval` is a distinct named tool calling the same internal `prepareTronApproveInternal` helper with `amountWei: 0n`. **T-TRON-REVOKE-DRIFT-1** asserts byte-identical `rawDataHex` + `payloadFingerprint` between `revoke({T,S})` and `approve({T,S,amount:"0"})` — the shared helper makes drift IMPOSSIBLE BY CONSTRUCTION.

Spender labels resolved from `KNOWN_SPENDERS_TRON` (`src/config/contracts.ts` sibling sub-table); unknown spenders surface `(unknown spender — no prior interaction recorded)` literal. Labels are advisory; on-device base58check spender address is the trust anchor.

### 2. Stake 2.0 resource semantics (Energy vs Bandwidth)

`prepare_tron_stake_freeze` + `prepare_tron_stake_unfreeze` take a `resource: "ENERGY" | "BANDWIDTH"` enum (strict-equality — case variants rejected with `INVALID_INPUT`). The `STAKE_RESOURCE_TRON_TEMPLATE` block in CHECKS PERFORMED surfaces the resource semantics verbatim (`ENERGY` = consumed by TRC-20 transfers + contract calls; `BANDWIDTH` = consumed by tx broadcast). Users entering the wrong resource market still get a valid transaction (the calldata is well-formed); the surface block prevents silent confusion.

### 3. Asymmetric Layer 0.7 simulation gate

TRON simulation enforcement is asymmetric across `PreparedTxTron.kind` values:

- `"trc20"` (transfer, approve, revoke) — MANDATORY refusal on `triggerconstantcontract` REVERT via `simulation-tron.ts` Layer 0.7. Existing Phase 18 behavior; unchanged.
- `"stake-withdraw-expire"` — MANDATORY refusal when `_tronStake.checkWithdrawableBalance(tronWeb, fromAddress).withdrawable === 0n`. Uses `tronWeb.trx.getAccount` to read `unfrozenV2[]` records + sum matured `unfreeze_amount`. Refusal envelope surfaces `expiringAt` ISO timestamp. No server-side time-tracker per D-04c — leverages on-chain account state directly.
- `"native"` + `"stake-freeze"` + `"stake-unfreeze"` + `"stake-vote"` + `"stake-claim-rewards"` — ADVISORY `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE` block (NOT refusal). Defense for these kinds relies on PREPARE RECEIPT (byte-bound agent input) + LEDGER BLIND-SIGN HASH (TRON) (on-device SHA-256 tx-id match).

The asymmetry is intentional: TRC-20 has on-chain simulation via `triggerconstantcontract`; Stake 2.0 Protobuf-native contracts do not (they are not TVM smart contracts). Withdraw-expire is the exception because the eligibility check is a cheap account-state read, not a contract simulation.

### 4. SR registry trust source surfacing

`prepare_tron_stake_vote` resolves SR labels via a hybrid registry (`src/protocols/tron-sr-registry.ts`):
- PRIMARY: `tronWeb.trx.listSuperRepresentatives()` live fetch.
- FALLBACK: bundled `src/tokens/tron-srs.json` snapshot (~30 entries) on RPC failure.

The response ALWAYS surfaces `srSource: "live" | "snapshot-fallback"` so the trust source is unambiguous (mirrors `rpcDegraded` pattern from READ-05). Labels are advisory; on-device `vote_address` (base58check) is the trust anchor for user approval. Unknown SRs (not in either source) surface `(unverified SR — confirm address)` literal — not a positive label.

Accepted residual: 6h SR rotation cadence vs per-release snapshot refresh cadence. Snapshot drift is bounded by release cadence and is degraded UX, not a safety failure.

### 5. Voting rewards advisory — NO intent-vs-reality gate

`prepare_tron_stake_claim_rewards` is zero-arg (calldata is `WithdrawBalanceContract()` with only `owner_address`). The advisory field `estimatedRewardSun: string | null` is computed best-effort via `tronWeb.trx.getReward(fromAddress)`. RPC failure demotes to `null` + CHECKS PERFORMED block `"estimate unavailable (RPC failure)"`.

Deliberate departure from Phase 28 Compound's `INVALID_INPUT + hintTool` pattern: calldata has NO args to mismatch against. The protocol computes the actual reward at broadcast time; the agent-prepare-time estimate is informational, not a refusal trigger.

### 6. `LEDGER NOTICE (TRON)` emitted for all Phase 19 tools

None of Phase 19's 7 new tools target instructions present in the Ledger TRX-app bundled clear-sign registry. The TRX-app v1.0+ ships clear-sign decoders for native TRX `TransferContract` + the 4 stablecoin TRC-20 `transfer(to, amount)` calls (Phase 18). All Phase 19 calldata flows through blind-sign mode: user sees a 64-char SHA-256 tx-id and must match it character-for-character against the `LEDGER BLIND-SIGN HASH (TRON)` block in the preview output. The `LEDGER_NOTICE_TRON_TEMPLATE` (Phase 18 pre-staged) emits for every Phase 19 tool, naming the instruction + registry status `"not in TRX-app bundled clear-sign registry"`.

Opposite of Phase 18's TRC-20 stablecoin transfer pattern where clear-sign coverage exists.

### 7. Stake 1.0 deprecation regression locks

`FreezeBalanceContract` (Stake 1.0) is deprecated by the TRON network as of `java-tron 4.6.0`. Using the wrong tronweb builder (`transactionBuilder.freezeBalance(amount, duration, resource, owner)`) silently produces `raw_data.contract[0].type === "FreezeBalanceContract"` — REJECTED by validators at broadcast (not caught by simulation; deprecation is enforced at the validator-rules layer, not the VM layer).

Phase 19 locks against this regression at three layers:
1. Fixture Tron-19-B asserts `raw_data.contract[0].type === "FreezeBalanceV2Contract"` (exact string match).
2. Plan-check grep refuses any `transactionBuilder.freezeBalance\b` (word-boundary; prevents false match on `freezeBalanceV2`) call in `src/`.
3. Cross-link from `prepare-tron-stake-freeze.test.ts` to the fixture anchor.

### Phase 19 threat register summary

| Threat ID | STRIDE | Severity | Mitigation |
|-----------|--------|----------|------------|
| T-SPENDER-SUB-1 | Tampering | HIGH | KNOWN_SPENDERS_TRON allowlist + `⚠ UNLIMITED APPROVAL` block + Ledger blind-sign |
| T-TRON-REVOKE-DRIFT | Tampering | MEDIUM | Shared `prepareTronApproveInternal` makes drift impossible by construction |
| T-MAX-EXPLICIT | Tampering | MEDIUM | Strict lowercase `"max"` sentinel; case variants rejected by `parseTronAmountStrict` |
| T-STAKE2-DISTINCT | Tampering | HIGH | Fixture Tron-19-B `FreezeBalanceV2Contract` regression + grep at `src/` |
| T-EARLY-WITHDRAW | Denial-of-Service | MEDIUM | Layer 0.7 mandatory refusal via `_tronStake.checkWithdrawableBalance` account read |
| T-VOTE-MAP | Tampering | MEDIUM | Protocol-layer array→VoteInfo map conversion unit-tested |
| T-SR-REGISTRY | Information Disclosure | LOW | Hybrid live+snapshot; `srSource` always surfaced; labels advisory |
| T-REWARD-GATE | Repudiation | LOW | No gate on advisory estimate; zero-arg calldata has nothing to gate |
| T-NUMBER-OVERFLOW | Tampering | MEDIUM | `Number()` conversion guard in encodeFreezeBalanceV2 |
| T-FROZEN | Tampering | CRITICAL | `git diff origin/main -- <frozen-paths>` empty at Plan 19-04 commit; D-11a integration test assertion |

Existing content (header, threat model intro, invariants 1-14, Solana section, Phase 18 TRON section) BYTE-FROZEN — only new content appended above.

## TRON v2.1 Phase 20 (SunSwap V2 — get_sunswap_quote + prepare_sunswap_swap)

Phase 20 adds two MCP tools: `get_sunswap_quote` (read-only, on-chain `getAmountsOut`) and `prepare_sunswap_swap` (TriggerSmartContract to the SunSwap V2 router). All Phase 18/19 primitives (payload-fingerprint-tron, presign-hash, handle-store, blocks-tron) are consumed unchanged. No new cryptographic-binding primitives ship.

### 1. Sandwich-MEV defense (D-03b)

`prepare_sunswap_swap` enforces a prepare-time gate: if `priceImpactBps > 200` (2%) AND the agent did NOT explicitly supply `slippageBps`, the tool refuses with `INVALID_INPUT + hintTool: "get_sunswap_quote"`. Detection uses a pre-Zod raw-args presence check (`"slippageBps" in rawArgs && rawArgs.slippageBps !== undefined`) so Zod's `.default(50)` cannot mask the distinction. Explicit-slippage passes unconditionally (D-03c): the gate is "did the agent confirm awareness?", not "is the slippage value low enough?". Matches the Phase 14 Jupiter precedent.

### 2. TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST — sibling to the Phase 18 stablecoin set

A new 1-entry `TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST` (SunSwap V2 router — `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax`) is enforced at both `prepare_sunswap_swap` (Step 5 cheap gate before RPC calls) and `preview_send` TRON branch (Phase 20 sunswap-swap arm). This is explicitly SEPARATE from the Phase 18 `TRON_TRC20_DISPATCH_ALLOWLIST` (4-stablecoin set); `checkTronSmartContractDispatchTarget` uses the router set, `checkTronDispatchTarget` uses the stablecoin set — neither aliases the other. T-SOT-DRIFT-1: a cross-import assertion in `test/security-canonical-dispatch-tron.test.ts` verifies `SUNSWAP_V2_ROUTER_TRON_ADDRESS === KNOWN_SPENDERS_TRON[0].address` so the two canonical address references cannot drift.

### 3. Path computation server-side (D-10 — T-PATH-WTRX-DRIFT defense)

The swap path (`[inputToken, outputToken]` for direct WTRX pairs; `[inputToken, WTRX, outputToken]` for non-WTRX pairs) is computed by the server from the live `get_sunswap_quote` route — never accepted as an agent-supplied parameter. The path appears verbatim in the PREPARE RECEIPT block so the user can verify it character-for-character against what the server computed. Any tampering with the intermediate hop is visible both in the PREPARE RECEIPT and as a Ledger blind-sign hash mismatch (the path bytes are part of the `swapExactTokensForTokens` ABI-encoded calldata committed to by `payloadFingerprint`).

### 4. LiFi bridging deferred (D-04b — residual risk documented)

Cross-chain bridging (TRC-20/TRON → EVM via LiFi router) is deferred. The Phase 20 scope is TRON-only SunSwap V2 intra-chain swaps. A `20-02-DEFERRED.md` stub on main documents the deferral rationale. Accepted residual: agents cannot bridge TRON assets to EVM chains via this MCP server in v2.1. LiFi integration requires a separate dispatch gate for the LiFi contract address and a distinct PREPARE RECEIPT template.

### Phase 20 threat register summary

| Threat ID | STRIDE | Severity | Mitigation |
|-----------|--------|----------|------------|
| T-MEV-SANDWICH | Tampering | HIGH | D-03b gate: priceImpactBps > 200 + no explicit slippage → INVALID_INPUT + hintTool |
| T-PATH-WTRX-DRIFT | Tampering | HIGH | D-10: path server-computed from quote.route; displayed verbatim in PREPARE RECEIPT |
| T-ROUTER-SUB | Tampering | CRITICAL | TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST (1-entry); T-SOT-DRIFT-1 cross-import assert |
| T-AMOUNT-ZERO | Tampering | HIGH | slippageBps ≥ 10000 refused; amountOutMin = outAmount × (10000 − bps) / 10000 ≥ 1 |
| T-FROZEN-20 | Tampering | CRITICAL | git diff origin/main -- <frozen-paths> empty at Task 3 commit |

## TRON v2.1 milestone close-out summary

Closes out the v2.1 TRON milestone. Phases 17 + 18 + 19 + 20 (SunSwap only) shipped under per-plan admin-merge cadence; LiFi TRON facet deferred to v2.2.x per Phase 20 D-04b.

### Milestone PRs

- Phase 17 (TRON scaffolding) — PRs #83 / #84 / #88 / #91 / #92 — USB-HID transport, TRX reads, TRC-20 registry, `tronweb@6.3.0` research-lock, `fetchTronAddress` base58check DIRECTLY regression anchor, 5-level BIP-44 path divergence, persona, multi-chain portfolio TRON leg (TRON-READ-04 shipped here ahead of Phase 21 placement per Phase 17 FLAG-1)
- Phase 18 (TRON native + TRC-20 trust pipeline) — PRs #97 / #98 / #99 / #100 — `payload-fingerprint-tron.ts` domain-tagged keccak256 + `presign-hash-tron.ts` SHA-256 = TRON consensus tx-id = Ledger TRX-app blind-sign display + `simulation-tron.ts` NEVER-throws classifier + `blocks-tron.ts` 7 templates + `amount-tron.ts` u64/u256-discriminated parser + `canonical-dispatch-tron.ts` 4-stablecoin allowlist + `handle-store.ts` PreparedTxTron widening + Fixtures M + N hardcoded literals + `prepare_tron_native_send` + `prepare_tron_trc20_send` + `preview_send` / `send_transaction` / `get_tx_verification` TRON branches + Layer 0.5 canonical-dispatch + Layer 0.7 asymmetric simulation gate + LOAD-BEARING `extendExpiration(tx, 900)` + trust-pipeline integration test
- Phase 19 (TRC-20 approve + Stake 2.0) — PRs #106 / #107 / #108 / #109 — `prepare_tron_token_approve` + `prepare_tron_revoke_approval` + Stake 2.0 full lifecycle (freeze / unfreeze / withdraw-expire / vote / claim-rewards) + SR registry hybrid live+snapshot + `INVALID_INPUT + hintTool` intent-vs-reality gates + Fixtures Tron-19-{A,B,C,D} hardcoded literals + lifecycle integration test
- Phase 20 (SunSwap V2) — PR #113 — `get_sunswap_quote` + `prepare_sunswap_swap` + sandwich-MEV refusal at >2% price impact + `TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST` (SunSwap V2 router) + Fixture Tron-20-A hardcoded literal + LiFi TRON-W-11 + TRON-W-12 LiFi portion DEFERRED to v2.2.x

### Trust-shape recap

The v2.1 TRON trust pipeline mirrors the v2.0 Solana shape with TRON-specific cryptographic primitives:

- **USB-HID direct broadcast** via `tronweb.trx.sendRawTransaction` — NOT the WalletConnect bridge. TRON mirrors Solana's USB-HID direct broadcast; the WC bridge is EVM-only. The USB-HID transport is the physical custody boundary.
- **Domain-tagged `payloadFingerprint`**: `keccak256("VaultPilot-trontx-v1:" ‖ raw_data_bytes)` — the 21-byte UTF-8 domain tag makes cross-chain fingerprint reuse impossible by construction. Different from EVM (`"VaultPilot-evmtx-v1:"` — 22 bytes) and Solana (`"VaultPilot-soltx-v1:"` — 20 bytes).
- **`presignHash = SHA-256(raw_data)`** — TRON consensus tx-id. The Ledger TRX app displays this exact 32-byte hash on blind-sign mode, labeled "Transaction ID". The `LEDGER BLIND-SIGN HASH (TRON)` block in `preview_send` shows the same hash for character-for-character on-device comparison. Same input bytes as `payloadFingerprint`; different hash function for layer-appropriate uniqueness.
- **Asymmetric Layer 0.7 simulation gate** — TRC-20 mandatory `triggerconstantcontract` refusal vs native TRX `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE` advisory (asymmetry documented in Phase 18 §6 sub-3 + Phase 19 sub-3; accepted residual for native TRX).
- **`extendExpiration(tx, 900)`** — broadcast window extended to 15 minutes to match the 15-min handle TTL. Prevents `TRANSACTION_EXPIRATION_ERROR` from a ~5-min user pause between prepare and send. The 15-min window sits inside the TAPOS replay window.

### 21-code error union FROZEN — `INVALID_INPUT + hintTool` pattern

The 21-code `errorCodes` union (`src/signing/error-codes.ts`) has been frozen since Phase 18 close. Phases 19 + 20 + 21 all adopted the `INVALID_INPUT + hintTool` refusal pattern (intent-vs-reality gates / sandwich-MEV / pairing-not-set diagnostics) rather than extending the union with new codes.

Canonical adopters:
- Phase 19 D-11a — TRC-20 approve not-set + Stake 2.0 freeze/unfreeze invalid (`INVALID_INPUT + hintTool: "pair_tron_ledger"`)
- Phase 20 D-03b — sandwich-MEV >2% price impact refusal (`INVALID_INPUT + hintTool: "get_sunswap_quote"`)
- Phase 21 D-06 — no-pairing diagnostic (`INVALID_INPUT + hintTool: "pair_tron_ledger"`)

**Any future TRON write tool MUST follow this pattern. The 21-code union is closed.**

### Accepted residual risks

- **LiFi TRON-W-11 + TRON-W-12 LiFi portion DEFERRED to v2.2.x** per Phase 20 D-04b. LiFi has no TRON deployment as of 2026-05-20 (verified via live `/v1/chains` returning 69 EVM chains with no TRON, GitHub `lifinance/contracts/deployments/` no `tron*.json`, `/v1/quote?fromChain=TRX` returning error 1011). Reschedule preconditions documented in `20-02-DEFERRED.md`; the `checkpoint:human-verify` task signature is preserved for v2.2.x replan.

- **SR registry snapshot refresh cadence undocumented** — `src/tokens/tron-srs.json` (Phase 19 Plan 19-03) is a top-30 SR snapshot fallback when `tronWeb.trx.listSuperRepresentatives()` fails. The snapshot was anchored in Phase 19 from live data on 2026-05-20; no automated refresh cadence is documented. Backlog item: cron / CI job to refresh the snapshot quarterly + commit the diff under a labeled chore PR. Tracked-but-open residual; voting-tool reliability degrades over time as the on-chain SR set rotates.

- **v2.1 verify-phase pending real-Ledger USB-HID smoke** — TRX-app small-amount mainnet broadcast for: native TRX transfer, TRC-20 transfer (USDT-TRC20), Stake 2.0 freeze (Energy + Bandwidth), Stake 2.0 claim-rewards, SunSwap swap (small amount, low slippage). The smoke is bundled with Phase 17's deferred USB-HID smoke. Each broadcast verifies the on-device SHA-256 tx-id matches the `LEDGER BLIND-SIGN HASH (TRON)` block from `preview_send`. Open milestone-completion gate; NOT auto-resolved by Phase 21.

### Phase 21 (diagnostics) threat register summary

| Threat ID | STRIDE | Severity | Mitigation |
|-----------|--------|----------|------------|
| T-PAIRING-DRIFT (T-21-01) | Tampering | MEDIUM | `addressVerified = walletAddress === walletAddressOnDevice` strict-equality surfaced verbatim in tool response. Agent SHOULD warn user if false. NO automatic refusal — this is a diagnostic, not a guard. Test arm 2 covers the false case explicitly. |
| T-RPC-FAILURE-MASKED-AS-EMPTY (T-21-02) | Information Disclosure | LOW | `rpcDegraded.reason` set explicitly on TronGrid failure; frozen amounts default to "0" only when account is verifiably empty (frozenV2 is empty) OR explicitly degraded (rpcDegraded set). `resourceAccountPresent: false` distinguishes "account never touched" from "RPC down." Tests arms 6 + 7. |
| T-LEDGER-APP-VERSION-LIES (T-21-03) | Spoofing | LOW | `ledgerTrxAppVersion` is INFORMATIONAL only — no version-gating in v2.1. Spoofed version cannot weaponize the diagnostic by construction. Future `request_capability` integration may gate on minimum version; out of scope here. |
| T-FROZEN (T-21-FROZEN) | Tampering | CRITICAL | `git diff origin/main` empty assertion on the FROZEN file list at plan close (cryptographic-binding primitives + protocols + prepare tools + fingerprint test files + 21-code error union + handle-store + preview_send + send_transaction + canonical-dispatch-tron + contracts.ts). Phase 21 is READ-ONLY by construction. |

---

## Phase 23 — Bitcoin (BTC) Native SegWit + Taproot Trust Pipeline

Phase 23 (Plans 23-01 through 23-04) ships the BTC UTXO-model signing pipeline: per-input BIP-143 (segwit) / BIP-341 (taproot key-spend) sighash computation, keccak256-over-sighashes `payloadFingerprint`, PSBT-v0 construction and mixed-input two-pass signing, Esplora broadcast, and the full `prepare_btc_send → preview_send → send_transaction` trust pipeline.

### Trust shape divergence from EVM / Solana / TRON

| Layer | EVM | Solana | TRON | BTC |
|-------|-----|--------|------|-----|
| `payloadFingerprint` | keccak256(tag ‖ chainId ‖ to ‖ valueWei ‖ data) | keccak256(tag ‖ messageBytes) | keccak256(tag ‖ raw_data_bytes) | keccak256(tag ‖ sighash₀ ‖ … ‖ sighashₙ₋₁) |
| Domain tag | `VaultPilot-evmtx-v1:` (22 B) | `VaultPilot-soltx-v1:` (20 B) | `VaultPilot-trontx-v1:` (21 B) | `VaultPilot-btctx-v1:` (21 B) |
| Broadcast | WalletConnect (Ledger Live) | `sendRawTransaction` (Solana RPC) | `tronweb.trx.sendRawTransaction` | Esplora `POST /tx` |
| LEDGER display | one hash | one hash | one hash | N per-input sighashes (one per UTXO) |

BTC introduces the UTXO-model asymmetry: the `payloadFingerprint` is computed over the concatenation of per-input BIP-143/341 sighashes, not over a single serialized blob. This means:

- **Different UTXOs → different fingerprint** (by construction: each sighash commits to its UTXO's script + value).
- **Same UTXOs + same {to,sats} → byte-identical fingerprint** (regression anchor in `test/btc-trust-pipeline.integration.test.ts` Directions A + B).
- **Multi-input sighash recompute is the Layer 1 defense** (`previewSendBtcBranch` recomputes all N sighashes from the stored canonical artifact — NOT a re-parsed PSBT — and refuses on drift).

### PSBT serialization and two-pass mixed-input signing

`signBtcPsbt` (Plan 23-04, `src/wallet/ledger-btc-transport.ts`) implements the two-pass mixed-input split:

1. Partition inputs by script type (segwit vs taproot).
2. For each non-empty group, call `app.signPsbtBuffer(groupPsbt, { finalizePsbt: false, accountPath, addressFormat, knownAddressDerivations })`.
3. `Psbt.combine` the partial PSBTs → per-input finalization (skipping already-finalized inputs) → `extractTransaction().toHex()`.

`@ledgerhq/hw-app-btc@10` rejects a PSBT whose inputs span more than one script type in a single `signPsbtBuffer` call. The two-pass split is the canonical mitigation (RESEARCH Pattern 3 / BTC-PSBT-02).

`knownAddressDerivations` MUST include the change address on every `signPsbtBuffer` call (Pitfall 6): without it, the device renders the change output as a recipient send. The `BTC_MIXED_INPUT_SIGN_FAILURE` error code surfaces combine/finalize failures structurally.

### Canonical artifact and Pitfall 5 mitigation

The fingerprint recompute at `preview_send` (Layer 1) and `send_transaction` (Layer 3) reads the **stored canonical artifact** — `PreparedTxBtc.unsignedTxHex` + `PreparedTxBtc.perInputPrevouts` — NOT a re-parsed PSBT. Re-parsing a PSBT normalizes internal fields and can produce spurious drift-gate failures (Pitfall 5). The `test/send-transaction.btc.test.ts` T-16 zero-diff assertion verifies the FROZEN three-gate region of `send_transaction.ts` is byte-identical to `origin/main`.

### Accepted residual risks

- **Esplora endpoint trust (T-23-07 — accepted)** — the raw signed transaction is broadcast to a public Esplora instance. The operator controls which Esplora endpoint is configured. A hostile or BGP-hijacked endpoint can see the transaction bytes before broadcast but CANNOT alter the signature (signed by the device). The device's on-screen input/output/fee review is the backstop for address substitution. Documented residual: use a self-hosted or trusted Esplora instance in high-value scenarios.

- **OQ-3 change-index race (accepted)** — two rapid `prepare_btc_send` calls with the same UTXOs may select the same change output index. The PSBT builder uses a deterministic change address derived from the account's segwit or taproot path; a double-prepare does not corrupt the sighash (each call produces an independent PSBT). The race is visible because both handles carry the same `payloadFingerprint` (same UTXOs + same {to,sats}) — the user reviewing on-device sees the same tx on both handles.

- **v2.2 verify-phase pending real-Ledger USB-HID smoke (accepted)** — the BTC signing path (`signBtcPsbt`, two-pass mixed-input PSBT signing, live Esplora broadcast) has not been exercised against a physical Ledger device with the BTC app running. The verify-phase smoke is deferred to v2.2 milestone close:
  1. Segwit-only PSBT: small-amount mainnet P2WPKH transfer.
  2. Taproot-only PSBT: small-amount mainnet P2TR key-spend transfer.
  3. Mixed-input PSBT (segwit + taproot inputs): two-pass split + combine.
  4. Live Esplora broadcast: verify txid appears on mempool.space.
  5. On-device LEDGER BLIND-SIGN HASH comparison: per-input sighash bytes match the `LEDGER BLIND-SIGN HASH (BTC)` block from `preview_send`.

### Phase 23 threat register summary

| Threat ID | STRIDE | Severity | Mitigation |
|-----------|--------|----------|------------|
| T-23-13 | Tampering | CRITICAL | `previewSendBtcBranch` (Layer 1) and `sendTransactionBtcBranch` (Layer 3) recompute the fingerprint from the stored canonical artifact (unsigned tx hex + perInputPrevouts), not a re-parsed PSBT (Pitfall 5); any byte change in selected inputs/outputs → `PAYLOAD_FINGERPRINT_DRIFT` refusal. |
| T-23-14 | Tampering | CRITICAL | Per-input BIP-143/341 sighash drift: `previewSendBtcBranch` recomputes all N sighashes; the multi-hash `LEDGER BLIND-SIGN HASH (BTC)` block surfaces each sighash for user on-device verification. A drifted single input fails the fingerprint gate. |
| T-23-15 | Tampering | HIGH | Mixed-input two-pass signing seam: `signBtcPsbt` combines via `Psbt.combine` + per-input finalization + `extractTransaction`; the device independently re-derives each input's sighash; a tampered pass produces a device-visible mismatch. `BTC_MIXED_INPUT_SIGN_FAILURE` surfaces combine/finalize failures. |
| T-23-16 | Tampering | CRITICAL | FROZEN three-gate region of `send_transaction.ts` is byte-identical to `origin/main`; the BTC arm is additive. Zero-diff assertion in `test/send-transaction.btc.test.ts` T-16. |
| T-23-17 | Spoofing | HIGH | Change-output redirection: `knownAddressDerivations` includes the change address on every `signPsbtBuffer` call so the device marks it "change" — a redirected output renders as a "send" (device-visible). |
| T-23-18 | Information Disclosure | MEDIUM | Esplora broadcast failure masked as success: `broadcastTx` returns `{ kind: "rejected" \| "error" }` mapped to `BROADCAST_FAILED` with upstream message verbatim; never a silent success. |
| T-23-07 | Spoofing | MEDIUM | Esplora endpoint trust: accepted residual — operator-configurable; on-device review is the backstop. |
| T-23-SC | Tampering | LOW | npm supply-chain: no new packages in Phase 23 (RESEARCH §Package Legitimacy Audit). |

---

## Phase 27 — v2.2 Bitcoin/Litecoin Milestone Close-Out

Phase 27 (Plans 27-01 through 27-03) ships read-only forensic surface — Bitcoin Core + Litecoin Core JSON-RPC client, six forensic tools (`get_btc_block_tip`, `get_btc_block_stats`, `get_btc_blocks_recent`, `get_btc_chain_tips`, `get_btc_mempool_summary`, `get_litecoin_block_tip`, `get_litecoin_mempool_summary`), the cross-chain `build_incident_report` anomaly aggregator, and the `bitcoinCoreConfigured` / `litecoinCoreConfigured` boolean extension to `get_vaultpilot_config_status`. No signing-path changes; the FROZEN three-gate region of `send_transaction.ts` is byte-identical to `origin/main` across the full v2.2 milestone.

### v2.2 milestone PSBT serialization (cross-link)

PSBT serialization trust shape, per-input BIP-143/341 sighash binding, and the multi-input sighash recompute as the Layer 1 defense are documented at `## Phase 23 — Bitcoin (BTC) Native SegWit + Taproot Trust Pipeline`. Litecoin inherits the same shape via the Phase 26 LTC PSBT pipeline (Fixture Y/Z anchor in `test/signing-fingerprint.test.ts`); Phase 26 LTC threat-model content lives in the Phase 26 plan summaries. This sub-section is a navigation pointer — no new content.

### v2.2 milestone per-input BIP-143 sighash binding (cross-link)

The `payloadFingerprint` divergence table at `## Phase 23 — Bitcoin (BTC) Native SegWit + Taproot Trust Pipeline` documents BTC's per-input sighash composition (one keccak input per UTXO). LTC inherits the same shape with the `VaultPilot-ltctx-v1:` domain tag — every UTXO contributes one BIP-143 sighash to the fingerprint preimage, the device renders N per-input sighashes (one per UTXO), and `previewSendBtcBranch` / `previewSendLtcBranch` recompute all N sighashes from the stored canonical artifact at Layer 1. Navigation pointer only.

### Bitcoin Core RPC trust shape (NEW)

Phase 27's BTC + LTC forensic surface introduces a new trust boundary: the MCP server consumes a Bitcoin Core (and optionally Litecoin Core) JSON-RPC endpoint controlled by the operator. The operator is the adversary model for this surface — a compromised Core node returns tampered chain data — and the threat model is bounded by Phase 27 being read-only by construction.

- **private-node deployment recommendation.** Public Bitcoin Core RPC endpoints are rare; most operators run their own node (BitcoinD on `localhost` or a LAN-internal host). VaultPilot assumes a self-operated Core node and surfaces `bitcoinCoreConfigured` as a boolean only — the URL and credentials are out-of-band operator state.
- **Plain HTTP trust boundary.** Bitcoin Core RPC has no built-in TLS; the MCP server connects over plain HTTP. Deployments MUST be LAN-only OR routed through a TLS-terminating reverse proxy (nginx / Caddy). Operating Core RPC across the public internet without TLS termination is an explicit deployment defect, not a defended posture.
- **Basic-auth credentials in env vars.** `BITCOIN_CORE_RPC_USER` + `BITCOIN_CORE_RPC_PASS` (and the LTC siblings) are sensitive — the same handling rules as `WALLETCONNECT_PROJECT_ID` and `ETHERSCAN_API_KEY` apply. Credentials are consumed only by `src/clients/bitcoin-core-rpc.ts` internally; they NEVER appear in tool responses, structured content, or log output. `get_vaultpilot_config_status` surfaces only the `bitcoinCoreConfigured` / `litecoinCoreConfigured` booleans — never the URL, never the credentials. Secret-safety scrub asserts this at the `test/get-vaultpilot-config-status.test.ts` test surface.
- **Tampered-node threat model.** A compromised Core node returns manipulated chain data — fabricated `getblockchaininfo`, fake `getchaintips` fork tips, inflated `getmempoolinfo` size. This affects forensic accuracy (the agent surfaces wrong anomaly signals via `build_incident_report`) but NOT signing security. Phase 27 is read-only by construction: the Ledger device independently validates every PSBT at signing time against its own derivation, and Core RPC tampered data has no path into the signing pipeline. The residual risk surfaces in the agent's forensic claims to the user, not in fund movement.
- **SSRF accepted residual.** `BITCOIN_CORE_RPC_URL` is operator-configurable with no allowlist — the same accepted residual as `ETHEREUM_RPC_URL` and `BTC_ESPLORA_URL`. The operator controls the URL; defense in depth at the URL boundary is out-of-scope for the MCP server.

### LTC threat model (NEW)

Litecoin Core mirrors Bitcoin Core in trust shape — every BTC point above applies to LTC via `LITECOIN_CORE_RPC_URL` + `LITECOIN_CORE_RPC_USER` + `LITECOIN_CORE_RPC_PASS`. Two divergences:

- **MWEB (MimbleWimble Extension Blocks) is out of scope.** Litecoin Core's `getmempoolinfo`, `getblockstats`, and block responses may include MWEB-specific fields (`mweb_usage`, `mweb_size`, …). Phase 27 absorbs these via `[key: string]: unknown` index signatures on response types and intentionally does NOT surface them. MWEB privacy implications, MWEB transaction validation, and MWEB-aware anomaly detection are out-of-scope for Phase 27 — the forensic tools surface standard UTXO-model chain data only. A v2.3+ MWEB-aware extension is the canonical follow-up.
- **Chain-tip-lag baseline uses LTC's 2.5-minute target block time.** `build_incident_report` derives `expectedHeight = blocks + Math.floor((Date.now() / 1000 - mediantime) / 150)` for LTC (vs `600` for BTC). The local-clock trust input is accepted residual (T-27-INCIDENT-WALL-CLOCK) — surfaced to the agent via the `chain-tip-lag` anomaly's `note` field for downstream context.

### Phase 27 threat register summary

| Threat ID | STRIDE | Severity | Disposition | Mitigation |
|-----------|--------|----------|-------------|------------|
| T-27-CORE-CRED-LEAK | Information Disclosure | CRITICAL | mitigate | Core credentials structurally unreachable from `get_vaultpilot_config_status.ts` by import-graph construction (only URL readers imported, never `_USER`/`_PASS` readers). Runtime secret-safety scrub anchored in `test/get-vaultpilot-config-status.test.ts`. |
| T-27-MEMPOOL-DOS | Denial of Service | MEDIUM | mitigate | `getrawmempool(verbose=true)` is NEVER called — response can be tens of MB on a production node (RESEARCH §Pitfall 6). Tools use `getmempoolinfo` only. Source-grep regression at Plan 27-02 acceptance criteria. |
| T-27-MEMPOOL-RPC-ERR | Tampering | LOW | mitigate | RESEARCH §Pitfall 2 — Bitcoin Core uses HTTP 500 for JSON-RPC application-level errors. `callBitcoinCoreRpc` parses the body to extract `error.code` + `error.message` before emitting the `rpc-error` arm. Anchored in `test/clients-bitcoin-core-rpc.test.ts` Test 4. |
| T-27-INCIDENT-TIMEOUT | Denial of Service | LOW | mitigate | `build_incident_report` per-chain `AbortController` 10s timeout (`INCIDENT_REPORT_CHAIN_TIMEOUT_MS`) — a slow Core node cannot block the aggregate response. Mirror of Phase 8 `get_portfolio_summary` defense. |
| T-27-TAMPERED-CORE | Spoofing | MEDIUM | accept | A tampered Core node returns wrong forensic data and the agent surfaces wrong anomaly signals. Accepted residual: Phase 27 is read-only; affects forensic accuracy NOT signing security; the Ledger device independently validates PSBTs at signing time. |
| T-27-SC | Tampering | LOW | mitigate | NO new npm packages in Phase 27 (RESEARCH §Package Legitimacy Audit — empty table). Native `fetch` + `Buffer.from(...).toString("base64")` cover the full surface. |

The v2.2 milestone (Bitcoin + Litecoin, Phases 22–27) is functionally complete. The v2.2 verify-phase remains pending a real-Ledger USB-HID BTC + LTC app smoke against mainnet — small native send + RBF bump + BIP-137 message sign + multisig flow + Core RPC reads + LiFi bridge + `build_incident_report` cross-chain triage. Phase 27's forensic + incident-report surface is read-only by construction; the FROZEN three-gate region of `send_transaction.ts` is byte-identical to `origin/main` across the full v2.2 milestone.

---

## EVM lending + staking v2.3 milestone close-out summary

Closes out the v2.3 EVM lending + staking milestone. Phases 28 + 29 + 30 + 31 shipped under per-plan admin-merge cadence on Ethereum mainnet: Compound V3 (supply / withdraw / borrow / repay) + Morpho Blue (supply / withdraw / supplyCollateral / withdrawCollateral / borrow / repay) + Lido (stake / unstake-via-NFT / wrap / unwrap) + EigenLayer (curated-7-LST deposit) + Rocket Pool (stake / unstake-via-burn). All five lending/staking surfaces share the Phase 4 cryptographic-binding chain (`payloadFingerprint` + `presignHash` + three-gate enforcement at Layers 0.5 / 1 / 3); the FROZEN three-gate region of `send_transaction.ts` is byte-identical to `origin/main` across the full v2.3 milestone.

### Milestone PRs

- Phase 28 (Compound V3) — PRs #82 (SOT + protocol module + Fixtures R/S/T/U) / #86 (prepare_compound_supply + _withdraw + intent-gate prologue + deriveIntent) / #90 (prepare_compound_borrow + _repay + reverse-intent gates + MAX_UINT256 sentinel) / #94 (compound reads + defense + integration + Compound LEDGER NOTICE) / #95 (close-out) — six-Comet curated registry per chain, `deriveIntent` re-derivation at preview time (T-COMPOUND-INTENT-DRIFT-1), MAX_UINT256 repay-max sentinel (T-COMPOUND-REPAY-MAX-OVERFLOW-1), and the Compound V3 LEDGER NOTICE template (first lending protocol absent from the Ledger ERC-7730 registry).
- Phase 29 (Morpho Blue) — PRs #118 (planning) / #135 (Morpho Blue supply / withdraw / borrow / repay + 6 prepare tools + dispatch + integration + 4 follow-up fixes WR-01..WR-03) — isolated-market schema (`MorphoMarketParams.{loanToken, collateralToken, oracle, irm, lltv}`), Fixtures V/W/X/Y for the six market-write shapes, dual-token DECODED ARGS context (T-COMPOUND-TX-TO-CONFUSION-1 extension to the Morpho singleton tx.to), share-based vs asset-based repay encoding annotation, no LEDGER NOTICE (Morpho IS in the LedgerHQ ERC-7730 clear-signing registry — opposite of Compound).
- Phase 30 (Lido) — PRs #137 (planning) / #141 (Lido stake / unstake / wrap / unwrap on Ethereum mainnet) — stETH ↔ wstETH dual-token shelf with rebase-bearing stETH and rebase-resistant wstETH, NFT withdrawal-receipt surface (`NFT_RECEIPT_EXPECTED_TEMPLATE` + `expectedTokenId` via `getLastRequestId() + 1` — T-LIDO-NFT-TOKENID-RACE accepted residual), rebase-rewards approximation surface with load-bearing `approx: true` literal type (T-LIDO-REBASE-SNAPSHOT-STALENESS), Lido D-05 wrap-allowance pre-flight, Arbitrum bridged-wstETH read path with L1-authoritative `stEthPerToken` (Pitfall 5), no LEDGER NOTICE for any Lido selector (D-12 — all four Lido writes covered by ERC-7730 clear-sign).
- Phase 31 (EigenLayer + Rocket Pool) — PR (this PR) — EigenLayer curated-7-LST deposit (stETH / rETH / cbETH / ETHx / wBETH / sfrxETH / mETH) with D-05 StrategyManager-spender allowance pre-flight + D-06 MAX_UINT256-sentinel-guarded cap pre-flight (Pitfall 6) + D-10 slashing-risk informational line + Fixture Z anchor; Rocket Pool ETH→rETH stake + rETH burn unstake with D-07 minimum-deposit pre-flight (live read + hardcoded fallback) + D-08 deposit-pool-liquidity pre-flight + Fixtures AA-RP / AB-RP anchors; preview_send `(tx.to, selector)` tuple-dispatch mitigation for Pitfall 1 (`0xd0e30db0` WETH9.deposit vs RocketDepositPool.deposit collision) + Pitfall 2 (`0x42966c68` generic OpenZeppelin ERC20Burnable vs rETH.burn collision); D-13 LEDGER NOTICE templates for EigenLayer deposit (separate) and Rocket Pool stake + unstake (SHARED — symmetric blind-sign UX).

### Trust-shape recap

- **Cryptographic-binding chain unchanged** — the FROZEN three-gate region of `send_transaction.ts` (Layer 1 fingerprint-drift gate, Layer 2 cryptographic-binding gate, Layer 3 broadcast gate) is byte-identical to `origin/main` across all four phases. Every v2.3 prepare tool computes `payloadFingerprint = keccak256("VaultPilot-txverify-v1:" ‖ chainId ‖ to ‖ valueWei ‖ data)` at prepare time; `preview_send` recomputes the EIP-1559 `presignHash` from pinned nonce/gas/fees + a re-verified `payloadFingerprint` against the stored handle's `record.tx`; `send_transaction` re-verifies both gates before broadcast.
- **Canonical-dispatch allowlist (Layer 0.5)** is selector-blind by design — both `WETH9` and `RocketDepositPool` live independently in `CANONICAL_DISPATCH_TARGETS[1]` (Pitfall 1); `rETH` is allowlisted via the BRIDGED_VARIANTS row Plan 31-01 anchored cross-view byte-identity against (Pitfall 2). The disambiguation lives ONE LAYER UP — at `preview_send`'s DECODED ARGS dispatch — which routes on the `(tx.to, selector)` tuple.
- **Fixtures pinned forever** — every new transaction shape across Phases 28 / 29 / 30 / 31 anchors a hardcoded `0x...` `payloadFingerprint` literal in `test/signing-fingerprint.test.ts` (Fixtures R / S / T / U / V / W / X / Y / Z / AA-RP / AB-RP). Drift in preimage assembly OR encoder output OR SOT address fails at a specific assertion line; no self-snapshotting (CLAUDE.md "NO `beforeAll`-snapshot" rule). Cross-link tests in each prepare-tool spec re-anchor the byte-identity via the prepare-flow path; integration tests re-anchor across persona swaps to prove from-INDEPENDENCE end-to-end (T-BIND-1).
- **Selector-collision defense (NEW in v2.3)** — Phases 28 / 29 / 30 had no selector collisions in scope. Phase 31 introduces the first two cross-protocol selector collisions: `0xd0e30db0` shared between RocketDepositPool.deposit() and WETH9.deposit() (Pitfall 1), and `0x42966c68` shared between rETH.burn(uint256) and the generic OpenZeppelin ERC20Burnable.burn(uint256) extension (Pitfall 2). Both are mitigated at the `preview_send` DECODED ARGS dispatch by routing on the `(tx.to, selector)` tuple — the canonical-dispatch allowlist Set remains selector-blind. Anchored in `test/preview-send.rocketpool.test.ts` 4-arm coverage (positive + negative for each pitfall).

### Clear-sign coverage gap (NEW for v2.3)

- **Covered (no LEDGER NOTICE block emitted):** Lido (all four selectors — `Lido.submit` + `WithdrawalQueue.requestWithdrawals` + `wstETH.wrap` + `wstETH.unwrap` ARE in the LedgerHQ ERC-7730 clear-signing registry as of RESEARCH date 2026-05-23); Morpho Blue (all six market-write selectors ARE in the registry); WETH9 (`deposit` covered, but `withdraw` is NOT — Phase 6 LEDGER NOTICE retained).
- **NOT covered (LEDGER NOTICE block emitted at prepare time + preview_send time):** Compound V3 (`supply` + `withdraw` on all six curated Comets — Phase 28 LEDGER NOTICE template); EigenLayer (`StrategyManager.depositIntoStrategy` — Phase 31 LEDGER NOTICE template); Rocket Pool (`RocketDepositPool.deposit` + `rETH.burn` — Phase 31 SHARED LEDGER NOTICE template between stake + unstake for symmetric blind-sign UX); WETH9 (`withdraw` — Phase 6 LEDGER NOTICE retained); Morpho Blue (none — opposite of expectations; the protocol IS in the registry).
- **Defense in depth.** Blind-sign for an absent-from-ERC-7730 selector means the device displays a raw 32-byte hash, not decoded args. The user's cryptographic anchor is the on-device hash match against the `LEDGER BLIND-SIGN HASH` block in `preview_send` — character-for-character. The LEDGER NOTICE template surfaces this UX precondition (Settings → Blind signing → Enabled) BEFORE the user attempts to sign. Templates carry the same 10-line structure across Compound / EigenLayer / Rocket Pool for surface consistency.
- **Backlog item.** Submit ERC-7730 metadata for Compound V3 (six Comets × two selectors), EigenLayer (`depositIntoStrategy` — single shape), Rocket Pool (`RocketDepositPool.deposit` + `rETH.burn` — two shapes). v2.x scope; the metadata submission process is upstream-coordinated and not blocking for v2.3 milestone close. Tracked as accepted residual.

### Accepted residual risks

- **v2.3 verify-phase pending real-Ledger Ethereum-app smoke against mainnet** — all four protocols (Compound V3 supply/withdraw/borrow/repay; Morpho Blue six writes; Lido four writes; EigenLayer stETH deposit; Rocket Pool stake + burn) require a small-amount mainnet broadcast against a physical Ledger device with the Ethereum app running. Each broadcast verifies the on-device blind-sign hash (or clear-sign decoded args, where ERC-7730 coverage exists) matches the `LEDGER BLIND-SIGN HASH` / DECODED ARGS surface in `preview_send`. Same disposition pattern as v2.1 close-out for TRON. Open milestone-completion gate; the verify-phase smoke is bundled into the v2.3 verify-phase release prep.

- **EigenLayer + Rocket Pool ERC-7730 coverage absent (T-LEDGER-NOTICE-EIGENLAYER-1 + T-LEDGER-NOTICE-ROCKETPOOL-1)** — neither protocol is in the LedgerHQ clear-signing registry as of RESEARCH date 2026-05-23. The LEDGER NOTICE templates surface the blind-sign-required precondition; the trust anchor remains the on-device hash match. Backlog item: submit metadata. Documented residual.

- **Rocket Pool deposit-pool liquidity race window (T-ROCKETPOOL-LIQUIDITY-RACE — Pitfall 5)** — `prepare_rocketpool_unstake`'s D-08 pre-flight reads `RocketDepositPool.getBalance()` at prepare time; concurrent burns can drain the pool between prepare and send. The on-chain `require(ethBalance >= ethAmount)` in `rETH.burn` is the backstop revert. CHECKS PERFORMED surfaces the residual explicitly. Mitigation path: Uniswap V3 / Curve rETH→ETH swap (v2.4 backlog) as an alternative when the pool is dry.

- **EigenLayer queued-withdrawal claim flow deferred to v2.x** — Phase 31 ships EigenLayer DEPOSIT only. The `get_eigenlayer_positions` tool surfaces `pendingWithdrawals[]` for visibility, but `prepare_eigenlayer_claim` (consuming the `DelegationManager.completeQueuedWithdrawals` path after the withdrawal-delay window elapses) is NOT in v2.3 scope. AVS operator delegation (`DelegationManager.delegateTo`) is also deferred. Both surfaces are tracked as v2.x backlog items.

- **Rocket Pool minimum-deposit fallback drift (T-ROCKETPOOL-MIN-FALLBACK-DRIFT — accepted)** — if Rocket Pool governance changes `getMinimumDeposit()` AND the live RPC read fails, the hardcoded `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI = 0.01 ETH` may misfire (refuse on amount that's actually valid, or accept an amount that's actually below new min). Documented as v2.x re-verification item — refresh the constant + add a planner-gate verification script run if Rocket Pool DAO changes the minimum.

### Phase 31 threat register summary

| Threat ID | STRIDE | Severity | Disposition | Mitigation |
|-----------|--------|----------|-------------|------------|
| T-EIGENLAYER-STRATEGY-MISMATCH | Tampering | HIGH | mitigate | Curated 7-LST schema enum at the JSON-schema boundary + defensive runtime `CURATED_LSTS_SET` check in the handler; server resolves (strategy, lstToken) via SOT — agent NEVER passes raw addresses (Pitfall 3). Off-list refuses with `INVALID_INPUT + hintTool: "request_capability"`. Anchored in `test/prepare-eigenlayer-deposit.test.ts` T4. |
| T-EIGENLAYER-APPROVAL-DRIFT-1 | Tampering | HIGH | mitigate | D-05 LST-allowance pre-flight refuses `INVALID_INPUT + hintTool: "prepare_token_approve"` with spender = StrategyManager (NOT per-strategy proxy). Pitfall 4 stETH-rebase note in error text when `lst === "stETH"`. Anchored in T5a/T5b. |
| T-EIGENLAYER-CAP-OVERFLOW-1 | Tampering | HIGH | mitigate | D-06 MAX_UINT256-sentinel guard fires BEFORE the `currentTotalShares >= maxTotalDeposits` arithmetic (Pitfall 6). Defensive `.catch(() => MAX_UINT256)` on the `maxTotalDeposits` RPC. Anchored in T6/T7/T9. |
| T-LEDGER-NOTICE-EIGENLAYER-1 | Spoofing | MEDIUM | mitigate | `LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE` emitted verbatim by `prepare_eigenlayer_deposit` + `preview_send` EigenLayer arm. Cryptographic anchor: on-device blind-sign hash match against `LEDGER BLIND-SIGN HASH` block. |
| T-ROCKETPOOL-MIN-DEPOSIT-1 | Tampering | MEDIUM | mitigate | D-07 on-chain `getMinimumDeposit()` read + hardcoded `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI = 0.01 ETH` fallback on RPC failure. Refuses sub-minimum with `INVALID_INPUT + hintTool: "request_capability"`. |
| T-ROCKETPOOL-LIQUIDITY-1 | Tampering | HIGH | mitigate | D-08 deposit-pool-liquidity pre-flight via `Promise.all([RocketDepositPool.getBalance, rETH.getEthValue])`. Refuses pool<ethEquivalent with `INVALID_INPUT + hintTool: "request_capability" + feature: "Rocket Pool rETH/ETH DEX swap"`. Verbatim D-08 error message names Uniswap V3 / Curve as alternatives. |
| T-LEDGER-NOTICE-ROCKETPOOL-1 | Spoofing | MEDIUM | mitigate | `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE` SHARED between `prepare_rocketpool_stake` + `prepare_rocketpool_unstake` + `preview_send` Rocket Pool arms (D-13 — symmetric blind-sign UX). Same cryptographic anchor pattern as EigenLayer. |
| T-31-SELECTOR-COLLISION-DEPOSIT (Pitfall 1) | Tampering | HIGH | mitigate | `preview_send` routes DECODED ARGS dispatch on `(tx.to, selector)` tuple — `WETH9.deposit` and `RocketDepositPool.deposit` produce different DECODED ARGS arms + different LEDGER NOTICE behavior despite sharing `0xd0e30db0`. Allowlist Set stays selector-blind. Anchored in `test/preview-send.rocketpool.test.ts` T1+T2. |
| T-31-SELECTOR-COLLISION-BURN (Pitfall 2) | Tampering | HIGH | mitigate | Tuple dispatch — generic ERC-20 burn falls through to selector-blind handling, rETH burn routes to the Rocket Pool arm. Anchored in `test/preview-send.rocketpool.test.ts` T3+T4. |
| T-ROCKETPOOL-LIQUIDITY-RACE (Pitfall 5) | Spoofing | LOW | accept | Documented residual — prepare-time pool-balance read may drift before send. On-chain `require(ethBalance >= ethAmount)` is the backstop revert. Surfaced in CHECKS PERFORMED. |
| T-V2.3-VERIFY-PHASE-OPEN | Repudiation | LOW | accept | Real-Ledger Ethereum-app smoke pending against all four v2.3 protocols. Same disposition pattern as v2.1 TRON close-out. Code-complete; runtime untested-on-physical-device. |
| T-FROZEN-31 | Tampering | CRITICAL | mitigate | Zero-diff invariant on `src/signing/payload-fingerprint.ts` / `src/signing/presign-hash.ts` / `src/signing/handle-store.ts` / `src/tools/send_transaction.ts` / `src/clients/etherscan.ts` asserted by `git diff --stat origin/main` returning empty. |
| T-31-SC | Tampering | LOW | mitigate | NO new npm packages in Phase 31 (RESEARCH §Package Legitimacy Audit). All viem + Phase 30/31-02 protocol primitives. |

The v2.3 EVM lending + staking milestone (Phases 28 / 29 / 30 / 31) is code-complete. The v2.3 verify-phase remains pending a real-Ledger Ethereum-app smoke against Ethereum mainnet — small-amount supply / withdraw / borrow / repay on Compound V3 + supply / withdraw / supplyCollateral / withdrawCollateral / borrow / repay on Morpho Blue + stake / unstake / wrap / unwrap on Lido + curated-LST deposit on EigenLayer + stake / burn on Rocket Pool, verifying every on-device blind-sign hash (or clear-sign decoded args, where present) matches the `LEDGER BLIND-SIGN HASH` / DECODED ARGS surface in `preview_send`. The FROZEN three-gate region of `send_transaction.ts` is byte-identical to `origin/main` across the full v2.3 milestone.

## Phase 32 — Uniswap V3 swap (v2.4)

Phase 32 ships Ethereum-mainnet Uniswap V3 swap via SwapRouter02 — `get_uniswap_quote` (read) + `prepare_uniswap_swap` (write). The four-paragraph addendum below documents the residual risks and defense-in-depth choices anchored in CONTEXT.md decisions D-04b / D-08 / D-03 / D-11.

**Quoter-midpoint price-impact understatement (residual risk, accepted; D-04b).** Phase 32 computes price impact via the Quoter V2 tiny-amount fair-price reference: a small fraction of `amountIn` produces a near-impact-free quote that scales back to estimate fair output; impact basis points are the percentage drop between fair output and full-amount output. The method UNDERSTATES impact on pools with extremely concentrated liquidity at the spot tick where the tiny-amount reference cannot detect the cliff before the full amount triggers it. Mitigation: D-08's 2% sandwich-MEV refusal threshold errs on the side of refusal — a conservative defaults posture on the user's behalf. Production-grade midpoint sourcing (Chainlink price feeds or TWAP oracle) is deferred to v2.6 Phase 40 MEV-01.

**Sandwich-MEV refusal at PREPARE time (defense in depth; D-08).** The sandwich-MEV gate fires at both quote time (warning string in `get_uniswap_quote`) and prepare time (structured refusal block + `INVALID_INPUT` errorCode 1 in `prepare_uniswap_swap`). The prepare-time gate RE-FETCHES the quote rather than trusting the agent-cached value — load-bearing because the quote can drift between quote→prepare in volatile market conditions, and the agent is a cooperating but not trusted intermediary. When `priceImpactBps > 200` AND the caller did NOT explicitly supply `slippageBps` (pre-Zod raw-input detection — `slippageBps` defaulted by Zod is indistinguishable from agent-supplied without inspecting the raw input object), the tool refuses with the `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` block + `hintTool: "get_uniswap_quote"`. Anti-pattern 7 (NEVER re-fetch quote inside `send_transaction`; only at prepare) is enforced architecturally — `send_transaction` does not call the Quoter. Per-L2 calibration of the 2% threshold is deferred to v2.6 Phase 40 MEV-01.

**UniversalRouter deferral (scope decision; D-03).** Phase 32 targets SwapRouter02, not UniversalRouter. UniversalRouter requires Permit2-signed EIP-712 typed-data envelopes — a full multi-command surface (V3_SWAP_EXACT_IN, PERMIT2_TRANSFER_FROM, SWEEP). Typed-data clear-sign on Ledger is the open prerequisite for safely expanding the attack surface to UniversalRouter's command-byte interpreter. Anchored at v3.x in the roadmap. The trust boundary at v2.4 stays at SwapRouter02 + Quoter V2 (Quoter V2 is read-only — explicitly NOT in the canonical-dispatch allowlist per D-13a; only writers cross the dispatch gate).

**Unconditional LEDGER NOTICE — multicall outer blind-signs (residual UX cost; D-10 + D-11).** Phase 32 wraps every swap in `multicall(uint256 deadline, bytes[] data)` for deadline enforcement (D-10 — defense in depth against pending-tx replay when the user signs but doesn't broadcast immediately; SwapRouter02's `exactInput*` methods drop the deadline param to save gas). The outer multicall selector `0x5ae401dc` is NOT in the Ledger Ethereum app's ERC-7730 clear-sign plugin registry, even though the inner `exactInputSingle` / `exactInput` selectors ARE covered — the device only sees the outer multicall hash at signing time. User trust reduces to comparing the server-predicted `payloadFingerprint` to the device-displayed hash character-for-character (the FROZEN Phase 4 trust pipeline). `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` is emitted UNCONDITIONALLY by every `prepare_uniswap_swap` response and every `preview_send` routing through the SwapRouter02 dispatch arm. The `(tx.to, selector)` tuple-dispatch defense in `preview_send` prevents UniversalRouter's identical `0x5ae401dc` multicall selector from mis-routing to the Uniswap V3 DECODED ARGS arm (Pitfall 4).

### Phase 32 threat register summary

| Threat ID | STRIDE | Severity | Disposition | Mitigation |
|-----------|--------|----------|-------------|------------|
| T-32-SANDWICH-MEV-BYPASS | Tampering | HIGH | mitigate | Pre-Zod `slippageWasExplicit` raw-input detection ensures the gate fires when the agent omits `slippageBps` despite the Zod default. Sandwich-MEV refusal with `INVALID_INPUT + hintTool: "get_uniswap_quote"` when `priceImpactBps > 200 && !slippageWasExplicit`. Quote RE-FETCHED at prepare time (anti-pattern 7). Anchored in `test/prepare-uniswap-swap.test.ts` T6 (refusal arm) + T7 (pass arm). |
| T-32-APPROVAL-DRIFT | Tampering | HIGH | mitigate | D-07 token-approval pre-flight: non-ETH `tokenIn` reads `ERC20.allowance(from, SwapRouter02)`; insufficient → `INVALID_INPUT + hintTool: "prepare_token_approve" + hintArgs.spender = SwapRouter02`. Anchored in T8. |
| T-32-ETH-OUT-RECIPIENT-CONFUSION | Tampering | HIGH | mitigate | `composeMulticallWithUnwrap` helper centralizes the router-as-recipient discipline (Pitfall 3 / D-15 — inner `exactInputSingle.recipient` MUST be `SwapRouter02` so the router holds WETH between sub-calls; `unwrapWETH9` sends ETH to the user atomically). Anchored in T15. |
| T-32-DEADLINE-REPLAY | Repudiation | MEDIUM | mitigate | Every swap wrapped in `multicall(uint256 deadline, bytes[])` per D-10. Deadline = `block.timestamp + 600s`. SwapRouter02 native `exactInput*` methods drop deadline for gas — the multicall overload restores enforcement. Anchored in T19. |
| T-32-MULTICALL-OVERLOAD-COLLISION (Pitfall 4) | Tampering | HIGH | mitigate | `preview_send` routes DECODED ARGS dispatch on `(tx.to, selector)` tuple — `0x5ae401dc` is also Uniswap UniversalRouter's multicall selector; tuple gate ensures only `tx.to === SwapRouter02` calls route to the Uniswap V3 arm. Anchored in `test/preview-send.uniswap-v3.test.ts` T6. |
| T-32-PREVIEW-SEND-SELECTOR-DISPATCH | Tampering | HIGH | mitigate | 4 new selector arms (`exactInputSingle` / `exactInput` / `multicall` / `unwrapWETH9`) wired into `preview_send`. Multicall arm RECURSIVELY decodes inner sub-calls via the same `(tx.to, innerSelector)` tuple. Phase 31 dispatch arms byte-identical (T8 regression). |
| T-32-LEDGER-BLIND-SIGN-UX | Information Disclosure | MEDIUM | accept | LEDGER NOTICE block emitted UNCONDITIONALLY at prepare time + preview time per D-11. Residual UX cost documented (worse than Aave / Lido clear-sign experience). Trust anchor: server-predicted `payloadFingerprint` matches device-displayed hash character-for-character (FROZEN Phase 4 trust pipeline). |
| T-32-FROM-DEPENDENCE | Tampering | LOW | accept (documented) | Uniswap V3 calldata embeds `recipient = resolved-from-address` in `exactInputSingle` / `exactInput` / `unwrapWETH9` params. Fingerprint VARIES with `from` — different from Phase 31 EigenLayer Fixture Z which is from-INDEPENDENT. `test/integration-uniswap-v3-persona-cycle.test.ts` asserts per-persona determinism via independent re-computation through encoder primitives instead of cross-persona byte-identity. |
| T-32-QUOTER-MIDPOINT-UNDERSTATEMENT (D-04b) | Information Disclosure | LOW | accept | Tiny-amount fair-price reference understates impact at concentrated-liquidity cliffs. Mitigation: D-08's 2% refusal threshold is conservative. Production-grade midpoint sourcing deferred to v2.6 Phase 40 MEV-01. |
| T-FROZEN-32 | Tampering | CRITICAL | mitigate | Zero-diff invariant on `src/signing/payload-fingerprint.ts` / `src/signing/presign-hash.ts` / `src/signing/handle-store.ts` / `src/tools/send_transaction.ts` / `src/clients/etherscan.ts` / `src/clients/fourbyte.ts` asserted by `git diff --stat origin/main` returning empty across the full Phase 32 milestone. |
| T-32-SC | Tampering | LOW | mitigate | NO new npm packages in Phase 32 (RESEARCH § Package Legitimacy Audit confirmed). All viem + existing project dependencies. |

The v2.4 swap-only milestone (Phase 32) is code-complete. The v2.4 verify-phase remains pending a real-Ledger Ethereum-app smoke against Ethereum mainnet — small-amount swaps via SwapRouter02 covering single-hop / multi-hop / ETH-in / ETH-out paths, verifying every on-device blind-sign hash matches the `LEDGER BLIND-SIGN HASH` surface in `preview_send`. Phase 33 (Uniswap V3 LP verbs) is the next v2.4 phase. The FROZEN trust-pipeline files stay byte-identical to `origin/main` across Phase 32.

## Phase 38 — `enableModule` + delegatecall hard-trigger second-LLM check (Inv #12.5) + v2.5 close-out

Phase 38 promotes two pre-staged Phase 37 informational `delegatecall: YES` placeholder lines into APPEND-ONLY hard-trigger blocks emitted at four MCP-side sites: `prepare_safe_tx_propose`, `prepare_safe_tx_approve`, `prepare_safe_tx_execute`, and `preview_send` (defense-in-depth re-emission inside the existing Phase 37 `isSafeExecTransaction` branch). The four-paragraph addendum below codifies Inv #12.5 and closes out the v2.5 Safe multisig milestone (Phases 36 + 37 + 38).

### Inv #12.5 — High-blast-radius Safe operations require second-LLM cross-check before signing

Two trigger conditions, both inspected on the SafeTx's INNER `data` and `operation` fields (NOT the outer `execTransaction` calldata):

1. **`enableModule(address)` calldata pattern** — selector `0x610b5925`, single `address` argument. The block fires when the SafeTx's inner `data` starts with this selector AND `to === safeAddress` (a Safe enabling a module on ITSELF). Enabling a malicious module is equivalent to draining the Safe — modules call `execTransactionFromModule` and bypass owner-approval entirely.
2. **`operation === "delegatecall"` discriminator** — `delegatecall` executes the target contract's code in the Safe's storage context, equivalent to a contract upgrade. Legitimate uses include `multiSend` (non-CallOnly) for batched ops; also a common upgrade-attack vector that can rewrite the Safe's owner set / threshold / implementation.

The hard-trigger blocks are NOT structured refusals — both operations are LEGITIMATE Safe surface. The blocks (`[HARD-TRIGGER — MODULE ENABLE]` and `[HARD-TRIGGER — DELEGATECALL]`, in `src/signing/blocks.ts` end-of-file) are INSTRUCTIONS to the agent to invoke `get_verification_artifact({ handle })`, surface the pasteable block to the user verbatim (markers preserved), and obtain confirmation of an out-of-band second-LLM cross-check before relaying `userDecision: "send"`. Composite SafeTx (both triggers fire) emits BOTH blocks in document order — MODULE ENABLE first (narrower selector match), DELEGATECALL second (broader operation match) — and the skill keys on titles independently.

The skill-side `vaultpilot-preflight` v1.4 Step 0.5 HALT condition is the LOAD-BEARING enforcement: agent MUST call `get_verification_artifact` + surface the artifact + obtain user confirmation before assisting with `submit_safe_tx_signature({ userDecision: "send" })` or `send_transaction` against the handle. Until all three conditions are met, the skill emits verbatim `DO NOT SIGN. — Inv #12.5 second-LLM check incomplete (Safe high-blast-radius operation).` and refuses to relay the user's "send" intent. The MCP-side block is the trigger signal; the skill is the gate.

**A1 resolution.** Phase 38 extends `get_verification_artifact` (Phase 9 Plan 09-03) with a `txType` dispatch: `PreparedTxSafeTypedData` handles now return the REAL Safe-side fields (`safeAddress`, `safeTxTo`, `safeTxValue`, `safeTxData`, `operation`, `safeTxHash`, `payloadFingerprint`) via the new `PASTEABLE_BLOCK_TEMPLATE_SAFE` — NOT the EVM-shape sentinel zeros stored on the handle. The hard-trigger block's Step 1 instruction is now operationally meaningful for propose/approve handles; execute-path `PreparedTxEvm` handles still surface the outer `execTransaction` calldata via the unchanged EVM template (the second LLM decodes execTransaction(...) and recursively decodes the encapsulated SafeTx).

**DF-2 resolution.** The companion-skill SHA pin at `src/security/skill-integrity.ts:60-61` is REPLACED (NOT promoted to a multi-version additive list) from the v1.3.x SHA to v1.4 SHA `8eb8ba90fb4c7a21ac5579a4533d9221cc136b8d188b0daa6b652b5743da9a4f`, computed from `.planning/phases/38-safe-enable-module-delegate-call-second-llm/38-02-SKILL-TEMPLATE.md`. Single-coordinated-release discipline: ALL FOUR satellite sites (skill-integrity.ts constant + server.ts INSTRUCTIONS interpolation + blocks.ts VAULTPILOT_NOTICE_TEMPLATE_MISSING install one-liner + VAULTPILOT_NOTICE_TEMPLATE_TAMPERED branch (c) "older skill version" prose) moved in lockstep. Promoting to an additive list would be a security regression (a tampered SKILL.md matching an OLD version's SHA would pass the check); users on v1.3.x receive `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` instructing `git checkout v1.4`. Plan 38-02 publishes the sister-repo `szhygulin/vaultpilot-preflight-skill` v1.4 release tag with byte-identical SKILL.md content.

### Ledger typed-data CAL coverage gap (Phase 37 accepted residual — cross-link)

Phase 37 shipped the EIP-712 typed-data signing flow (`prepare_safe_tx_propose` / `_approve`) with documented blind-sign residual: the Ledger ETH app's CAL (Companion Application List) covers a finite set of Safe contracts; outside coverage the device displays only the 32-byte `safeTxHash` digest (blind-sign mode). Phase 38's hard-trigger blocks are the LAYERED DEFENSE for blind-signed Safe typed-data — a user signing a blind hash against a malicious `enableModule` or `delegatecall` SafeTx cannot recover the operation from the device display, but the agent's response surfaces the hard-trigger block + the skill-side scan halts the flow + the second-LLM out-of-band decode independently verifies what the user is about to sign. The CAL coverage gap remains accepted residual at v1.x / v2.x; Inv #12.5 closes the high-blast-radius subset that motivated user concern.

### v2.5 milestone close-out summary

The v2.5 Safe multisig milestone is **code-complete** across three phases:

1. **Phase 36 — Safe positions + Tx Service (read-side foundation).** `src/clients/safe-tx-service.ts` 5-arm discriminated-union client (URL migration to `api.safe.global/tx-service/{shortname}/api`); `src/chains/safe.ts` Singleton state reader (multicall + module enumeration); `get_safe_positions` multi-chain fan-out with drift detection; `get_safe_transaction` per-SafeTx detail with cached ABI decode. Canonical-dispatch Safe arm covering 4 Singleton variants × 5 chains.
2. **Phase 37 — Three-step signing flow (write-side trust pipeline).** `src/signing/safe-tx-hash.ts` EIP-712 typed-data digest via `viem.hashTypedData` (v1.3.0 + v1.4.1 byte-identical typehashes); `src/signing/payload-fingerprint.ts` `SAFE_TX_FINGERPRINT_DOMAIN_TAG` extension; `PreparedTxSafeTypedData` 7th `PreparedTx` union member; `prepare_safe_tx_propose` / `_approve` / `submit_safe_tx_signature` / `_execute`; `preview_send` `isSafeExecTransaction` Layer 0.5 sentinel bypass with 5 prepare-time invariants. Fixtures SAFE-A / SAFE-B / SAFE-C / SAFE-D hardcoded `0x...` literals.
3. **Phase 38 — Inv #12.5 hard-trigger second-LLM check (this phase).** Four MCP-side emission sites + `get_verification_artifact` `txType` dispatch + v1.4 skill SHA-pin REPLACEMENT + Fixture SAFE-G selector regression anchor.

The v2.5 verify-phase remains pending a real-Ledger Ethereum-app smoke against Ethereum mainnet — small-amount 1-of-1 Safe propose → submit → execute on a sentinel "no-op" module, verifying the on-device blind-sign hash matches the `LEDGER BLIND-SIGN HASH` surface in `preview_send` AND the hard-trigger block + second-LLM ritual fire end-to-end. The FROZEN trust-pipeline files (`src/signing/payload-fingerprint.ts`, `src/signing/handle-store.ts` state machine, `src/tools/send_transaction.ts` three gates, Phase 37 cryptographic-binding fixtures SAFE-A / B / C / D) stay byte-identical to `origin/main` across all three phases.

### Phase 38 threat register summary

| Threat ID | STRIDE | Severity | Disposition | Mitigation |
|-----------|--------|----------|-------------|------------|
| T-INV-12.5-NON-SKILL-1 | Information Disclosure | MEDIUM | accept | Documented residual. A non-skill-using agent receives the `VAULTPILOT_NOTICE_TEMPLATE_MISSING` block (Plan 09-02 dispatcher-wrap) surfacing the defense-in-depth gap; trust anchor remains the Ledger device screen. MCP cannot enforce the hard-trigger — it is an instruction to the agent, not a server-side gate. Skill-side enforcement is the load-bearing defense; the MCP-side block is the trigger signal. |
| T-MODULE-ENABLE-MALICIOUS-1 | Elevation of Privilege | HIGH | mitigate | `[HARD-TRIGGER — MODULE ENABLE]` block emitted at four sites when data starts with `0x610b5925` AND `to === safeAddress`. Skill-side Inv #12.5 HALT condition refuses `userDecision: "send"` until second-LLM confirmation. Decoded module address surfaced in the block + in `PASTEABLE_BLOCK_TEMPLATE_SAFE` for second-LLM cross-check. |
| T-DELEGATECALL-UPGRADE-ATTACK-1 | Elevation of Privilege | HIGH | mitigate | `[HARD-TRIGGER — DELEGATECALL]` block emitted at four sites when `operation === "delegatecall"` (semantic string at prepare; numeric `=== 1` at preview). Same defense layers as T-MODULE-ENABLE-MALICIOUS-1; catches `changeMasterCopy` and `multiSend` non-CallOnly by construction. |
| T-COMPOSITE-EMISSION-DRIFT-1 | Tampering | MEDIUM | mitigate | Composite SafeTx emits BOTH blocks in document order — MODULE ENABLE first (narrower selector match), DELEGATECALL second (broader operation match). Never combined. Regression tests at all four sites assert `text.indexOf("MODULE ENABLE") < text.indexOf("DELEGATECALL")`. Skill keys on titles independently — drift in either title or order breaks the test. |
| T-FROZEN-SIGNING-38 | Tampering | CRITICAL | mitigate | `src/signing/payload-fingerprint.ts`, `src/signing/handle-store.ts` state machine, `src/tools/send_transaction.ts` three gates, Phase 37 cryptographic-binding fixtures SAFE-A / B / C / D unchanged. `git diff origin/main -- <FROZEN files>` returns empty across all three Plan 38-01 commits. Fixture SAFE-G (new) is a SELECTOR + DECODER regression anchor, NOT a fingerprint shape — no cryptographic-binding extension. |
| T-SKILL-V14-COORDINATION-1 | Tampering | MEDIUM | mitigate | Plan 38-01 commits the v1.4 SHA pin computed from `.planning/phases/38-.../38-02-SKILL-TEMPLATE.md` BEFORE Plan 38-02 tags the sister-repo release. Plan 38-02 byte-identically copies the planning artifact to sister-repo SKILL.md — `sha256sum` cross-check at Plan 38-02 execute-time anchors the byte-identity. Mirror of Plan 09-01 → 09-02 coordination pattern. |
| T-DECODE-TRUNCATED-CALLDATA-1 | Tampering / Denial of Service | MEDIUM | mitigate | `decodeEnableModuleCalldata` throws on truncated input; prepare-side pre-flight surfaces `INVALID_INPUT + "SafeTx data starts with enableModule selector but argument decode failed; bytes may be malformed"` BEFORE handle minting. Preview-side re-emission silently SKIPS the MODULE ENABLE block (defense-in-depth ONLY; prepare-side already refused). |
| T-V1.3.0-PROSE-DRIFT-1 | Tampering | LOW | mitigate | Single-coordinated-release discipline: ALL FOUR satellite sites (skill-integrity.ts constant + server.ts INSTRUCTIONS interpolation + blocks.ts notice-missing install one-liner + notice-tampered branch (c)) move in the same atomic commit. Regression test `Test 13 (security-skill-integrity.test.ts)` asserts zero remaining `v1.3.0` literals in `src/server.ts` + `src/signing/blocks.ts`. |
| T-FANOUT-SENTINEL-38 | Tampering | MEDIUM | mitigate | `ENABLE_MODULE_SELECTOR = "0x610b5925"` lives in `src/protocols/safe.ts` exactly once. `[HARD-TRIGGER — MODULE ENABLE]` and `[HARD-TRIGGER — DELEGATECALL]` string-literal emissions live in `src/signing/blocks.ts` exactly once each — verified by `test/signing-blocks-hard-trigger.test.ts` grep regression (filtered to string-literal occurrences, excluding JSDoc / line-comment backtick references). Skill-side v1.4 Step 0.5 scan keys on these literal titles — drift in either title (em-dash → ASCII hyphen substitution, case change, spacing change) breaks Inv #12.5 enforcement coupling. |

The v2.5 Safe milestone (Phase 36 + 37 + 38) is code-complete. The v2.5 verify-phase remains pending a real-Ledger Ethereum-app smoke against Ethereum mainnet covering 1-of-1 Safe propose → submit → execute with hard-trigger block traversal + second-LLM ritual on a sentinel "no-op" module. Phase 39 (cross-chain bridges) is the next v2.6 phase. The FROZEN trust-pipeline files stay byte-identical to `origin/main` across the full v2.5 milestone.

## Bridge Tier-1 final-recipient assertion (v2.6 — Phase 39, Inv #6b EVM path)

### Threat

A compromised agent can supply a clean-looking `toAddress` to the user's eyes (visible in the MCP response and PREPARE RECEIPT block) while encoding a different recipient inside opaque bridge calldata that the Ledger device cannot decode. The device shows the EOA call to the bridge contract address but cannot parse the bridge protocol's internal recipient field — the on-device display is insufficient to detect the mismatch. This is a trust-boundary violation at the agent → MCP boundary: the agent controls both the user-visible argument and the calldata content, and can diverge them without detection if no server-side assertion exists.

### Control — preview_send Layer 0.6 (Inv #6b EVM path)

Phase 39 adds a new Layer 0.6 assertion in `preview_send` (EVM path) that fires AFTER the Layer 0.5 canonical-dispatch allowlist (the bridge contract must already be allowlisted) and BEFORE the Layer 2 chain-name mismatch check. The assertion:

1. Calls `_bridgeTier1Decoders.decodeBridgeTier1FacetRecipient(record.tx.data)` — the centralized Tier-1 bridge decoder registry — against the EVM calldata stored in the handle.
2. On `no-match` (non-Tier-1 selector, DEX swap, or native send): passes through silently. Layer 0.6 is a no-op for non-bridge calls.
3. On `error` (Tier-1 selector matched but calldata malformed or unsupported destination chain): refuses with `[REFUSED — DECODED RECIPIENT DRIFT]`, error code `DECODED_RECIPIENT_DRIFT`. Opaque calldata we cannot decode at a Tier-1 bridge call site is a security event, not a benign pass-through.
4. On `ok` (Tier-1 selector matched and recipient decoded): performs an encoding-aware comparison against `record.tx.bridgeParams?.toAddress` (the user-supplied recipient stored at prepare time). Mismatch or absent stored recipient → `[REFUSED — DECODED RECIPIENT DRIFT]` naming `bridge=`, `decoded=`, `supplied=`.

**Four Tier-1 bridges covered:**
- Wormhole Token Bridge — `transferTokensWithPayload` (selector `0xc5a5ebda`)
- Mayan Swift — `createOrderWithEth` (`0xb866e173`) and `createOrderWithToken` (`0x8e8d142b`)
- NEAR OmniBridge — `initTransfer` (`0xdeb915b8`)
- Across V3 SpokePool — `depositV3` (`0x7b939232`)

### Centralization rationale

Single placement at `preview_send` means every current and future swap/bridge tool that routes through `preview_send` inherits the assertion with no per-tool edits. Adding a new bridge prepare tool requires only registering the decoder in `src/protocols/bridge-decoders/index.ts` (the `TIER1_DECODERS` map) — `preview_send` picks it up automatically.

### Encoding-aware normalization (T-BRIDGE-SOLANA-NORM-1)

The comparison is encoding-aware. The decoder already returns `finalRecipient` in canonical normalized form. `preview_send` normalizes the user-supplied `bridgeParams.toAddress` the same way before comparison:

- **EVM (0x-prefixed 20-byte address):** both sides through `getAddress()` (EIP-55 checksum) — case-insensitive comparison.
- **Solana base58 pubkey:** trim-only, CASE-SENSITIVE comparison. Solana base58 pubkeys are case-sensitive — two different pubkeys may share the same lowercase string. A blanket `.toLowerCase()` on both sides is a spoofing bug. The regression guard (test 9 in `test/preview-send.bridge-tier1.test.ts`) asserts that the exact-case base58 MATCHES and the lowercased base58 REFUSES.
- **NEAR account-id:** the NEAR OmniBridge decoder already normalizes to `toLowerCase().trim()` at decode time; trim-only compare is correct post-normalization.

### Accepted residuals

**Tier-2 bridge deferral:** deBridge/DLN, Stargate `composeMsg`, Hop, and Symbiosis are EVM-to-EVM bridges — the recipient is a plain EVM address visible on the Ledger device display without bridge-specific decoding. No decoder ships for Tier-2 in Phase 39. This is documented in `REQUIREMENTS.md` as out-of-scope for v2.6; Tier-2 decoder addition requires only extending `TIER1_DECODERS`.

**Mayan SYNTHETIC fixture:** The Mayan Swift `createOrderWithEth` / `createOrderWithToken` ABI was confirmed from Etherscan (`0xC38e4e6A15593f908255214653d3d947ca1c2338`). No direct `createOrderWithEth` mainnet calldata was found in the contract's recent transaction history (primarily `fulfill`/`unlock` ops). Fixtures in `test/bridge-decoders-mayan-swift.test.ts` are ABI-encoded programmatically from the confirmed ABI + a verified Solana pubkey bytes32, labeled `// SYNTHETIC`. ABI-drift is caught at test time. This mirrors the `lifi-btc.ts` Phase 26 programmatic-fixture precedent.

### Phase 39 threat register summary

| Threat ID | STRIDE | Severity | Disposition | Mitigation |
|-----------|--------|----------|-------------|------------|
| T-BRIDGE-RECIPIENT-SPOOF-1 | Tampering | HIGH | mitigate | Layer 0.6 decodes the Tier-1 bridge recipient from calldata and asserts equality against the user-supplied `bridgeParams.toAddress` stored on the handle at prepare time. Mismatch → `[REFUSED — DECODED RECIPIENT DRIFT]` (error code `DECODED_RECIPIENT_DRIFT`). Layer 0.6 fires AFTER Layer 0.5 (bridge contract must be allowlisted) and BEFORE Layer 2 (chain-mismatch). Empty stored toAddress on a Tier-1 selector match refuses (Pitfall 5 — no silent pass). |
| T-BRIDGE-DECODER-DOS-1 | Denial of Service | MEDIUM | mitigate | All four Tier-1 decoders and the registry dispatcher are WR-02 NEVER-throws — every error path returns `{ kind: "error" }`. Malformed or truncated Tier-1 calldata reaches Layer 0.6 as an `error` result → isError:true refusal, not an exception into the preview flow. Test 7 in `test/preview-send.bridge-tier1.test.ts` asserts the no-throw invariant. |
| T-BRIDGE-SOLANA-NORM-1 | Spoofing | HIGH | mitigate | Encoding-aware comparison: EVM 0x40-hex → `getAddress()` both sides (EIP-55 case-insensitive); Solana base58 / NEAR account-id → trim-only CASE-SENSITIVE (no blanket `.toLowerCase()`). Tests 8 + 9 in `test/preview-send.bridge-tier1.test.ts` pin the Solana regression: exact-base58 toAddress MATCHES; lowercased-base58 REFUSES. Wormhole decoder pinned literal `"2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5"` in `test/bridge-decoders-wormhole.test.ts`. |
| T-39-FROZEN | Tampering | CRITICAL | mitigate | Layer 0.6 is a NEW separate `if (record.tx.data !== "0x")` block inserted BETWEEN the Layer 0.5 closing brace and the Layer 2 chain-mismatch block. The Layer 0.5 body byte-identity is verified by the FROZEN test in `test/preview-send.solana.test.ts`. `git diff origin/main -- src/tools/send_transaction.ts src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/protocols/bridge-decoders/lifi-btc.ts` returns empty across all Phase 39 commits. |

### Companion-skill coordinated follow-up (vaultpilot-preflight, Inv #6b)

The sister `vaultpilot-preflight` repo receives a coordinated version bump adding Inv #6b skill-side encoding: "before signing a bridge tx, verify the decoded recipient matches the user's stated recipient." This mirrors the v2.5 Phase 38 sister-repo coordination pattern (skill v1.4 + Inv #12.5). The MCP-side Layer 0.6 gate is the server-side control — it fires at preview time regardless of the agent's skill usage and produces a structured refusal. The skill-side encoding is defense in depth: it instructs the agent to perform the verification step explicitly before relaying `userDecision: "send"`.

This is a CROSS-REPO follow-up tracked here. No edit to the sister `vaultpilot-preflight` repo lands inside this repository in Phase 39. The MCP-side control is complete and active as of Phase 39 Plan 39-03.

## Sandwich-MEV per-L2 thresholds (v2.6 — Phase 40, MEV-01)

### Threat-model nuance: sandwich-MEV exposure is per-chain, not per-tool

The Phase 32 (v2.4) Uniswap V3 sandwich-MEV gate used a single global 2% price-impact refusal bar across all chains. This global threshold was simultaneously too loose for high-MEV chains and too tight for low-MEV chains. Phase 40 replaces it with a per-chain refusal bar calibrated to each chain's actual mempool exposure.

**Why chains differ:**

- **Ethereum mainnet:** Public mempool, highest sandwich-MEV exposure. Every pending transaction is visible to MEV searchers before block inclusion. Baseline: >2% price impact refuses.
- **Polygon PoS:** Public Bor mempool with active MEV-searcher infrastructure. Public tx visibility and Polygon-native MEV bots make sandwich risk comparable to Ethereum. Calibrated at >2% (same bar as Ethereum), with a higher default slippage (100bps vs 50bps) to reflect the more volatile public-mempool environment.
- **Arbitrum / Optimism / Base:** Centralized private-sequencer mempools. Transactions are not visible to external actors before ordering — sandwich-MEV is structurally near-impossible at the L2 level absent sequencer collusion. The refusal bar is relaxed to >3% to reduce false positives without materially increasing real sandwich risk.

**Calibration table (src/config/sandwich-mev-thresholds.ts):**

| Chain | defaultSlippageBps | priceImpactRefusalPct | Mempool type |
|-------|--------------------|-----------------------|--------------|
| ethereum (1) | 50 | 2.0% | Public, high MEV |
| polygon (137) | 100 | 2.0% | Public Bor, active MEV |
| arbitrum (42161) | 30 | 3.0% | Private centralized sequencer |
| optimism (10) | 30 | 3.0% | Private centralized sequencer |
| base (8453) | 30 | 3.0% | OP-stack private sequencer |

These values are a **calibration, not a security boundary.** Too-tight → false-refusal annoyance driving users to explicitly set `slippageBps`; too-loose → real sandwiches slip through. The private-sequencer claim is well-established engineering consensus (centralized sequencers do not expose a public pending-tx mempool; L2-level sandwich requires sequencer collusion, outside this threat model).

### Refusal contract consistency: SANDWICH_MEV_REFUSED

Phase 40 introduces the dedicated `SANDWICH_MEV_REFUSED` error code (appended to `src/signing/error-codes.ts` after `DECODED_RECIPIENT_DRIFT`). Two producers:

1. **`prepare_uniswap_swap` (EVM, per-chain bar):** fires when `priceImpactBps > priceImpactRefusalPct * 100` AND `slippageBps` was NOT explicitly supplied. Refusal envelope names the chain, the per-chain threshold values, and the actual `priceImpactBps` so the agent can surface a precise hint.
2. **`prepare_sunswap_swap` (TRON, fixed 200bps):** TRON is not in the EVM SOT — its threshold stays at 200bps. Only the error code migrated from `INVALID_INPUT` to `SANDWICH_MEV_REFUSED` for a consistent refusal contract across all chains.

**`SANDWICH_MEV_REFUSED` is also emitted when `MEV_THRESHOLD_<CHAIN>` is present but invalid** (non-integer, `≤0`, `>10000`, decimal). The gate cannot be silently disabled via an impossible threshold.

### Curve stays gate-free by design

`prepare_curve_swap` does NOT use the per-L2 sandwich-MEV SOT. Phase 34 established Curve's explicit-slippage-only model (`slippageBps` REQUIRED, range [1, 5000], 50% footgun cap). The per-L2 SOT (`sandwich-mev-thresholds.ts`) is scoped to Uniswap tools. This is an explicit design choice, not an oversight — Curve's CHECKS PERFORMED block documents the gate-free status and the per-L2 SOT scoping.

### MEV_THRESHOLD_<CHAIN> env override bounds

Operators can relax or tighten the per-chain default slippage bps via `MEV_THRESHOLD_<CHAIN>=<bps>` (e.g. `MEV_THRESHOLD_POLYGON=150`). The override:
- Applies to `defaultSlippageBps` ONLY — `priceImpactRefusalPct` stays from the calibration table.
- Validates as a base-10 integer in [1, 10000] (strict parse: no decimals, no leading zeros, no negatives, no empty string).
- Invalid value → `InvalidMevThresholdError` → `SANDWICH_MEV_REFUSED` envelope naming chain + raw value. The gate cannot be set to 0 or an impossible threshold to bypass refusal.
- Read at call time (never at module load) so test environments can mutate `process.env` freely.

### Phase 40 threat register summary

| Threat ID | STRIDE | Severity | Disposition | Mitigation |
|-----------|--------|----------|-------------|------------|
| T-40-MEV-GLOBAL-TOO-LOOSE | Tampering (economic) | HIGH | mitigate | Per-chain refusal bar from `getSandwichThresholds(chainId)` — Polygon/Ethereum stay strict (>2%) where mempool exposure is high; private-sequencer L2s relax to >3%. Replaces the single fixed 2% bar that was simultaneously too loose for Polygon and too tight for Arbitrum/OP/Base. Anchored in `test/sandwich-mev-thresholds.test.ts` (per-chain values) + `test/prepare-uniswap-swap.test.ts` (T6 `SANDWICH_MEV_REFUSED` at the ethereum bar). |
| T-40-MEV-FALSE-REFUSAL | Usability→Security | MEDIUM | mitigate | A too-tight bar on private-sequencer L2s drives users to set `MEV_THRESHOLD_*` or pass blanket `slippageBps`, eroding the gate's value. The lenient L2 refusal bar (>3%) reduces false positives where sandwich is structurally near-impossible, without exposing real risk on those chains. Calibration documented as a tuning knob, not a security boundary. |
| T-40-MEV-ENV-OVERRIDE-DISABLE | Tampering | HIGH | mitigate | `getSandwichThresholds` validates the override as a base-10 integer in [1, 10000]; non-integer / `≤0` / `>10000` / decimal values are refused (`InvalidMevThresholdError` → `SANDWICH_MEV_REFUSED` envelope). Cannot set 0 or a `>10000`-bps value to silently disable the gate; the refusal still fires above the (relaxed) bar. Anchored in `test/sandwich-mev-thresholds.test.ts` invalid-value cases + `test/prepare-uniswap-swap.test.ts` invalid-env test case. |
| T-40-FROZEN-DRIFT | Tampering | CRITICAL | mitigate | Phase 40 touches only swap tools + config + error code + docs. `payload-fingerprint.ts` / `presign-hash(-tron).ts` / `send_transaction.ts` three gates / `handle-store.ts` state machine stay byte-identical to `origin/main` — asserted by `git diff origin/main` zero-diff verify in Task 2. `ErrorCode` union edit is append-only (additive type member). |
| T-40-SC | Tampering | LOW | mitigate | NO new npm packages in Phase 40 (all imports are in-tree: viem, existing config/signing modules). Package Legitimacy Gate is N/A. |

This section supersedes the Phase 32 "per-L2 calibration deferred to v2.6 Phase 40 MEV-01" forward-pointer in the Phase 32 section (§ "Quoter-midpoint price-impact understatement" + § "Sandwich-MEV refusal at PREPARE time"). The Phase 32 prose is preserved byte-for-byte above (append-only discipline).

### v2.6 milestone close-out summary

The v2.6 milestone (Phase 39 + Phase 40) is code-complete:

- **Phase 39 (Bridge Tier-1 final-recipient assertion, Inv #6b EVM path):** Layer 0.6 assertion in `preview_send` decoding the recipient from Tier-1 bridge calldata (Wormhole, Mayan Swift, NEAR OmniBridge, Across V3) and asserting equality against the user-supplied `toAddress`. Mismatch → `[REFUSED — DECODED RECIPIENT DRIFT]` / `DECODED_RECIPIENT_DRIFT`. Encoding-aware (EIP-55 for EVM, exact-case base58 for Solana, trim-only for NEAR account-id). Code-complete as of Phase 39 Plan 39-03.

- **Phase 40 (Per-L2 sandwich-MEV thresholds, MEV-01):** Per-chain threshold SOT + resolver + env override; `SANDWICH_MEV_REFUSED` error code spanning Uniswap (EVM, per-chain bar) + SunSwap (TRON, fixed 200bps); Curve stays gate-free; SECURITY.md per-L2 section. Code-complete as of Phase 40 Plan 40-01 (this plan).

**Tier-2 bridge facet decoders** (deBridge/DLN, Stargate `composeMsg`, Hop, Symbiosis) are explicitly deferred and documented in `REQUIREMENTS.md` as out-of-scope for v2.6. Adding a Tier-2 decoder requires only extending `TIER1_DECODERS` in `src/protocols/bridge-decoders/index.ts`.

**FROZEN trust-pipeline files stayed byte-identical to `origin/main` across the full v2.6 milestone** (Phase 39 + Phase 40). `src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/signing/payload-fingerprint-tron.ts`, `src/tools/send_transaction.ts`, `src/signing/handle-store.ts` — asserted by `git diff origin/main` zero-diff checks in both phases.

**v2.6 verify-phase residual (deferred to real-device smoke):** Real-Ledger smoke testing against each Tier-1 facet decoder (Wormhole + Mayan + NEAR OmniBridge + Across V3 — small-amount bridge attempt with final-recipient assertion trigger on a redirected address) + a per-L2 swap against each configured chain (Ethereum, Polygon, Arbitrum, Optimism, Base) to exercise the live per-chain sandwich-MEV threshold in `prepare_uniswap_swap` with real `priceImpactBps` from the Quoter V2. Manual verification steps are documented in `.planning/phases/40-mev-sandwich-slippage-hint-per-l2/40-VALIDATION.md` (Manual-Only Verifications section).

---

## v2.7 Bittensor milestone close-out summary

Closes out the v2.7 Bittensor milestone. Phases 46 + 47 + 48 + 49 shipped under per-plan admin-merge cadence; the real-Ledger Polkadot-Generic-app verify-phase smoke is the one remaining open milestone-completion gate.

### Milestone PRs

- Phase 46 (Bittensor scaffolding) — PRs left as placeholders — lazy-singleton `ApiPromise` registry (`_bittensorRegistry.getApi`, WS-on-construct deferred to first read), `@zondax/ledger-substrate@2.3.4` `PolkadotGenericApp` USB-HID transport (5-level BIP-44 path `44'/354'/0'/0'/0'`, `getAddressEd25519(path, 42)` device-pre-encoded SS58), branded `Ss58Address` blake2-256-checksum gate, `pair_bittensor_ledger` + `get_bittensor_status`, and the decoded-runtime-API read tools (balance / stake / subnets / validators).
- Phase 47 (Bittensor trust pipeline) — PRs left as placeholders — `payload-fingerprint-bittensor.ts` domain-tagged binding + `presign-hash-bittensor.ts` blake2-256 presign + `signWithMetadataEd25519ViaApp` detached-signature seam + `(pallet, call)`-only canonical-dispatch allowlist + native `transferKeepAlive` and slippage-guarded `add_stake_limit` / `remove_stake_limit` prepare tools through the `preview_send` / `send_transaction` three-gate region + Fixtures (hardcoded literals) + trust-pipeline integration test.
- Phase 48 (dTAO depth) — PRs left as placeholders — plain `add_stake` / `remove_stake` (no slippage guard), same-owner `move_stake` / `swap_stake` reallocation, `transfer_stake` CUSTODY CHANGE, validator-enrichment reads (`getDelegate` take/registrations + `identitiesV2` identity), all flowing through the 2 REUSED binding modules UNCHANGED.
- Phase 49 (diagnostics) — PR left as placeholder — `get_bittensor_setup_status` lazy 3-arm `Promise.allSettled` demote-to-null diagnostic + this close-out section.

### Trust-shape recap

The v2.7 Bittensor trust pipeline mirrors the Solana / TRON shape with Substrate-specific cryptographic primitives:

- **ed25519 Ledger coldkey.** Subtensor accepts `MultiSignature::Ed25519`, and the Ledger secure element cannot produce sr25519 signatures — so the Ledger account IS the coldkey directly. There is NO sr25519-migration tooling and none is needed: ed25519 is a first-class subtensor signature scheme. The on-device SS58 (prefix 42) is the trusted display.
- **Domain-tagged `payloadFingerprint`**: `blake2/keccak over "VaultPilot-taotx-v1:" ‖ signable_bytes` — the domain tag binds ONLY the unsigned `SignerPayload` SCALE bytes (sender-independent: the `from` account is NOT in the preimage, so the fingerprint is identical across personas signing the same call). Different tag from EVM / Solana / TRON / BTC by construction.
- **`presignHash = blake2-256(signable_blob)`** — the ONE divergence from the SHA-256 Solana / TRON siblings. blake2-256 is what the Polkadot Generic app blind-signs on-device (Substrate's extrinsic-signing pre-hash for payloads over 256 bytes); matching it byte-for-byte lets the `LEDGER BLIND-SIGN HASH (Bittensor)` block surface the exact hash the device shows.
- **`(pallet, call)`-only canonical-dispatch allowlist** — every Bittensor write is gated to an explicit `(pallet, call)` tuple (e.g. `Balances.transferKeepAlive`, `SubtensorModule.add_stake_limit`); an unrecognized dispatch is refused before handle minting.

### CheckMetadataHash chain-enforced integrity

Subtensor enforces the `CheckMetadataHash` signed extension: the extrinsic commits to a metadata hash, and a tampered or truncated metadata blob produces a hash mismatch that **the chain rejects** — the extrinsic never executes. This makes the metadata-shortener service **untrusted-by-construction**: it is an availability-only dependency (a wrong shortened-metadata input fails the on-chain `CheckMetadataHash` check and the transaction reverts), NOT a trust dependency. A compromised shortener cannot move funds — it can at worst deny service by producing metadata the chain refuses.

### Accepted residual risks

- **Ship-with-blind-sign residual (accepted).** Staking extrinsics MAY blind-sign on the Polkadot Generic app — the device shows the blake2-256 hash rather than fully-clear-signed fields for calls without ERC-7730-equivalent metadata. This is documented and consistent with how the Solana and TRON pipelines ship blind-sign; the `LEDGER BLIND-SIGN HASH (Bittensor)` block in `preview_send` surfaces the exact on-device hash for character-for-character comparison. Residual: the user verifies the hash, not human-readable call args, for blind-signed shapes.
- **Metadata-shortener availability-only dependency (accepted).** Per the `CheckMetadataHash` analysis above — the shortener is untrusted-by-construction; a failure is a denial-of-service, not a fund-movement risk. No trust is placed in the shortener output.
- **v2.7 verify-phase pending real-Ledger smoke (accepted, open milestone gate).** The Bittensor signing path has not been exercised against a physical Ledger running the Polkadot Generic app. The verify-phase smoke is a real-Ledger Polkadot-Generic-app small-amount mainnet stake (native `transferKeepAlive` + `add_stake_limit` / `remove_stake_limit` + plain `add_stake` / `remove_stake` + `move_stake` / `swap_stake` + `transfer_stake`), each verifying the on-device blake2-256 hash matches the `LEDGER BLIND-SIGN HASH (Bittensor)` block from `preview_send`. NOT auto-resolved by Phase 49.

### Phase 49 (diagnostics) threat register summary

| Threat ID | STRIDE | Severity | Mitigation |
|-----------|--------|----------|------------|
| T-PAIRING-DRIFT (T-49-01) | Tampering | MEDIUM | `walletAddressOnDevice` surfaced verbatim for the agent to compare against the stored address; `addressVerified` is OMITTED per spec — this is a diagnostic, not a guard. No automatic refusal. The device demote-to-null on an unreachable device is the safe default. |
| T-RPC-FAILURE-MASKED-AS-EMPTY (T-49-02) | Information Disclosure | LOW | `rpcDegraded.reason` set explicitly on ARM-A (`getStakeInfo`) reject/timeout; `stakePositionsPresent:false` only on a verifiably-empty result (`rows.length === 0`) OR an explicitly-degraded RPC — never a silent zero. Test 2 (rpc arm) covers it. |
| T-LEDGER-APP-VERSION-LIES (T-49-03) | Spoofing | LOW | `ledgerPolkadotAppVersion` is INFORMATIONAL only — no version-gating in v2.7. A spoofed version cannot weaponize a read-only diagnostic by construction; a version-probe throw demotes the field to null rather than asserting a value (Test 4, app-version arm). |
| T-49-FROZEN (T-49-04) | Tampering | CRITICAL | `git diff origin/main` zero-diff on the FROZEN cryptographic-binding chain (payloadFingerprint + blake2-256 presign + `send_transaction` three-gate region + handle-store) + the `FROZEN_FILES` describe-block in `test/signing-fingerprint-bittensor.test.ts`. Phase 49 is READ-ONLY + additive by construction. |

### FROZEN assertion

The cryptographic-binding chain — `payload-fingerprint*.ts`, the blake2-256 `presign-hash*.ts`, the `send_transaction.ts` three-gate region (previewToken + userDecision + payloadFingerprint-drift), and `handle-store.ts` — stayed **byte-identical to `origin/main` across the full v2.7 Bittensor milestone (Phases 46–49)**. The phase adds one read-only diagnostic tool plus one additive `fetchBittensorSetup` transport helper plus docs; it touches NONE of the binding chain. Asserted by the `git diff --stat origin/main` zero-diff gate at Phase 49 close + the in-suite `FROZEN cryptographic-binding chain` describe-block.

## v2.0 Solana close-out (Phase 16 — LiFi bridging + SOL-DIAG-01)

Phase 16 completes the v2.0 Solana milestone: a per-wallet Solana diagnostic (`get_solana_setup_status`, SOL-DIAG-01) and LiFi cross-chain bridging (`prepare_solana_lifi_swap`, SOL-W-21). Three security properties are load-bearing.

### Solana-side bridge facet-decode rationale (Inv #6b — final recipient from the SIGNED bytes)

A compromised agent can relay a clean-looking `toAddress` while the bridge transaction the device actually signs encodes a different recipient inside calldata the Ledger cannot fully decode. VaultPilot decodes the final recipient **from the bytes the device signs**, never from the agent- or LiFi-relayed `quote.action.toAddress`:

- **Outbound (Solana→EVM):** LiFi returns an EVM calldata transaction bound through the existing EVM signing path. The user-supplied `toAddress` is stored in `PreparedTxEvm.bridgeParams.toAddress` at prepare time; `preview_send` Layer 0.6 decodes `finalRecipient` from `record.tx.data` (the signed EVM bridge calldata) via the centralized Tier-1 decoder registry and refuses with `DECODED_RECIPIENT_DRIFT` on mismatch. This **reuses** the v2.6 Phase 39 BRIDGE-T1 EVM facet-decode mechanism (`decodeBridgeTier1FacetRecipient`) with no per-tool assertion — the outbound bridge tool inherits the assertion by routing through `preview_send`.

### Inv #6b extension scope to Solana

The Inv #6b principle (decode the recipient from the signed bytes, compare against the user-supplied destination, refuse on drift) is the same as the v2.6 EVM facet decoders. On the **inbound (EVM→Solana)** direction the recipient would be extracted from the legacy Solana message bytes (`serializeMessage()`) via a Solana instruction-account decoder — but see the residual below: inbound is conservatively refused in this build, so no Solana-side recipient decoder ships.

### v0-inbound residual risk (fail-safe default — conservative refusal)

**In scope vs out of scope.** The FROZEN Solana cryptographic-binding (`computeSolanaPayloadFingerprint`) accepts **only legacy `serializeMessage()` bytes**. At execute-time an authoritative live `GET https://li.quest/v1/quote?…&toChain=SOL` capture **succeeded** (HTTP 200) and returned a base64 Solana transaction whose message header byte-0 was `0xd3` (high-bit set → **v0 / VersionedTransaction**). LiFi returns v0 transactions for the EVM→Solana route and exposes no documented legacy-forcing parameter.

**Control (fail-safe default).** The inbound path runs a v0-guard (`deserializeLifiSolanaTx`, mirroring the Jupiter byte-0 `0x80` guard) **before** any legacy parse. A v0 transaction throws a typed `LifiV0TransactionError` and the tool refuses — a v0 transaction is **never** silently accepted, **never** run through the FROZEN binding, and the binding is **never** unfrozen to accommodate it. No Solana-side recipient decoder is shipped and the LiFi Solana canonical-dispatch arm stays **inactive** (the SOT `lifiSolanaProgram` field holds a sentinel, gated by `isLifiSolanaProgramVerified()`), because shipping a recipient decoder that can never run against a real LiFi inbound transaction would be defense-in-name-only.

**Residual risk.** EVM→Solana inbound bridging via LiFi is **intentionally un-shippable** under the FROZEN legacy-only binding until either (a) LiFi exposes a legacy transaction path, or (b) a future milestone unfreezes the Solana binding and re-anchors the fingerprint preimage against v0 message bytes (a deliberate, separately-reviewed change to the trust anchor — out of scope for v2.0). Outbound (Solana→EVM) is **unaffected** and fully shipped.

**Standing relayer / value-in-flight residual.** As with every bridge (BTC LiFi, EVM Tier-1), once funds leave the source chain the LiFi relayer and the destination bridge contract are trusted to deliver to the decoded recipient. VaultPilot's guarantee is bounded to the source-chain signed bytes (the recipient the device commits to); cross-chain delivery integrity is out of scope to eliminate and is an accepted residual.

### FROZEN assertion (v2.0 Solana)

The six FROZEN cryptographic-binding files — `payload-fingerprint.ts`, `payload-fingerprint-solana.ts`, `presign-hash.ts`, `presign-hash-solana.ts`, `send_transaction.ts`, `handle-store.ts` — stay **byte-identical to `origin/main`** across Phase 16. The phase ADDS sibling files (`get_solana_setup_status.ts`, `prepare_solana_lifi_swap.ts`, `lifi-solana.ts`, the `fetchLifiQuote` sibling) and never edits the FROZEN binding; new transaction shapes flow through `computeSolanaPayloadFingerprint` via legacy `serializeMessage()` unchanged. Asserted by the `git diff origin/main` zero-diff gate at Phase 16 close.
