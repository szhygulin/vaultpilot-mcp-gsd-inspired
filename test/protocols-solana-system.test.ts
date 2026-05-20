// Pure encode + decode + build tests for `src/protocols/solana-system.ts`.
//
// Phase 12 — Plan 12-02. Mirror of `test/protocols-erc20.test.ts` (Phase 6 /
// Plan 06-02) shape. Anchors:
//   - `SYSTEM_TRANSFER_DISCRIMINANT === 2` byte-identical (regression against
//     upstream `SystemInstruction` enum re-ordering).
//   - `encodeSolanaTransfer` returns a TransactionInstruction with the
//     System Program ID + 12-byte data (4-byte discriminant + 8-byte u64).
//   - `buildSolanaTransferTx` round-trips: same inputs → byte-identical
//     `messageBytes` (load-bearing for the trust pipeline — Plan 12-05).
//   - `decodeSolanaSystemCall` handles the transfer + unknown branches.
//   - `_solanaSystem` ESM spy-affordance intercepts (CLAUDE.md non-negotiable).

import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  SYSTEM_TRANSFER_DISCRIMINANT,
  _solanaSystem,
  buildSolanaTransferTx,
  decodeSolanaSystemCall,
  encodeSolanaTransfer,
} from "../src/protocols/solana-system.js";

// Pinned canonical inputs — match the Fixture K shape from
// `test/signing-fingerprint-solana.test.ts` so the per-component anchor here
// stays cross-linked with the cryptographic fingerprint regression.
const FROM = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const TO = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
const ONE_SOL_LAMPORTS = 1_000_000_000n;

describe("SYSTEM_TRANSFER_DISCRIMINANT — System Program enum regression anchor", () => {
  it("equals 2 (Transfer instruction discriminant per upstream SystemInstruction enum)", () => {
    expect(SYSTEM_TRANSFER_DISCRIMINANT).toBe(2);
  });
});

describe("encodeSolanaTransfer — canonical System Program Transfer instruction", () => {
  it("returns TransactionInstruction with System Program ID + 12-byte data + 2 account keys", () => {
    const ix = encodeSolanaTransfer({
      from: FROM,
      to: TO,
      lamports: ONE_SOL_LAMPORTS,
    });
    expect(ix).toBeInstanceOf(TransactionInstruction);
    expect(ix.programId.toBase58()).toBe(SystemProgram.programId.toBase58());
    // System Program addressed by the canonical all-1s pubkey.
    expect(ix.programId.toBase58()).toBe("11111111111111111111111111111111");
    // Account-key ordering: keys[0] = from (signer + writable), keys[1] = to (writable).
    expect(ix.keys.length).toBe(2);
    expect(ix.keys[0]?.pubkey.toBase58()).toBe(FROM.toBase58());
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(ix.keys[0]?.isWritable).toBe(true);
    expect(ix.keys[1]?.pubkey.toBase58()).toBe(TO.toBase58());
    expect(ix.keys[1]?.isSigner).toBe(false);
    expect(ix.keys[1]?.isWritable).toBe(true);
    // Data layout: 4-byte LE u32 discriminant (== 2) + 8-byte LE u64 lamports.
    expect(ix.data.length).toBe(12);
    const buf = Buffer.from(ix.data);
    expect(buf.readUInt32LE(0)).toBe(SYSTEM_TRANSFER_DISCRIMINANT);
    expect(buf.readBigUInt64LE(4)).toBe(ONE_SOL_LAMPORTS);
  });

  it("encodes different lamports values into the data tail (byte sensitivity)", () => {
    const ixA = encodeSolanaTransfer({ from: FROM, to: TO, lamports: 1n });
    const ixB = encodeSolanaTransfer({ from: FROM, to: TO, lamports: 2n });
    expect(ixA.data).not.toEqual(ixB.data);
  });
});

describe("buildSolanaTransferTx — message-bytes byte-stability + summary shape", () => {
  it("returns { transaction, messageBytes, programIds, instructionSummary } with consistent fields", () => {
    const result = buildSolanaTransferTx({
      from: FROM,
      to: TO,
      lamports: ONE_SOL_LAMPORTS,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    // Transaction object carries the right instruction.
    expect(result.transaction).toBeInstanceOf(Transaction);
    expect(result.transaction.feePayer?.toBase58()).toBe(FROM.toBase58());
    expect(result.transaction.recentBlockhash).toBe(FIXED_BLOCKHASH);
    expect(result.transaction.instructions.length).toBe(1);
    // Program IDs surface only System Program for native transfers.
    expect(result.programIds).toEqual([SystemProgram.programId.toBase58()]);
    // messageBytes are byte-identical to `transaction.serializeMessage()` —
    // the same bytes the network signs over (load-bearing for the trust
    // pipeline; `computeSolanaPayloadFingerprint` hashes exactly these).
    const reSerialized = new Uint8Array(result.transaction.serializeMessage());
    expect(Array.from(result.messageBytes)).toEqual(Array.from(reSerialized));
    // Fixture K message-bytes length anchor (cross-linked with
    // signing-fingerprint-solana.test.ts Fixture K assertion at line 83).
    expect(result.messageBytes.length).toBe(150);
    // Instruction summary mirrors the encoded inputs.
    expect(result.instructionSummary).toEqual([
      {
        kind: "native-transfer",
        from: FROM.toBase58(),
        to: TO.toBase58(),
        lamports: ONE_SOL_LAMPORTS,
      },
    ]);
  });

  it("byte-stability regression: same inputs → byte-identical messageBytes across two builds", () => {
    const a = buildSolanaTransferTx({
      from: FROM,
      to: TO,
      lamports: ONE_SOL_LAMPORTS,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    const b = buildSolanaTransferTx({
      from: FROM,
      to: TO,
      lamports: ONE_SOL_LAMPORTS,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    // Byte-identical — drift here breaks the trust pipeline's
    // PAYLOAD_FINGERPRINT_DRIFT guarantee (Plan 12-05).
    expect(Array.from(a.messageBytes)).toEqual(Array.from(b.messageBytes));
  });

  it("input sensitivity: swapping lamports changes messageBytes", () => {
    const a = buildSolanaTransferTx({
      from: FROM,
      to: TO,
      lamports: 1_000_000_000n,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    const b = buildSolanaTransferTx({
      from: FROM,
      to: TO,
      lamports: 2_000_000_000n,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    expect(Array.from(a.messageBytes)).not.toEqual(Array.from(b.messageBytes));
  });

  it("input sensitivity: swapping recipient changes messageBytes", () => {
    const TO_ALT = new PublicKey("4Nd1mYpEv5sV7qfsT4hWfRSyKi5dWKBz9XGmAfWPVxA8");
    const a = buildSolanaTransferTx({
      from: FROM,
      to: TO,
      lamports: ONE_SOL_LAMPORTS,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    const b = buildSolanaTransferTx({
      from: FROM,
      to: TO_ALT,
      lamports: ONE_SOL_LAMPORTS,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    expect(Array.from(a.messageBytes)).not.toEqual(Array.from(b.messageBytes));
  });
});

describe("decodeSolanaSystemCall — discriminated-union decode", () => {
  it("(transfer) round-trips a built transaction back to { kind: \"transfer\", from, to, lamports }", () => {
    const { transaction } = buildSolanaTransferTx({
      from: FROM,
      to: TO,
      lamports: ONE_SOL_LAMPORTS,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    const decoded = decodeSolanaSystemCall(transaction);
    expect(decoded.kind).toBe("transfer");
    if (decoded.kind !== "transfer") return;
    expect(decoded.from).toBe(FROM.toBase58());
    expect(decoded.to).toBe(TO.toBase58());
    expect(decoded.lamports).toBe(ONE_SOL_LAMPORTS);
  });

  it("(unknown) empty instruction list → { kind: \"unknown\" }; never throws", () => {
    const empty = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
    const decoded = decodeSolanaSystemCall(empty);
    expect(decoded.kind).toBe("unknown");
  });

  it("(unknown) instruction with non-System Program ID → { kind: \"unknown\" }", () => {
    // Memo program — a different program ID than System Program. The decoder
    // returns `unknown` rather than mis-categorizing.
    const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    const tx = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
    tx.add(
      new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM,
        data: Buffer.from("hello"),
      }),
    );
    const decoded = decodeSolanaSystemCall(tx);
    expect(decoded.kind).toBe("unknown");
  });

  it("(unknown) System Program instruction with wrong discriminant → { kind: \"unknown\" }", () => {
    // Construct a hand-rolled System Program instruction with discriminant 99
    // (not a real instruction). The decoder defends against future-System-
    // Program-instruction-set additions by rejecting unknown discriminants.
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: FROM, isSigner: true, isWritable: true },
        { pubkey: TO, isSigner: false, isWritable: true },
      ],
      programId: SystemProgram.programId,
      data: Buffer.concat([
        Buffer.from([99, 0, 0, 0]), // discriminant 99
        Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]), // 8-byte LE u64 = 0
      ]),
    });
    const tx = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
    tx.add(ix);
    const decoded = decodeSolanaSystemCall(tx);
    expect(decoded.kind).toBe("unknown");
  });

  it("(unknown) truncated data (< 12 bytes) → { kind: \"unknown\" }; never throws", () => {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: FROM, isSigner: true, isWritable: true },
        { pubkey: TO, isSigner: false, isWritable: true },
      ],
      programId: SystemProgram.programId,
      data: Buffer.from([2, 0, 0, 0]), // discriminant only, no lamports tail
    });
    const tx = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
    tx.add(ix);
    expect(() => decodeSolanaSystemCall(tx)).not.toThrow();
    const decoded = decodeSolanaSystemCall(tx);
    expect(decoded.kind).toBe("unknown");
  });
});

describe("_solanaSystem — ESM spy-affordance regression (CLAUDE.md non-negotiable)", () => {
  it("vi.spyOn(_solanaSystem, \"encodeSolanaTransfer\") intercepts the indirection call", () => {
    const spy = vi
      .spyOn(_solanaSystem, "encodeSolanaTransfer")
      .mockReturnValue({
        programId: SystemProgram.programId,
        keys: [],
        data: Buffer.from([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      } as unknown as TransactionInstruction);

    const result = _solanaSystem.encodeSolanaTransfer({
      from: FROM,
      to: TO,
      lamports: ONE_SOL_LAMPORTS,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      from: FROM,
      to: TO,
      lamports: ONE_SOL_LAMPORTS,
    });
    // Spy mock-return shape preserved.
    expect((result as unknown as { keys: unknown[] }).keys).toEqual([]);
    spy.mockRestore();
  });

  it("vi.spyOn(_solanaSystem, \"buildSolanaTransferTx\") intercepts the indirection call", () => {
    const fakeResult = {
      transaction: new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM }),
      messageBytes: new Uint8Array([1, 2, 3]),
      programIds: ["spy"],
      instructionSummary: [],
    };
    const spy = vi
      .spyOn(_solanaSystem, "buildSolanaTransferTx")
      .mockReturnValue(fakeResult as ReturnType<typeof _solanaSystem.buildSolanaTransferTx>);

    const result = _solanaSystem.buildSolanaTransferTx({
      from: FROM,
      to: TO,
      lamports: ONE_SOL_LAMPORTS,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(fakeResult);
    spy.mockRestore();
  });
});
