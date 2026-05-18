// Plan 10-04 (DIST-43) — request_capability MCP tool tests.
//
// 15 cases covering: happy path / URL shape / Zod input rejection /
// T-CAPABILITY-INJECTION-1 (URLSearchParams round-trip) / T-CAPABILITY-
// BODY-CAP-1 (7KB truncation + local-file write) / T-CAPABILITY-AUTO-
// SUBMIT-1 (DESCRIPTION literal "NEVER auto-submits") / rate-limit pass +
// refuse / gate-then-record discipline / local-file path safety / mkdir
// recursive / file content + truncation marker / multiline + emoji body.
//
// Side-effect import registers the tool in the registry. Handler is
// invoked directly via `getRegisteredTool` (bypasses JSON-schema gate at
// the MCP boundary — runtime Zod validation is the in-handler guard).
//
// Filesystem isolation: per-test `process.env.HOME = mkdtempSync(...)` so
// the `~/.vaultpilot-mcp/capability-requests/<timestamp>.md` write lands
// inside the tmp dir. Same pattern as test/security-skill-integrity.test.ts.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _rateLimit, _resetForTesting } from "../src/security/request-capability-rate-limit.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

// Side-effect import — registers the tool in the registry.
await import("../src/tools/request_capability.js");

let tmpHome: string;
let savedHome: string | undefined;

beforeEach(() => {
  _resetForTesting();
  tmpHome = mkdtempSync(join(tmpdir(), "vp-request-cap-test-"));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(() => {
  _resetForTesting();
  if (savedHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = savedHome;
  }
  rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function callTool(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("request_capability");
  if (!tool) throw new Error("request_capability not registered");
  return tool.handler(args);
}

describe("request_capability — URL builder + rate-limit gate", () => {
  it("Case 1 — happy path: returns url + remaining: 2; no truncation", async () => {
    const result = await callTool({
      title: "Add Solana chain support",
      body: "Solana support would let me read SPL token balances and prepare TX for Phantom-style signing.",
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(typeof sc.url).toBe("string");
    expect(sc.bodyTruncated).toBe(false);
    expect(sc.localFilePath).toBeNull();
    expect(sc.rateLimitRemaining).toBe(2);
  });

  it("Case 2 — URL shape: startsWith canonical base + includes labels=capability-request", async () => {
    const result = await callTool({
      title: "Add Polygon zkEVM support",
      body: "Polygon zkEVM has a different RPC namespace than Polygon PoS; needs separate chain plumbing.",
    });
    const sc = result.structuredContent as Record<string, unknown>;
    const url = sc.url as string;
    expect(url.startsWith("https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/issues/new?")).toBe(true);
    // URLSearchParams encodes spaces as `+`; the literal `labels=capability-request`
    // has no special chars, so it appears verbatim in the query string.
    expect(url).toContain("labels=capability-request");
  });

  it("Case 3 — Zod input rejection: short title / long title / short body all → INVALID_INPUT", async () => {
    const tooShortTitle = await callTool({
      title: "abc",
      body: "Body that is more than twenty characters long for sure.",
    });
    expect(tooShortTitle.isError).toBe(true);
    const sc1 = tooShortTitle.structuredContent as { errorCode: string };
    expect(sc1.errorCode).toBe("INVALID_INPUT");

    const tooLongTitle = await callTool({
      title: "x".repeat(121),
      body: "Body that is more than twenty characters long for sure.",
    });
    expect(tooLongTitle.isError).toBe(true);
    expect((tooLongTitle.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");

    const tooShortBody = await callTool({
      title: "Valid title here",
      body: "too short",
    });
    expect(tooShortBody.isError).toBe(true);
    expect((tooShortBody.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
  });

  it("Case 4 — T-CAPABILITY-INJECTION-1: URLSearchParams round-trip preserves & = newlines emoji unicode", async () => {
    const hostileBody = [
      "Multiple paragraphs here with newlines.",
      "Special chars: & = ? # / + % literal markers.",
      "Injection attempt: &labels=admin-only&body=spoof",
      "Emoji: 🚀🔥💎 + unicode: café résumé Москва 中文 العربية",
    ].join("\n\n");

    const result = await callTool({
      title: "Body round-trip stress test",
      body: hostileBody,
    });
    const sc = result.structuredContent as Record<string, unknown>;
    const url = sc.url as string;

    // Parse via WHATWG URL — the body param must round-trip BYTE-FOR-BYTE.
    const parsed = new URL(url);
    expect(parsed.searchParams.get("body")).toBe(hostileBody);
    // Single canonical labels=capability-request — injection attempt
    // does NOT add a second labels param.
    expect(parsed.searchParams.getAll("labels")).toEqual(["capability-request"]);
  });

  it("Case 5 — T-CAPABILITY-BODY-CAP-1: 10KB body → truncation + local-file write + marker", async () => {
    const tenKbBody = "x".repeat(10000);
    const result = await callTool({
      title: "Long body truncation test",
      body: tenKbBody,
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.bodyTruncated).toBe(true);
    expect(typeof sc.localFilePath).toBe("string");

    const localFilePath = sc.localFilePath as string;
    // Local-file path lives under the per-test tmp home.
    expect(localFilePath.startsWith(tmpHome)).toBe(true);
    expect(existsSync(localFilePath)).toBe(true);

    // File content: title H1 + full 10KB body + trailing newline.
    const fileContent = readFileSync(localFilePath, "utf8");
    expect(fileContent.startsWith("# Long body truncation test\n\n")).toBe(true);
    expect(fileContent).toContain(tenKbBody);
    expect(fileContent.endsWith("\n")).toBe(true);

    // URL body length cap: original body was 10000 chars; in-URL body is
    // 7000-char slice + ~75-char marker. Assert the in-URL body is the
    // truncated form (NOT the original 10KB).
    const url = sc.url as string;
    const parsed = new URL(url);
    const urlBody = parsed.searchParams.get("body")!;
    expect(urlBody.length).toBeLessThan(10000);
    // 7KB body + ~75 fixed marker prose + ISO-timestamp + tmp-path length;
    // assert "well under GitHub's ~8KB 414 threshold" (BODY_LIMIT 7000 +
    // marker headroom). 7500 is the practical bound that absorbs the
    // per-test tmp-path length on macOS / Linux without being so loose it
    // misses a regression where BODY_LIMIT silently doubles.
    expect(urlBody.length).toBeLessThanOrEqual(7500);
    // Truncation marker present + names the local path.
    expect(urlBody).toContain("[...truncated; full text at ");
    expect(urlBody).toContain(localFilePath);
  });

  it("Case 6 — T-CAPABILITY-AUTO-SUBMIT-1: DESCRIPTION includes literal 'NEVER auto-submits'", () => {
    const tool = getRegisteredTool("request_capability");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("NEVER auto-submits");
  });

  it("Case 7 — rate-limit refusal: spy check → allowed: false → RATE_LIMIT_EXCEEDED envelope", async () => {
    vi.spyOn(_rateLimit, "check").mockReturnValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 2_700_000, // 45 min
    });
    const recordSpy = vi.spyOn(_rateLimit, "record");

    const result = await callTool({
      title: "Test refusal envelope",
      body: "Body that is more than twenty characters long for sure.",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string; cause: string };
    expect(sc.errorCode).toBe("RATE_LIMIT_EXCEEDED");
    expect(sc.cause).toBe("2700000");
    expect(result.content[0]!.text).toContain("45 minute(s)");
    // Gate-then-record: record NOT called on refusal.
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("Case 8 — rate-limit pass: spy check → allowed: true → URL build + record called once; post-record remaining surfaced", async () => {
    vi.spyOn(_rateLimit, "check").mockReturnValue({
      allowed: true,
      remaining: 2, // pre-record (check() is pure peek)
      retryAfterMs: 0,
    });
    const recordSpy = vi.spyOn(_rateLimit, "record");

    const result = await callTool({
      title: "Rate-limit pass test",
      body: "Body that is more than twenty characters long for sure.",
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(typeof sc.url).toBe("string");
    // Response surfaces the POST-record count (one slot consumed by this call):
    // pre-record remaining was 2 → post-record is 1.
    expect(sc.rateLimitRemaining).toBe(1);
    expect(recordSpy).toHaveBeenCalledTimes(1);
  });

  it("Case 9 — gate-then-record: refusal path does NOT call record (no slot consumed on miss)", async () => {
    // Pre-load 3 records → 4th refused; verify record NOT called by handler.
    _rateLimit.record();
    _rateLimit.record();
    _rateLimit.record();
    const recordSpy = vi.spyOn(_rateLimit, "record");

    const result = await callTool({
      title: "Refusal-no-record test",
      body: "Body that is more than twenty characters long for sure.",
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("RATE_LIMIT_EXCEEDED");
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("Case 10 — local-file path is filesystem-safe (no ':' or '.' in timestamp segment)", async () => {
    const result = await callTool({
      title: "Path safety test",
      body: "x".repeat(8000),
    });
    const sc = result.structuredContent as { localFilePath: string };
    // Extract the filename segment (last `/` element).
    const filename = sc.localFilePath.split("/").pop()!;
    // `.md` extension preceded by ISO timestamp with `:` / `.` replaced.
    expect(filename.endsWith(".md")).toBe(true);
    const stem = filename.slice(0, -3);
    expect(stem).not.toContain(":");
    expect(stem).not.toContain(".");
  });

  it("Case 11 — mkdir recursive: capability-requests dir created if missing; idempotent if present", async () => {
    const capDir = join(tmpHome, ".vaultpilot-mcp", "capability-requests");
    expect(existsSync(capDir)).toBe(false);

    // First over-cap call — dir created.
    await callTool({ title: "First", body: "y".repeat(8000) });
    expect(existsSync(capDir)).toBe(true);

    // Second over-cap call — dir reused; no mkdir error.
    await callTool({ title: "Second", body: "z".repeat(8000) });
    expect(existsSync(capDir)).toBe(true);
  });

  it("Case 12 — local-file content: starts with title H1, contains full body, ends with newline", async () => {
    const body = "hello world body content " + "x".repeat(8000);
    const result = await callTool({
      title: "Content shape test",
      body,
    });
    const sc = result.structuredContent as { localFilePath: string };
    const content = readFileSync(sc.localFilePath, "utf8");
    expect(content.startsWith("# Content shape test\n\n")).toBe(true);
    expect(content).toContain(body);
    expect(content.endsWith("\n")).toBe(true);
  });

  it("Case 13 — truncation marker format: '[...truncated; full text at <localFilePath>]' literal", async () => {
    const result = await callTool({
      title: "Marker format test",
      body: "q".repeat(9000),
    });
    const sc = result.structuredContent as { url: string; localFilePath: string };
    const urlBody = new URL(sc.url).searchParams.get("body")!;
    expect(urlBody).toContain(`[...truncated; full text at ${sc.localFilePath}]`);
  });

  it("Case 14 — multiline body in URL: embedded newlines round-trip via URLSearchParams", async () => {
    const body = ["line one is the first sentence here", "line two is the second one", "line three closes it"].join("\n");
    const result = await callTool({ title: "Multiline body test", body });
    const sc = result.structuredContent as { url: string };
    const roundTripped = new URL(sc.url).searchParams.get("body");
    expect(roundTripped).toBe(body);
  });

  it("Case 15 — emoji + multi-byte unicode body: WHATWG percent-encoded UTF-8 round-trips", async () => {
    const body = "🚀 Launch capability needed for 中文 / Москва / café users. Twenty-plus chars total.";
    const result = await callTool({ title: "Emoji unicode test", body });
    const sc = result.structuredContent as { url: string };
    const roundTripped = new URL(sc.url).searchParams.get("body");
    expect(roundTripped).toBe(body);
  });
});
