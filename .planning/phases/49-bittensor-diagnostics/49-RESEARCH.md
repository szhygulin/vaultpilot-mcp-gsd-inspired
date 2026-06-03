# Phase 49: Bittensor diagnostics + v2.7 milestone close-out - Research

**Researched:** 2026-06-03
**Domain:** Substrate (Bittensor) per-wallet diagnostic tool + SECURITY.md milestone close-out
**Confidence:** HIGH

## Summary

Phase 49 is the SMALLEST v2.7 phase: one plan, one requirement (TAO-DIAG-01). It ships
`get_bittensor_setup_status({ wallet })` — a near-mechanical CLONE of the shipped
`get_tron_setup_status` (Phase 21) — plus a `## v2.7 Bittensor` milestone close-out section in
SECURITY.md. All cryptographic-binding modules are shipped and FROZEN across Phases 46-49; this
phase ADDS one tool file + docs and asserts zero-deletion against the FROZEN file set. No
binding, chain, or transport re-research is needed — those are settled in 46/47/48.

The four narrow probes all resolved against shipped source (no live RPC/transport opened):
1. **App-version probe** — `_transport.getVersionViaApp(app)` ALREADY exists on the shipped
   `ledger-bittensor-transport.ts` `_transport` indirection. It returns `{ major, minor, patch }`
   (confirmed by the shipped test mock `test/ledger-bittensor-transport.test.ts:95`). `ledgerPolkadotAppVersion = `${major}.${minor}.${patch}``. **No new transport helper required** — the
   seam is already there. [VERIFIED: codebase grep]
2. **Demote-to-null arms** — `get_tron_setup_status` runs N independent probes via
   `Promise.allSettled` + per-probe `Promise.race(timeoutAfter(ms))`; each `rejected` arm sets its
   field to `null`/safe-default + an envelope reason field (`rpcDegraded` / `deviceStatus`).
   The Bittensor tool clones this with THREE arms (RPC → `stakePositionsPresent`; USB-HID →
   `walletAddressOnDevice`; app-version → `ledgerPolkadotAppVersion`). [VERIFIED: codebase]
3. **`stakePositionsPresent`** — cheapest lazy check is `getStakeInfo(ss58).length > 0` from the
   shipped `tao-rpc-client.ts`, routed through `_bittensorRegistry.getApi()` (the test-spy seam,
   NEVER a bare socket). Boolean only — no amount decode needed. [VERIFIED: codebase]
4. **SECURITY.md section shape** — mirror `## TRON v2.1 milestone close-out summary` (SECURITY.md
   L329): heading → intro → Milestone PRs → Trust-shape recap → residual risks → Phase-N
   diagnostics threat register table → FROZEN assertion. [VERIFIED: codebase]

**Primary recommendation:** Clone `get_tron_setup_status` structurally; reuse the existing
`_transport.getVersionViaApp` seam (no transport edit) + `getStakeInfo` + `_bittensorRegistry`;
mirror the TRON close-out section in SECURITY.md verbatim-by-structure with v2.7 trust-shape facts
from 47/48 research.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `ledgerPolkadotAppVersion` probe | Wallet (USB-HID transport) | — | App version comes from the device GET_VERSION APDU via the existing `_transport` seam |
| `walletAddressOnDevice` probe | Wallet (USB-HID transport) | — | On-device address fetch via `fetchBittensorAddress` (pre-encoded SS58) |
| `stakePositionsPresent` probe | Chain (subtensor RPC) | — | `getStakeInfo` runtime-API read via `_bittensorRegistry.getApi()` |
| Diagnostic envelope assembly | Tools (`src/tools/`) | — | Read-only tool handler; no handle, no trust pipeline, no new error code |
| v2.7 close-out doc | Docs (SECURITY.md) | — | Milestone narrative; mirrors prior close-out sections |

## Standard Stack

No new packages. All dependencies are shipped + FROZEN from Phases 46-48:

### Core (all shipped — reuse, do not install)
| Module | Purpose | Reuse As |
|--------|---------|----------|
| `src/wallet/ledger-bittensor-transport.ts` | USB-HID + Polkadot Generic app | `fetchBittensorAddress(path)` → `{address, pubKey}`; `_transport.getVersionViaApp(app)` → `{major,minor,patch}` |
| `src/chains/bittensor/tao-rpc-client.ts` | subtensor reads | `getStakeInfo(ss58)` → `BittensorStakeRow[]` (presence = `.length > 0`) |
| `src/chains/bittensor/registry.ts` | RPC api + URL resolution | `_bittensorRegistry.getApi()` test-spy seam |
| `src/wallet/non-evm-account-store.ts` | persistent pairing cache | `listAccounts({ chainFilter: "bittensor" })` |
| `src/tools/get_tron_setup_status.ts` | the structural CLONE TEMPLATE | copy the `Promise.allSettled` + per-arm demote-to-null shape |

**Installation:** none — Phase 49 installs zero packages, so no Package Legitimacy Audit applies.

## Architecture Patterns

### System Architecture Diagram

```
agent call: get_bittensor_setup_status({ wallet? })
        │
        ▼
  resolve walletAddress  ◄── listAccounts({chainFilter:"bittensor"})  (no arg → first record;
        │                                                              no arg + no record → INVALID_INPUT)
        ▼
  Promise.allSettled([  2 INDEPENDENT lazy arms (RPC + a single fused device open), fired at invocation only ])
    ├─ ARM A (RPC):        getStakeInfo(ss58)              ── rejected → stakePositionsPresent=false + rpcDegraded.reason
    │    via _bittensorRegistry.getApi()                  ── fulfilled → stakePositionsPresent = rows.length > 0
    └─ DEVICE ARM (USB-HID, ONE open): fetchBittensorSetup(path) → { address, pubKey, appVersion }
         (ARMs B+C FUSED — RESOLVED Option 1)             ── rejected → walletAddressOnDevice=null + deviceStatus.reason
                                                             AND ledgerPolkadotAppVersion=null (one open → both demote together)
                                                          ── fulfilled → walletAddressOnDevice = address;
                                                                         ledgerPolkadotAppVersion = `${major}.${minor}.${patch}`
        │
        ▼
  (addressVerified OMITTED — TAO-DIAG-01 spec is authoritative; the agent itself compares
   walletAddressOnDevice to the stored address if it needs that check)
        │
        ▼
  structuredContent { ledgerPolkadotAppVersion?, walletAddressOnDevice, stakePositionsPresent, rpcDegraded?, deviceStatus? }
```

**KEY DESIGN NOTE on ARM B vs ARM C coupling — RESOLVED: Option 1 (single fused device open via the additive `fetchBittensorSetup` helper; see Open Questions (RESOLVED) below).** In the TRON analog, `fetchTronAddress` BUNDLES
`getAppConfiguration()` so address + appVersion come from a SINGLE transport open (D-03a). The
Bittensor transport DIFFERS: `fetchBittensorAddress` opens its own transport (calling
`getVersionViaApp` internally only as an app-not-open probe, discarding the result) and returns
`{address, pubKey}` — it does NOT surface the version. Two clean options for the planner:

- **Option 1 (recommended — additive, single transport open):** add a small ADDITIVE helper to
  the shipped transport that opens once, probes `getVersionViaApp` → `{major,minor,patch}`, fetches
  the address, and returns `{ address, pubKey, appVersion }` (mirrors `fetchTronAddress`'s bundled
  shape). This is a NEW additive function — NOT an edit to the FROZEN binding modules and NOT an
  edit to `fetchBittensorAddress`/`signBittensorTransaction`. Cheaper for the device (one approval).
- **Option 2 (two transport opens, zero transport edit):** the tool calls `fetchBittensorAddress`
  (ARM B) and a separate `_transport`-based version probe (ARM C) as two arms. Simpler diff (no
  transport file touched at all) but opens the USB-HID handle twice and may double user prompts.

The `_transport` indirection ALREADY exposes `getVersionViaApp` + `buildGenericApp` + `open`, so
either option reuses existing seams. **Flag for the planner to pick** — Option 1 matches the TRON
bundled-version precedent and the single-approval UX; Option 2 holds the transport file
byte-identical. Note: any additive helper is a Phase-49 addition, NOT a frozen-file edit (the
FROZEN set is the cryptographic-binding modules + send_transaction three-gate region, not the
whole transport file — the transport already took an ADDITIVE edit in Phase 47 for `signWithMetadataEd25519ViaApp`).

### Pattern 1: Promise.allSettled + per-arm demote-to-null
**What:** N independent probes run concurrently; each settles independently; a rejected arm
demotes ONLY its own field, never the whole call.
**When to use:** diagnostic tools that must return partial state on partial failure.
**Example (from the shipped TRON analog — clone this exactly):**
```typescript
// Source: src/tools/get_tron_setup_status.ts:148-238
const [rpcResult, deviceResult] = await Promise.allSettled([
  Promise.race([ _tronRegistry.getTronWeb().trx.getAccount(walletAddress), timeoutAfter(5000) ]),
  Promise.race([ _tronLedgerTransport.fetchTronAddress(derivationPath), timeoutAfter(10000) ]),
]);
if (rpcResult.status === "fulfilled") { /* decode */ } else { rpcDegraded = { reason: ... }; /* safe defaults */ }
if (deviceResult.status === "fulfilled") { /* decode */ } else { walletAddressOnDevice = null; deviceStatus = { reason } }
```
For Bittensor: the RPC arm wraps `getStakeInfo(ss58)`; the device arm wraps the address fetch; the
app-version arm wraps `getVersionViaApp` (or is folded into the device arm under Option 1).

### Pattern 2: `getVersion()` → `{ major, minor, patch }`
**What:** the `@zondax/ledger-js` `BaseApp.getVersion()` (which `PolkadotGenericApp` extends)
returns a `ResponseVersion`-shaped object. The shipped test mocks it as `{ major: 1, minor: 0,
patch: 0 }`.
**Source:** `test/ledger-bittensor-transport.test.ts:95` mocks
`getVersionViaApp` → `{ major: 1, minor: 0, patch: 0 }`. [VERIFIED: codebase grep]
**Format:** `ledgerPolkadotAppVersion = `${v.major}.${v.minor}.${v.patch}``.
**Note:** the installed `@zondax/ledger-substrate` `.d.ts` was NOT present in node_modules at
research time (deps not installed in this worktree). The `{major,minor,patch}` shape is taken from
the shipped test mock + the Phase 46 RESEARCH §A2 finding, not a live `.d.ts` read. [ASSUMED —
see Assumptions Log A1] Confirm the exact field names against `dist/generic_app.js` /
`@zondax/ledger-js` `ResponseVersion` at execute time if the deps differ.

### Anti-Patterns to Avoid
- **Boot-time RPC** — TAO-DIAG-01 is a LAZY probe. Do NOT call `getApi()` / `getStakeInfo` at
  module load or `startServer()`. Only fire on explicit tool invocation. (Test asserts no boot RPC.)
- **Forcing a WS socket in the no-pairing path** — return the INVALID_INPUT refusal BEFORE any
  probe when no wallet arg AND no store record exists (mirror TRON L126-141).
- **New error code** — the error-code union is FROZEN. Reuse `INVALID_INPUT + hintTool:
  "pair_bittensor_ledger"` for the no-pairing case (mirror Phase 21 D-06 / `get_bittensor_status`).
- **Editing FROZEN binding modules** — payloadFingerprint/presign/send_transaction three-gate
  region stay byte-identical. The diagnostic is READ-ONLY.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| App-version probe seam | A new transport method | `_transport.getVersionViaApp(app)` (shipped) | Already exists + already spied in tests |
| Stake presence | A raw `api.query.subtensorModule.*` storage scan | `getStakeInfo(ss58)` runtime API | Shipped, decoded, anti-pattern-avoided (per tao-rpc-client comments) |
| RPC api access | `ApiPromise.create` directly | `_bittensorRegistry.getApi()` | Preserves the test-spy seam; never opens a bare socket in unit tests |
| Concurrent probes | Sequential awaits | `Promise.allSettled` + `Promise.race(timeoutAfter)` | The TRON analog's proven partial-failure pattern |
| Pairing lookup | Reading the JSON file | `listAccounts({ chainFilter: "bittensor" })` | Swallows IO errors → `[]`; already used by `get_bittensor_status` |

**Key insight:** every seam this tool needs is already shipped + already spied by an existing test.
The only NEW code is the tool handler (and optionally one additive transport helper under Option 1).

## Runtime State Inventory

Not applicable — Phase 49 is additive (one new tool + docs), NOT a rename/refactor/migration. No
stored data, live-service config, OS-registered state, secrets, or build artifacts change.
**None — verified by scope (additive tool + SECURITY.md section only).**

## Common Pitfalls

### Pitfall 1: Probing version + address as two transport opens (double approval)
**What goes wrong:** ARM B and ARM C each open the USB-HID transport → two device prompts, two
"device busy" risks if not closed cleanly.
**How to avoid:** Option 1 — one additive helper that opens once and returns
`{ address, pubKey, appVersion }`. Or accept the two-open cost (Option 2) for a zero-transport-edit
diff. Planner picks.
**Warning signs:** the user is asked to approve on-device twice for one diagnostic call.

### Pitfall 2: `getApi()` hanging on an unreachable RPC
**What goes wrong:** unlike Solana's lazy `Connection`, subtensor's `ApiPromise.create` opens a
live WS socket. A naive `getStakeInfo` against a dead RPC could hang.
**How to avoid:** wrap ARM A in `Promise.race(timeoutAfter(ms))` (TRON used 5s for RPC). The
existing `get_bittensor_status` sidesteps this by reading the URL STRING via `getResolvedRpcUrl()`
WITHOUT `getApi()`; but `stakePositionsPresent` NEEDS the live read, so the timeout race is the
right guard — a timeout demotes `stakePositionsPresent` to `false` + sets `rpcDegraded.reason`.
**Warning signs:** the diagnostic never returns when `BITTENSOR_RPC_URL` points at a dead endpoint.

### Pitfall 3: Treating app-version as a security gate
**What goes wrong:** gating behavior on `ledgerPolkadotAppVersion`.
**How to avoid:** it is INFORMATIONAL only (mirror Phase 21 T-LEDGER-APP-VERSION-LIES). A spoofed
version cannot weaponize a read-only diagnostic by construction. No version-gating in v2.7.

## Code Examples

### App-version arm (the version probe)
```typescript
// Reuses the SHIPPED _transport.getVersionViaApp seam (no new transport method needed for Option 2).
// Source: src/wallet/ledger-bittensor-transport.ts:136 + test/ledger-bittensor-transport.test.ts:95
const v = (await _transport.getVersionViaApp(app)) as { major: number; minor: number; patch: number };
const ledgerPolkadotAppVersion = `${v.major}.${v.minor}.${v.patch}`;
```

### Stake-presence arm (cheapest lazy boolean)
```typescript
// Source: src/chains/bittensor/tao-rpc-client.ts:200 getStakeInfo
const rows = await getStakeInfo(ss58 as Ss58Address);   // routes through _bittensorRegistry.getApi()
const stakePositionsPresent = rows.length > 0;          // boolean only — no amount decode
```

## State of the Art

| Old Approach | Current Approach | When | Impact |
|--------------|------------------|------|--------|
| TRON bundles appVersion inside `fetchTronAddress` (single open) | Bittensor `fetchBittensorAddress` returns `{address,pubKey}` only | Phase 46 | Phase 49 must EITHER add a bundled helper (Option 1) OR run a second arm (Option 2) for the version |

**Deprecated/outdated:** none relevant — `signWithMetadata` (non-suffixed) is `@deprecated` in
`@zondax/ledger-substrate` 2.3.4 but Phase 47 already uses the `*Ed25519` variant; Phase 49 does
not sign at all.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getVersion()` returns `{ major, minor, patch }` | Pattern 2 | LOW — taken from shipped test mock (`test/ledger-bittensor-transport.test.ts:95`) + Phase 46 RESEARCH §A2; deps not installed in worktree so not re-read from live `.d.ts`. Worst case the field names differ (e.g. nested under `.version`); confirm at execute time. The arm demotes to null on any throw regardless, so a shape mismatch fails safe. |

## Open Questions (RESOLVED)

1. **Option 1 vs Option 2 for the version probe (single vs double transport open)**
   - What we know: `_transport.getVersionViaApp` + `buildGenericApp` + `open` all exist; the TRON
     precedent bundles version into the address fetch (single open).
   - What's unclear: whether the planner prefers the single-approval UX (Option 1, one additive
     helper) or the zero-transport-edit diff (Option 2, two arms).
   - **RESOLVED (49-01-PLAN, Task 2):** Option 1 — additive bundled `fetchBittensorSetup` helper
     (single transport open, single device approval; matches TRON precedent). Additive, NOT a
     FROZEN-file edit. ARMs B+C settle together as one device arm.

2. **`addressVerified` in the envelope?**
   - What we know: the TAO-DIAG-01 spec shape is `{ ledgerPolkadotAppVersion?,
     walletAddressOnDevice, stakePositionsPresent }` — it does NOT list `addressVerified`, but the
     TRON analog surfaces it.
   - **RESOLVED (49-01-PLAN, Tasks 1+3):** `addressVerified` OMITTED entirely — the TAO-DIAG-01
     spec shape is authoritative. The agent compares `walletAddressOnDevice` to the stored address
     itself if it needs that check.

## Environment Availability

Skipped — no external dependency the planner must install or probe at plan time. The USB-HID device
and subtensor RPC are runtime-only and are exactly what the LAZY probe + demote-to-null arms
tolerate the absence of. (Research did NOT open a live transport/RPC per the anti-hang directive.)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (shipped; `test/` dir, `*.test.ts`) |
| Config file | repo `vitest.config.ts` / `package.json` test script (shipped) |
| Quick run command | `npx vitest run test/get-bittensor-setup-status.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TAO-DIAG-01 | Happy path: all 3 arms fulfilled → full envelope | unit | `npx vitest run test/get-bittensor-setup-status.test.ts -t "all arms"` | ❌ Wave 0 |
| TAO-DIAG-01 | ARM A reject → `stakePositionsPresent:false` + `rpcDegraded` (others intact) | unit | same file `-t "rpc arm"` | ❌ Wave 0 |
| TAO-DIAG-01 | ARM B reject → `walletAddressOnDevice:null` + `deviceStatus` (others intact) | unit | same file `-t "usb-hid arm"` | ❌ Wave 0 |
| TAO-DIAG-01 | ARM C reject → `ledgerPolkadotAppVersion:null` (others intact) | unit | same file `-t "app-version arm"` | ❌ Wave 0 |
| TAO-DIAG-01 | No boot RPC: `getApi` NOT called until tool invoked | unit | same file `-t "no boot rpc"` | ❌ Wave 0 |
| TAO-DIAG-01 | No-pairing → `INVALID_INPUT + hintTool` (no probe fired) | unit | same file `-t "no pairing"` | ❌ Wave 0 |
| TAO-DIAG-01 | SECURITY.md `## v2.7 Bittensor` section present + content | smoke | `npx vitest run test/security-doc.bittensor.test.ts` OR grep assertion | ❌ Wave 0 |

**Test seams (all shipped):** `vi.spyOn(_bittensorRegistry, "getApi")` (ARM A — assert NOT called
until invocation), `vi.spyOn(_transport, "getAddressEd25519ViaApp" | "getVersionViaApp" | "open")`
(ARMs B/C), `vi.spyOn(non-evm-account-store, "listAccounts")` (pairing lookup). Each arm tested
INDEPENDENTLY: spy one seam to reject, assert ONLY its field demotes + the others stay populated.

### Sampling Rate
- **Per task commit:** `npx vitest run test/get-bittensor-setup-status.test.ts`
- **Per wave merge:** `npx vitest run` (full suite — incl. the FROZEN regression suites)
- **Phase gate:** full suite green + FROZEN zero-deletion assertion before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/get-bittensor-setup-status.test.ts` — covers TAO-DIAG-01 (6 arms above; spy the 3 seams)
- [ ] SECURITY.md `## v2.7 Bittensor` presence/content assertion — a focused grep test OR a
      `test/security-doc.bittensor.test.ts` reading SECURITY.md and asserting the heading + the
      blind-sign-residual + `CheckMetadataHash` + verify-phase-scope phrases are present
- [ ] (no framework install needed — vitest is shipped)

## Security Domain

> `security_enforcement` enabled (no config override found). Phase 49 is READ-ONLY: no new write
> path, no new error code, no binding change.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no auth surface in a read-only diagnostic |
| V4 Access Control | no | local MCP tool; no remote access surface |
| V5 Input Validation | yes | `wallet` is an optional string; no-arg + no-record → `INVALID_INPUT` refusal |
| V6 Cryptography | no | NO signing, NO hashing, NO key material — the diagnostic reads device + RPC state only |
| V9/V14 (logging/config) | yes | failures surface via envelope fields (`rpcDegraded`/`deviceStatus`), never silent zeros (T-RPC-FAILURE-MASKED-AS-EMPTY analog) |

### Known Threat Patterns for the diagnostic (mirror Phase 21 register)
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| T-PAIRING-DRIFT (stored ≠ on-device addr) | Tampering | surface `walletAddressOnDevice` verbatim; if `addressVerified` included, strict-equality, NO auto-refusal (diagnostic, not guard) |
| T-RPC-FAILURE-MASKED-AS-EMPTY | Information Disclosure | `rpcDegraded.reason` set on ARM-A failure; `stakePositionsPresent:false` only on verifiably-empty OR explicitly-degraded |
| T-LEDGER-APP-VERSION-LIES | Spoofing | `ledgerPolkadotAppVersion` INFORMATIONAL only; no version-gating; spoof cannot weaponize a read-only tool |
| T-49-FROZEN | Tampering | `git diff origin/main` zero-deletion on the FROZEN binding set; Phase 49 READ-ONLY by construction |

### SECURITY.md `## v2.7 Bittensor` close-out — required content (mirror TRON L329 structure)
The section MUST contain, in this order (matching `## TRON v2.1 milestone close-out summary`):
1. **Heading + intro** — `## v2.7 Bittensor milestone close-out` + one-line "closes out v2.7;
   Phases 46-49 shipped under per-plan admin-merge cadence."
2. **Milestone PRs** — bullet per phase (46 scaffolding / 47 trust pipeline / 48 dTAO depth / 49
   diagnostics) with the PR numbers + the shipped surface.
3. **Trust-shape recap** (the 47/48 facts — all already established):
   - **ed25519 Ledger coldkey** — subtensor accepts `MultiSignature::Ed25519`; the Ledger SE
     cannot do sr25519, so the Ledger account IS the coldkey (no sr25519-migration tooling).
   - **Domain-tagged `payloadFingerprint`** — `"VaultPilot-taotx-v1:"` binds ONLY the unsigned
     `SignerPayload` SCALE bytes; cross-chain reuse impossible by construction. SENDER-INDEPENDENT
     (contrast Solana whose feePayer is in the bytes — Phase 47 persona-cycle re-anchor proves it).
   - **`presignHash = blake2-256`** of the signable blob — the ONE divergence from the SHA-256
     Solana/TRON siblings; matches what the Polkadot Generic app blind-signs on-device.
   - **`(pallet, call)`-only canonical-dispatch allowlist** (`canonical-dispatch-bittensor.ts`) —
     consistent with how Solana/TRON ship blind-sign.
4. **`CheckMetadataHash` chain-enforced integrity** — subtensor enforces the metadata hash; the
   metadata-shortener service is UNTRUSTED-BY-CONSTRUCTION (availability-only dependency, not a
   trust dependency).
5. **Accepted residual risks** — (a) ship-with-blind-sign residual (staking calls may blind-sign
   on-device; documented, consistent with Solana/TRON); (b) metadata-shortener availability-only
   dependency; (c) **v2.7 verify-phase pending** = real-Ledger Polkadot-Generic-app small-amount
   mainnet stake (same disposition pattern as v2.1/v2.3 close-outs).
6. **Phase 49 (diagnostics) threat register summary** — the table above (T-PAIRING-DRIFT /
   T-RPC-FAILURE-MASKED-AS-EMPTY / T-LEDGER-APP-VERSION-LIES / T-49-FROZEN).
7. **FROZEN assertion** — the cryptographic-binding chain (payloadFingerprint + blake2-256 presign
   + send_transaction three-gate region) byte-identical to `origin/main` across Phases 46-49.

## Sources

### Primary (HIGH confidence — codebase)
- `src/tools/get_tron_setup_status.ts` — the structural CLONE template (Promise.allSettled +
  per-arm demote-to-null + no-pairing INVALID_INPUT)
- `src/wallet/ledger-bittensor-transport.ts` — `_transport.getVersionViaApp` seam (L136) +
  `fetchBittensorAddress` (L203) + ADDITIVE-edit precedent (Phase 47 `signWithMetadataEd25519ViaApp`)
- `src/chains/bittensor/tao-rpc-client.ts:200` — `getStakeInfo(ss58)` → presence boolean
- `src/chains/bittensor/registry.ts:154` — `_bittensorRegistry.getApi` test seam
- `src/tools/get_bittensor_status.ts` — Phase 46 status sibling (reuses `listAccounts` + registry)
- `test/ledger-bittensor-transport.test.ts:95` — `{major,minor,patch}` getVersion shape mock
- `SECURITY.md` L329-377 — `## TRON v2.1 milestone close-out summary` (the close-out template)
- `.planning/phases/47-bittensor-trust-pipeline/47-04-SUMMARY.md` — v2.7 trust-shape facts +
  FROZEN zero-deletion assertion pattern
- `.planning/ROADMAP.md` L21, L1337-1346 — Phase 49 goal + success criteria
- `.planning/REQUIREMENTS.md` L438 — TAO-DIAG-01 exact text

### Tertiary (LOW confidence — not re-verified live)
- `@zondax/ledger-substrate` / `@zondax/ledger-js` `ResponseVersion` `{major,minor,patch}` field
  names — deps not installed in this worktree; taken from shipped test mock + Phase 46 RESEARCH §A2
  (Assumption A1). Confirm at execute time if needed.

## Metadata

**Confidence breakdown:**
- Standard stack (reuse only): HIGH — every seam is shipped + spied by existing tests
- Architecture (clone of TRON analog): HIGH — direct structural mirror of a shipped tool
- App-version shape: HIGH-to-MEDIUM — shipped test mock confirms `{major,minor,patch}`; live
  `.d.ts` not re-read (A1)
- SECURITY.md section shape: HIGH — direct mirror of the shipped TRON close-out

**Research date:** 2026-06-03
**Valid until:** stable (no fast-moving external deps; all internal + FROZEN) — ~30 days
