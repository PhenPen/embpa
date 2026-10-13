const Database = require('better-sqlite3');
const db = new Database('invoices.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY,
    customer TEXT NOT NULL,
    amount INTEGER NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0
  )
`);

// Migration: add payment_intent_id column if it doesn't exist
const columns = db.prepare('PRAGMA table_info(invoices)').all();
const hasColumn = columns.some((col) => col.name === 'payment_intent_id');
if (!hasColumn) {
  db.exec('ALTER TABLE invoices ADD COLUMN payment_intent_id TEXT');
  console.log('Migration: added payment_intent_id column.');
}

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
