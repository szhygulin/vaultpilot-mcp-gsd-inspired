import "./resolve_ens_name.js";
import "./reverse_resolve_ens.js";
import "./get_token_balance.js";
import "./get_token_metadata.js";
import "./check_contract_security.js";
import "./resolve_token.js";
import "./get_token_allowances.js";
import "./get_transaction_status.js";
import "./get_portfolio_summary.js";
import "./get_solana_balance.js";
import "./get_solana_token_balance.js";
import "./get_solana_token_metadata.js";
import "./get_lending_positions.js";
import "./get_morpho_positions.js"; // Phase 29 Plan 29-02 (MOR-01) — Morpho Blue isolated-market positions on Ethereum mainnet
import "./get_compound_market_info.js";  // Phase 28 Plan 28-04 (CMP-02) — Compound V3 per-Comet market info
import "./pair_ledger_live.js";
import "./pair_ledger_live_start.js";
import "./pair_ledger_live_wait.js";
import "./get_ledger_status.js";
import "./pair_solana_ledger.js";
import "./get_solana_status.js";
import "./pair_tron_ledger.js"; // Phase 17 Plan 17-03 (TRON-PAIR-01)
import "./pair_btc_ledger.js"; // Phase 22 Plan 22-02 (BTC-PAIR-01) — dual-address (segwit + taproot) pair
import "./pair_litecoin_ledger.js"; // Phase 26 Plan 26-01 (LTC-PAIR-01) — dual-address (legacy + segwit) LTC pair
import "./get_btc_balance.js"; // Phase 22 Plan 22-03 (BTC-READ-01) — single-address BalanceReport via Esplora
import "./get_btc_balances.js"; // Phase 22 Plan 22-03 (BTC-READ-02) — parallel segwit + taproot via Promise.allSettled
import "./get_btc_account_balance.js"; // Phase 22 Plan 22-03 (BTC-READ-03) — xpub gap-limit-respecting scan
import "./get_btc_tx_history.js"; // Phase 22 Plan 22-03 (BTC-READ-04) — paginated tx history via Esplora cursor
import "./get_btc_fee_estimates.js"; // Phase 22 Plan 22-03 (BTC-READ-05) — Esplora /fee-estimates → 5-key projection (ROADMAP SC #7)
import "./get_litecoin_balance.js"; // Phase 26 Plan 26-01 (LTC-READ-01) — single-address litoshi BalanceReport via litecoinspace.org
import "./get_litecoin_tx_history.js"; // Phase 26 Plan 26-01 (LTC-READ-02) — paginated tx history via litecoinspace.org Esplora cursor
import "./get_litecoin_fee_estimates.js"; // Phase 26 Plan 26-01 (LTC-READ-02) — /v1/fees/recommended → 5-key sat/vB shape
import "./get_btc_block_tip.js"; // Phase 27 Plan 27-01 (BTC-FORENSIC-02) — chain tip via Core 2-call sequence + Esplora fallback
import "./get_btc_block_stats.js"; // Phase 27 Plan 27-01 (BTC-FORENSIC-03) — per-block tx stats + fee percentiles + segwit adoption
import "./get_btc_blocks_recent.js"; // Phase 27 Plan 27-01 (BTC-FORENSIC-04) — last N blocks via Core getblockstats batch + Esplora fallback
import "./get_btc_chain_tips.js"; // Phase 27 Plan 27-01 (BTC-FORENSIC-04 / reorg detection) — getchaintips + reorgSignals derivation
import "./get_btc_mempool_summary.js"; // Phase 27 Plan 27-02 (BTC-FORENSIC-05) — Core-only mempool census via getmempoolinfo
import "./get_litecoin_block_tip.js"; // Phase 27 Plan 27-02 (LTC-FORENSIC-01 / tip) — chain tip via Core 2-call sequence + litecoinspace.org Esplora fallback
import "./get_litecoin_mempool_summary.js"; // Phase 27 Plan 27-02 (LTC-FORENSIC-01 / mempool) — Core-only mempool census via getmempoolinfo
import "./build_incident_report.js"; // Phase 27 Plan 27-03 (BTC-INC-01) — cross-chain anomaly aggregator
import "./get_btc_status.js"; // Phase 22 Plan 22-04 (BTC-PAIR-02) — dual-address (segwit + taproot) pairing status
import "./get_tron_status.js"; // Phase 17 Plan 17-03 (TRON-PAIR-02)
import "./get_tron_balance.js"; // Phase 17 Plan 17-03 (TRON-READ-01)
import "./get_tron_token_balance.js"; // Phase 17 Plan 17-03 (TRON-READ-02)
import "./get_tron_block_tip.js"; // Phase 17 Plan 17-03 (TRON-READ-03)
import "./list_paired_non_evm_accounts.js";
import "./remove_paired_non_evm_account.js";
import "./prepare_native_send.js";
import "./prepare_token_send.js";
import "./prepare_solana_native_send.js"; // Phase 12 Plan 12-02 (SOL-W-01) — Solana native send
import "./prepare_solana_spl_send.js"; // Phase 12 Plan 12-03 (SOL-W-02) — Solana SPL TransferChecked send
import "./prepare_btc_send.js"; // Phase 23 Plan 23-03 (BTC-PSBT-01) — BTC native segwit+taproot PSBT send
import "./prepare_btc_rbf_bump.js"; // Phase 24 Plan 24-01 (BTC-W-02) — BIP-125 RBF fee bump
import "./prepare_litecoin_native_send.js"; // Phase 26 Plan 26-02 (LTC-W-01) — LTC native segwit P2WPKH PSBT send
import "./prepare_btc_lifi_swap.js"; // Phase 26 Plan 26-03 (BTC-LIFI-01) — BTC→EVM/SOL LiFi cross-chain swap
import "./sign_message_btc.js"; // Phase 24 Plan 24-02 (BTC-W-03) — BIP-137 compact message signing
import "./sign_message_ltc.js"; // Phase 26 Plan 26-02 (LTC-W-02) — BIP-137 compact message signing (LTC magic bytes)
// Phase 25 Plan 25-01 — BTC multisig registry + read tools (BTC-PSBT-03/04)
import "./register_btc_multisig_wallet.js"; // Phase 25 Plan 25-01 (BTC-PSBT-03) — multisig wallet registration
import "./get_btc_multisig_balance.js"; // Phase 25 Plan 25-01 (BTC-PSBT-04) — aggregate balance via Esplora gap-limit scan
import "./get_btc_multisig_utxos.js"; // Phase 25 Plan 25-01 (BTC-PSBT-04) — raw UTXO list via Esplora gap-limit scan
import "./combine_btc_psbts.js"; // Phase 25 Plan 25-02 (BTC-PSBT-05) — co-signer PSBT merge with pre-combine conflict scan
import "./sign_btc_multisig_psbt.js"; // Phase 25 Plan 25-03 (BTC-PSBT-06) — multisig PSBT prepare→preview→send via kind: multisig-psbt
import "./finalize_btc_psbt.js"; // Phase 25 Plan 25-03 (BTC-PSBT-07) — threshold-enforced PSBT finalizer (direct transform)
import "./prepare_tron_native_send.js"; // Phase 18 Plan 18-02 (TRON-W-01) — TRON native transfer
import "./prepare_tron_trc20_send.js";  // Phase 18 Plan 18-03 (TRON-W-02) — TRC-20 transfer
import "./prepare_tron_token_approve.js";   // Phase 19 Plan 19-01 (TRON-PREP-05) — TRC-20 approve
import "./prepare_tron_revoke_approval.js"; // Phase 19 Plan 19-01 (TRON-W-03) — TRC-20 revoke
import "./prepare_tron_stake_freeze.js";             // Phase 19 Plan 19-02 (TRON-W-04) — Stake 2.0 freeze
import "./prepare_tron_stake_unfreeze.js";           // Phase 19 Plan 19-02 (TRON-W-05) — Stake 2.0 unfreeze
import "./prepare_tron_withdraw_expire_unfreeze.js"; // Phase 19 Plan 19-02 (TRON-W-06) — Stake 2.0 withdraw-expire
import "./prepare_tron_stake_vote.js";               // Phase 19 Plan 19-03 (TRON-W-06) — Stake 2.0 vote
import "./prepare_tron_stake_claim_rewards.js";      // Phase 19 Plan 19-03 (TRON-W-07) — Stake 2.0 claim rewards
import "./get_tron_setup_status.js";                  // Phase 21 Plan 21-01 (TRON-DIAG-01) — TRON setup diagnostic
import "./get_sunswap_quote.js";                       // Phase 20 Plan 20-01 (TRON-W-09) — SunSwap V2 quote
import "./prepare_sunswap_swap.js";                    // Phase 20 Plan 20-01 (TRON-W-09) — SunSwap V2 swap + sandwich-MEV gate
import "./prepare_token_approve.js";
import "./prepare_revoke_approval.js";
import "./prepare_weth_unwrap.js";
import "./prepare_aave_supply.js";
import "./prepare_aave_withdraw.js";
import "./prepare_compound_supply.js";   // Phase 28 Plan 28-02 (CMP-03) — Compound V3 supply
import "./prepare_compound_withdraw.js"; // Phase 28 Plan 28-02 (CMP-04) — Compound V3 withdraw
import "./prepare_compound_borrow.js";   // Phase 28 Plan 28-03 (CMP-05) — Compound V3 borrow (reverse-intent sibling of withdraw)
import "./prepare_compound_repay.js";    // Phase 28 Plan 28-03 (CMP-05) — Compound V3 repay (reverse-intent sibling of supply; MAX_UINT256 sentinel)
import "./prepare_morpho_borrow.js";              // Phase 29 Plan 29-03 (MOR-03) — Morpho Blue borrow (collateral-present gate)
import "./prepare_morpho_repay.js";               // Phase 29 Plan 29-03 (MOR-04) — Morpho Blue repay (repay-max via position.borrowShares)
import "./prepare_morpho_supply.js";              // Phase 29 Plan 29-03 (MOR-02) — Morpho Blue supply (lender position)
import "./prepare_morpho_supply_collateral.js";   // Phase 29 Plan 29-03 (MOR-03) — Morpho Blue supplyCollateral
import "./prepare_morpho_withdraw.js";            // Phase 29 Plan 29-03 (MOR-03) — Morpho Blue withdraw (toAssetsDown for "max")
import "./prepare_morpho_withdraw_collateral.js"; // Phase 29 Plan 29-03 (MOR-03) — Morpho Blue withdrawCollateral
import "./get_lido_positions.js";         // Phase 30 Plan 30-02 (LIDO-01) — stETH + wstETH positions (Ethereum + Arbitrum)
import "./prepare_lido_stake.js";         // Phase 30 Plan 30-03 (LIDO-02) — ETH → stETH (Lido.submit value-bearing)
import "./prepare_lido_unstake.js";       // Phase 30 Plan 30-03 (LIDO-03) — stETH withdrawal queue (NFT receipt)
import "./prepare_lido_wrap.js";          // Phase 30 Plan 30-03 (LIDO-04) — stETH → wstETH (WstETH.wrap)
import "./prepare_lido_unwrap.js";        // Phase 30 Plan 30-03 (LIDO-04) — wstETH → stETH (WstETH.unwrap)
import "./get_eigenlayer_positions.js";   // Phase 31 Plan 31-02 (EIG-01) — EigenLayer strategy-level deposits + queued withdrawals
import "./prepare_eigenlayer_deposit.js"; // Phase 31 Plan 31-02 (EIG-02) — StrategyManager.depositIntoStrategy (3-arg ERC-20 + LEDGER NOTICE)
import "./get_rocketpool_positions.js";   // Phase 31 Plan 31-03 (RP-01) — rETH balance + exchange rate + ETH-equivalent value
import "./prepare_rocketpool_stake.js";   // Phase 31 Plan 31-03 (RP-02 stake) — RocketDepositPool.deposit (value-bearing; 0xd0e30db0 collides with WETH9.deposit — preview_send tuple-dispatches)
import "./prepare_rocketpool_unstake.js"; // Phase 31 Plan 31-03 (RP-02 unstake) — rETH.burn(uint256) (0x42966c68 is generic ERC-20 Burnable — preview_send tuple-dispatches)
import "./get_uniswap_quote.js"; // Phase 32 Plan 32-02 (UNI-01) — Uniswap V3 quote with auto-fee-tier + multi-hop + sandwich-MEV warning
import "./prepare_uniswap_swap.js"; // Phase 32 Plan 32-03 (UNI-02 + UNI-03) — Uniswap V3 swap + sandwich-MEV gate + token-approval pre-flight + multicall+deadline composition + unconditional LEDGER NOTICE
import "./get_lp_positions.js"; // Phase 33 Plan 33-01 (UNI-04) — Uniswap V3 LP positions + IL estimate
import "./prepare_uniswap_v3_mint.js";               // Phase 33 Plan 33-02 (UNI-05) — NPM.mint with tick snap + approval pre-flight (token0+token1) + LEDGER NOTICE
import "./prepare_uniswap_v3_increase_liquidity.js"; // Phase 33 Plan 33-02 (UNI-06) — NPM.increaseLiquidity with approval pre-flight (token0+token1) + LEDGER NOTICE
import "./prepare_uniswap_v3_decrease_liquidity.js"; // Phase 33 Plan 33-02 (UNI-06) — NPM.decreaseLiquidity with "does NOT transfer" notice + LEDGER NOTICE
import "./prepare_uniswap_v3_collect.js";            // Phase 33 Plan 33-02 (UNI-07) — NPM.collect with MAX_UINT128 sentinel default + LEDGER NOTICE
import "./prepare_uniswap_v3_burn.js";               // Phase 33 Plan 33-02 (UNI-08) — NPM.burn with non-empty-position pre-flight refusal + LEDGER NOTICE (selector 0x42966c68 collides with Phase 31 rETH.burn)
import "./simulate_position_change.js";
import "./preview_send.js";
import "./send_transaction.js";
import "./get_tx_verification.js";
import "./verify_tx_decode.js";
import "./get_verification_artifact.js";
import "./get_demo_wallet.js";
import "./set_demo_wallet.js";
import "./set_active_account.js";
import "./get_vaultpilot_config_status.js";
import "./get_ledger_device_info.js";
import "./request_capability.js"; // Phase 10 Plan 10-04 (DIST-43) — side-effect register

export function registerAllTools(): void {
  // Tool modules register on import. Phase 2+ adds imports above this comment.
}
