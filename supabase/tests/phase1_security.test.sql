-- =====================================================================
-- DREAM GAME - Phase 1 security tests (pgTAP)
-- Run with the Supabase CLI against a LOCAL or STAGING database:
--     supabase test db
-- Everything runs inside a transaction that is rolled back.
-- STATUS: written but NOT yet executed (no Postgres available to the author).
-- =====================================================================
begin;
select * from no_plan();

-- ---------- fixtures (as postgres) ----------
-- admin starts UNCONFIRMED to prove an email-squatter gets no powers
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sylvesterokosodo@gmail.com', null, '{"display_name":"Boss"}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'player.a@example.com', now(), '{"display_name":"Player A"}'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'player.b@example.com', now(), '{"display_name":"Player B"}');

select is((select count(*) from public.dg_profiles
           where id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                        'cccccccc-cccc-cccc-cccc-cccccccccccc')),
          3::bigint, 'signup trigger creates a profile for each new user');
select is((select count(*) from public.dg_wallets
           where available_coins = 0 and escrowed_coins = 0
             and user_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                             'cccccccc-cccc-cccc-cccc-cccccccccccc')),
          3::bigint, 'signup trigger creates an empty wallet for each new user');
select is((select count(*) from public.dg_admins), 0::bigint,
          'unconfirmed admin-email account is NOT an admin');

-- ---------- admin identity ----------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
select is(public.dg_is_admin(), false, 'unconfirmed admin-email account: dg_is_admin() = false');
select throws_ok(
  $$select public.dg_admin_create_tournament('Cup','','Phone','A phone',null,100000,1000,8,array['chess'],false)$$,
  '42501', null, 'unconfirmed admin-email account cannot create tournaments');
reset role;

update auth.users set email_confirmed_at = now()
 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select is((select count(*) from public.dg_admins), 1::bigint, 'confirming the admin email grants admin');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
select is(public.dg_is_admin(), true, 'confirmed owner: dg_is_admin() = true');
reset role;

select throws_ok(
  $$insert into public.dg_admins(user_id, email)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','sylvesterokosodo@gmail.com')$$,
  '23505', null, 'a second admin row is impossible');
select throws_ok(
  $$insert into public.dg_admins(user_id, email)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','someone@else.com')$$,
  '23514', null, 'admin rows for any other email are impossible');

-- ---------- ordinary player cannot manage tournaments ----------
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}', true);
set local role authenticated;
select is(public.dg_is_admin(), false, 'player: dg_is_admin() = false');
select throws_ok(
  $$select public.dg_admin_create_tournament('Cup','','Phone','A phone',null,100000,1000,8,array['chess'],false)$$,
  '42501', null, 'player cannot call dg_admin_create_tournament');
select throws_ok(
  $$select public.dg_admin_publish_tournament(gen_random_uuid())$$,
  '42501', null, 'player cannot call dg_admin_publish_tournament');
select throws_ok(
  $$insert into public.dg_tournaments(slug,title,prize_title,prize_description,entry_fee_coins,target_players,games,status,registration_deadline)
    values ('hack-1','Hack','x1','x2',1,2,array['chess'],'open',now())$$,
  '42501', null, 'player cannot INSERT into dg_tournaments directly');
select throws_ok($$update public.dg_tournaments set status = 'completed'$$,
  '42501', null, 'player cannot UPDATE dg_tournaments');
select throws_ok($$select * from public.dg_admins$$,
  '42501', null, 'player cannot read dg_admins');
reset role;

-- ---------- wallet / ledger integrity ----------
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$update public.dg_wallets set available_coins = 999999 where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  '42501', null, 'player cannot edit their own wallet balance');
select throws_ok(
  $$insert into public.dg_wallet_ledger(user_id,entry_type,available_delta,available_after,escrow_after,idempotency_key)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','purchase',1000000,1000000,0,'hack')$$,
  '42501', null, 'player cannot write ledger rows');
select throws_ok(
  $$insert into public.dg_payments(user_id,tx_ref,amount_ngn,coins,status)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','hack',1000,1000,'successful')$$,
  '42501', null, 'player cannot fabricate a payment');
select is((select count(*) from public.dg_wallets), 1::bigint, 'player sees only their own wallet');
select is((select count(*) from public.dg_profiles), 3::bigint, 'signed-in users can see display names');
select lives_ok(
  $$update public.dg_profiles set display_name = 'Renamed A' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  'player can rename themselves');
select lives_ok(
  $$update public.dg_profiles set display_name = 'Hacked' where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  'updating another profile is a silent no-op under RLS');
select throws_ok(
  $$update public.dg_profiles set id = gen_random_uuid() where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  '42501', null, 'player cannot change profile id (column-level grant)');
reset role;

select is((select display_name from public.dg_profiles where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
          'Renamed A', 'self-rename took effect');
select is((select display_name from public.dg_profiles where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
          'Player B', 'other player''s name was NOT changed');

insert into public.dg_wallet_ledger(user_id,entry_type,available_delta,available_after,escrow_after,idempotency_key)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','purchase',1000,1000,0,'test-ledger-1');
select throws_ok($$update public.dg_wallet_ledger set available_delta = 5$$,
  '42501', null, 'ledger rows cannot be updated (even by postgres)');
select throws_ok($$delete from public.dg_wallet_ledger$$,
  '42501', null, 'ledger rows cannot be deleted (even by postgres)');
select throws_ok(
  $$insert into public.dg_payments(user_id,tx_ref,amount_ngn,coins)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','mismatch',1000,2000)$$,
  '23514', null, 'payment must be exactly 1 coin per NGN');
select throws_ok(
  $$insert into public.dg_payments(user_id,tx_ref,amount_ngn,coins,currency)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','usd',1000,1000,'USD')$$,
  '23514', null, 'payment currency must be NGN');

-- ---------- admin tournament lifecycle ----------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$select public.dg_admin_create_tournament('Weekend Cup','Fun','Smartphone','Brand new phone','https://example.com/p.png',250000,1000,8,array['chess','gomoku','chess'],false)$$,
  'admin can create a draft tournament');
select lives_ok(
  $$select public.dg_admin_create_tournament('Weekend Cup','Fun','Laptop','Brand new laptop',null,500000,1000,16,array['tic-tac-toe'],true)$$,
  'admin can create and publish in one step');
select is((select count(distinct slug) from public.dg_tournaments), 2::bigint,
          'same title still yields unique shareable slugs');
select is((select count(*) from public.dg_tournaments), 2::bigint, 'admin sees drafts and published');
select ok((select registration_deadline between now() + interval '47 hours' and now() + interval '49 hours'
           from public.dg_tournaments where status = 'open'),
          'published tournament has a 48-hour registration deadline');
select is((select games from public.dg_tournaments where title = 'Weekend Cup' and status = 'draft'),
          array['chess','gomoku']::text[], 'duplicate games are de-duplicated');

select throws_ok(
  $$select public.dg_admin_create_tournament('Tiny','','Phone','A phone',null,0,1000,1,array['chess'],false)$$,
  '22023', null, 'fewer than two players is rejected');
select throws_ok(
  $$select public.dg_admin_create_tournament('Cup','','   ','A phone',null,0,1000,8,array['chess'],false)$$,
  '22023', null, 'blank prize title is rejected');
select throws_ok(
  $$select public.dg_admin_create_tournament('Cup','','Phone','A phone','http://insecure.example/p.png',0,1000,8,array['chess'],false)$$,
  '22023', null, 'non-https prize image is rejected');
select throws_ok(
  $$select public.dg_admin_create_tournament('Cup','','Phone','A phone',null,0,1000,8,array['rock-paper-scissors'],false)$$,
  '22023', null, 'unsupported game is rejected');
select throws_ok(
  $$select public.dg_admin_create_tournament('Cup','','Phone','A phone',null,0,0,8,array['chess'],false)$$,
  '22023', null, 'zero entry fee is rejected');

select lives_ok(
  $$select public.dg_admin_publish_tournament((select id from public.dg_tournaments where status = 'draft' limit 1))$$,
  'admin can publish a draft');
select throws_ok(
  $$select public.dg_admin_publish_tournament(gen_random_uuid())$$,
  'P0002', null, 'publishing an unknown tournament fails');
select ok((select count(*) from public.dg_admin_audit_log) >= 3, 'admin actions are audit-logged');
reset role;

-- ---------- visibility ----------
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.dg_tournaments), 2::bigint,
          'player sees both published tournaments');
select is((select count(*) from public.dg_admin_audit_log), 0::bigint, 'player cannot see the audit log');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select count(*) from public.dg_tournaments), 2::bigint,
          'anonymous visitors can see published tournaments (for share links)');
select throws_ok($$select * from public.dg_wallets$$, '42501', null, 'anonymous cannot read wallets');
select throws_ok($$select * from public.dg_profiles$$, '42501', null, 'anonymous cannot read profiles');
reset role;

-- ---------- append-only audit log ----------
select throws_ok($$delete from public.dg_admin_audit_log$$, '42501', null,
                 'audit log rows cannot be deleted');

select * from finish();
rollback;
