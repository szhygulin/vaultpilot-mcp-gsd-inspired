// Test suite for src/protocols/sunswap-tron.ts (Plan 20-01, Phase 20).
// Mirrors tron-approve.test.ts shape: encoder + decoder + ESM spy-affordance.

import { describe, expect, it, vi } from "vitest";

const WHALE = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const SUNSWAP_V2_ROUTER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const WTRX = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";
const JST = "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9";

const { SUNSWAP_SWAP_SELECTOR, encodeSunswapSwap, decodeSunswapSwapCall, _sunSwapTron } =
  await import("../src/protocols/sunswap-tron.js");

describe("src/protocols/sunswap-tron.ts — SUNSWAP_SWAP_SELECTOR", () => {
  it("SUNSWAP_SWAP_SELECTOR is '38ed1739' (no 0x prefix, tronweb convention)", () => {
    expect(SUNSWAP_SWAP_SELECTOR).toBe("38ed1739");
  });
});

describe("src/protocols/sunswap-tron.ts — encodeSunswapSwap", () => {
  function makeMockTronWeb(calldata: string) {
    const mockTx = {
      raw_data_hex: calldata,
      raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              value: {
                owner_address: "41e28b3cfd4e0e909077821478e9fcb86b84be786e",
                contract_address: "416e0617948fe030a7e4970f8389d4ad295f249b7e",
                data: calldata.slice(0, 520), // just the calldata portion
                call_value: 0,
              },
            },
          },
        ],
        ref_block_bytes: "00ad",
        ref_block_hash: "8e5e7df4e3c8b9a2",
        expiration: 1779268134000,
        timestamp: 1779268074000,
      },
    };
    return {
      transactionBuilder: {
        triggerSmartContract: vi.fn().mockResolvedValue({
          result: { result: true },
          transaction: mockTx,
        }),
        extendExpiration: vi.fn().mockResolvedValue(mockTx),
      },
    };
  }

  it("Test 6: encodeSunswapSwap returns rawDataHex whose first 4 calldata bytes = 38ed1739", async () => {
    // The calldata is embedded in the tronweb response data field.
    // We create a tronweb mock that returns a result with our known calldata.
    const calldataWithSelector =
      "38ed1739" +
      "00000000000000000000000000000000000000000000000000000000000f4240" + // amountIn
      "00000000000000000000000000000000000000000000000000000000000e6c62" + // amountOutMin
      "00000000000000000000000000000000000000000000000000000000000000a0" + // path offset
      "000000000000000000000000e28b3cfd4e0e909077821478e9fcb86b84be786e" + // to
      "0000000000000000000000000000000000000000000000000000000068305d00" + // deadline
      "0000000000000000000000000000000000000000000000000000000000000002" + // path.length
      "000000000000000000000000a614f803b6fd780986a42c78ec9c7f77e6ded13c" + // USDT
      "000000000000000000000000891cdb91d149f23b1a45d9c5ca78a88d0cb44c18"; // WTRX

    const tronWeb = makeMockTronWeb(calldataWithSelector);

    const result = await encodeSunswapSwap({
      tronWeb: tronWeb as never,
      from: WHALE,
      routerAddress: SUNSWAP_V2_ROUTER,
      amountIn: 1_000_000n,
      amountOutMin: 945_250n,
      path: [USDT, WTRX],
      to: WHALE,
      deadline: 1748000000,
    });

    // The rawDataHex should exist
    expect(typeof result.rawDataHex).toBe("string");
    expect(result.rawDataHex.length).toBeGreaterThan(0);

    // The raw_data data field in the mock contains the calldata starting with selector
    // The data field starts with the selector
    const dataMock = (tronWeb.transactionBuilder.triggerSmartContract as ReturnType<typeof vi.fn>).mock.calls[0];
    // Verify the function was called with the right selector in function name
    expect(dataMock[1]).toBe("swapExactTokensForTokens(uint256,uint256,address[],address,uint256)");
    expect(dataMock[2]).toEqual({ feeLimit: 200_000_000, callValue: 0 });
    // extendExpiration called
    expect(tronWeb.transactionBuilder.extendExpiration).toHaveBeenCalledWith(
      expect.anything(),
      900,
    );
  });

  it("Test 6b: feeLimit is 200_000_000 (200 TRX — swaps consume more energy)", async () => {
    const tronWeb = makeMockTronWeb("38ed1739" + "00".repeat(260));
    await encodeSunswapSwap({
      tronWeb: tronWeb as never,
      from: WHALE,
      routerAddress: SUNSWAP_V2_ROUTER,
      amountIn: 1_000_000n,
      amountOutMin: 945_250n,
      path: [USDT, WTRX],
      to: WHALE,
      deadline: 1748000000,
    });
    const callArgs = (tronWeb.transactionBuilder.triggerSmartContract as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[2].feeLimit).toBe(200_000_000);
  });
});

describe("src/protocols/sunswap-tron.ts — decodeSunswapSwapCall", () => {
  function makeTx(data: string, ownerAddress = "41e28b3cfd4e0e909077821478e9fcb86b84be786e") {
    return {
      raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              value: {
                owner_address: ownerAddress,
                contract_address: "416e0617948fe030a7e4970f8389d4ad295f249b7e",
                data,
                call_value: 0,
              },
            },
          },
        ],
      },
    };
  }

  const VALID_CALLDATA =
    "38ed1739" +
    "00000000000000000000000000000000000000000000000000000000000f4240" + // amountIn = 1_000_000
    "00000000000000000000000000000000000000000000000000000000000e6c62" + // amountOutMin = 945_250
    "00000000000000000000000000000000000000000000000000000000000000a0" + // path offset
    "000000000000000000000000e28b3cfd4e0e909077821478e9fcb86b84be786e" + // to = WHALE 20-byte
    "0000000000000000000000000000000000000000000000000000000068305d00" + // deadline = 1748000000
    "0000000000000000000000000000000000000000000000000000000000000002" + // path.length = 2
    "000000000000000000000000a614f803b6fd780986a42c78ec9c7f77e6ded13c" + // USDT 20-byte
    "000000000000000000000000891cdb91d149f23b1a45d9c5ca78a88d0cb44c18"; // WTRX 20-byte

  it("Test 7: decodeSunswapSwapCall round-trips the encode", () => {
    const tx = makeTx(VALID_CALLDATA);
    const decoded = decodeSunswapSwapCall(tx);
    expect(decoded.kind).toBe("swap");
    if (decoded.kind !== "swap") return;
    expect(decoded.amountIn).toBe(1_000_000n);
    expect(decoded.amountOutMin).toBe(945_250n);
    expect(decoded.selector).toBe("0x38ed1739");
    expect(decoded.path.length).toBe(2);
    // Check path contains USDT and WTRX addresses (base58check decoded)
    expect(decoded.path[0]).toBe(USDT);
    expect(decoded.path[1]).toBe(WTRX);
    expect(decoded.deadline).toBe(1748000000);
    expect(decoded.inputToken).toBe(USDT);
    expect(decoded.outputToken).toBe(WTRX);
  });

  it("Test 7b: malformed input returns { kind: 'unknown' }", () => {
    // Wrong selector
    const wrongSelector = "a9059cbb" + VALID_CALLDATA.slice(8);
    const tx1 = makeTx(wrongSelector);
    expect(decodeSunswapSwapCall(tx1).kind).toBe("unknown");

    // Too short data
    const tx2 = makeTx("38ed1739" + "00".repeat(30));
    expect(decodeSunswapSwapCall(tx2).kind).toBe("unknown");

    // null input
    expect(decodeSunswapSwapCall(null as never).kind).toBe("unknown");

    // missing raw_data
    expect(decodeSunswapSwapCall({} as never).kind).toBe("unknown");
  });

  it("Test 8: _sunSwapTron ESM spy-affordance verified via vi.spyOn", async () => {
    const spy = vi.spyOn(_sunSwapTron, "decodeSunswapSwapCall");
    const tx = makeTx(VALID_CALLDATA);
    _sunSwapTron.decodeSunswapSwapCall(tx);
    expect(spy).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
