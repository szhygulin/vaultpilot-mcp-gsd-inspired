// Phase 49 Plan 49-01 — get_bittensor_setup_status tool tests (TAO-DIAG-01).
//
// 6 arm/behavior cases covering the lazy 3-arm diagnostic contract — a
// near-mechanical clone of test/get-tron-setup-status.test.ts with the
// Bittensor seams swapped in:
//   (1) all arms      — paired, device reachable, stake present
//   (2) rpc arm       — ARM A (getStakeInfo) rejects → stakePositionsPresent:false
//                       + rpcDegraded; device fields STAY populated (independence)
//   (3) usb-hid arm   — ARM B (getAddressEd25519ViaApp) rejects with
//                       LedgerDeviceNotConnectedError → both device fields null
//                       + deviceStatus:disconnected; ARM A STAYS populated
//   (4) app-version arm — ARM C (getVersionViaApp) rejects → single-open helper
//                       maps to LedgerBittensorAppNotOpenError → both device
//                       fields null + deviceStatus:polkadot-app-closed; ARM A
//                       STAYS populated (T-LEDGER-APP-VERSION-LIES — the version
//                       signal degrades to null, never weaponizes)
//   (5) no boot rpc   — _bittensorRegistry.getApi NOT called at module import /
//                       registration (the lazy-probe seam)
//   (6) no pairing    — no wallet arg AND empty store → FROZEN INVALID_INPUT +
//                       hintTool:"pair_bittensor_ledger", NO probe fired
//                       (no getApi, no transport open)
//
// Spy strategy (per CLAUDE.md ESM spy-affordance convention):
// - `getStakeInfo` named export (tao-rpc-client) — ARM A seam. Spied directly;
//   it routes through `_bittensorRegistry.getApi()` internally, so spying it
//   (instead of a whole-module mock) keeps the no-boot-RPC seam intact.
// - `_transport.*` indirection (ledger-bittensor-transport) — ARMs B/C seams.
//   Spied per-method so NO live USB-HID transport ever opens.
// - `_bittensorRegistry.getApi` / `_transport.open` — spied ONLY to ASSERT
//   they are NOT called (Tests 5 + 6).
// - `_resetNonEvmStoreForTesting` + `saveAccount` — store seed / teardown.
//
// NO `vi.mock()` of whole modules — that defeats the lazy-probe seam and
// violates the ESM spy-affordance convention. NO live RPC, NO live transport
// in any case — every seam is mocked at the registry/transport boundary.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _bittensorRegistry } from "../src/chains/bittensor/registry.js";
import * as taoRpc from "../src/chains/bittensor/tao-rpc-client.js";
import {
  DEFAULT_BITTENSOR_DERIVATION_PATH,
  LedgerBittensorAppNotOpenError,
  _transport,
} from "../src/wallet/ledger-bittensor-transport.js";
import { LedgerDeviceNotConnectedError } from "../src/wallet/ledger-solana-transport.js";
import {
  _resetNonEvmStoreForTesting,
  saveAccount,
} from "../src/wallet/non-evm-account-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

// Register the tool (side-effect import). This MUST NOT trigger any RPC /
// transport open — Test 5 asserts it.
await import("../src/tools/get_bittensor_setup_status.js");

// ─── Fixtures (hardcoded valid prefix-42 SS58 literals) ──────────────────────────
const STORE_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";
const OTHER_SS58 = "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM";
const PUBKEY = "0x" + "ab".repeat(32);
const PAIRED_AT = "2026-05-20T10:00:00.000Z";

// ─── Helper: invoke tool ───────────────────────────────────────────────────────
async function callTool(
  args: Record<string, unknown> = {},
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_bittensor_setup_status");
  if (!tool) throw new Error("get_bittensor_setup_status not registered");
  return tool.handler(args);
}

// Seed the PAIR-NEV-store with a Bittensor record.
function seedStore(): void {
  saveAccount({
    chain: "bittensor",
    address: STORE_SS58,
    derivationPath: DEFAULT_BITTENSOR_DERIVATION_PATH,
    pairedAt: PAIRED_AT,
  });
}

// Stub the full device-transport seam so fetchBittensorSetup runs through the
// indirection without ever opening a live USB-HID handle.
function stubDeviceTransportHappy(): void {
  vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
  vi.spyOn(_transport, "list").mockResolvedValue([{}]);
  vi.spyOn(_transport, "open").mockResolvedValue({
    close: async () => {},
  });
  vi.spyOn(_transport, "buildGenericApp").mockReturnValue({});
  vi.spyOn(_transport, "getVersionViaApp").mockResolvedValue({
    major: 1,
    minor: 0,
    patch: 0,
  });
  vi.spyOn(_transport, "getAddressEd25519ViaApp").mockResolvedValue({
    address: STORE_SS58,
    pubKey: PUBKEY,
  });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────
beforeEach(() => {
  _resetNonEvmStoreForTesting();
  vi.restoreAllMocks();
});

afterEach(() => {
  _resetNonEvmStoreForTesting();
  vi.restoreAllMocks();
});

// ─── Case 1: all arms ──────────────────────────────────────────────────────────
describe("get_bittensor_setup_status — (1) all arms", () => {
  it("returns the full diagnostic envelope; addressVerified OMITTED", async () => {
    seedStore();

    // ARM A — stake present (1 row).
    vi.spyOn(taoRpc, "getStakeInfo").mockResolvedValue([
      {
        hotkey: "5Hotkey",
        netuid: 1,
        alphaRao: 1_000_000_000n,
        alpha: "1",
        isRegistered: true,
      },
    ]);
    // ARMs B + C — device reachable, version 1.0.0, address matches store.
    stubDeviceTransportHappy();

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("bittensor");
    expect(sc.walletAddress).toBe(STORE_SS58);
    expect(sc.ledgerPolkadotAppVersion).toBe("1.0.0");
    expect(sc.walletAddressOnDevice).toBe(STORE_SS58);
    expect(sc.stakePositionsPresent).toBe(true);
    expect(sc.rpcDegraded).toBeUndefined();
    expect(sc.deviceStatus).toBeUndefined();
    // addressVerified is OMITTED per spec — must not appear in the envelope.
    expect("addressVerified" in sc).toBe(false);
    expect(sc.addressVerified).toBeUndefined();
  });
});

// ─── Case 2: rpc arm ─────────────────────────────────────────────────────────
describe("get_bittensor_setup_status — (2) rpc arm", () => {
  it("ARM A reject → stakePositionsPresent:false + rpcDegraded; device fields STAY populated", async () => {
    seedStore();

    // ARM A rejects — RPC down.
    vi.spyOn(taoRpc, "getStakeInfo").mockRejectedValue(new Error("RPC down"));
    // ARMs B + C succeed independently.
    stubDeviceTransportHappy();

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    // ARM A demoted.
    expect(sc.stakePositionsPresent).toBe(false);
    const rpcDegraded = sc.rpcDegraded as { reason: string } | undefined;
    expect(rpcDegraded).toBeDefined();
    expect(rpcDegraded?.reason).toMatch(/RPC down/);
    // ARMs B + C STAY populated (independence).
    expect(sc.walletAddressOnDevice).toBe(STORE_SS58);
    expect(sc.ledgerPolkadotAppVersion).toBe("1.0.0");
    expect(sc.deviceStatus).toBeUndefined();
  });
});

// ─── Case 3: usb-hid arm ─────────────────────────────────────────────────────
describe("get_bittensor_setup_status — (3) usb-hid arm", () => {
  it("ARM B reject (device disconnected) → both device fields null + deviceStatus:disconnected; ARM A STAYS populated", async () => {
    seedStore();

    // ARM A succeeds independently — stake present.
    vi.spyOn(taoRpc, "getStakeInfo").mockResolvedValue([
      {
        hotkey: "5Hotkey",
        netuid: 1,
        alphaRao: 5_000n,
        alpha: "0.000005",
        isRegistered: true,
      },
    ]);
    // Device probe: the address fetch rejects with device-not-connected. The
    // single-open helper surfaces it from fetchBittensorSetup → both device
    // fields demote to null together.
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{}]);
    vi.spyOn(_transport, "open").mockResolvedValue({ close: async () => {} });
    vi.spyOn(_transport, "buildGenericApp").mockReturnValue({});
    vi.spyOn(_transport, "getVersionViaApp").mockResolvedValue({
      major: 1,
      minor: 0,
      patch: 0,
    });
    vi.spyOn(_transport, "getAddressEd25519ViaApp").mockRejectedValue(
      new LedgerDeviceNotConnectedError(),
    );

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    // ARMs B + C demoted together (single transport open).
    expect(sc.walletAddressOnDevice).toBeNull();
    expect(sc.ledgerPolkadotAppVersion).toBeNull();
    const deviceStatus = sc.deviceStatus as { reason: string } | undefined;
    expect(deviceStatus).toBeDefined();
    expect(deviceStatus?.reason).toMatch(/disconnected/);
    // ARM A STAYS populated (independence).
    expect(sc.stakePositionsPresent).toBe(true);
    expect(sc.rpcDegraded).toBeUndefined();
    // addressVerified OMITTED even on the device-down path.
    expect("addressVerified" in sc).toBe(false);
  });
});

// ─── Case 4: app-version arm ─────────────────────────────────────────────────
describe("get_bittensor_setup_status — (4) app-version arm", () => {
  it("ARM C reject (version probe throws) → polkadot-app-closed; both device fields null; ARM A STAYS populated", async () => {
    seedStore();

    // ARM A succeeds independently.
    vi.spyOn(taoRpc, "getStakeInfo").mockResolvedValue([
      {
        hotkey: "5Hotkey",
        netuid: 2,
        alphaRao: 9_000n,
        alpha: "0.000009",
        isRegistered: false,
      },
    ]);
    // Device probe: the version probe rejects BEFORE the address fetch. Per the
    // Task 2 helper contract, a getVersionViaApp throw maps to
    // LedgerBittensorAppNotOpenError → both device fields demote.
    vi.spyOn(_transport, "isSupported").mockResolvedValue(true);
    vi.spyOn(_transport, "list").mockResolvedValue([{}]);
    vi.spyOn(_transport, "open").mockResolvedValue({ close: async () => {} });
    vi.spyOn(_transport, "buildGenericApp").mockReturnValue({});
    vi.spyOn(_transport, "getVersionViaApp").mockRejectedValue(
      new Error("0x6e01 — INS not supported (wrong app)"),
    );
    // The address fetch should never be reached; spy it to confirm.
    const addressSpy = vi
      .spyOn(_transport, "getAddressEd25519ViaApp")
      .mockResolvedValue({ address: STORE_SS58, pubKey: PUBKEY });

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    // ARM C (and its bundled ARM B) demoted to null.
    expect(sc.ledgerPolkadotAppVersion).toBeNull();
    expect(sc.walletAddressOnDevice).toBeNull();
    const deviceStatus = sc.deviceStatus as { reason: string } | undefined;
    expect(deviceStatus).toBeDefined();
    expect(deviceStatus?.reason).toMatch(/polkadot-app-closed/);
    // Version probe threw → app diagnosed not-open → address fetch never ran.
    expect(addressSpy).not.toHaveBeenCalled();
    // ARM A STAYS populated (independence) — the version signal never
    // weaponizes a read-only diagnostic (T-LEDGER-APP-VERSION-LIES).
    expect(sc.stakePositionsPresent).toBe(true);
    expect(sc.rpcDegraded).toBeUndefined();
  });
});

// ─── Case 5: no boot rpc ─────────────────────────────────────────────────────
describe("get_bittensor_setup_status — (5) no boot rpc", () => {
  it("_bittensorRegistry.getApi is NOT called at module import / registration (lazy seam)", async () => {
    // The tool module is already side-effect imported at the top of this file.
    // Seeding the store must not fire any RPC either.
    seedStore();

    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    // Immediately after the store seed and BEFORE any handler invocation, the
    // registry getApi seam must NOT have been touched — no boot RPC.
    expect(getApiSpy).not.toHaveBeenCalled();
  });
});

// ─── Case 6: no pairing ──────────────────────────────────────────────────────
describe("get_bittensor_setup_status — (6) no pairing", () => {
  it("no wallet arg AND empty store → FROZEN INVALID_INPUT + hintTool, NO probe fired", async () => {
    // Store is empty (reset in beforeEach); no wallet arg supplied.
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    const openSpy = vi.spyOn(_transport, "open");

    const result = await callTool({});

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("pair_bittensor_ledger");
    expect(result.content[0]?.text ?? "").toMatch(/pair_bittensor_ledger/);
    // The no-pairing precheck returns BEFORE any Promise.allSettled — no probe
    // fired (no RPC getApi, no USB-HID transport open).
    expect(getApiSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});
