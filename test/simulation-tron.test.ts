// test/simulation-tron.test.ts — Phase 18 Plan 18-01.
//
// 5 cases + spy-intercept regression for `simulation-tron.ts`:
//   1. ok — `result.result === true`
//   2. revert with reason decode — `result.code === "REVERT"` + ABI-encoded reason
//   3. energy-required — non-REVERT non-ok code (OUT_OF_ENERGY)
//   4. error (RPC throw) — NEVER-throws contract regression
//   5. not-applicable — `emitNoSimulationAvailable()` constant-result helper
//   + spy-intercept: `_simulationTron` ESM seam works

import { describe, expect, it, vi } from "vitest";

import {
  _simulationTron,
  emitNoSimulationAvailable,
  runTronPreviewSimulation,
  type TronSimulationResult,
} from "../src/signing/simulation-tron.js";

// ============================================================================
// Helpers to build mock TronWeb instances
// ============================================================================

function mockTronWeb(
  triggerConstantContractImpl: () => Promise<unknown>,
): { transactionBuilder: { triggerConstantContract: () => Promise<unknown> } } {
  return {
    transactionBuilder: {
      triggerConstantContract: triggerConstantContractImpl,
    },
  };
}

// ABI-encode an Error(string) revert reason:
//   selector (4 bytes) = 08c379a0
//   offset   (32 bytes) = 0000...0020
//   length   (32 bytes) = <byte-length of string>
//   data     (padded)   = <utf-8 bytes of string, right-padded to 32-byte boundary>
function encodeRevertReason(reason: string): string {
  const encoded = Buffer.from(reason, "utf8");
  const lenHex = encoded.length.toString(16).padStart(64, "0");
  // Pad data to 32-byte boundary
  const paddedLen = Math.ceil(encoded.length / 32) * 32;
  const dataHex = encoded.toString("hex").padEnd(paddedLen * 2, "0");
  return "08c379a0" + "0".repeat(64 - 2) + "20" + lenHex + dataHex;
}

// ============================================================================
// Case 1 — ok
// ============================================================================
describe("runTronPreviewSimulation — Case 1: ok", () => {
  it("status: ok when result.result === true", async () => {
    const tw = mockTronWeb(async () => ({
      result: { result: true },
      energy_used: 31895,
      constant_result: ["0x0000000000000000000000000000000000000000000000000000000000000001"],
    }));

    const result = await runTronPreviewSimulation({
      tronWeb: tw as never,
      contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      functionSelector: "transfer(address,uint256)",
      parameters: [
        { type: "address", value: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8" },
        { type: "uint256", value: 100_000_000 },
      ],
      ownerAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    });

    expect(result.status).toBe("ok");
    expect(result.energyUsed).toBe(31895n);
    expect(result.revertReason).toBeNull();
    expect(result.rpcError).toBeUndefined();
    expect(result.constantResult).toHaveLength(1);
  });
});

// ============================================================================
// Case 2 — revert with reason decode
// ============================================================================
describe("runTronPreviewSimulation — Case 2: revert with decoded reason", () => {
  it("status: revert + decoded revertReason when result.code === REVERT", async () => {
    const reason = "insufficient balance";
    const encodedReason = encodeRevertReason(reason);

    const tw = mockTronWeb(async () => ({
      result: { result: false, code: "REVERT", message: "REVERT opcode executed" },
      energy_used: 12345,
      constant_result: [encodedReason],
    }));

    const result = await runTronPreviewSimulation({
      tronWeb: tw as never,
      contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      functionSelector: "transfer(address,uint256)",
      parameters: [],
      ownerAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    });

    expect(result.status).toBe("revert");
    expect(result.revertReason).toBe(reason);
    expect(result.energyUsed).toBe(12345n);
  });

  it("status: revert with null revertReason when constant_result is missing the Error(string) selector", async () => {
    const tw = mockTronWeb(async () => ({
      result: { result: false, code: "REVERT" },
      energy_used: 100,
      constant_result: ["deadbeef"], // no 08c379a0 selector
    }));

    const result = await runTronPreviewSimulation({
      tronWeb: tw as never,
      contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      functionSelector: "transfer(address,uint256)",
      parameters: [],
      ownerAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    });

    expect(result.status).toBe("revert");
    expect(result.revertReason).toBeNull(); // no decodable reason
  });
});

// ============================================================================
// Case 3 — energy-required
// ============================================================================
describe("runTronPreviewSimulation — Case 3: energy-required", () => {
  it("status: energy-required when result.result === false with non-REVERT code", async () => {
    const tw = mockTronWeb(async () => ({
      result: { result: false, code: "OUT_OF_ENERGY" },
      energy_used: 999_999,
      constant_result: [],
    }));

    const result = await runTronPreviewSimulation({
      tronWeb: tw as never,
      contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      functionSelector: "transfer(address,uint256)",
      parameters: [],
      ownerAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    });

    expect(result.status).toBe("energy-required");
    expect(result.revertReason).toBeNull();
    expect(result.energyUsed).toBe(999_999n);
  });
});

// ============================================================================
// Case 4 — RPC throw → error (NEVER-throws contract)
// ============================================================================
describe("runTronPreviewSimulation — Case 4: RPC throw → status: error (NEVER-throws regression)", () => {
  it("demotes thrown RPC error to status: error and NEVER throws", async () => {
    const tw = mockTronWeb(async () => {
      throw new Error("network unreachable");
    });

    // Must not throw.
    let result: TronSimulationResult;
    expect(async () => {
      result = await runTronPreviewSimulation({
        tronWeb: tw as never,
        contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        functionSelector: "transfer(address,uint256)",
        parameters: [],
        ownerAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      });
    }).not.toThrow();

    result = await runTronPreviewSimulation({
      tronWeb: tw as never,
      contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      functionSelector: "transfer(address,uint256)",
      parameters: [],
      ownerAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    });

    expect(result!.status).toBe("error");
    expect(result!.rpcError).toBe("network unreachable");
    expect(result!.revertReason).toBeNull();
    expect(result!.energyUsed).toBeNull();
    expect(result!.constantResult).toHaveLength(0);
  });

  it("demotes undefined result (contract-not-found edge case) to status: error", async () => {
    // Some TronGrid edge cases return undefined result when contract doesn't exist.
    const tw = mockTronWeb(async () => undefined);

    const result = await runTronPreviewSimulation({
      tronWeb: tw as never,
      contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      functionSelector: "transfer(address,uint256)",
      parameters: [],
      ownerAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    });

    expect(result.status).toBe("error");
    expect(result.rpcError).toBe("contract-not-found");
  });
});

// ============================================================================
// Case 5 — not-applicable (emitNoSimulationAvailable)
// ============================================================================
describe("emitNoSimulationAvailable — Case 5: not-applicable constant-result sentinel", () => {
  it("returns uniform TronSimulationResult with status: not-applicable", () => {
    const result = emitNoSimulationAvailable();

    expect(result.status).toBe("not-applicable");
    expect(result.revertReason).toBeNull();
    expect(result.energyUsed).toBeNull();
    expect(result.constantResult).toHaveLength(0);
    expect(result.rpcError).toBeUndefined();
  });

  it("emitNoSimulationAvailable is a pure constant-result function (no network access)", () => {
    // Call twice; result must be equal by value.
    const r1 = emitNoSimulationAvailable();
    const r2 = emitNoSimulationAvailable();

    expect(r1.status).toBe(r2.status);
    expect(r1.revertReason).toBe(r2.revertReason);
    expect(r1.energyUsed).toBe(r2.energyUsed);
  });
});

// ============================================================================
// Spy-intercept regression
// ============================================================================
describe("_simulationTron ESM spy-affordance regression", () => {
  it("vi.spyOn(_simulationTron, 'runTronPreviewSimulation') intercepts the call", async () => {
    const mockResult: TronSimulationResult = {
      status: "ok",
      revertReason: null,
      energyUsed: 12345n,
      constantResult: ["0xabc"],
    };

    const spy = vi
      .spyOn(_simulationTron, "runTronPreviewSimulation")
      .mockResolvedValueOnce(mockResult);

    const result = await _simulationTron.runTronPreviewSimulation({
      tronWeb: {} as never,
      contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      functionSelector: "transfer(address,uint256)",
      parameters: [],
      ownerAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    expect(result.energyUsed).toBe(12345n);

    spy.mockRestore();
  });

  it("vi.spyOn(_simulationTron, 'emitNoSimulationAvailable') intercepts the call", () => {
    const mockResult: TronSimulationResult = {
      status: "not-applicable",
      revertReason: null,
      energyUsed: null,
      constantResult: [],
    };

    const spy = vi
      .spyOn(_simulationTron, "emitNoSimulationAvailable")
      .mockReturnValueOnce(mockResult);

    const result = _simulationTron.emitNoSimulationAvailable();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("not-applicable");

    spy.mockRestore();
  });
});
