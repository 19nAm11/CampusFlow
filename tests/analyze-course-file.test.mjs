import assert from "node:assert/strict";
import { test } from "node:test";

let handler;
const environment = {
  OPENROUTER_API_KEY: "test-key",
  SUPABASE_URL: "https://supabase.example.test",
  CAMPUSFLOW_PUBLISHABLE_KEY: "test-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};
globalThis.Deno = {
  env: { get: (name) => environment[name] },
  serve: (callback) => { handler = callback; },
};
await import("../supabase/functions/analyze-course-file/index.ts");

async function analyze(responses, knownCourses = []) {
  const requests = [];
  const originalFetch = globalThis.fetch;
  let responseIndex = 0;
  globalThis.fetch = async (url, options) => {
    if (url === `${environment.SUPABASE_URL}/auth/v1/user`) {
      assert.equal(options.headers.Authorization, "Bearer test-user-token");
      assert.equal(options.headers.apikey, environment.CAMPUSFLOW_PUBLISHABLE_KEY);
      return Response.json({ id: "test-user" });
    }
    if (url === `${environment.SUPABASE_URL}/rest/v1/rpc/reserve_ai_task`) {
      return Response.json({ allowed: true, task_id: "11111111-1111-4111-8111-111111111111" });
    }
    if (url === `${environment.SUPABASE_URL}/rest/v1/rpc/finish_ai_task`) return Response.json(null);
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    requests.push(JSON.parse(options.body));
    const content = JSON.stringify(responses[Math.min(responseIndex++, responses.length - 1)]);
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const form = new FormData();
    form.append("file", new File(["Additional course information."], "addendum.txt", { type: "text/plain" }));
    form.append("knownCourses", JSON.stringify(knownCourses));
    const response = await handler(new Request("https://example.test/analyze", {
      method: "POST", body: form, headers: { Authorization: "Bearer test-user-token" },
    }));
    return { status: response.status, body: await response.json(), requests };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("accepts a known course with no new key points", { concurrency: false }, async () => {
  const result = await analyze([{ courses: [{
    courseName: "Calculus I", fileIds: ["F1"], keyPoints: [], smallDetails: [],
    schedule: null, coursePeriod: null,
  }] }], ["Calculus I"]);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.courses[0].keyPoints, []);
});

test("accepts a schedule-only course file", { concurrency: false }, async () => {
  const result = await analyze([{ courses: [{
    courseName: "Biology", fileIds: ["F1"], keyPoints: [], smallDetails: [],
    schedule: "Mondays at 10:00", coursePeriod: null,
  }] }]);
  assert.equal(result.status, 200);
  assert.equal(result.body.courses[0].schedule, "Mondays at 10:00");
});

test("asks the model to repair an incomplete first response", { concurrency: false }, async () => {
  const result = await analyze([
    { courses: [{ courseName: "Physics", fileIds: ["F1"], keyPoints: [] }] },
    { courses: [{ courseName: "Physics", fileIds: ["F1"], keyPoints: ["Midterm: October 12."], smallDetails: [] }] },
  ]);
  assert.equal(result.status, 200);
  assert.equal(result.requests.length, 2);
  assert.match(result.requests[1].messages.at(-1).content, /previous response was incomplete/i);
});

test("normalizes a summary object into key points", { concurrency: false }, async () => {
  const result = await analyze([{ courses: [{
    courseName: "History", fileIds: "F1", summary: { text: "Assignments are due Fridays." },
  }] }]);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.courses[0].keyPoints, ["Assignments are due Fridays."]);
});
