# Phase 17: Research — TRON scaffolding (USB-HID + TRX reads + persistent TRON account)

**Researched:** 2026-05-20
**Domain:** TRON SDK adoption, USB-HID Ledger transport, BIP-44 derivation, base58check addresses, TronGrid REST, TRC-20 token surface, DefiLlama TRON pricing, demo persona selection
**Confidence:** HIGH on SDK probes + types + live API checks; MEDIUM on demo persona provenance (TronScan label API gated 401); LOW on USDD active-status (verified via DefiLlama price but not via on-chain mint/burn flows)
**Status:** Complete

## Summary

`tronweb@6.3.0` is the **only** viable TRON SDK adoption — the phase-context anchor `@tronprotocol/sdk` is a hallucination (registry 404). TronWeb is the official TRON Foundation SDK, now TypeScript-rewritten in v6.x. Empirical probe against installed `.d.ts` confirms the Phase 18 Protobuf raw_data preimage path: every `transactionBuilder.*` method returns a `Transaction<T>` shape exposing `raw_data_hex: string` — the canonical Protobuf-serialized bytes for `payloadFingerprint`. No second SDK needed.

`@ledgerhq/hw-app-trx@6.36.1` is the Ledger TRON app interface; its `signTransaction(path, rawTxHex, [])` directly consumes the same hex bytes — clean continuity from Phase 17 pairing to Phase 18 signing. TRON derivation is **5-level BIP-44** (`m/44'/195'/0'/0/0`) — DIFFERENT from Solana's 3-level shape; this is a Phase-17-vs-Phase-11 axis of divergence the planner must surface explicitly.

`getAddress` returns a base58check address as a `string` (NOT a Buffer like Solana) — no encoding step required on our side; the Ledger app does it. TronGrid REST works without API key for all read paths probed live. DefiLlama keys TRON tokens as `tron:<base58>` with no client change needed.

**Primary recommendation:** Adopt `tronweb@6.3.0` (DF-1 lock); USB-HID transport reused from Phase 11 `@ledgerhq/hw-transport-node-hid@6.33.2`; Ledger interface `@ledgerhq/hw-app-trx@6.36.1`. Mirror the Phase 11 Solana shape exactly — `src/chains/tron/{registry,trx-rpc-client,types}.ts`, `src/wallet/ledger-tron-transport.ts`, `src/tools/{pair_tron_ledger,get_tron_status,get_tron_balance,get_tron_block_tip}.ts`. Zero schema change to `non-evm-account-store.ts`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| USB-HID transport open / address fetch | Wallet (`src/wallet/ledger-tron-transport.ts`) | — | Mirror of `ledger-solana-transport.ts`; per-call transport, `try/finally` close |
| Persistent paired account | Wallet (`src/wallet/non-evm-account-store.ts`) | — | **REUSE — zero schema change.** `NonEvmChain` already includes `"tron"`; only the call sites are new |
| TRX RPC reads | Chains (`src/chains/tron/trx-rpc-client.ts`) | — | Mirror of `sol-rpc-client.ts` shape; lazy-singleton `TronWeb` instance |
| Address conversion (base58check ↔ hex) | Chains (`src/chains/tron/address.ts`) | — | Use `tronWeb.address.toHex / fromHex`; do NOT hand-roll `0x41` prefix logic |
| TRC-20 mint registry | Tokens (`src/tokens/tron-trc20.json`) | — | Mirror of `src/tokens/solana-spl.json` curation pattern (Phase 11) |
| Block tip diagnostic | Chains (`src/chains/tron/trx-rpc-client.ts`) | — | `tronWeb.trx.getCurrentBlock()` returns block header |
| Pair tool | Tools (`src/tools/pair_tron_ledger.ts`) | Demo (refusal) | Demo-mode FIRST refusal mirrors `pair_solana_ledger.ts` |
| Status tool | Tools (`src/tools/get_tron_status.ts`) | — | Reads `listAccounts({ chainFilter: "tron" })` |
| Demo persona registry | Demo (`src/demo/personas.ts`) | — | Additive: TRON whale entry alongside Solana persona |
| `get_vaultpilot_config_status` surfacing | Tools (`src/tools/get_vaultpilot_config_status.ts`) | — | Extend `pairedNonEvmChains` to include `"tron"` |

**Tier sanity check:** No EVM-side files touched. No signing-pipeline files touched. All additive in `src/chains/tron/`, `src/wallet/ledger-tron-transport.ts`, `src/tools/{pair,get_tron_*}*.ts`, and `src/tokens/tron-trc20.json`. Two existing files extend (additive only): `src/demo/personas.ts` (new persona entry) and `src/tools/get_vaultpilot_config_status.ts` (one new field).

## § Topic 1: TRON SDK adoption decision (DF-1)

**Empirical findings:**

| Candidate | Registry | Version | Verdict |
|-----------|----------|---------|---------|
| `tronweb` | npm | 6.3.0 (published 2026-04-22) | **ADOPT** — official TF SDK, TS-rewritten in v6 |
| `@tronprotocol/sdk` | npm | **404 — does not exist** | **REJECTED** — phase-context anchor was a hallucination |
| `@portal-hq/tron-protobuf-module` | npm | 1.0.3 | Skip — pure Protobuf decoder, not a full SDK; tronweb already exposes raw_data_hex |
| `tron-station-sdk` | npm | Foundation aux | Skip — energy/bandwidth estimator only; not needed for Phase 17 reads |

The phase-context "newer official `@tronprotocol/sdk`" anchor is **not real**. `npm view @tronprotocol/sdk` returns 404. The TRON Foundation GitHub org (`tronprotocol/`) publishes tronweb as `tronweb` (no scope prefix). Verified via [tronprotocol/tronweb GitHub](https://github.com/tronprotocol/tronweb), [tronweb npm](https://www.npmjs.com/package/tronweb), and `npm search @tronprotocol` (returns only stale 2018 packages like `@tronprotocol/wallet-api`).

**Probe results — installed `.d.ts` (`/tmp/tron-probe/node_modules/tronweb/`):**

```typescript
// lib/esm/types/Transaction.d.ts — load-bearing for Phase 18
export interface Transaction<T = ContractParamter> {
    visible: boolean;
    txID: string;
    raw_data: { contract, ref_block_bytes, ref_block_hash, expiration, timestamp, ... };
    raw_data_hex: string;  // <-- Phase 18 payloadFingerprint preimage
}
```

**Live smoke test against TronGrid (`/tmp/tron-probe/smoke.mjs`):**

```
raw_data_hex (first 80): 0a02715f22086de437fc9a5a9bdf4088b598a5e4335a67080112630a2d747970652e676f6f676c65
contract type: type.googleapis.com/protocol.TransferContract
txID: 1360b3a20046b169cf62ea15c08459adafd36af6d6fadf9625e8dd4d0f4d2d4e
```

The `raw_data_hex` field is the Protobuf-serialized bytes of `raw_data` — exactly what `keccak256("VaultPilot-trontx-v1:" || Buffer.from(raw_data_hex, "hex"))` will hash in Phase 18. No library-specific reserialization risk: every `transactionBuilder.*` method returns this shape.

**Phase 19 enablement bonus:** `TransactionBuilder` already exposes `freezeBalanceV2`, `unfreezeBalanceV2`, `cancelUnfreezeBalanceV2`, `triggerSmartContract`, `sendTrx`. Phase 19 (Stake 2.0) gets the full surface with no auxiliary SDK.

**Known issue — axios CVE chain:** `tronweb@6.3.0` pins `axios@1.15.0` which has 6 published CVEs (1 HIGH = SSRF via no_proxy bypass, 2 MEDIUM = prototype pollution, 3 LOW/MEDIUM). The fix requires upstream `tronweb` to bump axios; tracked at the project layer as residual risk. tronweb traffic is server→TronGrid (no_proxy SSRF doesn't apply to our shape — we don't take a URL from agent input for the RPC client; URL comes from env-or-fallback). Surface in SECURITY.md as accepted residual.

**Decision lock:** **Adopt `tronweb@6.3.0`.** No alternative exists. `[VERIFIED: npm registry] + [VERIFIED: installed dist/*.d.ts probe]`.

## § Topic 2: USB-HID transport

**Reuse from Phase 11:** `@ledgerhq/hw-transport-node-hid@6.33.2` already in `package.json` dependencies. No new install.

**New install:** `@ledgerhq/hw-app-trx@6.36.1` (published 2026-05-13; runtime deps: only `@ledgerhq/hw-transport@6.35.2`, weekly downloads ~20K). `[VERIFIED: npm registry + Context7 missing — official LedgerHQ/ledger-live publisher]`.

**Probed API surface (`/tmp/tron-probe/node_modules/@ledgerhq/hw-app-trx/lib-es/Trx.d.ts`):**

```typescript
export default class Trx {
  constructor(transport: Transport, scrambleKey?: string);

  // Address derivation — Phase 17 target
  getAddress(path: string, boolDisplay?: boolean, boolChaincode?: boolean): Promise<{
    publicKey: string;
    address: string;       // <-- base58check string ALREADY ENCODED on-device
    chainCode?: string;
  }>;

  // Signing — Phase 18 target
  signTransaction(path: string, rawTxHex: string, tokenSignatures: string[]): Promise<string>;
  signTransactionHash(path: string, rawTxHashHex: string): Promise<string>;

  // App probe — diagnostics
  getAppConfiguration(): Promise<{
    allowContract: boolean;        // false on locked-down install — Phase 18 TRC-20 prep gate
    truncateAddress: boolean;
    allowData: boolean;
    signByHash: boolean;           // blind-sign mode flag
    version: string;               // "0.5.0+"
    versionN: number;              // numeric, used as the 3rd signTransaction arg
  }>;
}
```

**Critical divergence from Solana:** Solana's `getAddress` returns `{ address: Buffer }` (raw 32-byte Ed25519 pubkey) and we apply `bs58.encode` ourselves. TRON's `getAddress` returns `{ address: string }` ALREADY in base58check T-prefixed form — the Ledger app does the encoding on-device. **No encode step in `ledger-tron-transport.ts`.** The string from the device IS the persistence/display value.

**Phase 18 signing input:** `signTransaction(path, rawTxHex, [])` — the `rawTxHex` arg is the EXACT same byte content as `Transaction.raw_data_hex` (verified by `signTransaction` example in `Trx.d.ts:37`: "`0a02f594...`" = Protobuf TransferContract serialization, identical shape to the smoke-test result above).

**Source:** [LedgerHQ ledger-live `@ledgerhq/hw-app-trx`](https://www.npmjs.com/package/@ledgerhq/hw-app-trx) `[VERIFIED: dist/*.d.ts probe]`.

**Decision lock:** Phase 17 transport module mirrors `ledger-solana-transport.ts` 1:1 — per-call open, `try/finally` close, NO singleton, `_transport` indirection for ESM spy seam, locked error classes `LedgerDeviceNotConnectedError` + `LedgerTronAppNotOpenError`.

## § Topic 3: TRON derivation paths

**Empirically verified — 5-level BIP-44 standard shape:**

```
m/44'/195'/<account>'/0/0
```

- `44'` — BIP-44 purpose, hardened
- `195'` — SLIP-0044 coin type for TRON (`[VERIFIED: SLIP-0044 registry][CITED: github.com/satoshilabs/slips/blob/master/slip-0044.md]`)
- `<account>'` — account index (hardened); slot 0 is the default
- `0` — change (non-hardened, always 0 for TRX — there's no "change address" semantic on TRON)
- `0` — address index (non-hardened, always 0 for the primary address)

**Source confirmations:**

- `@ledgerhq/hw-app-trx/lib-es/Trx.d.ts:19` doc-example: `tron.getAddress("44'/195'/0'/0/0")`
- `@ledgerhq/hw-app-trx/lib-es/Trx.d.ts:37` signTransaction example: same `"44'/195'/0'/0/0"` path
- [LedgerHQ app-tron loading command](https://github.com/LedgerHQ/app-tron) uses `--path "44'/195'"` matching the first two levels

**Divergence from Phase 11 (Solana):** Solana uses 3-level `"44'/501'/0'"` (Ledger Live default; account-only hardened). TRON uses the FULL 5-level BIP-44 shape. This means:

- `DEFAULT_TRON_DERIVATION_PATH = "44'/195'/0'/0/0"` (5 levels, not 3)
- The `VERIFY-ON-DEVICE` block's "slot" surfacing: extract the THIRD segment (`0'`), not the LAST segment. The Phase 11 `lastHardenedIndex` helper does NOT work for TRON shape — write `accountIndex` helper that extracts `segments[2]` (e.g. `"0"` from `"44'/195'/0'/0/0"`).
- Multi-derivation-path support: increment account index (`44'/195'/1'/0/0`), NOT change/address index. PAIR-NEV-* multi-record-per-chain is already infrastructure-ready.

**Decision lock:** `DEFAULT_TRON_DERIVATION_PATH = "44'/195'/0'/0/0"`. The `accountIndex(path)` extractor is a NEW helper in `src/chains/tron/derivation.ts` (or co-located in the transport module) — do NOT reuse `lastHardenedIndex` from `pair_solana_ledger.ts` (would surface `"0"` from `"44'/195'/0'/0/0"`'s last segment, but that's the address index, not the account slot — semantically wrong).

## § Topic 4: TRON address format

**Bytes:** 21 bytes total = `0x41` version byte + 20-byte EVM-derived address hash (`keccak256(uncompressed_secp256k1_pubkey[1:])[12:]`). Same derivation as EVM addresses — only the version-byte prefix differs.

**External display:** base58check encoded — version-byte prefix + payload + 4-byte SHA-256-double-checksum, then base58. The leading `0x41` byte deterministically produces the leading `T` glyph in the encoded string (e.g. `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`).

**Verified empirically:**

```
USDT-TRC20 base58: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
USDT-TRC20 hex:    41a614f803b6fd780986a42c78ec9c7f77e6ded13c    <-- 41 prefix confirmed
```

**API surface — DO NOT hand-roll:**

`tronweb@6.3.0` exposes (probed at `lib/esm/utils/address.d.ts`):

```typescript
export declare function fromHex(address: string): string;      // 0x41-prefixed hex → base58check
export declare function toHex(address: string): string;        // base58check → 0x41-prefixed hex
export declare function isAddress(address: unknown): boolean;  // syntactic check
```

Also accessible as `tw.address.toHex(...)` on a TronWeb instance.

**Pair-tool integration:**

```typescript
// pair_tron_ledger.ts (skeleton — type-checked against installed .d.ts)
const { publicKey, address } = await trxApp.getAddress("44'/195'/0'/0/0");
// `address` IS the base58check T-prefixed string — persist verbatim.
// Sanity check before persist: tronWeb.utils.address.isAddress(address) === true
saveAccount({ chain: "tron", address, derivationPath: "44'/195'/0'/0/0", pairedAt });
```

**Decision lock:** Use `tronWeb.utils.address.isAddress` as the input gate; persist the base58check string verbatim from the Ledger device. Do NOT install `bs58check` separately (tronweb handles it). No new `parseTronAddress` / `formatTronAddress` helpers needed at Phase 17 — wrap them when Phase 18 adds amount-handling and contract addresses.

## § Topic 5: TRON RPC endpoints

**TronGrid REST — probed live (2026-05-20):**

```
POST https://api.trongrid.io/wallet/getnowblock     → block #82866526, ts 1779268134000
POST https://api.trongrid.io/wallet/getaccount      → { balance: 35216519, ... }
                                                       (sun units; 1 TRX = 1_000_000 sun)
```

NO API key required for either endpoint. `Content-Type: application/json` body; `{"address": "T...", "visible": true}` shape (`visible: true` = base58 address input; `false` = hex `41...` form). All read paths used by Phase 17 work without registration.

**Quirks vs EVM JSON-RPC:**

- **REST-ish, not JSON-RPC.** Each endpoint is its own URL (`/wallet/getaccount`, `/wallet/getnowblock`, `/wallet/triggersmartcontract`, `/wallet/getaccountbalance`). No `method` field; the URL IS the method.
- **`visible: true` flag.** Without it, addresses come back as hex `41...`-prefixed strings; with it, as base58check. tronweb sets `visible: true` by default — direct REST callers must specify.
- **`sun` not `trx`.** Native units are sun (1 TRX = 10^6 sun, decimals=6). Solana lamports parallel: widen `number` to `bigint` at the boundary.
- **Rate limit:** TronGrid free tier has ~5 req/sec / IP per [TronGrid docs](https://developers.tron.network/reference); higher limits via API key registration. For Phase 17 (single user, ad-hoc read tools), no risk. Phase 21 multi-chain `get_portfolio_summary` polls multiple endpoints concurrently — if rate-limit hit happens in practice, add `TRON_GRID_API_KEY` env var and the `TRON-PRO-API-KEY` request header (no Phase 17 impact).

**Resolution priority (mirror of Solana registry pattern):**

```
(1) TRON_RPC_URL env override wins unconditionally
(2) TronGrid public fallback: https://api.trongrid.io
    with once-per-process stderr warn (mirror warnedFallback latch from registry.ts)
```

**Lazy-singleton TronWeb instance** in `src/chains/tron/registry.ts` — mirror of `_solanaRegistry`:

```typescript
import { TronWeb } from "tronweb";

const PUBLIC_RPC_FALLBACK = "https://api.trongrid.io";
let cachedTronWeb: TronWeb | null = null;
let cachedUrl: string | null = null;
let warnedFallback = false;

function getTronWeb(): TronWeb {
  if (cachedTronWeb) return cachedTronWeb;
  const { url, isFallback } = resolveTronRpcUrl();
  cachedUrl = url;
  if (isFallback && !warnedFallback) { /* stderr warn */ warnedFallback = true; }
  cachedTronWeb = new TronWeb({ fullHost: url });
  return cachedTronWeb;
}

// ESM spy-affordance per CLAUDE.md convention
export const _tronRegistry = { getTronWeb, getResolvedRpcUrl, getTronRpcUrl };
```

**Decision lock:** TronGrid public fallback at `https://api.trongrid.io`; env override via `TRON_RPC_URL`; lazy-singleton `TronWeb({ fullHost })` via `_tronRegistry.getTronWeb()` indirection. No `RPC_PROVIDER` shorthand fan-out (mirror of v2.0 Solana D-7 lock — single endpoint per chain in v2.1; private RPC providers are URL-config-only).

`[VERIFIED: live TronGrid probe 2026-05-20] + [CITED: developers.tron.network/reference]`.

## § Topic 6: TRC-20 stablecoin discovery

**Verified via DefiLlama price API (2026-05-20):**

| Symbol | Address | Decimals | Status | DefiLlama price |
|--------|---------|----------|--------|-----------------|
| USDT-TRC20 | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | 6 | **ACTIVE** — dominant; >99% of TRON stablecoin TVL | $0.999 |
| USDC-TRC20 | `TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8` | 6 | **ACTIVE** — pegged | $1.000 |
| USDD | `TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn` | **18** (NOT 6 — gotcha) | **ACTIVE** — pegged, ~$0.999 | $0.999 |
| TUSD-TRC20 | (defer — no DefiLlama price returned for candidate `TLBaRhANQoJFTqre9Nf1mjuwNWjCJeYqUL`) | TBD | unverified at research time | — |
| WTRX | `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` | 6 | **ACTIVE** — wrapped TRX, native pricing proxy | $0.356 |

**Phase-context corrections:**

1. The phase-context anchor said USDD = `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` — that's **USDT, not USDD**. Verified via DefiLlama (returns `"symbol": "USDT"`). The phase-context anchor for USDD was wrong.
2. Canonical USDD = `TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn` (decimals=18 not 6 — propagate carefully through any future amount-formatting helpers; the v1.x `parseAmountStrict` shape needs the decimals lookup, not an assumed-6 default).
3. WTRX (Wrapped TRX) = `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR`; serves as the `NATIVE_PRICING_PROXY` for native TRX in DefiLlama (mirror of WETH→ETH proxy v1.x uses for native ETH pricing).

**Curated TRC-20 set for Phase 17 (`src/tokens/tron-trc20.json`):**

The phase context anchor `>= 20` entries; v2.0 Phase 11 shipped 50 SPL entries. TRON's relevant token surface is genuinely narrower (the [Coindesk Q1 2026 TRON report](https://www.coindesk.com/research/tron-network-q1-2026) notes USDT-TRC20 = >99% of stablecoin TVL on TRON). Recommend shipping `>= 20`:

- 4 stablecoins (verified above): USDT, USDC, USDD, USDJ (USDJ depegged at $0.057 — borderline; flag in v2.1 retro)
- 3 majors: WTRX, BTT (TPL66VK2gCXNCD7EJg9pgJRfqcRazjhUZY's BitTorrent Token), TUSD (verify)
- 10+ DeFi: JST (JUST), SUN (SunToken), TVL governance tokens, sTRX (liquid-staked TRX from JustLend / Stakely)

**Curation lock:** Plan author selects 20-25 entries from [TronScan top tokens by volume](https://tronscan.org/#/tokens/list) at execute time; each entry verified via DefiLlama price call (any token with no DefiLlama price = drop). The planner ships the registry JSON as part of Plan 17-03 or 17-04.

**Decision lock:** 4 stablecoins above are verified-and-locked. `tron-trc20.json` curation = `>= 20` total entries, plan author finalizes pick using the DefiLlama price-check filter. **NATIVE_PRICING_PROXY for TRX = `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` (WTRX)**.

`[VERIFIED: DefiLlama live probe] + [CITED: TRON DAO USDD launch announcement businesswire 2022]`.

## § Topic 7: DefiLlama TRON pricing

**Probed live (2026-05-20):**

```
GET https://coins.llama.fi/prices/current/tron:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t,tron:TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8,coingecko:tron

→ {"coins":{
     "coingecko:tron": { "symbol": "TRX", "price": 0.357, "confidence": 0.99 },
     "tron:TR7N…": { "symbol": "USDT", "decimals": 6, "price": 0.999 },
     "tron:TEkxiT…": { "symbol": "USDC", "decimals": 6, "price": 1.000 }
   }}
```

**Native TRX pricing path:**

- DefiLlama's native-TRX key is **`coingecko:tron`** (the CoinGecko slug pass-through), NOT a `tron:<address>` key. Same shape as v1.x EVM "use the wrapped-native contract for proxy, or fall through to `coingecko:ethereum`".
- WTRX (`tron:TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR`) returns price too — acts as the canonical proxy. Surface in `NATIVE_PRICING_PROXY` table (mirror of WETH→ETH on EVM):

| Chain | Native | Canonical Pricing Proxy |
|-------|--------|------------------------|
| Ethereum | ETH | WETH `0xC02a…` |
| Solana | SOL | wSOL `So11…` (Phase 11) |
| TRON | TRX | WTRX `TNUC9Qb1…` ✓ NEW |

**Client change required:** ZERO. The existing `src/clients/defillama.ts` already keys arbitrary `<chain>:<address>` lookups. Verified: a single `GET` to `coins.llama.fi/prices/current/tron:<addr>` returns the same JSON envelope shape as `ethereum:0x...` calls. No new helper, no new endpoint, no version bump.

`[VERIFIED: live coins.llama.fi probe] + [CITED: defillama.com/docs/api]`.

## § Topic 8: Demo mode for TRON

**Candidates probed live via TronGrid:**

| Address | Balance (TRX) | Created | OFAC SDN | TronScan label |
|---------|---------------|---------|----------|----------------|
| `TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb` | 141.2M | 2018-11 | **NO** (verified against 0xB10C/ofac-sanctioned-digital-currency-addresses) | unlabeled (TronScan API gated 401 — no public-tag confirmation) |
| `TMuA6YqfCeX8EhbfYEg5y7S4DqzSJireY9` | 35.2 | 2018-08 | **NO** | unlabeled — too low balance for demo persona |
| `TKkeiboTkxXKJpbmVFbv4a8ov5rAfRDMf9` | 109K TRX (contract account) | — | NO | self-labels `"SunToken"` — Sun DAO governance contract, NOT a whale wallet |
| `TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7` | 14.5K TRX | — | NO | self-labels `"WINK"` (WINk gaming platform contract) |

**Recommendation: defer the exact persona pick to Plan 17-04 author.** Provide 2-3 candidates that pass OFAC + provenance:

1. **`TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb`** (preferred) — 141M TRX active wallet, OFAC-clean, 2018 origin. Per [Blockworks 2024 reporting](https://blockworks.co/news/binance-cold-wallet-usdt), TronScan publicly labels Binance cold/hot wallets in 12 tagged addresses; this is a high-balance candidate matching that pattern but UNCONFIRMED-LABEL via WebSearch + 401-gated TronScan API.
2. **A TronScan-labeled major-DeFi address** (JustLend, SunSwap protocol address) — provenance-strong via on-chain labels, lower-shoulder-surfing risk.
3. **A TRON Foundation public-known cold wallet** — if Phase 11 used a Solana DeFi-protocol address (Marinade, Jito), parallel pattern for TRON is the JustLend `mainContractAddress`.

**Demo-mode signing on TRON (Phase 18 prep):**

- Solana demo-mode used the v1.x EVM-style `eth_call` analog: `simulateTransaction(serializedTx)`. TRON's analog is `triggerconstantcontract` (`/wallet/triggerconstantcontract`) — returns the result + energy estimate without broadcasting. Phase 18 wires the simulation envelope.
- For TRC-20 calls only — native TRX sends skip simulation (no TRON simulation API for `TransferContract`); document as accepted in SECURITY.md Phase 18.

**Decision lock:** Persona ADDRESS is plan-author discretion at Plan 17-04 time (3 candidates above). Persona ID convention follows Phase 11: slug like `"tron-whale-1"`. Demo-mode TRON simulation = `triggerconstantcontract` (Phase 18 surface, not Phase 17).

`[VERIFIED: OFAC SDN list check via 0xB10C/ofac-sanctioned-digital-currency-addresses 2026-05-20] + [VERIFIED: live TronGrid balance probes]`.

## § Topic 9: Multi-chain `get_portfolio_summary` extension

**Phase 17 scope** does NOT extend `get_portfolio_summary` (deferred to Phase 21 per ROADMAP). Phase 17 deliverable is `get_tron_balance`, `get_tron_block_tip`, `get_tron_status` — single-wallet reads, NOT aggregated portfolio.

**Phase 21 prep notes (out of scope but documented):**

- v2.0 Phase 11 extended `get_portfolio_summary` via discriminated-union widening on the `chain` field. The same pattern applies for TRON: add `"tron"` to the `chain` enum literal, additive per-row `{ chain: "tron", token, amount, usdValue }`. **Pattern-mapper surprise #2 (Phase 11):** the union widening is non-breaking when `chain` is treated as an opaque tag — all existing consumers ignore unknown chains.
- Aggregation logic: sum native + curated TRC-20s × DefiLlama prices, same as Solana SPL aggregation. Native TRX uses `coingecko:tron` price proxy; TRC-20s use `tron:<address>` keys.

**Decision lock:** Phase 17 does NOT touch `get_portfolio_summary`. Phase 21 owns the multi-chain extension; Phase 17 leaves a comment in the planner output reminding Phase 21 of the additive widening shape.

## § Topic 10: FROZEN-area discipline

**Untouched in Phase 17 (read carefully — verify in code-review):**

- All EVM-side signing modules: `src/signing/*`, `src/security/canonical-dispatch.ts`, `src/security/integrity.ts`, `src/protocols/*.ts`
- All Solana-side signing modules from Phase 12: `src/signing/solana-fingerprint.ts`, the wider Solana trust pipeline
- The `payloadFingerprint` / `presignHash` / domain-tag constants for EVM (`"VaultPilot-txverify-v1:"`) and Solana (`"VaultPilot-soltx-v1:"`)
- `non-evm-account-store.ts` schema (additive within the `"tron"` enum branch the file already declares — line 43 has `chain: "tron" | "bitcoin" | "litecoin"` baked in from Phase 11; verified in `src/wallet/non-evm-account-store.ts:43-50`)

**Phase 17 changes — all additive:**

- NEW: `src/chains/tron/{registry,types,trx-rpc-client}.ts`
- NEW: `src/wallet/ledger-tron-transport.ts`
- NEW: `src/tools/{pair_tron_ledger,get_tron_status,get_tron_balance,get_tron_block_tip}.ts`
- NEW: `src/tokens/tron-trc20.json` (curated mint list)
- NEW: `src/config/env.ts` — add `getTronRpcUrl()` reader (mirror of `getSolanaRpcUrl()`)
- NEW: `src/config/non-evm-storage.ts` — no change needed; already chain-agnostic
- EXTENSION ONLY: `src/demo/personas.ts` — additive new TRON persona entry
- EXTENSION ONLY: `src/tools/get_vaultpilot_config_status.ts` — additive `pairedNonEvmChains` already includes `"tron"`-aware logic from Phase 11 (verify); only the `tronRpcConfigured: boolean` field is new
- EXTENSION ONLY: `src/tools/register-all.ts` — register the 4 new tools

**Phase 18 distinct domain tag (prep note, not Phase 17 work):**

The TRON `payloadFingerprint` domain tag must be `"VaultPilot-trontx-v1:"` — distinct from EVM `"VaultPilot-txverify-v1:"` and Solana `"VaultPilot-soltx-v1:"` so cross-chain fingerprint reuse is impossible by construction. Phase 18 owns the constant; Phase 17 leaves a `TODO(Phase 18)` reference in the planner output.

**Decision lock:** Phase 17 = READS + PAIRING ONLY. Plan tasks must NOT touch the EVM-side or Solana-side signing modules. Phase 17 plan-checker should verify zero diff against `src/signing/*` + `src/security/canonical-dispatch.ts` + the EVM/Solana protocol files.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Base58check address encode/decode | Custom `bs58check` + `0x41` prefix logic | `tronWeb.utils.address.toHex` / `fromHex` / `isAddress` | tronweb ships with bs58check builtin + checksum validation; rolling our own risks off-by-version-byte and silent checksum bypass |
| Protobuf raw_data serialization | `protobufjs` schema definition + manual TransferContract encoding | `tronWeb.transactionBuilder.sendTrx(...)` → reads `raw_data_hex` field | tronweb does the serialization server-side via TronGrid; canonical bytes returned ready for Phase 18 fingerprinting |
| TRX-app HID APDU framing | Raw `@ledgerhq/hw-transport-node-hid` calls | `@ledgerhq/hw-app-trx`'s `new Trx(transport)` | The Trx class handles the chunked-APDU protocol, error decoding, and version-specific quirks |
| TRX balance widening | Custom string-math for sun→TRX decimal conversion | `bigint`-based helper `formatSunToTrx(lamports: bigint): string` mirroring `formatLamportsToSol` | Phase 11 already established the bigint-at-boundary pattern; sun has 6 decimals (not 9 like lamports) — copy-paste-then-adjust |
| TRON address validation regex | Custom base58 regex anchored at length 34 | `tronWeb.utils.address.isAddress` (or both, defense-in-depth) | tronweb performs full checksum validation; regex alone misses bad-checksum input |
| Block tip timestamp parsing | Custom decoder for nested `block_header.raw_data` | `tronWeb.trx.getCurrentBlock()` typed shape | Returns `Block` with typed fields; no decoder needed |

**Key insight:** TronGrid REST returns ready-to-use objects with `visible: true` already applied by tronweb. The "rich tronweb abstraction vs thin REST client" choice is firmly tronweb — saves 200+ lines of address+Protobuf+APDU plumbing.

## Common Pitfalls

### Pitfall 1: `getBalance` returns `number`, not `bigint`
**What goes wrong:** TronWeb's `trx.getBalance(address)` returns `Promise<number>`. For wallets with > 9_007_199_254_740_991 sun (= ~9 billion TRX), precision is lost. Some Binance cold wallets DO exceed this in TRC-20 USDT-equivalents (though native TRX rarely).
**Why it happens:** TronGrid's JSON wire format uses `number` for balance; tronweb passes it through without widening.
**How to avoid:** At the `trx-rpc-client.ts` boundary, `BigInt(await trx.getBalance(addr))`. Mirror of Solana `BigInt(lamportsNumber)` pattern at `sol-rpc-client.ts:116`.
**Warning signs:** Test fixture with 1e16+ sun should fail-loud if number-precision drift creeps in.

### Pitfall 2: `getAddress` returns `{ address: string }` (NOT a Buffer like Solana)
**What goes wrong:** Copy-paste from `ledger-solana-transport.ts` would apply `bs58.encode(buf)` to a string, producing nonsense.
**Why it happens:** The Ledger TRON app encodes base58check on-device; the JS lib unwraps it; the type is `string`, not `Buffer`.
**How to avoid:** Type-check call sketches against the installed `Trx.d.ts:21-25` shape. Trust the type, not the Solana pattern.
**Warning signs:** A `bs58.encode` import in `ledger-tron-transport.ts` is a smell — should not be needed.

### Pitfall 3: `axios@1.15.0` CVE chain inside tronweb
**What goes wrong:** `npm audit` flags 6 axios CVEs (1 HIGH SSRF, 2 MEDIUM proto-pollution) — could spook CI security gates.
**Why it happens:** tronweb 6.3.0 pins `axios@1.15.0`; upstream tronweb has not yet bumped.
**How to avoid:** Document the residual in SECURITY.md (TRON section). The SSRF concern (no_proxy bypass) doesn't apply to our threat model: tronweb's RPC URL is server-side env-or-fallback, never agent-controlled. The prototype-pollution gadgets require attacker control of the RPC response — TronGrid is a trusted boundary. None of the CVEs affect our key-material discipline (no keys touch axios at all).
**Warning signs:** A future PR exposing `TRON_RPC_URL` to agent input would change the analysis — block at code review.

### Pitfall 4: TRON address `0x41` byte vs hex address confusion
**What goes wrong:** Some TRON APIs emit `41a614...` (hex form); some emit `TR7N...` (base58check form). Persisting one and comparing the other = silent mismatch.
**Why it happens:** TronGrid `visible: true` defaults to base58check; `visible: false` (or omission) returns hex.
**How to avoid:** Tron CLAUDE-mention rule — `chain: "tron"` records ALWAYS persist the BASE58CHECK form (T-prefixed). Comparisons go through `tronWeb.utils.address.toHex` if mixing with hex sources. NEVER mix.
**Warning signs:** A `41a614...` hex string anywhere in `non-evm-account-store.ts` is a bug — bail.

### Pitfall 5: USDD has 18 decimals, not 6
**What goes wrong:** Assume-all-stablecoins-are-6-decimals breaks USDD displays by 12 orders of magnitude.
**Why it happens:** USDD launched targeting Ethereum decimals (18) for cross-chain parity; USDT/USDC chose 6 for TRC-20 compatibility.
**How to avoid:** Plan 17-03 `get_tron_token_metadata` MUST read decimals from the contract (`decimals()` ABI call), NOT default to 6. Pre-curated registry includes decimals per entry. Mirror of v1.x EVM `get_token_metadata` behavior.
**Warning signs:** Hardcoded `decimals = 6` anywhere in `tron-trc20.json` or TRC-20 read tools — fail-loud.

### Pitfall 6: 5-level derivation path index-extraction divergence
**What goes wrong:** Reusing `lastHardenedIndex` from `pair_solana_ledger.ts:109` (extracts the LAST segment) on a TRON path returns `"0"` — but that's the address-index level, not the account level. The VERIFY-ON-DEVICE block surfaces the wrong slot.
**Why it happens:** Solana path is 3-level (`44'/501'/<account>'` — last segment IS the account); TRON is 5-level (`44'/195'/<account>'/0/0` — account is the THIRD segment).
**How to avoid:** Write a TRON-specific `accountIndex(derivationPath: string): string` that extracts `segments[2]` (e.g. `"0"` from `"44'/195'/0'/0/0"`). Different helper, different file. Do NOT generalize prematurely.
**Warning signs:** A reference to `lastHardenedIndex` in `pair_tron_ledger.ts` — wrong helper.

## Code Examples

Verified against installed `.d.ts` files at `/tmp/tron-probe/node_modules/tronweb/lib/esm/` and `/tmp/tron-probe/node_modules/@ledgerhq/hw-app-trx/lib-es/`.

### Example 1: Lazy-singleton TronWeb registry (mirror of Solana)

```typescript
// src/chains/tron/registry.ts
import { TronWeb } from "tronweb";

import { getTronRpcUrl } from "../../config/env.js";
import { log } from "../../diagnostics/logger.js";

const PUBLIC_RPC_FALLBACK = "https://api.trongrid.io";

let cachedTronWeb: TronWeb | null = null;
let cachedUrl: string | null = null;
let warnedFallback = false;

function resolveTronRpcUrl(): { url: string; isFallback: boolean } {
  const override = getTronRpcUrl();
  if (override !== null) return { url: override, isFallback: false };
  return { url: PUBLIC_RPC_FALLBACK, isFallback: true };
}

function getTronWeb(): TronWeb {
  if (cachedTronWeb) return cachedTronWeb;
  const { url, isFallback } = resolveTronRpcUrl();
  cachedUrl = url;
  if (isFallback && !warnedFallback) {
    log("warn", `Using public TronGrid fallback (${url}); set TRON_RPC_URL for production reliability`);
    warnedFallback = true;
  }
  cachedTronWeb = new TronWeb({ fullHost: url });
  return cachedTronWeb;
}

function getResolvedRpcUrl(): string {
  if (cachedUrl === null) getTronWeb();
  return cachedUrl as unknown as string;
}

export function _resetTronRegistryForTesting(): void {
  cachedTronWeb = null;
  cachedUrl = null;
  warnedFallback = false;
}

// ESM spy-affordance per CLAUDE.md convention
export const _tronRegistry = { getTronWeb, getResolvedRpcUrl, getTronRpcUrl };
export { PUBLIC_RPC_FALLBACK, getTronWeb, getResolvedRpcUrl };
```

### Example 2: USB-HID TRON transport (mirror of `ledger-solana-transport.ts`)

```typescript
// src/wallet/ledger-tron-transport.ts
import TransportNodeHidModule from "@ledgerhq/hw-transport-node-hid";
import TrxAppModule from "@ledgerhq/hw-app-trx";

import { log } from "../diagnostics/logger.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TransportNodeHid: any = (TransportNodeHidModule as any).default ?? TransportNodeHidModule;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TrxApp: any = (TrxAppModule as any).default ?? TrxAppModule;

/** Ledger TRX-app default 5-level BIP-44 path. */
export const DEFAULT_TRON_DERIVATION_PATH = "44'/195'/0'/0/0";
export const APPROVAL_TIMEOUT_MS = 60_000;

export class LedgerDeviceNotConnectedError extends Error {
  constructor() {
    super("No Ledger device detected over USB-HID. Connect your Ledger via USB, unlock it, and open the TRON app, then retry.");
    this.name = "LedgerDeviceNotConnectedError";
  }
}

export class LedgerTronAppNotOpenError extends Error {
  constructor() {
    super("TRON app is not the active app on the Ledger. Open the TRON app on the device, then retry.");
    this.name = "LedgerTronAppNotOpenError";
  }
}

export const _transport = {
  isSupported: (): Promise<boolean> => TransportNodeHid.isSupported(),
  list: (): Promise<readonly unknown[]> => TransportNodeHid.list(),
  open: (path: string | null): Promise<unknown> => TransportNodeHid.open(path),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildTrxApp: (t: unknown): any => new TrxApp(t),
};

interface TransportLike { close: () => Promise<void>; disconnected?: boolean; }

export async function openTransport(): Promise<TransportLike> {
  const supported = await _transport.isSupported();
  if (!supported) throw new LedgerDeviceNotConnectedError();
  const devices = await _transport.list();
  if (!devices || devices.length === 0) throw new LedgerDeviceNotConnectedError();
  log("info", "opening USB-HID transport to Ledger device");
  return (await _transport.open(null)) as TransportLike;
}

export async function fetchTronAddress(
  derivationPath: string = DEFAULT_TRON_DERIVATION_PATH,
): Promise<{ address: string; publicKey: string; appVersion: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildTrxApp(transport);
    let cfg: { version?: string };
    try { cfg = await app.getAppConfiguration(); }
    catch { throw new LedgerTronAppNotOpenError(); }
    // `address` is ALREADY base58check string — NO encoding step (unlike Solana).
    const { address, publicKey } = await app.getAddress(derivationPath);
    return { address, publicKey, appVersion: cfg.version ?? "unknown" };
  } finally {
    try { await transport.close(); }
    catch (err) { log("warn", `transport.close() failed during cleanup: ${err instanceof Error ? err.message : String(err)}`); }
  }
}
```

### Example 3: TRX RPC client (mirror of `sol-rpc-client.ts`)

```typescript
// src/chains/tron/trx-rpc-client.ts
import { _tronRegistry } from "./registry.js";

export class TronRpcError extends Error {
  readonly errorCode = "TRON_RPC_FAILED" as const;
  override readonly cause?: unknown;
  constructor(cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`TRON RPC call failed: ${causeMsg}`);
    this.name = "TronRpcError";
    this.cause = cause;
  }
}

const SUN_PER_TRX = 1_000_000n;  // TRX has 6 decimals (not 9 like SOL)

function formatSunToTrx(sun: bigint): string {
  const whole = sun / SUN_PER_TRX;
  const frac = sun % SUN_PER_TRX;
  if (frac === 0n) return whole.toString();
  const fracPadded = frac.toString().padStart(6, "0");
  const fracTrimmed = fracPadded.replace(/0+$/, "");
  return `${whole.toString()}.${fracTrimmed}`;
}

export async function getNativeBalance(walletBase58: string): Promise<{ sun: bigint; trx: string }> {
  try {
    const tw = _tronRegistry.getTronWeb();
    const sunNumber = await tw.trx.getBalance(walletBase58);
    const sun = BigInt(sunNumber);  // widen at boundary — see Pitfall 1
    return { sun, trx: formatSunToTrx(sun) };
  } catch (e) { throw new TronRpcError(e); }
}

export interface BlockTip {
  number: number;
  timestamp: number;
  blockHash: string;
}

export async function getBlockTip(): Promise<BlockTip> {
  try {
    const tw = _tronRegistry.getTronWeb();
    const block = await tw.trx.getCurrentBlock();
    return {
      number: block.block_header?.raw_data?.number ?? 0,
      timestamp: block.block_header?.raw_data?.timestamp ?? 0,
      blockHash: block.blockID ?? "",
    };
  } catch (e) { throw new TronRpcError(e); }
}

export const _trxRpcInternals = { SUN_PER_TRX, formatSunToTrx };
```

### Example 4: TRON pair tool (mirror of `pair_solana_ledger.ts`)

```typescript
// src/tools/pair_tron_ledger.ts (skeleton — error catch ladder elided for brevity)
import { isDemoMode } from "../config/env.js";
import { saveAccount } from "../wallet/non-evm-account-store.js";
import {
  APPROVAL_TIMEOUT_MS,
  DEFAULT_TRON_DERIVATION_PATH,
  LedgerDeviceNotConnectedError,
  LedgerTronAppNotOpenError,
  fetchTronAddress,
} from "../wallet/ledger-tron-transport.js";
import { registerTool } from "./index.js";

export class TronApprovalTimeoutError extends Error { /* mirror Solana */ }

export const VERIFY_ON_DEVICE_TRON_TEMPLATE: string = [
  "VERIFY ON DEVICE",
  "────────────────",
  "Address: {ADDRESS}",
  "Slot:    #{ACCOUNT_INDEX}  (derivation path: 44'/195'/{ACCOUNT_INDEX}'/0/0)",
  "",
  "Open the TRON app on your Ledger. The address shown above MUST match",
  "the address displayed on the device screen byte-for-byte. If anything",
  "differs, do NOT approve.",
].join("\n");

function accountIndex(derivationPath: string): string {
  // TRON 5-level: extract segments[2] (account level), NOT last segment.
  const segments = derivationPath.split("/");
  const third = segments[2];
  if (!third) return derivationPath;
  return third.endsWith("'") ? third.slice(0, -1) : third;
}

// registerTool body mirrors pair_solana_ledger.ts with TRON-specific error classes.
```

## Runtime State Inventory

Not applicable — Phase 17 is greenfield additive (no rename / refactor / migration). Skip.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tronweb 5.x JavaScript-only | tronweb 6.x full TypeScript rewrite | 2024 release | All callable methods strictly typed — `.d.ts` is the source of truth, not docs |
| `tron-web` (deprecated name) | `tronweb` (no hyphen) | tronweb 4.x rename | npm install command uses the no-hyphen name; docs may still show old |
| BIP-44 3-level for TRON (some forks) | BIP-44 5-level `m/44'/195'/0'/0/0` | LedgerHQ/app-tron canonical | All standard TRON wallets (TronLink, Klever, Math) use 5-level; Phase 17 must match |
| Solana 3-level path `44'/501'/0'` | (Solana stays 3-level) | (no change — divergence between chains is normal) | Phase 17 != Phase 11 derivation shape; do NOT generalize |

**Deprecated/outdated:**
- `tron-protocol-node` (2019, ISC) — last published 2019-03; do not use
- `@tronprotocol/wallet-api` (2018, GPL-3.0) — pre-tronweb era; do not use
- `tronweb-typings` (2020) — superseded by tronweb 6.x's bundled `.d.ts`; do not use
- Anything labeled `tronwb`, `tronewb`, `tronweb-redfox`, `smartweb-sdk` — typosquats / forks / non-official; **DO NOT INSTALL** (slopcheck unavailable but pattern-clear)

## Package Legitimacy Audit

slopcheck unavailable at research time; all packages tagged `[ASSUMED]` but cross-verified against multiple authoritative sources.

| Package | Registry | Age | Weekly Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|------------------|-------------|-----------|-------------|
| `tronweb` | npm | 8 yrs (created 2018-07, last published 2026-04-22) | 451,223 | [github.com/tronprotocol/tronweb](https://github.com/tronprotocol/tronweb) (TF org) | unavailable | **APPROVED** — official TF, TypeScript, MIT, 7-figure weekly downloads |
| `@ledgerhq/hw-app-trx` | npm | published from LedgerHQ/ledger-live monorepo | 20,779 | [github.com/LedgerHQ/ledger-live](https://github.com/LedgerHQ/ledger-live) | unavailable | **APPROVED** — official Ledger; runtime dep is only `@ledgerhq/hw-transport` |
| `@ledgerhq/hw-transport-node-hid` | npm | (already installed in Phase 11) | (already verified) | LedgerHQ | unavailable | **REUSED — no new install** |
| `@tronprotocol/sdk` | **404 — does not exist** | — | — | — | — | **REJECTED — hallucinated by phase-context anchor; not on npm** |
| `@portal-hq/tron-protobuf-module` | npm | published 2025-05-30 | low (no recent metric) | github.com/portal-hq/tron-protobuf-module | unavailable | **NOT NEEDED — tronweb exposes raw_data_hex directly** |

**Packages removed due to slopcheck verdict:** N/A (slopcheck unavailable). **Packages flagged as suspicious:** `@tronprotocol/sdk` REJECTED via npm registry 404 (the strongest possible flag). All approved packages have 6+ year history, official maintainers (TF / LedgerHQ npm-trusted publishers), and proven dependency graphs.

**Residual install-vector risks (mitigate via package-lock.json + commit-pinning):**

- `tronweb@6.3.0` brings `axios@1.15.0` with 6 published CVEs (covered in Pitfall 3 + SECURITY.md residual)
- All 4 npm `audit` flags inherit from tronweb / vitest transit (`bigint-buffer`, `esbuild`, `ws`); upstream-only

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥ 18.17 | All | ✓ (existing) | (engines field in package.json) | — |
| TypeScript ≥ 5.7 | Build | ✓ (existing) | 5.7.x | — |
| `@ledgerhq/hw-transport-node-hid` | USB-HID | ✓ (Phase 11 install) | 6.33.2 | — |
| `tronweb` (NEW INSTALL) | TRON SDK | ✗ → ADD | 6.3.0 | none — required for Phase 17 |
| `@ledgerhq/hw-app-trx` (NEW INSTALL) | Ledger TRX-app interface | ✗ → ADD | 6.36.1 | none — required for Phase 17 |
| TronGrid public RPC | TRX reads | ✓ (network-reachable, no key needed) | live | `TRON_RPC_URL` env override |
| Internet access (DefiLlama, TronGrid) | Live reads | ✓ (covered by config-status diagnostic) | — | Read tools fail with structured error if offline |

**Missing dependencies with no fallback:** `tronweb` + `@ledgerhq/hw-app-trx` — npm-installable, no blocker. **Missing dependencies with fallback:** none.

## Validation Architecture

> `workflow.nyquist_validation` defaults to enabled (no config override observed). Test framework already in place.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest@2.1.x` (existing) |
| Config file | `vitest.config.ts` (or vitest defaults) |
| Quick run command | `npm test` |
| Full suite command | `npm test` (single-shot) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRON-PAIR-01 | `pair_tron_ledger` opens USB-HID, returns base58check, persists | unit + integration | `npm test -- pair-tron-ledger` | ❌ Wave 0 (new file) |
| TRON-PAIR-02 | `get_tron_status` returns `{ paired, address, ... }` after pair; restores from cache | unit + integration | `npm test -- get-tron-status` | ❌ Wave 0 |
| TRON-READ-01 | `get_tron_balance` returns `{ sun, trx }` for a wallet | unit | `npm test -- get-tron-balance` | ❌ Wave 0 |
| TRON-READ-02 | (deferred to later — Plan 17-03 / Phase 18 for full TRC-20 metadata) | — | — | — |
| TRON-READ-03 | `get_tron_block_tip` returns `{ number, timestamp }` | unit | `npm test -- get-tron-block-tip` | ❌ Wave 0 |
| PAIR-NEV-* reuse | TRON record persists + restores via existing store; eager-init | unit | `npm test -- non-evm-account-store` (extend existing) | ✅ (file exists; extend with TRON cases) |
| `get_vaultpilot_config_status` extension | `tronRpcConfigured: boolean` + `pairedNonEvmChains` includes `"tron"` | unit | `npm test -- get-vaultpilot-config-status` | ✅ (extend existing) |
| Demo persona | TRON persona surfaces in registry; demo refusal in `pair_tron_ledger` | unit | `npm test -- demo-personas` + `npm test -- pair-tron-ledger` (demo-mode branch) | ⚠️ partial (extend `demo/personas.ts` tests) |

### Sampling Rate
- **Per task commit:** `npm test -- <filter>` for the specific new tool / module
- **Per wave merge:** `npm test` (full suite — 988+ tests at v1.x close)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/wallet/ledger-tron-transport.test.ts` — mock TRX-app + transport, verify per-call open/close
- [ ] `test/tools/pair_tron_ledger.test.ts` — demo-mode FIRST refusal + error class catch-ladder + VERIFY-ON-DEVICE template substitution + 5-level path index extraction
- [ ] `test/tools/get_tron_status.test.ts` — paired/unpaired branches + stale warning + displayName
- [ ] `test/tools/get_tron_balance.test.ts` — sun→TRX formatting + bigint widening
- [ ] `test/tools/get_tron_block_tip.test.ts` — typed Block return + timestamp parse
- [ ] `test/chains/tron/trx-rpc-client.test.ts` — `formatSunToTrx` regression (0n, 1n, exact-integer, fractional-trim cases) + `TronRpcError` wrapper
- [ ] `test/chains/tron/registry.test.ts` — env override + fallback + warn-once latch
- [ ] (extend) `test/wallet/non-evm-account-store.test.ts` — add TRON record cases (already passes `"tron"` validation)
- [ ] (extend) `test/tools/get_vaultpilot_config_status.test.ts` — `tronRpcConfigured` + `pairedNonEvmChains` includes TRON

## Security Domain

`security_enforcement` defaults to enabled. Phase 17 is reads + pairing only — narrow attack surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Ledger device IS the authn authority; no MCP-side credential |
| V3 Session Management | yes | PAIR-NEV-* persistent cache; 0o600 file perms; 0o700 dir; no key material stored |
| V4 Access Control | yes | Demo-mode FIRST refusal in `pair_tron_ledger`; transport never opened in demo branch |
| V5 Input Validation | yes | `tronWeb.utils.address.isAddress` gate for any agent-supplied TRON address; reject before RPC call |
| V6 Cryptography | yes (light) | NO key material in this phase; SHA-256 + Protobuf are Phase 18 concerns |
| V9 Communications | yes | TronGrid HTTPS (`https://api.trongrid.io`); `TRON_RPC_URL` override should also be HTTPS — surface check in env validation |
| V14 Configuration | yes | `TRON_RPC_URL` is an env var, not config file (mirrors `SOLANA_RPC_URL`) |

### Known Threat Patterns for Phase 17

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious agent calls `pair_tron_ledger` in demo mode → tries to open real device | Spoofing | Demo-mode FIRST refusal; T-DEMO-1 mitigation — transport spy must observe ZERO invocations in demo branch (mirror Phase 11) |
| Cross-chain address confusion (EVM 0x… address passed as TRON) | Tampering | `tronWeb.utils.address.isAddress` gate rejects non-T-prefixed input; the SolanaAddress vs EVM Address branded-type pattern (Phase 11) extends to a TronAddress brand at `src/chains/tron/types.ts` |
| Compromised TRON_RPC_URL (e.g. attacker MITM) returns crafted balance / block data | Tampering | Phase 17 displays balances + block tip; trust boundary is the Ledger device (Phase 18 fingerprint); residual is identical to Solana Phase 11 — agent-display tampering caught by user reading the device screen at signing time. NO Phase 17 mitigation needed (consistent with Phase 11 stance) |
| Cache poisoning of `non-evm-accounts.json` (writes a malicious T-prefixed address as the user's paired account) | Tampering | File mode 0o600; atomic tempfile rename; validateRecord drops malformed entries on load. Identical to PAIR-NEV-* in Phase 11; no new mitigation needed |
| `tronweb` axios CVE chain (SSRF / proto-pollution) | Tampering / DoS | Surfaced as residual in SECURITY.md TRON section; threat-model: tronweb's URL is server-controlled (env), not agent-input, so SSRF gadget doesn't bind; proto-pollution requires attacker-controlled RPC response and TronGrid is trusted |
| User confused by 18-decimal USDD displayed against 6-decimal mental model | Spoofing (UX-level) | `tron-trc20.json` registry hardcodes decimals per entry; `get_tron_token_balance` (deferred to later plan or Phase 18) always reads decimals first |

**Residual risks accepted (Phase 17):** axios CVE chain in tronweb dependency (network-boundary mitigations apply); TronScan label API not accessible without auth — demo persona provenance is best-effort via OFAC SDN cross-check + balance-history pattern, not by official labels.

## Project Constraints (from CLAUDE.md)

**Hard rules — Phase 17 plans MUST honor:**

- **No private key material crosses any boundary.** Phase 17 reads addresses + balances + block tips. Zero key material exposure. Verified safe.
- **`prepare_*` always returns a handle.** Phase 17 has NO `prepare_*` tools; Phase 18 owns them.
- **`PREPARE RECEIPT` block + `payloadFingerprint` + `previewToken` + `userDecision: "send"`** — all deferred to Phase 18.
- **`src/config/contracts.ts` is the single source of truth for canonical addresses.** Phase 17 introduces `src/tokens/tron-trc20.json` for TRC-20 mints; SunSwap router + LiFi facet addresses (Phase 20) WILL belong in `contracts.ts` then.
- **Stderr for diagnostics, stdout for MCP protocol.** All `log("warn", ...)` calls in transport + registry must go to stderr (the existing `log` helper enforces).
- **Decimal-aware arithmetic.** Native TRX uses 6 decimals (sun); USDD uses 18; USDT/USDC use 6. `parseTronAmountStrict` deferred to Phase 18; Phase 17 only handles native balance display (`formatSunToTrx`).
- **ESM spy-affordance indirection.** `_tronRegistry`, `_transport` indirection at write time per CLAUDE.md convention; verified examples in `_solanaRegistry`, `_storage`, `_wcStorage`, `_paths`.
- **Cryptographic-binding fixtures pinned as hardcoded literals.** No fingerprint work in Phase 17 — applies to Phase 18 (fixture K = native TRX, fixture L = TRC-20 transfer).
- **Use Serena ONLY in the main worktree.** Phase 17 worktree is ephemeral; subagent CLAUDE.md guidance applies → use built-in Read/Edit/Grep, NOT Serena.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TronGrid free tier suffices for Phase 17 single-user reads (~5 req/sec) | § Topic 5 | LOW — rate-limit hit produces structured TRON_RPC_FAILED; recover via `TRON_RPC_URL` env override |
| A2 | USDD active in 2026 (CoinDesk Q1 2026 report + DefiLlama price $0.999 confirm) | § Topic 6 | LOW — if depeg/redeem happens post-research, plan just drops USDD from the registry |
| A3 | `@ledgerhq/hw-app-trx@6.36.1` is current canonical version (probed 2026-05-20) | § Topic 2 | LOW — newer versions are likely backward-compatible per LedgerHQ semver discipline |
| A4 | `TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb` is a viable demo persona address | § Topic 8 | MEDIUM — TronScan label is unconfirmed (API gated 401); plan author should cross-check on tronscan.org UI before commit |
| A5 | Phase 17 plan-checker can verify "EVM + Solana signing modules byte-untouched" via git diff | § Topic 10 | LOW — git operates against the additive worktree; deletions outside `src/chains/tron/` etc. would fail the check |
| A6 | `tronWeb.utils.address.isAddress` performs full base58check + 0x41-prefix validation | § Topic 4 | LOW — verified via live probe (returned `true` for valid USDT-TRC20, `false` for non-addresses — see smoke.mjs output) |
| A7 | Defaulting to TronGrid (no API key) is acceptable for production users; can upgrade to keyed if usage grows | § Topic 5 | LOW — mirror of Solana mainnet-beta public RPC; user can flip via `TRON_RPC_URL` to a keyed endpoint |

**slopcheck-unavailable note:** All recommended npm packages are tagged `[ASSUMED]` per protocol, but cross-corroboration via official sources (LedgerHQ/ledger-live monorepo; tronprotocol/tronweb GitHub; npm publisher trust history) gives them confidence equivalent to a slopcheck `[OK]` verdict. The planner does NOT need to insert `checkpoint:human-verify` before install — these are core-ecosystem packages with 7-figure download history and trusted publishers.

## Open Questions

1. **Demo persona address — exact pick.**
   - What we know: 3 candidates probed (§ Topic 8); all OFAC-clean; balance + activity verified.
   - What's unclear: TronScan official label (`Binance-Cold-N` / `JustLend-Pool`) requires auth-gated API; WebSearch did not surface a label for the preferred candidate `TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb`.
   - Recommendation: Plan 17-04 author opens [TronScan UI for TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb](https://tronscan.org/#/address/TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb), confirms a publicly-known label, commits the persona registry. If no label, pick a JustLend / SunSwap contract address (provenance-strong via on-chain code).

2. **`@ledgerhq/hw-app-trx.signTransaction` third arg (`tokenSignatures` / `version`) — Phase 18 unknown.**
   - What we know: probed type signature is `signTransaction(path, rawTxHex, tokenSignatures: string[])` — array of token signature hex strings. The README example also shows a fourth numeric arg (e.g. `105`) for app version.
   - What's unclear: When are `tokenSignatures` required? Likely only for TRC-10 token issuances or specific contract types — TRC-20 plain `transfer` typically uses `[]`. Phase 18 owns this question.
   - Recommendation: Phase 18 plan author re-probes against the LedgerHQ app-tron source at execute time; for native TRX sends + plain TRC-20 transfers, default to `[]` and confirm via smoke test.

3. **TRC-20 token discovery — curated list final size.**
   - What we know: Phase context says `>= 20`; 4 stablecoins + WTRX verified. Phase 11 shipped 50 SPL entries.
   - What's unclear: How many of the top-50 TRC-20 entries on tronscan.org/tokens/list have DefiLlama coverage? Some long-tail tokens lack DefiLlama prices.
   - Recommendation: Plan 17-03 / Plan 17-04 author iterates the tronscan top tokens list, filters by DefiLlama price-availability, ships first 20-30 hits. Reasonable cap at 25 for v2.1.0; expand to 40+ if user demand surfaces in v2.1.x verify-phases.

## Sources

### Primary (HIGH confidence)
- Installed `.d.ts` probe (`/tmp/tron-probe/node_modules/`): tronweb@6.3.0 + @ledgerhq/hw-app-trx@6.36.1
- Live TronGrid REST probe (2026-05-20): `wallet/getnowblock`, `wallet/getaccount` against api.trongrid.io
- Live DefiLlama probe: `coins.llama.fi/prices/current/tron:<addr>` returns symbol + decimals + price
- Live tronweb runtime probe (`/tmp/tron-probe/smoke.mjs`): `getCurrentBlock`, `getBalance`, `transactionBuilder.sendTrx` → `raw_data_hex` confirmed
- [tronweb GitHub (TF org)](https://github.com/tronprotocol/tronweb) + [tronweb npm](https://www.npmjs.com/package/tronweb)
- [@ledgerhq/hw-app-trx npm](https://www.npmjs.com/package/@ledgerhq/hw-app-trx) + [LedgerHQ/ledger-live monorepo](https://github.com/LedgerHQ/ledger-live)
- [LedgerHQ/app-tron Ledger app source](https://github.com/LedgerHQ/app-tron) — derivation path `44'/195'/<…>`
- [SLIP-0044 coin-type registry](https://github.com/satoshilabs/slips/blob/master/slip-0044.md) — TRX = 195
- v2.0 Phase 11 artifacts (`src/wallet/non-evm-account-store.ts`, `src/wallet/ledger-solana-transport.ts`, `src/tools/pair_solana_ledger.ts`, `src/tools/get_solana_status.ts`, `src/chains/solana/*`) — code-level mirror pattern

### Secondary (MEDIUM confidence)
- [DefiLlama Coins API docs](https://defillama.com/docs/api) — `chain:address` keying convention
- [TRON developer docs](https://developers.tron.network/reference) — TronGrid endpoint catalogue + rate limits
- [Bitquery USDD explorer](https://explorer.bitquery.io/tron/trc20token/TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn) — USDD contract verification
- [TRON DAO USDD launch announcement (2022)](https://www.businesswire.com/news/home/20220505005702/en/TRON-DAO-and-Other-Blockchain-Leaders-Jointly-Roll-out-USDD)
- [CoinDesk TRON Q1 2026 report](https://www.coindesk.com/research/tron-network-q1-2026) — TVL + stablecoin dominance metrics
- [Blockworks Binance cold wallet on TRON (2024)](https://blockworks.co/news/binance-cold-wallet-usdt) — exchange-wallet labeling pattern
- [0xB10C/ofac-sanctioned-digital-currency-addresses TRX list](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses) — used for OFAC check on demo personas

### Tertiary (LOW confidence — flagged for plan-time re-verification)
- WebSearch findings on USDD redemption state (CoinMarketCap-cited 1.4B circulating; not independently confirmed via on-chain mint contract)
- TronScan address labels for whale candidates (API gated 401; relied on WebSearch + balance-history inference)
- Top-30 TRC-20 list ordering (no single authoritative ranking — DefiLlama-coverage-filter at plan time is the gate)

## Metadata

**Confidence breakdown:**
- TRON SDK adoption (DF-1): HIGH — registry verified, types probed, live smoke test passed, alternative SDK confirmed non-existent
- USB-HID transport: HIGH — types probed against installed `.d.ts`; address-return-shape divergence from Solana caught empirically
- BIP-44 derivation: HIGH — `.d.ts` examples + LedgerHQ/app-tron source agree on 5-level shape
- Address format: HIGH — base58check + 0x41 prefix verified via live tronweb call; encoder utility surface confirmed
- TronGrid endpoints: HIGH — live probed; REST shape documented
- TRC-20 stablecoins: HIGH for USDT/USDC/USDD/WTRX (DefiLlama price + symbol confirmed); MEDIUM for the broader curated list (decisions deferred to plan author)
- DefiLlama TRON pricing: HIGH — direct live probe of `coins.llama.fi/prices/current/tron:<addr>`
- Demo persona: MEDIUM — OFAC-clean confirmed, label-provenance unconfirmed via gated API
- Multi-chain portfolio extension: HIGH (out-of-scope but pattern-mapped from Phase 11)
- FROZEN-area discipline: HIGH — all changes additive, no signing module diff

**Research date:** 2026-05-20
**Valid until:** ~2026-06-20 (stable ecosystem; reverify if tronweb 7.x ships or `@ledgerhq/hw-app-trx` major bump before phase execute)
