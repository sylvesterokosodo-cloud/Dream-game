
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
  entryFee: number;
  targetPlayers: number;
  entriesCount: number;
  games: string[];
  status: TournamentStatus;
  registrationDeadline: number | null;
  champion: string;
  createdAt: number;
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

    joinedIds = new Set(
      (mine ?? []).map((m) => String(m.tournament_id))
    );
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
    const { data: mine, error: entryError } = await supabase
      .from('dg_tournament_entries')
      .select('id')
      .eq('tournament_id', row.id)
      .eq('user_id', userId)
      .neq('status', 'refunded')
      .maybeSingle();

    if (entryError) throw entryError;

    joined = Boolean(mine);
  }

  return fromRow(row, joined);
}

/** Unique shareable link. Hash routing works on any static host. */
export const tournamentUrl = (slug: string): string =>
  `${window.location.origin}${window.location.pathname}#/t/${encodeURIComponent(slug)}`;

/**
 * Checks the current authenticated browser session against the
 * database administrator authorization function.
 *
 * Never grants admin access based on an email address in frontend code.
 */
export async function fetchIsAdmin(): Promise<boolean> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    console.error('[Dream Game Admin] Session error:', sessionError);
    throw new Error(`Could not read login session: ${sessionError.message}`);
  }

  if (!session) {
    console.info('[Dream Game Admin] No active session.');
    return false;
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error('[Dream Game Admin] User verification failed:', userError);
    throw new Error(`Could not verify login: ${userError.message}`);
  }

  if (!user || user.id !== session.user.id) {
    console.error('[Dream Game Admin] Session/user mismatch.');
    throw new Error('Your login session could not be verified. Please sign in again.');
  }

  console.info('[Dream Game Admin] Checking authorization for:', user.email);

  const { data, error } = await supabase.rpc('dg_is_admin');

  if (error) {
    console.error('[Dream Game Admin] RPC failed:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });

    throw new Error(`Admin authorization check failed: ${error.message}`);
  }

  if (typeof data !== 'boolean') {
    console.error('[Dream Game Admin] Unexpected RPC response:', data);
    throw new Error('The admin authorization function returned an unexpected response.');
  }

  console.info('[Dream Game Admin] Authorization result:', data);

  return data;
}

export type WalletSnapshot = {
  availableCoins: number;
  escrowedCoins: number;
};

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

/** Authorization is enforced inside the database function, not here. */
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

  const row = data as {
    id: string;
    slug: string;
    status: TournamentStatus;
  };

  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
  };
}

export async function adminPublishTournament(id: string): Promise<void> {
  const { error } = await supabase.rpc('dg_admin_publish_tournament', {
    p_tournament_id: id,
  });

  if (error) throw new Error(error.message);
}
