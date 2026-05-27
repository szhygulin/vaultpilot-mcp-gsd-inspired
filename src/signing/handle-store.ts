// In-process state machine for prepare → preview → send | cancelled handles
// (research § Pattern 1 lines 188–331). The four Phase 4 signing-flow tools
// (prepare_native_send / preview_send / send_transaction / get_tx_verification)
// mutate this store via the typed transition API; no persistence by design
// (matches Phase 3's `:memory:` discipline — Pitfall 5 in 03-RESEARCH; Plan
// 04-05's get_tx_verification surfaces "process restart loses handles" to
// the agent through its tool description).
//
// Lazy TTL eviction (research § Q5): a `setInterval` sweep would force
// vitest to babysit a timer and complicates test isolation. We delete the
// record inside `lookup` when `Date.now() > createdAt + HANDLE_TTL_MS`.
//
// Cross-ref: research § Pattern 1 (HandleRecord shape, transitionTo* sketches),
// research § Q1 (transitionToCancelled added for userDecision: "cancel" path),
// research § Q4 (idempotent re-preview semantics — last-write wins).
//
// Phase 18 — Plan 18-01 widening: `PreparedTx` literal-union further widens to
// `PreparedTxEvm | PreparedTxSolana | PreparedTxTron`. New `PreparedTxTron`
// interface mirrors `PreparedTxSolana` sentinel-fields pattern with TRON-specific
// cryptographic-binding fields. `txType` literal-union widens from `"evm" | "solana"`
// to `"evm" | "solana" | "tron"` (CONTEXT D-10). The rawDataObject persistence
// rationale is documented in 18-RESEARCH §Topic 7.
// State machine + TTL + handle lifecycle BYTE-IDENTICAL.

import type { Address, Hex } from "viem";

import type { ChainId } from "../config/contracts.js";
import type { ErrorCode } from "./error-codes.js";
import type {
  SafeEIP712TypedData,
  SafeOperation,
  SupportedSafeVersion,
} from "./safe-tx-hash.js";

export const HANDLE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export type HandleStatus = "prepared" | "previewed" | "sent" | "cancelled";

/**
 * Raw args as the agent passed them — typed as `string` (NOT `Address`,
 * NOT `bigint`) so the type system itself blocks normalization at the
 * storage boundary. PREP-02 surfaces these verbatim in the PREPARE RECEIPT
 * block; a future contributor cannot accidentally checksum-case the address
 * or trim the value because the type wouldn't allow it.
 *
 * Phase 6 — Plan 06-02 additive widening. The ERC-20 prepare tools populate
 * a subset of the optional fields alongside the existing `to` / `valueWei`:
 *
 *   - `prepare_token_send`     → `tokenAddress` + `amount` (plus the existing `to`;
 *                                 `valueWei` set to `"0"`)
 *   - `prepare_token_approve`  → `tokenAddress` + `spender` + `amount` (Plan 06-03;
 *                                 `to` set to empty string, `valueWei` to `"0"`)
 *   - `prepare_revoke_approval`→ `tokenAddress` + `spender` (Plan 06-03;
 *                                 `amount` set to `"0"`)
 *   - `prepare_weth_unwrap`    → `tokenAddress` + `amount` (Plan 06-04;
 *                                 no `to`, no `spender`)
 *
 * Format-fanout-sentinel: every new field is `string` (NOT Address / NOT
 * bigint) so the same normalization-at-storage guard applies. Phase 4
 * native-send callers are unchanged at runtime — all new fields are
 * optional.
 */
export interface PrepareArgs {
  to: string;
  valueWei: string;
  /** Phase 6 — ERC-20 token contract address (raw agent string). */
  tokenAddress?: string;
  /** Phase 6 — decimal-string amount in human units (e.g. `"100.5"`). */
  amount?: string;
  /** Phase 6 — approve/revoke spender address (raw agent string). */
  spender?: string;
  /** Phase 12 — SPL mint pubkey, base58 (raw agent string). Populated by `prepare_solana_spl_send` (Plan 12-03). */
  mint?: string;
  /** Phase 12 — native SOL amount as raw lamports decimal string. Populated by `prepare_solana_native_send` (Plan 12-02). */
  lamports?: string;
  /** Phase 12 — pinned recent blockhash, base58 (raw agent string when surfaced; server-derived at prepare time). */
  recentBlockhash?: string;
  /** Phase 18 — native TRX amount as raw sun decimal string. Populated by `prepare_tron_native_send` (Plan 18-02). */
  sun?: string;
  /** Phase 18 — agent-supplied expiration override in seconds (optional; defaults to 900 = 15min in encoder). */
  expiration?: string;
  /** Phase 18 — pinned ref-block fields (server-derived at prepare time; surfaced in PREPARE RECEIPT). */
  refBlockBytes?: string;
  refBlockHash?: string;
  /** Phase 20 — SunSwap V2 swap input token TRC-20 address (raw agent string; surfaced in PREPARE RECEIPT). */
  inputToken?: string;
  /** Phase 20 — SunSwap V2 swap output token TRC-20 address (raw agent string; surfaced in PREPARE RECEIPT). */
  outputToken?: string;
  /** Phase 20 — SunSwap V2 slippage tolerance in basis points as decimal string (e.g. "50"). */
  slippageBps?: string;
  /** Phase 23 — BTC native amount as raw satoshis decimal string (e.g. "100000"). Populated by `prepare_btc_send` (Plan 23-03). */
  sats?: string;
  /** Phase 26 — LTC native amount as raw litoshis decimal string (e.g. "100000"). Populated by `prepare_litecoin_native_send` (Plan 26-02). */
  litoshi?: string;
  /**
   * Phase 35 Plan 35-03 — raw calldata hex (0x-prefixed) for
   * `prepare_custom_call`. Surfaced verbatim in the PREPARE RECEIPT block
   * (`{DATA}` slot of CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE) so the agent
   * cannot rewrite it between the receipt and preview/send. Other prepare_*
   * tools encode calldata server-side and leave this slot undefined; the
   * receipt body for those tools renders semantic args (amount, token, etc.)
   * instead.
   */
  data?: string;
}

/**
 * Phase 12 — decoded SPL / native instruction summary surfaced in the
 * DECODED ARGS block by preview_send Solana branch (Plan 12-04). Discriminated
 * union mirrors the EVM `Erc20Decoded` / `AaveV3Decoded` shape — preview_send
 * narrows via `kind`. Prepared by the Solana prepare tools (Plans 12-02 /
 * 12-03) and pinned onto `PreparedTxSolana.instructionSummary`.
 */
export type SolanaInstructionSummary =
  | {
      kind: "native-transfer";
      /** Source pubkey, base58. Server-derived from `feePayer` (always == sender for v1.x scope). */
      from: string;
      /** Destination pubkey, base58. */
      to: string;
      /** Raw lamports. */
      lamports: bigint;
    }
  | {
      kind: "spl-transfer-checked";
      /** SPL mint pubkey, base58. */
      mint: string;
      /** Source token-account address (ATA), base58. */
      sourceAta: string;
      /** Destination token-account address (ATA), base58. */
      destAta: string;
      /** Destination OWNER pubkey (NOT the destAta), base58. */
      destOwner: string;
      /** Raw token amount. */
      amount: bigint;
      /** Mint decimals (TransferChecked encodes decimals in the instruction data). */
      decimals: number;
    };

/**
 * Phase 18 — decoded TRON instruction summary surfaced in the DECODED ARGS
 * block by preview_send TRON branch (Plan 18-04). Discriminated union mirrors
 * the `SolanaInstructionSummary` shape — preview_send narrows via `kind`.
 * Prepared by the TRON prepare tools (Plans 18-02 / 18-03) and pinned onto
 * `PreparedTxTron.instructionSummary`.
 */
export type TronInstructionSummary =
  | {
      kind: "native-transfer";
      /** Sender base58check address. */
      from: string;
      /** Recipient base58check address. */
      to: string;
      /** Raw sun amount (bigint). 1 TRX = 1_000_000 sun. */
      sun: bigint;
    }
  | {
      kind: "trc20-transfer";
      /** Sender base58check address. */
      from: string;
      /** Recipient base58check address. */
      to: string;
      /** TRC-20 contract base58check address. */
      tokenAddress: string;
      /** Raw token amount (bigint), scaled per `decimals`. */
      amount: bigint;
      /** Token decimals (from `get_tron_token_metadata`). */
      decimals: number;
    }
  | {
      // Phase 19 Plan 19-01 — TRC-20 approve via `approve(spender, amount)` ABI.
      // selector: 0x095ea7b3 (distinct from transfer 0xa9059cbb).
      // Approve and revoke BOTH reuse `PreparedTxTron.kind: "trc20"` because they
      // are TriggerSmartContract dispatches; the semantic distinction lives here.
      kind: "trc20-approve";
      /** Sender base58check address. */
      from: string;
      /** TRC-20 contract base58check address. */
      tokenAddress: string;
      /** Approved spender base58check address. */
      spender: string;
      /** Raw approved amount (bigint), scaled per token decimals. */
      amount: bigint;
      /**
       * True iff `amount === U256_MAX` (strict equality per D-02a).
       * Read by preview_send approve arm to gate UNLIMITED_APPROVAL_TRON_TEMPLATE.
       * Name `amountIsMax` chosen over `isUnlimited` for grep-friendly clarity;
       * avoids collision with the decoder's local `isUnlimited` field.
       */
      amountIsMax: boolean;
      /**
       * Resolved label from KNOWN_SPENDERS_TRON, or the literal
       * `"(unknown spender — no prior interaction recorded)"` for unknown spenders.
       * Label is ADVISORY — on-device spender address is the trust anchor.
       */
      spenderLabel: string;
    }
  | {
      // Phase 19 Plan 19-01 — TRC-20 allowance revoke (approve with amount=0n).
      // D-01 byte-identity: calldata is IDENTICAL to `trc20-approve` with amount=0n;
      // the discriminator here is the SURFACE-LAYER distinction only.
      // NO `amount` field on revoke — the amount is always 0 by definition.
      kind: "trc20-revoke";
      /** Sender base58check address. */
      from: string;
      /** TRC-20 contract base58check address. */
      tokenAddress: string;
      /** Revoked spender base58check address. */
      spender: string;
      /**
       * Resolved label from KNOWN_SPENDERS_TRON, or the literal
       * `"(unknown spender — no prior interaction recorded)"` for unknown spenders.
       */
      spenderLabel: string;
    }
  | {
      // Phase 19 Plan 19-02 — TRON Stake 2.0 freeze (FreezeBalanceV2Contract).
      // Protobuf-native — no `contract_address` field. Caller-side dispatch-skip
      // in preview_send.ts (documented in canonical-dispatch-tron.ts comment block).
      // `sun` is the raw freeze amount (bigint); `resource` is the strict-equality
      // enum per D-03b. Kind name `"stake-freeze-v2"` disambiguates from any
      // hypothetical Stake 1.0 `"stake-freeze"` kind — version suffix is load-bearing.
      kind: "stake-freeze-v2";
      /** Sender base58check address. */
      from: string;
      /** Resource to freeze for — "ENERGY" or "BANDWIDTH" (strict-equality enum). */
      resource: "ENERGY" | "BANDWIDTH";
      /** Raw freeze amount in SUN (bigint). */
      sun: bigint;
    }
  | {
      // Phase 19 Plan 19-02 — TRON Stake 2.0 unfreeze (UnfreezeBalanceV2Contract).
      // Initiates the 14-day waiting period after which `prepare_tron_withdraw_expire_unfreeze`
      // becomes available. Protobuf-native — no `contract_address`.
      kind: "stake-unfreeze-v2";
      /** Sender base58check address. */
      from: string;
      /** Resource to unfreeze — "ENERGY" or "BANDWIDTH". */
      resource: "ENERGY" | "BANDWIDTH";
      /** Raw unfreeze amount in SUN (bigint). */
      sun: bigint;
    }
  | {
      // Phase 19 Plan 19-02 — TRON Stake 2.0 withdraw-expire-unfreeze
      // (WithdrawExpireUnfreezeContract). Zero-arg — the protocol auto-withdraws
      // all expired-unfreeze records for the owner. `from` is the owner address.
      // Mandatory Layer 0.7 refusal at preview time via `_tronStake.checkWithdrawableBalance`
      // when `withdrawable === 0n` (D-04b asymmetric promotion).
      kind: "stake-withdraw-expire";
      /** Sender / owner base58check address. */
      from: string;
    }
  | {
      // Phase 19 Plan 19-03 — TRON Stake 2.0 vote (VoteWitnessContract).
      // Array→map conversion is MANDATORY (T-VOTE-MAP). The vote() builder
      // requires { [srAddress: string]: number } NOT an array.
      // SR labels are ADVISORY per D-05c — the on-device vote_address is the
      // trust anchor. `srSource` is surfaced in CHECKS PERFORMED per D-05b.
      kind: "stake-vote";
      /** Voter base58check address. */
      from: string;
      /** Total vote power allocated across all SRs. */
      totalCount: number;
      /** Individual vote entries — srAddress, count, and advisory label. */
      votes: Array<{
        srAddress: string;
        count: number;
        label: string;
      }>;
    }
  | {
      // Phase 19 Plan 19-03 — TRON Stake 2.0 claim rewards (WithdrawBalanceContract).
      // Zero-arg. D-06c: NO intent-vs-reality gate at preview time.
      // `estimatedRewardSun` is advisory — null means not fetched / not applicable.
      // The tool layer MAY populate this from `tronWeb.trx.getReward(from)`.
      kind: "stake-claim-rewards";
      /** Sender base58check address. */
      from: string;
      /**
       * Advisory estimated reward in SUN (bigint), or null if not fetched.
       * D-06c: null is valid and never blocks the prepare flow.
       */
      estimatedRewardSun: bigint | null;
    }
  | {
      // Phase 20 Plan 20-01 — SunSwap V2 swap (TriggerSmartContract).
      // selector: 0x38ed1739 (swapExactTokensForTokens(uint256,uint256,address[],address,uint256)).
      // sandwich-MEV gate (D-03b): enforced at prepare time; preview emits advisory only.
      // `priceImpactBps` + `slippageBps` are integers (bps bounded by 10000, not bigint).
      // `inAmount` + `outAmount` + `amountOutMin` are bigint per CLAUDE.md decimal-aware arithmetic.
      kind: "sunswap-swap";
      /** Sender base58check address. */
      from: string;
      /** Input TRC-20 contract base58check address. */
      inputToken: string;
      /** Output TRC-20 contract base58check address (or WTRX). */
      outputToken: string;
      /** Raw input amount (bigint), scaled per input token decimals. */
      inAmount: bigint;
      /** Raw output amount from quote (bigint), scaled per output token decimals. */
      outAmount: bigint;
      /** Minimum output amount after slippage (bigint). amountOutMin = outAmount * (10000 - slippageBps) / 10000. */
      amountOutMin: bigint;
      /** Route taken — full address array (e.g. [USDT, WTRX] or [USDT, WTRX, JST]). */
      path: string[];
      /** Price impact in basis points (integer, 0–10000). 200 = 2% sandwich-MEV gate threshold. */
      priceImpactBps: number;
      /** Slippage tolerance in basis points (integer). */
      slippageBps: number;
      /** Swap deadline as unix-seconds integer. deadline = now + 600 (10 minutes). */
      deadline: number;
    };

/**
 * Decoded/typed shape of the prepared transaction, plus the preview-time-
 * pinned fields once the handle transitions to `previewed`. The viem-typed
 * fields (`Address`, `bigint`, `Hex`) live here, NOT on `PrepareArgs`.
 *
 * Phase 12 — Plan 12-01 widening: `PreparedTx` becomes a discriminated union
 * of `PreparedTxEvm` (default `txType?: "evm"` for back-compat with every
 * Phase 4-11 handle that omits the field) + `PreparedTxSolana` (required
 * `txType: "solana"`). The discriminator is the ONLY additive change —
 * state machine + TTL + handle lifecycle BYTE-IDENTICAL. Every existing call
 * site that builds an EVM `PreparedTx` stays byte-identical (the `txType?`
 * field is optional with default `"evm"`; downstream consumers narrow via
 * `record.tx.txType ?? "evm"`).
 */
export interface PreparedTxEvm {
  /** Optional discriminator — absent === "evm" (back-compat with every Phase 4-11 handle). */
  txType?: "evm";
  chainId: number;
  to: Address;
  valueWei: bigint;
  data: Hex;
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

/**
 * Solana prepared-tx shape. The Solana-specific fields (`messageBytes`,
 * `feePayer`, `recentBlockhash`, `programIds`) carry the cryptographic
 * binding inputs; the EVM-shape fields (`chainId`, `to`, `valueWei`,
 * `data`) are populated with SENTINEL ZEROS so the discriminated union
 * stays accessible without narrowing at every existing EVM call site.
 *
 * [Rule 2 - Auto-fix critical functionality] The plan defines
 * `PreparedTxSolana` with ONLY Solana-specific fields, which would force
 * every EVM-side consumer (preview_send, send_transaction,
 * get_tx_verification — all FROZEN per the success criteria) to add `if
 * (record.tx.txType === "solana")` narrowing or fail typecheck. The
 * plan's own `PreviewPinned` precedent already names the resolution:
 * "Solana branch populates with sentinel zeros for the EVM-specific
 * fields ... type-stability preserved" — the same pattern applies here.
 * Without the sentinels, the FROZEN-area assertion is impossible. With
 * the sentinels, EVM consumers see the union as a strict super-set of
 * `PreparedTxEvm` and stay byte-identical.
 *
 * Sentinel values are chosen to be obviously-not-real (chainId 0, zero
 * address, zero value, "0x" data) so any accidental EVM-side dispatch of
 * a Solana handle fails at the Layer 0.5 dispatch-target check rather
 * than silently degrading to a meaningless EVM call.
 */
export interface PreparedTxSolana {
  /** Required discriminator — Solana shape carries no implicit default. */
  txType: "solana";

  // ---------------------------------------------------------------------
  // EVM-shape sentinel fields (set to zero / empty values for Solana
  // handles). Present to keep the discriminated union accessible by
  // existing EVM-side consumers without forcing narrowing at every site.
  // EVM call paths that reach a Solana handle will hit the Layer 0.5
  // dispatch-target refusal before reading these — the sentinels are
  // defensive, not load-bearing.
  // ---------------------------------------------------------------------
  /** Sentinel — Solana has no `chainId`. Always 0. */
  chainId: number;
  /** Sentinel — Solana addresses are base58, not 0x-prefixed. Always the zero address. */
  to: Address;
  /** Sentinel — Solana uses `lamports`, not `valueWei`. Always 0n. */
  valueWei: bigint;
  /** Sentinel — Solana has no calldata. Always `"0x"`. */
  data: Hex;
  /** Sentinel — Solana has no EVM nonce. Always undefined. */
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;

  // ---------------------------------------------------------------------
  // Solana-specific cryptographic-binding fields. All populated by the
  // Solana prepare tools (Plans 12-02 / 12-03); consumed by the Solana
  // preview_send / send_transaction branches (Plans 12-04 / 12-05).
  // ---------------------------------------------------------------------
  /**
   * `Transaction.serializeMessage()` output — the canonical Solana message
   * bytes that flow into both `computeSolanaPayloadFingerprint` (DF-1
   * binding) AND `computeSolanaPresignHash` (DF-2 device display). Same
   * bytes for both — drift would break the on-device-hash-match trust
   * anchor.
   */
  messageBytes: Uint8Array;
  /** Fee-payer pubkey, base58. account_keys[0] of the serialized message — sender-dependent fingerprint by construction. */
  feePayer: string;
  /** Pinned recent blockhash, base58. Embedded in messageBytes; pinned separately for fast surface in receipts. */
  recentBlockhash: string;
  /** Program IDs touched, base58. Consumed by `canonical-dispatch-solana` (Plan 12-04 Layer 0.5 allowlist refusal). */
  programIds: string[];
  /** Optional decoded instruction summary — populated by Solana prepare tools, consumed by preview_send DECODED ARGS surface. */
  instructionSummary?: SolanaInstructionSummary[];
}

/**
 * TRON prepared-tx shape. Phase 18 — Plan 18-01. Mirrors the `PreparedTxSolana`
 * sentinel-fields pattern — EVM-shape sentinel fields allow existing EVM-side
 * consumers to remain BYTE-IDENTICAL without narrowing at every call site.
 * The discriminator (`txType: "tron"`) + TRON-specific fields carry the
 * cryptographic-binding inputs; the sentinel EVM fields are set to zero/empty
 * values so accidental EVM dispatch hits the Layer 0.5 canonical-dispatch-tron
 * refusal before reaching any meaningful EVM processing.
 *
 * `rawDataObject` is persisted as `unknown` to avoid leaking tronweb SDK types
 * into handle-store (Plan 18-04 send branch rebuilds the broadcast envelope
 * from this object). Rationale in 18-RESEARCH §Topic 7.
 */
export interface PreparedTxTron {
  /** Required discriminator — TRON shape. */
  txType: "tron";

  // -----------------------------------------------------------------------
  // EVM-shape sentinel fields (set to zero / empty values for TRON handles).
  // Present to keep the discriminated union accessible by existing EVM-side
  // consumers without forcing narrowing at every site. EVM call paths that
  // reach a TRON handle will hit the Layer 0.5 dispatch-target refusal
  // before reading these — the sentinels are defensive, not load-bearing.
  // -----------------------------------------------------------------------
  /** Sentinel — TRON has no EVM chainId. Always 0. */
  chainId: number;
  /** Sentinel — TRON addresses are base58check, not 0x-prefixed. Always the zero address. */
  to: Address;
  /** Sentinel — TRON uses sun, not valueWei. Always 0n. */
  valueWei: bigint;
  /** Sentinel — TRON has no EVM calldata. Always `"0x"`. */
  data: Hex;
  /** Sentinel — TRON has no EVM nonce. Always undefined. */
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;

  // -----------------------------------------------------------------------
  // TRON-specific cryptographic-binding fields. Populated by Plan 18-02 /
  // 18-03 prepare tools; consumed by Plan 18-04 preview_send / send branches.
  // -----------------------------------------------------------------------
  /**
   * Canonical Protobuf-serialized raw_data hex (no 0x prefix per tronweb
   * convention). Source of both payloadFingerprint preimage (DF-1) and
   * presignHash computation (DF-2 = SHA-256(raw_data) = transaction.txID).
   */
  rawDataHex: string;
  /**
   * Original tronweb raw_data object (typed as `unknown` to avoid leaking SDK
   * types into handle-store). Plan 18-04 send branch reconstructs the
   * broadcast envelope from this object. Rationale in 18-RESEARCH §Topic 7.
   */
  rawDataObject: unknown;
  /**
   * Pinned ref-block fields from prepare time. Surfaced verbatim in
   * PREPARE RECEIPT (Plans 18-02 + 18-03). Used by Plan 18-04 send branch
   * to validate the transaction has not expired.
   */
  refBlockBytes: string;
  refBlockHash: string;
  /**
   * Transaction expiration timestamp (ms since epoch). Plans 18-02 + 18-03
   * set this to `Date.now() + 900_000` (15 min) via `extendExpiration` per
   * 18-RESEARCH §Topic 5. Plan 18-04 checks `Date.now() < expiration` at
   * send time.
   */
  expiration: number;
  /**
   * TRON-specific discriminator — routes Layer 0.5 + Layer 0.7 dispatch at
   * preview_send TRON branch (Plan 18-04 + Plan 19-02).
   *   - `"native"` — skips canonical-dispatch-tron allowlist and simulation gate.
   *   - `"trc20"` — enforces Layer 0.5 allowlist + Layer 0.7 mandatory simulation gate.
   *   - `"stake-freeze"` — Stake 2.0 FreezeBalanceV2Contract; no contract_address;
   *                        Layer 0.5 caller-skip; Layer 0.7 advisory only (no simulation API).
   *   - `"stake-unfreeze"` — Stake 2.0 UnfreezeBalanceV2Contract; same skip as freeze.
   *   - `"stake-withdraw-expire"` — Stake 2.0 WithdrawExpireUnfreezeContract; no contract_address;
   *                                 Layer 0.7 MANDATORY refusal via `_tronStake.checkWithdrawableBalance`
   *                                 when `withdrawable === 0n` (D-04b asymmetric promotion).
   *
   * Note: the `kind` values here use shorter names (e.g. `"stake-freeze"`) vs
   * `TronInstructionSummary` (e.g. `"stake-freeze-v2"`). The routing discriminator
   * doesn't need the version suffix; the instruction summary uses it to
   * disambiguate Stake 1.0 should it ever appear in decoded payloads.
   */
  kind: "native" | "trc20" | "stake-freeze" | "stake-unfreeze" | "stake-withdraw-expire" | "stake-vote" | "stake-claim-rewards" | "sunswap-swap";
  /**
   * TRC-20 only — base58check token contract address. Consumed by
   * `canonical-dispatch-tron` allowlist (Plan 18-04 Layer 0.5 gate).
   * Undefined for native TRX handles.
   */
  contractAddress?: string;
  /**
   * Decoded instruction summary — populated by Plan 18-02 / 18-03 encoders;
   * consumed by Plan 18-04 DECODED ARGS surface.
   */
  instructionSummary?: TronInstructionSummary[];
}

// ---------------------------------------------------------------------------
// Phase 23 Plan 23-03 widening: PreparedTxBtc + BtcInstructionSummary.
// The PreparedTx union is widened ADDITIVELY — state machine + TTL logic
// BYTE-IDENTICAL (same pattern as Phase 12 Solana / Phase 18 TRON).
// ---------------------------------------------------------------------------

/**
 * Phase 23 — decoded BTC instruction summary for the DECODED ARGS block
 * in preview_send BTC branch (Plan 23-04). Mirrors `TronInstructionSummary`
 * at line 127 — discriminated union narrowed by `kind`. The `"native"`
 * kind covers all Phase 23 sends (segwit / taproot / mixed-input).
 */
export type BtcInstructionSummary = {
  kind: "native";
  /** Sender segwit address (bc1q…). */
  fromSegwit: string;
  /** Sender taproot address (bc1p…), if also used as an input. */
  fromTaproot?: string;
  /** Recipient address (bc1q… or bc1p… or legacy). */
  to: string;
  /** Amount being sent to the recipient in sats. */
  sats: bigint;
  /** Miner fee in sats. */
  feeSats: bigint;
};

/**
 * BTC prepared-tx shape. Phase 23 — Plan 23-03. Mirrors `PreparedTxTron`
 * (Phase 18 / Plan 18-01) sentinel-fields pattern — EVM-shape sentinel
 * fields allow existing EVM-side consumers to remain BYTE-IDENTICAL without
 * narrowing at every call site.
 *
 * The discriminator (`txType: "btc"`) + BTC-specific fields carry the
 * cryptographic-binding inputs for the PSBT-based signing trust pipeline
 * (BTC-PREP-01 / BTC-PSBT-01). Sentinel EVM fields are set to zero/empty
 * values so accidental EVM dispatch hits the Layer 0.5 dispatch-target
 * refusal before reaching any meaningful EVM processing.
 *
 * FROZEN guard: this interface is ADDITIVE TYPE SURFACE only. The handle-store
 * state machine + TTL + createHandle + transitionTo* logic is BYTE-IDENTICAL
 * (Phase 18 precedent at PreparedTxTron line 407).
 */
export interface PreparedTxBtc {
  /** Required discriminator — BTC UTXO-model shape. */
  txType: "btc";

  // -----------------------------------------------------------------------
  // EVM-shape sentinel fields (set to zero / empty values for BTC handles).
  // Present to keep the discriminated union accessible by existing EVM-side
  // consumers without forcing narrowing at every site. EVM call paths that
  // reach a BTC handle will hit the Layer 0.5 dispatch-target refusal
  // before reading these — the sentinels are defensive, not load-bearing.
  // -----------------------------------------------------------------------
  /** Sentinel — BTC has no EVM chainId. Always 0. */
  chainId: number;
  /** Sentinel — BTC addresses are bech32/bech32m, not 0x-prefixed. Always the zero address. */
  to: Address;
  /** Sentinel — BTC uses sats, not valueWei. Always 0n. */
  valueWei: bigint;
  /** Sentinel — BTC has no EVM calldata. Always `"0x"`. */
  data: Hex;
  /** Sentinel — BTC has no EVM nonce. Always undefined. */
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;

  // -----------------------------------------------------------------------
  // BTC-specific discriminator.
  // -----------------------------------------------------------------------
  /**
   * BTC send kind. `"native"` covers all Phase 23 sends (segwit / taproot /
   * mixed-input). `"rbf"` covers Phase 24 RBF replacement transactions.
   * `"multisig-psbt"` covers Phase 25 M-of-N multisig PSBT signing.
   */
  kind: "native" | "rbf" | "multisig-psbt";

  // -----------------------------------------------------------------------
  // RBF-only optional fields (Phase 24 — Plan 24-01).
  // Present only when `kind === "rbf"`. Carry original tx metrics through
  // the handle for the CHECKS PERFORMED diff block in preview_send.
  // -----------------------------------------------------------------------

  /**
   * The txid of the original mempool-pending transaction being replaced.
   * Non-null when `kind === "rbf"`. Used in PREPARE RECEIPT diff block.
   */
  originalTxid?: string;

  /**
   * The total miner fee of the original transaction in sats.
   * Non-null when `kind === "rbf"`. Used in PREPARE RECEIPT diff block.
   */
  originalFeeSats?: bigint;

  /**
   * The fee rate of the original transaction in sat/vB.
   * Non-null when `kind === "rbf"`. Used in PREPARE RECEIPT diff block.
   */
  originalFeeRate?: number;

  // -----------------------------------------------------------------------
  // Multisig-PSBT-only optional fields (Phase 25 — Plan 25-03).
  // Present only when `kind === "multisig-psbt"`.
  // -----------------------------------------------------------------------

  /**
   * Name of the registered multisig wallet from btc-multisig.json.
   * Non-null when `kind === "multisig-psbt"`.
   */
  multisigWalletName?: string;

  /**
   * Threshold M for this multisig wallet.
   * Non-null when `kind === "multisig-psbt"`.
   */
  multisigThreshold?: number;

  /**
   * Total signers N for this multisig wallet.
   * Non-null when `kind === "multisig-psbt"`.
   */
  multisigTotalSigners?: number;

  // -----------------------------------------------------------------------
  // BTC-specific cryptographic-binding fields.
  // Populated by Plan 23-03 prepare_btc_send; consumed by Plan 23-04
  // preview_send BTC branch (Layer 1 fingerprint recompute) and
  // send_transaction BTC dispatch arm (Layer 3 drift gate).
  // -----------------------------------------------------------------------

  /**
   * PSBT-v0 in base64. The payload relayed to the Ledger transport for
   * signing (Phase 23-04). Stored for reference; the CANONICAL ARTIFACT
   * for fingerprint recompute is `unsignedTxHex` + `perInputPrevouts`
   * (NOT a re-parsed PSBT — Pitfall 5 mitigation: PSBT round-trips can
   * normalize fields, producing spurious fingerprint drift).
   */
  psbtBase64: string;

  /**
   * Unsigned transaction hex — the canonical artifact for fingerprint
   * recompute (Pitfall 5). `preview_send` and `send_transaction` BTC
   * branches extract the `Transaction` from this hex via
   * `Transaction.fromHex()` and pass it to `computeAllSighashes`, NOT
   * from a re-parsed PSBT. TRON analog: `rawDataHex` (handle-store.ts:441).
   */
  unsignedTxHex: string;

  /**
   * Ordered per-input prevout descriptors — paired with `unsignedTxHex`
   * to form the canonical fingerprint-recompute artifact. One entry per
   * selected UTXO input, in the same order as the PSBT input vector.
   * Each entry carries: `{ script: Uint8Array, valueSats: bigint, scriptType }`.
   *
   * Stored as `readonly { script: Uint8Array; valueSats: bigint; scriptType: "p2wpkh" | "p2tr" }[]`
   * to avoid importing `BtcPrevout` from btc-psbt.ts (keep handle-store
   * free of protocol-layer imports — same discipline as `rawDataObject: unknown`
   * for TRON).
   */
  perInputPrevouts: readonly {
    script: Uint8Array;
    valueSats: bigint;
    scriptType: "p2wpkh" | "p2tr";
  }[];

  /** Per-input script types in PSBT order (parallel to `perInputPrevouts`). */
  inputScriptTypes: readonly ("p2wpkh" | "p2tr")[];

  /** Decoded input summary for the PREPARE RECEIPT + DECODED block. */
  inputs: readonly {
    txid: string;
    vout: number;
    valueSats: bigint;
    scriptType: "p2wpkh" | "p2tr";
  }[];

  /** Decoded output summary for the PREPARE RECEIPT + DECODED block. */
  outputs: readonly {
    address: string;
    valueSats: bigint;
    role: "recipient" | "change";
  }[];

  /** Total miner fee in sats. Surfaced verbatim in the PREPARE RECEIPT. */
  feeSats: bigint;

  /** Change amount in sats (0n if no change output — dust folded into fee). */
  changeSats: bigint;

  /**
   * WR-02: fee rate used for coin selection (sat/vByte, integer). Populated by
   * `prepare_btc_send` at prepare time and surfaced in `preview_send`'s
   * PREPARE RECEIPT block (replacing the former literal `"auto"`).
   */
  feeRate: number;

  /**
   * CR-01 / CR-03: derivation path of the change output address (BIP-44
   * 5-level — e.g. `"m/84'/0'/0'/1/0"` for segwit change at index 0).
   * `null` when there is no change output (dust folded into fee, changeSats===0n).
   *
   * `send_transaction` populates `knownAddressDerivations` from this field so
   * the Ledger BTC app displays the change output as "yours" rather than a
   * second send recipient (Pitfall 6).
   */
  changePath: string | null;

  /**
   * CR-01 / CR-03: change output address (bech32 / bech32m). Paired with
   * `changePath` — always non-null when `changePath` is non-null.
   * `null` when changeSats===0n.
   */
  changeAddress: string | null;

  /** Optional decoded instruction summary for the DECODED ARGS block in preview_send. */
  instructionSummary?: BtcInstructionSummary[];
}

// ---------------------------------------------------------------------------
// Phase 26 Plan 26-02 widening: PreparedTxLtc + LtcInstructionSummary.
// ADDITIVE TYPE SURFACE — state machine + TTL logic BYTE-IDENTICAL
// (same pattern as Phase 23 PreparedTxBtc).
// ---------------------------------------------------------------------------

/**
 * Phase 26 — decoded LTC instruction summary for the DECODED ARGS block
 * in preview_send LTC branch (Plan 26-02). Mirrors BtcInstructionSummary —
 * only native kind (P2WPKH segwit ltc1q… addresses).
 */
export type LtcInstructionSummary = {
  kind: "native";
  /** Sender ltc1q segwit address. */
  fromSegwit: string;
  /** Recipient ltc1q address (or L-prefix legacy). */
  to: string;
  /** Amount being sent to the recipient in litoshis. */
  litoshis: bigint;
  /** Miner fee in litoshis. */
  feeSats: bigint;
};

/**
 * LTC prepared-tx shape. Phase 26 — Plan 26-02. Mirrors PreparedTxBtc exactly
 * with `txType: "litecoin"` as the discriminator. Sentinel EVM fields follow
 * the same BTC/TRON/Solana pattern — zero/empty values that hit the Layer 0.5
 * dispatch-target refusal before reaching EVM processing.
 *
 * FROZEN guard: this interface is ADDITIVE TYPE SURFACE only. The handle-store
 * state machine + TTL + createHandle + transitionTo* logic is BYTE-IDENTICAL
 * (Phase 23 PreparedTxBtc precedent at line 537).
 */
export interface PreparedTxLtc {
  /** Required discriminator — LTC UTXO-model shape. */
  txType: "litecoin";

  // -----------------------------------------------------------------------
  // EVM-shape sentinel fields (set to zero / empty values for LTC handles).
  // -----------------------------------------------------------------------
  /** Sentinel — LTC has no EVM chainId. Always 0. */
  chainId: number;
  /** Sentinel — LTC addresses are bech32, not 0x-prefixed. Always the zero address. */
  to: Address;
  /** Sentinel — LTC uses litoshis, not valueWei. Always 0n. */
  valueWei: bigint;
  /** Sentinel — LTC has no EVM calldata. Always `"0x"`. */
  data: Hex;
  /** Sentinel — LTC has no EVM nonce. Always undefined. */
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;

  // -----------------------------------------------------------------------
  // LTC-specific discriminator.
  // -----------------------------------------------------------------------
  /**
   * LTC send kind. `"native"` covers all Phase 26 sends (P2WPKH segwit).
   */
  kind: "native";

  // -----------------------------------------------------------------------
  // LTC-specific cryptographic-binding fields.
  // Mirrors PreparedTxBtc fields (lines 633-711) with "litecoin" labeling.
  // -----------------------------------------------------------------------

  /**
   * PSBT-v0 in base64. The payload relayed to the Ledger LTC transport.
   * Canonical recompute artifact is `unsignedTxHex` + `perInputPrevouts`
   * (Pitfall 5 mitigation).
   */
  psbtBase64: string;

  /**
   * Unsigned transaction hex — canonical artifact for fingerprint recompute
   * (Pitfall 5). BIP-143 is identical for LTC and BTC.
   */
  unsignedTxHex: string;

  /**
   * Ordered per-input prevout descriptors — one per selected UTXO input.
   * Mirrors PreparedTxBtc.perInputPrevouts — same shape, LTC context.
   * Only p2wpkh supported in Phase 26 (no taproot on Litecoin).
   */
  perInputPrevouts: readonly {
    script: Uint8Array;
    valueSats: bigint;
    scriptType: "p2wpkh";
  }[];

  /** Per-input script types in PSBT order. LTC: always p2wpkh for Phase 26. */
  inputScriptTypes: readonly "p2wpkh"[];

  /** Decoded input summary for the PREPARE RECEIPT + DECODED block. */
  inputs: readonly {
    txid: string;
    vout: number;
    valueSats: bigint;
    scriptType: "p2wpkh";
  }[];

  /** Decoded output summary for the PREPARE RECEIPT + DECODED block. */
  outputs: readonly {
    address: string;
    valueSats: bigint;
    role: "recipient" | "change";
  }[];

  /** Total miner fee in litoshis. Surfaced verbatim in the PREPARE RECEIPT. */
  feeSats: bigint;

  /** Change amount in litoshis (0n if no change output). */
  changeSats: bigint;

  /** Fee rate used for coin selection (sat/vByte, integer). */
  feeRate: number;

  /**
   * Derivation path of the change output address.
   * `null` when there is no change output (changeSats===0n).
   */
  changePath: string | null;

  /**
   * Change output address (ltc1q…).
   * `null` when changeSats===0n.
   */
  changeAddress: string | null;

  /** Optional decoded instruction summary for the DECODED ARGS block in preview_send. */
  instructionSummary?: LtcInstructionSummary[];
}

// ---------------------------------------------------------------------------
// Phase 26 Plan 26-03 widening: PreparedTxBtcLifi.
// ADDITIVE TYPE SURFACE — state machine + TTL logic BYTE-IDENTICAL
// (same pattern as Phase 23 PreparedTxBtc and Phase 26-02 PreparedTxLtc).
// ---------------------------------------------------------------------------

/**
 * BTC LiFi bridge prepared-tx shape. Phase 26 — Plan 26-03. Mirrors the
 * PreparedTxBtc sentinel-fields pattern with `txType: "btc-lifi"` as the
 * discriminator. The PSBT is LiFi-constructed (not VaultPilot-constructed):
 * VaultPilot's role is to sign inputs and broadcast verbatim.
 *
 * The payloadFingerprint preimage is keccak256("VaultPilot-btclifi-v1:" ‖ psbtBytes)
 * — the WHOLE PSBT bytes, not per-input sighashes (T-26-11 / T-26-14 mitigation).
 *
 * FROZEN guard: this interface is ADDITIVE TYPE SURFACE only. The handle-store
 * state machine + TTL + createHandle + transitionTo* logic is BYTE-IDENTICAL
 * (Phase 23 PreparedTxBtc precedent at line 537).
 */
export interface PreparedTxBtcLifi {
  /** Required discriminator — BTC LiFi bridge shape. */
  txType: "btc-lifi";

  // -----------------------------------------------------------------------
  // EVM-shape sentinel fields (set to zero / empty values for btc-lifi handles).
  // -----------------------------------------------------------------------
  /** Sentinel — BTC LiFi has no EVM chainId. Always 0. */
  chainId: number;
  /** Sentinel — BTC addresses are bech32, not 0x-prefixed. Always the zero address. */
  to: Address;
  /** Sentinel — BTC uses satoshi, not valueWei. Always 0n. */
  valueWei: bigint;
  /** Sentinel — BTC LiFi has no EVM calldata. Always "0x". */
  data: Hex;
  /** Sentinel — no EVM nonce. Always undefined. */
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;

  // -----------------------------------------------------------------------
  // BTC LiFi-specific cryptographic-binding fields.
  // -----------------------------------------------------------------------

  /**
   * The LiFi-supplied PSBT hex (verbatim from transactionRequest.data).
   * Output order is LOAD-BEARING — never reconstruct or reorder (Pitfall 6).
   * This is the canonical recompute artifact for payloadFingerprint drift detection.
   */
  psbtHex: string;

  /** Bridge vault BTC deposit address (first PSBT output). Display-only. */
  vaultAddress: string;

  /** Amount in satoshi (from the deposit output). Display-only. */
  amountSats: bigint;

  /** Final destination address on the target chain. Asserted by Inv#6b at prepare time. */
  toAddress: string;

  /** Target chain (e.g. "ETH", "ARB", "SOL"). Display-only. */
  toChain: string;

  /** Target token address or symbol (e.g. "WETH" or "0xC02aa..."). Display-only. */
  toToken: string;

  /** Total PSBT output count (deposit + OP_RETURN + change). Display-only. */
  outputCount: number;

  /** Whether the PSBT has an OP_RETURN tracking memo output. Display-only. */
  hasOpReturn: boolean;

  /**
   * payloadFingerprint = keccak256("VaultPilot-btclifi-v1:" ‖ psbtBytes).
   * Stored here AND in the HandleRecord.payloadFingerprint field.
   * The send-time recompute compares against the HandleRecord value.
   */
  payloadFingerprint: Hex;
}

// ---------------------------------------------------------------------------
// Phase 37 Plan 37-01 widening: PreparedTxSafeTypedData.
// ADDITIVE TYPE SURFACE — state machine + TTL + createHandle + transitionTo*
// logic BYTE-IDENTICAL (same pattern as Phase 23 PreparedTxBtc / Phase 26
// PreparedTxLtc / Phase 26 PreparedTxBtcLifi precedents above).
// ---------------------------------------------------------------------------

/**
 * Safe EIP-712 typed-data prepared-tx shape. Phase 37 — Plan 37-01 (SAFE-05).
 *
 * Off-chain signing flow — `prepare_safe_tx_propose` (and `prepare_safe_tx_approve`
 * arriving in Plan 37-02) produce this shape. The handle is consumed by
 * `submit_safe_tx_signature` (Plan 37-02), NOT by `send_transaction`. Routing
 * `send_transaction(handle)` against a `PreparedTxSafeTypedData` handle is a
 * structured refusal arm Plan 37-03 wires (WRONG_HANDLE_KIND); Plan 37-01
 * establishes the type-level impossibility — the new union member's discriminant
 * `txType: "safe-typed-data"` is distinct from every existing arm.
 *
 * Mirrors `PreparedTxBtcLifi` (line 879) sentinel-fields pattern — EVM-shape
 * sentinel fields (`chainId: 0`, `to: 0x0…`, `valueWei: 0n`, `data: "0x"`)
 * keep the discriminated union accessible at every EVM call site without
 * forcing narrowing. The discriminant routes BEFORE any read reaches the
 * sentinels.
 *
 * `txHash` field semantics (RESEARCH Open Question 1): on a Safe-typed-data
 * handle, the `txHash` field stamped by `transitionToSent` is the SafeTx hash
 * (the 32-byte EIP-712 digest) — NOT an on-chain tx hash. Same field, different
 * semantic — matches the BTC `txHash` widening pattern from Plan 12-05
 * (handle-store.ts:973 — `txHash` widened from `Hex` to `string` for non-EVM
 * identifiers; Safe typed-data SafeTx hashes are 0x-prefixed 32-byte hex and
 * fit `Hex`-shape but are SEMANTICALLY off-chain digests).
 *
 * FROZEN guard: this interface is ADDITIVE TYPE SURFACE only. The handle-store
 * state machine + TTL + createHandle + transitionTo* logic is BYTE-IDENTICAL
 * (Phase 23 PreparedTxBtc precedent at line 537).
 */
export interface PreparedTxSafeTypedData {
  /** Required discriminator — Safe EIP-712 typed-data shape (off-chain signing only). */
  txType: "safe-typed-data";

  // -----------------------------------------------------------------------
  // EVM-shape sentinel fields (set to zero / empty values for safe-typed-data
  // handles). Present to keep the discriminated union accessible by existing
  // EVM-side consumers without forcing narrowing at every site. EVM call paths
  // that reach a safe-typed-data handle hit the Layer 0.5 dispatch-target
  // refusal (or the Plan 37-03 WRONG_HANDLE_KIND arm) before reading these —
  // the sentinels are defensive, not load-bearing.
  // -----------------------------------------------------------------------
  /** Sentinel — Safe typed-data has no EVM chainId at this layer. Always 0. The REAL chain lives in `chain` below. */
  chainId: number;
  /** Sentinel — the SafeTx target lives in `safeTxTo`, NOT here. Always the zero address. */
  to: Address;
  /** Sentinel — Safe typed-data has no on-chain value transfer at this layer. Always 0n. */
  valueWei: bigint;
  /** Sentinel — Safe typed-data has no EVM calldata at this layer. Always "0x". */
  data: Hex;
  /** Sentinel — Safe typed-data has no EVM nonce. Always undefined. */
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;

  // -----------------------------------------------------------------------
  // Safe-specific cryptographic-binding fields.
  // Populated by `prepare_safe_tx_propose` (Plan 37-01) and
  // `prepare_safe_tx_approve` (Plan 37-02); consumed by `submit_safe_tx_signature`
  // (Plan 37-02) for ECDSA-recovery + payloadFingerprint re-check.
  // -----------------------------------------------------------------------

  /** Real chain (vs sentinel `chainId` above) — populated by the resolved ChainId. */
  chain: ChainId;
  /** Safe proxy address (the verifyingContract of the EIP-712 domain). */
  safeAddress: Address;
  /** Safe Smart Account version — pre-v1.3.0 refused upstream (cross-chain replay risk). */
  safeVersion: SupportedSafeVersion;
  /** The 32-byte EIP-712 typed-data digest. Byte-identical to Safe's on-chain getTransactionHash. */
  safeTxHash: Hex;
  /** SafeTx nonce — the Safe Singleton's `nonce()` value at prepare time. NOT the EVM nonce sentinel above. */
  safeNonce: bigint;
  /** Operation discriminator — "call" (Enum 0) or "delegatecall" (Enum 1). Phase 38 hard-trigger keys on this for delegatecall. */
  operation: "call" | "delegatecall";
  /** Encapsulated SafeTx target — the address the Safe will call/delegatecall when execTransaction lands. */
  safeTxTo: Address;
  /** Encapsulated SafeTx value (wei). */
  safeTxValue: bigint;
  /** Encapsulated SafeTx calldata. */
  safeTxData: Hex;
  /** Legacy gas-relay field. Safe v1.3.0+ non-relayed convention sets to 0n. */
  safeTxGas: bigint;
  /** Legacy gas-relay field. Safe v1.3.0+ non-relayed convention sets to 0n. */
  baseGas: bigint;
  /** Legacy gas-relay field. Safe v1.3.0+ non-relayed convention sets to 0n. */
  gasPrice: bigint;
  /** Legacy gas-relay field. Safe v1.3.0+ non-relayed convention sets to 0x000…. */
  gasToken: Address;
  /** Legacy gas-relay field. Safe v1.3.0+ non-relayed convention sets to 0x000…. */
  refundReceiver: Address;
  /**
   * Full EIP-712 typed-data structure (domain + types + message). Surfaced for
   * agent inspection / second-LLM cross-verification — the agent can recompute
   * the digest independently via viem.hashTypedData. No private material; the
   * structure is what the device will display in clear-sign mode.
   */
  typedDataStructure: SafeEIP712TypedData;
}

// Compile-time check that `SafeOperation` (the 0|1 enum from safe-tx-hash) is
// the canonical mapping for the "call" | "delegatecall" discriminator above.
// Unused at runtime — the type system enforces both maps stay in sync.
type _SafeOperationCheck = SafeOperation;

export type PreparedTx = PreparedTxEvm | PreparedTxSolana | PreparedTxTron | PreparedTxBtc | PreparedTxLtc | PreparedTxBtcLifi | PreparedTxSafeTypedData;

/**
 * Preview-pinned fields, persisted onto the record at `transitionToPreviewed`
 * time. `previewToken` is a fresh crypto.randomUUID() — only the CURRENT
 * record.pinned.previewToken is a valid token (Q4 locked decision —
 * re-preview overwrites, no token history).
 */
export interface PreviewPinned {
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  previewToken: string;
  presignHash: Hex;
  selector: Hex | null; // first 4 bytes of data, or null if data === "0x"
}

export interface HandleRecord {
  handle: string;
  args: PrepareArgs;
  tx: PreparedTx;
  payloadFingerprint: Hex;
  status: HandleStatus;
  createdAt: number;
  pinned?: PreviewPinned;
  sentAt?: number;
  /**
   * Broadcast result identifier. Widened from `Hex` to `string` in Plan 12-05
   * for cross-chain compatibility: EVM stores `0x`-prefixed 32-byte tx hashes,
   * Solana stores base58-encoded 64-byte Ed25519 signatures (~88 chars; NOT
   * `0x`-prefixed). Both wire-format identifiers consumers receive verbatim;
   * the field name `txHash` is kept for API symmetry with the v1.x EVM surface.
   */
  txHash?: string;
  cancelledAt?: number;
  /**
   * Phase 35 Plan 35-03 (CUSTOM-01) — escape-hatch bypass flag. Set ONLY by
   * `src/tools/prepare_custom_call.ts` via the `createHandle` input. Read by
   * `preview_send` (EVM branch only) to short-circuit the canonical-dispatch
   * allowlist refusal.
   *
   * `acknowledgeNonProtocolTarget` exists on the record (NOT in the
   * `payloadFingerprint` preimage) — the bypass is a record annotation, not
   * a fingerprint dimension. Fixture P (test/signing-fingerprint.test.ts)
   * verifies this: the escape-hatch payload uses the standard PREP-03
   * envelope unchanged.
   *
   * Grep-guard test (test/integration/escape-hatch.test.ts Test 6) asserts
   * the assignment `acknowledgeNonProtocolTarget: true` appears in EXACTLY
   * two source files: this type definition AND `prepare_custom_call.ts`.
   * Adding a third assignment site = test failure.
   *
   * Type is `?: true` (not `?: boolean`) — the field exists or it doesn't;
   * an explicit `false` would be a spec-shape contradiction.
   */
  acknowledgeNonProtocolTarget?: true;
  /**
   * Phase 37 Plan 37-03 (SAFE-08) — Safe execTransaction Layer 0.5 bypass
   * sentinel. Mirror of `acknowledgeNonProtocolTarget` above — same shape,
   * narrower scope. Set ONLY by `src/tools/prepare_safe_tx_execute.ts` via
   * the `createHandle` input. Read by `preview_send.ts` at the EVM Layer
   * 0.5 dispatch site (line 811-812 region) to short-circuit
   * canonical-dispatch — the outer `tx.to` is the user's Safe proxy at
   * `safeAddress` (per-user, NOT globally allowlistable in
   * `CANONICAL_DISPATCH_TARGETS`).
   *
   * The bypass is SERVER-VERIFIED (not user-acknowledged like its Phase 35
   * sibling), authorized by 5 prepare-time defense-in-depth invariants
   * enumerated in CONTEXT §prepare_safe_tx_execute lines (1)..(5):
   *   1. Selector match `0x6a761202` (execTransaction)
   *   2. On-chain VERSION() ∈ {"1.3.0", "1.4.1"}
   *   3. getOwners() includes sender + every confirmation's recovered signer
   *   4. All collected signatures recovered to current owners (no removeOwner drift)
   *   5. Inner (to, value, data, operation) decoded + WARN emitted at prepare AND preview
   *
   * Grep-guard test (Plan 37-03 Task 3) asserts EXACTLY TWO functional
   * source-file references — one assignment in
   * `src/tools/prepare_safe_tx_execute.ts` and one read in
   * `src/tools/preview_send.ts`. The grep pattern matches
   * `isSafeExecTransaction: true` (assignment) and
   * `record.isSafeExecTransaction` (read) — the bare type-field declaration
   * here is not counted. Adding a third functional site → test failure.
   *
   * Type is `?: true` (not `?: boolean`) — match the Phase 35 sibling: the
   * field exists or it doesn't; an explicit `false` would be a spec-shape
   * contradiction.
   */
  isSafeExecTransaction?: true;
  /**
   * Phase 35 Plan 35-03 — origin tool selector for the `preview_send`
   * DECODED ARGS arm. Set to `"prepare_custom_call"` by the escape-hatch
   * tool; absent on every other prepare_* tool's handle (those are
   * dispatched by `(tx.to, selector)` tuple in the existing decoder chain).
   * Optional + opaque string so future prepare_* tools can opt into a
   * preview-side custom arm without touching the type.
   */
  preparedBy?: string;
}

export type LookupResult =
  | { ok: true; record: HandleRecord }
  | { ok: false; errorCode: Extract<ErrorCode, "HANDLE_NOT_FOUND" | "HANDLE_EXPIRED"> };

export type TransitionResult =
  | { ok: true; record: HandleRecord }
  | {
      ok: false;
      errorCode: Extract<
        ErrorCode,
        "HANDLE_NOT_FOUND" | "HANDLE_EXPIRED" | "WRONG_STATUS"
      >;
    };

// Module-scope store. NOT exported — all access goes through the typed API.
// `_resetHandleStoreForTesting` and `_peekHandleForTesting` are escape hatches
// for tests (underscore-prefixed convention from src/wallet/walletconnect-client.ts).
const store = new Map<string, HandleRecord>();

/**
 * Create a fresh handle in `prepared` state. Returns the UUID v4 handle
 * string; the agent passes this on every subsequent preview/send/verify call.
 */
export function createHandle(input: {
  args: PrepareArgs;
  tx: PreparedTx;
  payloadFingerprint: Hex;
  // Phase 35 Plan 35-03 — escape-hatch fields. Both optional; absent on every
  // prepare_* tool except `prepare_custom_call`. Spread-on-set so the record
  // shape stays byte-identical for non-escape-hatch handles (no `undefined`
  // serialization surprises in structured logs).
  acknowledgeNonProtocolTarget?: true;
  preparedBy?: string;
  // Phase 37 Plan 37-03 (SAFE-08) — Safe execTransaction Layer 0.5 bypass
  // sentinel. Optional; absent on every prepare_* tool except
  // `prepare_safe_tx_execute`. Spread-on-set so the record shape stays
  // byte-identical for non-Safe handles. Mirror of the
  // `acknowledgeNonProtocolTarget` conditional-spread directly above.
  isSafeExecTransaction?: true;
}): string {
  const handle = crypto.randomUUID();
  const record: HandleRecord = {
    handle,
    args: input.args,
    tx: input.tx,
    payloadFingerprint: input.payloadFingerprint,
    status: "prepared",
    createdAt: Date.now(),
    ...(input.acknowledgeNonProtocolTarget && {
      acknowledgeNonProtocolTarget: true,
    }),
    ...(input.isSafeExecTransaction && {
      isSafeExecTransaction: true,
    }),
    ...(input.preparedBy !== undefined && { preparedBy: input.preparedBy }),
  };
  store.set(handle, record);
  return handle;
}

/**
 * Look up a handle. Lazy TTL: a record whose `createdAt + HANDLE_TTL_MS` is
 * in the past gets evicted from the store and the call returns
 * `HANDLE_EXPIRED`.
 */
export function lookup(handle: string): LookupResult {
  const record = store.get(handle);
  if (!record) return { ok: false, errorCode: "HANDLE_NOT_FOUND" };
  if (Date.now() > record.createdAt + HANDLE_TTL_MS) {
    store.delete(handle);
    return { ok: false, errorCode: "HANDLE_EXPIRED" };
  }
  return { ok: true, record };
}

/**
 * Transition a handle to `previewed`. Idempotent (Q4): re-previewing an
 * already-previewed handle OVERWRITES `record.pinned` — the new previewToken
 * is the only valid token. Rejects with `WRONG_STATUS` from `sent` or
 * `cancelled`.
 */
export function transitionToPreviewed(handle: string, pinned: PreviewPinned): TransitionResult {
  const result = lookup(handle);
  if (!result.ok) return result;
  const record = result.record;
  if (record.status === "sent" || record.status === "cancelled") {
    return { ok: false, errorCode: "WRONG_STATUS" };
  }
  record.pinned = pinned;
  record.status = "previewed";
  return { ok: true, record };
}

/**
 * Transition a handle to `sent`. Only legal from `previewed`. Stamps
 * `txHash` and `sentAt`. The send is final — `sent → cancelled` is rejected.
 */
export function transitionToSent(handle: string, txHash: string): TransitionResult {
  const result = lookup(handle);
  if (!result.ok) return result;
  const record = result.record;
  if (record.status !== "previewed") {
    return { ok: false, errorCode: "WRONG_STATUS" };
  }
  record.status = "sent";
  record.txHash = txHash;
  record.sentAt = Date.now();
  return { ok: true, record };
}

/**
 * Transition a handle to `cancelled`. Legal from `prepared` or `previewed`;
 * `sent` is final and refuses. Record is NOT immediately deleted (Plan
 * 04-04's handler reads `record.status` after the transition); lazy TTL
 * reclaims at the 15-min mark.
 */
export function transitionToCancelled(handle: string): TransitionResult {
  const result = lookup(handle);
  if (!result.ok) return result;
  const record = result.record;
  if (record.status === "sent" || record.status === "cancelled") {
    return { ok: false, errorCode: "WRONG_STATUS" };
  }
  record.status = "cancelled";
  record.cancelledAt = Date.now();
  return { ok: true, record };
}

/**
 * Clear the entire store. Test-only — production code never calls this.
 */
export function _resetHandleStoreForTesting(): void {
  store.clear();
}

/**
 * Read a record by handle WITHOUT going through TTL eviction or any state-
 * machine check. Returns the live mutable record reference so downstream
 * tests (Plan 04-04 PAYLOAD_FINGERPRINT_DRIFT) can intentionally mutate
 * `payloadFingerprint` to simulate state corruption. Test-only.
 */
export function _peekHandleForTesting(handle: string): HandleRecord | undefined {
  return store.get(handle);
}

/**
 * Phase 37 Plan 37-02 — find handles by the (chain, safeAddress, safeTxHash)
 * tuple. Returns every PreparedTxSafeTypedData record whose tx fields match
 * the supplied tuple (typically 0 or 1 — same SafeTx, same prepare call;
 * multiple matches only occur if the agent re-prepared without using the
 * prior handle).
 *
 * Iterates the internal Map directly — NO `_handles` ESM-spy-affordance
 * indirection (CLAUDE.md ESM-spy rule applies to modules whose exports call
 * each other internally; this is a leaf consumer-facing read and the
 * one-consumer over-engineering is explicitly resolved in the Plan 37-02 spec).
 *
 * State-machine functions (createHandle / lookup / transitionToPreviewed /
 * transitionToSent / transitionToCancelled) are BYTE-IDENTICAL — this is a
 * pure ADDITIVE read.
 */
export function findHandlesBySafeTxHash(
  chain: ChainId,
  safeAddress: Address,
  safeTxHash: Hex,
): Array<{ handle: string; record: HandleRecord }> {
  const matches: Array<{ handle: string; record: HandleRecord }> = [];
  const lcSafeAddress = safeAddress.toLowerCase();
  const lcSafeTxHash = safeTxHash.toLowerCase();
  for (const [handle, record] of store.entries()) {
    if (record.tx.txType !== "safe-typed-data") continue;
    if (record.tx.chain !== chain) continue;
    if (record.tx.safeAddress.toLowerCase() !== lcSafeAddress) continue;
    if (record.tx.safeTxHash.toLowerCase() !== lcSafeTxHash) continue;
    matches.push({ handle, record });
  }
  return matches;
}
