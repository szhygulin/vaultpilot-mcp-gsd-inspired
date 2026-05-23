// EigenLayer + Rocket Pool persona-cycle byte-identity integration test —
// Phase 31 Plan 31-03.
//
// Re-anchors Fixtures Z + AA-RP + AB-RP across persona swaps to prove
// from-INDEPENDENCE of the payloadFingerprint preimage (T-BIND-1):
//   - The fingerprint preimage is keccak(tag ‖ chainId ‖ to ‖ valueWei ‖ data).
//   - The `from` (sender) address is NOT in the preimage by construction.
//   - Across ≥ 2 personas (different `from` addresses), the SAME prepare
//     args MUST produce byte-identical fingerprints.
//
// 3 fixtures × 2 personas = 6 assertions minimum.
//
// Mock pattern: clone test/lido-lifecycle.integration.test.ts setup —
// session-manager + viem/actions + chains/registry mocks; demo mode active
// with persona swapping via setActivePersona.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockPublicClient,
  type MockPublicClient,
} from "./helpers/mock-public-client.js";
import {
  createMockSignClient,
  type MockSignClient,
} from "./helpers/mock-sign-client.js";

const {
  getStatusSpy,
  getActiveSessionTopicSpy,
  mockPublicHolder,
  mockSignClientHolder,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getActiveSessionTopicSpy: vi.fn<[], string | null>(),
  mockPublicHolder: { current: null as MockPublicClient | null },
  mockSignClientHolder: { current: null as MockSignClient | null },
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    getActiveSessionTopic: () => getActiveSessionTopicSpy(),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from integration test");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("../src/wallet/walletconnect-client.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/walletconnect-client.js")>(
    "../src/wallet/walletconnect-client.js",
  );
  return {
    ...actual,
    getWalletConnectClient: async () => {
      if (!mockSignClientHolder.current) {
        throw new Error("test setup: mockSignClient not initialized");
      }
      return mockSignClientHolder.current.client;
    },
  };
});

vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>("viem/actions");
  return {
    ...actual,
    getTransactionCount: (...args: Parameters<typeof actual.getTransactionCount>) => {
      if (!mockPublicHolder.current) throw new Error("test setup: mockPublic not initialized");
      return mockPublicHolder.current.__spies.getTransactionCount(...args);
    },
    estimateFeesPerGas: (...args: Parameters<typeof actual.estimateFeesPerGas>) => {
      if (!mockPublicHolder.current) throw new Error("test setup: mockPublic not initialized");
      return mockPublicHolder.current.__spies.estimateFeesPerGas(...args);
    },
    estimateGas: (...args: Parameters<typeof actual.estimateGas>) => {
      if (!mockPublicHolder.current) throw new Error("test setup: mockPublic not initialized");
      return mockPublicHolder.current.__spies.estimateGas(...args);
    },
    call: (...args: Parameters<typeof actual.call>) => {
      if (!mockPublicHolder.current) throw new Error("test setup: mockPublic not initialized");
      return mockPublicHolder.current.__spies.call(...args);
    },
  };
});

// readContract mock covers ALL the on-chain reads the three prepare tools
// perform during this integration test:
//   - prepare_eigenlayer_deposit: allowance (D-05) + totalShares + maxTotalDeposits (D-06)
//   - prepare_rocketpool_stake:   getMinimumDeposit (D-07)
//   - prepare_rocketpool_unstake: getBalance + getEthValue (D-08)
const MAX_UINT256 = 2n ** 256n - 1n;
const mockReadContract = vi.fn().mockImplementation(
  async ({ functionName }: { functionName: string }) => {
    if (functionName === "allowance") return MAX_UINT256; // happy-path D-05
    if (functionName === "totalShares") return 0n; // happy-path D-06
    if (functionName === "maxTotalDeposits") return MAX_UINT256; // unlimited cap
    if (functionName === "getMinimumDeposit") return 10_000_000_000_000_000n; // 0.01 ETH
    if (functionName === "getBalance") return 10_000_000_000_000_000_000n; // 10 ETH pool
    if (functionName === "getEthValue") return 1_100_000_000_000_000_000n; // 1.1 ETH for 1 rETH
    return 0n;
  },
);

vi.mock("../src/chains/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../src/chains/registry.js")>(
    "../src/chains/registry.js",
  );
  return {
    ...actual,
    getChainClient: vi.fn(() => ({ readContract: mockReadContract })),
  };
});

import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
} from "../src/demo/state.js";
import { PERSONAS } from "../src/demo/personas.js";

await import("../src/tools/register-all.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Fixture literals — hardcoded at write-time in test/signing-fingerprint.test.ts.
// Re-anchored here to assert byte-identity across persona swaps.
const FIXTURE_Z_FP = "0x2c36a77f8e39c8d0f8d276f88169608e1a247bb288117da00f90b1f7dd158684";
const FIXTURE_AA_RP_FP = "0x615683fb4b0cf540d1e5ba8f12c0766e542825557f769e60e83aa2cc76be0ca3";
const FIXTURE_AB_RP_FP = "0xd12144239fb353612c20a3aa0a9dbcd9dd73de4141e1adce866ecf0974854edc";

const FIXTURE_NONCE = 7;
const FIXTURE_GAS = 200_000n;
const FIXTURE_MAX_FEE = 30_000_000_000n;
const FIXTURE_MAX_PRIO = 1_500_000_000n;

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`${name} not registered`);
  const needsChain =
    /^(prepare_|get_|simulate_|check_)/.test(name) && !("chain" in args);
  const merged = needsChain ? { chain: "ethereum", ...args } : args;
  return tool.handler(merged);
}

function personaAddress(slug: "whale" | "stable-saver" | "defi-degen"): string {
  const found = PERSONAS.find((p) => p.slug === slug);
  if (!found) throw new Error(`persona ${slug} not found`);
  return found.address;
}

// Three personas anchored — proves from-independence holds across at least
// two distinct sender addresses. The plan requires "≥ 2 personas"; we test
// all three to follow the lido-lifecycle precedent (more witnesses; same
// byte-identity invariant).
const PERSONAS_UNDER_TEST: ReadonlyArray<"whale" | "stable-saver" | "defi-degen"> = [
  "whale",
  "stable-saver",
  "defi-degen",
];

beforeEach(() => {
  getStatusSpy.mockReset();
  getActiveSessionTopicSpy.mockReset();
  _resetHandleStoreForTesting();
  mockPublicHolder.current = createMockPublicClient();
  mockSignClientHolder.current = createMockSignClient();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "true";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  mockPublicHolder.current._setNonce(FIXTURE_NONCE);
  mockPublicHolder.current._setFees({
    maxFeePerGas: FIXTURE_MAX_FEE,
    maxPriorityFeePerGas: FIXTURE_MAX_PRIO,
  });
  mockPublicHolder.current._setGasEstimate(FIXTURE_GAS);
  mockPublicHolder.current._setCallResponse("0x");
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Fixture Z persona-independence — EigenLayer deposit (stETH-strategy, 1e18)
// ---------------------------------------------------------------------------
describe("integration-eigenlayer-rocketpool — Fixture Z persona-independence (EigenLayer deposit)", () => {
  it("prepare_eigenlayer_deposit: all 3 personas produce Fixture Z fingerprint (Z is from-INDEPENDENT)", async () => {
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_eigenlayer_deposit", {
        lst: "stETH",
        amount: "1.0",
      });
      expect(result.isError, `persona ${persona} failed prepare_eigenlayer_deposit`).toBeFalsy();
      const sc = result.structuredContent as { payloadFingerprint: string; from: string };
      // Fixture Z is from-INDEPENDENT — preimage carries (chainId, to,
      // valueWei, data) where data encodes (strategy, lstToken, amount) —
      // NO sender field. All personas produce the same fingerprint.
      expect(
        sc.payloadFingerprint,
        `STOP-THE-LINE: persona ${persona} produced wrong Fixture Z fingerprint — RELEASE BLOCKER`,
      ).toBe(FIXTURE_Z_FP);
      expect(sc.from).toBe(personaAddress(persona));
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture AA-RP persona-independence — Rocket Pool stake (value=1e18)
// ---------------------------------------------------------------------------
describe("integration-eigenlayer-rocketpool — Fixture AA-RP persona-independence (Rocket Pool stake)", () => {
  it("prepare_rocketpool_stake: all 3 personas produce Fixture AA-RP fingerprint (AA-RP is from-INDEPENDENT)", async () => {
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_rocketpool_stake", { amount: "1.0" });
      expect(result.isError, `persona ${persona} failed prepare_rocketpool_stake`).toBeFalsy();
      const sc = result.structuredContent as { payloadFingerprint: string; from: string };
      // Fixture AA-RP is from-INDEPENDENT — deposit() carries no calldata
      // args; the load-bearing fields in the preimage are (chainId, to,
      // valueWei, "0xd0e30db0"). No `from` slot.
      expect(
        sc.payloadFingerprint,
        `STOP-THE-LINE: persona ${persona} produced wrong Fixture AA-RP fingerprint — RELEASE BLOCKER`,
      ).toBe(FIXTURE_AA_RP_FP);
      expect(sc.from).toBe(personaAddress(persona));
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture AB-RP persona-independence — Rocket Pool unstake (rETH.burn(1e18))
// ---------------------------------------------------------------------------
describe("integration-eigenlayer-rocketpool — Fixture AB-RP persona-independence (Rocket Pool unstake)", () => {
  it("prepare_rocketpool_unstake: all 3 personas produce Fixture AB-RP fingerprint (AB-RP is from-INDEPENDENT)", async () => {
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_rocketpool_unstake", { rethAmount: "1.0" });
      expect(result.isError, `persona ${persona} failed prepare_rocketpool_unstake`).toBeFalsy();
      const sc = result.structuredContent as { payloadFingerprint: string; from: string };
      // Fixture AB-RP is from-INDEPENDENT — burn(uint256) calldata carries
      // only rethAmount (no owner / from slot). Preimage = (chainId, to,
      // 0, "0x42966c68" || amount). All personas produce the same fingerprint.
      expect(
        sc.payloadFingerprint,
        `STOP-THE-LINE: persona ${persona} produced wrong Fixture AB-RP fingerprint — RELEASE BLOCKER`,
      ).toBe(FIXTURE_AB_RP_FP);
      expect(sc.from).toBe(personaAddress(persona));
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-persona byte-identity sanity — all 3 fingerprints distinct across
// fixtures (proves the (chainId, to, valueWei, data) preimage discriminates
// between EigenLayer deposit / Rocket Pool stake / Rocket Pool burn).
// ---------------------------------------------------------------------------
describe("integration-eigenlayer-rocketpool — cross-fixture distinctness", () => {
  it("Fixtures Z, AA-RP, AB-RP are byte-DISTINCT (different (to, data) inputs → different fingerprints)", () => {
    const fps = new Set([FIXTURE_Z_FP, FIXTURE_AA_RP_FP, FIXTURE_AB_RP_FP]);
    expect(fps.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline regression — single persona; full prepare → preview → send for
// EigenLayer + Rocket Pool stake + Rocket Pool unstake. The previously-passing
// EigenLayer prepare-tool test re-anchors here at integration level.
// ---------------------------------------------------------------------------
describe("integration-eigenlayer-rocketpool — full pipeline (whale persona): prepare → preview → send for all 3 fixtures", () => {
  it("EigenLayer deposit pipeline: DECODED ARGS eigenlayer-deposit + EigenLayer LEDGER NOTICE + send simulation", async () => {
    setActivePersona("whale");

    const prepareResult = await callTool("prepare_eigenlayer_deposit", {
      lst: "stETH",
      amount: "1.0",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_Z_FP);

    const previewResult = await callTool("preview_send", { handle: prepareSc.handle });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";
    expect(previewText).toContain("LEDGER NOTICE");
    expect(previewText).toContain("EigenLayer depositIntoStrategy is NOT covered");
    expect(previewText).toContain("EigenLayer");

    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(previewSc.decodedArgs.kind).toBe("eigenlayer-deposit");
    expect(previewSc.ledgerNotice).toBe("eigenlayer-deposit-blind-sign");

    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as { simulated: boolean };
    expect(sendSc.simulated).toBe(true);
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(0);
  });

  it("Rocket Pool stake pipeline: DECODED ARGS rocketpool-stake + Rocket Pool LEDGER NOTICE + send simulation", async () => {
    setActivePersona("whale");

    const prepareResult = await callTool("prepare_rocketpool_stake", { amount: "1.0" });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_AA_RP_FP);

    const previewResult = await callTool("preview_send", { handle: prepareSc.handle });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";
    expect(previewText).toContain("LEDGER NOTICE");
    expect(previewText).toContain("Rocket Pool deposit/burn is NOT covered");
    expect(previewText).toContain("Rocket Pool stake");

    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(previewSc.decodedArgs.kind).toBe("rocketpool-stake");
    expect(previewSc.ledgerNotice).toBe("rocketpool-blind-sign");

    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
  });

  it("Rocket Pool unstake pipeline: DECODED ARGS rocketpool-burn + Rocket Pool LEDGER NOTICE + send simulation", async () => {
    setActivePersona("whale");

    const prepareResult = await callTool("prepare_rocketpool_unstake", { rethAmount: "1.0" });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_AB_RP_FP);

    const previewResult = await callTool("preview_send", { handle: prepareSc.handle });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";
    expect(previewText).toContain("LEDGER NOTICE");
    expect(previewText).toContain("Rocket Pool deposit/burn is NOT covered");
    expect(previewText).toContain("Rocket Pool unstake (burn)");

    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(previewSc.decodedArgs.kind).toBe("rocketpool-burn");
    expect(previewSc.ledgerNotice).toBe("rocketpool-blind-sign");

    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
  });
});
