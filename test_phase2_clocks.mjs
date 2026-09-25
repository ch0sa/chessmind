import puppeteer from 'puppeteer';

async function testPhase2Clocks() {
  console.log('🧪 Testing Phase 2 Features: Chess Clocks, Time Controls, Increments, Low Time & Flagging...');
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

  // Test 1: Clocks hidden by default in Analysis Mode
  console.log('\n--- 1. Testing Clock Visibility in Analysis Mode ---');
  const analysisClocks = await page.evaluate(() => {
    const topClock = document.getElementById('top-clock');
    const bottomClock = document.getElementById('bottom-clock');
    return {
      topHidden: topClock.classList.contains('hidden'),
      bottomHidden: bottomClock.classList.contains('hidden'),
      clockEnabled: window.appState.clock.enabled
    };
  });
  console.log('Analysis mode clocks:', analysisClocks);
  if (!analysisClocks.topHidden || !analysisClocks.bottomHidden || analysisClocks.clockEnabled) {
    throw new Error('Clocks should be hidden and disabled in Analysis mode');
  }
  console.log('✅ TEST 1 PASSED: Clocks are correctly hidden in Analysis mode!');

  // Test 2: Starting a game with Time Control (3|2 Blitz) in 1v1 Mode
  console.log('\n--- 2. Testing Clock Initialization & Countdown in Local 1v1 (3|2) ---');
  await page.click('button[data-mode="local-1v1"]');
  await new Promise(r => setTimeout(r, 200));

  await page.select('#time-control-1v1', '3|2');
  await page.click('#new-1v1-btn');
  await new Promise(r => setTimeout(r, 100));

  const startClockState = await page.evaluate(() => {
    const topClock = document.getElementById('top-clock');
    const bottomClock = document.getElementById('bottom-clock');
    return {
      topText: topClock.textContent,
      bottomText: bottomClock.textContent,
      topActive: topClock.classList.contains('active'),
      bottomActive: bottomClock.classList.contains('active'),
      whiteTime: window.appState.clock.whiteTime,
      blackTime: window.appState.clock.blackTime,
      activeColor: window.appState.clock.activeColor,
      enabled: window.appState.clock.enabled,
      increment: window.appState.clock.incrementSeconds
    };
  });
  console.log('Clock state at game start:', startClockState);

  if (!startClockState.enabled || !startClockState.bottomActive || startClockState.topActive) {
    throw new Error('Bottom clock (White) should be active and running at game start');
  }
  if (startClockState.whiteTime > 180 || startClockState.whiteTime < 178 || startClockState.blackTime !== 180 || startClockState.increment !== 2) {
    throw new Error(`Clock times incorrect for 3|2: white=${startClockState.whiteTime}, black=${startClockState.blackTime}`);
  }

  // Record white time and wait 1.2 seconds to verify countdown
  const midWhiteTime = startClockState.whiteTime;
  await new Promise(r => setTimeout(r, 1200));
  const tickingCheck = await page.evaluate(() => ({
    whiteTime: window.appState.clock.whiteTime,
    blackTime: window.appState.clock.blackTime
  }));
  console.log('After countdown:', tickingCheck);
  if (tickingCheck.whiteTime >= midWhiteTime || tickingCheck.blackTime !== 180) {
    throw new Error('White clock failed to count down or Black clock moved prematurely');
  }
  console.log('✅ TEST 2 PASSED: White clock counts down while Black clock remains paused!');

  // Test 3: Making a move applies Increment & Switches Active Turn
  console.log('\n--- 3. Testing Move Execution: Increment Addition & Active Turn Switch ---');
  const preMoveTime = await page.evaluate(() => window.appState.clock.whiteTime);

  // Execute White e2 -> e4
  await page.evaluate(() => {
    window.appState.ground.state.events.move('e2', 'e4');
  });
  await new Promise(r => setTimeout(r, 200));

  const postMoveState = await page.evaluate(() => {
    const topClock = document.getElementById('top-clock');
    const bottomClock = document.getElementById('bottom-clock');
    return {
      topActive: topClock.classList.contains('active'),
      bottomActive: bottomClock.classList.contains('active'),
      whiteTime: window.appState.clock.whiteTime,
      blackTime: window.appState.clock.blackTime,
      activeColor: window.appState.clock.activeColor
    };
  });
  console.log('State after White plays e4 (with 2s increment):', postMoveState);

  if (postMoveState.whiteTime < preMoveTime) {
    throw new Error('Increment (+2s) was not credited to White after making a move');
  }
  if (!postMoveState.topActive || postMoveState.bottomActive || postMoveState.activeColor !== 'black') {
    throw new Error('Clock active turn failed to switch to Black (top clock)');
  }

  // Execute Black e7 -> e5
  await page.evaluate(() => {
    window.appState.ground.state.events.move('e7', 'e5');
  });
  await new Promise(r => setTimeout(r, 200));

  const blackMoveState = await page.evaluate(() => {
    const topClock = document.getElementById('top-clock');
    const bottomClock = document.getElementById('bottom-clock');
    return {
      topActive: topClock.classList.contains('active'),
      bottomActive: bottomClock.classList.contains('active'),
      activeColor: window.appState.clock.activeColor
    };
  });
  console.log('State after Black plays e5:', blackMoveState);
  if (!blackMoveState.bottomActive || blackMoveState.topActive || blackMoveState.activeColor !== 'white') {
    throw new Error('Clock active turn failed to switch back to White (bottom clock)');
  }
  console.log('✅ TEST 3 PASSED: Move execution accurately grants increment and toggles active clock!');

  // Test 4: Low-Time Warning (< 20s) and Sub-Second Precision
  console.log('\n--- 4. Testing Low-Time Warning (< 20s) & Tenths Precision ---');
  await page.evaluate(() => {
    window.appState.clock.whiteTime = 14.3;
    window.appState.clock.lastTimestamp = performance.now();
  });
  await new Promise(r => setTimeout(r, 200));

  const lowTimeCheck = await page.evaluate(() => {
    const bottomClock = document.getElementById('bottom-clock');
    return {
      text: bottomClock.textContent,
      hasLowTimeClass: bottomClock.classList.contains('low-time')
    };
  });
  console.log('Low time display check:', lowTimeCheck);
  if (!lowTimeCheck.hasLowTimeClass || !lowTimeCheck.text.includes('.')) {
    throw new Error('Clock under 20s should have .low-time class and show tenths of seconds (MM:SS.s)');
  }
  console.log('✅ TEST 4 PASSED: Low-time warning (< 20s) displays pulsing indicator and tenths precision!');

  // Test 5: Timeout & Flagging Detection
  console.log('\n--- 5. Testing Flagging / Timeout Detection ---');
  await page.evaluate(() => {
    window.appState.clock.whiteTime = 0.05;
    window.appState.clock.lastTimestamp = performance.now();
  });

  await new Promise(r => setTimeout(r, 500));

  const flagCheck = await page.evaluate(() => {
    const statusText = document.getElementById('game-status-text').textContent;
    return {
      isGameOver: window.appState.isGameOver,
      isFlagged: window.appState.clock.isFlagged,
      timerId: window.appState.clock.timerId,
      statusText
    };
  });
  console.log('Flagging result:', flagCheck);
  if (!flagCheck.isGameOver || !flagCheck.isFlagged || flagCheck.timerId !== null || !flagCheck.statusText.includes('wins on time')) {
    throw new Error('Clock flagging failed to end the game or declare winner on time');
  }
  console.log('✅ TEST 5 PASSED: Timeout successfully stops game, flags player, and updates status!');

  // Test 6: Board Flip Clock Synchronization
  console.log('\n--- 6. Testing Board Flip Clock Synchronization ---');
  await page.select('#time-control-1v1', '5|0');
  await page.click('#new-1v1-btn');
  await new Promise(r => setTimeout(r, 200));

  await page.evaluate(() => {
    window.appState.clock.whiteTime = 250;
    window.appState.clock.blackTime = 120;
    window.appState.clock.lastTimestamp = performance.now();
  });
  await page.click('#flip-board-btn');
  await new Promise(r => setTimeout(r, 200));

  const flipCheck = await page.evaluate(() => {
    const topClock = document.getElementById('top-clock');
    const bottomClock = document.getElementById('bottom-clock');
    return {
      orientation: window.appState.boardOrientation,
      topClockText: topClock.textContent,
      bottomClockText: bottomClock.textContent
    };
  });
  console.log('After board flip:', flipCheck);
  if (flipCheck.orientation !== 'black' || !flipCheck.topClockText.includes('04:10') || !flipCheck.bottomClockText.includes('02:00')) {
    throw new Error('Flipping board failed to swap clock displays to match player orientations');
  }
  console.log('✅ TEST 6 PASSED: Board flip correctly swaps clock positions!');

  await browser.close();
  console.log('\n🎉 ALL 6 PHASE 2 CLOCK & TIME CONTROL TESTS PASSED 100%!');
}

testPhase2Clocks().catch(err => {
  console.error('❌ PHASE 2 CLOCK TEST FAILED:', err);
  process.exit(1);
});
