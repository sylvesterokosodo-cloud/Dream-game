// Lets Node import Edge Function sources: maps the Deno-only "npm:@supabase/supabase-js@2" specifier to a stub.
import { register } from 'node:module';
register('./resolve-hook.mjs', import.meta.url);
