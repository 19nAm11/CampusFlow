import assert from "node:assert/strict";
import { test } from "node:test";

const defaults = {
  SUPABASE_URL: "https://supabase.example.test/",
  CAMPUSFLOW_PUBLISHABLE_KEY: "test-publishable-key",
  OPENROUTER_API_KEY: "test-provider-key",
  ALLOWED_ORIGIN: "https://example.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};
let environment = defaults;
let handler;
globalThis.Deno = {
  env: { get: (name) => environment[name] },
  serve: (callback) => { handler = callback; },
};
await import("../supabase/functions/study-assistant/index.ts");
const studyHandler = handler;
await import("../supabase/functions/analyze-course-file/index.ts");
const analyzeHandler = handler;

async function invoke(handler, options = {}) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  environment = { ...defaults, ...options.environment };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url === "https://supabase.example.test/auth/v1/user") {
      if (options.networkError) throw new Error("Network unavailable");
      if (options.hang) {
        return new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        });
      }
      if (options.invalidJson) return new Response("not-json", { status: 200 });
      return Response.json(options.authBody ?? { id: "verified-user" }, { status: options.authStatus ?? 200 });
    }
    if (url === "https://supabase.example.test/rest/v1/rpc/reserve_ai_task") {
      return Response.json({ allowed: true, task_id: "11111111-1111-4111-8111-111111111111" });
    }
    if (url === "https://supabase.example.test/rest/v1/rpc/finish_ai_task") return Response.json(null);
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    return Response.json({ choices: [{ message: { content: JSON.stringify(
      handler === studyHandler ? { reply: "Verified study response." } : {
        courses: [{ courseName: "Biology", fileIds: ["F1"], keyPoints: ["Plants use light."] }],
      },
    ) } }] });
  };
  try {
    const headers = { Origin: defaults.ALLOWED_ORIGIN };
    if (options.authorization !== null) headers.Authorization = options.authorization ?? "Bearer valid-user-token";
    const method = options.method ?? "POST";
    const form = new FormData();
    form.append("mode", "chat");
    form.append("prompt", "Teach me photosynthesis");
    if (handler === analyzeHandler) {
      form.append("file", new File(["Plants use light."], "biology.txt", { type: "text/plain" }));
    }
    const response = await handler(new Request("https://example.test/function", {
      method, headers, ...(method === "POST" ? { body: form } : {}),
    }));
    const body = method === "OPTIONS" ? await response.text() : await response.json();
    return { status: response.status, headers: response.headers, body, calls };
  } finally {
    environment = defaults;
    globalThis.fetch = originalFetch;
  }
}

function assertRejected(result, status) {
  assert.equal(result.status, status);
  assert.equal(result.calls.filter(({ url }) => url.includes("openrouter.ai")).length, 0);
  assert.equal(result.headers.get("Access-Control-Allow-Origin"), defaults.ALLOWED_ORIGIN);
  assert.equal(typeof result.body.error, "string");
  assert.doesNotMatch(JSON.stringify(result.body), /test-publishable-key|test-provider-key/);
}

for (const [name, handler] of [["study-assistant", studyHandler], ["analyze-course-file", analyzeHandler]]) {
  test(`${name}: rejects a missing or malformed bearer token without contacting any provider`, async () => {
    for (const authorization of [null, "Basic abc", "Bearer", "Bearer one two"]) {
      const result = await invoke(handler, { authorization });
      assertRejected(result, 401);
      assert.equal(result.calls.length, 0);
    }
  });

  test(`${name}: rejects invalid, expired, and forbidden tokens before calling AI`, async () => {
    for (const [token, status] of [["invalid-token", 401], ["expired-token", 401], ["forbidden-token", 403]]) {
      const result = await invoke(handler, { authorization: `Bearer ${token}`, authStatus: status });
      assertRejected(result, 401);
      assert.equal(result.calls.length, 1);
      assert.equal(result.calls[0].init.headers.Authorization, `Bearer ${token}`);
    }
  });

  test(`${name}: fails closed when either authentication setting is missing`, async () => {
    for (const setting of ["SUPABASE_URL", "CAMPUSFLOW_PUBLISHABLE_KEY"]) {
      const result = await invoke(handler, { environment: { [setting]: undefined } });
      assertRejected(result, 500);
      assert.equal(result.calls.length, 0);
    }
  });

  test(`${name}: fails closed when Auth is unavailable`, async () => {
    for (const options of [{ authStatus: 500 }, { authStatus: 429 }, { networkError: true }]) {
      const result = await invoke(handler, options);
      assertRejected(result, 503);
      assert.equal(result.calls.length, 1);
    }
  });

  test(`${name}: rejects incomplete or malformed Auth responses`, async () => {
    for (const options of [{ authBody: {} }, { authBody: { id: " " } }, { authBody: { id: 123 } },
      { authBody: [] }, { invalidJson: true }]) {
      const result = await invoke(handler, options);
      assertRejected(result, 503);
    }
  });

  test(`${name}: aborts a stalled Auth request after eight seconds`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const pending = invoke(handler, { hang: true });
    t.mock.timers.tick(8000);
    const result = await pending;
    assertRejected(result, 503);
    assert.equal(result.calls[0].init.signal.aborted, true);
  });

  test(`${name}: permits preflight without user authentication`, async () => {
    const result = await invoke(handler, { method: "OPTIONS", authorization: null });
    assert.equal(result.status, 200);
    assert.equal(result.calls.length, 0);
    assert.equal(result.headers.get("Access-Control-Allow-Origin"), defaults.ALLOWED_ORIGIN);
  });

  test(`${name}: rejects unsupported methods without contacting Auth or AI`, async () => {
    const result = await invoke(handler, { method: "GET", authorization: null });
    assertRejected(result, 405);
    assert.equal(result.calls.length, 0);
  });

  test(`${name}: verifies the user token before calling AI`, async () => {
    const result = await invoke(handler, { authorization: "bEaReR valid-user-token" });
    assert.equal(result.status, 200);
    assert.equal(result.calls.length, 4);
    assert.equal(result.calls[0].url, "https://supabase.example.test/auth/v1/user");
    assert.equal(result.calls[0].init.headers.apikey, defaults.CAMPUSFLOW_PUBLISHABLE_KEY);
    assert.equal(result.calls[0].init.headers.Authorization, "Bearer valid-user-token");
    assert.equal(result.calls[0].init.redirect, "error");
    assert.equal(result.calls[1].url, "https://supabase.example.test/rest/v1/rpc/reserve_ai_task");
    assert.equal(result.calls[2].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(result.calls[3].url, "https://supabase.example.test/rest/v1/rpc/finish_ai_task");
  });
}
