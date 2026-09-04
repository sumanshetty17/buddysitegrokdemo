/**
 * BuddySite data layer entry point.
 *
 * - If DATABASE_URL is set (Render Postgres) → use db-pg.js (scales for many sellers/customers)
 * - Otherwise → use db-json.js (single-file, fine for local/dev/tests)
 *
 * All exported functions are async. Callers should always `await` them.
 * (await works on both Promises and plain values.)
 */
if (process.env.DATABASE_URL) {
  module.exports = require('./db-pg');
} else {
  const json = require('./db-json');
  const wrapped = {};
  for (const [key, val] of Object.entries(json)) {
    if (typeof val === 'function') {
      wrapped[key] = async function (...args) {
        return val.apply(this, args);
      };
    } else {
      wrapped[key] = val;
    }
  }
  module.exports = wrapped;
}
