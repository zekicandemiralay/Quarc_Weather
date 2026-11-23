// Renews the database's epoch. restore.sh runs this after restoring a backup, so that every device notices the
// server's data was replaced and re-sends what it holds (see getEpoch in ../db.js for why that is needed).
//
//   docker compose exec -T backend node src/scripts/new-epoch.js
const { initDb, newEpoch } = require('../db');

initDb();
console.log(`New epoch: ${newEpoch()}`);
