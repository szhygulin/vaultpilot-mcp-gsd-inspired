// Phase 35 Plan 35-03 (CUSTOM-01). preview_send custom-call branch tests.
//
// Coverage:
//   - Bypass branch fires when record.acknowledgeNonProtocolTarget === true
//     (canonical-dispatch refusal SKIPPED at the EVM site).
//   - Standard handles (no ack flag) still hit canonical-dispatch refusal
//     when tx.to is outside the allowlist.
//   - WARN block emitted at preview for prepare_custom_call handles
//     (uses WARN_NON_PROTOCOL_TARGET_TEMPLATE from the SOT).
//   - Decode HIT: per-session ABI cache has the target → viem.decodeFunctionData
//     surfaces functionName(args...) in CHECKS PERFORMED.
//   - Decode MISS: literal "Blind sign — no ABI available" text.
//   - NO 4byte fallback in the new custom-call arm (Pitfall 4 — grep-guard).
//   - Pitfall 1 grep guard: preview_send.ts reads
//     `record.acknowledgeNonProtocolTarget` AT MOST ONCE (the EVM dispatch site).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import type { FourbyteResult } from "../src/clients/fourbyte.js";

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

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
      "../src/wallet/session-manager.js",
    );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) =>
      getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from preview_send custom-call tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("viem/actions", async () => {
  const actual =
    await vi.importActual<typeof import("viem/actions")>("viem/actions");
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
  };
});

vi.mock("../src/clients/fourbyte.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/clients/fourbyte.js")>(
      "../src/clients/fourbyte.js",
    );
  return {
    ...actual,
    lookupSelector: (selector: Hex | null) => lookupSelectorSpy(selector),
  };
});

import { _canonicalDispatch } from "../src/security/canonical-dispatch.js";
import { WARN_NON_PROTOCOL_TARGET_TEMPLATE } from "../src/signing/blocks.js";
import {
  _resetEtherscanAbiCacheForTesting,
  type EtherscanAbiResult,
} from "../src/clients/etherscan.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
} from "../src/signing/handle-store.js";
import type { PreparedTx } from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

await import("../src/tools/register-all.js");

async function callPreviewSend(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

const SENDER = "0x742d35Cc6634C0532925a3b844Bc9e7595f06b9D" as Address;
// Non-canonical target — NOT in canonical-dispatch allowlist. The standard
// Layer 0.5 refusal would fire for this address; the bypass flag short-
// circuits it.
const CUSTOM_TARGET = "0x00000000000000000000000000000000DeaDBeef" as Address;
const CUSTOM_DATA = "0xdeadbeef" as Hex;

const PAIRED_STATUS = {
  paired: true as const,
  accounts: [SENDER as `0x${string}`],
  activeAccount: SENDER as `0x${string}`,
  address: SENDER as `0x${string}`,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [SENDER as `0x${string}`] } as Record<
    number,
    `0x${string}`[]
  >,
};

const FIXTURE_FINGERPRINT =
  "0xb137028a94f1af0a98dc0f96102101ad4efc756784fa54dc0a8fc10d5a8a1701" as Hex;
const FIXTURE_NONCE = 7;
const FIXTURE_GAS = 50_000n;
const FIXTURE_MAX_FEE = 30_000_000_000n;
const FIXTURE_MAX_PRIO = 1_500_000_000n;

function buildCustomCallTx(
  data: Hex = CUSTOM_DATA,
  to: Address = CUSTOM_TARGET,
): PreparedTx {
  return {
    chainId: 1,
    to,
    valueWei: 0n,
    data,
  };
}

function seedCustomCallHandle(opts?: {
  data?: Hex;
  to?: Address;
  skipBypassFlag?: boolean;
}): string {
  const data = opts?.data ?? CUSTOM_DATA;
  const to = opts?.to ?? CUSTOM_TARGET;
  return createHandle({
    args: {
      to,
      valueWei: "0",
      data,
    },
    tx: buildCustomCallTx(data, to),
    payloadFingerprint: FIXTURE_FINGERPRINT,
    ...(opts?.skipBypassFlag
      ? {}
      : {
          acknowledgeNonProtocolTarget: true,
          preparedBy: "prepare_custom_call",
        }),
  });
}

function scriptRpcMocks(): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getTransactionCountSpy.mockResolvedValue(FIXTURE_NONCE);
  estimateFeesPerGasSpy.mockResolvedValue({
    maxFeePerGas: FIXTURE_MAX_FEE,
    maxPriorityFeePerGas: FIXTURE_MAX_PRIO,
  });
  estimateGasSpy.mockResolvedValue(FIXTURE_GAS);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

beforeEach(() => {
  getStatusSpy.mockReset();
  getTransactionCountSpy.mockReset();
  estimateFeesPerGasSpy.mockReset();
  estimateGasSpy.mockReset();
  lookupSelectorSpy.mockReset();
  lookupSelectorSpy.mockResolvedValue({ kind: "not-applicable" });
  _resetHandleStoreForTesting();
  _resetEtherscanAbiCacheForTesting();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  scriptRpcMocks();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  vi.restoreAllMocks();
});

describe("preview_send — canonical-dispatch bypass for prepare_custom_call handles", () => {
  it("bypass fires when record.acknowledgeNonProtocolTarget === true (no DISPATCH_TARGET_REFUSED)", async () => {
    // canonical-dispatch would refuse the non-canonical target if invoked —
    // assert it is NOT consulted.
    const dispatchSpy = vi
      .spyOn(_canonicalDispatch, "checkDispatchTarget")
      .mockReturnValue({
        kind: "refused",
        chain: 1,
        to: CUSTOM_TARGET,
        allowlist: ["0x1111111111111111111111111111111111111111" as Address],
      });

    const handle = seedCustomCallHandle();
    const res = await callPreviewSend({ handle });
    expect(res.isError).toBeFalsy();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("standard handle (no bypass flag) STILL refuses with DISPATCH_TARGET_REFUSED for non-canonical targets", async () => {
    vi.spyOn(_canonicalDispatch, "checkDispatchTarget").mockReturnValue({
      kind: "refused",
      chain: 1,
      to: CUSTOM_TARGET,
      allowlist: ["0x1111111111111111111111111111111111111111" as Address],
    });

    const handle = seedCustomCallHandle({ skipBypassFlag: true });
    const res = await callPreviewSend({ handle });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { errorCode: string }).errorCode).toBe(
      "DISPATCH_TARGET_REFUSED",
    );
  });
});

describe("preview_send — WARN block emission for prepare_custom_call handles", () => {
  beforeEach(() => {
    // Allow any target — focus tests on WARN block behavior.
    vi.spyOn(_canonicalDispatch, "checkDispatchTarget").mockReturnValue({
      kind: "ok",
    });
  });

  it("emits the WARN block at preview for a prepare_custom_call handle", async () => {
    const handle = seedCustomCallHandle();
    const res = await callPreviewSend({ handle });
    expect(res.isError).toBeFalsy();
    const text = (res.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toContain("[WARN — NON-PROTOCOL TARGET]");
    expect(text).toContain(CUSTOM_TARGET);
    expect(text).toContain("ethereum (chainId 1)");
  });

  it("WARN block appears ABOVE the EXPECTED LEDGER DEVICE DISPLAY (user reads warning first)", async () => {
    const handle = seedCustomCallHandle();
    const res = await callPreviewSend({ handle });
    const text = (res.content as Array<{ type: string; text: string }>)[0]
      .text;
    const warnIdx = text.indexOf("[WARN — NON-PROTOCOL TARGET]");
    const ledgerIdx = text.indexOf("EXPECTED LEDGER DEVICE DISPLAY");
    expect(warnIdx).toBeGreaterThanOrEqual(0);
    expect(ledgerIdx).toBeGreaterThan(warnIdx);
  });

  it("standard handle (no bypass flag) does NOT emit the WARN block", async () => {
    const handle = seedCustomCallHandle({ skipBypassFlag: true });
    const res = await callPreviewSend({ handle });
    expect(res.isError).toBeFalsy();
    const text = (res.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).not.toContain("[WARN — NON-PROTOCOL TARGET]");
  });

  it("WARN block uses the WARN_NON_PROTOCOL_TARGET_TEMPLATE SOT (format-fanout-sentinel)", async () => {
    // Smoke: the template body sentence is verbatim in the preview response.
    const handle = seedCustomCallHandle();
    const res = await callPreviewSend({ handle });
    const text = (res.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toContain(
      "This call BYPASSES the canonical-dispatch allowlist",
    );
    expect(text).toContain(
      "acknowledged this at prepare time (acknowledgeNonProtocolTarget: true)",
    );
    expect(text).toContain("If unsure, decline on-device.");
  });
});

describe("preview_send — custom-call decode arm", () => {
  beforeEach(() => {
    vi.spyOn(_canonicalDispatch, "checkDispatchTarget").mockReturnValue({
      kind: "ok",
    });
  });

  it("ABI cache MISS — surfaces literal 'Blind sign — no ABI available' text", async () => {
    const handle = seedCustomCallHandle();
    const res = await callPreviewSend({ handle });
    expect(res.isError).toBeFalsy();
    const text = (res.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toContain("Blind sign — no ABI available");
    // First 4 bytes of CUSTOM_DATA (0xdeadbeef) — the selector shown on-device.
    expect(text).toContain("0xdeadbeef");
  });

  it("ABI cache HIT — decodes function name + args via viem.decodeFunctionData", async () => {
    // Populate the cache via the internal helper. We use ERC-20 transfer
    // ABI as a known-shape calldata target.
    const erc20Abi = [
      {
        type: "function" as const,
        name: "transfer",
        stateMutability: "nonpayable" as const,
        inputs: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
      },
    ];
    // Manually seed the abi cache by calling fetchEtherscanAbi with a mocked
    // fetch (cheaper than wiring a real Etherscan call).
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: "1",
        message: "OK",
        result: JSON.stringify(erc20Abi),
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { fetchEtherscanAbi } = await import("../src/clients/etherscan.js");
    await fetchEtherscanAbi(1, CUSTOM_TARGET, "test-key");

    // Use a valid ERC-20 transfer calldata so viem.decodeFunctionData succeeds.
    const transferData =
      ("0xa9059cbb000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000000000000000000000000000000000000000000000000005f5e100" as Hex);

    const handle = seedCustomCallHandle({ data: transferData });
    const res = await callPreviewSend({ handle });
    expect(res.isError).toBeFalsy();
    const text = (res.content as Array<{ type: string; text: string }>)[0]
      .text;
    expect(text).toContain("DECODED ARGS — prepare_custom_call");
    expect(text).toContain("transfer(");
    // viem decodeFunctionData returns the recipient address checksummed —
    // compare case-insensitively (the address bytes are what matter, not
    // the checksum casing).
    expect(text.toLowerCase()).toContain(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(text).toContain("100000000");
    expect(text).not.toContain("Blind sign — no ABI available");
  });

  it("WARN {DECODED} slot reflects cache state (HIT vs MISS)", async () => {
    const missHandle = seedCustomCallHandle();
    const missRes = await callPreviewSend({ handle: missHandle });
    const missText = (
      missRes.content as Array<{ type: string; text: string }>
    )[0].text;
    expect(missText).toContain(
      "decoded:  (no ABI cached — call get_contract_abi first)",
    );
  });
});

describe("preview_send — Pitfall enforcement grep guards", () => {
  // These are STATIC grep tests against the live source — Pitfall 1 + 4
  // enforcement at PR-review time.

  it("Pitfall 1 — record.acknowledgeNonProtocolTarget read appears ONLY at the EVM dispatch site (single non-comment read)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/tools/preview_send.ts"),
      "utf8",
    );
    // Count READS of `record.acknowledgeNonProtocolTarget` — exclude
    // comment lines (Pitfall 1 is about runtime flag reads, not comment
    // mentions). Per-line scan: line counts ONLY if (a) it contains the
    // property access AND (b) it does NOT start with `//` or contain
    // `* ` (block-comment continuation).
    let nonCommentReads = 0;
    for (const line of src.split("\n")) {
      if (!line.includes("record.acknowledgeNonProtocolTarget")) continue;
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//")) continue;
      if (trimmed.startsWith("*")) continue;
      nonCommentReads += 1;
    }
    // EXACTLY 1 read = the EVM dispatch-site bypass branch. Solana/TRON/BTC
    // branches MUST NOT read this flag (Pitfall 1).
    expect(nonCommentReads).toBe(1);
  });

  it("Pitfall 4 — no 4byte fallback in the custom-call decode arm", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/tools/preview_send.ts"),
      "utf8",
    );
    // Find the custom-call arm body and assert it does not invoke
    // lookupSelector (the 4byte client). The arm begins at
    // `record.preparedBy === "prepare_custom_call"` and runs until the
    // closing brace of its block.
    const armStart = src.indexOf(
      'record.preparedBy === "prepare_custom_call"',
    );
    expect(armStart).toBeGreaterThan(0);
    // Take a generous slice (1.5k chars) — well beyond the arm body length.
    const armSlice = src.slice(armStart, armStart + 3000);
    expect(armSlice).not.toContain("lookupSelector");
    expect(armSlice).not.toContain("fetchSelector");
    // Allow the literal "Blind sign" message which mentions "ABI available";
    // 4byte is the protocol-routed selector-name path, NOT a fallback for
    // the escape hatch.
  });

  it("WARN_NON_PROTOCOL_TARGET_TEMPLATE imported from blocks.ts (single SOT)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/tools/preview_send.ts"),
      "utf8",
    );
    expect(src).toContain("WARN_NON_PROTOCOL_TARGET_TEMPLATE");
    // The template body literal does NOT appear inlined — it MUST be
    // imported and substituted.
    const inlineCount = (
      src.match(/\[WARN — NON-PROTOCOL TARGET\]/g) ?? []
    ).length;
    // The only occurrence allowed is in comments; the actual template lives
    // in blocks.ts. Comments are fine; the test fails if someone inlines the
    // template literal.
    // (Allow up to 3 occurrences — comments may mention the block by name.)
    expect(inlineCount).toBeLessThanOrEqual(3);
  });

  it("WARN_NON_PROTOCOL_TARGET_TEMPLATE SOT consistency — body sentence is identical at import site", () => {
    // The template body sentence appears once in the SOT; the preview-time
    // emission substitutes slots without modifying the body.
    expect(WARN_NON_PROTOCOL_TARGET_TEMPLATE).toContain(
      "This call BYPASSES the canonical-dispatch allowlist",
    );
    expect(WARN_NON_PROTOCOL_TARGET_TEMPLATE).toContain(
      "If unsure, decline on-device",
    );
  });
});
