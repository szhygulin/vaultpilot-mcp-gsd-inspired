// test/get-btc-account-balance.test.ts — Phase 22 Plan 22-03 Task 2 (BTC-READ-03).
//
// MCP tool: aggregate BTC balance across all derived addresses under a
// BIP-84 zpub OR BIP-86 xpub via gap-limit-respecting scan.
//
// Coverage:
//   1. Happy path: scan returns totalConfirmedSats + addressesScanned
//      + activeAddresses[]
//   2. scriptType arg: defaults to "p2wpkh"; "p2tr" routes correctly
//   3. INVALID_XPUB: bip32.fromBase58 reject → structured envelope
//   4. Empty input: missing wallet/xpub → INVALID_INPUT envelope
//   5. Schema-level prefix gate: ^(xpub|zpub) regex enforces base58
//      prefix + length (111 chars)
//   6. bigint balance serialized as decimal string

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetBitcoinRegistryForTesting } from "../src/chains/bitcoin/registry.js";
import { _resetEsploraCacheForTesting } from "../src/chains/bitcoin/esplora-client.js";
import * as esploraClient from "../src/chains/bitcoin/esplora-client.js";
import { _resetXpubScanCacheForTesting } from "../src/chains/bitcoin/xpub-scan.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

// BIP-84 spec Test Vector 1 zpub (m/84'/0'/0').
const VALID_ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

// BIP-86 spec Test Vector 1 xpub (m/86'/0'/0').
const VALID_BIP86_XPUB =
  "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";

function okResult(
  address: string,
  funded: bigint,
  spent: bigint,
  chainTxCount: number,
): esploraClient.EsploraAddressResult {
  return {
    kind: "ok",
    address,
    confirmedBalanceSats: funded - spent,
    unconfirmedBalanceSats: 0n,
    txCount: chainTxCount,
  };
}

function emptyResult(address: string): esploraClient.EsploraAddressResult {
  return {
    kind: "ok",
    address,
    confirmedBalanceSats: 0n,
    unconfirmedBalanceSats: 0n,
    txCount: 0,
  };
}

beforeEach(() => {
  _resetEsploraCacheForTesting();
  _resetBitcoinRegistryForTesting();
  _resetXpubScanCacheForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetEsploraCacheForTesting();
  _resetBitcoinRegistryForTesting();
  _resetXpubScanCacheForTesting();
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_btc_account_balance");
  if (!tool) throw new Error("get_btc_account_balance not registered");
  return tool.handler(args);
}

describe("get_btc_account_balance (BTC-READ-03)", () => {
  it("happy path — scans zpub, returns totalConfirmedSats + addressesScanned + activeAddresses[]", async () => {
    // i=0: 100_000 sat; i=1..20 empty → terminate.
    let callIdx = 0;
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        const here = callIdx;
        callIdx += 1;
        if (here === 0) return okResult(addr, 100_000n, 0n, 1);
        return emptyResult(addr);
      },
    );

    const result = await callTool({ wallet: { xpub: VALID_ZPUB } });
    expect(result.isError).toBeUndefined();
    const s = result.structuredContent as Record<string, unknown>;
    expect(s.totalConfirmedSats).toBe("100000");
    expect(s.addressesScanned).toBe(21); // 1 active + 20 empties
    const active = s.activeAddresses as Array<Record<string, unknown>>;
    expect(active.length).toBe(1);
    expect(active[0]?.confirmedBalanceSats).toBe("100000");
  });

  it("scriptType: 'p2tr' routes through taproot derivation (BIP-86 xpub)", async () => {
    const seen: string[] = [];
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        seen.push(addr);
        return emptyResult(addr);
      },
    );

    await callTool({ wallet: { xpub: VALID_BIP86_XPUB, scriptType: "p2tr" } });
    // All derived addresses should be taproot (bc1p…).
    for (const addr of seen) {
      expect(addr.startsWith("bc1p")).toBe(true);
    }
  });

  it("scriptType defaults to 'p2wpkh' when omitted (BIP-84 zpub)", async () => {
    const seen: string[] = [];
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        seen.push(addr);
        return emptyResult(addr);
      },
    );

    await callTool({ wallet: { xpub: VALID_ZPUB } });
    for (const addr of seen) {
      expect(addr.startsWith("bc1q")).toBe(true);
    }
  });

  it("INVALID_XPUB: malformed xpub → structured error envelope (NOT throw)", async () => {
    // Pass an xpub-shaped string that passes the schema regex but fails
    // bip32.fromBase58 (corrupted base58 → bad checksum).
    const corrupted =
      "xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdz"; // last char swapped
    const result = await callTool({ wallet: { xpub: corrupted } });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>).errorCode).toBe(
      "INVALID_XPUB",
    );
  });

  it("INVALID_INPUT: empty/missing wallet arg", async () => {
    const result = await callTool({});
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("INPUT_SCHEMA: wallet.xpub pattern enforces ^(xpub|zpub) base58 + length 111", () => {
    const tool = getRegisteredTool("get_btc_account_balance");
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const walletProps = props.wallet?.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(walletProps?.xpub?.pattern).toBe(
      "^(xpub|zpub)[1-9A-HJ-NP-Za-km-z]{107}$",
    );
  });

  it("bigint balance fields serialize as decimal STRING", async () => {
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        return emptyResult(addr);
      },
    );

    const result = await callTool({ wallet: { xpub: VALID_ZPUB } });
    const s = result.structuredContent as Record<string, unknown>;
    expect(typeof s.totalConfirmedSats).toBe("string");
  });
});
