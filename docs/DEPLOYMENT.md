# Dream Game: installation and deployment guide

> Everything below is **written but not yet executed** by the author (no database, Supabase project or
> Flutterwave account was available). Follow the order; use a **staging** Supabase project first.

## 0. Read first
See `docs/LAUNCH_READINESS_REPORT.md` for exactly what has been verified, what has **not** been executed
(all SQL, real-dependency build, Flutterwave, real backend) and the go/no-go gate. This guide assumes a
**staging** project first.

## 1. Prerequisites (accounts only you can create)

* Supabase project (staging, then production), Node 22.18+, Docker (for local `supabase start`).
* Flutterwave account with TEST keys (live keys only after legal review; see §9).
* A static host (Netlify, Cloudflare Pages, Vercel...).

## 2. Local setup and tests

```bash
npm install
cp .env.example .env.local          # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run typecheck                   # real library types (first run may reveal fixes)
npm test                            # typecheck + game engines + edge-function handlers + static SQL audit
npm run build                       # production bundle -> dist/
pip install playwright && playwright install chromium && npm run test:ui   # browser tests (mock backend)
supabase start && supabase db reset && supabase test db                    # SQL tests (need Docker)
npm run dev
```

## 3. Take the old backend offline (urgent)

The `backend/` folder (AppDeploy) contains `POST /api/wallet/demo-credit`, which lets any user mint ₦500,000
per call. If deployed anywhere, shut it down. Then delete `backend/`, `tests/tests.json` (old version),
`tailwind.config.js` and `postcss.config.js` are optional to remove (Tailwind is unused; if you delete the
two config files also remove `tailwindcss`, `postcss`, `autoprefixer` from `package.json`).

## 4. Supabase project

1. **Auth → Providers → Email → enable "Confirm email".** (Required for admin safety.)
2. Auth → URL Configuration: set Site URL to your deployed URL; add it to Redirect URLs.
3. Database → Extensions → enable **pg_cron** (scheduled 48-hour expiry; the app also triggers expiry on load).
4. Run `supabase/diagnostics/phase0_inventory.sql` in the SQL editor on the project that holds your old
   data and keep the output. **Approve** migration 1 (archives old `dg_*` objects into schema `legacy`; nothing is deleted).
5. Link and push:
   ```bash
   supabase login                      # you authenticate in the browser
   supabase link --project-ref <STAGING_REF>
   supabase db push                    # applies migrations 1..7 in order
   ```
6. Register `sylvesterokosodo@gmail.com` in the app and **confirm the email**. The database then grants admin
   automatically. (If the account already existed and was confirmed, migration 3 backfilled it.)
7. Delete the old Edge Function `create-tournament` in the dashboard (replaced by SQL function
   `dg_admin_create_tournament`).

## 5. Edge Functions and secrets

You run these on your machine; never paste the values into chat.

```bash
supabase secrets set FLW_SECRET_KEY=FLWSECK_TEST-xxxxxxxx
supabase secrets set FLW_WEBHOOK_SECRET_HASH=$(openssl rand -hex 32)   # note this value for step 6
supabase secrets set APP_URL=https://YOUR-SITE.example.com/
supabase functions deploy flutterwave-init
supabase functions deploy flutterwave-verify
supabase functions deploy flutterwave-webhook --no-verify-jwt
supabase functions deploy game-action
```

## 6. Flutterwave dashboard

* Settings → Webhooks: URL `https://<PROJECT_REF>.supabase.co/functions/v1/flutterwave-webhook`,
  Secret hash = the exact `FLW_WEBHOOK_SECRET_HASH` value, enable "charge.completed".
* Test with a Flutterwave TEST card; confirm wallet +1,000 coins for ₦1,000, once, even if the webhook is replayed.

## 7. Frontend deployment

```bash
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run build   # outputs dist/
```
Deploy `dist/`. `public/_headers` (CSP etc.) is applied by Netlify/Cloudflare Pages; on Vercel translate it
into `vercel.json` headers. Tournament links look like `https://site/#/t/<slug>`.
`vite.config.ts` already uses `base: './'`, so subfolders work.

## 8. Operating the platform

* **Create:** Admin tab → Create tournament (publish immediately or save a draft, then Publish).
  Publishing starts the 48-hour window. Copy the unique link from the Admin list.
* **Start:** automatic when the player count reaches the target (random bracket; odd counts get a bye).
* **Results:** players play inside the app; the server proposes the winner; **you approve** in Admin → live
  tournament → "Approve". You can also award a match to either player (no-shows, repeated draws).
* **Finish:** approving the final settles escrow, crowns the champion and credits optional bonus coins.
* **Cancel:** Admin → Cancel refunds every entry in full.

## 9. Before real money (not engineering)

* Get legal advice: paid entry + cash-value prizes can fall under Nigerian lottery/gaming regulation.
* Publish Terms, Privacy (NDPR) and an 18+ policy; consider KYC before any withdrawals (withdrawals are **not** implemented).
* Switch to Flutterwave live keys only after a full staging test; rotate keys if ever exposed.

## 10. Known limitations / decisions needing your input

* Odd player counts use **byes**, not house bots.
* Draws replay up to 3 times (sides swap), then you decide.
* No withdrawals, no password-change screen beyond email reset, no real-time sockets (UI polls every 2-5 s).
* Prize "bonus coins" are paid from the platform (not from the entry-fee pool); size them accordingly.
* The Puzzle/Scramble games are races; Scramble has no rate limit on guesses beyond normal API limits.
