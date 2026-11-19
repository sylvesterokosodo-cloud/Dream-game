// Run: node --test supabase/functions/_shared/games/tests/   (Node >= 22.18)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENGINES, newGame, publicGame, applyMove, MAX_DRAWS } from "../index.ts";
import { ticTacToe } from "../tictactoe.ts";
import { connect4 } from "../connect4.ts";
import { gomoku } from "../gomoku.ts";
import { memoryMatch } from "../memory.ts";
import { scramble, WORDS } from "../scramble.ts";
import { puzzle, SOLVED } from "../puzzle.ts";
import { chess, fromFen, perft, legalMoves, chessOutcome, startState } from "../chess.ts";
import type { ChessState } from "../chess.ts";

const sq = (name: string) => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);
const mv = (s: ChessState, from: string, to: string, promo?: "q" | "r" | "b" | "n") =>
  chess.apply(s, { from: sq(from), to: sq(to), promo }, s.turn === "w" ? 0 : 1);

test("registry exposes exactly the seven required games", () => {
  assert.deepEqual(Object.keys(ENGINES).sort(),
    ["chess", "connect-4", "gomoku", "memory-match", "puzzle", "scramble", "tic-tac-toe"]);
});

// ---------- tic-tac-toe ----------
test("tic-tac-toe: win, turn order and illegal moves", () => {
  let s = ticTacToe.init(1, 0);
  assert.throws(() => ticTacToe.apply(s, { cell: 0 }, 1), /not your turn/);
  s = ticTacToe.apply(s, { cell: 0 }, 0);
  assert.throws(() => ticTacToe.apply(s, { cell: 0 }, 1), /taken/);
  s = ticTacToe.apply(s, { cell: 3 }, 1);
  s = ticTacToe.apply(s, { cell: 1 }, 0);
  s = ticTacToe.apply(s, { cell: 4 }, 1);
  s = ticTacToe.apply(s, { cell: 2 }, 0);
  assert.deepEqual(ticTacToe.outcome(s), { done: true, winner: 0 });
  assert.throws(() => ticTacToe.apply(s, { cell: 8 }, 1), /over/);
});
test("tic-tac-toe: draw", () => {
  let s = ticTacToe.init(1, 0);
  [0, 1, 2, 4, 3, 5, 7, 6, 8].forEach((c, i) => {
    s = ticTacToe.apply(s, { cell: c }, (i % 2) as 0 | 1);
  });
  assert.deepEqual(ticTacToe.outcome(s), { done: true, winner: null });
});

// ---------- connect 4 ----------
test("connect-4: vertical win, full column, bad input", () => {
  let s = connect4.init(1, 0);
  for (let i = 0; i < 3; i++) {
    s = connect4.apply(s, { col: 0 }, 0);
    s = connect4.apply(s, { col: 1 }, 1);
  }
  s = connect4.apply(s, { col: 0 }, 0);
  assert.deepEqual(connect4.outcome(s), { done: true, winner: 0 });
  assert.throws(() => connect4.apply(connect4.init(1, 0), { col: 9 }, 0), /Invalid/);
  let f = connect4.init(1, 0);
  for (let i = 0; i < 6; i++) f = connect4.apply(f, { col: 2 }, (i % 2) as 0 | 1);
  assert.throws(() => connect4.apply(f, { col: 2 }, 0), /full/);
});
test("connect-4: horizontal win", () => {
  let s = connect4.init(1, 0);
  for (let c = 0; c < 3; c++) {
    s = connect4.apply(s, { col: c }, 0);
    s = connect4.apply(s, { col: c }, 1);
  }
  s = connect4.apply(s, { col: 3 }, 0);
  assert.deepEqual(connect4.outcome(s), { done: true, winner: 0 });
});

// ---------- gomoku ----------
test("gomoku: five in a row wins, four does not", () => {
  let s = gomoku.init(1, 0);
  for (let i = 0; i < 4; i++) {
    s = gomoku.apply(s, { r: 7, c: i }, 0);
    s = gomoku.apply(s, { r: 0, c: i }, 1);
  }
  assert.equal(gomoku.outcome(s).done, false);
  s = gomoku.apply(s, { r: 7, c: 4 }, 0);
  assert.deepEqual(gomoku.outcome(s), { done: true, winner: 0 });
  assert.throws(() => gomoku.apply(gomoku.init(1, 0), { r: 15, c: 0 }, 0), /Invalid/);
});

// ---------- memory ----------
test("memory: hides face-down cards, scores matches, passes turn on mismatch", () => {
  let s = memoryMatch.init(42, 0);
  assert.ok(memoryMatch.view(s).cards.every((c) => c === -1), "nothing revealed at start");
  const a = 0;
  const b = s.cards.findIndex((v, i) => i !== a && v === s.cards[a]);
  const c = s.cards.findIndex((v) => v !== s.cards[a]);
  s = memoryMatch.apply(s, { index: a }, 0);
  s = memoryMatch.apply(s, { index: b }, 0);
  assert.deepEqual(s.scores, [1, 0]);
  assert.equal(s.turn, 0, "matcher keeps the turn");
  assert.equal(memoryMatch.view(s).cards[a], s.cards[a]);
  s = memoryMatch.apply(s, { index: c }, 0);
  const d = s.cards.findIndex((v, i) => i !== c && s.matched[i] === null && v !== s.cards[c]);
  s = memoryMatch.apply(s, { index: d }, 0);
  assert.equal(s.turn, 1, "mismatch passes the turn");
  assert.equal(memoryMatch.view(s).cards.filter((x) => x !== -1).length, 4);
  assert.throws(() => memoryMatch.apply(s, { index: 5 }, 0), /not your turn/);
});
test("memory: a full game ends with the right winner", () => {
  let s = memoryMatch.init(7, 0);
  for (let i = 0; i < 16; i++) {
    if (s.matched[i] !== null) continue;
    const j = s.cards.findIndex((v, k) => k !== i && v === s.cards[i] && s.matched[k] === null);
    s = memoryMatch.apply(s, { index: i }, 0);
    s = memoryMatch.apply(s, { index: j }, 0);
  }
  assert.deepEqual(memoryMatch.outcome(s), { done: true, winner: 0 });
});

// ---------- scramble ----------
test("scramble: first to two words wins; answers never leak in the view", () => {
  let s = scramble.init(99, 0);
  const view = JSON.stringify(scramble.view(s));
  for (const w of s.words) assert.ok(!view.includes(`"${w}"`), "answer must not be in the view");
  s.words.forEach((w, i) => {
    assert.notEqual(s.scrambled[i], w);
    assert.deepEqual([...w].sort(), [...s.scrambled[i]].sort());
  });
  assert.deepEqual(scramble.apply(s, { guess: "wrong" }, 0), s);
  s = scramble.apply(s, { guess: s.words[0].toUpperCase() }, 1);
  s = scramble.apply(s, { guess: s.words[1] }, 1);
  assert.deepEqual(scramble.outcome(s), { done: true, winner: 1 });
  assert.ok(WORDS.length >= 20);
});

// ---------- puzzle ----------
test("puzzle: start is solvable, unsolved and identical for both players", () => {
  const s = puzzle.init(5, 0);
  assert.deepEqual(s.boards[0], s.boards[1]);
  assert.notDeepEqual(s.boards[0], SOLVED);
  const inv = s.boards[0].filter((x) => x)
    .reduce((n, v, i, a) => n + a.slice(i + 1).filter((w) => w < v).length, 0);
  assert.equal(inv % 2, 0, "even inversion count => solvable");
  assert.throws(() => puzzle.apply(s, { tile: s.boards[0].indexOf(0) }, 0), /cannot move/);
});
test("puzzle: a BFS-computed solution applied through the engine wins", () => {
  const start = puzzle.init(11, 0).boards[0];
  const key = (b: number[]) => b.join("");
  const prev = new Map<string, { from: string; tile: number } | null>([[key(start), null]]);
  const q = [start];
  const goal = key(SOLVED);
  while (q.length && !prev.has(goal)) {
    const b = q.shift()!;
    const z = b.indexOf(0);
    const r = Math.floor(z / 3), c = z % 3;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr > 2 || cc < 0 || cc > 2) continue;
      const t = rr * 3 + cc;
      const n = [...b]; n[z] = n[t]; n[t] = 0;
      if (!prev.has(key(n))) { prev.set(key(n), { from: key(b), tile: t }); q.push(n); }
    }
  }
  const path: number[] = [];
  for (let k = goal; prev.get(k); k = prev.get(k)!.from) path.unshift(prev.get(k)!.tile);
  let s = puzzle.init(11, 0);
  for (const tile of path) s = puzzle.apply(s, { tile }, 1);
  assert.deepEqual(puzzle.outcome(s), { done: true, winner: 1 });
});

// ---------- chess: move generation verified against published perft values ----------
test("chess perft: starting position (20 / 400 / 8902)", () => {
  const s = startState();
  assert.equal(perft(s, 1), 20);
  assert.equal(perft(s, 2), 400);
  assert.equal(perft(s, 3), 8902);
});
test("chess perft: kiwipete - castling, en passant, promotion, pins (48 / 2039 / 97862)", () => {
  const s = fromFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
  assert.equal(perft(s, 1), 48);
  assert.equal(perft(s, 2), 2039);
  assert.equal(perft(s, 3), 97862);
});
test("chess perft: endgame with en-passant pins (14 / 191 / 2812)", () => {
  const s = fromFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1");
  assert.equal(perft(s, 1), 14);
  assert.equal(perft(s, 2), 191);
  assert.equal(perft(s, 3), 2812);
});
test("chess perft: promotion-heavy position (6 / 264 / 9467)", () => {
  const s = fromFen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1");
  assert.equal(perft(s, 1), 6);
  assert.equal(perft(s, 2), 264);
  assert.equal(perft(s, 3), 9467);
});

test("chess: fool's mate ends the game with black winning", () => {
  let s = startState();
  s = mv(s, "f2", "f3"); s = mv(s, "e7", "e5"); s = mv(s, "g2", "g4"); s = mv(s, "d8", "h4");
  assert.deepEqual(chessOutcome(s), { done: true, winner: 1 });
  assert.equal(legalMoves(s).length, 0);
});
test("chess: stalemate is a draw", () => {
  const s = fromFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.deepEqual(chessOutcome(s), { done: true, winner: null });
});
test("chess: illegal moves, wrong turn and pinned pieces are rejected", () => {
  const s = startState();
  assert.throws(() => chess.apply(s, { from: sq("e2"), to: sq("e5") }, 0), /Illegal/);
  assert.throws(() => chess.apply(s, { from: sq("e7"), to: sq("e5") }, 1), /not your turn/);
  const pinned = fromFen("4r2k/8/8/8/8/8/4B3/4K3 w - - 0 1");
  assert.throws(() => chess.apply(pinned, { from: sq("e2"), to: sq("d3") }, 0), /Illegal/);
});
test("chess: castling, en passant and promotion", () => {
  let s = fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  s = mv(s, "e1", "g1");
  assert.equal(s.board[sq("f1")], "R");
  assert.equal(s.board[sq("g1")], "K");
  assert.ok(!s.castling.includes("K") && !s.castling.includes("Q"));
  let e = fromFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  e = mv(e, "e5", "d6");
  assert.equal(e.board[sq("d5")], "", "captured pawn removed");
  let p = fromFen("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  p = mv(p, "a7", "a8", "n");
  assert.equal(p.board[sq("a8")], "N");
  const through = fromFen("4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1");
  assert.ok(!legalMoves(through).some((m) => m.from === sq("e1") && m.to === sq("g1")));
});
test("chess: threefold repetition and insufficient material are draws", () => {
  let s = fromFen("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
  for (let i = 0; i < 2; i++) {
    s = mv(s, "a1", "a2"); s = mv(s, "e8", "d8"); s = mv(s, "a2", "a1"); s = mv(s, "d8", "e8");
  }
  assert.deepEqual(chessOutcome(s), { done: true, winner: null });
  assert.deepEqual(chessOutcome(fromFen("4k3/8/8/8/8/8/8/4KB2 w - - 0 1")), { done: true, winner: null });
});
test("chess: colours swap after a drawn game", () => {
  const g0 = chess.init(1, 0);
  const g1 = chess.init(1, 1);
  assert.equal(chess.turn(g0), 0);
  assert.equal(chess.turn(g1), 1);
  assert.throws(() => chess.apply(g1, { from: sq("e2"), to: sq("e4") }, 0), /not your turn/);
  chess.apply(g1, { from: sq("e2"), to: sq("e4") }, 1);
});

// ---------- registry helpers ----------
test("registry: round-trip, first-mover swap on rematch, jsonb-safe state", () => {
  let g = newGame("tic-tac-toe", 1, 0);
  assert.equal(publicGame("tic-tac-toe", g).turn, 0);
  g = applyMove("tic-tac-toe", g, { cell: 4 }, 0);
  assert.equal(publicGame("tic-tac-toe", g).turn, 1);
  assert.equal(publicGame("tic-tac-toe", newGame("tic-tac-toe", 1, 1)).turn, 1);
  assert.throws(() => newGame("rock-paper-scissors", 1, 0), /Unknown game/);
  assert.equal(MAX_DRAWS, 3);
  for (const id of Object.keys(ENGINES)) {
    const full = newGame(id, 3, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(full)), full, `${id} state must survive JSON`);
  }
});
