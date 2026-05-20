// Phase 17 Plan 17-03 — pair_tron_ledger tool tests (TRON-PAIR-01 + T-DEMO-1
// + the 5 locked errorCodes + INTERNAL_ERROR fallback + grep gate for
// `lastHardenedIndex` regression per research § Pitfall 6).
//
// Mirrors `test/pair-solana-ledger.test.ts` shape: mock the underlying
// `fetchTronAddress` import (Plan 17-02), preserve the typed error
// classes (production code uses `instanceof`), drive scenarios via
// `mockResolvedValueOnce` / `mockRejectedValueOnce` per test.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fetchTronAddress; keep the typed error classes real so
// `err instanceof LedgerDeviceNotConnectedError` etc. still works.
const fetchSpy = vi.fn();

vi.mock("../src/wallet/ledger-tron-transport.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/ledger-tron-transport.js")
  >("../src/wallet/ledger-tron-transport.js");
  return {
    ...actual,
    fetchTronAddress: (
      ...args: Parameters<typeof actual.fetchTronAddress>
    ) => fetchSpy(...args),
  };
});

// Spy on saveAccount on the non-evm-account-store so we can assert the
// pairing was persisted with the expected payload — without exercising
// the real fs writer.
const saveSpy = vi.fn();
vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    saveAccount: (
      ...args: Parameters<typeof actual.saveAccount>
    ) => saveSpy(...args),
  };
});

import {
  LedgerDeviceNotConnectedError,
  LedgerTronAppNotOpenError,
} from "../src/wallet/ledger-tron-transport.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import {
  VERIFY_ON_DEVICE_TRON_TEMPLATE,
} from "../src/tools/pair_tron_ledger.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Side-effect-register the tool once. Subsequent tests reuse the closure;
// per-test scenario is driven by the mocked `fetchSpy`.
await import("../src/tools/pair_tron_ledger.js");

async function callTool(
  args: Record<string, unknown> = {},
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("pair_tron_ledger");
  if (!tool) throw new Error("pair_tron_ledger not registered");
  return tool.handler(args);
}

// Fixture base58check — recognizable T-prefixed address. NOT a real
// on-chain key.
const FIXTURE_BASE58 = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";

beforeEach(() => {
  fetchSpy.mockReset();
  saveSpy.mockReset();
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
  void _resetRegistryForTesting;
  vi.useRealTimers();
});

describe("pair_tron_ledger — demo-mode FIRST refusal (T-DEMO-1)", () => {
  it("refuses with errorCode: DEMO_MODE_REFUSED when VAULTPILOT_DEMO=true; fetchTronAddress NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "DEMO_MODE_REFUSED",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);
    expect(text).toMatch(/set_demo_wallet/);

    // Load-bearing T-DEMO-1 assertion: NO USB-HID transport open in demo
    // mode. A future bug reordering the demo check below fetchTronAddress
    // would silently leak transport state.
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });
});

describe("pair_tron_ledger — happy path + VERIFY-ON-DEVICE block (TRON-PAIR-01)", () => {
  it("returns the substituted VERIFY-ON-DEVICE block + persists via saveAccount + surfaces address/derivationPath/pairedAt/appVersion", async () => {
    const beforeIso = new Date().toISOString();
    fetchSpy.mockResolvedValueOnce({
      address: FIXTURE_BASE58,
      publicKey:
        "04" + "aa".repeat(64),
      appVersion: "0.5.0",
    });

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      address: string;
      derivationPath: string;
      pairedAt: string;
      appVersion: string;
    };
    expect(sc.address).toBe(FIXTURE_BASE58);
    expect(sc.derivationPath).toBe("44'/195'/0'/0/0");
    expect(sc.appVersion).toBe("0.5.0");
    // pairedAt must be a parseable ISO-8601 timestamp >= test-entry.
    expect(Number.isNaN(Date.parse(sc.pairedAt))).toBe(false);
    expect(Date.parse(sc.pairedAt)).toBeGreaterThanOrEqual(Date.parse(beforeIso));

    // VERIFY-ON-DEVICE block — substituted with FIXTURE_BASE58 + slot 0.
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("VERIFY ON DEVICE");
    expect(text).toContain(`Address: ${FIXTURE_BASE58}`);
    expect(text).toMatch(/Slot:\s+#0/);
    expect(text).toMatch(/derivation path:\s+44'\/195'\/0'\/0\/0/);

    // Format-fanout sentinel: prod + test reference the SAME const. Build
    // the expected block here with the same replace calls as the handler.
    const expectedSubstituted = VERIFY_ON_DEVICE_TRON_TEMPLATE
      .replace("{ADDRESS}", FIXTURE_BASE58)
      .replace(/\{ACCOUNT_INDEX\}/g, "0");
    expect(text.includes(expectedSubstituted)).toBe(true);

    // saveAccount called with the expected payload.
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saved = saveSpy.mock.calls[0]![0] as {
      chain: string;
      address: string;
      derivationPath: string;
      pairedAt: string;
    };
    expect(saved.chain).toBe("tron");
    expect(saved.address).toBe(FIXTURE_BASE58);
    expect(saved.derivationPath).toBe("44'/195'/0'/0/0");
    expect(Number.isNaN(Date.parse(saved.pairedAt))).toBe(false);
  });

  it("slot-3 pair renders Slot: #3 AND derivation path: 44'/195'/3'/0/0 — REGRESSION ANCHOR per research § Pitfall 6", async () => {
    // The regression: using `lastHardenedIndex` (Solana 3-level helper)
    // here extracts segments[-1] = "0" for ANY slot (the trailing `/0/0`
    // address-index). The TRON-correct `accountIndex` helper extracts
    // segments[2] = "3" for `44'/195'/3'/0/0`. This test fails-loud if
    // anyone copy-pastes the Solana helper into the TRON handler.
    fetchSpy.mockResolvedValueOnce({
      address: FIXTURE_BASE58,
      publicKey: "04" + "bb".repeat(64),
      appVersion: "0.5.0",
    });

    const result = await callTool({ derivationSlot: 3 });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { derivationPath: string };
    expect(sc.derivationPath).toBe("44'/195'/3'/0/0");

    const text = result.content[0]?.text ?? "";
    // BOTH twin substitutions must reflect slot 3.
    expect(text).toMatch(/Slot:\s+#3/);
    expect(text).toMatch(/derivation path:\s+44'\/195'\/3'\/0\/0/);
    // Specifically NOT slot 0 — the regressed helper would render #0 here.
    expect(text).not.toMatch(/Slot:\s+#0\b/);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saved = saveSpy.mock.calls[0]![0] as { derivationPath: string };
    expect(saved.derivationPath).toBe("44'/195'/3'/0/0");
  });
});

describe("pair_tron_ledger — error envelopes (locked-5 errorCodes + INTERNAL_ERROR)", () => {
  it("maps LedgerDeviceNotConnectedError → errorCode: LEDGER_NOT_CONNECTED + recovery hint", async () => {
    fetchSpy.mockRejectedValueOnce(new LedgerDeviceNotConnectedError());

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "LEDGER_NOT_CONNECTED",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/No Ledger/i);
    expect(text).toMatch(/USB/);
    expect(text).toMatch(/TRON app/);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });

  it("maps LedgerTronAppNotOpenError → errorCode: TRON_APP_NOT_OPEN + recovery hint", async () => {
    fetchSpy.mockRejectedValueOnce(new LedgerTronAppNotOpenError());

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "TRON_APP_NOT_OPEN",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/TRON app/);
    expect(text).toMatch(/Open the TRON app/);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });

  it("maps APDU 0x6985 substring → errorCode: USER_REJECTED + re-call hint", async () => {
    fetchSpy.mockRejectedValueOnce(
      new Error("transport-error: APDU 0x6985 (user refused)"),
    );

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "USER_REJECTED",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/rejected/i);
    expect(text).toMatch(/re-call pair_tron_ledger/i);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });

  it("maps 60s timeout → errorCode: APPROVAL_TIMEOUT (fake-timers race)", async () => {
    vi.useFakeTimers();
    // Never-resolving promise — the timer must win the race.
    fetchSpy.mockReturnValueOnce(new Promise(() => {}));

    const promise = callTool({});
    // Advance JUST past APPROVAL_TIMEOUT_MS (60_000ms).
    await vi.advanceTimersByTimeAsync(60_001);
    const result = await promise;

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "APPROVAL_TIMEOUT",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/60 seconds/);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });

  it("maps unknown Error → errorCode: INTERNAL_ERROR (defensive catch-all, NOT in locked-5)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("hid: device disconnected mid-exchange"));

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INTERNAL_ERROR",
    );
    const text = result.content[0]?.text ?? "";
    expect(text.startsWith("error: ")).toBe(true);
    expect(text).toMatch(/hid: device disconnected/);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });
});

describe("pair_tron_ledger — DESCRIPTION + source-level regression gates", () => {
  it("DESCRIPTION length >= MIN_DESCRIPTION_LEN (100 chars)", async () => {
    const tool = getRegisteredTool("pair_tron_ledger");
    expect(tool).toBeDefined();
    expect(tool!.description.length).toBeGreaterThanOrEqual(100);
  });

  it("source file contains ZERO non-comment references to `lastHardenedIndex` (Solana helper) — REGRESSION ANCHOR per research § Pitfall 6", async () => {
    // Defense-in-depth grep gate. Even if a future change accidentally
    // imports the Solana helper, the symbol reference would surface here
    // before the slot-3 runtime regression test fires. We strip comment
    // lines so the header comment's reference to the regression anchor
    // does not false-trip the gate (the anchor names the symbol to warn
    // against; the gate is for CODE references).
    const src = readFileSync(
      resolve(process.cwd(), "src/tools/pair_tron_ledger.ts"),
      "utf-8",
    );
    const stripped = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(stripped).not.toContain("lastHardenedIndex");
  });
});
