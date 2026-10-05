import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const db = new PGlite();
const migration = await readFile(new URL("../supabase/migrations/20261006_add_ai_usage_controls.sql", import.meta.url), "utf8");

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${alice}'), ('${bob}');
  `);
  await db.exec(migration);
});
beforeEach(async () => {
  await db.exec(`truncate public.ai_usage_tasks, public.ai_usage_accounts;
    update public.ai_usage_settings set requests_per_minute = 6, requests_per_day = 50, max_concurrent = 2;`);
});
after(async () => { await db.close(); });

async function reserve(user = alice, type = "study-assistant", lease = 110) {
  const result = await db.query("select public.reserve_ai_task($1::uuid, $2, $3) as result", [user, type, lease]);
  return result.rows[0].result;
}
async function finish(taskId, user = alice, outcome = "succeeded") {
  await db.query("select public.finish_ai_task($1::uuid, $2::uuid, $3)", [user, taskId, outcome]);
}

test("quota migration can be applied again without resetting settings or usage", async () => {
  await db.exec("update public.ai_usage_settings set requests_per_day = 20");
  await reserve();
  await db.exec(migration);
  assert.equal((await db.query("select requests_per_day from public.ai_usage_settings")).rows[0].requests_per_day, 20);
  assert.equal((await db.query("select count(*)::int as count from public.ai_usage_tasks")).rows[0].count, 1);
});

test("database admission shares the concurrent cap across both AI functions", async () => {
  const requests = await Promise.all(Array.from({ length: 10 }, (_, index) =>
    reserve(alice, index % 2 ? "study-assistant" : "analyze-course-file")));
  assert.equal(requests.filter(item => item.allowed).length, 2);
  assert.equal(requests.filter(item => item.reason === "concurrent_limit").length, 8);
  assert.equal((await db.query("select count(*)::int as count from public.ai_usage_tasks")).rows[0].count, 2);
});

test("completing a task releases capacity without refunding minute or daily usage", async () => {
  const first = await reserve();
  await reserve();
  await finish(first.task_id);
  const third = await reserve();
  assert.equal(third.allowed, true);
  assert.equal(third.remaining_minute, 3);
  assert.equal(third.remaining_day, 47);
});

test("failed tasks count toward rate limits", async () => {
  for (let index = 0; index < 6; index++) {
    const task = await reserve(alice, index % 2 ? "study-assistant" : "analyze-course-file");
    assert.equal(task.allowed, true);
    await finish(task.task_id, alice, "failed");
  }
  const rejected = await reserve();
  assert.equal(rejected.reason, "minute_limit");
  assert.ok(rejected.retry_after >= 1 && rejected.retry_after <= 60);
});

test("rolling minute limit clears when accepted tasks age out", async () => {
  await db.exec("update public.ai_usage_settings set requests_per_minute = 1");
  const task = await reserve();
  await finish(task.task_id);
  assert.equal((await reserve()).reason, "minute_limit");
  await db.exec("update public.ai_usage_tasks set started_at = clock_timestamp() - interval '61 seconds'");
  assert.equal((await reserve()).allowed, true);
});

test("daily quota returns a retry interval to UTC midnight", async () => {
  await db.exec("update public.ai_usage_settings set requests_per_day = 2");
  for (let index = 0; index < 2; index++) await finish((await reserve()).task_id);
  const rejected = await reserve();
  assert.equal(rejected.reason, "daily_limit");
  assert.ok(rejected.retry_after >= 1 && rejected.retry_after <= 86400);
});

test("UTC day reset is independent of database display timezone", async () => {
  await db.exec("set timezone = 'America/New_York'; update public.ai_usage_settings set requests_per_day = 1;");
  const task = await reserve();
  await finish(task.task_id);
  await db.exec(`update public.ai_usage_tasks set started_at =
    (date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC') - interval '1 minute';`);
  const next = await reserve();
  assert.equal(next.allowed, true);
  assert.equal(next.remaining_day, 0);
});

test("expired leases recover slots after worker failure", async () => {
  await reserve();
  await reserve();
  assert.equal((await reserve()).reason, "concurrent_limit");
  await db.exec(`update public.ai_usage_tasks set started_at = clock_timestamp() - interval '3 minutes',
    expires_at = clock_timestamp() - interval '1 minute';`);
  assert.equal((await reserve()).allowed, true);
});

test("another user's quota and task completion are isolated", async () => {
  const task = await reserve();
  await reserve();
  assert.equal((await reserve(bob)).allowed, true);
  await finish(task.task_id, bob);
  assert.equal((await reserve()).reason, "concurrent_limit");
});

test("finish is idempotent and cannot alter an already recorded outcome", async () => {
  const task = await reserve();
  await finish(task.task_id);
  await finish(task.task_id, alice, "failed");
  const row = (await db.query("select outcome from public.ai_usage_tasks where id = $1::uuid", [task.task_id])).rows[0];
  assert.equal(row.outcome, "succeeded");
});

test("browser roles cannot edit quotas, reserve, or prematurely release tasks", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query("select * from public.ai_usage_settings"), /permission denied/);
      await assert.rejects(reserve(), /permission denied/);
      await assert.rejects(finish(alice), /permission denied/);
    } finally { await db.exec("reset role"); }
  }
  await db.exec("set role service_role");
  try { assert.equal((await reserve()).allowed, true); }
  finally { await db.exec("reset role"); }
});

test("invalid reservations are rejected and do not consume quota", async () => {
  await assert.rejects(reserve(alice, "unknown"), /Invalid AI task reservation/);
  await assert.rejects(reserve(alice, "study-assistant", 10), /Invalid AI task reservation/);
  assert.equal((await db.query("select count(*)::int as count from public.ai_usage_tasks")).rows[0].count, 0);
});
