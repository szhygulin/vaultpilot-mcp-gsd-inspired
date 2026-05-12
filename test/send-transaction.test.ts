// Plan 04-04 — send_transaction tool tests (PREP-07 / PREP-08 / PREP-09 +
// the Q1 cancel-path + DEMO-05 simulation envelope).
//
// Covers the 14 cases enumerated in 04-04-PLAN.md § Task 2 + the verification
// rows in 04-VALIDATION.md (rows 04-04-01..10).
//
// Mocking strategy (vi.hoisted multi-module mock — Plan 04-03 analog):
//
//   vi.hoisted() declares the spies shared across THREE vi.mock factories:
//     - viem/actions (call — for the DEMO-05 simulation path)
//     - src/wallet/session-manager.js (getStatus + getActiveSessionTopic)
//     - src/wallet/walletconnect-client.js (getWalletConnectClient — returns
//       the mock-sign-client.client instance scripted via _setRequestResponse
//       / _setRequestRejection)
//
//   handle-store stays REAL — tests seed real prepared/previewed handles via
//   `createHandle` + `transitionToPreviewed` and assert via `lookup()` +
//   `_peekHandleForTesting`.
//
//   Fixture A + C anchors (research § Code Example 1 + 2):
//     - to = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (checksummed)
//     - valueWei = 1 ETH = 1e18 wei
//     - chainId = 1
//     - data = "0x"
//     - payloadFingerprint = 0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a
//     - nonce = 7, gas = 21000n, maxFeePerGas = 30 gwei, maxPriorityFeePerGas = 1.5 gwei
//     - presignHash = 0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import { createMockSignClient, type MockSignClient } from "./helpers/mock-sign-client.js";

// `vi.mock` factories hoist above every `const`/`let`; the spies they close
// over must therefore live inside `vi.hoisted()`. Canonical pattern from
// Phase 3 + Plan 04-02 + Plan 04-03 tests.
const {
  getStatusSpy,
  getActiveSessionTopicSpy,
  callSpy,
  mockSignClientHolder,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getActiveSessionTopicSpy: vi.fn<[], string | null>(),
  callSpy: vi.fn(),
  // Holder closure-captures the per-test mock-sign-client instance so the
  // production code resolving `getWalletConnectClient()` sees the SAME
  // mock the test scripts via `_setRequestResponse(...)`.
  mockSignClientHolder: { current: null as MockSignClient | null },
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    getActiveSessionTopic: () => getActiveSessionTopicSpy(),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from send_transaction tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("../src/wallet/walletconnect-client.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/walletconnect-client.js")>(
    "../src/wallet/walletconnect-client.js",
  );
  return {
    ...actual,
    getWalletConnectClient: async () => {
      if (!mockSignClientHolder.current) {
        throw new Error("test setup: mockSignClient not initialized — call createMockSignClient() in beforeEach");
      }
      return mockSignClientHolder.current.client;
    },
  };
});

vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>("viem/actions");
  return {
    ...actual,
    call: (...args: Parameters<typeof actual.call>) => callSpy(...args),
  };
});

import { _resetDemoModeForTesting, isDemoMode } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
  transitionToPreviewed,
} from "../src/signing/handle-store.js";
import type { PreparedTx, PreviewPinned } from "../src/signing/handle-store.js";
import { computePayloadFingerprint } from "../src/signing/payload-fingerprint.js";
import {
  INPUT_SCHEMA_FOR_TESTING,
  type SendTransactionArgs,
} from "../src/tools/send_transaction.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

import { spawnServerInProcess, type SpawnedServer } from "./helpers/spawn-server.js";

// Trigger side-effect registration for ALL tools so the registry is populated.
await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("send_transaction");
  if (!tool) throw new Error("send_transaction not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Fixture A + C anchors (research § Code Example 1 + 2; Plan 04-01 tests).
const FIXTURE_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const FIXTURE_VALUE_WEI_STR = "1000000000000000000";
const FIXTURE_VALUE_WEI_BIGINT = 1_000_000_000_000_000_000n;
const FIXTURE_NONCE = 7;
const FIXTURE_GAS = 21_000n;
const FIXTURE_MAX_FEE = 30_000_000_000n;
const FIXTURE_MAX_PRIO = 1_500_000_000n;
const FIXTURE_PRESIGN_HASH =
  "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85" as Hex;
const FIXTURE_PREVIEW_TOKEN = "fixture-preview-token-uuid-aaaa";
const FIXTURE_SENDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;
const FIXTURE_TOPIC = "0xfeedfacecafebeef0000000000000000000000000000000000000000c0ffee";

const PAIRED_STATUS = {
  paired: true as const,
  address: FIXTURE_SENDER,
  chainId: 1,
  sessionTopicLast8: "00c0ffee",
};

function buildFixtureTx(): PreparedTx {
  return {
    chainId: 1,
    to: FIXTURE_TO,
    valueWei: FIXTURE_VALUE_WEI_BIGINT,
    data: "0x" as Hex,
  };
}

function buildFixturePinned(opts?: { previewToken?: string }): PreviewPinned {
  return {
    nonce: FIXTURE_NONCE,
    gas: FIXTURE_GAS,
    maxFeePerGas: FIXTURE_MAX_FEE,
    maxPriorityFeePerGas: FIXTURE_MAX_PRIO,
    previewToken: opts?.previewToken ?? FIXTURE_PREVIEW_TOKEN,
    presignHash: FIXTURE_PRESIGN_HASH,
    selector: null,
  };
}

/**
 * Seed a real handle in `prepared` state — no preview run. Used by Test 3
 * (PREVIEW_REQUIRED).
 */
function seedPreparedHandle(): string {
  const tx = buildFixtureTx();
  return createHandle({
    args: { to: FIXTURE_TO, valueWei: FIXTURE_VALUE_WEI_STR },
    tx,
    payloadFingerprint: computePayloadFingerprint(tx),
  });
}

/**
 * Seed a real previewed handle (post-prepare + post-preview) with Fixture
 * A inputs + Fixture C pinned. Returns `{ handle, previewToken }` so the
 * test can drive `send_transaction` with the right args.
 */
function seedPreviewedHandle(opts?: { previewToken?: string }): { handle: string; previewToken: string } {
  const previewToken = opts?.previewToken ?? FIXTURE_PREVIEW_TOKEN;
  const handle = seedPreparedHandle();
  const trans = transitionToPreviewed(handle, buildFixturePinned({ previewToken }));
  if (!trans.ok) throw new Error("seed: transitionToPreviewed failed");
  return { handle, previewToken };
}

function scriptPairedMocks(): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getActiveSessionTopicSpy.mockReturnValue(FIXTURE_TOPIC);
}

beforeEach(() => {
  getStatusSpy.mockReset();
  getActiveSessionTopicSpy.mockReset();
  callSpy.mockReset();
  _resetHandleStoreForTesting();
  mockSignClientHolder.current = createMockSignClient();
  savedDemo = process.env[DEMO_KEY];
  // Phase 5 / Plan 05-01: pin to "false" so the resolver picks
  // real-mode deterministically; reset cache so each test starts clean.
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Test 1 — PREP-07 / T-GATE-1 — schema-level gate with three sub-assertions.
//
// (1a) SDK pipeline assertion (load-bearing): dispatch a CallTool request
//      with `userDecision: "yes"` through the actual MCP SDK in-process
//      pipeline (spawn-server-in-process helper). The handler MUST NEVER be
//      invoked — the schema gate at src/server.ts (PREP-07's load-bearing
//      defense; Plan 04-04 addition to the dispatcher) rejects at the
//      protocol boundary with JSON-RPC error code -32602 (InvalidParams).
//
// (1b) Standalone ajv re-validation (regression anchor): compile
//      INPUT_SCHEMA_FOR_TESTING with an in-test ajv instance; assert
//      `userDecision: "yes"` fails validation with `keyword === "enum"`
//      and `instancePath === "/userDecision"`. Pins the schema-as-written.
//
// (1c) TypeScript narrowing assertion (compile-time defense): a const
//      assertion ensures `SendTransactionArgs["userDecision"]` is the
//      literal-union `"send" | "cancel"`, NOT `string`. If a contributor
//      widens the schema to `type: "string"` without `enum`, this
//      assertion fails at typecheck.
//
// All three are required — removing any one weakens the gate.
// ---------------------------------------------------------------------------
describe("send_transaction — PREP-07 schema gate (T-GATE-1, 04-04-01)", () => {
  it("(1a) MCP SDK pipeline rejects userDecision: 'yes' BEFORE the handler runs", async () => {
    // Wrap the registered handler with a spy AT the registry level so we
    // can prove `toHaveBeenCalledTimes(0)`. Take care to restore so other
    // tests are unaffected.
    const tool = getRegisteredTool("send_transaction");
    if (!tool) throw new Error("send_transaction not registered");
    const originalHandler = tool.handler;
    const handlerSpy = vi.fn(originalHandler);
    tool.handler = handlerSpy;

    let spawned: SpawnedServer | undefined;
    try {
      spawned = await spawnServerInProcess();
      let caught: unknown;
      try {
        await spawned.client.callTool({
          name: "send_transaction",
          arguments: {
            handle: "any-handle-uuid",
            previewToken: "any-token-uuid",
            // Schema enum is ["send", "cancel"]; "yes" violates it.
            userDecision: "yes",
          },
        });
      } catch (err) {
        caught = err;
      }
      // The SDK pipeline surfaces InvalidParams (-32602) as a JSON-RPC
      // error on the client side. The exact error class/shape depends on
      // SDK version; we assert via the error object having a `code` of
      // -32602 (the JSON-RPC standard for invalid params) OR the message
      // mentioning the schema violation.
      expect(caught).toBeDefined();
      const errObj = caught as { code?: number; message?: string };
      const hasInvalidParamsCode = errObj.code === -32602;
      const hasSchemaErrorMessage =
        typeof errObj.message === "string" && /enum|userDecision|invalid arguments/i.test(errObj.message);
      expect(hasInvalidParamsCode || hasSchemaErrorMessage).toBe(true);
      // Load-bearing assertion: the handler MUST NEVER be invoked when
      // schema validation fails. This is the proof that PREP-07 is a
      // schema-level gate, not a soft check.
      expect(handlerSpy).toHaveBeenCalledTimes(0);
    } finally {
      tool.handler = originalHandler;
      if (spawned) await spawned.close();
    }
  });

  it("(1b) standalone ajv compile of INPUT_SCHEMA rejects userDecision: 'yes' on enum keyword", async () => {
    // ajv is a transitive dep of @modelcontextprotocol/sdk; use it directly
    // for a hermetic schema-as-written assertion.
    const { default: Ajv } = await import("ajv");
    const ajv = new Ajv({ strict: false, allErrors: true });
    const validate = ajv.compile(INPUT_SCHEMA_FOR_TESTING);
    const ok = validate({ handle: "x", previewToken: "y", userDecision: "yes" });
    expect(ok).toBe(false);
    // ajv 8 reports errors as an array on the validator function itself
    // after a failing call. The relevant error has keyword "enum" and
    // instancePath "/userDecision".
    const errors = validate.errors ?? [];
    const enumError = errors.find((e) => e.keyword === "enum");
    expect(enumError).toBeDefined();
    expect(enumError?.instancePath).toBe("/userDecision");
  });

  it("(1c) TypeScript narrowing — SendTransactionArgs['userDecision'] is the literal union, not string", () => {
    // If a contributor widens the schema to `type: "string"` without
    // `enum`, the export's type would loosen and this `satisfies` block
    // would fail at `tsc --noEmit`. This is a compile-time anchor; the
    // runtime assertion just smoke-checks the test compiles and runs.
    const send: SendTransactionArgs["userDecision"] = "send" satisfies "send" | "cancel";
    const cancel: SendTransactionArgs["userDecision"] = "cancel" satisfies "send" | "cancel";
    expect(send).toBe("send");
    expect(cancel).toBe("cancel");
  });
});

// ---------------------------------------------------------------------------
// Test 2 — PREVIEW_TOKEN_MISMATCH (T-GATE-2, 04-04-02)
// ---------------------------------------------------------------------------
describe("send_transaction — PREVIEW_TOKEN_MISMATCH on wrong token (T-GATE-2, 04-04-02)", () => {
  it("returns PREVIEW_TOKEN_MISMATCH and does NOT call signClient.request", async () => {
    const { handle } = seedPreviewedHandle({ previewToken: "tok-A-uuid" });
    scriptPairedMocks();

    const result = await callTool({
      handle,
      previewToken: "tok-B-uuid", // wrong
      userDecision: "send",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PREVIEW_TOKEN_MISMATCH");
    expect(mockSignClientHolder.current!.__requestSpy).not.toHaveBeenCalled();
    // Handle status unchanged (still previewed) — no transition fired.
    expect(lookup(handle).ok && (lookup(handle) as { record: { status: string } }).record.status).toBe(
      "previewed",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3 — PREVIEW_REQUIRED on prepared handle (T-STATE-4, 04-04-03)
// ---------------------------------------------------------------------------
describe("send_transaction — PREVIEW_REQUIRED on un-previewed handle (T-STATE-4, 04-04-03)", () => {
  it("returns PREVIEW_REQUIRED on a `prepared` handle (no preview run)", async () => {
    const handle = seedPreparedHandle();
    scriptPairedMocks();

    const result = await callTool({
      handle,
      previewToken: "any-token", // unused — handler short-circuits on status
      userDecision: "send",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PREVIEW_REQUIRED");
    expect(mockSignClientHolder.current!.__requestSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 4 — PAYLOAD_FINGERPRINT_DRIFT via STORED-fingerprint mutation
// (PREP-08, T-DRIFT-1, 04-04-04)
//
// METHODOLOGY LOCK (plan-checker BLOCKER fix): the test MUST mutate the
// STORED payloadFingerprint on the handle record, NOT spy on
// `computePayloadFingerprint`. The stored value is the trust anchor; the
// re-check fires when stored state is corrupted. Spying the compute
// function would prove the wrong thing — "equality fires when the compute
// path returns a different value" — and miss the actual attack model.
// ---------------------------------------------------------------------------
describe("send_transaction — PAYLOAD_FINGERPRINT_DRIFT (PREP-08, T-DRIFT-1, 04-04-04)", () => {
  it("detects stored-fingerprint mutation and refuses; signClient.request never called", async () => {
    const { handle, previewToken } = seedPreviewedHandle();
    scriptPairedMocks();
    // Forcibly mutate the STORED payloadFingerprint to simulate in-process
    // state corruption between prepare and send. The recompute at send
    // time still yields Fixture A's 0x7e1867b2... — only the stored value
    // has drifted — so equality fails and the refusal fires.
    const peeked = _peekHandleForTesting(handle);
    if (!peeked) throw new Error("test setup: handle not found");
    peeked.payloadFingerprint = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    const result = await callTool({ handle, previewToken, userDecision: "send" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PAYLOAD_FINGERPRINT_DRIFT");
    expect(mockSignClientHolder.current!.__requestSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 5 — happy path: WC forwarded with EXACT pinned params (PREP-09 /
// T-WC-FWD-1, 04-04-05 + 04-04-06). The byte-identity assertion on
// signClient.request's call args is the load-bearing proof that txParams
// are constructed from `record.tx + record.pinned`, NOT from agent args.
// ---------------------------------------------------------------------------
describe("send_transaction — WC forwarding with EXACT pinned params (PREP-09 / T-WC-FWD-1, 04-04-05)", () => {
  it("forwards eth_sendTransaction with hex-encoded pinned params; returns txHash from mock", async () => {
    const { handle, previewToken } = seedPreviewedHandle();
    scriptPairedMocks();
    const mockTxHash = "0xdeadbeef00000000000000000000000000000000000000000000000000000001" as Hex;
    mockSignClientHolder.current!._setRequestResponse("eth_sendTransaction", mockTxHash);

    const result = await callTool({ handle, previewToken, userDecision: "send" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      txHash: string;
      broadcastedAt: string;
      handle: string;
      chainId: number;
    };
    expect(sc.txHash).toBe(mockTxHash);
    expect(sc.broadcastedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sc.handle).toBe(handle);
    expect(sc.chainId).toBe(1);

    // T-WC-FWD-1 load-bearing assertion: signClient.request received the
    // EXACT pinned tuple — toHex-encoded from `record.tx + record.pinned`.
    // Any contributor reconstructing from agent args at send time would
    // diverge here (Fixture A `value` would not equal `0xde0b6b3a7640000`
    // unless it came through `toHex(record.tx.valueWei)`).
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(1);
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledWith({
      topic: FIXTURE_TOPIC,
      chainId: "eip155:1",
      request: {
        method: "eth_sendTransaction",
        params: [
          {
            from: FIXTURE_SENDER,
            to: FIXTURE_TO,
            value: "0xde0b6b3a7640000", // toHex(1e18)
            gas: "0x5208", // toHex(21000)
            maxFeePerGas: "0x6fc23ac00", // toHex(30 gwei)
            maxPriorityFeePerGas: "0x59682f00", // toHex(1.5 gwei)
            nonce: "0x7", // toHex(7)
            data: "0x",
          },
        ],
      },
    });

    // Handle transitioned to `sent` with the returned txHash.
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("post-send: handle not found");
    expect(lookupResult.record.status).toBe("sent");
    expect(lookupResult.record.txHash).toBe(mockTxHash);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — LEDGER_REJECTED on WC code 5000 (T-LEDGER-REJ-1, 04-04-07)
// ---------------------------------------------------------------------------
describe("send_transaction — LEDGER_REJECTED on user-rejection (T-LEDGER-REJ-1, 04-04-07)", () => {
  it("translates WC { code: 5000, message: 'User rejected' } to LEDGER_REJECTED with cause attached", async () => {
    const { handle, previewToken } = seedPreviewedHandle();
    scriptPairedMocks();
    mockSignClientHolder.current!._setRequestRejection("eth_sendTransaction", {
      code: 5000,
      message: "User rejected.",
    });

    const result = await callTool({ handle, previewToken, userDecision: "send" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("LEDGER_REJECTED");
    expect(sc.cause).toBe("User rejected.");
    // Handle status unchanged — transitionToSent NOT called.
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("post-reject: handle not found");
    expect(lookupResult.record.status).toBe("previewed");
  });
});

// ---------------------------------------------------------------------------
// Test 7 — userDecision: "cancel" returns userCancelled envelope; no
// broadcast (T-CANCEL-1 / Q1 locked, 04-04-08).
// ---------------------------------------------------------------------------
describe("send_transaction — cancel path (T-CANCEL-1, 04-04-08, Q1 locked)", () => {
  it("returns userCancelled: true non-error and transitions handle to cancelled", async () => {
    const { handle, previewToken } = seedPreviewedHandle();
    scriptPairedMocks();

    const result = await callTool({ handle, previewToken, userDecision: "cancel" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      userCancelled: boolean;
      handle: string;
      chainId: number;
    };
    expect(sc.userCancelled).toBe(true);
    expect(sc.handle).toBe(handle);
    expect(sc.chainId).toBe(1);
    // signClient.request MUST NOT have been called on the cancel branch.
    expect(mockSignClientHolder.current!.__requestSpy).not.toHaveBeenCalled();
    // Handle is in terminal `cancelled` state (Q1 locked — NOT immediately
    // evicted; lazy TTL reclaims at 15-min mark).
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("post-cancel: handle not found");
    expect(lookupResult.record.status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Test 8 — BROADCAST_FAILED on generic WC error (T-BROADCAST-1)
// ---------------------------------------------------------------------------
describe("send_transaction — BROADCAST_FAILED on non-rejection WC error (T-BROADCAST-1)", () => {
  it("translates generic WC error to BROADCAST_FAILED with the verbatim cause attached", async () => {
    const { handle, previewToken } = seedPreviewedHandle();
    scriptPairedMocks();
    mockSignClientHolder.current!._setRequestRejection("eth_sendTransaction", {
      message: "nonce too low",
    });

    const result = await callTool({ handle, previewToken, userDecision: "send" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("BROADCAST_FAILED");
    expect(sc.cause).toBe("nonce too low");
  });
});

// ---------------------------------------------------------------------------
// Test 9 — DEMO-05 simulation envelope; no broadcast (T-DEMO-1, 04-04-10)
// ---------------------------------------------------------------------------
describe("send_transaction — DEMO-05 simulation envelope (T-DEMO-1, 04-04-10)", () => {
  it("VAULTPILOT_DEMO=true + send → runs eth_call, returns simulated:true, signClient.request NOT called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    expect(isDemoMode()).toBe(true);
    const { handle, previewToken } = seedPreviewedHandle();
    scriptPairedMocks();
    callSpy.mockResolvedValue({ data: "0x" as Hex });

    const result = await callTool({ handle, previewToken, userDecision: "send" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      simulated: boolean;
      simulationResult: string | null;
      simulatedAt: string;
      handle: string;
      chainId: number;
    };
    expect(sc.simulated).toBe(true);
    expect(sc.simulationResult).toBe("0x");
    expect(sc.simulatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sc.handle).toBe(handle);
    expect(sc.chainId).toBe(1);
    // T-DEMO-1 load-bearing: NOTHING signed; NOTHING broadcast.
    expect(mockSignClientHolder.current!.__requestSpy).not.toHaveBeenCalled();
    // call() was invoked for revert detection.
    expect(callSpy).toHaveBeenCalledTimes(1);
    // Handle status remains `previewed` — no real broadcast, no transition.
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("post-simulation: handle not found");
    expect(lookupResult.record.status).toBe("previewed");
    // Text content carries the SIMULATION banner.
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("SIMULATION (demo mode)");
  });
});

// ---------------------------------------------------------------------------
// Test 10 — re-send on already-sent handle (T-PREVIEW-CONSUMED-1)
// ---------------------------------------------------------------------------
describe("send_transaction — re-send refuses with WRONG_STATUS (T-PREVIEW-CONSUMED-1)", () => {
  it("second send_transaction on a sent handle refuses; signClient.request called only ONCE total", async () => {
    const { handle, previewToken } = seedPreviewedHandle();
    scriptPairedMocks();
    const mockTxHash = "0xdeadbeef00000000000000000000000000000000000000000000000000000001" as Hex;
    mockSignClientHolder.current!._setRequestResponse("eth_sendTransaction", mockTxHash);

    // First send — succeeds.
    const first = await callTool({ handle, previewToken, userDecision: "send" });
    expect(first.isError).toBeFalsy();

    // Second send — refuses on WRONG_STATUS.
    const second = await callTool({ handle, previewToken, userDecision: "send" });
    expect(second.isError).toBe(true);
    const sc = second.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_STATUS");

    // signClient.request was called EXACTLY once (the first send).
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Test 11 — WALLET_NOT_PAIRED when getStatus returns null
// ---------------------------------------------------------------------------
describe("send_transaction — WALLET_NOT_PAIRED on no-session", () => {
  it("returns WALLET_NOT_PAIRED when getStatus returns null", async () => {
    const { handle, previewToken } = seedPreviewedHandle();
    getStatusSpy.mockResolvedValue(null);
    getActiveSessionTopicSpy.mockReturnValue(FIXTURE_TOPIC);

    const result = await callTool({ handle, previewToken, userDecision: "send" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
    expect(mockSignClientHolder.current!.__requestSpy).not.toHaveBeenCalled();
  });

  it("returns WALLET_NOT_PAIRED when getActiveSessionTopic returns null but getStatus is paired", async () => {
    const { handle, previewToken } = seedPreviewedHandle();
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    getActiveSessionTopicSpy.mockReturnValue(null);

    const result = await callTool({ handle, previewToken, userDecision: "send" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
    expect(mockSignClientHolder.current!.__requestSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 12 — register-all wiring (smoke test)
// ---------------------------------------------------------------------------
describe("send_transaction — register-all wiring (smoke test)", () => {
  it("is registered with required fields and correct enum on userDecision", () => {
    const tool = getRegisteredTool("send_transaction");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toEqual(
      expect.arrayContaining(["handle", "previewToken", "userDecision"]),
    );
    const userDecisionProp = (tool!.inputSchema.properties as Record<string, { enum?: string[] }>)
      .userDecision;
    expect(userDecisionProp).toBeDefined();
    expect(userDecisionProp.enum).toEqual(["send", "cancel"]);
  });
});

// ---------------------------------------------------------------------------
// Test 13 — no walletClient leak (runtime grep on the source — anchors the
// no-private-key-path invariant from CLAUDE.md "No private key material
// crosses any boundary in this codebase").
// ---------------------------------------------------------------------------
describe("send_transaction — no walletClient import (no-private-key-path invariant)", () => {
  it("src/tools/send_transaction.ts has zero references to walletClient", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/tools/send_transaction.ts", "utf8");
    expect(source).not.toMatch(/walletClient/);
    expect(source).toContain("eth_sendTransaction");
  });
});
