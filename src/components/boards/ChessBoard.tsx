import { useMemo, useState } from 'react';
import type { BoardProps } from './types';

const GLYPH: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

type Mv = { from: number; to: number; promo?: string };

export default function ChessBoard({ view, canMove, onMove, myIndex }: BoardProps) {
  const [sel, setSel] = useState<number | null>(null);
  const board: string[] = view.board;
  const legal: Mv[] = view.legal ?? [];
  const iAmWhite = (view.white ?? 0) === myIndex;
  const targets = useMemo(
    () => new Set(legal.filter((m) => m.from === sel).map((m) => m.to)),
    [legal, sel]
  );
  const order = [...Array(64).keys()];
  if (!iAmWhite) order.reverse(); // black sees the board from their side

  const click = (sq: number) => {
    if (!canMove) return;
    if (sel !== null && targets.has(sq)) {
      onMove({ from: sel, to: sq, promo: 'q' }); // auto-queen
      setSel(null);
      return;
    }
    const mine = legal.some((m) => m.from === sq);
    setSel(mine ? sq : null);
  };

  return (
    <div>
      <div className="mem-score">
        You play {iAmWhite ? 'White' : 'Black'} {view.inCheck ? ' · CHECK!' : ''}
      </div>
      <div className="chess" role="grid" aria-label="Chess board">
        {order.map((sq) => {
          const dark = (Math.floor(sq / 8) + (sq % 8)) % 2 === 1;
          const cls =
            'chess-sq' + (dark ? ' dark' : '') + (sel === sq ? ' sel' : '') + (targets.has(sq) ? ' target' : '');
          return (
            <button key={sq} className={cls} onClick={() => click(sq)} disabled={!canMove}
              aria-label={`${'abcdefgh'[sq % 8]}${8 - Math.floor(sq / 8)} ${board[sq] || 'empty'}`}>
              {board[sq] ? GLYPH[board[sq]] : ''}
            </button>
          );
        })}
      </div>
      <small className="muted">Tap a piece, then a highlighted square. Pawns auto-promote to a queen.</small>
    </div>
  );
}
