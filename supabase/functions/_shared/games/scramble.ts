import type { Engine, Idx, Outcome } from './types.ts';
import { mulberry32, shuffle } from './types.ts';

export const WORDS = [
  'tournament', 'champion', 'strategy', 'victory', 'challenge', 'keyboard', 'umbrella',
  'mountain', 'elephant', 'football', 'diamond', 'journey', 'whisper', 'lantern',
  'thunder', 'blanket', 'compass', 'harvest', 'library', 'machine', 'network',
  'orchard', 'pattern', 'quantum', 'rainbow', 'station', 'texture', 'village',
  'warrior', 'yellow', 'bicycle', 'chimney', 'dolphin', 'eclipse', 'fortune',
  'gallery', 'horizon', 'island', 'jungle', 'kitchen', 'lemonade', 'monster',
  'nursery', 'outside', 'penguin', 'rocket', 'sunrise', 'tropical', 'voyage', 'window',
];
export const SCRAMBLE_ROUNDS = 3;
export const SCRAMBLE_TO_WIN = 2;

export type ScrambleState = {
  words: string[]; // SECRET answers
  scrambled: string[];
  idx: number;
  scores: [number, number];
};
export type ScrambleMove = { guess: string };
export type ScrambleView = { scrambled: string; round: number; rounds: number; scores: [number, number] };

export function scrambleWord(word: string, rnd: () => number): string {
  const letters = word.split('');
  for (let i = 0; i < 20; i++) {
    const s = shuffle(letters, rnd).join('');
    if (s !== word) return s;
  }
  return letters.reverse().join('');
}

export const scramble: Engine<ScrambleState, ScrambleMove, ScrambleView> = {
  id: 'scramble',
  init(seed) {
    const rnd = mulberry32(seed);
    const words = shuffle(WORDS, rnd).slice(0, SCRAMBLE_ROUNDS);
    return { words, scrambled: words.map((w) => scrambleWord(w, rnd)), idx: 0, scores: [0, 0] };
  },
  turn: () => null,
  apply(s, m, p: Idx) {
    if (scramble.outcome(s).done) throw new Error('Game is over');
    if (typeof m?.guess !== 'string' || m.guess.length > 40) throw new Error('Invalid guess');
    if (m.guess.trim().toLowerCase() !== s.words[s.idx]) return s; // wrong guess: no change
    const scores: [number, number] = [s.scores[0], s.scores[1]];
    scores[p] += 1;
    return { ...s, idx: s.idx + 1, scores };
  },
  outcome(s): Outcome {
    if (s.scores[0] >= SCRAMBLE_TO_WIN) return { done: true, winner: 0 };
    if (s.scores[1] >= SCRAMBLE_TO_WIN) return { done: true, winner: 1 };
    if (s.idx >= SCRAMBLE_ROUNDS) {
      return { done: true, winner: s.scores[0] === s.scores[1] ? null : s.scores[0] > s.scores[1] ? 0 : 1 };
    }
    return { done: false };
  },
  view: (s) => ({
    scrambled: s.scrambled[Math.min(s.idx, SCRAMBLE_ROUNDS - 1)],
    round: Math.min(s.idx + 1, SCRAMBLE_ROUNDS),
    rounds: SCRAMBLE_ROUNDS,
    scores: s.scores,
  }),
};
