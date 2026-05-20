# Phase 17: Patterns — TRON scaffolding (USB-HID + TRX reads + persistent TRON account)

**Mapped:** 2026-05-20
**Files classified:** 14 new + 5 modified
**Analogs found:** 19 / 19 (every new file has a 1:1 Phase 11 Solana analog)

---

## Pattern-mapper meta-decisions

Three decisions resolved up-front so individual plans don't re-litigate:

1. **`get_portfolio_summary` — extend in place, NOT fork a TRON-only tool.** The fan-out is already shaped for multi-chain widening (Phase 11 added a `"solana"` branch via discriminated-union widening — `PortfolioChainName = ChainName | "solana"`). Phase 17 widens to `PortfolioChainName = ChainName | "solana" | "tron"`, adds a TRON leg to the `Promise.allSettled` fan-out, and reuses the existing `chainErrors` + `dustThreshold` envelope. The phase-context anchor said this is in Plan 17-04; brief says "out-of-scope, Phase 21 owns it" — **PATTERN-MAPPER DECISION: extend now, Plan 17-04.** Rationale: the Solana leg shipped in Phase 11 already as part of the same scaffolding wave (Plan 11-05); deferring TRON's fan-out leg to a later phase creates exactly the cross-chain asymmetry the Phase 8 retro flagged. Plan 17-04 owns the widening; Phase 21's job becomes "verify-phase polish + multi-protocol breadth", not "first wiring".

2. **`tron-persona.ts` — sibling module, mirror of `solana-persona.ts`.** Same reasoning as Phase 11 meta-decision §2: the EVM `Persona.slug` literal-union stays narrow; the Solana persona registry got its own `SolanaPersonaSlug`. TRON gets its own `TronPersonaSlug = "tron-whale"` with sibling `TronPersona` interface (TRON addresses are 21-byte base58check — cannot fit viem's `Address` brand). [`src/demo/state.ts`](../../src/demo/state.ts) gets parallel `TronPersona` interface + `activeTronPersona` + `getActiveTronPersona()` + `setActiveTronPersona()` + `setActiveTronPersonaBySlug()` (mirror of [lines 33-117](../../src/demo/state.ts)).

3. **TRC-20 registry naming: `tron-top-25.json` + `tron-top-25.ts` (TS loader)** — mirror Phase 11 [`src/tokens/solana-top-50.ts`](../../src/tokens/solana-top-50.ts) (94 LOC) wrapping [`src/tokens/solana-top-50.json`](../../src/tokens/solana-top-50.json). The `.ts` loader runs DOA validation at module load — for TRON this is `tronWeb.utils.address.isAddress(entry.contractAddress)` (mirror of `new PublicKey(mint)` line 61). Per-entry **decimals are load-bearing** (USDD=18, USDT/USDC=6) — schema check rejects defaults.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/chains/tron/registry.ts` | chain registry | factory + memoize | [`src/chains/solana/registry.ts`](../../src/chains/solana/registry.ts) | exact (lazy-singleton + warn-once latch + `_xRegistry` ESM spy) |
| `src/chains/tron/tron-rpc-client.ts` | chain-RPC helper | request-response | [`src/chains/solana/sol-rpc-client.ts`](../../src/chains/solana/sol-rpc-client.ts) | exact (thin SDK wrapper + bigint-at-boundary + `_xRpcInternals` test surface) |
| `src/chains/tron/types.ts` | branded types | type-only | [`src/chains/solana/types.ts`](../../src/chains/solana/types.ts) | exact (`SolanaAddress` brand → `TronAddress` brand) |
| `src/chains/tron/address.ts` | helper module | pure | [`src/tools/pair_solana_ledger.ts:109-115`](../../src/tools/pair_solana_ledger.ts) `lastHardenedIndex` | role-match (new file because 5-level extraction differs — see surprise #1) |
| `src/wallet/ledger-tron-transport.ts` | USB-HID transport | per-call open/close | [`src/wallet/ledger-solana-transport.ts`](../../src/wallet/ledger-solana-transport.ts) | exact (per-call NOT singleton + `_transport` ESM spy); **key divergence: no bs58 step — see surprise #2** |
| `src/tools/pair_tron_ledger.ts` | MCP tool (pair) | request-response | [`src/tools/pair_solana_ledger.ts`](../../src/tools/pair_solana_ledger.ts) | exact (demo-FIRST refusal + VERIFY-ON-DEVICE template + 5 locked errorCodes + Promise.race timeout) |
| `src/tools/get_tron_status.ts` | MCP tool (status) | request-response | [`src/tools/get_solana_status.ts`](../../src/tools/get_solana_status.ts) | exact (paired:false/true envelope; never errors) |
| `src/tools/get_tron_balance.ts` | MCP tool (read) | request-response | [`src/tools/get_solana_balance.ts`](../../src/tools/get_solana_balance.ts) | exact (decimal-string boundary + 5-line error envelope) |
| `src/tools/get_tron_token_balance.ts` | MCP tool (read) | request-response | [`src/tools/get_solana_token_balance.ts`](../../src/tools/get_solana_token_balance.ts) | exact (registry lookup-first + on-demand fallback + DefiLlama price) |
| `src/tools/get_tron_block_tip.ts` | MCP tool (diagnostic) | request-response | (no Solana sibling — new shape) | partial — mirror `get_tron_balance.ts` error-envelope shape; body uses `tronWeb.trx.getCurrentBlock()` (see Example 3 in RESEARCH.md) |
| `src/tokens/tron-top-25.json` | data | static | [`src/tokens/solana-top-50.json`](../../src/tokens/solana-top-50.json) | exact (per-entry decimals + symbol + displayName + address) |
| `src/tokens/tron-top-25.ts` | typed loader | request-response | [`src/tokens/solana-top-50.ts`](../../src/tokens/solana-top-50.ts) | exact (DOA validation at module load + `findByAddress` + `listTronTokens`) |
| `src/demo/tron-persona.ts` | demo data | static registry | [`src/demo/solana-persona.ts`](../../src/demo/solana-persona.ts) | exact (sibling registry + DOA validation at module load) |
| **MOD** `src/config/env.ts` | env getter | request-response | (itself — line 79 `getSolanaRpcUrl`) | additive — append `getTronRpcUrl(): string \| null` |
| **MOD** `src/tools/register-all.ts` | side-effect register | additive imports | (itself) | additive — 5 new tool imports |
| **MOD** `src/tools/get_portfolio_summary.ts` | MCP tool | request-response | (itself) | extension — TRON leg in fan-out (see meta-decision §1) |
| **MOD** `src/tools/get_vaultpilot_config_status.ts` | MCP tool | request-response | (itself — lines 144-163 Solana extension) | extension — add `tronRpcConfigured` field (Solana already adds `pairedNonEvmChains` widening) |
| **MOD** `src/tools/set_demo_wallet.ts` | MCP tool | request-response | (itself — lines 110-130 Solana branch) | extension — TRON branch mirroring Solana branch shape |
| **MOD** `src/tools/get_demo_wallet.ts` | MCP tool | request-response | (itself) | extension — add `tronPersonas` array + `activeTronPersona` (mirror lines 40-89 Solana shape) |
| **MOD** `src/demo/state.ts` | persona state | module-scoped | (itself — lines 33-117 Solana extension) | extension — parallel `TronPersona` interface + state + setters |
| **MOD** `src/pricing/defillama.ts` | pricing client | request-response | (itself — `getSolanaPrices` lines 207-276) | extension — sibling `getTronPrices(addresses: readonly string[])` (mirror Solana shape verbatim with `tron:<address>` keying) |

Test files mirror their analog's test (13 new test files + 4 extensions — full list in §Test patterns).

**Note on `non-evm-account-store.ts`:** ZERO change. The `NonEvmChain` literal-union [already includes `"tron"`](../../src/wallet/non-evm-account-store.ts) (line 43). The persistence shape is chain-agnostic; only the call sites are new.

**Note on `src/server.ts`:** ZERO change. `eagerInitNonEvmStoreIfPersist()` already wired at boot (Phase 11) — restores TRON records from cache on cold start, same code path as Solana.

---

## Pattern Assignments (by new plan)

### Plan 17-01 — TRON chain shelf + SDK install + env reader + 5-level path helper

**New files:**
- `src/chains/tron/registry.ts`
- `src/chains/tron/tron-rpc-client.ts`
- `src/chains/tron/types.ts`
- `src/chains/tron/address.ts`

**Modified files:**
- `src/config/env.ts` (additive `getTronRpcUrl(): string | null`)
- `package.json` (`tronweb@6.3.0` + `@ledgerhq/hw-app-trx@6.36.1`)

**Primary analog:** [`src/chains/solana/registry.ts`](../../src/chains/solana/registry.ts) + [`src/chains/solana/sol-rpc-client.ts`](../../src/chains/solana/sol-rpc-client.ts) + [`src/chains/solana/types.ts`](../../src/chains/solana/types.ts).

**Bounded diffs:**

1. **`src/chains/tron/registry.ts`** — mirror [`solana/registry.ts`](../../src/chains/solana/registry.ts) line-by-line. Replace `Connection` with `TronWeb` from `tronweb`, `PUBLIC_RPC_FALLBACK` with `https://api.trongrid.io`, `_solanaRegistry` with `_tronRegistry`. Export shape: `{ getTronWeb, getResolvedRpcUrl, getTronRpcUrl }`. Verbatim warn-latch + `_resetTronRegistryForTesting()`. Concrete skeleton already drafted in RESEARCH.md Example 1 (§ Topic 5).

2. **`src/chains/tron/tron-rpc-client.ts`** — mirror [`solana/sol-rpc-client.ts`](../../src/chains/solana/sol-rpc-client.ts):
   - `class TronRpcError extends Error { readonly errorCode = "TRON_RPC_FAILED" as const; … }` (mirror lines 50-61).
   - `SUN_PER_TRX = 1_000_000n` constant (6 decimals — NOT 9 like SOL — surprise #5 in RESEARCH).
   - `formatSunToTrx(sun: bigint): string` mirror of `formatLamportsToSol` (lines 83-90). 6-pad fractional, trim trailing zeros.
   - `getNativeBalance(walletBase58)`: wraps `tw.trx.getBalance(addr)` with `BigInt(...)` boundary widening — see surprise #3 below (RESEARCH Pitfall 1).
   - `getBlockTip()`: wraps `tw.trx.getCurrentBlock()` — typed return shape from RESEARCH Example 3.
   - TRC-20 read helpers (`getTrc20Balance(wallet, contract)`) via `tw.contract(abi, contract).methods.balanceOf(wallet).call()` — return `bigint` (BigNumber → BigInt at boundary).
   - `export const _trxRpcInternals = { SUN_PER_TRX, formatSunToTrx }` test surface.

3. **`src/chains/tron/types.ts`** — mirror [`solana/types.ts`](../../src/chains/solana/types.ts):
   - `export type TronAddress = string & { readonly __brand: "tron-address" };`
   - `export const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;` (T-prefixed, 34 chars total — verified via live USDT-TRC20 probe).
   - `assertTronAddress(s): asserts s is TronAddress` — regex gate first, `tronWeb.utils.address.isAddress(s)` second (full base58check + checksum). NEVER hand-roll. See RESEARCH Pitfall 4.
   - (Optional) `TronContractAddress` brand for TRC-20 mints — distinct brand so a wallet cannot be passed where a contract is expected.

4. **`src/chains/tron/address.ts`** — NEW SHAPE (no direct Solana analog because the 5-level vs 3-level path divergence). Two exports:
   - `accountIndex(derivationPath: string): string` — extracts `segments[2]` from `"44'/195'/<n>'/0/0"` (NOT segments[-1] like `lastHardenedIndex` at [`pair_solana_ledger.ts:109-115`](../../src/tools/pair_solana_ledger.ts)). See RESEARCH Pitfall 6 — REGRESSION ANCHOR.
   - `parseTronAddress(s) / formatTronAddress(bytes)` helpers — delegate to `tronWeb.utils.address.toHex / fromHex / isAddress` (RESEARCH § Topic 4). Phase 18 needs hex-form for the Protobuf raw_data path; Phase 17 only needs the validators.

5. **`src/config/env.ts`** — additive 3-line getter. Append after [line 81 `getSolanaRpcUrl()`](../../src/config/env.ts):
   ```typescript
   export function getTronRpcUrl(): string | null {
     return read("TRON_RPC_URL") ?? null;
   }
   ```

### Plan 17-02 — USB-HID Ledger transport (TRON app)

**New files:**
- `src/wallet/ledger-tron-transport.ts`

**Primary analog:** [`src/wallet/ledger-solana-transport.ts`](../../src/wallet/ledger-solana-transport.ts) (187 LOC).

**Bounded diffs:**

- Per-call transport (NOT a singleton) — mirror lines 1-24 top-of-file comment block.
- ESM default-export drift shim: `const TrxApp: any = (TrxAppModule as any).default ?? TrxAppModule;` (mirror lines 32-44).
- `DEFAULT_TRON_DERIVATION_PATH = "44'/195'/0'/0/0"` — **5-level NOT 3-level** (RESEARCH § Topic 3 + surprise #1 below).
- `APPROVAL_TIMEOUT_MS = 60_000` (parity with Solana line 62).
- Error classes: `LedgerDeviceNotConnectedError` + `LedgerTronAppNotOpenError` mirror lines 69-91. Recovery-action-in-message: "connect your Ledger via USB, unlock it, and open the **TRON** app, then retry."
- `_transport` ESM spy-affordance object — `{ isSupported, list, open, buildTrxApp }` (mirror lines 101-107).
- `openTransport()` body byte-identical to [`ledger-solana-transport.ts:126-135`](../../src/wallet/ledger-solana-transport.ts) (only the error message under exchange varies).
- **CRITICAL — `fetchTronAddress()` divergence from `fetchSolanaAddress()`**:
  - Solana (line 165): `const { address: rawPubkey } = await app.getAddress(...); const address = bs58.encode(rawPubkey);`
  - **TRON: NO `bs58.encode` STEP.** `app.getAddress(path)` returns `{ address: string, publicKey: string }` where `address` is ALREADY the base58check T-prefixed string (Ledger app encodes on-device). Return the field VERBATIM.
  - See surprise #2 below — REGRESSION ANCHOR. Skeleton in RESEARCH Example 2.
- `_resetLedgerTronTransportForTesting()` no-op (no singleton state to clear) — mirror lines 184-186.

### Plan 17-03 — Pair + status + balance + block-tip MCP tools (5 new tools)

**New files:**
- `src/tools/pair_tron_ledger.ts`
- `src/tools/get_tron_status.ts`
- `src/tools/get_tron_balance.ts`
- `src/tools/get_tron_token_balance.ts`
- `src/tools/get_tron_block_tip.ts`

**Modified files:**
- `src/tools/register-all.ts` (5 additive import lines after line 19 `get_solana_status.js`)
- `src/tools/get_vaultpilot_config_status.ts` (additive `tronRpcConfigured` field at lines 144-163 region)

**Primary analog:** [`src/tools/pair_solana_ledger.ts`](../../src/tools/pair_solana_ledger.ts) (265 LOC) + [`src/tools/get_solana_status.ts`](../../src/tools/get_solana_status.ts) (99 LOC) + [`src/tools/get_solana_balance.ts`](../../src/tools/get_solana_balance.ts) (106 LOC) + [`src/tools/get_solana_token_balance.ts`](../../src/tools/get_solana_token_balance.ts) (196 LOC).

**Bounded diffs:**

1. **`src/tools/pair_tron_ledger.ts`** — mirror `pair_solana_ledger.ts` end-to-end:
   - Locked errorCode set: `DEMO_MODE_REFUSED`, `LEDGER_NOT_CONNECTED`, `TRON_APP_NOT_OPEN`, `USER_REJECTED`, `APPROVAL_TIMEOUT` + `INTERNAL_ERROR` defensive fallback (mirror lines 25-31).
   - **`VERIFY_ON_DEVICE_TRON_TEMPLATE`** — mirror lines 79-88. Key divergence: substitute `{ACCOUNT_INDEX}` (NOT `{DERIVATION_PATH_LAST_INDEX}`) at FIVE positions in the 5-level path display (`44'/195'/{ACCOUNT_INDEX}'/0/0`). Skeleton in RESEARCH Example 4.
   - Helper: `accountIndex(derivationPath)` imported from `src/chains/tron/address.ts` (Plan 17-01). DO NOT inline a `lastHardenedIndex` here — wrong helper, wrong semantics (REGRESSION ANCHOR per RESEARCH Pitfall 6).
   - Demo-mode FIRST refusal at the top of the handler (mirror lines 132-148) — T-DEMO-1 mitigation.
   - `Promise.race` against 60s timer (mirror lines 152-163).
   - `saveAccount({ chain: "tron", address, derivationPath, pairedAt })` — zero schema change to `non-evm-account-store.ts`.
   - Catch ladder ordered most-specific-first (mirror lines 189-264).

2. **`src/tools/get_tron_status.ts`** — mirror `get_solana_status.ts` byte-identical with `chain: "tron"` filter:
   - `listAccounts({ chainFilter: "tron" })` (mirror line 45).
   - `_tronRegistry.getResolvedRpcUrl()` for the `rpcEndpoint` field (mirror line 64 swap from `_solanaRegistry`).
   - Never errors — missing record → `{ paired: false }` (mirror lines 47-58).
   - `staleAccountWarning` flag passthrough (mirror lines 73-75).

3. **`src/tools/get_tron_balance.ts`** — mirror `get_solana_balance.ts`:
   - Input schema: `wallet` REQUIRED, pattern `^T[1-9A-HJ-NP-Za-km-z]{33}$` (T-prefixed 34-char base58check — mirror line 30 with TRON regex).
   - Calls `getNativeBalance(wallet)` from Plan 17-01.
   - Response shape: `{ wallet, sun: string, trx: string, decimals: 6, symbol: "TRX" }` (mirror Solana's `{ lamports, sol, decimals: 9, symbol: "SOL" }` shape at lines 37-45; **decimals=6 NOT 9**).
   - Error envelope shape (`SolanaRpcError → TronRpcError`) mirror lines 78-105.

4. **`src/tools/get_tron_token_balance.ts`** — mirror `get_solana_token_balance.ts` (the richer 196-LOC tool):
   - Input: `{ wallet, contractAddress }` (vs Solana's `{ wallet, mint }`) — both T-prefixed regexes.
   - Registry lookup first via `findByAddress` from `src/tokens/tron-top-25.ts` (Plan 17-04 ships the registry — Plan 17-03 imports the type but can ship without runtime entries; Plan 17-04 lands the data).
   - On-demand decimals fallback via `tw.contract(['function decimals() view returns (uint8)'], contractAddress).methods.decimals().call()`.
   - **CRITICAL — Pitfall 5 (RESEARCH):** per-entry decimals from registry (USDD=18, USDT/USDC=6) — NEVER default to 6. Hardcoded `decimals = 6` in this tool fails the registry invariant.
   - DefiLlama price via `getTronPrices([contractAddress])` from `defillama.ts` extension (Plan 17-04).

5. **`src/tools/get_tron_block_tip.ts`** — TRON-specific diagnostic (no direct Solana sibling):
   - Input: empty schema.
   - Body: `_tronRegistry.getTronWeb().trx.getCurrentBlock()` — typed `Block` return.
   - Response: `{ number: number, timestamp: number, blockHash: string }` — extract from `block.block_header.raw_data` per RESEARCH Example 3.
   - Error envelope identical to `get_tron_balance.ts` (`TronRpcError` → wire shape).

6. **`src/tools/register-all.ts`** — 5 additive import lines after line 19 (`get_solana_status.js`):
   ```typescript
   import "./pair_tron_ledger.js";
   import "./get_tron_status.js";
   import "./get_tron_balance.js";
   import "./get_tron_token_balance.js";
   import "./get_tron_block_tip.js";
   ```

7. **`src/tools/get_vaultpilot_config_status.ts`** — additive at lines 144-163 region:
   - Import `getTronRpcUrl` from `../config/env.js`.
   - Add `const tronRpcConfigured = getTronRpcUrl() !== null;` (mirror line 163 Solana shape).
   - Add `tronRpcConfigured` to `structured` object (line 198 region).
   - Add `tronRpcConfigured:` text line (line 228 region).
   - `pairedNonEvmChains` array already includes `"tron"` automatically via `listAccounts()` (line 157-160 — chain-agnostic).
   - DESCRIPTION array update: add `tronRpcConfigured` to the field-list sentence (line 69).

### Plan 17-04 — TRC-20 registry + DefiLlama TRON pricing + `get_portfolio_summary` TRON leg

**New files:**
- `src/tokens/tron-top-25.json`
- `src/tokens/tron-top-25.ts`

**Modified files:**
- `src/pricing/defillama.ts` (additive `getTronPrices` sibling, mirror `getSolanaPrices` lines 207-276)
- `src/tools/get_portfolio_summary.ts` (TRON leg in fan-out — see meta-decision §1)

**Primary analog:** [`src/tokens/solana-top-50.ts`](../../src/tokens/solana-top-50.ts) + [`src/pricing/defillama.ts`](../../src/pricing/defillama.ts) lines 207-276 + [`src/tools/get_portfolio_summary.ts`](../../src/tools/get_portfolio_summary.ts) lines 1-200 (Solana extension shape).

**Bounded diffs:**

1. **`src/tokens/tron-top-25.json`** — 20-25 curated entries. Required (verified in RESEARCH § Topic 6):
   - USDT-TRC20 = `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` (decimals=6)
   - USDC-TRC20 = `TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8` (decimals=6)
   - USDD = `TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn` (**decimals=18 — REGRESSION ANCHOR** per Pitfall 5)
   - WTRX = `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` (decimals=6) — `NATIVE_PRICING_PROXY.tron`
   - TUSD-TRC20, BTT, JST (JUST), SUN, sTRX, … (plan author finalizes top-25 via DefiLlama price-availability filter per RESEARCH § Topic 6 lock).
   - JSON shape per entry: `{ contractAddress, symbol, decimals, displayName }` (mirror Solana's `{ mint, symbol, decimals, displayName }` shape).

2. **`src/tokens/tron-top-25.ts`** — typed loader, mirror [`solana-top-50.ts`](../../src/tokens/solana-top-50.ts) byte-identical except:
   - `validateEntry`: replace `new PublicKey(r.mint)` (line 61) with `if (!tronWeb.utils.address.isAddress(r.contractAddress)) throw new Error(...)` — DOA validation at module load (Pitfall 4 — REGRESSION ANCHOR).
   - Schema reject `decimals < 0` or non-integer (mirror line 54). For Phase 17 specifically: add an explicit non-default check that `decimals` is present (no implicit fallback).
   - Exports: `findByAddress(addr)` (mirror `findByMint`) + `listTronTokens()` (mirror `listSolanaTokens`).

3. **`src/pricing/defillama.ts`** — append `getTronPrices(addresses: readonly string[]): Promise<Map<string, PriceQuote>>` mirroring `getSolanaPrices` (lines 207-276). Key shape: `tron:<base58>` (case-sensitive — DO NOT lowercase, per RESEARCH § Topic 7). Verified live: returns `{ symbol, decimals, price }` envelope. Shared cache via the module-level `cache` Map keyed by `tron:<address>` (no collision with EVM or Solana namespaces).

4. **`src/tools/get_portfolio_summary.ts`** — widen the discriminated-union and add a TRON leg:
   - Widen `PortfolioChainName = ChainName | "solana"` (line 40) → `ChainName | "solana" | "tron"`.
   - Widen `NATIVE_PRICING_PROXY` table (lines 76-83) with `tron: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR"` (WTRX).
   - Add `TronChainPortfolio` interface (mirror `SolanaChainPortfolio` at lines 187-193).
   - Widen `AnyChainPortfolio` union (line 195) to include `TronChainPortfolio`.
   - Add `includeTron: boolean` arg (mirror `includeSolana` at lines 115-118).
   - Add `resolveTronWalletForFanOut()` helper (mirror `resolveSolanaWalletForFanOut` shape — paired record first via `listAccounts({ chainFilter: "tron" })`, demo persona second via `getActiveTronPersona()`).
   - Add `readTronPortfolioWithTimeout` + `readTronPortfolio` (mirror Solana shape at lines 295-326 ish — adapted in same file).
   - Plumb TRON leg into the `Promise.allSettled` fan-out at lines 290-326 (mirror Solana branch at lines 295-297, 316-326).
   - DESCRIPTION update: mention TRON in the "fans out across all 5 chains" line + add `includeTron` to the schema description.

### Plan 17-05 — TRON demo persona + `set_demo_wallet` / `get_demo_wallet` widening

**New files:**
- `src/demo/tron-persona.ts`

**Modified files:**
- `src/demo/state.ts` (additive `TronPersona` interface + `activeTronPersona` state + setters; mirror lines 33-117)
- `src/tools/set_demo_wallet.ts` (additive `tron-whale` slug enum + handler branch; mirror lines 66-71 + 110-130)
- `src/tools/get_demo_wallet.ts` (additive `tronPersonas` + `activeTronPersona` fields; mirror lines 40-89)

**Primary analog:** [`src/demo/solana-persona.ts`](../../src/demo/solana-persona.ts) (138 LOC).

**Bounded diffs:**

1. **`src/demo/tron-persona.ts`** — mirror `solana-persona.ts` byte-identical:
   - `export type TronPersonaSlug = "tron-whale"` (mirror line 48).
   - `export interface TronPersona { slug, chain: "tron", tronAddress, description, rehearsableFlows, simulationEnvelopeShape: "triggerconstantcontract" }` (mirror lines 66-75 — simulation envelope shape per RESEARCH § Topic 8: `triggerconstantcontract` not `simulateTransaction`).
   - `export const TRON_PERSONAS` table — single entry `tron-whale`. **Plan author picks from RESEARCH § Topic 8 candidates:** preferred `TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb` (141M TRX, OFAC-clean), or JustLend `mainContractAddress`, or SunSwap protocol address. VERIFICATION RITUAL block at module head — mirror lines 9-31.
   - DOA validation at module load: `for (const p of TRON_PERSONAS) { if (!tronWeb.utils.address.isAddress(p.tronAddress)) throw new Error(...) }` (mirror lines 109-111).
   - Exports: `findTronPersona(slug)` + `listTronPersonas()` (mirror lines 113-129).

2. **`src/demo/state.ts`** — additive at the same shape as the Solana extension at lines 33-117:
   - `export interface TronPersona { slug: string; tronAddress: string; description?: string }` — minimal carve (the full `TronPersona` ships in `src/demo/tron-persona.ts`).
   - `let activeTronPersona: TronPersona | null = null;`
   - `getActiveTronPersona()` / `setActiveTronPersona(persona)` / `setActiveTronPersonaBySlug(slug)` — byte-identical shape to lines 75-117 Solana counterparts. Defense-in-depth `if (!persona || typeof persona.tronAddress !== "string") throw`.
   - Update `_resetActivePersonaForTesting()` at line 124 to clear `activeTronPersona = null`.

3. **`src/tools/set_demo_wallet.ts`** — additive in the slug enum + handler:
   - Add `"tron-whale"` to the JSON-schema enum (mirror line 68).
   - Add TRON branch BEFORE the EVM branch (parallel to the Solana branch at lines 110-130):
     ```typescript
     const tronPersona = findTronPersona(slug);
     if (tronPersona) {
       const activated = setActiveTronPersonaBySlug(tronPersona.slug);
       // return success envelope with chain: "tron", address: activated.tronAddress
     }
     ```
   - DESCRIPTION update at line 49 + line 53 + line 71: mention TRON option (`1 TRON: tron-whale`).

4. **`src/tools/get_demo_wallet.ts`** — additive at lines 40-89:
   - `const tronPersonas = listTronPersonas();` (mirror line 40 Solana).
   - Render-loop addition for TRON entries in the text block (mirror lines 53-56).
   - `structuredContent` additions: `tronPersonas: tronPersonas.map(...)` + `activeTronPersona` (mirror lines 86-89).

---

## Test Patterns (per new plan)

Every new test mirrors the EXACT shape of the named Solana analog at v2.0 Phase 11. Same `vi.mock` factories, same `beforeEach` / `afterEach` env-pin + reset-for-testing pair, same `_resetX` test-only-reset call, same `vi.spyOn(_<scope>, "method")` indirection pattern.

| New Test | Mirror | Notes |
|---|---|---|
| `test/chains-tron-registry.test.ts` | [`test/chains-solana-registry.test.ts`](../../test/chains-solana-registry.test.ts) | env-override + TronGrid fallback + once-per-process warn-latch |
| `test/chains-tron-rpc-client.test.ts` | [`test/chains-solana-sol-rpc-client.test.ts`](../../test/chains-solana-sol-rpc-client.test.ts) | `formatSunToTrx` regression (0n, 1n, 1_000_000n, fractional-trim cases) + `TronRpcError` wrapper + **bigint widening at boundary (Pitfall 1 REGRESSION ANCHOR — fixture wallet with > Number.MAX_SAFE_INTEGER sun fails on number-precision drift)** |
| `test/chains-tron-address.test.ts` | NEW (no Solana sibling) | `accountIndex("44'/195'/0'/0/0")` → `"0"`, `accountIndex("44'/195'/3'/0/0")` → `"3"`. **REGRESSION ANCHOR per Pitfall 6 — a `lastHardenedIndex` re-use returns `"0"` for slot 3 (address-index, not account-index).** Plus `parseTronAddress` / `formatTronAddress` round-trip via tronweb. |
| `test/config-env-tron.test.ts` | [`test/config-env-solana.test.ts`](../../test/config-env-solana.test.ts) | `getTronRpcUrl()` returns `string \| null`; trims whitespace; null on empty/missing |
| `test/ledger-tron-transport.test.ts` | [`test/ledger-solana-transport.test.ts`](../../test/ledger-solana-transport.test.ts) | lazy-singleton + `_transport` spy + transport.close() in finally. **REGRESSION ANCHOR per Pitfall 2: assert `fetchTronAddress` returns the `getAddress().address` field VERBATIM (no `bs58.encode` step). A test fixture where the mock returns `{ address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" }` must NOT pass through `bs58.encode` — the returned `address` field MUST string-equal `"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"`.** |
| `test/pair-tron-ledger.test.ts` | [`test/pair-solana-ledger.test.ts`](../../test/pair-solana-ledger.test.ts) | demo-mode FIRST refusal + VERIFY-ON-DEVICE template substitution + 5 locked errorCodes + 5-level-path account-index extraction in template body |
| `test/get-tron-status.test.ts` | [`test/get-solana-status.test.ts`](../../test/get-solana-status.test.ts) | `{ paired: false }` vs `{ paired: true, ..., rpcEndpoint }` envelope; stale-warning passthrough |
| `test/get-tron-balance.test.ts` | [`test/get-solana-balance.test.ts`](../../test/get-solana-balance.test.ts) | sun→TRX 6-decimal conversion (NOT 9!); regex pattern T-prefixed 34-char; decimal-string-at-boundary |
| `test/get-tron-token-balance.test.ts` | [`test/get-solana-token-balance.test.ts`](../../test/get-solana-token-balance.test.ts) | **REGRESSION ANCHOR per Pitfall 5: USDD=18 vs USDT=6 — registry hit MUST surface per-entry decimals.** Plus `TRON_RPC_FAILED` envelope shape. |
| `test/get-tron-block-tip.test.ts` | NEW (no Solana sibling) | typed Block return + timestamp parse + error envelope |
| `test/tron-top-25.test.ts` | [`test/solana-top-50.test.ts`](../../test/solana-top-50.test.ts) | Registry shape; DOA at module load (broken-address entry throws on import); REQUIRED entries USDT/USDC/USDD/WTRX present; **per-entry-decimals invariant (USDD=18 explicit assertion)** |
| `test/get-portfolio-summary.tron.test.ts` | [`test/get-portfolio-summary.solana.test.ts`](../../test/get-portfolio-summary.solana.test.ts) | TRON leg in fan-out; paired-record path; demo-persona fallback path; back-compat (no TRON paired → silent skip, NOT chainErrors); `chainErrors` partial-result envelope |
| `test/tron-persona.test.ts` | [`test/solana-persona.test.ts`](../../test/solana-persona.test.ts) | DOA `tronWeb.utils.address.isAddress` validation at module load |
| `test/demo-state.tron.test.ts` | [`test/demo-state.solana.test.ts`](../../test/demo-state.solana.test.ts) | `setActiveTronPersona` / `getActiveTronPersona` round-trip; `_resetActivePersonaForTesting` clears |
| `test/set-demo-wallet.tron.test.ts` | [`test/set-demo-wallet.solana.test.ts`](../../test/set-demo-wallet.solana.test.ts) | `tron-whale` slug branch surfaces `chain: "tron"` envelope |
| `test/get-demo-wallet.tron.test.ts` | [`test/get-demo-wallet.solana.test.ts`](../../test/get-demo-wallet.solana.test.ts) | `tronPersonas` array + `activeTronPersona` field surfaced |
| **EXTEND** `test/get-vaultpilot-config-status-tron.test.ts` | [`test/get-vaultpilot-config-status-solana.test.ts`](../../test/get-vaultpilot-config-status-solana.test.ts) | `tronRpcConfigured` boolean assertion; `pairedNonEvmChains` includes `"tron"` when paired |
| **EXTEND** `test/non-evm-account-store.test.ts` (existing) | (itself) | Add TRON record persistence + restore cases — schema already accepts `"tron"`, only call-site cases are new |

---

## Shared Patterns (cross-cutting; apply to every relevant plan)

### Pattern A — ESM spy-affordance indirection (CLAUDE.md convention)

**Source:** [`src/wallet/session-manager.ts:48-54`](../../src/wallet/session-manager.ts) (`_storage`); [`src/wallet/walletconnect-client.ts:38-48`](../../src/wallet/walletconnect-client.ts) (`_wcStorage`); [`src/chains/solana/registry.ts:140-144`](../../src/chains/solana/registry.ts) (`_solanaRegistry`); [`src/wallet/ledger-solana-transport.ts:101-107`](../../src/wallet/ledger-solana-transport.ts) (`_transport`).

**Apply to:**
- `chains/tron/registry.ts` — `export const _tronRegistry = { getTronWeb, getResolvedRpcUrl, getTronRpcUrl }`
- `wallet/ledger-tron-transport.ts` — `export const _transport = { isSupported, list, open, buildTrxApp }`
- `chains/tron/tron-rpc-client.ts` — `export const _trxRpcInternals = { SUN_PER_TRX, formatSunToTrx }` (test surface, parallel to `_solRpcInternals`)

Pattern non-optional per CLAUDE.md "Add the indirection at write time, not retroactively." Internal cross-export calls MUST go through `_X.method`, not the bare import.

### Pattern B — Q-STRICT-not-applicable

`TRON_RPC_URL` is a URL string, not an enum. No Q-STRICT gate needed; the registry's fallback-or-override behavior fully handles missing/empty (mirror of `SOLANA_RPC_URL` at [`env.ts:79-81`](../../src/config/env.ts)).

### Pattern C — Tool description as agent routing prompt

**Source:** [`src/tools/pair_solana_ledger.ts:90-96`](../../src/tools/pair_solana_ledger.ts) (DESCRIPTION array → `.join(" ")`).

**Apply to:** Every new tool's `DESCRIPTION`. State each idea once. Cut hedging adjectives. Routing hints first ("Use this when X, NOT when Y"). Per CLAUDE.md `## Conventions`. Tool description MUST be ≥ 100 chars (`src/tools/index.ts:28` `MIN_DESCRIPTION_LEN`).

### Pattern D — Decimal-string-at-the-boundary

**Source:** [`src/chains/solana/sol-rpc-client.ts:83-90`](../../src/chains/solana/sol-rpc-client.ts) (`formatLamportsToSol`).

**Apply to:** `tron-rpc-client.ts`'s `formatSunToTrx`. TRX has **6 decimals** (1 TRX = 10^6 sun) — NOT 9 like SOL. TRC-20 mints carry per-entry decimals via the curated registry (`tron-top-25.json`), with on-demand `decimals()` ABI call as fallback. Convert via decimal-string formatter (no `number` types cross into the JSON response). Off-by-decimal is the most common user-facing bug per CLAUDE.md `## Conventions`.

### Pattern E — bigint widening at the boundary

**Source:** [`src/chains/solana/sol-rpc-client.ts:115-116`](../../src/chains/solana/sol-rpc-client.ts) — `const lamportsNumber = await connection.getBalance(pubkey); const lamports = BigInt(lamportsNumber);`.

**Apply to:** `tron-rpc-client.ts::getNativeBalance` — `BigInt(await tw.trx.getBalance(addr))`. **REGRESSION ANCHOR per RESEARCH Pitfall 1** — TronGrid returns `number`, which loses precision at > 9_007_199_254_740_991 sun (~9 billion TRX). Bigint at the boundary protects the downstream math.

### Pattern F — Locked errorCode envelopes

**Source:** [`src/tools/pair_solana_ledger.ts:24-31`](../../src/tools/pair_solana_ledger.ts) (5 locked codes + `INTERNAL_ERROR` last-resort fallback).

**Apply to:** Every new pair / read / mutate tool. Phase 17 errorCode set:
- `pair_tron_ledger`: `DEMO_MODE_REFUSED`, `LEDGER_NOT_CONNECTED`, `TRON_APP_NOT_OPEN`, `USER_REJECTED`, `APPROVAL_TIMEOUT` + `INTERNAL_ERROR`.
- `get_tron_balance` / `get_tron_token_balance` / `get_tron_block_tip`: `TRON_RPC_FAILED` + `INVALID_INPUT` + `INTERNAL_ERROR`.

### Pattern G — Verify-on-device template with 5-level account-index extraction

**Source:** [`src/tools/pair_solana_ledger.ts:79-88`](../../src/tools/pair_solana_ledger.ts) (`VERIFY_ON_DEVICE_SOLANA_TEMPLATE`) + lines 109-115 (`lastHardenedIndex`).

**Apply to:** `pair_tron_ledger.ts`'s `VERIFY_ON_DEVICE_TRON_TEMPLATE`. Substitutes `{ADDRESS}` + `{ACCOUNT_INDEX}` (NOT `{DERIVATION_PATH_LAST_INDEX}`). Uses `accountIndex(path)` from `src/chains/tron/address.ts` (Plan 17-01) — extracts segments[2], NOT segments[-1]. **REGRESSION ANCHOR per RESEARCH Pitfall 6** — wrong helper extracts the address-index (last segment) instead of the account slot (third segment), surfacing `"0"` even when the user paired slot 3.

### Pattern H — DOA validation at module load

**Source:** [`src/tokens/solana-top-50.ts:60-67`](../../src/tokens/solana-top-50.ts) (`new PublicKey(r.mint)` validates on import); [`src/demo/solana-persona.ts:109-111`](../../src/demo/solana-persona.ts).

**Apply to:** `tron-top-25.ts` + `tron-persona.ts` — `if (!tronWeb.utils.address.isAddress(addr)) throw new Error(...)` at module-load loop. **REGRESSION ANCHOR per RESEARCH Pitfall 4** — full base58check + checksum + 0x41-prefix validation; do NOT hand-roll a regex (regex misses bad-checksum input).

---

## FROZEN areas (do NOT touch — verified absent from every plan's "Modified files")

Per project CLAUDE.md `## Architecture` + v1.x phase retros — the cryptographic-binding pipeline is byte-frozen:

- `src/signing/payload-fingerprint.ts`
- `src/signing/presign-hash.ts`
- `src/signing/handle-store.ts`
- `src/signing/blocks.ts`
- `src/signing/error-codes.ts`
- `src/signing/amount.ts`
- `src/signing/resolve-from.ts`
- `src/signing/simulation.ts`
- `src/signing/aave-health.ts`
- `src/tools/send_transaction.ts` (three-gate region)
- `src/tools/preview_send.ts` (preview-token shape)
- `src/security/canonical-dispatch.ts`
- `src/security/skill-integrity.ts`
- All Phase 12 Solana-side signing modules (when shipped): `src/signing/solana-fingerprint.ts`, related domain-tag constants

**Verification:** Phase 17 is reads + USB-HID pairing ONLY — no `prepare_*` / `preview_send` / `send_transaction` TRON variants. Those land in Phase 18 (the TRON trust pipeline with distinct domain tag `"VaultPilot-trontx-v1:"`). Every plan in this PATTERNS.md leaves the FROZEN list untouched. **Status: all FROZEN files NOT touched — verified.**

---

## Coordination Points (multi-plan carve)

### `src/tools/register-all.ts` — touched by Plan 17-03 ONLY

5 additive import lines after line 19 (`get_solana_status.js`). No coordination needed.

### `src/tools/get_portfolio_summary.ts` — touched by Plan 17-04 ONLY

Single-plan modification (discriminated-union widening + TRON leg in fan-out + `NATIVE_PRICING_PROXY.tron`). Phase 11 already established the widening shape at lines 40, 76-83, 187-200, 290-326.

### `src/tools/get_vaultpilot_config_status.ts` — touched by Plan 17-03 ONLY

Additive `tronRpcConfigured` field at lines 144-163 region. Phase 11 already added `solanaRpcConfigured` (line 163) and `pairedNonEvmChains` (lines 157-160) — TRON gets the parallel addition.

### `src/demo/state.ts` — touched by Plan 17-05 ONLY

Additive `TronPersona` interface + state + setters parallel to lines 33-117 (Solana extension). Single plan.

### `src/tools/set_demo_wallet.ts` + `src/tools/get_demo_wallet.ts` — touched by Plan 17-05 ONLY

Both files extend in parallel to the Solana branch shape. Single plan; no coordination.

### `src/pricing/defillama.ts` — touched by Plan 17-04 ONLY

Additive `getTronPrices` sibling export at the end of file (after `getSolanaPrices` at lines 207-276). Shared in-memory cache via the module-level `cache` Map keyed by `tron:<address>` — no collision with EVM or Solana namespaces (distinct keying).

### `package.json` — touched by Plan 17-01 ONLY

Two adds: `tronweb@6.3.0` + `@ledgerhq/hw-app-trx@6.36.1`. `@ledgerhq/hw-transport-node-hid@6.33.2` already installed at Phase 11 (reuse confirmed in RESEARCH § Topic 2).

---

## Wave Structure

```
Wave 1: 17-01 (TRON chain shelf + SDK install + env reader + 5-level path helper)
        └─ foundational — Plans 17-02 / 17-03 / 17-04 import from here

Wave 2: 17-02 (USB-HID transport for TRON app)
        ├─ depends on 17-01 (no — only `@ledgerhq/hw-app-trx` install; can run parallel)
        └─ INDEPENDENT of 17-01 IF SDK install is in 17-01's gate; but cleaner to run sequentially

Wave 3: 17-03 (5 MCP tools: pair + status + balance + token-balance + block-tip + config-status extension)
        ├─ depends on 17-01 (chains/tron) + 17-02 (transport)
        └─ touches register-all.ts + get_vaultpilot_config_status.ts

Wave 4: 17-04 (TRC-20 registry + DefiLlama TRON pricing + get_portfolio_summary TRON leg)
              ∥
        17-05 (TRON demo persona + set_demo_wallet / get_demo_wallet widening + state.ts extension)
        ├─ 17-04 depends on 17-01 (registry import) + 17-03 (get_tron_token_balance imports findByAddress)
        ├─ 17-05 depends on 17-03 (set_demo_wallet branches before EVM/Solana paths)
        ├─ 17-04 & 17-05 touch DIFFERENT files — clean parallel
        └─ Both extend already-multi-chain-shaped existing files (no register-all.ts collision)
```

**Parallel-eligible pairs:**
- Wave 4: **17-04 ∥ 17-05** (independent — 17-04 touches `defillama.ts` + `get_portfolio_summary.ts` + `src/tokens/`; 17-05 touches `src/demo/` + `set_demo_wallet.ts` + `get_demo_wallet.ts` — zero file overlap)

**Strict-sequential pairs:**
- 17-01 → all (foundational chain shelf + SDK install + env reader)
- 17-02 → 17-03 (transport must exist before pairing tool)
- 17-01 → 17-03 (RPC client must exist before balance reads)
- 17-03 → 17-04 (`get_tron_token_balance` consumes `findByAddress` from Plan 17-04 — but circular: Plan 17-03 ships the tool importing the type; Plan 17-04 ships the data. **DECISION:** Plan 17-03 imports types-only from Plan 17-04's surface; Plan 17-03 ships the tool with a stub-pinned registry shape. Plan 17-04 lands the actual entries. Same coordination Phase 11 used for `solana-top-50.ts` (Plan 11-05 imported the loader BEFORE Plan 11-05 ships final entries))
- 17-03 → 17-05 (`set_demo_wallet` branch must run BEFORE the EVM branch — Phase 11 pattern)

**Plan count proposed: 5** (17-01 through 17-05). Smaller than Phase 11 (no SPL-class discovery surface; TRON tokens enumerated from curated registry only — RESEARCH § Topic 6 lock).

---

## Pattern Surprises (beyond research surprises)

The RESEARCH document already named six pitfalls. Two patterns surface here that the planner should note explicitly:

1. **`get_portfolio_summary` SHIPPED IN PHASE 17, not deferred to Phase 21.** The phase-context brief and RESEARCH § Topic 9 both said "deferred to Phase 21." Pattern-mapper meta-decision §1 overrides: Phase 11 already extended `get_portfolio_summary` with the Solana leg as part of the scaffolding wave (Plan 11-05), not as a follow-up phase. Skipping the TRON leg here recreates the cross-chain asymmetry the Phase 8 retro flagged. The discriminated-union shape is already there; widening is 50-80 LOC of additive code in a single file. Plan 17-04 owns it.

2. **`src/demo/state.ts` is a "modified" file, not part of `tron-persona.ts`.** Phase 11 split the persona work across `solana-persona.ts` (the registry — sibling module) AND `state.ts` (the active-persona state + setters — extended in place). Phase 17 mirrors this exactly: `tron-persona.ts` ships the registry; `state.ts` is extended with parallel `activeTronPersona` state + setters at lines 33-117 region. Skipping the `state.ts` modification leaves no place to call `setActiveTronPersona()` — the persona registry becomes inert.

3. **Plan-17-03 → Plan-17-04 type-only dependency.** `get_tron_token_balance.ts` imports `findByAddress` from `src/tokens/tron-top-25.ts`. To allow Plan 17-04 to ship in parallel with later waves, Plan 17-03 should import the LOADER (which Plan 17-04 ships), and Plan 17-04 ships the JSON entries. This mirrors how Plan 11-05 in Phase 11 handled `solana-top-50.ts`. Slight wave-coordination subtlety — both authors should reference this section.

---

## Metadata

**Analog search scope:** `src/wallet/`, `src/chains/`, `src/tools/`, `src/demo/`, `src/config/`, `src/tokens/`, `src/pricing/`, `src/server.ts`, `test/`.

**Files read in full or in load-bearing section:** `chains/solana/registry.ts` (149 LOC), `chains/solana/sol-rpc-client.ts` (233 LOC), `chains/solana/types.ts` (66 LOC), `wallet/ledger-solana-transport.ts` (187 LOC), `wallet/non-evm-account-store.ts` (335 LOC), `tools/pair_solana_ledger.ts` (265 LOC), `tools/get_solana_status.ts` (99 LOC), `tools/get_solana_balance.ts` (106 LOC), `tools/get_solana_token_balance.ts` (196 LOC), `tools/register-all.ts` (44 LOC), `tools/get_vaultpilot_config_status.ts` (253 LOC), `tools/get_portfolio_summary.ts` (500 LOC selectively), `config/env.ts` (274 LOC), `demo/solana-persona.ts` (137 LOC), `demo/state.ts` (128 LOC selectively), `tokens/solana-top-50.ts` (94 LOC), `tokens/solana-top-50.json` (sample), `pricing/defillama.ts` (full).

**Pattern extraction date:** 2026-05-20.
