// test/pair-bittensor-ledger.test.ts — Phase 46 Plan 46-02 Task 3
// (TAO-PAIR-01 + T-46-DEMO + the locked errorCodes + INTERNAL_ERROR).
//
// Mirrors test/pair-solana-ledger.test.ts: mock the underlying
// `fetchBittensorAddress` import, preserve the typed error classes
// (production code uses `instanceof`), drive scenarios via
// `mockResolvedValueOnce` / `mockRejectedValueOnce` per test.
//
// T-46-DEMO LOAD-BEARING assertion: in demo mode, the `_transport`
// spy-affordance must observe ZERO invocations of EVERY method — proving
// the demo-mode refusal fires BEFORE any USB-HID transport open. We spy on
// the real `_transport` object (the ESM spy-affordance from
// ledger-bittensor-transport.ts) for the demo branch; the happy/error
// branches mock `fetchBittensorAddress` directly so no real transport is
// ever constructed. NO real WsProvider / node-hid socket.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fetchBittensorAddress; keep the typed error classes + the
// `_transport` spy-affordance real so `instanceof` works AND the demo-mode
// zero-invocation assertion can spy the real object.
const fetchSpy = vi.fn();

vi.mock("../src/wallet/ledger-bittensor-transport.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/ledger-bittensor-transport.js")
  >("../src/wallet/ledger-bittensor-transport.js");
  return {
    ...actual,
    fetchBittensorAddress: (
      ...args: Parameters<typeof actual.fetchBittensorAddress>
    ) => fetchSpy(...args),
  };
});

// Spy on saveAccount so we can assert the pairing was persisted with the
// expected payload — without exercising the real fs writer.
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
  LedgerBittensorAppNotOpenError,
  _transport,
} from "../src/wallet/ledger-bittensor-transport.js";
import { LedgerDeviceNotConnectedError } from "../src/wallet/ledger-solana-transport.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { VERIFY_ON_DEVICE_BITTENSOR_TEMPLATE } from "../src/tools/pair_bittensor_ledger.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Side-effect-register the tool once. Subsequent tests reuse the closure;
// per-test scenario is driven by the mocked `fetchSpy`.
await import("../src/tools/pair_bittensor_ledger.js");

async function callTool(
  args: Record<string, unknown> = {},
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("pair_bittensor_ledger");
  if (!tool) throw new Error("pair_bittensor_ledger not registered");
  return tool.handler(args);
}

// Fixture SS58 — the RESEARCH-verified "01".repeat(32) → 5C62Ck4U… anchor.
// The device returns the address PRE-ENCODED; this is what fetchSpy yields.
const FIXTURE_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";
const FIXTURE_PUBKEY = "0x" + "01".repeat(32);

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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pair_bittensor_ledger — demo-mode FIRST refusal (T-46-DEMO)", () => {
  it("refuses with errorCode: DEMO_MODE_REFUSED when VAULTPILOT_DEMO=true; the _transport spy observes ZERO invocations", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    // Spy EVERY _transport method — the load-bearing T-46-DEMO assertion is
    // that NONE of them is invoked in the demo branch (transport never
    // opened before the refusal).
    const isSupportedSpy = vi.spyOn(_transport, "isSupported");
    const listSpy = vi.spyOn(_transport, "list");
    const openSpy = vi.spyOn(_transport, "open");
    const buildSpy = vi.spyOn(_transport, "buildGenericApp");
    const versionSpy = vi.spyOn(_transport, "getVersionViaApp");
    const addressSpy = vi.spyOn(_transport, "getAddressEd25519ViaApp");

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "DEMO_MODE_REFUSED",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);
    expect(text).toMatch(/set_demo_wallet/);

    // T-46-DEMO: NO USB-HID transport open in demo mode. fetchSpy (the
    // mocked address fetch) AND every raw transport seam must be untouched.
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(saveSpy).toHaveBeenCalledTimes(0);
    expect(isSupportedSpy).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(buildSpy).not.toHaveBeenCalled();
    expect(versionSpy).not.toHaveBeenCalled();
    expect(addressSpy).not.toHaveBeenCalled();
  });
});

describe("pair_bittensor_ledger — happy path + VERIFY-ON-DEVICE block (TAO-PAIR-01)", () => {
  it("returns the substituted VERIFY-ON-DEVICE block + states ed25519-coldkey + persists chain:\"bittensor\" + surfaces address/derivationPath/pairedAt", async () => {
    const beforeIso = new Date().toISOString();
    fetchSpy.mockResolvedValueOnce({
      address: FIXTURE_SS58,
      pubKey: FIXTURE_PUBKEY,
    });

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      address: string;
      derivationPath: string;
      pairedAt: string;
      keyType: string;
    };
    expect(sc.address).toBe(FIXTURE_SS58);
    expect(sc.derivationPath).toBe("44'/354'/0'/0'/0'");
    expect(sc.keyType).toBe("ed25519");
    expect(Number.isNaN(Date.parse(sc.pairedAt))).toBe(false);
    expect(Date.parse(sc.pairedAt)).toBeGreaterThanOrEqual(
      Date.parse(beforeIso),
    );

    // The address was returned VERBATIM (the device pre-encodes; no
    // client-side re-encode).
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("VERIFY ON DEVICE");
    expect(text).toContain(`Address: ${FIXTURE_SS58}`);
    expect(text).toMatch(/Slot:\s+#0/);
    expect(text).toMatch(/derivation path:\s+44'\/354'\/0'\/0'\/0'/);
    // TAO-PAIR-01 — the ed25519-coldkey statement, distinct from sr25519.
    expect(text).toMatch(/ed25519 coldkey/);
    expect(text).toMatch(/sr25519/);

    // Format-fanout sentinel: prod + test reference the SAME const. Build
    // the expected block here with the same replace calls as the handler.
    const expectedSubstituted = VERIFY_ON_DEVICE_BITTENSOR_TEMPLATE
      .replace("{ADDRESS}", FIXTURE_SS58)
      .replace(/\{DERIVATION_PATH_LAST_INDEX\}/g, "0");
    expect(text.includes(expectedSubstituted)).toBe(true);

    // saveAccount called with chain:"bittensor".
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saved = saveSpy.mock.calls[0]![0] as {
      chain: string;
      address: string;
      derivationPath: string;
      pairedAt: string;
    };
    expect(saved.chain).toBe("bittensor");
    expect(saved.address).toBe(FIXTURE_SS58);
    expect(saved.derivationPath).toBe("44'/354'/0'/0'/0'");
    expect(Number.isNaN(Date.parse(saved.pairedAt))).toBe(false);
  });
});

describe("pair_bittensor_ledger — error envelopes (locked errorCodes + INTERNAL_ERROR)", () => {
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
    expect(text).toMatch(/Polkadot \(Generic\) app/);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });

  it("maps LedgerBittensorAppNotOpenError → errorCode: BITTENSOR_APP_NOT_OPEN + recovery hint", async () => {
    fetchSpy.mockRejectedValueOnce(new LedgerBittensorAppNotOpenError());

    const result = await callTool({});

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "BITTENSOR_APP_NOT_OPEN",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/Polkadot \(Generic\) app/);
    expect(text).toMatch(/Open the Polkadot \(Generic\) app/);
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
    expect(text).toMatch(/re-call pair_bittensor_ledger/i);
    expect(saveSpy).toHaveBeenCalledTimes(0);
  });

  it("maps 60s timeout → errorCode: APPROVAL_TIMEOUT (fake-timers race)", async () => {
    vi.useFakeTimers();
    // Never-resolving promise — the timer must win the race.
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

  it("maps unknown Error → errorCode: INTERNAL_ERROR (defensive catch-all, NOT in locked set)", async () => {
    fetchSpy.mockRejectedValueOnce(
      new Error("hid: device disconnected mid-exchange"),
    );

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
