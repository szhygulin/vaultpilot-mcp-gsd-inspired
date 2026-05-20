// test/get-solana-token-metadata.test.ts — Phase 11 Plan 11-05 (SOL-04).
//
// Mirrors test/get-token-metadata.test.ts: registry-hit-first, on-demand
// RPC fallback for unknown mints.

import { MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const UNKNOWN_MINT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const DUMMY_PUBKEY = "11111111111111111111111111111111";

function encodeMintBuffer(decimals: number): Buffer {
  const buf = Buffer.alloc(MintLayout.span);
  const dummy = new PublicKey(DUMMY_PUBKEY);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: dummy,
      supply: 1_000_000_000_000n,
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: dummy,
    },
    buf,
  );
  return buf;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_solana_token_metadata");
  if (!tool) throw new Error("get_solana_token_metadata not registered");
  return tool.handler(args);
}

describe("get_solana_token_metadata tool (Phase 11 Plan 11-05 SOL-04)", () => {
  it("registry hit (USDC): returns symbol/decimals/displayName without an RPC call", async () => {
    const getAccountInfoStub = vi.fn();
    const connection = { getAccountInfo: getAccountInfoStub } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(connection);

    const result = await callTool({ mint: USDC_MINT });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      mint: USDC_MINT,
      symbol: "USDC",
      decimals: 6,
      displayName: "USD Coin",
    });
    // No RPC call — registry hit short-circuits.
    expect(getAccountInfoStub).not.toHaveBeenCalled();
  });

  it("registry miss: on-demand getMint() → symbolUnknown=true, decimals from chain", async () => {
    const getAccountInfoStub = vi.fn(async () => ({
      data: encodeMintBuffer(8),
      executable: false,
      lamports: 1461600,
      owner: TOKEN_PROGRAM_ID,
      rentEpoch: 0,
    }));
    const connection = { getAccountInfo: getAccountInfoStub } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(connection);

    const result = await callTool({ mint: UNKNOWN_MINT });
    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      mint: string;
      symbol: string;
      decimals: number;
      displayName: null;
      symbolUnknown: true;
    };
    expect(out.mint).toBe(UNKNOWN_MINT);
    expect(out.decimals).toBe(8);
    expect(out.symbolUnknown).toBe(true);
    expect(out.displayName).toBeNull();
    expect(getAccountInfoStub).toHaveBeenCalledTimes(1);
  });

  it("invalid mint (empty string) → INVALID_INPUT envelope", async () => {
    const result = await callTool({ mint: "" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ errorCode: "INVALID_INPUT" });
  });
});
