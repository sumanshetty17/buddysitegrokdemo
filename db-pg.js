/**
 * PostgreSQL data layer for BuddySite (Render).
 * Same function names as db-json.js, all async.
 * Nested store data (products, orders, customers, ...) is stored as JSONB
 * on the sites row so business logic stays almost identical.
 */
const { Pool } = require('pg');
const commissionEngine = require('./commission-engine');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000
});

async function query(text, params) {
  return pool.query(text, params);
}

async function nextCounter(name) {
  const r = await query(
    `INSERT INTO counters (name, value) VALUES ($1, 2)
     ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [name]
  );
  // After increment, value is the new next id; previous was value-1 for the id we use
  return r.rows[0].value - 1;
}

function emptyPage() {
  return { content: [], background_url: '', background_type: 'image' };
}

function defaultSiteData() {
  return {
    customColors: {},
    description: '',
    description_align: 'center',
    description_size: 'medium',
    description_font: 'inter',
    background_url: '',
    background_type: 'image',
    payment_link: '',
    whatsapp_number: '',
    customers: [],
    products: [],
    categories: [],
    orders: [],
    aboutPage: emptyPage(),
    contactPage: emptyPage(),
    heroSlides: [],
    categoryGroups: [],
    slidingSections: [],
    brandStory: emptyPage(),
    socialLinks: { instagram: '', facebook: '', twitter: '', youtube: '', tiktok: '', website: '' },
    cartPosition: 'bottom',
    storeNamePosition: 'left',
    logoVideoUrl: '',
    logoVideoPosition: 'left',
    coupons: []
  };
}

function withPageDefaults(site) {
  if (!site) return site;
  const d = site.data || {};
  const out = {
    id: site.id,
    user_id: site.user_id,
    slug: site.slug,
    store_name: site.store_name,
    theme: site.theme || 'simple',
    published: site.published ? 1 : 0,
    created_at: site.created_at,
    ...defaultSiteData(),
    ...d
  };
  if (!out.aboutPage) out.aboutPage = emptyPage();
  if (!out.contactPage) out.contactPage = emptyPage();
  if (!out.brandStory) out.brandStory = emptyPage();
  if (!Array.isArray(out.products)) out.products = [];
  if (!Array.isArray(out.categories)) out.categories = [];
  if (!Array.isArray(out.orders)) out.orders = [];
  if (!Array.isArray(out.customers)) out.customers = [];
  if (!Array.isArray(out.coupons)) out.coupons = [];
  if (!Array.isArray(out.heroSlides)) out.heroSlides = [];
  if (!Array.isArray(out.categoryGroups)) out.categoryGroups = [];
  if (!Array.isArray(out.slidingSections)) out.slidingSections = [];
  if (!out.customColors) out.customColors = {};
  if (!out.socialLinks) out.socialLinks = { instagram: '', facebook: '', twitter: '', youtube: '', tiktok: '', website: '' };
  out.products.forEach(p => {
    if (p.trackInventory === undefined) p.trackInventory = false;
    if (p.stock === undefined) p.stock = null;
    if (!Array.isArray(p.images)) p.images = p.image ? [p.image] : [];
    if (!Array.isArray(p.sizes)) p.sizes = p.size ? [p.size] : [];
  });
  out.customers.forEach(c => {
    if (!Array.isArray(c.addresses)) c.addresses = [];
    if (!Array.isArray(c.cart)) c.cart = [];
  });
  return out;
}

function sitePayloadFromRow(row) {
  return withPageDefaults(row);
}

function dataFromSite(site) {
  const skip = new Set(['id', 'user_id', 'slug', 'store_name', 'theme', 'published', 'created_at']);
  const data = {};
  for (const [k, v] of Object.entries(site)) {
    if (!skip.has(k)) data[k] = v;
  }
  return data;
}

async function saveSiteData(siteId, siteObj) {
  const data = dataFromSite(siteObj);
  await query(
    `UPDATE sites SET store_name = $1, theme = $2, published = $3, data = $4::jsonb WHERE id = $5`,
    [siteObj.store_name, siteObj.theme || 'simple', siteObj.published ? 1 : 0, JSON.stringify(data), siteId]
  );
}

async function loadSiteRow(id) {
  const r = await query(`SELECT * FROM sites WHERE id = $1`, [Number(id)]);
  return r.rows[0] || null;
}

async function loadSite(id) {
  const row = await loadSiteRow(id);
  return row ? sitePayloadFromRow(row) : null;
}

// ---------- USERS ----------
async function createUser({ name, email, password_hash }) {
  const r = await query(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
     RETURNING id, name, email, password_hash, plan, plan_renews_at, paid_cycles, created_at`,
    [name, email, password_hash]
  );
  const u = r.rows[0];
  return { ...u, paid_cycles: u.paid_cycles || 0, plan: u.plan || null, plan_renews_at: u.plan_renews_at || null };
}

async function getUserByEmail(email) {
  const r = await query(`SELECT * FROM users WHERE email = $1`, [email]);
  return r.rows[0] || undefined;
}

async function getUserById(id) {
  const r = await query(`SELECT * FROM users WHERE id = $1`, [Number(id)]);
  return r.rows[0] || undefined;
}

async function updateUserPlan(userId, plan, renewsAt) {
  const r = await query(
    `UPDATE users SET plan = $1, plan_renews_at = $2, paid_cycles = COALESCE(paid_cycles, 0) + 1
     WHERE id = $3 RETURNING *`,
    [plan, renewsAt, Number(userId)]
  );
  return r.rows[0] || null;
}

// ---------- SITES ----------
async function createSite({ user_id, slug, store_name, theme }) {
  const data = defaultSiteData();
  const r = await query(
    `INSERT INTO sites (user_id, slug, store_name, theme, published, data)
     VALUES ($1, $2, $3, $4, 0, $5::jsonb) RETURNING *`,
    [Number(user_id), slug, store_name, theme || 'simple', JSON.stringify(data)]
  );
  return sitePayloadFromRow(r.rows[0]);
}

async function getSitesByUser(userId) {
  const r = await query(`SELECT * FROM sites WHERE user_id = $1 ORDER BY id`, [Number(userId)]);
  return r.rows.map(sitePayloadFromRow);
}

async function countSitesByUser(userId) {
  const r = await query(`SELECT COUNT(*)::int AS c FROM sites WHERE user_id = $1`, [Number(userId)]);
  return r.rows[0].c;
}

async function getSiteByIdAndUser(id, userId) {
  const r = await query(`SELECT * FROM sites WHERE id = $1 AND user_id = $2`, [Number(id), Number(userId)]);
  return r.rows[0] ? sitePayloadFromRow(r.rows[0]) : undefined;
}

async function getSiteById(id) {
  return loadSite(id);
}

async function getSiteBySlug(slug) {
  const r = await query(`SELECT * FROM sites WHERE slug = $1`, [slug]);
  return r.rows[0] ? sitePayloadFromRow(r.rows[0]) : undefined;
}

async function updateSite(id, fields) {
  const site = await loadSite(id);
  if (!site) return null;
  ['store_name', 'description', 'description_align', 'description_size', 'description_font',
    'background_url', 'background_type', 'payment_link', 'whatsapp_number', 'published', 'theme',
    'cartPosition', 'storeNamePosition', 'logoVideoUrl', 'logoVideoPosition'].forEach(f => {
    if (fields[f] !== undefined) site[f] = f === 'published' ? (fields[f] ? 1 : 0) : fields[f];
  });
  await saveSiteData(id, site);
  return site;
}

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{3}$|^#[0-9A-Fa-f]{6}$/;
function isValidHexColor(v) { return typeof v === 'string' && HEX_COLOR_RE.test(v.trim()); }

async function updateSiteColors(siteId, colors) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const ALLOWED = ['accent', 'accentDark', 'btnBg', 'btnText', 'bg', 'ink'];
  const next = Object.assign({}, site.customColors || {});
  for (const field of ALLOWED) {
    if (colors[field] === undefined) continue;
    const v = colors[field];
    if (v === '' || v === null) { delete next[field]; continue; }
    if (!isValidHexColor(v)) return { error: `"${field}" must be a hex color like #FF6A88.` };
    next[field] = v.trim();
  }
  site.customColors = next;
  await saveSiteData(siteId, site);
  return { site };
}

async function deleteSite(id) {
  await query(`DELETE FROM sites WHERE id = $1`, [Number(id)]);
}

async function updatePage(siteId, pageKey, fields) {
  const site = await loadSite(siteId);
  if (!site) return null;
  if (!site[pageKey]) site[pageKey] = emptyPage();
  if (fields.content !== undefined) site[pageKey].content = fields.content;
  if (fields.background_url !== undefined) site[pageKey].background_url = fields.background_url;
  if (fields.background_type !== undefined) site[pageKey].background_type = fields.background_type;
  await saveSiteData(siteId, site);
  return site[pageKey];
}

// ---------- PRODUCTS ----------
async function addProduct(siteId, { name, price, originalPrice, image, images, sizes, size, color, description, categoryId, sizeGuide, trackInventory, stock }) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const imgList = (Array.isArray(images) && images.length) ? images.filter(Boolean) : (image ? [image] : []);
  const sizeList = Array.isArray(sizes) ? sizes.filter(Boolean) : (size ? [size] : []);
  const id = await nextCounter('nextProductId');
  const product = {
    id, name, price: Number(price) || 0,
    originalPrice: originalPrice ? Number(originalPrice) || 0 : 0,
    image: imgList[0] || '', images: imgList,
    sizes: sizeList, size: sizeList[0] || '', color: color || '', description: description || '',
    categoryId: categoryId || null,
    sizeGuide: sizeGuide && sizeGuide.content && sizeGuide.content.length
      ? { title: sizeGuide.title || 'Size Guide', content: sizeGuide.content } : { title: '', content: [] },
    trackInventory: !!trackInventory,
    stock: trackInventory ? (Number(stock) || 0) : null
  };
  site.products.push(product);
  await saveSiteData(siteId, site);
  return product;
}

async function updateProduct(siteId, productId, fields) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const p = site.products.find(x => x.id === Number(productId));
  if (!p) return null;
  if (fields.images !== undefined) {
    const imgList = Array.isArray(fields.images) ? fields.images.filter(Boolean) : [];
    p.images = imgList; p.image = imgList[0] || '';
  } else if (fields.image !== undefined) {
    p.image = fields.image; p.images = fields.image ? [fields.image] : [];
  }
  if (fields.sizes !== undefined) {
    const sizeList = Array.isArray(fields.sizes) ? fields.sizes.filter(Boolean) : [];
    p.sizes = sizeList; p.size = sizeList[0] || '';
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
  if (fields.stock !== undefined && p.trackInventory) p.stock = Math.max(0, Number(fields.stock) || 0);
  await saveSiteData(siteId, site);
  return p;
}

async function deleteProduct(siteId, productId) {
  const site = await loadSite(siteId);
  if (!site) return false;
  site.products = site.products.filter(p => p.id !== Number(productId));
  (site.categoryGroups || []).forEach(g => { g.productIds = (g.productIds || []).filter(id => id !== Number(productId)); });
  (site.slidingSections || []).forEach(g => { g.productIds = (g.productIds || []).filter(id => id !== Number(productId)); });
  await saveSiteData(siteId, site);
  return true;
}

async function countProducts(siteId) {
  const site = await loadSite(siteId);
  return site ? site.products.length : 0;
}

function isProductInStock(product, qty) {
  if (!product.trackInventory) return true;
  return (product.stock || 0) >= qty;
}

function applyStockDelta(site, items, delta) {
  (items || []).forEach(item => {
    const product = site.products.find(p => p.id === item.id);
    if (product && product.trackInventory) {
      product.stock = Math.max(0, (product.stock || 0) + delta * item.qty);
    }
  });
}

// ---------- CATEGORIES ----------
async function addCategory(siteId, name, image) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const id = await nextCounter('nextCategoryId');
  const category = { id, name, image: image || '' };
  site.categories.push(category);
  await saveSiteData(siteId, site);
  return category;
}

async function updateCategory(siteId, categoryId, { name, image }) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const cat = site.categories.find(c => c.id === Number(categoryId));
  if (!cat) return null;
  if (name !== undefined) cat.name = name;
  if (image !== undefined) cat.image = image;
  await saveSiteData(siteId, site);
  return cat;
}

async function deleteCategory(siteId, categoryId) {
  const site = await loadSite(siteId);
  if (!site) return false;
  site.categories = site.categories.filter(c => c.id !== Number(categoryId));
  site.products.forEach(p => { if (p.categoryId === Number(categoryId)) p.categoryId = null; });
  await saveSiteData(siteId, site);
  return true;
}

// ---------- ORDERS + COMMISSION ----------
async function addOrder(siteId, { customerName, email, phone, address, paymentMethod, items, total, couponCode, discount, subtotal, whatsapp_opt_in, customer_id }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sr = await client.query(`SELECT * FROM sites WHERE id = $1 FOR UPDATE`, [Number(siteId)]);
    if (!sr.rows[0]) { await client.query('ROLLBACK'); return null; }
    const site = sitePayloadFromRow(sr.rows[0]);

    for (const item of items) {
      const product = site.products.find(p => p.id === item.id);
      if (product && product.trackInventory && (product.stock || 0) < item.qty) {
        await client.query('ROLLBACK');
        return { error: 'OUT_OF_STOCK', productName: product.name, available: product.stock || 0 };
      }
    }

    const orderId = (await client.query(
      `INSERT INTO counters (name, value) VALUES ('nextOrderId', 2)
       ON CONFLICT (name) DO UPDATE SET value = counters.value + 1 RETURNING value`
    )).rows[0].value - 1;

    const status = paymentMethod === 'COD' ? 'new' : 'awaiting_payment';
    const order = {
      id: orderId, customerName, email, phone, address, paymentMethod, items, total,
      couponCode: couponCode || '', discount: discount || 0,
      whatsapp_opt_in: whatsapp_opt_in !== false, customer_id: customer_id || null,
      status, created_at: new Date().toISOString()
    };
    site.orders.push(order);
    applyStockDelta(site, items, -1);

    const ur = await client.query(`SELECT * FROM users WHERE id = $1`, [site.user_id]);
    const seller = ur.rows[0];
    const planKey = (seller && seller.plan) || 'free';
    const orderSubtotal = subtotal !== undefined ? subtotal : (total + (discount || 0));
    const ledgerRecord = commissionEngine.buildLedgerRecord({
      id: 0, order_id: order.id, store_id: site.id, seller_id: site.user_id,
      planKey, subtotal: orderSubtotal, discount: discount || 0
    });

    const lr = await client.query(
      `INSERT INTO commission_ledger (
        order_id, store_id, seller_id, plan_at_transaction, commission_rate_at_transaction,
        commission_base_amount, commission_amount, currency, payment_provider_fee,
        seller_payout_amount, status, refund_adjustment_amount, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        ledgerRecord.order_id, ledgerRecord.store_id, ledgerRecord.seller_id,
        ledgerRecord.plan_at_transaction, ledgerRecord.commission_rate_at_transaction,
        ledgerRecord.commission_base_amount, ledgerRecord.commission_amount, ledgerRecord.currency,
        ledgerRecord.payment_provider_fee, ledgerRecord.seller_payout_amount, ledgerRecord.status,
        ledgerRecord.refund_adjustment_amount, ledgerRecord.created_at
      ]
    );
    order.commission_id = lr.rows[0].commission_id;

    const data = dataFromSite(site);
    await client.query(
      `UPDATE sites SET data = $1::jsonb WHERE id = $2`,
      [JSON.stringify(data), siteId]
    );
    await client.query('COMMIT');
    return order;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getOrders(siteId) {
  const site = await loadSite(siteId);
  return site ? site.orders.slice().reverse() : [];
}

async function updateOrderStatus(siteId, orderId, status) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const order = site.orders.find(o => o.id === Number(orderId));
  if (!order) return null;
  const previousStatus = order.status;
  order.status = status;
  const wasClosed = previousStatus === 'cancelled' || previousStatus === 'refunded';
  const isClosed = status === 'cancelled' || status === 'refunded';

  const lr = await query(
    `SELECT * FROM commission_ledger WHERE order_id = $1 AND store_id = $2`,
    [order.id, site.id]
  );
  const record = lr.rows[0];

  if (isClosed && !wasClosed && record) {
    commissionEngine.reverseLedgerRecord(record);
    order.refunded_amount = status === 'refunded' ? order.total : 0;
    if (status === 'cancelled') applyStockDelta(site, order.items, +1);
    await query(
      `UPDATE commission_ledger SET status = $1, refund_adjustment_amount = $2 WHERE commission_id = $3`,
      [record.status, record.refund_adjustment_amount, record.commission_id]
    );
  }
  if (wasClosed && !isClosed && record) {
    await query(
      `UPDATE commission_ledger SET status = 'pending', refund_adjustment_amount = 0 WHERE commission_id = $1`,
      [record.commission_id]
    );
    order.refunded_amount = 0;
    if (previousStatus === 'cancelled') applyStockDelta(site, order.items, -1);
  }

  await saveSiteData(siteId, site);
  return order;
}

async function refundOrderPartial(siteId, orderId, refundAmount) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const order = site.orders.find(o => o.id === Number(orderId));
  if (!order) return null;
  const lr = await query(
    `SELECT * FROM commission_ledger WHERE order_id = $1 AND store_id = $2`,
    [order.id, site.id]
  );
  const record = lr.rows[0];
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
  await query(
    `UPDATE commission_ledger SET status = $1, refund_adjustment_amount = $2 WHERE commission_id = $3`,
    [record.status, record.refund_adjustment_amount, record.commission_id]
  );
  await saveSiteData(siteId, site);
  return { order, ledgerRecord: record };
}

async function getCommissionLedgerForSite(siteId) {
  const r = await query(
    `SELECT * FROM commission_ledger WHERE store_id = $1 ORDER BY commission_id DESC`,
    [Number(siteId)]
  );
  return r.rows.map(row => ({
    commission_id: row.commission_id,
    order_id: row.order_id,
    store_id: row.store_id,
    seller_id: row.seller_id,
    plan_at_transaction: row.plan_at_transaction,
    commission_rate_at_transaction: Number(row.commission_rate_at_transaction),
    commission_base_amount: Number(row.commission_base_amount),
    commission_amount: Number(row.commission_amount),
    currency: row.currency,
    payment_provider_fee: row.payment_provider_fee,
    seller_payout_amount: row.seller_payout_amount != null ? Number(row.seller_payout_amount) : null,
    status: row.status,
    refund_adjustment_amount: Number(row.refund_adjustment_amount || 0),
    created_at: row.created_at,
    settled_at: row.settled_at
  }));
}

async function getCommissionLedgerForOrder(siteId, orderId) {
  const list = await getCommissionLedgerForSite(siteId);
  return list.find(r => r.order_id === Number(orderId));
}

async function getFinanceSummary(siteId) {
  const ledger = await getCommissionLedgerForSite(siteId);
  const site = await loadSite(siteId);
  const orders = site ? site.orders : [];
  const orderById = new Map(orders.map(o => [o.id, o]));
  let grossSales = 0, discounts = 0, commissionable = 0, commission = 0, refunds = 0, netPayout = 0;
  const ledgerOut = ledger.map(r => {
    const order = orderById.get(r.order_id) || null;
    const net = commissionEngine.netCommission(r);
    const orderRefundedAmount = order ? (order.refunded_amount || 0) : 0;
    const isCancelled = order && order.status === 'cancelled';
    if (order && !isCancelled) {
      grossSales += (r.commission_base_amount + (order.discount || 0));
      discounts += (order.discount || 0);
      commissionable += r.commission_base_amount;
      commission += net;
      refunds += orderRefundedAmount;
      netPayout += r.commission_base_amount - orderRefundedAmount - net;
    }
    return {
      ...r,
      netCommission: net,
      orderStatus: order ? order.status : null,
      orderRefundedAmount,
      isCancelled: !!isCancelled
    };
  });
  return {
    grossSales, discounts, commissionableSales: commissionable,
    commission, refunds, netPayout, ledger: ledgerOut
  };
}

// ---------- PAYMENTS / SUBSCRIPTIONS (minimal, matching API) ----------
async function createPayment({ user_id, plan, amount_paise, razorpay_order_id, status }) {
  const r = await query(
    `INSERT INTO payments (user_id, plan, amount_paise, razorpay_order_id, status)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [user_id, plan, amount_paise, razorpay_order_id, status]
  );
  return r.rows[0];
}

async function getPaymentByOrderId(razorpay_order_id) {
  const r = await query(`SELECT * FROM payments WHERE razorpay_order_id = $1`, [razorpay_order_id]);
  return r.rows[0];
}

async function updatePaymentStatus(razorpay_order_id, status) {
  const r = await query(
    `UPDATE payments SET status = $1 WHERE razorpay_order_id = $2 RETURNING *`,
    [status, razorpay_order_id]
  );
  return r.rows[0];
}

async function countPaidCyclesForUser(userId) {
  const r = await query(
    `SELECT COUNT(*)::int AS c FROM payments WHERE user_id = $1 AND status = 'paid'`,
    [Number(userId)]
  );
  return r.rows[0].c;
}

async function getRazorpayPlanId(planKey) {
  const r = await query(`SELECT razorpay_plan_id FROM razorpay_plans WHERE plan_key = $1`, [planKey]);
  return r.rows[0] ? r.rows[0].razorpay_plan_id : null;
}

async function setRazorpayPlanId(planKey, razorpayPlanId) {
  await query(
    `INSERT INTO razorpay_plans (plan_key, razorpay_plan_id) VALUES ($1,$2)
     ON CONFLICT (plan_key) DO UPDATE SET razorpay_plan_id = $2`,
    [planKey, razorpayPlanId]
  );
}

async function createSubscription({ user_id, plan, razorpay_subscription_id, status }) {
  const r = await query(
    `INSERT INTO subscriptions (user_id, plan, razorpay_subscription_id, status)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [user_id, plan, razorpay_subscription_id, status]
  );
  return r.rows[0];
}

async function getSubscriptionByRzpId(rzpId) {
  const r = await query(`SELECT * FROM subscriptions WHERE razorpay_subscription_id = $1`, [rzpId]);
  return r.rows[0];
}

async function getActiveSubscriptionForUser(userId) {
  const r = await query(
    `SELECT * FROM subscriptions WHERE user_id = $1 AND status IN ('active','authenticated') ORDER BY id DESC LIMIT 1`,
    [Number(userId)]
  );
  return r.rows[0];
}

async function updateSubscriptionStatus(rzpId, status) {
  const r = await query(
    `UPDATE subscriptions SET status = $1 WHERE razorpay_subscription_id = $2 RETURNING *`,
    [status, rzpId]
  );
  return r.rows[0];
}

// ---------- Homepage builders, coupons, customers (JSONB on site) ----------
async function addHeroSlide(siteId, { image, heading, subtext, link }) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const id = await nextCounter('nextHeroSlideId');
  const slide = { id, image, heading: heading || '', subtext: subtext || '', link: link || '' };
  site.heroSlides.push(slide);
  await saveSiteData(siteId, site);
  return slide;
}
async function deleteHeroSlide(siteId, slideId) {
  const site = await loadSite(siteId);
  if (!site) return;
  site.heroSlides = site.heroSlides.filter(s => s.id !== Number(slideId));
  await saveSiteData(siteId, site);
}

async function addCategoryGroup(siteId, { title, productIds }) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const id = await nextCounter('nextCategoryGroupId');
  const group = { id, title, productIds: productIds || [] };
  site.categoryGroups.push(group);
  await saveSiteData(siteId, site);
  return group;
}
async function deleteCategoryGroup(siteId, groupId) {
  const site = await loadSite(siteId);
  if (!site) return;
  site.categoryGroups = site.categoryGroups.filter(g => g.id !== Number(groupId));
  await saveSiteData(siteId, site);
}
async function addProductToGroup(siteId, groupId, productId) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const g = site.categoryGroups.find(x => x.id === Number(groupId));
  if (!g) return null;
  if (!g.productIds.includes(Number(productId))) g.productIds.push(Number(productId));
  await saveSiteData(siteId, site);
  return g;
}
async function removeProductFromGroup(siteId, groupId, productId) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const g = site.categoryGroups.find(x => x.id === Number(groupId));
  if (!g) return null;
  g.productIds = g.productIds.filter(id => id !== Number(productId));
  await saveSiteData(siteId, site);
  return g;
}

async function addSlidingSection(siteId, { title, productIds }) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const id = await nextCounter('nextSlidingSectionId');
  const section = { id, title, productIds: productIds || [] };
  site.slidingSections.push(section);
  await saveSiteData(siteId, site);
  return section;
}
async function deleteSlidingSection(siteId, sectionId) {
  const site = await loadSite(siteId);
  if (!site) return;
  site.slidingSections = site.slidingSections.filter(s => s.id !== Number(sectionId));
  await saveSiteData(siteId, site);
}
async function addProductToSlidingSection(siteId, sectionId, productId) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const s = site.slidingSections.find(x => x.id === Number(sectionId));
  if (!s) return null;
  if (!s.productIds.includes(Number(productId))) s.productIds.push(Number(productId));
  await saveSiteData(siteId, site);
  return s;
}
async function removeProductFromSlidingSection(siteId, sectionId, productId) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const s = site.slidingSections.find(x => x.id === Number(sectionId));
  if (!s) return null;
  s.productIds = s.productIds.filter(id => id !== Number(productId));
  await saveSiteData(siteId, site);
  return s;
}

async function updateSocialLinks(siteId, fields) {
  const site = await loadSite(siteId);
  if (!site) return null;
  site.socialLinks = Object.assign({}, site.socialLinks, fields);
  await saveSiteData(siteId, site);
  return site.socialLinks;
}

async function addCoupon(siteId, { code, type, value, minCartValue, expiryDate, usageLimit }) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const id = await nextCounter('nextCouponId');
  const coupon = {
    id, code: String(code || '').toUpperCase(), type, value: Number(value) || 0,
    minCartValue: Number(minCartValue) || 0, expiryDate: expiryDate || null,
    usageLimit: usageLimit != null ? Number(usageLimit) : null, usageCount: 0, active: true
  };
  site.coupons.push(coupon);
  await saveSiteData(siteId, site);
  return coupon;
}
async function deleteCoupon(siteId, couponId) {
  const site = await loadSite(siteId);
  if (!site) return;
  site.coupons = site.coupons.filter(c => c.id !== Number(couponId));
  await saveSiteData(siteId, site);
}
async function validateCoupon(siteId, code, cartTotal) {
  const site = await loadSite(siteId);
  if (!site) return { error: 'Store not found' };
  const coupon = site.coupons.find(c => c.code === String(code || '').toUpperCase() && c.active);
  if (!coupon) return { error: 'Invalid coupon code' };
  if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) return { error: 'Coupon expired' };
  if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) return { error: 'Coupon usage limit reached' };
  if (cartTotal < (coupon.minCartValue || 0)) return { error: `Minimum cart value ₹${coupon.minCartValue}` };
  return { coupon };
}
async function incrementCouponUsage(siteId, couponId) {
  const site = await loadSite(siteId);
  if (!site) return;
  const c = site.coupons.find(x => x.id === Number(couponId));
  if (c) { c.usageCount = (c.usageCount || 0) + 1; await saveSiteData(siteId, site); }
}

// ---------- CUSTOMERS ----------
async function createCustomer(siteId, { name, email, phone, password_hash }) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const id = await nextCounter('nextCustomerId');
  const customer = {
    id, name, email: email || '', phone: phone || '', password_hash,
    addresses: [], cart: [], created_at: new Date().toISOString()
  };
  site.customers.push(customer);
  await saveSiteData(siteId, site);
  return customer;
}
async function getCustomerByIdentifier(siteId, identifier) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const id = String(identifier || '').toLowerCase();
  return site.customers.find(c =>
    (c.email && c.email.toLowerCase() === id) || (c.phone && c.phone === identifier)
  ) || null;
}
async function getCustomerById(siteId, customerId) {
  const site = await loadSite(siteId);
  if (!site) return null;
  return site.customers.find(c => c.id === Number(customerId)) || null;
}
async function updateCustomerProfile(siteId, customerId, { name, email, phone }) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const c = site.customers.find(x => x.id === Number(customerId));
  if (!c) return null;
  if (name !== undefined) c.name = name;
  if (email !== undefined) c.email = email;
  if (phone !== undefined) c.phone = phone;
  await saveSiteData(siteId, site);
  return c;
}
async function updateCustomerPassword(siteId, customerId, password_hash) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const c = site.customers.find(x => x.id === Number(customerId));
  if (!c) return null;
  c.password_hash = password_hash;
  await saveSiteData(siteId, site);
  return c;
}
async function addCustomerAddress(siteId, customerId, { label, name, phone, address, isDefault }) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const c = site.customers.find(x => x.id === Number(customerId));
  if (!c) return null;
  const id = await nextCounter('nextAddressId');
  if (isDefault) c.addresses.forEach(a => { a.isDefault = false; });
  const addr = { id, label: label || 'Home', name, phone, address, isDefault: !!isDefault };
  c.addresses.push(addr);
  await saveSiteData(siteId, site);
  return addr;
}
async function updateCustomerAddress(siteId, customerId, addressId, { label, name, phone, address, isDefault }) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const c = site.customers.find(x => x.id === Number(customerId));
  if (!c) return null;
  const a = c.addresses.find(x => x.id === Number(addressId));
  if (!a) return null;
  if (isDefault) c.addresses.forEach(x => { x.isDefault = false; });
  if (label !== undefined) a.label = label;
  if (name !== undefined) a.name = name;
  if (phone !== undefined) a.phone = phone;
  if (address !== undefined) a.address = address;
  if (isDefault !== undefined) a.isDefault = !!isDefault;
  await saveSiteData(siteId, site);
  return a;
}
async function deleteCustomerAddress(siteId, customerId, addressId) {
  const site = await loadSite(siteId);
  if (!site) return false;
  const c = site.customers.find(x => x.id === Number(customerId));
  if (!c) return false;
  c.addresses = c.addresses.filter(a => a.id !== Number(addressId));
  await saveSiteData(siteId, site);
  return true;
}
async function getCustomerCart(siteId, customerId) {
  const c = await getCustomerById(siteId, customerId);
  return c ? (c.cart || []) : [];
}
async function setCustomerCart(siteId, customerId, cart) {
  const site = await loadSite(siteId);
  if (!site) return null;
  const c = site.customers.find(x => x.id === Number(customerId));
  if (!c) return null;
  c.cart = Array.isArray(cart) ? cart : [];
  await saveSiteData(siteId, site);
  return c.cart;
}
async function getOrdersForCustomer(siteId, customerId) {
  const site = await loadSite(siteId);
  if (!site) return [];
  return site.orders.filter(o => o.customer_id === Number(customerId)).slice().reverse();
}

async function initSchema() {
  const fs = require('fs');
  const path = require('path');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(schema);
}

module.exports = {
  initSchema, pool,
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
