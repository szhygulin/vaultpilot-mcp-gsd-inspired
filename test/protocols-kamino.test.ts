// test/protocols-kamino.test.ts — Phase 13 Plans 13-05 + 13-06 Task 1 (D-01).
//
// The Kamino WRITE path hand-encodes from the IDL (D-01) and emits NATIVE
// web3.js-v1 `TransactionInstruction`s — NO @solana/kit `Instruction`/`Address`
// type may cross into the write/binding path (Pitfall 1). This file asserts:
//   - each builder returns a real web3.js-v1 TransactionInstruction (programId
//     is a web3.js PublicKey from the SOT getter; keys are AccountMeta with
//     web3.js PublicKey).
//   - the custom klend codegen discriminators are byte-pinned (NOT
//     sha256("global:<ix>")[..8]).
//   - account order matches the IDL <idl_instruction_map>.
//   - the refresh ceremony + op assemble into the FULL ordered vector with all
//     touched programIds (lending + oracle programs) enumerated.
// NO live RPC.

import { describe, expect, it } from "vitest";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  KAMINO_DISCRIMINATOR,
  buildBorrowIx,
  buildDepositIx,
  buildInitObligationIx,
  buildInitUserMetadataIx,
  buildRefreshObligationIx,
  buildRefreshReserveIx,
  buildRepayIx,
  buildWithdrawIx,
  assembleKaminoTx,
  _kamino,
} from "../src/protocols/kamino.js";
import { getKaminoLendProgram } from "../src/config/contracts.js";

const OWNER = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const MARKET = new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
const OBLIGATION = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
const LMA = new PublicKey("9zdpqAgENj4734TQvqj4Zo6srH7Pk29VKnNh5fHMwTgo");
const RES = new PublicKey("8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36");
const PYTH = new PublicKey("H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG");
const SB_PRICE = new PublicKey("So11111111111111111111111111111111111111112");
const SB_TWAP = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const SCOPE = new PublicKey("3NJYftD5sjVfxSnUdZ1wVML8f3aC6mp1CXCL6L7TnU8C");
const TOKEN_PROG = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const SUPPLY = new PublicKey("FxteHmLwG9nk1eL4pjNve3Eub2goGkkz6g6TLvdmDyq5");
const COLL_MINT = new PublicKey("Gf6JxqgL3MwxAm7AmqsTNFGz7c2EFXY7g7CqJZBfHWqV");
const DEST_COLL = new PublicKey("D9z5pxYZ7tqkQ6oFwvQyZ4QyhRjuw6JtVefdT4U6kx2y");
const USER_LIQ = new PublicKey("3m9y53V2QwBbrQxtv5WN4T8SA5zw7BpZ2ZBYpZZAu8MW");
const FEE_RECEIVER = new PublicKey("HRk9CMrpq7Jn9sh7mzxE8CChHG8dneX9p475QKz4Fsfc");
const REFERRER = new PublicKey("CWE8jPTUYhdCTZYWPTe1o5DFqfdjzWKc9WKz6rSjQUdG");
const SRC_COLL = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi8");
const USER_META = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

const LEND = getKaminoLendProgram();

function discHead(ix: { data: Uint8Array | Buffer }): number[] {
  return [...ix.data.slice(0, 8)];
}

describe("Kamino write path — native v1 instructions, NO kit leak (Pitfall 1)", () => {
  it("buildRefreshReserveIx is a web3.js-v1 TransactionInstruction with the SOT programId", () => {
    const ix = buildRefreshReserveIx({
      reserve: RES, lendingMarket: MARKET, pythOracle: PYTH,
      switchboardPriceOracle: SB_PRICE, switchboardTwapOracle: SB_TWAP, scopePrices: SCOPE,
    });
    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(ix.programId).toBeInstanceOf(PublicKey);
    expect(ix.programId.toBase58()).toBe(LEND);
    // discriminator-only, no args.
    expect(discHead(ix)).toEqual(KAMINO_DISCRIMINATOR.refreshReserve);
    expect(ix.data.length).toBe(8);
    // account order per IDL: reserve[W], lendingMarket, pyth, sbPrice, sbTwap, scope.
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      RES.toBase58(), MARKET.toBase58(), PYTH.toBase58(),
      SB_PRICE.toBase58(), SB_TWAP.toBase58(), SCOPE.toBase58(),
    ]);
    expect(ix.keys[0]!.isWritable).toBe(true); // reserve writable.
    // every key is a web3.js PublicKey (no kit Address branded string-objects).
    for (const k of ix.keys) expect(k.pubkey).toBeInstanceOf(PublicKey);
  });

  it("buildRefreshObligationIx: order lendingMarket, obligation[W]", () => {
    const ix = buildRefreshObligationIx({ lendingMarket: MARKET, obligation: OBLIGATION });
    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(discHead(ix)).toEqual(KAMINO_DISCRIMINATOR.refreshObligation);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([MARKET.toBase58(), OBLIGATION.toBase58()]);
    expect(ix.keys[1]!.isWritable).toBe(true);
  });

  it("buildDepositIx: discriminator + u64 amount + 14-account order (placeholder→programId)", () => {
    const ix = buildDepositIx({
      amount: 1_000_000n,
      accounts: {
        owner: OWNER, obligation: OBLIGATION, lendingMarket: MARKET, lendingMarketAuthority: LMA,
        reserve: RES, reserveLiquidityMint: MINT, reserveLiquiditySupply: SUPPLY,
        reserveCollateralMint: COLL_MINT, reserveDestinationDepositCollateral: DEST_COLL,
        userSourceLiquidity: USER_LIQ, collateralTokenProgram: TOKEN_PROG, liquidityTokenProgram: TOKEN_PROG,
      },
    });
    expect(discHead(ix)).toEqual(KAMINO_DISCRIMINATOR.depositReserveLiquidityAndObligationCollateral);
    // data = 8 disc + 8 u64.
    expect(ix.data.length).toBe(16);
    // u64 LE of 1_000_000 = 40420f0000000000.
    expect(Buffer.from(ix.data.slice(8)).toString("hex")).toBe("40420f0000000000");
    expect(ix.keys).toHaveLength(14);
    expect(ix.keys[0]!.isSigner).toBe(true); // owner signer.
    expect(ix.keys[0]!.isWritable).toBe(true);
    // placeholderUserDestinationCollateral (index 10) None → programAddress.
    expect(ix.keys[10]!.pubkey.toBase58()).toBe(LEND);
  });

  it("buildBorrowIx: 12 accounts, owner signer (read-only), referrerTokenState present", () => {
    const ix = buildBorrowIx({
      amount: 250_000n,
      accounts: {
        owner: OWNER, obligation: OBLIGATION, lendingMarket: MARKET, lendingMarketAuthority: LMA,
        borrowReserve: RES, borrowReserveLiquidityMint: MINT, reserveSourceLiquidity: SUPPLY,
        borrowReserveLiquidityFeeReceiver: FEE_RECEIVER, userDestinationLiquidity: USER_LIQ,
        referrerTokenState: REFERRER, tokenProgram: TOKEN_PROG,
      },
    });
    expect(discHead(ix)).toEqual(KAMINO_DISCRIMINATOR.borrowObligationLiquidity);
    expect(ix.keys).toHaveLength(12);
    expect(ix.keys[0]!.isSigner).toBe(true);
    expect(ix.keys[0]!.isWritable).toBe(false); // borrow owner is read-only signer.
    expect(ix.keys[9]!.pubkey.toBase58()).toBe(REFERRER.toBase58());
  });

  it("buildRepayIx: 9 accounts", () => {
    const ix = buildRepayIx({
      amount: 750_000n,
      accounts: {
        owner: OWNER, obligation: OBLIGATION, lendingMarket: MARKET, repayReserve: RES,
        reserveLiquidityMint: MINT, reserveDestinationLiquidity: SUPPLY, userSourceLiquidity: USER_LIQ,
        tokenProgram: TOKEN_PROG,
      },
    });
    expect(discHead(ix)).toEqual(KAMINO_DISCRIMINATOR.repayObligationLiquidity);
    expect(ix.keys).toHaveLength(9);
  });

  it("buildWithdrawIx: 14 accounts, placeholder→programId", () => {
    const ix = buildWithdrawIx({
      amount: 500_000n,
      accounts: {
        owner: OWNER, obligation: OBLIGATION, lendingMarket: MARKET, lendingMarketAuthority: LMA,
        withdrawReserve: RES, reserveLiquidityMint: MINT, reserveSourceCollateral: SRC_COLL,
        reserveCollateralMint: COLL_MINT, reserveLiquiditySupply: SUPPLY, userDestinationLiquidity: USER_LIQ,
        collateralTokenProgram: TOKEN_PROG, liquidityTokenProgram: TOKEN_PROG,
      },
    });
    expect(discHead(ix)).toEqual(KAMINO_DISCRIMINATOR.withdrawObligationCollateralAndRedeemReserveCollateral);
    expect(ix.keys).toHaveLength(14);
    expect(ix.keys[10]!.pubkey.toBase58()).toBe(LEND);
  });

  it("custom discriminators are NOT sha256(global:<ix>)[..8] (klend uses custom)", async () => {
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update("global:refreshReserve").digest().subarray(0, 8);
    expect([...sha]).not.toEqual(KAMINO_DISCRIMINATOR.refreshReserve);
  });
});

describe("assembleKaminoTx — full ordered vector + program-ID enumeration (Pitfall 5)", () => {
  it("programIds is the UNION of lending + oracle programs from the refresh ceremony", () => {
    const refresh = buildRefreshReserveIx({
      reserve: RES, lendingMarket: MARKET, pythOracle: PYTH,
      switchboardPriceOracle: SB_PRICE, switchboardTwapOracle: SB_TWAP, scopePrices: SCOPE,
    });
    const obl = buildRefreshObligationIx({ lendingMarket: MARKET, obligation: OBLIGATION });
    const op = buildRepayIx({
      amount: 1n,
      accounts: {
        owner: OWNER, obligation: OBLIGATION, lendingMarket: MARKET, repayReserve: RES,
        reserveLiquidityMint: MINT, reserveDestinationLiquidity: SUPPLY, userSourceLiquidity: USER_LIQ,
        tokenProgram: TOKEN_PROG,
      },
    });
    const oracleProgs = [PYTH.toBase58(), SCOPE.toBase58()];
    const a = assembleKaminoTx({
      instructions: [refresh, obl, op],
      ixNames: ["refreshReserve", "refreshObligation", "repay"],
      oracleProgramIds: oracleProgs,
      feePayer: OWNER,
      recentBlockhash: "11111111111111111111111111111111",
    });
    expect(a.programIds).toContain(LEND);
    expect(a.programIds).toContain(PYTH.toBase58());
    expect(a.programIds).toContain(SCOPE.toBase58());
    expect(a.instructionSummary.map((s) => s.ixName)).toEqual([
      "refreshReserve", "refreshObligation", "repay",
    ]);
    expect(a.messageBytes).toBeInstanceOf(Uint8Array);
  });
});

// ---------------------------------------------------------------------------
// Phase 13 Plan 13-06 — obligation-init 2-step builder (initUserMetadata THEN
// initObligation — V9: obligation requires userMetadata to exist first).
// ---------------------------------------------------------------------------
describe("Kamino obligation-init 2-step builder (13-06, V9)", () => {
  it("buildInitUserMetadataIx: discriminator + 32-byte LUT arg + 6 accounts", () => {
    const ix = buildInitUserMetadataIx({ owner: OWNER, feePayer: OWNER, userMetadata: USER_META });
    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(discHead(ix)).toEqual(KAMINO_DISCRIMINATOR.initUserMetadata);
    // data = 8 disc + 32 pubkey (default LUT).
    expect(ix.data.length).toBe(40);
    expect(ix.keys).toHaveLength(6);
    expect(ix.keys[0]!.isSigner).toBe(true); // owner signer.
    expect(ix.keys[1]!.isWritable && ix.keys[1]!.isSigner).toBe(true); // feePayer writable signer.
  });

  it("buildInitObligationIx: discriminator + InitObligationArgs{tag:0,id:0} + 9 accounts", () => {
    const ix = buildInitObligationIx({
      obligationOwner: OWNER, feePayer: OWNER, obligation: OBLIGATION,
      lendingMarket: MARKET, ownerUserMetadata: USER_META,
    });
    expect(discHead(ix)).toEqual(KAMINO_DISCRIMINATOR.initObligation);
    // data = 8 disc + 2 bytes (tag u8 + id u8) = 10.
    expect(ix.data.length).toBe(10);
    expect(Buffer.from(ix.data.slice(8)).toString("hex")).toBe("0000");
    expect(ix.keys).toHaveLength(9);
  });

  it("the 2-ix pair assembles in order (initUserMetadata FIRST — V9)", () => {
    const a = _kamino.assembleKaminoTx({
      instructions: [
        buildInitUserMetadataIx({ owner: OWNER, feePayer: OWNER, userMetadata: USER_META }),
        buildInitObligationIx({
          obligationOwner: OWNER, feePayer: OWNER, obligation: OBLIGATION,
          lendingMarket: MARKET, ownerUserMetadata: USER_META,
        }),
      ],
      ixNames: ["initUserMetadata", "initObligation"],
      oracleProgramIds: [],
      feePayer: OWNER,
      recentBlockhash: "11111111111111111111111111111111",
    });
    expect(a.instructionSummary.map((s) => s.ixName)).toEqual(["initUserMetadata", "initObligation"]);
    // only the lending program is touched (no oracles for init).
    expect(a.programIds).toEqual([LEND]);
  });
});
