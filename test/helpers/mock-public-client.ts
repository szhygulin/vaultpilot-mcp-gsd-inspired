// Mock for viem's public-client action surface used across Phase 4 unit tests.
//
// SINGLE SOURCE OF TRUTH for viem-action mocking in Phase 4 —
// `test/signing-handle-store.test.ts`, downstream tests for
// `prepare_native_send`, `preview_send`, `send_transaction`, and
// `get_tx_verification` all consume it.
//
// Mocking strategy reference: see 04-RESEARCH.md § Validation Architecture
// (lines 1115–1119). The helper exposes the four viem-action surfaces the
// Phase 4 tools read — `getTransactionCount`, `estimateFeesPerGas`,
// `estimateGas`, `call` — as `vi.fn()` spies that return scripted values
// set via the `_setNonce` / `_setFees` / `_setGasEstimate` /
// `_setCallResponse` driver methods. Each `_set*` method OVERWRITES the
// prior scripted value (last-write wins).
//
// The factory does NOT install `vi.mock("viem/actions", ...)` itself —
// each test file does that in its top-level scope so a test can opt out
// (e.g. a fingerprint-pure-fn test doesn't need any RPC mocking).
//
// Consumption pattern in downstream test files:
//
//   const mock = createMockPublicClient();
//   vi.mock("viem/actions", () => ({
//     getTransactionCount: mock.__spies.getTransactionCount,
//     estimateFeesPerGas: mock.__spies.estimateFeesPerGas,
//     estimateGas: mock.__spies.estimateGas,
//     call: mock.__spies.call,
//   }));
//   mock._setNonce(7);
//   mock._setFees({ maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_500_000_000n });
//   mock._setGasEstimate(21_000n);
//   // ... drive code under test, then assert against mock.__spies.* call args.

import { vi } from "vitest";
import type { Hex } from "viem";

/**
 * A scenario-scripted mock for viem's public-client action surface, plus
 * driver methods to script per-test values.
 */
export interface MockPublicClient {
  /** Spies exposed for `vi.mock("viem/actions", ...)` wiring + call-arg assertions. */
  __spies: {
    getTransactionCount: ReturnType<typeof vi.fn>;
    estimateFeesPerGas: ReturnType<typeof vi.fn>;
    estimateGas: ReturnType<typeof vi.fn>;
    call: ReturnType<typeof vi.fn>;
  };

  /** Script the value the next `getTransactionCount(...)` returns. */
  _setNonce(n: number): void;
  /** Script the values the next `estimateFeesPerGas(...)` returns. */
  _setFees(opts: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }): void;
  /** Script the value the next `estimateGas(...)` returns. */
  _setGasEstimate(g: bigint): void;
  /** Script the hex the next `call(...)` returns (for DEMO-05 simulation in Plan 04-04). */
  _setCallResponse(hex: Hex): void;
}

/**
 * Build a fresh `MockPublicClient`. Each call returns a brand-new instance
 * with brand-new `vi.fn()` spies — call once per test file (or per
 * `beforeEach` if test cross-contamination is a concern).
 */
export function createMockPublicClient(): MockPublicClient {
  let nonce: number = 0;
  let fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } = {
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
  };
  let gasEstimate: bigint = 0n;
  let callResponse: Hex = "0x";

  const mock: MockPublicClient = {
    __spies: {
      getTransactionCount: vi.fn(async (_client: unknown, _params: unknown) => nonce),
      estimateFeesPerGas: vi.fn(async (_client: unknown, _params: unknown) => fees),
      estimateGas: vi.fn(async (_client: unknown, _params: unknown) => gasEstimate),
      call: vi.fn(async (_client: unknown, _params: unknown) => ({ data: callResponse })),
    },
    _setNonce: (n) => {
      nonce = n;
    },
    _setFees: (opts) => {
      fees = { maxFeePerGas: opts.maxFeePerGas, maxPriorityFeePerGas: opts.maxPriorityFeePerGas };
    },
    _setGasEstimate: (g) => {
      gasEstimate = g;
    },
    _setCallResponse: (hex) => {
      callResponse = hex;
    },
  };

  return mock;
}
