// src/protocols/kamino.ts
//
// Kamino (klend) instruction hand-encoding (D-01) + refresh-ceremony assembly.
// Phase 13 — Plans 13-05 (ops) + 13-06 (obligation-init). Sibling of
// `src/protocols/marginfi.ts` shape with a `_kamino` ESM-indirection object
// (CLAUDE.md — internal cross-export calls route through it so tests can spy).
//
// D-01 HAND-ENCODE — the WRITE path bypasses `@solana/kit` ENTIRELY (Pitfall 1).
// The klend program uses CUSTOM 8-byte discriminators that are NOT the standard
// Anchor `sha256("global:<ix>")[..8]` (VERIFIED at build: the codegen
// `DISCRIMINATOR` Buffers diverge from the sha256 derivation). We therefore PIN
// each instruction's discriminator as the byte literal read from the klend-sdk
// `@codegen/klend/instructions/<ix>.js` `DISCRIMINATOR` const, and hand-encode
// the borsh args directly (u64 LE / u8 / pubkey 32-byte — VERIFIED byte-identical
// to the codegen `@coral-xyz/borsh` layout output). Output is a native web3.js-v1
// `TransactionInstruction` — NO kit `Instruction`/`Address` type crosses into
// this module (asserted in protocols-kamino.test.ts).
//
// REFRESH CEREMONY (Pattern 2 / Pitfall 2 — the load-bearing Kamino constraint):
// every value-reading write prepends `refreshReserve` × N (one per DISTINCT
// touched reserve) + `refreshObligation`, IN ORDER, before the op ix. The
// on-chain program rejects an op against a stale obligation/reserve. The FULL
// ordered instruction vector is the fixture anchor (T–W), not just the op ix.
//
// The assemble helpers build a legacy `Transaction` (feePayer + recentBlockhash)
// and return `{ messageBytes, programIds, instructionSummary }` exactly like
// `marginfi.ts assembleMarginfiTx` — `messageBytes` flow through the FROZEN
// `computeSolanaPayloadFingerprint` binding UNCHANGED. `programIds` enumerates
// EVERY touched program (lending + Scope + Pyth + Switchboard refresh oracles)
// so the dispatch allowlist check sees the full set (Pitfall 5).

import {
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { getKaminoLendProgram } from "../config/contracts.js";

// ---------------------------------------------------------------------------
// PINNED discriminators (D-01) — read VERBATIM from the klend-sdk @codegen
// `DISCRIMINATOR` const for each instruction. NOT sha256("global:<ix>")[..8]
// (the klend program uses custom discriminators — verified divergent at build).
// These are the cryptographic-binding fixtures; protocols-kamino.test.ts asserts
// each built ix's first 8 bytes equal the matching literal here.
// ---------------------------------------------------------------------------
export const KAMINO_DISCRIMINATOR = {
  refreshReserve: [2, 218, 138, 235, 79, 201, 25, 102],
  refreshObligation: [33, 132, 147, 228, 151, 192, 72, 89],
  depositReserveLiquidityAndObligationCollateral: [129, 199, 4, 2, 222, 39, 26, 46],
  borrowObligationLiquidity: [121, 127, 18, 204, 73, 245, 225, 65],
  repayObligationLiquidity: [145, 178, 13, 225, 76, 240, 147, 72],
  withdrawObligationCollateralAndRedeemReserveCollateral: [75, 93, 93, 220, 34, 150, 218, 196],
  initUserMetadata: [117, 169, 176, 69, 197, 23, 15, 162],
  initObligation: [251, 10, 231, 76, 27, 11, 159, 96],
} as const;

// ---------------------------------------------------------------------------
// Primitive borsh arg encoders (VERIFIED byte-identical to the codegen
// `@coral-xyz/borsh` layout output — see header). Pure functions.
// ---------------------------------------------------------------------------

/** Encode a u64 as 8-byte little-endian (borsh u64 over a bigint). */
function u64le(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}

/** Build instruction data = 8-byte discriminator ‖ args. */
function ixData(discriminator: readonly number[], args: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([Buffer.from(discriminator), args]);
}

// Account-meta helpers (ordered per the IDL account list).
function ro(pubkey: PublicKey): { pubkey: PublicKey; isSigner: false; isWritable: false } {
  return { pubkey, isSigner: false, isWritable: false };
}
function w(pubkey: PublicKey): { pubkey: PublicKey; isSigner: false; isWritable: true } {
  return { pubkey, isSigner: false, isWritable: true };
}
function signer(pubkey: PublicKey): { pubkey: PublicKey; isSigner: true; isWritable: false } {
  return { pubkey, isSigner: true, isWritable: false };
}
function writableSigner(
  pubkey: PublicKey,
): { pubkey: PublicKey; isSigner: true; isWritable: true } {
  return { pubkey, isSigner: true, isWritable: true };
}

function programId(): PublicKey {
  return new PublicKey(getKaminoLendProgram());
}

// ---------------------------------------------------------------------------
// Refresh-ceremony instructions (no args).
// ---------------------------------------------------------------------------

/** Per-reserve oracle refresh. Touches the Scope / Pyth / Switchboard programs. */
export interface RefreshReserveAccounts {
  reserve: PublicKey;
  lendingMarket: PublicKey;
  pythOracle: PublicKey;
  switchboardPriceOracle: PublicKey;
  switchboardTwapOracle: PublicKey;
  scopePrices: PublicKey;
}

/**
 * Build `refreshReserve` (D-01). Account order per the IDL: reserve[W],
 * lendingMarket, pythOracle, switchboardPriceOracle, switchboardTwapOracle,
 * scopePrices. The oracle accounts' OWNING programs (Scope/Pyth/Switchboard)
 * are enumerated into `programIds` by the assemble helpers (Pitfall 5).
 */
export function buildRefreshReserveIx(
  accounts: RefreshReserveAccounts,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: programId(),
    data: ixData(KAMINO_DISCRIMINATOR.refreshReserve),
    keys: [
      w(accounts.reserve),
      ro(accounts.lendingMarket),
      ro(accounts.pythOracle),
      ro(accounts.switchboardPriceOracle),
      ro(accounts.switchboardTwapOracle),
      ro(accounts.scopePrices),
    ],
  });
}

/** Build `refreshObligation` (D-01). Order: lendingMarket, obligation[W]. */
export function buildRefreshObligationIx(accounts: {
  lendingMarket: PublicKey;
  obligation: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: programId(),
    data: ixData(KAMINO_DISCRIMINATOR.refreshObligation),
    keys: [ro(accounts.lendingMarket), w(accounts.obligation)],
  });
}

// ---------------------------------------------------------------------------
// Op instructions (u64 amount arg).
// ---------------------------------------------------------------------------

export interface DepositAccounts {
  owner: PublicKey;
  obligation: PublicKey;
  lendingMarket: PublicKey;
  lendingMarketAuthority: PublicKey;
  reserve: PublicKey;
  reserveLiquidityMint: PublicKey;
  reserveLiquiditySupply: PublicKey;
  reserveCollateralMint: PublicKey;
  reserveDestinationDepositCollateral: PublicKey;
  userSourceLiquidity: PublicKey;
  /** placeholderUserDestinationCollateral — None ⇒ the program id (codegen default). */
  collateralTokenProgram: PublicKey;
  liquidityTokenProgram: PublicKey;
}

/** Build `depositReserveLiquidityAndObligationCollateral` (supply). */
export function buildDepositIx(input: {
  accounts: DepositAccounts;
  amount: bigint;
}): TransactionInstruction {
  const a = input.accounts;
  return new TransactionInstruction({
    programId: programId(),
    data: ixData(
      KAMINO_DISCRIMINATOR.depositReserveLiquidityAndObligationCollateral,
      u64le(input.amount),
    ),
    keys: [
      writableSigner(a.owner),
      w(a.obligation),
      ro(a.lendingMarket),
      ro(a.lendingMarketAuthority),
      w(a.reserve),
      ro(a.reserveLiquidityMint),
      w(a.reserveLiquiditySupply),
      w(a.reserveCollateralMint),
      w(a.reserveDestinationDepositCollateral),
      w(a.userSourceLiquidity),
      // placeholderUserDestinationCollateral None → programAddress (codegen default).
      ro(programId()),
      ro(a.collateralTokenProgram),
      ro(a.liquidityTokenProgram),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
    ],
  });
}

export interface BorrowAccounts {
  owner: PublicKey;
  obligation: PublicKey;
  lendingMarket: PublicKey;
  lendingMarketAuthority: PublicKey;
  borrowReserve: PublicKey;
  borrowReserveLiquidityMint: PublicKey;
  reserveSourceLiquidity: PublicKey;
  borrowReserveLiquidityFeeReceiver: PublicKey;
  userDestinationLiquidity: PublicKey;
  referrerTokenState: PublicKey;
  tokenProgram: PublicKey;
}

/** Build `borrowObligationLiquidity`. */
export function buildBorrowIx(input: {
  accounts: BorrowAccounts;
  amount: bigint;
}): TransactionInstruction {
  const a = input.accounts;
  return new TransactionInstruction({
    programId: programId(),
    data: ixData(KAMINO_DISCRIMINATOR.borrowObligationLiquidity, u64le(input.amount)),
    keys: [
      signer(a.owner),
      w(a.obligation),
      ro(a.lendingMarket),
      ro(a.lendingMarketAuthority),
      w(a.borrowReserve),
      ro(a.borrowReserveLiquidityMint),
      w(a.reserveSourceLiquidity),
      w(a.borrowReserveLiquidityFeeReceiver),
      w(a.userDestinationLiquidity),
      w(a.referrerTokenState),
      ro(a.tokenProgram),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
    ],
  });
}

export interface RepayAccounts {
  owner: PublicKey;
  obligation: PublicKey;
  lendingMarket: PublicKey;
  repayReserve: PublicKey;
  reserveLiquidityMint: PublicKey;
  reserveDestinationLiquidity: PublicKey;
  userSourceLiquidity: PublicKey;
  tokenProgram: PublicKey;
}

/** Build `repayObligationLiquidity`. */
export function buildRepayIx(input: {
  accounts: RepayAccounts;
  amount: bigint;
}): TransactionInstruction {
  const a = input.accounts;
  return new TransactionInstruction({
    programId: programId(),
    data: ixData(KAMINO_DISCRIMINATOR.repayObligationLiquidity, u64le(input.amount)),
    keys: [
      signer(a.owner),
      w(a.obligation),
      ro(a.lendingMarket),
      w(a.repayReserve),
      ro(a.reserveLiquidityMint),
      w(a.reserveDestinationLiquidity),
      w(a.userSourceLiquidity),
      ro(a.tokenProgram),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
    ],
  });
}

export interface WithdrawAccounts {
  owner: PublicKey;
  obligation: PublicKey;
  lendingMarket: PublicKey;
  lendingMarketAuthority: PublicKey;
  withdrawReserve: PublicKey;
  reserveLiquidityMint: PublicKey;
  reserveSourceCollateral: PublicKey;
  reserveCollateralMint: PublicKey;
  reserveLiquiditySupply: PublicKey;
  userDestinationLiquidity: PublicKey;
  collateralTokenProgram: PublicKey;
  liquidityTokenProgram: PublicKey;
}

/** Build `withdrawObligationCollateralAndRedeemReserveCollateral`. */
export function buildWithdrawIx(input: {
  accounts: WithdrawAccounts;
  amount: bigint;
}): TransactionInstruction {
  const a = input.accounts;
  return new TransactionInstruction({
    programId: programId(),
    data: ixData(
      KAMINO_DISCRIMINATOR.withdrawObligationCollateralAndRedeemReserveCollateral,
      u64le(input.amount),
    ),
    keys: [
      writableSigner(a.owner),
      w(a.obligation),
      ro(a.lendingMarket),
      ro(a.lendingMarketAuthority),
      w(a.withdrawReserve),
      ro(a.reserveLiquidityMint),
      w(a.reserveSourceCollateral),
      w(a.reserveCollateralMint),
      w(a.reserveLiquiditySupply),
      w(a.userDestinationLiquidity),
      // placeholderUserDestinationCollateral None → programAddress.
      ro(programId()),
      ro(a.collateralTokenProgram),
      ro(a.liquidityTokenProgram),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
    ],
  });
}

// ---------------------------------------------------------------------------
// Obligation-init instructions (13-06).
// ---------------------------------------------------------------------------

export interface InitUserMetadataAccounts {
  owner: PublicKey;
  feePayer: PublicKey;
  userMetadata: PublicKey;
  /** referrerUserMetadata — None ⇒ the program id (codegen default). */
  referrerUserMetadata?: PublicKey;
}

/**
 * Build `initUserMetadata` (D-01/V9). Args: userLookupTable: pubkey — we pass
 * the default (no LUT) pubkey, matching a no-referrer setup. Order:
 * owner[S], feePayer[WS], userMetadata[W], referrerUserMetadata, rent,
 * systemProgram.
 */
export function buildInitUserMetadataIx(
  accounts: InitUserMetadataAccounts,
): TransactionInstruction {
  // userLookupTable arg = PublicKey.default (no LUT — borsh pubkey is 32 bytes).
  const args = PublicKey.default.toBuffer();
  return new TransactionInstruction({
    programId: programId(),
    data: ixData(KAMINO_DISCRIMINATOR.initUserMetadata, args),
    keys: [
      signer(accounts.owner),
      writableSigner(accounts.feePayer),
      w(accounts.userMetadata),
      ro(accounts.referrerUserMetadata ?? programId()),
      ro(SYSVAR_RENT_PUBKEY),
      ro(SystemProgram.programId),
    ],
  });
}

export interface InitObligationAccounts {
  obligationOwner: PublicKey;
  feePayer: PublicKey;
  obligation: PublicKey;
  lendingMarket: PublicKey;
  ownerUserMetadata: PublicKey;
  /** seed1Account / seed2Account — default for the base (standard) obligation. */
  seed1Account?: PublicKey;
  seed2Account?: PublicKey;
}

/**
 * Build `initObligation` (D-01/V9). Args: InitObligationArgs { tag: u8, id: u8 }
 * — both 0 for the standard obligation (matches deriveKaminoObligationPda's
 * tag=0/id=0 seeds). Order: obligationOwner[S], feePayer[WS], obligation[W],
 * lendingMarket, seed1Account, seed2Account, ownerUserMetadata, rent,
 * systemProgram.
 */
export function buildInitObligationIx(
  accounts: InitObligationAccounts,
): TransactionInstruction {
  // InitObligationArgs { tag: u8 = 0, id: u8 = 0 } — standard obligation.
  const args = Buffer.from([0, 0]);
  return new TransactionInstruction({
    programId: programId(),
    data: ixData(KAMINO_DISCRIMINATOR.initObligation, args),
    keys: [
      signer(accounts.obligationOwner),
      writableSigner(accounts.feePayer),
      w(accounts.obligation),
      ro(accounts.lendingMarket),
      ro(accounts.seed1Account ?? PublicKey.default),
      ro(accounts.seed2Account ?? PublicKey.default),
      ro(accounts.ownerUserMetadata),
      ro(SYSVAR_RENT_PUBKEY),
      ro(SystemProgram.programId),
    ],
  });
}

// ---------------------------------------------------------------------------
// Tx assembly — builds the FULL ordered instruction vector (refresh ceremony +
// op) into a legacy Transaction and returns the canonical message bytes +
// program IDs + a generic instruction summary.
// ---------------------------------------------------------------------------

export interface AssembledKaminoTx {
  transaction: Transaction;
  messageBytes: Uint8Array;
  /** EVERY touched program — lending + each refreshReserve's oracle programs. */
  programIds: string[];
  instructionSummary: Array<{ kind: "kamino"; ixName: string; programId: string }>;
}

/**
 * Assemble an ordered instruction vector into a legacy `Transaction`. The
 * `programIds` set is the UNION of every instruction's `programId` PLUS the
 * `oracleProgramIds` enumerated from the refresh ceremony's oracle accounts
 * (Scope/Pyth/Switchboard) — those programs are touched via CPI even though the
 * ix `programId` is the lending program (Pitfall 5). The summary lists the ix
 * names in order.
 */
export function assembleKaminoTx(input: {
  instructions: TransactionInstruction[];
  ixNames: string[];
  /** Oracle program IDs the refresh ceremony touches (Scope/Pyth/Switchboard). */
  oracleProgramIds: string[];
  feePayer: PublicKey;
  recentBlockhash: string;
}): AssembledKaminoTx {
  const tx = new Transaction({
    recentBlockhash: input.recentBlockhash,
    feePayer: input.feePayer,
  });
  for (const ix of input.instructions) tx.add(ix);
  const messageBytes = new Uint8Array(tx.serializeMessage());

  const programIdSet = new Set<string>();
  for (const ix of input.instructions) programIdSet.add(ix.programId.toBase58());
  for (const oid of input.oracleProgramIds) programIdSet.add(oid);

  return {
    transaction: tx,
    messageBytes,
    programIds: [...programIdSet],
    instructionSummary: input.instructions.map((ix, i) => ({
      kind: "kamino" as const,
      ixName: input.ixNames[i] ?? "unknown",
      programId: ix.programId.toBase58(),
    })),
  };
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. The prepare tools import
 * `_kamino` and call through the indirection so tests can spy on the build side
 * without monkey-patching named exports (ESM bindings are immutable).
 */
export const _kamino = {
  buildRefreshReserveIx,
  buildRefreshObligationIx,
  buildDepositIx,
  buildBorrowIx,
  buildRepayIx,
  buildWithdrawIx,
  buildInitUserMetadataIx,
  buildInitObligationIx,
  assembleKaminoTx,
};
