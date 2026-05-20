# Phase 12: Research — Solana native + SPL trust pipeline

**Researched:** 2026-05-20
**Status:** Complete
**Confidence:** HIGH (cryptographic-binding preimage shape + blind-sign hash form empirically verified against installed `.d.ts` + Ledger app C source)

## Summary

Phase 12 extends the v1.x prepare → preview → send trust pipeline to Solana via a parallel `payloadFingerprint` module (domain tag `"VaultPilot-soltx-v1:"`), a Solana-specific preview-time `simulateTransaction` gate, USB-HID Ledger signing (no WalletConnect), and durable-nonce account setup. Six FROZEN v1.x modules are byte-untouched; the additive surface lands in NEW sibling modules.

**Primary recommendation:** Adopt **Option A (serialize-message-bytes-pre-signature)** for `payloadFingerprint` preimage — `Transaction.serializeMessage(): Buffer` returns exactly the bytes the network signs over, the Ledger app SHA-256s, and that exclude all signature slots by construction. The `"Message Hash"` label the Ledger Solana app displays in blind-sign mode IS the SHA-256 of these same bytes (empirically confirmed against `LedgerHQ/app-solana/src/handle_sign_message.c` — `cx_hash_sha256(G_command.message, G_command.message_length)`). So the same byte sequence drives BOTH the agent-to-server fingerprint AND the device-side hash display, mirroring v1.x's EVM (`keccak256` over RLP-serialized envelope) pattern exactly.

**Topic count:** 10. **DF count:** 4. **Open Questions:** 3. **Fixtures added:** I (native SOL) + J (SPL TransferChecked) — both hardcoded literals in `test/signing-fingerprint-solana.test.ts` (NEW file; Phase 8's Fixture J chain-distinctness property test stays in `signing-fingerprint.test.ts` — name collision is unfortunate but the chain-distinctness anchor is FROZEN per Phase 8).

## § Topic 1: Solana transaction shape — preimage for `payloadFingerprint` (DF-1)

### Empirical probe (installed `.d.ts` at `node_modules/@solana/web3.js@1.98.4`)

`Transaction.serializeMessage(): Buffer` — line 1650 — "Get a buffer of the Transaction data that need to be covered by signatures." This is the canonical SDK helper that returns precisely the bytes the network verifies a signature against. Composition (verified by reading the SDK source comment + Solana docs at https://solana.com/docs/core/transactions):

```
serialized_message = header(3 bytes) ‖ account_keys_compact_array ‖
                     recent_blockhash(32 bytes) ‖ instructions_compact_array
```

The header carries `(numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts)` — 3 bytes. Account keys + instructions use Solana's compact-u16 length prefix. Recent blockhash sits in the middle. NO signature slots, NO partial signatures, NO `signatures: Array<SignaturePubkeyPair>`.

### Option comparison

| Option | Preimage | Verdict |
|---|---|---|
| **A: `Transaction.serializeMessage()` output** | The actual signed bytes | **ADOPT** — same shape the Ledger device SHA-256s; minimal preimage assembly logic; ABI-driven (any future instruction reuses without code change) |
| B: Custom tuple `(networkId, programId[], accounts[], data[], lamports, recentBlockhash)` | Hand-assembled tuple | REJECT — duplicates what `serializeMessage()` already does; drift risk between the custom assembler and the SDK serializer; hand-rolling Solana's compact-u16 + account-key dedup is exactly what CLAUDE.md "Don't hand-roll" forbids |
| C: Re-use EVM shape adapted | `(chainId, to, value, data)` adapted | REJECT — Solana has no `chainId` (single mainnet), no single `to` (multi-account instructions), no single `value` (lamports are program-arg, not envelope-level) |

### Decision lock — DF-1: Adopt Option A

**`payloadFingerprint = keccak256("VaultPilot-soltx-v1:" ‖ tx.serializeMessage())`**

Distinct domain tag `"VaultPilot-soltx-v1:"` (22 UTF-8 bytes — confirm at Fixture I test time) versus EVM's `"VaultPilot-txverify-v1:"` (23 bytes) makes cross-chain fingerprint reuse impossible by construction. The `keccak256` choice (NOT SHA-256) is deliberate: we want EVM-distinct hash math at the binding layer so a Phase 12 preimage cannot collide with an EVM preimage even if domain tags were stripped. The Ledger DEVICE-SIDE display uses SHA-256 (Topic 2) — these are distinct artifacts serving distinct purposes (Phase 12 cryptographic-binding layer vs. on-device user-verification layer).

**Why this works for v0 message format too:** `Transaction` (legacy) and `VersionedTransaction` (v0) BOTH have a `.serializeMessage()` / `.message.serialize()` path. For v1.x scope, **legacy `Transaction`** is the locked default (v0 Address Lookup Tables defer to v2.0.x — no v1.x phase needs the address-budget optimization).

### Format-fanout-sentinel test invariants

- `FINGERPRINT_DOMAIN_TAG_SOLANA.length === 22` — byte-length pin at Fixture I.
- Fixture I (native SOL transfer): hardcoded literal `0x...` over a known message — `from = anvilWallet[0]`, `to = anvilWallet[1]`, `lamports = 1_000_000_000`, `recentBlockhash = <fixture-blockhash-1>`. SENDER-INDEPENDENT property test cross-anchored from `prepare_solana_native_send.test.ts` (mirrors Phase 4's Fixture A — `from` is not in preimage because `serializeMessage()` puts the fee-payer pubkey in the `account_keys` array, and the preimage includes ALL accounts already).
- Fixture J (SPL TransferChecked): hardcoded literal — `mint = USDC-Solana`, `from = anvilWallet[0]`, `amount = 100_000_000n`, `decimals = 6`. SENDER-DEPENDENT because the source SPL token account is the ATA-derived address keyed by sender pubkey (matches Phase 7 `T-INTEGRATION-FROM-DRIFT-2` shape — surfaces in integration test).

## § Topic 2: Solana blind-sign hash recompute (mirror EVM `LEDGER BLIND-SIGN HASH`)

### Empirical probe (`LedgerHQ/app-solana/src/handle_sign_message.c`, fetched via gh API 2026-05-20)

Direct C source quote — the blind-sign code path:

```c
// Blind sign allowed. Prepare UI items content
transaction_summary_set_blind_signing(true);
SummaryItem *item = transaction_summary_primary_item();
summary_item_set_string(item, "Unrecognized", "format");

cx_hash_sha256(G_command.message,
               G_command.message_length,
               (uint8_t *) &G_command.message_hash,
               HASH_LENGTH);

item = transaction_summary_general_item();
summary_item_set_hash(item, "Message Hash", &G_command.message_hash);
```

**Confirmed:** the Ledger Solana app's blind-sign UI displays a field labeled **`"Message Hash"`** carrying `SHA-256(G_command.message_bytes)`. `G_command.message_bytes` is exactly what `Transaction.serializeMessage()` produces on the host side. Hash form is **SHA-256 (32 bytes, 64 hex chars)** — NOT keccak.

### Block emission

Phase 12 emits a `LEDGER BLIND-SIGN HASH` block parallel to v1.x's keccak block:

```
LEDGER BLIND-SIGN HASH (Solana)
  Full:    0xa3b2c4d5...(64 hex chars)
  Chunked: a3b2 c4d5 ... (4-char groups for readable on-device match)
```

Recompute path: `crypto.createHash('sha256').update(tx.serializeMessage()).digest()` — pure stdlib. Mints locally at preview time; the device displays the same value because both sides operate on the identical message bytes.

### Clear-sign branch — A2 mitigation (CAL coverage)

Recent Ledger SOL apps (v1.4+) clear-sign **simple SystemProgram::Transfer (native SOL)** AND **SPL Token::Transfer / TransferChecked** when the Crypto Asset List (CAL) covers the mint. Clear-sign means the device shows decoded `Recipient`, `Amount`, `Token` instead of (or alongside) the blind-sign hash. Off-CAL SPL mints fall back to blind-sign — same hash form, same Phase 12 emission.

**Decision lock — DF-2: Emit the `LEDGER BLIND-SIGN HASH (Solana)` block UNCONDITIONALLY**, with a sibling `LEDGER NOTICE` block emitted when the tx shape is known to need blind-sign-enabled-in-settings on the device. Mirrors Phase 6's `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` pattern. The hash is the trust anchor regardless of clear-sign; the NOTICE is the actionable hint for the user when CAL coverage is absent.

### Critical Ledger SDK behavior — `userInputType: "ata" | "sol"` hint

From `@ledgerhq/hw-app-solana@7.10.2/lib-es/Solana.d.ts:50`:

```typescript
signTransaction(path: string, txBuffer: Buffer, userInputType?: "ata" | "sol"):
    Promise<{ signature: Buffer }>;
```

This third optional param is **load-bearing for clear-sign SPL transfers** (LedgerHQ/ledger-live PR #12199). When the user passes a Solana address as the SPL recipient (NOT the ATA), Phase 12 derives the destination ATA server-side AND passes `userInputType: "sol"` to the device so the device's clear-sign UI shows the SOL address the user originally entered, not the derived ATA. When the user passes an ATA directly, pass `userInputType: "ata"`. **Phase 12 v1.x scope locks `userInputType: "sol"` only** — `prepare_solana_spl_send({ to, mint, amount })` accepts a Solana wallet address (`to`) and derives the destination ATA via `getAssociatedTokenAddress`; the ATA-direct path defers to a future capability tool.

## § Topic 3: Durable-nonce account (per-wallet)

### Why durable nonces

Solana's recent-blockhash window is ~150 slots ≈ 60 seconds. A standard tx prepared at T+0 expires by T+60s — incompatible with a prepare → preview → device-confirm → send flow that may take 30-90 seconds across user-think time + on-device approval. Durable nonces replace the `recent_blockhash` slot with a stored nonce hash from a Nonce account that the user owns + signs `nonceAdvance` over as the first instruction. Lifetime is bounded only by when the user calls `nonceAdvance` next.

### Empirical probe — `@solana/web3.js` types

- `SystemProgram.nonceInitialize(params: InitializeNonceParams)` — line 1197 — params: `{ noncePubkey, authorizedPubkey }`
- `SystemProgram.nonceAdvance(params: AdvanceNonceParams)` — line 1201 — params: `{ noncePubkey, authorizedPubkey }`
- `SystemProgram.nonceWithdraw(...)` — for close-out reclaim
- `NONCE_ACCOUNT_LENGTH: number` — exported constant; the byte size for `getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH)` rent calc
- `Connection.getMinimumBalanceForRentExemption(dataLength: number): Promise<number>` — line 3390 — returns the rent-exempt minimum in lamports (~0.00144 SOL for nonce accounts per empirical probes)

### UX options

| Option | Default | When the user needs it |
|---|---|---|
| **A: Optional opt-in** | `recentBlockhash` from `getLatestBlockhash()` | User explicitly enables via `prepare_solana_nonce_init` first |
| B: Always-on | Auto-create nonce account on first signing flow | Forced rent payment + extra round trip on every user |
| C: Defer to v2.0.x | No nonce support in v1.x | Breaks long-pause flows; v1.x Phase 12 already promises `prepare_solana_nonce_init` per REQUIREMENTS §SOL-PREP-04 |

### Decision lock — DF-3: Adopt Option A (optional opt-in)

**Default Phase 12 flow:** `prepare_solana_native_send` + `prepare_solana_spl_send` use `getLatestBlockhash()` for `recentBlockhash` — same as the ecosystem default. The `simulateTransaction` gate at preview catches expired-blockhash failures BEFORE the user approves on-device (Topic 4). When the user wants long-window signing, they pre-call `prepare_solana_nonce_init({ })` to mint a Nonce account, then subsequent `prepare_*` tools accept an optional `useNonce: true` flag that swaps `recentBlockhash` for a `nonceInfo` field (the SDK's `TransactionNonceCtor` shape) AND prepends a `nonceAdvance` instruction as instruction[0].

### `prepare_solana_nonce_init` shape

```typescript
// MCP tool: prepare_solana_nonce_init({})
// Returns a prepare-handle for a 2-instruction tx:
//   inst[0] = SystemProgram.createAccount(...) — funds + allocates the Nonce account
//   inst[1] = SystemProgram.nonceInitialize({ noncePubkey, authorizedPubkey: walletPubkey })
// The Nonce account pubkey is deterministically derived via PublicKey.createWithSeed(
//   walletPubkey, "vaultpilot-nonce-v1", SystemProgram.programId
// ) — pure function of (walletPubkey, fixed seed), zero discovery surface,
// matches v1.x's "one slot per user" pattern (Phase 7 Aave account-init).
```

`prepare_solana_nonce_close` reclaims rent via `SystemProgram.nonceWithdraw(..., lamports: <full balance>)`.

### Surface in `get_solana_setup_status`

Per SOL-DIAG-01 (deferred to Phase 16): `nonceAccountPresent: boolean` boolean derived from `connection.getAccountInfo(noncePubkey)`. Phase 12 ships a stub helper so Phase 16's diag tool can light up without retroactive changes.

## § Topic 4: `simulateTransaction` gate at preview

### Empirical probe — `Connection.simulateTransaction` overloads

```typescript
// @solana/web3.js@1.98.4 lib/index.d.ts:3630-3634
// Legacy overload (Transaction + optional Signer[]):
simulateTransaction(
  transactionOrMessage: Transaction | Message,
  signers?: Array<Signer>,
  includeAccounts?: boolean | Array<PublicKey>
): Promise<RpcResponseAndContext<SimulatedTransactionResponse>>;

// v0 overload (VersionedTransaction + config):
simulateTransaction(
  transaction: VersionedTransaction,
  config?: SimulateTransactionConfig
): Promise<RpcResponseAndContext<SimulatedTransactionResponse>>;

// SimulatedTransactionResponse shape (line 2250):
type SimulatedTransactionResponse = {
  err: TransactionError | string | null;       // ← the gate-decision field
  logs: Array<string> | null;                  // ← surfaces in CHECKS PERFORMED verbatim
  accounts?: (SimulatedTransactionAccountInfo | null)[] | null;
  unitsConsumed?: number;                      // ← compute units; surfaces in CHECKS PERFORMED
  returnData?: TransactionReturnData | null;
  innerInstructions?: ParsedInnerInstruction[] | null;
};
```

### Decision lock — DF-4: Mandatory gate at preview; refuse on `err !== null`

`preview_send` Solana branch composition (mirror of v1.x preview's eth_call simulation gate, but PROMOTED from informational to refusal-blocking):

```
1. Layer 0.5 — canonical dispatch (Phase 9 SEC-35) — Solana arm (defers to Phase 13)
2. Layer 0.7 — NEW — Solana simulateTransaction
   - If response.err !== null → REFUSE with SOLANA_SIMULATION_REVERT errorCode,
     surface response.logs verbatim in the CHECKS PERFORMED block
   - If response.err === null → CONTINUE, surface unitsConsumed + log-line count in CHECKS PERFORMED
3. Layer 2 — chain-mismatch (Phase 8) — N/A for Solana (single cluster)
4. Layer 3 — payloadFingerprint drift gate at send time (Phase 4 invariant — UNCHANGED)
```

**Why Layer 0.7 refuses vs. Phase 6 simulation's informational status:** EVM `eth_call` revert was usability-tier — a stale nonce or a flaky RPC could produce false reverts; v1.x ships the result as informational so the user makes the call. Solana `simulateTransaction.err` is high-fidelity (the RPC re-executes against current state); a non-null `err` essentially guarantees the broadcast will fail OR will succeed-but-wrong (e.g. wrong destination ATA derived from a stale token-metadata read). REFUSAL is the correct posture; the user re-preps and the agent re-derives the failing input.

### Module placement

**Recommend NEW `src/signing/simulation-solana.ts`** — distinct file from v1.x `src/signing/simulation.ts` because (a) the API shape is different (`SimulatedTransactionResponse` vs. viem's `call` result), (b) refusal-vs-informational posture differs, (c) tests can spy on one without polluting the other. Both files re-export through `_simulation` + `_simulationSolana` indirection objects (CLAUDE.md ESM spy-affordance). The `preview_send` Solana branch consumes `_simulationSolana.runPreviewSimulation(...)`.

### Simulation block prose

```
CHECKS PERFORMED (Solana simulation — Layer 0.7)
  status:         OK (no err)
  unitsConsumed:  12345
  logs:           Program 11111111111111111111111111111111 invoke [1]
                  Program 11111111111111111111111111111111 success
                  (3 lines total — see structuredContent.simulation.logs for full)
```

On refusal (REVERT):

```
CHECKS PERFORMED (Solana simulation — Layer 0.7)
  status:         REVERT — refused at preview
  err:            "InsufficientFundsForRent"
  logs:           Program 11111111111111111111111111111111 invoke [1]
                  Transfer: insufficient lamports 0, need 1000000000
```

## § Topic 5: USB-HID signing flow

### Empirical probe — `@ledgerhq/hw-app-solana@7.10.2`

`signTransaction(path: string, txBuffer: Buffer, userInputType?: "ata" | "sol"): Promise<{ signature: Buffer }>` — input is the **full serialized transaction** (NOT just `serializeMessage` output), with empty (zero-filled) signature slots.

### `Transaction.serialize({ requireAllSignatures: false }): Buffer`

`SerializeConfig` at line 1505:

```typescript
type SerializeConfig = {
  requireAllSignatures?: boolean;   // default: true (throws on unsigned)
  verifySignatures?: boolean;        // default: true
};
```

Pass `requireAllSignatures: false` to serialize an unsigned tx (signature slots zero-filled). This is the buffer the Ledger app accepts.

### Flow

```typescript
// In send_transaction Solana branch (Phase 12 Plan 12-05):
const tx = rehydrateTxFromHandle(record);  // reconstruct Transaction from record.tx
tx.feePayer = walletPubkey;
tx.recentBlockhash = record.tx.recentBlockhash;
const unsignedSerialized = tx.serialize({ requireAllSignatures: false });

// Open per-call USB-HID transport (mirrors Phase 11 pair_solana_ledger pattern):
const transport = await openTransport();
try {
  const app = _transport.buildSolanaApp(transport);
  const { signature } = await app.signTransaction(
    DEFAULT_SOLANA_DERIVATION_PATH,
    unsignedSerialized,
    "sol",  // userInputType — Phase 12 SPL flow uses SOL address input
  );
  tx.addSignature(walletPubkey, signature);
  // signature is a 64-byte Ed25519 sig; addSignature attaches at the
  // signature-slot index matching walletPubkey's position in account_keys
  const signedSerialized = tx.serialize();  // requireAllSignatures default true; now satisfied
  const txSignature = await connection.sendRawTransaction(signedSerialized);
  return { txHash: txSignature, broadcastedAt: new Date().toISOString() };
} finally {
  await transport.close();
}
```

### Per-call transport discipline

Phase 11 already enforces per-call transport open/close (`fetchSolanaAddress` opens, signs, closes within try/finally) — Phase 12 reuses the same pattern via `openTransport()` from `src/wallet/ledger-solana-transport.ts`. Holding the transport open across `send_transaction` calls makes the next `pair_solana_ledger` fail with "device busy".

### Error mapping

| Source | Phase 12 surface |
|---|---|
| `LedgerDeviceNotConnectedError` | `LEDGER_NOT_CONNECTED` errorCode (existing) |
| `LedgerSolanaAppNotOpenError` | `SOLANA_APP_NOT_OPEN` errorCode (existing) |
| APDU `0x6985` user-rejected | `USER_REJECTED` errorCode → reuses Phase 11's `isUserRejection` substring match |
| `sendRawTransaction` RPC failure | `BROADCAST_FAILED` errorCode (mirror v1.x WC `BROADCAST_FAILED`) |
| `simulateTransaction.err !== null` at preview | `SOLANA_SIMULATION_REVERT` errorCode (NEW, Phase 12) |

## § Topic 6: Solana SPL transfer instructions

### Empirical probe — `@solana/spl-token@0.4.14`

Two transfer instruction builders:

```typescript
// instructions/transfer.d.ts — DEPRECATED variant (no decimals; older SDKs)
createTransferInstruction(
  source: PublicKey,        // sender's ATA for the mint
  destination: PublicKey,   // recipient's ATA for the mint
  owner: PublicKey,         // sender pubkey (signs the tx)
  amount: number | bigint,  // raw units in mint-decimals
  multiSigners?: (Signer | PublicKey)[],
  programId?: PublicKey,
): TransactionInstruction;

// instructions/transferChecked.d.ts — RECOMMENDED
createTransferCheckedInstruction(
  source: PublicKey,
  mint: PublicKey,          // ← extra arg: mint pubkey explicit
  destination: PublicKey,
  owner: PublicKey,
  amount: number | bigint,
  decimals: number,         // ← extra arg: decimals explicit
  multiSigners?: (Signer | PublicKey)[],
  programId?: PublicKey,
): TransactionInstruction;
```

### Decision: Use `createTransferCheckedInstruction`

**Rationale:** TransferChecked passes mint + decimals AS instruction args, so the on-chain SPL program verifies the decimals against the mint AND verifies the source ATA holds the named mint. This is the same defense-in-depth Phase 6 lifted on EVM with `decimals()` lookup, but ENFORCED ON-CHAIN instead of just MCP-side. Any drift between agent-claimed `mint` and source-ATA's actual mint → tx fails at simulation. The deprecated `Transfer` instruction trusts the source ATA's mint silently.

### ATA derivation + creation flow

```typescript
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";

// 1. Derive source ATA (sender's ATA for this mint)
const sourceAta = await getAssociatedTokenAddress(mint, senderPubkey);

// 2. Derive destination ATA (recipient's ATA for this mint)
const destAta = await getAssociatedTokenAddress(mint, recipientPubkey);

// 3. Check whether destAta exists; if not, prepend createAssociatedTokenAccountInstruction
const destAtaInfo = await connection.getAccountInfo(destAta);
const instructions = [];
if (destAtaInfo === null) {
  instructions.push(createAssociatedTokenAccountInstruction(
    senderPubkey,       // payer — sender funds the rent
    destAta,            // associatedToken — the new ATA
    recipientPubkey,    // owner — recipient gets the ATA
    mint,
  ));
}

// 4. Append the TransferChecked instruction
instructions.push(createTransferCheckedInstruction(
  sourceAta, mint, destAta, senderPubkey, amountWei, decimals,
));
```

### Decimal-aware amount handling — `parseSolanaAmountStrict`

Mirror Phase 6's `parseAmountStrict` (`src/signing/amount.ts`) for Solana — NEW `parseSolanaAmountStrict(amountStr: string, decimals: number): bigint`. Decimal-string-at-the-boundary per CLAUDE.md. Fractional-overflow refuses (e.g. `"1.23456789012345"` against a 9-decimal mint refuses INVALID_INPUT). Use the existing `src/signing/amount.ts` shape verbatim — no Solana-specific divergence in the decimal logic.

### Decoded-args surfacing in CHECKS PERFORMED

```
DECODED ARGS (Solana SPL TransferChecked)
  mint:          EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v  (USDC)
  from (owner):  9Yd8h...
  fromATA:       5sV3X...  (derived)
  to (owner):    Bc8nC...
  toATA:         7gFmH...  (derived; createATA appended: YES/NO)
  amount:        100 USDC  (raw: 100000000, decimals: 6)
```

### Critical surface: the `to` field in CHECKS PERFORMED is the **Solana wallet address** (user-facing), with the derived ATA disclosed as a sub-line. Mirrors EVM Phase 6 where `to` is the recipient and `tokenAddress` is the contract.

## § Topic 7: Solana broadcast — `sendRawTransaction`

### Empirical probe

```typescript
// @solana/web3.js@1.98.4 lib/index.d.ts:3650
sendRawTransaction(
  rawTransaction: Buffer | Uint8Array | Array<number>,
  options?: SendOptions,
): Promise<TransactionSignature>;  // base58 string, 88 chars typical
```

Returns the tx signature (base58). NOT a tx hash in the EVM sense — Solana txs are identified by their fee-payer's signature. NO Ledger Live equivalent that broadcasts internally; Phase 12 MUST broadcast directly via `connection.sendRawTransaction(signedSerialized)`.

### Confirmation polling

```typescript
// @solana/web3.js@1.98.4 lib/index.d.ts:3312
confirmTransaction(
  strategy: TransactionConfirmationStrategy,
  commitment?: Commitment
): Promise<RpcResponseAndContext<SignatureResult>>;
```

Phase 12 ships `get_solana_transaction_status({ signature })` parallel to v1.x `get_transaction_status`. Returns `{ confirmed: boolean, slot?, err?: string | null }`. Polling strategy uses `TransactionConfirmationStrategy` shape from the SDK (no manual loop — let the SDK handle retry + backoff).

### Critical EVM vs Solana asymmetry

| Layer | EVM | Solana |
|---|---|---|
| Broadcast | Ledger Live signs + broadcasts internally over WC | MCP broadcasts directly via `sendRawTransaction` |
| Tx ID | tx hash (keccak of signed RLP) | base58 fee-payer signature |
| Confirmation | `getTransactionReceipt({ hash })` | `confirmTransaction({ signature })` |

The Solana branch in `send_transaction` returns `{ signature, broadcastedAt }` instead of `{ txHash, broadcastedAt }`. **Recommend keeping the structuredContent field name `txHash` AND adding a sibling `txSignature` field** — the literal `txHash` name preserves API symmetry with the EVM path (and existing tests / agent prompts that consume the field), while `txSignature` is technically-correct nomenclature for Solana consumers downstream.

## § Topic 8: PREPARE RECEIPT shape for Solana

### v1.x EVM PREPARE RECEIPT (canonical reference)

```
PREPARE RECEIPT
  chain:    ethereum (chainId 1)
  to:       0x70997970...
  valueWei: 1000000000000000000
```

### Solana parallel — `SOLANA_PREPARE_RECEIPT_TEMPLATE`

Native SOL:

```
PREPARE RECEIPT (Solana — native transfer)
  chain:           solana
  to:              9Yd8h7P3yWzM...   (base58 wallet address)
  lamports:        1000000000        (raw units; 1 SOL = 10^9 lamports)
  recentBlockhash: 5gV2J...          (blockhash from getLatestBlockhash())
```

SPL transfer:

```
PREPARE RECEIPT (Solana — SPL transfer)
  chain:           solana
  mint:            EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  to:              9Yd8h7P3yWzM...   (recipient wallet — destination ATA derived)
  amount:          100               (decimal-string in human units; mint decimals applied)
  recentBlockhash: 5gV2J...
```

### Format-fanout-sentinel discipline

Both templates live in `src/signing/blocks.ts` as `SOLANA_NATIVE_PREPARE_RECEIPT_TEMPLATE` + `SOLANA_SPL_PREPARE_RECEIPT_TEMPLATE` — APPEND-ONLY to the v1.x blocks file (EVM templates BYTE-FROZEN per CLAUDE.md cryptographic-binding fixture discipline). Tests import the const + substitute placeholders the same way the handler does.

### PrepareArgs storage shape extension

Phase 12 widens `PrepareArgs` (in `handle-store.ts`) ADDITIVELY:

```typescript
export interface PrepareArgs {
  // Existing EVM fields (unchanged):
  to: string;
  valueWei: string;
  tokenAddress?: string;
  amount?: string;
  spender?: string;
  // NEW Phase 12 Solana fields (all optional — EVM callers populate the
  // existing fields, Solana callers populate these):
  chain?: "solana";          // discriminator; absent = EVM
  mint?: string;             // SPL mint (base58)
  lamports?: string;         // native SOL amount (decimal string of raw lamports)
  recentBlockhash?: string;  // pinned at prepare time
}
```

All fields stay `string` to preserve the "type system blocks normalization at the storage boundary" invariant (PrepareArgs is the verbatim agent-string store).

## § Topic 9: `previewToken` + `userDecision` gates for Solana

### Verdict: REUSE the existing `handle-store.ts` mechanism unchanged

Both gates lift to Solana 1:1 — `crypto.randomUUID()` for `previewToken`, schema-level enum gate for `userDecision`. The handle-store state machine (`prepared → previewed → sent | cancelled`) is chain-agnostic.

### `PreparedTx` shape extension — discriminated union

Current shape is EVM-typed (Address, bigint, Hex). Phase 12 widens to a discriminated union:

```typescript
export type PreparedTx =
  | PreparedTxEvm          // existing v1.x shape — UNCHANGED
  | PreparedTxSolana;      // NEW

export interface PreparedTxEvm {
  kind: "evm";             // ← NEW discriminator (default for back-compat: omit → "evm")
  chainId: number;
  to: Address;
  valueWei: bigint;
  data: Hex;
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface PreparedTxSolana {
  kind: "solana";
  // Pre-built Transaction OR the bytes from serializeMessage()
  // (researcher: prefer storing the constructed Transaction in-memory
  // so re-derivation at send-time matches preview-time exactly):
  messageBytes: Buffer;             // serializeMessage() output — preimage of payloadFingerprint
  feePayer: string;                  // base58 wallet pubkey
  recentBlockhash: string;
  instructionSummary: SolanaInstructionSummary[];  // for DECODED ARGS surfacing
  // Pinned at preview time:
  unitsConsumed?: number;            // from simulateTransaction
}

export type SolanaInstructionSummary =
  | { kind: "native-transfer"; from: string; to: string; lamports: bigint }
  | { kind: "spl-transfer-checked"; mint: string; from: string; to: string;
      sourceAta: string; destAta: string; amount: bigint; decimals: number;
      createDestAta: boolean }
  | { kind: "nonce-init"; noncePubkey: string; authorizedPubkey: string }
  | { kind: "nonce-close"; noncePubkey: string; toPubkey: string };
```

### `payloadFingerprint` drift gate

The Phase 12 drift recompute in `send_transaction` Solana branch:

```typescript
// EVM branch (FROZEN):
const recomputed = computePayloadFingerprint({ chainId, to, valueWei, data });

// Solana branch (NEW):
const recomputed = computeSolanaPayloadFingerprint({ messageBytes: record.tx.messageBytes });
if (recomputed !== record.payloadFingerprint) → PAYLOAD_FINGERPRINT_DRIFT refusal
```

The discriminator dispatch fires AFTER the previewToken match + state-machine gates. The three-gate FROZEN region in `send_transaction.ts` is byte-untouched — the dispatch happens via a NEW helper `routeSendByTxKind(record)` introduced AT THE END (lines 430+) of the existing handler, BELOW the three-gate region.

## § Topic 10: FROZEN-area discipline + module layout

### FROZEN modules (read-only for Phase 12; byte-untouched at test time)

| Module | Why FROZEN | Phase 12 strategy |
|---|---|---|
| `src/signing/payload-fingerprint.ts` | EVM preimage shape is the v1.x trust anchor; Fixture A-H literals MUST stay green | NEW sibling `src/signing/payload-fingerprint-solana.ts` |
| `src/signing/presign-hash.ts` | EIP-1559 RLP wrapping is EVM-specific; viem-coupled | NEW sibling `src/signing/blind-sign-hash-solana.ts` (SHA-256 of messageBytes) |
| `src/signing/handle-store.ts` | State machine is chain-agnostic; widening `PrepareArgs` + `PreparedTx` is ADDITIVE | EXTEND additively (Topic 8 + Topic 9 — discriminator + optional Solana fields) |
| `src/tools/send_transaction.ts` | Three-gate region byte-frozen per CLAUDE.md | EXTEND additively — dispatch to `routeSendByTxKind(record)` AFTER the three-gate region; Solana sub-handler in NEW `src/tools/send_transaction_solana.ts` (imported by main handler) |
| `src/tools/preview_send.ts` | LEDGER block templates byte-frozen; Layer 0.5 / Layer 2 gates byte-frozen | EXTEND additively — dispatch to `previewSolanaTx(record)` after Layer 0.5 / Layer 2 (both are EVM-only — short-circuit for Solana via discriminator check) |
| `src/security/canonical-dispatch.ts` | EVM `CANONICAL_DISPATCH_TARGETS` table byte-frozen | Solana arm DEFERS to Phase 13 (MarginFi + Kamino program IDs); Phase 12 native SOL + SPL transfers BYPASS Layer 0.5 by inspection (SystemProgram + SPL Token Program are universally trusted) |

### NEW Phase 12 modules

| File | Purpose |
|---|---|
| `src/signing/payload-fingerprint-solana.ts` | `FINGERPRINT_DOMAIN_TAG_SOLANA = "VaultPilot-soltx-v1:"` + `computeSolanaPayloadFingerprint({ messageBytes }) → keccak256(tag ‖ messageBytes)` |
| `src/signing/blind-sign-hash-solana.ts` | `computeSolanaBlindSignHash(messageBytes: Buffer): Buffer` — `crypto.createHash("sha256").update(messageBytes).digest()` |
| `src/signing/simulation-solana.ts` | `runPreviewSimulationSolana({ connection, tx }) → { status: "ok" | "revert" | "error"; err, logs, unitsConsumed }`; `_simulationSolana` indirection |
| `src/signing/amount-solana.ts` | `parseSolanaAmountStrict(amountStr, decimals): bigint` — mirror of `parseAmountStrict` |
| `src/protocols/solana-system.ts` | `encodeNativeTransfer({ from, to, lamports }) → TransactionInstruction` + decoder for surfacing in DECODED ARGS |
| `src/protocols/solana-spl.ts` | `encodeSplTransferChecked({ mint, sourceAta, destAta, owner, amount, decimals }) → TransactionInstruction`; ATA-derivation helper; `maybeAppendCreateAtaInstruction(...)` |
| `src/tools/prepare_solana_native_send.ts` | MCP tool — SOL-W-01 |
| `src/tools/prepare_solana_spl_send.ts` | MCP tool — SOL-W-02 |
| `src/tools/prepare_solana_nonce_init.ts` | MCP tool — SOL-PREP-04 |
| `src/tools/prepare_solana_nonce_close.ts` | MCP tool — SOL-PREP-04 |
| `src/tools/send_transaction_solana.ts` | Internal sub-handler imported by `send_transaction.ts` |
| `test/signing-fingerprint-solana.test.ts` | NEW Fixture I + J literal anchors (per CLAUDE.md fixture discipline) |

### Fixture discipline (CLAUDE.md non-negotiable)

NEW test file `test/signing-fingerprint-solana.test.ts` carries Fixture I + Fixture J as hardcoded `0x...` literals:

```typescript
// Fixture I — native SOL transfer fingerprint
// Inputs: known fee-payer (anvilWallet[0]'s Solana addr), known recipient,
// 1 SOL = 1_000_000_000 lamports, fixed-blockhash for determinism
it("Fixture I — native SOL transfer fingerprint (hardcoded literal anchor)", () => {
  const fp = computeSolanaPayloadFingerprint({ messageBytes: NATIVE_FIXTURE_MESSAGE_BYTES });
  expect(fp).toBe("0x<computed-at-execute-time-and-pinned>");
  expect(FINGERPRINT_DOMAIN_TAG_SOLANA.length).toBe(22);  // byte-length pin
});

// Fixture J — SPL TransferChecked fingerprint
// Inputs: USDC mint (Solana), known fee-payer, 100 USDC = 100_000_000 (decimals=6)
it("Fixture J — SPL TransferChecked fingerprint (hardcoded literal anchor)", () => {
  const fp = computeSolanaPayloadFingerprint({ messageBytes: SPL_FIXTURE_MESSAGE_BYTES });
  expect(fp).toBe("0x<computed-at-execute-time-and-pinned>");
});
```

NO `beforeAll`-snapshot. NO self-referencing assertions. Cross-link from `prepare_solana_native_send.test.ts` + `prepare_solana_spl_send.test.ts` consumer tests so a drift in preimage assembly fires at a specific line.

**Persona-cycle integration test:** NEW `test/solana-trust-pipeline.integration.test.ts` re-anchors byte-identity across persona swaps. Native SOL = sender-independent (only `to` + `lamports` + recentBlockhash in the meaningful preimage; sender-pubkey appears in account_keys but the account_keys position is deterministic given the same instruction order). SPL = sender-DEPENDENT (source ATA is `getAssociatedTokenAddress(mint, senderPubkey)` — derives from sender). Pattern matches Phase 7 Aave `T-INTEGRATION-FROM-DRIFT-2`.

### Phase 12 namespace name collision — Fixture J

⚠ Phase 8 uses **Fixture J** for the chain-distinctness property test in `test/signing-fingerprint.test.ts` (EVM-side). Phase 12 promises Fixture I + J in `12-CONTEXT.md` — recommend Phase 12 anchors live in `test/signing-fingerprint-solana.test.ts` as `Fixture I (Solana native)` + `Fixture J (Solana SPL)`. The Phase 8 `Fixture J — chain-distinctness property` stays in `signing-fingerprint.test.ts` UNCHANGED (FROZEN per Phase 8). Open Question OQ-2 (below) flags this for planner-resolution.

## Decision Locks Summary (DF-1 through DF-4)

| DF | Locked | Rationale |
|---|---|---|
| **DF-1** | `payloadFingerprint = keccak256("VaultPilot-soltx-v1:" ‖ Transaction.serializeMessage())` | Same bytes the network signs; same bytes the Ledger SHA-256s; ABI-driven via SDK helper |
| **DF-2** | Emit `LEDGER BLIND-SIGN HASH (Solana)` block UNCONDITIONALLY; SHA-256 form | Empirically confirmed via `app-solana/src/handle_sign_message.c::cx_hash_sha256(G_command.message, ...)`; works regardless of clear-sign coverage |
| **DF-3** | Durable-nonce setup OPTIONAL opt-in via `prepare_solana_nonce_init` | Default flow + `simulateTransaction` gate covers the 60s window for nearly all users; `nonce_init` is one tool call away when needed |
| **DF-4** | `simulateTransaction` at preview is MANDATORY refusal gate (Layer 0.7) | `simulateTransaction.err` is high-fidelity (RPC re-executes against current state); non-null err = guaranteed-bad broadcast; REFUSE not warn |

## Open Questions

### OQ-1: Versioned vs legacy `Transaction` for v1.x?

**What we know:** `VersionedTransaction` (v0) supports Address Lookup Tables — reduces account-key budget for swaps/DEX flows. `Transaction` (legacy) is simpler and the entire SPL ecosystem still accepts both.

**What's unclear:** Whether Phase 12's two flows (native SOL, SPL) ever need the v0 advantage. Native + SPL fit in legacy's 35-account budget easily.

**Recommendation:** Lock `Transaction` (legacy) for v1.x Phase 12 — explicit defer of v0 + Address Lookup Tables to v2.0.x. Document the upgrade path: when Jupiter swaps (Phase 14) need 50+ accounts, introduce `VersionedTransaction` as a parallel `PreparedTxSolanaV0` discriminator. `payloadFingerprint` logic via `serializeMessage` works for BOTH (call sites differ: `tx.serializeMessage()` vs. `tx.message.serialize()` — verify at execute time).

### OQ-2: Fixture I/J namespace collision with Phase 8 Fixture J

**What we know:** Phase 8 `Fixture J — chain-distinctness property` lives at `test/signing-fingerprint.test.ts:182`. Phase 12 promises Fixture I + J per `12-CONTEXT.md`.

**Recommendation:** Phase 12 anchors live in NEW `test/signing-fingerprint-solana.test.ts` — sibling file, distinct test surface. Refer to them as `Fixture I (Solana native)` + `Fixture J (Solana SPL)` in commit messages + planning docs to avoid collision with Phase 8's `Fixture J (chain-distinctness)`. Planner can either rename Phase 12's anchors to `K` + `L` OR keep `I` + `J` with the sibling-file disambiguation. Sibling-file recommended — cleaner separation by namespace.

### OQ-3: SOL-PREP-05 errorCode set canonical list

**What we know:** Phase 12 introduces NEW errorCodes (`SOLANA_SIMULATION_REVERT`, `SOLANA_APP_NOT_OPEN` — already shipped in Phase 11). The `error-codes.ts` SOT carries the existing v1.x set.

**Recommendation:** Phase 12 lands an ADDITIVE 3-entry extension to `error-codes.ts`:
- `SOLANA_SIMULATION_REVERT` — Layer 0.7 gate refusal (preview)
- `SOLANA_BROADCAST_FAILED` — `connection.sendRawTransaction` failure (or reuse generic `BROADCAST_FAILED`?)
- `SOLANA_RPC_FAILED` — already exists per Phase 11's `sol-rpc-client.ts:SolanaRpcError` (no change)

Planner to confirm whether `BROADCAST_FAILED` is generic enough to cover both EVM + Solana, or whether the surface needs distinction. Recommend reusing `BROADCAST_FAILED` — the `errorCode` field is the user-facing taxonomy; granularity belongs in the `cause` field.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Solana transaction serialization | Manual byte assembly of header + account_keys + instructions | `tx.serializeMessage()` + `tx.serialize({ requireAllSignatures: false })` | Compact-u16 length prefixes + account-key dedup are gnarly; the SDK is canonical |
| SPL transfer instruction encoding | Manual TokenInstruction enum + amount layout | `createTransferCheckedInstruction(...)` | The instruction byte layout is fixed but the buffer-layout dance is non-trivial |
| ATA derivation | Manual `findProgramAddressSync(seeds, programId)` | `getAssociatedTokenAddress(mint, owner)` | The seed order (`owner_pubkey, TOKEN_PROGRAM_ID, mint`) is easy to get wrong |
| Nonce account size | Hardcoded `80` or similar | `NONCE_ACCOUNT_LENGTH` constant from `@solana/web3.js` | Account size can shift across runtime versions; the SDK exports the canonical value |
| Rent-exempt minimum lamports | Hardcoded literal | `connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH)` | Rent rate is set by chain governance; query at runtime |
| Blind-sign hash recompute | Custom hash impl | `crypto.createHash("sha256").update(messageBytes).digest()` | Node stdlib SHA-256 matches Ledger's `cx_hash_sha256` byte-for-byte |
| Solana address validation | Custom base58 regex AFTER `assertSolanaAddress` | Phase 11's `assertSolanaAddress` + `new PublicKey(s)` | Already shipped; reuse |

## Common Pitfalls

### Pitfall 1: serializing fully-signed tx instead of unsigned message bytes
**What goes wrong:** `tx.serialize()` defaults to `requireAllSignatures: true` and throws on unsigned txs.
**How to avoid:** ALWAYS pass `tx.serialize({ requireAllSignatures: false })` for the Ledger input buffer. After `tx.addSignature(walletPubkey, signature)`, the default-arg call works.

### Pitfall 2: Confusing `serializeMessage()` (preimage) with `serialize()` (wire format)
**What goes wrong:** Storing the wrong bytes for `payloadFingerprint` recompute at send time. `serialize()` includes signature slots; `serializeMessage()` does NOT.
**How to avoid:** `payloadFingerprint` ALWAYS over `serializeMessage()` output. The Ledger app SHA-256s the same bytes (the device receives the full wire-format tx with zero-filled signature slots, but the hash domain inside the device is the message bytes only).

### Pitfall 3: Passing the Solana wallet address as the SPL transfer destination instead of the destination ATA
**What goes wrong:** `createTransferCheckedInstruction(source, mint, RECIPIENT_WALLET, ...)` — destination must be the recipient's ATA, NOT the recipient's wallet pubkey. Tx fails at simulation.
**How to avoid:** Derive `destAta = getAssociatedTokenAddress(mint, recipientWallet)` server-side. The SOL-W-02 tool surface accepts the recipient wallet (`to`) for UX; the implementation derives the ATA.

### Pitfall 4: Forgetting to prepend `createAssociatedTokenAccountInstruction` when destination ATA doesn't exist
**What goes wrong:** SPL transfer to a recipient who has never held this token reverts at simulation.
**How to avoid:** Pre-flight check `connection.getAccountInfo(destAta)`. If null → prepend `createAssociatedTokenAccountInstruction(senderPubkey, destAta, recipientPubkey, mint)`. Sender pays the rent (~0.002 SOL); surface this in DECODED ARGS so the user sees the extra cost.

### Pitfall 5: 150-slot blockhash expiry catching long device-approval windows
**What goes wrong:** User stares at the Ledger for 90 seconds; broadcast fails `BlockhashNotFound`.
**How to avoid:** `simulateTransaction` at preview catches this (re-fetches blockhash against current cluster state). For deliberate long-duration flows, recommend `prepare_solana_nonce_init` (Topic 3).

### Pitfall 6: SDK default-export drift under TS5 NodeNext
**What goes wrong:** `import SolanaApp from "@ledgerhq/hw-app-solana"` resolves to a namespace object, not the class; `new SolanaApp(transport)` throws.
**How to avoid:** Phase 11 already solved this in `ledger-solana-transport.ts:38-44` via the `(Module as any).default ?? Module` shim. Phase 12 reuses the existing `_transport.buildSolanaApp(t)` helper.

### Pitfall 7: ESM-spy-affordance gap on cross-export internal calls
**What goes wrong:** `vi.spyOn(solanaFingerprintModule, "computeSolanaPayloadFingerprint")` silently no-ops because ESM bindings are immutable.
**How to avoid:** Phase 12 modules carry `_solanaFingerprint`, `_solanaBlindSignHash`, `_solanaSpl`, `_simulationSolana` indirection objects per CLAUDE.md convention. Add at write time, not retroactively.

## State of the Art

| Old approach | Current approach | Phase 12 status |
|---|---|---|
| `Transaction.serialize()` + custom signature stripping | `Transaction.serializeMessage()` direct | Phase 12 adopts the canonical SDK helper |
| `getRecentBlockhash` (deprecated v1.8.0) | `getLatestBlockhash` (current) | Phase 12 uses `getLatestBlockhash` |
| `getParsedTokenAccountsByOwner` (rejected by public RPC) | UNPARSED `getTokenAccountsByOwner` + client-side `AccountLayout.decode` | Phase 11 already locked the unparsed path; Phase 12 reuses |
| `createTransferInstruction` (decimals-blind) | `createTransferCheckedInstruction` (on-chain decimals verify) | Phase 12 adopts the Checked variant |
| `Connection.simulateTransaction(transaction, signers)` legacy overload | `simulateTransaction(versionedTransaction, config)` v0 overload | Phase 12 uses the LEGACY overload (locks `Transaction` per OQ-1); defer v0 overload to v2.0.x |

## Sources

### Primary (HIGH confidence)

- [`@solana/web3.js@1.98.4` installed `.d.ts`](file:///Users/s/dev/vaultpilot/vaultpilot-mcp/node_modules/@solana/web3.js/lib/index.d.ts) — Transaction class (line 1589), serializeMessage (line 1650), SerializeConfig (line 1505), SimulatedTransactionResponse (line 2250), SystemProgram (line 1168), NONCE_ACCOUNT_LENGTH (line 181), simulateTransaction overloads (3630-3634), sendRawTransaction (3650), confirmTransaction (3312), getLatestBlockhash (3434), getMinimumBalanceForRentExemption (3390)
- [`@ledgerhq/hw-app-solana@7.10.2` installed `.d.ts`](file:///Users/s/dev/vaultpilot/vaultpilot-mcp/node_modules/@ledgerhq/hw-app-solana/lib-es/Solana.d.ts) — signTransaction signature with userInputType "ata" | "sol"
- [`@solana/spl-token@0.4.14` installed `.d.ts`](file:///Users/s/dev/vaultpilot/vaultpilot-mcp/node_modules/@solana/spl-token/lib/types/instructions/) — transfer + transferChecked + associatedTokenAccount instruction builders
- [LedgerHQ/app-solana `src/handle_sign_message.c`](https://github.com/LedgerHQ/app-solana/blob/develop/src/handle_sign_message.c) — empirically confirmed blind-sign hash = `cx_hash_sha256(G_command.message, G_command.message_length)`, UI label `"Message Hash"`
- Phase 11 artifacts (this repo) — `src/chains/solana/registry.ts`, `src/chains/solana/sol-rpc-client.ts`, `src/wallet/ledger-solana-transport.ts`, `src/wallet/non-evm-account-store.ts`, `src/tools/pair_solana_ledger.ts`
- v1.x EVM trust-pipeline artifacts — `src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/signing/handle-store.ts`, `src/signing/simulation.ts`, `src/security/canonical-dispatch.ts`, `src/tools/preview_send.ts`, `src/tools/send_transaction.ts`, `test/signing-fingerprint.test.ts`

### Secondary (MEDIUM confidence — cross-referenced)

- [Solana docs — Transactions](https://solana.com/docs/core/transactions) — message serialization format reference
- [Solana docs — Durable Transaction Nonces](https://docs.anza.xyz/implemented-proposals/durable-tx-nonces) — protocol-level nonce semantics
- [Solana docs — Introduction to Durable Nonces](https://solana.com/developers/guides/advanced/introduction-to-durable-nonces) — operational guide
- [Solana RPC — simulateTransaction](https://solana.com/docs/rpc/http/simulatetransaction) — RPC method spec
- [Ledger Live PR #12199](https://github.com/LedgerHQ/ledger-live/pull/12199) — `userInputType: "ata" | "sol"` P2 field source
- [Ledger Solana app README](https://github.com/LedgerHQ/app-solana) — clear-sign / blind-sign feature overview
- [Allowing blind signing in the Solana app](https://support.ledger.com/article/4499092909085-zd) — settings UI prerequisite (informs A2 NOTICE template)
- [Solana Signer Kit — Ledger Developer Portal](https://developers.ledger.com/docs/device-interaction/references/signers/solana) — Solana clear-sign capability

### Tertiary (LOW confidence — surface-level; cross-check before implementation)

- WebSearch on "Ledger Solana clear-sign trusted name CAL" — confirms CAL-coverage gates clear-sign for SPL but specific mint coverage list not enumerated

## Metadata

**Confidence breakdown:**
- Cryptographic preimage shape (DF-1): HIGH — `Transaction.serializeMessage()` is canonical SDK helper with comment "data that need to be covered by signatures"
- Blind-sign hash form (DF-2): HIGH — C source quoted directly from `app-solana/src/handle_sign_message.c`
- `simulateTransaction` API + refusal posture (DF-4): HIGH — `.d.ts` empirically probed
- Durable-nonce account setup (DF-3 + Topic 3): MEDIUM — SDK shape verified; UX recommendation reasoned from RFC-150-slot window
- USB-HID signing flow (Topic 5): HIGH — Ledger SDK signature explicit; Phase 11 already wired `openTransport`
- SPL TransferChecked + ATA derivation (Topic 6): HIGH — `.d.ts` + Solana docs cross-confirmed
- FROZEN discipline (Topic 10): HIGH — Phase 12 module layout follows the v1.x precedent verbatim

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (Solana web3.js ecosystem is stable v1.98.x; revisit if `@solana/kit` migration starts during planning)
