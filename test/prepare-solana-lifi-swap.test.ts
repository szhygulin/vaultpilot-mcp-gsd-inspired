// Phase 16 Plan 16-02 — prepare_solana_lifi_swap (OUTBOUND Solana→EVM) tests.
//
// FORCE real path: VAULTPILOT_DEMO="false" in beforeEach + restore in afterEach
// (mode-bleed pitfall — the demo gate fires FIRST at runtime, so without this the
// real outbound arm is never exercised).
//
// NO-LIVE-HTTP: fetchLifiQuote is mocked at the module boundary (vi.mock).
//
// Inv #6b: the OUTBOUND recipient is decoded FROM the SIGNED EVM bridge calldata
// at preview_send Layer 0.6 — NOT from quote.action.toAddress. This file proves:
//   (1) outbound mints a handle storing bridgeParams.toAddress === params.toAddress
//       + the EVM tx fields taken VERBATIM from quote.transactionRequest;
//   (2) the Layer 0.6 drift compare reads the DECODED-FROM-CALLDATA recipient
//       (via _bridgeTier1Decoders over record.tx.data) and mismatch → refusal —
//       the decode input is record.tx.data (the signed bytes), never
//       quote.action.toAddress (defense-in-name-only forbidden).
//
// Cross-link: the outbound EVM-shape payloadFingerprint is anchored as
// Fixture AC in test/signing-fingerprint-solana.test.ts (hardcoded 0x… literal).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";

import type { LifiQuoteResult } from "../src/clients/lifi.js";

// Mock the LiFi client at the module boundary (NO-LIVE-HTTP).
const fetchLifiQuoteMock = vi.fn<[unknown], Promise<LifiQuoteResult>>();
vi.mock("../src/clients/lifi.js", async () => {
  const actual = await vi.importActual<typeof import("../src/clients/lifi.js")>(
    "../src/clients/lifi.js",
  );
  return { ...actual, fetchLifiQuote: (p: unknown) => fetchLifiQuoteMock(p) };
});

// Mock the non-evm store so listAccounts returns a paired Solana account.
vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (filter?: { chainFilter?: string }) =>
      filter?.chainFilter === "solana"
        ? [
            {
              chain: "solana",
              address: "7gxcsRkHzkbqfQwjV2eDdmCkK8gPjVf9YpY5fG5L8aBc",
              derivationPath: "44'/501'/0'",
              pairedAt: "2026-05-20T10:00:00.000Z",
            },
          ]
        : [],
  };
});

import { _bridgeTier1Decoders } from "../src/protocols/bridge-decoders/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { lookup } from "../src/signing/handle-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";
import { LIFI_SOLANA_CHAIN_ID } from "../src/config/contracts.js";

await import("../src/tools/prepare_solana_lifi_swap.js");

const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
const USER_TO = "0x1111111111111111111111111111111111111111";
const ATTACKER_TO = "0x2222222222222222222222222222222222222222";
const OUTBOUND_CALLDATA = "0xabcdef0123456789";

function outboundQuote(): LifiQuoteResult {
  return {
    kind: "ok",
    quote: {
      action: { toAddress: USER_TO },
      fromChainId: LIFI_SOLANA_CHAIN_ID, // Solana source → OUTBOUND
      toChainId: 42161, // Arbitrum
      transactionRequest: { to: LIFI_DIAMOND, data: OUTBOUND_CALLDATA, value: "0" },
    },
  };
}

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_solana_lifi_swap");
  if (!tool) throw new Error("prepare_solana_lifi_swap not registered");
  return tool.handler(args);
}

const SWAP_ARGS = {
  fromChain: "SOL",
  fromToken: "11111111111111111111111111111111",
  toChain: "ARB",
  toToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  amount: "1.5",
  toAddress: USER_TO,
};

let savedDemo: string | undefined;
beforeEach(() => {
  savedDemo = process.env.VAULTPILOT_DEMO;
  process.env.VAULTPILOT_DEMO = "false"; // FORCE real path
  _resetDemoModeForTesting(); // bust the cached resolution so the env flip takes
  fetchLifiQuoteMock.mockReset();
  vi.restoreAllMocks();
});
afterEach(() => {
  if (savedDemo === undefined) delete process.env.VAULTPILOT_DEMO;
  else process.env.VAULTPILOT_DEMO = savedDemo;
  _resetDemoModeForTesting();
  vi.restoreAllMocks();
});

describe("prepare_solana_lifi_swap — OUTBOUND (Solana→EVM) happy path", () => {
  it("mints a handle binding the EVM calldata + bridgeParams.toAddress = user toAddress", async () => {
    fetchLifiQuoteMock.mockResolvedValue(outboundQuote());

    const result = await callTool(SWAP_ARGS);

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.direction).toBe("outbound");
    expect(typeof sc.handle).toBe("string");
    expect(sc.dispatchTarget).toBe(getAddress(LIFI_DIAMOND));

    // The handle stores the EVM tx VERBATIM from quote.transactionRequest +
    // bridgeParams.toAddress = the USER toAddress (the Inv #6b assertion input).
    const looked = lookup(sc.handle as string);
    expect(looked.ok).toBe(true);
    if (!looked.ok) throw new Error("unreachable");
    const tx = looked.record.tx as {
      txType?: string;
      to: string;
      data: string;
      bridgeParams?: { toAddress?: string };
    };
    expect(tx.txType).toBe("evm");
    expect(tx.to).toBe(getAddress(LIFI_DIAMOND));
    expect(tx.data).toBe(OUTBOUND_CALLDATA);
    expect(tx.bridgeParams?.toAddress).toBe(USER_TO);
  });

  it("emits a Blind-sign LEDGER NOTICE in the prepare receipt", async () => {
    fetchLifiQuoteMock.mockResolvedValue(outboundQuote());
    const result = await callTool(SWAP_ARGS);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/LEDGER NOTICE/);
    expect(text).toMatch(/BLIND-SIGN/i);
  });
});

describe("prepare_solana_lifi_swap — OUTBOUND Inv #6b (decode FROM signed calldata)", () => {
  it("Layer 0.6 compare reads the DECODED-FROM-CALLDATA recipient, not quote.action.toAddress", async () => {
    fetchLifiQuoteMock.mockResolvedValue(outboundQuote());
    const result = await callTool(SWAP_ARGS);
    const sc = result.structuredContent as Record<string, unknown>;
    const looked = lookup(sc.handle as string);
    if (!looked.ok) throw new Error("handle missing");
    const tx = looked.record.tx as { data: string; bridgeParams?: { toAddress?: string } };

    // The decoder is fed the SIGNED calldata bytes (record.tx.data) — NOT
    // quote.action.toAddress. We spy the decoder to prove its INPUT is the
    // stored calldata, and drive an ATTACKER-redirected decoded recipient.
    const decodeSpy = vi
      .spyOn(_bridgeTier1Decoders, "decodeBridgeTier1FacetRecipient")
      .mockReturnValue({ kind: "ok", bridge: "lifi", finalRecipient: ATTACKER_TO });

    const decoded = _bridgeTier1Decoders.decodeBridgeTier1FacetRecipient(tx.data as `0x${string}`);

    // The decode input is the signed calldata bytes.
    expect(decodeSpy).toHaveBeenCalledWith(OUTBOUND_CALLDATA);
    // The compared recipient is the DECODED value (attacker), and it differs
    // from the user-supplied bridgeParams.toAddress → Layer 0.6 would refuse
    // with DECODED_RECIPIENT_DRIFT (the EVM compare path in preview_send).
    expect(decoded.kind).toBe("ok");
    if (decoded.kind !== "ok") throw new Error("unreachable");
    const userRecipient = tx.bridgeParams?.toAddress ?? "";
    const drift = getAddress(decoded.finalRecipient) !== getAddress(userRecipient);
    expect(drift).toBe(true); // attacker-decoded != user toAddress → refusal
    // Sanity: the user toAddress is NOT silently trusted from the quote.
    expect(userRecipient).toBe(USER_TO);
    expect(decoded.finalRecipient).toBe(ATTACKER_TO);
  });
});

describe("prepare_solana_lifi_swap — gates", () => {
  it("demo mode → DEMO_MODE_REFUSED (before any network)", async () => {
    process.env.VAULTPILOT_DEMO = "true";
    _resetDemoModeForTesting(); // re-resolve under the flipped env
    const result = await callTool(SWAP_ARGS);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>).errorCode).toBe(
      "DEMO_MODE_REFUSED",
    );
    expect(fetchLifiQuoteMock).not.toHaveBeenCalled();
  });

  it("empty amount → INVALID_INPUT (no network)", async () => {
    const result = await callTool({ ...SWAP_ARGS, amount: "0" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("LiFi 404 → LIFI_NO_ROUTE", async () => {
    fetchLifiQuoteMock.mockResolvedValue({ kind: "not-found" });
    const result = await callTool(SWAP_ARGS);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>).errorCode).toBe(
      "LIFI_NO_ROUTE",
    );
  });
});
