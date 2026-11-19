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
