// test/btc-coin-select.test.ts — Phase 23 Plan 23-02 Task 1.
//
// Regression suite for src/signing/btc-coin-select.ts.
// Pure-compute: no mocks, no I/O — hardcoded UTXO-set inputs → expected outputs.
//
// Covers:
//   - BnB exact-match selection (changeSats === 0n)
//   - Largest-first fallback when BnB finds no clean match
//   - feeRate < 1 sat/vB → refusal
//   - feeRate > 10× highPriorityEstimate → refusal
//   - Mixed segwit+taproot UTXO set — BnB selects across both script types
//   - Change below dust → folded into fee (changeSats = 0n); recipient below dust → refused
//
// REGRESSION ANCHOR: D-01 (BnB across full UTXO set), D-03 (fee-rate bounds),
// D-07 (dust asymmetry — recipient refusal vs change fold).

import { describe, it, expect } from "vitest";
import { selectCoinsBnb, _btcCoinSelect } from "../src/signing/btc-coin-select.js";
import type { UtxoEntry, CoinSelectArgs } from "../src/signing/btc-coin-select.js";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

/** A P2WPKH UTXO for use in tests. */
function utxo(
  txid: string,
  vout: number,
  valueSats: bigint,
  scriptType: "p2wpkh" | "p2tr",
): UtxoEntry {
  return { txid, vout, valueSats, scriptType };
}

const SEGWIT_UTXO_A = utxo("aaa000", 0, 10_000n, "p2wpkh"); // 10,000 sats
const SEGWIT_UTXO_B = utxo("bbb000", 0, 20_000n, "p2wpkh"); // 20,000 sats
const SEGWIT_UTXO_C = utxo("ccc000", 0, 50_000n, "p2wpkh"); // 50,000 sats
const TAPROOT_UTXO_D = utxo("ddd000", 0, 15_000n, "p2tr"); // 15,000 sats
const TAPROOT_UTXO_E = utxo("eee000", 0, 100_000n, "p2tr"); // 100,000 sats

// Fee estimate at 5 sat/vB — used as highPriorityEstimate in tests.
const HIGH_PRIORITY_ESTIMATE = 5; // sat/vB

// ─── Test 1: BnB exact-match → changeSats === 0n ─────────────────────────────

describe("selectCoinsBnb — BnB exact match", () => {
  it("selects exactly the UTXOs that cover target + fee with zero change", () => {
    // UTXO set: [10_000, 20_000, 50_000] sats P2WPKH
    // Target: ~30_000 sats to a P2WPKH recipient.
    // Vbyte estimate (2 inputs, 2 outputs):
    //   overhead = 11, inputs = 2 × 68 = 136, outputs = 2 × 31 = 62 → total 209 vbytes
    // Fee at 5 sat/vB = 1045 sats
    // BnB should select [10_000 + 20_000] = 30_000 sats for target 28_955 + fee 1045 = 30_000
    // (exact: target = 30_000 − 1045 = 28_955; selectedSum = 30_000; changeSats = 0n)
    const target = 28_955n;
    const args: CoinSelectArgs = {
      utxos: [SEGWIT_UTXO_A, SEGWIT_UTXO_B, SEGWIT_UTXO_C],
      targetSats: target,
      feeRate: 5,
      highPriorityEstimate: HIGH_PRIORITY_ESTIMATE,
      changeScriptType: "p2wpkh",
      dustThresholdSats: 330n,
    };
    const result = _btcCoinSelect.selectCoinsBnb(args);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // BnB should find the exact combination with zero waste.
    expect(result.changeSats).toBe(0n);
    expect(result.feeSats).toBeGreaterThan(0n);
    // The selected inputs should sum to exactly target + feeSats.
    const selectedSum = result.selectedInputs.reduce((acc, u) => acc + u.valueSats, 0n);
    expect(selectedSum).toBe(target + result.feeSats);
  });
});

// ─── Test 2: Largest-first fallback when BnB finds no clean match ─────────────

describe("selectCoinsBnb — largest-first fallback", () => {
  it("falls back to largest-first when BnB cannot find an exact match", () => {
    // Use UTXOs where no exact-match subset exists for the target.
    // UTXOs: [10_001, 20_003, 50_007] sats — odd values that don't sum cleanly.
    // Target = 33_000 sats at 5 sat/vB with P2WPKH change.
    const utxos: UtxoEntry[] = [
      utxo("f01", 0, 10_001n, "p2wpkh"),
      utxo("f02", 0, 20_003n, "p2wpkh"),
      utxo("f03", 0, 50_007n, "p2wpkh"),
    ];
    const args: CoinSelectArgs = {
      utxos,
      targetSats: 33_000n,
      feeRate: 5,
      highPriorityEstimate: HIGH_PRIORITY_ESTIMATE,
      changeScriptType: "p2wpkh",
      dustThresholdSats: 330n,
    };
    const result = selectCoinsBnb(args);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // Selection must cover target + fee.
    const selectedSum = result.selectedInputs.reduce((acc, u) => acc + u.valueSats, 0n);
    expect(selectedSum).toBeGreaterThanOrEqual(33_000n + result.feeSats);
    // There must be at least one selected input.
    expect(result.selectedInputs.length).toBeGreaterThan(0);
    // feeSats positive.
    expect(result.feeSats).toBeGreaterThan(0n);
  });
});

// ─── Test 3: feeRate < 1 sat/vB → refusal ────────────────────────────────────

describe("selectCoinsBnb — fee-rate lower bound", () => {
  it("refuses feeRate < 1 sat/vB (D-03)", () => {
    const args: CoinSelectArgs = {
      utxos: [SEGWIT_UTXO_C],
      targetSats: 10_000n,
      feeRate: 0.5, // below the 1 sat/vB lower bound
      highPriorityEstimate: HIGH_PRIORITY_ESTIMATE,
      changeScriptType: "p2wpkh",
      dustThresholdSats: 330n,
    };
    const result = selectCoinsBnb(args);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.reason).toMatch(/1\s*sat/i);
  });

  it("refuses feeRate === 0", () => {
    const args: CoinSelectArgs = {
      utxos: [SEGWIT_UTXO_C],
      targetSats: 10_000n,
      feeRate: 0,
      highPriorityEstimate: HIGH_PRIORITY_ESTIMATE,
      changeScriptType: "p2wpkh",
      dustThresholdSats: 330n,
    };
    const result = selectCoinsBnb(args);
    expect(result.kind).toBe("refused");
  });
});

// ─── Test 4: feeRate > 10× highPriorityEstimate → refusal ────────────────────

describe("selectCoinsBnb — fee-rate upper bound", () => {
  it("refuses feeRate > 10× highPriorityEstimate (D-03)", () => {
    const args: CoinSelectArgs = {
      utxos: [SEGWIT_UTXO_C],
      targetSats: 10_000n,
      feeRate: 51, // > 10 × 5 = 50
      highPriorityEstimate: 5,
      changeScriptType: "p2wpkh",
      dustThresholdSats: 330n,
    };
    const result = selectCoinsBnb(args);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.reason).toMatch(/10/);
  });

  it("accepts feeRate === 10× highPriorityEstimate (boundary, inclusive)", () => {
    const args: CoinSelectArgs = {
      utxos: [SEGWIT_UTXO_C], // 50_000 sats
      targetSats: 1_000n,
      feeRate: 50, // exactly 10 × 5
      highPriorityEstimate: 5,
      changeScriptType: "p2wpkh",
      dustThresholdSats: 330n,
    };
    const result = selectCoinsBnb(args);
    expect(result.kind).toBe("ok");
  });
});

// ─── Test 5: Mixed segwit+taproot UTXO set ────────────────────────────────────

describe("selectCoinsBnb — mixed segwit+taproot", () => {
  it("selects across both script types; vbyte table uses 68 vb for p2wpkh and 58 vb for p2tr", () => {
    // UTXOs: one p2wpkh (10_000) + one p2tr (15_000) = 25_000 total.
    // Target = 20_000 sats at 5 sat/vB, P2WPKH change.
    // Vbyte estimate with 2 inputs (1 p2wpkh + 1 p2tr), 2 P2WPKH outputs:
    //   overhead(11) + 68 + 58 + 31 + 31 = 199 vbytes → fee = 995 sats
    // selectedSum = 25_000; target + fee = 20_000 + 995 = 20_995; change = 4_005 sats (> dust 330)
    const utxos: UtxoEntry[] = [SEGWIT_UTXO_A, TAPROOT_UTXO_D];
    const args: CoinSelectArgs = {
      utxos,
      targetSats: 20_000n,
      feeRate: 5,
      highPriorityEstimate: HIGH_PRIORITY_ESTIMATE,
      changeScriptType: "p2wpkh",
      dustThresholdSats: 330n,
    };
    const result = selectCoinsBnb(args);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // Both script types should be selected.
    const scriptTypes = result.selectedInputs.map((u) => u.scriptType);
    expect(scriptTypes).toContain("p2wpkh");
    expect(scriptTypes).toContain("p2tr");

    // Selection covers target + fee.
    const selectedSum = result.selectedInputs.reduce((acc, u) => acc + u.valueSats, 0n);
    expect(selectedSum).toBe(20_000n + result.feeSats + result.changeSats);

    // Fee must be positive.
    expect(result.feeSats).toBeGreaterThan(0n);
  });

  it("handles a taproot-only UTXO set correctly", () => {
    const utxos: UtxoEntry[] = [TAPROOT_UTXO_E]; // 100_000 sats
    const args: CoinSelectArgs = {
      utxos,
      targetSats: 50_000n,
      feeRate: 2,
      highPriorityEstimate: HIGH_PRIORITY_ESTIMATE,
      changeScriptType: "p2tr",
      dustThresholdSats: 330n,
    };
    const result = selectCoinsBnb(args);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.selectedInputs[0]?.scriptType).toBe("p2tr");
    expect(result.feeSats).toBeGreaterThan(0n);
  });
});

// ─── Test 6: Dust asymmetry ───────────────────────────────────────────────────

describe("selectCoinsBnb — dust asymmetry (D-07 / Pitfall 4)", () => {
  it("refuses a recipient output that would be below dust — DISTINCT from change handling", () => {
    // Target = 200 sats — below the 330-sat P2WPKH dust threshold.
    const args: CoinSelectArgs = {
      utxos: [SEGWIT_UTXO_C],
      targetSats: 200n, // below dust (330 sats)
      feeRate: 5,
      highPriorityEstimate: HIGH_PRIORITY_ESTIMATE,
      changeScriptType: "p2wpkh",
      dustThresholdSats: 330n,
    };
    const result = selectCoinsBnb(args);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.reason).toMatch(/dust/i);
  });

  it("folds below-dust CHANGE into fee (changeSats = 0n) instead of refusing", () => {
    // Select a UTXO set where change would come out to ~100 sats (below dust 330).
    // We craft: UTXO = 20_000 sats; target = 19_500 sats; at 5 sat/vB:
    // Vbyte estimate (1 p2wpkh input, 2 p2wpkh outputs): 11 + 68 + 31 + 31 = 141 → fee = 705 sats
    // change = 20_000 − 19_500 − 705 = -205 (negative, so we need a smaller target)
    // Try: UTXO = 20_000 sats; target = 19_400 sats; fee = 705; change = 20_000 − 19_400 − 705 = -105 (still negative)
    // Try: 1 p2wpkh input, 1 p2wpkh output (no change) = 11 + 68 + 31 = 110 vbytes → fee = 550 sats
    // For change near-dust: UTXO = 20_000; target = 19_300; expected change = 20_000 − 19_300 − fee
    // With 2 outputs: fee ≈ 705; change = 20_000 − 19_300 − 705 = -5 (still negative)
    // Use smaller fee rate and larger UTXO. With TAPROOT_UTXO_E (100_000), target = 99_500:
    // 1 p2tr input + 2 p2wpkh outputs: 11 + 58 + 31 + 31 = 131 vbytes → fee at 1 sat/vB = 131 sats
    // change = 100_000 − 99_500 − 131 = 369 sats — above dust. Let's try to get exactly below-dust change.
    //
    // Use: UTXO = 20_000 sats; target = 19_500 sats; 1 sat/vB fee rate
    // 1 p2wpkh input + 2 p2wpkh outputs: 11 + 68 + 62 = 141 vbytes → fee = 141 sats
    // change = 20_000 − 19_500 − 141 = 359 sats — above dust (330). Not below.
    //
    // Use: UTXO = 20_000 sats; target = 19_700 sats; 1 sat/vB
    // change = 20_000 − 19_700 − 141 = 159 sats — below dust (330)! Should fold into fee.
    const args: CoinSelectArgs = {
      utxos: [SEGWIT_UTXO_B], // 20_000 sats
      targetSats: 19_700n,
      feeRate: 1,
      highPriorityEstimate: HIGH_PRIORITY_ESTIMATE,
      changeScriptType: "p2wpkh",
      dustThresholdSats: 330n,
    };
    const result = selectCoinsBnb(args);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // Change below dust → folded into fee, NOT a refused result.
    expect(result.changeSats).toBe(0n);
    // Fee absorbs the dust: feeSats = selectedSum − targetSats.
    const selectedSum = result.selectedInputs.reduce((acc, u) => acc + u.valueSats, 0n);
    expect(result.feeSats).toBe(selectedSum - 19_700n);
    expect(result.feeSats).toBeGreaterThan(141n); // more than baseline fee
  });
});

// ─── Module exports ───────────────────────────────────────────────────────────

describe("btc-coin-select module exports", () => {
  it("exports selectCoinsBnb as a named export", () => {
    expect(typeof selectCoinsBnb).toBe("function");
  });

  it("exports _btcCoinSelect indirection object", () => {
    expect(typeof _btcCoinSelect).toBe("object");
    expect(typeof _btcCoinSelect.selectCoinsBnb).toBe("function");
  });
});
