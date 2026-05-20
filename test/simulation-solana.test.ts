// Pure-fn tests for `src/signing/simulation-solana.ts` — the DF-4 LOCKED
// Solana simulation classifier. Phase 12 — Plan 12-01.
//
// Mocking strategy: build a minimal `Connection` stub whose
// `simulateTransaction` is a `vi.fn()`. The classifier only reads
// `response.value.err`, `.logs`, and `.unitsConsumed` — the stub honors
// the same shape the real SDK returns.
//
// NEVER-THROWS invariant asserted on every case (mirrors the EVM
// `simulation.ts:16-19` TRUST-BOUNDARY INVARIANT). The classifier returns
// a status; Plan 12-04's preview_send Solana branch enforces the refusal
// posture per DF-4 (any non-ok promotes to SIMULATION_REFUSED).

import type { Connection, Transaction } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  _simulationSolana,
  runSolanaPreviewSimulation,
} from "../src/signing/simulation-solana.js";

function makeFakeConnection(
  simulateImpl: (tx: Transaction) => unknown,
): Connection {
  // Connection has many fields the classifier never reads — cast to satisfy
  // the static type without instantiating the full SDK class.
  return {
    simulateTransaction: vi.fn(simulateImpl),
  } as unknown as Connection;
}

// Minimal Transaction stub — the classifier passes it through to
// `simulateTransaction` verbatim and does not inspect its shape.
const FAKE_TX = {} as Transaction;

describe("runSolanaPreviewSimulation — status: ok (DF-4 happy path)", () => {
  it("returns ok when value.err === null; forwards logs + unitsConsumed verbatim", async () => {
    const connection = makeFakeConnection(() => ({
      value: {
        err: null,
        logs: [
          "Program 11111111111111111111111111111111 invoke [1]",
          "Program 11111111111111111111111111111111 success",
        ],
        unitsConsumed: 12345,
      },
    }));

    const result = await runSolanaPreviewSimulation({ connection, transaction: FAKE_TX });

    expect(result.status).toBe("ok");
    expect(result.err).toBeNull();
    expect(result.logs).toEqual([
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program 11111111111111111111111111111111 success",
    ]);
    expect(result.unitsConsumed).toBe(12345);
    expect(result.rpcError).toBeUndefined();
  });
});

describe("runSolanaPreviewSimulation — status: program-error (DF-4 refuse path)", () => {
  it("returns program-error when value.err is a generic object shape", async () => {
    const connection = makeFakeConnection(() => ({
      value: {
        err: { InstructionError: [0, "Custom"] },
        logs: ["Program 11... invoke [1]", "Program 11... failed: custom program error: 0x1"],
        unitsConsumed: 999,
      },
    }));

    const result = await runSolanaPreviewSimulation({ connection, transaction: FAKE_TX });

    expect(result.status).toBe("program-error");
    // err is stringified via JSON.stringify for object shapes.
    expect(result.err).toBe('{"InstructionError":[0,"Custom"]}');
    expect(result.logs).toEqual([
      "Program 11... invoke [1]",
      "Program 11... failed: custom program error: 0x1",
    ]);
    expect(result.unitsConsumed).toBe(999);
  });
});

describe("runSolanaPreviewSimulation — status: insufficient-lamports (DF-4 refuse path)", () => {
  it("returns insufficient-lamports when value.err contains 'InsufficientFundsForRent'", async () => {
    const connection = makeFakeConnection(() => ({
      value: {
        err: "InsufficientFundsForRent",
        logs: [],
        unitsConsumed: 0,
      },
    }));

    const result = await runSolanaPreviewSimulation({ connection, transaction: FAKE_TX });

    expect(result.status).toBe("insufficient-lamports");
    expect(result.err).toBe("InsufficientFundsForRent");
    expect(result.logs).toEqual([]);
    expect(result.unitsConsumed).toBe(0);
  });

  it("also matches the lowercase 'insufficient lamports' substring (lender-underfunding shape)", async () => {
    const connection = makeFakeConnection(() => ({
      value: {
        err: { TransactionError: "insufficient lamports for transaction" },
        logs: ["Program failed"],
        unitsConsumed: 100,
      },
    }));

    const result = await runSolanaPreviewSimulation({ connection, transaction: FAKE_TX });

    expect(result.status).toBe("insufficient-lamports");
    expect(result.err).toContain("insufficient lamports");
  });
});

describe("runSolanaPreviewSimulation — status: error (NEVER-THROWS invariant)", () => {
  it("RPC timeout: classifier demotes to status: error, never re-throws", async () => {
    const connection = makeFakeConnection(() => {
      throw new Error("RPC timeout");
    });

    // The classifier MUST resolve to an envelope, NOT reject.
    const result = await runSolanaPreviewSimulation({ connection, transaction: FAKE_TX });

    expect(result.status).toBe("error");
    expect(result.err).toBeNull();
    expect(result.logs).toEqual([]);
    expect(result.unitsConsumed).toBeNull();
    expect(result.rpcError).toBe("RPC timeout");
  });

  it("non-Error thrown value: classifier stringifies it into rpcError", async () => {
    const connection = makeFakeConnection(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "network unreachable";
    });

    const result = await runSolanaPreviewSimulation({ connection, transaction: FAKE_TX });

    expect(result.status).toBe("error");
    expect(result.rpcError).toBe("network unreachable");
  });
});

describe("runSolanaPreviewSimulation — empty / undefined-shape envelope tolerance", () => {
  it("ok status when response shape is missing logs / unitsConsumed", async () => {
    const connection = makeFakeConnection(() => ({
      value: { err: null },
    }));

    const result = await runSolanaPreviewSimulation({ connection, transaction: FAKE_TX });

    expect(result.status).toBe("ok");
    expect(result.logs).toEqual([]);
    expect(result.unitsConsumed).toBeNull();
  });
});

describe("_simulationSolana spy-affordance — ESM indirection intercepts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("vi.spyOn on the _simulationSolana indirection intercepts the call", async () => {
    const spy = vi
      .spyOn(_simulationSolana, "runSolanaPreviewSimulation")
      .mockResolvedValue({
        status: "ok",
        err: null,
        logs: ["MOCKED"],
        unitsConsumed: 42,
      });

    const fakeConnection = makeFakeConnection(() => ({ value: { err: null } }));
    const result = await _simulationSolana.runSolanaPreviewSimulation({
      connection: fakeConnection,
      transaction: FAKE_TX,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    expect(result.logs).toEqual(["MOCKED"]);
  });
});
