# Roadmap: VaultPilot MCP (GSD-inspired)

## Overview

The journey: a working trust pipeline first (one chain, one signing flow, end-to-end), then chain/protocol breadth on top of a proven pipeline. Each milestone ships a self-contained vertical slice the user can install and exercise. The verification phase at every milestone walks the full prepare → preview → sign → broadcast path, surfacing pipeline bugs at the cheapest moment to fix them.

## Milestones

- 🟡 **v1.0 MVP** — Phases 1-5 **code-complete**; combined Phase 3+4+5 verify-phase is the ship gate (real Ledger + small mainnet broadcast + auto-demo + persona rehearsal + diagnostics)
- 🟡 **v1.1 Aave + ERC-20 lifecycle** — Phases 6 + 7 **code-complete** (ERC-20 lifecycle + Aave V3 Ethereum); v1.1 verify-phase open
- 🟡 **v1.2 Multi-EVM + token tooling** — Phase 8 **code-complete** (5 EVM chains + `resolve_token` + `get_token_allowances`); v1.2 verify-phase open
- 🟡 **v1.3 Hardening + skill** — Phase 9 **code-complete** (companion skill in sister repo, three verification tools, dispatch allowlist); v1.3 verify-phase open
- 🟡 **v1.4 Distribution** — Phase 10 **code-complete** (per-platform binaries + install scripts + setup wizard + `request_capability` tool); v1.4 verify-phase open; v1.4.1 follow-up for pkg ESM subpath-exports resolution
- 🟡 **v2.0 Solana** — Phases 11 + 12 **code-complete** (USB-HID transport + persistent non-EVM account cache + SOL/SPL reads + curated Solana whale persona; SOL + SPL trust pipeline with `VaultPilot-soltx-v1:` domain-tagged `payloadFingerprint` + mandatory `simulateTransaction` Layer 0.7 gate + USB-HID direct broadcast); Phases 13-16 planned (MarginFi + Kamino lending / Jupiter v6 swaps / Marinade + Jito + native staking / LiFi bridging + diagnostics)
- 🟢 **v2.1 TRON** — Phases 17 + 18 + 19 + 20 (SunSwap only) + 21 **code-complete** (USB-HID transport + TRX reads + TRC-20 registry + DefiLlama TRON pricing + multi-chain portfolio TRON leg + curated TRON whale persona; native TRX + TRC-20 trust pipeline with `VaultPilot-trontx-v1:` domain-tagged `payloadFingerprint` + SHA-256 presign-hash = TRON consensus tx-id = Ledger TRX-app blind-sign display + asymmetric Layer 0.7 simulation gate (TRC-20 mandatory refusal, native advisory) + `extendExpiration(tx, 900)` aligning broadcast window to handle TTL; Phase 19 TRC-20 approve + revoke + Stake 2.0 freeze/unfreeze/withdraw-expire/vote/claim — 7 new MCP tools + Fixtures Tron-19-{A,B,C,D} + `KNOWN_SPENDERS_TRON` allowlist + SR registry hybrid live+snapshot + asymmetric Layer 0.7 mandatory refusal on withdraw-expire via on-chain account-state read; Phase 20 SunSwap V2 same-chain swaps — `get_sunswap_quote` + `prepare_sunswap_swap` + sandwich-MEV defense at >2% price impact via `INVALID_INPUT + hintTool` (keeps 21-code error union FROZEN) + NEW `TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST` sibling set in canonical-dispatch-tron + Fixture Tron-20-A; Phase 21 `get_tron_setup_status` MCP diagnostic — per-wallet Stake 2.0 frozenV2 Energy + Bandwidth separate fields + on-device address verify + Ledger TRX-app version probe + 3 independent demote-to-null arms + lazy probe (no boot RPC) + SECURITY.md §6 v2.1 milestone close-out summary). **v2.1 verify-phase pending** (real-Ledger USB-HID TRON-app small-amount mainnet broadcast — native TRX + TRC-20 transfer + Stake 2.0 freeze + claim-rewards). **LiFi TRON-W-11 + TRON-W-12 LiFi portion DEFERRED to v2.2.x per Phase 20 D-04b** — LiFi has no TRON deployment as of 2026-05-21, verified via live API + GitHub manifest + quote endpoint; LiFi reschedules with v2.2.x BTC-LIFI-01 (when LiFi confirms TRON deployment)
- 🟡 **v2.2 Bitcoin + Litecoin** — Phase 22 **code-complete** (BTC scaffolding — Esplora reads + USB-HID Ledger BTC app pairing + persistent dual-record cache under `chain: "bitcoin"` for segwit + taproot; 9 new tools — `pair_btc_ledger` / `get_btc_status` / `get_btc_balance` / `get_btc_balances` / `get_btc_account_balance` / `get_btc_tx_history` / `get_btc_fee_estimates` + BTC whale demo persona + `btcEsploraConfigured` config-status surfacing; UTXO-shape `BalanceReport` discriminated union load-bearing for Phase 23 coin-selection; BIP-32 Test Vector first-5-derivations hardcoded `bc1q…` + `bc1p…` literal anchors; `Psbt` import explicitly forbidden); v2.2 verify-phase pending real-Ledger USB-HID BTC-app smoke (bundled with Phase 17/21 deferred items per 2026-05-16 directive); Phases 23-27 planned (native segwit + taproot PSBT trust pipeline / BIP-125 RBF + BIP-137 / PSBT multisig / LTC + LiFi BTC bridging / Core RPC + incident report)
- 🟡 **v2.3 EVM lending + staking expansion** — Phase 28 **code-complete** (Compound V3 multi-Comet supply / withdraw / borrow / repay on Ethereum mainnet — 6 Comets in SOT; MAX_UINT256 sentinel for repay-all; `INVALID_INPUT + hintTool` intent-vs-reality gates); Phases 29-31 planned (Morpho Blue / Lido wrap / EigenLayer + Rocket Pool); multi-chain Compound (Polygon/Arbitrum/Base/Optimism) deferred to v2.3.x
- 📋 **v2.4 EVM DEX + LP + escape hatch** — Phases 32-35 planned (Uniswap V3 swap / Uniswap V3 LP / Curve / `prepare_custom_call`)
- 📋 **v2.5 Safe (Gnosis) multisig** — Phases 36-38 planned (Safe positions + Tx Service / three-step signing flow / `enableModule` + `delegateCall` hard-trigger second-LLM)
- 📋 **v2.6 Bridge facet decoders + cross-chain hardening** — Phases 39-40 planned (Tier-1 facet decoders + Inv #6b final-recipient assertion / sandwich-MEV per-L2 thresholds; Tier-2 facets explicitly deferred)
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

- [x] 04-01: Handle store (in-memory, 15-min TTL) + `payloadFingerprint` computation + `PREPARE RECEIPT` block emission — PR #12
- [x] 04-02: `prepare_native_send` tool + nonce/gas/fee resolution + EIP-1559 tx structure — PR #13
- [x] 04-03: `preview_send` tool + `previewToken` UUID minting + pre-sign hash recompute + `LEDGER BLIND-SIGN HASH` block + agent-task block — PR #15
- [x] 04-04: `send_transaction` tool + `previewToken` + `userDecision` gate + WC `eth_sendTransaction` forwarding + Ledger response handling — PR #16
- [x] 04-05: 4byte.directory client (best-effort) + `get_tx_verification` re-emit tool + cross-check summary block — PR #14

**Status**: code-complete; combined Phase 3+4 verify-phase pending real-Ledger smoke + small mainnet broadcast + `WALLETCONNECT_PROJECT_ID` from cloud.walletconnect.com. Also resolves Assumption A1 (Ledger blind-sign hash display form) + A2 (Ledger Live Connected Apps UI).

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

- [x] 05-01: Demo-mode runtime flag resolution (env > config > auto-detect) + curated persona registry + `set_demo_wallet` state — PR #19
- [x] 05-02: Demo-mode signing intercepts (Q-CONTRADICTION-PREP Option B — `prepare_native_send` + `preview_send` succeed in demo via persona address; `send_transaction` simulates) + simulation envelope shape — PR #20
- [x] 05-03: `get_vaultpilot_config_status` + `get_ledger_device_info` + once-per-session update check + auto-demo first-response NOTICE dispatcher-wrap + INSTRUCTIONS rewrite — PR #21

**Status**: code-complete; **v1.0 MVP feature set DONE** (Phases 1-5 cover INST + READ + PAIR + PREP + DEMO + DIAG entire requirement set). Combined Phase 3+4+5 verify-phase is the v1.0 ship gate.

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

- [x] 06-01-PLAN.md — `get_token_metadata` + `parseAmountStrict` (load-bearing decimal guard in `src/signing/amount.ts`, DF-2) + Fixture B literal anchor — PR #28
- [x] 06-02-PLAN.md — `prepare_token_send` + `src/protocols/erc20.ts` (first `src/protocols/` occupant) + preview-time decoded-arg surfacing + wide `eth_call` simulation helper (DF-1) + Fixture D — PR #29
- [x] 06-03-PLAN.md — `prepare_token_approve` + `prepare_revoke_approval` (distinct tool name, shared internal helper, byte-identity invariant) + `⚠ UNLIMITED APPROVAL` strict-equality surfacing + `src/config/contracts.ts` SOT (first occupant, 11 KnownSpender entries; 12th slot reserved for Phase 7 Aave) + Fixture E — PR #30
- [x] 06-04-PLAN.md — `prepare_weth_unwrap` + `src/protocols/weth9.ts` + canonical WETH SOT migration (closes T-CONFIG-LITERAL-MIGRATION-1) + LEDGER NOTICE block (A2 defense) + Fixture F + full ERC-20 lifecycle integration test (persona-cycle `from`-independence) — PR #31

**Status**: code-complete; v1.1 verify-phase pending (real-Ledger ERC-20 transfer + approve + WETH unwrap against mainnet; resolves A2 — Ledger CAL clear-sign coverage for WETH9.withdraw in 2026-05).

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

- [x] 07-01-PLAN.md — `src/config/contracts.ts` SOT extension: 5 Aave V3 typed slots (Pool + PoolAddressesProvider + UiPoolDataProviderV3 + AaveOracle + IncentivesController) + 5 getters + regression test. `KNOWN_SPENDERS_ETHEREUM` unchanged (Aave V3 Pool already at row 0 per 06-03) — PR #34
- [x] 07-02-PLAN.md — `get_lending_positions` reader (UiPoolDataProviderV3) + sibling-shelf helper `src/chains/aave-v3.ts` (parseAbi struct refs) + pure-bigint health-factor math `src/signing/aave-health.ts` — PR #35
- [x] 07-03-PLAN.md — `prepare_aave_supply` + `prepare_aave_withdraw` (mechanical clones of `prepare_weth_unwrap`) + `simulate_position_change` (4-action enum supply/withdraw/borrow/repay) + `src/protocols/aave-v3.ts` + `preview_send` selector-dispatch extension + Fixtures G/H + lifecycle integration test. **NO LEDGER NOTICE for Aave** (research § Topic 6 verified clear-sign coverage) — PR #37
- [x] 07-04-PLAN.md — `check_contract_security` (Etherscan V2 unified-API; verified-source + age + proxy + privileged-role enumeration) + `src/clients/etherscan.ts` (5-arm discriminated union + per-session rate-limit) + `ETHERSCAN_API_KEY` lazy env helper + `etherscanApiKeyPresent` boolean in `get_vaultpilot_config_status`. Parallel-eligible with 07-03 — PR #36

**Status**: code-complete; v1.1 verify-phase pending (real-Ledger Aave supply + withdraw against mainnet; resolves A2 health-factor math vs Aave UI within 1 bps + reconfirms Aave Ledger CAL clear-sign coverage at sign-time).

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
  8. WalletConnect pairing proposal includes every configured chain; Ledger Live's account picker surfaces Base / Polygon / Arbitrum / Optimism accounts when their networks are enabled in LL

**Plans**: 5 plans

Plans:

- [x] 08-01-PLAN.md — `src/chains/registry.ts` multi-chain RPC factory + `ChainId` literal-union widening (`1 | 42161 | 137 | 8453 | 10`) + `Record<ChainId, ContractsForChain>` cross-chain SOT extension (5 chains × 5 typed Aave V3 slots) + per-chain RPC env readers + provider-shorthand resolution (`infura` / `alchemy` / custom) + `configuredChains` diagnostic boolean in `get_vaultpilot_config_status`. Compat shim deletion deferred (3 importers including FROZEN `send_transaction.ts`) — PR #41
- [x] 08-02-PLAN.md — `chain` Zod-enum threading through 13 tools (REQUIRED on `prepare_*`, OPTIONAL with `"ethereum"` default on read tools per DF-1) + chain-id assertion at `preview_send` (T-CHAIN-MISMATCH-1) + 6 PREPARE RECEIPT `{CHAIN}` slot widening + `CHAIN_ID_MISMATCH` errorCode 15 + Fixture J chain-distinctness property test (`new Set(fps).size === 5`, NOT a literal pin per RESEARCH § Topic 9). Layer 2 refusal at `preview_send` ONLY (FROZEN `send_transaction.ts` blocks dual-site placement; Layer 3 fingerprint-drift catches the `send_transaction` case). `check_contract_security` runtime-rejects non-ethereum (FROZEN `clients/etherscan.ts` has no per-chain `chainid` plumbing). Carve was grep-driven not TS-compiler-driven (08-01 SUMMARY § Hooks enumerated 33 hits across 9 files) — PR #42
- [x] 08-03-PLAN.md — `get_portfolio_summary` cross-chain aggregation via `Promise.allSettled` with per-chain `AbortController` 10s timeout + per-chain Aave Pool address fan-out (Aave V3 Pool identical on Arbitrum/Polygon/Optimism `0x794a61358D…`; Ethereum + Base distinct) + 4 new per-chain top-50 token JSON registries (`src/tokens/{arbitrum,polygon,base,optimism}-top-50.json` — 161 curated entries) + `loadTokenRegistry(chainId)` finalization + `NATIVE_PRICING_PROXY` table (WMATIC for Polygon native MATIC pricing; Rule 2 auto-add caught at execute-time by Test 1). Compat-shim importers 3 → 2 — PR #43
- [x] 08-04-PLAN.md — `resolve_token` (curated bridged-variant table — 23 symbols × 5 chains = 73 rows; USDC vs USDC.e + WETH variants; addresses cross-verified against Circle / Optimism / Arbitrum / MakerDAO docs) + `get_token_allowances` (event-log scan via `publicClient.getLogs` + multicall cross-check + 10k-block chunked pagination; 1M-block lookback default per DF-2, configurable; `[SET-LEVEL ENUMERATION]` block schema — load-bearing for v1.3 Inv #14 in `vaultpilot-preflight`) + `SET_LEVEL_ENUMERATION_TEMPLATE` in `src/signing/blocks.ts` + T-LOGS-CEILING-1 (surface `lookbackBlocks` + warn at ceiling). Etherscan V2 negative finding (no token-approvals endpoint per RESEARCH § Topic 7) — event-log scan is the only path. SET-LEVEL ENUMERATION inner format = per-row line-stable (not columnar — 42-char addresses + 78-digit MAX_UINT256 won't fit any column width without truncation) — PR #44
- [x] 08-05-PLAN.md — WalletConnect proposal namespace expansion — `REQUIRED_NAMESPACES.eip155.chains` driven by `configuredChains` from 08-01 (replaces hardcoded `["eip155:1"]` in `src/wallet/session-manager.ts:57-59`) + `sessionToStatus` multi-chain accounting (removes the multi-chain-refusal at lines 626-632) + `accountsByChain` + `activeChainId` + `partiallyPaired` fields on `LedgerStatus` (T-WC-PARTIAL-1) + `set_active_account` per-chain scope widening (chain arg OPTIONAL per plan body, with stderr deprecation on legacy calls). Surfaced during physical-device testing — LL only offered Ethereum accounts even when Base/Polygon were enabled in Ledger Live — PR #45

**Status**: code-complete; v1.2 verify-phase pending (real-Ledger multi-chain pairing smoke against mainnet — resolves A4 PublicNode `eth_getLogs` ceiling + A5/A6 Ledger Live multi-chain account picker behavior). Compat shim `src/chains/ethereum.ts` survives with 2 importers (FROZEN `send_transaction.ts` + out-of-scope `ens/resolver.ts`) — deletion deferred to a follow-up cleanup that addresses the FROZEN constraint and migrates the ENS resolver.

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

- [x] 09-01-PLAN.md — Sister repo `vaultpilot-preflight-skill` bootstrap (`gh repo create szhygulin/vaultpilot-preflight-skill --private` autonomous mandate) + SKILL.md (BUSL-1.1) + Step 0 self-check + invariants #1/#2/#2.5/#5/#11/#14 encoded. Sister-repo CI `.github/workflows/ci.yml` deferred (gh OAuth lacks `workflow` scope; user `gh auth refresh -s workflow` to complete). v1.3.0 tag deferred to coordinated 09-02 step per plan-checker W-1 — PR #48
- [x] 09-02-PLAN.md — `src/security/skill-integrity.ts` SHA-256 lazy probe (Node `crypto`, personal + project scope probe) + `VAULTPILOT_NOTICE_TEMPLATE` (missing + tampered variants) in `src/signing/blocks.ts` APPEND-ONLY + dispatcher-wrap NOTICE prepend at `server.ts` with `skillNoticeEmitted` dedup flag set BEFORE return (race-defense) + INSTRUCTIONS field surfaces `EXPECTED_SKILL_SHA256 = 28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2` (single SOT — server.ts template-literal-interpolates) + sister-repo v1.3.0 tag created in coordinated step (resolves W-1) + Step 0 self-reference fix in 09-01-SKILL-TEMPLATE.md (SHA-256 has no fixpoint by avalanche property; SHA echo lives in README only) — PR #49
- [x] 09-03-PLAN.md — `get_verification_artifact({ handle })` tool + sparse JSON structuredContent + `pasteableBlock` byte-stable 32-line template (Test 1 fixture-pinned via independent `node -e` computation; NOT `beforeAll`-snapshot per CLAUDE.md) + canned second-LLM prompt for out-of-band decode. Tool NOT yet MCP-routable until 09-05's register-all consolidation per PATTERNS § 3 carve coordination — PR #50
- [x] 09-04-PLAN.md — `src/security/canonical-dispatch.ts` parallel `CANONICAL_DISPATCH_TARGETS` per-chain table (5 chains × 4 canonical Aave/WETH/1inch/LiFi + per-chain BRIDGED_VARIANTS via option (b) PARTIAL — T-ERC20-TOKEN-COMPATIBILITY-1 mitigation preserves Phase 6 lifecycle) + Layer 0.5 wiring at `preview_send.ts:159-191` (AFTER handle lookup, BEFORE Phase 8 Layer 2 at `:193-211`; T-DISPATCH-ALLOWLIST-1 ordering invariant) + `DISPATCH_TARGET_REFUSED` errorCode + `DISPATCH_TARGET_REFUSAL_TEMPLATE`. EIP-55 checksum drift on 1inch V6 literal re-keyed to canonical viem form — PR #51
- [x] 09-05-PLAN.md — `verify_tx_decode({ handle, claimedDecode })` 3-arm discriminated union (`ok | divergence | decode-unsupported`; tighter than `check_contract_security`'s 5-arm; single-SOT decoder reuse per T-DECODER-SINGLE-SOT-1; WEI-string compare per option (c)) + `get_tx_verification` v1.3 additive `txJson` + `sessionTopicLast8` + `dispatchCheckResult` (existing fields byte-identical) + sessionTopicLast8 surfacing across 4 tool responses (T-WC-TOPIC-DRIFT-1) + register-all consolidation closing 09-03's deferral (both `verify_tx_decode` and `get_verification_artifact` now MCP-routable). `send_transaction.ts` three-gate FROZEN region byte-verified intact; 9 added lines all within SUCCESS structuredContent — PR #52

**Status**: code-complete; v1.3 verify-phase pending (real-Ledger smoke against mainnet, exercising compromised-MCP defenses via the skill — install `git clone https://github.com/szhygulin/vaultpilot-preflight-skill ~/.claude/skills/vaultpilot-preflight && git checkout v1.3.0`). Sister-repo CI workflow loose-end documented (user runs `gh auth refresh -s workflow` to complete; not blocking v1.3 functionality).

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

- [x] 10-01-PLAN.md — `@yao-pkg/pkg@^6.19.0` binary build pipeline (DF-1 locked) + `package.json` scripts.build:binary with `--fallback-to-source` for ESM-to-CJS edge in `src/server.ts:69` + `release.yml.template` shipped as planning artifact (gh OAuth `workflow` scope missing — recovery via `gh auth refresh -s workflow` + cp template) + per-asset SHA-256 sums + combined SHA256SUMS index + bundled Plan 09-05 self-test fix (was `git diff origin/main` self-defeating post-merge). v1.4.1 follow-up: pkg snapshot fs ignores `@modelcontextprotocol/sdk` subpath `exports` field → binaries fail at runtime with ERR_MODULE_NOT_FOUND. Recovery: `pkg.sea=true` backend swap OR package.json `imports` field map — PR #55
- [x] 10-02-PLAN.md — `install.sh` 262 lines POSIX bash with arp242 `main() {}; main "$@"` wrap + SHA-256 verify BEFORE extract (T-SHA256-VERIFY-BEFORE-EXTRACT-1) + idempotency via existing-binary-SHA check + macOS quarantine `xattr -d com.apple.quarantine` interactive offer + InstallEnvelope JSON via `--json` flag + `install.ps1` 176 lines PowerShell with `Get-FileHash` + `Unblock-File` NOTICE + HKCU PATH-append + `src/diagnostics/install-envelope.ts` APPEND 4 CheckIds in separate comment block from 10-03's additions (T-INSTALL-ENVELOPE-COMPAT-1 — ENVELOPE_VERSION unchanged) — PR #58
- [x] 10-03-PLAN.md — `src/cli/` shelf NEW 5 files (setup.ts + setup-prompts.ts + setup-non-interactive.ts + setup-mcp-clients.ts + setup-schema.ts) + `vaultpilot-mcp setup` CLI subcommand with `@clack/prompts@^1.4.0` interactive flow (DF-2 locked) + `--non-interactive --json` stdin reader + Zod schema SOT shared by both paths (T-WIZARD-SCHEMA-SOT-1) + MCP client auto-registration (Claude Code + Claude Desktop + Cursor) + ADDITIVE `writeConfigFile()` in `src/config/config-file.ts` AFTER line 95 (lines 1-95 byte-frozen Plan 05-03 surface) + T-CONFIG-LEAK-1 3-sentinel API-key substring scan. 3rd recurrence of subagent-cwd discipline pattern (Phase 7 planner + Phase 8 researcher + Phase 10-03 executor) — recovered cleanly via main-worktree revert — PR #56
- [x] 10-04-PLAN.md — `request_capability` MCP tool (`src/tools/request_capability.ts`) + URL builder via `URLSearchParams` (WHATWG; repo `szhygulin/vaultpilot-mcp-gsd-inspired`; labels `capability-request`) + 7KB body cap with truncation-to-local-file fallback at `~/.vaultpilot-mcp/capability-requests/<timestamp>.md` (T-CAPABILITY-BODY-CAP-1) + sliding-window 3/hour in-memory rate limit (`src/security/request-capability-rate-limit.ts` mirroring Phase 9 `_skillIntegrity` spy-affordance shape; T-CAPABILITY-RATE-LIMIT-1) + `RATE_LIMIT_EXCEEDED` errorCode 20 + register-all import + tool DESCRIPTION includes literal `"NEVER auto-submits"` (T-CAPABILITY-AUTO-SUBMIT-1; DIST-43 lock) — PR #57

**Status**: code-complete; v1.4 verify-phase pending (one-line install + setup wizard + binary smoke against real macOS / Windows / Linux). **v1.x is fully CODE-COMPLETE after this phase.** Two loose-ends documented as accepted residuals: (1) v1.4.1 follow-up for pkg ESM `@modelcontextprotocol/sdk` subpath-exports resolution gating v1.4.0 GA tag (recovery options documented in 10-01 SUMMARY); (2) gh OAuth `workflow` scope (recurrence from Phase 9 09-01) — user runs `gh auth refresh -s workflow` then installs `.github/workflows/release.yml` from `.planning/phases/10-…/release.yml.template`.

---

### 📋 v2.0 Solana (Phases 11-16)

**Milestone Goal:** A user can install the MCP, pair a Ledger over USB-HID (no WalletConnect — Solana has no WC v2 bridge to Ledger), read SOL + SPL balances + MarginFi + Kamino positions, swap on Jupiter v6, stake on Marinade / Jito / native SOL validators, and bridge between EVM and Solana via LiFi. The full prepare → preview → send trust pipeline is reused, with Solana-specific primitives layered in: serialized-transaction-message `payloadFingerprint`, mandatory `simulateTransaction` gate at preview, per-wallet durable-nonce setup, and a new persistent non-EVM account cache that mirrors v1.x WC-session persistence (PR #61) so paired Solana / TRON / BTC / LTC accounts survive MCP restart.

#### Phase 11: Solana scaffolding — USB-HID transport + SOL reads + persistent non-EVM account cache

**Goal**: USB-HID Ledger pairing for Solana works; SOL + SPL balances readable via a free public RPC; paired non-EVM accounts persist to `~/.vaultpilot-mcp/non-evm-accounts.json` and restore on MCP restart (mirroring the v1.x WC-session-persistence pattern from PR #61). Demo mode extends with a curated Solana persona.
**Depends on**: Phase 10 (v1.x distribution complete)
**Requirements**: PAIR-NEV-01, PAIR-NEV-02, PAIR-NEV-03, PAIR-NEV-04, PAIR-NEV-05, SOL-01, SOL-02, SOL-03, SOL-04, SOL-05
**Success Criteria** (what must be TRUE):

  1. `pair_solana_ledger()` opens the Ledger Solana app over USB-HID via `@ledgerhq/hw-transport-node-hid` + `@ledgerhq/hw-app-solana`, returns the Solana base58 address verbatim plus a `VERIFY-ON-DEVICE` block instructing the user to confirm the address on the Ledger screen
  2. `get_solana_status()` returns `{ paired: true, address, derivationPath, rpcEndpoint }` after a successful pair
  3. `get_solana_balance({ wallet })` returns native SOL balance (lamports + SOL formatted) against a free public RPC (default `https://api.mainnet-beta.solana.com`; override via `SOLANA_RPC_URL`)
  4. `get_solana_token_balance({ wallet, mint })` returns SPL token balance + decimals + USD value (DefiLlama prices, `solana:<mint>` keying)
  5. `get_solana_portfolio_summary({ wallet })` aggregates SOL + SPL balances + USD totals; ERC-20-equivalent SPL discovery via a curated top-50-by-volume Solana-mainnet mint registry
  6. Paired Solana account persists to `~/.vaultpilot-mcp/non-evm-accounts.json` (0o700 dir, 0o600 file) under a `chain: "solana"` record key
  7. On MCP restart, `startServer()` eager-loads the persisted accounts via `loadNonEvmAccounts()` BEFORE `server.connect(transport)` (race-defense — mirrors PR #61's WC eager-init pattern); `get_solana_status()` returns `paired: true` on first call without requiring a re-pair
  8. `VAULTPILOT_NON_EVM_STORAGE=memory` opt-out disables disk persistence (mirrors `VAULTPILOT_WC_STORAGE=memory` from quick task 260513-c8e)
  9. `list_paired_non_evm_accounts()` returns the in-memory record set; `remove_paired_non_evm_account({ chain, address })` removes a single entry and rewrites the file atomically
  10. Stale-session detection: on restore, accounts whose `pairedAt` timestamp is older than 30 days surface in `get_solana_status` with `staleAccountWarning: true`; user-action hint to re-pair
  11. Multi-chain `get_portfolio_summary` extends to fan out across EVM (existing) + Solana (new) when both are configured; per-row `chain: "solana"` field
  12. Demo mode adds a curated Solana persona (e.g. a known SOL whale); `set_demo_wallet({ persona })` accepts the new persona name and routes Solana reads to the persona's mainnet address
  13. `get_vaultpilot_config_status` surfaces `solanaRpcConfigured` + `pairedNonEvmChains` (array of chain names; never raw addresses) + `nonEvmStoragePersistent` booleans/counts only

**Plans**: 6 plans

Plans:

- [x] 11-01: `src/wallet/non-evm-account-store.ts` + `src/config/non-evm-storage.ts` — JSON-backed at `~/.vaultpilot-mcp/non-evm-accounts.json`; per-chain record schema (`chain`, `address`, `derivationPath`, `pairedAt`, `displayName?`); `_storage` spy-affordance indirection mirroring `session-manager.ts`; `VAULTPILOT_NON_EVM_STORAGE=memory` opt-out; atomic-write via tempfile + rename; 0o700/0o600 perms; 30-day stale detection; eager-init at `startServer()` BEFORE `server.connect(transport)` mirroring PR #61 WC eager-init pattern. Mid-execution test refinement — original cold-boot-restore assertion `listAccounts() === []` was incompatible with lazy-load-on-read; executor refactored to spy on `_storage.readFileSync` for the eager-init file-read (same regression coverage, tighter contract). PAIR-NEV-01..06 covered — PR #69
- [x] 11-02: `@solana/web3.js@1.98.4` + `@solana/spl-token@0.4.14` SDK adoption; `src/chains/solana/` shelf (registry.ts + sol-rpc-client.ts + types.ts); `getSolanaRpcUrl()` env reader + lazy `Connection` singleton; UNPARSED `getTokenAccountsByOwner` (research-locked — `getParsedTokenAccountsByOwner` rejected by public RPCs at scale, manual SPL account-data decode required) — PR #70
- [x] 11-03: `src/wallet/ledger-solana-transport.ts` + `@ledgerhq/hw-transport-node-hid@6.33.2` + `@ledgerhq/hw-app-solana@7.10.2` + `bs58@5.0.0`; lazy USB-HID singleton + `_transport` spy-affordance; `bs58.encode(Buffer)` for Ed25519 pubkey → base58 (research-locked over `Uint8Array` shape); 3-level derivation path `44'/501'/<n>'` (Ledger Live default, NOT Phantom's 4-level). Plan-check FLAG-1 moved bs58 install from 11-02 to 11-03 to match source-code surface — PR #71
- [x] 11-04: `pair_solana_ledger` + `get_solana_status` + `list_paired_non_evm_accounts` + `remove_paired_non_evm_account` tools + `register-all.ts` widening; `solanaRpcConfigured` diagnostic in `get_vaultpilot_config_status` (plan-check FLAG-2); derivation-path-leak defense via 3-sentinel substring test on `list_*` — PR #72
- [x] 11-05: `get_solana_balance` + `get_solana_token_balance` + `get_solana_token_metadata` read tools; curated top-50 SPL mint registry at `src/tokens/solana-top-50.{json,ts}` (42 entries); DefiLlama Solana pricing (`solana:<mint>` keying); `NATIVE_PRICING_PROXY.solana` (wSOL proxy mirroring Polygon WMATIC pattern); `get_portfolio_summary` discriminated-union widening (NOT a fork to `get_solana_portfolio_summary`) — same call site, per-row `chain` discriminator; demo-mode persona fallback (plan-check FLAG-3) — PR #73
- [x] 11-06: `src/demo/solana-persona.ts` sibling interface (NOT widening `Persona` — viem `Address`-branded literal-union can't accept base58); `solana-whale` persona (Binance hot wallet `5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9`, OFAC-clean, 2M SOL); `get_demo_wallet`/`set_demo_wallet` widening + per-chain active-persona state — PR #74

**Status**: code-complete; v2.0 verify-phase pending (real-Ledger USB-HID pair against Solana mainnet + cold-boot restore exercise + multi-chain portfolio fan-out smoke). The persistent non-EVM account cache infrastructure (PAIR-NEV-*) is now load-bearing for v2.1 TRON + v2.2 BTC/LTC milestones — same schema, no widening needed (`chain` enum already accommodates the four target chains). Phase 12 (Solana trust pipeline) plan-phase is dispatched in parallel with this close-out.

#### Phase 12: Solana native + SPL trust pipeline

**Goal**: Full prepare → preview → send flow works for native SOL and SPL transfers, with Solana-specific `payloadFingerprint` (over serialized transaction message bytes pre-signature), per-wallet durable-nonce setup, mandatory `simulateTransaction` preview gate, and Ledger SOL-app blind-sign hash recompute. This is the load-bearing milestone for v2.0 — the Solana trust pipeline mirror of Phase 4's Ethereum one.
**Depends on**: Phase 11
**Requirements**: SOL-W-01, SOL-W-02, SOL-PREP-01, SOL-PREP-02, SOL-PREP-03, SOL-PREP-04, SOL-PREP-05
**Success Criteria** (what must be TRUE):

  1. `prepare_solana_native_send({ to, lamports })` returns `{ handle, to, lamports, recentBlockhash, payloadFingerprint, prepareReceipt }` with the Solana `payloadFingerprint` computed over the serialized message bytes (domain-tagged `"VaultPilot-soltx-v1:"`)
  2. `prepare_solana_spl_send({ to, mint, amount })` produces an SPL Token Program `Transfer` instruction; decimal-string amount resolved via `get_solana_token_metadata` decimals lookup (mirrors v1.x `parseAmountStrict` pattern)
  3. `preview_send` Solana branch runs mandatory `simulateTransaction` RPC gate — refuses with structured error if simulation surfaces program-error or insufficient-lamports; on success surfaces decoded args + Ledger SOL-app blind-sign hash recompute in `LEDGER BLIND-SIGN HASH` block
  4. `send_transaction` Solana branch enforces `previewToken` + `userDecision: "send"` gates identically to the EVM path; rejects on `payloadFingerprint` drift between prepare and send
  5. Ledger SOL app clear-signs the transaction (per Solana app v1.4+ default); user sees decoded `Recipient` + `Amount` on-device for both native SOL and SPL transfers
  6. ~~`prepare_solana_nonce_init` + `prepare_solana_nonce_close` produce per-wallet durable-nonce account setup/teardown txs~~ — **deferred to v2.0.x** per Plan 12-04 plan-check FLAG-2 (DF-3 honored: durable-nonce is a Solana-specific UX-extension orthogonal to the cryptographic-binding chain; the 150-slot recent-blockhash window is fine for the v2.0 ship gate; the implementation surface (NonceAuthorized account ownership semantics, multi-wallet authority gating) warrants its own design + verify-phase pass)
  7. Fixture **K** (native SOL transfer fingerprint) + Fixture **L** (SPL transfer fingerprint) hardcoded as `0x...` literals in `test/signing-fingerprint-solana.test.ts` (NEW sibling file; Phase 12 plan-check FLAG-3 — names I/J were already claimed for Phase 8's chain-distinctness PROPERTY test and a reserved next-shape slot, so Solana fixtures shifted up two letters); cross-linked from `prepare-solana-*` consumer tests; persona-cycle integration test re-anchors byte-identity across persona swaps (sender-independent for native SOL; sender-dependent for SPL where the source token account is sender-derived — pattern matches Phase 7 Aave `T-INTEGRATION-FROM-DRIFT-2` shape)
  8. SECURITY.md updated for Solana threat model — USB-HID transport trust shape vs WC v2 bridge, durable-nonce TTL extension as accepted-residual risk, `simulateTransaction` gate as Layer 0.7 defense (Layer 0.5 = canonical dispatch from v1.3; Layer 1 = preview; Layer 2 = chain-mismatch from v1.2; Layer 3 = fingerprint-drift)

**Plans**: 5 plans

Plans:

- [x] 12-01: `src/signing/payload-fingerprint-solana.ts` + `src/signing/presign-hash-solana.ts` + `src/signing/simulation-solana.ts` + `src/signing/blocks-solana.ts` Solana primitives shelf + `handle-store.ts` discriminated-union widening (`{ type: "evm" | "sol" }`) + `SIMULATION_REFUSED` errorCode 16 (additive, non-overlapping with v1.2's CHAIN_ID_MISMATCH 15 / v1.3 DISPATCH_TARGET_REFUSED) + Fixtures **K + L** literal anchors in new `test/signing-fingerprint-solana.test.ts` sibling file (NOT I + J — Phase 8 chain-distinctness PROPERTY test claimed J; surprise #4 of pattern-mapper); FROZEN-area zero-diff on EVM-side cryptographic-binding chain asserted via `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts` empty — PR #78
- [x] 12-02: `prepare_solana_native_send` + Solana `PREPARE RECEIPT` template + `src/protocols/solana-system.ts` (System Program `Transfer` encoder; `SYSTEM_TRANSFER_DISCRIMINANT = 2` instruction tag) + `parseSolanaAmountStrict` (u64-aware decimal-string → lamports with overflow guard); decimals=9 native-SOL fast-path — PR #81
- [x] 12-03: `prepare_solana_spl_send` + `src/protocols/solana-spl.ts` (SPL Token Program **`TransferChecked`** instruction — NOT `Transfer` per defense-in-depth research-lock; `TransferChecked` requires decimals + mint at the program level so a corrupted decimals lookup fails on-chain rather than silently shifting amount); ATA (Associated Token Account) derivation; create-ATA-if-missing pre-instruction; `get_solana_token_metadata` decimals lookup — PR #85
- [x] 12-04: `preview_send` Solana branch — mandatory `simulateTransaction` Layer 0.7 RPC gate (sits between v1.3 canonical-dispatch Layer 0.5 and v1.2 chain-mismatch Layer 2) + canonical-dispatch-solana allowlist seed + Ledger SOL-app blind-sign hash (SHA-256 of message bytes per DF-2) recompute in `LEDGER BLIND-SIGN HASH` block + `signTransaction(userInputType: "sol")` widening; durable-nonce setup tools DEFERRED per FLAG-2 — PR #89
- [x] 12-05: `send_transaction` Solana branch — `previewToken` + `userDecision` gate reuse (three-gate FROZEN region byte-identical) + USB-HID direct broadcast via `connection.sendRawTransaction` (NOT the WC bridge) + both `txHash` AND `txSignature` returned (Solana terminology divergence) + `LEDGER_NOT_CONNECTED` (errorCode 17) + `SOLANA_APP_NOT_OPEN` (errorCode 18) additive errors + full Solana trust-pipeline integration test (persona-cycle byte-identity for native; sender-dependent for SPL) + SECURITY.md Solana section (5 sub-sections: USB-HID trust shape, simulate-gate Layer 0.7, durable-nonce TTL residual, ATA-create as part of transfer, multi-wallet authority residual) — PR #93

**Status**: code-complete; v2.0 verify-phase pending (real-Ledger USB-HID Solana-app smoke against mainnet — small SOL transfer + small SPL transfer + clear-sign decoded view confirmation). The Solana cryptographic-binding chain is now load-bearing for v2.0 Phases 13-16 (MarginFi / Kamino / Jupiter / staking / LiFi) — `payload-fingerprint-solana.ts` widens via `instructions[]` shape; Fixture K + L are the regression anchors that block preimage drift in downstream phases. EVM three-gate FROZEN region byte-identical across all 5 plans (additive Solana dispatch via `txType` discriminator at the `send_transaction.ts` switch).

#### Phase 13: Solana lending — MarginFi + Kamino

**Goal**: User can read MarginFi + Kamino lending positions and supply/withdraw/borrow/repay assets on both protocols. Per-wallet lending-account PDA setup tools land here. Canonical dispatch allowlist extends to Solana programs (mirrors v1.3 SEC-35 EVM dispatch-target enforcement).
**Depends on**: Phase 12
**Requirements**: SOL-W-03, SOL-W-04, SOL-W-05, SOL-W-06, SOL-W-07, SOL-W-08, SOL-W-09, SOL-W-10
**Success Criteria** (what must be TRUE):

  1. `get_marginfi_positions({ wallet })` returns MarginFi-bank-keyed supplied + borrowed + health-factor-equivalent per position
  2. `get_kamino_positions({ wallet })` returns Kamino-vault-keyed supplied + borrowed + per-vault health
  3. `prepare_marginfi_supply` / `_withdraw` / `_borrow` / `_repay` produce unsigned MarginFi program instructions; `prepare_kamino_supply` / `_withdraw` / `_borrow` / `_repay` produce unsigned Kamino program instructions
  4. Per-wallet lending-account PDAs (MarginFi: `MarginfiAccount`; Kamino: `Obligation`) set up via `prepare_marginfi_account_init` and `prepare_kamino_obligation_init` tools when not already present
  5. Canonical dispatch allowlist (`src/security/canonical-dispatch.ts`) extends with MarginFi + Kamino program IDs per chain; mismatch refuses at preview time (Layer 0.5 — identical pattern to v1.3 SEC-35 EVM dispatch)
  6. MarginFi + Kamino program addresses sourced from `src/config/contracts.ts` Solana table (new sub-table — `Record<"solana", SolanaContracts>` mirroring the v1.2 EVM `Record<ChainId, ContractsForChain>` shape)
  7. Ledger clear-signs MarginFi/Kamino instructions when CAL coverage available; conditional LEDGER NOTICE block (mirrors Phase 6 WETH9.withdraw pattern) when the instruction is blind-sign-only

**Plans**: 4 plans (estimate)

Plans:

- [ ] 13-01: `src/config/contracts.ts` Solana sub-table extension — MarginFi + Kamino program IDs + per-protocol PDA derivation helpers; canonical-dispatch allowlist Solana arm wiring
- [ ] 13-02: MarginFi reads — `get_marginfi_positions` + `src/chains/solana/marginfi.ts` (account decoder via `@mrgnlabs/marginfi-client-v2` SDK, scope-probe at research time)
- [ ] 13-03: Kamino reads — `get_kamino_positions` + `src/chains/solana/kamino.ts` (Kamino lend SDK adoption decision DF at research time)
- [ ] 13-04: Prepare tools — `prepare_marginfi_supply/_withdraw/_borrow/_repay` + `prepare_kamino_supply/_withdraw/_borrow/_repay` + `prepare_marginfi_account_init` + `prepare_kamino_obligation_init`; mechanical-clone-of-12 pattern per `prepare_solana_spl_send`; conditional LEDGER NOTICE for blind-sign instructions

#### Phase 14: Jupiter v6 swaps

**Goal**: User can query a Jupiter v6 quote and swap on Solana with slippage-bounded execution. `prepare_jupiter_swap` consumes the Jupiter quote API and serializes the returned transaction; `get_jupiter_quote` is the read-only companion.
**Depends on**: Phase 13
**Requirements**: SOL-W-11, SOL-W-12, SOL-W-13
**Success Criteria** (what must be TRUE):

  1. `get_jupiter_quote({ inputMint, outputMint, amount, slippageBps? })` returns the Jupiter v6 quote envelope (out amount, route plan, price impact, slippage)
  2. `prepare_jupiter_swap({ inputMint, outputMint, amount, slippageBps })` returns an unsigned serialized transaction the user signs via the standard Solana trust pipeline (Phase 12 primitives)
  3. Default slippage hint = 50 bps; refuses without explicit `slippageBps` when price impact > 2% (sandwich-MEV defense — mirrors v2.6 MEV-01 EVM equivalent)
  4. Decoded swap args (`From: X SYMBOL`, `To: Y SYMBOL`, `Price impact: Z%`) surface in `CHECKS PERFORMED` at preview time
  5. Jupiter v6 program ID added to canonical-dispatch allowlist (Layer 0.5 Solana arm)

**Plans**: 2 plans (estimate)

Plans:

- [ ] 14-01: `src/clients/jupiter.ts` — Jupiter v6 HTTP client (mirrors `fourbyte.ts` / `etherscan.ts` shape — never-throws, LRU cache, `_resetJupiter_ForTesting` hook); `get_jupiter_quote` tool
- [ ] 14-02: `prepare_jupiter_swap` + Jupiter quote → serialized tx integration; sandwich-MEV slippage gate at >2% price impact; canonical-dispatch allowlist extension; Fixture K (Jupiter swap fingerprint) literal anchor

#### Phase 15: Staking — Marinade + Jito + native SOL

**Goal**: User can stake on Marinade (mSOL), Jito (jitoSOL stake pool), and via native SOL delegate/deactivate/withdraw flows. Marinade ships with immediate-unstake (incurs fee); Jito ships deposit-only per upstream note (unstake gap deferred).
**Depends on**: Phase 14
**Requirements**: SOL-W-14, SOL-W-15, SOL-W-16, SOL-W-17, SOL-W-18, SOL-W-19, SOL-W-20
**Success Criteria** (what must be TRUE):

  1. `prepare_marinade_stake({ lamports })` + `prepare_marinade_immediate_unstake({ msolAmount })` produce unsigned Marinade Finance instructions; immediate-unstake fee surfaced verbatim in `CHECKS PERFORMED`
  2. `prepare_jito_stake_pool_deposit({ lamports })` produces an unsigned Jito stake-pool deposit instruction; explicit `[NOTICE — Jito stake-pool unstake not yet supported]` block emitted at preview (deferred per upstream)
  3. `prepare_solana_delegate({ stakeAccount, voteAccount, lamports })` + `prepare_solana_deactivate({ stakeAccount })` + `prepare_solana_withdraw({ stakeAccount, to, lamports })` cover the native-SOL staking lifecycle
  4. Stake account creation flow ships as a sub-helper invoked by `prepare_solana_delegate` when no stake account exists for the wallet
  5. Marinade + Jito program IDs + native Stake Program added to canonical-dispatch allowlist
  6. Ledger clear-signs each staking instruction (Solana app coverage) — conditional LEDGER NOTICE only when CAL coverage absent

**Plans**: 3 plans (estimate)

Plans:

- [ ] 15-01: Marinade — `prepare_marinade_stake` + `prepare_marinade_immediate_unstake` + Marinade program ID in contracts SOT + fee-surfacing in CHECKS PERFORMED
- [ ] 15-02: Jito — `prepare_jito_stake_pool_deposit` + Jito stake-pool program ID + `[NOTICE — unstake not yet supported]` block (deferred per upstream gap)
- [ ] 15-03: Native SOL — `prepare_solana_delegate` + `prepare_solana_deactivate` + `prepare_solana_withdraw` + stake-account creation sub-helper + Stake Program allowlist entry

#### Phase 16: LiFi-routed EVM↔Solana bridging + Solana diagnostics

**Goal**: User can bridge between EVM chains and Solana via LiFi. Cross-chain destination decode lands here (Inv #6b — server-side mechanical assertion that the decoded `finalRecipient` matches the user-supplied `to`). `get_solana_setup_status` probes durable-nonce + lending-account PDA presence (analogous to v1.0 DIAG-01 `get_vaultpilot_config_status` but Solana-scoped).
**Depends on**: Phase 15
**Requirements**: SOL-W-21, SOL-DIAG-01
**Success Criteria** (what must be TRUE):

  1. `prepare_solana_lifi_swap({ fromChain, fromToken, toChain: "solana", toToken, amount, toAddress })` produces an unsigned LiFi-routed bridge transaction; works both directions (EVM → Solana AND Solana → EVM)
  2. Server-side `decodedFinalRecipient == userSuppliedToAddress` assertion at preview time (Inv #6b — mirrors v2.6 BRIDGE-T1 EVM facet decoders, applied to LiFi's Solana-side decoder); mismatch refuses
  3. LiFi program/contract IDs added to canonical-dispatch allowlist (already present on EVM side from v1.3; Solana arm new)
  4. `get_solana_setup_status({ wallet })` returns `{ nonceAccountPresent, marginfiAccountPresent, kaminoObligationPresent, ledgerSolAppVersion?, walletPublicKeyOnDevice }` — probes per-wallet PDA + on-device status
  5. SECURITY.md updated with Solana-side bridge facet-decode rationale + Inv #6b extension scope

**Plans**: 2 plans (estimate)

Plans:

- [ ] 16-01: `prepare_solana_lifi_swap` + LiFi Solana-side decoder + Inv #6b `decodedFinalRecipient` assertion at preview; cross-chain `toChain` Zod enum widening (`"solana"` joins existing EVM enum)
- [ ] 16-02: `get_solana_setup_status` diagnostic — per-wallet PDA probe (nonce + MarginFi + Kamino) + Ledger SOL app version probe + on-device pubkey verify; v2.0 milestone close-out (SECURITY.md Solana threat-model finalization)

**Status**: planning; v2.0 verify-phase will require a physical Ledger device with the Solana app installed + USB-HID connectivity + small SOL balance for return-able test broadcasts. Mirrors v1.0 ship-gate verify pattern.

---

### 📋 v2.1 TRON (Phases 17-21)

**Milestone Goal:** A user can pair a Ledger over USB-HID for TRON (no WalletConnect — TRON has no WC v2 bridge to Ledger), read TRX + canonical TRC-20 stablecoin balances (USDT / USDC / USDD / TUSD), send TRX and TRC-20 tokens, manage Stake 2.0 freeze/unfreeze/withdraw-expire-unfreeze/vote/claim, swap TRX↔TRC-20 on SunSwap, and bridge TRON↔EVM via LiFi. The full prepare → preview → send trust pipeline is reused, with TRON-specific primitives layered in: serialized-Protobuf-transaction-bytes `payloadFingerprint` (domain-tagged `"VaultPilot-trontx-v1:"`), TRC-20 approve via `prepare_tron_token_approve`, and the persistent non-EVM account cache (PAIR-NEV-*) from Phase 11 reused for TRON address persistence. The Ledger TRON app clear-signs every supported action over USB-HID.

#### Phase 17: TRON scaffolding — USB-HID transport + TRX reads + persistent TRON account

**Goal**: USB-HID Ledger pairing for TRON works; TRX balance readable via TronGrid (or `TRON_RPC_URL` override); paired TRON account persists via the v2.0 Phase 11 `non-evm-account-store.ts` infrastructure under `chain: "tron"` record key.
**Depends on**: Phase 16 (v2.0 complete — PAIR-NEV-* cache infrastructure live)
**Requirements**: PAIR-NEV-* reuse, TRON-PAIR-01, TRON-PAIR-02, TRON-READ-01, TRON-READ-02, TRON-READ-03
**Success Criteria** (what must be TRUE):

  1. `pair_tron_ledger()` opens the Ledger TRON app over USB-HID via `@ledgerhq/hw-transport-node-hid` + `@ledgerhq/hw-app-trx`, returns the base58check (T-prefixed) address verbatim plus a `VERIFY-ON-DEVICE` block
  2. `get_tron_status()` returns `{ paired: true, address, derivationPath, rpcEndpoint, ledgerTrxAppVersion? }` after a successful pair; integrates with PAIR-NEV-* for restored sessions
  3. `get_tron_balance({ wallet })` returns native TRX balance (sun + TRX-formatted) against a free public node (default TronGrid; override via `TRON_RPC_URL`)
  4. `get_tron_block_tip()` returns the current TRON block height + timestamp (TRON-specific diagnostic)
  5. Paired TRON account persists to `~/.vaultpilot-mcp/non-evm-accounts.json` under `chain: "tron"` record key (PAIR-NEV-* cache reuse — zero infrastructure change)
  6. On MCP restart, eager-loaded TRON account restores via `loadNonEvmAccounts()` before `server.connect(transport)`; `get_tron_status()` returns `paired: true` on first call without re-pair
  7. `get_vaultpilot_config_status` extends `pairedNonEvmChains` to include `"tron"` when present; `tronRpcConfigured` boolean surfaces alongside `solanaRpcConfigured`

**Plans**: 5 plans

Plans:

- [x] 17-01: TRON chain shelf + `tronweb@6.3.0` (research-locked over `@tronprotocol/sdk` — that name is a hallucination; no such npm package exists at scope-probe time) + `@ledgerhq/hw-app-trx@6.36.1` + `src/chains/tron/{rpc-client,registry,types}.ts` + `TRON_RPC_URL` env reader + TronGrid fallback + `tron-top-25.json` stub `[]` (filled in 17-04) + **5-level BIP-44 derivation path** `m/44'/195'/<n>'/0/0` (DIFFERENT from Solana's 3-level `44'/501'/<n>'`; load-bearing regression anchor — `accountIndex` extracts `segments[2]` not `segments[1]`) — PR #83
- [x] 17-02: USB-HID Ledger TRON transport (`src/wallet/ledger-tron-transport.ts`) — `fetchTronAddress` returns the base58check (T-prefixed) string **DIRECTLY** from `@ledgerhq/hw-app-trx`'s `getAddress({ address: true })` call (NO `bs58.encode` step — load-bearing regression anchor defends against Solana-copy-paste; the TRX app returns the encoded string, Solana returns raw 32 bytes); lazy USB-HID singleton + `_transport` spy-affordance mirroring Solana shape — PR #84
- [x] 17-03: 5 TRON MCP tools — `pair_tron_ledger` + `get_tron_status` + `get_tron_balance` + `get_tron_token_balance` + `get_tron_block_tip` + `tronRpcConfigured` diagnostic in `get_vaultpilot_config_status` + `pairedNonEvmChains` widening to include `"tron"`. **Originally landed as PR #87 but closed as superseded due to stale-branch register-all.ts regression** — `git rebase` at PR-write time would have silently deleted the `prepare_solana_spl_send` + `prepare_compound_supply` + `prepare_compound_withdraw` imports landed in concurrent PRs #85 + #82. Rebased + re-opened as PR #88; the **rebase-before-PR-open discipline** lesson surfaced from this experience (see Phase 17 retro) — PR #88
- [x] 17-04: `tron-top-25.json` filled with **15 entries** (DefiLlama-coverage-locked — only TRC-20 tokens with `tron:<address>` DefiLlama prices included; padding to 25 would have introduced un-priced rows that the read tools couldn't render meaningfully); USDD-18 + WTRX-6 regression anchors lock against the per-entry-hardcoded decimals shape (USDD = 18 decimals, USDT/USDC/WTRX = 6; pattern-mapper surfacing — TRC-20 decimals are MORE divergent than ERC-20's mostly-6/18 bimodal distribution); DefiLlama `tron:<address>` keying + `NATIVE_PRICING_PROXY.tron = WTRX` (mirrors Polygon WMATIC + Solana wSOL pattern); `get_portfolio_summary` TRON branch via discriminated-union widening (per-row `chain: "tron"` discriminator — pattern from Phase 11). **TRON-READ-04 (`get_portfolio_summary` TRON leg) shipped here**, ahead of Phase 21's scope — Phase 21 narrows to setup-status diagnostics + remainder sub-features per plan-check FLAG-1 — PR #91
- [x] 17-05: `TronPersona` sibling interface (NOT widening `Persona` — base58check T-prefix addresses don't satisfy viem's `Address`-branded hex literal-union; sibling pattern from Phase 11 `SolanaPersona`); `tron-whale` persona (`TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb` — OFAC-clean per 0xB10C registry, known top-25 TRX holder); `get_demo_wallet`/`set_demo_wallet` widening; persona slug enum expanded — PR #92

**Status**: code-complete; v2.1 verify-phase pending (real-Ledger USB-HID TRON-app smoke against mainnet — small TRX transfer once Phase 18 trust pipeline ships; for now, pair + read-side smoke + portfolio fan-out smoke + demo-persona rehearsal). PAIR-NEV-* infrastructure (Phase 11) reused with zero schema change — `chain: "tron"` is the only delta. The TronPersona sibling-interface pattern + `tron-top-25.json` curation discipline + the **5-level BIP-44 path divergence regression anchor** are now load-bearing for v2.1 Phases 18-21 (TRON trust pipeline / TRC-20 approve + Stake 2.0 / SunSwap + LiFi / setup diagnostics). Originally planned as 4 plans (estimate); shipped as 5 — 17-05 demo-persona is a sibling-interface plan distinct from 17-04 reads (same Phase 11 split between 11-05 reads and 11-06 demo).

#### Phase 18: TRON native + TRC-20 trust pipeline

**Goal**: Full prepare → preview → send flow works for native TRX and TRC-20 transfers, with TRON-specific `payloadFingerprint` (over serialized Protobuf transaction bytes pre-signature), TRON-specific blind-sign hash recompute (SHA-256 over the Protobuf raw_data per TRON consensus), and Ledger TRX-app clear-sign coverage.
**Depends on**: Phase 17
**Requirements**: TRON-PREP-01, TRON-PREP-02, TRON-PREP-03, TRON-PREP-04, TRON-W-01, TRON-W-02
**Success Criteria** (what must be TRUE):

  1. `prepare_tron_native_send({ to, sun })` returns `{ handle, to, sun, blockHeader, payloadFingerprint, prepareReceipt }` with the TRON `payloadFingerprint` over serialized Protobuf raw_data bytes (domain-tagged `"VaultPilot-trontx-v1:"`, distinct from EVM and Solana tags)
  2. `prepare_tron_trc20_send({ to, tokenAddress, amount })` produces a `TriggerSmartContract` with `transfer(to, amount)` calldata; decimal-string amount resolved via `get_tron_token_metadata`
  3. `preview_send` TRON branch surfaces decoded args + Ledger TRX-app blind-sign hash recompute (SHA-256 over raw_data) in `LEDGER BLIND-SIGN HASH` block
  4. `send_transaction` TRON branch enforces `previewToken` + `userDecision: "send"` + `payloadFingerprint` drift gate identically to EVM/Solana paths
  5. Ledger TRX app clear-signs both native and TRC-20 transfers (per TRX app v0.5+ default); user sees decoded `Recipient` + `Amount` on-device
  6. Fixture M (native TRX transfer fingerprint) + Fixture N (TRC-20 transfer fingerprint) hardcoded as `0x...` literals in **new sibling file** `test/signing-fingerprint-tron.test.ts` (EVM-side `test/signing-fingerprint.test.ts` + Solana-side `test/signing-fingerprint-solana.test.ts` byte-untouched); cross-linked from `prepare-tron-*` consumer tests
  7. SECURITY.md updated for TRON threat model — Protobuf raw_data hash vs EVM RLP keccak256, TRX blind-sign mode behavior, TRC-20 plugin coverage gap (if any) as accepted-residual

**Plans**: 4 plans (estimate)

Plans:

- [x] 18-01: `src/signing/payload-fingerprint-tron.ts` + sibling primitives shelf (`presign-hash-tron.ts` SHA-256 + `simulation-tron.ts` NEVER-throws classifier + `blocks-tron.ts` 7 templates + `amount-tron.ts` u64/u256-discriminated + `canonical-dispatch-tron.ts` 4-entry stablecoin allowlist + `handle-store.ts` `PreparedTxTron` widening); **Fixtures M + N** hardcoded `0x...` literal anchors in NEW sibling file `test/signing-fingerprint-tron.test.ts`; FROZEN-area discipline holds EVM-side + Solana-side fingerprint modules + 23-code error-codes union byte-untouched — PR #97
- [x] 18-02: `prepare_tron_native_send` + `src/protocols/tron-native.ts` (TransferContract via `tronweb.transactionBuilder.sendTrx` + LOAD-BEARING `extendExpiration(tx, 900)` aligning broadcast window to 15-min handle TTL); Fixture M consumer re-anchor — PR #98
- [x] 18-03: `prepare_tron_trc20_send` + `src/protocols/tron-trc20.ts` (TriggerSmartContract `transfer(address,uint256)` ABI-encoded calldata — ABI-identical to ERC-20 selector `0xa9059cbb`; per-token decimals via `get_tron_token_metadata`; persona-cycle sender-dependence regression); Fixture N consumer re-anchor — PR #99
- [x] 18-04: `preview_send` + `send_transaction` + `get_tx_verification` TRON branches — Layer 0.5 canonical-dispatch (TRC-20 only) + Layer 0.7 asymmetric simulation gate (TRC-20 mandatory `triggerconstantcontract` refusal vs native TRX `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE` advisory); Ledger TRX-app blind-sign hash recompute (SHA-256 over raw_data); FLAG-1.5 inline-fix applied (`txID: pinned.presignHash.slice(2)` — TRON consensus tx-id IS the SHA-256 presign hash, NOT the keccak256 binding fingerprint); LOAD-BEARING `test/trust-pipeline-tron.integration.test.ts` persona-cycle byte-identity end-to-end; SECURITY.md TRON section (6 sub-sections per CONTEXT D-12a) — PR #100

**Status**: code-complete; v2.1 verify-phase pending (real-Ledger USB-HID TRON-app smoke against mainnet — native TRX small transfer + USDT-TRC20 small transfer + on-device SHA-256 tx-id match against `LEDGER BLIND-SIGN HASH (TRON)` block). Test trajectory across Phase 18: 1826 → 2061 (+235 net across 4 plans). FROZEN-area zero-diff held END-TO-END on the three-gate region of `send_transaction.ts` (PREVIEW_REQUIRED + PREVIEW_TOKEN_MISMATCH + PAYLOAD_FINGERPRINT_DRIFT) — TRON dispatch arm is additive below; EVM + Solana branches BYTE-FROZEN across all 3 modified tools. Cumulative v2.1 trust pipeline ready for Phase 19 (TRC-20 approve + Stake 2.0) which builds on the same primitives shelf. Plan-check FLAG-1 + FLAG-1.5 resolved inline; FLAG-2 + FLAG-3 (ROADMAP doc-sync — fixture names + expiration framing) resolved in this close-out.

#### Phase 19: TRC-20 approve + Stake 2.0 (freeze/unfreeze/withdraw-expire-unfreeze/vote/claim)

**Goal**: User can approve TRC-20 spenders (with the `⚠ UNLIMITED APPROVAL` surfacing pattern from Phase 6) and run the full TRON Stake 2.0 lifecycle — freeze TRX for resources, unfreeze, withdraw-expire-unfreeze, vote for super representatives, claim rewards.
**Depends on**: Phase 18
**Requirements**: TRON-PREP-05, TRON-W-03, TRON-W-04, TRON-W-05, TRON-W-06, TRON-W-07, TRON-W-08
**Success Criteria** (what must be TRUE):

  1. `prepare_tron_token_approve({ tokenAddress, spender, amount })` produces a TRC-20 `approve(spender, amount)` TriggerSmartContract; `amount: "max"` accepted as `2^256-1`; `⚠ UNLIMITED APPROVAL` strict-equality label at preview (mirrors Phase 6 PREP-29)
  2. `prepare_tron_revoke_approval({ tokenAddress, spender })` produces `approve(spender, 0)` — distinct named tool the agent calls by intent
  3. `prepare_tron_stake_freeze({ amount, resource: "ENERGY"|"BANDWIDTH" })` produces a `FreezeBalanceV2Contract` (Stake 2.0 — distinct from legacy `FreezeBalanceContract`); resource enum surfaced verbatim in `CHECKS PERFORMED`
  4. `prepare_tron_stake_unfreeze` + `prepare_tron_withdraw_expire_unfreeze` cover the 14-day unfreeze waiting-period lifecycle
  5. `prepare_tron_stake_vote({ votes: [{ srAddress, count }] })` produces a `VoteWitnessContract` for super-representative voting
  6. `prepare_tron_stake_claim_rewards` produces a `WithdrawBalanceContract` for accumulated voting rewards
  7. TRON-specific spender-label table extends `src/config/contracts.ts` — SunSwap router + LiFi + canonical TRC-20 stablecoins as KnownSpender entries

**Plans**: 4 plans (estimate)

Plans:

- [x] 19-01: `prepare_tron_token_approve` + `prepare_tron_revoke_approval` (shared `prepareTronApproveInternal` helper for byte-identity; mirrors Phase 6 `prepareApproveInternal` shape); `⚠ UNLIMITED APPROVAL` strict-equality surfacing; TRON spender table extension in `src/config/contracts.ts`; preview_send approve/revoke arm (additive widening, additive arm before existing Phase 18 guards) — PR #106
- [x] 19-02: `prepare_tron_stake_freeze` + `prepare_tron_stake_unfreeze` + `prepare_tron_withdraw_expire_unfreeze` (Stake 2.0 Protobuf contracts; resource enum strict-equality D-03b); CHECKS PERFORMED surfacing for 14-day waiting period; asymmetric Layer 0.7 mandatory refusal on withdraw-expire via `_tronStake.checkWithdrawableBalance`; `Number()` overflow guard for `frozen_balance` — PR #107
- [x] 19-03: `prepare_tron_stake_vote` + `prepare_tron_stake_claim_rewards` (VoteWitnessContract + WithdrawBalanceContract); super-representative validation via hybrid live+snapshot SR registry (`src/tokens/tron-srs.json` top-30 by voteCount fallback; `srSource` always surfaced); advisory `estimatedRewardSun` (no intent-vs-reality gate per D-06c) — PR #108
- [x] 19-04: Lifecycle integration test (freeze → unfreeze → `vi.setSystemTime(+14d)` → withdraw-expire — multi-tx flow + persona-swap byte-identity); Fixtures Tron-19-{A,B,C,D} literal anchors in NEW sibling `test/signing-fingerprint-tron-19.test.ts` (Phase 18 fixture file BYTE-UNTOUCHED per D-08); SECURITY.md §6 TRON v2.1 Phase 19 append; final FROZEN-area zero-diff verification — PR #109

#### Phase 20: SunSwap + LiFi-routed TRON↔EVM bridging

**Goal**: User can swap TRX↔TRC-20 on SunSwap (same-chain) and bridge TRON↔EVM via LiFi. `prepare_sunswap_swap` consumes the SunSwap V2 router; `prepare_tron_lifi_swap` consumes the LiFi quote API and serializes the returned transaction.
**Depends on**: Phase 19
**Requirements**: TRON-W-09, TRON-W-10, TRON-W-11, TRON-W-12
**Success Criteria** (what must be TRUE):

  1. `get_sunswap_quote({ inputToken, outputToken, amount, slippageBps? })` returns the SunSwap V2 router quote (out amount, route plan, slippage)
  2. `prepare_sunswap_swap({ inputToken, outputToken, amount, slippageBps })` returns an unsigned TriggerSmartContract for the SunSwap V2 router; user signs via the standard TRON trust pipeline (Phase 18)
  3. Default slippage hint = 50 bps; refuses without explicit `slippageBps` when price impact > 2% (sandwich-MEV defense — mirrors Phase 14 Jupiter + v2.6 MEV-01 EVM)
  4. `prepare_tron_lifi_swap({ fromChain: "tron", fromToken, toChain, toToken, amount, toAddress })` produces an unsigned LiFi-routed bridge transaction; works both directions (TRON → EVM AND EVM → TRON)
  5. ~~Server-side `decodedFinalRecipient == userSuppliedToAddress` assertion at preview time (Inv #6b extension)~~ — **DEFERRED to v2.2.x per Phase 20 D-04b** (LiFi TRON facet not confirmable at planning time, 2026-05-20 — see `20-02-DEFERRED.md`)
  6. SunSwap V2 router added to NEW `TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST` sibling set in `src/security/canonical-dispatch-tron.ts` (Open Question #2 design: sibling set + sibling function; existing 4-stablecoin allowlist + `checkTronDispatchTarget` BYTE-IDENTICAL). LiFi TRON facet entry DEFERRED per SC#5.

**Plans**: 1 plan (Plan 20-02 originally planned as LiFi — DEFERRED to v2.2.x per D-04b; see `.planning/phases/20-tron-sunswap-lifi-bridging/20-02-DEFERRED.md`)

Plans:

- [x] 20-01-PLAN.md — `src/clients/sunswap.ts` (NEVER-throws contract-call wrapper around tronweb `triggerConstantContract` for SunSwap V2 router `getAmountsOut` + `getReserves`; LRU cache 10 entries / 30s TTL; mirrors `src/clients/etherscan.ts` shape) + `src/protocols/sunswap-tron.ts` (TriggerSmartContract encoder + decoder; `SUNSWAP_SWAP_SELECTOR = "38ed1739"`) + `get_sunswap_quote` + `prepare_sunswap_swap` MCP tools + sandwich-MEV >2% refusal via `INVALID_INPUT + hintTool` (keeps 21-code error union FROZEN) + NEW `TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST` sibling set + `checkTronSmartContractDispatchTarget` in canonical-dispatch-tron (Open Question #2 option (a)) + `preview_send` TRON branch additive sunswap-swap arm + Fixture Tron-20-A hardcoded `0x...` literal anchor in NEW sibling `test/signing-fingerprint-tron-20.test.ts` + SECURITY.md §6 APPEND-ONLY. TRON-W-09 + TRON-W-10 COVERED; TRON-W-12 PARTIAL (SunSwap entry shipped; LiFi facet deferred); TRON-W-11 DEFERRED per D-04b. — PR #113
- 🟡 ~~20-02 LiFi~~ — **DEFERRED to v2.2.x per Phase 20 D-04b** (researcher verified at planning time 2026-05-20: live LiFi `/v1/chains` API returned 69 EVM chains with no TRON entry; GitHub `lifinance/contracts/deployments/` has no `tron*.json`; `/v1/quote?fromChain=TRX` returned error 1011). Original scope: `src/clients/lifi.ts` (NEW shared client) + `src/protocols/bridge-decoders/lifi-tron.ts` (Inv #6b `_bridgeData.receiver` decoder) + `prepare_tron_lifi_swap` (TRON → EVM direction). Reschedule preconditions + `checkpoint:human-verify` task signature documented in `20-02-DEFERRED.md`.

#### Phase 21: TRON diagnostics + v2.1 milestone close-out

**Goal**: `get_tron_setup_status` probes TRX-app version + on-device address verify + Stake 2.0 resource presence (analogous to v2.0 SOL-DIAG-01). **Scope narrowed** at Phase 17 close-out per plan-check FLAG-1 — TRON-READ-04 (`get_portfolio_summary` TRON leg + curated TRC-20 registry + DefiLlama pricing) already shipped in Plan 17-04, ahead of the original Phase 21 placement. Phase 21 now closes out the v2.1 milestone with the setup-diagnostic + SECURITY.md TRON threat-model finalization.
**Depends on**: Phase 20
**Requirements**: TRON-DIAG-01 (TRON-READ-04 already covered by Phase 17)
**Success Criteria** (what must be TRUE):

  1. `get_tron_setup_status({ wallet })` returns `{ ledgerTrxAppVersion?, walletAddressOnDevice, resourceAccountPresent (Stake 2.0), frozenEnergyAmount, frozenBandwidthAmount }`
  2. ~~`get_portfolio_summary` fan-out adds TRON~~ — **shipped in Plan 17-04**; Phase 21 SC retained for documentation traceability only
  3. ~~Curated top-30 TRC-20 mint registry at `src/tokens/tron-top-30.json`~~ — **shipped in Plan 17-04** as `src/tokens/tron-top-25.json` (15 entries; DefiLlama-coverage-locked; pattern-mapper surfacing — TRON's relevant token surface is narrower than EVM/Solana)
  4. SECURITY.md updated with TRON-side bridge facet-decode rationale + Stake 2.0 resource-account threat model + v2.1 verify-phase scope documented

**Plans**: 1 plan (revised from 2 estimate; portfolio leg shipped in Phase 17)

Plans:

- [x] 21-01: `get_tron_setup_status` diagnostic — Stake 2.0 resource probe (frozen ENERGY + BANDWIDTH amounts separated from TronGrid `/wallet/getaccount` `frozenV2` array per D-01c) + Ledger TRX app version probe + on-device pubkey verify (strict-equality `addressVerified`) + 3 independent demote-to-null arms (TronGrid / USB-HID / Ledger app-version) + lazy probe (no boot RPC) + 9-arm test coverage + SECURITY.md §6 APPEND-ONLY v2.1 milestone close-out summary (4 milestone PRs + trust-shape recap + 21-code FROZEN union pattern + accepted residual risks + verify-phase scope) — PR #116

**Status**: planning; v2.1 verify-phase requires a physical Ledger with TRON app installed + USB-HID connectivity + small TRX balance for return-able test broadcasts.

---

### 📋 v2.2 Bitcoin + Litecoin (Phases 22-27)

**Milestone Goal:** A user can pair a Ledger over USB-HID for BTC (and LTC), read BTC balances via Esplora (no API keys), send native segwit + taproot transactions, bump fees via BIP-125 RBF, sign BIP-137 messages, participate in PSBT-based multisig workflows (combine / sign / finalize), bridge BTC→EVM/Solana via LiFi, and (optionally) probe forensic chain reads via Bitcoin Core / Litecoin Core JSON-RPC. LTC mirrors BTC scaled down (shared Esplora + Ledger BTC infra — same `src/wallet/non-evm-account-store.ts` cache). The UTXO-model trust pipeline is structurally distinct from account-model chains (EVM / Solana / TRON) — PSBT serialization replaces the single-transaction-blob payloadFingerprint shape; each input commits independently via BIP-143 sighashes.

#### Phase 22: BTC scaffolding — Esplora reads + USB-HID + persistent BTC account

**Goal**: USB-HID Ledger pairing for BTC works; BTC balance + UTXO + history readable via Esplora (mempool.space or blockstream.info); paired BTC account persists via the v2.0 Phase 11 cache under `chain: "bitcoin"` record key.
**Depends on**: Phase 21 (v2.1 complete — PAIR-NEV-* cache + USB-HID transport patterns mature)
**Requirements**: PAIR-NEV-* reuse, BTC-PAIR-01, BTC-PAIR-02, BTC-READ-01, BTC-READ-02, BTC-READ-03, BTC-READ-04, BTC-READ-05
**Success Criteria** (what must be TRUE):

  1. `pair_btc_ledger()` opens the Ledger BTC app over USB-HID via `@ledgerhq/hw-app-btc`, returns the first segwit (bc1q…) AND first taproot (bc1p…) addresses verbatim plus a `VERIFY-ON-DEVICE` block
  2. `get_btc_status()` returns `{ paired: true, addresses: { segwit, taproot }, derivationPaths: { segwit, taproot }, esploraEndpoint, ledgerBtcAppVersion? }`
  3. `get_btc_balance({ wallet })` returns sat + BTC-formatted balance via Esplora `/address/{addr}` endpoint
  4. `get_btc_balances({ wallet })` returns segwit + taproot balances separately (UTXOs live at distinct script types per derivation)
  5. `get_btc_account_balance({ xpub })` aggregates across all derived addresses under an xpub (gap-limit-respecting scan)
  6. `get_btc_tx_history({ wallet, limit })` returns recent transactions via Esplora `/address/{addr}/txs`
  7. `get_btc_fee_estimates()` returns Esplora's fee-rate estimates (sat/vB) for 1/2/3/6/144-block confirmation targets
  8. Paired BTC account persists to `~/.vaultpilot-mcp/non-evm-accounts.json` under `chain: "bitcoin"` record key (PAIR-NEV-* cache reuse — multi-derivation-path slots supported via the v2.0 multi-record-per-chain provision)

**Plans**: 4 plans

**Status**: code-complete; v2.2 verify-phase pending real-Ledger USB-HID BTC-app smoke (bundled with Phase 17/21 deferred items per 2026-05-16 directive). HUMAN-UAT items captured in `22-HUMAN-UAT.md`. Automated coverage: 2677 tests green (+210 net vs pre-Phase-22 baseline).

Plans:
**Wave 1**

- [x] 22-01-PLAN.md — `bitcoinjs-lib@^7.0.1` + `@ledgerhq/hw-app-btc@^10.22.1` SDK adoption (research-locked over `@noble/curves`-only minimal stack — Phase 25 PSBT multisig wants the full PSBT serializer); `src/chains/bitcoin/` shelf (registry + esplora-client + types); `BTC_ESPLORA_URL` env reader (default `https://blockstream.info/api`; mempool.space documented as Esplora-compatible alt-override); 5-arm NEVER-throws Esplora HTTP client (4 fetch helpers — address-info / utxos / tx-history / fee-estimates) + UTXO-shape `BalanceReport` discriminated union (load-bearing for Phase 23 coin-selection inheritance); branded `BtcSegwitAddress` + `BtcTaprootAddress` two-gate validation (bech32 + bech32m regex first-line + bitcoinjs-lib `address.toOutputScript` full-checksum)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 22-02-PLAN.md — `pair_btc_ledger` tool + `src/wallet/ledger-btc-transport.ts` USB-HID transport (per-call try/finally close; `(Module as any).default ?? Module` shim; `_transport` + `_btcLedgerTransport` ESM spy seams) + dual-address fetch in ONE device session (`getWalletPublicKey` BIP-84 `bech32` + BIP-86 `bech32m` with `verify: true` opt-in for on-device confirmation) + `getAppConfiguration` BTC-vs-LTC app gate (RESEARCH Pitfall 2 — APDU table overlap defense); DUAL-address `VERIFY-ON-DEVICE` block; dual `saveAccount` under `chain: bitcoin` (PAIR-NEV-03 multi-record-per-chain — ZERO schema change); locked errorCode set (DEMO_MODE_REFUSED / LEDGER_NOT_CONNECTED / BITCOIN_APP_NOT_OPEN / USER_REJECTED / APPROVAL_TIMEOUT / INTERNAL_ERROR); test extensions to non-evm-account-store + eager-init cold-boot-restore for dual-bitcoin-record case

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 22-03-PLAN.md — 5 Esplora-backed read tools — `get_btc_balance` (single-address BalanceReport) + `get_btc_balances` (parallel segwit + taproot via `Promise.allSettled`) + `get_btc_account_balance` (xpub gap-limit-20-respecting scan via `bitcoinjs-lib.bip32` + `payments.p2wpkh/p2tr`; concurrency-5; per-xpub 5-min TTL cache) + `get_btc_tx_history` (paginated via Esplora `:last_seen_txid` cursor; default limit 25) + `get_btc_fee_estimates` (24-key Esplora response projected to 5-key {1,2,3,6,144} sat/vB shape per ROADMAP SC#7); all tools pattern-match on 5-arm Esplora client union — NEVER throw; BIP-32 Test Vector 1 → first-5-derivations hardcoded `bc1q…` + `bc1p…` literal anchors in `test/chains-bitcoin-xpub-scan.test.ts` (CLAUDE.md cryptographic-binding-fixture convention extended to deterministic-derivation outputs); `bitcoinjs-lib.Psbt` import explicitly forbidden in Phase 22 (PSBT lands Phase 23)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 22-04-PLAN.md — `get_btc_status` (dual-address envelope from PAIR-NEV-* cache discriminated by `bc1q` / `bc1p` prefix; per-record staleAccountWarning OR; `esploraEndpoint` from `_bitcoinRegistry.getResolvedEsploraUrl()`; NO lazy probe — deferred to Phase 27 `get_btc_setup_status` analogue mirroring TRON Phase 21 split) + `btcEsploraConfigured` boolean in `get_vaultpilot_config_status` (ZERO change to existing `pairedNonEvmChains` aggregation — `new Set` auto-deduplicates) + `src/demo/bitcoin-persona.ts` (sibling-interface NOT EVM-Persona-widening; DUAL DOA validation at module load on segwit + taproot via `bitcoinjs-lib.address.toOutputScript`; `simulationEnvelopeShape: psbt-mempool-replay` Phase 23 anchor) + 1 OFAC-clean BTC whale persona (verified via 0xB10C SDN registry + mempool.space label check at write time) + `set_demo_wallet` / `get_demo_wallet` slug-enum additive widening to include `btc-whale` (EVM + Solana + TRON slugs BYTE-UNTOUCHED)

#### Phase 23: BTC native + segwit + taproot trust pipeline (PSBT-based)

**Goal**: Full prepare → preview → send flow works for native BTC sends. The BTC trust pipeline is structurally distinct: PSBT serialization replaces the EVM/Solana single-blob shape; `payloadFingerprint` is computed over the BIP-143 sighashes per input (not the whole tx); the Ledger BTC app signs each input via the PSBT workflow.
**Depends on**: Phase 22
**Requirements**: BTC-PREP-01, BTC-PREP-02, BTC-PREP-03, BTC-PSBT-01, BTC-PSBT-02, BTC-W-01
**Success Criteria** (what must be TRUE):

  1. `prepare_btc_send({ to, sats, feeRate? })` returns `{ handle, psbt, inputs[], outputs[], feeSats, payloadFingerprint, prepareReceipt }`; coin-selection via branch-and-bound (BnB) with manual override; `payloadFingerprint` over the BIP-143 sighashes of all inputs (domain-tagged `"VaultPilot-btctx-v1:"`)
  2. `preview_send` BTC branch surfaces decoded inputs/outputs + per-input sighash + Ledger BTC-app PSBT-signing flow expectation in `LEDGER BLIND-SIGN HASH` block (multi-hash for multi-input)
  3. `send_transaction` BTC branch enforces `previewToken` + `userDecision: "send"` + `payloadFingerprint` drift gate
  4. Native segwit (bc1q…) AND taproot (bc1p…) sends both work; the Ledger BTC app handles both script types per BTC app v2.1+
  5. Mixed-script-type inputs supported (some segwit + some taproot) — common case for users with derived addresses across both script types
  6. Fixture O (BTC native segwit send fingerprint, single-input single-output) + Fixture P (BTC taproot send fingerprint) + Fixture Q (mixed-script-type send) hardcoded as `0x...` literals in `test/signing-fingerprint.test.ts`
  7. SECURITY.md updated for BTC threat model — PSBT serialization trust shape, per-input BIP-143 sighash binding, multi-input sighash recompute as Layer 1 (preview) defense

**Plans**: 4 plans (estimate)

Plans:

**Wave 1**

- [x] 23-01-PLAN.md — `src/signing/btc-sighash.ts` (per-input BIP-143/341 sighash) + `src/signing/btc-fingerprint.ts` (domain-tagged keccak256 over concatenated sighashes, `"VaultPilot-btctx-v1:"`); Fixture O segwit literal anchor; FROZEN discipline for EVM/Solana/TRON fingerprint modules
- [x] 23-02-PLAN.md — `src/signing/btc-coin-select.ts` (BnB + largest-first fallback, in-repo no new dep) + `src/protocols/btc-psbt.ts` (PSBT-v0 construction, segwit/taproot/mixed) + `src/chains/bitcoin/change-index.ts` (chain-1 next-unused index); fee-rate sanity bounds (D-03) + dust-threshold (D-07)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 23-03-PLAN.md — `prepare_btc_send` tool + `blocks-btc.ts` PREPARE RECEIPT template + `handle-store.ts` `PreparedTxBtc` widening + BTC error codes; segwit/taproot/mixed-input + demo BTC whale persona; Fixture P + Q literal anchors

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 23-04-PLAN.md — `preview_send` + `send_transaction` BTC branches; `signBtcPsbt` two-pass mixed-input signing + Esplora `broadcastTx`; demo mempool-replay envelope (D-04); full BTC trust-pipeline integration test (persona-cycle byte-identity); SECURITY.md BTC section

#### Phase 24: BIP-125 RBF + BIP-137 message signing

**Goal**: User can bump fees on confirmed-pending BTC transactions via BIP-125 RBF, and sign arbitrary messages with their BTC keys per BIP-137 (canonical signature shape for wallet ownership proof).
**Depends on**: Phase 23
**Requirements**: BTC-W-02, BTC-W-03
**Success Criteria** (what must be TRUE):

  1. `prepare_btc_rbf_bump({ txid, newFeeRate })` produces an unsigned RBF replacement PSBT with the higher fee rate; original input set preserved; BIP-125 sequence-number rules enforced
  2. Preview surfaces the original-vs-new fee rate diff + the absolute fee increase in `CHECKS PERFORMED`
  3. RBF refused on confirmed transactions (mempool-only); refused if original tx didn't signal RBF (sequence < `0xfffffffe`)
  4. `sign_message_btc({ wallet, message })` produces a BIP-137 compact signature over `magic_bytes + varint_length + message`; works against the segwit address by default (taproot follows BIP-322 — separate tool, deferred)
  5. Ledger BTC app clear-signs message text under blind-sign mode; user sees the message bytes on-device

**Plans**: 2 plans

Plans:

**Wave 1**

- [x] 24-01-PLAN.md — `prepare_btc_rbf_bump` (BTC-W-02): RBF replacement PSBT, BIP-125 sequence/fee-rate validation, `buildBtcPsbt` `sequenceOverride?` param, `signalRbf` flag on `prepare_btc_send` (Design Fork 1 Option A), `PreparedTxBtc.kind` widening to `"rbf"`, Fixture V anchor (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 24-02-PLAN.md — `sign_message_btc` (BTC-W-03): BIP-137 compact-signature shape, `signBtcMessage` Ledger transport spy-affordance, magic-prefix-device-applied, Fixture W anchor; BIP-322 taproot deferred (Wave 2, depends on 24-01)

**Status**: code-complete (PR #128); v2.2 verify-phase pending real-Ledger USB-HID BTC-app smoke (bundled with the v2.2 verify session — small RBF fee-bump broadcast + BIP-137 message-signing on-device confirmation). HUMAN-UAT items captured in `24-HUMAN-UAT.md`. BIP-322 taproot message signing deferred (separate tool — taproot ownership proofs follow BIP-322, not BIP-137).

#### Phase 25: PSBT multisig flow (combine / sign / finalize + multisig wallet registry)

**Goal**: User can participate in M-of-N multisig PSBT workflows — combine partially-signed PSBTs from co-signers, sign their input contribution, finalize the fully-signed PSBT for broadcast. Multisig wallet registry tracks known M-of-N descriptors.
**Depends on**: Phase 24
**Requirements**: BTC-PSBT-03, BTC-PSBT-04, BTC-PSBT-05, BTC-PSBT-06, BTC-PSBT-07, BTC-W-04
**Success Criteria** (what must be TRUE):

  1. `register_btc_multisig_wallet({ name, descriptor, threshold })` records a known multisig descriptor (sortedmulti or musig-aware); descriptors validated against bitcoin script rules
  2. `get_btc_multisig_balance({ walletName })` aggregates UTXOs at the multisig descriptor's derived addresses via Esplora
  3. `get_btc_multisig_utxos({ walletName })` lists raw UTXOs available for spending
  4. `combine_btc_psbts({ psbts: [...] })` merges partially-signed PSBTs from multiple co-signers; conflicts surfaced as structured errors
  5. `sign_btc_multisig_psbt({ psbt, walletName })` adds the user's signature to each input they're a signer on; preview surfaces the inputs being signed
  6. `finalize_btc_psbt({ psbt })` builds the final witness data; refuses if signature threshold not met
  7. Each multisig PSBT signing operation flows through the standard prepare → preview → send pipeline (same trust pipeline; the PSBT being signed is the artifact)

**Plans**: 3 plans (estimate)

Plans:

**Wave 1**

- [x] 25-01-PLAN.md — multisig wallet registry: descriptor parse/validation + BIP-67 P2WSH address derivation + atomic-write persistence (0o600); register_btc_multisig_wallet + get_btc_multisig_balance + get_btc_multisig_utxos

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 25-02-PLAN.md — combine_btc_psbts: PSBT merge with an explicit pre-combine same-key/same-input conflict scan raising PSBT_COMBINE_CONFLICT

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 25-03-PLAN.md — sign_btc_multisig_psbt (prepare→preview→send via multisig-psbt handle) + finalize_btc_psbt (threshold-enforced) + Ledger multisig signing via @ledgerhq/ledger-bitcoin AppClient + Fixture X

#### Phase 26: LTC scaffolding + LiFi BTC→EVM/Solana bridging

**Goal**: LTC mirrors BTC scaffolding scaled down — `prepare_litecoin_native_send` + `sign_message_ltc` + Esplora via litecoinspace.org. LiFi-routed BTC bridging to EVM and Solana lands here (shared `src/clients/lifi.ts` shelf reused from v2.0 Phase 16 + v2.1 Phase 20).
**Depends on**: Phase 25
**Requirements**: LTC-PAIR-01, LTC-READ-01, LTC-READ-02, LTC-W-01, LTC-W-02, BTC-LIFI-01
**Success Criteria** (what must be TRUE):

  1. `pair_litecoin_ledger()` opens the Ledger Litecoin app (or BTC app with LTC mode per Ledger's account-config) over USB-HID; LTC base58 address (M-prefixed or ltc1q-prefixed segwit) returned verbatim
  2. `get_litecoin_balance({ wallet })` + `get_litecoin_tx_history` + `get_litecoin_fee_estimates` read tools against litecoinspace.org Esplora-compatible endpoint
  3. `prepare_litecoin_native_send({ to, litoshi })` mirrors `prepare_btc_send` PSBT-based shape; same `payloadFingerprint` shape with LTC domain tag `"VaultPilot-ltctx-v1:"`
  4. `sign_message_ltc` mirrors `sign_message_btc` with LTC magic bytes
  5. `prepare_btc_lifi_swap({ fromToken: "BTC", toChain, toToken, amount, toAddress })` produces an unsigned LiFi-routed bridge transaction; BTC → EVM and BTC → Solana both supported
  6. Server-side `decodedFinalRecipient == userSuppliedToAddress` assertion at preview time (Inv #6b extension — same shape as SOL-W-21 + TRON-W-11)

**Plans**: 3 plans

Plans:

**Wave 1**

- [x] 26-01-PLAN.md — LTC scaffolding: `src/chains/litecoin/` shelf (types + registry + esplora-client; litecoinspace.org `/api/v1/fees/recommended` divergence) + `pair_litecoin_ledger` (dual-address, Litecoin-app gate) + `get_litecoin_balance` / `get_litecoin_tx_history` / `get_litecoin_fee_estimates` (LTC-PAIR-01, LTC-READ-01, LTC-READ-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 26-02-PLAN.md — LTC signing trust pipeline: `src/signing/ltc-fingerprint.ts` (`VaultPilot-ltctx-v1:` domain tag) + `prepare_litecoin_native_send` (PSBT-based) + `sign_message_ltc` (BIP-137 LTC magic bytes) + `preview_send`/`send_transaction` litecoin branches + Fixtures Y + Z (LTC-W-01, LTC-W-02)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 26-03-PLAN.md — BTC LiFi bridging: `src/clients/lifi.ts` (from-scratch NEVER-throws client) + `lifi-btc` PSBT decoder + `prepare_btc_lifi_swap` with the Inv #6b `decodedFinalRecipient` assertion + `preview_send`/`send_transaction` btc-lifi branches + Fixture AA (BTC-LIFI-01)

#### Phase 27: Optional Bitcoin/Litecoin Core RPC + `build_incident_report` + diagnostics

**Goal**: Optional Bitcoin Core / Litecoin Core JSON-RPC support unlocks forensic chain reads that Esplora can't serve (chain tips, full mempool, fee percentiles, block stats). `build_incident_report` bundles BTC/LTC chain-tip + mempool-anomaly signals with EVM market-incident bits.
**Depends on**: Phase 26
**Requirements**: BTC-FORENSIC-01, BTC-FORENSIC-02, BTC-FORENSIC-03, BTC-FORENSIC-04, BTC-FORENSIC-05, BTC-INC-01
**Success Criteria** (what must be TRUE):

  1. `BITCOIN_CORE_RPC_URL` (with optional `_USER`/`_PASS` basic-auth) enables Bitcoin Core JSON-RPC reads when set; absent → forensic tools return `coreNotConfigured` envelope (never silent failure)
  2. `get_btc_block_tip()` returns chain tip + timestamp + difficulty (Core RPC if configured; Esplora fallback)
  3. `get_btc_block_stats({ blockHeight })` returns per-block tx count + fee percentiles + size + segwit/taproot adoption
  4. `get_btc_blocks_recent({ count })` returns the last N block summaries
  5. `get_btc_chain_tips()` returns all known chain tips (reorg detection)
  6. `get_btc_mempool_summary()` returns mempool size + fee-rate histogram (Core RPC only; Esplora API doesn't expose full mempool)
  7. `LITECOIN_CORE_RPC_URL` enables the LTC-equivalent forensic suite
  8. `build_incident_report({ wallet?, includeChains?: string[] })` bundles chain-tip + mempool-anomaly signals across configured BTC/LTC/EVM chains; surfaces unexplained mempool spikes, reorg events, large unconfirmed-balance changes

**Plans**: 3 plans (estimate)

Plans:

- [ ] 27-01: `src/clients/bitcoin-core-rpc.ts` (JSON-RPC client mirroring `etherscan.ts` shape — never-throws, basic-auth handling, 5-arm discriminated union); `BITCOIN_CORE_RPC_URL` env reader; `get_btc_block_tip` + `get_btc_block_stats` + `get_btc_blocks_recent` + `get_btc_chain_tips` tools
- [ ] 27-02: `get_btc_mempool_summary` + LTC-equivalent forensic suite (`LITECOIN_CORE_RPC_URL` env + read tools mirroring BTC)
- [ ] 27-03: `build_incident_report` bundling logic + cross-chain anomaly-signal aggregation; v2.2 milestone close-out (SECURITY.md BTC/LTC threat-model finalization)

**Status**: planning; v2.2 verify-phase requires a physical Ledger with BTC app installed + USB-HID connectivity + small BTC + LTC balances for return-able test broadcasts. PSBT multisig flow needs a second cooperating signer (could be a second VaultPilot install or any PSBT-compatible wallet).

---

### 📋 v2.3 EVM lending + staking expansion (Phases 28-31)

**Milestone Goal:** Expand EVM lending + staking surface to Compound V3 (multi-Comet), Morpho Blue, Lido (stake / unstake / wrap / unwrap), EigenLayer (restake), and Rocket Pool (stake / unstake). Each protocol gets read tools, prepare tools, canonical-dispatch allowlist entries, and contracts SOT extension. Multi-chain fan-out where the protocol is deployed multi-chain (Compound + Morpho); Lido + EigenLayer + Rocket Pool are Ethereum-write-only (Lido reads on Arbitrum + mainnet).

#### Phase 28: Compound V3 — multi-Comet supply / withdraw / borrow / repay

**Goal**: User can read Compound V3 positions per Comet (each Comet is a single-borrow-asset isolated market) and supply / withdraw / borrow / repay. Multi-Comet support means the agent specifies which Comet to interact with.
**Depends on**: Phase 27 (or — if v2.3 dispatched parallel to v2.2 — Phase 16 v2.0 completion)
**Requirements**: CMP-01, CMP-02, CMP-03, CMP-04, CMP-05, CMP-06
**Success Criteria** (what must be TRUE):

  1. `get_compound_positions({ wallet, chain? })` returns Compound V3 supplied + borrowed per Comet with health factor equivalent
  2. `get_compound_market_info({ chain, cometAddress })` returns the Comet's supply APR + borrow APR + collateral factors + liquidation threshold
  3. `prepare_compound_supply({ chain, cometAddress, asset, amount })` produces an unsigned Comet `supply(asset, amount)` call
  4. `prepare_compound_withdraw` / `_borrow` / `_repay` cover the rest of the lifecycle
  5. `prepare_compound_repay({ amount: "max" })` accepted as full-position close — **Plan 28-03 ships MAX_UINT256 sentinel** for `amount: "max"` (Compound V3's Comet contract honors `MAX_UINT256` as repay-all natively via `supply(base, MAX_UINT256)`; no server-side "debt + buffer" computation needed — the protocol handles the truncation at execution time, eliminating the race window between off-chain quote and on-chain settlement). Strict-equality string compare rejects `"MAX"` / `"unlimited"` / `"infinite"` / case variants (anti-typo defense).
  6. Compound V3 Comet addresses sourced from `src/config/contracts.ts` per-chain typed slots (**6 Ethereum mainnet Comets** verified against `compound-finance/comet/deployments/mainnet` at planning time: USDC, USDT, WETH, wstETH, USDS, USDe; multi-chain — Arbitrum, Polygon, Base, Optimism — **deferred to v2.3.x follow-up** per `COMPOUND_COMETS_RAW` sibling sub-table design; deferral keeps Phase 28 scope tight and lets per-chain Comet maturity be re-verified at v2.3.x dispatch time)
  7. Compound V3 Comet addresses added to canonical-dispatch allowlist per chain — **Ethereum arm extended 20 → 26 entries via SOT getter** (additive; FROZEN region byte-identical)

**Plans**: 4 plans

Plans:

- [x] 28-01: `COMPOUND_COMETS_RAW` sibling sub-table in `src/config/contracts.ts` (6 Ethereum mainnet Comets verified against `compound-finance/comet/deployments/mainnet` deployment manifests at planning time: USDC / USDT / WETH / wstETH / USDS / USDe) + `src/protocols/compound-v3.ts` selector decoders (supply / withdraw / supplyTo / withdrawTo / borrow / repay) + Fixtures **R / S / T / U** literal anchors in `test/signing-fingerprint.test.ts` (R = `supply(base, amount)`, S = `withdraw(base, amount)`, T = `withdraw(base, MAX_UINT256)` repay-all, U = `supply(base, MAX_UINT256)` repay-via-supply). Multi-chain (Polygon/Arbitrum/Base/Optimism) deferred to v2.3.x — PR #82
- [x] 28-02: `prepare_compound_supply` + `prepare_compound_withdraw` + `_compoundChains.deriveIntent` shared helper (intent-vs-reality gates via server-side RPC reads — `Comet.baseToken()` + `borrowBalanceOf(account)` + `balanceOf(account)` checked at preview time so the agent can't claim "supply" while the calldata is in fact `withdraw` against a position with no supplied balance); `INVALID_INPUT + hintTool` refusal pattern (NOT a new error code — keeps the 21-code union FROZEN; the `hintTool` field in the refusal envelope names the corrective tool the agent should call instead — e.g. "tried `prepare_compound_supply` against a Comet you have no supplied balance in, did you mean `prepare_compound_withdraw`?") — PR #86
- [x] 28-03: `prepare_compound_borrow` + `prepare_compound_repay` + reverse-intent gates (server-side check `borrowBalanceOf > 0` before allowing repay; `balanceOf > requested-amount` before allowing borrow) + **MAX_UINT256 sentinel for repay-all** (`amount: "max"` → MAX_UINT256 literal in calldata; strict-equality rejects `"MAX"` / `"unlimited"` / `"infinite"` and case-variants — anti-typo defense surfaced as a design-fork at planning gate) — PR #90
- [x] 28-04: `get_compound_market_info` + `get_lending_positions` extension via discriminated-union widening (Aave rows byte-identical regression anchor — Phase 7 Aave preimages must remain stable when Compound rows are added) + `simulate_position_change` Compound branch + `LEDGER_NOTICE_COMPOUND_TEMPLATE` (Compound is NOT in the LedgerHQ ERC-7730 registry at planning time — opposite of Aave Phase 7 which had CAL clear-sign coverage; emit conditional NOTICE block at preview-time directing the user to enable Blind signing on the device for Compound interactions) + preview-time intent-gate re-derivation (defense-in-depth; the intent re-check fires at preview AS WELL AS at prepare, in case the agent calls `prepare_*` then re-uses the handle after a position change) + canonical-dispatch Ethereum arm extended 20 → 26 entries via SOT getter (additive; FROZEN region byte-identical) + Compound lifecycle integration test (supply → borrow → repay → withdraw across all 6 Ethereum Comets) — PR #94

**Status**: code-complete; v2.3 verify-phase pending (real-Ledger smoke against mainnet — small USDC supply → small USDC withdraw + small WETH supply → small WETH borrow USDC → repay-max → withdraw with the LEDGER NOTICE for Blind signing confirmed on-device). Closes #64. The `COMPOUND_COMETS_RAW` sibling sub-table + `_compoundChains.deriveIntent` shared helper + intent-vs-reality gate via server-side RPC reads + `INVALID_INPUT + hintTool` refusal pattern (errorCode discipline keeps the 21-code union FROZEN) + MAX_UINT256 sentinel are now load-bearing for v2.3 Phases 29-31 (Morpho Blue / Lido / EigenLayer / Rocket Pool — all inherit the intent-vs-reality + MAX_UINT256 patterns) and for the deferred v2.3.x multi-chain Compound expansion (Polygon / Arbitrum / Base / Optimism).

#### Phase 29: Morpho Blue — supply / withdraw / borrow / repay

**Goal**: User can read Morpho Blue isolated-market positions and supply / withdraw / borrow / repay. Morpho Blue's permissionless market creation means market-id is a per-call parameter (not a Comet-style address).
**Depends on**: Phase 28
**Requirements**: MOR-01, MOR-02, MOR-03, MOR-04, MOR-05
**Success Criteria** (what must be TRUE):

  1. `get_morpho_positions({ wallet, chain? })` returns Morpho Blue positions keyed by market-id (loanToken + collateralToken + oracle + IRM + LLTV)
  2. `prepare_morpho_supply({ chain, marketId, amount })` produces an unsigned Morpho contract call
  3. `prepare_morpho_withdraw` / `_borrow` / `_repay` cover the rest of the lifecycle
  4. `prepare_morpho_repay({ amount: "max" })` accepted as full-position close
  5. Morpho Blue contract addresses + known-market registry sourced from `src/config/contracts.ts` per-chain table

**Plans**: 3 plans (estimate)

Plans:

- [ ] 29-01: `src/config/contracts.ts` Morpho Blue addresses + known-market registry (top 20-30 markets by TVL at planning time); canonical-dispatch allowlist Morpho arm wiring
- [ ] 29-02: `get_morpho_positions` + `src/chains/morpho-blue.ts` (Morpho contract ABI + market-id-keyed position decoder)
- [ ] 29-03: `prepare_morpho_supply/_withdraw/_borrow/_repay` (with `amount: "max"` close-position support); `src/protocols/morpho-blue.ts`; Fixture T (Morpho supply) + Fixture U (Morpho repay-max) literal anchors

#### Phase 30: Lido — stake / unstake / wrap / unwrap (stETH↔wstETH)

**Goal**: User can stake ETH (mints stETH), unstake stETH (queues withdrawal), wrap stETH→wstETH, and unwrap wstETH→stETH. Read tools work on Ethereum mainnet + Arbitrum (bridged stETH/wstETH); writes are Ethereum-only.
**Depends on**: Phase 29
**Requirements**: LIDO-01, LIDO-02, LIDO-03, LIDO-04, LIDO-05
**Success Criteria** (what must be TRUE):

  1. `get_lido_positions({ wallet, chain? })` returns stETH + wstETH balances + accrued rebase rewards (Ethereum mainnet + Arbitrum)
  2. `prepare_lido_stake({ amount })` produces an unsigned `Lido.submit(referral)` call with `value` = `amount`
  3. `prepare_lido_unstake({ stethAmount })` produces an unsigned `WithdrawalQueue.requestWithdrawals` call (returns NFT receipt — surfaced in CHECKS PERFORMED)
  4. `prepare_lido_wrap({ stethAmount })` produces an unsigned `WstETH.wrap(amount)` call
  5. `prepare_lido_unwrap({ wstethAmount })` produces an unsigned `WstETH.unwrap(amount)` call
  6. Lido contracts (stETH + WstETH + WithdrawalQueue) sourced from `src/config/contracts.ts` Ethereum slots; canonical-dispatch allowlist Lido arm wiring

**Plans**: 3 plans (estimate)

Plans:

- [ ] 30-01: `src/config/contracts.ts` Lido slot extension (stETH + WstETH + WithdrawalQueue); canonical-dispatch allowlist Lido arm wiring
- [ ] 30-02: `get_lido_positions` + `src/chains/lido.ts` (multi-chain balance reader — Ethereum + Arbitrum bridged variants)
- [ ] 30-03: `prepare_lido_stake/_unstake/_wrap/_unwrap` + `src/protocols/lido.ts`; Fixtures V/W/X for each shape

#### Phase 31: EigenLayer + Rocket Pool

**Goal**: User can deposit LSTs into EigenLayer for restaking, and stake / unstake on Rocket Pool (rETH). EigenLayer is Ethereum-only; Rocket Pool is Ethereum-only.
**Depends on**: Phase 30
**Requirements**: EIG-01, EIG-02, RP-01, RP-02
**Success Criteria** (what must be TRUE):

  1. `get_eigenlayer_positions({ wallet })` returns EigenLayer strategy-level deposits (per LST or native restaking)
  2. `prepare_eigenlayer_deposit({ strategy, lst, amount })` produces an unsigned `StrategyManager.depositIntoStrategy` call
  3. `get_rocketpool_positions({ wallet })` returns rETH balance + accrued value
  4. `prepare_rocketpool_stake({ amount })` produces an unsigned `RocketDepositPool.deposit` call
  5. `prepare_rocketpool_unstake({ rethAmount })` produces an unsigned `rETH.burn(amount)` call
  6. EigenLayer + Rocket Pool contracts sourced from `src/config/contracts.ts`; canonical-dispatch allowlist extensions

**Plans**: 3 plans (estimate)

Plans:

- [ ] 31-01: `src/config/contracts.ts` EigenLayer (StrategyManager + per-strategy addresses) + Rocket Pool (RocketDepositPool + rETH) slot extension; canonical-dispatch allowlist wiring
- [ ] 31-02: `get_eigenlayer_positions` + `prepare_eigenlayer_deposit` + `src/chains/eigenlayer.ts` + `src/protocols/eigenlayer.ts`
- [ ] 31-03: `get_rocketpool_positions` + `prepare_rocketpool_stake` + `prepare_rocketpool_unstake` + `src/chains/rocketpool.ts` + `src/protocols/rocketpool.ts`

**Status**: planning; v2.3 verify-phase requires real-Ledger smoke against mainnet across all four protocols. Could be split into per-protocol verify-phases if scope warrants.

---

### 📋 v2.4 EVM DEX + LP + escape hatch (Phases 32-35)

**Milestone Goal:** Uniswap V3 swap + full LP verb set, Curve swap + add-liquidity, and the `prepare_custom_call` escape hatch for arbitrary verified-contract interactions. The escape hatch is intentionally outside the canonical-dispatch allowlist — `acknowledgeNonProtocolTarget: true` is the user-acknowledgment they're operating outside the protocol-aware safety net.

#### Phase 32: Uniswap V3 swap (auto-fee-tier, same-chain)

**Goal**: User can swap ERC-20↔ERC-20 (and WETH-wrapped ETH) on Uniswap V3 with auto-fee-tier selection (best price across 0.01% / 0.05% / 0.30% / 1.00% pools). Multi-hop routing through Uniswap V3's Quoter.
**Depends on**: Phase 31 (or v2.3 completion)
**Requirements**: UNI-01, UNI-02, UNI-03
**Success Criteria** (what must be TRUE):

  1. `get_uniswap_quote({ chain, tokenIn, tokenOut, amount, slippageBps? })` returns the Uniswap V3 Quoter V2 quote envelope (out amount, fee tier, route plan, price impact)
  2. `prepare_uniswap_swap({ chain, tokenIn, tokenOut, amount, slippageBps })` returns an unsigned SwapRouter02 transaction; auto-fee-tier from Quoter best-price selection
  3. Default slippage hint = 50 bps; refuses without explicit `slippageBps` when price impact > 2% (sandwich-MEV defense — pre-loaded by v2.6 MEV-01)
  4. Multi-hop routing supported when single-hop has worse price; CHECKS PERFORMED surfaces the route path
  5. Uniswap V3 SwapRouter02 + Quoter V2 addresses sourced from `src/config/contracts.ts` per-chain table; canonical-dispatch allowlist Uniswap arm

**Plans**: 2 plans (estimate)

Plans:

- [ ] 32-01: `src/config/contracts.ts` Uniswap V3 SwapRouter02 + Quoter V2 per-chain slots; `src/chains/uniswap-v3.ts` (Quoter integration + auto-fee-tier selector); canonical-dispatch allowlist wiring
- [ ] 32-02: `get_uniswap_quote` + `prepare_uniswap_swap` + `src/protocols/uniswap-v3.ts`; sandwich-MEV >2% refusal gate (mirrors Phase 14 Jupiter); Fixture Y (Uniswap V3 single-hop swap) literal anchor

#### Phase 33: Uniswap V3 full LP verb set + `get_lp_positions` with IL estimate

**Goal**: User can manage Uniswap V3 LP positions end-to-end — mint new position, increase liquidity, decrease liquidity, collect fees, burn (close) position, rebalance (close + re-mint at new range). `get_lp_positions` returns positions with current price + range + accrued fees + impermanent-loss estimate.
**Depends on**: Phase 32
**Requirements**: UNI-04, UNI-05, UNI-06, UNI-07, UNI-08, UNI-09, UNI-10
**Success Criteria** (what must be TRUE):

  1. `get_lp_positions({ wallet, chain? })` returns Uniswap V3 positions per NFT-id; includes current price, tick range, in-range/out-of-range flag, accrued fees, IL estimate (relative to a hodl baseline)
  2. `prepare_uniswap_v3_mint({ chain, token0, token1, fee, tickLower, tickUpper, amount0, amount1 })` produces an unsigned NonfungiblePositionManager `mint` call
  3. `prepare_uniswap_increase_liquidity` + `_decrease_liquidity` + `_collect` + `_burn` cover the rest of the position lifecycle
  4. `prepare_uniswap_v3_rebalance({ tokenId, newTickLower, newTickUpper })` is a composite tool that builds a multicall (decrease all + collect + mint at new range); preview surfaces the multi-step decoded view
  5. Tick math + price ↔ tick conversions handled server-side; agent supplies prices and decimals, server resolves to ticks
  6. NonfungiblePositionManager address sourced from `src/config/contracts.ts`; canonical-dispatch allowlist extension

**Plans**: 3 plans (estimate)

Plans:

- [ ] 33-01: `src/chains/uniswap-v3-lp.ts` (position reader via NonfungiblePositionManager; IL estimate math); `get_lp_positions`; tick ↔ price helpers in `src/signing/uniswap-tick.ts`
- [ ] 33-02: `prepare_uniswap_v3_mint` + `_increase_liquidity` + `_decrease_liquidity` + `_collect` + `_burn` (5 prepare tools as mechanical clones of `prepare_aave_supply` shape); `src/protocols/uniswap-v3-lp.ts`
- [ ] 33-03: `prepare_uniswap_v3_rebalance` (multicall builder — decrease + collect + mint); composite-tx preview surfacing pattern (new shape — agent + on-device need to see the multi-step decoded view)

#### Phase 34: Curve swap + add liquidity

**Goal**: User can swap on Curve stETH/ETH legacy + stable_ng plain pools, and add liquidity to Ethereum stable_ng plain pools. v0.2 follow-ups (3-coin meta-pools, Curve metaregistry-driven discovery) deferred per upstream issue [#321](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/issues/321) (or equivalent).
**Depends on**: Phase 33
**Requirements**: CRV-01, CRV-02, CRV-03
**Success Criteria** (what must be TRUE):

  1. `get_curve_positions({ wallet, chain? })` returns Curve LP token balances + pool composition (stETH/ETH + stable_ng plain pools only)
  2. `prepare_curve_swap({ chain, poolAddress, inputToken, outputToken, amount, slippageBps })` produces an unsigned `exchange` call on the named pool
  3. `prepare_curve_add_liquidity({ chain, poolAddress, amounts: [...], slippageBps })` produces an unsigned `add_liquidity` call for stable_ng plain pools (Ethereum first)
  4. Curve pool addresses sourced from `src/config/contracts.ts` curated registry (stETH/ETH legacy + top 10 stable_ng pools at planning time); canonical-dispatch allowlist Curve arm wiring

**Plans**: 2 plans (estimate)

Plans:

- [ ] 34-01: `src/config/contracts.ts` Curve curated pool registry + `src/chains/curve.ts` (pool decoder + LP balance reader); canonical-dispatch allowlist wiring
- [ ] 34-02: `prepare_curve_swap` + `prepare_curve_add_liquidity` + `src/protocols/curve.ts`; stable_ng + stETH/ETH legacy support; v0.2 (3-coin meta + metaregistry-driven) explicitly deferred

#### Phase 35: Escape hatch — `prepare_custom_call` + `get_contract_abi` + `read_contract`

**Goal**: User can prepare arbitrary verified-contract calls outside the protocol-aware safety net. `acknowledgeNonProtocolTarget: true` is the user-acknowledgment. Companion tools `get_contract_abi` (Etherscan-sourced) and `read_contract` (eth_call to a view function) give the agent the visibility needed to construct the call.
**Depends on**: Phase 34
**Requirements**: CUSTOM-01, CUSTOM-02, CUSTOM-03
**Success Criteria** (what must be TRUE):

  1. `get_contract_abi({ chain, address })` returns the verified ABI from Etherscan (or per-chain explorer); `not-verified` arm surfaced verbatim
  2. `read_contract({ chain, address, functionName, args })` calls a view function via `eth_call`; encodes/decodes via the verified ABI
  3. `prepare_custom_call({ chain, to, data, value?, acknowledgeNonProtocolTarget: true })` produces an unsigned transaction that BYPASSES the canonical-dispatch allowlist by design
  4. Missing `acknowledgeNonProtocolTarget: true` → structured refusal naming the safety implication and the canonical-dispatch tools the user could use instead
  5. Preview surfaces a `[WARN — NON-PROTOCOL TARGET]` block above the standard preview blocks; `payloadFingerprint` over the full tx bytes per v1.x PREP-03 shape
  6. Per-call ABI-decode best-effort surfacing in CHECKS PERFORMED (when ABI fetched via `get_contract_abi`); blind-sign-only when ABI unavailable

**Plans**: 3 plans (estimate)

Plans:

- [ ] 35-01: `get_contract_abi` + Etherscan ABI client extension (mirrors `src/clients/etherscan.ts` shape — the existing client has the per-chain `chainid` plumbing gap from v1.2, may need widening at planning time)
- [ ] 35-02: `read_contract` + ABI-driven eth_call helper; `src/chains/contract-read.ts`
- [ ] 35-03: `prepare_custom_call` + `acknowledgeNonProtocolTarget: true` gate + `[WARN — NON-PROTOCOL TARGET]` block + best-effort ABI-decode at preview; v2.4 milestone close-out

**Status**: planning; v2.4 verify-phase requires real-Ledger smoke for Uniswap V3 swap + LP mint + Curve swap + escape-hatch custom call.

---

### 📋 v2.5 Safe (Gnosis) multisig (Phases 36-38)

**Milestone Goal:** User can read Safe (Gnosis) multisig positions, participate in the three-step propose → approve → execute signing flow, and submit signatures to the Safe Tx Service API for cross-signer coordination. `enableModule` and `delegateCall: true` operations get hard-trigger second-LLM check wiring (Inv #12.5) — Safe modules and delegate calls expand the multisig's authority beyond signed-tx execution and need extra-careful agent attention.

#### Phase 36: Safe positions + Tx Service API integration + `get_safe_positions`

**Goal**: User can list their Safe addresses (where they're an owner), read per-Safe owner-set + threshold + pending transactions + module list. Safe Tx Service API integration is the read-side foundation.
**Depends on**: Phase 35 (or v2.4 completion)
**Requirements**: SAFE-01, SAFE-02, SAFE-03, SAFE-04
**Success Criteria** (what must be TRUE):

  1. `get_safe_positions({ wallet, chain? })` returns Safes where the wallet is an owner; per-Safe surfaces address + owners[] + threshold + nonce + pendingTransactions[] + enabledModules[]
  2. `get_safe_transaction({ chain, safeAddress, safeTxHash })` returns full transaction details + collected signatures + required threshold
  3. Safe Tx Service API client (`src/clients/safe-tx-service.ts`) mirrors `etherscan.ts` shape per-chain (Ethereum + Arbitrum + Polygon + Base + Optimism endpoints documented at safe-global.com)
  4. Safe ProxyFactory + Singleton addresses sourced from `src/config/contracts.ts` per-chain table; canonical-dispatch allowlist Safe arm wiring (Singleton is the dispatch target for all Safe operations)

**Plans**: 2 plans (estimate)

Plans:

- [ ] 36-01: `src/clients/safe-tx-service.ts` + per-chain endpoint registry; `src/config/contracts.ts` Safe slot extension; canonical-dispatch allowlist wiring
- [ ] 36-02: `get_safe_positions` + `get_safe_transaction` + `src/chains/safe.ts` (per-Safe state reader)

#### Phase 37: Safe three-step signing flow — `prepare_safe_tx_propose` + `_approve` + `_execute` + `submit_safe_tx_signature`

**Goal**: User can propose a Safe transaction (off-chain — signs a SafeTx hash, submits to Tx Service for co-signer collection), approve a pending transaction (signs the SafeTx hash they didn't propose), execute a fully-signed transaction (on-chain), and submit individual signatures to the Tx Service.
**Depends on**: Phase 36
**Requirements**: SAFE-05, SAFE-06, SAFE-07, SAFE-08
**Success Criteria** (what must be TRUE):

  1. `prepare_safe_tx_propose({ chain, safeAddress, to, value, data, operation })` builds the SafeTx hash + the EIP-712 typed-data structure; user signs the SafeTx hash via Ledger (typed-data signing required — depends on Ledger ETH app clear-sign-typed-data coverage, accepted-residual otherwise)
  2. `prepare_safe_tx_approve({ chain, safeAddress, safeTxHash })` fetches the pending SafeTx from Tx Service, surfaces the decoded operation in CHECKS PERFORMED, prepares the user's signature
  3. `submit_safe_tx_signature({ chain, safeAddress, safeTxHash, signature })` submits the user's signature to the Tx Service (off-chain coordination — no on-chain tx)
  4. `prepare_safe_tx_execute({ chain, safeAddress, safeTxHash })` builds the on-chain execution transaction once enough signatures collected; signatures-bytes assembled from Tx Service state
  5. Three-step flow surfaces explicitly in agent-facing tool descriptions: propose (typed-data sign) → approve (typed-data sign + submit signature) → execute (on-chain tx). Each step is a distinct named tool the agent can route by intent.
  6. SafeTx hash computation in `src/signing/safe-tx-hash.ts` (EIP-712 typed-data digest); regression-tested with fixture Safe transactions

**Plans**: 3 plans (estimate)

Plans:

- [ ] 37-01: `src/signing/safe-tx-hash.ts` (EIP-712 typed-data digest computation for SafeTx); `prepare_safe_tx_propose` + typed-data signing flow integration with Ledger ETH app
- [ ] 37-02: `prepare_safe_tx_approve` + `submit_safe_tx_signature` + Tx Service signature-submission integration
- [ ] 37-03: `prepare_safe_tx_execute` + on-chain execution transaction builder; signature-bytes assembly from Tx Service state; full three-step integration test (propose → approve → execute simulated end-to-end)

#### Phase 38: `enableModule` + `delegateCall: true` hard-trigger second-LLM check (Inv #12.5)

**Goal**: When a Safe transaction calls `enableModule(...)` or uses `operation: 1` (delegateCall), the prepare flow hard-triggers the second-LLM verification check (v1.3 SEC-34 `get_verification_artifact` is opt-in; here it becomes mandatory for these high-blast-radius operations). Inv #12.5 codifies this defense layer.
**Depends on**: Phase 37
**Requirements**: SAFE-09
**Success Criteria** (what must be TRUE):

  1. `prepare_safe_tx_propose` (and `_approve`) detect `enableModule(...)` calldata pattern at preview time and emit a hard-trigger block `[HARD-TRIGGER — MODULE ENABLE]` instructing the agent to run `get_verification_artifact` AND surface the result to the user before requesting `userDecision`
  2. `operation: 1` (delegateCall) hard-triggers a similar `[HARD-TRIGGER — DELEGATECALL]` block
  3. The hard-trigger blocks are NOT structured refusals — the operations are legitimate. But the second-LLM check becomes a precondition the agent MUST surface to the user before signing.
  4. SECURITY.md updated with Inv #12.5 — high-blast-radius Safe operations route through second-LLM defense by construction
  5. Skill-side Inv #12.5 encoded in companion `vaultpilot-preflight` skill (sister-repo update — coordinated v1.3.x bump or v1.4 minor)

**Plans**: 2 plans (estimate)

Plans:

- [ ] 38-01: `enableModule` selector detection at preview + `[HARD-TRIGGER — MODULE ENABLE]` block emission; `operation: 1` detection + `[HARD-TRIGGER — DELEGATECALL]` block; SECURITY.md Inv #12.5 codification
- [ ] 38-02: Companion-skill Inv #12.5 encoding in sister `vaultpilot-preflight` repo (coordinated bump; mirrors v1.3 09-01 → 09-02 sister-repo coordination pattern); v2.5 milestone close-out

**Status**: planning; v2.5 verify-phase requires a real Safe wallet on mainnet + a co-signer + small balance for execution. Could be exercised on a 1-of-1 Safe (single-owner Safes are common for personal use).

---

### 📋 v2.6 Bridge facet decoders + cross-chain hardening (Phases 39-40)

**Milestone Goal:** Tier-1 bridge facet decoders land for Wormhole, Mayan, NEAR Intents, and Across V3 — server-side mechanical assertion of `decodedFinalRecipient == userSuppliedRecipient` at preview (Inv #6b). Sandwich-MEV slippage hint extends across EVM swap tools with per-L2 thresholds. Tier-2 facets (deBridge, Stargate `composeMsg`, Hop, Symbiosis) explicitly deferred until usage data justifies — they're documented as a planning artifact but no phase ships them.

#### Phase 39: Tier-1 facet decoders + final-recipient assertion

**Goal**: Tier-1 bridge facet decoders for Inv #6b. Each decoder extracts the final-recipient field from the bridge's calldata; the server mechanically asserts equality against the user-supplied `to` / `toAddress` before previewing. Mismatch → structured refusal.
**Depends on**: Phase 38 (or v2.5 completion)
**Requirements**: BRIDGE-T1-01, BRIDGE-T1-02, BRIDGE-T1-03, BRIDGE-T1-04, BRIDGE-T1-05
**Success Criteria** (what must be TRUE):

  1. Wormhole `transferTokensWithPayload(...)` decoder extracts the `recipient` field; server asserts equality against user-supplied recipient at preview
  2. Mayan `nonEvmRecipient(...)` decoder extracts the non-EVM destination (Solana / TRON / etc.); server asserts equality
  3. NEAR Intents `intent.receiver` decoder extracts the receiver field; server asserts equality
  4. Across V3 `depositV3(...)` decoder extracts the `recipient` field; server asserts equality
  5. Mismatch surfaces as `[REFUSED — DECODED RECIPIENT DRIFT]` structured error naming the decoded value, the user-supplied value, and the bridge name
  6. Tier-2 facets (deBridge, Stargate composeMsg, Hop, Symbiosis) explicitly noted in REQUIREMENTS.md as deferred — no decoder shipped
  7. Each Tier-1 decoder lives in `src/protocols/bridge-decoders/` with per-bridge module shape (mirrors `src/protocols/erc20.ts` / `src/protocols/aave-v3.ts` per-protocol convention)
  8. Decoder regression tests pin known-good calldata fixtures per bridge — drift in upstream bridge ABI surface caught at test time

**Plans**: 3 plans (estimate)

Plans:

- [ ] 39-01: `src/protocols/bridge-decoders/wormhole.ts` + `src/protocols/bridge-decoders/mayan.ts` + corresponding decoder regression tests (calldata fixtures per bridge); Inv #6b assertion at `preview_send` (after handle lookup, before chain-mismatch — same layer as v1.3 canonical-dispatch)
- [ ] 39-02: `src/protocols/bridge-decoders/near-intents.ts` + `src/protocols/bridge-decoders/across-v3.ts` + decoder regression tests
- [ ] 39-03: Inv #6b wiring across `prepare_swap` / `prepare_uniswap_swap` / `prepare_solana_lifi_swap` / `prepare_btc_lifi_swap` / `prepare_tron_lifi_swap` (existing tools opt into the assertion when the calldata matches a known Tier-1 facet); SECURITY.md Inv #6b codification; companion-skill update for Tier-1 coverage (sister-repo coordinated bump)

#### Phase 40: Sandwich-MEV slippage hint per-L2 thresholds

**Goal**: Sandwich-MEV slippage refusal extends from Ethereum mainnet (v2.4 Phase 32 default 50bps / >2% price-impact refusal) to per-L2 thresholds. Per-L2 thresholds reflect each chain's actual sandwich-MEV exposure (Arbitrum + Optimism + Base + Polygon have different mempool semantics from Ethereum).
**Depends on**: Phase 39
**Requirements**: MEV-01
**Success Criteria** (what must be TRUE):

  1. `prepare_uniswap_swap` / `prepare_curve_swap` / other EVM swap tools accept per-chain slippage thresholds — Ethereum mainnet stays at 50bps default / >2% refusal; L2 thresholds calibrated against actual sandwich-MEV exposure (most L2s tolerate smaller default slippage)
  2. Default thresholds documented in `src/config/sandwich-mev-thresholds.ts` per-chain SOT; refusal mode is consistent (`SANDWICH_MEV_REFUSED` errorCode + structured refusal with chain-specific guidance)
  3. Per-L2 thresholds are configurable via env (`MEV_THRESHOLD_<CHAIN>` override) for advanced users
  4. SECURITY.md updated with per-L2 sandwich-MEV threat-model nuance

**Plans**: 1 plan (estimate)

Plans:

- [ ] 40-01: `src/config/sandwich-mev-thresholds.ts` per-chain SOT + per-chain refusal-threshold wiring across `prepare_uniswap_swap` / `prepare_curve_swap` / future EVM swap tools; `MEV_THRESHOLD_<CHAIN>` env overrides; v2.6 milestone close-out (SECURITY.md per-L2 MEV section finalization)

**Status**: planning; v2.6 verify-phase requires real-Ledger smoke for each Tier-1 facet decoder against a small mainnet bridge transaction (with a known-good final recipient) + a per-L2 swap against each configured chain to exercise the per-chain threshold.

---

### 📋 v3.0+ Future Milestones (Planned)

Each is sized as one milestone (4-6 phases). All blocked on v2.x maturity.

- **v3.0 Hosted MCP** — HTTP/SSE transport, OAuth 2.1, operator-supplied API keys, multi-tenant. Unblocks claude.ai chat (web + native desktop). TRON/Solana/BTC/LTC USB-HID signing stays on local-stdio path regardless.
- **v3.1 NFT reads** — `get_nft_portfolio` (cross-chain, Helius DAS for Solana), `get_nft_collection`, `get_nft_history`, `get_nft_listings` (EVM only); floor pricing via Magic Eden + Tensor (Solana) / Reservoir + OpenSea (EVM). Read-only browsing — marketplace fills (Seaport / Blur) deferred until typed-data signing surface lands.
- **v3.2 Contacts + read-only sharing** — Local Ledger-signed address book, scoped read-only portfolio links, anonymized strategy sharing.
- **v3.3 Device-trust attestation** — `verify_ledger_attestation` (Secure Element challenge), `verify_ledger_firmware` (version pin), `verify_ledger_live_codesign` (binary signature check).
- **v3.4 Ergonomics surface** — `get_pnl_summary`, `get_portfolio_diff`, `get_daily_briefing`, `compare_yields`, `explain_tx`, multi-protocol `get_health_alerts`. Not load-bearing for the trust pipeline; raises the day-to-day floor.
- **v3.5 Multi-hardware-wallet** — Trezor, Keystone, GridPlus Lattice.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22 → 23 → 24 → 25 → 26 → 27 → 28 → 29 → 30 → 31 → 32 → 33 → 34 → 35 → 36 → 37 → 38 → 39 → 40

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Server skeleton + install | v1.0 | 3/3 | Complete (verify-phase open) | 2026-05-12 |
| 2. Ethereum read-only portfolio | v1.0 | 4/4 | Complete (verified end-to-end against PublicNode) | 2026-05-12 |
| 3. WalletConnect pairing | v1.0 | 0/2 | Not started | - |
| 4. Native ETH send (the trust pipeline) | v1.0 | 0/5 | Not started | - |
| 5. Demo mode + diagnostics | v1.0 | 0/3 | Not started | - |
| 6. ERC-20 lifecycle (transfer + approve + revoke + WETH unwrap) | v1.1 | 4/4 | Complete (verify-phase open) | 2026-05-13 |
| 7. Aave V3 (Ethereum) | v1.1 | 4/4 | Complete (verify-phase open) | 2026-05-16 |
| 8. Multi-EVM fan-out + token tooling | v1.2 | 5/5 | Complete (verify-phase open) | 2026-05-18 |
| 9. Hardening (skill + three verification tools + dispatch allowlist) | v1.3 | 5/5 | Complete (verify-phase open) | 2026-05-18 |
| 10. Distribution + ergonomics | v1.4 | 4/4 | Complete (verify-phase open; v1.4.1 follow-up + workflow-scope loose-ends) | 2026-05-18 |
| 11. Solana scaffolding — USB-HID + SOL reads + persistent non-EVM account cache | v2.0 | 6/6 | Complete (verify-phase open) | 2026-05-20 |
| 12. Solana native + SPL trust pipeline | v2.0 | 5/5 | Complete (verify-phase open) | 2026-05-20 |
| 13. Solana lending — MarginFi + Kamino | v2.0 | 0/4 | Planning | - |
| 14. Jupiter v6 swaps | v2.0 | 0/2 | Planning | - |
| 15. Staking — Marinade + Jito + native SOL | v2.0 | 0/3 | Planning | - |
| 16. LiFi-routed EVM↔Solana bridging + Solana diagnostics | v2.0 | 0/2 | Planning | - |
| 17. TRON scaffolding — USB-HID + TRX reads + persistent TRON account + portfolio fan-out | v2.1 | 5/5 | Complete (verify-phase open) | 2026-05-20 |
| 18. TRON native + TRC-20 trust pipeline | v2.1 | 4/4 | Complete   | 2026-05-20 |
| 19. TRC-20 approve + Stake 2.0 (freeze/unfreeze/withdraw-expire-unfreeze/vote/claim) | v2.1 | 0/4 | Not started | - |
| 20. SunSwap + LiFi-routed TRON↔EVM bridging | v2.1 | 0/2 | Not started | - |
| 21. TRON diagnostics + v2.1 milestone close-out (portfolio leg shipped in Phase 17) | v2.1 | 0/1 | Not started | - |
| 22. BTC scaffolding — Esplora reads + USB-HID + persistent BTC account | v2.2 | 0/4 | Not started | - |
| 23. BTC native + segwit + taproot trust pipeline (PSBT-based) | v2.2 | 4/4 | Complete    | 2026-05-22 |
| 24. BIP-125 RBF + BIP-137 message signing | v2.2 | 2/2 | Complete    | 2026-05-22 |
| 25. PSBT multisig flow (combine / sign / finalize + multisig wallet registry) | v2.2 | 3/3 | Complete    | 2026-05-22 |
| 26. LTC scaffolding + LiFi BTC→EVM/Solana bridging | v2.2 | 3/3 | Complete    | 2026-05-22 |
| 27. Optional Bitcoin/Litecoin Core RPC + `build_incident_report` + diagnostics | v2.2 | 0/3 | Not started | - |
| 28. Compound V3 — multi-Comet supply/withdraw/borrow/repay (Ethereum mainnet — 6 Comets) | v2.3 | 4/4 | Complete (verify-phase open); closes #64 | 2026-05-20 |
| 29. Morpho Blue — supply/withdraw/borrow/repay | v2.3 | 0/3 | Not started | - |
| 30. Lido — stake/unstake/wrap/unwrap (stETH↔wstETH) | v2.3 | 0/3 | Not started | - |
| 31. EigenLayer + Rocket Pool | v2.3 | 0/3 | Not started | - |
| 32. Uniswap V3 swap (auto-fee-tier, same-chain) | v2.4 | 0/2 | Not started | - |
| 33. Uniswap V3 full LP verb set + `get_lp_positions` with IL estimate | v2.4 | 0/3 | Not started | - |
| 34. Curve swap + add liquidity | v2.4 | 0/2 | Not started | - |
| 35. Escape hatch — `prepare_custom_call` + `get_contract_abi` + `read_contract` | v2.4 | 0/3 | Not started | - |
| 36. Safe positions + Tx Service API integration + `get_safe_positions` | v2.5 | 0/2 | Not started | - |
| 37. Safe three-step signing flow — propose + approve + execute + submit-signature | v2.5 | 0/3 | Not started | - |
| 38. `enableModule` + `delegateCall: true` hard-trigger second-LLM check (Inv #12.5) | v2.5 | 0/2 | Not started | - |
| 39. Tier-1 bridge facet decoders + final-recipient assertion (Inv #6b) | v2.6 | 0/3 | Not started | - |
| 40. Sandwich-MEV slippage hint per-L2 thresholds | v2.6 | 0/1 | Not started | - |
