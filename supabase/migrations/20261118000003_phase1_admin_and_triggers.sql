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
