// ChessMind Openings Database - Offline ECO & Opening Name Detection

const OPENINGS = [
  // A00 - A99: Flank Openings & Irregular
  { moves: 'b3', eco: 'A01', name: 'Nimzo-Larsen Attack' },
  { moves: 'f4', eco: 'A02', name: "Bird's Opening" },
  { moves: 'f4 d5', eco: 'A03', name: "Bird's Opening: Dutch Variation" },
  { moves: 'Nf3', eco: 'A04', name: 'Réti Opening' },
  { moves: 'Nf3 d5', eco: 'A06', name: 'Réti Opening: King\'s Indian Attack' },
  { moves: 'Nf3 Nf6 g3', eco: 'A07', name: 'King\'s Indian Attack' },
  { moves: 'c4', eco: 'A10', name: 'English Opening' },
  { moves: 'c4 e5', eco: 'A20', name: 'English Opening: King\'s English Variation' },
  { moves: 'c4 e5 Nc3 Nf6 Nf3 Nc6', eco: 'A29', name: 'English Opening: Four Knights' },
  { moves: 'c4 c5', eco: 'A30', name: 'English Opening: Symmetrical Variation' },
  { moves: 'c4 Nf6', eco: 'A15', name: 'English Opening: Anglo-Indian Defense' },
  { moves: 'd4 f5', eco: 'A80', name: 'Dutch Defense' },
  { moves: 'd4 f5 g3 Nf6 Bg2 e6 Nf3 d5', eco: 'A90', name: 'Dutch Defense: Stonewall Variation' },
  { moves: 'd4 f5 g3 Nf6 Bg2 g6', eco: 'A87', name: 'Dutch Defense: Leningrad Variation' },
  { moves: 'd4 Nf6 c4 c5', eco: 'A56', name: 'Benoni Defense' },
  { moves: 'd4 Nf6 c4 c5 d5 b5', eco: 'A57', name: 'Benko Gambit' },
  { moves: 'd4 Nf6 c4 e5', eco: 'A51', name: 'Budapest Gambit' },
  { moves: 'd4 Nf6 Bg5', eco: 'A45', name: 'Trompowsky Attack' },
  { moves: 'd4 Nf6 Nf3 e6 Bf4', eco: 'A46', name: 'London System' },
  { moves: 'd4 Nf6 Nf3 g6 Bf4', eco: 'A48', name: 'London System' },
  { moves: 'd4 Nf6 Nf3 e6 Bg5', eco: 'A46', name: 'Torre Attack' },

  // B00 - B99: Semi-Open Games (excluding French)
  { moves: 'e4 Nc6', eco: 'B00', name: 'Nimzowitsch Defense' },
  { moves: 'e4 b6', eco: 'B00', name: 'Owen\'s Defense' },
  { moves: 'e4 d5', eco: 'B01', name: 'Scandinavian Defense' },
  { moves: 'e4 d5 exd5 Qxd5', eco: 'B01', name: 'Scandinavian Defense: Mieses-Kotroc' },
  { moves: 'e4 d5 exd5 Nf6', eco: 'B01', name: 'Scandinavian Defense: Modern Variation' },
  { moves: 'e4 Nf6', eco: 'B02', name: 'Alekhine\'s Defense' },
  { moves: 'e4 Nf6 e5 Nd5 d4 d6', eco: 'B03', name: 'Alekhine\'s Defense: Modern Variation' },
  { moves: 'e4 g6', eco: 'B06', name: 'Modern Defense' },
  { moves: 'e4 d6', eco: 'B07', name: 'Pirc Defense' },
  { moves: 'e4 d6 d4 Nf6 Nc3 g6', eco: 'B07', name: 'Pirc Defense: Standard' },
  { moves: 'e4 d6 d4 Nf6 Nc3 g6 f4', eco: 'B09', name: 'Pirc Defense: Austrian Attack' },
  { moves: 'e4 c6', eco: 'B10', name: 'Caro-Kann Defense' },
  { moves: 'e4 c6 d4 d5', eco: 'B12', name: 'Caro-Kann Defense: Main Line' },
  { moves: 'e4 c6 d4 d5 e5', eco: 'B12', name: 'Caro-Kann Defense: Advance Variation' },
  { moves: 'e4 c6 d4 d5 exd5 cxd5', eco: 'B13', name: 'Caro-Kann Defense: Exchange Variation' },
  { moves: 'e4 c6 d4 d5 exd5 cxd5 c4', eco: 'B14', name: 'Caro-Kann Defense: Panov-Botvinnik Attack' },
  { moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5', eco: 'B18', name: 'Caro-Kann Defense: Classical Variation' },
  { moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nd7', eco: 'B17', name: 'Caro-Kann Defense: Steinitz Variation' },
  { moves: 'e4 c5', eco: 'B20', name: 'Sicilian Defense' },
  { moves: 'e4 c5 c3', eco: 'B22', name: 'Sicilian Defense: Alapin Variation' },
  { moves: 'e4 c5 Nc3', eco: 'B23', name: 'Sicilian Defense: Closed' },
  { moves: 'e4 c5 d4 cxd4 c3', eco: 'B21', name: 'Sicilian Defense: Smith-Morra Gambit' },
  { moves: 'e4 c5 b4', eco: 'B20', name: 'Sicilian Defense: Wing Gambit' },
  { moves: 'e4 c5 Nf3', eco: 'B27', name: 'Sicilian Defense' },
  { moves: 'e4 c5 Nf3 Nc6', eco: 'B30', name: 'Sicilian Defense: Old Sicilian' },
  { moves: 'e4 c5 Nf3 Nc6 Bb5', eco: 'B30', name: 'Sicilian Defense: Rossolimo Attack' },
  { moves: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4', eco: 'B32', name: 'Sicilian Defense: Open' },
  { moves: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6', eco: 'B34', name: 'Sicilian Defense: Accelerated Dragon' },
  { moves: 'e4 c5 Nf3 d6', eco: 'B50', name: 'Sicilian Defense' },
  { moves: 'e4 c5 Nf3 d6 Bb5+', eco: 'B51', name: 'Sicilian Defense: Moscow Variation' },
  { moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3', eco: 'B54', name: 'Sicilian Defense: Classical' },
  { moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', eco: 'B90', name: 'Sicilian Defense: Najdorf Variation' },
  { moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5', eco: 'B94', name: 'Sicilian Defense: Najdorf, Classical' },
  { moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3', eco: 'B90', name: 'Sicilian Defense: Najdorf, English Attack' },
  { moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', eco: 'B70', name: 'Sicilian Defense: Dragon Variation' },
  { moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3', eco: 'B75', name: 'Sicilian Defense: Dragon, Yugoslav Attack' },
  { moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6', eco: 'B80', name: 'Sicilian Defense: Scheveningen Variation' },
  { moves: 'e4 c5 Nf3 e6', eco: 'B40', name: 'Sicilian Defense: French Variation' },
  { moves: 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6', eco: 'B41', name: 'Sicilian Defense: Kan Variation' },
  { moves: 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6', eco: 'B44', name: 'Sicilian Defense: Taimanov Variation' },

  // C00 - C19: French Defense
  { moves: 'e4 e6', eco: 'C00', name: 'French Defense' },
  { moves: 'e4 e6 d4 d5', eco: 'C01', name: 'French Defense: Normal' },
  { moves: 'e4 e6 d4 d5 e5', eco: 'C02', name: 'French Defense: Advance Variation' },
  { moves: 'e4 e6 d4 d5 exd5 exd5', eco: 'C01', name: 'French Defense: Exchange Variation' },
  { moves: 'e4 e6 d4 d5 Nd2', eco: 'C03', name: 'French Defense: Tarrasch Variation' },
  { moves: 'e4 e6 d4 d5 Nc3', eco: 'C10', name: 'French Defense: Paulsen Variation' },
  { moves: 'e4 e6 d4 d5 Nc3 Bb4', eco: 'C15', name: 'French Defense: Winawer Variation' },
  { moves: 'e4 e6 d4 d5 Nc3 Nf6', eco: 'C11', name: 'French Defense: Classical Variation' },

  // C20 - C99: Open Games (1. e4 e5)
  { moves: 'e4 e5', eco: 'C20', name: 'King\'s Pawn Game' },
  { moves: 'e4 e5 d4 exd4 Qxd4', eco: 'C21', name: 'Center Game' },
  { moves: 'e4 e5 d4 exd4 c3', eco: 'C21', name: 'Danish Gambit' },
  { moves: 'e4 e5 Bc4', eco: 'C23', name: 'Bishop\'s Opening' },
  { moves: 'e4 e5 Nc3', eco: 'C25', name: 'Vienna Game' },
  { moves: 'e4 e5 Nc3 Nf6 Bc4 Bc5', eco: 'C26', name: 'Vienna Game: Modern Variation' },
  { moves: 'e4 e5 f4', eco: 'C30', name: 'King\'s Gambit' },
  { moves: 'e4 e5 f4 exf4', eco: 'C33', name: 'King\'s Gambit Accepted' },
  { moves: 'e4 e5 f4 Bc5', eco: 'C30', name: 'King\'s Gambit Declined' },
  { moves: 'e4 e5 Nf3', eco: 'C40', name: 'King\'s Knight Opening' },
  { moves: 'e4 e5 Nf3 d6', eco: 'C41', name: 'Philidor Defense' },
  { moves: 'e4 e5 Nf3 Nf6', eco: 'C42', name: 'Petroff\'s Defense' },
  { moves: 'e4 e5 Nf3 Nc6', eco: 'C44', name: 'King\'s Knight: Normal' },
  { moves: 'e4 e5 Nf3 Nc6 d4', eco: 'C44', name: 'Scotch Game' },
  { moves: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4', eco: 'C45', name: 'Scotch Game: Mieses Variation' },
  { moves: 'e4 e5 Nf3 Nc6 Nc3', eco: 'C46', name: 'Three Knights Game' },
  { moves: 'e4 e5 Nf3 Nc6 Nc3 Nf6', eco: 'C47', name: 'Four Knights Game' },
  { moves: 'e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5', eco: 'C48', name: 'Four Knights Game: Spanish Variation' },
  { moves: 'e4 e5 Nf3 Nc6 Bc4', eco: 'C50', name: 'Italian Game' },
  { moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6', eco: 'C55', name: 'Two Knights Defense' },
  { moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5', eco: 'C57', name: 'Fried Liver / Knight Attack' },
  { moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5', eco: 'C53', name: 'Giuoco Piano' },
  { moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3', eco: 'C53', name: 'Giuoco Piano: Classical' },
  { moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4', eco: 'C51', name: 'Evans Gambit' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5', eco: 'C60', name: 'Ruy Lopez (Spanish Opening)' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5 a6', eco: 'C68', name: 'Ruy Lopez: Morphy Defense' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6', eco: 'C68', name: 'Ruy Lopez: Exchange Variation' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4', eco: 'C70', name: 'Ruy Lopez: Columbus Variation' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O', eco: 'C80', name: 'Ruy Lopez: Open' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7', eco: 'C84', name: 'Ruy Lopez: Closed' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5 Nf6', eco: 'C65', name: 'Ruy Lopez: Berlin Defense' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5 f5', eco: 'C63', name: 'Ruy Lopez: Schliemann Defense' },

  // D00 - D99: Queen's Pawn Games & Queen's Gambit
  { moves: 'd4 d5', eco: 'D00', name: 'Queen\'s Pawn Game' },
  { moves: 'd4 d5 Bf4', eco: 'D00', name: 'London System' },
  { moves: 'd4 d5 Nf3 Nf6 Bf4', eco: 'D02', name: 'London System' },
  { moves: 'd4 d5 Nf3 Nf6 e3', eco: 'D05', name: 'Colle System' },
  { moves: 'd4 d5 c4', eco: 'D06', name: 'Queen\'s Gambit' },
  { moves: 'd4 d5 c4 dxc4', eco: 'D20', name: 'Queen\'s Gambit Accepted' },
  { moves: 'd4 d5 c4 e6', eco: 'D30', name: 'Queen\'s Gambit Declined' },
  { moves: 'd4 d5 c4 e6 Nc3 Nf6', eco: 'D35', name: 'Queen\'s Gambit Declined: Traditional' },
  { moves: 'd4 d5 c4 e6 Nc3 Nf6 Bg5', eco: 'D53', name: 'Queen\'s Gambit Declined: Tartakower' },
  { moves: 'd4 d5 c4 e6 Nc3 Nf6 cxd5 exd5', eco: 'D35', name: 'Queen\'s Gambit Declined: Exchange' },
  { moves: 'd4 d5 c4 c6', eco: 'D10', name: 'Slav Defense' },
  { moves: 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4', eco: 'D15', name: 'Slav Defense: Accepted' },
  { moves: 'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6', eco: 'D43', name: 'Semi-Slav Defense' },
  { moves: 'd4 d5 c4 Nc6', eco: 'D07', name: 'Chigorin Defense' },
  { moves: 'd4 d5 c4 e5', eco: 'D08', name: 'Albin Counter-Gambit' },
  { moves: 'd4 Nf6 c4 g6 Nc3 d5', eco: 'D80', name: 'Grünfeld Defense' },
  { moves: 'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4', eco: 'D85', name: 'Grünfeld Defense: Exchange' },

  // E00 - E99: Indian Defenses
  { moves: 'd4 Nf6', eco: 'E00', name: 'Indian Defense' },
  { moves: 'd4 Nf6 c4 e6 g3', eco: 'E01', name: 'Catalan Opening' },
  { moves: 'd4 Nf6 c4 e6 Nc3 Bb4', eco: 'E20', name: 'Nimzo-Indian Defense' },
  { moves: 'd4 Nf6 c4 e6 Nc3 Bb4 e3', eco: 'E40', name: 'Nimzo-Indian Defense: Rubinstein' },
  { moves: 'd4 Nf6 c4 e6 Nc3 Bb4 Qc2', eco: 'E32', name: 'Nimzo-Indian Defense: Classical' },
  { moves: 'd4 Nf6 c4 e6 Nf3 b6', eco: 'E12', name: 'Queen\'s Indian Defense' },
  { moves: 'd4 Nf6 c4 e6 Nf3 Bb4+', eco: 'E11', name: 'Bogo-Indian Defense' },
  { moves: 'd4 Nf6 c4 g6', eco: 'E60', name: 'King\'s Indian Defense' },
  { moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6', eco: 'E70', name: 'King\'s Indian Defense: Classical' },
  { moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5', eco: 'E92', name: 'King\'s Indian Defense: Mar del Plata' },
  { moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3', eco: 'E80', name: 'King\'s Indian Defense: Sämisch Variation' },
  { moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7', eco: 'E97', name: 'King\'s Indian Defense: Orthodox' }
];

// Helper: Normalize SAN sequence
function normalizeMoves(moveList) {
  if (!moveList || moveList.length === 0) return '';
  if (typeof moveList === 'string') {
    return moveList.trim().replace(/\s+/g, ' ');
  }
  return moveList.map(m => (typeof m === 'string' ? m : m.san)).filter(Boolean).join(' ');
}

/**
 * Identify opening by SAN move sequence
 * Returns { eco: string, name: string, full: string } or null
 */
export function identifyOpening(moves) {
  const moveStr = normalizeMoves(moves);
  if (!moveStr) return null;

  let bestMatch = null;
  let maxMatchLength = 0;

  for (const entry of OPENINGS) {
    if (moveStr === entry.moves || moveStr.startsWith(entry.moves + ' ')) {
      const matchLen = entry.moves.split(' ').length;
      if (matchLen > maxMatchLength) {
        maxMatchLength = matchLen;
        bestMatch = entry;
      }
    }
  }

  if (bestMatch) {
    return {
      eco: bestMatch.eco,
      name: bestMatch.name,
      full: `${bestMatch.eco} ${bestMatch.name}`
    };
  }

  return null;
}

if (typeof window !== 'undefined') {
  window.identifyOpening = identifyOpening;
  window.OPENINGS_DATABASE = OPENINGS;
}
