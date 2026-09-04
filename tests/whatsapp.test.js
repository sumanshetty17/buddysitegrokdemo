const test = require('node:test');
const assert = require('node:assert/strict');

// Ensure these run with WhatsApp NOT configured (the default in this repo,
// and the default for anyone who hasn't added credentials yet), so we can
// verify the safe fallback path.
delete process.env.WHATSAPP_API_URL;
delete process.env.WHATSAPP_API_KEY;
delete process.env.WHATSAPP_SENDER_NUMBER;
const whatsapp = require('../whatsapp');

test('whatsapp is disabled by default until all three env vars are set', () => {
  assert.equal(whatsapp.whatsappEnabled, false);
});

test('normalizeNumber assumes India (91) for a bare 10-digit number', () => {
  assert.equal(whatsapp.normalizeNumber('9876543210'), '919876543210');
});

test('normalizeNumber strips spaces/dashes/plus and leaves a full international number alone', () => {
  assert.equal(whatsapp.normalizeNumber('+91 98765-43210'), '919876543210');
});

test('normalizeNumber returns null for empty/missing input', () => {
  assert.equal(whatsapp.normalizeNumber(''), null);
  assert.equal(whatsapp.normalizeNumber(null), null);
  assert.equal(whatsapp.normalizeNumber(undefined), null);
});

test('formatOrderMessage includes every product, the total, and the payment method', () => {
  const order = {
    items: [{ name: 'Blue Kurti', price: 799, qty: 2 }, { name: 'Scarf', price: 199, qty: 1 }],
    total: 1797,
    paymentMethod: 'COD'
  };
  const sellerMsg = whatsapp.formatOrderMessage({ storeName: 'Anita Fashions', order, audience: 'seller' });
  assert.match(sellerMsg, /Blue Kurti × 2/);
  assert.match(sellerMsg, /Scarf × 1/);
  assert.match(sellerMsg, /Total: ₹1797\.00/);
  assert.match(sellerMsg, /Payment method: COD/);
  assert.match(sellerMsg, /New order on Anita Fashions/);

  const customerMsg = whatsapp.formatOrderMessage({ storeName: 'Anita Fashions', order, audience: 'customer' });
  assert.match(customerMsg, /Your order from Anita Fashions is placed/);
});

test('sendOrderNotifications never throws when WhatsApp is unconfigured, and reports why each side failed', async () => {
  const order = { items: [{ name: 'X', price: 100, qty: 1 }], total: 100, paymentMethod: 'UPI', phone: '9999999999' };
  const results = await whatsapp.sendOrderNotifications({ storeName: 'Store', sellerNumber: '9876543210', order });
  assert.equal(results.seller.ok, false);
  assert.equal(results.customer.ok, false);
});

test('sendOrderNotifications reports a clear reason when the seller never added a WhatsApp number', async () => {
  const order = { items: [{ name: 'X', price: 100, qty: 1 }], total: 100, paymentMethod: 'UPI', phone: '9999999999' };
  const results = await whatsapp.sendOrderNotifications({ storeName: 'Store', sellerNumber: '', order });
  assert.equal(results.seller.ok, false);
  assert.match(results.seller.error, /Payment Method/);
});

test('sendOrderNotifications reports a clear reason when the order has no customer phone', async () => {
  const order = { items: [{ name: 'X', price: 100, qty: 1 }], total: 100, paymentMethod: 'UPI', phone: '' };
  const results = await whatsapp.sendOrderNotifications({ storeName: 'Store', sellerNumber: '9876543210', order });
  assert.equal(results.customer.ok, false);
  assert.match(results.customer.error, /no customer phone/);
});

test('notifyCustomer defaults to true -- omitting it still attempts the customer message', async () => {
  const order = { items: [{ name: 'X', price: 100, qty: 1 }], total: 100, paymentMethod: 'UPI', phone: '9999999999' };
  const results = await whatsapp.sendOrderNotifications({ storeName: 'Store', sellerNumber: '9876543210', order });
  // unconfigured, so it still fails -- but for the right reason (not configured), not because it was skipped
  assert.equal(results.customer.ok, false);
  assert.equal(results.customer.error, 'not configured');
});

test('notifyCustomer:false skips the customer message entirely but still notifies the seller', async () => {
  const order = { items: [{ name: 'X', price: 100, qty: 1 }], total: 100, paymentMethod: 'UPI', phone: '9999999999' };
  const results = await whatsapp.sendOrderNotifications({ storeName: 'Store', sellerNumber: '9876543210', order, notifyCustomer: false });
  assert.equal(results.customer.ok, false);
  assert.match(results.customer.error, /opted out/);
  // seller path is untouched by the customer's opt-out choice
  assert.equal(results.seller.ok, false); // still false because unconfigured in this test, but for the "not configured" reason
  assert.equal(results.seller.error, 'not configured');
});
