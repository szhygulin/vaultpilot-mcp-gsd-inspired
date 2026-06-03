// test/get-bittensor-validators-enrichment.test.ts — Phase 48 Plan 48-02
// (TAO-R-05). Validator-enrichment coverage: delegate identity name + take%
// commission + per-netuid registration set, plus the isHotkeyRegisteredOnNetuid
// per-netuid registration signal (Plan 48-03 preview-warning input).
//
// ANTI-HANG: every @polkadot/api interaction is MOCKED at the
// `_bittensorRegistry.getApi` boundary — NEVER a real WsProvider/ApiPromise
// socket. The mock ApiPromise exposes:
//   - call.neuronInfoRuntimeApi.getNeuronsLite(netuid)  (permit-holder set)
//   - call.delegateInfoRuntimeApi.getDelegate(hotkey)   (take/registrations/owner)
//   - query.subtensorModule.identitiesV2(coldkey)       (on-chain name)
// Shapes derive from 48-RESEARCH §Validator Enrichment Reads (DelegateInfo:
// take Compact<u16>, ownerSs58, registrations[]; identitiesV2 value: { name }
// byte-vector). OQ-1: the identitiesV2 value-struct field names are
// fixture-at-execute — the decoder tolerates a null name.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _bittensorRegistry,
  _resetBittensorRegistryForTesting,
} from "../src/chains/bittensor/registry.js";
import {
  getValidators,
  isHotkeyRegisteredOnNetuid,
} from "../src/chains/bittensor/tao-rpc-client.js";

// take normalization: take / 65535 * 100 (2dp, trailing-zero trimmed). The
// shipped normalizeTakePercent is module-private; we replicate the formula
// here to assert the enriched takePercent matches it independently.
function expectedTakePercent(takeU16: number): string {
  const pct = (takeU16 / 65535) * 100;
  return pct.toFixed(2).replace(/\.?0+$/, "") || "0";
}

const HOTKEY_A = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";
const HOTKEY_B = "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9";
const COLDKEY_A = "5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy";
const COLDKEY_B = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";

// take of 6553 / 65535 ≈ 9.999... → "10" (round to 2dp). 16383/65535 ≈ "25".
const TAKE_A = 6553; // ~10%
const TAKE_B = 16383; // ~25%

interface DelegateShape {
  take: number;
  ownerSs58: string;
  registrations: number[];
  validatorPermits: number[];
}

/**
 * Build a mock ApiPromise. NEVER opens a socket.
 *   - getNeuronsLite(netuid) → the permit-holder set for that netuid.
 *   - getDelegate(hotkey)    → the DelegateInfo for that hotkey, or null.
 *   - identitiesV2(coldkey)  → the { name } value for that coldkey, or null.
 */
function makeMockApi(opts: {
  neuronsByNetuid: Record<
    number,
    Array<{ uid: number; hotkey: string; validatorPermit: boolean; take?: unknown }>
  >;
  delegatesByHotkey?: Record<string, DelegateShape | null>;
  // identitiesV2 value by coldkey. A string → { name: <utf8 bytes> } shape;
  // explicit null → empty identity (OQ-1 tolerance path).
  identityByColdkey?: Record<string, string | null>;
}): unknown {
  return {
    query: {
      system: { account: vi.fn() },
      subtensorModule: {
        identitiesV2: vi.fn().mockImplementation((coldkey: string) => {
          const name = opts.identityByColdkey?.[coldkey];
          if (name === undefined || name === null) {
            return Promise.resolve({ toJSON: () => null });
          }
          // { name } as a UTF-8 0x-hex byte-vector (the common decoded shape).
          const hex = "0x" + Buffer.from(name, "utf-8").toString("hex");
          return Promise.resolve({ toJSON: () => ({ name: hex }) });
        }),
      },
    },
    call: {
      neuronInfoRuntimeApi: {
        getNeuronsLite: vi.fn().mockImplementation((netuid: number) =>
          Promise.resolve({ toJSON: () => opts.neuronsByNetuid[netuid] ?? [] }),
        ),
      },
      delegateInfoRuntimeApi: {
        getDelegate: vi.fn().mockImplementation((hotkey: string) => {
          const d = opts.delegatesByHotkey?.[hotkey] ?? null;
          return Promise.resolve({ toJSON: () => d });
        }),
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

describe("getValidators — TAO-R-05 enrichment (identity + take% + registrations)", () => {
  it("enriches a permit-holder with decoded take%, registeredNetuids, and identity name", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockApi({
        neuronsByNetuid: {
          1: [{ uid: 7, hotkey: HOTKEY_A, validatorPermit: true, take: 999 }],
        },
        delegatesByHotkey: {
          [HOTKEY_A]: {
            take: TAKE_A,
            ownerSs58: COLDKEY_A,
            registrations: [1, 5, 11],
            validatorPermits: [1],
          },
        },
        identityByColdkey: { [COLDKEY_A]: "OpenTensor Foundation" },
      }) as never,
    );

    const rows = await getValidators(1);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.uid).toBe(7);
    expect(row.hotkey).toBe(HOTKEY_A);
    expect(row.validatorPermit).toBe(true);
    // take% from the DECODED DelegateInfo take (NOT the lite take 999).
    expect(row.takePercent).toBe(expectedTakePercent(TAKE_A));
    expect(row.registeredNetuids).toEqual([1, 5, 11]);
    expect(row.identity).toBe("OpenTensor Foundation");
  });

  it("tolerates an empty identitiesV2 → identity null, row still returned (OQ-1)", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockApi({
        neuronsByNetuid: {
          2: [{ uid: 3, hotkey: HOTKEY_B, validatorPermit: true }],
        },
        delegatesByHotkey: {
          [HOTKEY_B]: {
            take: TAKE_B,
            ownerSs58: COLDKEY_B,
            registrations: [2],
            validatorPermits: [2],
          },
        },
        identityByColdkey: { [COLDKEY_B]: null }, // empty identity
      }) as never,
    );

    const rows = await getValidators(2);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.identity).toBeNull(); // tolerated, not an error
    expect(row.takePercent).toBe(expectedTakePercent(TAKE_B));
    expect(row.registeredNetuids).toEqual([2]);
  });

  it("tolerates getDelegate None → identity null + registeredNetuids [] (falls back to lite take)", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockApi({
        neuronsByNetuid: {
          1: [{ uid: 9, hotkey: HOTKEY_A, validatorPermit: true, take: TAKE_A }],
        },
        delegatesByHotkey: { [HOTKEY_A]: null }, // not a registered delegate
        identityByColdkey: {},
      }) as never,
    );

    const rows = await getValidators(1);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.identity).toBeNull();
    expect(row.registeredNetuids).toEqual([]);
    // falls back to the lite take when getDelegate returns None.
    expect(row.takePercent).toBe(expectedTakePercent(TAKE_A));
  });

  it("only permit-holders are enumerated (non-permit neurons filtered out)", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockApi({
        neuronsByNetuid: {
          1: [
            { uid: 1, hotkey: HOTKEY_A, validatorPermit: true, take: TAKE_A },
            { uid: 2, hotkey: HOTKEY_B, validatorPermit: false, take: TAKE_B },
          ],
        },
        delegatesByHotkey: {
          [HOTKEY_A]: {
            take: TAKE_A,
            ownerSs58: COLDKEY_A,
            registrations: [1],
            validatorPermits: [1],
          },
        },
        identityByColdkey: { [COLDKEY_A]: "Validator A" },
      }) as never,
    );

    const rows = await getValidators(1);
    expect(rows.map((r) => r.uid)).toEqual([1]); // uid 2 (no permit) filtered
    expect(rows[0]!.identity).toBe("Validator A");
  });
});

describe("isHotkeyRegisteredOnNetuid — TAO-R-05 per-netuid registration signal (OQ-2)", () => {
  it("returns true when the hotkey is present in getNeuronsLite(netuid)", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockApi({
        neuronsByNetuid: {
          1: [
            { uid: 1, hotkey: HOTKEY_A, validatorPermit: true },
            { uid: 2, hotkey: HOTKEY_B, validatorPermit: false },
          ],
        },
      }) as never,
    );
    expect(await isHotkeyRegisteredOnNetuid(HOTKEY_A, 1)).toBe(true);
    // present even when validatorPermit is false — registration ≠ permit.
    expect(await isHotkeyRegisteredOnNetuid(HOTKEY_B, 1)).toBe(true);
  });

  it("returns false when the hotkey is absent from getNeuronsLite(netuid)", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeMockApi({
        neuronsByNetuid: {
          1: [{ uid: 1, hotkey: HOTKEY_A, validatorPermit: true }],
        },
      }) as never,
    );
    expect(await isHotkeyRegisteredOnNetuid(HOTKEY_B, 1)).toBe(false);
    // empty neuron set on a different netuid → false.
    expect(await isHotkeyRegisteredOnNetuid(HOTKEY_A, 99)).toBe(false);
  });
});
