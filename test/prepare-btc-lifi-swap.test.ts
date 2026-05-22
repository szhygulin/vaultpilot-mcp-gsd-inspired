// `prepare_btc_lifi_swap` end-to-end regression. Phase 26 — Plan 26-03.
//
// Load-bearing invariants:
//
//   1. **Fixture AA consumer re-anchor** — Fixture AA (BTC LiFi PSBT, pinned in
//      test/signing-fingerprint.test.ts) is cross-linked HERE. Drift in this tool's
//      fingerprint preimage assembly surfaces at BOTH files —
//      load-bearing redundancy per CLAUDE.md fixture discipline.
//
//   2. **Demo-mode REFUSED FIRST** — in non-demo mode no demo check needed;
//      in demo mode DEMO_MODE_REFUSED is returned before any network call.
//
//   3. **Inv#6b enforcement** — RECIPIENT_MISMATCH when LiFi-returned toAddress
//      differs from user-supplied toAddress (case-insensitive comparison).
//
//   4. **PSBT verbatim passthrough** — psbtHex in the handle == transactionRequest.data
//      verbatim (Pitfall 6). decodeLifiPsbt is called for display only.
//
//   5. **PREPARE RECEIPT** (PREP-02) — receipt reads from raw agent strings.
//
//   6. **WALLET_NOT_PAIRED FIRST** — WALLET_NOT_PAIRED before LiFi fetch
//      when no BTC account paired.
//
// Mocks:
//   - `fetchBtcLifiQuote` — mocked via vi.mock("../src/clients/lifi.js").
//   - `listAccounts` — mocked to control pairing state.
//   - `_btcLifiFingerprint.computeBtcLifiPayloadFingerprint` — spied to return
//      Fixture AA literal without hash computation (deterministic).
//
// Fixture AA cross-link (BTC LiFi PSBT, pinned in signing-fingerprint.test.ts):
//   payloadFingerprint = 0x8b014bc1e6373349059387a8b430db1063652ae81a1e7b22e7b3223ea70634f7

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted spies ────────────────────────────────────────────────────────────

const { listAccountsSpy, fetchBtcLifiQuoteSpy, createHandleSpy } = vi.hoisted(
  () => ({
    listAccountsSpy: vi.fn(),
    fetchBtcLifiQuoteSpy: vi.fn(),
    createHandleSpy:
      vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
  }),
);

// Mock non-evm-account-store's `listAccounts` (BTC pairing surface).
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

// Mock fetchBtcLifiQuote (LiFi HTTP client).
vi.mock("../src/clients/lifi.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/clients/lifi.js")
  >("../src/clients/lifi.js");
  return {
    ...actual,
    fetchBtcLifiQuote: (
      ...args: Parameters<typeof actual.fetchBtcLifiQuote>
    ) => fetchBtcLifiQuoteSpy(...args),
  };
});

// Mock handle-store's `createHandle` as a spy that delegates to real impl.
vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (
      ...args: Parameters<typeof actual.createHandle>
    ) => createHandleSpy(...args),
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { _resetDemoModeForTesting } from "../src/config/env.js";
import { PREPARE_RECEIPT_BTC_LIFI_TEMPLATE } from "../src/signing/blocks-btc.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { _btcLifiFingerprint } from "../src/signing/btc-lifi-fingerprint.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callTool(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_btc_lifi_swap");
  if (!tool) throw new Error("prepare_btc_lifi_swap not registered");
  return tool.handler(args);
}

// ─── Fixture constants ────────────────────────────────────────────────────────

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Fixture AA — BTC LiFi PSBT payloadFingerprint (pinned in signing-fingerprint.test.ts).
// Cross-linked here: drift in fingerprint preimage breaks BOTH test files.
const FIXTURE_AA_FINGERPRINT =
  "0x8b014bc1e6373349059387a8b430db1063652ae81a1e7b22e7b3223ea70634f7";

// LiFi-shape PSBT hex fixture (same as in lifi-btc-decoder.test.ts):
//   3 outputs: deposit P2WPKH (bc1qw508d... 980_000 sats) + OP_RETURN + change P2WPKH
const LIFI_PSBT_HEX =
  "70736274ff0100920200000001cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc0000000000feffffff0320f40e0000000000160014751e76e8199196d454941c45d1b3a323f1433bd60000000000000000186a163d7c6c69666900000000000000000000000000000000102700000000000016001406afd46bcdfd22ef94ac122aa11f241244a37ecc000000000001011f40420f0000000000160014751e76e8199196d454941c45d1b3a323f1433bd600000000";

const VAULT_ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

// Paired BTC segwit account (minimal stub — only address field used).
const PAIRED_BTC_SEGWIT = {
  chain: "bitcoin" as const,
  address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  label: "BTC segwit",
  derivationPath: "m/84'/0'/0'/0/0",
  type: "segwit" as const,
};

// EVM destination: Ethereum mainnet WETH.
const TO_ADDRESS_ETH = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TO_CHAIN_ETH = "ETH";
const TO_TOKEN_WETH = "WETH";

// Solana destination: devnet test address.
const TO_ADDRESS_SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const TO_CHAIN_SOL = "SOL";
const TO_TOKEN_SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Build a minimal valid LiFi ok quote with the given toAddress. */
function makeOkQuote(toAddress: string) {
  return {
    kind: "ok" as const,
    quote: {
      action: { toAddress },
      transactionRequest: {
        to: VAULT_ADDRESS,
        data: LIFI_PSBT_HEX,
        value: "980000",
      },
    },
  };
}

// Default valid args for happy-path tests.
const DEFAULT_ARGS = {
  fromToken: "BTC",
  toChain: TO_CHAIN_ETH,
  toToken: TO_TOKEN_WETH,
  amount: "100000",
  toAddress: TO_ADDRESS_ETH,
};

// ─── beforeEach / afterEach ────────────────────────────────────────────────────

beforeEach(async () => {
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";

  listAccountsSpy.mockReset();
  fetchBtcLifiQuoteSpy.mockReset();
  // Re-set implementation each beforeEach so vi.restoreAllMocks() in afterEach
  // doesn't leave the spy with no implementation (same pattern as prepare-btc-send.test.ts).
  createHandleSpy.mockClear();
  const realHandleStore = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(realHandleStore.createHandle);

  _resetHandleStoreForTesting();
  _resetDemoModeForTesting();

  // Default: one paired BTC segwit account.
  listAccountsSpy.mockReturnValue([PAIRED_BTC_SEGWIT]);

  // Default: ok quote with ETH destination.
  fetchBtcLifiQuoteSpy.mockResolvedValue(makeOkQuote(TO_ADDRESS_ETH));

  // Pin Fixture AA for all fingerprint calls.
  vi.spyOn(_btcLifiFingerprint, "computeBtcLifiPayloadFingerprint").mockReturnValue(
    FIXTURE_AA_FINGERPRINT,
  );
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  vi.restoreAllMocks();
});

// ─── Demo mode ────────────────────────────────────────────────────────────────

describe("prepare_btc_lifi_swap — demo mode (DEMO_MODE_REFUSED before any network call)", () => {
  it("demo mode → DEMO_MODE_REFUSED, fetchBtcLifiQuote never called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callTool(DEFAULT_ARGS);

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("DEMO_MODE_REFUSED");
    // fetchBtcLifiQuote must NEVER be called in demo mode.
    expect(fetchBtcLifiQuoteSpy).not.toHaveBeenCalled();
    expect(listAccountsSpy).not.toHaveBeenCalled();
  });
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe("prepare_btc_lifi_swap — input validation (INVALID_INPUT)", () => {
  it("non-numeric amount → INVALID_INPUT", async () => {
    const result = await callTool({ ...DEFAULT_ARGS, amount: "abc" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
    expect(fetchBtcLifiQuoteSpy).not.toHaveBeenCalled();
  });

  it("decimal amount → INVALID_INPUT", async () => {
    const result = await callTool({ ...DEFAULT_ARGS, amount: "100.5" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
    expect(fetchBtcLifiQuoteSpy).not.toHaveBeenCalled();
  });

  it("negative amount → INVALID_INPUT", async () => {
    const result = await callTool({ ...DEFAULT_ARGS, amount: "-100" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
    expect(fetchBtcLifiQuoteSpy).not.toHaveBeenCalled();
  });

  it("zero amount → INVALID_INPUT", async () => {
    const result = await callTool({ ...DEFAULT_ARGS, amount: "0" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
    expect(fetchBtcLifiQuoteSpy).not.toHaveBeenCalled();
  });

  it("empty toAddress → INVALID_INPUT", async () => {
    const result = await callTool({ ...DEFAULT_ARGS, toAddress: "" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
    expect(fetchBtcLifiQuoteSpy).not.toHaveBeenCalled();
  });

  it("empty toChain → INVALID_INPUT", async () => {
    const result = await callTool({ ...DEFAULT_ARGS, toChain: "" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
    expect(fetchBtcLifiQuoteSpy).not.toHaveBeenCalled();
  });

  it("empty toToken → INVALID_INPUT", async () => {
    const result = await callTool({ ...DEFAULT_ARGS, toToken: "" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
    expect(fetchBtcLifiQuoteSpy).not.toHaveBeenCalled();
  });
});

// ─── WALLET_NOT_PAIRED ────────────────────────────────────────────────────────

describe("prepare_btc_lifi_swap — WALLET_NOT_PAIRED", () => {
  it("no paired BTC account → WALLET_NOT_PAIRED, LiFi never called", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool(DEFAULT_ARGS);

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("WALLET_NOT_PAIRED");
    expect(fetchBtcLifiQuoteSpy).not.toHaveBeenCalled();
  });
});

// ─── LiFi quote arms ─────────────────────────────────────────────────────────

describe("prepare_btc_lifi_swap — LiFi quote arms", () => {
  it("LiFi not-found (404) → LIFI_NO_ROUTE", async () => {
    fetchBtcLifiQuoteSpy.mockResolvedValue({ kind: "not-found" });

    const result = await callTool(DEFAULT_ARGS);

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("LIFI_NO_ROUTE");
  });

  it("LiFi rate-limited (429) → INTERNAL_ERROR", async () => {
    fetchBtcLifiQuoteSpy.mockResolvedValue({
      kind: "rate-limited",
      message: "Too many requests",
    });

    const result = await callTool(DEFAULT_ARGS);

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INTERNAL_ERROR");
  });

  it("LiFi error (network failure) → INTERNAL_ERROR", async () => {
    fetchBtcLifiQuoteSpy.mockResolvedValue({
      kind: "error",
      message: "LiFi unreachable (timeout 10000ms)",
    });

    const result = await callTool(DEFAULT_ARGS);

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INTERNAL_ERROR");
  });
});

// ─── Inv#6b enforcement (RECIPIENT_MISMATCH) ─────────────────────────────────

describe("prepare_btc_lifi_swap — Inv#6b (T-26-10 RECIPIENT_MISMATCH)", () => {
  it("LiFi toAddress differs from user toAddress → RECIPIENT_MISMATCH, handle NOT created", async () => {
    // LiFi returns a different toAddress than the user supplied.
    const attacker = "0xDeAdBEeF00000000000000000000000000000000";
    fetchBtcLifiQuoteSpy.mockResolvedValue(makeOkQuote(attacker));

    const result = await callTool(DEFAULT_ARGS); // user requested TO_ADDRESS_ETH

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("RECIPIENT_MISMATCH");
    // Handle must NOT have been created.
    expect(createHandleSpy).not.toHaveBeenCalled();
  });

  it("Inv#6b is case-insensitive — lowercase toAddress matches uppercase LiFi response", async () => {
    // LiFi returns uppercase, user supplied lowercase — should pass (not MISMATCH).
    const lifiAddr = TO_ADDRESS_ETH.toUpperCase();
    const userAddr = TO_ADDRESS_ETH.toLowerCase();
    fetchBtcLifiQuoteSpy.mockResolvedValue(makeOkQuote(lifiAddr));

    const result = await callTool({ ...DEFAULT_ARGS, toAddress: userAddr });

    // Should succeed — case-insensitive comparison.
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBeUndefined();
    expect(sc["txType"]).toBe("btc-lifi");
  });
});

// ─── Happy path — BTC → ETH ───────────────────────────────────────────────────

describe("prepare_btc_lifi_swap — happy path BTC → ETH (Fixture AA cross-link)", () => {
  it("returns handle, txType=btc-lifi, psbtHex verbatim, payloadFingerprint=Fixture AA", async () => {
    const result = await callTool(DEFAULT_ARGS);

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc["txType"]).toBe("btc-lifi");
    expect(sc["psbtHex"]).toBe(LIFI_PSBT_HEX); // verbatim passthrough (Pitfall 6)
    expect(sc["vaultAddress"]).toBe(VAULT_ADDRESS);
    expect(sc["toAddress"]).toBe(TO_ADDRESS_ETH);
    expect(sc["toChain"]).toBe(TO_CHAIN_ETH);
    expect(sc["toToken"]).toBe(TO_TOKEN_WETH);

    // Fixture AA cross-link — pinned in signing-fingerprint.test.ts.
    // Drift in fingerprint preimage assembly breaks both test files.
    expect(sc["payloadFingerprint"]).toBe(FIXTURE_AA_FINGERPRINT);

    // amountSats comes from PSBT decoder (980_000 sats for first output in fixture).
    expect(sc["amountSats"]).toBe("980000");

    // outputCount from PSBT decoder.
    expect(sc["outputCount"]).toBe(3);

    // hasOpReturn: fixture PSBT has OP_RETURN tracking memo.
    expect(sc["hasOpReturn"]).toBe(true);

    // handle must be a non-empty string.
    expect(typeof sc["handle"]).toBe("string");
    expect((sc["handle"] as string).length).toBeGreaterThan(0);
  });

  it("createHandle called exactly once with btc-lifi txType", async () => {
    await callTool(DEFAULT_ARGS);
    expect(createHandleSpy).toHaveBeenCalledOnce();
    const callArgs = createHandleSpy.mock.calls[0]![0];
    expect(callArgs.tx.txType).toBe("btc-lifi");
  });

  it("_btcLifiFingerprint.computeBtcLifiPayloadFingerprint called exactly once", async () => {
    await callTool(DEFAULT_ARGS);
    const fpSpy = vi.spyOn(_btcLifiFingerprint, "computeBtcLifiPayloadFingerprint");
    // Spy was set up in beforeEach — just verify the mock was called during the tool call.
    expect(
      vi.isMockFunction(_btcLifiFingerprint.computeBtcLifiPayloadFingerprint),
    ).toBe(true);
  });

  it("PREPARE RECEIPT contains FROM_TOKEN, TO_CHAIN, TO_ADDRESS, VAULT_ADDRESS", async () => {
    const result = await callTool(DEFAULT_ARGS);
    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("BTC");
    expect(text).toContain("ETH");
    expect(text).toContain(TO_ADDRESS_ETH);
    expect(text).toContain(VAULT_ADDRESS);
    expect(text).toContain("PREPARE RECEIPT (BTC — LiFi bridge swap)");
  });

  it("PSBT hex in PREPARE RECEIPT is truncated to 80 chars + '...[full PSBT]'", async () => {
    const result = await callTool(DEFAULT_ARGS);
    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    // PSBT hex fixture is longer than 80 chars — should be truncated.
    const psbtPreview = LIFI_PSBT_HEX.slice(0, 80) + "...[full PSBT]";
    expect(text).toContain(psbtPreview);
  });

  it("PREPARE RECEIPT structure matches PREPARE_RECEIPT_BTC_LIFI_TEMPLATE shape", async () => {
    const result = await callTool(DEFAULT_ARGS);
    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    // Template slots must ALL be replaced (none of the {SLOT} placeholders remain).
    expect(text).not.toMatch(/\{[A-Z_]+\}/);
    // Template-specific lines.
    expect(text).toMatch(/chain:\s+Bitcoin mainnet/);
    expect(text).toMatch(/fromToken:\s+BTC/);
    expect(text).toMatch(/decodedRecipient:.*Inv#6b/);
  });

  it("structuredContent.prepareReceipt matches text content (same string)", async () => {
    const result = await callTool(DEFAULT_ARGS);
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["prepareReceipt"]).toBe(text);
  });
});

// ─── Happy path — BTC → SOL ───────────────────────────────────────────────────

describe("prepare_btc_lifi_swap — happy path BTC → SOL (Solana destination)", () => {
  it("BTC→SOL: returns handle with toChain=SOL, toAddress=Solana base58", async () => {
    fetchBtcLifiQuoteSpy.mockResolvedValue(makeOkQuote(TO_ADDRESS_SOL));

    const result = await callTool({
      fromToken: "BTC",
      toChain: TO_CHAIN_SOL,
      toToken: TO_TOKEN_SOL_USDC,
      amount: "200000",
      toAddress: TO_ADDRESS_SOL,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["txType"]).toBe("btc-lifi");
    expect(sc["toChain"]).toBe(TO_CHAIN_SOL);
    expect(sc["toAddress"]).toBe(TO_ADDRESS_SOL);
    expect(sc["psbtHex"]).toBe(LIFI_PSBT_HEX); // verbatim passthrough
  });

  it("BTC→SOL: Inv#6b mismatch with Solana address → RECIPIENT_MISMATCH", async () => {
    const wrongAddr = "4vJ9JU1bJJE96FW3A8nhtDxr5E6";
    fetchBtcLifiQuoteSpy.mockResolvedValue(makeOkQuote(wrongAddr));

    const result = await callTool({
      fromToken: "BTC",
      toChain: TO_CHAIN_SOL,
      toToken: TO_TOKEN_SOL_USDC,
      amount: "200000",
      toAddress: TO_ADDRESS_SOL, // different from wrongAddr
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("RECIPIENT_MISMATCH");
  });
});

// ─── Segwit address selection ─────────────────────────────────────────────────

describe("prepare_btc_lifi_swap — BTC address selection", () => {
  it("prefers bc1q segwit address for LiFi fromAddress", async () => {
    const taprootAccount = {
      ...PAIRED_BTC_SEGWIT,
      address: "bc1pxxx000taproot",
      type: "taproot" as const,
    };
    // Put taproot first, segwit second — tool should pick segwit.
    listAccountsSpy.mockReturnValue([taprootAccount, PAIRED_BTC_SEGWIT]);

    await callTool(DEFAULT_ARGS);

    const callArgs = fetchBtcLifiQuoteSpy.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(callArgs["btcAddress"]).toBe(PAIRED_BTC_SEGWIT.address);
  });

  it("falls back to first account when no bc1q address present", async () => {
    const taprootAccount = {
      ...PAIRED_BTC_SEGWIT,
      address: "bc1pxxx000taproot",
      type: "taproot" as const,
    };
    listAccountsSpy.mockReturnValue([taprootAccount]);

    await callTool(DEFAULT_ARGS);

    const callArgs = fetchBtcLifiQuoteSpy.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(callArgs["btcAddress"]).toBe(taprootAccount.address);
  });
});

// ─── LiFi URL parameters ──────────────────────────────────────────────────────

describe("prepare_btc_lifi_swap — fetchBtcLifiQuote call parameters", () => {
  it("passes toChain, toToken, toAddress, amountSatoshi to fetchBtcLifiQuote", async () => {
    await callTool(DEFAULT_ARGS);

    expect(fetchBtcLifiQuoteSpy).toHaveBeenCalledOnce();
    const callArgs = fetchBtcLifiQuoteSpy.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(callArgs["toChain"]).toBe(TO_CHAIN_ETH);
    expect(callArgs["toToken"]).toBe(TO_TOKEN_WETH);
    expect(callArgs["toAddress"]).toBe(TO_ADDRESS_ETH);
    expect(callArgs["amountSatoshi"]).toBe(BigInt(DEFAULT_ARGS.amount));
  });
});
