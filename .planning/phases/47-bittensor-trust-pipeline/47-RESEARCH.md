# Phase 47: Bittensor native + stake trust pipeline — Research

**Researched:** 2026-06-03
**Domain:** Substrate (subtensor) signing-binding pipeline — unsigned `SignerPayload` SCALE-byte `payloadFingerprint` + ed25519 detached-signature assembly + slippage-guarded dTAO staking
**Confidence:** HIGH (both SDKs + merkleize-metadata installed and type-checked against `.d.ts`; live subtensor RPC probed for the exact signable-blob byte layout, stake-extrinsic params, swap-sim shapes, `author.submitExtrinsic`, and `dryRun` surface; slopcheck [OK] on all four packages)

## Summary

Phase 47 lands the Substrate trust pipeline: native TAO send (`balances.transferKeepAlive`) plus the two DEFAULT slippage-guarded dTAO staking calls (`subtensorModule.add_stake_limit` / `remove_stake_limit`). It mirrors the Solana/TRON sibling-arm precedent exactly — a new chain ADDS sibling files (`payload-fingerprint-bittensor.ts`, `presign-hash-bittensor.ts`, `canonical-dispatch-bittensor.ts`, `simulation-bittensor.ts`), an additive `PreparedTxBittensor` member to the `handle-store.ts` union, and an additive `txType === "bittensor"` arm to `preview_send.ts` + `send_transaction.ts`. The FROZEN cryptographic-binding chain (EVM/Solana/TRON fingerprint + presign modules, the `send_transaction` three-gate region, existing handle-store union members) stays byte-identical.

The single load-bearing probe — **the exact unsigned `SignerPayload` SCALE byte sequence the Ledger signs and that `payloadFingerprint` hashes** — is fully resolved and pinned below (§Probe 1). It is `registry.createType("ExtrinsicPayload", signerPayloadJSON, { version }).toU8a({ method: true })`: the SCALE-encoded `(call ‖ signed-extension extra ‖ additionalSigned)` with NO leading compact-length prefix. This is the Substrate analog of Solana's `serializeMessage()` / TRON's `raw_data_hex`. The byte layout, the `CheckMetadataHash` `mode`/`metadataHash` effect, and the >256-byte device-side blake2-256 rule are all probed and documented.

**Primary recommendation:** Adopt the milestone-locked stack (`@polkadot/api@16.5.6` + `@zondax/ledger-substrate@2.3.4` + `@polkadot/util-crypto@14.0.3`) and ADD `@polkadot-api/merkleize-metadata@1.2.3` to compute the `CheckMetadataHash` digest offline (so the untrusted metadata-shortener service is NOT a fingerprint dependency). Compute `payloadFingerprint = keccak256("VaultPilot-taotx-v1:" ‖ ExtrinsicPayload.toU8a({method:true}))`, recompute the same bytes at send time as the drift gate, present `presignHash = blake2-256(<same signable blob>)` as the device-display hash, sign via `app.signWithMetadataEd25519(path, txBlob, txMetadata)` → 64-byte detached sig → `tx.addSignature(ss58Address, '0x00'+sigHex, signerPayloadRaw)` → broadcast via `api.rpc.author.submitExtrinsic(signedTx.toHex())`. Compute `limit_price` from a tolerance % against the chain's `swapRuntimeApi.simSwapTaoForAlpha` / `simSwapAlphaForTao` expected-out — NEVER client-side x·y=k.

## User Constraints

> No per-phase CONTEXT.md exists (standalone research run). Constraints below are the milestone-level LOCKED decisions from `.planning/ROADMAP.md` v2.7 + the orchestrator-supplied locked decisions. Treat as locked — do NOT re-litigate.

### Locked Decisions (milestone-level — do NOT re-litigate)
- `payloadFingerprint = keccak256("VaultPilot-taotx-v1:" ‖ <unsigned SignerPayload SCALE bytes>)` — binds ONLY the unsigned payload, NEVER the signed envelope.
- presign device-display hash = **blake2-256** (the one divergence from the SHA-256 Solana/TRON siblings — Substrate/Ledger convention).
- `*_limit` slippage-guarded staking is the DEFAULT; `limit_price` derived from a tolerance %, expected-out via the CHAIN (`simSwapTaoForAlpha` / `simSwapAlphaForTao` / `currentAlphaPrice`), NEVER client-side x·y=k.
- `(pallet, call)`-ONLY dispatch allowlist (`BITTENSOR_DISPATCH_ALLOWLIST`): `(subtensorModule, add_stake_limit)`, `(subtensorModule, remove_stake_limit)`, `(balances, transferKeepAlive)`. Arg-level allowlisting deferred.
- Ships even if blind-sign; ed25519 detached-sig assembly via `tx.addSignature('0x00' type-byte + 64-byte sig)`; broadcast via `author.submitExtrinsic`.
- `add_stake` amount = TAO/RAO; `remove_stake` amount = ALPHA (different unit). Per-extrinsic unit typing.
- ed25519 Ledger coldkey via the Polkadot **Generic** app; SS58 prefix **42**; 5-level path `"44'/354'/0'/0'/0'"` (Phase 46 locked).
- Trust integrity is chain-enforced via subtensor's `CheckMetadataHash` (the metadata-shortener service is untrusted-by-construction).

### Claude's Discretion (this phase)
- Whether to ENABLE `CheckMetadataHash` (`mode: 1` + offline-computed `metadataHash`) at prepare time, or ship `mode: 0` (disabled) for v2.7 GA. **Recommendation below (§Probe 1, Decision D-MD).**
- Exact `tolerancePct` default + whether `allow_partial` defaults true/false (recommend below).
- The `state_call` dry-run posture: mandatory-refuse (Solana DF-4 style) vs advisory (EVM style). **Recommendation: advisory** (§Probe 4).
- Whether the device-display hash is blake2-256 over the signable blob vs over the call only (resolved §Probe 5 — over the signable blob, matching what the firmware hashes for >256-byte payloads, with a note).

### Deferred Ideas (OUT OF SCOPE for Phase 47)
- Plain unguarded `add_stake` / `remove_stake` (TAO-W-06 — Phase 48).
- `move_stake` / `swap_stake` / `transfer_stake` (TAO-W-07/08 — Phase 48).
- Arg-level dispatch allowlisting (hotkey/netuid value checks).
- `get_bittensor_setup_status` diagnostic (TAO-DIAG-01 — Phase 49).
- TAO-R-05 validator enrichment (Phase 48).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TAO-PREP-01 | `payloadFingerprint = keccak256("VaultPilot-taotx-v1:" ‖ unsigned SignerPayload SCALE bytes)`; NEW sibling `src/signing/payload-fingerprint-bittensor.ts`; binds ONLY unsigned payload | §Probe 1 (exact bytes = `ExtrinsicPayload.toU8a({method:true})`); §Pattern 1 (sibling mirrors `payload-fingerprint-tron.ts`, 22-byte tag); §Fixtures (TAO-A/B literals) |
| TAO-PREP-02 | `preview_send` Bittensor branch: decoded args + blake2-256 device hash (`presign-hash-bittensor.ts`) + `state_call` dry-run (`simulation-bittensor.ts`) + `(pallet,call)`-only allowlist (`canonical-dispatch-bittensor.ts`) | §Probe 5 (blake2-256 = `blake2AsHex(blob,256)`); §Probe 4 (`api.rpc.system.dryRun` + `api.call.taggedTransactionQueue.validateTransaction`); §Pattern 4 (allowlist mirrors `canonical-dispatch-tron`) |
| TAO-PREP-03 | `send_transaction` Bittensor branch: 3 gates identical + attach detached ed25519 sig (`'0x00'`+64-byte) via `tx.addSignature` + broadcast via `author.submitExtrinsic`; additive `PreparedTxBittensor`; FROZEN three-gate region byte-identical | §Probe 2 (`signWithMetadataEd25519` → `{signature: Buffer}`; `addSignature(signer, sig, payload)`; `author.submitExtrinsic` present); §Pattern 2; §handle-store additive arm |
| TAO-W-01 | `prepare_bittensor_native_send({to, rao})` → `balances.transferKeepAlive`; decimal-string RAO via `parseBittensorAmountStrict` | §Probe 3 (`transferKeepAlive(dest: MultiAddress, value: Compact<u64>)`); §Code (parse mirror of `parseSolanaAmountStrict`) |
| TAO-W-02 | `prepare_bittensor_add_stake_limit({hotkey, netuid, rao, tolerancePct?})` — DEFAULT; `limit_price` via chain expected-out; `amount_staked` = TAO/RAO | §Probe 3 (`addStakeLimit(hotkey: AccountId32, netuid: u16, amountStaked: u64, limitPrice: u64, allowPartial: bool)`); §Probe 6 (`simSwapTaoForAlpha` expected-out + slippage) |
| TAO-W-03 | `prepare_bittensor_remove_stake_limit({hotkey, netuid, alpha, tolerancePct?})` — DEFAULT exit; `amount_unstaked` = ALPHA | §Probe 3 (`removeStakeLimit(..., amountUnstaked: u64, ...)`); §Probe 6 (`simSwapAlphaForTao`); per-extrinsic unit typing |
| TAO-W-04 | 3 `(pallet,call)` pairs in `BITTENSOR_DISPATCH_ALLOWLIST`; netuid→subnet identity echoed; full hotkey SS58 unredacted | §Pattern 4 (`(section, method)` allowlist); §Reads (netuid identity via `getDynamicInfo` from Phase 46) |
| TAO-W-05 | Fixtures TAO-A (native fp), TAO-B (add_stake_limit fp), TAO-C (blake2-256 presign) as `0x…` literals (NO beforeAll-snapshot); FROZEN zero-diff on EVM+Solana+TRON binding modules + three-gate region; blind-sign residual documented | §Fixtures (construction + pinned-input strategy); §Validation Architecture |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Unsigned-extrinsic construction + SCALE serialization | Chain client (`@polkadot/api` registry) | Prepare tool | `api.tx.*` builds the call; `registry.createType("ExtrinsicPayload", ...)` produces the canonical signable bytes. The prepare tool orchestrates; the registry owns the byte layout. |
| `payloadFingerprint` (keccak256 binding) | Signing (`payload-fingerprint-bittensor.ts`) | Prepare + send tools | Pure function over the signable blob; prepare computes, send re-checks (drift gate). Mirror of `payload-fingerprint-tron.ts`. |
| Device-display hash (blake2-256) | Signing (`presign-hash-bittensor.ts`) | Preview tool | Pure function; preview surfaces it in the `LEDGER BLIND-SIGN HASH (Bittensor)` block. Substrate divergence — blake2-256, not SHA-256. |
| `limit_price` from tolerance % | Protocol/read helper (`chains/bittensor/`) | Prepare tool | Expected-out comes from the CHAIN (`swapRuntimeApi.simSwap*`); the prepare tool applies the tolerance haircut. NEVER client-side AMM math. |
| ed25519 detached-sig + assembly | Hardware transport (`wallet/ledger-bittensor-transport.ts`) + send tool | `@polkadot/api` `tx.addSignature` | Device returns the 64-byte sig; `addSignature` assembles the signed envelope; `author.submitExtrinsic` broadcasts. |
| `(pallet,call)` dispatch allowlist | Security (`canonical-dispatch-bittensor.ts`) | Preview tool | Layer 0.5 gate; sibling-set pattern (NON-EVM arm) like `canonical-dispatch-tron`. |
| `state_call` dry-run | Signing (`simulation-bittensor.ts`) | Preview tool | Layer 0.7 classifier (advisory recommended); mockable at the `_bittensorRegistry` boundary. |
| RAO/ALPHA decimal arithmetic | Signing (`amount-bittensor.ts`) | Prepare tool | Strict decimal-string → u64 bigint guard. Mirror of `amount-solana.ts`; per-extrinsic unit labeling. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@polkadot/api` | 16.5.6 | Unsigned-extrinsic builder; `registry.createType("ExtrinsicPayload",...)` for the signable blob; `tx.addSignature`; `api.rpc.author.submitExtrinsic`; `api.call.swapRuntimeApi.*` for expected-out; `api.rpc.system.dryRun` | Canonical Substrate JS client. `[VERIFIED: installed + .d.ts type-check + live RPC probe spec-413]` |
| `@zondax/ledger-substrate` | 2.3.4 | `PolkadotGenericApp.signWithMetadataEd25519(path, txBlob, txMetadata)` → `{signature: Buffer}` (64-byte ed25519 detached) | Zondax maintains the Polkadot Generic Ledger app + JS SDK. `[VERIFIED: installed + .d.ts type-check]` |
| `@polkadot/util-crypto` | 14.0.3 | `blake2AsU8a/blake2AsHex(bytes, 256)` (presign device hash); `encodeAddress`/`decodeAddress` (SS58 prefix 42, reused from Phase 46) | SS58 + blake2 SOT; never hand-roll. `[VERIFIED: installed + round-trip]` |

### Supporting (NEW this phase)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@polkadot-api/merkleize-metadata` | 1.2.3 | Compute the `CheckMetadataHash` digest OFFLINE from `api.call.metadata.metadataAtVersion(15)` + chain props — so the untrusted metadata-shortener service is not a fingerprint dependency | Only if `CheckMetadataHash` is ENABLED (`mode: 1`) at prepare time. See Decision D-MD below. `[VERIFIED: installed + .d.ts + live digest computed]` |

### Supporting (already in the repo — reused, no install)
| Library | Version | Purpose |
|---------|---------|---------|
| `@ledgerhq/hw-transport-node-hid` | repo-pinned 6.32.0 | USB-HID transport injected into `PolkadotGenericApp(transport)`. Dedupe to existing pin (Phase 46 precedent). |
| `viem` | repo-pinned | `keccak256`/`toBytes`/`concat` for the `payloadFingerprint` (same as the EVM/Solana/TRON binding helpers — keccak at the binding layer is uniform across chains). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@polkadot-api/merkleize-metadata` (offline metadata-hash) | Zondax `app.getTxMetadata(blob, chainId, srvUrl)` shortener-service fetch | The shortener service is UNTRUSTED-by-construction (a tampered hash is rejected by the runtime, but it's an availability + a fingerprint-stability dependency). Computing the hash offline removes the network dependency from the prepare flow AND makes the fingerprint deterministic for fixtures. Cherry-pick the offline path. |
| `ExtrinsicPayload.toU8a({method:true})` (the signable blob) | `signerPayload.toRaw().data` (the SignerPayloadRaw `data` hex) | Both are candidate sources; `toRaw().data` is what some signers consume. They encode the SAME bytes for short payloads. RECOMMEND `toU8a({method:true})` because it's the explicit, version-pinned construction (Decision D-BLOB §Probe 1) and matches what `addSignature`'s `payload` arg re-derives. |
| Enable `CheckMetadataHash` (`mode:1`) | Ship `mode:0` (disabled) | See Decision D-MD §Probe 1. |

**Installation:**
```bash
# Milestone-locked core already in package.json (Phase 46 added them):
#   @polkadot/api@16.5.6  @zondax/ledger-substrate@2.3.4  @polkadot/util-crypto@14.0.3
# NEW this phase (only if CheckMetadataHash enabled — Decision D-MD):
npm install @polkadot-api/merkleize-metadata@1.2.3
```

**Version verification (run at execute time):**
```bash
npm view @polkadot/api version                       # 16.5.6
npm view @zondax/ledger-substrate version            # 2.3.4 (re-run slopcheck — fast cadence)
npm view @polkadot/util-crypto version               # 14.0.3
npm view @polkadot-api/merkleize-metadata version    # 1.2.3
```

## Package Legitimacy Audit

> slopcheck ran successfully on the **npm** registry (correct ecosystem for a Node.js phase). All four packages [OK]. No postinstall scripts on the new package.

| Package | Registry | Version | Source Repo | slopcheck | Disposition |
|---------|----------|---------|-------------|-----------|-------------|
| `@polkadot/api` | npm | 16.5.6 | github.com/polkadot-js/api | [OK] | Approved |
| `@polkadot/util-crypto` | npm | 14.0.3 | github.com/polkadot-js/common | [OK] | Approved |
| `@zondax/ledger-substrate` | npm | 2.3.4 | github.com/Zondax/ledger-substrate-js | [OK] | Approved (Phase 46 SUS note resolved — line is established) |
| `@polkadot-api/merkleize-metadata` | npm | 1.2.3 | github.com/polkadot-api/polkadot-api | [OK] | Approved — `scripts.postinstall` empty (verified); maintained by the papi team |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none. `@polkadot-api/merkleize-metadata` is the official polkadot-api (papi) metadata-merkleizer, used by Ledger/Zondax tooling to compute the `CheckMetadataHash` digest. Pin `1.2.3` exactly; re-run slopcheck at execute time.

## Architecture Patterns

### System Architecture Diagram

```
agent (Claude Code / Cursor / Desktop)
   │  stdio (MCP protocol)
   ▼
vaultpilot-mcp
   │
   ├─ prepare_bittensor_native_send / _add_stake_limit / _remove_stake_limit
   │     │ demo-mode FIRST refusal (bittensor persona) ── input validation (SS58 + decimal RAO/ALPHA)
   │     │ pairing check (listAccounts({chainFilter:"bittensor"}))
   │     ▼
   │  src/chains/bittensor/extrinsic-builder.ts
   │     │ _bittensorRegistry.getApi()            [ApiPromise singleton]
   │     │ tx = api.tx.balances.transferKeepAlive(dest, raoValue)
   │     │   OR api.tx.subtensorModule.addStakeLimit(hotkey, netuid, amountStaked, limitPrice, allowPartial)
   │     │ limit_price ← swapRuntimeApi.simSwapTaoForAlpha / simSwapAlphaForTao (CHAIN expected-out − tolerance%)
   │     │ build SignerPayloadJSON (era, nonce, tip, mode, metadataHash, signedExtensions)
   │     │ signableBlob = registry.createType("ExtrinsicPayload", payload, {version}).toU8a({method:true})  ◄── THE PREIMAGE
   │     ▼
   │  payloadFingerprint = keccak256("VaultPilot-taotx-v1:" ‖ signableBlob)   (payload-fingerprint-bittensor.ts)
   │  presignHash        = blake2-256(signableBlob)                            (presign-hash-bittensor.ts)
   │     ▼
   │  createHandle({ args:<raw>, tx: PreparedTxBittensor{ signableBlob, signerPayloadRaw, callHex, section, method, ...}, payloadFingerprint })
   │
   ├─ preview_send (txType==="bittensor" arm)
   │     │ Layer 0.5  canonical-dispatch-bittensor — (section,method) allowlist refusal
   │     │ Layer 0.7  simulation-bittensor — api.rpc.system.dryRun(signedOrUnsigned) [ADVISORY]
   │     │ Layer 1    handle lookup + previewToken mint + recompute blake2-256 presign
   │     │ emit DECODED ARGS (pallet/call + netuid + hotkey + amount LABELED with unit)
   │     │ emit LEDGER BLIND-SIGN HASH (Bittensor) — blake2-256
   │
   └─ send_transaction (txType==="bittensor" arm — additive)
         │ 3 FROZEN gates: schema (previewToken+userDecision) / token-match / fingerprint-drift (recompute over signableBlob)
         ▼
      src/wallet/ledger-bittensor-transport.ts
         │ app.signWithMetadataEd25519(path, signableBlob, txMetadata) → { signature: Buffer (64) }   ◄── DEVICE SIGNS signableBlob
         ▼
      signedTx = tx.addSignature(ss58Address, "0x00"+sigHex, signerPayloadRaw)    [@polkadot/api side]
         │  WSS
         ▼
      api.rpc.author.submitExtrinsic(signedTx.toHex())  → extrinsic hash
         ▼
      wss://entrypoint-finney.opentensor.ai:443  (BITTENSOR_RPC_URL override)
                              ▲
   Ledger device (Polkadot Generic app) ── the only trusted display ── signs the raw signableBlob
   (firmware blake2-256-pre-hashes internally when blob > 256 bytes; see §Probe 5)
```

### Recommended Project Structure (new files this phase)
```
src/signing/
├── payload-fingerprint-bittensor.ts   # TAO-PREP-01 — keccak256("VaultPilot-taotx-v1:" ‖ signableBlob); 22-byte tag; _bittensorFingerprint spy
├── presign-hash-bittensor.ts          # TAO-PREP-02 — blake2-256(signableBlob); _bittensorPresign spy
└── amount-bittensor.ts                # TAO-W-01/02/03 — parseBittensorAmountStrict (RAO + ALPHA, both 9-dec u64); _bittensorAmount spy (or pure, mirror amount-solana.ts)

src/security/
└── canonical-dispatch-bittensor.ts    # TAO-W-04 — (section,method) allowlist; _canonicalDispatchBittensor spy

src/chains/bittensor/
└── extrinsic-builder.ts               # build unsigned tx + signableBlob + limit_price (simSwap); reuses Phase 46 registry.ts singleton

src/wallet/
└── ledger-bittensor-transport.ts      # WIDEN Phase 46 transport: add signWithMetadataEd25519 wrapper; _transport spy (already present)

src/signing/
└── simulation-bittensor.ts            # TAO-PREP-02 — runBittensorPreviewSimulation (api.rpc.system.dryRun classifier); _simulationBittensor spy

src/signing/blocks-bittensor.ts        # PREPARE RECEIPT (native/add/remove) + LEDGER BLIND-SIGN HASH (Bittensor) + DECODED ARGS + VERIFY templates (sibling of blocks-solana.ts/blocks-tron.ts)

src/tools/
├── prepare_bittensor_native_send.ts        # TAO-W-01
├── prepare_bittensor_add_stake_limit.ts    # TAO-W-02
└── prepare_bittensor_remove_stake_limit.ts # TAO-W-03

test/
├── signing-fingerprint-bittensor.test.ts   # TAO-W-05 — Fixtures TAO-A/B (hardcoded 0x literals, NO beforeAll-snapshot)
├── signing-presign-hash-bittensor.test.ts  # Fixture TAO-C (blake2-256 literal)
└── (consumer + integration tests — see Validation Architecture)
```

**Additive seams in existing files (NO frozen body touched):**
- `src/signing/handle-store.ts` — ADD `PreparedTxBittensor` interface + widen `PreparedTx` union + (optional) `BittensorInstructionSummary`. EVM-shape sentinel fields (chainId 0 / zero address / 0n / "0x") follow the Solana/TRON/BTC precedent verbatim. State machine + TTL + transitions BYTE-IDENTICAL.
- `src/tools/preview_send.ts` — ADD `if (txType === "bittensor")` arm (mirror the `=== "tron"` arm at `:807`). The Safe early-return + EVM + Solana + TRON + BTC arms stay byte-identical.
- `src/tools/send_transaction.ts` — ADD a `txType === "bittensor"` branch to the fingerprint-recompute ternary (`:379`–`:421`) + a broadcast arm. The three FROZEN gates (schema/token/drift) are NOT modified — the new arm slots into the existing recompute dispatch additively (exactly the Solana/TRON precedent).
- `src/tools/register-all.ts` — add 3 `import "./prepare_bittensor_*.js"`.

### Pattern 1: keccak256 binding fingerprint over the signable blob (mirror `payload-fingerprint-tron.ts`)
**What:** Pure function. Domain tag `"VaultPilot-taotx-v1:"` (22 UTF-8 bytes — distinct from EVM 23 / Solana 20 / TRON 21) ‖ `signableBlob`, keccak256.
**Example:**
```typescript
// Source: mirror of src/signing/payload-fingerprint-tron.ts (FROZEN sibling); tag length verified below.
import { concat, keccak256, toBytes } from "viem";
import type { Hex } from "viem";

export const FINGERPRINT_DOMAIN_TAG_BITTENSOR = "VaultPilot-taotx-v1:"; // 20 chars? NO — count: "VaultPilot-taotx-v1:" = 20. See note.
// NOTE: "VaultPilot-taotx-v1:" is 20 UTF-8 bytes — IDENTICAL length to Solana's "VaultPilot-soltx-v1:".
// Distinctness is by CONTENT (taotx vs soltx), NOT length. The test asserts the exact string +
// that it differs from every other chain tag. Do NOT assert a unique length (it collides with Solana's 20).
export function computeBittensorPayloadFingerprint(input: { signableBytes: Uint8Array }): Hex {
  const tag = toBytes(FINGERPRINT_DOMAIN_TAG_BITTENSOR);
  return keccak256(concat([tag, input.signableBytes]));
}
export const _bittensorFingerprint = { computeBittensorPayloadFingerprint };
```
**CRITICAL tag-length correction:** `"VaultPilot-taotx-v1:"` is **20 bytes**, SAME as Solana's `"VaultPilot-soltx-v1:"`. The TRON sibling asserts a *unique* byte-length (21); the Bittensor sibling must NOT — assert the exact string value and pairwise-distinctness from the other tags instead (the content `taotx` ≠ `soltx` makes the preimage distinct regardless of equal length). The plan-checker must catch any "unique 22-byte length" assertion as wrong.

### Pattern 2: ed25519 detached-signature assembly (the Substrate divergence)
**What:** Device returns a raw 64-byte ed25519 signature over `signableBlob`. The signed envelope is assembled by `tx.addSignature(signer, '0x00'+sigHex, payload)` where `'0x00'` is the `MultiSignature::Ed25519` variant byte and `payload` is the `SignerPayloadRaw` (or the raw `ExtrinsicPayloadValue`). Broadcast via `author.submitExtrinsic`.
**Example:**
```typescript
// Source: @zondax/ledger-substrate@2.3.4 generic_app.d.ts + @polkadot/types Extrinsic.d.ts:131 (type-checked)
//   signWithMetadataEd25519(path, txBlob, txMetadata): Promise<{ signature: Buffer }>
//   addSignature(signer, signature: Uint8Array|HexString, payload): GenericExtrinsic
//   api.rpc.author.submitExtrinsic(extrinsic): present (verified live)
import { u8aToHex } from "@polkadot/util";

// 1. Device signs the SAME signableBlob that fed the fingerprint (Probe 1 + Probe 2).
const { signature } = await app.signWithMetadataEd25519(
  DEFAULT_BITTENSOR_DERIVATION_PATH,   // "44'/354'/0'/0'/0'"
  signableBlob,                        // Buffer/Uint8Array — the ExtrinsicPayload.toU8a({method:true}) bytes
  txMetadata,                          // metadata-shortener blob (see Decision D-MD)
);                                     // → { signature: Buffer } 64 bytes ed25519

// 2. Assemble the signed extrinsic. '0x00' = MultiSignature::Ed25519 variant byte; signature is 64 bytes.
const sigHex = "0x00" + u8aToHex(signature).slice(2);   // 0x00 ‖ 64-byte sig = 65 bytes
signedTx.addSignature(ss58Address, sigHex as `0x${string}`, signerPayloadRaw);

// 3. Broadcast.
const extrinsicHash = await api.rpc.author.submitExtrinsic(signedTx.toHex());
```
**Note on `txBlob` identity:** the bytes passed to `signWithMetadataEd25519` MUST equal the `signableBlob` that fed `computeBittensorPayloadFingerprint` + the blake2-256 presign (§Probe 2). The device firmware re-derives the signing payload from this blob (and blake2-256-pre-hashes internally if > 256 bytes — §Probe 5); the JS SDK passes the blob raw.

### Pattern 3: limit_price from tolerance % via CHAIN expected-out (NEVER client x·y=k)
**What:** Compute expected-out from the chain's `swapRuntimeApi`, then apply a tolerance haircut to get `limit_price` (a u64 RAO-per-alpha fixed-point). The AMM is concentrated-liquidity — the sim functions return per-call slippage + fee.
**Example:**
```typescript
// Source: live probe (spec 413). simSwapTaoForAlpha(netuid, taoRao) → { taoAmount, alphaAmount, taoFee, alphaFee, taoSlippage, alphaSlippage }
const api = await _bittensorRegistry.getApi();
// add_stake_limit: staking TAO → alpha. limit_price = worst acceptable RAO-per-alpha.
const sim = await api.call.swapRuntimeApi.simSwapTaoForAlpha(netuid, amountStakedRao);
const expectedAlpha = BigInt(sim.alphaAmount.toString());      // alpha out for amountStakedRao
const currentPrice  = BigInt((await api.call.swapRuntimeApi.currentAlphaPrice(netuid)).toString());
// limit_price = currentPrice * (1 + tolerancePct) for add (willing to pay up to this per alpha),
//             OR derive from expected-out depending on the extrinsic's limit_price semantic.
// EXECUTE-TIME: confirm whether subtensor's add_stake_limit limit_price is "max price per alpha"
// vs "min alpha out" — read the pallet doc / a known on-chain extrinsic (Open Question OQ-1).
const limitPrice = (currentPrice * BigInt(10000 + tolerancePctBps)) / 10000n;
```
**Concentrated-liquidity confirmation:** `simSwapTaoForAlpha(1, 1 TAO)` returned `alphaAmount: 101,647,804,216` with `alphaSlippage: 54,860,440` and `taoFee: 503,547` — a non-constant-product curve with per-trade slippage + fee. `x·y=k` would not reproduce these. Always use the sim functions.

### Pattern 4: (pallet, call)-only dispatch allowlist (sibling-set, NON-EVM arm — mirror `canonical-dispatch-tron`)
**What:** A frozen `ReadonlySet` of `"section.method"` strings; the check rejects any extrinsic whose `(section, method)` is not present. Arg-level checks (hotkey/netuid values) are explicitly deferred.
**Example:**
```typescript
// Source: mirror of src/security/canonical-dispatch-tron.ts sibling-set pattern (NON-EVM arm).
export const BITTENSOR_DISPATCH_ALLOWLIST: ReadonlySet<string> = new Set([
  "subtensorModule.addStakeLimit",
  "subtensorModule.removeStakeLimit",
  "balances.transferKeepAlive",
]);
export type BittensorDispatchCheckResult =
  | { kind: "allowed" }
  | { kind: "refused"; offender: string; allowlist: string[] };
export function checkBittensorDispatch(section: string, method: string): BittensorDispatchCheckResult {
  const key = `${section}.${method}`;
  if (BITTENSOR_DISPATCH_ALLOWLIST.has(key)) return { kind: "allowed" };
  return { kind: "refused", offender: key, allowlist: [...BITTENSOR_DISPATCH_ALLOWLIST] };
}
export const _canonicalDispatchBittensor = { checkBittensorDispatch };
```
**Note on the camelCase/snake_case duality:** `api.tx.subtensorModule.addStakeLimit` (JS camelCase) maps to the on-chain `add_stake_limit` (snake_case). The allowlist key must use the form the preview arm reads from `record.tx`. Store BOTH `section`/`method` in camelCase on `PreparedTxBittensor` (matching `api.tx.<section>.<method>`) and key the allowlist in camelCase. Echo the snake_case form in the user-facing receipt for clarity. Pin both in a test.

### Anti-Patterns to Avoid
- **Hashing `signedTx.toU8a()` (the signed envelope) for `payloadFingerprint`.** The signed envelope includes the signature — it would change post-sign and break the prepare→send drift gate. Hash ONLY the unsigned `signableBlob` (Probe 1). This is the exact Solana `serializeMessage()` / TRON `raw_data_hex` discipline.
- **Asserting a unique 22-byte tag length.** `"VaultPilot-taotx-v1:"` is 20 bytes — collides with Solana's length. Assert content + pairwise-distinctness (Pattern 1 correction).
- **Client-side `x·y=k` for `limit_price`.** The dTAO AMM is concentrated-liquidity; use `swapRuntimeApi.simSwap*` (Pattern 3).
- **Fetching the metadata hash from the shortener service at prepare time.** Compute it offline via `merkleize-metadata` (Decision D-MD) so the fingerprint is deterministic and the untrusted service is not a prepare-flow dependency.
- **Re-fetching nonce/era/blockhash between prepare and send.** Pin the entire `SignerPayloadJSON` (nonce, era, blockHash, tip, mode, metadataHash) at prepare time so the `signableBlob` is byte-stable prepare→preview→send (mirror the Solana `recentBlockhash` + TRON `refBlock` pinning discipline).
- **Passing different bytes to the device than fed the fingerprint.** `signWithMetadataEd25519`'s `txBlob` MUST equal the fingerprint preimage's `signableBlob` (Pattern 2 note).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unsigned-extrinsic SCALE serialization | Manual SCALE codec for call + signed-extensions | `registry.createType("ExtrinsicPayload", payload, {version}).toU8a({method:true})` | The signed-extension tuple (13 extensions for subtensor) + `additionalSigned` ordering is metadata-driven and churns across runtime upgrades. The registry is the authoritative encoder. |
| `CheckMetadataHash` digest | Manual merkleized-metadata tree | `@polkadot-api/merkleize-metadata` `merkleizeMetadata(metaV15, props).digest()` | The merkle-ization spec (RFC-46) is intricate; a wrong digest is rejected by the runtime (hard failure) or — worse — produces a fingerprint that won't reproduce. Use the maintained library. |
| ed25519 detached-sig → signed envelope | Manual `MultiSignature` enum encode + extrinsic re-serialize | `tx.addSignature(signer, '0x00'+sig, payload)` | `addSignature` handles the `MultiSignature::Ed25519` variant byte, the extrinsic version byte, the address `MultiAddress` encoding, and the signed-extension extra re-packing. |
| limit_price expected-out | Client `x·y=k` from reserves | `swapRuntimeApi.simSwapTaoForAlpha` / `simSwapAlphaForTao` | Concentrated-liquidity AMM; constant-product gives wrong prices (Pattern 3). |
| blake2-256 device hash | Custom blake2 | `@polkadot/util-crypto blake2AsU8a(bytes, 256)` | Verified 32-byte output; matches what the Substrate firmware hashes for >256-byte payloads. |
| RAO/ALPHA decimal parse | `Number(x)/1e9` | bigint string math (mirror `parseSolanaAmountStrict`, u64 cap) | `Number` loses precision; both RAO and ALPHA are u64. Per-extrinsic unit labeling prevents the off-by-unit class. |

**Key insight:** the unsigned-payload byte layout is metadata-driven and runtime-version-specific. Pin the construction to the registry `createType` path and re-introspect `api.tx.<section>.<method>.meta.args` at execute time before trusting any param order.

## Runtime State Inventory

> Phase 47 is additive greenfield on top of Phase 46's read/pair scaffolding. No rename/refactor. State touched:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | The in-memory handle store gains `PreparedTxBittensor` records (TTL 15 min, no persistence). Cache `non-evm-accounts.json` already accommodates `chain:"bittensor"` (Phase 46). | Code-only: additive union member. No data migration. |
| Live service config | The metadata-shortener service (`txMetadataSrvUrl`) — IF the shortener-fetch path is used instead of offline merkleize. RECOMMEND offline (Decision D-MD) → no service dependency. | None if offline; if shortener used, document `BITTENSOR_TX_METADATA_SRV_URL` + `txMetadataChainId` env (untrusted-by-construction). |
| OS-registered state | None. | None — verified: no Task Scheduler / pm2 / systemd registration in this codebase. |
| Secrets/env vars | NO new secret. Optional `BITTENSOR_RPC_URL` (Phase 46) reused. IF shortener used: `BITTENSOR_TX_METADATA_SRV_URL` + chain-id (non-secret). | Code-only env readers if applicable. |
| Build artifacts | `@polkadot-api/merkleize-metadata` adds to `package.json`. The v1.4 `pkg` binary `assets` allowlist may need the new CJS/ESM path (Phase 46 flagged the same for `@polkadot/*`/`@zondax/*`). | Flag for the planner IF the binary build is in scope (likely a separate verify-phase). |

**Nothing found requiring data migration.** The handle-store widening is the documented Solana/TRON/BTC/LTC precedent (each slotted a new `PreparedTx*` member with sentinel EVM fields).

## Common Pitfalls

### Pitfall 1: Hashing the wrong bytes for the fingerprint
**What goes wrong:** Hashing `signedTx.toU8a()`, `tx.toHex()`, or `tx.method.toHex()` (call-only) instead of the full `ExtrinsicPayload.toU8a({method:true})` signable blob.
**Why it happens:** Several `@polkadot/api` accessors look plausible; the call-only hash even matches what some explorers show.
**How to avoid:** Use `registry.createType("ExtrinsicPayload", signerPayloadJSON, { version }).toU8a({method:true})` (Probe 1 — Decision D-BLOB). Pin Fixture TAO-A/B literals computed from this exact path.
**Warning signs:** The send-time drift gate fires spuriously; or the device-display hash doesn't match the on-device blake2 (because the device signs the full payload, not the call).

### Pitfall 2: `CheckMetadataHash` mode/hash drift between prepare and send
**What goes wrong:** Prepare builds the blob with `mode:0`/`metadataHash:null`; send (or the device) expects `mode:1` + a real hash, or vice versa → the appended `additionalSigned` bytes differ → fingerprint drift AND/OR the runtime rejects the broadcast.
**Why it happens:** `mode` and `metadataHash` are part of the signable blob's `additionalSigned` tail (Probe 1 — the mode=1 blob ends with `01`‖32-byte hash; mode=0 omits it).
**How to avoid:** Pick ONE mode at prepare time (Decision D-MD), pin `mode`+`metadataHash` onto `PreparedTxBittensor`, and rebuild the identical blob at send. Compute the hash offline so it's deterministic.
**Warning signs:** Broadcast rejected with `BadProof` / metadata-hash-mismatch; or fingerprint drift only when the chain metadata changes.

### Pitfall 3: TAO vs ALPHA unit confusion in the staking extrinsics
**What goes wrong:** Passing alpha into `add_stake_limit.amountStaked` (which is TAO/RAO) or TAO into `remove_stake_limit.amountUnstaked` (which is ALPHA).
**Why it happens:** Both are u64, both 9-decimal — visually interchangeable.
**How to avoid:** Per-extrinsic unit typing. `add_stake_limit.amountStaked` is TAO/RAO; `remove_stake_limit.amountUnstaked` is ALPHA. Label the unit in the PREPARE RECEIPT and in `parseBittensorAmountStrict` call sites. One field never accepts both.
**Warning signs:** A stake amount off by the subnet's alpha price (often ~100×).

### Pitfall 4: SDK console noise crossing into stdout
**What goes wrong:** `ApiPromise.create` without `noInitWarn:true` prints "Unknown signed extensions" (subtensor has `SubtensorTransactionExtension`, `DrandPriority`, `CheckShieldedTxValidity`, `SudoTransactionExtension`) → corrupts the MCP stdout stream.
**Why it happens:** subtensor declares 5 custom signed extensions the generic registry doesn't recognize.
**How to avoid:** `noInitWarn:true` (Phase 46 already does this in `registry.ts`). Reuse the Phase 46 singleton. CLAUDE.md stderr-for-diagnostics discipline.
**Warning signs:** Client JSON-parse errors after the first Bittensor tool call.

### Pitfall 5: nonce/era not pinned → unstable blob
**What goes wrong:** `signAsync` (or a re-build at send) re-fetches nonce/era/blockHash → the `signableBlob` differs from prepare → fingerprint drift + a device hash the user can't pre-verify.
**Why it happens:** The default signing path queries chain state for nonce/era.
**How to avoid:** Resolve nonce (`api.rpc.system.accountNextIndex`), era (mortal or immortal), and the era block hash at PREPARE time; pin the entire `SignerPayloadJSON` onto the handle; rebuild the byte-identical blob at send.
**Warning signs:** Fingerprint drift even with no agent tampering; the device shows a hash the preview didn't predict.

## Code Examples

### parseBittensorAmountStrict (RAO + ALPHA, u64 cap — mirror `parseSolanaAmountStrict`)
```typescript
// Source: mirror of src/signing/amount-solana.ts (decimals=9 for both TAO/RAO and ALPHA; u64 cap).
// Per-extrinsic unit labeling lives at the CALL SITE, not in this pure parser.
const U64_MAX = (1n << 64n) - 1n;
export function parseBittensorAmountStrict(amountStr: string, decimals = 9): bigint {
  if (!amountStr.trim()) throw new InvalidAmountError("amount cannot be empty", "empty");
  if (!/^[0-9]+(\.[0-9]+)?$/.test(amountStr)) throw new InvalidAmountError(`bad format: ${amountStr}`, "format");
  const dot = amountStr.indexOf(".");
  const whole = dot === -1 ? amountStr : amountStr.slice(0, dot);
  const frac  = dot === -1 ? "" : amountStr.slice(dot + 1);
  if (frac.length > decimals) throw new InvalidAmountError(`>${decimals} frac digits`, "fractional-overflow");
  const scaled = BigInt(whole + frac.padEnd(decimals, "0"));
  if (scaled > U64_MAX) throw new InvalidAmountError(`exceeds u64`, "u64-overflow");
  return scaled;
}
```

### Offline CheckMetadataHash digest (only if mode:1 — Decision D-MD)
```typescript
// Source: @polkadot-api/merkleize-metadata@1.2.3 + live probe (subtensor props: ss58=42, decimals=9, symbol=TAO).
import { merkleizeMetadata } from "@polkadot-api/merkleize-metadata";
import { u8aToHex } from "@polkadot/util";
const metadataV15 = await api.call.metadata.metadataAtVersion(15);
const props = api.registry.getChainProperties();
const merk = merkleizeMetadata(metadataV15.unwrap().toHex(), {
  base58Prefix: props.ss58Format.unwrap().toNumber(),     // 42
  decimals: props.tokenDecimals.unwrap()[0].toNumber(),   // 9
  tokenSymbol: props.tokenSymbol.unwrap()[0].toString(),  // "TAO"
});
const metadataHash = u8aToHex(merk.digest());             // → 0xf398d4… (probed live; changes per runtime upgrade)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zondax `app.sign()` / `signWithMetadata()` (non-suffixed) | `signWithMetadataEd25519(path, blob, metadata)` | `@zondax/ledger-substrate` 2.x | Non-suffixed variants are `@deprecated` in 2.3.4 (verified in `.d.ts`). Use the `*Ed25519` variant for the ed25519 coldkey. |
| Pre-RFC-46 (no `CheckMetadataHash`) | `CheckMetadataHash` signed-extension + offline merkleized metadata | Polkadot RFC-46 / Ledger Generic app | subtensor carries `CheckMetadataHash` in its extension tuple (verified live). The metadata-shortener service is untrusted-by-construction; the runtime rejects a wrong hash. |
| Client-fetched metadata-shortener hash | Offline `@polkadot-api/merkleize-metadata` digest | papi tooling | Removes the network dependency from prepare; makes the fingerprint deterministic for fixtures (Decision D-MD). |

**Deprecated/outdated (do not use):**
- `SCHEME.SR25519` — deprecated; the Ledger coldkey is ed25519.
- `app.sign` / `app.signRaw` / `app.signWithMetadata` (non-suffixed) — deprecated in 2.3.4.
- Shortener-service fetch as the ONLY metadata-hash path — prefer offline merkleize.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `add_stake_limit.limitPrice` semantic is "max RAO-per-alpha price" (so tolerance = price ceiling). | Pattern 3 / OQ-1 | MEDIUM — params confirmed (`limitPrice: u64`), but the WORST-acceptable direction (max-price vs min-out) must be confirmed against the subtensor pallet doc or a known on-chain extrinsic at execute time. A wrong direction inverts the slippage guard. |
| A2 | The device signs the raw `signableBlob` (firmware blake2-256-pre-hashes internally for >256-byte blobs); the JS SDK passes it raw. | Probe 2/5 | LOW — `getSignReqChunks` passes `txBlob` raw (verified in JS source); the >256 firmware rule is the documented Substrate signing convention. Confirm the on-device displayed hash equals `blake2AsHex(blob,256)` at the real-Ledger verify-phase. |
| A3 | `mode:0` (CheckMetadataHash disabled) is accepted by the subtensor runtime for v2.7 GA (so shipping without the offline merkleize is viable). | Decision D-MD | MEDIUM — `mode:0` builds a valid blob (probed), but whether the live runtime ACCEPTS a mode:0 broadcast (vs requiring the hash) is a node-policy question. Confirm by a testnet/mainnet small broadcast at the verify-phase. RECOMMEND mode:1 to be safe. |
| A4 | `api.rpc.system.dryRun(extrinsicHex)` works for an UNSIGNED extrinsic (Layer 0.7 advisory). | Probe 4 / OQ-2 | MEDIUM — `dryRun` + `taggedTransactionQueue.validateTransaction` both present, but dryRun typically wants a signed extrinsic; an unsigned dry-run may need `validateTransaction` instead. Confirm the exact unsigned-dry-run call at execute time; advisory posture means a failure here does not block. |
| A5 | `tx.addSignature(ss58Address, '0x00'+sig, signerPayloadRaw)` accepts the SS58 string as `signer` and the `SignerPayloadRaw` as `payload`. | Pattern 2 | LOW — `.d.ts` shows `signer: Address|Uint8Array|string` and `payload: ExtrinsicPayloadValue|Uint8Array|HexString`. Confirm whether `payload` should be the raw `ExtrinsicPayloadValue` object or the `signerPayload.toRaw().data` hex at execute time (both are accepted types; pick the one that reproduces the byte-identical envelope). |

## Open Questions

1. **`limit_price` direction (max-price vs min-out) for `add_stake_limit` / `remove_stake_limit`.**
   - What we know: params are `(hotkey, netuid, amountStaked/amountUnstaked: u64, limitPrice: u64, allowPartial: bool)`; `swapRuntimeApi.simSwapTaoForAlpha`/`simSwapAlphaForTao` give expected-out + slippage.
   - What's unclear: whether `limitPrice` is "max RAO-per-alpha you'll pay" (add) / "min RAO-per-alpha you'll accept" (remove), and the fixed-point scale relative to `currentAlphaPrice`.
   - Recommendation: at execute time, read the subtensor pallet doc + reconcile `limitPrice` against `currentAlphaPrice(netuid)` for one live position; pin the direction + scale as a documented constant. Pre-flight a tiny mainnet `add_stake_limit` at the verify-phase.

2. **Unsigned dry-run call for Layer 0.7.**
   - What we know: `api.rpc.system.dryRun` + `api.call.taggedTransactionQueue.validateTransaction` both present.
   - What's unclear: which accepts an UNSIGNED extrinsic vs requires a signed one.
   - Recommendation: ADVISORY posture (EVM style, not Solana DF-4 mandatory) — a dry-run failure surfaces a CHECKS PERFORMED warning but does NOT refuse preview, since the chain-enforced `CheckMetadataHash` + the on-device hash match are the real anchors. Confirm the exact call at execute time; mockable at `_bittensorRegistry`.

3. **Mode decision (D-MD): ship `mode:0` or `mode:1`.**
   - What we know: both build valid blobs; subtensor carries `CheckMetadataHash`; the device's `signWithMetadataEd25519` wants a `txMetadata` blob.
   - What's unclear: whether mainnet accepts mode:0; whether the Generic app refuses to sign mode:0.
   - Recommendation: **mode:1 with offline-computed metadataHash + the offline metadata blob for `txMetadata`.** This matches the Ledger Generic-app expectation (clear-sign needs the metadata), keeps the metadata-shortener service out of the trust path, and is the safest for the verify-phase. Treat the offline-vs-shortener choice as the one open infra decision; the fingerprint is deterministic either way once `metadataHash` is pinned.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | ≥18.17 | — |
| `@polkadot/api` | extrinsic build + broadcast | ✓ (probe) | 16.5.6 | — |
| `@zondax/ledger-substrate` | ed25519 sign | ✓ (probe) | 2.3.4 | — |
| `@polkadot/util-crypto` | blake2-256 presign | ✓ (probe) | 14.0.3 | — |
| `@polkadot-api/merkleize-metadata` | offline metadata-hash (mode:1) | ✓ (probe + slopcheck OK) | 1.2.3 | shortener-service fetch (untrusted-by-construction) |
| subtensor RPC `wss://entrypoint-finney.opentensor.ai:443` | build/broadcast/dryRun/sim | ✓ (spec 413, probed) | — | `BITTENSOR_RPC_URL` override |
| Physical Ledger + Polkadot Generic app | sign integration | ✗ (verify-phase only) | — | `_transport` spy for unit tests; fixtures pinned from offline byte construction |

**Missing dependencies with no fallback:** none for unit-testable scope. The physical-Ledger sign path is exercised only at the v2.7 real-Ledger verify-phase (consistent with Solana/TRON).

**Execute-time fixture-capture items (sandbox can't sign on a real device):**
- The 64-byte ed25519 device signature is captured ONLY at the verify-phase. Unit tests assert the ASSEMBLY (`addSignature('0x00'+<known 64-byte vector>, ...)` produces a well-formed signed extrinsic) using a synthetic/known signature, NOT a real device sig.
- The `signableBlob` byte layout + fingerprint + blake2 presign are FULLY offline-derivable → pin TAO-A/B/C as hardcoded literals now (the high-value gate is unblocked).
- The exact `metadataHash` (mode:1) changes per runtime upgrade → if pinned in a fixture, re-capture on a spec bump; OR pin a mode:0 fixture for byte-stability and a mode:1 fixture flagged "recompute on spec bump".

## Validation Architecture

> Nyquist validation ENABLED (`workflow.nyquist_validation: true` in config). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (repo-standard) |
| Config file | repo root (existing vitest setup) |
| Quick run command | `npx vitest run test/signing-fingerprint-bittensor.test.ts test/signing-presign-hash-bittensor.test.ts --no-coverage` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TAO-PREP-01 / TAO-W-05 | Fixture TAO-A (native fp) + TAO-B (add_stake_limit fp) hardcoded `0x` literals over `ExtrinsicPayload.toU8a({method:true})`; +1-unit regression proves amount is in preimage; tag content+distinctness; `_bittensorFingerprint` spy | unit (pure) | `npx vitest run test/signing-fingerprint-bittensor.test.ts` | ❌ Wave 0 |
| TAO-PREP-02 / TAO-W-05 | Fixture TAO-C (blake2-256 presign) literal over the SAME signable blob; `_bittensorPresign` spy | unit (pure) | `npx vitest run test/signing-presign-hash-bittensor.test.ts` | ❌ Wave 0 |
| TAO-PREP-02 | `(section,method)` allowlist: 3 allowed pairs pass, any other refuses; camelCase keying pinned | unit (pure) | `npx vitest run test/security-canonical-dispatch-bittensor.test.ts` | ❌ Wave 0 |
| TAO-PREP-02 | `state_call`/`dryRun` classifier never-throws; RPC failure → advisory (not refusal) | unit (spy `_bittensorRegistry`) | `npx vitest run test/simulation-bittensor.test.ts` | ❌ Wave 0 |
| TAO-W-01 | `prepare_bittensor_native_send` demo-FIRST refusal; PREPARE RECEIPT verbatim RAO; fingerprint = Fixture TAO-A; pairing gate | unit (spy `_bittensorRegistry`, `_transport`) | `npx vitest run test/prepare-bittensor-native-send.test.ts` | ❌ Wave 0 |
| TAO-W-02 | `prepare_bittensor_add_stake_limit`: limit_price from `simSwapTaoForAlpha` (mocked) − tolerance; amount labeled TAO/RAO; fingerprint = Fixture TAO-B | unit (mock runtime API) | `npx vitest run test/prepare-bittensor-add-stake-limit.test.ts` | ❌ Wave 0 |
| TAO-W-03 | `prepare_bittensor_remove_stake_limit`: amount labeled ALPHA (distinct unit); limit_price from `simSwapAlphaForTao` | unit (mock runtime API) | `npx vitest run test/prepare-bittensor-remove-stake-limit.test.ts` | ❌ Wave 0 |
| TAO-PREP-03 | `send_transaction` Bittensor arm: 3 gates enforced; fingerprint-drift refusal; `addSignature('0x00'+<known sig>)` assembles well-formed envelope; `author.submitExtrinsic` called (mocked) | integration (spy registry + transport) | `npx vitest run test/bittensor-trust-pipeline.integration.test.ts` | ❌ Wave 0 |
| TAO-W-05 | FROZEN zero-diff: EVM+Solana+TRON fingerprint/presign modules + `send_transaction` three-gate region byte-identical to origin/main | unit (git diff) | `npx vitest run test/signing-fingerprint-bittensor.test.ts` (FROZEN describe block) | ❌ Wave 0 |
| Real-Ledger small mainnet stake (on-device blake2 hash match) | manual | v2.7 verify-phase | N/A (physical device) | — |

### Sampling Rate
- **Per task commit:** `npx vitest run test/signing-fingerprint-bittensor.test.ts test/signing-presign-hash-bittensor.test.ts test/prepare-bittensor-*.test.ts test/security-canonical-dispatch-bittensor.test.ts --no-coverage`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** full suite green before `/gsd-verify-work`; FROZEN-area zero-diff asserted (the EVM/Solana/TRON binding modules + the `send_transaction` three-gate region are NOT touched — assert byte-identity).

### Wave 0 Gaps
- [ ] `test/signing-fingerprint-bittensor.test.ts` — Fixtures TAO-A/B + tag invariants + FROZEN zero-diff describe block (covers TAO-PREP-01, TAO-W-05)
- [ ] `test/signing-presign-hash-bittensor.test.ts` — Fixture TAO-C blake2-256 (covers TAO-PREP-02)
- [ ] `test/security-canonical-dispatch-bittensor.test.ts` — allowlist (covers TAO-W-04)
- [ ] `test/simulation-bittensor.test.ts` — dry-run classifier (covers TAO-PREP-02)
- [ ] `test/prepare-bittensor-{native-send,add-stake-limit,remove-stake-limit}.test.ts` — prepare tools (TAO-W-01/02/03)
- [ ] `test/bittensor-trust-pipeline.integration.test.ts` — full prepare→preview→send + assembly (TAO-PREP-03)
- [ ] Shared mock `ApiPromise` fixture: returns the probed `addStakeLimit.meta.args`, `simSwapTaoForAlpha`/`simSwapAlphaForTao` envelopes, `accountNextIndex`, and an `ExtrinsicPayload` builder. Derive shapes from THIS research's probe outputs, not hand-typed — re-capture if the SDK or spec pins bump.

## Security Domain

> `security_enforcement: true`. Phase 47 IS the signing-binding — this is the load-bearing security phase for v2.7.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface; signing is on-device. |
| V3 Session Management | no | The handle store is in-memory, TTL-bounded, no credentials. |
| V4 Access Control | no | The Ledger is the sole signing authority; no server-side key. |
| V5 Input Validation | yes | SS58 hotkey/dest via `decodeAddress` (prefix-42 checksum); strict decimal RAO/ALPHA via `parseBittensorAmountStrict`; `(section,method)` allowlist; netuid u16 range. |
| V6 Cryptography | yes (validate, never hand-roll) | keccak256 (viem), blake2-256 (`@polkadot/util-crypto`), ed25519 (Ledger SE + `addSignature`). NO custom crypto. NO private key ever in this codebase. |
| V7 Error Handling / Logging | yes | stderr-for-diagnostics; `noInitWarn:true` keeps SDK noise off stdout; structured refusals on every gate. |

### Known Threat Patterns for the Substrate signing stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Compromised MCP/agent alters the unsigned payload between prepare and send | Tampering | `payloadFingerprint` over the unsigned signable blob, recomputed at send (drift gate); on-device blake2-256 hash match is the final anchor. |
| Tampered metadata-shortener service yields a wrong hash | Tampering | Chain-enforced `CheckMetadataHash` — runtime rejects a mismatched hash (`BadProof`). Service is untrusted-by-construction; offline merkleize removes it from the prepare path entirely. |
| Non-allowlisted extrinsic smuggled through (e.g. `sudo`, `swapColdkey`) | Elevation of privilege | Layer 0.5 `(section,method)`-only `BITTENSOR_DISPATCH_ALLOWLIST` refusal at preview. |
| Signed envelope re-broadcast / replay | Tampering | `CheckMortality` (era) + `CheckNonce` in the signed-extension tuple bind the extrinsic to a block window + nonce; mortal era pinned at prepare. |
| Slippage/sandwich on the dTAO AMM | Tampering | `*_limit` slippage-guarded calls are the DEFAULT; `limit_price` from chain expected-out − tolerance. |
| Demo-mode signing of a real device | Misuse | Demo-mode FIRST refusal in each `prepare_bittensor_*` BEFORE transport open (Solana/TRON precedent). |
| Off-by-unit (TAO vs ALPHA) | Tampering / user error | Per-extrinsic unit typing + labeled PREPARE RECEIPT. |
| SDK console noise corrupting MCP stdout | Denial of service (protocol break) | `noInitWarn:true` + stderr discipline. |

**Ship-with-blind-sign residual risk (document in SECURITY.md, TAO-W-05):** the Polkadot Generic app may blind-sign (display only a hash) for `add_stake_limit`/`remove_stake_limit` if its clear-sign metadata coverage lacks these calls. Consistent with how Solana/TRON shipped blind-sign. The `(section,method)` allowlist + the on-device hash match + chain-enforced `CheckMetadataHash` are the compensating controls.

## Sources

### Primary (HIGH confidence)
- `@zondax/ledger-substrate@2.3.4` installed `dist/generic_app.d.ts` + `dist/common.d.ts` + `dist/generic_app.js` — `signWithMetadataEd25519(path, txBlob, txMetadata) → {signature: Buffer}`; `getSignReqChunks` passes `txBlob` raw (no JS pre-hash); `getTxMetadata` POSTs the blob to the shortener; `_params {chunkSize:250, requiredPathLengths:[5], cla:0xf9}`; non-suffixed `sign`/`SR25519` deprecated.
- `@polkadot/types` (via `@polkadot/api@16.5.6`) `extrinsic/Extrinsic.d.ts:131` — `addSignature(signer, signature, payload)`; `extrinsic/ExtrinsicPayload.d.ts` — `toU8a(isBare?)`; `extrinsic/SignerPayload.d.ts` — `toRaw(): SignerPayloadRaw`, `toPayload()`, the 14-field `SignerPayloadType` incl. `mode` + `metadataHash`.
- Live subtensor RPC `wss://entrypoint-finney.opentensor.ai:443` (node-subtensor **spec 413**, probed 2026-06-03): exact signable blob (`toU8a({method:true})`, mode:0 = 117 bytes, mode:1 = 149 bytes with `01`‖32-byte-hash tail); 13-extension `signedExtensions` tuple incl. `CheckMetadataHash`; `addStakeLimit(hotkey: AccountId32, netuid: u16, amountStaked: u64, limitPrice: u64, allowPartial: bool)` + `removeStakeLimit(... amountUnstaked: u64 ...)`; `balances.transferKeepAlive(dest: MultiAddress, value: Compact<u64>)`; `swapRuntimeApi.{currentAlphaPrice, simSwapTaoForAlpha, simSwapAlphaForTao}` envelopes; `api.rpc.author.submitExtrinsic` present; `api.rpc.system.dryRun` + `taggedTransactionQueue.validateTransaction` present; chain props ss58=42 / decimals=9 / symbol=TAO.
- `@polkadot-api/merkleize-metadata@1.2.3` installed `dist/index.d.ts` + live digest — `merkleizeMetadata(metaV15Hex, {base58Prefix, decimals, tokenSymbol}).digest()` → `0xf398d4…`; no postinstall.
- `@polkadot/util-crypto@14.0.3` `blake2/asU8a.d.ts` — `blake2AsU8a(data, 256)` → 32 bytes; live `blake2AsHex(blob, 256)` verified.
- Repo source: `src/signing/{payload-fingerprint-tron,presign-hash-tron,payload-fingerprint-solana,presign-hash-solana,amount-solana,simulation-solana,handle-store}.ts`; `src/security/canonical-dispatch-tron.ts`; `src/tools/{prepare_solana_native_send,preview_send,send_transaction}.ts`; `src/signing/blocks-solana.ts`; `test/signing-fingerprint-solana.test.ts` — the exact sibling-arm patterns mirrored.
- Phase 46 research `46-RESEARCH.md` — registry singleton, SS58 prefix 42, 5-level path, `noInitWarn`, runtime-API read surface, `CheckMetadataHash` wire confirmation.

### Secondary (MEDIUM confidence)
- Polkadot RFC-46 / Ledger Generic-app metadata-hash convention (the offline-merkleize rationale).

### Tertiary (LOW confidence — flagged for execute-time verification)
- `limit_price` direction + fixed-point scale (OQ-1, A1).
- Unsigned dry-run exact call (OQ-2, A4).
- mode:0 mainnet acceptance (D-MD, A3).
- `addSignature` `payload` arg form (raw value vs `toRaw().data` hex) (A5).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all four packages installed, type-checked, slopcheck [OK]; new package's postinstall verified empty.
- The signable-blob byte layout (Probe 1) + ed25519 assembly (Probe 2) + stake params (Probe 3): HIGH — probed against the live chain + `.d.ts`.
- limit_price direction + dry-run posture + mode decision: MEDIUM — methods/shapes confirmed; semantic direction + node-policy acceptance to confirm at execute/verify time (OQ-1/2, D-MD).
- Fixtures: HIGH for offline-derivable TAO-A/B/C; the real device signature is a verify-phase capture (assembly tested with a synthetic sig).

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (30 days; `@zondax/ledger-substrate` fast cadence + subtensor spec churn — re-verify versions, re-run slopcheck, and re-introspect `api.tx.subtensorModule.*.meta.args` at execute time; `@polkadot/api` 16.x stable).
