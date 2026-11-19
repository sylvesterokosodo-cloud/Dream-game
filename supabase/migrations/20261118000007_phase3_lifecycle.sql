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
