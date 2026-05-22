// test/tools-sign-btc-multisig-psbt.test.ts — Phase 25 Plan 25-03 (TDD RED)
//
// Tests for the sign_btc_multisig_psbt MCP tool handler.
//
// Covers (behavior block from Plan 25-03):
//   - Valid PSBT + registered wallet (with walletHmac) → handle (kind: multisig-psbt)
//   - Fixture X re-anchor: payloadFingerprint == 0xced8fc41... for the Fixture X PSBT
//   - MULTISIG_WALLET_NOT_FOUND for an unregistered walletName
//   - MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE when registry record has no walletHmac
//   - INVALID_INPUT for malformed PSBT base64
//   - preview_send for a multisig-psbt handle emits per-input co-signer status rows
//   - send_transaction for a multisig-psbt handle calls signBtcMultisigPsbt and returns updatedPsbtBase64
//
// Seam strategy:
//   - btc-multisig-store: _resetBtcMultisigStoreForTesting + saveMultisigWallet to seed state
//   - Ledger transport: vi.spyOn(_btcLedgerTransport, "signBtcMultisigPsbt")
//   - BTC singlekey transport: vi.spyOn(_btcLedgerTransport, "signBtcPsbt") — spy to ensure NOT called
//
// Cross-link: Fixture X literal is defined in test/signing-fingerprint.test.ts.

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

beforeAll(() => {
  process.env["VAULTPILOT_BTC_MULTISIG_STORAGE"] = "memory";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

import { Psbt, payments, networks } from "bitcoinjs-lib";
import { BIP32Factory } from "bip32";
import * as tinySecp256k1 from "tiny-secp256k1";
import "../src/chains/bitcoin/types.js"; // initEccLib

import {
  _resetBtcMultisigStoreForTesting,
  saveMultisigWallet,
} from "../src/wallet/btc-multisig-store.js";
import { _btcLedgerTransport } from "../src/wallet/ledger-btc-transport.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";

// Import tool registrations
import "../src/tools/sign_btc_multisig_psbt.js";
import "../src/tools/preview_send.js";
import "../src/tools/send_transaction.js";

import { getRegisteredTool } from "../src/tools/index.js";
import { getHandleRecord } from "../src/signing/handle-store.js";

function getHandler(name: string) {
  const tool = getRegisteredTool(name);
  if (!tool) return undefined;
  return (args: Record<string, unknown>) => tool.handler(args);
}

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_XPUB_0 =
  "xpub6C1HVMz946r433QEjZGpYYWYcspxXXBPys5PBGkmQboRXE6RLfFiStEkKbWKCZaPgDrzZh9nUEunxuiuy6MNdw23du2Ek7GoKYMJVH8eK5E";
const TEST_XPUB_1 =
  "xpub6C1HVMz946r45SLqXksZWuaVdbpznU1s5peogGPTXqkHcXChkh7TN9vC2mgcSFkdA5YpX94xfAPWZTPoDJhGbUdVwF13RfkY9ioGHSLEuUE";
const TEST_XPUB_2 =
  "xpub6C1HVMz946r488Vd17BsrsybenwSabqNkg5b42wvkZKnru8Wzgp56AaLERXpDastZzbDMWFpcEh9TJy64YHEnfRg2Se6Zj4W88srAcemued";

const FP0 = "deadbeef";
const FP1 = "cafebabe";
const FP2 = "12345678";

const VALID_DESCRIPTOR = `wsh(sortedmulti(2,[${FP0}/84'/0'/0']${TEST_XPUB_0}/**,[${FP1}/84'/0'/0']${TEST_XPUB_1}/**,[${FP2}/84'/0'/0']${TEST_XPUB_2}/**))`;
const WALLET_NAME = "test-multisig";
const FAKE_HMAC = "a".repeat(64); // 32-byte hex

// ─── Fixture X PSBT (canonical BTC-PSBT-06/07 binding test vector) ─────────────
//
// 2-of-3 multisig P2WSH, 1 input (txid=bb*32, vout=0, value=1_000_000 sats,
// sequence=0xfffffffe), 1 P2WPKH output (900_000 sats).
// witnessScript = p2ms(m=2, sorted derived pubkeys at change=0 index=0).
//
// The payloadFingerprint for this PSBT = Fixture X = 0xced8fc41b79311a8...
// (pinned in test/signing-fingerprint.test.ts).
//
// Cross-link: test/signing-fingerprint.test.ts → "Fixture X — BTC 2-of-3 multisig
// P2WSH single-input → 0xced8fc41... byte-for-byte"

function buildFixtureXPsbt(): string {
  const bip32 = BIP32Factory(tinySecp256k1);
  const xpubs = [TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2];
  const pubkeys = xpubs.map((xpub) => {
    const node = bip32.fromBase58(xpub, networks.bitcoin);
    return Buffer.from(node.derive(0).derive(0).publicKey);
  });
  const sorted = [...pubkeys].sort(Buffer.compare);

  const p2ms = payments.p2ms({ m: 2, pubkeys: sorted, network: networks.bitcoin });
  const p2wsh = payments.p2wsh({ redeem: p2ms, network: networks.bitcoin });
  // P2WPKH output using first sorted pubkey (matches BTC_FIXTURE_SEGWIT_SCRIPT in signing-fingerprint.test.ts)
  const p2wpkh = payments.p2wpkh({ pubkey: sorted[0]!, network: networks.bitcoin });

  const psbt = new Psbt({ network: networks.bitcoin });
  psbt.addInput({
    hash: Buffer.alloc(32, 0xbb),
    index: 0,
    sequence: 0xfffffffe,
    witnessUtxo: {
      script: p2wsh.output!,
      value: BigInt(1_000_000),
    },
    witnessScript: p2ms.output!,
  });
  psbt.addOutput({
    script: p2wpkh.output!,
    value: BigInt(900_000),
  });
  return psbt.toBase64();
}

// ─── Seed helper ──────────────────────────────────────────────────────────────

function seedWallet(withHmac: boolean) {
  saveMultisigWallet({
    name: WALLET_NAME,
    descriptor: VALID_DESCRIPTOR,
    threshold: 2,
    totalSigners: 3,
    keyFingerprints: [FP0, FP1, FP2],
    firstAddresses: ["bc1qtest"],
    registeredAt: new Date().toISOString(),
    ...(withHmac ? { walletHmac: FAKE_HMAC } : {}),
  });
}

// ─── Tests: sign_btc_multisig_psbt ────────────────────────────────────────────

describe("sign_btc_multisig_psbt", () => {
  beforeEach(() => {
    _resetBtcMultisigStoreForTesting();
    _resetDemoModeForTesting();
  });

  it("is registered", () => {
    expect(getRegisteredTool("sign_btc_multisig_psbt")).toBeDefined();
  });

  it("returns MULTISIG_WALLET_NOT_FOUND for unregistered walletName", async () => {
    const handler = getHandler("sign_btc_multisig_psbt");
    const result = await handler!({
      psbt: buildFixtureXPsbt(),
      walletName: "nonexistent-wallet",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("MULTISIG_WALLET_NOT_FOUND");
  });

  it("returns MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE when walletHmac is absent", async () => {
    seedWallet(false); // no walletHmac
    const handler = getHandler("sign_btc_multisig_psbt");
    const result = await handler!({
      psbt: buildFixtureXPsbt(),
      walletName: WALLET_NAME,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE");
  });

  it("returns INVALID_INPUT for malformed PSBT base64", async () => {
    seedWallet(true);
    const handler = getHandler("sign_btc_multisig_psbt");
    const result = await handler!({
      psbt: "not-a-valid-psbt!!!",
      walletName: WALLET_NAME,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when psbt is missing", async () => {
    seedWallet(true);
    const handler = getHandler("sign_btc_multisig_psbt");
    const result = await handler!({ walletName: WALLET_NAME });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when walletName is missing", async () => {
    const handler = getHandler("sign_btc_multisig_psbt");
    const result = await handler!({ psbt: buildFixtureXPsbt() });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["errorCode"]).toBe("INVALID_INPUT");
  });

  it("returns a handle with kind=multisig-psbt for a valid PSBT and registered wallet", async () => {
    seedWallet(true);
    const handler = getHandler("sign_btc_multisig_psbt");
    const result = await handler!({
      psbt: buildFixtureXPsbt(),
      walletName: WALLET_NAME,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["handle"]).toBeDefined();
    expect(typeof sc["handle"]).toBe("string");
    expect(sc["kind"]).toBe("multisig-psbt");
    expect(sc["chain"]).toBe("bitcoin");
    expect(sc["payloadFingerprint"]).toBeDefined();
  });

  // ─── Fixture X re-anchor ───────────────────────────────────────────────────
  //
  // The payloadFingerprint for the Fixture X PSBT (2-of-3 P2WSH, 1 input,
  // txid=bb*32, value=1_000_000, output=900_000 P2WPKH) MUST equal the
  // hardcoded literal from test/signing-fingerprint.test.ts.
  //
  // Fixture X = 0xced8fc41b79311a8f7130aac2a45e382d4a0a6591731f706a96726d7b3cf5414
  // (cross-link: test/signing-fingerprint.test.ts "Fixture X — BTC 2-of-3 multisig
  // P2WSH single-input → 0xced8fc41... byte-for-byte")
  it("Fixture X re-anchor: payloadFingerprint == 0xced8fc41... for the Fixture X PSBT", async () => {
    seedWallet(true);
    const handler = getHandler("sign_btc_multisig_psbt");
    const result = await handler!({
      psbt: buildFixtureXPsbt(),
      walletName: WALLET_NAME,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    // This MUST match the Fixture X literal in test/signing-fingerprint.test.ts.
    // Any drift in the P2WSH sighash preimage (wrong script, wrong value, wrong
    // xpubs, wrong scriptType) will cause this assertion to fail at PR-review time.
    expect(sc["payloadFingerprint"]).toBe(
      "0xced8fc41b79311a8f7130aac2a45e382d4a0a6591731f706a96726d7b3cf5414",
    );
  });

  it("PREPARE RECEIPT contains walletName and threshold", async () => {
    seedWallet(true);
    const handler = getHandler("sign_btc_multisig_psbt");
    const result = await handler!({
      psbt: buildFixtureXPsbt(),
      walletName: WALLET_NAME,
    });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/PREPARE RECEIPT/);
    expect(text).toMatch(new RegExp(WALLET_NAME));
    expect(text).toMatch(/2-of-3/);
  });

  it("PREPARE RECEIPT contains co-signer status rows", async () => {
    seedWallet(true);
    const handler = getHandler("sign_btc_multisig_psbt");
    const result = await handler!({
      psbt: buildFixtureXPsbt(),
      walletName: WALLET_NAME,
    });
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    // Co-signer status: "input[0]: 0 of 2 sigs present — 2 still needed"
    expect(text).toMatch(/input\[0\]/);
    expect(text).toMatch(/0 of 2 sigs present/);
  });

  // ─── preview_send for multisig-psbt handle ────────────────────────────────

  it("preview_send emits per-input co-signer status rows for multisig-psbt handle", async () => {
    seedWallet(true);
    const signHandler = getHandler("sign_btc_multisig_psbt");
    const prepareResult = await signHandler!({
      psbt: buildFixtureXPsbt(),
      walletName: WALLET_NAME,
    });
    expect(prepareResult.isError).toBeFalsy();
    const sc = prepareResult.structuredContent as Record<string, unknown>;
    const handle = sc["handle"] as string;
    const previewToken = sc["previewToken"] as string | undefined;

    const previewHandler = getHandler("preview_send");
    expect(previewHandler).toBeDefined();
    const previewResult = await previewHandler!({ handle });
    expect(previewResult.isError).toBeFalsy();

    const text = previewResult.content[0]?.text ?? "";
    // Co-signer status block is present
    expect(text).toMatch(/input\[0\]/);
    expect(text).toMatch(/sigs present/);
    // previewToken is minted
    const previewSc = previewResult.structuredContent as Record<string, unknown>;
    expect(previewSc["previewToken"]).toBeDefined();
    void previewToken; // suppress unused-var lint
  });

  // ─── send_transaction for multisig-psbt handle ───────────────────────────

  it("send_transaction calls signBtcMultisigPsbt and returns updatedPsbtBase64", async () => {
    seedWallet(true);
    const FAKE_UPDATED_PSBT = "dXBkYXRlZA=="; // "updated" in base64

    // Spy the multisig sign path
    vi.spyOn(_btcLedgerTransport, "signBtcMultisigPsbt").mockResolvedValue({
      updatedPsbtBase64: FAKE_UPDATED_PSBT,
    });
    // Ensure the single-key signBtcPsbt is NOT called
    const singleKeySpy = vi.spyOn(_btcLedgerTransport, "signBtcPsbt");

    // Prepare
    const signHandler = getHandler("sign_btc_multisig_psbt");
    const prepareResult = await signHandler!({
      psbt: buildFixtureXPsbt(),
      walletName: WALLET_NAME,
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as Record<string, unknown>;
    const handle = prepareSc["handle"] as string;

    // Preview
    const previewHandler = getHandler("preview_send");
    const previewResult = await previewHandler!({ handle });
    expect(previewResult.isError).toBeFalsy();
    const previewSc = previewResult.structuredContent as Record<string, unknown>;
    const previewToken = previewSc["previewToken"] as string;

    // Send
    const sendHandler = getHandler("send_transaction");
    const sendResult = await sendHandler!({
      handle,
      previewToken,
      userDecision: "send",
    });

    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as Record<string, unknown>;
    // Returns updatedPsbtBase64, NOT a txHash
    expect(sendSc["updatedPsbtBase64"]).toBe(FAKE_UPDATED_PSBT);
    expect(sendSc["kind"]).toBe("multisig-psbt");
    expect(sendSc["txHash"]).toBeUndefined();

    // signBtcMultisigPsbt was called; signBtcPsbt was NOT
    expect(_btcLedgerTransport.signBtcMultisigPsbt).toHaveBeenCalledOnce();
    expect(singleKeySpy).not.toHaveBeenCalled();
  });

  it("send_transaction returns MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE if walletHmac missing at send time", async () => {
    // Seed a wallet with HMAC for prepare/preview, then re-save without HMAC
    // to simulate a registry mutation between prepare and send (paranoia path).
    seedWallet(true);
    const signHandler = getHandler("sign_btc_multisig_psbt");
    const prepareResult = await signHandler!({
      psbt: buildFixtureXPsbt(),
      walletName: WALLET_NAME,
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as Record<string, unknown>;
    const handle = prepareSc["handle"] as string;

    const previewHandler = getHandler("preview_send");
    const previewResult = await previewHandler!({ handle });
    const previewSc = previewResult.structuredContent as Record<string, unknown>;
    const previewToken = previewSc["previewToken"] as string;

    // Re-seed wallet WITHOUT HMAC to simulate revocation between prepare and send
    _resetBtcMultisigStoreForTesting();
    seedWallet(false); // no walletHmac

    // The handle still exists in memory. We need to re-establish the handle context:
    // The handle store holds the PreparedTxBtc with multisigWalletName, but
    // send_transaction must re-check the registry for walletHmac.
    const sendHandler = getHandler("send_transaction");
    const sendResult = await sendHandler!({
      handle,
      previewToken,
      userDecision: "send",
    });

    expect(sendResult.isError).toBe(true);
    const sendSc = sendResult.structuredContent as Record<string, unknown>;
    expect(sendSc["errorCode"]).toBe("MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE");
  });
});
