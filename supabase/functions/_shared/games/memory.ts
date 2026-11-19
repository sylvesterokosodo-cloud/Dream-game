import type { Engine, Idx, Outcome } from './types.ts';
import { assertTurn, mulberry32, other, shuffle } from './types.ts';

export const MEMORY_PAIRS = 8;
export type MemoryState = {
  cards: number[]; // SECRET: face value of every card
  matched: (Idx | null)[];
  flipped: number[]; // face-up, unmatched (0-2)
  turn: Idx;
  scores: [number, number];
};
export type MemoryMove = { index: number };
export type MemoryView = {
  cards: number[]; // -1 = face down
  matched: (Idx | null)[];
  flipped: number[];
  turn: Idx;
  scores: [number, number];
};

export const memoryMatch: Engine<MemoryState, MemoryMove, MemoryView> = {
  id: 'memory-match',
  init(seed, first) {
    const faces: number[] = [];
    for (let i = 0; i < MEMORY_PAIRS; i++) faces.push(i, i);
    const cards = shuffle(faces, mulberry32(seed));
    return { cards, matched: cards.map(() => null), flipped: [], turn: first, scores: [0, 0] };
  },
  turn: (s) => (memoryMatch.outcome(s).done ? null : s.turn),
  apply(s, m, p) {
    if (memoryMatch.outcome(s).done) throw new Error('Game is over');
    assertTurn(s, p);
    if (!Number.isInteger(m?.index) || m.index < 0 || m.index >= s.cards.length) {
      throw new Error('Invalid card');
    }
    // A previous mismatch is hidden when the next player acts.
    let flipped = s.flipped.length === 2 ? [] : [...s.flipped];
    if (s.matched[m.index] !== null || flipped.includes(m.index)) throw new Error('Card is not available');
    flipped.push(m.index);
    const matched = [...s.matched];
    const scores: [number, number] = [s.scores[0], s.scores[1]];
    let turn = s.turn;
    if (flipped.length === 2) {
      const [a, b] = flipped;
      if (s.cards[a] === s.cards[b]) {
        matched[a] = p;
        matched[b] = p;
        scores[p] += 1;
        flipped = [];
      } else {
        turn = other(p);
      }
    }
    return { cards: s.cards, matched, flipped, turn, scores };
  },
  outcome(s): Outcome {
    if (s.matched.some((x) => x === null)) return { done: false };
    if (s.scores[0] === s.scores[1]) return { done: true, winner: null };
    return { done: true, winner: s.scores[0] > s.scores[1] ? 0 : 1 };
  },
  view: (s) => ({
    cards: s.cards.map((v, i) => (s.matched[i] !== null || s.flipped.includes(i) ? v : -1)),
    matched: s.matched,
    flipped: s.flipped,
    turn: s.turn,
    scores: s.scores,
  }),
};
