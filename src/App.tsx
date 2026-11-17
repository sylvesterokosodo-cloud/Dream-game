import { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';
import {
  Trophy,
  Crown,
  Gamepad2,
  Wallet,
  Users,
  Plus,
  Clock3,
  Sparkles,
  ArrowUpRight,
  ShieldCheck,
  Swords,
  Medal,
  Dice5,
  CircleDot,
  ChevronRight,
  X,
  CheckCircle2,
  AlertTriangle,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  Zap,
  Gift,
  UserRound,
  Ticket,
  ListOrdered,
  Share2,
} from 'lucide-react';

type Tournament = {
  id: string;
  name: string;
  game: string;
  games?: string[];
  entryFee: number;
  targetPlayers: number;
  prizeTitle: string;
  prizeDescription: string;
  prizeImage?: string;
  prizeValue: number;
  status: 'open' | 'locked' | 'live' | 'completed' | 'failed';
  createdAt: number;
  deadline: number;
  players: string[];
  rounds: Array<{
    number: number;
    matches: Array<{
      id: string;
      a: string;
      b: string;
      game: string;
      winner?: string;
      isBotMatch?: boolean;
    }>;
  }>;
  champion?: string;
};

type Profile = {
  id: string;
  email?: string;
  name: string;
  balance: number;
  reserved: number;
};

const GAMES = [
  'Tic-Tac-Toe',
  'Rock Paper Scissors',
  'Connect 4',
  'Higher or Lower Dice',
  'Gomoku',
  'Memory Match',
];

const money = (n: number) =>
  '₦' + Math.max(0, n).toLocaleString('en-NG');

const demoProfile: Profile = {
  id: 'demo-player-001',
  name: 'Player One',
  balance: 25000,
  reserved: 0,
};

function App() {
  const [tab, setTab] = useState<
    'play' | 'wallet' | 'brackets' | 'winners' | 'admin'
  >('play');

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [profile, setProfile] = useState<Profile>({
    id: '',
    email: '',
    name: 'Guest',
    balance: 0,
    reserved: 0,
  });

  const [authenticated, setAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  const [notice, setNotice] = useState(
    'Welcome to Dream Game. Sign in to join tournaments and access your wallet.'
  );

  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Tournament | null>(null);
  const [demoAmount, setDemoAmount] = useState('5000');

  const [form, setForm] = useState({
    name: '',
    game: GAMES[0],
    games: [...GAMES],
    entryFee: '1000',
    targetPlayers: '16',
    prizeTitle: '',
    prizeDescription: '',
    prizeImage: '',
    prizeValue: '50000',
  });

  const [adminOpen, setAdminOpen] = useState(false);

  const isAdmin =
    profile.id !== '' &&
    profile.email?.toLowerCase() === 'sylvesterokosodo@gmail.com';

  const load = async () => {
    try {
      const { data: tournamentRows, error: tournamentError } =
        await supabase
          .from('dg_tournaments')
          .select('*')
          .order('created_at', { ascending: false });

      if (tournamentError) throw tournamentError;

      const { data: entryRows } = await supabase
        .from('dg_tournament_entries')
        .select('*');

      const entriesByTournament = new Map<string, any[]>();

      (entryRows || []).forEach((entry: any) => {
        const key = String(entry.tournament_id || '');

        if (!entriesByTournament.has(key)) {
          entriesByTournament.set(key, []);
        }

        entriesByTournament.get(key)!.push(entry);
      });

      const mapped: Tournament[] = (tournamentRows || [])
        .filter(
          (row: any) =>
            row.status !== 'draft' && row.status !== 'cancelled'
        )
        .map((row: any) => {
          const entries =
            entriesByTournament.get(String(row.id)) || [];

          const rawDescription = String(row.description || '');
          let meta: any = {};

          const marker = '\n\n[DG_META]';
          const markerAt = rawDescription.indexOf(marker);

          if (markerAt >= 0) {
            try {
              meta = JSON.parse(
                rawDescription.slice(markerAt + marker.length)
              );
            } catch {
              meta = {};
            }
          }

          const game = String(row.game_type || 'Tic-Tac-Toe');
          const dbStatus = String(row.status || 'published');

          const status: Tournament['status'] =
            dbStatus === 'live' || dbStatus === 'started'
              ? 'live'
              : dbStatus === 'completed'
                ? 'completed'
                : dbStatus === 'cancelled'
                  ? 'failed'
                  : dbStatus === 'locked'
                    ? 'locked'
                    : 'open';

          return {
            id: String(row.id),
            name: String(row.title || 'Dream Tournament'),
            game,
            games: Array.isArray(meta.games) ? meta.games : [game],
            entryFee: Number(row.entry_fee || 0),
            targetPlayers: Number(row.max_players || 0),
            prizeTitle: String(meta.prizeTitle || 'Tournament prize'),
            prizeDescription: String(
              meta.prizeDescription ||
                rawDescription.split(marker)[0] ||
                ''
            ),
            prizeImage: meta.prizeImage || '',
            prizeValue: Number(row.prize_pool || 0),
            status,
            createdAt: row.created_at
              ? new Date(row.created_at).getTime()
              : Date.now(),
            deadline: row.start_at
              ? new Date(row.start_at).getTime()
              : Date.now(),
            players: entries.map((entry: any) =>
              String(
                entry.user_id ||
                  entry.player_id ||
                  entry.id ||
                  ''
              )
            ),
            rounds: [],
            champion: row.winner_name || '',
          };
        });

      setTournaments(mapped);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profileRow } = await supabase
          .from('dg_profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        let walletRow: any = null;

        const walletByUser = await supabase
          .from('dg_wallets')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (!walletByUser.error) {
          walletRow = walletByUser.data;
        }

        if (!walletRow) {
          const walletById = await supabase
            .from('dg_wallets')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

          walletRow = walletById.data;
        }

        setProfile({
          id: user.id,
          email: user.email || '',
          name: String(
            profileRow?.display_name ||
              profileRow?.name ||
              user.user_metadata?.display_name ||
              user.email?.split('@')[0] ||
              'Player'
          ),
          balance: Number(
            walletRow?.balance ?? walletRow?.coin_balance ?? 0
          ),
          reserved: Number(
            walletRow?.reserved_balance ??
              walletRow?.reserved ??
              0
          ),
        } as Profile);

        setAuthenticated(true);
      } else {
        setAuthenticated(false);

        setProfile({
          id: '',
          name: 'Guest',
          balance: 0,
          reserved: 0,
          email: '',
        } as Profile);
      }
    } catch (error) {
      console.error('Dream Game load error:', error);
      setNotice(
        'Unable to load Dream Game data. Please refresh.'
      );
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submitAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);

    try {
      if (authMode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail.trim().toLowerCase(),
          password: authPassword,
          options: {
            data: {
              display_name: authName.trim(),
            },
          },
        });

        if (error) throw error;

        if (data.user && data.session) {
          const { error: profileError } = await supabase
            .from('dg_profiles')
            .upsert(
              {
                id: data.user.id,
                display_name: authName.trim(),
              },
              { onConflict: 'id' }
            );

          if (profileError) {
            console.warn(
              'Profile row will be created by database trigger if configured:',
              profileError.message
            );
          }

          setNotice('Account created. Welcome to Dream Game.');
        } else {
          setNotice(
            'Registration received. Check your email to confirm your account, then log in.'
          );
        }
      } else {
        const { error } =
          await supabase.auth.signInWithPassword({
            email: authEmail.trim().toLowerCase(),
            password: authPassword,
          });

        if (error) throw error;

        setNotice('You are signed in.');
      }

      setAuthPassword('');
      await load();
    } catch (error: any) {
      setNotice(
        error?.message || 'Could not complete account access.'
      );
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();

    setAuthenticated(false);

    setProfile({
      id: '',
      name: 'Guest',
      balance: 0,
      reserved: 0,
      email: '',
    } as Profile);

    setAuthPassword('');
    setNotice('You have been logged out.');
  };

  const shareApp = async () => {
    const invite = {
      title: 'Dream Game',
      text:
        'Join me on Dream Game. Discover tournaments, compete and win prizes.',
      url: window.location.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(invite);
        setNotice('Dream Game invite shared successfully.');
      } else {
        await navigator.clipboard.writeText(invite.url);
        setNotice(
          'Dream Game link copied. Share it with your friends.'
        );
      }
    } catch {
      try {
        await navigator.clipboard.writeText(invite.url);
        setNotice(
          'Dream Game link copied. Share it with your friends.'
        );
      } catch {
        setNotice('Share this Dream Game link: ' + invite.url);
      }
    }
  };

  const live = useMemo(
    () => tournaments.filter((t) => t.status === 'live'),
    [tournaments]
  );

  const open = useMemo(
    () => tournaments.filter((t) => t.status === 'open'),
    [tournaments]
  );

  const winners = useMemo(
    () => tournaments.filter((t) => t.status === 'completed'),
    [tournaments]
  );

  const act = async (path: string, body?: unknown) => {
    setNotice(
      'This action is not yet connected to a supported Dream Game operation.'
    );
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAdmin) {
      setNotice('Only the authorised administrator can create tournaments.');
      return;
    }

    setBusy(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('Please sign in before creating a tournament.');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-tournament`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            title: form.name,
            description:
              `${form.prizeDescription}\n\n[DG_META]` +
              JSON.stringify({
                games: form.games,
                prizeTitle: form.prizeTitle,
                prizeDescription: form.prizeDescription,
                prizeImage: form.prizeImage,
              }),
            game_type: form.games.join(', '),
            entry_fee: Number(form.entryFee),
            prize_pool: Number(form.prizeValue),
            max_players: Number(form.targetPlayers),
            status: 'draft',
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || 'Could not create tournament.'
        );
      }

      setNotice('Tournament created successfully.');
      setShowCreate(false);

      setForm({
        name: '',
        game: GAMES[0],
        games: [...GAMES],
        entryFee: '1000',
        targetPlayers: '16',
        prizeTitle: '',
        prizeDescription: '',
        prizeImage: '',
        prizeValue: '50000',
      });

      await load();
    } catch (error: any) {
      setNotice(
        error?.message || 'Could not create tournament.'
      );
    } finally {
      setBusy(false);
    }
  };

  const join = async (t: Tournament) => {
    if (!authenticated) {
      setNotice('Please log in before joining a tournament.');
      return;
    }

    setBusy(true);

    try {
      const { error } = await supabase.rpc(
        'dg_join_tournament',
        {
          p_tournament_id: t.id,
        }
      );

      if (error) throw error;

      setNotice('You have joined the tournament.');
      await load();
    } catch (error: any) {
      setNotice(
        error?.message || 'Could not join this tournament.'
      );
    } finally {
      setBusy(false);
    }
  };

  const credit = async (e: React.FormEvent) => {
    e.preventDefault();

    setNotice(
      'Demo wallet credits are disabled. Connect a verified payment provider before adding funds.'
    );
  };

  const status = (s: Tournament['status']) =>
    ({
      open: 'OPEN',
      locked: 'LOCKED',
      live: 'LIVE',
      completed: 'COMPLETED',
      failed: 'REFUNDED',
    })[s];

  const [gameModal, setGameModal] = useState(false);
  const [gameChoice, setGameChoice] = useState('Tic-Tac-Toe');
  const [tic, setTic] = useState<string[]>(Array(9).fill(''));
  const [turn, setTurn] = useState('X');

  const resetTic = () => {
    setTic(Array(9).fill(''));
    setTurn('X');
  };

  const ticWinner = () => {
    const lines = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ];

    for (const [a, b, c] of lines) {
      if (tic[a] && tic[a] === tic[b] && tic[a] === tic[c]) {
        return tic[a];
      }
    }

    return tic.every(Boolean) ? 'DRAW' : '';
  };

  const playCell = (i: number) => {
    if (tic[i] || ticWinner()) return;

    const n = [...tic];
    n[i] = turn;

    setTic(n);
    setTurn(turn === 'X' ? 'O' : 'X');
  };

  return (
    <div className="app-shell">
      <header className="header">
        <div className="brand">
          <div className="brand-icon">
            <Crown size={25} />
          </div>
          <div>
            <strong>
              DREAM <span>GAME</span>
            </strong>
            <small>YOUR NEXT WIN STARTS HERE</small>
          </div>
        </div>

        <div className="header-right">
          <span className="demo-label">
            <i />{' '}
            {authenticated
              ? `SIGNED IN · ${profile.name}`
              : 'WELCOME'}
          </span>

          <button
            className="btn-outline compact"
            onClick={shareApp}
          >
            <Share2 size={15} /> Share app
          </button>

          {authenticated && (
            <button
              className="btn-outline compact"
              onClick={logout}
            >
              <LogOut size={15} /> Log out
            </button>
          )}

          <button
            className="balance"
            onClick={() => setTab('wallet')}
          >
            <Wallet size={16} />
            {money(profile.balance)}
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-content">
            <div className="kicker">
              <span /> THE NEXT CHAMPION COULD BE YOU
            </div>

            <h1>
              Play your game.
              <br />
              <em>Make your dream.</em>
            </h1>

            <p>
              Enter head-to-head challenges, rise through the rounds and
              become the name everyone remembers.
            </p>

            <div className="hero-buttons">
              <button
                className="btn-primary"
                onClick={() => setTab('play')}
              >
                Find a tournament <ArrowUpRight size={17} />
              </button>

              <button
                className="btn-outline"
                onClick={() => setTab('winners')}
              >
                Meet the winners
              </button>
            </div>

            <div className="hero-note">
              <ShieldCheck size={15} /> Fair-play rules. Recorded rounds.
              Public champions.
            </div>
          </div>

          <div className="dream-visual">
            <div className="glow" />
            <div className="ring r1" />
            <div className="ring r2" />
            <div className="emblem">
              <Crown size={86} />
              <span>D</span>
            </div>

            <div className="orbit-tag tag-a">
              <Swords size={16} /> HEAD TO HEAD
            </div>

            <div className="orbit-tag tag-b">
              <Trophy size={16} /> WIN THE PRIZE
            </div>

            <div className="spark s1">✦</div>
            <div className="spark s2">✧</div>
          </div>
        </section>

        <div className="announcement">
          <ShieldCheck size={17} />
          <span>{notice}</span>

          <button
            onClick={() =>
              setNotice(
                'Payments are not connected yet. Wallet funding and withdrawals will be enabled after payment integration.'
              )
            }
          >
            INFO
          </button>
        </div>

        <section className="metrics">
          <div>
            <small>OPEN TO JOIN</small>
            <b>{String(open.length).padStart(2, '0')}</b>
            <span>Find your match</span>
          </div>

          <div>
            <small>LIVE TOURNAMENTS</small>
            <b>{String(live.length).padStart(2, '0')}</b>
            <span>Competition underway</span>
          </div>

          <div>
            <small>CHAMPIONS</small>
            <b>{String(winners.length).padStart(2, '0')}</b>
            <span>Dreams achieved</span>
          </div>

          <div>
            <small>AVAILABLE BALANCE</small>
            <b>{money(profile.balance)}</b>
            <span>Your wallet balance</span>
          </div>
        </section>

        <nav className="tabs">
          {(
            [
              { id: 'play', label: 'Discover', icon: Gamepad2 },
              { id: 'wallet', label: 'My Wallet', icon: Wallet },
              { id: 'brackets', label: 'Brackets', icon: ListOrdered },
              { id: 'winners', label: 'Winners', icon: Trophy },
            ] as const
          ).map((x) => (
            <button
              key={x.id}
              className={tab === x.id ? 'active' : ''}
              onClick={() => setTab(x.id)}
            >
              <x.icon size={17} />
              {x.label}
            </button>
          ))}

          {isAdmin && (
            <button
              className={tab === 'admin' ? 'active' : ''}
              onClick={() => setTab('admin')}
            >
              <LayoutDashboard size={17} />
              Admin
            </button>
          )}
        </nav>

        {tab === 'play' && (
          <section className="section">
            <div className="section-head">
              <div>
                <div className="eyebrow">THE ARENA</div>
                <h2>Dream tournaments</h2>
                <p>
                  Choose your challenge. Every tournament shows its prize
                  before you enter.
                </p>
              </div>

              <button
                className="btn-outline compact"
                onClick={load}
              >
                <RefreshCw size={15} /> Refresh
              </button>
            </div>

            {open.length === 0 ? (
              <div className="empty">
                <Gamepad2 size={30} />
                <h3>No open tournaments yet</h3>
                <p>Check back soon for the next challenge.</p>
              </div>
            ) : (
              <div className="tournament-grid">
                {open.map((t) => (
                  <article className="tournament-card" key={t.id}>
                    <div className="prize-visual">
                      {t.prizeImage ? (
                        <img
                          src={t.prizeImage}
                          alt={t.prizeTitle}
                        />
                      ) : (
                        <div className="prize-fallback">
                          <Gift size={48} />
                          <span>PRIZE DROP</span>
                        </div>
                      )}

                      <span className="status-badge">
                        {status(t.status)}
                      </span>
                    </div>

                    <div className="card-body">
                      <div className="game-label">
                        {(t.games?.length ? t.games : [t.game]).join(' · ')}
                      </div>

                      <h3>{t.name}</h3>
                      <p>{t.prizeTitle}</p>
                      <p className="muted">{t.prizeDescription}</p>

                      <div className="prize-value">
                        <span>PRIZE VALUE</span>
                        <b>{money(t.prizeValue)}</b>
                      </div>

                      <div className="card-facts">
                        <span>
                          <Ticket size={14} />
                          {money(t.entryFee)} entry
                        </span>

                        <span>
                          <Users size={14} />
                          {t.players.length}/{t.targetPlayers}
                        </span>
                      </div>

                      <div className="deadline">
                        <Clock3 size={14} /> Registration deadline
                      </div>

                      <button
                        className="join-btn"
                        disabled={
                          busy || t.players.includes(profile.id)
                        }
                        onClick={() => join(t)}
                      >
                        {t.players.includes(profile.id)
                          ? 'Already entered'
                          : 'Join tournament'}
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'wallet' && (
          <section className="section wallet-section">
            <div className="section-head">
              <div>
                <div className="eyebrow">PLAYER ACCOUNT</div>
                <h2>Your Dream Wallet</h2>
                <p>
                  See your available and reserved balances separately.
                </p>
              </div>
            </div>

            <div className="wallet-cards">
              <div className="wallet-main">
                <Wallet size={23} />
                <small>AVAILABLE BALANCE</small>
                <strong>{money(profile.balance)}</strong>
                <span>Wallet balance</span>
              </div>

              <div className="wallet-secondary">
                <small>RESERVED FOR ENTRIES</small>
                <b>{money(profile.reserved || 0)}</b>
                <p>Reserved tournament entry amounts</p>
              </div>

              <div className="wallet-secondary">
                <small>WITHDRAWALS</small>
                <b>Not connected</b>
                <p>Payment provider setup pending</p>
              </div>
            </div>

            <form
              className="credit-form"
              onSubmit={credit}
            >
              <h3>Wallet funding</h3>
              <p>
                Wallet deposits will be enabled after payment integration.
                No real-money deposits are currently processed.
              </p>

              <div className="inline-field">
                <span>₦</span>
                <input
                  value={demoAmount}
                  onChange={(e) => setDemoAmount(e.target.value)}
                  type="number"
                  min="100"
                  disabled
                />
                <button disabled type="button">
                  Coming soon
                </button>
              </div>
            </form>
          </section>
        )}

        {tab === 'brackets' && (
          <section className="section">
            <div className="section-head">
              <div>
                <div className="eyebrow">THE ROAD TO GLORY</div>
                <h2>Tournament brackets</h2>
                <p>Follow each pairing and see who advances.</p>
              </div>
            </div>

            {tournaments.filter((t) => t.rounds?.length).length === 0 ? (
              <div className="empty">
                <Swords size={30} />
                <h3>No brackets generated yet</h3>
                <p>
                  Pairings appear when the administrator generates the
                  tournament rounds.
                </p>
              </div>
            ) : (
              tournaments
                .filter((t) => t.rounds?.length)
                .map((t) => (
                  <div className="bracket-card" key={t.id}>
                    <h3>{t.name}</h3>

                    <p>
                      {t.games?.length
                        ? t.games.join(' · ')
                        : t.game}{' '}
                      · {status(t.status)}
                    </p>

                    {t.rounds.map((r) => (
                      <div className="round" key={r.number}>
                        <b>ROUND {r.number}</b>

                        {r.matches.map((m) => (
                          <div className="match" key={m.id}>
                            <span>{m.a}</span>
                            <span className="match-game">
                              {m.game || t.game}
                            </span>
                            <span>VS</span>
                            <span>
                              {m.b}
                              {m.isBotMatch ? ' · HOUSE BOT' : ''}
                            </span>
                            <small>
                              {m.winner
                                ? 'Winner: ' + m.winner
                                : 'Awaiting result'}
                            </small>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))
            )}
          </section>
        )}

        {tab === 'winners' && (
          <section className="section">
            <div className="section-head">
              <div>
                <div className="eyebrow">HALL OF DREAMS</div>
                <h2>Our champions</h2>
                <p>
                  Every completed tournament celebrates its winner.
                </p>
              </div>
            </div>

            {winners.length === 0 ? (
              <div className="empty">
                <Medal size={30} />
                <h3>The first champion is waiting</h3>
                <p>
                  Completed tournaments and prize details will appear here.
                </p>
              </div>
            ) : (
              winners.map((t) => (
                <article className="winner-card" key={t.id}>
                  <div className="winner-medal">
                    <Trophy size={31} />
                  </div>

                  <div>
                    <small>TOURNAMENT CHAMPION</small>
                    <h3>{t.champion || 'Champion'}</h3>
                    <p>
                      {t.name} · {t.prizeTitle}
                    </p>
                    <b>{money(t.prizeValue)} prize value</b>
                  </div>

                  <span className="champion-tag">CROWNED</span>
                </article>
              ))
            )}
          </section>
        )}

        {tab === 'admin' && isAdmin && (
          <section className="section">
            <div className="section-head">
              <div>
                <div className="eyebrow">CONTROL ROOM</div>
                <h2>Tournament manager</h2>
                <p>
                  Create events, set prizes and control the competition.
                </p>
              </div>

              <button
                className="btn-primary compact"
                onClick={() => setShowCreate(true)}
              >
                <Plus size={16} /> Create tournament
              </button>
            </div>

            <div className="admin-warning">
              <ShieldCheck size={18} />
              <span>
                Administrator access is restricted to the authorised
                Dream Game account.
              </span>
            </div>

            <div className="admin-list">
              {tournaments.map((t) => (
                <div className="admin-row" key={t.id}>
                  <div>
                    <b>{t.name}</b>
                    <span>
                      {t.game} · {t.players.length}/{t.targetPlayers} players
                      · {money(t.entryFee)} entry
                    </span>
                  </div>

                  <span className={'status-text ' + t.status}>
                    {status(t.status)}
                  </span>

                  <button
                    onClick={() =>
                      setNotice(
                        'Tournament status management will be connected to the admin controls next.'
                      )
                    }
                    disabled={busy || t.status !== 'open'}
                  >
                    Start
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="games-strip">
          <div>
            <div className="eyebrow">PICK YOUR PLAYSTYLE</div>
            <h2>Games in the arena</h2>
            <p>Fast rounds, head-to-head focus.</p>
          </div>

          <div className="game-chips">
            {GAMES.map((g, i) => (
              <button
                key={g}
                onClick={() => {
                  setGameChoice(g);
                  setGameModal(true);
                }}
              >
                {i === 3 ? (
                  <Dice5 size={16} />
                ) : (
                  <CircleDot size={16} />
                )}{' '}
                {g}
              </button>
            ))}
          </div>
        </section>
      </main>

      <footer>
        <div className="brand footer-brand">
          <div className="brand-icon">
            <Crown size={20} />
          </div>

          <div>
            <strong>
              DREAM <span>GAME</span>
            </strong>
            <small>YOUR NEXT WIN STARTS HERE</small>
          </div>
        </div>

        <p>Play smart. Compete fairly. Dream bigger.</p>
        <small>
          Dream Game · Wallet payments are not yet connected
        </small>
      </footer>

      {showCreate && isAdmin && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={create}>
            <div className="modal-head">
              <div>
                <div className="eyebrow">NEW CHALLENGE</div>
                <h2>Create tournament</h2>
              </div>

              <button
                type="button"
                onClick={() => setShowCreate(false)}
              >
                <X />
              </button>
            </div>

            <label>
              Tournament name
              <input
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                required
                placeholder="e.g. Weekend Dream Cup"
              />
            </label>

            <div className="game-pool-field">
              <strong>Games included in this tournament</strong>
              <p>
                Games will be assigned to tournament matches.
              </p>

              <div className="game-pool-options">
                {GAMES.map((g) => (
                  <label key={g} className="game-pool-option">
                    <input
                      type="checkbox"
                      checked={form.games.includes(g)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          games: e.target.checked
                            ? [...form.games, g]
                            : form.games.filter((x) => x !== g),
                        })
                      }
                    />
                    {g}
                  </label>
                ))}
              </div>

              <small>Select at least two games.</small>
            </div>

            <div className="form-row">
              <label>
                Entry fee (₦)
                <input
                  type="number"
                  min="1"
                  value={form.entryFee}
                  onChange={(e) =>
                    setForm({ ...form, entryFee: e.target.value })
                  }
                  required
                />
              </label>

              <label>
                Players needed
                <input
                  type="number"
                  min="2"
                  max="512"
                  value={form.targetPlayers}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      targetPlayers: e.target.value,
                    })
                  }
                  required
                />
              </label>
            </div>

            <label>
              Prize name
              <input
                value={form.prizeTitle}
                onChange={(e) =>
                  setForm({ ...form, prizeTitle: e.target.value })
                }
                required
                placeholder="e.g. Latest smartphone"
              />
            </label>

            <label>
              Prize description
              <textarea
                value={form.prizeDescription}
                onChange={(e) =>
                  setForm({
                    ...form,
                    prizeDescription: e.target.value,
                  })
                }
                required
                placeholder="Describe the prize and what the winner receives"
              />
            </label>

            <label>
              Prize picture URL
              <input
                value={form.prizeImage}
                onChange={(e) =>
                  setForm({ ...form, prizeImage: e.target.value })
                }
                placeholder="https://..."
              />
            </label>

            <label>
              Estimated prize value (₦)
              <input
                type="number"
                min="0"
                value={form.prizeValue}
                onChange={(e) =>
                  setForm({ ...form, prizeValue: e.target.value })
                }
                required
              />
            </label>

            <div className="form-note">
              <Clock3 size={15} /> Tournament registration and entry
              settings will be applied when the tournament is published.
            </div>

            <button
              className="btn-primary submit"
              disabled={
                busy ||
                form.games.length < 2 ||
                !form.name.trim()
              }
            >
              {busy ? 'Creating...' : 'Create tournament'}{' '}
              <ArrowUpRight size={16} />
            </button>
          </form>
        </div>
      )}

      {gameModal && (
        <div className="modal-backdrop">
          <div className="modal game-modal">
            <div className="modal-head">
              <div>
                <div className="eyebrow">QUICK PLAY DEMO</div>
                <h2>{gameChoice}</h2>
              </div>

              <button onClick={() => setGameModal(false)}>
                <X />
              </button>
            </div>

            {gameChoice === 'Tic-Tac-Toe' ? (
              <>
                <p className="muted">
                  Local two-player practice board. X and O take turns
                  on this device.
                </p>

                <div className="tic-grid">
                  {tic.map((v, i) => (
                    <button
                      key={i}
                      onClick={() => playCell(i)}
                      disabled={Boolean(v) || Boolean(ticWinner())}
                    >
                      {v}
                    </button>
                  ))}
                </div>

                <div className="game-result">
                  {ticWinner()
                    ? ticWinner() === 'DRAW'
                      ? 'It is a draw.'
                      : ticWinner() + ' wins!'
                    : 'Next move: ' + turn}
                </div>

                <button
                  className="btn-outline compact"
                  onClick={resetTic}
                >
                  Reset board
                </button>
              </>
            ) : (
              <div className="empty compact-empty">
                <Gamepad2 size={28} />
                <p>
                  This game is listed in the tournament catalogue.
                  Its live multiplayer engine is still being developed.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {!authenticated && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(4,15,11,.94)',
            backdropFilter: 'blur(12px)',
            display: 'grid',
            placeItems: 'center',
            padding: 20,
          }}
        >
          <form
            className="modal"
            onSubmit={submitAuth}
            style={{
              width: 'min(100%,460px)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div className="brand" style={{ marginBottom: 24 }}>
              <div className="brand-icon">
                <Crown size={25} />
              </div>

              <div>
                <strong>
                  DREAM <span>GAME</span>
                </strong>
                <small>YOUR NEXT WIN STARTS HERE</small>
              </div>
            </div>

            <div className="eyebrow">YOUR OWN PLAYER ACCOUNT</div>

            <h2>
              {authMode === 'register'
                ? 'Create your account'
                : 'Welcome back'}
            </h2>

            <p className="muted">
              Each player gets a separate profile and wallet.
              Register with your email and password.
            </p>

            {authMode === 'register' && (
              <label>
                Your display name
                <input
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  placeholder="e.g. Tunde"
                  required
                  maxLength={48}
                />
              </label>
            )}

            <label>
              Email address
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>

            <label>
              Password
              <input
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                type="password"
                minLength={8}
                autoComplete={
                  authMode === 'register'
                    ? 'new-password'
                    : 'current-password'
                }
                placeholder="At least 8 characters"
                required
              />
            </label>

            <button
              className="btn-primary"
              type="submit"
              disabled={busy}
              style={{
                width: '100%',
                justifyContent: 'center',
                marginTop: 12,
              }}
            >
              {busy
                ? 'Please wait…'
                : authMode === 'register'
                  ? 'Create my account'
                  : 'Log in'}
            </button>

            <button
              type="button"
              className="btn-outline"
              style={{
                width: '100%',
                justifyContent: 'center',
                marginTop: 10,
              }}
              onClick={() =>
                setAuthMode(
                  authMode === 'register' ? 'login' : 'register'
                )
              }
            >
              {authMode === 'register'
                ? 'Already have an account? Log in'
                : 'New to Dream Game? Create account'}
            </button>

            <p
              className="muted"
              style={{ fontSize: 12, marginTop: 16 }}
            >
              Email confirmation may be required. Wallet funding
              and withdrawals are not yet active.
            </p>

            <p
              style={{
                fontSize: 13,
                color: 'var(--muted)',
                marginTop: 8,
              }}
            >
              {notice}
            </p>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
