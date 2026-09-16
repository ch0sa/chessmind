/**
 * @module fen-utils
 * FEN string parsing, validation, and generation utilities for ChessMind.
 */

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

const FEN_TO_PIECE = {
  'K': { color: 'white', role: 'king' },
  'Q': { color: 'white', role: 'queen' },
  'R': { color: 'white', role: 'rook' },
  'B': { color: 'white', role: 'bishop' },
  'N': { color: 'white', role: 'knight' },
  'P': { color: 'white', role: 'pawn' },
  'k': { color: 'black', role: 'king' },
  'q': { color: 'black', role: 'queen' },
  'r': { color: 'black', role: 'rook' },
  'b': { color: 'black', role: 'bishop' },
  'n': { color: 'black', role: 'knight' },
  'p': { color: 'black', role: 'pawn' }
};

const PIECE_TO_FEN = {
  'white-king': 'K', 'white-queen': 'Q', 'white-rook': 'R',
  'white-bishop': 'B', 'white-knight': 'N', 'white-pawn': 'P',
  'black-king': 'k', 'black-queen': 'q', 'black-rook': 'r',
  'black-bishop': 'b', 'black-knight': 'n', 'black-pawn': 'p'
};

/**
 * Converts a square name to 0-indexed coordinates.
 * @param {string} square - e.g., 'e4'
 * @returns {{file: number, rank: number} | null}
 */
export function squareToCoords(square) {
  if (!square || square.length !== 2) return null;
  const file = FILES.indexOf(square[0].toLowerCase());
  const rank = RANKS.indexOf(square[1]);
  if (file === -1 || rank === -1) return null;
  return { file, rank };
}

/**
 * Converts 0-indexed coordinates to a square name.
 * @param {number} file - 0 to 7
 * @param {number} rank - 0 to 7
 * @returns {string | null}
 */
export function coordsToSquare(file, rank) {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return FILES[file] + RANKS[rank];
}

/**
 * Validates a board map position for legality.
 * @param {Map|Object} boardMap - Map or Object of square to {color, role}
 * @returns {{isLegal: boolean, errors: string[], warnings: string[]}}
 */
export function validatePosition(boardMap) {
  const errors = [];
  const warnings = [];
  
  let whiteKings = 0, blackKings = 0;
  let whitePieces = 0, blackPieces = 0;
  let whitePawns = 0, blackPawns = 0;

  const entries = boardMap instanceof Map ? Array.from(boardMap.entries()) : Object.entries(boardMap);

  for (const [square, piece] of entries) {
    if (!piece || !piece.color || !piece.role) continue;
    
    const rankChar = square[1];
    
    if (piece.color === 'white') {
      whitePieces++;
      if (piece.role === 'king') whiteKings++;
      if (piece.role === 'pawn') {
        whitePawns++;
        if (rankChar === '1' || rankChar === '8') errors.push(`White pawn on invalid rank ${rankChar} (${square})`);
      }
    } else if (piece.color === 'black') {
      blackPieces++;
      if (piece.role === 'king') blackKings++;
      if (piece.role === 'pawn') {
        blackPawns++;
        if (rankChar === '1' || rankChar === '8') errors.push(`Black pawn on invalid rank ${rankChar} (${square})`);
      }
    }
  }

  if (whiteKings === 0) errors.push('No white king found on the board.');
  if (blackKings === 0) errors.push('No black king found on the board.');
  if (whitePieces > 16) errors.push('More than 16 white pieces on the board.');
  if (blackPieces > 16) errors.push('More than 16 black pieces on the board.');
  
  if (whiteKings > 1) warnings.push('More than one white king on the board.');
  if (blackKings > 1) warnings.push('More than one black king on the board.');
  if (whitePawns > 8) warnings.push('More than 8 white pawns on the board.');
  if (blackPawns > 8) warnings.push('More than 8 black pawns on the board.');
  
  return {
    isLegal: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Parses a FEN string forgivingly, returning a structured object.
 * @param {string} fenString 
 * @returns {Object} Normalized FEN object
 */
export function parseFen(fenString) {
  if (!fenString || typeof fenString !== 'string') {
    fenString = STARTING_FEN;
  }
  
  let normalized = fenString.trim().replace(/\s+/g, ' ');
  normalized = normalized.replace(/\\/g, '/'); // handle both / and \ as separators
  
  const parts = normalized.split(' ');
  const position = parts[0] || '8/8/8/8/8/8/8/8';
  let activeColor = parts[1] || 'w';
  const castling = parts[2] || 'KQkq';
  const enPassant = parts[3] || '-';
  const halfmove = parts[4] || '0';
  const fullmove = parts[5] || '1';

  // Normalize color
  const c = activeColor.toLowerCase();
  if (c === 'w' || c === 'white') activeColor = 'w';
  else if (c === 'b' || c === 'black') activeColor = 'b';
  else activeColor = 'w';

  const boardMap = fenPositionToBoardMap(position);
  const validation = validatePosition(boardMap);

  return {
    position,
    activeColor,
    castling,
    enPassant,
    halfmove,
    fullmove,
    isValid: validation.isLegal,
    errors: validation.errors,
    warnings: validation.warnings
  };
}

/**
 * Parse just the position part of a FEN string to a Board Map.
 * @param {string} fenPosition 
 * @returns {Map<string, Object>} Map of square name to piece object
 */
export function fenPositionToBoardMap(fenPosition) {
  const boardMap = new Map();
  const rows = fenPosition.replace(/\\/g, '/').split('/');
  
  for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
    const rank = 7 - rankIndex; // 8th rank is index 7
    if (rankIndex >= rows.length) break;
    
    let file = 0;
    const rowString = rows[rankIndex];
    
    for (let charIndex = 0; charIndex < rowString.length; charIndex++) {
      if (file > 7) break;
      const char = rowString[charIndex];
      
      if (/\d/.test(char)) {
        file += parseInt(char, 10);
      } else {
        const piece = FEN_TO_PIECE[char];
        if (piece) {
          const square = coordsToSquare(file, rank);
          if (square) {
            boardMap.set(square, { ...piece });
          }
        }
        file++;
      }
    }
  }
  return boardMap;
}

/**
 * Converts a board map back to the FEN position string.
 * @param {Map|Object} boardMap 
 * @returns {string} FEN position
 */
export function boardMapToFenPosition(boardMap) {
  const map = boardMap instanceof Map ? boardMap : new Map(Object.entries(boardMap));
  let fen = '';
  
  for (let rank = 7; rank >= 0; rank--) {
    let emptyCount = 0;
    
    for (let file = 0; file < 8; file++) {
      const square = coordsToSquare(file, rank);
      const piece = map.get(square);
      
      if (piece) {
        if (emptyCount > 0) {
          fen += emptyCount;
          emptyCount = 0;
        }
        const key = `${piece.color}-${piece.role}`;
        fen += PIECE_TO_FEN[key] || '?';
      } else {
        emptyCount++;
      }
    }
    
    if (emptyCount > 0) {
      fen += emptyCount;
    }
    
    if (rank > 0) {
      fen += '/';
    }
  }
  
  return fen;
}

/**
 * Infers likely castling rights based on board state.
 * @param {Map|Object} boardMap 
 * @returns {{K: boolean, Q: boolean, k: boolean, q: boolean}}
 */
export function getSmartCastlingRights(boardMap) {
  const map = boardMap instanceof Map ? boardMap : new Map(Object.entries(boardMap));
  const rights = { K: false, Q: false, k: false, q: false };
  
  const wKing = map.get('e1');
  const wRookH = map.get('h1');
  const wRookA = map.get('a1');
  
  if (wKing && wKing.color === 'white' && wKing.role === 'king') {
    if (wRookH && wRookH.color === 'white' && wRookH.role === 'rook') rights.K = true;
    if (wRookA && wRookA.color === 'white' && wRookA.role === 'rook') rights.Q = true;
  }
  
  const bKing = map.get('e8');
  const bRookH = map.get('h8');
  const bRookA = map.get('a8');
  
  if (bKing && bKing.color === 'black' && bKing.role === 'king') {
    if (bRookH && bRookH.color === 'black' && bRookH.role === 'rook') rights.k = true;
    if (bRookA && bRookA.color === 'black' && bRookA.role === 'rook') rights.q = true;
  }
  
  return rights;
}

/**
 * Generates a full FEN string from a board map and options.
 * @param {Map|Object} boardMap 
 * @param {Object} options 
 * @returns {string} FEN string
 */
export function generateFen(boardMap, options = {}) {
  const pos = boardMapToFenPosition(boardMap);
  const active = options.activeColor || 'w';
  
  let castling = '-';
  if (options.castling) {
    castling = '';
    if (options.castling.K) castling += 'K';
    if (options.castling.Q) castling += 'Q';
    if (options.castling.k) castling += 'k';
    if (options.castling.q) castling += 'q';
    if (castling === '') castling = '-';
  } else {
    // If not provided, we can either default to '-' or try to infer. Let's infer if possible or default to '-'
    const inferred = getSmartCastlingRights(boardMap);
    castling = '';
    if (inferred.K) castling += 'K';
    if (inferred.Q) castling += 'Q';
    if (inferred.k) castling += 'k';
    if (inferred.q) castling += 'q';
    if (castling === '') castling = '-';
  }
  
  const ep = options.enPassant || '-';
  const hm = options.halfmove !== undefined ? options.halfmove : '0';
  const fm = options.fullmove !== undefined ? options.fullmove : '1';
  
  return `${pos} ${active} ${castling} ${ep} ${hm} ${fm}`;
}
