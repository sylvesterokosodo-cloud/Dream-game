"""
Browser tests for the REAL frontend source bundled with a MOCK Supabase (see mocks/).
They verify UI behaviour, routing, request shapes and the seven game boards.
They do NOT verify SQL, RLS, Edge Functions or Flutterwave.

Run (from repo root):
    NODE_PATH=<dir containing react & react-dom> ESBUILD=<esbuild path> sh tests/e2e/build.sh
    pip install playwright && playwright install chromium
    python3 tests/e2e/ui_tests.py
"""
import functools
import http.server
import json
import os
import sys
import threading
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "dist")
DIST_BAD = os.path.join(HERE, "dist-bad")
SB_HOST = "abcdefghijklmnopqrst.supabase.co"
HEALTH = {}
GAMES = {
    "tic-tac-toe": "Tic-Tac-Toe", "connect-4": "Connect 4", "gomoku": "Gomoku",
    "memory-match": "Memory Match", "scramble": "Scramble", "puzzle": "Puzzle", "chess": "Chess",
}

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail and not ok else ""))


def iso(delta_h=0):
    return (datetime.now(timezone.utc) + timedelta(hours=delta_h)).isoformat()


def tournament(**kw):
    base = dict(
        id="t-open", slug="weekend-cup-ab12cd34", title="Weekend Cup", description="Fun",
        prize_title="Smartphone", prize_description="A brand new phone", prize_image_url=None,
        prize_value_ngn=250000, prize_coins=0, entry_fee_coins=1000, target_players=8, entries_count=3,
        games=["chess", "gomoku", "tic-tac-toe"], status="open", registration_deadline=iso(40),
        champion_name=None, created_at=iso(-1),
    )
    base.update(kw)
    return base


EMPTY_TTT = {"game": "tic-tac-toe", "draws": 0, "turn": 0, "outcome": {"done": False},
             "view": {"board": [None] * 9, "turn": 0, "winner": None}}
AFTER_MOVE = {"game": "tic-tac-toe", "draws": 0, "turn": 1, "outcome": {"done": False},
              "view": {"board": [None] * 4 + [0] + [None] * 4, "turn": 1, "winner": None}}


def mock(user=None, admin=False, tables_extra=None, **extra):
    m = {
        "user": {"id": "u1", "email": "player@example.com"} if user else None,
        "isAdmin": admin,
        "tables": {
            "dg_tournaments": [
                tournament(),
                tournament(id="t-live", slug="live-cup-11112222", title="Live Cup", status="live", entries_count=4, target_players=4),
                tournament(id="t-done", slug="done-cup-33334444", title="Done Cup", status="completed", champion_name="Ada"),
            ],
            "dg_wallets": [{"user_id": "u1", "available_coins": 5000, "escrowed_coins": 0}],
            "dg_profiles": [{"id": "u1", "display_name": "Player One"}, {"id": "u2", "display_name": "Player Two"}],
            "dg_tournament_entries": [],
            "dg_tournament_rounds": [{"id": "r1", "tournament_id": "t-live", "round_number": 1, "status": "active"}],
            "dg_matches": [{
                "id": "m1", "tournament_id": "t-live", "round_id": "r1", "match_number": 1, "game": "tic-tac-toe",
                "player_a": "u1", "player_b": "u2", "is_bye": False, "winner_id": None, "proposed_winner_id": None,
                "status": "in_progress", "game_state": EMPTY_TTT}],
            "dg_wallet_ledger": [],
        },
        "invoke": {
            "game-action": {"myIndex": 0, "status": "in_progress", "game": "tic-tac-toe", "public": AFTER_MOVE},
            "flutterwave-init": {"link": "https://checkout.example/pay/abc", "tx_ref": "DG-" + "a" * 32},
            "flutterwave-verify": {"ok": True, "status": "credited", "coins": 1000},
        },
        "rpcResults": {"dg_join_tournament": {"ok": True, "started": False, "message": "Entry secured. Your coins are held in escrow."}},
    }
    m["tables"].update(tables_extra or {})
    m.update(extra)
    return m


CALLS = {}


def calls(page):
    """Calls recorded via console (survives navigation, e.g. the redirect to checkout)."""
    return CALLS.setdefault(id(page), [])


def open_page(browser, base, m, w=1280, h=900, path="", errors=None, health="ok"):
    ctx = browser.new_context(viewport={"width": w, "height": h})
    seen = HEALTH.setdefault(id(ctx), [])

    def health_route(route):
        seen.append({"url": route.request.url, "apikey": route.request.headers.get("apikey")})
        if health == "dns":
            route.abort("namenotresolved")
        elif health == "badkey":
            route.fulfill(status=401, content_type="application/json", body='{"message":"Invalid API key"}')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"ok"}')

    ctx.route(f"https://{SB_HOST}/**", health_route)
    page = ctx.new_page()
    page.health_seen = seen
    page.add_init_script(f"window.__MOCK__ = {json.dumps(m)};")
    CALLS[id(page)] = []
    page.on("console", lambda msg: CALLS[id(page)].append(json.loads(msg.text[8:])) if msg.text.startswith("__CALL__") else None)
    if errors is not None:
        page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + path)
    return ctx, page


def serve(directory):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}/"


def main():
    if not os.path.exists(os.path.join(DIST, "entry.js")):
        sys.exit("Run tests/e2e/build.sh first")
    base = serve(DIST)
    base_bad = serve(DIST_BAD)
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---- A. anonymous visitor ----
        ctx, page = open_page(browser, base, mock(user=False), errors=errors)
        page.get_by_text("Dream tournaments").wait_for()
        check("A1 anonymous sees published open tournament", page.get_by_text("Weekend Cup").first.is_visible())
        check("A2 draft/other statuses handled: live tournament card also listed", page.get_by_text("Live Cup").first.is_visible())
        check("A3 no Admin tab for anonymous", page.locator("nav.tabs a", has_text="Admin").count() == 0)
        check("A4 Log in button visible", page.get_by_role("button", name="Log in").first.is_visible())
        page.goto(base + "#/admin")
        page.get_by_text("Administrators only").wait_for()
        check("A5 #/admin shows 'Administrators only' to anonymous", True)
        page.goto(base + "#/winners")
        page.get_by_text("Ada").wait_for()
        check("A6 Winners page shows champion", True)
        ctx.close()

        # ---- B. ordinary logged-in player ----
        ctx, page = open_page(browser, base, mock(user=True, admin=False), errors=errors)
        page.get_by_text("Dream tournaments").wait_for()
        check("B1 player header shows coin balance 5,000", "5,000" in page.locator("a.balance").inner_text())
        check("B2 no Admin tab for ordinary player", page.locator("nav.tabs a", has_text="Admin").count() == 0)
        page.goto(base + "#/admin")
        page.get_by_text("Administrators only").wait_for()
        check("B3 #/admin blocked for ordinary player", page.get_by_role("button", name="Create tournament").count() == 0)
        ctx.close()

        # ---- C. admin creates a tournament ----
        ctx, page = open_page(browser, base, mock(user=True, admin=True), errors=errors)
        page.locator("nav.tabs a", has_text="Admin").wait_for()
        check("C1 admin sees Admin tab", True)
        page.goto(base + "#/admin")
        page.get_by_role("button", name="Create tournament").first.click()
        page.get_by_label("Tournament name").fill("UI Cup")
        page.get_by_label("Prize name").fill("Laptop")
        page.get_by_label("Prize description").fill("A fast laptop")
        page.locator("form.modal button.submit").click()
        page.wait_for_timeout(400)
        c = [x for x in calls(page) if x.get("name") == "dg_admin_create_tournament"]
        check("C2 create calls dg_admin_create_tournament once", len(c) == 1)
        if c:
            a = c[0]["args"]
            check("C3 payload has all 7 games by default", sorted(a["p_games"]) == sorted(GAMES.keys()), str(a["p_games"]))
            check("C4 payload values (fee 1000, players 16, publish, prize coins 0)",
                  a["p_entry_fee_coins"] == 1000 and a["p_target_players"] == 16 and a["p_publish"] is True and a["p_prize_coins"] == 0, str(a))
        ctx.close()

        # ---- D. all seven games are playable in the browser (practice mode) ----
        ctx, page = open_page(browser, base, mock(user=False), errors=errors)
        page.get_by_text("Games in the arena").wait_for()
        chips = page.locator(".game-chips button")
        check("D0 seven game chips present", chips.count() == 7, str(chips.count()))
        for gid, label in GAMES.items():
            page.locator(".game-chips button", has_text=label).click()
            modal = page.locator(".modal.game-modal")
            modal.get_by_role("heading", name=label).wait_for()
            ok = False
            try:
                if gid == "tic-tac-toe":
                    modal.get_by_label("Cell 5, empty").click()
                    ok = modal.get_by_label("Cell 5, X").count() == 1 and modal.get_by_text("Player 2 to move").count() == 1
                elif gid == "connect-4":
                    modal.get_by_label("Drop disc in column 4").click()
                    ok = modal.get_by_text("Player 2 to move").count() == 1 and modal.locator(".c4-cell.p0").count() == 1
                elif gid == "gomoku":
                    modal.get_by_label("Row 8 column 8").click()
                    ok = modal.get_by_text("Player 2 to move").count() == 1 and modal.locator(".stone.s0").count() == 1
                elif gid == "memory-match":
                    modal.get_by_label("Card 1, face down").click()
                    ok = modal.locator(".mem-card.up").count() == 1
                elif gid == "scramble":
                    word = modal.locator(".scramble-word").inner_text().replace(" ", "")
                    modal.get_by_label("Your answer").fill("zzz")
                    modal.get_by_role("button", name="Submit").click()
                    ok = len(word) >= 5 and modal.locator(".scramble-word").inner_text().replace(" ", "") == word
                elif gid == "puzzle":
                    tiles = modal.locator(".puz-tile:not(.blank)")
                    for i in range(tiles.count()):
                        tiles.nth(i).click()
                        if "Your moves 1" in modal.locator(".mem-score").inner_text():
                            ok = True
                            break
                elif gid == "chess":
                    modal.get_by_label("e2 P").click()
                    modal.get_by_label("e5 empty").click()  # not a legal target: must not move
                    illegal_ignored = modal.get_by_label("e2 P").count() == 1
                    modal.get_by_label("e2 P").click()
                    modal.get_by_label("e4 empty").click()
                    ok = illegal_ignored and modal.get_by_label("e4 P").count() == 1 and modal.get_by_text("Player 2 to move").count() == 1
            except Exception as e:  # noqa: BLE001
                ok = False
                print("   ", gid, "->", str(e)[:160])
            check(f"D {label}: board renders and accepts a legal move", ok)
            modal.get_by_label("Close").click()
        ctx.close()

        # ---- E. mobile layout of every game (360px) ----
        ctx, page = open_page(browser, base, mock(user=False), w=360, h=740, errors=errors)
        page.get_by_text("Games in the arena").wait_for()
        for gid, label in GAMES.items():
            page.locator(".game-chips button", has_text=label).click()
            modal = page.locator(".modal.game-modal")
            modal.get_by_role("heading", name=label).wait_for()
            page.wait_for_timeout(100)
            overflow = page.evaluate("""() => {
                const m = document.querySelector('.modal.game-modal');
                const cs = getComputedStyle(m);
                const box = m.getBoundingClientRect();
                const contentRight = box.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
                const vw = document.documentElement.clientWidth;
                const inner = [...m.querySelectorAll('button,input,.mem-grid,.chess,.c4,.puz-grid,.gomoku,.scramble-word')]
                  .filter(e => e.offsetParent !== null && !e.closest('.modal-head')).map(e => e.getBoundingClientRect().right);
                return { overContent: Math.max(0, ...inner) - contentRight, modalScroll: m.scrollWidth - m.clientWidth,
                         pageScroll: document.documentElement.scrollWidth - vw };
            }""")
            fits = overflow["overContent"] <= 1 and overflow["modalScroll"] <= 1 and overflow["pageScroll"] <= 1
            check(f"E {label}: fits a 360px screen without sideways scroll", fits, json.dumps(overflow))
            modal.get_by_label("Close").click()
        ctx.close()

        # ---- F. tournament page: join + bracket ----
        ctx, page = open_page(browser, base, mock(user=True), path="#/t/weekend-cup-ab12cd34", errors=errors)
        page.get_by_role("button", name="Join for 1,000 coins").wait_for()
        check("F1 open tournament shows prize, fee and Join button", page.get_by_text("Smartphone").first.is_visible())
        page.get_by_role("button", name="Join for 1,000 coins").click()
        page.get_by_text("Entry secured").first.wait_for()
        j = [x for x in calls(page) if x.get("name") == "dg_join_tournament"]
        check("F2 Join calls dg_join_tournament with the tournament id", len(j) == 1 and j[0]["args"] == {"p_tournament_id": "t-open"}, str(j))
        page.goto(base + "#/t/live-cup-11112222")
        page.get_by_text("Your match is ready").wait_for()
        check("F3 live tournament shows bracket + 'Play now' to the player's match",
              page.locator("a.btn-primary", has_text="Play now").get_attribute("href") == "#/m/m1")
        ctx.close()

        ctx, page = open_page(browser, base, mock(user=False), path="#/t/weekend-cup-ab12cd34", errors=errors)
        page.get_by_role("button", name="Join for 1,000 coins").wait_for()
        page.get_by_role("button", name="Join for 1,000 coins").click()
        page.get_by_role("heading", name="Welcome back").wait_for()
        check("F4 anonymous clicking Join is asked to sign in (no RPC call)",
              not [x for x in calls(page) if x.get("name") == "dg_join_tournament"])
        ctx.close()

        # ---- G. match page: server-driven moves ----
        ctx, page = open_page(browser, base, mock(user=True), path="#/m/m1", errors=errors)
        page.get_by_label("Cell 5, empty").wait_for()
        page.get_by_label("Cell 5, empty").click()
        page.wait_for_timeout(300)
        inv = [x for x in calls(page) if x.get("type") == "invoke" and x.get("name") == "game-action"]
        check("G1 match page first asks the server for state (action=get)", inv and inv[0]["body"]["action"] == "get", str(inv[:1]))
        mv = [x for x in inv if x["body"].get("action") == "move"]
        check("G2 click sends the move to the game server", len(mv) == 1 and mv[0]["body"]["move"] == {"cell": 4}, str(mv))
        check("G3 UI shows waiting state after the server accepts the move", page.get_by_text("Waiting for Player Two").count() >= 1)
        ctx.close()

        # ---- H. wallet purchase redirect ----
        ctx, page = open_page(browser, base, mock(user=True), path="#/wallet", errors=errors)
        page.get_by_label("Amount in naira").wait_for()
        page.get_by_label("Amount in naira").fill("50")
        check("H1 amount below NGN 100 disables Buy", page.locator(".inline-field button").is_disabled())
        page.get_by_label("Amount in naira").fill("2000")
        ctx.route("https://checkout.example/**", lambda r: r.fulfill(status=200, body="checkout"))
        with page.expect_request("https://checkout.example/**"):
            page.locator(".inline-field button").click()
        init = [x for x in calls(page) if x.get("name") == "flutterwave-init"]
        check("H2 Buy sends only {amount} to flutterwave-init, then redirects to the hosted checkout",
              len(init) == 1 and init[0]["body"] == {"amount": 2000}, str(init))
        ctx.close()

        # ---- I. return from Flutterwave ----
        ctx, page = open_page(browser, base, mock(user=True), path="?status=successful&tx_ref=DG-abc&transaction_id=555", errors=errors)
        page.get_by_text("Payment confirmed").wait_for()
        v = [x for x in calls(page) if x.get("name") == "flutterwave-verify"]
        check("I1 return URL triggers server-side verification with the ids", len(v) == 1 and v[0]["body"] == {"transaction_id": "555", "tx_ref": "DG-abc"}, str(v))
        check("I2 query string is cleaned from the address bar", "tx_ref" not in page.url)
        ctx.close()
        ctx, page = open_page(browser, base, mock(user=True), path="?status=cancelled&tx_ref=DG-abc", errors=errors)
        page.get_by_text("Payment was cancelled").wait_for()
        check("I3 cancelled payment does not call verify", not [x for x in calls(page) if x.get("name") == "flutterwave-verify"])
        ctx.close()

        # ---- K. legal pages, 18+ gate, admin payments ----
        ctx, page = open_page(browser, base, mock(user=False), path="#/terms", errors=errors)
        page.get_by_role("heading", name="Terms of Use").wait_for()
        check("K1 Terms page renders with the legal-review banner", page.get_by_text("DRAFT for legal review").count() == 1)
        page.goto(base + "#/privacy"); page.get_by_role("heading", name="Privacy Policy (NDPR)").wait_for()
        page.goto(base + "#/responsible"); page.get_by_role("heading", name="Responsible Play").wait_for()
        check("K2 Privacy and Responsible Play pages render", True)
        page.goto(base + "#/"); page.get_by_role("button", name="Log in").first.click()
        page.get_by_role("button", name="New here? Create account").click()
        cb = page.get_by_label("I am 18 or older")
        check("K3 sign-up requires the 18+/terms checkbox", cb.count() == 1 and cb.get_attribute("required") is not None)
        ctx.close()
        ctx, page = open_page(browser, base, mock(user=True, admin=True, tables_extra={"dg_payments": [
            {"id": "pay1", "tx_ref": "DG-" + "d" * 32, "user_id": "u1", "amount_ngn": 5000, "status": "pending", "flw_transaction_id": None, "created_at": iso(-3)},
            {"id": "pay2", "tx_ref": "DG-" + "e" * 32, "user_id": "u2", "amount_ngn": 1000, "status": "successful", "flw_transaction_id": "777", "created_at": iso(-1)}]}),
            path="#/admin", errors=errors)
        page.get_by_role("button", name="Show payments & reconciliation").click()
        page.get_by_text("STUCK >1h").wait_for()
        check("K4 admin payments panel lists payments and flags stuck pending ones",
              page.get_by_text("SUCCESSFUL").count() == 1 and page.get_by_text("₦5,000").count() >= 1)
        ctx.close()

        # ---- L. connection diagnosis, build stamp, setup-error screen ----
        ctx, page = open_page(browser, base, mock(user=False), errors=errors, health="ok")
        page.get_by_text("Dream tournaments").wait_for()
        page.wait_for_timeout(300)
        check("L1 healthy server: no warning banner", page.get_by_text("cannot reach the Dream Game server").count() == 0)
        check("L2 footer shows the build commit stamp", page.get_by_text("build test123").count() == 1)
        seen = page.health_seen
        check("L3 health probe goes to the configured Supabase host with the public key in the apikey header",
              len(seen) >= 1 and seen[0]["url"] == f"https://{SB_HOST}/auth/v1/health" and (seen[0]["apikey"] or "").startswith("sb_publishable_"), str(seen[:1]))
        ctx.close()
        ctx, page = open_page(browser, base, mock(user=False), errors=errors, health="dns")
        page.get_by_text("cannot reach the Dream Game server").wait_for()
        check("L4 DNS/network failure shows a clear banner naming the host", page.get_by_text(SB_HOST).count() >= 1)
        check("L5 the rest of the app still renders when the server is unreachable", page.get_by_text("Dream tournaments").count() == 1)
        ctx.close()
        ctx, page = open_page(browser, base, mock(user=False), errors=errors, health="badkey")
        page.get_by_text("rejected this site's public key").wait_for()
        check("L6 a rejected key (HTTP 401) is reported as a key problem", True)
        ctx.close()
        ctx, page = open_page(browser, base, mock(user=False, authError="Failed to fetch"), errors=errors)
        page.get_by_text("Dream tournaments").wait_for()
        page.get_by_role("button", name="Log in").first.click()
        page.get_by_label("Email address").fill("a@b.com"); page.get_by_label("Password").fill("password123")
        page.locator("form.modal button.btn-primary.submit").click()
        page.get_by_text("We cannot reach the Dream Game server").wait_for()
        check("L7 'Failed to fetch' at login/registration becomes a plain-English message", page.get_by_text("Failed to fetch").count() == 0)
        ctx.close()
        ctx = browser.new_context(); page = ctx.new_page()
        reqs = []
        page.on("request", lambda r: reqs.append(r.url) if "supabase" in r.url else None)
        page.goto(base_bad)
        page.get_by_text("not connected to its server yet").wait_for()
        check("L8 placeholder Supabase URL in the build shows the setup-error screen", page.get_by_text("placeholder").count() >= 1)
        check("L9 setup-error screen sends NO requests to any Supabase address", not reqs, str(reqs))
        ctx.close()

        # ---- J. password recovery (reset-link landing) ----
        ctx, page = open_page(browser, base, mock(user=True), errors=errors)
        page.get_by_text("Dream tournaments").wait_for()
        page.evaluate("window.__authCb('PASSWORD_RECOVERY', null)")
        page.get_by_role("heading", name="Set a new password").wait_for()
        page.get_by_label("New password", exact=True).fill("abcd1234")
        page.get_by_label("Confirm new password").fill("different1")
        page.get_by_role("button", name="Save new password").click()
        page.get_by_text("do not match").wait_for()
        check("J1 mismatching passwords are rejected client-side (no API call)", not [x for x in calls(page) if x.get("name") == "updateUser"])
        page.get_by_label("Confirm new password").fill("abcd1234")
        page.get_by_role("button", name="Save new password").click()
        page.get_by_text("Password updated").wait_for()
        u = [x for x in calls(page) if x.get("name") == "updateUser"]
        check("J2 matching passwords call auth.updateUser", len(u) == 1 and u[0]["args"] == {"password": "abcd1234"}, str(u))
        ctx.close()

        browser.close()

    check("Z no uncaught page errors in any scenario", not errors, "; ".join(errors[:3]))
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
