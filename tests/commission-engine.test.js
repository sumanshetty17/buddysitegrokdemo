// Automated tests for commission-engine.js, covering the acceptance
// criteria in "BuddySite -- Final Pricing & Transaction Commission
// Specification" (v2.0), section 12.
//
// Run with: npm test   (or: node --test tests/)
// Requires Node 18+ (uses the built-in node:test runner -- no extra
// dependency to install).

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateCommission, buildLedgerRecord, reverseLedgerRecord,
  applyPartialRefund, netCommission
} = require('../commission-engine');

test('commission percentages -- ₹1,000 order, one per plan (spec section 12)', () => {
  assert.equal(calculateCommission({ subtotal: 1000, planKey: 'free' }).commission, 20);
  assert.equal(calculateCommission({ subtotal: 1000, planKey: 'starter' }).commission, 20);
  assert.equal(calculateCommission({ subtotal: 1000, planKey: 'grow' }).commission, 35);
  assert.equal(calculateCommission({ subtotal: 1000, planKey: 'pro' }).commission, 50);
});

test('unknown/missing plan key falls back to the free rate, never zero or undefined', () => {
  const c = calculateCommission({ subtotal: 1000, planKey: 'not-a-real-plan' });
  assert.equal(c.rate, 0.02);
  assert.equal(c.commission, 20);
});

test('commission is calculated on subtotal AFTER discount', () => {
  const c = calculateCommission({ subtotal: 1000, discount: 200, planKey: 'grow' }); // base = 800
  assert.equal(c.base, 800);
  assert.equal(c.commission, 28); // 3.5% of 800
});

test('shipping is excluded from the commission base by default', () => {
  const c = calculateCommission({ subtotal: 1000, shipping: 100, planKey: 'pro' });
  assert.equal(c.base, 1000); // shipping NOT added
  assert.equal(c.commission, 50);
});

test('shipping is included only when explicitly enabled', () => {
  const c = calculateCommission({ subtotal: 1000, shipping: 100, planKey: 'pro', includeShippingInCommission: true });
  assert.equal(c.base, 1100);
  assert.equal(c.commission, 55);
});

test('a ledger record freezes the plan and rate used at transaction time', () => {
  const record = buildLedgerRecord({ id: 1, order_id: 101, store_id: 5, seller_id: 9, planKey: 'grow', subtotal: 1000 });
  assert.equal(record.plan_at_transaction, 'grow');
  assert.equal(record.commission_rate_at_transaction, 0.035);
  assert.equal(record.commission_amount, 35);
  assert.equal(record.status, 'pending');
  // A later plan change must never mutate an already-built record.
  const before = JSON.stringify(record);
  buildLedgerRecord({ id: 2, order_id: 102, store_id: 5, seller_id: 9, planKey: 'pro', subtotal: 1000 });
  assert.equal(JSON.stringify(record), before);
});

test('a full reversal (cancel or full refund) zeroes out the net commission owed, without editing the original amount', () => {
  const record = buildLedgerRecord({ id: 3, order_id: 103, store_id: 5, seller_id: 9, planKey: 'pro', subtotal: 1000 });
  reverseLedgerRecord(record);
  assert.equal(record.status, 'reversed');
  assert.equal(record.commission_amount, 50); // original figure preserved for audit
  assert.equal(record.refund_adjustment_amount, -50);
  assert.equal(netCommission(record), 0);
});

test('a partial refund creates a proportional commission adjustment', () => {
  const record = buildLedgerRecord({ id: 4, order_id: 104, store_id: 5, seller_id: 9, planKey: 'pro', subtotal: 1000 }); // commission = 50
  applyPartialRefund(record, 250, 1000); // 25% refunded
  assert.equal(record.status, 'partially_reversed');
  assert.equal(record.refund_adjustment_amount, -12.5);
  assert.equal(netCommission(record), 37.5);
});

test('a 100% partial refund behaves the same as a full reversal', () => {
  const record = buildLedgerRecord({ id: 5, order_id: 105, store_id: 5, seller_id: 9, planKey: 'grow', subtotal: 1000 });
  applyPartialRefund(record, 1000, 1000);
  assert.equal(record.status, 'reversed');
  assert.equal(netCommission(record), 0);
});

test('refund amounts are clamped -- an over-refund never produces a negative net commission owed to the seller', () => {
  const record = buildLedgerRecord({ id: 6, order_id: 106, store_id: 5, seller_id: 9, planKey: 'grow', subtotal: 1000 });
  applyPartialRefund(record, 5000, 1000); // absurd refund amount
  assert.equal(record.status, 'reversed');
  assert.equal(netCommission(record), 0);
});

test('money math avoids floating-point drift on an awkward subtotal', () => {
  const c = calculateCommission({ subtotal: 33.33, planKey: 'grow' }); // 3.5% of 33.33
  // Computed in integer paise (3333 * 0.035 = 116.655 -> rounds to 117 paise = ₹1.17)
  assert.equal(c.commission, 1.17);
});

test('repeated partial refunds recompute the adjustment from the cumulative refunded amount, not just the latest increment', () => {
  // db.refundOrderPartial always calls applyPartialRefund with the RUNNING
  // total refunded so far -- this guards that contract, since
  // applyPartialRefund SETS refund_adjustment_amount rather than adding to
  // it, so passing only the latest increment would silently understate the
  // adjustment on a second or third partial refund.
  const record = buildLedgerRecord({ id: 7, order_id: 107, store_id: 5, seller_id: 9, planKey: 'pro', subtotal: 1000 }); // commission = 50
  applyPartialRefund(record, 300, 1000);   // first refund: 30% refunded so far
  assert.equal(record.refund_adjustment_amount, -15);
  applyPartialRefund(record, 300 + 200, 1000); // second refund: 50% refunded cumulatively
  assert.equal(record.refund_adjustment_amount, -25);
  assert.equal(netCommission(record), 25);
});
