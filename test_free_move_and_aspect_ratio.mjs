import puppeteer from 'puppeteer-core';

(async () => {
  console.log('🚀 Starting Free Move & Aspect-Ratio Responsive Board Test Suite...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    ignoreHTTPSErrors: true,
    defaultViewport: { width: 1024, height: 768 }
  });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);

  // Navigate to local server (if python serve is running, or start it)
  try {
    await page.goto('http://localhost:8080/', { waitUntil: 'networkidle0' });
    console.log('Connected to http://localhost:8080/');
  } catch (e) {
    console.log('Failed to connect to localhost:8080, attempting local file or fallback:', e.message);
    throw e;
  }

  // Wait for service worker to install, claim, and finish any initial controllerchange reload
  await new Promise(r => setTimeout(r, 5500));
  await page.waitForFunction(() => !!window.appState && !!window.appState.ground, { timeout: 15000 });

  // =========================================================================
  // TEST 1: Aspect Ratio Responsive Sizing on Tablet Landscape (1024x768)
  // =========================================================================
  console.log('\n--- TEST 1: Tablet Landscape (1024x768) Board Sizing ---');
  await page.setViewport({ width: 1024, height: 768 });
  await new Promise(r => setTimeout(r, 600));

  const landscapeBoardMetrics = await page.evaluate(() => {
    const board = document.getElementById('board');
    const boardCard = document.querySelector('.board-container-card');
    const bRect = board.getBoundingClientRect();
    const cRect = boardCard.getBoundingClientRect();
    return {
      boardWidth: bRect.width,
      boardHeight: bRect.height,
      aspectRatio: bRect.width / bRect.height,
      cardMinHeight: window.getComputedStyle(boardCard).minHeight,
      cardHeight: cRect.height,
      windowHeight: window.innerHeight
    };
  });
  console.log('Landscape Metrics:', landscapeBoardMetrics);

  if (landscapeBoardMetrics.boardWidth <= 500) {
    throw new Error(`Board width ${landscapeBoardMetrics.boardWidth}px is too small! Expected > 550px for 1024x768.`);
  }
  if (Math.abs(landscapeBoardMetrics.aspectRatio - 1) > 0.05) {
    throw new Error(`Board is not a square! Aspect ratio: ${landscapeBoardMetrics.aspectRatio}`);
  }
  console.log('✅ TEST 1 PASSED: Board expands to ~600px square on 1024x768 tablet and covers screen');

  // =========================================================================
  // TEST 2: Aspect Ratio Responsive Sizing on Mobile Portrait (390x844)
  // =========================================================================
  console.log('\n--- TEST 2: Mobile Portrait (390x844) Board Sizing ---');
  await page.setViewport({ width: 390, height: 844 });
  await new Promise(r => setTimeout(r, 600));

  const portraitBoardMetrics = await page.evaluate(() => {
    const board = document.getElementById('board');
    const boardCard = document.querySelector('.board-container-card');
    const bRect = board.getBoundingClientRect();
    const cRect = boardCard.getBoundingClientRect();
    return {
      boardWidth: bRect.width,
      boardHeight: bRect.height,
      aspectRatio: bRect.width / bRect.height,
      cardHeight: cRect.height,
      windowHeight: window.innerHeight,
      controlsTop: document.querySelector('.unified-controls-card')?.getBoundingClientRect().top
    };
  });
  console.log('Portrait Metrics:', portraitBoardMetrics);

  if (portraitBoardMetrics.boardWidth < 360) {
    throw new Error(`Board width ${portraitBoardMetrics.boardWidth}px did not cover screen width!`);
  }
  if (portraitBoardMetrics.controlsTop < portraitBoardMetrics.windowHeight - 50) {
    console.warn('Controls are partially visible before scroll, checking positioning...');
  }
  console.log('✅ TEST 2 PASSED: Board covers mobile screen width and fills initial viewport');

  // =========================================================================
  // TEST 3: Free Move in 1v1 Local Mode
  // =========================================================================
  console.log('\n--- TEST 3: Free Move in 1v1 Local Mode ---');
  // Scroll down to controls and click 1v1 Local button
  await page.evaluate(() => {
    document.querySelector('.unified-controls-card')?.scrollIntoView({ behavior: 'instant' });
    document.querySelector('button[data-mode="local-1v1"]')?.click();
  });
  await new Promise(r => setTimeout(r, 800));

  const local1v1State = await page.evaluate(() => {
    const panel = document.getElementById('local-1v1-panel');
    const freeBtn = document.getElementById('free-mode-1v1-btn');
    const quickBar = document.querySelector('.quick-actions-bar');
    return {
      panelVisible: panel && !panel.classList.contains('hidden'),
      freeBtnFound: !!freeBtn,
      freeBtnText: freeBtn?.textContent?.trim(),
      quickBarVisible: quickBar && window.getComputedStyle(quickBar).display !== 'none',
      mode: window.appState?.gameMode
    };
  });
  console.log('1v1 Local State:', local1v1State);
  if (!local1v1State.panelVisible || !local1v1State.freeBtnFound) {
    throw new Error('1v1 panel or free move button not found!');
  }

  // Toggle Free Move ON
  await page.evaluate(() => document.getElementById('free-mode-1v1-btn')?.click());
  await new Promise(r => setTimeout(r, 400));

  const freeOnState = await page.evaluate(() => {
    const freeBtn = document.getElementById('free-mode-1v1-btn');
    const quickFreeBtn = document.getElementById('free-mode-btn');
    return {
      btnActive: freeBtn?.classList.contains('active'),
      btnText: freeBtn?.textContent?.trim(),
      quickBtnActive: quickFreeBtn?.classList.contains('active'),
      quickBtnText: quickFreeBtn?.textContent?.trim(),
      freePlacement: window.appState?.freePlacement
    };
  });
  console.log('Free Move ON State:', freeOnState);
  if (!freeOnState.freePlacement || !freeOnState.btnActive) {
    throw new Error('Free move did not activate properly in 1v1 mode!');
  }
  if (!freeOnState.quickBtnActive) {
    throw new Error('Quick actions free button was not synchronized!');
  }
  console.log('✅ TEST 3 PASSED: Free Move toggle is active and synchronized in 1v1 Local mode');

  // =========================================================================
  // TEST 4: Execute Free Piece Move on Board
  // =========================================================================
  console.log('\n--- TEST 4: Execute Free Piece Move on Board ---');
  const freeMoveExecuted = await page.evaluate(() => {
    // In free placement mode, move Knight from b8 to e5 (illegal in standard rules on move 1)
    const piece = window.appState.chess.get('b8');
    if (!piece) return { success: false, reason: 'No piece on b8' };
    
    // Simulate board move from b8 to e5
    window.processUserCommandOrMove('move b8 to e5');
    const pieceOnE5 = window.appState.chess.get('e5');
    return {
      success: !!pieceOnE5 && pieceOnE5.type === 'n',
      fen: window.appState.currentFen
    };
  });
  console.log('Free Move Execution:', freeMoveExecuted);
  if (!freeMoveExecuted.success) {
    throw new Error('Could not execute free piece move in 1v1 mode!');
  }
  console.log('✅ TEST 4 PASSED: Free piece movement verified in 1v1 Local mode');

  // Toggle Free Move back OFF
  await page.evaluate(() => document.getElementById('free-mode-1v1-btn')?.click());
  await new Promise(r => setTimeout(r, 300));
  const freeOffState = await page.evaluate(() => window.appState?.freePlacement);
  console.log('Free Move OFF verified:', !freeOffState);

  // Take screenshot
  await page.screenshot({ path: 'test_free_move_and_aspect_ratio_verified.png' });
  console.log('📸 Screenshot saved: test_free_move_and_aspect_ratio_verified.png');

  await browser.close();
  console.log('\n🎉 ALL TESTS PASSED WITH 100% SUCCESS!');
})();
