// Shared mock `ApiPromise` for the Phase 47 Bittensor prepare-tool + integration
// tests. Derived from 47-RESEARCH's live probe outputs (NOT hand-typed) so the
// produced `signableBlob` is byte-identical to the offline Fixtures TAO-A/B in
// test/signing-fingerprint-bittensor.test.ts.
//
// ANTI-HANG: this mock NEVER opens a WsProvider/ApiPromise socket. Tests inject
// it at the `_bittensorRegistry.getApi` seam via vi.spyOn. The `registry` is a
// REAL TypeRegistry with the subtensor signed-extension tuple pinned (matching
// the fixture builder) so `createType("ExtrinsicPayload",...).toU8a({method:true})`
// reproduces the fixture bytes; `tx.<section>.<method>` returns the pinned
// fixture method hex; the runtime-API surface returns the probed swap-sim +
// price envelopes.

import { TypeRegistry } from "@polkadot/types";
import { compactToU8a } from "@polkadot/util";

// The subtensor signed-extension tuple (47-RESEARCH §Probe 1) — identical to
// the fixture builder so the blob layout matches.
export const SUBTENSOR_SIGNED_EXTENSIONS = [
  "CheckNonZeroSender",
  "CheckSpecVersion",
  "CheckTxVersion",
  "CheckGenesis",
  "CheckMortality",
  "CheckNonce",
  "CheckWeight",
  "ChargeTransactionPayment",
  "CheckMetadataHash",
];

// Fixture chain constants — the builder pins these into the SignerPayloadJSON
// via the `_bittensorBuilder.resolveChainHashes` seam (spied in tests).
export const FIXTURE_CHAIN_HASHES = {
  blockHash: "0x" + "11".repeat(32),
  genesisHash: "0x" + "22".repeat(32),
  specVersion: "0x000000ab", // 171
  transactionVersion: "0x00000001", // 1
};

// The pinned fixture method hexes (cross-linked to test/signing-fingerprint-bittensor).
const DEST_ACCOUNT = "00".repeat(32);
export function fixtureTransferKeepAliveMethodHex(rao: bigint): string {
  const compact = Buffer.from(compactToU8a(rao)).toString("hex");
  return "0x0500" + "00" + DEST_ACCOUNT + compact;
}
const FIXTURE_HOTKEY = "aa".repeat(32);
function u64LeHex(v: bigint): string {
  return (v.toString(16).padStart(16, "0").match(/../g) as string[])
    .reverse()
    .join("");
}
export function fixtureAddStakeLimitMethodHex(
  amountStaked: bigint,
  limitPrice: bigint,
): string {
  return (
    "0x4b09" +
    FIXTURE_HOTKEY +
    "0100" + // netuid u16 LE = 1
    u64LeHex(amountStaked) +
    u64LeHex(limitPrice) +
    "01" // allowPartial = true
  );
}

/** Probed swap-sim envelope shape (47-RESEARCH §Probe 6) — concentrated AMM. */
export interface SwapSimConfig {
  /** RAO-per-alpha price (1e9-scaled fixed-point) returned by currentAlphaPrice. */
  currentAlphaPriceRaw: bigint;
  /** simSwap expected-out (only the call presence is asserted; value advisory). */
  simAlphaOut?: bigint;
  simTaoOut?: bigint;
}

export interface MockApiOptions {
  /** Nonce returned by accountNextIndex. Default 0 (matches the fixtures). */
  nonce?: number;
  swap?: SwapSimConfig;
  /** Spy hooks the test passes to assert call counts. */
  onSimSwapTaoForAlpha?: (netuid: number, taoRao: bigint) => void;
  onSimSwapAlphaForTao?: (netuid: number, alpha: bigint) => void;
}

/**
 * Build a mock `ApiPromise` (cast to `unknown` at the spy site). The
 * `tx.<section>.<method>` factories return the PINNED fixture method hex
 * regardless of args (so the test controls byte-identity), while still
 * accepting the real arg list the builder passes.
 */
export function makeMockBittensorApi(opts: MockApiOptions = {}): unknown {
  const registry = new TypeRegistry();
  registry.setSignedExtensions(SUBTENSOR_SIGNED_EXTENSIONS);

  const nonce = opts.nonce ?? 0;
  const swap = opts.swap ?? { currentAlphaPriceRaw: 500_000_000n };

  return {
    registry,
    genesisHash: { toHex: () => FIXTURE_CHAIN_HASHES.genesisHash },
    runtimeVersion: {
      specVersion: { toNumber: () => 171 },
      transactionVersion: { toNumber: () => 1 },
    },
    tx: {
      balances: {
        transferKeepAlive: (_dest: string, value: bigint) => ({
          method: { toHex: () => fixtureTransferKeepAliveMethodHex(value) },
        }),
      },
      subtensorModule: {
        addStakeLimit: (
          _hotkey: string,
          _netuid: number,
          amountStaked: bigint,
          limitPrice: bigint,
          _allowPartial: boolean,
        ) => ({
          method: {
            toHex: () =>
              fixtureAddStakeLimitMethodHex(amountStaked, limitPrice),
          },
        }),
        removeStakeLimit: (
          _hotkey: string,
          _netuid: number,
          amountUnstaked: bigint,
          limitPrice: bigint,
          _allowPartial: boolean,
        ) => ({
          method: {
            toHex: () =>
              fixtureAddStakeLimitMethodHex(amountUnstaked, limitPrice),
          },
        }),
      },
    },
    rpc: {
      system: {
        accountNextIndex: async (_addr: string) => ({ toNumber: () => nonce }),
      },
    },
    call: {
      swapRuntimeApi: {
        currentAlphaPrice: async (_netuid: number) => ({
          toString: () => swap.currentAlphaPriceRaw.toString(),
        }),
        simSwapTaoForAlpha: async (netuid: number, taoRao: bigint) => {
          opts.onSimSwapTaoForAlpha?.(netuid, taoRao);
          return { toJSON: () => ({ alphaAmount: (swap.simAlphaOut ?? 0n).toString() }) };
        },
        simSwapAlphaForTao: async (netuid: number, alpha: bigint) => {
          opts.onSimSwapAlphaForTao?.(netuid, alpha);
          return { toJSON: () => ({ taoAmount: (swap.simTaoOut ?? 0n).toString() }) };
        },
      },
    },
  };
}
