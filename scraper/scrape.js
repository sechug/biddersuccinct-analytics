const { chromium } = require('playwright');
const fs = require('fs');

class Phase2Detector {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.logFile = 'bidders-log.csv';
    this.lastPhaseState = 'phase1';
    this.phase2StartTime = null;
    this.currentSessionBidders = [];
  }

  async init() {
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, 'timestamp,bidderCount\n');
    }

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ]
    });

    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(8000);
    this.page.setDefaultNavigationTimeout(15000);

    await this.page.goto('https://testnet.succinct.xyz/prove/dashboard', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });

    console.log('✅ Browser ready - monitoring for Phase 2...');
  }

  async checkPhase() {
    try {
      const phaseData = await this.page.evaluate(() => {
        const elements = document.querySelectorAll('p.font-monomaniac.mb-1.text-sm.uppercase.text-prove-gray');
        const foundTexts = Array.from(elements).map(el => el.textContent.trim());

        const hasMultiplier = foundTexts.includes('Multiplier');
        const hasPrize = foundTexts.includes('Prize');
        const isPhase2 = hasMultiplier && hasPrize;

        let bidderCount = 0;
        try {
          const bidderEl = document.querySelector('p.font-monomaniac.-mt-1.text-lg.uppercase.text-white');
          if (bidderEl) {
            const match = bidderEl.textContent.match(/\d+/);
            bidderCount = match ? parseInt(match[0], 10) : 0;
          }
        } catch (e) {}

        return {
          foundTexts,
          hasMultiplier,
          hasPrize,
          isPhase2,
          bidderCount,
          timestamp: Date.now()
        };
      });

      return phaseData;
    } catch (error) {
      console.error(`❌ Phase check error: ${error.message}`);
      return null;
    }
  }

  logBidderData(bidderCount) {
    const timestamp = new Date().toISOString().replace('T', 'T').replace(/\.\d{3}Z$/, 'Z');
    const logLine = `${timestamp},${bidderCount}\n`;
    fs.appendFileSync(this.logFile, logLine);
    console.log(`📝 Logged: ${timestamp} - ${bidderCount} bidders`);
  }

  async startMonitoring() {
    this.isRunning = true;
    console.log('🎯 Starting Phase 2 monitoring...');

    let consecutiveErrors = 0;
    let checkCount = 0;

    while (this.isRunning) {
      checkCount++;
      const phaseData = await this.checkPhase();

      if (!phaseData) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          console.log('🔄 Too many errors, refreshing page...');
          try {
            await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
            consecutiveErrors = 0;
          } catch (e) {
            console.error('❌ Reload failed:', e.message);
          }
        }
        await new Promise(resolve => setTimeout(resolve, 10000));
        continue;
      }

      consecutiveErrors = 0;
      const currentPhase = phaseData.isPhase2 ? 'phase2' : 'phase1';

      if (currentPhase !== this.lastPhaseState) {
        if (currentPhase === 'phase2') {
          this.phase2StartTime = Date.now();
          this.currentSessionBidders = [];
          console.log('🚨 PHASE 2 STARTED!');
          this.logBidderData(phaseData.bidderCount);
        } else {
          const duration = this.phase2StartTime ? Math.round((Date.now() - this.phase2StartTime) / 1000) : 0;
          console.log(`⏹️  PHASE 2 ENDED (${duration}s)`);
          this.phase2StartTime = null;
          this.currentSessionBidders = [];
        }
        this.lastPhaseState = currentPhase;
      }

      if (currentPhase === 'phase2') {
        this.currentSessionBidders.push(phaseData.bidderCount);
        process.stdout.write(`🎯 Phase 2 Active - ${phaseData.bidderCount} bidders (duration: ${Math.round((Date.now() - this.phase2StartTime) / 1000)}s)\r`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        const waitText = phaseData.foundTexts.length > 0 ? `[${phaseData.foundTexts.join(', ')}]` : '[no elements]';
        process.stdout.write(`⏳ Waiting for Phase 2... (check #${checkCount}) - Found: ${waitText}\r`);
        await new Promise(resolve => setTimeout(resolve, 15000));
      }
    }
  }

  async stop() {
    console.log('\n🛑 Stopping monitoring...');
    this.isRunning = false;

    if (this.phase2StartTime) {
      const duration = Math.round((Date.now() - this.phase2StartTime) / 1000);
      console.log(`📊 Final Phase 2 duration: ${duration}s`);
      console.log(`📊 Total data points: ${this.currentSessionBidders.length}`);
    }

    try {
      const stats = fs.statSync(this.logFile);
      const lines = fs.readFileSync(this.logFile, 'utf8').split('\n').length - 1;
      console.log(`📄 Final log: ${this.logFile} (${lines} entries, ${Math.round(stats.size / 1024)}KB)`);
    } catch (e) {
      console.log(`📄 Log file: ${this.logFile}`);
    }

    if (this.browser) await this.browser.close();
    console.log('✅ Stopped');
  }

  getLogStats() {
    try {
      if (!fs.existsSync(this.logFile)) return { entries: 0, size: 0 };

      const content = fs.readFileSync(this.logFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim()).length - 1;
      const stats = fs.statSync(this.logFile);

      return {
        entries: lines,
        sizeKB: Math.round(stats.size / 1024),
        lastEntry: content.split('\n').slice(-2)[0]
      };
    } catch (e) {
      return { entries: 0, size: 0, error: e.message };
    }
  }
}

async function main() {
  const detector = new Phase2Detector();

  process.on('SIGINT', async () => {
    await detector.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await detector.stop();
    process.exit(0);
  });

  try {
    await detector.init();
    const stats = detector.getLogStats();
    console.log(`📄 Log file status: ${stats.entries} entries`);
    await detector.startMonitoring();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await detector.stop();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = Phase2Detector;
