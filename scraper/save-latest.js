const fs = require('fs');
const path = require('path');

function saveLatestToJSON() {
  const csvPath = path.join(__dirname, '../data/raw/bidders-log.csv');
  const jsonPath = path.join(__dirname, '../data/processed/latest.json');

  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV log file not found:', csvPath);
    return;
  }

  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const lastLine = lines[lines.length - 1];

  const [timestamp, bidderCount] = lastLine.split(',');

  const latestData = {
    timestamp,
    bidders: parseInt(bidderCount, 10)
  };

  fs.writeFileSync(jsonPath, JSON.stringify(latestData, null, 2));
  console.log(`✅ Saved latest.json: ${JSON.stringify(latestData)}`);
}

saveLatestToJSON();
