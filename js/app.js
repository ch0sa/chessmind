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
  settings: {
    theme: 'dark',
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

function initDOM() {
  els.board = document.getElementById('board');
  els.analyzeBtn = document.getElementById('analyze-btn');
  els.stopBtn = document.getElementById('stop-btn');
  els.flipBtn = document.getElementById('flip-board-btn');
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
  
  // Game Mode & Play Controls
  els.modeSelectorBtns = document.querySelectorAll('.mode-btn');
  els.vsComputerPanel = document.getElementById('vs-computer-panel');
  els.local1v1Panel = document.getElementById('local-1v1-panel');
  els.playAsColor = document.getElementById('play-as-color');
  els.difficultyLevel = document.getElementById('difficulty-level');
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
        const activeColor = state.chess.turn() === 'w' ? 'white' : 'black';
        state.ground.set({
          fen: state.currentFen,
          lastMove: [move.from, move.to],
          turnColor: activeColor,
          movable: state.freePlacement ? { free: true, color: 'both', dests: new Map() } : {
            free: false,
            color: activeColor,
            dests: getLegalMoves(),
            showDests: true
          }
        });
        if (els.fenInput) els.fenInput.value = state.currentFen;
        showToast(`Move made: ${move.san}`, 'success', 1500);
        if (isTTSEnabled()) {
          speak(formatMoveForSpeech(move.san, move.piece, move.from, move.to, move.flags));
        }
        if (state.engineReady) {
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

  // Show/hide editing controls (palette, free move, clear board) — only in analysis
  const editControls = document.querySelector('.quick-actions-bar');
  const paletteControls = document.querySelector('.piece-palette-deck');
  if (editControls) editControls.style.display = mode === 'analysis' ? '' : 'none';
  if (paletteControls) paletteControls.style.display = mode === 'analysis' ? '' : 'none';

  if (mode === 'analysis') {
    // Restore analysis mode
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
  state.chess = new Chess();
  state.currentFen = STARTING_FEN;
  state.isGameOver = false;
  state.ground.setAutoShapes([]);

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
  }

  showToast('New game started!', 'success', 2000);
}

function updateGameStatus() {
  if (!els.gameStatusText) return;

  if (state.chess.isCheckmate()) {
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
    });
  }
  
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
