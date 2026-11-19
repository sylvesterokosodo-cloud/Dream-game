import type { Engine, Idx, Outcome } from "./types.ts";

// Board: 64 squares, index = rank*8 + file, rank 0 = rank 8 (black back rank).
// Pieces: uppercase = white (player 0), lowercase = black (player 1), "" = empty.
export type Color = "w" | "b";
export type ChessState = {
  board: string[];
  turn: Color;
  castling: string; // subset of "KQkq"
  ep: number; // en-passant target square or -1
  half: number; // half-move clock (50-move rule)
  full: number;
  rep: Record<string, number>; // position-key -> occurrences
  white?: Idx; // which player index plays white (swaps after a drawn game)
};
export type ChessMove = { from: number; to: number; promo?: "q" | "r" | "b" | "n" };
export type ChessView = ChessState & {
  legal: ChessMove[];
  inCheck: boolean;
  lastResult: string | null;
};

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const colorOf = (p: string): Color | null => (p === "" ? null : p === p.toUpperCase() ? "w" : "b");
const opp = (c: Color): Color => (c === "w" ? "b" : "w");
const inBoard = (r: number, f: number) => r >= 0 && r < 8 && f >= 0 && f < 8;

export function startState(): ChessState {
  return fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
}

export function fromFen(fen: string): ChessState {
  const [place, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const board: string[] = [];
  for (const ch of place) {
    if (ch === "/") continue;
    if (/[1-8]/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push("");
    else board.push(ch);
  }
  if (board.length !== 64) throw new Error("Bad FEN");
  const s: ChessState = {
    board,
    turn: turn === "b" ? "b" : "w",
    castling: castling && castling !== "-" ? castling : "",
    ep: ep && ep !== "-" ? (8 - Number(ep[1])) * 8 + (ep.charCodeAt(0) - 97) : -1,
    half: Number(half ?? 0) || 0,
    full: Number(full ?? 1) || 1,
    rep: {},
  };
  s.rep[posKey(s)] = 1;
  return s;
}

function posKey(s: ChessState): string {
  return s.board.map((p) => p || ".").join("") + s.turn + s.castling + s.ep;
}

export function isAttacked(board: string[], sq: number, by: Color): boolean {
  const r = Math.floor(sq / 8);
  const f = sq % 8;
  const up = by === "w" ? 1 : -1; // white pawns sit below the square they attack
  const pawn = by === "w" ? "P" : "p";
  for (const df of [-1, 1]) {
    if (inBoard(r + up, f + df) && board[(r + up) * 8 + f + df] === pawn) return true;
  }
  const knight = by === "w" ? "N" : "n";
  for (const [dr, df] of KNIGHT) {
    if (inBoard(r + dr, f + df) && board[(r + dr) * 8 + f + df] === knight) return true;
  }
  const king = by === "w" ? "K" : "k";
  for (const [dr, df] of KING) {
    if (inBoard(r + dr, f + df) && board[(r + dr) * 8 + f + df] === king) return true;
  }
  const slide = (dirs: number[][], a: string, b: string) => {
    for (const [dr, df] of dirs) {
      let rr = r + dr;
      let ff = f + df;
      while (inBoard(rr, ff)) {
        const p = board[rr * 8 + ff];
        if (p !== "") {
          if (p === a || p === b) return true;
          break;
        }
        rr += dr;
        ff += df;
      }
    }
    return false;
  };
  const Q = by === "w" ? "Q" : "q";
  return slide(BISHOP, by === "w" ? "B" : "b", Q) || slide(ROOK, by === "w" ? "R" : "r", Q);
}

function pseudoMoves(s: ChessState): ChessMove[] {
  const out: ChessMove[] = [];
  const me = s.turn;
  const b = s.board;
  for (let sq = 0; sq < 64; sq++) {
    const piece = b[sq];
    if (piece === "" || colorOf(piece) !== me) continue;
    const r = Math.floor(sq / 8);
    const f = sq % 8;
    const kind = piece.toLowerCase();
    if (kind === "p") {
      const dir = me === "w" ? -1 : 1;
      const startRank = me === "w" ? 6 : 1;
      const lastRank = me === "w" ? 0 : 7;
      const push = (to: number) => {
        if (Math.floor(to / 8) === lastRank) {
          for (const promo of ["q", "r", "b", "n"] as const) out.push({ from: sq, to, promo });
        } else out.push({ from: sq, to });
      };
      if (inBoard(r + dir, f) && b[(r + dir) * 8 + f] === "") {
        push((r + dir) * 8 + f);
        if (r === startRank && b[(r + 2 * dir) * 8 + f] === "") out.push({ from: sq, to: (r + 2 * dir) * 8 + f });
      }
      for (const df of [-1, 1]) {
        if (!inBoard(r + dir, f + df)) continue;
        const to = (r + dir) * 8 + f + df;
        if ((b[to] !== "" && colorOf(b[to]) === opp(me)) || to === s.ep) push(to);
      }
    } else if (kind === "n" || kind === "k") {
      for (const [dr, df] of kind === "n" ? KNIGHT : KING) {
        if (!inBoard(r + dr, f + df)) continue;
        const to = (r + dr) * 8 + f + df;
        if (colorOf(b[to]) !== me) out.push({ from: sq, to });
      }
      if (kind === "k") {
        const home = me === "w" ? 60 : 4;
        if (sq === home && !isAttacked(b, sq, opp(me))) {
          const K = me === "w" ? "K" : "k";
          const Q = me === "w" ? "Q" : "q";
          const rook = me === "w" ? "R" : "r";
          if (s.castling.includes(K) && b[home + 1] === "" && b[home + 2] === "" && b[home + 3] === rook &&
              !isAttacked(b, home + 1, opp(me)) && !isAttacked(b, home + 2, opp(me))) {
            out.push({ from: sq, to: home + 2 });
          }
          if (s.castling.includes(Q) && b[home - 1] === "" && b[home - 2] === "" && b[home - 3] === "" &&
              b[home - 4] === rook && !isAttacked(b, home - 1, opp(me)) && !isAttacked(b, home - 2, opp(me))) {
            out.push({ from: sq, to: home - 2 });
          }
        }
      }
    } else {
      const dirs = kind === "b" ? BISHOP : kind === "r" ? ROOK : [...BISHOP, ...ROOK];
      for (const [dr, df] of dirs) {
        let rr = r + dr;
        let ff = f + df;
        while (inBoard(rr, ff)) {
          const to = rr * 8 + ff;
          const c = colorOf(b[to]);
          if (c === me) break;
          out.push({ from: sq, to });
          if (c !== null) break;
          rr += dr;
          ff += df;
        }
      }
    }
  }
  return out;
}

function make(s: ChessState, m: ChessMove): ChessState {
  const board = [...s.board];
  const piece = board[m.from];
  const kind = piece.toLowerCase();
  const me = s.turn;
  const captured = board[m.to];
  board[m.to] = piece;
  board[m.from] = "";
  let ep = -1;
  if (kind === "p") {
    if (m.to === s.ep && captured === "") board[m.to + (me === "w" ? 8 : -8)] = ""; // en passant
    if (Math.abs(m.to - m.from) === 16) ep = (m.to + m.from) / 2;
    if (m.promo) board[m.to] = me === "w" ? m.promo.toUpperCase() : m.promo;
  }
  if (kind === "k" && Math.abs(m.to - m.from) === 2) {
    if (m.to > m.from) { board[m.to - 1] = board[m.to + 1]; board[m.to + 1] = ""; }
    else { board[m.to + 1] = board[m.to - 2]; board[m.to - 2] = ""; }
  }
  let castling = s.castling;
  const strip = (chars: string) => { for (const ch of chars) castling = castling.replace(ch, ""); };
  if (piece === "K") strip("KQ");
  if (piece === "k") strip("kq");
  for (const sq of [m.from, m.to]) {
    if (sq === 63) strip("K");
    if (sq === 56) strip("Q");
    if (sq === 7) strip("k");
    if (sq === 0) strip("q");
  }
  const next: ChessState = {
    board,
    turn: opp(me),
    castling,
    ep,
    half: kind === "p" || captured !== "" ? 0 : s.half + 1,
    full: me === "b" ? s.full + 1 : s.full,
    rep: {},
  };
  const irreversible = kind === "p" || captured !== "";
  next.rep = irreversible ? {} : { ...s.rep };
  const k = posKey(next);
  next.rep[k] = (next.rep[k] ?? 0) + 1;
  return next;
}

export function legalMoves(s: ChessState): ChessMove[] {
  const king = s.turn === "w" ? "K" : "k";
  return pseudoMoves(s).filter((m) => {
    const n = make(s, m);
    const ksq = n.board.indexOf(king);
    return ksq >= 0 && !isAttacked(n.board, ksq, n.turn);
  });
}

export const inCheck = (s: ChessState): boolean => {
  const ksq = s.board.indexOf(s.turn === "w" ? "K" : "k");
  return ksq >= 0 && isAttacked(s.board, ksq, opp(s.turn));
};

export function perft(s: ChessState, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legalMoves(s)) n += depth === 1 ? 1 : perft(make(s, m), depth - 1);
  return n;
}

function insufficientMaterial(b: string[]): boolean {
  const pieces = b.filter((p) => p !== "" && p.toLowerCase() !== "k");
  if (pieces.length === 0) return true;
  if (pieces.length === 1 && ["b", "n"].includes(pieces[0].toLowerCase())) return true;
  return false;
}

export function chessOutcome(s: ChessState): Outcome {
  if (legalMoves(s).length === 0) {
    return { done: true, winner: inCheck(s) ? (s.turn === "w" ? 1 : 0) : null };
  }
  if (s.half >= 100 || insufficientMaterial(s.board)) return { done: true, winner: null };
  if (Object.values(s.rep).some((n) => n >= 3)) return { done: true, winner: null };
  return { done: false };
}

/** Player index sitting on the given colour. */
export const seatOf = (s: ChessState, c: Color): Idx => {
  const white: Idx = s.white ?? 0;
  return c === "w" ? white : ((1 - white) as Idx);
};

export const chess: Engine<ChessState, ChessMove, ChessView> = {
  id: "chess",
  init: (_seed, first) => ({ ...startState(), white: first }),
  turn: (s) => (chessOutcome(s).done ? null : seatOf(s, s.turn)),
  apply(s, m, p: Idx) {
    if (chessOutcome(s).done) throw new Error("Game is over");
    if (seatOf(s, s.turn) !== p) throw new Error("It is not your turn");
    if (!Number.isInteger(m?.from) || !Number.isInteger(m?.to)) throw new Error("Invalid move");
    const wantPromo = m.promo ?? "q";
    const found = legalMoves(s).find(
      (x) => x.from === m.from && x.to === m.to && (x.promo === undefined || x.promo === wantPromo)
    );
    if (!found) throw new Error("Illegal move");
    return make(s, found);
  },
  outcome: chessOutcome,
  view: (s) => ({ ...s, legal: legalMoves(s), inCheck: inCheck(s), lastResult: null }),
};
