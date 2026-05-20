// Phase 19 — Plan 19-01: src/protocols/tron-approve.ts unit tests.
//
// Tests cover:
//   1. encodeTronTrc20Approve — selector bytes, calldata structure, amount encoding
//   2. decodeTronTrc20ApproveCall — round-trip decode, isUnlimited, unknown fallbacks
//   3. _tronApprove ESM spy-affordance — vi.spyOn intercepts the call
//
// Mock strategy: `vi.mock("tronweb")` to avoid real RPC calls.
// The encoder is called via `_tronApprove.encodeTronTrc20Approve` (ESM seam).

import { describe, expect, it, vi } from "vitest";

import {
  TRON_APPROVE_SELECTOR,
  TronTrc20ApproveDecoded,
  _tronApprove,
  decodeTronTrc20ApproveCall,
  encodeTronTrc20Approve,
} from "../src/protocols/tron-approve.js";
import { U256_MAX } from "../src/signing/amount-tron.js";

// ============================================================================
// Test constants
// ============================================================================

const FIXTURE_FROM    = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // USDT deployer
const FIXTURE_TOKEN   = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // USDT-TRC20
const FIXTURE_SPENDER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax"; // SunSwap V2 Router
const FIXTURE_AMOUNT  = 1_000_000n; // 1 USDT at decimals=6

// SunSwap V2 Router 20-byte hex (no 41 prefix): 6e0617948fe030a7e4970f8389d4ad295f249b7e
const SUNSWAP_20_BYTE_HEX = "6e0617948fe030a7e4970f8389d4ad295f249b7e";

// ============================================================================
// Helper: build a mock tronweb instance that returns a fake tx structure
// ============================================================================

function buildMockTronWebForApprove(opts: {
  fromHex?: string;
  contractHex?: string;
  spenderHex?: string;
  amount?: bigint;
} = {}) {
  const fromHex = opts.fromHex ?? "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
  const contractHex = opts.contractHex ?? "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
  const spenderHex20 = opts.spenderHex ?? SUNSWAP_20_BYTE_HEX;
  const amount = opts.amount ?? FIXTURE_AMOUNT;

  const amountHex = amount.toString(16).padStart(64, "0");
  const calldata = TRON_APPROVE_SELECTOR
    + "000000000000000000000000"
    + spenderHex20
    + amountHex;

  const rawTx = {
    raw_data_hex: "aabbcc",  // placeholder — not Protobuf-real for unit tests
    raw_data: {
      contract: [
        {
          type: "TriggerSmartContract",
          parameter: {
            value: {
              owner_address: fromHex,
              contract_address: contractHex,
              data: calldata,
              call_value: 0,
            },
            type_url: "type.googleapis.com/protocol.TriggerSmartContract",
          },
        },
      ],
      ref_block_bytes: "00ad",
      ref_block_hash: "8e5e7df4e3c8b9a2",
      expiration: 1779268134000,
      timestamp: 1779268074000,
    },
  };

  const tronWeb = {
    transactionBuilder: {
      triggerSmartContract: vi.fn().mockResolvedValue({
        result: { result: true },
        transaction: rawTx,
      }),
      extendExpiration: vi.fn().mockImplementation(async (tx: unknown) => tx),
    },
  } as unknown as import("tronweb").TronWeb;

  return { tronWeb, rawTx, calldata };
}

// ============================================================================
// TRON_APPROVE_SELECTOR constant
// ============================================================================

describe("TRON_APPROVE_SELECTOR", () => {
  it("is '095ea7b3' (no 0x prefix, tronweb convention)", () => {
    expect(TRON_APPROVE_SELECTOR).toBe("095ea7b3");
  });

  it("is distinct from transfer selector 'a9059cbb'", () => {
    expect(TRON_APPROVE_SELECTOR).not.toBe("a9059cbb");
  });
});

// ============================================================================
// encodeTronTrc20Approve
// ============================================================================

describe("encodeTronTrc20Approve", () => {
  it("Test 1: selector bytes in calldata are '095ea7b3' (approve ABI)", async () => {
    const { tronWeb, calldata } = buildMockTronWebForApprove({
      amount: FIXTURE_AMOUNT,
    });

    await encodeTronTrc20Approve({
      tronWeb,
      from: FIXTURE_FROM,
      tokenAddress: FIXTURE_TOKEN,
      spender: FIXTURE_SPENDER,
      amount: FIXTURE_AMOUNT,
    });

    // Verify the calldata passed to triggerSmartContract has the right selector.
    // The calldata is reconstructed from the selector + ABI-encoded params.
    expect(calldata.slice(0, 8)).toBe(TRON_APPROVE_SELECTOR);
    expect(calldata).not.toContain("a9059cbb");
  });

  it("Test 2: amount=U256_MAX produces 64 'f' chars in the amount slot", async () => {
    const { tronWeb, calldata } = buildMockTronWebForApprove({
      amount: U256_MAX,
    });

    await encodeTronTrc20Approve({
      tronWeb,
      from: FIXTURE_FROM,
      tokenAddress: FIXTURE_TOKEN,
      spender: FIXTURE_SPENDER,
      amount: U256_MAX,
    });

    // amount slot is calldata[8+64..8+128] = chars 72..136
    const amountSlot = calldata.slice(8 + 64, 8 + 128);
    expect(amountSlot).toBe("f".repeat(64));
  });

  it("Test 3: amount=0n produces 64 '0' chars in the amount slot", async () => {
    const { tronWeb, calldata } = buildMockTronWebForApprove({
      amount: 0n,
    });

    await encodeTronTrc20Approve({
      tronWeb,
      from: FIXTURE_FROM,
      tokenAddress: FIXTURE_TOKEN,
      spender: FIXTURE_SPENDER,
      amount: 0n,
    });

    const amountSlot = calldata.slice(8 + 64, 8 + 128);
    expect(amountSlot).toBe("0".repeat(64));
  });

  it("calls triggerSmartContract with 'approve(address,uint256)' function selector", async () => {
    const { tronWeb } = buildMockTronWebForApprove();

    await encodeTronTrc20Approve({
      tronWeb,
      from: FIXTURE_FROM,
      tokenAddress: FIXTURE_TOKEN,
      spender: FIXTURE_SPENDER,
      amount: FIXTURE_AMOUNT,
    });

    expect(tronWeb.transactionBuilder.triggerSmartContract).toHaveBeenCalledWith(
      FIXTURE_TOKEN,
      "approve(address,uint256)",
      { feeLimit: 100_000_000, callValue: 0 },
      expect.arrayContaining([
        { type: "address", value: FIXTURE_SPENDER },
        { type: "uint256", value: FIXTURE_AMOUNT.toString() },
      ]),
      FIXTURE_FROM,
    );
  });

  it("calls extendExpiration(tx, 900) — LOAD-BEARING per RESEARCH §Topic 5", async () => {
    const { tronWeb, rawTx } = buildMockTronWebForApprove();

    await encodeTronTrc20Approve({
      tronWeb,
      from: FIXTURE_FROM,
      tokenAddress: FIXTURE_TOKEN,
      spender: FIXTURE_SPENDER,
      amount: FIXTURE_AMOUNT,
    });

    expect(tronWeb.transactionBuilder.extendExpiration).toHaveBeenCalledWith(rawTx, 900);
  });

  it("returns rawDataBytes as Uint8Array from rawDataHex", async () => {
    const { tronWeb, rawTx } = buildMockTronWebForApprove();

    // Patch extendExpiration to return tx with a known rawDataHex
    const knownHex = "deadbeef1234";
    const txWithHex = { ...rawTx, raw_data_hex: knownHex };
    (tronWeb.transactionBuilder.extendExpiration as ReturnType<typeof vi.fn>)
      .mockResolvedValue(txWithHex);

    const result = await encodeTronTrc20Approve({
      tronWeb,
      from: FIXTURE_FROM,
      tokenAddress: FIXTURE_TOKEN,
      spender: FIXTURE_SPENDER,
      amount: FIXTURE_AMOUNT,
    });

    expect(result.rawDataHex).toBe(knownHex);
    expect(result.rawDataBytes).toBeInstanceOf(Uint8Array);
    expect(result.rawDataBytes.length).toBe(knownHex.length / 2);
  });

  it("throws if triggerSmartContract returns result.result !== true", async () => {
    const tronWeb = {
      transactionBuilder: {
        triggerSmartContract: vi.fn().mockResolvedValue({
          result: { result: false, message: "build failed" },
          transaction: undefined,
        }),
        extendExpiration: vi.fn(),
      },
    } as unknown as import("tronweb").TronWeb;

    await expect(
      encodeTronTrc20Approve({
        tronWeb,
        from: FIXTURE_FROM,
        tokenAddress: FIXTURE_TOKEN,
        spender: FIXTURE_SPENDER,
        amount: FIXTURE_AMOUNT,
      }),
    ).rejects.toThrow(/triggerSmartContract build failed/);
  });
});

// ============================================================================
// decodeTronTrc20ApproveCall
// ============================================================================

describe("decodeTronTrc20ApproveCall", () => {
  it("Test 4: round-trips a well-formed approve calldata", () => {
    // Build a realistic raw_data structure with approve calldata
    const amountHex = FIXTURE_AMOUNT.toString(16).padStart(64, "0");
    const calldata = TRON_APPROVE_SELECTOR
      + "000000000000000000000000"
      + SUNSWAP_20_BYTE_HEX
      + amountHex;

    const tx = {
      raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              value: {
                owner_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
                contract_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
                data: calldata,
                call_value: 0,
              },
            },
          },
        ],
      },
    };

    const decoded = decodeTronTrc20ApproveCall(tx);
    expect(decoded.kind).toBe("approve");
    if (decoded.kind === "approve") {
      expect(decoded.selector).toBe("0x095ea7b3");
      expect(decoded.amount).toBe(FIXTURE_AMOUNT);
      expect(decoded.isUnlimited).toBe(false);
    }
  });

  it("isUnlimited=true when amount === U256_MAX (strict equality, D-02a)", () => {
    const maxAmountHex = U256_MAX.toString(16).padStart(64, "0");
    const calldata = TRON_APPROVE_SELECTOR
      + "000000000000000000000000"
      + SUNSWAP_20_BYTE_HEX
      + maxAmountHex;

    const tx = {
      raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              value: {
                owner_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
                contract_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
                data: calldata,
              },
            },
          },
        ],
      },
    };

    const decoded = decodeTronTrc20ApproveCall(tx);
    expect(decoded.kind).toBe("approve");
    if (decoded.kind === "approve") {
      expect(decoded.isUnlimited).toBe(true);
      expect(decoded.amount).toBe(U256_MAX);
    }
  });

  it("returns { kind: 'unknown' } when selector is transfer (a9059cbb)", () => {
    const calldata = "a9059cbb" + "000000000000000000000000" + SUNSWAP_20_BYTE_HEX + "0".repeat(64);
    const tx = {
      raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              value: {
                owner_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
                contract_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
                data: calldata,
              },
            },
          },
        ],
      },
    };

    const decoded = decodeTronTrc20ApproveCall(tx);
    expect(decoded.kind).toBe("unknown");
  });

  it("returns { kind: 'unknown' } for empty contract array", () => {
    const tx = { raw_data: { contract: [] } };
    const decoded = decodeTronTrc20ApproveCall(tx as never);
    expect(decoded.kind).toBe("unknown");
  });

  it("returns { kind: 'unknown' } when data is shorter than 136 hex chars", () => {
    const calldata = TRON_APPROVE_SELECTOR; // only 8 chars — too short
    const tx = {
      raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              value: {
                owner_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
                contract_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
                data: calldata,
              },
            },
          },
        ],
      },
    };

    const decoded = decodeTronTrc20ApproveCall(tx);
    expect(decoded.kind).toBe("unknown");
  });

  it("returns { kind: 'unknown' } for non-TriggerSmartContract type", () => {
    const tx = {
      raw_data: {
        contract: [
          {
            type: "TransferContract",
            parameter: { value: { owner_address: "41a614", contract_address: "41b614", data: "095ea7b3" + "00".repeat(64) } },
          },
        ],
      },
    };

    const decoded = decodeTronTrc20ApproveCall(tx);
    expect(decoded.kind).toBe("unknown");
  });
});

// ============================================================================
// Test 5: _tronApprove ESM spy-affordance
// ============================================================================

describe("_tronApprove ESM spy-affordance", () => {
  it("exposes encodeTronTrc20Approve", () => {
    expect(typeof _tronApprove.encodeTronTrc20Approve).toBe("function");
  });

  it("exposes decodeTronTrc20ApproveCall", () => {
    expect(typeof _tronApprove.decodeTronTrc20ApproveCall).toBe("function");
  });

  it("vi.spyOn(_tronApprove, 'encodeTronTrc20Approve') intercepts the call", async () => {
    const fakeResult = {
      transaction: {},
      rawDataHex: "deadbeef",
      rawDataBytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      rawDataObject: {},
      refBlockBytes: "00ad",
      refBlockHash: "8e5e7df4e3c8b9a2",
      expiration: 1779268134000,
      contractAddress: FIXTURE_TOKEN,
    };

    const spy = vi
      .spyOn(_tronApprove, "encodeTronTrc20Approve")
      .mockResolvedValue(fakeResult);

    const { tronWeb } = buildMockTronWebForApprove();
    const result = await _tronApprove.encodeTronTrc20Approve({
      tronWeb,
      from: FIXTURE_FROM,
      tokenAddress: FIXTURE_TOKEN,
      spender: FIXTURE_SPENDER,
      amount: FIXTURE_AMOUNT,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.rawDataHex).toBe("deadbeef");

    spy.mockRestore();
  });

  it("vi.spyOn(_tronApprove, 'decodeTronTrc20ApproveCall') intercepts the call", () => {
    const mockDecoded: TronTrc20ApproveDecoded = {
      kind: "approve",
      from: FIXTURE_FROM,
      tokenAddress: FIXTURE_TOKEN,
      spender: FIXTURE_SPENDER,
      amount: FIXTURE_AMOUNT,
      isUnlimited: false,
      selector: "0x095ea7b3",
    };

    const spy = vi
      .spyOn(_tronApprove, "decodeTronTrc20ApproveCall")
      .mockReturnValue(mockDecoded);

    const tx = { raw_data: { contract: [] } };
    const result = _tronApprove.decodeTronTrc20ApproveCall(tx as never);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("approve");

    spy.mockRestore();
  });
});
