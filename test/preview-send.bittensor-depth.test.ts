// preview_send Bittensor deferred-staking depth regression. Phase 48 — Plan
// 48-03 (TAO-W-06/07/08 + TAO-R-05 preview-warning wiring).
//
// Drives previewSendBittensorBranch for each new shape by seeding a handle via
// createHandle (the Solana-preview seed pattern) with the 48-01 instruction
// summary, then asserting the per-shape advisory blocks:
//
//   1. [NOTICE — no slippage guard] PRESENT for plain add-stake / remove-stake;
//      ABSENT for the slippage-guarded add-stake-limit / remove-stake-limit.
//   2. [WITHDRAWAL — CUSTODY CHANGE] PRESENT for transfer-stake (with the full
//      destination_coldkey); ABSENT for move-stake / swap-stake (distinctness —
//      §Pattern D / T-48-06).
//   3. [WARNING — hotkey not registered on netuid N] fires when the staked
//      hotkey is ABSENT from getNeuronsLite(netuid) and does NOT fire when
//      present (TAO-R-05, §Pattern E — advisory, never a refusal).
//
// ANTI-HANG: NO live socket. _simulationBittensor.runBittensorPreviewSimulation
// is mocked to "ok" (the Layer 0.7 dry-run never touches a node), and
// _bittensorRegistry.getApi (read by isHotkeyRegisteredOnNetuid →
// getNeuronsLite) is a stub api with NO transport. The blake2-256 presign is a
// pure fn over the seeded signableBlob — deterministic, no RPC.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _bittensorRegistry } from "../src/chains/bittensor/registry.js";
import { _simulationBittensor } from "../src/signing/simulation-bittensor.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  type BittensorInstructionSummary,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const HOTKEY_A = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";
const HOTKEY_B = "5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy";
const DEST_COLDKEY = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
const SS58 = "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9";

// A non-trivial signable blob — the presign hash is deterministic over it; we
// never assert the hash value here (the byte-binding fixtures live in
// test/signing-presign-hash-bittensor.test.ts), only the advisory blocks.
const SIGNABLE_BLOB = new Uint8Array([9, 0, 1, 2, 3, 4, 5, 6, 7, 8]);

function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

/** Seed a Bittensor handle carrying the given (section, method, summary). */
function seedBittensorHandle(opts: {
  section: string;
  method: string;
  summary: BittensorInstructionSummary;
}): string {
  return createHandle({
    args: { to: ZERO_ADDRESS, valueWei: "0" },
    tx: {
      txType: "bittensor",
      chainId: 0,
      to: ZERO_ADDRESS,
      valueWei: 0n,
      data: "0x",
      signableBlob: SIGNABLE_BLOB,
      signerPayloadJSON: { method: "0x0900" },
      ss58Address: SS58,
      section: opts.section,
      method: opts.method,
      mode: 0,
      metadataHash: null,
      instructionSummary: opts.summary,
    },
    payloadFingerprint:
      "0x0000000000000000000000000000000000000000000000000000000000000000",
  });
}

/**
 * Stub `getApi()` whose getNeuronsLite(netuid) returns the given hotkey set.
 * NEVER opens a transport — isHotkeyRegisteredOnNetuid reads ONLY getNeuronsLite.
 */
function stubApiWithRegistered(hotkeys: string[]): unknown {
  return {
    call: {
      neuronInfoRuntimeApi: {
        getNeuronsLite: vi.fn().mockImplementation((_netuid: number) =>
          Promise.resolve({
            toJSON: () => hotkeys.map((hk, i) => ({ uid: i, hotkey: hk })),
          }),
        ),
      },
    },
  };
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  // Layer 0.7 advisory dry-run — "ok" so the preview proceeds without a socket.
  vi.spyOn(_simulationBittensor, "runBittensorPreviewSimulation").mockResolvedValue(
    { status: "ok", detail: null },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// TAO-W-06 — [NOTICE — no slippage guard] present for plain, absent for *_limit.
// ---------------------------------------------------------------------------
describe("preview_send (Bittensor) — NOTICE block (TAO-W-06)", () => {
  it("plain add-stake emits the [NOTICE — no slippage guard] block steering to *_limit", async () => {
    // The staked hotkey IS registered → no unregistered WARNING to confound.
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      stubApiWithRegistered([HOTKEY_A]) as never,
    );
    const handle = seedBittensorHandle({
      section: "subtensorModule",
      method: "addStake",
      summary: {
        kind: "add-stake",
        hotkey: HOTKEY_A,
        netuid: 1,
        amountStakedRao: 2_000_000_000n,
      },
    });

    const res = await callTool({ handle });
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";

    expect(text).toMatch(/\[NOTICE — no slippage guard\]/);
    expect(text).toMatch(/PREFER\s+prepare_bittensor_add_stake_limit/);
    // The plain DECODED ARGS surfaces the TAO/RAO amount + NONE guard.
    expect(text).toMatch(/subtensorModule\.add_stake/);
    expect(text).toMatch(/2000000000\s+\(TAO\/RAO\)/);
  });

  it("plain remove-stake emits the [NOTICE — no slippage guard] block; amount ALPHA", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      stubApiWithRegistered([HOTKEY_A]) as never,
    );
    const handle = seedBittensorHandle({
      section: "subtensorModule",
      method: "removeStake",
      summary: {
        kind: "remove-stake",
        hotkey: HOTKEY_A,
        netuid: 1,
        amountUnstakedAlpha: 3_000_000_000n,
      },
    });

    const res = await callTool({ handle });
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";

    expect(text).toMatch(/\[NOTICE — no slippage guard\]/);
    expect(text).toMatch(/subtensorModule\.remove_stake/);
    expect(text).toMatch(/3000000000\s+\(ALPHA\)/);
  });

  it("slippage-guarded add-stake-limit does NOT emit the NOTICE block", async () => {
    const handle = seedBittensorHandle({
      section: "subtensorModule",
      method: "addStakeLimit",
      summary: {
        kind: "add-stake-limit",
        hotkey: HOTKEY_A,
        netuid: 1,
        amountStakedRao: 2_000_000_000n,
        limitPrice: 500_000_000n,
        allowPartial: true,
      },
    });

    const res = await callTool({ handle });
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";

    expect(text).not.toMatch(/\[NOTICE — no slippage guard\]/);
    // The guarded arm DOES surface the limit_price.
    expect(text).toMatch(/limit_price:\s+500000000/);
  });

  it("slippage-guarded remove-stake-limit does NOT emit the NOTICE block", async () => {
    const handle = seedBittensorHandle({
      section: "subtensorModule",
      method: "removeStakeLimit",
      summary: {
        kind: "remove-stake-limit",
        hotkey: HOTKEY_A,
        netuid: 1,
        amountUnstakedAlpha: 3_000_000_000n,
        limitPrice: 500_000_000n,
        allowPartial: true,
      },
    });

    const res = await callTool({ handle });
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";

    expect(text).not.toMatch(/\[NOTICE — no slippage guard\]/);
  });
});

// ---------------------------------------------------------------------------
// TAO-W-08 — [WITHDRAWAL — CUSTODY CHANGE] present for transfer, absent for
// move/swap (the distinctness guard — T-48-06).
// ---------------------------------------------------------------------------
describe("preview_send (Bittensor) — WITHDRAWAL block distinctness (TAO-W-08)", () => {
  it("transfer-stake emits the [WITHDRAWAL — CUSTODY CHANGE] block with the FULL destination_coldkey", async () => {
    const handle = seedBittensorHandle({
      section: "subtensorModule",
      method: "transferStake",
      summary: {
        kind: "transfer-stake",
        destinationColdkey: DEST_COLDKEY,
        hotkey: HOTKEY_A,
        originNetuid: 1,
        destinationNetuid: 2,
        alphaAmount: 5_000_000_000n,
      },
    });

    const res = await callTool({ handle });
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";

    expect(text).toMatch(/\[WITHDRAWAL — CUSTODY CHANGE\]/);
    // The destination coldkey is echoed FULL/unredacted in the block.
    expect(text).toContain(DEST_COLDKEY);
    expect(text).toMatch(/subtensorModule\.transfer_stake/);
    expect(text).toMatch(/ownership:\s+CHANGES/);
  });

  it("move-stake does NOT emit the WITHDRAWAL block (same-owner distinctness)", async () => {
    // The destination hotkey is registered → no confounding WARNING.
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      stubApiWithRegistered([HOTKEY_B]) as never,
    );
    const handle = seedBittensorHandle({
      section: "subtensorModule",
      method: "moveStake",
      summary: {
        kind: "move-stake",
        originHotkey: HOTKEY_A,
        destinationHotkey: HOTKEY_B,
        originNetuid: 1,
        destinationNetuid: 2,
        alphaAmount: 5_000_000_000n,
      },
    });

    const res = await callTool({ handle });
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";

    expect(text).not.toMatch(/\[WITHDRAWAL — CUSTODY CHANGE\]/);
    expect(text).toMatch(/subtensorModule\.move_stake/);
    expect(text).toMatch(/ownership:\s+UNCHANGED/);
  });

  it("swap-stake does NOT emit the WITHDRAWAL block (same-owner distinctness)", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      stubApiWithRegistered([HOTKEY_A]) as never,
    );
    const handle = seedBittensorHandle({
      section: "subtensorModule",
      method: "swapStake",
      summary: {
        kind: "swap-stake",
        hotkey: HOTKEY_A,
        originNetuid: 1,
        destinationNetuid: 2,
        alphaAmount: 5_000_000_000n,
      },
    });

    const res = await callTool({ handle });
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";

    expect(text).not.toMatch(/\[WITHDRAWAL — CUSTODY CHANGE\]/);
    expect(text).toMatch(/subtensorModule\.swap_stake/);
    expect(text).toMatch(/ownership:\s+UNCHANGED/);
  });
});

// ---------------------------------------------------------------------------
// TAO-R-05 — unregistered-hotkey WARNING fires on absence, not on presence.
// ---------------------------------------------------------------------------
describe("preview_send (Bittensor) — unregistered-hotkey WARNING (TAO-R-05)", () => {
  it("fires [WARNING — hotkey not registered on netuid N] when the staked hotkey is ABSENT from getNeuronsLite", async () => {
    // getNeuronsLite(netuid 1) returns a DIFFERENT hotkey → HOTKEY_A absent.
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      stubApiWithRegistered([HOTKEY_B]) as never,
    );
    const handle = seedBittensorHandle({
      section: "subtensorModule",
      method: "addStake",
      summary: {
        kind: "add-stake",
        hotkey: HOTKEY_A,
        netuid: 1,
        amountStakedRao: 2_000_000_000n,
      },
    });

    const res = await callTool({ handle });
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";

    expect(text).toMatch(/\[WARNING — hotkey not registered on netuid 1\]/);
  });

  it("does NOT fire the WARNING when the staked hotkey IS present in getNeuronsLite", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      stubApiWithRegistered([HOTKEY_A]) as never,
    );
    const handle = seedBittensorHandle({
      section: "subtensorModule",
      method: "addStake",
      summary: {
        kind: "add-stake",
        hotkey: HOTKEY_A,
        netuid: 1,
        amountStakedRao: 2_000_000_000n,
      },
    });

    const res = await callTool({ handle });
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";

    expect(text).not.toMatch(/\[WARNING — hotkey not registered/);
  });

  it("move-stake checks the DESTINATION netuid/hotkey for the WARNING", async () => {
    // Destination hotkey absent from the destination subnet → WARNING (netuid 2).
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      stubApiWithRegistered([HOTKEY_A]) as never,
    );
    const handle = seedBittensorHandle({
      section: "subtensorModule",
      method: "moveStake",
      summary: {
        kind: "move-stake",
        originHotkey: HOTKEY_A,
        destinationHotkey: HOTKEY_B,
        originNetuid: 1,
        destinationNetuid: 2,
        alphaAmount: 5_000_000_000n,
      },
    });

    const res = await callTool({ handle });
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";

    expect(text).toMatch(/\[WARNING — hotkey not registered on netuid 2\]/);
  });

  it("a registration-read failure is best-effort: NO warning, preview still succeeds (never a refusal)", async () => {
    // getApi rejects → isHotkeyRegisteredOnNetuid throws → the preview swallows
    // it to a skip. The on-device hash is the trust anchor.
    vi.spyOn(_bittensorRegistry, "getApi").mockRejectedValue(
      new Error("subtensor RPC unreachable"),
    );
    const handle = seedBittensorHandle({
      section: "subtensorModule",
      method: "addStake",
      summary: {
        kind: "add-stake",
        hotkey: HOTKEY_A,
        netuid: 1,
        amountStakedRao: 2_000_000_000n,
      },
    });

    const res = await callTool({ handle });
    // Preview is NOT refused by a registration-read failure.
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";
    expect(text).not.toMatch(/\[WARNING — hotkey not registered/);
    // The plain-shape NOTICE still emits (the read failure only skips the WARNING).
    expect(text).toMatch(/\[NOTICE — no slippage guard\]/);
  });
});

// ---------------------------------------------------------------------------
// transfer-stake is a custody op (no staking-target WARNING — the WITHDRAWAL
// block is its guard). It must NOT consult isHotkeyRegisteredOnNetuid.
// ---------------------------------------------------------------------------
describe("preview_send (Bittensor) — transfer-stake skips the staking-target WARNING", () => {
  it("transfer-stake never emits the unregistered-hotkey WARNING (custody op, not a staking target)", async () => {
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    const handle = seedBittensorHandle({
      section: "subtensorModule",
      method: "transferStake",
      summary: {
        kind: "transfer-stake",
        destinationColdkey: DEST_COLDKEY,
        hotkey: HOTKEY_A,
        originNetuid: 1,
        destinationNetuid: 2,
        alphaAmount: 5_000_000_000n,
      },
    });

    const res = await callTool({ handle });
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";

    expect(text).not.toMatch(/\[WARNING — hotkey not registered/);
    // No registration read for the custody op.
    expect(getApiSpy).not.toHaveBeenCalled();
  });
});
