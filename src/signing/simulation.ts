// Wide eth_call preview-time simulation helper. DF-1 LOCKED — research § Topic 9
// Option B.
//
// Lives on the `src/signing/` shelf alongside other preview-time concerns
// (presign-hash, payload-fingerprint, handle-store). Consumed by:
//   - src/tools/preview_send.ts        (Plan 06-02 — this plan)
//   - src/tools/prepare_token_approve.ts via preview_send (Plan 06-03 — transitive)
//   - src/tools/prepare_weth_unwrap.ts  via preview_send (Plan 06-04 — transitive)
//
// Defense-in-depth uniform: the helper runs for ALL tx shapes including
// native sends (Phase 4 retroactive benefit) — every preview emits a
// SIMULATION block so the user can spot guaranteed-revert transactions
// (e.g. transfer with insufficient balance, approve on a non-ERC-20 address)
// before being asked to blind-sign.
//
// TRUST-BOUNDARY INVARIANT: the SIMULATION block is a USABILITY signal,
// NEVER the trust anchor. The trust anchor remains the device hash match
// (Fixture C `presignHash` vs the LEDGER BLIND-SIGN HASH block). A
// `status: "revert"` result is informational; the user can still proceed.
//
// NON-BLOCKING INVARIANT: the helper is wrapped in try/catch that demotes
// RPC failures to `status: "error"`. The helper NEVER throws — preview_send
// emits the LEDGER + AGENT TASK + 4byte blocks regardless of whether the
// simulation succeeds. T-SIMULATION-RPC-FAIL-1 mitigation.

import type { Address, Hex, PublicClient } from "viem";
import { call } from "viem/actions";

export type SimulationStatus = "ok" | "revert" | "error";

export interface SimulationResult {
  /** `ok` if eth_call succeeded; `revert` if it reverted with a visible reason; `error` for RPC/network failures. */
  status: SimulationStatus;
  /** Hex return data on `ok`; `null` on revert/error. */
  resultData: Hex | null;
  /** Verbatim error message on revert/error; `null` on ok. */
  errorMessage: string | null;
}

/**
 * Run a preview-time eth_call against the configured RPC for the prepared
 * transaction. NEVER throws — every input shape returns a `SimulationResult`.
 *
 * On success (eth_call returns) → `{ status: "ok", resultData, errorMessage: null }`.
 * On revert (error message contains "revert" / "execution reverted",
 * case-insensitive) → `{ status: "revert", resultData: null, errorMessage }`.
 * On any other error (RPC down, timeout, network unreachable) →
 * `{ status: "error", resultData: null, errorMessage }`.
 *
 * Demo-mode safety: `call` is a read-only eth_call — no signing surface, no
 * private-key path — so this helper runs unchanged under Plan 05-02 Option B
 * (persona address as `account`). The helper is agnostic to whether the
 * caller is the paired Ledger or a curated demo persona.
 */
export async function runPreviewSimulation(input: {
  client: PublicClient;
  sender: Address;
  tx: { to: Address; valueWei: bigint; data: Hex };
}): Promise<SimulationResult> {
  try {
    const result = await call(input.client, {
      account: input.sender,
      to: input.tx.to,
      value: input.tx.valueWei,
      data: input.tx.data,
    });
    return {
      status: "ok",
      resultData: (result.data ?? "0x") as Hex,
      errorMessage: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // viem signals reverts via the error message containing "revert" or
    // "execution reverted" (case-insensitive). Operational errors (RPC down,
    // timeout, network unreachable) land in the same catch — distinguish via
    // the message text so the SIMULATION block can render the correct kind.
    if (/revert|execution reverted/i.test(message)) {
      return { status: "revert", resultData: null, errorMessage: message };
    }
    return { status: "error", resultData: null, errorMessage: message };
  }
}

/**
 * ESM spy-affordance per CLAUDE.md convention. preview_send.ts imports
 * `_simulation` and calls `_simulation.runPreviewSimulation(input)` so tests
 * can spy on the call without monkey-patching the production import path.
 */
export const _simulation = { runPreviewSimulation };
