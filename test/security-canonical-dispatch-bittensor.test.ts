// (section,method) Bittensor dispatch allowlist regression. Phase 47 — Plan
// 47-03 (TAO-W-04). NON-EVM sibling-arm pattern (mirror canonical-dispatch-tron).
//
// Invariants:
//   - the 3 milestone-locked pairs pass;
//   - sudo / swapColdkey / arbitrary pairs refuse with the offender + allowlist;
//   - camelCase keying is pinned — a snake_case key (add_stake_limit) MUST NOT match.

import { describe, expect, it, vi } from "vitest";

import {
  BITTENSOR_DISPATCH_ALLOWLIST,
  _canonicalDispatchBittensor,
  checkBittensorDispatch,
} from "../src/security/canonical-dispatch-bittensor.js";

describe("checkBittensorDispatch — TAO-W-04 (section,method) allowlist", () => {
  it("the allowlist contains exactly the 3 camelCase pairs", () => {
    expect([...BITTENSOR_DISPATCH_ALLOWLIST].sort()).toEqual(
      [
        "balances.transferKeepAlive",
        "subtensorModule.addStakeLimit",
        "subtensorModule.removeStakeLimit",
      ].sort(),
    );
    expect(BITTENSOR_DISPATCH_ALLOWLIST.size).toBe(3);
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

  it("refuses sudo.sudo with offender + allowlist", () => {
    const res = checkBittensorDispatch("sudo", "sudo");
    expect(res.kind).toBe("refused");
    if (res.kind === "refused") {
      expect(res.offender).toBe("sudo.sudo");
      expect(res.allowlist).toContain("subtensorModule.addStakeLimit");
      expect(res.allowlist).toHaveLength(3);
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
