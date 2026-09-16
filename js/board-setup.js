import { 
  generateFen, 
  fenPositionToBoardMap, 
  boardMapToFenPosition, 
  validatePosition, 
  getSmartCastlingRights, 
  STARTING_FEN, 
  EMPTY_FEN 
} from './fen-utils.js';

/**
 * @typedef {Object} Piece
 * @property {'white'|'black'} color
 * @property {'king'|'queen'|'rook'|'bishop'|'knight'|'pawn'} role
 */

/**
 * Initializes the free piece placement (setup/editor) mode.
 * @param {Object} options Configuration options
 * @param {HTMLElement} options.boardElement DOM element containing the Chessground board
 * @param {Object} options.groundInstance The Chessground instance
 * @param {Function} options.onFenChange Callback when board changes: (fen) => void
 * @param {Function} options.onValidationChange Callback when validation changes: ({isLegal, errors, warnings}) => void
 * @param {HTMLElement} options.piecesPaletteElement DOM element for the piece palette
 * @returns {Object} Setup Controller Object
 */
export function initSetupMode({ boardElement, groundInstance, onFenChange, onValidationChange, piecesPaletteElement }) {
  let active = false;
  let selectedPalettePiece = null;
  
  // Metadata state
  let currentActiveColor = 'white';
  let currentCastlingRights = { K: false, Q: false, k: false, q: false };
  let currentEnPassant = '-';
  let currentHalfmove = 0;
  let currentFullmove = 1;
  
  let currentBoardMap = new Map();
  let currentValidation = { isLegal: true, errors: [], warnings: [] };

  // Piece definitions for the palette
  const PIECE_DEFINITIONS = [
    { color: 'white', role: 'king', symbol: '♔', fenChar: 'K' },
    { color: 'white', role: 'queen', symbol: '♕', fenChar: 'Q' },
    { color: 'white', role: 'rook', symbol: '♖', fenChar: 'R' },
    { color: 'white', role: 'bishop', symbol: '♗', fenChar: 'B' },
    { color: 'white', role: 'knight', symbol: '♘', fenChar: 'N' },
    { color: 'white', role: 'pawn', symbol: '♙', fenChar: 'P' },
    { color: 'black', role: 'king', symbol: '♚', fenChar: 'k' },
    { color: 'black', role: 'queen', symbol: '♛', fenChar: 'q' },
    { color: 'black', role: 'rook', symbol: '♜', fenChar: 'r' },
    { color: 'black', role: 'bishop', symbol: '♝', fenChar: 'b' },
    { color: 'black', role: 'knight', symbol: '♞', fenChar: 'n' },
    { color: 'black', role: 'pawn', symbol: '♟', fenChar: 'p' },
  ];

  /**
   * Generates the palette UI
   */
  function buildPalette() {
    if (!piecesPaletteElement) return;
    piecesPaletteElement.innerHTML = '';
    
    piecesPaletteElement.classList.add('chessmind-setup-palette');
    
    PIECE_DEFINITIONS.forEach(def => {
      const btn = document.createElement('button');
      btn.className = `palette-piece ${def.color}-${def.role}`;
      btn.dataset.color = def.color;
      btn.dataset.role = def.role;
      btn.innerHTML = `<span class="piece-symbol">${def.symbol}</span>`;
      btn.title = `${def.color} ${def.role}`;
      
      btn.addEventListener('click', () => {
        if (!active) return;
        
        // Toggle selection
        if (selectedPalettePiece && 
            selectedPalettePiece.color === def.color && 
            selectedPalettePiece.role === def.role) {
          deselectPalettePiece();
        } else {
          selectPalettePiece(def, btn);
        }
      });
      
      piecesPaletteElement.appendChild(btn);
    });
  }

  function selectPalettePiece(pieceDef, buttonElement) {
    deselectPalettePiece();
    selectedPalettePiece = { color: pieceDef.color, role: pieceDef.role };
    buttonElement.classList.add('selected');
  }

  function deselectPalettePiece() {
    selectedPalettePiece = null;
    if (!piecesPaletteElement) return;
    const selectedBtn = piecesPaletteElement.querySelector('.palette-piece.selected');
    if (selectedBtn) selectedBtn.classList.remove('selected');
  }

  /**
   * Handle square click from Chessground
   */
  function handleSquareClick(key) {
    if (!active) return;
    
    if (selectedPalettePiece) {
      // Place selected piece
      controller.placePiece(key, selectedPalettePiece);
    }
  }

  /**
   * Handle piece move from Chessground (free movement)
   */
  function handlePieceMove(orig, dest, capturedPiece) {
    if (!active) return;
    
    const piece = currentBoardMap.get(orig);
    if (piece) {
      currentBoardMap.delete(orig);
      currentBoardMap.set(dest, piece);
      updateStateAfterBoardChange();
    }
  }

  /**
   * Handle right click on the board to remove pieces
   */
  function handleContextMenu(e) {
    if (!active) return;
    
    const cgBoard = boardElement.querySelector('cg-board');
    if (!cgBoard || !cgBoard.contains(e.target)) return;
    
    e.preventDefault();
    
    const rect = cgBoard.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const file = Math.floor((x / rect.width) * 8);
    const rank = 7 - Math.floor((y / rect.height) * 8); 
    
    const isFlipped = groundInstance.state.orientation === 'black';
    const actualFile = isFlipped ? 7 - file : file;
    const actualRank = isFlipped ? 7 - rank : rank;
    
    if (actualFile >= 0 && actualFile < 8 && actualRank >= 0 && actualRank < 8) {
      const files = 'abcdefgh';
      const square = files[actualFile] + (actualRank + 1);
      
      controller.removePiece(square);
    }
  }

  /**
   * Sync the internal board map with Chessground state
   */
  function syncMapFromGround() {
    currentBoardMap = new Map();
    const pieces = groundInstance.state.pieces;
    if (pieces && pieces.size > 0) {
      pieces.forEach((piece, square) => {
        currentBoardMap.set(square, { color: piece.color, role: piece.role });
      });
    } else if (pieces && Object.keys(pieces).length > 0) {
       for (const square in pieces) {
         if (Object.prototype.hasOwnProperty.call(pieces, square)) {
             currentBoardMap.set(square, { color: pieces[square].color, role: pieces[square].role });
         }
       }
    } else {
       // Fallback: parse FEN directly from the ground instance or default
       const fenStr = groundInstance.getFen ? groundInstance.getFen() : null;
       if (fenStr && typeof fenPositionToBoardMap === 'function') {
           currentBoardMap = fenPositionToBoardMap(fenStr);
       }
    }
  }

  /**
   * Call when the board changes to update FEN and validation
   */
  function updateStateAfterBoardChange() {
    // Determine castling rights automatically
    if (typeof getSmartCastlingRights === 'function') {
      currentCastlingRights = getSmartCastlingRights(currentBoardMap, currentCastlingRights);
    }
    
    const fen = controller.getCurrentFen();
    
    // Sync with ground to ensure UI matches state
    if (typeof boardMapToFenPosition === 'function') {
      const posStr = boardMapToFenPosition(currentBoardMap);
      groundInstance.set({ fen: posStr });
    }
    
    if (typeof validatePosition === 'function') {
      currentValidation = validatePosition(currentBoardMap);
    }
    
    if (onFenChange) onFenChange(fen);
    if (onValidationChange) onValidationChange(currentValidation);
  }

  // --- Initialize Event Listeners ---
  boardElement.addEventListener('contextmenu', handleContextMenu);
  buildPalette();
  syncMapFromGround();

  const controller = {
    enable() {
      active = true;
      syncMapFromGround();
      
      groundInstance.set({
        movable: { free: true, color: 'both' },
        premovable: { enabled: false },
        draggable: { enabled: true },
        selectable: { enabled: true },
        events: {
          select: handleSquareClick,
          move: handlePieceMove,
        }
      });
      
      updateStateAfterBoardChange();
    },
    
    disable() {
      active = false;
      deselectPalettePiece();
      
      groundInstance.set({
        movable: { free: false }, 
        events: {
          select: undefined,
          move: undefined,
        }
      });
      
      if (currentValidation && !currentValidation.isLegal) {
        console.warn('Exited setup mode with invalid position:', currentValidation.errors);
      }
    },
    
    isActive() {
      return active;
    },
    
    clearBoard() {
      if (!active) return;
      currentBoardMap.clear();
      currentCastlingRights = { K: false, Q: false, k: false, q: false };
      currentEnPassant = '-';
      updateStateAfterBoardChange();
    },
    
    loadStarting() {
      if (!active) return;
      this.loadFen(STARTING_FEN);
    },
    
    loadFen(fen) {
      if (!active || !fen) return;
      
      try {
        const parts = fen.trim().split(/\s+/);
        const position = parts[0] || (EMPTY_FEN ? EMPTY_FEN.split(' ')[0] : '8/8/8/8/8/8/8/8');
        
        if (typeof fenPositionToBoardMap === 'function') {
           currentBoardMap = fenPositionToBoardMap(position);
        }
        
        currentActiveColor = parts[1] === 'b' ? 'black' : 'white';
        
        const castlingStr = parts[2] || '-';
        currentCastlingRights = {
          K: castlingStr.includes('K'),
          Q: castlingStr.includes('Q'),
          k: castlingStr.includes('k'),
          q: castlingStr.includes('q')
        };
        
        currentEnPassant = parts[3] || '-';
        currentHalfmove = parseInt(parts[4], 10) || 0;
        currentFullmove = parseInt(parts[5], 10) || 1;
        
        updateStateAfterBoardChange();
      } catch (e) {
        console.error('Error loading FEN in setup mode:', e);
      }
    },
    
    getCurrentFen() {
      const colorChar = currentActiveColor === 'white' ? 'w' : 'b';
      
      if (typeof generateFen === 'function') {
        return generateFen(currentBoardMap, {
          activeColor: colorChar,
          castling: currentCastlingRights,
          enPassant: currentEnPassant || '-',
          halfmove: currentHalfmove,
          fullmove: currentFullmove
        });
      }
      
      let position = '8/8/8/8/8/8/8/8';
      if (typeof boardMapToFenPosition === 'function') {
        position = boardMapToFenPosition(currentBoardMap);
      }
      
      let castlingStr = '';
      if (currentCastlingRights.K) castlingStr += 'K';
      if (currentCastlingRights.Q) castlingStr += 'Q';
      if (currentCastlingRights.k) castlingStr += 'k';
      if (currentCastlingRights.q) castlingStr += 'q';
      if (castlingStr === '') castlingStr = '-';
      
      const ep = currentEnPassant || '-';
      return `${position} ${colorChar} ${castlingStr} ${ep} ${currentHalfmove} ${currentFullmove}`;
    },
    
    getBoardMap() {
      return new Map(currentBoardMap);
    },
    
    placePiece(square, piece) {
      if (!active) return;
      currentBoardMap.set(square, { color: piece.color, role: piece.role });
      updateStateAfterBoardChange();
    },
    
    removePiece(square) {
      if (!active) return;
      if (currentBoardMap.has(square)) {
        currentBoardMap.delete(square);
        updateStateAfterBoardChange();
      }
    },
    
    setActiveColor(color) {
      if (!active) return;
      currentActiveColor = color === 'black' ? 'black' : 'white';
      updateStateAfterBoardChange();
    },
    
    getActiveColor() {
      return currentActiveColor;
    },
    
    setCastlingRights(rights) {
      if (!active) return;
      currentCastlingRights = { ...currentCastlingRights, ...rights };
      updateStateAfterBoardChange();
    },
    
    getCastlingRights() {
      return { ...currentCastlingRights };
    },
    
    setEnPassant(square) {
      if (!active) return;
      currentEnPassant = square || '-';
      updateStateAfterBoardChange();
    },
    
    getEnPassant() {
      return currentEnPassant;
    },
    
    getValidation() {
      return currentValidation;
    }
  };
  
  return controller;
}
