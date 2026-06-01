// `prepare_solana_nonce_close` end-to-end regression. Phase 44 — Plan 44-01
// (R-SOL-10). Consumer of Fixture N in
// `test/signing-fingerprint-solana.test.ts` (cross-linked by letter).
//
// Mirror of `test/prepare-solana-spl-send.test.ts` (Plan 12-03) shape.
// Nonce-close-side load-bearing invariants (the AUTHORITY GATE, VP_S005):
//
//   1. **Authority gate — NO handle on any refusal.** getAccountInfo →
//      NonceAccount.fromAccountData → assert stored authority === paired
//      wallet. Refuse (solanaErrorCode VP_S005, errorCode INVALID_INPUT, NO
//      handle minted) if ANY of: account absent / wrong owner / malformed
//      nonce data / authority mismatch. Each refusal test asserts the
//      no-handle property EXPLICITLY (the security property — not merely that
//      it returns an error).
//   2. **Withdraw amount = FULL on-chain balance** — `BigInt(accountInfo.lamports)`,
//      NEVER a caller param. Asserted on the happy path against Fixture N.
//   3. **payloadFingerprint Fixture N cross-link** — solana-whale persona +
//      canonical nonce pubkey + full balance (= 1_447_680) + fixed-blockhash
//      sentinel produces the hardcoded literal `0x4cb38976...` pinned in
//      `test/signing-fingerprint-solana.test.ts` (Fixture N). Drift in
//      preimage assembly fails at that exact line.
//
// Mocks:
//   - `_solanaRegistry.getConnection()` returns a stub `Connection` whose
//     `getAccountInfo` + `getLatestBlockhash` are `vi.fn`. Configurable
//     account-info state per test (absent / wrong-owner / malformed / valid).
//   - `non-evm-account-store.listAccounts` mocked to control real-mode
//     pairing state.
//   - `getActiveSolanaPersona()` controlled via `setActiveSolanaPersonaBySlug`.

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
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveSolanaPersonaBySlug,
} from "../src/demo/state.js";
import { _solanaSystem } from "../src/protocols/solana-system.js";
import { computeSolanaPayloadFingerprint } from "../src/signing/payload-fingerprint-solana.js";
import { PREPARE_RECEIPT_SOLANA_NONCE_CLOSE_TEMPLATE } from "../src/signing/blocks-solana.js";
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
  const tool = getRegisteredTool("prepare_solana_nonce_close");
  if (!tool) throw new Error("prepare_solana_nonce_close not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Canonical Fixture N inputs — must match
// `test/signing-fingerprint-solana.test.ts` line-for-line.
//   FROM (= solana-whale persona = authority = destination = feePayer)
const SOLANA_WHALE_ADDR = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
//   NONCE_PUBKEY = Fixture-N `TO`.
const FIXTURE_N_NONCE_PUBKEY = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
//   Full on-chain balance withdrawn = the canonical rent anchor.
const FIXTURE_N_LAMPORTS = 1_447_680;
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
const FROM_PERSONA = "solana-whale";
const VP_S005 = "VP_S005";
// Hardcoded literal anchor — pinned at Fixture N in
// `test/signing-fingerprint-solana.test.ts:269`. Drift in this tool's
// preimage assembly surfaces HERE, at this exact line.
const FIXTURE_N_FINGERPRINT =
  "0x4cb389760626e559c85fca6d9f3d14c4408871fd034c73f1a82fe4d797f8dea2";
// Fixture N message-bytes length anchor (cross-link with
// signing-fingerprint-solana.test.ts:266).
const FIXTURE_N_MESSAGE_LEN = 217;

const PAIRED_SOLANA_ACCOUNT = {
  chain: "solana" as const,
  address: SOLANA_WHALE_ADDR,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

// Build a valid INITIALIZED durable-nonce account data buffer (80 bytes) whose
// stored authority is `authority`. Layout (verified against
// @solana/web3.js@1.98.4 `NonceAccount.fromAccountData`):
//   version (u32 LE)         @ 0
//   state   (u32 LE) = 1     @ 4   (1 == Initialized)
//   authorizedPubkey (32)    @ 8
//   nonce / blockhash (32)   @ 40
//   feeCalculator.lamportsPerSignature (u64 LE) @ 72
function makeNonceAccountData(authority: PublicKey): Buffer {
  const buf = Buffer.alloc(NONCE_ACCOUNT_LENGTH);
  buf.writeUInt32LE(1, 0); // version
  buf.writeUInt32LE(1, 4); // state = Initialized
  authority.toBuffer().copy(buf, 8);
  // Stored nonce (any 32-byte blockhash-shaped value) — reuse the nonce pubkey
  // bytes as a deterministic stand-in; not asserted by the gate.
  new PublicKey(FIXTURE_N_NONCE_PUBKEY).toBuffer().copy(buf, 40);
  buf.writeBigUInt64LE(5000n, 72); // lamportsPerSignature
  return buf;
}

function nonceAccountInfo(opts: {
  authority?: PublicKey;
  lamports?: number;
  owner?: PublicKey;
  data?: Buffer;
} = {}): AccountInfo<Buffer> {
  const {
    authority = new PublicKey(SOLANA_WHALE_ADDR),
    lamports = FIXTURE_N_LAMPORTS,
    owner = SystemProgram.programId,
    data,
  } = opts;
  return {
    data: data ?? makeNonceAccountData(authority),
    executable: false,
    lamports,
    owner,
    rentEpoch: 0,
  };
}

function buildStubConnection(opts: {
  blockhash?: string;
  accountInfo?: AccountInfo<Buffer> | null;
  throwOnGetAccountInfo?: Error;
  throwOnGetLatestBlockhash?: Error;
} = {}): Connection {
  const {
    blockhash = FIXED_BLOCKHASH,
    accountInfo = nonceAccountInfo(),
    throwOnGetAccountInfo,
    throwOnGetLatestBlockhash,
  } = opts;
  return {
    getAccountInfo: vi.fn(async (_pubkey: PublicKey) => {
      if (throwOnGetAccountInfo) throw throwOnGetAccountInfo;
      return accountInfo;
    }),
    getLatestBlockhash: vi.fn(async () => {
      if (throwOnGetLatestBlockhash) throw throwOnGetLatestBlockhash;
      return { blockhash, lastValidBlockHeight: 100_000_000 };
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

describe("prepare_solana_nonce_close — happy path (real mode, authorized nonce account)", () => {
  it("returns { handle, fromPersona, noncePubkey, destination, withdrawLamports, recentBlockhash, payloadFingerprint, txType: 'solana' } with verbatim PREPARE RECEIPT", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      fromPersona: string;
      noncePubkey: string;
      destination: string;
      withdrawLamports: string;
      recentBlockhash: string;
      payloadFingerprint: string;
      txType: string;
      feePayer: string;
    };
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sc.fromPersona).toBe(FROM_PERSONA);
    expect(sc.noncePubkey).toBe(FIXTURE_N_NONCE_PUBKEY);
    // Destination is the paired wallet — rent returns home. NEVER a param.
    expect(sc.destination).toBe(SOLANA_WHALE_ADDR);
    expect(sc.feePayer).toBe(SOLANA_WHALE_ADDR);
    // Withdraw amount = FULL on-chain balance (accountInfo.lamports), as a
    // decimal string — NEVER a caller param.
    expect(sc.withdrawLamports).toBe(String(FIXTURE_N_LAMPORTS));
    expect(sc.recentBlockhash).toBe(FIXED_BLOCKHASH);
    expect(sc.txType).toBe("solana");

    const expected = PREPARE_RECEIPT_SOLANA_NONCE_CLOSE_TEMPLATE
      .replace("{FROM_PERSONA}", FROM_PERSONA)
      .replace("{NONCE_PUBKEY}", FIXTURE_N_NONCE_PUBKEY)
      .replace("{DESTINATION}", SOLANA_WHALE_ADDR)
      .replace("{WITHDRAW_LAMPORTS}", String(FIXTURE_N_LAMPORTS))
      .replace("{RECENT_BLOCKHASH}", FIXED_BLOCKHASH);
    expect(result.content[0]?.text ?? "").toBe(expected);
    expect(result.content[0]?.text ?? "").toContain(FIXTURE_N_NONCE_PUBKEY);

    expect(listAccountsSpy).toHaveBeenCalledTimes(1);
    expect(listAccountsSpy).toHaveBeenCalledWith({ chainFilter: "solana" });
  });

  it("withdraw amount tracks the on-chain balance, NOT a caller param (balance swap → different withdrawLamports)", async () => {
    // Same authority, different on-chain balance → withdrawLamports follows
    // accountInfo.lamports. Proves the amount is server-derived from the chain.
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ accountInfo: nonceAccountInfo({ lamports: 2_000_000 }) }),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { withdrawLamports: string };
    expect(sc.withdrawLamports).toBe("2000000");
  });
});

describe("prepare_solana_nonce_close — happy path (demo mode + active Solana persona)", () => {
  it("succeeds with destination = solana-whale persona; listAccounts NEVER called (demo-FIRST refusal contract)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersonaBySlug("solana-whale");
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { destination: string; txType: string };
    expect(sc.destination).toBe(SOLANA_WHALE_ADDR);
    expect(sc.txType).toBe("solana");

    expect(listAccountsSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(1);
  });
});

describe("prepare_solana_nonce_close — Fixture N cross-link (PAYLOAD_FINGERPRINT_DRIFT regression)", () => {
  it("byte-identical fingerprint to the literal pinned in signing-fingerprint-solana.test.ts (FIXTURE_N_FINGERPRINT)", async () => {
    // If this assertion fails, drift is in `prepare_solana_nonce_close`
    // preimage assembly — check `_solanaSystem.buildNonceCloseTx` (single
    // nonceWithdraw, full balance) OR the on-chain-balance read.
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersonaBySlug("solana-whale");
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_N_FINGERPRINT);
  });

  it("Nit 3 — _solanaSystem.buildNonceCloseTx reproduces the Fixture-N message bytes (wrapper bound to the literal)", async () => {
    const from = new PublicKey(SOLANA_WHALE_ADDR);
    const noncePk = new PublicKey(FIXTURE_N_NONCE_PUBKEY);
    const { messageBytes } = _solanaSystem.buildNonceCloseTx({
      from,
      noncePubkey: noncePk,
      authorizedPubkey: from,
      toPubkey: from,
      lamports: BigInt(FIXTURE_N_LAMPORTS),
      recentBlockhash: FIXED_BLOCKHASH,
    });
    expect(messageBytes.length).toBe(FIXTURE_N_MESSAGE_LEN);
    expect(computeSolanaPayloadFingerprint({ messageBytes })).toBe(
      FIXTURE_N_FINGERPRINT,
    );
  });
});

describe("prepare_solana_nonce_close — authority gate (VP_S005) — account absent", () => {
  it("refuses (VP_S005) when getAccountInfo returns null; NO handle minted", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({ accountInfo: null }),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      solanaErrorCode: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.solanaErrorCode).toBe(VP_S005);
    expect(result.content[0]?.text ?? "").toMatch(/does not exist/i);

    // SECURITY property: NO handle minted on the authority-gate refusal.
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_nonce_close — authority gate (VP_S005) — wrong owner", () => {
  it("refuses (VP_S005) when the account owner is not the System Program; NO handle minted", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      // Owner = SPL Token program (not System Program) → not a nonce account.
      buildStubConnection({
        accountInfo: nonceAccountInfo({ owner: TOKEN_PROGRAM_ID }),
      }),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      solanaErrorCode: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.solanaErrorCode).toBe(VP_S005);
    expect(result.content[0]?.text ?? "").toMatch(/System Program/i);

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_nonce_close — authority gate (VP_S005) — malformed nonce data", () => {
  it("refuses (VP_S005) when NonceAccount.fromAccountData throws (System-owned but not a valid nonce account); NO handle minted", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    // System-owned account whose data is too short to be a nonce-account
    // layout (e.g. a plain wallet — System-owned with 0 data bytes). The tool
    // comment notes `NonceAccount.fromAccountData` "throws on a non-nonce
    // System account (e.g. a plain wallet)"; a truncated buffer reproduces
    // that throw (a full 80-byte zeroed buffer instead PARSES with an
    // all-zeros authority → it would hit the authority-mismatch arm, not this
    // one). The 0-byte data is exactly what a real System wallet account has.
    const malformed = Buffer.alloc(0);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({
        accountInfo: nonceAccountInfo({ data: malformed }),
      }),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      solanaErrorCode: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.solanaErrorCode).toBe(VP_S005);
    expect(result.content[0]?.text ?? "").toMatch(/not a valid nonce account/i);

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_nonce_close — authority gate (VP_S005) — authority mismatch", () => {
  it("refuses (VP_S005) when the on-chain nonce authority != the paired wallet; NO handle minted (cross-persona close blocked)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    // A valid nonce account whose stored authority is a DIFFERENT wallet.
    const OTHER_AUTHORITY = new PublicKey(
      "9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu",
    );
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({
        accountInfo: nonceAccountInfo({ authority: OTHER_AUTHORITY }),
      }),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      solanaErrorCode: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.solanaErrorCode).toBe(VP_S005);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/authority/i);
    expect(text).toContain(OTHER_AUTHORITY.toBase58());

    // SECURITY property: NO handle minted — cannot close another wallet's nonce.
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_nonce_close — BROADCAST_FAILED branches", () => {
  it("refuses with BROADCAST_FAILED when getAccountInfo throws (RPC error, NOT a null/absent); NO handle minted", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({
        throwOnGetAccountInfo: new Error("getAccountInfo: ENETUNREACH"),
      }),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("BROADCAST_FAILED");
    expect(sc.cause).toMatch(/getAccountInfo|ENETUNREACH/);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with BROADCAST_FAILED when getLatestBlockhash throws (after authority gate passes); NO handle minted", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({
        throwOnGetLatestBlockhash: new Error("blockhash RPC down"),
      }),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("BROADCAST_FAILED");
    expect(sc.cause).toBe("blockhash RPC down");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_nonce_close — WALLET_NOT_PAIRED refusal (real mode, zero accounts)", () => {
  it("refuses with WALLET_NOT_PAIRED when listAccounts returns empty array; createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(result.content[0]?.text ?? "").toMatch(/pair_solana_ledger/);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_nonce_close — WRONG_MODE refusal (demo mode + no Solana persona)", () => {
  it("refuses with WRONG_MODE when demo mode is on but no Solana persona is set; listAccounts NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
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

describe("prepare_solana_nonce_close — INVALID_INPUT refusal (malformed noncePubkey)", () => {
  it("refuses with INVALID_INPUT for non-base58 noncePubkey BEFORE any state read; createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: "not-base58!!",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toContain("not-base58!!");
    expect(listAccountsSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_nonce_close — handle round-trip (record shape + recentBlockhash pinning)", () => {
  it("record.tx is the Solana shape (txType: 'solana' + messageBytes); record.args carries raw noncePubkey + pinned blockhash; status === 'prepared'", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    const sc = result.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.status).toBe("prepared");
    expect(record.pinned).toBeUndefined();

    expect(record.tx.txType).toBe("solana");
    if (record.tx.txType !== "solana") return;
    expect(record.tx.feePayer).toBe(SOLANA_WHALE_ADDR);
    expect(record.tx.recentBlockhash).toBe(FIXED_BLOCKHASH);
    expect(record.tx.programIds).toEqual(["11111111111111111111111111111111"]);
    expect(record.tx.messageBytes).toBeInstanceOf(Uint8Array);
    expect(record.tx.messageBytes.length).toBe(FIXTURE_N_MESSAGE_LEN);

    expect(record.args.to).toBe(FIXTURE_N_NONCE_PUBKEY);
    expect(record.args.recentBlockhash).toBe(FIXED_BLOCKHASH);
  });

  it("recentBlockhash pinned on handle: structuredContent.recentBlockhash === record.args.recentBlockhash (preview MUST NOT re-fetch)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
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

describe("prepare_solana_nonce_close — _solanaSystem indirection regression (build path)", () => {
  it("calls through `_solanaSystem.buildNonceCloseTx` with authority === toPubkey === feePayer === persona AND lamports === full balance", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );
    const buildSpy = vi.spyOn(_solanaSystem, "buildNonceCloseTx");

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_N_NONCE_PUBKEY,
    });

    expect(result.isError).toBeFalsy();
    expect(buildSpy).toHaveBeenCalledTimes(1);
    const callArgs = buildSpy.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    if (!callArgs) return;
    expect(callArgs.from.toBase58()).toBe(SOLANA_WHALE_ADDR);
    expect(callArgs.authorizedPubkey.toBase58()).toBe(SOLANA_WHALE_ADDR);
    expect(callArgs.toPubkey.toBase58()).toBe(SOLANA_WHALE_ADDR);
    expect(callArgs.noncePubkey.toBase58()).toBe(FIXTURE_N_NONCE_PUBKEY);
    // Withdraw amount = FULL on-chain balance, NEVER a caller param.
    expect(callArgs.lamports).toBe(BigInt(FIXTURE_N_LAMPORTS));
    expect(callArgs.recentBlockhash).toBe(FIXED_BLOCKHASH);
  });
});

describe("prepare_solana_nonce_close — register-all.ts wiring (smoke)", () => {
  it("prepare_solana_nonce_close is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_solana_nonce_close");
  });
});
