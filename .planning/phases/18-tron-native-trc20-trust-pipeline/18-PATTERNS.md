# Phase 18: Patterns — TRON native + TRC-20 trust pipeline

**Mapped:** 2026-05-20
**Files classified:** 13 new + 4 modified
**Analogs found:** 13 / 13 (every new file has a clean v2.0 Solana sibling or v1.x EVM analog)

---

## Pattern-mapper meta-decisions

Five decisions resolved up-front so individual plans don't re-litigate:

1. **TRON primitives ship as siblings of the Solana primitives, NEVER extend the EVM modules.** `payload-fingerprint-solana.ts` already proved the sibling-shelf pattern. EVM `payload-fingerprint.ts` (FROZEN), `presign-hash.ts` (FROZEN), `simulation.ts` (FROZEN), `blocks.ts` (FROZEN), `canonical-dispatch.ts` (FROZEN). TRON shelf at `src/signing/payload-fingerprint-tron.ts` + `presign-hash-tron.ts` + `simulation-tron.ts` + `blocks-tron.ts` + `amount-tron.ts` + `src/security/canonical-dispatch-tron.ts`. Independent regression surfaces; zero risk to the v1.x or v2.0 trust pipelines.

2. **`handle-store.ts` `txType` discriminator widening is a single-line edit.** The discriminated union `PreparedTx = PreparedTxEvm | PreparedTxSolana | PreparedTxTron` mirrors Phase 12's additive precedent. Adding `txType: "tron"` carries new TRON-specific fields (`rawDataHex: string`, `refBlockBytes: string`, `refBlockHash: string`, `expiration: number`, `contractAddress?: string`); EVM-shape sentinel fields stay populated so existing EVM consumers don't need to narrow. **Single-line literal-union widening only** — state machine + TTL + handle lifecycle BYTE-IDENTICAL. `PrepareArgs` additively widens with `sun?: string`, `expiration?: string` for raw agent-string surfacing.

3. **`preview_send.ts` + `send_transaction.ts` + `get_tx_verification.ts` extend ADDITIVELY via the `record.tx.txType` switch.** The Phase 12 dispatcher pattern is the template (`send_transaction.ts:316` reads `txType`, routes Solana to a sibling function below the FROZEN three-gate region; `preview_send.ts:197-198` reads `txType`, dispatches Solana branch). Phase 18 adds an additional case `"tron"` on each switch and a sibling branch function below; the **three-gate FROZEN region in `send_transaction.ts` is byte-untouched** (PREP-07 schema gate + PREP-08 fingerprint re-check + userDecision check). EVM body byte-frozen; Solana branch byte-frozen.

4. **Fixture naming — M (native TRX) + N (TRC-20 transfer), NOT K-L or O-Q.** K + L are Phase 12's Solana anchors; M + N are the next-sequential gap in CONTEXT D-08c. R-U are Phase 28's Compound anchors. M-Q is the implicit non-EVM reservation slot; M + N consume the first two. Fixtures land in NEW sibling `test/signing-fingerprint-tron.test.ts` (NOT the FROZEN `test/signing-fingerprint.test.ts` Phase 8 Fixture J anchor; NOT the FROZEN `test/signing-fingerprint-solana.test.ts` Fixture K + L anchor — TRON's Protobuf preimage is structurally distinct). NO `beforeAll`-snapshot per CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals".

5. **`tronweb` exposes both `transaction.raw_data` (object form) AND `transaction.raw_data_hex` (Protobuf-serialized bytes as hex).** Phase 18 uses `raw_data_hex` as the canonical preimage source — `Buffer.from(transaction.raw_data_hex, "hex")` is the bytes input to `payloadFingerprint = keccak256(domain-tag ‖ bytes)` AND to `presignHash = sha256(bytes)`. **NEVER hand-roll the Protobuf serialization** — tronweb's transactionBuilder is the canonical source. Same hash function selection as Solana: keccak256 at the binding layer (chain-distinct domain tag), SHA-256 at the device-display layer (TRON consensus tx-id IS SHA-256 of raw_data, what the Ledger TRX app displays).

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/signing/payload-fingerprint-tron.ts` | signing primitive | pure compute | [`src/signing/payload-fingerprint-solana.ts`](../../src/signing/payload-fingerprint-solana.ts) | sibling-module (different preimage source — Protobuf raw_data bytes vs serializeMessage) |
| `src/signing/presign-hash-tron.ts` | signing primitive | pure compute | [`src/signing/presign-hash-solana.ts`](../../src/signing/presign-hash-solana.ts) | exact-role (SHA-256 of preimage bytes — TRON consensus tx-id IS this hash) |
| `src/signing/simulation-tron.ts` | preview-time gate | request-response | [`src/signing/simulation-solana.ts`](../../src/signing/simulation-solana.ts) | sibling-module (`triggerconstantcontract` vs `simulateTransaction`; TRC-20 mandatory + native no-sim asymmetry) |
| `src/signing/blocks-tron.ts` | text templates | pure render | [`src/signing/blocks-solana.ts`](../../src/signing/blocks-solana.ts) | sibling-module (PREPARE-RECEIPT-TRON × 2 shapes, LEDGER-BLIND-SIGN-HASH-TRON, LEDGER_NOTICE_TRON, SIMULATION-BLOCK-TRON, VERIFY-BEFORE-SIGNING-TRON, NO-SIMULATION-AVAILABLE-TRON) |
| `src/signing/amount-tron.ts` | parse strict | pure compute | [`src/signing/amount-solana.ts`](../../src/signing/amount-solana.ts) | exact-role (sun vs lamports; 6-decimal native vs 9-decimal native; u256 vs u64 overflow guard — TRC-20 amounts are uint256 on TRON-VM) |
| `src/protocols/tron-native.ts` | tx encoder | pure compute via tronweb | [`src/protocols/solana-system.ts`](../../src/protocols/solana-system.ts) | role-match (`transactionBuilder.sendTrx` builds TransferContract Protobuf; decode via `raw_data.contract[0]` parameter inspection) |
| `src/protocols/tron-trc20.ts` | tx encoder | pure compute via tronweb | [`src/protocols/solana-spl.ts`](../../src/protocols/solana-spl.ts) + [`src/protocols/erc20.ts`](../../src/protocols/erc20.ts) | role-match (`triggerSmartContract` with `transfer(to, amount)` ABI; ERC-20 ABI-compatible calldata under TriggerSmartContract wrapping) |
| `src/tools/prepare_tron_native_send.ts` | MCP tool | request-response | [`src/tools/prepare_solana_native_send.ts`](../../src/tools/prepare_solana_native_send.ts) | exact (sun vs lamports + base58 vs hex; ref-block read instead of recentBlockhash) |
| `src/tools/prepare_tron_trc20_send.ts` | MCP tool | request-response | [`src/tools/prepare_solana_spl_send.ts`](../../src/tools/prepare_solana_spl_send.ts) | exact (TRC-20 contract address vs SPL mint; no ATA derivation — TRC-20 uses single contract address) |
| `src/security/canonical-dispatch-tron.ts` | allowlist gate | pure check | [`src/security/canonical-dispatch-solana.ts`](../../src/security/canonical-dispatch-solana.ts) | sibling-module (TRC-20 contract addresses from `tron-top-25.json` for transfer targets) |
| `test/signing-fingerprint-tron.test.ts` | fixture anchor | pure assertion | [`test/signing-fingerprint-solana.test.ts`](../../test/signing-fingerprint-solana.test.ts) | exact-role (Fixtures M + N hardcoded `0x...` literals; domain-tag length invariant; persona-cycle sender-dependence anchored at consumer tests) |
| `test/trust-pipeline-tron.integration.test.ts` | integration test | end-to-end | [`test/solana-trust-pipeline.integration.test.ts`](../../test/solana-trust-pipeline.integration.test.ts) | exact-role (persona-cycle byte-identity; mandatory simulation gate for TRC-20; no-sim advisory for native; three-gate FROZEN region byte-stable) |
| `test/canonical-dispatch-tron.test.ts` | allowlist regression | pure assertion | [`test/canonical-dispatch-solana.test.ts`](../../test/canonical-dispatch-solana.test.ts) | exact-role (allowlist contents + native-skip + refusal envelope shape) |
| **MOD** `src/signing/handle-store.ts` | handle state machine | in-memory | (itself) | additive widening — `PreparedTxTron` union member + `txType: "tron"` discriminator + `sun?` / `expiration?` `PrepareArgs` widening |
| **MOD** `src/tools/preview_send.ts` | MCP tool | request-response | (itself) | additive TRON branch via `record.tx.txType` discriminator dispatch |
| **MOD** `src/tools/send_transaction.ts` | MCP tool | request-response | (itself) | additive TRON branch — `tronweb.trx.sendRawTransaction` broadcast AFTER the FROZEN three-gate region |
| **MOD** `src/tools/get_tx_verification.ts` | MCP tool | request-response | (itself) | additive TRON branch — `blockHeader` + `refBlockHash` + `rawDataHex` re-emit fields |
| **MOD** `src/tools/register-all.ts` | side-effect register | additive imports | (itself) | additive (2 lines — `prepare_tron_native_send` + `prepare_tron_trc20_send`) |
| **MOD** `src/signing/error-codes.ts` | error union | type-only | (itself) | **NO additions** — Phase 18 reuses `SIMULATION_REFUSED` (16) + `DISPATCH_TARGET_REFUSED` + `BROADCAST_FAILED` + `LEDGER_REJECTED` + `LEDGER_NOT_CONNECTED` + `INVALID_INPUT`. 23-code union BYTE-FROZEN per CONTEXT line 182. |

Test files mirror the analog's test shape (4 new + 4 widened — full list in §Test patterns).

---

## Pattern Assignments (by new plan)

### Plan 18-01 — TRON signing primitives shelf (fingerprint + presign-hash + simulation + amount + blocks + canonical-dispatch + handle-store widening + Fixtures M + N)

**New files:**
- `src/signing/payload-fingerprint-tron.ts`
- `src/signing/presign-hash-tron.ts`
- `src/signing/simulation-tron.ts`
- `src/signing/blocks-tron.ts`
- `src/signing/amount-tron.ts`
- `src/security/canonical-dispatch-tron.ts`
- `test/signing-fingerprint-tron.test.ts` — **Fixtures M + N hardcoded `0x...` literal anchors**
- `test/signing-presign-hash-tron.test.ts` — sibling pin for SHA-256(raw_data) blind-sign hash regression
- `test/simulation-tron.test.ts` — 4 cases (`ok` / `revert` / `rpc-error` / `not-applicable-native`)
- `test/blocks-tron.test.ts` — substitution + slot-pin regression for the 7 templates
- `test/amount-tron.test.ts` — sun + TRC-20 decimal-aware arithmetic + u256-overflow guard
- `test/canonical-dispatch-tron.test.ts` — allowlist contents + native-skip branch + refusal envelope shape
- `test/handle-store.tron.test.ts` — discriminator round-trip + back-compat

**Modified files:**
- `src/signing/handle-store.ts` (additive widening — `PreparedTxTron` + `PrepareArgs` field additions)

**Primary analogs:** Solana shelf at [`src/signing/payload-fingerprint-solana.ts`](../../src/signing/payload-fingerprint-solana.ts) + [`src/signing/presign-hash-solana.ts`](../../src/signing/presign-hash-solana.ts) + [`src/signing/simulation-solana.ts`](../../src/signing/simulation-solana.ts) + [`src/signing/blocks-solana.ts`](../../src/signing/blocks-solana.ts) + [`src/signing/amount-solana.ts`](../../src/signing/amount-solana.ts) + [`src/security/canonical-dispatch-solana.ts`](../../src/security/canonical-dispatch-solana.ts).

**Bounded diffs:**

1. **`src/signing/payload-fingerprint-tron.ts`** — mirror `payload-fingerprint-solana.ts` shape:
   - Export `FINGERPRINT_DOMAIN_TAG_TRON = "VaultPilot-trontx-v1:"` (**21 UTF-8 bytes**: V·a·u·l·t·P·i·l·o·t·-·t·r·o·n·t·x·-·v·1·: = 21).
   - Export `computeTronPayloadFingerprint(input: { rawDataBytes: Uint8Array }): Hex`:
     - Preimage = `concat([toBytes(FINGERPRINT_DOMAIN_TAG_TRON), input.rawDataBytes])`.
     - Return `keccak256(preimage)` (viem `keccak256` — same hash function as EVM + Solana fingerprint; differentiator is domain tag).
     - Anti-pattern guard in top-of-file comment: NEVER pass the outer `transaction` envelope bytes (which include `signature[]` and other wrapper fields); pass ONLY the Protobuf-serialized `raw_data` bytes obtained via `Buffer.from(transaction.raw_data_hex, "hex")`. Pitfall: tronweb's `transaction` object exposes both shapes — `raw_data_hex` is the canonical preimage; the outer `Transaction` envelope is post-signature wrapping.
   - Export `_tronFingerprint = { computeTronPayloadFingerprint }` ESM spy-affordance.

2. **`src/signing/presign-hash-tron.ts`** — mirror `presign-hash-solana.ts` shape:
   - Export `computeTronPresignHash(input: { rawDataBytes: Uint8Array }): { rawDataBytes: Uint8Array; presignHash: Hex }`:
     - `presignHash = "0x" + crypto.createHash("sha256").update(input.rawDataBytes).digest("hex")` — pure Node stdlib SHA-256.
     - **CONFIRMED VIA RESEARCH:** TRON consensus tx-id IS `SHA-256(raw_data.serializeToString())`, which is what the Ledger TRX app displays on blind-sign and matches the `txID` field tronweb computes client-side. Field name `presignHash` keeps `PreviewPinned.presignHash: Hex` type-stable across chains.
   - Export `_tronPresign = { computeTronPresignHash }` ESM spy-affordance.

3. **`src/signing/simulation-tron.ts`** — sibling of `simulation-solana.ts` BUT with **branch-specific posture**:
   - Export `type TronSimulationStatus = "ok" | "revert" | "energy-required" | "error" | "not-applicable"`.
   - Export `interface TronSimulationResult { status: TronSimulationStatus; revertReason?: string; energyUsed: bigint | null; constantResult: string[]; rpcError?: string }`.
   - Export `async function runTronPreviewSimulation(input: { tronWeb: TronWeb; contractAddress: string; functionSelector: string; parameters: AbiParameter[]; ownerAddress: string }): Promise<TronSimulationResult>`:
     - Calls `tronWeb.transactionBuilder.triggerConstantContract(contractAddress, functionSelector, options, parameters, ownerAddress)`.
     - Response shape (research-confirmed): `{ result: { result: boolean; code?: "REVERT" | "OTHER_ERROR"; message?: string }, energy_used: number, constant_result: string[] }`.
     - `result.result === true` AND no `code` → `status: "ok"`.
     - `result.code === "REVERT"` → `status: "revert"`, parse `constant_result[0]` for ABI-encoded revert reason (`0x08c379a0` selector for `Error(string)`).
     - `result.code !== undefined` (other errors) → `status: "error"`.
     - `try/catch` wraps everything → RPC failure demotes to `status: "error"` with `rpcError`; NEVER throws.
   - Export `function emitNoSimulationAvailable(): TronSimulationResult` returning `{ status: "not-applicable", energyUsed: null, constantResult: [] }` — consumed by the native-TRX branch of preview_send to signal "no simulation API for TransferContract" without ambiguous fall-through.
   - Export `_simulationTron = { runTronPreviewSimulation, emitNoSimulationAvailable }` ESM spy-affordance.
   - **CRITICAL DEVIATION from analog:** Solana branch enforces `status !== "ok"` → `SIMULATION_REFUSED` UNIFORMLY. TRON branch enforces it ONLY for TRC-20; native TRX SKIPS simulation with an explicit `[NO SIMULATION AVAILABLE]` advisory block (NOT a refusal — PREPARE RECEIPT + LEDGER BLIND-SIGN HASH carry the defense per CONTEXT D-03b). Asymmetry surfaced in SECURITY.md TRON section (Plan 18-04).

4. **`src/signing/blocks-tron.ts`** — APPEND-ONLY sibling. Seven template constants:
   - `PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE` — slots `{TO}`, `{SUN}`, `{REF_BLOCK_BYTES}`, `{REF_BLOCK_HASH}`, `{EXPIRATION}`. Header: `"PREPARE RECEIPT (TRON — native transfer)"`.
   - `PREPARE_RECEIPT_TRON_TRC20_TEMPLATE` — slots `{TO}`, `{TOKEN_ADDRESS}`, `{AMOUNT}`, `{REF_BLOCK_BYTES}`, `{REF_BLOCK_HASH}`, `{EXPIRATION}`. Header: `"PREPARE RECEIPT (TRON — TRC-20 transfer)"`. Pinned ref-block fields surfaced verbatim per CONTEXT D-06a.
   - `LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE` — slots `{HASH_FULL_64HEX}`, `{HASH_CHUNKED_4_CHAR_GROUPS}`. Header: `"LEDGER BLIND-SIGN HASH (TRON)"`. Sub-line: `"TRON consensus tx-id = SHA-256(raw_data). The Ledger TRX app displays this hash on blind-sign mode. Compare character-for-character against the on-device value."`
   - `LEDGER_NOTICE_TRON_TEMPLATE` — slots `{INSTRUCTION_NAME}`, `{REGISTRY_STATUS}`. Header: `"LEDGER NOTICE (TRON)"`. CONDITIONAL emit — Phase 18's TRC-20 transfers to USDT/USDC/USDD/TUSD clear-sign on TRX app v0.5+ (per Ledger Enterprise TRC-20 governance docs); native TransferContract clear-signs unconditionally. Pre-staged for Phase 19+ consumers (TRC-20 approve, Stake 2.0, SunSwap router calls — all blind-sign).
   - `SIMULATION_BLOCK_TRON_TEMPLATE` — slots `{STATUS}`, `{REVERT_REASON}`, `{ENERGY_USED}`, `{CONSTANT_RESULT_PREVIEW}`. Header: `"CHECKS PERFORMED (TRON simulation — Layer 0.7)"`. Emitted ONLY for TRC-20.
   - `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE` — no slots. Header: `"CHECKS PERFORMED (TRON — no simulation available)"`. Body explains: `"TransferContract has no simulation API (TronGrid /wallet/triggerconstantcontract is for smart-contract calls only). Defense relies on PREPARE RECEIPT (verbatim agent args) + LEDGER BLIND-SIGN HASH (on-device match). The asymmetry with TRC-20 is documented in SECURITY.md."`
   - `VERIFY_BEFORE_SIGNING_TRON_TEMPLATE` — mirrors `VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE` shape, replacing `"Network: Solana mainnet-beta"` with `"Network: TRON mainnet"` and naming TRX-app `signByHash` mode in the post-send ritual step 3.
   - Top-of-file comment names format-fanout-sentinel discipline + the asymmetric-simulation note + the LEDGER_NOTICE_TRON_TEMPLATE pre-staging for Phase 19+.

5. **`src/signing/amount-tron.ts`** — mirror `amount-solana.ts` shape with TWO key differences:
   - Native TRX = **6 decimals** (sun unit), NOT 9 decimals (lamports unit).
   - Overflow guard is **u256-overflow** (TRC-20 amounts are uint256 on TRON-VM), NOT u64-overflow. Native TRX is int64 on-wire (sun), so a u64 guard applies for the native path; the helper takes an explicit `overflowBound: "u64" | "u256"` arg to discriminate.
   - Export `parseTronAmountStrict(amountStr: string, decimals: number, overflowBound: "u64" | "u256"): bigint`. Same 4-step ladder as Solana (empty / regex / fractional-overflow / overflow), with the overflow bound selected by the caller.
   - Export `InvalidAmountError` class (same shape as Solana sibling; `kind: "empty" | "format" | "fractional-overflow" | "u64-overflow" | "u256-overflow"`).
   - Two consumer shapes:
     - `prepare_tron_native_send` (Plan 18-02): `sun` arg is RAW SUN (decimals=0). Handler validates via `parseTronAmountStrict(args.sun, 0, "u64")`. 1 TRX = 1_000_000 raw sun.
     - `prepare_tron_trc20_send` (Plan 18-03): `amount` arg is HUMAN UNITS. Handler resolves the token's `decimals` via `get_tron_token_metadata` and calls `parseTronAmountStrict(args.amount, tokenDecimals, "u256")`.

6. **`src/security/canonical-dispatch-tron.ts`** — mirror `canonical-dispatch-solana.ts` shape:
   - Export `TRON_TRC20_DISPATCH_ALLOWLIST: ReadonlySet<string>` populated from Phase 17's `src/tokens/tron-top-25.json` filtered to TRC-20 token contracts (USDT-TRC20 / USDC-TRC20 / USDD / TUSD per CONTEXT D-04a + D-11a). Base58check string keys (T-prefixed addresses; `canonical-dispatch-solana` uses base58 pubkeys — same pattern, different encoding).
   - Export `type TronDispatchCheckResult = { kind: "allowed" } | { kind: "refused"; offenders: string[]; allowlist: string[] }`.
   - Export `checkTronDispatchTarget(contractAddresses: string[]): TronDispatchCheckResult` — same shape as Solana's `checkSolanaDispatchTarget`.
   - **Native TransferContract has NO contract target** — Plan 18-04 preview_send branch dispatches the allowlist check ONLY for `txType: "tron"` AND `kind: "trc20"`; native TRX SKIPS the check per CONTEXT D-11a.
   - Export `_canonicalDispatchTron = { checkTronDispatchTarget }` ESM spy-affordance.

7. **`src/signing/handle-store.ts` (modify) — additive widening:**
   - Add `PreparedTxTron` interface mirroring `PreparedTxSolana` sentinel-fields pattern:
     - Required discriminator `txType: "tron"`.
     - Sentinel zeros for `chainId: 0`, `to: "0x0000…"` (zero address), `valueWei: 0n`, `data: "0x"`.
     - TRON-specific fields: `rawDataHex: string` (canonical Protobuf preimage source); `refBlockBytes: string`; `refBlockHash: string`; `expiration: number`; `kind: "native" | "trc20"` (discriminator for simulation gate routing); `contractAddress?: string` (TRC-20 only — base58check); `instructionSummary?: TronInstructionSummary[]` (decoded args for DECODED ARGS block).
   - Add `TronInstructionSummary` discriminated union — `{ kind: "native-transfer"; from: string; to: string; sun: bigint }` | `{ kind: "trc20-transfer"; from: string; to: string; tokenAddress: string; amount: bigint; decimals: number }`.
   - Widen `PreparedTx` literal-union: `PreparedTxEvm | PreparedTxSolana | PreparedTxTron`.
   - Widen `PrepareArgs` with `sun?: string`, `expiration?: string`, `refBlockBytes?: string`, `refBlockHash?: string`, `tokenAddress?` already present from Phase 6 (reused). All `string` type — raw agent strings at storage boundary per PREP-02.
   - **State machine + TTL + handle lifecycle BYTE-IDENTICAL.** The `txHash: string` widening from Phase 12 (originally `Hex`, widened to `string` for cross-chain compat) already accommodates TRON's hex tx-id (TRON tx-id IS the SHA-256 hash as a 64-char hex string).

8. **`test/signing-fingerprint-tron.test.ts` (new)** — Fixture M + N hardcoded literal anchors. Two `it(...)` blocks per fixture:
   - Fixture M: `transactionBuilder.sendTrx(TO, 1_000_000, FROM)` built with `tronweb@6.3.0` against a pinned ref-block (use a known-stable test-net block — pinned `ref_block_bytes` + `ref_block_hash` as hex string literals so the fixture is deterministic). Compute `payloadFingerprint = keccak256(toBytes("VaultPilot-trontx-v1:") ‖ Buffer.from(tx.raw_data_hex, "hex"))`. Anchor the resulting `0x...` literal.
   - Fixture N: `transactionBuilder.triggerSmartContract(USDT_TRC20, "transfer(address,uint256)", options, parameters, FROM)` with `parameters: [{ type: "address", value: TO }, { type: "uint256", value: 100_000_000n }]`. Same domain-tag preimage + same `0x...` literal anchor.
   - Domain-tag length invariant: `FINGERPRINT_DOMAIN_TAG_TRON.length === 21` + `Buffer.byteLength(FINGERPRINT_DOMAIN_TAG_TRON, "utf8") === 21` (ASCII-only).
   - **Cross-link from `prepare-tron-native-send.test.ts` (Plan 18-02) + `prepare-tron-trc20-send.test.ts` (Plan 18-03) + `trust-pipeline-tron.integration.test.ts` (Plan 18-04)** — load-bearing redundancy per CLAUDE.md fixture discipline.
   - **NO `beforeAll`-snapshot** — both fixtures pinned as hardcoded `0x...` literals.

**FROZEN-area assertion:** Plan 18-01 leaves these files byte-untouched (verified at commit time via `git diff origin/main -- <path>` returns EMPTY):
- `src/signing/payload-fingerprint.ts`, `src/signing/payload-fingerprint-solana.ts`
- `src/signing/presign-hash.ts`, `src/signing/presign-hash-solana.ts`
- `src/signing/simulation.ts`, `src/signing/simulation-solana.ts`
- `src/signing/blocks.ts`, `src/signing/blocks-solana.ts`
- `src/signing/amount.ts`, `src/signing/amount-solana.ts`
- `src/security/canonical-dispatch.ts`, `src/security/canonical-dispatch-solana.ts`
- `src/signing/error-codes.ts` (Phase 18 adds zero new error codes — 23-code union FROZEN per CONTEXT line 182)
- `src/tools/preview_send.ts`, `src/tools/send_transaction.ts`, `src/tools/get_tx_verification.ts` (Plans 18-02 through 18-04 carve)
- `test/signing-fingerprint.test.ts`, `test/signing-fingerprint-solana.test.ts` (Phase 18 ships NEW sibling `test/signing-fingerprint-tron.test.ts`)

**`register-all.ts` carve coordination:** Plan 18-01 adds ZERO lines to `src/tools/register-all.ts` (no new MCP tools — pure primitives + handle-store widening). Plans 18-02 + 18-03 add the prepare tools. Plan 18-04 adds no new tools (additive `preview_send` + `send_transaction` + `get_tx_verification` branches).

---

### Plan 18-02 — `prepare_tron_native_send` (TransferContract Protobuf + ref-block read)

**New files:**
- `src/protocols/tron-native.ts` — `encodeTronTransfer({ tronWeb, from, to, sun })` wraps `transactionBuilder.sendTrx`, returns `{ transaction, rawDataHex, rawDataBytes, refBlockBytes, refBlockHash, expiration, instructionSummary }`. Decoder `decodeTronNativeCall(transaction)` for DECODED ARGS surface (extracts `from`/`to`/`sun` from `transaction.raw_data.contract[0].parameter.value`).
- `src/tools/prepare_tron_native_send.ts`
- `test/protocols-tron-native.test.ts`
- `test/prepare-tron-native-send.test.ts` — Fixture M consumer re-anchor + PREPARE RECEIPT shape pin + ref-block surfacing.

**Modified files:**
- `src/tools/register-all.ts` (additive — 1 line, `import "./prepare_tron_native_send.js"`)

**Primary analogs:**
- [`src/protocols/solana-system.ts`](../../src/protocols/solana-system.ts) — Solana System Program encoder + decoder shape (Phase 12 / Plan 12-02).
- [`src/tools/prepare_solana_native_send.ts`](../../src/tools/prepare_solana_native_send.ts) — MCP tool handler shape (input schema + handle creation + PREPARE RECEIPT emission + structured response).
- [`src/tools/prepare_native_send.ts`](../../src/tools/prepare_native_send.ts) — original v1.0 EVM native send (chain-id assertion shape + handle creation).

**Bounded diffs:**

1. **`src/protocols/tron-native.ts`** — encoder + decoder + ref-block reader:
   - Export `async function encodeTronTransfer(input: { tronWeb: TronWeb; from: string; to: string; sun: bigint }): Promise<{ transaction: TronTransaction; rawDataHex: string; rawDataBytes: Uint8Array; refBlockBytes: string; refBlockHash: string; expiration: number; instructionSummary: TronInstructionSummary[] }>`.
     - `const tx = await input.tronWeb.transactionBuilder.sendTrx(input.to, Number(input.sun), input.from);` — tronweb internally calls `getBlock("latest")` for ref-block pinning + sets `expiration = block.header.timestamp + 60_000` (60s window per research).
     - **CRITICAL EXPIRATION-WINDOW HANDLING**: tronweb's default expiration is 60 seconds. Our `get_tx_verification` 15-min TTL would surface a stale handle that fails at broadcast (`TAPOS check error` / `transaction expired`). **Plan 18-02 calls `extendExpiration(tx, 900)` (15 minutes) BEFORE returning, so the expiration matches the handle TTL.** Plan-checker NIT-3 — surfaced as a load-bearing research finding (not in CONTEXT D-06b).
     - `rawDataHex = tx.raw_data_hex; rawDataBytes = new Uint8Array(Buffer.from(rawDataHex, "hex"));`
     - `refBlockBytes = tx.raw_data.ref_block_bytes; refBlockHash = tx.raw_data.ref_block_hash; expiration = tx.raw_data.expiration;`
     - `instructionSummary = [{ kind: "native-transfer", from: input.from, to: input.to, sun: input.sun }];`
     - Return tuple consumed by `prepare_tron_native_send.ts` to populate `PreparedTxTron`.
   - Export `decodeTronNativeCall(transaction: TronTransaction): TronNativeDecoded` — sibling of `decodeSolanaSystemCall`. Returns `{ kind: "transfer"; from: string; to: string; sun: bigint } | { kind: "unknown" }`. Reads `transaction.raw_data.contract[0]` — verifies `type === "TransferContract"`, extracts `parameter.value.owner_address`, `parameter.value.to_address`, `parameter.value.amount`. Address fields are 0x41-prefixed hex; convert to base58check via `formatTronAddress(hex)` from Phase 17's `address.ts`.
   - Export `_tronNative = { encodeTronTransfer, decodeTronNativeCall }` ESM spy-affordance.

2. **`src/tools/prepare_tron_native_send.ts`** — MCP tool handler:
   - Input schema (Zod): `{ to: string (base58check), sun: string (decimal string), expiration?: string (optional override; defaults to 900s) }`. **NO `chain` field** — TRON is single-chain; mirror of `prepare_solana_native_send`'s no-chain shape.
   - Validate `to` via `tronweb.utils.address.isAddress` (Phase 17 helper).
   - Validate `sun` via `parseTronAmountStrict(args.sun, 0, "u64")` — raw sun, u64 overflow guard.
   - Resolve sender — `getActiveAccountAddress("tron")` from the `list_paired_non_evm_accounts` infrastructure (Phase 17 wiring); demo-mode falls back to the active TRON persona address (Phase 17 Plan 17-05).
   - Call `_tronNative.encodeTronTransfer(...)` → unpack `{ rawDataHex, rawDataBytes, refBlockBytes, refBlockHash, expiration, instructionSummary }`.
   - Compute `payloadFingerprint = _tronFingerprint.computeTronPayloadFingerprint({ rawDataBytes })`.
   - Create handle via `createHandle({ args: { to: args.to, sun: args.sun, expiration: …, valueWei: "0", refBlockBytes, refBlockHash }, tx: { txType: "tron", kind: "native", rawDataHex, refBlockBytes, refBlockHash, expiration, instructionSummary, …sentinel zeros for EVM-shape fields }, payloadFingerprint })`.
   - Emit response: `content[0].text` = `PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE` substituted with raw agent args + pinned ref-block fields; `structuredContent` carries the standard `{ handle, chain: "tron", to, sun, refBlockBytes, refBlockHash, expiration, payloadFingerprint, prepareReceipt }`.
   - Fixture M consumer re-anchor in test: build the same TX, recompute fingerprint, assert it matches the literal at `signing-fingerprint-tron.test.ts:<line>`.

3. **`src/tools/register-all.ts`** — single line addition: `import "./prepare_tron_native_send.js"; // Phase 18 Plan 18-02 (TRON-W-01)`.

---

### Plan 18-03 — `prepare_tron_trc20_send` (TriggerSmartContract + ABI-encoded calldata)

**New files:**
- `src/protocols/tron-trc20.ts` — `encodeTronTrc20Transfer({ tronWeb, from, to, tokenAddress, amount })` wraps `transactionBuilder.triggerSmartContract(tokenAddress, "transfer(address,uint256)", options, parameters, from)`; same return tuple shape as `encodeTronTransfer` plus `contractAddress`. Decoder `decodeTronTrc20Call(transaction)` for DECODED ARGS surface (extracts `from`/`to`/`amount`/`tokenAddress` from the TriggerSmartContract parameter envelope).
- `src/tools/prepare_tron_trc20_send.ts`
- `test/protocols-tron-trc20.test.ts`
- `test/prepare-tron-trc20-send.test.ts` — Fixture N consumer re-anchor + PREPARE RECEIPT shape pin + `parseTronAmountStrict` decimal-aware regression + sender-dependent fingerprint regression.

**Modified files:**
- `src/tools/register-all.ts` (additive — 1 line, `import "./prepare_tron_trc20_send.js"`)

**Primary analogs:**
- [`src/protocols/solana-spl.ts`](../../src/protocols/solana-spl.ts) — Solana SPL TransferChecked encoder + ATA derivation shape (Phase 12 / Plan 12-03).
- [`src/protocols/erc20.ts`](../../src/protocols/erc20.ts) — ERC-20 ABI-encoded calldata shape (Phase 6 / Plan 06-02). **TRC-20's ABI is identical to ERC-20's** at the calldata level — `transfer(address,uint256)` selector `0xa9059cbb` + 32-byte to + 32-byte amount.
- [`src/tools/prepare_solana_spl_send.ts`](../../src/tools/prepare_solana_spl_send.ts) — MCP tool handler shape (token metadata lookup + decimal-aware amount parsing + structured response).
- [`src/tools/prepare_token_send.ts`](../../src/tools/prepare_token_send.ts) — original v1.1 EVM ERC-20 send (`tokenAddress` arg + `get_token_metadata` decimals lookup pattern).

**Bounded diffs:**

1. **`src/protocols/tron-trc20.ts`** — encoder + decoder:
   - Export `async function encodeTronTrc20Transfer(input: { tronWeb: TronWeb; from: string; to: string; tokenAddress: string; amount: bigint }): Promise<{ transaction: TronTransaction; rawDataHex: string; rawDataBytes: Uint8Array; refBlockBytes: string; refBlockHash: string; expiration: number; contractAddress: string; instructionSummary: TronInstructionSummary[] }>`.
     - `const result = await input.tronWeb.transactionBuilder.triggerSmartContract(input.tokenAddress, "transfer(address,uint256)", { feeLimit: 100_000_000 /* 100 TRX cap */, callValue: 0 }, [{ type: "address", value: input.to }, { type: "uint256", value: input.amount.toString() }], input.from);`
     - **`feeLimit: 100_000_000` (100 TRX)** — sufficient for TRC-20 transfer energy (USDT-TRC20 ~31,895 energy at 420 sun/energy = ~13.4 TRX). The fee limit is part of `raw_data` (Protobuf field), so it's in the fingerprint preimage. Hardcoded — Phase 19 can add a `feeLimit` user arg if energy markets shift.
     - Extract `tx = result.transaction`.
     - **Same expiration handling** as native — call `extendExpiration(tx, 900)` to match the 15-min handle TTL.
     - `rawDataHex = tx.raw_data_hex; rawDataBytes = new Uint8Array(Buffer.from(rawDataHex, "hex"));`
     - `instructionSummary = [{ kind: "trc20-transfer", from: input.from, to: input.to, tokenAddress: input.tokenAddress, amount: input.amount, decimals: <resolved-by-caller> }];` — decimals resolved by the tool handler before calling the encoder, passed in via a separate arg or attached post-encode.
   - Export `decodeTronTrc20Call(transaction: TronTransaction): TronTrc20Decoded` — extracts the contract address + decodes the ABI-encoded `transfer(to, amount)` parameter from `transaction.raw_data.contract[0].parameter.value.data` (hex string). Selector check (`0xa9059cbb`) before parameter decode; truncated/malformed data → `{ kind: "unknown" }`.
   - Export `_tronTrc20 = { encodeTronTrc20Transfer, decodeTronTrc20Call }` ESM spy-affordance.

2. **`src/tools/prepare_tron_trc20_send.ts`** — MCP tool handler:
   - Input schema (Zod): `{ to: string (base58check), tokenAddress: string (base58check), amount: string (decimal string in human units), expiration?: string }`.
   - Validate `to` + `tokenAddress` via `tronweb.utils.address.isAddress`.
   - Resolve token decimals via `get_tron_token_metadata({ tokenAddress })` (Phase 17 tool) — returns `{ symbol, decimals, name }` from `tron-top-25.json` or live `decimals()` call against the contract.
   - Parse `args.amount` via `parseTronAmountStrict(args.amount, decimals, "u256")` — TRC-20 is uint256 on TRON-VM.
   - Resolve sender (same as Plan 18-02).
   - Call `_tronTrc20.encodeTronTrc20Transfer(...)`.
   - Compute `payloadFingerprint = _tronFingerprint.computeTronPayloadFingerprint({ rawDataBytes })`.
   - Create handle with `txType: "tron"`, `kind: "trc20"`, `contractAddress: args.tokenAddress`, full ref-block + expiration + instructionSummary fields.
   - Emit response: `content[0].text` = `PREPARE_RECEIPT_TRON_TRC20_TEMPLATE` substituted; `structuredContent` carries `{ handle, chain: "tron", to, tokenAddress, amount, decimals, refBlockBytes, refBlockHash, expiration, payloadFingerprint, prepareReceipt }`.
   - Fixture N consumer re-anchor in test: build the same TX, recompute fingerprint, assert it matches the literal at `signing-fingerprint-tron.test.ts:<line>`.

3. **`src/tools/register-all.ts`** — single line addition: `import "./prepare_tron_trc20_send.js"; // Phase 18 Plan 18-03 (TRON-W-02)`.

---

### Plan 18-04 — `preview_send` + `send_transaction` + `get_tx_verification` TRON branches + SECURITY.md + integration test

**New files:**
- `test/trust-pipeline-tron.integration.test.ts` — **LOAD-BEARING** persona-cycle byte-identity integration test (mirrors `test/solana-trust-pipeline.integration.test.ts` shape).
- `test/preview-send.tron.test.ts` — branch-specific tests (TRC-20 mandatory simulation refusal; native no-sim advisory; canonical-dispatch refusal for unknown TRC-20).
- `test/send-transaction.tron.test.ts` — branch-specific tests (three-gate FROZEN region byte-stable for TRON; broadcast via `_tronRegistry.getTronWeb().trx.sendRawTransaction`; LEDGER_REJECTED + BROADCAST_FAILED + LEDGER_NOT_CONNECTED error envelopes).
- `test/get-tx-verification.tron.test.ts` — re-emit with `blockHeader` + `refBlockHash` + `rawDataHex` fields.

**Modified files:**
- `src/tools/preview_send.ts` (additive — TRON branch via `record.tx.txType === "tron"` dispatch)
- `src/tools/send_transaction.ts` (additive — TRON branch AFTER the FROZEN three-gate region)
- `src/tools/get_tx_verification.ts` (additive — TRON arm adds `blockHeader` + `refBlockHash` + `rawDataHex` to structuredContent)
- `SECURITY.md` (append — TRON threat-model section with 6 sub-sections per CONTEXT D-12a)

**Primary analogs:**
- [`src/tools/preview_send.ts`](../../src/tools/preview_send.ts) — Solana branch lives at lines 816+ (look for `"// Phase 12 — Plan 12-04 — Solana branch (additive…)"` comment) — additive function below the EVM body; dispatcher at lines 197-198 reads `record.tx.txType` and routes.
- [`src/tools/send_transaction.ts`](../../src/tools/send_transaction.ts) — Solana branch lives at lines 599+ (look for `"// Phase 12 — Plan 12-05 — Solana branch (additive…)"` comment) — additive function below the FROZEN three-gate region; dispatcher at lines 310-350.
- [`src/tools/get_tx_verification.ts`](../../src/tools/get_tx_verification.ts) — Solana arm widens `structuredContent` with `solanaProgramSet` (additive); TRON arm widens with `blockHeader` + `refBlockHash` + `rawDataHex`.
- [`test/solana-trust-pipeline.integration.test.ts`](../../test/solana-trust-pipeline.integration.test.ts) — LOAD-BEARING integration test shape; `STOP-THE-LINE` comment + persona-cycle byte-identity assertions + mandatory-simulation regression.

**Bounded diffs:**

1. **`src/tools/preview_send.ts`** — additive TRON branch:
   - Dispatcher widening (existing lines 197-198): `if (txType === "solana") { return previewSendSolana(...); } if (txType === "tron") { return previewSendTron(...); }` — single `else if` branch addition. EVM body BYTE-FROZEN.
   - New sibling function `previewSendTron(record, args)` below the existing Solana branch:
     - Layer 0.5 canonical-dispatch: `if (record.tx.kind === "trc20") { const result = _canonicalDispatchTron.checkTronDispatchTarget([record.tx.contractAddress]); if (result.kind === "refused") return errEnvelope("DISPATCH_TARGET_REFUSED", …); }` Native TRX skips the check.
     - Layer 0.7 simulation (TRC-20 path): `const tronWeb = _tronRegistry.getTronWeb(); const simResult = await _simulationTron.runTronPreviewSimulation({ tronWeb, contractAddress: record.tx.contractAddress, functionSelector: "transfer(address,uint256)", parameters: [...decoded args], ownerAddress: record.tx.instructionSummary[0].from });` If `simResult.status !== "ok"` → `return errEnvelope("SIMULATION_REFUSED", …)` with simulation envelope in cause.
     - Layer 0.7 native-skip (native path): emit `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE` instead of `SIMULATION_BLOCK_TRON_TEMPLATE`; CONTINUE to presign-hash recompute (NO refusal per CONTEXT D-03b).
     - Pin `previewToken` + `presignHash` + (sentinel zeros for `nonce`/`gas`/`maxFeePerGas`/`maxPriorityFeePerGas`).
     - Recompute presign hash: `const { presignHash } = _tronPresign.computeTronPresignHash({ rawDataBytes: Buffer.from(record.tx.rawDataHex, "hex") });`
     - Emit response text blocks: `PREPARE_RECEIPT_TRON_*_TEMPLATE` + `LEDGER_NOTICE_TRON_TEMPLATE` (conditional — emit only when calldata target falls OUTSIDE the bundled TRX-app token registry, which for Phase 18's TRC-20 set should never fire; CONTEXT D-04b stages this for Phase 19+) + `LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE` + `SIMULATION_BLOCK_TRON_TEMPLATE` OR `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE` + `VERIFY_BEFORE_SIGNING_TRON_TEMPLATE`.

2. **`src/tools/send_transaction.ts`** — additive TRON branch:
   - **The three-gate FROZEN region (lines ~310-340) is byte-untouched.** Phase 12 widened the post-gate dispatch on `txType`; Phase 18 adds `if (txType === "tron") { return sendTransactionTron(...); }` to the same switch.
   - New sibling function `sendTransactionTron(record, args)` below the existing Solana branch:
     - Re-validates that simulation gate already refused at preview (handle status must be `"previewed"` — gate already checked).
     - Demo mode (DEMO-05): same simulation-envelope short-circuit as EVM + Solana — return the decoded args + the `[DEMO MODE]` advisory block; NEVER broadcast.
     - Real mode: open USB-HID transport via `_tronLedgerTransport` (Phase 17 wiring — `ledger-tron-transport.ts:signTransaction`), passing `record.tx.rawDataHex` as the `rawTxHex` arg (per research `signTransaction(path, rawTxHex, tokenSignatures)` — `tokenSignatures: []` for now; Phase 19's TRC-20 approve will inspect clear-sign coverage).
     - Wrap signature into outer envelope: `const signedTransaction = { ...originalTransaction, signature: [signature] };` (outer envelope's `signature[]` Protobuf field).
     - Broadcast via `tronWeb.trx.sendRawTransaction(signedTransaction)`.
     - Response shape: `{ ok: true, result: true, txid: "<hex>", transaction: { ... } }` from tronweb. `txHash = result.txid` (TRON tx-id IS the SHA-256 of raw_data — already matches `presignHash` without the `0x` prefix; surface as `0x`-prefixed for cross-chain string uniformity OR raw hex per Solana's no-prefix base58 precedent; **DEFER TO HANDLE-STORE PRECEDENT — Solana stores raw base58, TRON stores raw hex**).
     - Error envelope: `LEDGER_REJECTED` on user-on-device rejection; `BROADCAST_FAILED` on TronGrid failure (e.g. `TAPOS check error`, `SIGERROR`, `BANDWITH_ERROR`); `LEDGER_NOT_CONNECTED` on USB-HID open failure (reuse Phase 12 Plan 12-05's error code).
     - Stamp handle via `transitionToSent(handle, txHash)`.

3. **`src/tools/get_tx_verification.ts`** — additive TRON arm:
   - Existing dispatcher reads `record.tx.txType`. Phase 18 adds `if (txType === "tron") { structuredContent.blockHeader = { refBlockBytes: record.tx.refBlockBytes, refBlockHash: record.tx.refBlockHash, expiration: record.tx.expiration }; structuredContent.rawDataHex = record.tx.rawDataHex; }` — additive surface, EVM + Solana arms BYTE-FROZEN.
   - `dispatchCheckResult` for TRON: native = `{ kind: "not-applicable" }`; TRC-20 = re-runs `_canonicalDispatchTron.checkTronDispatchTarget` against the stored `record.tx.contractAddress`.

4. **`src/security/canonical-dispatch-tron.ts`** — Plan 18-04 wires it; module shipped in Plan 18-01 (referenced from preview_send branch above).

5. **`SECURITY.md`** — APPEND a new top-level section "TRON (v2.1)" with 6 sub-sections per CONTEXT D-12a:
   - (1) USB-HID transport trust shape — mirrors Phase 12's Solana sub-section; no WC bridge; per-call transport open via `_tronLedgerTransport.signTransaction`.
   - (2) Protobuf raw_data preimage vs EVM RLP — structurally distinct binding; both hashed via keccak256; chain-distinct domain tag (`"VaultPilot-trontx-v1:"`, 21 UTF-8 bytes; distinct from EVM 23 + Solana 20).
   - (3) SHA-256 device-display hash — TRON consensus tx-id IS `SHA-256(raw_data)`; what the Ledger TRX app displays in blind-sign mode; user matches character-for-character.
   - (4) TRX app clear-sign coverage — v0.5+ clear-signs TransferContract + `TriggerSmartContract.transfer(to, amount)` for bundled TRC-20 token registry (USDT/USDC/USDD/TUSD per Phase 17's `tron-top-25.json`). Future tokens or non-transfer calls (Phase 19+) emit conditional LEDGER NOTICE block.
   - (5) Layer 0.7 asymmetry — TRC-20 mandatory `triggerconstantcontract` refusal; native TRX no-simulation-available advisory (not refusal). Accepted residual surfaced visibly to user via `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE`.
   - (6) Ref-block + expiration window — TAPOS-replay protection via ref-block hash; tronweb default `expiration = block_timestamp + 60s` extended to `+900s` (15min) in `prepare_tron_*` to match handle TTL; TronGrid refuses expired tx at broadcast with structured error envelope surfaced through `BROADCAST_FAILED`.

6. **`test/trust-pipeline-tron.integration.test.ts`** — LOAD-BEARING integration test mirroring `test/solana-trust-pipeline.integration.test.ts`:
   - Mocked transport surface (3 personas — existing TRON whale persona from Phase 17 Plan 17-05 + 2 new demo personas for the cycle).
   - **Persona-cycle byte-identity assertions** for BOTH native AND TRC-20:
     - Within a persona: prepare → preview → send produces byte-identical `payloadFingerprint` from prepare to send (PREP-08 invariant).
     - Across personas: fingerprint DIFFERS (sender-dependent per CONTEXT D-05 — `owner_address` is a Protobuf field in both `TransferContract` AND `TriggerSmartContract`).
   - Three-gate FROZEN region regression: `previewToken` mismatch → `PREVIEW_TOKEN_MISMATCH`; `userDecision` not "send" → schema-level refusal; `payloadFingerprint` drift between prepare and send → `PAYLOAD_FINGERPRINT_DRIFT`.
   - Mandatory simulation regression: TRC-20 with mocked-revert TronGrid → `SIMULATION_REFUSED`; native TRX → `NO_SIMULATION_AVAILABLE` advisory emitted (NOT refusal).
   - `[STOP-THE-LINE]` comment at the top per Phase 12 Plan 12-05 precedent: "Any byte-identity assertion failing here is a security regression — DO NOT mask, fix the regression."

---

## Test patterns

| New / Modified Test | Analog | Pattern reused |
|---|---|---|
| `test/signing-fingerprint-tron.test.ts` (new) | [`test/signing-fingerprint-solana.test.ts`](../../test/signing-fingerprint-solana.test.ts) | Hardcoded `0x...` literal anchor per fixture; domain-tag length invariant; NO `beforeAll`-snapshot |
| `test/signing-presign-hash-tron.test.ts` (new) | [`test/signing-presign-hash-solana.test.ts`](../../test/signing-presign-hash-solana.test.ts) | Single-fixture SHA-256 regression + shape mirror |
| `test/simulation-tron.test.ts` (new) | [`test/simulation-solana.test.ts`](../../test/simulation-solana.test.ts) | 4-case status regression + spy-intercept regression + NEVER-throws contract |
| `test/blocks-tron.test.ts` (new) | [`test/blocks-solana.test.ts`](../../test/blocks-solana.test.ts) | Substitution + slot-pin regression |
| `test/amount-tron.test.ts` (new) | [`test/signing-amount-solana.test.ts`](../../test/signing-amount-solana.test.ts) | 4-step rejection ladder + u64 + u256 overflow guards |
| `test/canonical-dispatch-tron.test.ts` (new) | [`test/canonical-dispatch-solana.test.ts`](../../test/canonical-dispatch-solana.test.ts) | Allowlist contents + native-skip + refusal envelope |
| `test/handle-store.tron.test.ts` (new) | [`test/handle-store.solana.test.ts`](../../test/handle-store.solana.test.ts) | Discriminator round-trip + back-compat default `"evm"` |
| `test/protocols-tron-native.test.ts` (new) | [`test/protocols-solana-system.test.ts`](../../test/protocols-solana-system.test.ts) | Encoder byte-stability + decoder shape regression |
| `test/protocols-tron-trc20.test.ts` (new) | [`test/protocols-solana-spl.test.ts`](../../test/protocols-solana-spl.test.ts) + [`test/erc20-lifecycle.integration.test.ts`](../../test/erc20-lifecycle.integration.test.ts) | ABI-encoded calldata regression + decoder shape |
| `test/prepare-tron-native-send.test.ts` (new) | [`test/prepare-solana-native-send.test.ts`](../../test/prepare-solana-native-send.test.ts) | Fixture M re-anchor + PREPARE RECEIPT shape pin + ref-block surfacing |
| `test/prepare-tron-trc20-send.test.ts` (new) | [`test/prepare-solana-spl-send.test.ts`](../../test/prepare-solana-spl-send.test.ts) | Fixture N re-anchor + `parseTronAmountStrict` decimal-aware + sender-dependent fingerprint |
| `test/preview-send.tron.test.ts` (new) | [`test/preview-send.solana.test.ts`](../../test/preview-send.solana.test.ts) | Branch dispatch + mandatory-vs-advisory simulation regression |
| `test/send-transaction.tron.test.ts` (new) | [`test/send-transaction.solana.test.ts`](../../test/send-transaction.solana.test.ts) | Three-gate FROZEN region regression + broadcast envelope shape |
| `test/get-tx-verification.tron.test.ts` (new) | [`test/get-tx-verification.solana.test.ts`](../../test/get-tx-verification.solana.test.ts) | Additive structuredContent fields regression |
| `test/trust-pipeline-tron.integration.test.ts` (new) | [`test/solana-trust-pipeline.integration.test.ts`](../../test/solana-trust-pipeline.integration.test.ts) | Persona-cycle byte-identity + STOP-THE-LINE + mandatory-vs-advisory |

---

## FROZEN-area assertions (all 4 plans)

Verified at commit time via `git diff origin/main -- <path>` returns EMPTY:

- **EVM signing primitives:** `src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/signing/simulation.ts`, `src/signing/blocks.ts`, `src/signing/amount.ts`, `src/signing/aave-health.ts`, `src/signing/resolve-from.ts`, `src/signing/compound-collateralization.ts`.
- **Solana signing primitives:** `src/signing/payload-fingerprint-solana.ts`, `src/signing/presign-hash-solana.ts`, `src/signing/simulation-solana.ts`, `src/signing/blocks-solana.ts`, `src/signing/amount-solana.ts`.
- **Security allowlists:** `src/security/canonical-dispatch.ts`, `src/security/canonical-dispatch-solana.ts`.
- **Error codes:** `src/signing/error-codes.ts` — Phase 18 reuses existing codes; 23-code union BYTE-FROZEN per CONTEXT line 182.
- **Three-gate region of `send_transaction.ts`:** lines ~310-340 (PREVIEW_REQUIRED + PREVIEW_TOKEN_MISMATCH + PAYLOAD_FINGERPRINT_DRIFT) byte-identical. Plan 18-04 adds `txType === "tron"` to the dispatch switch BELOW the FROZEN region.
- **EVM + Solana branches of `preview_send.ts` and `send_transaction.ts`:** byte-identical; TRON branch is additive below.
- **Phase 4-12 fixture anchors:** `test/signing-fingerprint.test.ts` (Fixtures A-H + J), `test/signing-fingerprint-solana.test.ts` (Fixtures K + L), `test/signing-fingerprint.test.ts` (Fixtures R-U from Phase 28). Phase 18 NEW file `test/signing-fingerprint-tron.test.ts` carries Fixtures M + N.

---

## Risk surface

- **tronweb default expiration is 60s, NOT 1 hour as CONTEXT D-06b implies** — Plan 18-02 + 18-03 MUST call `extendExpiration(tx, 900)` after the `transactionBuilder.*` call so the handle TTL (15min) does not produce expired tx at broadcast time. Surfaced in 18-RESEARCH.md.
- **TRC-20 `feeLimit` is hardcoded at 100 TRX** in Plan 18-03 — sufficient for Phase 18's USDT/USDC/USDD/TUSD set. If TRON energy market shifts (energy unit price increases), the hardcoded limit could become insufficient. Phase 19+ adds user-controllable `feeLimit` if necessary.
- **`axios@1.15.0` CVE chain transitively imported by `tronweb@6.3.0`** — already documented as accepted residual in Phase 17 SECURITY.md (server→TronGrid only; no_proxy SSRF doesn't apply). Phase 18 inherits this acceptance.
- **Ledger TRX-app `tokenSignatures` parameter for `signTransaction`** — Phase 18 passes empty array `[]`. Phase 19's TRC-20 approve may require Ledger's per-token signature bundle for clear-sign coverage of arbitrary token contracts; defer the surface decision to Phase 19.
- **Asymmetric Layer 0.7 (TRC-20 mandatory refusal, native TRX advisory)** is intentional per CONTEXT D-03b but creates a documented residual — a malicious agent could prefer the native branch to bypass simulation. Defense relies on PREPARE RECEIPT (verbatim agent args) + LEDGER BLIND-SIGN HASH (on-device match). Surfaced in SECURITY.md TRON sub-section (5).

---

*Phase: 18-tron-native-trc20-trust-pipeline*
*Patterns mapped: 2026-05-20*
