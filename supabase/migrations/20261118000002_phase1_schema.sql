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
