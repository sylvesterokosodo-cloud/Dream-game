import { supabase } from './supabase';

/** Must match public.dg_allowed_games() in the database. */
export const GAME_CATALOGUE = [
  { id: 'tic-tac-toe', label: 'Tic-Tac-Toe' },
  { id: 'connect-4', label: 'Connect 4' },
  { id: 'gomoku', label: 'Gomoku' },
  { id: 'memory-match', label: 'Memory Match' },
  { id: 'scramble', label: 'Scramble' },
  { id: 'puzzle', label: 'Puzzle' },
  { id: 'chess', label: 'Chess' },
] as const;

export type GameId = (typeof GAME_CATALOGUE)[number]['id'];

export const gameLabel = (id: string): string =>
  GAME_CATALOGUE.find((g) => g.id === id)?.label ?? id;

export type TournamentStatus =
  | 'draft'
  | 'open'
  | 'live'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type Tournament = {
  id: string;
  slug: string;
  name: string;
  description: string;
  prizeTitle: string;
  prizeDescription: string;
  prizeImage: string;
  prizeValue: number;
  prizeCoins: number;
  entryFee: number; // coins (1 coin = NGN 1)
  targetPlayers: number;
  entriesCount: number;
  games: string[];
  status: TournamentStatus;
  registrationDeadline: number | null;
  champion: string;
  createdAt: number;
  /** true when the signed-in user holds a non-refunded entry */
  joined: boolean;
};

type TournamentRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  prize_title: string;
  prize_description: string;
  prize_image_url: string | null;
  prize_value_ngn: number;
  prize_coins: number;
  entry_fee_coins: number;
  target_players: number;
  entries_count: number;
  games: string[];
  status: TournamentStatus;
  registration_deadline: string | null;
  champion_name: string | null;
  created_at: string;
};

const COLUMNS =
  'id,slug,title,description,prize_title,prize_description,prize_image_url,' +
  'prize_value_ngn,prize_coins,entry_fee_coins,target_players,entries_count,games,status,' +
  'registration_deadline,champion_name,created_at';

const fromRow = (r: TournamentRow, joined: boolean): Tournament => ({
  id: r.id,
  slug: r.slug,
  name: r.title,
  description: r.description,
  prizeTitle: r.prize_title,
  prizeDescription: r.prize_description,
  prizeImage: r.prize_image_url ?? '',
  prizeValue: Number(r.prize_value_ngn),
  prizeCoins: Number(r.prize_coins),
  entryFee: Number(r.entry_fee_coins),
  targetPlayers: r.target_players,
  entriesCount: r.entries_count,
  games: r.games,
  status: r.status,
  registrationDeadline: r.registration_deadline
    ? new Date(r.registration_deadline).getTime()
    : null,
  champion: r.champion_name ?? '',
  createdAt: new Date(r.created_at).getTime(),
  joined,
});

/** Public/own tournaments. RLS hides drafts from everyone except the admin. */
export async function fetchTournaments(userId?: string): Promise<Tournament[]> {
  const { data, error } = await supabase
    .from('dg_tournaments')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  let joinedIds = new Set<string>();
  if (userId) {
    const { data: mine, error: entryError } = await supabase
      .from('dg_tournament_entries')
      .select('tournament_id')
      .eq('user_id', userId)
      .neq('status', 'refunded');
    if (entryError) throw entryError;
    joinedIds = new Set((mine ?? []).map((m) => String(m.tournament_id)));
  }

  return ((data ?? []) as unknown as TournamentRow[]).map((r) =>
    fromRow(r, joinedIds.has(r.id))
  );
}

export async function fetchTournamentBySlug(
  slug: string,
  userId?: string
): Promise<Tournament | null> {
  const { data, error } = await supabase
    .from('dg_tournaments')
    .select(COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as TournamentRow;

  let joined = false;
  if (userId) {
    const { data: mine } = await supabase
      .from('dg_tournament_entries')
      .select('id')
      .eq('tournament_id', row.id)
      .eq('user_id', userId)
      .neq('status', 'refunded')
      .maybeSingle();
    joined = Boolean(mine);
  }
  return fromRow(row, joined);
}

/** Unique shareable link. Hash routing works on any static host. */
export const tournamentUrl = (slug: string): string =>
  `${window.location.origin}${window.location.pathname}#/t/${encodeURIComponent(slug)}`;

/** Server-evaluated. The UI uses this only to SHOW or HIDE admin controls. */
export async function fetchIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('dg_is_admin');
  if (error) return false;
  return data === true;
}

export type WalletSnapshot = { availableCoins: number; escrowedCoins: number };

export async function fetchWallet(userId: string): Promise<WalletSnapshot> {
  const { data, error } = await supabase
    .from('dg_wallets')
    .select('available_coins,escrowed_coins')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return {
    availableCoins: Number(data?.available_coins ?? 0),
    escrowedCoins: Number(data?.escrowed_coins ?? 0),
  };
}

export type CreateTournamentInput = {
  title: string;
  description: string;
  prizeTitle: string;
  prizeDescription: string;
  prizeImageUrl: string;
  prizeValueNgn: number;
  prizeCoins: number;
  entryFeeCoins: number;
  targetPlayers: number;
  games: string[];
  publish: boolean;
};

/** Authorisation is enforced inside the database function, not here. */
export async function adminCreateTournament(
  input: CreateTournamentInput
): Promise<{ id: string; slug: string; status: TournamentStatus }> {
  const { data, error } = await supabase.rpc('dg_admin_create_tournament', {
    p_title: input.title,
    p_description: input.description,
    p_prize_title: input.prizeTitle,
    p_prize_description: input.prizeDescription,
    p_prize_image_url: input.prizeImageUrl.trim() || null,
    p_prize_value_ngn: input.prizeValueNgn,
    p_entry_fee_coins: input.entryFeeCoins,
    p_target_players: input.targetPlayers,
    p_games: input.games,
    p_publish: input.publish,
    p_prize_coins: input.prizeCoins,
  });
  if (error) throw new Error(error.message);
  const row = data as { id: string; slug: string; status: TournamentStatus };
  return { id: row.id, slug: row.slug, status: row.status };
}

export async function adminPublishTournament(id: string): Promise<void> {
  const { error } = await supabase.rpc('dg_admin_publish_tournament', {
    p_tournament_id: id,
  });
  if (error) throw new Error(error.message);
}
