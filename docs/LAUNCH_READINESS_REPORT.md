# Dream Game — Launch-Readiness Report

**Verdict: NOT production-ready.** The database layer, the real dependency build, the Flutterwave flow and the
security model have **never been executed**. Everything marked "executed" below ran in an offline sandbox
(no Postgres, no network, no Supabase/Flutterwave accounts). No live credentials were used; nothing was deployed.

Package size correction: earlier messages said "81 files". That counted zip directory entries. The package has
real files only (see `unzip -l`); this review added tests and one component.

## 0. Registration "Failed to fetch" fix (see docs/CLOUDFLARE_FIX.md)
Diagnosis: wrong Supabase URL baked into an old build (ERR_NAME_NOT_RESOLVED) + variables not rebuilt. Added: shared settings validator (`src/lib/config.js`), build guard (`scripts/check-env.mjs`, run by `npm run build`), setup-error screen, live connection banner, friendly auth error, build stamp + `/build-info.json`. Verified by 9 config tests and 9 new browser tests. **Not verified:** a real Cloudflare build, real Supabase registration (no network/accounts here), and which commit/variables your live site currently has.

## 1. Verified working (executed, with results)

| Area | Method | Result |
|---|---|---|
| 7 game engines (rules, turn order, illegal moves, hidden info, draws) | `npm run test:games` (node:test) | **22 / 22 pass**; chess move generator matches published perft node counts on 4 reference positions |
| Edge Function handlers: `flutterwave-init`, `-verify`, `-webhook`, `game-action` | `npm run test:functions` — real handler code, mock Supabase + mock Flutterwave | **23 / 23 pass** (see §5, §6), incl. per-player rate limiting of race games |
| Frontend in a real browser (Chromium), real source + real React 19.2.8, **mock** backend | `npm run test:ui` | **47 / 47 pass** after fixes below (adds legal pages, 18+ gate, admin payments panel) |
| All 7 games rendered and playable from the UI | UI tests D1–D7 | pass |
| Mobile layout of all 7 games at 360 px | UI tests E1–E7 | pass (4 failed before the fix) |
| Code ↔ database consistency (tables, columns, RPC names + argument names, GRANT/REVOKE signatures, SECURITY DEFINER search_path, explicit REVOKEs) | `npm run audit` (mutation-tested: catches injected errors) | **no problems** |
| Static security assertions over SQL text (no client write grants, no write RLS policies, every `dg_admin_*` checks `dg_is_admin()` before writing, service-only functions not granted to clients, single admin email literal) | `npm run audit` | pass — **static evidence only, not an executed SQL test** |
| Imports resolve, JSX compiles, bundle builds (esbuild; 708 KB) | `tests/e2e/build.sh` | pass (this is **not** `vite build`) |
| TypeScript `--strict` on frontend, engines, Edge Functions | `tsc` against **stub** library types | pass (real `react`/`supabase-js` types not checked) |

## 2. Defects found and fixed in this review
1. **Mobile overflow** — Gomoku, Memory, Scramble and Chess boards overflowed the modal on a 360 px phone (sized from viewport width, not container). Fixed in `src/extra.css`; UI check made stricter and re-run.
2. **Password-reset dead end** — the reset email logged the user in but there was no screen to set a new password. Added `src/components/RecoveryModal.tsx` + `PASSWORD_RECOVERY` handling; covered by UI tests J1–J2.
3. **Documentation error** — "81 files" was wrong (see above).
4. Test-harness bugs (call log lost on redirect; audit false positives) fixed; audit mutation-tested so a pass is meaningful.

## 3. Failed tests
Currently failing: **none**. Failed during this review before fixes: UI E-Gomoku, E-Memory, E-Scramble, E-Chess (real layout bugs, fixed) and H2 (test-harness artefact, fixed).

## 4. NOT executed (the launch blockers)
| Item | Why not run | How to run |
|---|---|---|
| **All 8 SQL migrations** (syntax, ordering, dependencies) | no Postgres in sandbox | `supabase db reset` |
| **pgTAP suites** (`phase1_security`, `phase2_wallet_lifecycle`, `phase3_admin_read`, about 110 assertions across 3 files: admin identity, RLS, wallet/ledger conservation, escrow, refunds, expiry, byes, payouts) | same | `supabase test db` |
| `npm install` + `vite build` + `tsc` with real types | no network | `npm install && npm run typecheck && npm run build` |
| Edge Functions on the real Deno runtime | no Deno/network | `supabase functions serve`, then deploy to staging |
| Flutterwave TEST-mode payment end-to-end incl. real webhook delivery | needs your account | see DEPLOYMENT.md §6 |
| UI against the real backend (auth, RLS-filtered data) | no backend | staging smoke test (`tests/tests.json`) |
| Post-deploy security probes | no deployment | `sh tests/security_probes.sh` (against staging only) |
| CI workflows, pg_cron job, `supabase/config.toml` validity | no CI/CLI | push to GitHub; `supabase start` |
| `npm audit`, dependency licence/vuln scan, penetration test | no network | `npm audit` + independent review |
| Load / concurrency test of join & ledger under parallel requests | no DB | write after staging works (the code uses row locks; unproven) |

Highest-risk places where I expect the first real run to surface bugs: `dg__build_round` (lateral join + `order by gen_random_uuid()`), custom SQLSTATE codes (`DG001/DG409`), the `auth.users` triggers, `supabase/config.toml` completeness, and real-type errors in `src/lib/*.ts` (supabase-js generics).

## 5. Business-rule verification
| Requirement | Evidence | Status |
|---|---|---|
| Only sylvesterokosodo@gmail.com can administer | DB: `dg_admins` CHECK on email + single-row unique index; `dg_is_admin()` needs confirmed email, re-checked on every admin call; all `dg_admin_*` check it before writing (static audit); UI gating tested | **Designed + statically verified; not executed.** Depends on Supabase "Confirm email" being ON (see §7-1) |
| Ordinary users cannot create tournaments | no INSERT/UPDATE grants or write policies on tournaments (static audit); admin RPC checks admin; UI hides/blocks (tested) | statically verified; **pgTAP + probes unexecuted** |
| Ordinary users cannot change wallet balances | no write grants/policies on wallets/ledger/payments (static audit); credit function not granted to clients; ledger append-only triggers; coins credited only by service role after server-side Flutterwave verification (handler tests) | statically verified; **unexecuted in SQL** |
| Payment verification | `verifyAndCredit` re-queries Flutterwave with the secret key, checks tx_ref, status, currency, amount; uses API-returned values, never webhook/browser values | **handler tests pass** |
| Duplicate-payment protection | webhook secret-hash (constant-time); `FOR UPDATE` on payment row; status check; ledger idempotency key `purchase:<payment id>`; unique `flw_transaction_id`; replay tests | handler logic **tested**; SQL half **unexecuted** |
| Refunds / escrow / payouts | cancel, expiry (48 h), admin-cancel all refund via `dg__refund_all`; completion settles every hold and credits bonus coins; pgTAP asserts wallet = sum(ledger) | **written, unexecuted** |
| Results approved only by admin | game server only *proposes* (tested); `dg_admin_approve_result` is the only path to a winner | handler tests pass; SQL unexecuted |
| 1 coin = ₦1 | CHECK `coins = amount_ngn`, currency CHECK = NGN | static |

## 6. Security findings
| # | Severity | Finding | Action |
|---|---|---|---|
| 1 | **Critical (configuration)** | If Supabase "Confirm email" is **off**, whoever registers the admin address first is auto-confirmed and becomes admin; SQL cannot detect this | Turn ON confirmation; register + confirm the owner account **before** opening signups; verify with the SQL in §8 |
| 2 | **High (unverified)** | RLS, grants and function privileges are untested against a real database | Run pgTAP + `security_probes.sh` on staging; do not launch until both pass |
| 3 | High | Legacy `backend/` (AppDeploy) still in repo; its `demo-credit` route mints ₦500,000/call | Take offline; delete the folder (needs your approval) |
| 4 | Medium (partly mitigated) | Scramble and Puzzle are *races*. `game-action` now limits each player to 1 Scramble guess / 1.5 s and 1 Puzzle move / 0.15 s (tested), which stops brute-force guessing. A script can still solve the 8-puzzle; the Scramble word list ships in the bundle | Admin approval remains the backstop; consider excluding these two games from high-value prize tournaments |
| 5 | Medium | Multi-accounting/collusion (one person, several accounts) and no KYC | Policy + KYC decision before real money |
| 6 | Medium (partly mitigated) | Admin now has a read-only Payments & reconciliation panel (flags pending > 1 h; migration 8 + UI test). Resolving a stuck payment still means re-sending the webhook from the Flutterwave dashboard (credits are idempotent) | Document the procedure in your ops runbook |
| 7 | Medium | Supabase Auth hardening not configured: password strength, leaked-password protection, CAPTCHA, custom SMTP (default SMTP is heavily rate-limited), rate limits | Configure in dashboard |
| 8 | Low | `dg_tournaments.created_by` (admin user id) and `champion_user_id` are readable by anyone | Column-level grants (small follow-up) |
| 9 | Low | `dg_run_expiry()` callable by any signed-in user (idempotent, only performs legitimate expiries) | Acceptable; note |
| 10 | Low | CSP (`public/_headers`) untested in a real browser/host; Vercel needs an equivalent `vercel.json` | Test on staging with DevTools console open |
| 11 | Info | Dependencies unaudited | `npm audit` |

## 7. Missing functionality (not built)
Prize cash-out/withdrawals (physical prizes are manual); KYC; **lawyer-approved** Terms/Privacy (draft templates and an 18+/terms sign-up checkbox now exist but are NOT legal advice; placeholders `[CONTACT EMAIL]`, `[COMPANY NAME AND ADDRESS]` must be filled); editing a draft tournament; no-show forfeits/match timeouts; notifications when a match is ready; real-time updates (UI polls 2–5 s); player profile/history; account deletion/data export; admin analytics/export; monitoring, alerting and backup runbook; accessibility audit; load testing.

## 8. Exact commands

### Local verification (on your machine, with network)
```bash
npm install
npm run typecheck          # real React/supabase-js types — expect to fix a few errors on first run
npm test                   # typecheck + engines + edge-function handlers + static audit
npm run build              # real vite build
pip install playwright && playwright install chromium
npm run test:ui            # 43 browser checks (mock backend)
supabase start && supabase db reset && supabase test db     # the unexecuted SQL tests
```

### Staging deployment (never production first)
```bash
supabase login
supabase link --project-ref <STAGING_REF>
supabase db push
supabase secrets set FLW_SECRET_KEY=<TEST key> FLW_WEBHOOK_SECRET_HASH=$(openssl rand -hex 32) APP_URL=<staging url>/
supabase functions deploy flutterwave-init
supabase functions deploy flutterwave-verify
supabase functions deploy flutterwave-webhook --no-verify-jwt
supabase functions deploy game-action
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run build      # deploy dist/ to a staging host
```
Admin-safety check (SQL editor), after registering the owner account:
```sql
select email, email_confirmed_at is not null as confirmed, created_at from auth.users where lower(email)='sylvesterokosodo@gmail.com';
select user_id, email from public.dg_admins;     -- exactly one row, only after confirmation
```
Post-deploy probes (ordinary test player token only): `SUPABASE_URL=... ANON_KEY=... PLAYER_JWT=... PLAYER_ID=... sh tests/security_probes.sh`

### Go/no-go gate for production
All must be true: migrations apply cleanly; `supabase test db` all green; `security_probes.sh` all PASS; `npm run build` + `npm test` green with real deps; a Flutterwave **test** payment credits exactly once and survives a webhook replay; a full 4-player tournament completes with correct escrow settlement and a reconciling ledger; admin-email check above is correct; legal sign-off; legacy backend removed.

## 9. Needs YOU (approval or external access)
1. Create the staging Supabase project; run `supabase login/link/db push` (your credentials).
2. Supabase dashboard: enable Confirm email, enable pg_cron, custom SMTP, Auth hardening.
3. Approve migration 1 (archives old `dg_*` tables into schema `legacy`; non-destructive).
4. Flutterwave account: TEST keys → `supabase secrets set` (never paste keys in chat); webhook URL + secret hash in their dashboard. Live keys only after §8 gate.
5. Approve deleting `backend/`, the old `create-tournament` Edge Function, and (optionally) unused Tailwind files.
6. Choose the static host and domain; set `APP_URL`.
7. Legal review (Nigerian gaming/lottery rules), Terms/Privacy, KYC decision.
8. Decide: byes vs house bots; draw policy; whether Scramble/Puzzle are allowed in prize tournaments.
