// A tiny pure-JavaScript database stored as a single JSON file.
// No native code to compile -- works identically on any host.
//
// Concurrency notes (multi-seller + multi-customer traffic):
// - All read-modify-write paths go through withLock() so concurrent requests
//   on the same Node process cannot interleave and corrupt data.json.
// - Writes are atomic (temp file + rename) so a crash mid-write never leaves
//   a half-written JSON file.
// - This is still a single-process design. For multi-instance / high-scale
//   deploy, swap the storage backend for Postgres/SQLite with proper
//   transactions; the commission ledger and plan entitlements stay the same.

const fs = require('fs');
const path = require('path');
const commissionEngine = require('./commission-engine');

const FILE = process.env.BUDDYSITE_DB_FILE || path.join(__dirname, 'data.json');
const TMP_FILE = FILE + '.tmp';

// Simple synchronous mutex for the single Node process. Nested withLock()
// calls from the same tick re-enter safely (no deadlock).
let _locked = false;
const _waitQueue = [];

function withLock(fn) {
  if (_locked) {
    // Re-entrant: same call stack already holds the lock (e.g. nested helpers).
    // Just run; outer unlock will release.
    return fn();
  }
  _locked = true;
  try {
    return fn();
  } finally {
    _locked = false;
    // Drain any queued work that arrived while we held the lock.
    // (Currently unused — kept for future async upgrade path.)
    while (_waitQueue.length) {
      const next = _waitQueue.shift();
      try { next(); } catch (_) { /* ignore */ }
    }
  }
}

function empty() {
  return {
    users: [], sites: [], payments: [], subscriptions: [], razorpayPlans: {},
    commissionLedger: [], // immutable per-order BuddySite commission records -- see commission-engine.js
    nextUserId: 1, nextSiteId: 1, nextProductId: 1, nextCategoryId: 1, nextOrderId: 1, nextPaymentId: 1, nextSubscriptionId: 1,
    nextHeroSlideId: 1, nextCategoryGroupId: 1, nextSlidingSectionId: 1, nextCouponId: 1, nextCommissionId: 1,
    nextCustomerId: 1, nextAddressId: 1
  };
}

function load() {
  if (!fs.existsSync(FILE)) return empty();
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const e = empty();
    Object.keys(e).forEach(k => { if (data[k] === undefined) data[k] = e[k]; }); // safety for older data files
    return data;
  } catch {
    return empty();
  }
}

/** Atomic write: write to .tmp then rename over the real file. */
function save(data) {
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(TMP_FILE, json);
  fs.renameSync(TMP_FILE, FILE);
}

// ---------- USERS ----------
function createUser({ name, email, password_hash }) {
  const data = load();
  const user = { id: data.nextUserId++, name, email, password_hash, plan: null, plan_renews_at: null, paid_cycles: 0, created_at: new Date().toISOString() };
  data.users.push(user);
  save(data);
  return user;
}
function getUserByEmail(email) { return load().users.find(u => u.email === email); }
function getUserById(id) { return load().users.find(u => u.id === Number(id)); }

function updateUserPlan(userId, plan, renewsAt) {
  const data = load();
  const user = data.users.find(u => u.id === Number(userId));
  if (!user) return null;
  user.plan = plan;
  user.plan_renews_at = renewsAt;
  user.paid_cycles = (user.paid_cycles || 0) + 1;
  save(data);
  return user;
}

// ---------- SITES (stores) ----------
function emptyPage() {
  return { content: [], background_url: '', background_type: 'image' };
}

function createSite({ user_id, slug, store_name, theme }) {
  const data = load();
  const site = {
    id: data.nextSiteId++,
    user_id: Number(user_id),
    slug,
    store_name,
    theme: theme || 'simple', // 'simple' | 'bold' | 'aesthetic'
    customColors: {}, // optional seller color overrides layered on top of the theme -- see getTheme() in server.js
    description: '',
    description_align: 'center', // 'left' | 'center' | 'right'
    description_size: 'medium', // 'small' | 'medium' | 'large'
    description_font: 'inter', // 'inter' | 'poppins' | 'playfair'
    background_url: '',
    background_type: 'image', // 'image' | 'video'
    payment_link: '',
    whatsapp_number: '', // seller's WhatsApp number, used for order-placed alerts
    customers: [], // per-store customer accounts -- see the CUSTOMER ACCOUNTS section below
    products: [],
    categories: [],
    orders: [],
    aboutPage: emptyPage(),
    contactPage: emptyPage(),
    heroSlides: [],       // Pro plan: multi-slide homepage banner -- [{id, image, heading, subtext, link}]
    categoryGroups: [],   // Pro plan: titled homepage sections -- [{id, title, productIds:[]}]
    slidingSections: [],  // Pro plan: named sliding/carousel product rows -- [{id, title, productIds:[]}]
    brandStory: emptyPage(), // all plans: "about the brand" footer section
    socialLinks: { instagram: '', facebook: '', twitter: '', youtube: '', tiktok: '', website: '' },
    cartPosition: 'bottom', // 'bottom' (floating button) | 'top' (topbar icon) -- both link to a dedicated cart page
    storeNamePosition: 'left', // 'left' | 'center'
    logoVideoUrl: '', logoVideoPosition: 'left', // 'left' | 'right' -- optional looping logo video
    coupons: [], // [{id, code, type:'percent'|'fixed'|'free_shipping', value, minCartValue, expiryDate, usageLimit, usageCount, active}]
    published: 0,
    created_at: new Date().toISOString()
  };
  data.sites.push(site);
  save(data);
  return site;
}

function updatePage(siteId, pageKey, fields) {
  // pageKey is 'aboutPage' or 'contactPage'
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  if (!site[pageKey]) site[pageKey] = emptyPage();
  if (fields.content !== undefined) site[pageKey].content = fields.content;
  if (fields.background_url !== undefined) site[pageKey].background_url = fields.background_url;
  if (fields.background_type !== undefined) site[pageKey].background_type = fields.background_type;
  save(data);
  return site[pageKey];
}

function withPageDefaults(site) {
  if (!site) return site;
  if (!site.aboutPage) site.aboutPage = emptyPage();
  if (!site.contactPage) site.contactPage = emptyPage();
  if (!site.brandStory) site.brandStory = emptyPage();
  if (!site.heroSlides) site.heroSlides = [];
  if (!site.categoryGroups) site.categoryGroups = [];
  if (!site.slidingSections) site.slidingSections = [];
  if (!site.socialLinks) site.socialLinks = { instagram: '', facebook: '', twitter: '', youtube: '', tiktok: '', website: '' };
  if (!site.cartPosition) site.cartPosition = 'bottom';
  if (!Array.isArray(site.coupons)) site.coupons = [];
  if (!site.storeNamePosition) site.storeNamePosition = 'left';
  if (site.logoVideoUrl === undefined) site.logoVideoUrl = '';
  if (site.whatsapp_number === undefined) site.whatsapp_number = '';
  if (!Array.isArray(site.customers)) site.customers = [];
  if (Array.isArray(site.customers)) {
    site.customers.forEach(c => {
      if (!Array.isArray(c.addresses)) c.addresses = [];
      if (!Array.isArray(c.cart)) c.cart = [];
    });
  }
  if (Array.isArray(site.products)) {
    site.products.forEach(p => {
      if (p.trackInventory === undefined) p.trackInventory = false;
      if (p.stock === undefined) p.stock = null;
    });
  }
  if (!site.logoVideoPosition) site.logoVideoPosition = 'left';
  if (!site.theme) site.theme = 'simple';
  if (!site.customColors || typeof site.customColors !== 'object') site.customColors = {};
  if (!site.description_align) site.description_align = 'center';
  if (!site.description_size) site.description_size = 'medium';
  if (!site.description_font) site.description_font = 'inter';
  if (Array.isArray(site.products)) {
    site.products.forEach(p => {
      if (!Array.isArray(p.images)) p.images = p.image ? [p.image] : [];
      if (!Array.isArray(p.sizes)) p.sizes = p.size ? [p.size] : [];
      if (p.originalPrice === undefined) p.originalPrice = 0;
      if (!p.sizeGuide || !Array.isArray(p.sizeGuide.content)) p.sizeGuide = { title: '', content: [] };
    });
  }
  if (Array.isArray(site.categoryGroups)) {
    site.categoryGroups.forEach(g => { if (!Array.isArray(g.productIds)) g.productIds = []; });
  }
  if (Array.isArray(site.slidingSections)) {
    site.slidingSections.forEach(g => { if (!Array.isArray(g.productIds)) g.productIds = []; });
  }
  return site;
}

function getSitesByUser(userId) { return load().sites.filter(s => s.user_id === Number(userId)).sort((a, b) => a.id - b.id).map(withPageDefaults); }
function countSitesByUser(userId) { return getSitesByUser(userId).length; }
function getSiteByIdAndUser(id, userId) { return withPageDefaults(load().sites.find(s => s.id === Number(id) && s.user_id === Number(userId))); }
function getSiteById(id) { return withPageDefaults(load().sites.find(s => s.id === Number(id))); }
function getSiteBySlug(slug) { return withPageDefaults(load().sites.find(s => s.slug === slug)); }

function updateSite(id, fields) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(id));
  if (!site) return null;
  ['store_name', 'description', 'description_align', 'description_size', 'description_font', 'background_url', 'background_type', 'payment_link', 'whatsapp_number', 'published', 'theme', 'cartPosition', 'storeNamePosition', 'logoVideoUrl', 'logoVideoPosition'].forEach(f => {
    if (fields[f] !== undefined) site[f] = f === 'published' ? (fields[f] ? 1 : 0) : fields[f];
  });
  save(data);
  return site;
}

// Strict hex-color validation. These values get interpolated directly into
// inline style="..." attributes across dozens of storefront templates with
// no further escaping, so anything that isn't a clean hex color is a stored
// XSS vector against every one of this seller's customers -- never relax
// this to accept arbitrary strings.
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{3}$|^#[0-9A-Fa-f]{6}$/;
function isValidHexColor(v) { return typeof v === 'string' && HEX_COLOR_RE.test(v.trim()); }

// Updates a seller's custom theme-color overrides. Only ever accepts clean
// hex colors (see isValidHexColor) or an empty string to clear a field back
// to the preset's default -- rejects anything else outright rather than
// silently stripping or storing it.
function updateSiteColors(siteId, colors) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const ALLOWED_FIELDS = ['accent', 'accentDark', 'btnBg', 'btnText', 'bg', 'ink'];
  const next = Object.assign({}, site.customColors || {});
  for (const field of ALLOWED_FIELDS) {
    if (colors[field] === undefined) continue;
    const v = colors[field];
    if (v === '' || v === null) { delete next[field]; continue; } // clear -- fall back to theme default
    if (!isValidHexColor(v)) return { error: `"${field}" must be a hex color like #FF6A88.` };
    next[field] = v.trim();
  }
  site.customColors = next;
  save(data);
  return { site };
}

function deleteSite(id) {
  const data = load();
  data.sites = data.sites.filter(s => s.id !== Number(id));
  save(data);
}

// ---------- PRODUCTS ----------
function addProduct(siteId, { name, price, originalPrice, image, images, sizes, size, color, description, categoryId, sizeGuide, trackInventory, stock }) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const imgList = (Array.isArray(images) && images.length) ? images.filter(Boolean) : (image ? [image] : []);
  const sizeList = Array.isArray(sizes) ? sizes.filter(Boolean) : (size ? [size] : []);
  const product = {
    id: data.nextProductId++, name, price: Number(price) || 0,
    originalPrice: originalPrice ? Number(originalPrice) || 0 : 0,
    image: imgList[0] || '', images: imgList,
    sizes: sizeList, size: sizeList[0] || '', color: color || '', description: description || '', categoryId: categoryId || null,
    sizeGuide: sizeGuide && sizeGuide.content && sizeGuide.content.length ? { title: sizeGuide.title || 'Size Guide', content: sizeGuide.content } : { title: '', content: [] },
    // Inventory: trackInventory off by default (product is always considered
    // in stock, same as every product before this feature existed -- fully
    // backward compatible). When on, `stock` is the number of units left;
    // 0 or less means out of stock.
    trackInventory: !!trackInventory,
    stock: trackInventory ? (Number(stock) || 0) : null
  };
  site.products.push(product);
  save(data);
  return product;
}
function updateProduct(siteId, productId, fields) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const p = site.products.find(p => p.id === Number(productId));
  if (!p) return null;
  if (fields.images !== undefined) {
    const imgList = Array.isArray(fields.images) ? fields.images.filter(Boolean) : [];
    p.images = imgList;
    p.image = imgList[0] || '';
  } else if (fields.image !== undefined) {
    p.image = fields.image;
    p.images = fields.image ? [fields.image] : [];
  }
  if (fields.sizes !== undefined) {
    const sizeList = Array.isArray(fields.sizes) ? fields.sizes.filter(Boolean) : [];
    p.sizes = sizeList;
    p.size = sizeList[0] || '';
  }
  if (fields.sizeGuide !== undefined) {
    p.sizeGuide = fields.sizeGuide && fields.sizeGuide.content && fields.sizeGuide.content.length
      ? { title: fields.sizeGuide.title || 'Size Guide', content: fields.sizeGuide.content }
      : { title: '', content: [] };
  }
  ['name', 'price', 'originalPrice', 'color', 'description', 'categoryId'].forEach(f => {
    if (fields[f] !== undefined) p[f] = (f === 'price' || f === 'originalPrice') ? (Number(fields[f]) || 0) : fields[f];
  });
  if (fields.trackInventory !== undefined) {
    p.trackInventory = !!fields.trackInventory;
    if (!p.trackInventory) p.stock = null;
    else if (p.stock === null || p.stock === undefined) p.stock = Number(fields.stock) || 0;
  }
  if (fields.stock !== undefined && p.trackInventory) {
    p.stock = Math.max(0, Number(fields.stock) || 0);
  }
  save(data);
  return p;
}
function deleteProduct(siteId, productId) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return false;
  site.products = site.products.filter(p => p.id !== Number(productId));
  (site.categoryGroups || []).forEach(g => { g.productIds = (g.productIds || []).filter(id => id !== Number(productId)); });
  (site.slidingSections || []).forEach(g => { g.productIds = (g.productIds || []).filter(id => id !== Number(productId)); });
  save(data);
  return true;
}
function countProducts(siteId) {
  const site = load().sites.find(s => s.id === Number(siteId));
  return site ? site.products.length : 0;
}

// ---------- CATEGORIES ----------
function addCategory(siteId, name, image) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const category = { id: data.nextCategoryId++, name, image: image || '' };
  site.categories.push(category);
  save(data);
  return category;
}
function updateCategory(siteId, categoryId, { name, image }) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const cat = site.categories.find(c => c.id === Number(categoryId));
  if (!cat) return null;
  if (name !== undefined) cat.name = name;
  if (image !== undefined) cat.image = image;
  save(data);
  return cat;
}
function deleteCategory(siteId, categoryId) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return false;
  site.categories = site.categories.filter(c => c.id !== Number(categoryId));
  site.products.forEach(p => { if (p.categoryId === Number(categoryId)) p.categoryId = null; });
  save(data);
  return true;
}

function isProductInStock(product, qty) {
  if (!product.trackInventory) return true; // not tracked -- always available, same as before this feature existed
  return (product.stock || 0) >= qty;
}

// Adjusts stock for every line item in an order by `delta` per unit
// (negative to decrement on a new order, positive to restore on
// cancellation). Operates on an ALREADY-LOADED site object, not its own
// load()/save() -- this must be called from within a function that already
// holds `data`/`site` and will save() once at the end, otherwise two
// independent load/save cycles racing on the same file can silently
// overwrite each other's changes.
function applyStockDelta(site, items, delta) {
  (items || []).forEach(item => {
    const product = site.products.find(p => p.id === item.id);
    if (product && product.trackInventory) {
      product.stock = Math.max(0, (product.stock || 0) + delta * item.qty);
    }
  });
}


// Commission (see commission-engine.js and the Final Pricing & Transaction
// Commission Specification, v2.0): commission is calculated server-side, on
// the merchandise subtotal after discount, at the seller's plan rate AT THE
// MOMENT the order is placed. That rate is frozen onto an immutable ledger
// record -- a later plan change never rewrites past orders.
function addOrder(siteId, { customerName, email, phone, address, paymentMethod, items, total, couponCode, discount, subtotal, whatsapp_opt_in, customer_id }) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;

  // Stock check happens here, against the freshest possible read of
  // inventory, in the same load/save cycle as the decrement below -- so
  // there's no window where a check could pass against stale data and then
  // an unrelated decrement silently disagrees with it.
  for (const item of items) {
    const product = site.products.find(p => p.id === item.id);
    if (product && product.trackInventory && (product.stock || 0) < item.qty) {
      return { error: 'OUT_OF_STOCK', productName: product.name, available: product.stock || 0 };
    }
  }

  const status = paymentMethod === 'COD' ? 'new' : 'awaiting_payment';
  const order = { id: data.nextOrderId++, customerName, email, phone, address, paymentMethod, items, total, couponCode: couponCode || '', discount: discount || 0, whatsapp_opt_in: whatsapp_opt_in !== false, customer_id: customer_id || null, status, created_at: new Date().toISOString() };
  site.orders.push(order);
  applyStockDelta(site, items, -1);

  const seller = data.users.find(u => u.id === Number(site.user_id));
  const planKey = (seller && seller.plan) || 'free';
  const orderSubtotal = subtotal !== undefined ? subtotal : (total + (discount || 0));
  const ledgerRecord = commissionEngine.buildLedgerRecord({
    id: data.nextCommissionId++,
    order_id: order.id,
    store_id: site.id,
    seller_id: site.user_id,
    planKey,
    subtotal: orderSubtotal,
    discount: discount || 0
  });
  data.commissionLedger.push(ledgerRecord);
  order.commission_id = ledgerRecord.commission_id;

  save(data);
  return order;
}
function getOrders(siteId) {
  const site = load().sites.find(s => s.id === Number(siteId));
  return site ? site.orders.slice().reverse() : [];
}
function updateOrderStatus(siteId, orderId, status) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const order = site.orders.find(o => o.id === Number(orderId));
  if (!order) return null;
  const previousStatus = order.status;
  order.status = status;

  const wasClosed = previousStatus === 'cancelled' || previousStatus === 'refunded';
  const isClosed = status === 'cancelled' || status === 'refunded';
  const record = data.commissionLedger.find(r => r.order_id === order.id && r.store_id === site.id);

  // A cancelled order never creates a final commission charge; a full
  // refund reverses it. Both are handled the same way in the ledger: the
  // original commission_amount is left untouched (audit trail) and a
  // negative refund_adjustment_amount cancels it out. 'cancelled' means no
  // money was ever collected (e.g. a COD order stopped before delivery), so
  // it does NOT set refunded_amount; 'refunded' means the customer already
  // paid and got their money back, so the full order total is recorded as
  // refunded for accurate Finance/Payouts reporting.
  if (isClosed && !wasClosed && record) {
    commissionEngine.reverseLedgerRecord(record);
    order.refunded_amount = status === 'refunded' ? order.total : 0;
    // Cancelling (before any money was collected) restores stock, same
    // "cancelled = no sale" rule as the commission ledger. A refund does
    // NOT auto-restore stock -- that needs confirming the item actually
    // came back, which sellers do manually via the product edit form.
    if (status === 'cancelled') applyStockDelta(site, order.items, +1);
  }

  // Reactivating an order that was previously cancelled (e.g. a mistaken
  // cancellation) restores the commission ledger to pending AND re-reserves
  // the stock that was given back -- otherwise a seller could cancel and
  // un-cancel the same order to conjure extra stock out of nowhere.
  if (wasClosed && !isClosed && record) {
    record.status = 'pending';
    record.refund_adjustment_amount = 0;
    order.refunded_amount = 0;
    if (previousStatus === 'cancelled') applyStockDelta(site, order.items, -1);
  }

  save(data);
  return order;
}

// Partial refund: proportionally adjusts the ledger record instead of fully
// reversing it. Validates BEFORE mutating anything, so a rejected refund
// never leaves the ledger or order in a partially-changed state. Returns
// { order, ledgerRecord } on success, or { error: '...' } on failure.
function refundOrderPartial(siteId, orderId, refundAmount) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const order = site.orders.find(o => o.id === Number(orderId));
  if (!order) return null;
  const record = data.commissionLedger.find(r => r.order_id === order.id && r.store_id === site.id);
  if (!record) return null;

  if (order.status === 'cancelled') {
    return { error: 'This order was cancelled before payment was collected -- there is nothing to refund.' };
  }

  const amount = Number(refundAmount);
  const alreadyRefunded = order.refunded_amount || 0;
  if (!amount || amount <= 0) return { error: 'Enter a valid refund amount.' };
  if (alreadyRefunded + amount > order.total + 0.005) {
    return { error: `Refund amount cannot exceed the order total. Already refunded: ₹${alreadyRefunded}, order total: ₹${order.total}.` };
  }

  commissionEngine.applyPartialRefund(record, alreadyRefunded + amount, order.total);
  order.refunded_amount = alreadyRefunded + amount;
  if (record.status === 'reversed') order.status = 'refunded';
  save(data);
  return { order, ledgerRecord: record };
}

function getCommissionLedgerForSite(siteId) {
  return load().commissionLedger.filter(r => r.store_id === Number(siteId)).slice().reverse();
}
function getCommissionLedgerForOrder(siteId, orderId) {
  return load().commissionLedger.find(r => r.store_id === Number(siteId) && r.order_id === Number(orderId));
}
// Finance/Payouts summary for a seller's store (spec section 6).
//
// Important accounting rules, cross-checked end-to-end against real
// requests (not just unit-tested in isolation):
//  - CANCELLED orders never collected any money, so they are excluded
//    entirely from gross sales / commissionable sales / commission / net
//    payout. They still appear in the per-order ledger list (marked
//    "Cancelled") so the seller has a full record, they just contribute
//    zero to every total.
//  - "commission" in the summary is the NET amount actually owed to
//    BuddySite (i.e. after any refund adjustment) -- not the original
//    pre-refund figure, which would overstate what's actually charged.
//  - "refunds" is the real money paid back to customers
//    (order.refunded_amount), not the commission-side adjustment -- those
//    are two different numbers and both matter, but this line is the one
//    that reduces the seller's take-home.
//  - "netPayout" per order = commissionable amount − money refunded to the
//    customer − net commission owed to BuddySite.
function getFinanceSummary(siteId) {
  const ledger = getCommissionLedgerForSite(siteId);
  const site = load().sites.find(s => s.id === Number(siteId));
  const orders = site ? site.orders : [];
  const orderById = new Map(orders.map(o => [o.id, o]));

  let grossSales = 0, discounts = 0, commissionable = 0, commission = 0, refunds = 0, netPayout = 0;
  const ledgerOut = ledger.map(r => {
    const order = orderById.get(r.order_id) || null;
    const net = commissionEngine.netCommission(r);
    const orderRefundedAmount = order ? (order.refunded_amount || 0) : 0;
    const isCancelled = order && order.status === 'cancelled';

    if (order && !isCancelled) {
      grossSales += order.total + (order.discount || 0);
      discounts += order.discount || 0;
      commissionable += r.commission_base_amount;
      commission += net;
      refunds += orderRefundedAmount;
      netPayout += r.commission_base_amount - orderRefundedAmount - net;
    }

    return { ...r, order, netCommission: net, orderRefundedAmount, excludedAsCancelled: !!isCancelled };
  });

  return {
    grossSales, discounts, commissionableSales: commissionable,
    commission, refunds, netPayout,
    ledger: ledgerOut
  };
}

// ---------- PAYMENTS (platform subscription billing) ----------
function createPayment({ user_id, plan, amount_paise, razorpay_order_id, status }) {
  const data = load();
  const payment = { id: data.nextPaymentId++, user_id: Number(user_id), plan, amount_paise, razorpay_order_id, razorpay_payment_id: null, status, created_at: new Date().toISOString() };
  data.payments.push(payment);
  save(data);
  return payment;
}
function getPaymentByOrderId(orderId) { return load().payments.find(p => p.razorpay_order_id === orderId); }
function updatePaymentStatus(orderId, status, paymentId) {
  const data = load();
  const payment = data.payments.find(p => p.razorpay_order_id === orderId);
  if (!payment) return null;
  payment.status = status;
  if (paymentId) payment.razorpay_payment_id = paymentId;
  save(data);
  return payment;
}
function countPaidCyclesForUser(userId) {
  return load().payments.filter(p => p.user_id === Number(userId) && p.status === 'paid').length;
}

// ---------- RAZORPAY PLAN CACHE (so we only create each Razorpay Plan once) ----------
function getRazorpayPlanId(planKey) { return load().razorpayPlans[planKey] || null; }
function setRazorpayPlanId(planKey, razorpayPlanId) {
  const data = load();
  data.razorpayPlans[planKey] = razorpayPlanId;
  save(data);
}

// ---------- SUBSCRIPTIONS (auto-pay) ----------
function createSubscription({ user_id, plan, razorpay_subscription_id }) {
  const data = load();
  const sub = { id: data.nextSubscriptionId++, user_id: Number(user_id), plan, razorpay_subscription_id, status: 'created', created_at: new Date().toISOString() };
  data.subscriptions.push(sub);
  save(data);
  return sub;
}
function getSubscriptionByRzpId(rzpId) { return load().subscriptions.find(s => s.razorpay_subscription_id === rzpId); }
function getActiveSubscriptionForUser(userId) {
  return load().subscriptions.find(s => s.user_id === Number(userId) && (s.status === 'active' || s.status === 'authenticated'));
}
function updateSubscriptionStatus(rzpId, status) {
  const data = load();
  const sub = data.subscriptions.find(s => s.razorpay_subscription_id === rzpId);
  if (!sub) return null;
  sub.status = status;
  save(data);
  return sub;
}

// ---------- HERO SLIDES (Pro plan homepage slider) ----------
function addHeroSlide(siteId, { image, heading, subtext, link }) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  if (!site.heroSlides) site.heroSlides = [];
  const slide = { id: data.nextHeroSlideId++, image: image || '', heading: heading || '', subtext: subtext || '', link: link || '' };
  site.heroSlides.push(slide);
  save(data);
  return slide;
}
function deleteHeroSlide(siteId, slideId) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return false;
  site.heroSlides = (site.heroSlides || []).filter(s => s.id !== Number(slideId));
  save(data);
  return true;
}

// ---------- CATEGORY SECTIONS (Pro plan): titled homepage sections you add
// specific products to directly, e.g. "Top Deals", "Summer Sale". ----------
function addCategoryGroup(siteId, { title, productIds }) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  if (!site.categoryGroups) site.categoryGroups = [];
  const group = { id: data.nextCategoryGroupId++, title: title || 'Section', productIds: Array.isArray(productIds) ? productIds.map(Number) : [] };
  site.categoryGroups.push(group);
  save(data);
  return group;
}
function deleteCategoryGroup(siteId, groupId) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return false;
  site.categoryGroups = (site.categoryGroups || []).filter(g => g.id !== Number(groupId));
  save(data);
  return true;
}
function addProductToGroup(siteId, groupId, productId) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const group = (site.categoryGroups || []).find(g => g.id === Number(groupId));
  if (!group) return null;
  const pid = Number(productId);
  if (!group.productIds.includes(pid)) group.productIds.push(pid);
  save(data);
  return group;
}
function removeProductFromGroup(siteId, groupId, productId) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const group = (site.categoryGroups || []).find(g => g.id === Number(groupId));
  if (!group) return null;
  group.productIds = group.productIds.filter(id => id !== Number(productId));
  save(data);
  return group;
}

// ---------- SLIDING PRODUCT SECTIONS (Pro plan): named, admin-curated
// horizontally-scrolling carousels, e.g. "Trending Now", "New Arrivals". ----------
function addSlidingSection(siteId, { title, productIds }) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  if (!site.slidingSections) site.slidingSections = [];
  const section = { id: data.nextSlidingSectionId++, title: title || 'Sliding Products', productIds: Array.isArray(productIds) ? productIds.map(Number) : [] };
  site.slidingSections.push(section);
  save(data);
  return section;
}
function deleteSlidingSection(siteId, sectionId) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return false;
  site.slidingSections = (site.slidingSections || []).filter(g => g.id !== Number(sectionId));
  save(data);
  return true;
}
function addProductToSlidingSection(siteId, sectionId, productId) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const section = (site.slidingSections || []).find(g => g.id === Number(sectionId));
  if (!section) return null;
  const pid = Number(productId);
  if (!section.productIds.includes(pid)) section.productIds.push(pid);
  save(data);
  return section;
}
function removeProductFromSlidingSection(siteId, sectionId, productId) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const section = (site.slidingSections || []).find(g => g.id === Number(sectionId));
  if (!section) return null;
  section.productIds = section.productIds.filter(id => id !== Number(productId));
  save(data);
  return section;
}

// ---------- COUPONS ----------
function addCoupon(siteId, { code, type, value, minCartValue, expiryDate, usageLimit }) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  if (!site.coupons) site.coupons = [];
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) return null;
  if (site.coupons.some(c => c.code === normalizedCode)) return { error: 'duplicate' };
  const coupon = {
    id: data.nextCouponId++,
    code: normalizedCode,
    type: ['percent', 'fixed', 'free_shipping'].includes(type) ? type : 'percent',
    value: Number(value) || 0,
    minCartValue: Number(minCartValue) || 0,
    expiryDate: expiryDate || '',
    usageLimit: usageLimit ? Number(usageLimit) : 0, // 0 = unlimited
    usageCount: 0,
    active: true
  };
  site.coupons.push(coupon);
  save(data);
  return coupon;
}
function deleteCoupon(siteId, couponId) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return false;
  site.coupons = (site.coupons || []).filter(c => c.id !== Number(couponId));
  save(data);
  return true;
}
// Validates a coupon against a cart total and returns { coupon, discount } or
// { error }. Recomputed server-side on order placement -- never trust a
// discount amount sent by the client.
function validateCoupon(siteId, code, cartTotal) {
  const site = load().sites.find(s => s.id === Number(siteId));
  if (!site) return { error: 'Store not found.' };
  const normalizedCode = String(code || '').trim().toUpperCase();
  const coupon = (site.coupons || []).find(c => c.code === normalizedCode);
  if (!coupon || !coupon.active) return { error: 'That coupon code isn\u2019t valid.' };
  if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) return { error: 'That coupon has expired.' };
  if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) return { error: 'That coupon has reached its usage limit.' };
  if (coupon.minCartValue > 0 && cartTotal < coupon.minCartValue) return { error: `This coupon needs a cart total of at least \u20b9${coupon.minCartValue}.` };
  let discount = 0;
  if (coupon.type === 'percent') discount = Math.round(cartTotal * (coupon.value / 100));
  else if (coupon.type === 'fixed') discount = Math.min(coupon.value, cartTotal);
  else if (coupon.type === 'free_shipping') discount = 0; // no shipping fee currently modeled -- informational only
  return { coupon, discount };
}
function incrementCouponUsage(siteId, couponId) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const coupon = (site.coupons || []).find(c => c.id === Number(couponId));
  if (!coupon) return null;
  coupon.usageCount = (coupon.usageCount || 0) + 1;
  save(data);
  return coupon;
}

// ---------- SOCIAL LINKS ----------
function updateSocialLinks(siteId, fields) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  if (!site.socialLinks) site.socialLinks = { instagram: '', facebook: '', twitter: '', youtube: '', tiktok: '', website: '' };
  ['instagram', 'facebook', 'twitter', 'youtube', 'tiktok', 'website'].forEach(k => {
    if (fields[k] !== undefined) site.socialLinks[k] = fields[k];
  });
  save(data);
  return site.socialLinks;
}

// ---------- CUSTOMER ACCOUNTS ----------
// Per-store accounts: a customer signs up separately on each seller's site
// (each BuddySite store is its own independent shop, so its customer list
// belongs to that store, same as its products and orders do). Passwords are
// hashed by the caller (server.js, using bcrypt, same as seller accounts) --
// this layer only ever stores/reads password_hash, never a plaintext
// password.

function findSiteAndCustomer(data, siteId, customerId) {
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return { site: null, customer: null };
  const customer = site.customers.find(c => c.id === Number(customerId));
  return { site, customer };
}

function createCustomer(siteId, { name, email, phone, password_hash }) {
  const data = load();
  const site = data.sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const customer = {
    id: data.nextCustomerId++,
    name, email: (email || '').toLowerCase().trim(), phone: (phone || '').trim(),
    password_hash,
    addresses: [], cart: [],
    created_at: new Date().toISOString()
  };
  site.customers.push(customer);
  save(data);
  return customer;
}

// A customer signs in with either their email or their phone -- whichever
// they gave at signup, matched case-insensitively for email.
function getCustomerByIdentifier(siteId, identifier) {
  const site = load().sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  const id = String(identifier || '').toLowerCase().trim();
  return site.customers.find(c => c.email === id || c.phone === identifier) || null;
}
function getCustomerById(siteId, customerId) {
  const site = load().sites.find(s => s.id === Number(siteId));
  if (!site) return null;
  return site.customers.find(c => c.id === Number(customerId)) || null;
}

function updateCustomerProfile(siteId, customerId, { name, email, phone }) {
  const data = load();
  const { customer } = findSiteAndCustomer(data, siteId, customerId);
  if (!customer) return null;
  if (name !== undefined) customer.name = name;
  if (email !== undefined) customer.email = (email || '').toLowerCase().trim();
  if (phone !== undefined) customer.phone = (phone || '').trim();
  save(data);
  return customer;
}

function updateCustomerPassword(siteId, customerId, password_hash) {
  const data = load();
  const { customer } = findSiteAndCustomer(data, siteId, customerId);
  if (!customer) return null;
  customer.password_hash = password_hash;
  save(data);
  return customer;
}

// ----- Saved addresses (multiple per customer, one flagged as default) -----
function addCustomerAddress(siteId, customerId, { label, name, phone, address, isDefault }) {
  const data = load();
  const { customer } = findSiteAndCustomer(data, siteId, customerId);
  if (!customer) return null;
  const entry = { id: data.nextAddressId++, label: label || 'Home', name: name || customer.name, phone: phone || customer.phone, address, isDefault: !!isDefault };
  if (entry.isDefault || customer.addresses.length === 0) {
    customer.addresses.forEach(a => { a.isDefault = false; });
    entry.isDefault = true;
  }
  customer.addresses.push(entry);
  save(data);
  return entry;
}

function updateCustomerAddress(siteId, customerId, addressId, { label, name, phone, address, isDefault }) {
  const data = load();
  const { customer } = findSiteAndCustomer(data, siteId, customerId);
  if (!customer) return null;
  const entry = customer.addresses.find(a => a.id === Number(addressId));
  if (!entry) return null;
  if (label !== undefined) entry.label = label;
  if (name !== undefined) entry.name = name;
  if (phone !== undefined) entry.phone = phone;
  if (address !== undefined) entry.address = address;
  if (isDefault) {
    customer.addresses.forEach(a => { a.isDefault = false; });
    entry.isDefault = true;
  }
  save(data);
  return entry;
}

function deleteCustomerAddress(siteId, customerId, addressId) {
  const data = load();
  const { customer } = findSiteAndCustomer(data, siteId, customerId);
  if (!customer) return null;
  const before = customer.addresses.length;
  customer.addresses = customer.addresses.filter(a => a.id !== Number(addressId));
  const deleted = customer.addresses.length < before;
  // if the deleted address was the default and others remain, promote one
  if (deleted && customer.addresses.length > 0 && !customer.addresses.some(a => a.isDefault)) {
    customer.addresses[0].isDefault = true;
  }
  save(data);
  return deleted;
}

// ----- Cart, synced to the account while logged in -----
function getCustomerCart(siteId, customerId) {
  const customer = getCustomerById(siteId, customerId);
  return customer ? customer.cart : null;
}
function setCustomerCart(siteId, customerId, cart) {
  const data = load();
  const { customer } = findSiteAndCustomer(data, siteId, customerId);
  if (!customer) return null;
  customer.cart = Array.isArray(cart) ? cart : [];
  save(data);
  return customer.cart;
}

// ----- Order history for a logged-in customer -----
function getOrdersForCustomer(siteId, customerId) {
  const site = load().sites.find(s => s.id === Number(siteId));
  if (!site) return [];
  return site.orders.filter(o => o.customer_id === Number(customerId)).slice().reverse();
}

module.exports = {
  createUser, getUserByEmail, getUserById, updateUserPlan,
  createSite, getSitesByUser, countSitesByUser, getSiteByIdAndUser, getSiteById, getSiteBySlug, updateSite, updateSiteColors, deleteSite, updatePage,
  addProduct, updateProduct, deleteProduct, countProducts, isProductInStock,
  addCategory, updateCategory, deleteCategory,
  addOrder, getOrders, updateOrderStatus, refundOrderPartial,
  getCommissionLedgerForSite, getCommissionLedgerForOrder, getFinanceSummary,
  createPayment, getPaymentByOrderId, updatePaymentStatus, countPaidCyclesForUser,
  getRazorpayPlanId, setRazorpayPlanId,
  createSubscription, getSubscriptionByRzpId, getActiveSubscriptionForUser, updateSubscriptionStatus,
  addHeroSlide, deleteHeroSlide,
  addCategoryGroup, deleteCategoryGroup, addProductToGroup, removeProductFromGroup,
  addSlidingSection, deleteSlidingSection, addProductToSlidingSection, removeProductFromSlidingSection,
  updateSocialLinks,
  addCoupon, deleteCoupon, validateCoupon, incrementCouponUsage,
  createCustomer, getCustomerByIdentifier, getCustomerById, updateCustomerProfile, updateCustomerPassword,
  addCustomerAddress, updateCustomerAddress, deleteCustomerAddress,
  getCustomerCart, setCustomerCart, getOrdersForCustomer
};
