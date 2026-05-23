# Phase 31 Plan 31-01 — Planner-Gate Verification

**Date:** 2026-05-23
**RPC URL:** https://ethereum-rpc.publicnode.com

This file documents the on-chain resolution of three RESEARCH assumptions
(A1 / A2 / A4) against live Ethereum mainnet. Output addresses below are
the verified values committed into `src/config/contracts.ts` in Task 2.

## A4 — RocketStorage canonical address

**Claim:** `0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46` is the live RocketStorage indirection contract.

**Result:** bytecode size = 11270 bytes; contract is live.

**A4 RESOLVED.**

## A1 — RocketDAOProtocolSettingsDeposit proxy via RocketStorage

**Key:** `keccak256(encodePacked("contract.address", "rocketDAOProtocolSettingsDeposit"))`
**Key value:** `0x876d8a498b5341a6b5897a8239bfb0347e2b8d81fe9401d355c1e4b0ecebedaa`

**Resolved address (EIP-55):** `0x227BE8dD01DF8ad9BED0178e4F8cEC2996C5c365`

**A1 RESOLVED.** Commit this literal into `ROCKETPOOL_RAW[1].settingsDeposit`.

## A2 — Per-LST underlying-token addresses via Strategy.underlyingToken()

| LST | Strategy proxy | underlyingToken() returned | Cited literal | Status |
| --- | --- | --- | --- | --- |
| cbETH | 0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc | 0xBe9895146f7AF43049ca1c1AE358B0541Ea49704 | 0xBe9895146f7AF43049ca1c1AE358B0541Ea49704 | PASS |
| ETHx | 0x9d7eD45EE2E8FC5482fa2428f15C971e6369011d | 0xA35b1B31Ce002FBF2058D22F30f95D405200A15b | 0xA35b1B31Ce002FBF2058D22F30f95D405200A15b | PASS |
| wBETH | 0x7CA911E83dabf90C90dD3De5411a10F1A6112184 | 0xa2E3356610840701BDf5611a53974510Ae27E2e1 | 0xa2E3356610840701BDf5611a53974510Ae27E2e1 | PASS |
| sfrxETH | 0x8CA7A5d6f3acd3A7A8bC468a8CD0FB14B6BD28b6 | 0xac3E018457B222d93114458476f3E3416Abbe38F | 0xac3E018457B222d93114458476f3E3416Abbe38F | PASS |
| mETH | 0x298aFB19A105D59E74658C4C334Ff360BadE6dd2 | 0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa | 0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa | PASS |

**A2 RESOLVED.** All 5 per-LST underlying-token addresses match the RESEARCH-cited literals byte-identical.

## Summary

- A1 RESOLVED — `0x227BE8dD01DF8ad9BED0178e4F8cEC2996C5c365`
- A2 RESOLVED — 5 strategies cross-checked; drift = 0
- A4 RESOLVED — RocketStorage live at `0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46`

