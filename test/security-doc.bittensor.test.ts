// Phase 49 Plan 49-01 — SECURITY.md ## v2.7 Bittensor close-out content assertion.
//
// Pins that the v2.7 Bittensor milestone close-out section exists in
// SECURITY.md and carries its load-bearing trust anchors. Uses multiple
// targeted `.toMatch(/.../)` calls (per CLAUDE.md: prefer multiple targeted
// matches over one big `.toContain` for multi-line doc assertions).
//
// Asserted anchors:
//   - the `## v2.7 Bittensor` heading
//   - the `CheckMetadataHash` chain-enforced integrity trust anchor
//   - a blind-sign-residual phrase (the accepted ship-with-blind-sign residual)
//   - a verify-phase-scope phrase (the v2.7 verify-phase boundary)
//
// These fail RED until Task 4 adds the section (Wave 0 / interface-first).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SECURITY_MD = readFileSync(join(process.cwd(), "SECURITY.md"), "utf-8");

describe("SECURITY.md — ## v2.7 Bittensor milestone close-out", () => {
  it("has the v2.7 Bittensor close-out heading", () => {
    expect(SECURITY_MD).toMatch(/##\s+v2\.7 Bittensor/);
  });

  it("names the CheckMetadataHash chain-enforced integrity anchor", () => {
    expect(SECURITY_MD).toMatch(/CheckMetadataHash/);
  });

  it("documents the accepted ship-with-blind-sign residual", () => {
    expect(SECURITY_MD).toMatch(/blind[- ]sign/i);
  });

  it("documents the v2.7 verify-phase scope boundary", () => {
    expect(SECURITY_MD).toMatch(/verify[- ]phase/i);
  });
});
