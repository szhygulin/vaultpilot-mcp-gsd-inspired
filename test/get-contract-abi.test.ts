// Phase 35 Plan 35-01 Task 2 — get_contract_abi tool tests (CUSTOM-02).
//
// 4-arm DU coverage (ok | not-verified | rate-limited | error) across the
// 5 supported chains. Mirrors test/check-contract-security.test.ts shape —
// stub `fetch` at the network boundary (per CLAUDE.md, ESM named-export
// bindings are immutable so we cannot vi.spyOn fetchEtherscanAbi directly).
//
// Verified coverage:
//   - Test 1-5: happy path on each of the 5 chains; sourceCodeUrl matches
//     per-chain explorer.
//   - Test 6: not-verified arm passes through verbatim.
//   - Test 7: rate-limited → INTERNAL_ERROR cause "rate-limit".
//   - Test 8: HTTP 5xx → INTERNAL_ERROR cause "etherscan-unreachable".
//   - Test 9: ETHERSCAN_API_KEY missing → INTERNAL_ERROR with signup URL.
//   - Test 10: schema gate (malformed address) → INVALID_INPUT.
//   - Test 11: register-all wiring (getRegisteredTool returns the tool).
//   - Test 12: ABI cache persistence — second call hits the cache without
//     a new fetch (proves the cache populated by get_contract_abi survives
//     across calls).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";

import {
  _resetEtherscanAbiCacheForTesting,
  _resetEtherscanRateCounterForTesting,
} from "../src/clients/etherscan.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

// Side-effect register the tool.
await import("../src/tools/get_contract_abi.js");

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

interface AbiFetchOpts {
  ok?: boolean;
  status?: number;
  abiPayload?: unknown;
}

function buildAbiFetch(opts: AbiFetchOpts): ReturnType<typeof vi.fn> {
  return vi.fn(async (_input: unknown) => {
    return {
      ok: opts.ok ?? true,
      status: opts.status,
      json: async () => opts.abiPayload,
    } satisfies MockResponse;
  });
}

const KEY_ENV = "ETHERSCAN_API_KEY";
let savedKey: string | undefined;

const VERIFIED_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const ABI_JSON = JSON.stringify([
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
]);

function okPayload(): unknown {
  return { status: "1", message: "OK", result: ABI_JSON };
}

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_contract_abi");
  if (!tool) throw new Error("get_contract_abi not registered");
  return tool.handler(args);
}

beforeEach(() => {
  savedKey = process.env[KEY_ENV];
  process.env[KEY_ENV] = "test-api-key";
  _resetEtherscanAbiCacheForTesting();
  _resetEtherscanRateCounterForTesting();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = savedKey;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  _resetEtherscanAbiCacheForTesting();
  _resetEtherscanRateCounterForTesting();
});

// ---------------------------------------------------------------------------
// Tests 1-5 — happy path on each of the 5 supported chains.
// ---------------------------------------------------------------------------
const CHAIN_TABLE: Array<{
  chain: string;
  chainId: number;
  domain: string;
  testNum: number;
}> = [
  { chain: "ethereum", chainId: 1, domain: "etherscan.io", testNum: 1 },
  { chain: "arbitrum", chainId: 42161, domain: "arbiscan.io", testNum: 2 },
  { chain: "polygon", chainId: 137, domain: "polygonscan.com", testNum: 3 },
  { chain: "base", chainId: 8453, domain: "basescan.org", testNum: 4 },
  { chain: "optimism", chainId: 10, domain: "optimistic.etherscan.io", testNum: 5 },
];

for (const { chain, chainId, domain, testNum } of CHAIN_TABLE) {
  describe(`get_contract_abi — happy path on ${chain} (Test ${testNum})`, () => {
    it(`returns verified: true with parsed ABI + per-chain sourceCodeUrl`, async () => {
      const fetchMock = buildAbiFetch({ abiPayload: okPayload() });
      vi.stubGlobal("fetch", fetchMock);

      const result = await callTool({ chain, address: VERIFIED_ADDRESS });

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as {
        chain: string;
        chainId: number;
        address: string;
        verified: boolean;
        abi: unknown[];
        sourceCodeUrl: string;
      };
      expect(sc.chain).toBe(chain);
      expect(sc.chainId).toBe(chainId);
      expect(sc.address).toBe(VERIFIED_ADDRESS);
      expect(sc.verified).toBe(true);
      expect(Array.isArray(sc.abi)).toBe(true);
      expect(sc.abi.length).toBe(1);
      expect(sc.sourceCodeUrl).toBe(
        `https://${domain}/address/${VERIFIED_ADDRESS}#code`,
      );

      // URL carries the right chainid.
      const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
      expect(calledUrl).toContain(`chainid=${chainId}`);

      // Text content surfaces the source URL.
      const text = result.content[0]?.text ?? "";
      expect(text).toContain(`${VERIFIED_ADDRESS}: verified`);
      expect(text).toContain(sc.sourceCodeUrl);
    });
  });
}

// ---------------------------------------------------------------------------
// Test 6 — not-verified arm.
// ---------------------------------------------------------------------------
describe("get_contract_abi — not-verified arm (Test 6)", () => {
  it("surfaces verified: false + structured `not verified on Etherscan` text", async () => {
    const fetchMock = buildAbiFetch({
      abiPayload: {
        status: "0",
        message: "NOTOK",
        result: "Contract source code not verified",
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callTool({ chain: "ethereum", address: VERIFIED_ADDRESS });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      verified: boolean;
      abi?: unknown[];
      sourceCodeUrl?: string;
    };
    expect(sc.verified).toBe(false);
    expect(sc.abi).toBeUndefined();
    expect(sc.sourceCodeUrl).toBeUndefined();

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("NOT verified on Etherscan");
  });
});

// ---------------------------------------------------------------------------
// Test 7 — rate-limited arm.
// ---------------------------------------------------------------------------
describe("get_contract_abi — rate-limited arm (Test 7)", () => {
  it("6th uncached call returns INTERNAL_ERROR with cause 'rate-limit'", async () => {
    const fetchMock = buildAbiFetch({ abiPayload: okPayload() });
    vi.stubGlobal("fetch", fetchMock);

    // Burn the 5-call budget on distinct addresses.
    for (let i = 0; i < 5; i++) {
      const addr = `0x${i.toString(16).padStart(40, "0")}`;
      const r = await callTool({ chain: "ethereum", address: addr });
      expect(r.isError).toBeFalsy();
    }
    const result = await callTool({
      chain: "ethereum",
      address: "0x0000000000000000000000000000000000000099",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode?: string;
      cause?: string;
      message?: string;
    };
    expect(sc.errorCode).toBe("INTERNAL_ERROR");
    expect(sc.cause).toBe("rate-limit");
    expect(sc.message).toContain("per-session limit (5 calls) exceeded");
  });
});

// ---------------------------------------------------------------------------
// Test 8 — error arm: HTTP 5xx → INTERNAL_ERROR cause "etherscan-unreachable".
// ---------------------------------------------------------------------------
describe("get_contract_abi — error arm: HTTP 5xx (Test 8)", () => {
  it("Etherscan returns 503; tool returns INTERNAL_ERROR with cause 'etherscan-unreachable'", async () => {
    const fetchMock = buildAbiFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callTool({ chain: "ethereum", address: VERIFIED_ADDRESS });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode?: string;
      cause?: string;
      verified?: boolean;
    };
    expect(sc.errorCode).toBe("INTERNAL_ERROR");
    expect(sc.cause).toBe("etherscan-unreachable");
    // Critical: NOT a fake verified: false.
    expect(sc.verified).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 9 — ETHERSCAN_API_KEY missing → INTERNAL_ERROR with signup URL.
// ---------------------------------------------------------------------------
describe("get_contract_abi — missing API key (Test 9)", () => {
  it("ETHERSCAN_API_KEY unset → INTERNAL_ERROR with signup URL in cause", async () => {
    delete process.env[KEY_ENV];

    const result = await callTool({ chain: "ethereum", address: VERIFIED_ADDRESS });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode?: string;
      message?: string;
      cause?: string;
    };
    expect(sc.errorCode).toBe("INTERNAL_ERROR");
    expect(sc.message).toContain("ETHERSCAN_API_KEY not set");
    expect(sc.cause).toContain("https://etherscan.io/apis");
  });
});

// ---------------------------------------------------------------------------
// Test 10 — schema gate: malformed address → INVALID_INPUT.
// ---------------------------------------------------------------------------
describe("get_contract_abi — schema gate: malformed address (Test 10)", () => {
  it("non-40-hex 'address' returns INVALID_INPUT", async () => {
    const result = await callTool({ chain: "ethereum", address: "0xnotahex" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------
// Test 11 — register-all wiring.
// ---------------------------------------------------------------------------
describe("get_contract_abi — register-all wiring (Test 11)", () => {
  it("getRegisteredTool('get_contract_abi') is defined post-import", () => {
    const tool = getRegisteredTool("get_contract_abi");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("get_contract_abi");
    // Description names the routing context.
    expect(tool?.description).toMatch(/verified ABI/);
    expect(tool?.description).toMatch(/ETHERSCAN_API_KEY/);
    expect(tool?.description).toMatch(/Multi-chain/);
  });
});

// ---------------------------------------------------------------------------
// Test 12 — ABI cache persistence across calls.
// ---------------------------------------------------------------------------
describe("get_contract_abi — per-session ABI cache populated for downstream tools (Test 12)", () => {
  it("second call with same (chain, address) hits the cache without a new fetch", async () => {
    const fetchMock = buildAbiFetch({ abiPayload: okPayload() });
    vi.stubGlobal("fetch", fetchMock);

    const first = await callTool({ chain: "ethereum", address: VERIFIED_ADDRESS });
    const second = await callTool({ chain: "ethereum", address: VERIFIED_ADDRESS });

    expect(first.isError).toBeFalsy();
    expect(second.isError).toBeFalsy();

    // First call fired ONE fetch; the second call hit the cache and did
    // not fire a new fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Structured content matches across calls (parse-once memoization at
    // the client layer).
    expect(second.structuredContent).toEqual(first.structuredContent);
  });

  it("calls on different chains issue separate fetches (per-chain cache key)", async () => {
    const fetchMock = buildAbiFetch({ abiPayload: okPayload() });
    vi.stubGlobal("fetch", fetchMock);

    await callTool({ chain: "ethereum", address: VERIFIED_ADDRESS });
    await callTool({ chain: "arbitrum", address: VERIFIED_ADDRESS });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
