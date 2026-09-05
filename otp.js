// OTP (one-time password) generation, verification, and delivery.
// Used for the customer "forgot password" flow: customer picks SMS or
// email, gets a 6-digit code, enters it to reset their password and log in.
//
// OTPs are short-lived (5 minutes) and stored in memory only (a Map, not
// data.json) -- there's no reason to persist them to disk, and it keeps
// data.json free of security-sensitive temporary codes. A server restart
// simply invalidates any outstanding OTP, which is fine (the customer just
// requests a new one).
//
// Delivery is safely disabled until you configure real credentials -- see
// .env.example. Until then, requesting an OTP still "succeeds" from the
// customer's point of view in dev, but the code is only logged to the
// server console, never actually sent.

const crypto = require('crypto');

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const otps = new Map(); // key -> { code, expires_at, attempts }

function otpKey(siteId, identifier) {
  return `${siteId}:${String(identifier).toLowerCase().trim()}`;
}

function generateOtp(siteId, identifier) {
  const code = String(crypto.randomInt(100000, 999999));
  otps.set(otpKey(siteId, identifier), { code, expires_at: Date.now() + OTP_TTL_MS, attempts: 0 });
  return code;
}

// Verifies and, on success, CONSUMES the OTP (one-time use). Returns
// { ok: true } or { ok: false, error }.
function verifyOtp(siteId, identifier, code) {
  const key = otpKey(siteId, identifier);
  const entry = otps.get(key);
  if (!entry) return { ok: false, error: 'No OTP was requested for this account, or it already expired. Request a new one.' };
  if (Date.now() > entry.expires_at) { otps.delete(key); return { ok: false, error: 'This OTP has expired. Request a new one.' }; }
  entry.attempts += 1;
  if (entry.attempts > 5) { otps.delete(key); return { ok: false, error: 'Too many incorrect attempts. Request a new OTP.' }; }
  if (entry.code !== String(code).trim()) return { ok: false, error: 'Incorrect OTP.' };
  otps.delete(key); // one-time use
  return { ok: true };
}

const smsEnabled = !!(process.env.SMS_API_URL && process.env.SMS_API_KEY);
const emailEnabled = !!(process.env.EMAIL_API_URL && process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);

if (!smsEnabled) console.log('SMS OTP delivery is disabled -- add SMS_API_URL and SMS_API_KEY to .env to enable it.');
if (!emailEnabled) console.log('Email OTP delivery is disabled -- add EMAIL_API_URL, EMAIL_API_KEY and EMAIL_FROM to .env to enable it.');

async function sendSms(toNumberRaw, message) {
  const to = String(toNumberRaw || '').replace(/[^\d]/g, '');
  if (!to) return { ok: false, error: 'no phone number on file' };
  if (!smsEnabled) { console.log(`[SMS -- not sent, not configured] to ${to}: ${message}`); return { ok: false, error: 'not configured' }; }
  try {
    // Generic SMS gateway request shape (MSG91 / Fast2SMS / Twilio-style
    // providers all accept something close to this). Adjust to your exact
    // provider's docs once you're signed up -- this is a small, isolated
    // edit, same as whatsapp.js's sendMessage().
    const res = await fetch(process.env.SMS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.SMS_API_KEY}` },
      body: JSON.stringify({ to, message, sender_id: process.env.SMS_SENDER_ID || 'BUDDY' })
    });
    if (!res.ok) { console.error(`SMS send failed (${res.status})`); return { ok: false, error: `HTTP ${res.status}` }; }
    return { ok: true };
  } catch (err) {
    console.error('SMS send error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function sendEmail(toEmail, subject, body) {
  if (!toEmail) return { ok: false, error: 'no email on file' };
  if (!emailEnabled) { console.log(`[Email -- not sent, not configured] to ${toEmail}: ${subject} -- ${body}`); return { ok: false, error: 'not configured' }; }
  try {
    // Generic transactional-email API shape (Resend / SendGrid / Postmark
    // all accept something close to this). Adjust to your provider's exact
    // format once chosen.
    const res = await fetch(process.env.EMAIL_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.EMAIL_API_KEY}` },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: toEmail, subject, text: body })
    });
    if (!res.ok) { console.error(`Email send failed (${res.status})`); return { ok: false, error: `HTTP ${res.status}` }; }
    return { ok: true };
  } catch (err) {
    console.error('Email send error:', err.message);
    return { ok: false, error: err.message };
  }
}

// High-level helper used by the forgot-password endpoint: generates an OTP
// and sends it via whichever method the customer chose.
async function requestOtp(siteId, identifier, { method, phone, email, storeName }) {
  const code = generateOtp(siteId, identifier);
  const message = `Your ${storeName || 'BuddySite store'} login OTP is ${code}. It expires in 5 minutes. Do not share this with anyone.`;
  if (method === 'email') return sendEmail(email, 'Your login OTP', message);
  return sendSms(phone, message);
}

module.exports = { generateOtp, verifyOtp, sendSms, sendEmail, requestOtp, smsEnabled, emailEnabled };
