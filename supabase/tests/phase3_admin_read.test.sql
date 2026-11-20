-- Admin read-only visibility for payments/ledger. Run: supabase db reset && supabase test db
-- STATUS: written but NOT yet executed.
begin;
select * from no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sylvesterokosodo@gmail.com', now(), '{"display_name":"Boss"}'),
  ('11111111-1111-1111-1111-111111111111', 'p1@example.com', now(), '{"display_name":"P1"}'),
  ('22222222-2222-2222-2222-222222222222', 'p2@example.com', now(), '{"display_name":"P2"}');

insert into public.dg_payments (user_id, tx_ref, amount_ngn, coins) values
  ('11111111-1111-1111-1111-111111111111', 'p1-a', 1000, 1000),
  ('22222222-2222-2222-2222-222222222222', 'p2-a', 2000, 2000);
select public.dg_credit_purchase('p1-a', 'flw-a', 1000, 'NGN');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.dg_payments), 1::bigint, 'player sees only their own payment');
select is((select count(*) from public.dg_wallet_ledger), 1::bigint, 'player sees only their own ledger rows');
select throws_ok($$update public.dg_payments set status = 'successful' where tx_ref = 'p1-a'$$, '42501', null,
  'player cannot edit payments');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.dg_payments), 2::bigint, 'admin sees all payments');
select is((select count(*) from public.dg_wallet_ledger), 1::bigint, 'admin sees all ledger rows');
select throws_ok($$update public.dg_payments set status = 'successful' where tx_ref = 'p2-a'$$, '42501', null,
  'admin has NO direct write access to payments either');
select throws_ok($$delete from public.dg_wallet_ledger$$, '42501', null, 'admin cannot delete ledger rows');
reset role;

select * from finish();
rollback;
