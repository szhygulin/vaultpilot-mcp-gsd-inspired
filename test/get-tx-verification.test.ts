// Plan 04-05 Task 2 — get_tx_verification tool tests (PREP-10).
//
// Covers per-status re-emit (prepared / previewed / sent / cancelled),
// the 15-min TTL → HANDLE_EXPIRED branch, the HANDLE_NOT_FOUND branch,
// the demo-mode short-circuit, and the format-fanout-sentinel re-emit
// equality assertion (T-REEMIT-1) — test imports the same templates
// the production handler substitutes and asserts byte-identical
// inclusion in the response.

import type { Address, Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_TASK_TEMPLATE,
  LEDGER_BLIND_SIGN_HASH_TEMPLATE,
  PREPARE_RECEIPT_TEMPLATE,
  build4byteBlock,
  chunkHex,
} from "../src/signing/blocks.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  transitionToCancelled,
  transitionToPreviewed,
  transitionToSent,
} from "../src/signing/handle-store.js";
import type { PreparedTx, PreviewPinned } from "../src/signing/handle-store.js";
import { _resetFourbyteCacheForTesting, type FourbyteResult } from "../src/clients/fourbyte.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

// Mock the 4byte client. We never want a real network call from a unit test —
// `lookupSelector` is replaced with a controllable spy. Default return:
// `{ kind: "not-applicable" }` (native sends).
const lookupSelectorSpy = vi.fn<[Hex | null], Promise<FourbyteResult>>();
vi.mock("../src/clients/fourbyte.js", async () => {
  const actual = await vi.importActual<typeof import("../src/clients/fourbyte.js")>(
    "../src/clients/fourbyte.js",
  );
  return {
    ...actual,
    lookupSelector: (selector: Hex | null) => lookupSelectorSpy(selector),
  };
});

// Register the tool. The side-effect import fires once for the suite.
await import("../src/tools/get_tx_verification.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const TO_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const VALUE_WEI = "1000000000000000000";
const FINGERPRINT = "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;
const PRESIGN_HASH = "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85" as Hex;
const PREVIEW_TOKEN = "11111111-1111-4111-8111-111111111111";
const TX_HASH = "0xdeadbeef00000000000000000000000000000000000000000000000000000000" as Hex;

function buildPreparedTx(): PreparedTx {
  return {
    chainId: 1,
    to: TO_ADDRESS,
    valueWei: 1_000_000_000_000_000_000n,
    data: "0x" as Hex,
    nonce: 7,
    gas: 21000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
  };
}

function buildPinned(): PreviewPinned {
  return {
    nonce: 7,
    gas: 21000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
    previewToken: PREVIEW_TOKEN,
    presignHash: PRESIGN_HASH,
    selector: null,
  };
}

function seedPreparedHandle(): string {
  return createHandle({
    args: { to: TO_ADDRESS, valueWei: VALUE_WEI },
    tx: buildPreparedTx(),
    payloadFingerprint: FINGERPRINT,
  });
}

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_tx_verification");
  if (!tool) throw new Error("get_tx_verification not registered");
  return tool.handler(args);
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  _resetFourbyteCacheForTesting();
  lookupSelectorSpy.mockReset();
  lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });
  savedDemo = process.env[DEMO_KEY];
  // Phase 5 / Plan 05-01: pin to "false" so the resolver picks
  // real-mode deterministically; reset cache so each test starts clean.
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
  void _resetRegistryForTesting; // referenced for consistency
});

describe("get_tx_verification — HANDLE_NOT_FOUND (unknown handle)", () => {
  it("returns errorCode: 'HANDLE_NOT_FOUND'; does NOT call lookupSelector", async () => {
    const result = await callTool({ handle: "00000000-0000-4000-8000-000000000000" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "HANDLE_NOT_FOUND",
    );
    expect(lookupSelectorSpy).not.toHaveBeenCalled();
  });
});

describe("get_tx_verification — HANDLE_EXPIRED past 15-min TTL (PREP-10)", () => {
  it("seeded handle past TTL returns errorCode: 'HANDLE_EXPIRED'", async () => {
    const handle = seedPreparedHandle();

    vi.useFakeTimers();
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    const result = await callTool({ handle });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "HANDLE_EXPIRED",
    );
  });
});

describe("get_tx_verification — 'prepared' status re-emits PREPARE RECEIPT only", () => {
  it("response contains PREPARE RECEIPT verbatim + preview-not-run note; NO ledger / agent / 4byte blocks", async () => {
    const handle = seedPreparedHandle();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { status: string }).status).toBe("prepared");

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT");
    // No block emission — the preview-not-run note literally mentions the
    // string "LEDGER BLIND-SIGN HASH" as a routing hint, so we assert the
    // full BLOCK isn't emitted (header on its own line + the placeholder
    // labels). The actual ledger block contains "Expected on-device hash";
    // its absence proves the block didn't render.
    expect(text).not.toContain("Expected on-device hash");
    expect(text).not.toContain("[AGENT TASK");
    expect(text).not.toContain("4BYTE CROSS-CHECK");
    expect(text).toContain("preview has not run yet");

    // Verbatim PREPARE_RECEIPT equality (format-fanout-sentinel).
    const expected = PREPARE_RECEIPT_TEMPLATE
      .replace("{TO}", TO_ADDRESS)
      .replace("{VALUE_WEI}", VALUE_WEI);
    expect(text).toContain(expected);
  });
});

describe("get_tx_verification — 'previewed' re-emit equality (PREP-10, T-REEMIT-1)", () => {
  it("response contains all five blocks; LEDGER + AGENT_TASK byte-identical to template substitution", async () => {
    const handle = seedPreparedHandle();
    const trans = transitionToPreviewed(handle, buildPinned());
    expect(trans.ok).toBe(true);

    lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { status: string }).status).toBe("previewed");
    expect((result.structuredContent as { presignHash: string }).presignHash).toBe(
      PRESIGN_HASH,
    );

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT");
    expect(text).toContain("LEDGER BLIND-SIGN HASH");
    expect(text).toContain("[AGENT TASK");
    expect(text).toContain("4BYTE CROSS-CHECK");
    expect(text).toContain("VERIFY BEFORE SIGNING");

    // KEY assertion: re-emit equality. Build the expected blocks via the
    // SAME templates the prod handler substitutes from.
    const expectedLedger = LEDGER_BLIND_SIGN_HASH_TEMPLATE
      .replace("{HASH_FULL}", PRESIGN_HASH)
      .replace("{HASH_CHUNKED}", chunkHex(PRESIGN_HASH));
    expect(text).toContain(expectedLedger);

    const expectedAgent = AGENT_TASK_TEMPLATE
      .replace("{TO}", TO_ADDRESS)
      .replace("{VALUE_WEI}", VALUE_WEI)
      .replace("{PRESIGN_HASH}", PRESIGN_HASH);
    expect(text).toContain(expectedAgent);

    // 4byte block: build via the same helper the handler uses.
    const expected4byte = build4byteBlock(null, { kind: "not-applicable" });
    expect(text).toContain(expected4byte);
  });

  it("calls lookupSelector with the handle's pinned selector", async () => {
    const handle = seedPreparedHandle();
    transitionToPreviewed(handle, buildPinned());
    lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });

    await callTool({ handle });

    expect(lookupSelectorSpy).toHaveBeenCalledTimes(1);
    expect(lookupSelectorSpy).toHaveBeenCalledWith(null);
  });
});

describe("get_tx_verification — 'sent' status re-emits previewed blocks + BROADCAST CONFIRMATION", () => {
  it("structuredContent has status: 'sent' + txHash + broadcastedAt; text has BROADCAST CONFIRMATION block", async () => {
    const handle = seedPreparedHandle();
    transitionToPreviewed(handle, buildPinned());
    const trans = transitionToSent(handle, TX_HASH);
    expect(trans.ok).toBe(true);

    lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      status: string;
      txHash: string;
      broadcastedAt: string;
    };
    expect(sc.status).toBe("sent");
    expect(sc.txHash).toBe(TX_HASH);
    expect(sc.broadcastedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT");
    expect(text).toContain("LEDGER BLIND-SIGN HASH");
    expect(text).toContain("[AGENT TASK");
    expect(text).toContain("BROADCAST CONFIRMATION");
    expect(text).toContain(TX_HASH);
    expect(text.toLowerCase()).toContain("broadcastedat");
  });
});

describe("get_tx_verification — 'cancelled' status re-emits the reached blocks + CANCELLED epilogue", () => {
  it("cancelled-after-preview returns previewed blocks + CANCELLED block + cancelledAt ISO timestamp", async () => {
    const handle = seedPreparedHandle();
    transitionToPreviewed(handle, buildPinned());
    transitionToCancelled(handle);

    lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { status: string; cancelledAt: string };
    expect(sc.status).toBe("cancelled");
    expect(sc.cancelledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT");
    expect(text).toContain("LEDGER BLIND-SIGN HASH");
    expect(text).toContain("CANCELLED");
    expect(text.toLowerCase()).toContain("cancelledat");
  });
});

describe("get_tx_verification — demo-mode refusal fires FIRST (T-DEMO-1)", () => {
  it("VAULTPILOT_DEMO=true → DEMO_MODE_REFUSED; lookupSelector NOT called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    const handle = seedPreparedHandle();
    transitionToPreviewed(handle, buildPinned());

    const result = await callTool({ handle });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "DEMO_MODE_REFUSED",
    );
    expect(lookupSelectorSpy).not.toHaveBeenCalled();
  });
});

describe("get_tx_verification — register-all wiring", () => {
  it("getRegisteredTool('get_tx_verification') is non-null; inputSchema requires 'handle'", async () => {
    // Import register-all (registers all tool side-effects).
    await import("../src/tools/register-all.js");

    const tool = getRegisteredTool("get_tx_verification");
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(["handle"]);
  });

  it("register-all.ts contains the side-effect import line for ./get_tx_verification.js", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = url.fileURLToPath(new URL(".", import.meta.url));
    const target = path.resolve(here, "..", "src", "tools", "register-all.ts");
    const source = await fs.readFile(target, "utf8");
    expect(source).toContain('import "./get_tx_verification.js";');
  });
});
