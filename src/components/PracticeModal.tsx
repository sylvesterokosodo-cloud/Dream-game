import { useState } from 'react';
import { X } from 'lucide-react';
import { engineFor } from '../../supabase/functions/_shared/games/index.ts';
import type { Idx } from '../../supabase/functions/_shared/games/index.ts';
import { gameLabel } from '../lib/tournaments';
import GameBoard from './GameBoard';

const RACE = ['scramble', 'puzzle'];

/** Local practice with the SAME engines the server uses. Pass-and-play for 2-player games. */
export default function PracticeModal({ game, onClose }: { game: string; onClose: () => void }) {
  const engine = engineFor(game);
  const fresh = () => engine.init(Math.floor(Math.random() * 2 ** 32), 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [state, setState] = useState<any>(fresh);
  const [error, setError] = useState('');

  const turn = engine.turn(state);
  const outcome = engine.outcome(state);
  const player: Idx = turn ?? 0;

  const onMove = (m: unknown) => {
    try {
      setState(engine.apply(state, m, player));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal game-modal wide">
        <div className="modal-head">
          <div>
            <div className="eyebrow">PRACTICE</div>
            <h2>{gameLabel(game)}</h2>
          </div>
          <button onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <p className="muted">
          {RACE.includes(game) ? 'Solo practice.' : 'Pass-and-play on this device.'} No coins involved.
        </p>
        <GameBoard game={game} view={engine.view(state)} myIndex={player}
          canMove={!outcome.done} onMove={onMove} />
        <div className="game-result">
          {outcome.done
            ? outcome.winner === null ? 'It is a draw.' : `Player ${outcome.winner + 1} wins!`
            : turn !== null && !RACE.includes(game) ? `Player ${turn + 1} to move` : ''}
        </div>
        {error && <div className="form-error">{error}</div>}
        <button className="btn-outline compact" onClick={() => { setState(fresh()); setError(''); }}>
          New game
        </button>
      </div>
    </div>
  );
}
