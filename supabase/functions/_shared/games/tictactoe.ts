import type { Engine, Idx, Outcome } from './types.ts';
import { assertTurn, other } from './types.ts';

export type TttState = { board: (Idx | null)[]; turn: Idx; winner: Idx | null };
export type TttMove = { cell: number };

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6],
];

export const ticTacToe: Engine<TttState, TttMove, TttState> = {
  id: 'tic-tac-toe',
  init: (_seed, first) => ({ board: Array(9).fill(null), turn: first, winner: null }),
  turn: (s) => (s.winner !== null || s.board.every((c) => c !== null) ? null : s.turn),
  apply(s, m, p) {
    if (this.outcome(s).done) throw new Error('Game is over');
    assertTurn(s, p);
    if (!Number.isInteger(m?.cell) || m.cell < 0 || m.cell > 8) throw new Error('Invalid cell');
    if (s.board[m.cell] !== null) throw new Error('Cell is taken');
    const board = [...s.board];
    board[m.cell] = p;
    const won = LINES.some(([a, b, c]) => board[a] === p && board[b] === p && board[c] === p);
    return { board, turn: other(p), winner: won ? p : null };
  },
  outcome(s): Outcome {
    if (s.winner !== null) return { done: true, winner: s.winner };
    if (s.board.every((c) => c !== null)) return { done: true, winner: null };
    return { done: false };
  },
  view: (s) => s,
};
