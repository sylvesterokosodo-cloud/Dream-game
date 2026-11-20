import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight, Crown, Gamepad2, LayoutDashboard, LogIn, LogOut, ShieldCheck, Share2, Swords,
  Trophy, Wallet,
} from 'lucide-react';
import { configProblems, supabase, supabaseConfig, supabaseHost } from './lib/supabase';
import { probeSupabase, type Health } from './lib/health';
import { ConfigErrorScreen, ConnectionBanner } from './components/ConfigErrors';
import {
  fetchIsAdmin, fetchTournaments, fetchWallet, GAME_CATALOGUE, type Tournament, type WalletSnapshot,
} from './lib/tournaments';
import { confirmPayment, runExpiry } from './lib/api';
import { copyText } from './lib/format';
import AuthModal from './components/AuthModal';
import RecoveryModal from './components/RecoveryModal';
import PracticeModal from './components/PracticeModal';
import DiscoverPage from './pages/DiscoverPage';
import TournamentPage from './pages/TournamentPage';
import MatchPage from './pages/MatchPage';
import WalletPage from './pages/WalletPage';
import WinnersPage from './pages/WinnersPage';
import AdminPage from './pages/AdminPage';
import LegalPage from './pages/LegalPage';
import './extra.css';

type Route =
  | { name: 'discover' } | { name: 'wallet' } | { name: 'winners' } | { name: 'admin' }
  | { name: 'legal'; doc: 'terms' | 'privacy' | 'responsible' }
  | { name: 'tournament'; slug: string } | { name: 'match'; id: string };

function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 't' && b) return { name: 'tournament', slug: decodeURIComponent(b) };
  if (a === 'm' && b) return { name: 'match', id: b };
  if (a === 'wallet' || a === 'winners' || a === 'admin') return { name: a };
  if (a === 'terms' || a === 'privacy' || a === 'responsible') return { name: 'legal', doc: a };
  return { name: 'discover' };
}

export default function App() {
  // Module-level constant: identical on every render, so hook order is stable.
  if (configProblems.length > 0) return <ConfigErrorScreen problems={configProblems} />;
  return <DreamGameApp />;
}

function DreamGameApp() {
  const [health, setHealth] = useState<Health>({ state: 'ok' });
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [wallet, setWallet] = useState<WalletSnapshot>({ availableCoins: 0, escrowedCoins: 0 });
  const [isAdmin, setIsAdmin] = useState(false);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [notice, setNotice] = useState('Welcome to Dream Game. Browse tournaments and sign in to play.');
  const [showAuth, setShowAuth] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [practice, setPractice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const notify = useCallback((m: string) => setNotice(m), []);

  useEffect(() => {
    const on = () => { setRoute(parseRoute(window.location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
      await runExpiry().catch(() => undefined);
      setTournaments(await fetchTournaments(user?.id));
      if (user) {
        const [w, admin, profile] = await Promise.all([
          fetchWallet(user.id),
          fetchIsAdmin(),
          supabase.from('dg_profiles').select('display_name').eq('id', user.id).maybeSingle(),
        ]);
        setWallet(w);
        setIsAdmin(admin);
        setDisplayName(String(profile.data?.display_name ?? user.email?.split('@')[0] ?? 'Player'));
      } else {
        setWallet({ availableCoins: 0, escrowedCoins: 0 });
        setIsAdmin(false);
        setDisplayName('');
      }
      setTick((n) => n + 1);
    } catch (e) {
      console.error(e);
      setNotice('Unable to load Dream Game data. Please refresh.');
    }
  }, []);

  useEffect(() => {
    probeSupabase(supabaseConfig.url, supabaseConfig.key).then(setHealth);
  }, []);

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      refresh();
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  // Returning from Flutterwave: ?status=...&tx_ref=...&transaction_id=...
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const txRef = q.get('tx_ref');
    const txId = q.get('transaction_id');
    if (!txRef) return;
    window.history.replaceState({}, '', window.location.pathname + '#/wallet');
    setRoute({ name: 'wallet' });
    if (q.get('status') === 'cancelled' || !txId) {
      setNotice('Payment was cancelled. No coins were added.');
      return;
    }
    setNotice('Confirming your payment with Flutterwave…');
    confirmPayment(txId, txRef)
      .then((r) => {
        setNotice(r.ok ? `Payment confirmed. ${r.coins ?? ''} coins added to your wallet.`
          : r.status === 'pending' ? 'Payment is still processing. Your coins will appear shortly.'
          : 'Payment could not be verified: ' + (r.reason ?? r.status));
        refresh();
      })
      .catch((e: Error) => setNotice(e.message));
  }, [refresh]);

  const logout = async () => {
    await supabase.auth.signOut();
    setNotice('You have been logged out.');
    window.location.hash = '#/';
  };

  const shareApp = async () => {
    const url = window.location.origin + window.location.pathname;
    if (navigator.share) {
      try { await navigator.share({ title: 'Dream Game', text: 'Join me on Dream Game.', url }); return; } catch { /* fall back */ }
    }
    setNotice((await copyText(url)) ? 'Dream Game link copied.' : 'Share this link: ' + url);
  };

  const counts = useMemo(() => ({
    open: tournaments.filter((t) => t.status === 'open').length,
    live: tournaments.filter((t) => t.status === 'live').length,
    done: tournaments.filter((t) => t.status === 'completed').length,
  }), [tournaments]);

  const requireLogin = useCallback(() => setShowAuth(true), []);
  const tab = route.name === 'tournament' || route.name === 'match' || route.name === 'legal' ? 'discover' : route.name;

  return (
    <div className="app-shell">
      <header className="header">
        <a className="brand" href="#/">
          <div className="brand-icon"><Crown size={25} /></div>
          <div><strong>DREAM <span>GAME</span></strong><small>YOUR NEXT WIN STARTS HERE</small></div>
        </a>
        <div className="header-right">
          {userId && <span className="demo-label"><i /> {displayName}</span>}
          <button className="btn-outline compact" onClick={shareApp}><Share2 size={15} /> <span className="hide-sm">Share app</span></button>
          {userId ? (
            <button className="btn-outline compact" onClick={logout}><LogOut size={15} /> <span className="hide-sm">Log out</span></button>
          ) : (
            <button className="btn-primary compact" onClick={requireLogin}><LogIn size={15} /> Log in</button>
          )}
          <a className="balance" href="#/wallet"><Wallet size={16} />{wallet.availableCoins.toLocaleString('en-NG')}</a>
        </div>
      </header>

      <main>
        {route.name === 'discover' && (
          <section className="hero">
            <div className="hero-content">
              <div className="kicker"><span /> THE NEXT CHAMPION COULD BE YOU</div>
              <h1>Play your game.<br /><em>Make your dream.</em></h1>
              <p>Enter head-to-head challenges, rise through the rounds and become the name everyone remembers.</p>
              <div className="hero-buttons">
                <a className="btn-primary" href="#/">Find a tournament <ArrowUpRight size={17} /></a>
                <a className="btn-outline" href="#/winners">Meet the winners</a>
              </div>
              <div className="hero-note"><ShieldCheck size={15} /> Escrowed entry fees. Server-checked moves. Public champions.</div>
            </div>
            <div className="dream-visual">
              <div className="glow" /><div className="ring r1" /><div className="ring r2" />
              <div className="emblem"><Crown size={86} /><span>D</span></div>
              <div className="orbit-tag tag-a"><Swords size={16} /> HEAD TO HEAD</div>
              <div className="orbit-tag tag-b"><Trophy size={16} /> WIN THE PRIZE</div>
            </div>
          </section>
        )}

        <ConnectionBanner health={health} host={supabaseHost} />

        <div className="announcement" role="status">
          <ShieldCheck size={17} /><span>{notice}</span>
        </div>

        {route.name === 'discover' && (
          <section className="metrics">
            <div><small>OPEN TO JOIN</small><b>{String(counts.open).padStart(2, '0')}</b><span>Find your match</span></div>
            <div><small>LIVE TOURNAMENTS</small><b>{String(counts.live).padStart(2, '0')}</b><span>Competition underway</span></div>
            <div><small>CHAMPIONS</small><b>{String(counts.done).padStart(2, '0')}</b><span>Dreams achieved</span></div>
            <div><small>YOUR COINS</small><b>{wallet.availableCoins.toLocaleString('en-NG')}</b><span>1 coin = ₦1</span></div>
          </section>
        )}

        <nav className="tabs" aria-label="Main">
          <a className={tab === 'discover' ? 'active' : ''} href="#/"><Gamepad2 size={17} />Discover</a>
          <a className={tab === 'wallet' ? 'active' : ''} href="#/wallet"><Wallet size={17} />My Wallet</a>
          <a className={tab === 'winners' ? 'active' : ''} href="#/winners"><Trophy size={17} />Winners</a>
          {isAdmin && <a className={tab === 'admin' ? 'active' : ''} href="#/admin"><LayoutDashboard size={17} />Admin</a>}
        </nav>

        {route.name === 'discover' && <DiscoverPage tournaments={tournaments} onRefresh={refresh} notify={notify} />}
        {route.name === 'tournament' && (
          <TournamentPage slug={route.slug} userId={userId} notify={notify} requireLogin={requireLogin} onChanged={refresh} />
        )}
        {route.name === 'match' && <MatchPage matchId={route.id} userId={userId} notify={notify} requireLogin={requireLogin} />}
        {route.name === 'wallet' && (
          <WalletPage userId={userId} wallet={wallet} notify={notify} requireLogin={requireLogin} refreshKey={tick} />
        )}
        {route.name === 'winners' && <WinnersPage tournaments={tournaments} />}
        {route.name === 'legal' && <LegalPage doc={route.doc} />}
        {route.name === 'admin' && (
          isAdmin
            ? <AdminPage tournaments={tournaments} notify={notify} onChanged={refresh} />
            : <section className="section"><div className="empty"><h3>Administrators only</h3>
                <p>This area is restricted to the authorised Dream Game administrator account.</p></div></section>
        )}

        <section className="games-strip">
          <div><div className="eyebrow">PICK YOUR PLAYSTYLE</div><h2>Games in the arena</h2>
            <p>Tap a game to practise for free.</p></div>
          <div className="game-chips">
            {GAME_CATALOGUE.map((g) => (
              <button key={g.id} onClick={() => setPractice(g.id)}><Gamepad2 size={16} /> {g.label}</button>
            ))}
          </div>
        </section>
      </main>

      <footer>
        <div className="brand footer-brand"><div className="brand-icon"><Crown size={20} /></div>
          <div><strong>DREAM <span>GAME</span></strong><small>YOUR NEXT WIN STARTS HERE</small></div></div>
        <p>Play smart. Compete fairly. Dream bigger. 18+ only. Play responsibly.</p>
        <small>1 coin = ₦1 · Payments by Flutterwave ·{' '}
          <a href="#/terms">Terms</a> · <a href="#/privacy">Privacy</a> · <a href="#/responsible">Responsible play</a> · <span title={__BUILD_TIME__}>build {__BUILD_SHA__.slice(0, 7)}</span></small>
      </footer>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onDone={() => { setShowAuth(false); refresh(); setNotice('You are signed in.'); }} />}
      {recovery && (
        <RecoveryModal onClose={() => setRecovery(false)}
          onDone={() => { setRecovery(false); setNotice('Password updated. You are signed in.'); }} />
      )}
      {practice && <PracticeModal game={practice} onClose={() => setPractice(null)} />}
    </div>
  );
}
