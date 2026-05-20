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
import "./pair_ledger_live.js";
import "./pair_ledger_live_start.js";
import "./pair_ledger_live_wait.js";
import "./get_ledger_status.js";
import "./pair_solana_ledger.js";
import "./get_solana_status.js";
import "./pair_tron_ledger.js"; // Phase 17 Plan 17-03 (TRON-PAIR-01)
import "./get_tron_status.js"; // Phase 17 Plan 17-03 (TRON-PAIR-02)
import "./get_tron_balance.js"; // Phase 17 Plan 17-03 (TRON-READ-01)
import "./get_tron_token_balance.js"; // Phase 17 Plan 17-03 (TRON-READ-02)
import "./get_tron_block_tip.js"; // Phase 17 Plan 17-03 (TRON-READ-03)
import "./list_paired_non_evm_accounts.js";
import "./remove_paired_non_evm_account.js";
import "./prepare_native_send.js";
import "./prepare_token_send.js";
import "./prepare_solana_native_send.js"; // Phase 12 Plan 12-02 (SOL-W-01) — Solana native send
import "./prepare_token_approve.js";
import "./prepare_revoke_approval.js";
import "./prepare_weth_unwrap.js";
import "./prepare_aave_supply.js";
import "./prepare_aave_withdraw.js";
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
