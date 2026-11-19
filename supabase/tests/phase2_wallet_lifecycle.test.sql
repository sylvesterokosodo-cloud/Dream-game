-- =====================================================================
-- DREAM GAME - wallet / escrow / lifecycle tests (pgTAP)
-- Run: supabase db reset && supabase test db     (LOCAL database)
-- STATUS: written but NOT yet executed (no Postgres available to the author).
-- =====================================================================
begin;
select * from no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sylvesterokosodo@gmail.com', now(), '{"display_name":"Boss"}'),
  ('11111111-1111-1111-1111-111111111111', 'p1@example.com', now(), '{"display_name":"P1"}'),
  ('22222222-2222-2222-2222-222222222222', 'p2@example.com', now(), '{"display_name":"P2"}'),
  ('33333333-3333-3333-3333-333333333333', 'p3@example.com', now(), '{"display_name":"P3"}'),
  ('44444444-4444-4444-4444-444444444444', 'p4@example.com', now(), '{"display_name":"P4"}'),
  ('55555555-5555-5555-5555-555555555555', 'broke@example.com', now(), '{"display_name":"Broke"}');

-- ---------- payments ----------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.dg_init_payment(5000)$$, 'player can start a 5000 NGN purchase');
select throws_ok($$select public.dg_init_payment(50)$$, '22023', null, 'amount below NGN 100 rejected');
select throws_ok($$select public.dg_init_payment(600000)$$, '22023', null, 'amount above NGN 500,000 rejected');
select throws_ok($$select public.dg_credit_purchase('x','y',5000,'NGN')$$, '42501', null,
  'players cannot call dg_credit_purchase');
select throws_ok($$select public.dg__apply_ledger('11111111-1111-1111-1111-111111111111','purchase',999999,0,null,null,'hack','{}')$$,
  '42501', null, 'players cannot call the internal ledger function');
reset role;
set local role anon;
select throws_ok($$select public.dg_init_payment(1000)$$, '42501', null, 'anonymous cannot start a payment');
reset role;

-- server-side credit (what the Edge Function does after verifying with Flutterwave)
select is((select public.dg_credit_purchase(
            (select tx_ref from public.dg_payments where user_id = '11111111-1111-1111-1111-111111111111'),
            'flw-1', 5000, 'NGN') ->> 'status'),
          'credited', 'verified payment credits coins');
select is((select available_coins from public.dg_wallets where user_id = '11111111-1111-1111-1111-111111111111'),
          5000::bigint, '5000 NGN buys exactly 5000 coins');
select is((select public.dg_credit_purchase(
            (select tx_ref from public.dg_payments where user_id = '11111111-1111-1111-1111-111111111111'),
            'flw-1', 5000, 'NGN') ->> 'status'),
          'already_credited', 'replayed webhook is idempotent');
select is((select available_coins from public.dg_wallets where user_id = '11111111-1111-1111-1111-111111111111'),
          5000::bigint, 'replay did not double-credit');

insert into public.dg_payments (user_id, tx_ref, amount_ngn, coins)
values ('11111111-1111-1111-1111-111111111111', 'short-pay', 1000, 1000),
       ('11111111-1111-1111-1111-111111111111', 'usd-pay', 1000, 1000);
select is((select public.dg_credit_purchase('short-pay', 'flw-2', 500, 'NGN') ->> 'status'),
          'rejected', 'underpayment is rejected');
select is((select public.dg_credit_purchase('usd-pay', 'flw-3', 1000, 'USD') ->> 'status'),
          'rejected', 'non-NGN payment is rejected');
select is((select available_coins from public.dg_wallets where user_id = '11111111-1111-1111-1111-111111111111'),
          5000::bigint, 'rejected payments credit nothing');

-- fund the other players with 5000 each
insert into public.dg_payments (user_id, tx_ref, amount_ngn, coins) values
  ('22222222-2222-2222-2222-222222222222', 'f2', 5000, 5000),
  ('33333333-3333-3333-3333-333333333333', 'f3', 5000, 5000),
  ('44444444-4444-4444-4444-444444444444', 'f4', 5000, 5000);
select public.dg_credit_purchase('f2', 'flw-f2', 5000, 'NGN');
select public.dg_credit_purchase('f3', 'flw-f3', 5000, 'NGN');
select public.dg_credit_purchase('f4', 'flw-f4', 5000, 'NGN');

-- ---------- admin creates a 4-player tournament ----------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.dg_admin_create_tournament('T4','','Phone','A phone',null,100000,1000,4,array['tic-tac-toe','chess'],true,3000)$$,
  'admin creates + publishes T4 (prize 3000 coins)');
reset role;

-- ---------- join / escrow ----------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is((select public.dg_join_tournament((select id from public.dg_tournaments where title = 'T4')) ->> 'ok'),
          'true', 'P1 joins T4');
select is((select available_coins || '/' || escrowed_coins from public.dg_wallets), '4000/1000',
          'entry fee moved from available to escrow');
select throws_ok($$select public.dg_join_tournament((select id from public.dg_tournaments where title = 'T4'))$$,
  '23505', null, 'double join rejected');
select is((select public.dg_cancel_entry((select id from public.dg_tournaments where title = 'T4')) ->> 'ok'),
          'true', 'P1 cancels before start');
select is((select available_coins || '/' || escrowed_coins from public.dg_wallets), '5000/0',
          'cancellation refunds escrow in full');
select is((select public.dg_join_tournament((select id from public.dg_tournaments where title = 'T4')) ->> 'ok'),
          'true', 'P1 can rejoin after cancelling');
reset role;

select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.dg_join_tournament((select id from public.dg_tournaments where title = 'T4'))$$,
  'DG001', null, 'insufficient coins rejected');
reset role;
select is((select count(*) from public.dg_tournament_entries where user_id = '55555555-5555-5555-5555-555555555555'),
          0::bigint, 'failed join leaves no entry behind');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select public.dg_join_tournament((select id from public.dg_tournaments where title = 'T4'));
reset role;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select public.dg_join_tournament((select id from public.dg_tournaments where title = 'T4'));
reset role;
select is((select status from public.dg_tournaments where title = 'T4'), 'open', 'still open at 3/4');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;
select is((select public.dg_join_tournament((select id from public.dg_tournaments where title = 'T4')) ->> 'started'),
          'true', 'reaching the target starts the tournament');
select throws_ok($$select public.dg_cancel_entry((select id from public.dg_tournaments where title = 'T4'))$$,
  'DG409', null, 'no cancellation after start');
reset role;

select is((select status from public.dg_tournaments where title = 'T4'), 'live', 'T4 is live');
select is((select count(*) from public.dg_matches m join public.dg_tournaments t on t.id = m.tournament_id
            where t.title = 'T4' and m.status = 'ready'), 2::bigint, 'round 1 has 2 ready matches');
select is((select count(*) from public.dg_tournament_entries e join public.dg_tournaments t on t.id = e.tournament_id
            where t.title = 'T4' and e.status = 'active'), 4::bigint, 'all 4 entries active');
select ok((select bool_and(player_a <> player_b) from public.dg_matches), 'nobody plays themselves');

-- ---------- results: only the admin ----------
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.dg_admin_approve_result((select id from public.dg_matches order by match_number limit 1), '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'player cannot approve results');
select throws_ok($$update public.dg_matches set winner_id = player_a$$, '42501', null,
  'player cannot write match results directly');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.dg_admin_approve_result((select id from public.dg_matches order by match_number limit 1), '55555555-5555-5555-5555-555555555555')$$,
  '22023', null, 'winner must be one of the two players');
select public.dg_admin_approve_result(m.id, m.player_a)
  from public.dg_matches m join public.dg_tournament_rounds r on r.id = m.round_id
 where r.round_number = 1;
select is((select count(*) from public.dg_tournament_rounds), 2::bigint, 'round 2 was created after round 1 finished');
select is((select count(*) from public.dg_matches m join public.dg_tournament_rounds r on r.id = m.round_id
            where r.round_number = 2), 1::bigint, 'the final is a single match');
select public.dg_admin_approve_result(m.id, m.player_a)
  from public.dg_matches m join public.dg_tournament_rounds r on r.id = m.round_id
 where r.round_number = 2;
reset role;

select is((select status from public.dg_tournaments where title = 'T4'), 'completed', 'T4 completed');
select isnt((select champion_user_id from public.dg_tournaments where title = 'T4'), null, 'champion recorded');
select is((select count(*) from public.dg_escrow_holds where status = 'held'), 0::bigint, 'no escrow left held');
select is((select count(*) from public.dg_escrow_holds where status = 'settled'), 4::bigint, 'all 4 holds settled');
select is((select available_coins - 4000 from public.dg_wallets w
            join public.dg_tournaments t on t.champion_user_id = w.user_id where t.title = 'T4'),
          3000::bigint, 'champion received the 3000-coin prize (paid 1000 fee, had 5000)');

-- ---------- conservation of money ----------
select is((select count(*) from public.dg_wallets w
            where w.available_coins is distinct from
                    (select coalesce(sum(available_delta), 0) from public.dg_wallet_ledger l where l.user_id = w.user_id)
               or w.escrowed_coins is distinct from
                    (select coalesce(sum(escrow_delta), 0) from public.dg_wallet_ledger l where l.user_id = w.user_id)),
          0::bigint, 'every wallet equals the sum of its ledger (nothing created or lost)');

-- ---------- odd player count => bye ----------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
select public.dg_admin_create_tournament('T3','','Bag','A bag',null,0,100,3,array['gomoku'],true,0);
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select public.dg_join_tournament((select id from public.dg_tournaments where title = 'T3'));
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select public.dg_join_tournament((select id from public.dg_tournaments where title = 'T3'));
reset role;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select public.dg_join_tournament((select id from public.dg_tournaments where title = 'T3'));
reset role;
select is((select count(*) from public.dg_matches m join public.dg_tournaments t on t.id = m.tournament_id
            where t.title = 'T3' and m.is_bye and m.status = 'completed'), 1::bigint, '3 players => exactly one bye');
select is((select count(*) from public.dg_matches m join public.dg_tournaments t on t.id = m.tournament_id
            where t.title = 'T3' and not m.is_bye and m.status = 'ready'), 1::bigint, '3 players => one real match');

-- ---------- expiry refunds ----------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
select public.dg_admin_create_tournament('TX','','Cap','A cap',null,0,500,8,array['chess'],true,0);
reset role;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;
select public.dg_join_tournament((select id from public.dg_tournaments where title = 'TX'));
reset role;
select is((select escrowed_coins from public.dg_wallets where user_id = '44444444-4444-4444-4444-444444444444'),
          500::bigint, 'TX entry held in escrow');
update public.dg_tournaments set registration_deadline = now() - interval '1 hour' where title = 'TX';
select is(public.dg_run_expiry(), 1, 'expiry job fails exactly one underfilled tournament');
select is((select status from public.dg_tournaments where title = 'TX'), 'failed', 'underfilled tournament is failed');
select is((select escrowed_coins from public.dg_wallets where user_id = '44444444-4444-4444-4444-444444444444'),
          0::bigint, 'expiry released the escrow');

-- ---------- admin cancel refunds a live tournament ----------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.dg_admin_cancel_tournament((select id from public.dg_tournaments where title = 'T3'), 'test')$$,
  'admin cancels live T3');
reset role;
select is((select status from public.dg_tournaments where title = 'T3'), 'cancelled', 'T3 cancelled');
select is((select count(*) from public.dg_escrow_holds h join public.dg_tournaments t on t.id = h.tournament_id
            where t.title = 'T3' and h.status = 'refunded'), 3::bigint, 'all T3 entrants refunded');

-- final conservation check
select is((select count(*) from public.dg_wallets w
            where w.available_coins is distinct from
                    (select coalesce(sum(available_delta), 0) from public.dg_wallet_ledger l where l.user_id = w.user_id)
               or w.escrowed_coins is distinct from
                    (select coalesce(sum(escrow_delta), 0) from public.dg_wallet_ledger l where l.user_id = w.user_id)),
          0::bigint, 'ledger still reconciles after refunds and expiry');

select * from finish();
rollback;
