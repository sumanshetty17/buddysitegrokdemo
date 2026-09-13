/**
 * Preview server: static files + enough APIs for signup, dashboard, stores, help bot.
 * Uses db-json (no Express / bcrypt / jwt packages required).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { answer } = require('./help-bot');
const db = require('./db-json');
const { PLANS, DISCOUNT_PERCENT, WATERMARK_ADDON, watermarkPricePaise, isWatermarkHidden } = require('./plans');

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8080);
const HOST = '0.0.0.0';
const SECRET = process.env.JWT_SECRET || 'buddysite-preview-secret';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.zip': 'application/zip'
};

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
function checkPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('scrypt:')) {
    const [, salt, hash] = stored.split(':');
    const check = crypto.scryptSync(password, salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  }
  return stored === password;
}
function makeToken(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 7 * 86400000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function readToken(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig !== expect) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp && data.exp < Date.now()) return null;
    return data.userId;
  } catch (_) { return null; }
}
function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, plan: u.plan, plan_renews_at: u.plan_renews_at,
    watermark_until: u.watermark_until || null,
    watermark_purchases: u.watermark_purchases || 0,
    watermark_hidden: isWatermarkHidden(u)
  };
}
function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'store';
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => {
      raw += c;
      if (raw.length > 2e6) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const method = req.method;
  const pathName = url.split('?')[0];

  if (method === 'POST' && pathName === '/api/help/chat') {
    const body = await readBody(req);
    const result = await answer(body.message || '');
    return json(res, 200, result);
  }
  if (method === 'POST' && pathName === '/api/help/feedback') return json(res, 200, { ok: true });

  if (method === 'GET' && pathName === '/api/billing/plans') {
    return json(res, 200, { plans: Object.values(PLANS), razorpayEnabled: false, discountPercent: DISCOUNT_PERCENT });
  }

  if (method === 'POST' && pathName === '/api/auth/signup') {
    const { name, email, password } = await readBody(req);
    if (!name || !email || !password) return json(res, 400, { error: 'Name, email and password are all required.' });
    if (String(password).length < 6) return json(res, 400, { error: 'Password must be at least 6 characters.' });
    const normalizedEmail = String(email).toLowerCase().trim();
    if (await db.getUserByEmail(normalizedEmail)) return json(res, 400, { error: 'An account with that email already exists.' });
    const user = await db.createUser({ name: String(name).trim(), email: normalizedEmail, password_hash: hashPassword(password) });
    return json(res, 200, { token: makeToken(user.id), user: publicUser(user) });
  }

  if (method === 'POST' && pathName === '/api/auth/login') {
    const { email, password } = await readBody(req);
    const user = await db.getUserByEmail(String(email || '').toLowerCase().trim());
    if (!user || !checkPassword(password || '', user.password_hash)) {
      return json(res, 401, { error: 'Incorrect email or password.' });
    }
    return json(res, 200, { token: makeToken(user.id), user: publicUser(user) });
  }

  const userId = readToken(req);
  const needAuth = pathName.startsWith('/api/');
  if (needAuth && !userId && pathName !== '/api/billing/plans') {
    return json(res, 401, { error: 'Please log in again.' });
  }

  if (method === 'GET' && pathName === '/api/auth/me') {
    const user = await db.getUserById(userId);
    if (!user) return json(res, 404, { error: 'Account not found.' });
    return json(res, 200, { user: publicUser(user) });
  }

  if (method === 'GET' && pathName === '/api/sites') {
    return json(res, 200, { sites: await db.getSitesByUser(userId) });
  }

  if (method === 'POST' && pathName === '/api/sites') {
    const user = await db.getUserById(userId);
    if (!user.plan || !PLANS[user.plan]) return json(res, 403, { error: 'Please choose a plan before creating a store.' });
    const plan = PLANS[user.plan];
    if (await db.countSitesByUser(userId) >= plan.max_sites) {
      return json(res, 403, { error: `Your ${plan.name} plan allows up to ${plan.max_sites} store(s).` });
    }
    const body = await readBody(req);
    const chosenTheme = body.theme || 'simple';
    if (!plan.availableThemes.includes(chosenTheme)) {
      return json(res, 403, { error: `The "${chosenTheme}" theme isn't available on your ${plan.name} plan.` });
    }
    const name = body.store_name || 'My Store';
    const slug = slugify(name) + '-' + Date.now().toString().slice(-5);
    const site = await db.createSite({ user_id: userId, slug, store_name: name, theme: chosenTheme });
    return json(res, 200, { site });
  }

  const siteMatch = pathName.match(/^\/api\/sites\/(\d+)$/);
  if (siteMatch && method === 'GET') {
    const site = await db.getSiteByIdAndUser(siteMatch[1], userId);
    if (!site) return json(res, 404, { error: 'Store not found.' });
    return json(res, 200, { site });
  }

  if (method === 'POST' && pathName === '/api/billing/demo-activate') {
    const { plan } = await readBody(req);
    if (!PLANS[plan]) return json(res, 400, { error: 'Unknown plan.' });
    const renews = new Date(); renews.setMonth(renews.getMonth() + 1);
    const user = await db.updateUserPlan(userId, plan, renews.toISOString());
    return json(res, 200, { ok: true, user: publicUser(user) });
  }

  if (method === 'GET' && pathName === '/api/billing/watermark') {
    const user = await db.getUserById(userId);
    const purchases = (user && user.watermark_purchases) || 0;
    return json(res, 200, {
      hidden: isWatermarkHidden(user),
      until: user && user.watermark_until,
      purchases,
      firstOffer: purchases < 1,
      amount_paise: watermarkPricePaise(purchases),
      regular_paise: WATERMARK_ADDON.regular_paise,
      first_paise: WATERMARK_ADDON.first_paise,
      months: WATERMARK_ADDON.months
    });
  }

  if (method === 'POST' && pathName === '/api/billing/watermark/demo-activate') {
    const user = await db.applyWatermarkAddon(userId);
    if (!user) return json(res, 404, { error: 'Account not found.' });
    return json(res, 200, { ok: true, user: publicUser(user) });
  }

  if (method === 'GET' && pathName === '/api/billing/autopay-status') {
    return json(res, 200, { enabled: false });
  }

  return json(res, 404, { error: 'Not found.' });
}

function serveFile(reqPath, res) {
  let rel = decodeURIComponent(reqPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    const ext = path.extname(file);
    send(res, 200, data, TYPES[ext] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/api/')) {
    try { await handleApi(req, res, url); }
    catch (e) { json(res, 500, { error: e.message || 'Something went wrong.' }); }
    return;
  }
  serveFile(url, res);
});

server.listen(PORT, HOST, () => {
  console.log(`BuddySite preview on http://${HOST}:${PORT}`);
});
