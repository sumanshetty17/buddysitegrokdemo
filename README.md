# BuddySite — your own "mini Shopify"

This is a complete rebuild around your spec: sellers sign up, pick a plan, and get a
real store with product management, categories (Grow+), an orders inbox, and a live
customer-facing shop page with a cart and checkout. Read this whole file once before
doing anything — it's written for someone with zero coding background.

You already know the GitHub upload + Render deploy flow from before, so this README
focuses on what's new and what you need to configure.

---

## What's built

- **Landing page** branded as BuddySite, with an About section and live plan pricing
- **4 plans** (per the Final Pricing & Transaction Commission Specification, v2.0):
  - **Free ₹0/mo** — 1 store, up to 10 products, 2% BuddySite commission
  - **Starter ₹99/mo** — 1 store, up to 50 products, 2% BuddySite commission
  - **Grow ₹299/mo** — 1 store, up to 500 products, 3.5% BuddySite commission
  - **Pro ₹599/mo** — up to 3 stores, unlimited products, 5% BuddySite commission
- **Store admin panel** with a sidebar: Store Settings, Add Product, Manage Products,
  Categories (Grow+), Payment Method, Orders, **Finance / Payouts**, Analytics
- **Real file uploads** — "Choose File" for store background (image or video) and
  product photos, no URL pasting anywhere
- **Live storefront** (`/store/your-store-slug`) with a hero banner, products grouped
  by category, a cart, and a checkout form (name, email, phone, address, payment method:
  COD / UPI / Net Banking / Card)
- **Orders inbox** — every order a customer places shows up for the seller with full
  contact + delivery details, with Mark as Paid / Cancel / Refund actions
- **Commission engine** (`commission-engine.js`) — a fixed, server-side, per-order
  BuddySite platform commission, with an immutable ledger. See below.
- **WhatsApp order notifications** (`whatsapp.js`) — platform-wide: every store
  automatically gets a WhatsApp alert sent to both the seller and the customer the
  moment an order is placed, listing the products, total, and payment method. Sellers
  just add their number under Payment Method — nothing else to configure.
- **Customer accounts, per store** (`/store/:slug/login`, `/store/:slug/account`) — every
  store's customers can sign up, log in, save multiple delivery addresses (with edit and
  delete), see their order history, and keep their cart synced across sessions. Guest
  checkout still works with no account at all. See below.
- **Inventory management** — optional per-product stock tracking, automatic Out of Stock
  handling on the storefront, and server-side enforcement so stock can never go negative
  or be oversold.
- **Store color customization** — sellers can override their theme's accent, button, and
  background colors from Store Settings.

## The BuddySite commission — how it actually works now

BuddySite charges a **fixed transaction/platform commission**: Free 2%, Starter 2%,
Grow 3.5%, Pro 5%. These rates are final (per the product owner's spec) and are
centralized in `plans.js` / `commission-engine.js` — nowhere else in the app should
hard-code a percentage.

- Every order automatically gets a **commission ledger record** (`commissionLedger` in
  `data.json`), calculated **server-side only**, on the merchandise subtotal after
  discounts (shipping and taxes are excluded from the commission base).
- The record freezes the **plan and rate that applied at the moment of the order** — if
  a seller later upgrades or downgrades, past orders keep their original rate.
- Cancelling an order or issuing a full refund reverses the commission; a partial refund
  creates a proportional adjustment. Nothing rewrites the original calculation — every
  change is recorded as an adjustment, so there's a full audit trail.
- Sellers can see the exact breakdown — gross sales, discounts, commissionable sales,
  commission, refunds, net payout, per-order detail — on the new **Finance / Payouts**
  tab (`GET /api/sites/:id/finance`).
- This is a **BuddySite platform commission**, never GST or any government tax, and the
  app never implies it replaces whatever tax a seller owes. GST invoicing is explicitly
  out of scope for this release (see the spec, section 4) — the data model is kept
  extensible so a tax/invoicing module can be added later without touching orders or
  the commission ledger.

### What's *not* yet built: automatic money splitting

Sellers still collect payment themselves via their own payment link — money does not
yet flow through BuddySite and get split automatically. The commission ledger tells
sellers exactly what they owe BuddySite, but doesn't move money yet. Real automatic
settlement (BuddySite instantly keeping its commission and paying the seller the rest)
requires a **marketplace/platform-payments product with commission-and-payout support**
(e.g. Razorpay Route), which needs a separate business approval from the payment
provider. Once that's approved, the ledger built here (`payment_provider_fee`,
`seller_payout_amount`, `status`, `settled_at` fields already exist on every record) is
ready to be wired up to real payouts — ask me and I'll connect it.

## WhatsApp order notifications — how it works

One WhatsApp Business API connection, configured once by you in `.env`, sends order
alerts for **every store on the platform** — sellers don't set up anything themselves,
same as they don't run their own mail server for order emails.

- On every order placed, both the **seller** and the **customer** get a WhatsApp
  message listing the products ordered, the total bill, and the payment method. Nothing
  more (no shipping updates, no marketing, no abandoned-cart nudges — those would be
  separate features).
- Sellers add their own WhatsApp number once, under **Payment Method** in their store
  admin. The customer's number is already collected at checkout.
- **This is safely disabled until you configure it.** With no credentials in `.env`,
  orders still go through completely normally — the WhatsApp send is skipped and logged
  instead of attempted, so nothing breaks.

### To turn it on

1. Sign up with a WhatsApp Business Solution Provider — **Gupshup, Interakt, or WATI**
   are the common choices for India and are much faster to get approved with than going
   directly to Meta. (Twilio also works if you're already using them for other things.)
2. From your BSP, get: the API endpoint you send messages to, an API key, and the
   WhatsApp number you'll be sending from.
3. **Important:** WhatsApp/Meta generally requires a pre-approved message **template**
   for messages sent to someone who didn't message you first (which is the case here —
   a customer places an order on your website, not by starting a WhatsApp chat). Get
   that template approved on your BSP's dashboard before relying on this in production;
   until then, some messages may be rejected by WhatsApp itself. This is a WhatsApp
   policy step you do on the BSP's side, not something in this codebase.
4. Copy `.env.example` to `.env` (if you haven't already) and fill in
   `WHATSAPP_API_URL`, `WHATSAPP_API_KEY`, `WHATSAPP_SENDER_NUMBER`, and
   `WHATSAPP_TEMPLATE_NAME`. Restart the server — it's live for every store immediately.

The message-sending code (`whatsapp.js`) is written against a generic "send a text
message" API shape that most BSPs support directly. If your BSP's exact request format
differs, it's a small, isolated edit to the `sendMessage()` function — send me your
BSP's API docs once you're signed up and I'll adjust it to match exactly.

## Customer accounts, per store

Every store built on BuddySite gets its own customer account system — a customer signs
up separately on each seller's store, since each store is its own independent shop
(the same way sellers don't share one account across stores). **This is additive, not a
requirement to buy** — guest checkout still works exactly as before with no account at
all.

**What a customer gets, once they sign up (`/store/<slug>/login`, `/store/<slug>/account`):**
- Log in with email or phone + password; the login page also shows a Sign Up tab
- Multiple saved delivery addresses, each with **Edit** and **Delete**, one flagged as
  default; a picker at checkout lets them choose which one an order should go to
  (still fully editable, or they can type a fresh address instead)
- Full order history, tied to their account (guest orders never show up here — there's
  no account to tie them to)
- A cart that's saved to their account and follows them back if they log in again later
  (merged with whatever's already in the browser, so nothing gets lost)
- **Forgot password → OTP.** They choose SMS or email, get a 6-digit code (5-minute
  expiry, single use, locks out after 5 wrong attempts), enter it, and set a new
  password — logged in immediately.

**Security notes, already handled:** passwords are hashed with bcrypt (same as seller
accounts), a customer's login token is cryptographically tied to the one store they
signed up on (a token from Store A is rejected on Store B, verified end-to-end), and
OTPs are single-use and expire.

**To turn on SMS/email OTP delivery** (safely disabled until configured — orders and
accounts work fine either way, the OTP just gets logged instead of sent):
1. Sign up with an SMS gateway (MSG91, Fast2SMS, or Twilio are common choices for India)
   and/or a transactional email API (Resend, SendGrid, Postmark).
2. Copy `.env.example` to `.env` and fill in `SMS_API_URL` / `SMS_API_KEY` for SMS,
   and/or `EMAIL_API_URL` / `EMAIL_API_KEY` / `EMAIL_FROM` for email. You don't need
   both — a customer can only pick a delivery method their account actually has (email
   or phone) on file.
3. Restart the server. Like WhatsApp, the request shape in `otp.js` is generic and may
   need a small tweak to match your exact provider's docs — send them over once you're
   signed up.

## Auto-pay (recurring subscriptions) -- NEW

Sellers can now click **"Enable Auto-Pay"** on their dashboard to stop manually renewing
every month. Here's exactly how it works, and what you need to set up once:

**How it works for the seller:**
- Their first ₹99 x 2 intro payments stay as manual one-time payments (already working)
- Once they're ready, they click "Enable Auto-Pay" and authorize a mandate (UPI Autopay
  or card) at their plan's **regular** price
- From then on, Razorpay automatically charges them every month -- no action needed on
  their end, or yours

**Why the price is fixed at "regular," not ₹99:** UPI and card auto-pay mandates lock in
a maximum amount the moment the customer authorizes them, and that amount can't be
silently raised later without asking them to re-authorize. So auto-pay always starts at
the plan's regular price, which is the technically correct and honest way to do this.

**One-time setup you need to do (5 minutes):**
1. Go to Razorpay Dashboard -> Account & Settings -> **Webhooks**
2. Click **Add New Webhook**
3. Webhook URL: `https://yourdomain.com/api/webhooks/razorpay` (use your real Render URL)
4. Enable these events: `subscription.charged`, `subscription.activated`,
   `subscription.authenticated`, `subscription.cancelled`, `subscription.halted`,
   `subscription.completed`
5. Razorpay will show you a **Webhook Secret** -- copy it
6. Add it to your `.env` (locally) and Render's Environment tab as `RAZORPAY_WEBHOOK_SECRET`
7. Redeploy

Without this webhook set up, sellers can still turn auto-pay on, but your server won't
know when a renewal payment succeeds, so their plan won't automatically extend each month.

## Environment setup (same as before)

Copy `.env.example` to `.env` and fill in:
- `JWT_SECRET` — any random words
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — from your Razorpay dashboard (this is for
  your **subscription billing** from sellers, separate from the seller's own payment link)

## Updating your live site

Same process as before:
1. `npm install` locally to test (`npm start`, visit `http://localhost:3000`)
2. Upload changed files to GitHub (drag into the `sitebuilder` folder in your repo,
   matching the same file paths, commit)
3. Render auto-redeploys within a minute or two

**Files changed in this rebuild:** almost everything. Easiest is to re-upload the whole
`sitebuilder` folder contents again (same process as your very first upload), replacing
everything. Don't upload `node_modules`, `package-lock.json`, `.env`, `data.json`, or
`uploads/` — those are excluded on purpose.

## What this still doesn't include (roadmap ideas)

Per the Final Pricing & Transaction Commission Specification's phased roadmap (section 9):

- **Automatic commission settlement** — real money splitting via a marketplace payment
  provider (waiting on Razorpay Route or equivalent business approval); today the
  commission is calculated and shown to sellers, but not auto-deducted
- **SMS/email OTP delivery isn't live yet** — same "safely disabled until configured"
  pattern as WhatsApp; the customer-accounts forgot-password flow is fully built and
  tested, it just needs real SMS/email provider credentials in `.env` (see above)
- Order "shipped" / "delivered" status tracking beyond new/paid/fulfilled/cancelled/refunded
- Product variants (size/color as separate SKUs with their own stock — a basic single
  "size" list already exists, this is a full variant system), custom domains, deeper
  WhatsApp commerce (catalog sharing, "order via WhatsApp" checkout, abandoned-cart
  nudges — order-placed alerts are already built), shipping integrations, customer CRM
  (seller-facing — customer *self-service* accounts are already built), reviews,
  wishlist, abandoned-cart recovery, deeper analytics, SEO automation, Buddy AI,
  drag-and-drop page builder, theme marketplace, marketing integrations, loyalty/referrals,
  staff accounts (multi-user per plan)
- **GST invoicing is intentionally out of scope** for this release (spec section 4) —
  do not add it without a fresh product decision, and never label the BuddySite
  commission as GST when you do

Happy to build any of these next — just ask.
