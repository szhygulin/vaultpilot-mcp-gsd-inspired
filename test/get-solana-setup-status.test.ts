// Phase 16 Plan 16-01 — get_solana_setup_status tool tests (SOL-DIAG-01).
//
// Lazy 3-arm demote-to-null diagnostic, cloned 1:1 from get_tron_setup_status.
// Arms:
//   (1) all arms succeed → every field populated
//   (2) RPC arm rejects/times out → nonce/marginfi/kamino safe-default false +
//       rpcDegraded.reason; device fields still populated
//   (3) device arm rejects/times out → walletPublicKeyOnDevice:null +
//       ledgerSolAppVersion:null + deviceStatus.reason; RPC fields still populated
//   (4) no wallet arg AND no PAIR-NEV store record → INVALID_INPUT refusal
//   (5) module-load grep guard — tool source contains NO `createHandle` import
//       (read-only by construction; mirrors Phase 7 T-SIMULATE-NO-HANDLE-1)
//
// Spy strategy (CLAUDE.md ESM spy-affordance convention):
// - `_marginfiChain.getRawAccountInfo` / `_kaminoChain.getRawAccountInfo` — the
//   indirection seams; mocking them keeps the RPC boundary OFF (NO-LIVE-RPC).
// - `_solanaRegistry.getConnection` — mocked so the nonce `getAccountInfo` probe
//   never opens a live Connection (NO-LIVE-RPC).
// - `fetchSolanaAddress` — mocked at the USB-HID transport export (NO-LIVE-HID).
//   ESM named export; spied via the module-namespace object below.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as ledgerSolana from "../src/wallet/ledger-solana-transport.js";
import { _marginfiChain } from "../src/chains/solana/marginfi.js";
import { _kaminoChain } from "../src/chains/solana/kamino.js";
import { _solanaRegistry } from "../src/chains/solana/registry.js";
import {
  _resetNonEvmStoreForTesting,
  saveAccount,
} from "../src/wallet/non-evm-account-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

// Register the tool (side-effect import)
await import("../src/tools/get_solana_setup_status.js");

// ─── Fixtures ──────────────────────────────────────────────────────────────────
const STORE_ADDRESS = "7gxcsRkHzkbqfQwjV2eDdmCkK8gPjVf9YpY5fG5L8aBc";
const DEVICE_ADDRESS = STORE_ADDRESS; // same as store in the happy path
const DERIVATION_PATH = "44'/501'/0'";
const APP_VERSION = "1.4.0";
const PAIRED_AT = "2026-05-20T10:00:00.000Z";
const LEDGER_NOT_CONNECTED = new ledgerSolana.LedgerDeviceNotConnectedError();

// A minimal NonceAccount-shaped account-info data buffer is not needed: the
// nonce probe demotes to `false` safely when parse fails. The marginfi/kamino
// arms are the deterministic PDA-presence probes covered here.

async function callTool(args: Record<string, unknown> = {}): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_solana_setup_status");
  if (!tool) throw new Error("get_solana_setup_status not registered");
  return tool.handler(args);
}

function mockDeviceOk(): void {
  vi.spyOn(ledgerSolana, "fetchSolanaAddress").mockResolvedValue({
    address: DEVICE_ADDRESS,
    rawPubkey: Buffer.alloc(32),
    appVersion: APP_VERSION,
  });
}

// RPC arm spies: marginfi + kamino indirection + a fake Connection for the nonce probe.
function mockRpcPresent(): void {
  vi.spyOn(_marginfiChain, "getRawAccountInfo").mockResolvedValue({
    data: Buffer.alloc(8),
  });
  vi.spyOn(_kaminoChain, "getRawAccountInfo").mockResolvedValue({
    data: Buffer.alloc(8),
  });
  // Connection.getAccountInfo for the nonce probe — return null (no nonce acct).
  vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue({
    getAccountInfo: vi.fn().mockResolvedValue(null),
  } as unknown as ReturnType<typeof _solanaRegistry.getConnection>);
}

beforeEach(() => {
  _resetNonEvmStoreForTesting();
  vi.restoreAllMocks();
});

afterEach(() => {
  _resetNonEvmStoreForTesting();
  vi.restoreAllMocks();
});

// ─── Arm 1: all arms succeed ────────────────────────────────────────────────────
describe("get_solana_setup_status — (1) all arms succeed", () => {
  it("populates every field from the three probes", async () => {
    saveAccount({
      chain: "solana",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });
    mockRpcPresent();
    mockDeviceOk();

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("solana");
    expect(sc.walletAddress).toBe(STORE_ADDRESS);
    expect(sc.marginfiAccountPresent).toBe(true);
    expect(sc.kaminoObligationPresent).toBe(true);
    expect(sc.nonceAccountPresent).toBe(false); // no nonce acct in this fixture
    expect(sc.ledgerSolAppVersion).toBe(APP_VERSION);
    expect(sc.walletPublicKeyOnDevice).toBe(DEVICE_ADDRESS);
    expect(sc.rpcDegraded).toBeUndefined();
    expect(sc.deviceStatus).toBeUndefined();
  });
});

// ─── Arm 2: RPC arm fails ───────────────────────────────────────────────────────
describe("get_solana_setup_status — (2) RPC arm rejects", () => {
  it("safe-defaults presence flags false + rpcDegraded; device fields still populated", async () => {
    saveAccount({
      chain: "solana",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });
    vi.spyOn(_marginfiChain, "getRawAccountInfo").mockRejectedValue(
      new Error("RPC 503"),
    );
    vi.spyOn(_kaminoChain, "getRawAccountInfo").mockRejectedValue(
      new Error("RPC 503"),
    );
    vi.spyOn(_solanaRegistry, "getConnection").mockImplementation(() => {
      throw new Error("RPC 503");
    });
    mockDeviceOk();

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.nonceAccountPresent).toBe(false);
    expect(sc.marginfiAccountPresent).toBe(false);
    expect(sc.kaminoObligationPresent).toBe(false);
    const rpcDegraded = sc.rpcDegraded as { reason: string } | undefined;
    expect(rpcDegraded).toBeDefined();
    expect(rpcDegraded?.reason).toMatch(/RPC/);
    // device arm ran independently
    expect(sc.walletPublicKeyOnDevice).toBe(DEVICE_ADDRESS);
    expect(sc.ledgerSolAppVersion).toBe(APP_VERSION);
    expect(sc.deviceStatus).toBeUndefined();
  });
});

// ─── Arm 3: device arm fails ────────────────────────────────────────────────────
describe("get_solana_setup_status — (3) device arm rejects", () => {
  it("nulls device fields + deviceStatus; RPC fields still populated", async () => {
    saveAccount({
      chain: "solana",
      address: STORE_ADDRESS,
      derivationPath: DERIVATION_PATH,
      pairedAt: PAIRED_AT,
    });
    mockRpcPresent();
    vi.spyOn(ledgerSolana, "fetchSolanaAddress").mockRejectedValue(
      LEDGER_NOT_CONNECTED,
    );

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.walletPublicKeyOnDevice).toBeNull();
    expect(sc.ledgerSolAppVersion).toBeNull();
    const deviceStatus = sc.deviceStatus as { reason: string } | undefined;
    expect(deviceStatus).toBeDefined();
    expect(deviceStatus?.reason).toMatch(/disconnected|device/);
    // RPC arm ran independently
    expect(sc.marginfiAccountPresent).toBe(true);
    expect(sc.kaminoObligationPresent).toBe(true);
    expect(sc.rpcDegraded).toBeUndefined();
  });
});

// ─── Arm 4: no wallet arg AND no store record → INVALID_INPUT ───────────────────
describe("get_solana_setup_status — (4) no pairing + no wallet arg", () => {
  it("returns INVALID_INPUT + hintTool when no record and no wallet provided", async () => {
    const result = await callTool({});

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("pair_solana_ledger");
    expect(result.content[0]?.text ?? "").toMatch(/pair_solana_ledger/);
  });
});

// ─── Arm 5: module-load grep guard — NO createHandle import ──────────────────────
describe("get_solana_setup_status — (5) read-only by construction", () => {
  it("the tool source contains no createHandle import (no write path)", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/tools/get_solana_setup_status.ts", import.meta.url)),
      "utf8",
    );
    expect(/createHandle/.test(src)).toBe(false);
  });
});
