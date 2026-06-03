// SOL-PREP-01 — Solana payloadFingerprint canonical-fixture regression file.
// Sibling of `test/signing-fingerprint.test.ts` (EVM). Phase 12 — Plan 12-01.
//
// Fixture taxonomy (CLAUDE.md "Cryptographic-binding fixtures pinned as
// hardcoded literals" — NO `beforeAll`-snapshot; drift in preimage assembly
// MUST fail at a specific line, not pass against a self-snapshotted value):
//
//   Fixture K — native SOL transfer fingerprint (consumed by
//               `test/prepare-solana-native-send.test.ts` Plan 12-02 +
//               `test/solana-trust-pipeline.integration.test.ts` Plan 12-05).
//   Fixture L — SPL TransferChecked fingerprint (consumed by
//               `test/prepare-solana-spl-send.test.ts` Plan 12-03 +
//               `test/solana-trust-pipeline.integration.test.ts` Plan 12-05).
//
// Phase 8 Fixture J at `test/signing-fingerprint.test.ts:182` (chain-distinctness
// property over the EVM family of chainIds) is FROZEN — Solana fixtures live
// here per RESEARCH OQ-2 lock.
//
// SENDER-DEPENDENCE: the Solana fingerprint includes `feePayer` (account_keys[0]
// of `Transaction.serializeMessage()`), so swapping the feePayer DOES change the
// fingerprint. This is correct — Solana's signed message bytes include
// account_keys[0], unlike EVM's EIP-1559 preimage which omits the `from`
// field. The persona-cycle property assertion lands in the integration test
// (Plan 12-05), mirroring Phase 7's T-INTEGRATION-FROM-DRIFT-2 precedent.

import {
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { execFileSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  FINGERPRINT_DOMAIN_TAG_SOLANA,
  _solanaFingerprint,
  computeSolanaPayloadFingerprint,
} from "../src/signing/payload-fingerprint-solana.js";
// Phase 13 Plan 13-03 — MarginFi ix builders for fixtures O–S.
import {
  buildDepositIx,
  buildWithdrawIx,
  buildBorrowIx,
  buildRepayIx,
  buildAccountInitPdaIx,
} from "../src/protocols/marginfi.js";
// Phase 13 Plan 13-05/06 — Kamino ix builders + assembler for fixtures T–W (ops)
// + X–Y (obligation-init). The FULL ordered refresh-ceremony vector is anchored,
// NOT just the op ix (Pattern 2 / Pitfall 2).
import {
  KAMINO_DISCRIMINATOR,
  _kamino,
} from "../src/protocols/kamino.js";

// Pinned inputs — used identically by Fixture K + L. Stable across runs.
// `FROM` is the curated `solana-whale` persona address from Plan 11-06
// (Binance hot wallet). `TO` is a deterministic on-curve recipient generated
// from `Keypair.fromSeed(Buffer.alloc(32, 1))` — pinned as a literal so the
// test does not depend on Keypair internals.
const FROM = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const TO = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
// Fixed-blockhash sentinel — all-1s base58 form is the canonical
// "system program address" pubkey shape; pinned here as a deterministic
// blockhash value so message serialization is stable across test runs.
const FIXED_BLOCKHASH = "11111111111111111111111111111111";

describe("computeSolanaPayloadFingerprint — SOL-PREP-01 (DF-1 LOCKED)", () => {
  it("domain-tag length invariant: 20 UTF-8 bytes (distinct from EVM 23-byte tag)", () => {
    // String-length invariant (matches the plan's success criterion).
    expect(FINGERPRINT_DOMAIN_TAG_SOLANA.length).toBe(20);
    // UTF-8 byte-length invariant — load-bearing: cross-chain reuse impossible
    // by construction (EVM tag is 23 bytes; mismatched-length preimage cannot
    // collide). Plan 12-PLAN-CHECK verified the two assertions agree because
    // the tag contains only ASCII characters (each ≤ 0x7F, so .length === byteLength).
    expect(Buffer.byteLength(FINGERPRINT_DOMAIN_TAG_SOLANA, "utf8")).toBe(20);
    // Exact tag value pinned — prevents accidental rename / version bump
    // without explicit intent. v2 fingerprint format would change "v1:" → "v2:".
    expect(FINGERPRINT_DOMAIN_TAG_SOLANA).toBe("VaultPilot-soltx-v1:");
  });

  it("Fixture K — native SOL transfer fingerprint (hardcoded literal anchor)", () => {
    // Build the canonical Fixture K transaction:
    //   feePayer = solana-whale persona
    //   instruction = SystemProgram.transfer(FROM → TO, 1_000_000_000 lamports = 1 SOL)
    //   recentBlockhash = "1111…" sentinel (pinned for deterministic message bytes)
    const tx = new Transaction({
      recentBlockhash: FIXED_BLOCKHASH,
      feePayer: FROM,
    });
    tx.add(
      SystemProgram.transfer({
        fromPubkey: FROM,
        toPubkey: TO,
        lamports: 1_000_000_000,
      }),
    );
    const messageBytes = new Uint8Array(tx.serializeMessage());
    // Stable byte-length anchor — catches any future serializeMessage shape change.
    expect(messageBytes.length).toBe(150);

    const fp = computeSolanaPayloadFingerprint({ messageBytes });

    // Hardcoded literal anchor (Plan 12-01 hardening — execute-time
    // computation pinned forever). Independently computed at PR-write time
    // via a discardable `node -e` script:
    //   const { keccak256, toBytes, concat } = require("viem");
    //   const tag = toBytes("VaultPilot-soltx-v1:");
    //   keccak256(concat([tag, messageBytes]))
    // Cross-linked from `test/prepare-solana-native-send.test.ts` (Plan
    // 12-02) and `test/solana-trust-pipeline.integration.test.ts` (Plan 12-05).
    expect(fp).toBe("0x7c3d1fbcea9a6823b6e1bbb76b45ec68cd4998f25727d3bfb7b17a389040d0d3");
  });

  it("Fixture L — SPL TransferChecked fingerprint (hardcoded literal anchor)", () => {
    // Build the canonical Fixture L transaction:
    //   feePayer = solana-whale persona
    //   instruction = TransferChecked(sourceAta → destAta, 100_000_000 raw, decimals=6)
    //     mint     = USDC-Solana (EPjF…)
    //     authority = FROM (the owner of sourceAta)
    //   recentBlockhash = "1111…" sentinel.
    // Both ATAs are deterministic per `getAssociatedTokenAddressSync` (derived
    // from owner + mint via PDA seeds) — no random Keypair involvement.
    const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const sourceAta = getAssociatedTokenAddressSync(USDC_MINT, FROM);
    const destAta = getAssociatedTokenAddressSync(USDC_MINT, TO);
    // Stable ATA literals — catches any future ATA-derivation change.
    expect(sourceAta.toBase58()).toBe("FzbcyEZ9m8xjtergWgWDq7mfPoHEbboBF791B6cTpzbq");
    expect(destAta.toBase58()).toBe("3wvJdyFnGvaMWpbq93NU91SggiVRveULUXL6iX5VZDGP");

    const tx = new Transaction({
      recentBlockhash: FIXED_BLOCKHASH,
      feePayer: FROM,
    });
    tx.add(
      createTransferCheckedInstruction(
        sourceAta,
        USDC_MINT,
        destAta,
        FROM,
        100_000_000,
        6,
      ),
    );
    const messageBytes = new Uint8Array(tx.serializeMessage());
    expect(messageBytes.length).toBe(214);

    const fp = computeSolanaPayloadFingerprint({ messageBytes });

    // Hardcoded literal anchor (Plan 12-01 hardening). Cross-linked from
    // `test/prepare-solana-spl-send.test.ts` (Plan 12-03) and
    // `test/solana-trust-pipeline.integration.test.ts` (Plan 12-05).
    expect(fp).toBe("0xabc93c06958f81a6bf9e626f9ac6437c80aac0ee55a1bafb984c266619e8bd92");
  });

  it("Fixture L calldata-embedding regression: amount swap changes fingerprint", () => {
    // Same setup as Fixture L but with amount = 100_000_001 (one raw unit
    // more). The fingerprint MUST differ — proves the instruction data IS
    // in the preimage (regression against an accidentally-static preimage
    // assembly that ignores instruction data). Mirrors Phase 6 Fixture D
    // shape.
    const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const sourceAta = getAssociatedTokenAddressSync(USDC_MINT, FROM);
    const destAta = getAssociatedTokenAddressSync(USDC_MINT, TO);

    const txA = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
    txA.add(
      createTransferCheckedInstruction(sourceAta, USDC_MINT, destAta, FROM, 100_000_000, 6),
    );
    const fpA = computeSolanaPayloadFingerprint({
      messageBytes: new Uint8Array(txA.serializeMessage()),
    });

    const txB = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
    txB.add(
      createTransferCheckedInstruction(sourceAta, USDC_MINT, destAta, FROM, 100_000_001, 6),
    );
    const fpB = computeSolanaPayloadFingerprint({
      messageBytes: new Uint8Array(txB.serializeMessage()),
    });

    expect(fpA).not.toBe(fpB);
    // Both are well-formed 32-byte 0x-prefixed hex strings (66 chars total).
    expect(fpA).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fpB).toMatch(/^0x[0-9a-f]{64}$/);
    // Anchor on the +1 fixture literal so a future preimage-assembly drift
    // surfaces at this exact line rather than as a generic "not equal".
    expect(fpB).toBe("0x9b6b628f30ed1dc6eeefa3dc258586fc3e21422000d09ad72cc2e7c67a8060fe");
  });

  // ---------------------------------------------------------------------------
  // Phase 44 Plan 44-01 — Fixtures M (nonce_init) + N (nonce_close).
  // Same pinned inputs (FROM / NONCE_PUBKEY / FIXED_BLOCKHASH) so the literals
  // are deterministic. Hardcoded `0x…` anchors — NO beforeAll-snapshot (CLAUDE.md
  // cryptographic-binding-fixture rule). Cross-linked from
  // test/prepare-solana-nonce-init.test.ts (M) and
  // test/prepare-solana-nonce-close.test.ts (N) by letter.
  //
  // The nonce account pubkey reuses the canonical RECIPIENT (`TO`) literal as a
  // deterministic stand-in for a fresh nonce keypair — its base58 is pinned, so
  // the message bytes (and fingerprint) are stable across runs.
  // ---------------------------------------------------------------------------
  const NONCE_PUBKEY = TO; // deterministic pinned nonce-account pubkey
  const RENT_LAMPORTS = 1_447_680; // canonical rent anchor (RESEARCH §Rent/sizing)

  it("Fixture M — nonce_init message fingerprint (hardcoded literal anchor)", () => {
    // createAccount(from → noncePubkey, lamports=rent, space=80) + nonceInitialize(authority=from)
    const tx = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: FROM,
        newAccountPubkey: NONCE_PUBKEY,
        lamports: RENT_LAMPORTS,
        space: NONCE_ACCOUNT_LENGTH,
        programId: SystemProgram.programId,
      }),
    );
    tx.add(
      SystemProgram.nonceInitialize({
        noncePubkey: NONCE_PUBKEY,
        authorizedPubkey: FROM,
      }),
    );
    const messageBytes = new Uint8Array(tx.serializeMessage());
    // Stable byte-length anchor — catches any future serializeMessage shape change.
    expect(messageBytes.length).toBe(296);

    const fp = computeSolanaPayloadFingerprint({ messageBytes });
    // Hardcoded literal anchor (Plan 44-01). A tampered message byte flips this
    // at THIS line. Independently recomputable via the same tag/concat/keccak256.
    expect(fp).toBe(
      "0xf23e8e0041a47c94894797b2430b3814a3416670404e16da779564f435ecd809",
    );
  });

  it("Fixture M authority-embedding regression: authority swap changes fingerprint", () => {
    // Same createAccount, but nonceInitialize authority = TO instead of FROM.
    // Proves the authority IS in the preimage (regression against an assembly
    // that ignores the authority encoded in the nonceInitialize instruction data).
    const build = (authority: PublicKey) => {
      const tx = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
      tx.add(
        SystemProgram.createAccount({
          fromPubkey: FROM,
          newAccountPubkey: NONCE_PUBKEY,
          lamports: RENT_LAMPORTS,
          space: NONCE_ACCOUNT_LENGTH,
          programId: SystemProgram.programId,
        }),
      );
      tx.add(SystemProgram.nonceInitialize({ noncePubkey: NONCE_PUBKEY, authorizedPubkey: authority }));
      return computeSolanaPayloadFingerprint({
        messageBytes: new Uint8Array(tx.serializeMessage()),
      });
    };
    const fpAuthFrom = build(FROM);
    const fpAuthTo = build(NONCE_PUBKEY);
    expect(fpAuthFrom).not.toBe(fpAuthTo);
    expect(fpAuthFrom).toBe(
      "0xf23e8e0041a47c94894797b2430b3814a3416670404e16da779564f435ecd809",
    );
  });

  it("Fixture N — nonce_close message fingerprint (hardcoded literal anchor)", () => {
    // nonceWithdraw(noncePubkey → toPubkey=from, authority=from, lamports=full balance)
    const tx = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
    tx.add(
      SystemProgram.nonceWithdraw({
        noncePubkey: NONCE_PUBKEY,
        authorizedPubkey: FROM,
        toPubkey: FROM,
        lamports: RENT_LAMPORTS,
      }),
    );
    const messageBytes = new Uint8Array(tx.serializeMessage());
    expect(messageBytes.length).toBe(217);

    const fp = computeSolanaPayloadFingerprint({ messageBytes });
    expect(fp).toBe(
      "0x4cb389760626e559c85fca6d9f3d14c4408871fd034c73f1a82fe4d797f8dea2",
    );
  });

  it("Fixture N amount-embedding regression: withdraw amount swap changes fingerprint", () => {
    // Same nonceWithdraw, +1 lamport. Proves the lamport amount IS in the preimage.
    const build = (lamports: number) => {
      const tx = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
      tx.add(
        SystemProgram.nonceWithdraw({
          noncePubkey: NONCE_PUBKEY,
          authorizedPubkey: FROM,
          toPubkey: FROM,
          lamports,
        }),
      );
      return computeSolanaPayloadFingerprint({
        messageBytes: new Uint8Array(tx.serializeMessage()),
      });
    };
    const fpA = build(RENT_LAMPORTS);
    const fpB = build(RENT_LAMPORTS + 1);
    expect(fpA).not.toBe(fpB);
    expect(fpA).toBe(
      "0x4cb389760626e559c85fca6d9f3d14c4408871fd034c73f1a82fe4d797f8dea2",
    );
  });

  it("_solanaFingerprint spy-affordance regression — ESM indirection intercepts", () => {
    // CLAUDE.md ESM spy-affordance non-negotiable: the indirection object is
    // present (added at write time, NOT retroactively). A direct
    // `vi.spyOn(*, "computeSolanaPayloadFingerprint")` on the named export
    // would silently no-op due to immutable ESM bindings; the indirection
    // is the test seam. This test proves the seam works — Plans 12-02 /
    // 12-04 / 12-05 will rely on it.
    const spy = vi
      .spyOn(_solanaFingerprint, "computeSolanaPayloadFingerprint")
      .mockReturnValue("0xdeadbeef" as `0x${string}`);

    const fakeBytes = new Uint8Array([1, 2, 3, 4]);
    const result = _solanaFingerprint.computeSolanaPayloadFingerprint({
      messageBytes: fakeBytes,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ messageBytes: fakeBytes });
    expect(result).toBe("0xdeadbeef");

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Phase 13 Plan 13-03 — MarginFi fingerprint fixtures O–S.
//
// Each fixture builds the canonical MarginFi tx for that ix shape (pinned
// feePayer + recentBlockhash + ordered account metas + args), serializes the
// message via `Transaction.serializeMessage()`, runs the FROZEN
// `computeSolanaPayloadFingerprint`, and asserts a HARDCODED 0x… literal — NO
// beforeAll-snapshot (drift in the IDL-hand-encode preimage MUST fail at a
// specific line). Each fixture also asserts the 8-byte IDL discriminator is
// byte-identical at the head of the encoded instruction data. An amount/account
// swap regression per fixture proves the embedding (mirror Fixture L/M style).
//
// New tx shapes flow THROUGH the FROZEN binding unchanged — these fixtures ADD
// sibling literals; they never edit payload-fingerprint-solana.ts.
// ---------------------------------------------------------------------------
describe("MarginFi fingerprint fixtures O–S (Plan 13-03, D-01 hand-encode)", () => {
  // Pinned canonical accounts (deterministic literals). FEE_PAYER == authority.
  const MF_GROUP = new PublicKey("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8");
  const MF_AUTH = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
  // The MarginfiAccount PDA for MF_AUTH at accountIndex 0 (deterministic).
  const MF_ACCOUNT = new PublicKey("3m9y53V2QwBbrQxtv5WN4T8SA5zw7BpZ2ZBYpZZAu8MW");
  const MF_BANK = new PublicKey("CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh");
  const MF_TOKEN_ACCT = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
  const MF_LIQ_VAULT = new PublicKey("7uYDwDDvFvKsHnvjt9D8gj2Gfd9Xzn4QYsf8KXrXrJsy");
  const MF_VAULT_AUTH = new PublicKey("D9z5pxYZ7tqkQ6oFwvQyZ4QyhRjuw6JtVefdT4U6kx2y");

  // Discriminators from src/config/idl/marginfi_0.1.8.json (VERIFIED).
  const DISC = {
    deposit: [171, 94, 235, 103, 82, 64, 212, 140],
    withdraw: [36, 72, 74, 19, 210, 210, 192, 192],
    borrow: [4, 126, 116, 53, 48, 5, 212, 31],
    repay: [79, 209, 172, 177, 222, 51, 173, 151],
    initPda: [87, 177, 91, 80, 218, 119, 245, 31],
  };

  function discHead(ix: { data: Uint8Array | Buffer }): number[] {
    return [...ix.data.slice(0, 8)];
  }

  function fpOf(ix: import("@solana/web3.js").TransactionInstruction): string {
    const tx = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: MF_AUTH });
    tx.add(ix);
    return computeSolanaPayloadFingerprint({
      messageBytes: new Uint8Array(tx.serializeMessage()),
    });
  }

  const singleAccts = {
    group: MF_GROUP,
    marginfiAccount: MF_ACCOUNT,
    authority: MF_AUTH,
    bank: MF_BANK,
    signerTokenAccount: MF_TOKEN_ACCT,
    liquidityVault: MF_LIQ_VAULT,
  };
  const vaultAuthAccts = {
    group: MF_GROUP,
    marginfiAccount: MF_ACCOUNT,
    authority: MF_AUTH,
    bank: MF_BANK,
    destinationTokenAccount: MF_TOKEN_ACCT,
    bankLiquidityVaultAuthority: MF_VAULT_AUTH,
    liquidityVault: MF_LIQ_VAULT,
  };

  it("Fixture O — lending_account_deposit (supply): discriminator + hardcoded fingerprint", () => {
    const ix = buildDepositIx({ accounts: singleAccts, amount: 100_000_000n });
    expect(discHead(ix)).toEqual(DISC.deposit);
    expect(fpOf(ix)).toBe(
      "0x102842fc9ec5b497d767ef86dc28fe5d174753b6de0ab733e28ab54aa131dbb4",
    );
  });

  it("Fixture O embedding regression: amount swap changes the fingerprint", () => {
    const fpA = fpOf(buildDepositIx({ accounts: singleAccts, amount: 100_000_000n }));
    const fpB = fpOf(buildDepositIx({ accounts: singleAccts, amount: 100_000_001n }));
    expect(fpA).not.toBe(fpB);
    expect(fpA).toBe(
      "0x102842fc9ec5b497d767ef86dc28fe5d174753b6de0ab733e28ab54aa131dbb4",
    );
  });

  it("Fixture P — lending_account_withdraw: discriminator + vault-authority + hardcoded fingerprint", () => {
    const ix = buildWithdrawIx({ accounts: vaultAuthAccts, amount: 50_000_000n });
    expect(discHead(ix)).toEqual(DISC.withdraw);
    // The bank_liquidity_vault_authority PDA is present (account index 5).
    expect(ix.keys[5]!.pubkey.toBase58()).toBe(MF_VAULT_AUTH.toBase58());
    expect(fpOf(ix)).toBe(
      "0x3b52a0d3c3c2ea5e741c8524a9af195e94e451f65291b6446ac517179bb10387",
    );
  });

  it("Fixture P embedding regression: amount swap changes the fingerprint", () => {
    const fpA = fpOf(buildWithdrawIx({ accounts: vaultAuthAccts, amount: 50_000_000n }));
    const fpB = fpOf(buildWithdrawIx({ accounts: vaultAuthAccts, amount: 50_000_001n }));
    expect(fpA).not.toBe(fpB);
  });

  it("Fixture Q — lending_account_borrow: discriminator + vault-authority + hardcoded fingerprint", () => {
    const ix = buildBorrowIx({ accounts: vaultAuthAccts, amount: 25_000_000n });
    expect(discHead(ix)).toEqual(DISC.borrow);
    expect(ix.keys[5]!.pubkey.toBase58()).toBe(MF_VAULT_AUTH.toBase58());
    expect(fpOf(ix)).toBe(
      "0xc98fd6c6903d05a7858d5472b7aa2e10669e5ff98561723d7fe27df30d5a7626",
    );
  });

  it("Fixture Q embedding regression: amount swap changes the fingerprint", () => {
    const fpA = fpOf(buildBorrowIx({ accounts: vaultAuthAccts, amount: 25_000_000n }));
    const fpB = fpOf(buildBorrowIx({ accounts: vaultAuthAccts, amount: 25_000_001n }));
    expect(fpA).not.toBe(fpB);
  });

  it("Fixture R — lending_account_repay: discriminator + hardcoded fingerprint", () => {
    const ix = buildRepayIx({ accounts: singleAccts, amount: 75_000_000n });
    expect(discHead(ix)).toEqual(DISC.repay);
    expect(fpOf(ix)).toBe(
      "0xb27eb2312cf1050525a470d89d2a2da3e83864207d9e94b8948e2ff4c1b59504",
    );
  });

  it("Fixture R embedding regression: amount swap changes the fingerprint", () => {
    const fpA = fpOf(buildRepayIx({ accounts: singleAccts, amount: 75_000_000n }));
    const fpB = fpOf(buildRepayIx({ accounts: singleAccts, amount: 75_000_001n }));
    expect(fpA).not.toBe(fpB);
  });

  it("Fixture S — marginfi_account_initialize_pda: discriminator + hardcoded fingerprint (Ledger-safe variant)", () => {
    const ix = buildAccountInitPdaIx({
      accounts: {
        marginfiGroup: MF_GROUP,
        marginfiAccount: MF_ACCOUNT,
        authority: MF_AUTH,
        feePayer: MF_AUTH,
      },
      accountIndex: 0,
    });
    // Assert the _pda discriminator (T-13-07 — NOT the Keypair-signer variant).
    expect(discHead(ix)).toEqual(DISC.initPda);
    expect(fpOf(ix)).toBe(
      "0x535aab49143386e1adcbffb6713b1c1c6b494df9706cb4393fc4523b4a5b2710",
    );
  });

  it("Fixture S embedding regression: account_index swap changes the fingerprint", () => {
    const mk = (idx: number) =>
      fpOf(
        buildAccountInitPdaIx({
          accounts: {
            marginfiGroup: MF_GROUP,
            marginfiAccount: MF_ACCOUNT,
            authority: MF_AUTH,
            feePayer: MF_AUTH,
          },
          accountIndex: idx,
        }),
      );
    expect(mk(0)).not.toBe(mk(1));
    expect(mk(0)).toBe(
      "0x535aab49143386e1adcbffb6713b1c1c6b494df9706cb4393fc4523b4a5b2710",
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 13 Plan 13-05 — Kamino fingerprint fixtures T–W (D-01 hand-encode +
// Pattern 2 refresh ceremony). Each fixture anchors the FULL ORDERED instruction
// vector (refreshReserve × N + refreshObligation + op) — NOT just the op ix.
// NO beforeAll-snapshot. The discriminators are the custom klend codegen
// DISCRIMINATOR literals (NOT sha256("global:<ix>")[..8] — the klend program
// uses custom discriminators).
// ---------------------------------------------------------------------------
describe("Kamino fingerprint fixtures T–W (Plan 13-05, D-01 + refresh ceremony)", () => {
  // Pinned canonical accounts (deterministic literals). FEE_PAYER == owner.
  const K_OWNER = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
  const K_MARKET = new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
  const K_OBLIGATION = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
  const K_LMA = new PublicKey("9zdpqAgENj4734TQvqj4Zo6srH7Pk29VKnNh5fHMwTgo");
  const RES_C = new PublicKey("8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36"); // collateral reserve
  const RES_B = new PublicKey("d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q"); // borrow reserve
  const PYTH = new PublicKey("H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG");
  const SB_PRICE = new PublicKey("So11111111111111111111111111111111111111112");
  const SB_TWAP = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const SCOPE = new PublicKey("3NJYftD5sjVfxSnUdZ1wVML8f3aC6mp1CXCL6L7TnU8C");
  const TOKEN_PROG = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
  const SUPPLY = new PublicKey("FxteHmLwG9nk1eL4pjNve3Eub2goGkkz6g6TLvdmDyq5");
  const COLL_MINT = new PublicKey("Gf6JxqgL3MwxAm7AmqsTNFGz7c2EFXY7g7CqJZBfHWqV");
  const DEST_COLL = new PublicKey("D9z5pxYZ7tqkQ6oFwvQyZ4QyhRjuw6JtVefdT4U6kx2y");
  const USER_LIQ = new PublicKey("3m9y53V2QwBbrQxtv5WN4T8SA5zw7BpZ2ZBYpZZAu8MW");
  const FEE_RECEIVER = new PublicKey("HRk9CMrpq7Jn9sh7mzxE8CChHG8dneX9p475QKz4Fsfc");
  const REFERRER = new PublicKey("CWE8jPTUYhdCTZYWPTe1o5DFqfdjzWKc9WKz6rSjQUdG");
  const SRC_COLL = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi8");

  const ORACLE_PROGS = [PYTH.toBase58(), SB_PRICE.toBase58(), SB_TWAP.toBase58(), SCOPE.toBase58()];

  function discHead(ix: { data: Uint8Array | Buffer }): number[] {
    return [...ix.data.slice(0, 8)];
  }

  function refreshIx(reserve: PublicKey) {
    return _kamino.buildRefreshReserveIx({
      reserve,
      lendingMarket: K_MARKET,
      pythOracle: PYTH,
      switchboardPriceOracle: SB_PRICE,
      switchboardTwapOracle: SB_TWAP,
      scopePrices: SCOPE,
    });
  }
  function refreshObligationIx() {
    return _kamino.buildRefreshObligationIx({ lendingMarket: K_MARKET, obligation: K_OBLIGATION });
  }
  function fpOfVector(ixs: import("@solana/web3.js").TransactionInstruction[]): string {
    return computeSolanaPayloadFingerprint({
      messageBytes: _kamino.assembleKaminoTx({
        instructions: ixs,
        ixNames: ixs.map(() => "x"),
        oracleProgramIds: ORACLE_PROGS,
        feePayer: K_OWNER,
        recentBlockhash: FIXED_BLOCKHASH,
      }).messageBytes,
    });
  }

  function depositIx(amount: bigint) {
    return _kamino.buildDepositIx({
      amount,
      accounts: {
        owner: K_OWNER, obligation: K_OBLIGATION, lendingMarket: K_MARKET, lendingMarketAuthority: K_LMA,
        reserve: RES_C, reserveLiquidityMint: MINT, reserveLiquiditySupply: SUPPLY,
        reserveCollateralMint: COLL_MINT, reserveDestinationDepositCollateral: DEST_COLL,
        userSourceLiquidity: USER_LIQ, collateralTokenProgram: TOKEN_PROG, liquidityTokenProgram: TOKEN_PROG,
      },
    });
  }
  function withdrawIx(amount: bigint) {
    return _kamino.buildWithdrawIx({
      amount,
      accounts: {
        owner: K_OWNER, obligation: K_OBLIGATION, lendingMarket: K_MARKET, lendingMarketAuthority: K_LMA,
        withdrawReserve: RES_C, reserveLiquidityMint: MINT, reserveSourceCollateral: SRC_COLL,
        reserveCollateralMint: COLL_MINT, reserveLiquiditySupply: SUPPLY, userDestinationLiquidity: USER_LIQ,
        collateralTokenProgram: TOKEN_PROG, liquidityTokenProgram: TOKEN_PROG,
      },
    });
  }
  function borrowIx(amount: bigint) {
    return _kamino.buildBorrowIx({
      amount,
      accounts: {
        owner: K_OWNER, obligation: K_OBLIGATION, lendingMarket: K_MARKET, lendingMarketAuthority: K_LMA,
        borrowReserve: RES_B, borrowReserveLiquidityMint: MINT, reserveSourceLiquidity: SUPPLY,
        borrowReserveLiquidityFeeReceiver: FEE_RECEIVER, userDestinationLiquidity: USER_LIQ,
        referrerTokenState: REFERRER, tokenProgram: TOKEN_PROG,
      },
    });
  }
  function repayIx(amount: bigint) {
    return _kamino.buildRepayIx({
      amount,
      accounts: {
        owner: K_OWNER, obligation: K_OBLIGATION, lendingMarket: K_MARKET, repayReserve: RES_B,
        reserveLiquidityMint: MINT, reserveDestinationLiquidity: SUPPLY, userSourceLiquidity: USER_LIQ,
        tokenProgram: TOKEN_PROG,
      },
    });
  }

  it("Fixture T — deposit (supply): refreshReserve + refreshObligation + deposit, discriminators + hardcoded fingerprint", () => {
    const op = depositIx(1_000_000n);
    expect(discHead(op)).toEqual(KAMINO_DISCRIMINATOR.depositReserveLiquidityAndObligationCollateral);
    const vector = [refreshIx(RES_C), refreshObligationIx(), op];
    expect(discHead(vector[0]!)).toEqual(KAMINO_DISCRIMINATOR.refreshReserve);
    expect(discHead(vector[1]!)).toEqual(KAMINO_DISCRIMINATOR.refreshObligation);
    expect(fpOfVector(vector)).toBe(
      "0xf3e332a9545770fc7a97d8e8f57b4bf85125ff14a32510cb9c7e334b7edfe99f",
    );
  });

  it("Fixture T ordering regression: refreshObligation AFTER the op changes the fingerprint", () => {
    const correct = fpOfVector([refreshIx(RES_C), refreshObligationIx(), depositIx(1_000_000n)]);
    const reordered = fpOfVector([refreshIx(RES_C), depositIx(1_000_000n), refreshObligationIx()]);
    expect(correct).not.toBe(reordered);
    const dropped = fpOfVector([refreshObligationIx(), depositIx(1_000_000n)]); // missing refreshReserve
    expect(correct).not.toBe(dropped);
  });

  it("Fixture U — withdraw (multi-reserve): refreshReserve×2 + refreshObligation + withdraw", () => {
    const op = withdrawIx(500_000n);
    expect(discHead(op)).toEqual(KAMINO_DISCRIMINATOR.withdrawObligationCollateralAndRedeemReserveCollateral);
    const vector = [refreshIx(RES_C), refreshIx(RES_B), refreshObligationIx(), op];
    expect(fpOfVector(vector)).toBe(
      "0xbc706a4bcfebff3b2cf45b476172a345418b27bdb6ee8fb06a0fa24905025683",
    );
  });

  it("Fixture U embedding regression: amount swap changes the fingerprint", () => {
    const a = fpOfVector([refreshIx(RES_C), refreshIx(RES_B), refreshObligationIx(), withdrawIx(500_000n)]);
    const b = fpOfVector([refreshIx(RES_C), refreshIx(RES_B), refreshObligationIx(), withdrawIx(500_001n)]);
    expect(a).not.toBe(b);
  });

  it("Fixture V — borrow (multi-reserve): refreshReserve×2 + refreshObligation + borrow", () => {
    const op = borrowIx(250_000n);
    expect(discHead(op)).toEqual(KAMINO_DISCRIMINATOR.borrowObligationLiquidity);
    const vector = [refreshIx(RES_C), refreshIx(RES_B), refreshObligationIx(), op];
    expect(fpOfVector(vector)).toBe(
      "0x2b0962c92f42ccfdd46188c02f7f77dc13c05822bd777f363b3323ca56deea5e",
    );
  });

  it("Fixture V embedding regression: amount swap changes the fingerprint", () => {
    const a = fpOfVector([refreshIx(RES_C), refreshIx(RES_B), refreshObligationIx(), borrowIx(250_000n)]);
    const b = fpOfVector([refreshIx(RES_C), refreshIx(RES_B), refreshObligationIx(), borrowIx(250_001n)]);
    expect(a).not.toBe(b);
  });

  it("Fixture W — repay: refreshReserve + refreshObligation + repay", () => {
    const op = repayIx(750_000n);
    expect(discHead(op)).toEqual(KAMINO_DISCRIMINATOR.repayObligationLiquidity);
    const vector = [refreshIx(RES_B), refreshObligationIx(), op];
    expect(fpOfVector(vector)).toBe(
      "0x490c3f118f341520c2be99697474511f4b0ca6ca7968b8c646f7103c68c7a9f9",
    );
  });

  it("Fixture W embedding regression: amount swap changes the fingerprint", () => {
    const a = fpOfVector([refreshIx(RES_B), refreshObligationIx(), repayIx(750_000n)]);
    const b = fpOfVector([refreshIx(RES_B), refreshObligationIx(), repayIx(750_001n)]);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Phase 13 Plan 13-06 — Kamino obligation-init fixture X–Y (D-01 + V9). The init
// tool emits BOTH ix in ONE tx (one device approval = "set me up on Kamino" —
// one-intent-per-device-screen), so we anchor ONE fixture over the ordered 2-ix
// vector (initUserMetadata FIRST — V9: obligation requires userMetadata to
// exist). NO beforeAll-snapshot. The ordering regression proves the order is
// byte-bound.
// ---------------------------------------------------------------------------
describe("Kamino obligation-init fixture X–Y (Plan 13-06, D-01 + V9 2-step)", () => {
  const K_OWNER = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
  const K_MARKET = new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
  const K_OBLIGATION = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
  const K_USER_META = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

  function discHead(ix: { data: Uint8Array | Buffer }): number[] {
    return [...ix.data.slice(0, 8)];
  }

  function initUserMetaIx() {
    return _kamino.buildInitUserMetadataIx({ owner: K_OWNER, feePayer: K_OWNER, userMetadata: K_USER_META });
  }
  function initObligationIx() {
    return _kamino.buildInitObligationIx({
      obligationOwner: K_OWNER, feePayer: K_OWNER, obligation: K_OBLIGATION,
      lendingMarket: K_MARKET, ownerUserMetadata: K_USER_META,
    });
  }
  function fpOf(ixs: import("@solana/web3.js").TransactionInstruction[]): string {
    return computeSolanaPayloadFingerprint({
      messageBytes: _kamino.assembleKaminoTx({
        instructions: ixs,
        ixNames: ixs.map(() => "x"),
        oracleProgramIds: [],
        feePayer: K_OWNER,
        recentBlockhash: FIXED_BLOCKHASH,
      }).messageBytes,
    });
  }

  it("Fixture X–Y — ordered 2-ix init pair (initUserMetadata THEN initObligation): discriminators + hardcoded fingerprint", () => {
    const um = initUserMetaIx();
    const ob = initObligationIx();
    expect(discHead(um)).toEqual(KAMINO_DISCRIMINATOR.initUserMetadata);
    expect(discHead(ob)).toEqual(KAMINO_DISCRIMINATOR.initObligation);
    expect(fpOf([um, ob])).toBe(
      "0x2a60ccbbe54b4575f1f9cfd7f7e04c79013295d00e9b6b27bfa98e0d624428a7",
    );
  });

  it("ordering regression: initObligation BEFORE initUserMetadata changes the fingerprint (V9 order is bound)", () => {
    const correct = fpOf([initUserMetaIx(), initObligationIx()]);
    const swapped = fpOf([initObligationIx(), initUserMetaIx()]);
    expect(correct).not.toBe(swapped);
    expect(correct).toBe(
      "0x2a60ccbbe54b4575f1f9cfd7f7e04c79013295d00e9b6b27bfa98e0d624428a7",
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 44 Plan 44-01 — FROZEN cryptographic-binding-chain zero-diff gate.
//
// The Solana fingerprint + presign-hash modules are FROZEN: Phase 44 nonce
// shapes flow through the UNCHANGED serialize→keccak / serialize→sha256 paths
// (CONTEXT §Design Fork (d) LOCKED). This gate asserts those two files are
// byte-identical to origin/main — any inadvertent edit (e.g. a nonce-specific
// branch added to the binding layer) fails HERE rather than silently shipping.
//
// `git diff` returns empty when the file matches origin/main. If origin/main is
// not fetched in the CI environment, the test skips (the worktree-level FROZEN
// proof in the PR body is the authoritative gate; this is the in-suite guard).
// ---------------------------------------------------------------------------
describe("FROZEN Solana cryptographic-binding chain — zero-diff vs origin/main", () => {
  const FROZEN_FILES = [
    "src/signing/payload-fingerprint-solana.ts",
    "src/signing/presign-hash-solana.ts",
  ];

  for (const file of FROZEN_FILES) {
    it(`${file} is byte-identical to origin/main (no nonce-specific binding branches)`, () => {
      let diff: string;
      try {
        diff = execFileSync(
          "git",
          ["diff", "origin/main", "--", file],
          { encoding: "utf8" },
        );
      } catch {
        // origin/main not available (shallow CI clone, etc.) — skip rather than
        // fail spuriously. The PR-body FROZEN proof is the authoritative gate.
        return;
      }
      expect(diff).toBe("");
    });
  }
});
