# Phase 11: Solana scaffolding — USB-HID transport + SOL reads + persistent non-EVM account cache — Research

**Researched:** 2026-05-20
**Status:** Complete
**Confidence:** HIGH (SDK adoption, transport, RPC) · MEDIUM (curated mint registry composition) · LOW (Triton free-tier specifics — vendor opaque)

## Summary

Phase 11 adds Solana as the second chain alongside v1.x EVM. Three load-bearing decisions emerge from empirical SDK probing in `/tmp/solana-probe/`:

1. **SDK:** Adopt `@solana/web3.js` v1.98.4 (legacy line, mature, `Connection`-based ergonomic API). `@solana/kit` v6.9.0 is the rebranded `@solana/web3.js v2` line — modular, functional, slimmer, but its API shape (`createSolanaRpc(url).getBalance(addr).send()` vs `new Connection(url).getBalance(pk)`) costs an additional learning step with no v1.x-mirror payoff for read-only Phase 11. The DefiLlama-keyed `solana:<mint>` pricing client is trivial against either. **Lock at planning gate.**
2. **USB-HID transport:** `@ledgerhq/hw-transport-node-hid` v6.33.2 (extends the `-noevents` variant with `listen()` for device hotplug detection). Native deps `node-hid` (3.3.0) + `usb` (2.9.0) ship prebuilt napi binaries — `@yao-pkg/pkg` extracts `.node` files to `~/.cache/pkg/` at first run. Compatible with the existing pkg-binary pipeline.
3. **SPL discovery is the major pitfall:** Both default public RPCs (`api.mainnet-beta.solana.com` AND `solana.publicnode.com`) return `-32601 Method not found` for `getParsedTokenAccountsByOwner`. The unparsed `getTokenAccountsByOwner` with `encoding: "base64"` works on both. Phase 11 must either (a) decode `MintLayout` client-side via `@solana/spl-token`'s `MintLayout`, or (b) require a Helius/QuickNode free-tier key for parsed responses. Recommendation: (a) — keeps the zero-config public-RPC default working, matching v1.x PublicNode-fallback discipline.

**Primary recommendation:** Adopt `@solana/web3.js@1.98.4` + `@ledgerhq/hw-transport-node-hid@6.33.2` + `@ledgerhq/hw-app-solana@7.10.2` + `@solana/spl-token@0.4.14` + `bs58@5.0.0`. Mirror PR [#61](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/pull/61)'s eager-init pattern: `loadNonEvmAccounts()` BEFORE `server.connect(transport)` in `startServer()`. The `_storage` spy-affordance indirection from `src/wallet/session-manager.ts` lines 49–54 transplants verbatim to `src/wallet/non-evm-account-store.ts`. Use unparsed RPC + client-side decode for SPL discovery to preserve the zero-config default.

## § Topic 1: Solana SDK adoption decision (DF-1)

**Probed:** Installed both `@solana/web3.js@1.98.4` and `@solana/kit@6.9.0` into `/tmp/solana-probe/`. Read `dist/types/index.d.ts` from each. Wrote call sketches against the installed `.d.ts`, then typechecked with `tsc --strict --module nodenext --moduleResolution nodenext --skipLibCheck`.

### `@solana/web3.js` v1.98.4

| Property | Value |
|---|---|
| Last published | 2025-07-31 |
| Style | Imperative, class-based (`Connection` / `PublicKey` / `Transaction`) |
| Runtime deps | 15 — `bs58`, `bn.js`, `borsh`, `buffer`, `jayson`, `node-fetch@2`, `@noble/curves`, `@noble/hashes`, `agentkeepalive`, `rpc-websockets@9`, `@solana/buffer-layout`, `fast-stable-stringify`, `@solana/codecs-numbers`, `@babel/runtime`, `superstruct` |
| Native deps | none |
| Method shape | `new Connection(url).getBalance(pk)` → `Promise<number>` (lamports) |

Verbatim from `node_modules/@solana/web3.js/lib/index.d.ts:3214`:
```typescript
getBalance(publicKey: PublicKey, commitmentOrConfig?: Commitment | GetBalanceConfig): Promise<number>;
getParsedTokenAccountsByOwner(ownerAddress: PublicKey, filter: TokenAccountsFilter, commitment?: Commitment): Promise<RpcResponseAndContext<Array<{
    pubkey: PublicKey;
    account: AccountInfo<ParsedAccountData>;
}>>>;
simulateTransaction(transaction: VersionedTransaction, config?: SimulateTransactionConfig): Promise<RpcResponseAndContext<SimulatedTransactionResponse>>;
```

### `@solana/kit` v6.9.0 (≡ `@solana/web3.js v2`)

| Property | Value |
|---|---|
| Repo | [anza-xyz/kit](https://github.com/anza-xyz/kit) |
| Style | Functional, tree-shakeable (`createSolanaRpc(url).getBalance(addr).send()`) |
| Runtime deps | 25 sub-packages all at `@solana/X@6.9.0` (`@solana/rpc`, `@solana/transactions`, `@solana/codecs`, `@solana/keys`, `@solana/signers`, …) |
| Native deps | none |
| Method shape | `await createSolanaRpc(url).getBalance(addr).send()` → `{ context, value: bigint }` (lamports as `Lamports` branded bigint) |

Verbatim from `node_modules/@solana/rpc-api/dist/types/getBalance.d.ts:9`:
```typescript
getBalance(address: Address, config?: Readonly<{ commitment?: Commitment; minContextSlot?: Slot; }>): SolanaRpcResponse<Lamports>;
```

Call-sketch typechecked clean against both. The `@solana/kit` ergonomics surface a fluent `.send()` step and Lamports/Address brands that the v1.x EVM call sites have no analog for.

### Recommendation

**Adopt `@solana/web3.js@1.98.4`.** Rationale:

- **Mirrors v1.x EVM patterns.** `new Connection(url)` ↔ `createPublicClient({ chain, transport: http(url) })` is one cognitive hop. `createSolanaRpc(url).getBalance(addr).send()` is two.
- **SDK ecosystem still web3.js v1.** `@solana/spl-token@0.4.14`, `@ledgerhq/hw-app-solana@7.10.2` example docs, and every Solana program SDK currently target v1's `PublicKey` / `Transaction` types. Phase 12+ MarginFi / Kamino / Jupiter / Marinade SDKs all build on web3.js v1 today.
- **Lamports as `number` (v1) vs branded bigint (kit).** The project's decimal-string convention crosses the agent boundary; lamports as plain `number` is fine for the read-only Phase 11 surface (max SOL supply ≈ 6e8, * 1e9 lamports/SOL = 6e17, well below `Number.MAX_SAFE_INTEGER` 9.0e15 — wait, that's NOT below). **Caveat:** for wallets holding > 9 million SOL, `Connection.getBalance()`'s `number` return loses precision. The Phase 11 plan should clamp display via `lamports.toString()` (the RPC always returns bigint over the wire — `Connection` narrows it to number client-side, but raw JSON is integer-string-safe).
- **Future migration path stays open.** If a v2.x phase wants kit's functional ergonomics, the `@solana/web3.js` namespace can wrap kit underneath without breaking the call sites. Migrating the other direction (kit → web3.js v1) is harder.

**Decision lock:** Adopt `@solana/web3.js@1.98.4`. Defer `@solana/kit` to post-v2.0.

### Lamports precision caveat (recorded for Phase 12 prep)

`Connection.getBalance(): Promise<number>` narrows the wire `u64` to JS number, losing precision above ~9.0 million SOL. For Phase 11 display this is fine (we surface `balance: string` derived from the result). For Phase 12's prepare/preview/send, use `Connection.getBalanceAndContext` (also `number`) but compute amount math against the user's input decimal-string, not against the read result. **The bigger sanity net:** the Ledger device displays its own values; the trust anchor doesn't depend on MCP arithmetic.

## § Topic 2: USB-HID transport

### `@ledgerhq/hw-transport-node-hid` v6.33.2 (recommended)

Verbatim from `node_modules/@ledgerhq/hw-transport-node-hid/lib/TransportNodeHid.d.ts`:
```typescript
import TransportNodeHidNoEvents from "@ledgerhq/hw-transport-node-hid-noevents";
import type { Observer, DescriptorEvent, Subscription } from "@ledgerhq/hw-transport";
export default class TransportNodeHid extends TransportNodeHidNoEvents {
    static isSupported: () => Promise<boolean>;
    static list: () => Promise<any>;
    static setListenDevicesDebounce: (delay: number) => void;
    static setListenDevicesPollingSkip: (conditionToSkip: () => boolean) => void;
    static setListenDevicesDebug: () => void;
    static listen: (observer: Observer<DescriptorEvent<string | null | undefined>>) => Subscription;
    static open(path: string | null | undefined): Promise<TransportNodeHid>;
}
```

Runtime deps: `node-hid@2.1.2`, `usb@2.9.0`, `@ledgerhq/devices@8.14.2`, `@ledgerhq/errors@6.34.1`, `@ledgerhq/hw-transport@6.35.2`, `@ledgerhq/logs@6.17.0`, plus `lodash@^4.17.21` and `@ledgerhq/hw-transport-node-hid-noevents@^6.35.2`.

### `@ledgerhq/hw-transport-node-hid-noevents` (alternative, minimal)

Same `static open(path)` + `static list()` + `static isSupported()`, but NO `listen()` for hotplug detection. Lighter — drops `usb` (2.9.0) and `lodash`. Used internally by the full-events variant as a base class.

### Discovery pattern

**Lock decision:** use `TransportNodeHid` (full-events variant). Hotplug detection (`listen()`) lets us emit a stderr advisory when the Ledger is unplugged mid-session, mirroring v1.x WC `session_delete` listener pattern in `session-manager.ts` lines 818–831.

**Open pattern (typechecked clean):**
```typescript
import TransportNodeHidModule from "@ledgerhq/hw-transport-node-hid";
import SolanaAppModule from "@ledgerhq/hw-app-solana";

// NodeNext + ESM: Ledger packages' lib-es .d.ts exports `default` only.
// Under `esModuleInterop: true`, the typed default class lives at the
// import namespace — but TS5+ under NodeNext sometimes fails the constructor
// check. Pattern that compiles cleanly:
const TransportNodeHid = (TransportNodeHidModule as any).default ?? TransportNodeHidModule;
const SolanaApp = (SolanaAppModule as any).default ?? SolanaAppModule;

const supported = await TransportNodeHid.isSupported();
if (!supported) throw new UsbHidUnsupportedError();
const transport = await TransportNodeHid.open(null); // null = first device
const solana = new SolanaApp(transport);
const { address: addrBuffer } = await solana.getAddress("44'/501'/0'");
const cfg = await solana.getAppConfiguration();
// addrBuffer is a Buffer (32 bytes Ed25519 pubkey), NOT a base58 string
const base58Address: string = bs58.encode(addrBuffer);
await transport.close(); // ALWAYS — USB device handle leaks otherwise
```

**Critical drift between docs and types:** The Ledger Solana app's `getAddress` returns `{ address: Buffer }`, NOT a base58 string. The base58 encoding step is the caller's responsibility — use `bs58@5.0.0` (`bs58@4` has no types).

**Device-disconnect during signing:** `transport.disconnected` is a public field; once `true`, every subsequent APDU exchange throws a `DisconnectedDevice` error from `@ledgerhq/errors`. Phase 11 reads don't sign — but the pair tool must `transport.close()` after pubkey fetch so the next `pair_solana_ledger` call doesn't fail on "device busy".

**pkg-binary compatibility (Phase 10 v1.4.1 follow-up):** `node-hid` ships prebuilt napi binaries. `@yao-pkg/pkg` extracts `.node` files to `$HOME/.cache/pkg/` at first run. No `assets` config change needed — pkg auto-detects `.node` requires. Phase 10's pkg pipeline should work unchanged. **Defer empirical pkg-build test to Phase 11 verify-phase.**

### Recommendation

**Decision lock:** `@ledgerhq/hw-transport-node-hid@6.33.2` + `@ledgerhq/hw-app-solana@7.10.2`. Helper for hotplug listener deferred — `listen()` is a Phase 12 / verify-phase enhancement; Phase 11 just needs `open(null)` + `close()`.

## § Topic 3: Solana account derivation paths

[CITED: developers.ledger.com/docs/device-interaction/references/signers/solana — example shows `"44'/501'/0'"` and `"44'/501'/0'/0'"` both work] [CITED: nick.af/articles/derive-solana-addresses — Solana CLI uses `m/44'/501'`; Phantom/Solflare use `m/44'/501'/0'/0'`] [CITED: search of LedgerHQ/ledger-live PR #10351 — Ledger Live's default mode `solanaBip44` uses `44'/501'/<account>'`; mode `solanaBip44Change` uses `44'/501'/<account>'/0'` for Phantom compat]

### Canonical scheme

| Path | Used by | Convention name |
|---|---|---|
| `44'/501'/<account>'` | Ledger Live default, Sollet (early), Solana CLI vanity | `solanaBip44` |
| `44'/501'/<account>'/0'` | Phantom, Solflare, Backpack, Ledger Live "Phantom compat" mode | `solanaBip44Change` |
| `44'/501'/<account>'/0/0` | Some Trust Wallet variants | non-canonical |

[CITED: github.com/LedgerHQ/ledger-live PR #10351]

Solana uses Ed25519, so SLIP-0010 **promotes every index to hardened** — even the `0'` change-index segments. Path segments without `'` ARE NOT VALID for Solana (the Ledger app rejects them).

### Phase 11 schema decision

Persist the path verbatim from user pair-time selection. Plan 11-02's record schema stores `derivationPath: string` exactly as captured. Phase 11 ships with a SINGLE-PATH UX (always `44'/501'/0'` — Ledger Live default), surface the assumption in a stderr info line at pair time. The "multiple-addresses-per-chain" loop is explicitly DEFERRED per `11-CONTEXT.md` deferred-ideas section.

**Decision lock:** Default path `"44'/501'/0'"` (3 levels — Ledger Live default). Document the Phantom-compat alternative `"44'/501'/0'/0'"` in the pair-tool description for the future multi-path UX, but don't expose a flag in Phase 11. Future v2.0.x patch can add `path?: string` to `pair_solana_ledger` arg schema without breaking v1.

### Address rendering

The Ledger Solana app's `getAddress(path)` returns `{ address: Buffer }` — a 32-byte Ed25519 public key. Base58-encode via `bs58@5.0.0` for the user-facing address string. **Cryptographic-binding fixture discipline (Phase 12 prep):** Every test asserting an address-from-pubkey conversion must pin BOTH the raw 32-byte buffer AND the resulting base58 string as hardcoded literals — drift in either is a signing-pipeline tamper signal.

## § Topic 4: Persistent non-EVM account cache shape

[VERIFIED: read of `src/wallet/session-manager.ts` lines 49–54 + `src/wallet/walletconnect-client.ts` lines 44–48 + `src/config/wc-storage.ts` lines 95–138 + `src/server.ts` lines 200–215] [CITED: PR [#61](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/pull/61)]

### Schema (from `11-CONTEXT.md` anchor)

```typescript
interface NonEvmAccountRecord {
  chain: "solana" | "tron" | "bitcoin" | "litecoin";
  address: string;                  // base58 (Solana) / base58check (TRON / BTC / LTC)
  derivationPath: string;           // e.g. "44'/501'/0'"
  pairedAt: string;                 // ISO-8601 UTC
  displayName?: string;             // optional user label, future v2.x UX
}

type NonEvmAccountStore = NonEvmAccountRecord[];  // flat array; uniqueness by (chain, address) tuple
```

### File location + perms (mirrors `wc-storage.ts` discipline)

- **Path:** `~/.vaultpilot-mcp/non-evm-accounts.json` (file, NOT directory — distinct from WC `wc-storage/` which is a directory because the WC SDK shards keys-as-files)
- **Dir perms:** `0o700` on `~/.vaultpilot-mcp/`. Reuse `wc-storage.ts:ensureStorageDirWithPerms` mental-model: create with mode 0o700 if missing, stderr warn (no auto-chmod) on drift.
- **File perms:** `0o600` on the JSON file. Atomic-write via tempfile (`non-evm-accounts.json.tmp.<pid>`) + `fs.rename` to prevent partial-write corruption on crash.

### Eager-init at startup (mirrors PR #61 exactly)

`src/server.ts` `startServer()` modification:

```typescript
export async function startServer(): Promise<void> {
  const server = buildServer();
  await eagerInitWalletConnectIfPersist();          // existing — PR #61
  await eagerInitNonEvmAccountStoreIfPersist();     // NEW — Phase 11
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", `${SERVER_NAME} ${SERVER_VERSION} listening on stdio`);
}
```

Eager-init gates (silent skip — boot MUST NOT abort):
1. Storage mode is `"memory"` (`VAULTPILOT_NON_EVM_STORAGE=memory`) → skip
2. File does not exist → skip (fresh install)
3. File exists but malformed JSON → stderr `warn`, leave in-memory store empty, continue boot (operator can `pair_*` to rebuild). DO NOT delete corrupt file — operator may want to forensic-recover.
4. File exists but permission denied (EACCES) → stderr `warn`, continue boot with empty store

**Why empty-on-failure rather than refuse-boot:** the cache holds NO private key material. Worst case is the user re-pairs once. Refusing boot would block demo + RPC reads, breaking v1.x value.

### Spy-affordance indirection

`src/wallet/non-evm-account-store.ts` must export the test seam pattern from `session-manager.ts` line 54:

```typescript
import { readNonEvmAccountsFromDisk, writeNonEvmAccountsToDisk, ensureStorageFile } from "../config/non-evm-storage.js";

export const _storage = {
  readNonEvmAccountsFromDisk,
  writeNonEvmAccountsToDisk,
  ensureStorageFile,
};
```

Production code calls `_storage.readNonEvmAccountsFromDisk()` etc., so `vi.spyOn(_storage, "readNonEvmAccountsFromDisk")` can intercept across the ESM module boundary. CLAUDE.md convention non-negotiable.

### `list_paired_non_evm_accounts` + `remove_paired_non_evm_account`

Per `11-CONTEXT.md` § Specific Ideas line 73 — `list` returns chain + address + `pairedAt`, NEVER `derivationPath` in the user-visible output (shoulder-surfing defense: path leaks BIP44 account index, weak entropy signal).

`remove({ chain, address })` rewrites the file atomically with the matching record filtered out. Idempotent — removing a non-existent record returns success with `removed: false`.

### Stale-session detection

[CITED: `11-CONTEXT.md` line 28]
On restore, records with `pairedAt` older than 30 days surface in `get_<chain>_status` response as `staleAccountWarning: true` + user-action hint to re-pair. Never auto-expire — a stale Ledger pairing is still cryptographically valid; the warning surfaces the operational hygiene concern.

## § Topic 5: Solana RPC endpoints — free public choices

**Probed at 2026-05-20 ~17:00 UTC:** sent `getBalance` + `getParsedTokenAccountsByOwner` against each candidate. Results:

| Endpoint | `getBalance` | `getParsedTokenAccountsByOwner` | API version | Recommendation |
|---|---|---|---|---|
| `https://api.mainnet-beta.solana.com` | ✅ works | ❌ `-32601 Method not found` | 3.1.14 | Default; native + unparsed SPL only |
| `https://solana.publicnode.com` | ✅ works | ❌ `-32601 Method not found` | 3.1.11 | Backup; same limitation |
| Helius free tier | ✅ works | ✅ works | n/a | 1M credits/month, 10 RPS — requires key |
| Triton free tier | unknown | unknown | n/a | Contact-sales — no self-serve free tier |

[VERIFIED: live RPC probe at 2026-05-20] [CITED: [helius.dev/pricing](https://www.helius.dev/pricing) — 1M credits/month, 10 RPS] [CITED: [blog.triton.one/triton-faqs](https://blog.triton.one/triton-faqs-your-reference-guide/) — no self-serve free tier]

**Major finding — the parsed RPC method is disabled on public RPCs.** Both default public endpoints reject `getParsedTokenAccountsByOwner` with `-32601 Method not found`. This is a Solana-mainnet-RPC norm — parsed methods consume more node resources and free public endpoints disable them.

**Mitigation strategy — client-side decode:**
1. Call `getTokenAccountsByOwner` (unparsed, base64) — works on public RPCs.
2. Decode each account's `account.data` via `@solana/spl-token`'s `AccountLayout.decode(Buffer.from(data, 'base64'))` to extract `mint` + `amount`.
3. Resolve `decimals` per mint via the curated `solana-top-50.json` registry (mints in the registry skip the on-chain decimals fetch; mints outside it hit `getMint(connection, mintPubkey)` which is also unparsed-friendly).

This preserves the zero-config public-RPC default. The curated registry pattern matches v1.x Phase 8 per-chain top-50 EVM lists.

**Decision lock:**
- **Default endpoint:** `https://api.mainnet-beta.solana.com` (matches REQUIREMENTS.md SOL-03)
- **Override:** `SOLANA_RPC_URL` env var (mirrors per-chain EVM env var pattern in `chains/registry.ts:RPC_URL_RESOLVERS`)
- **Provider shorthand:** Phase 11 does NOT extend the EVM `RPC_PROVIDER` shorthand to Solana — Helius/Triton/QuickNode are URL-config-only. The EVM shorthand fan-out logic stays scoped to chain-ids 1/10/137/8453/42161.
- **SPL discovery:** unparsed RPC + client-side `AccountLayout.decode` + mint-registry-driven decimals. NO parsed-RPC dependency.

## § Topic 6: SPL token discovery

[CITED: `node_modules/@solana/spl-token/lib/types/state/mint.d.ts` lines 4–24 + `state/account.d.ts`]

### `getTokenAccountsByOwner` (unparsed) response shape

Verbatim from live RPC probe (Binance hot wallet `5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9`):
```json
{
  "context": { "apiVersion": "3.1.14", "slot": 420935432 },
  "value": [
    {
      "account": {
        "data": ["<base64>", "base64"],
        "executable": false,
        "lamports": 2039280,
        "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "rentEpoch": 18446744073709552000
      },
      "pubkey": "<token-account-pubkey>"
    }
  ]
}
```

Each `account.data[0]` base64-decoded is a 165-byte SPL Token Account. The `AccountLayout` struct in `@solana/spl-token` decodes it into `{ mint, owner, amount, delegateOption, delegate, state, isNativeOption, isNative, delegatedAmount, closeAuthorityOption, closeAuthority }`.

### Decimals — Mint account, not Metadata Program

[VERIFIED: spl-token `getMint(connection, mintPubkey)` returns `Mint { decimals: number, supply: bigint, ... }`]

**Decimals live on the Mint account, NOT on the Metaplex Token Metadata Program PDA.** The Metadata Program PDA carries name/symbol/URI/creators; decimals are mint-level. For Phase 11:

1. **Decimals lookup:** the curated `src/tokens/solana-top-50.json` registry pre-populates decimals for the top-50 mints. Mints outside the registry hit `getMint()` on-demand (single RPC round-trip per unknown mint, cacheable).
2. **Symbol + name:** the curated registry SHIPS `{ mint, symbol, decimals, displayName }`. Outside-registry mints fall back to `<mint-prefix>...<mint-suffix>` display with `symbolUnknown: true` flag — mirrors v1.x `priceUnknown` shape.

### Curated top-50 SPL mint registry

**Recommendation:** ship `src/tokens/solana-top-50.json` with 40–50 entries (matches Phase 8 EVM convention "≥ 40 entries, curation over padding"). Pick mints by 7-day trading volume from Jupiter aggregator data; verify each `mint` address is a valid 32-byte base58 string at module load (test-asserted byte-identity for slopcheck-equivalent supply-chain defense).

**Recommended seed list (top-priority — Phase 11 verifier confirms current ranks):**
- SOL native proxy: `So11111111111111111111111111111111111111112` (wrapped SOL)
- USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- USDT: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`
- mSOL: `mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So`
- JitoSOL: `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn`
- bSOL: `bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1`
- JUP: `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN`
- WIF, BONK, PYTH, JTO, RAY, ORCA, SRM — top memes + DeFi tokens
- mainnet stablecoins beyond USDC/USDT: PYUSD, USDS

Lock the registry at planning time via REQUIREMENT SOL-05's "top-50-by-volume" anchor. Phase 11 verifier re-checks rank at ship time.

**Decision lock:** ship the registry; client-side `AccountLayout.decode` + mint-registry-driven decimals; on-demand `getMint()` for unknown mints with stderr `info` log.

## § Topic 7: DefiLlama Solana pricing

[VERIFIED: live API probe at 2026-05-20]

```
$ curl -sS "https://coins.llama.fi/prices/current/solana:So11111111111111111111111111111111111111112,solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
{"coins":{
  "solana:So11111111111111111111111111111111111111112":{"decimals":9,"symbol":"SOL","price":84.81,"timestamp":1779259800,"confidence":0.99},
  "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v":{"decimals":6,"symbol":"usdc","price":1.00,"timestamp":1779259787,"confidence":0.99}
}}
```

**Both keys resolve cleanly.** DefiLlama's `coins.llama.fi/prices/current/<coingecko-style-key>` endpoint already supports `solana:<mint>` shape — NO changes to the existing pricing client (`src/pricing/defillama.ts`) are required for Solana keys to work.

### Native SOL pricing

Wrapped SOL mint `So11111111111111111111111111111111111111112` is the canonical proxy — DefiLlama prices it identically to native SOL. Add to `NATIVE_PRICING_PROXY` table in `src/tools/get_portfolio_summary.ts:43`:

```typescript
const NATIVE_PRICING_PROXY: Record<ChainName, Address | SolanaMint> = {
  ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH9
  arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  polygon:  "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
  base:     "0x4200000000000000000000000000000000000006",
  optimism: "0x4200000000000000000000000000000000000006",
  solana:   "So11111111111111111111111111111111111111112", // wSOL (NEW)
};
```

The `Address | SolanaMint` union type is the cleanest extension point — see § Topic 9 for the multi-chain shape decision.

**Decision lock:** ship the registry; no DefiLlama client changes; `solana:<mint>` keying matches v1.x EVM `<chainName>:<address>` keying convention by accident-of-vendor-symmetry.

## § Topic 8: Demo mode for Solana

[VERIFIED: read of `src/demo/personas.ts` lines 27–84]

### Current Persona shape

```typescript
export interface Persona {
  readonly slug: "whale" | "defi-degen" | "stable-saver" | "staking-maxi";
  readonly address: Address;  // EVM-typed
  readonly description: string;
  readonly rehearsableFlows: readonly string[];
}
```

The `address: Address` (viem `Address` type) is EVM-only. Adding a Solana persona requires either (a) a discriminated union `{ chain: "ethereum" | "solana", address: Address | string }`, or (b) a sibling registry `SOLANA_PERSONAS` in `src/demo/personas.ts`.

### Recommendation — discriminated union

```typescript
export type Persona =
  | { readonly chain: "ethereum"; readonly slug: EvmPersonaSlug; readonly address: Address; readonly description: string; readonly rehearsableFlows: readonly string[] }
  | { readonly chain: "solana";   readonly slug: SolanaPersonaSlug; readonly address: string;  readonly description: string; readonly rehearsableFlows: readonly string[] };
```

Plan 11-05 extends `EvmPersonaSlug` (existing 4) with a new `SolanaPersonaSlug = "solana-whale"` literal. `set_demo_wallet({ persona })` accepts both via narrowing. Existing 4 EVM personas keep their slugs unchanged — back-compat preserved.

### Solana persona pick

**Recommendation: `solana-whale` keyed to `5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9`** (Binance hot wallet on Solana — composition-stable, large active EOA, surfaces both native SOL + SPL breadth). Same EOA-vs-contract verification ritual as `src/demo/personas.ts` lines 7–17 — but the Solana equivalent of "not a contract" is "no executable owner program" (`account.executable === false`). [ASSUMED: Binance's Solana hot wallet has executable=false at probe time; verify at Phase 11 execute time before committing the address literal.]

**Decision lock:** discriminated union for chain-tagged Personas; single `solana-whale` persona for Phase 11; defer additional Solana personas (DeFi-degen, staking-maxi) to Phase 13+ when MarginFi / Marinade reads exist to exercise those archetypes (mirrors v1.0 R1 residual in `src/demo/personas.ts:41`).

### Phase 11 has no write surface

Phase 11 ships reads + pair only. Demo-mode simulation of Solana signing (`simulateTransaction` instead of `eth_call`) is Phase 12's concern. **Phase 11 demo persona is read-only** — calling `pair_solana_ledger` in demo mode still refuses with `DEMO_MODE_REFUSED` (mirrors v1.x EVM pattern in `src/tools/pair_ledger_live.ts:102-114`).

## § Topic 9: Multi-chain `get_portfolio_summary` extension

[VERIFIED: read of `src/tools/get_portfolio_summary.ts` lines 1–116]

### Current v1.x shape

```typescript
interface ChainPortfolio {
  chain: ChainName;            // "ethereum" | "arbitrum" | "polygon" | "base" | "optimism"
  nativeBalance: NativeBalanceRow;
  erc20Balances: Erc20BalanceRow[];
  totalUsd: string;
  rpcDegraded?: boolean;
}
```

`erc20Balances` carries the EVM-shaped row: `{ chain, tokenAddress: Address, symbol, decimals, balance, balanceUsd?, priceUnknown?, error? }`. Adding Solana requires generalizing `tokenAddress: Address` to `tokenAddress: Address | string` (Solana mint is a base58 string, not 0x-prefixed hex).

### Recommendation — preserve v1.x shape, add Solana-specific row type

```typescript
interface FungibleBalanceRow {
  chain: ChainName;                          // adds "solana"
  tokenAddress: Address | SolanaMint;        // EVM Address OR base58 mint
  symbol: string;
  decimals: number;
  balance: string;
  balanceUsd?: string;
  priceUnknown?: true;
  symbolUnknown?: true;                      // NEW — Solana SPL outside curated registry
  error?: string;
}

interface ChainPortfolio {
  chain: ChainName;
  nativeBalance: NativeBalanceRow;
  fungibleBalances: FungibleBalanceRow[];   // RENAMED from erc20Balances
  totalUsd: string;
  rpcDegraded?: boolean;
}
```

**Back-compat preservation:** keep `erc20Balances` as a DEPRECATED-but-still-emitted alias of `fungibleBalances` for the v1.x EVM chains. New consumers read `fungibleBalances`; v1.x consumers continue to read `erc20Balances`. Plan 11-04's test suite asserts byte-identity at the JSON-serialization level for the 5 EVM chains. Phase 13's verify-phase deletes the deprecated alias once downstream agent consumers migrate.

**Alternative considered:** keep `erc20Balances` literal-named on EVM chains, ADD parallel `splBalances` on Solana chains. Rejected — agent flatten-and-aggregate patterns currently rely on `row.chain` discrimination; adding two field names per row breaks the symmetric pattern.

**Cross-chain fan-out:** when both EVM and Solana are configured, `Promise.allSettled` fans out across `[1, 10, 137, 8453, 42161, "solana"]` chain identifiers. Per-chain 10s `AbortController` timeout (matches v1.x line 19 `PER_CHAIN_TIMEOUT_MS`). Chain errors surface in `chainErrors: Array<{ chain, reason }>`.

**Decision lock:** rename `erc20Balances` → `fungibleBalances`; ship the deprecated alias for one phase; per-chain `chain: "solana"` discrimination follows the EVM convention.

## § Topic 10: FROZEN-area discipline + Phase 12 prep

[VERIFIED: read of `src/signing/` (per architecture diagram) + CLAUDE.md conventions section + `src/server.ts:42-46`]

### Phase 11 FROZEN areas (DO NOT TOUCH)

- `src/signing/payload-fingerprint.ts` — domain tag `"VaultPilot-txverify-v1:"`; Phase 12 will add a DISTINCT domain tag `"VaultPilot-soltx-v1:"` for Solana
- `src/signing/presign-hash.ts` — EVM presign-hash assembly
- `src/signing/handle-store.ts` — opaque handle minting + lookup
- `src/tools/send_transaction.ts` — three-gate region (PREP-07 schema gate + PREP-08 fingerprint re-check + `userDecision === "send"` enforcement)

Phase 11 adds NEW files in NEW subdirectories — never edits the above.

### Phase 11 additive surface

```
src/chains/solana/
  ├── rpc-client.ts         — Connection factory + memoization (mirrors chains/registry.ts pattern)
  ├── env.ts                — SOLANA_RPC_URL reader + default
  ├── account-decoder.ts    — AccountLayout.decode wrapper (SPL discovery client-side decode)
  └── types.ts              — SolanaAddress (branded base58 string) + SolanaMint

src/wallet/
  └── non-evm-account-store.ts  — JSON-backed persistent cache (mirrors session-manager.ts shape + _storage indirection)

src/config/
  └── non-evm-storage.ts    — file I/O helpers (atomic write, perms enforcement; mirrors wc-storage.ts shape)

src/tokens/
  └── solana-top-50.json    — curated SPL mint registry (~40-50 entries)

src/tools/
  ├── pair_solana_ledger.ts                   — USB-HID transport open + pubkey fetch
  ├── get_solana_status.ts                    — restored-session status + staleAccountWarning
  ├── get_solana_balance.ts                   — native SOL via Connection.getBalance
  ├── get_solana_token_balance.ts             — single-mint SPL balance
  ├── get_solana_token_metadata.ts            — getMint() + curated-registry hit
  ├── get_solana_portfolio_summary.ts         — fan-out across SOL + curated mints
  ├── list_paired_non_evm_accounts.ts         — read-only listing
  └── remove_paired_non_evm_account.ts        — remove + atomic rewrite

src/demo/
  └── personas.ts           — extended with discriminated union (Solana persona added)

src/server.ts               — eagerInitNonEvmAccountStoreIfPersist() call BEFORE server.connect (mirrors PR #61)
src/tools/get_portfolio_summary.ts  — Solana fan-out (Topic 9 shape)
src/tools/get_vaultpilot_config_status.ts  — surface `pairedNonEvmChains` + `nonEvmStoragePersistent` + `solanaRpcConfigured`
```

### Phase 12 prep notes (NOT Phase 11 scope — recorded for next phase's research)

- Solana `payloadFingerprint` domain tag MUST be `"VaultPilot-soltx-v1:"` per REQUIREMENTS.md SOL-PREP-01 (distinct from EVM `"VaultPilot-txverify-v1:"`); cross-chain reuse impossible by construction.
- New cryptographic-binding fixtures (per CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals"): fixture **G** (Solana native send), **H** (Solana SPL transfer), **I** (Solana presign hash). Hardcoded `0x...` literals in `test/signing-fingerprint.test.ts` cross-linked from Phase 12 prepare/preview tests. NO `beforeAll`-snapshot.
- Solana `simulateTransaction` gate at preview is mandatory (SOL-PREP-02). Phase 12 research: empirical probe of `simulateTransaction` response shape, error envelope normalization, and the "InsufficientFundsForFee" vs "ProgramError" distinction.

## Decisions Locked (entering planning)

| ID | Decision | Confidence | Rationale source |
|---|---|---|---|
| DF-1 | Adopt `@solana/web3.js@1.98.4` (NOT `@solana/kit@6.9.0`) | HIGH | § Topic 1 empirical probe |
| D-1  | `@ledgerhq/hw-transport-node-hid@6.33.2` (events variant, not -noevents) | HIGH | § Topic 2 hotplug-listener payoff |
| D-2  | Default Ledger derivation path `"44'/501'/0'"` (3 levels — Ledger Live default) | HIGH | § Topic 3 Ledger PR #10351 |
| D-3  | Persistent cache at `~/.vaultpilot-mcp/non-evm-accounts.json` (file, 0o600); dir 0o700 | HIGH | `11-CONTEXT.md` anchor + mirror of `wc-storage.ts` |
| D-4  | Eager-init `loadNonEvmAccounts()` in `startServer()` BEFORE `server.connect(transport)` | HIGH | PR [#61](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/pull/61) precedent |
| D-5  | `_storage` spy-affordance indirection (mirrors `session-manager.ts:54`) | HIGH | CLAUDE.md convention non-negotiable |
| D-6  | Default RPC `https://api.mainnet-beta.solana.com`; override `SOLANA_RPC_URL` | HIGH | § Topic 5 + REQUIREMENTS.md SOL-03 |
| D-7  | SPL discovery via UNPARSED `getTokenAccountsByOwner` + client-side `AccountLayout.decode` | HIGH | § Topic 5 RPC method probe |
| D-8  | Curated `src/tokens/solana-top-50.json` registry (40–50 mints, top-volume seed list) | MEDIUM | § Topic 6 Phase 8 EVM precedent |
| D-9  | DefiLlama Solana pricing via existing client (no client changes); wSOL `So11…1112` as native proxy | HIGH | § Topic 7 live API probe |
| D-10 | Discriminated-union Persona type; add `solana-whale` keyed to Binance Solana hot wallet | MEDIUM | § Topic 8 (address pick needs verify-phase confirm) |
| D-11 | Rename `erc20Balances` → `fungibleBalances` with deprecated alias for one phase | MEDIUM | § Topic 9 back-compat tradeoff |

## Design Forks (DF) — surface at planning gate

- **DF-1 (SDK):** `@solana/web3.js@1.98.4` vs `@solana/kit@6.9.0`. **Locked: web3.js v1** (§ Topic 1). Surface only if user has a forward-looking reason to bias toward kit's functional ergonomics.

No other genuine forks remain. Topics 2–10 lock cleanly to one option each.

## Open Questions (planner / discuss-phase surfaces)

- **Q-1:** Does the Phase 10 v1.4.1 pkg-binary follow-up (ESM resolution) intersect with `node-hid` native binding extraction? Phase 11 verify-phase should run a full `@yao-pkg/pkg` build with `@ledgerhq/hw-transport-node-hid` linked and confirm the resulting binary opens a Ledger on macOS / Linux / Windows. **Recommendation:** add to Plan 11-05 verify-phase checklist; not a Phase 11 blocker (pkg packaging is Phase 10's surface and `node-hid` ships standard napi binaries that `@yao-pkg/pkg` handles via the `.node` asset auto-detection path).
- **Q-2:** Phase 11 Solana persona pick — `5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9` (Binance hot wallet) is the recommended anchor. Confirm via `getAccountInfo` at Phase 11 execute time that `executable === false` AND not OFAC-sanctioned before committing the literal. **Recommendation:** include verification ritual in `src/demo/personas.ts` top-of-file comment (mirrors v1.x EOA + OFAC checks at lines 7–17). [ASSUMED: address remains active + composition-stable at phase ship time.]
- **Q-3:** Top-50 SPL mint registry seed list — the recommended seeds in § Topic 6 should be re-ranked at Plan 11-04 execute time against current 7-day Jupiter aggregator volume. **Recommendation:** Plan 11-04 research-tail re-confirms registry composition before commit.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Binance Solana hot wallet `5tzFki…uAi9` remains active + composition-stable for v2.0 demo persona | § Topic 8 / Q-2 | Demo persona shows no holdings → Plan 11-05 swaps to a different verified whale before ship |
| A2 | `@yao-pkg/pkg` extracts `node-hid` napi `.node` binaries to `~/.cache/pkg/` without manual `assets` config | § Topic 2 / Q-1 | pkg-binary distribution breaks on Solana-pair attempt → fall back to npm-distribution-only for v2.0; Phase 10 packaging discipline reused in a follow-up |
| A3 | Phase 11 ship-time top-50 SPL mint rank is stable enough that seeding from 2026-05 volume holds at ship time | § Topic 6 / Q-3 | Curated registry has stale entries → Plan 11-04 rebuilds against ship-time Jupiter data |
| A4 | DefiLlama's `solana:<mint>` keying remains stable through v2.0 ship | § Topic 7 | Pricing client breaks → DefiLlama vendor change → mitigation: existing `priceUnknown` row pattern carries unpriced assets gracefully |
| A5 | Public-RPC `getParsedTokenAccountsByOwner` rejection (-32601) is consistent across both default endpoints at ship time | § Topic 5 | Public RPCs add the method back → Phase 11's unparsed-decode path still works (forward-compat) |

## Sources

### Primary (HIGH confidence)
- Empirical SDK probe at `/tmp/solana-probe/` — `npm install` + `tsc --strict --module nodenext` against installed `.d.ts` for `@solana/web3.js@1.98.4`, `@solana/kit@6.9.0`, `@ledgerhq/hw-transport-node-hid@6.33.2`, `@ledgerhq/hw-app-solana@7.10.2`, `@solana/spl-token@0.4.14`
- Live RPC probe at 2026-05-20 — `getBalance` + `getTokenAccountsByOwner` + `getParsedTokenAccountsByOwner` against `api.mainnet-beta.solana.com` + `solana.publicnode.com`
- Live DefiLlama API probe — `coins.llama.fi/prices/current/solana:<mint>` confirmed working
- v1.x precedent read: `src/wallet/session-manager.ts`, `src/wallet/walletconnect-client.ts`, `src/config/wc-storage.ts`, `src/server.ts`, `src/chains/registry.ts`, `src/tools/get_portfolio_summary.ts`, `src/tools/pair_ledger_live.ts`, `src/demo/personas.ts`
- PR [#61](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/pull/61) commit `39b7a8d` — eager-init pattern

### Secondary (MEDIUM confidence)
- [Ledger Solana Signer Kit](https://developers.ledger.com/docs/device-interaction/references/signers/solana) — derivation path examples
- [LedgerHQ/ledger-live PR #10351](https://github.com/LedgerHQ/ledger-live/pull/10351/files) — Ledger Live's `solanaBip44` (3-level) vs `solanaBip44Change` (4-level, Phantom-compat) modes
- [nick.af — Derive Solana Addresses](https://nick.af/articles/derive-solana-addresses) — Solana CLI vs Phantom path conventions
- [Helius pricing](https://www.helius.dev/pricing) + [docs/rate-limits](https://www.helius.dev/docs/billing/rate-limits) — free tier 1M credits/month, 10 RPS
- [yao-pkg/pkg](https://github.com/yao-pkg/pkg) — active fork, native addon extraction to `~/.cache/pkg/`

### Tertiary (LOW confidence — flagged)
- Triton free tier — vendor opaque; [blog.triton.one FAQ](https://blog.triton.one/triton-faqs-your-reference-guide/) confirms contact-sales-only — no self-serve free option. Discarded as Phase 11 option.

## Metadata

**Confidence breakdown:**
- SDK adoption (Topic 1): HIGH — both SDKs typecheck-probed; web3.js v1 wins on ecosystem-fit + v1.x-mirror grounds
- USB-HID transport (Topic 2): HIGH — installed packages probed, .d.ts read; pkg-compatibility ASSUMED via napi-prebuild convention (A2 — verify at Plan 11-05)
- Derivation paths (Topic 3): HIGH — multiple authoritative sources cross-reference
- Persistent cache shape (Topic 4): HIGH — mirrors locked v1.x pattern verbatim
- Public RPC choice (Topic 5): HIGH — live empirical probe; parsed-method rejection finding load-bearing for plan
- SPL discovery (Topic 6): MEDIUM — registry composition seeded but needs ship-time re-rank (A3)
- DefiLlama Solana pricing (Topic 7): HIGH — live API probe confirms
- Demo persona (Topic 8): MEDIUM — Binance Solana hot wallet anchored; verify at execute time (A1, Q-2)
- Multi-chain shape (Topic 9): MEDIUM — rename `erc20Balances` → `fungibleBalances` is a back-compat break; deprecated alias mitigates but a v1.x agent depending on the literal-name field may need adjustment
- FROZEN discipline (Topic 10): HIGH — Phase 11 surface confirmed additive-only against `src/signing/` and `src/tools/send_transaction.ts`

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (30 days — SDK versions move incrementally; Solana RPC ecosystem stable; re-verify before any post-Phase-11 re-plan)
