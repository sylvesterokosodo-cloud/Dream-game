import type { BoardProps } from './boards/types';
import TicTacToeBoard from './boards/TicTacToeBoard';
import Connect4Board from './boards/Connect4Board';
import GomokuBoard from './boards/GomokuBoard';
import MemoryBoard from './boards/MemoryBoard';
import ScrambleBoard from './boards/ScrambleBoard';
import PuzzleBoard from './boards/PuzzleBoard';
import ChessBoard from './boards/ChessBoard';

export default function GameBoard({ game, ...props }: BoardProps & { game: string }) {
  switch (game) {
    case 'tic-tac-toe': return <TicTacToeBoard {...props} />;
    case 'connect-4': return <Connect4Board {...props} />;
    case 'gomoku': return <GomokuBoard {...props} />;
    case 'memory-match': return <MemoryBoard {...props} />;
    case 'scramble': return <ScrambleBoard {...props} />;
    case 'puzzle': return <PuzzleBoard {...props} />;
    case 'chess': return <ChessBoard {...props} />;
    default: return <p className="muted">Unsupported game: {game}</p>;
  }
}
