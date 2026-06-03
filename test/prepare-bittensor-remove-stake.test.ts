// prepare_bittensor_remove_stake end-to-end regression. Phase 48 — Plan 48-03
// (TAO-W-06). The PLAIN unguarded remove_stake (NO limit_price).
//
// Load-bearing invariants:
//   1. Demo-mode FIRST refusal — zero socket (getApi/resolveChainHashes NEVER
//      called in the demo-no-persona branch).
//   2. amount is LABELED "ALPHA" and the field is named `alpha` (NOT `rao`) —
//      Pitfall 3. ALPHA is a DISTINCT unit from TAO despite the shared 9-decimal
//      scale; the field NAME carries the unit.
//   3. stored payloadFingerprint === Fixture TAO-E (cross-linked to
//      test/signing-fingerprint-bittensor.test.ts:360-368).
//   4. NO limit_price / allow_partial in the built call.
//   5. Pairing gate → WALLET_NOT_PAIRED when no bittensor account paired.

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

import "../src/tools/prepare_bittensor_remove_stake.js";

// Fixture TAO-E — remove_stake(hotkey=0xaa…, netuid=1, amount_unstaked=3 ALPHA),
// mode:0. Cross-link: test/signing-fingerprint-bittensor.test.ts:365.
const FIXTURE_TAO_E_FP =
  "0x5de53aa60a926ee91ff1ec629833818fccd49293b4046e73ce7aa0e5df0096ae";
const PERSONA_SS58 = "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9";
const HOTKEY_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";

function callTool(args: Record<string, unknown>) {
  const tool = getRegisteredTool("prepare_bittensor_remove_stake");
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

describe("prepare_bittensor_remove_stake — TAO-W-06 (PLAIN remove_stake, no guard)", () => {
  it("demo-mode FIRST refusal: WRONG_MODE + getApi/resolveChainHashes NEVER called (zero socket)", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    const resolveSpy = vi.spyOn(_bittensorBuilder, "resolveChainHashes");

    const res = await callTool({ hotkey: HOTKEY_SS58, netuid: 1, alpha: "3" });

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

    const res = await callTool({ hotkey: HOTKEY_SS58, netuid: 1, alpha: "3" });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed SS58 'hotkey' with INVALID_INPUT before any state read", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");

    const res = await callTool({ hotkey: "nope", netuid: 1, alpha: "3" });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("happy path (demo): fingerprint === Fixture TAO-E; amount ALPHA (field `alpha`); NO limit_price/allow_partial", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    setActiveBittensorPersona({ slug: "bittensor-whale", ss58Address: PERSONA_SS58 });
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockBittensorApi({ nonce: 0 }) as never,
    );

    // alpha "3" = 3 ALPHA = 3_000_000_000 (Fixture TAO-E amount_unstaked).
    const res = await callTool({ hotkey: HOTKEY_SS58, netuid: 1, alpha: "3" });

    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      handle: string;
      hotkey: string;
      netuid: number;
      alpha: string;
      rao?: unknown;
      amountUnit: string;
      payloadFingerprint: string;
      txType: string;
      limitPrice?: unknown;
      allowPartial?: unknown;
    };

    expect(sc.txType).toBe("bittensor");
    expect(sc.payloadFingerprint).toBe(FIXTURE_TAO_E_FP);
    // Field naming reflects ALPHA, not rao — the unit lives in the field NAME.
    expect(sc.amountUnit).toBe("ALPHA");
    expect(sc.alpha).toBe("3");
    expect(sc.rao).toBeUndefined(); // never a `rao` field on remove
    expect(sc.hotkey).toBe(HOTKEY_SS58);
    expect(sc.netuid).toBe(1);
    expect(sc.limitPrice).toBeUndefined();
    expect(sc.allowPartial).toBeUndefined();

    const receipt = res.content[0]?.text ?? "";
    expect(receipt).toMatch(/PREPARE RECEIPT \(Bittensor — remove_stake, PLAIN/);
    expect(receipt).toMatch(/amount \(ALPHA\):\s+3\b/);
    expect(receipt).toContain(HOTKEY_SS58);
    // No limit_price / allow_partial VALUE line (the only "limit_price" mention
    // is the prose NOTE steering to the *_limit guarded default — not a field).
    expect(receipt).not.toMatch(/limit_price:\s/);
    expect(receipt).not.toMatch(/allow_partial:\s/);
    expect(receipt).toMatch(/NOTE:\s+no limit_price — prefer prepare_bittensor_remove_stake_limit/);

    const record = _peekHandleForTesting(sc.handle);
    expect(record?.payloadFingerprint).toBe(FIXTURE_TAO_E_FP);
    if (record?.tx.txType === "bittensor") {
      expect(record.tx.section).toBe("subtensorModule");
      expect(record.tx.method).toBe("removeStake");
      const summary = record.tx.instructionSummary;
      expect(summary?.kind).toBe("remove-stake");
      if (summary?.kind === "remove-stake") {
        expect(summary.hotkey).toBe(HOTKEY_SS58);
        expect(summary.netuid).toBe(1);
        // The ALPHA-typed field name (NEVER amountStakedRao on remove).
        expect(summary.amountUnstakedAlpha).toBe(3_000_000_000n);
        expect("amountStakedRao" in summary).toBe(false);
        expect("limitPrice" in summary).toBe(false);
        expect("allowPartial" in summary).toBe(false);
      }
    } else {
      throw new Error("expected bittensor handle");
    }
  });
});
