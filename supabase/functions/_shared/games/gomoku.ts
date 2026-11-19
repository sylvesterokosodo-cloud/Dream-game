import type { Engine, Idx, Outcome } from './types.ts';
import { assertTurn, lineWin, other } from './types.ts';

export const GOMOKU_SIZE = 15;
export type GomokuState = { board: (Idx | null)[][]; turn: Idx; winner: Idx | null; stones: number };
export type GomokuMove = { r: number; c: number };

export const gomoku: Engine<GomokuState, GomokuMove, GomokuState> = {
  id: 'gomoku',
  init: (_seed, first) => ({
    board: Array.from({ length: GOMOKU_SIZE }, () => Array<Idx | null>(GOMOKU_SIZE).fill(null)),
    turn: first,
    winner: null,
    stones: 0,
  }),
  turn: (s) => (gomoku.outcome(s).done ? null : s.turn),
  apply(s, m, p) {
    if (gomoku.outcome(s).done) throw new Error('Game is over');
    assertTurn(s, p);
    const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < GOMOKU_SIZE;
    if (!ok(m?.r) || !ok(m?.c)) throw new Error('Invalid position');
    if (s.board[m.r][m.c] !== null) throw new Error('Position is taken');
    const board = s.board.map((r) => [...r]);
    board[m.r][m.c] = p; // free-style rules: five or more in a row wins
    return {
      board,
      turn: other(p),
      winner: lineWin(board, m.r, m.c, 5) ? p : null,
      stones: s.stones + 1,
    };
  },
  outcome(s): Outcome {
    if (s.winner !== null) return { done: true, winner: s.winner };
    if (s.stones >= GOMOKU_SIZE * GOMOKU_SIZE) return { done: true, winner: null };
    return { done: false };
  },
  view: (s) => s,
};
