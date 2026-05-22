# Requirements: VaultPilot MCP (GSD-inspired)

**Defined:** 2026-05-12
**Core Value:** The user trusts what the Ledger screen shows — nothing else. Tampering at any layer between the agent and the device produces a visible mismatch on-screen before signing.

## v1.0 Requirements (MVP — Ethereum native sends)

The smallest end-to-end vertical slice. Proves the trust pipeline. No DeFi, no L2s, no other chains.

### Install & Setup

- [ ] **INST-01**: User can install via `claude mcp add vaultpilot-mcp -- npx -y vaultpilot-mcp` (Claude Code CLI)
- [ ] **INST-02**: User can install via `claude_desktop_config.json` paste (Claude Desktop, macOS / Linux / Windows)
- [ ] **INST-03**: User can install via `~/.cursor/mcp.json` paste (Cursor)
- [ ] **INST-04**: `npx -y vaultpilot-mcp --check` validates Node version, registers a one-shot doctor pass, and emits a structured `--json` envelope
- [ ] **INST-05**: First-run install with no `~/.vaultpilot-mcp/config.json` and no `VAULTPILOT_DEMO` env var boots into auto-demo (real RPC reads against curated personas; signing tools refuse)

### Read (Portfolio)

- [ ] **READ-01**: `get_portfolio_summary({ wallet })` returns `{ chain: "ethereum", nativeBalance, erc20Balances[], totalUsd }` against a free public RPC (PublicNode)
- [ ] **READ-02**: `get_token_balance({ wallet, tokenAddress })` returns balance + decimals + USD value (DefiLlama prices)
- [ ] **READ-03**: `get_transaction_status({ txHash })` polls inclusion status against the configured RPC
- [ ] **READ-04**: `resolve_ens_name({ name })` and `reverse_resolve_ens({ address })` work against ENS Universal Resolver
- [ ] **READ-05**: When the configured RPC is unavailable, the response carries a `rpcDegraded` flag with a one-line reason rather than failing silently
- [ ] **READ-06**: When the user has no `ETHEREUM_RPC_URL` set, a one-time stderr warning surfaces the public-RPC fallback (deduped per session)

### Pair (Ledger via WalletConnect)

- [ ] **PAIR-01**: `pair_ledger_live()` initiates a WalletConnect pairing, returns a `wcUri` for the user to paste into Ledger Live, and waits for session approval
- [ ] **PAIR-02**: After pairing, `get_ledger_status()` returns `{ paired: true, address, chainId, sessionTopicLast8 }`
- [ ] **PAIR-03**: Pairing-flow address is surfaced verbatim in the response, with a `VERIFY-ON-DEVICE` block that instructs the user to confirm the address shown in Ledger Live → Settings → Connected Apps matches the response
- [ ] **PAIR-04**: Pairing requires `WALLETCONNECT_PROJECT_ID` env var; missing → clear-error refusal with the WC dashboard URL
- [ ] **PAIR-05**: Repeated `pair_ledger_live()` calls reuse an existing session unless `force: true` is set

### Prepare → Preview → Send (Native ETH)

- [ ] **PREP-01**: `prepare_native_send({ to, valueWei })` returns `{ handle, chainId, to, valueWei, nonce, gas, maxFeePerGas, maxPriorityFeePerGas, payloadFingerprint, prepareReceipt }` — all bytes the agent will later relay
- [ ] **PREP-02**: `prepareReceipt` is the verbatim args the agent passed to `prepare_native_send`, surfaced as a `PREPARE RECEIPT` block in the tool response (defense-in-depth against narrow agent-arg compromise)
- [ ] **PREP-03**: `payloadFingerprint = keccak256("VaultPilot-txverify-v1:" ‖ chainId(32-byte BE) ‖ to(20 bytes) ‖ value(32-byte BE) ‖ data)` — domain-tagged, prepare-time stable
- [ ] **PREP-04**: `preview_send({ handle })` pins the gas + nonce + maxFeePerGas, mints a `previewToken` UUID, recomputes the EIP-1559 pre-sign hash, and emits a `LEDGER BLIND-SIGN HASH` block carrying the keccak256 the device will display
- [ ] **PREP-05**: `preview_send` response carries an `[AGENT TASK — RUN THESE CHECKS NOW]` block instructing the agent to re-decode the bytes locally, recompute the hash via `viem.serializeTransaction`, and report results in a `CHECKS PERFORMED` block before asking the user to confirm
- [ ] **PREP-06**: `preview_send` includes an independent 4byte.directory cross-check on the function selector (best-effort; `error` / `not-applicable` states surface verbatim, not masked)
- [ ] **PREP-07**: `send_transaction({ handle, previewToken, userDecision: "send" })` rejects with a structured error if `previewToken` is missing/wrong or `userDecision !== "send"`
- [ ] **PREP-08**: `send_transaction` re-checks `payloadFingerprint` against the value emitted at prepare time; mismatch → refusal with `prepare↔send drift detected`
- [ ] **PREP-09**: `send_transaction` forwards the unsigned tx over the WC session to Ledger Live → device for blind-sign, returns `{ txHash, broadcastedAt }` on success
- [ ] **PREP-10**: `get_tx_verification({ handle })` re-emits the VERIFY-BEFORE-SIGNING + tx JSON for a handle (15-min TTL) so a context-evicted agent can recover

### Demo Mode

- [ ] **DEMO-01**: `VAULTPILOT_DEMO=true` env var (literal `"true"` only) forces demo mode regardless of config
- [ ] **DEMO-02**: `VAULTPILOT_DEMO=false` is a deterministic opt-out for scripted contexts
- [ ] **DEMO-03**: `get_demo_wallet()` lists curated personas (`whale`, `defi-degen`, `stable-saver`, `staking-maxi`) with their addresses + which read flows are rehearsable
- [ ] **DEMO-04**: `set_demo_wallet({ persona })` activates a persona; state is process-local
- [ ] **DEMO-05**: In demo mode, `send_transaction` runs the unsigned tx through `eth_call` for revert detection, returns a structured "simulation envelope" — nothing signed, nothing broadcast
- [ ] **DEMO-06**: In demo mode, `pair_ledger_live` refuses outright with a structured error pointing at `set_demo_wallet`
- [ ] **DEMO-07**: A brand-new install (no config file + no `VAULTPILOT_DEMO` env) auto-enters demo on first boot; first tool response carries a one-shot `VAULTPILOT NOTICE — Auto demo mode active` block

### Diagnostics

- [ ] **DIAG-01**: `get_vaultpilot_config_status()` returns booleans/counts (RPC sources, key presence, paired-account counts, WC topic suffix) — no secret values
- [ ] **DIAG-02**: `get_ledger_device_info()` probes the connected Ledger via WC and reports which app is open + actionable hint
- [ ] **DIAG-03**: Server-level `instructions` field in MCP `initialize` response carries a one-paragraph self-description (what tools do, security model, link to SECURITY.md)
- [ ] **DIAG-04**: Stderr emits a one-time-per-session update check against `registry.npmjs.org`; suppressed by `VAULTPILOT_DISABLE_UPDATE_CHECK=1`

## v1.1 Requirements (Aave V3 + ERC-20 + approval lifecycle)

Adds the smallest DeFi surface — Aave V3 supply/withdraw — plus the full ERC-20 lifecycle (transfer, approve, revoke, WETH wrap/unwrap). Approve/revoke pull in the approval-class surfacing requirement that becomes load-bearing once Aave / Compound / Uniswap need allowances.

### ERC-20 Transfers + Approvals

- [ ] **PREP-20**: `prepare_token_send({ to, tokenAddress, amount })` returns the same shape as `prepare_native_send` plus the decoded `transfer(to, amount)` arg surface
- [ ] **PREP-21**: `preview_send` for a `transfer` call surfaces the decoded `to` + `amount` in the `CHECKS PERFORMED` block
- [ ] **PREP-22**: Decimal normalization: agent passes `amount` as a decimal string (e.g. `"100.5"`); server resolves via `get_token_metadata` decimals lookup; off-by-decimal errors caught at prepare time
- [ ] **PREP-26**: `prepare_token_approve({ tokenAddress, spender, amount })` produces an `approve(spender, amount)` call; `amount: "max"` accepted as `2^256 - 1`
- [ ] **PREP-27**: `prepare_revoke_approval({ tokenAddress, spender })` is a `prepare_token_approve` shortcut producing `approve(spender, 0)` — distinct tool name so the agent can refer to it by intent
- [ ] **PREP-28**: `prepare_weth_unwrap({ amount })` produces a `WETH9.withdraw(amount)` call against the canonical WETH address per chain (sourced from `src/config/contracts.ts`)
- [ ] **PREP-29**: For `approve` and `WETH9.withdraw`, `preview_send` decodes the call and surfaces decoded args in `CHECKS PERFORMED`; for `approve` specifically, `amount == 2^256 - 1` is labeled `⚠ UNLIMITED APPROVAL` with a one-line revoke-path hint
- [ ] **PREP-30**: Spender labels for `approve` come from a small known-spender table in `src/config/contracts.ts` (Aave Pool, Uniswap router, etc.); unknown spender → label `(unknown spender — no prior interaction recorded)` rather than silently omitting

### Aave V3 (Ethereum)

- [ ] **READ-20**: `get_lending_positions({ wallet })` returns Aave V3 positions on Ethereum (supplied + borrowed + health factor)
- [ ] **PREP-23**: `prepare_aave_supply({ asset, amount })` and `prepare_aave_withdraw({ asset, amount })` produce unsigned Pool-contract calls
- [ ] **PREP-24**: Aave Pool address per chain comes from a `src/config/contracts.ts` single-source-of-truth table; no hallucinated proxy addresses
- [ ] **PREP-25**: `simulate_position_change({ asset, deltaAmount })` previews health-factor impact before signing

### Risk Tooling

- [ ] **READ-21**: `check_contract_security({ address })` returns verification status, age, upgradeability, privileged-role enumeration

## v1.2 Requirements (Multi-EVM-chain + token resolution)

Fan out from Ethereum-only to all top-5 EVM chains. Adds token-resolution and allowance-enumeration tools that become useful once the agent has to handle bridged variants and multi-spender approval state.

### Multi-chain fan-out

- [ ] **READ-40**: All v1.0 + v1.1 read tools accept `chain: "ethereum" | "arbitrum" | "polygon" | "base" | "optimism"` parameter
- [ ] **PREP-40**: All `prepare_*` tools accept `chain` parameter; chain-id assertion checked at preview + send time
- [ ] **PREP-41**: `chain` parameter is mandatory on every `prepare_*` (no default-pick); refusal carries the canonical chain-name list
- [ ] **READ-41**: `get_portfolio_summary` aggregates across all 5 EVM chains when called with no `chain` param
- [ ] **INST-40**: `RPC_PROVIDER=infura|alchemy + RPC_API_KEY` config wires custom RPC for all 5 chains in one shot

### Token + allowance tooling

- [ ] **READ-42**: `resolve_token({ symbol, chain? })` returns the canonical contract address for a symbol on a chain; bridged variants disambiguated via origin-chain hint (e.g. USDC vs USDC.e on Polygon)
- [ ] **READ-43**: `get_token_allowances({ wallet, chain })` enumerates outstanding ERC-20 allowances across known-spender contracts; per-row fields: `token`, `spender`, `spenderLabel`, `amount`, `isUnlimited`, `lastSeenBlock`
- [ ] **READ-44**: `get_token_allowances` response carries a `[SET-LEVEL ENUMERATION]` block in plain text (verbatim row dump) so the agent has a visible source-of-truth artifact to surface to the user; absence of this block on a real allowances response is a tamper signal

## v1.3 Requirements (Hardening + companion skill)

Closes the residual-risk gaps documented in SECURITY.md. Three distinct verification tools land here: `get_verification_artifact` (second-LLM), `verify_tx_decode` (server-side decode cross-check), `get_tx_verification` (15-min handle re-emit).

- [ ] **SEC-30**: Companion `vaultpilot-preflight` Claude Code skill ships as a separate repo with `SKILL.md` carrying integrity sentinel
- [ ] **SEC-31**: Server pins skill SHA-256 in `instructions`; on every signing flow the agent is instructed to `sha256sum` the skill and confirm match
- [ ] **SEC-32**: Skill encodes invariants #1 (decode), #2 (hash recompute), #2.5 (chain-must-be-explicit), #5 (final on-device match), #11 (approval-class surfacing)
- [ ] **SEC-33**: Skill v0.x.0+ Step 0 — mandatory pre-Invariant integrity self-check; halts with `DO NOT SIGN.` on hash divergence
- [ ] **SEC-34**: `get_verification_artifact({ handle })` returns sparse JSON for second-LLM cross-verification, with `pasteableBlock` between explicit copy markers; canned prompt instructs the second LLM to decode bytes from scratch with no shared context
- [ ] **SEC-35**: Outer dispatch-target allowlist (Inv #1.a) enforced server-side for Aave / WETH / 1inch / LiFi / Compound (when added)
- [ ] **SEC-36**: WalletConnect session-topic cross-check surfaced in `get_ledger_status` + every signing flow
- [ ] **SEC-37**: `verify_tx_decode({ handle, claimedDecode })` server-side cross-check of the agent's claimed bytes-to-intent decode; returns `{ ok: true }` on match or `{ ok: false, divergences: [...] }` with field-by-field diff. Distinct from `get_verification_artifact` — that's a second-LLM out-of-band check; this is an inline server-side check that catches narrow agent decode lies before the user is asked to confirm
- [ ] **SEC-38**: `get_tx_verification({ handle })` re-emits the VERIFY-BEFORE-SIGNING + tx JSON for 15 minutes after the original prepare; allows a context-evicted agent to recover the canonical view without re-running prepare (which would change `nonce` + `payloadFingerprint`)

## v1.4 Requirements (Distribution + ergonomics)

- [ ] **DIST-40**: Bundled binary distribution per platform (linux-x64, linux-arm64 [via npm-fallback message], macos-x64, macos-arm64, windows-x64)
- [ ] **DIST-41**: `install.sh` (bash) + `install.ps1` (PowerShell) installers download from GitHub releases, register with detected MCP clients, emit `InstallEnvelope`
- [ ] **DIST-42**: `vaultpilot-mcp setup` interactive wizard validates RPC keys, optionally pairs Ledger, writes `~/.vaultpilot-mcp/config.json`
- [ ] **DIST-43**: `request_capability({ title, body })` produces a pre-filled GitHub issue URL (rate-limited 3/hour); no auto-submit by default

## v2 Requirements

Deferred to v2.x — each is a milestone of its own.

### v2.0 Solana

Adds Solana support via USB-HID Ledger transport (no WalletConnect — Solana has no WC v2 bridge to Ledger). Reuses the v1.x prepare → preview → send trust pipeline with Solana-specific primitives: serialized-transaction-message `payloadFingerprint`, mandatory `simulateTransaction` gate at preview, per-wallet durable-nonce setup, and a new persistent non-EVM account cache (PAIR-NEV-* below) that mirrors v1.x WC-session persistence (PR #61).

#### Persistent Non-EVM Account Cache (PAIR-NEV-*)

Introduced in v2.0 Phase 11 and reused by v2.1 TRON + v2.2 BTC/LTC. Mirrors the v1.x WC-session-persistence pattern from PR #61 (`src/wallet/session-manager.ts` reads + restores persisted WC sessions on `startServer`). Distinct from PAIR-* (WalletConnect / Ethereum) because non-EVM chains use USB-HID transport and have no WC session concept — the cache holds chain-keyed account records (address + derivation path + paired timestamp), not WC topics.

- [ ] **PAIR-NEV-01**: Paired non-EVM accounts persist to `~/.vaultpilot-mcp/non-evm-accounts.json` (0o700 dir, 0o600 file) under a per-chain record schema (`chain`, `address`, `derivationPath`, `pairedAt`, optional `displayName`)
- [ ] **PAIR-NEV-02**: On MCP restart, `startServer()` eager-loads the persisted accounts via `loadNonEvmAccounts()` BEFORE `server.connect(transport)` (race-defense — mirrors PR #61's WC eager-init pattern); first `get_<chain>_status()` call after cold boot returns `paired: true` without requiring a re-pair
- [ ] **PAIR-NEV-03**: Per-chain account records keyed by `chain: "solana" | "tron" | "bitcoin" | "litecoin"`; multiple addresses per chain supported (one record per derivation-path slot); atomic-write via tempfile + rename to prevent partial-write corruption
- [ ] **PAIR-NEV-04**: Stale-session detection on restore — accounts whose `pairedAt` timestamp is older than 30 days surface in the relevant `get_<chain>_status` response with `staleAccountWarning: true` and a user-action hint to re-pair; never silently expired
- [ ] **PAIR-NEV-05**: `list_paired_non_evm_accounts()` returns the in-memory record set (chains + addresses + paired-at timestamps, never raw key material); `remove_paired_non_evm_account({ chain, address })` removes a single entry and rewrites the file atomically
- [ ] **PAIR-NEV-06**: `VAULTPILOT_NON_EVM_STORAGE=memory` opt-out disables disk persistence (mirrors `VAULTPILOT_WC_STORAGE=memory` from quick task 260513-c8e — same shape, same default-on semantics)
- [ ] **PAIR-NEV-07**: `get_vaultpilot_config_status` surfaces `pairedNonEvmChains: string[]` (chain names only — never raw addresses) + `nonEvmStoragePersistent: boolean` + `pairedNonEvmAccountCount: number`; secret-safety scan applies per v1.x DIAG-01 convention

#### Read + Pair (SOL-01..05)

- [ ] **SOL-01**: `pair_solana_ledger()` opens the Ledger Solana app over USB-HID via `@ledgerhq/hw-transport-node-hid` + `@ledgerhq/hw-app-solana`, returns the base58 address verbatim plus a `VERIFY-ON-DEVICE` block instructing the user to confirm the address on the Ledger screen
- [ ] **SOL-02**: `get_solana_status()` returns `{ paired: true, address, derivationPath, rpcEndpoint, ledgerSolAppVersion? }` after a successful pair; integrates with PAIR-NEV-* for restored sessions
- [ ] **SOL-03**: `get_solana_balance({ wallet })` returns native SOL balance (lamports + SOL-formatted) against a free public RPC (default `https://api.mainnet-beta.solana.com`; override via `SOLANA_RPC_URL`)
- [ ] **SOL-04**: `get_solana_token_balance({ wallet, mint })` returns SPL token balance + decimals + USD value (DefiLlama prices, `solana:<mint>` keying); `get_solana_token_metadata({ mint })` mirrors v1.x `get_token_metadata` shape
- [ ] **SOL-05**: `get_solana_portfolio_summary({ wallet })` aggregates SOL + SPL balances + USD totals; SPL discovery via a curated top-50-by-volume Solana-mainnet mint registry at `src/tokens/solana-top-50.json`; multi-chain `get_portfolio_summary` extends to fan out across EVM + Solana when both configured (per-row `chain: "solana"` field)

#### Prepare → Preview → Send (Solana primitives — SOL-PREP-01..05)

- [ ] **SOL-PREP-01**: Solana `payloadFingerprint = keccak256("VaultPilot-soltx-v1:" ‖ <serialized message bytes pre-signature>)` — domain-tagged, prepare-time stable, distinct domain tag from EVM `"VaultPilot-txverify-v1:"` so cross-chain fingerprint reuse is impossible by construction
- [ ] **SOL-PREP-02**: `preview_send` Solana branch runs mandatory `simulateTransaction` RPC gate — refuses with structured error on program-error or insufficient-lamports; on success surfaces decoded args + Ledger SOL-app blind-sign hash recompute in `LEDGER BLIND-SIGN HASH` block
- [ ] **SOL-PREP-03**: `send_transaction` Solana branch enforces `previewToken` + `userDecision: "send"` gates identically to the EVM path; rejects on `payloadFingerprint` drift between prepare and send (v1.x PREP-08 invariant extends unchanged)
- [ ] **SOL-PREP-04**: `prepare_solana_nonce_init` + `prepare_solana_nonce_close` produce per-wallet durable-nonce account setup/teardown transactions (NonceAuthorized account ownership); enables long-duration prepare → sign flows past the 150-slot recent-blockhash window
- [ ] **SOL-PREP-05**: Solana branch USB-HID transport surfaces in `get_solana_status` (`transport: "usb-hid"`) and `get_vaultpilot_config_status`; USB-HID device-not-found errors surface as structured refusal with troubleshooting hint, never as silent failures

#### Writes (SOL-W-01..21)

- [ ] **SOL-W-01**: `prepare_solana_native_send({ to, lamports })` produces an unsigned System Program `Transfer` instruction; decimal-string lamports per v1.x decimal-handling convention
- [ ] **SOL-W-02**: `prepare_solana_spl_send({ to, mint, amount })` produces an unsigned SPL Token Program `Transfer` instruction; decimal-string amount resolved via `get_solana_token_metadata` decimals lookup (mirrors v1.x `parseAmountStrict` pattern as `parseSolanaAmountStrict`)
- [ ] **SOL-W-03**: `get_marginfi_positions({ wallet })` returns MarginFi-bank-keyed supplied + borrowed + health-factor-equivalent per position
- [ ] **SOL-W-04**: `prepare_marginfi_supply` / `_withdraw` / `_borrow` / `_repay` produce unsigned MarginFi program instructions
- [ ] **SOL-W-05**: `prepare_marginfi_account_init` sets up the per-wallet `MarginfiAccount` PDA when not already present
- [ ] **SOL-W-06**: `get_kamino_positions({ wallet })` returns Kamino-vault-keyed supplied + borrowed + per-vault health
- [ ] **SOL-W-07**: `prepare_kamino_supply` / `_withdraw` / `_borrow` / `_repay` produce unsigned Kamino program instructions
- [ ] **SOL-W-08**: `prepare_kamino_obligation_init` sets up the per-wallet `Obligation` PDA when not already present
- [ ] **SOL-W-09**: MarginFi + Kamino program IDs added to `src/security/canonical-dispatch.ts` Solana arm (Layer 0.5 — mirrors v1.3 SEC-35 EVM dispatch-target enforcement); mismatch refuses at preview time
- [ ] **SOL-W-10**: MarginFi + Kamino program addresses sourced from `src/config/contracts.ts` Solana sub-table (new `Record<"solana", SolanaContracts>` mirroring the v1.2 EVM `Record<ChainId, ContractsForChain>` shape); regression-tested
- [ ] **SOL-W-11**: `get_jupiter_quote({ inputMint, outputMint, amount, slippageBps? })` returns the Jupiter v6 quote envelope (out amount, route plan, price impact, slippage)
- [ ] **SOL-W-12**: `prepare_jupiter_swap({ inputMint, outputMint, amount, slippageBps })` returns an unsigned serialized transaction the user signs via the standard Solana trust pipeline
- [ ] **SOL-W-13**: Sandwich-MEV defense — `prepare_jupiter_swap` default slippage hint = 50 bps; refuses without explicit `slippageBps` when price impact > 2%
- [ ] **SOL-W-14**: `prepare_marinade_stake({ lamports })` produces an unsigned Marinade Finance deposit instruction (mints mSOL)
- [ ] **SOL-W-15**: `prepare_marinade_immediate_unstake({ msolAmount })` produces an unsigned Marinade immediate-unstake instruction; immediate-unstake fee surfaced verbatim in `CHECKS PERFORMED`
- [ ] **SOL-W-16**: `prepare_jito_stake_pool_deposit({ lamports })` produces an unsigned Jito stake-pool deposit instruction; explicit `[NOTICE — Jito stake-pool unstake not yet supported]` block emitted at preview (deferred per upstream)
- [ ] **SOL-W-17**: `prepare_solana_delegate({ stakeAccount, voteAccount, lamports })` produces an unsigned native Stake Program delegate instruction; stake-account-creation sub-helper invoked when no stake account exists
- [ ] **SOL-W-18**: `prepare_solana_deactivate({ stakeAccount })` produces an unsigned native Stake Program deactivate instruction
- [ ] **SOL-W-19**: `prepare_solana_withdraw({ stakeAccount, to, lamports })` produces an unsigned native Stake Program withdraw instruction
- [ ] **SOL-W-20**: Marinade + Jito program IDs + native Stake Program added to canonical-dispatch allowlist Solana arm
- [ ] **SOL-W-21**: `prepare_solana_lifi_swap({ fromChain, fromToken, toChain, toToken, amount, toAddress })` produces an unsigned LiFi-routed bridge transaction; works both directions (EVM → Solana AND Solana → EVM); server-side `decodedFinalRecipient == userSuppliedToAddress` assertion at preview time (Inv #6b extension — mirrors v2.6 BRIDGE-T1 EVM facet decoders, applied to LiFi's Solana-side decoder)

#### Diagnostics (SOL-DIAG-01)

- [ ] **SOL-DIAG-01**: `get_solana_setup_status({ wallet })` returns `{ nonceAccountPresent, marginfiAccountPresent, kaminoObligationPresent, ledgerSolAppVersion?, walletPublicKeyOnDevice }` — probes per-wallet PDA + on-device status (analogous to v1.0 DIAG-01 `get_vaultpilot_config_status` but Solana-scoped)

### v2.1 TRON

Adds TRON support via USB-HID Ledger transport (no WalletConnect — TRON has no WC v2 bridge to Ledger). Reuses the v2.0 prepare → preview → send trust pipeline with TRON-specific primitives: serialized Protobuf raw_data `payloadFingerprint` (domain-tagged `"VaultPilot-trontx-v1:"`), SHA-256 blind-sign hash recompute (TRON consensus hash, not keccak256), TRC-20 approve with `⚠ UNLIMITED APPROVAL` surfacing, Stake 2.0 (freeze/unfreeze/withdraw-expire-unfreeze/vote/claim), SunSwap V2 same-chain swap, and LiFi-routed TRON↔EVM bridging. Reuses v2.0 Phase 11's `non-evm-account-store.ts` cache infrastructure under `chain: "tron"` record key.

#### Read + Pair (TRON-PAIR-* + TRON-READ-*)

- [ ] **TRON-PAIR-01**: `pair_tron_ledger()` opens the Ledger TRON app over USB-HID via `@ledgerhq/hw-transport-node-hid` + `@ledgerhq/hw-app-trx`, returns the base58check (T-prefixed) address verbatim plus a `VERIFY-ON-DEVICE` block instructing the user to confirm the address on the Ledger screen
- [ ] **TRON-PAIR-02**: `get_tron_status()` returns `{ paired: true, address, derivationPath, rpcEndpoint, ledgerTrxAppVersion? }` after a successful pair; integrates with PAIR-NEV-* (v2.0 Phase 11) for restored sessions
- [ ] **TRON-READ-01**: `get_tron_balance({ wallet })` returns native TRX balance (sun + TRX-formatted) against a free public node (default TronGrid; override via `TRON_RPC_URL`)
- [ ] **TRON-READ-02**: `get_tron_token_balance({ wallet, tokenAddress })` returns TRC-20 token balance + decimals + USD value (DefiLlama `tron:<address>` keying); `get_tron_token_metadata` mirrors EVM `get_token_metadata` shape
- [ ] **TRON-READ-03**: `get_tron_block_tip()` returns the current TRON block height + timestamp (TRON-specific diagnostic — analogous to Bitcoin Core's `get_btc_block_tip` in v2.2)
- [ ] **TRON-READ-04**: `get_portfolio_summary` extends to include TRON when configured; per-row `chain: "tron"` field follows the v1.2 multi-EVM + v2.0 Solana convention; aggregates TRX + canonical TRC-20 stablecoin balances + USD totals via a curated top-30 TRC-20 mint registry at `src/tokens/tron-top-30.json`

#### Prepare → Preview → Send (TRON-PREP-*)

- [ ] **TRON-PREP-01**: TRON `payloadFingerprint = keccak256("VaultPilot-trontx-v1:" ‖ <serialized Protobuf raw_data bytes>)` — domain-tagged, prepare-time stable, distinct domain tag from EVM `"VaultPilot-txverify-v1:"` and Solana `"VaultPilot-soltx-v1:"` so cross-chain fingerprint reuse is impossible by construction
- [ ] **TRON-PREP-02**: `preview_send` TRON branch runs `triggerconstantcontract` simulation gate for TRC-20 calls (native sends skip — no simulation API); on success surfaces decoded args + Ledger TRX-app blind-sign hash recompute (SHA-256 over raw_data per TRON consensus) in `LEDGER BLIND-SIGN HASH` block
- [ ] **TRON-PREP-03**: `send_transaction` TRON branch enforces `previewToken` + `userDecision: "send"` gates identically to the EVM/Solana paths; rejects on `payloadFingerprint` drift between prepare and send
- [ ] **TRON-PREP-04**: TRON branch USB-HID transport surfaces in `get_tron_status` (`transport: "usb-hid"`) and `get_vaultpilot_config_status`; USB-HID device-not-found errors surface as structured refusal with troubleshooting hint, never as silent failures
- [x] **TRON-PREP-05**: `prepare_tron_token_approve({ tokenAddress, spender, amount })` produces a TRC-20 `approve(spender, amount)` TriggerSmartContract; `amount: "max"` accepted as `2^256-1`; preview labels unlimited approvals `⚠ UNLIMITED APPROVAL` and points at `prepare_tron_revoke_approval` (mirrors v1.1 PREP-29 strict-equality surfacing)

#### Writes (TRON-W-*)

- [ ] **TRON-W-01**: `prepare_tron_native_send({ to, sun })` produces an unsigned TRON `TransferContract` Protobuf transaction; decimal-string sun per v1.x decimal-handling convention
- [ ] **TRON-W-02**: `prepare_tron_trc20_send({ to, tokenAddress, amount })` produces an unsigned `TriggerSmartContract` with `transfer(to, amount)` calldata; decimal-string amount resolved via `get_tron_token_metadata` decimals lookup (`parseTronAmountStrict` mirrors `parseAmountStrict` from v1.1 + `parseSolanaAmountStrict` from v2.0)
- [x] **TRON-W-03**: `prepare_tron_revoke_approval({ tokenAddress, spender })` is a `prepare_tron_token_approve` shortcut producing `approve(spender, 0)` — distinct tool name so the agent can refer to it by intent (mirrors v1.1 PREP-27)
- [x] **TRON-W-04**: `prepare_tron_stake_freeze({ amount, resource: "ENERGY"|"BANDWIDTH" })` produces a `FreezeBalanceV2Contract` (Stake 2.0 — distinct from legacy `FreezeBalanceContract`); resource enum surfaced verbatim in `CHECKS PERFORMED`
- [x] **TRON-W-05**: `prepare_tron_stake_unfreeze({ amount, resource })` + `prepare_tron_withdraw_expire_unfreeze` cover the 14-day unfreeze waiting-period lifecycle
- [x] **TRON-W-06**: `prepare_tron_stake_vote({ votes: [{ srAddress, count }] })` produces a `VoteWitnessContract` for super-representative voting; best-effort SR-registry lookup labels each candidate
- [x] **TRON-W-07**: `prepare_tron_stake_claim_rewards` produces a `WithdrawBalanceContract` for accumulated voting rewards
- [x] **TRON-W-08**: TRON-specific spender-label table extends `src/config/contracts.ts` — SunSwap V2 router + LiFi TRON facet + canonical TRC-20 stablecoin contracts (USDT/USDC/USDD/TUSD) as KnownSpender entries; unknown spender → `(unknown spender — no prior interaction recorded)` label
- [x] **TRON-W-09**: `get_sunswap_quote({ inputToken, outputToken, amount, slippageBps? })` returns the SunSwap V2 router quote (out amount, route plan, slippage); `prepare_sunswap_swap({ inputToken, outputToken, amount, slippageBps })` returns an unsigned TriggerSmartContract for the SunSwap V2 router
- [x] **TRON-W-10**: Sandwich-MEV defense — `prepare_sunswap_swap` default slippage hint = 50 bps; refuses without explicit `slippageBps` when price impact > 2% (mirrors v2.0 SOL-W-13 Jupiter + v2.6 MEV-01 EVM equivalent)
- [ ] **TRON-W-11**: `prepare_tron_lifi_swap({ fromChain, fromToken, toChain, toToken, amount, toAddress })` produces an unsigned LiFi-routed bridge transaction; works both directions (TRON → EVM AND EVM → TRON); server-side `decodedFinalRecipient == userSuppliedToAddress` assertion at preview time (Inv #6b extension — mirrors v2.0 SOL-W-21 and v2.6 BRIDGE-T1) — **🟡 DEFERRED to v2.2.x per Phase 20 D-04b** (researcher 2026-05-20: LiFi `/v1/chains` returned 69 EVM chains with no TRON; GitHub `lifinance/contracts/deployments/` has no `tron*.json`; `/v1/quote?fromChain=TRX` returned error 1011 — see `.planning/phases/20-tron-sunswap-lifi-bridging/20-02-DEFERRED.md`)
- [ ] **TRON-W-12**: SunSwap V2 router + LiFi TRON facet program IDs added to `src/security/canonical-dispatch.ts` TRON arm (Layer 0.5 — mirrors v1.3 SEC-35 EVM dispatch-target enforcement + v2.0 SOL-W-09 Solana arm); mismatch refuses at preview time — **🟡 PARTIAL: SunSwap V2 router shipped in PR #113 via NEW `TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST` sibling set in `canonical-dispatch-tron.ts` (Open Question #2 design option (a)); LiFi TRON facet portion DEFERRED with TRON-W-11**

#### Diagnostics (TRON-DIAG-*)

- [x] **TRON-DIAG-01**: `get_tron_setup_status({ wallet })` returns `{ ledgerTrxAppVersion?, walletAddressOnDevice, resourceAccountPresent (Stake 2.0), frozenEnergyAmount, frozenBandwidthAmount }` — probes per-wallet Stake 2.0 state + on-device status (analogous to v2.0 SOL-DIAG-01 `get_solana_setup_status`)

### v2.2 Bitcoin + Litecoin (one milestone)

Adds Bitcoin + Litecoin support via USB-HID Ledger transport (Ledger BTC app handles both — LTC mode is a Bitcoin-app account-config). Esplora reads (no API keys) + native segwit + taproot sends + BIP-125 RBF + BIP-137 message signing + PSBT-based multisig + LiFi-routed BTC→EVM/Solana bridging. UTXO model is structurally distinct from account-model chains (EVM / Solana / TRON) — PSBT serialization replaces the single-blob payloadFingerprint shape; per-input BIP-143 sighashes commit independently. LTC mirrors BTC scaled down (shared Esplora + Ledger BTC infra). Optional Bitcoin/Litecoin Core JSON-RPC unlocks forensic chain reads Esplora can't serve.

#### Read + Pair (BTC-PAIR-* + BTC-READ-* + LTC-PAIR-* + LTC-READ-*)

- [ ] **BTC-PAIR-01**: `pair_btc_ledger()` opens the Ledger BTC app over USB-HID via `@ledgerhq/hw-app-btc`, returns the first segwit (bc1q…) AND first taproot (bc1p…) addresses verbatim plus a `VERIFY-ON-DEVICE` block instructing the user to confirm on the Ledger screen
- [ ] **BTC-PAIR-02**: `get_btc_status()` returns `{ paired: true, addresses: { segwit, taproot }, derivationPaths: { segwit, taproot }, esploraEndpoint, ledgerBtcAppVersion? }`; integrates with PAIR-NEV-* (v2.0 Phase 11) — multi-derivation-path record slots per the v2.0 multi-record-per-chain provision
- [ ] **BTC-READ-01**: `get_btc_balance({ wallet })` returns sat + BTC-formatted balance via Esplora `/address/{addr}` endpoint
- [ ] **BTC-READ-02**: `get_btc_balances({ wallet })` returns segwit + taproot balances separately (UTXOs live at distinct script types per derivation)
- [ ] **BTC-READ-03**: `get_btc_account_balance({ xpub })` aggregates across all derived addresses under an xpub (gap-limit-respecting scan)
- [ ] **BTC-READ-04**: `get_btc_tx_history({ wallet, limit })` returns recent transactions via Esplora `/address/{addr}/txs`
- [ ] **BTC-READ-05**: `get_btc_fee_estimates()` returns Esplora's fee-rate estimates (sat/vB) for 1/2/3/6/144-block confirmation targets
- [ ] **LTC-PAIR-01**: `pair_litecoin_ledger()` opens the Ledger BTC app in LTC account-config mode (or Ledger Litecoin app per the device firmware revision); returns LTC base58 (M-prefixed) AND ltc1q-segwit addresses; PAIR-NEV-* `chain: "litecoin"` record key reuse
- [ ] **LTC-READ-01**: `get_litecoin_balance({ wallet })` returns litoshi + LTC-formatted balance via litecoinspace.org Esplora-compatible endpoint
- [ ] **LTC-READ-02**: `get_litecoin_tx_history` + `get_litecoin_fee_estimates` mirror the BTC equivalents against litecoinspace.org

#### Prepare → Preview → Send (BTC-PREP-* + BTC-PSBT-*)

UTXO model means structurally distinct primitives from account-model chains. PSBT (BIP-174) is the canonical serialization; per-input BIP-143 sighashes are the cryptographic binding.

- [ ] **BTC-PREP-01**: BTC `payloadFingerprint = keccak256("VaultPilot-btctx-v1:" ‖ <concatenated BIP-143 sighashes for all inputs>)` — domain-tagged, prepare-time stable, distinct domain tag from EVM / Solana / TRON; UTXO-shape preimage commits per-input independently
- [x] **BTC-PREP-02**: `preview_send` BTC branch surfaces decoded inputs/outputs + per-input sighash + Ledger BTC-app PSBT-signing flow expectation in `LEDGER BLIND-SIGN HASH` block (multi-hash for multi-input transactions)
- [x] **BTC-PREP-03**: `send_transaction` BTC branch enforces `previewToken` + `userDecision: "send"` + `payloadFingerprint` drift gate identically to EVM/Solana/TRON paths
- [x] **BTC-PSBT-01**: `prepare_btc_send({ to, sats, feeRate? })` returns `{ handle, psbt, inputs[], outputs[], feeSats, payloadFingerprint, prepareReceipt }`; coin-selection via branch-and-bound (BnB) with manual override; native segwit (bc1q…) AND taproot (bc1p…) sends both work via the same prepare tool
- [x] **BTC-PSBT-02**: Mixed-script-type inputs supported (some segwit + some taproot inputs in one tx) — common case for users with derived addresses across both script types
- [x] **BTC-PSBT-03**: `register_btc_multisig_wallet({ name, descriptor, threshold })` records a known M-of-N multisig descriptor (sortedmulti or musig-aware); descriptor validated against Bitcoin script rules; stored at `~/.vaultpilot-mcp/btc-multisig.json` (0o600 file)
- [x] **BTC-PSBT-04**: `get_btc_multisig_balance({ walletName })` + `get_btc_multisig_utxos({ walletName })` aggregate UTXOs at the multisig descriptor's derived addresses via Esplora
- [ ] **BTC-PSBT-05**: `combine_btc_psbts({ psbts: [...] })` merges partially-signed PSBTs from multiple co-signers; conflicts surfaced as structured errors (input-by-input + key-by-key conflict detection)
- [ ] **BTC-PSBT-06**: `sign_btc_multisig_psbt({ psbt, walletName })` adds the user's signature to each input they're a signer on; preview surfaces the inputs being signed
- [ ] **BTC-PSBT-07**: `finalize_btc_psbt({ psbt })` builds the final witness data; refuses if signature threshold not met

#### Writes (BTC-W-* + LTC-W-* + BTC-LIFI-*)

- [x] **BTC-W-01**: `prepare_btc_send` produces the canonical PSBT-based unsigned transaction (see BTC-PSBT-01); native segwit + taproot both supported
- [x] **BTC-W-02**: `prepare_btc_rbf_bump({ txid, newFeeRate })` produces an unsigned RBF replacement PSBT with the higher fee rate; original input set preserved; BIP-125 sequence-number rules enforced; refused on confirmed transactions (mempool-only) or transactions that didn't signal RBF (sequence ≥ `0xfffffffe`)
- [x] **BTC-W-03**: `sign_message_btc({ wallet, message })` produces a BIP-137 compact signature over `magic_bytes ‖ varint_length ‖ message`; works against the segwit address by default; BIP-322 taproot message-signing deferred to a future `sign_message_btc_bip322` tool
- [ ] **BTC-W-04**: PSBT multisig flow (see BTC-PSBT-03..07) — combine / sign / finalize lifecycle for M-of-N multisig participation
- [ ] **LTC-W-01**: `prepare_litecoin_native_send({ to, litoshi })` mirrors `prepare_btc_send` PSBT-based shape; same `payloadFingerprint` shape with LTC domain tag `"VaultPilot-ltctx-v1:"`
- [ ] **LTC-W-02**: `sign_message_ltc({ wallet, message })` mirrors `sign_message_btc` with LTC magic bytes
- [ ] **BTC-LIFI-01**: `prepare_btc_lifi_swap({ fromToken: "BTC", toChain, toToken, amount, toAddress })` produces an unsigned LiFi-routed bridge transaction; BTC → EVM and BTC → Solana both supported; server-side `decodedFinalRecipient == userSuppliedToAddress` assertion at preview time (Inv #6b extension — mirrors v2.0 SOL-W-21 + v2.1 TRON-W-11 + v2.6 BRIDGE-T1)

#### Forensic chain reads (BTC-FORENSIC-* + LTC-FORENSIC-*)

Optional Bitcoin Core / Litecoin Core JSON-RPC unlocks forensic chain reads Esplora cannot serve. Absent → tools return `coreNotConfigured` envelope (never silent failure).

- [ ] **BTC-FORENSIC-01**: `BITCOIN_CORE_RPC_URL` (with optional `_USER`/`_PASS` basic-auth) enables Bitcoin Core JSON-RPC; absent → forensic tools return `coreNotConfigured` envelope
- [ ] **BTC-FORENSIC-02**: `get_btc_block_tip()` returns chain tip + timestamp + difficulty (Core RPC if configured; Esplora fallback for tip-only without difficulty)
- [ ] **BTC-FORENSIC-03**: `get_btc_block_stats({ blockHeight })` returns per-block tx count + fee percentiles + size + segwit/taproot adoption
- [ ] **BTC-FORENSIC-04**: `get_btc_blocks_recent({ count })` returns the last N block summaries; `get_btc_chain_tips()` returns all known chain tips (reorg detection)
- [ ] **BTC-FORENSIC-05**: `get_btc_mempool_summary()` returns mempool size + fee-rate histogram (Core RPC only — Esplora API doesn't expose full mempool)
- [ ] **LTC-FORENSIC-01**: `LITECOIN_CORE_RPC_URL` enables the LTC-equivalent forensic suite — `get_litecoin_block_tip` + `get_litecoin_mempool_summary` + parallel tools mirroring BTC-FORENSIC-02..05

#### Incident report (BTC-INC-*)

- [ ] **BTC-INC-01**: `build_incident_report({ wallet?, includeChains?: string[] })` bundles BTC/LTC chain-tip + mempool-anomaly signals (unexplained spikes / reorg events / large unconfirmed-balance changes) with EVM market-incident bits; cross-chain anomaly-signal aggregation for security-event triage

### v2.3 EVM lending + staking expansion

Each protocol is a phase with its own read tools, prepare tools, allowlist entries, and contract-table updates. Multi-chain fan-out where the protocol is deployed multi-chain (Compound + Morpho); Lido/EigenLayer/Rocket Pool are Ethereum-write-only.

#### Compound V3 (CMP-*)

- [ ] **CMP-01**: `get_compound_positions({ wallet, chain? })` returns Compound V3 supplied + borrowed per Comet with health-factor equivalent
- [ ] **CMP-02**: `get_compound_market_info({ chain, cometAddress })` returns the Comet's supply APR + borrow APR + collateral factors + liquidation threshold
- [ ] **CMP-03**: `prepare_compound_supply({ chain, cometAddress, asset, amount })` produces an unsigned Comet `supply(asset, amount)` call
- [ ] **CMP-04**: `prepare_compound_withdraw({ chain, cometAddress, asset, amount })` produces an unsigned `withdraw(asset, amount)` call
- [ ] **CMP-05**: `prepare_compound_borrow` + `prepare_compound_repay` cover the borrow lifecycle; `prepare_compound_repay({ amount: "max" })` accepted as full-position close (resolved server-side to outstanding-debt amount + small buffer)
- [ ] **CMP-06**: Compound V3 Comet addresses sourced from `src/config/contracts.ts` per-chain typed slots (Ethereum mainnet first; multi-chain — Arbitrum / Polygon / Base / Optimism — added in v2.3.x follow-up if Compound's per-chain Comet deployment is mature at planning time); canonical-dispatch allowlist Compound arm wiring

#### Morpho Blue (MOR-*)

- [ ] **MOR-01**: `get_morpho_positions({ wallet, chain? })` returns Morpho Blue positions keyed by market-id (loanToken + collateralToken + oracle + IRM + LLTV)
- [ ] **MOR-02**: `prepare_morpho_supply({ chain, marketId, amount })` produces an unsigned Morpho contract call
- [ ] **MOR-03**: `prepare_morpho_withdraw` + `prepare_morpho_borrow` cover the supply/borrow lifecycle
- [ ] **MOR-04**: `prepare_morpho_repay({ chain, marketId, amount })` accepts `amount: "max"` as full-position close (resolved server-side)
- [ ] **MOR-05**: Morpho Blue contract addresses + known-market registry (top 20-30 markets by TVL at planning time) sourced from `src/config/contracts.ts` per-chain table; canonical-dispatch allowlist Morpho arm wiring

#### Lido (LIDO-*)

- [ ] **LIDO-01**: `get_lido_positions({ wallet, chain? })` returns stETH + wstETH balances + accrued rebase rewards (Ethereum mainnet + Arbitrum)
- [ ] **LIDO-02**: `prepare_lido_stake({ amount })` produces an unsigned `Lido.submit(referral)` call with `value` = `amount`
- [ ] **LIDO-03**: `prepare_lido_unstake({ stethAmount })` produces an unsigned `WithdrawalQueue.requestWithdrawals` call (returns NFT receipt — surfaced in CHECKS PERFORMED)
- [ ] **LIDO-04**: `prepare_lido_wrap({ stethAmount })` + `prepare_lido_unwrap({ wstethAmount })` produce `WstETH.wrap` + `WstETH.unwrap` calls for the stETH↔wstETH conversion
- [ ] **LIDO-05**: Lido contracts (stETH + WstETH + WithdrawalQueue) sourced from `src/config/contracts.ts` Ethereum slots; reads work on Ethereum + Arbitrum (bridged variants); writes Ethereum-only; canonical-dispatch allowlist Lido arm wiring

#### EigenLayer (EIG-*)

- [ ] **EIG-01**: `get_eigenlayer_positions({ wallet })` returns EigenLayer strategy-level deposits (per LST or native restaking)
- [ ] **EIG-02**: `prepare_eigenlayer_deposit({ strategy, lst, amount })` produces an unsigned `StrategyManager.depositIntoStrategy` call; Ethereum-only

#### Rocket Pool (RP-*)

- [ ] **RP-01**: `get_rocketpool_positions({ wallet })` returns rETH balance + accrued value
- [ ] **RP-02**: `prepare_rocketpool_stake({ amount })` + `prepare_rocketpool_unstake({ rethAmount })` produce `RocketDepositPool.deposit` + `rETH.burn` calls; Ethereum-only

### v2.4 EVM DEX + LP + escape hatch

Uniswap V3 swap + full LP verb set; Curve swap + add-liquidity (stETH/ETH legacy + stable_ng plain pools); `prepare_custom_call` escape hatch with companion `get_contract_abi` + `read_contract` tools. The escape hatch is intentionally outside the canonical-dispatch allowlist — `acknowledgeNonProtocolTarget: true` is the user-acknowledgment they're operating outside the protocol-aware safety net.

#### Uniswap V3 (UNI-*)

- [ ] **UNI-01**: `get_uniswap_quote({ chain, tokenIn, tokenOut, amount, slippageBps? })` returns the Uniswap V3 Quoter V2 quote envelope (out amount, fee tier, route plan, price impact)
- [ ] **UNI-02**: `prepare_uniswap_swap({ chain, tokenIn, tokenOut, amount, slippageBps })` returns an unsigned SwapRouter02 transaction with auto-fee-tier selection (best price across 0.01% / 0.05% / 0.30% / 1.00% pools); multi-hop routing supported when single-hop has worse price
- [ ] **UNI-03**: Sandwich-MEV defense — default slippage hint = 50 bps; refuses without explicit `slippageBps` when price impact > 2% (pre-loaded by v2.6 MEV-01 per-L2 thresholds)
- [ ] **UNI-04**: `get_lp_positions({ wallet, chain? })` returns Uniswap V3 LP positions per NFT-id with current price + tick range + in-range/out-of-range flag + accrued fees + IL estimate (relative to a hodl baseline)
- [ ] **UNI-05**: `prepare_uniswap_v3_mint({ chain, token0, token1, fee, tickLower, tickUpper, amount0, amount1 })` produces an unsigned NonfungiblePositionManager `mint` call
- [ ] **UNI-06**: `prepare_uniswap_increase_liquidity` + `prepare_uniswap_decrease_liquidity` cover liquidity adjustments on existing positions (NFT-keyed)
- [ ] **UNI-07**: `prepare_uniswap_collect` produces an unsigned `collect(tokenId, ...)` call to harvest accrued fees
- [ ] **UNI-08**: `prepare_uniswap_burn` produces an unsigned `burn(tokenId)` call to close a fully-decreased position
- [ ] **UNI-09**: `prepare_uniswap_v3_rebalance({ tokenId, newTickLower, newTickUpper })` is a composite tool that builds a multicall (decrease all + collect + mint at new range); preview surfaces the multi-step decoded view
- [ ] **UNI-10**: Uniswap V3 SwapRouter02 + Quoter V2 + NonfungiblePositionManager addresses sourced from `src/config/contracts.ts` per-chain table; tick math + price↔tick conversions handled server-side in `src/signing/uniswap-tick.ts`; canonical-dispatch allowlist Uniswap arm wiring

#### Curve (CRV-*)

- [ ] **CRV-01**: `get_curve_positions({ wallet, chain? })` returns Curve LP token balances + pool composition (stETH/ETH legacy + stable_ng plain pools only at v2.4)
- [ ] **CRV-02**: `prepare_curve_swap({ chain, poolAddress, inputToken, outputToken, amount, slippageBps })` produces an unsigned `exchange` call on the named pool
- [ ] **CRV-03**: `prepare_curve_add_liquidity({ chain, poolAddress, amounts: [...], slippageBps })` produces an unsigned `add_liquidity` call for stable_ng plain pools (Ethereum first); Curve pool addresses sourced from `src/config/contracts.ts` curated registry (stETH/ETH legacy + top 10 stable_ng pools at planning time); v0.2 follow-ups (3-coin meta-pools, Curve metaregistry-driven discovery) deferred per upstream issue [#321](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/issues/321) (or equivalent); canonical-dispatch allowlist Curve arm wiring

#### Escape hatch (CUSTOM-*)

- [ ] **CUSTOM-01**: `prepare_custom_call({ chain, to, data, value?, acknowledgeNonProtocolTarget: true })` produces an unsigned transaction that BYPASSES the canonical-dispatch allowlist by design; missing `acknowledgeNonProtocolTarget: true` → structured refusal naming the safety implication; preview surfaces a `[WARN — NON-PROTOCOL TARGET]` block above the standard preview blocks
- [ ] **CUSTOM-02**: `get_contract_abi({ chain, address })` returns the verified ABI from Etherscan (or per-chain explorer); `not-verified` arm surfaced verbatim
- [ ] **CUSTOM-03**: `read_contract({ chain, address, functionName, args })` calls a view function via `eth_call`; encodes/decodes via the verified ABI; per-call ABI-decode best-effort surfacing in CHECKS PERFORMED when `prepare_custom_call` follows a `get_contract_abi` call; blind-sign-only when ABI unavailable

### v2.5 Safe (Gnosis) multisig

User can read Safe (Gnosis) multisig positions, participate in the three-step propose → approve → execute signing flow, and submit signatures to the Safe Tx Service API for cross-signer coordination. `enableModule` and `delegateCall: true` operations get hard-trigger second-LLM check wiring (Inv #12.5) — Safe modules and delegate calls expand the multisig's authority beyond signed-tx execution and need extra-careful agent attention.

#### Safe positions + Tx Service (SAFE-01..04)

- [ ] **SAFE-01**: `get_safe_positions({ wallet, chain? })` returns Safes where the wallet is an owner; per-Safe surfaces address + owners[] + threshold + nonce + pendingTransactions[] + enabledModules[]
- [ ] **SAFE-02**: `get_safe_transaction({ chain, safeAddress, safeTxHash })` returns full transaction details + collected signatures + required threshold
- [ ] **SAFE-03**: Safe Tx Service API client (`src/clients/safe-tx-service.ts`) mirrors `etherscan.ts` shape per-chain (Ethereum + Arbitrum + Polygon + Base + Optimism endpoints documented at safe-global.com)
- [ ] **SAFE-04**: Safe ProxyFactory + Singleton addresses sourced from `src/config/contracts.ts` per-chain table; canonical-dispatch allowlist Safe arm wiring (Singleton is the dispatch target for all Safe operations)

#### Three-step signing flow (SAFE-05..08)

- [ ] **SAFE-05**: `prepare_safe_tx_propose({ chain, safeAddress, to, value, data, operation })` builds the SafeTx hash + the EIP-712 typed-data structure; user signs the SafeTx hash via Ledger (typed-data signing required — depends on Ledger ETH app clear-sign-typed-data coverage, accepted-residual otherwise); SafeTx hash computation in `src/signing/safe-tx-hash.ts` (regression-tested with fixture Safe transactions)
- [ ] **SAFE-06**: `prepare_safe_tx_approve({ chain, safeAddress, safeTxHash })` fetches the pending SafeTx from Tx Service, surfaces the decoded operation in CHECKS PERFORMED, prepares the user's signature
- [ ] **SAFE-07**: `submit_safe_tx_signature({ chain, safeAddress, safeTxHash, signature })` submits the user's signature to the Tx Service (off-chain coordination — no on-chain tx)
- [ ] **SAFE-08**: `prepare_safe_tx_execute({ chain, safeAddress, safeTxHash })` builds the on-chain execution transaction once enough signatures collected; signatures-bytes assembled from Tx Service state

#### `enableModule` + `delegateCall` hard-trigger second-LLM check (SAFE-09 — Inv #12.5)

- [ ] **SAFE-09**: `prepare_safe_tx_propose` (and `_approve`) detect `enableModule(...)` calldata pattern at preview time and emit a hard-trigger block `[HARD-TRIGGER — MODULE ENABLE]` instructing the agent to run `get_verification_artifact` AND surface the result to the user before requesting `userDecision`; `operation: 1` (delegateCall) hard-triggers a similar `[HARD-TRIGGER — DELEGATECALL]` block; both blocks are NOT structured refusals (the operations are legitimate) but the second-LLM check becomes a precondition the agent MUST surface to the user before signing; skill-side Inv #12.5 encoded in companion `vaultpilot-preflight` skill (sister-repo coordinated bump)

### v2.6 Bridge facet decoders + cross-chain hardening

Tier-1 bridge facet decoders land for Wormhole, Mayan, NEAR Intents, and Across V3 — server-side mechanical assertion of `decodedFinalRecipient == userSuppliedRecipient` at preview (Inv #6b). Sandwich-MEV slippage hint extends across EVM swap tools with per-L2 thresholds. Tier-2 facets explicitly deferred — documented as planning artifact but no phase ships them.

#### Tier-1 facet decoders (BRIDGE-T1-*)

- [ ] **BRIDGE-T1-01**: Wormhole `transferTokensWithPayload(...)` decoder extracts the `recipient` field; server asserts equality against user-supplied recipient at preview
- [ ] **BRIDGE-T1-02**: Mayan `nonEvmRecipient(...)` decoder extracts the non-EVM destination (Solana / TRON / etc.); server asserts equality
- [ ] **BRIDGE-T1-03**: NEAR Intents `intent.receiver` decoder extracts the receiver field; server asserts equality
- [ ] **BRIDGE-T1-04**: Across V3 `depositV3(...)` decoder extracts the `recipient` field; server asserts equality
- [ ] **BRIDGE-T1-05**: Mismatch surfaces as `[REFUSED — DECODED RECIPIENT DRIFT]` structured error naming the decoded value, the user-supplied value, and the bridge name; each Tier-1 decoder lives in `src/protocols/bridge-decoders/` with per-bridge module shape (mirrors `src/protocols/erc20.ts` / `src/protocols/aave-v3.ts` per-protocol convention); decoder regression tests pin known-good calldata fixtures per bridge — drift in upstream bridge ABI surface caught at test time
- [ ] **BRIDGE-T1-06**: Inv #6b wiring across existing prepare-swap tools (`prepare_swap` / `prepare_uniswap_swap` / `prepare_solana_lifi_swap` / `prepare_btc_lifi_swap` / `prepare_tron_lifi_swap`) — existing tools opt into the assertion when calldata matches a known Tier-1 facet; SECURITY.md Inv #6b codification; companion-skill update for Tier-1 coverage (sister-repo coordinated bump)

#### Tier-2 facets (BRIDGE-T2-*)

Explicitly deferred until usage data justifies. Documented in REQUIREMENTS.md but no phase ships them.

- **BRIDGE-T2-01..N (DEFERRED)**: deBridge / DLN, Stargate `composeMsg`, Hop, Symbiosis. Bridge volume + user demand at v2.6 ship time drives whether to schedule a v2.6.x or v2.7 follow-up phase. Tier-2 bridges have less obvious blast-radius (Tier-1 covers the cross-VM + non-EVM-destination paths where final-recipient drift is hardest to detect).

#### Sandwich-MEV per-L2 thresholds (MEV-*)

- [ ] **MEV-01**: `prepare_uniswap_swap` / `prepare_curve_swap` / other EVM swap tools accept per-chain slippage thresholds — Ethereum mainnet stays at 50bps default / >2% refusal (v2.4 Phase 32 default); L2 thresholds calibrated against actual sandwich-MEV exposure (most L2s tolerate smaller default slippage). Default thresholds documented in `src/config/sandwich-mev-thresholds.ts` per-chain SOT; refusal mode is consistent (`SANDWICH_MEV_REFUSED` errorCode + structured refusal with chain-specific guidance). Per-L2 thresholds configurable via env (`MEV_THRESHOLD_<CHAIN>` override) for advanced users. SECURITY.md updated with per-L2 sandwich-MEV threat-model nuance

### v3.0 Hosted MCP

- **HOST-01..N**: HTTP/SSE transport, OAuth 2.1 + bearer tokens, operator-supplied API keys; multi-tenant; unblocks claude.ai chat (web + native desktop) where the host environment's outbound-HTTP allowlist blocks chain RPC providers. TRON / Solana / BTC / LTC USB-HID signing requires a local Ledger and stays on the local-stdio path regardless

### v3.1 NFT reads (Solana via Helius DAS, EVM via Reservoir/Alchemy)

- **NFT-01..N**: `get_nft_portfolio` (cross-chain), `get_nft_collection`, `get_nft_history`, `get_nft_listings` (EVM only — read-only browsing; marketplace fills out of scope pending typed-data signing); Solana branch via Helius DAS `getAssetsByOwner`; floor pricing via Magic Eden + Tensor (Solana) / Reservoir + OpenSea (EVM); per-collection NFT history (mint / sale / transfer / etc.)

### v3.2 Contacts + read-only sharing

- **CONT-01..N**: Local Ledger-signed address book — `add_contact` / `remove_contact` / `list_contacts` / `verify_contacts`; first-run users can label addresses without a paired Ledger via an unsigned-overlay mode that promotes to signed entries on first pair
- **SHARE-01..N**: Read-only portfolio links — `generate_readonly_link` / `import_readonly_token` / `list_readonly_invites` / `revoke_readonly_invite`; scoped permissions per link
- **STRAT-01..N**: Anonymized portfolio sharing — `share_strategy` / `import_strategy`

### v3.3 Device-trust attestation

- **DEV-01**: `verify_ledger_attestation` — Secure Element attestation challenge
- **DEV-02**: `verify_ledger_firmware` — firmware version pin against a known-good list
- **DEV-03**: `verify_ledger_live_codesign` — Ledger Live binary signature check on the host
- **DEV-04..N**: Issue [#325](https://github.com/szhygulin/vaultpilot-mcp/issues/325) P1-P5 follow-ups

### v3.4 Ergonomics surface

Tools that aren't load-bearing for the trust pipeline but raise the day-to-day floor.

- **ERG-01**: `get_pnl_summary({ wallet, period })` — wallet-level net PnL across EVM / TRON / Solana with `mtd` / `ytd` / `30d` / `7d` / `1d` periods
- **ERG-02**: `get_portfolio_diff({ wallet, fromBlock, toBlock })` — diff between two snapshots; v1 ships with a residual `otherEffectUsd` bucket; v2 deferred (per-protocol historical-state readers, 6 buckets)
- **ERG-03**: `get_daily_briefing({ wallet })` — one-shot summary of overnight position changes + market events affecting the wallet
- **ERG-04**: `compare_yields({ asset })` — rank lending APRs across Aave / Compound / Morpho / Marinade / Jito / Kamino-lend / MarginFi; DefiLlama-bundled adapters for the LST + lending set
- **ERG-05**: `explain_tx({ txHash, chain })` — post-hoc decode of a historical tx with action description and price-impact summary
- **ERG-06**: `get_health_alerts({ wallet, chain? })` — multi-protocol liquidation-risk scan across Aave / Compound / Morpho / MarginFi / Kamino

### v3.5 Multi-hardware-wallet

- **HW-01..N**: Trezor, Keystone, GridPlus Lattice — staged per device; Keystone's air-gapped QR-only signing pairs naturally with the security positioning

## Out of Scope

Explicitly excluded. Documented to prevent re-adding without discussion.

| Feature | Reason |
|---------|--------|
| NFT marketplace fills (Seaport / Blur) | Need typed-data signing (`prepare_eip2612_permit`, `prepare_permit2_*`, `sign_typed_data_v4`) which depend on Inv #1b/#2b skill invariants AND a Ledger ETH app that clear-signs the typed-data tree. Until both ship, NFT fills silently bypass every existing skill defense. NFT *reads* are in scope at v3.1. |
| EIP-7702 `setCode` (full code-execution rights) | Highest-blast-radius EOA signature; persistent, `chain_id = 0` drains every EVM chain. Defense requires a coordinated MCP + skill release (`prepare_eip7702_authorization` builder + skill v9 implementation allowlist). Refused unconditionally until that ships. |
| Centralized exchange integration | Self-custodial-only; CEX integration would invert the trust model. |
| Hot wallet / private key signing | Hard contradiction of core value. Ledger-only, period. |
| Perps, options, prediction markets | Each is a domain in its own right; defer beyond v3.x if user demand justifies. |
| Solo validator deposit (32 ETH) | Niche; tracked in v3+ backlog only. |
| Token launch / airdrop claims | Adversarial-input class with no clean defense; out of scope. |
| Privacy mixers (Tornado-style) | Compliance + legal complexity; out of scope. |
| MEV-resistant transaction submission (Flashbots) | Useful but orthogonal to the trust-pipeline value; v3+ backlog. |
| Mobile MCP client | MCP is desktop-CLI today; mobile waits for the runtime to land. |
| `prepare_eip2612_permit` / `prepare_permit2_*` / `prepare_cowswap_order` / `sign_typed_data_v4` | Hard precondition: Ledger must clear-sign the typed-data type. Until that lands and Inv #1b (tree decode + `verifyingContract` pin) + Inv #2b (digest recompute over decoded tree) ship, these silently bypass every existing skill defense. |

## Traceability

Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INST-01..05 | Phase 1 | Pending |
| READ-01..06 | Phase 2 | Pending |
| PAIR-01..05 | Phase 3 | Pending |
| PREP-01..10 | Phase 4 | Pending |
| DEMO-01..07 | Phase 5 | Pending |
| DIAG-01..04 | Phase 5 | Pending |
| PREP-20..22, PREP-26..30 | Phase 6 | Pending |
| READ-20, PREP-23..25, READ-21 | Phase 7 | Pending |
| READ-40..44, PREP-40..41, INST-40 | Phase 8 | Pending |
| SEC-30..38 | Phase 9 | Pending |
| DIST-40..43 | Phase 10 | Pending |
| PAIR-NEV-01..07 | Phase 11 (v2.0) | Pending |
| SOL-01..05 | Phase 11 (v2.0) | Pending |
| SOL-PREP-01..05, SOL-W-01..02 | Phase 12 (v2.0) | Pending |
| SOL-W-03..10 | Phase 13 (v2.0) | Pending |
| SOL-W-11..13 | Phase 14 (v2.0) | Pending |
| SOL-W-14..20 | Phase 15 (v2.0) | Pending |
| SOL-W-21, SOL-DIAG-01 | Phase 16 (v2.0) | Pending |
| TRON-PAIR-01/02, TRON-READ-01..03 | Phase 17 (v2.1) | Pending |
| TRON-PREP-01..04, TRON-W-01/02 | Phase 18 (v2.1) | Pending |
| TRON-PREP-05, TRON-W-03..08 | Phase 19 (v2.1) | Done (PR #106-#109) |
| TRON-W-09..10, TRON-W-12 partial | Phase 20 (v2.1) | Done (PR #113); TRON-W-11 + TRON-W-12 LiFi portion deferred to v2.2.x per D-04b |
| TRON-READ-04, TRON-DIAG-01 | Phase 21 (v2.1) | Done (TRON-READ-04 in PR #91; TRON-DIAG-01 in PR #116) |
| BTC-PAIR-01/02, BTC-READ-01..05, LTC-PAIR-01, LTC-READ-01/02 | Phase 22 (v2.2) | Pending |
| BTC-PREP-01..03, BTC-PSBT-01/02, BTC-W-01 | Phase 23 (v2.2) | Pending |
| BTC-W-02, BTC-W-03 | Phase 24 (v2.2) | Pending |
| BTC-PSBT-03..07, BTC-W-04 | Phase 25 (v2.2) | Pending |
| LTC-W-01/02, BTC-LIFI-01 | Phase 26 (v2.2) | Pending |
| BTC-FORENSIC-01..05, LTC-FORENSIC-01, BTC-INC-01 | Phase 27 (v2.2) | Pending |
| CMP-01..06 | Phase 28 (v2.3) | Pending |
| MOR-01..05 | Phase 29 (v2.3) | Pending |
| LIDO-01..05 | Phase 30 (v2.3) | Pending |
| EIG-01/02, RP-01/02 | Phase 31 (v2.3) | Pending |
| UNI-01..03, UNI-10 (swap-only) | Phase 32 (v2.4) | Pending |
| UNI-04..09 (LP verb set) | Phase 33 (v2.4) | Pending |
| CRV-01..03 | Phase 34 (v2.4) | Pending |
| CUSTOM-01..03 | Phase 35 (v2.4) | Pending |
| SAFE-01..04 | Phase 36 (v2.5) | Pending |
| SAFE-05..08 | Phase 37 (v2.5) | Pending |
| SAFE-09 (Inv #12.5) | Phase 38 (v2.5) | Pending |
| BRIDGE-T1-01..06 | Phase 39 (v2.6) | Pending |
| MEV-01 | Phase 40 (v2.6) | Pending |
| BRIDGE-T2-* | v2.6.x+ (DEFERRED) | Backlog |
| HOST-* | v3.0 (post-v2.6) | Backlog |
| NFT-* | v3.1 (post-v3.0) | Backlog |
| CONT-*, SHARE-*, STRAT-* | v3.2 | Backlog |
| DEV-* | v3.3 | Backlog |
| ERG-* | v3.4 | Backlog |
| HW-* | v3.5 | Backlog |

**Coverage:**
- v1.0 requirements: 31 total → mapped to Phases 1-5
- v1.1 requirements: 13 total → mapped to Phases 6-7 (was 8 — added approve / revoke / WETH unwrap from upstream sync)
- v1.2 requirements: 8 total → mapped to Phase 8 (was 5 — added `resolve_token` + `get_token_allowances`)
- v1.3 requirements: 9 total → mapped to Phase 9 (was 7 — added `verify_tx_decode` + `get_tx_verification` re-emit)
- v1.4 requirements: 4 total → mapped to Phase 10
- v2.0 requirements: 39 total (7 PAIR-NEV + 5 SOL + 5 SOL-PREP + 21 SOL-W + 1 SOL-DIAG) → mapped to Phases 11-16
- v2.1 TRON requirements: 24 total (2 TRON-PAIR + 4 TRON-READ + 5 TRON-PREP + 12 TRON-W + 1 TRON-DIAG) → mapped to Phases 17-21
- v2.2 BTC+LTC requirements: 35 total (2 BTC-PAIR + 5 BTC-READ + 1 LTC-PAIR + 2 LTC-READ + 3 BTC-PREP + 7 BTC-PSBT + 4 BTC-W + 2 LTC-W + 1 BTC-LIFI + 5 BTC-FORENSIC + 1 LTC-FORENSIC + 1 BTC-INC + 1 BTC-INC) → mapped to Phases 22-27
- v2.3 EVM lending+staking requirements: 20 total (6 CMP + 5 MOR + 5 LIDO + 2 EIG + 2 RP) → mapped to Phases 28-31
- v2.4 EVM DEX+LP+escape requirements: 16 total (10 UNI + 3 CRV + 3 CUSTOM) → mapped to Phases 32-35
- v2.5 Safe requirements: 9 total (SAFE-01..09) → mapped to Phases 36-38
- v2.6 Bridge+MEV requirements: 7 total (6 BRIDGE-T1 + 1 MEV) → mapped to Phases 39-40; BRIDGE-T2-* deferred
- v3.x: tracked in backlog; phase mapping deferred until each milestone enters planning
- Unmapped within v1.x + v2.0-v2.6: 0 ✓

**Phase totals:** Phases 1-10 (v1.x) + 11-16 (v2.0) + 17-21 (v2.1) + 22-27 (v2.2) + 28-31 (v2.3) + 32-35 (v2.4) + 36-38 (v2.5) + 39-40 (v2.6) = **40 phases total** scaffolded.

---
*Requirements defined: 2026-05-12*
*Last updated: 2026-05-20 — v2.1-v2.6 milestone scaffolding landed (chore/v2-1-thru-6-scaffolding); promoted 6 one-line bullets to ~110 numbered requirements across 24 new phases (17-40)*
