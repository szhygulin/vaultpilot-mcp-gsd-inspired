# ADR-0003: Defer companion `vaultpilot-preflight` skill to v1.3

**Status:** Accepted (2026-05-12)
**Context:** Initial project scaffolding

## Decision

The companion `vaultpilot-preflight` Claude Code skill is deferred to v1.3 (the dedicated hardening milestone). v1.0–v1.2 ship without it.

## Rationale

The companion skill is the load-bearing defense against the **compromised-MCP** threat scenario where the server silently omits its own `CHECKS PERFORMED` directives. It lives on the user's disk, independent of the server's release pipeline, and encodes static rules (Inv #1, #2, #2.5, #5, #11) the agent runs regardless of what the MCP says.

But the skill is **a separate distribution surface** with its own integrity-pin loop:

1. The skill carries an in-file integrity sentinel (e.g. `_v8_4aac027a9df315a9`)
2. The MCP pins the expected SHA-256 of the skill in its server-level `instructions` field
3. On every signing flow, the agent runs `sha256sum ~/.claude/skills/vaultpilot-preflight/SKILL.md` and compares to the pin
4. Skill releases must coordinate with MCP releases — bumping the sentinel without bumping the MCP's pin (or vice versa) breaks signing flows in production

Adding this loop *while the MCP itself is still validating its trust pipeline* doubles the moving parts. A bug in the pinning loop during v1.0 (when there's nothing to actually defend against, because the MCP is the only thing in flight) is harder to debug than a bug in the same loop during v1.3 (when the MCP is stable and the skill is the variable being changed).

## Consequences

**v1.0–v1.2 documented residual risk:**

- A compromised MCP can omit `CHECKS PERFORMED` blocks; cooperating agent has no static rule to fall back on
- Mitigated partially by the trust pipeline (`PREPARE RECEIPT` is in the response itself, not in a separately-emitted block; the MCP can't drop it without breaking the protocol)
- Mitigated fully on the device side (`LEDGER BLIND-SIGN HASH` is a separate block but the user's defense is matching the device-displayed value, which is independent of what blocks the MCP did or didn't emit)

**SECURITY.md from day one** documents this residual risk explicitly. Users running v1.0 on real funds should understand that defense-in-depth is shallower than v1.3 will be.

**v1.3 ships skill + MCP pin in lockstep** (Phase 9 plan 09-01 for the skill, 09-02 for the pin), with regression tests covering the integrity-check failure modes.

## Revisit triggers

- If a v1.0–v1.2 user is exposed to a real compromised-MCP attack scenario before v1.3 ships → revisit; consider an emergency v1.0.1 with a minimal skill ship
- If the skill's interface diverges enough between v1.3 design and v1.0 expectations → may need an interim "skill present but advisory-only" mode
