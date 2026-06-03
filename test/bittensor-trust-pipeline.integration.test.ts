// Phase 47 — Plan 47-04 — Bittensor trust-pipeline INTEGRATION test
// (TAO-PREP-03). Full prepare → preview → send exercised with mocks; NO live
// RPC socket, NO real Ledger device.
//
// ANTI-HANG (the load-bearing discipline — two prior executors hung ~25min on a
// blocked WsProvider socket): every external boundary is mocked at its
// indirection seam:
//   - _bittensorRegistry.getApi      → the shared mock ApiPromise (NEVER a real
//                                       ApiPromise/WsProvider — that opens a WS
//                                       socket on construction)
//   - _bittensorBuilder.resolveChainHashes → the fixture chain constants
//   - the Ledger _transport.*ViaApp seams → no node-hid device is ever opened;
//                                       signWithMetadataEd25519ViaApp returns a
//                                       SYNTHETIC pinned 64-byte signature (the
//                                       real device sig is a v2.7 verify-phase
//                                       capture — Manual-Only note).
//
// What this proves:
//   1. The full happy path for add_stake_limit: prepare (fp = Fixture TAO-B) →
//      preview (mints previewToken, recomputes blake2-256 presign) → send (the
//      three gates pass; the ed25519 assembly + author.submitExtrinsic fire).
//   2. The three FROZEN gates refuse identically (PREVIEW_REQUIRED / token
//      mismatch / stored-fingerprint drift) and NO device sign fires on refusal.
//   3. ed25519 ASSEMBLY: addSignature is called with "0x00"+<synthetic 64-byte
//      sig hex> and a well-formed signed-extrinsic hex reaches submitExtrinsic.
//   4. Persona-cycle re-anchor: the unsigned-payload fingerprint is BYTE-
//      IDENTICAL across two different paired persona senders (sender-independent
//      binding — the Substrate SignerPayload does NOT embed the signer; contrast
//      Solana whose feePayer IS in the bytes). CLAUDE.md "Integration tests
//      re-anchor byte-identity across persona swaps".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy } = vi.hoisted(() => ({ listAccountsSpy: vi.fn() }));

vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (...args: Parameters<typeof actual.listAccounts>) =>
      listAccountsSpy(...args),
  };
});

import { _bittensorRegistry } from "../src/chains/bittensor/registry.js";
import { _bittensorBuilder } from "../src/chains/bittensor/extrinsic-builder.js";
import * as env from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { getRegisteredTool } from "../src/tools/index.js";
import { _transport } from "../src/wallet/ledger-bittensor-transport.js";
import {
  FIXTURE_CHAIN_HASHES,
  makeMockBittensorApi,
  type MockSendConfig,
} from "./_helpers/mock-bittensor-api.js";

import "../src/tools/prepare_bittensor_add_stake_limit.js";
import "../src/tools/preview_send.js";
import "../src/tools/send_transaction.js";

// Canonical fixtures (cross-linked to test/signing-fingerprint-bittensor.test.ts).
const FIXTURE_TAO_B_FP =
  "0x7fc3403d36166a068cd922dc4e2f72519563f31df3856a264900e3d8c00d21ff";

const HOTKEY_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";
// Two distinct paired-persona senders for the persona-cycle re-anchor.
const PERSONA_A_SS58 = "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9";
const PERSONA_B_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";
const DERIVATION_PATH = "44'/354'/0'/0'/0'";

// A SYNTHETIC, pinned 64-byte ed25519 signature vector (NOT a real device sig —
// the real capture is a v2.7 verify-phase item). 0x01,0x02,…,0x40.
const SYNTHETIC_SIG = Buffer.from(
  Array.from({ length: 64 }, (_v, i) => i + 1),
);
const SYNTHETIC_SIG_HEX = SYNTHETIC_SIG.toString("hex"); // 64-byte hex, no 0x

function prepareTool() {
  const t = getRegisteredTool("prepare_bittensor_add_stake_limit");
  if (!t) throw new Error("prepare tool not registered");
  return t;
}
function previewTool() {
  const t = getRegisteredTool("preview_send");
  if (!t) throw new Error("preview_send not registered");
  return t;
}
function sendTool() {
  const t = getRegisteredTool("send_transaction");
  if (!t) throw new Error("send_transaction not registered");
  return t;
}

/** Spy every Ledger transport seam so NO node-hid device is ever opened. */
function stubLedgerTransport(): {
  signSpy: ReturnType<typeof vi.fn>;
} {
  vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
  vi.spyOn(_transport, "list").mockResolvedValue([{}]);
  vi.spyOn(_transport, "open").mockResolvedValue({
    close: async () => undefined,
  } as never);
  vi.spyOn(_transport, "buildGenericApp").mockReturnValue({} as never);
  vi.spyOn(_transport, "getVersionViaApp").mockResolvedValue({} as never);
  const signSpy = vi.fn(async () => ({ signature: SYNTHETIC_SIG }));
  vi.spyOn(_transport, "signWithMetadataEd25519ViaApp").mockImplementation(
    signSpy as never,
  );
  return { signSpy };
}

/** Spy the registry + builder so the blob is byte-identical to Fixture TAO-B. */
function stubChain(send?: MockSendConfig) {
  vi.spyOn(_bittensorBuilder, "resolveChainHashes").mockResolvedValue(
    FIXTURE_CHAIN_HASHES,
  );
  vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
    makeMockBittensorApi({
      nonce: 0,
      // currentAlphaPrice 0.5 TAO/alpha, tolerancePct 0 → limitPrice 500_000_000
      // (the Fixture TAO-B limitPrice). amountStaked 2 TAO → Fixture TAO-B blob.
      swap: { currentAlphaPriceRaw: 500_000_000n, simAlphaOut: 101_647_804_216n },
      send,
    }) as never,
  );
}

async function doPrepare(sender: string) {
  // Pair `sender`; live (non-demo) path so the send arm actually signs+broadcasts.
  listAccountsSpy.mockReturnValue([
    { address: sender, chain: "bittensor", derivationPath: DERIVATION_PATH },
  ]);
  const res = await prepareTool().handler({
    hotkey: HOTKEY_SS58,
    netuid: 1,
    rao: "2",
    tolerancePct: 0,
  });
  return res;
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  _resetActivePersonaForTesting();
  listAccountsSpy.mockReset();
  // Non-demo throughout — exercise the real prepare→preview→send arm.
  vi.spyOn(env, "isDemoMode").mockReturnValue(false);
});

afterEach(() => {
  _resetActivePersonaForTesting();
  vi.restoreAllMocks();
});

describe("Bittensor trust pipeline — full prepare→preview→send (TAO-PREP-03)", () => {
  it("happy path: 3 gates pass, ed25519 assembly fires, broadcast OK", async () => {
    const onAddSignature = vi.fn();
    const onSubmitExtrinsic = vi.fn();
    stubChain({
      onAddSignature,
      onSubmitExtrinsic,
      extrinsicHash: "0x" + "ab".repeat(32),
    });
    const { signSpy } = stubLedgerTransport();

    // ---- PREPARE: fingerprint = Fixture TAO-B -----------------------------
    const prep = await doPrepare(PERSONA_A_SS58);
    expect(prep.isError).toBeUndefined();
    const handle = (prep.structuredContent as { handle: string }).handle;
    expect((prep.structuredContent as { payloadFingerprint: string }).payloadFingerprint).toBe(
      FIXTURE_TAO_B_FP,
    );

    // ---- PREVIEW: mints previewToken + recomputes blake2-256 presign ------
    const prev = await previewTool().handler({ handle });
    expect(prev.isError).toBeUndefined();
    const previewToken = (prev.structuredContent as { previewToken: string })
      .previewToken;
    expect(previewToken).toMatch(/[0-9a-f-]{36}/);
    // No device sign during preview.
    expect(signSpy).not.toHaveBeenCalled();

    // ---- SEND: the three gates pass; ed25519 assembly + broadcast ---------
    const sent = await sendTool().handler({
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(sent.isError).toBeUndefined();

    // The device signed the STORED signableBlob VERBATIM (T-47-11).
    const record = _peekHandleForTesting(handle);
    const storedBlob =
      record?.tx.txType === "bittensor" ? record.tx.signableBlob : undefined;
    expect(signSpy).toHaveBeenCalledTimes(1);
    const signArgs = signSpy.mock.calls[0] as unknown[];
    // signWithMetadataEd25519ViaApp(app, path, txBlob, txMetadata)
    expect(signArgs[1]).toBe(DERIVATION_PATH);
    expect(signArgs[2]).toBe(storedBlob); // VERBATIM — same reference

    // ed25519 ASSEMBLY: addSignature called with "0x00" + the synthetic sig hex.
    expect(onAddSignature).toHaveBeenCalledTimes(1);
    const [signer, sigHex] = onAddSignature.mock.calls[0] as [string, string, unknown];
    expect(signer).toBe(PERSONA_A_SS58);
    expect(sigHex).toBe("0x00" + SYNTHETIC_SIG_HEX); // '0x00' = MultiSignature::Ed25519
    expect(sigHex.length).toBe(2 + 2 + 128); // 0x + type-byte + 64-byte sig

    // A well-formed signed-extrinsic hex reached submitExtrinsic, carrying the sig.
    expect(onSubmitExtrinsic).toHaveBeenCalledTimes(1);
    const submittedHex = (onSubmitExtrinsic.mock.calls[0] as [string])[0];
    expect(submittedHex).toMatch(/^0x[0-9a-f]+$/);
    expect(submittedHex).toContain(SYNTHETIC_SIG_HEX);

    // Success envelope carries the extrinsic hash under txHash + extrinsicHash.
    const sc = sent.structuredContent as {
      txHash: string;
      extrinsicHash: string;
      txType: string;
    };
    expect(sc.txType).toBe("bittensor");
    expect(sc.txHash).toBe("0x" + "ab".repeat(32));
    expect(sc.extrinsicHash).toBe("0x" + "ab".repeat(32));

    // Handle transitioned to terminal sent.
    expect(_peekHandleForTesting(handle)?.status).toBe("sent");
  });

  it("gate: missing previewToken (prepared, never previewed) → PREVIEW_REQUIRED; NO device sign", async () => {
    stubChain();
    const { signSpy } = stubLedgerTransport();
    const prep = await doPrepare(PERSONA_A_SS58);
    const handle = (prep.structuredContent as { handle: string }).handle;

    // Skip preview → send refuses with PREVIEW_REQUIRED.
    const sent = await sendTool().handler({
      handle,
      previewToken: "anything",
      userDecision: "send",
    });
    expect(sent.isError).toBe(true);
    expect((sent.structuredContent as { errorCode: string }).errorCode).toBe(
      "PREVIEW_REQUIRED",
    );
    expect(signSpy).not.toHaveBeenCalled();
  });

  it("gate: wrong previewToken → PREVIEW_TOKEN_MISMATCH; NO device sign", async () => {
    stubChain();
    const { signSpy } = stubLedgerTransport();
    const prep = await doPrepare(PERSONA_A_SS58);
    const handle = (prep.structuredContent as { handle: string }).handle;
    await previewTool().handler({ handle });

    const sent = await sendTool().handler({
      handle,
      previewToken: "00000000-0000-0000-0000-000000000000",
      userDecision: "send",
    });
    expect(sent.isError).toBe(true);
    expect((sent.structuredContent as { errorCode: string }).errorCode).toBe(
      "PREVIEW_TOKEN_MISMATCH",
    );
    expect(signSpy).not.toHaveBeenCalled();
  });

  it("gate: STORED payloadFingerprint mutated → PAYLOAD_FINGERPRINT_DRIFT; NO device sign", async () => {
    stubChain();
    const { signSpy } = stubLedgerTransport();
    const prep = await doPrepare(PERSONA_A_SS58);
    const handle = (prep.structuredContent as { handle: string }).handle;
    const prev = await previewTool().handler({ handle });
    const previewToken = (prev.structuredContent as { previewToken: string })
      .previewToken;

    // Mirror the EVM Test-4 attack model: mutate the STORED fingerprint (not the
    // compute). The send-time recompute over the STORED signableBlob no longer
    // matches → drift refusal BEFORE any device call.
    const record = _peekHandleForTesting(handle);
    if (!record) throw new Error("handle missing");
    (record as { payloadFingerprint: string }).payloadFingerprint =
      "0x" + "00".repeat(32);

    const sent = await sendTool().handler({
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(sent.isError).toBe(true);
    expect((sent.structuredContent as { errorCode: string }).errorCode).toBe(
      "PAYLOAD_FINGERPRINT_DRIFT",
    );
    expect(signSpy).not.toHaveBeenCalled();
  });

  it("cancel: userDecision:cancel → clean terminal cancel; NO device sign, NO broadcast", async () => {
    const onSubmitExtrinsic = vi.fn();
    stubChain({ onSubmitExtrinsic });
    const { signSpy } = stubLedgerTransport();
    const prep = await doPrepare(PERSONA_A_SS58);
    const handle = (prep.structuredContent as { handle: string }).handle;
    const prev = await previewTool().handler({ handle });
    const previewToken = (prev.structuredContent as { previewToken: string })
      .previewToken;

    const sent = await sendTool().handler({
      handle,
      previewToken,
      userDecision: "cancel",
    });
    expect(sent.isError).toBeUndefined();
    expect((sent.structuredContent as { userCancelled?: boolean }).userCancelled).toBe(
      true,
    );
    expect(signSpy).not.toHaveBeenCalled();
    expect(onSubmitExtrinsic).not.toHaveBeenCalled();
    expect(_peekHandleForTesting(handle)?.status).toBe("cancelled");
  });
});

describe("Bittensor persona-cycle re-anchor — sender-INDEPENDENT binding (TAO-W-05)", () => {
  it("the unsigned-payload fingerprint is BYTE-IDENTICAL across two persona senders", async () => {
    // Persona A.
    stubChain();
    stubLedgerTransport();
    const prepA = await doPrepare(PERSONA_A_SS58);
    const fpA = (prepA.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;

    // Persona B — a DIFFERENT paired sender, SAME add_stake_limit args.
    vi.restoreAllMocks();
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    _resetHandleStoreForTesting();
    stubChain();
    stubLedgerTransport();
    const prepB = await doPrepare(PERSONA_B_SS58);
    const fpB = (prepB.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;

    // The Substrate SignerPayload does NOT embed the signer (it's supplied to
    // addSignature at send), so the fingerprint over the unsigned blob is
    // byte-identical across the swap — and equals Fixture TAO-B.
    expect(fpA).toBe(fpB);
    expect(fpA).toBe(FIXTURE_TAO_B_FP);
    expect(PERSONA_A_SS58).not.toBe(PERSONA_B_SS58);
  });
});
