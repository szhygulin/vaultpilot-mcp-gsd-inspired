// prepare_bittensor_transfer_stake end-to-end regression. Phase 48 — Plan 48-03
// (TAO-W-08). CUSTODY-CHANGING alpha transfer — the alpha LEAVES the paired
// coldkey for a DIFFERENT coldkey (`destinationColdkey`). WITHDRAWAL-GRADE.
//
// Load-bearing invariants:
//   1. Demo-mode FIRST refusal — zero socket.
//   2. destinationColdkey is REQUIRED + SS58-validated (malformed → INVALID_INPUT
//      before any state read).
//   3. destinationColdkey echoed FULL/untruncated in BOTH the receipt and
//      structuredContent (T-48-09 — no truncation hides the custody destination).
//   4. The PREPARE RECEIPT carries the [custody-change] ownership line (the
//      withdrawal-grade confirmation); the [WITHDRAWAL — CUSTODY CHANGE] preview
//      block is pinned in preview-send.bittensor-depth.test.ts.
//   5. amount LABELED "ALPHA".
//   6. stored payloadFingerprint === Fixture TAO-H (cross-linked to
//      test/signing-fingerprint-bittensor.test.ts:442-451). netuid origin=1,
//      dest=2.

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

import "../src/tools/prepare_bittensor_transfer_stake.js";

// Fixture TAO-H — transfer_stake(dest_coldkey=0xcc…, hotkey=0xaa…, orig_net=1,
// dest_net=2, alpha=5 ALPHA), mode:0. destination_coldkey FIRST (the
// custody-change param order). Cross-link:
// test/signing-fingerprint-bittensor.test.ts:448.
const FIXTURE_TAO_H_FP =
  "0xcebe7bde319701717e0f27601dbbb29c890c9c4eb6dac9e03d18f7061b24a9d7";
const PERSONA_SS58 = "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9";
const HOTKEY_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";
const DEST_COLDKEY = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";

function callTool(args: Record<string, unknown>) {
  const tool = getRegisteredTool("prepare_bittensor_transfer_stake");
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

describe("prepare_bittensor_transfer_stake — TAO-W-08 (CUSTODY CHANGE)", () => {
  it("demo-mode FIRST refusal: WRONG_MODE + getApi/resolveChainHashes NEVER called (zero socket)", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    const resolveSpy = vi.spyOn(_bittensorBuilder, "resolveChainHashes");

    const res = await callTool({
      destinationColdkey: DEST_COLDKEY,
      hotkey: HOTKEY_SS58,
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

  it("destinationColdkey REQUIRED + SS58-validated: malformed → INVALID_INPUT before any state read", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");

    const res = await callTool({
      destinationColdkey: "not-a-coldkey",
      hotkey: HOTKEY_SS58,
      originNetuid: 1,
      destinationNetuid: 2,
      alpha: "5",
    });

    expect(res.isError).toBe(true);
    const sc = res.structuredContent as { errorCode?: string; message?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    // The refusal names the offending field — destinationColdkey.
    expect(sc.message).toContain("destinationColdkey");
    expect(getApiSpy).not.toHaveBeenCalled();
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("happy path (demo): fingerprint === Fixture TAO-H; destination_coldkey FULL in receipt + structuredContent; custody-change line; ALPHA", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    setActiveBittensorPersona({ slug: "bittensor-whale", ss58Address: PERSONA_SS58 });
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockBittensorApi({ nonce: 0 }) as never,
    );

    const res = await callTool({
      destinationColdkey: DEST_COLDKEY,
      hotkey: HOTKEY_SS58,
      originNetuid: 1,
      destinationNetuid: 2,
      alpha: "5",
    });

    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      handle: string;
      destinationColdkey: string;
      hotkey: string;
      originNetuid: number;
      destinationNetuid: number;
      alpha: string;
      amountUnit: string;
      payloadFingerprint: string;
      txType: string;
    };

    expect(sc.txType).toBe("bittensor");
    expect(sc.payloadFingerprint).toBe(FIXTURE_TAO_H_FP);
    expect(sc.amountUnit).toBe("ALPHA");
    // destination_coldkey REQUIRED + FULL/untruncated in structuredContent.
    expect(sc.destinationColdkey).toBe(DEST_COLDKEY);
    expect(sc.hotkey).toBe(HOTKEY_SS58);
    expect(sc.originNetuid).toBe(1);
    expect(sc.destinationNetuid).toBe(2);
    expect(sc.alpha).toBe("5");

    // Receipt: destination_coldkey FULL (no truncation, T-48-09) + hotkey full +
    // both netuids + ALPHA + the ownership-CHANGES custody-change line.
    const receipt = res.content[0]?.text ?? "";
    expect(receipt).toMatch(/PREPARE RECEIPT \(Bittensor — transfer_stake, CUSTODY CHANGE\)/);
    expect(receipt).toContain(DEST_COLDKEY); // FULL — never truncated
    expect(receipt).toContain(HOTKEY_SS58);
    expect(receipt).toMatch(/origin_netuid:\s+1\b/);
    expect(receipt).toMatch(/destination_netuid:\s+2\b/);
    expect(receipt).toMatch(/amount \(ALPHA\):\s+5\b/);
    expect(receipt).toMatch(/ownership:\s+CHANGES/);

    const record = _peekHandleForTesting(sc.handle);
    expect(record?.payloadFingerprint).toBe(FIXTURE_TAO_H_FP);
    if (record?.tx.txType === "bittensor") {
      expect(record.tx.section).toBe("subtensorModule");
      expect(record.tx.method).toBe("transferStake");
      const summary = record.tx.instructionSummary;
      expect(summary?.kind).toBe("transfer-stake");
      if (summary?.kind === "transfer-stake") {
        expect(summary.destinationColdkey).toBe(DEST_COLDKEY);
        expect(summary.hotkey).toBe(HOTKEY_SS58);
        expect(summary.originNetuid).toBe(1);
        expect(summary.destinationNetuid).toBe(2);
        expect(summary.alphaAmount).toBe(5_000_000_000n);
      }
    } else {
      throw new Error("expected bittensor handle");
    }
  });
});
