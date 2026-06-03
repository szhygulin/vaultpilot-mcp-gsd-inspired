// src/chains/solana/kamino.ts
//
// Kamino Obligation/Reserve decoder + PDA-presence read (D-02). Phase 13 —
// Plan 13-04. Sibling of `src/chains/solana/marginfi.ts` shape, with a
// `_kaminoChain` ESM-indirection object (CLAUDE.md — internal cross-export
// calls route through it so tests can `vi.spyOn`).
//
// KIT→SHAPE ADAPTER (the load-bearing Kamino constraint — Pitfall 1/6):
//   The klend-sdk is `@solana/kit`-native. Its codegen `Obligation.decode` /
//   `Reserve.decode` return kit `Address` (a branded base58 STRING) + `BN`
//   numerics. We import those decoders via the DEEP CODEGEN SUBPATH
//   (`dist/@codegen/klend/accounts/*.js`) — NOT the package barrel, which
//   transitively pulls `@kamino-finance/farms-sdk` whose `@codegen/farms/
//   programId` submodule is unresolvable (verified at build: the barrel import
//   throws "Cannot find module"). The deep subpath sidesteps that broken
//   transitive entirely.
//
//   `adaptObligation` / `adaptReserve` convert kit `Address`→base58 string and
//   `BN`→bigint IMMEDIATELY at this seam. NO kit `Address`/`Decimal`/`BN` type
//   crosses into any downstream shape (health module, tools) — the v1 codebase
//   stays kit-free past this file. This adapter is ALLOWED here (read path only,
//   13-04). The WRITE path (13-05/06) hand-encodes from the IDL and never
//   touches kit at all.
//
// FIXED-POINT SEAM (Pitfall 6 — no BN/Number leak downstream): deposited /
// borrowed amounts are `BN` → converted to native `bigint` here. Reserve config
// `loanToValuePct` / `liquidationThresholdPct` are percent integers (0–100) →
// converted to bps (×100) so the pure-bigint health module
// (`kamino-health.ts`) is integer-exact (T-13-10 scale-pin).

import { PublicKey } from "@solana/web3.js";
// Deep codegen subpath — bypasses the broken farms-sdk barrel (see header).
import { Obligation } from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/Obligation.js";
import { Reserve } from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/Reserve.js";

import {
  deriveKaminoObligationPda,
  getKaminoMainMarket,
} from "../../config/contracts.js";
import { _solanaRegistry } from "./registry.js";
import { SolanaRpcError } from "./sol-rpc-client.js";

/** A single decoded Kamino deposit (collateral) position (bigint at the seam). */
export interface DecodedKaminoDeposit {
  /** Deposit-reserve pubkey, base58 (kit Address → string). */
  reserve: string;
  /** Deposited collateral amount as native bigint (BN → bigint). */
  depositedAmount: bigint;
}

/** A single decoded Kamino borrow (liability) position. */
export interface DecodedKaminoBorrow {
  /** Borrow-reserve pubkey, base58. */
  reserve: string;
  /** Borrowed amount (scaled-fraction) as native bigint. */
  borrowedAmount: bigint;
}

/** Decoded Obligation — market + owner + elevation group + positions. */
export interface DecodedKaminoObligation {
  market: string;
  owner: string;
  elevationGroup: number;
  /** True when the obligation's lastUpdate is marked stale on-chain. */
  stale: boolean;
  deposits: DecodedKaminoDeposit[];
  borrows: DecodedKaminoBorrow[];
}

/**
 * Per-reserve oracle accounts the `refreshReserve` ceremony references. Resolved
 * from the reserve's `config.tokenInfo` (scope / pyth / switchboard). A reserve
 * that does not use a given oracle carries the default pubkey for that slot
 * (the on-chain program treats default as "absent" — matching the SDK).
 */
export interface KaminoReserveOracleAccounts {
  pythOracle: string;
  switchboardPriceOracle: string;
  switchboardTwapOracle: string;
  scopePrices: string;
}

/** Decoded Reserve config the health module + write builders need. */
export interface DecodedKaminoReserve {
  /** Reserve pubkey, base58. */
  reserve: string;
  /** Underlying liquidity mint, base58. */
  mint: string;
  /** Mint decimals (for decimal-string amount parsing). */
  mintDecimals: number;
  /** loanToValue in bps (loanToValuePct × 100). */
  loanToValueBps: bigint;
  /** liquidationThreshold in bps (liquidationThresholdPct × 100). */
  liquidationThresholdBps: bigint;
  /** Elevation-group ids the reserve participates in (surfaced verbatim, A5). */
  elevationGroups: number[];
  /** Liquidity supply vault (reserveLiquiditySupply / reserveSourceLiquidity). */
  liquiditySupplyVault: string;
  /** Liquidity fee receiver (borrowReserveLiquidityFeeReceiver). */
  liquidityFeeVault: string;
  /** Collateral mint (reserveCollateralMint). */
  collateralMint: string;
  /** Collateral supply vault (reserveDestinationDepositCollateral / source). */
  collateralSupplyVault: string;
  /** Oracle accounts for the refreshReserve ceremony. */
  oracleAccounts: KaminoReserveOracleAccounts;
}

/** Convert a kit `Address` (branded base58 string) or web3 PublicKey to base58. */
function toBase58(addr: unknown): string {
  // kit Address IS a plain string; PublicKey has toBase58(). Defensive on both.
  if (typeof addr === "string") return addr;
  if (addr && typeof (addr as { toBase58?: () => string }).toBase58 === "function") {
    return (addr as { toBase58: () => string }).toBase58();
  }
  return String(addr);
}

/** Convert a `BN`-like (has toString) to native bigint. */
function bnToBigint(bn: unknown): bigint {
  if (typeof bn === "bigint") return bn;
  if (typeof bn === "number") return BigInt(bn);
  return BigInt((bn as { toString: () => string }).toString());
}

/**
 * Pure kit→shape adapter for a decoded Obligation. Converts kit `Address`→
 * base58 string + `BN`→bigint at the seam; filters zero-amount deposit slots.
 * NO kit type crosses out of this function (Pitfall 1/6).
 *
 * Input is the codegen `Obligation.decode` shape (typed loosely as the codegen
 * `Address`/`BN` types are kit-internal — the adapter is the type firewall).
 */
export function adaptObligation(decoded: {
  lendingMarket: unknown;
  owner: unknown;
  elevationGroup: number;
  lastUpdate?: { stale?: number };
  deposits: Array<{ depositReserve: unknown; depositedAmount: unknown }>;
  borrows: Array<{ borrowReserve: unknown; borrowedAmountSf: unknown }>;
}): DecodedKaminoObligation {
  const deposits: DecodedKaminoDeposit[] = [];
  for (const d of decoded.deposits) {
    const depositedAmount = bnToBigint(d.depositedAmount);
    if (depositedAmount === 0n) continue; // empty slot.
    deposits.push({ reserve: toBase58(d.depositReserve), depositedAmount });
  }
  const borrows: DecodedKaminoBorrow[] = [];
  for (const b of decoded.borrows) {
    const borrowedAmount = bnToBigint(b.borrowedAmountSf);
    if (borrowedAmount === 0n) continue;
    borrows.push({ reserve: toBase58(b.borrowReserve), borrowedAmount });
  }
  return {
    market: toBase58(decoded.lendingMarket),
    owner: toBase58(decoded.owner),
    elevationGroup: decoded.elevationGroup,
    stale: !!decoded.lastUpdate?.stale,
    deposits,
    borrows,
  };
}

/**
 * Pure kit→shape adapter for a decoded Reserve. `loanToValuePct` /
 * `liquidationThresholdPct` are percent integers (0–100) → bps (×100);
 * `mintDecimals` may be a BN or number → number. NO kit type leaks.
 */
export function adaptReserve(
  reservePubkey: string,
  decoded: {
    liquidity: {
      mintPubkey: unknown;
      mintDecimals: unknown;
      supplyVault?: unknown;
      feeVault?: unknown;
    };
    collateral?: { mintPubkey?: unknown; supplyVault?: unknown };
    config: {
      loanToValuePct: number;
      liquidationThresholdPct: number;
      elevationGroups: number[];
      tokenInfo?: {
        pythConfiguration?: { price?: unknown };
        switchboardConfiguration?: { priceAggregator?: unknown; twapAggregator?: unknown };
        scopeConfiguration?: { priceFeed?: unknown };
      };
    };
  },
): DecodedKaminoReserve {
  const DEFAULT = "11111111111111111111111111111111";
  const ti = decoded.config.tokenInfo;
  return {
    reserve: reservePubkey,
    mint: toBase58(decoded.liquidity.mintPubkey),
    mintDecimals: Number(bnToBigint(decoded.liquidity.mintDecimals)),
    loanToValueBps: BigInt(decoded.config.loanToValuePct) * 100n,
    liquidationThresholdBps: BigInt(decoded.config.liquidationThresholdPct) * 100n,
    elevationGroups: [...decoded.config.elevationGroups],
    liquiditySupplyVault: decoded.liquidity.supplyVault
      ? toBase58(decoded.liquidity.supplyVault)
      : DEFAULT,
    liquidityFeeVault: decoded.liquidity.feeVault
      ? toBase58(decoded.liquidity.feeVault)
      : DEFAULT,
    collateralMint: decoded.collateral?.mintPubkey
      ? toBase58(decoded.collateral.mintPubkey)
      : DEFAULT,
    collateralSupplyVault: decoded.collateral?.supplyVault
      ? toBase58(decoded.collateral.supplyVault)
      : DEFAULT,
    oracleAccounts: {
      pythOracle: ti?.pythConfiguration?.price ? toBase58(ti.pythConfiguration.price) : DEFAULT,
      switchboardPriceOracle: ti?.switchboardConfiguration?.priceAggregator
        ? toBase58(ti.switchboardConfiguration.priceAggregator)
        : DEFAULT,
      switchboardTwapOracle: ti?.switchboardConfiguration?.twapAggregator
        ? toBase58(ti.switchboardConfiguration.twapAggregator)
        : DEFAULT,
      scopePrices: ti?.scopeConfiguration?.priceFeed ? toBase58(ti.scopeConfiguration.priceFeed) : DEFAULT,
    },
  };
}

/**
 * RPC read of a raw account's data. Routes through `_solanaRegistry.getConnection`
 * so the test seam (`vi.spyOn(_kaminoChain, "getRawAccountInfo")`) never opens a
 * live Connection. Returns `{ data }` when the account exists, `null` when
 * absent. Rethrows transient RPC failures as `SolanaRpcError`.
 */
async function getRawAccountInfo(
  pubkeyBase58: string,
): Promise<{ data: Buffer } | null> {
  try {
    const connection = _solanaRegistry.getConnection();
    const info = await connection.getAccountInfo(new PublicKey(pubkeyBase58));
    if (info === null) return null;
    return { data: Buffer.from(info.data) };
  } catch (err) {
    throw new SolanaRpcError(err);
  }
}

/**
 * Decode a raw Obligation buffer via the codegen decoder, then adapt to our
 * kit-free shape. Decode-only (D-02). Routed through `_kaminoChain` so tests can
 * spy this seam without a real buffer.
 */
export function decodeObligation(buffer: Buffer): DecodedKaminoObligation {
  const decoded = Obligation.decode(buffer);
  return adaptObligation(decoded as never);
}

/**
 * Decode a raw Reserve buffer via the codegen decoder, then adapt. `reservePubkey`
 * is the reserve's own address (carried into the adapted shape).
 */
export function decodeReserve(
  reservePubkey: string,
  buffer: Buffer,
): DecodedKaminoReserve {
  const decoded = Reserve.decode(buffer);
  return adaptReserve(reservePubkey, decoded as never);
}

/**
 * Result of `getKaminoObligationInfo`. Drives the D-03 hard-refuse gate in
 * 13-05: `present === false` → the prepare tool refuses with NO handle.
 * `reserves` carries the resolved DISTINCT reserves (collateral + debt) so the
 * 13-05 refresh ceremony has the full per-reserve set.
 */
export interface KaminoObligationInfo {
  /** The derived Obligation PDA, base58. */
  pda: string;
  /** True when the PDA account exists on-chain. */
  present: boolean;
  /** Decoded obligation when present; null when absent. */
  obligation: DecodedKaminoObligation | null;
  /** Resolved distinct reserves (deposit + borrow) when present; [] otherwise. */
  reserves: DecodedKaminoReserve[];
}

/**
 * Derive the Obligation PDA for `owner` under the main market and RPC-read it.
 * Present → decode + resolve each distinct touched reserve. Absent →
 * `{ present: false, obligation: null, reserves: [] }` (the D-03 driver).
 *
 * NO live Connection in tests — every RPC read routes through
 * `_kaminoChain.getRawAccountInfo` (spied).
 */
export async function getKaminoObligationInfo(
  owner: string,
): Promise<KaminoObligationInfo> {
  const market = getKaminoMainMarket();
  const pda = deriveKaminoObligationPda(market, owner);
  const raw = await _kaminoChain.getRawAccountInfo(pda);
  if (raw === null) {
    return { pda, present: false, obligation: null, reserves: [] };
  }
  const obligation = _kaminoChain.decodeObligation(raw.data);

  // Resolve each DISTINCT reserve touched by the obligation (collateral + debt).
  const distinct = new Set<string>();
  for (const d of obligation.deposits) distinct.add(d.reserve);
  for (const b of obligation.borrows) distinct.add(b.reserve);

  const reserves: DecodedKaminoReserve[] = [];
  for (const reservePk of distinct) {
    const rRaw = await _kaminoChain.getRawAccountInfo(reservePk);
    if (rRaw === null) continue; // reserve account vanished — skip (defensive).
    reserves.push(_kaminoChain.decodeReserve(reservePk, rRaw.data));
  }

  return { pda, present: true, obligation, reserves };
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. Internal cross-export calls
 * (`getKaminoObligationInfo` → `getRawAccountInfo` / `decodeObligation` /
 * `decodeReserve`) route through this object so tests can
 * `vi.spyOn(_kaminoChain, …)` to mock the RPC boundary (NO live Connection)
 * without monkey-patching named exports (ESM bindings are immutable).
 */
export const _kaminoChain = {
  getRawAccountInfo,
  decodeObligation,
  decodeReserve,
  getKaminoObligationInfo,
};
