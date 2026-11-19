export type BoardProps = {
  /** engine.view() output for this game (shape differs per game) */
  // deno-lint-ignore no-explicit-any
  view: any;
  myIndex: 0 | 1;
  /** true when the server/engine will accept a move from this player right now */
  canMove: boolean;
  onMove: (move: unknown) => void;
};
