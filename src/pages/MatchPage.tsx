import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMatch, fetchNames, gameGet, gameMove, type Match } from '../lib/api';
import { gameLabel } from '../lib/tournaments';
import GameBoard from '../components/GameBoard';

type Props = { matchId: string; userId: string | null; notify: (m: string) => void; requireLogin: () => void };

export default function MatchPage({ matchId, userId, notify, requireLogin }: Props) {
  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const inited = useRef(false);

  const load = useCallback(async () => {
    try {
      const m = await fetchMatch(matchId);
      setMatch(m);
      if (m && Object.keys(names).length === 0) {
        setNames(await fetchNames([m.playerA, m.playerB].filter(Boolean) as string[]));
      }
    } catch (e) {
      notify((e as Error).message);
    }
  }, [matchId, names, notify]);

  useEffect(() => {
    if (!userId) return;
    // First visit initialises the authoritative game state on the server.
    if (!inited.current) {
      inited.current = true;
      gameGet(matchId).then(load).catch((e: Error) => { notify(e.message); load(); });
    }
    const id = window.setInterval(load, 2000);
    return () => window.clearInterval(id);
  }, [userId, matchId, load, notify]);

  if (!userId) {
    return <section className="section"><div className="empty"><h3>Sign in to play</h3>
      <button className="btn-primary" onClick={requireLogin}>Log in</button></div></section>;
  }
  if (match === undefined) return <section className="section"><p className="muted">Loading match…</p></section>;
  if (match === null) return <section className="section"><div className="empty"><h3>Match not found</h3></div></section>;

  const myIndex: 0 | 1 | null = match.playerA === userId ? 0 : match.playerB === userId ? 1 : null;
  const pub = match.gameState;
  const active = match.status === 'ready' || match.status === 'in_progress';
  const canMove = Boolean(
    myIndex !== null && active && pub && !pub.outcome.done && (pub.turn === null || pub.turn === myIndex) && !busy
  );
  const oppId = myIndex === 0 ? match.playerB : match.playerA;
  const nm = (id: string | null) => (id && names[id]) || 'Player';

  const onMove = async (move: unknown) => {
    setBusy(true);
    try {
      const r = await gameMove(matchId, move);
      setMatch((m) => (m ? { ...m, status: r.status, gameState: r.public } : m));
      if (r.drawnAndRestarted) notify('Drawn game: a rematch has started with sides swapped.');
    } catch (e) {
      notify((e as Error).message);
      load();
    } finally {
      setBusy(false);
    }
  };

  let status = '';
  if (match.status === 'completed') status = `Match complete. Winner: ${nm(match.winnerId)}.`;
  else if (match.status === 'awaiting_approval') {
    status = match.proposedWinnerId
      ? `${nm(match.proposedWinnerId)} won this game. Waiting for admin approval.`
      : 'After repeated draws, an administrator will decide this match.';
  } else if (pub?.turn === myIndex) status = 'Your move.';
  else if (pub?.turn === null) status = 'Race! Both players play at the same time.';
  else status = `Waiting for ${nm(oppId)}…`;

  return (
    <section className="section match-page">
      <a className="link-btn" href="#" onClick={(e) => { e.preventDefault(); window.history.back(); }}>← Back</a>
      <div className="section-head">
        <div><div className="eyebrow">TOURNAMENT MATCH</div>
          <h2>{gameLabel(match.game)}</h2>
          <p>You vs {nm(oppId)}{pub && pub.draws > 0 ? ` · rematch ${pub.draws + 1}` : ''}</p></div>
      </div>
      <div className="game-status" role="status">{status}</div>
      {pub && myIndex !== null ? (
        <div className="board-wrap">
          <GameBoard game={match.game} view={pub.view} myIndex={myIndex} canMove={canMove} onMove={onMove} />
        </div>
      ) : <p className="muted">Preparing the game…</p>}
      <small className="muted">Moves are validated on the server. Winners are confirmed by the tournament administrator.</small>
    </section>
  );
}
