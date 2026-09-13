/**
 * Run BuddySite schema against DATABASE_URL (Render Postgres).
 * Usage: node scripts/migrate.js
 * Safe to run multiple times (IF NOT EXISTS).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Add it from your Render Postgres service.');
    process.exit(1);
  }
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
  });
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('BuddySite schema applied successfully.');
  await pool.end();
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
