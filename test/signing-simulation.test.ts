// Pure-fn tests for src/signing/simulation.ts — the DF-1 LOCKED wide eth_call
// helper. Phase 6 — Plan 06-02.
//
// Mocking strategy: spy on `viem/actions.call` via vi.mock; drive the four
// status paths (ok / revert via message / revert via "execution reverted" /
// non-revert RPC error). NEVER-THROWS invariant asserted on every case.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex, PublicClient } from "viem";

const { callSpy } = vi.hoisted(() => ({
  callSpy: vi.fn(),
}));

vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>("viem/actions");
  return {
    ...actual,
    call: (...args: Parameters<typeof actual.call>) => callSpy(...args),
  };
});

import { runPreviewSimulation } from "../src/signing/simulation.js";

const FAKE_CLIENT = {} as PublicClient;
const FAKE_SENDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const FAKE_TX = {
  to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
  valueWei: 0n,
  data: "0xa9059cbb" as Hex,
};

beforeEach(() => {
  callSpy.mockReset();
});

afterEach(() => {
  callSpy.mockReset();
});

describe("runPreviewSimulation — happy path", () => {
  it("returns { status: 'ok', resultData, errorMessage: null } when eth_call succeeds", async () => {
    callSpy.mockResolvedValueOnce({ data: "0x000000000000000000000000000000000000000000000000000000000000001" });

    const result = await runPreviewSimulation({
      client: FAKE_CLIENT,
      sender: FAKE_SENDER,
      tx: FAKE_TX,
    });

    expect(result.status).toBe("ok");
    expect(result.resultData).toBe(
      "0x000000000000000000000000000000000000000000000000000000000000001",
    );
    expect(result.errorMessage).toBeNull();

    // Passes through sender as `account`, tx fields verbatim.
    expect(callSpy).toHaveBeenCalledTimes(1);
    const callArgs = callSpy.mock.calls[0]?.[1] as {
      account: string;
      to: string;
      value: bigint;
      data: string;
    };
    expect(callArgs.account).toBe(FAKE_SENDER);
    expect(callArgs.to).toBe(FAKE_TX.to);
    expect(callArgs.value).toBe(0n);
    expect(callArgs.data).toBe(FAKE_TX.data);
  });

  it("returns resultData '0x' when call returns { data: undefined }", async () => {
    callSpy.mockResolvedValueOnce({});

    const result = await runPreviewSimulation({
      client: FAKE_CLIENT,
      sender: FAKE_SENDER,
      tx: FAKE_TX,
    });

    expect(result.status).toBe("ok");
    expect(result.resultData).toBe("0x");
  });
});

describe("runPreviewSimulation — revert detection (case-insensitive message regex)", () => {
  it("returns { status: 'revert' } when call throws Error with 'execution reverted'", async () => {
    callSpy.mockRejectedValueOnce(new Error("execution reverted: ERC20: insufficient balance"));

    const result = await runPreviewSimulation({
      client: FAKE_CLIENT,
      sender: FAKE_SENDER,
      tx: FAKE_TX,
    });

    expect(result.status).toBe("revert");
    expect(result.resultData).toBeNull();
    expect(result.errorMessage).toContain("execution reverted");
  });

  it("returns { status: 'revert' } for 'reverted with reason: Arithmetic underflow' (case-insensitive)", async () => {
    callSpy.mockRejectedValueOnce(new Error("Reverted with reason: Arithmetic underflow"));

    const result = await runPreviewSimulation({
      client: FAKE_CLIENT,
      sender: FAKE_SENDER,
      tx: FAKE_TX,
    });

    expect(result.status).toBe("revert");
    expect(result.errorMessage).toContain("Reverted");
  });
});

describe("runPreviewSimulation — non-revert RPC errors classified as 'error'", () => {
  it("returns { status: 'error' } when call throws Error('network timeout')", async () => {
    callSpy.mockRejectedValueOnce(new Error("network timeout"));

    const result = await runPreviewSimulation({
      client: FAKE_CLIENT,
      sender: FAKE_SENDER,
      tx: FAKE_TX,
    });

    expect(result.status).toBe("error");
    expect(result.resultData).toBeNull();
    expect(result.errorMessage).toBe("network timeout");
  });

  it("returns { status: 'error' } for non-Error throws (string thrown)", async () => {
    callSpy.mockRejectedValueOnce("ECONNRESET");

    const result = await runPreviewSimulation({
      client: FAKE_CLIENT,
      sender: FAKE_SENDER,
      tx: FAKE_TX,
    });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("ECONNRESET");
  });
});

describe("runPreviewSimulation — NEVER throws (non-blocking invariant)", () => {
  it("every input shape resolves; .rejects never fires (T-SIMULATION-RPC-FAIL-1)", async () => {
    callSpy.mockRejectedValueOnce(new Error("network down"));

    // Use `.resolves` — if the helper accidentally re-throws, this assertion
    // would fail with a rejection from .rejects-shape, not a passing match.
    await expect(
      runPreviewSimulation({ client: FAKE_CLIENT, sender: FAKE_SENDER, tx: FAKE_TX }),
    ).resolves.toMatchObject({ status: "error" });
  });
});
