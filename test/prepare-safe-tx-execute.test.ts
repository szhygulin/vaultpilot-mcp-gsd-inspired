// prepare_safe_tx_execute unit tests — Phase 37 Plan 37-03 (SAFE-08).
//
// Anchors:
//   - Happy 1-of-1: returns { handle, payloadFingerprint, dispatchTarget,
//     encapsulatedOperation, signerCount, signersAscending, isSafeExecTransaction }
//     in structuredContent. dispatchTarget === safeAddress (NOT the Singleton).
//     The underlying handle record carries isSafeExecTransaction === true
//     (the Layer 0.5 bypass sentinel).
//   - Happy 2-of-3: confirmations sorted ascending-by-signer-address. Tx
//     Service insertion REVERSE-of-ascending — anchors the sort discipline.
//   - INSUFFICIENT_SIGNATURES, INVALID_SIGNATURE_MODE, STALE_SIGNATURE.
//   - Nonce drift, UNSUPPORTED_SAFE_VERSION, non-owner refusal.
//   - Tx Service DU dispatch arms (not-found / unsupported-chain).
//   - Composite-tx preview decode (decoded inner transfer / undecoded inner /
//     delegatecall informational).
//   - payloadFingerprint uses VaultPilot-txverify-v1: tag (NOT safetx tag).
//   - Invariant #1 sanity: tx.data starts with EXEC_TRANSACTION_SELECTOR.

import { secp256k1 } from "@noble/curves/secp256k1";
import {
  decodeFunctionData,
  hashTypedData,
  hexToBytes,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/chains/registry.js", () => ({
  getChainClient: (_chainId: number) =>
    ({
      multicall: vi.fn(),
      readContract: vi.fn(),
    }) as unknown as PublicClient,
  isPublicNodeFallback: () => false,
  _resetChainRegistryForTesting: () => {},
  PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
}));

const { getStatusSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
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
      throw new Error("pair should not be called from prepare_safe_tx_execute tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

import { _safeChains } from "../src/chains/safe.js";
import * as safeTxService from "../src/clients/safe-tx-service.js";
import { computePayloadFingerprint } from "../src/signing/payload-fingerprint.js";
import {
  EXEC_TRANSACTION_SELECTOR,
  execTransactionAbi,
} from "../src/signing/safe-exec-decode.js";
import {
  buildSafeEIP712TypedData,
  computeSafeTxHash,
} from "../src/signing/safe-tx-hash.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { FIXTURE_SAFE_A_INPUT } from "./signing-safe-tx-hash.test.js";

await import("../src/tools/register-all.js");

// ---------------------------------------------------------------------------
// Synthetic ECDSA signers — derived from fixed 32-byte private keys. Anvil
// deterministic test accounts (RESEARCH §"Anvil deterministic test accounts").
// Lex ascending lowercase:
//   acct2 (0x3c44...) < acct1 (0x7099...) < acct0 (0xf39f...)
// ---------------------------------------------------------------------------

const ACCT0_PRIVKEY: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ACCT1_PRIVKEY: Hex =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ACCT2_PRIVKEY: Hex =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

function derivePublicAddress(privKey: Hex): Address {
  const pubKeyUncompressed = secp256k1.getPublicKey(privKey.slice(2), false);
  const hash = keccak256(pubKeyUncompressed.slice(1));
  return ("0x" + hash.slice(26)) as Address;
}
const ACCT0_ADDR: Address = derivePublicAddress(ACCT0_PRIVKEY);
const ACCT1_ADDR: Address = derivePublicAddress(ACCT1_PRIVKEY);
const ACCT2_ADDR: Address = derivePublicAddress(ACCT2_PRIVKEY);

/** Synthesize a 65-byte ECDSA signature over digest with privKey. */
function sign(digest: Hex, privKey: Hex, vOverride?: number): Hex {
  const sig = secp256k1.sign(digest.slice(2), privKey.slice(2), { lowS: true });
  const recovery = sig.recovery ?? 0;
  const v = vOverride !== undefined ? vOverride : recovery + 27;
  const r = sig.r.toString(16).padStart(64, "0");
  const s = sig.s.toString(16).padStart(64, "0");
  const vHex = v.toString(16).padStart(2, "0");
  return ("0x" + r + s + vHex) as Hex;
}

// Pre-compute Fixture SAFE-A digest. Drift in safe-tx-hash.ts fails THERE,
// not here — this is the regression cross-link.
const SAFE_A_TYPED_DATA = buildSafeEIP712TypedData(FIXTURE_SAFE_A_INPUT);
const SAFE_A_HASH: Hex = hashTypedData({
  domain: SAFE_A_TYPED_DATA.domain,
  types: SAFE_A_TYPED_DATA.types as unknown as Parameters<
    typeof hashTypedData
  >[0]["types"],
  primaryType: "SafeTx",
  message: SAFE_A_TYPED_DATA.message,
});

const PAIRED_STATUS_ACCT0 = {
  paired: true as const,
  accounts: [ACCT0_ADDR, ACCT1_ADDR, ACCT2_ADDR],
  activeAccount: ACCT0_ADDR,
  address: ACCT0_ADDR,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: {
    1: [ACCT0_ADDR, ACCT1_ADDR, ACCT2_ADDR],
    42161: [ACCT0_ADDR],
    137: [ACCT0_ADDR],
    8453: [ACCT0_ADDR],
    10: [ACCT0_ADDR],
  } as Record<number, Address[]>,
  activeChainId: 1,
  partiallyPaired: false,
};

async function callTool(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_safe_tx_execute");
  if (!tool) throw new Error("prepare_safe_tx_execute not registered");
  return tool.handler(args);
}

beforeEach(() => {
  getStatusSpy.mockReset();
  _resetHandleStoreForTesting();
  _resetActivePersonaForTesting();
  delete process.env["VAULTPILOT"];
  process.env["VAULTPILOT_DEMO"] = "false";
  _resetDemoModeForTesting();
  getStatusSpy.mockResolvedValue(PAIRED_STATUS_ACCT0);
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetActivePersonaForTesting();
  _resetDemoModeForTesting();
});

function stubSafeChains(opts: {
  owners?: readonly Address[];
  threshold?: bigint;
  nonce?: bigint;
  version?: string;
}): void {
  vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
    owners: opts.owners ?? [ACCT0_ADDR],
    threshold: opts.threshold ?? 1n,
    nonce: opts.nonce ?? FIXTURE_SAFE_A_INPUT.nonce,
    version: opts.version ?? FIXTURE_SAFE_A_INPUT.safeVersion,
  });
}

interface ConfirmationFixture {
  owner: string;
  signature: string;
  signatureType?: "EOA" | "ETH_SIGN" | "CONTRACT_SIGNATURE" | "APPROVED_HASH";
}

interface SafeTxFixtureOverrides {
  safe?: string;
  to?: string;
  value?: string;
  data?: string;
  operation?: number;
  safeTxGas?: string;
  baseGas?: string;
  gasPrice?: string;
  gasToken?: string;
  refundReceiver?: string;
  nonce?: string;
  safeTxHash?: string;
  confirmations?: ConfirmationFixture[];
  confirmationsRequired?: number;
}

function buildSafeAFixtureTx(
  overrides: SafeTxFixtureOverrides = {},
): safeTxService.SafeMultisigTransactionResponse {
  return {
    safe: (overrides.safe ?? FIXTURE_SAFE_A_INPUT.safeAddress) as Address,
    to: (overrides.to ?? FIXTURE_SAFE_A_INPUT.to) as Address,
    value: overrides.value ?? FIXTURE_SAFE_A_INPUT.value.toString(),
    data: overrides.data ?? FIXTURE_SAFE_A_INPUT.data,
    operation: overrides.operation ?? FIXTURE_SAFE_A_INPUT.operation,
    gasToken:
      (overrides.gasToken ??
        "0x0000000000000000000000000000000000000000") as Address,
    safeTxGas: overrides.safeTxGas ?? "0",
    baseGas: overrides.baseGas ?? "0",
    gasPrice: overrides.gasPrice ?? "0",
    refundReceiver:
      (overrides.refundReceiver ??
        "0x0000000000000000000000000000000000000000") as Address,
    nonce: overrides.nonce ?? FIXTURE_SAFE_A_INPUT.nonce.toString(),
    safeTxHash: overrides.safeTxHash ?? SAFE_A_HASH,
    confirmationsRequired: overrides.confirmationsRequired ?? 1,
    confirmations: overrides.confirmations as
      | safeTxService.SafeMultisigConfirmationResponse[]
      | undefined,
    signatures: null,
    isExecuted: false,
  };
}

function stubTxService(
  fixture: safeTxService.SafeMultisigTransactionResponse,
): void {
  vi.spyOn(safeTxService, "getMultisigTransaction").mockResolvedValue({
    kind: "ok",
    tx: fixture,
  });
}

const COMMON_ARGS = {
  chain: "ethereum",
  safeAddress: FIXTURE_SAFE_A_INPUT.safeAddress,
  safeTxHash: SAFE_A_HASH,
};

// ===========================================================================
// Test 1 — Happy path 1-of-1.
// ===========================================================================

describe("prepare_safe_tx_execute — happy path 1-of-1", () => {
  it("returns a PreparedTxEvm handle with isSafeExecTransaction === true sentinel", async () => {
    const sig = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    stubSafeChains({ owners: [ACCT0_ADDR], threshold: 1n });
    stubTxService(
      buildSafeAFixtureTx({
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
      }),
    );

    const result = await callTool(COMMON_ARGS);
    expect(result.isError).not.toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc).toHaveProperty("handle");
    expect(sc).toHaveProperty("payloadFingerprint");
    expect(sc).toHaveProperty("dispatchTarget", FIXTURE_SAFE_A_INPUT.safeAddress);
    expect(sc).toHaveProperty("signerCount", 1);
    expect(sc).toHaveProperty("isSafeExecTransaction", true);
    expect(sc).toHaveProperty("signersAscending");
    expect((sc.signersAscending as readonly string[]).length).toBe(1);

    // Verify the underlying handle record carries the sentinel.
    const handle = sc.handle as string;
    const record = _peekHandleForTesting(handle);
    expect(record).toBeDefined();
    expect(record?.isSafeExecTransaction).toBe(true);

    // dispatchTarget MUST be the Safe proxy at safeAddress (NOT the Singleton).
    const tx = record!.tx;
    if (tx.txType !== undefined && tx.txType !== "evm") {
      throw new Error(`expected evm txType, got ${tx.txType}`);
    }
    expect(tx.to.toLowerCase()).toBe(
      FIXTURE_SAFE_A_INPUT.safeAddress.toLowerCase(),
    );
    expect(tx.valueWei).toBe(0n);

    // Invariant #1 sanity — outer selector matches EXEC_TRANSACTION_SELECTOR.
    expect(tx.data.slice(0, 10)).toBe(EXEC_TRANSACTION_SELECTOR);

    // Round-trip decode of the calldata matches the encapsulated quartet.
    const decoded = decodeFunctionData({
      abi: execTransactionAbi,
      data: tx.data,
    });
    expect(decoded.functionName).toBe("execTransaction");
    const decodedArgs = decoded.args as readonly unknown[];
    expect((decodedArgs[0] as string).toLowerCase()).toBe(
      FIXTURE_SAFE_A_INPUT.to.toLowerCase(),
    );
    expect(decodedArgs[1]).toBe(FIXTURE_SAFE_A_INPUT.value);
    expect(decodedArgs[2]).toBe(FIXTURE_SAFE_A_INPUT.data);
    expect(decodedArgs[3]).toBe(0); // operation: call

    // The signatures field (positional arg 9) is the assembled blob =
    // single 65-byte signature (1-of-1).
    const sigBytes = decodedArgs[9] as Hex;
    expect(sigBytes.toLowerCase()).toBe(sig.toLowerCase());
  });

  it("payloadFingerprint uses VaultPilot-txverify-v1 (EVM) tag — recomputable", async () => {
    const sig = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    stubSafeChains({ owners: [ACCT0_ADDR], threshold: 1n });
    stubTxService(
      buildSafeAFixtureTx({
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
      }),
    );

    const result = await callTool(COMMON_ARGS);
    const sc = result.structuredContent as Record<string, unknown>;
    const handle = sc.handle as string;
    const record = _peekHandleForTesting(handle)!;
    const tx = record.tx;
    if (tx.txType !== undefined && tx.txType !== "evm") {
      throw new Error(`expected evm txType, got ${tx.txType}`);
    }
    const recomputed = computePayloadFingerprint({
      chainId: tx.chainId,
      to: tx.to,
      valueWei: tx.valueWei,
      data: tx.data,
    });
    expect(recomputed).toBe(record.payloadFingerprint);
    expect(sc.payloadFingerprint).toBe(record.payloadFingerprint);
  });

  it("PREPARE RECEIPT carries verbatim input", async () => {
    const sig = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    stubSafeChains({ owners: [ACCT0_ADDR], threshold: 1n });
    stubTxService(
      buildSafeAFixtureTx({
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
      }),
    );

    const result = await callTool(COMMON_ARGS);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/PREPARE\s+RECEIPT/);
    expect(text).toContain(FIXTURE_SAFE_A_INPUT.safeAddress);
    expect(text).toContain(SAFE_A_HASH);
  });
});

// ===========================================================================
// Test 2 — Happy path 2-of-3 with ascending-sort discipline anchor.
// ===========================================================================

describe("prepare_safe_tx_execute — 2-of-3 ascending sort discipline", () => {
  it("assembles signatures ASCENDING by signer address even when Tx Service order is REVERSE", async () => {
    const sigAcct0 = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    const sigAcct1 = sign(SAFE_A_HASH, ACCT1_PRIVKEY);
    // Owners are all three Anvil accts, threshold 2; signers = acct0 + acct1.
    stubSafeChains({
      owners: [ACCT0_ADDR, ACCT1_ADDR, ACCT2_ADDR],
      threshold: 2n,
    });
    // Tx Service insertion order: acct0 first (proposer), acct1 second
    // (approver) — REVERSE of ascending (acct1 < acct0).
    stubTxService(
      buildSafeAFixtureTx({
        confirmationsRequired: 2,
        confirmations: [
          { owner: ACCT0_ADDR, signature: sigAcct0 },
          { owner: ACCT1_ADDR, signature: sigAcct1 },
        ],
      }),
    );

    const result = await callTool(COMMON_ARGS);
    expect(result.isError).not.toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.signerCount).toBe(2);
    // signersAscending = [acct1, acct0] (since 0x7099... < 0xf39f...).
    const signersAsc = sc.signersAscending as readonly string[];
    expect(signersAsc[0]?.toLowerCase()).toBe(ACCT1_ADDR.toLowerCase());
    expect(signersAsc[1]?.toLowerCase()).toBe(ACCT0_ADDR.toLowerCase());

    // Assemble expected ascending blob: sigAcct1 (65 bytes) || sigAcct0 (65 bytes).
    const ascendingBlob = (
      "0x" +
      sigAcct1.slice(2) +
      sigAcct0.slice(2)
    ).toLowerCase();

    const handle = sc.handle as string;
    const record = _peekHandleForTesting(handle)!;
    const tx = record.tx;
    if (tx.txType !== undefined && tx.txType !== "evm") {
      throw new Error(`expected evm txType, got ${tx.txType}`);
    }
    const decoded = decodeFunctionData({
      abi: execTransactionAbi,
      data: tx.data,
    });
    const decodedArgs = decoded.args as readonly unknown[];
    const sigBytes = decodedArgs[9] as Hex;
    expect(sigBytes.toLowerCase()).toBe(ascendingBlob);

    // Defensive sanity — the assembled blob is 2*65 = 130 bytes.
    expect(hexToBytes(sigBytes).length).toBe(130);
  });
});

// ===========================================================================
// Tests 3-5 — Pre-flight refusals (INSUFFICIENT_SIGNATURES, INVALID_SIGNATURE_MODE, STALE_SIGNATURE).
// ===========================================================================

describe("prepare_safe_tx_execute — pre-flight refusals", () => {
  it("INSUFFICIENT_SIGNATURES when confirmations.length < threshold", async () => {
    const sig = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    stubSafeChains({
      owners: [ACCT0_ADDR, ACCT1_ADDR, ACCT2_ADDR],
      threshold: 2n,
    });
    stubTxService(
      buildSafeAFixtureTx({
        confirmationsRequired: 2,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
      }),
    );
    const result = await callTool(COMMON_ARGS);
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INSUFFICIENT_SIGNATURES");
    expect(String(sc.message)).toMatch(/Need 1 more signature/);
  });

  it("INVALID_SIGNATURE_MODE when any confirmation has v ∈ {0, 1}", async () => {
    const validSig = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    const invalidSig = sign(SAFE_A_HASH, ACCT1_PRIVKEY, 0); // v=0 contract sig
    stubSafeChains({
      owners: [ACCT0_ADDR, ACCT1_ADDR, ACCT2_ADDR],
      threshold: 2n,
    });
    stubTxService(
      buildSafeAFixtureTx({
        confirmationsRequired: 2,
        confirmations: [
          { owner: ACCT0_ADDR, signature: validSig },
          { owner: ACCT1_ADDR, signature: invalidSig },
        ],
      }),
    );
    const result = await callTool(COMMON_ARGS);
    expect(result.isError).toBe(true);
    expect(
      (result.structuredContent as Record<string, unknown>).errorCode,
    ).toBe("INVALID_SIGNATURE_MODE");
  });

  it("STALE_SIGNATURE when a confirmation recovers to an addr not in current owners", async () => {
    // acct2 signed earlier, but the current on-chain owner set is just acct0+acct1
    // (an ops-tx removed acct2 between approve and execute).
    const sigAcct0 = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    const sigAcct2 = sign(SAFE_A_HASH, ACCT2_PRIVKEY);
    stubSafeChains({
      owners: [ACCT0_ADDR, ACCT1_ADDR], // acct2 removed
      threshold: 2n,
    });
    stubTxService(
      buildSafeAFixtureTx({
        confirmationsRequired: 2,
        confirmations: [
          { owner: ACCT0_ADDR, signature: sigAcct0 },
          { owner: ACCT2_ADDR, signature: sigAcct2 },
        ],
      }),
    );
    const result = await callTool(COMMON_ARGS);
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("STALE_SIGNATURE");
    // Case-insensitive contains — the impl emits the EIP-55-checksummed
    // address from recoverAddress while the test fixture address is the
    // lowercase keccak-derived form.
    expect(String(sc.message).toLowerCase()).toContain(
      ACCT2_ADDR.toLowerCase(),
    );
  });
});

// ===========================================================================
// Test 6 — Tx Service DU dispatch.
// ===========================================================================

describe("prepare_safe_tx_execute — Tx Service DU dispatch", () => {
  it("not-found → INVALID_INPUT refusal", async () => {
    stubSafeChains({});
    vi.spyOn(safeTxService, "getMultisigTransaction").mockResolvedValue({
      kind: "not-found",
    });
    const result = await callTool(COMMON_ARGS);
    expect(result.isError).toBe(true);
    expect(
      (result.structuredContent as Record<string, unknown>).errorCode,
    ).toBe("INVALID_INPUT");
  });

  it("unsupported-chain → INVALID_INPUT refusal", async () => {
    stubSafeChains({});
    vi.spyOn(safeTxService, "getMultisigTransaction").mockResolvedValue({
      kind: "unsupported-chain",
      chainId: 1,
    });
    const result = await callTool(COMMON_ARGS);
    expect(result.isError).toBe(true);
    expect(
      (result.structuredContent as Record<string, unknown>).errorCode,
    ).toBe("INVALID_INPUT");
  });
});

// ===========================================================================
// Test 7 — Nonce drift refusal.
// ===========================================================================

describe("prepare_safe_tx_execute — on-chain state drift refusals", () => {
  it("INVALID_INPUT + nonce drift when on-chain nonce !== tx.nonce", async () => {
    const sig = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    // On-chain nonce advanced past tx.nonce.
    stubSafeChains({
      owners: [ACCT0_ADDR],
      threshold: 1n,
      nonce: FIXTURE_SAFE_A_INPUT.nonce + 5n,
    });
    stubTxService(
      buildSafeAFixtureTx({
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
      }),
    );
    const result = await callTool(COMMON_ARGS);
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(String(sc.message)).toMatch(/nonce drift/i);
  });

  it("UNSUPPORTED_SAFE_VERSION when on-chain VERSION is pre-v1.3.0", async () => {
    const sig = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    stubSafeChains({
      owners: [ACCT0_ADDR],
      threshold: 1n,
      version: "1.1.1",
    });
    stubTxService(
      buildSafeAFixtureTx({
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
      }),
    );
    const result = await callTool(COMMON_ARGS);
    expect(result.isError).toBe(true);
    expect(
      (result.structuredContent as Record<string, unknown>).errorCode,
    ).toBe("UNSUPPORTED_SAFE_VERSION");
  });

  it("INVALID_INPUT when sender not in current owners (Invariant #3 part A)", async () => {
    const sig = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    // Owners include acct1 + acct2 but NOT acct0 (the sender per PAIRED_STATUS_ACCT0).
    stubSafeChains({
      owners: [ACCT1_ADDR, ACCT2_ADDR],
      threshold: 2n,
    });
    stubTxService(
      buildSafeAFixtureTx({
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
      }),
    );
    const result = await callTool(COMMON_ARGS);
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(String(sc.message)).toMatch(/not.*owner/i);
  });
});

// ===========================================================================
// Tests 10-12 — Composite-tx preview.
// ===========================================================================

describe("prepare_safe_tx_execute — composite-tx preview (CHECKS PERFORMED)", () => {
  it("surfaces the encapsulated 'call to {to} with value {value} ETH' line", async () => {
    const sig = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    stubSafeChains({ owners: [ACCT0_ADDR], threshold: 1n });
    stubTxService(
      buildSafeAFixtureTx({
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
      }),
    );
    const result = await callTool(COMMON_ARGS);
    const text = (result.content[0] as { text: string }).text;
    // Encapsulated operation surfaces via the CHECKS PERFORMED "Encapsulated:"
    // line (and the WARN block's "operation:"/"target:" lines).
    expect(text).toMatch(/Encapsulated/);
    expect(text).toContain(FIXTURE_SAFE_A_INPUT.to);
  });

  it("delegatecall path emits [HARD-TRIGGER — DELEGATECALL] block (Phase 38 promotion)", async () => {
    // SafeTx C — delegatecall variant of SAFE-A.
    const delegateInput = {
      ...FIXTURE_SAFE_A_INPUT,
      operation: 1 as const,
    };
    const delegateTypedData = buildSafeEIP712TypedData(delegateInput);
    const delegateHash = hashTypedData({
      domain: delegateTypedData.domain,
      types: delegateTypedData.types as unknown as Parameters<
        typeof hashTypedData
      >[0]["types"],
      primaryType: "SafeTx",
      message: delegateTypedData.message,
    });
    const sig = sign(delegateHash, ACCT0_PRIVKEY);
    stubSafeChains({ owners: [ACCT0_ADDR], threshold: 1n });
    stubTxService(
      buildSafeAFixtureTx({
        operation: 1,
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
        safeTxHash: delegateHash,
      }),
    );
    const result = await callTool({
      chain: "ethereum",
      safeAddress: FIXTURE_SAFE_A_INPUT.safeAddress,
      safeTxHash: delegateHash,
    });
    expect(result.isError).not.toBe(true);
    const text = (result.content[0] as { text: string }).text;
    // Phase 38 Plan 38-01: informational "delegatecall: YES" line REMOVED;
    // hard-trigger block emitted instead.
    expect(text.includes("delegatecall:     YES")).toBe(false);
    expect(text).toContain("[HARD-TRIGGER — DELEGATECALL]");
    expect(text).toMatch(/Inv #12\.5/);
  });
});

// ===========================================================================
// Phase 38 Plan 38-01 — Inv #12.5 hard-trigger emission tests (execute site)
// ===========================================================================

const FIXTURE_SAFE_G_DATA_EXEC =
  "0x610b5925000000000000000000000000cafe0000000000000000000000000000cafe0001";
const FIXTURE_SAFE_G_MODULE_EXEC =
  "0xcafe0000000000000000000000000000cafe0001";

describe("prepare_safe_tx_execute — Phase 38 hard-trigger emission (inner-decoded)", () => {
  it("MODULE ENABLE: inner SafeTx data starts with 0x610b5925 AND inner to === safeAddress emits [HARD-TRIGGER — MODULE ENABLE] block", async () => {
    const moduleInput = {
      ...FIXTURE_SAFE_A_INPUT,
      to: FIXTURE_SAFE_A_INPUT.safeAddress,
      data: FIXTURE_SAFE_G_DATA_EXEC as Hex,
      value: 0n,
    };
    const moduleHash = computeSafeTxHash(moduleInput);
    const sig = sign(moduleHash, ACCT0_PRIVKEY);
    stubSafeChains({ owners: [ACCT0_ADDR], threshold: 1n });
    stubTxService(
      buildSafeAFixtureTx({
        to: FIXTURE_SAFE_A_INPUT.safeAddress,
        data: FIXTURE_SAFE_G_DATA_EXEC,
        value: "0",
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
        safeTxHash: moduleHash,
      }),
    );
    const result = await callTool({
      chain: "ethereum",
      safeAddress: FIXTURE_SAFE_A_INPUT.safeAddress,
      safeTxHash: moduleHash,
    });
    expect(result.isError).not.toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("[HARD-TRIGGER — MODULE ENABLE]");
    expect(text.toLowerCase()).toContain(FIXTURE_SAFE_G_MODULE_EXEC);
  });

  it("composite at execute: enableModule + operation: 1 emits BOTH blocks in document order", async () => {
    const compositeInput = {
      ...FIXTURE_SAFE_A_INPUT,
      to: FIXTURE_SAFE_A_INPUT.safeAddress,
      data: FIXTURE_SAFE_G_DATA_EXEC as Hex,
      value: 0n,
      operation: 1 as const,
    };
    const compositeHash = computeSafeTxHash(compositeInput);
    const sig = sign(compositeHash, ACCT0_PRIVKEY);
    stubSafeChains({ owners: [ACCT0_ADDR], threshold: 1n });
    stubTxService(
      buildSafeAFixtureTx({
        to: FIXTURE_SAFE_A_INPUT.safeAddress,
        data: FIXTURE_SAFE_G_DATA_EXEC,
        value: "0",
        operation: 1,
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
        safeTxHash: compositeHash,
      }),
    );
    const result = await callTool({
      chain: "ethereum",
      safeAddress: FIXTURE_SAFE_A_INPUT.safeAddress,
      safeTxHash: compositeHash,
    });
    expect(result.isError).not.toBe(true);
    const text = (result.content[0] as { text: string }).text;
    const idxModule = text.indexOf("[HARD-TRIGGER — MODULE ENABLE]");
    const idxDelegate = text.indexOf("[HARD-TRIGGER — DELEGATECALL]");
    expect(idxModule).toBeGreaterThanOrEqual(0);
    expect(idxDelegate).toBeGreaterThanOrEqual(0);
    expect(idxModule).toBeLessThan(idxDelegate);
  });

  it("WARN block (Phase 37 invariant) PRECEDES hard-trigger blocks in document order", async () => {
    const delegateInput = {
      ...FIXTURE_SAFE_A_INPUT,
      operation: 1 as const,
    };
    const delegateHash = computeSafeTxHash(delegateInput);
    const sig = sign(delegateHash, ACCT0_PRIVKEY);
    stubSafeChains({ owners: [ACCT0_ADDR], threshold: 1n });
    stubTxService(
      buildSafeAFixtureTx({
        operation: 1,
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
        safeTxHash: delegateHash,
      }),
    );
    const result = await callTool({
      chain: "ethereum",
      safeAddress: FIXTURE_SAFE_A_INPUT.safeAddress,
      safeTxHash: delegateHash,
    });
    expect(result.isError).not.toBe(true);
    const text = (result.content[0] as { text: string }).text;
    const idxWarn = text.indexOf("[WARN — SAFE EXECUTE COMPOSITE-TX]");
    const idxHardTrigger = text.indexOf("[HARD-TRIGGER — DELEGATECALL]");
    expect(idxWarn).toBeGreaterThanOrEqual(0);
    expect(idxHardTrigger).toBeGreaterThanOrEqual(0);
    expect(idxWarn).toBeLessThan(idxHardTrigger);
  });

  it("INVALID_INPUT when inner enableModule selector match but argument decode fails (truncated)", async () => {
    const truncatedInput = {
      ...FIXTURE_SAFE_A_INPUT,
      to: FIXTURE_SAFE_A_INPUT.safeAddress,
      data: "0x610b5925cafe" as Hex,
      value: 0n,
    };
    const truncatedHash = computeSafeTxHash(truncatedInput);
    const sig = sign(truncatedHash, ACCT0_PRIVKEY);
    stubSafeChains({ owners: [ACCT0_ADDR], threshold: 1n });
    stubTxService(
      buildSafeAFixtureTx({
        to: FIXTURE_SAFE_A_INPUT.safeAddress,
        data: "0x610b5925cafe",
        value: "0",
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
        safeTxHash: truncatedHash,
      }),
    );
    const result = await callTool({
      chain: "ethereum",
      safeAddress: FIXTURE_SAFE_A_INPUT.safeAddress,
      safeTxHash: truncatedHash,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown> & {
      errorCode?: string;
      message?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(
      /SafeTx data starts with enableModule selector but argument decode failed/,
    );
  });

  it("REGRESSION — Phase 37 informational 'delegatecall: YES' CHECKS PERFORMED line is REMOVED at execute", async () => {
    const delegateInput = {
      ...FIXTURE_SAFE_A_INPUT,
      operation: 1 as const,
    };
    const delegateHash = computeSafeTxHash(delegateInput);
    const sig = sign(delegateHash, ACCT0_PRIVKEY);
    stubSafeChains({ owners: [ACCT0_ADDR], threshold: 1n });
    stubTxService(
      buildSafeAFixtureTx({
        operation: 1,
        confirmationsRequired: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
        safeTxHash: delegateHash,
      }),
    );
    const result = await callTool({
      chain: "ethereum",
      safeAddress: FIXTURE_SAFE_A_INPUT.safeAddress,
      safeTxHash: delegateHash,
    });
    expect(result.isError).not.toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text.includes("delegatecall:     YES")).toBe(false);
    expect(text).toContain("[HARD-TRIGGER — DELEGATECALL]");
  });
});
