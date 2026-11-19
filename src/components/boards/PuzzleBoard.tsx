import type { BoardProps } from './types';

export default function PuzzleBoard({ view, canMove, onMove, myIndex }: BoardProps) {
  const board: number[] = view.boards[myIndex];
  const moves: [number, number] = view.moves;
  const opp = myIndex === 0 ? 1 : 0;
  return (
    <div>
      <div className="mem-score">
        Your moves {moves[myIndex]} · Opponent moves {moves[opp]} (race to solve!)
      </div>
      <div className="puz-grid" role="grid" aria-label="Sliding puzzle">
        {board.map((v, i) => (
          <button
            key={i}
            className={'puz-tile' + (v === 0 ? ' blank' : '')}
            disabled={!canMove || v === 0}
            onClick={() => onMove({ tile: i })}
            aria-label={v === 0 ? 'Empty space' : `Tile ${v}`}
          >
            {v === 0 ? '' : v}
          </button>
        ))}
      </div>
      <small className="muted">Slide tiles until they read 1–8 in order with the blank last.</small>
    </div>
  );
}
