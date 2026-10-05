const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = function readProject() {
  const root = path.resolve(__dirname, '..');
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'supabase-config.js'), 'utf8'), context, {
    timeout: 1000,
  });
  const config = context.window.SUPABASE_CONFIG;
  if (!config || typeof config.url !== 'string' || typeof config.publishableKey !== 'string') {
    throw new Error('Set the project URL and publishable key in supabase-config.js first.');
  }
  const url = new URL(config.url);
  const match = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
  if (url.protocol !== 'https:' || !match || url.port || url.username || url.password ||
      !config.publishableKey.startsWith('sb_publishable_')) {
    throw new Error('These deployment tools require a hosted Supabase URL and a browser publishable key.');
  }
  return { root, url: url.origin, projectRef: match[1], publishableKey: config.publishableKey };
};
