/**
 * @file move-parser.js
 * @description Parses natural language chess commands into Standard Algebraic Notation (SAN) and commands for ChessMind.
 */

// Speech correction mappings (regex to replacement)
const CORRECTIONS = [
    // Filler words
    [/\bum\b/g, ''],
    [/\buh\b/g, ''],
    [/\bplease\b/g, ''],
    [/\bby\b/g, ''],

    // Pieces
    [/\bnight\b/g, 'knight'],
    [/\bnights\b/g, 'knight'],
    [/\bnite\b/g, 'knight'],
    [/\bnot\s+to\b/g, 'knight to'],
    [/\broque\b/g, 'rook'],
    [/\brock\b/g, 'rook'],
    [/\broute\b/g, 'rook'],
    [/\bbrook\b/g, 'rook'],
    [/\bdish\s+up\b/g, 'bishop'],
    [/\bthis\s+up\b/g, 'bishop'],
    [/^be\s+(?=[a-h][1-8])/g, 'bishop '],
    [/\bbee\b/g, 'bishop'],
    [/\bclean\b/g, 'queen'],
    [/\bpond\b/g, 'pawn'],
    [/\bporn\b/g, 'pawn'],
    [/\bupon\b/g, 'pawn'],

    // Actions
    [/([a-hkqrbn])x([a-h][1-8])/gi, '$1 takes $2'],
    [/\btax\b/g, 'takes'],
    [/\btext\b/g, 'takes'],
    [/\bcapture\b/g, 'takes'],
    [/\bcaptures\b/g, 'takes'],
    [/\bcastles\b/g, 'castle'],
    [/\bshort\s+castle\b/g, 'castle kingside'],
    [/\blong\s+castle\b/g, 'castle queenside'],
    [/\bczech\b/g, 'check'],
    [/\bcheque\b/g, 'check'],
    [/\bcheckmate\b/g, 'check mate'],
    [/\bpromotion\b/g, 'promote'],

    // Files (a-h)
    [/\bay\b/g, 'a'],
    [/\bhey\b/g, 'a'], // context usually handles itself if it is isolated
    [/\balpha\b/g, 'a'],
    [/\bbravo\b/g, 'b'],
    [/\bcharlie\b/g, 'c'],
    [/\bsee\b/g, 'c'],
    [/\bsea\b/g, 'c'],
    [/\bdelta\b/g, 'd'],
    [/\bdee\b/g, 'd'],
    [/\becho\b/g, 'e'],
    [/\bfoxtrot\b/g, 'f'],
    [/\bef\b/g, 'f'],
    [/\bgolf\b/g, 'g'],
    [/\bgee\b/g, 'g'],
    [/\bhotel\b/g, 'h'],
    [/\baitch\b/g, 'h'],
    [/\bage\b/g, 'h'],

    // Ranks (1-8)
    [/\bwon\b/g, '1'],
    [/\b([a-h])\s+to\b(?!\s+(?:[a-h][1-8]|[a-h]|takes))/g, '$1 2'],
    [/\btoo\b/g, '2'],
    [/\btwo\b/g, '2'],
    [/\btree\b/g, '3'],
    [/\bthree\b/g, '3'],
    [/\b([a-h])\s+for\b(?!\s+(?:[a-h][1-8]|[a-h]|takes))/g, '$1 4'],
    [/\bfour\b/g, '4'],
    [/\bfore\b/g, '4'],
    [/\bfive\b/g, '5'],
    [/\bfife\b/g, '5'],
    [/\bsix\b/g, '6'],
    [/\bsax\b/g, '6'],
    [/\bseven\b/g, '7'],
    [/\bate\b/g, '8'],
    [/\beight\b/g, '8'],
];

const PIECE_MAP = {
    king: 'K',
    queen: 'Q',
    rook: 'R',
    bishop: 'B',
    knight: 'N',
    pawn: ''
};

// Command mappings
const COMMANDS = {
    'analyze': 'analyze',
    'analyse': 'analyze',
    'find best move': 'analyze',
    "what's the best move": 'analyze',
    'clear': 'clear',
    'clear board': 'clear',
    'empty board': 'clear',
    'starting position': 'reset',
    'start position': 'reset',
    'reset': 'reset',
    'new game': 'reset',
    'flip': 'flip',
    'flip board': 'flip',
    'rotate': 'flip',
    'undo': 'undo',
    'take back': 'undo',
    'go back': 'undo',
    'setup mode': 'setup',
    'edit mode': 'setup',
    'editor': 'setup',
    'analysis mode': 'analysis',
    'play mode': 'analysis',
    'stop': 'stop',
    'stop analysis': 'stop',
    'what is the evaluation': 'eval',
    'evaluation': 'eval',
    'eval': 'eval'
};

/**
 * Normalizes and applies speech corrections to raw text.
 * @param {string} text - Raw speech input.
 * @returns {string} - Cleaned text.
 */
function cleanText(text) {
    let cleaned = text.toLowerCase().trim();
    // Apply corrections sequentially
    for (const [regex, replacement] of CORRECTIONS) {
        cleaned = cleaned.replace(regex, replacement);
    }
    // Remove extra spaces
    return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Matches a specific voice command.
 * @param {string} text - Cleaned text.
 * @returns {string|null} - The matched command id, or null.
 */
function matchCommand(text) {
    return COMMANDS[text] || null;
}

/**
 * Parses setup mode commands.
 * @param {string} text - Cleaned text.
 * @returns {Object|null} - Setup object if matched, or null.
 */
function matchSetup(text) {
    // remove <square> or clear <square> or delete <square>
    let m = text.match(/^(?:remove|clear|delete)\s+([a-h][1-8])$/i);
    if (m) {
        return { type: 'remove', action: 'remove', square: m[1].toLowerCase() };
    }

    // place <piece> on/to <square> OR <color> <piece> to/on <square> OR <color> <piece> <square>
    // e.g., 'white knight to e5', 'black queen to f6', 'place white pawn on e4', 'white knight e5'
    const colorPieceRegex = /^(?:place\s+|put\s+)?(white|black)\s+(king|queen|rook|bishop|knight|pawn)(?:\s+(?:to|on))?\s+([a-h][1-8])$/i;
    m = text.match(colorPieceRegex);
    if (m) {
        return {
            type: 'placement',
            action: 'place',
            color: m[1].toLowerCase(),
            role: m[2].toLowerCase(),
            square: m[3].toLowerCase(),
            piece: {
                color: m[1].toLowerCase(),
                role: m[2].toLowerCase()
            }
        };
    }

    return null;
}

/**
 * Matches a chess move from text.
 * @param {string} text - Cleaned text.
 * @returns {Object|null} - Move info or null.
 */
function matchMove(text) {
    const piece = `(king|queen|rook|bishop|knight|pawn)`;
    const sq = `([a-h][1-8])`;
    const file = `([a-h])`;
    const ending = `(?:\\s+(check|check\\s+mate|checkmate|mate))?`;

    // 1. Castling
    if (text.includes('castle kingside') || text.includes('short castle') || text === 'o-o') {
        return { san: 'O-O' };
    }
    if (text.includes('castle queenside') || text.includes('long castle') || text === 'o-o-o') {
        return { san: 'O-O-O' };
    }

    // Prepare text for regex matching by handling 'to' optionally
    const t = text.replace(/\bto\b/g, ' ').replace(/\s+/g, ' ').trim();

    // 2. Square to square: "c2 to c5" -> "c2 c5", "e2 e4", "from c2 to c5"
    let m = t.match(new RegExp(`^(?:from\\s+)?${sq}\\s+${sq}${ending}$`));
    if (m) {
        return { from: m[1], to: m[2], san: null };
    }

    // 3. Piece takes square: bishop takes f7
    m = t.match(new RegExp(`^${piece}\\s+takes\\s+${sq}${ending}$`));
    if (m) {
        let p = PIECE_MAP[m[1]];
        let s = m[2];
        let e = getEnding(m[3]);
        return { san: `${p || ''}x${s}${e}`, role: m[1], to: s };
    }

    // 4. File takes square: e takes d5
    m = t.match(new RegExp(`^${file}\\s+takes\\s+${sq}${ending}$`));
    if (m) {
        let f = m[1];
        let s = m[2];
        let e = getEnding(m[3]);
        return { san: `${f}x${s}${e}`, fromFile: f, to: s };
    }

    // 5. Piece from_sq to sq: rook a1 a8 (with 'to' removed)
    m = t.match(new RegExp(`^${piece}\\s+${sq}\\s+${sq}${ending}$`));
    if (m) {
        let p = PIECE_MAP[m[1]];
        let from = m[2];
        let to = m[3];
        let e = getEnding(m[4]);
        return { san: `${p || ''}${from}${to}${e}`, from, to, role: m[1] };
    }

    // 6. Piece to sq: knight f3, knight to e5, queen to f6
    m = t.match(new RegExp(`^${piece}\\s+${sq}${ending}$`));
    if (m) {
        let p = PIECE_MAP[m[1]];
        let s = m[2];
        let e = getEnding(m[3]);
        return { san: `${p || ''}${s}${e}`, role: m[1], to: s };
    }

    // 7. Pawn promote to piece: e8 promote queen, a8 queen
    m = t.match(new RegExp(`^${sq}\\s+(?:promote\\s+)?${piece}${ending}$`));
    if (m) {
        let s = m[1];
        let p = PIECE_MAP[m[2]];
        let e = getEnding(m[3]);
        if (p) {
            return { san: `${s}=${p}${e}`, promotion: p.toLowerCase(), to: s };
        }
    }
    
    // 8. File takes square promote: e takes d8 promote queen
    m = t.match(new RegExp(`^${file}\\s+takes\\s+${sq}\\s+(?:promote\\s+)?${piece}${ending}$`));
    if (m) {
        let f = m[1];
        let s = m[2];
        let p = PIECE_MAP[m[3]];
        let e = getEnding(m[4]);
        if (p) {
            return { san: `${f}x${s}=${p}${e}`, fromFile: f, to: s, promotion: p.toLowerCase() };
        }
    }

    // 8b. File to square (pawn move): "c to c5" -> "c c5", "e to e4" -> "e e4", "e to d5" -> "e d5"
    m = t.match(new RegExp(`^(?:pawn\\s+)?([a-h])\\s+([a-h][1-8])${ending}$`));
    if (m) {
        let f = m[1];
        let s = m[2];
        let e = getEnding(m[3]);
        if (s.startsWith(f)) {
            return { san: `${s}${e}`, to: s, role: 'pawn' };
        } else {
            return { san: `${f}x${s}${e}`, fromFile: f, to: s, role: 'pawn' };
        }
    }

    // 9. Just square (pawn move): e4, e 4, pawn to e4
    m = t.match(new RegExp(`^(?:pawn\\s+)?([a-h])\\s*([1-8])${ending}$`));
    if (m) {
        let s = m[1] + m[2];
        let e = getEnding(m[3]);
        return { san: `${s}${e}`, to: s, role: 'pawn' };
    }

    return null;
}

function getEnding(match) {
    if (!match) return '';
    if (match.includes('mate')) return '#';
    if (match.includes('check')) return '+';
    return '';
}

/**
 * Main parser function. Parses raw text into commands or SAN moves.
 * @param {string} text - Raw speech recognition text.
 * @returns {Object} - Parsed result object.
 */
export function parseSpokenMove(text) {
    const raw = text;
    const cleaned = cleanText(text);
    
    // 1. Try Command
    const command = matchCommand(cleaned);
    if (command) {
        return { type: 'command', command, raw, confidence: 1 };
    }

    // 2. Try Setup Mode
    const setup = matchSetup(cleaned);
    if (setup) {
        return { ...setup, raw, confidence: 1 };
    }

    // 3. Try Move
    const move = matchMove(cleaned);
    if (move) {
        return { type: 'move', ...move, raw, confidence: 1 };
    }

    // Unknown - ignore invalid formats cleanly
    return { type: 'unknown', raw, confidence: 0 };
}

/**
 * Converts SAN back to spoken English for TTS.
 * @param {string} san - Standard Algebraic Notation.
 * @param {string} piece - Piece character (e.g. 'N', 'K', 'p').
 * @param {string} from - Starting square (e.g. 'g1').
 * @param {string} to - Destination square (e.g. 'f3').
 * @param {string} flags - Move flags (e.g. 'c' for capture, 'p' for promotion).
 * @returns {string} - Natural language string.
 */
export function formatMoveForSpeech(san, piece, from, to, flags) {
    if (san === 'O-O') return 'Castle kingside';
    if (san === 'O-O-O') return 'Castle queenside';

    const pieceNames = {
        'p': 'Pawn',
        'n': 'Knight',
        'b': 'Bishop',
        'r': 'Rook',
        'q': 'Queen',
        'k': 'King'
    };

    let pName = pieceNames[piece.toLowerCase()] || 'Piece';
    let action = (flags && flags.includes('c')) ? 'takes' : 'to';
    
    let speech = `${pName} ${action} ${to}`;

    // Handle Pawn takes specifically to say the file
    if (piece.toLowerCase() === 'p' && action === 'takes') {
        speech = `${from[0]} takes ${to}`;
    }

    if (san.includes('=')) {
        const promoPiece = san.split('=')[1][0];
        const promoName = pieceNames[promoPiece.toLowerCase()];
        speech += `, promotes to ${promoName}`;
    }

    if (san.endsWith('#')) {
        speech += ', checkmate';
    } else if (san.endsWith('+')) {
        speech += ', check';
    }

    return speech;
}
