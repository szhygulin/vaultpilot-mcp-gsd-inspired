// Phase 22 Plan 22-04 — get_btc_status tool tests (BTC-PAIR-02).
//
// Six behaviors covered:
//   1. `paired: false` when the store has no BTC record.
//   2. Single segwit-only record → addresses.segwit set, taproot undefined.
//   3. Single taproot-only record → addresses.taproot set, segwit undefined.
//   4. Both records → addresses.segwit AND addresses.taproot set;
//      derivationPaths object likewise.
//   5. `staleAccountWarning: true` envelope-level when EITHER record stale
//      (per-record OR semantics).
//   6. NO lazy on-device Ledger BTC app version probe — the cache record
//      holds no version; defer to Phase 27 `get_btc_setup_status`.
//   7. Defensive fall-through: listAccounts throw → paired:false envelope.
//
// `esploraEndpoint` is sourced from `_bitcoinRegistry.getResolvedEsploraUrl()`
// — pin BTC_ESPLORA_URL explicitly for deterministic assertions; reset the
// registry between tests via `_resetBitcoinRegistryForTesting`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _bitcoinRegistry,
  _resetBitcoinRegistryForTesting,
} from "../src/chains/bitcoin/registry.js";

const listAccountsSpy = vi.fn();

vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (
      ...args: Parameters<typeof actual.listAccounts>
    ) => listAccountsSpy(...args),
  };
});

import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/get_btc_status.js");

async function callTool(
  args: Record<string, unknown> = {},
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_btc_status");
  if (!tool) throw new Error("get_btc_status not registered");
  return tool.handler(args);
}

const SEGWIT_FIXTURE = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const TAPROOT_FIXTURE =
  "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";
const SEGWIT_DERIVATION = "84'/0'/0'/0/0";
const TAPROOT_DERIVATION = "86'/0'/0'/0/0";

const BTC_ESPLORA_KEY = "BTC_ESPLORA_URL";
let savedEsplora: string | undefined;

beforeEach(() => {
  listAccountsSpy.mockReset();
  savedEsplora = process.env[BTC_ESPLORA_KEY];
  process.env[BTC_ESPLORA_KEY] = "https://esplora-test.example.com/api";
  _resetBitcoinRegistryForTesting();
});

afterEach(() => {
  if (savedEsplora === undefined) delete process.env[BTC_ESPLORA_KEY];
  else process.env[BTC_ESPLORA_KEY] = savedEsplora;
  _resetBitcoinRegistryForTesting();
});

describe("get_btc_status — unpaired branch", () => {
  it("Test 1 — paired: false when no BTC records in the store", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ paired: false });
    expect(result.content[0]?.text ?? "").toMatch(/paired:\s+false/);
    expect(listAccountsSpy).toHaveBeenCalledWith({ chainFilter: "bitcoin" });
  });
});

describe("get_btc_status — segwit-only paired branch (BTC-PAIR-02)", () => {
  it("Test 2 — segwit-only record surfaces addresses.segwit + addresses.taproot undefined", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "bitcoin",
        address: SEGWIT_FIXTURE,
        derivationPath: SEGWIT_DERIVATION,
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool({});
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      paired: boolean;
      addresses: { segwit?: string; taproot?: string };
      derivationPaths: { segwit?: string; taproot?: string };
      esploraEndpoint: string;
      pairedAt: string;
    };
    expect(sc.paired).toBe(true);
    expect(sc.addresses).toEqual({ segwit: SEGWIT_FIXTURE });
    expect(sc.addresses.taproot).toBeUndefined();
    expect(sc.derivationPaths).toEqual({ segwit: SEGWIT_DERIVATION });
    expect(sc.derivationPaths.taproot).toBeUndefined();
    expect(sc.esploraEndpoint).toBe("https://esplora-test.example.com/api");
    expect(sc.pairedAt).toBe("2026-05-15T10:00:00.000Z");
  });
});

describe("get_btc_status — taproot-only paired branch (BTC-PAIR-02)", () => {
  it("Test 3 — taproot-only record surfaces addresses.taproot + addresses.segwit undefined", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "bitcoin",
        address: TAPROOT_FIXTURE,
        derivationPath: TAPROOT_DERIVATION,
        pairedAt: "2026-05-16T11:00:00.000Z",
      },
    ]);

    const result = await callTool({});
    const sc = result.structuredContent as {
      paired: boolean;
      addresses: { segwit?: string; taproot?: string };
      derivationPaths: { segwit?: string; taproot?: string };
    };
    expect(sc.paired).toBe(true);
    expect(sc.addresses).toEqual({ taproot: TAPROOT_FIXTURE });
    expect(sc.addresses.segwit).toBeUndefined();
    expect(sc.derivationPaths).toEqual({ taproot: TAPROOT_DERIVATION });
    expect(sc.derivationPaths.segwit).toBeUndefined();
  });
});

describe("get_btc_status — dual-record paired branch (BTC-PAIR-02)", () => {
  it("Test 4 — both records surface addresses + derivationPaths as objects with both slots", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "bitcoin",
        address: SEGWIT_FIXTURE,
        derivationPath: SEGWIT_DERIVATION,
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        chain: "bitcoin",
        address: TAPROOT_FIXTURE,
        derivationPath: TAPROOT_DERIVATION,
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool({});
    const sc = result.structuredContent as {
      paired: boolean;
      addresses: { segwit: string; taproot: string };
      derivationPaths: { segwit: string; taproot: string };
      esploraEndpoint: string;
      pairedAt: string;
    };
    expect(sc.paired).toBe(true);
    expect(sc.addresses).toEqual({
      segwit: SEGWIT_FIXTURE,
      taproot: TAPROOT_FIXTURE,
    });
    expect(sc.derivationPaths).toEqual({
      segwit: SEGWIT_DERIVATION,
      taproot: TAPROOT_DERIVATION,
    });
    expect(sc.esploraEndpoint).toBe("https://esplora-test.example.com/api");
    expect(sc.pairedAt).toBe("2026-05-15T10:00:00.000Z");

    // Text-block humanrendered surface includes both addresses + paths.
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(SEGWIT_FIXTURE);
    expect(text).toContain(TAPROOT_FIXTURE);
    expect(text).toContain(SEGWIT_DERIVATION);
    expect(text).toContain(TAPROOT_DERIVATION);
    expect(text).toMatch(/paired:\s+true/);
  });

  it("Test 5 — esploraEndpoint reflects _bitcoinRegistry.getResolvedEsploraUrl() (public fallback when env unset)", async () => {
    delete process.env[BTC_ESPLORA_KEY];
    _resetBitcoinRegistryForTesting();
    listAccountsSpy.mockReturnValue([
      {
        chain: "bitcoin",
        address: SEGWIT_FIXTURE,
        derivationPath: SEGWIT_DERIVATION,
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool({});
    const sc = result.structuredContent as { esploraEndpoint: string };
    expect(sc.esploraEndpoint).toBe(_bitcoinRegistry.getResolvedEsploraUrl());
    expect(sc.esploraEndpoint).toBe("https://blockstream.info/api");
  });
});

describe("get_btc_status — staleAccountWarning per-record OR (envelope-level disjunction)", () => {
  it("Test 6 — staleAccountWarning: true when ONLY the segwit record is stale", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "bitcoin",
        address: SEGWIT_FIXTURE,
        derivationPath: SEGWIT_DERIVATION,
        pairedAt: "2025-01-01T00:00:00.000Z",
        staleAccountWarning: true,
      },
      {
        chain: "bitcoin",
        address: TAPROOT_FIXTURE,
        derivationPath: TAPROOT_DERIVATION,
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool({});
    const sc = result.structuredContent as {
      staleAccountWarning?: true;
    };
    expect(sc.staleAccountWarning).toBe(true);
    expect(result.content[0]?.text ?? "").toMatch(/staleAccountWarning:\s+true/);
  });

  it("Test 7 — staleAccountWarning: true when ONLY the taproot record is stale", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "bitcoin",
        address: SEGWIT_FIXTURE,
        derivationPath: SEGWIT_DERIVATION,
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        chain: "bitcoin",
        address: TAPROOT_FIXTURE,
        derivationPath: TAPROOT_DERIVATION,
        pairedAt: "2025-01-01T00:00:00.000Z",
        staleAccountWarning: true,
      },
    ]);

    const result = await callTool({});
    const sc = result.structuredContent as { staleAccountWarning?: true };
    expect(sc.staleAccountWarning).toBe(true);
  });

  it("Test 8 — staleAccountWarning absent when NEITHER record is stale", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "bitcoin",
        address: SEGWIT_FIXTURE,
        derivationPath: SEGWIT_DERIVATION,
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        chain: "bitcoin",
        address: TAPROOT_FIXTURE,
        derivationPath: TAPROOT_DERIVATION,
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool({});
    const sc = result.structuredContent as { staleAccountWarning?: true };
    expect(sc.staleAccountWarning).toBeUndefined();
  });
});

describe("get_btc_status — NO lazy Ledger BTC app version probe (deferred to Phase 27)", () => {
  it("Test 9 — ledgerBtcAppVersion is undefined / absent in the response; no transport probe spawned", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "bitcoin",
        address: SEGWIT_FIXTURE,
        derivationPath: SEGWIT_DERIVATION,
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        chain: "bitcoin",
        address: TAPROOT_FIXTURE,
        derivationPath: TAPROOT_DERIVATION,
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool({});
    const sc = result.structuredContent as {
      ledgerBtcAppVersion?: unknown;
    };
    // Field is either absent from structuredContent or explicitly undefined
    // — both are acceptable shapes for "we did NOT probe the device."
    expect(sc.ledgerBtcAppVersion).toBeUndefined();

    // Tool description must NOT promise live-probing the device — agent
    // routing prompt mentions Phase 27 `get_btc_setup_status` as the
    // place to go for that.
    const tool = getRegisteredTool("get_btc_status");
    expect(tool).toBeDefined();
    expect(tool!.description).not.toMatch(/lazy.{0,40}probe/i);
  });
});

describe("get_btc_status — defensive fall-through (never errors)", () => {
  it("Test 10 — when listAccounts throws, surfaces paired:false rather than propagating the error", async () => {
    listAccountsSpy.mockImplementationOnce(() => {
      throw new Error("store unavailable");
    });

    const result = await callTool({});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ paired: false });
  });
});

describe("get_btc_status — register-all wiring", () => {
  it("Test 11 — getRegisteredTool('get_btc_status') is non-null after register-all import", async () => {
    await import("../src/tools/register-all.js");
    const tool = getRegisteredTool("get_btc_status");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("get_btc_status");
  });
});
