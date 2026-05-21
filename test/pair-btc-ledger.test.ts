// Phase 22 Plan 22-02 — pair_btc_ledger tool tests (BTC-PAIR-01 + T-DEMO-1
// + the 5+1 locked errorCodes + dual saveAccount + dual VERIFY-ON-DEVICE
// + idempotent-upsert regression anchor).
//
// Mirrors `test/pair-tron-ledger.test.ts` shape with THREE divergences
// for BTC:
//   1. TWO saveAccount calls per successful pair (segwit + taproot under
//      chain: "bitcoin"); not one.
//   2. structuredContent.addresses is an OBJECT { segwit, taproot }; not
//      a single address string.
//   3. The VERIFY-ON-DEVICE block contains BOTH addresses verbatim;
//      `pair_btc_ledger.ts` re-renders them via two `.replace()` calls.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fetchBtcAddresses; keep the typed error classes real so
// `err instanceof LedgerDeviceNotConnectedError` etc. still works.
const fetchSpy = vi.fn();

vi.mock("../src/wallet/ledger-btc-transport.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/ledger-btc-transport.js")
  >("../src/wallet/ledger-btc-transport.js");
  return {
    ...actual,
    fetchBtcAddresses: (
      ...args: Parameters<typeof actual.fetchBtcAddresses>
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
  LedgerBtcAppNotOpenError,
  LedgerDeviceNotConnectedError,
} from "../src/wallet/ledger-btc-transport.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import {
  VERIFY_ON_DEVICE_BTC_TEMPLATE,
} from "../src/tools/pair_btc_ledger.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Side-effect-register the tool once. Subsequent tests reuse the closure;
// per-test scenario is driven by the mocked `fetchSpy`.
await import("../src/tools/pair_btc_ledger.js");

async function callTool(
  args: Record<string, unknown> = {},
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("pair_btc_ledger");
  if (!tool) throw new Error("pair_btc_ledger not registered");
  return tool.handler(args);
}

// Fixture addresses — recognizable bech32 / bech32m shapes.
const SEGWIT_FIXTURE = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const TAPROOT_FIXTURE =
  "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";
const SEGWIT_PUBKEY =
  "03abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const TAPROOT_PUBKEY =
  "03fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const CHAINCODE =
  "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";

function makeFetchResult() {
  return {
    segwit: {
      address: SEGWIT_FIXTURE,
      publicKey: SEGWIT_PUBKEY,
      chainCode: CHAINCODE,
      derivationPath: "84'/0'/0'/0/0",
    },
    taproot: {
      address: TAPROOT_FIXTURE,
      publicKey: TAPROOT_PUBKEY,
      chainCode: CHAINCODE,
      derivationPath: "86'/0'/0'/0/0",
    },
    appVersion: "2.1.3",
  };
}

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

describe("pair_btc_ledger — demo-mode FIRST refusal (T-DEMO-1)", () => {
  it("refuses with errorCode: DEMO_MODE_REFUSED when VAULTPILOT_DEMO=true; fetchBtcAddresses NEVER called", async () => {
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
    // mode. A future bug reordering the demo check below fetchBtcAddresses
    // would silently leak transport state.
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });
});

describe("pair_btc_ledger — happy path + DUAL VERIFY-ON-DEVICE block + dual saveAccount (BTC-PAIR-01)", () => {
  it("returns substituted DUAL-address VERIFY block + persists TWO records under chain: \"bitcoin\" + surfaces addresses/derivationPaths/pairedAt/appVersion", async () => {
    const beforeIso = new Date().toISOString();
    fetchSpy.mockResolvedValueOnce(makeFetchResult());

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      addresses: { segwit: string; taproot: string };
      derivationPaths: { segwit: string; taproot: string };
      pairedAt: string;
      appVersion: string;
    };
    // structuredContent.addresses is an OBJECT (not a single string).
    expect(sc.addresses).toEqual({ segwit: SEGWIT_FIXTURE, taproot: TAPROOT_FIXTURE });
    // structuredContent.derivationPaths is an OBJECT.
    expect(sc.derivationPaths).toEqual({
      segwit: "84'/0'/0'/0/0",
      taproot: "86'/0'/0'/0/0",
    });
    expect(sc.appVersion).toBe("2.1.3");
    // pairedAt must be a parseable ISO-8601 timestamp >= test-entry.
    expect(Number.isNaN(Date.parse(sc.pairedAt))).toBe(false);
    expect(Date.parse(sc.pairedAt)).toBeGreaterThanOrEqual(Date.parse(beforeIso));

    // VERIFY-ON-DEVICE block — DUAL-address, substituted verbatim.
    const text = result.content[0]?.text ?? "";
    const expectedSubstituted = VERIFY_ON_DEVICE_BTC_TEMPLATE
      .replace("{SEGWIT_ADDRESS}", SEGWIT_FIXTURE)
      .replace("{TAPROOT_ADDRESS}", TAPROOT_FIXTURE);
    expect(text).toBe(expectedSubstituted);
    // Phrase-by-phrase coverage of the load-bearing fixtures.
    expect(text).toContain("VERIFY ON DEVICE");
    expect(text).toContain(`Segwit (BIP-84):  ${SEGWIT_FIXTURE}`);
    expect(text).toContain("derivation: 84'/0'/0'/0/0");
    expect(text).toContain(`Taproot (BIP-86): ${TAPROOT_FIXTURE}`);
    expect(text).toContain("derivation: 86'/0'/0'/0/0");
    expect(text).toMatch(/TWO addresses/);
    expect(text).toMatch(/byte-for-byte/);

    // EXACTLY TWO saveAccount calls — one per address — both under chain: "bitcoin".
    expect(saveSpy).toHaveBeenCalledTimes(2);
    const saved1 = saveSpy.mock.calls[0]![0] as { chain: string; address: string; derivationPath: string; pairedAt: string };
    const saved2 = saveSpy.mock.calls[1]![0] as { chain: string; address: string; derivationPath: string; pairedAt: string };
    const all = [saved1, saved2];
    expect(all.every((r) => r.chain === "bitcoin")).toBe(true);
    const addresses = all.map((r) => r.address).sort();
    expect(addresses).toEqual([SEGWIT_FIXTURE, TAPROOT_FIXTURE].sort());
    const segwitSaved = all.find((r) => r.address === SEGWIT_FIXTURE);
    const taprootSaved = all.find((r) => r.address === TAPROOT_FIXTURE);
    expect(segwitSaved?.derivationPath).toBe("84'/0'/0'/0/0");
    expect(taprootSaved?.derivationPath).toBe("86'/0'/0'/0/0");
    // Both calls share the same pairedAt (one device session — one timestamp).
    expect(saved1.pairedAt).toBe(saved2.pairedAt);
  });
});

describe("pair_btc_ledger — error envelopes (locked 5+1 errorCodes)", () => {
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
    expect(text).toMatch(/Bitcoin app/);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });

  it("maps LedgerBtcAppNotOpenError → errorCode: BITCOIN_APP_NOT_OPEN + recovery hint", async () => {
    fetchSpy.mockRejectedValueOnce(new LedgerBtcAppNotOpenError());

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "BITCOIN_APP_NOT_OPEN",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/Bitcoin app/);
    expect(text).toMatch(/Open the Bitcoin app/);
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
    expect(text).toMatch(/re-call pair_btc_ledger/i);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });

  it("maps 60s timeout → errorCode: APPROVAL_TIMEOUT (fake-timers race)", async () => {
    vi.useFakeTimers();
    fetchSpy.mockReturnValueOnce(new Promise(() => {}));

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

  it("maps unknown Error → errorCode: INTERNAL_ERROR (defensive catch-all)", async () => {
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

describe("pair_btc_ledger — registration + register-all wiring", () => {
  it("DESCRIPTION length >= MIN_DESCRIPTION_LEN (100 chars) — agent routing prompt discipline", () => {
    const tool = getRegisteredTool("pair_btc_ledger");
    expect(tool).toBeDefined();
    expect(tool!.description.length).toBeGreaterThanOrEqual(100);
  });

  it("INPUT_SCHEMA is empty object (no agent input — transport open is the entire effect)", () => {
    const tool = getRegisteredTool("pair_btc_ledger");
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as { type: string; properties?: Record<string, unknown>; additionalProperties?: boolean };
    expect(schema.type).toBe("object");
    expect(schema.properties ?? {}).toEqual({});
    expect(schema.additionalProperties).toBe(false);
  });

  it("register-all.ts imports `./pair_btc_ledger.js` for side-effect registration", () => {
    const src = readFileSync(resolve(process.cwd(), "src/tools/register-all.ts"), "utf-8");
    expect(src).toMatch(/import\s+["']\.\/pair_btc_ledger\.js["']/);
  });

  it("VERIFY_ON_DEVICE_BTC_TEMPLATE contains DUAL-address sentinel lines verbatim (SOT)", () => {
    expect(VERIFY_ON_DEVICE_BTC_TEMPLATE).toContain("VERIFY ON DEVICE");
    expect(VERIFY_ON_DEVICE_BTC_TEMPLATE).toContain("Segwit (BIP-84):  {SEGWIT_ADDRESS}");
    expect(VERIFY_ON_DEVICE_BTC_TEMPLATE).toContain("derivation: 84'/0'/0'/0/0");
    expect(VERIFY_ON_DEVICE_BTC_TEMPLATE).toContain("Taproot (BIP-86): {TAPROOT_ADDRESS}");
    expect(VERIFY_ON_DEVICE_BTC_TEMPLATE).toContain("derivation: 86'/0'/0'/0/0");
    expect(VERIFY_ON_DEVICE_BTC_TEMPLATE).toContain(
      "Open the Bitcoin app on your Ledger",
    );
    expect(VERIFY_ON_DEVICE_BTC_TEMPLATE).toMatch(/TWO addresses/);
  });
});
