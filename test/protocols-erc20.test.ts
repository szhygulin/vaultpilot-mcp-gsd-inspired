// Pure encode + decode + selector-table tests for src/protocols/erc20.ts.
//
// Phase 6 — Plan 06-02. Anchors:
//   - ERC20_SELECTORS literals match the canonical Solidity function-signature
//     hashes (universal — drift here breaks every ERC-20 prepare tool).
//   - MAX_UINT256 equals (2^256 - 1).
//   - encodeErc20Transfer round-trips Fixture B's calldata byte-for-byte
//     (cross-link to test/signing-fingerprint.test.ts).
//   - decodeErc20Call handles the four discriminated-union shapes (transfer,
//     approve unlimited / non-unlimited, withdraw) + the unknown branch for
//     native sends and unrecognized selectors.

import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import {
  ERC20_COMBINED_DECODE_ABI,
  ERC20_SELECTORS,
  MAX_UINT256,
  decodeErc20Call,
  encodeErc20Approve,
  encodeErc20Transfer,
} from "../src/protocols/erc20.js";

describe("ERC20_SELECTORS — universal selector regression anchor", () => {
  it("transfer === 0xa9059cbb byte-identical", () => {
    expect(ERC20_SELECTORS.transfer).toBe("0xa9059cbb");
  });

  it("approve === 0x095ea7b3 byte-identical", () => {
    expect(ERC20_SELECTORS.approve).toBe("0x095ea7b3");
  });
});

describe("MAX_UINT256 — PREP-29 unlimited-approval sentinel", () => {
  it("equals (1n << 256n) - 1n", () => {
    expect(MAX_UINT256).toBe((1n << 256n) - 1n);
  });

  it("hex form is 64 'f' chars", () => {
    expect(MAX_UINT256.toString(16)).toBe(
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    );
  });
});

describe("encodeErc20Transfer — viem-canonical 68-byte calldata", () => {
  it("encodes transfer(0x...dEAD, 1e18) matching Fixture B's data field (cross-link)", () => {
    const data = encodeErc20Transfer(
      "0x000000000000000000000000000000000000dEaD" as Address,
      1000000000000000000n,
    );
    // viem lowercases the encoded hex — Fixture B in signing-fingerprint.test.ts
    // uses mixed case ("dEAD" / "DE0B6B3A7640000"). hexToBytes is
    // case-insensitive so both produce the same payloadFingerprint, but the
    // byte-identity check here normalizes both sides to lowercase.
    const fixtureBDataLower =
      "0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead0000000000000000000000000000000000000000000000000de0b6b3a7640000";
    expect(data.toLowerCase()).toBe(fixtureBDataLower);
    // 68 bytes = 4-byte selector + 32-byte to + 32-byte amount = 138 chars
    // including 0x prefix.
    expect(data.length).toBe(138);
  });
});

describe("encodeErc20Approve — viem-canonical 68-byte calldata", () => {
  it("encodes approve(spender, 1n) starting with 0x095ea7b3", () => {
    const data = encodeErc20Approve(
      "0x000000000000000000000000000000000000dEaD" as Address,
      1n,
    );
    expect(data.slice(0, 10)).toBe("0x095ea7b3");
    expect(data.length).toBe(138);
  });
});

describe("decodeErc20Call — selector-routed discriminated union", () => {
  it("(transfer) decodes Fixture B's data to { kind: transfer, to, amount }", () => {
    const fixtureBData =
      "0xa9059cbb000000000000000000000000000000000000000000000000000000000000dEAD0000000000000000000000000000000000000000000000000DE0B6B3A7640000" as Hex;
    const decoded = decodeErc20Call(fixtureBData);
    expect(decoded.kind).toBe("transfer");
    if (decoded.kind !== "transfer") return;
    // viem.decodeFunctionData returns the address in EIP-55 checksum form.
    expect(decoded.to.toLowerCase()).toBe("0x000000000000000000000000000000000000dead");
    expect(decoded.amount).toBe(1000000000000000000n);
  });

  it("(approve unlimited) decodes approve(spender, MAX_UINT256) with isUnlimited === true", () => {
    const data = encodeErc20Approve(
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
      MAX_UINT256,
    );
    const decoded = decodeErc20Call(data);
    expect(decoded.kind).toBe("approve");
    if (decoded.kind !== "approve") return;
    expect(decoded.amount).toBe(MAX_UINT256);
    expect(decoded.isUnlimited).toBe(true);
  });

  it("(approve non-unlimited) isUnlimited === false for a non-MAX_UINT256 amount", () => {
    const data = encodeErc20Approve(
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
      1000n,
    );
    const decoded = decodeErc20Call(data);
    expect(decoded.kind).toBe("approve");
    if (decoded.kind !== "approve") return;
    expect(decoded.amount).toBe(1000n);
    expect(decoded.isUnlimited).toBe(false);
  });

  it("(unknown — native send) data === \"0x\" returns { kind: unknown, selector: \"0x\" }", () => {
    const decoded = decodeErc20Call("0x");
    expect(decoded.kind).toBe("unknown");
    if (decoded.kind !== "unknown") return;
    expect(decoded.selector).toBe("0x");
  });

  it("(unknown — unrecognized selector) returns { kind: unknown, selector } without throwing", () => {
    // 0xdeadbeef + 100 zero bytes → viem throws AbiFunctionSignatureNotFoundError;
    // we catch and surface unknown.
    const garbage = ("0xdeadbeef" + "00".repeat(100)) as Hex;
    const decoded = decodeErc20Call(garbage);
    expect(decoded.kind).toBe("unknown");
    if (decoded.kind !== "unknown") return;
    expect(decoded.selector).toBe("0xdeadbeef");
  });

  it("(unknown — truncated data) data.length < 10 returns { kind: unknown }", () => {
    const decoded = decodeErc20Call("0xa9" as Hex);
    expect(decoded.kind).toBe("unknown");
  });
});

describe("ERC20_COMBINED_DECODE_ABI — includes WETH9 withdraw fragment", () => {
  it("contains an entry whose name is 'withdraw' (for Plan 06-04 unwrap decode)", () => {
    const names = ERC20_COMBINED_DECODE_ABI
      .filter((entry): entry is { type: string; name: string } & typeof entry =>
        typeof entry === "object" && entry !== null && "name" in entry && "type" in entry,
      )
      .map((entry) => entry.name);
    expect(names).toContain("withdraw");
    expect(names).toContain("transfer");
    expect(names).toContain("approve");
  });
});
