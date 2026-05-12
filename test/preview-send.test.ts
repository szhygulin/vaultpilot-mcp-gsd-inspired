// Plan 04-03 — preview_send tool tests (PREP-04, PREP-05, PREP-06).
//
// Covers the 10 cases enumerated by 04-VALIDATION.md rows 04-03-01..09 +
// idempotent re-preview (Q4 locked) + walletClient absence (no-private-
// key-path invariant) + register-all wiring.
//
// Mocking strategy (research § Validation Architecture lines 1115–1119):
//
//   vi.hoisted() declares the three spies shared across two vi.mock factories:
//     - viem/actions (getTransactionCount + estimateFeesPerGas + estimateGas)
//     - src/wallet/session-manager.js (getStatus)
//     - src/clients/fourbyte.js (lookupSelector)
//
//   handle-store stays REAL — tests both call `createHandle` to seed real
//   handles AND assert against `lookup()` to read stored records.
//
//   Fixture C anchor (Test 2): chainId 1, nonce 7, gas 21000, maxFeePerGas
//   30 gwei, maxPriorityFeePerGas 1.5 gwei, to 0x70997970…, value 1 ETH,
//   data "0x" → presignHash 0xb28e4824…. Same anchor as Plan 04-01's
//   test/signing-presign-hash.test.ts Test 1.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import type { FourbyteResult } from "../src/clients/fourbyte.js";

// `vi.mock` factories hoist above every `const` — the spies they close over
// must themselves be declared inside `vi.hoisted()`. Canonical pattern from
// Plan 04-02's prepare-native-send.test.ts.
const {
  getStatusSpy,
  getTransactionCountSpy,
  estimateFeesPerGasSpy,
  estimateGasSpy,
  lookupSelectorSpy,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getTransactionCountSpy: vi.fn(),
  estimateFeesPerGasSpy: vi.fn(),
  estimateGasSpy: vi.fn(),
  lookupSelectorSpy: vi.fn<[Hex | null], Promise<FourbyteResult>>(),
}));

// Mock the session-manager. Other exports stay real so register-all's
// transitive import (via pair_ledger_live + get_ledger_status) still works.
vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from preview_send tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

// Mock viem/actions — the three RPC fan-out reads. Other viem/actions exports
// must NOT be touched (other tools import them transitively via register-all).
vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>("viem/actions");
  return {
    ...actual,
    getTransactionCount: (
      ...args: Parameters<typeof actual.getTransactionCount>
    ) => getTransactionCountSpy(...args),
    estimateFeesPerGas: (
      ...args: Parameters<typeof actual.estimateFeesPerGas>
    ) => estimateFeesPerGasSpy(...args),
    estimateGas: (
      ...args: Parameters<typeof actual.estimateGas>
    ) => estimateGasSpy(...args),
  };
});

// Mock the 4byte client. Default return from `beforeEach` is `not-applicable`
// (native sends); per-test overrides via `lookupSelectorSpy.mockResolvedValue`.
vi.mock("../src/clients/fourbyte.js", async () => {
  const actual = await vi.importActual<typeof import("../src/clients/fourbyte.js")>(
    "../src/clients/fourbyte.js",
  );
  return {
    ...actual,
    lookupSelector: (selector: Hex | null) => lookupSelectorSpy(selector),
  };
});

import {
  AGENT_TASK_TEMPLATE,
  LEDGER_BLIND_SIGN_HASH_TEMPLATE,
  chunkHex,
} from "../src/signing/blocks.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
  transitionToPreviewed,
  transitionToSent,
} from "../src/signing/handle-store.js";
import type { PreparedTx, PreviewPinned } from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";

// Trigger side-effect registration for all Phase 1/2/3/04-01/04-02/04-03/04-05
// tools so the registry assertions below work.
await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Fixture C anchor (research § Code Example 2; Plan 04-01 Test 1).
const FIXTURE_C_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const FIXTURE_C_VALUE_WEI_STR = "1000000000000000000";
const FIXTURE_C_VALUE_WEI_BIGINT = 1_000_000_000_000_000_000n;
const FIXTURE_C_NONCE = 7;
const FIXTURE_C_GAS = 21_000n;
const FIXTURE_C_MAX_FEE = 30_000_000_000n; // 30 gwei
const FIXTURE_C_MAX_PRIO = 1_500_000_000n; // 1.5 gwei
const FIXTURE_C_PRESIGN_HASH =
  "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85";

const PAIRED_STATUS = {
  paired: true as const,
  address: FIXTURE_C_TO as `0x${string}`,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

// Fingerprint placeholder for Fixture C — the test doesn't re-derive it
// (Plan 04-02's fingerprint coverage is the SOT); we just need a Hex value
// to seed the handle.
const FIXTURE_FINGERPRINT =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;

function buildFixtureCTx(): PreparedTx {
  return {
    chainId: 1,
    to: FIXTURE_C_TO,
    valueWei: FIXTURE_C_VALUE_WEI_BIGINT,
    data: "0x" as Hex,
  };
}

function seedHandle(opts?: { data?: Hex; to?: Address; valueWei?: bigint; valueWeiStr?: string }): string {
  const data = opts?.data ?? ("0x" as Hex);
  const to = opts?.to ?? FIXTURE_C_TO;
  const valueWei = opts?.valueWei ?? FIXTURE_C_VALUE_WEI_BIGINT;
  const valueWeiStr = opts?.valueWeiStr ?? FIXTURE_C_VALUE_WEI_STR;
  return createHandle({
    args: { to, valueWei: valueWeiStr },
    tx: { chainId: 1, to, valueWei, data },
    payloadFingerprint: FIXTURE_FINGERPRINT,
  });
}

function scriptFixtureCMocks(): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getTransactionCountSpy.mockResolvedValue(FIXTURE_C_NONCE);
  estimateFeesPerGasSpy.mockResolvedValue({
    maxFeePerGas: FIXTURE_C_MAX_FEE,
    maxPriorityFeePerGas: FIXTURE_C_MAX_PRIO,
  });
  estimateGasSpy.mockResolvedValue(FIXTURE_C_GAS);
}

beforeEach(() => {
  getStatusSpy.mockReset();
  getTransactionCountSpy.mockReset();
  estimateFeesPerGasSpy.mockReset();
  estimateGasSpy.mockReset();
  lookupSelectorSpy.mockReset();
  lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });
  _resetHandleStoreForTesting();
  savedDemo = process.env[DEMO_KEY];
  delete process.env[DEMO_KEY];
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Test 1 — pin gas/nonce/fees onto handle (PREP-04, T-PIN-1) — 04-03-01
// ---------------------------------------------------------------------------
describe("preview_send — pins gas/nonce/fees onto the handle (PREP-04, T-PIN-1)", () => {
  it("writes pinned nonce/gas/maxFeePerGas/maxPriorityFeePerGas; getTransactionCount called with SENDER address (not tx.to)", async () => {
    const handle = seedHandle();
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      nonce: number;
      gas: string;
      maxFeePerGas: string;
      maxPriorityFeePerGas: string;
    };
    expect(sc.nonce).toBe(FIXTURE_C_NONCE);
    expect(sc.gas).toBe(FIXTURE_C_GAS.toString());
    expect(sc.maxFeePerGas).toBe(FIXTURE_C_MAX_FEE.toString());
    expect(sc.maxPriorityFeePerGas).toBe(FIXTURE_C_MAX_PRIO.toString());

    // Real handle-store: status transitioned to `previewed`, pinned values
    // present, bigints preserved as bigints (not stringified at the storage
    // boundary — only at the JSON-response boundary).
    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (!lookupResult.ok) return;
    const record = lookupResult.record;
    expect(record.status).toBe("previewed");
    expect(record.pinned).toBeDefined();
    if (!record.pinned) return;
    expect(record.pinned.nonce).toBe(FIXTURE_C_NONCE);
    expect(record.pinned.gas).toBe(FIXTURE_C_GAS);
    expect(record.pinned.maxFeePerGas).toBe(FIXTURE_C_MAX_FEE);
    expect(record.pinned.maxPriorityFeePerGas).toBe(FIXTURE_C_MAX_PRIO);

    // T-PIN-1 / T-FROM-1: SENDER address (paired status), NOT tx.to.
    // Research § Code Example 3 line 666 explicit warning.
    expect(getTransactionCountSpy).toHaveBeenCalledTimes(1);
    const txCountArgs = getTransactionCountSpy.mock.calls[0]?.[1] as {
      address: string;
      blockTag: string;
    };
    expect(txCountArgs.address).toBe(PAIRED_STATUS.address);
    expect(txCountArgs.blockTag).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Test 2 — presignHash matches Fixture C byte-for-byte (T-PRESIGN-1) — 04-03-03
// ---------------------------------------------------------------------------
describe("preview_send — presignHash matches Fixture C byte-for-byte (PREP-04, T-PRESIGN-1)", () => {
  it("response.presignHash === 0xb28e4824…; LEDGER block surfaces both full + chunked forms; record.pinned.presignHash matches", async () => {
    const handle = seedHandle();
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { presignHash: string };
    expect(sc.presignHash).toBe(FIXTURE_C_PRESIGN_HASH);

    const text = result.content[0]?.text ?? "";
    // The LEDGER block surfaces BOTH forms (A1 mitigation).
    expect(text).toContain(FIXTURE_C_PRESIGN_HASH); // full form
    expect(text).toContain(chunkHex(FIXTURE_C_PRESIGN_HASH as Hex)); // chunked form

    // Format-fanout-sentinel: test imports the SAME template the prod handler
    // substitutes — byte-identical inclusion.
    const expectedLedgerBlock = LEDGER_BLIND_SIGN_HASH_TEMPLATE
      .replace("{HASH_FULL}", FIXTURE_C_PRESIGN_HASH)
      .replace("{HASH_CHUNKED}", chunkHex(FIXTURE_C_PRESIGN_HASH as Hex));
    expect(text).toContain(expectedLedgerBlock);

    // Stored record carries the same hash — Plan 04-04's send-time
    // re-check (PREP-08) reads it back from `record.pinned.presignHash`.
    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (!lookupResult.ok || !lookupResult.record.pinned) return;
    expect(lookupResult.record.pinned.presignHash).toBe(FIXTURE_C_PRESIGN_HASH);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — AGENT TASK block contents (PREP-05, T-AGENT-1) — 04-03-04
// ---------------------------------------------------------------------------
describe("preview_send — AGENT TASK block emitted verbatim (PREP-05, T-AGENT-1)", () => {
  it("block contains the four checks + CHECKS PERFORMED prose + verbatim agent `to` + `valueWei`; byte-identical to template substitution", async () => {
    const lowercaseTo = "0xabcdef0123456789abcdef0123456789abcdef01" as Address;
    const handle = seedHandle({ to: lowercaseTo, valueWei: 123n, valueWeiStr: "123" });
    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { presignHash: string };
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("[AGENT TASK — RUN THESE CHECKS NOW]");
    expect(text).toContain("viem.parseTransaction");
    expect(text).toContain("viem.serializeTransaction");
    expect(text).toContain("CHECKS PERFORMED");

    // Verbatim agent strings — `to` is the LOWERCASE form the agent passed
    // (NOT the checksummed `getAddress(to)` form from tx.to). PrepareArgs
    // field types are string; type system blocks normalization.
    expect(text).toContain(lowercaseTo);
    expect(text).toContain("123"); // VALUE_WEI verbatim
    expect(text).toContain(sc.presignHash);

    // Format-fanout-sentinel: byte-identical inclusion.
    const expectedAgentBlock = AGENT_TASK_TEMPLATE
      .replace("{TO}", lowercaseTo)
      .replace("{VALUE_WEI}", "123")
      .replace("{PRESIGN_HASH}", sc.presignHash);
    expect(text).toContain(expectedAgentBlock);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — 4byte not-applicable for native send (PREP-06) — 04-03-09
// ---------------------------------------------------------------------------
describe("preview_send — 4byte not-applicable for native send (PREP-06)", () => {
  it("data === '0x' → selector === null; fourbyte block shows 'not-applicable' verbatim; lookupSelector called with null", async () => {
    const handle = seedHandle();
    scriptFixtureCMocks();
    lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      selector: Hex | null;
      fourbyte: FourbyteResult;
    };
    expect(sc.selector).toBeNull();
    expect(sc.fourbyte.kind).toBe("not-applicable");

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("4BYTE CROSS-CHECK");
    expect(text).toContain("not-applicable"); // VERBATIM — no rephrasing
    expect(text).toContain("native value transfer");

    expect(lookupSelectorSpy).toHaveBeenCalledTimes(1);
    expect(lookupSelectorSpy).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — 4byte error verbatim (PREP-06, T-4BYTE-1, T-4BYTE-MASK-1)
// ---------------------------------------------------------------------------
describe("preview_send — 4byte error message ships VERBATIM (PREP-06, no silent fallbacks)", () => {
  it("kind: 'error' message surfaces in the block UNMODIFIED; never masked as 'not-found'", async () => {
    // Forward-looking ERC-20 shape from Fixture B — selector is first 4 bytes
    // of data. transfer(address,uint256) selector = 0xa9059cbb.
    const transferData =
      ("0xa9059cbb" +
        "000000000000000000000000" +
        "70997970C51812dc3A010C7d01b50e0d17dc79C8" +
        "0000000000000000000000000000000000000000000000000de0b6b3a7640000") as Hex;
    const handle = seedHandle({ data: transferData });
    scriptFixtureCMocks();
    lookupSelectorSpy.mockResolvedValue({
      kind: "error",
      message: "4byte.directory unreachable (timeout 1.5s)",
    });

    const result = await callTool({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      selector: Hex | null;
      fourbyte: FourbyteResult;
    };
    expect(sc.selector).toBe("0xa9059cbb");
    expect(sc.fourbyte.kind).toBe("error");
    if (sc.fourbyte.kind === "error") {
      expect(sc.fourbyte.message).toBe("4byte.directory unreachable (timeout 1.5s)");
    }

    const text = result.content[0]?.text ?? "";
    // PREP-06 / T-4BYTE-MASK-1: VERBATIM, no truncation, no rephrasing.
    expect(text).toContain("4byte.directory unreachable (timeout 1.5s)");
    expect(text).toContain("0xa9059cbb");
  });
});

// ---------------------------------------------------------------------------
// Test 6 — WRONG_STATUS on `sent` handle (T-STATE-3) — 04-03-06
// ---------------------------------------------------------------------------
describe("preview_send — WRONG_STATUS on sent handle (T-STATE-3)", () => {
  it("handle in `sent` status refuses re-preview; record remains in `sent` state", async () => {
    const handle = seedHandle();

    // Transition handle through prepared → previewed → sent so it's in a
    // terminal state. The intermediate transition uses real
    // `transitionToPreviewed` with placeholder pinned values.
    const placeholderPinned: PreviewPinned = {
      nonce: 0,
      gas: 21_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      previewToken: "11111111-1111-4111-8111-111111111111",
      presignHash: FIXTURE_FINGERPRINT,
      selector: null,
    };
    expect(transitionToPreviewed(handle, placeholderPinned).ok).toBe(true);
    expect(
      transitionToSent(handle, "0xdeadbeef00000000000000000000000000000000000000000000000000000000")
        .ok,
    ).toBe(true);

    scriptFixtureCMocks();

    const result = await callTool({ handle });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WRONG_STATUS",
    );
    expect(result.content[0]?.text ?? "").toContain("sent");

    // Defense check: viem RPC reads were NOT performed (status guard fired
    // before the Promise.all fan-out — cheaper + clearer error).
    expect(getTransactionCountSpy).toHaveBeenCalledTimes(0);
    expect(estimateFeesPerGasSpy).toHaveBeenCalledTimes(0);
    expect(estimateGasSpy).toHaveBeenCalledTimes(0);

    // Record still in `sent` — preview was refused, not re-pinned.
    const after = lookup(handle);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.record.status).toBe("sent");
  });
});

// ---------------------------------------------------------------------------
// Test 7 — HANDLE_NOT_FOUND — 04-03-07
// ---------------------------------------------------------------------------
describe("preview_send — HANDLE_NOT_FOUND for unknown handle", () => {
  it("unknown handle UUID returns errorCode HANDLE_NOT_FOUND; viem spies NOT called", async () => {
    const result = await callTool({ handle: "00000000-0000-4000-8000-000000000000" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "HANDLE_NOT_FOUND",
    );

    expect(getTransactionCountSpy).toHaveBeenCalledTimes(0);
    expect(estimateFeesPerGasSpy).toHaveBeenCalledTimes(0);
    expect(estimateGasSpy).toHaveBeenCalledTimes(0);
    expect(lookupSelectorSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// Test 8 — HANDLE_EXPIRED past 15-min TTL — 04-03-08
// ---------------------------------------------------------------------------
describe("preview_send — HANDLE_EXPIRED past 15-min TTL", () => {
  it("seeded handle past TTL returns errorCode HANDLE_EXPIRED; viem spies NOT called", async () => {
    const handle = seedHandle();
    scriptFixtureCMocks();

    vi.useFakeTimers();
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    const result = await callTool({ handle });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "HANDLE_EXPIRED",
    );

    expect(getTransactionCountSpy).toHaveBeenCalledTimes(0);
    expect(estimateFeesPerGasSpy).toHaveBeenCalledTimes(0);
    expect(estimateGasSpy).toHaveBeenCalledTimes(0);
    expect(lookupSelectorSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// Test 9 — Idempotent re-preview (Q4 locked) — 04-03-05
// ---------------------------------------------------------------------------
describe("preview_send — idempotent re-preview (Q4 locked decision)", () => {
  it("second call re-pins fresh values; mints a new previewToken; both viem fan-outs called twice; stored token === most-recent", async () => {
    const handle = seedHandle();

    // First call — Fixture C mocks.
    scriptFixtureCMocks();
    const result1 = await callTool({ handle });
    expect(result1.isError).toBeFalsy();
    const sc1 = result1.structuredContent as {
      previewToken: string;
      presignHash: string;
      nonce: number;
    };
    expect(sc1.nonce).toBe(FIXTURE_C_NONCE);

    // Reset spies, mock different values for the second call.
    getTransactionCountSpy.mockResolvedValue(42);
    estimateFeesPerGasSpy.mockResolvedValue({
      maxFeePerGas: 50_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
    });
    estimateGasSpy.mockResolvedValue(21_000n);

    const result2 = await callTool({ handle });
    expect(result2.isError).toBeFalsy();
    const sc2 = result2.structuredContent as {
      previewToken: string;
      presignHash: string;
      nonce: number;
    };
    expect(sc2.nonce).toBe(42);

    // Fresh previewToken (Q4) — the prior one is invalidated.
    expect(sc1.previewToken).not.toBe(sc2.previewToken);
    // Fresh presignHash — different nonce + fees → different serialized
    // → different keccak.
    expect(sc1.presignHash).not.toBe(sc2.presignHash);

    // All three viem reads happened TWICE (re-resolution, not cached).
    expect(getTransactionCountSpy).toHaveBeenCalledTimes(2);
    expect(estimateFeesPerGasSpy).toHaveBeenCalledTimes(2);
    expect(estimateGasSpy).toHaveBeenCalledTimes(2);

    // Stored token === most-recently-minted; the prior token is no longer
    // findable (Plan 04-04's PREVIEW_TOKEN_MISMATCH gate rejects stale
    // tokens against `record.pinned.previewToken`).
    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (!lookupResult.ok || !lookupResult.record.pinned) return;
    expect(lookupResult.record.pinned.previewToken).toBe(sc2.previewToken);
    expect(lookupResult.record.pinned.previewToken).not.toBe(sc1.previewToken);
    expect(lookupResult.record.pinned.nonce).toBe(42);
    expect(lookupResult.record.pinned.maxFeePerGas).toBe(50_000_000_000n);
  });

  it("previewToken matches UUID v4 regex on both calls", async () => {
    const handle = seedHandle();
    scriptFixtureCMocks();
    const result1 = await callTool({ handle });
    const sc1 = result1.structuredContent as { previewToken: string };

    getTransactionCountSpy.mockResolvedValue(8);
    const result2 = await callTool({ handle });
    const sc2 = result2.structuredContent as { previewToken: string };

    const uuidV4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(sc1.previewToken).toMatch(uuidV4);
    expect(sc2.previewToken).toMatch(uuidV4);
  });
});

// ---------------------------------------------------------------------------
// Test 10 — demo-mode refusal (T-DEMO-1)
// ---------------------------------------------------------------------------
describe("preview_send — demo-mode refusal fires FIRST (T-DEMO-1)", () => {
  it("VAULTPILOT_DEMO=true → DEMO_MODE_REFUSED; ZERO calls to lookup/getStatus/viem/4byte", async () => {
    const handle = seedHandle();
    process.env[DEMO_KEY] = "true";

    const result = await callTool({ handle });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "DEMO_MODE_REFUSED",
    );
    expect(result.content[0]?.text ?? "").toMatch(/demo mode/i);
    expect(result.content[0]?.text ?? "").toMatch(/set_demo_wallet/);

    // All downstream paths short-circuit: session, viem, 4byte all untouched.
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(getTransactionCountSpy).toHaveBeenCalledTimes(0);
    expect(estimateFeesPerGasSpy).toHaveBeenCalledTimes(0);
    expect(estimateGasSpy).toHaveBeenCalledTimes(0);
    expect(lookupSelectorSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// Test 11 — register-all wiring (smoke)
// ---------------------------------------------------------------------------
describe("preview_send — register-all wiring", () => {
  it("preview_send is registered after register-all import; inputSchema requires 'handle'", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("preview_send");

    const tool = getRegisteredTool("preview_send");
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(["handle"]);
  });

  it("register-all.ts contains the side-effect import line for ./preview_send.js", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = url.fileURLToPath(new URL(".", import.meta.url));
    const target = path.resolve(here, "..", "src", "tools", "register-all.ts");
    const source = await fs.readFile(target, "utf8");
    expect(source).toContain('import "./preview_send.js";');
  });
});

// ---------------------------------------------------------------------------
// Test 12 — no walletClient import (private-key-path invariant)
// ---------------------------------------------------------------------------
describe("preview_send — no walletClient import (no private-key path)", () => {
  it("src/tools/preview_send.ts contains zero references to 'walletClient'", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = url.fileURLToPath(new URL(".", import.meta.url));
    const target = path.resolve(here, "..", "src", "tools", "preview_send.ts");
    const source = await fs.readFile(target, "utf8");
    expect(source.includes("walletClient")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 13 — WALLET_NOT_PAIRED at preview time (defense in depth)
// ---------------------------------------------------------------------------
describe("preview_send — WALLET_NOT_PAIRED if session dropped between prepare and preview", () => {
  it("getStatus returns null → errorCode WALLET_NOT_PAIRED; viem spies NOT called; handle not transitioned", async () => {
    const handle = seedHandle();
    getStatusSpy.mockResolvedValue(null);

    const result = await callTool({ handle });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "WALLET_NOT_PAIRED",
    );
    expect(result.content[0]?.text ?? "").toMatch(/pair_ledger_live/);

    expect(getTransactionCountSpy).toHaveBeenCalledTimes(0);
    expect(estimateFeesPerGasSpy).toHaveBeenCalledTimes(0);
    expect(estimateGasSpy).toHaveBeenCalledTimes(0);

    // Handle remains in `prepared` — not transitioned.
    const after = lookup(handle);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.record.status).toBe("prepared");
    expect(after.record.pinned).toBeUndefined();
  });
});
