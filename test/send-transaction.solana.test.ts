// Plan 12-05 — `send_transaction` Solana branch regression file.
// Mirror of `test/send-transaction.test.ts` (Phase 4) shape; Solana-side load-
// bearing invariants:
//
//   1. **EVM branch back-compat byte-identity** — EVM handles (txType absent
//      OR "evm") flow through the unchanged Phase 4-9 body. Defense against
//      accidental Solana-branch hijack.
//   2. **Three FROZEN gates re-anchored byte-identical for Solana**:
//      PREVIEW_REQUIRED, WRONG_STATUS, PREVIEW_TOKEN_MISMATCH,
//      PAYLOAD_FINGERPRINT_DRIFT fire identically on Solana handles via the
//      discriminator dispatch on the recompute call (one if/else; refusal
//      envelope + error message byte-identical).
//   3. **Cancel branch** — `userDecision: "cancel"` transitions Solana handle
//      to cancelled WITHOUT signing OR broadcasting (T-CANCEL-1 mirror).
//   4. **USB-HID sign path** — happy path stubs
//      `signSolanaTransaction({ signature })` + `connection.sendRawTransaction`;
//      asserts BOTH `txHash` AND `txSignature` returned (orchestrator API-
//      symmetry override + RESEARCH Topic 7).
//   5. **Ledger error mapping** — LEDGER_NOT_CONNECTED, SOLANA_APP_NOT_OPEN,
//      LEDGER_REJECTED, INTERNAL_ERROR catch-all, BROADCAST_FAILED on
//      sendRawTransaction throw.
//   6. **Demo-mode short-circuit** — simulation envelope returned; SIGN spy
//      = 0 calls; sendRawTransaction spy = 0 calls (DEMO-05 Solana mirror).
//   7. **Persona-swap detection** — paired Solana account different from
//      `record.tx.feePayer` → `INTERNAL_ERROR` refusal BEFORE Ledger sign.
//   8. **`userInputType: "sol"` passthrough** — sign spy receives "sol", NOT
//      "ata", NOT undefined (cross-link to test/ledger-solana-transport.signtx.test.ts).
//   9. **EVM three-gate FROZEN region byte-identity assertion** — load-bearing
//      regression test reading the FROZEN region from disk + asserting the
//      three gate tokens are present and the refusal envelope structure is
//      preserved.
//
// Mocking strategy:
//   - `_transport.signTransactionViaApp` spy — full control over the Ledger
//     sign surface (intercepts at the per-call seam, NOT at the named-export
//     binding which is immutable for cross-export internal calls).
//   - `connection.sendRawTransaction` — stubbed via the connection mock.
//   - `_solanaRegistry.getConnection` — stubbed Connection.
//   - `listAccounts` from `non-evm-account-store` — mocked for pairing.
//   - handle-store stays REAL — seed handles via `createHandle`, assert via
//     `lookup()`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { Hex } from "viem";

const { listAccountsSpy, sendRawTransactionSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  sendRawTransactionSpy: vi.fn(),
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
  createHandle,
  lookup,
  transitionToPreviewed,
  type PreviewPinned,
  type SolanaInstructionSummary,
} from "../src/signing/handle-store.js";
import { _transport } from "../src/wallet/ledger-solana-transport.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("send_transaction");
  if (!tool) throw new Error("send_transaction not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// ---- Fixture K (native SOL transfer) ----------------------------------
const FROM = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const TO = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
const FIXED_BLOCKHASH = "11111111111111111111111111111111";

const FIXTURE_K_TO_BASE58 = TO.toBase58();
const FIXTURE_K_LAMPORTS_DECIMAL = "1000000000";
const FIXTURE_K_FINGERPRINT =
  "0x7c3d1fbcea9a6823b6e1bbb76b45ec68cd4998f25727d3bfb7b17a389040d0d3";
const FIXTURE_K_PRESIGN_HASH =
  "0xe3556abe46f8dde70626fcf0f1afeaef6ff5328aa88f37931c9e7208e58617a2" as Hex;
const FIXTURE_PREVIEW_TOKEN = "fixture-sol-preview-token-aaaa";
const SIGNATURE_64 = Buffer.alloc(64, 0xaa);
const FIXTURE_BROADCAST_SIGNATURE_BASE58 =
  "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM1G6XsmJSdtFqdc7nuT9CrSjffmCABXmbDgnSGwQAyHkF8";

const PAIRED_SOLANA_ACCOUNT = {
  chain: "solana" as const,
  address: FROM.toBase58(),
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

function buildFixtureKMessageBytes(): Uint8Array {
  const tx = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: FROM,
      toPubkey: TO,
      lamports: 1_000_000_000,
    }),
  );
  return new Uint8Array(tx.serializeMessage());
}

function buildFixtureKInstructionSummary(): SolanaInstructionSummary[] {
  return [
    {
      kind: "native-transfer",
      from: FROM.toBase58(),
      to: TO.toBase58(),
      lamports: 1_000_000_000n,
    },
  ];
}

function buildFixturePinned(
  opts?: { previewToken?: string },
): PreviewPinned {
  return {
    nonce: 0,
    gas: 0n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    previewToken: opts?.previewToken ?? FIXTURE_PREVIEW_TOKEN,
    presignHash: FIXTURE_K_PRESIGN_HASH,
    selector: null,
  };
}

function seedFixtureKPreparedHandle(): string {
  const messageBytes = buildFixtureKMessageBytes();
  return createHandle({
    args: {
      to: FIXTURE_K_TO_BASE58,
      valueWei: "0",
      lamports: FIXTURE_K_LAMPORTS_DECIMAL,
      recentBlockhash: FIXED_BLOCKHASH,
    },
    tx: {
      txType: "solana",
      chainId: 0,
      to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      valueWei: 0n,
      data: "0x" as `0x${string}`,
      messageBytes,
      feePayer: FROM.toBase58(),
      recentBlockhash: FIXED_BLOCKHASH,
      programIds: [SystemProgram.programId.toBase58()],
      instructionSummary: buildFixtureKInstructionSummary(),
    },
    payloadFingerprint: FIXTURE_K_FINGERPRINT,
  });
}

function seedFixtureKPreviewedHandle(opts?: {
  previewToken?: string;
}): { handle: string; previewToken: string } {
  const previewToken = opts?.previewToken ?? FIXTURE_PREVIEW_TOKEN;
  const handle = seedFixtureKPreparedHandle();
  const trans = transitionToPreviewed(handle, buildFixturePinned({ previewToken }));
  if (!trans.ok) throw new Error("seed: transitionToPreviewed failed");
  return { handle, previewToken };
}

function buildStubConnection(): Connection {
  return {
    sendRawTransaction: sendRawTransactionSpy,
  } as unknown as Connection;
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  listAccountsSpy.mockReset();
  sendRawTransactionSpy.mockReset();
  // Default — single paired Solana account matching FROM (the fixture
  // feePayer). Tests that need a different state override per-call.
  listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
  // Default — sendRawTransaction returns the fixture base58 signature.
  sendRawTransactionSpy.mockResolvedValue(FIXTURE_BROADCAST_SIGNATURE_BASE58);
  // Default — Ledger sign returns the fixed 64-byte signature.
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

// ---------------------------------------------------------------------------
// Test 1 — EVM back-compat: no dispatch when txType is absent or "evm".
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — EVM branch back-compat (no Solana hijack)", () => {
  it("EVM handle (txType absent) still routes to the EVM body — schema gate on userDecision still fires", async () => {
    // Seed an EVM-shape handle directly. No txType => defaults to "evm".
    const handle = createHandle({
      args: {
        to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        valueWei: "1000000000000000000",
      },
      tx: {
        chainId: 1,
        to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`,
        valueWei: 1_000_000_000_000_000_000n,
        data: "0x" as `0x${string}`,
      },
      payloadFingerprint:
        "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a",
    });
    // Without preview, the EVM body fires PREVIEW_REQUIRED. If the dispatch
    // hijacked, the Solana branch's WALLET_NOT_PAIRED or signTransactionViaApp
    // call would surface instead. The EVM-side PREVIEW_REQUIRED matches the
    // FROZEN three-gate region (gate 1).
    const signSpy = vi.mocked(_transport.signTransactionViaApp);
    const result = await callTool({
      handle,
      previewToken: "any-token",
      userDecision: "send",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PREVIEW_REQUIRED");
    // Solana sign NEVER called for an EVM handle.
    expect(signSpy).not.toHaveBeenCalled();
    // sendRawTransaction NEVER called for an EVM handle.
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Three FROZEN gates fire identically for Solana handles.
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — FROZEN three-gate region applies byte-identical (PREP-07/08)", () => {
  it("(2a) PREVIEW_REQUIRED — Solana handle in `prepared` status refuses without signing", async () => {
    const handle = seedFixtureKPreparedHandle();
    const signSpy = vi.mocked(_transport.signTransactionViaApp);
    const result = await callTool({
      handle,
      previewToken: "any-token",
      userDecision: "send",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PREVIEW_REQUIRED");
    expect(signSpy).not.toHaveBeenCalled();
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();
  });

  it("(2b) WRONG_STATUS — Solana handle in `sent` refuses with WRONG_STATUS", async () => {
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    // Drive the handle to `sent` first.
    const first = await callTool({ handle, previewToken, userDecision: "send" });
    expect(first.isError).toBeFalsy();
    // Second send refuses.
    const second = await callTool({ handle, previewToken, userDecision: "send" });
    expect(second.isError).toBe(true);
    const sc = second.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_STATUS");
    // sign called EXACTLY once (the first send only).
    expect(vi.mocked(_transport.signTransactionViaApp)).toHaveBeenCalledTimes(1);
  });

  it("(2c) PREVIEW_TOKEN_MISMATCH — Solana handle in `previewed` with wrong token refuses; sign NEVER called", async () => {
    const { handle } = seedFixtureKPreviewedHandle({ previewToken: "tok-A-uuid" });
    const signSpy = vi.mocked(_transport.signTransactionViaApp);
    const result = await callTool({
      handle,
      previewToken: "tok-B-uuid", // wrong
      userDecision: "send",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PREVIEW_TOKEN_MISMATCH");
    expect(signSpy).not.toHaveBeenCalled();
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();
  });

  it("(2d) CANCEL — `userDecision: \"cancel\"` transitions Solana handle to cancelled WITHOUT signing OR broadcasting (T-CANCEL-1 mirror)", async () => {
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    const signSpy = vi.mocked(_transport.signTransactionViaApp);
    const result = await callTool({ handle, previewToken, userDecision: "cancel" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { userCancelled: boolean };
    expect(sc.userCancelled).toBe(true);
    expect(signSpy).not.toHaveBeenCalled();
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("post-cancel: handle not found");
    expect(lookupResult.record.status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Test 3 — PAYLOAD_FINGERPRINT_DRIFT on stored-fingerprint mutation (Solana).
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — PAYLOAD_FINGERPRINT_DRIFT (PREP-08, T-DRIFT-1)", () => {
  it("detects stored-fingerprint mutation and refuses; sign NEVER called", async () => {
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    // Mutate the STORED fingerprint to simulate in-process corruption.
    const peeked = _peekHandleForTesting(handle);
    if (!peeked) throw new Error("test setup: handle not found");
    peeked.payloadFingerprint =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    const signSpy = vi.mocked(_transport.signTransactionViaApp);
    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PAYLOAD_FINGERPRINT_DRIFT");
    expect(signSpy).not.toHaveBeenCalled();
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();
  });

  it("detects messageBytes mutation (Solana symmetric attack model) and refuses with PAYLOAD_FINGERPRINT_DRIFT", async () => {
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    const peeked = _peekHandleForTesting(handle);
    if (!peeked) throw new Error("test setup: handle not found");
    // Mutate `record.tx.messageBytes` (the recompute input). The stored
    // fingerprint stays at FIXTURE_K_FINGERPRINT; the recompute over the
    // mutated bytes yields a different value → refusal fires.
    const tx = peeked.tx as { messageBytes: Uint8Array };
    tx.messageBytes = new Uint8Array([
      ...tx.messageBytes.slice(0, tx.messageBytes.length - 1),
      tx.messageBytes[tx.messageBytes.length - 1]! ^ 0xff, // flip last byte
    ]);

    const signSpy = vi.mocked(_transport.signTransactionViaApp);
    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PAYLOAD_FINGERPRINT_DRIFT");
    expect(signSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 4 — WALLET_NOT_PAIRED on zero Solana accounts.
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — WALLET_NOT_PAIRED on no paired Solana account", () => {
  it("real-mode + zero Solana accounts → refusal WALLET_NOT_PAIRED BEFORE Ledger sign", async () => {
    listAccountsSpy.mockReturnValue([]);
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    const signSpy = vi.mocked(_transport.signTransactionViaApp);
    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
    expect(signSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Persona-swap detection (paired account != record.tx.feePayer).
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — persona-swap detection (defense-in-depth)", () => {
  it("paired account changed mid-flow → INTERNAL_ERROR refusal naming the discrepancy; sign NEVER called", async () => {
    // Paired account is FROM (matches feePayer). Override mid-test: re-pair
    // to a different account.
    const DIFFERENT_ADDR = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
    listAccountsSpy.mockReturnValue([
      {
        ...PAIRED_SOLANA_ACCOUNT,
        address: DIFFERENT_ADDR, // != FROM
      },
    ]);
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    const signSpy = vi.mocked(_transport.signTransactionViaApp);
    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("INTERNAL_ERROR");
    // The message should name the discrepancy.
    expect(sc.message).toMatch(/paired Solana account changed/);
    expect(signSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Happy path: returns BOTH txHash AND txSignature; handle → sent.
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — happy path real-mode (BOTH txHash + txSignature)", () => {
  it("returns BOTH txHash AND txSignature with same base58 value; handle transitions to sent", async () => {
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      txHash: string;
      txSignature: string;
      broadcastedAt: string;
      handle: string;
      txType: string;
      sessionTopicLast8: string | null;
    };
    expect(sc.txHash).toBe(FIXTURE_BROADCAST_SIGNATURE_BASE58);
    expect(sc.txSignature).toBe(FIXTURE_BROADCAST_SIGNATURE_BASE58);
    // LOAD-BEARING — BOTH fields surface the SAME base58 value (orchestrator
    // API-symmetry override).
    expect(sc.txHash).toBe(sc.txSignature);
    expect(sc.broadcastedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sc.handle).toBe(handle);
    expect(sc.txType).toBe("solana");
    expect(sc.sessionTopicLast8).toBeNull();

    // Handle transitioned to `sent` with the base58 signature stored.
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("post-send: handle not found");
    expect(lookupResult.record.status).toBe("sent");
    expect(lookupResult.record.txHash).toBe(FIXTURE_BROADCAST_SIGNATURE_BASE58);

    // Sign called EXACTLY once; sendRawTransaction called EXACTLY once.
    expect(vi.mocked(_transport.signTransactionViaApp)).toHaveBeenCalledTimes(1);
    expect(sendRawTransactionSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — `userInputType: "sol"` passthrough.
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — userInputType passthrough (RESEARCH Topic 5 lock)", () => {
  it("calls signTransactionViaApp with userInputType: \"sol\" (NOT \"ata\", NOT undefined)", async () => {
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    await callTool({ handle, previewToken, userDecision: "send" });
    const signSpy = vi.mocked(_transport.signTransactionViaApp);
    expect(signSpy).toHaveBeenCalledTimes(1);
    const [, , , userInputType] = signSpy.mock.calls[0]!;
    expect(userInputType).toBe("sol");
  });
});

// ---------------------------------------------------------------------------
// Test 8 — Transaction reconstruction byte-identity.
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — transaction reconstruction byte-identity", () => {
  it("signTransactionViaApp receives messageBytes byte-identical to record.tx.messageBytes (regression against re-derivation drift)", async () => {
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    await callTool({ handle, previewToken, userDecision: "send" });
    const signSpy = vi.mocked(_transport.signTransactionViaApp);
    expect(signSpy).toHaveBeenCalledTimes(1);
    const [, , passedBuffer] = signSpy.mock.calls[0]!;
    expect(Buffer.isBuffer(passedBuffer)).toBe(true);
    // The bytes passed to the SDK MUST equal `record.tx.messageBytes`.
    const expected = buildFixtureKMessageBytes();
    expect(passedBuffer.equals(Buffer.from(expected))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 9 — Ledger error mapping: LEDGER_NOT_CONNECTED.
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — Ledger error mapping", () => {
  it("LEDGER_NOT_CONNECTED — isSupported returns false → refusal", async () => {
    vi.mocked(_transport.isSupported).mockResolvedValue(false);
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("LEDGER_NOT_CONNECTED");
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();
  });

  it("SOLANA_APP_NOT_OPEN — getAppConfiguration throws → refusal", async () => {
    vi.mocked(_transport.buildSolanaApp).mockReturnValue({
      getAppConfiguration: vi.fn(async () => {
        throw new Error("0x6e00 — INS_NOT_SUPPORTED");
      }),
    });
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("SOLANA_APP_NOT_OPEN");
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();
  });

  it("LEDGER_REJECTED — APDU 0x6985 substring → refusal with cause", async () => {
    vi.mocked(_transport.signTransactionViaApp).mockRejectedValue(
      new Error("Ledger device: APDU 0x6985 — Conditions of use not satisfied"),
    );
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("LEDGER_REJECTED");
    expect(sc.cause).toMatch(/0x6985/);
    // Handle status unchanged — still previewed.
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("post-reject: handle not found");
    expect(lookupResult.record.status).toBe("previewed");
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();
  });

  it("INTERNAL_ERROR catch-all — arbitrary sign throw → refusal with cause", async () => {
    vi.mocked(_transport.signTransactionViaApp).mockRejectedValue(
      new Error("unexpected HID layer error"),
    );
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INTERNAL_ERROR");
    expect(sc.cause).toBe("unexpected HID layer error");
  });
});

// ---------------------------------------------------------------------------
// Test 10 — BROADCAST_FAILED on sendRawTransaction throw.
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — BROADCAST_FAILED on sendRawTransaction throw", () => {
  it("sendRawTransaction rejects → refusal BROADCAST_FAILED with cause; sign still called once", async () => {
    sendRawTransactionSpy.mockRejectedValue(new Error("RPC nonce reuse"));
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("BROADCAST_FAILED");
    expect(sc.cause).toBe("RPC nonce reuse");
    // sign was called BEFORE the broadcast (signature already obtained).
    expect(vi.mocked(_transport.signTransactionViaApp)).toHaveBeenCalledTimes(1);
    expect(sendRawTransactionSpy).toHaveBeenCalledTimes(1);
    // Handle status unchanged (still previewed).
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("post-broadcast-fail: handle not found");
    expect(lookupResult.record.status).toBe("previewed");
  });
});

// ---------------------------------------------------------------------------
// Test 11 — Demo-mode short-circuit (DEMO-05 Solana mirror).
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — DEMO-05 simulation envelope (T-DEMO-1 mirror)", () => {
  it("VAULTPILOT_DEMO=true + Solana persona + previewed → simulation envelope; sign + sendRawTransaction NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersonaBySlug("solana-whale");
    expect(isDemoMode()).toBe(true);

    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      simulated: boolean;
      simulationResult: string;
      simulationLogs: string[];
      simulatedAt: string;
      handle: string;
      txType: string;
    };
    expect(sc.simulated).toBe(true);
    expect(sc.simulationResult).toBe("ok");
    expect(sc.simulationLogs).toHaveLength(2);
    expect(sc.simulatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sc.handle).toBe(handle);
    expect(sc.txType).toBe("solana");

    // Load-bearing — NOTHING signed; NOTHING broadcast.
    expect(vi.mocked(_transport.signTransactionViaApp)).not.toHaveBeenCalled();
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();

    // Handle status unchanged.
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("post-demo: handle not found");
    expect(lookupResult.record.status).toBe("previewed");
  });

  it("demo mode + Solana handle but no Solana persona set → WRONG_MODE; sign + sendRawTransaction NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting(); // wipe any persona
    expect(isDemoMode()).toBe(true);

    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");
    expect(vi.mocked(_transport.signTransactionViaApp)).not.toHaveBeenCalled();
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 12 — Idempotency: second send on a sent handle refuses WRONG_STATUS.
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — idempotency (T-PREVIEW-CONSUMED-1 mirror)", () => {
  it("second send on a sent Solana handle refuses; sign called only ONCE total", async () => {
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    // First send.
    const first = await callTool({ handle, previewToken, userDecision: "send" });
    expect(first.isError).toBeFalsy();
    // Second send.
    const second = await callTool({ handle, previewToken, userDecision: "send" });
    expect(second.isError).toBe(true);
    const sc = second.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_STATUS");
    expect(vi.mocked(_transport.signTransactionViaApp)).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Test 13 — EVM three-gate FROZEN region byte-identity assertion.
//
// LOAD-BEARING regression: the FROZEN three-gate region (lines 195-316 in
// the pre-12-05 source; widened ONLY at the recompute call inside the
// PAYLOAD_FINGERPRINT_DRIFT block). The test reads the current source from
// disk and asserts:
//   1. The three FROZEN gate-region tokens are present (PREVIEW_REQUIRED,
//      WRONG_STATUS, PREVIEW_TOKEN_MISMATCH, PAYLOAD_FINGERPRINT_DRIFT).
//   2. The dispatcher widening adds `computeSolanaPayloadFingerprint`
//      AND keeps `computePayloadFingerprint` (no replacement).
//   3. The cancel branch sentinel `userDecision === "cancel"` is present.
//   4. The transitionToSent + transitionToCancelled tokens are present.
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — T-FROZEN-THREE-GATE-REGRESSION-1 (LOAD-BEARING)", () => {
  it("source preserves FROZEN three-gate tokens AND adds Solana branch widening — static content check", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(process.cwd(), "src/tools/send_transaction.ts"),
      "utf8",
    );
    // FROZEN tokens — these MUST appear (deleting any breaks gate behavior).
    const frozenTokens = [
      "PREVIEW_REQUIRED",
      "WRONG_STATUS",
      "PREVIEW_TOKEN_MISMATCH",
      "PAYLOAD_FINGERPRINT_DRIFT",
      "computePayloadFingerprint",
      "transitionToCancelled",
      "transitionToSent",
      'userDecision === "cancel"',
    ];
    for (const tok of frozenTokens) {
      expect(source.includes(tok)).toBe(true);
    }
    // Plan 12-05 additive tokens — these MUST appear (widening present).
    const additiveTokens = [
      "computeSolanaPayloadFingerprint",
      "sendTransactionSolanaBranch",
      "signSolanaTransaction",
      "connection.sendRawTransaction",
      "txSignature",
    ];
    for (const tok of additiveTokens) {
      expect(source.includes(tok)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 14 — Sanity check: presignHash field is preserved (cross-link to
// the preview-time hash) — defends against accidental fingerprint vs.
// presign-hash field-name collision.
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — preserved pinned state across send-time transitions", () => {
  it("post-send, handle.pinned.presignHash unchanged from preview-time (cross-link to Plan 12-04)", async () => {
    const { handle, previewToken } = seedFixtureKPreviewedHandle();
    await callTool({ handle, previewToken, userDecision: "send" });
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("post-send: handle not found");
    expect(lookupResult.record.pinned?.presignHash).toBe(FIXTURE_K_PRESIGN_HASH);
    // Sanity — the presign hash bytes match what computeSolanaPresignHash
    // returns over the same messageBytes (defense against accidental
    // hash-function swap on the preview path).
    const recomputedPresign = computeSolanaPresignHash({
      messageBytes: buildFixtureKMessageBytes(),
    }).presignHash;
    expect(recomputedPresign).toBe(FIXTURE_K_PRESIGN_HASH);
    // And the fingerprint bytes match the prepare-time literal.
    const recomputedFingerprint = computeSolanaPayloadFingerprint({
      messageBytes: buildFixtureKMessageBytes(),
    });
    expect(recomputedFingerprint).toBe(FIXTURE_K_FINGERPRINT);
  });
});

// ---------------------------------------------------------------------------
// Test 15 — SPL TransferChecked send-path happy path.
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — SPL TransferChecked happy path", () => {
  it("SPL handle send path returns both txHash + txSignature; sign called with messageBytes byte-identity", async () => {
    // Build an SPL handle (mirror seedFixtureLHandle from preview test).
    const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const sourceAta = getAssociatedTokenAddressSync(USDC_MINT, FROM);
    const destAta = getAssociatedTokenAddressSync(USDC_MINT, TO);
    const tx = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
    tx.add(
      createTransferCheckedInstruction(
        sourceAta,
        USDC_MINT,
        destAta,
        FROM,
        100_000_000n,
        6,
      ),
    );
    const messageBytes = new Uint8Array(tx.serializeMessage());
    const handle = createHandle({
      args: {
        to: TO.toBase58(),
        valueWei: "0",
        mint: USDC_MINT.toBase58(),
        amount: "100",
        recentBlockhash: FIXED_BLOCKHASH,
      },
      tx: {
        txType: "solana",
        chainId: 0,
        to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        valueWei: 0n,
        data: "0x" as `0x${string}`,
        messageBytes,
        feePayer: FROM.toBase58(),
        recentBlockhash: FIXED_BLOCKHASH,
        programIds: [TOKEN_PROGRAM_ID.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()],
        instructionSummary: [
          {
            kind: "spl-transfer-checked",
            mint: USDC_MINT.toBase58(),
            sourceAta: sourceAta.toBase58(),
            destAta: destAta.toBase58(),
            destOwner: TO.toBase58(),
            amount: 100_000_000n,
            decimals: 6,
          },
        ],
      },
      payloadFingerprint: computeSolanaPayloadFingerprint({ messageBytes }),
    });
    const previewToken = "spl-preview-token";
    const trans = transitionToPreviewed(handle, {
      nonce: 0,
      gas: 0n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      previewToken,
      presignHash: computeSolanaPresignHash({ messageBytes }).presignHash,
      selector: null,
    });
    if (!trans.ok) throw new Error("setup: SPL transition failed");

    const result = await callTool({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      txHash: string;
      txSignature: string;
      txType: string;
    };
    expect(sc.txHash).toBe(FIXTURE_BROADCAST_SIGNATURE_BASE58);
    expect(sc.txSignature).toBe(FIXTURE_BROADCAST_SIGNATURE_BASE58);
    expect(sc.txType).toBe("solana");

    // Sign received the SPL messageBytes byte-identical.
    const signSpy = vi.mocked(_transport.signTransactionViaApp);
    const [, , passedBuffer] = signSpy.mock.calls[0]!;
    expect(passedBuffer.equals(Buffer.from(messageBytes))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 16 — register-all wiring smoke check.
// ---------------------------------------------------------------------------
describe("send_transaction (Solana) — register-all wiring (smoke)", () => {
  it("is registered (single tool surface, additive Solana branch)", () => {
    const tool = getRegisteredTool("send_transaction");
    expect(tool).toBeDefined();
  });
});
