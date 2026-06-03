// prepare_bittensor_native_send end-to-end regression. Phase 47 — Plan 47-02
// (TAO-W-01). Bittensor sibling of test/prepare-solana-native-send.test.ts.
//
// Load-bearing invariants:
//   1. Demo-mode FIRST refusal — getActiveBittensorPersona consulted BEFORE
//      listAccounts; demo-on + no persona → WRONG_MODE; _bittensorRegistry.getApi
//      NEVER called in the demo branch (ZERO socket risk).
//   2. PREPARE RECEIPT verbatim — receipt carries the agent's raw `to` + `rao`.
//   3. payloadFingerprint === Fixture TAO-A (cross-linked to
//      test/signing-fingerprint-bittensor.test.ts) — the canonical native fp
//      0x3fabc5b4… proves byte-identity prepare↔fixture.
//   4. Pairing gate → WALLET_NOT_PAIRED when no bittensor account paired.
//
// Mocks (NO live socket — anti-hang): _bittensorRegistry.getApi → the shared
// mock ApiPromise; _bittensorBuilder.resolveChainHashes → the fixture chain
// constants; listAccounts → the pairing surface; getActiveBittensorPersona via
// setActiveBittensorPersona.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
}));

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

import "../src/tools/prepare_bittensor_native_send.js";

const FIXTURE_TAO_A_FP =
  "0x3fabc5b4655a1a92a4ff462642a3ce3961bd0f9520ab5f8c134c32cd0c039dde";
const PERSONA_SS58 = "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9";
const DEST_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";

function callTool(args: Record<string, unknown>) {
  const tool = getRegisteredTool("prepare_bittensor_native_send");
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

describe("prepare_bittensor_native_send — TAO-W-01", () => {
  it("demo-mode FIRST refusal: WRONG_MODE + getApi NEVER called", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    // No persona set (beforeEach reset cleared it) → demo-mode WRONG_MODE.
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");

    const res = await callTool({ to: DEST_SS58, rao: "1" });

    expect(res.isError).toBe(true);
    expect(
      (res.structuredContent as { errorCode?: string }).errorCode,
    ).toBe("WRONG_MODE");
    // ZERO socket risk — the demo branch short-circuits before any registry call.
    expect(getApiSpy).not.toHaveBeenCalled();
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("real-mode pairing gate: WALLET_NOT_PAIRED when no bittensor account", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    listAccountsSpy.mockReturnValue([]);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");

    const res = await callTool({ to: DEST_SS58, rao: "1" });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed SS58 'to' with INVALID_INPUT before any state read", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");

    const res = await callTool({ to: "not-an-ss58", rao: "1" });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });

  it("rejects off-by-decimal 'rao' (>9 frac digits) with INVALID_INPUT", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(false);
    listAccountsSpy.mockReturnValue([{ address: PERSONA_SS58, chain: "bittensor" }]);
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockBittensorApi() as never,
    );

    const res = await callTool({ to: DEST_SS58, rao: "1.0000000001" });

    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode?: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("happy path (demo): fingerprint === Fixture TAO-A; receipt verbatim; handle stored", async () => {
    vi.spyOn(env, "isDemoMode").mockReturnValue(true);
    setActiveBittensorPersona({ slug: "bittensor-whale", ss58Address: PERSONA_SS58 });
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockBittensorApi({ nonce: 0 }) as never,
    );

    // rao "1" = 1 TAO = 1_000_000_000 RAO — exactly Fixture TAO-A.
    const res = await callTool({ to: DEST_SS58, rao: "1" });

    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as {
      handle: string;
      to: string;
      rao: string;
      payloadFingerprint: string;
      txType: string;
    };
    expect(sc.txType).toBe("bittensor");
    expect(sc.payloadFingerprint).toBe(FIXTURE_TAO_A_FP);
    // Verbatim args (PREP-02).
    expect(sc.to).toBe(DEST_SS58);
    expect(sc.rao).toBe("1");

    // Receipt carries the verbatim raw args + the FULL untruncated dest SS58.
    const receiptText = res.content[0]?.text ?? "";
    expect(receiptText).toMatch(/PREPARE RECEIPT \(Bittensor — native transfer\)/);
    expect(receiptText).toContain(DEST_SS58); // no truncation
    expect(receiptText).toMatch(/rao:\s+1\b/);

    // The stored handle is a PreparedTxBittensor with the matching fingerprint.
    const record = _peekHandleForTesting(sc.handle);
    expect(record?.payloadFingerprint).toBe(FIXTURE_TAO_A_FP);
    expect(record?.tx.txType).toBe("bittensor");
    if (record?.tx.txType === "bittensor") {
      expect(record.tx.section).toBe("balances");
      expect(record.tx.method).toBe("transferKeepAlive");
      expect(record.tx.mode).toBe(0);
    }
  });
});
