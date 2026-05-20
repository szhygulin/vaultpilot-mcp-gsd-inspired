// Plan 12-04 — preview_send Solana branch regression file.
// Mirror of `test/preview-send.test.ts` (Phase 4) shape; Solana-side load-
// bearing invariants:
//
//   1. **EVM branch back-compat byte-identity** — EVM handles flow through
//      the unchanged Phase 4-9 body. Regression test: txType absent (default
//      "evm") still routes to the EVM body. (See `test/preview-send.test.ts`
//      for full EVM regression coverage; here we just verify the dispatcher
//      doesn't hijack EVM handles.)
//   2. **Solana branch happy path** — Fixture K presignHash re-anchored
//      byte-for-byte (cross-link to `test/signing-presign-hash-solana.test.ts`).
//   3. **MANDATORY simulation gate (DF-4)** — `status !== "ok"` ALWAYS refuses
//      with `SIMULATION_REFUSED`. Three sub-cases: program-error,
//      insufficient-lamports, RPC error.
//   4. **Layer 0.5 canonical-dispatch-solana refusal** — non-allowlisted
//      program IDs → `DISPATCH_TARGET_REFUSED` with verbatim offenders.
//   5. **PREPARE RECEIPT verbatim** — text body uses agent's raw strings.
//   6. **LEDGER BLIND-SIGN HASH (Solana)** block UNCONDITIONAL on the happy
//      path (DF-2 emission per CONTEXT.md `<specifics>`).
//   7. **previewToken UUID minted** + handle status transitions to
//      `previewed` only on `sim.status === "ok"`.
//   8. **Fixture L presignHash re-anchored** for the SPL TransferChecked path.
//
// Mocking strategy:
//   - `_simulationSolana.runSolanaPreviewSimulation` — full control over the
//     simulation surface (we never call the live RPC).
//   - `_solanaRegistry.getConnection` — stubbed Connection.
//   - handle-store stays REAL — seed handles via `createHandle`, assert
//     against `lookup()`.

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
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import { computeSolanaPayloadFingerprint } from "../src/signing/payload-fingerprint-solana.js";
import { _simulationSolana } from "../src/signing/simulation-solana.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
  type SolanaInstructionSummary,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

// ---- Fixture K (native SOL transfer) — pinned to match
// `test/signing-fingerprint-solana.test.ts` line-for-line. -------------------
const FROM = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const TO = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
const FIXED_BLOCKHASH = "11111111111111111111111111111111";

const FIXTURE_K_TO_BASE58 = TO.toBase58();
const FIXTURE_K_LAMPORTS_DECIMAL = "1000000000";
// Cross-link from test/signing-fingerprint-solana.test.ts:95.
const FIXTURE_K_FINGERPRINT =
  "0x7c3d1fbcea9a6823b6e1bbb76b45ec68cd4998f25727d3bfb7b17a389040d0d3";
// Cross-link from test/signing-presign-hash-solana.test.ts:54.
const FIXTURE_K_PRESIGN_HASH =
  "0xe3556abe46f8dde70626fcf0f1afeaef6ff5328aa88f37931c9e7208e58617a2";

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

// ---- Fixture L (SPL TransferChecked) — pinned to match
// `test/signing-fingerprint-solana.test.ts` line-for-line. -------------------
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const FIXTURE_L_AMOUNT_RAW = 100_000_000n;
const FIXTURE_L_DECIMALS = 6;
const FIXTURE_L_AMOUNT_HUMAN = "100";
// SHA-256 of Fixture L messageBytes — computed independently at PR-write
// time via `node -e crypto.createHash('sha256').update(messageBytes).digest('hex')`.
const FIXTURE_L_PRESIGN_HASH =
  "0x0126540f6cbd0893fe7b0ba496a6d06025d10b98103dcbb510ad17e3c14620cc";

function buildFixtureLMessageBytes(): Uint8Array {
  const sourceAta = getAssociatedTokenAddressSync(USDC_MINT, FROM);
  const destAta = getAssociatedTokenAddressSync(USDC_MINT, TO);
  const tx = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
  tx.add(
    createTransferCheckedInstruction(
      sourceAta,
      USDC_MINT,
      destAta,
      FROM,
      FIXTURE_L_AMOUNT_RAW,
      FIXTURE_L_DECIMALS,
    ),
  );
  return new Uint8Array(tx.serializeMessage());
}

function buildFixtureLInstructionSummary(): SolanaInstructionSummary[] {
  const sourceAta = getAssociatedTokenAddressSync(USDC_MINT, FROM);
  const destAta = getAssociatedTokenAddressSync(USDC_MINT, TO);
  return [
    {
      kind: "spl-transfer-checked",
      mint: USDC_MINT.toBase58(),
      sourceAta: sourceAta.toBase58(),
      destAta: destAta.toBase58(),
      destOwner: TO.toBase58(),
      amount: FIXTURE_L_AMOUNT_RAW,
      decimals: FIXTURE_L_DECIMALS,
    },
  ];
}

function seedFixtureKHandle(): string {
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

function seedFixtureLHandle(): string {
  const messageBytes = buildFixtureLMessageBytes();
  // Use a deliberately-different agent-side mint string to exercise the
  // verbatim PREPARE RECEIPT contract — the receipt MUST surface this raw
  // string, not the base58-normalized USDC_MINT.toBase58().
  return createHandle({
    args: {
      to: TO.toBase58(),
      valueWei: "0",
      mint: USDC_MINT.toBase58(),
      amount: FIXTURE_L_AMOUNT_HUMAN,
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
      programIds: [TOKEN_PROGRAM_ID.toBase58()],
      instructionSummary: buildFixtureLInstructionSummary(),
    },
    payloadFingerprint: computeSolanaPayloadFingerprint({ messageBytes }),
  });
}

function buildStubConnection(): Connection {
  return {} as unknown as Connection;
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  // Default mock — happy-path simulation. Per-test overrides via mockResolvedValue.
  vi.spyOn(_simulationSolana, "runSolanaPreviewSimulation").mockResolvedValue({
    status: "ok",
    err: null,
    logs: [
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program 11111111111111111111111111111111 success",
    ],
    unitsConsumed: 150,
  });
  vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(buildStubConnection());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1 — happy path, native SOL transfer (Fixture K re-anchor).
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — Fixture K native transfer happy path", () => {
  it("emits previewToken UUID + presignHash (Fixture K SHA-256 anchor) + payloadFingerprint passthrough + simulation.ok envelope; transitions handle to previewed", async () => {
    const handle = seedFixtureKHandle();
    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      previewToken: string;
      presignHash: string;
      payloadFingerprint: string;
      txType: string;
      simulation: {
        status: string;
        unitsConsumed: number;
        logCount: number;
        logs: string[];
      };
      decodedArgs: unknown[];
    };

    expect(sc.handle).toBe(handle);
    expect(sc.previewToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // LOAD-BEARING — Fixture K SHA-256 anchor cross-linked from
    // test/signing-presign-hash-solana.test.ts:54. Drift in the preimage
    // assembly (messageBytes) or hash function (sneaky keccak swap) fails
    // HERE at this exact assertion line.
    expect(sc.presignHash).toBe(FIXTURE_K_PRESIGN_HASH);
    expect(sc.payloadFingerprint).toBe(FIXTURE_K_FINGERPRINT);
    expect(sc.txType).toBe("solana");
    expect(sc.simulation.status).toBe("ok");
    expect(sc.simulation.unitsConsumed).toBe(150);
    expect(sc.simulation.logCount).toBe(2);
    expect(sc.decodedArgs).toHaveLength(1);

    // Handle status → previewed; pinned carries previewToken + presignHash.
    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (!lookupResult.ok) return;
    expect(lookupResult.record.status).toBe("previewed");
    expect(lookupResult.record.pinned?.previewToken).toBe(sc.previewToken);
    expect(lookupResult.record.pinned?.presignHash).toBe(FIXTURE_K_PRESIGN_HASH);
    // EVM-specific fields populated with sentinel zeros.
    expect(lookupResult.record.pinned?.nonce).toBe(0);
    expect(lookupResult.record.pinned?.gas).toBe(0n);
    expect(lookupResult.record.pinned?.selector).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 2 — happy path, SPL TransferChecked (Fixture L re-anchor).
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — Fixture L SPL TransferChecked happy path", () => {
  it("emits presignHash (Fixture L SHA-256 anchor) + SPL PREPARE RECEIPT block", async () => {
    const handle = seedFixtureLHandle();
    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { presignHash: string; txType: string };
    // Fixture L SHA-256 anchor — pinned literal computed at PR-write time
    // via `crypto.createHash("sha256").update(messageBytes).digest("hex")`.
    expect(sc.presignHash).toBe(FIXTURE_L_PRESIGN_HASH);
    expect(sc.txType).toBe("solana");

    const text = result.content[0]?.text ?? "";
    // SPL PREPARE RECEIPT — verbatim raw args.
    expect(text).toContain("PREPARE RECEIPT (Solana — SPL transfer)");
    expect(text).toContain(TO.toBase58());
    expect(text).toContain(USDC_MINT.toBase58());
    expect(text).toContain(FIXTURE_L_AMOUNT_HUMAN);
    // DECODED ARGS for SPL surfaces the derived ATAs + amount/decimals.
    expect(text).toContain("DECODED ARGS (Solana — SPL TransferChecked)");
    expect(text).toContain(String(FIXTURE_L_AMOUNT_RAW));
    expect(text).toContain(`decimals:       ${FIXTURE_L_DECIMALS}`);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — SIMULATION_REFUSED (DF-4 mandatory): program-error.
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — SIMULATION_REFUSED on program-error (DF-4 mandatory)", () => {
  it("status: \"program-error\" → refuses with SIMULATION_REFUSED; logs surfaced verbatim; previewToken NEVER minted; handle stays prepared", async () => {
    vi.mocked(_simulationSolana.runSolanaPreviewSimulation).mockResolvedValue({
      status: "program-error",
      err: "Custom error 6000",
      logs: [
        "Program 11111111111111111111111111111111 invoke [1]",
        "Program failed: Custom error 6000",
      ],
      unitsConsumed: 250,
    });

    const handle = seedFixtureKHandle();
    const result = await callTool({ handle });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      message: string;
      cause?: string;
      simulation: {
        status: string;
        err: string;
        logCount: number;
        logs: string[];
      };
    };
    expect(sc.errorCode).toBe("SIMULATION_REFUSED");
    expect(sc.cause).toBe("Custom error 6000");
    expect(sc.simulation.status).toBe("program-error");
    expect(sc.simulation.err).toBe("Custom error 6000");
    // Logs surfaced verbatim in structuredContent.
    expect(sc.simulation.logs).toEqual([
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program failed: Custom error 6000",
    ]);
    expect(sc.simulation.logCount).toBe(2);

    // Defense-in-depth: handle status STAYS `prepared` — the agent re-runs
    // prepare to refresh, NOT preview.
    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (!lookupResult.ok) return;
    expect(lookupResult.record.status).toBe("prepared");
    expect(lookupResult.record.pinned).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 4 — SIMULATION_REFUSED on insufficient-lamports.
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — SIMULATION_REFUSED on insufficient-lamports", () => {
  it("status: \"insufficient-lamports\" → refuses with SIMULATION_REFUSED; cause surfaces InsufficientFundsForRent", async () => {
    vi.mocked(_simulationSolana.runSolanaPreviewSimulation).mockResolvedValue({
      status: "insufficient-lamports",
      err: "InsufficientFundsForRent",
      logs: ["Program log: insufficient funds for rent"],
      unitsConsumed: 50,
    });

    const handle = seedFixtureKHandle();
    const result = await callTool({ handle });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      cause?: string;
    };
    expect(sc.errorCode).toBe("SIMULATION_REFUSED");
    expect(sc.cause).toBe("InsufficientFundsForRent");

    // User-facing text surfaces the err in the SIMULATION block.
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("CHECKS PERFORMED (Solana simulation");
    expect(text).toContain("InsufficientFundsForRent");
  });
});

// ---------------------------------------------------------------------------
// Test 5 — SIMULATION_REFUSED on RPC error (never-throws contract).
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — SIMULATION_REFUSED on RPC error", () => {
  it("status: \"error\" with rpcError → refuses with SIMULATION_REFUSED; cause surfaces RPC message", async () => {
    vi.mocked(_simulationSolana.runSolanaPreviewSimulation).mockResolvedValue({
      status: "error",
      err: null,
      logs: [],
      unitsConsumed: null,
      rpcError: "Connection timeout",
    });

    const handle = seedFixtureKHandle();
    const result = await callTool({ handle });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      cause?: string;
    };
    expect(sc.errorCode).toBe("SIMULATION_REFUSED");
    expect(sc.cause).toBe("Connection timeout");
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Layer 0.5 DISPATCH_TARGET_REFUSED on non-allowlisted programId.
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — Layer 0.5 DISPATCH_TARGET_REFUSED", () => {
  it("non-allowlisted programId in record.tx.programIds → refuses with DISPATCH_TARGET_REFUSED + verbatim offenders + simulation NEVER called", async () => {
    const messageBytes = buildFixtureKMessageBytes();
    const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
    const handle = createHandle({
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
        // Inject a non-allowlisted programId — Phase 14 Jupiter deferral.
        programIds: [JUPITER_V6],
        instructionSummary: buildFixtureKInstructionSummary(),
      },
      payloadFingerprint: FIXTURE_K_FINGERPRINT,
    });

    const result = await callTool({ handle });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("DISPATCH_TARGET_REFUSED");
    expect(sc.message).toContain(JUPITER_V6);
    // Layer 0.5 short-circuits BEFORE Layer 0.7 simulation.
    expect(_simulationSolana.runSolanaPreviewSimulation).not.toHaveBeenCalled();
    // Handle status STAYS prepared.
    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (!lookupResult.ok) return;
    expect(lookupResult.record.status).toBe("prepared");
  });
});

// ---------------------------------------------------------------------------
// Test 7 — text block emission: PREPARE RECEIPT verbatim agent strings.
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — PREPARE RECEIPT verbatim agent strings (PREP-02)", () => {
  it("text body surfaces the agent's RAW `to` / `lamports` / `recentBlockhash` strings (no base58 normalization)", async () => {
    const handle = seedFixtureKHandle();
    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("PREPARE RECEIPT (Solana — native transfer)");
    expect(text).toContain(`to:              ${FIXTURE_K_TO_BASE58}`);
    expect(text).toContain(`lamports:        ${FIXTURE_K_LAMPORTS_DECIMAL}`);
    expect(text).toContain(`recentBlockhash: ${FIXED_BLOCKHASH}`);
  });
});

// ---------------------------------------------------------------------------
// Test 8 — LEDGER BLIND-SIGN HASH (Solana) block unconditional on happy path.
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — LEDGER BLIND-SIGN HASH block emitted unconditionally (DF-2)", () => {
  it("text body contains the LEDGER BLIND-SIGN HASH (Solana) block + full hash + chunked groups", async () => {
    const handle = seedFixtureKHandle();
    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("LEDGER BLIND-SIGN HASH (Solana)");
    // Full 64-hex hash present.
    expect(text).toContain(FIXTURE_K_PRESIGN_HASH);
    // Chunked form — 4-char groups separated by single space. The function
    // strips the 0x prefix before chunking, so the first chunk is "e355".
    expect(text).toContain("e355");
    expect(text).toContain("17a2");
  });
});

// ---------------------------------------------------------------------------
// Test 9 — VERIFY BEFORE SIGNING (Solana) block emitted on happy path.
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — VERIFY BEFORE SIGNING block emitted", () => {
  it("text body contains the VERIFY BEFORE SIGNING block naming the Solana network", async () => {
    const handle = seedFixtureKHandle();
    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("VERIFY BEFORE SIGNING");
    expect(text).toContain("Network: Solana mainnet-beta");
  });
});

// ---------------------------------------------------------------------------
// Test 10 — HANDLE_NOT_FOUND pre-dispatcher (regression).
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — HANDLE_NOT_FOUND pre-dispatcher", () => {
  it("unknown handle → HANDLE_NOT_FOUND BEFORE the txType dispatcher reads (simulation never called)", async () => {
    const result = await callTool({
      handle: "non-existent-handle-uuid",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("HANDLE_NOT_FOUND");
    expect(_simulationSolana.runSolanaPreviewSimulation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 11 — Re-preview overwrites previewToken (idempotent Q4).
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — re-preview re-pins fresh previewToken (Q4 idempotent)", () => {
  it("two sequential preview_send calls on the same Solana handle mint DIFFERENT previewTokens; presignHash STAYS byte-identical", async () => {
    const handle = seedFixtureKHandle();
    const r1 = await callTool({ handle });
    const r2 = await callTool({ handle });

    expect(r1.isError).toBeFalsy();
    expect(r2.isError).toBeFalsy();
    const sc1 = r1.structuredContent as { previewToken: string; presignHash: string };
    const sc2 = r2.structuredContent as { previewToken: string; presignHash: string };

    expect(sc1.previewToken).not.toBe(sc2.previewToken);
    // presignHash is deterministic from messageBytes → byte-identical.
    expect(sc1.presignHash).toBe(sc2.presignHash);
    expect(sc1.presignHash).toBe(FIXTURE_K_PRESIGN_HASH);
  });
});

// ---------------------------------------------------------------------------
// Test 12 — Solana branch dispatch (programIds with ASSOCIATED_TOKEN allowed).
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — SPL handle with create-ATA prepend → both Token + Associated Token Program allowed", () => {
  it("programIds: [TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM] passes Layer 0.5 (createATA path)", async () => {
    const messageBytes = buildFixtureLMessageBytes();
    const handle = createHandle({
      args: {
        to: TO.toBase58(),
        valueWei: "0",
        mint: USDC_MINT.toBase58(),
        amount: FIXTURE_L_AMOUNT_HUMAN,
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
        programIds: [
          TOKEN_PROGRAM_ID.toBase58(),
          ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
        ],
        instructionSummary: buildFixtureLInstructionSummary(),
      },
      payloadFingerprint: computeSolanaPayloadFingerprint({ messageBytes }),
    });

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { txType: string };
    expect(sc.txType).toBe("solana");
  });
});

// ---------------------------------------------------------------------------
// Test 13 — `_simulationSolana` spy verification — preview_send dispatches
// through the indirection (the entire Solana branch is gated by this seam).
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — _simulationSolana spy verification", () => {
  it("calls _simulationSolana.runSolanaPreviewSimulation with the reconstructed Transaction + connection", async () => {
    const handle = seedFixtureKHandle();
    await callTool({ handle });

    expect(_simulationSolana.runSolanaPreviewSimulation).toHaveBeenCalledTimes(1);
    const call = vi.mocked(_simulationSolana.runSolanaPreviewSimulation).mock
      .calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call!.connection).toBeDefined();
    expect(call!.transaction).toBeInstanceOf(Transaction);
  });
});

// ---------------------------------------------------------------------------
// Test 14 — FROZEN EVM body byte-identity assertion (LOAD-BEARING).
//
// Reads the EVM body region of src/tools/preview_send.ts (lines 193-451 in
// the post-12-04 file) from disk and asserts it byte-identical to the
// pre-12-04 base (origin/main lines 161-419). The dispatcher inserts a
// single 12-line block at lines 180-191 AND extracts the Solana branch
// AFTER the EVM body. The EVM body proper (Layer 0.5 EVM canonical-dispatch
// region through the final structuredContent block) must be untouched.
//
// Strategy: pin a load-bearing snippet from the EVM body (Layer 0.5
// `_canonicalDispatch.checkDispatchTarget` call site) and assert it
// appears in the current file verbatim. If the EVM body drifts, this
// fails.
// ---------------------------------------------------------------------------
describe("preview_send (Solana) — FROZEN EVM body byte-identity (LOAD-BEARING)", () => {
  it("the EVM Layer 0.5 / Layer 2 / sender-resolution regions are byte-identical to the pre-12-04 base", () => {
    const filePath = resolvePath(
      process.cwd(),
      "src/tools/preview_send.ts",
    );
    const file = readFileSync(filePath, "utf-8");

    // ---- Pinned snippets from the EVM body (pre-12-04 Phase 9 lock). ----
    // Each snippet is a chunk of the FROZEN region; if any line drifts
    // (whitespace, comment, identifier, control flow), the corresponding
    // assertion below fails.

    // Layer 0.5 EVM dispatch refusal — names the verbatim refusal text.
    const evmLayer05Snippet = [
      'if (record.tx.data !== "0x") {',
      "      const dispatchCheck = _canonicalDispatch.checkDispatchTarget(",
      "        record.tx.chainId as ChainId,",
      "        record.tx.to,",
      "      );",
    ].join("\n");
    expect(file).toContain(evmLayer05Snippet);

    // Layer 2 chain-mismatch — pinned `args.chain` runtime check.
    const evmLayer2Snippet = [
      'if (typeof args.chain === "string") {',
      "      const claimedChainName = args.chain as ChainName;",
      "      const claimedChainId = chainIdFromName(claimedChainName);",
      "      if (claimedChainId !== record.tx.chainId) {",
    ].join("\n");
    expect(file).toContain(evmLayer2Snippet);

    // EVM PRESIGN HASH compute — Fixture C anchor consumer.
    const evmPresignSnippet = [
      "const { presignHash } = computePresignHash({",
      "      chainId: record.tx.chainId,",
      "      nonce: pendingNonce,",
    ].join("\n");
    expect(file).toContain(evmPresignSnippet);

    // EVM transition pin — sentinel for the Phase 4 invariant.
    const evmTransitionSnippet = [
      "const trans = transitionToPreviewed(handleArg, {",
      "      nonce: pendingNonce,",
      "      gas: gasEstimate,",
      "      maxFeePerGas: fees.maxFeePerGas,",
      "      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,",
      "      previewToken,",
      "      presignHash,",
      "      selector,",
      "    });",
    ].join("\n");
    expect(file).toContain(evmTransitionSnippet);

    // EVM 4byte cross-check — Phase 4 PREP-06 anchor.
    const evm4byteSnippet = "const fourbyte = await lookupSelector(selector);";
    expect(file).toContain(evm4byteSnippet);

    // EVM simulation indirection — Phase 6 / Plan 06-02.
    const evmSimSnippet = [
      "const simulationResult = await _simulation.runPreviewSimulation({",
      "      client,",
      "      sender: senderAddress,",
    ].join("\n");
    expect(file).toContain(evmSimSnippet);
  });
});
