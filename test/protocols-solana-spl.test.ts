// Pure encode + decode + build tests for `src/protocols/solana-spl.ts`.
//
// Phase 12 — Plan 12-03. Mirror of `test/protocols-solana-system.test.ts`
// (Plan 12-02) + `test/protocols-erc20.test.ts` (Phase 6) shape. Anchors:
//   - `SPL_TRANSFER_CHECKED_DISCRIMINANT === 12` byte-identical (regression
//     against upstream `TokenInstruction` enum re-ordering).
//   - `encodeSplTransferChecked` returns a `TransactionInstruction` with the
//     SPL Token Program ID + 10-byte data + 4 account keys.
//   - `buildSplTransferTx` round-trips: same inputs → byte-identical
//     `messageBytes` (load-bearing for the trust pipeline — Plan 12-05).
//   - **TransferChecked (NOT Transfer) regression-anchor**: build path calls
//     `createTransferCheckedInstruction`; the deprecated `createTransferInstruction`
//     would produce a 9-byte data with discriminant 3 (NOT 12) and 3 keys
//     (NOT 4). Per RESEARCH § Topic 6 defense-in-depth.
//   - ATA derivation is deterministic across calls.
//   - `maybeAppendCreateAtaInstruction` happy-path (ATA exists) + create-path
//     (ATA absent).
//   - `decodeSplCall` discriminated-union round-trip.
//   - `_solanaSpl` ESM spy-affordance (CLAUDE.md non-negotiable).

import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { describe, expect, it, vi } from "vitest";

import {
  SPL_TRANSFER_CHECKED_DISCRIMINANT,
  _solanaSpl,
  buildSplTransferTx,
  decodeSplCall,
  deriveAtaForOwner,
  encodeSplTransferChecked,
  maybeAppendCreateAtaInstruction,
} from "../src/protocols/solana-spl.js";

// Pinned canonical inputs — must match the Fixture L shape from
// `test/signing-fingerprint-solana.test.ts` so the per-component anchor here
// stays cross-linked with the cryptographic fingerprint regression.
const FROM = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const TO = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
const ONE_HUNDRED_USDC = 100_000_000n; // 100 USDC at 6 decimals
const USDC_DECIMALS = 6;

// Stub a Connection that returns the configured ATA-exists result.
function stubConnection(opts: {
  destAtaExists: boolean;
  throwOnGetAccountInfo?: boolean;
}): Connection {
  return {
    getAccountInfo: vi.fn(async (_pubkey: PublicKey) => {
      if (opts.throwOnGetAccountInfo) {
        throw new Error("RPC down");
      }
      if (opts.destAtaExists) {
        // 165-byte SPL token account size (canonical AccountLayout span).
        // The shape can be anything non-null — `maybeAppendCreateAtaInstruction`
        // only checks for null.
        return {
          data: Buffer.alloc(165),
          executable: false,
          lamports: 2_039_280,
          owner: TOKEN_PROGRAM_ID,
          rentEpoch: 0,
        } satisfies AccountInfo<Buffer>;
      }
      return null;
    }),
  } as unknown as Connection;
}

describe("SPL_TRANSFER_CHECKED_DISCRIMINANT — TokenInstruction enum regression anchor", () => {
  it("equals 12 (TransferChecked per upstream TokenInstruction enum)", () => {
    expect(SPL_TRANSFER_CHECKED_DISCRIMINANT).toBe(12);
  });
});

describe("deriveAtaForOwner — ATA derivation determinism + sender-dependence", () => {
  it("returns deterministic PDA for (mint, owner); same inputs → same ATA across calls", async () => {
    const a = await deriveAtaForOwner(FROM, USDC_MINT);
    const b = await deriveAtaForOwner(FROM, USDC_MINT);
    expect(a.toBase58()).toBe(b.toBase58());
    // Cross-link to Fixture L: this is the source ATA literal pinned at
    // signing-fingerprint-solana.test.ts:111.
    expect(a.toBase58()).toBe("FzbcyEZ9m8xjtergWgWDq7mfPoHEbboBF791B6cTpzbq");
  });

  it("returns DIFFERENT ATA for different owners (sender-dependence anchor)", async () => {
    const fromAta = await deriveAtaForOwner(FROM, USDC_MINT);
    const toAta = await deriveAtaForOwner(TO, USDC_MINT);
    expect(fromAta.toBase58()).not.toBe(toAta.toBase58());
    // Cross-link to Fixture L: this is the destination ATA literal pinned at
    // signing-fingerprint-solana.test.ts:112.
    expect(toAta.toBase58()).toBe("3wvJdyFnGvaMWpbq93NU91SggiVRveULUXL6iX5VZDGP");
  });

  it("matches the synchronous variant byte-for-byte (NEVER hand-roll the seed order)", async () => {
    const asyncAta = await deriveAtaForOwner(FROM, USDC_MINT);
    const syncAta = getAssociatedTokenAddressSync(USDC_MINT, FROM);
    expect(asyncAta.toBase58()).toBe(syncAta.toBase58());
  });
});

describe("maybeAppendCreateAtaInstruction — happy path (ATA exists)", () => {
  it("returns { instructions: [], created: false } when getAccountInfo returns non-null", async () => {
    const connection = stubConnection({ destAtaExists: true });
    const destAta = await deriveAtaForOwner(TO, USDC_MINT);

    const result = await maybeAppendCreateAtaInstruction({
      connection,
      payer: FROM,
      destinationAta: destAta,
      recipientOwner: TO,
      mint: USDC_MINT,
    });

    expect(result.created).toBe(false);
    expect(result.instructions).toEqual([]);
    expect(connection.getAccountInfo).toHaveBeenCalledTimes(1);
    expect(connection.getAccountInfo).toHaveBeenCalledWith(destAta);
  });
});

describe("maybeAppendCreateAtaInstruction — create path (ATA absent)", () => {
  it("returns { instructions: [createATA ix], created: true } when getAccountInfo returns null", async () => {
    const connection = stubConnection({ destAtaExists: false });
    const destAta = await deriveAtaForOwner(TO, USDC_MINT);

    const result = await maybeAppendCreateAtaInstruction({
      connection,
      payer: FROM,
      destinationAta: destAta,
      recipientOwner: TO,
      mint: USDC_MINT,
    });

    expect(result.created).toBe(true);
    expect(result.instructions.length).toBe(1);
    const createIx = result.instructions[0];
    expect(createIx).toBeDefined();
    if (!createIx) return;
    // The createATA instruction is addressed to the Associated Token Program.
    expect(createIx.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    );
  });
});

describe("encodeSplTransferChecked — canonical SPL TransferChecked instruction", () => {
  it("returns TransactionInstruction with TOKEN_PROGRAM_ID + 4 account keys + 10-byte data", async () => {
    const sourceAta = await deriveAtaForOwner(FROM, USDC_MINT);
    const destAta = await deriveAtaForOwner(TO, USDC_MINT);

    const ix = encodeSplTransferChecked({
      source: sourceAta,
      mint: USDC_MINT,
      destination: destAta,
      owner: FROM,
      amount: ONE_HUNDRED_USDC,
      decimals: USDC_DECIMALS,
    });

    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(ix.programId.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
    // Account-key ordering: source-writable, mint-readonly, dest-writable, owner-signer.
    expect(ix.keys.length).toBe(4);
    expect(ix.keys[0]?.pubkey.toBase58()).toBe(sourceAta.toBase58());
    expect(ix.keys[0]?.isWritable).toBe(true);
    expect(ix.keys[1]?.pubkey.toBase58()).toBe(USDC_MINT.toBase58());
    expect(ix.keys[1]?.isWritable).toBe(false);
    expect(ix.keys[2]?.pubkey.toBase58()).toBe(destAta.toBase58());
    expect(ix.keys[2]?.isWritable).toBe(true);
    expect(ix.keys[3]?.pubkey.toBase58()).toBe(FROM.toBase58());
    expect(ix.keys[3]?.isSigner).toBe(true);
    // Data layout: 1-byte u8 discriminant (== 12 for TransferChecked) +
    // 8-byte LE u64 amount + 1-byte decimals = 10 bytes total.
    expect(ix.data.length).toBe(10);
    const buf = Buffer.from(ix.data);
    expect(buf.readUInt8(0)).toBe(SPL_TRANSFER_CHECKED_DISCRIMINANT);
    expect(buf.readBigUInt64LE(1)).toBe(ONE_HUNDRED_USDC);
    expect(buf.readUInt8(9)).toBe(USDC_DECIMALS);
  });

  it("TransferChecked (NOT deprecated Transfer) regression-anchor: discriminant === 12, NOT 3", async () => {
    // Per RESEARCH § Topic 6 (defense-in-depth on-chain decimals
    // verification): we MUST use createTransferCheckedInstruction (discriminant
    // 12, 10-byte data with mint + decimals) NOT the deprecated
    // createTransferInstruction (discriminant 3, 9-byte data without mint/
    // decimals verification). If a future "optimization" swaps these, this
    // test fires.
    const sourceAta = await deriveAtaForOwner(FROM, USDC_MINT);
    const destAta = await deriveAtaForOwner(TO, USDC_MINT);
    const ix = encodeSplTransferChecked({
      source: sourceAta,
      mint: USDC_MINT,
      destination: destAta,
      owner: FROM,
      amount: ONE_HUNDRED_USDC,
      decimals: USDC_DECIMALS,
    });
    const buf = Buffer.from(ix.data);
    // Discriminant 12 = TransferChecked. Discriminant 3 would be the
    // deprecated Transfer — explicit refusal here.
    expect(buf.readUInt8(0)).toBe(12);
    expect(buf.readUInt8(0)).not.toBe(3);
    // 4 account keys (source, mint, dest, owner) — the deprecated Transfer
    // has only 3 (no mint key).
    expect(ix.keys.length).toBe(4);
    expect(ix.keys.length).not.toBe(3);
    // The mint key is at position 1 — the deprecated Transfer does NOT
    // include the mint, so a TransferChecked-shape test that finds mint at
    // keys[1] proves it's the checked variant.
    expect(ix.keys[1]?.pubkey.toBase58()).toBe(USDC_MINT.toBase58());
  });
});

describe("buildSplTransferTx — happy path (ATA exists)", () => {
  it("returns single-instruction tx with programIds: [TOKEN_PROGRAM_ID] + createDestAta: false", async () => {
    const connection = stubConnection({ destAtaExists: true });

    const result = await buildSplTransferTx({
      connection,
      from: FROM,
      toWallet: TO,
      mint: USDC_MINT,
      amount: ONE_HUNDRED_USDC,
      decimals: USDC_DECIMALS,
      recentBlockhash: FIXED_BLOCKHASH,
    });

    expect(result.transaction).toBeInstanceOf(Transaction);
    expect(result.transaction.instructions.length).toBe(1);
    expect(result.programIds).toEqual([TOKEN_PROGRAM_ID.toBase58()]);
    expect(result.createDestAta).toBe(false);
    expect(result.sourceAta).toBe("FzbcyEZ9m8xjtergWgWDq7mfPoHEbboBF791B6cTpzbq");
    expect(result.destAta).toBe("3wvJdyFnGvaMWpbq93NU91SggiVRveULUXL6iX5VZDGP");
    expect(result.instructionSummary).toEqual([
      {
        kind: "spl-transfer-checked",
        mint: USDC_MINT.toBase58(),
        sourceAta: "FzbcyEZ9m8xjtergWgWDq7mfPoHEbboBF791B6cTpzbq",
        destAta: "3wvJdyFnGvaMWpbq93NU91SggiVRveULUXL6iX5VZDGP",
        destOwner: TO.toBase58(),
        amount: ONE_HUNDRED_USDC,
        decimals: USDC_DECIMALS,
      },
    ]);
    // Fixture L message-bytes length anchor (cross-linked with
    // signing-fingerprint-solana.test.ts:129).
    expect(result.messageBytes.length).toBe(214);
  });
});

describe("buildSplTransferTx — create-ATA path (ATA absent)", () => {
  it("returns two-instruction tx (createATA first, transferChecked second); programIds includes BOTH program IDs; createDestAta: true", async () => {
    const connection = stubConnection({ destAtaExists: false });

    const result = await buildSplTransferTx({
      connection,
      from: FROM,
      toWallet: TO,
      mint: USDC_MINT,
      amount: ONE_HUNDRED_USDC,
      decimals: USDC_DECIMALS,
      recentBlockhash: FIXED_BLOCKHASH,
    });

    expect(result.transaction.instructions.length).toBe(2);
    // First instruction is createATA (Associated Token Program), second is
    // transferChecked (SPL Token Program). Pitfall 4 — createATA goes FIRST.
    expect(result.transaction.instructions[0]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    );
    expect(result.transaction.instructions[1]?.programId.toBase58()).toBe(
      TOKEN_PROGRAM_ID.toBase58(),
    );
    expect(result.programIds).toEqual([
      TOKEN_PROGRAM_ID.toBase58(),
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    ]);
    expect(result.createDestAta).toBe(true);
    // Message bytes will be LONGER than the ATA-exists case (extra
    // instruction in the message).
    expect(result.messageBytes.length).toBeGreaterThan(214);
  });
});

describe("buildSplTransferTx — message-bytes byte-stability regression", () => {
  it("same inputs → byte-identical messageBytes across two builds (load-bearing for trust pipeline)", async () => {
    const connection = stubConnection({ destAtaExists: true });
    const a = await buildSplTransferTx({
      connection,
      from: FROM,
      toWallet: TO,
      mint: USDC_MINT,
      amount: ONE_HUNDRED_USDC,
      decimals: USDC_DECIMALS,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    const b = await buildSplTransferTx({
      connection,
      from: FROM,
      toWallet: TO,
      mint: USDC_MINT,
      amount: ONE_HUNDRED_USDC,
      decimals: USDC_DECIMALS,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    expect(Array.from(a.messageBytes)).toEqual(Array.from(b.messageBytes));
  });

  it("input sensitivity: swapping amount changes messageBytes", async () => {
    const connection = stubConnection({ destAtaExists: true });
    const a = await buildSplTransferTx({
      connection,
      from: FROM,
      toWallet: TO,
      mint: USDC_MINT,
      amount: 100_000_000n,
      decimals: USDC_DECIMALS,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    const b = await buildSplTransferTx({
      connection,
      from: FROM,
      toWallet: TO,
      mint: USDC_MINT,
      amount: 100_000_001n,
      decimals: USDC_DECIMALS,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    expect(Array.from(a.messageBytes)).not.toEqual(Array.from(b.messageBytes));
  });
});

describe("decodeSplCall — discriminated-union round-trip", () => {
  it("(transfer-checked) round-trips an encoded instruction back to { kind, source, mint, destination, owner, amount, decimals }", async () => {
    const sourceAta = await deriveAtaForOwner(FROM, USDC_MINT);
    const destAta = await deriveAtaForOwner(TO, USDC_MINT);
    const ix = encodeSplTransferChecked({
      source: sourceAta,
      mint: USDC_MINT,
      destination: destAta,
      owner: FROM,
      amount: ONE_HUNDRED_USDC,
      decimals: USDC_DECIMALS,
    });
    const decoded = decodeSplCall(ix);
    expect(decoded.kind).toBe("transfer-checked");
    if (decoded.kind !== "transfer-checked") return;
    expect(decoded.source).toBe(sourceAta.toBase58());
    expect(decoded.mint).toBe(USDC_MINT.toBase58());
    expect(decoded.destination).toBe(destAta.toBase58());
    expect(decoded.owner).toBe(FROM.toBase58());
    expect(decoded.amount).toBe(ONE_HUNDRED_USDC);
    expect(decoded.decimals).toBe(USDC_DECIMALS);
  });

  it("(unknown) instruction with non-Token / non-AssociatedToken program ID → { kind: \"unknown\" }; never throws", () => {
    // System Program — different program ID than either Token Program.
    const ix = new TransactionInstruction({
      keys: [],
      programId: SystemProgram.programId,
      data: Buffer.from([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    });
    expect(() => decodeSplCall(ix)).not.toThrow();
    const decoded = decodeSplCall(ix);
    expect(decoded.kind).toBe("unknown");
  });

  it("(unknown) SPL Token Program instruction with wrong discriminant → { kind: \"unknown\" }", () => {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: FROM, isSigner: true, isWritable: true },
        { pubkey: USDC_MINT, isSigner: false, isWritable: false },
        { pubkey: TO, isSigner: false, isWritable: true },
        { pubkey: FROM, isSigner: true, isWritable: false },
      ],
      programId: TOKEN_PROGRAM_ID,
      // Discriminant 99 (not TransferChecked) — defense against future
      // TokenInstruction enum additions.
      data: Buffer.concat([
        Buffer.from([99]),
        Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
        Buffer.from([6]),
      ]),
    });
    const decoded = decodeSplCall(ix);
    expect(decoded.kind).toBe("unknown");
  });

  it("(unknown) truncated data (< 10 bytes for TransferChecked) → { kind: \"unknown\" }; never throws", () => {
    const ix = new TransactionInstruction({
      keys: [],
      programId: TOKEN_PROGRAM_ID,
      data: Buffer.from([12, 0, 0]), // discriminant only + 2 bytes
    });
    expect(() => decodeSplCall(ix)).not.toThrow();
    expect(decodeSplCall(ix).kind).toBe("unknown");
  });

  it("(create-ata) decodes an Associated Token Program instruction back to { kind, payer, destinationAta, owner, mint }", async () => {
    // Build a create-ATA instruction via the public API + decode it.
    const connection = stubConnection({ destAtaExists: false });
    const destAta = await deriveAtaForOwner(TO, USDC_MINT);
    const { instructions } = await maybeAppendCreateAtaInstruction({
      connection,
      payer: FROM,
      destinationAta: destAta,
      recipientOwner: TO,
      mint: USDC_MINT,
    });
    const createIx = instructions[0];
    expect(createIx).toBeDefined();
    if (!createIx) return;
    const decoded = decodeSplCall(createIx);
    expect(decoded.kind).toBe("create-ata");
    if (decoded.kind !== "create-ata") return;
    expect(decoded.payer).toBe(FROM.toBase58());
    expect(decoded.destinationAta).toBe(destAta.toBase58());
    expect(decoded.owner).toBe(TO.toBase58());
    expect(decoded.mint).toBe(USDC_MINT.toBase58());
  });
});

describe("_solanaSpl — ESM spy-affordance regression (CLAUDE.md non-negotiable)", () => {
  it("vi.spyOn(_solanaSpl, \"buildSplTransferTx\") intercepts the indirection call", async () => {
    const fakeResult = {
      transaction: new Transaction({
        recentBlockhash: FIXED_BLOCKHASH,
        feePayer: FROM,
      }),
      messageBytes: new Uint8Array([1, 2, 3]),
      programIds: ["spy"],
      instructionSummary: [],
      createDestAta: false,
      sourceAta: "spy-source",
      destAta: "spy-dest",
    };
    const spy = vi
      .spyOn(_solanaSpl, "buildSplTransferTx")
      .mockResolvedValue(
        fakeResult as Awaited<ReturnType<typeof _solanaSpl.buildSplTransferTx>>,
      );

    const result = await _solanaSpl.buildSplTransferTx({
      connection: stubConnection({ destAtaExists: true }),
      from: FROM,
      toWallet: TO,
      mint: USDC_MINT,
      amount: ONE_HUNDRED_USDC,
      decimals: USDC_DECIMALS,
      recentBlockhash: FIXED_BLOCKHASH,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(fakeResult);
    spy.mockRestore();
  });

  it("vi.spyOn(_solanaSpl, \"encodeSplTransferChecked\") intercepts the indirection call", async () => {
    const fakeIx = {
      programId: TOKEN_PROGRAM_ID,
      keys: [],
      data: Buffer.from([12, 0, 0, 0, 0, 0, 0, 0, 0, 6]),
    } as unknown as TransactionInstruction;
    const spy = vi
      .spyOn(_solanaSpl, "encodeSplTransferChecked")
      .mockReturnValue(fakeIx);
    const sourceAta = await deriveAtaForOwner(FROM, USDC_MINT);
    const destAta = await deriveAtaForOwner(TO, USDC_MINT);

    const result = _solanaSpl.encodeSplTransferChecked({
      source: sourceAta,
      mint: USDC_MINT,
      destination: destAta,
      owner: FROM,
      amount: ONE_HUNDRED_USDC,
      decimals: USDC_DECIMALS,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBe(fakeIx);
    spy.mockRestore();
  });
});
