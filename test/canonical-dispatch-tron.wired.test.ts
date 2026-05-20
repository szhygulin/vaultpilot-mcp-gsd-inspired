// Plan 18-04 — Layer 0.5 canonical-dispatch-tron wiring test.
// Verifies that `preview_send` correctly invokes `_canonicalDispatchTron.checkTronDispatchTarget`
// at the right point in the pipeline. Mirrors the intent of
// `test/canonical-dispatch-solana.test.ts` at the wired level (not just unit coverage).
//
// Coverage:
//   1. **TRC-20 handle → Layer 0.5 called once** with the handle's contractAddress.
//   2. **Native handle → Layer 0.5 NOT called** (native skips entirely).
//   3. **Real allowlist — USDT, USDC, USDD, TUSD pass** (no mock needed; real impl).
//   4. **Real allowlist — non-allowlisted contract refuses** (real impl, no spy).
//   5. **Layer 0.5 fires BEFORE Layer 0.7** — when Layer 0.5 refuses, simulation is
//      never called (offenders[0] in the refusal, simulation spy stays at 0 calls).
//   6. **_canonicalDispatchTron spy round-trip** — ESM indirection allows vi.spyOn.
//
// Wiring tests complement the pure unit tests in `test/canonical-dispatch-tron.test.ts`
// by proving the integration point in `preview_send.ts`.
//
// Mocking strategy:
//   - `_simulationTron.runTronPreviewSimulation` mocked to "ok" for happy paths.
//   - `_tronRegistry.getTronWeb` stubbed for TRC-20 sim.
//   - `listAccounts` from `non-evm-account-store` mocked for pairing.
//   - `_canonicalDispatchTron.checkTronDispatchTarget` spied on in Layer 0.5 order tests.
//   - handle-store REAL — seed handles directly via `createHandle`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
}));

vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (...args: Parameters<typeof actual.listAccounts>) =>
      listAccountsSpy(...args),
  };
});

import { _tronRegistry } from "../src/chains/tron/registry.js";
import { _canonicalDispatchTron } from "../src/security/canonical-dispatch-tron.js";
import { computeTronPayloadFingerprint } from "../src/signing/payload-fingerprint-tron.js";
import { _simulationTron } from "../src/signing/simulation-tron.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  type PreparedTxTron,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callPreviewSend(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

// Allowlist addresses (Phase 18 canonical set)
const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDC_TRC20 = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const USDD = "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn";
const TUSD = "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4";
const NON_ALLOWLISTED = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax"; // SunSwap router

const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const TRON_RECIPIENT = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const RAW_DATA_HEX = "55".repeat(50);

function buildTrc20Handle(contractAddress: string): string {
  const rawDataObject = {
    contract: [],
    ref_block_bytes: "00ef",
    ref_block_hash: "eeff00112233aabb",
    expiration: Date.now() + 900_000,
    timestamp: Date.now(),
  };
  const tronTx: PreparedTxTron = {
    txType: "tron",
    kind: "trc20",
    chainId: 0,
    to: TRON_RECIPIENT,
    valueWei: 0n,
    data: "0x",
    rawDataHex: RAW_DATA_HEX,
    rawDataObject,
    refBlockBytes: "00ef",
    refBlockHash: "eeff00112233aabb",
    expiration: rawDataObject.expiration,
    contractAddress,
    instructionSummary: [
      {
        kind: "trc20-transfer",
        from: TRON_WHALE_ADDR,
        to: TRON_RECIPIENT,
        amount: 100_000_000n,
        tokenAddress: contractAddress,
        decimals: 6,
        symbol: "TOKEN",
      },
    ],
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(RAW_DATA_HEX, "hex")),
  });
  return createHandle({
    tx: tronTx,
    args: { to: TRON_RECIPIENT, tokenAddress: contractAddress, amount: "100" },
    payloadFingerprint,
  });
}

function buildNativeHandle(): string {
  const rawDataObject = {
    contract: [],
    ref_block_bytes: "00aa",
    ref_block_hash: "aabbccdd11223344",
    expiration: Date.now() + 900_000,
    timestamp: Date.now(),
  };
  const tronTx: PreparedTxTron = {
    txType: "tron",
    kind: "native",
    chainId: 0,
    to: TRON_RECIPIENT,
    valueWei: 0n,
    data: "0x",
    rawDataHex: RAW_DATA_HEX,
    rawDataObject,
    refBlockBytes: "00aa",
    refBlockHash: "aabbccdd11223344",
    expiration: rawDataObject.expiration,
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(RAW_DATA_HEX, "hex")),
  });
  return createHandle({
    tx: tronTx,
    args: { to: TRON_RECIPIENT, sun: "500000" },
    payloadFingerprint,
  });
}

function buildStubTronWeb() {
  return {
    transactionBuilder: {
      triggerConstantContract: vi.fn(async () => ({ result: { result: true }, energy_used: 0 })),
    },
    utils: { abi: { encodeParamsV2ByABI: vi.fn(() => "00") } },
  };
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  listAccountsSpy.mockReset();
  listAccountsSpy.mockReturnValue([
    {
      chain: "tron",
      address: TRON_WHALE_ADDR,
      derivationPath: "44'/195'/0'/0/0",
      pairedAt: new Date().toISOString(),
    },
  ]);
  vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(buildStubTronWeb() as never);
  vi.spyOn(_simulationTron, "runTronPreviewSimulation").mockResolvedValue({
    status: "ok",
    revertReason: null,
    energyUsed: 31895n,
    constantResult: ["0000000000000000000000000000000000000000000000000000000000000001"],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. TRC-20 → Layer 0.5 called with contractAddress.
// ---------------------------------------------------------------------------
describe("canonical-dispatch-tron wired — TRC-20 Layer 0.5 called", () => {
  it("checkTronDispatchTarget called once with contractAddress for TRC-20 handle", async () => {
    const checkSpy = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const handle = buildTrc20Handle(USDT_TRC20);

    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();

    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(checkSpy).toHaveBeenCalledWith([USDT_TRC20]);
  });
});

// ---------------------------------------------------------------------------
// 2. Native → Layer 0.5 NOT called.
// ---------------------------------------------------------------------------
describe("canonical-dispatch-tron wired — native skips Layer 0.5", () => {
  it("checkTronDispatchTarget never called for native TRX handle", async () => {
    const checkSpy = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const handle = buildNativeHandle();

    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();

    expect(checkSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Real allowlist — USDT/USDC/USDD/TUSD all pass.
// ---------------------------------------------------------------------------
describe("canonical-dispatch-tron wired — real allowlist passes", () => {
  it.each([
    ["USDT", USDT_TRC20],
    ["USDC", USDC_TRC20],
    ["USDD", USDD],
    ["TUSD", TUSD],
  ])("%s is in the allowlist → preview_send succeeds", async (_label, addr) => {
    const handle = buildTrc20Handle(addr);
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { chain: string; kind: string };
    expect(sc.chain).toBe("tron");
    expect(sc.kind).toBe("trc20");
  });
});

// ---------------------------------------------------------------------------
// 4. Real allowlist — non-allowlisted contract refuses.
// ---------------------------------------------------------------------------
describe("canonical-dispatch-tron wired — real allowlist refuses non-allowlisted", () => {
  it("SunSwap router not in Phase 18 allowlist → DISPATCH_TARGET_REFUSED", async () => {
    const handle = buildTrc20Handle(NON_ALLOWLISTED);
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("DISPATCH_TARGET_REFUSED");
  });
});

// ---------------------------------------------------------------------------
// 5. Layer 0.5 fires BEFORE Layer 0.7 — simulation NOT called on refusal.
// ---------------------------------------------------------------------------
describe("canonical-dispatch-tron wired — Layer 0.5 before Layer 0.7", () => {
  it("when Layer 0.5 refuses, simulation is not called (order enforced)", async () => {
    const handle = buildTrc20Handle(NON_ALLOWLISTED);
    const simSpy = vi.mocked(_simulationTron.runTronPreviewSimulation);

    const result = await callPreviewSend({ handle });
    expect(result.isError).toBe(true);
    expect(simSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. ESM spy-affordance round-trip — _canonicalDispatchTron indirection works.
// ---------------------------------------------------------------------------
describe("canonical-dispatch-tron ESM spy round-trip", () => {
  it("vi.spyOn(_canonicalDispatchTron, 'checkTronDispatchTarget') intercepts real call", async () => {
    let capturedArg: string[] | undefined;
    vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget").mockImplementation((addresses) => {
      capturedArg = addresses;
      return { kind: "allowed" as const };
    });

    const handle = buildTrc20Handle(USDT_TRC20);
    await callPreviewSend({ handle });

    expect(capturedArg).toEqual([USDT_TRC20]);
  });
});
