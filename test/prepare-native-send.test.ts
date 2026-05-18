import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` factories are hoisted ABOVE every `const`/`let` in the module,
// so the spies the factories close over must themselves be declared inside
// a `vi.hoisted()` block (which is hoisted to the SAME level). See
// https://vitest.dev/api/vi.html#vi-hoisted — this is the canonical
// "shared spy across two vi.mock factories" pattern.
const { getStatusSpy, createHandleSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  createHandleSpy: vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

// Mock the session-manager's `getStatus`. Other exports stay real
// (transitively imported by `register-all.js` via `pair_ledger_live.js` +
// `get_ledger_status.js` — touching them would crash test setup).
vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from prepare_native_send tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

// Mock the handle-store with `createHandle` as a spy that delegates to the
// real implementation. `lookup`, `_resetHandleStoreForTesting`,
// `_peekHandleForTesting`, and `HANDLE_TTL_MS` stay real so tests can both
// (a) assert `createHandle.mock.calls` AND (b) read the stored record back.
vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<typeof import("../src/signing/handle-store.js")>(
    "../src/signing/handle-store.js",
  );
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (...args: Parameters<typeof actual.createHandle>) => createHandleSpy(...args),
  };
});

import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  lookup,
} from "../src/signing/handle-store.js";
import { PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
} from "../src/demo/state.js";

// Triggers side-effect registration for ALL Phase 1/2/3/04-02 tools, so
// test #10 below can smoke-check `prepare_native_send` is in the registry.
await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_native_send");
  if (!tool) throw new Error("prepare_native_send not registered");
  // Phase 8 — Plan 08-02: chain arg is REQUIRED on every prepare_*. Default
  // to "ethereum" here so the pre-Plan-08-02 Fixture A regressions (which
  // pin chainId=1) continue to anchor under the new schema; per-chain
  // assertion is covered in the "chain arg gate" describe block at the
  // bottom of this file.
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const PRIMARY_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as `0x${string}`;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [PRIMARY_ADDRESS],
  activeAccount: PRIMARY_ADDRESS,
  address: PRIMARY_ADDRESS,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

// Fixture A inputs — research § Code Example 1, asserted by Plan 04-01's
// `test/signing-fingerprint.test.ts` Test 1 as `0x7e1867b2...`. This test
// suite asserts the same fingerprint flows through `prepare_native_send`
// end-to-end (handler → handle record → response field).
const FIXTURE_A = {
  to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  valueWei: "1000000000000000000",
  payloadFingerprint:
    "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a",
};

// Test-4 inputs use a LOWERCASE address to assert the verbatim-receipt
// invariant — if a contributor accidentally substitutes `getAddress(to)`
// into the receipt block, the lowercase characters would be checksummed
// away and the byte-identity check below would fail.
const LOWERCASE_TO = "0xabcdef0123456789abcdef0123456789abcdef01";

beforeEach(() => {
  getStatusSpy.mockReset();
  createHandleSpy.mockClear();
  _resetHandleStoreForTesting();
  savedDemo = process.env[DEMO_KEY];
  // Phase 5 / Plan 05-01: pin env to "false" so the resolver
  // deterministically picks real-mode regardless of host filesystem
  // (auto-demo would otherwise fire when ~/.vaultpilot-mcp/config.json
  // is absent). Tests that need demo mode override + reset.
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

// ---------------------------------------------------------------------------
// Plan 05-02 / Q-CONTRADICTION-PREP Option B — demo mode SUCCEEDS using the
// active persona's address as `from`. The Phase 4 DEMO_MODE_REFUSED test is
// REPLACED here with three cases:
//   1a: demo + whale active → success; from === whale address; payloadFingerprint
//       === Fixture A (from-independence proof — PREP-03 preimage doesn't
//       include `from`).
//   1b: persona switch (stable-saver) → from === stable-saver address.
//   1c: T-NULL-PERSONA-1 — demo on, no persona active → WRONG_MODE; getStatus
//       + createHandle NEVER called.
// ---------------------------------------------------------------------------
describe("prepare_native_send — demo mode succeeds with active persona (Plan 05-02 / Q-CONTRADICTION-PREP Option B)", () => {
  const WHALE_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const STABLE_SAVER_ADDRESS = "0x55FE002aefF02F77364de339a1292923A15844B8";

  it("(1a) demo + whale active → success; from === whale address; payloadFingerprint === Fixture A (from-independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");

    const result = await callTool({ to: FIXTURE_A.to, valueWei: FIXTURE_A.valueWei });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chainId: number;
      from: string;
      to: string;
      valueWei: string;
      payloadFingerprint: string;
    };
    expect(sc.from).toBe(WHALE_ADDRESS);
    // T-PERSONA-FINGERPRINT-DRIFT-1 / PREP-03 from-independence: Fixture A
    // anchor holds under demo `from` because the preimage is
    // `chainId || to || valueWei || data` — `from` is NOT in it.
    expect(sc.payloadFingerprint).toBe(FIXTURE_A.payloadFingerprint);
    expect(sc.chainId).toBe(1);
    expect(sc.to).toBe(FIXTURE_A.to);
    expect(sc.valueWei).toBe(FIXTURE_A.valueWei);
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // Receipt block surfaces verbatim args (PREP-02 invariant) — `from`
    // is NOT in the receipt text, only in `structuredContent`.
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT");

    // T-DEMO-1: getStatus is NEVER called in demo mode (no WC pairing
    // to consult). Plan 05-02 contract: createHandle IS called (the
    // demo flow creates a real handle that flows through preview + send
    // simulation); count is 1, NOT 0 (the Phase 4 assertion's inverse).
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(1);
  });

  it("(1b) persona switch — setActivePersona(\"stable-saver\") → from === stable-saver address", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("stable-saver");

    const result = await callTool({ to: FIXTURE_A.to, valueWei: FIXTURE_A.valueWei });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { from: string; payloadFingerprint: string };
    expect(sc.from).toBe(STABLE_SAVER_ADDRESS);
    // Fingerprint still anchors to Fixture A — from-independence again.
    expect(sc.payloadFingerprint).toBe(FIXTURE_A.payloadFingerprint);
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(1);
  });

  it("(1c) T-NULL-PERSONA-1 — explicit demo + no persona → WRONG_MODE; getStatus + createHandle NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting(); // ensure no persona active

    const result = await callTool({ to: FIXTURE_A.to, valueWei: FIXTURE_A.valueWei });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WRONG_MODE",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);
    expect(text).toMatch(/set_demo_wallet/);

    // Defense-in-depth: NEITHER downstream is touched in the WRONG_MODE
    // branch. A reorder that lets either fire would defeat the gate.
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_native_send — unpaired wallet (T-PAIR-1)", () => {
  it("refuses with WALLET_NOT_PAIRED when getStatus resolves to null; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(null);

    const result = await callTool({ to: FIXTURE_A.to, valueWei: FIXTURE_A.valueWei });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(result.content[0]?.text ?? "").toMatch(/pair_ledger_live/);

    // T-PAIR-1: no state pollution — the handle store stays empty.
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_native_send — invalid `to` (T-ADDR-1)", () => {
  it("refuses with INVALID_INPUT for `0xnotahex`; names the offending value in text; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ to: "0xnotahex", valueWei: FIXTURE_A.valueWei });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/to|address/i);
    expect(text).toContain("0xnotahex");

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_native_send — verbatim PREPARE RECEIPT (PREP-02 + T-PREP-RCPT-1)", () => {
  it("substitutes PREPARE_RECEIPT_TEMPLATE byte-for-byte; lowercase address stays lowercase (no checksum normalization)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ to: LOWERCASE_TO, valueWei: FIXTURE_A.valueWei });

    // Happy-path envelope shape.
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      chainId: number;
      to: string;
      valueWei: string;
      payloadFingerprint: string;
    };
    // UUID v4 handle shape — same regex as crypto.randomUUID() output.
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sc.chainId).toBe(1);
    expect(sc.to).toBe(LOWERCASE_TO); // VERBATIM — lowercase preserved
    expect(sc.valueWei).toBe(FIXTURE_A.valueWei);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("PREPARE RECEIPT");

    // Format-fanout sentinel: prod + test reference the SAME const + the
    // SAME substitution shape. A future edit to the template that didn't
    // update both sides would fail this byte-identity check.
    //
    // Phase 8 — Plan 08-02: `{CHAIN}` slot added; substituted with
    // `${chain} (chainId ${chainId})`. callTool's default chain is
    // "ethereum" → chainId 1.
    const expected = PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{TO}", LOWERCASE_TO)
      .replace("{VALUE_WEI}", FIXTURE_A.valueWei);
    expect(text).toBe(expected);

    // Verbatim invariant: lowercase in → lowercase out. If `getAddress(to)`
    // ever slips into the receipt substitution, this assertion catches it
    // (the checksummed form contains uppercase chars at known positions).
    expect(text).toContain(LOWERCASE_TO);
    expect(text).not.toMatch(/0xAbCdEf0123456789AbCdEf0123456789AbCdEf01/);
  });
});

describe("prepare_native_send — invalid `valueWei` (T-VALUE-1)", () => {
  it("refuses with INVALID_INPUT for decimal value `\"1.5\"`; text names wei; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ to: FIXTURE_A.to, valueWei: "1.5" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/valueWei|wei/i);

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("refuses with INVALID_INPUT for negative value `\"-1\"`; createHandle NEVER called (BigInt accepts the parse, the sign-check rejects)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ to: FIXTURE_A.to, valueWei: "-1" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(result.content[0]?.text ?? "").toMatch(/negative/i);

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_native_send — payloadFingerprint matches Fixture A (PREP-03 + T-BIND-1)", () => {
  it("end-to-end fingerprint binding: response.payloadFingerprint === 0x7e1867b2... === stored record fingerprint", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ to: FIXTURE_A.to, valueWei: FIXTURE_A.valueWei });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };

    // Fixture A literal — research § Code Example 1, also asserted in
    // Plan 04-01's `test/signing-fingerprint.test.ts` Test 1. The same
    // bytes must flow through the handler.
    expect(sc.payloadFingerprint).toBe(FIXTURE_A.payloadFingerprint);

    // T-BIND-1: the value stored on the handle record matches the value
    // returned to the agent. Plan 04-04's send-time drift gate
    // (PREP-08) re-runs `computePayloadFingerprint` on `record.tx` and
    // asserts equality with the STORED `record.payloadFingerprint`.
    const lookupResult = lookup(sc.handle);
    expect(lookupResult.ok).toBe(true);
    if (!lookupResult.ok) return;
    expect(lookupResult.record.payloadFingerprint).toBe(FIXTURE_A.payloadFingerprint);
  });
});

describe("prepare_native_send — handle stored in `prepared` state with correct args + tx split", () => {
  it("record.args carries raw agent strings; record.tx carries viem-typed values; status === 'prepared'", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({ to: LOWERCASE_TO, valueWei: FIXTURE_A.valueWei });
    const sc = result.structuredContent as { handle: string };

    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.status).toBe("prepared");
    expect(record.pinned).toBeUndefined();

    // tx fields — viem-typed (checksummed address, bigint value, hex data).
    expect(record.tx.chainId).toBe(1);
    // viem.getAddress checksums lowercase input; record.tx.to should be
    // the CHECKSUMMED form (the prod handler casts via getAddress).
    // Computed once via viem and pinned here as a regression anchor.
    expect(record.tx.to).toBe("0xabCDeF0123456789AbcdEf0123456789aBCDEF01");
    expect(record.tx.valueWei).toBe(1000000000000000000n);
    expect(record.tx.data).toBe("0x");

    // args fields — RAW agent strings (NO normalization). The
    // `PrepareArgs` field types (string, not Address / bigint) are the
    // structural guard against future normalization at the storage
    // boundary.
    expect(record.args.to).toBe(LOWERCASE_TO);
    expect(record.args.valueWei).toBe(FIXTURE_A.valueWei);
  });
});

describe("prepare_native_send — `chainId` not exposed in inputSchema (Q3 regression anchor)", () => {
  it("inputSchema does NOT advertise chainId — Phase 8 Plan 08-02 adds `chain` enum (NOT the literal chainId field)", () => {
    const tool = getRegisteredTool("prepare_native_send");
    expect(tool).toBeDefined();
    if (!tool) return;

    const props = tool.inputSchema.properties ?? {};
    // Phase 8 — Plan 08-02 ship state: the schema exposes `chain` (enum
    // of 5 ChainNames), NOT `chainId` (numeric). The literal-chainId surface
    // would force agents to memorize EIP-155 ints; the named enum is the
    // agent-facing canon. The Q3 invariant ("no literal `chainId` field")
    // holds — `chainId` is computed server-side via `chainIdFromName(chain)`.
    expect(props.chainId).toBeUndefined();
    // `required` lists `chain` + `to` + `valueWei` post-Plan-08-02.
    const required = tool.inputSchema.required ?? [];
    expect(required).toEqual(["chain", "to", "valueWei"]);
    expect(required).not.toContain("chainId");
    // `chain` enum surface (PREP-41 — DF-1 Option A — REQUIRED on every prepare).
    expect(props.chain).toMatchObject({
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
    });
  });
});

describe("prepare_native_send — multi-account session uses activeAccount as `from`", () => {
  it("returns the non-default active account as `from` after setActiveAccount switched it", async () => {
    const ACCOUNTS = [
      "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as `0x${string}`,
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`,
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as `0x${string}`,
    ];
    // Mock the session-manager state AFTER set_active_account switched
    // to ACCOUNTS[2]. `activeAccount` is the non-default member; `address`
    // mirrors it (back-compat alias). `prepare_native_send` must read
    // `status.activeAccount` (NOT `status.accounts[0]`) — if a future
    // edit silently falls back to `accounts[0]`, this assertion fires.
    getStatusSpy.mockResolvedValueOnce({
      paired: true,
      accounts: ACCOUNTS,
      activeAccount: ACCOUNTS[2],
      address: ACCOUNTS[2],
      chainId: 1,
      sessionTopicLast8: "deadbeef",
    });

    const result = await callTool({ to: FIXTURE_A.to, valueWei: FIXTURE_A.valueWei });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      from: string;
      payloadFingerprint: string;
    };
    expect(sc.from).toBe(ACCOUNTS[2]);
    // PREP-03 from-independence: Fixture A anchor still holds because
    // `from` is NOT in the fingerprint preimage.
    expect(sc.payloadFingerprint).toBe(FIXTURE_A.payloadFingerprint);
  });
});

describe("prepare_native_send — register-all.ts wiring (smoke)", () => {
  it("prepare_native_send is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_native_send");
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — Plan 08-02 (PREP-40 + PREP-41) chain arg gate. The 5-chain
// enum is the dispatch-boundary gate; per-handler re-validation is unreachable
// on a clean MCP path. These cases exercise the in-handler chain threading
// after the dispatcher has accepted the enum.
// ---------------------------------------------------------------------------
describe("prepare_native_send — chain arg gate (Plan 08-02 / PREP-40 + PREP-41)", () => {
  it("happy path on a non-Ethereum chain (polygon): structuredContent.chainId === 137; PREPARE RECEIPT carries `chain: polygon (chainId 137)`", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const tool = getRegisteredTool("prepare_native_send");
    if (!tool) throw new Error("prepare_native_send not registered");
    const result = await tool.handler({
      chain: "polygon",
      to: FIXTURE_A.to,
      valueWei: FIXTURE_A.valueWei,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      chain: string;
      chainId: number;
      payloadFingerprint: string;
    };
    expect(sc.chain).toBe("polygon");
    expect(sc.chainId).toBe(137);
    // The PREPARE RECEIPT carries the chain-name verbatim so the user can
    // cross-check on the device's `Network:` display.
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("chain:    polygon (chainId 137)");
  });

  it("chain-id-distinctness: same (to, valueWei), different chain → different payloadFingerprint", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const tool = getRegisteredTool("prepare_native_send");
    if (!tool) throw new Error("prepare_native_send not registered");
    const ethResult = await tool.handler({
      chain: "ethereum",
      to: FIXTURE_A.to,
      valueWei: FIXTURE_A.valueWei,
    });
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const arbResult = await tool.handler({
      chain: "arbitrum",
      to: FIXTURE_A.to,
      valueWei: FIXTURE_A.valueWei,
    });
    const ethFp = (ethResult.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;
    const arbFp = (arbResult.structuredContent as { payloadFingerprint: string })
      .payloadFingerprint;
    expect(ethFp).not.toBe(arbFp);
  });
});
