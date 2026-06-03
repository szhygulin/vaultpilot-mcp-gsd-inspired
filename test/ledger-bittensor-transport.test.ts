// test/ledger-bittensor-transport.test.ts — Phase 46 Plan 46-02 Task 1
// (TAO-PAIR-01).
//
// Covers the USB-HID transport-module behaviors via the `_transport`
// spy-affordance — NEVER a real transport / device (the indirection
// convention from CLAUDE.md; a direct spy on the immutable named export
// would silently no-op).
//
//   1. openTransport() throws LedgerDeviceNotConnectedError when
//      isSupported() is false OR list() is empty — the transport is NEVER
//      opened in either no-device branch.
//   2. fetchBittensorAddress, with `_transport` stubbed to yield
//      { address: <ss58>, pubKey: <hex> }, returns that `address` VERBATIM
//      (no client-side re-encode) and closes the transport in a `finally`
//      even on the happy path.
//   3. the version-probe → BITTENSOR_APP_NOT_OPEN mapping: when the spied
//      version-probe throws, fetchBittensorAddress surfaces
//      LedgerBittensorAppNotOpenError.
//
// NO real WsProvider / ApiPromise / node-hid socket is ever constructed —
// every Ledger SDK static + per-call APDU is routed through `_transport`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LedgerDeviceNotConnectedError } from "../src/wallet/ledger-solana-transport.js";
import {
  BITTENSOR_SS58_PREFIX,
  DEFAULT_BITTENSOR_DERIVATION_PATH,
  LedgerBittensorAppNotOpenError,
  _transport,
  fetchBittensorAddress,
  openTransport,
} from "../src/wallet/ledger-bittensor-transport.js";

// Fixture SS58 — the RESEARCH-verified "01".repeat(32) → 5C62Ck4U… anchor
// (pinned in test/chains-bittensor-ss58.test.ts). The device returns the
// address PRE-ENCODED; this is what the spy yields.
const FIXTURE_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";
const FIXTURE_PUBKEY = "0x" + "01".repeat(32);

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openTransport — no-device branches throw before any open (TAO-PAIR-01)", () => {
  it("throws LedgerDeviceNotConnectedError when isSupported() is false; transport NEVER opened", async () => {
    const isSupportedSpy = vi
      .spyOn(_transport, "isSupported")
      .mockResolvedValue(false);
    const listSpy = vi.spyOn(_transport, "list");
    const openSpy = vi.spyOn(_transport, "open");

    await expect(openTransport()).rejects.toBeInstanceOf(
      LedgerDeviceNotConnectedError,
    );

    expect(isSupportedSpy).toHaveBeenCalledTimes(1);
    // Short-circuits at isSupported — list() / open() never reached.
    expect(listSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("throws LedgerDeviceNotConnectedError when list() is empty; transport NEVER opened", async () => {
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    const listSpy = vi.spyOn(_transport, "list").mockResolvedValue([]);
    const openSpy = vi.spyOn(_transport, "open");

    await expect(openTransport()).rejects.toBeInstanceOf(
      LedgerDeviceNotConnectedError,
    );

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe("fetchBittensorAddress — pre-encoded SS58 verbatim + finally-close (TAO-PAIR-01)", () => {
  it("returns the device SS58 address VERBATIM (no client-side re-encode) and closes the transport in finally", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const fakeTransport = { close };
    const fakeApp = { __app: true };

    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue(fakeTransport);
    const buildSpy = vi
      .spyOn(_transport, "buildGenericApp")
      .mockReturnValue(fakeApp);
    const versionSpy = vi
      .spyOn(_transport, "getVersionViaApp")
      .mockResolvedValue({ major: 1, minor: 0, patch: 0 });
    const addressSpy = vi
      .spyOn(_transport, "getAddressEd25519ViaApp")
      .mockResolvedValue({ address: FIXTURE_SS58, pubKey: FIXTURE_PUBKEY });

    const result = await fetchBittensorAddress();

    // Address returned VERBATIM — byte-for-byte what the device produced.
    expect(result.address).toBe(FIXTURE_SS58);
    expect(result.pubKey).toBe(FIXTURE_PUBKEY);

    // The version-probe ran on the built app before the address fetch.
    expect(buildSpy).toHaveBeenCalledWith(fakeTransport);
    expect(versionSpy).toHaveBeenCalledTimes(1);
    // The address fetch passed the 5-level default path + prefix 42.
    expect(addressSpy).toHaveBeenCalledWith(
      fakeApp,
      DEFAULT_BITTENSOR_DERIVATION_PATH,
      BITTENSOR_SS58_PREFIX,
    );

    // finally-close — the USB-HID handle is released even on the happy path.
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the transport in finally even when the address fetch throws", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue({ close });
    vi.spyOn(_transport, "buildGenericApp").mockReturnValue({});
    vi.spyOn(_transport, "getVersionViaApp").mockResolvedValue({});
    vi.spyOn(_transport, "getAddressEd25519ViaApp").mockRejectedValue(
      new Error("hid: device disconnected mid-exchange"),
    );

    await expect(fetchBittensorAddress()).rejects.toThrow(
      /device disconnected/,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("fetchBittensorAddress — version-probe → BITTENSOR_APP_NOT_OPEN (TAO-PAIR-01)", () => {
  it("maps a thrown version-probe to LedgerBittensorAppNotOpenError; address fetch never reached; transport closed", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{ path: "hid0" }]);
    vi.spyOn(_transport, "open").mockResolvedValue({ close });
    vi.spyOn(_transport, "buildGenericApp").mockReturnValue({});
    const versionSpy = vi
      .spyOn(_transport, "getVersionViaApp")
      .mockRejectedValue(new Error("APDU 0x6e01: app not active"));
    const addressSpy = vi.spyOn(_transport, "getAddressEd25519ViaApp");

    await expect(fetchBittensorAddress()).rejects.toBeInstanceOf(
      LedgerBittensorAppNotOpenError,
    );

    expect(versionSpy).toHaveBeenCalledTimes(1);
    // App-not-open short-circuits BEFORE the address fetch.
    expect(addressSpy).not.toHaveBeenCalled();
    // finally still releases the handle.
    expect(close).toHaveBeenCalledTimes(1);
  });
});
