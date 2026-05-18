// Phase 9 Plan 09-03 Task 1 — get_verification_artifact tool tests (SEC-34).
//
// 18 cases:
//   1.  T-PASTEABLE-BYTE-IDENTITY-1 anchor — byte-level fixture for previewed status
//   2.  Sparse JSON shape (previewed)
//   3.  Status branch: prepared (presignHash null + "(not yet previewed)" literal)
//   4.  Status branch: sent (bytes invariant; presignHash non-null)
//   5.  Status branch: cancelled (bytes invariant)
//   6.  Demo-mode refusal
//   7.  HANDLE_NOT_FOUND
//   8.  HANDLE_EXPIRED past 15-min TTL
//   9.  HANDLE_TTL_MS constant inheritance (no new TTL)
//   10. ERC-20 transfer selector populated
//   11. Native-send selector null
//   12. Aave-supply long calldata fits single-line (no wrap markers)
//   13. valueWei serialization (string, not bigint)
//   14. payloadFingerprint regex (^0x[a-f0-9]{64}$)
//   15. `>>>>` open marker presence (80 chars)
//   16. `<<<<` close marker presence (80 chars)
//   17. Canned prompt structure (5 steps + halt instruction)
//   18. Unicode U+2016 (`‖`) preservation
//
// Test-side invocation pattern: this tool is NOT yet wired into
// `src/tools/register-all.ts` (Plan 09-05 consolidates that import alongside
// `verify_tx_decode.js` to avoid 09-03 ∥ 09-05 rebase). At test time, the
// `registerTool` side-effect fires at module load, so an explicit
// `await import("../src/tools/get_verification_artifact.js")` makes
// `getRegisteredTool("get_verification_artifact")` available.

import type { Address, Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PASTEABLE_BLOCK_TEMPLATE } from "../src/signing/blocks.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  HANDLE_TTL_MS,
  transitionToCancelled,
  transitionToPreviewed,
  transitionToSent,
} from "../src/signing/handle-store.js";
import type { PreparedTx, PreviewPinned } from "../src/signing/handle-store.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

// Side-effect import fires once for the suite — registers the tool in the
// in-process registry without going through src/tools/register-all.ts.
await import("../src/tools/get_verification_artifact.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Canonical Phase 4 Fixture A native-send values (cross-link to
// `test/signing-fingerprint.test.ts`).
const TO_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const VALUE_WEI_STR = "1000000000000000000";
const VALUE_WEI_BIGINT = 1_000_000_000_000_000_000n;
const FINGERPRINT_FIXTURE_A =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;
const PRESIGN_HASH_FIXTURE_C =
  "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85" as Hex;
const PREVIEW_TOKEN = "11111111-1111-4111-8111-111111111111";
const TX_HASH = "0xdeadbeef00000000000000000000000000000000000000000000000000000000" as Hex;

// ERC-20 transfer(0xAlice, 100_000_000) — 0xa9059cbb selector + 32-byte
// address + 32-byte amount = 68 bytes = 136 hex chars + 0x = 138 chars.
const ERC20_TRANSFER_DATA =
  "0xa9059cbb00000000000000000000000070997970C51812dc3A010C7d01b50e0d17dc79C80000000000000000000000000000000000000000000000000000000005f5e100" as Hex;

// Aave V3 supply(asset=USDC, amount=100_000, onBehalfOf=alice, referralCode=0)
// — 0x617ba037 selector + 4×32-byte args = 132 bytes = 264 hex + 0x = 266 chars.
const AAVE_SUPPLY_DATA =
  "0x617ba037000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000186a000000000000000000000000070997970C51812dc3A010C7d01b50e0d17dc79C80000000000000000000000000000000000000000000000000000000000000000" as Hex;

function buildPreparedTxNative(): PreparedTx {
  return {
    chainId: 1,
    to: TO_ADDRESS,
    valueWei: VALUE_WEI_BIGINT,
    data: "0x" as Hex,
    nonce: 7,
    gas: 21000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
  };
}

function buildPinnedNative(): PreviewPinned {
  return {
    nonce: 7,
    gas: 21000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
    previewToken: PREVIEW_TOKEN,
    presignHash: PRESIGN_HASH_FIXTURE_C,
    selector: null,
  };
}

function seedPreparedNativeHandle(): string {
  return createHandle({
    args: { to: TO_ADDRESS, valueWei: VALUE_WEI_STR },
    tx: buildPreparedTxNative(),
    payloadFingerprint: FINGERPRINT_FIXTURE_A,
  });
}

function buildPreparedTxERC20(): PreparedTx {
  return {
    chainId: 1,
    to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address, // USDC
    valueWei: 0n,
    data: ERC20_TRANSFER_DATA,
    nonce: 7,
    gas: 60000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
  };
}

function buildPinnedERC20(): PreviewPinned {
  return {
    nonce: 7,
    gas: 60000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
    previewToken: PREVIEW_TOKEN,
    presignHash: PRESIGN_HASH_FIXTURE_C,
    selector: "0xa9059cbb" as Hex,
  };
}

function buildPreparedTxAaveSupply(): PreparedTx {
  return {
    chainId: 1,
    to: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as Address, // Aave Pool
    valueWei: 0n,
    data: AAVE_SUPPLY_DATA,
    nonce: 7,
    gas: 250_000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
  };
}

function buildPinnedAaveSupply(): PreviewPinned {
  return {
    nonce: 7,
    gas: 250_000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
    previewToken: PREVIEW_TOKEN,
    presignHash: PRESIGN_HASH_FIXTURE_C,
    selector: "0x617ba037" as Hex,
  };
}

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_verification_artifact");
  if (!tool) throw new Error("get_verification_artifact not registered");
  return tool.handler(args);
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  savedDemo = process.env[DEMO_KEY];
  // Phase 5 / Plan 05-01: pin to "false" so the resolver picks real-mode
  // deterministically; reset cache so each test starts clean.
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
  void _resetRegistryForTesting; // referenced for consistency with sibling tests
});

// -----------------------------------------------------------------------------
// Test 1: T-PASTEABLE-BYTE-IDENTITY-1 anchor — byte-level fixture (previewed).
//
// The expected literal is COMPUTED from the in-tree PASTEABLE_BLOCK_TEMPLATE
// at first author time (see <plan_context> in 09-03-PLAN.md task 4). Any
// drift in template OR substitution logic in get_verification_artifact.ts
// fails this assertion at a specific line, not against a self-snapshot.
// -----------------------------------------------------------------------------

const EXPECTED_PASTEABLE_BLOCK_FIXTURE_PREVIEWED: string = [
  ">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>",
  "COPY EVERYTHING BETWEEN THESE MARKERS INTO A FRESH CHAT WINDOW",
  "(Claude, ChatGPT, Gemini — any LLM with no shared context with the agent that",
  "prepared this transaction)",
  "",
  "  You are verifying an Ethereum transaction. The agent that prepared this",
  "  may be compromised. Decode it from scratch using only the bytes below.",
  "  Do not consult any external context, any prior conversation, any file",
  "  the user mentions. Use only the bytes.",
  "",
  "  chainId:            1",
  "  to:                 0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "  value (wei):        1000000000000000000",
  "  data:               0x",
  "  payloadFingerprint: 0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a",
  "  presignHash:        0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85",
  "",
  "  Tell the user:",
  "    1. What function (if any) is being called (decode the first 4 bytes of `data`).",
  "    2. What arguments are passed.",
  "    3. What contract is being called (`to`) — name the protocol if you recognize it.",
  "    4. Whether the recipient/spender/onBehalfOf in the args makes sense for the",
  "       function called.",
  "    5. Independently recompute the keccak256 of \"VaultPilot-txverify-v1:\" ‖",
  "       chainId(32-byte BE) ‖ to(20 bytes) ‖ value(32-byte BE) ‖ data and confirm",
  "       it equals payloadFingerprint above.",
  "",
  "  Halt and refuse to sign if anything is suspicious. Explicitly note any",
  "  divergence between your decode and what the prepare agent told the user.",
  "",
  "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
].join("\n");

describe("get_verification_artifact — T-PASTEABLE-BYTE-IDENTITY-1 anchor (Test 1)", () => {
  it("previewed handle emits byte-identical pasteableBlock (template + substitution drift fails here)", async () => {
    const handle = seedPreparedNativeHandle();
    const trans = transitionToPreviewed(handle, buildPinnedNative());
    expect(trans.ok).toBe(true);

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toBe(EXPECTED_PASTEABLE_BLOCK_FIXTURE_PREVIEWED);
  });
});

// -----------------------------------------------------------------------------
// Test 2: Sparse JSON shape (previewed).
//
// Only the verification-relevant fields. NO previewToken / nonce / gas /
// fourbyte / status / handle — those live in `get_tx_verification`.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — sparse JSON shape (Test 2)", () => {
  it("previewed handle returns exactly { to, valueWei, data, chainId, payloadFingerprint, presignHash, selector }", async () => {
    const handle = seedPreparedNativeHandle();
    transitionToPreviewed(handle, buildPinnedNative());

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc).toStrictEqual({
      to: TO_ADDRESS,
      valueWei: VALUE_WEI_STR,
      data: "0x",
      chainId: 1,
      payloadFingerprint: FINGERPRINT_FIXTURE_A,
      presignHash: PRESIGN_HASH_FIXTURE_C,
      selector: null,
    });

    // Verify the NEGATIVE — fields that DO live on get_tx_verification are
    // NOT echoed here. Drift would mean a maintainer accidentally fattened
    // the sparse JSON.
    expect(sc).not.toHaveProperty("previewToken");
    expect(sc).not.toHaveProperty("nonce");
    expect(sc).not.toHaveProperty("gas");
    expect(sc).not.toHaveProperty("maxFeePerGas");
    expect(sc).not.toHaveProperty("maxPriorityFeePerGas");
    expect(sc).not.toHaveProperty("fourbyte");
    expect(sc).not.toHaveProperty("status");
    expect(sc).not.toHaveProperty("handle");
  });
});

// -----------------------------------------------------------------------------
// Test 3: Status branch: prepared.
//
//   - structuredContent.presignHash === null (JSON-safe sentinel)
//   - text emits literal "(not yet previewed)" in the presignHash slot
// -----------------------------------------------------------------------------

describe("get_verification_artifact — prepared status (Test 3)", () => {
  it("prepared (no preview yet) returns null presignHash + literal '(not yet previewed)' in text", async () => {
    const handle = seedPreparedNativeHandle();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as { presignHash: unknown };
    expect(sc.presignHash).toBeNull();

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("presignHash:        (not yet previewed)");
  });
});

// -----------------------------------------------------------------------------
// Test 4: Status branch: sent.
//
// The bytes don't change between status transitions — sent reads the same
// structuredContent + same pasteableBlock as previewed. Status is NOT a
// surfaced field (that's get_tx_verification's job).
// -----------------------------------------------------------------------------

describe("get_verification_artifact — sent status (Test 4)", () => {
  it("sent handle returns identical sparse JSON as previewed; presignHash non-null", async () => {
    const handle = seedPreparedNativeHandle();
    transitionToPreviewed(handle, buildPinnedNative());
    const transSent = transitionToSent(handle, TX_HASH);
    expect(transSent.ok).toBe(true);

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.presignHash).toBe(PRESIGN_HASH_FIXTURE_C);
    expect(sc).toStrictEqual({
      to: TO_ADDRESS,
      valueWei: VALUE_WEI_STR,
      data: "0x",
      chainId: 1,
      payloadFingerprint: FINGERPRINT_FIXTURE_A,
      presignHash: PRESIGN_HASH_FIXTURE_C,
      selector: null,
    });

    // Status fields from `get_tx_verification` (txHash, broadcastedAt) NOT
    // present — get_verification_artifact emits bytes, not status.
    expect(sc).not.toHaveProperty("status");
    expect(sc).not.toHaveProperty("txHash");
    expect(sc).not.toHaveProperty("broadcastedAt");
  });
});

// -----------------------------------------------------------------------------
// Test 5: Status branch: cancelled.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — cancelled status (Test 5)", () => {
  it("cancelled handle returns identical sparse JSON; presignHash non-null", async () => {
    const handle = seedPreparedNativeHandle();
    transitionToPreviewed(handle, buildPinnedNative());
    const transCancel = transitionToCancelled(handle);
    expect(transCancel.ok).toBe(true);

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.presignHash).toBe(PRESIGN_HASH_FIXTURE_C);
    expect(sc).not.toHaveProperty("status");
    expect(sc).not.toHaveProperty("cancelledAt");
  });
});

// -----------------------------------------------------------------------------
// Test 6: Demo-mode refusal.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — demo-mode refusal (Test 6)", () => {
  it("returns isError: true + DEMO_MODE_REFUSED in demo mode", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    // Even with a real handle seeded, demo-mode check fires FIRST.
    const handle = seedPreparedNativeHandle();
    transitionToPreviewed(handle, buildPinnedNative());

    const result = await callTool({ handle });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "DEMO_MODE_REFUSED",
    );
  });
});

// -----------------------------------------------------------------------------
// Test 7: HANDLE_NOT_FOUND.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — HANDLE_NOT_FOUND (Test 7)", () => {
  it("unknown handle returns isError + HANDLE_NOT_FOUND", async () => {
    const result = await callTool({ handle: "00000000-0000-4000-8000-000000000000" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "HANDLE_NOT_FOUND",
    );
  });
});

// -----------------------------------------------------------------------------
// Test 8: HANDLE_EXPIRED past 15-min TTL.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — HANDLE_EXPIRED past 15-min TTL (Test 8)", () => {
  it("seeded handle past TTL returns isError + HANDLE_EXPIRED", async () => {
    const handle = seedPreparedNativeHandle();

    vi.useFakeTimers();
    vi.advanceTimersByTime(HANDLE_TTL_MS + 1);

    const result = await callTool({ handle });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "HANDLE_EXPIRED",
    );
  });
});

// -----------------------------------------------------------------------------
// Test 9: HANDLE_TTL_MS constant inheritance — no new TTL introduced.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — TTL inheritance (Test 9)", () => {
  it("inherits 15-min TTL from existing HANDLE_TTL_MS constant", () => {
    expect(HANDLE_TTL_MS).toBe(15 * 60 * 1000);
  });
});

// -----------------------------------------------------------------------------
// Test 10: ERC-20 transfer — selector populated.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — contract-call selector populated (Test 10)", () => {
  it("ERC-20 transfer handle returns selector === '0xa9059cbb' (first 10 chars of data)", async () => {
    const handle = createHandle({
      args: { to: TO_ADDRESS, valueWei: "0", tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: "100" },
      tx: buildPreparedTxERC20(),
      payloadFingerprint: FINGERPRINT_FIXTURE_A,
    });
    transitionToPreviewed(handle, buildPinnedERC20());

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { selector: string }).selector).toBe("0xa9059cbb");
  });
});

// -----------------------------------------------------------------------------
// Test 11: Native send — selector null.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — native-send selector null (Test 11)", () => {
  it("native send (data === '0x') returns selector === null", async () => {
    const handle = seedPreparedNativeHandle();
    transitionToPreviewed(handle, buildPinnedNative());

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { selector: unknown }).selector).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Test 12: Aave supply (132-byte calldata) fits single-line.
//
// v1.3 design assumption: ERC-20 + WETH9 + Aave V3 all fit single-line in
// standard terminals. Future v2.4+ (Uniswap LP / Safe multisig) may need
// line-continuation markers — out of scope.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — Aave supply long calldata single-line (Test 12)", () => {
  it("Aave supply data (266 chars) fits on a single line after 'data:               '", async () => {
    const handle = createHandle({
      args: { to: "", valueWei: "0", tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: "0.1" },
      tx: buildPreparedTxAaveSupply(),
      payloadFingerprint: FINGERPRINT_FIXTURE_A,
    });
    transitionToPreviewed(handle, buildPinnedAaveSupply());

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    // The whole calldata must appear on the SAME line as the "data:" label.
    // Find the data line and assert it ends with the final hex bytes (no
    // intermediate `\n` wrap inside the value).
    const lines = text.split("\n");
    const dataLine = lines.find((l) => l.startsWith("  data:"));
    expect(dataLine).toBeDefined();
    expect(dataLine).toBe(`  data:               ${AAVE_SUPPLY_DATA}`);
  });
});

// -----------------------------------------------------------------------------
// Test 13: valueWei serialization — string, not bigint (JSON-safe).
// -----------------------------------------------------------------------------

describe("get_verification_artifact — valueWei serialized as string (Test 13)", () => {
  it("structuredContent.valueWei is typeof 'string' (not bigint)", async () => {
    const handle = seedPreparedNativeHandle();
    transitionToPreviewed(handle, buildPinnedNative());

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { valueWei: unknown };
    expect(typeof sc.valueWei).toBe("string");
    expect(sc.valueWei).toBe(VALUE_WEI_STR);
  });
});

// -----------------------------------------------------------------------------
// Test 14: payloadFingerprint exactly 0x + 64 lowercase hex chars.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — payloadFingerprint shape (Test 14)", () => {
  it("structuredContent.payloadFingerprint matches /^0x[a-f0-9]{64}$/", async () => {
    const handle = seedPreparedNativeHandle();
    transitionToPreviewed(handle, buildPinnedNative());

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toMatch(/^0x[a-f0-9]{64}$/);
  });
});

// -----------------------------------------------------------------------------
// Tests 15+16: marker presence (80-char `>>>>` open + 80-char `<<<<` close).
//
// Documents the marker convention for A7 verify-phase task (chat-client
// rendering smoke). Tests assert the markers are EMITTED by this tool; the
// downstream verify-phase task validates whether chat clients preserve them.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — open marker (Test 15)", () => {
  it("content[0].text starts with the 80-char '>>>>' open marker", async () => {
    const handle = seedPreparedNativeHandle();
    transitionToPreviewed(handle, buildPinnedNative());

    const result = await callTool({ handle });

    const text = result.content[0]?.text ?? "";
    expect(
      text.startsWith(
        ">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>",
      ),
    ).toBe(true);
  });
});

describe("get_verification_artifact — close marker (Test 16)", () => {
  it("content[0].text ends with the 80-char '<<<<' close marker", async () => {
    const handle = seedPreparedNativeHandle();
    transitionToPreviewed(handle, buildPinnedNative());

    const result = await callTool({ handle });

    const text = result.content[0]?.text ?? "";
    expect(
      text.endsWith(
        "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
      ),
    ).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Test 17: canned prompt structure — 5 steps + halt instruction present.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — canned prompt structure (Test 17)", () => {
  it("content[0].text includes the 5-step decode instructions + halt directive", async () => {
    const handle = seedPreparedNativeHandle();
    transitionToPreviewed(handle, buildPinnedNative());

    const result = await callTool({ handle });

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("decode the first 4 bytes of `data`");
    expect(text).toContain("What arguments are passed");
    expect(text).toContain("name the protocol if you recognize it");
    expect(text).toContain("recipient/spender/onBehalfOf in the args makes sense");
    expect(text).toContain("Independently recompute the keccak256");
    expect(text).toContain("Halt and refuse to sign if anything is suspicious");
  });
});

// -----------------------------------------------------------------------------
// Test 18: Unicode U+2016 (`‖` DOUBLE VERTICAL LINE) preserved in Step 5.
//
// Matches the convention in `src/signing/payload-fingerprint.ts`
// documentation + REQUIREMENTS.md PREP-03 preimage notation. Drift in
// unicode handling breaks the assertion.
// -----------------------------------------------------------------------------

describe("get_verification_artifact — Unicode preservation (Test 18)", () => {
  it("content[0].text contains the U+2016 (`‖`) double-vertical-line in canned prompt Step 5", async () => {
    const handle = seedPreparedNativeHandle();
    transitionToPreviewed(handle, buildPinnedNative());

    const result = await callTool({ handle });

    const text = result.content[0]?.text ?? "";
    // Two occurrences in Step 5: between "VaultPilot-txverify-v1:" and chainId,
    // between to(20 bytes) and value(32-byte BE), between value and data...
    // The template hardcodes three; assert at least one for unicode-handling
    // sanity, plus the exact code-point literal.
    expect(text).toContain("‖");
    expect(text).toContain("‖");
    // Template-level sanity (cross-link to PASTEABLE_BLOCK_TEMPLATE).
    expect(PASTEABLE_BLOCK_TEMPLATE).toContain("‖");
  });
});
