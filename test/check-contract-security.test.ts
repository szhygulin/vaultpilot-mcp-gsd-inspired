// Plan 07-04 Task 2 — check_contract_security tool tests (READ-21).
//
// Covers the 5-arm response routing through the tool surface:
//   - schema gates (INVALID_INPUT) — missing / malformed address
//   - missing API key (INTERNAL_ERROR with signup URL cause)
//   - happy path verified (verified: true + ageDays + privilegedFunctions
//     + accessControlMarkers)
//   - proxy fixture (proxy: true + implementation surfaced)
//   - HTTP 5xx → INTERNAL_ERROR (NOT verified: false) — T-ETHERSCAN-MASK-1
//   - rate-limited → INTERNAL_ERROR with cause "rate-limit"
//   - privileged-role surfacing (text-block prints the function sigs)
//   - register-all wiring
//
// **Mock strategy**: fetch-stub (per plan-checker FLAG-1 fix). DO NOT use
// `vi.spyOn(etherscanClient, "checkContractSecurity")` — ESM named-export
// bindings are immutable, so the spy silently no-ops and the test passes
// a fake assertion. Mirrors the test/fourbyte.test.ts pattern: inject at
// the `fetch` boundary, not at the named-export boundary.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";

import {
  _resetEtherscanCacheForTesting,
  _resetEtherscanRateCounterForTesting,
} from "../src/clients/etherscan.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

// Side-effect register the tool.
await import("../src/tools/check_contract_security.js");

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

interface FetchOpts {
  ok?: boolean;
  status?: number;
  sourcePayload?: unknown;
  creationPayload?: unknown;
  reject?: Error;
}

function buildFetch(opts: FetchOpts): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown) => {
    if (opts.reject) throw opts.reject;
    const url = String(input);
    const isGetSourceCode = url.includes("action=getsourcecode");
    const payload = isGetSourceCode ? opts.sourcePayload : opts.creationPayload;
    return {
      ok: opts.ok ?? true,
      status: opts.status,
      json: async () => payload,
    } satisfies MockResponse;
  });
}

const KEY_ENV = "ETHERSCAN_API_KEY";
let savedKey: string | undefined;

// Canonical fixtures.
const VERIFIED_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address; // USDC
const PROXY_ADDRESS = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as Address; // Aave V3 Pool
const IMPLEMENTATION_ADDRESS = "0x5FaaB9E4adb04f43d722e1cd4e8e60c2bb6e72f6" as Address;

const VERIFIED_ABI_JSON = JSON.stringify([
  { type: "function", name: "transfer", inputs: [{ type: "address" }, { type: "uint256" }] },
  { type: "function", name: "upgradeTo", inputs: [{ type: "address" }] },
  { type: "function", name: "pause", inputs: [] },
  { type: "function", name: "hasRole", inputs: [{ type: "bytes32" }, { type: "address" }] },
  { type: "function", name: "DEFAULT_ADMIN_ROLE", inputs: [] },
]);

const FIXED_TIMESTAMP_100_DAYS_AGO = Math.floor(Date.now() / 1000) - 100 * 86400;

function sourcePayloadVerified(overrides: Record<string, string> = {}) {
  return {
    status: "1",
    message: "OK",
    result: [
      {
        SourceCode: "contract Foo { ... }",
        ABI: VERIFIED_ABI_JSON,
        ContractName: "FiatTokenV2_2",
        CompilerVersion: "v0.8.20+commit.a1b79de6",
        Proxy: "0",
        Implementation: "",
        ...overrides,
      },
    ],
  };
}

function creationPayloadVerified(overrides: Record<string, string> = {}) {
  return {
    status: "1",
    message: "OK",
    result: [
      {
        contractCreator: "0x1111111111111111111111111111111111111111",
        txHash: "0x" + "aa".repeat(32),
        timestamp: String(FIXED_TIMESTAMP_100_DAYS_AGO),
        ...overrides,
      },
    ],
  };
}

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("check_contract_security");
  if (!tool) throw new Error("check_contract_security not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
}

beforeEach(() => {
  savedKey = process.env[KEY_ENV];
  process.env[KEY_ENV] = "test-api-key";
  _resetEtherscanCacheForTesting();
  _resetEtherscanRateCounterForTesting();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = savedKey;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  _resetEtherscanCacheForTesting();
  _resetEtherscanRateCounterForTesting();
});

describe("check_contract_security — schema gate: missing address", () => {
  it("Test 1 — missing 'address' returns INVALID_INPUT", async () => {
    const result = await callTool({});
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("check_contract_security — schema gate: malformed address", () => {
  it("Test 2 — non-40-hex 'address' returns INVALID_INPUT", async () => {
    const result = await callTool({ address: "0xnotahex" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("check_contract_security — missing API key (T-ETHERSCAN-KEY-LEAK-1 / signup URL)", () => {
  it("Test 3 — ETHERSCAN_API_KEY unset → INTERNAL_ERROR with signup URL in cause", async () => {
    delete process.env[KEY_ENV];

    const result = await callTool({ address: VERIFIED_ADDRESS });

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

describe("check_contract_security — happy path verified contract (Test 4)", () => {
  it("returns verified: true with parsed metadata + ageDays + privilegedFunctions + accessControlMarkers", async () => {
    const fetchMock = buildFetch({
      sourcePayload: sourcePayloadVerified(),
      creationPayload: creationPayloadVerified(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callTool({ address: VERIFIED_ADDRESS });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      chain: string;
      address: string;
      verified: boolean;
      proxy: boolean;
      contractName: string;
      compilerVersion: string;
      ageDays: number | "unknown";
      privilegedFunctions: string[];
      accessControlMarkers: string[];
    };
    expect(sc.chain).toBe("ethereum");
    expect(sc.address).toBe(VERIFIED_ADDRESS);
    expect(sc.verified).toBe(true);
    expect(sc.proxy).toBe(false);
    expect(sc.contractName).toBe("FiatTokenV2_2");
    expect(sc.compilerVersion).toBe("v0.8.20+commit.a1b79de6");
    expect(sc.ageDays).toBe(100);
    expect(sc.privilegedFunctions).toEqual(["upgradeTo(address)", "pause()"]);
    expect(sc.accessControlMarkers).toEqual([
      "hasRole(bytes32,address)",
      "DEFAULT_ADMIN_ROLE()",
    ]);
  });
});

describe("check_contract_security — proxy fixture (T-ETHERSCAN-PROXY-IMPLEMENTATION-MASK-1)", () => {
  it("Test 5 — Aave V3 Pool proxy surfaces proxy: true + implementation as separate fields", async () => {
    const fetchMock = buildFetch({
      sourcePayload: sourcePayloadVerified({
        Proxy: "1",
        Implementation: IMPLEMENTATION_ADDRESS,
        ContractName: "InitializableImmutableAdminUpgradeabilityProxy",
      }),
      creationPayload: creationPayloadVerified(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callTool({ address: PROXY_ADDRESS });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      verified: boolean;
      proxy: boolean;
      implementation: string;
    };
    expect(sc.verified).toBe(true);
    expect(sc.proxy).toBe(true);
    expect(sc.implementation).toBe(IMPLEMENTATION_ADDRESS);

    // Text block includes implementation line.
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("implementation:");
    expect(text).toContain(IMPLEMENTATION_ADDRESS);
  });
});

describe("check_contract_security — HTTP 5xx → INTERNAL_ERROR (T-ETHERSCAN-MASK-1)", () => {
  it("Test 6 — Etherscan returns 503; tool returns INTERNAL_ERROR (NOT verified: false)", async () => {
    const fetchMock = buildFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callTool({ address: VERIFIED_ADDRESS });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode?: string;
      cause?: string;
      verified?: boolean;
    };
    expect(sc.errorCode).toBe("INTERNAL_ERROR");
    expect(sc.cause).toBe("etherscan-unreachable");
    // Critical: NOT a fake `verified: false`.
    expect(sc.verified).toBeUndefined();
  });
});

describe("check_contract_security — unverified contract", () => {
  it("Test 7 — SourceCode empty → verified: false (no further fields)", async () => {
    const fetchMock = buildFetch({
      sourcePayload: {
        status: "1",
        message: "OK",
        result: [
          {
            SourceCode: "",
            ABI: "Contract source code not verified",
            ContractName: "",
            CompilerVersion: "",
            Proxy: "0",
            Implementation: "",
          },
        ],
      },
      creationPayload: creationPayloadVerified(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callTool({
      address: "0x000000000000000000000000000000000000dEaD",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      verified: boolean;
      contractName?: string;
      ageDays?: unknown;
    };
    expect(sc.verified).toBe(false);
    // No further detail fields populated on the not-verified arm.
    expect(sc.contractName).toBeUndefined();
    expect(sc.ageDays).toBeUndefined();
  });
});

describe("check_contract_security — rate-limited → INTERNAL_ERROR with cause 'rate-limit' (T-ETHERSCAN-RATE-1)", () => {
  it("Test 8 — 6th call (5 distinct uncached) returns INTERNAL_ERROR with cause 'rate-limit'", async () => {
    const fetchMock = buildFetch({
      sourcePayload: sourcePayloadVerified(),
      creationPayload: creationPayloadVerified(),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Burn the 5-call budget on distinct addresses.
    for (let i = 0; i < 5; i++) {
      const hex = `0x${i.toString(16).padStart(40, "0")}`;
      const r = await callTool({ address: hex });
      expect(r.isError).toBeFalsy();
    }
    // 6th distinct address — rate-limited.
    const result = await callTool({
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

describe("check_contract_security — privileged-role text-block surfacing", () => {
  it("Test 9 — privileged + accessControl arrays render verbatim in the text block", async () => {
    const fetchMock = buildFetch({
      sourcePayload: sourcePayloadVerified(),
      creationPayload: creationPayloadVerified(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callTool({ address: VERIFIED_ADDRESS });

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/privileged:\s+upgradeTo\(address\),\s+pause\(\)/);
    expect(text).toMatch(
      /accessControl:\s+hasRole\(bytes32,address\),\s+DEFAULT_ADMIN_ROLE\(\)/,
    );
  });
});

describe("check_contract_security — register-all wiring", () => {
  it("Test 10 — getRegisteredTool('check_contract_security') is defined post-import", async () => {
    const tool = getRegisteredTool("check_contract_security");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("check_contract_security");
    // Description is the agent's routing prompt — confirm key phrases are present.
    expect(tool?.description).toMatch(/Call BEFORE prepare_/);
    expect(tool?.description).toMatch(/ETHERSCAN_API_KEY/);
    expect(tool?.description).toMatch(/Per-session rate limit/);
  });
});
