# Phase 12: Patterns — Solana native + SPL trust pipeline + simulation gate + USB-HID send routing

**Mapped:** 2026-05-20
**Files classified:** 14 new + 4 modified
**Analogs found:** 14 / 14 (every new file has a clean v1.x EVM analog)

---

## Pattern-mapper meta-decisions

Five decisions resolved up-front so individual plans don't re-litigate:

1. **`payload-fingerprint-solana.ts` — sibling module, NEVER extend `payload-fingerprint.ts`.** The EVM module is FROZEN per project CLAUDE.md + Phase 11 retro. Fingerprint preimage shape differs structurally (Solana uses serialized message bytes; EVM uses `(chainId, to, valueWei, data)`). A shared module would force a discriminated-union preimage builder and re-prove the EVM Fixture-A..H byte-identity assertions every Phase 12 commit. Sibling module: independent regression surface, independent fixture anchors, zero risk to v1.x trust pipeline.

2. **`presign-hash-solana.ts` — sibling module.** Same rationale as #1. EVM module uses `viem.serializeTransaction` (EIP-1559 + RLP). Solana pre-sign input is the same serialized message bytes the fingerprint already hashes — different keccak / sha256 selection per researcher Topic 2 lock. Sibling keeps both modules narrow.

3. **`simulation.ts` — sibling Solana module, NEVER extend.** [`src/signing/simulation.ts`](../../src/signing/simulation.ts) is listed in Phase 11 PATTERNS' FROZEN areas. The existing wrapper is viem-typed (`PublicClient`, `call` action, viem revert-text regex). Solana's `Connection.simulateTransaction` returns a different envelope shape (`{ value: { err, logs, returnData, unitsConsumed } }`); jamming both into one helper requires a discriminated union on the input + output. Sibling `simulation-solana.ts` mirrors the shape (NEVER throws, returns a Result envelope, exports `_simulationSolana` ESM spy-affordance) — preview_send dispatches on handle's tx-type.

4. **`preview_send.ts` + `send_transaction.ts` — extend additively with a `handle.txType` discriminator.** Both files modified, but the v1.x FROZEN regions stay byte-identical. The discriminator is read AFTER `lookup()` and BEFORE any tx-type-specific logic; the EVM branch is the existing body (unchanged), the Solana branch is the additive insertion. `send_transaction.ts` three-gate region (PREVIEW_REQUIRED → previewToken match → PAYLOAD_FINGERPRINT_DRIFT recompute) applies IDENTICALLY to both branches — only the WC-vs-USB-HID transport call at the very bottom differs.

5. **Fixture naming — K (native SOL) + L (SPL transfer), NOT I + J.** Fixtures I and J are ALREADY TAKEN: Fixture I is referenced in `test/signing-fingerprint.test.ts` line 174 as a sibling-comment to Phase 8's Fixture J (the chain-distinctness property test at lines 182-196). Adopting "I" and "J" silently collides with extant fixture identifiers — both the literal pin at line 182 and the surrounding comment-block lineage. Phase 12 fixtures land as **K (native SOL transfer fingerprint, hardcoded literal)** and **L (SPL transfer fingerprint, hardcoded literal)** in a new `test/signing-fingerprint-solana.test.ts` file (NOT inlined into the FROZEN `test/signing-fingerprint.test.ts` — keeps EVM-side byte-identity regression independent from Solana-side evolution). Cross-link from prepare-solana-* consumer tests as today. The CONTEXT.md / ROADMAP "Fixture I + J" labels propagate as K + L throughout PATTERNS + plans; the orchestrator's task prompt uses the old naming inherited from CONTEXT.md, but the planner adopts K + L. Surfaced explicitly for the planner so plan text matches code.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/signing/payload-fingerprint-solana.ts` | signing primitive | pure compute | [`src/signing/payload-fingerprint.ts`](../../src/signing/payload-fingerprint.ts) | sibling-module (different preimage shape) |
| `src/signing/presign-hash-solana.ts` | signing primitive | pure compute | [`src/signing/presign-hash.ts`](../../src/signing/presign-hash.ts) | sibling-module (different envelope shape) |
| `src/signing/simulation-solana.ts` | preview-time gate | request-response | [`src/signing/simulation.ts`](../../src/signing/simulation.ts) | sibling-module (mandatory refusal vs advisory) |
| `src/protocols/solana-system.ts` | tx encoder | pure compute | [`src/protocols/erc20.ts`](../../src/protocols/erc20.ts) | role-match (Transfer instruction builder + decoder) |
| `src/protocols/solana-spl.ts` | tx encoder | pure compute + ATA derivation | [`src/protocols/erc20.ts`](../../src/protocols/erc20.ts) | role-match (recipient-ATA derivation is Solana-specific) |
| `src/signing/amount-solana.ts` | parse strict | pure compute | [`src/signing/amount.ts`](../../src/signing/amount.ts) (`parseAmountStrict`) | exact-role (lamports vs wei) |
| `src/tools/prepare_solana_native_send.ts` | MCP tool | request-response | [`src/tools/prepare_native_send.ts`](../../src/tools/prepare_native_send.ts) | exact (lamports vs wei + base58 vs hex) |
| `src/tools/prepare_solana_spl_send.ts` | MCP tool | request-response | [`src/tools/prepare_token_send.ts`](../../src/tools/prepare_token_send.ts) | exact (mint + ATA derivation differ) |
| `src/tools/prepare_solana_nonce_init.ts` | MCP tool | request-response | [`src/tools/prepare_native_send.ts`](../../src/tools/prepare_native_send.ts) | role-match (no EVM analog — System Program scaffolding) |
| `src/tools/prepare_solana_nonce_close.ts` | MCP tool | request-response | [`src/tools/prepare_native_send.ts`](../../src/tools/prepare_native_send.ts) | role-match (no EVM analog — System Program scaffolding) |
| `src/security/canonical-dispatch-solana.ts` | allowlist gate | pure check | [`src/security/canonical-dispatch.ts`](../../src/security/canonical-dispatch.ts) | sibling-module (System + Token program IDs) |
| `src/signing/blocks-solana.ts` | text templates | pure render | [`src/signing/blocks.ts`](../../src/signing/blocks.ts) | sibling-module (PREPARE-RECEIPT-SOLANA, LEDGER-BLIND-SIGN-SOLANA, SIMULATION-SOLANA) |
| **MOD** `src/signing/handle-store.ts` | handle state machine | in-memory | (itself) | additive widening — `PrepareArgs` Solana fields + `txType` discriminator |
| **MOD** `src/wallet/ledger-solana-transport.ts` | transport surface | request-response | (itself) | additive — `signTransaction()` export + `_transport.signTransaction` indirection |
| **MOD** `src/tools/preview_send.ts` | MCP tool | request-response | (itself) | additive Solana branch via `record.tx.txType` discriminator |
| **MOD** `src/tools/send_transaction.ts` | MCP tool | request-response | (itself) | additive Solana branch — USB-HID routing AFTER the FROZEN three-gate region |
| **MOD** `src/tools/get_tx_verification.ts` | MCP tool | request-response | (itself) | additive Solana `txJson` re-emit branch |
| **MOD** `src/tools/register-all.ts` | side-effect register | additive imports | (itself) | additive |

Test files mirror the analog's test (8 new + 1 widened — full list in §Test patterns).

---

## Pattern Assignments (by new plan)

### Plan 12-01 — Solana signing primitives (fingerprint + presign-hash + simulation + Fixtures K + L)

**New files:**
- `src/signing/payload-fingerprint-solana.ts`
- `src/signing/presign-hash-solana.ts`
- `src/signing/simulation-solana.ts`
- `src/signing/blocks-solana.ts`
- `test/signing-fingerprint-solana.test.ts` — **Fixture K + L hardcoded `0x...` literal anchors**
- `test/signing-presign-hash-solana.test.ts`
- `test/simulation-solana.test.ts`

**Modified files:** none (handle-store widening lands in 12-02; this plan ships pure primitives).

**Primary analogs:** [`src/signing/payload-fingerprint.ts`](../../src/signing/payload-fingerprint.ts) + [`src/signing/presign-hash.ts`](../../src/signing/presign-hash.ts) + [`src/signing/simulation.ts`](../../src/signing/simulation.ts) + [`src/signing/blocks.ts`](../../src/signing/blocks.ts).

**Bounded diffs:**

1. **`src/signing/payload-fingerprint-solana.ts`** — mirror `payload-fingerprint.ts:36-49` shape:
   - Export `FINGERPRINT_DOMAIN_TAG_SOLANA = "VaultPilot-soltx-v1:"` (21-byte UTF-8 — distinct length from EVM's 23-byte `"VaultPilot-txverify-v1:"`; cross-chain reuse impossible by construction).
   - `computeSolanaPayloadFingerprint(input: { messageBytes: Uint8Array }): Hex` — researcher Topic 1 locks `messageBytes` as `TransactionMessage.compileToV0Message().serialize()` (v0 transaction). Preimage = `tag || messageBytes`; output is keccak256 (matches EVM's 32-byte hex shape so handle-store's `payloadFingerprint: Hex` field stays type-stable).
   - Anti-pattern guard: NEVER include the signature slots (Solana's full-tx serialization includes a zero-filled signature region pre-signing; the fingerprint MUST hash MESSAGE bytes only per CONTEXT.md `<specifics>` line 65).

2. **`src/signing/presign-hash-solana.ts`** — mirror `presign-hash.ts:34-57`:
   - Researcher Topic 2 locks: Solana SOL app v1.4+ signs the **same message bytes** the fingerprint hashes (Ed25519 signature over the serialized v0 message). Returns `{ messageBytes, presignHash }` — `presignHash = sha256(messageBytes)` (NOT keccak; Ed25519 standard prehash is sha512, but the SOL app displays sha256 of the message at blind-sign time per Ledger docs).
   - Pattern source: presign-hash.ts returns `{ serialized, presignHash }` shape; mirror exactly so `preview_send`'s Solana branch can swap serialized + presignHash by destructuring identical-shape return.
   - Naming: keep `presignHash` field name (NOT `messageHash`) so handle-store's `PreviewPinned.presignHash: Hex` stays uniform.

3. **`src/signing/simulation-solana.ts`** — mirror `simulation.ts:55-83` BUT with MANDATORY-REFUSAL semantics:
   - Export `SimulationStatus = "ok" | "program-error" | "insufficient-lamports" | "error"`.
   - `runSolanaPreviewSimulation(input: { connection, transaction, sender? }): Promise<SimulationResult>` calls `connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true })`. Refuses (returns `program-error` / `insufficient-lamports`) when `result.value.err !== null`; surfaces `result.value.logs` verbatim in the envelope.
   - **Critical deviation from EVM analog:** EVM simulation is ADVISORY (TRUST-BOUNDARY INVARIANT at `simulation.ts:16-19`); Solana simulation is MANDATORY at preview time per SOL-PREP-02. The advisory-vs-mandatory difference is enforced in `preview_send.ts`'s Solana branch (12-04), NOT in this helper — this helper just classifies. Helper still NEVER throws (RPC failures demote to `status: "error"` so preview_send can surface a clear refusal).
   - Export `_simulationSolana = { runSolanaPreviewSimulation }` ESM spy-affordance.

4. **`src/signing/blocks-solana.ts`** — mirror `blocks.ts` shape:
   - `PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE` — slots `{TO}`, `{LAMPORTS}`, `{RECENT_BLOCKHASH}` (+ optional `{NONCE_AUTHORITY}` for durable-nonce mode).
   - `PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE` — slots `{TO}`, `{MINT}`, `{AMOUNT}`, `{RECENT_BLOCKHASH}` (+ optional `{ATA_NOTICE}` when recipient ATA must be created in-tx).
   - `LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE` — same chunked-hex shape as EVM but the user-facing prefix names the SOL app version requirement explicitly ("SOL app v1.4+ clear-signs native + SPL transfers; if you see only a hash, see LEDGER NOTICE block above").
   - `LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE` — emitted only when researcher Topic 4 surfaces a tx shape SOL app does NOT clear-sign (e.g. nonce-init / nonce-close). Mirrors `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` at `blocks.ts:389`.
   - `SIMULATION_BLOCK_SOLANA_TEMPLATE` — slots for `{COMPUTE_UNITS}`, `{LOGS}`, `{ERR}`. Format-fanout-sentinel: rendered HERE, NEVER inlined in preview_send.
   - `VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE` — replaces "Network: Ethereum" line with "Network: Solana mainnet-beta"; otherwise byte-identical to EVM.

5. **`test/signing-fingerprint-solana.test.ts`** — mirror `test/signing-fingerprint.test.ts:10-21` shape (one `it` per fixture):
   - **Fixture K** — native SOL transfer (System Program `Transfer` instruction): `from = persona address (whale)`, `to = 0x...`, `lamports = 1_000_000_000n` (1 SOL), `recentBlockhash = "11111111111111111111111111111111"` (fixed test sentinel). Expected fingerprint pinned as hardcoded `0x...` literal; computed once at PR-write time via `computeSolanaPayloadFingerprint`, written into the test, NEVER snapshot-anchored. Drift in preimage assembly breaks THIS exact assertion at PR-review.
   - **Fixture L** — SPL transfer (Token Program `Transfer` instruction with explicit decimals): `mint = USDC mainnet`, `source = ata(from, mint)`, `destination = ata(to, mint)`, `amount = 100_000_000n` (100 USDC at 6 decimals), `recentBlockhash` as above. Expected fingerprint pinned as hardcoded `0x...` literal.
   - Domain-tag length invariant: `expect(FINGERPRINT_DOMAIN_TAG_SOLANA.length).toBe(21)` (mirror `signing-fingerprint.test.ts:20`).
   - **NO `beforeAll`-snapshot** per CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals" — drift in preimage assembly MUST fail at a specific line, not pass against a self-snapshotted value.

6. **`test/signing-presign-hash-solana.test.ts`** — mirror `test/signing-presign-hash.test.ts:19+`:
   - Single `Fixture K-presign` test pinning `messageBytes` + `presignHash` literals for the Fixture K inputs.

7. **`test/simulation-solana.test.ts`** — mirror `test/simulation.test.ts` (if exists; else mirror `simulation-revert-detection.test.ts` Phase 6 analog):
   - Mock `connection.simulateTransaction`. Three cases: `value.err === null` → `status: "ok"`; `value.err === "InsufficientFundsForRent"` → `status: "insufficient-lamports"`; arbitrary program error → `status: "program-error"`. RPC throw → `status: "error"` (NEVER throws, T-SIMULATION-RPC-FAIL-1 mirror).
   - `_simulationSolana` spy-affordance test (one assertion that `vi.spyOn(_simulationSolana, "runSolanaPreviewSimulation")` intercepts).

### Plan 12-02 — `prepare_solana_native_send` + System Program encoder + handle-store widening

**New files:**
- `src/tools/prepare_solana_native_send.ts`
- `src/protocols/solana-system.ts`
- `src/signing/amount-solana.ts`
- `test/protocols-solana-system.test.ts`
- `test/signing-amount-solana.test.ts`
- `test/prepare-solana-native-send.test.ts`

**Modified files:**
- `src/signing/handle-store.ts` — additive `txType: "evm" | "solana"` discriminator + Solana-shape `PrepareArgs` fields (`mint?`, `lamports?`, `recentBlockhash?`, `nonceAuthority?`).
- `src/tools/register-all.ts` — one additive line (after `prepare_native_send.js` import for cluster locality).

**Primary analog:** [`src/tools/prepare_native_send.ts`](../../src/tools/prepare_native_send.ts) (handler-body shape + JSON-schema validation + PREPARE RECEIPT discipline).

**Bounded diffs:**

1. **`src/signing/handle-store.ts`** — additive widening, FROZEN regions untouched:
   - `PrepareArgs` widens with optional `mint?: string`, `lamports?: string`, `recentBlockhash?: string`, `nonceAuthority?: string` (each `string` per existing normalization-block-at-storage-boundary discipline; Phase 6 already widened this for ERC-20 fields — same pattern).
   - `PreparedTx` widens with a discriminated union: keep existing EVM shape as `{ txType: "evm"; chainId; to; valueWei; data; ... }`; ADD `{ txType: "solana"; messageBytes: Uint8Array; recentBlockhash: string; programIds: string[] }`. Default `txType: "evm"` on every existing handle (back-compat: every Phase 4-11 caller stays byte-identical by adding `txType: "evm"` at the existing `createHandle({ tx: { ... } })` call sites — but the existing handlers can omit since the discriminator defaults to `"evm"` if absent).
   - `PreviewPinned` shape unchanged for EVM. For Solana, the `nonce` / `gas` / `maxFeePerGas` / `maxPriorityFeePerGas` slots are populated with sentinel-zero values (Solana has no gas concept) and `selector` is `null` (Solana programs are addressed by program ID, not by 4-byte selector). NOTE: this is back-compat-friendly because preview_send's Solana branch reads `tx.txType` BEFORE reading any pinned field.
   - `HANDLE_TTL_MS` unchanged (15 min). State machine transitions (`prepared → previewed → sent | cancelled`) unchanged.

2. **`src/protocols/solana-system.ts`** — mirror `src/protocols/erc20.ts` shape:
   - Import `SystemProgram`, `Transaction`, `TransactionInstruction` from `@solana/web3.js` (already wired in `src/chains/solana/sol-rpc-client.ts` per Phase 11).
   - Export `encodeSolanaTransfer(from: PublicKey, to: PublicKey, lamports: bigint): TransactionInstruction` — wraps `SystemProgram.transfer({ fromPubkey, toPubkey, lamports })`.
   - Export `buildSolanaTransferTx(input: { from, to, lamports, recentBlockhash }): { messageBytes: Uint8Array, tx: VersionedTransaction }` — composes a `TransactionMessage.compileToV0Message()` (researcher Topic 1 locks v0 vs legacy).
   - Export `decodeSolanaSystemCall(message: VersionedMessage): { kind: "transfer", to, lamports } | { kind: "unknown" }` — mirrors `decodeErc20Call` discriminated union (Solana-shape).
   - `_solanaSystem = { encodeSolanaTransfer, buildSolanaTransferTx, decodeSolanaSystemCall }` ESM spy-affordance.

3. **`src/signing/amount-solana.ts`** — mirror `src/signing/amount.ts::parseAmountStrict`:
   - Export `parseSolanaAmountStrict(decimal: string, decimals: number): bigint`. SOL fixed at 9 decimals; SPL passes the mint's decimals from `getMint`. Same `InvalidAmountError` class shape (T-PARSE-AMOUNT-1 / T-PARSE-EMPTY-1 mirror).
   - Same off-by-decimal refusal discipline per CLAUDE.md `## Conventions` "Decimal-aware arithmetic".

4. **`src/tools/prepare_solana_native_send.ts`** — mirror `prepare_native_send.ts:132-299` handler-body shape:
   - **DESCRIPTION array** (mirror `prepare_native_send.ts:83-99`) — ≥100 chars per `tools/index.ts:28` `MIN_DESCRIPTION_LEN`. Routing hints first: "Use when the user wants to send native SOL on Solana mainnet-beta. Do NOT use for SPL tokens — that's prepare_solana_spl_send. Do NOT use for Ethereum native transfers — that's prepare_native_send." Decimal-discipline reminder: "`lamports` is the amount in LAMPORTS as a decimal string (10^9 lamports = 1 SOL). Do NOT pass decimal SOL — off-by-decimal is the most common user-facing bug class."
   - **INPUT_SCHEMA** — `to` regex `^[1-9A-HJ-NP-Za-km-z]{32,44}$` (base58 PublicKey shape; mirror `get_solana_balance.ts` validation from Phase 11), `lamports` decimal-string, optional `recentBlockhash` (when caller wants to pre-fetch the blockhash) + optional `useDurableNonce: boolean` (when caller wants to consume a durable-nonce setup from 12-03b). Required: `["to", "lamports"]` (NO `chain` arg — Solana-only tool).
   - **Demo-mode FIRST refusal** — same shape as `prepare_native_send.ts:201-208`; the persona resolution reads from the Solana-side persona registry (Phase 11 Plan 11-06 sibling registry; `getActiveSolanaPersona()`).
   - **Pairing check** — reads from Phase 11's `listAccounts({ chainFilter: "solana" })` not WC `getStatus()`. If no paired Solana account → `WALLET_NOT_PAIRED` with hint "Call pair_solana_ledger first."
   - **Recent-blockhash resolution** — call `connection.getLatestBlockhash()` via Phase 11's `src/chains/solana/registry.ts::getConnection()`. Pin onto the handle so preview_send doesn't re-fetch (mirrors EVM nonce/gas pin at preview time — but for Solana the blockhash MUST be pinned at PREPARE so the message bytes are byte-stable across preview / send; the 150-slot window starts ticking AT prepare).
   - **Build tx + compute fingerprint** — call `buildSolanaTransferTx(...)`, then `computeSolanaPayloadFingerprint({ messageBytes })`.
   - **`createHandle`** — pass `txType: "solana"` discriminator + Solana-shape `PrepareArgs` (`to`, `lamports` as raw decimal string, `recentBlockhash`) + `PreparedTx` with `messageBytes`.
   - **PREPARE RECEIPT** — substitute from `PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE` (12-01 Plan ships); read EXCLUSIVELY from `args.to` + `args.lamports` (RAW agent strings). Verbatim per PREP-02 + T-PREP-RCPT-1 invariant — NEVER surface the base58-checksummed form of `to`.
   - **Locked errorCode set:** `WALLET_NOT_PAIRED`, `WRONG_MODE`, `INVALID_INPUT`, `RPC_FAILURE` (new — for `getLatestBlockhash` failures), `INTERNAL_ERROR`.

5. **`src/tools/register-all.ts`** — one additive import line: `import "./prepare_solana_native_send.js";` after line 23 (`prepare_token_send.js`) to group with prepare tools.

6. **Test file:** `test/prepare-solana-native-send.test.ts` — mirror `test/prepare-native-send.test.ts` (672 LOC) end-to-end. Cross-link Fixture K from `signing-fingerprint-solana.test.ts` (mirror the cross-link pattern at `prepare-native-send.test.ts` for Fixture A).

### Plan 12-03 — `prepare_solana_spl_send` + SPL encoder + token-metadata helper

**New files:**
- `src/tools/prepare_solana_spl_send.ts`
- `src/protocols/solana-spl.ts`
- `test/protocols-solana-spl.test.ts`
- `test/prepare-solana-spl-send.test.ts`

**Modified files:**
- `src/tools/register-all.ts` — one additive line.

**Primary analog:** [`src/tools/prepare_token_send.ts`](../../src/tools/prepare_token_send.ts) (handler-body shape) + [`src/protocols/erc20.ts`](../../src/protocols/erc20.ts) (encoder + decoder split).

**Bounded diffs:**

1. **`src/protocols/solana-spl.ts`** — mirror `src/protocols/erc20.ts:78-103`:
   - Import `createTransferInstruction`, `getAssociatedTokenAddress`, `createAssociatedTokenAccountInstruction` from `@solana/spl-token` (already wired per `src/chains/solana/sol-rpc-client.ts:36`).
   - Export `encodeSplTransfer(input: { source, destination, owner, mint, amount, decimals }): TransactionInstruction[]` — returns `[createTransferInstruction(source, destination, owner, amount)]` for happy path; PREPENDS `[createAssociatedTokenAccountInstruction(payer, destination, recipientPubkey, mint)]` when the destination ATA does not exist (researcher Topic 5 locks: recipient-ATA-creation is bundled into the same tx, paid by sender — surface in PREPARE RECEIPT block as `{ATA_NOTICE}` slot).
   - Export `decodeSplCall(instructionData: Uint8Array): { kind: "transfer", source, destination, amount } | { kind: "unknown" }` for preview_send's decoded-args block.
   - Export `deriveAtaForOwner(owner: PublicKey, mint: PublicKey): Promise<PublicKey>` — wraps `getAssociatedTokenAddress`.
   - `_solanaSpl = { encodeSplTransfer, decodeSplCall, deriveAtaForOwner }` ESM spy-affordance.

2. **`src/tools/prepare_solana_spl_send.ts`** — mirror `prepare_token_send.ts:129-316`:
   - **INPUT_SCHEMA** — `to` (base58 PublicKey), `mint` (base58 PublicKey for the SPL mint), `amount` (decimal string in human units — e.g. `"100.5"` for 100.5 USDC). Optional `from` (for sender selection — Solana persona registry has 1 persona in v1.x but the surface is forward-compat).
   - **Decimal resolution** — call Phase 11's `get_solana_token_metadata` helper for `mint` decimals (NOT the EVM token registry — different chain). Cache miss → live `getMint` RPC call.
   - **Amount parsing** — call `parseSolanaAmountStrict(rawAmount, decimals)` from Plan 12-02. INVALID_INPUT on rejected shape.
   - **ATA derivation** — call `deriveAtaForOwner(toPubkey, mintPubkey)` for both sender + recipient. Check destination ATA existence via `connection.getAccountInfo(destinationAta)`. When missing, encode the create-ATA instruction as the FIRST instruction in the tx; surface `{ATA_NOTICE}` slot in the PREPARE RECEIPT block ("This tx will also create the recipient's USDC account (rent: ~0.002 SOL paid by you)").
   - **Build tx + compute fingerprint** — same shape as 12-02. Fingerprint binds the FULL message bytes including the optional create-ATA instruction; an attacker who flips the create-ATA flag post-prepare also flips the fingerprint.
   - **PREPARE RECEIPT** — substitute from `PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE`. The receipt body shows `{TO}`, `{MINT}`, `{AMOUNT}`, and conditionally `{ATA_NOTICE}`. Read EXCLUSIVELY from `args.to`, `args.mint`, `args.amount` per PREP-02.
   - **Sender-dependent fingerprint** — UNLIKE native SOL (sender-independent because System Program `Transfer` preimage carries `from` as message-level `feePayer`), SPL fingerprints ARE sender-dependent because the source ATA is derived from sender + mint. Persona-cycle integration test (12-06) asserts this property explicitly (mirror Phase 7's `T-INTEGRATION-FROM-DRIFT-2` shape per CONTEXT.md `<decisions>` line 26).

3. **`src/tools/register-all.ts`** — one additive line: `import "./prepare_solana_spl_send.js";` after the 12-02 insertion.

4. **Test file:** `test/prepare-solana-spl-send.test.ts` — mirror `test/prepare-token-send.test.ts` (541 LOC). Cross-link Fixture L from `signing-fingerprint-solana.test.ts`. Include a regression test for the ATA-creation-bundled case (researcher Topic 5).

### Plan 12-04 — `preview_send` Solana branch + simulation gate + Ledger transport `signTransaction` widening

**New files:** none (additive only).

**Modified files:**
- `src/tools/preview_send.ts` — additive Solana branch via `record.tx.txType` discriminator.
- `src/wallet/ledger-solana-transport.ts` — additive `signTransaction()` export + `_transport.signTransaction` indirection (per-call transport, NOT singleton — Phase 11 invariant unchanged).
- `src/security/canonical-dispatch-solana.ts` — NEW: program-ID allowlist for v1.x (System Program + Token Program only; MarginFi / Kamino / Jupiter / Marinade land in Phase 13-15).
- `test/preview-send.solana.test.ts` — NEW: mirror `test/preview-send.test.ts` Solana branch.
- `test/canonical-dispatch-solana.test.ts` — NEW: allowlist + refusal cases.
- `test/ledger-solana-transport.signtx.test.ts` — NEW: `signTransaction` spy + per-call transport close-after-sign discipline.

**Primary analog:** [`src/tools/preview_send.ts`](../../src/tools/preview_send.ts) + [`src/security/canonical-dispatch.ts`](../../src/security/canonical-dispatch.ts) + [`src/wallet/ledger-solana-transport.ts`](../../src/wallet/ledger-solana-transport.ts) (`_transport` indirection at line 101).

**Bounded diffs:**

1. **`src/tools/preview_send.ts`** — additive Solana branch. **FROZEN regions untouched:**
   - Lines 1-148 (imports + DESCRIPTION + INPUT_SCHEMA) — additive only (new imports for Solana modules).
   - Lines 144-159 (handle lookup + HANDLE_NOT_FOUND / HANDLE_EXPIRED) — UNCHANGED.
   - INSERTION POINT: AFTER line 159 (`const record = lookupResult.record;`), BEFORE line 161 (Layer 0.5 dispatch check):
     ```typescript
     // Phase 12 — dispatch on tx-type discriminator. EVM branch (below)
     // is byte-identical to v1.0-1.3; Solana branch routes through the
     // sibling pipeline. txType defaults to "evm" for back-compat with
     // every Phase 4-11 handle.
     const txType = record.tx.txType ?? "evm";
     if (txType === "solana") {
       return await previewSendSolanaBranch(record, args);
     }
     // ===== EVM branch (FROZEN — Phase 4-9 byte-identical) =====
     ```
   - The Solana branch is extracted to a separate function `previewSendSolanaBranch(record, args)` in the same file (NOT a separate module — keeps the discriminator + dispatcher visible in one file). The function:
     - Re-runs Layer 0.5 canonical-dispatch via `_canonicalDispatchSolana.checkSolanaDispatchTarget(record.tx.programIds)` (refuses if any program ID is outside the System + Token Program allowlist).
     - Skips Layer 2 chain-id mismatch (Solana has no `chainId` concept; the dispatcher already routed to the Solana arm).
     - **MANDATORY simulation** — calls `_simulationSolana.runSolanaPreviewSimulation(...)`; if `status !== "ok"` REFUSES with structured error (NOT advisory like EVM). errorCode `SIMULATION_REFUSED` (NEW — locked at the error-codes module; see §Shared Patterns).
     - Recomputes `presignHash` via `computePresignHashSolana({ messageBytes: record.tx.messageBytes })`.
     - Calls `transitionToPreviewed` with `pinned = { nonce: 0, gas: 0n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, previewToken, presignHash, selector: null }` (sentinel zeros for Solana — keeps `PreviewPinned` type-stable; preview_send's Solana branch reads `presignHash` + `previewToken` only).
     - Emits text blocks: `LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE`, decoded-args block (via `_solanaSystem.decodeSolanaSystemCall` or `_solanaSpl.decodeSplCall` depending on instruction list), `SIMULATION_BLOCK_SOLANA_TEMPLATE`, `VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE`.

2. **`src/wallet/ledger-solana-transport.ts`** — additive `signTransaction` export:
   - Add to `_transport` indirection (line 101): `signTransactionViaApp: (app, derivationPath, messageBytes) => app.signTransaction(derivationPath, messageBytes)`.
   - Export `signSolanaTransaction(messageBytes: Buffer, derivationPath?: string): Promise<{ signature: Buffer }>` mirroring `fetchSolanaAddress` shape at lines 153-176. **Per-call transport** — opens fresh USB-HID, signs, closes in `finally` (researcher Topic 7 lock; no singleton drift). The `app.signTransaction(...)` call triggers the on-device approval flow (Ledger SOL app v1.4+ clear-signs native + SPL transfers; user sees decoded recipient + amount).
   - Throws `LedgerDeviceNotConnectedError` / `LedgerSolanaAppNotOpenError` / `LedgerSolanaUserRejectedError` (NEW class — mirror `isUserRejectedError` from `wc-errors.ts`).
   - Test-only `_resetLedgerSolanaTransportForTesting()` already exists (line 184); no widening needed.

3. **`src/security/canonical-dispatch-solana.ts`** — mirror `src/security/canonical-dispatch.ts` shape:
   - Export `SOLANA_DISPATCH_ALLOWLIST: Set<string>` — System Program ID + SPL Token Program ID + (per researcher Topic 6) System Program durable-nonce instructions allowed only if the program ID is System Program AND the instruction is one of `{ nonceAdvance, nonceInitialize, nonceWithdraw, nonceAuthorize }`. Marinade / Jito / MarginFi / Kamino / Jupiter / LiFi land in Phase 13-16.
   - Export `_canonicalDispatchSolana = { checkSolanaDispatchTarget }` ESM spy-affordance.
   - Refusal envelope shape mirrors `checkDispatchTarget` at `canonical-dispatch.ts` — returns `{ kind: "allowed" } | { kind: "refused"; programId, allowlist }`.

### Plan 12-05 — `send_transaction` Solana branch + USB-HID routing + integration test

**New files:**
- `test/send-transaction.solana.test.ts`
- `test/solana-trust-pipeline.integration.test.ts` — **LOAD-BEARING end-to-end test (mirror `test/trust-pipeline.integration.test.ts:1-30` discipline; STOP-THE-LINE if it fails)**

**Modified files:**
- `src/tools/send_transaction.ts` — additive Solana branch AFTER the FROZEN three-gate region.
- `src/tools/get_tx_verification.ts` — additive Solana `txJson` re-emit branch.
- `test/get-tx-verification.solana.test.ts` — NEW (mirror `test/get-tx-verification.test.ts`).

**Primary analog:** [`src/tools/send_transaction.ts`](../../src/tools/send_transaction.ts) (three-gate region at lines 195-316 + transport call at lines 434-495).

**Bounded diffs:**

1. **`src/tools/send_transaction.ts`** — additive Solana branch. **FROZEN region (lines 195-316) untouched byte-for-byte:**
   - PREVIEW_REQUIRED gate (lines 199-214) — applies UNCHANGED to Solana handles.
   - WRONG_STATUS gate (lines 215-235) — applies UNCHANGED.
   - Cancel branch (lines 242-268) — applies UNCHANGED.
   - PREVIEW_TOKEN_MISMATCH gate (lines 270-287) — applies UNCHANGED.
   - PAYLOAD_FINGERPRINT_DRIFT recompute (lines 289-316) — extended via dispatcher: if `record.tx.txType === "solana"`, call `computeSolanaPayloadFingerprint({ messageBytes: record.tx.messageBytes })`; else (default `"evm"`), call existing `computePayloadFingerprint(...)`. The drift gate FIRES identically on both branches.
   - **INSERTION POINT: AFTER line 316 (post-FROZEN-three-gate region), BEFORE line 318 (DEMO-05 block):**
     ```typescript
     // Phase 12 — Solana branch dispatch. EVM branch (below) is byte-
     // identical to v1.0-1.3; Solana branch routes through USB-HID.
     // The three gates above applied identically to both branches; only
     // the transport call differs.
     const txType = record.tx.txType ?? "evm";
     if (txType === "solana") {
       return await sendTransactionSolanaBranch(record, args, handleArg);
     }
     // ===== EVM branch (FROZEN — DEMO-05 + WC routing unchanged) =====
     ```
   - The Solana branch (extracted function `sendTransactionSolanaBranch`):
     - Demo-mode short-circuit (mirror lines 325-389) — returns a Solana-shape simulation envelope: `{ simulated: true, simulationResult: <logs>, simulationError, simulatedAt, handle, txType: "solana" }`. Calls `_simulationSolana.runSolanaPreviewSimulation(...)` against the persona address; NOTHING signed; NOTHING broadcast.
     - Real-mode: confirms paired Solana account via Phase 11's `listAccounts({ chainFilter: "solana" })` (NOT WC `getStatus()`). Refuses `WALLET_NOT_PAIRED` if no account.
     - Builds the full versioned transaction from `record.tx.messageBytes` (the same bytes the fingerprint hashed).
     - Calls `signSolanaTransaction(messageBytes, derivationPath)` from Plan 12-04. This opens fresh USB-HID, triggers on-device approval, returns `{ signature }`, closes transport.
     - Attaches signature to the v0 transaction, serializes, broadcasts via `connection.sendRawTransaction(serializedTx)` (researcher Topic 8 confirms this is the canonical broadcast path — Solana has no "Live broadcasts internally" equivalent to WC).
     - Transitions handle to `sent`, stamps `txHash` (Solana signature in base58 — return as `Hex` for handle-store type-stability, store as `0x${hexEncodedSignature}` since handle-store's `txHash: Hex` is locked. Alt: widen handle-store `txHash` to `string` for cross-chain. Planner picks; recommend wider).
     - Locked error codes: `WALLET_NOT_PAIRED`, `LEDGER_REJECTED` (new sibling — mirror `isUserRejectedError`), `LEDGER_NOT_CONNECTED`, `SOLANA_APP_NOT_OPEN`, `BROADCAST_FAILED`, `INTERNAL_ERROR`.

2. **`src/tools/get_tx_verification.ts`** — additive Solana `txJson` branch:
   - Demo-mode refusal (lines 80-92) UNCHANGED.
   - Handle lookup (lines 95-106) UNCHANGED.
   - INSERTION POINT: AFTER line 108 (`const record = lookupResult.record;`):
     ```typescript
     const txType = record.tx.txType ?? "evm";
     if (txType === "solana") {
       return getTxVerificationSolanaBranch(record, handleArg);
     }
     // ===== EVM branch (UNCHANGED — Plan 09-05 v1.3 txJson re-emit) =====
     ```
   - The Solana branch (extracted function `getTxVerificationSolanaBranch`):
     - PREPARE RECEIPT re-emit via `PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE` or `_SPL_TEMPLATE` (dispatcher on whether `record.args.mint` is set).
     - `txJson` re-emit: `{ txType: "solana", messageBytes: "0x" + hex(record.tx.messageBytes), recentBlockhash, programIds }` (decimal strings for any bigint fields per existing convention).
     - LEDGER BLIND-SIGN HASH re-emit via `LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE` (uses `pinned.presignHash`).
     - BROADCAST CONFIRMATION / CANCELLED footers UNCHANGED in shape (just substitute Solana txHash format).

3. **`test/solana-trust-pipeline.integration.test.ts`** — LOAD-BEARING test, mirror `test/trust-pipeline.integration.test.ts:1-30` discipline. Asserts:
   - **prepare-time fingerprint == send-time recomputed fingerprint** (the Layer 3 trust-binding invariant — extends from EVM to Solana).
   - **preview-time presignHash == device-displayed presignHash** (mock `_transport.signTransactionViaApp` asserts the messageBytes passed in match the fingerprint preimage byte-for-byte).
   - **persona-cycle byte-identity for native SOL** (sender-independent: fingerprint stable across persona swap because System Program `Transfer` preimage carries `from` ONLY via the message-level `feePayer`, which IS in the message bytes — but fingerprint is over `(messageBytes)` directly; persona-cycle re-anchors Fixture K). Note: this is a subtle point — researcher Topic 3 should confirm whether Solana fingerprint is truly sender-independent (EVM is by construction because `from` is NOT in the EIP-1559 preimage; Solana `feePayer` IS in the v0 message).
   - **persona-cycle sender-DEPENDENCE for SPL** (mirror Phase 7 `T-INTEGRATION-FROM-DRIFT-2` shape per CONTEXT.md `<decisions>` line 26 — source ATA derives from sender, so two personas produce different fingerprints; test asserts the DELTA is nonzero AND that each persona's fingerprint matches its own pinned literal).
   - **STOP-THE-LINE label** in the test header — release blocker if it fails.

### Plan 12-06 — Durable-nonce setup/teardown tools (OPTIONAL — may defer)

**New files (if shipped):**
- `src/tools/prepare_solana_nonce_init.ts`
- `src/tools/prepare_solana_nonce_close.ts`
- `test/prepare-solana-nonce-init.test.ts`
- `test/prepare-solana-nonce-close.test.ts`

**Modified files:**
- `src/tools/register-all.ts` — two additive lines.

**Primary analog:** [`src/tools/prepare_native_send.ts`](../../src/tools/prepare_native_send.ts) (handler-body shape — these are scaffolding tools that go through the same prepare → preview → send pipeline).

**Bounded diffs:**

1. **`prepare_solana_nonce_init.ts`** — System Program `createNonceAccount` instruction. Caller provides `noncePubkey` (generated keypair the user holds) + `lamports` (rent-exempt amount, fetchable via `Connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH)`). Tx instructions: `[SystemProgram.createAccount, SystemProgram.nonceInitialize]`. PREPARE RECEIPT names the new nonce account explicitly + the authority address.

2. **`prepare_solana_nonce_close.ts`** — System Program `nonceWithdraw` instruction (full withdraw collapses the account, reclaims rent). Caller provides `noncePubkey` + `recipient` (where to send the reclaimed rent SOL).

3. **Allowlist widening:** Plan 12-04's `SOLANA_DISPATCH_ALLOWLIST` includes the `nonceInitialize` / `nonceWithdraw` instructions of System Program. The Phase 12-04 allowlist commit includes these from the start IF this plan ships in Phase 12; otherwise Phase 12-04 ships a narrower allowlist and 12-06 widens.

**DEFER recommendation:** Per ROADMAP Phase 12 line 309 the durable-nonce tools are part of Phase 12 success criteria #6. But per CONTEXT.md `<deferred>` and the researcher's recommendation gate (Topic 8: durable-nonce vs 150-slot recent-blockhash trade-off), shipping these is OPT-IN for users with long sign-cycles (hardware wallets behind air-gapped flows). Recommend ship-as-12-06 inside this phase if the user actually needs > 1-min prepare → sign latency; else defer to v2.0.1 verify-phase.

---

## Test Patterns (per new plan)

Every new test mirrors the EXACT shape of the named v1.x analog. Conventions:
- Same `vi.mock` factories
- Same `beforeEach` / `afterEach` env-pin + reset-for-testing pair
- Same `_resetX` test-only-reset call
- Same `vi.spyOn(_<scope>, "method")` indirection pattern
- **Fixture pins as hardcoded `0x...` literals; NEVER `beforeAll`-snapshot** (CLAUDE.md `## Conventions`)

| New Test | Mirror | Notes |
|---|---|---|
| `test/signing-fingerprint-solana.test.ts` | [`test/signing-fingerprint.test.ts`](../../test/signing-fingerprint.test.ts) (197 LOC) | **Fixture K + L hardcoded literals**; domain-tag length invariant (21 bytes vs EVM's 23); NO `beforeAll`-snapshot |
| `test/signing-presign-hash-solana.test.ts` | [`test/signing-presign-hash.test.ts`](../../test/signing-presign-hash.test.ts) (67 LOC) | Single Fixture-K-presign literal pin (`{ messageBytes, presignHash }`) |
| `test/simulation-solana.test.ts` | [`test/simulation.test.ts`](../../test/simulation.test.ts) (or `simulation-revert-detection.test.ts` Phase 6 analog) | 3 status cases; NEVER-throws regression; `_simulationSolana` spy intercept |
| `test/protocols-solana-system.test.ts` | [`test/protocols-erc20.test.ts`](../../test/protocols-erc20.test.ts) | encode + decode round-trip; selector-routed dispatch surface; `_solanaSystem` spy |
| `test/protocols-solana-spl.test.ts` | [`test/protocols-erc20.test.ts`](../../test/protocols-erc20.test.ts) | encode (with + without prepended create-ATA); ATA-derivation regression; `_solanaSpl` spy |
| `test/signing-amount-solana.test.ts` | [`test/signing-amount.test.ts`](../../test/signing-amount.test.ts) (Phase 6 / Plan 06-01) | parse strict; lamports vs wei; off-by-decimal refusal |
| `test/prepare-solana-native-send.test.ts` | [`test/prepare-native-send.test.ts`](../../test/prepare-native-send.test.ts) (672 LOC) | Demo-FIRST + pairing check + payloadFingerprint binding + PREPARE RECEIPT verbatim; cross-link Fixture K |
| `test/prepare-solana-spl-send.test.ts` | [`test/prepare-token-send.test.ts`](../../test/prepare-token-send.test.ts) (541 LOC) | Above + decimal resolution + ATA-creation regression; cross-link Fixture L |
| `test/canonical-dispatch-solana.test.ts` | [`test/canonical-dispatch.test.ts`](../../test/canonical-dispatch.test.ts) | System + Token Program allowed; Marinade / Jito / MarginFi refused; `_canonicalDispatchSolana` spy |
| `test/preview-send.solana.test.ts` | [`test/preview-send.test.ts`](../../test/preview-send.test.ts) (802 LOC) | Solana branch dispatch; mandatory simulation refusal (NOT advisory); `previewToken` mint |
| `test/ledger-solana-transport.signtx.test.ts` | [`test/wallet-walletconnect-client.test.ts`](../../test/wallet-walletconnect-client.test.ts) (273 LOC) + [`test/ledger-solana-transport.test.ts`](../../test/ledger-solana-transport.test.ts) (Phase 11) | per-call transport: open → sign → close in finally; `signTransactionViaApp` spy |
| `test/send-transaction.solana.test.ts` | [`test/send-transaction.test.ts`](../../test/send-transaction.test.ts) (768 LOC) | Solana branch dispatch; **3 FROZEN gates re-anchored byte-identical for Solana**; demo simulation envelope; USB-HID routing |
| `test/get-tx-verification.solana.test.ts` | [`test/get-tx-verification.test.ts`](../../test/get-tx-verification.test.ts) (494 LOC) | Solana `txJson` re-emit; previewed / sent / cancelled status surfaces |
| `test/solana-trust-pipeline.integration.test.ts` | [`test/trust-pipeline.integration.test.ts`](../../test/trust-pipeline.integration.test.ts) (393 LOC) + [`test/erc20-lifecycle.integration.test.ts`](../../test/erc20-lifecycle.integration.test.ts) (482 LOC) | **LOAD-BEARING — STOP-THE-LINE on fail.** Native-sender-independent + SPL-sender-dependent persona-cycle byte-identity |

---

## Shared Patterns (cross-cutting; apply to every relevant plan)

### Pattern A — ESM spy-affordance indirection (CLAUDE.md convention)

**Source:** [`src/signing/simulation.ts:90`](../../src/signing/simulation.ts) (`_simulation`); [`src/protocols/erc20.ts:180`](../../src/protocols/erc20.ts) (`_protocols`); [`src/wallet/ledger-solana-transport.ts:101`](../../src/wallet/ledger-solana-transport.ts) (`_transport`).

**Apply to:**
- `payload-fingerprint-solana.ts` — export `_solanaFingerprint = { computeSolanaPayloadFingerprint }`
- `presign-hash-solana.ts` — export `_solanaPresign = { computePresignHashSolana }`
- `simulation-solana.ts` — export `_simulationSolana = { runSolanaPreviewSimulation }`
- `protocols/solana-system.ts` — export `_solanaSystem = { encodeSolanaTransfer, buildSolanaTransferTx, decodeSolanaSystemCall }`
- `protocols/solana-spl.ts` — export `_solanaSpl = { encodeSplTransfer, decodeSplCall, deriveAtaForOwner }`
- `security/canonical-dispatch-solana.ts` — export `_canonicalDispatchSolana = { checkSolanaDispatchTarget }`
- `wallet/ledger-solana-transport.ts` — WIDEN existing `_transport` (line 101) with `signTransactionViaApp`

Pattern is non-optional per CLAUDE.md "Add the indirection at write time, not retroactively."

### Pattern B — Fixture literal anchors (CLAUDE.md "Cryptographic-binding fixtures")

**Source:** [`test/signing-fingerprint.test.ts:10-21`](../../test/signing-fingerprint.test.ts) Fixture A through H.

**Apply to:** Fixture K (native SOL) + Fixture L (SPL) in `test/signing-fingerprint-solana.test.ts`. Each fingerprint pinned as hardcoded `0x...` literal. Cross-link from every consumer test (`prepare-solana-native-send.test.ts`, `prepare-solana-spl-send.test.ts`, `preview-send.solana.test.ts`, `solana-trust-pipeline.integration.test.ts`). NO `beforeAll`-snapshot per CLAUDE.md.

### Pattern C — Demo-mode FIRST refusal

**Source:** [`src/tools/prepare_native_send.ts:201-208`](../../src/tools/prepare_native_send.ts) + [`src/tools/preview_send.ts:274-292`](../../src/tools/preview_send.ts).

**Apply to:** Every new `prepare_solana_*` tool. The persona resolution uses `getActiveSolanaPersona()` (Phase 11 Plan 11-06's sibling persona registry — NOT EVM `getActivePersona()`). Refuses `WRONG_MODE` when demo mode is active but no Solana persona is set.

### Pattern D — PREPARE RECEIPT verbatim (PREP-02)

**Source:** [`src/tools/prepare_native_send.ts:241-260`](../../src/tools/prepare_native_send.ts) (`PREPARE_RECEIPT_TEMPLATE` substitution from raw `args.to` + `args.valueWei` — NEVER from server-internal `tx.to`).

**Apply to:** `prepare_solana_native_send.ts` + `prepare_solana_spl_send.ts`. Receipt body reads EXCLUSIVELY from `args.to`, `args.lamports`, `args.mint`, `args.amount` (raw agent strings). NEVER substitute the base58-checksummed form (which would surface a normalized address back to the user — defense-in-depth against agent-side normalization drift).

### Pattern E — `payloadFingerprint` drift gate (PREP-08)

**Source:** [`src/tools/send_transaction.ts:289-316`](../../src/tools/send_transaction.ts).

**Apply to:** `send_transaction.ts` Solana branch — the recompute fires identically (mirror lines 295-300 with `computeSolanaPayloadFingerprint({ messageBytes: record.tx.messageBytes })`). Test mutates the STORED `record.payloadFingerprint` to prove the gate works against the actual attack model (mirror line 293 comment + Test 4).

### Pattern F — Tool description as agent routing prompt

**Source:** [`src/tools/prepare_native_send.ts:83-99`](../../src/tools/prepare_native_send.ts) (DESCRIPTION array → `.join(" ")`).

**Apply to:** Every new Solana tool's `DESCRIPTION`. Routing hints first: "Use when X (Solana native SOL transfer). Do NOT use for Y (SPL — that's prepare_solana_spl_send). Do NOT use for Z (EVM native — that's prepare_native_send)." ≥100 chars per `tools/index.ts:28`.

### Pattern G — Decimal-string at the boundary

**Source:** [`src/tools/prepare_token_send.ts:217-242`](../../src/tools/prepare_token_send.ts) (`parseAmountStrict` from Plan 06-01).

**Apply to:** `prepare_solana_native_send.ts` (lamports as decimal string; SOL fixed at 9 decimals) + `prepare_solana_spl_send.ts` (human units; mint decimals via `get_solana_token_metadata`). Off-by-decimal is the most common user-facing bug class per CLAUDE.md.

### Pattern H — Locked errorCode envelopes

**Source:** [`src/tools/prepare_native_send.ts:75-81`](../../src/tools/prepare_native_send.ts) (`errEnvelope` + `makeStructuredError`) + [`src/signing/error-codes.ts:81-118`](../../src/signing/error-codes.ts).

**Apply to:** Every new Solana tool. **NEW errorCodes for Phase 12 (must add to `error-codes.ts` `ErrorCode` union):**
- `SIMULATION_REFUSED` — Solana simulation gate refusal (NOT in EVM; EVM simulation is advisory).
- `LEDGER_NOT_CONNECTED` — sibling of WC `WALLET_NOT_PAIRED` but for USB-HID (Phase 11 Plan 11-04 already adds this — confirm not duplicated).
- `SOLANA_APP_NOT_OPEN` — Phase 11 already adds (confirm).
- `RPC_FAILURE` — `getLatestBlockhash` / `getMinimumBalanceForRentExemption` / `simulateTransaction` failures (sibling of EVM's `INTERNAL_ERROR` but distinguished so the agent can route retries).

Confirm with researcher Topic 9 (handle-store discriminator + error-code union widening) which codes already exist post-Phase-11.

### Pattern I — Mandatory-vs-Advisory simulation distinction

**Source:** [`src/signing/simulation.ts:16-19`](../../src/signing/simulation.ts) (TRUST-BOUNDARY INVARIANT: EVM simulation is advisory, NOT the trust anchor).

**Apply to:** `simulation-solana.ts` + `preview_send.ts` Solana branch. Solana simulation is MANDATORY at preview time per SOL-PREP-02 — `status !== "ok"` REFUSES with `SIMULATION_REFUSED` instead of surfacing as informational. The advisory-vs-mandatory difference is the load-bearing Layer-0.7 defense per CONTEXT.md `<decisions>` line 22.

### Pattern J — Per-call USB-HID transport (Phase 11 invariant)

**Source:** [`src/wallet/ledger-solana-transport.ts:122-135`](../../src/wallet/ledger-solana-transport.ts) (`openTransport` is per-call NOT singleton; caller MUST close in finally).

**Apply to:** New `signSolanaTransaction` export — same per-call pattern. The `try { ... } finally { await transport.close(); }` shape at lines 156-176 is the template. Test `ledger-solana-transport.signtx.test.ts` asserts `transport.close()` is called in every path (happy + every error class).

---

## FROZEN areas (do NOT touch — verified absent from every plan's "Modified files")

Per project CLAUDE.md `## Architecture` + Phase 4-11 retros — the EVM cryptographic-binding pipeline is byte-frozen. Phase 12 sits SIDE-BY-SIDE; it never modifies these files:

- [`src/signing/payload-fingerprint.ts`](../../src/signing/payload-fingerprint.ts) — FROZEN (Solana version is a sibling, NEVER an extension)
- [`src/signing/presign-hash.ts`](../../src/signing/presign-hash.ts) — FROZEN (Solana version is a sibling)
- [`src/signing/simulation.ts`](../../src/signing/simulation.ts) — FROZEN (Solana version is a sibling)
- [`src/signing/blocks.ts`](../../src/signing/blocks.ts) — FROZEN (Solana templates in sibling `blocks-solana.ts`; EVM templates untouched)
- [`src/signing/amount.ts`](../../src/signing/amount.ts) — FROZEN (`parseSolanaAmountStrict` is a sibling export in `amount-solana.ts`)
- [`src/signing/resolve-from.ts`](../../src/signing/resolve-from.ts) — FROZEN (Solana sender resolution lives in `prepare_solana_*` tools directly; no EVM-style multi-account surface in v1.x Solana)
- [`src/signing/aave-health.ts`](../../src/signing/aave-health.ts) — FROZEN (Aave is EVM-only)
- [`src/security/canonical-dispatch.ts`](../../src/security/canonical-dispatch.ts) — FROZEN (Solana allowlist lives in sibling `canonical-dispatch-solana.ts`)
- [`src/security/skill-integrity.ts`](../../src/security/skill-integrity.ts) — FROZEN
- [`src/protocols/erc20.ts`](../../src/protocols/erc20.ts) / `weth9.ts` / `aave-v3.ts` — FROZEN
- **`src/tools/send_transaction.ts` lines 195-316 (FROZEN three-gate region)** — additive Solana branch lands AT line 317 (post-FROZEN-region), BEFORE line 318 (DEMO-05). The gates above apply identically to both branches via the txType discriminator that lives inside the FROZEN region only at the PAYLOAD_FINGERPRINT_DRIFT recompute (which dispatches on `record.tx.txType` — this is the one byte-level addition inside the FROZEN region, surfaced explicitly to the planner as the trust-binding extension point. The recompute call signature widens via a discriminated dispatch; the gate's BEHAVIOR is byte-identical for EVM handles).
- **`src/tools/preview_send.ts` lines 161-419 (FROZEN EVM body)** — additive Solana branch dispatch lands AT line 160 (post-handle-lookup, pre-Layer-0.5). EVM body untouched.

**Verification:** Every plan in this PATTERNS.md leaves the FROZEN list untouched. The two FROZEN-but-modified files (`preview_send.ts` + `send_transaction.ts`) have explicit insertion-point line numbers + a single-line discriminator dispatch; the EVM body is byte-identical. **Status: all FROZEN files NOT touched — verified.**

---

## Coordination Points (multi-plan carve)

### `src/tools/register-all.ts` — touched by Plans 12-02 + 12-03 (+ 12-06 if shipped)

Per Phase 8-11 precedent: assign line-number ranges per plan at carve time so parallel waves can independently append without textual collision:

| Plan | Imports added | Position rule |
|---|---|---|
| 12-02 | `prepare_solana_native_send` | After line 23 (`prepare_token_send.js`) — group with prepare tools |
| 12-03 | `prepare_solana_spl_send` | After 12-02's insertion |
| 12-06 (optional) | `prepare_solana_nonce_init`, `prepare_solana_nonce_close` | After 12-03's insertion |

When 12-02 + 12-03 land in the same wave, the merge is conflict-free because each plan's insertion is at the agreed deterministic line.

### `src/tools/preview_send.ts` — touched by Plan 12-04 ONLY

Single-plan modification. Solana branch dispatcher at line 160 (one-line addition); extracted Solana branch function at the BOTTOM of the file (after the EVM body, before the closing handler return).

### `src/tools/send_transaction.ts` — touched by Plan 12-05 ONLY

Single-plan modification. **Three-gate FROZEN region (lines 195-316) untouched byte-for-byte.** Solana branch dispatcher at line 317 (one-line addition); extracted Solana branch function at the BOTTOM of the file.

### `src/tools/get_tx_verification.ts` — touched by Plan 12-05 ONLY

Single-plan modification. Solana branch dispatcher at line 108 (one-line addition); extracted Solana branch function at the BOTTOM of the file.

### `src/signing/handle-store.ts` — touched by Plan 12-02 ONLY

Single-plan modification. **Additive widening:**
- `PrepareArgs` interface widens with optional `mint?`, `lamports?`, `recentBlockhash?`, `nonceAuthority?` fields (Phase 6 already widened this for ERC-20 — same additive pattern).
- `PreparedTx` interface widens to a discriminated union via optional `txType?: "evm" | "solana"` (default `"evm"` for back-compat) + Solana-shape fields (`messageBytes?`, `recentBlockhash?`, `programIds?`).
- State machine transitions UNCHANGED. TTL UNCHANGED. Spy-affordance test-only resets UNCHANGED.

### `src/wallet/ledger-solana-transport.ts` — touched by Plan 12-04 ONLY

Single-plan modification. `_transport` indirection at line 101 widens with `signTransactionViaApp`. New top-level `signSolanaTransaction` export at the bottom of the file. Per-call transport invariant UNCHANGED.

### `src/signing/error-codes.ts` — touched by Plan 12-01 OR 12-04

Single-plan modification. The `ErrorCode` union widens with `SIMULATION_REFUSED` + `RPC_FAILURE` (sibling of `INTERNAL_ERROR` but routes retries). Recommend landing in 12-01 alongside the new simulation module so the error code is in scope from the start. Verify against Phase 11 — `LEDGER_NOT_CONNECTED` + `SOLANA_APP_NOT_OPEN` should already exist (Plan 11-04 — confirm before duplicating).

---

## Wave Structure

```
Wave 1: 12-01 (Solana signing primitives — fingerprint + presign-hash + simulation + blocks-solana + Fixtures K + L)
        └─ foundational — every downstream plan depends on the primitives + Fixture K + L pins

Wave 2: 12-02 (prepare_solana_native_send + System Program encoder + handle-store widening)
        └─ depends on 12-01 (uses _solanaFingerprint + PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE)

Wave 3: 12-03 (prepare_solana_spl_send + SPL encoder + ATA derivation)
        ├─ depends on 12-01 + 12-02 (uses _solanaFingerprint + handle-store widening)
        ├─ does NOT depend on 12-02's prepare_solana_native_send.ts (sibling tool — no shared file)
        └─ touches register-all.ts (deterministic position assigned above)

Wave 4: 12-04 (preview_send Solana branch + simulation gate + canonical-dispatch-solana + ledger-solana-transport signTransaction widening)
        ├─ depends on 12-02 + 12-03 (handles must exist to preview)
        └─ touches preview_send.ts + ledger-solana-transport.ts (single-plan, no coordination)

Wave 5: 12-05 (send_transaction Solana branch + USB-HID routing + get_tx_verification Solana re-emit + LOAD-BEARING integration test)
        └─ depends on 12-04 (previewToken must be mintable to send)

Wave 6 (OPTIONAL): 12-06 (durable-nonce setup/teardown tools)
        ├─ depends on 12-02 + 12-04 (uses handle-store widening + canonical-dispatch allowlist widening)
        └─ may defer to v2.0.1 verify-phase per researcher gate (CONTEXT.md <deferred>)
```

**Parallel-eligible pairs:**
- **None inside Phase 12.** Unlike Phase 11 (parallel reads + persona registry + transport), Phase 12 is a STRICT dependency chain: every later plan needs the discriminator widening + signing primitives from earlier plans. Trying to parallelize 12-02 + 12-03 risks register-all.ts merge conflicts AND independent handle-store widenings landing in the wrong order. Recommend sequential dispatch per phased-resource-intensive-parallel-work discipline (CLAUDE.md global) — each plan is a coding agent running build + test + integration; 5 parallel agents saturates CPU + API.

**Strict-sequential pairs:**
- 12-01 → 12-02 (primitives needed)
- 12-02 → 12-03 (handle-store widening needed)
- 12-03 → 12-04 (preview branches must dispatch on both shapes)
- 12-04 → 12-05 (previewToken minting must exist for send routing)
- 12-04 → 12-06 (allowlist widening needed for nonce-init/close)

**Plan count proposed: 5 (12-01 through 12-05)** + 1 optional (12-06 if not deferred). Recommend 5 + defer 12-06 to v2.0.1 unless researcher Topic 8 surfaces a load-bearing user need; durable-nonce is opt-in usability not a security requirement (the 150-slot ≈ 60-second recent-blockhash window covers all interactive flows, the user just can't pause for 5+ minutes mid-preview).

---

## Metadata

**Analog search scope:** `src/signing/`, `src/protocols/`, `src/tools/`, `src/security/`, `src/wallet/` (Phase 11 Solana shelf), `test/`.

**Files read in full:** `payload-fingerprint.ts` (50 LOC), `presign-hash.ts` (58 LOC), `simulation.ts` (91 LOC), `protocols/erc20.ts` (181 LOC), `tools/prepare_native_send.ts` (299 LOC), `tools/prepare_token_send.ts` (316 LOC), `tools/preview_send.ts` (658 LOC), `tools/send_transaction.ts` (559 LOC), `tools/get_tx_verification.ts` (286 LOC), `tools/register-all.ts` (44 LOC), `signing/handle-store.ts` (229 LOC), `wallet/ledger-solana-transport.ts` (186 LOC top), `test/signing-fingerprint.test.ts` (197 LOC — fixture pattern), `test/trust-pipeline.integration.test.ts` (80 LOC top — integration test discipline). Phase 11 PATTERNS.md (355 LOC — full sibling-module + ESM spy-affordance + Q-STRICT-env discipline).

**Pattern extraction date:** 2026-05-20.

**Open coordination points for researcher (locks pattern-mapper deferred to research):**
- **Topic 1**: v0 vs legacy transaction format. Pattern-mapper assumed v0 + `TransactionMessage.compileToV0Message()`; if legacy, Plan 12-02's `buildSolanaTransferTx` signature changes (no Address Lookup Tables in legacy). Researcher locks at planning gate.
- **Topic 2**: presign-hash algorithm — sha256 vs sha512 vs keccak. Pattern-mapper assumed sha256 (mirrors Ed25519 standard prehash); researcher locks.
- **Topic 3**: native SOL fingerprint sender-independence. Pattern-mapper noted this is subtle (Solana `feePayer` IS in the message bytes, unlike EVM where `from` is not in the EIP-1559 preimage); researcher confirms whether persona-cycle integration test asserts byte-identity or sender-dependent shape for native SOL.
- **Topic 4**: SOL app v1.4+ clear-sign coverage. Pattern-mapper assumed clear-sign covers native + SPL transfers; researcher confirms whether nonce-init/close also clear-sign or require the LEDGER NOTICE blind-sign block.
- **Topic 5**: recipient-ATA-creation in SPL transfer — bundled into the same tx (sender pays rent) vs separate prepare tool. Pattern-mapper assumed bundled; researcher confirms.
- **Topic 6**: canonical-dispatch allowlist — System Program durable-nonce instructions allowed in v1.x or deferred to v2.0.x. Pattern-mapper proposed allowed-if-12-06-ships.
- **Topic 7**: per-call transport vs singleton for `signTransaction`. Pattern-mapper locked per-call (matches Phase 11 invariant — confirmed at ledger-solana-transport.ts:122).
- **Topic 8**: Solana broadcast path — `connection.sendRawTransaction` vs SDK-bundled. Pattern-mapper assumed `sendRawTransaction`.
- **Topic 9**: handle-store widening — discriminated-union on `PreparedTx` vs sibling `SolanaPreparedTx`. Pattern-mapper locked discriminated union for downstream type-stability + back-compat (default `txType: "evm"` for every existing Phase 4-11 handle).
