// Single source of truth for validating the PUBLIC Supabase settings.
// Used by: the browser client (src/lib/supabase.ts), the build guard (scripts/check-env.mjs) and tests.
// Plain JS (+ config.d.ts) so Node can run it without a TypeScript step. Never logs or returns the key value in messages.

const URL_VAR = 'VITE_SUPABASE_URL';
const KEY_VARS = 'VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY)';
const PLACEHOLDER = /your|placeholder|changeme|example|xxxx|<|>/i;

function jwtRole(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

/** @param {Record<string, string | undefined>} env */
export function resolveSupabaseConfig(env) {
  /** @type {string[]} */
  const problems = [];
  const rawUrl = String(env[URL_VAR] ?? '').trim();
  const rawKey = String(env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  let url = '';
  let host = '';
  let keyKind = null;

  // ---- URL ----
  if (!rawUrl) {
    problems.push(`${URL_VAR} is missing. It must be your project address, e.g. https://<project-ref>.supabase.co`);
  } else {
    if (/^["'].*["']$/.test(rawUrl)) problems.push(`${URL_VAR} has quote marks around it. Remove the quotes.`);
    let parsed = null;
    try {
      parsed = new URL(rawUrl.replace(/^["']|["']$/g, ''));
    } catch {
      problems.push(`${URL_VAR} is not a valid web address.`);
    }
    if (parsed) {
      host = parsed.hostname;
      if (parsed.protocol !== 'https:') problems.push(`${URL_VAR} must start with https://`);
      if (PLACEHOLDER.test(host)) problems.push(`${URL_VAR} still contains a placeholder (${host}). Paste your real Supabase project URL.`);
      if (parsed.pathname !== '/' && parsed.pathname !== '') {
        problems.push(`${URL_VAR} must be only the project address, with nothing after .supabase.co (remove "${parsed.pathname}").`);
      }
      if (/\.supabase\.(com|io|net|app)$/.test(host)) {
        problems.push(`${URL_VAR} ends in "${host.split('.').slice(-2).join('.')}" but Supabase project addresses end in ".supabase.co". This typo makes the browser fail with ERR_NAME_NOT_RESOLVED.`);
      }
      if (host.endsWith('.supabase.co')) {
        const ref = host.slice(0, -'.supabase.co'.length);
        if (!/^[a-z0-9]{20}$/.test(ref)) problems.push(`${URL_VAR} project reference "${ref}" is not a valid 20-character Supabase reference (check for typos).`);
      }
      url = parsed.origin;
    }
  }

  // ---- key ----
  if (!rawKey) {
    problems.push(`${KEY_VARS} is missing. Paste the PUBLISHABLE key (starts with sb_publishable_).`);
  } else if (/\s|["']/.test(rawKey)) {
    problems.push('The Supabase key contains spaces or quote marks. Paste it exactly, with no quotes.');
  } else if (rawKey.startsWith('sb_secret_')) {
    problems.push('DANGER: the key is a SECRET key (sb_secret_...). Never use it in the website. Use the PUBLISHABLE key and rotate the secret key in Supabase.');
  } else if (rawKey.startsWith('sb_publishable_')) {
    if (rawKey.length < 25 || PLACEHOLDER.test(rawKey)) problems.push('The publishable key looks incomplete or is a placeholder.');
    else keyKind = 'publishable';
  } else if (rawKey.startsWith('eyJ')) {
    const role = jwtRole(rawKey);
    if (role === 'service_role') problems.push('DANGER: the key is the service_role key. Never use it in the website. Use the publishable/anon key and rotate the service_role key in Supabase.');
    else if (role === 'anon') keyKind = 'legacy-anon-jwt';
    else problems.push('The key is a token but not a Supabase public (anon) key.');
  } else {
    problems.push('The Supabase key is not recognised. A publishable key starts with sb_publishable_.');
  }

  return { url, key: problems.length ? '' : rawKey, host, keyKind, problems };
}
