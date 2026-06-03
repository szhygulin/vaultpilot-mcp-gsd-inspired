// prepare_bittensor_move_stake end-to-end regression. Phase 48 — Plan 48-03
// (TAO-W-07). SAME-OWNER alpha reallocation (origin→dest hotkey AND/OR subnet).
//
// Load-bearing invariants:
//   1. Demo-mode FIRST refusal — zero socket.
//   2. origin+dest HOTKEY (both full SS58, untruncated) + origin+dest NETUID all
//      echoed in the PREPARE RECEIPT.
//   3. amount is LABELED "ALPHA".
//   4. stored payloadFingerprint === Fixture TAO-F (cross-linked to
//      test/signing-fingerprint-bittensor.test.ts:396-404). netuid origin=1,
//      dest=2 (the fixture netuids).
//   5. SAME-owner → the receipt declares ownership UNCHANGED and emits NO
//      [WITHDRAWAL — CUSTODY CHANGE] block (custody distinctness — that block is
//      transfer_stake-only; pinned in preview-send.bittensor-depth.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy } = vi.hoisted(() => ({ listAccountsSpy: vi.fn() }));

vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (...args: Parameters<typeof actual.listAccounts>) =>
      listAccountsSpy(...args),
  };
});

import { _bittensorRegistry } from "../src/chains/bittensor/registry.js";
import { _bittensorBuilder } from "../src/chains/bittensor/extrinsic-builder.js";
import * as env from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveBittensorPersona,
} from "../src/demo/state.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { getRegisteredTool } from "../src/tools/index.js";
import {
  FIXTURE_CHAIN_HASHES,
  makeMockBittensorApi,
} from "./_helpers/mock-bittensor-api.js";

import "../src/tools/prepare_bittensor_move_stake.js";

// Fixture TAO-F — move_stake(orig_hk=0xaa…, dest_hk=0xbb…, orig_net=1,
// dest_net=2, alpha=5 ALPHA), mode:0. Cross-link:
// test/signing-fingerprint-bittensor.test.ts:401.
const FIXTURE_TAO_F_FP =
  "0x467dda8b59f37a909dce8f98cbdd1aee4b1eff4cf8be4efb5de4020291a75974";
const PERSONA_SS58 = "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9";
const ORIGIN_HOTKEY = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";
const DEST_HOTKEY = "5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy";

function callTool(args: Record<string, unknown>) {
  const tool = getRegisteredTool("prepare_bittensor_move_stake");
  if (!tool) throw new Error("tool not registered");
  return tool.handler(args);
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  listAccountsSpy.mockReset();
  _resetActivePersonaForTesting();
  vi.spyOn(_bittensorBuilder, "resolveChainHashes").mockResolvedValue(
    FIXTURE_CHAIN_HASHES,
  );
});

afterEach(() => {
  _resetActivePersonaForTesting();
  vi.restoreAllMocks();
});

describe("prepare_bittensor_move_stake — TAO-W-07 (SAME-owner reallocation)", () => {
  it("demo-mode FIRST refusal: WRONG_MODE + getApi/resolveChainHashes NEVER called (zero socket)", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    const resolveSpy = vi.spyOn(_bittensorBuilder, "resolveChainHashes");

    const res = await callTool({
      originHotkey: ORIGIN_HOTKEY,
      destinationHotkey: DEST_HOTKEY,
      originNetuid: 1,
      destinationNetuid: 2,
      alpha: "5",
    });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "WRONG_MODE",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed destinationHotkey with INVALID_INPUT", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");

    const res = await callTool({
      originHotkey: ORIGIN_HOTKEY,
      destinationHotkey: "bad",
      originNetuid: 1,
      destinationNetuid: 2,
      alpha: "5",
    });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
  });

  it("rejects destinationNetuid out of u16 range with INVALID_INPUT", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    listAccountsSpy.mockReturnValue([{ address: PERSONA_SS58, chain: "bittensor" }]);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");

    const res = await callTool({
      originHotkey: ORIGIN_HOTKEY,
      destinationHotkey: DEST_HOTKEY,
      originNetuid: 1,
      destinationNetuid: 99999,
      alpha: "5",
    });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
  });

  it("happy path (demo): fingerprint === Fixture TAO-F; both hotkeys + both netuids echoed; ALPHA; NO custody block", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    setActiveBittensorPersona({ slug: "bittensor-whale", ss58Address: PERSONA_SS58 });
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockBittensorApi({ nonce: 0 }) as never,
    );

    // alpha "5" = 5 ALPHA = 5_000_000_000; netuid origin=1, dest=2 (Fixture TAO-F).
    const res = await callTool({
      originHotkey: ORIGIN_HOTKEY,
      destinationHotkey: DEST_HOTKEY,
      originNetuid: 1,
      destinationNetuid: 2,
      alpha: "5",
    });

    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      handle: string;
      originHotkey: string;
      destinationHotkey: string;
      originNetuid: number;
      destinationNetuid: number;
      alpha: string;
      amountUnit: string;
      payloadFingerprint: string;
      txType: string;
    };

    expect(sc.txType).toBe("bittensor");
    expect(sc.payloadFingerprint).toBe(FIXTURE_TAO_F_FP);
    expect(sc.amountUnit).toBe("ALPHA");
    expect(sc.originHotkey).toBe(ORIGIN_HOTKEY);
    expect(sc.destinationHotkey).toBe(DEST_HOTKEY);
    expect(sc.originNetuid).toBe(1);
    expect(sc.destinationNetuid).toBe(2);
    expect(sc.alpha).toBe("5");

    // Receipt echoes BOTH hotkeys (full SS58) + BOTH netuids + ALPHA amount, and
    // declares ownership UNCHANGED — NO withdrawal/custody block (same owner).
    const receipt = res.content[0]?.text ?? "";
    expect(receipt).toMatch(/PREPARE RECEIPT \(Bittensor — move_stake, SAME-owner/);
    expect(receipt).toContain(ORIGIN_HOTKEY);
    expect(receipt).toContain(DEST_HOTKEY);
    expect(receipt).toMatch(/origin_netuid:\s+1\b/);
    expect(receipt).toMatch(/destination_netuid:\s+2\b/);
    expect(receipt).toMatch(/amount \(ALPHA\):\s+5\b/);
    expect(receipt).toMatch(/ownership:\s+UNCHANGED/);
    // SAME-owner — NO custody-change block in the prepared receipt.
    expect(receipt).not.toMatch(/WITHDRAWAL — CUSTODY CHANGE/);

    const record = _peekHandleForTesting(sc.handle);
    expect(record?.payloadFingerprint).toBe(FIXTURE_TAO_F_FP);
    if (record?.tx.txType === "bittensor") {
      expect(record.tx.section).toBe("subtensorModule");
      expect(record.tx.method).toBe("moveStake");
      const summary = record.tx.instructionSummary;
      expect(summary?.kind).toBe("move-stake");
      if (summary?.kind === "move-stake") {
        expect(summary.originHotkey).toBe(ORIGIN_HOTKEY);
        expect(summary.destinationHotkey).toBe(DEST_HOTKEY);
        expect(summary.originNetuid).toBe(1);
        expect(summary.destinationNetuid).toBe(2);
        expect(summary.alphaAmount).toBe(5_000_000_000n);
        // No custody-destination coldkey on a same-owner move.
        expect("destinationColdkey" in summary).toBe(false);
      }
    } else {
      throw new Error("expected bittensor handle");
    }
  });
});
