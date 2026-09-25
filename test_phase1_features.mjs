import puppeteer from 'puppeteer';

async function testPhase1Features() {
  console.log('🧪 Testing Phase 1 Features: Sound, Captured Pieces, Move History & Contextual UI...');
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

  // Test 1: Sound Effects Toggle
  console.log('\n--- 1. Testing Sound Effects Toggle & UI Sync ---');
  const initialSound = await page.evaluate(() => window.appState.settings.soundEnabled);
  console.log('Initial sound enabled:', initialSound);
  if (!initialSound) throw new Error('Sound should be enabled by default');

  // Toggle sound off via header button
  await page.click('#sound-toggle-btn');
  const soundOff = await page.evaluate(() => ({
    enabled: window.appState.settings.soundEnabled,
    btnText: document.getElementById('sound-toggle-btn').textContent
  }));
  console.log('After toggle click:', soundOff);
  if (soundOff.enabled || soundOff.btnText !== '🔇') {
    throw new Error('Sound toggle button failed to mute sound');
  }

  // Toggle back on
  await page.click('#sound-toggle-btn');
  const soundOn = await page.evaluate(() => ({
    enabled: window.appState.settings.soundEnabled,
    btnText: document.getElementById('sound-toggle-btn').textContent
  }));
  if (!soundOn.enabled || soundOn.btnText !== '🔊') {
    throw new Error('Sound toggle button failed to un-mute sound');
  }
  console.log('✅ TEST 1 PASSED: Sound effects toggle and icon sync work!');

  // Test 2: Move Execution & Move History Logging
  console.log('\n--- 2. Testing Move History Logging & PGN ---');
  // Test executing moves using command input
  await page.type('#command-input', 'e4');
  await page.click('#command-submit-btn');
  await new Promise(r => setTimeout(r, 200));

  await page.type('#command-input', 'd5');
  await page.click('#command-submit-btn');
  await new Promise(r => setTimeout(r, 200));

  await page.type('#command-input', 'exd5');
  await page.click('#command-submit-btn');
  await new Promise(r => setTimeout(r, 300));

  const historyCheck = await page.evaluate(() => {
    const moves = window.appState.historyMoves;
    const moveCells = Array.from(document.querySelectorAll('.history-move-cell')).map(el => el.textContent.trim());
    const countText = document.getElementById('history-move-count').textContent;
    return {
      historyLength: moves.length,
      sans: moves.map(m => m.san),
      moveCells,
      countText
    };
  });
  console.log('History state after 3 moves:', historyCheck);
  if (historyCheck.historyLength !== 3 || !historyCheck.sans.includes('exd5')) {
    throw new Error('Move history failed to record played moves properly');
  }
  console.log('✅ TEST 2 PASSED: Move History correctly records and renders SAN moves!');

  // Test 3: Captured Material & Material Advantage Diff
  console.log('\n--- 3. Testing Captured Material & Advantage Calculation ---');
  const materialCheck = await page.evaluate(() => {
    const bottomCaptured = document.getElementById('bottom-captured-pieces').innerHTML;
    const bottomDiff = document.getElementById('bottom-material-diff').textContent;
    const isDiffVisible = !document.getElementById('bottom-material-diff').classList.contains('hidden');
    return {
      bottomCaptured,
      bottomDiff,
      isDiffVisible
    };
  });
  console.log('Material check after 1. e4 d5 2. exd5:', materialCheck);
  if (!materialCheck.bottomCaptured.includes('♟') || materialCheck.bottomDiff !== '+1' || !materialCheck.isDiffVisible) {
    throw new Error('Captured material did not record captured pawn or +1 advantage');
  }
  console.log('✅ TEST 3 PASSED: Captured pawn and +1 advantage correctly displayed!');

  // Test 4: Interactive History Navigation (Rewind & Live)
  console.log('\n--- 4. Testing Step Navigation (Rewind, Forward & Live View) ---');
  // Click on move 1 (e4)
  await page.evaluate(() => {
    const firstMoveBtn = document.querySelector('.history-move-cell[data-move-idx="0"]');
    if (firstMoveBtn) firstMoveBtn.click();
  });
  await new Promise(r => setTimeout(r, 200));

  const rewindCheck = await page.evaluate(() => {
    const isLiveHidden = document.getElementById('nav-live-badge').classList.contains('hidden');
    const currentIndex = window.appState.currentHistoryIndex;
    const boardFen = window.appState.ground.getFen();
    return {
      isLiveHidden,
      currentIndex,
      boardFen
    };
  });
  console.log('State when rewound to move 0 (e4):', rewindCheck);
  if (rewindCheck.isLiveHidden || rewindCheck.currentIndex !== 0) {
    throw new Error('Rewind navigation failed to set active move or display Live return badge');
  }

  // Click Live return badge
  await page.click('#nav-live-badge');
  await new Promise(r => setTimeout(r, 200));

  const liveCheck = await page.evaluate(() => {
    const isLiveHidden = document.getElementById('nav-live-badge').classList.contains('hidden');
    const currentIndex = window.appState.currentHistoryIndex;
    return {
      isLiveHidden,
      currentIndex
    };
  });
  console.log('State after clicking Return to Live:', liveCheck);
  if (!liveCheck.isLiveHidden || liveCheck.currentIndex !== 2) {
    throw new Error('Return to live failed to jump back to latest move');
  }
  console.log('✅ TEST 4 PASSED: Interactive move navigation and Live Return work smoothly!');

  // Test 5: Contextual UI Switching in Play Modes
  console.log('\n--- 5. Testing Contextual UI Adaptation in Game Modes ---');
  await page.click('button[data-mode="vs-computer"]');
  await new Promise(r => setTimeout(r, 300));

  const vsUIVisibility = await page.evaluate(() => {
    const quickActions = document.querySelector('.quick-actions-bar').style.display;
    const palette = document.querySelector('.piece-palette-deck').style.display;
    const candidateMoves = document.querySelector('.candidate-moves-panel').style.display;
    const historyPanel = document.querySelector('.move-history-panel').style.display;
    const topStrip = document.getElementById('top-player-name').textContent;
    return {
      quickActions,
      palette,
      candidateMoves,
      historyPanel,
      topStrip
    };
  });
  console.log('VS Computer UI visibility:', vsUIVisibility);
  if (vsUIVisibility.quickActions !== 'none' || vsUIVisibility.palette !== 'none' || vsUIVisibility.candidateMoves !== 'none') {
    throw new Error('Contextual UI failed to hide editor tools during vs-computer mode');
  }
  if (!vsUIVisibility.topStrip.includes('Stockfish')) {
    throw new Error('Opponent player card failed to identify as Stockfish');
  }

  // Switch back to analysis
  await page.click('button[data-mode="analysis"]');
  await new Promise(r => setTimeout(r, 300));

  const analysisUIVisibility = await page.evaluate(() => {
    const quickActions = document.querySelector('.quick-actions-bar').style.display;
    const palette = document.querySelector('.piece-palette-deck').style.display;
    const candidateMoves = document.querySelector('.candidate-moves-panel').style.display;
    return {
      quickActions,
      palette,
      candidateMoves
    };
  });
  console.log('Analysis UI visibility restored:', analysisUIVisibility);
  if (analysisUIVisibility.quickActions === 'none' || analysisUIVisibility.palette === 'none') {
    throw new Error('Analysis tools failed to restore when returning to Analysis mode');
  }
  console.log('✅ TEST 5 PASSED: Contextual UI seamlessly adapts between play and analysis modes!');

  await browser.close();
  console.log('\n🎉 ALL PHASE 1 FEATURE TESTS PASSED 100%!');
}

testPhase1Features().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
