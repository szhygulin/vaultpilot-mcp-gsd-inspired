// prepare_safe_tx_propose unit tests — Phase 37 Plan 37-01 (SAFE-05).
//
// Anchors:
//   - Happy path: returns { handle, safeTxHash, typedDataStructure,
//     payloadFingerprint, domainSeparatorMatches } in structuredContent;
//     PREPARE RECEIPT + CHECKS PERFORMED + LEDGER DISPLAY in content.
//   - Cross-link to Fixture SAFE-A: structuredContent.safeTxHash ===
//     FIXTURE_SAFE_A_HASH when invoked with the SAFE-A inputs.
//   - Cross-link to Fixture SAFE-D: structuredContent.payloadFingerprint ===
//     FIXTURE_SAFE_D_FP. These are the regression anchors that fail at a
//     SPECIFIC line if Task 1's EIP-712 encoder or fingerprint preimage drift
//     in a future phase.
//   - Refusal paths:
//       UNSUPPORTED_SAFE_VERSION (on-chain VERSION() reports pre-v1.3.0)
//       WALLET_NOT_PAIRED (no live WC session)
//       INVALID_INPUT (sender not in on-chain getOwners())
//       INVALID_INPUT (malformed operation / malformed value / etc.)
//   - delegatecall path surfaces the Phase-38-hard-trigger informational note
//     in CHECKS PERFORMED.

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
      throw new Error("pair should not be called from prepare_safe_tx_propose tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

import { _safeChains } from "../src/chains/safe.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  type PreparedTxSafeTypedData,
} from "../src/signing/handle-store.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
} from "../src/demo/state.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import {
  FIXTURE_SAFE_A_HASH,
  FIXTURE_SAFE_A_INPUT,
} from "./signing-safe-tx-hash.test.js";
import { FIXTURE_SAFE_D_FP } from "./signing-fingerprint.test.js";

await import("../src/tools/register-all.js");

// FIXTURE_SAFE_A_INPUT uses safeAddress = 0x1234… (lowercase) — viem.getAddress
// produces the EIP-55 checksummed form which we use as PRIMARY_ADDRESS-style
// constant for spy + status setup.
const SAFE_A_OWNER_PERSONA: Address =
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Anvil acct 1
const NON_OWNER_PERSONA: Address =
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; // Anvil acct 2

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
  // Placeholder — the prepare tool surfaces a domainSeparatorDrift warning if
  // this on-chain value doesn't match the local viem.hashDomain output. Tests
  // pin this to the EXPECTED value so the happy path's checksums pass cleanly.
  "0xPLACEHOLDER_DOMAIN" as Hex;

async function callTool(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_safe_tx_propose");
  if (!tool) throw new Error("prepare_safe_tx_propose not registered");
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

// Helper: build a SAFE-A-style invocation. Inputs match FIXTURE_SAFE_A_INPUT
// so structuredContent.safeTxHash === FIXTURE_SAFE_A_HASH.
function safeAArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chain: "ethereum",
    safeAddress: FIXTURE_SAFE_A_INPUT.safeAddress,
    to: FIXTURE_SAFE_A_INPUT.to,
    value: FIXTURE_SAFE_A_INPUT.value.toString(),
    data: FIXTURE_SAFE_A_INPUT.data,
    operation: "call",
    ...overrides,
  };
}

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

describe("prepare_safe_tx_propose — happy path + Fixture SAFE-A/D cross-link", () => {
  it("returns structuredContent with handle + safeTxHash + typedDataStructure + payloadFingerprint", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs());
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toBeDefined();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc).toHaveProperty("handle");
    expect(sc).toHaveProperty("safeTxHash");
    expect(sc).toHaveProperty("typedDataStructure");
    expect(sc).toHaveProperty("payloadFingerprint");
    expect(sc).toHaveProperty("safeVersion", "1.3.0");
    expect(sc).toHaveProperty("operation", "call");
  });

  it("Cross-link Fixture SAFE-A — structuredContent.safeTxHash === FIXTURE_SAFE_A_HASH (regression anchor)", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs());
    const sc = res.structuredContent as Record<string, unknown>;
    // This is the regression anchor that fails at this specific line if
    // Task 1's safe-tx-hash.ts EIP-712 encoder drifts.
    expect(sc.safeTxHash).toBe(FIXTURE_SAFE_A_HASH);
  });

  it("Cross-link Fixture SAFE-D — structuredContent.payloadFingerprint === FIXTURE_SAFE_D_FP (regression anchor)", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs());
    const sc = res.structuredContent as Record<string, unknown>;
    // This is the regression anchor that fails at this specific line if
    // Task 1's payload-fingerprint.ts preimage assembly drifts.
    expect(sc.payloadFingerprint).toBe(FIXTURE_SAFE_D_FP);
  });

  it("Handle round-trip — _peekHandleForTesting recovers a PreparedTxSafeTypedData record", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs());
    const sc = res.structuredContent as Record<string, unknown>;
    const handle = sc.handle as string;
    const record = _peekHandleForTesting(handle);
    expect(record).toBeDefined();
    expect(record?.tx.txType).toBe("safe-typed-data");
    const tx = record!.tx as PreparedTxSafeTypedData;
    expect(tx.safeTxHash).toBe(FIXTURE_SAFE_A_HASH);
    expect(tx.safeAddress).toBe(FIXTURE_SAFE_A_INPUT.safeAddress);
    expect(tx.operation).toBe("call");
  });

  it("PREPARE RECEIPT block carries verbatim agent args", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs());
    const text = res.content[0]?.text ?? "";
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(/safe:\s+0x1234567890123456789012345678901234567890/);
    expect(text).toMatch(/safeOperation:\s+call/);
    expect(text).toMatch(/value:\s+1000000000000000000/);
    expect(text).toMatch(/data:\s+0x/);
  });

  it("CHECKS PERFORMED block surfaces version + owner + nonce + domainSeparator", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs());
    const text = res.content[0]?.text ?? "";
    expect(text).toMatch(/CHECKS PERFORMED/);
    expect(text).toMatch(/safeVersion:\s+v1\.3\.0/);
    expect(text).toMatch(/ownerCheck:.*is in on-chain getOwners/);
    expect(text).toMatch(/onchainNonce:\s+42/);
    expect(text).toMatch(/onchainThreshold:\s+1/);
    expect(text).toMatch(/domainSeparator:/);
  });

  it("LEDGER DISPLAY block surfaces both clear-sign + blind-sign expected displays", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs());
    const text = res.content[0]?.text ?? "";
    expect(text).toMatch(/LEDGER DISPLAY/);
    expect(text).toMatch(/Clear-sign mode/);
    expect(text).toMatch(/Blind-sign mode/);
    expect(text).toMatch(/Sign Hash:\s+0x/);
  });

  it("delegatecall path emits the [HARD-TRIGGER — DELEGATECALL] block (Phase 38 promotion of the Phase-37 informational note)", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs({ operation: "delegatecall" }));
    const text = res.content[0]?.text ?? "";
    // Phase 38 Plan 38-01: informational "delegatecall: YES" line REMOVED;
    // hard-trigger block emitted instead. Regression assert: the Phase-37
    // informational line is GONE.
    expect(text.includes("delegatecall:     YES")).toBe(false);
    expect(text).toContain("[HARD-TRIGGER — DELEGATECALL]");
    expect(text).toMatch(/Inv #12\.5/);
    expect(text).toMatch(/get_verification_artifact/);
    // The delegatecall path also produces a DIFFERENT safeTxHash (operation
    // byte is part of the SafeTx EIP-712 struct hash).
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.safeTxHash).not.toBe(FIXTURE_SAFE_A_HASH);
    expect(sc.operation).toBe("delegatecall");
  });

  it("v1.4.1 Safe is accepted — version refusal triggers ONLY for pre-v1.3.0", async () => {
    stubSafeChains({ version: "1.4.1" });
    const res = await callTool(safeAArgs());
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.safeVersion).toBe("1.4.1");
  });
});

describe("prepare_safe_tx_propose — refusal paths", () => {
  it("UNSUPPORTED_SAFE_VERSION when on-chain VERSION() reports pre-v1.3.0", async () => {
    stubSafeChains({ version: "1.1.1" });
    const res = await callTool(safeAArgs());
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
    };
    expect(sc.errorCode).toBe("UNSUPPORTED_SAFE_VERSION");
    expect(sc.message).toMatch(/cross-chain replay risk/);
    expect(sc.message).toMatch(/1\.1\.1/);
  });

  it("UNSUPPORTED_SAFE_VERSION when on-chain VERSION() reports v1.0.0", async () => {
    stubSafeChains({ version: "1.0.0" });
    const res = await callTool(safeAArgs());
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
    };
    expect(sc.errorCode).toBe("UNSUPPORTED_SAFE_VERSION");
  });

  it("UNSUPPORTED_SAFE_VERSION when on-chain VERSION() reports v1.5.0 (future-version refusal)", async () => {
    // Phase 37 explicitly supports only "1.3.0" and "1.4.1". Future versions
    // (1.5.x, 1.6.x) should ALSO refuse — they may have different EIP-712
    // shapes that we have not verified.
    stubSafeChains({ version: "1.5.0" });
    const res = await callTool(safeAArgs());
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
    };
    expect(sc.errorCode).toBe("UNSUPPORTED_SAFE_VERSION");
  });

  it("WALLET_NOT_PAIRED when no live WC session", async () => {
    stubSafeChains({});
    getStatusSpy.mockResolvedValue(null);
    const res = await callTool(safeAArgs());
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
    };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });

  it("INVALID_INPUT when sender is not an owner of the Safe", async () => {
    // Stub owners to NOT include SAFE_A_OWNER_PERSONA (which is the default
    // status.activeAccount). The handler should refuse.
    stubSafeChains({ owners: [NON_OWNER_PERSONA] });
    const res = await callTool(safeAArgs());
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
      message?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(/not an owner/);
  });

  it("INVALID_INPUT when operation is neither 'call' nor 'delegatecall'", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs({ operation: "DELEGATECALL" }));
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("INVALID_INPUT when value is not a non-negative decimal string", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs({ value: "-100" }));
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("INVALID_INPUT when safeAddress is malformed", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs({ safeAddress: "0xdeadbeef" }));
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown> & {
      errorCode?: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("prepare_safe_tx_propose — gas-relay quintet", () => {
  it("defaults all 5 gas-relay fields to zero when omitted (Safe v1.3.0+ non-relayed convention)", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs());
    const sc = res.structuredContent as Record<string, unknown>;
    const handle = sc.handle as string;
    const record = _peekHandleForTesting(handle);
    const tx = record!.tx as PreparedTxSafeTypedData;
    expect(tx.safeTxGas).toBe(0n);
    expect(tx.baseGas).toBe(0n);
    expect(tx.gasPrice).toBe(0n);
    expect(tx.gasToken).toBe("0x0000000000000000000000000000000000000000");
    expect(tx.refundReceiver).toBe("0x0000000000000000000000000000000000000000");
  });

  it("surfaces a WARN in CHECKS PERFORMED when any gas-relay field is non-zero", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs({ safeTxGas: "21000" }));
    const text = res.content[0]?.text ?? "";
    expect(text).toMatch(/WARN gas-relay:/);
    expect(text).toMatch(/non-zero/);
  });

  it("non-zero gas-relay fields flow into the SafeTx EIP-712 hash (drift produces a different safeTxHash)", async () => {
    stubSafeChains({});
    const resBase = await callTool(safeAArgs());
    const resGas = await callTool(safeAArgs({ safeTxGas: "21000" }));
    const scBase = resBase.structuredContent as Record<string, unknown>;
    const scGas = resGas.structuredContent as Record<string, unknown>;
    expect(scBase.safeTxHash).not.toBe(scGas.safeTxHash);
  });
});

// ===========================================================================
// Phase 38 Plan 38-01 — Inv #12.5 hard-trigger emission tests
// ===========================================================================

// Fixture SAFE-G calldata — selector + zero-padded module address. Cross-link
// to test/protocols-safe.test.ts FIXTURE_SAFE_G_CALLDATA.
const FIXTURE_SAFE_G_DATA =
  "0x610b5925000000000000000000000000cafe0000000000000000000000000000cafe0001";
const FIXTURE_SAFE_G_MODULE = "0xcafe0000000000000000000000000000cafe0001";

describe("prepare_safe_tx_propose — Phase 38 hard-trigger emission", () => {
  it("MODULE ENABLE: data starts with 0x610b5925 AND to === safeAddress emits [HARD-TRIGGER — MODULE ENABLE] block", async () => {
    stubSafeChains({});
    const res = await callTool(
      safeAArgs({
        to: FIXTURE_SAFE_A_INPUT.safeAddress,
        data: FIXTURE_SAFE_G_DATA,
      }),
    );
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("[HARD-TRIGGER — MODULE ENABLE]");
    expect(text.toLowerCase()).toContain(FIXTURE_SAFE_G_MODULE);
    // Handle UUID substituted into the block.
    const sc = res.structuredContent as Record<string, unknown>;
    expect(text).toContain(sc.handle as string);
  });

  it("MODULE ENABLE does NOT fire when to !== safeAddress (only safe-on-self triggers)", async () => {
    stubSafeChains({});
    // Different target — Anvil acct 2, which is NOT the safeAddress.
    const res = await callTool(
      safeAArgs({
        to: NON_OWNER_PERSONA,
        data: FIXTURE_SAFE_G_DATA,
      }),
    );
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";
    expect(text.includes("[HARD-TRIGGER — MODULE ENABLE]")).toBe(false);
  });

  it("composite: enableModule selector + delegatecall emits BOTH blocks in document order (MODULE ENABLE before DELEGATECALL)", async () => {
    stubSafeChains({});
    const res = await callTool(
      safeAArgs({
        to: FIXTURE_SAFE_A_INPUT.safeAddress,
        data: FIXTURE_SAFE_G_DATA,
        operation: "delegatecall",
      }),
    );
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";
    const idxModule = text.indexOf("[HARD-TRIGGER — MODULE ENABLE]");
    const idxDelegate = text.indexOf("[HARD-TRIGGER — DELEGATECALL]");
    expect(idxModule).toBeGreaterThanOrEqual(0);
    expect(idxDelegate).toBeGreaterThanOrEqual(0);
    expect(idxModule).toBeLessThan(idxDelegate);
  });

  it("non-trigger SafeTx (random calldata + call) emits NEITHER hard-trigger block", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs({ data: "0xdeadbeef" }));
    expect(res.isError).toBeFalsy();
    const text = res.content[0]?.text ?? "";
    expect(text.includes("[HARD-TRIGGER —")).toBe(false);
  });

  it("INVALID_INPUT when enableModule selector matches but argument decode fails (truncated calldata)", async () => {
    stubSafeChains({});
    const res = await callTool(
      safeAArgs({
        to: FIXTURE_SAFE_A_INPUT.safeAddress,
        data: "0x610b5925cafe", // selector match but truncated args
      }),
    );
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

  it("REGRESSION — Phase 37 informational 'delegatecall: YES' CHECKS PERFORMED line is REMOVED", async () => {
    stubSafeChains({});
    const res = await callTool(safeAArgs({ operation: "delegatecall" }));
    const text = res.content[0]?.text ?? "";
    // Bracketed-block emission survives; inline informational line does not.
    expect(text.includes("delegatecall:     YES")).toBe(false);
    expect(text).toContain("[HARD-TRIGGER — DELEGATECALL]");
  });
});
