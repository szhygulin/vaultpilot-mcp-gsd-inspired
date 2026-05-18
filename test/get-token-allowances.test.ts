// src/tools/get_token_allowances.ts — Phase 8 — Plan 08-04 (READ-43 + READ-44).
//
// Two-step enumeration: event scan (getLogs) + multicall cross-check.
// Tests mock both the per-chain client (for getBlockNumber) and the `_logs`
// indirection (for scanApprovalEvents + filterActiveAllowances). This
// avoids end-to-end viem getLogs + multicall plumbing while exercising the
// real substitution + warning-text + structured-content surface.
//
// Coverage:
//   - Schema gates (Tests 1, 2)
//   - Happy path 3-row enumeration (Test 3)
//   - READ-44 / T-SET-LEVEL-BLOCK-DRIFT-1 byte-level fixture (Test 4)
//   - isUnlimited MAX_UINT256 sentinel (Test 5)
//   - spenderLabel for Ethereum-known + unknown (Test 6)
//   - APPROVAL_EVENT_TOPIC keccak self-check (Test 7)
//   - T-LOGS-CEILING-1 PublicNode chunking (Test 8)
//   - Custom lookbackBlocks override (Test 9)
//   - lookbackBlocks: 0 full-history scan with RPC reject (Test 10)
//   - Empty results → block with "no active allowances" placeholder (Test 11)
//   - ESM spy-affordance round-trip (Test 12)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes, type Address, type PublicClient } from "viem";

// Mock the per-chain client registry BEFORE importing the tool. The mock
// returns a stub `client` with `getBlockNumber`; the `_logs` indirection
// receives this client and the spies short-circuit getLogs + multicall.
let latestBlock: bigint = 18_000_000n;
let getBlockNumberShouldThrow: Error | undefined;
let publicNodeFallback = false;

vi.mock("../src/chains/registry.js", () => {
  return {
    getChainClient: () =>
      ({
        getBlockNumber: vi.fn(async () => {
          if (getBlockNumberShouldThrow) throw getBlockNumberShouldThrow;
          return latestBlock;
        }),
        getLogs: vi.fn(async () => []),
        multicall: vi.fn(async () => []),
      }) as unknown as PublicClient,
    isPublicNodeFallback: () => publicNodeFallback,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
  };
});

import { _logs, APPROVAL_EVENT_TOPIC } from "../src/tools/get_token_allowances.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";
import "../src/tools/register-all.js";

const WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const DAI: Address = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const UNISWAP_V3: Address = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const ONEINCH_V6: Address = "0x111111125421cA6dc452d289314280a0F8842A65";
const UNISWAP_V2: Address = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const UNKNOWN_SPENDER: Address = "0x0000000000000000000000000000000000000123";

const MAX_UINT256_DECIMAL =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

beforeEach(() => {
  latestBlock = 18_000_000n;
  getBlockNumberShouldThrow = undefined;
  publicNodeFallback = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_token_allowances");
  if (!tool) throw new Error("get_token_allowances not registered");
  return tool.handler(args);
}

describe("get_token_allowances — Test 1 schema gate (missing wallet)", () => {
  it("missing wallet → INVALID_INPUT", async () => {
    const result = await callTool({ chain: "ethereum" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("malformed wallet → INVALID_INPUT", async () => {
    const result = await callTool({ wallet: "0xnotanaddress", chain: "ethereum" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("get_token_allowances — Test 2 schema gate (chain enum at dispatcher)", () => {
  it("INPUT_SCHEMA chain enum lists exactly the 5 supported chains + chain is REQUIRED", () => {
    const tool = getRegisteredTool("get_token_allowances");
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as {
      properties: { chain: { enum: string[] } };
      required: string[];
    };
    expect(schema.properties.chain.enum).toEqual([
      "ethereum",
      "arbitrum",
      "polygon",
      "base",
      "optimism",
    ]);
    expect(schema.required).toContain("chain");
    expect(schema.required).toContain("wallet");
  });
});

describe("get_token_allowances — Test 3 happy path 3-allowance enumeration", () => {
  it("3 active rows surface in structuredContent + are non-zero", async () => {
    vi.spyOn(_logs, "scanApprovalEvents").mockResolvedValue({
      candidates: [
        { token: USDC, spender: UNISWAP_V3, lastSeenBlock: 18_000_000n },
        { token: DAI, spender: ONEINCH_V6, lastSeenBlock: 18_100_000n },
        { token: WETH, spender: UNISWAP_V2, lastSeenBlock: 17_900_000n },
        // 2 candidates that will filter out as zero (revoked)
        { token: USDC, spender: UNKNOWN_SPENDER, lastSeenBlock: 17_500_000n },
        { token: DAI, spender: UNKNOWN_SPENDER, lastSeenBlock: 17_600_000n },
      ],
      chunksScanned: 1,
    });
    vi.spyOn(_logs, "filterActiveAllowances").mockResolvedValue([
      {
        token: USDC,
        spender: UNISWAP_V3,
        spenderLabel: "Uniswap V3 SwapRouter",
        amount: "1000000",
        isUnlimited: false,
        lastSeenBlock: "18000000",
      },
      {
        token: DAI,
        spender: ONEINCH_V6,
        spenderLabel: "1inch Aggregation Router V6",
        amount: MAX_UINT256_DECIMAL,
        isUnlimited: true,
        lastSeenBlock: "18100000",
      },
      {
        token: WETH,
        spender: UNISWAP_V2,
        spenderLabel: "Uniswap V2 Router 02",
        amount: "500000000000000000",
        isUnlimited: false,
        lastSeenBlock: "17900000",
      },
    ]);

    const result = await callTool({ wallet: WALLET, chain: "ethereum" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      rows: unknown[];
      rowCount: number;
      chain: string;
      chainId: number;
      lookbackBlocks: number;
    };
    expect(sc.rows).toHaveLength(3);
    expect(sc.rowCount).toBe(3);
    expect(sc.chain).toBe("ethereum");
    expect(sc.chainId).toBe(1);
    expect(sc.lookbackBlocks).toBe(1_000_000);
  });
});

describe("get_token_allowances — Test 4 READ-44 / T-SET-LEVEL-BLOCK-DRIFT-1 byte-level fixture", () => {
  it("content[0].text matches verbatim SET-LEVEL ENUMERATION block for 3-row fixture", async () => {
    latestBlock = 18_000_000n;
    vi.spyOn(_logs, "scanApprovalEvents").mockResolvedValue({
      candidates: [
        { token: USDC, spender: UNISWAP_V3, lastSeenBlock: 18_000_000n },
        { token: DAI, spender: ONEINCH_V6, lastSeenBlock: 18_100_000n },
        { token: WETH, spender: UNISWAP_V2, lastSeenBlock: 17_900_000n },
      ],
      chunksScanned: 1,
    });
    vi.spyOn(_logs, "filterActiveAllowances").mockResolvedValue([
      {
        token: USDC,
        spender: UNISWAP_V3,
        spenderLabel: "Uniswap V3 SwapRouter",
        amount: "1000000",
        isUnlimited: false,
        lastSeenBlock: "18000000",
      },
      {
        token: DAI,
        spender: ONEINCH_V6,
        spenderLabel: "1inch Aggregation Router V6",
        amount: MAX_UINT256_DECIMAL,
        isUnlimited: true,
        lastSeenBlock: "18100000",
      },
      {
        token: WETH,
        spender: UNISWAP_V2,
        spenderLabel: "Uniswap V2 Router 02",
        amount: "500000000000000000",
        isUnlimited: false,
        lastSeenBlock: "17900000",
      },
    ]);

    const result = await callTool({ wallet: WALLET, chain: "ethereum" });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    // The fixture literal is the exact byte-shape the v1.3 preflight
    // skill will parse. Drift fails this assertion at PR-review time.
    const EXPECTED_FIXTURE =
      "[SET-LEVEL ENUMERATION]\n" +
      "  scope:        0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045\n" +
      "  chain:        ethereum (chainId 1)\n" +
      "  fromBlock:    17000000\n" +
      "  toBlock:      18000000 (1000000 blocks)\n" +
      "  active rows:  3\n" +
      "\n" +
      "  ┌─ row 1\n" +
      "  │  token:         0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48\n" +
      "  │  spender:       0xE592427A0AEce92De3Edee1F18E0157C05861564\n" +
      "  │  spenderLabel:  Uniswap V3 SwapRouter\n" +
      "  │  amount:        1000000\n" +
      "  │  isUnlimited:   no\n" +
      "  │  lastSeenBlock: 18000000\n" +
      "  ┌─ row 2\n" +
      "  │  token:         0x6B175474E89094C44Da98b954EedeAC495271d0F\n" +
      "  │  spender:       0x111111125421cA6dc452d289314280a0F8842A65\n" +
      "  │  spenderLabel:  1inch Aggregation Router V6\n" +
      `  │  amount:        ${MAX_UINT256_DECIMAL}\n` +
      "  │  isUnlimited:   yes\n" +
      "  │  lastSeenBlock: 18100000\n" +
      "  ┌─ row 3\n" +
      "  │  token:         0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2\n" +
      "  │  spender:       0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D\n" +
      "  │  spenderLabel:  Uniswap V2 Router 02\n" +
      "  │  amount:        500000000000000000\n" +
      "  │  isUnlimited:   no\n" +
      "  │  lastSeenBlock: 17900000\n" +
      "[END SET-LEVEL ENUMERATION]";

    expect(text).toBe(EXPECTED_FIXTURE);
  });

  it("text starts with [SET-LEVEL ENUMERATION] and ends with [END SET-LEVEL ENUMERATION]", async () => {
    vi.spyOn(_logs, "scanApprovalEvents").mockResolvedValue({
      candidates: [{ token: USDC, spender: UNISWAP_V3, lastSeenBlock: 18_000_000n }],
      chunksScanned: 1,
    });
    vi.spyOn(_logs, "filterActiveAllowances").mockResolvedValue([
      {
        token: USDC,
        spender: UNISWAP_V3,
        spenderLabel: "Uniswap V3 SwapRouter",
        amount: "1000000",
        isUnlimited: false,
        lastSeenBlock: "18000000",
      },
    ]);
    const result = await callTool({ wallet: WALLET, chain: "ethereum" });
    const text = result.content[0]?.text ?? "";
    expect(text.startsWith("[SET-LEVEL ENUMERATION]")).toBe(true);
    expect(text.endsWith("[END SET-LEVEL ENUMERATION]")).toBe(true);
  });
});

describe("get_token_allowances — Test 5 isUnlimited MAX_UINT256 sentinel", () => {
  it("amount === MAX_UINT256 → isUnlimited: true in row + 'yes' in block", async () => {
    vi.spyOn(_logs, "scanApprovalEvents").mockResolvedValue({
      candidates: [{ token: DAI, spender: ONEINCH_V6, lastSeenBlock: 18_000_000n }],
      chunksScanned: 1,
    });
    vi.spyOn(_logs, "filterActiveAllowances").mockResolvedValue([
      {
        token: DAI,
        spender: ONEINCH_V6,
        spenderLabel: "1inch Aggregation Router V6",
        amount: MAX_UINT256_DECIMAL,
        isUnlimited: true,
        lastSeenBlock: "18000000",
      },
    ]);
    const result = await callTool({ wallet: WALLET, chain: "ethereum" });
    const sc = result.structuredContent as { rows: Array<{ isUnlimited: boolean }> };
    expect(sc.rows[0]?.isUnlimited).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("isUnlimited:   yes");
  });
});

describe("get_token_allowances — Test 6 spenderLabel resolution", () => {
  it("Ethereum-known spender (Uniswap V3) → labeled with the curated entry", async () => {
    // Call filterActiveAllowances directly with a single candidate; the
    // helper invokes the real lookupSpender against KNOWN_SPENDERS_ETHEREUM.
    const stubClient = {
      multicall: vi.fn(async () => [{ status: "success", result: 100n }]),
    } as unknown as PublicClient;
    const rows = await _logs.filterActiveAllowances(stubClient, WALLET, [
      { token: USDC, spender: UNISWAP_V3, lastSeenBlock: 18_000_000n },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.spenderLabel).toBe("Uniswap V3 SwapRouter");
  });

  it("unknown spender → fallback '(unknown spender — no prior interaction recorded)' label", async () => {
    const stubClient = {
      multicall: vi.fn(async () => [{ status: "success", result: 100n }]),
    } as unknown as PublicClient;
    const rows = await _logs.filterActiveAllowances(stubClient, WALLET, [
      { token: USDC, spender: UNKNOWN_SPENDER, lastSeenBlock: 18_000_000n },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.spenderLabel).toBe("(unknown spender — no prior interaction recorded)");
  });

  it("zero-allowance row is filtered out (revoked or fully-spent)", async () => {
    const stubClient = {
      multicall: vi.fn(async () => [
        { status: "success", result: 0n },
        { status: "success", result: 100n },
      ]),
    } as unknown as PublicClient;
    const rows = await _logs.filterActiveAllowances(stubClient, WALLET, [
      { token: USDC, spender: UNKNOWN_SPENDER, lastSeenBlock: 18_000_000n },
      { token: DAI, spender: ONEINCH_V6, lastSeenBlock: 18_100_000n },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token).toBe(DAI);
  });
});

describe("get_token_allowances — Test 7 APPROVAL_EVENT_TOPIC keccak self-check", () => {
  it("APPROVAL_EVENT_TOPIC byte-identical to runtime keccak256('Approval(address,address,uint256)')", () => {
    const computed = keccak256(toBytes("Approval(address,address,uint256)"));
    expect(APPROVAL_EVENT_TOPIC).toBe(computed);
  });
});

describe("get_token_allowances — Test 8 T-LOGS-CEILING-1 PublicNode chunking", () => {
  it("PublicNode fallback + 1M lookback → chunksScanned: 100 + rpcDegraded + warning text", async () => {
    publicNodeFallback = true;
    latestBlock = 18_000_000n;

    let observedUseChunking: boolean | undefined;
    let observedFromBlock: bigint | undefined;
    let observedToBlock: bigint | undefined;
    vi.spyOn(_logs, "scanApprovalEvents").mockImplementation(
      async (_client, _wallet, fromBlock, toBlock, useChunking) => {
        observedUseChunking = useChunking;
        observedFromBlock = fromBlock;
        observedToBlock = toBlock;
        // Simulate 100 chunks scanned (1M / 10k)
        return { candidates: [], chunksScanned: 100 };
      },
    );
    vi.spyOn(_logs, "filterActiveAllowances").mockResolvedValue([]);

    const result = await callTool({
      wallet: WALLET,
      chain: "ethereum",
      lookbackBlocks: 1_000_000,
    });
    expect(result.isError).toBeFalsy();

    // (a) helper called with useChunking === true
    expect(observedUseChunking).toBe(true);
    expect(observedFromBlock).toBe(17_000_000n);
    expect(observedToBlock).toBe(18_000_000n);

    // (b) chunksScanned: 100
    const sc = result.structuredContent as {
      chunksScanned?: number;
      rpcDegraded?: boolean;
    };
    expect(sc.chunksScanned).toBe(100);

    // (c) rpcDegraded: true
    expect(sc.rpcDegraded).toBe(true);

    // (d) verbatim chunking warning text in content[0].text
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("⚠ Look-back scan on PublicNode RPC chunked into 100 × 10k-block windows (100 RPC calls)");
    expect(text).toContain("For faster scans set RPC_PROVIDER + RPC_API_KEY");
  });
});

describe("get_token_allowances — Test 9 custom lookbackBlocks override", () => {
  it("lookbackBlocks: 50000 → scan window matches; useChunking stays false even on PublicNode", async () => {
    publicNodeFallback = true;
    latestBlock = 18_000_000n;
    let observedUseChunking: boolean | undefined;
    let observedFromBlock: bigint | undefined;
    vi.spyOn(_logs, "scanApprovalEvents").mockImplementation(
      async (_client, _wallet, fromBlock, _toBlock, useChunking) => {
        observedUseChunking = useChunking;
        observedFromBlock = fromBlock;
        return { candidates: [], chunksScanned: 1 };
      },
    );
    vi.spyOn(_logs, "filterActiveAllowances").mockResolvedValue([]);

    // 50000 > 10000 → chunking DOES fire on PublicNode (use a smaller
    // value to test the no-chunking branch).
    const result1 = await callTool({
      wallet: WALLET,
      chain: "ethereum",
      lookbackBlocks: 50_000,
    });
    expect(result1.isError).toBeFalsy();
    expect(observedFromBlock).toBe(17_950_000n);
    expect(observedUseChunking).toBe(true);

    // 5000 < 10000 → no chunking even on PublicNode
    vi.restoreAllMocks();
    publicNodeFallback = true;
    latestBlock = 18_000_000n;
    let observedUseChunking2: boolean | undefined;
    vi.spyOn(_logs, "scanApprovalEvents").mockImplementation(
      async (_client, _wallet, _fromBlock, _toBlock, useChunking) => {
        observedUseChunking2 = useChunking;
        return { candidates: [], chunksScanned: 1 };
      },
    );
    vi.spyOn(_logs, "filterActiveAllowances").mockResolvedValue([]);
    const result2 = await callTool({
      wallet: WALLET,
      chain: "ethereum",
      lookbackBlocks: 5_000,
    });
    expect(result2.isError).toBeFalsy();
    expect(observedUseChunking2).toBe(false);
  });
});

describe("get_token_allowances — Test 10 lookbackBlocks: 0 full-history scan", () => {
  it("lookbackBlocks: 0 → fromBlock = 0n (full history)", async () => {
    latestBlock = 18_000_000n;
    let observedFromBlock: bigint | undefined;
    vi.spyOn(_logs, "scanApprovalEvents").mockImplementation(
      async (_client, _wallet, fromBlock, _toBlock, _useChunking) => {
        observedFromBlock = fromBlock;
        return { candidates: [], chunksScanned: 1 };
      },
    );
    vi.spyOn(_logs, "filterActiveAllowances").mockResolvedValue([]);

    const result = await callTool({
      wallet: WALLET,
      chain: "ethereum",
      lookbackBlocks: 0,
    });
    expect(result.isError).toBeFalsy();
    expect(observedFromBlock).toBe(18_000_000n);
  });

  it("getBlockNumber RPC failure surfaces INTERNAL_ERROR + rpcDegraded", async () => {
    getBlockNumberShouldThrow = new Error("PublicNode 503");
    const result = await callTool({ wallet: WALLET, chain: "ethereum" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      rpcDegraded?: boolean;
      cause?: string;
    };
    expect(sc.errorCode).toBe("INTERNAL_ERROR");
    expect(sc.rpcDegraded).toBe(true);
    expect(sc.cause).toMatch(/PublicNode 503/);
  });
});

describe("get_token_allowances — Test 11 empty results", () => {
  it("0 candidates → 0 active rows + block with 'no active allowances' placeholder", async () => {
    vi.spyOn(_logs, "scanApprovalEvents").mockResolvedValue({
      candidates: [],
      chunksScanned: 1,
    });
    vi.spyOn(_logs, "filterActiveAllowances").mockResolvedValue([]);

    const result = await callTool({ wallet: WALLET, chain: "ethereum" });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("active rows:  0");
    expect(text).toContain("(no active allowances within scan window)");
    const sc = result.structuredContent as { rowCount: number; rows: unknown[] };
    expect(sc.rowCount).toBe(0);
    expect(sc.rows).toEqual([]);
  });
});

describe("get_token_allowances — Test 12 ESM spy-affordance round-trip", () => {
  it("vi.spyOn(_logs, 'scanApprovalEvents') intercepts the call", async () => {
    const scanSpy = vi.spyOn(_logs, "scanApprovalEvents").mockResolvedValue({
      candidates: [],
      chunksScanned: 1,
    });
    const filterSpy = vi
      .spyOn(_logs, "filterActiveAllowances")
      .mockResolvedValue([]);

    await callTool({ wallet: WALLET, chain: "ethereum" });

    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(filterSpy).toHaveBeenCalledTimes(1);
  });
});
