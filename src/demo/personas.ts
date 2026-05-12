// Curated demo persona registry (Plan 05-01 / DEMO-03).
//
// Four hand-picked Ethereum mainnet addresses the agent can simulate
// portfolio/balance/transaction-history flows against. The user picks one
// via `set_demo_wallet({ persona })` after `get_demo_wallet` lists them.
//
// VERIFICATION RITUAL — before merging any swap to this table:
//   1. Confirm each address is an EOA (not a contract) via
//      `curl -s https://api.etherscan.io/api?module=contract&action=getabi&address=<addr>`
//      — an EOA returns "Contract source code not verified" or similar
//      non-ABI; a contract returns a valid ABI JSON.
//   2. Cross-check against the OFAC SDN list at
//      `https://www.treasury.gov/ofac/downloads/sdn.xml` — a hit means
//      do NOT ship that address.
//   3. Prefer composition-stable wallets (active treasuries, well-known
//      named EOAs) — empty/inactive wallets exercise no breadth.
//
// T-PERSONA-ADDR-1 mitigation (research § STRIDE):
// each `.address` is `getAddress("0x...")` at the literal site so viem
// throws at MODULE LOAD on a checksum violation. Tests in
// `test/demo-state.test.ts` assert byte-identity against the locked
// EIP-55 literals here — a future contributor that swaps an address
// for an attacker-controlled one breaks the regression anchor.

import { type Address, getAddress } from "viem";

export interface Persona {
  readonly slug: "whale" | "defi-degen" | "stable-saver" | "staking-maxi";
  readonly address: Address;
  readonly description: string;
  readonly rehearsableFlows: readonly string[];
}

/**
 * Locked persona table — 4 entries. Address picks documented in
 * `.planning/phases/05-demo-mode-diagnostics/05-RESEARCH.md` § Persona Picks.
 *
 * R1 accepted residual: `defi-degen` and `staking-maxi` are Binance exchange
 * hot wallets (composition-stable but archetype-mismatched). Phase 6 swaps
 * `defi-degen` to an active Uniswap V3 LP and `staking-maxi` to a
 * stETH-heavy EOA once ERC-20 enumeration tests exist to surface the
 * mismatch. v1.0 ships these picks because no DeFi-aware read tool
 * exercises the thematic fit yet.
 */
export const PERSONAS: ReadonlyArray<Persona> = [
  {
    slug: "whale",
    address: getAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"), // vitalik.eth
    description:
      "Large native ETH balance with mixed historical positions. Exercises get_portfolio_summary against a heterogeneous wallet.",
    rehearsableFlows: [
      "get_portfolio_summary",
      "get_token_balance",
      "resolve_ens_name",
      "reverse_resolve_ens",
      "get_transaction_status",
    ],
  },
  {
    slug: "stable-saver",
    address: getAddress("0x55FE002aefF02F77364de339a1292923A15844B8"), // Circle USDC treasury
    description:
      "USDC-dominant treasury. Exercises ERC-20 balance discovery + stablecoin USD-total aggregation.",
    rehearsableFlows: ["get_portfolio_summary", "get_token_balance"],
  },
  {
    slug: "defi-degen",
    address: getAddress("0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503"), // Binance 7 — large active EOA
    description:
      "Large active EOA with broad DeFi token holdings. Exercises ERC-20 enumeration breadth + non-trivial USD totals.",
    rehearsableFlows: ["get_portfolio_summary", "get_token_balance"],
  },
  {
    slug: "staking-maxi",
    address: getAddress("0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8"), // Binance 8 — long-term holder profile
    description:
      "Stable large EOA — long-term holder profile. Exercises baseline portfolio reads + transaction-history surfaces.",
    rehearsableFlows: [
      "get_portfolio_summary",
      "get_token_balance",
      "get_transaction_status",
    ],
  },
] as const;
