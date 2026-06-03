# Phase 48: Bittensor subnet/dTAO depth — deferred staking variants — Research

**Researched:** 2026-06-03
**Domain:** subtensor staking-extrinsic breadth (plain `add_stake`/`remove_stake`, same-owner `move_stake`/`swap_stake`, custody-changing `transfer_stake`) + validator-enrichment reads (delegate identity + commission + per-netuid registration)
**Confidence:** HIGH — the 5 exact extrinsic param signatures + the move/swap/transfer custody distinction are confirmed against the authoritative subtensor pallet Rust source (`pallets/subtensor/src/macros/dispatches.rs`) AND the Bittensor SDK pallet-helper docs; the binding/builder/allowlist mechanics are SHIPPED (Phase 47, merged on this branch's base) and reused as-is. The one MEDIUM item is the TAO-R-05 identity/registration read path (the runtime-API surface is confirmed, the exact `IdentitiesV2` decode shape is fixture-at-execute).

## Summary

Phase 48 is a BREADTH extension. Phase 47 shipped and merged the entire Substrate trust pipeline: the keccak256 binding (`computeBittensorPayloadFingerprint` over `ExtrinsicPayload.toU8a({method:true})`), the blake2-256 device presign, the `extrinsic-builder.ts` unsigned-tx construction, the `(section,method)` `BITTENSOR_DISPATCH_ALLOWLIST`, the prepare-tool shape, and the `preview_send`/`send_transaction` Bittensor arms. NONE of that is re-derived here. The five new tools (`prepare_bittensor_add_stake`, `_remove_stake`, `_move_stake`, `_swap_stake`, `_transfer_stake`) are mechanical clones of the shipped `prepare_bittensor_add_stake_limit` / `_remove_stake_limit`, differing ONLY in: (1) the extrinsic param shape passed to `api.tx.subtensorModule.*`, (2) the `BittensorInstructionSummary` discriminant + the `preview_send` DECODED-ARGS arm, (3) per-tool NOTICE/confirmation blocks, (4) a new TAO-D.. fixture literal each.

The single load-bearing research output is the **5 exact extrinsic param signatures + the custody distinction**, pinned below (§Exact Extrinsic Signatures). The on-chain SCALE-encoded param ORDER (what `api.tx.subtensorModule.*` builds and what the fingerprint binds) is the pallet-macro order — `add_stake(hotkey, netuid, amount_staked)`, matching Phase 47's `add_stake_limit(hotkey, netuid, ...)`. **RED FLAG:** the Bittensor *Python SDK helper docs* list a DIFFERENT order (`netuid, hotkey, amount`); that is an SDK-layer convenience and must NOT be used as the `api.tx.*` arg order. The planner must build calls in pallet-macro order and re-introspect `api.tx.subtensorModule.<method>.meta.args` at execute time.

`transfer_stake` is the one security-relevant divergence: its first param after origin is `destination_coldkey` — alpha leaves the user's custody and lands under a DIFFERENT coldkey. `move_stake` (different hotkey and/or subnet) and `swap_stake` (same hotkey, different subnet) BOTH keep the same coldkey owner. This is the distinction driving TAO-W-08's withdrawal-grade extra-confirmation block.

**Primary recommendation:** Clone the shipped `*_limit` prepare tools five times. Build each call via `api.tx.subtensorModule.<camelCaseMethod>(...)` in pallet-macro param order; reuse `computeBittensorPayloadFingerprint` + `computeBittensorPresignHash` + `buildBittensorUnsignedTx`'s blob-assembly path verbatim (just add new `BuildBittensorInput` kinds). Add the 5 camelCase `(section,method)` pairs to `BITTENSOR_DISPATCH_ALLOWLIST`. Emit `[NOTICE — no slippage guard; prefer *_limit]` on the two plain variants and a `[WITHDRAWAL — CUSTODY CHANGE]` confirmation block on `transfer_stake`. For TAO-R-05, enrich `get_bittensor_validators` via `DelegateInfoRuntimeApi.get_delegate(hotkey)` (take/commission + registrations) + `IdentitiesV2` storage (coldkey→name); detect an unregistered hotkey by its ABSENCE from `getNeuronsLite(netuid)` and surface the warning in the `preview_send` add/remove/move/swap arms.

<user_constraints>
## User Constraints

> No per-phase CONTEXT.md exists (standalone research run). Constraints below are the milestone-level LOCKED decisions from `.planning/ROADMAP.md` v2.7 + the orchestrator-supplied locked decisions. Treat as locked — do NOT re-litigate.

### Locked Decisions (do NOT re-litigate)
- New tx shapes REUSE the EXISTING `computeBittensorPayloadFingerprint` (`VaultPilot-taotx-v1:` domain tag over `ExtrinsicPayload.toU8a({method:true})`) + the blake2-256 presign — UNCHANGED. Phase 48 adds only new TAO-D.. fixtures for the new shapes.
- The new `(pallet, call)` pairs are ADDED to the existing `BITTENSOR_DISPATCH_ALLOWLIST` (camelCase keying, `(section,method)`-ONLY — arg-level allowlisting stays deferred).
- Unit asymmetry per-extrinsic: plain `add_stake` amount = TAO/RAO; plain `remove_stake` amount = ALPHA; `move_stake`/`swap_stake`/`transfer_stake` amounts = ALPHA.
- `transfer_stake` = WITHDRAWAL-GRADE (custody change → destination coldkey required in the receipt, surfaced distinctly from `move_stake`, extra confirmation block).
- FROZEN binding modules stay ZERO-DIFF (`payload-fingerprint-bittensor.ts`, `presign-hash-bittensor.ts`, and the EVM/Solana/TRON siblings + the `send_transaction` three-gate region).
- The binding, builder, and allowlist MECHANICS are DONE — do not re-probe them.

### Claude's Discretion (this phase)
- Whether the plain `add_stake`/`remove_stake` NOTICE block is a hard refusal-with-hint or an advisory block (recommend ADVISORY — the requirement text says "emit a NOTICE", and the `*_limit` defaults are the steerable nudge; mirrors the existing `⚠ UNLIMITED APPROVAL` advisory precedent).
- Whether TAO-R-05 enrichment fetches identity eagerly for every validator or lazily (recommend: enrich the enumerated set; lazy per-hotkey only for the preview-time unregistered-warning lookup).
- The exact `[WITHDRAWAL — CUSTODY CHANGE]` block copy.

### Deferred Ideas (OUT OF SCOPE for Phase 48)
- Arg-level dispatch allowlisting (hotkey/netuid value checks).
- `*_limit` slippage-guard variants of move/swap (`swap_stake_limit` exists on-chain but is NOT in Phase 48 scope — only the plain `move_stake`/`swap_stake`).
- `get_bittensor_setup_status` diagnostic (TAO-DIAG-01 — Phase 49).
- SECURITY.md v2.7 close-out (Phase 49).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TAO-W-06 | `prepare_bittensor_add_stake` + `prepare_bittensor_remove_stake` — PLAIN unguarded `subtensorModule.add_stake` / `remove_stake`; preview emits `[NOTICE — no slippage guard; prefer *_limit]`; amounts unit-typed (TAO/RAO add, ALPHA remove) | §Exact Extrinsic Signatures #1/#2; §Pattern A (clone of shipped `*_limit` prepare tools, drop `limitPrice`/`allowPartial`); §Pattern C (NOTICE block) |
| TAO-W-07 | `prepare_bittensor_move_stake` (`move_stake`) + `prepare_bittensor_swap_stake` (`swap_stake`) — same-owner alpha reallocation across subnets; origin+dest netuids echoed; amounts ALPHA | §Exact Extrinsic Signatures #3/#4 (move = origin+dest HOTKEY + origin+dest NETUID; swap = ONE hotkey + origin+dest netuid); §Custody Semantics (same coldkey owner) |
| TAO-W-08 | `prepare_bittensor_transfer_stake` (`transfer_stake`) — CHANGES CUSTODY (alpha → destination coldkey); withdrawal-grade; destination coldkey in receipt; surfaced distinctly from move; extra confirmation block | §Exact Extrinsic Signatures #5 (FIRST param after origin = `destination_coldkey`); §Custody Semantics (the ONE custody change); §Pattern D (withdrawal-grade block) |
| TAO-W-09 | All 5 `(pallet,call)` pairs added to `BITTENSOR_DISPATCH_ALLOWLIST`; each new tx shape gets a hardcoded `0x…` TAO-D.. fixture cross-linked from its consumer test; FROZEN zero-diff held | §Pattern B (allowlist additions, camelCase); §Fixtures (TAO-D through TAO-H construction); §Validation Architecture |
| TAO-R-05 | `get_bittensor_validators` enriched with delegate identity + commission (take %) + per-netuid registration status; staking to an unregistered/unknown hotkey warns at preview | §Validator Enrichment Reads (`DelegateInfoRuntimeApi.get_delegate` + `IdentitiesV2` + `getNeuronsLite` presence-test); §Pattern E (preview-time unregistered warning) |
</phase_requirements>

## Exact Extrinsic Signatures (THE LOAD-BEARING OUTPUT)

> Source: `opentensor/subtensor` `pallets/subtensor/src/macros/dispatches.rs` `#[pallet::call]` definitions `[CITED: github.com/opentensor/subtensor/blob/main/pallets/subtensor/src/macros/dispatches.rs]` cross-confirmed against the Bittensor SDK pallet-helper `[CITED: docs.learnbittensor.org/python-api/.../subtensor_module/]`. The SCALE-encoded ORDER (after `origin`) is the pallet-macro order — this is what `api.tx.subtensorModule.*` builds and what the fingerprint binds.
>
> **camelCase mapping:** polkadot-js converts snake_case pallet calls to camelCase on `api.tx.<section>.<method>`. So `add_stake → addStake`, `remove_stake → removeStake`, `move_stake → moveStake`, `swap_stake → swapStake`, `transfer_stake → transferStake`. The allowlist + `PreparedTxBittensor.method` use the camelCase form (matching the shipped Phase 47 `addStakeLimit`/`removeStakeLimit` convention); the snake_case form is echoed in the user-facing receipt ONLY. `[VERIFIED: matches shipped canonical-dispatch-bittensor.ts camelCase keying]`

### #1 — `add_stake` → `api.tx.subtensorModule.addStake` (TAO-W-06)
```
add_stake(origin, hotkey: T::AccountId, netuid: NetUid, amount_staked: TaoBalance)
```
- Params after origin (SCALE order): **hotkey (SS58 AccountId), netuid (u16), amount_staked (u64 — TAO/RAO)**.
- Plain unguarded variant of the shipped `add_stake_limit` — DROP the trailing `limit_price` + `allow_partial`. Same `(hotkey, netuid, amount)` prefix order as `add_stake_limit`.
- Unit: `amount_staked` is **TAO/RAO**. `[CITED: dispatches.rs]`

### #2 — `remove_stake` → `api.tx.subtensorModule.removeStake` (TAO-W-06)
```
remove_stake(origin, hotkey: T::AccountId, netuid: NetUid, amount_unstaked: AlphaBalance)
```
- Params after origin: **hotkey (SS58), netuid (u16), amount_unstaked (u64 — ALPHA)**.
- Plain unguarded variant of `remove_stake_limit` — DROP `limit_price` + `allow_partial`.
- Unit: `amount_unstaked` is **ALPHA** (subnet token). `[CITED: dispatches.rs]`

### #3 — `move_stake` → `api.tx.subtensorModule.moveStake` (TAO-W-07)
```
move_stake(origin, origin_hotkey: T::AccountId, destination_hotkey: T::AccountId,
           origin_netuid: NetUid, destination_netuid: NetUid, alpha_amount: AlphaBalance)
```
- Params after origin (SCALE order): **origin_hotkey (SS58), destination_hotkey (SS58), origin_netuid (u16), destination_netuid (u16), alpha_amount (u64 — ALPHA)**.
- Takes BOTH an origin AND a destination HOTKEY (re-delegate to a different validator) AND/OR a different subnet — same coldkey owner throughout. `[CITED: dispatches.rs]`
- The receipt must echo origin_hotkey, destination_hotkey, origin_netuid, destination_netuid.

### #4 — `swap_stake` → `api.tx.subtensorModule.swapStake` (TAO-W-07)
```
swap_stake(origin, hotkey: T::AccountId, origin_netuid: NetUid,
           destination_netuid: NetUid, alpha_amount: AlphaBalance)
```
- Params after origin: **hotkey (SS58 — ONE hotkey), origin_netuid (u16), destination_netuid (u16), alpha_amount (u64 — ALPHA)**.
- Same hotkey, moves alpha BETWEEN subnets. Differs from `move_stake` by having NO destination_hotkey (the hotkey is unchanged). `[CITED: dispatches.rs]`

### #5 — `transfer_stake` → `api.tx.subtensorModule.transferStake` (TAO-W-08 — THE CUSTODY CHANGE)
```
transfer_stake(origin, destination_coldkey: T::AccountId, hotkey: T::AccountId,
               origin_netuid: NetUid, destination_netuid: NetUid, alpha_amount: AlphaBalance)
```
- Params after origin (SCALE order): **destination_coldkey (SS58 — THE CUSTODY DESTINATION), hotkey (SS58), origin_netuid (u16), destination_netuid (u16), alpha_amount (u64 — ALPHA)**.
- The FIRST param is `destination_coldkey` — alpha LEAVES the user's coldkey and is now owned by a DIFFERENT coldkey. This is the only one of the five that changes ownership. `[CITED: dispatches.rs + docs.learnbittensor.org move_stake/transfer_stake helper]`
- Withdrawal-grade: `destination_coldkey` MUST be in the PREPARE RECEIPT, surfaced distinctly from `move_stake`, with an extra `[WITHDRAWAL — CUSTODY CHANGE]` confirmation block.

### Custody Semantics (the security-relevant distinction)
| Extrinsic | hotkey change | subnet change | **coldkey owner** | Treatment |
|-----------|---------------|---------------|-------------------|-----------|
| `move_stake` | yes (origin→dest hotkey) | optional | **SAME** (no custody change) | same-owner reallocation |
| `swap_stake` | no (one hotkey) | yes (origin→dest netuid) | **SAME** (no custody change) | same-owner reallocation |
| `transfer_stake` | no | optional | **CHANGES → destination_coldkey** | **WITHDRAWAL-GRADE** |

> `[CITED: docs.learnbittensor.org/.../extrinsics/move_stake/]` — verbatim: move_stake "Moves stake to a different hotkey and/or subnet while keeping the same coldkey owner"; transfer_stake "Transfers stake from one subnet to another while changing the coldkey owner." Also `[CITED: github.com/opentensor/subtensor remove_stake.rs]` — "All extrinsics that remove stake check the stake lock first … the only exception being transfer_stake when the destination coldkey is different from the origin," confirming transfer_stake's destination-coldkey IS a different owner.

### RED FLAG — SDK-helper arg order ≠ pallet SCALE order for add/remove
The Bittensor *Python SDK* `subtensor_module` helper lists `add_stake: netuid, hotkey, amount_staked` and `remove_stake: netuid, hotkey, amount_unstaked` `[CITED: docs.learnbittensor.org/python-api/.../subtensor_module/]` — **netuid-first**. The on-chain pallet macro is **hotkey-first** `[CITED: dispatches.rs]`. `api.tx.subtensorModule.addStake(...)` consumes the pallet-macro order. Building in SDK-helper order would produce a call that encodes hotkey-where-netuid-belongs → a wrong (and fingerprint-bound) blob. **The planner MUST use pallet-macro order and re-introspect `api.tx.subtensorModule.addStake.meta.args` at execute time to confirm** (the shipped builder already does `api.tx.subtensorModule.addStakeLimit(hotkey, netuid, ...)` hotkey-first — match that).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| New unsigned-extrinsic construction (5 shapes) | Chain client (`extrinsic-builder.ts`) | Prepare tools | `api.tx.subtensorModule.<method>(...)` builds the call; the SAME `registry.createType("ExtrinsicPayload",...).toU8a({method:true})` blob path is reused — only `BuildBittensorInput` gains 5 kinds. |
| `payloadFingerprint` (keccak256) | Signing (`payload-fingerprint-bittensor.ts`) | Prepare + send | REUSED VERBATIM — pure fn over `signableBytes`. Shape-agnostic. ZERO-DIFF. |
| Device-display hash (blake2-256) | Signing (`presign-hash-bittensor.ts`) | Preview | REUSED VERBATIM — pure fn over `signableBytes`. ZERO-DIFF. |
| `(section,method)` dispatch allowlist | Security (`canonical-dispatch-bittensor.ts`) | Preview | ADD 5 camelCase keys to the existing `ReadonlySet`. |
| DECODED-ARGS + NOTICE/custody blocks | Preview (`preview_send.ts` Bittensor arm) | `blocks-bittensor.ts` | ADD 5 `summary.kind` arms to the `previewSendBittensorBranch` dispatcher; emit per-tool blocks. |
| transfer_stake custody confirmation | Preview + prepare receipt | `blocks-bittensor.ts` | Withdrawal-grade block; destination_coldkey echoed verbatim. |
| Validator identity + commission + registration | Read (`tao-rpc-client.ts` `getValidators` enrich) | `get_bittensor_validators` tool | `DelegateInfoRuntimeApi.get_delegate` (take/registrations) + `IdentitiesV2` (name) + `getNeuronsLite` presence (registration). |
| Unregistered-hotkey preview warning | Read helper | Preview Bittensor arm | Cross-reference the staked hotkey against `getNeuronsLite(netuid)`; warn on absence. |
| ALPHA decimal arithmetic | Signing (`amount-bittensor.ts`) | Prepare tools | REUSED — `parseBittensorAmountStrict(str, 9)` is unit-agnostic; per-extrinsic unit labeling at the call site. |

## Standard Stack

> NO new packages this phase. All four Bittensor SDKs shipped in Phase 47 (merged on this branch's base) and are reused as-is. `package.json` pins confirmed on this worktree: `@polkadot/api@16.5.6`, `@polkadot/util-crypto@14.0.3`, `@zondax/ledger-substrate@2.3.4`, `@polkadot-api/merkleize-metadata@1.2.3`.

### Core (reused — no install)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@polkadot/api` | 16.5.6 | `api.tx.subtensorModule.{addStake,removeStake,moveStake,swapStake,transferStake}(...)`; the `ExtrinsicPayload` blob path; `api.call.delegateInfoRuntimeApi.getDelegate`; `api.query.subtensorModule.identitiesV2`; `api.call.neuronInfoRuntimeApi.getNeuronsLite` | `[VERIFIED: probe install + slopcheck OK; package.json pin]` |
| `@polkadot/util-crypto` | 14.0.3 | blake2-256 presign (reused) | `[VERIFIED: package.json pin]` |
| `@zondax/ledger-substrate` | 2.3.4 | `signWithMetadataEd25519` (reused; the `.d.ts` confirms the surface is unchanged) | `[VERIFIED: probe .d.ts read]` |
| `@polkadot-api/merkleize-metadata` | 1.2.3 | offline CheckMetadataHash (reused; only if mode:1 — Phase 47 ships mode:0) | `[VERIFIED: package.json pin]` |

**Installation:** none — no new dependencies.

**Version verification (run at execute time):**
```bash
npm view @polkadot/api version          # expect 16.5.6
npm view @zondax/ledger-substrate version   # 2.3.4 — re-run slopcheck (fast cadence)
```

## Package Legitimacy Audit

> slopcheck ran successfully on the **npm** registry (correct ecosystem for a Node.js phase). Phase 48 installs NO new package; the audit re-confirms the four shipped Phase-47 packages still resolve clean.

| Package | Registry | Source Repo | slopcheck | Disposition |
|---------|----------|-------------|-----------|-------------|
| `@polkadot/api` | npm | github.com/polkadot-js/api | [OK] | Approved (no new install) |
| `@polkadot/util-crypto` | npm | github.com/polkadot-js/common | [OK] | Approved (no new install) |
| `@zondax/ledger-substrate` | npm | github.com/Zondax/ledger-substrate-js | [OK] | Approved (no new install) |
| `@polkadot-api/merkleize-metadata` | npm | github.com/polkadot-api/polkadot-api | [OK] | Approved (no new install) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
agent (Claude Code / Cursor / Desktop)
   │  stdio (MCP protocol)
   ▼
vaultpilot-mcp
   │
   ├─ prepare_bittensor_{add_stake, remove_stake, move_stake, swap_stake, transfer_stake}   ◄── 5 NEW tools (clones)
   │     │ demo-mode FIRST refusal (bittensor persona)
   │     │ input validation: SS58 hotkey(s) + dest coldkey (transfer) + netuid(s) u16 + decimal amount
   │     │ pairing check (listAccounts({chainFilter:"bittensor"}))
   │     ▼
   │  src/chains/bittensor/extrinsic-builder.ts   ◄── ADD 5 BuildBittensorInput kinds
   │     │ tx = api.tx.subtensorModule.addStake(hotkey, netuid, amountRao)               [plain — NO limit]
   │     │   OR .removeStake(hotkey, netuid, amountAlpha)                                [plain — NO limit]
   │     │   OR .moveStake(originHotkey, destHotkey, originNetuid, destNetuid, alpha)    [same owner]
   │     │   OR .swapStake(hotkey, originNetuid, destNetuid, alpha)                      [same owner, same hotkey]
   │     │   OR .transferStake(destColdkey, hotkey, originNetuid, destNetuid, alpha)     [CUSTODY CHANGE]
   │     │ signableBlob = registry.createType("ExtrinsicPayload", payload, {version}).toU8a({method:true})  ◄── SAME path, REUSED
   │     ▼
   │  payloadFingerprint = computeBittensorPayloadFingerprint(signableBlob)   ◄── REUSED VERBATIM (no diff)
   │  presignHash        = computeBittensorPresignHash(signableBlob)          ◄── REUSED VERBATIM (no diff)
   │     ▼
   │  createHandle({ tx: PreparedTxBittensor{ section:"subtensorModule", method:<camelCase>, instructionSummary:<new kind> }, ... })
   │
   ├─ preview_send (txType==="bittensor" → previewSendBittensorBranch)
   │     │ Layer 0.5  checkBittensorDispatch — 5 NEW camelCase keys in BITTENSOR_DISPATCH_ALLOWLIST
   │     │ Layer 0.7  ADVISORY dry-run (unchanged)
   │     │ Layer 1    recompute blake2-256 presign + previewToken (unchanged)
   │     │ DECODED ARGS — ADD 5 summary.kind arms (per-extrinsic unit labels)
   │     │ NOTICE blocks: [NOTICE — no slippage guard] (add/remove) · unregistered-hotkey WARN (TAO-R-05)
   │     │                [WITHDRAWAL — CUSTODY CHANGE: destination coldkey <X>] (transfer_stake)
   │     │ LEDGER BLIND-SIGN HASH (Bittensor) — blake2-256 (unchanged)
   │
   ├─ send_transaction (txType==="bittensor" arm — UNCHANGED, additive-free)
   │     │ 3 FROZEN gates (schema/token/fingerprint-drift over signableBlob)
   │     │ rebuild call from signerPayloadJSON.method via api.tx(methodHex) — byte-identical, shape-agnostic
   │     │ signWithMetadataEd25519 → addSignature('0x00'+sig) → author.submitExtrinsic
   │     ▼  (the send arm reads NO per-shape branch — it operates on the stored blob; 5 new shapes flow through unmodified)
   │
   └─ get_bittensor_validators (TAO-R-05 enrichment)
         │ getNeuronsLite(netuid) → hotkey/uid/validatorPermit (shipped)
         │ + DelegateInfoRuntimeApi.get_delegate(hotkey) → take(Compact<u16>) + registrations + validator_permits
         │ + api.query.subtensorModule.identitiesV2(coldkey) → on-chain name (decode bytes)
         ▼
      wss://entrypoint-finney.opentensor.ai:443  (BITTENSOR_RPC_URL override)
```

### Pattern A — clone the shipped `*_limit` prepare tool, drop the guard (TAO-W-06)
**What:** `prepare_bittensor_add_stake` is `prepare_bittensor_add_stake_limit` minus `tolerancePct`/`limitPrice`/`allowPartial` and minus the `simSwapTaoForAlpha` chain call. Same demo-FIRST refusal → SS58/netuid validation → pairing check → `buildBittensorUnsignedTx` → fingerprint → `createHandle` → PREPARE RECEIPT skeleton.
**Why this is safe:** the shipped `add_stake_limit` builder already does `api.tx.subtensorModule.addStakeLimit(hotkey, netuid, amountStaked, limitPrice, allowPartial)` hotkey-first. The plain variant calls `api.tx.subtensorModule.addStake(hotkey, netuid, amountStaked)` — identical prefix, drop the last two args.
**Example (builder delta — extrinsic-builder.ts new kind):**
```typescript
// Source: clone of the shipped add-stake-limit kind (extrinsic-builder.ts:255-287), guard removed.
} else if (input.kind === "add-stake") {
  section = "subtensorModule";
  method = "addStake";                                   // camelCase → on-chain add_stake
  const call = api.tx.subtensorModule.addStake(          // hotkey-first (pallet-macro order)
    input.hotkey, input.netuid, input.amountStakedRao,
  );                                                     // NO limit_price, NO allow_partial
  methodHex = call.method.toHex();
  instructionSummary = { kind: "add-stake", hotkey: input.hotkey, netuid: input.netuid, amountStakedRao: input.amountStakedRao };
  // limitPrice stays undefined → no simSwap* call.
}
```

### Pattern B — additive allowlist keys (TAO-W-09)
**What:** ADD 5 camelCase `(section,method)` strings to `BITTENSOR_DISPATCH_ALLOWLIST` (the shipped `ReadonlySet` in `canonical-dispatch-bittensor.ts`).
```typescript
export const BITTENSOR_DISPATCH_ALLOWLIST: ReadonlySet<string> = new Set([
  "subtensorModule.addStakeLimit",      // shipped
  "subtensorModule.removeStakeLimit",   // shipped
  "balances.transferKeepAlive",         // shipped
  "subtensorModule.addStake",           // NEW — TAO-W-06
  "subtensorModule.removeStake",        // NEW — TAO-W-06
  "subtensorModule.moveStake",          // NEW — TAO-W-07
  "subtensorModule.swapStake",          // NEW — TAO-W-07
  "subtensorModule.transferStake",      // NEW — TAO-W-08
]);
```
**Note:** keyed CAMELCASE (matches `record.tx.method`). The snake_case form is receipt-only. Pin the camelCase mapping in the allowlist test (a snake_case key would silently NOT match — shipped test already guards this for the `*_limit` pairs; extend it).

### Pattern C — `[NOTICE — no slippage guard]` advisory block (TAO-W-06)
**What:** the plain `add_stake`/`remove_stake` preview arms emit an advisory NOTICE (NOT a refusal) steering the user toward the `*_limit` defaults. Mirrors the shipped `⚠ UNLIMITED APPROVAL` advisory-surfacing precedent (ERC-20 Phase 6). Emit ABOVE the LEDGER BLIND-SIGN HASH, in the DECODED ARGS arm.
```
[NOTICE — no slippage guard]
  This is a PLAIN add_stake / remove_stake with NO limit_price protection.
  The dTAO AMM is concentrated-liquidity — a large stake can slip or be sandwiched.
  PREFER prepare_bittensor_add_stake_limit / _remove_stake_limit (the slippage-guarded DEFAULTS).
```

### Pattern D — `[WITHDRAWAL — CUSTODY CHANGE]` block (TAO-W-08)
**What:** `transfer_stake` is treated like a withdrawal. The DECODED-ARGS arm + the PREPARE RECEIPT echo `destination_coldkey` verbatim (full SS58, no truncation) and emit a distinct confirmation block that `move_stake`/`swap_stake` do NOT.
```
[WITHDRAWAL — CUSTODY CHANGE]
  transfer_stake moves your alpha to a DIFFERENT coldkey. After this, the alpha
  is OWNED BY destination_coldkey — NOT your paired Ledger coldkey.
  destination_coldkey: <full SS58, unredacted>
  This is NOT move_stake (which keeps your ownership). Confirm the destination coldkey on-device.
```
**Distinctness check:** the `move-stake`/`swap-stake` DECODED-ARGS arms must NOT emit this block (they keep ownership). Pin a test asserting the block appears ONLY for `transfer-stake`.

### Pattern E — preview-time unregistered-hotkey warning (TAO-R-05)
**What:** at preview, cross-reference the staked `hotkey` against `getNeuronsLite(netuid)` for the target subnet. If the hotkey is ABSENT from the neuron set, the hotkey is not registered on that netuid → emit a warning. Mirrors the "dTAO wrong-validator failure-mode guard" the requirement names.
```typescript
// Source: getNeuronsLite returns Vec<NeuronInfoLite> with .hotkey (SS58) per neuron (rpc_info/neuron_info.rs).
const neurons = await getValidators(netuid);   // or a thinner getNeuronsLite call
const registered = neurons.some((n) => n.hotkey === stakedHotkey);
if (!registered) emit("[WARNING — hotkey not registered on netuid <N>] …");
```
**Advisory, not a refusal** — the requirement says "surfaces a warning at preview time."

### Anti-Patterns to Avoid
- **Building add/remove in SDK-helper order (netuid-first).** The pallet SCALE order is hotkey-first; `api.tx.subtensorModule.addStake` consumes pallet order. Build hotkey-first; re-introspect `.meta.args` at execute time. (§RED FLAG.)
- **Treating `move_stake` and `transfer_stake` the same.** move = same owner; transfer = custody change. Only transfer gets the withdrawal block. (§Custody Semantics.)
- **Editing the binding modules for the new shapes.** `computeBittensorPayloadFingerprint`/`computeBittensorPresignHash` are shape-agnostic pure fns over `signableBytes` — REUSE, zero-diff. Adding a TAO-D.. fixture does NOT touch the production module.
- **Adding a per-shape branch to `send_transaction`.** The send arm rebuilds the call from the stored `signerPayloadJSON.method` (SCALE call hex) and operates on the stored `signableBlob` — it is shape-agnostic. The 5 new shapes flow through the UNMODIFIED three-gate region. Do NOT add a branch (it would risk the FROZEN zero-diff gate).
- **Truncating any SS58 in the receipt.** TAO-W-04 (shipped invariant) + TAO-W-08 require full unredacted hotkey AND destination_coldkey.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| New unsigned-extrinsic SCALE bytes | Manual call encode for the 5 shapes | `api.tx.subtensorModule.<method>(...)` + the SHIPPED `ExtrinsicPayload.toU8a({method:true})` path | The signed-extension tuple + arg encoding is metadata-driven; the shipped builder is the authoritative encoder. |
| payloadFingerprint / presign for new shapes | A new binding fn | `computeBittensorPayloadFingerprint` / `computeBittensorPresignHash` (REUSE) | Shape-agnostic pure fns over `signableBytes`. New shapes need NO new binding. |
| Delegate take / commission | Decode raw `Delegates` storage by hand | `api.call.delegateInfoRuntimeApi.getDelegate(hotkey)` | The decoded runtime API returns `take: Compact<u16>` + registrations in one call; raw storage churns. |
| Validator on-chain name | Guess from delegates.json | `api.query.subtensorModule.identitiesV2(coldkey)` (decode the name bytes) | IdentitiesV2 is the on-chain SOT keyed by coldkey; the off-chain delegates.json is supplementary. |
| Registration status | Decode `validatorPermit` Vec<bool> + uid join by hand | hotkey presence in `getNeuronsLite(netuid)` | One decoded call; presence = registered on that netuid. |
| take % conversion | `take/100` | `take_u16 / 65535 * 100` (the shipped `normalizeTakePercent`) | take is a `Compact<u16>` fraction of `u16::MAX`; the shipped normalizer already does this. |

**Key insight:** Phase 48 adds ZERO new cryptographic surface. Every byte-binding primitive is reused from Phase 47; the only genuinely new code is 5 call-builder shapes + 5 DECODED-ARGS arms + the read enrichment. The fingerprint binds whatever bytes `api.tx.subtensorModule.<method>(...)` produces — get the param order right and the binding is automatic.

## Runtime State Inventory

> Phase 48 is additive greenfield on top of Phase 47's merged trust pipeline. No rename/refactor.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | In-memory handle store gains 5 new `BittensorInstructionSummary.kind` variants (TTL 15 min, no persistence). The cache `non-evm-accounts.json` is unchanged (`chain:"bittensor"` already accommodated, Phase 46). | Code-only: additive union members. No data migration. |
| Live service config | None new. The optional metadata-shortener (mode:1) path is unchanged from Phase 47 (mode:0 shipped). | None — verified. |
| OS-registered state | None. | None — verified: no Task Scheduler / pm2 / systemd registration in this codebase. |
| Secrets/env vars | None new. `BITTENSOR_RPC_URL` (Phase 46) reused for the validator-enrichment reads. | None. |
| Build artifacts | No new package → no new `pkg`-binary asset path. The Phase 47 `@polkadot/*`/`@zondax/*` asset-allowlist note still applies (separate verify-phase concern). | None this phase. |

**Nothing found requiring data migration.** The handle-store widening is additive type surface (the documented Solana/TRON/BTC/Bittensor-47 precedent).

## Validator Enrichment Reads (TAO-R-05)

> The shipped `getValidators(netuid)` uses `neuronInfoRuntimeApi.getNeuronsLite` and explicitly defers identity + richer commission to Phase 48. Neither `NeuronInfo` nor `NeuronInfoLite` carries an identity/name field `[CITED: github.com/opentensor/subtensor rpc_info/neuron_info.rs]` (fields: hotkey, coldkey, uid, netuid, active, axon_info, prometheus_info, stake, rank, emission, incentive, consensus, trust, validator_trust, dividends, last_update, validator_permit, pruning_score). Enrichment therefore needs TWO additional sources:

### Delegate identity + commission (take %)
- `api.call.delegateInfoRuntimeApi.getDelegate(hotkey)` → `Option<DelegateInfo>` `[CITED: subtensor runtime/src/lib.rs DelegateInfoRuntimeApi]`.
- `DelegateInfo` fields `[CITED: pallets/subtensor/src/rpc_info/delegate_info.rs]`: `delegate_ss58: AccountId`, `take: Compact<u16>`, `nominators: Vec<(AccountId, Vec<(Compact<NetUid>, Compact<u64>)>)>`, `owner_ss58: AccountId`, `registrations: Vec<Compact<NetUid>>`, `validator_permits: Vec<Compact<NetUid>>`, `return_per_1000: Compact<u64>`, `total_daily_return: Compact<u64>`.
- **Commission/take:** `take` is `Compact<u16>` as a fraction of `u16::MAX` (65535); divide by 65535 × 100 for the percentage — the SHIPPED `normalizeTakePercent` already does exactly this. `[CITED: delegate_info.rs return_per_1000_tao "divide by u16::MAX … max value = 100%"]`
- **Per-netuid registration:** `registrations: Vec<NetUid>` and `validator_permits: Vec<NetUid>` on `DelegateInfo` give the subnets a hotkey is registered on / holds a permit on. Alternatively (and the lowest-round-trip per-netuid check), a hotkey's PRESENCE in `getNeuronsLite(netuid)` = registered on that netuid.

### On-chain identity (name)
- `api.query.subtensorModule.identitiesV2(coldkey)` — `IdentitiesV2` is a `StorageMap` keyed by COLDKEY AccountId `[CITED: opentensor/subtensor IdentitiesV2 storage]`. Resolve the validator's `owner_ss58` (coldkey) from `getDelegate`, then look up its identity. Decode the name byte-vector to a string.
- `[ASSUMED]` the exact `IdentitiesV2` value struct field names (e.g. `name`, `url`, `description`, `additional`) — the storage map's existence + coldkey keying is confirmed, but the precise decoded shape is **fixture-at-execute** (probe `api.query.subtensorModule.identitiesV2(<coldkey>)` against a live validator at execute time; sandbox blocks live RPC). The off-chain `delegates.json` repo is a supplementary label source, NOT the on-chain SOT.

### Unregistered/unknown-hotkey detection
- An "unknown hotkey" = `getDelegate(hotkey)` returns `None` (not a registered delegate) OR the hotkey is absent from `getNeuronsLite(netuid)` for the staking target subnet. Either signal drives the preview-time warning (Pattern E). The neuron-presence test is per-netuid (which is what the staking call targets) and is the cleaner signal for the warning.

## Common Pitfalls

### Pitfall 1: wrong param order on `add_stake`/`remove_stake` (the RED FLAG)
**What goes wrong:** building `api.tx.subtensorModule.addStake(netuid, hotkey, amount)` (SDK-helper order) instead of `(hotkey, netuid, amount)` (pallet order). The blob encodes a hotkey where a netuid belongs; the fingerprint binds the wrong bytes; the device displays a hash for a transaction the user did not intend, and broadcast either fails or stakes to the wrong target.
**Why it happens:** the Bittensor Python SDK helper docs list netuid-first; it's a natural copy source.
**How to avoid:** build hotkey-first (match the shipped `addStakeLimit`); re-introspect `api.tx.subtensorModule.addStake.meta.args` at execute time and assert the order.
**Warning signs:** the +1-unit fingerprint regression fixture passes but a "swap hotkey↔netuid" regression would differ — add that regression to the TAO-D fixture test.

### Pitfall 2: conflating move_stake with transfer_stake (custody)
**What goes wrong:** treating `transfer_stake` as same-owner (no withdrawal block) or `move_stake` as a custody change (spurious withdrawal block).
**Why it happens:** both reallocate alpha across subnets; the difference is the destination_coldkey arg.
**How to avoid:** transfer_stake's FIRST param is `destination_coldkey` (a different owner); move_stake has origin_hotkey+destination_hotkey but the SAME coldkey signs and owns. Only transfer gets the `[WITHDRAWAL — CUSTODY CHANGE]` block. Pin a test asserting the block appears ONLY for transfer-stake.
**Warning signs:** a move_stake preview showing a "custody change" line, or a transfer_stake preview missing the destination coldkey.

### Pitfall 3: TAO vs ALPHA unit confusion on the plain variants
**What goes wrong:** labeling plain `add_stake.amount_staked` as ALPHA (it is TAO/RAO) or `remove_stake.amount_unstaked` as TAO (it is ALPHA); move/swap/transfer amounts are ALL ALPHA.
**Why it happens:** all are u64, all 9-decimal.
**How to avoid:** per-extrinsic unit typing — the field name carries the unit (`amountStakedRao` vs `amountUnstakedAlpha` vs `alphaAmount`); the DECODED-ARGS arm labels it. One field never accepts both. (Shipped `*_limit` precedent.)
**Warning signs:** a stake amount off by the subnet's alpha price (~100×).

### Pitfall 4: editing a FROZEN binding module to "support" a new shape
**What goes wrong:** adding a shape-specific branch to `payload-fingerprint-bittensor.ts`/`presign-hash-bittensor.ts`/`send_transaction.ts` three-gate region → fails the TAO-W-09 zero-diff gate.
**Why it happens:** the instinct that a new tx type needs new binding code.
**How to avoid:** the binding is a pure fn over `signableBytes` and the send arm operates on the stored blob — both are shape-agnostic. New shapes need NO binding edit. The TAO-D.. fixtures are added to the TEST file, never the production module.
**Warning signs:** any non-empty `git diff origin/main` on the 6 FROZEN binding files or a deletion-line in `send_transaction.ts`.

## Code Examples

### move_stake builder kind (extrinsic-builder.ts — new BuildBittensorInput)
```typescript
// Source: pallet-macro order (dispatches.rs). camelCase moveStake. Same-owner — no custody change.
} else if (input.kind === "move-stake") {
  section = "subtensorModule";
  method = "moveStake";
  const call = api.tx.subtensorModule.moveStake(
    input.originHotkey, input.destinationHotkey,
    input.originNetuid, input.destinationNetuid, input.alphaAmount,
  );
  methodHex = call.method.toHex();
  instructionSummary = { kind: "move-stake", originHotkey: input.originHotkey, destinationHotkey: input.destinationHotkey,
    originNetuid: input.originNetuid, destinationNetuid: input.destinationNetuid, alphaAmount: input.alphaAmount };
}
```

### transfer_stake builder kind (the custody change)
```typescript
// Source: pallet-macro order — destination_coldkey FIRST. Withdrawal-grade.
} else if (input.kind === "transfer-stake") {
  section = "subtensorModule";
  method = "transferStake";
  const call = api.tx.subtensorModule.transferStake(
    input.destinationColdkey, input.hotkey,
    input.originNetuid, input.destinationNetuid, input.alphaAmount,
  );
  methodHex = call.method.toHex();
  instructionSummary = { kind: "transfer-stake", destinationColdkey: input.destinationColdkey, hotkey: input.hotkey,
    originNetuid: input.originNetuid, destinationNetuid: input.destinationNetuid, alphaAmount: input.alphaAmount };
}
```

### Validator enrichment (tao-rpc-client.ts — getValidators extension)
```typescript
// Source: DelegateInfoRuntimeApi.getDelegate + identitiesV2; shape fixture-at-execute for identitiesV2 value.
const delegate = await api.call.delegateInfoRuntimeApi.getDelegate(hotkey); // Option<DelegateInfo>
const di = delegate.toJSON() as { take: number; ownerSs58: string; registrations: number[]; validatorPermits: number[] } | null;
const takePercent = di ? normalizeTakePercent(di.take) : null;             // SHIPPED normalizer
const registeredOnNetuid = di?.registrations?.includes(netuid) ?? false;
// identity name (coldkey-keyed): probe the value shape at execute time.
const ident = di ? await api.query.subtensorModule.identitiesV2(di.ownerSs58) : null;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 47: only `*_limit` staking + native send | Phase 48: + plain add/remove + move/swap/transfer breadth | this phase | 5 new tools; same binding. |
| Validator enumeration = hotkey/uid/take only (lite) | + delegate identity + registrations via DelegateInfoRuntimeApi + IdentitiesV2 | this phase (TAO-R-05) | richer validator-selection UX; unregistered-hotkey guard. |

**Deprecated/outdated (do not use):**
- SDK-helper netuid-first arg order for `add_stake`/`remove_stake` — NOT the on-chain SCALE order (§RED FLAG).
- `swap_stake_limit` — exists on-chain but OUT OF SCOPE (only plain move/swap this phase).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `api.query.subtensorModule.identitiesV2` value struct field names (e.g. `name`/`url`/`description`) — the storage map + coldkey keying are confirmed; the decoded value shape is fixture-at-execute. | Validator Enrichment Reads | LOW-MEDIUM — affects only the display string of the identity name; probe `identitiesV2(<coldkey>)` at execute time. Does not affect binding or the registration/commission signals. |
| A2 | `DelegateInfoRuntimeApi.getDelegate` is decorated on `api.call.delegateInfoRuntimeApi` on the live subtensor (runtime-API presence confirmed in `runtime/src/lib.rs`; the camelCase decoration is the standard polkadot-js pattern, not live-probed in-sandbox). | Validator Enrichment Reads | LOW — the runtime API is in the runtime; confirm `Object.keys(api.call.delegateInfoRuntimeApi)` at execute time. Fallback: `get_neurons` (full) + `validatorPermit` storage. |
| A3 | The plain `add_stake`/`remove_stake` NOTICE is ADVISORY (not a hard refusal). | Pattern C | LOW — requirement text says "emit a NOTICE"; advisory matches. If the user wants a refusal-with-hint, trivial to switch. |
| A4 | The `send_transaction` Bittensor arm needs NO new branch for the 5 shapes (it rebuilds from stored `signerPayloadJSON.method` + operates on the stored blob). | Anti-Patterns / Pitfall 4 | LOW — confirmed by reading the shipped send arm (rebuilds call from methodHex, shape-agnostic). Integration test re-anchors. |

## Open Questions

1. **`identitiesV2` decoded value shape (the name field).**
   - What we know: `IdentitiesV2` is a coldkey-keyed `StorageMap`; the validator's coldkey is `DelegateInfo.owner_ss58`.
   - What's unclear: the exact field names of the identity value struct.
   - Recommendation: probe `api.query.subtensorModule.identitiesV2(<live validator coldkey>)` at execute time; pin the decoded shape as a documented constant + a fixture. The enumeration tolerates a `null` name (mirrors the shipped lite-shape tolerance).

2. **`getNeuronsLite` vs `getDelegate.registrations` for the per-netuid registration signal.**
   - What we know: both can answer "is this hotkey registered on netuid N" — neuron-presence per-netuid, or `registrations: Vec<NetUid>` on DelegateInfo.
   - What's unclear: which is cheaper / more accurate for the preview-time warning (the staking call already targets one netuid).
   - Recommendation: use `getNeuronsLite(netuid)` presence for the per-netuid preview warning (one decoded call, the exact target subnet); use `getDelegate.registrations` for the enumeration enrichment (already fetched for take%).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | ≥18.17 | — |
| `@polkadot/api` | extrinsic build + reads | ✓ (probe install) | 16.5.6 | — |
| `@zondax/ledger-substrate` | ed25519 sign (reused) | ✓ (probe .d.ts) | 2.3.4 | `_transport` spy for unit tests |
| `@polkadot/util-crypto` | blake2-256 (reused) | ✓ | 14.0.3 | — |
| subtensor RPC `wss://entrypoint-finney.opentensor.ai:443` | build / reads / identity probe | ✓ at execute (sandbox blocks live WS → fixture-at-execute) | spec 413 | `BITTENSOR_RPC_URL` override; `_bittensorRegistry` spy for unit tests |
| Physical Ledger + Polkadot Generic app | sign integration | ✗ (verify-phase only) | — | `_transport` spy; fixtures pinned from offline byte construction |

**Missing dependencies with no fallback:** none for unit-testable scope.
**Fixture-at-execute (sandbox blocks live RPC):** the `identitiesV2` value shape (A1) + the live `api.tx.subtensorModule.<method>.meta.args` order re-confirmation (RED FLAG) + the 5 new TAO-D.. fingerprint literals (built offline via the SHIPPED `test/signing-fingerprint-bittensor.test.ts` `buildSignableBlob` helper — see Validation Architecture). The 5 new SCALE call-encodings are deterministic from the pallet/call indices + arg layout; the offline `TypeRegistry`+`setSignedExtensions` builder reproduces them (same pattern as the shipped TAO-A/B fixtures).

## Validation Architecture

> Nyquist validation ENABLED (`workflow.nyquist_validation: true`). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (repo-standard) |
| Config file | repo root (existing vitest setup) |
| Quick run command | `npx vitest run test/signing-fingerprint-bittensor.test.ts test/prepare-bittensor-*.test.ts test/security-canonical-dispatch-bittensor.test.ts --no-coverage` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TAO-W-06 | `prepare_bittensor_add_stake` demo-FIRST refusal; amount labeled TAO/RAO; fingerprint = Fixture TAO-D; NO limit_price/allow_partial in the call; pairing gate | unit (spy `_bittensorRegistry`) | `npx vitest run test/prepare-bittensor-add-stake.test.ts` | ❌ Wave 0 |
| TAO-W-06 | `prepare_bittensor_remove_stake` amount labeled ALPHA; field named `alpha` not `rao`; fingerprint = Fixture TAO-E | unit | `npx vitest run test/prepare-bittensor-remove-stake.test.ts` | ❌ Wave 0 |
| TAO-W-06 | preview emits `[NOTICE — no slippage guard]` for plain add/remove; ABSENT for `*_limit` | unit (preview branch) | `npx vitest run test/preview-send.bittensor-depth.test.ts` | ❌ Wave 0 |
| TAO-W-07 | `prepare_bittensor_move_stake`: origin+dest HOTKEY + origin+dest NETUID echoed; amount ALPHA; fingerprint = Fixture TAO-F; SAME-owner (no custody block) | unit | `npx vitest run test/prepare-bittensor-move-stake.test.ts` | ❌ Wave 0 |
| TAO-W-07 | `prepare_bittensor_swap_stake`: ONE hotkey + origin+dest NETUID; amount ALPHA; fingerprint = Fixture TAO-G; SAME-owner | unit | `npx vitest run test/prepare-bittensor-swap-stake.test.ts` | ❌ Wave 0 |
| TAO-W-08 | `prepare_bittensor_transfer_stake`: destination_coldkey REQUIRED + in receipt (full SS58); `[WITHDRAWAL — CUSTODY CHANGE]` block present; ABSENT for move/swap; fingerprint = Fixture TAO-H | unit | `npx vitest run test/prepare-bittensor-transfer-stake.test.ts` | ❌ Wave 0 |
| TAO-W-09 | 5 new camelCase `(section,method)` pairs in `BITTENSOR_DISPATCH_ALLOWLIST`; snake_case keys do NOT match (negative); non-allowlisted refuses | unit (pure) | `npx vitest run test/security-canonical-dispatch-bittensor.test.ts` | ⚠️ exists (Phase 47) — EXTEND |
| TAO-W-09 | Fixtures TAO-D..H as hardcoded `0x` literals over `ExtrinsicPayload.toU8a({method:true})`; +1-unit AND hotkey↔netuid-swap regressions; cross-linked from consumer tests | unit (pure) | `npx vitest run test/signing-fingerprint-bittensor.test.ts` | ⚠️ exists (Phase 47) — EXTEND |
| TAO-W-09 | FROZEN zero-diff: 6 binding modules + `send_transaction` three-gate region byte-identical to origin/main; the NEW send-arm reads NO per-shape branch | unit (git diff) | `npx vitest run test/signing-fingerprint-bittensor.test.ts` (FROZEN describe block — extend FROZEN_FILES if needed; the existing block already covers the 6 modules) | ⚠️ exists (Phase 47) |
| TAO-R-05 | `get_bittensor_validators` enriched: take% + identity name + registrations; unregistered hotkey → preview WARNING; null-identity tolerated | unit (spy `_bittensorRegistry`) | `npx vitest run test/get-bittensor-validators-enrichment.test.ts` | ❌ Wave 0 |
| TAO-R-05 | preview-time unregistered-hotkey warning fires when staked hotkey absent from `getNeuronsLite(netuid)` | unit (preview branch) | `npx vitest run test/preview-send.bittensor-depth.test.ts` | ❌ Wave 0 |
| Real-Ledger small mainnet add_stake + transfer_stake | manual | v2.7 verify-phase | N/A (physical device) | — |

### Sampling Rate
- **Per task commit:** `npx vitest run test/signing-fingerprint-bittensor.test.ts test/prepare-bittensor-*.test.ts test/security-canonical-dispatch-bittensor.test.ts test/preview-send.bittensor-depth.test.ts --no-coverage`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** full suite green before `/gsd-verify-work`; FROZEN-area zero-diff asserted (the 6 binding modules + the `send_transaction` three-gate region — the shipped Phase-47 FROZEN describe block already covers them).

### Wave 0 Gaps
- [ ] `test/prepare-bittensor-add-stake.test.ts` + `…remove-stake.test.ts` — plain variants (TAO-W-06)
- [ ] `test/prepare-bittensor-move-stake.test.ts` + `…swap-stake.test.ts` — same-owner reallocation (TAO-W-07)
- [ ] `test/prepare-bittensor-transfer-stake.test.ts` — custody change + withdrawal block (TAO-W-08)
- [ ] `test/preview-send.bittensor-depth.test.ts` — NOTICE block + withdrawal-block distinctness + unregistered-hotkey warning
- [ ] `test/get-bittensor-validators-enrichment.test.ts` — identity + take + registration (TAO-R-05)
- [ ] EXTEND `test/signing-fingerprint-bittensor.test.ts` — Fixtures TAO-D..H + a hotkey↔netuid-swap regression for the plain add/remove (RED FLAG guard)
- [ ] EXTEND `test/security-canonical-dispatch-bittensor.test.ts` — 5 new camelCase keys + snake_case-negative
- [ ] Mock `ApiPromise` fixture extension: `api.tx.subtensorModule.{addStake,removeStake,moveStake,swapStake,transferStake}` returning the probed `.method.toHex()`; `delegateInfoRuntimeApi.getDelegate`; `identitiesV2`. Derive shapes from THIS research's pallet-source probes — re-introspect `.meta.args` at execute time.

## Security Domain

> `security_enforcement: true`. Phase 48 ADDS withdrawal-grade custody handling — the security-relevant new surface is `transfer_stake`.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Signing is on-device. |
| V3 Session Management | no | In-memory TTL handle store, no credentials. |
| V4 Access Control | no | Ledger is sole signing authority. |
| V5 Input Validation | yes | SS58 hotkey(s) + destination coldkey (transfer) via `assertSs58Address` (prefix-42 checksum); netuid u16 range; strict decimal RAO/ALPHA via `parseBittensorAmountStrict`; the camelCase `(section,method)` allowlist. |
| V6 Cryptography | yes (reuse, never hand-roll) | keccak256 (viem), blake2-256 (`@polkadot/util-crypto`), ed25519 (Ledger SE + `addSignature`) — ALL reused from Phase 47. NO new crypto. |
| V7 Error Handling / Logging | yes | stderr-for-diagnostics; structured refusals; the withdrawal-grade confirmation block. |

### Known Threat Patterns for the Phase-48 surface
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent silently substitutes a `transfer_stake` (custody change) where the user intended `move_stake` (same owner) | Spoofing / Elevation | Distinct `[WITHDRAWAL — CUSTODY CHANGE]` block + destination_coldkey echoed verbatim in receipt + DECODED ARGS; only transfer-stake emits it (pinned test). The on-device blake2 hash match is the final anchor. |
| Wrong param order encodes a different target (RED FLAG) | Tampering / user error | Build in pallet-macro order; `.meta.args` execute-time assertion; hotkey↔netuid-swap fingerprint regression fixture. |
| Plain unguarded add/remove sandwiched on the dTAO AMM | Tampering | `[NOTICE — no slippage guard; prefer *_limit]` advisory steering to the guarded defaults. |
| Staking to an unregistered/unknown hotkey (funds to a dead validator) | user error | Preview-time unregistered-hotkey warning (TAO-R-05, Pattern E) via `getNeuronsLite(netuid)` presence test. |
| Non-allowlisted extrinsic smuggled through | Elevation of privilege | Layer 0.5 `(section,method)` allowlist — the 5 new pairs added explicitly; everything else refuses. |
| Off-by-unit (TAO vs ALPHA) | Tampering / user error | Per-extrinsic unit typing + labeled receipts (shipped precedent). |

**Ship-with-blind-sign residual risk:** unchanged from Phase 47 — the Polkadot Generic app may blind-sign these calls; the `(section,method)` allowlist + on-device hash match + (for transfer_stake) the withdrawal-grade confirmation are the compensating controls. SECURITY.md close-out is Phase 49.

## Sources

### Primary (HIGH confidence)
- `opentensor/subtensor` `pallets/subtensor/src/macros/dispatches.rs` — exact `#[pallet::call]` signatures + SCALE param ORDER for add_stake / remove_stake / move_stake / swap_stake / transfer_stake (+ *_limit variants). The load-bearing source.
- `opentensor/subtensor` `pallets/subtensor/src/rpc_info/delegate_info.rs` — `DelegateInfo` struct fields + `take: Compact<u16>` encoding (fraction of u16::MAX).
- `opentensor/subtensor` `pallets/subtensor/src/rpc_info/neuron_info.rs` — `NeuronInfo`/`NeuronInfoLite` fields (NO identity field → enrichment needs IdentitiesV2 + DelegateInfo).
- `opentensor/subtensor` `runtime/src/lib.rs` — DelegateInfoRuntimeApi (`getDelegate`/`getDelegates`/`getDelegated`) + NeuronInfoRuntimeApi signatures.
- `docs.learnbittensor.org/python-api/.../extrinsics/pallets/subtensor_module/` — SDK pallet-helper param lists (cross-confirm + the RED-FLAG order divergence).
- `docs.learnbittensor.org/python-api/.../extrinsics/move_stake/` — move_stake keeps same coldkey owner; transfer_stake changes coldkey owner (verbatim).
- SHIPPED Phase-47 code (this branch's base): `src/chains/bittensor/extrinsic-builder.ts`, `src/security/canonical-dispatch-bittensor.ts`, `src/tools/prepare_bittensor_{add,remove}_stake_limit.ts`, `src/tools/get_bittensor_validators.ts`, `src/chains/bittensor/tao-rpc-client.ts`, `src/signing/{payload-fingerprint,presign-hash}-bittensor.ts`, `src/signing/handle-store.ts`, `src/tools/preview_send.ts` (Bittensor branch), `src/tools/send_transaction.ts` (Bittensor arm), `test/signing-fingerprint-bittensor.test.ts`, `src/signing/blocks-bittensor.ts`.
- `@zondax/ledger-substrate@2.3.4` probe `.d.ts` (`/tmp/tao48-probe`) — `signWithMetadataEd25519` surface unchanged (reuse).
- Phase 46 research `46-RESEARCH.md` + Phase 47 research `47-RESEARCH.md` — the runtime-API read surface + the established binding/builder/allowlist patterns (reused, not re-derived).

### Secondary (MEDIUM confidence)
- `opentensor/subtensor` `remove_stake.rs` — the stake-lock note confirming transfer_stake's destination coldkey is a different owner.

### Tertiary (LOW confidence — fixture-at-execute)
- `identitiesV2` value struct field names (A1, OQ-1) — storage map + coldkey keying confirmed; decoded value shape probed at execute time.
- `api.call.delegateInfoRuntimeApi` camelCase decoration (A2) — runtime API confirmed present; live `Object.keys` check at execute time.

## Metadata

**Confidence breakdown:**
- The 5 exact extrinsic param signatures + move/swap/transfer custody distinction: HIGH — authoritative subtensor pallet source + SDK docs cross-confirm.
- Binding/builder/allowlist reuse: HIGH — shipped + merged; read directly on this worktree.
- Validator enrichment read paths: MEDIUM — runtime API + storage map confirmed; the `identitiesV2` decoded value shape is fixture-at-execute.
- Fixtures TAO-D..H: HIGH for offline-derivability (shipped `buildSignableBlob` helper reproduces the blob); the literals are computed at PR-write time.

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (30 days; subtensor spec churn — re-introspect `api.tx.subtensorModule.<method>.meta.args` + the `identitiesV2`/`getDelegate` shapes at execute time; the pallet param ORDER is stable across the dТАО-era runtime but re-confirm on a spec bump).
