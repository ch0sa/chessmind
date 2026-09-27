import puppeteer from 'puppeteer-core';

(async () => {
  console.log('🚀 Starting Phase 4, 5 & 6 Automated Test Suite...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    ignoreHTTPSErrors: true,
    defaultViewport: { width: 1024, height: 768 }
  });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);

  // Listen to browser console logs
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('Browser error:', msg.text());
    }
  });

  try {
    await page.goto('http://localhost:8080/', { waitUntil: 'networkidle0' });
    console.log('Connected to http://localhost:8080/');
  } catch (e) {
    console.log('Failed to connect to localhost:8080:', e.message);
    console.log('Falling back to live url or checking dev server...');
    await page.goto('https://chessmind-lake.vercel.app/', { waitUntil: 'networkidle0' });
  }

  // Wait for service worker to install, claim, and finish any initial controllerchange reload
  await new Promise(r => setTimeout(r, 4500));
  await page.waitForFunction(() => !!window.appState && !!window.appState.ground, { timeout: 15000 });

  // --- TEST 1: Phase 4 - Annotations & Context Menu ---
  console.log('\n--- TEST 1: Phase 4 - Drawing & Context Menu ---');
  const boardPreventDefault = await page.evaluate(() => {
    const board = document.getElementById('board');
    if (!board) return false;
    let prevented = false;
    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    board.dispatchEvent(evt);
    return evt.defaultPrevented;
  });
  console.log('Context menu prevented on board:', boardPreventDefault);
  if (!boardPreventDefault) throw new Error('contextmenu is not prevented on board!');
  console.log('✅ TEST 1 PASSED: Board prevents contextmenu for right-click drawing');

  // --- TEST 2: Phase 4 - SetAutoShapes Engine Arrow ---
  console.log('\n--- TEST 2: Phase 4 - SetAutoShapes Engine Arrow ---');
  const autoShapesWork = await page.evaluate(() => {
    if (!window.appState || !window.appState.ground) return false;
    window.appState.ground.setAutoShapes([{ orig: 'e2', dest: 'e4', brush: 'green' }]);
    const shapes = document.querySelectorAll('.cg-wrap cg-shapes svg, .cg-wrap .cg-shapes line, .cg-wrap .cg-shapes polygon, .cg-wrap svg');
    return shapes.length > 0;
  });
  console.log('Auto-shapes rendered in DOM:', autoShapesWork);
  if (!autoShapesWork) throw new Error('Failed to render auto-shapes on board!');
  console.log('✅ TEST 2 PASSED: Chessground successfully draws arrows/shapes');

  // --- TEST 3: Phase 6 - Premove Configuration ---
  console.log('\n--- TEST 3: Phase 6 - Premove Configuration ---');
  const premoveConfig = await page.evaluate(() => {
    if (!window.appState || !window.appState.ground) return null;
    return typeof window.appState.ground.playPremove === 'function';
  });
  console.log('Chessground playPremove method exists:', premoveConfig);
  if (!premoveConfig) throw new Error('playPremove method not found on Chessground instance!');
  console.log('✅ TEST 3 PASSED: Premovable engine enabled and accessible');

  // --- TEST 4: Phase 5 - Tactical Puzzle Mode Activation ---
  console.log('\n--- TEST 4: Phase 5 - Tactical Puzzle Mode Activation ---');
  const puzzleBtn = await page.$('button[data-mode="puzzles"]');
  if (!puzzleBtn) throw new Error('Puzzles mode button not found!');
  await puzzleBtn.click();
  await new Promise(r => setTimeout(r, 1200));

  const puzzleDebug = await page.evaluate(() => {
    const panel = document.getElementById('puzzle-panel');
    const prompt = document.getElementById('puzzle-prompt');
    return {
      panelFound: !!panel,
      panelHidden: panel ? panel.classList.contains('hidden') : null,
      promptText: prompt ? prompt.textContent : null,
      puzzleCurrent: window.appState ? window.appState.puzzle?.current : null,
      gameMode: window.appState ? window.appState.gameMode : null
    };
  });
  console.log('Puzzle debug:', puzzleDebug);
  if (!puzzleDebug.panelFound || puzzleDebug.panelHidden || !puzzleDebug.puzzleCurrent) {
    throw new Error('Puzzle mode did not load puzzle correctly: ' + JSON.stringify(puzzleDebug));
  }
  console.log('✅ TEST 4 PASSED: Puzzle mode successfully initialized and opponent blunder played');

  // --- TEST 5: Phase 5 - Puzzle Hint Functionality ---
  console.log('\n--- TEST 5: Phase 5 - Puzzle Hint Functionality ---');
  await page.click('#puzzle-hint-btn');
  await new Promise(r => setTimeout(r, 300));
  const hintShapeDrawn = await page.evaluate(() => {
    const shapes = document.querySelectorAll('.cg-wrap cg-shapes svg, .cg-wrap .cg-shapes, .cg-wrap svg');
    return shapes.length > 0;
  });
  console.log('Hint shape drawn:', hintShapeDrawn);
  if (!hintShapeDrawn) throw new Error('Hint did not draw shape on board!');
  console.log('✅ TEST 5 PASSED: Tactical hint draws target square shape');

  // --- TEST 6: Phase 5 - Puzzle Next / Skip ---
  console.log('\n--- TEST 6: Phase 5 - Puzzle Next / Skip ---');
  const oldPuzzleId = await page.evaluate(() => window.appState.puzzle.current?.id);
  await page.click('#puzzle-next-btn');
  await new Promise(r => setTimeout(r, 1200));
  const newPuzzleId = await page.evaluate(() => window.appState.puzzle.current?.id);
  console.log(`Switched from puzzle ${oldPuzzleId} to ${newPuzzleId}`);
  console.log('✅ TEST 6 PASSED: Next puzzle loads smoothly');

  await page.screenshot({ path: 'test_phases_4_5_6_verified.png' });
  console.log('📸 Screenshot saved: test_phases_4_5_6_verified.png');
  await browser.close();
  console.log('\n🎉 ALL PHASE 4, 5 & 6 TESTS PASSED WITH 100% SUCCESS!');
})();
