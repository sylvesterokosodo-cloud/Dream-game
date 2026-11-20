// Run: npm run test:config  — verifies the Supabase settings checker and the build guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolveSupabaseConfig as cfg } from '../src/lib/config.js';

const URL_OK = 'https://yjhtepcxpdoroptdrqoh.supabase.co';
const KEY_OK = 'sb_publishable_AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role) => `${b64({ alg: 'HS256' })}.${b64({ role })}.signaturepart`;
const env = (o) => ({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: KEY_OK, ...o });
const bad = (o, re) => {
  const r = cfg(env(o));
  assert.ok(r.problems.length > 0, 'expected a problem for ' + JSON.stringify(o));
  assert.match(r.problems.join(' | '), re);
  assert.equal(r.key, '', 'an invalid config must not expose a usable key');
};

test('the real project URL + publishable key are accepted and normalised', () => {
  const r = cfg(env({}));
  assert.deepEqual(r.problems, []);
  assert.equal(r.url, URL_OK);
  assert.equal(r.host, 'yjhtepcxpdoroptdrqoh.supabase.co');
  assert.equal(r.keyKind, 'publishable');
  assert.equal(cfg(env({ VITE_SUPABASE_URL: URL_OK + '/' })).url, URL_OK, 'trailing slash is harmless');
  assert.equal(cfg(env({ VITE_SUPABASE_URL: '  ' + URL_OK + '  ' })).problems.length, 0, 'surrounding spaces are trimmed');
});

test('causes of "Failed to fetch / ERR_NAME_NOT_RESOLVED" are caught before deployment', () => {
  bad({ VITE_SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co' }, /placeholder|20-character/);   // copied from .env.example
  bad({ VITE_SUPABASE_URL: 'https://yjhtepcxpdoroptdrqoh.supabase.com' }, /ERR_NAME_NOT_RESOLVED/);    // .com instead of .co
});
test('typos and bad shapes in the URL', () => {
  bad({ VITE_SUPABASE_URL: 'https://yjhtepcxpdoroptdrqo.supabase.co' }, /20-character/);               // one letter missing
  bad({ VITE_SUPABASE_URL: 'https://yjhtepcxpdoroptdrqohh.supabase.co' }, /20-character/);              // one letter extra
  bad({ VITE_SUPABASE_URL: 'http://yjhtepcxpdoroptdrqoh.supabase.co' }, /https/);
  bad({ VITE_SUPABASE_URL: URL_OK + '/rest/v1' }, /nothing after/);
  bad({ VITE_SUPABASE_URL: `"${URL_OK}"` }, /quote/);
  bad({ VITE_SUPABASE_URL: 'yjhtepcxpdoroptdrqoh.supabase.co' }, /valid web address/);                  // missing https://
  bad({ VITE_SUPABASE_URL: '' }, /missing/);
  bad({ VITE_SUPABASE_URL: undefined }, /missing/);
});
test('keys: missing, malformed, placeholder', () => {
  bad({ VITE_SUPABASE_ANON_KEY: '' }, /missing/);
  bad({ VITE_SUPABASE_ANON_KEY: 'YOUR-PUBLIC-ANON-KEY' }, /not recognised/);
  bad({ VITE_SUPABASE_ANON_KEY: `"${KEY_OK}"` }, /quote/);
  bad({ VITE_SUPABASE_ANON_KEY: KEY_OK + ' extra' }, /spaces/);
  bad({ VITE_SUPABASE_ANON_KEY: 'sb_publishable_short' }, /incomplete/);
});
test('SECRET keys are refused so they can never ship in the website', () => {
  bad({ VITE_SUPABASE_ANON_KEY: 'sb_secret_AbCdEfGhIjKlMnOpQrStUvWxYz012345' }, /SECRET/);
  bad({ VITE_SUPABASE_ANON_KEY: jwt('service_role') }, /service_role/);
  const r = cfg(env({ VITE_SUPABASE_ANON_KEY: 'sb_secret_AbCdEfGhIjKlMnOpQrStUvWxYz012345' }));
  assert.ok(!JSON.stringify(r).includes('AbCdEfGhIjKlMnOpQrStUvWxYz'), 'secret never echoed back');
});
test('legacy anon JWT and the alternate variable name still work', () => {
  assert.equal(cfg(env({ VITE_SUPABASE_ANON_KEY: jwt('anon') })).keyKind, 'legacy-anon-jwt');
  const alt = cfg({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK });
  assert.deepEqual(alt.problems, []);
  const both = cfg(env({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_OTHERotherOTHERotherOTHER1234' }));
  assert.equal(both.key, KEY_OK, 'VITE_SUPABASE_ANON_KEY wins when both are set');
});
test('wrongly named variables (SUPABASE_URL without VITE_) are reported as missing', () => {
  const r = cfg({ SUPABASE_URL: URL_OK, SUPABASE_ANON_KEY: KEY_OK });
  assert.equal(r.problems.length, 2);
});

// ---- the build guard (scripts/check-env.mjs) ----
const guard = (e) => spawnSync(process.execPath, ['scripts/check-env.mjs'], { env: { PATH: process.env.PATH, ...e }, encoding: 'utf8' });
test('build guard passes for good settings, prints safe facts, never prints the key', () => {
  const r = guard({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: KEY_OK, CF_PAGES_COMMIT_SHA: 'abc1234def' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /yjhtepcxpdoroptdrqoh\.supabase\.co/);
  assert.match(r.stdout, /abc1234def/);
  assert.ok(!(r.stdout + r.stderr).includes(KEY_OK));
});
test('build guard STOPS the build for the placeholder URL and for a secret key', () => {
  let r = guard({ VITE_SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co', VITE_SUPABASE_ANON_KEY: KEY_OK });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /BUILD STOPPED/);
  const secret = 'sb_secret_AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  r = guard({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: secret });
  assert.equal(r.status, 1);
  assert.ok(!(r.stdout + r.stderr).includes(secret), 'secret key never printed to the build log');
  assert.equal(guard({}).status, 1, 'no variables at all fails the build');
});
