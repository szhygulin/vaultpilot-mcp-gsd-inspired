// `tron-vote` encoder unit tests. Phase 19 — Plan 19-03.
//
// Load-bearing invariants:
//
//   1. **Array→VoteInfo map conversion** (T-VOTE-MAP — MEDIUM):
//      `encodeVoteWitness` converts `votes: [{ srAddress, count }]` array to
//      `VoteInfo = { [srAddress]: count }` map before calling
//      `tronWeb.transactionBuilder.vote(voteInfo, from)`.
//      The resulting Protobuf `votes[]` field matches input array's address+count pairs.
//
//   2. **extendExpiration(tx, 900)** called for both encoders (LOAD-BEARING).
//
//   3. **Duplicate srAddress rejection** — array with duplicate srAddress throws.
//
//   4. **encodeWithdrawBalanceContract** — zero-arg; calls `withdrawBlockRewards(from)`;
//      contract type is "WithdrawBalanceContract".
//
//   5. **_tronVote ESM spy-affordance** — exposes both encoders; vi.spyOn intercepts.

import { describe, expect, it, vi } from "vitest";

import type { TronWeb } from "tronweb";

import {
  _tronVote,
  encodeVoteWitness,
  encodeWithdrawBalanceContract,
} from "../src/protocols/tron-vote.js";

// ============================================================================
// Helpers — build a mock TronWeb for vote tests
// ============================================================================

function makeMockVoteTx(ownerHex: string, votes: Array<{ vote_address: string; vote_count: number }>) {
  return {
    txID: "mockTxId",
    raw_data: {
      contract: [{
        type: "VoteWitnessContract",
        parameter: {
          value: {
            owner_address: ownerHex,
            votes,
          },
          type_url: "type.googleapis.com/protocol.VoteWitnessContract",
        },
      }],
      ref_block_bytes: "00ad",
      ref_block_hash: "8e5e7df4e3c8b9a2",
      expiration: 1779268134000,
      timestamp: 1779268074000,
    },
    raw_data_hex: "aabbccdd",
    signature: [],
  };
}

function makeMockWithdrawTx(ownerHex: string) {
  return {
    txID: "mockWithdrawTxId",
    raw_data: {
      contract: [{
        type: "WithdrawBalanceContract",
        parameter: {
          value: {
            owner_address: ownerHex,
          },
          type_url: "type.googleapis.com/protocol.WithdrawBalanceContract",
        },
      }],
      ref_block_bytes: "00ad",
      ref_block_hash: "8e5e7df4e3c8b9a2",
      expiration: 1779268134000,
      timestamp: 1779268074000,
    },
    raw_data_hex: "eeff0011",
    signature: [],
  };
}

// ============================================================================
// Test 6: encodeVoteWitness — array→map conversion
// ============================================================================

describe("encodeVoteWitness — array→VoteInfo map conversion (T-VOTE-MAP)", () => {
  it("converts votes array to VoteInfo map before calling vote() builder", async () => {
    const FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const SR1 = "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH";
    const SR2 = "TE7hnUtWRRBz3SkFrX8JESWUmEvxxAhoPt";
    const FROM_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";

    const mockTx = makeMockVoteTx(FROM_HEX, [
      { vote_address: "4178c842ee63b253f8f0d2955bbc582c661a078c9d", vote_count: 100 },
      { vote_address: "412d7bdb9846499a2e5e6c5a7e6fb05731c83107c7", vote_count: 200 },
    ]);

    const voteSpy = vi.fn().mockResolvedValue(mockTx);
    const extendSpy = vi.fn().mockImplementation((tx: unknown) => Promise.resolve(tx));

    const mockTronWeb = {
      transactionBuilder: {
        vote: voteSpy,
        extendExpiration: extendSpy,
      },
    } as unknown as TronWeb;

    await encodeVoteWitness({
      tronWeb: mockTronWeb,
      from: FROM,
      votes: [
        { srAddress: SR1, count: 100, label: "(SR: Binance — vote rank 1)" },
        { srAddress: SR2, count: 200, label: "(SR: Huobi — vote rank 2)" },
      ],
    });

    // CRITICAL: vote() must have been called with a VoteInfo MAP, not an array
    expect(voteSpy).toHaveBeenCalledTimes(1);
    const voteInfoArg = voteSpy.mock.calls[0][0] as Record<string, number>;
    expect(typeof voteInfoArg).toBe("object");
    expect(Array.isArray(voteInfoArg)).toBe(false); // NOT an array

    // Map must contain both entries with correct counts
    expect(voteInfoArg[SR1]).toBe(100);
    expect(voteInfoArg[SR2]).toBe(200);

    // Second arg is the voter address
    expect(voteSpy.mock.calls[0][1]).toBe(FROM);
  });

  it("resulting instructionSummary has kind='stake-vote' with correct totalCount", async () => {
    const FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const SR1 = "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH";
    const SR2 = "TE7hnUtWRRBz3SkFrX8JESWUmEvxxAhoPt";
    const FROM_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";

    const mockTx = makeMockVoteTx(FROM_HEX, []);

    const mockTronWeb = {
      transactionBuilder: {
        vote: vi.fn().mockResolvedValue(mockTx),
        extendExpiration: vi.fn().mockImplementation((tx: unknown) => Promise.resolve(tx)),
      },
    } as unknown as TronWeb;

    const result = await encodeVoteWitness({
      tronWeb: mockTronWeb,
      from: FROM,
      votes: [
        { srAddress: SR1, count: 100, label: "(SR: Binance — vote rank 1)" },
        { srAddress: SR2, count: 200, label: "(SR: Huobi — vote rank 2)" },
      ],
    });

    expect(result.instructionSummary).toHaveLength(1);
    const summary = result.instructionSummary[0];
    expect(summary.kind).toBe("stake-vote");
    if (summary.kind === "stake-vote") {
      expect(summary.from).toBe(FROM);
      expect(summary.totalCount).toBe(300); // 100 + 200
      expect(summary.votes).toHaveLength(2);
      expect(summary.votes[0].srAddress).toBe(SR1);
      expect(summary.votes[0].count).toBe(100);
      expect(summary.votes[1].srAddress).toBe(SR2);
      expect(summary.votes[1].count).toBe(200);
    }
  });
});

// ============================================================================
// Test 7: extendExpiration(tx, 900) called for both encoders
// ============================================================================

describe("encodeVoteWitness + encodeWithdrawBalanceContract — extendExpiration(tx, 900) LOAD-BEARING", () => {
  it("encodeVoteWitness calls extendExpiration(tx, 900)", async () => {
    const FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const FROM_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
    const mockTx = makeMockVoteTx(FROM_HEX, []);

    const extendSpy = vi.fn().mockImplementation((tx: unknown) => Promise.resolve(tx));

    const mockTronWeb = {
      transactionBuilder: {
        vote: vi.fn().mockResolvedValue(mockTx),
        extendExpiration: extendSpy,
      },
    } as unknown as TronWeb;

    await encodeVoteWitness({
      tronWeb: mockTronWeb,
      from: FROM,
      votes: [{ srAddress: "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH", count: 10, label: "SR" }],
    });

    expect(extendSpy).toHaveBeenCalledWith(mockTx, 900);
  });

  it("encodeWithdrawBalanceContract calls extendExpiration(tx, 900)", async () => {
    const FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const FROM_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
    const mockTx = makeMockWithdrawTx(FROM_HEX);

    const extendSpy = vi.fn().mockImplementation((tx: unknown) => Promise.resolve(tx));

    const mockTronWeb = {
      transactionBuilder: {
        withdrawBlockRewards: vi.fn().mockResolvedValue(mockTx),
        extendExpiration: extendSpy,
      },
    } as unknown as TronWeb;

    await encodeWithdrawBalanceContract({ tronWeb: mockTronWeb, from: FROM });
    expect(extendSpy).toHaveBeenCalledWith(mockTx, 900);
  });
});

// ============================================================================
// Test 8: encodeVoteWitness rejects duplicate srAddress
// ============================================================================

describe("encodeVoteWitness — duplicate srAddress rejection", () => {
  it("throws an explicit error when duplicate srAddress in votes array", async () => {
    const FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const SR1 = "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH";

    const mockTronWeb = {
      transactionBuilder: {
        vote: vi.fn(),
        extendExpiration: vi.fn(),
      },
    } as unknown as TronWeb;

    await expect(encodeVoteWitness({
      tronWeb: mockTronWeb,
      from: FROM,
      votes: [
        { srAddress: SR1, count: 100, label: "SR1" },
        { srAddress: SR1, count: 50, label: "SR1 dup" },
      ],
    })).rejects.toThrow(/duplicate.*srAddress/i);
  });

  it("throws when votes array is empty", async () => {
    const FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

    const mockTronWeb = {
      transactionBuilder: {
        vote: vi.fn(),
        extendExpiration: vi.fn(),
      },
    } as unknown as TronWeb;

    await expect(encodeVoteWitness({
      tronWeb: mockTronWeb,
      from: FROM,
      votes: [],
    })).rejects.toThrow(/empty|at least one/i);
  });
});

// ============================================================================
// Test 9: encodeWithdrawBalanceContract — zero-arg
// ============================================================================

describe("encodeWithdrawBalanceContract — zero-arg, withdrawBlockRewards", () => {
  it("calls tronWeb.transactionBuilder.withdrawBlockRewards(from)", async () => {
    const FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const FROM_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
    const mockTx = makeMockWithdrawTx(FROM_HEX);

    const withdrawSpy = vi.fn().mockResolvedValue(mockTx);
    const extendSpy = vi.fn().mockImplementation((tx: unknown) => Promise.resolve(tx));

    const mockTronWeb = {
      transactionBuilder: {
        withdrawBlockRewards: withdrawSpy,
        extendExpiration: extendSpy,
      },
    } as unknown as TronWeb;

    const result = await encodeWithdrawBalanceContract({ tronWeb: mockTronWeb, from: FROM });

    expect(withdrawSpy).toHaveBeenCalledWith(FROM);
    expect(result.instructionSummary).toHaveLength(1);
    const summary = result.instructionSummary[0];
    expect(summary.kind).toBe("stake-claim-rewards");
    if (summary.kind === "stake-claim-rewards") {
      expect(summary.from).toBe(FROM);
      expect(summary.estimatedRewardSun).toBeNull(); // populated at tool layer
    }
  });
});

// ============================================================================
// Test 10: _tronVote ESM spy-affordance
// ============================================================================

describe("_tronVote ESM spy-affordance", () => {
  it("exposes encodeVoteWitness and vi.spyOn intercepts via indirection", async () => {
    const FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const FROM_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
    const mockTx = makeMockVoteTx(FROM_HEX, []);

    const mockTronWeb = {
      transactionBuilder: {
        vote: vi.fn().mockResolvedValue(mockTx),
        extendExpiration: vi.fn().mockImplementation((tx: unknown) => Promise.resolve(tx)),
      },
    } as unknown as TronWeb;

    const spy = vi.spyOn(_tronVote, "encodeVoteWitness");
    await _tronVote.encodeVoteWitness({
      tronWeb: mockTronWeb,
      from: FROM,
      votes: [{ srAddress: "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH", count: 10, label: "SR" }],
    });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("exposes encodeWithdrawBalanceContract and vi.spyOn intercepts via indirection", async () => {
    const FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const FROM_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
    const mockTx = makeMockWithdrawTx(FROM_HEX);

    const mockTronWeb = {
      transactionBuilder: {
        withdrawBlockRewards: vi.fn().mockResolvedValue(mockTx),
        extendExpiration: vi.fn().mockImplementation((tx: unknown) => Promise.resolve(tx)),
      },
    } as unknown as TronWeb;

    const spy = vi.spyOn(_tronVote, "encodeWithdrawBalanceContract");
    await _tronVote.encodeWithdrawBalanceContract({ tronWeb: mockTronWeb, from: FROM });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
