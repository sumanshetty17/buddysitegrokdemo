const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DB = path.join(os.tmpdir(), `buddysite-test-customers-${process.pid}-${Date.now()}.json`);
process.env.BUDDYSITE_DB_FILE = TMP_DB;
const db = require('../db');

test.after(() => { try { fs.unlinkSync(TMP_DB); } catch (_) {} });

async function makeStore() {
  const user = await db.createUser({ name: 'Seller', email: `seller-${Date.now()}-${Math.random()}@test.com`, password_hash: 'x' });
  await db.updateUserPlan(user.id, 'free', null);
  const site = await db.createSite({ user_id: user.id, slug: `store-${user.id}-${Math.random().toString(36).slice(2)}`, store_name: 'Store' });
  return site;
}

test('a customer can be created and found by either email or phone', async () => {
  const site = makeStore();
  await db.createCustomer(site.id, { name: 'Priya', email: 'Priya@Test.com', phone: '9876543210', password_hash: 'hashed' });
  assert.ok(await db.getCustomerByIdentifier(site.id, 'priya@test.com')); // case-insensitive email match
  assert.ok(await db.getCustomerByIdentifier(site.id, '9876543210'));
  assert.equal(await db.getCustomerByIdentifier(site.id, 'nobody@test.com'), null);
});

test('customer accounts are scoped per-store -- the same identifier on two different stores are two different customers', async () => {
  const siteA = makeStore();
  const siteB = makeStore();
  await db.createCustomer(siteA.id, { name: 'Priya', email: 'priya@test.com', phone: '9876543210', password_hash: 'x' });
  assert.ok(await db.getCustomerByIdentifier(siteA.id, 'priya@test.com'));
  assert.equal(await db.getCustomerByIdentifier(siteB.id, 'priya@test.com'), null, 'signing up on store A must not create an account on store B');
});

test('the first address a customer adds automatically becomes their default', async () => {
  const site = makeStore();
  const customer = await db.createCustomer(site.id, { name: 'Priya', phone: '9876543210', password_hash: 'x' });
  const addr = await db.addCustomerAddress(site.id, customer.id, { label: 'Home', address: '123 Main St' });
  assert.equal(addr.isDefault, true);
});

test('adding a second address marked isDefault demotes the first', async () => {
  const site = makeStore();
  const customer = await db.createCustomer(site.id, { name: 'Priya', phone: '9876543210', password_hash: 'x' });
  const a1 = await db.addCustomerAddress(site.id, customer.id, { label: 'Home', address: 'Addr 1' });
  const a2 = await db.addCustomerAddress(site.id, customer.id, { label: 'Work', address: 'Addr 2', isDefault: true });
  const fresh = await db.getCustomerById(site.id, customer.id);
  assert.equal(fresh.addresses.find(a => a.id === a1.id).isDefault, false);
  assert.equal(fresh.addresses.find(a => a.id === a2.id).isDefault, true);
});

test('an address can be edited', async () => {
  const site = makeStore();
  const customer = await db.createCustomer(site.id, { name: 'Priya', phone: '9876543210', password_hash: 'x' });
  const addr = await db.addCustomerAddress(site.id, customer.id, { label: 'Home', address: 'Old address' });
  await db.updateCustomerAddress(site.id, customer.id, addr.id, { address: 'New address, updated' });
  const fresh = await db.getCustomerById(site.id, customer.id);
  assert.equal(fresh.addresses[0].address, 'New address, updated');
});

test('deleting the default address promotes another remaining address to default', async () => {
  const site = makeStore();
  const customer = await db.createCustomer(site.id, { name: 'Priya', phone: '9876543210', password_hash: 'x' });
  const a1 = await db.addCustomerAddress(site.id, customer.id, { label: 'Home', address: 'Addr 1' }); // default
  await db.addCustomerAddress(site.id, customer.id, { label: 'Work', address: 'Addr 2' });
  await db.deleteCustomerAddress(site.id, customer.id, a1.id);
  const fresh = await db.getCustomerById(site.id, customer.id);
  assert.equal(fresh.addresses.length, 1);
  assert.equal(fresh.addresses[0].isDefault, true);
});

test('deleting the only address leaves an empty list, no crash', async () => {
  const site = makeStore();
  const customer = await db.createCustomer(site.id, { name: 'Priya', phone: '9876543210', password_hash: 'x' });
  const a1 = await db.addCustomerAddress(site.id, customer.id, { label: 'Home', address: 'Addr 1' });
  const deleted = await db.deleteCustomerAddress(site.id, customer.id, a1.id);
  assert.equal(deleted, true);
  assert.deepEqual(await db.getCustomerById(site.id, customer.id).addresses, []);
});

test("a customer's cart persists to their account and survives across sessions", async () => {
  const site = makeStore();
  const customer = await db.createCustomer(site.id, { name: 'Priya', phone: '9876543210', password_hash: 'x' });
  await db.setCustomerCart(site.id, customer.id, [{ id: 1, name: 'Kurti', price: 799, qty: 2 }]);
  const fresh = await db.getCustomerById(site.id, customer.id);
  assert.equal(fresh.cart.length, 1);
  assert.equal(fresh.cart[0].qty, 2);
});

test('order history only returns orders linked to that specific customer', async () => {
  const site = makeStore();
  const c1 = await db.createCustomer(site.id, { name: 'Priya', phone: '1111111111', password_hash: 'x' });
  const c2 = await db.createCustomer(site.id, { name: 'Rahul', phone: '2222222222', password_hash: 'x' });
  await db.addOrder(site.id, { customerName: 'Priya', phone: '1111111111', address: 'x', paymentMethod: 'COD', items: [], total: 500, subtotal: 500, customer_id: c1.id });
  await db.addOrder(site.id, { customerName: 'Rahul', phone: '2222222222', address: 'x', paymentMethod: 'COD', items: [], total: 300, subtotal: 300, customer_id: c2.id });
  await db.addOrder(site.id, { customerName: 'Guest', phone: '3333333333', address: 'x', paymentMethod: 'COD', items: [], total: 100, subtotal: 100 }); // guest, no account

  const c1Orders = await db.getOrdersForCustomer(site.id, c1.id);
  assert.equal(c1Orders.length, 1);
  assert.equal(c1Orders[0].total, 500);

  const c2Orders = await db.getOrdersForCustomer(site.id, c2.id);
  assert.equal(c2Orders.length, 1);
  assert.equal(c2Orders[0].total, 300);
});

test('updating a profile only changes the fields provided', async () => {
  const site = makeStore();
  const customer = await db.createCustomer(site.id, { name: 'Priya', email: 'priya@test.com', phone: '9876543210', password_hash: 'x' });
  await db.updateCustomerProfile(site.id, customer.id, { name: 'Priya Sharma' });
  const fresh = await db.getCustomerById(site.id, customer.id);
  assert.equal(fresh.name, 'Priya Sharma');
  assert.equal(fresh.email, 'priya@test.com'); // untouched
  assert.equal(fresh.phone, '9876543210'); // untouched
});
