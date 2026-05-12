import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { spawnServerInProcess, type SpawnedServer } from "./helpers/spawn-server.js";

describe("server bootstrap", () => {
  let spawned: SpawnedServer;

  beforeEach(async () => {
    spawned = await spawnServerInProcess();
  });

  afterEach(async () => {
    await spawned.close();
  });

  it("advertises name and version after initialize", () => {
    const info = spawned.client.getServerVersion();
    expect(info?.name).toBe("vaultpilot-mcp");
    expect(info?.version).toBeTypeOf("string");
  });

  it("returns the instructions field with the trust-anchor language and SECURITY.md link", () => {
    const instructions = spawned.client.getInstructions();
    expect(instructions).toBeDefined();
    expect(instructions).toMatch(/Ledger/);
    expect(instructions).toMatch(/SECURITY\.md/);
  });

  it("advertises tools capability and lists registered tools", async () => {
    const caps = spawned.client.getServerCapabilities();
    expect(caps?.tools).toBeDefined();

    const result = await spawned.client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    // Phase 2 (02-04) registers four standalone read tools. Other Phase 2 PRs
    // (02-02 token registry, 02-03 portfolio summary) add more on top.
    expect(names).toEqual(
      expect.arrayContaining([
        "get_token_balance",
        "get_transaction_status",
        "resolve_ens_name",
        "reverse_resolve_ens",
      ]),
    );
  });
});
