# Phase 22: BTC Scaffolding — Esplora reads + USB-HID + persistent BTC account — Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 22 new / 4 modified
**Analogs found:** 22 / 22 (100% exact or role-match; Phase 22 is a mechanical clone of Phase 11 / 17 shelf shape with two genuinely new shapes — dual-address pair + UTXO-shape balance)

---

## Phase-Wide Meta-Decisions (load-bearing for planner)

These are NOT plan-local; they apply across every file in the phase. Surface in PLAN.md headers so plan-internal decisions stay consistent.

### Meta-Decision 1: PAIR-NEV-* schema reuse is FREE (no schema change)

**Surprise vs naive precedent:** Phase 11/17 each saved ONE record per pair. Phase 22 saves TWO records (segwit + taproot) per pair under `chain: "bitcoin"`. **Zero schema change required** — `non-evm-account-store.ts:43-50` already declares `"bitcoin"` in the `NonEvmChain` literal-union, and `saveAccount` (lines 241-252) upserts on `(chain, address)` so two calls with distinct addresses produce two coexisting records. Multi-record-per-chain was a v2.0 design contract (PAIR-NEV-03 — REQUIREMENTS.md:144).

**Anti-pattern to defend against:** Do NOT widen the schema to a `BitcoinAccountRecord` with sibling-address fields. Do NOT add a `script_type: "segwit" | "taproot"` discriminator. The `(chain, address)` upsert tuple IS the discriminator — address shape (`bc1q…` vs `bc1p…`) is self-describing.

**Regression anchor:** `test/non-evm-account-store.test.ts` extension MUST assert two `chain: "bitcoin"` records coexist after two `saveAccount` calls with distinct addresses.

### Meta-Decision 2: 5-level BIP-44 paths (mirror TRON, NOT Solana)

**Copy-paste regression risk:** `DEFAULT_BTC_SEGWIT_PATH = "84'/0'/0'/0/0"` + `DEFAULT_BTC_TAPROOT_PATH = "86'/0'/0'/0/0"` are 5-level BIP-44 paths (purpose / coin_type / account / change / address_index), same shape as TRON's `"44'/195'/0'/0/0"`. **Distinct from Solana's 3-level** `"44'/501'/0'"`.

**Anti-pattern to defend against:** A `lastHardenedIndex` helper copy-pasted from `pair_solana_ledger.ts` would return `0` (the address-index, last segment) for EVERY account slot. The correct helper is `accountIndex(path)` — segments[2] (account index, third segment), mirror of `src/chains/tron/address.ts::accountIndex`. Add a regression-anchor test comment naming the 5-level shape.

### Meta-Decision 3: BIP-32 Test Vector 1 → first-5-derivations literal anchor (no signing yet, but address derivation IS deterministic)

**Phase 22 has NO cryptographic-binding test fixture per the CLAUDE.md `test/signing-fingerprint.test.ts` pattern** — there is no signing in this phase. **However**, address derivation outputs ARE deterministic; the planner extends the spirit of the cryptographic-binding-fixtures convention to xpub→first-5-derivations.

Hardcoded `bc1q…` + `bc1p…` literal anchors in `test/chains-bitcoin-xpub-scan.test.ts`:
- Pinned xpub (BIP-32 Test Vector 1, account level): planner re-derives at write time via `bitcoinjs-lib.bip32.fromBase58(rawTestVector1).deriveHardened(0).deriveHardened(0)` then exports BIP-84 / BIP-86 account xpub.
- First 5 BIP-84 segwit addresses (m/84'/0'/0'/0/i for i=0..4): hardcoded `bc1q…` literals.
- First 5 BIP-86 taproot addresses (m/86'/0'/0'/0/i for i=0..4): hardcoded `bc1p…` literals.
- **NO `beforeAll`-snapshot** — drift in `bitcoinjs-lib`'s derivation OR in the payment helpers would fail at a specific line, not pass against a self-snapshotted value (per CLAUDE.md crypto-binding-fixture convention).

### Meta-Decision 4: `get_portfolio_summary` BTC leg is OUT OF SCOPE (defer to Phase 27)

**Surprise vs Phase 11/17 precedent:** Phase 11 Plan 11-05 added the Solana leg to `get_portfolio_summary`; Phase 17 Plan 17-04 added the TRON leg. Phase 22 does NOT extend `get_portfolio_summary`. Rationale (per RESEARCH.md § Plan 22-04 risks): BTC has no per-token-row aggregation surface — it's single-asset (BTC + USD); the DefiLlama price key is `coingecko:bitcoin`. The aggregation shape is structurally different from EVM / Solana / TRON per-token-row fan-out. Defer to Phase 27.

**Anti-pattern to defend against:** Do NOT add a BTC arm to `resolveSolanaWalletForFanOut`-style helpers. Do NOT extend the per-row schema. The Phase 27 implementation may take a different shape.

### Meta-Decision 5: Esplora client lives in `src/chains/bitcoin/`, NOT `src/clients/`

**Architectural placement:** `src/clients/` is reserved for cross-chain services (fourbyte selector decoder, etherscan contract-security probe, sunswap V2 router). Esplora is BTC's primary read backend — single-chain, lives in the chain shelf alongside the registry and address types. Mirror of Solana's `src/chains/solana/sol-rpc-client.ts` and TRON's `src/chains/tron/tron-rpc-client.ts` placement.

---

## File Classification

### NEW files (22)

| New File | Plan | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|------|-----------|----------------|---------------|
| `src/chains/bitcoin/registry.ts` | 22-01 | registry / config | one-shot factory | `src/chains/tron/registry.ts` | exact |
| `src/chains/bitcoin/esplora-client.ts` | 22-01, 22-03 | HTTP client | request-response (5-arm union) | `src/clients/etherscan.ts` + `src/chains/solana/sol-rpc-client.ts` | role-match (HTTP) + exact (chain-shelf placement) |
| `src/chains/bitcoin/types.ts` | 22-01 | type definitions | n/a | `src/chains/tron/types.ts` | exact |
| `src/chains/bitcoin/xpub-scan.ts` | 22-03 | aggregator | batch (gap-limit-respecting fan-out) | NONE (greenfield — closest is `getSplTokenAccounts` in `sol-rpc-client.ts` for cap-limited fan-out shape) | partial |
| `src/wallet/ledger-btc-transport.ts` | 22-02 | USB-HID transport | per-call request-response | `src/wallet/ledger-tron-transport.ts` | exact (with dual-address fetch divergence) |
| `src/tools/pair_btc_ledger.ts` | 22-02 | MCP tool (pair) | request-response | `src/tools/pair_tron_ledger.ts` | exact (with dual VERIFY-ON-DEVICE template divergence) |
| `src/tools/get_btc_status.ts` | 22-04 | MCP tool (read) | request-response | `src/tools/get_tron_status.ts` | exact (with dual-address envelope divergence) |
| `src/tools/get_btc_balance.ts` | 22-03 | MCP tool (read) | request-response | `src/tools/get_solana_balance.ts` | role-match (UTXO-shape divergence) |
| `src/tools/get_btc_balances.ts` | 22-03 | MCP tool (read) | request-response (parallel) | `src/tools/get_portfolio_summary.ts` segments using `Promise.allSettled` | role-match (parallel-2-call divergence) |
| `src/tools/get_btc_account_balance.ts` | 22-03 | MCP tool (read) | batch (gap-limit fan-out) | NONE direct (closest is `src/tools/get_solana_token_balance.ts` for SPL fan-out shape) | partial |
| `src/tools/get_btc_tx_history.ts` | 22-03 | MCP tool (read) | request-response (paginated) | NONE direct (closest is `src/tools/get_tron_block_tip.ts` for thin Esplora-like wrapper shape) | partial |
| `src/tools/get_btc_fee_estimates.ts` | 22-03 | MCP tool (read) | request-response | NONE direct (no existing fee-estimate tool — `BTC_ESPLORA_URL` is THE new shape) | greenfield |
| `src/demo/bitcoin-persona.ts` | 22-04 | demo persona registry | n/a (static) | `src/demo/tron-persona.ts` | exact |
| `test/chains-bitcoin-registry.test.ts` | 22-01 | unit test | n/a | `test/chains-tron-registry.test.ts` | exact |
| `test/chains-bitcoin-esplora-client.test.ts` | 22-01, 22-03 | unit test | n/a | `test/fourbyte.test.ts` (existing) | exact |
| `test/chains-bitcoin-address-types.test.ts` | 22-01 | unit test | n/a | TRON/Solana types tests (test/chains-tron-address.test.ts equivalent) | role-match |
| `test/chains-bitcoin-xpub-scan.test.ts` | 22-03 | unit test (with BIP-32 anchor) | n/a | `test/signing-fingerprint.test.ts` (anchor-pinning convention) | role-match |
| `test/config-env-bitcoin.test.ts` | 22-01 | unit test | n/a | `test/config-env-tron.test.ts` (equivalent existing) | exact |
| `test/ledger-btc-transport.test.ts` | 22-02 | unit test | n/a | `test/ledger-tron-transport.test.ts` | exact |
| `test/pair-btc-ledger.test.ts` | 22-02 | unit test | n/a | `test/pair-tron-ledger.test.ts` (existing) | exact |
| `test/get-btc-balance.test.ts` + `get-btc-balances.test.ts` + `get-btc-account-balance.test.ts` + `get-btc-tx-history.test.ts` + `get-btc-fee-estimates.test.ts` + `get-btc-status.test.ts` | 22-03, 22-04 | unit tests | n/a | `test/get-tron-balance.test.ts` + `test/get-tron-status.test.ts` | exact |
| `test/get-vaultpilot-config-status-bitcoin.test.ts` + `test/bitcoin-persona.test.ts` + `test/demo-state.bitcoin.test.ts` + `test/{get,set}-demo-wallet.bitcoin.test.ts` | 22-04 | unit tests | n/a | corresponding `*tron*` test files | exact |

### MODIFIED files (4)

| Modified File | Plan | Modification | Closest Analog Change |
|---------------|------|--------------|-----------------------|
| `src/config/env.ts` | 22-01 | ADD `getBtcEsploraUrl(): string \| null` (after `getTronRpcUrl()` at line 94-96) | Phase 17 `getTronRpcUrl()` addition (exact shape mirror) |
| `src/demo/state.ts` | 22-04 | ADD minimal `BtcPersona` interface + `activeBtcPersona` state + `getActiveBtcPersona` + `setActiveBtcPersona` + `setActiveBtcPersonaBySlug` setters | Phase 17 Plan 17-04 TRON carve (lines 42-202; mirror with `tronAddress` → `btcSegwitAddress` + `btcTaprootAddress`) |
| `src/tools/get_vaultpilot_config_status.ts` | 22-04 | ADD `btcEsploraConfigured` field + text-block line | Phase 17 `tronRpcConfigured` addition at line 168 (exact shape) |
| `src/tools/set_demo_wallet.ts` + `src/tools/get_demo_wallet.ts` | 22-04 | Widen slug enum to include `"btc-whale"`; route to `findBtcPersona` / `listBtcPersonas` | Phase 17 TRON slug routing (exact shape mirror) |

### EXTENDED tests (2)

| Test File | Plan | Extension | Closest Analog |
|-----------|------|-----------|----------------|
| `test/non-evm-account-store.test.ts` | 22-02 | Assert two `chain: "bitcoin"` records coexist + age independently after two `saveAccount` calls | Existing Solana / TRON record assertions in same file |
| `test/non-evm-store.eager-init.test.ts` | 22-02 | Assert cold-boot restore loads BOTH bitcoin records | Existing single-bitcoin-record restore case |

---

## Pattern Assignments

### Plan 22-01: Chain shelf + SDK adoption + env reader

#### `src/chains/bitcoin/registry.ts` (registry, one-shot factory)

**Analog:** `src/chains/tron/registry.ts` (exact match — both single-cluster, URL-only-config, lazy-singleton, warn-once-on-fallback, ESM spy seam)

**Header pattern** (lines 1-27 of analog):
```typescript
// src/chains/bitcoin/registry.ts — Phase 22 Plan 22-01.
//
// Lazy-singleton Esplora endpoint factory for BTC mainnet. Mirror of
// `src/chains/tron/registry.ts` shape — single endpoint family; no
// shorthand fan-out. Resolution priority:
//
//   (1) `BTC_ESPLORA_URL` env override wins unconditionally
//   (2) Public Esplora fallback (`https://blockstream.info/api`) with
//       once-per-process stderr `warn` (mirrors `warnedFallback` latch at
//       `chains/tron/registry.ts:42`)
//
// ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
// convention. `_bitcoinRegistry` exposes `getEsploraBaseUrl`,
// `getResolvedEsploraUrl`, `getBtcEsploraUrl` — esplora-client.ts MUST
// call through this indirection, never bare-import.
```

**Imports** (mirror lines 24-27 of analog):
```typescript
import { getBtcEsploraUrl } from "../../config/env.js";
import { log } from "../../diagnostics/logger.js";
```

**Module-scope state pattern** (mirror lines 38-42 of analog):
```typescript
const PUBLIC_ESPLORA_FALLBACK = "https://blockstream.info/api";

let cachedUrl: string | null = null;
let warnedFallback = false;
```

**Resolve + warn-once factory pattern** (mirror lines 50-83 of analog):
```typescript
function resolveEsploraUrl(): { url: string; isFallback: boolean } {
  const override = getBtcEsploraUrl();
  if (override !== null) return { url: override, isFallback: false };
  return { url: PUBLIC_ESPLORA_FALLBACK, isFallback: true };
}

function getEsploraBaseUrl(): string {
  if (cachedUrl) return cachedUrl;
  const { url, isFallback } = resolveEsploraUrl();
  cachedUrl = url;
  if (isFallback && !warnedFallback) {
    log(
      "warn",
      `Using public Esplora fallback (${url}); set BTC_ESPLORA_URL for production reliability`,
    );
    warnedFallback = true;
  }
  return cachedUrl;
}
```

**ESM spy-affordance pattern** (mirror lines 115-129 of analog):
```typescript
export const _bitcoinRegistry = {
  getEsploraBaseUrl,
  getResolvedEsploraUrl: getEsploraBaseUrl, // alias for diagnostics surface
  getBtcEsploraUrl,
};

export function _resetBitcoinRegistryForTesting(): void {
  cachedUrl = null;
  warnedFallback = false;
}

export { PUBLIC_ESPLORA_FALLBACK, getEsploraBaseUrl };
```

**Difference from analog:** No `cachedTronWeb` SDK-instance state — Esplora is HTTP, not an SDK with a stateful client. URL is the only cache.

---

#### `src/chains/bitcoin/esplora-client.ts` (HTTP client, never-throws 5-arm union)

**Analogs:**
- `src/clients/etherscan.ts` (lines 30-365 — 5-arm union, LRU cache, AbortController, `vi.stubGlobal("fetch", ...)` seam, NEVER-throws)
- `src/clients/fourbyte.ts` (lines 30-167 — 4-arm union, simpler shape)
- `src/chains/solana/sol-rpc-client.ts` (chain-shelf placement reference — NOT etherscan's `src/clients/` placement)

**Header pattern** (mirror etherscan.ts lines 1-33 + sol-rpc-client.ts placement):
```typescript
// src/chains/bitcoin/esplora-client.ts — Phase 22 Plans 22-01 + 22-03.
//
// Esplora HTTP client. NEVER-throws — returns 5-arm discriminated union:
// { kind: "ok" | "not-found" | "rate-limited" | "error" | "not-applicable" }.
// Tool handlers pattern-match on `kind`. Mirror of `src/clients/etherscan.ts`
// 5-arm pattern; lives in `src/chains/bitcoin/` (NOT `src/clients/`)
// because Esplora is BTC's primary backend, not a cross-chain service.
//
// Test seam is `vi.stubGlobal("fetch", ...)` at the OUTER network boundary —
// NOT an internal indirection (per CLAUDE.md fetch-stub convention for
// external HTTP clients).
//
// Four fetch helpers:
//   - fetchAddressInfo(addr): /address/{addr} → confirmed + unconfirmed bal
//   - fetchAddressUtxos(addr): /address/{addr}/utxo → UTXO array
//   - fetchAddressTxs(addr, opts): /address/{addr}/txs → tx page
//   - fetchFeeEstimates(): /fee-estimates → 24-key object, projected to 5
//
// Per-call timeout 5s (Esplora is slower than 4byte; lower than Etherscan).
```

**Imports + module-scope constants pattern** (mirror etherscan.ts lines 35-43 + fourbyte.ts lines 30-42):
```typescript
import { log } from "../../diagnostics/logger.js";
import { _bitcoinRegistry } from "./registry.js";

const ESPLORA_TIMEOUT_MS = 5000;
const CACHE_MAX_ENTRIES = 256;
```

**5-arm discriminated union pattern** (mirror etherscan.ts lines 44-63 — but BTC-shaped):
```typescript
export type EsploraAddressResult =
  | { kind: "not-applicable" }
  | {
      kind: "ok";
      address: string;
      confirmedBalanceSats: bigint;
      unconfirmedBalanceSats: bigint;
      txCount: number;
    }
  | { kind: "not-found"; address: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };
```

**Module-scope LRU cache pattern** (mirror etherscan.ts lines 86-94):
```typescript
const cache = new Map<string, EsploraAddressResult>();

function cacheInsert(key: string, result: EsploraAddressResult): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, result);
}
```

**Fetch + AbortController + try/catch/finally pattern** (mirror etherscan.ts lines 212-355 — adapted to single-call shape from fourbyte.ts lines 73-148):
```typescript
export async function fetchAddressInfo(address: string): Promise<EsploraAddressResult> {
  const cached = cache.get(address);
  if (cached) return cached;

  const url = `${_bitcoinRegistry.getEsploraBaseUrl()}/address/${address}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ESPLORA_TIMEOUT_MS);

  let result: EsploraAddressResult;
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (resp.status === 404) {
      result = { kind: "not-found", address };
    } else if (resp.status === 429) {
      result = { kind: "rate-limited", message: `Esplora 429 from ${url}` };
    } else if (!resp.ok) {
      result = { kind: "error", message: `Esplora returned HTTP ${resp.status}` };
      log("warn", `Esplora /address/${address} failed: ${result.message}`);
    } else {
      let body: { chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number; tx_count?: number }; mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number; tx_count?: number } };
      try {
        body = await resp.json();
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        result = { kind: "error", message: `Esplora invalid JSON: ${msg}` };
        log("warn", `Esplora /address/${address} parse failed: ${result.message}`);
        cacheInsert(address, result);
        return result;
      }
      if (!body.chain_stats) {
        result = { kind: "error", message: "Esplora missing chain_stats" };
      } else {
        const confirmedFunded = BigInt(body.chain_stats.funded_txo_sum ?? 0);
        const confirmedSpent = BigInt(body.chain_stats.spent_txo_sum ?? 0);
        const mempoolFunded = BigInt(body.mempool_stats?.funded_txo_sum ?? 0);
        const mempoolSpent = BigInt(body.mempool_stats?.spent_txo_sum ?? 0);
        result = {
          kind: "ok",
          address,
          confirmedBalanceSats: confirmedFunded - confirmedSpent,
          unconfirmedBalanceSats: mempoolFunded - mempoolSpent,
          txCount: (body.chain_stats.tx_count ?? 0) + (body.mempool_stats?.tx_count ?? 0),
        };
      }
    }
  } catch (err) {
    const e = err as Error;
    if (e?.name === "AbortError") {
      result = { kind: "error", message: `Esplora unreachable (timeout ${ESPLORA_TIMEOUT_MS}ms)` };
    } else {
      result = { kind: "error", message: `Esplora unreachable: ${e?.message ?? String(err)}` };
    }
    log("warn", `Esplora /address/${address} failed: ${result.message}`);
  } finally {
    clearTimeout(timer);
  }

  cacheInsert(address, result);
  return result;
}
```

**Test-only cache reset** (mirror etherscan.ts lines 367-371 + fourbyte.ts lines 160-167):
```typescript
export function _resetEsploraCacheForTesting(): void {
  cache.clear();
}
```

**Difference from etherscan analog:** No per-session call counter — Esplora has no API key, no per-session budget. The xpub-scan concurrency cap of 5 (Plan 22-03) lives in `xpub-scan.ts`, NOT in this client.

**Difference from fourbyte analog:** BTC uses `string` as cache key (address), not viem `Hex`. Discriminated-union includes `rate-limited` arm (Esplora has 429 from mempool.space free tier).

---

#### `src/chains/bitcoin/types.ts` (branded types + regex first-line gate)

**Analog:** `src/chains/tron/types.ts` (lines 1-100 — branded types, regex first-line gate, two-gate `assert*` pattern)

**Header pattern** (mirror lines 1-22 of analog, adapted to bech32 / bech32m):
```typescript
// src/chains/bitcoin/types.ts — Phase 22 Plan 22-01.
//
// Branded type aliases for BTC segwit + taproot addresses. Mirror of
// `src/chains/tron/types.ts` shape, but adapted to BTC's bech32 (segwit)
// + bech32m (taproot) encoding:
//
//   - Segwit (BIP-173, BIP-84):   bc1q + 39 chars (P2WPKH)
//   - Taproot (BIP-350, BIP-86):  bc1p + 58 chars (P2TR)
//
// Two-gate validation per RESEARCH § Pitfall 1: the regex is a cheap
// synchronous first-line gate; `bitcoinjs-lib.address.toOutputScript(addr,
// networks.bitcoin)` runs the full bech32/bech32m checksum check. NEVER
// regex alone — bech32 and bech32m use different checksum constants;
// regex misses cross-encoding (a bech32m-checksummed string in a bech32-
// shaped slot still passes the regex).
//
// Branded `BtcSegwitAddress` + `BtcTaprootAddress` carved as distinct types
// so a P2WPKH cannot be passed where a P2TR is expected and vice versa.
```

**Branded type pattern** (mirror lines 32-42 of analog):
```typescript
export type BtcSegwitAddress = string & { readonly __brand: "btc-segwit-address" };
export type BtcTaprootAddress = string & { readonly __brand: "btc-taproot-address" };
```

**Regex first-line gate pattern** (mirror lines 45-53 of analog):
```typescript
// bech32 — BIP-173. bc1q prefix, 39 chars total. P2WPKH only (P2WSH is 59
// chars; Phase 22 doesn't scope segwit script types beyond P2WPKH).
export const BTC_SEGWIT_RE = /^bc1q[02-9ac-hj-np-z]{38}$/;

// bech32m — BIP-350. bc1p prefix, 58 chars total. P2TR (taproot key spend).
export const BTC_TAPROOT_RE = /^bc1p[02-9ac-hj-np-z]{57}$/;
```

**Two-gate assert pattern** (mirror lines 68-79 of analog, adapted to `bitcoinjs-lib`):
```typescript
import { address as btcAddress, networks } from "bitcoinjs-lib";

export function assertBtcSegwitAddress(s: unknown): asserts s is BtcSegwitAddress {
  if (typeof s !== "string" || !BTC_SEGWIT_RE.test(s)) {
    throw new TypeError(
      `Not a valid BTC segwit address: ${typeof s === "string" ? `"${s}"` : String(s)} does not match bc1q + 39-char bech32 shape`,
    );
  }
  try {
    btcAddress.toOutputScript(s, networks.bitcoin);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new TypeError(`Not a valid BTC segwit address: "${s}" failed bech32 checksum: ${cause}`);
  }
}

export function assertBtcTaprootAddress(s: unknown): asserts s is BtcTaprootAddress {
  if (typeof s !== "string" || !BTC_TAPROOT_RE.test(s)) {
    throw new TypeError(
      `Not a valid BTC taproot address: ${typeof s === "string" ? `"${s}"` : String(s)} does not match bc1p + 58-char bech32m shape`,
    );
  }
  try {
    btcAddress.toOutputScript(s, networks.bitcoin);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new TypeError(`Not a valid BTC taproot address: "${s}" failed bech32m checksum: ${cause}`);
  }
}
```

**ADD: UTXO row + BalanceReport shape (Phase 22 NEW — load-bearing for Phase 23 coin-selection):**
```typescript
export interface UtxoRow {
  readonly txid: string;
  readonly vout: number;
  readonly valueSats: bigint;
  readonly confirmed: boolean;
  readonly blockHeight?: number;
}

export type BalanceReport =
  | { kind: "ok"; address: string; confirmedBalanceSats: bigint; unconfirmedBalanceSats: bigint; utxos: readonly UtxoRow[]; txCount: number }
  | { kind: "not-found"; address: string }
  | { kind: "error"; address: string; message: string };
```

**Difference from analog:** Two distinct address brands (segwit + taproot), not one. Adds the `UtxoRow` + `BalanceReport` types — load-bearing for Phase 23 coin-selection per RESEARCH § Plan 22-03.

---

#### `src/config/env.ts` (MODIFIED — add `getBtcEsploraUrl`)

**Analog:** Phase 17 addition of `getTronRpcUrl` at lines 83-96 of existing `env.ts`

**Modification pattern** (APPEND after `getTronRpcUrl()` at line 96, mirror lines 83-96 verbatim):
```typescript
// Phase 22 Plan 22-01 — BTC Esplora URL reader. Mirrors `getTronRpcUrl()`
// shape via the in-tree `read(name)` helper (trims whitespace, returns
// `undefined` for empty/missing). The resolution priority lives in
// `src/chains/bitcoin/registry.ts::resolveEsploraUrl()`:
//   (1) `BTC_ESPLORA_URL` env override wins
//   (2) Public Esplora fallback (`https://blockstream.info/api`) with
//       once-per-process stderr warn
// No `RPC_PROVIDER` shorthand fan-out — Esplora is URL-config-only
// (blockstream.info, mempool.space, self-hosted Esplora all use the same
// HTTP shape; documented alt-endpoints). Public-fallback requires no API
// key; operators with rate-limit pressure set BTC_ESPLORA_URL to override.
export function getBtcEsploraUrl(): string | null {
  return read("BTC_ESPLORA_URL") ?? null;
}
```

**Difference from analog:** Returns `string | null` (matches `getSolanaRpcUrl` / `getTronRpcUrl` signature shape). No `?? null` divergence.

---

### Plan 22-02: `pair_btc_ledger` + USB-HID transport + multi-derivation-path persistence

#### `src/wallet/ledger-btc-transport.ts` (USB-HID transport, per-call)

**Analog:** `src/wallet/ledger-tron-transport.ts` (lines 1-262 — per-call transport, try/finally close, `(Module as any).default ?? Module` shim, `_transport` + `_tronLedgerTransport` spy seams, error classes)

**Header pattern** (mirror lines 1-30 of analog, REGRESSION-ANCHOR'd for dual-fetch + bech32/bech32m + 5-level-path):
```typescript
// USB-HID transport + Ledger BTC app wrapper.
//
// Per-call transport (NOT a singleton): the underlying `node-hid` device
// handle MUST be closed after every APDU exchange. The next call to
// `pair_btc_ledger` opens a fresh transport. Holding the handle open
// across calls makes the next `TransportNodeHid.open()` fail with
// "device busy"; once `transport.disconnected` flips to true, every
// subsequent APDU throws `DisconnectedDevice` from `@ledgerhq/errors`.
//
// **REGRESSION ANCHOR (research § Pitfall 7 — address-format mismatch):**
// `getWalletPublicKey(path, { format })` returns the address in WHATEVER
// format the caller asks for, regardless of whether `path` agrees with
// `format`. The BIP-84 path → `format: "bech32"` mapping and the BIP-86
// path → `format: "bech32m"` mapping are HARDCODED at module scope.
// NEVER accept format as agent input.
//
// **REGRESSION ANCHOR (research § Pitfall 6 — Buffer/Uint8Array drift):**
// `bitcoinjs-lib@7` is Buffer-free at the API surface. Phase 22 does NOT
// pass any value through `bitcoinjs-lib` from this transport (the address
// comes pre-encoded from the Ledger BTC app — see Pitfall 7).
//
// **REGRESSION ANCHOR (research § Pitfall 2 — APDU table overlap with
// Litecoin):** `getAppConfiguration()` is the canonical "is BTC app open"
// gate. Without this gate, calling `getWalletPublicKey` while the Ledger
// has Litecoin open silently returns an LTC address.
//
// 5-level BIP-44 paths — mirror TRON's `"44'/195'/0'/0/0"` shape (purpose
// / coin_type / account / change / address_index). Distinct from Solana's
// 3-level `"44'/501'/0'"` — do not confuse the two.
//
// NodeNext + ESM default-export drift: `(Module as any).default ?? Module`
// shim at module scope picks the right runtime constructor without
// leaking `any` through the rest of the file. Same shape as
// `ledger-tron-transport.ts` and `ledger-solana-transport.ts`.
```

**Imports + default-export shim pattern** (mirror lines 32-49 of analog):
```typescript
import TransportNodeHidModule from "@ledgerhq/hw-transport-node-hid";
import BtcAppModule from "@ledgerhq/hw-app-btc";

import { log } from "../diagnostics/logger.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TransportNodeHid: any =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (TransportNodeHidModule as any).default ?? TransportNodeHidModule;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BtcApp: any =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BtcAppModule as any).default ?? BtcAppModule;
```

**Path constants + timeout pattern** (mirror lines 51-66 of analog):
```typescript
/**
 * Ledger Live's default BTC segwit derivation path — 5-level BIP-44, BIP-84
 * standard. P2WPKH → bc1q… prefix. Mirror of TRON's 5-level shape
 * (`44'/195'/0'/0/0`); distinct from Solana's 3-level `"44'/501'/0'"`.
 */
export const DEFAULT_BTC_SEGWIT_PATH = "84'/0'/0'/0/0";

/**
 * Ledger Live's default BTC taproot derivation path — 5-level BIP-44,
 * BIP-86 standard. P2TR → bc1p… prefix.
 */
export const DEFAULT_BTC_TAPROOT_PATH = "86'/0'/0'/0/0";

export const APPROVAL_TIMEOUT_MS = 60_000;
```

**Error class pattern** (mirror lines 73-95 of analog):
```typescript
export class LedgerDeviceNotConnectedError extends Error {
  constructor() {
    super(
      "No Ledger device detected over USB-HID. Connect your Ledger via USB, unlock it, and open the Bitcoin app, then retry.",
    );
    this.name = "LedgerDeviceNotConnectedError";
  }
}

export class LedgerBtcAppNotOpenError extends Error {
  constructor() {
    super(
      "Bitcoin app is not the active app on the Ledger. Open the Bitcoin app on the device, then retry.",
    );
    this.name = "LedgerBtcAppNotOpenError";
  }
}
```

**Spy-affordance `_transport` pattern** (mirror lines 97-111 of analog):
```typescript
export const _transport = {
  isSupported: (): Promise<boolean> => TransportNodeHid.isSupported(),
  list: (): Promise<readonly unknown[]> => TransportNodeHid.list(),
  open: (path: string | null): Promise<unknown> => TransportNodeHid.open(path),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildBtcApp: (t: unknown): any => new BtcApp({ transport: t, currency: "bitcoin" }),
};
```

**`openTransport` helper pattern** (mirror lines 130-139 of analog VERBATIM — message string adapted for BTC):
```typescript
export async function openTransport(): Promise<TransportLike> {
  const supported = await _transport.isSupported();
  if (!supported) throw new LedgerDeviceNotConnectedError();
  const devices = await _transport.list();
  if (!devices || devices.length === 0) {
    throw new LedgerDeviceNotConnectedError();
  }
  log("info", "opening USB-HID transport to Ledger device");
  return (await _transport.open(null)) as TransportLike;
}
```

**Dual-address fetch pattern (Phase 22 NEW — mirror analog `fetchTronAddress` lines 157-182, but TWO `getWalletPublicKey` calls in ONE try/finally):**
```typescript
export async function fetchBtcAddresses(
  segwitPath: string = DEFAULT_BTC_SEGWIT_PATH,
  taprootPath: string = DEFAULT_BTC_TAPROOT_PATH,
): Promise<{
  segwit: { address: string; publicKey: string; chainCode: string; derivationPath: string };
  taproot: { address: string; publicKey: string; chainCode: string; derivationPath: string };
  appVersion: string;
}> {
  const transport = await openTransport();
  try {
    const app = _transport.buildBtcApp(transport);
    let cfg: { version?: string };
    try {
      cfg = await app.getAppConfiguration();
    } catch {
      throw new LedgerBtcAppNotOpenError();
    }
    // TWO sequential APDU exchanges within ONE transport open.
    // Format / path mapping is HARDCODED — never agent-input (Pitfall 7).
    const segwit = await app.getWalletPublicKey(segwitPath, { format: "bech32", verify: true });
    const taproot = await app.getWalletPublicKey(taprootPath, { format: "bech32m", verify: true });
    return {
      segwit: {
        address: segwit.bitcoinAddress,
        publicKey: segwit.publicKey,
        chainCode: segwit.chainCode,
        derivationPath: segwitPath,
      },
      taproot: {
        address: taproot.bitcoinAddress,
        publicKey: taproot.publicKey,
        chainCode: taproot.chainCode,
        derivationPath: taprootPath,
      },
      appVersion: cfg.version ?? "unknown",
    };
  } finally {
    try {
      await transport.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("warn", `transport.close() failed during cleanup: ${message}`);
    }
  }
}
```

**Spy-affordance `_btcLedgerTransport` pattern** (mirror lines 241-251 of analog `_tronLedgerTransport`, NARROWER — Phase 22 has no signing yet so only the address-probe surface):
```typescript
export const _btcLedgerTransport = {
  fetchBtcAddresses: (
    segwitPath?: string,
    taprootPath?: string,
  ): Promise<{
    segwit: { address: string; publicKey: string; chainCode: string; derivationPath: string };
    taproot: { address: string; publicKey: string; chainCode: string; derivationPath: string };
    appVersion: string;
  }> => fetchBtcAddresses(segwitPath, taprootPath),
};
```

**Test-only reset pattern** (mirror lines 253-261 of analog):
```typescript
export function _resetLedgerBtcTransportForTesting(): void {
  // No singleton state — intentional no-op.
}
```

**Difference from analog:**
1. Dual `getWalletPublicKey` calls (not one) in single try/finally — Phase 22 NEW shape.
2. Two distinct path constants (segwit + taproot), not one.
3. `BtcApp` constructor takes named-arg object `{ transport, currency: "bitcoin" }` (mirror RESEARCH § A6 — different from TRX's single-arg ctor).
4. `verify: true` opt-in on `getWalletPublicKey` — forces on-device address display at pair time (RESEARCH § Plan 22-02 risks).
5. `chainCode` returned alongside `publicKey` — required for downstream xpub-derivation (RESEARCH § A7).
6. NO `signTransaction` export yet — Phase 23 lands the BTC PSBT signing path.

---

#### `src/tools/pair_btc_ledger.ts` (MCP tool, pair flow)

**Analog:** `src/tools/pair_tron_ledger.ts` (lines 1-293 — demo-mode-first gate, 60s race timer, VERIFY-ON-DEVICE template constant, error catch ladder, locked errorCode set)

**Header pattern** (mirror lines 1-37 of analog, BTC-divergence-flagged):
```typescript
// MCP tool: pair_btc_ledger({}) — Phase 22 Plan 22-02 (BTC-PAIR-01).
//
// USB-HID pairing of a Ledger BTC app: opens the transport, reads BOTH
// segwit (bc1q…) AND taproot (bc1p…) addresses from BIP-84 + BIP-86 paths
// in ONE device session, persists BOTH (chain, address, derivationPath,
// pairedAt) tuples to the non-EVM account store as TWO sibling records
// under `chain: "bitcoin"`, and surfaces a DUAL-address VERIFY-ON-DEVICE
// block the user MUST cross-check against the on-device address screens.
//
// Mirror of `pair_tron_ledger.ts` with three BTC-specific divergences:
//
//   1. **TWO addresses persisted per pair.** `saveAccount` upserts on the
//      `(chain, address)` tuple; two calls under `chain: "bitcoin"`
//      produce two coexisting records (PAIR-NEV-03 multi-record-per-chain
//      provision — REQUIREMENTS.md:144). NO schema change needed.
//
//   2. **Two `getWalletPublicKey` calls in ONE transport open.** The
//      `fetchBtcAddresses()` helper does the sequential exchange + single
//      try/finally close.
//
//   3. **DUAL-address VERIFY-ON-DEVICE template.** The block shows BOTH
//      addresses + BOTH derivation paths; the user verifies both screens
//      on the Ledger BTC app (which displays them in sequence per the
//      `verify: true` opt-in on `getWalletPublicKey`).
//
// Locked errorCode set (mirror of `pair_tron_ledger.ts:31-37`):
//   - DEMO_MODE_REFUSED      — demo mode active
//   - LEDGER_NOT_CONNECTED   — no USB-HID device enumerated
//   - BITCOIN_APP_NOT_OPEN   — transport opened but BTC app not active
//   - USER_REJECTED          — on-device rejection (APDU 0x6985)
//   - APPROVAL_TIMEOUT       — 60s budget exceeded racing fetchBtcAddresses
//   - INTERNAL_ERROR         — defensive catch-all (NOT in locked-5 set)
```

**Imports pattern** (mirror lines 39-49 of analog):
```typescript
import { isDemoMode } from "../config/env.js";
import { saveAccount } from "../wallet/non-evm-account-store.js";
import {
  APPROVAL_TIMEOUT_MS,
  DEFAULT_BTC_SEGWIT_PATH,
  DEFAULT_BTC_TAPROOT_PATH,
  LedgerDeviceNotConnectedError,
  LedgerBtcAppNotOpenError,
  fetchBtcAddresses,
} from "../wallet/ledger-btc-transport.js";
import { registerTool } from "./index.js";
```

**Timeout error class pattern** (mirror lines 57-64 of analog):
```typescript
export class BtcApprovalTimeoutError extends Error {
  constructor() {
    super(
      "Ledger did not approve the BTC address fetch within 60 seconds. Re-call pair_btc_ledger to retry; ensure your Ledger is unlocked and the Bitcoin app is open.",
    );
    this.name = "BtcApprovalTimeoutError";
  }
}
```

**DUAL-address VERIFY-ON-DEVICE template (Phase 22 NEW — mirror analog lines 85-94 single-address shape, expanded to dual):**
```typescript
export const VERIFY_ON_DEVICE_BTC_TEMPLATE: string = [
  "VERIFY ON DEVICE",
  "────────────────",
  "Segwit (BIP-84):  {SEGWIT_ADDRESS}",
  "                  derivation: 84'/0'/0'/0/0",
  "Taproot (BIP-86): {TAPROOT_ADDRESS}",
  "                  derivation: 86'/0'/0'/0/0",
  "",
  "Open the Bitcoin app on your Ledger. The device will display TWO addresses",
  "in sequence — one for segwit, one for taproot. BOTH must match the values",
  "shown above byte-for-byte. If anything differs, do NOT approve.",
].join("\n");
```

**Demo-mode-FIRST + 60s race + dual saveAccount pattern** (mirror analog lines 131-215, expanded to dual saveAccount):
```typescript
registerTool("pair_btc_ledger", DESCRIPTION, INPUT_SCHEMA, async () => {
  if (isDemoMode()) {
    return {
      isError: true,
      content: [{ type: "text", text: "error: pair_btc_ledger is not available in demo mode. ..." }],
      structuredContent: { errorCode: "DEMO_MODE_REFUSED" },
    };
  }

  try {
    const result = await Promise.race<{ segwit: ...; taproot: ...; appVersion: string }>([
      fetchBtcAddresses(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new BtcApprovalTimeoutError()), APPROVAL_TIMEOUT_MS);
      }),
    ]);

    const { segwit, taproot, appVersion } = result;
    const pairedAt = new Date().toISOString();

    // PAIR-NEV-* multi-record-per-chain: two saveAccount calls under
    // `chain: "bitcoin"` produce two coexisting records (Meta-Decision 1).
    saveAccount({ chain: "bitcoin", address: segwit.address, derivationPath: segwit.derivationPath, pairedAt });
    saveAccount({ chain: "bitcoin", address: taproot.address, derivationPath: taproot.derivationPath, pairedAt });

    const verifyBlock = VERIFY_ON_DEVICE_BTC_TEMPLATE
      .replace("{SEGWIT_ADDRESS}", segwit.address)
      .replace("{TAPROOT_ADDRESS}", taproot.address);

    return {
      content: [{ type: "text", text: verifyBlock }],
      structuredContent: {
        addresses: { segwit: segwit.address, taproot: taproot.address },
        derivationPaths: { segwit: segwit.derivationPath, taproot: taproot.derivationPath },
        pairedAt,
        appVersion,
      },
    };
  } catch (err) {
    // Catch ladder mirror of analog lines 218-291 — adapted to BTC errors.
    // ... LedgerDeviceNotConnectedError → LEDGER_NOT_CONNECTED
    // ... LedgerBtcAppNotOpenError → BITCOIN_APP_NOT_OPEN
    // ... BtcApprovalTimeoutError → APPROVAL_TIMEOUT
    // ... isUserRejection(err) → USER_REJECTED
    // ... fallthrough → INTERNAL_ERROR
  }
});
```

**Difference from analog:**
1. Dual `saveAccount` calls (not one).
2. `structuredContent.addresses` is an OBJECT (`{ segwit, taproot }`) not a single `address` string.
3. `structuredContent.derivationPaths` is an OBJECT (`{ segwit, taproot }`) not a single `derivationPath`.
4. NO `derivationSlot` arg widening in Phase 22 (defer to v2.2.x — RESEARCH § Plan 22-02 risks); the slot index lives in the BIP-84 / BIP-86 third segment hardcoded to `0`.
5. NO `accountIndex` helper call — VERIFY block doesn't surface the slot index (both addresses are slot-0 in Phase 22; sibling tooling can extract from `derivationPaths.segwit` if needed).

---

### Plan 22-03: Esplora read tools — balance + balances + account balance + tx history + fee estimates

#### `src/tools/get_btc_balance.ts` (MCP tool, single-address read)

**Analog:** `src/tools/get_solana_balance.ts` (lines 1-107 — JSON-schema-gated wallet input, chain-shelf call, decimal-string boundary, error class catch)

**Imports + DESCRIPTION + INPUT_SCHEMA pattern** (mirror analog lines 12-35, BTC-shaped):
```typescript
import { fetchAddressInfo, fetchAddressUtxos } from "../chains/bitcoin/esplora-client.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns the BTC balance + UTXOs for a single BTC address (bech32 segwit `bc1q…` or bech32m taproot `bc1p…`).",
  "Confirmed + unconfirmed sat amounts via Esplora; UTXOs surfaced for Phase 23 coin-selection consumption.",
  "Use this when the user provides a single BTC address. For paired-wallet BOTH script types use `get_btc_balances`. For xpub-level aggregation use `get_btc_account_balance`.",
  "`wallet` is REQUIRED — bech32 or bech32m, mainnet.",
  "Decimal-string sat amounts cross the boundary (bigint serialized as string per CLAUDE.md). 1 BTC = 100_000_000 sats (8 decimals).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description: "BTC mainnet address — bech32 (bc1q…) segwit or bech32m (bc1p…) taproot.",
      pattern: "^bc1(q[02-9ac-hj-np-z]{38}|p[02-9ac-hj-np-z]{57})$",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};
```

**Handler pattern** (mirror analog lines 47-106, 5-arm result pattern-match):
```typescript
registerTool("get_btc_balance", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
  // ... validation gate ...

  const result = await fetchAddressInfo(walletRaw);
  // Pattern-match on 5-arm union from esplora-client.ts.
  if (result.kind === "not-applicable") return /* impossible — guarded */;
  if (result.kind === "not-found") {
    return {
      content: [{ type: "text", text: `${walletRaw}: not-found (address never seen on-chain)` }],
      structuredContent: { kind: "not-found", address: walletRaw },
    };
  }
  if (result.kind === "rate-limited" || result.kind === "error") {
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${result.message}` }],
      structuredContent: { errorCode: result.kind === "rate-limited" ? "ESPLORA_RATE_LIMITED" : "ESPLORA_ERROR", message: result.message },
    };
  }
  // kind === "ok"
  const utxos = await fetchAddressUtxos(walletRaw);
  // ... merge into BalanceReport, return ...
});
```

**Difference from analog:**
1. Esplora client returns a 5-arm union, NOT a thrown `SolanaRpcError`. Pattern-match on `result.kind`, not try/catch.
2. Two Esplora calls (`fetchAddressInfo` + `fetchAddressUtxos`), not one (`getNativeBalance`).
3. `bigint` sat amounts on the boundary serialized as decimal STRING (`.toString()`).

---

#### `src/tools/get_btc_balances.ts` (parallel segwit + taproot)

**Analog:** No direct match. Closest is `get_portfolio_summary`'s per-chain `Promise.allSettled` shape. **Use `Promise.allSettled([fetchAddressInfo(segwit), fetchAddressInfo(taproot)])`** so one-side rate-limit doesn't tank the whole call (per RESEARCH § Plan 22-03 concrete guidance #3).

**Pattern:**
```typescript
const [segwitResult, taprootResult] = await Promise.allSettled([
  fetchAddressInfo(wallet.segwit),
  fetchAddressInfo(wallet.taproot),
]);
// Per-script-type BalanceReport, with `kind: "error"` arm for rejected promises.
```

---

#### `src/chains/bitcoin/xpub-scan.ts` + `src/tools/get_btc_account_balance.ts` (xpub gap-limit scan)

**Analog:** No direct match. Greenfield — closest reference is `getSplTokenAccounts` (sol-rpc-client.ts:163-199) for client-side fan-out shape, and the `getMintDecimals` per-mint fan-out pattern in Plan 11-05.

**Concrete guidance** (RESEARCH § Plan 22-03 #4):
- `BIP44_GAP_LIMIT = 20`.
- Concurrency cap: scan in batches of 5 parallel fetches.
- Stop after 20 consecutive `chain_stats.tx_count + mempool_stats.tx_count === 0` addresses (NOT just `chain_stats.tx_count` — Pitfall avoided per RESEARCH § Plan 22-03 risks).
- Per-xpub TTL cache: 5 minutes.

**Pattern (greenfield — author per RESEARCH § Don't Hand-Roll table):**
```typescript
import { BIP32Factory } from "bip32";
import * as ecc from "tiny-secp256k1"; // transitive via bitcoinjs-lib
import { networks, payments } from "bitcoinjs-lib";

const bip32 = BIP32Factory(ecc);
const BIP44_GAP_LIMIT = 20;
const SCAN_CONCURRENCY = 5;
const SCAN_TTL_MS = 5 * 60 * 1000;

export async function scanXpub(xpub: string, scriptType: "p2wpkh" | "p2tr"): Promise<{ totalConfirmedSats: bigint; addressesScanned: number }> {
  // Derive child pubkeys via bip32.fromBase58(xpub).derive(0).derive(i)
  // Convert pubkey → address via payments.p2wpkh / payments.p2tr
  // Fetch in batches of SCAN_CONCURRENCY; stop after BIP44_GAP_LIMIT consecutive empties
  // Cache result per (xpub, scriptType) with SCAN_TTL_MS expiry
}
```

---

#### `src/tools/get_btc_tx_history.ts` (paginated tx list)

**Analog:** No direct match. Closest is `get_tron_block_tip.ts` for thin chain-RPC-wrap shape. Pagination is Esplora-specific (cursor `:last_seen_txid`, not offset/limit).

**Pattern:** Single Esplora call `/address/{addr}/txs[/chain/:last_seen_txid]`; stripped-down per-row shape `{ txid, blockHeight?, confirmedAt?, valueDelta, fee }` (NOT full vin/vout — defer to Phase 23/24).

---

#### `src/tools/get_btc_fee_estimates.ts` (fee estimates)

**Analog:** Greenfield (no existing fee-estimate tool). Single Esplora call to `/fee-estimates` → projection to 5-key shape `{ "1", "2", "3", "6", "144" }` per ROADMAP Success Criterion #7.

**Pattern:**
```typescript
const result = await fetchFeeEstimates();
if (result.kind !== "ok") return /* error envelope */;
const projected = {
  "1": result.estimates["1"],
  "2": result.estimates["2"],
  "3": result.estimates["3"],
  "6": result.estimates["6"],
  "144": result.estimates["144"],
};
```

**Anti-pattern:** Do NOT hit mempool.space's `/v1/fees/recommended` even when `BTC_ESPLORA_URL` points at mempool.space — both endpoints expose `/api/fee-estimates` with the standard Esplora shape (verified in research).

---

### Plan 22-04: `get_btc_status` + config-status surfacing + BTC whale persona

#### `src/tools/get_btc_status.ts` (read-only status surface)

**Analog:** `src/tools/get_tron_status.ts` (lines 1-110 — listAccounts({ chainFilter }), zero-record short-circuit, derivationPath surfaced here, staleAccountWarning per-record)

**Header pattern** (mirror lines 1-23 of analog, dual-address divergence flagged):
```typescript
// MCP tool: get_btc_status({}) — Phase 22 Plan 22-04 (BTC-PAIR-02).
//
// Read-only counterpart to `pair_btc_ledger`. Surfaces the persistent
// non-EVM store's BTC records as a structured envelope. Multi-record-per-
// chain shape: segwit (bc1q…) + taproot (bc1p…) records coexist under
// `chain: "bitcoin"`; this tool aggregates both into a single
// `{ paired: true, addresses: { segwit, taproot }, derivationPaths: {…} }`
// envelope.
//
// `derivationPaths` IS surfaced here (the caller explicitly asked for
// their own pairing status). The shoulder-surfing defense applies to
// `list_paired_non_evm_accounts`, which iterates and would otherwise leak
// per-chain BIP44 indices across the whole non-EVM surface.
//
// `staleAccountWarning: true` per-record — segwit and taproot age
// independently. The envelope flag fires when EITHER record is stale.
//
// `ledgerBtcAppVersion: undefined` — Phase 22 does NOT lazy-probe the
// device at status-call time; the cache record holds no version. Defer
// the lazy-probe diagnostic to Phase 27 (`get_btc_setup_status` analogue).
```

**Handler pattern** (mirror analog lines 46-109, expanded to dual-record envelope):
```typescript
registerTool("get_btc_status", DESCRIPTION, INPUT_SCHEMA, async () => {
  let records: NonEvmAccountView[];
  try {
    records = listAccounts({ chainFilter: "bitcoin" });
  } catch {
    records = [];
  }

  if (records.length === 0) {
    return {
      content: [{ type: "text", text: "paired: false (no BTC Ledger pairing in the persistent cache; call pair_btc_ledger to pair)" }],
      structuredContent: { paired: false },
    };
  }

  // Discriminate segwit vs taproot by address-prefix.
  const segwitRecord = records.find((r) => r.address.startsWith("bc1q"));
  const taprootRecord = records.find((r) => r.address.startsWith("bc1p"));

  const addresses: { segwit?: string; taproot?: string } = {};
  const derivationPaths: { segwit?: string; taproot?: string } = {};
  if (segwitRecord) {
    addresses.segwit = segwitRecord.address;
    derivationPaths.segwit = segwitRecord.derivationPath;
  }
  if (taprootRecord) {
    addresses.taproot = taprootRecord.address;
    derivationPaths.taproot = taprootRecord.derivationPath;
  }

  const esploraEndpoint = _bitcoinRegistry.getResolvedEsploraUrl();
  const staleAccountWarning = Boolean(segwitRecord?.staleAccountWarning || taprootRecord?.staleAccountWarning);
  const pairedAt = segwitRecord?.pairedAt ?? taprootRecord?.pairedAt;

  return {
    content: [{ type: "text", text: /* lines.join("\n") */ }],
    structuredContent: {
      paired: true,
      addresses,
      derivationPaths,
      esploraEndpoint,
      pairedAt,
      ...(staleAccountWarning ? { staleAccountWarning: true } : {}),
    },
  };
});
```

**Difference from analog:**
1. Two records discriminated by address-prefix (bc1q vs bc1p), not one.
2. `addresses` + `derivationPaths` are OBJECTS, not single strings.
3. `esploraEndpoint` field (not `rpcEndpoint`) — different backend.
4. NO `ledgerBtcAppVersion` lazy-probe (defer to Phase 27).
5. `addresses.segwit` / `addresses.taproot` can each independently be `undefined` (user paired one script type only).

---

#### `src/demo/bitcoin-persona.ts` (BTC whale persona registry)

**Analog:** `src/demo/tron-persona.ts` (lines 1-156 — DOA validation at module load, bySlug Map, OFAC ritual comment block, sibling-interface NOT EVM-Persona-widening)

**Header + verification-ritual comment pattern** (mirror lines 1-33 of analog, dual-address divergence):
```typescript
// Curated BTC demo persona registry (Plan 22-04 / BTC read-only demo).
//
// Sibling to `src/demo/personas.ts` (EVM), `src/demo/solana-persona.ts`,
// and `src/demo/tron-persona.ts` — the EVM `Persona.slug` literal-union
// stays narrow to its 4 EVM slugs. BTC gets its own `BtcPersonaSlug`
// literal-union here; `set_demo_wallet` routes BTC slugs to this
// registry, TRON slugs to TRON, Solana slugs to Solana, EVM slugs to EVM.
//
// BTC persona VERIFICATION RITUAL (perform at plan-author time + at every
// persona addition):
//
//   1. Confirm via mempool.space UI that BOTH addresses (segwit + taproot)
//      are not labeled as sanctioned entities or hacked exchanges.
//      https://mempool.space/address/<ADDR>
//   2. Confirm against the OFAC SDN list via the 0xB10C registry:
//      https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses
//   3. Confirm BOTH addresses have non-trivial balance + activity history.
//   4. Note the verification date in a comment beside each entry.
//
// Plan 22-04 picks <whale candidate — planner re-verifies at write time>.
// Fallback candidates documented inline if the preferred entry proves problematic.
//
// DOA validation: every `btcSegwitAddress` AND `btcTaprootAddress` in
// `BTC_PERSONAS` is validated via `bitcoinjs-lib.address.toOutputScript(addr,
// networks.bitcoin)` at module-load. Full bech32/bech32m checksum gate
// throws at import time on any malformed entry — fail-fast.
```

**Sibling interface pattern** (mirror lines 45-73 of analog):
```typescript
import { address as btcAddress, networks } from "bitcoinjs-lib";

import type { BtcPersona as BtcPersonaState } from "./state.js";

export type BtcPersonaSlug = "btc-whale";

export interface BtcPersona {
  readonly slug: BtcPersonaSlug;
  readonly chain: "bitcoin";
  /** bech32-encoded segwit address (load-bearing canonical demo address). */
  readonly btcSegwitAddress: string;
  /** bech32m-encoded taproot address (sibling demo address). */
  readonly btcTaprootAddress: string;
  readonly description: string;
  readonly rehearsableFlows: readonly string[];
  /** Phase 23 anchor — typed but not consumed in Phase 22. */
  readonly simulationEnvelopeShape: "psbt-mempool-replay";
}
```

**Registry + DOA validation pattern** (mirror lines 95-129 of analog, DUAL-address validation):
```typescript
export const BTC_PERSONAS: readonly BtcPersona[] = [
  {
    slug: "btc-whale",
    chain: "bitcoin",
    btcSegwitAddress: "bc1q...", // planner re-verifies at write time
    btcTaprootAddress: "bc1p...", // planner re-verifies at write time
    description: "...",
    rehearsableFlows: [
      "get_btc_balance against a real mainnet whale",
      "get_btc_balances exercising both script types",
      "get_btc_fee_estimates returning live sat/vB estimates",
    ],
    simulationEnvelopeShape: "psbt-mempool-replay",
  },
] as const;

// DOA validation at module load — BOTH addresses per persona.
for (const p of BTC_PERSONAS) {
  try {
    btcAddress.toOutputScript(p.btcSegwitAddress, networks.bitcoin);
  } catch (err) {
    throw new Error(`BTC persona "${p.slug}" has invalid btcSegwitAddress: ${p.btcSegwitAddress}`);
  }
  try {
    btcAddress.toOutputScript(p.btcTaprootAddress, networks.bitcoin);
  } catch (err) {
    throw new Error(`BTC persona "${p.slug}" has invalid btcTaprootAddress: ${p.btcTaprootAddress}`);
  }
}

const bySlug = new Map(BTC_PERSONAS.map((p) => [p.slug, p]));

export function findBtcPersona(slug: string): BtcPersona | undefined {
  return bySlug.get(slug as BtcPersonaSlug);
}

export function listBtcPersonas(): readonly BtcPersona[] {
  return BTC_PERSONAS;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _stateShapeWitness: BtcPersonaState = BTC_PERSONAS[0]!;
```

**Difference from analog:**
1. TWO address fields per persona (segwit + taproot), each independently validated.
2. DOA validation loop runs TWO `toOutputScript` calls per persona (one per script type).
3. `simulationEnvelopeShape: "psbt-mempool-replay"` (Phase 23 anchor; differs from TRON's `triggerconstantcontract` and Solana's `simulateTransaction`).

---

#### `src/demo/state.ts` (MODIFIED — add `BtcPersona` carve)

**Analog:** Phase 17 Plan 17-04 TRON carve at `state.ts` lines 42-202 (interface + state + getter + setter + setterBySlug)

**Modification pattern** (APPEND after `setActiveTronPersonaBySlug` at line 191; mirror lines 42-202 verbatim):
```typescript
// Phase 22 — Plan 22-04 carve. The full `BtcPersona` interface +
// registry ship in `src/demo/bitcoin-persona.ts`; this file defines the
// minimal shape so set_demo_wallet's BTC slug routing compiles against
// a stable contract. Plan 22-04's `setActiveBtcPersona` accepts any
// value matching this carved shape; bitcoin-persona.ts hands it values
// from BTC_PERSONAS which satisfy both. Mirror of the 17-04 TRON carve.
export interface BtcPersona {
  readonly slug: string;
  /** bech32-encoded segwit address (bc1q…, 39 chars). */
  readonly btcSegwitAddress: string;
  /** bech32m-encoded taproot address (bc1p…, 58 chars). */
  readonly btcTaprootAddress: string;
  readonly description?: string;
}

let activeBtcPersona: BtcPersona | null = null;

export function getActiveBtcPersona(): BtcPersona | null {
  return activeBtcPersona;
}

export function setActiveBtcPersona(persona: BtcPersona): BtcPersona {
  if (!persona || typeof persona.btcSegwitAddress !== "string" || typeof persona.btcTaprootAddress !== "string") {
    throw new Error("setActiveBtcPersona: persona must have btcSegwitAddress AND btcTaprootAddress");
  }
  activeBtcPersona = persona;
  return persona;
}

export function setActiveBtcPersonaBySlug(slug: string): BtcPersona {
  const persona = findBtcPersona(slug);
  if (!persona) {
    throw new Error(`unknown BTC persona slug: ${String(slug)}`);
  }
  return setActiveBtcPersona(persona);
}
```

**Also MODIFY `_resetActivePersonaForTesting`** at line 198 to add `activeBtcPersona = null;`.

**Difference from analog:** Persona shape carries TWO addresses, not one. `setActiveBtcPersona` validates BOTH are strings.

---

#### `src/tools/get_vaultpilot_config_status.ts` (MODIFIED — add `btcEsploraConfigured`)

**Analog:** Phase 17 addition of `tronRpcConfigured` at lines 165-168 of existing tool

**Modification pattern** (mirror lines 165-168 verbatim, BTC-shaped — APPEND after `tronRpcConfigured` line):
```typescript
// Phase 22 Plan 22-04 — BTC Esplora configured boolean. Mirror of
// `solanaRpcConfigured` / `tronRpcConfigured` semantics: TRUE iff
// `BTC_ESPLORA_URL` is explicitly set; the public blockstream.info
// fallback does NOT count.
const btcEsploraConfigured = getBtcEsploraUrl() !== null;
```

Add `btcEsploraConfigured` to the `structured` object at line 194+ (insert after `tronRpcConfigured`).

Add the rendered line at line 235+ (insert after `tronRpcConfigured` line):
```typescript
lines.push(`  btcEsploraConfigured:            ${btcEsploraConfigured}`);
```

**ZERO change** to `pairedNonEvmChains` aggregation at lines 159-162 — the existing `[...new Set(nonEvmRecords.map((r) => r.chain))].sort()` automatically picks up `"bitcoin"` when records exist (per RESEARCH § Plan 22-04 concrete guidance #2). Only TEST additions needed.

**Anti-pattern to defend against:** Do NOT widen `pairedNonEvmChains` to deduplicate by script-type. Phase 22 ships TWO bitcoin records per pair; the aggregation correctly surfaces `"bitcoin"` once (`new Set` deduplicates).

---

## Shared Patterns (cross-cutting)

### Pattern: Per-call Ledger USB-HID transport with try/finally close

**Source:** `src/wallet/ledger-tron-transport.ts` (lines 130-182) + `src/wallet/ledger-solana-transport.ts`
**Apply to:** `src/wallet/ledger-btc-transport.ts`

**Excerpt** (`ledger-tron-transport.ts:130-182`):
```typescript
export async function openTransport(): Promise<TransportLike> {
  const supported = await _transport.isSupported();
  if (!supported) throw new LedgerDeviceNotConnectedError();
  const devices = await _transport.list();
  if (!devices || devices.length === 0) {
    throw new LedgerDeviceNotConnectedError();
  }
  log("info", "opening USB-HID transport to Ledger device");
  return (await _transport.open(null)) as TransportLike;
}

export async function fetchTronAddress(...): Promise<...> {
  const transport = await openTransport();
  try {
    // ... APDU exchange ...
  } finally {
    try {
      await transport.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("warn", `transport.close() failed during cleanup: ${message}`);
    }
  }
}
```

---

### Pattern: NEVER-throws 5-arm discriminated union (HTTP client)

**Source:** `src/clients/etherscan.ts` (lines 44-63 — 5-arm union; lines 86-94 — LRU cache; lines 212-355 — AbortController + try/catch/finally)
**Apply to:** `src/chains/bitcoin/esplora-client.ts`

**Excerpt** (`etherscan.ts:212-355` core pattern):
```typescript
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

let result: ResultType;
try {
  const resp = await fetch(url, { signal: controller.signal });
  if (!resp.ok) {
    result = { kind: "error", message: `... HTTP ${resp.status}` };
  } else {
    // ... parse + classify into 5 arms ...
  }
} catch (err) {
  const e = err as Error;
  if (e?.name === "AbortError") {
    result = { kind: "error", message: `... unreachable (timeout ${TIMEOUT_MS}ms)` };
  } else {
    result = { kind: "error", message: `... unreachable: ${e?.message ?? String(err)}` };
  }
} finally {
  clearTimeout(timer);
}

cacheInsert(key, result);
return result;
```

---

### Pattern: ESM spy-affordance indirection (`_<scope>` object)

**Source:** `src/wallet/ledger-tron-transport.ts` (lines 97-111 `_transport` + lines 232-251 `_tronLedgerTransport`) + `src/chains/tron/registry.ts` (lines 115-129 `_tronRegistry`)
**Apply to:** `src/chains/bitcoin/registry.ts` (`_bitcoinRegistry`) + `src/wallet/ledger-btc-transport.ts` (`_transport` + `_btcLedgerTransport`)
**NOT applied to:** `src/chains/bitcoin/esplora-client.ts` — fetch-stub at the outer network boundary instead (per CLAUDE.md fetch-stub convention; mirror of `fourbyte.ts` + `etherscan.ts` test seam)

**Excerpt** (`ledger-tron-transport.ts:97-111`):
```typescript
export const _transport = {
  isSupported: (): Promise<boolean> => TransportNodeHid.isSupported(),
  list: (): Promise<readonly unknown[]> => TransportNodeHid.list(),
  open: (path: string | null): Promise<unknown> => TransportNodeHid.open(path),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildTrxApp: (t: unknown): any => new TrxApp(t),
};
```

---

### Pattern: Demo-mode-FIRST gate in pair tools (zero device-touch on refusal)

**Source:** `src/tools/pair_tron_ledger.ts` (lines 131-147) + `src/tools/pair_solana_ledger.ts`
**Apply to:** `src/tools/pair_btc_ledger.ts`

**Excerpt** (`pair_tron_ledger.ts:131-147`):
```typescript
registerTool("pair_tron_ledger", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // T-DEMO-1 mitigation: demo-mode check FIRST, BEFORE any USB-HID
  // transport open. The mocked `fetchTronAddress` spy must observe zero
  // invocations in this branch.
  if (isDemoMode()) {
    return {
      isError: true,
      content: [{ type: "text", text: "error: pair_tron_ledger is not available in demo mode. ..." }],
      structuredContent: { errorCode: "DEMO_MODE_REFUSED" },
    };
  }
  // ... rest of pairing logic ...
});
```

---

### Pattern: 60-second on-device approval race timer

**Source:** `src/tools/pair_tron_ledger.ts` (lines 178-189) + `src/tools/pair_solana_ledger.ts`
**Apply to:** `src/tools/pair_btc_ledger.ts`

**Excerpt** (`pair_tron_ledger.ts:178-189`):
```typescript
const result = await Promise.race<{ ... }>([
  fetchTronAddress(derivationPath),
  new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new TronApprovalTimeoutError()),
      APPROVAL_TIMEOUT_MS,
    );
  }),
]);
```

---

### Pattern: PAIR-NEV-* `saveAccount` upsert (multi-record-per-chain)

**Source:** `src/wallet/non-evm-account-store.ts` (lines 241-252 — `(chain, address)` upsert key)
**Apply to:** `src/tools/pair_btc_ledger.ts` (TWO `saveAccount` calls)

**Excerpt** (`non-evm-account-store.ts:241-252`):
```typescript
export function saveAccount(record: NonEvmAccountRecord): void {
  loadFromDisk();
  const filtered = inMemoryStore.filter(
    (r) => !(r.chain === record.chain && r.address === record.address),
  );
  filtered.push(record);
  inMemoryStore = filtered;

  if (getNonEvmStorageMode() === "memory") return;
  _storage.ensureStorageDirWithPerms(getNonEvmStorageDir());
  writeAtomic(inMemoryStore);
}
```

---

### Pattern: Sibling-interface persona registry (NOT slug-widening of EVM `Persona`)

**Source:** `src/demo/tron-persona.ts` (lines 1-156) + `src/demo/solana-persona.ts`
**Apply to:** `src/demo/bitcoin-persona.ts`

**Excerpt** (`tron-persona.ts:45-73`):
```typescript
export type TronPersonaSlug = "tron-whale";

export interface TronPersona {
  readonly slug: TronPersonaSlug;
  readonly chain: "tron";
  readonly tronAddress: string;
  readonly description: string;
  readonly rehearsableFlows: readonly string[];
  readonly simulationEnvelopeShape: "triggerconstantcontract";
}
```

---

### Pattern: DOA validation at module load (fail-fast on bad address)

**Source:** `src/demo/tron-persona.ts` (lines 122-129) + `src/demo/solana-persona.ts` (lines 109-111)
**Apply to:** `src/demo/bitcoin-persona.ts` — DUAL validation (segwit + taproot)

**Excerpt** (`tron-persona.ts:122-129`):
```typescript
for (const p of TRON_PERSONAS) {
  if (!tronUtils.address.isAddress(p.tronAddress)) {
    throw new Error(
      `TRON persona "${p.slug}" has invalid tronAddress: ${p.tronAddress}. ` +
        `Address must pass tronUtils.address.isAddress (full base58check + checksum + 0x41 prefix).`,
    );
  }
}
```

---

### Pattern: Two-gate address validation (regex first-line + SDK full-check)

**Source:** `src/chains/tron/types.ts` (lines 68-79 — `assertTronAddress`)
**Apply to:** `src/chains/bitcoin/types.ts` (`assertBtcSegwitAddress` + `assertBtcTaprootAddress`)

**Excerpt** (`tron/types.ts:68-79`):
```typescript
export function assertTronAddress(s: unknown): asserts s is TronAddress {
  if (typeof s !== "string" || !TRON_ADDRESS_RE.test(s)) {
    throw new TypeError(`Not a valid TRON address: ... does not match T-prefixed 34-char base58 shape`);
  }
  if (!tronUtils.address.isAddress(s)) {
    throw new TypeError(`Not a valid TRON address: "${s}" failed base58check/checksum validation`);
  }
}
```

---

### Pattern: Hardcoded cryptographic literal anchor (adapted for deterministic-derivation outputs)

**Source:** CLAUDE.md `## Conventions` — "Cryptographic-binding fixtures pinned as hardcoded literals" (canonical fixtures A/B/C/D/E/F)
**Apply to:** `test/chains-bitcoin-xpub-scan.test.ts` — BIP-32 Test Vector 1 xpub → first-5-derivations bc1q/bc1p literals

**Excerpt** (canonical convention from CLAUDE.md):
> Every new shape of `payloadFingerprint` / `presignHash` input gets a hardcoded `0x...` literal in `test/signing-fingerprint.test.ts`. ... NO `beforeAll`-snapshot — drift in preimage assembly must fail at a specific line, not pass against a self-snapshotted value.

**Phase 22 adaptation:**
- Phase 22 has NO signing, NO payloadFingerprint — but address derivation IS deterministic.
- The same convention applies to xpub → child address derivation: hardcoded `bc1q…` + `bc1p…` literals in `test/chains-bitcoin-xpub-scan.test.ts`.
- Drift in `bitcoinjs-lib`'s BIP-32 derivation, or in the bech32 / bech32m payment helpers, would fail at a specific test line.

---

## No Analog Found (greenfield — author per RESEARCH.md guidance)

| File | Role | Data Flow | Why No Analog |
|------|------|-----------|---------------|
| `src/chains/bitcoin/xpub-scan.ts` | aggregator | batch fan-out | First in-tree gap-limit-respecting scan. RESEARCH § Plan 22-03 #4 prescribes BIP44_GAP_LIMIT=20, concurrency-cap=5, TTL=5min, batch-of-5. Closest reference is `getSplTokenAccounts` (sol-rpc-client.ts:163-199) for cap-limited fan-out shape — partial match. |
| `src/tools/get_btc_account_balance.ts` | MCP tool | batch fan-out | Consumer of `xpub-scan.ts`. No existing fan-out-aggregator tool. |
| `src/tools/get_btc_tx_history.ts` | MCP tool | request-response (paginated) | First in-tree paginated read. Esplora's `:last_seen_txid` cursor is the canonical pagination shape; documented in API.md but new to the codebase. |
| `src/tools/get_btc_fee_estimates.ts` | MCP tool | request-response | First in-tree fee-estimate surface. Esplora's `/fee-estimates` returns 24-key `Record<string, number>`; tool projects to 5-key shape per ROADMAP SC#7. |

---

## Metadata

**Analog search scope:** `src/chains/{solana,tron}/`, `src/wallet/`, `src/demo/`, `src/clients/`, `src/config/`, `src/tools/{pair,get}_{solana,tron}_*.ts`
**Files scanned:** ~25 source files + RESEARCH.md (878 lines) + CONTEXT.md (88 lines)
**Pattern extraction date:** 2026-05-21
**RESEARCH.md valid until:** 2026-06-20
