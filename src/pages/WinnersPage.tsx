import { Medal, Trophy } from 'lucide-react';
import type { Tournament } from '../lib/tournaments';
import { naira } from '../lib/format';

export default function WinnersPage({ tournaments }: { tournaments: Tournament[] }) {
  const winners = tournaments.filter((t) => t.status === 'completed');
  return (
    <section className="section">
      <div className="section-head">
        <div><div className="eyebrow">HALL OF DREAMS</div><h2>Our champions</h2>
          <p>Every completed tournament celebrates its winner.</p></div>
      </div>
      {winners.length === 0 ? (
        <div className="empty"><Medal size={30} /><h3>The first champion is waiting</h3></div>
      ) : winners.map((t) => (
        <article className="winner-card" key={t.id}>
          <div className="winner-medal"><Trophy size={31} /></div>
          <div>
            <small>TOURNAMENT CHAMPION</small>
            <h3>{t.champion || 'Champion'}</h3>
            <p>{t.name} · {t.prizeTitle}</p>
            <b>{naira(t.prizeValue)} prize value</b>
          </div>
          <span className="champion-tag">CROWNED</span>
        </article>
      ))}
    </section>
  );
}
