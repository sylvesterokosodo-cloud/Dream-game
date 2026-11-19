-- =====================================================================
-- DREAM GAME - Phase 0 inventory (READ-ONLY)
-- Run in: Supabase Dashboard -> SQL Editor. Safe: SELECT only, no writes.
-- Output: ONE JSON cell. Copy it into chat or save it for your records.
-- Contains NO user emails, passwords, keys or balances (only counts/flags).
-- It DOES include function source code; skim it for secrets before sharing.
-- =====================================================================
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),

  'columns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', table_name, 'column', column_name, 'type', data_type,
      'nullable', is_nullable, 'default', column_default)
      order by table_name, ordinal_position)
    from information_schema.columns
    where table_schema = 'public'
      and (table_name like 'dg\_%' or table_name like 'dream\_%')
  ), '[]'::jsonb),

  'row_level_security', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', c.relname, 'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity) order by c.relname)
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  ), '[]'::jsonb),

  'policies', coalesce((
    select jsonb_agg(to_jsonb(p) order by p.tablename, p.policyname)
    from pg_policies p where p.schemaname = 'public'
  ), '[]'::jsonb),

  'client_role_grants_on_dg_tables', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', table_name, 'grantee', grantee, 'privilege', privilege_type)
      order by table_name, grantee, privilege_type)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and table_name like 'dg\_%'
  ), '[]'::jsonb),

  'functions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'args', pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef,
      'definition', pg_get_functiondef(p.oid)) order by p.proname)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and p.proname like 'dg\_%'
  ), '[]'::jsonb),

  'triggers', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table', t.tgrelid::regclass::text, 'trigger', t.tgname,
      'definition', pg_get_triggerdef(t.oid)) order by t.tgrelid::regclass::text, t.tgname)
    from pg_trigger t
    where not t.tgisinternal
      and (t.tgrelid = 'auth.users'::regclass
           or t.tgrelid in (select oid from pg_class
                            where relnamespace = 'public'::regnamespace
                              and relname like 'dg\_%'))
  ), '[]'::jsonb),

  'approx_row_counts', coalesce((
    select jsonb_agg(jsonb_build_object('table', relname, 'approx_rows', n_live_tup)
                     order by relname)
    from pg_stat_user_tables
    where schemaname = 'public'
      and (relname like 'dg\_%' or relname like 'dream\_%')
  ), '[]'::jsonb),

  'auth_summary', jsonb_build_object(
    'users_total', (select count(*) from auth.users),
    'users_unconfirmed', (select count(*) from auth.users where email_confirmed_at is null),
    'admin_email_registered',
      exists (select 1 from auth.users where lower(email) = 'sylvesterokosodo@gmail.com'),
    'admin_email_confirmed',
      exists (select 1 from auth.users
              where lower(email) = 'sylvesterokosodo@gmail.com'
                and email_confirmed_at is not null)
  ),

  'extensions', coalesce((
    select jsonb_agg(jsonb_build_object('name', extname, 'version', extversion) order by extname)
    from pg_extension
  ), '[]'::jsonb)
)) as phase0_inventory;
