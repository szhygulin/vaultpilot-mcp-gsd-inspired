// prepare_bittensor_remove_stake_limit end-to-end regression. Phase 47 — Plan
// 47-02 (TAO-W-03). The DEFAULT slippage-guarded staking exit.
//
// Load-bearing invariants:
//   1. amount is LABELED "ALPHA" — a DISTINCT unit from TAO (Pitfall 3). The
//      tool's amount field is `alpha`, never `rao` (per-extrinsic unit typing —
//      one field never accepts both).
//   2. limit_price comes from the CHAIN's simSwapAlphaForTao (mocked) − tolerance
//      (a price FLOOR) — NEVER client-side x·y=k.
//   3. section/method stored camelCase (subtensorModule / removeStakeLimit).
//
// NO live socket.

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

import "../src/tools/prepare_bittensor_remove_stake_limit.js";

const PERSONA_SS58 = "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9";
const HOTKEY_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";

function callTool(args: Record<string, unknown>) {
  const tool = getRegisteredTool("prepare_bittensor_remove_stake_limit");
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

describe("prepare_bittensor_remove_stake_limit — TAO-W-03 (DEFAULT staking exit)", () => {
  it("amount LABELED ALPHA (distinct from TAO); limit_price from simSwapAlphaForTao − tolerance (floor)", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    setActiveBittensorPersona({ slug: "bittensor-whale", ss58Address: PERSONA_SS58 });

    const simSwapAlphaForTao = vi.fn();
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockBittensorApi({
        nonce: 0,
        swap: { currentAlphaPriceRaw: 1_000_000_000n, simTaoOut: 9_828_074n },
        onSimSwapAlphaForTao: simSwapAlphaForTao,
      }) as never,
    );

    const res = await callTool({
      hotkey: HOTKEY_SS58,
      netuid: 1,
      alpha: "2", // 2 ALPHA — the field is `alpha`, NOT `rao`.
      tolerancePct: 1,
    });

    expect(res.isError).toBeUndefined();
    // The CHAIN sim WAS called — limit_price is NOT client-side reserve math.
    expect(simSwapAlphaForTao).toHaveBeenCalledTimes(1);
    expect(simSwapAlphaForTao).toHaveBeenCalledWith(1, 2_000_000_000n);

    const sc = res.structuredContent as {
      alpha: string;
      limitPrice: string;
      amountUnit: string;
    };
    expect(sc.amountUnit).toBe("ALPHA"); // DISTINCT unit from TAO (Pitfall 3)
    expect(sc.alpha).toBe("2");
    // FLOOR: 1_000_000_000 × (10000 − 100) / 10000 = 990_000_000.
    expect(sc.limitPrice).toBe("990000000");

    // Receipt labels the amount ALPHA (NOT TAO/RAO) + full hotkey.
    const receipt = res.content[0]?.text ?? "";
    expect(receipt).toMatch(/amount \(ALPHA\):\s+2\b/);
    expect(receipt).not.toMatch(/amount \(TAO\/RAO\)/);
    expect(receipt).toContain(HOTKEY_SS58);
  });

  it("section/method stored camelCase (subtensorModule / removeStakeLimit) + remove-stake-limit summary", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    setActiveBittensorPersona({ slug: "bittensor-whale", ss58Address: PERSONA_SS58 });
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockBittensorApi({ nonce: 0, swap: { currentAlphaPriceRaw: 1_000_000_000n } }) as never,
    );

    const res = await callTool({ hotkey: HOTKEY_SS58, netuid: 5, alpha: "1.5" });
    const sc = res.structuredContent as { handle: string };
    const record = _peekHandleForTesting(sc.handle);
    if (record?.tx.txType === "bittensor") {
      expect(record.tx.section).toBe("subtensorModule");
      expect(record.tx.method).toBe("removeStakeLimit");
      expect(record.tx.instructionSummary?.kind).toBe("remove-stake-limit");
      if (record.tx.instructionSummary?.kind === "remove-stake-limit") {
        // The summary carries amountUnstakedAlpha (ALPHA), NOT a rao field.
        expect(record.tx.instructionSummary.amountUnstakedAlpha).toBe(1_500_000_000n);
      }
    } else {
      throw new Error("expected bittensor handle");
    }
  });
});
