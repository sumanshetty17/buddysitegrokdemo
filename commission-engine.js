// Commission engine
// -----------------
// Implements the BuddySite platform/transaction commission described in the
// "BuddySite -- Final Pricing & Transaction Commission Specification" (v2.0,
// 26 Aug 2026). This is a BuddySite PLATFORM COMMISSION. It is not GST, is
// never labelled as GST, and does not replace any tax the seller may owe.
//
// Ground rules enforced here (see spec sections 3, 10, 11, 12):
//  - Commission is calculated on the merchandise subtotal, after
//    product-level discounts, and before payment-provider fees.
//  - Shipping is excluded from the commission base unless explicitly enabled.
//  - Commission is always calculated server-side (this file is only ever
//    required from server.js, never shipped to the browser).
//  - Money is handled in integer paise internally to avoid floating-point
//    rounding bugs, then converted back to rupees for storage/display
//    (product prices in this codebase are stored in rupees).
//  - Every commission calculation produces an immutable ledger record. The
//    rate used is stored on the record itself, so changing a seller's plan
//    later never rewrites historical commission.
//  - Refunds/cancellations reverse or proportionally adjust the ledger
//    record; they never mutate the original commission_amount.

const { commissionRateForPlan } = require('./plans');

function toPaise(rupees) {
  return Math.round((Number(rupees) || 0) * 100);
}
function toRupees(paise) {
  return Math.round(paise) / 100;
}

/**
 * Compute the commission for a new order.
 * @param {Object} opts
 * @param {number} opts.subtotal - merchandise subtotal in rupees, BEFORE discount
 * @param {number} opts.discount - product/coupon discount in rupees
 * @param {number} opts.shipping - shipping charged, in rupees (excluded from
 *   the commission base unless includeShippingInCommission is true)
 * @param {string} opts.planKey - seller's plan key AT THE TIME of the order
 * @param {boolean} [opts.includeShippingInCommission] - default false
 * @returns {{ rate:number, base_paise:number, base:number, commission_paise:number, commission:number }}
 */
function calculateCommission({ subtotal, discount = 0, shipping = 0, planKey, includeShippingInCommission = false }) {
  const rate = commissionRateForPlan(planKey);
  const subtotalPaise = toPaise(subtotal);
  const discountPaise = toPaise(discount);
  const shippingPaise = includeShippingInCommission ? toPaise(shipping) : 0;

  const basePaise = Math.max(0, subtotalPaise - discountPaise) + shippingPaise;
  const commissionPaise = Math.round(basePaise * rate);

  return {
    rate,
    base_paise: basePaise,
    base: toRupees(basePaise),
    commission_paise: commissionPaise,
    commission: toRupees(commissionPaise)
  };
}

/**
 * Build a new, immutable commission ledger record for an order. The plan and
 * rate are frozen onto the record so later plan changes never alter it.
 */
function buildLedgerRecord({ id, order_id, store_id, seller_id, planKey, subtotal, discount = 0, shipping = 0, currency = 'INR' }) {
  const calc = calculateCommission({ subtotal, discount, shipping, planKey });
  return {
    commission_id: id,
    order_id,
    store_id,
    seller_id,
    plan_at_transaction: planKey,
    commission_rate_at_transaction: calc.rate,
    commission_base_amount: calc.base,
    commission_amount: calc.commission,
    currency,
    payment_provider_fee: null, // populated once a marketplace payment provider is wired in
    seller_payout_amount: toRupees(Math.max(0, calc.base_paise - calc.commission_paise)),
    status: 'pending', // pending | settled | reversed | partially_reversed
    refund_adjustment_amount: 0,
    created_at: new Date().toISOString(),
    settled_at: null
  };
}

/**
 * Fully reverse a ledger record (order cancelled before settlement, or a
 * full refund). Never edits commission_amount -- records the reversal as an
 * adjustment so the original calculation stays intact for audit purposes.
 */
function reverseLedgerRecord(record) {
  if (!record || record.status === 'reversed') return record;
  record.refund_adjustment_amount = -record.commission_amount;
  record.status = 'reversed';
  return record;
}

/**
 * Apply a proportional commission adjustment for a partial refund.
 * @param {Object} record - the ledger record to adjust
 * @param {number} refundAmount - amount refunded to the customer, in rupees
 * @param {number} orderTotal - the order's original commissionable total, in rupees
 */
function applyPartialRefund(record, refundAmount, orderTotal) {
  if (!record || !orderTotal || orderTotal <= 0) return record;
  const refundPaise = toPaise(refundAmount);
  const totalPaise = toPaise(orderTotal);
  const commissionPaise = toPaise(record.commission_amount);

  const proportion = Math.min(1, Math.max(0, refundPaise / totalPaise));
  const adjustmentPaise = -Math.round(commissionPaise * proportion);

  record.refund_adjustment_amount = toRupees(adjustmentPaise);
  record.status = proportion >= 1 ? 'reversed' : 'partially_reversed';
  return record;
}

/** Net commission actually owed to BuddySite after any refund adjustment. */
function netCommission(record) {
  return toRupees(toPaise(record.commission_amount) + toPaise(record.refund_adjustment_amount || 0));
}

module.exports = {
  toPaise, toRupees,
  calculateCommission, buildLedgerRecord, reverseLedgerRecord, applyPartialRefund, netCommission
};
