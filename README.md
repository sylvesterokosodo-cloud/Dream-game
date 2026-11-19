# Dream Game

Online multiplayer tournament platform. React + Vite frontend, **Supabase as the single backend**
(Auth, Postgres + RLS, SQL functions, Edge Functions). Payments by Flutterwave. Currency NGN, 1 coin = ₦1.

| Area | Where |
|---|---|
| Frontend | `src/` (hash-routed SPA: `#/`, `#/t/<slug>`, `#/m/<matchId>`, `#/wallet`, `#/winners`, `#/admin`) |
| Database | `supabase/migrations/*.sql` (apply in order) |
| Money + tournament rules | SQL functions `dg_join_tournament`, `dg_cancel_entry`, `dg_run_expiry`, `dg_admin_*`, `dg__apply_ledger` |
| Payments | Edge Functions `flutterwave-init`, `flutterwave-verify`, `flutterwave-webhook` |
| Game server | Edge Function `game-action` + shared engines `supabase/functions/_shared/games/` |
| Tests | `npm test` (typecheck + game engines), `supabase test db` (pgTAP), manual QA in `tests/tests.json` |

Security model in one paragraph: browsers can only READ their own wallet/ledger/entries and public
tournaments. Every write goes through a SQL function or Edge Function that re-checks identity on the
server. Administrator = the single confirmed account `sylvesterokosodo@gmail.com`, enforced by a
database constraint and re-verified on every admin call. Coins are credited only after the server has
verified the transaction with Flutterwave using a secret key the browser never sees.

See `docs/DEPLOYMENT.md` to install and deploy.
