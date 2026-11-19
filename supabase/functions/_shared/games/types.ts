// Pure, dependency-free game engines shared by the browser (src/) and the
// Supabase Edge Function `game-action`. NO Deno- or DOM-specific APIs here.
export type Idx = 0 | 1;
export type Outcome = { done: false } | { done: true; winner: Idx | null };

export interface Engine<S = any, M = any, V = any> {
  id: string;
  /** Create a fresh game. `first` moves first in turn-based games. */
  init(seed: number, first: Idx): S;
  /** Whose turn it is; null means both players may act (race games). */
  turn(s: S): Idx | null;
  /** Returns a NEW state or throws Error('...') on an illegal move. */
  apply(s: S, m: M, p: Idx): S;
  outcome(s: S): Outcome;
  /** State safe to send to clients (hides secrets such as face-down cards). */
  view(s: S): V;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const other = (p: Idx): Idx => (p === 0 ? 1 : 0);

/** Does the stone at (r,c) belong to a line of >= need in any direction? */
export function lineWin(
  grid: (Idx | null)[][],
  r: number,
  c: number,
  need: number
): boolean {
  const p = grid[r][c];
  if (p === null) return false;
  const rows = grid.length;
  const cols = grid[0].length;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let n = 1;
    for (const sign of [1, -1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && grid[rr][cc] === p) {
        n++;
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (n >= need) return true;
  }
  return false;
}

export function assertTurn(s: { turn: Idx }, p: Idx): void {
  if (s.turn !== p) throw new Error('It is not your turn');
}
