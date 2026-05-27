# Phase 38: `enableModule` + `delegateCall: true` hard-trigger second-LLM check (Inv #12.5) — Pattern Map

**Mapped:** 2026-05-27
**Files analyzed:** 11 (3 NEW main-repo + 7 EDIT main-repo + 1 sister-repo deferred to Plan 38-02)
**Analogs found:** 11 / 11 (every file has a strong analog in the existing codebase)

## File Classification

| New/Modified File | Plan | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/protocols/safe.ts` | 38-01 | NEW protocol decoder | pure-function transform | `src/protocols/weth9.ts` + `src/protocols/erc20.ts` (selector + decoder) AND `src/signing/safe-exec-decode.ts` (single-arg `parseAbi` + `decodeFunctionData` pattern) | exact |
| `test/protocols-safe.test.ts` | 38-01 | NEW unit test | pure-function transform | `test/protocols-weth9.test.ts` + `test/protocols-erc20.test.ts` + `test/signing-safe-exec-decode.test.ts` | exact |
| `test/signing-blocks-hard-trigger.test.ts` (or merge into existing) | 38-01 | NEW unit test | template substitution | `test/security-skill-integrity.test.ts` (template-prose anchor pattern) | role-match |
| `src/signing/blocks.ts` | 38-01 | EDIT — APPEND template constants | template-with-substitution | `VAULTPILOT_NOTICE_TEMPLATE_MISSING/TAMPERED` (lines 751-788) + `AGENT_TASK_TEMPLATE` (lines 116-141) + `PASTEABLE_BLOCK_TEMPLATE` (lines 811-) | exact |
| `src/tools/prepare_safe_tx_propose.ts` | 38-01 | EDIT — REMOVE inline note + APPEND block | request-response (text composition) | self (Phase 37 prepare_safe_tx_propose response composition at lines 518-561) | exact (self-mirror) |
| `src/tools/prepare_safe_tx_approve.ts` | 38-01 | EDIT — REMOVE inline note + APPEND block | request-response | self (Phase 37 lines 386-437) | exact (self-mirror) |
| `src/tools/prepare_safe_tx_execute.ts` | 38-01 | EDIT — REMOVE inline note + APPEND block | request-response | self (Phase 37 lines 523-577) | exact (self-mirror) |
| `src/tools/preview_send.ts` | 38-01 | EDIT — APPEND re-emission in existing branch | request-response | self (Phase 37 `isSafeExecTransaction` branch at lines 1888-1968) | exact (self-mirror) |
| `src/security/skill-integrity.ts` | 38-01 | EDIT — REPLACE single SHA constant | config constant | self (Phase 9 line 60-61) | exact (self-mirror) |
| `src/tools/get_verification_artifact.ts` | 38-01 | EDIT — extend `txType` dispatch (~30 lines, A1) | request-response | self (Phase 9 lookup-then-template at lines 84-138) + composite branching from `preview_send.ts` (lines 1981-1986) | role-match |
| `SECURITY.md` (new section) | 38-01 | EDIT — append `## Phase 38` section + threat-register table | documentation | `SECURITY.md` Phase 32 section (lines 544-572) | exact |
| `~/...vaultpilot-preflight-skill/SKILL.md` (sister repo) | 38-02 | EDIT — insert Step 0.5 | documentation | `.planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md` | exact (Phase 9 precedent) |

## Pattern Assignments

### `src/protocols/safe.ts` (NEW protocol decoder)

**Primary analog:** `src/protocols/weth9.ts` (single-method protocol module, 93 lines — closest scale and shape to Phase 38's expected ~70-line `safe.ts`).
**Secondary analog:** `src/signing/safe-exec-decode.ts` (already-existing Safe-domain decoder; same `parseAbi` + `decodeFunctionData` mechanics; SHARED-decoder discipline comment).

**Header / module-purpose comment pattern** — from `src/protocols/weth9.ts:1-23`:
```typescript
// Second occupant of `src/protocols/` — WETH9 protocol primitives for Phase 6
// (Plan 06-04). The combined-decode side of WETH9.withdraw already lives in
// src/protocols/erc20.ts ...
//
// SDK reality (verified against viem@2.48.11):
//   - viem does NOT export a `weth9Abi` const. ...
//   - `WETH9.withdraw(uint256)` selector === keccak256("withdraw(uint256)")[:4]
//     === 0x2e1a7d4d (verified via viem.toFunctionSelector).
//
// The combined-ABI decode in src/protocols/erc20.ts handles the receiving
// side. This module is consumed by:
//   - src/tools/prepare_weth_unwrap.ts (Plan 06-04 — encoder + canonical
//     address re-export)
//   - src/signing/blocks.ts            (Plan 06-04 — WETH9_DECIMALS for the
//     DECODED ARGS withdraw branch's formatUnits call)
```
Phase 38 mirrors this header shape: name the file's role, name the SDK reality (`viem.toFunctionSelector('enableModule(address)') === '0x610b5925'`), name the consumers (`prepare_safe_tx_propose / _approve / _execute / preview_send`), name the format-fanout-sentinel SOT discipline.

**Imports pattern** — from `src/signing/safe-exec-decode.ts:17-23`:
```typescript
import {
  decodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
```
Single namespace import; no internal-module imports needed (pure function). Phase 38 `safe.ts` imports identically.

**Selector constant + ABI fragment pattern** — from `src/protocols/weth9.ts:41-53` and `src/signing/safe-exec-decode.ts:36-49`:
```typescript
// weth9.ts:41-44
export const WETH9_WITHDRAW_ABI = parseAbi([
  "function withdraw(uint256 amount)",
  "function deposit() payable",
]);

// weth9.ts:51-53
export const WETH9_SELECTORS = {
  withdraw: "0x2e1a7d4d" as Hex,
} as const;
```
Phase 38 ships:
- `ENABLE_MODULE_SELECTOR = "0x610b5925" as const` (single literal, NOT a `_SELECTORS` map — only one selector in scope; `erc20.ts` uses a map only because it ships multiple).
- `enableModuleAbi = parseAbi(["function enableModule(address module)"])` — module-private const, not exported (consumer never needs the ABI directly; the decoder is the public surface).

**Decoder pattern** — from `src/signing/safe-exec-decode.ts:88-138`:
```typescript
export function decodeSingleSafeExecTransaction(
  data: Hex,
): DecodedSafeExecTransaction {
  const decoded = decodeFunctionData({ abi: execTransactionAbi, data });
  if (decoded.functionName !== "execTransaction") {
    throw new Error(
      `decodeSingleSafeExecTransaction: expected functionName 'execTransaction', got '${decoded.functionName}'`,
    );
  }
  const args = decoded.args as readonly [
    Address,
    bigint,
    Hex,
    number,
    // ...
  ];
  // ...destructure + return typed object
}
```
Phase 38 ships `decodeEnableModuleCalldata(data: Hex): { module: Address }` — same `decodeFunctionData` call, same `decoded.functionName !== "enableModule"` defensive throw, single-arg destructure (`const args = decoded.args as readonly [Address]; return { module: args[0] };`).

**Predicate helper pattern** — from `src/protocols/erc20.ts:138-142`:
```typescript
export function decodeErc20Call(data: Hex): Erc20Decoded {
  if (data === "0x" || data.length < 10) {
    return { kind: "unknown", selector: data as Hex };
  }
  const selector = data.slice(0, 10).toLowerCase() as Hex;
```
Phase 38 ships `isEnableModuleCalldata(data: Hex): boolean` — same length + lowercase-normalization discipline; returns `data.length >= 10 && data.slice(0, 10).toLowerCase() === ENABLE_MODULE_SELECTOR`. The lowercase normalization is load-bearing — Tx Service can ship mixed-case calldata.

**ESM spy-affordance** — from `src/protocols/erc20.ts:175-180`:
```typescript
export const _protocols = { decodeErc20Call };
```
Phase 38 SKIP this indirection — `safe.ts` exports pure functions consumed at the call site as named imports; tests can directly call `isEnableModuleCalldata` / `decodeEnableModuleCalldata` without needing to spy across an ESM binding (the only mockable surface would be `viem.decodeFunctionData` itself, which lives outside this module). CLAUDE.md convention says "Add the indirection at write time" only for modules whose exports call each other internally — not for leaf decoders. `aave-v3.ts` uses `_aaveProtocols` because `preview_send.ts` calls through it; `safe.ts` callers don't need that affordance (no internal cross-call to spy on).

---

### `test/protocols-safe.test.ts` (NEW unit test)

**Primary analog:** `test/protocols-weth9.test.ts` (78 lines — selector + encoder + decoder cross-link to combined ABI; closest scale).
**Secondary analog:** `test/signing-safe-exec-decode.test.ts` (Safe-domain shape; round-trip discipline).

**Header / cross-link comment pattern** — from `test/protocols-weth9.test.ts:1-13`:
```typescript
// Pure encode + selector + decimals + cross-link tests for src/protocols/weth9.ts.
//
// Phase 6 — Plan 06-04. Anchors:
//   - WETH9_SELECTORS.withdraw === 0x2e1a7d4d (universal — drift here breaks
//     every WETH unwrap flow).
//   - encodeWethWithdraw(1e18) round-trips Fixture F's data byte-identically
//     (cross-link to test/signing-fingerprint.test.ts).
//   - decodeErc20Call (Plan 06-02 — combined ABI) recognizes the withdraw
//     calldata; cross-tool consistency anchor.
```
Phase 38 header anchors:
- `ENABLE_MODULE_SELECTOR === "0x610b5925"` byte-identical (universal — drift breaks Inv #12.5).
- `decodeEnableModuleCalldata` round-trip against Fixture SAFE-G.
- `isEnableModuleCalldata` lowercase-normalization positive + negative cases.

**Selector byte-identity anchor** — from `test/protocols-weth9.test.ts:26-30` and `test/protocols-erc20.test.ts:25-33`:
```typescript
describe("WETH9_SELECTORS — universal selector regression anchor", () => {
  it("withdraw === 0x2e1a7d4d byte-identical", () => {
    expect(WETH9_SELECTORS.withdraw).toBe("0x2e1a7d4d");
  });
});
```
Phase 38:
```typescript
describe("ENABLE_MODULE_SELECTOR — universal selector regression anchor", () => {
  it("equals 0x610b5925 byte-identical (canonical Safe enableModule selector)", () => {
    expect(ENABLE_MODULE_SELECTOR).toBe("0x610b5925");
  });
});
```

**Round-trip fixture anchor pattern** — from `test/protocols-weth9.test.ts:38-58`:
```typescript
describe("encodeWethWithdraw — viem-canonical 36-byte calldata (Fixture F cross-link)", () => {
  it("encodes withdraw(1e18) matching Fixture F's data field byte-identically", () => {
    const data = encodeWethWithdraw(1_000_000_000_000_000_000n);
    const fixtureFData =
      "0x2e1a7d4d0000000000000000000000000000000000000000000000000de0b6b3a7640000";
    expect(data.toLowerCase()).toBe(fixtureFData);
    expect(data.length).toBe(74);
    expect(data.slice(0, 10)).toBe(WETH9_SELECTORS.withdraw);
  });
});
```
Phase 38 Fixture SAFE-G (per RESEARCH § Topic 9 — already computed via viem 2.48.11):
```typescript
// test/protocols-safe.test.ts — Fixture SAFE-G
export const FIXTURE_SAFE_G_CALLDATA =
  "0x610b5925000000000000000000000000cafe0000000000000000000000000000cafe0001" as const;
export const FIXTURE_SAFE_G_MODULE_ADDRESS =
  "0xcafe0000000000000000000000000000cafe0001" as const; // lowercased — bypass EIP-55 (per Phase 37 Fixture SAFE-B Rule 1 pattern)

describe("decodeEnableModuleCalldata — round-trip against Fixture SAFE-G", () => {
  it("decodes the canonical fixture to its embedded module address", () => {
    const { module } = decodeEnableModuleCalldata(FIXTURE_SAFE_G_CALLDATA);
    expect(module.toLowerCase()).toBe(FIXTURE_SAFE_G_MODULE_ADDRESS);
  });
});
```

**Negative-case decoder pattern** — from `test/protocols-erc20.test.ts:113-133`:
```typescript
it("(unknown — native send) data === \"0x\" returns { kind: unknown, selector: \"0x\" }", () => {
  const decoded = decodeErc20Call("0x");
  expect(decoded.kind).toBe("unknown");
});

it("(unknown — truncated data) data.length < 10 returns { kind: unknown }", () => {
  const decoded = decodeErc20Call("0xa9" as Hex);
  expect(decoded.kind).toBe("unknown");
});
```
Phase 38 negative cases for `isEnableModuleCalldata`:
- `"0x"` → `false`
- `"0x12345678abcdef"` → `false` (wrong selector)
- mixed-case `"0x610B5925..."` → `true` (lowercase normalization positive case)
- Phase 38 negative case for `decodeEnableModuleCalldata`: truncated `"0x610b5925cafe"` throws (per Plan-38-01 truncated-calldata refusal).

---

### `src/signing/blocks.ts` (EDIT — APPEND template constants)

**Primary analog (template constant shape):** `VAULTPILOT_NOTICE_TEMPLATE_MISSING` + `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` at `src/signing/blocks.ts:751-788`.
**Secondary analog (agent-instruction voice):** `AGENT_TASK_TEMPLATE` at `src/signing/blocks.ts:116-141`.

**Header / append-only comment block pattern** — from `src/signing/blocks.ts:730-749`:
```typescript
/**
 * `VAULTPILOT NOTICE — vaultpilot-preflight skill not installed` template.
 * One slot: `{PATHS}` (newline-indented bullet list of probed install paths).
 *
 * Substituted with the newline-indented list of probed paths in the `{PATHS}`
 * slot. Prepended to the first tool response of a session when the probe
 * returns `{ kind: "missing", pathsProbed }`; subsequent responses in the
 * same session do NOT re-prepend (dedup via `noticeEmitted` flag in
 * `src/security/skill-integrity.ts`).
 *
 * Surfaces the canonical install one-liner so the user can recover without
 * leaving the rehearsal. The trust anchor remains the Ledger device screen;
 * the skill is defense-in-depth against a compromised-MCP scenario (without
 * it, MCP-side checks are the only defense layer).
 */
export const VAULTPILOT_NOTICE_TEMPLATE_MISSING: string = [
  "VAULTPILOT NOTICE — vaultpilot-preflight skill not installed",
  // ...
].join("\n");
```
Phase 38 header pattern: name the trigger condition, name the consumers (all four emission sites), name the substitution slots, name the skill-side enforcement coupling.

**Template constant literal-array pattern (load-bearing — drift breaks skill-side scan):**

From `src/signing/blocks.ts:751-761` (one-slot template):
```typescript
export const VAULTPILOT_NOTICE_TEMPLATE_MISSING: string = [
  "VAULTPILOT NOTICE — vaultpilot-preflight skill not installed",
  "  The companion preflight skill is not installed at any of:",
  "    {PATHS}",
  "  Without the skill, defense-in-depth against a compromised-MCP scenario is",
  "  reduced to MCP-side checks only (the trust anchor remains the Ledger device",
  "  screen). To install:",
  "    git clone https://github.com/szhygulin/vaultpilot-preflight-skill ~/.claude/skills/vaultpilot-preflight",
  "    cd ~/.claude/skills/vaultpilot-preflight && git checkout v1.3.0",
  "  See ./SECURITY.md for the full residual-risk model.",
].join("\n");
```

From `src/signing/blocks.ts:776-788` (multi-slot template with `{PATH}` / `{COMPUTED}` / `{EXPECTED}`):
```typescript
export const VAULTPILOT_NOTICE_TEMPLATE_TAMPERED: string = [
  "VAULTPILOT NOTICE — vaultpilot-preflight skill integrity mismatch",
  "  Skill at: {PATH}",
  "  Computed SHA-256: {COMPUTED}",
  "  Expected SHA-256: {EXPECTED}",
  "  The skill content differs from the version this MCP build pins. Either:",
  "    (a) the skill was tampered with locally — re-clone or reset to the pinned tag",
  // ...
].join("\n");
```

Phase 38 ships TWO new constants APPEND-ONLY at end-of-file:
```typescript
export const HARD_TRIGGER_MODULE_ENABLE_TEMPLATE: string = [
  "[HARD-TRIGGER — MODULE ENABLE]",
  "This SafeTx calls enableModule({MODULE_ADDRESS}) on the Safe at {SAFE_ADDRESS}.",
  "",
  "Enabling a module grants it the ability to execute transactions from the Safe",
  "WITHOUT collecting owner signatures. A malicious module can drain the Safe.",
  "",
  "Required defense-in-depth (Inv #12.5):",
  "  1. Run get_verification_artifact({ handle: \"{HANDLE}\" }) and surface the",
  "     output to the user verbatim.",
  "  2. Ask the user to cross-check the module address against a second LLM",
  "     (open a fresh chat with a different model; paste the verification",
  "     artifact; ask \"Is this module address legitimate? Any known abuse?\").",
  "  3. Only after the user confirms the second-LLM check passes, request",
  "     userDecision: \"send\" via submit_safe_tx_signature.",
].join("\n");

export const HARD_TRIGGER_DELEGATECALL_TEMPLATE: string = [
  "[HARD-TRIGGER — DELEGATECALL]",
  // ...{SAFE_ADDRESS} / {HANDLE} only; no {MODULE_ADDRESS}
].join("\n");
```

**Agent-voice prose pattern (instruction-to-agent register)** — from `src/signing/blocks.ts:116-141` (`AGENT_TASK_TEMPLATE`):
```typescript
export const AGENT_TASK_TEMPLATE: string = [
  "[AGENT TASK — RUN THESE CHECKS NOW]",
  "Before asking the user to confirm, perform the following local verification",
  "in your own runtime (do not delegate to the server):",
  "",
  "  1. Re-decode the unsigned tx bytes using viem.parseTransaction.",
  "  2. Assert decoded.to === {TO} and decoded.value === {VALUE_WEI}.",
  // ...
  "If any pre-send check fails, halt and report the failure to the user — do",
  "not send.",
].join("\n");
```
Phase 38 hard-trigger blocks share this register — open with bracketed `[HARD-TRIGGER — ...]` title (parallel to `[AGENT TASK — RUN THESE CHECKS NOW]`), use imperative-numbered-step instructions to the agent, close with the consequence ("Only after... request userDecision: 'send'").

**Existing v1.3.0 prose-update sites for SHA-pin replacement (DF-2):**

From `src/signing/blocks.ts:758-759` (install one-liner):
```typescript
"    git clone https://github.com/szhygulin/vaultpilot-preflight-skill ~/.claude/skills/vaultpilot-preflight",
"    cd ~/.claude/skills/vaultpilot-preflight && git checkout v1.3.0",  // ← update to v1.4
```

From `src/signing/blocks.ts:783-785` (TAMPERED template prose):
```typescript
"    (c) you have an older skill version than this MCP — git checkout v1.3.0 in",  // ← update to v1.4
"        ~/.claude/skills/vaultpilot-preflight",
```

---

### `src/tools/prepare_safe_tx_propose.ts` (EDIT)

**Self-mirror analog:** lines 518-561 (own response-text composition from Phase 37).

**REMOVE — informational `delegatecall: YES` line** at `src/tools/prepare_safe_tx_propose.ts:537-539`:
```typescript
// Inside the `checksPerformed` array — REMOVE these three lines:
...(operationStr === "delegatecall"
  ? ["  delegatecall:     YES — Phase 38 will hard-trigger second-LLM check here (informational at Phase 37)"]
  : []),
```

**ADD — hard-trigger blocks composition + text-join append.** Insert BEFORE the existing `const text = [prepareReceipt, checksPerformed, ledgerDisplay].join("\n\n");` at line 561:
```typescript
// Phase 38 (Inv #12.5) — hard-trigger block composition.
// MODULE ENABLE first (selector-based; narrower), DELEGATECALL second (operation-based; broader).
const hardTriggerBlocks: string[] = [];

// rawData is `data` arg (`string`) — viem-normalize to Hex via `as Hex` cast at the parsing site.
if (isEnableModuleCalldata(rawData as Hex) && rawTo.toLowerCase() === rawSafeAddress.toLowerCase()) {
  let moduleAddress: Address;
  try {
    moduleAddress = decodeEnableModuleCalldata(rawData as Hex).module;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: SafeTx data starts with enableModule selector but argument decode failed; bytes may be malformed (${message})` }],
      structuredContent: errEnvelope(
        "INVALID_INPUT",
        "SafeTx data starts with enableModule selector but argument decode failed; bytes may be malformed",
        message,
      ),
    };
  }
  hardTriggerBlocks.push(
    HARD_TRIGGER_MODULE_ENABLE_TEMPLATE
      .replace("{MODULE_ADDRESS}", moduleAddress)
      .replace("{SAFE_ADDRESS}", rawSafeAddress)
      .replace("{HANDLE}", handle),
  );
}

if (operationStr === "delegatecall") {
  hardTriggerBlocks.push(
    HARD_TRIGGER_DELEGATECALL_TEMPLATE
      .replace("{SAFE_ADDRESS}", rawSafeAddress)
      .replace("{HANDLE}", handle),
  );
}

const text = [prepareReceipt, checksPerformed, ledgerDisplay, ...hardTriggerBlocks].join("\n\n");
```

**Imports — add to top of file** (alongside existing viem + handle-store imports at lines 43-75):
```typescript
import {
  isEnableModuleCalldata,
  decodeEnableModuleCalldata,
  ENABLE_MODULE_SELECTOR,
} from "../protocols/safe.js";
import {
  HARD_TRIGGER_MODULE_ENABLE_TEMPLATE,
  HARD_TRIGGER_DELEGATECALL_TEMPLATE,
} from "../signing/blocks.js";
```

**DESCRIPTION prose update** at `src/tools/prepare_safe_tx_propose.ts:138`:
```typescript
// existing line says "Phase 38 will hard-trigger a second-LLM check here." — update to:
// "Phase 38 hard-triggers a second-LLM check for delegatecall via the [HARD-TRIGGER — DELEGATECALL] block."
```

---

### `src/tools/prepare_safe_tx_approve.ts` (EDIT)

**Self-mirror analog:** lines 386-437 (own response-text composition).

**REMOVE** — informational `delegatecall: YES` line at `src/tools/prepare_safe_tx_approve.ts:409-413`:
```typescript
...(operationStr === "delegatecall"
  ? [
      "  delegatecall:     YES — Phase 38 will hard-trigger second-LLM check here (informational at Phase 37)",
    ]
  : []),
```

**ADD** — same hard-trigger composition as propose. Data + to come from Tx Service fetched at lines 248-251 (variables `data: Hex`, `to: Address` are already in scope). Insert BEFORE `const text = [prepareReceipt, checksPerformed, ledgerDisplay].join("\n\n");` at line 435.

```typescript
const hardTriggerBlocks: string[] = [];

if (isEnableModuleCalldata(data) && to.toLowerCase() === rawSafeAddress.toLowerCase()) {
  let moduleAddress: Address;
  try {
    moduleAddress = decodeEnableModuleCalldata(data).module;
  } catch (err) {
    // ...same structured refusal as propose
  }
  hardTriggerBlocks.push(
    HARD_TRIGGER_MODULE_ENABLE_TEMPLATE
      .replace("{MODULE_ADDRESS}", moduleAddress)
      .replace("{SAFE_ADDRESS}", rawSafeAddress)
      .replace("{HANDLE}", handle),
  );
}

if (operationStr === "delegatecall") {
  hardTriggerBlocks.push(
    HARD_TRIGGER_DELEGATECALL_TEMPLATE
      .replace("{SAFE_ADDRESS}", rawSafeAddress)
      .replace("{HANDLE}", handle),
  );
}

const text = [prepareReceipt, checksPerformed, ledgerDisplay, ...hardTriggerBlocks].join("\n\n");
```

---

### `src/tools/prepare_safe_tx_execute.ts` (EDIT)

**Self-mirror analog:** lines 523-577 (own response-text composition; note the `warnBlock` precedes `prepareReceipt`).

**REMOVE** — informational `delegatecall: YES` line at `src/tools/prepare_safe_tx_execute.ts:538-542`:
```typescript
...(operationStr === "delegatecall"
  ? [
      "  delegatecall:     YES — Phase 38 will hard-trigger second-LLM check for delegatecall (informational at Phase 37).",
    ]
  : []),
```

**ADD** — hard-trigger composition. Variable scope: `safeTxTo`, `safeTxData`, `operationStr` already in scope (lines 293-297). `safeTxData` is the INNER data (where `enableModule` selector match fires). `operationStr` is the INNER operation discriminator (delegatecall trigger).

Insert AFTER `ledgerNotice` definition (line 570) and BEFORE the text-join at lines 572-577:
```typescript
const hardTriggerBlocks: string[] = [];

if (isEnableModuleCalldata(safeTxData) && safeTxTo.toLowerCase() === rawSafeAddress.toLowerCase()) {
  let moduleAddress: Address;
  try {
    moduleAddress = decodeEnableModuleCalldata(safeTxData).module;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: SafeTx data starts with enableModule selector but argument decode failed (${message})` }],
      structuredContent: errEnvelope("INVALID_INPUT", "...", message),
    };
  }
  hardTriggerBlocks.push(
    HARD_TRIGGER_MODULE_ENABLE_TEMPLATE
      .replace("{MODULE_ADDRESS}", moduleAddress)
      .replace("{SAFE_ADDRESS}", rawSafeAddress)
      .replace("{HANDLE}", handle),
  );
}

if (operationStr === "delegatecall") {
  hardTriggerBlocks.push(
    HARD_TRIGGER_DELEGATECALL_TEMPLATE
      .replace("{SAFE_ADDRESS}", rawSafeAddress)
      .replace("{HANDLE}", handle),
  );
}

const text = [
  warnBlock,
  prepareReceipt,
  checksPerformed,
  ledgerNotice,
  ...hardTriggerBlocks,
].join("\n\n");
```

---

### `src/tools/preview_send.ts` (EDIT)

**Self-mirror analog:** lines 1888-1968 (own Phase 37 safe-execute branch).

**ADD** — hard-trigger re-emission INSIDE the existing `if (record.tx.data !== "0x" && record.tx.data.slice(0, 10) === EXEC_TRANSACTION_SELECTOR)` arm. The `innerDecoded` variable is computed at line 1895. Insert AFTER `safeExecWarnBlock` is built at line 1961:

```typescript
// Phase 38 (Inv #12.5) re-emission — defense-in-depth at the execute path
// for the cross-signer scenario (executor's MCP session lacks propose-side state).
let safeHardTriggerBlocks: string[] = [];

if (
  isEnableModuleCalldata(innerDecoded.data) &&
  innerDecoded.to.toLowerCase() === (record.tx.to as string).toLowerCase()
) {
  try {
    const { module } = decodeEnableModuleCalldata(innerDecoded.data);
    safeHardTriggerBlocks.push(
      HARD_TRIGGER_MODULE_ENABLE_TEMPLATE
        .replace("{MODULE_ADDRESS}", module)
        .replace("{SAFE_ADDRESS}", record.tx.to as string)
        .replace("{HANDLE}", handleArg),
    );
  } catch {
    // Truncated inner-calldata — silently skip re-emission at preview
    // (prepare-side already refused; this is defense-in-depth only).
  }
}

if (innerDecoded.operation === 1) {
  safeHardTriggerBlocks.push(
    HARD_TRIGGER_DELEGATECALL_TEMPLATE
      .replace("{SAFE_ADDRESS}", record.tx.to as string)
      .replace("{HANDLE}", handleArg),
  );
}
```

**APPEND** — extend the blocks array at lines 1987-1999. The current shape:
```typescript
const blocks: (string | null)[] = [
  ...(customCallWarnBlock !== null ? [customCallWarnBlock, ""] : []),
  ...(safeExecWarnBlock !== null ? [safeExecWarnBlock, ""] : []),
  ...(ledgerNoticeBlock !== null ? [ledgerNoticeBlock, ""] : []),
  ledgerBlock,
  "",
  agentBlock,
  "",
  fourbyteBlock,
  ...(effectiveDecodedArgsBlock !== "" ? ["", effectiveDecodedArgsBlock] : []),
  // ...
];
```
APPEND hard-trigger blocks at the END (last position for visual prominence — consistent with prepare-side append after ledgerDisplay):
```typescript
const blocks: (string | null)[] = [
  // ... existing entries unchanged ...
  ...safeHardTriggerBlocks.flatMap((b) => ["", b]),
];
```

**Note on numeric vs semantic operation discriminator:** preview_send uses `innerDecoded.operation === 1` (numeric — `DecodedSafeExecTransaction.operation: 0 | 1`), not the semantic string `"delegatecall"` (which only exists on `PreparedTxSafeTypedData.operation` at the prepare-side handle). Per CONTEXT.md §"operation discriminator parsing" line 87: "At execute, map numeric to string at the trigger emission site." The decision in this site is binary (`=== 1` triggers), not a string compare.

---

### `src/security/skill-integrity.ts` (EDIT — REPLACEMENT SHA pin per DF-2)

**Self-mirror analog:** lines 60-61 (the single existing SHA constant).

**REPLACE** — at `src/security/skill-integrity.ts:60-61`:
```typescript
// BEFORE (v1.3.x):
export const EXPECTED_SKILL_SHA256 =
  "28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2";

// AFTER (v1.4):
export const EXPECTED_SKILL_SHA256 =
  "<v1.4 SHA — computed at Plan 38-02-bootstrap-time from sister-repo SKILL.md content>";
```

**Coordinated prose update at three SHA-pin satellite sites:**

1. `src/server.ts:52` (INSTRUCTIONS interpolation) — search for `v1.3.0` → replace with `v1.4`.
2. `src/signing/blocks.ts:758-759` (VAULTPILOT_NOTICE_TEMPLATE_MISSING install one-liner) — `git checkout v1.3.0` → `git checkout v1.4`.
3. `src/signing/blocks.ts:783-785` (VAULTPILOT_NOTICE_TEMPLATE_TAMPERED branch (c)) — `git checkout v1.3.0` → `git checkout v1.4`.

**Single-coordinated-release discipline (load-bearing):** Per `src/security/skill-integrity.ts:17-24` comment, `EXPECTED_SKILL_SHA256` is format-fanout-sentinel SOT; `grep -rl "<hex>" src/` returns exactly 2 files (this constant + `server.ts` template-literal interpolation). Atomic commit: template-file content + SHA constant + prose lines all move together. Plan 09-01 line 90 codifies this — circular SHA otherwise.

---

### `src/tools/get_verification_artifact.ts` (EDIT — extend for `txType` dispatch per A1)

**Self-mirror analog:** lines 84-138 (own lookup + template substitution flow).
**Secondary analog (txType branching):** `preview_send.ts:1981-1986` (effective-block dispatch chain `customCallDecodeBlock !== "" ? customCallDecodeBlock : safeExecDecodeBlock !== "" ? ...`).

**Current state — sentinel-field problem:**
At `src/tools/get_verification_artifact.ts:115-121`, the template substitution reads:
```typescript
const block = PASTEABLE_BLOCK_TEMPLATE
  .replace("{CHAIN_ID}", String(record.tx.chainId))
  .replace("{TO}", record.tx.to)                          // ← sentinel ZERO_ADDRESS for safe-typed-data
  .replace("{VALUE_WEI}", record.tx.valueWei.toString())  // ← sentinel 0n
  .replace("{DATA}", record.tx.data)                      // ← sentinel "0x"
  .replace("{PAYLOAD_FINGERPRINT}", record.payloadFingerprint)
  .replace("{PRESIGN_HASH}", presignHashText);
```

For `PreparedTxSafeTypedData` handles, `record.tx.{to,valueWei,data}` are sentinels — the real SafeTx fields live in `record.tx.safeTxTo`, `record.tx.safeTxValue`, `record.tx.safeTxData`, `record.tx.safeAddress`, `record.tx.safeTxHash`.

**ADD — `txType` dispatch + new `PASTEABLE_BLOCK_TEMPLATE_SAFE`** at `src/signing/blocks.ts` (mirror existing `PASTEABLE_BLOCK_TEMPLATE` shape at lines 811-) with Safe-specific slots:
```typescript
export const PASTEABLE_BLOCK_TEMPLATE_SAFE: string = [
  ">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>",
  "COPY EVERYTHING BETWEEN THESE MARKERS INTO A FRESH CHAT WINDOW",
  "(Safe multisig transaction — EIP-712 typed-data; the bytes below describe what",
  " the Safe will execute when execTransaction lands on-chain.)",
  "",
  "  chainId:            {CHAIN_ID}",
  "  safeAddress:        {SAFE_ADDRESS}",
  "  safeTxTo:           {SAFE_TX_TO}",
  "  safeTxValue (wei):  {SAFE_TX_VALUE}",
  "  safeTxData:         {SAFE_TX_DATA}",
  "  operation:          {OPERATION}",
  "  safeTxHash:         {SAFE_TX_HASH}",
  "  payloadFingerprint: {PAYLOAD_FINGERPRINT}",
  // ...same "Tell the user" instructions as existing template
  "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
].join("\n");
```

**ADD — `txType` dispatch at `get_verification_artifact.ts:115` site.** The `HandleRecord.tx.txType` discriminant distinguishes `PreparedTxEvm` vs `PreparedTxSafeTypedData`. Insert branching:
```typescript
const block = record.tx.txType === "safe-typed-data"
  ? PASTEABLE_BLOCK_TEMPLATE_SAFE
      .replace("{CHAIN_ID}", String(record.tx.chainId))
      .replace("{SAFE_ADDRESS}", record.tx.safeAddress)
      .replace("{SAFE_TX_TO}", record.tx.safeTxTo)
      .replace("{SAFE_TX_VALUE}", record.tx.safeTxValue.toString())
      .replace("{SAFE_TX_DATA}", record.tx.safeTxData)
      .replace("{OPERATION}", record.tx.operation)
      .replace("{SAFE_TX_HASH}", record.tx.safeTxHash)
      .replace("{PAYLOAD_FINGERPRINT}", record.payloadFingerprint)
  : PASTEABLE_BLOCK_TEMPLATE
      .replace("{CHAIN_ID}", String(record.tx.chainId))
      // ... existing EVM substitution
;
```

**Update `structuredContent` to also surface Safe fields** when `txType === "safe-typed-data"`:
```typescript
const structuredContent =
  record.tx.txType === "safe-typed-data"
    ? {
        safeAddress: record.tx.safeAddress,
        safeTxTo: record.tx.safeTxTo,
        safeTxValue: record.tx.safeTxValue.toString(),
        safeTxData: record.tx.safeTxData,
        operation: record.tx.operation,
        safeTxHash: record.tx.safeTxHash,
        chainId: record.tx.chainId,
        payloadFingerprint: record.payloadFingerprint,
      }
    : {
        // existing EVM shape unchanged
      };
```

**Scope:** ~30 lines per RESEARCH § Topic 3 / A1. Researcher recommendation INCLUDED in Plan 38-01 per locked planning-gate decision.

---

### `SECURITY.md` (EDIT — append new `## Phase 38` section)

**Self-mirror analog:** `SECURITY.md` Phase 32 section at lines 544-572 (most recent milestone-close-out shape).

**Section heading pattern** — `SECURITY.md:544`:
```markdown
## Phase 32 — Uniswap V3 swap (v2.4)
```
Phase 38 ships:
```markdown
## Phase 38 — `enableModule` + delegatecall hard-trigger second-LLM check (Inv #12.5) + v2.5 close-out
```

**Narrative-paragraph pattern** — Phase 32 ships four narrative paragraphs (lines 546-566), each documenting one design tradeoff with the load-bearing CONTEXT decision reference. Phase 38 mirrors with paragraphs covering:
1. Inv #12.5 trigger conditions (selector match + `delegatecall` discriminator).
2. Emission sites and skill-side enforcement coupling (load-bearing decoupling story).
3. Ledger CAL coverage gap cross-link (Phase 37 accepted residual; Phase 38 hard-trigger IS the defense).
4. v2.5 milestone close-out summary (Phase 36 + 37 + 38 trust-pipeline shape; verify-phase pending).

**Threat register table pattern** — `SECURITY.md:568-572` (Phase 32 threat table):
```markdown
### Phase 32 threat register summary

| Threat ID | STRIDE | Severity | Disposition | Mitigation |
|-----------|--------|----------|-------------|------------|
| T-32-SANDWICH-MEV-BYPASS | Tampering | HIGH | mitigate | ... |
| T-FROZEN-32 | Tampering | CRITICAL | mitigate | Zero-diff invariant on ... |
```

Phase 38 ships the parallel table — anchors lifted from RESEARCH § Topic 7:
- `T-INV-12.5-NON-SKILL-1` (Information Disclosure, MEDIUM, accept) — non-skill-using agent ignores block.
- `T-MODULE-ENABLE-MALICIOUS-1` (Elevation of Privilege, HIGH, mitigate).
- `T-DELEGATECALL-UPGRADE-ATTACK-1` (Elevation of Privilege, HIGH, mitigate).
- `T-COMPOSITE-EMISSION-DRIFT-1` (Tampering, MEDIUM, mitigate).
- `T-FROZEN-SIGNING-38` (Tampering, CRITICAL, mitigate) — zero-diff on `payload-fingerprint.ts` / `handle-store.ts` state machine / `send_transaction.ts` three gates / SAFE-A/B/C/D fixtures.
- `T-SKILL-V14-COORDINATION-1` (Tampering, MEDIUM, mitigate).

**Closing-paragraph pattern** — Phase 32's closing paragraph (last paragraph of SECURITY.md currently) names verify-phase requirement: "The v2.4 verify-phase remains pending a real-Ledger Ethereum-app smoke ...". Phase 38 names v2.5 verify-phase requirement per RESEARCH § Topic 10: real-Ledger mainnet 1-of-1 Safe propose → submit → execute with hard-trigger block traversal + second-LLM ritual on a sentinel "no-op" module.

---

### Plan 38-02 — Sister-repo `vaultpilot-preflight-skill/SKILL.md`

**OUT OF MAIN-REPO SCOPE.** Plan 38-02 ships ONLY to sister `szhygulin/vaultpilot-preflight-skill` repo per strict-sequential ordering after Plan 38-01. **NOT part of Plan 38-01 file inventory; documented here for cross-reference.**

**Primary analog:** `.planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md` (main-repo planning-time template).

**Insertion point:** Between Step 0 (mandatory integrity self-check) and Step 1 (Inv #2.5 chain explicit) per RESEARCH § Topic 6. New section heading `## Step 0.5 — Inv #12.5: Safe high-blast-radius operation hard-trigger detection`. Decimal numbering matches existing non-contiguous Inv #2.5 / Inv #6b precedent.

**HALT-condition prose pattern** — RESEARCH § Topic 6 lines 305-338 provides the full recommended block text. Three-condition gate (a) get_verification_artifact called, (b) artifact surfaced verbatim, (c) user confirms — followed by emit-verbatim `DO NOT SIGN.` on incomplete.

**Sister-repo target confirmation (locked at planning gate):** A4 confirmed — `vaultpilot-preflight-skill` is the canonical sister repo (NOT `vaultpilot-security-skill`).

---

## Shared Patterns

### APPEND-ONLY block template emission at tool response composition

**Source:** Every Phase 37 prepare_safe_tx_* tool composes response text as `[block1, block2, block3].join("\n\n")`.

**Concrete excerpts:**
- `prepare_safe_tx_propose.ts:561`: `const text = [prepareReceipt, checksPerformed, ledgerDisplay].join("\n\n");`
- `prepare_safe_tx_approve.ts:435`: `const text = [prepareReceipt, checksPerformed, ledgerDisplay].join("\n\n");`
- `prepare_safe_tx_execute.ts:572-577`: `const text = [warnBlock, prepareReceipt, checksPerformed, ledgerNotice].join("\n\n");`

**Apply to:** All three Phase 38 emission sites. Hard-trigger blocks APPEND-ONLY at end of the join (composite emits MODULE ENABLE first, then DELEGATECALL — per CONTEXT lock). Net change at each tool: one short line goes away from CHECKS PERFORMED; one or two full multi-line blocks appear at end-of-text.

### Structured refusal on malformed calldata (Plan 38-01 truncated-enableModule path)

**Source:** `src/tools/prepare_safe_tx_propose.ts:585-601` (existing INTERNAL_ERROR catch-all envelope shape).

**Concrete excerpt** at `prepare_safe_tx_propose.ts:585-601`:
```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `error: prepare_safe_tx_propose failed: ${message}`,
      },
    ],
    structuredContent: errEnvelope(
      "INTERNAL_ERROR",
      "prepare_safe_tx_propose failed",
      message,
    ),
  };
}
```

**Apply to:** Truncated-enableModule-calldata refusal in Phase 38 emission sites. Use `INVALID_INPUT` errorCode (not `INTERNAL_ERROR`) since the cause is malformed input per CONTEXT.md §"enableModule calldata parsing" line 81.

### Format-fanout-sentinel SOT discipline (CLAUDE.md convention)

**Source:** `src/security/skill-integrity.ts:17-24` comment (existing SHA pin SOT).

**Concrete excerpt:**
```typescript
// EXPECTED_SKILL_SHA256 is the format-fanout-sentinel SOT for the SHA pin —
// `grep -c <hex>` across `src/` returns 1 in this file plus 1 in
// `src/server.ts` (the INSTRUCTIONS interpolation surfaces the constant to
// the agent at `initialize` time for the skill's Step 0 self-check).
```

**Apply to:**
- `ENABLE_MODULE_SELECTOR = "0x610b5925"` lives in `src/protocols/safe.ts` exactly once.
- `HARD_TRIGGER_MODULE_ENABLE_TEMPLATE` + `HARD_TRIGGER_DELEGATECALL_TEMPLATE` block titles `[HARD-TRIGGER — MODULE ENABLE]` / `[HARD-TRIGGER — DELEGATECALL]` live in `src/signing/blocks.ts` exactly once each.
- The skill-side scan keys on these literal titles — drift breaks Inv #12.5 enforcement coupling.

### ESM spy-affordance indirection (CLAUDE.md convention)

**Source:** `src/protocols/erc20.ts:175-180` (`_protocols`), `src/security/skill-integrity.ts:146` (`_skillIntegrity`).

**Concrete excerpts:**
```typescript
// erc20.ts:175-180
export const _protocols = { decodeErc20Call };

// skill-integrity.ts:146
export const _skillIntegrity = { checkSkillIntegrity };
```

**Apply to:** Phase 38 SKIP this indirection for `src/protocols/safe.ts` (no internal cross-calls between exports; tests can directly call `isEnableModuleCalldata` / `decodeEnableModuleCalldata` as named imports). The indirection is only load-bearing when one export calls another within the same module — `safe.ts` is leaf code.

### Cryptographic-binding fixture discipline (CLAUDE.md convention)

**Source:** `test/protocols-erc20.test.ts:48-63` (Fixture B byte-identity); `test/signing-safe-exec-decode.test.ts:32-55` (round-trip pattern).

**Apply to:** Fixture SAFE-G in `test/protocols-safe.test.ts` (already computed via viem 2.48.11 per RESEARCH § Topic 9):
- Hardcoded literal `FIXTURE_SAFE_G_CALLDATA = "0x610b5925000000000000000000000000cafe0000000000000000000000000000cafe0001"`.
- NO `beforeAll`-snapshot — drift must fail at a specific line.
- Cross-link comment naming dependencies (selector match + decoder round-trip + isEnableModuleCalldata predicate).
- Lowercased module address (bypass viem EIP-55 throw; same as Fixture SAFE-B Rule 1 deviation).

### Per-protocol module header documentation pattern

**Source:** Every `src/protocols/*.ts` file opens with a multi-paragraph header documenting (a) module purpose, (b) consumers list, (c) SDK reality verification, (d) format-fanout-sentinel SOT discipline.

**Concrete excerpts:**
- `src/protocols/weth9.ts:1-23` (the closest scale-match analog).
- `src/protocols/aave-v3.ts:1-26`.
- `src/protocols/erc20.ts:1-25`.

**Apply to:** `src/protocols/safe.ts` header at write time. Name Phase 38 + Plan 38-01 + SAFE-09. Name consumers (`prepare_safe_tx_propose / _approve / _execute / preview_send`). Verify viem 2.48.11 selector computation. Name format-fanout-sentinel: `ENABLE_MODULE_SELECTOR` lives here exactly once.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every Phase 38 file has a strong analog in the existing codebase. The hard-trigger pattern is novel only in its trigger semantics (a defense-in-depth instruction-to-agent block); the response-composition + template-constant + per-protocol-decoder + SHA-pin-bump shapes are all established conventions extended by this phase. |

## Metadata

**Analog search scope:**
- `src/protocols/` (20 files — protocol decoders)
- `src/signing/` (focused on `blocks.ts` template constants, `safe-exec-decode.ts`, `handle-store.ts`)
- `src/tools/` (focused on `prepare_safe_tx_*.ts`, `preview_send.ts`, `get_verification_artifact.ts`)
- `src/security/` (focused on `skill-integrity.ts`)
- `test/` (focused on `protocols-*.test.ts`, `prepare-safe-tx-*.test.ts`, `preview-send.safe-execute.test.ts`, `security-skill-integrity.test.ts`)
- `SECURITY.md` (Phase 32 section as most-recent-milestone analog)
- `.planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md` (for Plan 38-02 cross-reference)

**Files scanned (read in detail):** ~15 source files + ~5 test files + SECURITY.md tail + 38-CONTEXT.md (full) + 38-RESEARCH.md (full)

**Pattern extraction date:** 2026-05-27

---

*Phase: 38-safe-enable-module-delegate-call-second-llm*
*Patterns mapped: 2026-05-27*
