const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DB = path.join(os.tmpdir(), `buddysite-test-colors-${process.pid}-${Date.now()}.json`);
process.env.BUDDYSITE_DB_FILE = TMP_DB;
const db = require('../db');

test.after(() => { try { fs.unlinkSync(TMP_DB); } catch (_) {} });

function makeSite() {
  const user = db.createUser({ name: 'S', email: `s-${Date.now()}-${Math.random()}@test.com`, password_hash: 'x' });
  return db.createSite({ user_id: user.id, slug: `store-${Math.random().toString(36).slice(2)}`, store_name: 'Store' });
}

test('a valid 6-digit hex color is accepted', () => {
  const site = makeSite();
  const result = db.updateSiteColors(site.id, { accent: '#FF6A88' });
  assert.ok(!result.error);
  assert.equal(result.site.customColors.accent, '#FF6A88');
});

test('a valid 3-digit hex color is accepted', () => {
  const site = makeSite();
  const result = db.updateSiteColors(site.id, { accent: '#F6A' });
  assert.ok(!result.error);
});

test('a non-hex value is rejected -- this is the XSS-prevention boundary', () => {
  const site = makeSite();
  const attempts = [
    'red', // named colors not allowed -- keeps the validation surface tiny and unambiguous
    'javascript:alert(1)',
    '"><script>alert(1)</script>',
    '#FF6A88; background-image:url(evil)',
    'rgb(255,0,0)',
    '#GGGGGG', // not valid hex digits
    '#12345' // wrong length
  ];
  attempts.forEach(bad => {
    const result = db.updateSiteColors(site.id, { accent: bad });
    assert.ok(result.error, `expected "${bad}" to be rejected`);
  });
});

test('an unrecognized field name is silently ignored, not stored', () => {
  const site = makeSite();
  const result = db.updateSiteColors(site.id, { evilField: '<script>alert(1)</script>' });
  assert.ok(!result.error);
  assert.equal(result.site.customColors.evilField, undefined);
});

test('passing an empty string clears a previously-set override back to the theme default', () => {
  const site = makeSite();
  db.updateSiteColors(site.id, { accent: '#FF6A88' });
  const result = db.updateSiteColors(site.id, { accent: '' });
  assert.ok(!result.error);
  assert.equal(result.site.customColors.accent, undefined);
});

test('a fresh site has no color overrides -- theme presets render exactly as before this feature existed', () => {
  const site = makeSite();
  assert.deepEqual(site.customColors, {});
});

test('one invalid field in a multi-field request rejects the whole request -- no partial writes', () => {
  const site = makeSite();
  const result = db.updateSiteColors(site.id, { accent: '#FF6A88', btnBg: 'not-a-color' });
  assert.ok(result.error);
  const fresh = db.getSiteById(site.id);
  assert.equal(fresh.customColors.accent, undefined, 'the valid field must not be saved if another field in the same request is invalid');
});
