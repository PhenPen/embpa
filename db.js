const Database = require('better-sqlite3');
const db = new Database('invoices.db');

// Create the table if it doesn't exist yet
db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY,
    customer TEXT NOT NULL,
    amount INTEGER NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0
  )
`);

// Seed with sample data ONLY if the table is empty
const count = db.prepare('SELECT COUNT(*) as count FROM invoices').get();
if (count.count === 0) {
  const seed = db.prepare(
    'INSERT INTO invoices (customer, amount, paid) VALUES (?, ?, ?)'
  );
  seed.run('Acme Supplies', 2000, 0);
  seed.run('BuildCo', 1500, 0);
  seed.run('Steel Works', 3200, 0);
  console.log('Seeded database with sample invoices.');
}

console.log('Database ready.');

module.exports = db;
