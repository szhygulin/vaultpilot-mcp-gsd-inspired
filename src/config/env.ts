function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function getEthereumRpcUrl(): string | undefined {
  return read("ETHEREUM_RPC_URL");
}

export function getRpcProvider(): string | undefined {
  return read("RPC_PROVIDER");
}

export function getRpcApiKey(): string | undefined {
  return read("RPC_API_KEY");
}
