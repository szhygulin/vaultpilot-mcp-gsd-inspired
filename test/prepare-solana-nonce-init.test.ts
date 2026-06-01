// `prepare_solana_nonce_init` end-to-end regression. Phase 44 — Plan 44-01
// (R-SOL-09). Consumer of Fixture M in
// `test/signing-fingerprint-solana.test.ts` (cross-linked by letter).
//
// Mirror of `test/prepare-solana-native-send.test.ts` (Plan 12-02) shape.
// Nonce-init-side load-bearing invariants:
//
//   1. **Demo-mode FIRST refusal** — `getActiveSolanaPersona()` consulted
//      BEFORE `listAccounts`. Demo-on + no Solana persona → `WRONG_MODE`;
//      `listAccounts` NEVER called.
//   2. **PREPARE RECEIPT verbatim** (PREP-02) — receipt body carries the
//      agent's raw `fromPersona` + `noncePubkey` strings + the server-derived
//      authority / rent / blockhash, substituted from
//      `PREPARE_RECEIPT_SOLANA_NONCE_INIT_TEMPLATE`.
//   3. **payloadFingerprint Fixture M cross-link** — solana-whale persona +
//      canonical nonce pubkey (= Fixture-M `TO`) + 1_447_680 rent + fixed-
//      blockhash sentinel produces the hardcoded literal
//      `0xf23e8e00...` pinned in `test/signing-fingerprint-solana.test.ts`
//      (Fixture M). Drift in preimage assembly fails at that exact line.
//   4. **Self-collision refusal (security property)** — `noncePubkey` ===
//      wallet address refuses with INVALID_INPUT and mints NO handle.
//   5. **RPC-failure refusal** — `getMinimumBalanceForRentExemption` throwing
//      → BROADCAST_FAILED, NO handle.
//
// Mocks:
//   - `_solanaRegistry.getConnection()` returns a stub `Connection` whose
//     `getMinimumBalanceForRentExemption` + `getLatestBlockhash` are `vi.fn`.
//     Sealed rent + blockhash sentinels for the Fixture M cross-link.
//   - `non-evm-account-store.listAccounts` mocked to control real-mode
//     pairing state.
//   - `getActiveSolanaPersona()` controlled via `setActiveSolanaPersonaBySlug`.
//   - `solRpcClient.getMinimumBalanceForRentExemption` spied for the RPC-failure
//     arm (the tool calls the exported function directly, not the connection).

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

import { Connection } from "@solana/web3.js";

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import * as solRpcClient from "../src/chains/solana/sol-rpc-client.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveSolanaPersonaBySlug,
} from "../src/demo/state.js";
import { _solanaSystem } from "../src/protocols/solana-system.js";
import { PREPARE_RECEIPT_SOLANA_NONCE_INIT_TEMPLATE } from "../src/signing/blocks-solana.js";
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
  const tool = getRegisteredTool("prepare_solana_nonce_init");
  if (!tool) throw new Error("prepare_solana_nonce_init not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Canonical Fixture M inputs — must match
// `test/signing-fingerprint-solana.test.ts` line-for-line. The cross-link
// assertion below pins the produced `payloadFingerprint` to the literal.
//   FROM (= solana-whale persona = authority = feePayer)
const SOLANA_WHALE_ADDR = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
//   NONCE_PUBKEY = Fixture-M `TO` (deterministic pinned nonce-account pubkey).
const FIXTURE_M_NONCE_PUBKEY = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
//   RENT_LAMPORTS = canonical rent anchor (RESEARCH §Rent/sizing).
const FIXTURE_M_RENT = 1_447_680;
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
const FROM_PERSONA = "solana-whale";
// Hardcoded literal anchor — pinned at Fixture M in
// `test/signing-fingerprint-solana.test.ts:221`. Drift in this tool's
// preimage assembly surfaces HERE, at this exact line.
const FIXTURE_M_FINGERPRINT =
  "0xf23e8e0041a47c94894797b2430b3814a3416670404e16da779564f435ecd809";
// Fixture M message-bytes length anchor (cross-link with
// signing-fingerprint-solana.test.ts:216).
const FIXTURE_M_MESSAGE_LEN = 296;

// A canonical PAIRED Solana account (real mode). Mirrors the shape
// `pair_solana_ledger` would persist.
const PAIRED_SOLANA_ACCOUNT = {
  chain: "solana" as const,
  address: SOLANA_WHALE_ADDR,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

function buildStubConnection(opts: {
  blockhash?: string;
  rentLamports?: number;
  throwOnGetLatestBlockhash?: Error;
} = {}): Connection {
  const {
    blockhash = FIXED_BLOCKHASH,
    rentLamports = FIXTURE_M_RENT,
    throwOnGetLatestBlockhash,
  } = opts;
  return {
    getMinimumBalanceForRentExemption: vi.fn(async (_size: number) => rentLamports),
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
  // Pin env to "false" so the resolver deterministically picks real-mode
  // regardless of host filesystem.
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

describe("prepare_solana_nonce_init — happy path (real mode + paired Solana account)", () => {
  it("returns { handle, fromPersona, noncePubkey, authority, rentLamports, recentBlockhash, payloadFingerprint, txType: 'solana' } with verbatim PREPARE RECEIPT", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_M_NONCE_PUBKEY,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      fromPersona: string;
      noncePubkey: string;
      authority: string;
      rentLamports: number;
      recentBlockhash: string;
      payloadFingerprint: string;
      txType: string;
      feePayer: string;
    };
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sc.fromPersona).toBe(FROM_PERSONA);
    expect(sc.noncePubkey).toBe(FIXTURE_M_NONCE_PUBKEY);
    // Authority is ALWAYS the paired wallet — NEVER a caller param.
    expect(sc.authority).toBe(SOLANA_WHALE_ADDR);
    expect(sc.feePayer).toBe(SOLANA_WHALE_ADDR);
    expect(sc.rentLamports).toBe(FIXTURE_M_RENT);
    expect(sc.recentBlockhash).toBe(FIXED_BLOCKHASH);
    expect(sc.txType).toBe("solana");

    // PREPARE RECEIPT body — substituted from the format-fanout-sentinel
    // const. Test imports the SAME template, asserts byte-identity.
    const expected = PREPARE_RECEIPT_SOLANA_NONCE_INIT_TEMPLATE
      .replace("{FROM_PERSONA}", FROM_PERSONA)
      .replace("{NONCE_PUBKEY}", FIXTURE_M_NONCE_PUBKEY)
      .replace("{AUTHORITY}", SOLANA_WHALE_ADDR)
      .replace("{RENT_LAMPORTS}", String(FIXTURE_M_RENT))
      .replace("{RECENT_BLOCKHASH}", FIXED_BLOCKHASH);
    expect(result.content[0]?.text ?? "").toBe(expected);
    // Verbatim invariant: raw agent args appear in the receipt.
    expect(result.content[0]?.text ?? "").toContain(FIXTURE_M_NONCE_PUBKEY);
    expect(result.content[0]?.text ?? "").toContain(FROM_PERSONA);

    // listAccounts consulted exactly once (real-mode pairing check).
    expect(listAccountsSpy).toHaveBeenCalledTimes(1);
    expect(listAccountsSpy).toHaveBeenCalledWith({ chainFilter: "solana" });
  });
});

describe("prepare_solana_nonce_init — happy path (demo mode + active Solana persona)", () => {
  it("succeeds with authority = solana-whale persona address; listAccounts NEVER called (demo-FIRST refusal contract)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersonaBySlug("solana-whale");
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_M_NONCE_PUBKEY,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      authority: string;
      feePayer: string;
      txType: string;
    };
    expect(sc.authority).toBe(SOLANA_WHALE_ADDR);
    expect(sc.feePayer).toBe(SOLANA_WHALE_ADDR);
    expect(sc.txType).toBe("solana");

    // listAccounts NEVER called in demo mode (no Solana pairing to consult).
    expect(listAccountsSpy).toHaveBeenCalledTimes(0);
    // createHandle IS called — the handle flows through preview + send.
    expect(createHandleSpy).toHaveBeenCalledTimes(1);
  });
});

describe("prepare_solana_nonce_init — Fixture M cross-link (PAYLOAD_FINGERPRINT_DRIFT regression)", () => {
  it("byte-identical fingerprint to the literal pinned in signing-fingerprint-solana.test.ts (FIXTURE_M_FINGERPRINT)", async () => {
    // If this assertion fails, drift is in `prepare_solana_nonce_init`
    // preimage assembly — check `_solanaSystem.buildNonceInitTx` instruction
    // ordering (createAccount THEN nonceInitialize) OR the rent / blockhash
    // resolution OR the handle-store widening.
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersonaBySlug("solana-whale");
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_M_NONCE_PUBKEY,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_M_FINGERPRINT);
  });

  it("Nit 3 — _solanaSystem.buildNonceInitTx reproduces the Fixture-M message bytes (wrapper bound to the literal)", async () => {
    // Bind the BUILDER WRAPPER (not a direct SystemProgram.* reconstruction)
    // to Fixture M: the same inputs the tool feeds the wrapper must produce
    // the pinned message-bytes length, and re-hashing those bytes must equal
    // the Fixture-M fingerprint literal.
    const { PublicKey } = await import("@solana/web3.js");
    const { computeSolanaPayloadFingerprint } = await import(
      "../src/signing/payload-fingerprint-solana.js"
    );
    const from = new PublicKey(SOLANA_WHALE_ADDR);
    const noncePk = new PublicKey(FIXTURE_M_NONCE_PUBKEY);
    const { messageBytes } = _solanaSystem.buildNonceInitTx({
      from,
      noncePubkey: noncePk,
      authorizedPubkey: from,
      lamports: BigInt(FIXTURE_M_RENT),
      recentBlockhash: FIXED_BLOCKHASH,
    });
    expect(messageBytes.length).toBe(FIXTURE_M_MESSAGE_LEN);
    expect(computeSolanaPayloadFingerprint({ messageBytes })).toBe(
      FIXTURE_M_FINGERPRINT,
    );
  });
});

describe("prepare_solana_nonce_init — self-collision refusal (noncePubkey === wallet address)", () => {
  it("refuses with INVALID_INPUT and mints NO handle when noncePubkey equals the paired wallet address (security property)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    // noncePubkey === the wallet address — a wallet cannot be its own nonce
    // account (createAccount would collide with the existing system account).
    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: SOLANA_WHALE_ADDR,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/must NOT equal/i);

    // SECURITY property: NO handle minted on the self-collision refusal.
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_nonce_init — BROADCAST_FAILED (RPC failure on getMinimumBalanceForRentExemption)", () => {
  it("refuses with BROADCAST_FAILED when the rent RPC throws; cause carries the upstream message; NO handle minted", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    // The tool calls the exported `getMinimumBalanceForRentExemption` directly
    // (not the connection), so spy at that boundary. The SolanaRpcError wraps
    // the cause with a "Solana RPC call failed: ..." prefix.
    vi.spyOn(solRpcClient, "getMinimumBalanceForRentExemption").mockRejectedValue(
      new solRpcClient.SolanaRpcError(new Error("rent RPC timeout")),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_M_NONCE_PUBKEY,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      cause?: string;
    };
    expect(sc.errorCode).toBe("BROADCAST_FAILED");
    expect(sc.cause).toMatch(/rent RPC timeout/);

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with BROADCAST_FAILED when getLatestBlockhash throws (after rent resolves); NO handle minted", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection({
        throwOnGetLatestBlockhash: new Error("blockhash RPC down"),
      }),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_M_NONCE_PUBKEY,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("BROADCAST_FAILED");
    expect(sc.cause).toBe("blockhash RPC down");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_nonce_init — WALLET_NOT_PAIRED refusal (real mode, zero accounts)", () => {
  it("refuses with WALLET_NOT_PAIRED when listAccounts returns empty array; createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_M_NONCE_PUBKEY,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(result.content[0]?.text ?? "").toMatch(/pair_solana_ledger/);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_nonce_init — WRONG_MODE refusal (demo mode + no Solana persona)", () => {
  it("refuses with WRONG_MODE when demo mode is on but no Solana persona is set; listAccounts NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting(); // ensure no persona active

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_M_NONCE_PUBKEY,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WRONG_MODE",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);
    expect(text).toMatch(/set_demo_wallet/);

    // Defense-in-depth: NEITHER downstream is touched in the WRONG_MODE branch.
    expect(listAccountsSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_nonce_init — INVALID_INPUT refusal (malformed noncePubkey)", () => {
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
    // Shape-validated BEFORE any state read — pairing never consulted.
    expect(listAccountsSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_nonce_init — handle round-trip (record shape + recentBlockhash pinning)", () => {
  it("record.args carries raw agent strings + pinned blockhash; record.tx is the Solana shape (txType: 'solana' + messageBytes); status === 'prepared'", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_M_NONCE_PUBKEY,
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
    expect(record.tx.programIds).toEqual(["11111111111111111111111111111111"]);
    expect(record.tx.messageBytes).toBeInstanceOf(Uint8Array);
    // Fixture M message-bytes length anchor.
    expect(record.tx.messageBytes.length).toBe(FIXTURE_M_MESSAGE_LEN);

    // args — RAW agent strings + pinned blockhash.
    expect(record.args.to).toBe(FIXTURE_M_NONCE_PUBKEY);
    expect(record.args.recentBlockhash).toBe(FIXED_BLOCKHASH);
  });

  it("recentBlockhash pinned on handle: structuredContent.recentBlockhash === record.args.recentBlockhash (preview MUST NOT re-fetch)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_M_NONCE_PUBKEY,
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

describe("prepare_solana_nonce_init — _solanaSystem indirection regression (build path)", () => {
  it("calls through `_solanaSystem.buildNonceInitTx` (ESM spy-affordance contract) with authority === feePayer === persona", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );
    const buildSpy = vi.spyOn(_solanaSystem, "buildNonceInitTx");

    const result = await callTool({
      fromPersona: FROM_PERSONA,
      noncePubkey: FIXTURE_M_NONCE_PUBKEY,
    });

    expect(result.isError).toBeFalsy();
    expect(buildSpy).toHaveBeenCalledTimes(1);
    const callArgs = buildSpy.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    if (!callArgs) return;
    // Authority === feePayer (`from`) === persona — NEVER a caller param.
    expect(callArgs.from.toBase58()).toBe(SOLANA_WHALE_ADDR);
    expect(callArgs.authorizedPubkey.toBase58()).toBe(SOLANA_WHALE_ADDR);
    expect(callArgs.noncePubkey.toBase58()).toBe(FIXTURE_M_NONCE_PUBKEY);
    expect(callArgs.lamports).toBe(BigInt(FIXTURE_M_RENT));
    expect(callArgs.recentBlockhash).toBe(FIXED_BLOCKHASH);
  });
});

describe("prepare_solana_nonce_init — register-all.ts wiring (smoke)", () => {
  it("prepare_solana_nonce_init is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_solana_nonce_init");
  });
});
