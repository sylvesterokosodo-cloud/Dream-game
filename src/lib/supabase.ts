import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseConfig } from './config';

/**
 * Validates the PUBLIC settings that were baked into this build.
 * Vite copies VITE_* variables into the bundle at BUILD time, so changing them in Cloudflare
 * has no effect until a new deployment is built.
 */
// Each variable is read by its explicit name so Vite substitutes it at build time.
export const supabaseConfig = resolveSupabaseConfig({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
export const configProblems = supabaseConfig.problems;
export const supabaseHost = supabaseConfig.host;

// If the settings are invalid we still create a harmless client so imports never crash;
// App.tsx shows a clear configuration screen instead of a blank page. No request is ever
// sent to the dummy address because the app does not render its pages in that state.
export const supabase = createClient(
  supabaseConfig.url || 'https://not-configured.invalid',
  supabaseConfig.key || 'not-configured',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);
