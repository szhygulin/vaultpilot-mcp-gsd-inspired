// Phase 16 Plan 16-03 — lifi-solana deserialize / v0-guard tests.
//
// BRANCH DECISION (Task -1 auto-determination, LOGGED in 16-03-SUMMARY.md):
//   A live GET https://li.quest/v1/quote?...&toChain=SOL capture SUCCEEDED
//   (HTTP 200) but the returned base64 Solana tx had byte-0 = 0xd3 (>= 0x80 →
//   v0 / VersionedTransaction). Per the spec this drives BRANCH (b) CONSERVATIVE
//   REFUSE: inbound returns a typed LifiV0TransactionError; NO legacy decode,
//   NO Fixture AD, the Solana canonical-dispatch arm stays INACTIVE. The FROZEN
//   binding (legacy serializeMessage() bytes only) is never touched; v0 is NEVER
//   silently accepted.
//
// NO-LIVE-HTTP — all bytes are mocked here.
//
// Coverage:
//   (1) a v0 byte-0-0x80 fixture → deserializeLifiSolanaTx throws
//       LifiV0TransactionError (NEVER falls through to Transaction.from, NEVER
//       produces v0 message bytes). [Always — both branches.]
//   (2) BRANCH (b): the captured-shape v0 (byte-0 0xd3) is refused with the
//       typed error — the EXACT shape the live capture returned.
//   (3) a legacy fixture → returns serializeMessage() bytes (NOT serialize()).
//       Proves the guard does NOT over-reject a real legacy tx, should LiFi ever
//       expose one. Mirror of jupiter.ts's serializeMessage()-only preimage.

import { describe, expect, it } from "vitest";
import { Transaction, SystemProgram, PublicKey } from "@solana/web3.js";

import {
  LifiV0TransactionError,
  deserializeLifiSolanaTx,
  _lifiSolana,
} from "../src/protocols/lifi-solana.js";

// A minimal LEGACY transaction → base64. feePayer + recentBlockhash set so
// serializeMessage() succeeds. (web3.js v1 legacy Transaction class.)
function legacyTxB64(): string {
  const payer = new PublicKey("7gxcsRkHzkbqfQwjV2eDdmCkK8gPjVf9YpY5fG5L8aBc");
  const tx = new Transaction();
  tx.feePayer = payer;
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: payer,
      lamports: 1,
    }),
  );
  // serialize unsigned message envelope → base64 (no signatures present).
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

// A synthetic v0 fixture: signature count 1, then 64 zero sig bytes, then a
// message whose first byte has the versioned high bit set (0x80). This is the
// shape isVersionedTransaction() detects.
function v0B64(firstMessageByte: number): string {
  const sigCount = Buffer.from([1]); // compact-u16 = 1
  const sigBlob = Buffer.alloc(64, 0);
  const message = Buffer.from([firstMessageByte, 0, 0, 0]); // high-bit-set header
  return Buffer.concat([sigCount, sigBlob, message]).toString("base64");
}

describe("deserializeLifiSolanaTx — v0-guard (mirror Jupiter byte-0 0x80)", () => {
  it("(1) byte-0 0x80 → throws LifiV0TransactionError (never falls through)", () => {
    expect(() => deserializeLifiSolanaTx(v0B64(0x80))).toThrow(LifiV0TransactionError);
  });

  it("(2) BRANCH (b): captured-shape v0 (byte-0 0xd3) → typed refusal", () => {
    // 0xd3 is the exact byte-0 the live li.quest capture returned for EVM→SOL.
    expect(() => deserializeLifiSolanaTx(v0B64(0xd3))).toThrow(LifiV0TransactionError);
    expect(() => deserializeLifiSolanaTx(v0B64(0xd3))).toThrow(/v0|Versioned|legacy/i);
  });

  it("(3) legacy tx → returns serializeMessage() bytes (NOT serialize())", () => {
    const b64 = legacyTxB64();
    const out = deserializeLifiSolanaTx(b64);
    // The returned bytes are the FROZEN-binding preimage: serializeMessage().
    const raw = Buffer.from(b64, "base64");
    const tx = Transaction.from(raw);
    const expected = new Uint8Array(tx.serializeMessage());
    expect(Buffer.from(out.messageBytes).equals(Buffer.from(expected))).toBe(true);
    // It is NOT the full signed-envelope serialize() output.
    expect(out.messageBytes.length).toBeLessThan(raw.length);
  });

  it("empty / malformed payload throws a plain Error (not silent)", () => {
    expect(() => deserializeLifiSolanaTx("")).toThrow();
  });

  it("exposes the _lifiSolana spy-affordance indirection", () => {
    expect(typeof _lifiSolana.deserializeLifiSolanaTx).toBe("function");
  });
});

// BRANCH (b): decodeLifiSolanaRecipient is NOT shipped. The inbound recipient
// decode + Inv #6b + Fixture AD are deferred until LiFi exposes a legacy path
// (documented residual in SECURITY.md). This is enforced by the module export
// surface — decodeLifiSolanaRecipient is intentionally absent.
describe("BRANCH (b) — no legacy decode shipped (conservative refuse)", () => {
  it("the module does NOT export a shipped decodeLifiSolanaRecipient (v0-only upstream)", async () => {
    const mod = await import("../src/protocols/lifi-solana.js");
    expect((mod as Record<string, unknown>).decodeLifiSolanaRecipient).toBeUndefined();
  });
});
