import type { BoardProps } from './types';

export default function GomokuBoard({ view, canMove, onMove }: BoardProps) {
  const board: (0 | 1 | null)[][] = view.board;
  return (
    <div className="gomoku-wrap">
      <div className="gomoku" role="grid" aria-label="Gomoku board">
        {board.map((row, r) =>
          row.map((v, c) => (
            <button
              key={`${r}-${c}`}
              className="g-cell"
              disabled={!canMove || v !== null}
              onClick={() => onMove({ r, c })}
              aria-label={`Row ${r + 1} column ${c + 1}`}
            >
              {v !== null && <span className={'stone s' + v} />}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
