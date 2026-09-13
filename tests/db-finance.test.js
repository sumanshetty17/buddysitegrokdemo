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
  const { site } = await makeStore('pro');
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
  const { site } = await makeStore('grow');
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });
  await db.updateOrderStatus(site.id, order.id, 'refunded');

  const summary = await db.getFinanceSummary(site.id);
  const entry = summary.ledger.find(r => r.order_id === order.id);
  assert.equal(entry.orderRefundedAmount, 1000);
  assert.equal(entry.netCommission, 0);
  assert.equal(summary.refunds, 1000);
  assert.equal(summary.netPayout, 0, 'a fully refunded order should contribute nothing to net payout');
  assert.equal(summary.grossSales, 1000);
});

test('reactivating a cancelled order restores its commission instead of leaving it reversed forever', async () => {
  const { site } = await makeStore('pro');
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });
  await db.updateOrderStatus(site.id, order.id, 'cancelled');
  await db.updateOrderStatus(site.id, order.id, 'new');

  const summary = await db.getFinanceSummary(site.id);
  const entry = summary.ledger.find(r => r.order_id === order.id);
  assert.equal(entry.excludedAsCancelled, false);
  assert.equal(entry.netCommission, 50);
});

test('online net is withdrawable; COD commission is deducted and both commissions stay', async () => {
  const { site } = await makeStore('pro');
  await db.addOrder(site.id, { customerName: 'Online', paymentMethod: 'UPI', items: [], total: 1000, subtotal: 1000 });
  await db.addOrder(site.id, { customerName: 'Cod', paymentMethod: 'COD', items: [], total: 1000, subtotal: 1000 });
  const summary = await db.getFinanceSummary(site.id);
  assert.equal(summary.wallet.onlineReceived, 1000);
  assert.equal(summary.wallet.onlineCommission, 50);
  assert.equal(summary.wallet.onlineNet, 950);
  assert.equal(summary.wallet.codCommissionDue, 50);
  assert.equal(summary.wallet.availableToWithdraw, 900, '950 online net minus 50 COD commission');
  const bank = await db.savePayoutBank(site.id, { accountName: 'Seller', accountNumber: '1234567890', ifsc: 'HDFC0001234' });
  assert.equal(bank.ifsc, 'HDFC0001234');
  const tooMuch = await db.requestWithdrawal(site.id, 901);
  assert.ok(tooMuch.error);
  const ok = await db.requestWithdrawal(site.id, 900);
  assert.equal(ok.withdrawal.amount, 900);
  assert.equal(ok.wallet.availableToWithdraw, 0);
  assert.equal(ok.withdrawal.codCommissionHeld, 50);
  assert.equal(ok.withdrawal.onlineCommissionHeld, 50);
});
