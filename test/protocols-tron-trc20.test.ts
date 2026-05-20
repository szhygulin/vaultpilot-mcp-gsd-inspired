// protocols-tron-trc20.test.ts — encoder + decoder regression for
// `src/protocols/tron-trc20.ts`. Phase 18 — Plan 18-03.
//
// Verifies:
//   1. Encoder ABI regression: `data` field starts with selector `"a9059cbb"`.
//   2. Encoder feeLimit=100_000_000 + callValue=0 regression (LOAD-BEARING).
//   3. extendExpiration invocation regression (RESEARCH §Topic 5 LOAD-BEARING).
//   4. Encoder byte-stability: pinned Fixture N inputs → deterministic rawDataHex.
//   5. Decoder shape: Fixture-N-shaped tx → { kind:"transfer", from, to, tokenAddress, amount, selector }.
//   6. Decoder defensive paths: wrong type / truncated data / wrong selector → { kind:"unknown" }.
//   7. _tronTrc20 spy-intercept confirms ESM seam.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  _tronTrc20,
  decodeTronTrc20Call,
  encodeTronTrc20Transfer,
} from "../src/protocols/tron-trc20.js";

// ============================================================================
// Fixture N constants — aligned with `test/signing-fingerprint-tron.test.ts`
// ============================================================================

// Fixture N addresses:
//   FROM = TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t (USDT deployer)
//   USDT_TRC20 contract = TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
//   TO = TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8 (USDC address — valid TRON addr)
const FIXTURE_N_FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const FIXTURE_N_USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const FIXTURE_N_TO = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const FIXTURE_N_AMOUNT = 100_000_000n; // 100 USDT at 6 decimals
const FIXTURE_N_DECIMALS = 6;
const FIXTURE_N_FEE_LIMIT = 100_000_000;
const FIXTURE_N_REF_BLOCK_BYTES = "00ad";
const FIXTURE_N_REF_BLOCK_HASH = "8e5e7df4e3c8b9a2";
const FIXTURE_N_EXPIRATION_BASE = 1779268134000;
const FIXTURE_N_TIMESTAMP = 1779268074000;

// Fixture N raw_data_hex — pinned at `test/signing-fingerprint-tron.test.ts`.
const FIXTURE_N_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244a9059cbb0000000000000000000000003487b63d30b5b2c87fb7ffa8bcfade38eaac1abe0000000000000000000000000000000000000000000000000000000005f5e1007090f490a5e433900180c2d72f";

// Hex addresses as tronweb surfaces in parameter.value
const FIXTURE_N_OWNER_ADDR_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const FIXTURE_N_CONTRACT_ADDR_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";

// ABI-encoded data (no 0x prefix per tronweb convention):
//   selector (4 bytes) + padded recipient (32 bytes) + padded amount (32 bytes)
const FIXTURE_N_CALLDATA =
  "a9059cbb" +
  "0000000000000000000000003487b63d30b5b2c87fb7ffa8bcfade38eaac1abe" +
  "0000000000000000000000000000000000000000000000000000000005f5e100";

// ============================================================================
// Helper: build a Fixture-N-shaped TronWeb mock
// ============================================================================

/**
 * Build a stub TronWeb that returns a Fixture-N-shaped tx from
 * `triggerSmartContract` and the same tx (with expiration extended by 900_000ms)
 * from `extendExpiration`.
 *
 * IMPORTANT: for the Fixture N encoder byte-stability test, `extendExpiration`
 * returns a tx with the SAME `raw_data_hex` as the base tx. This matches the
 * fixture computation approach: the raw_data_hex is pinned for byte-stable
 * fingerprint assertion.
 */
function buildFixtureNTronWeb(): {
  transactionBuilder: {
    triggerSmartContract: ReturnType<typeof vi.fn>;
    extendExpiration: ReturnType<typeof vi.fn>;
  };
} {
  const baseTx = {
    raw_data_hex: FIXTURE_N_RAW_DATA_HEX,
    raw_data: {
      contract: [
        {
          type: "TriggerSmartContract",
          parameter: {
            value: {
              owner_address: FIXTURE_N_OWNER_ADDR_HEX,
              contract_address: FIXTURE_N_CONTRACT_ADDR_HEX,
              data: FIXTURE_N_CALLDATA,
              call_value: 0,
            },
          },
        },
      ],
      ref_block_bytes: FIXTURE_N_REF_BLOCK_BYTES,
      ref_block_hash: FIXTURE_N_REF_BLOCK_HASH,
      expiration: FIXTURE_N_EXPIRATION_BASE,
      timestamp: FIXTURE_N_TIMESTAMP,
    },
    visible: false,
    txID: "deadbeef",
  };

  const wrappedResult = {
    result: { result: true },
    transaction: baseTx,
  };

  const extendedTx = {
    ...baseTx,
    raw_data: {
      ...baseTx.raw_data,
      expiration: FIXTURE_N_EXPIRATION_BASE + 900_000,
    },
  };

  return {
    transactionBuilder: {
      triggerSmartContract: vi.fn().mockResolvedValue(wrappedResult),
      extendExpiration: vi.fn().mockResolvedValue(extendedTx),
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Encoder: ABI selector regression
// ============================================================================

describe("encodeTronTrc20Transfer — ABI selector regression (0xa9059cbb)", () => {
  it("calldata starts with selector a9059cbb (no 0x prefix, per tronweb convention)", async () => {
    const mockTronWeb = buildFixtureNTronWeb();

    const result = await encodeTronTrc20Transfer({
      tronWeb: mockTronWeb as unknown as Parameters<typeof encodeTronTrc20Transfer>[0]["tronWeb"],
      from: FIXTURE_N_FROM,
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: FIXTURE_N_AMOUNT,
      decimals: FIXTURE_N_DECIMALS,
    });

    // The calldata embedded in the built tx should start with the transfer selector.
    const txData = result.rawDataObject as {
      contract: Array<{ parameter: { value: { data: string } } }>;
    };
    const dataField = txData.contract[0]?.parameter.value.data ?? "";
    expect(dataField.startsWith("a9059cbb")).toBe(true);
  });
});

// ============================================================================
// Encoder: feeLimit + callValue regression (LOAD-BEARING — CONTEXT D-11)
// ============================================================================

describe("encodeTronTrc20Transfer — feeLimit:100_000_000 + callValue:0 regression (LOAD-BEARING)", () => {
  it("calls triggerSmartContract with { feeLimit: 100_000_000, callValue: 0 } options", async () => {
    const mockTronWeb = buildFixtureNTronWeb();

    await encodeTronTrc20Transfer({
      tronWeb: mockTronWeb as unknown as Parameters<typeof encodeTronTrc20Transfer>[0]["tronWeb"],
      from: FIXTURE_N_FROM,
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: FIXTURE_N_AMOUNT,
      decimals: FIXTURE_N_DECIMALS,
    });

    expect(mockTronWeb.transactionBuilder.triggerSmartContract).toHaveBeenCalledTimes(1);
    const callArgs = mockTronWeb.transactionBuilder.triggerSmartContract.mock.calls[0];
    // Arg[0] = contractAddress, arg[1] = functionSelector, arg[2] = options
    expect(callArgs[0]).toBe(FIXTURE_N_USDT_TRC20);
    expect(callArgs[1]).toBe("transfer(address,uint256)");
    expect(callArgs[2]).toEqual({ feeLimit: FIXTURE_N_FEE_LIMIT, callValue: 0 });
    // Arg[3] = ABI parameters
    expect(callArgs[3]).toEqual([
      { type: "address", value: FIXTURE_N_TO },
      { type: "uint256", value: FIXTURE_N_AMOUNT.toString() },
    ]);
    // Arg[4] = issuerAddress (from)
    expect(callArgs[4]).toBe(FIXTURE_N_FROM);
  });

  it("amount is passed as decimal string (not bigint) to tronweb — prevents silent truncation", async () => {
    const mockTronWeb = buildFixtureNTronWeb();

    await encodeTronTrc20Transfer({
      tronWeb: mockTronWeb as unknown as Parameters<typeof encodeTronTrc20Transfer>[0]["tronWeb"],
      from: FIXTURE_N_FROM,
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: FIXTURE_N_AMOUNT,
      decimals: FIXTURE_N_DECIMALS,
    });

    const callArgs = mockTronWeb.transactionBuilder.triggerSmartContract.mock.calls[0];
    const params = callArgs[3] as Array<{ type: string; value: unknown }>;
    const amountParam = params[1];
    // Must be a string, not a bigint.
    expect(typeof amountParam?.value).toBe("string");
    expect(amountParam?.value).toBe("100000000");
  });
});

// ============================================================================
// Encoder: extendExpiration invocation regression (LOAD-BEARING — RESEARCH §Topic 5)
// ============================================================================

describe("encodeTronTrc20Transfer — extendExpiration(tx, 900) regression (LOAD-BEARING)", () => {
  it("calls extendExpiration with (tx, 900) exactly once after triggerSmartContract", async () => {
    const mockTronWeb = buildFixtureNTronWeb();

    await encodeTronTrc20Transfer({
      tronWeb: mockTronWeb as unknown as Parameters<typeof encodeTronTrc20Transfer>[0]["tronWeb"],
      from: FIXTURE_N_FROM,
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: FIXTURE_N_AMOUNT,
      decimals: FIXTURE_N_DECIMALS,
    });

    expect(mockTronWeb.transactionBuilder.extendExpiration).toHaveBeenCalledTimes(1);
    const extArgs = mockTronWeb.transactionBuilder.extendExpiration.mock.calls[0];
    // Arg[0] = the transaction object from triggerSmartContract result.transaction
    // Arg[1] = 900 (15-minute extension)
    expect(extArgs[1]).toBe(900);
  });

  it("rawDataHex in result comes from extendExpiration return value (not original triggerSmartContract tx)", async () => {
    // The extendExpiration mock returns a tx with updated expiration but same raw_data_hex.
    // The encoder must use the post-extension tx for rawDataHex.
    const mockTronWeb = buildFixtureNTronWeb();

    const result = await encodeTronTrc20Transfer({
      tronWeb: mockTronWeb as unknown as Parameters<typeof encodeTronTrc20Transfer>[0]["tronWeb"],
      from: FIXTURE_N_FROM,
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: FIXTURE_N_AMOUNT,
      decimals: FIXTURE_N_DECIMALS,
    });

    // Expiration should be the extended value (base + 900_000ms)
    expect(result.expiration).toBe(FIXTURE_N_EXPIRATION_BASE + 900_000);
    // rawDataHex is still the pinned literal (mock returns same hex after extension)
    expect(result.rawDataHex).toBe(FIXTURE_N_RAW_DATA_HEX);
  });
});

// ============================================================================
// Encoder: byte-stability (pinned Fixture N inputs)
// ============================================================================

describe("encodeTronTrc20Transfer — Fixture N byte-stability", () => {
  it("returns deterministic rawDataHex for pinned Fixture N inputs", async () => {
    const mockTronWeb = buildFixtureNTronWeb();

    const result = await encodeTronTrc20Transfer({
      tronWeb: mockTronWeb as unknown as Parameters<typeof encodeTronTrc20Transfer>[0]["tronWeb"],
      from: FIXTURE_N_FROM,
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: FIXTURE_N_AMOUNT,
      decimals: FIXTURE_N_DECIMALS,
    });

    expect(result.rawDataHex).toBe(FIXTURE_N_RAW_DATA_HEX);
    expect(result.rawDataBytes).toBeInstanceOf(Uint8Array);
    expect(result.rawDataBytes.length).toBe(211); // Fixture N byte-length anchor
    expect(result.contractAddress).toBe(FIXTURE_N_USDT_TRC20);
    expect(result.refBlockBytes).toBe(FIXTURE_N_REF_BLOCK_BYTES);
    expect(result.refBlockHash).toBe(FIXTURE_N_REF_BLOCK_HASH);
  });

  it("instructionSummary carries kind:trc20-transfer with correct fields", async () => {
    const mockTronWeb = buildFixtureNTronWeb();

    const result = await encodeTronTrc20Transfer({
      tronWeb: mockTronWeb as unknown as Parameters<typeof encodeTronTrc20Transfer>[0]["tronWeb"],
      from: FIXTURE_N_FROM,
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: FIXTURE_N_AMOUNT,
      decimals: FIXTURE_N_DECIMALS,
    });

    expect(result.instructionSummary).toHaveLength(1);
    const summary = result.instructionSummary[0];
    expect(summary?.kind).toBe("trc20-transfer");
    if (summary?.kind === "trc20-transfer") {
      expect(summary.from).toBe(FIXTURE_N_FROM);
      expect(summary.to).toBe(FIXTURE_N_TO);
      expect(summary.tokenAddress).toBe(FIXTURE_N_USDT_TRC20);
      expect(summary.amount).toBe(FIXTURE_N_AMOUNT);
      expect(summary.decimals).toBe(FIXTURE_N_DECIMALS);
    }
  });
});

// ============================================================================
// Encoder: error path — build failure
// ============================================================================

describe("encodeTronTrc20Transfer — error handling", () => {
  it("throws when triggerSmartContract returns result.result.result !== true", async () => {
    const failMock = {
      transactionBuilder: {
        triggerSmartContract: vi.fn().mockResolvedValue({
          result: { result: false, message: "CONTRACT_VALIDATE_ERROR" },
          transaction: undefined,
        }),
        extendExpiration: vi.fn(),
      },
    };

    await expect(
      encodeTronTrc20Transfer({
        tronWeb: failMock as unknown as Parameters<typeof encodeTronTrc20Transfer>[0]["tronWeb"],
        from: FIXTURE_N_FROM,
        to: FIXTURE_N_TO,
        tokenAddress: FIXTURE_N_USDT_TRC20,
        amount: FIXTURE_N_AMOUNT,
        decimals: FIXTURE_N_DECIMALS,
      }),
    ).rejects.toThrow("triggerSmartContract build failed");
  });
});

// ============================================================================
// Decoder: shape regression
// ============================================================================

describe("decodeTronTrc20Call — shape regression", () => {
  it("decodes Fixture-N-shaped tx → { kind:transfer, from, to, tokenAddress, amount, selector }", () => {
    const tx = {
      raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              value: {
                owner_address: FIXTURE_N_OWNER_ADDR_HEX,
                contract_address: FIXTURE_N_CONTRACT_ADDR_HEX,
                data: FIXTURE_N_CALLDATA,
                call_value: 0,
              },
            },
          },
        ],
      },
    };

    const result = decodeTronTrc20Call(tx);

    expect(result.kind).toBe("transfer");
    if (result.kind === "transfer") {
      expect(result.from).toBe(FIXTURE_N_FROM);
      expect(result.to).toBe(FIXTURE_N_TO);
      expect(result.tokenAddress).toBe(FIXTURE_N_USDT_TRC20);
      expect(result.amount).toBe(FIXTURE_N_AMOUNT);
      expect(result.selector).toBe("0xa9059cbb");
    }
  });
});

// ============================================================================
// Decoder: defensive paths
// ============================================================================

describe("decodeTronTrc20Call — defensive paths", () => {
  it("returns { kind:unknown } when contract type is TransferContract (not TriggerSmartContract)", () => {
    const tx = {
      raw_data: {
        contract: [
          {
            type: "TransferContract",
            parameter: {
              value: {
                owner_address: FIXTURE_N_OWNER_ADDR_HEX,
                contract_address: FIXTURE_N_CONTRACT_ADDR_HEX,
                data: FIXTURE_N_CALLDATA,
              },
            },
          },
        ],
      },
    };
    expect(decodeTronTrc20Call(tx)).toEqual({ kind: "unknown" });
  });

  it("returns { kind:unknown } when data field is shorter than 136 hex chars", () => {
    const tx = {
      raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              value: {
                owner_address: FIXTURE_N_OWNER_ADDR_HEX,
                contract_address: FIXTURE_N_CONTRACT_ADDR_HEX,
                // Only 8 chars — just the selector, missing address + amount
                data: "a9059cbb",
              },
            },
          },
        ],
      },
    };
    expect(decodeTronTrc20Call(tx)).toEqual({ kind: "unknown" });
  });

  it("returns { kind:unknown } when selector is not 0xa9059cbb (e.g. transferFrom 0x23b872dd)", () => {
    // Build a calldata with the transferFrom selector instead of transfer
    const transferFromCalldata =
      "23b872dd" +
      "0000000000000000000000003487b63d30b5b2c87fb7ffa8bcfade38eaac1abe" +
      "0000000000000000000000003487b63d30b5b2c87fb7ffa8bcfade38eaac1abe" +
      "0000000000000000000000000000000000000000000000000000000005f5e100";
    const tx = {
      raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              value: {
                owner_address: FIXTURE_N_OWNER_ADDR_HEX,
                contract_address: FIXTURE_N_CONTRACT_ADDR_HEX,
                data: transferFromCalldata,
              },
            },
          },
        ],
      },
    };
    expect(decodeTronTrc20Call(tx)).toEqual({ kind: "unknown" });
  });

  it("returns { kind:unknown } when raw_data.contract is empty", () => {
    const tx = { raw_data: { contract: [] } };
    expect(decodeTronTrc20Call(tx)).toEqual({ kind: "unknown" });
  });

  it("returns { kind:unknown } when raw_data.contract is missing", () => {
    expect(
      decodeTronTrc20Call({ raw_data: { contract: undefined as unknown as [] } }),
    ).toEqual({ kind: "unknown" });
  });

  it("never throws on malformed input (all defensive paths return { kind:unknown })", () => {
    expect(() => decodeTronTrc20Call(null as unknown as Parameters<typeof decodeTronTrc20Call>[0])).not.toThrow();
    expect(() => decodeTronTrc20Call(undefined as unknown as Parameters<typeof decodeTronTrc20Call>[0])).not.toThrow();
    expect(decodeTronTrc20Call(null as unknown as Parameters<typeof decodeTronTrc20Call>[0])).toEqual({ kind: "unknown" });
  });
});

// ============================================================================
// ESM spy-affordance
// ============================================================================

describe("_tronTrc20 ESM spy-affordance", () => {
  it("spy intercepts _tronTrc20.encodeTronTrc20Transfer", async () => {
    const fakeResult = {
      transaction: {},
      rawDataHex: "deadbeef",
      rawDataBytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      rawDataObject: {},
      refBlockBytes: "00ad",
      refBlockHash: "8e5e7df4e3c8b9a2",
      expiration: 9999,
      contractAddress: FIXTURE_N_USDT_TRC20,
      instructionSummary: [],
    };

    const spy = vi.spyOn(_tronTrc20, "encodeTronTrc20Transfer").mockResolvedValue(fakeResult);

    const result = await _tronTrc20.encodeTronTrc20Transfer({
      tronWeb: {} as unknown as Parameters<typeof encodeTronTrc20Transfer>[0]["tronWeb"],
      from: FIXTURE_N_FROM,
      to: FIXTURE_N_TO,
      tokenAddress: FIXTURE_N_USDT_TRC20,
      amount: 1n,
      decimals: 6,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBe(fakeResult);
    spy.mockRestore();
  });

  it("spy intercepts _tronTrc20.decodeTronTrc20Call", () => {
    const spy = vi.spyOn(_tronTrc20, "decodeTronTrc20Call").mockReturnValue({
      kind: "unknown",
    });

    const result = _tronTrc20.decodeTronTrc20Call({
      raw_data: { contract: [] },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "unknown" });
    spy.mockRestore();
  });
});
