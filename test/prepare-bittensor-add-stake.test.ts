// prepare_bittensor_add_stake end-to-end regression. Phase 48 — Plan 48-03
// (TAO-W-06). The PLAIN unguarded add_stake (NO limit_price) — the preview
// emits a [NOTICE — no slippage guard] steering to the *_limit DEFAULT.
//
// Load-bearing invariants:
//   1. Demo-mode FIRST refusal — getActiveBittensorPersona consulted BEFORE
//      listAccounts; demo-on + no persona → WRONG_MODE; _bittensorRegistry.getApi
//      + _bittensorBuilder.resolveChainHashes NEVER called in the demo branch
//      (ZERO socket risk — anti-hang).
//   2. amount is LABELED "TAO/RAO" (field `rao`) — Pitfall 3 (NEVER alpha here).
//   3. stored payloadFingerprint === Fixture TAO-D (cross-linked to
//      test/signing-fingerprint-bittensor.test.ts:320-328).
//   4. NO limit_price / allow_partial in the built call — the plain shape stores
//      section/method = subtensorModule/addStake with a kind:"add-stake" summary
//      carrying ONLY hotkey/netuid/amountStakedRao (no limitPrice field).
//   5. Pairing gate → WALLET_NOT_PAIRED when no bittensor account paired.
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

import "../src/tools/prepare_bittensor_add_stake.js";

// Fixture TAO-D — add_stake(hotkey=0xaa…, netuid=1, amount_staked=2 TAO), mode:0.
// Cross-link: test/signing-fingerprint-bittensor.test.ts:325 (the pinned literal
// anchor; this consumer test re-anchors prepare↔fixture byte-identity).
const FIXTURE_TAO_D_FP =
  "0xc19b3f65d74f84c0d86873005018f4f098a3d2c4cd23ebd82afe08388fe01a0e";
const PERSONA_SS58 = "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9";
const HOTKEY_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";

function callTool(args: Record<string, unknown>) {
  const tool = getRegisteredTool("prepare_bittensor_add_stake");
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

describe("prepare_bittensor_add_stake — TAO-W-06 (PLAIN add_stake, no guard)", () => {
  it("demo-mode FIRST refusal: WRONG_MODE + getApi/resolveChainHashes NEVER called (zero socket)", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    // No persona set (beforeEach reset cleared it) → demo-mode WRONG_MODE.
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    const resolveSpy = vi.spyOn(_bittensorBuilder, "resolveChainHashes");

    const res = await callTool({ hotkey: HOTKEY_SS58, netuid: 1, rao: "2" });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "WRONG_MODE",
    );
    // ZERO socket risk — the demo branch short-circuits before any registry call.
    expect(getApiSpy).not.toHaveBeenCalled();
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("real-mode pairing gate: WALLET_NOT_PAIRED when no bittensor account", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    listAccountsSpy.mockReturnValue([]);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");

    const res = await callTool({ hotkey: HOTKEY_SS58, netuid: 1, rao: "2" });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed SS58 'hotkey' with INVALID_INPUT before any state read", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");

    const res = await callTool({ hotkey: "not-an-ss58", netuid: 1, rao: "2" });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
    expect(listAccountsSpy).not.toHaveBeenCalled();
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

  it("rejects off-by-decimal 'rao' (>9 frac digits) with INVALID_INPUT", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    listAccountsSpy.mockReturnValue([{ address: PERSONA_SS58, chain: "bittensor" }]);
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockBittensorApi() as never,
    );

    const res = await callTool({
      hotkey: HOTKEY_SS58,
      netuid: 1,
      rao: "2.0000000001",
    });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("happy path (demo): fingerprint === Fixture TAO-D; amount TAO/RAO; NO limit_price/allow_partial; full hotkey echoed", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    setActiveBittensorPersona({ slug: "bittensor-whale", ss58Address: PERSONA_SS58 });
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockBittensorApi({ nonce: 0 }) as never,
    );

    // rao "2" = 2 TAO = 2_000_000_000 RAO (Fixture TAO-D amount_staked).
    const res = await callTool({ hotkey: HOTKEY_SS58, netuid: 1, rao: "2" });

    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      handle: string;
      hotkey: string;
      netuid: number;
      rao: string;
      amountUnit: string;
      payloadFingerprint: string;
      txType: string;
      // The plain shape must NOT surface limit_price / allow_partial fields.
      limitPrice?: unknown;
      allowPartial?: unknown;
    };

    expect(sc.txType).toBe("bittensor");
    expect(sc.payloadFingerprint).toBe(FIXTURE_TAO_D_FP);
    expect(sc.amountUnit).toBe("TAO/RAO"); // Pitfall 3 — never alpha here
    expect(sc.hotkey).toBe(HOTKEY_SS58);
    expect(sc.netuid).toBe(1);
    expect(sc.rao).toBe("2"); // verbatim agent string
    // NO slippage-guard fields on the plain structuredContent.
    expect(sc.limitPrice).toBeUndefined();
    expect(sc.allowPartial).toBeUndefined();

    // Receipt: amount LABELED TAO/RAO + FULL hotkey SS58 (no truncation) +
    // the no-limit_price NOTE; NO limit_price / allow_partial lines.
    const receipt = res.content[0]?.text ?? "";
    expect(receipt).toMatch(/PREPARE RECEIPT \(Bittensor — add_stake, PLAIN/);
    expect(receipt).toMatch(/amount \(TAO\/RAO\):\s+2\b/);
    expect(receipt).toContain(HOTKEY_SS58);
    // No limit_price / allow_partial VALUE line (the only "limit_price" mention
    // is the prose NOTE steering to the *_limit guarded default — not a field).
    expect(receipt).not.toMatch(/limit_price:\s/);
    expect(receipt).not.toMatch(/allow_partial:\s/);
    // The plain shape steers to the guarded default via the NOTE line.
    expect(receipt).toMatch(/NOTE:\s+no limit_price — prefer prepare_bittensor_add_stake_limit/);

    // section/method stored camelCase; summary kind "add-stake" with NO
    // limitPrice/allowPartial field (the plain-shape money-correctness check).
    const record = _peekHandleForTesting(sc.handle);
    expect(record?.payloadFingerprint).toBe(FIXTURE_TAO_D_FP);
    if (record?.tx.txType === "bittensor") {
      expect(record.tx.section).toBe("subtensorModule");
      expect(record.tx.method).toBe("addStake");
      expect(record.tx.mode).toBe(0);
      const summary = record.tx.instructionSummary;
      expect(summary?.kind).toBe("add-stake");
      if (summary?.kind === "add-stake") {
        expect(summary.hotkey).toBe(HOTKEY_SS58);
        expect(summary.netuid).toBe(1);
        expect(summary.amountStakedRao).toBe(2_000_000_000n);
        // No guard fields leak into the plain summary.
        expect("limitPrice" in summary).toBe(false);
        expect("allowPartial" in summary).toBe(false);
      }
    } else {
      throw new Error("expected bittensor handle");
    }
  });
});
