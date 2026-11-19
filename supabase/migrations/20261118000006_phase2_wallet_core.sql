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
