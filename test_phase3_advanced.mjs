import puppeteer from 'puppeteer';

async function testPhase3Advanced() {
  console.log('🧪 Testing Phase 3 Features: Openings, PGN/FEN Import & Board Themes...');
  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreHTTPSErrors: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });

  const page = await browser.newPage();
  await page.setBypassServiceWorker(true);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  await page.goto('https://localhost:8443', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.appState && window.appState.engineReady === true, { timeout: 25000 });
  console.log('✅ Stockfish Engine Ready');

  // Test 1: Opening Recognition & Navigation Sync
  console.log('\n--- 1. Testing Opening Recognition & Dynamic Updates ---');
  const initialOpening = await page.evaluate(() => document.getElementById('opening-name').textContent);
  console.log('Initial opening banner:', initialOpening);
  if (initialOpening !== 'Starting Position') {
    throw new Error(`Expected Starting Position, got: ${initialOpening}`);
  }

  // Play e4 via command input
  await page.type('#command-input', 'e4');
  await page.click('#command-submit-btn');
  await new Promise(r => setTimeout(r, 200));

  // Play c5 (Sicilian)
  await page.type('#command-input', 'c5');
  await page.click('#command-submit-btn');
  await new Promise(r => setTimeout(r, 300));

  const sicilianCheck = await page.evaluate(() => document.getElementById('opening-name').textContent);
  console.log('After 1. e4 c5:', sicilianCheck);
  if (!sicilianCheck.includes('B20') || !sicilianCheck.includes('Sicilian Defense')) {
    throw new Error(`Expected Sicilian Defense, got: ${sicilianCheck}`);
  }

  // Play Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 (Najdorf)
  const najdorfMoves = ['Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'];
  for (const m of najdorfMoves) {
    await page.type('#command-input', m);
    await page.click('#command-submit-btn');
    await new Promise(r => setTimeout(r, 150));
  }

  const najdorfCheck = await page.evaluate(() => document.getElementById('opening-name').textContent);
  console.log('After Najdorf sequence:', najdorfCheck);
  if (!najdorfCheck.includes('Najdorf Variation')) {
    throw new Error(`Expected Najdorf Variation, got: ${najdorfCheck}`);
  }

  // Test Step Navigation backward (Rewind to move 1)
  await page.click('#nav-first-btn'); // Jump to starting position
  await new Promise(r => setTimeout(r, 200));
  const rewoundToStart = await page.evaluate(() => document.getElementById('opening-name').textContent);
  console.log('Rewound to start:', rewoundToStart);
  if (rewoundToStart !== 'Starting Position') {
    throw new Error(`Expected Starting Position after rewinding, got: ${rewoundToStart}`);
  }

  // Return to live
  await page.click('#nav-live-badge');
  await new Promise(r => setTimeout(r, 200));
  const liveOpening = await page.evaluate(() => document.getElementById('opening-name').textContent);
  if (!liveOpening.includes('Najdorf Variation')) {
    throw new Error(`Expected Najdorf on returning to live, got: ${liveOpening}`);
  }
  console.log('✅ TEST 1 PASSED: Opening detection and step navigation sync work seamlessly!');

  // Test 2: PGN Import & Game Loading
  console.log('\n--- 2. Testing PGN Import Modal & Move Loading ---');
  // Open import modal
  await page.click('#import-btn');
  await new Promise(r => setTimeout(r, 200));

  const modalVisible = await page.evaluate(() => !document.getElementById('import-modal').classList.contains('hidden'));
  if (!modalVisible) throw new Error('Import modal failed to open');

  const samplePgn = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+';
  await page.evaluate((pgn) => {
    document.getElementById('import-input').value = pgn;
  }, samplePgn);

  await page.click('#import-submit-btn');
  await new Promise(r => setTimeout(r, 500));

  const pgnImportCheck = await page.evaluate(() => {
    const modalClosed = document.getElementById('import-modal').classList.contains('hidden');
    const moveCount = window.appState.historyMoves.length;
    const opening = document.getElementById('opening-name').textContent;
    const moveCells = Array.from(document.querySelectorAll('.history-move-cell')).map(el => el.textContent.trim());
    return {
      modalClosed,
      moveCount,
      opening,
      hasBb4Check: moveCells.includes('Bb4+')
    };
  });
  console.log('PGN Import result:', pgnImportCheck);
  if (!pgnImportCheck.modalClosed || pgnImportCheck.moveCount !== 12 || !pgnImportCheck.hasBb4Check) {
    throw new Error('PGN import failed to parse and load moves properly');
  }
  if (!pgnImportCheck.opening.includes('Giuoco Piano') && !pgnImportCheck.opening.includes('Italian Game')) {
    throw new Error(`Expected Italian/Giuoco opening, got: ${pgnImportCheck.opening}`);
  }
  console.log('✅ TEST 2 PASSED: PGN game successfully parsed, loaded, and opened into analysis!');

  // Test 3: FEN Import
  console.log('\n--- 3. Testing FEN Import & Custom Position Setup ---');
  await page.click('#import-btn');
  await new Promise(r => setTimeout(r, 200));

  const puzzleFen = 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5';
  await page.evaluate((fen) => {
    document.getElementById('import-input').value = fen;
  }, puzzleFen);

  await page.click('#import-submit-btn');
  await new Promise(r => setTimeout(r, 500));

  const fenImportCheck = await page.evaluate(() => {
    const currentFen = window.appState.chess.fen();
    const historyCount = window.appState.historyMoves.length;
    return { currentFen, historyCount };
  });
  console.log('FEN Import result:', fenImportCheck);
  if (!fenImportCheck.currentFen.startsWith('r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/5N2/PPPP1PPP/RNBQK2R')) {
    throw new Error('FEN import failed to load correct piece placement on board');
  }
  if (fenImportCheck.historyCount !== 0) {
    throw new Error('FEN import should reset prior move history');
  }
  console.log('✅ TEST 3 PASSED: FEN position loaded accurately into live analysis!');

  // Test 4: Board Theme Customization & LocalStorage
  console.log('\n--- 4. Testing Board Theme Switching & Persistence ---');
  // Open settings
  await page.click('#settings-btn');
  await new Promise(r => setTimeout(r, 300));

  // Change board theme to green (Chess.com style)
  await page.select('#board-theme-select', 'green');
  await new Promise(r => setTimeout(r, 200));

  const themeCheck = await page.evaluate(() => {
    const hasGreenClass = document.body.classList.contains('board-theme-green');
    const saved = JSON.parse(localStorage.getItem('chessmind-settings') || '{}');
    return {
      hasGreenClass,
      savedTheme: saved.boardTheme
    };
  });
  console.log('Board theme check (Green):', themeCheck);
  if (!themeCheck.hasGreenClass || themeCheck.savedTheme !== 'green') {
    throw new Error('Board theme failed to update class or save in localStorage');
  }

  // Switch to wood
  await page.select('#board-theme-select', 'wood');
  await new Promise(r => setTimeout(r, 200));

  const woodCheck = await page.evaluate(() => {
    const hasWoodClass = document.body.classList.contains('board-theme-wood');
    const saved = JSON.parse(localStorage.getItem('chessmind-settings') || '{}');
    return {
      hasWoodClass,
      savedTheme: saved.boardTheme
    };
  });
  console.log('Board theme check (Wood):', woodCheck);
  if (!woodCheck.hasWoodClass || woodCheck.savedTheme !== 'wood') {
    throw new Error('Board theme wood failed to apply or save');
  }

  // Close settings
  await page.click('#close-settings');
  await new Promise(r => setTimeout(r, 200));
  console.log('✅ TEST 4 PASSED: Board themes switch instantly and persist to localStorage!');

  await browser.close();
  console.log('\n🎉 ALL 4 PHASE 3 ADVANCED FEATURE TESTS PASSED 100%!');
}

testPhase3Advanced().catch(err => {
  console.error('❌ PHASE 3 ADVANCED TEST FAILED:', err);
  process.exit(1);
});
