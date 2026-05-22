# Phase 26: LTC scaffolding + LiFi BTC→EVM/Solana bridging — Research

**Researched:** 2026-05-22
**Domain:** Litecoin UTXO chain + LiFi cross-chain bridge HTTP API
**Confidence:** HIGH (LTC scaffold), HIGH (LiFi BTC support confirmed live), MEDIUM (Inv#6b decode shape)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
*(CONTEXT.md is a placeholder — no formally locked decisions were gathered via `/gsd-discuss-phase 26`. All anchor candidates below are treated as planner discretion unless the user confirms.)*

Anchor candidates from CONTEXT.md (UNCONFIRMED — treat as planner discretion):
- Ledger LTC pairing: Ledger BTC app with `currency: "litecoin"` (BtcOld legacy APDU path) — researcher VERIFIED this is the correct path (see Topic 3)
- LTC derivation: BIP-44 m/44'/2'/0' (L-prefix legacy) + BIP-84 m/84'/2'/0' (ltc1q segwit); Phase 26 pairs BOTH at first-pair time mirroring Phase 22 BTC dual-derivation
- LTC Esplora endpoint: litecoinspace.org; `LITECOIN_ESPLORA_URL` env override; VERIFIED as Esplora-compatible except fee-estimates endpoint (see Topic 4 — PITFALL)
- PAIR-NEV-* schema reuse: zero schema change; `chain: "litecoin"` record key
- LTC fingerprint domain tag: `"VaultPilot-ltctx-v1:"` distinct from BTC's `"VaultPilot-btctx-v1:"`
- LiFi BTC-from support: VERIFIED live — BTC chain ID `20000000000001`, token address `"bitcoin"`, routes via NearIntents / Chainflip / Symbiosis etc.
- BTC → Solana cross-chain: VERIFIED live — 1 connection confirmed via `/v1/connections` API

### Claude's Discretion
- Internal helper names (`LtcEsploraClient`, `LifiBtcDecoder`, etc.)
- Whether `prepare_litecoin_native_send` and `prepare_btc_send` share a common `prepareUtxoSendInternal` helper
- Whether Fixture Y (LTC native send) literal anchor lands in Phase 26 or splits to Phase 27

### Deferred Ideas (OUT OF SCOPE)
- LTC PSBT multisig
- LTC BIP-322 message signing
- Bitcoin/Litecoin Core RPC forensic reads (Phase 27)
- `build_incident_report` (Phase 27)
- LTC LiFi bridging (LTC → EVM) — LiFi LTC support is sparse; defer
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LTC-PAIR-01 | `pair_litecoin_ledger()` opens Ledger BTC app in LTC mode; returns L-prefix AND ltc1q addresses; PAIR-NEV-* `chain: "litecoin"` record key | Topics 3, 5 — `currency: "litecoin"` routes to BtcOld; dual-address VERIFY-ON-DEVICE block mirrors Phase 22 pattern |
| LTC-READ-01 | `get_litecoin_balance({ wallet })` returns litoshi + LTC-formatted balance via litecoinspace.org | Topic 4 — API is Esplora-compatible; `src/chains/litecoin/esplora-client.ts` clones BTC client with LTC-specific endpoint |
| LTC-READ-02 | `get_litecoin_tx_history` + `get_litecoin_fee_estimates` mirror BTC equivalents against litecoinspace.org | Topic 4 — fee-estimates endpoint DIFFERS from BTC; use `/api/v1/fees/recommended` not `/fee-estimates` |
| LTC-W-01 | `prepare_litecoin_native_send({ to, litoshi })` PSBT-based shape; `payloadFingerprint` with `"VaultPilot-ltctx-v1:"` domain tag | Topic 5 — btc-sighash.ts reusable; LTC PSBT needs `network: ltcNetwork` in bitcoinjs-lib (no built-in LTC network) |
| LTC-W-02 | `sign_message_ltc({ wallet, message })` BIP-137 with LTC magic bytes `"\x19Litecoin Signed Message:\n"` | Topic 5 — magic bytes are 26 bytes vs BTC's 25 bytes; otherwise identical double-SHA256 construction |
| BTC-LIFI-01 | `prepare_btc_lifi_swap({ fromToken: "BTC", toChain, toToken, amount, toAddress })` LiFi-routed bridge; BTC→EVM and BTC→Solana; Inv#6b `decodedFinalRecipient == userSuppliedToAddress` | Topics 1, 2, 6 — BTC supported; response is PSBT-in-data field; decodedFinalRecipient = `quote.action.toAddress` round-trip assert |
</phase_requirements>

---

## Summary

### LiFi BTC-as-source: CONFIRMED LIVE

LiFi supports BTC as a source chain as of 2026-05-22. The BTC chain is enumerated with chain ID `20000000000001` and token address `"bitcoin"` via `GET /v1/chains?chainTypes=UTXO`. BTC → EVM and BTC → Solana routes are both available (confirmed via `/v1/connections` and a live `/v1/quote` call). The response structure is fundamentally different from EVM-source routes: `transactionRequest.data` is a **PSBT hex** (starts with `70736274ff` = `psbt\xff`), not EVM calldata. The PSBT structure contains the bridge deposit address as `transactionRequest.to`, the amount as `transactionRequest.value` (in satoshi), and an OP_RETURN output with a binary LiFi tracking memo. The final recipient address is encoded in the quote's `action.toAddress` field — NOT derivable from the PSBT alone.

**There is no pre-existing `src/clients/lifi.ts` shelf.** Phase 20's LiFi plan was deferred to v2.2.x; Phase 16's was never executed. Phase 26 builds the LiFi HTTP client from scratch.

### LTC Scaffolding: Clean Clone of BTC Phase 22

The Ledger `@ledgerhq/hw-app-btc` package supports LTC via `currency: "litecoin"` constructor argument, which routes to the `BtcOld` (legacy APDU) path. The litecoinspace.org API is Esplora-compatible for address/UTXO/txs endpoints but uses `mempool.space`-style fee endpoints (`/api/v1/fees/recommended`) not the blockstream Esplora `/fee-estimates` shape. This is the one structural difference from the BTC `esplora-client.ts`. bitcoinjs-lib has no built-in LTC network object; Phase 26 must define `LTC_NETWORK` at module scope in `src/chains/litecoin/types.ts`.

### Fingerprint / Sighash Sharing Decision

BTC and LTC use identical sighash algorithms (BIP-143 for segwit, BIP-341 for taproot key-spend). The only divergences are the domain tag string and the bitcoinjs-lib network object. **A shared `utxo-fingerprint.ts` is NOT warranted**: the existing `btc-fingerprint.ts` exports a single function and constant — there is nothing to share except the keccak primitive already imported from `viem`. The LTC module is a 90-line clone with two changed constants. Keep them separate per the project's "Phase 6 distinct-prepare-tool convention."

**Primary recommendation:** Build `src/clients/lifi.ts` as a new NEVER-throws HTTP client wrapping the LiFi `/v1/quote` REST endpoint directly (no SDK). Use the `@lifi/sdk` HTTP API layer only as reference for request shape. Clone `src/chains/litecoin/` from `src/chains/bitcoin/` with the `fee-estimates` endpoint swapped to `/api/v1/fees/recommended`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| LTC pairing (USB-HID) | API / Backend (MCP server) | — | USB-HID Ledger transport lives entirely server-side; same as BTC Phase 22 |
| LTC balance / UTXO reads | API / Backend (MCP server) | litecoinspace.org (external) | Esplora HTTP fetch; no client-side state |
| LTC fee estimates | API / Backend (MCP server) | litecoinspace.org (external) | Different endpoint shape from BTC (see Topic 4) |
| LTC PSBT construction + fingerprint | API / Backend (MCP server) | — | Pure server-side UTXO + signing math; bitcoinjs-lib + custom ltcNetwork |
| LTC message signing | API / Backend (MCP server) | Ledger device | Magic bytes applied server-side; device signs via APDU |
| LiFi quote fetch | API / Backend (MCP server) | li.quest HTTP API (external) | REST GET; server constructs PSBT handle |
| Inv#6b final-recipient assert | API / Backend (MCP server) | — | Round-trip equality check at prepare time (quote.action.toAddress == input.toAddress) |
| BTC PSBT construction (LiFi-side) | API / Backend (MCP server) | — | `transactionRequest.data` IS the PSBT hex — server decodes and validates output set |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@ledgerhq/hw-app-btc` | `^10.22.1` | LTC signing via BTC app (`currency: "litecoin"`) | Already installed (Phase 22); `BtcOld` legacy APDU path handles LTC |
| `bitcoinjs-lib` | `^7.0.1` | LTC PSBT construction + address validation | Already installed (Phase 22-25); needs custom `LTC_NETWORK` object |
| `@noble/hashes` | (via viem) | `sha256` for BIP-137 LTC message hash | Already in repo (Phase 24 BIP-137 BTC signing) |
| `viem` | (existing) | `keccak256` + `concat` + `toBytes` for `payloadFingerprint` | Already installed; same as `btc-fingerprint.ts` |

**No new package installs required for the LTC scaffold.** All dependencies are already present.

### Supporting (LiFi only — NEW install)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| *(none — raw HTTP)* | — | LiFi quote calls go via native `fetch` | HTTP-only; no SDK needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw HTTP `fetch` for LiFi | `@lifi/sdk` v3.16.3 | SDK brings 13 dependencies (Solana, SUI, bitcoin, bech32, bigmi/core); adds ~35 packages for a simple GET quote; overkill for a NEVER-throws client wrapper. SDK's UTXO execution layer assumes it controls signing — this project's Ledger-device flow is incompatible with `UTXO.executeRoute()`. Skip the SDK. |
| Separate `ltc-fingerprint.ts` | Shared `utxo-fingerprint.ts` | Only divergence is domain tag + network; 90 lines total — sharing saves nothing. `btc-fingerprint.ts` stays frozen per Phase 23 FROZEN-area discipline. |

**Installation (LTC scaffold — nothing new):**
```bash
# No new installs. All dependencies already in package.json.
```

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@lifi/sdk` | npm | ~3 yrs | ~50K/wk [ASSUMED] | github.com/lifinance/sdk | [OK] | Approved (not installed — raw HTTP used instead) |
| `@lifi/types` | npm | ~3 yrs | bundled with SDK | github.com/lifinance/types | [OK] | Approved (used for type reference only — not installed) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**New installs this phase:** none — all dependencies already present in `package.json`

---

## Architecture Patterns

### System Architecture Diagram

```
Agent calls prepare_btc_lifi_swap({ fromToken: "BTC", toChain, toToken, amount, toAddress })
  │
  ▼
src/clients/lifi.ts — fetchBtcLifiQuote(params) → never-throws 5-arm union
  │  GET https://li.quest/v1/quote?fromChain=BTC&fromToken=bitcoin&...
  ▼
LiFi API (li.quest)
  │  returns { action: { toAddress }, transactionRequest: { to, data (PSBT hex), value } }
  ▼
src/tools/prepare_btc_lifi_swap.ts
  ├── Inv#6b: assert quote.action.toAddress.toLowerCase() === params.toAddress.toLowerCase()
  ├── Decode PSBT hex from transactionRequest.data
  ├── Extract outputs: vault-deposit-output + OP_RETURN-output + change-output
  ├── Compute payloadFingerprint = keccak256("VaultPilot-btclifi-v1:" ‖ PSBT_bytes)
  ├── Create handle: { type: "btc-lifi", psbtHex, vaultAddress, amountSats, toAddress, toChain, toToken }
  └── Return: { handle, psbtHex, vaultAddress, amountSats, toAddress, toChain, toToken, prepareReceipt }

User calls preview_send({ handle })
  ├── Decode PSBT for human-readable display (outputs summary)
  ├── Emit LEDGER BLIND-SIGN HASH block (sighashes for PSBT inputs)
  └── Mint previewToken

User calls send_transaction({ handle, previewToken, userDecision: "send" })
  ├── Three-gate: previewToken + userDecision + payloadFingerprint drift
  └── Broadcast via Esplora POST /tx (same broadcastTx() as prepare_btc_send)
```

```
Agent calls pair_litecoin_ledger()
  │
  ▼
src/wallet/ledger-btc-transport.ts — buildLtcApp(transport) → new BtcApp({ currency: "litecoin" })
  │  [Uses BtcOld legacy APDU path]
  ▼
getWalletPublicKey("m/44'/2'/0'/0/0", { format: "legacy" })   → L-prefix address
getWalletPublicKey("m/84'/2'/0'/0/0", { format: "bech32" })    → ltc1q address
  │
  ▼
non-evm-account-store.ts — saveAccount({ chain: "litecoin", address, derivationPath, pairedAt })
  [Two records, same as BTC dual-record pattern]
```

### Recommended Project Structure
```
src/
├── chains/
│   ├── bitcoin/           # Phase 22-25 (existing)
│   └── litecoin/          # NEW — Phase 26
│       ├── esplora-client.ts  # Clone of bitcoin/esplora-client.ts; fee endpoint differs
│       ├── registry.ts        # Clone of bitcoin/registry.ts; LITECOIN_ESPLORA_URL env
│       └── types.ts           # LTC_NETWORK const + address validation helpers
├── clients/
│   └── lifi.ts            # NEW — Phase 26; never-throws LiFi quote HTTP client
├── signing/
│   ├── btc-fingerprint.ts # Phase 23 (FROZEN — zero-diff)
│   ├── btc-sighash.ts     # Phase 23 (FROZEN — zero-diff)
│   ├── ltc-fingerprint.ts # NEW — Phase 26; clone with FINGERPRINT_DOMAIN_TAG_LTC
│   └── blocks-btc.ts      # Phase 23/24 (APPEND-ONLY for LTC templates)
├── protocols/
│   └── bridge-decoders/
│       └── lifi-btc.ts    # NEW — Phase 26; PSBT output extraction + Inv#6b assertion
└── tools/
    ├── pair_litecoin_ledger.ts        # NEW
    ├── get_litecoin_balance.ts        # NEW
    ├── get_litecoin_tx_history.ts     # NEW
    ├── get_litecoin_fee_estimates.ts  # NEW
    ├── prepare_litecoin_native_send.ts # NEW
    ├── sign_message_ltc.ts            # NEW
    └── prepare_btc_lifi_swap.ts       # NEW
```

### Pattern 1: LTC Esplora Client — Fee-Estimates Divergence from BTC

**What:** litecoinspace.org uses mempool.space-style fee endpoints, not blockstream Esplora's `/fee-estimates`. The address/UTXO/txs endpoints ARE identical.

**When to use:** `get_litecoin_fee_estimates` must call `/api/v1/fees/recommended` and map `{ fastestFee, halfHourFee, hourFee, economyFee, minimumFee }` → the standard 5-target projection shape. [VERIFIED: live API test 2026-05-22]

```typescript
// Source: Live litecoinspace.org API test 2026-05-22
// GET https://litecoinspace.org/api/v1/fees/recommended
// Response: {"fastestFee":1,"halfHourFee":1,"hourFee":1,"economyFee":1,"minimumFee":1}
// Mapping to standard BTC fee-estimates shape:
const estimates: Record<string, number> = {
  "1":   result.fastestFee,
  "2":   result.halfHourFee,
  "3":   result.hourFee,
  "6":   result.economyFee,
  "144": result.minimumFee,
};
```

### Pattern 2: LTC bitcoinjs-lib Network Object (Required — NOT built-in)

**What:** bitcoinjs-lib@7 has NO built-in `networks.litecoin`. Must define custom network object.

**When to use:** Every `bitcoinjs-lib` operation on LTC addresses/PSBTs (address encoding, P2WPKH script derivation, PSBT construction) requires `network: LTC_NETWORK`. [VERIFIED: `node -e "const {networks} = require('bitcoinjs-lib'); console.log(networks.litecoin)"` → undefined]

```typescript
// Source: LTC source code (chainparams.cpp) + SLIP-0044 coin_type=2 + BIP-84
// Defined in src/chains/litecoin/types.ts
import type { Network } from "bitcoinjs-lib";

export const LTC_NETWORK: Network = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: {
    public:  0x019da462, // Litecoin mainnet xpub version
    private: 0x019d9cfe, // Litecoin mainnet xprv version
  },
  pubKeyHash: 0x30,  // 48 — L-prefix addresses
  scriptHash: 0x32,  // 50 — M-prefix addresses
  wif:        0xb0,  // 176
};
```

### Pattern 3: Ledger BTC App LTC Mode — `currency: "litecoin"` Routes to BtcOld

**What:** `new BtcApp({ transport, currency: "litecoin" })` selects the `BtcOld` legacy APDU path. The `BtcNew` (app-bitcoin-new) path only handles `"bitcoin"` / `"bitcoin_testnet"` / `"bitcoin_regtest"` / `"qtum"`. [VERIFIED: `@ledgerhq/hw-app-btc/lib/Btc.js` switch statement, line confirmed in node_modules]

**When to use:** `pair_litecoin_ledger` and all LTC signing operations.

```typescript
// Source: @ledgerhq/hw-app-btc/lib/Btc.js switch(currency) — repo node_modules
// The _transport spy-affordance needs a buildLtcApp sibling OR a currency param:
export const _transport = {
  // ...existing BTC entries...
  buildLtcApp: (t: unknown): any => new BtcApp({ transport: t, currency: "litecoin" }),
};
// LTC uses format: "legacy" for m/44'/2'/0'/0/0 → L-prefix
// LTC uses format: "bech32" for m/84'/2'/0'/0/0  → ltc1q prefix
```

**CRITICAL: `getAppConfiguration()` gate.** When Litecoin app is open (NOT Bitcoin app), calling `getWalletPublicKey` silently returns LTC addresses even with `currency: "litecoin"` — the `buildLtcApp` call initializes correctly but the APDU table overlaps. The `pair_litecoin_ledger` tool must call `getAppConfiguration()` and assert the active app name is `"Litecoin"` (not `"Bitcoin"`). Map wrong-app to a `LedgerLtcAppNotOpenError` distinct from `LedgerBtcAppNotOpenError`. [ASSUMED: exact app name returned by `getAppConfiguration()` for the Ledger Litecoin app — verify at execute time against real device]

### Pattern 4: LiFi BTC Quote — PSBT-in-data Field

**What:** For BTC-as-source, LiFi's `/v1/quote` returns a PSBT as `transactionRequest.data` (hex string starting with `70736274ff`), `transactionRequest.to` is the bridge vault address, and `transactionRequest.value` is satoshi amount. The EVM calldata shape does NOT apply. [VERIFIED: live API call 2026-05-22]

```typescript
// Source: Live LiFi API test 2026-05-22 — https://li.quest/v1/quote
// fromChain=BTC (chainId 20000000000001), fromToken=bitcoin
// transactionRequest shape for BTC source:
interface BtcLifiTransactionRequest {
  to: string;       // Bridge vault BTC address (deposit destination)
  data: string;     // PSBT hex (starts with "70736274ff" = psbt magic bytes)
  value: string;    // Satoshi amount as string (NOT BigInt — LiFi returns string)
}
// action.toAddress: destination address on the target chain
// The PSBT MUST be passed through verbatim to the Ledger for signing —
// do NOT re-construct it. The output order is load-bearing.
```

### Pattern 5: Inv#6b for BTC-LIFI (decodedFinalRecipient Assertion)

**What:** For BTC-source bridges via LiFi, the "decoded final recipient" is `quote.action.toAddress` from the API response. The toAddress is NOT embedded in a readable form inside the PSBT's OP_RETURN (the OP_RETURN is a binary tracking ID, not a human-readable address). The Inv#6b assertion is therefore a **round-trip equality check**: the `toAddress` the user supplied must equal `quote.action.toAddress` returned by LiFi. [VERIFIED: live API analysis 2026-05-22 — OP_RETURN decoded to `=|lifi\x{binary}`, no EVM/SOL address present in PSBT data]

```typescript
// Source: Research analysis of live LiFi BTC PSBT response 2026-05-22
// Inv#6b for BTC-LIFI-01:
if (quote.action.toAddress?.toLowerCase() !== params.toAddress.toLowerCase()) {
  return makeStructuredError(
    "RECIPIENT_MISMATCH",
    `LiFi returned toAddress=${quote.action.toAddress} but you supplied toAddress=${params.toAddress}`,
  );
}
// decodedFinalRecipient for the PREPARE RECEIPT block:
const decodedFinalRecipient = quote.action.toAddress;
```

### Anti-Patterns to Avoid

- **Don't reuse `btc-fingerprint.ts` for LTC:** The domain tag `"VaultPilot-btctx-v1:"` is hardcoded. LTC fingerprints MUST use `"VaultPilot-ltctx-v1:"` in a separate `ltc-fingerprint.ts`. Cross-chain fingerprint reuse is the threat being prevented.
- **Don't use `/fee-estimates` with litecoinspace.org:** This endpoint returns HTTP 404. Use `/api/v1/fees/recommended` and map the response.
- **Don't modify the LiFi PSBT data:** The output order in the PSBT is load-bearing (Chainflip has no manual recovery if outputs are altered). Pass through verbatim.
- **Don't attempt to decode the OP_RETURN as a human-readable address:** The OP_RETURN in LiFi BTC PSBTs is a binary tracking memo, not an address. The final recipient is in `quote.action.toAddress`.
- **Don't install `@lifi/sdk`:** The SDK brings 13+ dependencies (Solana, SUI, NEAR, bitcoin) and assumes it controls the wallet. Raw `fetch` to `https://li.quest/v1/quote` is sufficient and already how the project handles all other HTTP clients.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LTC address validation (L-prefix, M-prefix, ltc1q) | Custom regex/prefix check | `bitcoinjs-lib.address.toOutputScript(addr, LTC_NETWORK)` throws on invalid | Same pattern as BTC address validation (`assertBtcSegwitAddress` via output-script conversion) |
| LTC BIP-143 sighash computation | Custom sighash math | `bitcoinjs-lib.Transaction.hashForWitnessV0()` with `LTC_NETWORK` | Already used for BTC in `btc-sighash.ts`; LTC is identical algorithm |
| LTC PSBT construction | Custom serialization | `bitcoinjs-lib.Psbt` with `{ network: LTC_NETWORK }` | Same as BTC; `LTC_NETWORK` is the only delta |
| LiFi route discovery | Custom bridge aggregation | LiFi `/v1/quote` REST API | LiFi aggregates NearIntents / Chainflip / Relay / Symbiosis / etc. already |

**Key insight:** The LTC scaffold is a near-verbatim clone of the BTC scaffold. The only material differences are network bytes, derivation path coin_type, magic bytes, and the fee-estimates endpoint shape. Code reuse via clone-and-modify is explicitly preferred over abstraction (Phase 6 convention).

---

## Common Pitfalls

### Pitfall 1: litecoinspace.org `/fee-estimates` Returns 404

**What goes wrong:** Copying `src/chains/bitcoin/esplora-client.ts` verbatim and calling `GET /fee-estimates` against litecoinspace.org returns HTTP 404 ("endpoint does not exist '/fee-estimates'").

**Why it happens:** litecoinspace.org is a `mempool.space` fork, not a blockstream Esplora deployment. Mempool.space exposes fee data at `/api/v1/fees/recommended` (JSON with `fastestFee`, `halfHourFee`, etc.) not at `/fee-estimates`.

**How to avoid:** In `src/chains/litecoin/esplora-client.ts`, the fee-estimates function calls `${baseUrl}/v1/fees/recommended` and maps the mempool.space response shape to the standard 5-target object. [VERIFIED: live API test 2026-05-22]

**Warning signs:** HTTP 404 from fee-estimates endpoint; "endpoint does not exist" in error body.

---

### Pitfall 2: LTC Address Validation — "L" is NOT a universal LTC prefix

**What goes wrong:** Legacy LTC P2PKH addresses start with `L` (version byte 0x30). However, `bitcoinjs-lib` with the BTC network (`pubKeyHash: 0x00`) cannot validate L-addresses — it will throw. Using the wrong network object produces silent address format corruption.

**Why it happens:** `LTC_NETWORK` must be passed to every `bitcoinjs-lib` call that touches addresses. Missing the `network` parameter defaults to Bitcoin mainnet (`pubKeyHash: 0x00` → produces `1xxx` addresses).

**How to avoid:** Define `LTC_NETWORK` as a module-scope const in `src/chains/litecoin/types.ts`. Every address assertion, PSBT init, and script derivation must pass `{ network: LTC_NETWORK }`.

**Warning signs:** `address.toOutputScript()` throws "Invalid version byte"; PSBT serialization produces `bc1q` instead of `ltc1q` addresses.

---

### Pitfall 3: Ledger BTC App vs Litecoin App — APDU Table Overlap

**What goes wrong:** The Ledger Bitcoin app and the Ledger Litecoin app use overlapping APDU command codes. If the Litecoin app is open when `pair_btc_ledger` is called, `getWalletPublicKey` silently returns LTC addresses with L/ltc1q prefixes. The existing `getAppConfiguration()` BTC-app gate (RESEARCH Pitfall 2, Phase 22) prevents this. The inverse is also true: if `pair_litecoin_ledger` is called with the BTC app open, it will return BTC addresses.

**Why it happens:** Both apps share the same APDU command set (the Ledger BTC app was designed to support BTC forks).

**How to avoid:** `pair_litecoin_ledger` must call `getAppConfiguration()` and check for the Litecoin app name. The exact app name string returned by `getAppConfiguration().name` for the Ledger Litecoin app is `"Litecoin"` [ASSUMED — verify against real device at execute time]. Map wrong app → `LedgerLtcAppNotOpenError` (new error class, mirrors `LedgerBtcAppNotOpenError`).

**Warning signs:** `pair_litecoin_ledger()` returns `bc1q`/`bc1p` addresses instead of `L`/`ltc1q` addresses.

---

### Pitfall 4: LiFi BTC Quote `fromAddress` Format

**What goes wrong:** Passing an xpub or semicolon-separated list as `fromAddress` when the user has already paired a single address causes the error `"Invalid extended address. Only UTXO chains support multiple addresses."` (HTTP 400, code 1011). [VERIFIED: live API test 2026-05-22]

**Why it happens:** LiFi has a specific parser for UTXO `fromAddress`. A single bech32 segwit address (e.g., `bc1q…`) passes correctly when properly URL-encoded. The validator rejects xpub-style strings for the STANDARD quote endpoint (xpub support exists but must be used intentionally).

**How to avoid:** `src/clients/lifi.ts` always passes the user's paired BTC address (single `bc1q…` or `bc1p…` address from non-evm-account-store). Do NOT pass xpubs or semicolon lists in Phase 26.

**Warning signs:** HTTP 400 with `"Invalid extended address"` message in response body.

---

### Pitfall 5: LTC BIP-137 Magic Bytes Are NOT the Same as BTC

**What goes wrong:** Copying `sign_message_btc.ts` verbatim produces BTC-format message hashes for LTC, making LTC signature verification fail on LTC blockchain explorers and wallets.

**Why it happens:** BTC magic: `"\x18Bitcoin Signed Message:\n"` (25 bytes total). LTC magic: `"\x19Litecoin Signed Message:\n"` (26 bytes total). The varint prefix byte differs (`0x18` vs `0x19`).

**How to avoid:** `sign_message_ltc.ts` exports `LTC_MAGIC_BYTES_HEX` and uses it in the server-side hash computation. Tests pin the hash literal for "Hello VaultPilot" under LTC magic. [VERIFIED: computed locally 2026-05-22]

**Warning signs:** LTC signature verifies as a BTC signature; `signatureBase64` rejected by Litecoin explorers.

---

### Pitfall 6: LiFi PSBT Output Order is Load-Bearing

**What goes wrong:** Re-constructing or reordering the PSBT outputs before passing to the Ledger causes fund loss. Some bridges (Chainflip) have no manual recovery if the memo OP_RETURN output is missing or reordered.

**Why it happens:** The LiFi PSBT data is a complete, ready-to-sign transaction. VaultPilot's role is to sign inputs, not to modify outputs.

**How to avoid:** `prepare_btc_lifi_swap` passes through `transactionRequest.data` (the PSBT hex) to the handle store verbatim. The tool decodes it only for display (output count, vault address, amount, OP_RETURN presence check), never for reconstruction. The PREPARE RECEIPT block includes the verbatim `transactionRequest.data` truncated to 80 chars + `"...[full PSBT]"`.

**Warning signs:** Any code that constructs a new `Psbt()` from the LiFi-returned data rather than passing it through.

---

## Code Examples

### LTC Network Object (bitcoinjs-lib)
```typescript
// Source: LTC chainparams.cpp + SLIP-0044 + BIP-84 — verified via bitcoinjs-lib node test
// src/chains/litecoin/types.ts
import { initEccLib } from "bitcoinjs-lib";
import { Network } from "bitcoinjs-lib";
import * as tinySecp256k1 from "tiny-secp256k1";

initEccLib(tinySecp256k1);

export const LTC_NETWORK: Network = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

export function assertLtcSegwitAddress(address: string): void {
  const { address: toOutputScript } = require("bitcoinjs-lib");
  toOutputScript(address, LTC_NETWORK); // throws on invalid
}
```

### LiFi BTC Quote Request
```typescript
// Source: Live API test 2026-05-22 — https://li.quest/v1/quote
// fromToken must be "bitcoin" (NOT "BTC") when using BTC key; chainId 20000000000001
const url = new URL("https://li.quest/v1/quote");
url.searchParams.set("fromChain", "BTC");      // or "20000000000001"
url.searchParams.set("fromToken", "bitcoin");  // NOT "BTC"
url.searchParams.set("fromAddress", btcAddress);
url.searchParams.set("fromAmount", amountSatoshi.toString());
url.searchParams.set("toChain", toChain);      // "ETH", "ARB", "POL", "SOL", etc.
url.searchParams.set("toToken", toToken);
url.searchParams.set("toAddress", toAddress);
url.searchParams.set("integrator", "vaultpilot-mcp");
// Response: LiFiStep with transactionRequest.data = PSBT hex
```

### LTC Fee Estimates Endpoint
```typescript
// Source: Live litecoinspace.org API test 2026-05-22
// GET https://litecoinspace.org/api/v1/fees/recommended
// Returns: { fastestFee: number, halfHourFee: number, hourFee: number,
//            economyFee: number, minimumFee: number }
// Map to standard 5-target shape:
function mapLtcFees(body: LtcFeesBody): Record<string, number> {
  return {
    "1":   body.fastestFee,
    "2":   body.halfHourFee,
    "3":   body.hourFee,
    "6":   body.economyFee,
    "144": body.minimumFee,
  };
}
```

### LTC Fingerprint Module
```typescript
// Source: btc-fingerprint.ts clone — only constant changes
// src/signing/ltc-fingerprint.ts
import { concat, keccak256, toBytes } from "viem";
import type { Hex } from "viem";

export const FINGERPRINT_DOMAIN_TAG_LTC = "VaultPilot-ltctx-v1:";

export function computeLtcPayloadFingerprint(
  perInputSighashes: readonly Uint8Array[],
): Hex {
  // Same logic as computeBtcPayloadFingerprint; domain tag is the only delta
  const preimage = concat([toBytes(FINGERPRINT_DOMAIN_TAG_LTC), ...perInputSighashes]);
  return keccak256(preimage);
}
export const _ltcFingerprint = { computeLtcPayloadFingerprint };
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LiFi TRON-W-11 plan (v2.1) | Deferred to v2.2.x | 2026-05-20 (Phase 20 D-04b) | BTC-LIFI-01 (Phase 26) is the first live LiFi client; no existing code to extend |
| Phase 16 LiFi EVM↔Solana plan (v2.0) | Never executed — context-only | 2026-05-20 | Same as above; Phase 26 builds from scratch |
| `src/clients/lifi.ts` "shared shelf" (CONTEXT.md claim) | Does not exist | — | **False premise corrected** — Phase 26 creates it |
| LiFi EVM quote response shape | BTC quote response adds PSBT-in-data | BTC UTXO support added to LiFi in 2025 | BTC-source transactions require PSBT signing, not EVM calldata signing |

**Deprecated/outdated:**
- CONTEXT.md claim "Phase 26 extends `src/clients/lifi.ts`": WRONG — file does not exist. Phase 26 creates it.
- CONTEXT.md reference to "Plan 16-01 if factored at v2.0": Plan 16-01 was never executed. No LiFi shelf was ever factored.

---

## Runtime State Inventory

> Phase 26 adds new tools and a new client. No rename/refactor/migration involved.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | non-evm-accounts.json gains `chain: "litecoin"` entries; no schema migration needed (chain key is freeform string) | none — additive |
| Live service config | None relevant | none |
| OS-registered state | None relevant | none |
| Secrets/env vars | `LITECOIN_ESPLORA_URL` (new env var, optional override) — no existing keys affected | document in env README |
| Build artifacts | None — Phase 26 adds new source files only | none |

**Nothing found requiring data migration.** All changes are additive.

---

## Open Questions

1. **LiFi BTC `fromToken` parameter: `"bitcoin"` vs `"BTC"` vs token address**
   - What we know: Live API test with `fromToken=bitcoin` + `fromChain=BTC` succeeded. Token address per `/v1/tokens` is `"bitcoin"` (not a hex address).
   - What's unclear: Whether `fromToken=BTC` (the symbol) also works — only tested `"bitcoin"` (the token address key). The token address form is more stable since symbols can collide.
   - Recommendation: Use `fromToken=bitcoin` (token address form, not symbol). Lock this in `lifi.ts`.

2. **Ledger Litecoin app name from `getAppConfiguration()`**
   - What we know: The BTC app returns a name (used in the Phase 22 gate) that must NOT be `"Bitcoin"` for `pair_litecoin_ledger`'s inverse gate. LiFi docs and Ledger device docs both imply the Litecoin app is distinct.
   - What's unclear: The exact string `getAppConfiguration().name` returns for the Litecoin app — could be `"Litecoin"`, `"LTC"`, or something else.
   - Recommendation: At execute time, call `getAppConfiguration()` with a real Ledger + Litecoin app to confirm. Add a regression test that pins the observed string. Tag as ASSUMED until verified.

3. **LiFi quote rate limiting — does it need an API key for production use?**
   - What we know: Rate limit header shows `ratelimit-limit: 75` per request. No auth header required for unauthenticated requests.
   - What's unclear: Whether rate limits are per-IP or per-key; whether `integrator` parameter affects limits.
   - Recommendation: Pass `integrator: "vaultpilot-mcp"` per LiFi SDK convention. Document rate limit in `lifi.ts` comments. No API key in Phase 26 scope.

4. **BTC LiFi `payloadFingerprint` domain tag**
   - What we know: BTC native send uses `"VaultPilot-btctx-v1:"`. LTC native send uses `"VaultPilot-ltctx-v1:"`.
   - What's unclear: The right domain tag for BTC LiFi bridge transactions. Since the PSBT structure is different (LiFi-constructed, not VaultPilot-constructed), a distinct `"VaultPilot-btclifi-v1:"` tag is cleaner.
   - Recommendation: Use `"VaultPilot-btclifi-v1:"` as the domain tag for `prepare_btc_lifi_swap` fingerprints. Keeps LiFi-source PSBTs cryptographically distinct from user-constructed PSBTs.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@ledgerhq/hw-app-btc` | LTC pairing | ✓ | 10.22.1 (node_modules) | — |
| `bitcoinjs-lib` | LTC PSBT + address | ✓ | 7.0.1 (node_modules) | — |
| `@noble/hashes` | LTC message hash | ✓ | via viem (node_modules) | — |
| litecoinspace.org API | LTC reads | ✓ | Live (tested 2026-05-22) | User-configurable `LITECOIN_ESPLORA_URL` env override |
| LiFi API (li.quest) | BTC bridge | ✓ | Live (tested 2026-05-22) | None — BTC-LIFI-01 requires live LiFi API |
| native `fetch` | `src/clients/lifi.ts` | ✓ | Node ≥ 18.17 built-in | — |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** none

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npm test -- --run` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LTC-PAIR-01 | `pair_litecoin_ledger` returns dual addresses + saves two PAIR-NEV-* records | unit (mock transport) | `npm test -- --run test/pair-litecoin-ledger.test.ts` | ❌ Wave 0 |
| LTC-READ-01 | `get_litecoin_balance` returns litoshi + LTC formatted balance | unit (fetch stub) | `npm test -- --run test/get-litecoin-balance.test.ts` | ❌ Wave 0 |
| LTC-READ-02 | `get_litecoin_fee_estimates` maps mempool.space format correctly | unit (fetch stub) | `npm test -- --run test/get-litecoin-fee-estimates.test.ts` | ❌ Wave 0 |
| LTC-W-01 | `prepare_litecoin_native_send` PSBT fingerprint uses `"VaultPilot-ltctx-v1:"` domain tag | unit (Fixture Y literal anchor) | `npm test -- --run test/signing-fingerprint.test.ts` | ✅ (extend existing) |
| LTC-W-01 | `prepare_litecoin_native_send` end-to-end prepare→preview→send | integration | `npm test -- --run test/ltc-trust-pipeline.integration.test.ts` | ❌ Wave 0 |
| LTC-W-02 | `sign_message_ltc` message hash uses LTC magic bytes (NOT BTC) | unit (Fixture Z literal anchor) | `npm test -- --run test/signing-bip137-ltc.test.ts` | ❌ Wave 0 |
| BTC-LIFI-01 | `prepare_btc_lifi_swap` Inv#6b refusal on toAddress mismatch | unit | `npm test -- --run test/prepare-btc-lifi-swap.test.ts` | ❌ Wave 0 |
| BTC-LIFI-01 | `prepare_btc_lifi_swap` payloadFingerprint is PSBT-bytes-based, domain `"VaultPilot-btclifi-v1:"` | unit (Fixture AA literal anchor) | `npm test -- --run test/signing-fingerprint.test.ts` | ✅ (extend existing) |

### Fixture Letter Assignments for Phase 26

Fixtures A through X are consumed by Phases 4-25. Y and Z are available:
- **Fixture Y** — LTC native segwit send payloadFingerprint (single-input P2WPKH, domain `"VaultPilot-ltctx-v1:"`)
- **Fixture Z** — LTC BIP-137 message hash for "Hello VaultPilot" under LTC magic bytes
- **Fixture AA** (or next available double-letter) — BTC LiFi PSBT payloadFingerprint (domain `"VaultPilot-btclifi-v1:"`)

> Note: CONTEXT.md referenced "Fixture R" for LTC native send, but R is already consumed by Phase 28 Compound V3 supply. Y is the correct next assignment. [VERIFIED: `grep "Fixture [A-Z]"` scan of test/ directory]

### Sampling Rate
- **Per task commit:** `npm test -- --run test/[new-test-file].test.ts`
- **Per wave merge:** `npm test -- --run` (full suite, no watch)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/pair-litecoin-ledger.test.ts` — covers LTC-PAIR-01
- [ ] `test/get-litecoin-balance.test.ts` — covers LTC-READ-01
- [ ] `test/get-litecoin-fee-estimates.test.ts` — covers LTC-READ-02 (fee endpoint shape divergence)
- [ ] `test/prepare-litecoin-native-send.test.ts` — covers LTC-W-01
- [ ] `test/ltc-trust-pipeline.integration.test.ts` — covers LTC-W-01 end-to-end
- [ ] `test/signing-bip137-ltc.test.ts` — covers LTC-W-02 (NEW sibling of signing-bip137.test.ts)
- [ ] `test/prepare-btc-lifi-swap.test.ts` — covers BTC-LIFI-01
- [ ] `test/tools-sign-message-ltc.test.ts` — consumer re-anchor for Fixture Z

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `assertLtcSegwitAddress()` at tool boundary; Zod enum on `toChain` / `toToken` for LiFi tool |
| V6 Cryptography | yes | `keccak256` (viem) for fingerprint; `sha256` (@noble/hashes) for BIP-137 message hash — never hand-rolled |

### Known Threat Patterns for UTXO + Bridge Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LTC address substitution at prepare time | Tampering | `assertLtcSegwitAddress` + Ledger VERIFY-ON-DEVICE block; user cross-checks address on device screen |
| LiFi quote `toAddress` drift (Inv#6b) | Tampering | Server-side equality assert: `quote.action.toAddress === params.toAddress` at prepare time; mismatch refuses before handle creation |
| LiFi PSBT output mutation | Tampering | PSBT passed through verbatim from LiFi response; no reconstruction; PSBT bytes pinned in `payloadFingerprint` |
| Cross-chain fingerprint reuse | Elevation of Privilege | Distinct domain tags: `"VaultPilot-btctx-v1:"` / `"VaultPilot-ltctx-v1:"` / `"VaultPilot-btclifi-v1:"` prevent cross-chain fingerprint collision |
| Wrong Ledger app open during pairing | Spoofing | `getAppConfiguration()` gate asserts app name; wrong app → `LedgerLtcAppNotOpenError` |
| LiFi API response injection | Information Disclosure | Strict response parsing (discriminated union); unexpected fields ignored; `action.toAddress` only extracted field used for Inv#6b |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Ledger `getAppConfiguration().name` for the Litecoin app is `"Litecoin"` | Pitfall 3, Pattern 3 | Wrong string → LTC-app gate fails or is bypassed; verify at execute time against real device |
| A2 | `@lifi/sdk` download count is ~50K/wk | Package Legitimacy Audit | Low — not installed; reference only |
| A3 | LiFi BTC chainId `20000000000001` is stable (not a test/staging artifact) | Standard Stack, Architecture Patterns | If chain ID changes, `lifi.ts` must update the hardcoded constant; low risk — verified via live chains endpoint |
| A4 | litecoinspace.org API endpoint base path is `/api/` (Esplora-compatible) for address/utxo/txs | Pitfall 1, Pattern 1 | Address endpoint works; fee endpoint differs. Verified for address/utxo/txs; fee endpoint verified as `/api/v1/fees/recommended` |
| A5 | BTC `"bitcoin"` (token address form) is the correct `fromToken` for LiFi BTC quotes | Open Questions #1 | If `"BTC"` symbol also works, no functional difference; if neither works, Phase 26 is blocked |

**Note:** A1 is the only assumption with meaningful execution-time risk. All other assumptions are LOW-risk or have been verified via live API.

---

## Sources

### Primary (HIGH confidence)
- Live LiFi API `GET https://li.quest/v1/chains?chainTypes=UTXO` — BTC chain ID `20000000000001` confirmed 2026-05-22
- Live LiFi API `GET https://li.quest/v1/quote?fromChain=BTC&fromToken=bitcoin&...` — PSBT-in-data confirmed 2026-05-22
- Live LiFi API `GET https://li.quest/v1/connections?fromChain=20000000000001&toChain=SOL` — BTC→SOL connection confirmed 2026-05-22
- Live litecoinspace.org `/api/address/{M-prefix}` — Esplora-compatible response shape confirmed 2026-05-22
- Live litecoinspace.org `/api/v1/fees/recommended` — mempool.space fee format confirmed 2026-05-22
- `@lifi/types` installed `node_modules` TypeScript types — `QuoteRequest`, `TransactionRequest`, `Action` shapes verified from d.ts
- `@ledgerhq/hw-app-btc/lib/Btc.js` switch statement — `currency: "litecoin"` → BtcOld confirmed from installed node_modules
- `bitcoinjs-lib` `networks.litecoin` — NOT present; custom `LTC_NETWORK` required, confirmed via `node -e` test
- `src/signing/btc-fingerprint.ts` — reviewed; LTC clone needs only domain tag change

### Secondary (MEDIUM confidence)
- docs.li.fi bitcoin-overview page — PSBT structure description (3 outputs: deposit + OP_RETURN + change)
- docs.li.fi bitcoin-tx-example page — transactionRequest shape + "output order is load-bearing" warning

### Tertiary (LOW confidence)
- LTC network parameters (bip32.public/private version bytes) — from LTC source `chainparams.cpp` interpretation; `[ASSUMED]` pending actual address round-trip test at execute time
- Ledger Litecoin app name string `"Litecoin"` — `[ASSUMED]`; must verify against real device

---

## Metadata

**Confidence breakdown:**
- LTC scaffold (PAIR/READ/W): HIGH — API verified live; code pattern is a near-verbatim clone of Phase 22-24 BTC; only material divergences are the fee-estimates endpoint and LTC network bytes
- LiFi BTC support: HIGH — confirmed live via API; PSBT structure decoded and analyzed
- Inv#6b decode shape for BTC-LIFI: MEDIUM — derived from OP_RETURN analysis (binary, no EVM address inside); design is coherent but depends on LiFi not changing the toAddress delivery mechanism
- LTC Ledger app name: LOW — Assumption A1; must verify at execute time

**Research date:** 2026-05-22
**Valid until:** 2026-06-22 (LiFi API evolves; BTC UTXO support is recent — revalidate the quote endpoint shape if planning is delayed beyond 4 weeks)
