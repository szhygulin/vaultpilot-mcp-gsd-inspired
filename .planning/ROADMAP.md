# Roadmap: VaultPilot MCP (GSD-inspired)

## Overview

The journey: a working trust pipeline first (one chain, one signing flow, end-to-end), then chain/protocol breadth on top of a proven pipeline. Each milestone ships a self-contained vertical slice the user can install and exercise. The verification phase at every milestone walks the full prepare → preview → sign → broadcast path, surfacing pipeline bugs at the cheapest moment to fix them.

## Milestones

- 📋 **v1.0 MVP** — Phases 1-5 (Ethereum native sends, demo mode, install + diagnostics)
- 📋 **v1.1 Aave + ERC-20 lifecycle** — Phases 6-7 (transfer + approve + revoke + WETH unwrap + Aave V3)
- 📋 **v1.2 Multi-EVM + token tooling** — Phase 8 (5 EVM chains + `resolve_token` + `get_token_allowances`)
- 📋 **v1.3 Hardening + skill** — Phase 9 (companion skill, three verification tools, dispatch allowlist)
- 📋 **v1.4 Distribution** — Phase 10 (binary, installer scripts, setup wizard)
- 📋 **v2.0** — Solana (MarginFi / Kamino / Jupiter / Marinade / Jito / native staking)
- 📋 **v2.1** — TRON (TRX / TRC-20 / Stake 2.0 / SunSwap / LiFi bridging)
- 📋 **v2.2** — Bitcoin + Litecoin (Esplora reads / RBF / PSBT multisig / BIP-137 / LiFi BTC routing / optional Core RPC)
- 📋 **v2.3** — EVM lending+staking expansion (Compound / Morpho / Lido wrap / EigenLayer / Rocket Pool)
- 📋 **v2.4** — EVM DEX + LP + escape hatch (Uniswap V3 LP / Curve / `prepare_custom_call`)
- 📋 **v2.5** — Safe (Gnosis) multisig
- 📋 **v2.6** — Bridge facet decoders + cross-chain hardening (Tier-1 + Tier-2 / sandwich-MEV per-L2)
- 📋 **v3.0** — Hosted MCP (HTTP/SSE / OAuth)
- 📋 **v3.1** — NFT reads (portfolio / collection / history / listings)
- 📋 **v3.2** — Contacts + read-only sharing
- 📋 **v3.3** — Device-trust attestation
- 📋 **v3.4** — Ergonomics surface (PnL / portfolio diff / daily briefing / `compare_yields` / `explain_tx`)
- 📋 **v3.5** — Multi-hardware-wallet (Trezor / Keystone / GridPlus Lattice)

## Phases

### 📋 v1.0 MVP (Phases 1-5)

**Milestone Goal:** A user can install the MCP, ask the agent for their Ethereum portfolio, prepare a native ETH send, sign it on a Ledger via WalletConnect, and confirm the on-device hash matches the agent-relayed hash. Demo mode covers users who haven't paired hardware. The full trust pipeline is exercised end-to-end against mainnet.

#### Phase 1: Server skeleton + install
**Goal**: A boot-able MCP server registered with Claude Code CLI, Claude Desktop, and Cursor, emitting a `--check` doctor pass on stdout.
**Depends on**: Nothing (first phase)
**Requirements**: INST-01, INST-02, INST-03, INST-04
**Success Criteria** (what must be TRUE):
  1. `claude mcp add vaultpilot-mcp -- npx -y vaultpilot-mcp` succeeds and the server appears in `claude mcp list`
  2. The server responds to MCP `initialize` with a tool list (initially empty) and a server-level `instructions` field
  3. `npx -y vaultpilot-mcp --check` validates Node version, prints `✓` / `⚠` / `✗` lines, and emits `--json` envelope for tooling
  4. Claude Desktop config paste registers cleanly on macOS, Linux, and Windows (Windows uses `cmd /c` wrapper)
  5. Cursor `~/.cursor/mcp.json` paste registers cleanly
**Plans**: 3 plans

Plans:
- [ ] 01-01: Bootstrap TypeScript + `@modelcontextprotocol/sdk` + `viem` + vitest scaffolding; package.json + tsconfig + bin entrypoint
- [ ] 01-02: Implement `initialize` handler + tool registration framework + server-level `instructions` field + stderr logging discipline
- [ ] 01-03: Implement `--check` CLI subcommand + InstallEnvelope JSON shape + Windows wrapper handling

#### Phase 2: Ethereum read-only portfolio
**Goal**: User can ask "show me my Ethereum portfolio" and get native + ERC-20 balances + USD totals against a free public RPC, no API keys required.
**Depends on**: Phase 1
**Requirements**: READ-01, READ-02, READ-03, READ-04, READ-05, READ-06
**Success Criteria** (what must be TRUE):
  1. `get_portfolio_summary({ wallet })` returns the documented shape against PublicNode RPC
  2. ERC-20 discovery covers the top-50-by-volume Ethereum tokens at minimum
  3. USD pricing comes from DefiLlama; missing prices surface as `priceUnknown: true`, not zero
  4. `get_token_balance` and `get_transaction_status` work standalone
  5. ENS forward and reverse resolution work via Universal Resolver
  6. RPC failures surface as `rpcDegraded` with a one-line reason; never silent zeros
**Plans**: 4 plans

Plans:
- [ ] 02-01: RPC client wrapper + PublicNode default + custom-URL override + degraded-state surfacing
- [ ] 02-02: ERC-20 balance scanner (multicall) + top-50 token registry seed + balance dust filter
- [ ] 02-03: DefiLlama pricing client + USD-total aggregation + price-unknown handling
- [ ] 02-04: ENS resolver (forward + reverse) + `get_token_balance` + `get_transaction_status`

#### Phase 3: WalletConnect pairing
**Goal**: User can pair Ledger via WalletConnect once per session, see the paired address surfaced verbatim, and confirm the WC session topic in Ledger Live.
**Depends on**: Phase 2
**Requirements**: PAIR-01, PAIR-02, PAIR-03, PAIR-04, PAIR-05
**Success Criteria** (what must be TRUE):
  1. `pair_ledger_live()` returns a `wcUri` the user pastes into Ledger Live; tool waits up to 60s for session approval
  2. `get_ledger_status()` returns `paired: true` + the address Ledger Live exposed + the last 8 chars of the WC session topic
  3. The pairing-flow response includes a `VERIFY-ON-DEVICE` block instructing the user to compare the response address against Ledger Live → Settings → Connected Apps
  4. Missing `WALLETCONNECT_PROJECT_ID` → clear-error refusal naming the env var and the WC dashboard URL
  5. Re-calling `pair_ledger_live()` reuses the existing session; `force: true` re-pairs from scratch
**Plans**: 2 plans

Plans:
- [x] 03-01: `@walletconnect/sign-client` integration + session lifecycle + topic surfacing + `WALLETCONNECT_PROJECT_ID` env handling — PR #8
- [x] 03-02: `pair_ledger_live` tool + `get_ledger_status` tool + force-re-pair semantics + 60s session-approval timeout — PR #9

**Status**: code-complete; verify-phase pending real-Ledger smoke + `WALLETCONNECT_PROJECT_ID` from cloud.walletconnect.com

#### Phase 4: Native ETH send (the trust pipeline)
**Goal**: The full prepare → preview → send flow works for native ETH, with `payloadFingerprint` + `LEDGER BLIND-SIGN HASH` + `PREPARE RECEIPT` + `previewToken` + `userDecision` gates all enforced. This is the load-bearing milestone for the entire project.
**Depends on**: Phase 3
**Requirements**: PREP-01, PREP-02, PREP-03, PREP-04, PREP-05, PREP-06, PREP-07, PREP-08, PREP-09, PREP-10
**Success Criteria** (what must be TRUE):
  1. `prepare_native_send({ to, valueWei })` returns a handle plus the documented tuple, with `payloadFingerprint` matching the documented preimage
  2. `preview_send({ handle })` mints a `previewToken`, pins gas + nonce + maxFeePerGas, recomputes the EIP-1559 pre-sign hash, emits `LEDGER BLIND-SIGN HASH` block
  3. The `[AGENT TASK — RUN THESE CHECKS NOW]` block in `preview_send` instructs the agent to recompute the hash via `viem.serializeTransaction`; agent reports back in `CHECKS PERFORMED`
  4. `send_transaction` rejects without `previewToken` + `userDecision: "send"` + matching `payloadFingerprint`; bytes drift between prepare and send is caught with a structured error
  5. On a real signing flow against mainnet, the `LEDGER BLIND-SIGN HASH` value in `preview_send` matches what the Ledger device displays in blind-sign mode
  6. `get_tx_verification({ handle })` re-emits the verification block + tx JSON for 15 minutes after the original prepare call (context-eviction recovery)
**Plans**: 5 plans

Plans:
- [ ] 04-01: Handle store (in-memory, 15-min TTL) + `payloadFingerprint` computation + `PREPARE RECEIPT` block emission
- [ ] 04-02: `prepare_native_send` tool + nonce/gas/fee resolution + EIP-1559 tx structure
- [ ] 04-03: `preview_send` tool + `previewToken` UUID minting + pre-sign hash recompute + `LEDGER BLIND-SIGN HASH` block + agent-task block
- [ ] 04-04: `send_transaction` tool + `previewToken` + `userDecision` gate + WC `eth_sendTransaction` forwarding + Ledger response handling
- [ ] 04-05: 4byte.directory client (best-effort) + `get_tx_verification` re-emit tool + cross-check summary block

#### Phase 5: Demo mode + diagnostics
**Goal**: Fresh installs without Ledger or RPC keys boot into auto-demo with curated personas; `get_vaultpilot_config_status` and `get_ledger_device_info` surface diagnostics; update check runs once per session.
**Depends on**: Phase 4
**Requirements**: DEMO-01..07, DIAG-01..04
**Success Criteria** (what must be TRUE):
  1. Brand-new install (no config, no env) auto-enters demo; first tool response carries `VAULTPILOT NOTICE — Auto demo mode active`
  2. `get_demo_wallet` lists 4 curated personas with addresses + rehearsable flows; `set_demo_wallet({ persona })` activates one (process-local)
  3. In demo mode, `send_transaction` runs `eth_call` for revert detection and returns a simulation envelope; nothing signed, nothing broadcast
  4. In demo mode, `pair_ledger_live` refuses outright with a structured error pointing at `set_demo_wallet`
  5. `VAULTPILOT_DEMO=true` and `=false` are deterministic opt-in/opt-out; other values rejected
  6. `get_vaultpilot_config_status` returns booleans/counts only; never a secret value
  7. Once-per-session update check fires against `registry.npmjs.org`; suppressed by `VAULTPILOT_DISABLE_UPDATE_CHECK=1`
**Plans**: 3 plans

Plans:
- [ ] 05-01: Demo-mode runtime flag resolution (env > config > auto-detect) + curated persona registry + `set_demo_wallet` state
- [ ] 05-02: Demo-mode signing intercepts (refuse `pair_ledger_live`, simulate `send_transaction`) + simulation envelope shape
- [ ] 05-03: `get_vaultpilot_config_status` + `get_ledger_device_info` + once-per-session update check + auto-demo first-response NOTICE

---

### 📋 v1.1 Aave + ERC-20 + approval lifecycle (Phases 6-7)

**Milestone Goal:** ERC-20 lifecycle (transfer, approve, revoke, WETH unwrap) and Aave V3 supply/withdraw work on Ethereum. Exercises the contract-call decode path AND the approval-class surfacing requirement (which becomes load-bearing for every protocol from here on). The agent-side ABI decode at preview time becomes load-bearing.

#### Phase 6: ERC-20 lifecycle (transfer + approve + revoke + WETH unwrap)
**Goal**: User can send any ERC-20 with decimal-correct amounts; can approve and revoke spenders with `⚠ UNLIMITED APPROVAL` surfacing on `2^256-1`; can unwrap WETH; preview surfaces the decoded args for each.
**Depends on**: Phase 5
**Requirements**: PREP-20, PREP-21, PREP-22, PREP-26, PREP-27, PREP-28, PREP-29, PREP-30
**Success Criteria** (what must be TRUE):
  1. `prepare_token_send({ to, tokenAddress, amount })` accepts decimal-string amounts (e.g. `"100.5"`) and resolves decimals from the token contract
  2. Off-by-decimal mistakes (passing wei when human units expected, or vice versa) caught at prepare time
  3. `preview_send` for an ERC-20 transfer surfaces the decoded `to` + `amount` (in human units) in `CHECKS PERFORMED`
  4. The Ledger device clear-signs ERC-20 transfers (it has the plugin); user sees decoded `To`, `Token`, `Amount` on-device
  5. `prepare_token_approve` accepts `amount: "max"` for `2^256-1`; `preview_send` labels unlimited approvals `⚠ UNLIMITED APPROVAL` and points at `prepare_revoke_approval`
  6. `prepare_revoke_approval` produces `approve(spender, 0)` and is a distinct named tool the agent can call by intent
  7. `prepare_weth_unwrap({ amount })` produces `WETH9.withdraw(amount)` against the canonical WETH address from `src/config/contracts.ts`
  8. Spender labels for `approve` resolved from a known-spender table; unknown spenders → `(unknown spender — no prior interaction recorded)`, never silent
**Plans**: 4 plans

Plans:
- [ ] 06-01: `get_token_metadata` + decimals/symbol resolution + decimal-amount parsing
- [ ] 06-02: `prepare_token_send` + ERC-20 ABI encoding + preview-time decoded-arg surfacing
- [ ] 06-03: `prepare_token_approve` + `prepare_revoke_approval` + approval-class surfacing in `CHECKS PERFORMED` + known-spender table
- [ ] 06-04: `prepare_weth_unwrap` + canonical WETH address SOT entry + WETH-specific decode

#### Phase 7: Aave V3 (Ethereum)
**Goal**: User can read Aave V3 positions and supply/withdraw assets; risk-tooling provides health-factor previews.
**Depends on**: Phase 6
**Requirements**: READ-20, PREP-23, PREP-24, PREP-25, READ-21
**Success Criteria** (what must be TRUE):
  1. `get_lending_positions` returns Aave V3 supplied + borrowed + health factor per position
  2. `prepare_aave_supply` and `prepare_aave_withdraw` produce unsigned Pool-contract calls that decode correctly on-device (Aave has a Ledger plugin)
  3. Aave Pool address sourced from `src/config/contracts.ts` single-source-of-truth table; regression-tested
  4. `simulate_position_change({ asset, deltaAmount })` previews the new health factor
  5. `check_contract_security({ address })` reports verification status + age + privileged-role enumeration
**Plans**: 4 plans

Plans:
- [ ] 07-01: `src/config/contracts.ts` SOT table for Aave V3 + chain-id keying + regression test
- [ ] 07-02: `get_lending_positions` reader (UiPoolDataProviderV3) + health-factor math
- [ ] 07-03: `prepare_aave_supply` + `prepare_aave_withdraw` + `simulate_position_change`
- [ ] 07-04: `check_contract_security` (Etherscan ABI + verified-source check + role enumeration)

---

### 📋 v1.2 Multi-EVM-chain + token resolution (Phase 8)

**Milestone Goal:** All v1.0 + v1.1 tools accept a `chain` parameter; tools work on Arbitrum, Polygon, Base, Optimism in addition to Ethereum. `resolve_token` and `get_token_allowances` land here because they become useful across chains (bridged variant disambiguation, multi-spender approval state).

#### Phase 8: Multi-EVM fan-out + token tooling
**Goal**: Every existing tool gets a `chain` parameter; chain-id assertion enforced at preview + send time. `resolve_token` disambiguates bridged variants. `get_token_allowances` enumerates outstanding ERC-20 allowances with the `[SET-LEVEL ENUMERATION]` block that becomes the source-of-truth for revoke-flow Inv #14 in v1.3.
**Depends on**: Phase 7
**Requirements**: READ-40, READ-41, READ-42, READ-43, READ-44, PREP-40, PREP-41, INST-40
**Success Criteria** (what must be TRUE):
  1. Every read tool accepts `chain: "ethereum" | "arbitrum" | "polygon" | "base" | "optimism"` and works against the configured RPC
  2. Every `prepare_*` tool requires the `chain` parameter (no default-pick); refusal carries the canonical chain-name list
  3. Chain-id is asserted at `preview_send` against the requested chain; mismatch refuses
  4. `get_portfolio_summary` aggregates across all 5 chains when `chain` is omitted
  5. `RPC_PROVIDER + RPC_API_KEY` config wires custom RPC for all 5 chains in one shot
  6. `resolve_token({ symbol: "USDC", chain: "polygon" })` returns canonical USDC vs USDC.e disambiguation with origin-chain hints
  7. `get_token_allowances({ wallet, chain })` enumerates outstanding allowances with per-row `isUnlimited` / `spenderLabel` / `lastSeenBlock`; response carries verbatim `[SET-LEVEL ENUMERATION]` block
**Plans**: 4 plans

Plans:
- [ ] 08-01: Multi-chain RPC client + per-chain config + provider-shorthand (`infura` / `alchemy`) wiring
- [ ] 08-02: `chain` param threading through every read + prepare tool + chain-id assertion at preview/send
- [ ] 08-03: `get_portfolio_summary` cross-chain aggregation + per-chain Aave Pool address fan-out
- [ ] 08-04: `resolve_token` + bridged-variant table + `get_token_allowances` + `[SET-LEVEL ENUMERATION]` block emission

---

### 📋 v1.3 Hardening + companion skill (Phase 9)

**Milestone Goal:** The `vaultpilot-preflight` companion skill ships; three distinct verification tools land (`get_verification_artifact`, `verify_tx_decode`, `get_tx_verification`); dispatch-target allowlist enforced server-side; chain-must-be-explicit invariant codified in the skill.

#### Phase 9: Hardening
**Goal**: Close the residual-risk gaps that v1.0–v1.2 explicitly carry. The compromised-MCP threat model gets a load-bearing defense (the skill); the coordinated-agent threat model gets a narrower gap (second-LLM); the narrow-agent decode-lie threat gets an inline server-side cross-check (`verify_tx_decode`).
**Depends on**: Phase 8
**Requirements**: SEC-30..38
**Success Criteria** (what must be TRUE):
  1. Companion `vaultpilot-preflight` skill ships at a sister repo with `SKILL.md` + integrity sentinel + Step 0 mandatory self-check
  2. Server pins skill SHA-256 in `instructions`; tamper or skill-not-installed surfaces a `VAULTPILOT NOTICE` block on first tool response
  3. Skill encodes invariants #1, #2, #2.5, #5, #11; agent halts with `DO NOT SIGN.` on hash divergence
  4. `get_verification_artifact({ handle })` returns sparse JSON + `pasteableBlock` with explicit copy markers; canned second-LLM prompt instructs out-of-band decode from scratch
  5. `verify_tx_decode({ handle, claimedDecode })` server-side cross-check: agent passes its own decoded view, server returns `{ ok }` or `{ ok: false, divergences: [...] }`
  6. `get_tx_verification({ handle })` re-emits VERIFY-BEFORE-SIGNING + tx JSON for 15 minutes (context-eviction recovery)
  7. Outer dispatch-target allowlist (Inv #1.a) enforced for Aave / WETH / 1inch / LiFi at server-side; mismatch refuses
  8. WC session-topic cross-check surfaced in `get_ledger_status` and every signing flow
**Plans**: 5 plans

Plans:
- [ ] 09-01: Sister repo `vaultpilot-preflight-skill` + `SKILL.md` + Step 0 integrity self-check + invariants #1/#2/#2.5/#5/#11
- [ ] 09-02: Server-side skill SHA-256 pin + `VAULTPILOT NOTICE` block on missing/tampered skill + dedup-per-session
- [ ] 09-03: `get_verification_artifact` + `pasteableBlock` shape + canned second-LLM prompt
- [ ] 09-04: Dispatch-target allowlist (`src/security/canonical-dispatch.ts`) + per-tool wiring + regression tests
- [ ] 09-05: `verify_tx_decode` (server-side decode cross-check) + `get_tx_verification` (15-min handle re-emit) + verification-tool routing docs

---

### 📋 v1.4 Distribution (Phase 10)

**Milestone Goal:** Bundled binaries per platform; install scripts; setup wizard; capability-request tool.

#### Phase 10: Distribution + ergonomics
**Goal**: A user without Node can install via shell-installer one-liner. A user with Node gets a setup wizard for keys + Ledger pairing.
**Depends on**: Phase 9
**Requirements**: DIST-40..43
**Success Criteria** (what must be TRUE):
  1. GitHub Releases publish per-platform binaries (linux-x64, macos-x64, macos-arm64, windows-x64); linux-arm64 falls back to `use npm` message
  2. `install.sh` (curl pipe to bash) detects OS+arch, downloads binary, runs setup wizard, registers with detected MCP clients
  3. `install.ps1` (PowerShell) does the same on Windows
  4. `vaultpilot-mcp setup` wizard prompts for RPC keys, optionally pairs Ledger, writes `~/.vaultpilot-mcp/config.json`
  5. `request_capability({ title, body })` produces a pre-filled GitHub issue URL; rate-limited 3/hour
**Plans**: 4 plans

Plans:
- [ ] 10-01: Build pipeline for per-platform binaries (`pkg` or `bun build`) + GitHub release workflow
- [ ] 10-02: `install.sh` + `install.ps1` + `InstallEnvelope` JSON output + idempotency
- [ ] 10-03: `vaultpilot-mcp setup` wizard (interactive + `--non-interactive --json` mode) + config.json writer
- [ ] 10-04: `request_capability` tool + pre-filled URL builder + 3/hour rate limit

---

### 📋 v2.0+ Future Milestones (Planned)

Each is sized as one milestone (4-6 phases). All blocked on v1.4 distribution maturity.

- **v2.0 Solana** — SOL/SPL balances, MarginFi + Kamino lending, Jupiter v6 swaps, Marinade / Jito (deposit only — unstake gap) / native staking, LiFi-routed EVM↔Solana bridging. USB-HID transport (no WC). Per-wallet durable-nonce account. Mandatory `simulateTransaction` gate at preview.
- **v2.1 TRON** — TRX + canonical TRC-20 balances + transfers + Stake 2.0 + SunSwap (same-chain swap) + LiFi-routed TRON↔EVM bridging + TRC-20 approve. USB-HID transport. Ledger TRON app clear-signs every supported action.
- **v2.2 Bitcoin + Litecoin** (one milestone — shared Esplora + Ledger BTC infra) — Native + segwit + taproot sends, BIP-125 RBF, PSBT multisig (combine / sign / finalize), BIP-137 message signing, LiFi-routed BTC→EVM/Solana, optional Bitcoin Core / Litecoin Core JSON-RPC for forensic chain reads (chain tips, mempool census, fee percentiles), `build_incident_report` chain-tip + mempool-anomaly bundle. USB-HID via Ledger BTC app.
- **v2.3 EVM lending + staking expansion** — Compound V3 (multi-Comet), Morpho Blue, Lido (stake / unstake / wrap stETH↔wstETH), EigenLayer, Rocket Pool. Each protocol as a phase.
- **v2.4 EVM DEX + LP + escape hatch** — Uniswap V3 swap + full LP verb set (mint / increase / decrease / collect / burn / rebalance), Curve (swap + add liquidity, v0.2 follow-ups deferred), `prepare_custom_call({ acknowledgeNonProtocolTarget: true })` escape hatch with `get_contract_abi` + `read_contract` companions.
- **v2.5 Safe (Gnosis) multisig** — `prepare_safe_tx_propose` / `_approve` / `_execute` + `submit_safe_tx_signature`; Tx Service API integration; `enableModule` / `delegateCall: true` flagged for hard-trigger second-LLM check.
- **v2.6 Bridge facet decoders + cross-chain hardening** — Tier-1 (Wormhole / Mayan / NEAR Intents / Across V3) facet decoders for Inv #6b; Tier-2 (deBridge / Stargate composeMsg / Hop / Symbiosis) deferred until usage data justifies; sandwich-MEV slippage hint per-L2 thresholds.
- **v3.0 Hosted MCP** — HTTP/SSE transport, OAuth 2.1, operator-supplied API keys, multi-tenant. Unblocks claude.ai chat (web + native desktop). TRON/Solana/BTC/LTC USB-HID signing stays on local-stdio path regardless.
- **v3.1 NFT reads** — `get_nft_portfolio` (cross-chain, Helius DAS for Solana), `get_nft_collection`, `get_nft_history`, `get_nft_listings` (EVM only); floor pricing via Magic Eden + Tensor (Solana) / Reservoir + OpenSea (EVM). Read-only browsing — marketplace fills (Seaport / Blur) deferred until typed-data signing surface lands.
- **v3.2 Contacts + read-only sharing** — Local Ledger-signed address book, scoped read-only portfolio links, anonymized strategy sharing.
- **v3.3 Device-trust attestation** — `verify_ledger_attestation` (Secure Element challenge), `verify_ledger_firmware` (version pin), `verify_ledger_live_codesign` (binary signature check).
- **v3.4 Ergonomics surface** — `get_pnl_summary`, `get_portfolio_diff`, `get_daily_briefing`, `compare_yields`, `explain_tx`, multi-protocol `get_health_alerts`. Not load-bearing for the trust pipeline; raises the day-to-day floor.
- **v3.5 Multi-hardware-wallet** — Trezor, Keystone, GridPlus Lattice.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Server skeleton + install | v1.0 | 3/3 | Complete (verify-phase open) | 2026-05-12 |
| 2. Ethereum read-only portfolio | v1.0 | 4/4 | Complete (verified end-to-end against PublicNode) | 2026-05-12 |
| 3. WalletConnect pairing | v1.0 | 0/2 | Not started | - |
| 4. Native ETH send (the trust pipeline) | v1.0 | 0/5 | Not started | - |
| 5. Demo mode + diagnostics | v1.0 | 0/3 | Not started | - |
| 6. ERC-20 lifecycle (transfer + approve + revoke + WETH unwrap) | v1.1 | 0/4 | Not started | - |
| 7. Aave V3 (Ethereum) | v1.1 | 0/4 | Not started | - |
| 8. Multi-EVM fan-out + token tooling | v1.2 | 0/4 | Not started | - |
| 9. Hardening (skill + three verification tools + dispatch allowlist) | v1.3 | 0/5 | Not started | - |
| 10. Distribution + ergonomics | v1.4 | 0/4 | Not started | - |
