import { Clock3, Gift, RefreshCw, Ticket, Users, Gamepad2, Share2 } from 'lucide-react';
import { gameLabel, tournamentUrl, type Tournament } from '../lib/tournaments';
import { coinsLabel, copyText, naira, STATUS_LABEL, timeLeft } from '../lib/format';

type Props = {
  tournaments: Tournament[];
  onRefresh: () => void;
  notify: (m: string) => void;
};

export default function DiscoverPage({ tournaments, onRefresh, notify }: Props) {
  const list = tournaments.filter((t) => t.status === 'open' || t.status === 'live');
  const share = async (t: Tournament) => {
    const url = tournamentUrl(t.slug);
    if (navigator.share) {
      try { await navigator.share({ title: t.name, text: `Join "${t.name}" on Dream Game`, url }); return; } catch { /* fall through */ }
    }
    notify((await copyText(url)) ? 'Tournament link copied.' : 'Copy this link: ' + url);
  };

  return (
    <section className="section">
      <div className="section-head">
        <div>
          <div className="eyebrow">THE ARENA</div>
          <h2>Dream tournaments</h2>
          <p>Every tournament shows its prize before you enter.</p>
        </div>
        <button className="btn-outline compact" onClick={onRefresh}><RefreshCw size={15} /> Refresh</button>
      </div>
      {list.length === 0 ? (
        <div className="empty"><Gamepad2 size={30} /><h3>No open tournaments yet</h3><p>Check back soon.</p></div>
      ) : (
        <div className="tournament-grid">
          {list.map((t) => (
            <article className="tournament-card" key={t.id}>
              <a className="card-link" href={`#/t/${t.slug}`}>
                <div className="prize-visual">
                  {t.prizeImage ? <img src={t.prizeImage} alt={t.prizeTitle} loading="lazy" referrerPolicy="no-referrer" />
                    : <div className="prize-fallback"><Gift size={48} /><span>PRIZE DROP</span></div>}
                  <span className="status-badge">{STATUS_LABEL[t.status]}</span>
                </div>
                <div className="card-body">
                  <div className="game-label">{t.games.map(gameLabel).join(' · ')}</div>
                  <h3>{t.name}</h3>
                  <p>{t.prizeTitle}</p>
                  <div className="prize-value"><span>PRIZE VALUE</span><b>{naira(t.prizeValue)}</b></div>
                  <div className="card-facts">
                    <span><Ticket size={14} />{coinsLabel(t.entryFee)} entry</span>
                    <span><Users size={14} />{t.entriesCount}/{t.targetPlayers}</span>
                  </div>
                  {t.status === 'open' && <div className="deadline"><Clock3 size={14} /> {timeLeft(t.registrationDeadline)}</div>}
                </div>
              </a>
              <div className="card-actions">
                <a className="join-btn" href={`#/t/${t.slug}`}>{t.joined ? 'You are in — view' : 'View & join'}</a>
                <button className="btn-outline compact" onClick={() => share(t)} aria-label="Share tournament link"><Share2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
