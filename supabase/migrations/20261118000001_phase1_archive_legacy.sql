-- =====================================================================
-- DREAM GAME - Migration 1: archive the unseen legacy dg_* objects
--
-- WHY: The existing dg_wallets / dg_tournaments / dg_tournament_entries /
-- dg_profiles tables and the dg_join_tournament RPC were never audited
-- (schema + RLS unknown). They are moved - NOT dropped - into a private
-- "legacy" schema that the Supabase API does not expose. Nothing is
-- deleted; data stays recoverable. Old demo balances are NOT migrated
-- (no real payment provider was ever connected).
--
-- REQUIRES YOUR APPROVAL before running on production. Run on a staging
-- project / branch first.
--
-- Idempotent: does nothing if the new schema (dg_tournaments.slug) exists.
-- =====================================================================

create schema if not exists legacy;
revoke all on schema legacy from public, anon, authenticated;

create table if not exists legacy.migration_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,
  detail text not null
);

create table if not exists legacy.dropped_auth_triggers (
  trigger_name text not null,
  function_name text not null,
  definition text not null,
  dropped_at timestamptz not null default now()
);

do $$
declare
  r record;
begin
  -- Already on the new schema? Then there is nothing to archive.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dg_tournaments'
      and column_name = 'slug'
  ) then
    raise notice 'Legacy archive skipped: new schema already present.';
    return;
  end if;

  -- 1. Legacy signup triggers on auth.users that call public dg_* code
  --    would break signups once tables change shape. Record + drop them.
  for r in
    select t.tgname, p.proname, pg_get_triggerdef(t.oid) as def
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'auth.users'::regclass
      and not t.tgisinternal
      and p.pronamespace = 'public'::regnamespace
      and p.prosrc ilike '%dg\_%'
  loop
    insert into legacy.dropped_auth_triggers(trigger_name, function_name, definition)
    values (r.tgname, r.proname, r.def);
    execute format('drop trigger %I on auth.users', r.tgname);
    insert into legacy.migration_log(kind, detail)
    values ('trigger_dropped', r.tgname || ' -> ' || r.proname);
  end loop;

  -- 2. Move legacy public.dg_* functions (e.g. dg_join_tournament).
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and p.proname like 'dg\_%'
  loop
    execute format('alter function %s set schema legacy', r.sig);
    insert into legacy.migration_log(kind, detail) values ('function_moved', r.sig);
  end loop;

  -- 3. Move legacy public.dg_* views.
  for r in
    select viewname from pg_views
    where schemaname = 'public' and viewname like 'dg\_%'
  loop
    execute format('alter view public.%I set schema legacy', r.viewname);
    insert into legacy.migration_log(kind, detail) values ('view_moved', r.viewname);
  end loop;

  -- 4. Move legacy public.dg_* tables (policies/triggers/data travel with them).
  for r in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'dg\_%'
  loop
    execute format('alter table public.%I set schema legacy', r.tablename);
    insert into legacy.migration_log(kind, detail) values ('table_moved', r.tablename);
  end loop;
end $$;
