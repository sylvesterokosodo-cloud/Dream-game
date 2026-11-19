import type { BoardProps } from './types';

export default function Connect4Board({ view, canMove, onMove }: BoardProps) {
  const board: (0 | 1 | null)[][] = view.board;
  return (
    <div className="c4" role="grid" aria-label="Connect 4 board">
      {board[0].map((_, col) => (
        <button
          key={col}
          className="c4-col"
          disabled={!canMove || board[0][col] !== null}
          onClick={() => onMove({ col })}
          aria-label={`Drop disc in column ${col + 1}`}
        >
          {board.map((row, r) => (
            <span key={r} className={'c4-cell p' + (row[col] ?? 'n')} />
          ))}
        </button>
      ))}
    </div>
  );
}
