// test/pair-litecoin-ledger.test.ts — Phase 26 Plan 26-01 (LTC-PAIR-01).
//
// Tests for `src/tools/pair_litecoin_ledger.ts`:
//   - Demo-mode check FIRST (T-DEMO-1 mitigation)
//   - Happy path: dual addresses (L-prefix + ltc1q) returned, two saveAccount calls
//   - VERIFY-ON-DEVICE block contains both addresses verbatim
//   - getAppConfiguration gate: wrong app → LITECOIN_APP_NOT_OPEN (distinct from BITCOIN_APP_NOT_OPEN)
//   - Error envelopes: LEDGER_NOT_CONNECTED, USER_REJECTED, APPROVAL_TIMEOUT, INTERNAL_ERROR
//
// Coverage per plan <behavior>:
//   1. pair_litecoin_ledger returns both addresses (L-prefix legacy + ltc1q segwit)
//   2. pair_litecoin_ledger calls saveAccount twice with chain: "litecoin"
//   3. Wrong app (getAppConfiguration.name !== "Litecoin") → LITECOIN_APP_NOT_OPEN
//   4. Demo mode → DEMO_MODE_REFUSED before any transport open
//   5. Response includes VERIFY-ON-DEVICE block with both LTC addresses

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fetchLtcAddresses; keep typed error classes real.
const fetchLtcSpy = vi.fn();

vi.mock("../src/wallet/ledger-btc-transport.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/ledger-btc-transport.js")
  >("../src/wallet/ledger-btc-transport.js");
  return {
    ...actual,
    fetchLtcAddresses: (
      ...args: Parameters<typeof actual.fetchLtcAddresses>
    ) => fetchLtcSpy(...args),
  };
});

// Spy on saveAccount to assert persistence without hitting real fs.
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
  LedgerLtcAppNotOpenError,
  LedgerDeviceNotConnectedError,
} from "../src/wallet/ledger-btc-transport.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { VERIFY_ON_DEVICE_LTC_TEMPLATE } from "../src/tools/pair_litecoin_ledger.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Side-effect-register the tool once.
await import("../src/tools/pair_litecoin_ledger.js");

async function callTool(
  args: Record<string, unknown> = {},
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("pair_litecoin_ledger");
  if (!tool) throw new Error("pair_litecoin_ledger not registered");
  return tool.handler(args);
}

// Fixture addresses — recognizable LTC shapes.
const LEGACY_FIXTURE = "LXuMFER8KyoMon9HhWrDbyyHRtf2YXtdM3"; // L-prefix legacy (26 chars after L)
const SEGWIT_FIXTURE = "ltc1q" + "a".repeat(38); // synthetic ltc1q
const LEGACY_PUBKEY = "03abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const SEGWIT_PUBKEY  = "03fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const CHAINCODE = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";

function makeFetchResult() {
  return {
    legacy: {
      address: LEGACY_FIXTURE,
      publicKey: LEGACY_PUBKEY,
      chainCode: CHAINCODE,
      derivationPath: "44'/2'/0'/0/0",
    },
    segwit: {
      address: SEGWIT_FIXTURE,
      publicKey: SEGWIT_PUBKEY,
      chainCode: CHAINCODE,
      derivationPath: "84'/2'/0'/0/0",
    },
    appVersion: "Litecoin", // getAppConfiguration().name from real device (ASSUMED A1)
  };
}

beforeEach(() => {
  fetchLtcSpy.mockReset();
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

// ───────────────────── Demo-mode check ───────────────────────────────

describe("pair_litecoin_ledger — demo-mode FIRST refusal (T-DEMO-1)", () => {
  it("refuses with DEMO_MODE_REFUSED when VAULTPILOT_DEMO=true; fetchLtcAddresses NEVER called", async () => {
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

    // Load-bearing T-DEMO-1: NO transport open in demo mode.
    expect(fetchLtcSpy).toHaveBeenCalledTimes(0);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });
});

// ───────────────────── Happy path ────────────────────────────────────

describe("pair_litecoin_ledger — happy path + DUAL VERIFY-ON-DEVICE + dual saveAccount (LTC-PAIR-01)", () => {
  it("returns substituted DUAL-address VERIFY block + persists TWO records under chain: 'litecoin'", async () => {
    const beforeIso = new Date().toISOString();
    fetchLtcSpy.mockResolvedValueOnce(makeFetchResult());

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      addresses: { legacy: string; segwit: string };
      derivationPaths: { legacy: string; segwit: string };
      pairedAt: string;
      appVersion: string;
    };
    // structuredContent.addresses is an OBJECT with both addresses.
    expect(sc.addresses).toEqual({ legacy: LEGACY_FIXTURE, segwit: SEGWIT_FIXTURE });
    expect(sc.derivationPaths).toEqual({
      legacy: "44'/2'/0'/0/0",
      segwit: "84'/2'/0'/0/0",
    });
    // pairedAt must be a parseable ISO-8601 timestamp.
    expect(Number.isNaN(Date.parse(sc.pairedAt))).toBe(false);
    expect(Date.parse(sc.pairedAt)).toBeGreaterThanOrEqual(Date.parse(beforeIso));

    // VERIFY-ON-DEVICE block — DUAL-address, substituted verbatim.
    const text = result.content[0]?.text ?? "";
    const expectedSubstituted = VERIFY_ON_DEVICE_LTC_TEMPLATE
      .replace("{LEGACY_ADDRESS}", LEGACY_FIXTURE)
      .replace("{SEGWIT_ADDRESS}", SEGWIT_FIXTURE);
    expect(text).toBe(expectedSubstituted);
    expect(text).toContain("VERIFY ON DEVICE");
    expect(text).toContain(`Legacy (BIP-44):  ${LEGACY_FIXTURE}`);
    expect(text).toContain("derivation: 44'/2'/0'/0/0");
    expect(text).toContain(`Segwit (BIP-84):  ${SEGWIT_FIXTURE}`);
    expect(text).toContain("derivation: 84'/2'/0'/0/0");
    expect(text).toMatch(/TWO addresses/);
    expect(text).toMatch(/byte-for-byte/);

    // EXACTLY TWO saveAccount calls under chain: "litecoin".
    expect(saveSpy).toHaveBeenCalledTimes(2);
    const saved1 = saveSpy.mock.calls[0]![0] as { chain: string; address: string; derivationPath: string; pairedAt: string };
    const saved2 = saveSpy.mock.calls[1]![0] as { chain: string; address: string; derivationPath: string; pairedAt: string };
    const all = [saved1, saved2];
    expect(all.every((r) => r.chain === "litecoin")).toBe(true);
    const addresses = all.map((r) => r.address).sort();
    expect(addresses).toEqual([LEGACY_FIXTURE, SEGWIT_FIXTURE].sort());
    const legacySaved = all.find((r) => r.address === LEGACY_FIXTURE);
    const segwitSaved = all.find((r) => r.address === SEGWIT_FIXTURE);
    expect(legacySaved?.derivationPath).toBe("44'/2'/0'/0/0");
    expect(segwitSaved?.derivationPath).toBe("84'/2'/0'/0/0");
    // Both calls share the same pairedAt (one device session).
    expect(saved1.pairedAt).toBe(saved2.pairedAt);
  });
});

// ───────────────────── Error envelopes ───────────────────────────────

describe("pair_litecoin_ledger — error envelopes (locked 5+1 errorCodes)", () => {
  it("maps LedgerDeviceNotConnectedError → LEDGER_NOT_CONNECTED + recovery hint", async () => {
    fetchLtcSpy.mockRejectedValueOnce(new LedgerDeviceNotConnectedError());

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "LEDGER_NOT_CONNECTED",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/No Ledger/i);
    expect(text).toMatch(/USB/);
    expect(text).toMatch(/Litecoin app/);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });

  it("maps LedgerLtcAppNotOpenError → LITECOIN_APP_NOT_OPEN (distinct from BITCOIN_APP_NOT_OPEN)", async () => {
    fetchLtcSpy.mockRejectedValueOnce(new LedgerLtcAppNotOpenError());

    const result = await callTool({});

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("LITECOIN_APP_NOT_OPEN");
    // NOT BITCOIN_APP_NOT_OPEN — distinct error code (T-26-01 mitigation)
    expect(sc.errorCode).not.toBe("BITCOIN_APP_NOT_OPEN");
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/Litecoin app/);
    expect(text).toMatch(/Open the Litecoin app/);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });

  it("maps APDU 0x6985 substring → USER_REJECTED + re-call hint", async () => {
    fetchLtcSpy.mockRejectedValueOnce(
      new Error("transport-error: APDU 0x6985 (user refused)"),
    );

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "USER_REJECTED",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/rejected/i);
    expect(text).toMatch(/re-call pair_litecoin_ledger/i);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });

  it("maps 60s timeout → APPROVAL_TIMEOUT (fake-timers race)", async () => {
    vi.useFakeTimers();
    fetchLtcSpy.mockReturnValueOnce(new Promise(() => {}));

    const promise = callTool({});
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

  it("maps unknown Error → INTERNAL_ERROR (defensive catch-all)", async () => {
    fetchLtcSpy.mockRejectedValueOnce(new Error("hid: device disconnected mid-exchange"));

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

// ───────────────────── Registration + template tests ─────────────────

describe("pair_litecoin_ledger — registration + VERIFY-ON-DEVICE template", () => {
  it("tool is registered under 'pair_litecoin_ledger'", () => {
    const tool = getRegisteredTool("pair_litecoin_ledger");
    expect(tool).toBeDefined();
    expect(tool!.description.length).toBeGreaterThanOrEqual(100);
  });

  it("INPUT_SCHEMA is empty object (no agent input)", () => {
    const tool = getRegisteredTool("pair_litecoin_ledger");
    const schema = tool!.inputSchema as { type: string; properties?: Record<string, unknown>; additionalProperties?: boolean };
    expect(schema.type).toBe("object");
    expect(schema.properties ?? {}).toEqual({});
    expect(schema.additionalProperties).toBe(false);
  });

  it("VERIFY_ON_DEVICE_LTC_TEMPLATE contains DUAL-address sentinel lines (SOT)", () => {
    expect(VERIFY_ON_DEVICE_LTC_TEMPLATE).toContain("VERIFY ON DEVICE");
    expect(VERIFY_ON_DEVICE_LTC_TEMPLATE).toContain("Legacy (BIP-44):  {LEGACY_ADDRESS}");
    expect(VERIFY_ON_DEVICE_LTC_TEMPLATE).toContain("derivation: 44'/2'/0'/0/0");
    expect(VERIFY_ON_DEVICE_LTC_TEMPLATE).toContain("Segwit (BIP-84):  {SEGWIT_ADDRESS}");
    expect(VERIFY_ON_DEVICE_LTC_TEMPLATE).toContain("derivation: 84'/2'/0'/0/0");
    expect(VERIFY_ON_DEVICE_LTC_TEMPLATE).toContain("Open the Litecoin app on your Ledger");
    expect(VERIFY_ON_DEVICE_LTC_TEMPLATE).toMatch(/TWO addresses/);
  });
});
