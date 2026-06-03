// (section,method) Bittensor dispatch allowlist regression. Phase 47 — Plan
// 47-03 (TAO-W-04). EXTENDED Phase 48 — Plan 48-01 (TAO-W-09): +5 deferred
// staking pairs. NON-EVM sibling-arm pattern (mirror canonical-dispatch-tron).
//
// Invariants:
//   - the 8 milestone-locked pairs pass (3 shipped + 5 Phase-48 deferred);
//   - sudo / swapColdkey / arbitrary pairs refuse with the offender + allowlist;
//   - camelCase keying is pinned — a snake_case key (add_stake_limit /
//     add_stake / transfer_stake) MUST NOT match (the copy-from-receipt guard).

import { describe, expect, it, vi } from "vitest";

import {
  BITTENSOR_DISPATCH_ALLOWLIST,
  _canonicalDispatchBittensor,
  checkBittensorDispatch,
} from "../src/security/canonical-dispatch-bittensor.js";

describe("checkBittensorDispatch — TAO-W-04 (section,method) allowlist", () => {
  it("the allowlist contains exactly the 8 camelCase pairs", () => {
    expect([...BITTENSOR_DISPATCH_ALLOWLIST].sort()).toEqual(
      [
        "balances.transferKeepAlive",
        "subtensorModule.addStakeLimit",
        "subtensorModule.removeStakeLimit",
        "subtensorModule.addStake", // TAO-W-06
        "subtensorModule.removeStake", // TAO-W-06
        "subtensorModule.moveStake", // TAO-W-07
        "subtensorModule.swapStake", // TAO-W-07
        "subtensorModule.transferStake", // TAO-W-08
      ].sort(),
    );
    expect(BITTENSOR_DISPATCH_ALLOWLIST.size).toBe(8);
  });

  it("allows subtensorModule.addStakeLimit", () => {
    expect(checkBittensorDispatch("subtensorModule", "addStakeLimit")).toEqual({
      kind: "allowed",
    });
  });

  it("allows subtensorModule.removeStakeLimit", () => {
    expect(checkBittensorDispatch("subtensorModule", "removeStakeLimit")).toEqual({
      kind: "allowed",
    });
  });

  it("allows balances.transferKeepAlive", () => {
    expect(checkBittensorDispatch("balances", "transferKeepAlive")).toEqual({
      kind: "allowed",
    });
  });

  // --- Phase 48 deferred staking pairs (TAO-W-06/07/08) ---
  it("allows subtensorModule.addStake (TAO-W-06 PLAIN add_stake)", () => {
    expect(checkBittensorDispatch("subtensorModule", "addStake")).toEqual({
      kind: "allowed",
    });
  });

  it("allows subtensorModule.removeStake (TAO-W-06 PLAIN remove_stake)", () => {
    expect(checkBittensorDispatch("subtensorModule", "removeStake")).toEqual({
      kind: "allowed",
    });
  });

  it("allows subtensorModule.moveStake (TAO-W-07 same-owner reallocation)", () => {
    expect(checkBittensorDispatch("subtensorModule", "moveStake")).toEqual({
      kind: "allowed",
    });
  });

  it("allows subtensorModule.swapStake (TAO-W-07 same-owner subnet swap)", () => {
    expect(checkBittensorDispatch("subtensorModule", "swapStake")).toEqual({
      kind: "allowed",
    });
  });

  it("allows subtensorModule.transferStake (TAO-W-08 CUSTODY CHANGE)", () => {
    expect(checkBittensorDispatch("subtensorModule", "transferStake")).toEqual({
      kind: "allowed",
    });
  });

  it("refuses sudo.sudo with offender + allowlist", () => {
    const res = checkBittensorDispatch("sudo", "sudo");
    expect(res.kind).toBe("refused");
    if (res.kind === "refused") {
      expect(res.offender).toBe("sudo.sudo");
      expect(res.allowlist).toContain("subtensorModule.addStakeLimit");
      expect(res.allowlist).toContain("subtensorModule.transferStake");
      expect(res.allowlist).toHaveLength(8);
    }
  });

  it("refuses subtensorModule.swapColdkey (a real but non-allowlisted call)", () => {
    const res = checkBittensorDispatch("subtensorModule", "swapColdkey");
    expect(res.kind).toBe("refused");
    if (res.kind === "refused") {
      expect(res.offender).toBe("subtensorModule.swapColdkey");
    }
  });

  it("refuses balances.transferAll (a sibling balances call NOT allowlisted)", () => {
    expect(checkBittensorDispatch("balances", "transferAll").kind).toBe("refused");
  });

  it("camelCase keying pinned — snake_case add_stake_limit does NOT match", () => {
    // record.tx carries camelCase; the on-chain snake_case is receipt-only.
    const res = checkBittensorDispatch("subtensorModule", "add_stake_limit");
    expect(res.kind).toBe("refused");
    if (res.kind === "refused") {
      expect(res.offender).toBe("subtensorModule.add_stake_limit");
    }
  });

  it("camelCase keying pinned — snake_case add_stake does NOT match (TAO-W-06 copy-from-receipt guard)", () => {
    const res = checkBittensorDispatch("subtensorModule", "add_stake");
    expect(res.kind).toBe("refused");
    if (res.kind === "refused") {
      expect(res.offender).toBe("subtensorModule.add_stake");
    }
  });

  it("camelCase keying pinned — snake_case transfer_stake does NOT match (TAO-W-08 copy-from-receipt guard)", () => {
    const res = checkBittensorDispatch("subtensorModule", "transfer_stake");
    expect(res.kind).toBe("refused");
    if (res.kind === "refused") {
      expect(res.offender).toBe("subtensorModule.transfer_stake");
    }
  });

  it("_canonicalDispatchBittensor spy-affordance intercepts", () => {
    const spy = vi
      .spyOn(_canonicalDispatchBittensor, "checkBittensorDispatch")
      .mockReturnValue({ kind: "allowed" });
    const r = _canonicalDispatchBittensor.checkBittensorDispatch("x", "y");
    expect(spy).toHaveBeenCalledWith("x", "y");
    expect(r).toEqual({ kind: "allowed" });
    spy.mockRestore();
  });
});
