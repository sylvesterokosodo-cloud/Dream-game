-- =====================================================================
-- DREAM GAME - "What is actually set up in my Supabase project?"  (READ-ONLY)
-- Paste into Supabase Dashboard > SQL Editor > Run. Changes nothing.
-- Every row should show present = true. Send the result table to your developer/assistant.
-- =====================================================================
with t(name) as (values ('dg_profiles'),('dg_admins'),('dg_wallets'),('dg_wallet_ledger'),('dg_payments'),
  ('dg_tournaments'),('dg_tournament_entries'),('dg_escrow_holds'),('dg_tournament_rounds'),('dg_matches'),
  ('dg_admin_audit_log'),('dg_match_secrets')),
f(name) as (values ('dg_is_admin'),('dg_allowed_games'),('dg_admin_create_tournament'),('dg_admin_publish_tournament'),
  ('dg_init_payment'),('dg_credit_purchase'),('dg_join_tournament'),('dg_cancel_entry'),('dg_run_expiry'),
  ('dg_admin_cancel_tournament'),('dg_admin_approve_result'),('dg_system_save_game'),('dg__apply_ledger'),
  ('dg_handle_new_user'),('dg_sync_admin'))
select * from (
  select 1 as o, 'table exists' as check_name, name as item, (to_regclass('public.' || name) is not null) as present from t
  union all
  select 2, 'row level security ON', name, coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || name)), false) from t
  union all
  select 3, 'function exists', name, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f.name) from f
  union all
  select 4, 'signup trigger (creates profile + wallet)', 'dg_on_auth_user_created',
         exists (select 1 from pg_trigger where tgname = 'dg_on_auth_user_created' and tgrelid = 'auth.users'::regclass)
  union all
  select 4, 'admin sync trigger', 'dg_sync_admin_trg',
         exists (select 1 from pg_trigger where tgname = 'dg_sync_admin_trg' and tgrelid = 'auth.users'::regclass)
  union all
  select 5, 'migration 8 admin payments policy', 'dg_payments_read_admin',
         exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'dg_payments_read_admin')
  union all
  select 6, 'owner account registered', 'sylvesterokosodo@gmail.com',
         exists (select 1 from auth.users where lower(email) = 'sylvesterokosodo@gmail.com')
  union all
  select 6, 'owner email CONFIRMED', 'sylvesterokosodo@gmail.com',
         exists (select 1 from auth.users where lower(email) = 'sylvesterokosodo@gmail.com' and email_confirmed_at is not null)
  union all
  select 6, 'owner is admin in dg_admins',  'dg_admins',
         case when to_regclass('public.dg_admins') is not null
              then ((xpath('/row/c/text()', query_to_xml('select count(*) as c from public.dg_admins', false, true, '')))[1]::text)::int = 1
              else false end
) x
order by o, check_name, item;
