// `encodeTronTransfer` + `decodeTronNativeCall` regression. Phase 18 — Plan 18-02.
//
// Encoder byte-stability: mocks `_tronRegistry.getTronWeb()` to return a
// fixture-TronWeb whose `transactionBuilder.sendTrx` returns the Fixture-M-
// shaped transaction. `extendExpiration` mock returns same tx with expiration
// advanced by 900_000ms. Asserts returned rawDataHex matches Fixture-M literal.
//
// Decoder shape: feed Fixture-M-shaped object → `decodeTronNativeCall` returns
// `{ kind: "transfer", from: ..., to: ..., sun: 1_000_000n }`.
//
// Defensive unknown: non-TransferContract type / empty contract array → `{ kind: "unknown" }`.
//
// Overflow guard: sun > Number.MAX_SAFE_INTEGER → RangeError before tronweb.
//
// extendExpiration invocation: assert called once with (tx, 900) — LOAD-BEARING
// per RESEARCH §Topic 5.
//
// _tronNative spy-intercept: confirms ESM seam is functional.
//
// Cross-link: Fixture M literal from `test/signing-fingerprint-tron.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _tronRegistry } from "../src/chains/tron/registry.js";
import {
  _tronNative,
  decodeTronNativeCall,
  encodeTronTransfer,
} from "../src/protocols/tron-native.js";

// ============================================================================
// Fixture M constants (pinned in `test/signing-fingerprint-tron.test.ts`).
// Reproduced here for byte-stability regression in encoder test.
// ============================================================================
const FIXTURE_M_FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // USDT deployer
const FIXTURE_M_TO = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8"; // USDC contract addr
const FIXTURE_M_SUN = 1_000_000n; // 1 TRX
const FIXTURE_M_REF_BLOCK_BYTES = "00ad";
const FIXTURE_M_REF_BLOCK_HASH = "8e5e7df4e3c8b9a2";
const FIXTURE_M_EXPIRATION_BASE = 1779268134000;
const FIXTURE_M_TIMESTAMP = 1779268074000;

// The pinned raw_data_hex from `test/signing-fingerprint-tron.test.ts:Fixture M`.
const FIXTURE_M_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c1215413487b63d30b5b2c87fb7ffa8bcfade38eaac1abe18c0843d7090f490a5e433";

// Hex-encoded owner_address and to_address as tronweb returns them from
// the parameter.value (0x41-prefix hex form — from/to_address in the decoded
// Protobuf before `formatTronAddress` round-trips back to base58check).
// These are derived from the known addresses:
//   TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t → 41a614f803b6fd780986a42c78ec9c7f77e6ded13c
//   TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8  → 413487b63d30b5b2c87fb7ffa8bcfade38eaac1abe
const FIXTURE_M_OWNER_ADDR_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const FIXTURE_M_TO_ADDR_HEX = "413487b63d30b5b2c87fb7ffa8bcfade38eaac1abe";

// ============================================================================
// Helper: build a mock TronWeb for the encoder test.
// `sendTrx` returns a Fixture-M-shaped tx; `extendExpiration` returns the
// same tx with expiration advanced by 900_000ms.
// ============================================================================
function buildMockTronWeb(overrides?: {
  sendTrxResult?: Record<string, unknown>;
}) {
  const baseTx = {
    raw_data_hex: FIXTURE_M_RAW_DATA_HEX,
    raw_data: {
      contract: [
        {
          type: "TransferContract",
          parameter: {
            value: {
              owner_address: FIXTURE_M_OWNER_ADDR_HEX,
              to_address: FIXTURE_M_TO_ADDR_HEX,
              amount: Number(FIXTURE_M_SUN),
            },
          },
        },
      ],
      ref_block_bytes: FIXTURE_M_REF_BLOCK_BYTES,
      ref_block_hash: FIXTURE_M_REF_BLOCK_HASH,
      expiration: FIXTURE_M_EXPIRATION_BASE,
      timestamp: FIXTURE_M_TIMESTAMP,
    },
  };

  const txResult = overrides?.sendTrxResult ?? baseTx;
  const extendedTx = {
    ...txResult,
    raw_data: {
      ...(txResult as typeof baseTx).raw_data,
      expiration: FIXTURE_M_EXPIRATION_BASE + 900_000,
    },
  };

  const extendExpirationMock = vi.fn().mockResolvedValue(extendedTx);
  const sendTrxMock = vi.fn().mockResolvedValue(txResult);

  return {
    transactionBuilder: {
      sendTrx: sendTrxMock,
      extendExpiration: extendExpirationMock,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as any;
}

describe("encodeTronTransfer — byte-stability (Fixture M cross-link)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns rawDataHex matching the Fixture M pinned literal", async () => {
    const mockTronWeb = buildMockTronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(mockTronWeb);

    const result = await encodeTronTransfer({
      tronWeb: mockTronWeb,
      from: FIXTURE_M_FROM,
      to: FIXTURE_M_TO,
      sun: FIXTURE_M_SUN,
    });

    // The encoder returns the rawDataHex from sendTrx's result (not from
    // extendExpiration's result, because extendExpiration modifies expiration
    // but the raw_data_hex for our mock is pinned on the original tx).
    // In production, extendExpiration re-serializes and produces new raw_data_hex.
    // For this byte-stability test we pin the mock to return the known literal.
    expect(result.rawDataHex).toBe(FIXTURE_M_RAW_DATA_HEX);

    // rawDataBytes is the Uint8Array view.
    expect(result.rawDataBytes).toBeInstanceOf(Uint8Array);
    expect(result.rawDataBytes.length).toBe(
      FIXTURE_M_RAW_DATA_HEX.length / 2, // 133 bytes
    );

    // ref-block fields pinned from Fixture M inputs.
    expect(result.refBlockBytes).toBe(FIXTURE_M_REF_BLOCK_BYTES);
    expect(result.refBlockHash).toBe(FIXTURE_M_REF_BLOCK_HASH);

    // expiration is the EXTENDED value (extendExpiration mock returns +900_000ms).
    expect(result.expiration).toBe(FIXTURE_M_EXPIRATION_BASE + 900_000);
  });

  it("rawDataBytes.length is 133 for Fixture M (byte-length anchor)", async () => {
    const mockTronWeb = buildMockTronWeb();
    const result = await encodeTronTransfer({
      tronWeb: mockTronWeb,
      from: FIXTURE_M_FROM,
      to: FIXTURE_M_TO,
      sun: FIXTURE_M_SUN,
    });
    expect(result.rawDataBytes.length).toBe(133);
  });

  it("instructionSummary[0] carries { kind: native-transfer, from, to, sun }", async () => {
    const mockTronWeb = buildMockTronWeb();
    const result = await encodeTronTransfer({
      tronWeb: mockTronWeb,
      from: FIXTURE_M_FROM,
      to: FIXTURE_M_TO,
      sun: FIXTURE_M_SUN,
    });
    expect(result.instructionSummary).toHaveLength(1);
    const summary = result.instructionSummary[0];
    expect(summary?.kind).toBe("native-transfer");
    if (summary?.kind !== "native-transfer") return;
    expect(summary.from).toBe(FIXTURE_M_FROM);
    expect(summary.to).toBe(FIXTURE_M_TO);
    expect(summary.sun).toBe(FIXTURE_M_SUN);
  });

  it("rawDataObject is the raw_data field from the extended tx (Plan 18-04 broadcast reconstruction)", async () => {
    const mockTronWeb = buildMockTronWeb();
    const result = await encodeTronTransfer({
      tronWeb: mockTronWeb,
      from: FIXTURE_M_FROM,
      to: FIXTURE_M_TO,
      sun: FIXTURE_M_SUN,
    });
    // rawDataObject is the raw_data of the EXTENDED tx (not the pre-extend tx).
    expect((result.rawDataObject as { expiration: number }).expiration).toBe(
      FIXTURE_M_EXPIRATION_BASE + 900_000,
    );
  });
});

describe("encodeTronTransfer — extendExpiration LOAD-BEARING regression (RESEARCH §Topic 5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls tronWeb.transactionBuilder.extendExpiration(tx, 900) exactly once per encoder call", async () => {
    const mockTronWeb = buildMockTronWeb();
    const extendSpy = mockTronWeb.transactionBuilder.extendExpiration;

    await encodeTronTransfer({
      tronWeb: mockTronWeb,
      from: FIXTURE_M_FROM,
      to: FIXTURE_M_TO,
      sun: FIXTURE_M_SUN,
    });

    expect(extendSpy).toHaveBeenCalledTimes(1);
    // First arg is the tx returned by sendTrx; second arg MUST be 900.
    expect(extendSpy.mock.calls[0]?.[1]).toBe(900);
  });

  it("sendTrx is called before extendExpiration (call order integrity)", async () => {
    const callOrder: string[] = [];
    const sendTrxMock = vi.fn().mockImplementation(() => {
      callOrder.push("sendTrx");
      return Promise.resolve({
        raw_data_hex: FIXTURE_M_RAW_DATA_HEX,
        raw_data: {
          contract: [],
          ref_block_bytes: FIXTURE_M_REF_BLOCK_BYTES,
          ref_block_hash: FIXTURE_M_REF_BLOCK_HASH,
          expiration: FIXTURE_M_EXPIRATION_BASE,
          timestamp: FIXTURE_M_TIMESTAMP,
        },
      });
    });
    const extendMock = vi.fn().mockImplementation((tx: unknown) => {
      callOrder.push("extendExpiration");
      return Promise.resolve(tx);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTronWeb = {
      transactionBuilder: { sendTrx: sendTrxMock, extendExpiration: extendMock },
    } as unknown as any;

    await encodeTronTransfer({
      tronWeb: mockTronWeb,
      from: FIXTURE_M_FROM,
      to: FIXTURE_M_TO,
      sun: FIXTURE_M_SUN,
    });

    expect(callOrder).toEqual(["sendTrx", "extendExpiration"]);
  });
});

describe("encodeTronTransfer — overflow guard (Pitfall 1 from Phase 17 RESEARCH)", () => {
  it("throws RangeError for sun > Number.MAX_SAFE_INTEGER before tronweb is called", async () => {
    const sendTrxMock = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTronWeb = {
      transactionBuilder: {
        sendTrx: sendTrxMock,
        extendExpiration: vi.fn(),
      },
    } as unknown as any;

    // 2^64 exceeds both u64 (which parseTronAmountStrict would reject at the
    // tool layer) and Number.MAX_SAFE_INTEGER — the overflow guard fires here.
    await expect(
      encodeTronTransfer({
        tronWeb: mockTronWeb,
        from: FIXTURE_M_FROM,
        to: FIXTURE_M_TO,
        sun: 2n ** 64n,
      }),
    ).rejects.toThrow(RangeError);

    // tronweb MUST NOT be called when overflow guard fires.
    expect(sendTrxMock).not.toHaveBeenCalled();
  });

  it("does NOT throw for sun === Number.MAX_SAFE_INTEGER (boundary: accept at the max)", async () => {
    const mockTronWeb = buildMockTronWeb();

    // Should not throw (sun === MAX_SAFE_INTEGER is the largest safe bigint).
    await expect(
      encodeTronTransfer({
        tronWeb: mockTronWeb,
        from: FIXTURE_M_FROM,
        to: FIXTURE_M_TO,
        sun: BigInt(Number.MAX_SAFE_INTEGER),
      }),
    ).resolves.toBeDefined();
  });

  it("throws RangeError for sun === Number.MAX_SAFE_INTEGER + 1 (overflow boundary)", async () => {
    const sendTrxMock = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTronWeb = {
      transactionBuilder: {
        sendTrx: sendTrxMock,
        extendExpiration: vi.fn(),
      },
    } as unknown as any;

    await expect(
      encodeTronTransfer({
        tronWeb: mockTronWeb,
        from: FIXTURE_M_FROM,
        to: FIXTURE_M_TO,
        sun: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      }),
    ).rejects.toThrow(RangeError);

    expect(sendTrxMock).not.toHaveBeenCalled();
  });
});

describe("decodeTronNativeCall — TransferContract shape (Fixture M decoder)", () => {
  it("returns { kind: 'transfer', from, to, sun } for a valid Fixture-M-shaped tx", () => {
    const tx = {
      raw_data: {
        contract: [
          {
            type: "TransferContract",
            parameter: {
              value: {
                owner_address: FIXTURE_M_OWNER_ADDR_HEX,
                to_address: FIXTURE_M_TO_ADDR_HEX,
                amount: Number(FIXTURE_M_SUN),
              },
            },
          },
        ],
      },
    };

    const decoded = decodeTronNativeCall(tx);

    expect(decoded.kind).toBe("transfer");
    if (decoded.kind !== "transfer") return;

    // Cross-link: addresses must round-trip from hex back to base58check via
    // formatTronAddress (Phase 17 helper).
    expect(decoded.from).toBe(FIXTURE_M_FROM);
    expect(decoded.to).toBe(FIXTURE_M_TO);
    expect(decoded.sun).toBe(FIXTURE_M_SUN);
  });

  it("sun is returned as bigint (BigInt(amount))", () => {
    const tx = {
      raw_data: {
        contract: [
          {
            type: "TransferContract",
            parameter: {
              value: {
                owner_address: FIXTURE_M_OWNER_ADDR_HEX,
                to_address: FIXTURE_M_TO_ADDR_HEX,
                amount: 5_000_000, // 5 TRX
              },
            },
          },
        ],
      },
    };

    const decoded = decodeTronNativeCall(tx);
    expect(decoded.kind).toBe("transfer");
    if (decoded.kind !== "transfer") return;
    expect(decoded.sun).toBe(5_000_000n);
    expect(typeof decoded.sun).toBe("bigint");
  });
});

describe("decodeTronNativeCall — defensive unknown branch (NEVER throws)", () => {
  it("returns { kind: 'unknown' } for FreezeBalanceV2Contract (wrong type)", () => {
    const tx = {
      raw_data: {
        contract: [
          {
            type: "FreezeBalanceV2Contract",
            parameter: {
              value: {
                owner_address: FIXTURE_M_OWNER_ADDR_HEX,
                frozen_balance: 1_000_000,
                resource: "BANDWIDTH",
              },
            },
          },
        ],
      },
    };
    const decoded = decodeTronNativeCall(tx as Parameters<typeof decodeTronNativeCall>[0]);
    expect(decoded.kind).toBe("unknown");
  });

  it("returns { kind: 'unknown' } for empty contract array", () => {
    const tx = { raw_data: { contract: [] } };
    const decoded = decodeTronNativeCall(tx as Parameters<typeof decodeTronNativeCall>[0]);
    expect(decoded.kind).toBe("unknown");
  });

  it("returns { kind: 'unknown' } when parameter.value has missing fields", () => {
    const tx = {
      raw_data: {
        contract: [
          {
            type: "TransferContract",
            parameter: {
              value: {
                // Missing to_address
                owner_address: FIXTURE_M_OWNER_ADDR_HEX,
                amount: 1_000_000,
              },
            },
          },
        ],
      },
    };
    const decoded = decodeTronNativeCall(tx as Parameters<typeof decodeTronNativeCall>[0]);
    expect(decoded.kind).toBe("unknown");
  });

  it("returns { kind: 'unknown' } for TriggerSmartContract type", () => {
    const tx = {
      raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              value: {
                owner_address: FIXTURE_M_OWNER_ADDR_HEX,
                contract_address: FIXTURE_M_TO_ADDR_HEX,
                data: "a9059cbb000000000000000000000000",
              },
            },
          },
        ],
      },
    };
    const decoded = decodeTronNativeCall(tx as Parameters<typeof decodeTronNativeCall>[0]);
    expect(decoded.kind).toBe("unknown");
  });

  it("returns { kind: 'unknown' } when amount is a string (malformed tronweb response)", () => {
    const tx = {
      raw_data: {
        contract: [
          {
            type: "TransferContract",
            parameter: {
              value: {
                owner_address: FIXTURE_M_OWNER_ADDR_HEX,
                to_address: FIXTURE_M_TO_ADDR_HEX,
                amount: "1000000", // string instead of number → unknown
              },
            },
          },
        ],
      },
    };
    const decoded = decodeTronNativeCall(tx as Parameters<typeof decodeTronNativeCall>[0]);
    expect(decoded.kind).toBe("unknown");
  });
});

describe("_tronNative ESM spy-affordance regression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("vi.spyOn(_tronNative, 'encodeTronTransfer') intercepts correctly (ESM seam functional)", async () => {
    const mockResult = {
      transaction: {},
      rawDataHex: "deadbeef",
      rawDataBytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      rawDataObject: {},
      refBlockBytes: "00ad",
      refBlockHash: "8e5e7df4e3c8b9a2",
      expiration: 1779268134000,
      instructionSummary: [
        {
          kind: "native-transfer" as const,
          from: FIXTURE_M_FROM,
          to: FIXTURE_M_TO,
          sun: FIXTURE_M_SUN,
        },
      ],
    };

    const spy = vi
      .spyOn(_tronNative, "encodeTronTransfer")
      .mockResolvedValueOnce(mockResult);

    const fakeInput = {
      tronWeb: {} as Parameters<typeof encodeTronTransfer>[0]["tronWeb"],
      from: FIXTURE_M_FROM,
      to: FIXTURE_M_TO,
      sun: FIXTURE_M_SUN,
    };

    const result = await _tronNative.encodeTronTransfer(fakeInput);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(fakeInput);
    expect(result.rawDataHex).toBe("deadbeef");

    spy.mockRestore();
  });

  it("vi.spyOn(_tronNative, 'decodeTronNativeCall') intercepts correctly", () => {
    const spy = vi
      .spyOn(_tronNative, "decodeTronNativeCall")
      .mockReturnValueOnce({ kind: "unknown" });

    const fakeInput = {
      raw_data: { contract: [] },
    };

    const result = _tronNative.decodeTronNativeCall(
      fakeInput as Parameters<typeof decodeTronNativeCall>[0],
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "unknown" });

    spy.mockRestore();
  });
});
