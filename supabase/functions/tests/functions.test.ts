// Run: node --import ./supabase/functions/tests/loader.mjs --test supabase/functions/tests/functions.test.ts
// Exercises the REAL Edge Function handlers with a mock Supabase client + mock Flutterwave.
// It emulates the SQL functions in JS, so it verifies the TypeScript logic only (not SQL).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---------- environment + Deno stub ----------
const ENV: Record<string, string> = {
  SUPABASE_URL: "http://sb.local", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
  FLW_SECRET_KEY: "FLWSECK_TEST-secret", FLW_WEBHOOK_SECRET_HASH: "hash-123", APP_URL: "https://app.example.com/",
};
let lastHandler: ((r: Request) => Promise<Response> | Response) | null = null;
(globalThis as any).Deno = {
  env: { get: (k: string) => ENV[k] },
  serve: (h: any) => { lastHandler = h; },
};

async function load(path: string) {
  lastHandler = null;
  await import(path);
  assert.ok(lastHandler, "handler registered");
  return lastHandler as (r: Request) => Promise<Response>;
}
const init = await load("../flutterwave-init/index.ts");
const verify = await load("../flutterwave-verify/index.ts");
const webhook = await load("../flutterwave-webhook/index.ts");
const game = await load("../game-action/index.ts");
const { verifyAndCredit } = await import("../_shared/flutterwave.ts");
const { safeEqual, corsHeaders } = await import("../_shared/http.ts");

// ---------- tiny in-memory Supabase ----------
type Row = Record<string, any>;
let db: Record<string, Row[]>;
let rpcLog: { name: string; args: any }[];
let fetchLog: { url: string; init: any }[];
let flwReply: any;
let flwOk: boolean;
let users: Record<string, { id: string; email: string }>;
let failNextSave = false;

class Query {
  f: ((r: Row) => boolean)[] = [];
  t: string;
  upd?: Row;
  constructor(t: string, upd?: Row) { this.t = t; this.upd = upd; }
  select() { return this; }
  eq(c: string, v: any) { this.f.push((r) => r[c] === v); return this; }
  rows() { return (db[this.t] ??= []).filter((r) => this.f.every((x) => x(r))); }
  maybeSingle() { return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
  single() { return this.maybeSingle(); }
  then(res: any, rej: any) {
    if (this.upd) for (const r of this.rows()) Object.assign(r, this.upd);
    return Promise.resolve({ data: this.upd ? null : this.rows(), error: null }).then(res, rej);
  }
  update(v: Row) { return new Query(this.t, v); }
}

function rpc(name: string, args: any) {
  rpcLog.push({ name, args });
  if (name === "dg_credit_purchase") {   // emulate the SQL function's rules
    const p = db.dg_payments.find((x) => x.tx_ref === args.p_tx_ref);
    if (!p) return { data: null, error: { message: "Unknown payment reference", code: "P0002" } };
    if (p.status === "successful") return { data: { status: "already_credited", coins: p.coins }, error: null };
    if (args.p_currency !== "NGN" || args.p_amount < p.amount_ngn) {
      p.status = "failed";
      return { data: { status: "rejected", reason: "amount_or_currency_mismatch" }, error: null };
    }
    p.status = "successful"; p.flw_transaction_id = args.p_flw_id;
    db.wallets[0].coins += p.coins;                                    // credited once
    return { data: { status: "credited", coins: p.coins }, error: null };
  }
  if (name === "dg_init_payment") {
    return { data: { tx_ref: "DG-" + "b".repeat(32), amount: args.p_amount }, error: null };
  }
  if (name === "dg_system_save_game") {
    if (failNextSave) { failNextSave = false; return { data: null, error: { code: "40001", message: "Game state changed, please retry" } }; }
    const m = db.dg_matches.find((x) => x.id === args.p_match)!;
    if (!["ready", "in_progress"].includes(m.status)) return { data: null, error: { code: "DG409", message: "Match is not active" } };
    const sec = db.dg_match_secrets.find((x) => x.match_id === args.p_match);
    const cur = sec?.version ?? 0;
    if (cur !== args.p_expected) return { data: null, error: { code: "40001", message: "Game state changed, please retry" } };
    if (sec) { sec.full_state = args.p_full; sec.version = cur + 1; }
    else db.dg_match_secrets.push({ match_id: args.p_match, full_state: args.p_full, version: 1 });
    Object.assign(m, {
      game_state: args.p_public, version: cur + 1, proposed_winner_id: args.p_proposed,
      status: args.p_proposed || args.p_needs_admin ? "awaiting_approval" : "in_progress",
    });
    return { data: cur + 1, error: null };
  }
  return { data: null, error: { message: "unexpected rpc " + name } };
}

const mkClient = (authHeader?: string) => ({
  from: (t: string) => new Query(t),
  rpc: async (n: string, a: any) => rpc(n, a),
  auth: {
    getUser: async () => ({ data: { user: users[(authHeader ?? "").replace("Bearer ", "")] ?? null } }),
  },
});
(globalThis as any).__createClient = (_url: string, _key: string, opts?: any) => mkClient(opts?.global?.headers?.Authorization);

const A = "11111111-1111-1111-1111-11111111aaaa", B = "22222222-2222-2222-2222-22222222bbbb";
const M1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TXREF = "DG-" + "a".repeat(32);

beforeEach(() => {
  users = { tokA: { id: A, email: "a@x.com" }, tokB: { id: B, email: "b@x.com" }, tokC: { id: "cccc", email: "c@x.com" } };
  db = {
    dg_payments: [{ id: "p1", user_id: A, tx_ref: TXREF, status: "pending", amount_ngn: 1000, coins: 1000 }],
    wallets: [{ coins: 0 }],
    dg_tournaments: [{ id: "t1", status: "live" }],
    dg_matches: [{ id: M1, tournament_id: "t1", game: "tic-tac-toe", player_a: A, player_b: B, status: "ready", game_state: null }],
    dg_match_secrets: [],
  };
  rpcLog = []; fetchLog = []; failNextSave = false;
  flwOk = true;
  flwReply = { status: "success", data: { id: 555, tx_ref: TXREF, status: "successful", amount: 1000, currency: "NGN" } };
  (globalThis as any).fetch = async (url: string, init: any) => {
    fetchLog.push({ url: String(url), init });
    return { ok: flwOk, json: async () => flwReply };
  };
});

const post = (body: unknown, token = "tokA", headers: Record<string, string> = {}) =>
  new Request("http://fn/", {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, Origin: "https://app.example.com", ...headers },
  });
const bodyOf = async (r: Response) => JSON.parse(await r.text());

// ====================== payments: verifyAndCredit ======================
test("credit: verifies with Flutterwave using the SECRET key and credits exactly once", async () => {
  const r = await verifyAndCredit(mkClient() as any, "555", TXREF);
  assert.deepEqual(r, { ok: true, status: "credited", coins: 1000 });
  assert.equal(fetchLog.length, 1);
  assert.match(fetchLog[0].url, /\/transactions\/555\/verify$/);
  assert.equal(fetchLog[0].init.headers.Authorization, "Bearer FLWSECK_TEST-secret");
  assert.equal(db.wallets[0].coins, 1000);
});
test("credit: webhook replay / double verify never double-credits", async () => {
  await verifyAndCredit(mkClient() as any, "555", TXREF);
  const again = await verifyAndCredit(mkClient() as any, "555", TXREF);
  assert.equal(again.ok && again.status, "already_credited");
  assert.equal(db.wallets[0].coins, 1000);
  assert.equal(fetchLog.length, 1, "already-successful payments do not even call Flutterwave again");
});
test("credit: values come from Flutterwave, never from the caller", async () => {
  flwReply.data.amount = 1000;
  await verifyAndCredit(mkClient() as any, "555", TXREF);
  const c = rpcLog.find((x) => x.name === "dg_credit_purchase")!;
  assert.deepEqual(c.args, { p_tx_ref: TXREF, p_flw_id: "555", p_amount: 1000, p_currency: "NGN" });
});
test("credit: a real payment for ANOTHER tx_ref cannot be replayed against this payment", async () => {
  flwReply.data.tx_ref = "DG-" + "c".repeat(32);
  const r = await verifyAndCredit(mkClient() as any, "555", TXREF);
  assert.deepEqual(r, { ok: false, status: "rejected", reason: "tx_ref_mismatch" });
  assert.equal(db.wallets[0].coins, 0);
});
test("credit: underpayment and wrong currency are rejected and mark the payment failed", async () => {
  flwReply.data.amount = 100;
  let r = await verifyAndCredit(mkClient() as any, "555", TXREF);
  assert.equal(r.ok, false);
  assert.equal(db.wallets[0].coins, 0);
  assert.equal(db.dg_payments[0].status, "failed");
  db.dg_payments[0].status = "pending";
  flwReply.data.amount = 1000; flwReply.data.currency = "USD";
  r = await verifyAndCredit(mkClient() as any, "555", TXREF);
  assert.equal(r.ok, false);
  assert.equal(db.wallets[0].coins, 0);
});
test("credit: failed / pending / outage never credit", async () => {
  flwReply.data.status = "failed";
  assert.equal((await verifyAndCredit(mkClient() as any, "555", TXREF)).ok, false);
  assert.equal(db.dg_payments[0].status, "failed");
  db.dg_payments[0].status = "pending";
  flwReply.data.status = "pending";
  const p = await verifyAndCredit(mkClient() as any, "555", TXREF);
  assert.equal(!p.ok && p.status, "pending");
  flwOk = false;
  const o = await verifyAndCredit(mkClient() as any, "555", TXREF);
  assert.equal(!o.ok && o.status, "pending");
  assert.equal(db.wallets[0].coins, 0);
});
test("credit: malformed ids and other users' payments are refused before any network call", async () => {
  assert.equal((await verifyAndCredit(mkClient() as any, "12;drop", TXREF)).ok, false);
  assert.equal((await verifyAndCredit(mkClient() as any, "555", "evil")).ok, false);
  const other = await verifyAndCredit(mkClient() as any, "555", TXREF, B);
  assert.deepEqual(other, { ok: false, status: "unknown", reason: "not_your_payment" });
  assert.equal(fetchLog.length, 0);
});

// ====================== payments: HTTP handlers ======================
test("webhook: wrong or missing hash => 401 and nothing is verified or credited", async () => {
  for (const h of [{}, { "verif-hash": "nope" }, { "verif-hash": "" }]) {
    const r = await webhook(new Request("http://fn/", { method: "POST", headers: h, body: JSON.stringify({ event: "charge.completed", data: { id: 555, tx_ref: TXREF } }) }));
    assert.equal(r.status, 401);
  }
  assert.equal(fetchLog.length, 0);
  assert.equal(db.wallets[0].coins, 0);
});
test("webhook: valid hash + charge.completed credits once; replay is harmless", async () => {
  const req = () => new Request("http://fn/", { method: "POST", headers: { "verif-hash": "hash-123" }, body: JSON.stringify({ event: "charge.completed", data: { id: 555, tx_ref: TXREF, amount: 999999 } }) });
  assert.equal((await webhook(req())).status, 200);
  assert.equal((await webhook(req())).status, 200);
  assert.equal(db.wallets[0].coins, 1000, "forged webhook amount is ignored; API-verified amount used; no double credit");
});
test("webhook: still-pending payments ask Flutterwave to retry (503); other events are ignored", async () => {
  flwReply.data.status = "pending";
  const r = await webhook(new Request("http://fn/", { method: "POST", headers: { "verif-hash": "hash-123" }, body: JSON.stringify({ event: "charge.completed", data: { id: 555, tx_ref: TXREF } }) }));
  assert.equal(r.status, 503);
  const o = await webhook(new Request("http://fn/", { method: "POST", headers: { "verif-hash": "hash-123" }, body: JSON.stringify({ event: "transfer.completed", data: {} }) }));
  assert.equal(o.status, 200);
});
test("verify endpoint: requires login and only the payment owner can confirm", async () => {
  assert.equal((await verify(post({ transaction_id: "555", tx_ref: TXREF }, "nobody"))).status, 401);
  const notMine = await verify(post({ transaction_id: "555", tx_ref: TXREF }, "tokB"));
  assert.equal(db.wallets[0].coins, 0);
  assert.notEqual(notMine.status, 200);
  const mine = await verify(post({ transaction_id: "555", tx_ref: TXREF }, "tokA"));
  assert.equal(mine.status, 200);
  assert.equal(db.wallets[0].coins, 1000);
});
test("init: login required, whole-naira amounts only, amount sent to Flutterwave comes from the DB row", async () => {
  assert.equal((await init(post({ amount: 1000 }, "nobody"))).status, 401);
  assert.equal((await init(post({ amount: 10.5 }))).status, 400);
  assert.equal((await init(post({ amount: "1000" }))).status, 400);
  flwReply = { status: "success", data: { link: "https://checkout.flutterwave.com/pay/xyz" } };
  const r = await init(post({ amount: 2500 }));
  const j = await bodyOf(r);
  assert.equal(r.status, 200);
  assert.equal(j.link, "https://checkout.flutterwave.com/pay/xyz");
  const sent = JSON.parse(fetchLog[0].init.body);
  assert.equal(sent.currency, "NGN");
  assert.equal(sent.amount, 2500);
  assert.equal(sent.tx_ref, "DG-" + "b".repeat(32));
  assert.equal(sent.redirect_url, "https://app.example.com/");
  assert.ok(!JSON.stringify(j).includes("FLWSECK"), "secret key never returned to the browser");
});
test("init: provider outage returns 502 without leaking details", async () => {
  flwOk = false; flwReply = { status: "error" };
  const r = await init(post({ amount: 1000 }));
  assert.equal(r.status, 502);
});

// ====================== helpers ======================
test("safeEqual and CORS", () => {
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(!safeEqual("abc", "abd"));
  assert.ok(!safeEqual("abc", "abcd"));
  assert.ok(!safeEqual("", "x"));
  const ok = corsHeaders(new Request("http://x", { headers: { Origin: "https://app.example.com" } })) as any;
  assert.equal(ok["Access-Control-Allow-Origin"], "https://app.example.com");
  const bad = corsHeaders(new Request("http://x", { headers: { Origin: "https://evil.example" } })) as any;
  assert.equal(bad["Access-Control-Allow-Origin"], "", "unknown origins are not allowed; never '*'");
});

// ====================== game server ======================
const act = (token: string, extra: any) => game(post({ match_id: M1, ...extra }, token));
const move = (token: string, m: any) => act(token, { action: "move", move: m });

test("game: unauthenticated / non-player / bad id / non-live tournament are refused", async () => {
  assert.equal((await act("nobody", { action: "get" })).status, 401);
  assert.equal((await act("tokC", { action: "get" })).status, 403);
  assert.equal((await game(post({ match_id: "../etc", action: "get" }))).status, 400);
  db.dg_tournaments[0].status = "open";
  assert.equal((await act("tokA", { action: "get" })).status, 409);
});
test("game: first 'get' creates authoritative state server-side and moves match to in_progress", async () => {
  const r = await act("tokA", { action: "get" });
  assert.equal(r.status, 200);
  const j = await bodyOf(r);
  assert.equal(j.myIndex, 0);
  assert.equal(db.dg_match_secrets.length, 1);
  assert.equal(db.dg_matches[0].status, "in_progress");
  assert.equal((await bodyOf(await act("tokB", { action: "get" }))).myIndex, 1);
});
test("game: server enforces turn order and legality", async () => {
  await act("tokA", { action: "get" });
  assert.equal((await move("tokB", { cell: 0 })).status, 422, "B cannot open");
  assert.equal((await move("tokA", { cell: 4 })).status, 200);
  assert.equal((await move("tokA", { cell: 0 })).status, 422, "A cannot move twice");
  assert.equal((await move("tokB", { cell: 4 })).status, 422, "occupied cell");
  assert.equal((await move("tokB", { cell: 99 })).status, 422, "out of range");
  assert.equal((await move("tokB", "garbage")).status, 422);
});
test("game: a win only PROPOSES a winner; match awaits admin approval; no more moves accepted", async () => {
  await act("tokA", { action: "get" });
  for (const [t, c] of [["tokA", 0], ["tokB", 3], ["tokA", 1], ["tokB", 4], ["tokA", 2]] as const) {
    assert.equal((await move(t, { cell: c })).status, 200);
  }
  const m = db.dg_matches[0];
  assert.equal(m.status, "awaiting_approval");
  assert.equal(m.proposed_winner_id, A);
  assert.equal(m.winner_id, undefined, "official winner is NOT set by the game server");
  const ver = db.dg_match_secrets[0].version;
  const late = await move("tokB", { cell: 8 });
  assert.equal(late.status, 200);
  assert.equal(db.dg_match_secrets[0].version, ver, "state unchanged after completion");
});
test("game: a draw restarts with sides swapped; after 3 draws an admin must decide", async () => {
  const DRAW = [0, 1, 2, 4, 3, 5, 7, 6, 8];
  await act("tokA", { action: "get" });
  for (let g = 0; g < 3; g++) {
    // game g: first mover alternates (draws % 2)
    const first = g % 2 === 0 ? "tokA" : "tokB";
    const second = first === "tokA" ? "tokB" : "tokA";
    let last: any;
    for (let i = 0; i < DRAW.length; i++) last = await move(i % 2 === 0 ? first : second, { cell: DRAW[i] });
    const j = await bodyOf(last);
    if (g < 2) {
      assert.equal(j.drawnAndRestarted, true, `draw ${g + 1} restarts`);
      assert.equal(db.dg_matches[0].status, "in_progress");
      assert.equal(db.dg_match_secrets[0].full_state.draws, g + 1);
    } else {
      assert.equal(db.dg_matches[0].status, "awaiting_approval");
      assert.equal(db.dg_matches[0].proposed_winner_id, null, "no winner proposed: admin decides");
    }
  }
});
test("game: hidden information never reaches the client (memory-match)", async () => {
  db.dg_matches[0].game = "memory-match";
  const r = await act("tokA", { action: "get" });
  const j = await bodyOf(r);
  assert.ok(j.public.view.cards.every((c: number) => c === -1), "all cards face down in response");
  assert.ok(db.dg_matches[0].game_state.view.cards.every((c: number) => c === -1), "and in the world-readable column");
  assert.ok(db.dg_match_secrets[0].full_state.state.cards.some((c: number) => c >= 0), "real values live only in the secrets table");
});
test("game: scramble answers never leave the server", async () => {
  db.dg_matches[0].game = "scramble";
  const j = await bodyOf(await act("tokA", { action: "get" }));
  const answers: string[] = db.dg_match_secrets[0].full_state.state.words;
  for (const w of answers) assert.ok(!JSON.stringify(j).includes(`"${w}"`) && !JSON.stringify(db.dg_matches[0].game_state).includes(`"${w}"`));
});
test("game: simultaneous moves hit the version check and get a retryable 409", async () => {
  await act("tokA", { action: "get" });
  failNextSave = true;
  const r = await move("tokA", { cell: 4 });
  assert.equal(r.status, 409);
  assert.match((await bodyOf(r)).error, /try again/);
});

test("game: race games are rate-limited per player (anti brute-force); the opponent is unaffected", async () => {
  db.dg_matches[0].game = "scramble";
  await act("tokA", { action: "get" });
  const realNow = Date.now;
  let t = 1_000_000;
  (Date as any).now = () => t;
  try {
    assert.equal((await move("tokA", { guess: "aaa" })).status, 200);
    t += 300;
    assert.equal((await move("tokA", { guess: "bbb" })).status, 429, "second guess within 1.5s is refused");
    assert.equal((await move("tokB", { guess: "ccc" })).status, 200, "other player has their own allowance");
    t += 1600;
    assert.equal((await move("tokA", { guess: "ddd" })).status, 200, "allowed again after the interval");
  } finally {
    (Date as any).now = realNow;
  }
});
