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

// =====================  Phase 48 — TAO-D..H fixture method hexes  ===========
// Byte-identical to the offline fixtures in test/signing-fingerprint-bittensor
// (pinned 0x09__ pallet/call literals, pallet-macro arg order). The factories
// return these regardless of the real SS58 args the prepare tools pass (the
// test controls byte-identity) but DO depend on the amount so a +1 amount
// changes the fingerprint. netuid origin=1 (0100), dest=2 (0200).
const FIXTURE_HOTKEY_2 = "bb".repeat(32);
const FIXTURE_COLDKEY = "cc".repeat(32);
const N1_LE = "0100";
const N2_LE = "0200";
export function fixtureAddStakeMethodHex(amountStaked: bigint): string {
  return "0x0900" + FIXTURE_HOTKEY + N1_LE + u64LeHex(amountStaked);
}
export function fixtureRemoveStakeMethodHex(amountUnstaked: bigint): string {
  return "0x0901" + FIXTURE_HOTKEY + N1_LE + u64LeHex(amountUnstaked);
}
export function fixtureMoveStakeMethodHex(alphaAmount: bigint): string {
  return (
    "0x0902" +
    FIXTURE_HOTKEY +
    FIXTURE_HOTKEY_2 +
    N1_LE +
    N2_LE +
    u64LeHex(alphaAmount)
  );
}
export function fixtureSwapStakeMethodHex(alphaAmount: bigint): string {
  return "0x0903" + FIXTURE_HOTKEY + N1_LE + N2_LE + u64LeHex(alphaAmount);
}
export function fixtureTransferStakeMethodHex(alphaAmount: bigint): string {
  return (
    "0x0904" +
    FIXTURE_COLDKEY +
    FIXTURE_HOTKEY +
    N1_LE +
    N2_LE +
    u64LeHex(alphaAmount)
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

/**
 * Send-path hooks (Phase 47 — Plan 47-04 integration test). The send branch
 * calls `api.tx(methodHex)` to rebuild the SubmittableExtrinsic, then
 * `.addSignature(signer, sigHex, payload)` → `.toHex()`, then
 * `api.rpc.author.submitExtrinsic(signedHex)` → `{ toHex() }`. These hooks let
 * the integration test observe the assembled args + the broadcast input WITHOUT
 * a live socket or a real device.
 */
export interface MockSendConfig {
  /** Records the (signer, sigHex, payload) addSignature was called with. */
  onAddSignature?: (signer: string, sigHex: string, payload: unknown) => void;
  /** Records the signed-extrinsic hex passed to submitExtrinsic. */
  onSubmitExtrinsic?: (signedHex: string) => void;
  /** The extrinsic hash submitExtrinsic resolves to. Default a fixed literal. */
  extrinsicHash?: string;
  /** When set, submitExtrinsic rejects with this error (BadProof simulation). */
  submitRejectsWith?: Error;
}

export interface MockApiOptions {
  /** Nonce returned by accountNextIndex. Default 0 (matches the fixtures). */
  nonce?: number;
  swap?: SwapSimConfig;
  /** Spy hooks the test passes to assert call counts. */
  onSimSwapTaoForAlpha?: (netuid: number, taoRao: bigint) => void;
  onSimSwapAlphaForTao?: (netuid: number, alpha: bigint) => void;
  /** Send-path hooks (Plan 47-04 integration). Omit for prepare-only tests. */
  send?: MockSendConfig;
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
  const send = opts.send;

  // `tx` is BOTH:
  //   - an object with the section/method factories (builder path:
  //     `api.tx.balances.transferKeepAlive(...)`), AND
  //   - a callable that rebuilds a SubmittableExtrinsic from a method hex
  //     (send path: `api.tx(methodHex)`).
  // A JS function carries properties, so we attach the section factories onto
  // the callable. The rebuilt extrinsic's `toHex()` returns a synthetic
  // signed-extrinsic hex derived from the passed sigHex so the test can assert
  // a well-formed envelope reached submitExtrinsic.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txFn: any = (methodHex: string) => {
    let attachedSig = "";
    return {
      addSignature: (signer: string, sigHex: string, payload: unknown) => {
        send?.onAddSignature?.(signer, sigHex, payload);
        attachedSig = sigHex;
        return {
          // Synthetic well-formed signed-extrinsic hex: version byte (0x84 =
          // signed v4) ‖ the MultiSignature (sigHex) ‖ the call hex tail. The
          // exact layout is not consensus-checked here (no live runtime); the
          // assertion is that addSignature ran with the device sig + the
          // envelope carries it. submitExtrinsic receives THIS hex.
          toHex: () =>
            "0x84" + attachedSig.replace(/^0x/, "") + methodHex.replace(/^0x/, ""),
        };
      },
    };
  };
  txFn.balances = {
    transferKeepAlive: (_dest: string, value: bigint) => ({
      method: { toHex: () => fixtureTransferKeepAliveMethodHex(value) },
    }),
  };
  txFn.subtensorModule = {
    addStakeLimit: (
      _hotkey: string,
      _netuid: number,
      amountStaked: bigint,
      limitPrice: bigint,
      _allowPartial: boolean,
    ) => ({
      method: {
        toHex: () => fixtureAddStakeLimitMethodHex(amountStaked, limitPrice),
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
        toHex: () => fixtureAddStakeLimitMethodHex(amountUnstaked, limitPrice),
      },
    }),
    // Phase 48 deferred staking shapes — pallet-macro (hotkey-first) order.
    addStake: (_hotkey: string, _netuid: number, amountStaked: bigint) => ({
      method: { toHex: () => fixtureAddStakeMethodHex(amountStaked) },
    }),
    removeStake: (
      _hotkey: string,
      _netuid: number,
      amountUnstaked: bigint,
    ) => ({
      method: { toHex: () => fixtureRemoveStakeMethodHex(amountUnstaked) },
    }),
    moveStake: (
      _originHotkey: string,
      _destinationHotkey: string,
      _originNetuid: number,
      _destinationNetuid: number,
      alphaAmount: bigint,
    ) => ({
      method: { toHex: () => fixtureMoveStakeMethodHex(alphaAmount) },
    }),
    swapStake: (
      _hotkey: string,
      _originNetuid: number,
      _destinationNetuid: number,
      alphaAmount: bigint,
    ) => ({
      method: { toHex: () => fixtureSwapStakeMethodHex(alphaAmount) },
    }),
    transferStake: (
      _destinationColdkey: string,
      _hotkey: string,
      _originNetuid: number,
      _destinationNetuid: number,
      alphaAmount: bigint,
    ) => ({
      method: { toHex: () => fixtureTransferStakeMethodHex(alphaAmount) },
    }),
  };

  return {
    registry,
    genesisHash: { toHex: () => FIXTURE_CHAIN_HASHES.genesisHash },
    runtimeVersion: {
      specVersion: { toNumber: () => 171 },
      transactionVersion: { toNumber: () => 1 },
    },
    tx: txFn,
    rpc: {
      system: {
        accountNextIndex: async (_addr: string) => ({ toNumber: () => nonce }),
        dryRun: async () => ({ isOk: true }),
      },
      author: {
        submitExtrinsic: async (signedHex: string) => {
          send?.onSubmitExtrinsic?.(signedHex);
          if (send?.submitRejectsWith) throw send.submitRejectsWith;
          return {
            toHex: () =>
              send?.extrinsicHash ?? "0x" + "ed".repeat(32),
          };
        },
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
