// prepare_bittensor_add_stake_limit end-to-end regression. Phase 47 — Plan
// 47-02 (TAO-W-02). The DEFAULT slippage-guarded staking entry.
//
// Load-bearing invariants:
//   1. limit_price comes from the CHAIN's simSwapTaoForAlpha (mocked) adjusted
//      by tolerance — NEVER client-side x·y=k. Asserted: the sim function WAS
//      called; no reserve math in the tool.
//   2. amount is LABELED "TAO/RAO" (Pitfall 3 — never alpha here).
//   3. stored payloadFingerprint === Fixture TAO-B (cross-linked).
//   4. full hotkey SS58 echoed unredacted in the receipt; section/method stored
//      camelCase (subtensorModule / addStakeLimit) — the Plan 47-03 allowlist key.
//
// NO live socket — _bittensorRegistry.getApi → shared mock;
// _bittensorBuilder.resolveChainHashes → fixture chain constants.

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

import "../src/tools/prepare_bittensor_add_stake_limit.js";

const FIXTURE_TAO_B_FP =
  "0x7fc3403d36166a068cd922dc4e2f72519563f31df3856a264900e3d8c00d21ff";
const PERSONA_SS58 = "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9";
const HOTKEY_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";

function callTool(args: Record<string, unknown>) {
  const tool = getRegisteredTool("prepare_bittensor_add_stake_limit");
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

describe("prepare_bittensor_add_stake_limit — TAO-W-02 (DEFAULT staking entry)", () => {
  it("limit_price from simSwapTaoForAlpha (mocked) − tolerance; fingerprint === Fixture TAO-B; amount TAO/RAO", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    setActiveBittensorPersona({ slug: "bittensor-whale", ss58Address: PERSONA_SS58 });

    const simSwapTaoForAlpha = vi.fn();
    // currentAlphaPrice = 0.5 TAO/alpha; tolerancePct 0 → limit_price = 500_000_000
    // (the Fixture TAO-B limitPrice). amountStaked 2 TAO → Fixture TAO-B fp.
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockBittensorApi({
        nonce: 0,
        swap: { currentAlphaPriceRaw: 500_000_000n, simAlphaOut: 101_647_804_216n },
        onSimSwapTaoForAlpha: simSwapTaoForAlpha,
      }) as never,
    );

    const res = await callTool({
      hotkey: HOTKEY_SS58,
      netuid: 1,
      rao: "2", // 2 TAO = 2_000_000_000 RAO (Fixture TAO-B amountStaked)
      tolerancePct: 0,
    });

    expect(res.isError).toBeUndefined();
    // The CHAIN sim WAS called — limit_price is NOT client-side reserve math.
    expect(simSwapTaoForAlpha).toHaveBeenCalledTimes(1);
    expect(simSwapTaoForAlpha).toHaveBeenCalledWith(1, 2_000_000_000n);

    const sc = res.structuredContent as {
      handle: string;
      hotkey: string;
      limitPrice: string;
      amountUnit: string;
      payloadFingerprint: string;
    };
    expect(sc.payloadFingerprint).toBe(FIXTURE_TAO_B_FP);
    expect(sc.limitPrice).toBe("500000000"); // ceiling = price + 0%
    expect(sc.amountUnit).toBe("TAO/RAO"); // Pitfall 3 — never alpha here
    expect(sc.hotkey).toBe(HOTKEY_SS58);

    // Receipt: amount LABELED TAO/RAO + FULL hotkey SS58 (no truncation).
    const receipt = res.content[0]?.text ?? "";
    expect(receipt).toMatch(/amount \(TAO\/RAO\):\s+2\b/);
    expect(receipt).toContain(HOTKEY_SS58);

    // section/method stored camelCase — the Plan 47-03 allowlist keys on these.
    const record = _peekHandleForTesting(sc.handle);
    if (record?.tx.txType === "bittensor") {
      expect(record.tx.section).toBe("subtensorModule");
      expect(record.tx.method).toBe("addStakeLimit");
      expect(record.tx.instructionSummary?.kind).toBe("add-stake-limit");
    } else {
      throw new Error("expected bittensor handle");
    }
  });

  it("tolerance widens the limit_price ceiling (1% → price × 1.01)", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    setActiveBittensorPersona({ slug: "bittensor-whale", ss58Address: PERSONA_SS58 });
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockBittensorApi({
        nonce: 0,
        swap: { currentAlphaPriceRaw: 1_000_000_000n },
      }) as never,
    );

    const res = await callTool({
      hotkey: HOTKEY_SS58,
      netuid: 1,
      rao: "2",
      tolerancePct: 1,
    });
    const sc = res.structuredContent as { limitPrice: string };
    // 1_000_000_000 × (10000 + 100) / 10000 = 1_010_000_000 (ceiling).
    expect(sc.limitPrice).toBe("1010000000");
  });

  it("rejects netuid out of u16 range with INVALID_INPUT", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    listAccountsSpy.mockReturnValue([{ address: PERSONA_SS58, chain: "bittensor" }]);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");

    const res = await callTool({ hotkey: HOTKEY_SS58, netuid: 70000, rao: "2" });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
  });
});
