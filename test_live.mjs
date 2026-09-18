import puppeteer from 'puppeteer';

async function testLive() {
  console.log('Testing LIVE site https://chessmind-lake.vercel.app ...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  
  page.on('console', msg => console.log('[Live Browser]:', msg.type(), msg.text()));
  page.on('pageerror', err => console.error('[Live PageError]:', err.message));

  await page.goto('https://chessmind-lake.vercel.app/', { waitUntil: 'networkidle2', timeout: 30000 });
  
  console.log('Waiting for engine ready dot...');
  await page.waitForSelector('.status-dot.ready', { timeout: 25000 });
  console.log('✅ LIVE ENGINE READY DETECTED!');

  await page.waitForFunction(() => {
    const bm = document.getElementById('best-move');
    return bm && bm.textContent && !bm.textContent.includes('--');
  }, { timeout: 15000 });
  
  const best = await page.$eval('#best-move', el => el.textContent);
  console.log('✅ LIVE STOCKFISH ANALYSIS RESULT:', best);

  console.log('Testing live touch move (e2 -> e4)...');
  const boardBox = await page.$eval('#board', el => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
  const e2X = boardBox.left + (boardBox.width * 4.5 / 8);
  const e2Y = boardBox.top + (boardBox.height * 6.5 / 8);
  const e4X = boardBox.left + (boardBox.width * 4.5 / 8);
  const e4Y = boardBox.top + (boardBox.height * 4.5 / 8);

  // Tap e2
  await page.touchscreen.tap(e2X, e2Y);
  await new Promise(r => setTimeout(r, 200));

  // Tap e4
  await page.touchscreen.tap(e4X, e4Y);
  await new Promise(r => setTimeout(r, 600));

  const piecesAtE4 = await page.$$eval('cg-board piece:not(.ghost)', pieces => {
    return pieces.map(p => ({ key: p.cgKey, cls: p.className }));
  });
  console.log('Live pieces on board after e2-e4:', piecesAtE4.find(p => p.key === 'e4'));
  const e4Moved = piecesAtE4.some(p => p.key === 'e4');
  if (e4Moved) {
    console.log('✅ LIVE PIECE TOUCH CONTROL VERIFIED ON VERCEL PRODUCTION!');
  } else {
    console.error('❌ Live piece did not move to e4!');
  }

  const screenshotPath = 'C:\\Users\\sk\\.gemini\\antigravity\\brain\\555c5614-7037-476b-8473-20011858706d\\live_vercel_verified.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('📸 Live screenshot saved to', screenshotPath);

  await browser.close();
  if (!e4Moved) process.exit(1);
  console.log('🎉 LIVE VERIFICATION COMPLETED WITH 100% SUCCESS!');
}

testLive().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
