# Phase 46: Bittensor scaffolding — Research

**Researched:** 2026-06-03
**Domain:** Substrate (subtensor) chain integration — USB-HID Ledger Polkadot-Generic-app pairing + TAO/stake reads + persistent non-EVM account
**Confidence:** HIGH (both SDKs installed and type-checked against `.d.ts`; live subtensor RPC probed; SS58/decimal round-trips verified empirically)

## Summary

Phase 46 adds VaultPilot's first **Substrate** chain as a pure scaffolding slice: pairing + reads + persistence. NO signing-binding, NO `prepare_*` tools (those are Phase 47). The integration mirrors the v2.0 Solana / v2.1 TRON / v2.2 BTC non-EVM precedent exactly — a new chain ADDS sibling files at each layer and touches existing files only at documented additive seams (the `NonEvmChain` union widening, `register-all` imports, config-status fields). The persistent cache schema needs **zero** change.

Both new SDKs are confirmed adopt-grade. `@polkadot/api@16.5.6` (pure-ESM, proper conditional `exports` map, `type:module`) builds the key-free read surface and — in Phase 47 — the unsigned `SignerPayload`. `@zondax/ledger-substrate@2.3.4` (CJS, default+named import both work under NodeNext) exposes `PolkadotGenericApp.getAddressEd25519(path, ss58prefix, showInDevice?)` returning `{ address: SS58-string, pubKey: hex }` — the device returns the SS58 address **pre-encoded**, so pairing reads it directly. The live subtensor runtime (`node-subtensor` spec 413) carries `CheckMetadataHash` in its signed-extension tuple (verified at the wire) — the Phase-47 trust anchor, not load-bearing for this read-only phase.

**Primary recommendation:** Adopt `@polkadot/api@16.5.6` + `@zondax/ledger-substrate@2.3.4` (reuse existing `@ledgerhq/hw-transport-node-hid`). Build `src/chains/bittensor/{registry,types,tao-rpc-client}.ts` mirroring `src/chains/solana/`; read TAO via the decoded one-call runtime APIs (`api.call.stakeInfoRuntimeApi.getStakeInfoForColdkey`, `api.call.subnetInfoRuntimeApi.getAllDynamicInfo`, `api.call.swapRuntimeApi.currentAlphaPrice`) rather than raw `api.query.*` storage decode. Derivation path is a **5-level** string `"44'/354'/0'/0'/0'"` (SLIP-44 coin type 354, NOT a 3-level path like Solana). SS58 prefix **42**.

## User Constraints

> No CONTEXT.md exists for this phase (standalone research run). Constraints below are the milestone-level LOCKED decisions from `.planning/ROADMAP.md` v2.7 + the feasibility-verdict memory. Treat as locked — do not re-litigate.

### Locked Decisions (milestone-level — do NOT re-litigate)
- ed25519 Ledger coldkey via the Polkadot **Generic** app (subtensor accepts `MultiSignature::Ed25519`; the Ledger SE cannot sign sr25519, so the Ledger account IS the coldkey — no sr25519-migration tooling).
- SS58 network prefix **42**.
- USB-HID via `@ledgerhq/hw-transport-node-hid` + `@zondax/ledger-substrate` (no WalletConnect; no dedicated TAO app).
- Default RPC `wss://entrypoint-finney.opentensor.ai:443`, override via `BITTENSOR_RPC_URL`.
- `chain: "bittensor"` via a one-line `NonEvmChain` union + `VALID_CHAINS` widening; zero cache-schema change.
- `get_bittensor_status` mirrors the `get_solana_status` shape (incl. 30-day `staleAccountWarning`).
- Chain prefix `TAO-`; signing domain tag `VaultPilot-taotx-v1:`; presign hash blake2-256 — **Phase 47 concerns**, out of scope here.

### Claude's Discretion (this phase)
- Exact read-tool decomposition (`get_bittensor_balance` / `get_bittensor_stake` / `get_bittensor_subnets` / `get_bittensor_validators`) — recommend below.
- Whether `get_bittensor_subnets` + `get_bittensor_validators` are one tool or two (TAO-R-03 lists both; recommend two, matching the requirement text).
- The curated TAO-holder demo persona address (must be OFAC-clean, DOA-validated at module load).

### Deferred Ideas (OUT OF SCOPE for Phase 46)
- All signing-binding: `payload-fingerprint-bittensor.ts`, `presign-hash-bittensor.ts`, `canonical-dispatch-bittensor.ts`, `simulation-bittensor.ts` (Phase 47).
- All `prepare_*` tools + the staking-extrinsic construction (`add_stake_limit` etc.) — Phase 47/48.
- `send_transaction` Bittensor arm + `PreparedTxBittensor` handle-store union member (Phase 47).
- The metadata-shortener-service architecture decision + `CheckMetadataHash` binding (Phase 47).
- `get_bittensor_setup_status` diagnostic (Phase 49).
- TAO-R-05 validator enrichment (delegate identity / commission) — Phase 48.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PAIR-NEV-* (reuse) | Persistent non-EVM account cache, eager-init, stale detection, memory opt-out | `src/wallet/non-evm-account-store.ts` already generic; widen `NonEvmChain` + `VALID_CHAINS` by one entry (`:43`/`:45`). Zero schema change. §D |
| TAO-PAIR-01 | `pair_bittensor_ledger()` opens Polkadot Generic app over USB-HID via `@zondax/ledger-substrate getAddressEd25519`; returns SS58 (prefix 42) verbatim + VERIFY-ON-DEVICE block; states ed25519 coldkey; SS58 first-N test vectors hardcoded as literal anchors | SDK probe §SDK-A: `getAddressEd25519(path, 42)` → `{address, pubKey}`; path `"44'/354'/0'/0'/0'"` (5-level). Test vectors derivable offline via `encodeAddress(pubKey, 42)` §Code-3 |
| TAO-PAIR-02 | `get_bittensor_status()` → `{paired, address, derivationPath, rpcEndpoint, staleAccountWarning?}`; PAIR-NEV restore; 30-day stale | Mirror `get_solana_status.ts` verbatim shape. §Patterns-2 |
| TAO-R-01 | `get_bittensor_balance({wallet})` → free + staked TAO (RAO, 9 decimals); default `wss://entrypoint-finney.opentensor.ai:443`, `BITTENSOR_RPC_URL` override | `api.query.system.account(addr).data.free` (free RAO) + `api.call.stakeInfoRuntimeApi.getStakeInfoForColdkey(coldkey)` (sum of `.stake`). §Reads |
| TAO-R-02 | `get_bittensor_stake({wallet})` → per-(hotkey,netuid) alpha + TAO-equiv (via subnet price); every amount labeled with its token (alpha vs TAO) | `getStakeInfoForColdkey` → `Vec<{hotkey,coldkey,netuid,stake,locked,emission,...}>` (`.stake` is ALPHA); `api.call.swapRuntimeApi.currentAlphaPrice(netuid)` or `simSwapAlphaForTao(netuid, alpha)` for TAO-equiv. §Reads |
| TAO-R-03 | `get_bittensor_subnets()` (netuid + name + reserves + alpha price); `get_bittensor_validators({netuid?})` (hotkeys + identity + take% + registration) | `api.call.subnetInfoRuntimeApi.getAllDynamicInfo()` / `getDynamicInfo(netuid)` → `{netuid, subnetName(bytes), tokenSymbol(bytes), alphaIn, taoIn, movingPrice, ownerHotkey,...}`. Validators: `api.query.subtensorModule.validatorPermit(netuid)` (Vec<bool>, len 256) + `identitiesV2` + `delegates`/`childkeyTake`. §Reads |
| TAO-R-04 | Persist under `chain:"bittensor"`; `pairedNonEvmChains` includes `"bittensor"`; `bittensorRpcConfigured`; one OFAC-clean TAO persona DOA-validated at load | `NonEvmChain` widening (§D); `get_vaultpilot_config_status` additive fields (Set auto-dedups); `bittensor-persona.ts` sibling mirror of `solana-persona.ts`, DOA via `decodeAddress(addr)` (throws on bad SS58). §Patterns-7 |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ledger pairing (USB-HID address fetch) | Hardware transport (`src/wallet/`) | Tool layer (`src/tools/`) | Per-call USB-HID transport opens/closes around one APDU; tool orchestrates demo-refusal + persistence. Identical to Solana. |
| Subtensor RPC reads | Chain client (`src/chains/bittensor/`) | Tool layer | `@polkadot/api` `ApiPromise` singleton owns the WS connection; tools call decoded read helpers. Mirror of `src/chains/solana/`. |
| SS58 address encode/validate | Chain client / util-crypto | Pairing transport | Device returns SS58 pre-encoded; util-crypto `decodeAddress` is the full-checksum gate + persona DOA + test-vector derivation. |
| Account persistence | Wallet store (`non-evm-account-store.ts`) | Config (`non-evm-storage.ts`) | Generic store already owns the JSON cache; only the `NonEvmChain` union widens. |
| Demo persona | Demo registry (`src/demo/`) | — | Sibling `bittensor-persona.ts`; SS58 literal-union can't merge into EVM/Solana persona types (same reason Solana got its own). |
| Decimal (RAO/alpha) arithmetic | Read helpers (`src/chains/bittensor/`) | — | Phase 46 is read-only formatting (bigint RAO → decimal string). The `parseBittensorAmountStrict` *input* guard is a Phase-47 prepare-side concern. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@polkadot/api` | 16.5.6 | Subtensor WS client; metadata-driven `api.query.*` / `api.call.*` typed reads | The canonical Substrate JS client; auto-loads subtensor metadata over RPC so `subtensorModule` + runtime APIs are typed dynamically. `[VERIFIED: installed + ESM import + live RPC probe]` |
| `@zondax/ledger-substrate` | 2.3.4 | Ledger Polkadot Generic app wrapper (`PolkadotGenericApp`) — `getAddressEd25519` for pairing | Zondax maintains the Polkadot/Substrate Ledger app + its JS SDK; there is no first-party `@ledgerhq/hw-app-*` for Substrate. `[VERIFIED: installed + .d.ts type-check]` |
| `@polkadot/util-crypto` | 14.0.3 | `decodeAddress`/`encodeAddress` (SS58 prefix 42), `blake2AsU8a` | SS58 full-checksum validation gate + persona DOA + offline test-vector derivation. Pinned to `@polkadot/api`'s range (`^14.0.3`) to avoid the multiple-versions warning. `[VERIFIED: installed + round-trip]` |

### Supporting (already in the repo — reused, no install)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@ledgerhq/hw-transport-node-hid` | 6.32.0 (repo-pinned) | USB-HID transport injected into `PolkadotGenericApp(transport)` | Pairing. Same dep the Solana/TRON/BTC transports already use — dedupe to the existing pin, do NOT install a second copy. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@polkadot/api` | `polkadot-api` (papi) 2.x | Lighter tree-shaking + codegen'd descriptors, all pure-JS, BUT a larger conceptual shift (descriptor codegen build step, different signer abstraction) and zero Substrate precedent in this repo. **Skip for v2.7.** |
| `@polkadot/api` reads | `@taostats/sdk` / `@iamnivek/taostat-ts-sdk` | REST wrappers over taostats.io (needs API key). **Cherry-pick ONLY for read-side enrichment** (historical APY, validator display names) — never for the read path's source-of-truth or any tx construction. Optional, deferred. |
| `@polkadot/api` reads | `bittensor` npm package | `1.0.0`, last published 2023 — abandoned stub, unrelated. **AVOID.** |

**Installation:**
```bash
npm install @polkadot/api@16.5.6 @zondax/ledger-substrate@2.3.4 @polkadot/util-crypto@14.0.3
```

**Version verification (run at execute time — confirm no newer minor regressed ESM):**
```bash
npm view @polkadot/api version            # 16.5.6 (published 2026-03-23)
npm view @zondax/ledger-substrate version  # 2.3.4 (published 2026-06-01 — 2 days old; see SUS note)
npm view @polkadot/util-crypto version     # 14.0.3
```

## Package Legitimacy Audit

> slopcheck 0.6.1 ran successfully (the `--json` flag is unsupported in this version; plain `slopcheck install` used). All three packages verified on the **npm** registry (correct ecosystem for a Node.js phase).

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `@polkadot/api` | npm | published 2026-03-23 (mature line, v16.x) | github.com/polkadot-js/api | [OK] | Approved |
| `@polkadot/util-crypto` | npm | v14.0.3 (mature) | github.com/polkadot-js/common | [OK] | Approved |
| `@zondax/ledger-substrate` | npm | published 2026-06-01 (**2 days old at research time**) | github.com/Zondax/ledger-substrate-js | [OK] | Approved — see SUS note |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `@zondax/ledger-substrate@2.3.4` is freshly published (2 days). slopcheck rates it [OK] (established package line, known publisher Zondax, prior versions long-standing) and it has **no postinstall script** (`npm view ... scripts.postinstall` = empty). The freshness is a normal Zondax cadence release, not a new-package signal. **Recommendation:** the planner MAY pin `2.3.4` exactly (not `^2.3.4`) to prevent a silent bump to an even-newer release between research and execute, and re-run `slopcheck install` at execute time. Not a blocker.

Native transitive note: installing `@zondax/ledger-substrate` in an isolated dir pulled `@ledgerhq/hw-transport-node-hid → node-hid + usb` (native, `prebuild-install` deprecation warning). In the repo this **dedupes to the existing pin** — the SDK's compiled JS references only the abstract `Transport` type (`import type Transport from '@ledgerhq/hw-transport'`), zero `node-hid` references. Not new native weight.

## Architecture Patterns

### System Architecture Diagram

```
agent (Claude Code / Cursor / Desktop)
   │  stdio (MCP protocol)
   ▼
vaultpilot-mcp
   │
   ├─ pair_bittensor_ledger ──────────────┐
   │     │ demo-mode FIRST refusal         │ (TAO-PAIR-01)
   │     ▼                                  │
   │  src/wallet/ledger-bittensor-transport.ts
   │     │ openTransport() [USB-HID, per-call open/close]
   │     │ new PolkadotGenericApp(transport)
   │     │ .getAddressEd25519("44'/354'/0'/0'/0'", 42)
   │     ▼                                  │
   │  { address: SS58, pubKey: hex } ◄──────┘  Ledger device (Polkadot Generic app)
   │     │                                       (the only trusted display — confirms SS58)
   │     ▼
   │  saveAccount({ chain:"bittensor", address, derivationPath, pairedAt })
   │     ▼
   │  ~/.vaultpilot-mcp/non-evm-accounts.json  (0o600 / 0o700)
   │
   ├─ get_bittensor_status ── listAccounts({chainFilter:"bittensor"})  (TAO-PAIR-02)
   │
   └─ get_bittensor_{balance,stake,subnets,validators}
         │
         ▼
      src/chains/bittensor/tao-rpc-client.ts
         │ _bittensorRegistry.getApi()  [ApiPromise singleton, lazy]
         ▼
      api.query.system.account(addr).data.free          ── free RAO       (TAO-R-01)
      api.call.stakeInfoRuntimeApi.getStakeInfoForColdkey ── alpha stake   (TAO-R-01/02)
      api.call.swapRuntimeApi.currentAlphaPrice(netuid)  ── alpha→TAO px   (TAO-R-02)
      api.call.subnetInfoRuntimeApi.getAllDynamicInfo()  ── subnets        (TAO-R-03)
      api.query.subtensorModule.validatorPermit/identitiesV2 ── validators (TAO-R-03)
         │  WSS (read-only — NO signer, NO key material)
         ▼
      wss://entrypoint-finney.opentensor.ai:443  (BITTENSOR_RPC_URL override)
```

### Recommended Project Structure (new files this phase)
```
src/chains/bittensor/
├── registry.ts          # lazy ApiPromise singleton; BITTENSOR_RPC_URL→fallback; _bittensorRegistry spy-affordance
├── types.ts             # branded Ss58Address + SS58_ADDRESS_RE + assertSs58Address (decodeAddress gate, prefix 42)
└── tao-rpc-client.ts     # getFreeBalance / getStakeInfo / getSubnets / getValidators; RAO→decimal-string formatting

src/wallet/
└── ledger-bittensor-transport.ts   # per-call USB-HID; PolkadotGenericApp; fetchBittensorAddress; _transport spy-affordance

src/tools/
├── pair_bittensor_ledger.ts        # mirror pair_solana_ledger.ts (demo-first refusal, VERIFY-ON-DEVICE, persist)
├── get_bittensor_status.ts         # mirror get_solana_status.ts
├── get_bittensor_balance.ts        # TAO-R-01
├── get_bittensor_stake.ts          # TAO-R-02
├── get_bittensor_subnets.ts        # TAO-R-03 (subnet enumeration)
└── get_bittensor_validators.ts     # TAO-R-03 (validator enumeration)

src/demo/
└── bittensor-persona.ts            # sibling registry; BittensorPersonaSlug union; DOA via decodeAddress

src/config/env.ts                    # ADD getBittensorRpcUrl() reading BITTENSOR_RPC_URL (mirror getSolanaRpcUrl)
```

**Additive seams in existing files (NO frozen body touched):**
- `src/wallet/non-evm-account-store.ts:43` — widen `NonEvmChain` union with `"bittensor"`; `:45` add to `VALID_CHAINS`.
- `src/tools/register-all.ts` — add `import "./pair_bittensor_ledger.js"` + 5 read-tool imports.
- `src/tools/get_vaultpilot_config_status.ts` — add `bittensorRpcConfigured`; `"bittensor"` flows into `pairedNonEvmChains` via the existing `new Set` (auto-dedup, zero aggregation change).
- `src/demo/state.ts` + `get_demo_wallet`/`set_demo_wallet` — per-chain active-persona widening (mirror the Solana carve).

### Pattern 1: Lazy ApiPromise singleton (mirror of `src/chains/solana/registry.ts`)
**What:** One `ApiPromise` per process, lazily created, URL resolved `BITTENSOR_RPC_URL → fallback` with once-per-process stderr warn.
**When to use:** Every subtensor read.
**Example:**
```typescript
// Source: probed live against wss://entrypoint-finney.opentensor.ai:443 (2026-06-03)
// + mirror of src/chains/solana/registry.ts getConnection() pattern.
import { ApiPromise, WsProvider } from "@polkadot/api";
import { getBittensorRpcUrl } from "../../config/env.js";
import { log } from "../../diagnostics/logger.js";

const PUBLIC_RPC_FALLBACK = "wss://entrypoint-finney.opentensor.ai:443";
let cachedApi: ApiPromise | null = null;
let cachedUrl: string | null = null;
let warnedFallback = false;

async function getApi(): Promise<ApiPromise> {
  if (cachedApi) return cachedApi;
  const override = getBittensorRpcUrl();
  const url = override ?? PUBLIC_RPC_FALLBACK;
  cachedUrl = url;
  if (override === null && !warnedFallback) {
    log("warn", `Using public subtensor RPC fallback (${url}); set BITTENSOR_RPC_URL for production reliability`);
    warnedFallback = true;
  }
  // noInitWarn:true suppresses the (expected) "RPC methods not decorated" /
  // "Unknown signed extensions" console noise — subtensor declares custom
  // extensions (SubtensorTransactionExtension, DrandPriority) + custom RPCs.
  cachedApi = await ApiPromise.create({ provider: new WsProvider(url), noInitWarn: true });
  return cachedApi;
}

// ESM spy-affordance per CLAUDE.md — tao-rpc-client.ts calls _bittensorRegistry.getApi()
export const _bittensorRegistry = { getApi, getResolvedRpcUrl: () => { if (cachedUrl === null) void getApi(); return cachedUrl as string; }, getBittensorRpcUrl };
```
**Note:** `ApiPromise.create` is async (unlike viem/Solana `new Connection`). `get_bittensor_status` MUST surface `rpcEndpoint` from the resolved URL WITHOUT forcing a connection (use the resolved-URL helper, which can return the string before connecting), so a status check on an unreachable RPC still returns `{paired:true,...}` instead of hanging. Mirror `get_solana_status`'s never-errors contract.

### Pattern 2: Per-call USB-HID transport + SS58 pre-encoded address (mirror `ledger-solana-transport.ts`)
**What:** Open a fresh USB-HID transport, construct `PolkadotGenericApp(transport)`, call `getAddressEd25519`, close in `finally`.
**Key divergence from Solana:** Solana's `getAddress` returns `{address: Buffer}` (raw 32-byte pubkey) requiring `bs58.encode`. **Bittensor's `getAddressEd25519` returns `{address: string, pubKey: string}` where `address` is ALREADY the SS58-encoded string** — no client-side encode needed for pairing. The `pubKey` hex is retained for the test-vector anchor + persona DOA.
**Example:**
```typescript
// Source: @zondax/ledger-substrate@2.3.4 dist/generic_app.d.ts + dist/common.d.ts (type-checked)
import TransportNodeHidModule from "@ledgerhq/hw-transport-node-hid";
import pkg from "@zondax/ledger-substrate";          // CJS — default import
const { PolkadotGenericApp } = pkg;                   // named import ALSO works under NodeNext (verified)
const TransportNodeHid: any = (TransportNodeHidModule as any).default ?? TransportNodeHidModule;

export const DEFAULT_BITTENSOR_DERIVATION_PATH = "44'/354'/0'/0'/0'"; // 5-level — required by the app
export const BITTENSOR_SS58_PREFIX = 42;

async function fetchBittensorAddress(
  derivationPath = DEFAULT_BITTENSOR_DERIVATION_PATH,
): Promise<{ address: string; pubKey: string }> {
  const transport = await openTransport();            // throws LedgerDeviceNotConnectedError if no device
  try {
    const app = new PolkadotGenericApp(transport);    // no txMetadata args needed for address fetch
    // getAddressEd25519(bip44Path, ss58prefix, showAddrInDevice?) → { address: SS58, pubKey: hex }
    const { address, pubKey } = await app.getAddressEd25519(derivationPath, BITTENSOR_SS58_PREFIX);
    return { address, pubKey };
  } finally {
    try { await transport.close(); } catch (e) { /* log warn */ }
  }
}
```
**App-not-open detection:** Solana diagnoses "wrong app" via `getAppConfiguration()` throwing. The generic app exposes `getVersion(transport, cla)` / a `getVersion` method on `BaseApp`; probe it before `getAddressEd25519` and map a throw to a `BITTENSOR_APP_NOT_OPEN` errorCode (mirror `LedgerSolanaAppNotOpenError`). Verify the exact version-probe call at execute time against `dist/generic_app.js` (`GET_VERSION` INS = 0 exists; `BaseApp` from `@zondax/ledger-js` provides the method).

### Pattern 3: Decoded one-call reads (prefer runtime APIs over raw storage decode)
**What:** subtensor exposes custom runtime APIs (`api.call.*`) returning fully-decoded stake/subnet info in one round-trip — vastly simpler than decoding raw `api.query.subtensorModule.*` storage maps (which churned across the dTAO upgrade).
**When to use:** All of TAO-R-01/02/03.
**Example:**
```typescript
// Source: probed live (2026-06-03, node-subtensor spec 413)
const api = await _bittensorRegistry.getApi();

// TAO-R-01 free balance (RAO, u128 → bigint via .toBigInt())
const acct = await api.query.system.account(ss58Address);
const freeRao = acct.data.free.toBigInt();            // shape: { nonce, consumers, providers, sufficients, data:{free,reserved,frozen,flags} }

// TAO-R-01/02 staked positions — Vec<{hotkey,coldkey,netuid,stake,locked,emission,taoEmission,drain,isRegistered}>
// `.stake` is ALPHA (per-subnet token), NOT TAO. Label every amount with its token.
const stakeInfo = await api.call.stakeInfoRuntimeApi.getStakeInfoForColdkey(ss58Address);
const rows = stakeInfo.toJSON() as Array<{ hotkey: string; netuid: number; stake: string|number; isRegistered: boolean }>;

// TAO-R-02 alpha→TAO conversion for TAO-equivalent display
const alphaPriceRao = await api.call.swapRuntimeApi.currentAlphaPrice(netuid);   // RAO per alpha (fixed-point)
// or, exact expected-out for a given alpha amount:
const taoOut = await api.call.swapRuntimeApi.simSwapAlphaForTao(netuid, alphaRao);

// TAO-R-03 subnet enumeration — Vec of DynamicInfo (name + tokenSymbol are byte arrays → decode to string)
const allSubnets = await api.call.subnetInfoRuntimeApi.getAllDynamicInfo();
// each: { netuid, ownerHotkey, ownerColdkey, subnetName:[u8], tokenSymbol:[u8], alphaIn, alphaOut, taoIn, movingPrice, subnetIdentity, ... }
```

### Anti-Patterns to Avoid
- **Decoding raw `api.query.subtensorModule.alpha`/`totalHotkeyAlpha`/`stakingHotkeys` storage maps by hand.** The dTAO upgrade reshuffled these; the live chain is authoritative and the runtime APIs return decoded positions in one call. Use `api.call.stakeInfoRuntimeApi.*`. Document the raw-storage names only as a fallback note.
- **Treating `.stake` (alpha) as TAO.** `getStakeInfoForColdkey` rows carry alpha (per-subnet token). Surfacing it as "TAO staked" without the per-netuid price conversion is the exact off-by-unit class CLAUDE.md warns about. Every amount must be labeled `alpha` vs `TAO`.
- **`new Connection`-style synchronous client construction.** `ApiPromise.create` is async; a synchronous getter that returns a half-open api will throw on first query. The registry getter is `async`.
- **Forcing a connection inside `get_bittensor_status`.** Status must never hang on an unreachable RPC — resolve `rpcEndpoint` from the URL string, not from a live connection.
- **Leaving the WS connection open without bound.** `ApiPromise` holds an open WebSocket. For a long-lived MCP process the singleton is correct (mirrors the Solana `Connection` singleton); do NOT open a new `ApiPromise` per read.
- **Using `(Module as any).default ?? Module` confusion for the *named* Zondax export.** Verified: `@zondax/ledger-substrate` supports BOTH `import pkg from` (then `pkg.PolkadotGenericApp`) AND `import { PolkadotGenericApp }` under NodeNext. Pick one and stay consistent; the default-import + destructure form matches the existing transport-file idiom most closely.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SS58 encode/decode + checksum | Custom base58check + blake2 checksum | `@polkadot/util-crypto encodeAddress(pubkey,42)` / `decodeAddress` | SS58 has a prefix-dependent checksum; hand-rolling silently accepts wrong-prefix addresses. Verified round-trip §Code-3. |
| Subtensor stake-position decode | Manual SCALE decode of `alpha`/`totalHotkeyAlpha` storage | `api.call.stakeInfoRuntimeApi.getStakeInfoForColdkey` | The decoded runtime API absorbs the dTAO storage churn; hand-decode breaks on the next runtime upgrade. |
| Subnet metadata + alpha price | Manual AMM `x·y=k` from reserves | `api.call.swapRuntimeApi.currentAlphaPrice` / `simSwapAlphaForTao` | The subnet AMM is Uniswap-V3-style concentrated-liquidity; `x·y=k` gives wrong prices. (Load-bearing for Phase 47 slippage, surfaced here for the read-side TAO-equiv.) |
| RAO ↔ decimal-string | ad-hoc `Number(rao)/1e9` | bigint string math (9 decimals), mirror `formatLamportsToSol` | `Number` loses precision above 2^53; RAO is u128. Mirror the existing lamports formatter. |
| Ledger Substrate APDU framing | Raw APDU exchange | `@zondax/ledger-substrate PolkadotGenericApp` | Chunking (250-byte), INS table, ed25519 scheme byte all handled. |

**Key insight:** subtensor's read surface is metadata-driven and churns across runtime upgrades. The decoded runtime APIs (`api.call.*`) are the stable contract; raw storage decode is the brittle path. Pin reads to the runtime APIs and re-introspect at execute time (`Object.keys(api.call.stakeInfoRuntimeApi)`).

## Runtime State Inventory

> Phase 46 is additive greenfield (a NEW chain). No rename/refactor. The only "state" touched:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | The persistent cache `~/.vaultpilot-mcp/non-evm-accounts.json` gains `chain:"bittensor"` records. Schema unchanged. | Code-only: widen `NonEvmChain` union. No data migration — existing Solana/TRON/BTC records untouched. |
| Live service config | None — no external service stores a "bittensor" string. | None. |
| OS-registered state | None. | None — verified: no Task Scheduler / pm2 / systemd registration in this codebase. |
| Secrets/env vars | NEW env var `BITTENSOR_RPC_URL` (optional override). No secret. | Code-only: add `getBittensorRpcUrl()` reader. |
| Build artifacts | NEW package deps added to `package.json`; pkg binary `scripts` + `assets` allowlist may need `@polkadot/*` / `@zondax/*` CJS paths added for the v1.4 binary build. | Flag for the planner: the `pkg` config (`package.json:34-44`) lists per-dep CJS asset globs. If the binary build is in scope, add `@polkadot`/`@zondax` paths. (Binaries are a separate verify-phase — likely NOT this phase.) |

**Nothing found requiring data migration.** The cache is forward-compatible by construction (the `NonEvmChain` union widening is the documented Solana/TRON/BTC precedent — TRON and BTC each slotted in with exactly this one-line change).

## Common Pitfalls

### Pitfall 1: Wrong derivation-path length
**What goes wrong:** Reusing Solana's 3-level path shape (`"44'/354'/0'"`) → the Polkadot Generic app rejects with an invalid-path-length error.
**Why it happens:** Solana's `DEFAULT_SOLANA_DERIVATION_PATH` is 3-level; the instinct is to clone it.
**How to avoid:** The Zondax SDK declares `requiredPathLengths: [5]` (verified in `dist/generic_app.js:446`). Use the **5-level** string `"44'/354'/0'/0'/0'"`. `serializePath` splits on `/` and validates length.
**Warning signs:** `ResponseError: Invalid path length` from `getAddressEd25519`.

### Pitfall 2: alpha-vs-TAO unit confusion in reads
**What goes wrong:** Displaying `getStakeInfoForColdkey().stake` (alpha) as "TAO staked".
**Why it happens:** Both are 9-decimal RAO-scaled; the numbers look interchangeable but are priced differently per subnet.
**How to avoid:** Per-field unit typing. `.stake` is ALPHA; convert to TAO-equivalent via `swapRuntimeApi.currentAlphaPrice(netuid)` only for the display column, and label both. (Read-side analog of the Phase-47 per-extrinsic unit-typing.)
**Warning signs:** A "TAO staked" total that doesn't reconcile with `system.account.data.frozen` or on-chain explorers.

### Pitfall 3: `@polkadot/util` multiple-versions warning
**What goes wrong:** A second major of `@polkadot/util`/`util-crypto` gets deduped into the process → runtime warning "@polkadot/util has multiple versions" + potential SS58 inconsistency.
**Why it happens:** A transitive dep pulls a different `@polkadot/util` major.
**How to avoid:** Pin `@polkadot/util-crypto` to the same range `@polkadot/api@16.5.6` uses (`^14.0.3`) and dedupe. Lockfile-hygiene check at execute time: `npm ls @polkadot/util @polkadot/util-crypto` should show a single version each.
**Warning signs:** stderr warning at first import — which would cross the wires into the MCP stdout channel if logging discipline slips (CLAUDE.md stderr-for-diagnostics).

### Pitfall 4: console noise crossing into stdout
**What goes wrong:** `ApiPromise.create` without `noInitWarn:true` prints "RPC methods not decorated" + "Unknown signed extensions" to console → if `@polkadot/api` writes to stdout, it corrupts the MCP protocol stream.
**Why it happens:** subtensor declares custom signed extensions + custom RPCs the generic registry doesn't know.
**How to avoid:** Pass `noInitWarn: true` to `ApiPromise.create`. Verify at execute time that `@polkadot`'s internal logger routes to stderr (it uses `console.*`); if any reaches stdout, wrap or suppress. (Observed in the probe: the warnings go to stderr/console.error — but assert this in the MCP context.)
**Warning signs:** Client disconnect / JSON-parse errors on the agent side after the first Bittensor read.

### Pitfall 5: `get_bittensor_status` hanging on unreachable RPC
**What goes wrong:** Status forces `ApiPromise.create` (a live WS connect) to report `rpcEndpoint`, hanging when the RPC is down.
**Why it happens:** Naive mirror of Solana's `getResolvedRpcUrl()` which is cheap because `new Connection` doesn't connect eagerly — but `ApiPromise.create` DOES open the socket.
**How to avoid:** Resolve `rpcEndpoint` from the URL string (env-or-fallback) WITHOUT calling `getApi()`. Status reads only the persistent cache + the resolved URL string.
**Warning signs:** `get_bittensor_status` timing out when offline.

## Code Examples

### SS58 prefix-42 encode + round-trip (test-vector derivation for TAO-PAIR-01)
```typescript
// Source: @polkadot/util-crypto@14.0.3 — verified empirically 2026-06-03
import { encodeAddress, decodeAddress } from "@polkadot/util-crypto";
import { u8aToHex, hexToU8a } from "@polkadot/util";

const pubkey = hexToU8a("0x" + "01".repeat(32));
const ss58 = encodeAddress(pubkey, 42);
// → "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT"  (canonical Bittensor "5…" shape)
u8aToHex(decodeAddress(ss58)) === "0x" + "01".repeat(32);  // true (clean round-trip)
```
**Test-vector strategy for TAO-PAIR-01:** the success criterion is "SS58 derivation first-N test vectors hardcoded as literal anchors". Since `getAddressEd25519` returns the SS58 pre-encoded by the device, the offline-derivable anchor is `encodeAddress(<known pubkey>, 42)`. Pin a small table of `{ pubKeyHex → ss58 }` literals computed via `encodeAddress` (NOT a live-device read — the device round-trip is the integration test). This mirrors the BTC BIP-32-test-vector hardcoded-literal convention (`bc1q…`/`bc1p…` anchors). NO `beforeAll`-snapshot.

### Decimal RAO formatting (read-side, 9 decimals — mirror `formatLamportsToSol`)
```typescript
// 1 TAO = 1_000_000_000 RAO (verified). Pure bigint → decimal string.
const RAO_PER_TAO = 1_000_000_000n;
function formatRaoToTao(rao: bigint): string {
  const whole = rao / RAO_PER_TAO;
  const frac = rao % RAO_PER_TAO;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(9, "0").replace(/0+$/, "")}`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pre-dTAO: single global stake per (hotkey,coldkey) in TAO | Post-dTAO: per-(hotkey,coldkey,netuid) stake in ALPHA, AMM-priced to TAO | Rao/dTAO upgrade (2024-25) | Read tools MUST be per-netuid + alpha-denominated; TAO-equiv is a derived display via subnet price. |
| `newSubstrateApp(transport, "Polkadot")` factory (older Zondax SDK) | `new PolkadotGenericApp(transport, txMetadataChainId?, txMetadataSrvUrl?)` direct class | `@zondax/ledger-substrate` 2.x | The integration-map's `newSubstrateApp(...)` reference is STALE — there is no such export in 2.3.4. Use the class constructor. |
| `getAddress(account, change, addressIndex, ...)` (legacy `ISubstrateAppLegacy`) | `getAddressEd25519(bip44PathString, ss58prefix, showInDevice?)` | 2.x | Path is a single 5-level string, not 3 numeric args. |

**Deprecated/outdated (do not use):**
- `sign()` / `signRaw()` / `signWithMetadata()` (non-suffixed) — deprecated in 2.3.4; use the `*Ed25519` variants (Phase 47 concern).
- `SCHEME.SR25519` — deprecated; the generic app signs ED25519 (and ECDSA). Bittensor Ledger coldkey is ed25519.
- `bittensor` npm package — abandoned 2023 stub.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Polkadot **Generic** app and the Polkadot **DOT** app are the same Ledger app for TAO purposes (docs say "Polkadot (DOT) app"; Zondax SDK targets the Generic app). | Pattern 2 | LOW — both are the Zondax metadata-based Polkadot app; the SDK is the authority. Confirm the exact app name string shown on-device at the real-Ledger verify-phase. |
| A2 | The "app not open" detection via a `getVersion`/`getAppConfiguration`-equivalent throw works for the generic app as it does for Solana. | Pattern 2 | LOW — `GET_VERSION` INS exists; exact method name (`getVersion` on `BaseApp`) to confirm against `dist/generic_app.js` at execute time. Worst case: a different probe call. |
| A3 | `swapRuntimeApi.currentAlphaPrice(netuid)` returns RAO-per-alpha in a fixed-point form directly usable for TAO-equiv; `simSwapAlphaForTao` is the exact-out path. | Reads / TAO-R-02 | MEDIUM — verified the methods exist + return a number (`currentAlphaPrice(1) → 9818337`); the exact fixed-point scale (is it RAO, or 1e18-fixed?) must be confirmed against a known position at execute time. Mislabel risk on the TAO-equiv column only; the alpha figure (source of truth) is unaffected. |
| A4 | Validator enumeration for TAO-R-03 is `validatorPermit(netuid)` (Vec<bool>, len 256) cross-referenced with `uids`/`keys`/`identitiesV2`/`delegates`/`childkeyTake`. | Reads / TAO-R-03 | MEDIUM — `validatorPermit` + `identitiesV2` confirmed present; the exact join to get hotkey SS58 + take% is not fully traced. `neuronInfoRuntimeApi.getNeurons(netuid)` likely returns the decoded per-uid info in one call — prefer it; confirm shape at execute time. TAO-R-05 (delegate identity + commission enrichment) is explicitly Phase 48, so a minimal enumeration suffices here. |
| A5 | The curated demo persona address (a real OFAC-clean TAO holder) is selectable at commit time. | Persona / TAO-R-04 | LOW — same ritual as the Solana Binance-hot-wallet persona; the executor picks + DOA-validates + OFAC-checks at commit. No specific address pinned in research. |

## Open Questions

1. **Exact `currentAlphaPrice` fixed-point scale**
   - What we know: `currentAlphaPrice(1)` returns `9818337` (a small integer); subnet 1's `taoIn`/`alphaIn` reserves are known (`27843308137231` / `2835868802615994`).
   - What's unclear: whether the price is RAO-per-alpha, or a normalized fixed-point. (`taoIn/alphaIn ≈ 0.00982` ≈ `9818337/1e9` → strongly suggests RAO-fixed-point / 1e9-scaled.)
   - Recommendation: at execute time, reconcile `currentAlphaPrice(netuid)` against `getDynamicInfo(netuid).movingPrice` and `taoIn/alphaIn` for one live subnet; pin the scale as a documented constant. Default hypothesis: price × alpha / 1e9 = TAO.

2. **One-call validator enumeration vs manual join**
   - What we know: `neuronInfoRuntimeApi.getNeurons(netuid)` / `getNeuronsLite(netuid)` exist; `validatorPermit`/`identitiesV2`/`delegates` storage exist.
   - What's unclear: which path gives hotkey SS58 + validator-permit + take% with the fewest round-trips.
   - Recommendation: prefer `neuronInfoRuntimeApi.getNeuronsLite(netuid)` (decoded, one call) for the per-netuid list; fall back to `validatorPermit` + `identitiesV2` only if the lite shape lacks identity. Confirm at execute time.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | repo pins ≥18.17 | — |
| `@polkadot/api` | all reads | ✓ (installed in probe) | 16.5.6 | — |
| `@zondax/ledger-substrate` | pairing | ✓ (installed in probe) | 2.3.4 | — |
| `@ledgerhq/hw-transport-node-hid` | pairing | ✓ (repo-pinned) | 6.32.0 | — |
| subtensor public RPC `wss://entrypoint-finney.opentensor.ai:443` | reads | ✓ (reachable, spec 413) | — | `BITTENSOR_RPC_URL` override |
| Physical Ledger + Polkadot Generic app | pairing integration | ✗ (verify-phase only) | — | Demo persona for read flows; pairing unit-tested via `_transport` spy |

**Missing dependencies with no fallback:** none for unit-testable scope. The physical-Ledger pairing path is exercised only at the v2.7 real-Ledger verify-phase (consistent with how Solana/TRON/BTC shipped scaffolding — `_transport` spy-affordance covers the unit surface).

## Validation Architecture

> Nyquist validation is enabled (no `workflow.nyquist_validation: false` in config). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (repo-standard) |
| Config file | repo root (existing vitest setup) |
| Quick run command | `npx vitest run test/bittensor-*.test.ts --no-coverage` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TAO-PAIR-01 | `pair_bittensor_ledger` returns SS58 + VERIFY-ON-DEVICE; demo-mode refuses BEFORE transport open | unit (spy `_transport`) | `npx vitest run test/pair-bittensor-ledger.test.ts` | ❌ Wave 0 |
| TAO-PAIR-01 | SS58 first-N test vectors match `encodeAddress(pubKey,42)` literals | unit (pure) | `npx vitest run test/chains-bittensor-ss58.test.ts` | ❌ Wave 0 |
| TAO-PAIR-02 | `get_bittensor_status` → cache shape; never errors; 30-day stale flag; rpcEndpoint without live connect | unit (mock store) | `npx vitest run test/get-bittensor-status.test.ts` | ❌ Wave 0 |
| TAO-R-01 | free RAO → decimal TAO; staked alpha summed; RAO formatting edge cases (0, 1, trailing-zero trim) | unit (spy `_bittensorRegistry`) | `npx vitest run test/get-bittensor-balance.test.ts` | ❌ Wave 0 |
| TAO-R-02 | per-(hotkey,netuid) rows; alpha labeled distinct from TAO; TAO-equiv via price | unit (mock runtime API) | `npx vitest run test/get-bittensor-stake.test.ts` | ❌ Wave 0 |
| TAO-R-03 | subnet enumeration (name/symbol byte-decode); validator enumeration | unit (mock runtime API) | `npx vitest run test/get-bittensor-subnets.test.ts` | ❌ Wave 0 |
| TAO-R-04 | persists under `chain:"bittensor"`; `pairedNonEvmChains` includes it; `bittensorRpcConfigured`; persona DOA at load | unit | `npx vitest run test/bittensor-persona.test.ts` + config-status test | ❌ Wave 0 |
| Real-Ledger pair against mainnet (SS58 byte-match on-device) | manual | v2.7 verify-phase | N/A (physical device) |

### Sampling Rate
- **Per task commit:** `npx vitest run test/bittensor-*.test.ts test/pair-bittensor-ledger.test.ts test/get-bittensor-*.test.ts --no-coverage`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** full suite green before `/gsd-verify-work`; FROZEN-area zero-diff asserted (the signing modules are NOT touched this phase, but assert no accidental edit).

### Wave 0 Gaps
- [ ] `test/pair-bittensor-ledger.test.ts` — covers TAO-PAIR-01 (spy `_transport`, demo-refusal-before-open)
- [ ] `test/chains-bittensor-ss58.test.ts` — covers TAO-PAIR-01 (hardcoded `{pubKeyHex→ss58}` literals via `encodeAddress`)
- [ ] `test/get-bittensor-status.test.ts` — covers TAO-PAIR-02
- [ ] `test/get-bittensor-balance.test.ts` — covers TAO-R-01 (RAO formatter edge cases)
- [ ] `test/get-bittensor-stake.test.ts` — covers TAO-R-02 (alpha-vs-TAO labeling)
- [ ] `test/get-bittensor-subnets.test.ts` — covers TAO-R-03
- [ ] `test/bittensor-persona.test.ts` — covers TAO-R-04 (DOA throw on bad SS58)
- [ ] Shared fixtures: a mock `ApiPromise` shape returning the probed `getStakeInfoForColdkey` / `getDynamicInfo` JSON (derive from the real probe outputs in this RESEARCH, not hand-typed — re-capture if the SDK pin bumps)

## Security Domain

> `security_enforcement` enabled (absent = enabled). Phase 46 is read-only + pairing — no signing, no funds movement. The signing threat model is Phase 47.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface; pairing is local USB-HID. |
| V3 Session Management | no | The "session" is a persisted public-address record; no credentials. |
| V4 Access Control | no | Read-only public-chain data. |
| V5 Input Validation | yes | SS58 address validation via `decodeAddress` (full checksum) at the `wallet` arg boundary; reject non-prefix-42 / bad-checksum before any RPC. Branded `Ss58Address` type. |
| V6 Cryptography | yes (validate, never hand-roll) | SS58 checksum + blake2 via `@polkadot/util-crypto` only. No custom crypto. |
| V7 Error Handling / Logging | yes | stderr-for-diagnostics (CLAUDE.md); `@polkadot` console noise must not reach stdout (Pitfall 4). |

### Known Threat Patterns for the Substrate read/pair stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious/compromised RPC returns fabricated balances | Tampering / Information disclosure | Read-only display; no funds move on a read. Phase 47 binds signing to on-chain `CheckMetadataHash` (out of scope here). Surface `rpcEndpoint` so the user sees which RPC. |
| Wrong-prefix / look-alike SS58 accepted | Spoofing | `decodeAddress` checksum gate rejects bad addresses; branded type. |
| Derivation-path leak (shoulder-surfing) | Information disclosure | `derivationPath` surfaced in `get_bittensor_status` (caller's own status) but NOT in `list_paired_non_evm_accounts` — the existing store's documented defense; inherited free. |
| Demo-mode pairing of a real device | Elevation / misuse | Demo-mode FIRST refusal in `pair_bittensor_ledger` BEFORE transport open (mirror Solana T-DEMO-1). |
| stdout corruption from SDK logging | Denial of service (protocol break) | `noInitWarn:true` + stderr discipline (Pitfall 4). |

## Sources

### Primary (HIGH confidence)
- `@zondax/ledger-substrate@2.3.4` installed `dist/generic_app.d.ts` + `dist/common.d.ts` — `getAddressEd25519(path, ss58prefix, showInDevice?) → {address, pubKey}`; `requiredPathLengths:[5]`; `chunkSize:250`; `GenericeResponseAddress`/`GenericResponseSign` shapes; deprecated `sign`/`SR25519` markers.
- `@zondax/ledger-js@1.3.1` `dist/types.d.ts` + `dist/bip32.d.ts` — `BIP32Path = string`; `serializePath(path, requiredPathLengths?)`.
- Live subtensor RPC `wss://entrypoint-finney.opentensor.ai:443` (node-subtensor spec 413, probed 2026-06-03) — `signedExtensions` incl. `CheckMetadataHash`; full `subtensorModule` storage map; `api.call.*` runtime API surface; `getDynamicInfo`/`getStakeInfoForColdkey`/`currentAlphaPrice` decoded shapes; `system.account` shape.
- `@polkadot/api@16.5.6` + `@polkadot/util-crypto@14.0.3` raw `package.json` — `type:module` + conditional `exports` map (clean ESM/NodeNext); SS58 prefix-42 round-trip + blake2-256 + decimal→RAO verified empirically.
- Repo source: `src/chains/solana/{registry,sol-rpc-client}.ts`, `src/tools/{pair_solana_ledger,get_solana_status}.ts`, `src/wallet/{non-evm-account-store,ledger-solana-transport}.ts`, `src/demo/solana-persona.ts` — the exact mirror patterns.

### Secondary (MEDIUM confidence)
- `docs.learnbittensor.org/staking-and-delegation/using-ledger-hw-wallet` — Bittensor uses the Polkadot (DOT) app; `5EHVUN…` SS58 example confirms prefix-42 shape.
- `@zondax/ledger-polkadot` npm docs — BIP44 path `m/44'/354'/...` (coin type 354 = Polkadot/generic Substrate); confirms the 5-level path convention.
- Prior probes `/tmp/bittensor_raw_sdk.md` + `/tmp/bittensor_raw_integration.md` (2026-06-03) — corroborated and corrected below.

### Tertiary (LOW confidence — flagged for execute-time verification)
- `currentAlphaPrice` fixed-point scale (Open Question 1, Assumption A3).
- Exact one-call validator-enumeration path (Open Question 2, Assumption A4).

### Corrections to prior probe / integration map
- Integration map said `newSubstrateApp(transport, "Bittensor"|"Polkadot")` — **WRONG for 2.3.4**: the export is the `PolkadotGenericApp` class; use `new PolkadotGenericApp(transport)`.
- SDK probe noted `getAddressEd25519(path, ss58prefix?, ...)` with optional prefix — the `.d.ts` shows `ss58prefix` is **required** (`SS58Prefix = number`, non-optional positional). Pass `42` explicitly.
- Derivation path: prior notes wrote `"44'/354'/0'/0'/0'"` in one place — **CONFIRMED correct (5-level)**; do NOT use a 3-level Solana-shape path.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — both SDKs installed, type-checked against `.d.ts`, ESM-imported, slopcheck [OK].
- Architecture / read paths: HIGH — exact `api.call.*` paths + decoded shapes probed against the live chain.
- SS58 / derivation / decimals: HIGH — round-trips verified empirically; path length read from SDK source.
- Alpha→TAO price scale + validator-enum exact path: MEDIUM — methods confirmed present; exact scale/shape to pin at execute time (Open Questions 1-2).
- Persona address: LOW (not pinned) — executor selects + validates at commit (standard ritual).

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (30 days; `@zondax/ledger-substrate` is on a fast cadence — re-verify the version + re-run slopcheck at execute time; `@polkadot/api` 16.x is stable).
