#!/usr/bin/env node

import { runCheck } from "./diagnostics/check.js";
import { startServer } from "./server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--check")) {
    const json = args.includes("--json");
    const exitCode = await runCheck({ json });
    process.exit(exitCode);
  }

  if (args.includes("--version") || args.includes("-v")) {
    const { version } = await import("../package.json", { with: { type: "json" } });
    process.stdout.write(`${version}\n`);
    process.exit(0);
  }

  await startServer();
}

main().catch((err) => {
  process.stderr.write(`[fatal] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
