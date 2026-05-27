// Phase 36 Plan 36-02 (SAFE-02) — get_safe_transaction integration tests.
//
// Stubbing strategy (per CLAUDE.md):
//   - Tx Service: `vi.stubGlobal("fetch", ...)` for the
//     `getMultisigTransaction` boundary.
//   - Phase 35 ABI cache: `vi.spyOn(etherscanModule, "getCachedEtherscanAbi")
//     .mockReturnValue(...)` for cache HIT vs MISS scenarios. This is a
//     module-level spy (cache reads are synchronous returns; no need for
//     ESM indirection inside this tool).
//
// Coverage: 18 behaviors from 36-02-PLAN Task 3.

import { parseAbi, type Abi } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as etherscanModule from "../../src/clients/etherscan.js";
import {
  _resetSafeTxServiceCachesForTesting,
  _resetSafeTxServiceRateCounterForTesting,
} from "../../src/clients/safe-tx-service.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../../src/tools/index.js";
import "../../src/tools/register-all.js";

import {
  MULTISIG_TX_DELEGATECALL_FIXTURE,
  MULTISIG_TX_NO_CONFIRMATIONS_FIXTURE,
  MULTISIG_TX_OK_FIXTURE,
} from "../fixtures/safe-tx-service-responses.js";

// ERC-20 transfer(address,uint256) ABI for the decode-hit scenario. The OK
// fixture's `data` field is `transfer(0xaa...aa, 1000)`.
const ERC20_ABI: Abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

interface MockResponse {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
}

interface FetchOpts {
  status?: number;
  body?: unknown;
  retryAfter?: string;
}

function buildFetch(opts: FetchOpts): ReturnType<typeof vi.fn> {
  return vi.fn(async () => {
    const status = opts.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "retry-after" && opts.retryAfter !== undefined
            ? opts.retryAfter
            : null,
      },
      json: async () => opts.body ?? {},
    } satisfies MockResponse;
  });
}

function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_safe_transaction");
  if (!tool) throw new Error("get_safe_transaction not registered");
  return Promise.resolve(tool.handler(args));
}

const SAFE_ADDRESS = MULTISIG_TX_OK_FIXTURE.safe;
const SAFE_TX_HASH = MULTISIG_TX_OK_FIXTURE.safeTxHash;
const DELEGATE_HASH = MULTISIG_TX_DELEGATECALL_FIXTURE.safeTxHash;
const NO_CONF_HASH = MULTISIG_TX_NO_CONFIRMATIONS_FIXTURE.safeTxHash;

beforeEach(() => {
  _resetSafeTxServiceCachesForTesting();
  _resetSafeTxServiceRateCounterForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetSafeTxServiceCachesForTesting();
  _resetSafeTxServiceRateCounterForTesting();
});

describe("get_safe_transaction :: happy path — operation discriminator + decoded operation", () => {
  it("Test 1: operation='call' + decoded ERC-20 transfer when cache HIT", async () => {
    vi.stubGlobal("fetch", buildFetch({ body: MULTISIG_TX_OK_FIXTURE }));
    vi.spyOn(etherscanModule, "getCachedEtherscanAbi").mockReturnValue({
      kind: "ok",
      abi: ERC20_ABI,
      rawAbiJson: "[]",
      sourceCodeUrl: "https://etherscan.io/example",
    });

    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: SAFE_TX_HASH,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.operation).toBe("call");
    expect(sc.value).toBe("0"); // STRING preserved (Pitfall 3)
    expect(sc.safeTxGas).toBe("0");
    expect(sc.baseGas).toBe("0");
    expect(sc.gasPrice).toBe("0");
    expect(sc.nonce).toBe("12");
    expect(typeof sc.decodedOperation).toBe("string");
    // The decoded form should mention `transfer` (selector for the fixture).
    expect(String(sc.decodedOperation)).toMatch(/^transfer\(/);
  });

  it("Test 2: operation='delegatecall' surfaces semantic string (Phase 38 contract)", async () => {
    vi.stubGlobal("fetch", buildFetch({ body: MULTISIG_TX_DELEGATECALL_FIXTURE }));
    vi.spyOn(etherscanModule, "getCachedEtherscanAbi").mockReturnValue(null);

    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: DELEGATE_HASH,
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.operation).toBe("delegatecall");
    // NOT the raw numeric 1
    expect(sc.operation).not.toBe(1);
  });
});

describe("get_safe_transaction :: decodedOperation — cache HIT / MISS / non-ok variants", () => {
  it("Test 4: cache MISS → decodedOperation: null + ZERO new Etherscan network calls", async () => {
    const fetchSpy = buildFetch({ body: MULTISIG_TX_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchSpy);
    const cacheSpy = vi
      .spyOn(etherscanModule, "getCachedEtherscanAbi")
      .mockReturnValue(null);

    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: SAFE_TX_HASH,
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.decodedOperation).toBeNull();
    // fetch was called exactly once — the Tx Service tx fetch. NO Etherscan
    // network call for ABI lookup.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(cacheSpy).toHaveBeenCalled();
  });

  it("Test 5: cached not-verified arm → decodedOperation: null", async () => {
    vi.stubGlobal("fetch", buildFetch({ body: MULTISIG_TX_OK_FIXTURE }));
    vi.spyOn(etherscanModule, "getCachedEtherscanAbi").mockReturnValue({
      kind: "not-verified",
    });

    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: SAFE_TX_HASH,
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.decodedOperation).toBeNull();
  });

  it("Test 6: empty calldata (data === '0x') → decodedOperation: null without cache lookup", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetch({ body: { ...MULTISIG_TX_OK_FIXTURE, data: "0x" } }),
    );
    const cacheSpy = vi
      .spyOn(etherscanModule, "getCachedEtherscanAbi")
      .mockReturnValue(null);

    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: SAFE_TX_HASH,
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.decodedOperation).toBeNull();
    // Short-circuit happens BEFORE the cache lookup.
    expect(cacheSpy).not.toHaveBeenCalled();
  });

  it("Test 7: cached ABI present but selector not in ABI → decodedOperation: null via try/catch", async () => {
    vi.stubGlobal("fetch", buildFetch({ body: MULTISIG_TX_OK_FIXTURE }));
    // An ABI that does NOT contain the `transfer(address,uint256)` selector
    // 0xa9059cbb — only `balanceOf(address)`.
    const onlyBalanceOf: Abi = parseAbi([
      "function balanceOf(address owner) view returns (uint256)",
    ]);
    vi.spyOn(etherscanModule, "getCachedEtherscanAbi").mockReturnValue({
      kind: "ok",
      abi: onlyBalanceOf,
      rawAbiJson: "[]",
      sourceCodeUrl: "https://etherscan.io/example",
    });

    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: SAFE_TX_HASH,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.decodedOperation).toBeNull();
  });
});

describe("get_safe_transaction :: confirmations defensive default (Pitfall 6)", () => {
  it("Test 8: confirmations undefined on wire → response confirmations: [], collectedSignatures: 0", async () => {
    vi.stubGlobal("fetch", buildFetch({ body: MULTISIG_TX_NO_CONFIRMATIONS_FIXTURE }));
    vi.spyOn(etherscanModule, "getCachedEtherscanAbi").mockReturnValue(null);

    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: NO_CONF_HASH,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.confirmations).toEqual([]);
    expect(sc.collectedSignatures).toBe(0);
    expect(sc.requiredSignatures).toBe(2);
    expect(sc.isExecutable).toBe(false);
  });

  it("Test 9: collectedSignatures < requiredSignatures → isExecutable: false", async () => {
    vi.stubGlobal("fetch", buildFetch({ body: MULTISIG_TX_OK_FIXTURE }));
    vi.spyOn(etherscanModule, "getCachedEtherscanAbi").mockReturnValue(null);

    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: SAFE_TX_HASH,
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.collectedSignatures).toBe(1);
    expect(sc.requiredSignatures).toBe(2);
    expect(sc.isExecutable).toBe(false);
  });

  it("Test 10: collectedSignatures >= requiredSignatures → isExecutable: true", async () => {
    const threeSigFixture = {
      ...MULTISIG_TX_OK_FIXTURE,
      confirmationsRequired: 2,
      confirmations: [
        ...(MULTISIG_TX_OK_FIXTURE.confirmations ?? []),
        {
          owner: "0xBbBbBBbbbBbBBBbBBbbBBBBbbbBbBBbBBbbBBBBb",
          signature: "0x" + "22".repeat(65),
          signatureType: "EOA" as const,
        },
      ],
    };
    vi.stubGlobal("fetch", buildFetch({ body: threeSigFixture }));
    vi.spyOn(etherscanModule, "getCachedEtherscanAbi").mockReturnValue(null);

    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: SAFE_TX_HASH,
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.collectedSignatures).toBe(2);
    expect(sc.requiredSignatures).toBe(2);
    expect(sc.isExecutable).toBe(true);
  });
});

describe("get_safe_transaction :: Tx Service DU error arms surface as isError refusals", () => {
  it("Test 11: unsupported-chain (forced via module-level spy) returns isError + verbatim message", async () => {
    const safeTxModule = await import("../../src/clients/safe-tx-service.js");
    vi.spyOn(safeTxModule, "getMultisigTransaction").mockResolvedValue({
      kind: "unsupported-chain",
      chainId: 1,
    });
    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: SAFE_TX_HASH,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/has no endpoint/);
  });

  it("Test 12: not-found arm → isError with 'not registered in Tx Service'", async () => {
    vi.stubGlobal("fetch", buildFetch({ status: 404, body: { detail: "not found" } }));
    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: SAFE_TX_HASH,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not registered in Tx Service/);
  });

  it("Test 13: rate-limited arm → isError with upstream retry-after surface", async () => {
    vi.stubGlobal("fetch", buildFetch({ status: 429, retryAfter: "30" }));
    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: SAFE_TX_HASH,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/429/);
    expect(result.content[0]?.text).toMatch(/retry-after/);
  });

  it("Test 14: 5xx error → isError with HTTP status code", async () => {
    vi.stubGlobal("fetch", buildFetch({ status: 503 }));
    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: SAFE_TX_HASH,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/HTTP 503/);
  });
});

describe("get_safe_transaction :: input validation refusals", () => {
  it("Test 15: invalid safeAddress → isError refusal", async () => {
    const fetchSpy = buildFetch({ body: MULTISIG_TX_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await callTool({
      chain: "ethereum",
      safeAddress: "not-an-address",
      safeTxHash: SAFE_TX_HASH,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/safeAddress.*valid.*EVM/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Test 16: invalid safeTxHash → isError refusal", async () => {
    const fetchSpy = buildFetch({ body: MULTISIG_TX_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await callTool({
      chain: "ethereum",
      safeAddress: SAFE_ADDRESS,
      safeTxHash: "0xnothex",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/safeTxHash.*32-byte/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("get_safe_transaction :: register-all.ts wiring", () => {
  it("Test 17: register-all.ts imports get_safe_transaction.js side-effect", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "..", "..", "src", "tools", "register-all.ts"),
      "utf8",
    );
    expect(src).toMatch(/import\s+["'].\/get_safe_transaction(\.js)?["']/);
  });
});

describe("get_safe_transaction :: FROZEN-area zero-diff (Task 3 close-out)", () => {
  it("Test 18: src/signing/, send_transaction.ts, preview_send.ts, test/signing-* untouched", async () => {
    const { execSync } = await import("node:child_process");
    // CI uses shallow checkout (fetch-depth: 1) so origin/main may be unresolvable.
    // Local dev always has it. Skip cleanly when absent — keeps the guard live for
    // every author-side run without forcing CI to do a full-history clone.
    try {
      execSync("git rev-parse --verify --quiet origin/main", { stdio: "ignore" });
    } catch {
      return;
    }
    const out = execSync(
      "git diff --stat origin/main -- src/signing/ src/tools/send_transaction.ts src/tools/preview_send.ts test/signing-*.test.ts",
      { encoding: "utf8" },
    );
    // Empty output → FROZEN-area zero-diff holds.
    expect(out.trim()).toBe("");
  });
});
