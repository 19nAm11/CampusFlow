const { spawnSync } = require('node:child_process');
const readProject = require('./supabase-project.cjs');

async function main() {
  const project = readProject();
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run this tool with npm run deploy:auth.');
  console.log(`Deployment target: ${project.url}`);

  function supabase(args, capture = false) {
    const result = spawnSync(process.execPath, [npmCli, 'exec', '--yes', '--package=supabase@2.119.0',
      '--', 'supabase', ...args], {
      cwd: project.root,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Supabase command failed. Check login and project access before retrying.');
    return result.stdout;
  }

  // Read the existing gateway settings before making any remote changes.
  const remote = JSON.parse(supabase(['functions', 'list', '--project-ref', project.projectRef, '--output', 'json'], true));
  if (!Array.isArray(remote)) throw new Error('Unexpected function-list response; no changes were made.');
  const names = ['analyze-course-file', 'study-assistant'];
  const settings = names.map(name => {
    const fn = remote.find(item => item.slug === name || item.name === name);
    if (!fn || typeof fn.verify_jwt !== 'boolean') {
      throw new Error(`Cannot confirm existing gateway settings for ${name}; no changes were made.`);
    }
    console.log(`${name}: preserving gateway verify_jwt=${fn.verify_jwt}`);
    return { name, verifyJwt: fn.verify_jwt };
  });

  // Refuse to deploy handlers requiring quota RPCs before their migration is
  // present. Browser roles must be denied permission to call these functions.
  for (const [name, body] of [
    ['reserve_ai_task', { p_user_id: '11111111-1111-4111-8111-111111111111',
      p_task_type: 'study-assistant', p_lease_seconds: 110 }],
    ['finish_ai_task', { p_user_id: '11111111-1111-4111-8111-111111111111',
      p_task_id: '22222222-2222-4222-8222-222222222222', p_outcome: 'failed' }],
  ]) {
    const response = await fetch(`${project.url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: project.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    const result = await response.json().catch(() => null);
    if (![401, 403].includes(response.status) || result?.code !== '42501') {
      throw new Error(`Quota migration/permissions for ${name} could not be confirmed. Apply 20261006_add_ai_usage_controls.sql first; no secrets or functions were changed.`);
    }
  }

  // This is the same public browser key, not a service-role or provider key.
  supabase(['secrets', 'set', `CAMPUSFLOW_PUBLISHABLE_KEY=${project.publishableKey}`,
    '--project-ref', project.projectRef]);
  for (const { name, verifyJwt } of settings) {
    supabase(['functions', 'deploy', name, '--project-ref', project.projectRef, '--use-api',
      ...(verifyJwt ? [] : ['--no-verify-jwt'])]);
  }
  console.log('Both functions deployed. Run npm run test:auth:live, then verify a signed-in user in CampusFlow.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
