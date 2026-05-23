// test/tools-register-btc-multisig-wallet.test.ts — Phase 25 Plan 25-01 Task 2+3
//
// Covers:
//   Task 2: register_btc_multisig_wallet (valid registration, descriptor errors,
//           name length, demo mode, HMAC-less persistence)
//   Task 3: get_btc_multisig_balance + get_btc_multisig_utxos (Esplora fan-out,
//           NOT_FOUND errors, balance aggregation, UTXO list shape)
//
// Seam strategy per CLAUDE.md:
//   - btc-multisig-store: vi.spyOn(_btcMultisigStorage) for fs ops
//   - Esplora: vi.stubGlobal("fetch", ...) at network boundary

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type SpyInstance,
} from "vitest";

// Force memory mode throughout — no real disk writes
beforeAll(() => {
  process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "memory";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

import { _resetBtcMultisigStoreForTesting } from "../src/wallet/btc-multisig-store.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  LedgerBtcAppVersionTooOldError,
  LedgerDeviceNotConnectedError,
  _btcLedgerTransport,
} from "../src/wallet/ledger-btc-transport.js";

// Import the tool registrations to trigger side-effect registration
import "../src/tools/register_btc_multisig_wallet.js";
import "../src/tools/get_btc_multisig_balance.js";
import "../src/tools/get_btc_multisig_utxos.js";

import { getRegisteredTool } from "../src/tools/index.js";

import {
  VERIFY_ON_DEVICE_MULTISIG_TEMPLATE,
} from "../src/tools/register_btc_multisig_wallet.js";

// Convenience helper — mirrors the pattern in get-btc-account-balance.test.ts
function getToolHandler(name: string) {
  const tool = getRegisteredTool(name);
  if (!tool) return undefined;
  return (args: Record<string, unknown>) => tool.handler(args);
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

// BIP-32 test vector xpubs (account-level, from seed 000102030405060708090a0b0c0d0e0f)
const TEST_XPUB_0 = "xpub6C1HVMz946r433QEjZGpYYWYcspxXXBPys5PBGkmQboRXE6RLfFiStEkKbWKCZaPgDrzZh9nUEunxuiuy6MNdw23du2Ek7GoKYMJVH8eK5E";
const TEST_XPUB_1 = "xpub6C1HVMz946r45SLqXksZWuaVdbpznU1s5peogGPTXqkHcXChkh7TN9vC2mgcSFkdA5YpX94xfAPWZTPoDJhGbUdVwF13RfkY9ioGHSLEuUE";
const TEST_XPUB_2 = "xpub6C1HVMz946r488Vd17BsrsybenwSabqNkg5b42wvkZKnru8Wzgp56AaLERXpDastZzbDMWFpcEh9TJy64YHEnfRg2Se6Zj4W88srAcemued";

const FP0 = "deadbeef";
const FP1 = "cafebabe";
const FP2 = "12345678";

const VALID_DESCRIPTOR = `wsh(sortedmulti(2,[${FP0}/84'/0'/0']${TEST_XPUB_0}/**,[${FP1}/84'/0'/0']${TEST_XPUB_1}/**,[${FP2}/84'/0'/0']${TEST_XPUB_2}/**))`;

// Known first address for the test descriptor at index 0 (from btc-multisig-address-derivation.test.ts Fixture)
const KNOWN_FIRST_ADDRESS = "bc1q89z49nyykvr86hpyw3h34097336s095suwa2hflyvelsmnvp4xvsfw4cnj";

// ─── Task 2: register_btc_multisig_wallet tests ───────────────────────────────

describe("register_btc_multisig_wallet", () => {
  beforeEach(() => {
    _resetBtcMultisigStoreForTesting();
    // Pin to real-mode deterministically. `delete` alone is insufficient
    // because the resolver falls through to readConfigFile() and, if no
    // ~/.vaultpilot-mcp/config.json exists, lands in `auto-demo` →
    // isDemoMode() returns true and the demo-mode guards refuse.
    // Tests that need demo mode flip this to "true" + _resetDemoModeForTesting.
    process.env["VAULTPILOT_DEMO"] = "false";
    _resetDemoModeForTesting();
  });

  it("valid registration returns 5 addresses and persists HMAC-less record", async () => {
    const handler = getToolHandler("register_btc_multisig_wallet");
    expect(handler).toBeDefined();

    const result = await handler!({ name: "my-vault", descriptor: VALID_DESCRIPTOR, threshold: 2 });

    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.walletName).toBe("my-vault");
    expect(sc.threshold).toBe(2);
    expect(sc.totalSigners).toBe(3);
    expect(Array.isArray(sc.firstAddresses)).toBe(true);
    expect((sc.firstAddresses as string[]).length).toBe(5);
    // First address matches hardcoded fixture
    expect((sc.firstAddresses as string[])[0]).toBe(KNOWN_FIRST_ADDRESS);
    // No walletHmac — HMAC-less plan
    expect(sc.walletHmac).toBeNull();
    // Descriptor surfaced verbatim per CLAUDE.md
    expect(sc.descriptor).toBe(VALID_DESCRIPTOR);
  });

  it("response text contains VERIFY-ON-DEVICE block with correct template substitutions", async () => {
    const handler = getToolHandler("register_btc_multisig_wallet")!;
    const result = await handler({ name: "vault-check", descriptor: VALID_DESCRIPTOR, threshold: 2 });

    const text = (result.content[0] as { type: string; text: string }).text;

    // The VERIFY-ON-DEVICE block should appear in the response
    expect(text).toContain("VERIFY ON DEVICE (BTC — multisig wallet registration)");
    expect(text).toContain("vault-check");
    expect(text).toContain("2-of-3");
    expect(text).toContain(KNOWN_FIRST_ADDRESS);

    // Verify we used the same substitution approach as the template
    const sc = result.structuredContent as Record<string, unknown>;
    const expectedBlock = VERIFY_ON_DEVICE_MULTISIG_TEMPLATE
      .replace("{WALLET_NAME}", "vault-check")
      .replace("{THRESHOLD}", "2")
      .replace("{TOTAL_SIGNERS}", "3")
      .replace("{ADDRESS_ROWS}", (sc.firstAddresses as string[])
        .map((addr: string, idx: number) => `  [${idx}] ${addr}`)
        .join("\n"));
    expect(text).toContain(expectedBlock);
  });

  it("persisted record has no walletHmac field", async () => {
    const handler = getToolHandler("register_btc_multisig_wallet")!;
    await handler({ name: "hmac-test", descriptor: VALID_DESCRIPTOR, threshold: 2 });

    const { loadMultisigWallet } = await import("../src/wallet/btc-multisig-store.js");
    const record = loadMultisigWallet("hmac-test");
    expect(record).toBeDefined();
    expect(record?.walletHmac).toBeUndefined();
  });

  it("malformed descriptor → MULTISIG_DESCRIPTOR_INVALID", async () => {
    const handler = getToolHandler("register_btc_multisig_wallet")!;
    const result = await handler({ name: "bad", descriptor: "not-a-descriptor", threshold: 1 });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("MULTISIG_DESCRIPTOR_INVALID");
  });

  it("M > N descriptor → MULTISIG_DESCRIPTOR_INVALID", async () => {
    // 3-of-2 — M > N
    const badDesc = `wsh(sortedmulti(3,[${FP0}/84'/0'/0']${TEST_XPUB_0}/**,[${FP1}/84'/0'/0']${TEST_XPUB_1}/**))`;
    const handler = getToolHandler("register_btc_multisig_wallet")!;
    const result = await handler({ name: "bad", descriptor: badDesc, threshold: 3 });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("MULTISIG_DESCRIPTOR_INVALID");
  });

  it("threshold arg mismatch with descriptor M → MULTISIG_DESCRIPTOR_INVALID", async () => {
    const handler = getToolHandler("register_btc_multisig_wallet")!;
    // Descriptor has M=2 but we pass threshold=3
    const result = await handler({ name: "mismatch", descriptor: VALID_DESCRIPTOR, threshold: 3 });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("MULTISIG_DESCRIPTOR_INVALID");
  });

  it("name with 17 characters → INVALID_INPUT (exceeds Ledger 16-byte limit)", async () => {
    const handler = getToolHandler("register_btc_multisig_wallet")!;
    const result = await handler({ name: "12345678901234567", descriptor: VALID_DESCRIPTOR, threshold: 2 });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("name with exactly 16 characters → succeeds", async () => {
    const handler = getToolHandler("register_btc_multisig_wallet")!;
    const result = await handler({ name: "1234567890123456", descriptor: VALID_DESCRIPTOR, threshold: 2 });

    expect(result.isError).toBeFalsy();
  });

  it("demo mode → DEMO_MODE_REFUSED", async () => {
    process.env["VAULTPILOT_DEMO"] = "true";
    _resetDemoModeForTesting(); // reset cached resolution
    try {
      const handler = getToolHandler("register_btc_multisig_wallet")!;
      const result = await handler({ name: "demo", descriptor: VALID_DESCRIPTOR, threshold: 2 });

      expect(result.isError).toBe(true);
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.errorCode).toBe("DEMO_MODE_REFUSED");
    } finally {
      // Restore pinned real-mode (the file-wide beforeEach sets "false").
      process.env["VAULTPILOT_DEMO"] = "false";
      _resetDemoModeForTesting(); // restore for subsequent tests
    }
  });

  it("descriptor with /* suffix → MULTISIG_DESCRIPTOR_INVALID (Pitfall 6)", async () => {
    const badDesc = `wsh(sortedmulti(2,[${FP0}/84'/0'/0']${TEST_XPUB_0}/*,[${FP1}/84'/0'/0']${TEST_XPUB_1}/**))`;
    const handler = getToolHandler("register_btc_multisig_wallet")!;
    const result = await handler({ name: "pf6", descriptor: badDesc, threshold: 2 });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("MULTISIG_DESCRIPTOR_INVALID");
  });

  it("force flag is accepted and does not cause an error (reserved for Plan 25-03)", async () => {
    const handler = getToolHandler("register_btc_multisig_wallet")!;
    const result = await handler({ name: "force-test", descriptor: VALID_DESCRIPTOR, threshold: 2, force: true });

    expect(result.isError).toBeFalsy();
  });
});

// ─── Plan 25-03: register_btc_multisig_wallet on-device transport paths ──────

describe("register_btc_multisig_wallet — on-device registration (Plan 25-03)", () => {
  beforeEach(() => {
    _resetBtcMultisigStoreForTesting();
    // Pin to real-mode deterministically. `delete` alone is insufficient
    // because the resolver falls through to readConfigFile() and, if no
    // ~/.vaultpilot-mcp/config.json exists, lands in `auto-demo` →
    // isDemoMode() returns true and the demo-mode guards refuse.
    // Tests that need demo mode flip this to "true" + _resetDemoModeForTesting.
    process.env["VAULTPILOT_DEMO"] = "false";
    _resetDemoModeForTesting();
  });

  it("device-present path: stores walletHmac when registerBtcMultisigWallet succeeds", async () => {
    const FAKE_HMAC = "deadbeefcafebabe".repeat(4); // 64 hex chars = 32 bytes
    const spy = vi.spyOn(_btcLedgerTransport, "registerBtcMultisigWallet").mockResolvedValue({
      walletHmacHex: FAKE_HMAC,
    });

    const handler = getToolHandler("register_btc_multisig_wallet")!;
    const result = await handler({ name: "my-vault", descriptor: VALID_DESCRIPTOR, threshold: 2 });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.walletHmac).toBe(FAKE_HMAC);

    // Verify the record was persisted with walletHmac
    const { loadMultisigWallet } = await import("../src/wallet/btc-multisig-store.js");
    const record = loadMultisigWallet("my-vault");
    expect(record?.walletHmac).toBe(FAKE_HMAC);

    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("device-absent path: stores HMAC-less when LedgerDeviceNotConnectedError thrown", async () => {
    const spy = vi.spyOn(_btcLedgerTransport, "registerBtcMultisigWallet").mockRejectedValue(
      new LedgerDeviceNotConnectedError(),
    );

    const handler = getToolHandler("register_btc_multisig_wallet")!;
    const result = await handler({ name: "no-device", descriptor: VALID_DESCRIPTOR, threshold: 2 });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    // walletHmac absent when device not connected
    expect(sc.walletHmac).toBeNull();

    // Verify record stored without walletHmac
    const { loadMultisigWallet } = await import("../src/wallet/btc-multisig-store.js");
    const record = loadMultisigWallet("no-device");
    expect(record?.walletHmac).toBeUndefined();

    // Response text should mention re-registration needed
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toMatch(/HMAC-less|re-run register/i);

    spy.mockRestore();
  });

  it("app-too-old path: returns LEDGER_BTC_APP_VERSION_TOO_OLD", async () => {
    const spy = vi.spyOn(_btcLedgerTransport, "registerBtcMultisigWallet").mockRejectedValue(
      new LedgerBtcAppVersionTooOldError(),
    );

    const handler = getToolHandler("register_btc_multisig_wallet")!;
    const result = await handler({ name: "old-app", descriptor: VALID_DESCRIPTOR, threshold: 2 });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("LEDGER_BTC_APP_VERSION_TOO_OLD");

    spy.mockRestore();
  });

  it("force=true: stores HMAC-less without calling registerBtcMultisigWallet", async () => {
    const spy = vi.spyOn(_btcLedgerTransport, "registerBtcMultisigWallet").mockResolvedValue({
      walletHmacHex: "deadbeef".repeat(8),
    });

    const handler = getToolHandler("register_btc_multisig_wallet")!;
    const result = await handler({ name: "force-hmac", descriptor: VALID_DESCRIPTOR, threshold: 2, force: true });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    // force=true → HMAC-less even though transport spy would return one
    expect(sc.walletHmac).toBeNull();

    // Transport function NOT called when force=true
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});

// ─── Task 3: get_btc_multisig_balance tests ───────────────────────────────────

describe("get_btc_multisig_balance", () => {
  beforeEach(() => {
    _resetBtcMultisigStoreForTesting();
    // Pin to real-mode deterministically. `delete` alone is insufficient
    // because the resolver falls through to readConfigFile() and, if no
    // ~/.vaultpilot-mcp/config.json exists, lands in `auto-demo` →
    // isDemoMode() returns true and the demo-mode guards refuse.
    // Tests that need demo mode flip this to "true" + _resetDemoModeForTesting.
    process.env["VAULTPILOT_DEMO"] = "false";
    _resetDemoModeForTesting();
  });

  it("MULTISIG_WALLET_NOT_FOUND for unregistered walletName", async () => {
    const handler = getToolHandler("get_btc_multisig_balance")!;
    const result = await handler({ walletName: "nonexistent-wallet" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("MULTISIG_WALLET_NOT_FOUND");
  });

  it("INVALID_INPUT for empty walletName", async () => {
    const handler = getToolHandler("get_btc_multisig_balance")!;
    const result = await handler({ walletName: "" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("aggregates balance across ≥ 2 derived addresses", async () => {
    // Register a wallet first
    const regHandler = getToolHandler("register_btc_multisig_wallet")!;
    await regHandler({ name: "balance-test", descriptor: VALID_DESCRIPTOR, threshold: 2 });

    // Stub Esplora fetch: first 2 addresses have balance, rest are empty
    let fetchCallCount = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      fetchCallCount++;
      const urlStr = String(url);

      // Return balance for first 2 addresses, empty for rest
      if (urlStr.includes(KNOWN_FIRST_ADDRESS) && !urlStr.includes("/utxo")) {
        return {
          ok: true,
          json: async () => ({
            address: KNOWN_FIRST_ADDRESS,
            chain_stats: { funded_txo_sum: 1000000, spent_txo_sum: 0, tx_count: 2 },
            mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
          }),
          status: 200,
        };
      }
      // All other addresses: empty (tx_count=0 triggers gap-limit stop)
      return {
        ok: true,
        json: async () => ({
          address: "bc1qempty",
          chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
        }),
        status: 200,
      };
    });

    const handler = getToolHandler("get_btc_multisig_balance")!;
    const result = await handler({ walletName: "balance-test" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.totalConfirmedSats).toBeDefined();
    // At least 1 address had balance (1,000,000 sats)
    expect(BigInt(sc.totalConfirmedSats as string)).toBeGreaterThanOrEqual(1000000n);
  });
});

// ─── Task 3: get_btc_multisig_utxos tests ────────────────────────────────────

describe("get_btc_multisig_utxos", () => {
  beforeEach(() => {
    _resetBtcMultisigStoreForTesting();
    // Pin to real-mode deterministically. `delete` alone is insufficient
    // because the resolver falls through to readConfigFile() and, if no
    // ~/.vaultpilot-mcp/config.json exists, lands in `auto-demo` →
    // isDemoMode() returns true and the demo-mode guards refuse.
    // Tests that need demo mode flip this to "true" + _resetDemoModeForTesting.
    process.env["VAULTPILOT_DEMO"] = "false";
    _resetDemoModeForTesting();
  });

  it("MULTISIG_WALLET_NOT_FOUND for unregistered walletName", async () => {
    const handler = getToolHandler("get_btc_multisig_utxos")!;
    const result = await handler({ walletName: "does-not-exist" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("MULTISIG_WALLET_NOT_FOUND");
  });

  it("INVALID_INPUT for empty walletName", async () => {
    const handler = getToolHandler("get_btc_multisig_utxos")!;
    const result = await handler({ walletName: "" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("returns UTXO list with expected shape (txid, vout, value, address, scriptpubkey)", async () => {
    // Register a wallet first
    const regHandler = getToolHandler("register_btc_multisig_wallet")!;
    await regHandler({ name: "utxo-test", descriptor: VALID_DESCRIPTOR, threshold: 2 });

    // Stub Esplora fetch for /address/ and /address/utxo
    vi.stubGlobal("fetch", async (url: string) => {
      const urlStr = String(url);

      if (urlStr.includes("/utxo")) {
        // Return UTXOs for the first address
        if (urlStr.includes(KNOWN_FIRST_ADDRESS)) {
          return {
            ok: true,
            json: async () => [
              {
                txid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                vout: 0,
                value: 500000,
                status: { confirmed: true, block_height: 800000 },
              },
              {
                txid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                vout: 1,
                value: 300000,
                status: { confirmed: true, block_height: 800001 },
              },
            ],
            status: 200,
          };
        }
        // Other addresses: empty UTXOs
        return { ok: true, json: async () => [], status: 200 };
      }

      // Address info endpoint — has tx for first address
      if (urlStr.includes(KNOWN_FIRST_ADDRESS)) {
        return {
          ok: true,
          json: async () => ({
            address: KNOWN_FIRST_ADDRESS,
            chain_stats: { funded_txo_sum: 800000, spent_txo_sum: 0, tx_count: 2 },
            mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
          }),
          status: 200,
        };
      }
      // Empty for others
      return {
        ok: true,
        json: async () => ({
          address: "bc1qempty",
          chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
        }),
        status: 200,
      };
    });

    const handler = getToolHandler("get_btc_multisig_utxos")!;
    const result = await handler({ walletName: "utxo-test" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    const utxos = sc.utxos as Array<Record<string, unknown>>;
    expect(Array.isArray(utxos)).toBe(true);
    expect(utxos.length).toBeGreaterThan(0);

    // Check UTXO shape: txid, vout, value, address, scriptpubkey expected
    const utxo = utxos[0]!;
    expect(typeof utxo.txid).toBe("string");
    expect(typeof utxo.vout).toBe("number");
    // value as string (bigint serialized) or number — tool decides
    expect(utxo.value !== undefined).toBe(true);
    expect(utxo.address).toBe(KNOWN_FIRST_ADDRESS);
  });

  it("UTXOs from ≥ 2 derived addresses are aggregated", async () => {
    // Register a wallet
    const regHandler = getToolHandler("register_btc_multisig_wallet")!;
    await regHandler({ name: "multi-utxo-test", descriptor: VALID_DESCRIPTOR, threshold: 2 });

    // We need 2 specific addresses to stub — derive them
    const { deriveMultisigAddress, extractXpubFromKeyExpr, parseWshSortedMulti } =
      await import("../src/wallet/btc-multisig-store.js");
    const parsed = parseWshSortedMulti(VALID_DESCRIPTOR)!;
    const xpubs = parsed.keys.map((k) => extractXpubFromKeyExpr(k).xpub);
    const addr0 = deriveMultisigAddress(xpubs, 2, 0);
    const addr1 = deriveMultisigAddress(xpubs, 2, 1);

    vi.stubGlobal("fetch", async (url: string) => {
      const urlStr = String(url);

      if (urlStr.includes("/utxo")) {
        if (urlStr.includes(addr0)) {
          return { ok: true, json: async () => [{ txid: "aa".repeat(32), vout: 0, value: 100000, status: { confirmed: true, block_height: 800000 } }], status: 200 };
        }
        if (urlStr.includes(addr1)) {
          return { ok: true, json: async () => [{ txid: "bb".repeat(32), vout: 0, value: 200000, status: { confirmed: true, block_height: 800001 } }], status: 200 };
        }
        return { ok: true, json: async () => [], status: 200 };
      }

      if (urlStr.includes(addr0)) {
        return { ok: true, json: async () => ({ address: addr0, chain_stats: { funded_txo_sum: 100000, spent_txo_sum: 0, tx_count: 1 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } }), status: 200 };
      }
      if (urlStr.includes(addr1)) {
        return { ok: true, json: async () => ({ address: addr1, chain_stats: { funded_txo_sum: 200000, spent_txo_sum: 0, tx_count: 1 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } }), status: 200 };
      }
      return { ok: true, json: async () => ({ address: "empty", chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } }), status: 200 };
    });

    const handler = getToolHandler("get_btc_multisig_utxos")!;
    const result = await handler({ walletName: "multi-utxo-test" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    const utxos = sc.utxos as Array<Record<string, unknown>>;
    // Should have UTXOs from both addr0 and addr1
    expect(utxos.length).toBeGreaterThanOrEqual(2);
  });
});
