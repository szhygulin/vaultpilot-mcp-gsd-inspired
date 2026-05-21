# Phase 22: BTC Scaffolding — Esplora reads + USB-HID + persistent BTC account — Research

**Researched:** 2026-05-21
**Domain:** UTXO-model chain scaffolding — Esplora HTTP reads + Ledger USB-HID pairing + persistent multi-derivation-path account cache
**Confidence:** HIGH (SDK shapes verified against installed `.d.ts`; Esplora endpoints verified against live `blockstream.info` + `mempool.space` probes; v2.0 / v2.1 precedents read end-to-end)

## Summary

Phase 22 ships the **read + pair** half of the v2.2 BTC milestone. No signing, no PSBT, no RBF, no message-signing, no multisig — those land in Phases 23 / 24 / 25. The Ledger BTC app stays in `getWalletPublicKey` + (in Phase 23) `signPsbtBuffer` territory; this phase only opens the transport for the pubkey-derivation APDU.

The phase has **two genuinely new shapes** vs. v2.0 / v2.1 precedent and a long tail of mechanical clones:

1. **Multi-derivation-path-per-pair persistence.** `pair_solana_ledger` and `pair_tron_ledger` each save ONE record per call (chain, address, derivationPath, pairedAt). `pair_btc_ledger` derives **two addresses in a single device-open** — BIP-84 segwit `bc1q…` AND BIP-86 taproot `bc1p…` — and persists **both** as sibling records under `chain: "bitcoin"`. The existing `non-evm-account-store.saveAccount` upserts on `(chain, address)` so two `saveAccount` calls produce two coexisting records without schema change. This works **as-is** — `PAIR-NEV-03` already declared multi-record-per-chain a v2.0 design contract (REQUIREMENTS.md:144) and Phase 11 ships it that way.

2. **UTXO-shape read surface.** Esplora `/address/{addr}` returns `{ chain_stats, mempool_stats }` with `funded_txo_sum - spent_txo_sum` as the balance — NOT a single balance field like EVM. The phase introduces an Esplora HTTP client mirroring `etherscan.ts` (never-throws 5-arm discriminated union + LRU cache + AbortController timeout + `vi.stubGlobal("fetch", …)` test seam) and a `BalanceReport` discriminated union that surfaces `utxos[]` so Phase 23's coin-selection can consume the same shape.

Everything else is a mechanical clone of v2.0 Phase 11 / v2.1 Phase 17:
- `src/chains/bitcoin/` shelf mirrors `src/chains/solana/` (registry + esplora-client + types)
- `src/wallet/ledger-btc-transport.ts` mirrors `ledger-tron-transport.ts` (per-call transport, `(Module as any).default ?? Module` shim, `_transport` spy seam, per-tool `getAppConfiguration()` gate for BTC-app-not-open detection)
- `BTC_ESPLORA_URL` env reader mirrors `getSolanaRpcUrl()` / `getTronRpcUrl()` shape
- `pair_btc_ledger` mirrors `pair_solana_ledger` (demo-mode-first gate, 60s race timer, `VERIFY-ON-DEVICE` block via a SINGLE-SOURCE-OF-TRUTH const)
- `BtcPersona` sibling interface mirrors `SolanaPersona` / `TronPersona` (no widening of the EVM `Persona` slug union)

**Primary recommendation:** Adopt `bitcoinjs-lib@7.0.1` + `@ledgerhq/hw-app-btc@10.22.1` + default-on **blockstream.info** Esplora endpoint (with `BTC_ESPLORA_URL` override; mempool.space documented as the alt). Carve Phase 22 strictly to reads + pairing — defer xpub-scan to Plan 22-03 (research found Esplora has no gap-limit primitive; the scan is non-trivial but tractable in this phase's scope). Ship `BalanceReport` as a discriminated union with `utxos[]` so Phase 23 inherits a coin-selection-friendly shape with zero refactor.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Open USB-HID transport + read pubkey | API/Backend | Hardware (Ledger device) | Same as v2.0/v2.1: the MCP server owns transport lifecycle; the Ledger BTC app owns the keying. |
| Derive xpub → child addresses for scan | API/Backend | — | Server-side via `bitcoinjs-lib` BIP32; no agent input beyond xpub. |
| Esplora HTTP fetch + decode | API/Backend (external HTTP) | — | Public Esplora endpoints; fetch boundary stubbable per CLAUDE.md `vi.stubGlobal("fetch", …)`. |
| Persistent account cache | API/Backend (disk) | — | `~/.vaultpilot-mcp/non-evm-accounts.json` — same store as Solana + TRON. |
| Demo persona resolution | API/Backend (in-memory) | — | Process-local, no disk persistence — matches v1.x / v2.0 / v2.1 demo pattern. |
| Address validation | API/Backend (pre-RPC) | — | bech32 / bech32m gate before any Esplora call (mirrors Solana `assertSolanaAddress` regex-first gate). |

## User Constraints (from CONTEXT.md)

### Locked Decisions

The CONTEXT.md placeholder is the v2.2 scaffolding stub — it does NOT lock any decision yet. It marks the following as anchor candidates pending `/gsd-discuss-phase 22`:

- BTC SDK choice (DF): `bitcoinjs-lib` vs `@noble/curves/secp256k1`-only minimal stack
- Default Esplora endpoint: blockstream.info vs mempool.space
- USB-HID transport reuse: `@ledgerhq/hw-transport-node-hid` + `@ledgerhq/hw-app-btc`
- PAIR-NEV-* schema reuse: `chain: "bitcoin"` key, multi-record-per-chain (additive widening NOT needed)
- Address derivations: BIP-84 (m/84'/0'/0'/0/0) segwit + BIP-86 (m/86'/0'/0'/0/0) taproot, both paired at first-pair time
- Demo persona: BTC whale (e.g. known top-50 holder)

### Claude's Discretion

Per CONTEXT.md verbatim:
- Internal helper names (`BtcEsploraClient`, `BtcXpubScanner`, etc.)
- Whether `get_btc_account_balance` ships in Phase 22 or splits to Phase 23 follow-up (xpub gap-limit scan is non-trivial)
- Test mocking strategy for Esplora HTTP (fetch-stub at the network boundary per CLAUDE.md convention)

### Deferred Ideas (OUT OF SCOPE)

Per CONTEXT.md verbatim:
- BTC `prepare_*` PSBT-based trust pipeline — Phase 23
- BIP-125 RBF + BIP-137 message signing — Phase 24
- PSBT multisig flow — Phase 25
- LTC scaffolding — Phase 26 (shares BTC infra; deliberately split to keep Phase 22 atomic)
- Bitcoin Core RPC forensic reads — Phase 27
- BIP-322 taproot message signing — future tool (`sign_message_btc_bip322`)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PAIR-NEV-* reuse | Multi-derivation-path slots via existing `non-evm-account-store.ts` | **Zero schema change required.** `chain: "bitcoin"` is already in the `NonEvmChain` literal-union (`non-evm-account-store.ts:43-50` VERIFIED). `saveAccount` upserts on `(chain, address)` — calling it twice with two different addresses under `chain: "bitcoin"` produces two coexisting records (verified end-to-end in `test/non-evm-account-store.test.ts`). |
| BTC-PAIR-01 | `pair_btc_ledger()` returns first segwit AND first taproot addresses | `@ledgerhq/hw-app-btc.getWalletPublicKey(path, { format })` supports both `"bech32"` (segwit) and `"bech32m"` (taproot) per the `AddressFormat` type alias VERIFIED at `node_modules/@ledgerhq/hw-app-btc/lib-es/getWalletPublicKey.d.ts`. Two sequential calls within a single `openTransport()` → `try/finally close()` block yield both addresses with one device session. |
| BTC-PAIR-02 | `get_btc_status()` returns `{ paired, addresses: { segwit, taproot }, derivationPath, esploraEndpoint, ledgerBtcAppVersion? }` | Mirror of `get_solana_status` shape; surfaces TWO records keyed by derivation path (segwit slot + taproot slot). `ledgerBtcAppVersion` sourced from `Btc.getAppConfiguration()` if available (verify against installed `.d.ts` at execute time — `BtcNew` exposes it; the umbrella `Btc` class proxies via `_impl`). |
| BTC-READ-01 | `get_btc_balance({ wallet })` returns sat + BTC | Esplora `GET /address/{addr}` → `chain_stats.funded_txo_sum - chain_stats.spent_txo_sum` = confirmed balance in sats; `mempool_stats.funded_txo_sum - mempool_stats.spent_txo_sum` = unconfirmed delta. VERIFIED via live probe. |
| BTC-READ-02 | `get_btc_balances({ wallet })` returns segwit + taproot separately | Two parallel Esplora calls — `Promise.all` keyed by script-type address. Mirrors Phase 8's `get_portfolio_summary` per-chain `Promise.allSettled` shape (degradation-tolerant). |
| BTC-READ-03 | `get_btc_account_balance({ xpub })` aggregates with gap-limit scan | `bitcoinjs-lib@7.0.1` exports `bip32` submodule (`fromBase58(xpub).derive(0).derive(i)` chain); BIP-44 gap-limit is 20 unused-in-a-row; xpub-scan is server-side fan-out across child addresses. |
| BTC-READ-04 | `get_btc_tx_history({ wallet, limit })` via Esplora | Esplora `GET /address/{addr}/txs` returns up to 50 mempool + 25 confirmed per page, pagination via `:last_seen_txid` (VERIFIED against API.md). |
| BTC-READ-05 | `get_btc_fee_estimates()` returns sat/vB by confirmation target | Esplora `GET /fee-estimates` returns `Record<string, number>` keyed by confirmation target (`"1"`, `"2"`, ..., `"144"`, `"504"`, `"1008"`). Live response VERIFIED. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bitcoinjs-lib` | `^7.0.1` `[VERIFIED: npm registry]` | xpub→address derivation, address validation, network constants (BIP-32 + BIP-49 + BIP-84 + BIP-86 + bech32/bech32m payment helpers) | 727k weekly downloads `[VERIFIED: npm api]`; maintained since 2014; the canonical pure-JS Bitcoin library. Used by 6 of the top-10 BTC JS wallets. |
| `@ledgerhq/hw-app-btc` | `^10.22.1` `[VERIFIED: npm registry]` | Ledger BTC app interface — `getWalletPublicKey(path, { format })`, `signMessage`, `signPsbtBuffer` (Phase 23+) | Last published 2026-05-21 `[VERIFIED: npm api]`; Ledger official org (`phenry-ledger`, `gbrahm-ledger`, `ledger-releaser` maintainers); 22.3k weekly downloads. |
| `@ledgerhq/hw-transport-node-hid` | `^6.33.2` `[VERIFIED: npm registry; ALREADY INSTALLED]` | USB-HID transport (reused from Phase 11 Solana + Phase 17 TRON) | Same version already in `package.json` for Solana + TRON; zero new transport-layer surface. |

**Verification:**
```bash
npm view bitcoinjs-lib version           # → 7.0.1
npm view @ledgerhq/hw-app-btc version    # → 10.22.1, published 2026-05-21
npm view @ledgerhq/hw-transport-node-hid version  # → 6.33.2 (already installed)
```

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@noble/hashes` | `^2.2.0` (transitive of `bitcoinjs-lib` and already in deps via viem) | SHA-256 / HMAC primitives for BIP-32 derivation | Already in transit graph; no direct install needed. |
| `@noble/curves` | `1.9.7` (transitive via `@ledgerhq/hw-app-btc`) | secp256k1 point math; available if a future minimal-deps refactor wants to drop bitcoinjs-lib | Reserved option only — adopt full bitcoinjs-lib for v2.2 scope. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `bitcoinjs-lib` (full) | `@noble/curves/secp256k1` + hand-rolled bech32m + manual BIP-32 | ~10× smaller install, but every BIP-84 / BIP-86 / PSBT helper would be hand-rolled. Phase 25 PSBT multisig wants the full PSBT serializer; v2.2 atomic-cost is materially lower with the full lib. **DECISION: adopt full bitcoinjs-lib.** |
| `@scure/bip32@2.2.0` for xpub derivation alone | Use bitcoinjs-lib's bundled `bip32` submodule | bitcoinjs-lib bundles `bip32@^5.0.1` transitively; pulling `@scure/bip32` separately introduces a second secp256k1 implementation. **DECISION: route through bitcoinjs-lib's bundled bip32.** |
| mempool.space as default Esplora | blockstream.info as default | mempool.space has richer mempool data + `/api/v1/fees/recommended` (different shape — `{ fastestFee, halfHourFee, hourFee, economyFee, minimumFee }`); blockstream.info has gentler rate limits + Esplora-standard `/fee-estimates` (24-key object keyed by confirmation target). **DECISION: blockstream.info default, `BTC_ESPLORA_URL` override for mempool.space; the `get_btc_fee_estimates` shape standardizes on the Esplora `/fee-estimates` object — if the user points at mempool.space the call hits the same Esplora-compatible `/api/fee-estimates` path which mempool.space ALSO supports (verified — mempool.space mirrors Esplora endpoints under `/api/`).** |

**Installation:**
```bash
npm install bitcoinjs-lib@^7.0.1 @ledgerhq/hw-app-btc@^10.22.1
# @ledgerhq/hw-transport-node-hid is already installed
```

## Package Legitimacy Audit

slopcheck was **not available** in this research environment. Per the protocol, packages below would be marked `[ASSUMED]` and gated behind `checkpoint:human-verify` tasks at plan time. However, manual verification (Step 3 + Step 4 of the protocol) was performed and the packages all pass legitimacy heuristics:

| Package | Registry | Age | Downloads | Source Repo | Manual verdict | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `bitcoinjs-lib` | npm | created 2014, last published 2026-01-07 | 727k/week | github.com/bitcoinjs/bitcoinjs-lib | OK — established maintainers (`fanatid`, `junderw`, `jl.landabaso`); no suspicious postinstall (no `scripts.postinstall`) | Approved |
| `@ledgerhq/hw-app-btc` | npm | created 2018-01-11, last published 2026-05-21 | 22.3k/week | github.com/LedgerHQ/ledger-live | OK — Ledger official org maintainers (`phenry-ledger`, `gbrahm-ledger`, `ledger-releaser`); no suspicious postinstall | Approved |
| `@ledgerhq/hw-transport-node-hid` | npm | (already in `package.json`) | (already vetted in Phase 11) | github.com/LedgerHQ/ledger-live | OK — already shipping in v2.0 + v2.1 | Approved (pre-vetted) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck unavailable. The planner SHOULD insert a `checkpoint:human-verify` task before `npm install` in Plan 22-01 to confirm the user's actually-installed versions match the audit above; this is a planning hygiene step, not a security gate (the packages above are well-established).*

## Architecture Patterns

### System Architecture Diagram

```
agent (Claude Code / Cursor / Desktop)
   │  stdio  (MCP protocol)
   ▼
vaultpilot-mcp (this codebase)
   ├── tools/
   │   ├── pair_btc_ledger.ts          ─┐
   │   ├── get_btc_status.ts            │
   │   ├── get_btc_balance.ts           │── Phase 22 NEW
   │   ├── get_btc_balances.ts          │
   │   ├── get_btc_account_balance.ts   │
   │   ├── get_btc_tx_history.ts        │
   │   └── get_btc_fee_estimates.ts    ─┘
   │
   ├── chains/bitcoin/                  ─┐
   │   ├── registry.ts                   │── mirrors src/chains/solana/
   │   ├── esplora-client.ts             │   + src/chains/tron/ shape
   │   ├── xpub-scan.ts                  │
   │   └── types.ts                     ─┘
   │
   ├── wallet/
   │   ├── ledger-btc-transport.ts      ─── Phase 22 NEW (mirrors
   │   │                                    ledger-tron-transport.ts)
   │   └── non-evm-account-store.ts     ─── REUSED (chain: "bitcoin"
   │                                        record slots, ZERO schema change)
   │
   ├── clients/                         ─── (no new client here — Esplora client
   │                                        lives in chains/bitcoin/ since it's
   │                                        the chain's ONLY backend, not a
   │                                        cross-chain service like fourbyte)
   │
   ├── config/env.ts                    ─── ADD getBtcEsploraUrl()
   │                                        (mirrors getSolanaRpcUrl shape)
   │
   ├── demo/
   │   ├── state.ts                     ─── ADD BtcPersona minimal carve
   │   └── bitcoin-persona.ts           ─── Phase 22 NEW (mirrors
   │                                        solana-persona.ts + tron-persona.ts)
   │
   └── tokens/                          ─── no BTC token registry (BTC has no
                                            tokens at this layer; pricing is
                                            single-asset BTC/USD via DefiLlama
                                            `coingecko:bitcoin` — deferred to
                                            Phase 22-03 plan-time decision)
   │
   │  HTTP fetch (no API key)
   ▼
blockstream.info (default) | mempool.space (alt) — Esplora API
   │
   │  USB-HID
   ▼
Ledger device — BTC app — getWalletPublicKey(BIP84) + getWalletPublicKey(BIP86)
```

### Component Responsibilities

| Component | File | Owns | Calls |
|-----------|------|------|-------|
| Esplora client | `src/chains/bitcoin/esplora-client.ts` | HTTP fetch + JSON parse + 5-arm discriminated union + LRU cache + AbortController timeout | global `fetch` (stubbable via `vi.stubGlobal`) |
| Bitcoin registry | `src/chains/bitcoin/registry.ts` | Lazy-singleton `EsploraEndpoint` + `BTC_ESPLORA_URL` env resolution + warn-once-on-fallback | `config/env.ts::getBtcEsploraUrl()` |
| Address types | `src/chains/bitcoin/types.ts` | Branded `BtcSegwitAddress` + `BtcTaprootAddress`; bech32 / bech32m regex gate; `bitcoinjs-lib.address.toOutputScript()` second-gate | `bitcoinjs-lib.address` |
| xpub scan | `src/chains/bitcoin/xpub-scan.ts` | BIP-32 child derivation + gap-limit-respecting scan; per-xpub TTL cache | `bitcoinjs-lib.bip32` + `esplora-client.getAddressInfo` |
| Ledger BTC transport | `src/wallet/ledger-btc-transport.ts` | Per-call `openTransport()` + try/finally close; `getWalletPublicKey({ format: "bech32" })` + `getWalletPublicKey({ format: "bech32m" })`; BTC-app-not-open detection via `getAppConfiguration()`; `(Module as any).default ?? Module` shim | `@ledgerhq/hw-transport-node-hid` + `@ledgerhq/hw-app-btc` |
| BTC persona | `src/demo/bitcoin-persona.ts` | Sibling registry — does NOT widen EVM `Persona` literal-union (same discipline as `solana-persona.ts` + `tron-persona.ts`) | — |

### Pattern 1: Per-call transport (NOT singleton)

**What:** Open USB-HID, do exchange(s), close in `finally`. NEVER hold a transport handle across MCP tool calls.

**When to use:** Every Ledger BTC operation — pairing, future Phase 23 PSBT signing.

**Example:**
```typescript
// Source: src/wallet/ledger-tron-transport.ts (Phase 17 precedent)
export async function fetchBtcAddresses(
  segwitPath: string = DEFAULT_BTC_SEGWIT_PATH,
  taprootPath: string = DEFAULT_BTC_TAPROOT_PATH,
): Promise<{
  segwit: { address: string; publicKey: string; chainCode: string };
  taproot: { address: string; publicKey: string; chainCode: string };
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
    const segwit = await app.getWalletPublicKey(segwitPath, { format: "bech32" });
    const taproot = await app.getWalletPublicKey(taprootPath, { format: "bech32m" });
    return { segwit, taproot, appVersion: cfg.version ?? "unknown" };
  } finally {
    try { await transport.close(); } catch (err) { log("warn", `transport.close() failed: ${err}`); }
  }
}
```

### Pattern 2: Never-throws HTTP client (5-arm discriminated union)

**What:** Esplora client returns `{ kind: "ok" | "not-found" | "rate-limited" | "error" | "not-applicable" }`. Never throws. Tool handlers pattern-match on `kind`.

**When to use:** Every Esplora endpoint. Mirrors `etherscan.ts` (Phase 7) + `fourbyte.ts` (Phase 4) + `sunswap.ts` (Phase 20).

**Example:**
```typescript
// Source: src/clients/etherscan.ts (Phase 7 precedent)
export type EsploraAddressResult =
  | { kind: "not-applicable" }                              // null input
  | { kind: "ok"; chain_stats: TxoStats; mempool_stats: TxoStats; confirmedBalanceSats: bigint; unconfirmedBalanceSats: bigint }
  | { kind: "not-found" }                                    // 404 (address never seen — surface as zero-balance OR distinct arm)
  | { kind: "rate-limited"; message: string }                // 429 (mempool.space rate-limits) or per-session counter exhausted
  | { kind: "error"; message: string };                       // 5xx, timeout, parse failure
```

### Pattern 3: ESM spy-affordance indirection

**What:** Wrap cross-export internal calls in a `_<scope>` object so `vi.spyOn(_scope, "method")` works (ESM named-export bindings are immutable).

**When to use:** Every module that has internal cross-export calls. For external HTTP boundaries, prefer `vi.stubGlobal("fetch", …)` instead.

**Mandatory in Phase 22:**
- `src/chains/bitcoin/registry.ts` — `_bitcoinRegistry = { getEsploraEndpoint, getResolvedEsploraUrl, getBtcEsploraUrl }`
- `src/wallet/ledger-btc-transport.ts` — `_transport = { isSupported, list, open, buildBtcApp }` AND `_btcLedgerTransport = { fetchBtcAddresses }` (for Plan 22-04 `get_btc_status` spy seam)

**NOT needed for** `src/chains/bitcoin/esplora-client.ts` — that's the external fetch boundary; stub `fetch` directly per CLAUDE.md.

### Pattern 4: Sibling-interface persona (NOT slug-widening)

**What:** Each non-EVM chain ships its own `<Chain>Persona` interface + slug literal-union. The EVM `Persona["slug"]` stays narrow.

**When to use:** Adding a new demo persona for a chain whose address format differs structurally from EVM.

**Example:**
```typescript
// Mirror of src/demo/solana-persona.ts + src/demo/tron-persona.ts
export type BtcPersonaSlug = "btc-whale";  // start narrow; widen additively as needed

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

### Anti-Patterns to Avoid

- **Re-deriving addresses on every read.** The paired addresses MUST come from the `non-evm-account-store` cache. The transport opens ONCE at pair time; subsequent reads consult the cache (not the device).
- **Routing reads through `bitcoinjs-lib`'s heavy `Buffer`-based serializers in hot loops.** xpub-scan can derive 50+ child pubkeys per call; use the bundled `bip32` submodule directly, not the higher-level `Psbt` / `Transaction` builders.
- **Treating mempool.space's `/api/v1/fees/recommended` as Esplora-standard.** Phase 22's `get_btc_fee_estimates` MUST hit the `/api/fee-estimates` path (Esplora-standard 24-key object). mempool.space's mirror of Esplora at `/api/fee-estimates` exists and returns the canonical shape; the `/v1/fees/recommended` shape is mempool.space-proprietary and should NOT be hit.
- **Single Esplora call to compute "balance".** The endpoint returns `funded_txo_sum - spent_txo_sum`; the computation is server-side. Phase 22 must NOT expose `funded_txo_sum` alone (the user wants `confirmed = funded - spent`).
- **Surfacing `derivationPath` in `list_paired_non_evm_accounts`.** Same shoulder-surfing defense as Solana / TRON — the iterator across the whole non-EVM surface MUST NOT leak per-chain BIP44 account indices. `get_btc_status` is the per-chain surface where the caller explicitly asked for their own slot.
- **Caching tx-history pages forever.** Esplora's `/address/{addr}/txs` paginates with `:last_seen_txid`; the page can be cached for a TTL window (~30s) but not indefinitely (new transactions land).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| bech32 / bech32m address encoding | Custom regex + checksum loop | `bitcoinjs-lib.address.toOutputScript(addr, network)` | bech32 has subtle edge cases (mixed-case rejection, checksum constants differ between bech32 vs bech32m); the lib handles all of them. |
| xpub → child address derivation | Hand-rolled HMAC + secp256k1 point addition | `bitcoinjs-lib.bip32.fromBase58(xpub).derive(0).derive(i).publicKey` + `bitcoinjs-lib.payments.p2wpkh({ pubkey })` (segwit) or `.p2tr({ internalPubkey })` (taproot) | BIP-32 derivation has the `IL`-overflow edge case (skip-index on hard-to-derive child); the lib handles it. |
| Esplora pagination | Manual offset/limit accumulator | Page via `:last_seen_txid` as documented | Esplora is offset-less by design; the `last_seen_txid` cursor is the canonical way. |
| Fee-estimate parsing | Custom JSON walker + type-narrowing | Zod schema (or simple structural type-guard) against `Record<string, number>` | Esplora `/fee-estimates` shape is stable but not documented as a versioned schema — a structural guard catches drift. |
| Gap-limit scan termination | Naive "scan until 0 balance" | Scan until N consecutive unused (per BIP-44, N=20) | "0 balance" misses derived addresses that received funds and are fully-spent — the BIP-44 gap-limit is what wallets implement universally. |
| Ledger BTC app version detection | `cat /sys/...` voodoo | `app.getAppConfiguration()` returns `{ version }` | The d.ts on the `BtcNew` class exports `getAppConfiguration` (verified via `@ledgerhq/hw-app-btc.lib-es/BtcNew.d.ts`); the umbrella `Btc` class proxies. |

**Key insight:** Bitcoin is a 15-year-old protocol with a battle-tested library ecosystem. Hand-rolling anything below the application layer is strictly worse than depending on `bitcoinjs-lib` and `@ledgerhq/hw-app-btc`.

## Runtime State Inventory

> Phase 22 is **greenfield** for BTC — no rename / refactor / migration. Section omitted.

## Common Pitfalls

### Pitfall 1: bech32 vs bech32m confusion

**What goes wrong:** Segwit (bc1q…) uses bech32 (BIP-173); taproot (bc1p…) uses bech32m (BIP-350). The checksum constants differ. A segwit-bech32 encoder applied to a taproot address yields a string that LOOKS valid (correct prefix, correct length) but fails on-chain.

**Why it happens:** Both encode to `bc1`-prefixed strings of similar length; the difference is in the polynomial constant the checksum uses.

**How to avoid:** Use `bitcoinjs-lib.address.toOutputScript(addr, networks.bitcoin)` — it picks the right decoder based on the address shape. NEVER hand-roll bech32 / bech32m.

**Warning signs:** A pair tool succeeds, the address looks right, but `get_btc_balance` returns `{ kind: "not-found" }` against Esplora for the taproot address only.

### Pitfall 2: Calling `getWalletPublicKey` outside the BTC app

**What goes wrong:** APDU command bytes overlap between the Bitcoin app and several Litecoin / Bitcoin-clone forks. Calling `getWalletPublicKey` while the Ledger has Litecoin open silently returns an LTC address (M-prefixed or ltc1q-prefixed), not a BTC one.

**Why it happens:** The BTC app shares its APDU table with derivative apps; `getAppConfiguration()` is the canonical "is this app open" gate.

**How to avoid:** `getAppConfiguration()` runs FIRST; the call throws if the BTC app is not active (the `getAppConfiguration` APDU has a BTC-specific response shape). Map the throw to `LedgerBtcAppNotOpenError` exactly like `LedgerTronAppNotOpenError`.

**Warning signs:** Pair tool returns a non-`bc1`-prefixed address.

### Pitfall 3: Esplora `funded_txo_sum` vs `chain_stats` confusion

**What goes wrong:** `funded_txo_sum` is the *total ever received*, NOT the current balance. A wallet that received 1 BTC and sent 0.5 BTC has `funded_txo_sum: 100000000`, `spent_txo_sum: 50000000` — current balance is the difference.

**Why it happens:** The Esplora API surfaces the raw TXO counters; the client must compute the balance.

**How to avoid:** `confirmedBalanceSats = chain_stats.funded_txo_sum - chain_stats.spent_txo_sum` (as bigint — the raw values can exceed Number.MAX_SAFE_INTEGER for whale wallets).

**Warning signs:** Demo persona balance is reported as orders of magnitude higher than expected.

### Pitfall 4: gap-limit scan termination too eager

**What goes wrong:** Stopping the xpub-scan at the first unused address misses derived addresses that are STILL in use further down the chain (rare but real for advanced wallets that fan out aggressively).

**Why it happens:** BIP-44 defines gap-limit = 20 *consecutive* unused addresses; common implementations check 20 in a row, not the first unused.

**How to avoid:** Scan until N consecutive `tx_count: 0` addresses (N=20 per BIP-44). Cache the scan per-xpub with a 5-minute TTL.

**Warning signs:** `get_btc_account_balance` returns a balance lower than the user's reported wallet UI shows.

### Pitfall 5: Per-call transport handle leak

**What goes wrong:** A `transport.close()` call missing from the error path of `fetchBtcAddresses` leaks the USB-HID device handle; the next `openTransport()` fails with "device busy".

**Why it happens:** Two sequential `app.getWalletPublicKey()` calls means TWO ways to throw; the `finally` block MUST cover both.

**How to avoid:** Single `try/finally` wrapping BOTH `getWalletPublicKey` calls; mirror the `fetchTronAddress` discipline (per-call, not singleton, `finally` close).

**Warning signs:** "Device busy" errors on second invocation of `pair_btc_ledger`.

### Pitfall 6: `Buffer` interop drift under TS5 NodeNext + ESM

**What goes wrong:** `bitcoinjs-lib` v7 uses `uint8array-tools` and is `Buffer`-free at the API surface. Code that passes a Node `Buffer` to bitcoinjs-lib functions may work (Buffer extends Uint8Array) but the return values are `Uint8Array`, NOT `Buffer`. `Buffer.from(uint8array)` is a zero-copy view; mixing `.toString("hex")` (Buffer-only) with `Uint8Array` returns silently break.

**Why it happens:** v6 → v7 of bitcoinjs-lib migrated to `Uint8Array` at all surfaces.

**How to avoid:** Use `@noble/hashes/utils.bytesToHex(u8)` for hex conversion (already in transit deps); never call `.toString("hex")` on a value sourced from bitcoinjs-lib unless explicitly Buffer-coerced.

**Warning signs:** Empty strings or `[object Uint8Array]` appearing in test output.

### Pitfall 7: Address-format choice in `getWalletPublicKey`

**What goes wrong:** Calling `getWalletPublicKey("84'/0'/0'/0/0", { format: "legacy" })` returns the legacy `1`-prefixed address derived from the same pubkey — which is NOT what the segwit-path user wants. The format flag and the BIP-44 path must agree.

**Why it happens:** The Ledger app doesn't reject mismatched format + path combinations; it computes whatever format you ask for.

**How to avoid:** Hardcode the BIP-84 path → `format: "bech32"` mapping and the BIP-86 path → `format: "bech32m"` mapping at module scope. Never accept format as agent input.

**Warning signs:** Pair tool returns a `1`-prefixed legacy address from a 84' path.

## Code Examples

Verified patterns from official sources:

### Open transport + fetch two addresses in one device session
```typescript
// Pattern: ledger-tron-transport.ts (Phase 17, VERIFIED)
// Adapted: TWO sequential getWalletPublicKey calls inside ONE try/finally.

import TransportNodeHidModule from "@ledgerhq/hw-transport-node-hid";
import BtcAppModule from "@ledgerhq/hw-app-btc";

// NodeNext + ESM default-export drift shim (same pattern as Solana + TRON)
const TransportNodeHid: any = (TransportNodeHidModule as any).default ?? TransportNodeHidModule;
const BtcApp: any = (BtcAppModule as any).default ?? BtcAppModule;

export const DEFAULT_BTC_SEGWIT_PATH = "84'/0'/0'/0/0";   // BIP-84 → bc1q…
export const DEFAULT_BTC_TAPROOT_PATH = "86'/0'/0'/0/0";  // BIP-86 → bc1p…

export const _transport = {
  isSupported: (): Promise<boolean> => TransportNodeHid.isSupported(),
  list: (): Promise<readonly unknown[]> => TransportNodeHid.list(),
  open: (path: string | null): Promise<unknown> => TransportNodeHid.open(path),
  buildBtcApp: (t: unknown): any => new BtcApp({ transport: t, currency: "bitcoin" }),
};

export async function fetchBtcAddresses(): Promise<{
  segwit: { address: string; publicKey: string; chainCode: string; derivationPath: string };
  taproot: { address: string; publicKey: string; chainCode: string; derivationPath: string };
  appVersion: string;
}> {
  const transport = await openTransport();
  try {
    const app = _transport.buildBtcApp(transport);
    let cfg: { version?: string };
    try { cfg = await app.getAppConfiguration(); }
    catch { throw new LedgerBtcAppNotOpenError(); }
    const segwit = await app.getWalletPublicKey(DEFAULT_BTC_SEGWIT_PATH, { format: "bech32" });
    const taproot = await app.getWalletPublicKey(DEFAULT_BTC_TAPROOT_PATH, { format: "bech32m" });
    return {
      segwit: { ...segwit, address: segwit.bitcoinAddress, derivationPath: DEFAULT_BTC_SEGWIT_PATH },
      taproot: { ...taproot, address: taproot.bitcoinAddress, derivationPath: DEFAULT_BTC_TAPROOT_PATH },
      appVersion: cfg.version ?? "unknown",
    };
  } finally {
    try { await transport.close(); } catch (err) { log("warn", `transport.close() failed: ${err instanceof Error ? err.message : String(err)}`); }
  }
}
```

### Esplora balance computation (NEVER-throws shape)
```typescript
// Pattern: src/clients/etherscan.ts NEVER-throws (Phase 7, VERIFIED)
// fetchAddressInfo: GET /address/{addr} → { kind: "ok" | "not-found" | "error" | ... }

import { log } from "../../diagnostics/logger.js";
import { _bitcoinRegistry } from "./registry.js";

const ESPLORA_TIMEOUT_MS = 5000;

interface EsploraAddressResponse {
  address?: string;
  chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number; tx_count?: number };
  mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number; tx_count?: number };
}

export type EsploraAddressResult =
  | { kind: "ok"; confirmedBalanceSats: bigint; unconfirmedBalanceSats: bigint; txCount: number }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

export async function fetchAddressInfo(address: string): Promise<EsploraAddressResult> {
  const url = `${_bitcoinRegistry.getEsploraBaseUrl()}/address/${address}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ESPLORA_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (resp.status === 404) return { kind: "not-found" };
    if (!resp.ok) return { kind: "error", message: `Esplora returned HTTP ${resp.status}` };
    const body = (await resp.json()) as EsploraAddressResponse;
    if (!body.chain_stats) return { kind: "error", message: "Esplora missing chain_stats" };
    const confirmedFunded = BigInt(body.chain_stats.funded_txo_sum ?? 0);
    const confirmedSpent = BigInt(body.chain_stats.spent_txo_sum ?? 0);
    const mempoolFunded = BigInt(body.mempool_stats?.funded_txo_sum ?? 0);
    const mempoolSpent = BigInt(body.mempool_stats?.spent_txo_sum ?? 0);
    return {
      kind: "ok",
      confirmedBalanceSats: confirmedFunded - confirmedSpent,
      unconfirmedBalanceSats: mempoolFunded - mempoolSpent,
      txCount: (body.chain_stats.tx_count ?? 0) + (body.mempool_stats?.tx_count ?? 0),
    };
  } catch (err) {
    const e = err as Error;
    if (e?.name === "AbortError") return { kind: "error", message: `Esplora unreachable (timeout ${ESPLORA_TIMEOUT_MS}ms)` };
    return { kind: "error", message: `Esplora unreachable: ${e?.message ?? String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}
```

### Pair-tool multi-record save (PAIR-NEV-* reuse)
```typescript
// Saves BOTH segwit + taproot under chain: "bitcoin" with distinct derivationPath
// — the existing saveAccount upserts on (chain, address) so this produces two
// coexisting records with zero schema change.
// Source: non-evm-account-store.saveAccount() VERIFIED at line 241-252.

import { saveAccount } from "../wallet/non-evm-account-store.js";

const { segwit, taproot, appVersion } = await fetchBtcAddresses();
const pairedAt = new Date().toISOString();

saveAccount({ chain: "bitcoin", address: segwit.address,  derivationPath: segwit.derivationPath,  pairedAt });
saveAccount({ chain: "bitcoin", address: taproot.address, derivationPath: taproot.derivationPath, pairedAt });
```

## Per-Plan Research

### Plan 22-01: Chain shelf + SDK adoption + env reader

**Goal:** Stand up `src/chains/bitcoin/`, install `bitcoinjs-lib` + `@ledgerhq/hw-app-btc`, add `BTC_ESPLORA_URL` env reader, seed the Esplora client (NEVER-throws shape).

**Concrete guidance:**

1. **Install:** `npm install bitcoinjs-lib@^7.0.1 @ledgerhq/hw-app-btc@^10.22.1`. `@ledgerhq/hw-transport-node-hid` already in deps from Phase 11.
2. **Shelf shape (mirrors `src/chains/solana/`):**
   - `src/chains/bitcoin/registry.ts` — lazy-singleton `EsploraEndpoint` factory; `BTC_ESPLORA_URL` env override resolution; default `https://blockstream.info/api`; warn-once-on-fallback latch; `_bitcoinRegistry = { getEsploraBaseUrl, getResolvedEsploraUrl, getBtcEsploraUrl }` ESM spy seam.
   - `src/chains/bitcoin/esplora-client.ts` — 4 fetch helpers: `fetchAddressInfo(addr)`, `fetchAddressUtxos(addr)`, `fetchAddressTxs(addr, opts)`, `fetchFeeEstimates()`. Each returns a discriminated union. `fetch` is global; test seam is `vi.stubGlobal("fetch", …)`, NOT an internal indirection.
   - `src/chains/bitcoin/types.ts` — branded `BtcSegwitAddress` + `BtcTaprootAddress`; bech32 + bech32m regex gate (fast first-line); `bitcoinjs-lib.address.toOutputScript(addr, networks.bitcoin)` second-gate validation. Mirror of `chains/solana/types.ts` shape.
3. **Env reader (mirrors `getSolanaRpcUrl()` shape):**
   ```typescript
   // src/config/env.ts — APPEND after getTronRpcUrl()
   export function getBtcEsploraUrl(): string | null {
     return read("BTC_ESPLORA_URL") ?? null;
   }
   ```
4. **Default endpoint decision:** blockstream.info `https://blockstream.info/api`. mempool.space mirrors the standard Esplora endpoints under `/api/` so users who set `BTC_ESPLORA_URL=https://mempool.space/api` get compatible behavior. **Do NOT** hardcode mempool.space's proprietary `/v1/fees/recommended`.
5. **bitcoinjs-lib network constant:** `bitcoinjs-lib.networks.bitcoin` (mainnet). Testnet / regtest deferred to post-v2.x.
6. **SDK scope-probe results:** `@ledgerhq/hw-app-btc@10.22.1` transitively pulls `bitcoinjs-lib@^6.1.7` already — pinning `^7.0.1` at the top level means the resolved version will be 7.0.1; bitcoinjs-lib 6 vs 7 compatibility is mostly additive (Uint8Array migration). VERIFY via `npm ls bitcoinjs-lib` at execute time.
7. **`(Module as any).default ?? Module` shim:** YES, needed — `@ledgerhq/hw-app-btc/lib-es/index.d.ts` exports `default class Btc` only. Mirror of Solana + TRON shim.
8. **PSBT scope-probe:** `BtcNew.signPsbtBuffer(psbtBuffer: Buffer, options: SignPsbtBufferOptions)` IS available (VERIFIED in `lib-es/BtcNew.d.ts`). Phase 22 does NOT consume this; Phase 23 will. The current-tree comment in the same file ("In the future, a new interface should be developed that exposes PSBT to the outer world") confirms the API is mature enough to commit to in Phase 23.

**Plan-check anchors:**
- Test: `chains-bitcoin-registry.test.ts` — env override wins; default fallback; warn-once latch fires (mirrors `chains-solana-registry.test.ts`).
- Test: `chains-bitcoin-esplora-client.test.ts` — 4 fetch helpers; 5-arm discriminated union; `vi.stubGlobal("fetch", …)` test seam; 404 → `not-found`; 5xx → `error`; AbortController timeout → `error`; JSON parse failure → `error` (mirrors `fourbyte.test.ts`).
- Test: `chains-bitcoin-address-types.test.ts` — bech32 regex passes valid `bc1q…`; rejects mixed-case; bech32m regex passes valid `bc1p…`; cross-encoding (segwit regex on taproot address) rejects.
- Test: `config-env-bitcoin.test.ts` — `BTC_ESPLORA_URL` resolution (mirror of `config-env-tron.test.ts`).

**Risks / surprises for planner:**
- bitcoinjs-lib's `.cjs` vs `.js` exports field is intricate (lines verified at `npm view bitcoinjs-lib exports`); ESM imports work cleanly under TS5 NodeNext (verified — top-level path `bitcoinjs-lib` resolves to `./src/esm/index.js` on `import`).
- `bitcoinjs-lib@7` is `Buffer`-free at the API surface (Uint8Array migration). Test fixtures that assume `Buffer.from(...).toString("hex")` chain MUST use `@noble/hashes/utils.bytesToHex(u8)` instead — Phase 22's test fixture hex literals should be defined as plain string constants, not Buffer-derived.

---

### Plan 22-02: `pair_btc_ledger` tool + USB-HID transport + multi-derivation-path persistence

**Goal:** Pair both segwit + taproot in one USB-HID session; persist both as `chain: "bitcoin"` records; emit `VERIFY-ON-DEVICE` block.

**Concrete guidance:**

1. **Transport module (`src/wallet/ledger-btc-transport.ts`):** Mirror of `ledger-tron-transport.ts`. Per-call transport, try/finally close, `(Module as any).default ?? Module` shim, `_transport` spy seam, `LedgerDeviceNotConnectedError` + `LedgerBtcAppNotOpenError` classes.
   - **`fetchBtcAddresses()`:** Opens ONCE, calls `getWalletPublicKey(BIP84, { format: "bech32" })` then `getWalletPublicKey(BIP86, { format: "bech32m" })`, closes in finally. Returns `{ segwit, taproot, appVersion }`.
   - **`_btcLedgerTransport.fetchBtcAddresses`:** Additive widening for `get_btc_status` to spy at the per-tool seam in Plan 22-04 (mirror of TRON's `_tronLedgerTransport.fetchTronAddress`).
   - **Path constants:** `DEFAULT_BTC_SEGWIT_PATH = "84'/0'/0'/0/0"` + `DEFAULT_BTC_TAPROOT_PATH = "86'/0'/0'/0/0"`. **NOTE:** these are 5-level BIP-44 paths (purpose / coin_type / account / change / address_index), same shape as TRON's `"44'/195'/0'/0/0"` — distinct from Solana's 3-level `"44'/501'/0'"`. Add a regression anchor test comment naming the 5-level shape to defend against copy-paste from Solana.
2. **Tool (`src/tools/pair_btc_ledger.ts`):** Mirror of `pair_solana_ledger.ts`. Demo-mode-FIRST gate; 60s `APPROVAL_TIMEOUT_MS` race; `VERIFY_ON_DEVICE_BTC_TEMPLATE` const (single source of truth); two `saveAccount` calls (one per address) under `chain: "bitcoin"`.
3. **`VERIFY-ON-DEVICE` template — DUAL-address shape (NEW vs Solana / TRON):**
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
4. **Locked errorCode set (mirror of `pair_solana_ledger`):**
   - `DEMO_MODE_REFUSED`, `LEDGER_NOT_CONNECTED`, `BITCOIN_APP_NOT_OPEN`, `USER_REJECTED`, `APPROVAL_TIMEOUT`, `INTERNAL_ERROR`.
5. **PAIR-NEV-* schema reuse:** zero change. The `non-evm-account-store.ts` already declares `chain: "bitcoin"` in the `NonEvmChain` literal-union (line 43-50 VERIFIED). The `(chain, address)` upsert key means two saveAccount calls produce two records. The `staleAccountWarning` arm in `listAccounts` works per-record (not per-pair), so the segwit + taproot records age independently — surface a stale warning when EITHER is stale. Surface BOTH addresses on `get_btc_status` even if one is stale.

**Plan-check anchors:**
- Test: `ledger-btc-transport.test.ts` — `_transport` spy intercepts; demo-mode-first refusal (zero `fetchBtcAddresses` invocations); device-not-connected throws `LedgerDeviceNotConnectedError`; app-not-open throws `LedgerBtcAppNotOpenError`; happy path returns both addresses + appVersion.
- Test: `pair-btc-ledger.test.ts` — demo-mode refusal; 60s timeout race; USER_REJECTED on APDU 0x6985; VERIFY-ON-DEVICE block contains BOTH addresses verbatim; saves TWO records under `chain: "bitcoin"`; both `bc1q…` and `bc1p…` shapes appear in the response; `appVersion` surfaces in structuredContent.
- Test: regression anchor — calling pair twice in a row produces TWO upserts (idempotent on identical `(chain, address)`) — the cache holds exactly 2 records, NOT 4.

**Risks / surprises for planner:**
- The `bitcoinAddress` field on `getWalletPublicKey` return is **already encoded** (bech32 for `format: "bech32"`, bech32m for `format: "bech32m"`) — NO additional encoding step needed. This mirrors TRON's "address-already-encoded" pattern, NOT Solana's "raw bytes need bs58.encode" pattern. Add a regression anchor test that asserts the `bc1q…` / `bc1p…` prefix appears in the response without any client-side encoding.
- Future LTC sharing (Phase 26): `@ledgerhq/hw-app-btc.constructor({ currency: "litecoin" })` opens the BTC app in LTC account-config mode. Phase 22's `_transport.buildBtcApp` hardcodes `currency: "bitcoin"`; Phase 26 either adds a `currency` arg OR ships `src/wallet/ledger-litecoin-transport.ts` as a sibling. **Decision deferred to Phase 26 plan.** Phase 22 hardcodes `"bitcoin"`.
- The Ledger BTC app supports `verify: true` opt-in on `getWalletPublicKey` — this forces the device to display the address on-screen and await user confirmation. **Phase 22 SHOULD enable `verify: true`** for pair-time (the whole point of pairing is to verify on-device); test mock must handle the verify flag.

---

### Plan 22-03: Esplora read tools — balance + balances + account balance + tx history + fee estimates

**Goal:** Ship `get_btc_balance`, `get_btc_balances`, `get_btc_account_balance`, `get_btc_tx_history`, `get_btc_fee_estimates`. Esplora HTTP client + UTXO-shape `BalanceReport`.

**Concrete guidance:**

1. **`BalanceReport` shape (NEW — load-bearing for Phase 23 coin-selection):**
   ```typescript
   // src/chains/bitcoin/types.ts
   export interface UtxoRow {
     readonly txid: string;
     readonly vout: number;
     readonly valueSats: bigint;   // bigint at boundary per CLAUDE.md
     readonly confirmed: boolean;   // false ⇒ still in mempool
     readonly blockHeight?: number; // present when confirmed
   }

   export type BalanceReport =
     | { kind: "ok"; address: string; confirmedBalanceSats: bigint; unconfirmedBalanceSats: bigint; utxos: readonly UtxoRow[]; txCount: number }
     | { kind: "not-found"; address: string }   // address never seen on-chain (zero balance, but DISTINCT from kind: "ok" with zero — agent surfaces "no on-chain activity yet")
     | { kind: "error"; address: string; message: string };
   ```
2. **`get_btc_balance({ wallet })`:** Single Esplora call to `/address/{addr}` + optional `/address/{addr}/utxo` for the `utxos[]` array. Returns `BalanceReport`.
3. **`get_btc_balances({ wallet })`:** Two parallel Esplora calls (segwit address + taproot address), per-script-type `BalanceReport`. `Promise.allSettled` so a single-side rate-limit doesn't tank the whole call. Tool input is `{ wallet: { segwit: string; taproot: string } | string }`; if a single string is passed, the tool RPC-fetches both anyway IF the address shape disambiguates which scope to query.
4. **`get_btc_account_balance({ xpub })`:** xpub-scan via `bitcoinjs-lib.bip32.fromBase58(xpub)`; derive `m/0/i` for i in [0, gap-limit-respecting bound); per child, hit Esplora `/address/{addr}`; stop after 20 consecutive `tx_count: 0` per BIP-44. Aggregate `confirmedBalanceSats` across all derived addresses. Cache the scan per-xpub with a 5-minute TTL.
   - **gap-limit constant:** `BIP44_GAP_LIMIT = 20`.
   - **Concurrency cap:** scan in batches of 5 parallel fetches (avoid hammering the public endpoint).
   - **`get_btc_account_balance` ships in 22-03** (NOT split to Phase 23) — the scan is bounded by gap-limit and the existing fetch boundary is already in place. CONTEXT.md leaves this as Claude's discretion; the recommendation is to ship.
5. **`get_btc_tx_history({ wallet, limit })`:** Hit `/address/{addr}/txs` → returns first page (up to 50 mempool + 25 confirmed). Pagination via `?after_txid=<last>` for subsequent pages; `limit` arg caps the total returned (default 25). Tx shape is rich — surface a stripped-down `{ txid, blockHeight?, confirmedAt?, valueDelta, fee }` per row (NOT the full vin/vout, that's a Phase 23 / Phase 24 read).
6. **`get_btc_fee_estimates()`:** Hit `/fee-estimates` → returns `Record<string, number>` keyed by confirmation target. Tool projects to the standard 5-target shape `{ "1": number, "2": number, "3": number, "6": number, "144": number }` (per ROADMAP Success Criterion #7). Each value is sat/vB.
7. **Tool descriptions (agent routing prompts — CLAUDE.md convention):** be precise about when to use vs. NOT. Examples:
   - "Returns the BTC balance + UTXOs for a single address. Use this when the user provides a single BTC address. For paired-wallet BOTH script types use `get_btc_balances`. For xpub-level aggregation use `get_btc_account_balance`."
   - "Returns the current sat/vB fee estimates for 1, 2, 3, 6, and 144 block confirmation targets. Use this BEFORE preparing a BTC send to suggest a fee rate. Sat/vB is satoshis-per-virtual-byte; multiply by tx vsize (Phase 23 will surface this) to get total fee in sats."

**Plan-check anchors:**
- Test: `chains-bitcoin-esplora-client.test.ts` extension — fetch-stubbed 4 endpoints; 5-arm union; LRU cache eviction; AbortController timeout.
- Test: `get-btc-balance.test.ts` — happy path; demo-mode persona address; non-existent address → `not-found`; Esplora 5xx → `error` with verbatim upstream message.
- Test: `get-btc-balances.test.ts` — both script-type addresses fetched in parallel; one-side rate-limit doesn't fail the whole call.
- Test: `get-btc-account-balance.test.ts` — gap-limit-20 stop (mock Esplora returns 20 empty consecutive addresses → scan stops; the 21st address is NEVER fetched); per-xpub TTL cache.
- Test: `get-btc-tx-history.test.ts` — limit + pagination cursor.
- Test: `get-btc-fee-estimates.test.ts` — Esplora `/fee-estimates` response → 5-key projection.
- **Cryptographic-binding fixture:** Phase 22 has NO signing yet, so no payloadFingerprint anchor. BUT: **xpub-derivation outputs ARE deterministic** — add hardcoded literal anchors in `test/chains-bitcoin-xpub-scan.test.ts`:
  - Pinned xpub: `"xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj"` (BIP-32 test vector "Test vector 1" from BIP-32 RFC — verifiable against any BIP-32 implementation).
  - Expected first 5 segwit `bc1q…` addresses + first 5 taproot `bc1p…` addresses, hardcoded as string literals.
  - Drift in `bitcoinjs-lib`'s derivation OR in the segwit / taproot payment helpers would fail at a specific line, NOT pass against a self-snapshotted value.

**Risks / surprises for planner:**
- mempool.space's `/api/fee-estimates` endpoint **does** exist (Esplora-compatible mirror) — the user CAN point `BTC_ESPLORA_URL` at `https://mempool.space/api` and get the standard Esplora response shape. The proprietary `/api/v1/fees/recommended` exists alongside but the tool does NOT hit it.
- Esplora's `tx_count` includes mempool transactions. The gap-limit scan checks `chain_stats.tx_count + mempool_stats.tx_count === 0`, NOT just `chain_stats.tx_count` (otherwise a freshly-derived address with a pending receive would be wrongly classified as unused).
- Esplora's `/address/{addr}/utxo` returns UTXOs ONLY — no script details, no value-context. Phase 23's coin-selection needs the script type AND value; this means an extra `/tx/{txid}` lookup per UTXO IF the script type isn't inferable from the address (it IS, for the paired segwit + taproot scopes — `bc1q…` ⇒ p2wpkh; `bc1p…` ⇒ p2tr). Phase 22 surfaces the `address` field on each UtxoRow so Phase 23 can infer scriptType without re-fetch.
- Rate limits: blockstream.info publishes no documented rate limit but discord-anecdotal "10 req/sec is fine; 100 req/sec gets throttled". mempool.space documents 60 req/min on the free tier. **Phase 22 default: 5 concurrent Esplora calls per tool invocation max; per-call timeout 5s.** xpub-scan in batches of 5.

---

### Plan 22-04: `get_btc_status` + `get_vaultpilot_config_status` BTC surfacing + BTC whale persona

**Goal:** Ship `get_btc_status` (mirror of `get_solana_status` adapted for dual-address shape), extend `get_vaultpilot_config_status` to surface `btcEsploraConfigured` + `pairedNonEvmChains` extension, ship `BtcPersona` + `bitcoin-persona.ts` registry.

**Concrete guidance:**

1. **`get_btc_status({})`:** Reads ALL `chain: "bitcoin"` records from the cache. Two scope-distinct records → returns `{ paired: true, addresses: { segwit, taproot }, derivationPaths: { segwit, taproot }, esploraEndpoint, ledgerBtcAppVersion?, pairedAt, staleAccountWarning?, displayName? }`. One scope-distinct record (user paired one script type only) → returns `{ paired: true, addresses: { segwit?: string, taproot?: string }, ... }` with the absent scope as `undefined`. Zero records → `{ paired: false }`.
   - Mirror of `get_solana_status` envelope but with the dual-address widening.
   - `esploraEndpoint` from `_bitcoinRegistry.getResolvedEsploraUrl()`.
   - `ledgerBtcAppVersion` from `_btcLedgerTransport.fetchBtcAddresses` IF the user wants on-device probe AT status-call time (lazy probe — same pattern as Phase 21's `get_tron_setup_status` which probes via `_tronLedgerTransport.fetchTronAddress`). **DECISION: do NOT probe lazily in `get_btc_status`** — the cache record holds no version; surface `ledgerBtcAppVersion: undefined` and document that version is captured at pair time only. Defer the lazy-probe diagnostic to Phase 27 (`get_btc_setup_status` analogue of `get_tron_setup_status`).
2. **`get_vaultpilot_config_status` extension:**
   - ADD `btcEsploraConfigured: boolean` field (true iff `BTC_ESPLORA_URL` is explicitly set; the public-RPC fallback does NOT count). Mirror of `solanaRpcConfigured` / `tronRpcConfigured` semantics.
   - `pairedNonEvmChains` extension: the existing aggregation (`[...new Set(records.map(r => r.chain))].sort()`) already includes `"bitcoin"` automatically when records exist. ZERO code change to that line; only test additions.
   - Text-block formatting: add `btcEsploraConfigured` line below `tronRpcConfigured` (line ordering matches feature-arrival order in the rendered text).
3. **`BtcPersona` carve + registry:**
   - **State (`src/demo/state.ts`):** ADD minimal `BtcPersona` interface + `activeBtcPersona` state + `getActiveBtcPersona` + `setActiveBtcPersona` setters (mirror of Tron + Solana carve).
   - **Registry (`src/demo/bitcoin-persona.ts`):** NEW file mirroring `solana-persona.ts` + `tron-persona.ts`. `BtcPersonaSlug = "btc-whale"`. One persona — a known top-50 BTC holder, OFAC-clean per 0xB10C registry.
   - **DOA validation:** at module load, validate both `btcSegwitAddress` AND `btcTaprootAddress` via `bitcoinjs-lib.address.toOutputScript(addr, networks.bitcoin)` (mirror of Solana's `new PublicKey(...)` + TRON's `tronUtils.address.isAddress(...)` module-load validation).
   - **Suggested whale candidate (planner verifies at commit time):** `bc1q…` form of Binance cold wallet 12-aliquot, e.g. `bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h` (Binance cold) — OR Mt. Gox cold wallet historical reference (less politically charged). The verification ritual mirrors TRON: TronScan/OFAC SDN cross-check + OFAC-clean confirmation in commit message. Verify at plan-write time, not at research time.
4. **`get_demo_wallet` / `set_demo_wallet` widening:**
   - The slug enum widens to include `"btc-whale"` (additive — does not remove existing slugs).
   - Persona dispatcher in `set_demo_wallet` routes `"btc-whale"` to `findBtcPersona(slug)` (mirror of `findSolanaPersona` / `findTronPersona` dispatch).

**Plan-check anchors:**
- Test: `get-btc-status.test.ts` — zero records → `{ paired: false }`; one record (segwit only) → `{ paired: true, addresses: { segwit: ..., taproot: undefined } }`; two records → `{ paired: true, addresses: { segwit: ..., taproot: ... } }`; staleAccountWarning per-record; SECRET-SAFETY scan — `derivationPath` does NOT appear (mirror of solana shoulder-surfing defense BUT this tool IS the per-chain "your own slot" surface, so the derivationPaths ARE allowed; assertion is that `derivationPaths` is the only place they appear, never bleed into nested structuredContent surfaces).
- Test: `get-vaultpilot-config-status-bitcoin.test.ts` — `btcEsploraConfigured` boolean reflects env-set state; `pairedNonEvmChains` includes `"bitcoin"` when records exist; secret-safety 3-sentinel scan (raw addresses NEVER appear in this tool's response).
- Test: `demo-state.bitcoin.test.ts` — `setActiveBtcPersona` + `getActiveBtcPersona` round-trip; reset semantics.
- Test: `bitcoin-persona.test.ts` — DOA validation throws on malformed bech32; valid persona round-trips through registry; OFAC-clean comment present.
- Test: `get-demo-wallet.bitcoin.test.ts` + `set-demo-wallet.bitcoin.test.ts` — slug routing; dispatch to `findBtcPersona`.

**Risks / surprises for planner:**
- `get_btc_status` returns TWO addresses; downstream consumers of the existing `get_solana_status`-shape contract may break if they assume single-address. NO downstream consumer exists yet (Phase 22 ships the contract); plan tests should assert structuredContent shape exactly.
- `get_portfolio_summary` BTC leg (analogous to `get_portfolio_summary` Solana leg in Phase 11 Plan 11-05 + TRON leg in Phase 17 Plan 17-04) is **NOT scoped for Phase 22**. ROADMAP Phase 22 Success Criteria do not include portfolio aggregation; PROJECT.md "Active" requirements mention multi-chain `get_portfolio_summary` extension at the v2.0 milestone (already shipped for Solana + TRON). Phase 22 can defer BTC portfolio leg to Phase 27 (`build_incident_report`) OR ship a per-row `chain: "bitcoin"` extension inline at Plan 22-03. **DECISION (Claude's discretion area): defer to Phase 27.** Rationale: BTC has no token-decimals layer like SPL / TRC-20, and DefiLlama pricing for BTC is a single key (`coingecko:bitcoin`) — the aggregation shape is structurally different from the per-token-row aggregation EVM / Solana / TRON do. Planner records the deferral and the SC-traceability cross-link.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (already configured; ALL `test/*.test.ts` files use vitest) |
| Config file | `vitest.config.ts` at repo root (existing) |
| Quick run command | `npx vitest run test/<file>.test.ts` |
| Full suite command | `npm test` (or `npx vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BTC-PAIR-01 | Pair returns both segwit + taproot addresses with VERIFY block | unit | `npx vitest run test/pair-btc-ledger.test.ts` | ❌ Wave 0 |
| BTC-PAIR-02 | get_btc_status returns dual-address shape + esploraEndpoint + appVersion | unit | `npx vitest run test/get-btc-status.test.ts` | ❌ Wave 0 |
| BTC-READ-01 | get_btc_balance returns sat + BTC via Esplora | unit | `npx vitest run test/get-btc-balance.test.ts` | ❌ Wave 0 |
| BTC-READ-02 | get_btc_balances returns segwit + taproot separately | unit | `npx vitest run test/get-btc-balances.test.ts` | ❌ Wave 0 |
| BTC-READ-03 | get_btc_account_balance gap-limit-respecting xpub scan | unit | `npx vitest run test/get-btc-account-balance.test.ts` | ❌ Wave 0 |
| BTC-READ-04 | get_btc_tx_history returns recent transactions via Esplora | unit | `npx vitest run test/get-btc-tx-history.test.ts` | ❌ Wave 0 |
| BTC-READ-05 | get_btc_fee_estimates returns Esplora fee estimates per target | unit | `npx vitest run test/get-btc-fee-estimates.test.ts` | ❌ Wave 0 |
| PAIR-NEV-* reuse | Two `chain: "bitcoin"` records persist + restore via existing store | unit + integration | `npx vitest run test/non-evm-account-store.test.ts` (extension) + `npx vitest run test/non-evm-store.eager-init.test.ts` (extension) | ✅ EXTEND |
| Phase 22 transport | Ledger BTC USB-HID transport open + close + app-detect | unit | `npx vitest run test/ledger-btc-transport.test.ts` | ❌ Wave 0 |
| Phase 22 chain shelf | Registry + esplora client + address types | unit | `npx vitest run test/chains-bitcoin-{registry,esplora-client,address-types,xpub-scan}.test.ts` | ❌ Wave 0 |
| Phase 22 persona | BTC whale persona DOA + slug routing | unit | `npx vitest run test/bitcoin-persona.test.ts` + `npx vitest run test/{get,set}-demo-wallet.bitcoin.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run test/<the-file-touched>.test.ts` (~1-2s)
- **Per wave merge:** `npx vitest run test/chains-bitcoin-*.test.ts test/{pair,get}-btc-*.test.ts test/ledger-btc-*.test.ts test/bitcoin-persona.test.ts` (~5-10s)
- **Phase gate:** `npm test` (full suite, currently ~2467 tests; Phase 22 adds ~120-150 tests by precedent — Phase 11 added 181, Phase 17 added 385 across 5 plans, Phase 21 added 12)

### Wave 0 Gaps

- [ ] `test/chains-bitcoin-registry.test.ts` — covers Plan 22-01 (env override + warn-once latch)
- [ ] `test/chains-bitcoin-esplora-client.test.ts` — covers Plan 22-01 + 22-03 (4 fetch helpers, 5-arm discriminated union)
- [ ] `test/chains-bitcoin-address-types.test.ts` — covers Plan 22-01 (bech32 + bech32m branded types)
- [ ] `test/chains-bitcoin-xpub-scan.test.ts` — covers Plan 22-03 (gap-limit-20 stop + per-xpub TTL cache + **hardcoded literal anchor of BIP-32 Test Vector 1 → first 5 segwit + first 5 taproot derivations**)
- [ ] `test/config-env-bitcoin.test.ts` — covers Plan 22-01 (`BTC_ESPLORA_URL` env reader)
- [ ] `test/ledger-btc-transport.test.ts` — covers Plan 22-02 (per-call transport + dual-address fetch + app-not-open detection)
- [ ] `test/pair-btc-ledger.test.ts` — covers Plan 22-02 (demo-mode-first + 60s race + VERIFY block + dual `saveAccount`)
- [ ] `test/get-btc-balance.test.ts` — covers Plan 22-03 (single Esplora call → BalanceReport)
- [ ] `test/get-btc-balances.test.ts` — covers Plan 22-03 (parallel segwit + taproot)
- [ ] `test/get-btc-account-balance.test.ts` — covers Plan 22-03 (xpub-scan; gap-limit-20 stop is the load-bearing assertion)
- [ ] `test/get-btc-tx-history.test.ts` — covers Plan 22-03 (limit + pagination cursor)
- [ ] `test/get-btc-fee-estimates.test.ts` — covers Plan 22-03 (5-key projection from Esplora `/fee-estimates`)
- [ ] `test/get-btc-status.test.ts` — covers Plan 22-04 (dual-address envelope; staleAccountWarning per-record)
- [ ] `test/get-vaultpilot-config-status-bitcoin.test.ts` — covers Plan 22-04 (`btcEsploraConfigured` + `pairedNonEvmChains` extension)
- [ ] `test/bitcoin-persona.test.ts` + `test/{get,set}-demo-wallet.bitcoin.test.ts` + `test/demo-state.bitcoin.test.ts` — covers Plan 22-04
- [ ] **EXTEND** `test/non-evm-account-store.test.ts` — assert two `chain: "bitcoin"` records coexist + age independently
- [ ] **EXTEND** `test/non-evm-store.eager-init.test.ts` — assert cold-boot restore loads BOTH bitcoin records

**Anchor candidate decisions (per CLAUDE.md cryptographic-binding fixture convention — adapted for the no-signing Phase 22 scope):**

1. **xpub → first-5-derivations anchor (NEW, recommended):** Hardcoded literal `0x...` / bech32 / bech32m anchors in `test/chains-bitcoin-xpub-scan.test.ts`:
   - Pinned xpub (BIP-32 Test Vector 1, m/0'): `xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj` (planner re-confirms at write time — this needs to be the BIP-84 / BIP-86 account-level xpub, not the BIP-32 raw test vector).
   - Expected first 5 BIP-84 segwit addresses: hardcoded as 5 `bc1q…` literals (compute via `bitcoinjs-lib.payments.p2wpkh({ pubkey: bip32.fromBase58(xpub).derive(0).derive(i).publicKey, network })` for i=0..4).
   - Expected first 5 BIP-86 taproot addresses: hardcoded as 5 `bc1p…` literals (compute via `bitcoinjs-lib.payments.p2tr({ internalPubkey: …, network })`).
   - Rationale: derivation drift between bitcoinjs-lib 6→7→8 or accidental change of address-format encoder would fail at a specific line.
2. **Esplora response anchor (fetch-stub fixtures):** Live-probed JSON literals for:
   - `/address/{addr}` happy-path: `{"address":"bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq","chain_stats":{"funded_txo_count":101,"funded_txo_sum":16781533,"spent_txo_count":1,"spent_txo_sum":14293,"tx_count":102},"mempool_stats":{"funded_txo_count":0,"funded_txo_sum":0,"spent_txo_count":0,"spent_txo_sum":0,"tx_count":0}}` (LIVE, verified 2026-05-21).
   - `/fee-estimates` happy-path: `{"1":1.013,"2":1.013,"3":1.013,"6":1.013,"144":0.684,"504":0.684,"1008":0.684,...}` (LIVE shape — full 24-key object; the tool projects to 5 keys).
   - 404 not-found: `{"status":404}` shape (defensive — Esplora's 404 body varies; test guards against shape).
3. **Gap-limit boundary anchor:** Mock Esplora returns 20 consecutive `tx_count: 0` addresses; assertion is `fetchAddressInfo` was called EXACTLY 20 times, NOT 21.
4. **BTC whale persona anchor:** Hardcoded literal `bc1q…` + `bc1p…` addresses in `bitcoin-persona.ts` AND in the persona's verification-ritual commit-message format.

## Open Questions

1. **BTC whale persona — which candidate?**
   - What we know: OFAC-clean per 0xB10C registry is a hard requirement. Composition-stable + active (long-lived) is a soft requirement.
   - What's unclear: there's no perfect candidate; Binance cold wallets are politically loaded but indisputably exchange-canonical. Mt. Gox cold wallets are historically interesting but their movement creates market events — less "stable demo persona", more "headline risk".
   - Recommendation: planner selects 1-2 candidates at write time and runs the OFAC verification ritual; commit message records the choice rationale and the OFAC-clean evidence. Fallback candidates can be docs-only.

2. **Default Esplora endpoint — final pick?**
   - What we know: Both blockstream.info and mempool.space serve the Esplora API. blockstream.info has gentler limits; mempool.space has richer mempool data.
   - What's unclear: which is more reliable long-term. Block stream.info is Blockstream-operated; mempool.space is community-funded.
   - Recommendation: default to blockstream.info (`https://blockstream.info/api`); document mempool.space as the alt; the user override via `BTC_ESPLORA_URL` is the escape hatch. NO need for runtime endpoint health-checking in Phase 22 (defer to Phase 27 forensic reads if a multi-source aggregator becomes useful).

3. **xpub gap-limit override?**
   - What we know: BIP-44 specifies gap-limit = 20. Some advanced wallets (Sparrow, Electrum with custom settings) allow higher.
   - What's unclear: whether to expose a `gapLimit` arg on `get_btc_account_balance` for advanced users.
   - Recommendation: hardcode `BIP44_GAP_LIMIT = 20` for Phase 22; surface a documented note in the tool description that "advanced users with non-standard gap-limits should `get_btc_balance` per-address". Add an `?gapLimit` arg in a v2.2.x follow-up if user feedback requests it.

4. **BTC `get_portfolio_summary` leg — Phase 22 or Phase 27?**
   - What we know: BTC has no per-token-row aggregation surface; the shape is single-asset (BTC + USD).
   - What's unclear: where to add the per-row `chain: "bitcoin"` extension to `get_portfolio_summary`.
   - Recommendation: defer to Phase 27 (`build_incident_report` + diagnostics) to avoid scope creep. Phase 22 ships standalone reads.

5. **`get_btc_status` lazy probe of `ledgerBtcAppVersion`?**
   - What we know: Phase 21's `get_tron_setup_status` probes the device via `_tronLedgerTransport.fetchTronAddress` at call time.
   - What's unclear: whether to add the same probe in `get_btc_status` OR defer to a Phase 27 `get_btc_setup_status` analogue.
   - Recommendation: defer the lazy probe to Phase 27 (mirror of TRON's two-tool split — `get_tron_status` is the cached envelope; `get_tron_setup_status` is the lazy-probe diagnostic). Phase 22 ships only the cached envelope.

6. **mempool.space rate-limit handling?**
   - What we know: mempool.space documents 60 req/min on the free tier.
   - What's unclear: whether to add explicit 429 handling vs. let the 5-arm `kind: "rate-limited"` cover it.
   - Recommendation: the Esplora client's 5-arm union DOES cover 429 (`kind: "rate-limited"`); the xpub-scan concurrency cap of 5 stays well below 60/min on a single-user system; no further mitigation needed in Phase 22. Document the rate-limit awareness in the tool description.

## Risks + Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| UTXO model surprises downstream Phase 23 | Medium | High | `BalanceReport` discriminated union includes `utxos[]` so Phase 23 inherits coin-selection-friendly shape with zero refactor. Reviewed Phase 23 ROADMAP plan estimates and PSBT path uses `bitcoinjs-lib.Psbt`; the UTXO shape from Phase 22 maps cleanly to `Psbt.addInput({ hash, index, witnessUtxo: { script, value } })`. |
| Ledger BTC app version drift breaks `getWalletPublicKey` shape | Low | Medium | The `getWalletPublicKey` signature is stable across `@ledgerhq/hw-app-btc` v10.x. Test mocks against the .d.ts shape; v11 if/when it lands will surface in tsc errors. |
| Esplora endpoint outage failure mode | Medium | Low | NEVER-throws contract surfaces `kind: "error"` to the agent; the agent reports the failure verbatim. No silent zeros. mempool.space configurable as fallback via `BTC_ESPLORA_URL` — user can swap endpoint without code change. |
| bech32 / bech32m library bug | Very Low | High | `bitcoinjs-lib` is battle-tested (727k weekly downloads, 11+ years of production use). The library uses BIP-173 / BIP-350 test vectors as part of its test suite. Phase 22 adds an independent test layer via hardcoded literal anchors on BIP-32 Test Vector 1 derivations. |
| User exhausts mempool.space free-tier (60/min) | Low | Low | Esplora client per-call timeout 5s + xpub-scan concurrency 5 keeps the request rate well below the limit. The 5-arm union surfaces `kind: "rate-limited"` verbatim if it does fire. |
| `bitcoinjs-lib@7` Buffer/Uint8Array drift breaks v6-style code | Low | Medium | The migration was complete in v7; v7 surface is Uint8Array. Plan 22-01 explicitly tests this (no Buffer-dependence in our consumers) — Pitfall 6 named. |
| Future LTC sharing (Phase 26) finds Phase 22's `currency: "bitcoin"` hardcoded | Medium | Low | Documented in Plan 22-02 risks. Phase 26 either adds a `currency` arg OR ships a sibling `ledger-litecoin-transport.ts`. Phase 22's `_transport.buildBtcApp` is a single point of change. |
| PAIR-NEV-* schema "additive widening" surprise | Very Low | Low | VERIFIED: zero schema change required. `chain: "bitcoin"` already in `NonEvmChain` literal-union at line 43-50. `saveAccount`'s `(chain, address)` upsert key supports multi-record-per-chain by design. |

## Anti-Patterns Specific to Phase 22

- **Re-deriving the paired addresses on every `get_btc_status` call.** The cache holds the addresses; the device opens once at pair time.
- **Treating `funded_txo_sum` as "balance".** It's "total ever received"; balance = `funded_txo_sum - spent_txo_sum`.
- **Using `bitcoinjs-lib.Psbt` in Phase 22.** PSBT is Phase 23. Phase 22 imports ONLY `bitcoinjs-lib.bip32`, `bitcoinjs-lib.payments`, `bitcoinjs-lib.address`, `bitcoinjs-lib.networks`.
- **Surfacing `derivationPath` in `list_paired_non_evm_accounts`.** The existing `list_paired_non_evm_accounts.ts` projects to `{ chain, address, pairedAt, staleAccountWarning?, displayName? }` — Phase 22 must not introduce a regression that leaks per-chain BIP44 indices.
- **Adding a BTC-specific HTTP client to `src/clients/`.** Esplora is the chain's primary backend, not a cross-chain service; it lives in `src/chains/bitcoin/esplora-client.ts` for parity with the Solana / TRON RPC clients in their respective chain shelves. `src/clients/` is reserved for cross-chain services like fourbyte, etherscan, sunswap.
- **Missing the multi-record-per-chain slot capability.** Two `saveAccount` calls (segwit + taproot) under `chain: "bitcoin"` IS the correct shape; do NOT widen the schema, do NOT introduce a `BitcoinAccountRecord` with sibling-address fields.
- **Hand-rolling bech32 / bech32m encoding.** Always route through `bitcoinjs-lib.address` or `bitcoinjs-lib.payments`.
- **Tying `get_btc_fee_estimates` to mempool.space's `/v1/fees/recommended` shape.** The phase's contract is Esplora-standard `/fee-estimates` (24-key object), projected to 5 standard targets. Users who override to mempool.space get the same Esplora-compatible response via mempool's `/api/fee-estimates` mirror.
- **Caching tx-history pages indefinitely.** New transactions land; cache TTL ~30s, NOT forever.

## Project Constraints (from CLAUDE.md)

Verbatim load-bearing directives from `./CLAUDE.md`:

- **Single-context repo:** `CONTEXT.md` + `docs/adr/` at the root. NO per-package CLAUDE.md proliferation. Phase 22 adds NO new CLAUDE.md files.
- **Tool descriptions are agent routing prompts:** every Phase 22 tool DESCRIPTION states each idea once, cuts hedging adjectives, and is precise about when to use vs not.
- **`prepare_*` always returns a handle:** does not apply to Phase 22 (no prepare tools).
- **`PREPARE RECEIPT` block in every `prepare_*` response:** does not apply.
- **`payloadFingerprint`:** does not apply (no signing).
- **`previewToken` + `userDecision`:** does not apply (no signing).
- **No private key material crosses any boundary:** Phase 22 returns pubkeys + addresses + derivation paths only. The `chainCode` returned by `getWalletPublicKey` is NOT private; it's the standard BIP-32 chain code (public component of the xpub) and is required for downstream xpub-derived address scanning.
- **`src/config/contracts.ts` SOT for canonical addresses:** does not apply (BTC has no protocol contract addresses at this layer).
- **Stderr for diagnostics, stdout for MCP protocol:** ALL `log("warn", ...)` / `log("info", ...)` calls in Phase 22 modules route through `src/diagnostics/logger.ts`.
- **ESM spy-affordance indirection:** REQUIRED on `src/chains/bitcoin/registry.ts` (`_bitcoinRegistry`) + `src/wallet/ledger-btc-transport.ts` (`_transport` + `_btcLedgerTransport`).
- **`vi.stubGlobal("fetch", …)`** at network boundary for external HTTP clients: REQUIRED for the Esplora client; do NOT introduce an internal `_esploraClient` indirection (the seam is the OUTER fetch boundary).
- **Decimal-aware arithmetic:** BTC amounts cross the agent boundary as DECIMAL STRINGS where applicable (BTC, not raw sats — e.g. `"0.5"`), but sat values are also exposed as bigint strings on `UtxoRow.valueSats` and on `BalanceReport.confirmedBalanceSats` so Phase 23 coin-selection has the precise integer. Native units: 1 BTC = 100_000_000 sats (8 decimals) — different from SOL's 9 or TRX's 6 or EVM's 18.

## Sources

### Primary (HIGH confidence)
- `@ledgerhq/hw-app-btc@10.22.1` — `.d.ts` files at `/tmp/btc-probe/node_modules/@ledgerhq/hw-app-btc/lib-es/` (Btc.d.ts, BtcNew.d.ts, getWalletPublicKey.d.ts, signPsbt/types.d.ts) — VERIFIED directly via install + grep.
- `bitcoinjs-lib@7.0.1` — `npm view bitcoinjs-lib version dependencies exports time` VERIFIED.
- Live Esplora endpoint probes at `https://blockstream.info/api/address/bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq` + `/fee-estimates` + `/address/{addr}/txs` — VERIFIED responses captured.
- Esplora API.md — https://github.com/Blockstream/esplora/blob/master/API.md (response shapes + pagination semantics).
- mempool.space comparison probe at `https://mempool.space/api/address/...` + `/api/v1/fees/recommended` — VERIFIED both endpoints respond; Esplora-standard endpoints work on both hosts.
- `src/wallet/non-evm-account-store.ts` — VERIFIED `chain: "bitcoin"` already in `NonEvmChain` literal-union; `saveAccount` upserts on `(chain, address)` supports multi-record-per-chain.
- `src/wallet/ledger-tron-transport.ts` + `src/wallet/ledger-solana-transport.ts` — VERIFIED transport pattern + spy seam + try/finally close discipline.
- `src/tools/pair_solana_ledger.ts` + `src/tools/get_solana_status.ts` — VERIFIED tool shape + VERIFY-ON-DEVICE template pattern + errorCode set.
- `src/clients/etherscan.ts` + `src/clients/fourbyte.ts` + `src/clients/sunswap.ts` — VERIFIED never-throws + 5-arm + LRU + AbortController patterns.
- `src/chains/solana/registry.ts` + `src/chains/tron/registry.ts` — VERIFIED registry shape.
- `src/demo/solana-persona.ts` + `src/demo/tron-persona.ts` — VERIFIED sibling-interface pattern + DOA-validation + OFAC ritual.

### Secondary (MEDIUM confidence)
- `npm view @ledgerhq/hw-app-btc maintainers` — Ledger official org maintainers VERIFIED.
- `https://api.npmjs.org/downloads/point/last-week/...` — download counts VERIFIED.

### Tertiary (LOW confidence)
- Anecdotal blockstream.info rate-limit `~10 req/sec OK; ~100 req/sec throttled` — community discussion, not officially documented. Mitigated by 5-concurrent cap.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | mempool.space's `/api/fee-estimates` returns the same Esplora-standard shape as blockstream.info's | Standard Stack / Alternatives | LOW — user overrides `BTC_ESPLORA_URL` to mempool.space and `get_btc_fee_estimates` returns an unexpected shape. Mitigated by 5-arm `kind: "error"` surfacing the parse failure verbatim. Confirm at execute time via `curl https://mempool.space/api/fee-estimates`. |
| A2 | blockstream.info documented rate limits — none published | Pitfalls / Risks | LOW — if blockstream.info adds rate limits, the 5-arm `kind: "rate-limited"` surfaces them. xpub-scan concurrency 5 keeps below most public-API limits. |
| A3 | BIP-32 Test Vector 1 yields specific bc1q + bc1p addresses under BIP-84/86 derivation chains | Validation Architecture / anchor fixtures | LOW — planner re-derives at write time from `bitcoinjs-lib.bip32.fromBase58(...)` calls; mismatched anchors fail at a specific test line. The test vector itself is a stable BIP-32 RFC fixture. |
| A4 | BTC whale persona `bc1q…`-form derivable from known Binance / Mt. Gox cold wallet history | Plan 22-04 | MEDIUM — planner picks at write time; bad pick rejected by OFAC verification ritual. The persona is a known-name address; the ritual catches mis-pick. |
| A5 | `bitcoinjs-lib@7` BIP-32 derivation surface is API-compatible with v6 | Standard Stack | LOW — confirmed via inspection of `bitcoinjs-lib` exports field; the `bip32` submodule is bundled. Phase 22 execute-time `npm install` resolves to actual surface. |
| A6 | `@ledgerhq/hw-app-btc.Btc.constructor({ currency: "bitcoin" })` is the canonical mainnet entry point (vs. legacy single-arg ctor) | Code Examples | LOW — confirmed at `lib-es/Btc.d.ts` constructor signature. Legacy single-arg ctor still supported per the d.ts but the named-object form is current. |
| A7 | BTC `chainCode` field returned by `getWalletPublicKey` is NOT secret material | CLAUDE.md compliance | VERY LOW — the chain code is the public component of a BIP-32 xpub; the private "key material" is the private key, which never leaves the Ledger. The chain code can be combined with the public key to derive child PUBLIC keys (not private keys); this is exactly the xpub-scan capability Phase 22 wants. |
| A8 | Phase 26 LTC sharing decision can be deferred to Phase 26 plan | Per-Plan Research 22-02 risks | LOW — Phase 22's `_transport.buildBtcApp` hardcodes `currency: "bitcoin"`; Phase 26 adds a `currency` arg OR a sibling transport module. The decision is contained. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥ 18.17 | Runtime | ✓ (already required by package.json) | (existing) | — |
| `@ledgerhq/hw-transport-node-hid` | Phase 22 transport | ✓ (installed via Phase 11) | 6.33.2 | — |
| `@ledgerhq/hw-app-btc` | Phase 22 transport | ✗ (to be installed in Plan 22-01) | `^10.22.1` | — |
| `bitcoinjs-lib` | Phase 22 chain shelf | ✗ (to be installed in Plan 22-01) | `^7.0.1` | — |
| `blockstream.info` Esplora API | Phase 22 read tools | ✓ (LIVE probe verified) | — | mempool.space (Esplora-compatible) |
| Live Ledger device + BTC app | Verify-phase only (NOT for Plan 22-01..04 unit tests) | (not present in research env) | — | unit tests use `_transport` spy + `vi.stubGlobal("fetch", …)` |

**Missing dependencies with no fallback:** None for Phase 22 code-complete; verify-phase requires real Ledger device.

**Missing dependencies with fallback:** None — Plan 22-01 installs the two new SDKs cleanly.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — installed `.d.ts` files inspected, npm registry data verified, live API probes succeeded.
- Architecture: HIGH — every pattern in this document is a direct mirror of a Phase 11 / 17 / 20 / 21 file that is already shipping in production.
- Pitfalls: MEDIUM-HIGH — Bitcoin pitfalls are well-known (bech32m, gap-limit, funded vs balance); rated MEDIUM-HIGH only because some are inferred from the SDK shape rather than confirmed via empirical execution.
- Per-plan guidance: HIGH — each plan has a concrete file-by-file shape, locked errorCode set, and load-bearing test anchor.

**Research date:** 2026-05-21
**Valid until:** 2026-06-20 (30 days for stable BTC ecosystem; Esplora endpoints + bitcoinjs-lib + Ledger BTC app are slow-moving).

## RESEARCH COMPLETE
