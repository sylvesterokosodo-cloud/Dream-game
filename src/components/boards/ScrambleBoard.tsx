import { useState } from 'react';
import type { BoardProps } from './types';

export default function ScrambleBoard({ view, canMove, onMove, myIndex }: BoardProps) {
  const [guess, setGuess] = useState('');
  const scores: [number, number] = view.scores;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guess.trim()) return;
    onMove({ guess: guess.trim() });
    setGuess('');
  };
  return (
    <div className="scramble">
      <div className="mem-score">
        Round {view.round} of {view.rounds} · You {scores[myIndex]} – {scores[myIndex === 0 ? 1 : 0]} Opponent
      </div>
      <div className="scramble-word" aria-live="polite">
        {String(view.scrambled).toUpperCase().split('').join(' ')}
      </div>
      <form onSubmit={submit} className="scramble-form">
        <input
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          placeholder="Unscramble the word"
          maxLength={40}
          autoComplete="off"
          autoCapitalize="none"
          disabled={!canMove}
          aria-label="Your answer"
        />
        <button className="btn-primary compact" disabled={!canMove}>
          Submit
        </button>
      </form>
      <small className="muted">First to unscramble 2 words wins.</small>
    </div>
  );
}
