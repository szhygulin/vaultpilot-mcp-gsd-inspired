import { describe, expect, it } from "vitest";
import { keccak256, parseTransaction, serializeTransaction } from "viem";
import type { Address } from "viem";

import { computePresignHash } from "../src/signing/presign-hash.js";

const FIXTURE_C = {
  chainId: 1,
  nonce: 7,
  gas: 21000n,
  maxFeePerGas: 30_000_000_000n, // 30 gwei
  maxPriorityFeePerGas: 1_500_000_000n, // 1.5 gwei
  to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
  value: 1000000000000000000n, // 1 ETH
  data: "0x" as const,
};

describe("computePresignHash — PREP-04 + T-PRESIGN-1", () => {
  it("Fixture C → serialized + presignHash byte-for-byte", () => {
    const result = computePresignHash(FIXTURE_C);

    expect(result.serialized).toBe(
      "0x02f001078459682f008506fc23ac008252089470997970c51812dc3a010c7d01b50e0d17dc79c8880de0b6b3a764000080c0",
    );
    expect(result.presignHash).toBe(
      "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85",
    );
    // EIP-2718 wrapping marker (type=2 = EIP-1559).
    expect(result.serialized.startsWith("0x02")).toBe(true);
    // Empty access-list RLP marker.
    expect(result.serialized.endsWith("c0")).toBe(true);
  });

  it("viem.parseTransaction round-trip preserves all 9 EIP-1559 fields", () => {
    const { serialized } = computePresignHash(FIXTURE_C);
    const decoded = parseTransaction(serialized);

    expect(decoded.type).toBe("eip1559");
    expect(decoded.chainId).toBe(1);
    expect(decoded.nonce).toBe(7);
    expect(decoded.maxFeePerGas).toBe(30_000_000_000n);
    expect(decoded.maxPriorityFeePerGas).toBe(1_500_000_000n);
    expect(decoded.gas).toBe(21000n);
    // viem 2.48.11 parseTransaction returns the lowercase address (not
    // checksummed) — case-insensitive compare locks the semantic equality
    // without binding the test to a casing convention that may shift
    // between viem releases.
    expect(decoded.to?.toLowerCase()).toBe("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
    expect(decoded.value).toBe(1000000000000000000n);
    // viem may decode "0x" as undefined; accept either.
    expect(decoded.data === undefined || decoded.data === "0x").toBe(true);
    // Empty access list — either undefined or length 0.
    expect(decoded.accessList === undefined || decoded.accessList.length === 0).toBe(true);

    // The agent-task contract Plan 04-03 emits: re-decode → recompute → match.
    // This loop MUST yield the same hash; if not, the contract is broken.
    const reSerialized = serializeTransaction(decoded);
    const reHash = keccak256(reSerialized);
    expect(reHash).toBe("0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85");
  });

  it("different inputs produce different hashes (sanity — catches constant-output bugs)", () => {
    const a = computePresignHash({ ...FIXTURE_C, value: 1000000000000000000n });
    const b = computePresignHash({ ...FIXTURE_C, value: 2000000000000000000n });
    expect(a.presignHash).not.toBe(b.presignHash);
  });
});
