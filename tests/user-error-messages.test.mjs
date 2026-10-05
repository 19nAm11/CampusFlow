import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

// Execute the real UI formatter without bootstrapping the DOM application.
const source = await readFile(new URL("../script.js", import.meta.url), "utf8");
const start = source.indexOf("async function getKnowledgeAnalysisErrorMessage(error)");
const end = source.indexOf("\nasync function analyzeKnowledgeFiles", start);
assert.ok(start >= 0 && end > start);
const format = runInNewContext(`${source.slice(start, end)}\ngetKnowledgeAnalysisErrorMessage`, { Response });
const sensitive = "OPENROUTER_API_KEY secret-value SQL saved_quizzes migration /tmp/user_fn stack trace";
const assertSafe = message => assert.doesNotMatch(message, /OPENROUTER|secret-value|SQL|saved_quizzes|migration|\/tmp|stack trace|HTTP|Edge Function/);

test("internal backend and local errors are replaced with a generic user message", async () => {
  for (const status of [500, 502, 503]) {
    const message = await format({ context: Response.json({ error: sensitive, message: sensitive }, { status }) });
    assert.equal(message, "Something went wrong. Please try again in a moment.");
    assertSafe(message);
  }
  const local = await format(new Error(sensitive));
  assertSafe(local);
  assert.equal(local, "Something went wrong. Please try again in a moment.");
});

test("authentication errors provide an action without echoing server diagnostics", async () => {
  for (const status of [401, 403]) {
    const message = await format({ context: Response.json({ error: sensitive }, { status }) });
    assertSafe(message);
    assert.match(message, /sign in|account/);
  }
});

test("input errors use fixed user instructions instead of arbitrary backend text", async () => {
  for (const status of [400, 413, 422]) {
    const message = await format({ context: Response.json({ error: sensitive }, { status }) });
    assertSafe(message);
    assert.match(message, /request|files|material/);
  }
});

test("quota feedback preserves safe wait information and ignores unexpected codes", async () => {
  for (const code of ["minute_limit", "daily_limit", "concurrent_limit", "__proto__", { toString: "invalid" }]) {
    const message = await format({ context: Response.json({ code, error: sensitive, retryAfterSeconds: 30 }, { status: 429 }) });
    assertSafe(message);
    assert.match(message, /30 seconds/);
  }
  const invalidWait = await format({ context: Response.json({ error: sensitive, retryAfterSeconds: sensitive }, { status: 429 }) });
  assertSafe(invalidWait);
  assert.match(invalidWait, /try again later/);
});

test("timeouts and non-JSON gateway errors do not expose technical response bodies", async () => {
  const timeout = await format({ context: Response.json({ error: sensitive }, { status: 504 }) });
  assertSafe(timeout);
  assert.match(timeout, /took too long/);
  const gateway = await format({ context: new Response(sensitive, { status: 500 }) });
  assertSafe(gateway);
  assert.equal(gateway, "Something went wrong. Please try again in a moment.");
});
