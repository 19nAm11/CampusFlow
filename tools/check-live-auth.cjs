const readProject = require('./supabase-project.cjs');

(async () => {
  const project = readProject();
  console.log(`Authentication checks: ${project.url}`);
  let failures = 0;
  for (const name of ['analyze-course-file', 'study-assistant']) {
    const cases = [
      { label: 'missing user token', token: null, expected: 401 },
      { label: 'invalid user token', token: 'invalid-token', expected: 401 },
    ];
    // Optional: a test user's token from your own environment. It is never printed.
    // The empty form must produce validation error 400 after successful Auth,
    // so this check does not submit a valid AI task or incur provider usage.
    if (process.env.CAMPUSFLOW_TEST_ACCESS_TOKEN) {
      cases.push({ label: 'valid user token, empty input', token: process.env.CAMPUSFLOW_TEST_ACCESS_TOKEN, expected: 400 });
    }
    for (const { label, token, expected } of cases) {
      const headers = { apikey: project.publishableKey };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`${project.url}/functions/v1/${name}`, {
        method: 'POST', headers, body: new FormData(), signal: AbortSignal.timeout(10000), redirect: 'error',
      });
      // Consume the response without printing potentially sensitive contents.
      await response.text();
      const passed = response.status === expected;
      console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: ${label} (${response.status}; expected ${expected})`);
      if (!passed) failures += 1;
    }
  }
  if (!process.env.CAMPUSFLOW_TEST_ACCESS_TOKEN) {
    console.log('Signed-in verification was skipped: no test user token configured. Verify it through the app.');
  }
  if (failures) process.exitCode = 1;
})().catch(() => {
  console.error('Live authentication checks could not complete. Check network access and the configured project.');
  process.exitCode = 1;
});
