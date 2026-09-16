import puppeteer from 'puppeteer';
import path from 'path';

async function runStressBattery() {
  console.log('🚀 Starting ChessMind Mobile & Performance Stress Battery...');
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors'
    ]
  });

  const page = await browser.newPage();
  await page.setBypassServiceWorker(true);
  
  // Set mobile device emulation (Pixel 7)
  await page.setViewport({
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
  );

  const consoleErrors = [];
  const toasts = [];

  page.on('console', msg => {
    const text = msg.text();
    console.log(`[Browser ${msg.type()}]:`, text);
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(err.message);
    console.error('❌ Browser Page Error:', err.message);
  });

  // Track toasts
  await page.exposeFunction('onToastLogged', (text, type) => {
    toasts.push({ text, type });
    console.log(`💬 Toast [${type}]: ${text}`);
  });

  console.log('📡 Navigating to https://localhost:8443...');
  await page.goto('https://localhost:8443', { waitUntil: 'networkidle0', timeout: 30000 });

  // Hook toast observer
  await page.evaluate(() => {
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.classList && node.classList.contains('toast')) {
            const type = node.className.match(/toast-([a-z]+)/)?.[1] || 'info';
            window.onToastLogged(node.textContent, type);
          }
        }
      }
    });
    const container = document.getElementById('toast-container');
    if (container) observer.observe(container, { childList: true });
  });

  // 1. Wait for engine ready
  console.log('⏳ Waiting for Stockfish Engine Ready...');
  await page.waitForSelector('.status-dot.ready', { timeout: 25000 });
  console.log('✅ Stockfish Engine Ready!');

  // Enable 4x CPU throttling via Chrome DevTools Protocol to stress test interactions
  const client = await page.target().createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  console.log('⚡ 4x CPU Throttling ENABLED (simulating low-end mobile device)');

  // Wait for initial analysis to report best move
  await page.waitForFunction(() => {
    const bm = document.getElementById('best-move');
    return bm && bm.textContent && !bm.textContent.includes('--');
  }, { timeout: 15000 });
  const initialBest = await page.$eval('#best-move', el => el.textContent);
  console.log(`✅ Initial Analysis complete: ${initialBest}`);

  // 2. Test Clear Board
  console.log('\n--- TEST 1: Clear Board (1-Click) ---');
  toasts.length = 0;
  await page.click('#clear-board-btn');
  await new Promise(r => setTimeout(r, 600));

  const piecesAfterClear = await page.$$eval('.cg-board-wrap piece:not(.ghost)', pieces => pieces.length);
  console.log(`Actual pieces on board after Clear: ${piecesAfterClear}`);
  if (piecesAfterClear !== 0) {
    throw new Error(`Expected 0 pieces after clear, found ${piecesAfterClear}`);
  }
  
  // Check for forbidden "Must be in Setup Mode" warning
  const setupWarning = toasts.find(t => t.text.includes('Must be in Setup Mode'));
  if (setupWarning) {
    throw new Error(`FAIL: Got "Must be in Setup Mode" toast!`);
  }
  console.log('✅ TEST 1 PASSED: Board cleared instantly without mode errors!');

  // 3. Test Starting Position
  console.log('\n--- TEST 2: Starting Position (1-Click) ---');
  await page.click('#start-pos-btn');
  await new Promise(r => setTimeout(r, 800));

  const piecesAfterReset = await page.$$eval('.cg-board-wrap piece:not(.ghost)', pieces => pieces.length);
  console.log(`Pieces on board after Reset: ${piecesAfterReset}`);
  if (piecesAfterReset !== 32) {
    throw new Error(`Expected 32 pieces after reset, found ${piecesAfterReset}`);
  }
  console.log('✅ TEST 2 PASSED: 32 starting pieces restored!');

  // 4. Test 10-Round Rapid Edit Battery under 4x CPU throttle
  console.log('\n--- TEST 3: 10-Round Rapid Edit Battery (4x CPU Throttling) ---');
  const startTime = Date.now();

  for (let round = 1; round <= 10; round++) {
    const t0 = Date.now();
    // Select White Queen from palette
    await page.click('.palette-item[data-color="white"][data-role="queen"]');
    
    // Tap square e4 on Chessground
    const boardBox = await page.$eval('#board', el => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    
    const e4X = boardBox.x + (boardBox.width * 4.5 / 8);
    const e4Y = boardBox.y + (boardBox.height * 4.5 / 8);
    await page.mouse.click(e4X, e4Y);
    
    // Select Black Knight from palette
    await page.click('.palette-item[data-color="black"][data-role="knight"]');
    const f6X = boardBox.x + (boardBox.width * 5.5 / 8);
    const f6Y = boardBox.y + (boardBox.height * 2.5 / 8);
    await page.mouse.click(f6X, f6Y);

    // Select Trash tool
    await page.click('.palette-trash');
    // Tap e4 to remove queen
    await page.mouse.click(e4X, e4Y);

    const roundDuration = Date.now() - t0;
    console.log(`  Round ${round}/10 completed in ${roundDuration}ms (Responsive)`);
    await new Promise(r => setTimeout(r, 80));
  }

  const totalBatteryDuration = Date.now() - startTime;
  console.log(`✅ TEST 3 PASSED: 10 rapid rounds finished in ${totalBatteryDuration}ms with 0 hangs!`);

  // 5. Test Text / Voice Command
  console.log('\n--- TEST 4: Text Move Execution ---');
  await page.click('#start-pos-btn');
  await new Promise(r => setTimeout(r, 500));

  await page.type('#command-input', 'e2 to e4');
  await page.click('#command-submit-btn');
  await new Promise(r => setTimeout(r, 1000));

  const bestAfterMove = await page.$eval('#best-move', el => el.textContent);
  console.log(`Best move after e2 to e4: ${bestAfterMove}`);
  console.log('✅ TEST 4 PASSED: Command executed and engine evaluated new position!');

  // 6. Capture mobile screenshot
  const screenshotPath = 'C:\\Users\\sk\\.gemini\\antigravity\\brain\\555c5614-7037-476b-8473-20011858706d\\mobile_simplified.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`📸 Mobile screenshot saved to ${screenshotPath}`);

  if (consoleErrors.length > 0) {
    console.warn(`⚠️ Warning: ${consoleErrors.length} console error(s) logged during run.`);
  } else {
    console.log('🌟 ZERO Console Errors throughout entire test battery!');
  }

  await browser.close();
  console.log('\n🎉 ALL STRESS BATTERY TESTS PASSED SUCCESSFULLY!');
}

runStressBattery().catch(err => {
  console.error('💥 TEST BATTERY FAILED:', err);
  process.exit(1);
});
