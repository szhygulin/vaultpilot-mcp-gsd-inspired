// `prepare_solana_spl_send` end-to-end regression. Phase 12 — Plan 12-03.
//
// Mirror of `test/prepare-solana-native-send.test.ts` (Plan 12-02) +
// `test/prepare-token-send.test.ts` (Phase 6 / Plan 06-02) shape. SPL-side
// load-bearing invariants:
//
//   1. **Demo-mode FIRST refusal** — `getActiveSolanaPersona()` consulted
//      BEFORE `listAccounts`. Demo-on + no Solana persona → `WRONG_MODE`;
//      `listAccounts` NEVER called.
//   2. **PREPARE RECEIPT verbatim** (PREP-02) — receipt body carries the
//      agent's raw `to` + `mint` + `amount` strings (no base58 normalization,
//      no decimal scaling).
//   3. **payloadFingerprint Fixture L cross-link** — the canonical Fixture L
//      inputs (solana-whale persona + USDC-Solana mint + canonical recipient +
//      "100" amount + fixed-blockhash sentinel + ATA-exists) produce the
//      hardcoded literal pinned in `test/signing-fingerprint-solana.test.ts`.
//      Drift in preimage assembly fails at that exact line — cross-linked
//      regression. If this test fails, drift is in `prepare_solana_spl_send`
//      preimage assembly — check `buildSplTransferTx` instruction ordering OR
//      ATA derivation.
//   4. **Sender-DEPENDENT fingerprint** — UNLIKE EVM (where `from` is not in
//      the preimage), Solana SPL fingerprints differ across personas because
//      the source ATA derives from sender. Unit-level anchor here; full
//      persona-cycle byte-identity assertion lives in Plan 12-05 integration.
//   5. **TransferChecked (NOT Transfer)** — the build path uses
//      `_solanaSpl.buildSplTransferTx` which calls `createTransferCheckedInstruction`.
//      The encoder-level regression-anchor lives in `test/protocols-solana-spl.test.ts`;
//      here we assert the prepare tool's instructionSummary surfaces the
//      `spl-transfer-checked` kind.
//
// Mocks:
//   - `_solanaRegistry.getConnection()` returns a stub `Connection` whose
//     `getLatestBlockhash` + `getAccountInfo` are `vi.fn`. Configurable
//     ATA-exists state per test.
//   - `non-evm-account-store.listAccounts` mocked to control real-mode
//     pairing state.
//   - `getActiveSolanaPersona()` controlled via the Solana persona registry's
//     `setActiveSolanaPersonaBySlug` (Phase 11 / Plan 11-06).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy, createHandleSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  createHandleSpy:
    vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

// Mock the non-evm-account-store's `listAccounts`. Other exports stay real.
vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (
      ...args: Parameters<typeof actual.listAccounts>
    ) => listAccountsSpy(...args),
  };
});

// Mock `createHandle` as a spy that delegates to the real implementation.
vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (
      ...args: Parameters<typeof actual.createHandle>
    ) => createHandleSpy(...args),
  };
});

import {
  type AccountInfo,
  type Connection,
  PublicKey,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import * as solRpcClient from "../src/chains/solana/sol-rpc-client.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveSolanaPersonaBySlug,
} from "../src/demo/state.js";
import { _solanaSpl } from "../src/protocols/solana-spl.js";
import { PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE } from "../src/signing/blocks-solana.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  lookup,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_solana_spl_send");
  if (!tool) throw new Error("prepare_solana_spl_send not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Canonical Fixture L inputs — must match
// `test/signing-fingerprint-solana.test.ts` line-for-line. The cross-link
// assertion below pins the produced `payloadFingerprint` to the literal.
const SOLANA_WHALE_ADDR = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const FIXTURE_L_TO = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// 100 USDC at decimals=6 → 100_000_000 raw units, matching Fixture L.
const FIXTURE_L_AMOUNT = "100";
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
// Hardcoded literal anchor — pinned at `test/signing-fingerprint-solana.test.ts:136`.
// Drift in this tool's preimage assembly surfaces HERE, at this exact line.
// If this test fails, drift is in `prepare_solana_spl_send` preimage assembly —
// check `buildSplTransferTx` instruction ordering OR ATA derivation.
const FIXTURE_L_FINGERPRINT =
  "0xabc93c06958f81a6bf9e626f9ac6437c80aac0ee55a1bafb984c266619e8bd92";
// Cross-link to deriveAtaForOwner regression in protocols-solana-spl.test.ts.
const EXPECTED_SOURCE_ATA = "FzbcyEZ9m8xjtergWgWDq7mfPoHEbboBF791B6cTpzbq";
const EXPECTED_DEST_ATA = "3wvJdyFnGvaMWpbq93NU91SggiVRveULUXL6iX5VZDGP";

// A canonical PAIRED Solana account (real mode).
const PAIRED_SOLANA_ACCOUNT = {
  chain: "solana" as const,
  address: SOLANA_WHALE_ADDR,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

function buildStubConnection(opts: {
  blockhash?: string;
  destAtaExists?: boolean;
  throwOnGetLatestBlockhash?: Error;
  throwOnGetAccountInfo?: Error;
} = {}): Connection {
  const {
    blockhash = FIXED_BLOCKHASH,
    destAtaExists = true,
    throwOnGetLatestBlockhash,
    throwOnGetAccountInfo,
  } = opts;
  return {
    getLatestBlockhash: vi.fn(async () => {
      if (throwOnGetLatestBlockhash) throw throwOnGetLatestBlockhash;
      return { blockhash, lastValidBlockHeight: 100_000_000 };
    }),
    getAccountInfo: vi.fn(async (_pubkey: PublicKey) => {
      if (throwOnGetAccountInfo) throw throwOnGetAccountInfo;
      if (destAtaExists) {
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

beforeEach(async () => {
  listAccountsSpy.mockReset();
  createHandleSpy.mockClear();
  const realHandleStore = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(realHandleStore.createHandle);
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
  vi.restoreAllMocks();
});

describe("prepare_solana_spl_send — happy path (real mode, ATA exists)", () => {
  it("returns { handle, to, mint, amount, decimals, recentBlockhash, payloadFingerprint, txType: 'solana', sourceAta, destAta, createDestAta: false } with PREPARE RECEIPT body", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ destAtaExists: true }),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      to: string;
      mint: string;
      amount: string;
      decimals: number;
      recentBlockhash: string;
      payloadFingerprint: string;
      txType: string;
      feePayer: string;
      sourceAta: string;
      destAta: string;
      createDestAta: boolean;
    };
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sc.to).toBe(FIXTURE_L_TO);
    expect(sc.mint).toBe(USDC_MINT);
    expect(sc.amount).toBe(FIXTURE_L_AMOUNT);
    expect(sc.decimals).toBe(6);
    expect(sc.recentBlockhash).toBe(FIXED_BLOCKHASH);
    expect(sc.txType).toBe("solana");
    expect(sc.feePayer).toBe(SOLANA_WHALE_ADDR);
    expect(sc.sourceAta).toBe(EXPECTED_SOURCE_ATA);
    expect(sc.destAta).toBe(EXPECTED_DEST_ATA);
    expect(sc.createDestAta).toBe(false);

    // PREPARE RECEIPT body — substituted from the format-fanout-sentinel
    // const. The ATA_NOTICE slot is empty when the ATA already exists; the
    // trailing empty line is dropped to keep the block tight.
    const expectedRaw = PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE
      .replace("{TO}", FIXTURE_L_TO)
      .replace("{MINT}", USDC_MINT)
      .replace("{AMOUNT}", FIXTURE_L_AMOUNT)
      .replace("{RECENT_BLOCKHASH}", FIXED_BLOCKHASH)
      .replace("{ATA_NOTICE}", "");
    const expected = expectedRaw.replace(/\n$/, "");
    expect(result.content[0]?.text ?? "").toBe(expected);
    expect(listAccountsSpy).toHaveBeenCalledTimes(1);
    expect(listAccountsSpy).toHaveBeenCalledWith({ chainFilter: "solana" });
  });
});

describe("prepare_solana_spl_send — happy path (real mode, ATA absent → create-ATA path)", () => {
  it("returns shape with createDestAta: true; PREPARE RECEIPT body carries the NOTICE line", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ destAtaExists: false }),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { createDestAta: boolean };
    expect(sc.createDestAta).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/NOTICE:/);
    expect(text).toMatch(/recipient does not yet hold this token/);
    expect(text).toMatch(/~0\.002 SOL/);
  });
});

describe("prepare_solana_spl_send — Fixture L cross-link (PAYLOAD_FINGERPRINT_DRIFT regression)", () => {
  it("byte-identical fingerprint to the literal pinned in signing-fingerprint-solana.test.ts (FIXTURE_L_FINGERPRINT)", async () => {
    // If this assertion fails, drift is in `prepare_solana_spl_send` preimage
    // assembly — check `buildSplTransferTx` instruction ordering OR ATA
    // derivation. Plan 12-05 integration test re-anchors this same byte-
    // identity end-to-end.
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersonaBySlug("solana-whale");
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      // ATA exists → no createATA prepend → message bytes match Fixture L.
      buildStubConnection({ destAtaExists: true }),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_L_FINGERPRINT);
  });
});

describe("prepare_solana_spl_send — sender-DEPENDENT fingerprint regression (source ATA derives from sender)", () => {
  it("two distinct sender pubkeys produce DIFFERENT fingerprints (unit-level anchor; Plan 12-05 integration asserts end-to-end)", async () => {
    // Persona A — solana-whale (canonical Fixture L sender).
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersonaBySlug("solana-whale");
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ destAtaExists: true }),
    );

    const resultA = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });
    expect(resultA.isError).toBeFalsy();
    const fpA = (resultA.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;

    // Persona B — an arbitrary other Solana pubkey (real-mode pair).
    // Using a real-mode paired account here so the test exercises a
    // different `feePayer` than persona A; the source-ATA → sender-dependent
    // fingerprint property is what we're proving.
    process.env[DEMO_KEY] = "false";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();
    // Deterministic on-curve persona B (Keypair.fromSeed(Buffer.alloc(32, 2)).publicKey)
    // — distinct from solana-whale; on-curve so `getAssociatedTokenAddress`
    // does not throw at the source-ATA derivation step.
    const PERSONA_B_ADDR = "9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu";
    listAccountsSpy.mockReturnValue([
      { ...PAIRED_SOLANA_ACCOUNT, address: PERSONA_B_ADDR },
    ]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ destAtaExists: true }),
    );

    const resultB = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });
    expect(resultB.isError).toBeFalsy();
    const fpB = (resultB.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;

    expect(fpA).not.toBe(fpB);
    // Both well-formed 32-byte 0x-prefixed hex.
    expect(fpA).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fpB).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("prepare_solana_spl_send — TransferChecked surface (NOT deprecated Transfer)", () => {
  it("instructionSummary[0].kind === 'spl-transfer-checked' (load-bearing — RESEARCH § Topic 6 defense-in-depth)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ destAtaExists: true }),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record || record.tx.txType !== "solana") return;
    expect(record.tx.instructionSummary).toBeDefined();
    if (!record.tx.instructionSummary) return;
    expect(record.tx.instructionSummary[0]?.kind).toBe("spl-transfer-checked");
    // Decimals captured in the instructionSummary — load-bearing because
    // preview_send + send_transaction Solana branches re-read from here.
    if (record.tx.instructionSummary[0]?.kind === "spl-transfer-checked") {
      expect(record.tx.instructionSummary[0]?.decimals).toBe(6);
    }
  });
});

describe("prepare_solana_spl_send — WALLET_NOT_PAIRED refusal (real mode, zero accounts)", () => {
  it("refuses with WALLET_NOT_PAIRED when listAccounts returns empty array; createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(result.content[0]?.text ?? "").toMatch(/pair_solana_ledger/);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_spl_send — WRONG_MODE refusal (demo mode + no Solana persona)", () => {
  it("refuses with WRONG_MODE when demo mode is on but no Solana persona is set; listAccounts NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WRONG_MODE",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);
    expect(text).toMatch(/set_demo_wallet/);
    expect(listAccountsSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_spl_send — INVALID_INPUT refusals", () => {
  it("refuses with INVALID_INPUT for malformed `to` (not base58); createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);

    const result = await callTool({
      to: "not-base58!!",
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toContain("not-base58!!");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT for malformed `mint`; createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: "not-a-mint!!",
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/mint/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT (cause: 'mint not found on-chain') when off-list mint's getMint throws", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    // Arbitrary off-list mint (not in top-50 registry).
    const OFF_LIST_MINT = "4Nd1mYpEv5sV7qfsT4hWfRSyKi5dWKBz9XGmAfWPVxA8";
    vi.spyOn(solRpcClient, "getMintDecimals").mockRejectedValueOnce(
      new solRpcClient.SolanaRpcError(new Error("mint pubkey not on-chain")),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: OFF_LIST_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("mint not found on-chain");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT for fractional-overflow (1.23456789012345 vs USDC decimals=6)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: "1.23456789012345",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("fractional-overflow");
    expect(result.content[0]?.text ?? "").toMatch(/fractional|decimals/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT (cause: 'empty') for empty `amount`", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: "",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("empty");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_spl_send — BROADCAST_FAILED branches", () => {
  it("refuses with BROADCAST_FAILED when getLatestBlockhash throws; cause field carries upstream message", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({
        throwOnGetLatestBlockhash: new Error("RPC timeout"),
      }),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("BROADCAST_FAILED");
    expect(sc.cause).toBe("RPC timeout");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with BROADCAST_FAILED when getAccountInfo throws (ATA pre-flight); cause names the RPC failure", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({
        throwOnGetAccountInfo: new Error("getAccountInfo: ENETUNREACH"),
      }),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("BROADCAST_FAILED");
    expect(sc.cause).toMatch(/getAccountInfo|ENETUNREACH/);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_spl_send — PREPARE RECEIPT verbatim invariant (PREP-02)", () => {
  it("substitutes PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE byte-for-byte from raw agent strings", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ destAtaExists: true }),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expectedRaw = PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE
      .replace("{TO}", FIXTURE_L_TO)
      .replace("{MINT}", USDC_MINT)
      .replace("{AMOUNT}", FIXTURE_L_AMOUNT)
      .replace("{RECENT_BLOCKHASH}", FIXED_BLOCKHASH)
      .replace("{ATA_NOTICE}", "");
    const expected = expectedRaw.replace(/\n$/, "");
    expect(text).toBe(expected);

    expect(text).toContain(FIXTURE_L_TO);
    expect(text).toContain(USDC_MINT);
    expect(text).toContain(FIXTURE_L_AMOUNT);
    expect(text).toContain(FIXED_BLOCKHASH);
  });
});

describe("prepare_solana_spl_send — decimal resolution paths (registry hit / live RPC)", () => {
  it("registry hit (USDC top-50) → no live getMintDecimals RPC call", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ destAtaExists: true }),
    );
    const rpcSpy = vi.spyOn(solRpcClient, "getMintDecimals");

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    // Registry hit → live RPC never invoked.
    expect(rpcSpy).toHaveBeenCalledTimes(0);
    const sc = result.structuredContent as { decimals: number };
    expect(sc.decimals).toBe(6);
  });

  it("registry miss → live getMintDecimals invoked once; decimals propagate", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    // Arbitrary off-list mint (not in top-50 registry).
    const OFF_LIST_MINT = "4Nd1mYpEv5sV7qfsT4hWfRSyKi5dWKBz9XGmAfWPVxA8";
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ destAtaExists: true }),
    );
    const rpcSpy = vi
      .spyOn(solRpcClient, "getMintDecimals")
      .mockResolvedValue(9);

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: OFF_LIST_MINT,
      amount: "1.5", // 1.5 at decimals=9 → valid
    });

    expect(result.isError).toBeFalsy();
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith(OFF_LIST_MINT);
    const sc = result.structuredContent as { decimals: number };
    expect(sc.decimals).toBe(9);
  });
});

describe("prepare_solana_spl_send — handle round-trip (record shape + wallet-NOT-ATA storage per userInputType: 'sol')", () => {
  it("record.args carries raw agent strings (including `to` as WALLET, NOT derived ATA); record.tx is Solana shape", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ destAtaExists: true }),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.status).toBe("prepared");
    expect(record.pinned).toBeUndefined();

    // tx — Solana shape (discriminated union narrowing).
    expect(record.tx.txType).toBe("solana");
    if (record.tx.txType !== "solana") return;
    expect(record.tx.feePayer).toBe(SOLANA_WHALE_ADDR);
    expect(record.tx.recentBlockhash).toBe(FIXED_BLOCKHASH);
    expect(record.tx.programIds).toEqual([TOKEN_PROGRAM_ID.toBase58()]);
    expect(record.tx.messageBytes).toBeInstanceOf(Uint8Array);
    // Fixture L message-bytes length anchor (cross-link with
    // signing-fingerprint-solana.test.ts:129).
    expect(record.tx.messageBytes.length).toBe(214);

    // args — RAW agent strings + pinned blockhash. `to` is the WALLET, NOT
    // the derived ATA — load-bearing per `userInputType: "sol"` lock
    // (Plan 12-04's signTransaction reads from here to pass to Ledger app).
    expect(record.args.to).toBe(FIXTURE_L_TO);
    expect(record.args.mint).toBe(USDC_MINT);
    expect(record.args.amount).toBe(FIXTURE_L_AMOUNT);
    expect(record.args.recentBlockhash).toBe(FIXED_BLOCKHASH);
    // `to` is NOT the derived destAta — defense against accidental
    // ATA-substitution at the storage boundary.
    expect(record.args.to).not.toBe(EXPECTED_DEST_ATA);
  });

  it("create-ATA path: handle carries BOTH TOKEN_PROGRAM_ID and ASSOCIATED_TOKEN_PROGRAM_ID in programIds", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ destAtaExists: false }),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });
    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record || record.tx.txType !== "solana") return;
    expect(record.tx.programIds.length).toBe(2);
    // Order asserted in `buildSplTransferTx` test: TOKEN first, then ASSOCIATED.
    expect(record.tx.programIds[0]).toBe(TOKEN_PROGRAM_ID.toBase58());
  });

  it("recentBlockhash pinned on handle: structuredContent.recentBlockhash === record.args.recentBlockhash (preview MUST NOT re-fetch)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ destAtaExists: true }),
    );

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });
    const sc = result.structuredContent as {
      handle: string;
      recentBlockhash: string;
    };
    const lookupResult = lookup(sc.handle);
    expect(lookupResult.ok).toBe(true);
    if (!lookupResult.ok) return;
    expect(sc.recentBlockhash).toBe(lookupResult.record.args.recentBlockhash);
  });
});

describe("prepare_solana_spl_send — register-all.ts wiring (smoke)", () => {
  it("prepare_solana_spl_send is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_solana_spl_send");
  });
});

describe("prepare_solana_spl_send — errorCode envelope set (no new codes introduced)", () => {
  it("error responses use only the locked set: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT, BROADCAST_FAILED, INTERNAL_ERROR", async () => {
    const ALLOWED = new Set([
      "WALLET_NOT_PAIRED",
      "WRONG_MODE",
      "INVALID_INPUT",
      "BROADCAST_FAILED",
      "INTERNAL_ERROR",
    ]);

    // WALLET_NOT_PAIRED arm.
    listAccountsSpy.mockReturnValue([]);
    const r1 = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });
    expect(
      ALLOWED.has((r1.structuredContent as { errorCode: string }).errorCode),
    ).toBe(true);

    // WRONG_MODE arm.
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();
    const r2 = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });
    expect(
      ALLOWED.has((r2.structuredContent as { errorCode: string }).errorCode),
    ).toBe(true);

    // INVALID_INPUT arm (bad `to`).
    process.env[DEMO_KEY] = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    const r3 = await callTool({
      to: "garbage!!",
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });
    expect(
      ALLOWED.has((r3.structuredContent as { errorCode: string }).errorCode),
    ).toBe(true);

    // BROADCAST_FAILED arm.
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({
        throwOnGetLatestBlockhash: new Error("rpc down"),
      }),
    );
    const r4 = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });
    expect(
      ALLOWED.has((r4.structuredContent as { errorCode: string }).errorCode),
    ).toBe(true);
  });
});

describe("prepare_solana_spl_send — _solanaSpl indirection regression (build path)", () => {
  it("calls through `_solanaSpl.buildSplTransferTx` (ESM spy-affordance contract)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ destAtaExists: true }),
    );
    const buildSpy = vi.spyOn(_solanaSpl, "buildSplTransferTx");

    const result = await callTool({
      to: FIXTURE_L_TO,
      mint: USDC_MINT,
      amount: FIXTURE_L_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    expect(buildSpy).toHaveBeenCalledTimes(1);
    // Confirm the build was called with the agent-provided inputs (via
    // PublicKey object equality round-trip on toBase58).
    const callArgs = buildSpy.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    if (!callArgs) return;
    expect(callArgs.from.toBase58()).toBe(SOLANA_WHALE_ADDR);
    expect(callArgs.toWallet.toBase58()).toBe(FIXTURE_L_TO);
    expect(callArgs.mint.toBase58()).toBe(USDC_MINT);
    expect(callArgs.amount).toBe(100_000_000n);
    expect(callArgs.decimals).toBe(6);
    expect(callArgs.recentBlockhash).toBe(FIXED_BLOCKHASH);
  });
});
