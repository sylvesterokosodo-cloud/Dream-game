import { useCallback, useEffect, useState } from 'react';
import { Clock3, Gift, Share2, Ticket, Trophy, Users } from 'lucide-react';
import {
  fetchTournamentBySlug, gameLabel, tournamentUrl, type Tournament,
} from '../lib/tournaments';
import {
  cancelEntry, fetchBracket, joinTournament, type Match, type Round,
} from '../lib/api';
import { coinsLabel, copyText, naira, STATUS_LABEL, timeLeft } from '../lib/format';

type Props = {
  slug: string;
  userId: string | null;
  notify: (m: string) => void;
  requireLogin: () => void;
  onChanged: () => void;
};

type Bracket = { rounds: Round[]; matches: Match[]; names: Record<string, string> };

export default function TournamentPage({ slug, userId, notify, requireLogin, onChanged }: Props) {
  const [t, setT] = useState<Tournament | null | undefined>(undefined);
  const [bracket, setBracket] = useState<Bracket | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const row = await fetchTournamentBySlug(slug, userId ?? undefined);
      setT(row);
      if (row && userId && (row.status === 'live' || row.status === 'completed')) {
        setBracket(await fetchBracket(row.id));
      }
    } catch (e) {
      notify((e as Error).message);
    }
  }, [slug, userId, notify]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  if (t === undefined) return <section className="section"><p className="muted">Loading tournament…</p></section>;
  if (t === null) {
    return (
      <section className="section">
        <div className="empty"><h3>Tournament not found</h3><p>It may be unpublished or the link is wrong.</p>
          <a className="btn-outline compact" href="#/">Back to Discover</a></div>
      </section>
    );
  }

  const act = async (fn: () => Promise<{ message: string }>) => {
    if (!userId) { requireLogin(); return; }
    setBusy(true);
    try {
      const r = await fn();
      notify(r.message);
      await load();
      onChanged();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const url = tournamentUrl(t.slug);
    if (navigator.share) {
      try { await navigator.share({ title: t.name, text: `Join "${t.name}" on Dream Game`, url }); return; } catch { /* fall back */ }
    }
    notify((await copyText(url)) ? 'Tournament link copied.' : 'Copy this link: ' + url);
  };

  const myOpen = bracket?.matches.find(
    (m) => (m.playerA === userId || m.playerB === userId) && !m.isBye && m.status !== 'completed'
  );
  const nm = (id: string | null) => (id && bracket?.names[id]) || (id ? 'Player' : '—');

  return (
    <section className="section">
      <a className="link-btn" href="#/">← All tournaments</a>
      <div className="t-hero">
        <div className="prize-visual t-img">
          {t.prizeImage ? <img src={t.prizeImage} alt={t.prizeTitle} referrerPolicy="no-referrer" />
            : <div className="prize-fallback"><Gift size={56} /><span>PRIZE DROP</span></div>}
          <span className="status-badge">{STATUS_LABEL[t.status]}</span>
        </div>
        <div className="t-info">
          <div className="game-label">{t.games.map(gameLabel).join(' · ')}</div>
          <h2>{t.name}</h2>
          <p><b>{t.prizeTitle}</b> · {naira(t.prizeValue)} value{t.prizeCoins > 0 ? ` + ${coinsLabel(t.prizeCoins)}` : ''}</p>
          <p className="muted">{t.prizeDescription}</p>
          {t.description && <p className="muted">{t.description}</p>}
          <div className="card-facts t-facts">
            <span><Ticket size={14} />{coinsLabel(t.entryFee)} entry</span>
            <span><Users size={14} />{t.entriesCount}/{t.targetPlayers} players</span>
            {t.status === 'open' && <span><Clock3 size={14} />{timeLeft(t.registrationDeadline)}</span>}
          </div>
          <div className="t-actions">
            {t.status === 'open' && !t.joined && (
              <button className="btn-primary" disabled={busy} onClick={() => act(() => joinTournament(t.id))}>
                Join for {coinsLabel(t.entryFee)}
              </button>
            )}
            {t.status === 'open' && t.joined && (
              <button className="btn-outline" disabled={busy} onClick={() => act(() => cancelEntry(t.id))}>
                Cancel entry &amp; refund
              </button>
            )}
            <button className="btn-outline" onClick={share}><Share2 size={15} /> Share link</button>
          </div>
          {t.status === 'open' && (
            <small className="muted">
              Your entry fee is held in escrow. It is refunded if you cancel before the tournament starts, or if the
              tournament does not fill within 48 hours of publication.
            </small>
          )}
          {t.status === 'failed' && <div className="form-note">This tournament did not fill in time. All entries were refunded.</div>}
          {t.status === 'cancelled' && <div className="form-note">This tournament was cancelled. All entries were refunded.</div>}
        </div>
      </div>

      {t.status === 'completed' && (
        <article className="winner-card"><div className="winner-medal"><Trophy size={31} /></div>
          <div><small>TOURNAMENT CHAMPION</small><h3>{t.champion}</h3><p>{t.prizeTitle}</p></div>
          <span className="champion-tag">CROWNED</span></article>
      )}

      {myOpen && (
        <div className="play-banner">
          <div><b>Your match is ready</b><span>{gameLabel(myOpen.game)} vs {nm(myOpen.playerA === userId ? myOpen.playerB : myOpen.playerA)}</span></div>
          <a className="btn-primary" href={`#/m/${myOpen.id}`}>Play now</a>
        </div>
      )}

      {(t.status === 'live' || t.status === 'completed') && !userId && (
        <p className="muted"><button className="link-btn" onClick={requireLogin}>Sign in</button> to see the bracket.</p>
      )}
      {bracket && bracket.rounds.length > 0 && (
        <div className="bracket-card">
          <h3>Bracket</h3>
          {bracket.rounds.map((r) => (
            <div className="round" key={r.id}>
              <b>ROUND {r.roundNumber}</b>
              {bracket.matches.filter((m) => m.roundId === r.id).map((m) => (
                <div className={'match' + (m.playerA === userId || m.playerB === userId ? ' mine' : '')} key={m.id}>
                  <span>{nm(m.playerA)}</span>
                  <span className="match-game">{gameLabel(m.game)}</span>
                  <span>{m.isBye ? 'BYE (advances)' : `VS ${nm(m.playerB)}`}</span>
                  <small>
                    {m.winnerId ? `Winner: ${nm(m.winnerId)}`
                      : m.status === 'awaiting_approval' ? 'Result awaiting admin approval' : 'Awaiting result'}
                  </small>
                  {(m.playerA === userId || m.playerB === userId) && !m.isBye && m.status !== 'completed' && (
                    <a className="link-btn" href={`#/m/${m.id}`}>Open match</a>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
