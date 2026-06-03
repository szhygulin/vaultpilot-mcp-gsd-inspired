// Bittensor advisory dry-run classifier regression. Phase 47 — Plan 47-03
// (TAO-PREP-02). The classifier NEVER throws; every failure demotes to an
// advisory status, NEVER a hard refusal (47-RESEARCH §Probe 4 — the consumer
// surfaces a warning, never blocks).
//
// NO live socket — _bittensorRegistry.getApi is spied at the indirection seam.

import { afterEach, describe, expect, it, vi } from "vitest";

import { _bittensorRegistry } from "../src/chains/bittensor/registry.js";
import {
  _simulationBittensor,
  runBittensorPreviewSimulation,
} from "../src/signing/simulation-bittensor.js";

const BLOB = new Uint8Array([1, 2, 3, 4]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runBittensorPreviewSimulation — TAO-PREP-02 (advisory, never-throws)", () => {
  it("classifies ok when dryRun.isOk is true", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue({
      rpc: { system: { dryRun: async () => ({ isOk: true }) } },
    } as never);
    const res = await runBittensorPreviewSimulation({ signableBlob: BLOB });
    expect(res.status).toBe("ok");
    expect(res.detail).toBeNull();
  });

  it("classifies invalid (advisory) when dryRun does not validate", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue({
      rpc: { system: { dryRun: async () => ({ isOk: false }) } },
    } as never);
    const res = await runBittensorPreviewSimulation({ signableBlob: BLOB });
    expect(res.status).toBe("invalid");
    // Advisory — NOT a refusal envelope; just a classification.
    expect(res.detail).toMatch(/advisory/i);
  });

  it("demotes to error (advisory) when dryRun is not decorated on the node", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue({
      rpc: { system: {} },
    } as never);
    const res = await runBittensorPreviewSimulation({ signableBlob: BLOB });
    expect(res.status).toBe("error");
    expect(res.rpcError).toMatch(/dryRun/);
  });

  it("NEVER throws when getApi rejects (RPC down) — demotes to advisory error", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockRejectedValue(
      new Error("WS connection refused"),
    );
    // The classifier must resolve, not reject.
    const res = await runBittensorPreviewSimulation({ signableBlob: BLOB });
    expect(res.status).toBe("error");
    expect(res.rpcError).toContain("WS connection refused");
  });

  it("NEVER throws when dryRun itself rejects — demotes to advisory error", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue({
      rpc: {
        system: {
          dryRun: async () => {
            throw new Error("unsigned extrinsic not accepted");
          },
        },
      },
    } as never);
    const res = await runBittensorPreviewSimulation({ signableBlob: BLOB });
    expect(res.status).toBe("error");
    expect(res.rpcError).toContain("unsigned extrinsic not accepted");
  });

  it("_simulationBittensor spy-affordance intercepts", async () => {
    const spy = vi
      .spyOn(_simulationBittensor, "runBittensorPreviewSimulation")
      .mockResolvedValue({ status: "ok", detail: null });
    const r = await _simulationBittensor.runBittensorPreviewSimulation({
      signableBlob: BLOB,
    });
    expect(spy).toHaveBeenCalledWith({ signableBlob: BLOB });
    expect(r.status).toBe("ok");
    spy.mockRestore();
  });
});
