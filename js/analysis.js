/**
 * ChessMind - Stockfish WASM Analysis Module
 * Handles communication with Stockfish running in a Web Worker.
 * @module analysis
 */


/** @type {Worker|null} */
let engine = null;

/** @type {boolean} */
let isReady = false;

/** @type {boolean} */
let isAnalyzing = false;

/** @type {Function|null} */
let onAnalysisUpdate = null;

/** @type {Function|null} */
let onReady = null;

/** @type {Function|null} */
let onError = null;

const isMobileDevice = typeof navigator !== 'undefined' && (
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
  (typeof window !== 'undefined' && window.innerWidth <= 768)
);

/** Current analysis state */
const analysisState = {
  depth: isMobileDevice ? 15 : 18,
  multiPV: 3,
  threads: isMobileDevice ? 1 : (navigator.hardwareConcurrency ? Math.max(1, Math.min(2, Math.floor(navigator.hardwareConcurrency / 2))) : 1),
  hashMB: 16,
  currentFen: '',
  results: {
    bestMove: null,
    ponder: null,
    evaluation: null,
    lines: [],
    depth: 0,
    nodes: 0,
    nps: 0,
    time: 0,
  },
};

let updatePending = false;
let lastUpdateTime = 0;
const UPDATE_THROTTLE_MS = 100; // max 10 UI updates per second to preserve mobile CPU/GPU

function scheduleAnalysisUpdate() {
  if (updatePending) return;
  const now = performance.now();
  const elapsed = now - lastUpdateTime;

  if (elapsed >= UPDATE_THROTTLE_MS) {
    lastUpdateTime = now;
    if (onAnalysisUpdate) {
      onAnalysisUpdate({ type: 'info', ...analysisState.results });
    }
  } else {
    updatePending = true;
    requestAnimationFrame(() => {
      updatePending = false;
      lastUpdateTime = performance.now();
      if (onAnalysisUpdate) {
        onAnalysisUpdate({ type: 'info', ...analysisState.results });
      }
    });
  }
}

/**
 * Evaluation score to human-readable text
 * @param {number|null} cp - Centipawn score
 * @param {number|null} mate - Mate in N moves
 * @param {'white'|'black'} perspective - From whose perspective
 * @returns {{ text: string, short: string, className: string }}
 */
export function evalToHuman(cp, mate, perspective = 'white') {
  if (mate !== null && mate !== undefined) {
    const mateVal = perspective === 'black' ? -mate : mate;
    if (mateVal > 0) {
      return {
        text: `Checkmate in ${Math.abs(mateVal)} move${Math.abs(mateVal) !== 1 ? 's' : ''} for ${perspective === 'black' ? 'Black' : 'White'}`,
        short: `M${Math.abs(mateVal)}`,
        className: 'eval-winning',
      };
    } else {
      const loser = perspective === 'black' ? 'Black' : 'White';
      return {
        text: `${loser} gets checkmated in ${Math.abs(mateVal)} move${Math.abs(mateVal) !== 1 ? 's' : ''}`,
        short: `-M${Math.abs(mateVal)}`,
        className: 'eval-losing',
      };
    }
  }

  if (cp === null || cp === undefined) {
    return { text: 'Evaluating...', short: '...', className: 'eval-unknown' };
  }

  const score = perspective === 'black' ? -cp : cp;
  const pawns = (score / 100).toFixed(1);
  const absPawns = Math.abs(score / 100);
  const prefix = score > 0 ? '+' : '';

  let text, className;

  if (absPawns <= 0.3) {
    text = 'Equal position';
    className = 'eval-equal';
  } else if (absPawns <= 1.0) {
    text = `${score > 0 ? 'White' : 'Black'} has a slight advantage`;
    className = score > 0 ? 'eval-slight-white' : 'eval-slight-black';
  } else if (absPawns <= 2.5) {
    text = `${score > 0 ? 'White' : 'Black'} has a clear advantage`;
    className = score > 0 ? 'eval-clear-white' : 'eval-clear-black';
  } else if (absPawns <= 5.0) {
    text = `${score > 0 ? 'White' : 'Black'} is winning`;
    className = score > 0 ? 'eval-winning-white' : 'eval-winning-black';
  } else {
    text = `${score > 0 ? 'White' : 'Black'} has a decisive advantage`;
    className = score > 0 ? 'eval-decisive-white' : 'eval-decisive-black';
  }

  return { text, short: `${prefix}${pawns}`, className };
}

/**
 * Calculate eval bar percentage (0 = Black winning, 100 = White winning)
 * @param {number|null} cp - Centipawn score (from White's perspective)
 * @param {number|null} mate - Mate in N
 * @returns {number} Percentage 0-100
 */
export function evalToBarPercent(cp, mate) {
  if (mate !== null && mate !== undefined) {
    return mate > 0 ? 98 : 2;
  }
  if (cp === null || cp === undefined) return 50;
  const pawns = cp / 100;
  const percent = 50 + 50 * (2 / (1 + Math.exp(-0.4 * pawns)) - 1);
  return Math.max(2, Math.min(98, percent));
}

/**
 * Parse a UCI info line into structured data
 * @param {string} line - UCI info line
 * @returns {object|null}
 */
function parseInfoLine(line) {
  if (!line.startsWith('info ')) return null;

  const info = {};
  const tokens = line.split(' ');
  let i = 1;

  while (i < tokens.length) {
    switch (tokens[i]) {
      case 'depth':
        info.depth = parseInt(tokens[++i]);
        break;
      case 'seldepth':
        info.seldepth = parseInt(tokens[++i]);
        break;
      case 'multipv':
        info.multipv = parseInt(tokens[++i]);
        break;
      case 'score':
        i++;
        if (tokens[i] === 'cp') {
          info.cp = parseInt(tokens[++i]);
          info.mate = null;
        } else if (tokens[i] === 'mate') {
          info.mate = parseInt(tokens[++i]);
          info.cp = null;
        }
        if (i + 1 < tokens.length && (tokens[i + 1] === 'upperbound' || tokens[i + 1] === 'lowerbound')) {
          info.bound = tokens[++i];
        }
        break;
      case 'nodes':
        info.nodes = parseInt(tokens[++i]);
        break;
      case 'nps':
        info.nps = parseInt(tokens[++i]);
        break;
      case 'time':
        info.time = parseInt(tokens[++i]);
        break;
      case 'pv':
        info.pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
      case 'hashfull':
        info.hashfull = parseInt(tokens[++i]);
        break;
      case 'tbhits':
        info.tbhits = parseInt(tokens[++i]);
        break;
      case 'string':
        info.string = tokens.slice(i + 1).join(' ');
        i = tokens.length;
        break;
      default:
        break;
    }
    i++;
  }

  return info;
}

/**
 * Parse a bestmove line
 * @param {string} line
 * @returns {{ bestMove: string, ponder: string|null }|null}
 */
function parseBestMove(line) {
  if (!line.startsWith('bestmove ')) return null;
  const tokens = line.split(' ');
  return {
    bestMove: tokens[1],
    ponder: tokens[3] || null,
  };
}

/**
 * Handle messages from the Stockfish worker
 * @param {MessageEvent} event
 */
function handleEngineMessage(event) {
  const line = typeof event.data === 'string' ? event.data : event.data?.data;
  if (!line || typeof line !== 'string') return;

  if (line === 'readyok') {
    isReady = true;
    if (onReady) onReady();
    return;
  }

  if (line === 'uciok') {
    sendCommand(`setoption name MultiPV value ${analysisState.multiPV}`);
    sendCommand(`setoption name Hash value ${analysisState.hashMB}`);
    sendCommand('isready');
    return;
  }

  const info = parseInfoLine(line);
  if (info && info.depth && info.pv) {
    const isBlackToMove = analysisState.currentFen && analysisState.currentFen.split(' ')[1] === 'b';
    if (isBlackToMove) {
      if (info.cp !== null && info.cp !== undefined) info.cp = -info.cp;
      if (info.mate !== null && info.mate !== undefined) info.mate = -info.mate;
    }

    const pvIndex = (info.multipv || 1) - 1;

    while (analysisState.results.lines.length <= pvIndex) {
      analysisState.results.lines.push(null);
    }

    analysisState.results.lines[pvIndex] = {
      depth: info.depth,
      seldepth: info.seldepth,
      cp: info.cp,
      mate: info.mate,
      pv: info.pv,
      bound: info.bound || null,
    };

    if (pvIndex === 0) {
      analysisState.results.depth = info.depth;
      analysisState.results.evaluation = { cp: info.cp, mate: info.mate };
    }
    if (info.nodes) analysisState.results.nodes = info.nodes;
    if (info.nps) analysisState.results.nps = info.nps;
    if (info.time) analysisState.results.time = info.time;

    if (onAnalysisUpdate) {
      scheduleAnalysisUpdate();
    }
  }

  const bestMove = parseBestMove(line);
  if (bestMove) {
    isAnalyzing = false;
    updatePending = false;
    analysisState.results.bestMove = bestMove.bestMove;
    analysisState.results.ponder = bestMove.ponder;

    if (onAnalysisUpdate) {
      onAnalysisUpdate({ type: 'bestmove', ...analysisState.results });
    }
  }
}

/**
 * Send a UCI command to the engine
 * @param {string} command
 */
function sendCommand(command) {
  if (engine) {
    engine.postMessage(command);
  }
}

/**
 * Initialize the Stockfish engine in a dedicated Web Worker
 * Supports both WebAssembly (stockfish.wasm.js) and asm.js fallback (stockfish.js).
 * Runs 100% reliably in background thread on mobile & desktop without SharedArrayBuffer.
 * @param {object} options
 * @param {Function} options.onReady - Called when engine is ready
 * @param {Function} options.onAnalysisUpdate - Called with analysis results
 * @param {Function} [options.onError] - Called on engine errors
 * @param {number} [options.threads] - Number of threads
 * @param {number} [options.hashMB] - Hash table size in MB
 * @returns {Promise<void>}
 */
export async function initEngine(options = {}) {
  if (engine) {
    try { engine.terminate(); } catch(e) {}
    engine = null;
  }

  isReady = false;
  isAnalyzing = false;
  onAnalysisUpdate = options.onAnalysisUpdate || null;
  onError = options.onError || null;

  if (options.threads) analysisState.threads = options.threads;
  if (options.hashMB) analysisState.hashMB = options.hashMB;

  return new Promise((resolve, reject) => {
    let settled = false;

    function cleanupWorker() {
      if (engine) {
        try { engine.terminate(); } catch (e) {}
        engine = null;
      }
    }

    // Construct full URLs so worker scripts resolve consistently regardless of routing
    const baseUrl = typeof window !== 'undefined' && window.location ? window.location.href : '';
    const wasmScriptUrl = new URL('./lib/stockfish/stockfish.wasm.js', baseUrl).href;
    const asmScriptUrl = new URL('./lib/stockfish/stockfish.js', baseUrl).href;

    function tryWorker(scriptUrl, isFallback = false) {
      try {
        console.log(`[Engine] Initializing Stockfish worker from: ${scriptUrl}`);
        engine = new Worker(scriptUrl);

        const timeoutMs = isFallback ? 45000 : 25000;
        const timeout = setTimeout(() => {
          if (!isReady && !settled) {
            console.warn(`[Engine] Worker ${scriptUrl} startup timed out (${timeoutMs / 1000}s)`);
            if (!isFallback) {
              console.log('[Engine] Falling back to asm.js engine...');
              cleanupWorker();
              tryWorker(asmScriptUrl, true);
            } else {
              settled = true;
              const err = new Error('Stockfish engine startup timed out');
              if (onError) onError(err);
              reject(err);
            }
          }
        }, timeoutMs);

        engine.onmessage = (event) => {
          handleEngineMessage(event);
        };

        engine.onerror = (evt) => {
          const errMsg = evt?.message || evt?.error?.message || (typeof evt === 'string' ? evt : 'Web Worker failed to load');
          console.error(`[Engine] Worker error from ${scriptUrl}:`, errMsg, evt);
          if (!isFallback && !isReady && !settled) {
            clearTimeout(timeout);
            cleanupWorker();
            console.log('[Engine] Falling back to asm.js engine after worker error...');
            tryWorker(asmScriptUrl, true);
          } else if (!settled) {
            clearTimeout(timeout);
            settled = true;
            const err = new Error(errMsg);
            if (onError) onError(err);
            reject(err);
          }
        };

        onReady = () => {
          clearTimeout(timeout);
          if (!settled) {
            settled = true;
            isReady = true;
            resolve();
            if (options.onReady) options.onReady();
          }
        };

        // Kick off the UCI handshake
        sendCommand('uci');
      } catch (err) {
        const errMsg = err?.message || (typeof err === 'string' ? err : 'Exception creating worker');
        console.error(`[Engine] Exception creating worker for ${scriptUrl}:`, err);
        if (!isFallback && !settled) {
          tryWorker(asmScriptUrl, true);
        } else if (!settled) {
          settled = true;
          const errorObj = new Error(errMsg);
          if (onError) onError(errorObj);
          reject(errorObj);
        }
      }
    }

    // Detect WebAssembly support
    const wasmSupported = typeof WebAssembly === 'object' && 
      typeof WebAssembly.validate === 'function' && 
      WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));

    const initialScript = wasmSupported ? wasmScriptUrl : asmScriptUrl;
    tryWorker(initialScript, !wasmSupported);
  });
}

/**
 * Start analyzing a position
 * @param {string} fen - FEN string of the position
 * @param {object} [options]
 * @param {number} [options.depth] - Search depth
 * @param {number} [options.multiPV] - Number of principal variations
 * @param {number} [options.moveTime] - Time limit in ms
 */
export function startAnalysis(fen, options = {}) {
  if (!engine || !isReady) {
    console.warn('Engine not ready');
    return;
  }

  if (isAnalyzing) {
    stopAnalysis();
  }

  const depth = options.depth || analysisState.depth;
  const multiPV = options.multiPV || analysisState.multiPV;
  const moveTime = options.moveTime;

  analysisState.currentFen = fen;
  analysisState.depth = depth;
  analysisState.multiPV = multiPV;

  analysisState.results = {
    bestMove: null, ponder: null, evaluation: null,
    lines: [], depth: 0, nodes: 0, nps: 0, time: 0,
  };

  sendCommand(`setoption name MultiPV value ${multiPV}`);
  sendCommand(`position fen ${fen}`);

  isAnalyzing = true;
  if (moveTime) {
    sendCommand(`go movetime ${moveTime}`);
  } else {
    sendCommand(`go depth ${depth}`);
  }
}

/**
 * Stop the current analysis
 */
export function stopAnalysis() {
  updatePending = false;
  if (engine && isAnalyzing) {
    try {
      sendCommand('stop');
    } catch (e) {}
    isAnalyzing = false;
  }
}

/**
 * Set the number of threads
 * @param {number} threads
 */
export function setThreads(threads) {
  // Web workers are single-threaded; keep threads at 1
  analysisState.threads = 1;
}

/**
 * Set the hash table size in MB
 * @param {number} mb
 */
export function setHash(mb) {
  analysisState.hashMB = Math.max(16, Math.min(mb, 4096));
  if (engine && isReady) {
    sendCommand(`setoption name Hash value ${analysisState.hashMB}`);
  }
}

/**
 * Set default analysis depth
 * @param {number} depth
 */
export function setDepth(depth) {
  analysisState.depth = Math.max(1, Math.min(depth, 30));
}

/**
 * Set number of principal variations
 * @param {number} count
 */
export function setMultiPV(count) {
  analysisState.multiPV = Math.max(1, Math.min(count, 5));
  if (engine && isReady) {
    sendCommand(`setoption name MultiPV value ${analysisState.multiPV}`);
  }
}

/**
 * Get the current analysis state
 * @returns {object}
 */
export function getAnalysisState() {
  return { isReady, isAnalyzing, ...analysisState };
}

/**
 * Destroy the engine and clean up
 */
export function destroyEngine() {
  if (engine) {
    stopAnalysis();
    try { engine.terminate(); } catch(e) {}
    engine = null;
    isReady = false;
    isAnalyzing = false;
  }
}

/**
 * Format node count for display (e.g., 1234567 → "1.2M")
 * @param {number} nodes
 * @returns {string}
 */
export function formatNodes(nodes) {
  if (nodes >= 1e9) return (nodes / 1e9).toFixed(1) + 'B';
  if (nodes >= 1e6) return (nodes / 1e6).toFixed(1) + 'M';
  if (nodes >= 1e3) return (nodes / 1e3).toFixed(1) + 'K';
  return String(nodes);
}

/**
 * Format NPS for display
 * @param {number} nps
 * @returns {string}
 */
export function formatNPS(nps) {
  return formatNodes(nps) + '/s';
}

/**
 * Convert UCI move notation to from/to squares
 * @param {string} uciMove - e.g., 'e2e4', 'e7e8q'
 * @returns {{ from: string, to: string, promotion?: string }|null}
 */
export function parseUCIMove(uciMove) {
  if (!uciMove || uciMove.length < 4) return null;
  return {
    from: uciMove.slice(0, 2),
    to: uciMove.slice(2, 4),
    promotion: uciMove.length > 4 ? uciMove[4] : undefined,
  };
}
