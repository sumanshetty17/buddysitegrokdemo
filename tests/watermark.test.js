const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DB = path.join(os.tmpdir(), `buddysite-wm-${process.pid}-${Date.now()}.json`);
process.env.BUDDYSITE_DB_FILE = TMP_DB;
const { PLANS, watermarkPricePaise, isWatermarkHidden, canUseHomepageBuilder } = require('../plans');
const db = require('../db');

test.after(() => { try { fs.unlinkSync(TMP_DB); } catch (_) {} });

test('product limits and homepage builder flags', () => {
  assert.equal(PLANS.free.max_products, 20);
  assert.equal(PLANS.starter.max_products, 100);
  assert.equal(PLANS.grow.max_products, 1000);
  assert.equal(canUseHomepageBuilder(PLANS.free), false);
  assert.equal(canUseHomepageBuilder(PLANS.starter), false);
  assert.equal(canUseHomepageBuilder(PLANS.grow), true);
  assert.equal(canUseHomepageBuilder(PLANS.pro), true);
  assert.equal(PLANS.free.watermark, true);
  assert.equal(PLANS.pro.watermark, true);
});

test('first watermark removal is ₹299, later ₹599, lasts 6 months', async () => {
  const user = await db.createUser({ name: 'S', email: `wm-${Date.now()}@t.com`, password_hash: 'x' });
  assert.equal(watermarkPricePaise(0), 29900);
  assert.equal(isWatermarkHidden(user), false);
  const after = await db.applyWatermarkAddon(user.id);
  assert.equal(after.watermark_purchases, 1);
  assert.equal(watermarkPricePaise(after.watermark_purchases), 59900);
  assert.equal(isWatermarkHidden(after), true);
  const until = new Date(after.watermark_until);
  const min = new Date(); min.setMonth(min.getMonth() + 5);
  assert.ok(until > min, 'should last about 6 months');
});
