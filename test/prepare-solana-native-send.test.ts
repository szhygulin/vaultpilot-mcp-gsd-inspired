// `prepare_solana_native_send` end-to-end regression. Phase 12 — Plan 12-02.
//
// Mirror of `test/prepare-native-send.test.ts` (Phase 4 / Plan 04-02 — EVM
// native send) shape. Solana-side load-bearing invariants:
//
//   1. **Demo-mode FIRST refusal** — `getActiveSolanaPersona()` consulted
//      BEFORE `listAccounts`. Demo-on + no Solana persona → `WRONG_MODE`;
//      `listAccounts` NEVER called.
//   2. **PREPARE RECEIPT verbatim** (PREP-02) — receipt body carries the
//      agent's raw `to` + `lamports` strings (no base58 normalization, no
//      decimal scaling).
//   3. **payloadFingerprint Fixture K cross-link** — the canonical Fixture K
//      inputs (solana-whale persona + canonical recipient + 1 SOL +
//      fixed-blockhash sentinel) produce the hardcoded literal
//      `0x7c3d1fbc...` pinned in `test/signing-fingerprint-solana.test.ts`.
//      Drift in preimage assembly fails at that exact line — cross-linked
//      regression.
//
// Mocks:
//   - `_solanaRegistry.getConnection()` returns a stub `Connection` whose
//     `getLatestBlockhash` is `vi.fn`. Sealed blockhash sentinel for the
//     Fixture K cross-link assertion.
//   - `non-evm-account-store.listAccounts` mocked to control real-mode
//     pairing state.
//   - `getActiveSolanaPersona()` controlled via the Solana persona registry's
//     `setActiveSolanaPersona` (Phase 11 / Plan 11-06).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy, createHandleSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  createHandleSpy:
    vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

// Mock the non-evm-account-store's `listAccounts` (the Solana pairing
// surface). Other exports stay real — `eagerInitNonEvmStoreIfPersist` etc.
// are transitively imported via `register-all.js`.
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

// Mock the handle-store's `createHandle` as a spy that delegates to the
// real implementation. `lookup`, `_resetHandleStoreForTesting`,
// `_peekHandleForTesting`, etc. stay real so tests can both (a) assert
// `createHandle.mock.calls` AND (b) read the stored record back.
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
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveSolanaPersonaBySlug,
} from "../src/demo/state.js";
import { PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE } from "../src/signing/blocks-solana.js";
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
  const tool = getRegisteredTool("prepare_solana_native_send");
  if (!tool) throw new Error("prepare_solana_native_send not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Canonical Fixture K inputs — must match
// `test/signing-fingerprint-solana.test.ts` line-for-line. The cross-link
// assertion below pins the produced `payloadFingerprint` to the literal.
const SOLANA_WHALE_ADDR = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const FIXTURE_K_TO = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
const FIXTURE_K_LAMPORTS = "1000000000";
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
// Hardcoded literal anchor — pinned at `test/signing-fingerprint-solana.test.ts:95`.
// Drift in this tool's preimage assembly surfaces HERE, at this exact line.
const FIXTURE_K_FINGERPRINT =
  "0x7c3d1fbcea9a6823b6e1bbb76b45ec68cd4998f25727d3bfb7b17a389040d0d3";

// A canonical PAIRED Solana account (real mode). Mirrors the shape
// `pair_solana_ledger` would persist.
const PAIRED_SOLANA_ACCOUNT = {
  chain: "solana" as const,
  address: SOLANA_WHALE_ADDR,
  derivationPath: "44'/501'/0'",
  pairedAt: new Date().toISOString(),
};

function buildStubConnection(blockhash: string = FIXED_BLOCKHASH): Connection {
  return {
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash,
      lastValidBlockHeight: 100_000_000,
    }),
  } as unknown as Connection;
}

beforeEach(async () => {
  listAccountsSpy.mockReset();
  createHandleSpy.mockClear();
  // Re-install the delegating implementation so each test's createHandle
  // call still routes through to the real store (vi.restoreAllMocks at
  // module-load drops the factory-time mockImplementation). Mirrors the
  // pattern from `prepare-native-send.test.ts` (no restoreAllMocks in
  // beforeEach), tightened here to be explicit.
  const realHandleStore = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(realHandleStore.createHandle);
  _resetHandleStoreForTesting();
  savedDemo = process.env[DEMO_KEY];
  // Pin env to "false" so the resolver deterministically picks real-mode
  // regardless of host filesystem (auto-demo would otherwise fire when
  // ~/.vaultpilot-mcp/config.json is absent).
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  // Restore spies set via `vi.spyOn` in individual tests (does NOT affect
  // the factory-installed mocks because those use `vi.mock` not `vi.spyOn`).
  vi.restoreAllMocks();
});

describe("prepare_solana_native_send — happy path (real mode + paired Solana account)", () => {
  it("returns { handle, to, lamports, recentBlockhash, payloadFingerprint, txType: 'solana' } with PREPARE RECEIPT body", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      to: FIXTURE_K_TO,
      lamports: FIXTURE_K_LAMPORTS,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      to: string;
      lamports: string;
      recentBlockhash: string;
      payloadFingerprint: string;
      txType: string;
      feePayer: string;
    };
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sc.to).toBe(FIXTURE_K_TO);
    expect(sc.lamports).toBe(FIXTURE_K_LAMPORTS);
    expect(sc.recentBlockhash).toBe(FIXED_BLOCKHASH);
    expect(sc.txType).toBe("solana");
    expect(sc.feePayer).toBe(SOLANA_WHALE_ADDR);

    // PREPARE RECEIPT body — substituted from the format-fanout-sentinel
    // const. Test imports the SAME template, asserts byte-identity.
    const expected = PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE
      .replace("{TO}", FIXTURE_K_TO)
      .replace("{LAMPORTS}", FIXTURE_K_LAMPORTS)
      .replace("{RECENT_BLOCKHASH}", FIXED_BLOCKHASH);
    expect(result.content[0]?.text ?? "").toBe(expected);
    // listAccounts was consulted exactly once (real-mode pairing check).
    expect(listAccountsSpy).toHaveBeenCalledTimes(1);
    expect(listAccountsSpy).toHaveBeenCalledWith({ chainFilter: "solana" });
  });
});

describe("prepare_solana_native_send — happy path (demo mode + active Solana persona)", () => {
  it("succeeds with feePayer = solana-whale persona address; listAccounts NEVER called (demo-FIRST refusal contract)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersonaBySlug("solana-whale");
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      to: FIXTURE_K_TO,
      lamports: FIXTURE_K_LAMPORTS,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      feePayer: string;
      txType: string;
      payloadFingerprint: string;
    };
    expect(sc.feePayer).toBe(SOLANA_WHALE_ADDR);
    expect(sc.txType).toBe("solana");

    // T-DEMO-1 sibling: listAccounts NEVER called in demo mode (no Solana
    // pairing to consult). Defense against accidentally consulting the
    // persistent store in a demo session.
    expect(listAccountsSpy).toHaveBeenCalledTimes(0);
    // createHandle IS called — the handle flows through preview + send
    // simulation just like real mode (Plan 12-05 Solana branch).
    expect(createHandleSpy).toHaveBeenCalledTimes(1);
  });
});

describe("prepare_solana_native_send — Fixture K cross-link (PAYLOAD_FINGERPRINT_DRIFT regression)", () => {
  it("byte-identical fingerprint to the literal pinned in signing-fingerprint-solana.test.ts (FIXTURE_K_FINGERPRINT)", async () => {
    // If this assertion fails, drift is in `prepare_solana_native_send`
    // preimage assembly — check `buildSolanaTransferTx` instruction
    // ordering OR handle-store widening OR the agent's raw-arg pass-through.
    // The integration test (Plan 12-05) will re-anchor this same byte-
    // identity end-to-end across persona swaps.
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersonaBySlug("solana-whale");
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      to: FIXTURE_K_TO,
      lamports: FIXTURE_K_LAMPORTS,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_K_FINGERPRINT);
  });
});

describe("prepare_solana_native_send — WALLET_NOT_PAIRED refusal (real mode, zero accounts)", () => {
  it("refuses with WALLET_NOT_PAIRED when listAccounts returns empty array; createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({
      to: FIXTURE_K_TO,
      lamports: FIXTURE_K_LAMPORTS,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(result.content[0]?.text ?? "").toMatch(/pair_solana_ledger/);

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_native_send — WRONG_MODE refusal (demo mode + no Solana persona)", () => {
  it("refuses with WRONG_MODE when demo mode is on but no Solana persona is set; listAccounts NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting(); // ensure no persona active

    const result = await callTool({
      to: FIXTURE_K_TO,
      lamports: FIXTURE_K_LAMPORTS,
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

describe("prepare_solana_native_send — INVALID_INPUT refusals", () => {
  it("refuses with INVALID_INPUT for malformed `to` (not base58); createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);

    const result = await callTool({
      to: "not-base58!!",
      lamports: FIXTURE_K_LAMPORTS,
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/to|address/i);
    expect(text).toContain("not-base58!!");

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT for fractional lamports `\"1.5\"` (off-by-decimal guard); createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      to: FIXTURE_K_TO,
      lamports: "1.5",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/lamports/i);

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT for empty lamports `\"\"`; createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      to: FIXTURE_K_TO,
      lamports: "",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      cause?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    // cause field carries the kind discriminator from InvalidAmountError.
    expect(sc.cause).toBe("empty");

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT for negative lamports `\"-1\"`; createHandle NEVER called", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      to: FIXTURE_K_TO,
      lamports: "-1",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_native_send — BROADCAST_FAILED (RPC failure on getLatestBlockhash)", () => {
  it("refuses with BROADCAST_FAILED when getLatestBlockhash throws; cause field carries upstream error message", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    const stub = {
      getLatestBlockhash: vi
        .fn()
        .mockRejectedValue(new Error("RPC timeout")),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stub);

    const result = await callTool({
      to: FIXTURE_K_TO,
      lamports: FIXTURE_K_LAMPORTS,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      cause?: string;
    };
    expect(sc.errorCode).toBe("BROADCAST_FAILED");
    expect(sc.cause).toBe("RPC timeout");

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_solana_native_send — PREPARE RECEIPT verbatim invariant (PREP-02 + T-PREP-RCPT-1 sibling)", () => {
  it("substitutes PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE byte-for-byte from raw agent strings (no base58 normalization)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      to: FIXTURE_K_TO,
      lamports: FIXTURE_K_LAMPORTS,
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    // Format-fanout sentinel: prod + test reference the SAME const + the
    // SAME substitution shape. Re-declaring the multi-line string here
    // would violate the format-fanout-regex-sync invariant.
    const expected = PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE
      .replace("{TO}", FIXTURE_K_TO)
      .replace("{LAMPORTS}", FIXTURE_K_LAMPORTS)
      .replace("{RECENT_BLOCKHASH}", FIXED_BLOCKHASH);
    expect(text).toBe(expected);

    // Verbatim invariant: agent's raw `to` is in the receipt. A
    // hypothetical `new PublicKey(to).toBase58()` substitution would
    // still produce the same base58 string for valid input (PublicKey
    // normalizes capitalization-stable base58); the type-system guard
    // (`PrepareArgs.to: string` not `PublicKey`) prevents that drift at
    // the storage boundary, not the receipt substitution.
    expect(text).toContain(FIXTURE_K_TO);
    expect(text).toContain(FIXTURE_K_LAMPORTS);
    expect(text).toContain(FIXED_BLOCKHASH);
  });
});

describe("prepare_solana_native_send — handle round-trip (record shape + recentBlockhash pinning)", () => {
  it("record.args carries raw agent strings + pinned blockhash; record.tx is the Solana shape (txType: 'solana' + messageBytes); status === 'prepared'", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      to: FIXTURE_K_TO,
      lamports: FIXTURE_K_LAMPORTS,
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
    // Fixture K message-bytes length anchor (cross-link with
    // signing-fingerprint-solana.test.ts:83).
    expect(record.tx.messageBytes.length).toBe(150);

    // args — RAW agent strings + pinned blockhash. `PrepareArgs` typing
    // (`string`, not `PublicKey` / `bigint`) is the structural guard against
    // future normalization at the storage boundary.
    expect(record.args.to).toBe(FIXTURE_K_TO);
    expect(record.args.lamports).toBe(FIXTURE_K_LAMPORTS);
    expect(record.args.recentBlockhash).toBe(FIXED_BLOCKHASH);
  });

  it("recentBlockhash pinned on handle: structuredContent.recentBlockhash === record.args.recentBlockhash (preview MUST NOT re-fetch)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(
      buildStubConnection(),
    );

    const result = await callTool({
      to: FIXTURE_K_TO,
      lamports: FIXTURE_K_LAMPORTS,
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

describe("prepare_solana_native_send — register-all.ts wiring (smoke)", () => {
  it("prepare_solana_native_send is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_solana_native_send");
  });
});

describe("prepare_solana_native_send — errorCode envelope set (no new codes introduced)", () => {
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
    const r1 = await callTool({ to: FIXTURE_K_TO, lamports: FIXTURE_K_LAMPORTS });
    expect(ALLOWED.has((r1.structuredContent as { errorCode: string }).errorCode))
      .toBe(true);

    // WRONG_MODE arm.
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();
    const r2 = await callTool({ to: FIXTURE_K_TO, lamports: FIXTURE_K_LAMPORTS });
    expect(ALLOWED.has((r2.structuredContent as { errorCode: string }).errorCode))
      .toBe(true);

    // INVALID_INPUT arm (bad `to`).
    process.env[DEMO_KEY] = "false";
    _resetDemoModeForTesting();
    listAccountsSpy.mockReturnValue([PAIRED_SOLANA_ACCOUNT]);
    const r3 = await callTool({ to: "garbage!!", lamports: FIXTURE_K_LAMPORTS });
    expect(ALLOWED.has((r3.structuredContent as { errorCode: string }).errorCode))
      .toBe(true);

    // BROADCAST_FAILED arm.
    const stub = {
      getLatestBlockhash: vi
        .fn()
        .mockRejectedValue(new Error("rpc down")),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stub);
    const r4 = await callTool({ to: FIXTURE_K_TO, lamports: FIXTURE_K_LAMPORTS });
    expect(ALLOWED.has((r4.structuredContent as { errorCode: string }).errorCode))
      .toBe(true);
  });
});
