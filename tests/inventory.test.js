const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DB = path.join(os.tmpdir(), `buddysite-test-inventory-${process.pid}-${Date.now()}.json`);
process.env.BUDDYSITE_DB_FILE = TMP_DB;
const db = require('../db');

test.after(() => { try { fs.unlinkSync(TMP_DB); } catch (_) {} });

async function makeStoreWithProduct(stock) {
  const user = await db.createUser({ name: 'Seller', email: `seller-${Date.now()}-${Math.random()}@test.com`, password_hash: 'x' });
  await db.updateUserPlan(user.id, 'free', null);
  const site = await db.createSite({ user_id: user.id, slug: `store-${user.id}-${Math.random().toString(36).slice(2)}`, store_name: 'Store' });
  const product = await db.addProduct(site.id, { name: 'Kurti', price: 500, trackInventory: true, stock });
  return { site, product };
}

test('a product with trackInventory off is always considered in stock, regardless of the stock number', async () => {
  const user = await db.createUser({ name: 'S', email: `s-${Math.random()}@test.com`, password_hash: 'x' });
  const site = await db.createSite({ user_id: user.id, slug: `store-${Math.random().toString(36).slice(2)}`, store_name: 'S' });
  const product = await db.addProduct(site.id, { name: 'X', price: 100 }); // trackInventory not set
  assert.equal(await db.isProductInStock(product, 999999), true);
});

test('placing an order decrements stock by the ordered quantity', async () => {
  const { site, product } = makeStoreWithProduct(10);
  await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [{ id: product.id, name: 'Kurti', price: 500, qty: 3 }], total: 1500, subtotal: 1500 });
  const fresh = await db.getSiteById(site.id).products.find(p => p.id === product.id);
  assert.equal(fresh.stock, 7);
});

test('an order for more than available stock is rejected and stock is untouched', async () => {
  const { site, product } = makeStoreWithProduct(2);
  const result = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [{ id: product.id, name: 'Kurti', price: 500, qty: 5 }], total: 2500, subtotal: 2500 });
  assert.equal(result.error, 'OUT_OF_STOCK');
  const fresh = await db.getSiteById(site.id).products.find(p => p.id === product.id);
  assert.equal(fresh.stock, 2, 'a rejected order must not touch stock');
});

test('stock can never go negative even across multiple concurrent-looking orders', async () => {
  const { site, product } = makeStoreWithProduct(1);
  const first = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [{ id: product.id, name: 'Kurti', price: 500, qty: 1 }], total: 500, subtotal: 500 });
  assert.ok(!first.error);
  const second = await db.addOrder(site.id, { customerName: 'B', paymentMethod: 'COD', items: [{ id: product.id, name: 'Kurti', price: 500, qty: 1 }], total: 500, subtotal: 500 });
  assert.equal(second.error, 'OUT_OF_STOCK');
  const fresh = await db.getSiteById(site.id).products.find(p => p.id === product.id);
  assert.equal(fresh.stock, 0);
});

test('cancelling an order restores the stock it had reserved', async () => {
  const { site, product } = makeStoreWithProduct(10);
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [{ id: product.id, name: 'Kurti', price: 500, qty: 4 }], total: 2000, subtotal: 2000 });
  assert.equal(await db.getSiteById(site.id).products.find(p => p.id === product.id).stock, 6);
  await db.updateOrderStatus(site.id, order.id, 'cancelled');
  assert.equal(await db.getSiteById(site.id).products.find(p => p.id === product.id).stock, 10, 'cancelling should give the stock back');
});

test('refunding (not cancelling) an order does NOT auto-restore stock', async () => {
  const { site, product } = makeStoreWithProduct(10);
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [{ id: product.id, name: 'Kurti', price: 500, qty: 4 }], total: 2000, subtotal: 2000 });
  await db.updateOrderStatus(site.id, order.id, 'refunded');
  assert.equal(await db.getSiteById(site.id).products.find(p => p.id === product.id).stock, 6, 'a refund should not auto-restore stock -- that needs the seller to confirm the item actually came back');
});

test('reactivating a cancelled order re-reserves the stock instead of letting a cancel+reactivate cycle create free stock', async () => {
  const { site, product } = makeStoreWithProduct(10);
  const order = await db.addOrder(site.id, { customerName: 'A', paymentMethod: 'COD', items: [{ id: product.id, name: 'Kurti', price: 500, qty: 4 }], total: 2000, subtotal: 2000 });
  await db.updateOrderStatus(site.id, order.id, 'cancelled');
  assert.equal(await db.getSiteById(site.id).products.find(p => p.id === product.id).stock, 10);
  await db.updateOrderStatus(site.id, order.id, 'new'); // seller un-cancels
  assert.equal(await db.getSiteById(site.id).products.find(p => p.id === product.id).stock, 6, 'reactivating must re-reserve the stock');
});

test('a seller can manually adjust stock via updateProduct', async () => {
  const { site, product } = makeStoreWithProduct(5);
  await db.updateProduct(site.id, product.id, { stock: 50 });
  assert.equal(await db.getSiteById(site.id).products.find(p => p.id === product.id).stock, 50);
});

test('turning trackInventory off clears the stock number back to null (unlimited)', async () => {
  const { site, product } = makeStoreWithProduct(5);
  await db.updateProduct(site.id, product.id, { trackInventory: false });
  const fresh = await db.getSiteById(site.id).products.find(p => p.id === product.id);
  assert.equal(fresh.trackInventory, false);
  assert.equal(fresh.stock, null);
});
