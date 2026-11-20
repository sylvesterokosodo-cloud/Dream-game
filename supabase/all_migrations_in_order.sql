-- =====================================================================
-- DREAM GAME - ALL MIGRATIONS IN ORDER (for the Supabase SQL Editor, no command line needed)
-- Run ONLY AFTER you have run supabase/diagnostics/check_applied.sql and confirmed they are not yet applied.
-- Paste the WHOLE file and click Run once. It runs as one transaction: if anything fails, nothing is applied.
-- Migration 1 moves any OLD dg_* tables into a private 'legacy' schema (nothing is deleted).
-- STATUS: not yet executed by the author (no database was available). Run on a STAGING project first.
-- =====================================================================

-- ################ 20261118000001_phase1_archive_legacy.sql ################

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


-- ################ 20261118000002_phase1_schema.sql ################

-- =====================================================================
-- DREAM GAME - Migration 2: core schema
-- Money unit: 1 coin = NGN 1 (whole numbers only; bigint everywhere).
-- Phase 1 creates every table so RLS is deny-by-default from day one.
-- Money-moving functions (escrow, Flutterwave credit) arrive in Phase 2/3.
-- =====================================================================

-- Single source of truth for the game catalogue (matches your 7 games).
create or replace function public.dg_allowed_games()
returns text[] language sql immutable set search_path = '' as $$
  select array['tic-tac-toe','connect-4','gomoku','memory-match',
               'scramble','puzzle','chess']::text[]
$$;

-- ---------- identity ----------
create table public.dg_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 48),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- At most ONE row can ever exist, and only for the owner email.
create table public.dg_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null check (email = 'sylvesterokosodo@gmail.com'),
  granted_at timestamptz not null default now()
);
create unique index dg_admins_single_row on public.dg_admins ((true));

-- ---------- money ----------
create table public.dg_wallets (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  available_coins bigint not null default 0 check (available_coins >= 0),
  escrowed_coins  bigint not null default 0 check (escrowed_coins  >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Append-only journal. Every balance change must produce a row (Phase 2).
create table public.dg_wallet_ledger (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete restrict,
  entry_type      text not null check (entry_type in (
                    'purchase','entry_reserve','entry_refund',
                    'entry_settle','prize_credit','admin_adjustment')),
  available_delta bigint not null,
  escrow_delta    bigint not null default 0,
  available_after bigint not null check (available_after >= 0),
  escrow_after    bigint not null check (escrow_after >= 0),
  reference_type  text,
  reference_id    text,
  idempotency_key text not null unique,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index dg_wallet_ledger_user_idx on public.dg_wallet_ledger (user_id, created_at desc);

-- Flutterwave payment attempts. 1 coin per NGN is enforced by the CHECK.
create table public.dg_payments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete restrict,
  tx_ref             text not null unique,
  flw_transaction_id text unique,
  amount_ngn         bigint not null check (amount_ngn between 100 and 500000),
  coins              bigint not null,
  currency           text not null default 'NGN' check (currency = 'NGN'),
  status             text not null default 'pending'
                     check (status in ('pending','successful','failed','cancelled')),
  ledger_id          uuid references public.dg_wallet_ledger(id),
  created_at         timestamptz not null default now(),
  verified_at        timestamptz,
  constraint dg_payments_one_coin_per_naira check (coins = amount_ngn)
);
create index dg_payments_user_idx on public.dg_payments (user_id, created_at desc);

-- ---------- tournaments ----------
create table public.dg_tournaments (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique
                        check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title                 text not null check (char_length(btrim(title)) between 3 and 120),
  description           text not null default '' check (char_length(description) <= 2000),
  prize_title           text not null check (char_length(btrim(prize_title)) between 2 and 120),
  prize_description     text not null check (char_length(btrim(prize_description)) between 2 and 2000),
  prize_image_url       text check (prize_image_url is null
                                    or (prize_image_url ~* '^https://[^[:space:]]+$'
                                        and char_length(prize_image_url) <= 2048)),
  prize_value_ngn       bigint not null default 0 check (prize_value_ngn between 0 and 1000000000),
  entry_fee_coins       bigint not null check (entry_fee_coins between 1 and 1000000),
  target_players        integer not null check (target_players between 2 and 512),
  games                 text[] not null
                        check (cardinality(games) >= 1 and games <@ public.dg_allowed_games()),
  status                text not null default 'draft'
                        check (status in ('draft','open','live','completed','cancelled','failed')),
  entries_count         integer not null default 0
                        check (entries_count >= 0 and entries_count <= target_players),
  published_at          timestamptz,
  registration_deadline timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  champion_user_id      uuid references auth.users(id) on delete set null,
  champion_name         text,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint dg_tournaments_deadline_when_published
    check (status = 'draft' or registration_deadline is not null)
);
create index dg_tournaments_status_idx on public.dg_tournaments (status, registration_deadline);

create table public.dg_tournament_entries (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.dg_tournaments(id) on delete restrict,
  user_id       uuid not null references auth.users(id) on delete restrict,
  fee_coins     bigint not null check (fee_coins > 0),
  status        text not null default 'reserved'
                check (status in ('reserved','active','eliminated','champion','refunded')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tournament_id, user_id)
);
create index dg_entries_user_idx on public.dg_tournament_entries (user_id);

-- One escrow hold per entry; money sits here until refunded or settled.
create table public.dg_escrow_holds (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null unique references public.dg_tournament_entries(id) on delete restrict,
  tournament_id uuid not null references public.dg_tournaments(id) on delete restrict,
  user_id       uuid not null references auth.users(id) on delete restrict,
  amount_coins  bigint not null check (amount_coins > 0),
  status        text not null default 'held' check (status in ('held','refunded','settled')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  constraint dg_escrow_resolved_consistent check ((status = 'held') = (resolved_at is null))
);
create index dg_escrow_open_idx on public.dg_escrow_holds (tournament_id) where status = 'held';

-- ---------- brackets ----------
create table public.dg_tournament_rounds (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.dg_tournaments(id) on delete cascade,
  round_number  integer not null check (round_number >= 1),
  status        text not null default 'pending' check (status in ('pending','active','completed')),
  created_at    timestamptz not null default now(),
  unique (tournament_id, round_number)
);

-- Byes (not house bots) balance odd player counts. Bots never exist in v1.
create table public.dg_matches (
  id                  uuid primary key default gen_random_uuid(),
  tournament_id       uuid not null references public.dg_tournaments(id) on delete cascade,
  round_id            uuid not null references public.dg_tournament_rounds(id) on delete cascade,
  match_number        integer not null check (match_number >= 1),
  game                text not null check (game = any (public.dg_allowed_games())),
  player_a            uuid references auth.users(id) on delete set null,
  player_b            uuid references auth.users(id) on delete set null,
  is_bye              boolean not null default false,
  winner_id           uuid references auth.users(id) on delete set null,
  status              text not null default 'pending'
                      check (status in ('pending','ready','in_progress','awaiting_approval','completed')),
  result_submitted_by uuid references auth.users(id) on delete set null,
  result_submitted_at timestamptz,
  approved_by         uuid references auth.users(id) on delete set null,
  approved_at         timestamptz,
  game_state          jsonb,
  created_at          timestamptz not null default now(),
  unique (round_id, match_number),
  constraint dg_matches_winner_is_player check (winner_id is null or winner_id in (player_a, player_b)),
  constraint dg_matches_bye_has_no_opponent check (not is_bye or player_b is null)
);
create index dg_matches_tournament_idx on public.dg_matches (tournament_id);

-- ---------- audit ----------
create table public.dg_admin_audit_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);


-- ################ 20261118000003_phase1_admin_and_triggers.sql ################

-- =====================================================================
-- DREAM GAME - Migration 3: admin identity, triggers, backfill
-- Admin = exactly one confirmed account owning sylvesterokosodo@gmail.com.
-- Enforced in the database (dg_admins CHECK + single-row index) and
-- re-verified on every call by dg_is_admin(). No client-side trust.
-- =====================================================================

create or replace function public.dg_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger dg_profiles_touch   before update on public.dg_profiles
  for each row execute function public.dg_touch_updated_at();
create trigger dg_wallets_touch    before update on public.dg_wallets
  for each row execute function public.dg_touch_updated_at();
create trigger dg_tournaments_touch before update on public.dg_tournaments
  for each row execute function public.dg_touch_updated_at();
create trigger dg_entries_touch    before update on public.dg_tournament_entries
  for each row execute function public.dg_touch_updated_at();

-- ---------- append-only protection (ledger + audit log) ----------
create or replace function public.dg_forbid_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% on % is not permitted: table is append-only', tg_op, tg_table_name
    using errcode = '42501';
end $$;

create trigger dg_ledger_append_only before update or delete on public.dg_wallet_ledger
  for each row execute function public.dg_forbid_mutation();
create trigger dg_ledger_no_truncate before truncate on public.dg_wallet_ledger
  for each statement execute function public.dg_forbid_mutation();
create trigger dg_audit_append_only before update or delete on public.dg_admin_audit_log
  for each row execute function public.dg_forbid_mutation();
create trigger dg_audit_no_truncate before truncate on public.dg_admin_audit_log
  for each statement execute function public.dg_forbid_mutation();

-- ---------- admin check ----------
create or replace function public.dg_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.dg_admins a
    join auth.users u on u.id = a.user_id
    where a.user_id = (select auth.uid())
      and lower(u.email) = a.email
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.dg_is_admin() from public;
grant execute on function public.dg_is_admin() to anon, authenticated;

-- ---------- keep dg_admins in sync with auth.users ----------
create or replace function public.dg_sync_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if lower(coalesce(new.email, '')) = 'sylvesterokosodo@gmail.com'
     and new.email_confirmed_at is not null then
    insert into public.dg_admins (user_id, email)
    values (new.id, 'sylvesterokosodo@gmail.com')
    on conflict do nothing;
  else
    delete from public.dg_admins where user_id = new.id;
  end if;
  return new;
end $$;
revoke all on function public.dg_sync_admin() from public, anon, authenticated;

drop trigger if exists dg_sync_admin_trg on auth.users;
create trigger dg_sync_admin_trg
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.dg_sync_admin();

-- ---------- profile + wallet on signup ----------
create or replace function public.dg_handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  v_name := btrim(coalesce(
              nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
              split_part(coalesce(new.email, ''), '@', 1)));
  v_name := left(regexp_replace(v_name, '[[:cntrl:]]', '', 'g'), 48);
  if char_length(v_name) < 2 then
    v_name := 'Player';
  end if;

  insert into public.dg_profiles (id, display_name) values (new.id, v_name)
    on conflict (id) do nothing;
  insert into public.dg_wallets (user_id) values (new.id)
    on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function public.dg_handle_new_user() from public, anon, authenticated;

drop trigger if exists dg_on_auth_user_created on auth.users;
create trigger dg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.dg_handle_new_user();

-- ---------- backfill existing accounts ----------
insert into public.dg_profiles (id, display_name)
select u.id,
       case when char_length(left(btrim(coalesce(
                nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
                split_part(coalesce(u.email, ''), '@', 1))), 48)) >= 2
            then left(btrim(coalesce(
                nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
                split_part(coalesce(u.email, ''), '@', 1))), 48)
            else 'Player' end
from auth.users u
on conflict (id) do nothing;

insert into public.dg_wallets (user_id)
select id from auth.users
on conflict (user_id) do nothing;

insert into public.dg_admins (user_id, email)
select id, 'sylvesterokosodo@gmail.com'
from auth.users
where lower(email) = 'sylvesterokosodo@gmail.com'
  and email_confirmed_at is not null
on conflict do nothing;


-- ################ 20261118000004_phase1_rls.sql ################

-- =====================================================================
-- DREAM GAME - Migration 4: deny-by-default grants + Row Level Security
-- Rule: browsers (anon/authenticated) get READ access only, and only to
-- what they need. NO client INSERT/UPDATE/DELETE on any money, tournament,
-- bracket or admin table. All writes go through SECURITY DEFINER functions.
-- =====================================================================

-- 1. Strip every default privilege from client roles on our tables.
do $$
declare t text;
begin
  foreach t in array array[
    'dg_profiles','dg_admins','dg_wallets','dg_wallet_ledger','dg_payments',
    'dg_tournaments','dg_tournament_entries','dg_escrow_holds',
    'dg_tournament_rounds','dg_matches','dg_admin_audit_log']
  loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 2. Minimal read grants.
grant select on public.dg_tournaments        to anon, authenticated;
grant select on public.dg_profiles           to authenticated;
grant select on public.dg_wallets            to authenticated;
grant select on public.dg_wallet_ledger      to authenticated;
grant select on public.dg_payments           to authenticated;
grant select on public.dg_tournament_entries to authenticated;
grant select on public.dg_escrow_holds       to authenticated;
grant select on public.dg_tournament_rounds  to authenticated;
grant select on public.dg_matches            to authenticated;
grant select on public.dg_admin_audit_log    to authenticated;   -- policy: admin only
-- Players may rename themselves; nothing else on profiles is writable.
grant update (display_name) on public.dg_profiles to authenticated;
-- dg_admins: no grants at all. Use dg_is_admin().

-- 3. Policies.
-- Public tournament info (drafts hidden from everyone except the admin).
create policy dg_tournaments_read on public.dg_tournaments
  for select to anon, authenticated
  using (status <> 'draft' or (select public.dg_is_admin()));

-- Display names are visible to signed-in users (needed for brackets/winners).
create policy dg_profiles_read on public.dg_profiles
  for select to authenticated using (true);
create policy dg_profiles_rename_self on public.dg_profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Private money data: owner only.
create policy dg_wallets_read_own on public.dg_wallets
  for select to authenticated using (user_id = (select auth.uid()));
create policy dg_ledger_read_own on public.dg_wallet_ledger
  for select to authenticated using (user_id = (select auth.uid()));
create policy dg_payments_read_own on public.dg_payments
  for select to authenticated using (user_id = (select auth.uid()));
create policy dg_escrow_read_own_or_admin on public.dg_escrow_holds
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.dg_is_admin()));

-- Entries: you see your own; the admin sees all. Public headcount comes from
-- dg_tournaments.entries_count, so no one else's entry data is exposed.
create policy dg_entries_read_own_or_admin on public.dg_tournament_entries
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.dg_is_admin()));

-- Brackets follow tournament visibility (the subquery is itself RLS-filtered).
create policy dg_rounds_read on public.dg_tournament_rounds
  for select to authenticated
  using (exists (select 1 from public.dg_tournaments t where t.id = tournament_id));
create policy dg_matches_read on public.dg_matches
  for select to authenticated
  using (exists (select 1 from public.dg_tournaments t where t.id = tournament_id));

create policy dg_audit_read_admin on public.dg_admin_audit_log
  for select to authenticated using ((select public.dg_is_admin()));

-- 4. Internal-only functions must not be callable from the API.
revoke all on function public.dg_allowed_games()     from public, anon, authenticated;
revoke all on function public.dg_touch_updated_at()  from public, anon, authenticated;
revoke all on function public.dg_forbid_mutation()   from public, anon, authenticated;


-- ################ 20261118000005_phase1_admin_rpcs.sql ################

-- =====================================================================
-- DREAM GAME - Migration 5: admin-only tournament functions
-- These replace the unseen `create-tournament` Edge Function (retire it).
-- The admin check runs INSIDE the database on every call.
-- Every tournament gets its own unique slug => shareable link /t/<slug>.
-- =====================================================================

create or replace function public.dg_slugify(p text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(
    trim(both '-' from left(
      trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')),
      40)),
    ''), 'tournament')
$$;
revoke all on function public.dg_slugify(text) from public, anon, authenticated;

create or replace function public.dg_admin_create_tournament(
  p_title             text,
  p_description       text,
  p_prize_title       text,
  p_prize_description text,
  p_prize_image_url   text,
  p_prize_value_ngn   bigint,
  p_entry_fee_coins   bigint,
  p_target_players    integer,
  p_games             text[],
  p_publish           boolean default false
)
returns public.dg_tournaments
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_title text := btrim(coalesce(p_title, ''));
  v_ptit  text := btrim(coalesce(p_prize_title, ''));
  v_pdesc text := btrim(coalesce(p_prize_description, ''));
  v_desc  text := btrim(coalesce(p_description, ''));
  v_img   text := nullif(btrim(coalesce(p_prize_image_url, '')), '');
  v_games text[];
  v_row   public.dg_tournaments;
  v_try   integer := 0;
begin
  if v_uid is null or not public.dg_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if char_length(v_title) not between 3 and 120 then
    raise exception 'Tournament name must be 3-120 characters' using errcode = '22023';
  end if;
  if char_length(v_ptit) not between 2 and 120 then
    raise exception 'Prize name is required (2-120 characters)' using errcode = '22023';
  end if;
  if char_length(v_pdesc) not between 2 and 2000 then
    raise exception 'Prize description is required (2-2000 characters)' using errcode = '22023';
  end if;
  if char_length(v_desc) > 2000 then
    raise exception 'Description is too long' using errcode = '22023';
  end if;
  if v_img is not null and (v_img !~* '^https://[^[:space:]]+$' or char_length(v_img) > 2048) then
    raise exception 'Prize image must be a valid https:// URL' using errcode = '22023';
  end if;
  if p_prize_value_ngn is null or p_prize_value_ngn not between 0 and 1000000000 then
    raise exception 'Prize value must be between 0 and 1,000,000,000 NGN' using errcode = '22023';
  end if;
  if p_entry_fee_coins is null or p_entry_fee_coins not between 1 and 1000000 then
    raise exception 'Entry fee must be between 1 and 1,000,000 coins' using errcode = '22023';
  end if;
  if p_target_players is null or p_target_players not between 2 and 512 then
    raise exception 'Players needed must be between 2 and 512' using errcode = '22023';
  end if;
  if p_games is null or cardinality(p_games) < 1 or not (p_games <@ public.dg_allowed_games()) then
    raise exception 'Select at least one supported game' using errcode = '22023';
  end if;

  select array_agg(distinct g order by g) into v_games from unnest(p_games) as g;

  loop
    begin
      insert into public.dg_tournaments (
        slug, title, description, prize_title, prize_description, prize_image_url,
        prize_value_ngn, entry_fee_coins, target_players, games, status,
        published_at, registration_deadline, created_by)
      values (
        public.dg_slugify(v_title) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
        v_title, v_desc, v_ptit, v_pdesc, v_img,
        p_prize_value_ngn, p_entry_fee_coins, p_target_players, v_games,
        case when p_publish then 'open' else 'draft' end,
        case when p_publish then now() end,
        case when p_publish then now() + interval '48 hours' end,
        v_uid)
      returning * into v_row;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 5 then raise; end if;
    end;
  end loop;

  insert into public.dg_admin_audit_log (admin_id, action, entity_type, entity_id, details)
  values (v_uid, 'tournament.create', 'tournament', v_row.id::text,
          jsonb_build_object('slug', v_row.slug, 'status', v_row.status));

  return v_row;
end $$;

create or replace function public.dg_admin_publish_tournament(p_tournament_id uuid)
returns public.dg_tournaments
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.dg_tournaments;
begin
  if v_uid is null or not public.dg_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  update public.dg_tournaments
     set status = 'open',
         published_at = now(),
         registration_deadline = now() + interval '48 hours'
   where id = p_tournament_id and status = 'draft'
   returning * into v_row;

  if not found then
    raise exception 'Tournament not found or not in draft status' using errcode = 'P0002';
  end if;

  insert into public.dg_admin_audit_log (admin_id, action, entity_type, entity_id, details)
  values (v_uid, 'tournament.publish', 'tournament', v_row.id::text,
          jsonb_build_object('slug', v_row.slug,
                             'registration_deadline', v_row.registration_deadline));
  return v_row;
end $$;

revoke all on function public.dg_admin_create_tournament(text,text,text,text,text,bigint,bigint,integer,text[],boolean)
  from public, anon;
grant execute on function public.dg_admin_create_tournament(text,text,text,text,text,bigint,bigint,integer,text[],boolean)
  to authenticated;
revoke all on function public.dg_admin_publish_tournament(uuid) from public, anon;
grant execute on function public.dg_admin_publish_tournament(uuid) to authenticated;


-- ################ 20261118000006_phase2_wallet_core.sql ################

-- =====================================================================
-- DREAM GAME - Migration 6: wallet core, payment records, schema additions
-- All money movement funnels through dg__apply_ledger(): one row-locked,
-- idempotent, append-only ledger write per balance change.
-- 1 coin = NGN 1.
-- =====================================================================

-- ---------- schema additions ----------
alter table public.dg_tournaments
  add column if not exists prize_coins bigint not null default 0
  check (prize_coins between 0 and 1000000000);

alter table public.dg_matches
  add column if not exists proposed_winner_id uuid references auth.users(id) on delete set null,
  add column if not exists version integer not null default 0;
alter table public.dg_matches
  add constraint dg_matches_proposed_is_player
  check (proposed_winner_id is null or proposed_winner_id in (player_a, player_b));

-- Allow re-joining after a refunded cancellation: one HELD hold per entry.
alter table public.dg_escrow_holds drop constraint if exists dg_escrow_holds_entry_id_key;
create unique index if not exists dg_escrow_one_held_per_entry
  on public.dg_escrow_holds (entry_id) where status = 'held';

-- Server-only game secrets (face-down memory cards, scramble answers, ...).
create table public.dg_match_secrets (
  match_id   uuid primary key references public.dg_matches(id) on delete cascade,
  full_state jsonb not null,
  version    integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.dg_match_secrets enable row level security;
revoke all on public.dg_match_secrets from public, anon, authenticated;

-- ---------- the ONLY function that changes balances ----------
create or replace function public.dg__apply_ledger(
  p_user uuid, p_type text, p_av bigint, p_es bigint,
  p_ref_type text, p_ref_id text, p_key text, p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  w    public.dg_wallets;
  v_id uuid;
  v_av bigint;
  v_es bigint;
begin
  insert into public.dg_wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into w from public.dg_wallets where user_id = p_user for update;   -- serialises per user

  select id into v_id from public.dg_wallet_ledger where idempotency_key = p_key;
  if found then
    return v_id;                                                              -- idempotent replay
  end if;

  v_av := w.available_coins + p_av;
  v_es := w.escrowed_coins + p_es;
  if v_av < 0 then
    raise exception 'Insufficient coins' using errcode = 'DG001';
  end if;
  if v_es < 0 then
    raise exception 'Escrow underflow' using errcode = 'DG002';
  end if;

  update public.dg_wallets
     set available_coins = v_av, escrowed_coins = v_es
   where user_id = p_user;

  insert into public.dg_wallet_ledger
    (user_id, entry_type, available_delta, escrow_delta, available_after, escrow_after,
     reference_type, reference_id, idempotency_key, metadata)
  values
    (p_user, p_type, p_av, p_es, v_av, v_es, p_ref_type, p_ref_id, p_key, coalesce(p_meta, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

-- ---------- player starts a coin purchase (no money moves yet) ----------
create or replace function public.dg_init_payment(p_amount bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_ref text;
begin
  if v_uid is null then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  if p_amount is null or p_amount < 100 or p_amount > 500000 then
    raise exception 'Amount must be between 100 and 500,000 NGN' using errcode = '22023';
  end if;
  if (select count(*) from public.dg_payments
       where user_id = v_uid and status = 'pending'
         and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many pending payments. Please wait and try again.' using errcode = 'DG429';
  end if;
  v_ref := 'DG-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.dg_payments (user_id, tx_ref, amount_ngn, coins)
  values (v_uid, v_ref, p_amount, p_amount);
  return jsonb_build_object('tx_ref', v_ref, 'amount', p_amount);
end $$;

-- ---------- server-verified credit (service_role ONLY) ----------
-- The Edge Function calls this AFTER confirming the transaction with
-- Flutterwave's API using the secret key. Browsers cannot execute it.
create or replace function public.dg_credit_purchase(
  p_tx_ref text, p_flw_id text, p_amount numeric, p_currency text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p      public.dg_payments;
  v_led  uuid;
begin
  select * into p from public.dg_payments where tx_ref = p_tx_ref for update;
  if not found then
    raise exception 'Unknown payment reference' using errcode = 'P0002';
  end if;
  if p.status = 'successful' then
    return jsonb_build_object('status', 'already_credited', 'coins', p.coins);
  end if;
  if p_currency is distinct from 'NGN' or p_amount is null or p_amount < p.amount_ngn then
    update public.dg_payments set status = 'failed', verified_at = now() where id = p.id;
    return jsonb_build_object('status', 'rejected', 'reason', 'amount_or_currency_mismatch');
  end if;

  v_led := public.dg__apply_ledger(
    p.user_id, 'purchase', p.coins, 0, 'payment', p.id::text, 'purchase:' || p.id,
    jsonb_build_object('tx_ref', p.tx_ref, 'flw_transaction_id', p_flw_id));

  update public.dg_payments
     set status = 'successful', flw_transaction_id = p_flw_id,
         ledger_id = v_led, verified_at = now()
   where id = p.id;
  return jsonb_build_object('status', 'credited', 'coins', p.coins);
end $$;

-- ---------- grants ----------
revoke all on function public.dg__apply_ledger(uuid,text,bigint,bigint,text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.dg_init_payment(bigint) from public, anon;
grant execute on function public.dg_init_payment(bigint) to authenticated;
revoke all on function public.dg_credit_purchase(text,text,numeric,text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.dg_credit_purchase(text,text,numeric,text) to service_role;
    grant all on public.dg_match_secrets to service_role;
  end if;
end $$;

-- ---------- admin create: add prize_coins (replaces migration-5 signature) ----------
drop function if exists public.dg_admin_create_tournament(text,text,text,text,text,bigint,bigint,integer,text[],boolean);

create or replace function public.dg_admin_create_tournament(
  p_title             text,
  p_description       text,
  p_prize_title       text,
  p_prize_description text,
  p_prize_image_url   text,
  p_prize_value_ngn   bigint,
  p_entry_fee_coins   bigint,
  p_target_players    integer,
  p_games             text[],
  p_publish           boolean default false,
  p_prize_coins       bigint default 0
)
returns public.dg_tournaments
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_title text := btrim(coalesce(p_title, ''));
  v_ptit  text := btrim(coalesce(p_prize_title, ''));
  v_pdesc text := btrim(coalesce(p_prize_description, ''));
  v_desc  text := btrim(coalesce(p_description, ''));
  v_img   text := nullif(btrim(coalesce(p_prize_image_url, '')), '');
  v_games text[];
  v_row   public.dg_tournaments;
  v_try   integer := 0;
begin
  if v_uid is null or not public.dg_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if char_length(v_title) not between 3 and 120 then
    raise exception 'Tournament name must be 3-120 characters' using errcode = '22023';
  end if;
  if char_length(v_ptit) not between 2 and 120 then
    raise exception 'Prize name is required (2-120 characters)' using errcode = '22023';
  end if;
  if char_length(v_pdesc) not between 2 and 2000 then
    raise exception 'Prize description is required (2-2000 characters)' using errcode = '22023';
  end if;
  if char_length(v_desc) > 2000 then
    raise exception 'Description is too long' using errcode = '22023';
  end if;
  if v_img is not null and (v_img !~* '^https://[^[:space:]]+$' or char_length(v_img) > 2048) then
    raise exception 'Prize image must be a valid https:// URL' using errcode = '22023';
  end if;
  if p_prize_value_ngn is null or p_prize_value_ngn not between 0 and 1000000000 then
    raise exception 'Prize value must be between 0 and 1,000,000,000 NGN' using errcode = '22023';
  end if;
  if p_prize_coins is null or p_prize_coins not between 0 and 1000000000 then
    raise exception 'Prize coins must be between 0 and 1,000,000,000' using errcode = '22023';
  end if;
  if p_entry_fee_coins is null or p_entry_fee_coins not between 1 and 1000000 then
    raise exception 'Entry fee must be between 1 and 1,000,000 coins' using errcode = '22023';
  end if;
  if p_target_players is null or p_target_players not between 2 and 512 then
    raise exception 'Players needed must be between 2 and 512' using errcode = '22023';
  end if;
  if p_games is null or cardinality(p_games) < 1 or not (p_games <@ public.dg_allowed_games()) then
    raise exception 'Select at least one supported game' using errcode = '22023';
  end if;

  select array_agg(distinct g order by g) into v_games from unnest(p_games) as g;

  loop
    begin
      insert into public.dg_tournaments (
        slug, title, description, prize_title, prize_description, prize_image_url,
        prize_value_ngn, prize_coins, entry_fee_coins, target_players, games, status,
        published_at, registration_deadline, created_by)
      values (
        public.dg_slugify(v_title) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
        v_title, v_desc, v_ptit, v_pdesc, v_img,
        p_prize_value_ngn, p_prize_coins, p_entry_fee_coins, p_target_players, v_games,
        case when p_publish then 'open' else 'draft' end,
        case when p_publish then now() end,
        case when p_publish then now() + interval '48 hours' end,
        v_uid)
      returning * into v_row;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 5 then raise; end if;
    end;
  end loop;

  insert into public.dg_admin_audit_log (admin_id, action, entity_type, entity_id, details)
  values (v_uid, 'tournament.create', 'tournament', v_row.id::text,
          jsonb_build_object('slug', v_row.slug, 'status', v_row.status));
  return v_row;
end $$;

revoke all on function public.dg_admin_create_tournament(text,text,text,text,text,bigint,bigint,integer,text[],boolean,bigint)
  from public, anon;
grant execute on function public.dg_admin_create_tournament(text,text,text,text,text,bigint,bigint,integer,text[],boolean,bigint)
  to authenticated;


-- ################ 20261118000007_phase3_lifecycle.sql ################

-- =====================================================================
-- DREAM GAME - Migration 7: tournament lifecycle
-- join (escrow) / cancel entry / expiry refunds / bracket generation /
-- admin result approval / completion + escrow settlement + prize credit.
-- Randomness uses gen_random_uuid() ordering (CSPRNG-backed), not random().
-- Bots are not used: odd player counts receive a BYE (never the same
-- player twice while others are eligible).
-- =====================================================================

-- ---------- refund every held entry of a tournament ----------
create or replace function public.dg__refund_all(p_tid uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.dg_escrow_holds;
begin
  for h in
    select * from public.dg_escrow_holds
     where tournament_id = p_tid and status = 'held'
     order by created_at, id
     for update
  loop
    perform public.dg__apply_ledger(
      h.user_id, 'entry_refund', h.amount_coins, -h.amount_coins,
      'tournament', p_tid::text, 'entry_refund:' || h.id,
      jsonb_build_object('reason', p_reason));
    update public.dg_escrow_holds set status = 'refunded', resolved_at = now() where id = h.id;
    update public.dg_tournament_entries set status = 'refunded' where id = h.entry_id;
  end loop;
  update public.dg_tournaments set entries_count = 0 where id = p_tid;
end $$;

-- ---------- bracket round builder ----------
create or replace function public.dg__build_round(p_tid uuid, p_round uuid, p_players uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_games text[];
  v_bye   uuid;
  v_list  uuid[];
  v_no    integer := 0;
  i       integer;
begin
  select games into v_games from public.dg_tournaments where id = p_tid;

  if cardinality(p_players) % 2 = 1 then
    select u.uid into v_bye
      from unnest(p_players) as u(uid)
      left join lateral (
        select count(*) as c from public.dg_matches m
         where m.tournament_id = p_tid and m.is_bye and m.player_a = u.uid) b on true
     order by b.c, gen_random_uuid()
     limit 1;
    p_players := array_remove(p_players, v_bye);
    v_no := v_no + 1;
    insert into public.dg_matches
      (tournament_id, round_id, match_number, game, player_a, is_bye, winner_id, status, approved_at)
    values
      (p_tid, p_round, v_no,
       v_games[1 + (get_byte(uuid_send(gen_random_uuid()), 0) % cardinality(v_games))],
       v_bye, true, v_bye, 'completed', now());
  end if;

  select array_agg(u.uid order by gen_random_uuid()) into v_list from unnest(p_players) as u(uid);
  for i in 1..coalesce(cardinality(v_list), 0) by 2 loop
    v_no := v_no + 1;
    insert into public.dg_matches
      (tournament_id, round_id, match_number, game, player_a, player_b, status)
    values
      (p_tid, p_round, v_no,
       v_games[1 + (get_byte(uuid_send(gen_random_uuid()), 0) % cardinality(v_games))],
       v_list[i], v_list[i + 1], 'ready');
  end loop;
end $$;

create or replace function public.dg__start_tournament(p_tid uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_round   uuid;
  v_players uuid[];
begin
  update public.dg_tournaments set status = 'live', started_at = now() where id = p_tid;
  update public.dg_tournament_entries set status = 'active'
   where tournament_id = p_tid and status = 'reserved';
  select array_agg(user_id) into v_players
    from public.dg_tournament_entries where tournament_id = p_tid and status = 'active';
  insert into public.dg_tournament_rounds (tournament_id, round_number, status)
  values (p_tid, 1, 'active') returning id into v_round;
  perform public.dg__build_round(p_tid, v_round, v_players);
end $$;

-- ---------- completion: champion, escrow settlement, prize credit ----------
create or replace function public.dg__complete_tournament(p_tid uuid, p_champion uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t      public.dg_tournaments;
  h      public.dg_escrow_holds;
  v_name text;
begin
  select * into t from public.dg_tournaments where id = p_tid for update;
  select display_name into v_name from public.dg_profiles where id = p_champion;
  update public.dg_tournaments
     set status = 'completed', completed_at = now(),
         champion_user_id = p_champion, champion_name = v_name
   where id = p_tid;
  update public.dg_tournament_entries set status = 'champion'
   where tournament_id = p_tid and user_id = p_champion;

  for h in
    select * from public.dg_escrow_holds
     where tournament_id = p_tid and status = 'held' order by created_at, id for update
  loop
    perform public.dg__apply_ledger(
      h.user_id, 'entry_settle', 0, -h.amount_coins,
      'tournament', p_tid::text, 'entry_settle:' || h.id, '{}'::jsonb);
    update public.dg_escrow_holds set status = 'settled', resolved_at = now() where id = h.id;
  end loop;

  if t.prize_coins > 0 then
    perform public.dg__apply_ledger(
      p_champion, 'prize_credit', t.prize_coins, 0,
      'tournament', p_tid::text, 'prize_credit:' || p_tid, '{}'::jsonb);
  end if;
end $$;

create or replace function public.dg__advance_tournament(p_tid uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r         public.dg_tournament_rounds;
  v_winners uuid[];
  v_next    uuid;
begin
  select * into r from public.dg_tournament_rounds
   where tournament_id = p_tid and status = 'active'
   order by round_number desc limit 1 for update;
  if not found then return; end if;
  if exists (select 1 from public.dg_matches where round_id = r.id and status <> 'completed') then
    return;
  end if;
  update public.dg_tournament_rounds set status = 'completed' where id = r.id;
  select array_agg(winner_id) into v_winners from public.dg_matches where round_id = r.id;
  if cardinality(v_winners) = 1 then
    perform public.dg__complete_tournament(p_tid, v_winners[1]);
  else
    insert into public.dg_tournament_rounds (tournament_id, round_number, status)
    values (p_tid, r.round_number + 1, 'active') returning id into v_next;
    perform public.dg__build_round(p_tid, v_next, v_winners);
  end if;
end $$;

-- ---------- player: join (reserves coins in escrow) ----------
create or replace function public.dg_join_tournament(p_tournament_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  t       public.dg_tournaments;
  e       public.dg_tournament_entries;
  v_entry uuid;
  v_hold  uuid := gen_random_uuid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Please sign in to join' using errcode = '42501';
  end if;

  select * into t from public.dg_tournaments where id = p_tournament_id for update;
  if not found or t.status = 'draft' then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  if t.status <> 'open' then
    raise exception 'This tournament is no longer accepting entries' using errcode = 'DG409';
  end if;
  if now() > t.registration_deadline then
    perform public.dg__refund_all(t.id, 'registration_deadline_passed');
    update public.dg_tournaments set status = 'failed' where id = t.id;
    return jsonb_build_object('ok', false, 'message',
      'Registration closed before the tournament filled. All entries were refunded.');
  end if;
  if t.entries_count >= t.target_players then
    raise exception 'Tournament is full' using errcode = 'DG409';
  end if;

  select * into e from public.dg_tournament_entries
   where tournament_id = t.id and user_id = v_uid;
  if found and e.status <> 'refunded' then
    raise exception 'You are already registered' using errcode = '23505';
  end if;

  if found then
    update public.dg_tournament_entries
       set status = 'reserved', fee_coins = t.entry_fee_coins where id = e.id;
    v_entry := e.id;
  else
    insert into public.dg_tournament_entries (tournament_id, user_id, fee_coins)
    values (t.id, v_uid, t.entry_fee_coins) returning id into v_entry;
  end if;

  perform public.dg__apply_ledger(
    v_uid, 'entry_reserve', -t.entry_fee_coins, t.entry_fee_coins,
    'tournament', t.id::text, 'entry_reserve:' || v_hold, '{}'::jsonb);   -- raises DG001 if short

  insert into public.dg_escrow_holds (id, entry_id, tournament_id, user_id, amount_coins)
  values (v_hold, v_entry, t.id, v_uid, t.entry_fee_coins);

  update public.dg_tournaments set entries_count = entries_count + 1
   where id = t.id returning entries_count into v_count;

  if v_count = t.target_players then
    perform public.dg__start_tournament(t.id);
    return jsonb_build_object('ok', true, 'started', true,
      'message', 'Target reached. The tournament is live and round 1 is drawn.');
  end if;
  return jsonb_build_object('ok', true, 'started', false,
    'message', 'Entry secured. Your coins are held in escrow.');
end $$;

-- ---------- player: cancel before start (full refund) ----------
create or replace function public.dg_cancel_entry(p_tournament_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  t     public.dg_tournaments;
  h     public.dg_escrow_holds;
begin
  if v_uid is null then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  select * into t from public.dg_tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  if t.status <> 'open' then
    raise exception 'Entries cannot be cancelled after the tournament starts' using errcode = 'DG409';
  end if;
  select * into h from public.dg_escrow_holds
   where tournament_id = t.id and user_id = v_uid and status = 'held' for update;
  if not found then
    raise exception 'You do not have an entry in this tournament' using errcode = 'P0002';
  end if;

  perform public.dg__apply_ledger(
    v_uid, 'entry_refund', h.amount_coins, -h.amount_coins,
    'tournament', t.id::text, 'entry_refund:' || h.id,
    jsonb_build_object('reason', 'player_cancelled'));
  update public.dg_escrow_holds set status = 'refunded', resolved_at = now() where id = h.id;
  update public.dg_tournament_entries set status = 'refunded' where id = h.entry_id;
  update public.dg_tournaments set entries_count = greatest(entries_count - 1, 0) where id = t.id;
  return jsonb_build_object('ok', true, 'message', 'Entry cancelled and coins refunded.');
end $$;

-- ---------- expiry: underfilled after the 48h window => failed + refunds ----------
create or replace function public.dg_run_expiry()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  t public.dg_tournaments;
  n integer := 0;
begin
  for t in
    select * from public.dg_tournaments
     where status = 'open' and registration_deadline < now() and entries_count < target_players
     order by registration_deadline
     for update skip locked
  loop
    perform public.dg__refund_all(t.id, 'registration_deadline_passed');
    update public.dg_tournaments set status = 'failed' where id = t.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- admin: cancel a tournament (refunds everyone) ----------
create or replace function public.dg_admin_cancel_tournament(p_tournament_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  t     public.dg_tournaments;
begin
  if v_uid is null or not public.dg_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  select * into t from public.dg_tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  if t.status not in ('draft', 'open', 'live') then
    raise exception 'Only draft, open or live tournaments can be cancelled' using errcode = 'DG409';
  end if;
  perform public.dg__refund_all(t.id, 'admin_cancelled');
  update public.dg_tournaments set status = 'cancelled' where id = t.id;
  insert into public.dg_admin_audit_log (admin_id, action, entity_type, entity_id, details)
  values (v_uid, 'tournament.cancel', 'tournament', t.id::text,
          jsonb_build_object('reason', left(coalesce(p_reason, ''), 300), 'previous_status', t.status));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- admin: approve (or override) a match result ----------
create or replace function public.dg_admin_approve_result(p_match_id uuid, p_winner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  m     public.dg_matches;
  v_ts  text;
  v_loser uuid;
begin
  if v_uid is null or not public.dg_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  select * into m from public.dg_matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  if m.is_bye or m.status = 'completed' then
    raise exception 'Match is already completed' using errcode = 'DG409';
  end if;
  if p_winner is null or p_winner not in (m.player_a, m.player_b) then
    raise exception 'Winner must be one of the two players' using errcode = '22023';
  end if;
  select status into v_ts from public.dg_tournaments where id = m.tournament_id for update;
  if v_ts <> 'live' then
    raise exception 'Tournament is not live' using errcode = 'DG409';
  end if;

  v_loser := case when p_winner = m.player_a then m.player_b else m.player_a end;
  update public.dg_matches
     set winner_id = p_winner, status = 'completed',
         approved_by = v_uid, approved_at = now(),
         result_submitted_by = coalesce(result_submitted_by, v_uid),
         result_submitted_at = coalesce(result_submitted_at, now())
   where id = m.id;
  update public.dg_tournament_entries set status = 'eliminated'
   where tournament_id = m.tournament_id and user_id = v_loser;

  insert into public.dg_admin_audit_log (admin_id, action, entity_type, entity_id, details)
  values (v_uid, 'match.approve', 'match', m.id::text,
          jsonb_build_object('winner', p_winner,
                             'proposed', m.proposed_winner_id,
                             'override', m.proposed_winner_id is distinct from p_winner));

  perform public.dg__advance_tournament(m.tournament_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- game server: atomic, version-checked state save (service_role ONLY) ----------
create or replace function public.dg_system_save_game(
  p_match uuid, p_public jsonb, p_full jsonb, p_expected integer,
  p_proposed uuid, p_needs_admin boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  m   public.dg_matches;
  cur integer;
begin
  select * into m from public.dg_matches where id = p_match for update;
  if not found then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  if m.status not in ('ready', 'in_progress') then
    raise exception 'Match is not active' using errcode = 'DG409';
  end if;
  select version into cur from public.dg_match_secrets where match_id = p_match;
  if not found then cur := 0; end if;
  if cur <> p_expected then
    raise exception 'Game state changed, please retry' using errcode = '40001';
  end if;

  insert into public.dg_match_secrets (match_id, full_state)
  values (p_match, p_full)
  on conflict (match_id) do update
    set full_state = excluded.full_state,
        version = public.dg_match_secrets.version + 1,
        updated_at = now();

  update public.dg_matches
     set game_state = p_public,
         version = cur + 1,
         status = case when p_proposed is not null or p_needs_admin
                       then 'awaiting_approval' else 'in_progress' end,
         proposed_winner_id = p_proposed,
         result_submitted_at = case when p_proposed is not null then now() else result_submitted_at end
   where id = p_match;
  return cur + 1;
end $$;

-- ---------- grants ----------
revoke all on function public.dg__refund_all(uuid,text) from public, anon, authenticated;
revoke all on function public.dg__build_round(uuid,uuid,uuid[]) from public, anon, authenticated;
revoke all on function public.dg__start_tournament(uuid) from public, anon, authenticated;
revoke all on function public.dg__complete_tournament(uuid,uuid) from public, anon, authenticated;
revoke all on function public.dg__advance_tournament(uuid) from public, anon, authenticated;

revoke all on function public.dg_join_tournament(uuid) from public, anon;
revoke all on function public.dg_cancel_entry(uuid) from public, anon;
revoke all on function public.dg_run_expiry() from public, anon;
revoke all on function public.dg_admin_cancel_tournament(uuid,text) from public, anon;
revoke all on function public.dg_admin_approve_result(uuid,uuid) from public, anon;
grant execute on function public.dg_join_tournament(uuid) to authenticated;
grant execute on function public.dg_cancel_entry(uuid) to authenticated;
grant execute on function public.dg_run_expiry() to authenticated;
grant execute on function public.dg_admin_cancel_tournament(uuid,text) to authenticated;
grant execute on function public.dg_admin_approve_result(uuid,uuid) to authenticated;

revoke all on function public.dg_system_save_game(uuid,jsonb,jsonb,integer,uuid,boolean)
  from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.dg_system_save_game(uuid,jsonb,jsonb,integer,uuid,boolean)
      to service_role;
  end if;
  -- Scheduled expiry every 5 minutes (needs the pg_cron extension).
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dg-expire-tournaments', '*/5 * * * *', 'select public.dg_run_expiry()');
  else
    raise notice 'pg_cron not enabled: enable it in Dashboard > Database > Extensions, then run: select cron.schedule(''dg-expire-tournaments'', ''*/5 * * * *'', ''select public.dg_run_expiry()'');';
  end if;
end $$;


-- ################ 20261118000008_admin_read_policies.sql ################

-- =====================================================================
-- DREAM GAME - Migration 8: read-only admin visibility for payment reconciliation
-- Admin can SEE all payments and ledger rows (to handle stuck/failed payments).
-- Still NO write access: money only moves through the SECURITY DEFINER functions.
-- =====================================================================
create policy dg_payments_read_admin on public.dg_payments
  for select to authenticated using ((select public.dg_is_admin()));

create policy dg_ledger_read_admin on public.dg_wallet_ledger
  for select to authenticated using ((select public.dg_is_admin()));
