import { supabase } from './supabase';
import type { PublicGame } from '../../supabase/functions/_shared/games/index.ts';

export type { PublicGame };

async function invoke<T>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = await ctx.json();
        if (j?.error) msg = String(j.error);
      } catch {
        /* keep generic message */
      }
    }
    throw new Error(msg);
  }
  return data as T;
}

const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
};

// ---------- tournament actions (all rules enforced by SQL functions) ----------
export type ActionResult = { ok: boolean; started?: boolean; message: string };
export const joinTournament = (id: string) =>
  rpc<ActionResult>('dg_join_tournament', { p_tournament_id: id });
export const cancelEntry = (id: string) =>
  rpc<ActionResult>('dg_cancel_entry', { p_tournament_id: id });
export const runExpiry = async (): Promise<void> => {
  await supabase.rpc('dg_run_expiry'); // idempotent; also scheduled with pg_cron
};

// ---------- brackets ----------
export type Round = { id: string; roundNumber: number; status: string };
export type Match = {
  id: string;
  tournamentId: string;
  roundId: string;
  matchNumber: number;
  game: string;
  playerA: string | null;
  playerB: string | null;
  isBye: boolean;
  winnerId: string | null;
  proposedWinnerId: string | null;
  status: 'pending' | 'ready' | 'in_progress' | 'awaiting_approval' | 'completed';
  gameState: PublicGame | null;
};

type MatchRow = {
  id: string; tournament_id: string; round_id: string; match_number: number; game: string;
  player_a: string | null; player_b: string | null; is_bye: boolean; winner_id: string | null;
  proposed_winner_id: string | null; status: Match['status']; game_state: PublicGame | null;
};
const MATCH_COLS =
  'id,tournament_id,round_id,match_number,game,player_a,player_b,is_bye,winner_id,proposed_winner_id,status,game_state';
const toMatch = (r: MatchRow): Match => ({
  id: r.id, tournamentId: r.tournament_id, roundId: r.round_id, matchNumber: r.match_number,
  game: r.game, playerA: r.player_a, playerB: r.player_b, isBye: r.is_bye, winnerId: r.winner_id,
  proposedWinnerId: r.proposed_winner_id, status: r.status, gameState: r.game_state,
});

export async function fetchNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return {};
  const { data, error } = await supabase.from('dg_profiles').select('id,display_name').in('id', unique);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((p) => [String(p.id), String(p.display_name)]));
}

export async function fetchBracket(tournamentId: string) {
  const [r, m] = await Promise.all([
    supabase.from('dg_tournament_rounds').select('id,round_number,status')
      .eq('tournament_id', tournamentId).order('round_number'),
    supabase.from('dg_matches').select(MATCH_COLS)
      .eq('tournament_id', tournamentId).order('match_number'),
  ]);
  if (r.error) throw r.error;
  if (m.error) throw m.error;
  const matches = ((m.data ?? []) as unknown as MatchRow[]).map(toMatch);
  const rounds: Round[] = (r.data ?? []).map((x) => ({
    id: String(x.id), roundNumber: Number(x.round_number), status: String(x.status),
  }));
  const ids = matches.flatMap((x) => [x.playerA, x.playerB, x.winnerId].filter(Boolean) as string[]);
  return { rounds, matches, names: await fetchNames(ids) };
}

export async function fetchMatch(id: string): Promise<Match | null> {
  const { data, error } = await supabase.from('dg_matches').select(MATCH_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toMatch(data as unknown as MatchRow) : null;
}

// ---------- game server ----------
export type GameActionResponse = {
  myIndex: 0 | 1;
  status: Match['status'];
  game: string;
  public: PublicGame | null;
  drawnAndRestarted?: boolean;
};
export const gameGet = (matchId: string) =>
  invoke<GameActionResponse>('game-action', { match_id: matchId, action: 'get' });
export const gameMove = (matchId: string, move: unknown) =>
  invoke<GameActionResponse>('game-action', { match_id: matchId, action: 'move', move });

// ---------- wallet / payments ----------
export type LedgerRow = {
  id: string; type: string; availableDelta: number; escrowDelta: number; createdAt: number;
};
export async function fetchLedger(userId: string, limit = 30): Promise<LedgerRow[]> {
  const { data, error } = await supabase
    .from('dg_wallet_ledger')
    .select('id,entry_type,available_delta,escrow_delta,created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: String(r.id), type: String(r.entry_type),
    availableDelta: Number(r.available_delta), escrowDelta: Number(r.escrow_delta),
    createdAt: new Date(String(r.created_at)).getTime(),
  }));
}
export const startCheckout = (amount: number) =>
  invoke<{ link: string; tx_ref: string }>('flutterwave-init', { amount });
export const confirmPayment = (transactionId: string, txRef: string) =>
  invoke<{ ok: boolean; status: string; coins?: number; reason?: string }>('flutterwave-verify', {
    transaction_id: transactionId, tx_ref: txRef,
  });

// ---------- admin (authorisation enforced in SQL, not here) ----------
export const adminApproveResult = (matchId: string, winnerId: string) =>
  rpc<{ ok: boolean }>('dg_admin_approve_result', { p_match_id: matchId, p_winner: winnerId });
export const adminCancelTournament = (id: string, reason: string) =>
  rpc<{ ok: boolean }>('dg_admin_cancel_tournament', { p_tournament_id: id, p_reason: reason });
