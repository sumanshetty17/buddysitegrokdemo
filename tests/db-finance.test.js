// Integration tests for db.js's order / commission / refund / finance
// logic. Unlike tests/commission-engine.test.js (pure math), these exercise
// the actual file-backed data layer, including cross-order aggregation in
// getFinanceSummary() -- which is where several real bugs were found and
// fixed (cancelled orders being counted as sales, net payout not
// accounting for refunds, the two different "mark as refunded" code paths
// disagreeing with each other).
//
// Run with: npm test  (runs every *.test.js file under tests/)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Point db.js at a throwaway file BEFORE requiring it, so these tests never
// touch a real seller's data.json.
const TMP_DB = path.join(os.tmpdir(), `buddysite-test-${process.pid}-${Date.now()}.json`);
process.env.BUDDYSITE_DB_FILE = TMP_DB;
const db = require('../db');

test.after(() => { try { fs.unlinkSync(TMP_DB); } catch (_) {} });

async function makeStore(planKey) {
  const user = await db.createUser({ name: 'Seller', email: `seller-${Date.now()}-${Math.random()}@test.com`, password_hash: 'x' });
  await db.updateUserPlan(user.id, planKey, null);
  const site = await db.createSite({ user_id: user.id, slug: `store-${user.id}-${Math.random().toString(36).slice(2)}`, store_name: 'Store' });
  return { user, site };
}

test('a cancelled order is excluded from every Finance total, but a normal order is not', async () => {
  const { site } = await makeStore('pro'); // 5%
  const cancelled = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });
  await db.updateOrderStatus(site.id, cancelled.id, 'cancelled');
  await db.addOrder(site.id, { customerName: 'B', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });

  const summary = await db.getFinanceSummary(site.id);
  assert.equal(summary.grossSales, 1000, 'only the non-cancelled order should count');
  assert.equal(summary.commission, 50, 'only the non-cancelled order should be charged commission');
  assert.equal(summary.netPayout, 950);
  const cancelledEntry = summary.ledger.find(r => r.order_id === cancelled.id);
  assert.equal(cancelledEntry.excludedAsCancelled, true);
  assert.equal(cancelledEntry.netCommission, 0);
});

test('cancelling never sets refunded_amount (no money was ever collected)', async () => {
  const { site } = await makeStore('starter');
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [], total: 500, subtotal: 500 });
  await db.updateOrderStatus(site.id, order.id, 'cancelled');
  const orders = await db.getOrders(site.id);
  const updated = orders.find(o => o.id === order.id);
  assert.equal(updated.refunded_amount || 0, 0);
});

test('a direct full-refund status change (not the /refund endpoint) records the full amount as refunded, same as the dedicated refund path', async () => {
  const { site } = await makeStore('grow'); // 3.5%
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });
  await db.updateOrderStatus(site.id, order.id, 'refunded');

  const summary = await db.getFinanceSummary(site.id);
  const entry = summary.ledger.find(r => r.order_id === order.id);
  assert.equal(entry.orderRefundedAmount, 1000);
  assert.equal(entry.netCommission, 0);
  assert.equal(summary.refunds, 1000);
  assert.equal(summary.netPayout, 0, 'a fully refunded order should contribute nothing to net payout');
  // gross sales still reflects that a real sale happened before the refund
  assert.equal(summary.grossSales, 1000);
});

test('reactivating a cancelled order restores its commission instead of leaving it reversed forever', async () => {
  const { site } = await makeStore('pro');
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });
  await db.updateOrderStatus(site.id, order.id, 'cancelled');
  await db.updateOrderStatus(site.id, order.id, 'new'); // seller un-cancels it

  const summary = await db.getFinanceSummary(site.id);
  const entry = summary.ledger.find(r => r.order_id === order.id);
  assert.equal(entry.excludedAsCancelled, false);
  assert.equal(entry.netCommission, 50);
  assert.equal(summary.commission, 50);
});

test('a partial refund correctly reduces net payout by BOTH the refunded amount and the adjusted commission', async () => {
  const { site } = await makeStore('pro'); // 5%, commission on 1000 = 50
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });
  const result = await db.refundOrderPartial(site.id, order.id, 400); // 40% refunded
  assert.ok(!result.error, JSON.stringify(result));

  const summary = await db.getFinanceSummary(site.id);
  const entry = summary.ledger.find(r => r.order_id === order.id);
  assert.equal(entry.netCommission, 30); // 5% of the remaining 600
  assert.equal(summary.refunds, 400);
  assert.equal(summary.netPayout, 1000 - 400 - 30); // 570
});

test('an over-refund is rejected AND leaves the ledger/order completely unchanged', async () => {
  const { site } = await makeStore('grow');
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });
  const before = await db.getFinanceSummary(site.id);

  const result = await db.refundOrderPartial(site.id, order.id, 5000);
  assert.ok(result.error, 'an over-refund must be rejected');

  const after = await db.getFinanceSummary(site.id);
  assert.deepEqual(after, before, 'a rejected refund must not mutate any data');
});

test('a cancelled order cannot be refunded (nothing was ever collected)', async () => {
  const { site } = await makeStore('free');
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });
  await db.updateOrderStatus(site.id, order.id, 'cancelled');
  const result = await db.refundOrderPartial(site.id, order.id, 100);
  assert.ok(result.error);
});

test('repeated partial refunds on the same order accumulate correctly and can never exceed the order total', async () => {
  const { site } = await makeStore('pro');
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });
  assert.ok(!await db.refundOrderPartial(site.id, order.id, 300).error);
  assert.ok(!await db.refundOrderPartial(site.id, order.id, 300).error);
  const third = await db.refundOrderPartial(site.id, order.id, 500); // 300+300+500 = 1100 > 1000
  assert.ok(third.error, 'cumulative refunds must not be allowed to exceed the order total');

  const summary = await db.getFinanceSummary(site.id);
  assert.equal(summary.refunds, 600, 'only the two successful refunds should be recorded');
});

test('a later plan change never rewrites a past order\'s commission rate', async () => {
  const { site, user } = await makeStore('free'); // 2%
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });
  let summary = await db.getFinanceSummary(site.id);
  assert.equal(summary.commission, 20);

  await db.updateUserPlan(user.id, 'pro', null); // seller upgrades to 5%
  summary = await db.getFinanceSummary(site.id);
  assert.equal(summary.commission, 20, 'the historical order must keep its original 2% rate');

  const newOrder = await db.addOrder(site.id, { customerName: 'B', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });
  summary = await db.getFinanceSummary(site.id);
  assert.equal(summary.commission, 20 + 50, 'the new order should use the new 5% rate');
});
