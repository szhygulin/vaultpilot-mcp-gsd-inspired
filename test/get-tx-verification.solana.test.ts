// Plan 12-05 — get_tx_verification Solana branch regression file.
// Mirror of `test/get-tx-verification.test.ts` (Phase 4 / Plan 04-05) shape.
//
// Solana-side load-bearing invariants:
//   1. **EVM branch back-compat byte-identity** — handles with `txType` absent
//      OR `"evm"` flow through the unchanged Phase 9 v1.3 body.
//   2. **Solana per-status re-emit**:
//        - `prepared`:  PREPARE RECEIPT (Solana) only + "(preview has not run…)"
//        - `previewed`: PREPARE RECEIPT (Solana) + LEDGER BLIND-SIGN HASH (Solana)
//                       + VERIFY BEFORE SIGNING (Solana)
//        - `sent`:      previewed blocks + BROADCAST CONFIRMATION (Solana
//                       txSignature)
//        - `cancelled`: previewed blocks (if it reached previewed) + CANCELLED
//   3. **txJson re-emit shape** — `txType: "solana"` + `messageBytesHex` +
//      `feePayer` + `recentBlockhash` + `programIds` + `instructionSummary`
//      (decimal-string bigints).
//   4. **PREPARE RECEIPT verbatim** — agent's raw strings from `record.args`
//      (PREP-02 invariant).
//   5. **BOTH `txHash` AND `txSignature` on `sent` handles** — same base58 value
//      under both keys (orchestrator API-symmetry override + RESEARCH Topic 7).
//   6. **No new errorCode** — `HANDLE_NOT_FOUND` / `HANDLE_EXPIRED` (existing)
//      only.
//
// Mocking strategy:
//   - 4byte client mocked — NEVER reached for Solana handles (Solana programs
//     are addressed by program ID, not 4-byte selector).
//   - Demo-mode short-circuit fires FIRST in the handler (Phase 4 invariant);
//     tests pin `VAULTPILOT_DEMO=false` in beforeEach.
//   - handle-store stays REAL — seed via `createHandle`, drive via
//     `transitionToPreviewed` / `transitionToSent` / `transitionToCancelled`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { Hex } from "viem";

import {
  LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE,
  PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE,
  PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE,
  VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE,
} from "../src/signing/blocks-solana.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  transitionToCancelled,
  transitionToPreviewed,
  transitionToSent,
  type PreviewPinned,
  type SolanaInstructionSummary,
} from "../src/signing/handle-store.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

import "../src/tools/get_tx_verification.js";

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// ---- Fixture K (native SOL transfer) ----------------------------------
const FROM = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const TO = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
const FIXTURE_K_FINGERPRINT =
  "0x7c3d1fbcea9a6823b6e1bbb76b45ec68cd4998f25727d3bfb7b17a389040d0d3" as Hex;
const FIXTURE_K_PRESIGN_HASH =
  "0xe3556abe46f8dde70626fcf0f1afeaef6ff5328aa88f37931c9e7208e58617a2" as Hex;
const PREVIEW_TOKEN = "fixture-solana-preview-token";
const TX_SIGNATURE_BASE58 =
  "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM1G6XsmJSdtFqdc7nuT9CrSjffmCABXmbDgnSGwQAyHkF8";

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

function buildPinnedSolana(): PreviewPinned {
  return {
    nonce: 0,
    gas: 0n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    previewToken: PREVIEW_TOKEN,
    presignHash: FIXTURE_K_PRESIGN_HASH,
    selector: null,
  };
}

function seedFixtureKPreparedHandle(): string {
  const messageBytes = buildFixtureKMessageBytes();
  return createHandle({
    args: {
      to: TO.toBase58(),
      valueWei: "0",
      lamports: "1000000000",
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

function seedFixtureKPreviewedHandle(): string {
  const handle = seedFixtureKPreparedHandle();
  const trans = transitionToPreviewed(handle, buildPinnedSolana());
  if (!trans.ok) throw new Error("seed: transitionToPreviewed failed");
  return handle;
}

function seedFixtureKSentHandle(): string {
  const handle = seedFixtureKPreviewedHandle();
  const trans = transitionToSent(handle, TX_SIGNATURE_BASE58);
  if (!trans.ok) throw new Error("seed: transitionToSent failed");
  return handle;
}

function seedFixtureKCancelledHandle(): string {
  const handle = seedFixtureKPreviewedHandle();
  const trans = transitionToCancelled(handle);
  if (!trans.ok) throw new Error("seed: transitionToCancelled failed");
  return handle;
}

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_tx_verification");
  if (!tool) throw new Error("get_tx_verification not registered");
  return tool.handler(args);
}

beforeEach(() => {
  _resetHandleStoreForTesting();
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
});

// ---------------------------------------------------------------------------
// Test 1 — EVM branch back-compat: no Solana dispatch when txType is absent.
// ---------------------------------------------------------------------------
describe("get_tx_verification (Solana) — EVM branch back-compat", () => {
  it("EVM handle (txType absent) flows through unchanged Phase 9 body", async () => {
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
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { txJson: { chainId: number } };
    // EVM-shape txJson — `chainId: 1` (NOT `txType: "solana"`).
    expect(sc.txJson.chainId).toBe(1);
    // NOT a Solana payload.
    expect((sc.txJson as { txType?: string }).txType).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Solana `prepared` re-emit.
// ---------------------------------------------------------------------------
describe("get_tx_verification (Solana) — `prepared` re-emit", () => {
  it("emits PREPARE RECEIPT (Solana — native transfer) only + structuredContent.status === \"prepared\"", async () => {
    const handle = seedFixtureKPreparedHandle();
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT (Solana — native transfer)");
    expect(text).toContain(`to:              ${TO.toBase58()}`);
    expect(text).toContain("lamports:        1000000000");
    expect(text).toContain(`recentBlockhash: ${FIXED_BLOCKHASH}`);
    // Preview not run yet → no LEDGER BLIND-SIGN HASH block. (The
    // "preview has not run yet" message itself mentions the BLIND-SIGN
    // HASH name; assert the block's Predicted-hash line is ABSENT.)
    expect(text).not.toContain("Predicted hash (full):");
    expect(text).toContain("preview has not run yet");

    const sc = result.structuredContent as {
      status: string;
      handle: string;
      txType: string;
      txJson: { txType: string; feePayer: string };
    };
    expect(sc.status).toBe("prepared");
    expect(sc.handle).toBe(handle);
    expect(sc.txType).toBe("solana");
    expect(sc.txJson.txType).toBe("solana");
    expect(sc.txJson.feePayer).toBe(FROM.toBase58());
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Solana `previewed` re-emit (LEDGER BLIND-SIGN HASH block).
// ---------------------------------------------------------------------------
describe("get_tx_verification (Solana) — `previewed` re-emit", () => {
  it("emits PREPARE RECEIPT + LEDGER BLIND-SIGN HASH (Solana) + VERIFY BEFORE SIGNING blocks", async () => {
    const handle = seedFixtureKPreviewedHandle();
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT (Solana — native transfer)");
    expect(text).toContain("LEDGER BLIND-SIGN HASH (Solana)");
    // Full hash + chunked form.
    expect(text).toContain(FIXTURE_K_PRESIGN_HASH);
    expect(text).toContain("e355");
    expect(text).toContain("17a2");
    expect(text).toContain("VERIFY BEFORE SIGNING");
    expect(text).toContain("Network: Solana mainnet-beta");

    const sc = result.structuredContent as {
      status: string;
      presignHash: string;
      previewToken: string;
      payloadFingerprint: string;
      txType: string;
    };
    expect(sc.status).toBe("previewed");
    expect(sc.presignHash).toBe(FIXTURE_K_PRESIGN_HASH);
    expect(sc.previewToken).toBe(PREVIEW_TOKEN);
    expect(sc.payloadFingerprint).toBe(FIXTURE_K_FINGERPRINT);
    expect(sc.txType).toBe("solana");
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Solana `sent` re-emit (BOTH txHash AND txSignature).
// ---------------------------------------------------------------------------
describe("get_tx_verification (Solana) — `sent` re-emit (BOTH txHash + txSignature)", () => {
  it("emits BROADCAST CONFIRMATION block + structuredContent carries BOTH txHash AND txSignature with same base58 value", async () => {
    const handle = seedFixtureKSentHandle();
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("BROADCAST CONFIRMATION");
    expect(text).toContain(`txSignature:   ${TX_SIGNATURE_BASE58}`);
    expect(text).toMatch(/broadcastedAt: \d{4}-\d{2}-\d{2}T/);

    const sc = result.structuredContent as {
      status: string;
      txHash: string;
      txSignature: string;
      broadcastedAt: string;
    };
    expect(sc.status).toBe("sent");
    // LOAD-BEARING — BOTH fields surface the SAME base58 value.
    expect(sc.txHash).toBe(TX_SIGNATURE_BASE58);
    expect(sc.txSignature).toBe(TX_SIGNATURE_BASE58);
    expect(sc.txHash).toBe(sc.txSignature);
    expect(sc.broadcastedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Solana `cancelled` re-emit.
// ---------------------------------------------------------------------------
describe("get_tx_verification (Solana) — `cancelled` re-emit", () => {
  it("emits CANCELLED footer + no txHash on structuredContent", async () => {
    const handle = seedFixtureKCancelledHandle();
    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("CANCELLED");
    expect(text).toMatch(/cancelledAt: \d{4}-\d{2}-\d{2}T/);
    // PREPARE RECEIPT still emitted (handle reached previewed before cancel).
    expect(text).toContain("PREPARE RECEIPT (Solana — native transfer)");

    const sc = result.structuredContent as {
      status: string;
      cancelledAt: string;
      txHash?: string;
    };
    expect(sc.status).toBe("cancelled");
    expect(sc.cancelledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sc.txHash).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 6 — txJson decimal-string serialization for bigints.
// ---------------------------------------------------------------------------
describe("get_tx_verification (Solana) — txJson bigint → decimal-string serialization", () => {
  it("lamports in instructionSummary serializes as decimal string (NOT bigint primitive)", async () => {
    const handle = seedFixtureKPreviewedHandle();
    const result = await callTool({ handle });
    const sc = result.structuredContent as {
      txJson: {
        instructionSummary: Array<{ kind: string; lamports: unknown }>;
        messageBytesHex: string;
        programIds: string[];
      };
    };
    const first = sc.txJson.instructionSummary[0]!;
    expect(first.kind).toBe("native-transfer");
    // Decimal string, NOT bigint.
    expect(typeof first.lamports).toBe("string");
    expect(first.lamports).toBe("1000000000");
    // messageBytesHex is 0x-prefixed lowercase hex.
    expect(sc.txJson.messageBytesHex).toMatch(/^0x[0-9a-f]+$/);
    // programIds verbatim from record.
    expect(sc.txJson.programIds).toContain(SystemProgram.programId.toBase58());
  });
});

// ---------------------------------------------------------------------------
// Test 7 — PREPARE RECEIPT verbatim agent strings.
// ---------------------------------------------------------------------------
describe("get_tx_verification (Solana) — PREPARE RECEIPT verbatim (PREP-02)", () => {
  it("surfaces the agent's RAW `to` / `lamports` / `recentBlockhash` strings", async () => {
    const handle = seedFixtureKPreparedHandle();
    const result = await callTool({ handle });
    const text = result.content[0]?.text ?? "";
    // Format-fanout-sentinel — same substitution as preview_send Solana branch.
    const expectedReceipt = PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE
      .replace("{TO}", TO.toBase58())
      .replace("{LAMPORTS}", "1000000000")
      .replace("{RECENT_BLOCKHASH}", FIXED_BLOCKHASH);
    expect(text).toContain(expectedReceipt);
  });
});

// ---------------------------------------------------------------------------
// Test 8 — SPL TransferChecked re-emit shape.
// ---------------------------------------------------------------------------
describe("get_tx_verification (Solana) — SPL TransferChecked re-emit", () => {
  it("emits SPL PREPARE RECEIPT block + structuredContent has SPL instructionSummary", async () => {
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
        programIds: [TOKEN_PROGRAM_ID.toBase58()],
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
      payloadFingerprint:
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    transitionToPreviewed(handle, buildPinnedSolana());

    const result = await callTool({ handle });
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    // SPL receipt block.
    expect(text).toContain("PREPARE RECEIPT (Solana — SPL transfer)");
    expect(text).toContain(`mint:            ${USDC_MINT.toBase58()}`);
    expect(text).toContain("amount:          100");

    const sc = result.structuredContent as {
      txJson: {
        instructionSummary: Array<{
          kind: string;
          amount?: string;
          decimals?: number;
        }>;
      };
    };
    const first = sc.txJson.instructionSummary[0]!;
    expect(first.kind).toBe("spl-transfer-checked");
    expect(first.amount).toBe("100000000");
    expect(first.decimals).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Test 9 — HANDLE_NOT_FOUND.
// ---------------------------------------------------------------------------
describe("get_tx_verification (Solana) — HANDLE_NOT_FOUND", () => {
  it("returns HANDLE_NOT_FOUND envelope (existing error code; no new Solana-specific code)", async () => {
    const result = await callTool({ handle: "nonexistent-handle-uuid" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("HANDLE_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Test 10 — format-fanout-sentinel re-emit equality: LEDGER BLIND-SIGN HASH
// (Solana) block byte-identical to the template substitution.
// ---------------------------------------------------------------------------
describe("get_tx_verification (Solana) — format-fanout-sentinel re-emit equality", () => {
  it("LEDGER BLIND-SIGN HASH (Solana) block byte-identical to template substitution", async () => {
    const handle = seedFixtureKPreviewedHandle();
    const result = await callTool({ handle });
    const text = result.content[0]?.text ?? "";
    // Reproduce the same chunking the production code uses (inline mirror).
    const raw = FIXTURE_K_PRESIGN_HASH.startsWith("0x")
      ? FIXTURE_K_PRESIGN_HASH.slice(2)
      : FIXTURE_K_PRESIGN_HASH;
    const groups: string[] = [];
    for (let i = 0; i < raw.length; i += 4) {
      groups.push(raw.slice(i, i + 4));
    }
    const expected = LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE
      .replace("{HASH_FULL_64HEX}", FIXTURE_K_PRESIGN_HASH)
      .replace("{HASH_CHUNKED_4_CHAR_GROUPS}", groups.join(" "));
    expect(text).toContain(expected);
    // And VERIFY BEFORE SIGNING is the unmodified template.
    expect(text).toContain(VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE);
  });
});

// ---------------------------------------------------------------------------
// Test 11 — Demo-mode short-circuit fires FIRST (before Solana dispatch).
// ---------------------------------------------------------------------------
describe("get_tx_verification (Solana) — demo-mode short-circuit fires before Solana dispatch", () => {
  it("VAULTPILOT_DEMO=true → DEMO_MODE_REFUSED for any handle (including Solana)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    const handle = seedFixtureKPreviewedHandle();
    const result = await callTool({ handle });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("DEMO_MODE_REFUSED");
  });
});

// ---------------------------------------------------------------------------
// Test 12 — `txJson.messageBytesHex` byte-identity round-trips messageBytes.
// ---------------------------------------------------------------------------
describe("get_tx_verification (Solana) — messageBytesHex round-trip", () => {
  it("messageBytesHex decodes byte-for-byte to the stored record.tx.messageBytes", async () => {
    const handle = seedFixtureKPreparedHandle();
    const result = await callTool({ handle });
    const sc = result.structuredContent as {
      txJson: { messageBytesHex: string };
    };
    const hex = sc.txJson.messageBytesHex;
    expect(hex).toMatch(/^0x[0-9a-f]+$/);
    const decoded = Buffer.from(hex.slice(2), "hex");
    const expected = buildFixtureKMessageBytes();
    expect(decoded.equals(Buffer.from(expected))).toBe(true);
  });
});
