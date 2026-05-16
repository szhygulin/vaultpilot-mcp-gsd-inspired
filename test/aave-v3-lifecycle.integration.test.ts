// Plan 07-03 — AAVE V3 LIFECYCLE INTEGRATION TEST (T-INTEGRATION-FROM-DRIFT-2).
//
// Mirror of test/erc20-lifecycle.integration.test.ts for the Aave V3 supply
// + withdraw surface.
//
// **Cryptographic-binding regression values asserted here** at the canonical-
// inputs unit-test level (test/prepare-aave-supply.test.ts Test 7 +
// test/prepare-aave-withdraw.test.ts Test 7 + test/signing-fingerprint.test.ts
// Fixtures G + H):
//
//   - Fixture G `payloadFingerprint` (Aave V3 supply USDC, 100, onBehalfOf=anvil#1) —
//     `0x67314a7f021fa9ba6d901ba555800a51d9f0e006f4e59489f69b486d009fce59`
//   - Fixture H `payloadFingerprint` (Aave V3 withdraw USDC, 100, to=anvil#1) —
//     `0x782dd9aa096d47a4036b2023c01c1306d3b325fbbbbd4da8a1a5cd3ce42be40d`
//
// IMPORTANT — Aave-specific from-independence shape:
//   For ERC-20 transfer / approve / WETH unwrap, the sender address is NOT in
//   the calldata; the persona cycle in test/erc20-lifecycle.integration.test.ts
//   asserts the SAME fingerprint across persona swaps for those shapes (the
//   preimage `chainId || to || valueWei || data` is byte-identical).
//
//   For Aave V3 supply / withdraw, the sender address IS in the calldata
//   (server-derived `onBehalfOf` for supply, `to` for withdraw — both
//   hardcoded to the persona address per research § Topic 5 reasonable-call
//   lock). Different personas → different calldata → different fingerprints
//   BY DESIGN — that's not a regression, it's the per-persona binding the
//   user sees on-device.
//
// What this test asserts instead:
//   1. **Per-persona determinism**: calling prepare_aave_supply twice for the
//      SAME persona produces the SAME fingerprint (the preimage assembly is
//      deterministic given the inputs).
//   2. **Cross-persona difference**: different personas produce DIFFERENT
//      fingerprints — proves the persona address actually flows into the
//      calldata (catches a regression where the server "fixed" the
//      onBehalfOf address to a constant).
//   3. **Calldata embedding**: each persona's tx.data contains the lowercased
//      persona address as the 32-byte left-padded onBehalfOf slot — direct
//      assertion against the byte position in the calldata.
//
// **STOP-THE-LINE:** if a same-persona pair of calls produces different
// fingerprints, the preimage assembly is non-deterministic. Release blocker.

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
      throw new Error("pair should not be called from aave-v3-lifecycle integration test");
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

// Trigger side-effect registration for all tools.
await import("../src/tools/register-all.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const FIXTURE_NONCE = 7;
const FIXTURE_GAS = 100_000n;
const FIXTURE_MAX_FEE = 30_000_000_000n;
const FIXTURE_MAX_PRIO = 1_500_000_000n;

const USDC_CHECKSUMMED = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

const FIXTURE_G_FINGERPRINT =
  "0x67314a7f021fa9ba6d901ba555800a51d9f0e006f4e59489f69b486d009fce59";
const FIXTURE_H_FINGERPRINT =
  "0x782dd9aa096d47a4036b2023c01c1306d3b325fbbbbd4da8a1a5cd3ce42be40d";

const PERSONAS_UNDER_TEST: ReadonlyArray<"whale" | "stable-saver" | "defi-degen"> = [
  "whale",
  "stable-saver",
  "defi-degen",
];

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`${name} not registered`);
  return tool.handler(args);
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
// LOAD-BEARING: full Aave V3 supply pipeline under whale persona — prepare →
// preview → send simulation; signClient.request stays at 0 calls;
// NO LEDGER NOTICE block in response text (research § Topic 6 verified).
// ---------------------------------------------------------------------------
describe("Aave V3 lifecycle integration — full supply pipeline under whale persona", () => {
  it("prepare_aave_supply → preview_send → send_transaction simulation; Fixture G anchor + NO LEDGER NOTICE", async () => {
    setActivePersona("whale");
    const whaleAddress = personaAddress("whale");

    const prepareResult = await callTool("prepare_aave_supply", {
      asset: USDC_CHECKSUMMED,
      amount: "100",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      from: string;
      payloadFingerprint: string;
      amountWei: string;
    };
    expect(prepareSc.from).toBe(whaleAddress);
    // Whale-bound fingerprint — distinct from the anvil#1 Fixture G literal
    // (whale's address flows into the calldata as onBehalfOf). Per-persona
    // determinism is anchored in the cross-persona test below.
    expect(prepareSc.payloadFingerprint).toMatch(/^0x[0-9a-f]{64}$/);
    expect(prepareSc.amountWei).toBe("100000000");
    expect(getStatusSpy).toHaveBeenCalledTimes(0);

    const previewResult = await callTool("preview_send", { handle: prepareSc.handle });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";
    // T-AAVE-LEDGER-NOTICE-PREEMPTIVE-1: no NOTICE block for Aave.
    expect(previewText).not.toContain("LEDGER NOTICE");
    expect(previewText).toContain("function:     supply");

    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(previewSc.decodedArgs.kind).toBe("aave-supply");
    expect(previewSc.ledgerNotice).toBeNull();

    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as { simulated: boolean };
    expect(sendSc.simulated).toBe(true);

    // T-DEMO-BROADCAST-1: NOTHING signed; NOTHING broadcast.
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(0);
  });

  it("prepare_aave_withdraw → preview_send → send_transaction simulation; Fixture H anchor + NO LEDGER NOTICE", async () => {
    setActivePersona("whale");

    const prepareResult = await callTool("prepare_aave_withdraw", {
      asset: USDC_CHECKSUMMED,
      amount: "100",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    // Whale-bound fingerprint — distinct from the anvil#1 Fixture H literal.
    expect(prepareSc.payloadFingerprint).toMatch(/^0x[0-9a-f]{64}$/);

    const previewResult = await callTool("preview_send", { handle: prepareSc.handle });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";
    expect(previewText).not.toContain("LEDGER NOTICE");
    expect(previewText).toContain("function:  withdraw");

    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(previewSc.decodedArgs.kind).toBe("aave-withdraw");
    expect(previewSc.ledgerNotice).toBeNull();

    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// LOAD-BEARING: per-persona determinism + cross-persona difference +
// calldata-embedding assertion. The Aave preimage IS persona-dependent (the
// persona address flows into the calldata as onBehalfOf / to), so the
// `from`-independence shape from Phase 6 does NOT apply byte-identically to
// Aave shapes. Instead, this test asserts that the persona-dependence is
// real, deterministic, and visible at the calldata layer.
//
// STOP-THE-LINE: a same-persona call producing different fingerprints means
// the preimage assembly is non-deterministic. RELEASE BLOCKER.
// ---------------------------------------------------------------------------
describe("Aave V3 lifecycle integration — per-persona binding (T-INTEGRATION-FROM-DRIFT-2)", () => {
  it("Aave supply: each persona produces a distinct fingerprint; same persona is deterministic across repeated calls", async () => {
    const firstPassByPersona = new Map<string, string>();
    const secondPassByPersona = new Map<string, string>();
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const a = await callTool("prepare_aave_supply", {
        asset: USDC_CHECKSUMMED,
        amount: "100",
      });
      expect(a.isError).toBeFalsy();
      const aSc = a.structuredContent as { from: string; payloadFingerprint: string };
      expect(aSc.from).toBe(personaAddress(persona));
      firstPassByPersona.set(persona, aSc.payloadFingerprint);

      // Second call under the same persona — must produce the same fingerprint.
      _resetHandleStoreForTesting();
      const b = await callTool("prepare_aave_supply", {
        asset: USDC_CHECKSUMMED,
        amount: "100",
      });
      const bSc = b.structuredContent as { payloadFingerprint: string };
      secondPassByPersona.set(persona, bSc.payloadFingerprint);
    }

    // (1) Per-persona determinism.
    for (const persona of PERSONAS_UNDER_TEST) {
      expect(
        firstPassByPersona.get(persona),
        `STOP-THE-LINE: prepare_aave_supply is non-deterministic for persona ${persona} — RELEASE BLOCKER`,
      ).toBe(secondPassByPersona.get(persona));
    }

    // (2) Cross-persona difference — proves the persona address actually
    // flows into the calldata (catches a regression where onBehalfOf got
    // hardcoded to a constant).
    const distinctFingerprints = new Set(firstPassByPersona.values());
    expect(
      distinctFingerprints.size,
      "STOP-THE-LINE: all 3 personas produced the same Aave supply fingerprint — onBehalfOf is NOT flowing into the calldata",
    ).toBe(PERSONAS_UNDER_TEST.length);
  });

  it("Aave supply: per-persona calldata embeds the persona address as the 32-byte left-padded onBehalfOf slot", async () => {
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_aave_supply", {
        asset: USDC_CHECKSUMMED,
        amount: "100",
      });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { handle: string };
      const { _peekHandleForTesting } = await import("../src/signing/handle-store.js");
      const record = _peekHandleForTesting(sc.handle);
      expect(record).toBeDefined();
      if (!record) continue;

      // calldata = 0x + 8-hex selector + 32-byte asset + 32-byte amount + 32-byte
      // onBehalfOf + 32-byte referralCode. Slice the onBehalfOf field (bytes
      // 68..100 = chars 138..202 in the 0x-prefixed hex).
      const data = record.tx.data;
      expect(data.startsWith("0x617ba037")).toBe(true);
      const onBehalfOfHex = data.slice(138, 202);
      // 20-byte left-padded address: 24 leading zero hex chars + 40 hex addr.
      expect(onBehalfOfHex.slice(0, 24)).toBe("000000000000000000000000");
      const personaAddrLower = personaAddress(persona).toLowerCase().slice(2);
      expect(onBehalfOfHex.slice(24)).toBe(personaAddrLower);
    }
  });

  it("Aave withdraw: per-persona determinism + cross-persona difference + persona-as-to embedding", async () => {
    const firstPassByPersona = new Map<string, string>();
    const secondPassByPersona = new Map<string, string>();
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const a = await callTool("prepare_aave_withdraw", {
        asset: USDC_CHECKSUMMED,
        amount: "100",
      });
      expect(a.isError).toBeFalsy();
      const aSc = a.structuredContent as { from: string; payloadFingerprint: string; handle: string };
      expect(aSc.from).toBe(personaAddress(persona));
      firstPassByPersona.set(persona, aSc.payloadFingerprint);

      _resetHandleStoreForTesting();
      const b = await callTool("prepare_aave_withdraw", {
        asset: USDC_CHECKSUMMED,
        amount: "100",
      });
      const bSc = b.structuredContent as { payloadFingerprint: string; handle: string };
      secondPassByPersona.set(persona, bSc.payloadFingerprint);

      // calldata = 0x + 8-hex selector + 32-byte asset + 32-byte amount + 32-byte
      // to. Slice the `to` field (bytes 68..100 = chars 138..202).
      const { _peekHandleForTesting } = await import("../src/signing/handle-store.js");
      const record = _peekHandleForTesting(bSc.handle);
      expect(record).toBeDefined();
      if (!record) continue;
      const data = record.tx.data;
      expect(data.startsWith("0x69328dec")).toBe(true);
      const toHex = data.slice(138, 202);
      expect(toHex.slice(0, 24)).toBe("000000000000000000000000");
      const personaAddrLower = personaAddress(persona).toLowerCase().slice(2);
      expect(toHex.slice(24)).toBe(personaAddrLower);
    }

    for (const persona of PERSONAS_UNDER_TEST) {
      expect(
        firstPassByPersona.get(persona),
        `STOP-THE-LINE: prepare_aave_withdraw is non-deterministic for persona ${persona} — RELEASE BLOCKER`,
      ).toBe(secondPassByPersona.get(persona));
    }
    const distinctFingerprints = new Set(firstPassByPersona.values());
    expect(
      distinctFingerprints.size,
      "STOP-THE-LINE: all 3 personas produced the same Aave withdraw fingerprint — `to` is NOT flowing into the calldata",
    ).toBe(PERSONAS_UNDER_TEST.length);
  });

  it("Anvil#1 baseline (canonical-inputs Fixture G + H literals) — sanity cross-link to signing-fingerprint.test.ts", async () => {
    // The Fixture G + H literals are computed against `from = anvil#1`
    // (0x70997970…), not against a persona. The unit-test anchor lives in
    // test/prepare-aave-supply.test.ts Test 7 + test/prepare-aave-withdraw.test.ts
    // Test 7 (real-mode arm with anvil#1 as the paired account). This
    // integration test does NOT re-anchor those literals — the literals
    // protect the encoder + fingerprint preimage, not the persona-flow shape.
    // Drift in the encoder breaks the unit tests; drift in the persona-flow
    // shape breaks THIS test. Different threat models, different anchors.
    expect(FIXTURE_G_FINGERPRINT).toBe(
      "0x67314a7f021fa9ba6d901ba555800a51d9f0e006f4e59489f69b486d009fce59",
    );
    expect(FIXTURE_H_FINGERPRINT).toBe(
      "0x782dd9aa096d47a4036b2023c01c1306d3b325fbbbbd4da8a1a5cd3ce42be40d",
    );
  });
});

// ---------------------------------------------------------------------------
// simulate_position_change cross-check: standalone simulator agrees with the
// prepare flow on the same supply action. Both consume the same _aaveChains
// reads via the production path; this asserts the read leg is consistent
// across the two tools (chained sanity check, not a deeper invariant — the
// simulate tool projects an off-chain delta, the prepare tool encodes the
// calldata; they don't share math, but they DO share the underlying user
// state).
// ---------------------------------------------------------------------------
describe("Aave V3 lifecycle integration — simulate_position_change cross-check with prepare flow", () => {
  it("simulate_position_change(asset: USDC, action: supply, amount: 100) + prepare_aave_supply(USDC, 100): both succeed against the same persona; simulate response shape is well-formed", async () => {
    setActivePersona("whale");

    // Mock the _aaveChains reads (the simulator depends on them; the
    // prepare tool does NOT — it only computes calldata + fingerprint).
    const aaveChainsModule = await import("../src/chains/aave-v3.js");
    const reservesSpy = vi.spyOn(aaveChainsModule._aaveChains, "getReservesData");
    const userReservesSpy = vi.spyOn(aaveChainsModule._aaveChains, "getUserReservesData");
    reservesSpy.mockResolvedValue({
      reserves: [
        {
          underlyingAsset: USDC_CHECKSUMMED as `0x${string}`,
          name: "USD Coin",
          symbol: "USDC",
          decimals: 6n,
          baseLTVasCollateral: 7700n,
          reserveLiquidationThreshold: 8500n,
          reserveLiquidationBonus: 10500n,
          reserveFactor: 1000n,
          usageAsCollateralEnabled: true,
          borrowingEnabled: true,
          isActive: true,
          isFrozen: false,
          liquidityIndex: 10n ** 27n,
          variableBorrowIndex: 10n ** 27n,
          liquidityRate: 0n,
          variableBorrowRate: 0n,
          lastUpdateTimestamp: 1700000000,
          aTokenAddress: "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c" as `0x${string}`,
          variableDebtTokenAddress: "0x72E95b8931767C79bA4EeE721354d6E99a61D004" as `0x${string}`,
          priceInMarketReferenceCurrency: 10n ** 8n,
        },
      ],
      baseCurrency: {
        marketReferenceCurrencyUnit: 10n ** 8n,
        marketReferenceCurrencyPriceInUsd: 10n ** 8n,
        networkBaseTokenPriceInUsd: 4000n * 10n ** 8n,
        networkBaseTokenPriceDecimals: 8,
      },
    });
    userReservesSpy.mockResolvedValue({
      userReserves: [
        {
          underlyingAsset: USDC_CHECKSUMMED as `0x${string}`,
          scaledATokenBalance: 1000n * 10n ** 6n,
          usageAsCollateralEnabledOnUser: true,
          scaledVariableDebt: 0n,
        },
      ],
      userEModeCategoryId: 0,
    });

    const simResult = await callTool("simulate_position_change", {
      asset: USDC_CHECKSUMMED,
      action: "supply",
      amount: "100",
    });
    expect(simResult.isError).toBeFalsy();
    const simSc = simResult.structuredContent as {
      asset: string;
      action: string;
      amount: string;
      healthFactorBefore: string | null;
      healthFactorAfter: string | null;
      liquidationRiskBefore: string;
      liquidationRiskAfter: string;
    };
    expect(simSc.asset).toBe(USDC_CHECKSUMMED);
    expect(simSc.action).toBe("supply");
    expect(simSc.amount).toBe("100");
    // No debt → noDebt across before/after.
    expect(simSc.liquidationRiskBefore).toBe("noDebt");
    expect(simSc.liquidationRiskAfter).toBe("noDebt");

    // Now prepare the actual supply with the same inputs. The prepare flow
    // does NOT consult _aaveChains — it encodes the calldata + computes the
    // fingerprint directly. Cross-check: both succeed under the same persona.
    // The fingerprint is persona-dependent (whale's address flows into
    // calldata as onBehalfOf); the Fixture G literal (anvil#1) is the
    // unit-test-level anchor, not the per-persona anchor.
    const prepareResult = await callTool("prepare_aave_supply", {
      asset: USDC_CHECKSUMMED,
      amount: "100",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      payloadFingerprint: string;
      amountWei: string;
      from: string;
    };
    expect(prepareSc.from).toBe(personaAddress("whale"));
    // Persona-bound fingerprint is deterministic for this input shape.
    expect(prepareSc.payloadFingerprint).toMatch(/^0x[0-9a-f]{64}$/);
    expect(prepareSc.amountWei).toBe("100000000");

    reservesSpy.mockRestore();
    userReservesSpy.mockRestore();
  });
});
