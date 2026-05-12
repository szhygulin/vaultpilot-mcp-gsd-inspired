import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PUBLICNODE_ETHEREUM_RPC_URL,
  _resetEthereumClientForTesting,
  getEthereumClient,
  isPublicNodeFallback,
} from "../src/chains/ethereum.js";

const ENV_KEY = "ETHEREUM_RPC_URL";
let savedEnv: string | undefined;
let stderrBuf: string;
let originalStderrWrite: typeof process.stderr.write;

function captureStderr(): void {
  stderrBuf = "";
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown): boolean => {
    stderrBuf += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  }) as typeof process.stderr.write;
}

function restoreStderr(): void {
  process.stderr.write = originalStderrWrite;
}

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  _resetEthereumClientForTesting();
  captureStderr();
});

afterEach(() => {
  restoreStderr();
  if (savedEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = savedEnv;
  }
  _resetEthereumClientForTesting();
});

describe("getEthereumClient", () => {
  it("uses PublicNode when ETHEREUM_RPC_URL is unset", () => {
    const client = getEthereumClient();
    expect(client).toBeDefined();
    expect(isPublicNodeFallback()).toBe(true);
    expect(client.transport.url).toBe(PUBLICNODE_ETHEREUM_RPC_URL);
  });

  it("uses ETHEREUM_RPC_URL override when set", () => {
    const custom = "https://eth.example.com/abc";
    process.env[ENV_KEY] = custom;
    const client = getEthereumClient();
    expect(isPublicNodeFallback()).toBe(false);
    expect(client.transport.url).toBe(custom);
  });

  it("ignores blank ETHEREUM_RPC_URL and falls back to PublicNode", () => {
    process.env[ENV_KEY] = "   ";
    const client = getEthereumClient();
    expect(isPublicNodeFallback()).toBe(true);
    expect(client.transport.url).toBe(PUBLICNODE_ETHEREUM_RPC_URL);
  });

  it("memoizes the client across calls", () => {
    const a = getEthereumClient();
    const b = getEthereumClient();
    expect(a).toBe(b);
  });

  it("emits the PublicNode fallback warning exactly once per process", () => {
    getEthereumClient();
    getEthereumClient();
    getEthereumClient();
    const matches = stderrBuf.match(/PublicNode public RPC/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("does not emit the fallback warning when override is set", () => {
    process.env[ENV_KEY] = "https://eth.example.com/abc";
    getEthereumClient();
    expect(stderrBuf).not.toMatch(/PublicNode public RPC/);
  });
});
