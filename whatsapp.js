// WhatsApp order notifications
// -----------------------------
// One BuddySite-wide WhatsApp Business API connection sends order alerts for
// EVERY store on the platform -- sellers don't set up anything themselves,
// same way they don't run their own mail server for order emails. As soon
// as this is configured with real credentials, every existing and new
// store gets the feature automatically.
//
// Scope (per product decision): on every order placed, send a WhatsApp
// message to BOTH the seller and the customer containing: the products
// ordered, the total bill, and the payment method. Nothing else (no
// shipping updates, no marketing, no abandoned-cart messages -- those are
// separate features, not built here).
//
// Setup required before this actually sends anything (see README):
//   1. A WhatsApp Business Solution Provider (Gupshup / Interakt / WATI /
//      Twilio) account, or direct Meta Cloud API access.
//   2. Set WHATSAPP_API_URL, WHATSAPP_API_KEY, WHATSAPP_SENDER_NUMBER in .env.
//   3. If your BSP/Meta requires an approved message TEMPLATE for
//      proactive (business-initiated) messages -- most do, once you're
//      outside a 24-hour customer-service window -- get that template
//      approved on the BSP/Meta side first, and set WHATSAPP_TEMPLATE_NAME.
//      Until a template is approved, plain text sends may be rejected by
//      WhatsApp for messages the customer didn't start -- that's a
//      WhatsApp/Meta policy, not something this code can bypass.
//
// Until configured, sends are safely logged instead of attempted, exactly
// like Razorpay's razorpayEnabled pattern elsewhere in this app -- nothing
// breaks, orders still go through, you just don't get the WhatsApp message
// until credentials are added.

const whatsappEnabled = !!(process.env.WHATSAPP_API_URL && process.env.WHATSAPP_API_KEY && process.env.WHATSAPP_SENDER_NUMBER);

if (!whatsappEnabled) {
  console.log('WhatsApp order notifications are disabled -- add WHATSAPP_API_URL, WHATSAPP_API_KEY and WHATSAPP_SENDER_NUMBER to .env to enable them.');
}

function formatOrderMessage({ storeName, order, audience }) {
  const lines = order.items.map(i => `• ${i.name} × ${i.qty} — ₹${(i.price * i.qty).toFixed(2)}`).join('\n');
  const heading = audience === 'seller'
    ? `🛒 New order on ${storeName}!`
    : `✅ Your order from ${storeName} is placed!`;
  return [
    heading,
    '',
    lines,
    '',
    `Total: ₹${order.total.toFixed(2)}`,
    `Payment method: ${order.paymentMethod}`
  ].join('\n');
}

// Normalises a phone number to E.164-ish digits-only (WhatsApp APIs
// generally want country code + number, no spaces/dashes/plus).
function normalizeNumber(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return null;
  // Assume India (91) if a 10-digit local number was entered without a
  // country code -- adjust here if BuddySite expands beyond India.
  return digits.length === 10 ? `91${digits}` : digits;
}

// Sends one WhatsApp message. Returns { ok: true } or { ok: false, error }.
// Never throws -- callers should treat this as best-effort and never let a
// WhatsApp failure block order creation.
async function sendMessage(toNumberRaw, text) {
  const to = normalizeNumber(toNumberRaw);
  if (!to) return { ok: false, error: 'no phone number on file' };

  if (!whatsappEnabled) {
    console.log(`[WhatsApp -- not sent, not configured] to ${to}:\n${text}\n`);
    return { ok: false, error: 'not configured' };
  }

  try {
    // Generic BSP request shape -- most providers (Gupshup, Interakt, WATI)
    // accept a simple { to, from, message } style POST, or proxy the Meta
    // Cloud API shape directly. Adjust this payload to match your chosen
    // BSP's docs once you have them; this is intentionally the simplest
    // common denominator so it's a small edit, not a rewrite.
    const res = await fetch(process.env.WHATSAPP_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WHATSAPP_API_KEY}`
      },
      body: JSON.stringify({
        from: process.env.WHATSAPP_SENDER_NUMBER,
        to,
        type: 'text',
        text: { body: text },
        // If your BSP/Meta requires a pre-approved template for this
        // message (common for business-initiated messages), set
        // WHATSAPP_TEMPLATE_NAME and adapt this block to your provider's
        // template-send format instead of the plain text block above.
        template_name: process.env.WHATSAPP_TEMPLATE_NAME || undefined
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`WhatsApp send failed (${res.status}) to ${to}: ${body}`);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
    return { ok: false, error: err.message };
  }
}

// Fires the seller + customer order alerts. Fire-and-forget from the
// caller's point of view -- never rejects, never throws, and a WhatsApp
// failure never blocks or fails order creation.
//
// notifyCustomer defaults to true (the checkout checkbox defaults to
// checked) -- pass false when the customer explicitly unchecked "Send me
// order updates on WhatsApp" at checkout. This only affects the customer's
// message; the seller is always notified, since they opted in themselves
// by adding their number in Payment Method.
async function sendOrderNotifications({ storeName, sellerNumber, order, notifyCustomer = true }) {
  const results = { seller: null, customer: null };

  if (sellerNumber) {
    results.seller = await sendMessage(sellerNumber, formatOrderMessage({ storeName, order, audience: 'seller' }));
  } else {
    results.seller = { ok: false, error: 'seller has not added a WhatsApp number in Payment Method' };
  }

  if (!notifyCustomer) {
    results.customer = { ok: false, error: 'customer opted out at checkout' };
  } else if (order.phone) {
    results.customer = await sendMessage(order.phone, formatOrderMessage({ storeName, order, audience: 'customer' }));
  } else {
    results.customer = { ok: false, error: 'no customer phone number on the order' };
  }

  return results;
}

module.exports = { whatsappEnabled, sendOrderNotifications, formatOrderMessage, normalizeNumber };
