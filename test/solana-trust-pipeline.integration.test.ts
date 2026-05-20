// LOAD-BEARING / STOP-THE-LINE — release blocker if this test fails.
//
// Plan 12-05 — Solana trust-pipeline integration test. Mirror of
// `test/trust-pipeline.integration.test.ts:1-30` discipline:
//
// Asserts the v2.0 Solana trust pipeline binds every byte from agent through
// server through transport to the Ledger device. Failure here means a layer
// has gone byte-misaligned and the device's "Message Hash" no longer matches
// what the server claims to have hashed. Re-run with verbose output and diff
// messageBytes / payloadFingerprint / presignHash at each layer.
//
// Cross-anchors:
//   - test/signing-fingerprint-solana.test.ts (Fixtures K + L)
//   - test/signing-presign-hash-solana.test.ts (Fixtures K + L SHA-256 hashes)
//   - src/signing/payload-fingerprint-solana.ts (keccak DOMAIN_TAG)
//   - src/signing/presign-hash-solana.ts (SHA-256 of messageBytes)
//
// Test cases (15 total):
//   1.  Native SOL prepare → preview → send happy path (Fixture K)
//   2.  SPL TransferChecked prepare → preview → send happy path (Fixture L)
//   3.  preview-time presignHash == device-displayed SHA-256 (native SOL)
//   4.  persona-cycle determinism: same persona twice → same fingerprint (native)
//   5.  persona-cycle distinctness: different personas → different fingerprints (native)
//   6.  persona-cycle determinism (SPL)
//   7.  persona-cycle distinctness (SPL) — Phase 7 T-INTEGRATION-FROM-DRIFT-2 mirror
//   8.  calldata-embedding: amount change → fingerprint change (SPL)
//   9.  drift refusal at send time (native SOL — messageBytes mutation)
//   10. drift refusal at send time (SPL — messageBytes mutation)
//   11. three-gate cascade: PREVIEW_REQUIRED + WRONG_STATUS + PREVIEW_TOKEN_MISMATCH
//   12. cancel branch (no signing, no broadcasting)
//   13. BOTH txHash AND txSignature returned at send-time (orchestrator API symmetry)
//   14. demo-mode no-broadcast invariant (sign + sendRawTransaction = 0 calls)
//   15. Fixture K + L hardcoded literal cross-anchor (transitive byte-identity)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createHash } from "node:crypto";

const {
  listAccountsSpy,
  sendRawTransactionSpy,
  getLatestBlockhashSpy,
  getAccountInfoSpy,
} = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  sendRawTransactionSpy: vi.fn(),
  getLatestBlockhashSpy: vi.fn(),
  getAccountInfoSpy: vi.fn(),
}));

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

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import { _resetDemoModeForTesting, isDemoMode } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveSolanaPersonaBySlug,
} from "../src/demo/state.js";
import { computeSolanaPayloadFingerprint } from "../src/signing/payload-fingerprint-solana.js";
import { computeSolanaPresignHash } from "../src/signing/presign-hash-solana.js";
import { _simulationSolana } from "../src/signing/simulation-solana.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  lookup,
} from "../src/signing/handle-store.js";
import { _transport } from "../src/wallet/ledger-solana-transport.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`${name} not registered`);
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// ---- Personas (cross-link to demo/state.ts Solana registry) -----------
// solana-whale persona address (matches the fixture in
// `test/signing-fingerprint-solana.test.ts`).
const PERSONA_A_ADDR = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
// Distinct second persona — Phantom/Solflare canonical zero-rent recipient.
const PERSONA_B_ADDR = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";

const PERSONA_A_PUBKEY = new PublicKey(PERSONA_A_ADDR);
const PERSONA_B_PUBKEY = new PublicKey(PERSONA_B_ADDR);
const RECIPIENT_PUBKEY = new PublicKey(
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
);
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// Pinned blockhash for deterministic fingerprint reproduction. NOTE: real
// prepare resolves blockhash via `getLatestBlockhash`; we control that mock.
const FIXED_BLOCKHASH = "11111111111111111111111111111111";

// Cross-link from `test/signing-fingerprint-solana.test.ts:95`. Fixture K
// inputs: PERSONA_A as feePayer + RECIPIENT + 1 SOL + FIXED_BLOCKHASH.
const FIXTURE_K_FINGERPRINT =
  "0x7c3d1fbcea9a6823b6e1bbb76b45ec68cd4998f25727d3bfb7b17a389040d0d3";

const FIXTURE_BROADCAST_SIG_BASE58 =
  "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM1G6XsmJSdtFqdc7nuT9CrSjffmCABXmbDgnSGwQAyHkF8";
const SIGNATURE_64 = Buffer.alloc(64, 0xaa);

function pairedSolanaAccount(addr: string) {
  return {
    chain: "solana" as const,
    address: addr,
    derivationPath: "44'/501'/0'",
    pairedAt: new Date().toISOString(),
  };
}

function buildStubConnection(): Connection {
  return {
    sendRawTransaction: sendRawTransactionSpy,
    getLatestBlockhash: getLatestBlockhashSpy,
    getAccountInfo: getAccountInfoSpy,
  } as unknown as Connection;
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  listAccountsSpy.mockReset();
  sendRawTransactionSpy.mockReset();
  getLatestBlockhashSpy.mockReset();
  getAccountInfoSpy.mockReset();
  // Default — persona A is the paired Solana account.
  listAccountsSpy.mockReturnValue([pairedSolanaAccount(PERSONA_A_ADDR)]);
  sendRawTransactionSpy.mockResolvedValue(FIXTURE_BROADCAST_SIG_BASE58);
  getLatestBlockhashSpy.mockResolvedValue({
    blockhash: FIXED_BLOCKHASH,
    lastValidBlockHeight: 100_000_000,
  });
  // Default — destination ATA EXISTS (so prepare_solana_spl_send skips the
  // create-ATA instruction). Tests that need a missing ATA override.
  getAccountInfoSpy.mockResolvedValue({
    lamports: 2_039_280, // rent-exempt
    owner: TOKEN_PROGRAM_ID,
    data: Buffer.alloc(165), // token-account size
    executable: false,
    rentEpoch: 0,
  });
  vi.spyOn(_transport, "signTransactionViaApp").mockResolvedValue({
    signature: SIGNATURE_64,
  });
  vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
  vi.spyOn(_transport, "list").mockResolvedValue([{ path: "/dev/hid0" }]);
  vi.spyOn(_transport, "open").mockResolvedValue({
    close: vi.fn(async () => undefined),
    disconnected: false,
  } as unknown);
  vi.spyOn(_transport, "buildSolanaApp").mockReturnValue({
    getAppConfiguration: vi.fn(async () => ({ version: "1.4.0" })),
  });
  vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(buildStubConnection());
  vi.spyOn(_simulationSolana, "runSolanaPreviewSimulation").mockResolvedValue({
    status: "ok",
    err: null,
    logs: [
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program 11111111111111111111111111111111 success",
    ],
    unitsConsumed: 150,
  });
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  vi.restoreAllMocks();
});

// Helper — switch the paired Solana account to a different persona.
function switchPairedTo(addr: string): void {
  listAccountsSpy.mockReturnValue([pairedSolanaAccount(addr)]);
}

// ---------------------------------------------------------------------------
// Test 1 — Native SOL prepare → preview → send (Fixture K cross-anchor).
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — native SOL prepare → preview → send happy path (T-PIPELINE-SOL-1)", () => {
  it("walks the full pipeline; cryptographic-binding invariant holds end-to-end (native SOL)", async () => {
    // --- ACT 1: prepare ---
    const prepareResult = await callTool("prepare_solana_native_send", {
      to: RECIPIENT_PUBKEY.toBase58(),
      lamports: "1000000000",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
      txType: string;
    };
    const handle = prepareSc.handle;
    expect(prepareSc.txType).toBe("solana");

    // --- ASSERT 1: stored fingerprint matches the recompute over the
    // stored messageBytes (proves prepare → store byte-identity).
    const preparedLookup = lookup(handle);
    if (!preparedLookup.ok) throw new Error("post-prepare: handle not found");
    const tx = preparedLookup.record.tx as { messageBytes: Uint8Array; txType: string };
    expect(tx.txType).toBe("solana");
    const recomputedFp = computeSolanaPayloadFingerprint({
      messageBytes: tx.messageBytes,
    });
    expect(preparedLookup.record.payloadFingerprint).toBe(recomputedFp);

    // --- ACT 2: preview ---
    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBeFalsy();
    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      presignHash: string;
      payloadFingerprint: string;
    };
    const previewToken = previewSc.previewToken;

    // --- ASSERT 2: preview-time presignHash matches SHA-256(messageBytes);
    // payloadFingerprint UNCHANGED from prepare.
    const presignFromBytes = computeSolanaPresignHash({
      messageBytes: tx.messageBytes,
    }).presignHash;
    expect(previewSc.presignHash).toBe(presignFromBytes);
    expect(previewSc.payloadFingerprint).toBe(preparedLookup.record.payloadFingerprint);

    // --- ACT 3: send ---
    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });

    // --- ASSERT 3: send returned BOTH txHash + txSignature; same base58 value.
    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as {
      txHash: string;
      txSignature: string;
      broadcastedAt: string;
      handle: string;
      txType: string;
    };
    expect(sendSc.txHash).toBe(FIXTURE_BROADCAST_SIG_BASE58);
    expect(sendSc.txSignature).toBe(FIXTURE_BROADCAST_SIG_BASE58);
    expect(sendSc.txHash).toBe(sendSc.txSignature);
    expect(sendSc.txType).toBe("solana");

    // --- ASSERT 4: signTransactionViaApp received messageBytes byte-identical
    // to record.tx.messageBytes (preview → send byte-identity proves no
    // re-derivation drift).
    const signSpy = vi.mocked(_transport.signTransactionViaApp);
    expect(signSpy).toHaveBeenCalledTimes(1);
    const [, , passedBuffer] = signSpy.mock.calls[0]!;
    expect(passedBuffer.equals(Buffer.from(tx.messageBytes))).toBe(true);

    // Final state: handle transitioned to `sent` with the broadcast signature.
    const sentLookup = lookup(handle);
    if (!sentLookup.ok) throw new Error("post-send: handle not found");
    expect(sentLookup.record.status).toBe("sent");
    expect(sentLookup.record.txHash).toBe(FIXTURE_BROADCAST_SIG_BASE58);

    // **Cryptographic-binding invariant**: every byte the device "signed"
    // (passedBuffer) matches the byte the MCP prepared (tx.messageBytes);
    // the fingerprint stayed stable across prepare → preview → send.
    expect(sentLookup.record.payloadFingerprint).toBe(
      preparedLookup.record.payloadFingerprint,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2 — SPL TransferChecked prepare → preview → send.
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — SPL TransferChecked prepare → preview → send happy path", () => {
  it("SPL prepare → preview → send walks the full pipeline; SPL signature attached + broadcast", async () => {
    // SPL preview requires the simulation to return `ok`. ATA derivation
    // happens server-side from RECIPIENT_PUBKEY.
    const prepareResult = await callTool("prepare_solana_spl_send", {
      to: RECIPIENT_PUBKEY.toBase58(),
      mint: USDC_MINT.toBase58(),
      amount: "100",
    });
    if (prepareResult.isError) {
      // The SPL prepare path may RPC-poke for mint decimals; if the call
      // path was reorganized, surface diagnostic context so the test
      // failure names the layer.
      const sc = prepareResult.structuredContent as { errorCode: string };
      throw new Error(
        `SPL prepare failed unexpectedly: ${sc.errorCode}; ${
          (prepareResult.content[0]?.text ?? "").slice(0, 200)
        }`,
      );
    }
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      txType: string;
    };
    const handle = prepareSc.handle;
    expect(prepareSc.txType).toBe("solana");

    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBeFalsy();
    const previewToken = (previewResult.structuredContent as {
      previewToken: string;
    }).previewToken;

    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as {
      txHash: string;
      txSignature: string;
      txType: string;
    };
    expect(sendSc.txType).toBe("solana");
    expect(sendSc.txHash).toBe(sendSc.txSignature);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — preview-time presignHash == device-displayed SHA-256.
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — preview-time presignHash == device-side SHA-256 (DF-2 trust anchor)", () => {
  it("the presignHash emitted at preview time matches SHA-256(messageBytes) computed independently — the byte the device displays", async () => {
    const prepareResult = await callTool("prepare_solana_native_send", {
      to: RECIPIENT_PUBKEY.toBase58(),
      lamports: "1000000000",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;
    const previewResult = await callTool("preview_send", { handle });
    const previewSc = previewResult.structuredContent as { presignHash: string };

    // Independent SHA-256 — same node `crypto` module the helper uses.
    const peeked = _peekHandleForTesting(handle);
    if (!peeked) throw new Error("post-preview: handle not found");
    const messageBytes = (peeked.tx as { messageBytes: Uint8Array }).messageBytes;
    const independentSha256 =
      "0x" + createHash("sha256").update(messageBytes).digest("hex");
    // LOAD-BEARING — server-emitted hash must equal the device-displayed
    // hash byte-for-byte. Drift here breaks the on-device verification
    // ritual (user reads device, compares against block, no match → tamper).
    expect(previewSc.presignHash).toBe(independentSha256);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — persona-cycle determinism (native SOL).
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — persona-cycle determinism (native SOL — same persona twice → same fingerprint)", () => {
  it("two prepares with same persona + same inputs → identical fingerprints (per-persona deterministic)", async () => {
    const args = {
      to: RECIPIENT_PUBKEY.toBase58(),
      lamports: "1000000000",
    };
    const result1 = await callTool("prepare_solana_native_send", args);
    const fp1 = (result1.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;

    const result2 = await callTool("prepare_solana_native_send", args);
    const fp2 = (result2.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;

    expect(fp1).toBe(fp2);
    // Determinism only — Fixture K's locked literal is asserted in the
    // dedicated cross-anchor test (Test 15) which uses PERSONA_B_ADDR as
    // the recipient (Fixture K's canonical inputs).
  });
});

// ---------------------------------------------------------------------------
// Test 5 — persona-cycle distinctness (native SOL).
//
// **Sender-DEPENDENT property** — orchestrator override of CONTEXT.md's
// "sender-independent" framing. Confirmed by RESEARCH Topic 3 + the legacy
// `Transaction.serializeMessage()` shape including feePayer at
// account_keys[0]. Two distinct personas → distinct fingerprints.
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — persona-cycle distinctness (native SOL — feePayer-in-preimage sender-DEPENDENCE)", () => {
  it("two prepares with DIFFERENT personas + same recipient/amount/blockhash → DIFFERENT fingerprints (cross-persona distinct)", async () => {
    const args = {
      to: RECIPIENT_PUBKEY.toBase58(),
      lamports: "1000000000",
    };
    // Persona A first.
    switchPairedTo(PERSONA_A_ADDR);
    const resultA = await callTool("prepare_solana_native_send", args);
    const fpA = (resultA.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;

    // Switch paired account to persona B and re-prepare.
    switchPairedTo(PERSONA_B_ADDR);
    const resultB = await callTool("prepare_solana_native_send", args);
    const fpB = (resultB.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;

    // **Cross-persona distinct** — feePayer is account_keys[0] of the
    // serialized message bytes, so the bytes (and thus the keccak preimage)
    // differ. Native SOL is sender-DEPENDENT per RESEARCH Topic 3.
    expect(fpA).not.toBe(fpB);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — persona-cycle determinism (SPL).
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — persona-cycle determinism (SPL — same persona twice → same fingerprint)", () => {
  it("two SPL prepares with same persona + same recipient + same amount + same mint → identical fingerprints", async () => {
    const args = {
      to: RECIPIENT_PUBKEY.toBase58(),
      mint: USDC_MINT.toBase58(),
      amount: "100",
    };
    const result1 = await callTool("prepare_solana_spl_send", args);
    if (result1.isError) {
      throw new Error(
        `prepare1 failed: ${(result1.content[0]?.text ?? "").slice(0, 200)}`,
      );
    }
    const fp1 = (result1.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;

    const result2 = await callTool("prepare_solana_spl_send", args);
    if (result2.isError) {
      throw new Error(
        `prepare2 failed: ${(result2.content[0]?.text ?? "").slice(0, 200)}`,
      );
    }
    const fp2 = (result2.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;

    expect(fp1).toBe(fp2);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — persona-cycle distinctness (SPL — Phase 7 T-INTEGRATION-FROM-DRIFT-2 mirror).
//
// **Sender-DEPENDENT for two reasons**:
//   (a) feePayer in account_keys (same as native);
//   (b) source ATA derives from sender via `getAssociatedTokenAddress(mint, sender)`.
// The test does NOT disentangle the two causes — the property is the
// cross-persona-distinct shape per CONTEXT.md line 26 / Phase 7 precedent.
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — persona-cycle distinctness (SPL — Phase 7 T-INTEGRATION-FROM-DRIFT-2 mirror)", () => {
  it("two SPL prepares with DIFFERENT personas + same recipient/amount/mint → DIFFERENT fingerprints", async () => {
    const args = {
      to: RECIPIENT_PUBKEY.toBase58(),
      mint: USDC_MINT.toBase58(),
      amount: "100",
    };
    switchPairedTo(PERSONA_A_ADDR);
    const resultA = await callTool("prepare_solana_spl_send", args);
    if (resultA.isError) {
      throw new Error(
        `personaA prepare failed: ${(resultA.content[0]?.text ?? "").slice(0, 200)}`,
      );
    }
    const fpA = (resultA.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;

    switchPairedTo(PERSONA_B_ADDR);
    const resultB = await callTool("prepare_solana_spl_send", args);
    if (resultB.isError) {
      throw new Error(
        `personaB prepare failed: ${(resultB.content[0]?.text ?? "").slice(0, 200)}`,
      );
    }
    const fpB = (resultB.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;

    expect(fpA).not.toBe(fpB);
  });
});

// ---------------------------------------------------------------------------
// Test 8 — calldata-embedding (SPL amount change → fingerprint change).
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — calldata-embedding (SPL amount change → fingerprint change)", () => {
  it("two SPL prepares with same persona/recipient/mint but DIFFERENT amounts → different fingerprints (regression against accidentally-static preimage)", async () => {
    const result100 = await callTool("prepare_solana_spl_send", {
      to: RECIPIENT_PUBKEY.toBase58(),
      mint: USDC_MINT.toBase58(),
      amount: "100",
    });
    if (result100.isError) {
      throw new Error(
        `prepare100 failed: ${(result100.content[0]?.text ?? "").slice(0, 200)}`,
      );
    }
    const result101 = await callTool("prepare_solana_spl_send", {
      to: RECIPIENT_PUBKEY.toBase58(),
      mint: USDC_MINT.toBase58(),
      amount: "101", // off by 1 token
    });
    if (result101.isError) {
      throw new Error(
        `prepare101 failed: ${(result101.content[0]?.text ?? "").slice(0, 200)}`,
      );
    }
    const fp100 = (result100.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;
    const fp101 = (result101.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;
    expect(fp100).not.toBe(fp101);
  });
});

// ---------------------------------------------------------------------------
// Test 9 — drift refusal at send (native SOL — messageBytes mutation).
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — PAYLOAD_FINGERPRINT_DRIFT refusal on messageBytes mutation (native SOL)", () => {
  it("mutating record.tx.messageBytes post-preview → send refuses with PAYLOAD_FINGERPRINT_DRIFT; sign + broadcast NEVER called", async () => {
    const prepareResult = await callTool("prepare_solana_native_send", {
      to: RECIPIENT_PUBKEY.toBase58(),
      lamports: "1000000000",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;
    const previewResult = await callTool("preview_send", { handle });
    const previewToken = (previewResult.structuredContent as {
      previewToken: string;
    }).previewToken;

    // Mutate messageBytes (the recompute input). The stored fingerprint
    // stays the same; the recompute yields a different value → refusal.
    const peeked = _peekHandleForTesting(handle);
    if (!peeked) throw new Error("post-preview: handle not found");
    const tx = peeked.tx as { messageBytes: Uint8Array };
    tx.messageBytes = new Uint8Array([
      ...tx.messageBytes.slice(0, tx.messageBytes.length - 1),
      tx.messageBytes[tx.messageBytes.length - 1]! ^ 0x01,
    ]);

    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBe(true);
    const sc = sendResult.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PAYLOAD_FINGERPRINT_DRIFT");
    expect(vi.mocked(_transport.signTransactionViaApp)).not.toHaveBeenCalled();
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 10 — drift refusal at send (SPL — messageBytes mutation).
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — PAYLOAD_FINGERPRINT_DRIFT refusal on messageBytes mutation (SPL)", () => {
  it("mutating record.tx.messageBytes on an SPL handle → send refuses with PAYLOAD_FINGERPRINT_DRIFT", async () => {
    const prepareResult = await callTool("prepare_solana_spl_send", {
      to: RECIPIENT_PUBKEY.toBase58(),
      mint: USDC_MINT.toBase58(),
      amount: "100",
    });
    if (prepareResult.isError) {
      throw new Error("SPL prepare failed in drift test setup");
    }
    const handle = (prepareResult.structuredContent as { handle: string }).handle;
    const previewResult = await callTool("preview_send", { handle });
    const previewToken = (previewResult.structuredContent as {
      previewToken: string;
    }).previewToken;

    const peeked = _peekHandleForTesting(handle);
    if (!peeked) throw new Error("post-preview SPL: handle not found");
    const tx = peeked.tx as { messageBytes: Uint8Array };
    tx.messageBytes = new Uint8Array([
      ...tx.messageBytes.slice(0, tx.messageBytes.length - 1),
      tx.messageBytes[tx.messageBytes.length - 1]! ^ 0x02,
    ]);

    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBe(true);
    const sc = sendResult.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PAYLOAD_FINGERPRINT_DRIFT");
  });
});

// ---------------------------------------------------------------------------
// Test 11 — three-gate cascade (Solana).
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — three-gate cascade (PREVIEW_REQUIRED + WRONG_STATUS + PREVIEW_TOKEN_MISMATCH)", () => {
  it("each FROZEN gate fires identically for Solana handles", async () => {
    const prepareResult = await callTool("prepare_solana_native_send", {
      to: RECIPIENT_PUBKEY.toBase58(),
      lamports: "1000000000",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;

    // Gate 1 — PREVIEW_REQUIRED (handle in `prepared` status).
    const noPreview = await callTool("send_transaction", {
      handle,
      previewToken: "any-token",
      userDecision: "send",
    });
    expect(noPreview.isError).toBe(true);
    expect((noPreview.structuredContent as { errorCode: string }).errorCode).toBe(
      "PREVIEW_REQUIRED",
    );

    // Drive handle to `previewed`.
    const previewResult = await callTool("preview_send", { handle });
    const previewToken = (previewResult.structuredContent as {
      previewToken: string;
    }).previewToken;

    // Gate 2 — PREVIEW_TOKEN_MISMATCH (wrong token).
    const wrongToken = await callTool("send_transaction", {
      handle,
      previewToken: "wrong-token",
      userDecision: "send",
    });
    expect(wrongToken.isError).toBe(true);
    expect(
      (wrongToken.structuredContent as { errorCode: string }).errorCode,
    ).toBe("PREVIEW_TOKEN_MISMATCH");

    // Drive to `sent` and then re-send.
    const firstSend = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(firstSend.isError).toBeFalsy();

    // Gate 3 — WRONG_STATUS (handle now in `sent`).
    const secondSend = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(secondSend.isError).toBe(true);
    expect(
      (secondSend.structuredContent as { errorCode: string }).errorCode,
    ).toBe("WRONG_STATUS");
  });
});

// ---------------------------------------------------------------------------
// Test 12 — cancel branch (no sign, no broadcast).
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — cancel branch (T-CANCEL-1 mirror; no sign + no broadcast)", () => {
  it("prepare → preview → send with userDecision: \"cancel\" → CANCELLED, no signTransactionViaApp, no sendRawTransaction", async () => {
    const prepareResult = await callTool("prepare_solana_native_send", {
      to: RECIPIENT_PUBKEY.toBase58(),
      lamports: "1000000000",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;
    const previewResult = await callTool("preview_send", { handle });
    const previewToken = (previewResult.structuredContent as {
      previewToken: string;
    }).previewToken;

    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "cancel",
    });
    expect(sendResult.isError).toBeFalsy();
    const sc = sendResult.structuredContent as { userCancelled: boolean };
    expect(sc.userCancelled).toBe(true);

    expect(vi.mocked(_transport.signTransactionViaApp)).not.toHaveBeenCalled();
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();

    const cancelledLookup = lookup(handle);
    if (!cancelledLookup.ok) throw new Error("post-cancel: handle not found");
    expect(cancelledLookup.record.status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Test 13 — BOTH txHash AND txSignature returned at send.
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — BOTH txHash + txSignature returned at send", () => {
  it("structuredContent.txHash === structuredContent.txSignature (orchestrator API-symmetry override + RESEARCH Topic 7)", async () => {
    const prepareResult = await callTool("prepare_solana_native_send", {
      to: RECIPIENT_PUBKEY.toBase58(),
      lamports: "1000000000",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;
    const previewResult = await callTool("preview_send", { handle });
    const previewToken = (previewResult.structuredContent as {
      previewToken: string;
    }).previewToken;
    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    const sc = sendResult.structuredContent as {
      txHash: string;
      txSignature: string;
    };
    expect(sc.txHash).toBeDefined();
    expect(sc.txSignature).toBeDefined();
    expect(sc.txHash).toBe(sc.txSignature);
    expect(sc.txHash).toBe(FIXTURE_BROADCAST_SIG_BASE58);
  });
});

// ---------------------------------------------------------------------------
// Test 14 — demo-mode no-broadcast invariant.
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — demo-mode no-broadcast invariant", () => {
  it("VAULTPILOT_DEMO=true + Solana persona: prepare → preview → send produces simulation envelope; sign + sendRawTransaction = 0 calls", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersonaBySlug("solana-whale");
    expect(isDemoMode()).toBe(true);

    const prepareResult = await callTool("prepare_solana_native_send", {
      to: RECIPIENT_PUBKEY.toBase58(),
      lamports: "1000000000",
    });
    expect(prepareResult.isError).toBeFalsy();
    const handle = (prepareResult.structuredContent as { handle: string }).handle;

    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBeFalsy();
    const previewToken = (previewResult.structuredContent as {
      previewToken: string;
    }).previewToken;

    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    const sc = sendResult.structuredContent as {
      simulated: boolean;
      simulationResult: string;
      txType: string;
    };
    expect(sc.simulated).toBe(true);
    expect(sc.simulationResult).toBe("ok");
    expect(sc.txType).toBe("solana");

    // **Nothing leaves MCP in demo mode** — the SOL-PREP-03 trust invariant.
    expect(vi.mocked(_transport.signTransactionViaApp)).not.toHaveBeenCalled();
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 15 — Fixture K hardcoded literal cross-anchor.
// ---------------------------------------------------------------------------
describe("trust pipeline (Solana) — Fixture K + L hardcoded literal cross-anchors (transitive byte-identity)", () => {
  it("Fixture K full-pipeline fingerprint matches the hardcoded literal pinned in test/signing-fingerprint-solana.test.ts", async () => {
    // Persona A (5tzFk…) is the Fixture K feePayer; RECIPIENT (AKnL…) is
    // the Fixture K recipient; 1 SOL + FIXED_BLOCKHASH (in beforeEach
    // mock).
    const result = await callTool("prepare_solana_native_send", {
      to: PERSONA_B_ADDR, // PERSONA_B is Fixture K's recipient
      lamports: "1000000000",
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    // Transitive cross-anchor — drift in this pipeline would surface HERE
    // against the hardcoded literal in test/signing-fingerprint-solana.test.ts:95.
    expect(sc.payloadFingerprint).toBe(FIXTURE_K_FINGERPRINT);
  });

  it("Fixture L (SPL) full-pipeline fingerprint recomputes byte-identical via computeSolanaPayloadFingerprint over the stored messageBytes", async () => {
    const result = await callTool("prepare_solana_spl_send", {
      to: RECIPIENT_PUBKEY.toBase58(),
      mint: USDC_MINT.toBase58(),
      amount: "100",
    });
    if (result.isError) {
      throw new Error("Fixture L prepare failed");
    }
    const sc = result.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    const peeked = _peekHandleForTesting(sc.handle);
    if (!peeked) throw new Error("Fixture L: handle not found");
    const messageBytes = (peeked.tx as { messageBytes: Uint8Array }).messageBytes;
    const recomputed = computeSolanaPayloadFingerprint({ messageBytes });
    expect(sc.payloadFingerprint).toBe(recomputed);
  });
});
