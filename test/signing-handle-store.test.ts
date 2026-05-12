import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import {
  HANDLE_TTL_MS,
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
  transitionToCancelled,
  transitionToPreviewed,
  transitionToSent,
} from "../src/signing/handle-store.js";
import type { PreparedTx, PreviewPinned } from "../src/signing/handle-store.js";

function buildPreparedTx(): PreparedTx {
  return {
    chainId: 1,
    to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
    valueWei: 1000000000000000000n,
    data: "0x" as Hex,
  };
}

function buildPinned(previewToken = "11111111-1111-4111-8111-111111111111"): PreviewPinned {
  return {
    nonce: 7,
    gas: 21000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
    previewToken,
    presignHash: "0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85" as Hex,
    selector: null,
  };
}

const FINGERPRINT = "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;

beforeEach(() => {
  _resetHandleStoreForTesting();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handle-store — createHandle + lookup", () => {
  it("createHandle returns a UUID v4 and inserts a 'prepared' record", () => {
    const handle = createHandle({
      args: { to: "0xabc", valueWei: "1000000000000000000" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });

    expect(handle).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const result = lookup(handle);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe("prepared");
      expect(result.record.payloadFingerprint).toBe(FINGERPRINT);
      expect(result.record.args).toEqual({ to: "0xabc", valueWei: "1000000000000000000" });
    }
  });

  it("lookup of an unknown handle returns HANDLE_NOT_FOUND", () => {
    const result = lookup("not-a-real-handle");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("HANDLE_NOT_FOUND");
    }
  });
});

describe("handle-store — state machine: legal transitions", () => {
  it("prepared → previewed via transitionToPreviewed", () => {
    const handle = createHandle({
      args: { to: "0xabc", valueWei: "1" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    const pinned = buildPinned();
    const result = transitionToPreviewed(handle, pinned);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe("previewed");
      // Same reference — we OVERWRITE, not deep-copy.
      expect(result.record.pinned).toBe(pinned);
    }
  });

  it("previewed → sent via transitionToSent", () => {
    const handle = createHandle({
      args: { to: "0xabc", valueWei: "1" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    transitionToPreviewed(handle, buildPinned());
    const txHash =
      "0xdeadbeef00000000000000000000000000000000000000000000000000000000" as Hex;
    const result = transitionToSent(handle, txHash);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe("sent");
      expect(result.record.txHash).toBe(txHash);
      expect(typeof result.record.sentAt).toBe("number");
    }
  });
});

describe("handle-store — state machine: illegal transitions", () => {
  it("prepared → sent (no preview) returns WRONG_STATUS; record status unchanged", () => {
    const handle = createHandle({
      args: { to: "0xabc", valueWei: "1" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    const result = transitionToSent(
      handle,
      "0xdeadbeef00000000000000000000000000000000000000000000000000000000" as Hex,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("WRONG_STATUS");
    }
    const after = lookup(handle);
    expect(after.ok && after.record.status).toBe("prepared");
  });

  it("sent → previewed returns WRONG_STATUS; sent → sent returns WRONG_STATUS", () => {
    const handle = createHandle({
      args: { to: "0xabc", valueWei: "1" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    transitionToPreviewed(handle, buildPinned());
    transitionToSent(
      handle,
      "0xdeadbeef00000000000000000000000000000000000000000000000000000000" as Hex,
    );

    const rePreview = transitionToPreviewed(handle, buildPinned("22222222-2222-4222-8222-222222222222"));
    expect(rePreview.ok).toBe(false);
    if (!rePreview.ok) expect(rePreview.errorCode).toBe("WRONG_STATUS");

    const reSend = transitionToSent(
      handle,
      "0xfeedbeef00000000000000000000000000000000000000000000000000000000" as Hex,
    );
    expect(reSend.ok).toBe(false);
    if (!reSend.ok) expect(reSend.errorCode).toBe("WRONG_STATUS");
  });
});

describe("handle-store — idempotent re-preview (Q4 locked decision)", () => {
  it("previewed → previewed OVERWRITES pinned (new previewToken invalidates old)", () => {
    const handle = createHandle({
      args: { to: "0xabc", valueWei: "1" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    const pinnedA = buildPinned("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const pinnedB = buildPinned("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    transitionToPreviewed(handle, pinnedA);
    const result = transitionToPreviewed(handle, pinnedB);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe("previewed");
      expect(result.record.pinned).toBe(pinnedB);
      // pinnedA.previewToken is no longer the valid token — only the current
      // record.pinned.previewToken counts.
      expect(result.record.pinned?.previewToken).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    }
  });
});

describe("handle-store — transitionToCancelled (Q1 locked decision)", () => {
  it("prepared → cancelled; subsequent transitionToPreviewed returns WRONG_STATUS", () => {
    const handle = createHandle({
      args: { to: "0xabc", valueWei: "1" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    const result = transitionToCancelled(handle);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe("cancelled");
      expect(typeof result.record.cancelledAt).toBe("number");
    }
    // Record NOT auto-deleted from store.
    const after = lookup(handle);
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.record.status).toBe("cancelled");

    const rePreview = transitionToPreviewed(handle, buildPinned());
    expect(rePreview.ok).toBe(false);
    if (!rePreview.ok) expect(rePreview.errorCode).toBe("WRONG_STATUS");
  });

  it("previewed → cancelled; subsequent transitionToSent returns WRONG_STATUS", () => {
    const handle = createHandle({
      args: { to: "0xabc", valueWei: "1" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    transitionToPreviewed(handle, buildPinned());
    const result = transitionToCancelled(handle);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.status).toBe("cancelled");

    const reSend = transitionToSent(
      handle,
      "0xdeadbeef00000000000000000000000000000000000000000000000000000000" as Hex,
    );
    expect(reSend.ok).toBe(false);
    if (!reSend.ok) expect(reSend.errorCode).toBe("WRONG_STATUS");
  });

  it("sent → cancelled returns WRONG_STATUS (the send is final)", () => {
    const handle = createHandle({
      args: { to: "0xabc", valueWei: "1" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    transitionToPreviewed(handle, buildPinned());
    transitionToSent(
      handle,
      "0xdeadbeef00000000000000000000000000000000000000000000000000000000" as Hex,
    );
    const result = transitionToCancelled(handle);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("WRONG_STATUS");
  });
});

describe("handle-store — lazy TTL eviction (PREP-10, T-STATE-2)", () => {
  it("lookup past HANDLE_TTL_MS returns HANDLE_EXPIRED + evicts the record", () => {
    vi.useFakeTimers();
    const handle = createHandle({
      args: { to: "0xabc", valueWei: "1" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });

    vi.advanceTimersByTime(HANDLE_TTL_MS + 1);

    const result = lookup(handle);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("HANDLE_EXPIRED");

    // Eviction confirmed: subsequent lookup returns HANDLE_NOT_FOUND.
    const after = lookup(handle);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.errorCode).toBe("HANDLE_NOT_FOUND");
  });
});

describe("handle-store — test helpers", () => {
  it("_resetHandleStoreForTesting clears all entries", () => {
    const h1 = createHandle({
      args: { to: "0xa", valueWei: "1" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    const h2 = createHandle({
      args: { to: "0xb", valueWei: "2" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    const h3 = createHandle({
      args: { to: "0xc", valueWei: "3" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });

    _resetHandleStoreForTesting();

    for (const h of [h1, h2, h3]) {
      const r = lookup(h);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errorCode).toBe("HANDLE_NOT_FOUND");
    }
  });

  it("_peekHandleForTesting returns the live record (mutation path for downstream PAYLOAD_FINGERPRINT_DRIFT tests)", () => {
    const handle = createHandle({
      args: { to: "0xabc", valueWei: "1" },
      tx: buildPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    const record = _peekHandleForTesting(handle);
    expect(record).toBeDefined();
    expect(record?.handle).toBe(handle);
    expect(record?.status).toBe("prepared");
    expect(_peekHandleForTesting("not-a-real-handle")).toBeUndefined();
  });
});
