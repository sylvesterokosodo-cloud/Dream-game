import type { BoardProps } from './types';

const FACES = ['🍎', '🚀', '⚽', '🎲', '🌙', '🔥', '🎵', '🐢'];

export default function MemoryBoard({ view, canMove, onMove, myIndex }: BoardProps) {
  const cards: number[] = view.cards;
  const matched: (0 | 1 | null)[] = view.matched;
  const scores: [number, number] = view.scores;
  return (
    <div>
      <div className="mem-score">
        You {scores[myIndex]} – {scores[myIndex === 0 ? 1 : 0]} Opponent
      </div>
      <div className="mem-grid">
        {cards.map((v, i) => (
          <button
            key={i}
            className={'mem-card' + (v >= 0 ? ' up' : '') + (matched[i] !== null ? ' done' : '')}
            disabled={!canMove || v >= 0}
            onClick={() => onMove({ index: i })}
            aria-label={v >= 0 ? `Card ${i + 1}: ${FACES[v]}` : `Card ${i + 1}, face down`}
          >
            {v >= 0 ? FACES[v] : '?'}
          </button>
        ))}
      </div>
    </div>
  );
}
