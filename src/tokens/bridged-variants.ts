// src/tokens/bridged-variants.ts — curated bridged-token disambiguation table.
//
// Phase 8 — Plan 08-04 (READ-42). New occupant of the `src/tokens/` shelf.
// Mirror of the `src/config/contracts.ts` KNOWN_SPENDERS_ETHEREUM shape:
// typed `BridgedVariant` interface + `readonly BridgedVariant[]` + filtered
// getter + `_bridgedVariants` ESM spy-affordance.
//
// Curation discipline:
//   - ~15 commonly-disambiguated symbols × 5 chains → ~75 rows.
//   - Each row carries `canonicalSymbol` + `variantSymbol` so a USDC vs USDC.e
//     lookup matches on either field (case-insensitive).
//   - `variant: "canonical" | "bridged"` is the load-bearing scam-prevention
//     signal — bridged rows carry `originChain` + a `variantNote` text that
//     names the bridge mechanism explicitly. The agent surfaces both sides
//     of the ambiguity to the user; the user picks.
//   - Every `address` is `getAddress()`-wrapped at the literal site
//     (format-fanout-sentinel — a corrupted snapshot throws EIP-55 at module
//     load before any caller sees the bad address).
//
// Sources verified at curation (2026-05-18):
//   - Circle docs (native USDC launches per chain):
//       https://www.circle.com/multi-chain-usdc
//       https://www.circle.com/blog/usdc-now-available-on-arbitrum
//   - Optimism token list:
//       https://github.com/ethereum-optimism/ethereum-optimism.github.io/blob/master/optimism.tokenlist.json
//   - Arbitrum token list:
//       https://bridge.arbitrum.io/token-list-42161.json
//   - Polygon token list:
//       https://api.polygon.technology/api/v1/tokens
//   - Base predeploys + Coinbase USDbC:
//       https://docs.base.org/base-contracts
//       https://docs.coinbase.com/cloud
//   - MakerDAO official cross-chain deployments:
//       https://changelog.makerdao.com/
//   - OP-Stack predeploys (WETH at 0x4200…0006 shared by Base + Optimism):
//       https://docs.optimism.io/chain/addresses
//
// T-USDC-USDC.E (HIGH) mitigation: USDC on Polygon / Arbitrum / Optimism
// returns BOTH the Circle-native canonical AND the bridged USDC.e variant —
// the agent CANNOT silently pick one; the response surfaces both with
// explicit `variantNote` text.

import { getAddress, type Address } from "viem";

import type { ChainId, ChainName } from "../config/contracts.js";

/**
 * One row in the curated bridged-variant table.
 *
 *   - `canonicalSymbol`: the symbol the user typed (e.g. `"USDC"`). Used by
 *     the case-insensitive `lookupBridgedVariant` match — both canonical and
 *     bridged variants share the same `canonicalSymbol`.
 *   - `variantSymbol`: the per-row name (e.g. `"USDC"` for the Circle-native
 *     variant on Polygon, `"USDC.e"` for the bridged variant). Distinguishes
 *     the two rows when a user types either name.
 *   - `address`: EIP-55 checksummed at the literal site.
 *   - `chainId`: which chain this address lives on (5-chain union).
 *   - `variant`: `"canonical"` for the chain's first-party / officially-
 *     attested deployment, `"bridged"` when the token reached this chain via
 *     a third-party bridge.
 *   - `variantNote`: free-form prose the tool surfaces verbatim so the user
 *     can make the canonical-vs-bridged decision; names the bridge mechanism
 *     for bridged variants.
 *   - `originChain` (bridged variants only): which chain the asset bridged
 *     from. Omitted for canonical variants.
 */
export interface BridgedVariant {
  canonicalSymbol: string;
  variantSymbol: string;
  address: Address;
  chainId: ChainId;
  variant: "canonical" | "bridged";
  variantNote: string;
  originChain?: ChainName;
}

/**
 * Curated table: ~15 commonly-disambiguated symbols × 5 chains where the
 * symbol exists. Hand-verified at curation date against the sources listed
 * at the top of this file. Every `address` `getAddress()`-checksummed at the
 * literal site — a corrupted snapshot throws at module load.
 */
export const BRIDGED_VARIANTS: readonly BridgedVariant[] = [
  // ----- USDC -----------------------------------------------------------
  {
    canonicalSymbol: "USDC",
    variantSymbol: "USDC",
    address: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
    chainId: 1,
    variant: "canonical",
    variantNote: "Circle-native USDC on Ethereum mainnet. Attested 1:1 by Circle.",
  },
  {
    canonicalSymbol: "USDC",
    variantSymbol: "USDC",
    address: getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
    chainId: 42161,
    variant: "canonical",
    variantNote:
      "Circle-native USDC on Arbitrum. Launched 2023. Attested by Circle directly; redeemable 1:1 via Circle Mint.",
  },
  {
    canonicalSymbol: "USDC",
    variantSymbol: "USDC.e",
    address: getAddress("0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"),
    chainId: 42161,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Bridged USDC via Arbitrum gateway from Ethereum. Originally named 'USDC' before Circle launched native USDC on Arbitrum (2023). Redeemable for ETH-mainnet USDC via the bridge, NOT Circle-attested directly.",
  },
  {
    canonicalSymbol: "USDC",
    variantSymbol: "USDC",
    address: getAddress("0x3c499c542cEF5E3811e1192cE70d8cC03d5c3359"),
    chainId: 137,
    variant: "canonical",
    variantNote:
      "Circle-native USDC on Polygon. Launched 2023. Attested by Circle directly; redeemable 1:1 via Circle Mint.",
  },
  {
    canonicalSymbol: "USDC",
    variantSymbol: "USDC.e",
    address: getAddress("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Bridged USDC via Polygon PoS bridge from Ethereum. Originally named 'USDC' before Circle launched native USDC on Polygon (2023). Redeemable for ETH-mainnet USDC via the bridge, NOT Circle-attested directly.",
  },
  {
    canonicalSymbol: "USDC",
    variantSymbol: "USDC",
    address: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    chainId: 8453,
    variant: "canonical",
    variantNote:
      "Circle-native USDC on Base. Attested by Circle directly; redeemable 1:1 via Circle Mint.",
  },
  {
    canonicalSymbol: "USDC",
    variantSymbol: "USDbC",
    address: getAddress("0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA"),
    chainId: 8453,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Bridged USDC via Coinbase bridge from Ethereum (renamed USDbC on Base to distinguish from Circle-native USDC). Redeemable via the Coinbase bridge, NOT Circle-attested directly.",
  },
  {
    canonicalSymbol: "USDC",
    variantSymbol: "USDC",
    address: getAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"),
    chainId: 10,
    variant: "canonical",
    variantNote:
      "Circle-native USDC on Optimism. Launched 2023. Attested by Circle directly; redeemable 1:1 via Circle Mint.",
  },
  {
    canonicalSymbol: "USDC",
    variantSymbol: "USDC.e",
    address: getAddress("0x7F5c764cBc14f9669B88837ca1490cCa17c31607"),
    chainId: 10,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Bridged USDC via Optimism gateway from Ethereum. Originally named 'USDC' before Circle launched native USDC on Optimism (2023). Redeemable for ETH-mainnet USDC via the bridge, NOT Circle-attested directly.",
  },

  // ----- USDT -----------------------------------------------------------
  {
    canonicalSymbol: "USDT",
    variantSymbol: "USDT",
    address: getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
    chainId: 1,
    variant: "canonical",
    variantNote: "Tether USD on Ethereum mainnet. Issued natively by Tether.",
  },
  {
    canonicalSymbol: "USDT",
    variantSymbol: "USDT",
    address: getAddress("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"),
    chainId: 42161,
    variant: "canonical",
    variantNote: "Tether USD on Arbitrum. Issued natively by Tether.",
  },
  {
    canonicalSymbol: "USDT",
    variantSymbol: "USDT",
    address: getAddress("0xc2132D05D31c914a87C6611C10748AEb04B58e8F"),
    chainId: 137,
    variant: "canonical",
    variantNote: "Tether USD on Polygon. Issued natively by Tether.",
  },
  {
    canonicalSymbol: "USDT",
    variantSymbol: "USDT",
    address: getAddress("0x94b008aA00579c1307B0EF2c499aD98a8ce58e58"),
    chainId: 10,
    variant: "canonical",
    variantNote: "Tether USD on Optimism. Issued natively by Tether.",
  },

  // ----- DAI ------------------------------------------------------------
  {
    canonicalSymbol: "DAI",
    variantSymbol: "DAI",
    address: getAddress("0x6B175474E89094C44Da98b954EedeAC495271d0F"),
    chainId: 1,
    variant: "canonical",
    variantNote: "MakerDAO DAI on Ethereum mainnet. Native MakerDAO deployment.",
  },
  {
    canonicalSymbol: "DAI",
    variantSymbol: "DAI",
    address: getAddress("0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"),
    chainId: 42161,
    variant: "canonical",
    variantNote:
      "MakerDAO-deployed DAI on Arbitrum (cross-chain canonical, deployed via Maker's official bridge contracts).",
  },
  {
    canonicalSymbol: "DAI",
    variantSymbol: "DAI",
    address: getAddress("0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Bridged DAI via Polygon PoS bridge from Ethereum (no native MakerDAO deployment on Polygon — the bridged variant is the de-facto canonical).",
  },
  {
    canonicalSymbol: "DAI",
    variantSymbol: "DAI",
    address: getAddress("0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"),
    chainId: 10,
    variant: "canonical",
    variantNote:
      "MakerDAO-deployed DAI on Optimism (cross-chain canonical, deployed via Maker's official bridge contracts).",
  },

  // ----- WETH -----------------------------------------------------------
  {
    canonicalSymbol: "WETH",
    variantSymbol: "WETH",
    address: getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
    chainId: 1,
    variant: "canonical",
    variantNote: "Canonical WETH9 on Ethereum mainnet (immutable contract).",
  },
  {
    canonicalSymbol: "WETH",
    variantSymbol: "WETH",
    address: getAddress("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"),
    chainId: 42161,
    variant: "canonical",
    variantNote: "Canonical WETH on Arbitrum (Arbitrum-native wrapper contract).",
  },
  {
    canonicalSymbol: "WETH",
    variantSymbol: "WETH",
    address: getAddress("0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Wrapped ETH bridged via Polygon PoS bridge from Ethereum (Polygon's native gas asset is MATIC; WETH is bridged ETH).",
  },
  {
    canonicalSymbol: "WETH",
    variantSymbol: "WETH",
    address: getAddress("0x4200000000000000000000000000000000000006"),
    chainId: 8453,
    variant: "canonical",
    variantNote:
      "OP-Stack WETH predeploy on Base (`0x4200…0006`). Shared canonical predeploy address across all OP-Stack chains.",
  },
  {
    canonicalSymbol: "WETH",
    variantSymbol: "WETH",
    address: getAddress("0x4200000000000000000000000000000000000006"),
    chainId: 10,
    variant: "canonical",
    variantNote:
      "OP-Stack WETH predeploy on Optimism (`0x4200…0006`). Shared canonical predeploy address across all OP-Stack chains.",
  },

  // ----- WBTC -----------------------------------------------------------
  {
    canonicalSymbol: "WBTC",
    variantSymbol: "WBTC",
    address: getAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"),
    chainId: 1,
    variant: "canonical",
    variantNote:
      "Wrapped Bitcoin on Ethereum mainnet (BitGo custody; the canonical WBTC deployment).",
  },
  {
    canonicalSymbol: "WBTC",
    variantSymbol: "WBTC",
    address: getAddress("0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f"),
    chainId: 42161,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Bridged WBTC via Arbitrum gateway from Ethereum (no native WBTC deployment on Arbitrum — the bridged variant is the de-facto canonical).",
  },
  {
    canonicalSymbol: "WBTC",
    variantSymbol: "WBTC",
    address: getAddress("0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Bridged WBTC via Polygon PoS bridge from Ethereum (no native WBTC deployment on Polygon).",
  },
  {
    canonicalSymbol: "WBTC",
    variantSymbol: "WBTC",
    address: getAddress("0x68f180fcCe6836688e9084f035309E29Bf0A2095"),
    chainId: 10,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Bridged WBTC via Optimism gateway from Ethereum (no native WBTC deployment on Optimism).",
  },

  // ----- WMATIC (Polygon-native gas-asset wrapper) ---------------------
  {
    canonicalSymbol: "WMATIC",
    variantSymbol: "WMATIC",
    address: getAddress("0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"),
    chainId: 137,
    variant: "canonical",
    variantNote:
      "Wrapped MATIC on Polygon (Polygon-native gas-asset wrapper, analogous to WETH9 on Ethereum).",
  },

  // ----- ARB (Arbitrum-native governance token) ------------------------
  {
    canonicalSymbol: "ARB",
    variantSymbol: "ARB",
    address: getAddress("0x912CE59144191C1204E64559FE8253a0e49E6548"),
    chainId: 42161,
    variant: "canonical",
    variantNote:
      "Arbitrum governance token (ARB) on Arbitrum — the token's native chain.",
  },

  // ----- OP (Optimism-native governance token) -------------------------
  {
    canonicalSymbol: "OP",
    variantSymbol: "OP",
    address: getAddress("0x4200000000000000000000000000000000000042"),
    chainId: 10,
    variant: "canonical",
    variantNote:
      "Optimism governance token (OP) on Optimism — OP-Stack predeploy at `0x4200…0042`.",
  },

  // ----- cbETH (Coinbase Wrapped Staked ETH) ---------------------------
  {
    canonicalSymbol: "cbETH",
    variantSymbol: "cbETH",
    address: getAddress("0xBe9895146f7AF43049ca1c1AE358B0541Ea49704"),
    chainId: 1,
    variant: "canonical",
    variantNote:
      "Coinbase Wrapped Staked ETH (cbETH) on Ethereum mainnet — Coinbase's liquid-staking token.",
  },
  {
    canonicalSymbol: "cbETH",
    variantSymbol: "cbETH",
    address: getAddress("0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22"),
    chainId: 8453,
    variant: "canonical",
    variantNote:
      "Coinbase Wrapped Staked ETH (cbETH) on Base — Coinbase's canonical Base deployment.",
  },

  // ----- stMATIC (Lido staked MATIC, Polygon-native) -------------------
  {
    canonicalSymbol: "stMATIC",
    variantSymbol: "stMATIC",
    address: getAddress("0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4"),
    chainId: 137,
    variant: "canonical",
    variantNote: "Lido staked MATIC on Polygon (Polygon-native LST).",
  },

  // ----- MaticX (Stader staked MATIC, Polygon-native) ------------------
  {
    canonicalSymbol: "MaticX",
    variantSymbol: "MaticX",
    address: getAddress("0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6"),
    chainId: 137,
    variant: "canonical",
    variantNote: "Stader staked MATIC (MaticX) on Polygon (Polygon-native LST).",
  },

  // ----- LINK (Chainlink token across multiple chains) -----------------
  {
    canonicalSymbol: "LINK",
    variantSymbol: "LINK",
    address: getAddress("0x514910771AF9Ca656af840dff83E8264EcF986CA"),
    chainId: 1,
    variant: "canonical",
    variantNote: "Chainlink token (LINK) on Ethereum mainnet — Chainlink-native deployment.",
  },
  {
    canonicalSymbol: "LINK",
    variantSymbol: "LINK",
    address: getAddress("0xf97f4df75117a78c1A5a0DBb814Af92458539FB4"),
    chainId: 42161,
    variant: "canonical",
    variantNote:
      "Chainlink token (LINK) on Arbitrum — Chainlink-native CCIP-enabled deployment.",
  },
  {
    canonicalSymbol: "LINK",
    variantSymbol: "LINK",
    address: getAddress("0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Bridged Chainlink token (LINK) via Polygon PoS bridge from Ethereum (no native CCIP deployment on Polygon at curation time).",
  },
  {
    canonicalSymbol: "LINK",
    variantSymbol: "LINK",
    address: getAddress("0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196"),
    chainId: 10,
    variant: "canonical",
    variantNote:
      "Chainlink token (LINK) on Optimism — Chainlink-native CCIP-enabled deployment.",
  },

  // ----- UNI (Uniswap governance token) --------------------------------
  {
    canonicalSymbol: "UNI",
    variantSymbol: "UNI",
    address: getAddress("0x1f9840a85d5aF5bf1D1762F925BdADdC4201F984"),
    chainId: 1,
    variant: "canonical",
    variantNote: "Uniswap governance token (UNI) on Ethereum mainnet — native deployment.",
  },
  {
    canonicalSymbol: "UNI",
    variantSymbol: "UNI",
    address: getAddress("0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0"),
    chainId: 42161,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Uniswap governance token (UNI) via Arbitrum gateway from Ethereum.",
  },
  {
    canonicalSymbol: "UNI",
    variantSymbol: "UNI",
    address: getAddress("0xb33EaAd8d922B1083446DC23f610c2567fB5180f"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Uniswap governance token (UNI) via Polygon PoS bridge from Ethereum.",
  },
  {
    canonicalSymbol: "UNI",
    variantSymbol: "UNI",
    address: getAddress("0x6fd9d7AD17242c41f7131d257212c54A0e816691"),
    chainId: 10,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Uniswap governance token (UNI) via Optimism gateway from Ethereum.",
  },

  // ----- AAVE (Aave governance token) ----------------------------------
  {
    canonicalSymbol: "AAVE",
    variantSymbol: "AAVE",
    address: getAddress("0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9"),
    chainId: 1,
    variant: "canonical",
    variantNote: "Aave governance token (AAVE) on Ethereum mainnet — native deployment.",
  },
  {
    canonicalSymbol: "AAVE",
    variantSymbol: "AAVE",
    address: getAddress("0xba5DdD1f9d7F570dc94a51479a000E3BCE967196"),
    chainId: 42161,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Aave governance token (AAVE) via Arbitrum gateway from Ethereum.",
  },
  {
    canonicalSymbol: "AAVE",
    variantSymbol: "AAVE",
    address: getAddress("0xD6DF932A45C0f255f85145f286eA0b292B21C90B"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Aave governance token (AAVE) via Polygon PoS bridge from Ethereum.",
  },
  {
    canonicalSymbol: "AAVE",
    variantSymbol: "AAVE",
    address: getAddress("0x76FB31fb4af56892A25e32cFC43De717950c9278"),
    chainId: 10,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Aave governance token (AAVE) via Optimism gateway from Ethereum.",
  },

  // ----- FRAX (Frax stablecoin) ----------------------------------------
  {
    canonicalSymbol: "FRAX",
    variantSymbol: "FRAX",
    address: getAddress("0x853d955aCEf822Db058eb8505911ED77F175b99e"),
    chainId: 1,
    variant: "canonical",
    variantNote: "Frax stablecoin (FRAX) on Ethereum mainnet — native deployment.",
  },
  {
    canonicalSymbol: "FRAX",
    variantSymbol: "FRAX",
    address: getAddress("0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F"),
    chainId: 42161,
    variant: "canonical",
    variantNote: "Frax stablecoin (FRAX) on Arbitrum — Frax-native cross-chain deployment.",
  },
  {
    canonicalSymbol: "FRAX",
    variantSymbol: "FRAX",
    address: getAddress("0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89"),
    chainId: 137,
    variant: "canonical",
    variantNote: "Frax stablecoin (FRAX) on Polygon — Frax-native cross-chain deployment.",
  },
  {
    canonicalSymbol: "FRAX",
    variantSymbol: "FRAX",
    address: getAddress("0x2E3D870790dC77A83DD1d18184Acc7439A53f475"),
    chainId: 10,
    variant: "canonical",
    variantNote: "Frax stablecoin (FRAX) on Optimism — Frax-native cross-chain deployment.",
  },

  // ----- LDO (Lido governance token) -----------------------------------
  {
    canonicalSymbol: "LDO",
    variantSymbol: "LDO",
    address: getAddress("0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32"),
    chainId: 1,
    variant: "canonical",
    variantNote: "Lido governance token (LDO) on Ethereum mainnet — native deployment.",
  },
  {
    canonicalSymbol: "LDO",
    variantSymbol: "LDO",
    address: getAddress("0x13Ad51ed4F1B7e9Dc168d8a00cB3f4dDD85EfA60"),
    chainId: 42161,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Lido governance token (LDO) via Arbitrum gateway from Ethereum.",
  },
  {
    canonicalSymbol: "LDO",
    variantSymbol: "LDO",
    address: getAddress("0xC3C7d422809852031b44ab29EEC9F1EfF2A58756"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Lido governance token (LDO) via Polygon PoS bridge from Ethereum.",
  },

  // ----- wstETH (Lido wrapped staked ETH) ------------------------------
  {
    canonicalSymbol: "wstETH",
    variantSymbol: "wstETH",
    address: getAddress("0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0"),
    chainId: 1,
    variant: "canonical",
    variantNote: "Lido wrapped staked ETH (wstETH) on Ethereum mainnet — native deployment.",
  },
  {
    canonicalSymbol: "wstETH",
    variantSymbol: "wstETH",
    address: getAddress("0x5979D7b546E38E414F7E9822514be443A4800529"),
    chainId: 42161,
    variant: "canonical",
    variantNote:
      "Lido wrapped staked ETH (wstETH) on Arbitrum — Lido-deployed cross-chain canonical.",
  },
  {
    canonicalSymbol: "wstETH",
    variantSymbol: "wstETH",
    address: getAddress("0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Lido wrapped staked ETH (wstETH) via Polygon PoS bridge from Ethereum.",
  },
  {
    canonicalSymbol: "wstETH",
    variantSymbol: "wstETH",
    address: getAddress("0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452"),
    chainId: 8453,
    variant: "canonical",
    variantNote:
      "Lido wrapped staked ETH (wstETH) on Base — Lido-deployed cross-chain canonical.",
  },
  {
    canonicalSymbol: "wstETH",
    variantSymbol: "wstETH",
    address: getAddress("0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb"),
    chainId: 10,
    variant: "canonical",
    variantNote:
      "Lido wrapped staked ETH (wstETH) on Optimism — Lido-deployed cross-chain canonical.",
  },

  // ----- rETH (Rocket Pool ETH) ----------------------------------------
  {
    canonicalSymbol: "rETH",
    variantSymbol: "rETH",
    address: getAddress("0xae78736Cd615f374D3085123A210448E74Fc6393"),
    chainId: 1,
    variant: "canonical",
    variantNote: "Rocket Pool ETH (rETH) on Ethereum mainnet — native Rocket Pool deployment.",
  },
  {
    canonicalSymbol: "rETH",
    variantSymbol: "rETH",
    address: getAddress("0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8"),
    chainId: 42161,
    variant: "canonical",
    variantNote: "Rocket Pool ETH (rETH) on Arbitrum — Rocket-Pool-deployed cross-chain canonical.",
  },
  {
    canonicalSymbol: "rETH",
    variantSymbol: "rETH",
    address: getAddress("0x9Bcef72be871e61ED4fBbc7630889beE758eb81D"),
    chainId: 10,
    variant: "canonical",
    variantNote: "Rocket Pool ETH (rETH) on Optimism — Rocket-Pool-deployed cross-chain canonical.",
  },

  // ----- MKR (Maker governance) ----------------------------------------
  {
    canonicalSymbol: "MKR",
    variantSymbol: "MKR",
    address: getAddress("0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2"),
    chainId: 1,
    variant: "canonical",
    variantNote: "Maker governance token (MKR) on Ethereum mainnet — native MakerDAO deployment.",
  },
  {
    canonicalSymbol: "MKR",
    variantSymbol: "MKR",
    address: getAddress("0x6f7C932e7684666C9fd1d44527765433e01fF61d"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Bridged MKR via Polygon PoS bridge from Ethereum (no native MakerDAO deployment on Polygon).",
  },

  // ----- CRV (Curve DAO token) -----------------------------------------
  {
    canonicalSymbol: "CRV",
    variantSymbol: "CRV",
    address: getAddress("0xD533a949740bb3306d119CC777fa900bA034cd52"),
    chainId: 1,
    variant: "canonical",
    variantNote: "Curve DAO token (CRV) on Ethereum mainnet — native Curve deployment.",
  },
  {
    canonicalSymbol: "CRV",
    variantSymbol: "CRV",
    address: getAddress("0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978"),
    chainId: 42161,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Curve DAO token (CRV) via Arbitrum gateway from Ethereum.",
  },
  {
    canonicalSymbol: "CRV",
    variantSymbol: "CRV",
    address: getAddress("0x172370d5Cd63279eFa6d502DAB29171933a610AF"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Curve DAO token (CRV) via Polygon PoS bridge from Ethereum.",
  },
  {
    canonicalSymbol: "CRV",
    variantSymbol: "CRV",
    address: getAddress("0x0994206dfE8De6Ec6920FF4D779B0d950605Fb53"),
    chainId: 10,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Curve DAO token (CRV) via Optimism gateway from Ethereum.",
  },

  // ----- SUSHI (SushiSwap governance) ----------------------------------
  {
    canonicalSymbol: "SUSHI",
    variantSymbol: "SUSHI",
    address: getAddress("0x6B3595068778DD592e39A122f4f5a5cF09C90fE2"),
    chainId: 1,
    variant: "canonical",
    variantNote:
      "SushiSwap governance token (SUSHI) on Ethereum mainnet — native SushiSwap deployment.",
  },
  {
    canonicalSymbol: "SUSHI",
    variantSymbol: "SUSHI",
    address: getAddress("0xd4d42F0b6DEF4CE0383636770eF773390d85c61A"),
    chainId: 42161,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Bridged SushiSwap governance token (SUSHI) via Arbitrum gateway from Ethereum.",
  },
  {
    canonicalSymbol: "SUSHI",
    variantSymbol: "SUSHI",
    address: getAddress("0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote:
      "Bridged SushiSwap governance token (SUSHI) via Polygon PoS bridge from Ethereum.",
  },

  // ----- GMX (GMX governance, Arbitrum-native) -------------------------
  {
    canonicalSymbol: "GMX",
    variantSymbol: "GMX",
    address: getAddress("0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a"),
    chainId: 42161,
    variant: "canonical",
    variantNote:
      "GMX governance token on Arbitrum — the token's native chain (Arbitrum-native deployment).",
  },

  // ----- BAL (Balancer governance) -------------------------------------
  {
    canonicalSymbol: "BAL",
    variantSymbol: "BAL",
    address: getAddress("0xba100000625a3754423978a60c9317c58a424e3D"),
    chainId: 1,
    variant: "canonical",
    variantNote:
      "Balancer governance token (BAL) on Ethereum mainnet — native Balancer deployment.",
  },
  {
    canonicalSymbol: "BAL",
    variantSymbol: "BAL",
    address: getAddress("0x040d1EdC9569d4Bab2D15287Dc5A4F10F56a56B8"),
    chainId: 42161,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Balancer governance token (BAL) via Arbitrum gateway from Ethereum.",
  },
  {
    canonicalSymbol: "BAL",
    variantSymbol: "BAL",
    address: getAddress("0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3"),
    chainId: 137,
    variant: "bridged",
    originChain: "ethereum",
    variantNote: "Bridged Balancer governance token (BAL) via Polygon PoS bridge from Ethereum.",
  },
];

/**
 * Filtered lookup over `BRIDGED_VARIANTS`. Case-insensitive on `symbol`;
 * matches EITHER `canonicalSymbol` OR `variantSymbol` (so a user typing
 * `"USDC"` matches both Circle-native USDC AND USDC.e rows; a user typing
 * `"USDC.e"` matches only the bridged variant).
 *
 *   - `chainId` provided  → narrow to rows whose `chainId` matches.
 *   - `chainId` omitted   → return ALL chains' rows for the symbol.
 *
 * Empty array is the "not found" signal — the consumer (`resolve_token`)
 * surfaces it as INVALID_INPUT with the supported-symbol list.
 */
export function lookupBridgedVariant(symbol: string, chainId?: ChainId): BridgedVariant[] {
  const needle = symbol.toLowerCase();
  return BRIDGED_VARIANTS.filter(
    (v) =>
      (v.canonicalSymbol.toLowerCase() === needle || v.variantSymbol.toLowerCase() === needle) &&
      (chainId === undefined || v.chainId === chainId),
  );
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
 * convention. Consumers (`resolve_token.ts`) import `_bridgedVariants` and
 * call `_bridgedVariants.lookupBridgedVariant(...)` so tests can
 * `vi.spyOn(_bridgedVariants, ...)` to intercept the lookup without
 * monkey-patching the production import path.
 */
export const _bridgedVariants = { lookupBridgedVariant };
