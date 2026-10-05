import assert from "node:assert/strict";
import { test } from "node:test";

const userId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const defaults = {
  SUPABASE_URL: "https://supabase.example.test",
  CAMPUSFLOW_PUBLISHABLE_KEY: "test-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  OPENROUTER_API_KEY: "test-provider-key",
  ALLOWED_ORIGIN: "https://example.test",
};
let environment = defaults;
let handler;
globalThis.Deno = { env: { get: name => environment[name] }, serve: callback => { handler = callback; } };
await import("../supabase/functions/study-assistant/index.ts");
const studyHandler = handler;
await import("../supabase/functions/analyze-course-file/index.ts");
const analyzeHandler = handler;
const flush = () => new Promise(resolve => setImmediate(resolve));

// Advance through I/O and timers together: File.arrayBuffer() may settle on a
// later event-loop turn than the mocked HTTP responses.
async function advanceUntilSettled(t, pending) {
  let done = false;
  let result;
  let failure;
  pending.then(value => { result = value; done = true; }, error => { failure = error; done = true; });
  for (let index = 0; index < 2000 && !done; index++) {
    await flush();
    if (!done) t.mock.timers.tick(100);
  }
  assert.equal(done, true, "Request did not settle within the simulated deadline");
  if (failure) throw failure;
  return result;
}

async function invoke(handler, options = {}) {
  environment = { ...defaults, ...options.environment };
  const originalFetch = globalThis.fetch;
  const calls = [];
  let providerCalls = 0;
  const normalOutput = handler === studyHandler ? { reply: "Plants use light." } : {
    courses: [{ courseName: "Biology", fileIds: ["F1"], keyPoints: ["Plants use light."] }],
  };
  globalThis.fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body, init });
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: userId });
    if (url.endsWith("/reserve_ai_task")) {
      if (options.quotaNetworkError) throw new Error("Quota unavailable");
      return Response.json(options.quota ?? { allowed: true, task_id: taskId }, { status: options.quotaStatus ?? 200 });
    }
    if (url.endsWith("/finish_ai_task")) {
      return options.finishStatus === 204 ? new Response(null, { status: 204 })
        : Response.json(null, { status: options.finishStatus ?? 200 });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const index = providerCalls++;
    if (body.model === options.unavailableModel) {
      return Response.json({ error: { code: 404, message: "Model unavailable" } }, { status: 404 });
    }
    if (options.stallBody) {
      return { ok: true, status: 200, headers: new Headers(), json: () =>
        new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })) };
    }
    if (options.stall) {
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    }
    const output = options.outputs?.[index] ?? { output: normalOutput };
    if (output.networkError) throw new Error("Network unavailable");
    if (output.status && output.status !== 200) {
      return Response.json({ error: { code: output.status, message: "Provider details must not leak" } }, {
        status: output.status, headers: output.headers,
      });
    }
    if (output.providerError) return Response.json({ error: output.providerError });
    return Response.json({ choices: [{ message: { content: JSON.stringify(output.output ?? normalOutput) } }] });
  };
  try {
    const form = new FormData();
    form.append("prompt", options.invalidInput ? "" : options.prompt ?? "Teach me photosynthesis");
    form.append("mode", options.mode ?? "chat");
    form.append("user_id", "attacker-supplied-user");
    if (options.pdf) {
      form.append("file", new File(["%PDF-1.7\nMock PDF transport fixture"], "notes.pdf", { type: "application/pdf" }));
    }
    if (handler === analyzeHandler && !options.invalidInput) {
      form.append("file", new File(["Plants use light."], "notes.txt", { type: "text/plain" }));
    }
    const response = await handler(new Request("https://example.test/function", {
      method: "POST", body: form, headers: { Authorization: "Bearer valid-token", Origin: defaults.ALLOWED_ORIGIN },
    }));
    return { status: response.status, body: await response.json(), headers: response.headers, calls, providerCalls };
  } finally { environment = defaults; globalThis.fetch = originalFetch; }
}

function release(result) { return result.calls.find(({ url }) => url.endsWith("/finish_ai_task"))?.body; }
function assertNoAI(result) { assert.equal(result.providerCalls, 0); }

for (const [name, handler] of [["study", studyHandler], ["analysis", analyzeHandler]]) {
  test(`${name}: replaces the unavailable model and reads model overrides per request`, async () => {
    const fallback = await invoke(handler, { unavailableModel: "stealth/space-bunny-alpha" });
    assert.equal(fallback.status, 200);
    assert.equal(fallback.calls.find(({ url }) => url.endsWith("/chat/completions")).body.model, "openrouter/free");
    const configured = await invoke(handler, { environment: { OPENROUTER_MODEL: " nvidia/nemotron-3-super-120b-a12b:free " } });
    assert.equal(configured.status, 200);
    assert.equal(configured.calls.find(({ url }) => url.endsWith("/chat/completions")).body.model,
      "nvidia/nemotron-3-super-120b-a12b:free");
  });

  test(`${name}: invalid model configuration fails before quota and generation`, async () => {
    for (const OPENROUTER_MODEL of ["", "   ", "https://example.test/model", "missing-slash", "provider/model\nprivate-text",
      `provider/${"x".repeat(121)}`]) {
      const result = await invoke(handler, { environment: { OPENROUTER_MODEL } });
      assert.equal(result.status, 500);
      assert.equal(result.body.code, "ai_configuration_error");
      assertNoAI(result);
      assert.equal(result.calls.length, 1);
      assert.doesNotMatch(JSON.stringify(result.body), /example\.test|private-text|missing-slash/);
    }
  });

  test(`${name}: quota denials return 429 and a retry time without calling AI`, async () => {
    for (const reason of ["minute_limit", "daily_limit", "concurrent_limit"]) {
      const result = await invoke(handler, { quota: { allowed: false, reason, retry_after: 20 } });
      assert.equal(result.status, 429);
      assert.equal(result.body.code, reason);
      assert.equal(result.body.retryAfterSeconds, 20);
      assert.equal(result.headers.get("Retry-After"), "20");
      assert.equal(result.headers.get("Access-Control-Expose-Headers"), "Retry-After");
      assertNoAI(result);
      assert.equal(release(result), undefined);
    }
  });

  test(`${name}: quota service failure or malformed responses never bypass limits`, async () => {
    for (const options of [{ quotaStatus: 500 }, { quotaNetworkError: true }, { quota: {} },
      { quota: { allowed: true, task_id: "not-a-uuid" } }, { quota: { allowed: false, reason: "unknown", retry_after: 20 } }]) {
      const result = await invoke(handler, options);
      assert.equal(result.status, 503);
      assertNoAI(result);
    }
  });

  test(`${name}: missing privileged key fails closed`, async () => {
    const result = await invoke(handler, { environment: { SUPABASE_SERVICE_ROLE_KEY: undefined } });
    assert.equal(result.status, 500);
    assertNoAI(result);
  });

  test(`${name}: invalid input does not reserve or consume quota`, async () => {
    const result = await invoke(handler, { invalidInput: true });
    assert.equal(result.status, 400);
    assertNoAI(result);
    assert.equal(result.calls.length, 1);
  });

  test(`${name}: uses verified identity and releases successful tasks`, async () => {
    const result = await invoke(handler);
    assert.equal(result.status, 200);
    const reserved = result.calls.find(({ url }) => url.endsWith("/reserve_ai_task"));
    assert.equal(reserved.body.p_user_id, userId);
    assert.equal(reserved.body.p_task_type, handler === studyHandler ? "study-assistant" : "analyze-course-file");
    assert.equal(reserved.body.p_lease_seconds, 110);
    assert.equal(reserved.init.headers.apikey, defaults.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(release(result).p_outcome, "succeeded");
    assert.equal(release(result).p_task_id, taskId);
    assert.doesNotMatch(JSON.stringify(result.body), /test-service-key|test-provider-key/);
  });

  test(`${name}: provider rejection is not retried and releases capacity`, async () => {
    const result = await invoke(handler, { outputs: [{ status: 401 }] });
    assert.equal(result.status, 502);
    assert.equal(result.providerCalls, 1);
    assert.equal(release(result).p_outcome, "failed");
    assert.doesNotMatch(result.body.error, /Provider details/);
  });

  test(`${name}: backend logs preserve provider status without exposing private data`, async (t) => {
    const logs = [];
    t.mock.method(console, "error", (...args) => logs.push(args));
    for (const status of [400, 401, 402, 404]) {
      logs.length = 0;
      const result = await invoke(handler, { outputs: [{ status }] });
      assert.equal(result.status, 502);
      assert.deepEqual(logs, [["AI provider request failed", {
        status, providerCode: status, model: "openrouter/free",
      }]]);
      const visible = JSON.stringify({ logs, response: result.body });
      assert.doesNotMatch(visible, /Provider details|test-provider-key|test-service-key|photosynthesis|valid-token/);
      assert.equal(result.body.code, "ai_provider_error");
    }
  });

  test(`${name}: HTTP 200 provider errors are logged with safe numeric codes only`, async (t) => {
    const logs = [];
    t.mock.method(console, "error", (...args) => logs.push(args));
    for (const code of [503, "private-document-text"]) {
      logs.length = 0;
      const result = await invoke(handler, { outputs: [{ providerError: {
        code, message: "private-provider-message", metadata: { raw: "private-document-text" },
      } }] });
      assert.equal(result.status, 502);
      assert.equal(result.providerCalls, 1);
      assert.deepEqual(logs, [["AI provider request failed", {
        status: 200, providerCode: typeof code === "number" ? code : null, model: "openrouter/free",
      }]]);
      assert.doesNotMatch(JSON.stringify({ logs, response: result.body }), /private-/);
      assert.equal(release(result).p_outcome, "failed");
    }
  });

  test(`${name}: retries transient provider errors within the shared budget`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const pending = invoke(handler, { outputs: [{ status: 503 }] });
    const result = await advanceUntilSettled(t, pending);
    assert.equal(result.status, 200);
    assert.equal(result.providerCalls, 2);
    assert.equal(release(result).p_outcome, "succeeded");
  });

  test(`${name}: long provider Retry-After fails fast without excessive waiting`, async () => {
    const result = await invoke(handler, { outputs: [{ status: 429, headers: { "Retry-After": "30" } }] });
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "ai_provider_busy");
    assert.equal(result.providerCalls, 1);
    assert.equal(release(result).p_outcome, "failed");
  });

  test(`${name}: provider calls time out, including retry attempts`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const pending = invoke(handler, { stall: true, environment: { AI_ATTEMPT_TIMEOUT_MS: "1000" } });
    const result = await advanceUntilSettled(t, pending);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "ai_attempt_timeout");
    assert.equal(result.providerCalls, 3);
    assert.equal(release(result).p_outcome, "failed");
  });

  test(`${name}: total deadline aborts AI and releases the lease`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const pending = invoke(handler, { stall: true,
      environment: { AI_TASK_TIMEOUT_MS: "15000", AI_ATTEMPT_TIMEOUT_MS: "15000" } });
    const result = await advanceUntilSettled(t, pending);
    assert.equal(result.status, 504);
    assert.equal(result.body.code, "ai_task_timeout");
    assert.equal(result.providerCalls, 1);
    assert.equal(release(result).p_outcome, "failed");
  });

  test(`${name}: failed cleanup keeps the original result`, async () => {
    const result = await invoke(handler, { finishStatus: 503 });
    assert.equal(result.status, 200);
    assert.equal(release(result).p_outcome, "succeeded");
  });

  test(`${name}: accepts PostgREST's empty 204 response for a successful release`, async () => {
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args);
    try {
      const result = await invoke(handler, { finishStatus: 204 });
      assert.equal(result.status, 200);
      assert.equal(release(result).p_outcome, "succeeded");
      assert.equal(errors.length, 0);
    } finally { console.error = originalError; }
  });

  test(`${name}: total timeout also bounds a stalled provider response body`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const pending = invoke(handler, { stallBody: true,
      environment: { AI_TASK_TIMEOUT_MS: "15000", AI_ATTEMPT_TIMEOUT_MS: "15000" } });
    const result = await advanceUntilSettled(t, pending);
    assert.equal(result.status, 504);
    assert.equal(result.body.code, "ai_task_timeout");
    assert.equal(result.providerCalls, 1);
    assert.equal(release(result).p_outcome, "failed");
  });
}

test("PDF quiz requests use the replacement model and preserve PDF transport", async () => {
  const result = await invoke(studyHandler, {
    mode: "quiz", prompt: "Create a quiz with 1 question", pdf: true,
    unavailableModel: "stealth/space-bunny-alpha",
    outputs: [{ output: { quiz: { title: "Biology", questions: [{
      question: "What powers photosynthesis?", options: ["Sunlight", "Wind", "Sound", "Gravity"],
      correctIndex: 0, explanation: "Light supplies the energy.",
    }] } } }],
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.quiz.questions.length, 1);
  const body = result.calls.find(({ url }) => url.endsWith("/chat/completions")).body;
  assert.equal(body.model, "openrouter/free");
  assert.deepEqual(body.plugins, [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }]);
  const part = body.messages.at(-1).content.find(part => part.type === "file");
  assert.equal(Buffer.from(part.file.file_data.split(",")[1], "base64").toString(), "%PDF-1.7\nMock PDF transport fixture");
  assert.equal(release(result).p_outcome, "succeeded");
});

test("HTTP retries and quiz output repair consume one common provider-call budget", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const pending = invoke(studyHandler, {
    mode: "quiz", prompt: "Create a quiz with 1 question",
    environment: { AI_MAX_PROVIDER_CALLS: "2" },
    outputs: [{ status: 503 }, { output: { quiz: { questions: [] } } }],
  });
  const result = await advanceUntilSettled(t, pending);
  assert.equal(result.status, 502);
  assert.equal(result.body.code, "ai_call_budget_exceeded");
  assert.equal(result.providerCalls, 2);
  assert.equal(release(result).p_outcome, "failed");
});

test("invalid time or call settings stop before quota or provider usage", async () => {
  for (const environment of [{ AI_MAX_PROVIDER_CALLS: "0" }, { AI_TASK_TIMEOUT_MS: "invalid" },
    { AI_TASK_TIMEOUT_MS: "15000", AI_ATTEMPT_TIMEOUT_MS: "30000" }]) {
    const result = await invoke(studyHandler, { environment });
    assert.equal(result.status, 500);
    assertNoAI(result);
    assert.equal(result.calls.length, 1);
  }
});
