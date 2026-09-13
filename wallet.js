/**
 * Seller wallet: online money sits at BuddySite; commission is never withdrawn.
 * COD cash stays with the seller; COD commission is still owed and is deducted
 * from the next withdrawal of online funds.
 */
const commissionEngine = require('./commission-engine');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function computeWallet({ orders = [], ledger = [], withdrawals = [] }) {
  const orderById = new Map(orders.map((o) => [o.id, o]));
  let onlineReceived = 0;
  let onlineCommission = 0;
  let onlineNet = 0;
  let codCommissionDue = 0;

  for (const r of ledger) {
    const order = orderById.get(r.order_id);
    if (!order || order.status === 'cancelled') continue;
    const net = commissionEngine.netCommission(r);
    const refunded = order.refunded_amount || 0;
    const isCod = String(order.paymentMethod || '').toUpperCase() === 'COD';
    if (isCod) {
      codCommissionDue += net;
    } else {
      onlineReceived += r.commission_base_amount - refunded;
      onlineCommission += net;
      onlineNet += r.commission_base_amount - refunded - net;
    }
  }

  const withdrawn = withdrawals
    .filter((w) => w.status !== 'rejected')
    .reduce((s, w) => s + Number(w.amount || 0), 0);

  const availableToWithdraw = Math.max(0, round2(onlineNet - codCommissionDue - withdrawn));

  return {
    onlineReceived: round2(onlineReceived),
    onlineCommission: round2(onlineCommission),
    onlineNet: round2(onlineNet),
    codCommissionDue: round2(codCommissionDue),
    totalCommissionHeld: round2(onlineCommission + codCommissionDue),
    withdrawn: round2(withdrawn),
    availableToWithdraw,
  };
}

module.exports = { computeWallet, round2 };
