// Plan 10-04 (DIST-43) — `request_capability({ title, body })` MCP tool.
//
// Pure URL builder + rate-limit gate. NO network call — produces a pre-
// filled GitHub issue URL at
// `https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/issues/new`
// with title + body + labels=capability-request. The user clicks the URL
// to file the issue manually; this tool NEVER auto-submits (DIST-43 lock).
//
// The DESCRIPTION below names the `"NEVER auto-submits"` invariant in the
// literal text per CLAUDE.md `Tool descriptions are agent routing prompts`.
// The DESCRIPTION IS the agent routing prompt: without that phrase an LLM
// agent with web-fetch tools (an MCP client that ships fetch as a tool)
// could plausibly POST to the GitHub REST API on the user's behalf,
// defeating the manual-click-by-user design. T-CAPABILITY-AUTO-SUBMIT-1
// mitigation; test/request-capability.test.ts asserts the literal substring.
//
// Rate-limit: sliding-window 3-per-hour via the `_rateLimit` indirection
// in `src/security/request-capability-rate-limit.ts`. Gate fires BEFORE
// URL build / disk write. Gate-then-record discipline keeps `check()` pure
// (peek without mutate); `record()` runs only on a passing gate AND after
// commit-to-build.
//
// URL build via `URLSearchParams` (WHATWG-compliant — RESEARCH § Topic 8
// line 856). Hand-rolled `encodeURIComponent` chains miss `&`/`=` inside
// body params (T-CAPABILITY-INJECTION-1: a body containing
// `&labels=admin-only` would escape the body param and corrupt the URL
// query). `URLSearchParams` encodes `&` as `%26` correctly per WHATWG
// percent-encoding spec, and round-trips multiline bodies + unicode + emoji.
//
// 7KB body cap with local-file fallback (RESEARCH § Topic 8.2 lines 832-854):
// GitHub's 414 URI Too Long starts at ~8KB; a 7KB body cap leaves ~700+ chars
// headroom for title + labels + base URL + URL-encoding expansion (some
// chars 1:3 under `encodeURIComponent`). Over-cap bodies: (a) write FULL
// text to `~/.vaultpilot-mcp/capability-requests/<timestamp>.md` with a
// title H1; (b) truncate the body in the URL with a trailing
// `[...truncated; full text at <localFilePath>]` marker — the marker IS
// the user-recovery instruction (visible inside the GitHub issue body
// AND in the text response). T-CAPABILITY-BODY-CAP-1 mitigation.

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { makeStructuredError } from "../signing/error-codes.js";
import { _rateLimit } from "../security/request-capability-rate-limit.js";
import { registerTool, type ToolInputSchema } from "./index.js";

/**
 * Hardcoded repo slug — the SOT for the GitHub URL builder. Single-tenant
 * v1.x design: the MCP server runs locally and files issues on the same
 * canonical upstream repo regardless of who is running it. v3.0+ hosted
 * MCP may parameterize this per-tenant.
 */
const REPO = "szhygulin/vaultpilot-mcp-gsd-inspired";

/**
 * 7KB body cap (RESEARCH § Topic 8.2). GitHub's 414 URI Too Long starts
 * at approximately 8KB; 7KB leaves ~700+ chars headroom for the title +
 * `labels=capability-request` + base URL + URL-encoding expansion.
 * Empirical bound — Assumption A6 documented residual; recovery is a
 * 1-line change if GitHub tightens the limit.
 */
const BODY_LIMIT = 7000;

/**
 * Local-file fallback directory. Created lazily on first over-cap body.
 * `mkdir({ recursive: true })` is idempotent — no race condition when
 * concurrent `request_capability` calls create the dir.
 */
const LOG_DIR_FRAGMENTS = [".vaultpilot-mcp", "capability-requests"] as const;

function getLogDir(): string {
  return join(homedir(), ...LOG_DIR_FRAGMENTS);
}

/**
 * Zod input schema. `title` is bounded 5-120 chars (short enough to fit
 * the GitHub issue title field cleanly; long enough to be informative).
 * `body` minimum 20 chars (enough for "I want X on chain Y for reason Z");
 * no upper bound (the 7KB cap is applied AFTER title-body assembly).
 */
const InputSchema = z.object({
  title: z.string().min(5).max(120),
  body: z.string().min(20),
});

/**
 * DESCRIPTION — the agent routing prompt. The load-bearing phrase is
 * `"NEVER auto-submits"` (test/request-capability.test.ts asserts the
 * literal substring). Drift catches at PR-review time.
 */
const DESCRIPTION = [
  "Produce a pre-filled GitHub issue URL for a vaultpilot-mcp capability request. The user clicks the URL to file the issue manually — this tool NEVER auto-submits.",
  "Use when the user asks for a chain/protocol/feature that doesn't yet exist in the tool surface (e.g. 'add Solana support', 'support Aave V2', 'expose flash-loan prepare tool'); the agent surfaces the URL + nudges the user to click it.",
  "Rate-limited 3 requests per hour per MCP session (sliding window). Per-process restart resets the counter — friction-not-fortress; bypass cost is restarting the MCP server and losing all session state including paired Ledger.",
  "Bodies over 7KB are truncated to fit GitHub's URL length cap; full text is written to ~/.vaultpilot-mcp/capability-requests/<timestamp>.md for manual paste. The truncation marker in the URL names the local-file path so the user can recover the full content.",
  "Returns `{ url, bodyTruncated, localFilePath, rateLimitRemaining }`. On rate-limit refusal, returns errorCode RATE_LIMIT_EXCEEDED with retryAfterMs in the cause field.",
].join(" ");

/**
 * JSON-schema mirror of the Zod input schema. The MCP boundary surfaces
 * this to clients via `tools/list`; clients can validate args before
 * dispatch. The handler ALSO validates via Zod (defense-in-depth — clients
 * may skip the JSON-schema gate).
 */
const INPUT_SCHEMA: ToolInputSchema = {
  type: "object" as const,
  properties: {
    title: {
      type: "string",
      minLength: 5,
      maxLength: 120,
      description:
        "GitHub issue title (5-120 chars). Concise summary — e.g. 'Add Solana chain support' or 'Surface Aave V2 prepare tools'.",
    },
    body: {
      type: "string",
      minLength: 20,
      description:
        "GitHub issue body (≥ 20 chars; bodies over 7KB are truncated with the full text written to a local file for manual paste). Markdown supported.",
    },
  },
  required: ["title", "body"],
  additionalProperties: false,
};

interface BuildUrlResult {
  url: string;
  bodyTruncated: boolean;
  localFilePath: string | null;
}

/**
 * Pure URL builder + truncation-to-local-file fallback. Side effect ONLY
 * on over-cap bodies (the `mkdir` + `writeFile`). Returns the URL + the
 * truncation flag + the local-file path (or null when body fit under cap).
 */
async function buildUrl(title: string, body: string): Promise<BuildUrlResult> {
  let actualBody = body;
  let bodyTruncated = false;
  let localFilePath: string | null = null;

  if (body.length > BODY_LIMIT) {
    bodyTruncated = true;
    // ISO timestamp with `:` and `.` replaced — filesystem-safe across
    // POSIX + Windows (the `:` char is invalid in Windows filenames).
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logDir = getLogDir();
    localFilePath = join(logDir, `${timestamp}.md`);
    await mkdir(logDir, { recursive: true });
    await writeFile(localFilePath, `# ${title}\n\n${body}\n`, "utf8");
    actualBody =
      body.slice(0, BODY_LIMIT) +
      `\n\n[...truncated; full text at ${localFilePath}]`;
  }

  // URLSearchParams: WHATWG-compliant percent-encoding. Handles `&` / `=` /
  // newlines / multibyte unicode / emoji correctly. Hand-rolled chains
  // miss `&` inside body params, allowing query-param injection (T-
  // CAPABILITY-INJECTION-1).
  const params = new URLSearchParams({
    title,
    body: actualBody,
    labels: "capability-request",
  });
  const url = `https://github.com/${REPO}/issues/new?${params.toString()}`;

  return { url, bodyTruncated, localFilePath };
}

registerTool("request_capability", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // 1. Zod input validation. The handler is invoked directly by tests
  //    (bypassing the JSON-schema gate at the MCP boundary), so the Zod
  //    parse is the runtime guard. `safeParse` lets us return an
  //    INVALID_INPUT envelope instead of throwing into the dispatcher.
  const parsed = InputSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `error: invalid input to request_capability: ${issues}`,
        },
      ],
      structuredContent: {
        ...makeStructuredError(
          "INVALID_INPUT",
          "request_capability input failed Zod schema",
          issues,
        ),
      },
    };
  }
  const { title, body } = parsed.data;

  // 2. Rate-limit gate FIRST — refuse BEFORE any URL build / disk write.
  //    Gate-then-record discipline: `check()` is pure (peek without
  //    mutate); `record()` runs ONLY on a passing gate.
  const limit = _rateLimit.check();
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterMs / 60000);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `error: RATE LIMIT EXCEEDED — try again in ${minutes} minute(s). Limit: 3 capability requests per hour per session (sliding window).`,
        },
      ],
      structuredContent: {
        ...makeStructuredError(
          "RATE_LIMIT_EXCEEDED",
          `request_capability rate-limit (3/hour) exhausted; retry in ${minutes} minute(s)`,
          limit.retryAfterMs.toString(),
        ),
      },
    };
  }
  _rateLimit.record();

  // Post-record remaining: `limit.remaining` is the pre-record count
  // (`check()` is pure). After this call's `record()`, one slot is
  // consumed; clamp at 0 so test-spy returns of `remaining: 0` (only
  // possible when callers stub `check` directly) don't underflow.
  const remainingAfterRecord = Math.max(0, limit.remaining - 1);

  // 3. URL build (+ optional local-file fallback for over-cap bodies).
  const { url, bodyTruncated, localFilePath } = await buildUrl(title, body);

  // 4. Compose the text-response. Lines filtered to drop empty strings so
  //    the rendered output stays tight when the truncation line doesn't
  //    apply.
  const lines: Array<string | null> = [
    `Capability request URL ready (click to open):`,
    ``,
    `  ${url}`,
    ``,
    bodyTruncated
      ? `[Body truncated to ${BODY_LIMIT}-char cap. Full text saved to: ${localFilePath} — paste manually if needed.]`
      : null,
    `Rate limit: ${remainingAfterRecord}/3 requests remaining in the current hour window.`,
  ];
  const text = lines.filter((l): l is string => l !== null).join("\n");

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: {
      url,
      bodyTruncated,
      localFilePath,
      rateLimitRemaining: remainingAfterRecord,
    },
  };
});
