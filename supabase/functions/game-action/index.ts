// POST { match_id, action: "get" | "move", move? }  (JWT required)
// Server-authoritative: validates every move with the shared engines, keeps secrets
// (face-down cards, scramble answers) in dg_match_secrets, and only PROPOSES a winner.
// An administrator must approve the result (dg_admin_approve_result).
import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight, requireEnv } from "../_shared/http.ts";
import {
  applyMove, engineFor, MAX_DRAWS, newGame, publicGame,
  type FullGame, type Idx,
} from "../_shared/games/index.ts";

const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    const url = requireEnv("SUPABASE_URL");
    const userClient = createClient(url, requireEnv("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json(req, { error: "Please sign in" }, 401);

    const body = await req.json().catch(() => ({}));
    const matchId = String(body.match_id ?? "");
    const action = String(body.action ?? "get");
    if (!/^[0-9a-f-]{36}$/.test(matchId)) return json(req, { error: "Bad match id" }, 400);

    const sb = createClient(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: m } = await sb.from("dg_matches").select("*").eq("id", matchId).maybeSingle();
    if (!m || (m.player_a !== user.id && m.player_b !== user.id)) {
      return json(req, { error: "You are not a player in this match" }, 403);
    }
    const myIndex: Idx = m.player_a === user.id ? 0 : 1;
    const { data: t } = await sb.from("dg_tournaments").select("status").eq("id", m.tournament_id).single();
    if (t?.status !== "live") return json(req, { error: "Tournament is not live" }, 409);
    if (!["ready", "in_progress"].includes(m.status)) {
      return json(req, { myIndex, status: m.status, game: m.game, public: m.game_state });
    }

    // Load (or create) the authoritative state.
    const { data: sec } = await sb.from("dg_match_secrets").select("full_state,version").eq("match_id", matchId).maybeSingle();
    let full: FullGame;
    let version: number;
    if (sec) {
      full = sec.full_state as FullGame;
      version = sec.version;
    } else {
      full = newGame(m.game, randomSeed(), 0);
      const { error } = await sb.rpc("dg_system_save_game", {
        p_match: matchId, p_public: publicGame(m.game, full), p_full: full,
        p_expected: 0, p_proposed: null, p_needs_admin: false,
      });
      if (error && error.code !== "40001") return json(req, { error: error.message }, 409);
      const again = await sb.from("dg_match_secrets").select("full_state,version").eq("match_id", matchId).single();
      full = again.data!.full_state as FullGame;
      version = again.data!.version;
    }

    if (action === "get") {
      return json(req, { myIndex, status: m.status, game: m.game, public: publicGame(m.game, full) });
    }
    if (action !== "move") return json(req, { error: "Unknown action" }, 400);

    let next: FullGame;
    try {
      next = applyMove(m.game, full, body.move, myIndex);
    } catch (e) {
      return json(req, { error: (e as Error).message }, 422);
    }

    const engine = engineFor(m.game);
    const outcome = engine.outcome(next.state);
    let proposed: string | null = null;
    let needsAdmin = false;
    if (outcome.done) {
      if (outcome.winner === null) {
        if (next.draws + 1 < MAX_DRAWS) {
          next = newGame(m.game, randomSeed(), next.draws + 1); // rematch, first mover/colours swap
        } else {
          needsAdmin = true; // admin decides after repeated draws
        }
      } else {
        proposed = outcome.winner === 0 ? m.player_a : m.player_b;
      }
    }

    const pub = publicGame(m.game, next);
    const { error } = await sb.rpc("dg_system_save_game", {
      p_match: matchId, p_public: pub, p_full: next, p_expected: version,
      p_proposed: proposed, p_needs_admin: needsAdmin,
    });
    if (error) {
      const code = error.code === "40001" ? 409 : 400;
      return json(req, { error: error.code === "40001" ? "Opponent moved at the same time, try again" : error.message }, code);
    }
    return json(req, {
      myIndex,
      status: proposed || needsAdmin ? "awaiting_approval" : "in_progress",
      game: m.game,
      public: pub,
      drawnAndRestarted: outcome.done && outcome.winner === null && !needsAdmin,
    });
  } catch (e) {
    console.error("game-action", e);
    return json(req, { error: "Unexpected error" }, 500);
  }
});
