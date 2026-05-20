// Phase 21 Plan 21-01 — get_tron_setup_status tool tests (TRON-DIAG-01).
//
// 9 test arms covering the D-01a surface contract:
//   (1) Happy path — paired, device reachable, Stake 2.0 Energy frozen
//   (2) addressVerified: false — device returns a DIFFERENT address
//   (3) Bandwidth-only via missing `type` field (D-01d default rule)
//   (4) Both Energy + Bandwidth frozen simultaneously
//   (5) Empty frozenV2 array — account exists, no Stake 2.0 freezes
//   (6) Account does not exist on chain (TronGrid returns {})
//   (7) RPC failure arm — TronGrid getAccount rejects
//   (8) USB-HID failure arm — fetchTronAddress throws LedgerDeviceNotConnectedError
//   (9) Explicit wallet arg override — wallet arg wins over store record
//
// Spy strategy (per CLAUDE.md ESM spy-affordance convention):
// - `_tronRegistry.getTronWeb` — spy-affordance object in registry.ts; used
//   to mock TronGrid getAccount WITHOUT triggering boot-time RPC calls.
// - `_tronLedgerTransport.fetchTronAddress` — ADDITIVELY widened in
//   ledger-tron-transport.ts for Plan 21-01; vi.spyOn intercepts cleanly
//   across the ESM module boundary.
// - `_resetNonEvmStoreForTesting` — clears the in-memory PAIR-NEV-store
//   between test arms; `saveAccount` seeds it per-arm.
//
// Do NOT `vi.mock()` the entire tronweb or ledger module — that defeats the
// spy seam and breaks the lazy-probe assertion in server-bootstrap.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _tronRegistry } from "../src/chains/tron/registry.js";
import {
  LedgerDeviceNotConnectedError,
  LedgerTronAppNotOpenError,
  _tronLedgerTransport,
} from "../src/wallet/ledger-tron-transport.js";
import {
  _resetNonEvmStoreForTesting,
  saveAccount,
} from "../src/wallet/non-evm-account-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

// Register the tool (side-effect import)
await import("../src/tools/get_tron_setup_status.js");

// ─── Fixtures ──────────────────────────────────────────────────────────────────
const STORE_ADDRESS = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const DEVICE_ADDRESS = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb"; // same as store in happy path
const DIFFERENT_DEVICE_ADDRESS = "TFakeABCDEFGHIJKLMNOPQRSTUVWXYZ123";
const EXPLICIT_WALLET = "TExplicitOverrideAddressNotInStore_XYZ";
const DERIVATION_PATH = "44'/195'/0'/0/0";
const PUBLIC_KEY = "04aabbccdd0011223344556677889900aabbccdd0011223344556677889900aabbcc";
const APP_VERSION = "0.5.0";
const PAIRED_AT = "2026-05-20T10:00:00.000Z";

// ─── Helper: invoke tool ───────────────────────────────────────────────────────
async function callTool(args: Record<string, unknown> = {}): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_tron_setup_status");
  if (!tool) throw new Error("get_tron_setup_status not registered");
  return tool.handler(args);
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

// ─── Arm 1: Happy path ────────────────────────────────────────────────────────
describe("get_tron_setup_status — (1) happy path", () => {
  it("returns D-01a shape with Energy frozen, addressVerified:true", async () => {
    // Seed PAIR-NEV-store with TRON record
    saveAccount({
      chain: "tron",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });

    // Mock TronGrid getAccount — Energy frozen 1 TRX (1_000_000_000 SUN)
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({
      trx: {
        getAccount: vi.fn().mockResolvedValue({
          frozenV2: [{ type: "ENERGY", amount: 1_000_000_000 }],
          address: STORE_ADDRESS,
        }),
      },
    } as unknown as ReturnType<typeof _tronRegistry.getTronWeb>);

    // Mock Ledger USB-HID probe via _tronLedgerTransport.fetchTronAddress
    vi.spyOn(_tronLedgerTransport, "fetchTronAddress").mockResolvedValue({
      address: DEVICE_ADDRESS,
      publicKey: PUBLIC_KEY,
      appVersion: APP_VERSION,
    });

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("tron");
    expect(sc.walletAddress).toBe(STORE_ADDRESS);
    expect(sc.ledgerTrxAppVersion).toBe(APP_VERSION);
    expect(sc.walletAddressOnDevice).toBe(DEVICE_ADDRESS);
    expect(sc.addressVerified).toBe(true);
    expect(sc.resourceAccountPresent).toBe(true);
    expect(sc.frozenEnergyAmount).toBe("1000000000");
    expect(sc.frozenBandwidthAmount).toBe("0");
    expect(sc.rpcDegraded).toBeUndefined();
    expect(sc.deviceStatus).toBeUndefined();
  });
});

// ─── Arm 2: addressVerified: false ────────────────────────────────────────────
describe("get_tron_setup_status — (2) addressVerified:false arm", () => {
  it("detects T-PAIRING-DRIFT when device returns a different address", async () => {
    saveAccount({
      chain: "tron",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });

    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({
      trx: {
        getAccount: vi.fn().mockResolvedValue({
          frozenV2: [],
          address: STORE_ADDRESS,
        }),
      },
    } as unknown as ReturnType<typeof _tronRegistry.getTronWeb>);

    // Device returns a DIFFERENT address — T-PAIRING-DRIFT scenario
    vi.spyOn(_tronLedgerTransport, "fetchTronAddress").mockResolvedValue({
      address: DIFFERENT_DEVICE_ADDRESS,
      publicKey: PUBLIC_KEY,
      appVersion: APP_VERSION,
    });

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.walletAddress).toBe(STORE_ADDRESS);
    expect(sc.walletAddressOnDevice).toBe(DIFFERENT_DEVICE_ADDRESS);
    expect(sc.addressVerified).toBe(false); // strict-equality fails
    expect(sc.rpcDegraded).toBeUndefined();
    expect(sc.deviceStatus).toBeUndefined();
  });
});

// ─── Arm 3: Bandwidth-only via missing `type` field ───────────────────────────
describe("get_tron_setup_status — (3) Bandwidth-only via missing type (D-01d)", () => {
  it("defaults to BANDWIDTH when frozenV2 entry has no type field", async () => {
    saveAccount({
      chain: "tron",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });

    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({
      trx: {
        getAccount: vi.fn().mockResolvedValue({
          // No `type` field — per D-01d, this defaults to BANDWIDTH
          frozenV2: [{ amount: 500_000_000 }],
          address: STORE_ADDRESS,
        }),
      },
    } as unknown as ReturnType<typeof _tronRegistry.getTronWeb>);

    vi.spyOn(_tronLedgerTransport, "fetchTronAddress").mockResolvedValue({
      address: DEVICE_ADDRESS,
      publicKey: PUBLIC_KEY,
      appVersion: APP_VERSION,
    });

    const result = await callTool({});

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.frozenEnergyAmount).toBe("0");
    expect(sc.frozenBandwidthAmount).toBe("500000000");
    expect(sc.resourceAccountPresent).toBe(true);
    expect(sc.rpcDegraded).toBeUndefined();
  });
});

// ─── Arm 4: Both Energy + Bandwidth ───────────────────────────────────────────
describe("get_tron_setup_status — (4) Both Energy + Bandwidth frozen", () => {
  it("surfaces separate Energy and Bandwidth amounts correctly", async () => {
    saveAccount({
      chain: "tron",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });

    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({
      trx: {
        getAccount: vi.fn().mockResolvedValue({
          frozenV2: [
            { type: "ENERGY", amount: 1000 },
            { type: "BANDWIDTH", amount: 2000 },
          ],
          address: STORE_ADDRESS,
        }),
      },
    } as unknown as ReturnType<typeof _tronRegistry.getTronWeb>);

    vi.spyOn(_tronLedgerTransport, "fetchTronAddress").mockResolvedValue({
      address: DEVICE_ADDRESS,
      publicKey: PUBLIC_KEY,
      appVersion: APP_VERSION,
    });

    const result = await callTool({});

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.frozenEnergyAmount).toBe("1000");
    expect(sc.frozenBandwidthAmount).toBe("2000");
    expect(sc.resourceAccountPresent).toBe(true);
  });
});

// ─── Arm 5: Empty frozenV2 array ──────────────────────────────────────────────
describe("get_tron_setup_status — (5) Empty frozenV2 array", () => {
  it("resourceAccountPresent:true when account exists but no Stake 2.0 freezes", async () => {
    saveAccount({
      chain: "tron",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });

    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({
      trx: {
        getAccount: vi.fn().mockResolvedValue({
          frozenV2: [], // empty — account exists, no Stake 2.0 freezes
          address: STORE_ADDRESS,
          balance: 1000000,
        }),
      },
    } as unknown as ReturnType<typeof _tronRegistry.getTronWeb>);

    vi.spyOn(_tronLedgerTransport, "fetchTronAddress").mockResolvedValue({
      address: DEVICE_ADDRESS,
      publicKey: PUBLIC_KEY,
      appVersion: APP_VERSION,
    });

    const result = await callTool({});

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.frozenEnergyAmount).toBe("0");
    expect(sc.frozenBandwidthAmount).toBe("0");
    expect(sc.resourceAccountPresent).toBe(true); // account exists (non-empty response)
    expect(sc.rpcDegraded).toBeUndefined();
  });
});

// ─── Arm 6: Account does not exist on chain ───────────────────────────────────
describe("get_tron_setup_status — (6) Account never-touched on chain", () => {
  it("resourceAccountPresent:false when TronGrid returns {} (never-touched address)", async () => {
    saveAccount({
      chain: "tron",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });

    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({
      trx: {
        // TronGrid returns empty object for never-touched addresses
        // (verified live in Phase 18 RESEARCH)
        getAccount: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ReturnType<typeof _tronRegistry.getTronWeb>);

    vi.spyOn(_tronLedgerTransport, "fetchTronAddress").mockResolvedValue({
      address: DEVICE_ADDRESS,
      publicKey: PUBLIC_KEY,
      appVersion: APP_VERSION,
    });

    const result = await callTool({});

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.resourceAccountPresent).toBe(false);
    expect(sc.frozenEnergyAmount).toBe("0");
    expect(sc.frozenBandwidthAmount).toBe("0");
    // NO rpcDegraded — this is normal not-yet-active-on-chain state, not an error
    expect(sc.rpcDegraded).toBeUndefined();
    expect(sc.addressVerified).toBe(true); // device probe still runs
  });
});

// ─── Arm 7: RPC failure ───────────────────────────────────────────────────────
describe("get_tron_setup_status — (7) TronGrid RPC failure arm", () => {
  it("sets rpcDegraded.reason and safe defaults; device probe runs independently", async () => {
    saveAccount({
      chain: "tron",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });

    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({
      trx: {
        getAccount: vi.fn().mockRejectedValue(new Error("HTTP 503")),
      },
    } as unknown as ReturnType<typeof _tronRegistry.getTronWeb>);

    // Device probe runs INDEPENDENTLY — still succeeds
    vi.spyOn(_tronLedgerTransport, "fetchTronAddress").mockResolvedValue({
      address: DEVICE_ADDRESS,
      publicKey: PUBLIC_KEY,
      appVersion: APP_VERSION,
    });

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    // RPC degraded with explicit reason
    const rpcDegraded = sc.rpcDegraded as { reason: string } | undefined;
    expect(rpcDegraded).toBeDefined();
    expect(rpcDegraded?.reason).toMatch(/TronGrid getAccount failed: HTTP 503/);
    // Safe defaults on RPC failure
    expect(sc.resourceAccountPresent).toBe(false);
    expect(sc.frozenEnergyAmount).toBe("0");
    expect(sc.frozenBandwidthAmount).toBe("0");
    // Device probe ran independently — addressVerified still valid
    expect(sc.walletAddressOnDevice).toBe(DEVICE_ADDRESS);
    expect(sc.addressVerified).toBe(true);
    expect(sc.deviceStatus).toBeUndefined();
  });
});

// ─── Arm 8: USB-HID failure arm ───────────────────────────────────────────────
describe("get_tron_setup_status — (8) USB-HID device failure arm", () => {
  it("LedgerDeviceNotConnectedError → walletAddressOnDevice:null + deviceStatus.reason:disconnected", async () => {
    saveAccount({
      chain: "tron",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });

    // TronGrid probe runs INDEPENDENTLY — still succeeds
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({
      trx: {
        getAccount: vi.fn().mockResolvedValue({
          frozenV2: [{ type: "ENERGY", amount: 5000 }],
          address: STORE_ADDRESS,
        }),
      },
    } as unknown as ReturnType<typeof _tronRegistry.getTronWeb>);

    // Ledger not connected
    vi.spyOn(_tronLedgerTransport, "fetchTronAddress").mockRejectedValue(
      new LedgerDeviceNotConnectedError(),
    );

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.walletAddressOnDevice).toBeNull();
    expect(sc.ledgerTrxAppVersion).toBeNull();
    // addressVerified: false — strict-equality of walletAddress !== null (device unreachable safe default)
    expect(sc.addressVerified).toBe(false);
    // deviceStatus with reason matching disconnected or trx-app-closed
    const deviceStatus = sc.deviceStatus as { reason: string } | undefined;
    expect(deviceStatus).toBeDefined();
    expect(deviceStatus?.reason).toMatch(/disconnected|trx-app-closed/);
    // TronGrid probe ran independently
    expect(sc.frozenEnergyAmount).toBe("5000");
    expect(sc.frozenBandwidthAmount).toBe("0");
    expect(sc.resourceAccountPresent).toBe(true);
    expect(sc.rpcDegraded).toBeUndefined();
  });

  it("LedgerTronAppNotOpenError → deviceStatus.reason:trx-app-closed", async () => {
    saveAccount({
      chain: "tron",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });

    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({
      trx: {
        getAccount: vi.fn().mockResolvedValue({ frozenV2: [], address: STORE_ADDRESS }),
      },
    } as unknown as ReturnType<typeof _tronRegistry.getTronWeb>);

    vi.spyOn(_tronLedgerTransport, "fetchTronAddress").mockRejectedValue(
      new LedgerTronAppNotOpenError(),
    );

    const result = await callTool({});

    const sc = result.structuredContent as Record<string, unknown>;
    const deviceStatus = sc.deviceStatus as { reason: string } | undefined;
    expect(deviceStatus?.reason).toBe("trx-app-closed");
    expect(sc.walletAddressOnDevice).toBeNull();
    expect(sc.ledgerTrxAppVersion).toBeNull();
    expect(sc.addressVerified).toBe(false);
  });
});

// ─── Arm 9: Explicit wallet arg override ──────────────────────────────────────
describe("get_tron_setup_status — (9) explicit wallet arg override", () => {
  it("wallet arg wins over store record; addressVerified reflects device probe vs arg", async () => {
    // Store has a DIFFERENT record — the arg should win
    saveAccount({
      chain: "tron",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });

    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue({
      trx: {
        getAccount: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ReturnType<typeof _tronRegistry.getTronWeb>);

    // Device returns the store address (not the explicit arg) → addressVerified: false
    vi.spyOn(_tronLedgerTransport, "fetchTronAddress").mockResolvedValue({
      address: STORE_ADDRESS, // different from EXPLICIT_WALLET
      publicKey: PUBLIC_KEY,
      appVersion: APP_VERSION,
    });

    const result = await callTool({ wallet: EXPLICIT_WALLET });

    const sc = result.structuredContent as Record<string, unknown>;
    // The explicit wallet arg is used as walletAddress
    expect(sc.walletAddress).toBe(EXPLICIT_WALLET);
    // walletAddressOnDevice is the device's response
    expect(sc.walletAddressOnDevice).toBe(STORE_ADDRESS);
    // addressVerified is strict-equality: EXPLICIT_WALLET !== STORE_ADDRESS
    expect(sc.addressVerified).toBe(false);
  });
});

// ─── Edge: no wallet arg AND no store record → INVALID_INPUT ──────────────────
describe("get_tron_setup_status — (10) no pairing + no wallet arg", () => {
  it("returns INVALID_INPUT + hintTool when no record and no wallet provided", async () => {
    // Store is empty (reset in beforeEach)

    const result = await callTool({});

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("pair_tron_ledger");
    expect(result.content[0]?.text ?? "").toMatch(/pair_tron_ledger/);
  });
});
