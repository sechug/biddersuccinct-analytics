const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeOnce() {
  const logFile = 'data/raw/bidders-log.csv';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    if (!fs.existsSync(logFile)) {
      fs.writeFileSync(logFile, 'timestamp,bidderCount\n');
    }

    await page.goto('https://testnet.succinct.xyz/prove/dashboard', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });

    const phaseData = await page.evaluate(() => {
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

      return {
        isPhase2,
        bidderCount
      };
    });

    if (phaseData.isPhase2) {
      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const logLine = `${timestamp},${phaseData.bidderCount}\n`;
      fs.appendFileSync(logFile, logLine);
      console.log(`📝 Logged: ${timestamp} - ${phaseData.bidderCount} bidders`);
    } else {
      console.log("⚠️ Not in Phase 2, skipping log.");
    }
  } catch (error) {
    console.error('❌ Scrape failed:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

scrapeOnce();
