// Plan 28-04 — COMPOUND V3 LIFECYCLE INTEGRATION TEST
// (T-INTEGRATION-FROM-DRIFT-1 EXTENSION).
//
// LOAD-BEARING end-to-end assertion that the full 4-tool Compound V3 lifecycle
// (supply → borrow → repay → withdraw) works in demo mode AND that the
// cryptographic-binding chain is `from`-independent across persona swaps.
// Mirror of `test/aave-v3-lifecycle.integration.test.ts` extended to the
// Compound V3 surface.
//
// **Cryptographic-binding regression values asserted here** (byte-identical
// across all persona swaps — drift in the preimage assembly for ANY of the
// Compound V3 calldata shapes breaks one of these):
//
//   - Fixture R `payloadFingerprint` (supply USDC 100e6 on cUSDCv3):
//     `0x09410c3060d1da3b7434450f172e9951928c22b838193be3f7b9956a603dfa9d`
//   - Fixture S `payloadFingerprint` (withdraw USDC 100e6 on cUSDCv3):
//     `0x75d0cc3b899579ed4a7e2d8e6cb36386dc105ed97d326c73bcdafeed5dcfd70c`
//   - Fixture T `payloadFingerprint` (withdraw USDC 50e6 on cUSDCv3 — borrow
//     path; same calldata shape as Fixture S, distinct amount):
//     `0x7e31ff45686170495c8859b23712de665168bd53b44c248dc51459900246428c`
//   - Fixture U `payloadFingerprint` (supply USDC MAX_UINT256 on cUSDCv3 —
//     repay full-position-close):
//     `0x287f7b8731dbe64fbfcaf023382eb31c385a33938b52548887daef807f7e480c`
//
// PREP-03's preimage is `chainId || to || valueWei || data` — `from` is NOT
// in the preimage. The persona cycle here proves that invariant holds
// end-to-end across the 4 Compound V3 prepare-tool surfaces.
//
// **STOP-THE-LINE:** any fingerprint mismatch across personas means the
// cryptographic-binding chain became `from`-dependent. Release blocker.
//
// **Plan 28-04 additions:**
//   - LEDGER NOTICE block emitted on every Compound preview (research § Topic 8).
//   - Preview-time intent re-derivation surfaces in DECODED ARGS.
//   - get_lending_positions Aave rows BYTE-IDENTICAL to pre-28-04 shape (only
//     `protocol: "aave-v3"` field added).

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
      throw new Error("pair should not be called from compound-lifecycle integration test");
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

import { _compoundChains } from "../src/chains/compound-v3.js";
import { getCompoundCometAddress } from "../src/config/contracts.js";
import {
  FIXTURE_CMP_ARB_A,
  FIXTURE_CMP_BASE_A,
  FIXTURE_CMP_OPT_A,
  FIXTURE_CMP_POLY_A,
} from "./signing-fingerprint.test.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
} from "../src/demo/state.js";
import { PERSONAS } from "../src/demo/personas.js";
import {
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

// Trigger side-effect registration for all tools.
await import("../src/tools/register-all.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// RPC pins for preview_send (same shape as erc20-lifecycle integration test).
const FIXTURE_NONCE = 7;
const FIXTURE_GAS = 200_000n;
const FIXTURE_MAX_FEE = 30_000_000_000n;
const FIXTURE_MAX_PRIO = 1_500_000_000n;

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const cUSDCv3 = getCompoundCometAddress(1, "USDC")!;

// Phase 28 Plan 28-01 — pinned cryptographic-binding fixtures.
const FIXTURE_R_FINGERPRINT =
  "0x09410c3060d1da3b7434450f172e9951928c22b838193be3f7b9956a603dfa9d";
const FIXTURE_S_FINGERPRINT =
  "0x75d0cc3b899579ed4a7e2d8e6cb36386dc105ed97d326c73bcdafeed5dcfd70c";
const FIXTURE_T_FINGERPRINT =
  "0x7e31ff45686170495c8859b23712de665168bd53b44c248dc51459900246428c";
const FIXTURE_U_FINGERPRINT =
  "0x287f7b8731dbe64fbfcaf023382eb31c385a33938b52548887daef807f7e480c";

// Personas under test — three is sufficient to prove `from`-independence
// across the cryptographic-binding chain. Mirror of erc20-lifecycle.
const PERSONAS_UNDER_TEST: ReadonlyArray<"whale" | "stable-saver" | "defi-degen"> = [
  "whale",
  "stable-saver",
  "defi-degen",
];

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
  // Pin RPC mocks so preview_send works.
  mockPublicHolder.current._setNonce(FIXTURE_NONCE);
  mockPublicHolder.current._setFees({
    maxFeePerGas: FIXTURE_MAX_FEE,
    maxPriorityFeePerGas: FIXTURE_MAX_PRIO,
  });
  mockPublicHolder.current._setGasEstimate(FIXTURE_GAS);
  mockPublicHolder.current._setCallResponse("0x");
  // Phase 28 Plan 28-04 — preview-time deriveIntent fires for every Compound
  // preview. Mock to return the canonical 4-arm value for each call site.
  vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValue("supply-collateral");
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// LOAD-BEARING: full Compound V3 4-tool lifecycle under whale persona.
// supply → borrow → repay → withdraw, each pipeline runs prepare → preview →
// send simulation.
// ---------------------------------------------------------------------------

describe("Compound V3 lifecycle integration — 4-tool pipeline under whale persona", () => {
  it("prepare_compound_supply (Fixture R) → preview_send (LEDGER NOTICE emitted) → send simulation", async () => {
    setActivePersona("whale");
    const whaleAddress = personaAddress("whale");

    // --- prepare_compound_supply ---
    const prepareResult = await callTool("prepare_compound_supply", {
      comet: cUSDCv3,
      asset: USDC,
      amount: "100",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      from: string;
      payloadFingerprint: string;
    };
    expect(prepareSc.from).toBe(whaleAddress);
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_R_FINGERPRINT);

    // --- preview_send (Plan 28-04: LEDGER NOTICE emitted; intent re-derived) ---
    const previewResult = await callTool("preview_send", {
      handle: prepareSc.handle,
    });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";
    expect(previewText).toContain("LEDGER NOTICE");
    expect(previewText).toContain("Compound V3 supply / withdraw is NOT covered");
    expect(previewText).toContain("DECODED ARGS");
    expect(previewText).toContain("intent:    supply-collateral");

    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string; intent: string };
      ledgerNotice: string | null;
    };
    expect(previewSc.decodedArgs.kind).toBe("compound-supply");
    expect(previewSc.ledgerNotice).toBe("compound-v3-blind-sign");

    // --- send_transaction (demo simulation envelope) ---
    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
  });

  it("prepare_compound_borrow (Fixture T-shape) → preview_send (intent: borrow) → send simulation", async () => {
    setActivePersona("whale");
    // Override intent for the borrow tool — preview_send re-derivation runs.
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValue("borrow");

    const prepareResult = await callTool("prepare_compound_borrow", {
      comet: cUSDCv3,
      asset: USDC,
      amount: "50",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_T_FINGERPRINT);

    const previewResult = await callTool("preview_send", {
      handle: prepareSc.handle,
    });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";
    // The DERIVED intent surfaces in DECODED ARGS — the agent claimed
    // "prepare_compound_borrow"; the preview-time gate confirms it as `borrow`.
    expect(previewText).toContain("intent:    borrow");

    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string; intent: string };
    };
    expect(previewSc.decodedArgs.intent).toBe("borrow");

    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
  });

  it("prepare_compound_repay (Fixture U — \"max\" full-position-close) → preview_send → send simulation", async () => {
    setActivePersona("whale");
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValue("repay-debt");

    const prepareResult = await callTool("prepare_compound_repay", {
      comet: cUSDCv3,
      asset: USDC,
      amount: "max",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_U_FINGERPRINT);

    const previewResult = await callTool("preview_send", {
      handle: prepareSc.handle,
    });
    expect(previewResult.isError).toBeFalsy();
    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string; intent: string; isMax: boolean };
    };
    expect(previewSc.decodedArgs.intent).toBe("repay-debt");
    expect(previewSc.decodedArgs.isMax).toBe(true);

    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
  });

  it("prepare_compound_withdraw (Fixture S) → preview_send (intent: withdraw-collateral) → send simulation", async () => {
    setActivePersona("whale");
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValue("withdraw-collateral");

    const prepareResult = await callTool("prepare_compound_withdraw", {
      comet: cUSDCv3,
      asset: USDC,
      amount: "100",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_S_FINGERPRINT);

    const previewResult = await callTool("preview_send", {
      handle: prepareSc.handle,
    });
    expect(previewResult.isError).toBeFalsy();
    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string; intent: string };
    };
    expect(previewSc.decodedArgs.intent).toBe("withdraw-collateral");

    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// T-INTEGRATION-FROM-DRIFT-1 EXTENSION: byte-identity across persona swaps
// for Fixtures R / S / T / U.
// ---------------------------------------------------------------------------

describe("Compound V3 fingerprints — byte-identity across persona swaps (T-INTEGRATION-FROM-DRIFT-1 extension)", () => {
  it("Fixture R fingerprint stays at 0x09410c30... across whale / stable-saver / defi-degen", async () => {
    for (const persona of PERSONAS_UNDER_TEST) {
      setActivePersona(persona);
      const result = await callTool("prepare_compound_supply", {
        comet: cUSDCv3,
        asset: USDC,
        amount: "100",
      });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as {
        from: string;
        payloadFingerprint: string;
      };
      // `from` differs per persona — proves the binding chain doesn't
      // depend on it.
      expect(sc.from).toBe(personaAddress(persona));
      expect(sc.payloadFingerprint).toBe(FIXTURE_R_FINGERPRINT);
    }
  });

  it("Fixture S fingerprint stays at 0x75d0cc3b... across personas (withdraw 100e6 USDC)", async () => {
    for (const persona of PERSONAS_UNDER_TEST) {
      setActivePersona(persona);
      const result = await callTool("prepare_compound_withdraw", {
        comet: cUSDCv3,
        asset: USDC,
        amount: "100",
      });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { payloadFingerprint: string };
      expect(sc.payloadFingerprint).toBe(FIXTURE_S_FINGERPRINT);
    }
  });

  it("Fixture T fingerprint stays at 0x7e31ff45... across personas (borrow 50e6 — same calldata shape as withdraw)", async () => {
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValue("borrow");
    for (const persona of PERSONAS_UNDER_TEST) {
      setActivePersona(persona);
      const result = await callTool("prepare_compound_borrow", {
        comet: cUSDCv3,
        asset: USDC,
        amount: "50",
      });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { payloadFingerprint: string };
      expect(sc.payloadFingerprint).toBe(FIXTURE_T_FINGERPRINT);
    }
  });

  it("Fixture U fingerprint stays at 0x287f7b87... across personas (repay max — MAX_UINT256 sentinel)", async () => {
    // prepare_compound_repay's intent gate requires the on-chain state to
    // surface `repay-debt`. Mock the per-tool intent so the gate passes for
    // every persona in the cycle.
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValue("repay-debt");
    for (const persona of PERSONAS_UNDER_TEST) {
      setActivePersona(persona);
      const result = await callTool("prepare_compound_repay", {
        comet: cUSDCv3,
        asset: USDC,
        amount: "max",
      });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { payloadFingerprint: string };
      expect(sc.payloadFingerprint).toBe(FIXTURE_U_FINGERPRINT);
    }
  });
});

// ---------------------------------------------------------------------------
// Plan 28-04 — preview-time intent re-derivation defense-in-depth.
// ---------------------------------------------------------------------------

describe("Compound V3 — preview-time intent re-derivation (defense-in-depth)", () => {
  it("agent claims `supply` but on-chain debt > 0 → preview surfaces intent: repay-debt", async () => {
    // The agent calls prepare_compound_supply (claiming supply intent), but
    // the on-chain state has outstanding debt — the preview-time re-derivation
    // catches this and labels the operation as repay.
    setActivePersona("whale");
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("supply-collateral"); // prepare time
    const prepareResult = await callTool("prepare_compound_supply", {
      comet: cUSDCv3,
      asset: USDC,
      amount: "100",
    });
    const prepareSc = prepareResult.structuredContent as { handle: string };

    // Now mock deriveIntent to return repay-debt at PREVIEW time — simulating
    // on-chain state drift between prepare and preview.
    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValueOnce("repay-debt");

    const previewResult = await callTool("preview_send", { handle: prepareSc.handle });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";
    // The DERIVED intent surfaces — NOT the agent's tool-name claim.
    expect(previewText).toContain("intent:    repay-debt");

    const previewSc = previewResult.structuredContent as {
      decodedArgs: { intent: string };
    };
    expect(previewSc.decodedArgs.intent).toBe("repay-debt");
  });
});

// ---------------------------------------------------------------------------
// Phase 41 Plan 41-02 — per-L2 lifecycle round-trips.
//
// Proves that Task 1's gate removal works end-to-end: each L2 chain reaches
// the prepare → preview pipeline without a chainName-not-ethereum hard-refusal.
//
// Per-chain USDC base-token addresses (from 41-RESEARCH § Per-Chain Verified
// Comet Table — base token column):
//   Arbitrum native USDC:    0xaf88d065e77c8cC2239327C5EDb3A432268e5831
//   Base native USDC:        0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
//   Optimism native USDC:    0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85
//   Polygon bridged USDC.e:  0x2791bca1f2de4661ed88a30c99a7a9449aa84174
//
// The payloadFingerprint from each prepare call is cross-linked to the
// corresponding FIXTURE_CMP_<CHAIN>_A hardcoded literal from Task 2
// (test/signing-fingerprint.test.ts) — byte-identity enforced.
//
// NOTE on persona addresses: demo personas carry Ethereum addresses (0x...);
// the same address is used for L2 chains because Compound's prepare tool
// passes it as `from` and the payloadFingerprint preimage does NOT include
// `from` (T-INTEGRATION-FROM-DRIFT-1 — chainId + to + value + data only).
// The L2 payloadFingerprint is therefore from-INDEPENDENT and deterministic.
// ---------------------------------------------------------------------------

// Per-chain supply args (chain name, base-token address, comet getter key)
const L2_SUPPLY_CASES = [
  {
    chainName: "arbitrum" as const,
    chainId: 42161,
    token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    cometKey: "USDC" as const,
    fixture: FIXTURE_CMP_ARB_A,
    label: "Arbitrum",
  },
  {
    chainName: "base" as const,
    chainId: 8453,
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    cometKey: "USDC" as const,
    fixture: FIXTURE_CMP_BASE_A,
    label: "Base",
  },
  {
    chainName: "optimism" as const,
    chainId: 10,
    token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    cometKey: "USDC" as const,
    fixture: FIXTURE_CMP_OPT_A,
    label: "Optimism",
  },
  {
    chainName: "polygon" as const,
    chainId: 137,
    token: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    cometKey: "USDC.e" as const,
    fixture: FIXTURE_CMP_POLY_A,
    label: "Polygon",
  },
] as const;

describe("Phase 41 — Compound V3 L2 lifecycle round-trips (per-chain gate-removal regression)", () => {
  for (const { chainName, chainId, token, cometKey, fixture, label } of L2_SUPPLY_CASES) {
    it(`${label} (${chainName}): prepare_compound_supply → preview_send — no chain-gate refusal; fingerprint matches FIXTURE_CMP_${label.toUpperCase().slice(0, 4)}_A`, async () => {
      setActivePersona("whale");
      vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValue("supply-collateral");

      const comet = getCompoundCometAddress(chainId, cometKey)!;

      // --- prepare_compound_supply ---
      const prepareResult = await callTool("prepare_compound_supply", {
        chain: chainName,
        comet,
        asset: token,
        amount: "100",
      });

      // Gate-removal regression: must NOT produce a chain-gate refusal
      expect(prepareResult.isError, `${label} prepare unexpectedly errored`).toBeFalsy();
      const prepareText = prepareResult.content[0]?.text ?? "";
      expect(prepareText).not.toContain("v2.3 supports only");

      const prepareSc = prepareResult.structuredContent as {
        handle: string;
        payloadFingerprint: string;
      };

      // Cross-link: fingerprint must byte-match the hardcoded FIXTURE_CMP_<CHAIN>_A
      // literal pinned in test/signing-fingerprint.test.ts (Task 2).
      expect(prepareSc.payloadFingerprint).toBe(fixture);

      // --- preview_send (LEDGER NOTICE emitted — Compound has no CAL clear-sign) ---
      const previewResult = await callTool("preview_send", {
        handle: prepareSc.handle,
      });
      expect(previewResult.isError, `${label} preview unexpectedly errored`).toBeFalsy();
      const previewText = previewResult.content[0]?.text ?? "";
      expect(previewText).toContain("LEDGER NOTICE");
      expect(previewText).toContain("Compound V3 supply / withdraw is NOT covered");

      // --- send_transaction (demo simulation envelope) ---
      const previewSc = previewResult.structuredContent as {
        previewToken: string;
      };
      const sendResult = await callTool("send_transaction", {
        handle: prepareSc.handle,
        previewToken: previewSc.previewToken,
        userDecision: "send",
      });
      expect(sendResult.isError, `${label} send unexpectedly errored`).toBeFalsy();
    });
  }

  it("Persona-determinism on Arbitrum: same fingerprint across whale / stable-saver / defi-degen (from NOT in preimage)", async () => {
    const arbComet = getCompoundCometAddress(42161, "USDC")!;
    const arbToken = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

    vi.spyOn(_compoundChains, "deriveIntent").mockResolvedValue("supply-collateral");

    for (const persona of ["whale", "stable-saver", "defi-degen"] as const) {
      setActivePersona(persona);
      const result = await callTool("prepare_compound_supply", {
        chain: "arbitrum",
        comet: arbComet,
        asset: arbToken,
        amount: "100",
      });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as {
        from: string;
        payloadFingerprint: string;
      };
      // `from` differs per persona — proves the preimage is from-independent.
      expect(sc.from).toBe(personaAddress(persona));
      // Fingerprint stays pinned at FIXTURE_CMP_ARB_A regardless of persona.
      expect(sc.payloadFingerprint).toBe(FIXTURE_CMP_ARB_A);
    }
  });
});
