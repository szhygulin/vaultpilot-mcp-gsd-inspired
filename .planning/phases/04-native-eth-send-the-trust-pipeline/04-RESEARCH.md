# Phase 4: Native ETH send (the trust pipeline) — Research

**Researched:** 2026-05-12
**Domain:** EIP-1559 transaction shaping, WC `eth_sendTransaction` request routing, in-process handle store + `payloadFingerprint` integrity binding, blind-sign hash recompute, 4byte.directory selector cross-check.
**Confidence:** HIGH (every viem call sketch verified against the installed `viem@2.48.11` `_types/`; `payloadFingerprint` and `LEDGER BLIND-SIGN HASH` test fixtures computed end-to-end locally; WC SDK `signClient.request` signature verified against the installed `@walletconnect/types@2.23.9` `engine.d.ts`). One MEDIUM-confidence item flagged: whether the Ledger Ethereum app's blind-sign screen displays the full 32-byte keccak256 hex or a truncated form — verifiable only at Phase 4 verify-phase against a real device.

## Summary

- Phase 4 is the load-bearing milestone — `prepare_native_send` → `preview_send` → `send_transaction` end-to-end. The crypto primitives are off-the-shelf viem calls; the work is in (a) shaping the handle store as a one-time-use state machine, (b) wiring the three plain-text blocks (`PREPARE RECEIPT`, `LEDGER BLIND-SIGN HASH`, `[AGENT TASK — RUN THESE CHECKS NOW]`) verbatim, and (c) the schema-level `previewToken + userDecision === "send"` gate that no soft check can substitute for.
- **viem is the keystone.** `keccak256`, `serializeTransaction`, `parseTransaction`, `numberToBytes`, `hexToBytes`, `toBytes`, `concat`, `bytesToHex` are all top-level exports from viem 2.48.11. Same package, same install — no new dependency. `estimateFeesPerGas`, `getTransactionCount`, `estimateGas`, `sendRawTransaction` are public-client actions already invoked via the same client object Phase 2 created. No private-key code path is ever introduced.
- **Ledger Live `eth_sendTransaction` returns the broadcasted txHash** — Ledger Live both signs (on the device) AND broadcasts (via its own RPC) internally. We do NOT `sendRawTransaction` ourselves. This collapses Phase 4 from "sign then broadcast" to "request via WC, receive txHash". Verified via Ledger Live `wallet-connect-live-app` type defs and the WC `eth_sendTransaction` spec.
- **The `payloadFingerprint` preimage is exact** (PREP-03): 23-byte UTF-8 tag + 32-byte BE chainId + 20-byte address + 32-byte BE value + variable data = 107 bytes for an empty-data native send. Test fixture computed against viem 2.48.11: for `{ chainId: 1, to: 0x7099…79C8, valueWei: 1e18, data: 0x }` → fingerprint = `0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a`. Pre-sign hash for the same tuple with `nonce: 7, gas: 21000, maxFeePerGas: 30 gwei, maxPriorityFeePerGas: 1.5 gwei` = `0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85`.
- **Plan dependency graph:** 04-01 (handle store + fingerprint + receipt) is pure infrastructure with zero MCP-tool surface. 04-02 (`prepare_native_send`) and 04-05 (4byte client + `get_tx_verification`) both depend ONLY on 04-01 and can be authored in parallel worktrees. 04-03 (`preview_send`) depends on 04-01 + 04-02. 04-04 (`send_transaction`) depends on 04-01 + 04-02 + 04-03. Recommended order: ship 04-01 first, then 04-02 ∥ 04-05 in parallel worktrees, then 04-03, then 04-04. This trims the critical path by one PR-merge round vs. strict 01→02→03→04→05.

**Primary recommendation:** Plan 04-01 lands `src/signing/handle-store.ts` (in-memory `Map<handle, HandleRecord>` + lazy TTL eviction) + `src/signing/fingerprint.ts` (keccak256 over the documented preimage) + `src/signing/blocks.ts` (`PREPARE_RECEIPT_TEMPLATE`, `LEDGER_BLIND_SIGN_HASH_TEMPLATE`, `AGENT_TASK_TEMPLATE` constants — the format-fanout-regex-sync sentinel pattern Phase 3 codified). The Wave 0 helper is a single `test/helpers/mock-public-client.ts` that scripts `getTransactionCount`, `estimateFeesPerGas`, `estimateGas` returns plus a `mock-sign-client.request.ts` shim for Phase 3's existing helper.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tx envelope construction (chainId, nonce, fees, gas) | MCP server (viem PublicClient) | Ethereum RPC | viem's `getTransactionCount` + `estimateFeesPerGas` + `estimateGas` are the canonical readers; the MCP composes the tuple but never signs it |
| `payloadFingerprint` computation (PREP-03) | MCP server | — | Deterministic preimage; pure function of `(chainId, to, valueWei, data)`; no external dep |
| EIP-1559 serialization + pre-sign hash recompute | MCP server (viem `serializeTransaction` + `keccak256`) | — | Pure transformation; no I/O; produces the bytes the user matches against the Ledger screen |
| `previewToken` minting + `userDecision` schema gate | MCP server (handle-store state machine + MCP input schema) | MCP SDK boundary | Schema-level enum lock on `userDecision: "send"` is the load-bearing defense per PREP-07 |
| Unsigned tx forwarding to device | MCP server → WC relay → Ledger Live → Ledger device | — | `signClient.request({ topic, chainId, request: { method: "eth_sendTransaction", params: [tx] } })` returns the broadcasted txHash; Ledger Live owns both signing and broadcast |
| 4byte.directory selector lookup (PREP-06) | MCP server (HTTP GET) | 4byte.directory API | Best-effort; surface error states verbatim per "no silent fallbacks" rule |
| `get_tx_verification` re-emit (PREP-10) | MCP server (handle-store read) | — | 15-min TTL re-emit of stored blocks; pure read of process-local cache |

## User Constraints

> Phase 4 has no CONTEXT.md (no `/gsd-discuss-phase` was run for this phase). All decisions remain open within the requirements + roadmap + ADR constraints already locked at the project level. CLAUDE.md directives apply verbatim; see Project Constraints section below.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PREP-01 | `prepare_native_send({ to, valueWei })` returns the documented tuple | Plan 04-02 — viem `getTransactionCount({ blockTag: "pending" })` + `estimateFeesPerGas({ type: "eip1559" })` + `estimateGas` resolve the missing fields; handle-store (04-01) issues the `handle` UUID |
| PREP-02 | `prepareReceipt` is verbatim args, surfaced as `PREPARE RECEIPT` block | Plan 04-01 — handle-store records the raw `{ to, valueWei }` strings as the agent passed them; tool response substitutes them into `PREPARE_RECEIPT_TEMPLATE` without normalization |
| PREP-03 | `payloadFingerprint = keccak256("VaultPilot-txverify-v1:" ‖ chainId(32-byte BE) ‖ to(20 bytes) ‖ value(32-byte BE) ‖ data)` | Plan 04-01 — see § Q1 below for the verified viem call sketch + computed fixture |
| PREP-04 | `preview_send` pins gas/nonce/maxFeePerGas, mints `previewToken`, recomputes EIP-1559 pre-sign hash, emits `LEDGER BLIND-SIGN HASH` block | Plan 04-03 — see § Q2 + Q3 below |
| PREP-05 | `[AGENT TASK — RUN THESE CHECKS NOW]` block in `preview_send`; agent reports in `CHECKS PERFORMED` | Plan 04-03 — § Q8 below (prose verbatim; the block IS the routing prompt per ADR-0003) |
| PREP-06 | 4byte.directory cross-check on the function selector | Plan 04-05 — § Q9 below |
| PREP-07 | `send_transaction` rejects without `previewToken` + `userDecision: "send"` | Plan 04-04 — § Q4 below (schema-level enum, not soft check) |
| PREP-08 | `payloadFingerprint` drift refusal at send time | Plan 04-04 — § Q15 below (handle-store state machine catches this) |
| PREP-09 | WC `eth_sendTransaction` forwarding; returns `{ txHash, broadcastedAt }` | Plan 04-04 — § Q10 below |
| PREP-10 | `get_tx_verification` re-emit with 15-min TTL | Plan 04-05 — § Q11 below |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `viem` | `^2.48.0` (installed 2.48.11) | All EVM primitives — `keccak256`, `serializeTransaction`, `parseTransaction`, `numberToBytes`, `hexToBytes`, `toBytes`, `bytesToHex`, `concat`, `getTransactionCount`, `estimateFeesPerGas`, `estimateGas`. Already in `package.json`. | Modern, native bigint, single-package surface for all primitives Phase 4 needs. Verified at `/tmp/viem-probe/node_modules/viem/_types/`. |
| `@walletconnect/sign-client` | `^2.23.9` | `signClient.request<string>({ topic, chainId, request: { method, params } })` for `eth_sendTransaction` forwarding. Already in `package.json`. | The same client Phase 3 lands as a lazy singleton (`src/wallet/walletconnect-client.ts`). Phase 4 imports the singleton; no new init. |
| `node:crypto` | builtin | `crypto.randomUUID()` for `handle` + `previewToken` UUIDs. Native since Node 14.17; project min is 18.17. | Zero dependency footprint; v4 UUID is the canonical one-time-token shape. [VERIFIED: nodejs.org/api/crypto.html — `crypto.randomUUID()` Stability 2 (Stable)] |

**Installation:** none — every dep is already in the lockfile.

**Version verification:** `cat package.json` shows `viem: ^2.48.0` + `@walletconnect/sign-client: ^2.23.9`. Probe install at `/tmp/viem-probe/` resolved `viem@2.48.11` (verified 2026-05-12 via `cat /tmp/viem-probe/node_modules/viem/package.json | grep version`).

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node `fetch` global | builtin (Node 18+) | 4byte.directory HTTP GET in Plan 04-05. No new HTTP client lib needed. | Plan 04-05 4byte client + abort signal for 1.5s timeout |
| `AbortController` | builtin | Cancel the 4byte fetch after 1.5s so a slow API never blocks `preview_send`. | Plan 04-05 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `crypto.randomUUID()` | `uuid` npm package | Adds a dep for a one-line builtin. Reject. |
| `viem.keccak256` | `@noble/hashes/sha3.keccak_256` | viem re-exports the same noble implementation; adding `@noble/hashes` directly is redundant (already transitive via viem). Reject. |
| `signClient.request` + Ledger-Live-broadcasts model | `signClient.request("eth_signTransaction", ...)` + our own `sendRawTransaction` | Splitting sign + broadcast adds an RPC dep at send time. The WC + Ledger Live community convention is `eth_sendTransaction` (Live broadcasts); going off-path costs a debug surface for zero benefit. Reject — confirmed by ledger.com `useSignAndBroadcastTransaction` hook docs + WalletConnect Kotlin issue #1429. |
| In-memory `Map` for handle store | Redis / SQLite / file | Process-local cache by design (matches no-disk-persistence rule from Phase 3). Across-process recovery is explicitly out of scope (`get_tx_verification` is the in-process recovery surface). Reject. |
| `setInterval` TTL sweep on handle store | Lazy eviction on access | Sweep adds an unref'd timer that vitest fake-timers complicate; lazy eviction has the same correctness with no timer surface. Reject sweep. |

## Architecture Patterns

### System Architecture Diagram

```
                                              ┌─────────────────────────────┐
                                              │ src/signing/handle-store.ts │
                                              │ Map<handle, HandleRecord>   │
                                              │ status: "prepared"          │
                                              │       → "previewed"         │
                                              │       → "sent"              │
                                              │ 15-min TTL (lazy eviction)  │
                                              └──────────────┬──────────────┘
                                                             │
              ┌──────────────────────────────────────────────┼──────────────────────────────────────────────┐
              │                                              │                                              │
   ┌──────────▼──────────┐                       ┌───────────▼───────────┐                       ┌──────────▼──────────┐
   │ prepare_native_send │  --(args verbatim)--> │     preview_send      │  --(previewToken)-->  │   send_transaction  │
   │       (04-02)       │                       │        (04-03)        │                       │       (04-04)       │
   │                     │                       │                       │                       │                     │
   │ - getTransactionCount│                       │ - estimateFeesPerGas │                       │ - schema gate:      │
   │   ({pending})       │                       │   pin nonce/gas/fees │                       │   previewToken +    │
   │ - estimateGas       │                       │ - mint previewToken  │                       │   userDecision:"send"│
   │ - estimateFeesPerGas│                       │ - serializeTransaction│                       │ - re-check          │
   │ - fingerprint(...)  │                       │ - keccak256(...)     │                       │   payloadFingerprint │
   │ - record(handle,    │                       │ - 4byte lookup       │                       │ - signClient.request│
   │   "prepared")       │                       │ - record handle as   │                       │   ({method:         │
   │ - emit PREPARE      │                       │   "previewed"        │                       │   "eth_sendTx",     │
   │   RECEIPT block     │                       │ - emit LEDGER        │                       │   chainId:"eip155:1"│
   │                     │                       │   BLIND-SIGN HASH    │                       │   params:[tx]})     │
   │                     │                       │   + AGENT TASK block │                       │ - record as "sent"  │
   │                     │                       │   + 4byte block      │                       │ - return {txHash,   │
   │                     │                       │                       │                       │   broadcastedAt}    │
   └─────────────────────┘                       └───────────────────────┘                       └─────────┬───────────┘
                                                                                                            │
                                                                                                            ▼
                                                                                          ┌────────────────────────────┐
                                                                                          │ src/wallet/session-manager │
                                                                                          │ (Phase 3 — already shipped)│
                                                                                          │ exposes session.topic via  │
                                                                                          │ new accessor (added in 04) │
                                                                                          └─────────────┬──────────────┘
                                                                                                        │
                                                                                                        │  WC v2 relay (WSS)
                                                                                                        ▼
                                                                                            ┌──────────────────────┐
                                                                                            │     Ledger Live      │
                                                                                            │ (handles BOTH signing│
                                                                                            │  AND broadcast — we  │
                                                                                            │  never call          │
                                                                                            │  sendRawTransaction) │
                                                                                            └──────────┬───────────┘
                                                                                                       │ USB-HID
                                                                                                       ▼
                                                                                          ┌────────────────────────┐
                                                                                          │     Ledger device      │
                                                                                          │ <-- ONLY TRUSTED       │
                                                                                          │     DISPLAY            │
                                                                                          │ blind-sign mode shows  │
                                                                                          │ keccak256(presign)     │
                                                                                          └────────────────────────┘

  ┌─────────────────────────────┐                       ┌─────────────────────────────┐
  │     4byte.directory          │  <----HTTP GET----   │  src/signing/fourbyte.ts     │
  │ api/v1/signatures/?hex_      │  (Plan 04-05; 1.5s   │  in-memory LRU cache         │
  │ signature=0xXXXXXXXX         │  AbortController     │  surfaces error/             │
  │                              │  timeout)            │  not-applicable verbatim     │
  └─────────────────────────────┘                       └──────────────┬──────────────┘
                                                                       │
                                                                       ▼
                                                              consumed by preview_send
                                                              and get_tx_verification

  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │  get_tx_verification (04-05)                                                     │
  │  Read-only handle-store lookup; re-emits whichever blocks the handle has reached │
  │  ("prepared" → PREPARE RECEIPT only; "previewed" → +LEDGER BLIND-SIGN HASH +     │
  │  AGENT TASK + 4byte; "sent" → +txHash echo). 15-min TTL from prepare time.       │
  └──────────────────────────────────────────────────────────────────────────────────┘
```

Read this diagram **left-to-right for the user flow** and **top-to-bottom for trust hierarchy** (the Ledger device at the bottom of the right column is the only trusted display per CLAUDE.md). The handle store is the central state machine; every tool either reads from it (`get_tx_verification`) or transitions it (`prepare → preview → send`).

### Recommended Project Structure

```
src/
├── signing/                          # NEW in Phase 4
│   ├── handle-store.ts               # 04-01: Map + state machine + TTL (lazy eviction)
│   ├── fingerprint.ts                # 04-01: payloadFingerprint computation (pure fn)
│   ├── blocks.ts                     # 04-01: PREPARE_RECEIPT_TEMPLATE, LEDGER_BLIND_SIGN_HASH_TEMPLATE, AGENT_TASK_TEMPLATE consts (format-fanout sentinels)
│   ├── presign-hash.ts               # 04-03: serializeTransaction + keccak256 wrapper
│   └── fourbyte.ts                   # 04-05: 4byte.directory client + LRU cache
├── tools/
│   ├── prepare_native_send.ts        # 04-02
│   ├── preview_send.ts               # 04-03
│   ├── send_transaction.ts           # 04-04
│   ├── get_tx_verification.ts        # 04-05
│   └── register-all.ts               # +4 import lines
└── wallet/
    └── session-manager.ts            # 04-04: ADD one export — getActiveSessionTopic(): string | null (no behavior change; just surfacing what's already cached)
```

**Why a dedicated `src/signing/` directory?** The handle store + fingerprint + block templates are non-tool primitives that Phase 6+ ERC-20 / Aave / WETH-unwrap prepare flows will reuse verbatim. Co-locating them with the four Phase 4 tools (`src/tools/`) would force Phase 6 to either copy the primitives or import from `src/tools/` (which would invert the dep direction). `src/signing/` mirrors the `src/wallet/` Phase 3 convention: transport-to-signer infrastructure separate from MCP tool handlers.

### Pattern 1: Handle store as a one-time-use state machine

**What:** A module-scoped `Map<string, HandleRecord>` keyed by UUID. Records hold the verbatim tx parameters, the computed `payloadFingerprint`, and a status enum (`"prepared" | "previewed" | "sent"`) that transitions monotonically. Lookups check `createdAt + 15*60*1000 < Date.now()` lazily on every read; expired records return a structured `HANDLE_EXPIRED` envelope.

**When to use:** Plan 04-01 (the store itself), 04-02 (writes a "prepared" record), 04-03 (reads + transitions to "previewed", writes the pinned fields), 04-04 (reads + verifies + transitions to "sent"), 04-05 (read-only re-emit).

**Example (TS strict — verified type shapes):**
```typescript
// src/signing/handle-store.ts
//
// Phase 4 handle store. In-memory Map keyed by handle UUID; 15-min lazy TTL;
// monotonic state machine "prepared" → "previewed" → "sent". Reads return
// HANDLE_EXPIRED for records older than TTL. No persistence by design — the
// security model is "fresh process = fresh handles" (matches Phase 3's
// no-disk-persistence rule).

import type { Address, Hex } from "viem";

export const HANDLE_TTL_MS = 15 * 60 * 1000;

export type HandleStatus = "prepared" | "previewed" | "sent";

/**
 * Records the verbatim args the agent passed in (PREPARE RECEIPT defense).
 * `to` + `valueWei` are stored as the raw strings — NOT normalized to
 * checksum or bigint. The format-fanout-regex-sync rule requires the wire
 * receipt to be byte-identical to what the agent sent.
 */
export interface PrepareArgs {
  to: string;            // raw 0x-string as agent passed it (not normalized)
  valueWei: string;      // raw decimal/hex string as agent passed it
}

/**
 * The constructed EIP-1559 tx fields the MCP composes. These ARE viem-typed
 * (Address, bigint, Hex) because they're internal to the server — the wire-
 * level verbatim shape lives in `args`.
 */
export interface PreparedTx {
  chainId: number;
  to: Address;
  valueWei: bigint;
  data: Hex;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface PreviewPinned {
  // Pinned at preview time so prepare → preview drift is impossible.
  // Currently identical to PreparedTx's pinned subset; carrying it as a
  // distinct field makes the "what got locked at preview" intent explicit.
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  previewToken: string;       // crypto.randomUUID() — schema-gate target
  presignHash: Hex;           // keccak256(serializeTransaction(...))
  selector: Hex | null;       // first 4 bytes of data, or null if data === "0x"
}

export interface HandleRecord {
  handle: string;
  args: PrepareArgs;
  tx: PreparedTx;
  payloadFingerprint: Hex;
  status: HandleStatus;
  createdAt: number;
  pinned?: PreviewPinned;     // present iff status >= "previewed"
  sentAt?: number;
  txHash?: Hex;
}

const store = new Map<string, HandleRecord>();

export function createHandle(input: {
  args: PrepareArgs;
  tx: PreparedTx;
  payloadFingerprint: Hex;
}): string {
  const handle = crypto.randomUUID();
  store.set(handle, {
    handle,
    args: input.args,
    tx: input.tx,
    payloadFingerprint: input.payloadFingerprint,
    status: "prepared",
    createdAt: Date.now(),
  });
  return handle;
}

export type LookupResult =
  | { ok: true; record: HandleRecord }
  | { ok: false; errorCode: "HANDLE_NOT_FOUND" | "HANDLE_EXPIRED" };

export function lookup(handle: string): LookupResult {
  const record = store.get(handle);
  if (!record) return { ok: false, errorCode: "HANDLE_NOT_FOUND" };
  if (Date.now() > record.createdAt + HANDLE_TTL_MS) {
    store.delete(handle); // lazy eviction — only on access
    return { ok: false, errorCode: "HANDLE_EXPIRED" };
  }
  return { ok: true, record };
}

export type TransitionResult =
  | { ok: true; record: HandleRecord }
  | { ok: false; errorCode: "HANDLE_NOT_FOUND" | "HANDLE_EXPIRED" | "WRONG_STATUS" };

export function transitionToPreviewed(
  handle: string,
  pinned: PreviewPinned,
): TransitionResult {
  const lookupResult = lookup(handle);
  if (!lookupResult.ok) return lookupResult;
  const record = lookupResult.record;
  // Idempotent: re-previewing a previewed handle re-pins (per § Q5
  // recommendation). status: "sent" is the terminal state — refuse.
  if (record.status === "sent") {
    return { ok: false, errorCode: "WRONG_STATUS" };
  }
  record.pinned = pinned;
  record.status = "previewed";
  return { ok: true, record };
}

export function transitionToSent(
  handle: string,
  txHash: Hex,
): TransitionResult {
  const lookupResult = lookup(handle);
  if (!lookupResult.ok) return lookupResult;
  const record = lookupResult.record;
  if (record.status !== "previewed") {
    return { ok: false, errorCode: "WRONG_STATUS" };
  }
  record.status = "sent";
  record.txHash = txHash;
  record.sentAt = Date.now();
  return { ok: true, record };
}

export function _resetHandleStoreForTesting(): void {
  store.clear();
}
```

### Pattern 2: Format-fanout-sentinel block templates

**What:** Each plain-text block (`PREPARE RECEIPT`, `LEDGER BLIND-SIGN HASH`, `[AGENT TASK — RUN THESE CHECKS NOW]`, `CHECKS PERFORMED`-stub) lives ONCE as an exported `string` constant from `src/signing/blocks.ts`. Tests import the constants and substitute placeholders the same way the handlers do. Per the global CLAUDE.md format-fanout-regex-sync rule (and Phase 3's `VERIFY_ON_DEVICE_TEMPLATE` precedent — see `src/tools/pair_ledger_live.ts:51`), the prod code and tests reference the same string, so drift between them is impossible.

**When to use:** Plan 04-01 owns the constants. 04-02 (`PREPARE RECEIPT` substitution), 04-03 (`LEDGER BLIND-SIGN HASH` + `AGENT TASK`), 04-05 (4byte selector cross-check block) all import.

**Example:**
```typescript
// src/signing/blocks.ts
//
// Format-fanout sentinels for the plain-text blocks the trust pipeline
// emits. Each constant is the SINGLE SOURCE OF TRUTH for its block; tests
// import the constant + substitute placeholders the same way handlers do,
// so prod + test can never drift (precedent: src/tools/pair_ledger_live.ts
// VERIFY_ON_DEVICE_TEMPLATE).

export const PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  to:       {TO}",
  "  valueWei: {VALUE_WEI}",
].join("\n");

export const LEDGER_BLIND_SIGN_HASH_TEMPLATE: string = [
  "LEDGER BLIND-SIGN HASH",
  "  Expected on-device hash: {PRESIGN_HASH}",
  "",
  "Match this hash CHARACTER-FOR-CHARACTER against the value your Ledger device",
  "displays in blind-sign mode. Any mismatch is a tamper signal. Do not approve",
  "on the device if the hashes differ.",
].join("\n");

export const AGENT_TASK_TEMPLATE: string = [
  "[AGENT TASK — RUN THESE CHECKS NOW]",
  "Before asking the user to confirm, perform the following local verification",
  "in your own runtime (do not delegate to the server):",
  "",
  "  1. Re-decode the unsigned tx bytes using viem.parseTransaction.",
  "  2. Assert decoded.to === {TO} and decoded.value === {VALUE_WEI}.",
  "  3. Recompute keccak256(viem.serializeTransaction(decoded)) and confirm it",
  "     equals {PRESIGN_HASH}.",
  "",
  "Report results to the user in a `CHECKS PERFORMED` block before the confirm",
  "prompt. Format:",
  "",
  "  CHECKS PERFORMED",
  "    decoded.to:           <value or `error: …`>",
  "    decoded.value:        <value or `error: …`>",
  "    recomputed presign:   <value or `error: …`>",
  "    matches LEDGER block: <yes / no / error>",
  "",
  "If any check fails, halt and report the failure to the user — do not send.",
].join("\n");
```

### Pattern 3: Schema-level `previewToken` + `userDecision` gate (PREP-07)

**What:** The `send_transaction` tool's `inputSchema` declares `previewToken: { type: "string" }` and `userDecision: { type: "string", enum: ["send"] }` as **required** properties. The MCP SDK's JSON-schema validator rejects any call missing those, or with `userDecision !== "send"`, BEFORE the handler runs. This is the schema-level gate PREP-07 calls for — not a soft `if` in the handler body.

**When to use:** Plan 04-04. Defense-in-depth: also re-check in the handler so a future schema-loosening change can't silently degrade the gate.

**Example:**
```typescript
// src/tools/send_transaction.ts (sketch)
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    handle: { type: "string", description: "Handle returned by prepare_native_send + verified by preview_send." },
    previewToken: { type: "string", description: "previewToken returned by preview_send. Single-use per handle." },
    userDecision: {
      type: "string",
      enum: ["send"],          // schema literal — the only accepted value
      description: "Must be the literal string \"send\". Any other value rejects at the MCP boundary.",
    },
  },
  required: ["handle", "previewToken", "userDecision"],
  additionalProperties: false,
};
```

The MCP SDK's `ajv`-backed validator enforces `enum: ["send"]` at the protocol boundary — confirmed in `node_modules/@modelcontextprotocol/sdk` (the SDK delegates to `ajv` with `allErrors: true`). [VERIFIED: `node_modules/ajv` is a direct dep of `@modelcontextprotocol/sdk@1.29.0` in `package-lock.json:1`]

### Anti-Patterns to Avoid

- **Pinning gas/nonce/fees at prepare time, not preview time.** Prepare may run minutes before preview if the user pauses to think. Pinning at prepare means the values are stale by the time the user reads the LEDGER BLIND-SIGN HASH block and approves. Pin at preview — that's the latest moment before signing, and it minimizes the gap during which the on-chain state can diverge from what the user is approving.
- **Re-fetching gas/nonce/fees at send time.** The opposite anti-pattern. Once preview pins them and the user confirms, the device signs the EXACT bytes the preview emitted. Re-fetching at send would change those bytes → the keccak256 hash differs from the LEDGER BLIND-SIGN HASH block → the user's whole verification ritual was meaningless. Always forward the pinned values verbatim.
- **Normalizing `to` or `valueWei` in `PREPARE RECEIPT`.** If the agent passed `"0xabc…"` lowercase, the receipt shows `"0xabc…"` lowercase — not `getAddress()` checksummed. The receipt's defense IS the verbatim guarantee; normalization defeats it. Asserted via byte-identical string comparison in Plan 04-02 tests.
- **Soft-checking `userDecision === "send"` instead of schema enum.** A handler-level `if (args.userDecision !== "send") return refusal` is bypassable by any future code path that constructs a different args object server-side. The schema-level `enum: ["send"]` enforces at the MCP boundary, BEFORE the handler runs. PREP-07 specifies "schema-level gate, not a soft check" — this is non-negotiable.
- **Calling `signClient.request` without first refreshing the session topic.** A user can disconnect from Ledger Live between prepare and send. Phase 3's session-manager wires a `session_delete` listener that clears the cached topic (`src/wallet/session-manager.ts:257-263`). Plan 04-04 must call `getStatus()` BEFORE the send to confirm the session is still live; refuse with `WALLET_NOT_PAIRED` on `null`.
- **Hand-rolling RLP for the EIP-1559 envelope.** `viem.serializeTransaction({ type: "eip1559", ... })` handles the `0x02 || rlp([...])` framing correctly (verified at `/tmp/viem-probe/node_modules/viem/_types/utils/transaction/serializeTransaction.d.ts:20`). Hand-rolling RLP is a multi-week surface with no payoff.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| keccak256 hashing | `@noble/hashes/sha3.keccak_256` directly | `viem.keccak256` | Same noble implementation under the hood; viem's wrapper returns `0x`-prefixed hex matching the project's `Hex` type convention everywhere else |
| EIP-1559 RLP envelope | Custom RLP encoder + `0x02` prefix | `viem.serializeTransaction({ type: "eip1559", ... })` | RLP encoding, EIP-2718 wrapping, and access-list handling are all in the canonical viem path; verified at `viem/_types/utils/transaction/serializeTransaction.d.ts:20` |
| Gas + nonce + fee resolution | Manual `eth_getTransactionCount` + `eth_feeHistory` JSON-RPC calls | `viem.getTransactionCount({ blockTag: "pending" })` + `viem.estimateFeesPerGas({ type: "eip1559" })` + `viem.estimateGas({ ... })` | Returns viem-typed `bigint` / `number` already; the public client we created in Phase 2 already has these actions |
| Transaction broadcasting | `viem.sendRawTransaction(...)` after Ledger Live signs | `signClient.request({ method: "eth_sendTransaction", ... })` lets Ledger Live broadcast | Ledger Live's `eth_sendTransaction` returns the broadcasted `txHash` directly — splitting sign + broadcast adds an RPC dep and a debug surface for zero benefit (the WC + Ledger Live convention) |
| UUID generation | `uuid` npm | `crypto.randomUUID()` (Node 14.17+) | Builtin; v4 UUID; project min is Node 18.17 |
| HTTP client for 4byte.directory | `axios` / `node-fetch` | Global `fetch` + `AbortController` | Node 18+ builtins; no new dep; 4byte is a single GET with no pagination needed for Phase 4 |
| JSON-schema validation | Hand-rolled `if/else` | MCP SDK's `inputSchema` + `enum: ["send"]` | The SDK already runs `ajv` at the protocol boundary; redundant handler checks are defense-in-depth, not the primary gate |

**Key insight:** Phase 4 has zero new primitive-level complexity. The complexity is **state machine integrity** (the handle's monotonic transitions), **block-text verbatim discipline** (the format-fanout-regex-sync rule), and the **schema gate** (PREP-07). Every primitive that does math comes from viem; every primitive that does I/O comes from the existing public client or the existing `SignClient`.

## Runtime State Inventory

> Phase 4 is greenfield (no rename/refactor/migration). This section is omitted.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node `fetch` global | Plan 04-05 4byte HTTP GET | ✓ (Node 18+ builtin) | — | none — project min is 18.17 |
| `AbortController` builtin | Plan 04-05 4byte timeout | ✓ (Node 15+ builtin) | — | none |
| `crypto.randomUUID()` builtin | Plans 04-01, 04-03 (handle + previewToken UUIDs) | ✓ (Node 14.17+ builtin) | — | none |
| Network egress to `www.4byte.directory` (HTTPS) | Plan 04-05 best-effort selector lookup | Required for cross-check; not blocking | — | PREP-06 spec: "best-effort; `error` / `not-applicable` states surface verbatim". Unreachable → block shows `error: 4byte.directory unreachable`. |
| Network egress to `relay.walletconnect.com` (WSS) | Plan 04-04 `signClient.request` | Already required by Phase 3 | — | None — `send_transaction` returns structured error if WC is down (caller can `get_ledger_status` to confirm) |
| Ethereum RPC reachability | Plans 04-02, 04-03 (gas/nonce/fee reads) | Existing `getEthereumClient()` already has PublicNode fallback (Phase 2) | — | viem reads bubble up as `prepare_native_send` failure; the user retries |
| Ledger device + Ledger Live | Phase 4 verify-phase smoke (NOT unit tests) | User-side only | — | Verify-phase task; unit tests fully mock `signClient.request` |
| `WALLETCONNECT_PROJECT_ID` env var | Plan 04-04 (`signClient.request` requires a paired session, which requires init) | Already required by Phase 3 | — | None — `pair_ledger_live` already gates on this |

**Missing dependencies with no fallback:** none — Phase 4's only new external is 4byte.directory, and PREP-06 explicitly accepts its unavailability as a verbatim error surface.

## Common Pitfalls

### Pitfall 1: `0x`-empty data confused with `Uint8Array(0)`

**What goes wrong:** Native sends have `data === "0x"` (empty hex). Some code paths read this as "no data field present"; others want `Uint8Array(0)`. viem's `hexToBytes("0x")` returns `Uint8Array(0)` correctly, and `serializeTransaction` accepts `data: "0x"` (or `undefined`). But the `payloadFingerprint` preimage requires `data` to be CONCAT'd in — and the empty-bytes case must produce zero bytes appended, not the string "0x" appended.
**Why it happens:** Mixing string-mode and byte-mode is a perennial source of fingerprint mismatches.
**How to avoid:** Always go through `hexToBytes(data ?? "0x")` before `concat` in the fingerprint preimage. Verified in the computed fixture: `hexToBytes("0x")` → `Uint8Array(0)` → contributes 0 bytes to the 107-byte preimage.
**Warning signs:** The fingerprint computed at prepare time doesn't match a fresh recompute on the same inputs — almost always a data-type mismatch.

### Pitfall 2: `numberToBytes(bigint, { size: 32 })` for value, NOT for nonce/gas/fees

**What goes wrong:** The `payloadFingerprint` preimage uses `numberToBytes(value, { size: 32 })` because PREP-03 mandates a 32-byte BE value. The EIP-1559 RLP envelope uses minimal-byte encoding for `nonce`, `gas`, `maxFeePerGas`, `maxPriorityFeePerGas` (RLP rules). `viem.serializeTransaction` handles the RLP encoding internally — DON'T pre-pad the values yourself before passing them.
**Why it happens:** Confusing fingerprint preimage rules (PREP-03's documented preimage) with RLP rules (EIP-1559's spec).
**How to avoid:** Pass viem-typed `bigint` / `number` directly to `serializeTransaction`. Use `numberToBytes` ONLY in the fingerprint preimage construction. They are different functions in two different code paths.
**Warning signs:** EIP-1559 transactions reject on-chain with "transaction underpriced" or RLP-decoding errors.

### Pitfall 3: Address checksum drift between `PREPARE RECEIPT` and the constructed tx

**What goes wrong:** Agent passes `to: "0xabc…"` (lowercase). `PREPARE RECEIPT` MUST show `"0xabc…"` lowercase (verbatim). But the constructed tx uses `getAddress(to)` (checksummed) for viem-internal correctness — and the `payloadFingerprint` preimage uses `hexToBytes(checksummedAddress)` (the byte content is identical regardless of case, so the fingerprint matches). The receipt-vs-tx mismatch is intentional: receipt is wire-verbatim, tx is server-internal-normalized.
**Why it happens:** A naive implementation normalizes once and uses the normalized form everywhere.
**How to avoid:** Store `args` (raw strings) and `tx` (viem-typed) as distinct fields on the handle record (per the HandleRecord interface above). Receipt block reads from `args`; everything else reads from `tx`.
**Warning signs:** A user reports the receipt's address differs from what they typed; mismatch is a code bug, not a tamper signal.

### Pitfall 4: Stale nonce between preview and send

**What goes wrong:** Preview pins `nonce: 7`. User pauses for 30 seconds. In that window, the user (separately) broadcasts another transaction from the same address (via a different wallet, or via a separate `prepare → preview → send` flow that completed faster). At send time, nonce 7 is already consumed; Ledger Live's broadcast fails with "nonce too low" or the tx sits in pending forever.
**Why it happens:** The MCP doesn't and shouldn't poll the chain between preview and send — that would change the bytes the user already approved.
**How to avoid:** Pass through Ledger Live's error verbatim. `signClient.request` rejection from a nonce-too-low broadcast becomes `BROADCAST_FAILED` with the underlying message attached. The user re-runs `prepare_native_send` to get a fresh nonce.
**Warning signs:** Multiple users report "tx never confirmed" — almost always nonce reuse from out-of-band activity.

### Pitfall 5: Process-local handle store across MCP client restarts

**What goes wrong:** User runs `prepare_native_send`, sees the LEDGER BLIND-SIGN HASH block, restarts Claude Code (context-evicted at the agent layer; MCP client also resets). The handle is gone — `get_tx_verification` can't recover it.
**Why it happens:** No-persistence is a deliberate security property (matches Phase 3's `:memory:` WC storage). Persistence would mean a stale prepared-but-unsigned handle could survive a process restart with a now-stale gas/nonce snapshot, and the user would have no idea.
**How to avoid:** Document the failure mode. `get_tx_verification` is intra-process recovery only — agent context loss within a session, NOT MCP-client restart. If the MCP client restarts, the user re-runs `prepare_native_send`. Plan 04-05 must surface this clearly in the tool description.
**Warning signs:** Users expect handles to survive restart — call this out in the tool description verbatim.

### Pitfall 6: Ledger device blind-sign hash representation drift

**What goes wrong:** The MCP emits `LEDGER BLIND-SIGN HASH` with the full 32-byte keccak256 hex (66 chars including `0x`). The Ledger device displays a TRUNCATED form (e.g. just the last 8 chars, or chunked into 4-char groups). User can't actually do a character-for-character match.
**Why it happens:** Ledger devices have a small screen; some firmware versions truncate.
**How to avoid:** Verify in Phase 4 verify-phase against a real device — recommend showing BOTH the full hex AND a 4-char-chunked form in the `LEDGER BLIND-SIGN HASH` block. If the device shows only chunks, the user matches chunks; if it shows the full hex, they match characters. Defensive emission costs zero. **MEDIUM-confidence assumption — flagged as A1 in the Assumptions Log.**
**Warning signs:** Verify-phase user reports "I can't tell if these match" — fix the block format.

## Code Examples

Verified against `/tmp/viem-probe/node_modules/viem@2.48.11/_types/`.

### Example 1: `payloadFingerprint` computation (Plan 04-01)

```typescript
// src/signing/fingerprint.ts
import { keccak256, numberToBytes, hexToBytes, toBytes, concat } from "viem";
import type { Address, Hex } from "viem";

// Domain tag — version-stamped so future fingerprint formats (e.g. v2 with
// access-list bound) don't conflict at the keccak preimage level. NOT
// configurable; this is the trust-pipeline binding.
const DOMAIN_TAG = "VaultPilot-txverify-v1:";

/**
 * Compute the prepare-time-stable payloadFingerprint per PREP-03.
 *
 * Preimage = DOMAIN_TAG (utf-8) ‖ chainId(32-byte BE) ‖ to(20 bytes) ‖
 *            value(32-byte BE) ‖ data(variable)
 *
 * For a native send with data === "0x", the preimage is 107 bytes
 * (23 + 32 + 20 + 32 + 0). For an ERC-20 transfer with 68-byte data,
 * the preimage is 175 bytes. The keccak output is 32 bytes (0x-prefixed
 * hex string = 66 chars including the prefix).
 *
 * Returns the 0x-prefixed hex string for the wire shape; tests compare
 * against a hardcoded fixture.
 */
export function computePayloadFingerprint(input: {
  chainId: number;
  to: Address;
  valueWei: bigint;
  data: Hex;
}): Hex {
  const tag = toBytes(DOMAIN_TAG);                          // 23 bytes utf-8
  const chainIdBytes = numberToBytes(input.chainId, { size: 32 });
  const toBytes20 = hexToBytes(input.to);                   // 20 bytes — viem rejects non-address-shaped input
  const valueBytes = numberToBytes(input.valueWei, { size: 32 });
  const dataBytes = hexToBytes(input.data);                 // 0 bytes when data === "0x"
  const preimage = concat([tag, chainIdBytes, toBytes20, valueBytes, dataBytes]);
  return keccak256(preimage);
}
```

**Verified test fixture (computed end-to-end at `/tmp/viem-probe/compute-fingerprint.mjs`, 2026-05-12):**

```
INPUT:
  chainId    = 1
  to         = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  valueWei   = 1000000000000000000n  (1 ETH)
  data       = 0x

PREIMAGE (107 bytes):
  0x5661756c7450696c6f742d74787665726966792d76313a000000000000000000000000000000000000000000000000000000000000000170997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000de0b6b3a7640000

EXPECTED FINGERPRINT:
  0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a
```

**Imports verified against installed types:**
- `keccak256` — `/tmp/viem-probe/node_modules/viem/_types/utils/hash/keccak256.d.ts:9` — `function keccak256<to extends To = 'hex'>(value: Hex | ByteArray, to_?: to | undefined): Keccak256Hash<to>` ✓
- `numberToBytes` — `/tmp/viem-probe/node_modules/viem/_types/utils/encoding/toBytes.d.ts:108` — `function numberToBytes(value: bigint | number, opts?: NumberToHexOpts | undefined): ByteArray` ✓ (accepts `{ size: 32 }`)
- `hexToBytes` — `/tmp/viem-probe/node_modules/viem/_types/utils/encoding/toBytes.d.ts:87` — `function hexToBytes(hex_: Hex, opts?: HexToBytesOpts): ByteArray` ✓
- `toBytes` — `/tmp/viem-probe/node_modules/viem/_types/utils/encoding/toBytes.d.ts:37` — accepts `string` and returns `ByteArray` ✓
- `concat` — `/tmp/viem-probe/node_modules/viem/_types/utils/data/concat.d.ts` — concatenates `ByteArray[]` to `ByteArray` ✓

### Example 2: EIP-1559 pre-sign hash recompute (Plan 04-03)

```typescript
// src/signing/presign-hash.ts
import { keccak256, serializeTransaction } from "viem";
import type { Address, Hex } from "viem";

/**
 * Compute the keccak256 of the EIP-1559 transaction envelope BEFORE
 * signing. This is the hash the Ledger device displays in blind-sign mode.
 * Per the EIP-1559 spec (EIP-2718 wrapping):
 *   serialized = 0x02 || rlp([chainId, nonce, maxPriorityFeePerGas,
 *                              maxFeePerGas, gas, to, value, data,
 *                              accessList])
 *   hash = keccak256(serialized)
 *
 * viem.serializeTransaction handles the 0x02 || rlp(...) framing internally
 * (verified at viem/_types/utils/transaction/serializeTransaction.d.ts:20).
 */
export function computePresignHash(input: {
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gas: bigint;
  to: Address;
  value: bigint;
  data: Hex;
}): { serialized: Hex; presignHash: Hex } {
  const serialized = serializeTransaction({
    type: "eip1559",
    chainId: input.chainId,
    nonce: input.nonce,
    to: input.to,
    value: input.value,
    gas: input.gas,
    maxFeePerGas: input.maxFeePerGas,
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    data: input.data,
    accessList: [],
  });
  return { serialized, presignHash: keccak256(serialized) };
}
```

**Verified test fixture (same inputs as Example 1 plus pinned fees, computed at `/tmp/viem-probe/compute-fingerprint.mjs`):**

```
INPUT (in addition to fingerprint inputs):
  nonce                 = 7
  gas                   = 21000n
  maxFeePerGas          = 30000000000n        (30 gwei)
  maxPriorityFeePerGas  = 1500000000n         (1.5 gwei)

SERIALIZED (unsigned EIP-1559, 0x02 || rlp([...])):
  0x02f001078459682f008506fc23ac008252089470997970c51812dc3a010c7d01b50e0d17dc79c8880de0b6b3a764000080c0
  (first byte 0x02 confirms EIP-2718 wrapping; final 0xc0 is the empty access-list)

EXPECTED PRE-SIGN HASH:
  0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85
```

This is the value the LEDGER BLIND-SIGN HASH block MUST emit. The user matches this against the device screen character-for-character (subject to A1 below — the device may display a chunked / truncated form).

**Imports verified:**
- `serializeTransaction` — `/tmp/viem-probe/node_modules/viem/_types/utils/transaction/serializeTransaction.d.ts:20` ✓
- `keccak256` — same as Example 1 ✓

### Example 3: Pinning gas + nonce + fees at preview time (Plan 04-03)

```typescript
// inside preview_send handler (sketch)
import { getTransactionCount, estimateFeesPerGas, estimateGas } from "viem/actions";
import { getEthereumClient } from "../chains/ethereum.js";
import { computePresignHash } from "../signing/presign-hash.js";
import { lookup, transitionToPreviewed } from "../signing/handle-store.js";

// ... handler entry, args validation, isDemoMode + WALLET_NOT_PAIRED checks ...

const lookupResult = lookup(args.handle);
if (!lookupResult.ok) return refusalFromLookup(lookupResult.errorCode);
const record = lookupResult.record;
const { tx, args: prepArgs } = record;

const client = getEthereumClient();

// PREP-04: pin at preview, not at prepare. The 3 reads fan out concurrently;
// all 3 should land sub-second on a healthy RPC. If any fails, refuse — the
// user gets a re-prepare prompt.
const [pendingNonce, fees, gasEstimate] = await Promise.all([
  getTransactionCount(client, { address: tx.to, blockTag: "pending" }),
  estimateFeesPerGas(client, { type: "eip1559" }),
  estimateGas(client, { account: tx.to, to: tx.to, value: tx.valueWei }),
]);
//  NOTE: `address` for getTransactionCount is the SENDER, not the recipient.
//  Phase 4 implementation must use the paired wallet's address from
//  session-manager.getStatus() — not `tx.to`. Plan 04-03 must wire this
//  correctly; the sketch above is illustrative of the viem call shape only.

const { presignHash, serialized } = computePresignHash({
  chainId: tx.chainId,
  nonce: pendingNonce,
  maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  maxFeePerGas: fees.maxFeePerGas,
  gas: gasEstimate,
  to: tx.to,
  value: tx.valueWei,
  data: tx.data,
});

const previewToken = crypto.randomUUID();
const selector = tx.data === "0x" ? null : (tx.data.slice(0, 10) as Hex); // first 4 bytes = 8 hex chars + "0x"

const trans = transitionToPreviewed(record.handle, {
  nonce: pendingNonce,
  gas: gasEstimate,
  maxFeePerGas: fees.maxFeePerGas,
  maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  previewToken,
  presignHash,
  selector,
});
// ... build response with LEDGER_BLIND_SIGN_HASH_TEMPLATE + AGENT_TASK_TEMPLATE substituted ...
```

**Imports verified:**
- `getTransactionCount` — `/tmp/viem-probe/node_modules/viem/_types/actions/public/getTransactionCount.d.ts:48` — `function getTransactionCount<...>(client, { address, blockTag, blockNumber }): Promise<number>` ✓
- `estimateFeesPerGas` — `/tmp/viem-probe/node_modules/viem/_types/actions/public/estimateFeesPerGas.d.ts:48` — returns `{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }` for `type: 'eip1559'` (the default) ✓
- `estimateGas` — `/tmp/viem-probe/node_modules/viem/_types/actions/public/estimateGas.d.ts:61` — `function estimateGas<...>(client, args): Promise<bigint>` ✓

### Example 4: `signClient.request` for `eth_sendTransaction` (Plan 04-04)

```typescript
// src/tools/send_transaction.ts (sketch)
import { getWalletConnectClient } from "../wallet/walletconnect-client.js";
import { getStatus, getActiveSessionTopic } from "../wallet/session-manager.js";
import { lookup, transitionToSent } from "../signing/handle-store.js";

// ... schema-gate (handled by SDK) + handler entry + demo-mode check ...

const lookupResult = lookup(args.handle);
if (!lookupResult.ok) return refusalFromLookup(lookupResult.errorCode);
const record = lookupResult.record;

if (record.status !== "previewed") {
  return refusal("PREVIEW_REQUIRED", "call preview_send before send_transaction");
}
if (!record.pinned) {
  // Type narrowing — should be impossible if status === "previewed", but
  // defense-in-depth.
  return refusal("INTERNAL_ERROR", "previewed handle missing pinned state");
}
if (record.pinned.previewToken !== args.previewToken) {
  return refusal("PREVIEW_TOKEN_MISMATCH", "previewToken does not match the one minted by preview_send");
}

// PREP-08: re-check the fingerprint. Defense against a compromised state
// mutation between prepare and send (e.g. someone splices in a different
// handle record under the same key — implausible in-process, but the
// invariant is documented and tested).
const recomputed = computePayloadFingerprint({
  chainId: record.tx.chainId,
  to: record.tx.to,
  valueWei: record.tx.valueWei,
  data: record.tx.data,
});
if (recomputed !== record.payloadFingerprint) {
  return refusal(
    "PAYLOAD_FINGERPRINT_DRIFT",
    "prepare↔send drift detected; abort and re-run prepare_native_send",
  );
}

// Confirm the session is still live (user may have disconnected since
// preview). Phase 3 session_delete listener already drops the cached topic;
// getStatus() re-reads the SDK store.
const status = await getStatus();
if (!status) {
  return refusal("WALLET_NOT_PAIRED", "no live Ledger session; pair_ledger_live");
}
const topic = getActiveSessionTopic(); // NEW export added in Plan 04-04
if (!topic) {
  return refusal("WALLET_NOT_PAIRED", "session topic gone; re-pair");
}

const signClient = await getWalletConnectClient();

// PREP-09: forward via WC. Ledger Live signs AND broadcasts; the response
// is the broadcasted txHash (a Hex string), not the signed bytes.
const txParams = [{
  from: status.address,
  to: record.tx.to,
  value: `0x${record.tx.valueWei.toString(16)}`,   // viem-compatible hex; matches RPC convention
  gas: `0x${record.pinned.gas.toString(16)}`,
  maxFeePerGas: `0x${record.pinned.maxFeePerGas.toString(16)}`,
  maxPriorityFeePerGas: `0x${record.pinned.maxPriorityFeePerGas.toString(16)}`,
  nonce: `0x${record.pinned.nonce.toString(16)}`,
  data: record.tx.data,
}];

let txHash: Hex;
try {
  txHash = await signClient.request<Hex>({
    topic,
    chainId: `eip155:${record.tx.chainId}`,        // CAIP-2 — verified spec requirement
    request: { method: "eth_sendTransaction", params: txParams },
  });
} catch (err) {
  // Bubble Ledger Live errors verbatim; tag them. User-rejected on device
  // surfaces as a WC error code; broadcast failures (nonce too low etc)
  // surface as JSON-RPC errors. Tag and return; don't mask.
  return mapLedgerLiveError(err); // → LEDGER_REJECTED or BROADCAST_FAILED
}

const trans = transitionToSent(record.handle, txHash);
// ... build success response with {txHash, broadcastedAt: new Date().toISOString()} ...
```

**Imports verified:**
- `signClient.request<T>(params)` — `/tmp/wc-probe/node_modules/@walletconnect/types/dist/types/sign-client/engine.d.ts:319` — `abstract request<T>(params: EngineTypes.RequestParams): Promise<T>;` where `RequestParams = { topic: string; request: { method: string; params: any }; chainId: string; expiry?: number }` ✓
- Public `request` field on `SignClient` class — `/tmp/wc-probe/node_modules/@walletconnect/sign-client/dist/types/client.d.ts:31` — `request: ISignClient["request"]` ✓

**Source-of-truth note:** `signClient.request` returns `Promise<T>` parameterized; passing `<Hex>` types the result as a `0x`-string. Ledger Live's `wallet-connect-live-app` returns the broadcasted hash as a hex string for `eth_sendTransaction` ([CITED: ledger.com `useSignAndBroadcastTransaction` docs — "Returns the transaction hash once successfully broadcasted"]).

### Example 5: 4byte.directory client (Plan 04-05)

```typescript
// src/signing/fourbyte.ts
//
// Best-effort selector → human-readable signature lookup. Per PREP-06,
// error and not-applicable states surface VERBATIM in the cross-check
// block (per the "no silent fallbacks" CLAUDE.md rule).

import type { Hex } from "viem";
import { log } from "../diagnostics/logger.js";

const FOURBYTE_API_URL = "https://www.4byte.directory/api/v1/signatures/";
const FOURBYTE_TIMEOUT_MS = 1_500;
const CACHE_MAX_ENTRIES = 256;

export type FourbyteResult =
  | { kind: "not-applicable" }                     // selector === null (data === "0x")
  | { kind: "found"; textSignature: string }
  | { kind: "not-found" }                          // 200 OK, results: []
  | { kind: "error"; message: string };            // network / 5xx / parse

const cache = new Map<Hex, FourbyteResult>();

export async function lookupSelector(selector: Hex | null): Promise<FourbyteResult> {
  if (selector === null) return { kind: "not-applicable" };
  const cached = cache.get(selector);
  if (cached) return cached;

  const url = `${FOURBYTE_API_URL}?hex_signature=${selector}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FOURBYTE_TIMEOUT_MS);

  let result: FourbyteResult;
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      result = { kind: "error", message: `4byte.directory returned HTTP ${resp.status}` };
    } else {
      const body = (await resp.json()) as { results?: Array<{ text_signature: string }> };
      if (!body.results || body.results.length === 0) {
        result = { kind: "not-found" };
      } else {
        // Multiple selector collisions exist (intentional spam in some entries).
        // Phase 4 reports the FIRST entry's text_signature; v1.3 dispatch-target
        // allowlist will narrow this. Verbatim surface per PREP-06 — we do not
        // pretend to disambiguate.
        result = { kind: "found", textSignature: body.results[0]!.text_signature };
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      result = { kind: "error", message: "4byte.directory unreachable (timeout 1.5s)" };
    } else {
      result = { kind: "error", message: `4byte.directory unreachable: ${(err as Error).message}` };
    }
    log("warn", `4byte.directory lookup failed for ${selector}: ${result.kind === "error" ? result.message : ""}`); // stderr per project convention
  } finally {
    clearTimeout(timer);
  }

  // Cache even error results — short window saves us from hammering a down
  // API. The cache is process-local, dies with the process. LRU is implicit
  // via Map iteration order; trim on size overflow.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(selector, result);
  return result;
}

export function _resetFourbyteCacheForTesting(): void {
  cache.clear();
}
```

**API shape verified:** GET `https://www.4byte.directory/api/v1/signatures/?hex_signature=0x1234` returns `{ count, next, previous, results: [{ id, created_at, text_signature, hex_signature, bytes_signature }] }`. [CITED: `https://www.4byte.directory/api/v1/signatures/?hex_signature=0x144f2f94` (concrete example); ethereum-lists/4bytes GitHub README]

## Per-Question Findings

### Q1: `payloadFingerprint` preimage exactness (PREP-03)

Verified end-to-end. See Code Example 1 for the implementation sketch, computed fixture, and viem type-def citations. **HIGH confidence.**

- The 23-byte ASCII tag `"VaultPilot-txverify-v1:"` is correct (length verified by computing `Buffer.from("VaultPilot-txverify-v1:").length === 23`).
- `numberToBytes(n, { size: 32 })` produces a 32-byte big-endian encoding (viem default endianness verified by the computed preimage hex).
- `hexToBytes("0xAddress…")` returns a 20-byte array for any address-shaped hex.
- `hexToBytes("0x")` returns `Uint8Array(0)` (verified in the fixture run — the 107-byte preimage has zero data bytes appended).
- `concat([...])` produces `Uint8Array(tag.len + chainId.len + to.len + value.len + data.len) = 23 + 32 + 20 + 32 + 0 = 107` ✓.
- `keccak256(preimage)` returns `0x`-prefixed hex (66 chars total) by default.
- **For non-empty data** (Phase 6+ ERC-20 / Aave): the formula carries through unchanged. The preimage length grows by `data.length / 2 - 1` bytes (e.g. a 68-byte ERC-20 transfer adds 68 bytes → 175-byte preimage). PREP-03's preimage is intentionally generic across tx types.

### Q2: EIP-1559 pre-sign hash recompute (PREP-04 / PREP-05)

Verified end-to-end. See Code Example 2. **HIGH confidence for the math; MEDIUM for what the device displays — flagged as A1.**

- `viem.serializeTransaction({ type: "eip1559", chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to, value, data, accessList: [] })` returns `0x02 || rlp([...])` as a `Hex` string. Verified at `viem/_types/utils/transaction/serializeTransaction.d.ts:20`.
- The first byte `0x02` confirms EIP-2718 wrapping for the EIP-1559 type.
- The final byte `0xc0` in the fixture is the RLP encoding of an empty list (`accessList`).
- `keccak256(serialized)` over the unsigned envelope produces the pre-sign hash (32 bytes, hex-encoded).
- **What the Ledger device displays in blind-sign mode** — Ledger documentation describes the device as showing "the raw hash" when clear-signing is unavailable. The 32-byte hex form is the canonical representation. **A1: confirm at verify-phase whether the device shows the full 32-byte hex, a truncated last-N chars, or a chunked grouping.** If chunked/truncated, the `LEDGER_BLIND_SIGN_HASH_TEMPLATE` should defensively emit BOTH a full-hex form AND a 4-char-chunked form so the user can match either way.

### Q3: Pinning gas + nonce + maxFeePerGas at preview time (PREP-04)

Verified. See Code Example 3. **HIGH confidence.**

- Why pin at preview, not at prepare: prepare may run minutes before preview if the user pauses. Pinning at preview minimizes the time-gap during which on-chain state diverges from approved bytes.
- viem APIs:
  - `getTransactionCount(client, { address: <sender>, blockTag: "pending" }): Promise<number>` — `viem/_types/actions/public/getTransactionCount.d.ts:48` ✓
  - `estimateFeesPerGas(client, { type: "eip1559" }): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>` — `viem/_types/actions/public/estimateFeesPerGas.d.ts:48` (default type is `'eip1559'`) ✓
  - `estimateGas(client, { account, to, value }): Promise<bigint>` — `viem/_types/actions/public/estimateGas.d.ts:61` ✓
- Sender address comes from `session-manager.getStatus().address` (Phase 3 already exposes this) — NOT the recipient.
- Staleness handling: pass through Ledger Live's broadcast error verbatim (see Pitfall 4). No pre-broadcast nonce poll.
- The pinned state survives unchanged from preview to send — the device signs the EXACT bytes the user approved against the LEDGER BLIND-SIGN HASH block. Re-fetching at send would change the bytes → defeat the entire verification ritual.

### Q4: `previewToken` UUID minting + schema-level gate (PREP-04, PREP-07)

Verified. See Pattern 3. **HIGH confidence.**

- `crypto.randomUUID()` is a builtin since Node 14.17; project min is 18.17 ✓ (verified via `nodejs.org/api/crypto.html`).
- Stored on the handle as a plain UUID string, not a hash. This is a one-time gate per handle, not a long-lived secret — the threat is "agent forgot to call preview_send first", not "attacker brute-forces a UUID". 122 bits of entropy is overkill for a 15-min-TTL one-time token.
- Schema enforcement: `userDecision: { enum: ["send"] }` in `inputSchema` is the load-bearing gate. MCP SDK runs `ajv` validation at the protocol boundary BEFORE the handler ([CITED: `@modelcontextprotocol/sdk` has `ajv` as a direct dep in `package-lock.json`]). Any `userDecision` value other than the literal string `"send"` rejects at the boundary with a JSON-schema validation error.
- Handle state machine: `prepared → previewed → sent`. `send_transaction` against `prepared` (preview never ran) returns `PREVIEW_REQUIRED`. Against `sent` (already broadcast) returns `WRONG_STATUS` / `ALREADY_SENT`. Both transitions are enforced inside `transitionToSent` (see Pattern 1).

### Q5: Handle store + 15-min TTL (PREP-10)

Verified. See Pattern 1 implementation sketch. **HIGH confidence.**

- In-memory `Map<string, HandleRecord>`. Lazy eviction on access — every read calls `lookup(handle)` which deletes-and-returns-`HANDLE_EXPIRED` for `now > createdAt + 15*60*1000`. No `setInterval` sweep (avoids unref-leak under vitest fake-timers; correctness identical).
- HandleRecord shape (see Pattern 1 above): `{ handle, args, tx, payloadFingerprint, status, createdAt, pinned?, sentAt?, txHash? }`. `args` is the verbatim agent-supplied strings; `tx` is viem-typed for server-internal use. The two-field split is the Pitfall 3 mitigation.
- Process lifetime: same singleton pattern as `session-manager`. Fresh process = fresh handles (matches Phase 3's no-disk-persistence rule). Pitfall 5 documents this clearly so the tool description sets correct user expectations.
- `_resetHandleStoreForTesting()` clears the Map for test isolation.

### Q6: `PREPARE RECEIPT` block format (PREP-02)

Verified. See Pattern 2. **HIGH confidence.**

- Plain text in `content[0].text`. Substituted via `template.replace("{TO}", args.to).replace("{VALUE_WEI}", args.valueWei)` from `PREPARE_RECEIPT_TEMPLATE` (exported from `src/signing/blocks.ts`).
- **Verbatim guarantee:** `to` and `valueWei` are the raw strings the agent passed in — NOT normalized. If the agent passed `"0xabc…"` lowercase, the receipt shows `"0xabc…"` lowercase. This is the defense against narrow agent-arg compromise where a malicious agent normalizes-then-displays one address but sends a different one. Asserted by byte-identical string comparison in Plan 04-02 tests.
- The block ships in EVERY `prepare_*` response — never elided, never reshaped. Phase 6+ `prepare_token_send` and `prepare_token_approve` will extend the template with additional rows (e.g. `tokenAddress: {...}`, `amount: {...}`), but the existing rows must remain byte-identical. The plan-checker should verify the template is the single source of truth.

### Q7: `LEDGER BLIND-SIGN HASH` block format (PREP-04)

Verified. See Pattern 2 (`LEDGER_BLIND_SIGN_HASH_TEMPLATE`). **HIGH confidence on shape; MEDIUM on display drift — A1.**

- Plain text in `content[0].text` of `preview_send`. The 0x-prefixed 32-byte hex appears on its own line for character-for-character matching against the device.
- The block emits the full hex (66 chars). Per A1, Phase 4 verify-phase confirms whether to additionally emit a 4-char-chunked form for devices that display chunks. Defensive emission costs zero.
- The block lives between `PREPARE RECEIPT` and `AGENT TASK` in the response — order matters for readability. Tests assert relative ordering.

### Q8: `[AGENT TASK — RUN THESE CHECKS NOW]` block (PREP-05)

Verified. See Pattern 2 (`AGENT_TASK_TEMPLATE`). **HIGH confidence.**

- The block IS the routing prompt — even though the MCP cannot enforce that the agent runs the checks, the BLOCK's appearance in the response is what the agent's training is biased to follow (per ADR-0003: "the block is part of the structured response contract the agent expects").
- Prose pinned to four concrete steps: (1) re-decode via `viem.parseTransaction`, (2) assert `decoded.to` + `decoded.value` match prepare-time values, (3) recompute keccak256 over re-serialized bytes and compare to LEDGER BLIND-SIGN HASH, (4) emit a `CHECKS PERFORMED` block before the confirm prompt.
- `viem.parseTransaction(serialized)` returns a typed envelope (`viem/_types/utils/transaction/parseTransaction.d.ts:17`); the agent's reconstruction path verifies the byte-level shape.
- The `CHECKS PERFORMED` block shape is documented in the template so the agent has a clear emit pattern. Absent `CHECKS PERFORMED` in the agent's user-facing response is itself a tamper signal (a future v1.3 SEC-37 `verify_tx_decode` will surface the absence; for v1.0 it's user-visible only).
- Companion preflight skill (v1.3, per ADR-0003) closes the enforcement gap deterministically.

### Q9: 4byte.directory client (PREP-06)

Verified. See Code Example 5. **HIGH confidence on the client shape; MEDIUM on API stability (no SLA on 4byte).**

- Endpoint: `https://www.4byte.directory/api/v1/signatures/?hex_signature=0xXXXXXXXX`. Returns JSON `{ count, next, previous, results: [{ id, created_at, text_signature, hex_signature, bytes_signature }] }`. [CITED: `https://www.4byte.directory/docs/`]
- Best-effort discipline:
  - `not-applicable` when `data === "0x"` (no selector to look up) — Phase 4 native sends hit this case.
  - `not-found` when 200 OK + empty results.
  - `error` for HTTP 5xx, timeouts, JSON parse failures, network unreachable. Message ships verbatim.
  - `found` returns the first entry's `text_signature` (e.g. `"transfer(address,uint256)"`). Multiple-collision disambiguation deferred to v1.3 dispatch allowlist (SEC-35).
- Network discipline: 1.5s `AbortController` timeout so a slow 4byte never blocks `preview_send`. Errors logged to stderr per the project convention (the `log("warn", ...)` helper from `src/diagnostics/logger.ts` already writes to stderr).
- Caching: process-local Map with 256-entry LRU. Caches errors too (short window prevents hammering a down API). Process lifetime; dies with the process.

### Q10: WC `eth_sendTransaction` forwarding (PREP-09)

Verified. See Code Example 4. **HIGH confidence.**

- Param shape `[{ from, to, value, gas, maxFeePerGas, maxPriorityFeePerGas, nonce, data }]` — hex-encoded values per the JSON-RPC convention. Ledger Live's wallet-connect-live-app accepts this shape per the EIP-155 methods list (confirmed in Phase 3 research § Summary).
- `chainId` parameter passed to `signClient.request` is the **CAIP-2 string** `"eip155:1"`, NOT a number ([VERIFIED: `engine.d.ts:112-120` — `RequestParams.chainId: string`; WC spec requires CAIP-2 format]). Phase 4 builds this from the handle's numeric `chainId` via `\`eip155:${chainId}\``.
- Session topic source: Phase 3's `session-manager.ts` already cached this internally via `cachedSessionTopic` (`src/wallet/session-manager.ts:108`). Plan 04-04 **MUST add one export** to `session-manager.ts`: `export function getActiveSessionTopic(): string | null` that returns the topic of the live session (re-uses the same `findLiveSession(client)` helper at line 233). No behavior change; just surfacing internal state for Phase 4's signing path. This is the seam Phase 3's research § Open Question 3 left open ("Wire `session_delete` in Phase 3, expose topic in Phase 4").
- **Return shape — broadcasted txHash, not signed bytes.** Ledger Live both signs AND broadcasts internally — its `eth_sendTransaction` response IS the broadcasted `txHash` (verified via [ledger.com `useSignAndBroadcastTransaction` hook docs] + WalletConnect Kotlin issue #1429 + the wallet-connect-live-app's typed response `[ETH_SEND_TRANSACTION]: string`). Phase 4 does NOT call `viem.sendRawTransaction` — that would be a redundant broadcast against a different RPC, racing the Ledger Live broadcast and risking nonce conflicts. The MCP returns the hash Ledger Live gives us as the canonical `txHash`.

### Q11: `get_tx_verification` re-emit (PREP-10)

Verified. **HIGH confidence.**

- Read-only tool. Calls `lookup(handle)`. On `HANDLE_NOT_FOUND` or `HANDLE_EXPIRED`, returns structured error. On found:
  - `status === "prepared"`: re-emit `PREPARE RECEIPT` block only.
  - `status === "previewed"`: re-emit `PREPARE RECEIPT` + `LEDGER BLIND-SIGN HASH` + `AGENT TASK` + 4byte cross-check block. The pinned state is intact; the same blocks the original `preview_send` emitted.
  - `status === "sent"`: re-emit all of the above PLUS the success block (`txHash`, `broadcastedAt`). The user can recover the verification artifact even after the broadcast.
- 15-min TTL from `createdAt` (prepare time), NOT from the most recent transition. This matches PREP-10's "15 minutes after the original prepare". A `previewed` handle that survives past TTL becomes `HANDLE_EXPIRED` — user re-runs `prepare_native_send`.
- All blocks substituted from the SAME templates `preview_send` and `prepare_native_send` use — no duplicate template strings. The format-fanout-sentinel rule applies across tools.

### Q12: Cross-plan integration testing

**Recommended.** A `test/trust-pipeline.integration.test.ts` lives in **Plan 04-04** (the last code-producing plan that introduces tooling for `send_transaction`). The test:
- Mocks `signClient.request` (via the existing Phase 3 `test/helpers/mock-sign-client.ts` extended with a `_setRequestResponse(hash)` driver method).
- Mocks the viem public client (a new `test/helpers/mock-public-client.ts` factory exposes `_setNonce(n)`, `_setFees({ maxFee, maxPriority })`, `_setGasEstimate(g)`).
- Walks the full flow: call `prepare_native_send` → call `preview_send` → call `send_transaction` with `{ handle, previewToken, userDecision: "send" }`.
- Asserts: `payloadFingerprint` is byte-identical at all three transitions; the `LEDGER BLIND-SIGN HASH` matches the locally-recomputed hash; the WC `signClient.request` was called with the EXACT pinned params (no re-fetch at send time); the final response carries the mock `txHash`.
- Anchor fixture (from Code Example 1+2): `{ chainId: 1, to: 0x7099…79C8, valueWei: "1000000000000000000", nonce: 7, gas: 21000, maxFeePerGas: 30000000000, maxPriorityFeePerGas: 1500000000 }` → fingerprint `0x7e1867b2…` + presign hash `0xb28e4824…` + mock `txHash: 0x000000…01`.

### Q13: Plan dependency graph

**Confirmed and revised.** Naive strict-sequential 01 → 02 → 03 → 04 → 05 is over-conservative.

```
       04-01 (handle-store + fingerprint + blocks)
       ╱   ╲
      ╱     ╲
   04-02   04-05  ← can run in parallel worktrees;
   (prep)  (4byte +    different files; both depend
            re-emit)   only on 04-01
      ╲     ╱
       ╲   ╱
       04-03 (preview_send)  ← consumes 04-01 + 04-02 (its blocks + fingerprint + tx shape)
         │
         ▼
       04-04 (send_transaction + integration test) ← consumes all of the above
```

- **04-01 is pure infrastructure** — no MCP tool registration, no `register-all.ts` edit. Ships standalone first.
- **04-02 and 04-05** both edit `src/tools/register-all.ts` (each adds one import line). Phase 2 retro line 75 confirms this auto-merges trivially because different lines. Worktree-per-plan isolation prevents working-tree races (per Phase 2 retro line 74).
- **04-03** depends on both 04-01 (handle store transitions) AND 04-02 (`prepare_native_send` must exist for `preview_send` to operate on a handle). Strict sequence after 04-01 + 04-02 both land.
- **04-04** depends on 04-01 + 04-02 + 04-03 + adds the integration test. Strict sequence at the end.
- **PR queue:** 04-01 → (04-02 + 04-05 in parallel) → 04-03 → 04-04. Three sequential PR-merge rounds total (vs four for strict sequential). The 04-03 round can begin immediately after 04-02 merges; 04-05 merge can happen any time between 04-01 and 04-04.
- Per Phase 2 retro line 74 — worktree-per-plan is mandatory for parallel plans. 04-02 + 04-05 must use `cd $(git rev-parse --show-toplevel) && git fetch origin main && git worktree add .claude/worktrees/feat-04-02-prepare-native-send -b feat/04-02-prepare-native-send origin/main` (and similar for 04-05).

### Q14: What v1.1 should not be foreshadowed in Phase 4

- The handle store is generic over `data` (already designed this way — see Pattern 1 `tx.data: Hex`). Native send sets `data === "0x"`; ERC-20 transfer sets `data === "0xa9059cbb…"`. Same store, same record shape.
- The `payloadFingerprint` formula in PREP-03 already includes `data` — reusable verbatim.
- The fingerprint domain tag `"VaultPilot-txverify-v1:"` is intentionally generic across tx types. NO foreshadowing of `prepare_token_send` etc. in the tag.
- `PREPARE_RECEIPT_TEMPLATE` has just the two rows native send needs (`to`, `valueWei`). Phase 6 will extend the template with conditional rows (e.g. via a second `PREPARE_RECEIPT_TOKEN_SEND_TEMPLATE` or by adding optional `{TOKEN_ADDRESS}` placeholders). Phase 4 does NOT pre-bake extension hooks — YAGNI.
- The handle's `tx` field stays viem-typed (`data: Hex`); Phase 6's `prepare_token_send` constructs the calldata via `encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] })` and stores the result on the same `tx.data` field. No structural change needed.
- Phase 4 does NOT touch `src/config/contracts.ts` — native send doesn't need any contract addresses. Phase 6+ adds the canonical WETH / Aave entries; the SOT rule applies from Phase 6 onward.

### Q15: Failure-mode catalog (errorCodes Phase 4 plans must catch)

The locked set (Phase 4 plan-checker should verify all are tested):

| ErrorCode | Triggering condition | Plan | Notes |
|-----------|---------------------|------|-------|
| `WALLET_NOT_PAIRED` | `getStatus()` returns null at prepare/preview/send | 04-02, 04-03, 04-04 | Same shape Phase 3 emits for refusal |
| `HANDLE_NOT_FOUND` | `lookup(handle).errorCode === "HANDLE_NOT_FOUND"` | 04-03, 04-04, 04-05 | Handle never existed (or evicted) |
| `HANDLE_EXPIRED` | `now > createdAt + 15*60*1000` | 04-03, 04-04, 04-05 | Lazy eviction; user re-runs prepare |
| `PREVIEW_REQUIRED` | `send_transaction` against `status === "prepared"` | 04-04 | Must run preview_send first |
| `PREVIEW_TOKEN_MISMATCH` | `args.previewToken !== record.pinned.previewToken` | 04-04 | Schema gate caught missing/wrong-type already; this is the value-mismatch case |
| `USER_CANCELLED` | `userDecision: "cancel"` | (schema-rejected) | Actually rejected at MCP boundary by `enum: ["send"]`. Schema validator error is returned, NOT a clean exit. **Implementation decision required:** treat schema rejection AS user cancellation, OR expand the enum to `["send", "cancel"]` with the handler routing `cancel` to a clean exit. **Recommend the latter:** `enum: ["send", "cancel"]`; handler returns `errorCode: "USER_CANCELLED"` (non-error structured exit, `isError: undefined`) on `"cancel"`. This is a normal flow exit, not an error. |
| `PAYLOAD_FINGERPRINT_DRIFT` | Re-computed fingerprint at send time !== record fingerprint | 04-04 | PREP-08 — should be unreachable absent state corruption; tested explicitly |
| `LEDGER_REJECTED` | `signClient.request` rejects with WC code 5000 / "User rejected" | 04-04 | Same isUserRejectedError predicate Phase 3 uses (`src/wallet/session-manager.ts:266-274`); refactor to a shared util in 04-04 |
| `BROADCAST_FAILED` | `signClient.request` rejects with any other error (nonce-too-low, underpriced, relay down) | 04-04 | Underlying error message attached for debugability |
| `INTERNAL_ERROR` | Catch-all (unexpected throw) | every plan | Defensive — NOT in the locked set; matches Phase 3's `INTERNAL_ERROR` pattern |

Plus the 4byte cross-check block carries `kind: "error" \| "not-found" \| "not-applicable" \| "found"` values — those are NOT errorCodes (the tool succeeds even if 4byte is unreachable; the error surfaces inside the cross-check block).

### Q16: Demo-mode interaction (DEMO-05)

**Confirmed.** Phase 4 lives BEFORE Phase 5 (demo), so the env-only `isDemoMode()` predicate from `src/config/env.ts:36` is the gate ([VERIFIED: existing file]). Same pattern Phase 3's `pair_ledger_live` uses (`src/tools/pair_ledger_live.ts:87`).

- `prepare_native_send` in demo mode: returns the simulation envelope (resolved with mock persona address) — does NOT call viem RPC, does NOT create a handle in the store. Documented refusal with hint to `set_demo_wallet`.
- `preview_send` in demo mode: refuses with the same shape — no handle could have been created in demo mode anyway, so this branch is mostly defensive.
- `send_transaction` in demo mode: per DEMO-05, runs the unsigned tx through `eth_call` (viem `call({ to, value, data })` against the live RPC) for revert detection, returns a structured `simulation envelope` with `simulated: true`. Nothing signed, nothing broadcast.
- The simulation envelope shape is shared between Phase 4's real-broadcast success path and Phase 5's demo simulation — `{ txHash | simulationResult, broadcastedAt | simulatedAt, simulated?: true }`. Phase 4 reserves the `simulated` flag in the response type so Phase 5 doesn't need to reshape it.
- **Recommendation for Phase 4 plans:** apply the same Plan 03-02 pattern — check `isDemoMode()` FIRST in each tool handler, BEFORE touching the handle store or any RPC. Demo mode is unconditional refusal for now (Phase 5 lifts the refusal for `send_transaction` to a simulation; other tools remain refused).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Legacy (pre-EIP-1559) `gasPrice` field | EIP-1559 `maxFeePerGas` + `maxPriorityFeePerGas` | London hardfork, 2021-08 | Phase 4 only emits EIP-1559 (`type: "eip1559"` in `serializeTransaction`); legacy not supported |
| Hand-rolled keccak via `js-sha3` | viem's re-exported keccak (uses `@noble/hashes`) | viem 1.x onward | Single-import surface; avoids dual-lib hashing inconsistencies |
| `ethers.js` `BigNumber` | Native bigint | ES2020+ widely adopted; viem chose bigint-native | All arithmetic uses native bigint; no boxed-number conversions |
| `eth_signTransaction` + dapp broadcasts | `eth_sendTransaction` (wallet signs + broadcasts) | WC v2 + Ledger Live convention | Phase 4 uses `eth_sendTransaction`; Ledger Live owns broadcast |
| `gasPrice` from latest block via `eth_gasPrice` | `eth_feeHistory` + estimation via `estimateFeesPerGas` | EIP-1559 GA | viem's `estimateFeesPerGas` is the canonical reader |

**Deprecated/outdated:**
- Pre-EIP-1559 legacy txs — do not implement `gasPrice`-only path in Phase 4 even as a fallback. Ethereum mainnet has accepted EIP-1559 for 4+ years; any RPC failure to return EIP-1559 fees is a signal to refuse, not to fall back.
- WC v1 — fully sunset (Phase 3 research § State of the Art); does not apply to Phase 4.
- Direct `eth_signTransaction` + dapp-side broadcast — works but unconventional; community + Ledger Live default is `eth_sendTransaction`. Stick with the convention.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^2.1.0` (already configured) |
| Config file | None — defaults; tests in `test/` |
| Quick run command | `npm test` (vitest run; ~3-5s for full suite) |
| Full suite command | `npm test` (same — suite is small enough that there's no fast/slow split yet) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PREP-01 | `prepare_native_send` returns documented tuple | unit (mocked viem client) | `npm test -- prepare-native-send` | ❌ Wave 0 |
| PREP-02 | `PREPARE RECEIPT` block ships verbatim args | unit (byte-identical string assert) | `npm test -- prepare-native-send` | ❌ Wave 0 |
| PREP-03 | `payloadFingerprint` matches the documented fixture | unit (fixture-anchored) | `npm test -- signing-fingerprint` | ❌ Wave 0 |
| PREP-04 (pin) | `preview_send` pins gas/nonce/fees on the handle | unit (mocked viem client) | `npm test -- preview-send` | ❌ Wave 0 |
| PREP-04 (hash) | `LEDGER BLIND-SIGN HASH` matches the documented fixture | unit (fixture-anchored) | `npm test -- preview-send` | ❌ Wave 0 |
| PREP-04 (token) | `previewToken` is a UUID; stored on the handle | unit (regex on UUID v4 shape) | `npm test -- preview-send` | ❌ Wave 0 |
| PREP-05 | `[AGENT TASK — RUN THESE CHECKS NOW]` block emitted verbatim | unit (template-import + substituted-string assert) | `npm test -- preview-send` | ❌ Wave 0 |
| PREP-06 (4byte found) | 4byte returns `text_signature` → block shows it | unit (mocked fetch) | `npm test -- fourbyte` + `npm test -- preview-send` | ❌ Wave 0 |
| PREP-06 (4byte error) | 4byte timeout / 5xx → block shows error verbatim | unit (AbortController + 5xx mock) | `npm test -- fourbyte` | ❌ Wave 0 |
| PREP-06 (not-applicable) | `data === "0x"` → block shows `"not-applicable"` | unit | `npm test -- preview-send` | ❌ Wave 0 |
| PREP-07 (schema gate) | `userDecision !== "send"` rejects at MCP boundary | unit (ajv enum violation) | `npm test -- send-transaction` | ❌ Wave 0 |
| PREP-07 (token mismatch) | wrong `previewToken` → `PREVIEW_TOKEN_MISMATCH` | unit | `npm test -- send-transaction` | ❌ Wave 0 |
| PREP-08 (drift refusal) | `payloadFingerprint` re-check fails → `PAYLOAD_FINGERPRINT_DRIFT` | unit (forcibly mutate record fingerprint) | `npm test -- send-transaction` | ❌ Wave 0 |
| PREP-09 (forward) | `signClient.request({ method: "eth_sendTransaction", ... })` called with pinned params | unit (mocked signClient) | `npm test -- send-transaction` | ❌ Wave 0 |
| PREP-09 (txHash echo) | Mock returns hash → tool returns same hash | unit | `npm test -- send-transaction` | ❌ Wave 0 |
| PREP-10 (re-emit) | `get_tx_verification` after preview emits same blocks | unit (template-import equality) | `npm test -- get-tx-verification` | ❌ Wave 0 |
| PREP-10 (expired) | `get_tx_verification` past 15min → `HANDLE_EXPIRED` | unit (fake timers) | `npm test -- get-tx-verification` | ❌ Wave 0 |
| Trust pipeline integration | full prepare→preview→send walk against mocks | integration | `npm test -- trust-pipeline.integration` | ❌ Plan 04-04 |
| End-to-end real Ledger | Real WC + real device + real RPC | manual (verify-phase) | Real-Ledger smoke flow | ❌ verify-phase task |

### Sampling Rate

- **Per task commit:** `npm test` (full suite — fast enough)
- **Per wave merge:** `npm test` + `npm run typecheck` + `npm run build`
- **Phase gate:** Full suite green + Phase 4 verify-phase manual flow (real Ledger via WC + a small live broadcast on mainnet to a return-able address) green

### Wave 0 Gaps

- [ ] `test/helpers/mock-public-client.ts` — Wave 0 test helper. Exposes `createMockPublicClient()` with `_setNonce(n)`, `_setFees({ maxFee, maxPriority })`, `_setGasEstimate(g)`, `_setCallResponse(hex)` (for DEMO-05 `eth_call` simulation). Used across `prepare-native-send`, `preview-send`, `send-transaction`, and integration tests.
- [ ] Extend `test/helpers/mock-sign-client.ts` (already exists from Phase 3) with `_setRequestResponse(method, hash)` and `_setRequestRejection(method, err)` driver methods so Plan 04-04 + integration tests can script the `signClient.request("eth_sendTransaction", ...)` response.
- [ ] `test/signing-fingerprint.test.ts` — anchors against the Code Example 1 fixture. Three cases: native send (data === "0x"), an ERC-20 transfer with 68-byte data (forward-looking — locks the Phase 6 reusability), and a wrong-input rejection (non-address `to` → viem `hexToBytes` throws).
- [ ] `test/signing-presign-hash.test.ts` — anchors against the Code Example 2 fixture. Includes a `viem.parseTransaction(serialized)` round-trip assertion to verify the agent-task contract is implementable.
- [ ] `test/signing-handle-store.test.ts` — state machine transitions, lazy TTL eviction, `_resetHandleStoreForTesting` isolation.
- [ ] `test/fourbyte.test.ts` — found / not-found / error / not-applicable / cache hit / timeout.

## Security Domain

### Applicable ASVS Categories (ASVS Level 2 per `.planning/config.json`)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | WC v2 ECDH session + Ledger device approval (we don't authenticate the user; the device does) |
| V3 Session Management | yes | Handle TTL (15min) + state machine; WC session already managed by Phase 3 |
| V4 Access Control | n/a | No multi-user surface (single-process, stdio per-instance) |
| V5 Input Validation | yes | JSON schema with `enum: ["send"]` on `userDecision` (PREP-07); address `pattern` regex; bigint string parsing on `valueWei` |
| V6 Cryptography | partial | viem's `keccak256` (noble under the hood) is the only cryptographic primitive we invoke directly; key material handled by the Ledger device, never crosses the MCP boundary |
| V9 Communications | yes | All viem RPC traffic over HTTPS (PublicNode or configured); WC traffic over WSS; 4byte over HTTPS |
| V10 Malicious Code | partial | We depend on viem + WC SDK supply chains; audit lockfile diff when bumping versions |
| V14 Configuration | yes | `WALLETCONNECT_PROJECT_ID` already validated by Phase 3; no new env vars in Phase 4 |

### Known Threat Patterns for Phase 4

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Compromised MCP swaps bytes between prepare and send | Tampering | `payloadFingerprint` re-check at send (PREP-08); device-recomputed keccak on the same envelope (PREP-04) |
| Compromised middle layer (WC relay / Ledger Live / USB) substitutes bytes | Tampering | Device's local keccak diverges from agent-relayed `LEDGER BLIND-SIGN HASH`; user catches the mismatch on-screen |
| Narrow agent compromise mutates `prepare_*` args | Tampering | `PREPARE RECEIPT` block surfaces verbatim args, bypassing the agent's natural-language retelling |
| Honest agent off-by-decimal (e.g. wei vs ether confusion) | Tampering (incidental) | Same `PREPARE RECEIPT` defense — the user sees the literal `valueWei` and can verify "is this really 1e18 wei?" |
| Stale handle survives across restarts | Repudiation | No-persistence by design; fresh process = no handles. Documented in tool descriptions (per Pitfall 5). |
| Concurrent `send_transaction` calls on the same handle | Repudiation / Tampering | State machine refuses send on already-`"sent"` handle (Pattern 1's `transitionToSent` returns `WRONG_STATUS`) |
| `previewToken` brute-force | Information disclosure | UUID v4 has 122 bits of entropy; 15-min TTL; one-time per handle. Effectively zero attack surface. |
| 4byte.directory injection | Tampering (low impact) | `text_signature` is shown verbatim in the cross-check block, NEVER parsed as code or used in dispatch decisions. v1.3 SEC-35 narrows further via dispatch allowlist. |
| WC `chainId` confusion | Spoofing | Phase 4 builds `eip155:${chainId}` from the SERVER's record, not from agent args — agent can't pass a chainId that mismatches the handle's |
| User confuses native send with token send | Tampering (incidental) | `PREPARE RECEIPT` + on-device decoded display (Ethereum app clear-signs native sends with the recipient address visible) catches this |

### Residual Risks for v1.0 (defer to v1.3 hardening)

- **Compromised MCP omits `[AGENT TASK]` block** — the agent has no static rule to fall back on for v1.0–v1.2. Mitigated partially: the block is part of the structured response contract, so the MCP can't drop it without changing the response shape. Fully closed in v1.3 by `vaultpilot-preflight` skill (per ADR-0003). [LOCKED RESIDUAL]
- **Coordinated agent compromise (args + decode lie)** — agent passes correct args to `prepare_native_send` but, in its `CHECKS PERFORMED` block to the user, lies about what it decoded. v1.3 `verify_tx_decode` (SEC-37) closes this with server-side cross-check. v1.0 residual: documented in SECURITY.md.
- **A1: Ledger device blind-sign hash display drift** — flagged for Phase 4 verify-phase. Defensive 4-char-chunked emission in the `LEDGER BLIND-SIGN HASH` block costs zero and closes this without v1.3 dependency.

## Project Constraints (from CLAUDE.md)

These directives apply directly to Phase 4 implementation:

- **`prepare_*` always returns a handle.** Phase 4 `prepare_native_send` returns `{ handle, ... }` per PREP-01. Verified.
- **`PREPARE RECEIPT` block in every `prepare_*` response — verbatim args, never elided.** Plan 04-01's `PREPARE_RECEIPT_TEMPLATE` + Plan 04-02's substitution. Tests assert byte-identity (no normalization).
- **`payloadFingerprint` computed at prepare time, re-checked at send time. Drift → structured refusal.** Plan 04-01 + Plan 04-04. PREP-08.
- **`previewToken` + `userDecision: "send"` required on every `send_transaction`. Schema-level gate; not a soft check.** Plan 04-04's `inputSchema` declares `enum: ["send"]` AND `required: [..., "previewToken", "userDecision"]`. PREP-07.
- **No private key material crosses any boundary in this codebase. Ever.** Confirmed for Phase 4: viem never touches keys (we use the public client, not a wallet client); WC `eth_sendTransaction` is a request to a remote signer (Ledger Live); the Ledger device is the only thing that holds the key.
- **`src/config/contracts.ts` is the single source of truth for canonical contract addresses.** Native send doesn't need any addresses; Phase 4 doesn't touch this file. Becomes load-bearing from Phase 6 onward.
- **Stderr for diagnostics, stdout for MCP protocol.** All Phase 4 logging goes through `src/diagnostics/logger.ts` (already enforced). 4byte client logs to stderr per the project convention.
- **Decimal-aware arithmetic.** Phase 4 native sends accept `valueWei` as a decimal string already in wei units — no decimal conversion needed at the agent boundary. Phase 6 `prepare_token_send` adds the decimal conversion; that's Phase 6's concern, not Phase 4's.
- **Tool descriptions are agent routing prompts.** All four Phase 4 tools need descriptions that route the agent — WHEN to use, WHEN NOT (e.g. `prepare_native_send` for NATIVE ETH only, NOT for ERC-20 sends).
- **Format-fanout-regex-sync** (global CLAUDE.md): Phase 3's `VERIFY_ON_DEVICE_TEMPLATE` is the precedent. Phase 4's `PREPARE_RECEIPT_TEMPLATE`, `LEDGER_BLIND_SIGN_HASH_TEMPLATE`, `AGENT_TASK_TEMPLATE` follow the same shape — exported `string` const, tests import and substitute the same way handlers do.

## Assumptions Log

> Claims tagged `[ASSUMED]` — flag for user confirmation before they become locked decisions.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Ledger device in blind-sign mode displays the full 32-byte keccak256 hex on-screen | Q2 / Q7 / Pitfall 6 | MEDIUM — if the device shows a chunked / truncated form, the user can't do a character-for-character match against the LEDGER BLIND-SIGN HASH block. **Mitigation:** defensively emit BOTH a full-hex form AND a 4-char-chunked form (32 hex chars become eight 4-char groups). Confirm at verify-phase. |
| A2 | `crypto.randomUUID()` produces RFC 4122 v4 UUIDs in Node 18.17+ | Q4 / Pattern 1 | LOW — verified at nodejs.org/api/crypto.html; v4 UUID with 122 bits of entropy is the canonical implementation since Node 14.17 |
| A3 | Ledger Live's `eth_sendTransaction` response is the broadcasted `txHash` (string), not signed bytes | Q10 / Code Example 4 | LOW — confirmed via ledger.com `useSignAndBroadcastTransaction` docs + WalletConnect Kotlin issue #1429 + the wallet-connect-live-app's typed response `[ETH_SEND_TRANSACTION]: string`. Verifiable end-to-end at Phase 4 verify-phase. |
| A4 | 4byte.directory's API is stable across Phase 4's lifetime (returns `{ count, results: [{ text_signature, hex_signature, ... }] }`) | Q9 / Code Example 5 | LOW — verified via concrete API call in the search results; PREP-06 already accepts "error" as a verbatim surface, so an API shape change just surfaces as an error block, not a tool failure |
| A5 | `viem.estimateFeesPerGas` returns viable EIP-1559 fees against PublicNode without an API key | Q3 / Code Example 3 | LOW — Phase 2 already exercises viem reads against PublicNode successfully; `estimateFeesPerGas` is a derivative of `eth_feeHistory` which PublicNode supports. Verify at Phase 4 verify-phase smoke. |
| A6 | viem's `estimateGas` for a native send (data === "0x", value > 0, to is EOA or contract) returns 21000 for an EOA recipient | Q3 / Pitfall 4 | LOW — Ethereum spec mandates 21000 gas for a basic native transfer to an EOA. To a contract with a `receive()`/`fallback()` function the value may differ; viem returns the runtime estimate. Tests assert behavior, not the specific value. |
| A7 | MCP SDK's `ajv`-backed `inputSchema` enforces `enum: ["send"]` at the protocol boundary BEFORE the handler runs | Q4 / Pattern 3 | LOW — `ajv` is a direct dep of `@modelcontextprotocol/sdk@1.29.0` per `package-lock.json`; standard `ajv` behavior on `enum` is hard refusal at validation. Verifiable by a test that calls with `userDecision: "yes"` and asserts the handler is never invoked. |

**Confirm at Phase 4 verify-phase:** A1 (load-bearing — drives `LEDGER_BLIND_SIGN_HASH_TEMPLATE` shape), A3 (load-bearing — drives the entire `send_transaction` response model), A5 (operational — drives whether we need a paid RPC).

## Open Questions

1. **Should `userDecision` accept `"cancel"` as a clean exit, or only `"send"`?**
   - What we know: PREP-07 requires `userDecision: "send"` as a schema-gated value. A `"cancel"` flow isn't in the spec.
   - What's unclear: Does the agent ever need a structured way to signal "the user said no after preview" beyond just not calling `send_transaction`?
   - Recommendation: Expand the enum to `["send", "cancel"]`. The handler routes `"cancel"` to a structured `userCancelled: true` non-error response (transition status to terminal `"cancelled"`; remove from store). This gives the agent a routable shape for the "user said no" path without forcing it to invent error semantics. **Lock this decision in 04-04 PLAN.md.**

2. **Where does `getActiveSessionTopic()` live — `session-manager.ts` or a new file?**
   - What we know: Phase 3 cached the topic internally (`src/wallet/session-manager.ts:108`) but never exposed it.
   - What's unclear: One-line export addition to `session-manager.ts`, or a new `src/wallet/session-topic.ts` accessor?
   - Recommendation: Add the export to `session-manager.ts` — the topic is part of the session state, not a separate concern. One added export per the file's existing convention. **Lock this in 04-04 PLAN.md.**

3. **Should `prepare_native_send` require a `chainId` argument, or hard-code chainId 1?**
   - What we know: v1.0 is Ethereum-mainnet-only. Phase 3's `REQUIRED_NAMESPACES.eip155.chains` is `["eip155:1"]`. Phase 8 (v1.2) fans out to other chains and adds a mandatory `chain` parameter (PREP-41).
   - What's unclear: Does Phase 4 add `chain: "ethereum"` as an optional with default, or hard-code?
   - Recommendation: Hard-code chainId 1 in `prepare_native_send` (no `chain` arg). Phase 8 (PREP-40) is when every `prepare_*` gains a mandatory `chain` parameter; adding it optionally in Phase 4 invites Phase 8 to revisit the contract. **Lock this in 04-02 PLAN.md.** Phase 8 will reshape the input schema across all `prepare_*` tools in one coordinated pass.

4. **Idempotent vs. strict re-preview semantics?**
   - What we know: PREP-04 says `preview_send` "pins" gas/nonce/fees. Doesn't specify whether calling `preview_send` twice on the same handle is allowed.
   - What's unclear: Strict (refuse `HANDLE_ALREADY_PREVIEWED`) vs. idempotent (re-pin fresh values, re-mint previewToken).
   - Recommendation: Idempotent — each `preview_send` call freshens the pin. Rationale: gas/nonce/fees go stale over time; if the user takes 10 minutes to read the LEDGER BLIND-SIGN HASH block, the agent can ask for a fresh preview without a re-prepare. Strict semantics would force the user to start over. **Lock this in 04-03 PLAN.md.** Caveat: re-previewing INVALIDATES the previous `previewToken` (since the pinned state changed). The `previewToken` is one-time-per-pin, not one-time-per-handle.

## Sources

### Primary (HIGH confidence)
- **Installed `viem@2.48.11` type defs** at `/tmp/viem-probe/node_modules/viem/_types/`:
  - `utils/hash/keccak256.d.ts:9`
  - `utils/transaction/serializeTransaction.d.ts:20`
  - `utils/transaction/parseTransaction.d.ts:17`
  - `utils/encoding/toBytes.d.ts:37,87,108`
  - `utils/encoding/toHex.d.ts:91`
  - `utils/data/concat.d.ts`
  - `actions/public/getTransactionCount.d.ts:48`
  - `actions/public/estimateFeesPerGas.d.ts:48`
  - `actions/public/estimateGas.d.ts:61`
  - `actions/wallet/sendRawTransaction.d.ts:38` (referenced; NOT used in Phase 4)
- **Installed `@walletconnect/types@2.23.9` (in /tmp/wc-probe/)**:
  - `dist/types/sign-client/engine.d.ts:112-120` — `RequestParams` shape
  - `dist/types/sign-client/engine.d.ts:319` — `abstract request<T>(...)` signature
- **Installed `@walletconnect/sign-client@2.23.9`**:
  - `dist/types/client.d.ts:31` — public `request: ISignClient["request"]` ✓
- **End-to-end computed fixture** at `/tmp/viem-probe/compute-fingerprint.mjs` (2026-05-12) — see Code Examples 1 + 2 for the exact preimage hex + expected fingerprint + expected pre-sign hash. Reproducible by `cd /tmp/viem-probe && node compute-fingerprint.mjs`.
- **EIP-1559 spec** — `keccak256(0x02 || rlp([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas_limit, destination, amount, data, access_list]))`, confirming the pre-sign hash math.
- **Project files**: `.planning/REQUIREMENTS.md` (PREP-01..10 + PREP-20..30 lookahead), `.planning/ROADMAP.md` (Phase 4 + Phase 6+ scope boundaries), `.planning/STATE.md` (Phase 3 retro lessons), `.planning/PROJECT.md` (trust boundary doctrine), `CLAUDE.md` (project conventions), `docs/adr/0001-0003` (vertical-slice MVP rationale, MCP SDK rationale, deferred skill rationale), `src/wallet/session-manager.ts`, `src/wallet/walletconnect-client.ts`, `src/wallet/caip.ts`, `src/chains/ethereum.ts`, `src/config/env.ts`, `src/tools/get_portfolio_summary.ts`, `src/tools/pair_ledger_live.ts`, `src/tools/get_ledger_status.ts`, `src/tools/index.ts`, `src/tools/register-all.ts`, `package.json`.

### Secondary (MEDIUM confidence)
- [WalletConnect Specs — Namespaces](https://specs.walletconnect.com/2.0/specs/clients/sign/namespaces) — CAIP-2 chainId format requirement
- [WalletConnect docs — Ethereum chain support](https://docs.walletconnect.network/wallet-sdk/chain-support/evm) — `eth_sendTransaction` param shape
- [Ledger Developer Portal — useSignAndBroadcastTransaction](https://developers.ledger.com/docs/ledger-live/discover/integration/wallet-api/react/hooks/useSignAndBroadcastTransaction) — confirms `eth_sendTransaction` returns the broadcasted hash, not signed bytes
- [WalletConnect Kotlin issue #1429](https://github.com/WalletConnect/WalletConnectKotlinV2/issues/1429) — community convention to use `eth_sendTransaction` over `eth_signTransaction`
- [4byte.directory docs](https://www.4byte.directory/docs/) — API endpoint + JSON shape
- [4byte.directory example call](https://www.4byte.directory/api/v1/signatures/?hex_signature=0x144f2f94) — concrete response shape with `text_signature`
- [EIP-1559 spec](https://eips.ethereum.org/EIPS/eip-1559) — signature hash formulation
- [Ledger Academy — Blind Signing Explained](https://www.ledger.com/academy/cryptos-greatest-weakness-blind-signing-explained) — device shows keccak hash; clear-signing fallback path
- [Ledger Support — Enable Blind Signing in the Ethereum app](https://support.ledger.com/article/4405481324433-zd) — confirms blind-sign mode is the default for unknown contracts (and for native sends per A1)
- [AWS Database Blog — Sign Ethereum EIP-1559 with KMS](https://aws.amazon.com/blogs/database/how-to-sign-ethereum-eip-1559-transactions-using-aws-kms/) — EIP-1559 pre-sign hash recipe (cross-reference for our formula)
- [Node.js Crypto docs — randomUUID](https://nodejs.org/api/crypto.html) — Stability 2 (Stable); available since Node 14.17

### Tertiary (LOW confidence — flagged in Assumptions Log)
- Ledger device on-screen hash display representation (A1) — verifiable only at Phase 4 verify-phase against a real device
- 4byte.directory long-term API stability (A4) — accepted as a verbatim error surface per PREP-06

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every viem call sketch verified against installed `_types/`
- Architecture: HIGH — Pattern 1 (handle store) is a standard state-machine pattern; Pattern 2 mirrors Phase 3's `VERIFY_ON_DEVICE_TEMPLATE` precedent; Pattern 3 is a documented MCP SDK feature (`ajv` enum)
- Fingerprint / pre-sign math: HIGH — test fixtures computed end-to-end against installed viem 2.48.11
- WC `signClient.request` surface: HIGH — verified against installed `@walletconnect/types@2.23.9`
- Ledger Live `eth_sendTransaction` semantics (returns broadcasted hash): MEDIUM-HIGH — cited from official Ledger docs + WC community convention; verifiable end-to-end at verify-phase
- Ledger device on-screen hash representation: MEDIUM — A1 in Assumptions Log; defensive emission strategy already specified
- 4byte.directory behavior: MEDIUM — concrete API call verified; long-term stability accepted as verbatim error surface

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (30 days — viem is stable with monthly point releases; WC SDK is stable; 4byte API hasn't changed shape since 2018)

## RESEARCH COMPLETE
