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

  const screenshotPath = 'C:\\Users\\sk\\.gemini\\antigravity\\brain\\555c5614-7037-476b-8473-20011858706d\\live_vercel_verified.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('📸 Live screenshot saved to', screenshotPath);

  await browser.close();
  console.log('🎉 LIVE VERIFICATION COMPLETED WITH 100% SUCCESS!');
}

testLive().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
