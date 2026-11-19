import type { Engine, Idx, Outcome } from './types.ts';
import { assertTurn, lineWin, other } from './types.ts';

export const C4_ROWS = 6;
export const C4_COLS = 7;
export type C4State = { board: (Idx | null)[][]; turn: Idx; winner: Idx | null };
export type C4Move = { col: number };

export const connect4: Engine<C4State, C4Move, C4State> = {
  id: 'connect-4',
  init: (_seed, first) => ({
    board: Array.from({ length: C4_ROWS }, () => Array<Idx | null>(C4_COLS).fill(null)),
    turn: first,
    winner: null,
  }),
  turn: (s) => (connect4.outcome(s).done ? null : s.turn),
  apply(s, m, p) {
    if (connect4.outcome(s).done) throw new Error('Game is over');
    assertTurn(s, p);
    if (!Number.isInteger(m?.col) || m.col < 0 || m.col >= C4_COLS) throw new Error('Invalid column');
    let row = -1;
    for (let r = C4_ROWS - 1; r >= 0; r--) {
      if (s.board[r][m.col] === null) { row = r; break; }
    }
    if (row < 0) throw new Error('Column is full');
    const board = s.board.map((r) => [...r]);
    board[row][m.col] = p;
    return { board, turn: other(p), winner: lineWin(board, row, m.col, 4) ? p : null };
  },
  outcome(s): Outcome {
    if (s.winner !== null) return { done: true, winner: s.winner };
    if (s.board[0].every((c) => c !== null)) return { done: true, winner: null };
    return { done: false };
  },
  view: (s) => s,
};
