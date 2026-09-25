import puppeteer from 'puppeteer';

async function runNewFeatureTests() {
  console.log('🧪 Testing New Features: Stop Analysis, Depth, Perspective, Modes & UX...');
  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreHTTPSErrors: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });

  const page = await browser.newPage();
  await page.setBypassServiceWorker(true);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  await page.goto('https://localhost:8443', { waitUntil: 'domcontentloaded' });

  // Wait for Stockfish engine ready
  await page.waitForFunction(() => window.appState && window.appState.engineReady === true, { timeout: 25000 });
  console.log('✅ Stockfish Engine Ready');

  // Test 1: Stop Analysis button
  console.log('\n--- 1. Testing Stop Analysis & Pause State ---');
  await page.evaluate(() => {
    document.getElementById('analyze-btn').click();
  });
  await new Promise(r => setTimeout(r, 100));

  // Click Stop
  await page.evaluate(() => {
    document.getElementById('stop-btn').click();
  });
  await new Promise(r => setTimeout(r, 400));

  const stopCheck = await page.evaluate(() => {
    return {
      isPaused: window.appState.analysisPaused,
      stopBtnDisplay: document.getElementById('stop-btn').style.display,
      analyzeBtnDisabled: document.getElementById('analyze-btn').disabled,
    };
  });
  console.log('Stop Analysis state:', stopCheck);
  if (!stopCheck.isPaused || stopCheck.stopBtnDisplay !== 'none' || stopCheck.analyzeBtnDisabled) {
    throw new Error('Stop Analysis button failed to properly pause and reset buttons');
  }
  console.log('✅ TEST 1 PASSED: Stop Analysis pauses engine and updates UI!');

  // Test 2: Depth Setting
  console.log('\n--- 2. Testing Depth Setting ---');
  await page.click('#settings-btn');
  await new Promise(r => setTimeout(r, 300));

  await page.evaluate(() => {
    const slider = document.getElementById('depth-slider');
    slider.value = 11;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const depthCheck = await page.evaluate(() => {
    return {
      stateDepth: window.appState.settings.depth,
      depthValueText: document.getElementById('depth-value').textContent,
      depthDisplayText: document.getElementById('depth-display').textContent,
    };
  });
  console.log('Depth check:', depthCheck);
  if (depthCheck.stateDepth !== 11 || depthCheck.depthValueText !== '11' || !depthCheck.depthDisplayText.includes('11')) {
    throw new Error('Depth setting failed to update state, label, or HUD display');
  }
  console.log('✅ TEST 2 PASSED: Depth setting successfully updates and syncs with HUD!');

  // Test 3: Analysis Perspective
  console.log('\n--- 3. Testing Analysis Perspective (Black vs White) ---');
  await page.evaluate(() => {
    const sel = document.getElementById('analysis-side');
    sel.value = 'black';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const sideCheck = await page.evaluate(() => {
    return window.appState.settings.analysisSide;
  });
  console.log('Perspective setting:', sideCheck);
  if (sideCheck !== 'black') {
    throw new Error('Perspective setting failed to update state');
  }

  // Close settings via backdrop click
  await page.click('#settings-modal', { offset: { x: 5, y: 5 } });
  await new Promise(r => setTimeout(r, 300));
  const modalHidden = await page.evaluate(() => {
    return document.getElementById('settings-modal').classList.contains('hidden');
  });
  console.log('Settings modal closed on backdrop click:', modalHidden);
  if (!modalHidden) {
    throw new Error('Settings modal failed to close on backdrop click');
  }
  console.log('✅ TEST 3 PASSED: Perspective setting and modal backdrop click work!');

  // Test 4: Game Modes (vs Computer)
  console.log('\n--- 4. Testing Play vs Computer Mode ---');
  await page.click('button[data-mode="vs-computer"]');
  await new Promise(r => setTimeout(r, 600));

  const vsCompState = await page.evaluate(() => {
    return {
      gameMode: window.appState.gameMode,
      vsPanelVisible: !document.getElementById('vs-computer-panel').classList.contains('hidden'),
      statusBarVisible: !document.getElementById('game-status-bar').classList.contains('hidden'),
      statusText: document.getElementById('game-status-text').textContent,
    };
  });
  console.log('vs Computer state:', vsCompState);
  if (vsCompState.gameMode !== 'vs-computer' || !vsCompState.vsPanelVisible || !vsCompState.statusBarVisible) {
    throw new Error('Switching to vs Computer mode failed');
  }

  // Test 5: 1v1 Local Mode
  console.log('\n--- 5. Testing 1v1 Local Mode ---');
  await page.click('button[data-mode="local-1v1"]');
  await new Promise(r => setTimeout(r, 600));

  const localState = await page.evaluate(() => {
    return {
      gameMode: window.appState.gameMode,
      localPanelVisible: !document.getElementById('local-1v1-panel').classList.contains('hidden'),
      statusText: document.getElementById('game-status-text').textContent,
    };
  });
  console.log('1v1 Local state:', localState);
  if (localState.gameMode !== 'local-1v1' || !localState.localPanelVisible) {
    throw new Error('Switching to 1v1 Local mode failed');
  }

  // Switch back to Analysis mode
  await page.click('button[data-mode="analysis"]');
  await new Promise(r => setTimeout(r, 500));
  const backToAnalysis = await page.evaluate(() => window.appState.gameMode);
  if (backToAnalysis !== 'analysis') {
    throw new Error('Switching back to analysis mode failed');
  }
  console.log('✅ TEST 5 PASSED: 1v1 Local mode and mode switching work perfectly!');

  await browser.close();
  console.log('\n🎉 ALL 5 NEW FEATURE TESTS PASSED WITH 100% SUCCESS!');
}

runNewFeatureTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
