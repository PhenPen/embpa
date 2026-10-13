const Database = require('better-sqlite3');
const db = new Database('invoices.db');

// --- Users table ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// --- Invoices table ---
db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY,
    customer TEXT NOT NULL,
    amount INTEGER NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0
  )
`);

// --- Migration: add payment_intent_id to invoices ---
const invoiceCols = db.prepare('PRAGMA table_info(invoices)').all();
if (!invoiceCols.some((c) => c.name === 'payment_intent_id')) {
  db.exec('ALTER TABLE invoices ADD COLUMN payment_intent_id TEXT');
  console.log('Migration: added payment_intent_id column.');
}

// --- Migration: add user_id to invoices ---
if (!invoiceCols.some((c) => c.name === 'user_id')) {
  db.exec('ALTER TABLE invoices ADD COLUMN user_id INTEGER REFERENCES users(id)');
  console.log('Migration: added user_id column.');
}

// --- Migration: remove orphan invoices from the pre-auth era ---
const orphans = db
  .prepare('SELECT COUNT(*) as c FROM invoices WHERE user_id IS NULL')
  .get();
if (orphans.c > 0) {
  db.prepare('DELETE FROM invoices WHERE user_id IS NULL').run();
  console.log(`Migration: removed ${orphans.c} orphan invoice(s).`);
}

console.log('Database ready.');

module.exports = db;
