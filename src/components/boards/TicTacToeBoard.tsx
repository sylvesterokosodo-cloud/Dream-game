import type { BoardProps } from './types';

const MARK = ['X', 'O'];

export default function TicTacToeBoard({ view, canMove, onMove }: BoardProps) {
  const board: (0 | 1 | null)[] = view.board;
  return (
    <div className="tic-grid" role="grid" aria-label="Tic-Tac-Toe board">
      {board.map((v, i) => (
        <button
          key={i}
          disabled={!canMove || v !== null}
          onClick={() => onMove({ cell: i })}
          aria-label={v === null ? `Cell ${i + 1}, empty` : `Cell ${i + 1}, ${MARK[v]}`}
        >
          {v === null ? '' : MARK[v]}
        </button>
      ))}
    </div>
  );
}
