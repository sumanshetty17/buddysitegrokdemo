/**
 * BuddySite seller help bot.
 * Answers from a built-in knowledge base. If XAI_API_KEY or OPENAI_API_KEY
 * is set, can use a real LLM with the same knowledge as system context.
 */

const KNOWLEDGE = `
BuddySite is a multi-seller e-commerce platform (like a simple Shopify).
Sellers create their own online stores. Customers shop on each store.

PLANS (subscription the seller pays BuddySite):
- Free: ₹0, 20 products, 2% commission
- Starter: ₹99/mo, 100 products, 2% commission
- Grow: ₹299/mo, 1000 products, 3.5% commission — includes homepage slider, category sections, sliding products
- Pro: ₹599/mo, unlimited products, up to 3 stores, 5% commission
Commission is charged on the product subtotal after discount, frozen at order time.
WATERMARK: every plan shows “Made with BuddySite”. Sellers can remove it as an add-on: first 6 months ₹299 (50% off), then ₹599 every 6 months. When it expires the watermark returns. Dashboard → Remove watermark.

STORES:
- Create a store from the Dashboard after choosing a plan.
- Each store has a unique URL slug (e.g. /s/your-store-name).
- Theme styles: simple, bold, aesthetic. Sellers can also set custom colors on Pro.
- Publish the store so customers can see it.

PRODUCTS:
- Add products in Store Admin → Products: name, price, images, sizes, description, category.
- Inventory tracking is optional; when on, stock decreases on order.
- Plan limits how many products you can add.

ORDERS:
- COD orders start as "new". Online payment orders start as "awaiting_payment".
- Sellers update status: new → processing → shipped → delivered, or cancel/refund.
- Cancelling restores stock and reverses commission. Refunds adjust commission proportionally.

FINANCE / COMMISSION:
- Finance page shows gross sales, discounts, commission, refunds, net payout.
- Commission rate is locked per order at the plan rate when the order was placed.
- payment_provider_fee is for Razorpay fees (when Route is enabled later).

CUSTOMERS:
- Storefront customers can sign up, log in, save addresses, cart, and order history.
- OTP for password reset uses SMS/email if configured in .env.

PAYMENTS:
- Platform subscriptions use Razorpay (seller pays BuddySite for plans).
- Store customer payments: payment link / COD until Route is enabled for auto commission split.

COUPONS:
- Percent, fixed amount, or free shipping. Min cart value, expiry, usage limit.

WHATSAPP:
- Optional order alerts to seller's WhatsApp number if WHATSAPP_* env is set.


HOMEPAGE / STOREFRONT BUILDER FEATURES:
- Hero slides (Grow and Pro): multi-slide banner at the top of the store homepage. Each slide can have an image, heading, subtext, and optional link. Add/remove slides in Store Admin under Homepage Slider.
- Category groups / category sections (Grow and Pro): titled sections on the homepage that show a hand-picked list of products.
- Sliding sections / slide product rows (Grow and Pro): named horizontal carousel rows of products on the homepage.
- Brand story: about-the-brand block (available on plans that include it) for your story/about text on the storefront.
- Social links: Instagram, Facebook, Twitter/X, YouTube, TikTok, website URL shown on the store.
- Cart position: floating bottom button or top bar cart icon.
- Store name position and optional logo video.
- Custom colors (theme color overrides): accent, buttons, background, text — mainly Pro; only valid hex colors allowed.
- Categories: group products by category; category images on higher plans.
- About page and Contact page: editable page content with optional background image/video.
- Themes: simple, bold, aesthetic presets; custom colors layer on top.

WHAT "SLIDE PRODUCT" MEANS:
- On BuddySite this usually means products placed inside a Sliding Section (a sliding/carousel product row on the homepage), not a separate product type.
- Hero slides are banner slides (image + text), not products themselves.

HOW TO USE SECTIONS:
1. Open your store from Dashboard → Store Admin.
2. Use the sidebar for Products, Categories, Orders, Finance, and homepage tools (Hero slides, Category groups, Sliding sections) when your plan allows them.
3. For a sliding product row: create a Sliding section → give it a title → add products to it.
4. For a category-style homepage block: create a Category group → title → add products.
5. Publish the store so customers see the changes.

COMMON HOW-TO:
- Change plan: Dashboard → Plans section.
- Add product: open store → Products → Add.
- View orders: Store Admin → Orders.
- See earnings/commission: Store Admin → Finance.
- Custom domain / staff: depend on plan features in the feature matrix.
`.trim();

const FAQ = [
  {
    keys: ['slide product', 'sliding section', 'sliding sections', 'product row', 'slide products', 'carousel'],
    answer: 'A “slide product” row is a Sliding Section: a titled horizontal carousel of products on your homepage (Pro plan). In Store Admin go to Sliding sections → create a section → set a title → add products. Customers scroll that row on your live store. This is different from Hero slides (top banners).'
  },
  {
    keys: ['hero slide', 'hero slides', 'hero banner', 'homepage banner', 'slideshow'],
    answer: 'Hero slides are large banner images at the top of your store homepage (Pro). Each slide can have an image, heading, subtext, and optional link. Add them under Hero slides in Store Admin. Hero slides are not products.'
  },
  {
    keys: ['category section', 'category group', 'category groups', 'homepage section'],
    answer: 'Category groups (category sections) are titled homepage blocks that show products you choose (Pro). Create a group, set a title, attach products. Regular Categories organize the product catalog; category groups are for featured homepage layouts.'
  },
  {
    keys: ['brand story', 'about page', 'contact page', 'about brand'],
    answer: 'Brand story is an about-the-brand section on the storefront. About and Contact pages are separate editable pages. Edit them from Store Admin page settings.'
  },
  {
    keys: ['custom color', 'theme color', 'accent color'],
    answer: 'On Pro you can set custom theme colors (accent, buttons, background, text) with hex codes like #6366f1. Invalid colors are rejected for safety.'
  },
  {
    keys: ['plan', 'pricing', 'subscription', 'upgrade', 'free plan', 'starter', 'grow', 'pro plan', 'commission rate'],
    answer: 'BuddySite plans: Free (2% commission), Starter (2%), Grow (3.5%), Pro (5%). Commission is on sale subtotal after discount. Upgrade from Dashboard → Plans. Pro unlocks hero slides, category groups, sliding sections, and custom colors.'
  },
  {
    keys: ['add product', 'inventory', 'stock', 'upload photo', 'product'],
    answer: 'Open your store from the Dashboard → Products → Add. Set name, price, photos, sizes, description. Optional inventory tracking decreases stock when customers order. Your plan limits how many products you can add.'
  },
  {
    keys: ['order', 'cod', 'shipping', 'order status', 'cancel', 'refund'],
    answer: 'Orders are under Store Admin → Orders. COD starts as New; online as Awaiting payment. Update status as you pack and ship. Cancel restores stock and reverses commission. Refunds adjust commission on the Finance page.'
  },
  {
    keys: ['commission', 'finance', 'payout', 'earning', 'net payout'],
    answer: 'Open Store Admin → Finance for gross sales, discounts, BuddySite commission, refunds, and net payout. Commission rate is frozen when the order is placed, so a later plan change does not rewrite old orders.'
  },
  {
    keys: ['create store', 'publish', 'unpublish', 'draft', 'slug', 'theme', 'store'],
    answer: 'After choosing a plan, click + New store on the Dashboard. Pick a name and style (simple / bold / aesthetic). Publish so customers can visit. Pro unlocks more homepage sections and custom colors.'
  },
  {
    keys: ['customer account', 'customer login', 'saved address', 'customer cart'],
    answer: 'Your storefront supports customer accounts: sign up, log in, addresses, cart, and order history. Each seller’s store and customers are separate.'
  },
  {
    keys: ['coupon', 'discount code', 'promo code'],
    answer: 'Create coupons in Store Admin: percent off, fixed amount, or free shipping. You can set minimum cart value, expiry, and usage limit.'
  },
  {
    keys: ['razorpay', 'payment link', 'get paid', 'payment'],
    answer: 'You pay BuddySite for plans via Razorpay on the Dashboard. For customer checkout use COD or a payment link until marketplace Route is enabled for automatic commission split and seller payout.'
  },
  {
    keys: ['whatsapp', 'order alert', 'notification'],
    answer: 'Add your WhatsApp number in store settings. If the platform has WhatsApp API configured, you can receive order alerts.'
  },
  {
    keys: ['social link', 'instagram', 'facebook', 'youtube', 'tiktok'],
    answer: 'Add Instagram, Facebook, Twitter/X, YouTube, TikTok, or website links in Store Admin. They show on your live storefront.'
  },
  {
    keys: ['hello', 'hi', 'hey', 'help'],
    answer: 'Hi! I’m the BuddySite helper. Ask about plans, products, hero slides, sliding product sections, category groups, orders, commission, coupons, publishing, and more.'
  }
];

function matchFaq(message) {
  const q = String(message || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const item of FAQ) {
    let score = 0;
    for (const k of item.keys) {
      if (q.includes(k)) {
        // Longer / multi-word keys rank higher so "slide product" beats "product"
        score += k.length * (k.includes(' ') ? 3 : 1);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  if (best && bestScore > 0) return best.answer;
  return null;
}


async function callLlm(userMessage) {
  const xaiKey = process.env.XAI_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  const key = xaiKey || openAiKey;
  if (!key) return null;

  const url = xaiKey
    ? 'https://api.x.ai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const model = xaiKey ? (process.env.XAI_MODEL || 'grok-2-latest') : (process.env.OPENAI_MODEL || 'gpt-4o-mini');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content:
            'You are BuddySite Helper, a friendly support assistant for sellers using the BuddySite store builder. ' +
            'Answer only about how to use BuddySite. Be short and clear. If something is not in the knowledge, say you are not sure and suggest checking Store Admin or Dashboard.\n\n' +
            KNOWLEDGE
        },
        { role: 'user', content: userMessage }
      ]
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('AI service error: ' + res.status + ' ' + errText.slice(0, 200));
  }
  const data = await res.json();
  return data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content.trim()
    : null;
}

/**
 * Main entry: returns { answer, source: 'faq'|'ai'|'fallback' }
 */
async function answer(message) {
  const text = String(message || '').trim();
  if (!text) return { answer: 'Please type a question about BuddySite.', source: 'fallback' };

  // Prefer real AI when configured
  try {
    const ai = await callLlm(text);
    if (ai) return { answer: ai, source: 'ai' };
  } catch (e) {
    // fall through to FAQ
  }

  const faq = matchFaq(text);
  if (faq) return { answer: faq, source: 'faq' };

  return {
    answer:
      'I can help with plans, products, orders, commission/finance, coupons, publishing your store, and customer accounts. Try asking something like “How do I add a product?” or “What is my commission?”',
    source: 'fallback'
  };
}

module.exports = { answer, KNOWLEDGE };
