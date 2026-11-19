import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly with an actionable message (see .env.example / docs/DEPLOYMENT.md).
  throw new Error(
    'Dream Game is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build time.'
  );
}

// Only the PUBLIC anon key is ever used in the browser. All privileged work happens
// in Postgres functions (RLS-protected) and Edge Functions (secrets stay server-side).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
