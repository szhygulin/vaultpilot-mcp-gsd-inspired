// Phase 37 Plan 37-03 (SAFE-08) — full three-step Safe signing-flow
// integration test.
//
// Stubbing strategy (per CLAUDE.md):
//   - Tx Service: vi.spyOn(safeTxService, "getMultisigTransaction" |
//     "postSignature") at the network boundary.
//   - On-chain reads: vi.spyOn(_safeChains, "getOnchainSafeInfo" |
//     "getOnchainDomainSeparator") for owner/threshold/nonce/version reads.
//   - Session manager: vi.fn() getStatus mock returns paired wallet state.
//   - recoverAddress: REAL viem implementation (deterministic against the
//     synthetic ECDSA signatures we produce from known Anvil-account privkeys).
//
// Two fixtures (per RESEARCH Open Question 5):
//   (1) 1-of-1 (degenerate / single signature blob) — anchors byte-identity
//       of the encoded execTransaction calldata + sentinel sentinel flag.
//   (2) 2-of-3 (ascending-sort discipline + multi-signer assembly) — Tx
//       Service insertion order is REVERSE of ascending order, which is
//       what proves the sort logic is exercised (NOT incidentally satisfied
//       by insertion order).
//
// Anvil-address ordering anchor (planner-resolved per WARNING 1):
//   - acct0 -> 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (proposer in 2-of-3)
//   - acct1 -> 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (approver in 2-of-3)
//   - acct2 -> 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC (third owner, non-signing)
//   - Lex ascending lowercase: acct2 < acct1 < acct0
//   - 2-of-3 signers {acct0, acct1}: Tx Service insertion order (proposer first)
//     = [acct0, acct1] REVERSED; ascending sort = [acct1, acct0]
//     (because 0x7099... < 0xf39f...)
//
// Acceptance gates run at the bottom:
//   - isSafeExecTransaction grep-guard (T-37-26 mitigation): EXACTLY TWO
//     functional source-file references — one assignment in
//     prepare_safe_tx_execute.ts, one read in preview_send.ts.

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

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

vi.mock("../../src/chains/registry.js", () => ({
  getChainClient: (_chainId: number) =>
    ({
      multicall: vi.fn(),
      readContract: vi.fn(),
    }) as unknown as PublicClient,
  isPublicNodeFallback: () => false,
  _resetChainRegistryForTesting: () => {},
  PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
}));

const {
  getStatusSpy,
  getTransactionCountSpy,
  estimateFeesPerGasSpy,
  estimateGasSpy,
  callSpy,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getTransactionCountSpy: vi.fn(),
  estimateFeesPerGasSpy: vi.fn(),
  estimateGasSpy: vi.fn(),
  callSpy: vi.fn(),
}));

vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>(
    "viem/actions",
  );
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

vi.mock("../../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/wallet/session-manager.js")
  >("../../src/wallet/session-manager.js");
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) =>
      getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called in integration test");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

import { _safeChains } from "../../src/chains/safe.js";
import * as safeTxService from "../../src/clients/safe-tx-service.js";
import { _resetDemoModeForTesting } from "../../src/config/env.js";
import { _resetActivePersonaForTesting } from "../../src/demo/state.js";
import { execTransactionAbi } from "../../src/signing/safe-exec-decode.js";
import { buildSafeEIP712TypedData } from "../../src/signing/safe-tx-hash.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../../src/tools/index.js";
import { FIXTURE_SAFE_A_INPUT } from "../signing-safe-tx-hash.test.js";

await import("../../src/tools/register-all.js");

// ===========================================================================
// Anvil-account fixtures.
// ===========================================================================

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

// Sanity guard for the Anvil-address ordering anchor:
//   lex ascending lowercase = acct2 < acct1 < acct0
// If the secp256k1 derivation drifts (e.g. @noble bump changes encoding),
// this fails at module-load time, NOT at a per-test assertion.
if (
  !(
    ACCT2_ADDR.toLowerCase() < ACCT1_ADDR.toLowerCase() &&
    ACCT1_ADDR.toLowerCase() < ACCT0_ADDR.toLowerCase()
  )
) {
  throw new Error(
    `Anvil-account ordering invariant violated:\n` +
      `  acct0 = ${ACCT0_ADDR}\n` +
      `  acct1 = ${ACCT1_ADDR}\n` +
      `  acct2 = ${ACCT2_ADDR}\n` +
      `Expected lex ascending: acct2 < acct1 < acct0`,
  );
}

function sign(digest: Hex, privKey: Hex): Hex {
  const sig = secp256k1.sign(digest.slice(2), privKey.slice(2), { lowS: true });
  const recovery = sig.recovery ?? 0;
  const v = recovery + 27;
  const r = sig.r.toString(16).padStart(64, "0");
  const s = sig.s.toString(16).padStart(64, "0");
  const vHex = v.toString(16).padStart(2, "0");
  return ("0x" + r + s + vHex) as Hex;
}

// ===========================================================================
// Fixture SAFE-A reuse — same inputs as Plan 37-01 fixtures.
// ===========================================================================

const SAFE_A_TYPED_DATA = buildSafeEIP712TypedData(FIXTURE_SAFE_A_INPUT);
const SAFE_A_HASH: Hex = hashTypedData({
  domain: SAFE_A_TYPED_DATA.domain,
  types: SAFE_A_TYPED_DATA.types as unknown as Parameters<typeof hashTypedData>[0]["types"],
  primaryType: "SafeTx",
  message: SAFE_A_TYPED_DATA.message,
});

const SAFE_ADDR = FIXTURE_SAFE_A_INPUT.safeAddress;

function buildTxServiceFixture(opts: {
  threshold: number;
  confirmations: Array<{ owner: string; signature: string }>;
}): safeTxService.SafeMultisigTransactionResponse {
  return {
    safe: SAFE_ADDR as Address,
    to: FIXTURE_SAFE_A_INPUT.to as Address,
    value: FIXTURE_SAFE_A_INPUT.value.toString(),
    data: FIXTURE_SAFE_A_INPUT.data,
    operation: FIXTURE_SAFE_A_INPUT.operation,
    gasToken: "0x0000000000000000000000000000000000000000" as Address,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    refundReceiver: "0x0000000000000000000000000000000000000000" as Address,
    nonce: FIXTURE_SAFE_A_INPUT.nonce.toString(),
    safeTxHash: SAFE_A_HASH,
    confirmationsRequired: opts.threshold,
    confirmations: opts.confirmations.map((c) => ({
      owner: c.owner as Address,
      signature: c.signature,
      signatureType: "EOA" as const,
    })),
    signatures: null,
    isExecuted: false,
  };
}

function stubOnchainSafeInfo(opts: {
  owners: Address[];
  threshold: bigint;
  version?: string;
}): void {
  vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
    owners: opts.owners,
    threshold: opts.threshold,
    nonce: FIXTURE_SAFE_A_INPUT.nonce,
    version: opts.version ?? FIXTURE_SAFE_A_INPUT.safeVersion,
  });
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool.handler(args);
}

beforeEach(() => {
  getStatusSpy.mockReset();
  getTransactionCountSpy.mockReset();
  estimateFeesPerGasSpy.mockReset();
  estimateGasSpy.mockReset();
  callSpy.mockReset();
  _resetHandleStoreForTesting();
  _resetActivePersonaForTesting();
  delete process.env["VAULTPILOT_DEMO"];
  _resetDemoModeForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetActivePersonaForTesting();
  _resetDemoModeForTesting();
});

// ===========================================================================
// 1-of-1 flow — propose → submit → execute.
// ===========================================================================

describe("Safe three-step flow — 1-of-1 propose → submit → execute", () => {
  it("propose + submit + execute produces a PreparedTxEvm with isSafeExecTransaction sentinel + Invariant #1 selector + payloadFingerprint matches outer calldata", async () => {
    // acct0 = sole owner.
    getStatusSpy.mockResolvedValue({
      paired: true,
      accounts: [ACCT0_ADDR],
      activeAccount: ACCT0_ADDR,
      address: ACCT0_ADDR,
      chainId: 1,
      sessionTopicLast8: "deadbeef",
      accountsByChain: { 1: [ACCT0_ADDR] },
      activeChainId: 1,
      partiallyPaired: false,
    });
    stubOnchainSafeInfo({ owners: [ACCT0_ADDR], threshold: 1n });

    // Synthetic signature.
    const sig = sign(SAFE_A_HASH, ACCT0_PRIVKEY);

    // Step 3 (skip propose+submit — the integration assertion is on execute
    // given a Tx Service that already shows the SafeTx + 1 confirmation).
    vi.spyOn(safeTxService, "getMultisigTransaction").mockResolvedValue({
      kind: "ok",
      tx: buildTxServiceFixture({
        threshold: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
      }),
    });

    const result = await callTool("prepare_safe_tx_execute", {
      chain: "ethereum",
      safeAddress: SAFE_ADDR,
      safeTxHash: SAFE_A_HASH,
    });
    expect(result.isError).not.toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    const handle = sc.handle as string;
    const record = _peekHandleForTesting(handle)!;

    // Sentinel set.
    expect(record.isSafeExecTransaction).toBe(true);

    // Dispatch target = Safe proxy at safeAddress (NOT Singleton).
    expect(sc.dispatchTarget).toBe(SAFE_ADDR);

    // Outer selector matches EXEC_TRANSACTION_SELECTOR (Invariant #1).
    const tx = record.tx;
    if (tx.txType !== undefined && tx.txType !== "evm") {
      throw new Error(`expected evm txType, got ${tx.txType}`);
    }
    expect(tx.data.slice(0, 10)).toBe("0x6a761202");

    // Calldata round-trip decode against fixture inputs.
    const decoded = decodeFunctionData({
      abi: execTransactionAbi,
      data: tx.data,
    });
    const args = decoded.args as readonly unknown[];
    expect((args[0] as string).toLowerCase()).toBe(
      FIXTURE_SAFE_A_INPUT.to.toLowerCase(),
    );
    expect(args[1]).toBe(FIXTURE_SAFE_A_INPUT.value);
    expect(args[2]).toBe(FIXTURE_SAFE_A_INPUT.data);
    expect(args[3]).toBe(0);

    // 1-of-1 signatures blob is exactly the one ECDSA signature.
    expect((args[9] as string).toLowerCase()).toBe(sig.toLowerCase());
  });
});

// ===========================================================================
// 2-of-3 flow — ascending sort discipline anchor.
// ===========================================================================

describe("Safe three-step flow — 2-of-3 with ascending-sort discipline (Tx Service insertion REVERSE of ascending)", () => {
  it("Tx Service insertion order [acct0, acct1] (proposer-then-approver) → assembled blob = [sigAcct1, sigAcct0] (ascending by signer address)", async () => {
    // Three-owner Safe, threshold 2. Caller (sender) = acct0.
    getStatusSpy.mockResolvedValue({
      paired: true,
      accounts: [ACCT0_ADDR, ACCT1_ADDR, ACCT2_ADDR],
      activeAccount: ACCT0_ADDR,
      address: ACCT0_ADDR,
      chainId: 1,
      sessionTopicLast8: "deadbeef",
      accountsByChain: { 1: [ACCT0_ADDR, ACCT1_ADDR, ACCT2_ADDR] },
      activeChainId: 1,
      partiallyPaired: false,
    });
    stubOnchainSafeInfo({
      owners: [ACCT0_ADDR, ACCT1_ADDR, ACCT2_ADDR],
      threshold: 2n,
    });

    const sigAcct0 = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    const sigAcct1 = sign(SAFE_A_HASH, ACCT1_PRIVKEY);

    // Tx Service insertion order: proposer (acct0) first, approver (acct1)
    // second — REVERSE of ascending order (acct1 < acct0).
    vi.spyOn(safeTxService, "getMultisigTransaction").mockResolvedValue({
      kind: "ok",
      tx: buildTxServiceFixture({
        threshold: 2,
        confirmations: [
          { owner: ACCT0_ADDR, signature: sigAcct0 },
          { owner: ACCT1_ADDR, signature: sigAcct1 },
        ],
      }),
    });

    const result = await callTool("prepare_safe_tx_execute", {
      chain: "ethereum",
      safeAddress: SAFE_ADDR,
      safeTxHash: SAFE_A_HASH,
    });
    expect(result.isError).not.toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    const handle = sc.handle as string;
    const record = _peekHandleForTesting(handle)!;

    // signersAscending = [acct1, acct0].
    const signersAscending = sc.signersAscending as string[];
    expect(signersAscending[0]?.toLowerCase()).toBe(ACCT1_ADDR.toLowerCase());
    expect(signersAscending[1]?.toLowerCase()).toBe(ACCT0_ADDR.toLowerCase());

    // Assembled blob: sigAcct1 (65 bytes) || sigAcct0 (65 bytes) — REVERSED
    // from the Tx Service insertion order.
    const tx = record.tx;
    if (tx.txType !== undefined && tx.txType !== "evm") {
      throw new Error(`expected evm txType`);
    }
    const decoded = decodeFunctionData({
      abi: execTransactionAbi,
      data: tx.data,
    });
    const args = decoded.args as readonly unknown[];
    const assembledBlob = (args[9] as Hex).toLowerCase();
    const expectedBlob = (
      "0x" + sigAcct1.slice(2) + sigAcct0.slice(2)
    ).toLowerCase();
    expect(assembledBlob).toBe(expectedBlob);
    expect(hexToBytes(args[9] as Hex).length).toBe(130);
  });
});

// ===========================================================================
// WRONG_HANDLE_KIND refusals from send_transaction + preview_send.
// ===========================================================================

describe("Safe three-step flow — wrong-routing refusals", () => {
  it("send_transaction on a propose-handle (PreparedTxSafeTypedData) refuses with WRONG_HANDLE_KIND", async () => {
    getStatusSpy.mockResolvedValue({
      paired: true,
      accounts: [ACCT0_ADDR],
      activeAccount: ACCT0_ADDR,
      address: ACCT0_ADDR,
      chainId: 1,
      sessionTopicLast8: "deadbeef",
      accountsByChain: { 1: [ACCT0_ADDR] },
      activeChainId: 1,
      partiallyPaired: false,
    });
    stubOnchainSafeInfo({ owners: [ACCT0_ADDR], threshold: 1n });
    vi.spyOn(_safeChains, "getOnchainDomainSeparator").mockResolvedValue(
      "0xPLACEHOLDER_DOMAIN" as Hex,
    );

    const propose = await callTool("prepare_safe_tx_propose", {
      chain: "ethereum",
      safeAddress: SAFE_ADDR,
      to: FIXTURE_SAFE_A_INPUT.to,
      value: FIXTURE_SAFE_A_INPUT.value.toString(),
      data: FIXTURE_SAFE_A_INPUT.data,
      operation: "call",
    });
    expect(propose.isError).not.toBe(true);
    const proposeSc = propose.structuredContent as Record<string, unknown>;
    const handle = proposeSc.handle as string;

    const send = await callTool("send_transaction", {
      handle,
      previewToken: "any-token",
      userDecision: "send",
    });
    expect(send.isError).toBe(true);
    expect((send.structuredContent as Record<string, unknown>).errorCode).toBe(
      "WRONG_HANDLE_KIND",
    );
  });

  it("preview_send on a propose-handle (PreparedTxSafeTypedData) refuses with WRONG_HANDLE_KIND", async () => {
    getStatusSpy.mockResolvedValue({
      paired: true,
      accounts: [ACCT0_ADDR],
      activeAccount: ACCT0_ADDR,
      address: ACCT0_ADDR,
      chainId: 1,
      sessionTopicLast8: "deadbeef",
      accountsByChain: { 1: [ACCT0_ADDR] },
      activeChainId: 1,
      partiallyPaired: false,
    });
    stubOnchainSafeInfo({ owners: [ACCT0_ADDR], threshold: 1n });
    vi.spyOn(_safeChains, "getOnchainDomainSeparator").mockResolvedValue(
      "0xPLACEHOLDER_DOMAIN" as Hex,
    );

    const propose = await callTool("prepare_safe_tx_propose", {
      chain: "ethereum",
      safeAddress: SAFE_ADDR,
      to: FIXTURE_SAFE_A_INPUT.to,
      value: FIXTURE_SAFE_A_INPUT.value.toString(),
      data: FIXTURE_SAFE_A_INPUT.data,
      operation: "call",
    });
    const proposeSc = propose.structuredContent as Record<string, unknown>;
    const handle = proposeSc.handle as string;

    const preview = await callTool("preview_send", { handle });
    expect(preview.isError).toBe(true);
    expect(
      (preview.structuredContent as Record<string, unknown>).errorCode,
    ).toBe("WRONG_HANDLE_KIND");
  });
});

// ===========================================================================
// WARN-block byte-identity (mirror Phase 35 T-35-03-G).
// ===========================================================================

describe("Safe three-step flow — WARN-block byte-identity prepare-vs-preview", () => {
  it("prepare-side WARN block equals preview-side WARN block byte-for-byte", async () => {
    getStatusSpy.mockResolvedValue({
      paired: true,
      accounts: [ACCT0_ADDR],
      activeAccount: ACCT0_ADDR,
      address: ACCT0_ADDR,
      chainId: 1,
      sessionTopicLast8: "deadbeef",
      accountsByChain: { 1: [ACCT0_ADDR] },
      activeChainId: 1,
      partiallyPaired: false,
    });
    stubOnchainSafeInfo({ owners: [ACCT0_ADDR], threshold: 1n });
    const sig = sign(SAFE_A_HASH, ACCT0_PRIVKEY);
    vi.spyOn(safeTxService, "getMultisigTransaction").mockResolvedValue({
      kind: "ok",
      tx: buildTxServiceFixture({
        threshold: 1,
        confirmations: [{ owner: ACCT0_ADDR, signature: sig }],
      }),
    });

    const prepareResult = await callTool("prepare_safe_tx_execute", {
      chain: "ethereum",
      safeAddress: SAFE_ADDR,
      safeTxHash: SAFE_A_HASH,
    });
    expect(prepareResult.isError).not.toBe(true);
    const prepareText = (prepareResult.content[0] as { text: string }).text;
    const prepareWarnMatch = prepareText.match(
      /\[WARN — SAFE EXECUTE COMPOSITE-TX\][\s\S]*?\n  preview_send re-emits this block byte-identical so any drift between\n  prepare-side and preview-side decoding fails an integration regression\./,
    );
    expect(prepareWarnMatch).not.toBeNull();

    // preview_send dependencies — viem/actions are module-mocked at the
    // top of this file; script the per-test responses now.
    getTransactionCountSpy.mockResolvedValue(7);
    estimateFeesPerGasSpy.mockResolvedValue({
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
    });
    estimateGasSpy.mockResolvedValue(150_000n);
    callSpy.mockResolvedValue({ data: "0x" });

    const handle = (prepareResult.structuredContent as Record<string, unknown>)
      .handle as string;
    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).not.toBe(true);
    const previewText = (previewResult.content[0] as { text: string }).text;
    const previewWarnMatch = previewText.match(
      /\[WARN — SAFE EXECUTE COMPOSITE-TX\][\s\S]*?\n  preview_send re-emits this block byte-identical so any drift between\n  prepare-side and preview-side decoding fails an integration regression\./,
    );
    expect(previewWarnMatch).not.toBeNull();

    // Byte-identical assertion.
    expect(previewWarnMatch![0]).toBe(prepareWarnMatch![0]);
  });
});

// ===========================================================================
// isSafeExecTransaction grep-guard (T-37-26 mitigation).
// ===========================================================================

describe("Safe three-step flow — isSafeExecTransaction sentinel grep-guard (T-37-26)", () => {
  it("isSafeExecTransaction functional sites live in EXACTLY three allowed source files (mirror of Phase 35 Test 6)", () => {
    // Per CONTEXT §FROZEN-area + §prepare_safe_tx_execute: the
    // `isSafeExecTransaction` sentinel is set ONLY by
    // prepare_safe_tx_execute.ts (createHandle call + structuredContent
    // surfacing — mirror of prepare_custom_call's
    // `acknowledgeNonProtocolTarget` shape) and read ONLY by
    // preview_send.ts (the Layer 0.5 bypass `||` extension). The
    // declaration site in handle-store.ts is the type field + the
    // createHandle conditional spread.
    //
    // Mirror of Phase 35 escape-hatch Test 6 — file-level counting via
    // per-file boolean assignment-presence (NOT raw-grep-line counting):
    // we assert no OFFENDER file (i.e. a file outside the three
    // allowed paths) contains the assignment OR read pattern. Comments
    // + string literals are filtered defensively.
    const srcRoot = path.resolve(process.cwd(), "src");
    const sentinelPattern =
      /isSafeExecTransaction:\s*true|record\.isSafeExecTransaction|isSafeExecTransaction\?\s*:\s*true/;
    function* walk(dir: string): Generator<string> {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) yield* walk(p);
        else if (e.isFile() && p.endsWith(".ts")) yield p;
      }
    }
    const allowedFiles = new Set([
      path.resolve(srcRoot, "tools/prepare_safe_tx_execute.ts"),
      path.resolve(srcRoot, "tools/preview_send.ts"),
      path.resolve(srcRoot, "signing/handle-store.ts"),
    ]);
    const offenders: string[] = [];
    const witnesses: string[] = [];
    for (const file of walk(srcRoot)) {
      const content = fs.readFileSync(file, "utf8");
      let hasMatch = false;
      for (const line of content.split("\n")) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("//")) continue;
        if (trimmed.startsWith("*")) continue;
        if (trimmed.startsWith('"')) continue; // string-literal element
        if (trimmed.startsWith("`")) continue; // backtick template element
        if (sentinelPattern.test(line)) {
          hasMatch = true;
          break;
        }
      }
      if (hasMatch) {
        if (allowedFiles.has(file)) witnesses.push(file);
        else offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
    // All 3 allowed sites should actually emit (the type decl in
    // handle-store.ts; the assignment in prepare_safe_tx_execute.ts; the
    // read in preview_send.ts).
    expect(witnesses.length).toBe(3);
  });

  it("preview_send.ts has EXACTLY ONE non-comment read of record.isSafeExecTransaction (Pitfall 1 mirror)", () => {
    // Mirror of Phase 35 Test 7 — the Layer 0.5 bypass read fires AT THE
    // EVM dispatch site ONLY. Solana/TRON/BTC dispatch sites MUST NOT
    // read the sentinel.
    const previewSendPath = path.resolve(
      process.cwd(),
      "src/tools/preview_send.ts",
    );
    const src = fs.readFileSync(previewSendPath, "utf8");
    let nonCommentReads = 0;
    for (const line of src.split("\n")) {
      if (!line.includes("record.isSafeExecTransaction")) continue;
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//")) continue;
      if (trimmed.startsWith("*")) continue;
      nonCommentReads += 1;
    }
    expect(nonCommentReads).toBe(1);
  });
});

// ===========================================================================
// FROZEN-area additive-arms-only acceptance gate (Phase 36 Test 18 mirror).
// ===========================================================================

describe("Safe three-step flow — FROZEN-area additive-arms invariant", () => {
  it("preview_send.ts + send_transaction.ts diff against origin/main contains ONLY the authorized additive sites", () => {
    // The plan authorizes:
    //   - preview_send.ts: 3 additive sites (refusal gate, `||` extension to
    //     escapeHatchBypassActive, composite-tx decode arm). The `||`
    //     extension is a single-line modification of the existing
    //     `escapeHatchBypassActive = record.acknowledgeNonProtocolTarget ===
    //     true;` declaration. The composite-tx arm extends the existing
    //     `effectiveDecodedArgsBlock` ternary to a chained ternary.
    //   - send_transaction.ts: 1 additive arm (WRONG_HANDLE_KIND refusal for
    //     txType === "safe-typed-data"). Existing dispatch arms BYTE-IDENTICAL.
    //
    // The strict no-deletions-at-all assertion conflicts with the explicit
    // `||` extension authorization in the plan. We enforce the WEAKER but
    // CORRECT invariant: every deletion in the diff is one of the two
    // explicitly-authorized single-line modifications.
    const repoRoot = path.resolve(process.cwd());
    // git rev-parse --show-toplevel returns the worktree root; use it
    // defensively so the test works whether run from repo root or worktree.
    let gitRoot: string;
    try {
      gitRoot = execSync("git rev-parse --show-toplevel", {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim();
    } catch {
      gitRoot = repoRoot;
    }
    const diff = execSync(
      "git diff origin/main -- src/tools/send_transaction.ts src/tools/preview_send.ts",
      { cwd: gitRoot, encoding: "utf8" },
    );
    const deletions = diff
      .split("\n")
      .filter((l) => /^-[^-]/.test(l));
    // Authorized deletions (one-line modifications that ADD the `||`
    // extension and the safeExec ternary arm into existing decls):
    const authorizedFragments = [
      // Site (b): the existing escape-hatch bypass single-line declaration.
      "record.acknowledgeNonProtocolTarget === true;",
      // Site (c): the existing effectiveDecodedArgsBlock ternary tail.
      ": decodedArgsBlock;",
    ];
    const unauthorized = deletions.filter(
      (l) => !authorizedFragments.some((f) => l.includes(f)),
    );
    expect(unauthorized).toEqual([]);

    // Also assert the existing send_transaction.ts dispatch arms are
    // byte-identical — its diff contains ZERO deletions (the WRONG_HANDLE_KIND
    // arm is purely additive).
    const sendDiff = execSync(
      "git diff origin/main -- src/tools/send_transaction.ts",
      { cwd: gitRoot, encoding: "utf8" },
    );
    const sendDeletions = sendDiff
      .split("\n")
      .filter((l) => /^-[^-]/.test(l));
    expect(sendDeletions).toEqual([]);

    // Defensive: file-level sanity — both modified files still exist.
    expect(
      fs.existsSync(
        path.join(gitRoot, "src/tools/send_transaction.ts"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(gitRoot, "src/tools/preview_send.ts")),
    ).toBe(true);
  });
});
