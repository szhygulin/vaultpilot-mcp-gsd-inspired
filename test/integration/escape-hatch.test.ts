// Phase 35 Plan 35-03 (CUSTOM-01) — escape-hatch lifecycle INTEGRATION TEST.
//
// LOAD-BEARING end-to-end assertion that prepare_custom_call → preview_send
// → send_transaction works in demo mode AND that the cryptographic-binding
// chain stays `from`-independent across personas (Fixture P anchor).
//
// Also enforces:
//   - Test 3 — WARN block byte-identity across prepare + preview responses
//     (T-35-03-G mitigation; SOT template in blocks.ts).
//   - Test 6 — grep-guard: `acknowledgeNonProtocolTarget: true` assignment
//     appears in EXACTLY TWO source files (T-35-03-C bypass-flag
//     exclusivity defense).
//   - Test 7 — non-EVM bypass-flag-leak negative (Pitfall 1 — Solana/TRON/
//     BTC dispatch sites MUST NOT read the flag; enforced via static grep
//     against preview_send.ts).
//   - Test 8 — send_transaction Layer 3 fingerprint-drift gate fires for
//     escape-hatch handles unchanged (FROZEN three gates).
//
// STOP-THE-LINE on any failure here — Fixture P drift = the escape-hatch
// preimage assembly diverged from PREP-03; WARN byte-identity drift =
// tamper signal; bypass-flag count != 2 = exclusivity defense broken.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";

import {
  createMockPublicClient,
  type MockPublicClient,
} from "../helpers/mock-public-client.js";
import {
  createMockSignClient,
  type MockSignClient,
} from "../helpers/mock-sign-client.js";

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

vi.mock("../../src/wallet/session-manager.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/wallet/session-manager.js")>(
      "../../src/wallet/session-manager.js",
    );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) =>
      getStatusSpy(...args),
    getActiveSessionTopic: () => getActiveSessionTopicSpy(),
    pair: vi.fn(async () => {
      throw new Error(
        "pair should not be called from escape-hatch integration test",
      );
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("../../src/wallet/walletconnect-client.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/wallet/walletconnect-client.js")>(
      "../../src/wallet/walletconnect-client.js",
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
  const actual =
    await vi.importActual<typeof import("viem/actions")>("viem/actions");
  return {
    ...actual,
    getTransactionCount: (
      ...args: Parameters<typeof actual.getTransactionCount>
    ) => {
      if (!mockPublicHolder.current)
        throw new Error("test setup: mockPublic not initialized");
      return mockPublicHolder.current.__spies.getTransactionCount(...args);
    },
    estimateFeesPerGas: (
      ...args: Parameters<typeof actual.estimateFeesPerGas>
    ) => {
      if (!mockPublicHolder.current)
        throw new Error("test setup: mockPublic not initialized");
      return mockPublicHolder.current.__spies.estimateFeesPerGas(...args);
    },
    estimateGas: (...args: Parameters<typeof actual.estimateGas>) => {
      if (!mockPublicHolder.current)
        throw new Error("test setup: mockPublic not initialized");
      return mockPublicHolder.current.__spies.estimateGas(...args);
    },
    call: (...args: Parameters<typeof actual.call>) => {
      if (!mockPublicHolder.current)
        throw new Error("test setup: mockPublic not initialized");
      return mockPublicHolder.current.__spies.call(...args);
    },
  };
});

import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../../src/signing/handle-store.js";
import { _resetEtherscanAbiCacheForTesting } from "../../src/clients/etherscan.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../../src/tools/index.js";
import { _resetDemoModeForTesting } from "../../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
} from "../../src/demo/state.js";
import { PERSONAS } from "../../src/demo/personas.js";
import { FIXTURE_P_FP } from "../signing-fingerprint.test.js";

await import("../../src/tools/register-all.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const FIXTURE_NONCE = 7;
const FIXTURE_GAS = 50_000n;
const FIXTURE_MAX_FEE = 30_000_000_000n;
const FIXTURE_MAX_PRIO = 1_500_000_000n;

// Fixture P inputs (cross-link to test/signing-fingerprint.test.ts).
const FIXTURE_P_TO = "0x00000000000000000000000000000000DeaDBeef";
const FIXTURE_P_DATA = "0xdeadbeef";

const PERSONAS_UNDER_TEST: ReadonlyArray<
  "whale" | "stable-saver" | "defi-degen"
> = ["whale", "stable-saver", "defi-degen"];

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`${name} not registered`);
  const needsChain =
    /^(prepare_|get_|simulate_|check_|read_)/.test(name) &&
    !("chain" in args);
  const merged = needsChain ? { chain: "ethereum", ...args } : args;
  return tool.handler(merged);
}

function personaAddress(
  slug: "whale" | "stable-saver" | "defi-degen",
): string {
  const found = PERSONAS.find((p) => p.slug === slug);
  if (!found) throw new Error(`persona ${slug} not found`);
  return found.address;
}

beforeEach(() => {
  getStatusSpy.mockReset();
  getActiveSessionTopicSpy.mockReset();
  _resetHandleStoreForTesting();
  _resetEtherscanAbiCacheForTesting();
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
// Test 1 — Happy path under whale: prepare_custom_call → preview_send →
// send_transaction simulation. Fixture P fingerprint holds.
// ---------------------------------------------------------------------------
describe("escape-hatch lifecycle integration — happy path under whale", () => {
  it("prepare_custom_call → preview_send → send_transaction simulation; Fixture P fingerprint matches; signClient.request at 0 calls", async () => {
    setActivePersona("whale");

    // --- prepare_custom_call ---
    const prepareResult = await callTool("prepare_custom_call", {
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      from: string;
      to: string;
      data: string;
      payloadFingerprint: string;
      acknowledgeNonProtocolTarget: true;
    };
    expect(prepareSc.handle).toBeTruthy();
    // Fixture P CROSS-LINK — payloadFingerprint matches the
    // signing-fingerprint.test.ts hardcoded literal.
    expect(prepareSc.payloadFingerprint).toBe(FIXTURE_P_FP);
    expect(prepareSc.acknowledgeNonProtocolTarget).toBe(true);

    // --- preview_send ---
    const previewResult = await callTool("preview_send", {
      handle: prepareSc.handle,
    });
    expect(previewResult.isError).toBeFalsy();
    const previewSc = previewResult.structuredContent as {
      previewToken: string;
    };
    expect(previewSc.previewToken).toBeTruthy();

    const previewText = (
      previewResult.content as Array<{ type: string; text: string }>
    )[0].text;
    expect(previewText).toContain("[WARN — NON-PROTOCOL TARGET]");
    // Cache MISS — Blind sign literal text.
    expect(previewText).toContain("Blind sign — no ABI available");
    expect(previewText).toContain(FIXTURE_P_DATA.slice(0, 10));

    // --- send_transaction (demo simulation envelope) ---
    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    // signClient.request stays at 0 calls — demo mode returns a simulation
    // envelope without firing WC.
    expect(
      mockSignClientHolder.current!.__requestSpy,
    ).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Schema-gate refusal: ack: false rejects with structured refusal
// and the refusal text names canonical-alternative when the selector matches.
// ---------------------------------------------------------------------------
describe("escape-hatch — schema gate + canonical-alternative refusal", () => {
  it("refuses with NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED; refusal names prepare_token_send for ERC-20 transfer selector", async () => {
    setActivePersona("whale");
    // 0xa9059cbb selector → prepare_token_send canonical alternative.
    const erc20TransferData =
      "0xa9059cbb000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000000000000000000000000000000000000000000000000005f5e100";
    const res = await callTool("prepare_custom_call", {
      to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      data: erc20TransferData,
      // ack flag OMITTED — handler-side refusal fires.
    });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode: string }).errorCode).toBe(
      "NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED",
    );
    const text = (res.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toContain("prepare_token_send");
    expect(text).toContain("ERC-20 transfer");
  });
});

// ---------------------------------------------------------------------------
// Test 3 — WARN block byte-identity across prepare + preview responses.
// Drift = tamper signal (T-35-03-G mitigation).
// ---------------------------------------------------------------------------
describe("escape-hatch — WARN block byte-identity across prepare + preview", () => {
  it("WARN block body sentence is byte-identical at prepare and preview", async () => {
    setActivePersona("whale");

    const prepareResult = await callTool("prepare_custom_call", {
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    const prepareText = (
      prepareResult.content as Array<{ type: string; text: string }>
    )[0].text;
    const prepareSc = prepareResult.structuredContent as { handle: string };

    const previewResult = await callTool("preview_send", {
      handle: prepareSc.handle,
    });
    const previewText = (
      previewResult.content as Array<{ type: string; text: string }>
    )[0].text;

    // Extract the WARN block from both responses. Block starts with
    // `[WARN — NON-PROTOCOL TARGET]` and ends at the blank line BEFORE the
    // next block. We compare the body sentence verbatim — both sides emit
    // the SAME template body; the only intentional difference is the
    // {DECODED} slot (prepare-time deterministic placeholder vs preview-time
    // cache state). Body sentences MUST be byte-identical.
    const warnHeader = "[WARN — NON-PROTOCOL TARGET]";
    const warnBodySentinel =
      "This call BYPASSES the canonical-dispatch allowlist";
    expect(prepareText).toContain(warnHeader);
    expect(previewText).toContain(warnHeader);
    expect(prepareText).toContain(warnBodySentinel);
    expect(previewText).toContain(warnBodySentinel);

    // Body line-set equality: both responses contain the identical 5-line
    // body (the immutable template lines that follow the header — these are
    // the lines that would drift if a future contributor inlines a copy of
    // the template anywhere in the codebase).
    const immutableLines = [
      "  This call BYPASSES the canonical-dispatch allowlist. You explicitly",
      "  acknowledged this at prepare time (acknowledgeNonProtocolTarget: true).",
      "  If unsure, decline on-device.",
    ];
    for (const line of immutableLines) {
      expect(prepareText).toContain(line);
      expect(previewText).toContain(line);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4 — ABI cache MISS at preview surfaces the literal Blind sign text.
// (Re-anchors the Pitfall 4 invariant at the integration layer.)
// ---------------------------------------------------------------------------
describe("escape-hatch — ABI cache MISS preview decode", () => {
  it("without prior get_contract_abi, preview surfaces 'Blind sign — no ABI available' + the selector", async () => {
    setActivePersona("whale");

    const prepareResult = await callTool("prepare_custom_call", {
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    const prepareSc = prepareResult.structuredContent as { handle: string };
    const previewResult = await callTool("preview_send", {
      handle: prepareSc.handle,
    });
    const previewText = (
      previewResult.content as Array<{ type: string; text: string }>
    )[0].text;
    expect(previewText).toContain(
      "Blind sign — no ABI available. The selector 0xdeadbeef is shown on-device.",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Persona-cycle `from`-independence: same (chain, to, data, value)
// produces SAME Fixture P fingerprint across whale + stable-saver + defi-degen.
// ---------------------------------------------------------------------------
describe("escape-hatch — persona-cycle from-independence", () => {
  it("Fixture P fingerprint matches across all 3 personas (proves from is NOT in the preimage)", async () => {
    const fingerprints: string[] = [];
    const senders: string[] = [];
    for (const slug of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      setActivePersona(slug);
      const res = await callTool("prepare_custom_call", {
        to: FIXTURE_P_TO,
        data: FIXTURE_P_DATA,
        acknowledgeNonProtocolTarget: true,
      });
      expect(res.isError).toBeFalsy();
      const sc = res.structuredContent as {
        payloadFingerprint: string;
        from: string;
      };
      fingerprints.push(sc.payloadFingerprint);
      senders.push(sc.from);
    }
    // All 3 fingerprints MUST be identical AND match Fixture P.
    const unique = new Set(fingerprints);
    expect(unique.size).toBe(1);
    expect(fingerprints[0]).toBe(FIXTURE_P_FP);
    // All 3 senders MUST be DIFFERENT (each persona has a distinct address).
    const uniqueSenders = new Set(senders.map((s) => s.toLowerCase()));
    expect(uniqueSenders.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Grep-guard for bypass-flag exclusivity (T-35-03-C mitigation).
// `acknowledgeNonProtocolTarget: true` (or `= true`) assignment appears in
// EXACTLY TWO source files: prepare_custom_call.ts AND handle-store.ts.
// ---------------------------------------------------------------------------
describe("escape-hatch — bypass-flag exclusivity grep guard (T-35-03-C)", () => {
  it("acknowledgeNonProtocolTarget assignment lives in EXACTLY two source files", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const srcRoot = path.resolve(process.cwd(), "src");
    const assignmentPattern =
      /acknowledgeNonProtocolTarget:\s*true|acknowledgeNonProtocolTarget\s*=\s*true/;

    function* walk(dir: string): Generator<string> {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) yield* walk(p);
        else if (e.isFile() && p.endsWith(".ts")) yield p;
      }
    }

    const allowedFiles = new Set([
      path.resolve(srcRoot, "tools/prepare_custom_call.ts"),
      path.resolve(srcRoot, "signing/handle-store.ts"),
    ]);
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const content = fs.readFileSync(file, "utf8");
      // Per-line scan — skip comment lines AND string-literal lines
      // (template-body lines in blocks.ts contain the assignment-shaped
      // substring inside double-quoted strings; those are NOT real code
      // assignments). Filter out lines whose leading non-whitespace
      // character is a double-quote OR backtick.
      let hasAssignment = false;
      for (const line of content.split("\n")) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("//")) continue;
        if (trimmed.startsWith("*")) continue;
        if (trimmed.startsWith('"')) continue; // string-literal element
        if (trimmed.startsWith("`")) continue; // backtick template element
        if (assignmentPattern.test(line)) {
          hasAssignment = true;
          break;
        }
      }
      if (hasAssignment && !allowedFiles.has(file)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — Non-EVM bypass-flag-leak negative (Pitfall 1). The flag is read
// at EXACTLY ONE source-line in preview_send.ts (the EVM dispatch site).
// Solana/TRON/BTC dispatch sites (lines 2082+, 2811+, 2933+) do NOT read it.
// ---------------------------------------------------------------------------
describe("escape-hatch — non-EVM bypass-flag-leak negative (Pitfall 1)", () => {
  it("preview_send.ts has EXACTLY ONE non-comment read of record.acknowledgeNonProtocolTarget", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/tools/preview_send.ts"),
      "utf8",
    );
    let nonCommentReads = 0;
    for (const line of src.split("\n")) {
      if (!line.includes("record.acknowledgeNonProtocolTarget")) continue;
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//")) continue;
      if (trimmed.startsWith("*")) continue;
      nonCommentReads += 1;
    }
    // EXACTLY 1 = the EVM dispatch-site bypass. Solana/TRON/BTC branches
    // MUST NOT read the flag (Pitfall 1).
    expect(nonCommentReads).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test 8 — send_transaction Layer 3 fingerprint-drift gate fires for
// escape-hatch handles unchanged. FROZEN three gates UNCHANGED by Phase 35.
// ---------------------------------------------------------------------------
describe("escape-hatch — FROZEN Layer 3 fingerprint-drift gate (T-35-03-A)", () => {
  it("tampering with record.tx.data between prepare and send triggers PAYLOAD_FINGERPRINT_DRIFT", async () => {
    setActivePersona("whale");

    const prepareResult = await callTool("prepare_custom_call", {
      to: FIXTURE_P_TO,
      data: FIXTURE_P_DATA,
      acknowledgeNonProtocolTarget: true,
    });
    const prepareSc = prepareResult.structuredContent as { handle: string };

    // Run preview to mint the previewToken.
    const previewResult = await callTool("preview_send", {
      handle: prepareSc.handle,
    });
    const previewSc = previewResult.structuredContent as {
      previewToken: string;
    };

    // Tamper: directly mutate record.tx.data via the test-only peek helper.
    // In production this path is unreachable (the store is private); the
    // test simulates a state-corruption attack.
    const record = _peekHandleForTesting(prepareSc.handle);
    expect(record).not.toBeNull();
    // Mutate to a DIFFERENT calldata — drift gate must catch.
    (record as { tx: { data: Hex } }).tx.data =
      "0xcafebabe" as Hex;

    // send_transaction MUST refuse with PAYLOAD_FINGERPRINT_DRIFT.
    const sendResult = await callTool("send_transaction", {
      handle: prepareSc.handle,
      previewToken: previewSc.previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBe(true);
    expect(
      (sendResult.structuredContent as { errorCode: string }).errorCode,
    ).toBe("PAYLOAD_FINGERPRINT_DRIFT");
  });
});
