import puppeteer from 'puppeteer';

async function testControls() {
  console.log('♟️ Testing Mobile Touch Piece Controls (Tap-to-Move & Drag-and-Drop)...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });

  const page = await browser.newPage();
  await page.setBypassServiceWorker(true);
  
  // iPhone 14 Pro Mobile Viewport
  await page.setViewport({
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
  );

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
      console.log('  [Browser Error]:', msg.text());
    }
  });

  console.log('Navigating to https://localhost:8443...');
  await page.goto('https://localhost:8443', { waitUntil: 'networkidle0', timeout: 25000 });

  await page.waitForSelector('.status-dot.ready', { timeout: 20000 });
  console.log('✅ Stockfish Engine Ready');

  // Helper to get coordinates of a square (e.g. "e2", "e4")
  const getSquareCenter = async (sq) => {
    return await page.evaluate((squareStr) => {
      const file = squareStr.charCodeAt(0) - 97; // 0 for 'a', 4 for 'e'
      const rank = parseInt(squareStr[1], 10) - 1; // 0 for '1', 1 for '2', etc.
      // In white orientation: file 0 is left, file 7 is right.
      // rank 7 is top ('8'), rank 0 is bottom ('1').
      const boardEl = document.querySelector('cg-board') || document.getElementById('board');
      const rect = boardEl.getBoundingClientRect();
      const sqWidth = rect.width / 8;
      const sqHeight = rect.height / 8;
      const x = rect.left + (file + 0.5) * sqWidth;
      const y = rect.top + (7 - rank + 0.5) * sqHeight;
      return { x, y, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
    }, sq);
  };

  // Helper to read FEN or piece positions
  const getPieceAt = async (sq) => {
    return await page.evaluate((targetSq) => {
      const pieces = Array.from(document.querySelectorAll('cg-board piece:not(.ghost)'));
      for (const p of pieces) {
        if (p.cgKey === targetSq) {
          return p.className;
        }
      }
      return null;
    }, sq);
  };

  console.log('\n--- 1. Testing Touch Tap-to-Move (e2 -> e4) ---');
  const e2Pos = await getSquareCenter('e2');
  const e4Pos = await getSquareCenter('e4');
  console.log(`e2 screen pos: (${e2Pos.x.toFixed(1)}, ${e2Pos.y.toFixed(1)})`);
  console.log(`e4 screen pos: (${e4Pos.x.toFixed(1)}, ${e4Pos.y.toFixed(1)})`);

  // Tap e2
  console.log('Tapping e2...');
  await page.touchscreen.tap(e2Pos.x, e2Pos.y);
  await new Promise(r => setTimeout(r, 250));

  // Check if square is selected
  const isE2Selected = await page.evaluate(() => {
    const sel = document.querySelector('square.selected');
    const dests = document.querySelectorAll('square.move-dest');
    return {
      hasSelected: !!sel,
      selectedKey: sel ? sel.cgKey : null,
      destCount: dests.length
    };
  });
  console.log(`e2 selection state:`, isE2Selected);

  // Tap e4
  console.log('Tapping e4 (destination)...');
  await page.touchscreen.tap(e4Pos.x, e4Pos.y);
  await new Promise(r => setTimeout(r, 400));

  const pAtE2 = await getPieceAt('e2');
  const pAtE4 = await getPieceAt('e4');
  console.log(`After e2-e4 tap: piece at e2 = [${pAtE2}], piece at e4 = [${pAtE4}]`);
  const move1Success = pAtE2 === null && pAtE4 && pAtE4.includes('pawn') && pAtE4.includes('white');

  if (move1Success) {
    console.log('✅ TEST 1 PASSED: Tap-to-Move (e2 -> e4) worked!');
  } else {
    console.error('❌ TEST 1 FAILED: e2-e4 did NOT execute via tap!');
  }

  console.log('\n--- 2. Testing Touch Drag-and-Drop (e7 -> e5) ---');
  const e7Pos = await getSquareCenter('e7');
  const e5Pos = await getSquareCenter('e5');
  console.log(`e7 screen pos: (${e7Pos.x.toFixed(1)}, ${e7Pos.y.toFixed(1)})`);
  console.log(`e5 screen pos: (${e5Pos.x.toFixed(1)}, ${e5Pos.y.toFixed(1)})`);

  const elemAtE7 = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? { tagName: el.tagName, className: el.className, id: el.id } : null;
  }, { x: e7Pos.x, y: e7Pos.y });
  console.log('Element at e7 screen pos:', elemAtE7);

  // Drag with Puppeteer native hardware touch
  console.log(`Starting hardware touch drag: (${e7Pos.x.toFixed(1)}, ${e7Pos.y.toFixed(1)}) -> (${e5Pos.x.toFixed(1)}, ${e5Pos.y.toFixed(1)})`);
  const touch = await page.touchscreen.touchStart(e7Pos.x, e7Pos.y);
  await new Promise(r => setTimeout(r, 60));

  const afterTouchStartState = await page.evaluate(() => {
    const sel = document.querySelector('square.selected');
    const draggingPiece = document.querySelector('piece.dragging');
    return {
      selectedKey: sel ? sel.cgKey : null,
      isDragging: !!draggingPiece,
      draggingKey: draggingPiece ? draggingPiece.cgKey : null,
    };
  });
  console.log('State after touchStart on e7:', afterTouchStartState);

  for (let i = 1; i <= 8; i++) {
    const curX = e7Pos.x + (e5Pos.x - e7Pos.x) * (i / 8);
    const curY = e7Pos.y + (e5Pos.y - e7Pos.y) * (i / 8);
    await touch.move(curX, curY);
    await new Promise(r => setTimeout(r, 25));
  }

  const afterTouchMoveState = await page.evaluate(() => {
    const draggingPiece = document.querySelector('piece.dragging');
    return {
      isDragging: !!draggingPiece,
      draggingTransform: draggingPiece ? draggingPiece.style.transform : null
    };
  });
  console.log('Ending drag (releasing touch)...');
  await touch.end();
  await new Promise(r => setTimeout(r, 400));
  const pAtE7 = await getPieceAt('e7');
  const pAtE5 = await getPieceAt('e5');
  console.log(`After e7-e5 drag: piece at e7 = [${pAtE7}], piece at e5 = [${pAtE5}]`);
  const move2Success = pAtE7 === null && pAtE5 && pAtE5.includes('pawn') && pAtE5.includes('black');
  if (move2Success) {
    console.log('✅ TEST 2 PASSED: Touch Drag-and-Drop worked!');
  } else {
    console.error('❌ TEST 2 FAILED: Touch Drag-and-Drop did NOT complete!');
  }
  console.log('\n--- 3. Testing Knight Tap-to-Move (g1 -> f3) ---');
  const g1Pos = await getSquareCenter('g1');
  const f3Pos = await getSquareCenter('f3');
  await page.touchscreen.tap(g1Pos.x, g1Pos.y);
  await new Promise(r => setTimeout(r, 200));
  await page.touchscreen.tap(f3Pos.x, f3Pos.y);
  await new Promise(r => setTimeout(r, 400));
  const pAtG1 = await getPieceAt('g1');
  const pAtF3 = await getPieceAt('f3');
  console.log(`Knight move g1-f3: piece at g1 = [${pAtG1}], piece at f3 = [${pAtF3}]`);
  const move3Success = pAtG1 === null && pAtF3 && pAtF3.includes('knight') && pAtF3.includes('white');
  if (move3Success) {
    console.log('✅ TEST 3 PASSED: Knight move (g1 -> f3) succeeded!');
  } else {
    console.error('❌ TEST 3 FAILED: Knight move (g1 -> f3) failed!');
  }

  console.log('\n--- 4. Testing Free Move Mode (Illegal Moves Allowed) ---');
  await page.click('#free-mode-btn');
  await new Promise(r => setTimeout(r, 300));
  // In free move mode, move White King e1 directly to d5!
  const e1Pos = await getSquareCenter('e1');
  const d5Pos = await getSquareCenter('d5');
  await page.touchscreen.tap(e1Pos.x, e1Pos.y);
  await new Promise(r => setTimeout(r, 200));
  await page.touchscreen.tap(d5Pos.x, d5Pos.y);
  await new Promise(r => setTimeout(r, 400));
  const pAtE1 = await getPieceAt('e1');
  const pAtD5 = await getPieceAt('d5');
  console.log(`Free move e1-d5: piece at e1 = [${pAtE1}], piece at d5 = [${pAtD5}]`);
  const move4Success = pAtE1 === null && pAtD5 && pAtD5.includes('king') && pAtD5.includes('white');
  if (move4Success) {
    console.log('✅ TEST 4 PASSED: Free Move Mode allows arbitrary piece placement!');
  } else {
    console.error('❌ TEST 4 FAILED: Free Move Mode failed!');
  }

  // Toggle Free Move back to OFF
  await page.click('#free-mode-btn');
  await new Promise(r => setTimeout(r, 300));

  console.log('\n--- 5. Testing Quick Palette Piece Placement (White Queen on c4) ---');
  await page.click('.palette-item[data-color="white"][data-role="queen"]');
  const c4Pos = await getSquareCenter('c4');
  await page.touchscreen.tap(c4Pos.x, c4Pos.y);
  await new Promise(r => setTimeout(r, 400));
  const pAtC4 = await getPieceAt('c4');
  console.log(`Palette placement: piece at c4 = [${pAtC4}]`);
  const move5Success = pAtC4 && pAtC4.includes('queen') && pAtC4.includes('white');
  if (move5Success) {
    console.log('✅ TEST 5 PASSED: Quick Palette placed White Queen on c4!');
  } else {
    console.error('❌ TEST 5 FAILED: Palette placement failed!');
  }

  await browser.close();
  return { move1Success, move2Success, move3Success, move4Success, move5Success };
}

testControls().then(res => {
  console.log('\nFinal Suite Results:', res);
  const allPassed = Object.values(res).every(Boolean);
  if (!allPassed) {
    process.exit(1);
  }
  console.log('🎉 ALL 5 PIECE CONTROL TESTS PASSED PERFECTLY!');
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
