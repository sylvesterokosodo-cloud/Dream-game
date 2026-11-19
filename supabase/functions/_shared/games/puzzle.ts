import type { Engine, Idx, Outcome } from './types.ts';
import { mulberry32 } from './types.ts';

// Race: both players get the SAME shuffled 3x3 sliding puzzle. First to solve wins.
export const SOLVED = [1, 2, 3, 4, 5, 6, 7, 8, 0];
export type PuzzleState = {
  boards: [number[], number[]];
  moves: [number, number];
  winner: Idx | null;
};
export type PuzzleMove = { tile: number }; // board index of the tile to slide into the blank

const neighbours = (i: number): number[] => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  const out: number[] = [];
  if (r > 0) out.push(i - 3);
  if (r < 2) out.push(i + 3);
  if (c > 0) out.push(i - 1);
  if (c < 2) out.push(i + 1);
  return out;
};
const isSolved = (b: number[]) => b.every((v, i) => v === SOLVED[i]);

export const puzzle: Engine<PuzzleState, PuzzleMove, PuzzleState> = {
  id: 'puzzle',
  init(seed) {
    const rnd = mulberry32(seed);
    let b = [...SOLVED];
    let blank = 8;
    let prev = -1;
    // Random walk from the solved state => always solvable.
    for (let i = 0; i < 120 || isSolved(b); i++) {
      const opts = neighbours(blank).filter((n) => n !== prev);
      const n = opts[Math.floor(rnd() * opts.length)];
      b[blank] = b[n];
      b[n] = 0;
      prev = blank;
      blank = n;
    }
    return { boards: [[...b], [...b]], moves: [0, 0], winner: null };
  },
  turn: () => null,
  apply(s, m, p) {
    if (s.winner !== null) throw new Error('Game is over');
    if (!Number.isInteger(m?.tile) || m.tile < 0 || m.tile > 8) throw new Error('Invalid tile');
    const board = [...s.boards[p]];
    const blank = board.indexOf(0);
    if (!neighbours(blank).includes(m.tile)) throw new Error('Tile cannot move');
    board[blank] = board[m.tile];
    board[m.tile] = 0;
    const boards: [number[], number[]] = [s.boards[0], s.boards[1]];
    boards[p] = board;
    const moves: [number, number] = [s.moves[0], s.moves[1]];
    moves[p] += 1;
    return { boards, moves, winner: isSolved(board) ? p : null };
  },
  outcome: (s): Outcome => (s.winner !== null ? { done: true, winner: s.winner } : { done: false }),
  view: (s) => s,
};
