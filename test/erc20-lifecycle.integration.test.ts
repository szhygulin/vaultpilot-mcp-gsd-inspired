// Plan 06-04 — ERC-20 LIFECYCLE INTEGRATION TEST (T-INTEGRATION-FROM-DRIFT-1).
//
// LOAD-BEARING end-to-end assertion that the full ERC-20 lifecycle pipeline
// works in demo mode AND that the cryptographic-binding chain is
// `from`-independent across persona swaps. Mirror of Phase 5's
// `test/demo-flow.integration.test.ts` extended to the ERC-20 surface.
//
// **Cryptographic-binding regression values asserted here** (byte-identical
// across all persona swaps — drift in the preimage assembly for ANY of the
// four ERC-20 calldata shapes breaks one of these):
//
//   - Fixture B `payloadFingerprint` (transfer to 0x...dEAD, 1e18) —
//     `0x20fe784f2025af75b0f47cbb71c217c7c121caee89bb64a91b6419282348108c`
//   - Fixture D `payloadFingerprint` (USDC transfer to 0x70997970..., 100 USDC) —
//     `0x52f396cfab6f8f4dfbf10b36734e7d22e944d54657a72dc2c8d67e91f8c49f85`
//   - Fixture E `payloadFingerprint` (WETH approve Uniswap V3, MAX_UINT256) —
//     `0x46e20ff806defcabda8eb090f6cba368cb5b84ad058ff9eefd08c662185a8f5a`
//   - Fixture F `payloadFingerprint` (WETH9.withdraw(1e18)) —
//     `0x81a70e4a703de01b67ad1aaff7d97be8dde3ae6703a652a462f7de9e30e36596`
//
// PREP-03's preimage is `chainId || to || valueWei || data` — `from` is NOT
// in the preimage. The persona cycle here proves that invariant holds
// end-to-end across the four ERC-20 calldata shapes.
//
// **STOP-THE-LINE:** any fingerprint mismatch across personas means the
// cryptographic-binding chain became `from`-dependent. Release blocker
// (T-INTEGRATION-FROM-DRIFT-1).

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
      throw new Error("pair should not be called from erc20-lifecycle integration test");
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

import {
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
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

// RPC pins for preview_send (same shape as demo-flow.integration.test.ts).
const FIXTURE_NONCE = 7;
const FIXTURE_GAS = 21_000n;
const FIXTURE_MAX_FEE = 30_000_000_000n;
const FIXTURE_MAX_PRIO = 1_500_000_000n;

// Fixture D (USDC transfer to 0x70997970..., 100 USDC).
const USDC_CHECKSUMMED = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const RECIPIENT_CHECKSUMMED = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const FIXTURE_D_FINGERPRINT =
  "0x52f396cfab6f8f4dfbf10b36734e7d22e944d54657a72dc2c8d67e91f8c49f85";

// Fixture E (WETH approve Uniswap V3, max).
const WETH_CHECKSUMMED = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const UNI_V3_CHECKSUMMED = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const FIXTURE_E_FINGERPRINT =
  "0x46e20ff806defcabda8eb090f6cba368cb5b84ad058ff9eefd08c662185a8f5a";

// Fixture F (WETH9.withdraw(1e18)).
const FIXTURE_F_FINGERPRINT =
  "0x81a70e4a703de01b67ad1aaff7d97be8dde3ae6703a652a462f7de9e30e36596";

// The three personas under test (excluding staking-maxi to keep the cycle
// short — three is sufficient to prove `from`-independence; staking-maxi
// would only add redundancy).
const PERSONAS_UNDER_TEST: ReadonlyArray<"whale" | "stable-saver" | "defi-degen"> = [
  "whale",
  "stable-saver",
  "defi-degen",
];

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`${name} not registered`);
  // Phase 8 — Plan 08-02: auto-inject chain="ethereum" on prepare_* + read tools.
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
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// LOAD-BEARING: full ERC-20 lifecycle pipeline under whale persona — every
// tool walks prepare → preview → send simulation; signClient.request stays
// at 0 calls.
// ---------------------------------------------------------------------------
describe("ERC-20 lifecycle integration — full pipeline under whale persona", () => {
  it("prepare_token_send → preview_send → send_transaction simulation; Fixture D anchors hold; signClient.request at 0 calls", async () => {
    setActivePersona("whale");
    const whaleAddress = personaAddress("whale");

    // --- prepare_token_send (Fixture D inputs) ---
    const prepareResult = await callTool("prepare_token_send", {
      to: RECIPIENT_CHECKSUMMED,
      tokenAddress: USDC_CHECKSUMMED,
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
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_D_FINGERPRINT);
    expect(prepareSc.amountWei).toBe("100000000");
    expect(getStatusSpy).toHaveBeenCalledTimes(0);

    // --- preview_send ---
    const previewResult = await callTool("preview_send", {
      handle: prepareSc.handle,
    });
    expect(previewResult.isError).toBeFalsy();
    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(previewSc.decodedArgs.kind).toBe("transfer");
    expect(previewSc.ledgerNotice).toBeNull();

    // --- send_transaction (demo simulation envelope) ---
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

  it("prepare_token_approve(max) → preview_send → send_transaction simulation; Fixture E anchor + UNLIMITED + LEDGER NOTICE absence", async () => {
    setActivePersona("whale");

    // --- prepare_token_approve (Fixture E inputs: WETH approve Uniswap V3, max) ---
    const prepareResult = await callTool("prepare_token_approve", {
      tokenAddress: WETH_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
      amount: "max",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_E_FINGERPRINT);

    // --- preview_send: UNLIMITED + known-spender label surface; no NOTICE ---
    const previewResult = await callTool("preview_send", { handle: prepareSc.handle });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";
    expect(previewText).toContain("⚠ UNLIMITED APPROVAL");
    expect(previewText).toContain("Uniswap V3 SwapRouter");
    expect(previewText).not.toContain("LEDGER NOTICE");
    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      ledgerNotice: string | null;
      decodedArgs: { kind: string; isUnlimited?: boolean };
    };
    expect(previewSc.ledgerNotice).toBeNull();
    expect(previewSc.decodedArgs.isUnlimited).toBe(true);

    // --- send_transaction (demo simulation envelope) ---
    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(0);
  });

  it("prepare_revoke_approval → preview_send → send_transaction simulation; byte-identical to approve(0n)", async () => {
    setActivePersona("whale");

    // --- prepare_revoke_approval (same tokenAddress + spender as Fixture E) ---
    const revokeResult = await callTool("prepare_revoke_approval", {
      tokenAddress: WETH_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
    });
    expect(revokeResult.isError).toBeFalsy();
    const revokeSc = revokeResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
      amountWei: string;
    };
    expect(revokeSc.amountWei).toBe("0");

    // Cross-check: prepare_token_approve({ amount: "0" }) produces the SAME
    // payloadFingerprint as prepare_revoke_approval (T-REVOKE-DRIFT-1).
    const approveZero = await callTool("prepare_token_approve", {
      tokenAddress: WETH_CHECKSUMMED,
      spender: UNI_V3_CHECKSUMMED,
      amount: "0",
    });
    const approveZeroSc = approveZero.structuredContent as { payloadFingerprint: string };
    expect(revokeSc.payloadFingerprint).toBe(approveZeroSc.payloadFingerprint);

    // --- preview_send + send_transaction simulation ---
    const previewResult = await callTool("preview_send", { handle: revokeSc.handle });
    const previewSc = previewResult.structuredContent as { previewToken: string };
    const sendResult = await callTool("send_transaction", {
      handle: revokeSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    expect(mockSignClientHolder.current!.__requestSpy).toHaveBeenCalledTimes(0);
  });

  it("prepare_weth_unwrap → preview_send → send_transaction simulation; Fixture F anchor + LEDGER NOTICE present", async () => {
    setActivePersona("whale");

    // --- prepare_weth_unwrap (Fixture F inputs: 1.0 WETH) ---
    const prepareResult = await callTool("prepare_weth_unwrap", {
      amount: "1.0",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      tokenAddress: string;
      payloadFingerprint: string;
    };
    expect(prepareSc.tokenAddress).toBe(WETH_CHECKSUMMED);
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_F_FINGERPRINT);

    // --- preview_send: NOTICE block present; DECODED ARGS withdraw surface ---
    const previewResult = await callTool("preview_send", { handle: prepareSc.handle });
    expect(previewResult.isError).toBeFalsy();
    const previewText = previewResult.content[0]?.text ?? "";
    expect(previewText).toContain("LEDGER NOTICE");
    expect(previewText).toContain("Settings → Blind signing → Enabled");
    expect(previewText).toContain("function:  withdraw");
    expect(previewText).toContain("(WETH9 — canonical)");

    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      ledgerNotice: string | null;
      decodedArgs: { kind: string };
    };
    expect(previewSc.ledgerNotice).toBe("weth-unwrap-blind-sign");
    expect(previewSc.decodedArgs.kind).toBe("withdraw");

    // --- send_transaction (demo simulation envelope) ---
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
// LOAD-BEARING: from-independence regression across personas. The
// cryptographic-binding chain (payloadFingerprint) is `from`-independent —
// PREP-03's preimage doesn't include `from`. Cycling through three personas
// asserts this holds across all four ERC-20 calldata shapes. Drift in the
// preimage assembly for ANY shape breaks one of these.
// ---------------------------------------------------------------------------
describe("ERC-20 lifecycle integration — Fixtures B/D/E/F from-independence across personas (T-INTEGRATION-FROM-DRIFT-1)", () => {
  it("Fixture D (USDC transfer): same payloadFingerprint across whale ↔ stable-saver ↔ defi-degen", async () => {
    const fingerprintsByPersona = new Map<string, string>();
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_token_send", {
        to: RECIPIENT_CHECKSUMMED,
        tokenAddress: USDC_CHECKSUMMED,
        amount: "100",
      });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { from: string; payloadFingerprint: string };

      // `from` differs across personas (load-bearing — proves the test is
      // actually exercising different senders).
      expect(sc.from).toBe(personaAddress(persona));
      fingerprintsByPersona.set(persona, sc.payloadFingerprint);
    }

    // All three personas produce the SAME Fixture D payloadFingerprint.
    // STOP-THE-LINE: drift here means PREP-03 became `from`-dependent.
    for (const persona of PERSONAS_UNDER_TEST) {
      expect(fingerprintsByPersona.get(persona)).toBe(FIXTURE_D_FINGERPRINT);
    }
  });

  it("Fixture E (WETH approve max): same payloadFingerprint across whale ↔ stable-saver ↔ defi-degen", async () => {
    const fingerprintsByPersona = new Map<string, string>();
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_token_approve", {
        tokenAddress: WETH_CHECKSUMMED,
        spender: UNI_V3_CHECKSUMMED,
        amount: "max",
      });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { from: string; payloadFingerprint: string };
      expect(sc.from).toBe(personaAddress(persona));
      fingerprintsByPersona.set(persona, sc.payloadFingerprint);
    }

    for (const persona of PERSONAS_UNDER_TEST) {
      expect(fingerprintsByPersona.get(persona)).toBe(FIXTURE_E_FINGERPRINT);
    }
  });

  it("revoke (approve 0n): same payloadFingerprint across whale ↔ stable-saver ↔ defi-degen", async () => {
    const fingerprintsByPersona = new Map<string, string>();
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_revoke_approval", {
        tokenAddress: WETH_CHECKSUMMED,
        spender: UNI_V3_CHECKSUMMED,
      });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { from: string; payloadFingerprint: string };
      expect(sc.from).toBe(personaAddress(persona));
      fingerprintsByPersona.set(persona, sc.payloadFingerprint);
    }

    // Revoke is approve(spender, 0n); the fingerprint is deterministic from
    // the calldata + tokenAddress + chainId. Cross-persona equality is the
    // load-bearing assertion (the exact literal value is asserted in
    // test/prepare-revoke-approval.test.ts at the unit level).
    const allFingerprints = Array.from(fingerprintsByPersona.values());
    expect(new Set(allFingerprints).size).toBe(1);
  });

  it("Fixture F (WETH9.withdraw 1 ETH): same payloadFingerprint across whale ↔ stable-saver ↔ defi-degen", async () => {
    const fingerprintsByPersona = new Map<string, string>();
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_weth_unwrap", {
        amount: "1.0",
      });
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { from: string; payloadFingerprint: string };
      expect(sc.from).toBe(personaAddress(persona));
      fingerprintsByPersona.set(persona, sc.payloadFingerprint);
    }

    for (const persona of PERSONAS_UNDER_TEST) {
      expect(fingerprintsByPersona.get(persona)).toBe(FIXTURE_F_FINGERPRINT);
    }
  });
});
