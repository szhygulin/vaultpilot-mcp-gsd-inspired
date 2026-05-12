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

export function getWalletConnectProjectId(): string | undefined {
  return read("WALLETCONNECT_PROJECT_ID");
}

/**
 * Demo-mode predicate. Phase 3 ships the minimum-viable shape — literal
 * `"true"` only, per the DEMO-01 spec ("strict opt-in, environment variable
 * is the only signal"). Phase 5 replaces the body with the full env >
 * config > auto-detect resolution; the signature stays stable so 03-02 +
 * Phase 4 tools that call this never need to change.
 *
 * Returns `false` for every value that is not literally the string `"true"`,
 * including `"True"`, `"1"`, `"yes"`, and `undefined`. We intentionally do
 * NOT route through `read()` (which trims + treats empty-string as unset)
 * because DEMO-01 mandates literal-string match.
 */
export function isDemoMode(): boolean {
  return process.env.VAULTPILOT_DEMO === "true";
}
