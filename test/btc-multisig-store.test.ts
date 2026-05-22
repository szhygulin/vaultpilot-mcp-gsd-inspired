// test/btc-multisig-store.test.ts — Phase 25 Plan 25-01 Task 1
//
// Registry CRUD, atomic-write, 0o600 permissions, memory-mode no-disk,
// drop-invalid-entries behavior.
//
// Uses vi.spyOn against `_btcMultisigStorage` for the fs seam (ESM
// spy-affordance indirection per CLAUDE.md).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Force memory mode for all tests so we never touch the real disk.
beforeEach(() => {
  process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "memory";
});

afterEach(() => {
  delete process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"];
  vi.restoreAllMocks();
});

import {
  _btcMultisigStorage,
  _resetBtcMultisigStoreForTesting,
  loadAllMultisigWallets,
  loadMultisigWallet,
  saveMultisigWallet,
  type BtcMultisigWalletRecord,
} from "../src/wallet/btc-multisig-store.js";

// A minimal valid record for test use
function makeRecord(name: string): BtcMultisigWalletRecord {
  return {
    name,
    descriptor:
      "wsh(sortedmulti(2,[deadbeef/84'/0'/0']xpub6ERApFjqMiEJGmGv6hYGJaXEQKCNebGNRhBFb2ZcUBqkRdEqkqFGvnZvAXhAHHNs4M4f3eMJMJpqBvSEuWRY7T7WEXApJKyTX8V2cEqJxT/**,[cafebabe/84'/0'/0']xpub6EiAtWVWxQFUvZYpLirBtYzCaaSrNcZJ2JBv8Y3tn9fAUYqJvkdRqVZTFjq75L2gjvNYbqPdMz25P3AHRFGp6HNGKEFbRfXMeUy8uFtW8YN/**,[12345678/84'/0'/0']xpub6FHG1P2V3u5xDuJBWfzCcL9K3EuQXXqfxQpRvxAVjA3oVnYJnCmzJC7aBHFz4MGVf1CSmMeVkNSwgp9K3VqP9K5qJ4fN3KfN3oRv8EqJ7i/**))",
    threshold: 2,
    totalSigners: 3,
    keyFingerprints: ["deadbeef", "cafebabe", "12345678"],
    firstAddresses: [
      "bc1qtest1address",
      "bc1qtest2address",
      "bc1qtest3address",
      "bc1qtest4address",
      "bc1qtest5address",
    ],
    registeredAt: "2026-05-22T00:00:00.000Z",
  };
}

describe("btc-multisig-store — CRUD", () => {
  beforeEach(() => {
    _resetBtcMultisigStoreForTesting();
  });

  it("saveMultisigWallet + loadMultisigWallet round-trip", () => {
    const record = makeRecord("test-wallet");
    saveMultisigWallet(record);
    const loaded = loadMultisigWallet("test-wallet");
    expect(loaded).toBeDefined();
    expect(loaded?.name).toBe("test-wallet");
    expect(loaded?.threshold).toBe(2);
    expect(loaded?.totalSigners).toBe(3);
  });

  it("loadMultisigWallet returns undefined for unknown wallet", () => {
    const result = loadMultisigWallet("nonexistent");
    expect(result).toBeUndefined();
  });

  it("saveMultisigWallet upserts on name — second save replaces first", () => {
    const r1 = makeRecord("wallet-a");
    const r2 = { ...makeRecord("wallet-a"), threshold: 1, totalSigners: 1 };
    saveMultisigWallet(r1);
    saveMultisigWallet(r2);
    const all = loadAllMultisigWallets();
    expect(all).toHaveLength(1);
    expect(all[0]?.threshold).toBe(1);
  });

  it("loadAllMultisigWallets returns all stored wallets", () => {
    saveMultisigWallet(makeRecord("wallet-1"));
    saveMultisigWallet(makeRecord("wallet-2"));
    const all = loadAllMultisigWallets();
    expect(all).toHaveLength(2);
  });

  it("walletHmac is optional — record stores without it", () => {
    const record = makeRecord("hmac-less-wallet");
    expect(record.walletHmac).toBeUndefined();
    saveMultisigWallet(record);
    const loaded = loadMultisigWallet("hmac-less-wallet");
    expect(loaded?.walletHmac).toBeUndefined();
  });

  it("walletHmac is preserved when present", () => {
    const record = { ...makeRecord("hmac-wallet"), walletHmac: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" };
    saveMultisigWallet(record);
    const loaded = loadMultisigWallet("hmac-wallet");
    expect(loaded?.walletHmac).toBe("abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
  });
});

describe("btc-multisig-store — atomic write + 0o600", () => {
  beforeEach(() => {
    _resetBtcMultisigStoreForTesting();
  });

  it("persist mode calls writeFileSync with mode 0o600", () => {
    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "persist";
    _resetBtcMultisigStoreForTesting();

    const writeSpy = vi.spyOn(_btcMultisigStorage, "writeFileSync").mockImplementation(() => {});
    const renameSpy = vi.spyOn(_btcMultisigStorage, "renameSync").mockImplementation(() => {});
    vi.spyOn(_btcMultisigStorage, "ensureStorageDirWithPerms").mockImplementation(() => {});

    saveMultisigWallet(makeRecord("atomic-test-wallet"));

    expect(writeSpy).toHaveBeenCalledOnce();
    const callArgs = writeSpy.mock.calls[0];
    // Third arg is the options object with mode
    expect(callArgs?.[2]).toMatchObject({ mode: 0o600 });
    expect(renameSpy).toHaveBeenCalledOnce();

    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "memory";
    _resetBtcMultisigStoreForTesting();
  });

  it("tempfile path uses .tmp.<pid> suffix before rename", () => {
    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "persist";
    _resetBtcMultisigStoreForTesting();

    const paths: string[] = [];
    vi.spyOn(_btcMultisigStorage, "writeFileSync").mockImplementation((p) => {
      paths.push(p as string);
    });
    const renameSpy = vi.spyOn(_btcMultisigStorage, "renameSync").mockImplementation(() => {});
    vi.spyOn(_btcMultisigStorage, "ensureStorageDirWithPerms").mockImplementation(() => {});

    saveMultisigWallet(makeRecord("tempfile-wallet"));

    const tmpPath = paths[0];
    expect(tmpPath).toMatch(/\.tmp\.\d+$/);
    const renameSrcArg = renameSpy.mock.calls[0]?.[0] as string;
    expect(renameSrcArg).toBe(tmpPath);

    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "memory";
    _resetBtcMultisigStoreForTesting();
  });

  it("memory mode: save does NOT call writeFileSync or renameSync", () => {
    // Already in memory mode from outer beforeEach
    const writeSpy = vi.spyOn(_btcMultisigStorage, "writeFileSync");
    const renameSpy = vi.spyOn(_btcMultisigStorage, "renameSync");

    saveMultisigWallet(makeRecord("no-disk-wallet"));

    expect(writeSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
  });
});

describe("btc-multisig-store — validateRecord threshold <= totalSigners", () => {
  beforeEach(() => {
    _resetBtcMultisigStoreForTesting();
  });

  it("persist mode: drops a record where threshold > totalSigners", () => {
    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "persist";
    _resetBtcMultisigStoreForTesting();

    // Tampered record: threshold=10 but totalSigners=2 — impossible invariant
    const tamperedRecord = { ...makeRecord("tampered"), threshold: 10, totalSigners: 2 };
    const diskData = JSON.stringify([tamperedRecord]);

    vi.spyOn(_btcMultisigStorage, "existsSync").mockReturnValue(true);
    vi.spyOn(_btcMultisigStorage, "readFileSync").mockReturnValue(diskData);
    vi.spyOn(_btcMultisigStorage, "writeFileSync").mockImplementation(() => {});
    vi.spyOn(_btcMultisigStorage, "renameSync").mockImplementation(() => {});
    vi.spyOn(_btcMultisigStorage, "ensureStorageDirWithPerms").mockImplementation(() => {});

    const all = loadAllMultisigWallets();
    // The tampered record must be dropped — threshold > totalSigners is invalid
    expect(all).toHaveLength(0);

    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "memory";
    _resetBtcMultisigStoreForTesting();
  });

  it("persist mode: keeps a record where threshold === totalSigners (edge case)", () => {
    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "persist";
    _resetBtcMultisigStoreForTesting();

    // Edge case: 1-of-1 multisig — threshold === totalSigners — is valid
    const oneOfOne = { ...makeRecord("one-of-one"), threshold: 1, totalSigners: 1 };
    const diskData = JSON.stringify([oneOfOne]);

    vi.spyOn(_btcMultisigStorage, "existsSync").mockReturnValue(true);
    vi.spyOn(_btcMultisigStorage, "readFileSync").mockReturnValue(diskData);
    vi.spyOn(_btcMultisigStorage, "writeFileSync").mockImplementation(() => {});
    vi.spyOn(_btcMultisigStorage, "renameSync").mockImplementation(() => {});
    vi.spyOn(_btcMultisigStorage, "ensureStorageDirWithPerms").mockImplementation(() => {});

    const all = loadAllMultisigWallets();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("one-of-one");

    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "memory";
    _resetBtcMultisigStoreForTesting();
  });
});

describe("btc-multisig-store — loadFromDisk drop-invalid", () => {
  beforeEach(() => {
    _resetBtcMultisigStoreForTesting();
  });

  it("persist mode: loads valid records from disk, drops invalid entries, does not delete file", () => {
    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "persist";
    _resetBtcMultisigStoreForTesting();

    const validRecord = makeRecord("valid");
    const invalidRecord = { notARecord: true };
    const diskData = JSON.stringify([validRecord, invalidRecord]);

    vi.spyOn(_btcMultisigStorage, "existsSync").mockReturnValue(true);
    vi.spyOn(_btcMultisigStorage, "readFileSync").mockReturnValue(diskData);
    vi.spyOn(_btcMultisigStorage, "writeFileSync").mockImplementation(() => {});
    vi.spyOn(_btcMultisigStorage, "renameSync").mockImplementation(() => {});
    vi.spyOn(_btcMultisigStorage, "ensureStorageDirWithPerms").mockImplementation(() => {});

    const all = loadAllMultisigWallets();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("valid");

    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "memory";
    _resetBtcMultisigStoreForTesting();
  });

  it("persist mode: corrupt JSON file is tolerated — empty store returned, file NOT deleted", () => {
    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "persist";
    _resetBtcMultisigStoreForTesting();

    vi.spyOn(_btcMultisigStorage, "existsSync").mockReturnValue(true);
    vi.spyOn(_btcMultisigStorage, "readFileSync").mockReturnValue("{invalid json{{{}");
    const unlinkSpy = vi.fn();
    // unlinkSync should never be called
    vi.spyOn(_btcMultisigStorage, "writeFileSync").mockImplementation(() => {});

    const all = loadAllMultisigWallets();
    expect(all).toHaveLength(0);
    expect(unlinkSpy).not.toHaveBeenCalled();

    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "memory";
    _resetBtcMultisigStoreForTesting();
  });

  it("persist mode: non-array JSON returns empty store", () => {
    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "persist";
    _resetBtcMultisigStoreForTesting();

    vi.spyOn(_btcMultisigStorage, "existsSync").mockReturnValue(true);
    vi.spyOn(_btcMultisigStorage, "readFileSync").mockReturnValue('{"obj":"not-array"}');
    vi.spyOn(_btcMultisigStorage, "writeFileSync").mockImplementation(() => {});

    const all = loadAllMultisigWallets();
    expect(all).toHaveLength(0);

    process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "memory";
    _resetBtcMultisigStoreForTesting();
  });
});
