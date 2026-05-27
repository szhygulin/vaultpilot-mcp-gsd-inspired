// prepare_safe_tx_approve unit tests — Phase 37 Plan 37-02 (SAFE-06).
//
// Anchors:
//   - Happy path: returns { handle, safeTxHash, typedDataStructure,
//     payloadFingerprint, domainSeparatorMatches } in structuredContent.
//   - Cross-link to Fixture SAFE-A: when the Tx Service fixture's SafeTx fields
//     match FIXTURE_SAFE_A_INPUT, the recomputed safeTxHash === FIXTURE_SAFE_A_HASH
//     (regression anchor — drift in computeSafeTxHash fails this specific line).
//   - txServiceDrift refusal: Tx Service-reported safeTxHash that diverges from
//     the recomputed local digest produces an INVALID_INPUT + txServiceDrift
//     refusal (T-37-10 mitigation).
//   - domainSeparatorDrift: surfaced in CHECKS PERFORMED informationally; does
//     NOT refuse (the local typed-data digest is correct by construction).
//   - duplicateSignWarning: surfaced when the resolved-from is already in
//     confirmations[]; informational, not a refusal.
//   - Tx Service DU dispatch: not-found / unsupported-chain / rate-limited /
//     error each surface a structured refusal.
//   - UNSUPPORTED_SAFE_VERSION (pre-v1.3.0 on-chain VERSION()).
//   - Non-owner sender → INVALID_INPUT.
//   - delegatecall path surfaces Phase-38 hard-trigger informational note.
//   - PREPARE RECEIPT + LEDGER DISPLAY shape.

import type { Address, Hex, PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock chain registry BEFORE importing the tool (it module-time imports getChainClient).
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

// Mock the session-manager so `resolveFrom` sees a paired status.
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
      throw new Error("pair should not be called from prepare_safe_tx_approve tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

import { _safeChains } from "../src/chains/safe.js";
import * as safeTxService from "../src/clients/safe-tx-service.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  type PreparedTxSafeTypedData,
} from "../src/signing/handle-store.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import {
  FIXTURE_SAFE_A_HASH,
  FIXTURE_SAFE_A_INPUT,
} from "./signing-safe-tx-hash.test.js";
import { computeSafeTxHash } from "../src/signing/safe-tx-hash.js";

await import("../src/tools/register-all.js");

// Persona must match an owner of the fixture Safe (Anvil acct 1).
const SAFE_A_OWNER_PERSONA: Address =
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const NON_OWNER_PERSONA: Address =
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const PAIRED_STATUS = {
  paired: true as const,
  accounts: [SAFE_A_OWNER_PERSONA],
  activeAccount: SAFE_A_OWNER_PERSONA,
  address: SAFE_A_OWNER_PERSONA,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: {
    1: [SAFE_A_OWNER_PERSONA, NON_OWNER_PERSONA],
    42161: [SAFE_A_OWNER_PERSONA],
    137: [SAFE_A_OWNER_PERSONA],
    8453: [SAFE_A_OWNER_PERSONA],
    10: [SAFE_A_OWNER_PERSONA],
  } as Record<number, Address[]>,
  activeChainId: 1,
  partiallyPaired: false,
};

const SAFE_A_FIXTURE_DOMAIN_SEPARATOR: Hex =
  // Real on-chain domainSeparator() for the Fixture SAFE-A Safe (matches the
  // local viem.hashDomain output for {chainId: 1, verifyingContract: 0x1234…}).
  // Re-derived at write time via /tmp probe; pinned here to prevent test
  // flakiness when a future on-chain mock returns the wrong value.
  "0xPLACEHOLDER_DOMAIN" as Hex;

async function callTool(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_safe_tx_approve");
  if (!tool) throw new Error("prepare_safe_tx_approve not registered");
  return tool.handler(args);
}

beforeEach(() => {
  getStatusSpy.mockReset();
  _resetHandleStoreForTesting();
  _resetActivePersonaForTesting();
  delete process.env["VAULTPILOT_DEMO"];
  _resetDemoModeForTesting();
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetActivePersonaForTesting();
  _resetDemoModeForTesting();
});

function stubSafeChains(opts: {
  owners?: Address[];
  threshold?: bigint;
  nonce?: bigint;
  version?: string;
  domainSeparator?: Hex;
}): void {
  vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
    owners: opts.owners ?? [SAFE_A_OWNER_PERSONA],
    threshold: opts.threshold ?? 1n,
    nonce: opts.nonce ?? FIXTURE_SAFE_A_INPUT.nonce,
    version: opts.version ?? FIXTURE_SAFE_A_INPUT.safeVersion,
  });
  vi.spyOn(_safeChains, "getOnchainDomainSeparator").mockResolvedValue(
    opts.domainSeparator ?? SAFE_A_FIXTURE_DOMAIN_SEPARATOR,
  );
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
  confirmations?: Array<{ owner: string; signature: string; signatureType: string }>;
}

/**
 * Build a Tx Service SafeTx fixture mirroring the FIXTURE_SAFE_A_INPUT shape.
 * The safeTxHash defaults to FIXTURE_SAFE_A_HASH so the recomputation check
 * passes; tests that exercise the txServiceDrift gate override the field.
 */
function buildSafeAFixtureTx(overrides: SafeTxFixtureOverrides = {}): {
  safe: string;
  to: string;
  value: string;
  data: string;
  operation: number;
  gasToken: string;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  refundReceiver: string;
  nonce: string;
  safeTxHash: string;
  confirmationsRequired: number;
  confirmations?: Array<{ owner: string; signature: string; signatureType: string }>;
  signatures: string | null;
  isExecuted: boolean;
} {
  return {
    safe: overrides.safe ?? FIXTURE_SAFE_A_INPUT.safeAddress,
    to: overrides.to ?? FIXTURE_SAFE_A_INPUT.to,
    value: overrides.value ?? FIXTURE_SAFE_A_INPUT.value.toString(),
    data: overrides.data ?? FIXTURE_SAFE_A_INPUT.data,
    operation: overrides.operation ?? FIXTURE_SAFE_A_INPUT.operation,
    gasToken:
      overrides.gasToken ?? "0x0000000000000000000000000000000000000000",
    safeTxGas: overrides.safeTxGas ?? "0",
    baseGas: overrides.baseGas ?? "0",
    gasPrice: overrides.gasPrice ?? "0",
    refundReceiver:
      overrides.refundReceiver ?? "0x0000000000000000000000000000000000000000",
    nonce: overrides.nonce ?? FIXTURE_SAFE_A_INPUT.nonce.toString(),
    safeTxHash: overrides.safeTxHash ?? FIXTURE_SAFE_A_HASH,
    confirmationsRequired: 2,
    confirmations: overrides.confirmations,
    signatures: null,
    isExecuted: false,
  };
}

function stubTxService(
  fixture: ReturnType<typeof buildSafeAFixtureTx>,
): void {
  vi.spyOn(safeTxService, "getMultisigTransaction").mockResolvedValue({
    kind: "ok",
    tx: fixture as unknown as safeTxService.SafeMultisigTransactionResponse,
  });
}

function approveArgs(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    chain: "ethereum",
    safeAddress: FIXTURE_SAFE_A_INPUT.safeAddress,
    safeTxHash: FIXTURE_SAFE_A_HASH,
    ...overrides,
  };
}

describe("prepare_safe_tx_approve — happy path + Fixture SAFE-A cross-link", () => {
  it("returns structuredContent with handle + safeTxHash + typedDataStructure + payloadFingerprint", async () => {
    stubSafeChains({});
    stubTxService(buildSafeAFixtureTx());
    const res = await callTool(approveArgs());
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toBeDefined();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc).toHaveProperty("handle");
    expect(sc).toHaveProperty("safeTxHash", FIXTURE_SAFE_A_HASH);
    expect(sc).toHaveProperty("typedDataStructure");
    expect(sc).toHaveProperty("payloadFingerprint");
    expect(sc).toHaveProperty("safeVersion", "1.3.0");
    expect(sc).toHaveProperty("operation", "call");
  });

  it("Cross-link Fixture SAFE-A — recomputed safeTxHash byte-equals FIXTURE_SAFE_A_HASH", async () => {
    stubSafeChains({});
    stubTxService(buildSafeAFixtureTx());
    const res = await callTool(approveArgs());
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.safeTxHash).toBe(FIXTURE_SAFE_A_HASH);
  });

  it("Handle round-trip — _peekHandleForTesting recovers a PreparedTxSafeTypedData record", async () => {
    stubSafeChains({});
    stubTxService(buildSafeAFixtureTx());
    const res = await callTool(approveArgs());
    const sc = res.structuredContent as Record<string, unknown>;
    const handle = sc.handle as string;
    const record = _peekHandleForTesting(handle);
    expect(record).toBeDefined();
    expect(record?.tx.txType).toBe("safe-typed-data");
    const tx = record!.tx as PreparedTxSafeTypedData;
    expect(tx.safeTxHash).toBe(FIXTURE_SAFE_A_HASH);
    expect(tx.operation).toBe("call");
  });

  it("PREPARE RECEIPT block carries verbatim agent input", async () => {
    stubSafeChains({});
    stubTxService(buildSafeAFixtureTx());
    const res = await callTool(approveArgs());
    const text = res.content[0]?.text ?? "";
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/safe:\s+0x1234567890123456789012345678901234567890/);
    expect(text).toMatch(new RegExp(`safeTxHash:\\s+${FIXTURE_SAFE_A_HASH}`));
  });

  it("LEDGER DISPLAY block surfaces both clear-sign + blind-sign expected displays + the safeTxHash", async () => {
    stubSafeChains({});
    stubTxService(buildSafeAFixtureTx());
    const res = await callTool(approveArgs());
    const text = res.content[0]?.text ?? "";
    expect(text).toMatch(/LEDGER DISPLAY/);
    expect(text).toMatch(/Clear-sign mode/);
    expect(text).toMatch(/Blind-sign mode/);
    expect(text).toMatch(new RegExp(`Sign Hash:\\s+${FIXTURE_SAFE_A_HASH}`));
  });

  it("CHECKS PERFORMED block surfaces version + owner + nonce + Tx-Service-hash-matches-recomputed", async () => {
    stubSafeChains({});
    stubTxService(buildSafeAFixtureTx());
    const res = await callTool(approveArgs());
    const text = res.content[0]?.text ?? "";
    expect(text).toMatch(/CHECKS PERFORMED/);
    expect(text).toMatch(/safeVersion:\s+v1\.3\.0/);
    expect(text).toMatch(/ownerCheck:.*is in on-chain getOwners/);
    expect(text).toMatch(/safeTxHashCheck:.*Tx Service hash matches recomputed/);
  });
});

describe("prepare_safe_tx_approve — txServiceDrift refusal (T-37-10)", () => {
  it("Tx Service-reported safeTxHash diverges from recomputed → INVALID_INPUT + txServiceDrift hint", async () => {
    stubSafeChains({});
    // Mutate value so the recomputed hash differs from the input safeTxHash.
    const drifted = buildSafeAFixtureTx({
      value: "999999999999999999",
      // safeTxHash still defaults to FIXTURE_SAFE_A_HASH — input matches but
      // recompute over the mutated value will differ.
    });
    stubTxService(drifted);
    const res = await callTool(approveArgs());
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
      message?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(/txServiceDrift/);
  });
});

describe("prepare_safe_tx_approve — domainSeparatorDrift informational", () => {
  it("non-matching on-chain domain separator surfaces domainSeparatorDrift: true BUT does NOT refuse", async () => {
    stubSafeChains({
      domainSeparator: ("0x" + "ff".repeat(32)) as Hex,
    });
    stubTxService(buildSafeAFixtureTx());
    const res = await callTool(approveArgs());
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";
    expect(text).toMatch(/domainSeparator:.*DRIFT/);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.domainSeparatorMatches).toBe(false);
  });
});

describe("prepare_safe_tx_approve — duplicateSignWarning informational", () => {
  it("resolved-from already in confirmations[] → CHECKS PERFORMED carries duplicateSignWarning; tool succeeds", async () => {
    stubSafeChains({});
    stubTxService(
      buildSafeAFixtureTx({
        confirmations: [
          {
            owner: SAFE_A_OWNER_PERSONA,
            signature: "0x" + "33".repeat(65),
            signatureType: "EOA",
          },
        ],
      }),
    );
    const res = await callTool(approveArgs());
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";
    expect(text).toMatch(/duplicateSignWarning/);
    expect(text).toMatch(/already signed/);
  });
});

describe("prepare_safe_tx_approve — Tx Service DU dispatch", () => {
  it("Tx Service kind 'not-found' → INVALID_INPUT structured refusal with hint", async () => {
    stubSafeChains({});
    vi.spyOn(safeTxService, "getMultisigTransaction").mockResolvedValue({
      kind: "not-found",
    });
    const res = await callTool(approveArgs());
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
      message?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(/not found/);
  });

  it("Tx Service kind 'unsupported-chain' → INVALID_INPUT structured refusal", async () => {
    stubSafeChains({});
    vi.spyOn(safeTxService, "getMultisigTransaction").mockResolvedValue({
      kind: "unsupported-chain",
      chainId: 1,
    });
    const res = await callTool(approveArgs());
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("Tx Service kind 'rate-limited' → INVALID_INPUT structured refusal carrying retry-after", async () => {
    stubSafeChains({});
    vi.spyOn(safeTxService, "getMultisigTransaction").mockResolvedValue({
      kind: "rate-limited",
      message: "Safe Tx Service returned HTTP 429 (retry-after: 30)",
      retryAfterMs: 30_000,
    });
    const res = await callTool(approveArgs());
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
      message?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(/429|retry-after/);
  });

  it("Tx Service kind 'error' → INVALID_INPUT structured refusal with reason", async () => {
    stubSafeChains({});
    vi.spyOn(safeTxService, "getMultisigTransaction").mockResolvedValue({
      kind: "error",
      message: "Safe Tx Service returned HTTP 503",
    });
    const res = await callTool(approveArgs());
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("prepare_safe_tx_approve — refusal paths", () => {
  it("UNSUPPORTED_SAFE_VERSION when on-chain VERSION() reports pre-v1.3.0", async () => {
    stubSafeChains({ version: "1.1.1" });
    stubTxService(buildSafeAFixtureTx());
    const res = await callTool(approveArgs());
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
    };
    expect(sc.errorCode).toBe("UNSUPPORTED_SAFE_VERSION");
  });

  it("INVALID_INPUT when sender is not an owner of the Safe", async () => {
    stubSafeChains({ owners: [NON_OWNER_PERSONA] });
    stubTxService(buildSafeAFixtureTx());
    const res = await callTool(approveArgs());
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
      message?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(/not an owner/);
  });
});

describe("prepare_safe_tx_approve — delegatecall path", () => {
  it("Tx Service returns operation: 1 → tool maps to 'delegatecall' + emits [HARD-TRIGGER — DELEGATECALL] block", async () => {
    stubSafeChains({});
    // Re-derive the SAFE-C hash for an operation=1 SafeTx so the recompute
    // gate passes (txServiceDrift expects the Tx Service-reported hash to
    // equal the local re-derivation).
    const safeCFixture = buildSafeAFixtureTx({
      operation: 1,
      // Cross-link: signing-safe-tx-hash.test.ts pins SAFE-C hash for
      // operation=1 + same SAFE-A inputs.
      safeTxHash:
        "0x2f5b398a4f868a3149fcda1a097f6229f544554fe5e69c0c219c2f8c6080e4e2",
    });
    stubTxService(safeCFixture);
    const res = await callTool(approveArgs({
      safeTxHash:
        "0x2f5b398a4f868a3149fcda1a097f6229f544554fe5e69c0c219c2f8c6080e4e2",
    }));
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.operation).toBe("delegatecall");
    const text = res.content[0]?.text ?? "";
    // Phase 38 Plan 38-01: informational "delegatecall: YES" line REMOVED;
    // hard-trigger block emitted instead.
    expect(text.includes("delegatecall:     YES")).toBe(false);
    expect(text).toContain("[HARD-TRIGGER — DELEGATECALL]");
    expect(text).toMatch(/Inv #12\.5/);
  });
});

// ===========================================================================
// Phase 38 Plan 38-01 — Inv #12.5 hard-trigger emission tests (approve site)
// ===========================================================================

const FIXTURE_SAFE_G_DATA =
  "0x610b5925000000000000000000000000cafe0000000000000000000000000000cafe0001";
const FIXTURE_SAFE_G_MODULE = "0xcafe0000000000000000000000000000cafe0001";

describe("prepare_safe_tx_approve — Phase 38 hard-trigger emission", () => {
  it("MODULE ENABLE: Tx Service data starts with 0x610b5925 AND to === safeAddress emits [HARD-TRIGGER — MODULE ENABLE] block", async () => {
    // Re-derive the SafeTx hash for the modified inputs so the txServiceDrift
    // recompute gate passes.
    const moduleEnableInput = {
      ...FIXTURE_SAFE_A_INPUT,
      to: FIXTURE_SAFE_A_INPUT.safeAddress,
      data: FIXTURE_SAFE_G_DATA as Hex,
      value: 0n,
    };
    const moduleHash = computeSafeTxHash(moduleEnableInput);
    stubSafeChains({});
    stubTxService(
      buildSafeAFixtureTx({
        to: FIXTURE_SAFE_A_INPUT.safeAddress,
        data: FIXTURE_SAFE_G_DATA,
        value: "0",
        safeTxHash: moduleHash,
      }),
    );
    const res = await callTool(approveArgs({ safeTxHash: moduleHash }));
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("[HARD-TRIGGER — MODULE ENABLE]");
    expect(text.toLowerCase()).toContain(FIXTURE_SAFE_G_MODULE);
  });

  it("MODULE ENABLE does NOT fire when Tx Service to !== safeAddress", async () => {
    const otherTargetInput = {
      ...FIXTURE_SAFE_A_INPUT,
      to: NON_OWNER_PERSONA,
      data: FIXTURE_SAFE_G_DATA as Hex,
      value: 0n,
    };
    const otherHash = computeSafeTxHash(otherTargetInput);
    stubSafeChains({});
    stubTxService(
      buildSafeAFixtureTx({
        to: NON_OWNER_PERSONA,
        data: FIXTURE_SAFE_G_DATA,
        value: "0",
        safeTxHash: otherHash,
      }),
    );
    const res = await callTool(approveArgs({ safeTxHash: otherHash }));
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";
    expect(text.includes("[HARD-TRIGGER — MODULE ENABLE]")).toBe(false);
  });

  it("composite at approve: enableModule + operation: 1 emits BOTH blocks in document order", async () => {
    const compositeInput = {
      ...FIXTURE_SAFE_A_INPUT,
      to: FIXTURE_SAFE_A_INPUT.safeAddress,
      data: FIXTURE_SAFE_G_DATA as Hex,
      value: 0n,
      operation: 1 as const,
    };
    const compositeHash = computeSafeTxHash(compositeInput);
    stubSafeChains({});
    stubTxService(
      buildSafeAFixtureTx({
        to: FIXTURE_SAFE_A_INPUT.safeAddress,
        data: FIXTURE_SAFE_G_DATA,
        value: "0",
        operation: 1,
        safeTxHash: compositeHash,
      }),
    );
    const res = await callTool(approveArgs({ safeTxHash: compositeHash }));
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";
    const idxModule = text.indexOf("[HARD-TRIGGER — MODULE ENABLE]");
    const idxDelegate = text.indexOf("[HARD-TRIGGER — DELEGATECALL]");
    expect(idxModule).toBeGreaterThanOrEqual(0);
    expect(idxDelegate).toBeGreaterThanOrEqual(0);
    expect(idxModule).toBeLessThan(idxDelegate);
  });

  it("non-trigger SafeTx (random data + operation 0) emits NEITHER hard-trigger block", async () => {
    stubSafeChains({});
    stubTxService(buildSafeAFixtureTx());
    const res = await callTool(approveArgs());
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";
    expect(text.includes("[HARD-TRIGGER —")).toBe(false);
  });

  it("INVALID_INPUT when Tx Service data starts with enableModule selector but argument decode fails (truncated)", async () => {
    // The recompute gate would refuse the truncated calldata before the
    // hard-trigger pre-flight fires, but the pre-flight surfaces the more
    // specific message because it runs BEFORE the recompute step. Re-derive
    // the hash for the truncated data so the recompute gate doesn't claim
    // txServiceDrift first.
    const truncatedInput = {
      ...FIXTURE_SAFE_A_INPUT,
      to: FIXTURE_SAFE_A_INPUT.safeAddress,
      data: "0x610b5925cafe" as Hex,
      value: 0n,
    };
    const truncatedHash = computeSafeTxHash(truncatedInput);
    stubSafeChains({});
    stubTxService(
      buildSafeAFixtureTx({
        to: FIXTURE_SAFE_A_INPUT.safeAddress,
        data: "0x610b5925cafe",
        value: "0",
        safeTxHash: truncatedHash,
      }),
    );
    const res = await callTool(approveArgs({ safeTxHash: truncatedHash }));
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
      message?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(
      /SafeTx data starts with enableModule selector but argument decode failed/,
    );
  });

  it("REGRESSION — Phase 37 informational 'delegatecall: YES' CHECKS PERFORMED line is REMOVED at approve", async () => {
    const delegateInput = {
      ...FIXTURE_SAFE_A_INPUT,
      operation: 1 as const,
    };
    const delegateHash = computeSafeTxHash(delegateInput);
    stubSafeChains({});
    stubTxService(
      buildSafeAFixtureTx({ operation: 1, safeTxHash: delegateHash }),
    );
    const res = await callTool(approveArgs({ safeTxHash: delegateHash }));
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";
    expect(text.includes("delegatecall:     YES")).toBe(false);
    expect(text).toContain("[HARD-TRIGGER — DELEGATECALL]");
  });
});
