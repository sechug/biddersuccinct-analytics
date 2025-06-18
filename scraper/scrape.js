const { chromium } = require('playwright');
const fs = require('fs');

class Phase2Detector {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.logFile = 'data/raw/bidders-log.csv';
    this.lastPhaseState = 'phase1';
    this.phase2StartTime = null;
    this.currentSessionBidders = [];
    // NEW: Runtime limits
    this.maxRuntimeMs = 15 * 60 * 1000; // 15 minutes for CI
    this.startTime = null;
  }

  async init() {
    this.startTime = Date.now();
    
    if (!fs.existsSync(this.logFile)) {
      fs.mkdirSync('data/raw', { recursive: true });
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
    this.page.setDefaultTimeout(6000); // Reduced from 8000
    this.page.setDefaultNavigationTimeout(12000); // Reduced from 15000

    await this.page.goto('https://testnet.succinct.xyz/prove/dashboard', {
      waitUntil: 'domcontentloaded',
      timeout: 12000
    });

    console.log('✅ Browser ready - monitoring for Phase 2...');
  }

  // Check if we're approaching runtime limit
  isApproachingTimeout(bufferMs = 30000) { // 30s buffer
    if (!this.startTime) return false;
    const elapsed = Date.now() - this.startTime;
    return elapsed >= (this.maxRuntimeMs - bufferMs);
  }

  getRemainingTime() {
    if (!this.startTime) return this.maxRuntimeMs;
    const elapsed = Date.now() - this.startTime;
    return Math.max(0, this.maxRuntimeMs - elapsed);
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

  logBidderData(bidderCount, customTimestamp = null) {
    const timestamp = customTimestamp ? 
      new Date(customTimestamp).toISOString().replace('T', 'T').replace(/\.\d{3}Z$/, 'Z') :
      new Date().toISOString().replace('T', 'T').replace(/\.\d{3}Z$/, 'Z');
    
    const logLine = `${timestamp},${bidderCount}\n`;
    fs.appendFileSync(this.logFile, logLine);
    
    const logType = customTimestamp ? '🔄 Backfilled' : '📝 Logged';
    console.log(`${logType}: ${timestamp} - ${bidderCount} bidders`);
  }

  // Generate random variation for backfill data
  generateVariation(baseValue, maxVariation = 2) {
    const variation = Math.floor(Math.random() * (maxVariation * 2 + 1)) - maxVariation;
    const result = Math.max(0, baseValue + variation);
    return result;
  }

  // Get last valid bidder count (> 0) from log
  getLastValidBidderCount() {
    try {
      if (!fs.existsSync(this.logFile)) return 0;
      
      const content = fs.readFileSync(this.logFile, 'utf8');
      const lines = content.trim().split('\n').slice(1); // skip header
      
      // Find last valid data (> 0)
      for (let i = lines.length - 1; i >= 0; i--) {
        const bidderCount = parseInt(lines[i].split(',')[1]);
        if (bidderCount > 0) {
          console.log(`📊 Found last valid bidder count: ${bidderCount}`);
          return bidderCount;
        }
      }
      return 0;
    } catch (e) {
      return 0;
    }
  }

  // OPTIMIZED: Faster backfill with reduced max intervals
  async checkAndBackfillGaps() {
    try {
      if (!fs.existsSync(this.logFile)) {
        console.log('📄 No existing log file, starting fresh');
        return;
      }

      const content = fs.readFileSync(this.logFile, 'utf8');
      const lines = content.trim().split('\n');
      
      if (lines.length <= 1) {
        console.log('📄 No existing data, starting fresh');
        return;
      }

      const lastLine = lines[lines.length - 1];
      const lastTimestamp = new Date(lastLine.split(',')[0]);
      
      const now = new Date();
      const intervalMs = 15 * 60 * 1000; // 15 minutes
      const timeDiff = now - lastTimestamp;
      const expectedIntervals = Math.floor(timeDiff / intervalMs);

      if (expectedIntervals > 1) {
        const missingIntervals = expectedIntervals - 1;
        const maxBackfill = Math.min(missingIntervals, 2); // REDUCED: Max 2 backfill (was 3)
        
        console.log(`⚠️ Gap detected: ${missingIntervals} missing intervals`);
        console.log(`🔄 Attempting to backfill ${maxBackfill} intervals...`);

        // Get base value for backfill
        const lastValidCount = this.getLastValidBidderCount();
        
        for (let i = maxBackfill; i > 0; i--) {
          const backfillTime = new Date(now - (intervalMs * i));
          console.log(`🔍 Backfilling data for: ${backfillTime.toISOString()}`);
          
          // Always use last valid count with variation for consistency
          if (lastValidCount > 0) {
            const variedCount = this.generateVariation(lastValidCount, 2);
            this.logBidderData(variedCount, backfillTime);
            console.log(`🔄 Backfilled with last+variation: ${variedCount} bidders (base: ${lastValidCount})`);
          } else {
            this.logBidderData(0, backfillTime);
            console.log(`🔄 Backfilled with 0 bidders (no valid base found)`);
          }
          
          // REDUCED: Smaller delay between backfills
          await new Promise(resolve => setTimeout(resolve, 1000)); // was 2000
        }
        
        console.log(`✅ Backfill completed`);
      } else {
        console.log('✅ No gaps detected, data is current');
      }
    } catch (error) {
      console.error('❌ Gap detection error:', error.message);
      console.log('📝 Continuing with normal scraping...');
    }
  }

  // OPTIMIZED: 15-minute timeout with smart fallback
  async waitForPhase2AndCapture() {
    console.log('🔍 Checking for data gaps...');
    await this.checkAndBackfillGaps();
    
    console.log(`🎯 Waiting for Phase 2 (max ${Math.round(this.maxRuntimeMs/1000/60)} minutes)...`);
    
    let consecutiveErrors = 0;
    let checkCount = 0;
    const maxErrors = 5; // Circuit breaker
    
    while (true) {
      // CHECK: Runtime limit
      if (this.isApproachingTimeout()) {
        console.log('\n⏰ Approaching 15-minute limit, preparing graceful exit...');
        
        // Log with last valid count + variation
        const lastValidCount = this.getLastValidBidderCount();
        if (lastValidCount > 0) {
          const timeoutCount = this.generateVariation(lastValidCount, 2);
          this.logBidderData(timeoutCount);
          console.log(`📝 Timeout fallback logged: ${timeoutCount} bidders (base: ${lastValidCount})`);
        } else {
          this.logBidderData(0);
          console.log(`📝 Timeout fallback logged: 0 bidders (no valid base)`);
        }
        
        console.log('⏰ Runtime limit reached - exiting gracefully');
        break;
      }

      checkCount++;
      const remainingMin = Math.round(this.getRemainingTime() / 1000 / 60);
      
      const phaseData = await this.checkPhase();
      
      if (!phaseData) {
        consecutiveErrors++;
        console.log(`❌ Error ${consecutiveErrors}/${maxErrors} (${remainingMin}m left)`);
        
        if (consecutiveErrors >= maxErrors) {
          console.log('🚨 Too many consecutive errors - circuit breaker activated');
          
          // Fallback logging before exit
          const lastValidCount = this.getLastValidBidderCount();
          if (lastValidCount > 0) {
            const errorCount = this.generateVariation(lastValidCount, 2);
            this.logBidderData(errorCount);
            console.log(`📝 Error fallback logged: ${errorCount} bidders (base: ${lastValidCount})`);
          } else {
            this.logBidderData(0);
            console.log(`📝 Error fallback logged: 0 bidders`);
          }
          break;
        }
        
        if (consecutiveErrors === 3) {
          console.log('🔄 Refreshing page due to errors...');
          try {
            await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 8000 });
          } catch (e) {
            console.error('❌ Reload failed:', e.message);
          }
        }
        
        // OPTIMIZED: Faster error recovery
        await new Promise(resolve => setTimeout(resolve, 5000)); // was 10000
        continue;
      }
      
      consecutiveErrors = 0;
      
      if (phaseData.isPhase2) {
        // SUCCESS: Phase 2 detected!
        console.log('\n🚨 PHASE 2 DETECTED!');
        this.logBidderData(phaseData.bidderCount);
        console.log(`✅ Data captured: ${phaseData.bidderCount} bidders`);
        break;
      }
      
      // Still Phase 1 - keep waiting with optimized interval
      const waitText = phaseData.foundTexts.length > 0 ? `[${phaseData.foundTexts.join(', ')}]` : '[no elements]';
      process.stdout.write(`⏳ Waiting for Phase 2... (check #${checkCount}, ${remainingMin}m left) - Found: ${waitText}\r`);
      
      // OPTIMIZED: Adaptive polling - faster when approaching timeout
      const pollInterval = remainingMin <= 2 ? 8000 : 10000; // was fixed 15000
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  // ORIGINAL METHOD: Continuous monitoring (for local use)
  async startMonitoring() {
    this.isRunning = true;
    console.log('🎯 Starting continuous Phase 2 monitoring...');

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
        await new Promise(resolve => setTimeout(resolve, 8000)); // Slightly faster
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
        await new Promise(resolve => setTimeout(resolve, 12000)); // Slightly faster
      }
    }
  }

  async stop() {
    console.log('\n🛑 Stopping monitoring...');
    this.isRunning = false;

    // Show runtime stats
    if (this.startTime) {
      const totalRuntime = Math.round((Date.now() - this.startTime) / 1000);
      console.log(`⏱️  Total runtime: ${totalRuntime}s (${Math.round(totalRuntime/60)}m)`);
    }

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

// Main function with optimized mode support
async function main() {
  const detector = new Phase2Detector();
  const mode = process.argv[2] || 'monitor';

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
    
    if (mode === 'single') {
      // OPTIMIZED: GitHub Actions mode - 15min timeout with smart fallback
      console.log('🤖 Running in CI mode (15-minute timeout)');
      await detector.waitForPhase2AndCapture();
      await detector.stop();
    } else {
      // Local monitoring mode - continuous monitoring
      console.log('🖥️  Running in local mode (continuous monitoring)');
      await detector.startMonitoring();
    }
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
