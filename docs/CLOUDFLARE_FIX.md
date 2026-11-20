# Fixing "Failed to fetch" on registration (Cloudflare Pages + Supabase)

## What the evidence says (diagnosis)

| What you saw | What it means |
|---|---|
| `net::ERR_NAME_NOT_RESOLVED` | The browser looked up the server's address and the address **does not exist**. The website was **built** with a wrong Supabase URL (a placeholder such as `YOUR-PROJECT-REF`, a typo, `.com` instead of `.co`, or an old project). This is not a database or password problem. |
| "Failed to fetch" on Register | That is just the browser's wording for the failure above. Because nothing reached Supabase, no database migration or Auth setting can be the cause of *this* error. |
| Health link says `No API key in request` | **Good news, not an error.** It proves `https://yjhtepcxpdoroptdrqoh.supabase.co` exists and is running. That page needs a key header, which a browser address bar cannot send. |
| Last deployment ~6 hours ago | Vite copies `VITE_…` variables into the website **at build time**. Changing a variable in Cloudflare does **nothing** until a **new deployment** is built. The live site still contains the old, wrong address. |

Most likely root cause: the live build contains a wrong `VITE_SUPABASE_URL`, and the corrected variable has not been built into a new deployment.
I cannot see your Cloudflare account, so this is the best-supported explanation, not a confirmed fact. Steps 3-4 confirm it.

## What the code now does to prevent/diagnose this
* The build **stops** with a plain-English message if the URL/key are missing, have a placeholder, a typo (`.com`, wrong length, quote marks, extra path) or are a **secret** key.
* The build log prints the Supabase host, key type and the commit being built (never the key).
* The website shows a **setup-error screen** (not a blank page) if it was built with bad settings, and a **red banner** if the server cannot be reached or rejects the key.
* "Failed to fetch" on the login/register form becomes a clear sentence naming the server.
* The footer shows `build xxxxxxx` and `/build-info.json` shows the commit, so you can prove which version is live.

## Steps for you

### 1. Put the code on GitHub (main branch)
1. Unzip `dream-game-package.zip` on your computer.
2. Open https://github.com/sylvesterokosodo-cloud/Dream-game → **Add file → Upload files**.
3. Drag the **contents** of the unzipped folder (all folders and files, including the hidden `.github` and `.gitignore` if your computer shows them) into the page. Tick "Commit directly to the main branch", message `Fix Supabase config + launch readiness`, **Commit changes**.
4. Note the short commit code GitHub shows (7 characters, e.g. `a1b2c3d`).
   (Do not delete the old `backend` folder yet unless you want to; it is not used by the website.)

### 2. Set the variables in Cloudflare (build variables)
Cloudflare dashboard → **Workers & Pages** → your Dream-game project → **Settings → Variables and Secrets** (if you see a separate section named **Build**, use *its* variables; build-time variables are the ones that matter).
Add for **Production** (and Preview if you test previews):

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://yjhtepcxpdoroptdrqoh.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | your key that starts with `sb_publishable_` |
| `NODE_VERSION` | `22` |

Rules: no quote marks, no spaces, no `/` or path at the end. **Only the "publishable" key, never the "secret" key.**
Build settings: Build command `npm run build`, Build output directory `dist`, Production branch `main`.

### 3. Trigger a fresh deployment and check it is the latest
Pushing to `main` (step 1) starts a build automatically. If you only changed variables, go to **Deployments → the newest deployment → ⋯ → Retry deployment** (or **Create deployment** → branch `main`).
Open the deployment's **build log** and look for these lines near the top:
```
[env-check] Supabase host      : yjhtepcxpdoroptdrqoh.supabase.co
[env-check] Public key type    : publishable
[env-check] Commit being built : a1b2c3d...   <- must start with the code from GitHub
[env-check] OK
```
If the build fails with "BUILD STOPPED", the message says exactly which variable to fix.

### 4. Verify the live site
1. Open your site, hard-refresh (Ctrl+Shift+R). The footer must show `build a1b2c3d` (same 7 characters as GitHub).
2. Open `https://YOUR-SITE/build-info.json`: `commit` must match and `supabaseHost` must be `yjhtepcxpdoroptdrqoh.supabase.co`.
3. No red banner at the top. (A red banner names the exact problem.)
4. Try Register. Expected: "Check your email to confirm your account."

### 5. Supabase settings (dashboard)
* **Authentication → URL Configuration:** Site URL = your Cloudflare site address; add the same address to **Redirect URLs**. Without this, the confirmation email link will not return to your site.
* **Authentication → Providers → Email:** turn **Confirm email ON** (required: it protects the admin account).
* **Authentication → SMTP:** set a custom email sender before launch (the default sender allows only a few emails per hour).
* **Database check:** SQL Editor → paste `supabase/diagnostics/check_applied.sql` → Run → every row should say `true`. If tables/functions are `false`, paste `supabase/all_migrations_in_order.sql` and Run **once** (staging first). Registration itself works without these, but tournaments, wallets and the admin area need them.
* Register **your own owner account** (`sylvesterokosodo@gmail.com`) first and click the confirmation link, then re-run the check: "owner is admin" must be `true`.

## Still blocked for launch (not caused by this bug)
Database migrations and their SQL tests have never been run; Flutterwave has never been tested; legal review is pending. See `docs/LAUNCH_READINESS_REPORT.md`.
