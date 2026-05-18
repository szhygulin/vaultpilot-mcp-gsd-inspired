// src/cli/setup.ts — Phase 10 / Plan 10-03 (DIST-42).
//
// `vaultpilot-mcp setup` subcommand entry point. Routes to the interactive
// `@clack/prompts` wizard (`setup-prompts.ts`) by default, or to the
// non-interactive stdin/JSON reader (`setup-non-interactive.ts`) when
// `--non-interactive` is passed.
//
// Conditional dynamic imports (`await import(...)`) keep the `@clack/prompts`
// dependency off the load path when the caller never reaches the
// interactive code — useful when the wizard is driven from a CI pipeline,
// the binary installer (Plan 10-02), or a containerized environment where
// TTY libs would just bloat cold-start.
//
// Mirror of `src/diagnostics/check.ts::runCheck()` shape: parse flags →
// dispatch → return exit code. The two inner runners build their own
// InstallEnvelopes (each path knows which CheckIds it emits) and the exit
// code surfaces the highest-level status.

export interface SetupCliFlags {
  nonInteractive: boolean;
  dryRun: boolean;
  jsonMode: boolean;
}

export function parseSetupFlags(args: string[]): SetupCliFlags {
  return {
    nonInteractive: args.includes("--non-interactive"),
    dryRun: args.includes("--dry-run"),
    jsonMode: args.includes("--json"),
  };
}

export async function runSetup(args: string[]): Promise<number> {
  const flags = parseSetupFlags(args);

  if (flags.nonInteractive) {
    const { runNonInteractive } = await import("./setup-non-interactive.js");
    return runNonInteractive({
      args,
      dryRun: flags.dryRun,
      jsonMode: flags.jsonMode,
    });
  }

  const { runInteractive } = await import("./setup-prompts.js");
  return runInteractive({
    args,
    dryRun: flags.dryRun,
    jsonMode: flags.jsonMode,
  });
}
