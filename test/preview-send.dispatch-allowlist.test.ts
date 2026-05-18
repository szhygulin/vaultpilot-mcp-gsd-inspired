// Phase 9 — Plan 09-04. preview_send Layer 0.5 dispatch-allowlist refusal
// (SEC-35). Fires AFTER handle lookup (needs record.tx.chainId +
// record.tx.to) and BEFORE Phase 8 Layer 2 chain-name MISMATCH check at
// lines 173-191. Native sends bypass.
//
// Layer taxonomy (post-Plan-09-04):
//   Layer 0.5 — THIS — outer dispatch-target allowlist (SECURITY GATE; fires
//               first for contract calls).
//   Layer 1   — JSON-schema enum (refuses bogus chain names at dispatch).
//   Layer 2   — Phase 8 Plan 08-02 — chain-name MISMATCH refusal (STATE
//               CONSISTENCY check; fires AFTER Layer 0.5).
//   Layer 3   — Plan 04-01 payloadFingerprint preimage chainId slot (FROZEN
//               cryptographic-binding chain).
//   Layer 4   — Ledger device `Network:` clear-sign display (out of MCP
//               scope).
//
// Anchors:
//   - T-DISPATCH-ALLOWLIST-1 (Test 1): Layer 0.5 fires BEFORE Layer 2.
//     A refusal that triggers BOTH surfaces DISPATCH_TARGET_REFUSED (the
//     more fundamental issue).
//   - T-DISPATCH-MISMATCH-1 / T-NATIVE-SEND-FALSE-REFUSAL-1 (Test 2):
//     native sends (`record.tx.data === "0x"`) bypass — a prepared native
//     send to an EOA reaches preview_send without DISPATCH_TARGET_REFUSED.
//   - T-ERC20-TOKEN-COMPATIBILITY-1 (Test 6): option (b) PARTIAL —
//     USDC ERC-20 transfer reaches preview_send via BRIDGED_VARIANTS
//     coverage (Phase 6 ERC-20 lifecycle compatibility preserved).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type Hex } from "viem";

import type { FourbyteResult } from "../src/clients/fourbyte.js";

const {
  getStatusSpy,
  getTransactionCountSpy,
  estimateFeesPerGasSpy,
  estimateGasSpy,
  callSpy,
  lookupSelectorSpy,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getTransactionCountSpy: vi.fn(),
  estimateFeesPerGasSpy: vi.fn(),
  estimateGasSpy: vi.fn(),
  callSpy: vi.fn(),
  lookupSelectorSpy: vi.fn<[Hex | null], Promise<FourbyteResult>>(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from these tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

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
    estimateGas: (...args: Parameters<typeof actual.estimateGas>) =>
      estimateGasSpy(...args),
    call: (...args: Parameters<typeof actual.call>) => callSpy(...args),
  };
});

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
  getAaveV3PoolAddress,
  getWethAddress,
  type ChainId,
} from "../src/config/contracts.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import { _canonicalDispatch } from "../src/security/canonical-dispatch.js";
import { DISPATCH_TARGET_REFUSAL_TEMPLATE } from "../src/signing/blocks.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
} from "../src/signing/handle-store.js";
import type { PreparedTx } from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callPreview(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

const SENDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const FIXTURE_FINGERPRINT =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;

const PAIRED_STATUS = {
  paired: true as const,
  accounts: [SENDER as `0x${string}`],
  activeAccount: SENDER as `0x${string}`,
  address: SENDER as `0x${string}`,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

// Random EOA address — NOT in the allowlist on any chain. Used as the
// rejected `tx.to` across Layer 0.5 refusal tests.
const OFF_LIST_TO = getAddress(
  "0xdEaDBeefDEaDbeefdEAdbEEFdEadbeeFDeAdbEEf",
);

// Generic 4-byte calldata — selector unknown; just needs `data !== "0x"` to
// trigger the Layer 0.5 check.
const ARBITRARY_DATA = "0xdeadbeef" as Hex;

// USDC on Ethereum chain 1 — Circle-native canonical, in BRIDGED_VARIANTS.
// Used to confirm Phase 6 ERC-20 lifecycle compatibility.
const USDC_ETH = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const TRANSFER_DATA = ("0xa9059cbb" +
  "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" +
  "0000000000000000000000000000000000000000000000000000000005f5e100") as Hex;

function buildTx(
  chainId: ChainId,
  to: Address,
  data: Hex,
  valueWei: bigint = 0n,
): PreparedTx {
  return { chainId, to, valueWei, data };
}

function seedHandle(
  chainId: ChainId,
  to: Address,
  data: Hex,
  valueWei: bigint = 0n,
): string {
  return createHandle({
    args: {
      to: to.toLowerCase(),
      valueWei: valueWei.toString(),
    },
    tx: buildTx(chainId, to, data, valueWei),
    payloadFingerprint: FIXTURE_FINGERPRINT,
  });
}

function scriptHappyMocks(): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getTransactionCountSpy.mockResolvedValue(7);
  estimateFeesPerGasSpy.mockResolvedValue({
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
  });
  estimateGasSpy.mockResolvedValue(21_000n);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

beforeEach(() => {
  getStatusSpy.mockReset();
  getTransactionCountSpy.mockReset();
  estimateFeesPerGasSpy.mockReset();
  estimateGasSpy.mockReset();
  callSpy.mockReset();
  lookupSelectorSpy.mockReset();
  lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });
  callSpy.mockResolvedValue({ data: "0x" });
  _resetHandleStoreForTesting();
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
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1 — T-DISPATCH-ALLOWLIST-1 anchor: Layer 0.5 fires BEFORE Layer 2.
// A refusal that would ALSO trigger Layer 2 (chain-name mismatch) MUST hit
// Layer 0.5 first — proves the ordering invariant.
// ---------------------------------------------------------------------------
describe("preview_send Layer 0.5 — fires BEFORE Phase 8 Layer 2 (T-DISPATCH-ALLOWLIST-1)", () => {
  it("(1) contract call with non-allowlist tx.to + chain mismatch → DISPATCH_TARGET_REFUSED (NOT CHAIN_ID_MISMATCH)", async () => {
    // Handle prepared with off-list tx.to + chainId=1; agent claims
    // chain="polygon". BOTH gates would fire: Layer 0.5 (off-list) AND
    // Layer 2 (chain mismatch). Layer 0.5 wins.
    const handle = seedHandle(1, OFF_LIST_TO, ARBITRARY_DATA);

    const result = await callPreview({ handle, chain: "polygon" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("DISPATCH_TARGET_REFUSED");
    expect(sc.errorCode).not.toBe("CHAIN_ID_MISMATCH");
    expect(sc.message).toContain(OFF_LIST_TO);
    expect(sc.message).toContain("chain 1");

    // Refusal text carries the templated DISPATCH TARGET REFUSED block.
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("DISPATCH TARGET REFUSED");
    expect(text).toContain("chain:     ethereum (chainId 1)");
    expect(text).toContain(`tx.to:     ${OFF_LIST_TO}`);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — T-DISPATCH-MISMATCH-1 / T-NATIVE-SEND-FALSE-REFUSAL-1 anchor:
// native sends bypass Layer 0.5.
// ---------------------------------------------------------------------------
describe("preview_send Layer 0.5 — native sends bypass (T-DISPATCH-MISMATCH-1 / T-NATIVE-SEND-FALSE-REFUSAL-1)", () => {
  it("(2) native send (data === \"0x\") to a random EOA → no DISPATCH_TARGET_REFUSED; proceeds to happy path", async () => {
    // Prepare a native send to a random EOA — `to` is decidedly NOT in
    // any chain's canonical allowlist. The native-send fence (`data ===
    // "0x"`) must short-circuit Layer 0.5.
    const handle = seedHandle(
      1,
      OFF_LIST_TO,
      "0x" as Hex,
      1_000_000_000_000_000_000n,
    );
    scriptHappyMocks();

    const result = await callPreview({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { chainId: number; previewToken: string };
    expect(sc.chainId).toBe(1);
    expect(sc.previewToken).toMatch(/^[0-9a-f-]+$/);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Contract-call refusal happy path with verbatim allowlist surfacing.
// ---------------------------------------------------------------------------
describe("preview_send Layer 0.5 — refusal text + verbatim allowlist surfacing", () => {
  it("(3) off-list tx.to + contract data + chain matches → DISPATCH_TARGET_REFUSED with chain label + tx.to + allowlist in text", async () => {
    const handle = seedHandle(1, OFF_LIST_TO, ARBITRARY_DATA);

    const result = await callPreview({ handle, chain: "ethereum" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("DISPATCH_TARGET_REFUSED");
    expect(sc.message).toBe(
      `tx.to ${OFF_LIST_TO} is not in the v1.3 canonical dispatch allowlist for chain 1`,
    );

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("DISPATCH TARGET REFUSED");
    expect(text).toContain("chain:     ethereum (chainId 1)");
    expect(text).toContain(`tx.to:     ${OFF_LIST_TO}`);
    // Allowlist entries surface verbatim — agent / user can see what was
    // expected.
    expect(text).toContain(getAaveV3PoolAddress(1));
    expect(text).toContain(getWethAddress(1));
    expect(text).toContain("0x111111125421cA6dc452d289314280a0f8842A65");
    expect(text).toContain("0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE");
    // Remediation text present.
    expect(text).toContain("Re-prepare the transaction");
    expect(text).toContain("prepare_custom_call");
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Aave canonical happy path (Layer 0.5 OK).
// ---------------------------------------------------------------------------
describe("preview_send Layer 0.5 — Aave V3 Pool happy path", () => {
  it("(4) Aave V3 Pool call (Ethereum) → no DISPATCH_TARGET_REFUSED; proceeds to happy path", async () => {
    // Aave V3 supply selector + arbitrary calldata.
    const aaveSupplyData = ("0x617ba037" +
      "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" +
      "0000000000000000000000000000000000000000000000000000000005f5e100" +
      "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" +
      "0000000000000000000000000000000000000000000000000000000000000000") as Hex;
    const handle = seedHandle(1, getAaveV3PoolAddress(1), aaveSupplyData);
    scriptHappyMocks();

    const result = await callPreview({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { chainId: number };
    expect(sc.chainId).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — WETH9 canonical happy path (Layer 0.5 OK) on Polygon.
// ---------------------------------------------------------------------------
describe("preview_send Layer 0.5 — WETH9 Polygon happy path", () => {
  it("(5) WETH9.withdraw on Polygon → no DISPATCH_TARGET_REFUSED", async () => {
    const wethWithdrawData =
      "0x2e1a7d4d0000000000000000000000000000000000000000000000000de0b6b3a7640000" as Hex;
    const handle = seedHandle(137, getWethAddress(137), wethWithdrawData);
    scriptHappyMocks();

    const result = await callPreview({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { chainId: number };
    expect(sc.chainId).toBe(137);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — T-ERC20-TOKEN-COMPATIBILITY-1 anchor: USDC ERC-20 transfer
// reaches preview_send via BRIDGED_VARIANTS coverage. Phase 6 ERC-20
// lifecycle compatibility lock.
// ---------------------------------------------------------------------------
describe("preview_send Layer 0.5 — USDC ERC-20 transfer via BRIDGED_VARIANTS (T-ERC20-TOKEN-COMPATIBILITY-1)", () => {
  it("(6) ERC-20 transfer to USDC contract on Ethereum → no DISPATCH_TARGET_REFUSED (BRIDGED_VARIANTS coverage)", async () => {
    // USDC Circle-native on Ethereum chain 1 lives in BRIDGED_VARIANTS;
    // the option (b) PARTIAL extension in buildPerChainAllowlist
    // surfaces it as an in-allowlist tx.to.
    const handle = seedHandle(1, USDC_ETH, TRANSFER_DATA);
    scriptHappyMocks();

    const result = await callPreview({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { chainId: number; selector: Hex | null };
    expect(sc.chainId).toBe(1);
    expect(sc.selector).toBe("0xa9059cbb");
  });
});

// ---------------------------------------------------------------------------
// Test 7 — DISPATCH_TARGET_REFUSAL_TEMPLATE byte-identity: refusal text
// matches the verbatim template with substitutions.
// ---------------------------------------------------------------------------
describe("preview_send Layer 0.5 — DISPATCH_TARGET_REFUSAL_TEMPLATE byte-identity", () => {
  it("(7) refusal `content[0].text` equals DISPATCH_TARGET_REFUSAL_TEMPLATE with substitutions", async () => {
    const handle = seedHandle(42161, OFF_LIST_TO, ARBITRARY_DATA);

    const result = await callPreview({ handle });

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";

    // The handler builds the refusal by substituting the template; we
    // re-derive the same substitution here and assert byte-identity.
    const allowlist = [...(
      // Constructing the same way the production handler does — via
      // checkDispatchTarget which returns the verbatim allowlist on
      // refusal.
      _canonicalDispatch.checkDispatchTarget(42161, OFF_LIST_TO) as {
        kind: "refused";
        allowlist: Address[];
      }
    ).allowlist];

    const expected = DISPATCH_TARGET_REFUSAL_TEMPLATE
      .replace("{CHAIN}", "arbitrum (chainId 42161)")
      .replace("{TO}", OFF_LIST_TO)
      .replace("{ALLOWLIST}", allowlist.join("\n    "));

    expect(text).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Test 8 — ESM spy round-trip: mockReturnValue({ kind: "ok" }) short-circuits
// the refusal even when tx.to is not in the real allowlist.
// ---------------------------------------------------------------------------
describe("preview_send Layer 0.5 — ESM spy round-trip via _canonicalDispatch", () => {
  it("(8) vi.spyOn(_canonicalDispatch, \"checkDispatchTarget\").mockReturnValue({ kind: \"ok\" }) bypasses the refusal", async () => {
    const spy = vi
      .spyOn(_canonicalDispatch, "checkDispatchTarget")
      .mockReturnValue({ kind: "ok" });
    try {
      // off-list tx.to that would normally hit DISPATCH_TARGET_REFUSED;
      // spy short-circuits the gate.
      const handle = seedHandle(1, OFF_LIST_TO, ARBITRARY_DATA);
      scriptHappyMocks();

      const result = await callPreview({ handle });

      expect(result.isError).toBeFalsy();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 9 — Layer 2 still fires when Layer 0.5 passes (canonical tx.to + chain
// mismatch → CHAIN_ID_MISMATCH).
// ---------------------------------------------------------------------------
describe("preview_send Layer 0.5 → Layer 2 fall-through", () => {
  it("(9) canonical tx.to (Aave Pool Ethereum) + chain=\"polygon\" → CHAIN_ID_MISMATCH (Layer 2 catches when Layer 0.5 passes)", async () => {
    const aaveSupplyData = ("0x617ba037" +
      "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" +
      "0000000000000000000000000000000000000000000000000000000005f5e100" +
      "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" +
      "0000000000000000000000000000000000000000000000000000000000000000") as Hex;
    const handle = seedHandle(1, getAaveV3PoolAddress(1), aaveSupplyData);

    const result = await callPreview({ handle, chain: "polygon" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    // Layer 0.5 passed (Aave Pool is canonical on chain 1); Layer 2
    // catches the chain mismatch.
    expect(sc.errorCode).toBe("CHAIN_ID_MISMATCH");
  });
});
