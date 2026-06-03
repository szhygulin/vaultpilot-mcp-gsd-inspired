// prepare_bittensor_swap_stake end-to-end regression. Phase 48 — Plan 48-03
// (TAO-W-07). SAME-OWNER, ONE hotkey, subnet→subnet alpha swap.
//
// Load-bearing invariants:
//   1. Demo-mode FIRST refusal — zero socket.
//   2. ONE hotkey (full SS58) + origin+dest NETUID echoed in the receipt.
//   3. amount is LABELED "ALPHA".
//   4. stored payloadFingerprint === Fixture TAO-G (cross-linked to
//      test/signing-fingerprint-bittensor.test.ts:419-427). netuid origin=1,
//      dest=2.
//   5. SAME-owner → ownership UNCHANGED, NO [WITHDRAWAL — CUSTODY CHANGE] block.

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

import "../src/tools/prepare_bittensor_swap_stake.js";

// Fixture TAO-G — swap_stake(hotkey=0xaa…, orig_net=1, dest_net=2, alpha=5
// ALPHA), mode:0. Cross-link: test/signing-fingerprint-bittensor.test.ts:424.
const FIXTURE_TAO_G_FP =
  "0xc9d4435269160bb25ad803e3a8f4fecf940ed740ee323fa9f0c4fb8f88d52af4";
const PERSONA_SS58 = "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9";
const HOTKEY_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";

function callTool(args: Record<string, unknown>) {
  const tool = getRegisteredTool("prepare_bittensor_swap_stake");
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

describe("prepare_bittensor_swap_stake — TAO-W-07 (SAME-owner subnet swap)", () => {
  it("demo-mode FIRST refusal: WRONG_MODE + getApi/resolveChainHashes NEVER called (zero socket)", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    const resolveSpy = vi.spyOn(_bittensorBuilder, "resolveChainHashes");

    const res = await callTool({
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

  it("real-mode pairing gate: WALLET_NOT_PAIRED when no bittensor account", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    listAccountsSpy.mockReturnValue([]);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");

    const res = await callTool({
      hotkey: HOTKEY_SS58,
      originNetuid: 1,
      destinationNetuid: 2,
      alpha: "5",
    });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
  });

  it("rejects originNetuid out of u16 range with INVALID_INPUT", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    listAccountsSpy.mockReturnValue([{ address: PERSONA_SS58, chain: "bittensor" }]);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");

    const res = await callTool({
      hotkey: HOTKEY_SS58,
      originNetuid: 70000,
      destinationNetuid: 2,
      alpha: "5",
    });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
  });

  it("happy path (demo): fingerprint === Fixture TAO-G; ONE hotkey + both netuids; ALPHA; NO custody block", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    setActiveBittensorPersona({ slug: "bittensor-whale", ss58Address: PERSONA_SS58 });
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockBittensorApi({ nonce: 0 }) as never,
    );

    const res = await callTool({
      hotkey: HOTKEY_SS58,
      originNetuid: 1,
      destinationNetuid: 2,
      alpha: "5",
    });

    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      handle: string;
      hotkey: string;
      originNetuid: number;
      destinationNetuid: number;
      alpha: string;
      amountUnit: string;
      payloadFingerprint: string;
      txType: string;
    };

    expect(sc.txType).toBe("bittensor");
    expect(sc.payloadFingerprint).toBe(FIXTURE_TAO_G_FP);
    expect(sc.amountUnit).toBe("ALPHA");
    expect(sc.hotkey).toBe(HOTKEY_SS58);
    expect(sc.originNetuid).toBe(1);
    expect(sc.destinationNetuid).toBe(2);
    expect(sc.alpha).toBe("5");

    const receipt = res.content[0]?.text ?? "";
    expect(receipt).toMatch(/PREPARE RECEIPT \(Bittensor — swap_stake, SAME-owner/);
    expect(receipt).toContain(HOTKEY_SS58);
    expect(receipt).toMatch(/origin_netuid:\s+1\b/);
    expect(receipt).toMatch(/destination_netuid:\s+2\b/);
    expect(receipt).toMatch(/amount \(ALPHA\):\s+5\b/);
    expect(receipt).toMatch(/ownership:\s+UNCHANGED/);
    expect(receipt).not.toMatch(/WITHDRAWAL — CUSTODY CHANGE/);

    const record = _peekHandleForTesting(sc.handle);
    expect(record?.payloadFingerprint).toBe(FIXTURE_TAO_G_FP);
    if (record?.tx.txType === "bittensor") {
      expect(record.tx.section).toBe("subtensorModule");
      expect(record.tx.method).toBe("swapStake");
      const summary = record.tx.instructionSummary;
      expect(summary?.kind).toBe("swap-stake");
      if (summary?.kind === "swap-stake") {
        expect(summary.hotkey).toBe(HOTKEY_SS58);
        expect(summary.originNetuid).toBe(1);
        expect(summary.destinationNetuid).toBe(2);
        expect(summary.alphaAmount).toBe(5_000_000_000n);
        expect("destinationColdkey" in summary).toBe(false);
      }
    } else {
      throw new Error("expected bittensor handle");
    }
  });
});
