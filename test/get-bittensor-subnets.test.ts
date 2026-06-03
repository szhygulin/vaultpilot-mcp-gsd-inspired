// test/get-bittensor-subnets.test.ts — Phase 46 Plan 46-03 (TAO-R-03).
//
// Covers get_bittensor_subnets (subnet enumeration, byte-array name/symbol
// decoded to UTF-8 strings) AND get_bittensor_validators (per-netuid
// permit-holder enumeration via getNeuronsLite). Both runtime APIs are
// MOCKED at the `_bittensorRegistry.getApi` boundary — NEVER a real
// WsProvider socket. Fixture shapes derive from the 46-RESEARCH §Reads
// probe (getAllDynamicInfo carries subnetName/tokenSymbol as byte arrays;
// getNeuronsLite carries hotkey + uid + validatorPermit + take).
//
// The byte-array decode is the load-bearing assertion: `.toJSON()`
// serializes a Vec<u8> EITHER as a `0x…` hex string OR as a number array
// depending on the codec — both shapes are covered.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _bittensorRegistry,
  _resetBittensorRegistryForTesting,
} from "../src/chains/bittensor/registry.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/get_bittensor_subnets.js");
await import("../src/tools/get_bittensor_validators.js");

async function callSubnets(): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_bittensor_subnets");
  if (!tool) throw new Error("get_bittensor_subnets not registered");
  return tool.handler({});
}

async function callValidators(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_bittensor_validators");
  if (!tool) throw new Error("get_bittensor_validators not registered");
  return tool.handler(args);
}

// UTF-8 → 0x-hex byte-string helper (one encode shape getAllDynamicInfo
// uses). "root" → 0x726f6f74.
function toHexBytes(s: string): string {
  return "0x" + Buffer.from(s, "utf-8").toString("hex");
}
// UTF-8 → number-array (the other encode shape). "τ" → [206, 132].
function toNumArrayBytes(s: string): number[] {
  return Array.from(Buffer.from(s, "utf-8").values());
}

function makeFakeApi(opts: {
  subnets?: Array<{
    netuid: number;
    subnetName: unknown;
    tokenSymbol: unknown;
    taoIn: string | number;
    alphaIn: string | number;
  }>;
  neuronsByNetuid?: Record<
    number,
    Array<{ uid: number; hotkey: string; validatorPermit: boolean; take?: unknown }>
  >;
}): unknown {
  return {
    query: { system: { account: vi.fn() } },
    call: {
      subnetInfoRuntimeApi: {
        getAllDynamicInfo: vi.fn().mockResolvedValue({
          toJSON: () => opts.subnets ?? [],
        }),
      },
      neuronInfoRuntimeApi: {
        getNeuronsLite: vi.fn().mockImplementation((netuid: number) =>
          Promise.resolve({
            toJSON: () => opts.neuronsByNetuid?.[netuid] ?? [],
          }),
        ),
      },
    },
  };
}

beforeEach(() => {
  _resetBittensorRegistryForTesting();
});

afterEach(() => {
  _resetBittensorRegistryForTesting();
  vi.restoreAllMocks();
});

describe("get_bittensor_subnets — byte-array name/symbol decode (TAO-R-03)", () => {
  it("decodes subnetName/tokenSymbol byte arrays (hex-string + number-array shapes) to UTF-8 strings + decimal reserves", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeFakeApi({
        subnets: [
          {
            netuid: 0,
            subnetName: toHexBytes("root"), // hex-string shape
            tokenSymbol: toHexBytes("TAO"),
            taoIn: "27864194863896", // ~27864.19 TAO
            alphaIn: "2833743079985058", // ~2833743.07 alpha
          },
          {
            netuid: 1,
            subnetName: toNumArrayBytes("apex"), // number-array shape
            tokenSymbol: toNumArrayBytes("α"),
            taoIn: 1_000_000_000, // 1 TAO (number shape)
            alphaIn: 2_000_000_000, // 2 alpha → price 0.5 TAO/alpha
          },
        ],
      }) as never,
    );

    const result = await callSubnets();

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      subnetCount: number;
      subnets: Array<{
        netuid: number;
        name: string;
        symbol: string;
        taoIn: string;
        taoInUnit: string;
        alphaIn: string;
        alphaInUnit: string;
        alphaPriceRaw: string;
      }>;
    };

    expect(sc.subnetCount).toBe(2);

    const root = sc.subnets.find((s) => s.netuid === 0)!;
    expect(root.name).toBe("root");
    expect(root.symbol).toBe("TAO");
    expect(root.taoInUnit).toBe("TAO");
    expect(root.alphaInUnit).toBe("ALPHA");
    expect(root.taoIn).toBe("27864.194863896");

    const apex = sc.subnets.find((s) => s.netuid === 1)!;
    expect(apex.name).toBe("apex");
    expect(apex.symbol).toBe("α");
    expect(apex.taoIn).toBe("1");
    expect(apex.alphaIn).toBe("2");
    // Derived price: taoIn/alphaIn × 1e9 = 1e9/2e9 × 1e9 = 500_000_000.
    expect(apex.alphaPriceRaw).toBe("500000000");

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/netuid 0/);
    expect(text).toMatch(/root/);
    expect(text).toMatch(/apex/);
  });

  it("empty subnet set → zero subnets, no crash", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeFakeApi({ subnets: [] }) as never,
    );
    const result = await callSubnets();
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { subnetCount: number }).subnetCount).toBe(0);
  });
});

describe("get_bittensor_validators — per-netuid permit-holder enumeration (TAO-R-03)", () => {
  it("filters validatorPermit === true + normalizes take to a percentage string", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeFakeApi({
        neuronsByNetuid: {
          1: [
            // take 11796/65535 ≈ 18% → "18".
            { uid: 0, hotkey: "5Validator0", validatorPermit: true, take: 11796 },
            // non-validator — filtered out.
            { uid: 1, hotkey: "5Miner1", validatorPermit: false, take: 0 },
            // take 0 → "0".
            { uid: 2, hotkey: "5Validator2", validatorPermit: true, take: 0 },
          ],
        },
      }) as never,
    );

    const result = await callValidators({ netuid: 1 });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      netuid: number;
      validatorCount: number;
      validators: Array<{
        uid: number;
        hotkey: string;
        validatorPermit: boolean;
        takePercent: string | null;
      }>;
    };
    expect(sc.netuid).toBe(1);
    // The non-permit miner is filtered out.
    expect(sc.validatorCount).toBe(2);
    const v0 = sc.validators.find((v) => v.uid === 0)!;
    expect(v0.hotkey).toBe("5Validator0");
    expect(v0.validatorPermit).toBe(true);
    expect(v0.takePercent).toBe("18");
    const v2 = sc.validators.find((v) => v.uid === 2)!;
    expect(v2.takePercent).toBe("0");
    // The filtered miner is absent.
    expect(sc.validators.find((v) => v.uid === 1)).toBeUndefined();

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/netuid 1/);
    expect(text).toMatch(/5Validator0/);
    expect(text).toMatch(/18%/);
  });

  it("refuses with INVALID_INPUT when netuid is absent (per-subnet contract)", async () => {
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    const result = await callValidators({});
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    // No RPC round-trip on missing netuid.
    expect(getApiSpy).not.toHaveBeenCalled();
  });

  it("empty validator set → zero validators, no crash", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeFakeApi({ neuronsByNetuid: { 99: [] } }) as never,
    );
    const result = await callValidators({ netuid: 99 });
    expect(result.isError).toBeFalsy();
    expect(
      (result.structuredContent as { validatorCount: number }).validatorCount,
    ).toBe(0);
  });
});
