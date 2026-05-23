#!/usr/bin/env node
// scripts/verify-phase31-addresses.mjs — Phase 31 Plan 31-01 Task 1 planner-gate.
//
// One-shot verification of three RESEARCH assumptions against live Ethereum
// mainnet (read-only `eth_call` against PublicNode public RPC):
//
//   A1 — RocketDAOProtocolSettingsDeposit proxy address, resolved via
//        `RocketStorage.getAddress(keccak256("contract.address",
//        "rocketDAOProtocolSettingsDeposit"))`.
//   A2 — Per-LST underlying-token addresses for cbETH / ETHx / wBETH / sfrxETH /
//        mETH, resolved via `Strategy.underlyingToken()` on each per-strategy
//        proxy. stETH + rETH are reused from Phase 30 SOT / this phase SOT
//        respectively; not verified here.
//   A4 — RocketStorage canonical address `0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46`
//        is the live indirection-layer contract.
//
// Output: writes a markdown report to
// `.planning/phases/31-evm-eigenlayer-rocket-pool/31-01-PLANNER-GATE-VERIFICATION.md`
// + prints to stdout. Exits non-zero if A1 cannot resolve (Phase 31 cannot ship
// without it).

import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  encodePacked,
  parseAbi,
} from "viem";
import { mainnet } from "viem/chains";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const RPC_URL =
  process.env.ETHEREUM_RPC_URL?.trim() ||
  "https://ethereum-rpc.publicnode.com";

// Mask any API key in the URL so the artifact never logs secrets.
function maskUrl(url) {
  return url.replace(/(\/v[23]\/)[A-Za-z0-9_-]+/g, "$1***");
}

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

// ---------------------------------------------------------------------------
// A4 + A1 — RocketStorage indirection + RocketDAOProtocolSettingsDeposit
// ---------------------------------------------------------------------------
const ROCKET_STORAGE = getAddress("0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46");
const ROCKET_STORAGE_ABI = parseAbi([
  "function getAddress(bytes32 _key) view returns (address)",
]);

// Key = keccak256(abi.encodePacked("contract.address", "rocketDAOProtocolSettingsDeposit"))
const settingsDepositKey = keccak256(
  encodePacked(["string", "string"], ["contract.address", "rocketDAOProtocolSettingsDeposit"]),
);

// ---------------------------------------------------------------------------
// A2 — Per-strategy underlyingToken() across 5 strategies (cbETH / ETHx /
// wBETH / sfrxETH / mETH). stETH + rETH are reused from Phase 30 SOT and the
// current phase's RocketPool SOT, respectively — they don't need re-verifying.
// ---------------------------------------------------------------------------
const STRATEGY_ABI = parseAbi([
  "function underlyingToken() view returns (address)",
]);

const STRATEGIES_TO_VERIFY = [
  {
    lst: "cbETH",
    strategy: getAddress("0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc"),
    citedToken: getAddress("0xBe9895146f7AF43049ca1c1AE358B0541Ea49704"),
  },
  {
    lst: "ETHx",
    strategy: getAddress("0x9d7eD45EE2E8FC5482fa2428f15C971e6369011d"),
    citedToken: getAddress("0xA35b1B31Ce002FBF2058D22F30f95D405200A15b"),
  },
  {
    lst: "wBETH",
    strategy: getAddress("0x7CA911E83dabf90C90dD3De5411a10F1A6112184"),
    citedToken: getAddress("0xa2E3356610840701BDf5611a53974510Ae27E2e1"),
  },
  {
    lst: "sfrxETH",
    strategy: getAddress("0x8CA7A5d6f3acd3A7A8bC468a8CD0FB14B6BD28b6"),
    citedToken: getAddress("0xac3E018457B222d93114458476f3E3416Abbe38F"),
  },
  {
    lst: "mETH",
    strategy: getAddress("0x298aFB19A105D59E74658C4C334Ff360BadE6dd2"),
    citedToken: getAddress("0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa"),
  },
];

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  const log = (s) => {
    lines.push(s);
    console.log(s);
  };

  log(`# Phase 31 Plan 31-01 — Planner-Gate Verification`);
  log("");
  log(`**Date:** ${today}`);
  log(`**RPC URL:** ${maskUrl(RPC_URL)}`);
  log("");
  log(`This file documents the on-chain resolution of three RESEARCH assumptions`);
  log(`(A1 / A2 / A4) against live Ethereum mainnet. Output addresses below are`);
  log(`the verified values committed into \`src/config/contracts.ts\` in Task 2.`);
  log("");

  // ---- A4 (RocketStorage canonical address) ----
  log(`## A4 — RocketStorage canonical address`);
  log("");
  log(`**Claim:** \`${ROCKET_STORAGE}\` is the live RocketStorage indirection contract.`);
  log("");
  let storageBytecode;
  try {
    storageBytecode = await client.getBytecode({ address: ROCKET_STORAGE });
  } catch (err) {
    log(`**Result:** ERROR fetching bytecode — ${err.message}`);
    log("");
    log(`**A4 FAILED.**`);
    writeArtifact(lines);
    process.exit(1);
  }
  if (!storageBytecode || storageBytecode === "0x") {
    log(`**Result:** ERROR — no contract code at \`${ROCKET_STORAGE}\` (EOA or self-destructed).`);
    log("");
    log(`**A4 FAILED.**`);
    writeArtifact(lines);
    process.exit(1);
  }
  log(`**Result:** bytecode size = ${(storageBytecode.length - 2) / 2} bytes; contract is live.`);
  log("");
  log(`**A4 RESOLVED.**`);
  log("");

  // ---- A1 (RocketDAOProtocolSettingsDeposit proxy via RocketStorage) ----
  log(`## A1 — RocketDAOProtocolSettingsDeposit proxy via RocketStorage`);
  log("");
  log(`**Key:** \`keccak256(encodePacked("contract.address", "rocketDAOProtocolSettingsDeposit"))\``);
  log(`**Key value:** \`${settingsDepositKey}\``);
  log("");

  let settingsDeposit;
  try {
    settingsDeposit = await client.readContract({
      address: ROCKET_STORAGE,
      abi: ROCKET_STORAGE_ABI,
      functionName: "getAddress",
      args: [settingsDepositKey],
    });
  } catch (err) {
    log(`**Result:** ERROR — ${err.message}`);
    log("");
    log(`**A1 FAILED.** Phase 31 cannot ship without the settings address.`);
    writeArtifact(lines);
    process.exit(1);
  }
  if (
    !settingsDeposit ||
    settingsDeposit === "0x0000000000000000000000000000000000000000"
  ) {
    log(`**Result:** RocketStorage returned \`0x0\` — the key is not registered.`);
    log("");
    log(`**A1 FAILED.** Phase 31 cannot ship without the settings address.`);
    writeArtifact(lines);
    process.exit(1);
  }
  // Canonicalize via EIP-55 checksum.
  const settingsDepositChecksummed = getAddress(settingsDeposit);
  log(`**Resolved address (EIP-55):** \`${settingsDepositChecksummed}\``);
  log("");
  log(`**A1 RESOLVED.** Commit this literal into \`ROCKETPOOL_RAW[1].settingsDeposit\`.`);
  log("");

  // ---- A2 (Per-strategy underlyingToken()) ----
  log(`## A2 — Per-LST underlying-token addresses via Strategy.underlyingToken()`);
  log("");
  log(`| LST | Strategy proxy | underlyingToken() returned | Cited literal | Status |`);
  log(`| --- | --- | --- | --- | --- |`);
  let driftCount = 0;
  for (const { lst, strategy, citedToken } of STRATEGIES_TO_VERIFY) {
    let onChain;
    try {
      onChain = await client.readContract({
        address: strategy,
        abi: STRATEGY_ABI,
        functionName: "underlyingToken",
      });
    } catch (err) {
      log(`| ${lst} | ${strategy} | ERROR: ${err.message} | ${citedToken} | FAIL |`);
      driftCount++;
      continue;
    }
    const onChainChecksum = getAddress(onChain);
    const citedChecksum = getAddress(citedToken);
    const status = onChainChecksum === citedChecksum ? "PASS" : "DRIFT";
    if (status === "DRIFT") driftCount++;
    log(`| ${lst} | ${strategy} | ${onChainChecksum} | ${citedChecksum} | ${status} |`);
  }
  log("");
  if (driftCount === 0) {
    log(`**A2 RESOLVED.** All 5 per-LST underlying-token addresses match the RESEARCH-cited literals byte-identical.`);
  } else {
    log(`**A2 RESOLVED (with ${driftCount} drift discoveries).** On-chain values win; use those in Task 2's \`EIGENLAYER_RAW[1].lstTokens\` and add inline \`// VERIFIED via Strategy.underlyingToken() at planner-gate ${today}; supersedes RESEARCH § Topic 1 cited literal\` comments.`);
  }
  log("");

  // ---- Summary ----
  log(`## Summary`);
  log("");
  log(`- A1 RESOLVED — \`${settingsDepositChecksummed}\``);
  log(`- A2 RESOLVED — 5 strategies cross-checked; drift = ${driftCount}`);
  log(`- A4 RESOLVED — RocketStorage live at \`${ROCKET_STORAGE}\``);
  log("");

  writeArtifact(lines);
}

function writeArtifact(lines) {
  const outPath = resolve(
    process.cwd(),
    ".planning/phases/31-evm-eigenlayer-rocket-pool/31-01-PLANNER-GATE-VERIFICATION.md",
  );
  writeFileSync(outPath, lines.join("\n") + "\n", "utf-8");
  console.error(`\n[script] wrote: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
