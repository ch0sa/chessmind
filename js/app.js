import { 
  initEngine, startAnalysis, stopAnalysis, setDepth, setMultiPV, setThreads, 
  evalToHuman, evalToBarPercent, parseUCIMove, formatNodes, formatNPS, 
  getAnalysisState, destroyEngine 
} from './analysis.js';
import { 
  initVoice, startListening, stopListening, isListening, 
  startPushToTalk, stopPushToTalk, speak, setTTSEnabled, isTTSEnabled, setRate 
} from './voice-controller.js';
import { parseFen, STARTING_FEN, EMPTY_FEN } from './fen-utils.js';
import { formatMoveForSpeech, parseSpokenMove } from './move-parser.js';
import { Chess } from '../lib/chess.esm.js'; 

import { 
  initSound, setSoundEnabled, isSoundEnabled, 
  playMoveSound, playCaptureSound, playCheckSound, 
  playCastleSound, playGameEndSound, triggerHaptic 
} from './sound.js';
import { identifyOpening } from './openings.js';

const state = {
  mode: 'analysis',          // 'setup' | 'analysis'
  gameMode: 'analysis',      // 'analysis' | 'vs-computer' | 'local-1v1'
  playerColor: 'white',      // 'white' | 'black' (human player in vs-computer)
  difficulty: 3,             // 1-6 difficulty level
  isGameOver: false,
  analysisPaused: false,     // True when user explicitly stopped analysis
  ground: null,           // Chessground instance
  chess: null,            // chess.js instance
  currentFen: STARTING_FEN,
  boardOrientation: 'white',
  engineReady: false,
  voiceSupported: false,
  freePlacement: false,   // Free placement mode in analysis
  selectedQuickPiece: null, // Selected piece from quick palette
  historyMoves: [],       // Array of { san, from, to, piece, flags, fen, color, turn }
  currentHistoryIndex: -1,// -1 is starting position, moves.length - 1 is latest move
  clock: {
    enabled: false,
    timeControl: 'none',   // 'none' or 'min|inc' e.g. '3|2', '5|0'
    initialMinutes: 0,
    incrementSeconds: 0,
    whiteTime: 0,          // in seconds
    blackTime: 0,          // in seconds
    activeColor: null,     // 'white' | 'black' | null
    timerId: null,
    lastTimestamp: 0,
    isFlagged: false,
  },
  settings: {
    theme: 'dark',
    boardTheme: 'brown',
    soundEnabled: true,
    depth: (typeof window !== 'undefined' && (window.innerWidth <= 768 || /Android|iPhone|iPad/i.test(navigator.userAgent))) ? 15 : 18,
    analysisSide: 'white',   // 'white' | 'black' | 'auto'
    multiPV: 3,
    threads: (typeof window !== 'undefined' && (window.innerWidth <= 768 || /Android|iPhone|iPad/i.test(navigator.userAgent))) ? 1 : Math.max(1, Math.min(2, Math.floor((navigator.hardwareConcurrency || 2) / 2))),
    ttsEnabled: false,
    ttsVoice: null,
    ttsSpeed: 1.0,
    liteMode: false,
  }
};

// DOM Elements
const els = {};

// Load Chessground dynamically (local first, fallback to CDN)
async function loadChessground() {
  try {
    const cg = await import('../lib/chessground.min.js');
    return cg.Chessground || window.Chessground;
  } catch (error) {
    console.warn('Failed to load local Chessground, falling back to CDN', error);
    try {
      const cg = await import('https://unpkg.com/chessground@9.1.1/dist/chessground.min.js');
      return cg.Chessground || window.Chessground;
    } catch (e) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/chessground@9.1.1/dist/chessground.min.js';
        script.onload = () => {
          if (window.Chessground) resolve(window.Chessground);
          else reject(new Error('Chessground not found after script load'));
        };
        script.onerror = () => reject(new Error('Failed to load Chessground script'));
        document.head.appendChild(script);
      });
    }
  }
}

// Toast notification system
function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.right = '20px';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    document.body.appendChild(container);
  }

  // Clear existing toasts so they don't stack up and block UI
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  
  // Basic inline styles for toast if CSS is missing
  toast.style.padding = '12px 20px';
  toast.style.borderRadius = '4px';
  toast.style.color = '#fff';
  toast.style.fontWeight = 'bold';
  toast.style.background = type === 'error' ? '#f44336' : (type === 'success' ? '#4caf50' : '#2196f3');
  toast.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  toast.style.pointerEvents = 'none';
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(20px)';
  toast.style.transition = 'opacity 0.3s, transform 0.3s';

  container.appendChild(toast);
  
  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.classList.remove('show');
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function loadSettings() {
  try {
    const saved = localStorage.getItem('chessmind-settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      state.settings = { ...state.settings, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load settings from localStorage', e);
  }
}

function saveSettings() {
  try {
    localStorage.setItem('chessmind-settings', JSON.stringify(state.settings));
  } catch (e) {
    console.error('Failed to save settings to localStorage', e);
  }
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.settings.theme);
}

function applyBoardTheme(theme) {
  const validThemes = ['brown', 'green', 'blue', 'wood', 'charcoal'];
  const selected = validThemes.includes(theme) ? theme : 'brown';
  state.settings.boardTheme = selected;

  const boardEl = document.getElementById('board') || document.querySelector('.board-container');
  if (boardEl) {
    validThemes.forEach(t => boardEl.classList.remove(`board-theme-${t}`));
    boardEl.classList.add(`board-theme-${selected}`);
  }
  if (document.body) {
    validThemes.forEach(t => document.body.classList.remove(`board-theme-${t}`));
    document.body.classList.add(`board-theme-${selected}`);
  }

  if (els.boardThemeSelect) {
    els.boardThemeSelect.value = selected;
  }
}

function initDOM() {
  els.board = document.getElementById('board');
  els.analyzeBtn = document.getElementById('analyze-btn');
  els.stopBtn = document.getElementById('stop-btn');
  els.flipBtn = document.getElementById('flip-board-btn');
  els.soundToggleBtn = document.getElementById('sound-toggle-btn');
  els.soundToggle = document.getElementById('sound-toggle');
  els.ttsToggleBtn = document.getElementById('tts-toggle-btn');
  els.clearBoardBtn = document.getElementById('clear-board-btn');
  els.startingPosBtn = document.getElementById('start-pos-btn');
  els.settingsBtn = document.getElementById('settings-btn');
  els.closeSettingsBtn = document.getElementById('close-settings');
  els.settingsModal = document.getElementById('settings-modal');
  els.themeToggle = document.getElementById('theme-toggle');
  els.depthSlider = document.getElementById('depth-slider');
  els.depthValue = document.getElementById('depth-value');
  els.analysisSideSelect = document.getElementById('analysis-side');
  els.multiPvInput = document.getElementById('multipv-count');
  els.ttsSpeedInput = document.getElementById('tts-speed');
  els.ttsSpeedValue = document.getElementById('tts-speed-value');

  // Player Info Strips & Captured Pieces & Clocks
  els.topPlayerStrip = document.getElementById('top-player-strip');
  els.topPlayerName = document.getElementById('top-player-name');
  els.topPlayerBadge = document.getElementById('top-player-badge');
  els.topPlayerIcon = document.getElementById('top-player-icon');
  els.topCapturedPieces = document.getElementById('top-captured-pieces');
  els.topMaterialDiff = document.getElementById('top-material-diff');
  els.topClock = document.getElementById('top-clock');
  els.bottomPlayerStrip = document.getElementById('bottom-player-strip');
  els.bottomPlayerName = document.getElementById('bottom-player-name');
  els.bottomPlayerBadge = document.getElementById('bottom-player-badge');
  els.bottomPlayerIcon = document.getElementById('bottom-player-icon');
  els.bottomCapturedPieces = document.getElementById('bottom-captured-pieces');
  els.bottomMaterialDiff = document.getElementById('bottom-material-diff');
  els.bottomClock = document.getElementById('bottom-clock');

  // Move History & Navigation
  els.moveHistoryPanel = document.getElementById('move-history-panel');
  els.historyMovesList = document.getElementById('history-moves-list');
  els.historyMoveCount = document.getElementById('history-move-count');
  els.copyPgnBtn = document.getElementById('copy-pgn-btn');
  els.copyFenBtn = document.getElementById('copy-fen-btn');
  els.importBtn = document.getElementById('import-btn');
  els.importQuickBtn = document.getElementById('import-quick-btn');
  els.navFirstBtn = document.getElementById('nav-first-btn');
  els.navPrevBtn = document.getElementById('nav-prev-btn');
  els.navNextBtn = document.getElementById('nav-next-btn');
  els.navLastBtn = document.getElementById('nav-last-btn');
  els.navLiveBadge = document.getElementById('nav-live-badge');
  els.openingBar = document.getElementById('opening-bar');
  els.openingName = document.getElementById('opening-name');
  
  // Game Mode & Play Controls
  els.modeSelectorBtns = document.querySelectorAll('.mode-btn');
  els.vsComputerPanel = document.getElementById('vs-computer-panel');
  els.local1v1Panel = document.getElementById('local-1v1-panel');
  els.playAsColor = document.getElementById('play-as-color');
  els.difficultyLevel = document.getElementById('difficulty-level');
  els.timeControlVs = document.getElementById('time-control-vs');
  els.timeControl1v1 = document.getElementById('time-control-1v1');
  els.newGameBtn = document.getElementById('new-game-btn');
  els.new1v1Btn = document.getElementById('new-1v1-btn');
  els.gameStatusBar = document.getElementById('game-status-bar');
  els.gameStatusText = document.getElementById('game-status-text');
  els.resignBtn = document.getElementById('resign-btn');
  els.newGameAgainBtn = document.getElementById('new-game-again-btn');
  
  // Analysis panels
  els.evalBar = document.getElementById('eval-bar');
  els.evalBarFill = document.getElementById('eval-fill');
  els.evalScore = document.getElementById('eval-score');
  els.bestMove = document.getElementById('best-move');
  els.depthDisplay = document.getElementById('depth-display');
  els.pvLine = document.getElementById('pv-line');
  els.candidateMoves = document.getElementById('candidate-moves');
  els.voiceFeedback = document.getElementById('voice-feedback');

  // Command & Free Mode Controls
  els.commandInput = document.getElementById('command-input');
  els.commandSubmitBtn = document.getElementById('command-submit-btn');
  els.pttBtn = document.getElementById('ptt-btn');
  els.freeModeBtn = document.getElementById('free-mode-btn');

  // Help & Guide Modal
  els.helpBtn = document.getElementById('help-btn');
  els.helpModal = document.getElementById('help-modal');
  els.closeHelpBtn = document.getElementById('close-help');

  // Board Theme & Import Modal
  els.boardThemeSelect = document.getElementById('board-theme-select');
  els.importModal = document.getElementById('import-modal');
  els.closeImportBtn = document.getElementById('close-import');
  els.importInput = document.getElementById('import-input');
  els.importSubmitBtn = document.getElementById('import-submit-btn');
  els.importClearBtn = document.getElementById('import-clear-btn');

  // Status elements
  els.statusDot = document.getElementById('status-dot');
  els.engineStatusText = document.getElementById('engine-status-text');
}

function getFenFromBoard() {
  return state.currentFen;
}

function roleToChar(role) {
  const map = {
    king: 'k',
    queen: 'q',
    rook: 'r',
    bishop: 'b',
    knight: 'n',
    pawn: 'p'
  };
  return map[(role || '').toLowerCase()] || 'p';
}

let analysisDebounceTimer = null;

function triggerDebouncedAnalysis(delay = 250) {
  if (state.analysisPaused || state.gameMode !== 'analysis') return;
  if (analysisDebounceTimer) {
    clearTimeout(analysisDebounceTimer);
  }
  analysisDebounceTimer = setTimeout(() => {
    if (state.analysisPaused || state.gameMode !== 'analysis') return;
    if (!state.engineReady) return;
    const fen = state.currentFen;
    const validation = validateFen(fen);
    if (!validation.valid) {
      return;
    }
    startAnalysis(fen, {
      depth: state.settings.depth,
      multiPV: state.settings.multiPV,
      threads: state.settings.threads
    });
  }, delay);
}

function handleClearBoard() {
  stopAnalysis();
  if (analysisDebounceTimer) clearTimeout(analysisDebounceTimer);
  state.chess.clear();
  state.currentFen = '8/8/8/8/8/8/8/8 w - - 0 1';
  state.ground.set({
    fen: '8/8/8/8/8/8/8/8',
    lastMove: null,
    autoShapes: [],
    turnColor: 'white',
    movable: { free: true, color: 'both', dests: new Map() }
  });
  if (els.fenInput) els.fenInput.value = state.currentFen;
  if (els.evalBarFill) els.evalBarFill.style.height = '50%';
  if (els.evalScore) {
    els.evalScore.textContent = '0.0';
    els.evalScore.className = 'hud-eval-badge';
  }
  if (els.bestMove) els.bestMove.textContent = 'Best: --';
  if (els.pvLine) els.pvLine.textContent = '--';
  if (els.candidateMoves) {
    els.candidateMoves.innerHTML = '<li class="candidate-item" style="color: var(--text-muted); justify-content: center;">Board cleared. Place pieces to analyze.</li>';
  }
  state.historyMoves = [];
  state.currentHistoryIndex = -1;
  renderMoveHistoryUI();
  updatePlayerStripsUI();
  showToast('Board cleared', 'info', 1500);
}

function handleResetStartingPosition() {
  stopAnalysis();
  if (analysisDebounceTimer) clearTimeout(analysisDebounceTimer);
  state.chess.reset();
  state.currentFen = STARTING_FEN;
  state.ground.set({
    fen: STARTING_FEN,
    lastMove: null,
    autoShapes: [],
    turnColor: 'white',
    movable: state.freePlacement ? { free: true, color: 'both', dests: new Map() } : {
      free: false,
      color: 'white',
      dests: getLegalMoves(),
      showDests: true
    }
  });
  if (els.fenInput) els.fenInput.value = state.currentFen;
  state.historyMoves = [];
  state.currentHistoryIndex = -1;
  renderMoveHistoryUI();
  updatePlayerStripsUI();
  showToast('Starting position reset', 'info', 1500);
  triggerDebouncedAnalysis(100);
}

function handleBoardMove(orig, dest) {
  if (state.freePlacement) {
    // In Free Placement mode, move whatever piece is on orig to dest
    const piece = state.chess.remove(orig);
    if (piece) {
      state.chess.remove(dest);
      state.chess.put(piece, dest);

      // Keep chess.js turn synchronized with piece color moved
      const nextTurn = piece.color === 'w' ? 'b' : 'w';
      try {
        const fenTokens = state.chess.fen().split(' ');
        fenTokens[1] = nextTurn;
        fenTokens[3] = '-';
        state.chess.load(fenTokens.join(' '));
      } catch (e) {
        // If non-standard position (e.g. missing king during setup), retain current state
      }

      state.currentFen = state.chess.fen();
      const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
      state.ground.set({ 
        fen: state.currentFen, 
        lastMove: [orig, dest],
        turnColor: activeColor,
        movable: { free: true, color: 'both', dests: new Map() }
      });
      if (els.fenInput) els.fenInput.value = state.currentFen;
      triggerDebouncedAnalysis(250);
      showToast(`Moved ${orig} to ${dest}`, 'info', 1000);
    } else {
      state.ground.set({ fen: state.currentFen });
    }
    return;
  }
  
  try {
    const move = state.chess.move({
      from: orig,
      to: dest,
      promotion: 'q' // Auto-promote to queen for simplicity
    });
    
    if (move) {
      state.currentFen = state.chess.fen();
      state.analysisPaused = false;
      const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
      
      // Update valid moves on board
      state.ground.set({
        fen: state.currentFen,
        lastMove: [orig, dest],
        turnColor: activeColor,
        movable: {
          free: false,
          color: (state.gameMode === 'vs-computer') ? (state.isGameOver ? undefined : state.playerColor) : activeColor,
          dests: state.isGameOver ? new Map() : getLegalMoves(),
          showDests: true
        }
      });
      if (els.fenInput) els.fenInput.value = state.currentFen;
      
      // Play sound, record history, update captured material
      playMoveSoundFx(move);
      recordMoveInHistory(move);
      updatePlayerStripsUI();

      if (state.clock.enabled && !state.isGameOver) {
        const nextColor = state.chess.turn() === 'w' ? 'white' : 'black';
        const movedColor = move.color === 'w' ? 'white' : 'black';
        switchClockTurn(nextColor, movedColor);
      }

      if (isTTSEnabled()) {
        speak(formatMoveForSpeech(move.san, move.piece, move.from, move.to, move.flags));
      }

      if (state.gameMode === 'vs-computer') {
        updateGameStatus();
        if (!state.isGameOver) {
          makeComputerMove();
        }
        return;
      }

      if (state.gameMode === 'local-1v1') {
        updateGameStatus();
        return;
      }
      
      triggerDebouncedAnalysis(200);
    } else {
      // Illegal move, snap back
      state.ground.set({ fen: state.currentFen });
    }
  } catch (e) {
    // Invalid move, snap back
    state.ground.set({ fen: state.currentFen });
  }
}

function handleBoardSelect(square) {
  if (!state.selectedQuickPiece) return;
  if (state.selectedQuickPiece === 'trash') {
    handlePieceRemoval(square);
  } else if (state.selectedQuickPiece.color && state.selectedQuickPiece.role) {
    handlePiecePlacement(state.selectedQuickPiece.color, state.selectedQuickPiece.role, square);
  }
}

function handlePiecePlacement(color, role, square) {
  const roleChar = roleToChar(role);
  const colorChar = (color && color.toLowerCase() === 'black') ? 'b' : 'w';
  const colorName = colorChar === 'w' ? 'White' : 'Black';
  const roleName = role ? (role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()) : 'Piece';

  // Direct piece placement on square
  state.chess.remove(square);
  state.chess.put({ type: roleChar, color: colorChar }, square);
  state.currentFen = state.chess.fen();
  const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
  state.ground.set({
    fen: state.currentFen,
    turnColor: activeColor,
    movable: state.freePlacement ? { free: true, color: 'both', dests: new Map() } : {
      free: false,
      color: activeColor,
      dests: getLegalMoves(),
      showDests: true
    }
  });
  if (els.fenInput) els.fenInput.value = state.currentFen;
  showToast(`Placed ${colorName} ${roleName} on ${square}`, 'success', 1200);
  if (isTTSEnabled()) {
    speak(`${colorName} ${roleName} placed on ${square}`);
  }
  triggerDebouncedAnalysis(250);
}

function handlePieceRemoval(square) {
  state.chess.remove(square);
  state.currentFen = state.chess.fen();
  const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
  state.ground.set({
    fen: state.currentFen,
    turnColor: activeColor,
    movable: state.freePlacement ? { free: true, color: 'both', dests: new Map() } : {
      free: false,
      color: activeColor,
      dests: getLegalMoves(),
      showDests: true
    }
  });
  if (els.fenInput) els.fenInput.value = state.currentFen;
  showToast(`Removed piece from ${square}`, 'info', 1200);
  if (isTTSEnabled()) {
    speak(`Removed ${square}`);
  }
  triggerDebouncedAnalysis(250);
}

function handleMoveExecution(parsed) {
  if (parsed.from && parsed.to) {
    // Try legal move first
    try {
      const move = state.chess.move({ from: parsed.from, to: parsed.to, promotion: parsed.promotion || 'q' });
      if (move) {
        state.currentFen = state.chess.fen();
        state.analysisPaused = false;
        const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
        state.ground.set({
          fen: state.currentFen,
          lastMove: [move.from, move.to],
          turnColor: activeColor,
          movable: state.freePlacement ? { free: true, color: 'both', dests: new Map() } : {
            free: false,
            color: (state.gameMode === 'vs-computer') ? (state.isGameOver ? undefined : state.playerColor) : activeColor,
            dests: state.isGameOver ? new Map() : getLegalMoves(),
            showDests: true
          }
        });
        if (els.fenInput) els.fenInput.value = state.currentFen;
        showToast(`Move made: ${move.san}`, 'success', 1500);

        // Play sound, record history, update captured material
        playMoveSoundFx(move);
        recordMoveInHistory(move);
        updatePlayerStripsUI();

        if (state.clock.enabled && !state.isGameOver) {
          const nextColor = state.chess.turn() === 'w' ? 'white' : 'black';
          const movedColor = move.color === 'w' ? 'white' : 'black';
          switchClockTurn(nextColor, movedColor);
        }

        if (isTTSEnabled()) {
          speak(formatMoveForSpeech(move.san, move.piece, move.from, move.to, move.flags));
        }

        if (state.gameMode === 'vs-computer') {
          updateGameStatus();
          if (!state.isGameOver) {
            makeComputerMove();
          }
          return;
        }

        if (state.gameMode === 'local-1v1') {
          updateGameStatus();
          return;
        }

        if (state.engineReady && !state.analysisPaused) {
          startAnalysis(state.currentFen, {
            depth: state.settings.depth,
            multiPV: state.settings.multiPV,
            threads: state.settings.threads
          });
        }
        return;
      }
    } catch (e) {}

    // If legal move failed, but Free Placement is on:
    if (state.freePlacement) {
      const piece = state.chess.remove(parsed.from);
      if (piece) {
        state.chess.remove(parsed.to);
        state.chess.put(piece, parsed.to);

        const nextTurn = piece.color === 'w' ? 'b' : 'w';
        try {
          const fenTokens = state.chess.fen().split(' ');
          fenTokens[1] = nextTurn;
          fenTokens[3] = '-';
          state.chess.load(fenTokens.join(' '));
        } catch (e) {}

        state.currentFen = state.chess.fen();
        const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
        state.ground.set({ 
          fen: state.currentFen, 
          lastMove: [parsed.from, parsed.to],
          turnColor: activeColor,
          movable: { free: true, color: 'both', dests: new Map() }
        });
        if (els.fenInput) els.fenInput.value = state.currentFen;
        showToast(`Moved ${parsed.from} to ${parsed.to}`, 'success', 1500);
        if (state.engineReady) {
          startAnalysis(state.currentFen, {
            depth: state.settings.depth,
            multiPV: state.settings.multiPV,
            threads: state.settings.threads
          });
        }
        return;
      }
    }

    showToast(`Illegal move: ${parsed.from} to ${parsed.to}. Turn on Free Place to move anywhere.`, 'warning', 3000);
    return;
  }

  if (parsed.san || (parsed.role && parsed.to)) {
    try {
      const move = state.chess.move(parsed.san || { to: parsed.to });
      if (move) {
        state.currentFen = state.chess.fen();
        state.analysisPaused = false;
        const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
        state.ground.set({
          fen: state.currentFen,
          lastMove: [move.from, move.to],
          turnColor: activeColor,
          movable: state.freePlacement ? { free: true, color: 'both', dests: new Map() } : {
            free: false,
            color: (state.gameMode === 'vs-computer') ? (state.isGameOver ? undefined : state.playerColor) : activeColor,
            dests: state.isGameOver ? new Map() : getLegalMoves(),
            showDests: true
          }
        });
        if (els.fenInput) els.fenInput.value = state.currentFen;
        showToast(`Move made: ${move.san}`, 'success', 1500);

        // Play sound, record history, update captured material
        playMoveSoundFx(move);
        recordMoveInHistory(move);
        updatePlayerStripsUI();

        if (isTTSEnabled()) {
          speak(formatMoveForSpeech(move.san, move.piece, move.from, move.to, move.flags));
        }

        if (state.gameMode === 'vs-computer') {
          updateGameStatus();
          if (!state.isGameOver) {
            makeComputerMove();
          }
          return;
        }

        if (state.gameMode === 'local-1v1') {
          updateGameStatus();
          return;
        }

        if (state.engineReady && !state.analysisPaused) {
          startAnalysis(state.currentFen, {
            depth: state.settings.depth,
            multiPV: state.settings.multiPV,
            threads: state.settings.threads
          });
        }
        return;
      }
    } catch (e) {}

    showToast(`Cannot make move ${parsed.san || parsed.raw}. Make sure it is legal on this turn.`, 'warning', 3000);
  }
}

function processUserCommandOrMove(rawInput) {
  if (!rawInput || !rawInput.trim()) return;
  const input = rawInput.trim();

  // Direct SAN move check (e.g. 'Nf3', 'Nxd4', 'O-O', 'exd5', 'e4')
  if (state.chess) {
    const legalMoves = state.chess.moves();
    const matched = legalMoves.find(m => m.toLowerCase() === input.toLowerCase() || m === input);
    if (matched) {
      handleMoveExecution({ san: matched });
      return;
    }
  }

  const parsed = parseSpokenMove(input);

  if (parsed.type === 'command') {
    handleVoiceCommand(parsed.command);
    return;
  }

  if (parsed.type === 'placement') {
    handlePiecePlacement(parsed.color, parsed.role, parsed.square);
    return;
  }

  if (parsed.type === 'remove') {
    handlePieceRemoval(parsed.square);
    return;
  }

  if (parsed.type === 'move') {
    handleMoveExecution(parsed);
    return;
  }

  showToast(`Format not recognized: "${input}". Try e.g. "Knight to e5", "c2 to c5", or "White Queen to f6"`, 'warning', 4000);
}

function validateFen(fen) {
  try {
    const tempChess = new Chess(fen);
    return { valid: true, error: null };
  } catch (e) {
    return { valid: false, error: e.message || 'Invalid FEN' };
  }
}

function updateAnalysisUI(result) {
  if (!result) return;
  
  // Determine perspective
  let perspective = state.settings.analysisSide || 'white';
  if (perspective === 'auto') {
    perspective = state.chess ? (state.chess.turn() === 'w' ? 'white' : 'black') : 'white';
  }

  const eval_ = result.evaluation || {};
  let cp = eval_.cp;
  let mate = eval_.mate;
  
  // Flip eval values if viewing from black's perspective
  if (perspective === 'black') {
    if (cp !== null && cp !== undefined) cp = -cp;
    if (mate !== null && mate !== undefined) mate = -mate;
  }
  
  // Update eval bar
  if (els.evalBarFill) {
    const pct = evalToBarPercent(cp, mate);
    els.evalBarFill.style.height = `${pct}%`;
  }
  
  // Update eval score display
  if (els.evalScore) {
    const human = evalToHuman(eval_.cp, eval_.mate, perspective);
    els.evalScore.textContent = human.short;
    els.evalScore.title = human.text;
    const isLead = (cp > 0) || (mate > 0);
    const isTrail = (cp < 0) || (mate < 0);
    els.evalScore.className = `hud-eval-badge ${isLead ? 'white-lead' : (isTrail ? 'black-lead' : '')}`;
  }
  
  // Update depth display
  if (els.depthDisplay) {
    els.depthDisplay.textContent = `Depth: ${result.depth || 0}`;
  }
  
  // Update best move display
  if (els.bestMove && result.bestMove) {
    els.bestMove.textContent = `Best: ${result.bestMove}`;
  }

  // Update status badge
  if (els.statusDot) els.statusDot.classList.add('ready');
  if (els.engineStatusText) els.engineStatusText.textContent = 'Stockfish Ready ⚡';
  
  // Update PV line
  if (result.lines && result.lines[0] && result.lines[0].pv && els.pvLine) {
    els.pvLine.textContent = result.lines[0].pv.join(' ');
  }
  
  // Update candidate moves list
  if (result.lines && els.candidateMoves) {
    els.candidateMoves.innerHTML = '';
    result.lines.forEach((line, i) => {
      if (!line || !line.pv || !line.pv[0]) return;
      const li = document.createElement('li');
      li.className = 'candidate-item';
      const lineCp = perspective === 'black' && line.cp != null ? -line.cp : line.cp;
      const lineMate = perspective === 'black' && line.mate != null ? -line.mate : line.mate;
      const lineEval = evalToHuman(line.cp, line.mate, perspective);
      const isLead = (lineCp > 0) || (lineMate > 0);
      const isTrail = (lineCp < 0) || (lineMate < 0);
      li.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: bold; color: var(--text-muted); font-size: 0.78rem;">#${i + 1}</span>
          <span class="move-name">${line.pv[0]}</span>
          <span class="pv-preview">${line.pv.slice(1, 6).join(' ')}</span>
        </div>
        <span class="hud-eval-badge ${isLead ? 'white-lead' : (isTrail ? 'black-lead' : '')}">${lineEval.short}</span>
      `;
      els.candidateMoves.appendChild(li);
    });
  }

  // Draw arrow for best move
  if (result.bestMove && state.ground) {
    const move = parseUCIMove(result.bestMove);
    if (move && /^[a-h][1-8]$/.test(move.from) && /^[a-h][1-8]$/.test(move.to)) {
      state.ground.setAutoShapes([{
        orig: move.from,
        dest: move.to,
        brush: 'green',
      }]);
    } else {
      state.ground.setAutoShapes([]);
    }
  }
}

function onAnalysisUpdate(result) {
  updateAnalysisUI(result);
}

function onBestMove(result) {
  updateAnalysisUI(result);
  
  // VS Computer: auto-execute the engine's best move when it's the computer's turn
  if (state.gameMode === 'vs-computer' && !state.isGameOver && result.bestMove) {
    const isComputerTurn =
      (state.chess.turn() === 'w' && state.playerColor !== 'white') ||
      (state.chess.turn() === 'b' && state.playerColor !== 'black');

    if (isComputerTurn) {
      const move = parseUCIMove(result.bestMove);
      if (move) {
        const chessMove = state.chess.move({
          from: move.from,
          to: move.to,
          promotion: move.promotion || 'q',
        });
        if (chessMove) {
          state.currentFen = state.chess.fen();
          const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
          state.ground.set({
            fen: state.chess.fen(),
            turnColor: activeColor,
            lastMove: [move.from, move.to],
            movable: {
              free: false,
              color: state.isGameOver ? undefined : state.playerColor,
              dests: state.isGameOver ? new Map() : getLegalMoves(),
              showDests: true,
            },
          });
          updateGameStatus();

          // Play sound, record history, update captured material
          playMoveSoundFx(chessMove);
          recordMoveInHistory(chessMove);
          updatePlayerStripsUI();

          if (state.clock.enabled && !state.isGameOver) {
            const nextColor = state.chess.turn() === 'w' ? 'white' : 'black';
            const movedColor = chessMove.color === 'w' ? 'white' : 'black';
            switchClockTurn(nextColor, movedColor);
          }

          if (isTTSEnabled()) {
            speak(`Computer plays ${result.bestMove}`);
          }
          return;
        }
      }
    }
  }

  if (isTTSEnabled() && result.bestMove) {
    let perspective = state.settings.analysisSide || 'white';
    if (perspective === 'auto') {
      perspective = state.chess ? (state.chess.turn() === 'w' ? 'white' : 'black') : 'white';
    }
    const eval_ = result.evaluation || {};
    const human = evalToHuman(eval_.cp, eval_.mate, perspective);
    speak(`Best move: ${result.bestMove}. ${human.text}`);
  }
  
  if (els.analyzeBtn) els.analyzeBtn.disabled = false;
  if (els.stopBtn) els.stopBtn.style.display = 'none';
}

// Sound & Haptic FX Helper
function playMoveSoundFx(move) {
  if (!state.chess) return;
  if (state.chess.isCheckmate() || state.chess.isDraw()) {
    playGameEndSound();
  } else if (state.chess.isCheck()) {
    playCheckSound();
  } else if (move && move.captured) {
    playCaptureSound();
  } else if (move && move.flags && (move.flags.includes('k') || move.flags.includes('q'))) {
    playCastleSound();
  } else {
    playMoveSound();
  }
}

function updateSoundUI() {
  const enabled = !!state.settings.soundEnabled;
  if (els.soundToggleBtn) {
    els.soundToggleBtn.textContent = enabled ? '🔊' : '🔇';
    els.soundToggleBtn.title = enabled ? 'Mute Sound Effects' : 'Enable Sound Effects';
    els.soundToggleBtn.setAttribute('aria-label', enabled ? 'Mute Sound Effects' : 'Enable Sound Effects');
  }
  if (els.soundToggle) {
    els.soundToggle.value = enabled ? 'enabled' : 'disabled';
  }
}

function toggleSound() {
  const newEnabled = !state.settings.soundEnabled;
  state.settings.soundEnabled = newEnabled;
  setSoundEnabled(newEnabled);
  saveSettings();
  updateSoundUI();
  showToast(newEnabled ? 'Sound Effects Enabled 🔊' : 'Sound Effects Muted 🔇', 'info', 2000);
}

// Material & Captured Pieces
function getPieceSymbol(type, color) {
  const symbols = {
    w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
    b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
  };
  return (symbols[color] && symbols[color][type]) || '';
}

function calculateMaterial() {
  if (!state.chess) return { capturedByWhite: [], capturedByBlack: [], whiteDiff: 0, blackDiff: 0 };
  const initialCounts = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const currentCounts = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
  };

  const board = state.chess.board();
  for (const row of board) {
    for (const sq of row) {
      if (sq && sq.type !== 'k') {
        currentCounts[sq.color][sq.type] = (currentCounts[sq.color][sq.type] || 0) + 1;
      }
    }
  }

  const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const capturedByWhite = [];
  const capturedByBlack = [];
  let whiteMaterial = 0;
  let blackMaterial = 0;

  for (const type of ['q', 'r', 'b', 'n', 'p']) {
    const blackLost = Math.max(0, initialCounts[type] - (currentCounts.b[type] || 0));
    for (let i = 0; i < blackLost; i++) {
      capturedByWhite.push({ color: 'b', type });
      whiteMaterial += pieceValues[type];
    }
    const whiteLost = Math.max(0, initialCounts[type] - (currentCounts.w[type] || 0));
    for (let i = 0; i < whiteLost; i++) {
      capturedByBlack.push({ color: 'w', type });
      blackMaterial += pieceValues[type];
    }
  }

  const diff = whiteMaterial - blackMaterial;
  return {
    capturedByWhite,
    capturedByBlack,
    whiteDiff: diff > 0 ? diff : 0,
    blackDiff: diff < 0 ? Math.abs(diff) : 0
  };
}

function updatePlayerStripsUI() {
  const mat = calculateMaterial();
  const isFlipped = state.boardOrientation === 'black';

  const bottomColor = isFlipped ? 'black' : 'white';
  const topColor = isFlipped ? 'white' : 'black';

  if (els.topPlayerName) {
    if (state.gameMode === 'vs-computer') {
      const isComputerTop = (state.playerColor === 'white' && !isFlipped) || (state.playerColor === 'black' && isFlipped);
      els.topPlayerName.textContent = isComputerTop ? `Stockfish (Lvl ${state.difficulty})` : 'You';
      if (els.topPlayerIcon) els.topPlayerIcon.textContent = isComputerTop ? '🤖' : '👤';
      if (els.topPlayerBadge) els.topPlayerBadge.textContent = topColor === 'white' ? 'White' : 'Black';
    } else if (state.gameMode === 'local-1v1') {
      els.topPlayerName.textContent = topColor === 'white' ? 'White' : 'Black';
      if (els.topPlayerIcon) els.topPlayerIcon.textContent = topColor === 'white' ? '♔' : '♚';
      if (els.topPlayerBadge) els.topPlayerBadge.textContent = 'Player 2';
    } else {
      els.topPlayerName.textContent = topColor === 'white' ? 'White' : 'Black';
      if (els.topPlayerIcon) els.topPlayerIcon.textContent = topColor === 'white' ? '♔' : '♚';
      if (els.topPlayerBadge) els.topPlayerBadge.textContent = 'Analysis';
    }
  }

  if (els.bottomPlayerName) {
    if (state.gameMode === 'vs-computer') {
      const isComputerBottom = (state.playerColor === 'black' && !isFlipped) || (state.playerColor === 'white' && isFlipped);
      els.bottomPlayerName.textContent = isComputerBottom ? `Stockfish (Lvl ${state.difficulty})` : 'You';
      if (els.bottomPlayerIcon) els.bottomPlayerIcon.textContent = isComputerBottom ? '🤖' : '👤';
      if (els.bottomPlayerBadge) els.bottomPlayerBadge.textContent = bottomColor === 'white' ? 'White' : 'Black';
    } else if (state.gameMode === 'local-1v1') {
      els.bottomPlayerName.textContent = bottomColor === 'white' ? 'White' : 'Black';
      if (els.bottomPlayerIcon) els.bottomPlayerIcon.textContent = bottomColor === 'white' ? '♔' : '♚';
      if (els.bottomPlayerBadge) els.bottomPlayerBadge.textContent = 'Player 1';
    } else {
      els.bottomPlayerName.textContent = bottomColor === 'white' ? 'White' : 'Black';
      if (els.bottomPlayerIcon) els.bottomPlayerIcon.textContent = bottomColor === 'white' ? '♔' : '♚';
      if (els.bottomPlayerBadge) els.bottomPlayerBadge.textContent = 'Analysis';
    }
  }

  const topCaptured = topColor === 'white' ? mat.capturedByWhite : mat.capturedByBlack;
  const topDiff = topColor === 'white' ? mat.whiteDiff : mat.blackDiff;
  const bottomCaptured = bottomColor === 'white' ? mat.capturedByWhite : mat.capturedByBlack;
  const bottomDiff = bottomColor === 'white' ? mat.whiteDiff : mat.blackDiff;

  if (els.topCapturedPieces) {
    els.topCapturedPieces.innerHTML = topCaptured.map(p => 
      `<span class="captured-piece piece-${p.color === 'w' ? 'white' : 'black'}">${getPieceSymbol(p.type, p.color)}</span>`
    ).join('');
  }
  if (els.topMaterialDiff) {
    if (topDiff > 0) {
      els.topMaterialDiff.textContent = `+${topDiff}`;
      els.topMaterialDiff.classList.remove('hidden');
    } else {
      els.topMaterialDiff.classList.add('hidden');
    }
  }

  if (els.bottomCapturedPieces) {
    els.bottomCapturedPieces.innerHTML = bottomCaptured.map(p => 
      `<span class="captured-piece piece-${p.color === 'w' ? 'white' : 'black'}">${getPieceSymbol(p.type, p.color)}</span>`
    ).join('');
  }
  if (els.bottomMaterialDiff) {
    if (bottomDiff > 0) {
      els.bottomMaterialDiff.textContent = `+${bottomDiff}`;
      els.bottomMaterialDiff.classList.remove('hidden');
    } else {
      els.bottomMaterialDiff.classList.add('hidden');
    }
  }

  // Update clocks whenever player strips update
  updateClockUI();
}

// ============================================================================
// Chess Clocks & Time Controls
// ============================================================================
function formatClockTime(seconds) {
  if (isNaN(seconds) || seconds <= 0) {
    return '00:00.0';
  }
  if (seconds < 20) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const tenths = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
  }
  const totalSecs = Math.ceil(seconds);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateClockUI() {
  if (!els.topClock || !els.bottomClock) return;

  if (!state.clock.enabled || state.gameMode === 'analysis') {
    els.topClock.classList.add('hidden');
    els.bottomClock.classList.add('hidden');
    return;
  }

  els.topClock.classList.remove('hidden');
  els.bottomClock.classList.remove('hidden');

  const topColor = state.boardOrientation === 'white' ? 'black' : 'white';
  const bottomColor = state.boardOrientation;

  const topTime = topColor === 'white' ? state.clock.whiteTime : state.clock.blackTime;
  const bottomTime = bottomColor === 'white' ? state.clock.whiteTime : state.clock.blackTime;

  els.topClock.textContent = formatClockTime(topTime);
  els.bottomClock.textContent = formatClockTime(bottomTime);

  const isTopActive = state.clock.activeColor === topColor && !state.isGameOver;
  const isBottomActive = state.clock.activeColor === bottomColor && !state.isGameOver;

  els.topClock.classList.toggle('active', isTopActive);
  els.bottomClock.classList.toggle('active', isBottomActive);

  els.topClock.classList.toggle('low-time', topTime < 20 && topTime > 0);
  els.bottomClock.classList.toggle('low-time', bottomTime < 20 && bottomTime > 0);
}

function initClock(tc) {
  stopClock();
  state.clock.isFlagged = false;

  if (!tc || tc === 'none') {
    state.clock.enabled = false;
    state.clock.timeControl = 'none';
    state.clock.initialMinutes = 0;
    state.clock.incrementSeconds = 0;
    state.clock.whiteTime = 0;
    state.clock.blackTime = 0;
    state.clock.activeColor = null;
    updateClockUI();
    return;
  }

  const parts = tc.split('|');
  const minutes = parseFloat(parts[0]) || 5;
  const increment = parseFloat(parts[1]) || 0;

  state.clock.enabled = true;
  state.clock.timeControl = tc;
  state.clock.initialMinutes = minutes;
  state.clock.incrementSeconds = increment;
  state.clock.whiteTime = minutes * 60;
  state.clock.blackTime = minutes * 60;
  state.clock.activeColor = null;
  state.clock.lastTimestamp = performance.now();
  updateClockUI();
}

function clockTick() {
  if (!state.clock.enabled || !state.clock.activeColor || state.isGameOver) {
    return;
  }
  const now = performance.now();
  const delta = (now - state.clock.lastTimestamp) / 1000;
  state.clock.lastTimestamp = now;

  if (state.clock.activeColor === 'white') {
    state.clock.whiteTime = Math.max(0, state.clock.whiteTime - delta);
    if (state.clock.whiteTime <= 0) {
      handleTimeout('white');
      return;
    }
  } else if (state.clock.activeColor === 'black') {
    state.clock.blackTime = Math.max(0, state.clock.blackTime - delta);
    if (state.clock.blackTime <= 0) {
      handleTimeout('black');
      return;
    }
  }
  updateClockUI();
}

function startClockFor(color) {
  if (!state.clock.enabled || state.isGameOver) return;
  state.clock.activeColor = color;
  state.clock.lastTimestamp = performance.now();
  if (!state.clock.timerId) {
    state.clock.timerId = setInterval(clockTick, 50);
  }
  updateClockUI();
}

function switchClockTurn(nextColor, movedColor) {
  if (!state.clock.enabled || state.isGameOver) return;
  if (movedColor) {
    if (movedColor === 'white') {
      state.clock.whiteTime += state.clock.incrementSeconds;
    } else if (movedColor === 'black') {
      state.clock.blackTime += state.clock.incrementSeconds;
    }
  }
  state.clock.activeColor = nextColor;
  state.clock.lastTimestamp = performance.now();
  if (!state.clock.timerId) {
    state.clock.timerId = setInterval(clockTick, 50);
  }
  updateClockUI();
}

function stopClock() {
  if (state.clock.timerId) {
    clearInterval(state.clock.timerId);
    state.clock.timerId = null;
  }
  state.clock.activeColor = null;
  updateClockUI();
}

function handleTimeout(flaggedColor) {
  stopClock();
  state.isGameOver = true;
  state.clock.isFlagged = true;
  if (state.ground) {
    state.ground.set({ movable: { color: undefined, dests: new Map() } });
  }

  const opponentColor = flaggedColor === 'white' ? 'black' : 'white';
  const flaggedName = flaggedColor === 'white' ? 'White' : 'Black';
  const opponentName = opponentColor === 'white' ? 'White' : 'Black';

  playGameEndSound();

  const isOpponentInsufficient = state.chess && state.chess.isInsufficientMaterial();
  if (isOpponentInsufficient) {
    const msg = `Draw - ${flaggedName} ran out of time vs insufficient material`;
    if (els.gameStatusText) els.gameStatusText.textContent = msg;
    showToast(msg, 'info', 4000);
  } else {
    let winnerText;
    if (state.gameMode === 'vs-computer') {
      winnerText = flaggedColor === state.playerColor ? 'Computer wins on time!' : 'You win on time!';
    } else {
      winnerText = `${opponentName} wins on time!`;
    }
    const msg = `Time out! ${winnerText}`;
    if (els.gameStatusText) els.gameStatusText.textContent = msg;
    showToast(msg, 'warning', 4000);
  }

  if (els.resignBtn) els.resignBtn.style.display = 'none';
  if (els.newGameAgainBtn) els.newGameAgainBtn.style.display = '';
  updateClockUI();
}

// Move History & Step Navigation
function recordMoveInHistory(move) {
  if (!move || !state.chess) return;
  if (state.currentHistoryIndex < state.historyMoves.length - 1) {
    state.historyMoves = state.historyMoves.slice(0, state.currentHistoryIndex + 1);
  }

  state.historyMoves.push({
    san: move.san,
    from: move.from,
    to: move.to,
    piece: move.piece,
    flags: move.flags,
    fen: state.chess.fen(),
    color: move.color,
    turn: state.chess.turn()
  });

  state.currentHistoryIndex = state.historyMoves.length - 1;
  renderMoveHistoryUI();
  updateOpeningUI();
}

function renderMoveHistoryUI() {
  if (!els.historyMovesList) return;

  const moves = state.historyMoves;
  if (els.historyMoveCount) {
    els.historyMoveCount.textContent = `${moves.length} move${moves.length === 1 ? '' : 's'}`;
  }

  if (moves.length === 0) {
    els.historyMovesList.innerHTML = '<div class="history-empty-placeholder">No moves played yet</div>';
    if (els.navFirstBtn) els.navFirstBtn.disabled = true;
    if (els.navPrevBtn) els.navPrevBtn.disabled = true;
    if (els.navNextBtn) els.navNextBtn.disabled = true;
    if (els.navLastBtn) els.navLastBtn.disabled = true;
    if (els.navLiveBadge) els.navLiveBadge.classList.add('hidden');
    return;
  }

  let html = '';
  for (let i = 0; i < moves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const whiteMove = moves[i];
    const blackMove = moves[i + 1];

    const isWhiteActive = state.currentHistoryIndex === i;
    const isBlackActive = blackMove && state.currentHistoryIndex === (i + 1);

    html += `<div class="history-row">
      <span class="history-num">${moveNum}.</span>
      <button class="history-move-cell ${isWhiteActive ? 'active-step' : ''}" data-move-idx="${i}" aria-label="Move ${moveNum} White ${whiteMove.san}">${whiteMove.san}</button>
      ${blackMove ? `<button class="history-move-cell ${isBlackActive ? 'active-step' : ''}" data-move-idx="${i + 1}" aria-label="Move ${moveNum} Black ${blackMove.san}">${blackMove.san}</button>` : '<span class="history-move-cell" style="cursor: default; opacity: 0.3;">...</span>'}
    </div>`;
  }

  els.historyMovesList.innerHTML = html;

  const activeEl = els.historyMovesList.querySelector('.active-step');
  if (activeEl && els.historyMovesList) {
    els.historyMovesList.scrollTop = activeEl.offsetTop - els.historyMovesList.offsetTop;
  }

  const isAtStart = state.currentHistoryIndex === -1;
  const isAtLatest = state.currentHistoryIndex === moves.length - 1;

  if (els.navFirstBtn) els.navFirstBtn.disabled = isAtStart;
  if (els.navPrevBtn) els.navPrevBtn.disabled = isAtStart;
  if (els.navNextBtn) els.navNextBtn.disabled = isAtLatest;
  if (els.navLastBtn) els.navLastBtn.disabled = isAtLatest;

  if (els.navLiveBadge) {
    if (!isAtLatest) {
      els.navLiveBadge.classList.remove('hidden');
    } else {
      els.navLiveBadge.classList.add('hidden');
    }
  }
}

function goToHistoryIndex(idx) {
  const moves = state.historyMoves;
  if (moves.length === 0) return;

  const targetIdx = Math.max(-1, Math.min(moves.length - 1, idx));
  state.currentHistoryIndex = targetIdx;

  const isAtLatest = targetIdx === moves.length - 1;

  if (targetIdx === -1) {
    state.ground.set({
      fen: STARTING_FEN,
      lastMove: null,
      movable: {
        free: false,
        color: undefined,
        dests: new Map()
      }
    });
    if (state.gameMode === 'analysis') {
      triggerDebouncedAnalysis(200);
    }
  } else {
    const move = moves[targetIdx];
    const activeColor = move.turn === 'w' ? 'white' : 'black';

    state.ground.set({
      fen: move.fen,
      lastMove: [move.from, move.to],
      turnColor: activeColor,
      movable: {
        free: false,
        color: isAtLatest ? ((state.gameMode === 'vs-computer') ? (state.isGameOver ? undefined : state.playerColor) : activeColor) : undefined,
        dests: isAtLatest ? (state.isGameOver ? new Map() : getLegalMoves()) : new Map()
      }
    });

    if (state.gameMode === 'analysis') {
      triggerDebouncedAnalysis(200);
    }
  }

  renderMoveHistoryUI();
  updateOpeningUI();
}

function copyPgnToClipboard() {
  try {
    const pgn = state.chess ? state.chess.pgn() : '';
    if (!pgn || pgn.trim() === '') {
      showToast('No moves to copy yet', 'info', 2000);
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(pgn).then(() => {
        showToast('PGN copied to clipboard! 📋', 'success', 2500);
      }).catch(() => {
        showToast('Copied PGN!', 'success', 2000);
      });
    } else {
      showToast('Clipboard not supported', 'info', 2000);
    }
  } catch (e) {
    showToast('Failed to copy PGN', 'error', 2000);
  }
}

function copyFenToClipboard() {
  try {
    const fen = state.chess ? state.chess.fen() : state.currentFen;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fen).then(() => {
        showToast('FEN copied to clipboard! 📋', 'success', 2500);
      }).catch(() => {
        showToast('Copied FEN!', 'success', 2000);
      });
    } else {
      showToast('Clipboard not supported', 'info', 2000);
    }
  } catch (e) {
    showToast('Failed to copy FEN', 'error', 2000);
  }
}

// Opening Recognition Display
function updateOpeningUI() {
  if (!els.openingBar || !els.openingName) return;

  if (!state.chess || state.historyMoves.length === 0 || state.currentHistoryIndex === -1) {
    els.openingName.textContent = 'Starting Position';
    return;
  }

  const activeMoves = state.historyMoves.slice(0, state.currentHistoryIndex + 1);
  const opening = identifyOpening(activeMoves);
  if (opening) {
    els.openingName.textContent = `${opening.eco} ${opening.name}`;
    els.openingBar.classList.remove('hidden');
  } else {
    if (activeMoves.length <= 2) {
      els.openingName.textContent = 'Standard Opening';
    } else {
      els.openingName.textContent = 'Custom Position';
    }
  }
}

// PGN / FEN Import Dialog
function openImportModal() {
  if (els.importModal) {
    els.importModal.classList.remove('hidden');
    if (els.importInput) {
      els.importInput.value = '';
      els.importInput.focus();
    }
  }
}

function closeImportModal() {
  if (els.importModal) {
    els.importModal.classList.add('hidden');
  }
}

function handleImportData() {
  if (!els.importInput) return;
  const raw = els.importInput.value.trim();
  if (!raw) {
    showToast('Please paste a PGN or FEN first', 'warning', 2500);
    return;
  }

  // 1. Try FEN detection first
  const isFenLike = /^\s*([rnbqkbnr1-8\/]+)\s+([wb])\s+([kq-]+)\s+([a-h1-8-]+)/i.test(raw) ||
                    (raw.split(' ').length <= 6 && raw.includes('/'));

  if (isFenLike) {
    const validation = validateFen(raw);
    if (validation.valid) {
      stopAnalysis();
      stopClock();
      state.chess = new Chess(raw);
      state.currentFen = state.chess.fen();
      state.historyMoves = [];
      state.currentHistoryIndex = -1;
      state.isGameOver = state.chess.isGameOver ? state.chess.isGameOver() : false;

      const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
      state.ground.set({
        fen: state.currentFen,
        lastMove: null,
        turnColor: activeColor,
        movable: {
          free: false,
          color: activeColor,
          dests: getLegalMoves(),
          showDests: true
        }
      });

      if (els.fenInput) els.fenInput.value = state.currentFen;
      renderMoveHistoryUI();
      updatePlayerStripsUI();
      updateOpeningUI();
      closeImportModal();
      showToast('FEN position imported successfully! ♟️', 'success', 2500);

      if (state.gameMode !== 'analysis') {
        switchGameMode('analysis');
      } else {
        triggerDebouncedAnalysis(200);
      }
      return;
    }
  }

  // 2. Try PGN detection
  try {
    const testChess = new Chess();
    testChess.loadPgn(raw);
    const history = testChess.history({ verbose: true });
    if (history && history.length > 0) {
      stopAnalysis();
      stopClock();
      
      state.chess = new Chess();
      state.historyMoves = [];
      state.currentHistoryIndex = -1;

      for (const m of history) {
        const played = state.chess.move(m);
        if (played) {
          state.historyMoves.push({
            san: played.san,
            from: played.from,
            to: played.to,
            piece: played.piece,
            flags: played.flags,
            fen: state.chess.fen(),
            color: played.color,
            turn: state.chess.turn()
          });
        }
      }

      state.currentHistoryIndex = state.historyMoves.length - 1;
      state.currentFen = state.chess.fen();
      state.isGameOver = state.chess.isGameOver ? state.chess.isGameOver() : false;

      const lastMove = state.historyMoves.length > 0 
        ? [state.historyMoves[state.historyMoves.length - 1].from, state.historyMoves[state.historyMoves.length - 1].to] 
        : null;
      const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';

      state.ground.set({
        fen: state.currentFen,
        lastMove,
        turnColor: activeColor,
        movable: {
          free: false,
          color: state.isGameOver ? undefined : activeColor,
          dests: state.isGameOver ? new Map() : getLegalMoves(),
          showDests: true
        }
      });

      if (els.fenInput) els.fenInput.value = state.currentFen;
      renderMoveHistoryUI();
      updatePlayerStripsUI();
      updateOpeningUI();
      closeImportModal();
      showToast(`Imported game with ${state.historyMoves.length} moves! 📜`, 'success', 3000);

      if (state.gameMode !== 'analysis') {
        switchGameMode('analysis');
      } else {
        triggerDebouncedAnalysis(200);
      }
      return;
    }
  } catch (e) {
    console.warn('PGN parse error:', e);
  }

  showToast('Could not recognize format. Please paste a valid PGN or FEN.', 'error', 3500);
}

const DIFFICULTY_DEPTHS = { 1: 3, 2: 6, 3: 10, 4: 15, 5: 20, 6: 25 };

function switchGameMode(mode) {
  state.gameMode = mode;
  state.isGameOver = false;

  // Update mode buttons
  if (els.modeSelectorBtns) {
    els.modeSelectorBtns.forEach(btn => {
      const isActive = btn.dataset.mode === mode;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  // Show/hide mode panels
  if (els.vsComputerPanel) els.vsComputerPanel.classList.toggle('hidden', mode !== 'vs-computer');
  if (els.local1v1Panel) els.local1v1Panel.classList.toggle('hidden', mode !== 'local-1v1');

  // Show/hide analysis-specific HUD controls
  const analysisOnlyEls = [els.analyzeBtn, els.stopBtn, els.depthDisplay];
  analysisOnlyEls.forEach(el => {
    if (el) el.style.display = mode === 'analysis' ? '' : 'none';
  });

  // Show/hide game status bar
  if (els.gameStatusBar) {
    els.gameStatusBar.classList.toggle('hidden', mode === 'analysis');
  }

  // Show/hide editing controls (palette, free move, clear board, candidate lines, voice bar)
  const editControls = document.querySelector('.quick-actions-bar');
  const paletteControls = document.querySelector('.piece-palette-deck');
  const candidatePanel = document.querySelector('.candidate-moves-panel');
  const voiceBar = document.querySelector('.voice-type-bar');
  if (editControls) editControls.style.display = mode === 'analysis' ? '' : 'none';
  if (paletteControls) paletteControls.style.display = mode === 'analysis' ? '' : 'none';
  if (candidatePanel) candidatePanel.style.display = mode === 'analysis' ? '' : 'none';
  if (voiceBar) voiceBar.style.display = mode === 'analysis' ? '' : 'none';

  updatePlayerStripsUI();

  if (mode === 'analysis') {
    // Restore analysis mode
    stopClock();
    state.clock.enabled = false;
    updateClockUI();
    state.freePlacement = false;
    if (els.freeModeBtn) els.freeModeBtn.textContent = '✋ Free Move: OFF';
    const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
    state.ground.set({
      fen: state.chess.fen(),
      turnColor: activeColor,
      movable: {
        free: false,
        color: activeColor,
        dests: getLegalMoves(),
        showDests: true,
      },
      events: { move: handleBoardMove, select: handleBoardSelect },
    });
    state.analysisPaused = false;
    triggerDebouncedAnalysis(100);
  } else if (mode === 'vs-computer') {
    startNewGame('vs-computer');
  } else if (mode === 'local-1v1') {
    startNewGame('local-1v1');
  }
}

function startNewGame(mode) {
  stopAnalysis();
  stopClock();
  state.chess = new Chess();
  state.currentFen = STARTING_FEN;
  state.isGameOver = false;
  state.historyMoves = [];
  state.currentHistoryIndex = -1;
  state.ground.setAutoShapes([]);
  renderMoveHistoryUI();

  if (mode === 'vs-computer' || mode === 'local-1v1') {
    const tcSelect = mode === 'vs-computer' ? els.timeControlVs : els.timeControl1v1;
    const tc = tcSelect ? tcSelect.value : 'none';
    initClock(tc);
  } else {
    initClock('none');
  }

  updatePlayerStripsUI();
  updateOpeningUI();

  if (mode === 'vs-computer') {
    let color = els.playAsColor ? els.playAsColor.value : 'white';
    if (color === 'random') color = Math.random() < 0.5 ? 'white' : 'black';
    state.playerColor = color;
    state.difficulty = parseInt(els.difficultyLevel ? els.difficultyLevel.value : '3', 10) || 3;

    state.boardOrientation = state.playerColor;
    state.ground.set({
      orientation: state.playerColor,
      fen: state.chess.fen(),
      turnColor: 'white',
      lastMove: null,
      movable: {
        free: false,
        color: state.playerColor,
        dests: state.playerColor === 'white' ? getLegalMoves() : new Map(),
        showDests: true,
      },
      events: { move: handleBoardMove, select: handleBoardSelect },
    });

    updateGameStatus();
    if (els.resignBtn) els.resignBtn.style.display = '';
    if (els.newGameAgainBtn) els.newGameAgainBtn.style.display = 'none';

    if (state.clock.enabled) {
      startClockFor('white');
    }

    if (state.playerColor === 'black') {
      makeComputerMove();
    }
  } else if (mode === 'local-1v1') {
    state.boardOrientation = 'white';
    state.ground.set({
      orientation: 'white',
      fen: state.chess.fen(),
      turnColor: 'white',
      lastMove: null,
      movable: {
        free: false,
        color: 'white',
        dests: getLegalMoves(),
        showDests: true,
      },
      events: { move: handleBoardMove, select: handleBoardSelect },
    });

    updateGameStatus();
    if (els.resignBtn) els.resignBtn.style.display = 'none';
    if (els.newGameAgainBtn) els.newGameAgainBtn.style.display = 'none';

    if (state.clock.enabled) {
      startClockFor('white');
    }
  }

  showToast('New game started!', 'success', 2000);
}

function updateGameStatus() {
  if (!els.gameStatusText) return;

  if (state.chess.isCheckmate()) {
    stopClock();
    const winner = state.chess.turn() === 'w' ? 'Black' : 'White';
    els.gameStatusText.textContent = `Checkmate! ${winner} wins.`;
    state.isGameOver = true;
    if (els.resignBtn) els.resignBtn.style.display = 'none';
    if (els.newGameAgainBtn) els.newGameAgainBtn.style.display = '';
    state.ground.set({ movable: { color: undefined, dests: new Map() } });
    showToast(`Checkmate! ${winner} wins!`, 'success', 3000);
    return;
  }
  if (state.chess.isDraw()) {
    stopClock();
    let reason = 'Draw';
    if (state.chess.isStalemate()) reason = 'Draw by Stalemate';
    else if (state.chess.isThreefoldRepetition()) reason = 'Draw by Repetition';
    else if (state.chess.isInsufficientMaterial()) reason = 'Draw by Insufficient Material';
    els.gameStatusText.textContent = reason;
    state.isGameOver = true;
    if (els.resignBtn) els.resignBtn.style.display = 'none';
    if (els.newGameAgainBtn) els.newGameAgainBtn.style.display = '';
    state.ground.set({ movable: { color: undefined, dests: new Map() } });
    showToast(reason, 'info', 3000);
    return;
  }

  const currentTurn = state.chess.turn() === 'w' ? 'White' : 'Black';
  const inCheck = state.chess.isCheck() ? ' (Check!)' : '';

  if (state.gameMode === 'vs-computer') {
    const isPlayerTurn = (state.chess.turn() === 'w' && state.playerColor === 'white') ||
                         (state.chess.turn() === 'b' && state.playerColor === 'black');
    els.gameStatusText.textContent = isPlayerTurn
      ? `Your turn (${currentTurn})${inCheck}`
      : `Computer thinking...`;
  } else {
    els.gameStatusText.textContent = `${currentTurn}'s turn${inCheck}`;
  }
}

function makeComputerMove() {
  if (state.isGameOver || !state.engineReady) return;
  updateGameStatus();
  const depth = DIFFICULTY_DEPTHS[state.difficulty] || 10;
  startAnalysis(state.chess.fen(), { depth, multiPV: 1 });
}

async function handleModeToggle() {
  if (state.mode === 'setup') {
    // Switch to Analysis
    const fen = getFenFromBoard();
    const validation = validateFen(fen);
    
    if (!validation.valid) {
      showToast(`Invalid position: ${validation.error}`, 'error');
      return;
    }
    
    state.currentFen = fen;
    state.chess.load(fen);
    
    state.mode = 'analysis';
    document.body.setAttribute('data-mode', state.mode);
    
    if (els.modeToggleBtn) els.modeToggleBtn.innerHTML = '<span class="icon">♟</span> <span class="label">Switch to Setup</span>';
    showToast('Analysis Mode', 'success', 2000);
    
    // Update board configuration for analysis mode (enforce rules)
    const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
    state.ground.set({
      fen: state.chess.fen(),
      turnColor: activeColor,
      movable: state.freePlacement 
        ? { free: true, color: 'both', dests: new Map() } 
        : {
          free: false,
          color: activeColor,
          dests: getLegalMoves(),
          showDests: true
        },
      events: {
        move: handleBoardMove,
        select: handleBoardSelect,
      }
    });

    if (state.engineReady) {
      startAnalysis(state.currentFen, { 
        depth: state.settings.depth, 
        multiPV: state.settings.multiPV,
        threads: state.settings.threads
      });
    }
    
  } else {
    // Switch to Setup
    stopAnalysis();
    if (els.analyzeBtn) els.analyzeBtn.disabled = false;
    if (els.stopBtn) els.stopBtn.style.display = 'none';
    
    state.mode = 'setup';
    document.body.setAttribute('data-mode', state.mode);
    
    if (els.modeToggleBtn) els.modeToggleBtn.innerHTML = '<span class="icon">♟</span> <span class="label">Switch to Analysis</span>';
    showToast('Setup Mode', 'info', 2000);
    
    // Clear arrows
    state.ground.setAutoShapes([]);
  }
}

function getLegalMoves() {
  const dests = new Map();
  try {
    if (!state.chess) return dests;
    state.chess.moves({ verbose: true }).forEach(m => {
      const a = dests.get(m.from) || [];
      a.push(m.to);
      dests.set(m.from, a);
    });
  } catch (e) {
    console.warn('Could not compute legal moves:', e);
  }
  return dests;
}

function bindEvents() {
  // Game Mode Selector
  if (els.modeSelectorBtns) {
    els.modeSelectorBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchGameMode(btn.dataset.mode);
      });
    });
  }

  // New Game & Resign Buttons
  if (els.newGameBtn) {
    els.newGameBtn.addEventListener('click', () => startNewGame('vs-computer'));
  }
  if (els.new1v1Btn) {
    els.new1v1Btn.addEventListener('click', () => startNewGame('local-1v1'));
  }
  if (els.resignBtn) {
    els.resignBtn.addEventListener('click', () => {
      stopClock();
      state.isGameOver = true;
      const winner = state.playerColor === 'white' ? 'Black' : 'White';
      if (els.gameStatusText) els.gameStatusText.textContent = `You resigned. ${winner} wins.`;
      if (els.resignBtn) els.resignBtn.style.display = 'none';
      if (els.newGameAgainBtn) els.newGameAgainBtn.style.display = '';
      state.ground.set({ movable: { color: undefined, dests: new Map() } });
      showToast(`You resigned. ${winner} wins.`, 'info', 3000);
    });
  }
  if (els.newGameAgainBtn) {
    els.newGameAgainBtn.addEventListener('click', () => {
      startNewGame(state.gameMode);
    });
  }

  // Time Control Selectors
  if (els.timeControlVs) {
    els.timeControlVs.addEventListener('change', () => {
      if (state.gameMode === 'vs-computer' && state.historyMoves.length === 0) {
        initClock(els.timeControlVs.value);
        if (state.clock.enabled) {
          startClockFor('white');
        }
      }
    });
  }
  if (els.timeControl1v1) {
    els.timeControl1v1.addEventListener('change', () => {
      if (state.gameMode === 'local-1v1' && state.historyMoves.length === 0) {
        initClock(els.timeControl1v1.value);
        if (state.clock.enabled) {
          startClockFor('white');
        }
      }
    });
  }

  // Analyze Button
  if (els.analyzeBtn) {
    els.analyzeBtn.addEventListener('click', async () => {
      if (state.mode !== 'analysis') {
        handleModeToggle();
      }
      const fen = getFenFromBoard();
      const validation = validateFen(fen);
      
      if (!validation.valid) {
        showToast(`Cannot analyze invalid position: ${validation.error}`, 'error');
        return;
      }
      
      if (!state.engineReady) {
        showToast('Engine is still loading...', 'warning');
        return;
      }
      
      state.analysisPaused = false;
      els.analyzeBtn.disabled = true;
      if (els.stopBtn) els.stopBtn.style.display = 'inline-block';
      
      try {
        await startAnalysis(fen, { 
          depth: state.settings.depth, 
          multiPV: state.settings.multiPV,
          threads: state.settings.threads
        });
      } catch (e) {
        showToast('Failed to start analysis', 'error');
        els.analyzeBtn.disabled = false;
        if (els.stopBtn) els.stopBtn.style.display = 'none';
      }
    });
  }
  
  // Stop Button
  if (els.stopBtn) {
    els.stopBtn.addEventListener('click', () => {
      stopAnalysis();
      state.analysisPaused = true;
      if (els.analyzeBtn) {
        els.analyzeBtn.disabled = false;
        els.analyzeBtn.textContent = '⚡ Analyze';
      }
      els.stopBtn.style.display = 'none';
    });
  }
  
  // Flip Board
  if (els.flipBtn) {
    els.flipBtn.addEventListener('click', () => {
      state.boardOrientation = state.boardOrientation === 'white' ? 'black' : 'white';
      state.ground.set({ orientation: state.boardOrientation });
      updatePlayerStripsUI();
    });
  }

  // Sound Effects Toggle
  if (els.soundToggleBtn) {
    els.soundToggleBtn.addEventListener('click', toggleSound);
  }
  if (els.soundToggle) {
    els.soundToggle.addEventListener('change', (e) => {
      const enabled = e.target.value === 'enabled';
      state.settings.soundEnabled = enabled;
      setSoundEnabled(enabled);
      saveSettings();
      updateSoundUI();
    });
  }

  // Move History Navigation & Actions
  if (els.navFirstBtn) {
    els.navFirstBtn.addEventListener('click', () => goToHistoryIndex(-1));
  }
  if (els.navPrevBtn) {
    els.navPrevBtn.addEventListener('click', () => goToHistoryIndex(state.currentHistoryIndex - 1));
  }
  if (els.navNextBtn) {
    els.navNextBtn.addEventListener('click', () => goToHistoryIndex(state.currentHistoryIndex + 1));
  }
  if (els.navLastBtn) {
    els.navLastBtn.addEventListener('click', () => goToHistoryIndex(state.historyMoves.length - 1));
  }
  if (els.navLiveBadge) {
    els.navLiveBadge.addEventListener('click', () => goToHistoryIndex(state.historyMoves.length - 1));
  }
  if (els.historyMovesList) {
    els.historyMovesList.addEventListener('click', (e) => {
      const cell = e.target.closest('.history-move-cell');
      if (cell && cell.dataset.moveIdx !== undefined) {
        goToHistoryIndex(parseInt(cell.dataset.moveIdx, 10));
      }
    });
  }
  if (els.copyPgnBtn) {
    els.copyPgnBtn.addEventListener('click', copyPgnToClipboard);
  }
  if (els.copyFenBtn) {
    els.copyFenBtn.addEventListener('click', copyFenToClipboard);
  }
  if (els.importBtn) {
    els.importBtn.addEventListener('click', openImportModal);
  }
  if (els.importQuickBtn) {
    els.importQuickBtn.addEventListener('click', openImportModal);
  }
  if (els.closeImportBtn) {
    els.closeImportBtn.addEventListener('click', closeImportModal);
  }
  if (els.importSubmitBtn) {
    els.importSubmitBtn.addEventListener('click', handleImportData);
  }
  if (els.importClearBtn) {
    els.importClearBtn.addEventListener('click', () => {
      if (els.importInput) els.importInput.value = '';
    });
  }
  if (els.importModal) {
    els.importModal.addEventListener('click', (e) => {
      if (e.target === els.importModal) closeImportModal();
    });
  }
  if (els.boardThemeSelect) {
    els.boardThemeSelect.value = state.settings.boardTheme || 'brown';
    els.boardThemeSelect.addEventListener('change', (e) => {
      applyBoardTheme(e.target.value);
      saveSettings();
      showToast(`Board Theme: ${e.target.options[e.target.selectedIndex].text}`, 'info', 1500);
    });
  }

  // Keyboard navigation for Move History (ArrowLeft, ArrowRight, Home, End)
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goToHistoryIndex(state.currentHistoryIndex - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goToHistoryIndex(state.currentHistoryIndex + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      goToHistoryIndex(-1);
    } else if (e.key === 'End') {
      e.preventDefault();
      goToHistoryIndex(state.historyMoves.length - 1);
    }
  });
  
  // Depth Slider
  if (els.depthSlider) {
    els.depthSlider.value = state.settings.depth;
    if (els.depthValue) els.depthValue.textContent = state.settings.depth;
    if (els.depthDisplay) els.depthDisplay.textContent = `Depth: ${state.settings.depth}`;
    
    els.depthSlider.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      state.settings.depth = v;
      if (els.depthValue) els.depthValue.textContent = v;
      if (els.depthDisplay) els.depthDisplay.textContent = `Depth: ${v}`;
      setDepth(v);
      saveSettings();
    });
  }

  // Analysis Side (Perspective) Select
  if (els.analysisSideSelect) {
    els.analysisSideSelect.value = state.settings.analysisSide || 'white';
    els.analysisSideSelect.addEventListener('change', (e) => {
      state.settings.analysisSide = e.target.value;
      saveSettings();
      if (state.engineReady && !state.analysisPaused && state.gameMode === 'analysis') {
        const fen = getFenFromBoard();
        const validation = validateFen(fen);
        if (validation.valid) {
          startAnalysis(fen, {
            depth: state.settings.depth,
            multiPV: state.settings.multiPV,
            threads: state.settings.threads
          });
        }
      }
    });
  }
  
  // TTS Toggle
  if (els.ttsToggleBtn) {
    setTTSEnabled(state.settings.ttsEnabled);
    if (state.settings.ttsEnabled) {
      els.ttsToggleBtn.classList.add('active');
    }
    
    els.ttsToggleBtn.addEventListener('click', () => {
      const newState = !isTTSEnabled();
      setTTSEnabled(newState);
      state.settings.ttsEnabled = newState;
      saveSettings();
      
      if (newState) {
        els.ttsToggleBtn.classList.add('active');
        showToast('Text-to-Speech enabled');
      } else {
        els.ttsToggleBtn.classList.remove('active');
        showToast('Text-to-Speech disabled');
      }
    });
  }
  
  // Clear Board / Starting Position
  if (els.clearBoardBtn) {
    els.clearBoardBtn.addEventListener('click', handleClearBoard);
  }
  
  if (els.startingPosBtn) {
    els.startingPosBtn.addEventListener('click', handleResetStartingPosition);
  }

  // Settings Modal Toggle & Backdrop Close
  if (els.settingsBtn && els.settingsModal) {
    els.settingsBtn.addEventListener('click', () => els.settingsModal.classList.remove('hidden'));
  }
  if (els.closeSettingsBtn && els.settingsModal) {
    els.closeSettingsBtn.addEventListener('click', () => els.settingsModal.classList.add('hidden'));
  }
  if (els.settingsModal) {
    els.settingsModal.addEventListener('click', (e) => {
      if (e.target === els.settingsModal) {
        els.settingsModal.classList.add('hidden');
      }
    });
  }
  if (els.themeToggle) {
    els.themeToggle.value = state.settings.theme;
    els.themeToggle.addEventListener('change', (e) => {
      state.settings.theme = e.target.value;
      applyTheme();
      saveSettings();
    });
  }
  if (els.multiPvInput) {
    els.multiPvInput.value = state.settings.multiPV;
    els.multiPvInput.addEventListener('change', (e) => {
      const val = Math.max(1, Math.min(5, parseInt(e.target.value, 10) || 3));
      state.settings.multiPV = val;
      saveSettings();
      if (state.engineReady && state.mode === 'analysis') {
        startAnalysis(state.currentFen, { 
          depth: state.settings.depth, 
          multiPV: state.settings.multiPV,
          threads: state.settings.threads
        });
      }
      showToast(`Candidate lines: ${val}`, 'info', 1500);
    });
  }
  if (els.ttsSpeedInput) {
    els.ttsSpeedInput.value = state.settings.ttsSpeed || 1.0;
    if (els.ttsSpeedValue) els.ttsSpeedValue.textContent = (state.settings.ttsSpeed || 1.0).toFixed(1);
    els.ttsSpeedInput.addEventListener('input', (e) => {
      const rate = parseFloat(e.target.value) || 1.0;
      state.settings.ttsSpeed = rate;
      if (els.ttsSpeedValue) els.ttsSpeedValue.textContent = rate.toFixed(1);
      setRate(rate);
      saveSettings();
    });
  }

  // Command Input (Text Box)
  if (els.commandInput && els.commandSubmitBtn) {
    const submitCommand = () => {
      const val = els.commandInput.value;
      if (val && val.trim()) {
        processUserCommandOrMove(val.trim());
        els.commandInput.value = '';
      }
    };
    
    els.commandSubmitBtn.addEventListener('click', submitCommand);
    els.commandInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitCommand();
      }
    });
  }

  // Push-To-Talk (Hold to Speak)
  if (els.pttBtn) {
    let pttActive = false;

    const handlePttStart = (e) => {
      e.preventDefault();
      if (pttActive) return;
      pttActive = true;
      const started = startPushToTalk();
      els.pttBtn.classList.add('recording');
      els.pttBtn.innerHTML = '<span class="icon">🔴</span> <span class="label">Listening...</span>';
    };

    const handlePttEnd = (e) => {
      e.preventDefault();
      if (!pttActive) return;
      pttActive = false;
      stopPushToTalk();
      els.pttBtn.classList.remove('recording');
      els.pttBtn.innerHTML = '<span class="icon">🎙️</span> <span class="label">Hold to Speak</span>';
    };

    els.pttBtn.addEventListener('pointerdown', handlePttStart);
    els.pttBtn.addEventListener('pointerup', handlePttEnd);
    els.pttBtn.addEventListener('pointerleave', handlePttEnd);
    els.pttBtn.addEventListener('pointercancel', handlePttEnd);
  }
  // Window Resize & Orientation
  let resizeRaf = null;
  const debouncedResize = () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (state.ground) state.ground.redrawAll();
    });
  };
  window.addEventListener('resize', debouncedResize, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(debouncedResize, 100), { passive: true });


  // Free Placement Mode Toggle
  if (els.freeModeBtn) {
    els.freeModeBtn.addEventListener('click', () => {
      state.freePlacement = !state.freePlacement;
      const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
      if (state.freePlacement) {
        els.freeModeBtn.classList.add('active');
        els.freeModeBtn.textContent = '✋ Free Move: ON';
        state.ground.set({
          turnColor: activeColor,
          movable: { free: true, color: 'both', dests: new Map() },
          events: {
            move: handleBoardMove,
            select: handleBoardSelect
          }
        });
        showToast('Free Move: ON (Move any piece anywhere)', 'info', 2000);
      } else {
        els.freeModeBtn.classList.remove('active');
        els.freeModeBtn.textContent = '✋ Free Move: OFF';
        state.ground.set({
          turnColor: activeColor,
          movable: { 
            free: false, 
            color: activeColor, 
            dests: getLegalMoves(),
            showDests: true
          },
          events: {
            move: handleBoardMove,
            select: handleBoardSelect
          }
        });
        showToast(`Standard Rules: ON (${activeColor} to move)`, 'info', 2000);
      }
    });
  }

  // 2-Row Palette Buttons
  document.querySelectorAll('.palette-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const isTrash = btn.getAttribute('data-action') === 'trash';
      const alreadySelected = btn.classList.contains('selected');
      document.querySelectorAll('.palette-item').forEach(b => b.classList.remove('selected'));
      
      if (alreadySelected) {
        state.selectedQuickPiece = null;
        return;
      }

      if (isTrash) {
        state.selectedQuickPiece = 'trash';
        btn.classList.add('selected');
        showToast('Trash active: click any piece on the board to delete it', 'info', 2500);
      } else {
        const color = btn.getAttribute('data-color');
        const role = btn.getAttribute('data-role');
        state.selectedQuickPiece = { color, role };
        btn.classList.add('selected');
        showToast(`Tap any square to place ${color} ${role}`, 'info', 2000);
      }
    });
  });

  // Help Modal Toggle
  const openHelp = () => {
    if (els.helpModal) els.helpModal.classList.remove('hidden');
  };
  const closeHelp = () => {
    if (els.helpModal) els.helpModal.classList.add('hidden');
  };

  if (els.helpBtn) els.helpBtn.addEventListener('click', openHelp);
  if (els.closeHelpBtn) els.closeHelpBtn.addEventListener('click', closeHelp);
  if (els.helpModal) {
    els.helpModal.addEventListener('click', (e) => {
      if (e.target === els.helpModal) closeHelp();
    });
  }
}

function handleVoiceCommand(command) {
  const cmd = command.toLowerCase().trim();
  
  if (cmd.includes('analyze')) {
    if (els.analyzeBtn && !els.analyzeBtn.disabled) els.analyzeBtn.click();
  } else if (cmd.includes('clear')) {
    if (els.clearBoardBtn) els.clearBoardBtn.click();
  } else if (cmd.includes('reset') || cmd.includes('starting')) {
    if (els.startingPosBtn) els.startingPosBtn.click();
  } else if (cmd.includes('flip')) {
    if (els.flipBtn) els.flipBtn.click();
  } else if (cmd.includes('stop')) {
    if (els.stopBtn) els.stopBtn.click();
  } else if (cmd.includes('setup')) {
    if (state.mode !== 'setup') handleModeToggle();
  } else if (cmd.includes('analysis')) {
    if (state.mode !== 'analysis') handleModeToggle();
  } else if (cmd.includes('eval') || cmd.includes('score')) {
    if (els.evalScore && isTTSEnabled()) {
      speak(`The evaluation is ${els.evalScore.textContent}`);
    }
  }
}

function handleVoiceMove(san, from, to, promotion) {
  if (state.mode === 'analysis') {
    // Try to make the move via chess.js
    try {
      const move = state.chess.move(san || { from, to, promotion: promotion || 'q' });
      if (move) {
        state.currentFen = state.chess.fen();
        const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
        state.ground.set({
          fen: state.currentFen,
          lastMove: [move.from, move.to],
          turnColor: activeColor,
          movable: {
            free: false,
            color: activeColor,
            dests: getLegalMoves(),
            showDests: true
          }
        });
        showToast(`Move made: ${move.san}`, 'success', 1500);
      } else {
        showToast(`Invalid move: ${san}`, 'warning');
      }
    } catch (e) {
      showToast(`Invalid move format: ${san}`, 'warning');
    }
  } else {
    // In setup mode, maybe place a piece if supported, else warn
    showToast('Move recognition is best used in Analysis Mode', 'info');
  }
}

async function init() {
  try {
    loadSettings();
    applyTheme();
    initDOM();
    
    // Sync initial UI controls with loaded settings
    if (els.depthSlider) els.depthSlider.value = state.settings.depth;
    if (els.depthValue) els.depthValue.textContent = state.settings.depth;
    if (els.depthDisplay) els.depthDisplay.textContent = `Depth: ${state.settings.depth}`;
    if (els.analysisSideSelect) els.analysisSideSelect.value = state.settings.analysisSide || 'white';
    if (els.ttsSpeedInput) els.ttsSpeedInput.value = state.settings.ttsSpeed || 1.0;
    if (els.ttsSpeedValue) els.ttsSpeedValue.textContent = (state.settings.ttsSpeed || 1.0).toFixed(1);
    if (els.multiPvInput) els.multiPvInput.value = state.settings.multiPV || 3;
    
    // 1. Initialize Chess.js
    try {
      state.chess = new Chess();
    } catch (err) {
      console.error('Failed to initialize chess.js', err);
      showToast('Critical Error: Could not load Chess logic', 'error', 0);
    }
    
    // 2. Initialize Chessground
    if (!els.board) {
      console.warn('Board element not found in DOM');
      return; // Stop initialization if there's no board
    }
    
    const ChessgroundClass = await loadChessground();
    state.ground = ChessgroundClass(els.board, {
      fen: state.currentFen.split(' ')[0],
      orientation: state.boardOrientation,
      movable: state.mode === 'analysis' 
        ? { free: false, color: state.chess.turn() === 'w' ? 'white' : 'black', dests: getLegalMoves(), showDests: true }
        : { free: true, color: 'both', dests: new Map(), showDests: true },
      draggable: {
        enabled: true,
        distance: 3,
        autoDistance: true,
        showGhost: true,
        deleteOnDropOff: false
      },
      selectable: { enabled: true },
      animation: { enabled: true, duration: 180 },
      coordinates: true,
      blockTouchScroll: true,
      highlight: { lastMove: true, check: true },
      events: {
        move: handleBoardMove,
        select: handleBoardSelect,
      }
    });
    setTimeout(() => state.ground?.redrawAll(), 60);
    window.appState = state;
    
    // Initialize Sound, Player Strips, Move History, Opening & Board Theme
    initSound(state.settings.soundEnabled !== false);
    updateSoundUI();
    updatePlayerStripsUI();
    renderMoveHistoryUI();
    updateOpeningUI();
    applyBoardTheme(state.settings.boardTheme || 'brown');

    // 3. Initialize Stockfish Engine
    if (els.engineStatusText) els.engineStatusText.textContent = 'Loading...';
    initEngine({
      onReady: () => {
        state.engineReady = true;
        if (els.statusDot) {
          els.statusDot.classList.remove('error');
          els.statusDot.classList.add('ready');
        }
        if (els.engineStatusText) {
          els.engineStatusText.textContent = 'Stockfish Ready ⚡';
        }
        showToast('Stockfish Engine Ready ⚡', 'success', 2000);
        if (state.mode === 'analysis') {
          startAnalysis(state.currentFen, { 
            depth: state.settings.depth, 
            multiPV: state.settings.multiPV,
            threads: state.settings.threads
          });
        }
      },
      onAnalysisUpdate: (result) => {
        if (result.type === 'bestmove') {
          onBestMove(result);
        } else {
          onAnalysisUpdate(result);
        }
      },
      onError: (err) => {
        if (els.statusDot) els.statusDot.classList.add('error');
        if (els.engineStatusText) els.engineStatusText.textContent = 'Offline';
        const msg = err?.message || (typeof err === 'string' ? err : 'Worker failed to load');
        showToast(`Engine Error: ${msg}`, 'error', 4000);
      }
    }).catch(e => {
      console.error('Stockfish init failed:', e);
      if (els.statusDot) els.statusDot.classList.add('error');
      if (els.engineStatusText) els.engineStatusText.textContent = 'Offline';
    });
    
    // 4. Initialize Voice
    try {
      const voiceSupport = await initVoice({
        onMoveRecognized: (san, from, to, promo, parsed) => {
          handleMoveExecution(parsed || { san, from, to, promotion: promo });
        },
        onCommandRecognized: handleVoiceCommand,
        onSetupCommand: (action, parsed) => {
          if (parsed && parsed.type === 'remove') {
            handlePieceRemoval(parsed.square);
          } else if (parsed && parsed.type === 'placement') {
            handlePiecePlacement(parsed.color, parsed.role, parsed.square);
          }
        },
        onUnknown: (text) => {
          showToast(`Ignored: "${text}" (format not recognized. Try e.g. "Knight to e5", "c2 to c5", or "White Queen to f6")`, 'info', 3500);
        },
        onTranscript: (text, isFinal) => {
          if (els.voiceFeedback) {
            els.voiceFeedback.textContent = text;
            els.voiceFeedback.style.opacity = '1';
            
            if (isFinal) {
              setTimeout(() => {
                els.voiceFeedback.style.opacity = '0';
              }, 2000);
            }
          }
        },
        onError: (err) => showToast(`Voice Error: ${err}`, 'warning')
      });
      state.voiceSupported = voiceSupport;
    } catch (e) {
      console.warn('Voice initialization failed', e);
    }

    // Bind events
    bindEvents();
    
    // Finished loading
    showToast('ChessMind ready', 'success');
    
  } catch (err) {
    console.error('Initialization error:', err);
    showToast('Failed to initialize application', 'error', 0);
  }
}

// Start app when window and assets are loaded
if (document.readyState === 'complete') {
  init();
} else {
  window.addEventListener('load', init);
}
