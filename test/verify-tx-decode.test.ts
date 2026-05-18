// Phase 9 / Plan 09-05 — verify_tx_decode tool tests (SEC-37).
//
// 18 cases:
//   1-6   ok arm — per-action happy paths (transfer / approve / approve-max /
//                  withdraw / aave-supply / aave-withdraw)
//   7-12  divergence arm — recipient typo / amount off-by-one / approve "max"
//                          mismatch / Aave asset substitution / Aave
//                          onBehalfOf mismatch / claimedDecode.to ≠ tx.to
//                          T-AAVE-TX-TO-CONFUSION-1 anchor
//   13    decode-unsupported arm — unknown selector + routing hint
//   14    action mismatch — agent claims "approve" on transfer calldata
//   15    demo-mode refusal
//   16    HANDLE_NOT_FOUND
//   17    HANDLE_EXPIRED past 15-min TTL
//   18    T-DECODER-SINGLE-SOT-1 anchor — source grep returns 0 viem
//         decoder calls in verify_tx_decode.ts
//
// Re-uses existing Fixture D/E/F/G/H calldata from Phases 6 + 7 (no new
// fixtures per CLAUDE.md "Cryptographic-binding fixtures pinned as
// hardcoded literals" — only NEW shapes warrant new fixtures).

import type { Address, Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAaveV3PoolAddress, getWethAddress } from "../src/config/contracts.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
} from "../src/signing/handle-store.js";
import type { PreparedTx } from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

// Side-effect import — registers the tool in the registry.
await import("../src/tools/verify_tx_decode.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("verify_tx_decode");
  if (!tool) throw new Error("verify_tx_decode not registered");
  return tool.handler(args);
}

// Canonical contract addresses (chainId 1).
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address;
const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const BOB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const UNISWAP_V3_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564" as Address;

const ETHEREUM_AAVE_POOL = getAaveV3PoolAddress(1);
const ETHEREUM_WETH = getWethAddress(1);

const PLACEHOLDER_FINGERPRINT =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;

// Fixture D — ERC-20 transfer(ALICE, 100_000_000) on USDC.
const FIXTURE_D_DATA =
  ("0xa9059cbb" +
    "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" +
    "0000000000000000000000000000000000000000000000000000000005f5e100") as Hex;
const FIXTURE_D_AMOUNT_WEI = "100000000";

// Fixture E — ERC-20 approve(UNISWAP_V3_ROUTER, MAX_UINT256) on USDC.
const MAX_UINT256_HEX = "f".repeat(64);
const FIXTURE_E_DATA =
  ("0x095ea7b3" +
    "000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564" +
    MAX_UINT256_HEX) as Hex;
const FIXTURE_E_AMOUNT_WEI = ((1n << 256n) - 1n).toString();

// Fixture E' — ERC-20 approve(UNISWAP_V3_ROUTER, 100_000_000) on USDC (concrete amount).
const FIXTURE_E_CONCRETE_DATA =
  ("0x095ea7b3" +
    "000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564" +
    "0000000000000000000000000000000000000000000000000000000005f5e100") as Hex;
const FIXTURE_E_CONCRETE_AMOUNT_WEI = "100000000";

// Fixture F — WETH9.withdraw(1 ETH).
const FIXTURE_F_DATA =
  "0x2e1a7d4d0000000000000000000000000000000000000000000000000de0b6b3a7640000" as Hex;
const FIXTURE_F_AMOUNT_WEI = "1000000000000000000";

// Fixture G — Aave V3 supply(USDC, 100_000_000, ALICE, 0).
const FIXTURE_G_DATA =
  ("0x617ba037" +
    "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" +
    "0000000000000000000000000000000000000000000000000000000005f5e100" +
    "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" +
    "0000000000000000000000000000000000000000000000000000000000000000") as Hex;
const FIXTURE_G_AMOUNT_WEI = "100000000";

// Fixture H — Aave V3 withdraw(USDC, 100_000_000, ALICE).
const FIXTURE_H_DATA =
  ("0x69328dec" +
    "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" +
    "0000000000000000000000000000000000000000000000000000000005f5e100" +
    "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8") as Hex;
const FIXTURE_H_AMOUNT_WEI = "100000000";

function seedHandle(opts: { to: Address; data: Hex; valueWei?: bigint }): string {
  const valueWei = opts.valueWei ?? 0n;
  return createHandle({
    args: { to: opts.to, valueWei: valueWei.toString() },
    tx: {
      chainId: 1,
      to: opts.to,
      valueWei,
      data: opts.data,
    },
    payloadFingerprint: PLACEHOLDER_FINGERPRINT,
  });
}

function buildTransferHandle(): string {
  return seedHandle({ to: USDC, data: FIXTURE_D_DATA });
}

function buildApproveMaxHandle(): string {
  return seedHandle({ to: USDC, data: FIXTURE_E_DATA });
}

function buildApproveConcreteHandle(amountWei: bigint = 100_000_000n): string {
  // Concrete-amount approve calldata. amountWei serializes to a 64-hex-char
  // right-padded slot.
  const amountHex = amountWei.toString(16).padStart(64, "0");
  const data = ("0x095ea7b3" +
    "000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564" +
    amountHex) as Hex;
  return seedHandle({ to: USDC, data });
}

function buildWethWithdrawHandle(): string {
  return seedHandle({ to: ETHEREUM_WETH, data: FIXTURE_F_DATA });
}

function buildAaveSupplyHandle(): string {
  return seedHandle({ to: ETHEREUM_AAVE_POOL, data: FIXTURE_G_DATA });
}

function buildAaveWithdrawHandle(): string {
  return seedHandle({ to: ETHEREUM_AAVE_POOL, data: FIXTURE_H_DATA });
}

function buildUnknownSelectorHandle(): string {
  // Synthetic selector — not in v1.3 decoder coverage.
  const data =
    ("0xdeadbeef" +
      "0".repeat(64)) as Hex;
  return seedHandle({
    to: "0x1111111111111111111111111111111111111111" as Address,
    data,
  });
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests 1-6 — ok arm per action
// ---------------------------------------------------------------------------
describe("verify_tx_decode — ok arm (T-VERIFY-DECODE-3ARM-1)", () => {
  it("Test 1 — transfer happy path (Fixture D)", async () => {
    const handle = buildTransferHandle();
    const result = await callTool({
      handle,
      claimedDecode: {
        to: USDC,
        action: "transfer",
        args: { recipient: ALICE, amount: FIXTURE_D_AMOUNT_WEI },
      },
    });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { kind: string }).kind).toBe("ok");
  });

  it("Test 2 — approve concrete amount happy path", async () => {
    const handle = buildApproveConcreteHandle();
    const result = await callTool({
      handle,
      claimedDecode: {
        to: USDC,
        action: "approve",
        args: { spender: UNISWAP_V3_ROUTER, amount: FIXTURE_E_CONCRETE_AMOUNT_WEI },
      },
    });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { kind: string }).kind).toBe("ok");
  });

  it("Test 3 — approve(MAX_UINT256) accepted as 'max' literal (Fixture E)", async () => {
    const handle = buildApproveMaxHandle();
    const result = await callTool({
      handle,
      claimedDecode: {
        to: USDC,
        action: "approve",
        args: { spender: UNISWAP_V3_ROUTER, amount: "max" },
      },
    });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { kind: string }).kind).toBe("ok");
  });

  it("Test 4 — WETH9.withdraw happy path (Fixture F)", async () => {
    const handle = buildWethWithdrawHandle();
    const result = await callTool({
      handle,
      claimedDecode: {
        to: ETHEREUM_WETH,
        action: "withdraw",
        args: { amount: FIXTURE_F_AMOUNT_WEI },
      },
    });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { kind: string }).kind).toBe("ok");
  });

  it("Test 5 — Aave V3 supply happy path (Fixture G)", async () => {
    const handle = buildAaveSupplyHandle();
    const result = await callTool({
      handle,
      claimedDecode: {
        to: ETHEREUM_AAVE_POOL,
        action: "aave-supply",
        args: {
          asset: USDC,
          amount: FIXTURE_G_AMOUNT_WEI,
          onBehalfOf: ALICE,
        },
      },
    });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { kind: string }).kind).toBe("ok");
  });

  it("Test 6 — Aave V3 withdraw happy path (Fixture H)", async () => {
    const handle = buildAaveWithdrawHandle();
    const result = await callTool({
      handle,
      claimedDecode: {
        to: ETHEREUM_AAVE_POOL,
        action: "aave-withdraw",
        args: {
          asset: USDC,
          amount: FIXTURE_H_AMOUNT_WEI,
          to: ALICE,
        },
      },
    });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { kind: string }).kind).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// Tests 7-12 — divergence arm
// ---------------------------------------------------------------------------
describe("verify_tx_decode — divergence arm (T-DECODE-DIVERGENCE-1)", () => {
  it("Test 7 — recipient typo: agent says BOB, server decodes ALICE", async () => {
    const handle = buildTransferHandle();
    const result = await callTool({
      handle,
      claimedDecode: {
        to: USDC,
        action: "transfer",
        args: { recipient: BOB, amount: FIXTURE_D_AMOUNT_WEI },
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      kind: string;
      divergences: Array<{ field: string; agentSaid: string; serverSays: string }>;
    };
    expect(sc.kind).toBe("divergence");
    const recipientDiff = sc.divergences.find((d) => d.field === "recipient");
    expect(recipientDiff).toBeDefined();
    expect(recipientDiff?.agentSaid).toBe(BOB);
    expect(recipientDiff?.serverSays).toBe(ALICE);
  });

  it("Test 8 — approve amount off-by-one", async () => {
    const handle = buildApproveConcreteHandle(100n);
    const result = await callTool({
      handle,
      claimedDecode: {
        to: USDC,
        action: "approve",
        args: { spender: UNISWAP_V3_ROUTER, amount: "101" },
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      kind: string;
      divergences: Array<{ field: string; agentSaid: string; serverSays: string }>;
    };
    expect(sc.kind).toBe("divergence");
    const amountDiff = sc.divergences.find((d) => d.field === "amount");
    expect(amountDiff).toBeDefined();
    expect(amountDiff?.agentSaid).toBe("101");
    expect(amountDiff?.serverSays).toContain("100");
    expect(amountDiff?.serverSays).toContain("WEI");
  });

  it("Test 9 — approve 'max' against concrete-amount tx → divergence", async () => {
    const handle = buildApproveConcreteHandle(100n);
    const result = await callTool({
      handle,
      claimedDecode: {
        to: USDC,
        action: "approve",
        args: { spender: UNISWAP_V3_ROUTER, amount: "max" },
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      kind: string;
      divergences: Array<{ field: string; agentSaid: string; serverSays: string }>;
    };
    expect(sc.kind).toBe("divergence");
    const amountDiff = sc.divergences.find((d) => d.field === "amount");
    expect(amountDiff).toBeDefined();
    expect(amountDiff?.agentSaid).toContain("max");
    expect(amountDiff?.agentSaid).toContain("2^256-1");
    expect(amountDiff?.serverSays).toContain("100");
  });

  it("Test 10 — Aave supply asset substitution: agent says DAI, calldata encodes USDC", async () => {
    const handle = buildAaveSupplyHandle();
    const result = await callTool({
      handle,
      claimedDecode: {
        to: ETHEREUM_AAVE_POOL,
        action: "aave-supply",
        args: {
          asset: DAI, // agent lying — calldata encodes USDC
          amount: FIXTURE_G_AMOUNT_WEI,
          onBehalfOf: ALICE,
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      kind: string;
      divergences: Array<{ field: string; agentSaid: string; serverSays: string }>;
    };
    expect(sc.kind).toBe("divergence");
    const assetDiff = sc.divergences.find((d) => d.field === "asset");
    expect(assetDiff).toBeDefined();
    expect(assetDiff?.agentSaid).toBe(DAI);
    expect(assetDiff?.serverSays).toBe(USDC);
  });

  it("Test 11 — Aave supply onBehalfOf mismatch", async () => {
    const handle = buildAaveSupplyHandle();
    const result = await callTool({
      handle,
      claimedDecode: {
        to: ETHEREUM_AAVE_POOL,
        action: "aave-supply",
        args: {
          asset: USDC,
          amount: FIXTURE_G_AMOUNT_WEI,
          onBehalfOf: BOB, // calldata encodes ALICE
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      kind: string;
      divergences: Array<{ field: string; agentSaid: string; serverSays: string }>;
    };
    expect(sc.kind).toBe("divergence");
    const obfDiff = sc.divergences.find((d) => d.field === "onBehalfOf");
    expect(obfDiff).toBeDefined();
    expect(obfDiff?.agentSaid).toBe(BOB);
    expect(obfDiff?.serverSays).toBe(ALICE);
  });

  it("Test 12 — T-AAVE-TX-TO-CONFUSION-1: claimedDecode.to ≠ record.tx.to (agent confused token vs Pool)", async () => {
    const handle = buildAaveSupplyHandle();
    const result = await callTool({
      handle,
      claimedDecode: {
        // Agent confused: claimed `to` is the asset (USDC), but tx.to is the
        // Aave Pool. The server's per-action rule for aave-supply expects
        // tx.to === canonical Aave Pool; claimed `to` MUST also match.
        to: USDC,
        action: "aave-supply",
        args: {
          asset: USDC,
          amount: FIXTURE_G_AMOUNT_WEI,
          onBehalfOf: ALICE,
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      kind: string;
      divergences: Array<{ field: string; agentSaid: string; serverSays: string }>;
    };
    expect(sc.kind).toBe("divergence");
    // The "to (claimedDecode)" divergence must surface; the canonical Aave
    // Pool address must appear in the serverSays slot.
    const toDiff = sc.divergences.find((d) => d.field === "to (claimedDecode)");
    expect(toDiff).toBeDefined();
    expect(toDiff?.agentSaid).toBe(USDC);
    expect(toDiff?.serverSays).toBe(ETHEREUM_AAVE_POOL);
  });
});

// ---------------------------------------------------------------------------
// Test 13 — decode-unsupported arm
// ---------------------------------------------------------------------------
describe("verify_tx_decode — decode-unsupported arm (T-DECODE-UNSUPPORTED-1)", () => {
  it("Test 13 — unknown selector returns decode-unsupported + routing hint to get_verification_artifact", async () => {
    const handle = buildUnknownSelectorHandle();
    const result = await callTool({
      handle,
      claimedDecode: {
        to: "0x1111111111111111111111111111111111111111",
        action: "transfer",
        args: { recipient: ALICE, amount: "0" },
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { kind: string; reason: string };
    expect(sc.kind).toBe("decode-unsupported");
    expect(sc.reason).toContain("0xdeadbeef");
    expect(sc.reason).toContain("get_verification_artifact");
  });
});

// ---------------------------------------------------------------------------
// Test 14 — action mismatch
// ---------------------------------------------------------------------------
describe("verify_tx_decode — action mismatch", () => {
  it("Test 14 — agent claims 'approve' on transfer calldata → divergence with field='action'", async () => {
    const handle = buildTransferHandle();
    const result = await callTool({
      handle,
      claimedDecode: {
        to: USDC,
        action: "approve",
        args: { spender: ALICE, amount: FIXTURE_D_AMOUNT_WEI },
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      kind: string;
      divergences: Array<{ field: string; agentSaid: string; serverSays: string }>;
    };
    expect(sc.kind).toBe("divergence");
    const actionDiff = sc.divergences.find((d) => d.field === "action");
    expect(actionDiff).toBeDefined();
    expect(actionDiff?.agentSaid).toBe("approve");
    expect(actionDiff?.serverSays).toBe("transfer");
  });
});

// ---------------------------------------------------------------------------
// Test 15 — demo-mode refusal
// ---------------------------------------------------------------------------
describe("verify_tx_decode — demo-mode refusal", () => {
  it("Test 15 — VAULTPILOT_DEMO=true → DEMO_MODE_REFUSED", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    // Seed a handle ANYWAY (in demo mode no real handles would normally
    // exist, but we want to prove the demo-mode gate fires FIRST before
    // handle lookup).
    const handle = buildTransferHandle();

    const result = await callTool({
      handle,
      claimedDecode: {
        to: USDC,
        action: "transfer",
        args: { recipient: ALICE, amount: FIXTURE_D_AMOUNT_WEI },
      },
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "DEMO_MODE_REFUSED",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 16 — HANDLE_NOT_FOUND
// ---------------------------------------------------------------------------
describe("verify_tx_decode — HANDLE_NOT_FOUND", () => {
  it("Test 16 — unknown handle → HANDLE_NOT_FOUND", async () => {
    const result = await callTool({
      handle: "00000000-0000-4000-8000-000000000000",
      claimedDecode: {
        to: USDC,
        action: "transfer",
        args: { recipient: ALICE, amount: "0" },
      },
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "HANDLE_NOT_FOUND",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 17 — HANDLE_EXPIRED past 15-min TTL
// ---------------------------------------------------------------------------
describe("verify_tx_decode — HANDLE_EXPIRED past 15-min TTL", () => {
  it("Test 17 — seeded handle past TTL → HANDLE_EXPIRED", async () => {
    const handle = buildTransferHandle();

    vi.useFakeTimers();
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    const result = await callTool({
      handle,
      claimedDecode: {
        to: USDC,
        action: "transfer",
        args: { recipient: ALICE, amount: FIXTURE_D_AMOUNT_WEI },
      },
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "HANDLE_EXPIRED",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 18 — T-DECODER-SINGLE-SOT-1 (grep enforcement)
// ---------------------------------------------------------------------------
describe("verify_tx_decode — T-DECODER-SINGLE-SOT-1 single-SOT decoder discipline", () => {
  it("Test 18 — verify_tx_decode.ts source contains ZERO calls to viem ABI decoders (comments excluded)", async () => {
    // Single-SOT discipline: verify_tx_decode REUSES `_protocols.decodeErc20Call`
    // + `_aaveProtocols.decodeAaveV3Call`. A parallel ABI parser would create
    // a divergence surface where the cross-check itself becomes a foot-gun
    // (RESEARCH § Topic 5 + PATTERNS.md § 5).
    //
    // Match against CODE lines only (skip // single-line comments). The
    // source-file comment block intentionally NAMES the forbidden APIs to
    // document the discipline; the grep here counts actual call expressions.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = url.fileURLToPath(new URL(".", import.meta.url));
    const target = path.resolve(here, "..", "src", "tools", "verify_tx_decode.ts");
    const source = await fs.readFile(target, "utf8");

    // Filter out single-line comments (`//` prefix after any leading
    // whitespace). The forbidden identifiers can still appear in code if a
    // future refactor adds a parallel decoder — that's the regression the
    // assertion blocks.
    const codeLines = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

    const parallelDecoderHits =
      (codeLines.match(/decodeFunctionData/g) ?? []).length +
      (codeLines.match(/decodeAbiParameters/g) ?? []).length +
      (codeLines.match(/parseAbiItem/g) ?? []).length;

    expect(parallelDecoderHits).toBe(0);
  });

  it("verify_tx_decode reuses `_protocols.decodeErc20Call` via spy round-trip", async () => {
    // Spy on the decoder indirection. The verify_tx_decode handler MUST
    // hit `_protocols.decodeErc20Call` (single SOT — same as preview_send).
    // If a future refactor adds a parallel decoder, this assertion breaks.
    const erc20Mod = await import("../src/protocols/erc20.js");
    const spy = vi.spyOn(erc20Mod._protocols, "decodeErc20Call");
    spy.mockReturnValue({
      kind: "transfer",
      to: ALICE,
      amount: 100_000_000n,
    });

    const handle = buildTransferHandle();
    await callTool({
      handle,
      claimedDecode: {
        to: USDC,
        action: "transfer",
        args: { recipient: ALICE, amount: FIXTURE_D_AMOUNT_WEI },
      },
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Register-all wiring assertion (closes the 09-03 + 09-05 carve)
// ---------------------------------------------------------------------------
describe("verify_tx_decode — register-all wiring (Plan 09-05 collapse)", () => {
  it("getRegisteredTool('verify_tx_decode') is non-null after register-all import", async () => {
    await import("../src/tools/register-all.js");
    const tool = getRegisteredTool("verify_tx_decode");
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(["handle", "claimedDecode"]);
  });

  it("getRegisteredTool('get_verification_artifact') is non-null — Plan 09-03's tool carved here", async () => {
    await import("../src/tools/register-all.js");
    const tool = getRegisteredTool("get_verification_artifact");
    expect(tool).toBeDefined();
  });

  it("register-all.ts contains the import lines for BOTH verify_tx_decode.js and get_verification_artifact.js", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = url.fileURLToPath(new URL(".", import.meta.url));
    const target = path.resolve(here, "..", "src", "tools", "register-all.ts");
    const source = await fs.readFile(target, "utf8");
    expect(source).toContain('import "./verify_tx_decode.js";');
    expect(source).toContain('import "./get_verification_artifact.js";');
  });
});
