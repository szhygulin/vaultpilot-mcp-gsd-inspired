// test/tools-combine-btc-psbts.test.ts — Phase 25 Plan 25-02 Task 2
//
// Tool-layer tests for combine_btc_psbts.
//
// Test coverage:
//   - < 2 PSBTs → INVALID_INPUT
//   - non-string element → INVALID_INPUT
//   - conflict-free merge → success with combinedPsbt
//   - conflicting PSBTs → PSBT_COMBINE_CONFLICT with conflict detail in message
//   - malformed base64 → INTERNAL_ERROR
//
// Seam strategy: vi.spyOn(_btcPsbt, "combineBtcPsbts") so the tool tests
// exercise the handler logic without re-testing the cryptographic combine
// (already covered in btc-multisig-combine.test.ts).
// The integration case (no spy) uses real PSBTs built programmatically.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ─── Tool registration (side-effect import) ───────────────────────────────────
import "../src/tools/combine_btc_psbts.js";

import { getRegisteredTool } from "../src/tools/index.js";
import { _btcPsbt } from "../src/protocols/btc-psbt.js";
import type { BtcCombineResult } from "../src/protocols/btc-psbt.js";

// ─── Real PSBT builders for integration tests ─────────────────────────────────
import "../src/chains/bitcoin/types.js"; // initEccLib side-effect
import { Psbt, networks, payments } from "bitcoinjs-lib";
import { BIP32Factory } from "bip32";
import * as tinySecp256k1 from "tiny-secp256k1";

const bip32 = BIP32Factory(tinySecp256k1 as Parameters<typeof BIP32Factory>[0]);

const TEST_XPUB_0 = "xpub6C1HVMz946r433QEjZGpYYWYcspxXXBPys5PBGkmQboRXE6RLfFiStEkKbWKCZaPgDrzZh9nUEunxuiuy6MNdw23du2Ek7GoKYMJVH8eK5E";
const TEST_XPUB_1 = "xpub6C1HVMz946r45SLqXksZWuaVdbpznU1s5peogGPTXqkHcXChkh7TN9vC2mgcSFkdA5YpX94xfAPWZTPoDJhGbUdVwF13RfkY9ioGHSLEuUE";
const TEST_XPUB_2 = "xpub6C1HVMz946r488Vd17BsrsybenwSabqNkg5b42wvkZKnru8Wzgp56AaLERXpDastZzbDMWFpcEh9TJy64YHEnfRg2Se6Zj4W88srAcemued";

function buildMultisigPsbt(sigMap?: Map<string, Buffer>): Psbt {
  const xpubs = [TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2];
  const pubkeys = xpubs.map((x) =>
    Buffer.from(bip32.fromBase58(x, networks.bitcoin).derive(0).derive(0).publicKey),
  );
  const sorted = [...pubkeys].sort(Buffer.compare);

  const p2ms = payments.p2ms({ m: 2, pubkeys: sorted, network: networks.bitcoin });
  const p2wsh = payments.p2wsh({ redeem: p2ms, network: networks.bitcoin });

  const psbt = new Psbt({ network: networks.bitcoin });
  psbt.addInput({
    hash: Buffer.alloc(32, 0xaa),
    index: 0,
    sequence: 0xfffffffe,
    witnessUtxo: { script: Buffer.from(p2wsh.output!), value: BigInt(1_000_000) },
    witnessScript: Buffer.from(p2ms.output!),
  });
  psbt.addOutput({ script: Buffer.from(p2wsh.output!), value: BigInt(900_000) });

  if (sigMap) {
    const partialSig = [...sigMap.entries()].map(([pubkeyHex, sig]) => ({
      pubkey: Buffer.from(pubkeyHex, "hex"),
      signature: sig,
    }));
    psbt.data.inputs[0]!.partialSig = partialSig;
  }
  return psbt;
}

const SIG_A = Buffer.from("3044022001" + "a".repeat(62) + "022001" + "b".repeat(62), "hex");
const SIG_B = Buffer.from("3044022001" + "c".repeat(62) + "022001" + "d".repeat(62), "hex");

// ─── Helpers ──────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

function getHandler() {
  const tool = getRegisteredTool("combine_btc_psbts");
  expect(tool).toBeDefined();
  return (args: Record<string, unknown>) => tool!.handler(args);
}

// ─── INVALID_INPUT tests ──────────────────────────────────────────────────────

describe("combine_btc_psbts — INVALID_INPUT", () => {
  it("returns INVALID_INPUT when psbts array has < 2 elements (empty array)", async () => {
    const handler = getHandler();
    const result = await handler({ psbts: [] });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when psbts array has only 1 element", async () => {
    const handler = getHandler();
    const psbt = buildMultisigPsbt().toBase64();
    const result = await handler({ psbts: [psbt] });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when psbts is not an array", async () => {
    const handler = getHandler();
    const result = await handler({ psbts: "single-psbt" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when any element is an empty string", async () => {
    const handler = getHandler();
    const psbt = buildMultisigPsbt().toBase64();
    const result = await handler({ psbts: [psbt, ""] });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });
});

// ─── PSBT_COMBINE_CONFLICT tests ──────────────────────────────────────────────

describe("combine_btc_psbts — PSBT_COMBINE_CONFLICT", () => {
  it("returns PSBT_COMBINE_CONFLICT when spy returns conflict result", async () => {
    const handler = getHandler();

    const conflict = {
      inputIndex: 0,
      pubkeyHex: "0253b5fae1e2e2077ad494128408b44b5beb8abc",
      sigHex0: SIG_A.toString("hex"),
      sigHex1: SIG_B.toString("hex"),
    };

    vi.spyOn(_btcPsbt, "combineBtcPsbts").mockReturnValue({
      kind: "conflict",
      conflicts: [conflict],
    } as BtcCombineResult);

    const psbt = buildMultisigPsbt().toBase64();
    const result = await handler({ psbts: [psbt, psbt] });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("PSBT_COMBINE_CONFLICT");
  });

  it("PSBT_COMBINE_CONFLICT message contains conflicting inputIndex and pubkey", async () => {
    const handler = getHandler();

    const pubkeyHex = "0253b5fae1e2e2077ad494128408b44b5beb8abc";
    vi.spyOn(_btcPsbt, "combineBtcPsbts").mockReturnValue({
      kind: "conflict",
      conflicts: [
        {
          inputIndex: 2,
          pubkeyHex,
          sigHex0: SIG_A.toString("hex"),
          sigHex1: SIG_B.toString("hex"),
        },
      ],
    } as BtcCombineResult);

    const psbt = buildMultisigPsbt().toBase64();
    const result = await handler({ psbts: [psbt, psbt] });
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/input\[2\]/);
    expect(text).toMatch(new RegExp(pubkeyHex.slice(0, 10)));
  });

  it("real conflicting PSBTs (integration) return PSBT_COMBINE_CONFLICT", async () => {
    const handler = getHandler();

    const xpubs = [TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2];
    const pubkeys = xpubs.map((x) =>
      Buffer.from(bip32.fromBase58(x, networks.bitcoin).derive(0).derive(0).publicKey),
    );
    const sorted = [...pubkeys].sort(Buffer.compare);
    const pubkey0Hex = sorted[0]!.toString("hex");

    const sigMapA = new Map([[pubkey0Hex, SIG_A]]);
    const sigMapB = new Map([[pubkey0Hex, SIG_B]]);

    const psbtA = buildMultisigPsbt(sigMapA).toBase64();
    const psbtB = buildMultisigPsbt(sigMapB).toBase64();

    const result = await handler({ psbts: [psbtA, psbtB] });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("PSBT_COMBINE_CONFLICT");
    // Message must contain inputIndex and pubkey fragment
    const msg = sc["message"] as string;
    expect(msg).toMatch(/input\[0\]/);
    expect(msg).toMatch(new RegExp(pubkey0Hex.slice(0, 10)));
  });
});

// ─── INTERNAL_ERROR tests ─────────────────────────────────────────────────────

describe("combine_btc_psbts — INTERNAL_ERROR", () => {
  it("returns INTERNAL_ERROR when PSBTs are malformed base64", async () => {
    const handler = getHandler();
    const result = await handler({ psbts: ["not-a-psbt", "also-garbage"] });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INTERNAL_ERROR");
  });

  it("returns INTERNAL_ERROR when spy returns error result", async () => {
    const handler = getHandler();
    vi.spyOn(_btcPsbt, "combineBtcPsbts").mockReturnValue({
      kind: "error",
      message: "Psbt parsing blew up",
    } as BtcCombineResult);

    const psbt = buildMultisigPsbt().toBase64();
    const result = await handler({ psbts: [psbt, psbt] });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INTERNAL_ERROR");
  });
});

// ─── Success tests ────────────────────────────────────────────────────────────

describe("combine_btc_psbts — success", () => {
  it("returns combinedPsbt in structuredContent on conflict-free merge (spy)", async () => {
    const handler = getHandler();
    const fakeCombined = buildMultisigPsbt().toBase64();

    vi.spyOn(_btcPsbt, "combineBtcPsbts").mockReturnValue({
      kind: "ok",
      psbtBase64: fakeCombined,
    } as BtcCombineResult);

    const psbt = buildMultisigPsbt().toBase64();
    const result = await handler({ psbts: [psbt, psbt] });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["combinedPsbt"]).toBe(fakeCombined);
  });

  it("real conflict-free PSBTs (integration) return ok with combinedPsbt", async () => {
    const handler = getHandler();

    const xpubs = [TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2];
    const pubkeys = xpubs.map((x) =>
      Buffer.from(bip32.fromBase58(x, networks.bitcoin).derive(0).derive(0).publicKey),
    );
    const sorted = [...pubkeys].sort(Buffer.compare);
    const pubkey0Hex = sorted[0]!.toString("hex");
    const pubkey1Hex = sorted[1]!.toString("hex");

    const sigMapA = new Map([[pubkey0Hex, SIG_A]]);
    const sigMapB = new Map([[pubkey1Hex, SIG_B]]);

    const psbtA = buildMultisigPsbt(sigMapA).toBase64();
    const psbtB = buildMultisigPsbt(sigMapB).toBase64();

    const result = await handler({ psbts: [psbtA, psbtB] });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(typeof sc["combinedPsbt"]).toBe("string");
    expect((sc["combinedPsbt"] as string).length).toBeGreaterThan(0);
  });

  it("success response text contains the combined PSBT base64", async () => {
    const handler = getHandler();
    const fakeCombined = buildMultisigPsbt().toBase64();

    vi.spyOn(_btcPsbt, "combineBtcPsbts").mockReturnValue({
      kind: "ok",
      psbtBase64: fakeCombined,
    } as BtcCombineResult);

    const psbt = buildMultisigPsbt().toBase64();
    const result = await handler({ psbts: [psbt, psbt] });
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(fakeCombined);
  });

  it("structuredContent does NOT contain createHandle or payloadFingerprint fields", async () => {
    const handler = getHandler();
    const fakeCombined = buildMultisigPsbt().toBase64();

    vi.spyOn(_btcPsbt, "combineBtcPsbts").mockReturnValue({
      kind: "ok",
      psbtBase64: fakeCombined,
    } as BtcCombineResult);

    const psbt = buildMultisigPsbt().toBase64();
    const result = await handler({ psbts: [psbt, psbt] });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["handle"]).toBeUndefined();
    expect(sc["payloadFingerprint"]).toBeUndefined();
  });
});
