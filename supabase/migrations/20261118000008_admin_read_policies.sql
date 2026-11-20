-- =====================================================================
-- DREAM GAME - Migration 8: read-only admin visibility for payment reconciliation
-- Admin can SEE all payments and ledger rows (to handle stuck/failed payments).
-- Still NO write access: money only moves through the SECURITY DEFINER functions.
-- =====================================================================
create policy dg_payments_read_admin on public.dg_payments
  for select to authenticated using ((select public.dg_is_admin()));

create policy dg_ledger_read_admin on public.dg_wallet_ledger
  for select to authenticated using ((select public.dg_is_admin()));
