const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function scrapeInterval() {
  const logFile = path.join(__dirname, '../data/raw/bidders-log.csv');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  if (!fs.existsSync(logFile)) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, 'timestamp,bidderCount\n');
  }

  const collected = [];

  console.log('⏱️ Starting 15-minute collection loop...');
  for (let i = 0; i < 15; i++) {
    try {
      await page.goto('https://testnet.succinct.xyz/prove/dashboard', {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });

      const data = await page.evaluate(() => {
        const elements = document.querySelectorAll('p.font-monomaniac.mb-1.text-sm.uppercase.text-prove-gray');
        const foundTexts = Array.from(elements).map(el => el.textContent.trim());
        const hasMultiplier = foundTexts.includes('Multiplier');
        const hasPrize = foundTexts.includes('Prize');
        const isPhase2 = hasMultiplier && hasPrize;

        let bidderCount = 0;
        const bidderEl = document.querySelector('p.font-monomaniac.-mt-1.text-lg.uppercase.text-white');
        if (bidderEl) {
          const match = bidderEl.textContent.match(/\d+/);
          bidderCount = match ? parseInt(match[0], 10) : 0;
        }

        return { isPhase2, bidderCount };
      });

      if (data.isPhase2) {
        collected.push(data.bidderCount);
        console.log(`✅ Minute ${i + 1}: ${data.bidderCount} bidders (Phase 2)`);
      } else {
        console.log(`⏳ Minute ${i + 1}: Not Phase 2`);
      }
    } catch (err) {
      console.error(`⚠️ Minute ${i + 1} failed:`, err.message);
    }

    if (i < 14) await new Promise(res => setTimeout(res, 60 * 1000)); // wait 1 min
  }

  await browser.close();

  if (collected.length > 0) {
    const avg = collected.reduce((a, b) => a + b, 0) / collected.length;
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const line = `${timestamp},${avg.toFixed(1)}\n`;
    fs.appendFileSync(logFile, line);
    console.log(`📝 Logged 15-min average: ${avg.toFixed(1)} bidders`);
  } else {
    console.log('🚫 No Phase 2 detected in last 15 minutes. No log written.');
  }
}

scrapeInterval();
