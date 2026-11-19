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
