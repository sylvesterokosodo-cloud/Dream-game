
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Clock,
  Crown,
  Gamepad2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

type TournamentRow = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  game_type: string | null;
  entry_fee: number | string | null;
  prize_pool: number | string | null;
  max_players: number | null;
  status: string;
  start_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type Props = {
  tournaments?: unknown[];
  onRefresh?: () => Promise<void> | void;
  notify?: (message: string) => void;
};

const GAMES = [
  { id: 'tic-tac-toe', name: 'Tic-Tac-Toe', icon: '⭕', description: 'Think ahead. Win the board.' },
  { id: 'connect-4', name: 'Connect 4', icon: '🔴', description: 'Connect four to claim victory.' },
  { id: 'gomoku', name: 'Gomoku', icon: '⚫', description: 'Strategy meets precision.' },
  { id: 'memory-match', name: 'Memory Match', icon: '🧠', description: 'Test your memory.' },
  { id: 'scramble', name: 'Scramble', icon: '🔤', description: 'Find the words. Beat the clock.' },
  { id: 'puzzle', name: 'Puzzle', icon: '🧩', description: 'Solve it faster than your rivals.' },
  { id: 'chess', name: 'Chess', icon: '♟️', description: 'Make every move count.' },
];

const money = (value: number | string | null | undefined) =>
  `₦${Number(value ?? 0).toLocaleString('en-NG')}`;

const dateLabel = (value: string | null) => {
  if (!value) return 'Schedule to be announced';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Schedule to be announced';
  return date.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const statusLabel = (status: string) => {
  const value = status.toLowerCase();
  if (value === 'open' || value === 'published') return 'Open for players';
  if (value === 'live' || value === 'active') return 'Live now';
  if (value === 'completed') return 'Completed';
  if (value === 'cancelled') return 'Cancelled';
  return status || 'Upcoming';
};

export default function DiscoverPage({ notify }: Props) {
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [coinBalance, setCoinBalance] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const loadHomepage = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) throw authError;

      setUserId(user?.id ?? null);

      const tournamentRequest = supabase
        .from('dg_tournaments')
        .select(
          'id,title,slug,description,game_type,entry_fee,prize_pool,max_players,status,start_at,created_by,created_at,updated_at'
        )
        .order('created_at', { ascending: false })
        .limit(30);

      const [tournamentResult, walletResult] = await Promise.all([
        tournamentRequest,
        user
          ? supabase
              .from('dg_wallets')
              .select('coin_balance')
              .eq('user_id', user.id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (tournamentResult.error) throw tournamentResult.error;
      if (walletResult.error) throw walletResult.error;

      setTournaments((tournamentResult.data ?? []) as TournamentRow[]);
      setCoinBalance(Number(walletResult.data?.coin_balance ?? 0));
    } catch (err) {
      console.error('[Dream Game Homepage]', err);
      const message =
        err instanceof Error ? err.message : 'Unable to load homepage data.';
      setError(message);
      notify?.('Some Dream Game information could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadHomepage();

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      queueMicrotask(() => void loadHomepage());
    });

    return () => listener.subscription.unsubscribe();
  }, [loadHomepage]);

  const filteredTournaments = useMemo(() => {
    return tournaments.filter((t) => {
      const text = `${t.title} ${t.game_type ?? ''} ${t.description ?? ''}`.toLowerCase();
      const matchesSearch = text.includes(search.toLowerCase());

      const status = t.status.toLowerCase();
      const matchesFilter =
        filter === 'all' ||
        (filter === 'open' && ['open', 'published'].includes(status)) ||
        (filter === 'live' && ['live', 'active'].includes(status)) ||
        (filter === 'completed' && status === 'completed');

      return matchesSearch && matchesFilter;
    });
  }, [tournaments, search, filter]);

  const openCount = tournaments.filter((t) =>
    ['open', 'published'].includes(t.status.toLowerCase())
  ).length;

  const liveCount = tournaments.filter((t) =>
    ['live', 'active'].includes(t.status.toLowerCase())
  ).length;

  const completedCount = tournaments.filter(
    (t) => t.status.toLowerCase() === 'completed'
  ).length;

  return (
    <div className="dg-home">
      <style>{`
        .dg-home {
          color: #eaf6ed;
          width: 100%;
          padding-bottom: 65px;
        }
        .dg-home * { box-sizing: border-box; }
        .dg-home button, .dg-home input { font: inherit; }
        .dg-home a { text-decoration: none; }
        .dg-container { width: min(1180px, calc(100% - 36px)); margin: auto; }
        .dg-hero {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(127,220,154,.18);
          border-radius: 22px;
          padding: clamp(28px, 5vw, 65px);
          margin: 25px auto 25px;
          background: radial-gradient(circle at 85% 20%, rgba(58,174,101,.27), transparent 34%), linear-gradient(120deg,#071c13,#0b3020 65%,#103d29);
        }
        .dg-hero:after {
          content: "D";
          position: absolute;
          right: 7%;
          top: -65px;
          font-size: clamp(240px, 36vw, 430px);
          line-height: 1;
          font-weight: 900;
          color: rgba(133,225,157,.055);
          pointer-events: none;
        }
        .dg-hero-content { position: relative; z-index: 1; max-width: 690px; }
        .dg-eyebrow {
          color: #8be5a3;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 2px;
          display: flex;
          align-items: center;
          gap: 9px;
          margin-bottom: 19px;
        }
        .dg-dot { width: 8px; height: 8px; border-radius: 50%; background: #8be5a3; box-shadow: 0 0 13px #8be5a3; }
        .dg-hero h1 {
          font-size: clamp(39px, 6vw, 68px);
          line-height: 1.02;
          letter-spacing: -2.5px;
          margin: 0 0 18px;
          color: #fff;
        }
        .dg-hero h1 span { color: #8be5a3; }
        .dg-hero p { color: #bdd5c4; font-size: 16px; line-height: 1.8; max-width: 570px; }
        .dg-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 26px; }
        .dg-primary, .dg-secondary {
          min-height: 48px;
          padding: 0 20px;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          font-weight: 800;
          font-size: 13px;
        }
        .dg-primary { background: #8be5a3; color: #092315; }
        .dg-secondary { color: #eaf6ed; border: 1px solid rgba(170,230,184,.35); background: rgba(255,255,255,.035); }
        .dg-stats {
          display: grid;
          grid-template-columns: repeat(4,minmax(0,1fr));
          gap: 13px;
          margin: 20px auto 45px;
        }
        .dg-stat {
          padding: 20px;
          border-radius: 14px;
          border: 1px solid rgba(135,203,151,.15);
          background: #0c2118;
        }
        .dg-stat-label { font-size: 10px; letter-spacing: 1.2px; color: #91aa99; font-weight: 800; }
        .dg-stat-value { display: block; color: #fff; font-size: 27px; font-weight: 900; margin: 9px 0 4px; }
        .dg-stat-note { color: #8ca798; font-size: 11px; }
        .dg-section { margin: 42px auto; }
        .dg-section-head {
          display: flex;
          justify-content: space-between;
          align-items: end;
          gap: 16px;
          margin-bottom: 20px;
        }
        .dg-section-head h2 { margin: 0; color: #fff; font-size: clamp(23px,3vw,31px); letter-spacing: -.7px; }
        .dg-section-head p { margin: 7px 0 0; color: #91aa99; font-size: 13px; }
        .dg-search {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: min(270px,100%);
          padding: 11px 13px;
          border-radius: 10px;
          background: #0b2017;
          border: 1px solid rgba(135,203,151,.2);
          color: #91aa99;
        }
        .dg-search input { width: 100%; min-width: 0; color: white; background: transparent; border: 0; outline: none; }
        .dg-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
        .dg-filter {
          cursor: pointer;
          border: 1px solid rgba(135,203,151,.2);
          border-radius: 30px;
          padding: 8px 14px;
          color: #aac0b0;
          background: #0b2017;
          font-size: 12px;
          font-weight: 700;
        }
        .dg-filter.active { color: #092315; background: #8be5a3; border-color: #8be5a3; }
        .dg-tournament-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 15px; }
        .dg-tournament {
          border-radius: 15px;
          border: 1px solid rgba(135,203,151,.16);
          background: linear-gradient(150deg,#10291d,#0a1d14);
          padding: 20px;
          min-width: 0;
          transition: transform .2s,border-color .2s;
        }
        .dg-tournament:hover { transform: translateY(-3px); border-color: rgba(139,229,163,.5); }
        .dg-tournament-top { display:flex; justify-content:space-between; align-items:center; gap:10px; }
        .dg-game-tag { color:#a5e7b5; font-size:11px; font-weight:800; letter-spacing:.4px; }
        .dg-status { border-radius:20px; padding:5px 9px; font-size:10px; font-weight:800; color:#9ce9b0; background:rgba(80,190,110,.12); }
        .dg-tournament h3 { font-size:19px; color:#fff; margin:19px 0 8px; }
        .dg-tournament-desc { color:#91aa99; font-size:12px; line-height:1.6; min-height:38px; }
        .dg-prize { background:rgba(139,229,163,.08); border-radius:10px; padding:13px; margin:16px 0; }
        .dg-prize small { display:block; color:#91aa99; font-size:10px; letter-spacing:1px; font-weight:800; }
        .dg-prize strong { display:block; color:#9ce9b0; font-size:24px; margin-top:5px; }
        .dg-details { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:5px 0 16px; }
        .dg-detail { color:#91aa99; font-size:11px; }
        .dg-detail b { display:block; color:#eaf6ed; font-size:13px; margin-top:5px; }
        .dg-card-link { display:flex; justify-content:center; align-items:center; gap:8px; border-radius:9px; background:#8be5a3; color:#092315; padding:12px; font-size:12px; font-weight:900; }
        .dg-empty { padding:40px 20px; text-align:center; border:1px dashed rgba(135,203,151,.25); border-radius:15px; color:#91aa99; }
        .dg-error { padding:15px; border-radius:10px; border:1px solid rgba(255,150,120,.35); color:#ffc2ae; background:rgba(160,50,30,.12); font-size:13px; margin-bottom:15px; }
        .dg-game-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
        .dg-game {
          border:1px solid rgba(135,203,151,.15);
          background:#0c2118;
          border-radius:13px;
          padding:17px;
          color:#eaf6ed;
          display:block;
        }
        .dg-game-icon { font-size:25px; }
        .dg-game strong { display:block; font-size:13px; margin:11px 0 5px; }
        .dg-game small { color:#91aa99; font-size:11px; line-height:1.5; }
        .dg-bottom-banner {
          display:flex; justify-content:space-between; align-items:center; gap:20px;
          padding:25px; border-radius:15px; background:linear-gradient(110deg,#123b26,#0b2117);
          border:1px solid rgba(139,229,163,.2);
        }
        .dg-bottom-banner h3 { color:white; margin:0 0 7px; }
        .dg-bottom-banner p { color:#a8c2af; font-size:12px; margin:0; }
        .dg-refresh { cursor:pointer; display:inline-flex; align-items:center; gap:8px; background:transparent; border:1px solid rgba(135,203,151,.25); color:#b7d4bf; padding:9px 12px; border-radius:9px; font-size:11px; font-weight:800; }
        @media(max-width:850px) {
          .dg-tournament-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
          .dg-game-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
          .dg-stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
        }
        @media(max-width:560px) {
          .dg-container { width:calc(100% - 24px); }
          .dg-hero { border-radius:15px; padding:27px 21px; margin-top:14px; }
          .dg-hero h1 { letter-spacing:-1.5px; }
          .dg-stats { gap:8px; margin-bottom:35px; }
          .dg-stat { padding:14px; }
          .dg-stat-value { font-size:22px; }
          .dg-section-head { align-items:stretch; flex-direction:column; }
          .dg-search { width:100%; }
          .dg-tournament-grid { grid-template-columns:1fr; }
          .dg-game-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
          .dg-bottom-banner { align-items:flex-start; flex-direction:column; }
        }
      `}</style>

      <div className="dg-container">
        <section className="dg-hero">
          <div className="dg-hero-content">
            <div className="dg-eyebrow">
              <span className="dg-dot" />
              THE DREAM GAME ARENA
            </div>

            <h1>
              Play your game.
              <br />
              <span>Make your dream.</span>
            </h1>

            <p>
              Challenge other players, enter tournaments, compete for prizes
              and build your name in the Dream Game arena.
            </p>

            <div className="dg-actions">
              <a href="#tournaments" className="dg-primary">
                Explore tournaments <ArrowRight size={17} />
              </a>
              <a href="#games" className="dg-secondary">
                Explore games <Gamepad2 size={17} />
              </a>
            </div>
          </div>
        </section>

        <section className="dg-stats">
          <div className="dg-stat">
            <div className="dg-stat-label">OPEN TO JOIN</div>
            <strong className="dg-stat-value">{openCount}</strong>
            <span className="dg-stat-note">Available tournaments</span>
          </div>

          <div className="dg-stat">
            <div className="dg-stat-label">LIVE TOURNAMENTS</div>
            <strong className="dg-stat-value">{liveCount}</strong>
            <span className="dg-stat-note">Currently in competition</span>
          </div>

          <div className="dg-stat">
            <div className="dg-stat-label">COMPLETED</div>
            <strong className="dg-stat-value">{completedCount}</strong>
            <span className="dg-stat-note">Finished tournaments</span>
          </div>

          <div className="dg-stat">
            <div className="dg-stat-label">YOUR COINS</div>
            <strong className="dg-stat-value">{coinBalance.toLocaleString('en-NG')}</strong>
            <span className="dg-stat-note">Your available wallet balance</span>
          </div>
        </section>

        <section className="dg-section" id="tournaments">
          <div className="dg-section-head">
            <div>
              <div className="dg-eyebrow">
                <span className="dg-dot" />
                ENTER THE ARENA
              </div>
              <h2>Featured tournaments</h2>
              <p>Discover competitions and find your next challenge.</p>
            </div>

            <button
              className="dg-refresh"
              onClick={() => void loadHomepage()}
              disabled={loading}
            >
              <RefreshCw size={14} />
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {error && <div className="dg-error">{error}</div>}

          <div className="dg-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tournaments or games..."
            />
          </div>

          <div className="dg-filters" style={{ marginTop: 15 }}>
            {[
              ['all', 'All tournaments'],
              ['open', 'Open'],
              ['live', 'Live'],
              ['completed', 'Completed'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={`dg-filter ${filter === value ? 'active' : ''}`}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="dg-empty">Loading tournaments from Dream Game...</div>
          ) : filteredTournaments.length === 0 ? (
            <div className="dg-empty">
              <Trophy size={32} style={{ marginBottom: 12, color: '#8be5a3' }} />
              <h3 style={{ color: '#eaf6ed', margin: '0 0 8px' }}>
                {search ? 'No matching tournaments' : 'No tournaments available yet'}
              </h3>
              <p style={{ margin: 0 }}>
                {search
                  ? 'Try another search term.'
                  : 'New tournaments will appear here when they are created.'}
              </p>
            </div>
          ) : (
            <div className="dg-tournament-grid">
              {filteredTournaments.map((t) => (
                <article className="dg-tournament" key={t.id}>
                  <div className="dg-tournament-top">
                    <span className="dg-game-tag">
                      <Gamepad2 size={13} style={{ verticalAlign: 'middle' }} />{' '}
                      {t.game_type || 'Multi-game'}
                    </span>
                    <span className="dg-status">{statusLabel(t.status)}</span>
                  </div>

                  <h3>{t.title}</h3>
                  <p className="dg-tournament-desc">
                    {t.description || 'Join this Dream Game tournament and compete against other players.'}
                  </p>

                  <div className="dg-prize">
                    <small>PRIZE POOL</small>
                    <strong>{money(t.prize_pool)}</strong>
                  </div>

                  <div className="dg-details">
                    <div className="dg-detail">
                      Entry fee
                      <b>{money(t.entry_fee)}</b>
                    </div>
                    <div className="dg-detail">
                      Player limit
                      <b>{t.max_players ?? 'Not specified'}</b>
                    </div>
                    <div className="dg-detail">
                      Starts
                      <b>{dateLabel(t.start_at)}</b>
                    </div>
                    <div className="dg-detail">
                      Game
                      <b>{t.game_type || 'Not specified'}</b>
                    </div>
                  </div>

                  <a
                    className="dg-card-link"
                    href={`#/t/${encodeURIComponent(t.slug)}`}
                  >
                    View tournament <ArrowRight size={15} />
                  </a>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="dg-section" id="games">
          <div className="dg-section-head">
            <div>
              <div className="dg-eyebrow">
                <span className="dg-dot" />
                CHOOSE YOUR CHALLENGE
              </div>
              <h2>Games arena</h2>
              <p>Seven games. Countless ways to prove yourself.</p>
            </div>
          </div>

          <div className="dg-game-grid">
            {GAMES.map((game) => (
              <a
                className="dg-game"
                key={game.id}
                href={`#/`}
                title={game.name}
              >
                <span className="dg-game-icon">{game.icon}</span>
                <strong>{game.name}</strong>
                <small>{game.description}</small>
              </a>
            ))}
          </div>
        </section>

        <section className="dg-section">
          <div className="dg-bottom-banner">
            <div>
              <div className="dg-eyebrow">
                <Sparkles size={14} />
                YOUR NEXT WIN STARTS HERE
              </div>
              <h3>Ready to enter the arena?</h3>
              <p>Find a tournament, prepare your strategy and compete.</p>
            </div>

            <a href="#tournaments" className="dg-primary">
              Find a tournament <Zap size={16} />
            </a>
          </div>
        </section>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 20,
            color: '#779382',
            fontSize: 11,
            padding: '20px 0',
          }}
        >
          <span><ShieldCheck size={13} style={{ verticalAlign: 'middle' }} /> Secure competition</span>
          <span><Wallet size={13} style={{ verticalAlign: 'middle' }} /> Wallet-powered entry</span>
          <span><Users size={13} style={{ verticalAlign: 'middle' }} /> Player community</span>
          <span><Crown size={13} style={{ verticalAlign: 'middle' }} /> Become a champion</span>
          <span><Clock size={13} style={{ verticalAlign: 'middle' }} /> Tournament schedules</span>
        </div>
      </div>
    </div>
  );
}
