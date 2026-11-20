// Runs automatically before `npm run build` (npm "prebuild"). Fails the Cloudflare build with a
// plain-English reason if the Supabase settings are wrong, and prints SAFE facts to the build log
// (project host, key type, library version, commit) so you can prove what was deployed.
import { readFileSync } from 'node:fs';
import { resolveSupabaseConfig } from '../src/lib/config.js';

const cfg = resolveSupabaseConfig(process.env);
let sdk = 'not installed';
try {
  sdk = JSON.parse(readFileSync(new URL('../node_modules/@supabase/supabase-js/package.json', import.meta.url), 'utf8')).version;
} catch { /* ignore */ }

console.log('[env-check] Supabase host      :', cfg.host || '(none)');
console.log('[env-check] Public key type    :', cfg.keyKind ?? '(invalid)');
console.log('[env-check] supabase-js version:', sdk);
console.log('[env-check] Commit being built :', process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '(local build)');
console.log('[env-check] Branch             :', process.env.CF_PAGES_BRANCH || '(local)');

if (cfg.problems.length) {
  console.error('\n[env-check] BUILD STOPPED. Fix these in Cloudflare Pages > Settings > Variables and Secrets:\n');
  for (const p of cfg.problems) console.error('  - ' + p);
  console.error('\nThen use Deployments > Retry deployment.\n');
  process.exit(1);
}
const major = Number(sdk.split('.')[0]);
const minor = Number(sdk.split('.')[1]);
if (cfg.keyKind === 'publishable' && major === 2 && minor < 50) {
  console.warn('[env-check] WARNING: supabase-js is older than 2.50; run "npm install @supabase/supabase-js@latest" to support sb_publishable_ keys.');
}
console.log('[env-check] OK');
