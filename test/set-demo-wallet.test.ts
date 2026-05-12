// Plan 05-01 — set_demo_wallet tool tests (DEMO-04).
//
// Six tests with the load-bearing SDK-pipeline schema-enum gate test
// (Test 4) mirroring the methodology Phase 4 04-04 send_transaction Test 1a
// established:
//   1. happy path — env=true → set whale → state mutated
//   2. switch persona — second call wins
//   3. WRONG_MODE in real mode (T-PERSONA-CONFUSION-1)
//   4. SDK-pipeline schema-enum gate (LOAD-BEARING) — dispatch via
//      buildServer + spawn-server-in-process; assert handler spy at 0
//      AND JSON-RPC -32602 InvalidParams
//   5. in-handler INVALID_INPUT fallback (defense-in-depth)
//   6. TS-narrowing @ts-expect-error block (compile-time defense)
//   7. register-all wiring smoke

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  getActivePersona,
} from "../src/demo/state.js";
import type { Persona } from "../src/demo/personas.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

import { spawnServerInProcess, type SpawnedServer } from "./helpers/spawn-server.js";

// Trigger side-effect registration for ALL tools so the registry is populated
// for both direct-handler tests AND the buildServer dispatch test.
await import("../src/tools/register-all.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("set_demo_wallet");
  if (!tool) throw new Error("set_demo_wallet not registered");
  return tool.handler(args);
}

beforeEach(() => {
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

describe("set_demo_wallet — happy path (DEMO-04 Test 1)", () => {
  it("Test 1 — VAULTPILOT_DEMO=true + persona='whale' → success, state mutated", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callTool({ persona: "whale" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      active: { slug: string; address: string; description: string };
    };
    expect(sc.active.slug).toBe("whale");
    expect(sc.active.address).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(getActivePersona()?.slug).toBe("whale");

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/active persona set/);
    expect(text).toMatch(/whale/);
  });
});

describe("set_demo_wallet — switch persona (Test 2)", () => {
  it("Test 2 — two calls with different slugs: second call wins", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    await callTool({ persona: "whale" });
    expect(getActivePersona()?.slug).toBe("whale");

    await callTool({ persona: "stable-saver" });
    expect(getActivePersona()?.slug).toBe("stable-saver");
  });
});

describe("set_demo_wallet — WRONG_MODE in real mode (T-PERSONA-CONFUSION-1)", () => {
  it("Test 3 — env=false + call → WRONG_MODE envelope; state NOT mutated", async () => {
    // beforeEach already set env=false and reset cache.
    expect(getActivePersona()).toBeNull();

    const result = await callTool({ persona: "whale" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);
    expect(text).toMatch(/VAULTPILOT_DEMO/);

    // Critical T-PERSONA-CONFUSION-1 mitigation assertion: state NOT
    // mutated when the mode check fires. A future contributor that
    // reorders the mode check below the setActivePersona call would
    // silently mutate state across the demo/real boundary.
    expect(getActivePersona()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 4 — LOAD-BEARING: SDK-pipeline schema-enum gate
//
// Dispatches a CallTool request with persona: "unknown-slug" through the
// actual MCP SDK in-process pipeline (spawn-server-in-process). The handler
// MUST NEVER be invoked — the schema gate at src/server.ts rejects at the
// protocol boundary with JSON-RPC error code -32602 (InvalidParams).
//
// This is NOT a tautology test of "the ajv schema-as-written rejects unknown
// slugs" — it proves the PRODUCTION dispatcher's validator + the registered
// tool's inputSchema together produce the protocol-level rejection. Same
// methodology as test/send-transaction.test.ts Test 1a.
// ---------------------------------------------------------------------------
describe("set_demo_wallet — Test 4 SDK-pipeline schema-enum gate (LOAD-BEARING)", () => {
  it("(4) dispatch via buildServer with unknown slug → handler spy at 0; JSON-RPC -32602", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();

    // Install a handler spy on the registered tool BEFORE spawning so
    // the dispatcher's lookup-by-name finds the spied wrapper.
    const tool = getRegisteredTool("set_demo_wallet");
    if (!tool) throw new Error("set_demo_wallet not registered");
    const originalHandler = tool.handler;
    const handlerSpy = vi.fn(originalHandler);
    tool.handler = handlerSpy;

    let spawned: SpawnedServer | undefined;
    try {
      spawned = await spawnServerInProcess();
      let caught: unknown;
      try {
        await spawned.client.callTool({
          name: "set_demo_wallet",
          arguments: { persona: "unknown-slug" },
        });
      } catch (err) {
        caught = err;
      }

      // The SDK pipeline surfaces InvalidParams (-32602) as a JSON-RPC
      // error on the client side. We accept either the literal code
      // OR a message that matches the schema-violation shape, mirroring
      // the tolerance in test/send-transaction.test.ts Test 1a.
      expect(caught).toBeDefined();
      const errObj = caught as { code?: number; message?: string };
      const hasInvalidParamsCode = errObj.code === -32602;
      const hasSchemaErrorMessage =
        typeof errObj.message === "string" &&
        /enum|persona|invalid arguments/i.test(errObj.message);
      expect(hasInvalidParamsCode || hasSchemaErrorMessage).toBe(true);

      // Load-bearing assertion: the handler MUST NEVER be invoked when
      // schema validation fails. Proves the gate is schema-level, not
      // a soft check inside the handler.
      expect(handlerSpy).toHaveBeenCalledTimes(0);

      // Active persona state must also be untouched.
      expect(getActivePersona()).toBeNull();
    } finally {
      tool.handler = originalHandler;
      if (spawned) await spawned.close();
    }
  });
});

describe("set_demo_wallet — Test 5 in-handler INVALID_INPUT defense-in-depth", () => {
  it("(5) direct handler call with unknown slug → INVALID_INPUT (bypasses SDK gate)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    // Bypass the SDK pipeline by calling the handler directly. The
    // ajv gate at src/server.ts:55-66 never runs; we're exercising the
    // handler's `PERSONAS.find` defense-in-depth check.
    const result = await callTool({ persona: "unknown-slug" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/unknown persona/);
    expect(text).toMatch(/get_demo_wallet/);

    // State NOT mutated.
    expect(getActivePersona()).toBeNull();
  });
});

describe("set_demo_wallet — Test 6 TS narrowing (compile-time defense)", () => {
  it("(6) Persona['slug'] union rejects unknown literals at type level", () => {
    // @ts-expect-error — proves Persona["slug"] union rejects unknown literals at type level.
    const _bad: Persona["slug"] = "unknown-slug";
    void _bad;

    // Valid literals satisfy the type.
    const ok: Persona["slug"] = "whale" satisfies Persona["slug"];
    expect(ok).toBe("whale");

    // Compile-time defense: if a future contributor widens slug to
    // `string` or to a broader union, the `@ts-expect-error` above
    // fires (TS sees no error to expect) and the build breaks. Completes
    // the 3-sub-assertion mirror of Phase 4 send_transaction Test 1
    // (SDK pipeline runtime + handler-direct INVALID_INPUT + TS narrowing).
  });
});

describe("set_demo_wallet — register-all wiring (smoke)", () => {
  it("Test 7 — both demo tools wired by register-all.ts", () => {
    // The top-of-file `await import("../src/tools/register-all.js")`
    // already triggered side-effect registration for both demo tools.
    // ESM module cache prevents re-importing for re-registration here,
    // so we assert the registration outcome directly.
    expect(getRegisteredTool("get_demo_wallet")).toBeDefined();
    expect(getRegisteredTool("set_demo_wallet")).toBeDefined();
    void _resetRegistryForTesting; // referenced for consistency
  });
});
