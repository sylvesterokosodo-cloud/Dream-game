import type { Engine, Idx, Outcome } from "./types.ts";
import { ticTacToe } from "./tictactoe.ts";
import { connect4 } from "./connect4.ts";
import { gomoku } from "./gomoku.ts";
import { memoryMatch } from "./memory.ts";
import { scramble } from "./scramble.ts";
import { puzzle } from "./puzzle.ts";
import { chess } from "./chess.ts";

export type { Idx, Outcome, Engine } from "./types.ts";

export const ENGINES: Record<string, Engine> = {
  "tic-tac-toe": ticTacToe,
  "connect-4": connect4,
  gomoku,
  "memory-match": memoryMatch,
  scramble,
  puzzle,
  chess,
};

/** Games that can end in a draw (replayed up to MAX_DRAWS times, then admin decides). */
export const MAX_DRAWS = 3;

export type FullGame = { state: unknown; draws: number };
export type PublicGame = {
  game: string;
  draws: number;
  turn: Idx | null;
  outcome: Outcome;
  view: unknown;
};

export function engineFor(gameId: string): Engine {
  const e = ENGINES[gameId];
  if (!e) throw new Error(`Unknown game: ${gameId}`);
  return e;
}

/** Colours / first move swap after every drawn game. */
export function newGame(gameId: string, seed: number, draws: number): FullGame {
  return { state: engineFor(gameId).init(seed, (draws % 2) as Idx), draws };
}

export function publicGame(gameId: string, full: FullGame): PublicGame {
  const e = engineFor(gameId);
  return {
    game: gameId,
    draws: full.draws,
    turn: e.turn(full.state),
    outcome: e.outcome(full.state),
    view: e.view(full.state),
  };
}

export function applyMove(gameId: string, full: FullGame, move: unknown, player: Idx): FullGame {
  return { state: engineFor(gameId).apply(full.state, move, player), draws: full.draws };
}
