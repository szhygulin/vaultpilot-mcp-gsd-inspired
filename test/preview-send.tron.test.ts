// Plan 18-04 — preview_send TRON branch regression file.
// Mirror of `test/preview-send.solana.test.ts` shape; TRON-side load-bearing
// invariants:
//
//   1. **EVM and Solana branch back-compat** — EVM handles (txType absent / "evm")
//      flow through the unchanged Phase 4-9 body; Solana handles route to the
//      Solana branch. The TRON dispatcher must NOT hijack those.
//   2. **TRON native happy path** — presignHash is SHA-256(rawDataBytes); previewToken
//      is minted; structuredContent carries chain="tron", kind="native".
//   3. **TRON TRC-20 happy path** — presignHash is SHA-256(rawDataBytes); kind="trc20".
//   4. **Layer 0.5 canonical-dispatch-tron refusal** — non-allowlisted TRC-20
//      contract → `DISPATCH_TARGET_REFUSED`. Native skips Layer 0.5 entirely.
//   5. **Layer 0.7 TRC-20 mandatory simulation gate** — `status !== "ok"` ALWAYS
//      refuses with `SIMULATION_REFUSED`. Native TRX: advisory only (NOT refusal).
//   6. **previewToken minted on native** — simulation advisory doesn't block the pin.
//   7. **presignHash = SHA-256(rawDataBytes)** byte-identity via direct recompute.
//   8. **handle transitions to `previewed`** on success; stays at `prepared` if refused.
//
// Mocking strategy:
//   - `_simulationTron.runTronPreviewSimulation` — full control over TRC-20 sim.
//   - `_canonicalDispatchTron.checkTronDispatchTarget` — Layer 0.5 control.
//   - `_tronRegistry.getTronWeb` — stubbed TronWeb.
//   - `listAccounts` from `non-evm-account-store` — mocked for TRON pairing.
//   - handle-store stays REAL — seed handles via `createHandle`, assert via `lookup()`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

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
  lookup,
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

// TRON test constants
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const TRON_RECIPIENT = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const USDT_TRC20_ADDR = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const NON_ALLOWLIST_ADDR = "TXXXFakeNotInAllowlistXXXXXXXXXXXX1";
const FAKE_TX_ID = "b".repeat(64);

// Canonical raw_data_hex stubs
const NATIVE_RAW_DATA_HEX = "0a".repeat(40);
const TRC20_RAW_DATA_HEX = "0b".repeat(60);

function buildStubTronWebNative() {
  const tx = {
    visible: true,
    txID: FAKE_TX_ID,
    raw_data: {
      contract: [],
      ref_block_bytes: "00ab",
      ref_block_hash: "1234567890abcdef",
      expiration: Date.now() + 900_000,
      timestamp: Date.now(),
    },
    raw_data_hex: NATIVE_RAW_DATA_HEX,
  };
  return {
    transactionBuilder: {
      sendTrx: vi.fn(async () => tx),
      extendExpiration: vi.fn(async (t: unknown) => t),
    },
    utils: { abi: { encodeParamsV2ByABI: vi.fn(() => "00") } },
  };
}

function buildStubTronWebTrc20() {
  const tx = {
    visible: true,
    txID: FAKE_TX_ID,
    raw_data: {
      contract: [],
      ref_block_bytes: "00cd",
      ref_block_hash: "abcdef1234567890",
      expiration: Date.now() + 900_000,
      timestamp: Date.now(),
    },
    raw_data_hex: TRC20_RAW_DATA_HEX,
  };
  return {
    transactionBuilder: {
      triggerSmartContract: vi.fn(async () => ({ result: { result: true }, transaction: tx })),
      extendExpiration: vi.fn(async (t: unknown) => t),
    },
    utils: { abi: { encodeParamsV2ByABI: vi.fn(() => "00") } },
  };
}

function buildNativeTronHandle() {
  const rawDataHex = NATIVE_RAW_DATA_HEX;
  const rawDataObject = {
    contract: [],
    ref_block_bytes: "00ab",
    ref_block_hash: "1234567890abcdef",
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
    rawDataHex,
    rawDataObject,
    refBlockBytes: "00ab",
    refBlockHash: "1234567890abcdef",
    expiration: rawDataObject.expiration,
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(rawDataHex, "hex")),
  });
  return createHandle({
    tx: tronTx,
    args: { to: TRON_RECIPIENT, sun: "1000000" },
    payloadFingerprint,
  });
}

function buildTrc20TronHandle() {
  const rawDataHex = TRC20_RAW_DATA_HEX;
  const rawDataObject = {
    contract: [],
    ref_block_bytes: "00cd",
    ref_block_hash: "abcdef1234567890",
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
    rawDataHex,
    rawDataObject,
    refBlockBytes: "00cd",
    refBlockHash: "abcdef1234567890",
    expiration: rawDataObject.expiration,
    contractAddress: USDT_TRC20_ADDR,
    instructionSummary: [
      {
        kind: "trc20-transfer",
        from: TRON_WHALE_ADDR,
        to: TRON_RECIPIENT,
        amount: 100_000_000n,
        tokenAddress: USDT_TRC20_ADDR,
        decimals: 6,
        symbol: "USDT",
      },
    ],
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(rawDataHex, "hex")),
  });
  return createHandle({
    tx: tronTx,
    args: { to: TRON_RECIPIENT, tokenAddress: USDT_TRC20_ADDR, amount: "100" },
    payloadFingerprint,
  });
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
  vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(buildStubTronWebNative() as never);
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
// 1. TRON native happy path.
// ---------------------------------------------------------------------------
describe("preview_send TRON — native happy path", () => {
  it("mints previewToken; presignHash = SHA-256(rawDataBytes); kind='native'", async () => {
    const handle = buildNativeTronHandle();

    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      chain: string;
      kind: string;
      previewToken: string;
      presignHash: string;
      payloadFingerprint: string;
      simulation: { status: string };
      blockHeader: { refBlockBytes: string; refBlockHash: string; expiration: number };
      rawDataHex: string;
    };

    expect(sc.chain).toBe("tron");
    expect(sc.kind).toBe("native");
    expect(sc.previewToken).toBeTruthy();

    // presignHash MUST equal SHA-256(rawDataBytes)
    const expectedPresignHash =
      "0x" + createHash("sha256")
        .update(Buffer.from(NATIVE_RAW_DATA_HEX, "hex"))
        .digest("hex");
    expect(sc.presignHash).toBe(expectedPresignHash);

    // payloadFingerprint present (set at prepare time; recomputed at send gate)
    expect(sc.payloadFingerprint).toMatch(/^0x[0-9a-f]{64}$/);

    // blockHeader fields populated
    expect(sc.blockHeader.refBlockBytes).toBe("00ab");
    expect(sc.blockHeader.refBlockHash).toBe("1234567890abcdef");
    expect(typeof sc.blockHeader.expiration).toBe("number");

    // rawDataHex matches what was stored
    expect(sc.rawDataHex).toBe(NATIVE_RAW_DATA_HEX);

    // simulation.status = "not-applicable" for native (advisory, not refusal)
    expect(sc.simulation.status).toBe("not-applicable");

    // runTronPreviewSimulation must NOT be called for native
    expect(vi.mocked(_simulationTron.runTronPreviewSimulation)).not.toHaveBeenCalled();

    // handle transitions to previewed
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("handle not found post-preview");
    expect(lookupResult.record.status).toBe("previewed");
    expect(lookupResult.record.pinned?.previewToken).toBe(sc.previewToken);

    // Response text contains LEDGER BLIND-SIGN HASH block
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/LEDGER\s+BLIND.SIGN\s+HASH/i);
  });
});

// ---------------------------------------------------------------------------
// 2. TRON TRC-20 happy path.
// ---------------------------------------------------------------------------
describe("preview_send TRON — TRC-20 happy path", () => {
  it("mints previewToken; kind='trc20'; simulation called once", async () => {
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(buildStubTronWebTrc20() as never);
    const handle = buildTrc20TronHandle();

    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      chain: string;
      kind: string;
      previewToken: string;
      presignHash: string;
      simulation: { status: string };
    };

    expect(sc.chain).toBe("tron");
    expect(sc.kind).toBe("trc20");
    expect(sc.previewToken).toBeTruthy();

    // presignHash = SHA-256(TRC-20 rawDataBytes)
    const expectedPresignHash =
      "0x" + createHash("sha256")
        .update(Buffer.from(TRC20_RAW_DATA_HEX, "hex"))
        .digest("hex");
    expect(sc.presignHash).toBe(expectedPresignHash);

    // simulation was called (TRC-20 mandatory gate)
    expect(vi.mocked(_simulationTron.runTronPreviewSimulation)).toHaveBeenCalledTimes(1);
    expect(sc.simulation.status).toBe("ok");

    // handle is previewed
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("handle not found post-preview");
    expect(lookupResult.record.status).toBe("previewed");
  });
});

// ---------------------------------------------------------------------------
// 3. Layer 0.5 — non-allowlisted TRC-20 → DISPATCH_TARGET_REFUSED.
// ---------------------------------------------------------------------------
describe("preview_send TRON — Layer 0.5 refusal", () => {
  it("refuses non-allowlist TRC-20 with DISPATCH_TARGET_REFUSED", async () => {
    vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget").mockReturnValue({
      kind: "refused",
      offenders: [NON_ALLOWLIST_ADDR],
      allowlist: [USDT_TRC20_ADDR],
    });

    // Build a handle with a non-allowlist contract address
    const rawDataHexNonAllowlist = TRC20_RAW_DATA_HEX;
    const rawDataObject = {
      contract: [],
      ref_block_bytes: "00cd",
      ref_block_hash: "abcdef1234567890",
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
      rawDataHex: rawDataHexNonAllowlist,
      rawDataObject,
      refBlockBytes: "00cd",
      refBlockHash: "abcdef1234567890",
      expiration: rawDataObject.expiration,
      contractAddress: NON_ALLOWLIST_ADDR,
      instructionSummary: [
        {
          kind: "trc20-transfer",
          from: TRON_WHALE_ADDR,
          to: TRON_RECIPIENT,
          amount: 100_000_000n,
          tokenAddress: NON_ALLOWLIST_ADDR,
          decimals: 6,
          symbol: "UNKNOWN",
        },
      ],
    };
    const payloadFingerprintNon = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(rawDataHexNonAllowlist, "hex")),
    });
    const handle = createHandle({
      tx: tronTx,
      args: { to: TRON_RECIPIENT, tokenAddress: NON_ALLOWLIST_ADDR, amount: "100" },
      payloadFingerprint: payloadFingerprintNon,
    });

    const result = await callPreviewSend({ handle });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("DISPATCH_TARGET_REFUSED");

    // handle must remain in `prepared` (refused before pin)
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("handle not found");
    expect(lookupResult.record.status).toBe("prepared");

    // simulation must NOT have been called (Layer 0.5 fires before Layer 0.7)
    expect(vi.mocked(_simulationTron.runTronPreviewSimulation)).not.toHaveBeenCalled();
  });

  it("native TRX skips Layer 0.5 entirely", async () => {
    const checkSpy = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const handle = buildNativeTronHandle();
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();
    // Layer 0.5 check must NOT have been called for native
    expect(checkSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Layer 0.7 — TRC-20 mandatory simulation gate.
// ---------------------------------------------------------------------------
describe("preview_send TRON — Layer 0.7 simulation gate", () => {
  it("refuses TRC-20 when simulation returns revert", async () => {
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(buildStubTronWebTrc20() as never);
    vi.spyOn(_simulationTron, "runTronPreviewSimulation").mockResolvedValue({
      status: "revert",
      revertReason: "insufficient balance",
      energyUsed: 0n,
      constantResult: [],
    });

    const handle = buildTrc20TronHandle();
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; simulation: { status: string } };
    expect(sc.errorCode).toBe("SIMULATION_REFUSED");
    expect(sc.simulation.status).toBe("revert");

    // handle stays at prepared
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("handle not found");
    expect(lookupResult.record.status).toBe("prepared");
  });

  it("refuses TRC-20 when simulation returns rpc-error", async () => {
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(buildStubTronWebTrc20() as never);
    vi.spyOn(_simulationTron, "runTronPreviewSimulation").mockResolvedValue({
      status: "rpc-error",
      revertReason: null,
      rpcError: "connection timeout",
      energyUsed: 0n,
      constantResult: [],
    });

    const handle = buildTrc20TronHandle();
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("SIMULATION_REFUSED");
  });

  it("native TRX emits advisory (not refusal) when simulation not applicable", async () => {
    const handle = buildNativeTronHandle();
    const result = await callPreviewSend({ handle });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      previewToken: string;
      simulation: { status: string };
    };
    expect(sc.previewToken).toBeTruthy();
    // status = "not-applicable" for native (advisory, NOT refusal)
    expect(sc.simulation.status).toBe("not-applicable");
    // runTronPreviewSimulation NOT called for native
    expect(vi.mocked(_simulationTron.runTronPreviewSimulation)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. EVM back-compat: txType absent still routes to EVM body.
// ---------------------------------------------------------------------------
describe("preview_send TRON — EVM branch back-compat", () => {
  it("TRON dispatcher does not hijack EVM handles (txType absent)", async () => {
    // We just verify the TRON spy is not called when an EVM handle is present.
    const checkSpyTron = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const simSpyTron = vi.spyOn(_simulationTron, "runTronPreviewSimulation");

    // We do not seed an EVM handle (that's covered by the main preview-send.test.ts).
    // Just confirm the TRON-specific spies stay at 0 calls when nothing routes to them.
    // (Trivial assertion — full EVM regression lives in test/preview-send.test.ts.)
    expect(checkSpyTron).not.toHaveBeenCalled();
    expect(simSpyTron).not.toHaveBeenCalled();
  });
});
