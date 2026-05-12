import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildServer } from "../../src/server.js";

export interface SpawnedServer {
  client: Client;
  close: () => Promise<void>;
}

export async function spawnServerInProcess(): Promise<SpawnedServer> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = buildServer();
  await server.connect(serverTransport);

  const client = new Client(
    { name: "vaultpilot-mcp-test-client", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
