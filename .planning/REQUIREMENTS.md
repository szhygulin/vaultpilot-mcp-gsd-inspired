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

- **SOL-01..N**: Read SOL + SPL balances, MarginFi + Kamino lending, Jupiter v6 swaps, Marinade / Jito / native staking; sign via USB-HID transport (no WC); per-wallet durable-nonce account (`prepare_solana_nonce_init` / `_close`); mandatory `simulateTransaction` gate at preview
- **SOL-W-01..N**: Writes — SOL/SPL transfers, MarginFi + Kamino supply/withdraw/borrow/repay, Jupiter swaps, Marinade stake + immediate-unstake, Jito stake-pool deposit (deposit-only — unstake deferred), native SOL delegate/deactivate/withdraw, LiFi-routed EVM↔Solana bridging (`prepare_solana_lifi_swap`)
- **SOL-DIAG-01**: `get_solana_setup_status` probes nonce + lending-account PDAs

### v2.1 TRON

- **TRON-01..N**: TRX + canonical TRC-20 stablecoin (USDT/USDC/USDD/TUSD) balances + transfers; Stake 2.0 (freeze/unfreeze/withdraw-expire-unfreeze/vote/claim); SunSwap (`prepare_sunswap_swap`) for same-chain TRX↔TRC-20 swaps; LiFi-routed TRON↔EVM bridging; TRC-20 approve via `prepare_tron_token_approve`; Ledger TRON app clear-signs every supported action over USB-HID

### v2.2 Bitcoin + Litecoin (one milestone)

- **BTC-01..N**: Esplora reads (`get_btc_balance`, `_balances`, `_account_balance`, `_multisig_balance`, `_multisig_utxos`, `_tx_history`, `_fee_estimates`); native segwit + taproot sends (`prepare_btc_send`); BIP-125 RBF (`prepare_btc_rbf_bump`); PSBT multisig (`combine_btc_psbts` / `sign_btc_multisig_psbt` / `finalize_btc_psbt` / `register_btc_multisig_wallet`); BIP-137 message signing (`sign_message_btc`); LiFi-routed BTC→EVM/Solana swap (`prepare_btc_lifi_swap`); USB-HID via Ledger BTC app
- **BTC-FORENSIC-01..N**: Optional Bitcoin Core JSON-RPC unlocks `get_btc_block_tip` / `_block_stats` / `_blocks_recent` / `_chain_tips` / `_mempool_summary` (forensic chain reads Esplora cannot serve)
- **LTC-01..N**: Same surface as BTC, scaled down — `prepare_litecoin_native_send`, `sign_message_ltc`, Esplora via litecoinspace.org, optional Litecoin Core RPC for forensic reads
- **BTC-INC-01**: `build_incident_report` bundles BTC/LTC chain-tip + mempool-anomaly signals + EVM market-incident bits

### v2.3 EVM lending + staking expansion

Each protocol is a milestone with its own read tools, prepare tools, allowlist entries, and contract-table updates.

- **CMP-01..N**: Compound V3 — `get_compound_positions`, `get_compound_market_info`, `prepare_compound_supply` / `_withdraw` / `_borrow` / `_repay`; multi-Comet support per chain
- **MOR-01..N**: Morpho Blue — `get_morpho_positions`, `prepare_morpho_supply` / `_withdraw` / `_borrow` / `_repay`; `prepare_morpho_repay({ amount: "max" })` accepted as full-position close
- **LIDO-01..N**: Lido — `prepare_lido_stake` / `_unstake` / `_wrap` (stETH→wstETH) / `_unwrap` (wstETH→stETH); read on Ethereum + Arbitrum, write Ethereum-only
- **EIG-01..N**: EigenLayer — `prepare_eigenlayer_deposit`; restaking on top of an existing LST; Ethereum-only
- **RP-01..N**: Rocket Pool — `prepare_rocketpool_stake` / `_unstake` (rETH); Ethereum-only

### v2.4 EVM DEX + LP + escape hatch

- **UNI-01..N**: Uniswap V3 — `prepare_uniswap_swap` (direct V3, same-chain, auto-fee-tier); full LP verb set (`_v3_mint` / `_increase_liquidity` / `_decrease_liquidity` / `_collect` / `_burn` / `_rebalance`); `get_lp_positions` with IL estimate
- **CRV-01..N**: Curve — `get_curve_positions`, `prepare_curve_swap` (stETH/ETH legacy + stable_ng plain pools), `prepare_curve_add_liquidity` (Ethereum stable_ng plain pools); v0.2 follow-ups deferred per upstream issue #321
- **CUSTOM-01**: `prepare_custom_call({ to, data, value, acknowledgeNonProtocolTarget: true })` — escape hatch for arbitrary verified-contract calls; bypasses the canonical-dispatch allowlist by design; `acknowledgeNonProtocolTarget: true` is the user-acknowledgment they're operating outside the protocol-aware safety net; pairs with `get_contract_abi` and `read_contract`

### v2.5 Safe (Gnosis) multisig

- **SAFE-01..N**: `get_safe_positions`, `prepare_safe_tx_propose` / `_approve` / `_execute`, `submit_safe_tx_signature` — three-step signing flow (propose → collect approvals → execute); Tx Service API integration; `enableModule` + `delegateCall: true` flagged for hard-trigger second-LLM check (Inv #12.5)

### v2.6 Bridge facet decoders + cross-chain hardening

- **BRIDGE-T1-01..N**: Tier-1 facet decoders (Inv #6b) — Wormhole `transferTokensWithPayload`, Mayan `nonEvmRecipient`, NEAR Intents `intent.receiver`, Across V3 `depositV3.recipient`; server-side mechanical assertion of `decodedFinalRecipient == userSuppliedRecipient`
- **BRIDGE-T2-01..N**: Tier-2 (deferred until usage data justifies) — deBridge / DLN, Stargate `composeMsg`, Hop, Symbiosis
- **MEV-01**: Sandwich-MEV slippage hint on `prepare_swap` / `prepare_uniswap_swap` (Ethereum mainnet first, then per-L2 thresholds)

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
| SOL-*, SOL-W-*, SOL-DIAG-* | v2.0 (post-Phase 10) | Backlog |
| TRON-* | v2.1 (post-v2.0) | Backlog |
| BTC-*, BTC-FORENSIC-*, LTC-*, BTC-INC-* | v2.2 (post-v2.1) | Backlog |
| CMP-*, MOR-*, LIDO-*, EIG-*, RP-* | v2.3 (post-v2.2) | Backlog |
| UNI-*, CRV-*, CUSTOM-* | v2.4 (post-v2.3) | Backlog |
| SAFE-* | v2.5 (post-v2.4) | Backlog |
| BRIDGE-T1-*, BRIDGE-T2-*, MEV-* | v2.6 (post-v2.5) | Backlog |
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
- v2.x + v3.x: tracked in backlog; phase mapping deferred until each milestone enters planning
- Unmapped within v1.x: 0 ✓

---
*Requirements defined: 2026-05-12*
*Last updated: 2026-05-12 after upstream docs sync (PR #672 — tool surface ~80→~190, NFT reads in scope, BTC/LTC fully shipped, additional EVM protocols documented)*
