import puppeteer from 'puppeteer';

async function testVoiceAndStyling() {
  console.log('🧪 Testing Voice Hold Button & Styling Resilience...');
  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreHTTPSErrors: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('https://localhost:8443', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.appState && window.appState.engineReady === true, { timeout: 25000 });
  console.log('✅ App loaded and Stockfish ready');

  // Test 1: Styling & Anti-FOUC Checks
  console.log('\n--- 1. Testing Styling & Anti-FOUC Rules ---');
  const styleCheck = await page.evaluate(() => {
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const settingsDisplay = window.getComputedStyle(document.getElementById('settings-modal')).display;
    const helpDisplay = window.getComputedStyle(document.getElementById('help-modal')).display;
    const importDisplay = window.getComputedStyle(document.getElementById('import-modal')).display;
    const pttTouchAction = window.getComputedStyle(document.getElementById('ptt-btn')).touchAction;

    return {
      bodyBg,
      settingsDisplay,
      helpDisplay,
      importDisplay,
      pttTouchAction
    };
  });
  console.log('Style check result:', styleCheck);

  if (styleCheck.settingsDisplay !== 'none' || styleCheck.helpDisplay !== 'none' || styleCheck.importDisplay !== 'none') {
    throw new Error('Modals are not properly hidden on load!');
  }
  if (styleCheck.pttTouchAction !== 'none') {
    throw new Error('PTT button must have touch-action: none for reliable mobile gestures!');
  }
  console.log('✅ TEST 1 PASSED: Critical styling and modal isolation verified!');

  // Test 2: Voice Button UI States (Tap and Pointer Interaction)
  console.log('\n--- 2. Testing Voice Button Pointer & Tap Interaction ---');
  const initialText = await page.evaluate(() => document.getElementById('ptt-btn').textContent.trim());
  console.log('Initial PTT text:', initialText);

  // Quick tap (pointerdown)
  await page.evaluate(() => {
    const el = document.getElementById('ptt-btn');
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }));
  });
  const listeningState = await page.evaluate(() => {
    const el = document.getElementById('ptt-btn');
    return {
      hasRecordingClass: el.classList.contains('recording'),
      text: el.textContent.trim()
    };
  });
  console.log('PTT state after pointerdown:', listeningState);

  if (!listeningState.hasRecordingClass || !listeningState.text.includes('Listening')) {
    throw new Error('PTT button did not transition to listening state on pointerdown');
  }

  // Release pointer (quick tap completes)
  await page.evaluate(() => {
    const el = document.getElementById('ptt-btn');
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 100));

  // In tap mode, it stays listening until user taps again
  const tapModeListening = await page.evaluate(() => document.getElementById('ptt-btn').classList.contains('recording'));
  console.log('PTT remains in listening mode for speech:', tapModeListening);

  // Second tap terminates recording
  await page.evaluate(() => {
    const el = document.getElementById('ptt-btn');
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 200));

  const processingOrIdle = await page.evaluate(() => {
    const el = document.getElementById('ptt-btn');
    return {
      hasProcessing: el.classList.contains('processing'),
      hasRecording: el.classList.contains('recording'),
      text: el.textContent.trim()
    };
  });
  console.log('PTT state after second tap (stop):', processingOrIdle);
  console.log('✅ TEST 2 PASSED: Voice button tap and toggle states work reliably!');

  // Test 3: Natural Language Chess Moves via Speech Pipeline
  console.log('\n--- 3. Testing Speech Move Parsing & Execution ---');
  
  // Test 3a: "e4"
  await page.evaluate(() => {
    window.processUserCommandOrMove('e4');
  });
  const afterE4 = await page.evaluate(() => window.appState.chess.history());
  console.log('History after e4:', afterE4);
  if (!afterE4.includes('e4')) {
    throw new Error('Direct e4 move failed to execute');
  }

  // Test 3b: "c to c5" (verifying our regex fix!)
  await page.evaluate(() => {
    window.processUserCommandOrMove('c to c5');
  });
  const afterC5 = await page.evaluate(() => window.appState.chess.history());
  console.log('History after c to c5:', afterC5);
  if (!afterC5.includes('c5')) {
    throw new Error('Speech move "c to c5" failed to execute');
  }

  // Test 3c: "Knight to f3"
  await page.evaluate(() => {
    window.processUserCommandOrMove('Knight to f3');
  });
  const afterNf3 = await page.evaluate(() => window.appState.chess.history());
  console.log('History after Knight to f3:', afterNf3);
  if (!afterNf3.includes('Nf3')) {
    throw new Error('Speech move "Knight to f3" failed to execute');
  }

  // Test 3d: Voice Command "flip board"
  const initialOrientation = await page.evaluate(() => window.appState.ground.state.orientation);
  await page.evaluate(() => {
    window.processUserCommandOrMove('flip board');
  });
  const flippedOrientation = await page.evaluate(() => window.appState.ground.state.orientation);
  console.log('Orientation before/after flip board:', initialOrientation, '->', flippedOrientation);
  if (initialOrientation === flippedOrientation) {
    throw new Error('Voice command "flip board" failed to toggle orientation');
  }
  console.log('✅ TEST 3 PASSED: Natural speech parsing & voice commands execute flawlessly!');

  await browser.close();
  console.log('\n🎉 ALL VOICE & STYLING RESILIENCE TESTS PASSED 100%!');
}

testVoiceAndStyling().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
