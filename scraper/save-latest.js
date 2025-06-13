const fs = require('fs');
const path = require('path');

function saveAllCSVtoJSON() {
  const csvPath = path.join(__dirname, '../data/raw/bidders-log.csv');
  const jsonPath = path.join(__dirname, '../data/processed/latest.json');

  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV log file not found:', csvPath);
    return;
  }

  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');

  // Skip header
  const dataLines = lines.slice(1);

  const result = dataLines
    .map(line => {
      const [timestamp, bidderCount] = line.split(',');
      return {
        timestamp,
        bidders: parseInt(bidderCount, 10)
      };
    })
    .filter(entry => !isNaN(entry.bidders)); // remove any broken entries

  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  console.log(`✅ Saved ${result.length} entries to latest.json`);
}

saveAllCSVtoJSON();
