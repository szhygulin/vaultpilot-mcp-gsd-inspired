# Phase 16: LiFi-routed EVM↔Solana bridging + Solana diagnostics — Research

**Researched:** 2026-06-04
**Domain:** Cross-chain bridging (LiFi HTTP API) + Solana transaction decode + read-only device/PDA diagnostic
**Confidence:** HIGH (codebase reuse + clones) / MEDIUM-LOW on one external fact (LiFi legacy-tx option — see RND VERDICT)

---

## ★★★ RND VERDICT — READ FIRST ★★★

### 1. LiFi reuse vs new dep — **NO NEW DEP. Add a sibling generic-quote function; do NOT reuse `fetchBtcLifiQuote` verbatim.**

- `@lifi/sdk` is **NOT installed** and **MUST NOT be added** [VERIFIED: codebase — `package.json` has no `@lifi/*`]. The existing `src/clients/lifi.ts` header (Phase 26 BTC) already records the rejected-SDK rationale: `@lifi/sdk` v3.x pulls 13+ transitive deps (Solana, SUI, NEAR, bitcoin, bech32, bigmi/core) and assumes it controls wallet signing. Raw `fetch` against `https://li.quest/v1/quote` is the house pattern.
- `@solana/web3.js` **^1.98.4 IS installed** [VERIFIED: codebase — `package.json:76`] — covers `Transaction.from` / `VersionedTransaction.deserialize` for decode. **No Solana-specific package needed.**
- **Why not literally reuse `fetchBtcLifiQuote`:** that function hardcodes `fromChain=BTC` + `fromToken=bitcoin` and its `LifiBtcQuote` return type expects a **PSBT hex** in `transactionRequest.data`. The Solana/EVM path returns a **base64 Solana tx** (Solana side) or an **EVM calldata tx** (EVM side) — different shapes. **Add a new `fetchLifiQuote(...)` generic function in `src/clients/lifi.ts`** (same file, same NEVER-throws + `vi.stubGlobal("fetch")` seam, same `LIFI_API_BASE`/`LIFI_TIMEOUT_MS` constants) returning a new discriminated union that carries the raw `transactionRequest` + `action.toAddress` + `action.fromChainId`/`toChainId`. Reuse the constants and the strict `mapLifiResponse`-style field-extraction discipline (T-26-13 response-injection mitigation: extract ONLY the fields that cross the boundary).

**Supply-chain approval needed? → NO.** Both packages already vendored; zero new install. (No `## Package Legitimacy Audit` checkpoint required for this phase.)

### 2. Legacy vs v0 — **★ THE LOAD-BEARING RISK. LiFi returns v0 (VersionedTransaction) by default and does NOT document an `asLegacyTransaction` equivalent.**

[VERIFIED: web search — LiFi Solana docs + `@lifi/sdk-provider-solana`] LiFi's `/v1/quote` returns the Solana-side tx as a **base64-encoded `VersionedTransaction` (v0)**; the documented deserialize path is `VersionedTransaction.deserialize(Buffer.from(data,"base64"))`. [CITED: docs.li.fi/li.fi-api/solana]

The **FROZEN binding** (`src/signing/payload-fingerprint-solana.ts`) accepts **ONLY legacy `Transaction.serializeMessage()` bytes** [VERIFIED: codebase — file header + preimage doc]. A v0 message's bytes do NOT match the legacy preimage.

**Jupiter Phase 14 hit the identical collision and resolved it** [VERIFIED: codebase `src/clients/jupiter.ts:16-20,135-136,198-200` + `src/protocols/jupiter.ts`]:
- Pass `asLegacyTransaction:true` on BOTH `/quote` and `/swap` — Jupiter natively honors it and constrains the router to legacy-fittable routes.
- In the decoder (`deserializeJupiterSwapTx`), run an `isVersionedTransaction(raw)` byte-0 high-bit guard (`0x80` flag) BEFORE `Transaction.from`; if v0 is detected, **throw a typed refusal** (`JupiterV0TransactionError`) — never silently produce v0 message bytes.

**The gap for LiFi:** Jupiter has a native `asLegacyTransaction` query param; **LiFi does not document one** [MEDIUM-LOW: absence-of-evidence across docs + 2 web searches — NOT a verified negative; confirm at execute time via a single live `/v1/quote?fromChain=...&toChain=SOL` capture, which is OUT OF SCOPE for research per the NO-LIVE-HTTP constraint].

**RESOLUTION (mirror Jupiter's belt half that does NOT depend on a legacy param):**
- Build a `deserializeLifiSolanaTx(b64)` that **runs the v0-guard FIRST** (clone `isVersionedTransaction` + the `0x80` rationale verbatim from `src/protocols/jupiter.ts`).
- If LiFi returns v0 (the likely default) → **REFUSE with a typed `LifiV0TransactionError`** carrying a clear message ("LiFi returned a v0/VersionedTransaction; the FROZEN Solana binding accepts only legacy bytes"). This is `[ASSUMED]` to be the common path until a legacy param is confirmed.
- Add a `legacy`-forcing attempt to the quote request IF the execute-time live probe finds a LiFi param (candidate names to probe: `asLegacyTransaction`, `legacyTransaction`, an `order`/`options` field). **Do NOT ship a defense-in-name-only legacy claim** — if no param exists, the EVM→Solana **inbound** direction (where LiFi builds the Solana-side tx the user signs) may be **un-shippable under the FROZEN binding**, and the phase must scope to **Solana→EVM outbound only** (where LiFi builds an EVM tx, signed via the existing EVM path) OR escalate. **This is the one design decision 16-CONTEXT does not resolve — FLAGGED below.**

### 3. Inv #6b Solana decoder — **FEASIBLE, mirrors EVM `BridgeFacetDecodeResult`, but recipient extraction differs by direction.**

[VERIFIED: codebase `src/protocols/bridge-decoders/index.ts`] The EVM Inv #6b shape is `BridgeFacetDecodeResult = {kind:"ok"; bridge; finalRecipient} | {kind:"no-match"} | {kind:"error"}`; `preview_send` Layer 0.6 asserts `decoded === userSupplied` → `DECODED_RECIPIENT_DRIFT` refusal.

Two directions, two recipient sources:
- **Solana→EVM (outbound, LiFi builds an EVM calldata tx):** the final recipient is in the EVM bridge calldata — **reuse the EXISTING EVM Tier-1 facet decoders** (`bridge-decoders/index.ts`) if LiFi routes through Wormhole/Mayan/Across (already registered). The LiFi Diamond entry-point selector may need a new EVM decoder arm if LiFi wraps the call.
- **EVM→Solana (inbound, LiFi builds a Solana v0 tx — only if direction 2 is shippable):** the recipient is a destination account inside the Solana bridge instruction. A **NEW `decodeLifiSolanaRecipient(messageBytes)`** must extract the destination token-account/owner from the decoded instruction set. **Strong precedent for the assertion site, weak precedent for Solana instruction-account extraction** — no existing Solana-side bridge decoder. This is genuinely new work and its feasibility is gated by direction-2 shippability (item 2 above).
- **BTC precedent caveat:** `prepare_btc_lifi_swap` does the Inv #6b assertion as `quote.action.toAddress === params.toAddress` in the TOOL (T-26-10), NOT in a calldata decoder, because the BTC OP_RETURN is an opaque memo. **For Solana, `action.toAddress` from the LiFi response is the agent-relayed value, NOT a device-verifiable decode** — relying on it alone is defense-in-name-only. The load-bearing check must decode the recipient FROM the signed message bytes (the bytes the Ledger signs), then assert against `params.toAddress`.

### 4. Diagnostic clone — **CONFIRMED. Clone `get_tron_setup_status.ts` 1:1; all Solana seams exist.**

[VERIFIED: codebase] Every probe seam is present:
- `deriveMarginfiAccountPda` → `src/chains/solana/marginfi.ts` (`_marginfiChain` indirection for spy) → `marginfiAccountPresent`
- `deriveKaminoObligationPda` → `src/chains/solana/kamino.ts` (`_kaminoChain` indirection) → `kaminoObligationPresent`
- `NonceAccount.fromAccountData` (web3.js) over `getAccountInfo(noncePubkey)` → `nonceAccountPresent` (precedent: `prepare_solana_nonce_close.ts:33,292-294`)
- `fetchSolanaAddress(path)` → `src/wallet/ledger-solana-transport.ts:175-189` returns `{address, rawPubkey, appVersion}` → `walletPublicKeyOnDevice` + `ledgerSolAppVersion` from ONE transport open (`getAppConfiguration().version`)

### 5. Free fixture labels — **AC and AD** [VERIFIED: codebase].

`test/signing-fingerprint-solana.test.ts` used-set (grep-confirmed): D, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Z, E, F, G, H, I, AA, AB. **No AC+ exists.** Use **AC** for the LiFi Solana legacy-tx shape; reserve **AD** if a second tx shape (e.g. the outbound EVM-side, though that anchors in `test/signing-fingerprint.test.ts` not the Solana file) needs an anchor. (The EVM fingerprint file separately uses up to AB + CM/CR/SA/UN — irrelevant to the Solana file's label space.)

### 6. Proposed plan count — **3 plans.** (See Architecture Patterns → Proposed Plan Structure.)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

> NOTE: 16-CONTEXT.md is a **placeholder** (Status: "context-gathering pending"). Its `## Implementation Decisions` are anchor candidates, NOT locked decisions. Treat them as strong defaults; the items below marked DECISION are resolved by this research, items marked OPEN need user confirmation.

### Locked Decisions (anchor candidates — confirm at plan/discuss time)
- **LiFi SDK adoption** — resolved: NO SDK, raw fetch + installed `@solana/web3.js` (RND Verdict 1).
- **Inv #6b extension to Solana** — server-side `decodedFinalRecipient == userSuppliedToAddress` mechanical assertion at preview time, refusal on mismatch. Mirrors v2.6 BRIDGE-T1 EVM facet decoders applied to the LiFi Solana-side decoder.
- **Direction support** — works both directions (EVM→Solana AND Solana→EVM); implementation splits at the source-chain check. **CAVEAT: EVM→Solana inbound shippability is gated by the legacy-tx question (RND Verdict 2) — FLAGGED.**
- **Allowlist extension** — LiFi program/contract IDs added to canonical-dispatch. EVM-side LiFi Diamond `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` already present from v1.3 [VERIFIED: `src/security/canonical-dispatch.ts:43`]; **Solana arm is new** (LiFi Solana program ID — see Standard Stack).
- **`get_solana_setup_status` probe surface** — `{ nonceAccountPresent, marginfiAccountPresent, kaminoObligationPresent, ledgerSolAppVersion?, walletPublicKeyOnDevice }`.
- **SECURITY.md close-out** — Solana threat-model final pass: cross-chain residual risk (relayer trust, LiFi value-in-flight, Solana-side decoder coverage gaps).

### Claude's Discretion
- Single tool with widened `toChain` enum (`+"solana"`) vs distinct `prepare_lifi_evm_to_solana` + `prepare_lifi_solana_to_evm` pair. **Research recommendation: single tool `prepare_solana_lifi_swap({ fromChain, fromToken, toChain, toToken, amount, toAddress })`** per the REQUIREMENTS.md SOL-W-21 signature, with an internal direction split. Rationale: REQUIREMENTS.md fixes the signature; uniform shape mirrors `prepare_tron_lifi_swap` + `prepare_btc_lifi_swap`.

### Deferred Ideas (OUT OF SCOPE)
- Bridges other than LiFi (Wormhole/Mayan/Allbridge/Portal direct) — v2.6 BRIDGE-T1/T2.
- BTC↔Solana bridging — v2.2 (already partly present via `prepare_btc_lifi_swap`, BTC→Solana).
- TRON↔Solana — v2.1.
- Cross-chain swap MEV defenses beyond Inv #6b — v2.6.
- Real-time Solana validator-set / slashing probe — v3.4.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SOL-W-21 | `prepare_solana_lifi_swap({fromChain,fromToken,toChain,toToken,amount,toAddress})` → unsigned LiFi-routed bridge tx; both directions; `decodedFinalRecipient == userSuppliedToAddress` at preview time (Inv #6b) | RND Verdict 1-3. New `fetchLifiQuote` in `src/clients/lifi.ts`; new `deserializeLifiSolanaTx` v0-guard (mirror `src/protocols/jupiter.ts`); new `decodeLifiSolanaRecipient`; reuse EVM `bridge-decoders/index.ts` for outbound; FROZEN binding via `serializeMessage()` unchanged |
| SOL-DIAG-01 | `get_solana_setup_status({wallet})` → `{nonceAccountPresent, marginfiAccountPresent, kaminoObligationPresent, ledgerSolAppVersion?, walletPublicKeyOnDevice}` — per-wallet PDA + on-device probe | RND Verdict 4. Clone `get_tron_setup_status.ts`; seams: `deriveMarginfiAccountPda`, `deriveKaminoObligationPda`, `NonceAccount.fromAccountData`, `fetchSolanaAddress` |
</phase_requirements>

## Summary

Phase 16 closes v2.0 Solana with two requirements that sit at opposite ends of the risk spectrum. **SOL-DIAG-01** is a near-mechanical clone of the proven `get_tron_setup_status` lazy-3-arm `Promise.allSettled` diagnostic — all four Solana probe seams (marginfi/kamino PDA derivers, durable-nonce `NonceAccount.fromAccountData`, and the `fetchSolanaAddress` USB-HID device probe) already exist and demote-to-null on failure. Low risk, high confidence.

**SOL-W-21** is the load-bearing work. LiFi reuse is clean (raw-fetch sibling in `src/clients/lifi.ts`, no new dependency — `@lifi/sdk` was already rejected for the BTC path, and `@solana/web3.js` is installed). The Inv #6b `decodedFinalRecipient` assertion has a strong site precedent (`bridge-decoders/index.ts` + `preview_send` Layer 0.6 → `DECODED_RECIPIENT_DRIFT`). The single real risk is the **legacy-vs-v0 transaction collision**: LiFi returns Solana txs as v0 `VersionedTransaction`, but the FROZEN binding accepts only legacy `serializeMessage()` bytes. Jupiter Phase 14 solved the identical problem with a native `asLegacyTransaction` param + a v0-guard refusal — but **LiFi does not document an equivalent param**, which may make the EVM→Solana *inbound* direction un-shippable under the FROZEN binding.

**Primary recommendation:** Ship the diagnostic (Plan 16-01) and the Solana→EVM *outbound* LiFi direction + Inv #6b decode (Plan 16-02) with full confidence; gate the EVM→Solana *inbound* direction (Plan 16-03) behind an execute-time live `/v1/quote` capture that confirms whether LiFi can return a legacy Solana tx — and if it cannot, refuse inbound with a typed error (defense-in-name-only is explicitly forbidden by 16-CONTEXT specifics).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| LiFi route/quote fetch | API/Backend (`src/clients/lifi.ts`) | — | HTTP client; NEVER-throws; outer-fetch test seam |
| Solana tx deserialize + v0-guard | API/Backend (`src/protocols/`) | — | Pure decode; mirrors `src/protocols/jupiter.ts` |
| Inv #6b recipient decode + assert | API/Backend (`src/protocols/bridge-decoders/` + `preview_send`) | Device (the Ledger screen is the final trust anchor) | Server-side mechanical assert; device shows the bytes |
| payloadFingerprint compute | API/Backend (`src/signing/` FROZEN) | — | Binding layer; unchanged, legacy bytes only |
| Canonical-dispatch allowlist | API/Backend (`src/security/canonical-dispatch.ts`) | — | Layer 0.5 refusal gate; Solana arm new |
| PDA presence + device probe (diagnostic) | API/Backend (`src/tools/`) + Device | — | Read-only; lazy; no boot RPC |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@solana/web3.js` | ^1.98.4 (installed) [VERIFIED: package.json:76] | `Transaction.from` / `VersionedTransaction.deserialize` / `NonceAccount.fromAccountData` / `PublicKey` | Already the project's Solana primitive everywhere |
| raw `fetch` | Node ≥18 builtin | LiFi `/v1/quote` HTTP | House pattern (fourbyte/etherscan/lifi-btc) |
| `viem` | installed | `keccak256`/`concat`/`toBytes` in FROZEN binding | Binding layer reuse only |

### Supporting (all existing — REUSE, do not re-create)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/clients/lifi.ts` | Add `fetchLifiQuote` sibling | SOL-W-21 quote fetch |
| `src/protocols/jupiter.ts` | Pattern source for v0-guard + `serializeMessage()` preimage | Clone into `lifi-solana` decoder |
| `src/protocols/bridge-decoders/index.ts` | EVM Inv #6b registry | Outbound (Solana→EVM) recipient decode |
| `src/signing/payload-fingerprint-solana.ts` | FROZEN binding | Fingerprint over legacy message bytes — UNCHANGED |
| `src/tools/get_tron_setup_status.ts` | Diagnostic clone template | SOL-DIAG-01 1:1 |
| `src/chains/solana/{marginfi,kamino}.ts`, `ledger-solana-transport.ts`, `sol-rpc-client.ts` | Probe seams | Diagnostic probes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| raw fetch | `@lifi/sdk` | REJECTED — 13+ transitive deps, assumes wallet-signing control (BTC precedent) |
| new `fetchLifiQuote` | reuse `fetchBtcLifiQuote` | REJECTED — BTC fn hardcodes `fromChain=BTC`/PSBT shape |
| force-legacy + refuse-on-v0 | accept v0 + new v0 binding | REJECTED — FROZEN binding is uneditable this phase |

**Installation:** None. Zero new packages.

**LiFi constants (reuse):** `LIFI_API_BASE="https://li.quest"`, `LIFI_TIMEOUT_MS=10_000`, `integrator=vaultpilot-mcp` [VERIFIED: `src/clients/lifi.ts:40-41,181`].
**LiFi Solana chain id:** `1151111081099710` [VERIFIED: web search — matches docs + SDK]. EVM-side LiFi Diamond `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` already allowlisted [VERIFIED: canonical-dispatch.ts:43].
**LiFi Solana program ID (canonical-dispatch Solana arm):** `[ASSUMED — must verify at execute time via live `/v1/chains` or a captured quote]` — the Solana-side program the LiFi-built tx dispatches to. Do NOT hardcode an unverified program ID into the allowlist.

## Package Legitimacy Audit

**Not applicable — this phase installs ZERO external packages.** Both `@solana/web3.js` (^1.98.4) and the native `fetch` are already vendored/builtin. No slopcheck gate required.

## Architecture Patterns

### System Architecture Diagram

```
agent ──prepare_solana_lifi_swap({fromChain,fromToken,toChain,toToken,amount,toAddress})──▶ tool handler
                                                                                              │
                                              1. demo-mode check FIRST (refuse before net)    │
                                              2. input validation (INVALID_INPUT)             │
                                              3. resolve paired wallet (listAccounts/SOL)     │
                                                                                              ▼
                                                              fetchLifiQuote(li.quest/v1/quote)  ── NEVER throws
                                                                                              │
                                              ┌──────────── direction split (source chain) ───┤
                                              ▼                                               ▼
                              Solana→EVM (outbound)                            EVM→Solana (inbound) [gated]
                              tx = EVM calldata                                tx = base64 Solana v0
                                    │                                               │
                                    ▼                                               ▼
                          EVM bridge-decoders/index.ts          deserializeLifiSolanaTx(b64)
                          → finalRecipient (calldata)           → v0-guard (0x80) → REFUSE if v0
                                    │                           → legacy serializeMessage() bytes
                                    │                           → decodeLifiSolanaRecipient(msg)
                                    └───────────────┬───────────────────┘
                                                    ▼
                              Inv #6b: assert decodedFinalRecipient === params.toAddress
                                                    │ mismatch → DECODED_RECIPIENT_DRIFT refusal
                                                    ▼
                              canonical-dispatch allowlist (Layer 0.5, LiFi Solana/EVM arm)
                                                    ▼
                              computeSolanaPayloadFingerprint(legacyMessageBytes)  [FROZEN — unchanged]
                                                    ▼
                              createHandle(...) → { handle, serialized tx, prepareReceipt }
                                                    ▼
              preview_send → send_transaction (previewToken + userDecision) → Ledger screen (trust anchor)
```

### Proposed Plan Structure (3 plans)

- **Plan 16-01 — SOL-DIAG-01 `get_solana_setup_status` (low risk, do first / parallel).** Clone `get_tron_setup_status.ts`. 3-arm `Promise.allSettled`: (a) RPC `getAccountInfo` for nonce + marginfi PDA + kamino obligation PDA presence (one or split races), (b) USB-HID `fetchSolanaAddress` for `walletPublicKeyOnDevice` + `ledgerSolAppVersion`, demote-to-null. Read-only: NO `createHandle` import (module-load grep guard, mirror Phase 7 `T-SIMULATE-NO-HANDLE-1` / the existing read-only tool guards). No new error codes (reuse `INVALID_INPUT` for no-pairing). NO boot RPC. Fixtures: none (read-only).
- **Plan 16-02 — SOL-W-21 LiFi client + Solana→EVM outbound + Inv #6b.** Add `fetchLifiQuote` to `src/clients/lifi.ts`; add `prepare_solana_lifi_swap` tool with direction split; outbound path reuses EVM `bridge-decoders/index.ts` for recipient + the EVM signing/fingerprint path; canonical-dispatch Solana+EVM LiFi arm. Fixture **AC** anchors any new Solana-side tx-shape fingerprint that appears in the outbound flow (likely none on outbound — outbound EVM-side anchors in the EVM fingerprint file).
- **Plan 16-03 — SOL-W-21 EVM→Solana inbound (v0-guard) + SECURITY.md close-out.** `deserializeLifiSolanaTx` (clone `src/protocols/jupiter.ts` v0-guard + `serializeMessage()` preimage); `decodeLifiSolanaRecipient` (NEW — Solana instruction-account extraction); Inv #6b assert; FROZEN binding over legacy bytes; **typed `LifiV0TransactionError` refusal if LiFi cannot return legacy** (or descope inbound — decide at execute time per live probe). Fixture **AC** (legacy LiFi Solana tx) + cross-link from `prepare_solana_lifi_swap` test. SECURITY.md v2.0 close-out section.

*(Plan 16-01 and 16-02 are independent and may be planned/executed in parallel; 16-03 depends on 16-02's client + tool scaffold.)*

### Pattern 1: NEVER-throws LiFi client sibling
**What:** `fetchLifiQuote(params): Promise<LifiQuoteResult>` discriminated union (`ok|not-found|rate-limited|error`), `vi.stubGlobal("fetch")` seam, strict field extraction.
**When:** SOL-W-21 quote fetch.
```ts
// Source: mirror src/clients/lifi.ts:166-243 (fetchBtcLifiQuote)
// Extract ONLY: action.toAddress, action.{fromChainId,toChainId}, transactionRequest.{to,data,value}
// All other LiFi body fields DISCARDED (T-26-13 response-injection mitigation).
```

### Pattern 2: v0-guard + legacy preimage (the FROZEN-compat crux)
**What:** Detect v0 via byte-0 `0x80` flag BEFORE `Transaction.from`; refuse if versioned; else take `serializeMessage()` only.
**When:** SOL-W-21 inbound (EVM→Solana) decode.
```ts
// Source: src/protocols/jupiter.ts deserializeJupiterSwapTx + isVersionedTransaction
const VERSIONED_MESSAGE_FLAG = 0x80;
// if (isVersionedTransaction(raw)) throw new LifiV0TransactionError(...)
const tx = Transaction.from(raw);                       // legacy ONLY
const messageBytes = new Uint8Array(tx.serializeMessage()); // FROZEN preimage — NEVER tx.serialize()
```

### Pattern 3: lazy 3-arm demote-to-null diagnostic
**What:** `Promise.allSettled` parallel probes, per-arm timeout race, envelope-field degradation (`rpcDegraded`/`deviceStatus`), `addressVerified` strict-eq with safe-false default.
**When:** SOL-DIAG-01.
```ts
// Source: src/tools/get_tron_setup_status.ts (whole file is the template)
const [rpcResult, deviceResult] = await Promise.allSettled([
  Promise.race([/* getAccountInfo nonce/marginfi/kamino PDA */, timeoutAfter(5000)]),
  Promise.race([_solanaLedgerTransport.fetchSolanaAddress(path), timeoutAfter(10000)]),
]);
```

### Anti-Patterns to Avoid
- **`tx.serialize()` instead of `tx.serializeMessage()`** — includes zero-filled signature region; fingerprint changes once signed. FROZEN-binding header explicitly forbids it.
- **`VersionedTransaction.deserialize()` for the binding path** — v0 message bytes don't match the legacy FROZEN preimage. Use only inside the v0-guard to confirm-and-refuse.
- **Trusting `action.toAddress` as the Inv #6b decode** — that's the agent-relayed value, not a decode of the signed bytes. Decode the recipient FROM the message the Ledger signs (16-CONTEXT specifics: "don't ship a defense-in-name-only check").
- **Boot-time RPC in the diagnostic** — all probes lazy at invocation only.
- **`createHandle` import in the diagnostic** — read-only by construction (module-load grep guard).
- **New error codes in the diagnostic** — TRON precedent froze its code union; reuse `INVALID_INPUT`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LiFi HTTP client | A second fetch wrapper | Extend `src/clients/lifi.ts` | NEVER-throws + test-seam already solved |
| Solana tx deserialize + v0 detect | Custom shortvec parser | Clone `src/protocols/jupiter.ts` `isVersionedTransaction` | Byte-0 flag logic is subtle; already verified |
| EVM bridge recipient decode (outbound) | New EVM decoder | `bridge-decoders/index.ts` registry | Wormhole/Mayan/Across/NEAR already registered |
| Diagnostic structure | New tool from scratch | Clone `get_tron_setup_status.ts` | `Promise.allSettled` + demote-to-null proven |
| payloadFingerprint | Any new hash | FROZEN `computeSolanaPayloadFingerprint` | Uneditable; legacy bytes only |
| LiFi SDK | `@lifi/sdk` | raw fetch | 13+ transitive deps, wallet-signing assumption |

**Key insight:** Phase 16 is ~90% composition of existing, verified modules. The only genuinely-new code is `decodeLifiSolanaRecipient` (Solana instruction-account extraction) — and its necessity is gated by whether inbound is shippable at all.

## Runtime State Inventory

> Greenfield-additive phase (adds new tool + client function + decoder); no rename/migration. Inventory included for the canonical-dispatch allowlist mutation only.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — diagnostic is read-only; bridge tool stores tx in handle-store like every prepare_* | None |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | `VAULTPILOT_DEMO` read by prepare-tool demo-gate (existing) | None — reuse |
| Build artifacts | `register-all.ts` must `import "./get_solana_setup_status.js"` + `"./prepare_solana_lifi_swap.js"` | Add 2 import lines (mirror existing entries) |
| Allowlist SOT | `CANONICAL_DISPATCH_TARGETS` — EVM LiFi Diamond present; **Solana arm new** | Add LiFi Solana program ID (verified at execute time) to the Solana allowlist set |

## Common Pitfalls

### Pitfall 1: v0 VersionedTransaction silently breaks the fingerprint
**What goes wrong:** LiFi returns a v0 Solana tx; naive `VersionedTransaction.deserialize` → message bytes ≠ legacy preimage → fingerprint mismatch at send, OR (worse) a decoder that mis-parses and produces a *different* binding than what the device signs.
**Why:** FROZEN binding is legacy-only; LiFi defaults to v0; no documented legacy param.
**How to avoid:** v0-guard FIRST (byte-0 `0x80`), typed refusal, never fall through (clone Jupiter).
**Warning signs:** `Transaction.from` succeeds but `instructions` look wrong; message first byte ≥ 128.

### Pitfall 2: Inv #6b check that decodes the wrong source
**What goes wrong:** Asserting against `quote.action.toAddress` (agent-relayed) instead of decoding the recipient from the signed message → attacker who controls the agent passes a benign `toAddress` while LiFi's tx sends to attacker's account.
**Why:** `action.toAddress` is convenience metadata, not the signed bytes.
**How to avoid:** Decode `finalRecipient` from `messageBytes` (Solana) / calldata (EVM), THEN assert against `params.toAddress`. This is the entire point of Inv #6b.
**Warning signs:** the assertion compares two agent-supplied values.

### Pitfall 3: LiFi xpub / list / wrong fromToken form (carried from BTC RESEARCH)
**What goes wrong:** HTTP 400 code 1011 on malformed params; token-symbol vs token-address form mismatch.
**How to avoid:** Single address per direction; token-address form where required; mirror `fetchBtcLifiQuote`'s param discipline.

### Pitfall 4: Test mode-bleed
**What goes wrong:** A prepare-tool test passes in demo mode (returns canned envelope) and never exercises the real path.
**How to avoid:** FORCE `VAULTPILOT_DEMO=false` in prepare-tool tests (per phase test directive); mock `fetch` + `Connection` + web3.js deserialize.

## Code Examples

### LiFi quote request (no live call — shape only)
```ts
// Source: mirror src/clients/lifi.ts:173-181 generalized
const url = new URL(`${LIFI_API_BASE}/v1/quote`);
url.searchParams.set("fromChain", params.fromChain);   // e.g. "SOL" / "ARB" / 1151111081099710
url.searchParams.set("fromToken", params.fromToken);
url.searchParams.set("fromAddress", params.fromAddress);
url.searchParams.set("fromAmount", params.fromAmount);  // raw units as string
url.searchParams.set("toChain", params.toChain);        // e.g. "solana"/1151111081099710 or EVM
url.searchParams.set("toToken", params.toToken);
url.searchParams.set("toAddress", params.toAddress);
url.searchParams.set("integrator", "vaultpilot-mcp");
// + probe at execute time: a legacy-forcing param if one exists (asLegacyTransaction?)
```

### Diagnostic device + PDA probe (no live call — shape only)
```ts
// Source: get_tron_setup_status.ts + src/wallet/ledger-solana-transport.ts:175-189
//         + src/chains/solana/{marginfi,kamino}.ts derivers + NonceAccount.fromAccountData
// fetchSolanaAddress(path) → { address, rawPubkey, appVersion }
//   walletPublicKeyOnDevice = address ; ledgerSolAppVersion = appVersion
// deriveMarginfiAccountPda(authority,0) → getAccountInfo → marginfiAccountPresent
// deriveKaminoObligationPda(market,owner) → getAccountInfo → kaminoObligationPresent
// getAccountInfo(noncePubkey) + NonceAccount.fromAccountData → nonceAccountPresent
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Solana legacy `Transaction` | v0 `VersionedTransaction` (ALTs) | Solana v1.10+ (2022) | LiFi/Jupiter default to v0; FROZEN binding forces legacy → must refuse v0 |
| `@lifi/sdk` integration | raw `/v1/quote` fetch | project policy (BTC Phase) | Zero new deps |

**Deprecated/outdated:** none relevant.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | LiFi does NOT expose an `asLegacyTransaction`-equivalent param | RND Verdict 2 | HIGH — if it DOES, inbound EVM→Solana ships cleanly (good); if confirmed absent, inbound may be un-shippable under FROZEN binding. **Confirm via execute-time live `/v1/quote` capture.** |
| A2 | LiFi `/v1/quote` returns Solana side as base64 v0 VersionedTransaction | RND Verdict 2 | MED — drives the v0-guard design; if it returns legacy, the guard simply passes |
| A3 | LiFi Solana program ID (for canonical-dispatch Solana arm) | Standard Stack | MED — must be verified before allowlisting; do not hardcode unverified |
| A4 | `action.toChainId`/`fromChainId` present in LiFi response for direction detection | Pattern 1 | LOW — direction also derivable from request params |
| A5 | Outbound (Solana→EVM) LiFi routes hit already-registered EVM Tier-1 decoders | RND Verdict 3 | MED — if LiFi wraps via its Diamond with a novel selector, a new EVM decoder arm is needed in 16-02 |

## Open Questions

1. **Does LiFi return a legacy Solana tx for inbound (EVM→Solana)?**
   - What we know: defaults to v0; no documented legacy param; Jupiter had a native one.
   - What's unclear: whether any LiFi param/route yields legacy.
   - Recommendation: execute-time single live `/v1/quote` capture (OUT OF SCOPE for research); if no legacy path → refuse inbound with `LifiV0TransactionError` (typed, honest) OR descope inbound to a deferred follow-up. Decide in Plan 16-03.

2. **Single tool vs pair?**
   - Recommendation: single `prepare_solana_lifi_swap` (REQUIREMENTS.md fixes the signature) with internal direction split.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@solana/web3.js` | decode/PDA/nonce | ✓ | ^1.98.4 | — |
| native `fetch` | LiFi client | ✓ | Node ≥18 | — |
| LiFi `/v1/quote` (li.quest) | runtime only — NOT research | n/a (no live call this phase) | — | NEVER-throws → `not-found`/`error` envelope |
| Solana RPC (diagnostic) | runtime only | n/a (lazy) | — | demote-to-null `rpcDegraded` |
| Ledger Solana app (USB-HID) | runtime only | n/a | — | demote-to-null `deviceStatus` |

**Missing dependencies with no fallback:** none. **With fallback:** all runtime deps degrade gracefully by design.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (installed) |
| Quick run command | `npx vitest run test/<file> -t "<name>"` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SOL-W-21 | LiFi quote NEVER-throws (ok/404/429/error) | unit | `npx vitest run test/lifi-solana-client.test.ts` | ❌ Wave 0 |
| SOL-W-21 | v0-guard REFUSES v0 tx; legacy passes | unit | `npx vitest run test/lifi-solana-deserialize.test.ts` | ❌ Wave 0 |
| SOL-W-21 | Inv #6b: decoded recipient mismatch → DRIFT refusal | unit/integration | `npx vitest run test/prepare-solana-lifi-swap.test.ts` | ❌ Wave 0 |
| SOL-W-21 | Fixture AC legacy LiFi Solana fingerprint (hardcoded literal) | unit | `npx vitest run test/signing-fingerprint-solana.test.ts -t "AC"` | ⚠️ append to existing file |
| SOL-DIAG-01 | 3-arm demote-to-null; no boot RPC; no createHandle | unit | `npx vitest run test/get-solana-setup-status.test.ts` | ❌ Wave 0 |

### Sampling Rate
- Per task commit: targeted `npx vitest run test/<new-file>`
- Per wave merge: `npx vitest run`
- Phase gate: full suite green + Fixture AC anchored as hardcoded `0x…` literal (CLAUDE.md cryptographic-fixture rule).

### Wave 0 Gaps
- [ ] `test/lifi-solana-client.test.ts` — `fetchLifiQuote` NEVER-throws arms (SOL-W-21), `vi.stubGlobal("fetch")`
- [ ] `test/lifi-solana-deserialize.test.ts` — v0-guard refusal + legacy `serializeMessage()` (SOL-W-21)
- [ ] `test/prepare-solana-lifi-swap.test.ts` — Inv #6b drift refusal, `VAULTPILOT_DEMO=false` forced (SOL-W-21)
- [ ] `test/get-solana-setup-status.test.ts` — demote-to-null arms, module-load no-createHandle grep guard (SOL-DIAG-01)
- [ ] Append **Fixture AC** (legacy LiFi Solana tx) hardcoded literal to `test/signing-fingerprint-solana.test.ts` + cross-link from prepare test (CLAUDE.md fixture convention)

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Strict LiFi-response field extraction (T-26-13); Zod/JSON-schema tool input |
| V6 Cryptography | yes | FROZEN keccak binding — never hand-roll; legacy `serializeMessage()` only |
| V4 Access Control | yes | canonical-dispatch allowlist (Layer 0.5) + Inv #6b recipient assert (Layer 0.6) |
| V2 Authentication | partial | device pubkey = on-device trust anchor (diagnostic `addressVerified`) |

### Known Threat Patterns for {LiFi cross-chain + Solana}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Redirected final recipient | Tampering | Inv #6b: decode recipient from SIGNED bytes, assert === user `to`, refuse `DECODED_RECIPIENT_DRIFT` |
| v0 message-byte mismatch | Tampering/Spoofing | v0-guard refusal; legacy-only binding |
| LiFi API response injection | Tampering | Extract ONLY needed fields (T-26-13) |
| Dispatch to non-canonical program | Tampering | canonical-dispatch Solana+EVM LiFi arm |
| Relayer / value-in-flight trust | Repudiation | SECURITY.md close-out documents residual risk (out-of-scope to eliminate) |
| Payload drift prepare→send | Tampering | FROZEN `payloadFingerprint` re-check |

## Sources

### Primary (HIGH confidence)
- Codebase: `src/clients/lifi.ts`, `src/protocols/jupiter.ts`, `src/clients/jupiter.ts`, `src/protocols/bridge-decoders/index.ts`, `src/tools/get_tron_setup_status.ts`, `src/wallet/ledger-solana-transport.ts`, `src/chains/solana/{marginfi,kamino}.ts`, `src/signing/payload-fingerprint-solana.ts`, `src/security/canonical-dispatch.ts`, `test/signing-fingerprint-solana.test.ts`, `package.json`
- `.planning/REQUIREMENTS.md` §SOL-W-21, §SOL-DIAG-01; `.planning/phases/16-.../16-CONTEXT.md`

### Secondary (MEDIUM confidence)
- [Solana | LI.FI Documentation](https://docs.li.fi/li.fi-api/solana) — base64 tx, VersionedTransaction deserialize
- [Solana Transaction Example - LI.FI](https://docs.li.fi/introduction/user-flows-and-examples/solana-tx-execution)
- [@lifi/sdk-provider-solana (npm)](https://www.npmjs.com/package/@lifi/sdk-provider-solana) — confirms v0 deserialize path

### Tertiary (LOW confidence — flagged for execute-time validation)
- Absence of a documented LiFi `asLegacyTransaction` param (A1) — verify via live `/v1/quote` capture at execute time.

## Metadata

**Confidence breakdown:**
- Standard stack / reuse: HIGH — all modules read in-tree.
- Diagnostic clone: HIGH — template + all seams verified.
- LiFi outbound + Inv #6b site: HIGH — registry + assertion precedent verified.
- LiFi inbound legacy-vs-v0: MEDIUM-LOW — external fact unconfirmed (no-live-HTTP constraint); Jupiter precedent strong but LiFi param unverified.
- Fixture labels: HIGH — grep-confirmed AC/AD free.

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (codebase facts stable; LiFi API ~14 days for the legacy-param question)
