const express = require('express');
const app = express();
const path = require('path');
const { init, pool, settingsDb, stripeAccounts, customers, subscriptions, payments, activityLog, webhookLogs, security, adminUsers } = require('./db');
let speakeasy, QRCode;
try { speakeasy = require('speakeasy'); QRCode = require('qrcode'); } catch(e) {}

const Stripe = require('stripe');
const crypto = require('crypto');


// ── Shopify OAuth helpers ───────────────────────────────────────────────────
function shopifyConfig() {
  const appUrl = (process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
  return {
    apiKey: process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_CLIENT_ID || '',
    apiSecret: process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_CLIENT_SECRET || '',
    appUrl,
    redirectUri: process.env.SHOPIFY_REDIRECT_URI || (appUrl ? `${appUrl}/api/shopify/callback` : ''),
    scopes: process.env.SHOPIFY_SCOPES || 'read_customers,read_orders,read_products,write_products'
  };
}
function normalizeShopDomain(input) {
  let shop = String(input || '').trim().toLowerCase();
  shop = shop.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (shop.startsWith('admin.shopify.com')) return '';
  if (!shop.endsWith('.myshopify.com')) shop += '.myshopify.com';
  return shop;
}
function signShopifyState(shop) {
  const secret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_CLIENT_SECRET || SUBLOOP_AUTH_SECRET;
  const payload = `${shop}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}
function verifyShopifyState(state, shop) {
  try {
    const secret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_CLIENT_SECRET || SUBLOOP_AUTH_SECRET;
    const decoded = Buffer.from(String(state || ''), 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 4) return false;
    const sig = parts.pop();
    const payload = parts.join(':');
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const [stateShop, ts] = parts;
    return stateShop === shop && (Date.now() - Number(ts)) < 15 * 60 * 1000;
  } catch (_) { return false; }
}
function verifyShopifyQueryHmac(query) {
  try {
    const { hmac, signature, ...rest } = query;
    if (!hmac) return false;
    const secret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_CLIENT_SECRET || '';
    if (!secret) return false;
    const message = Object.keys(rest).sort().map(key => `${key}=${Array.isArray(rest[key]) ? rest[key].join(',') : rest[key]}`).join('&');
    const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
    return digest.length === String(hmac).length && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(hmac)));
  } catch (_) { return false; }
}
async function shopifyGraphql(shopDomain, accessToken, query, variables = {}) {
  const response = await fetch(`https://${shopDomain}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
    body: JSON.stringify({ query, variables })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.errors) throw new Error(data.errors ? JSON.stringify(data.errors) : `Shopify API error ${response.status}`);
  return data.data;
}
async function syncShopifyStoreBasics(storeId, shopDomain, accessToken) {
  try {
    const data = await shopifyGraphql(shopDomain, accessToken, `query { shop { name myshopifyDomain currencyCode } }`);
    const shop = data?.shop || {};
    await pool.query('UPDATE shopify_stores SET name=$1, status=$2, updated_at=NOW() WHERE id=$3', [shop.name || shopDomain, 'connected', storeId]);
  } catch (err) {
    await pool.query('UPDATE shopify_stores SET webhook_status=$1, updated_at=NOW() WHERE id=$2', ['api-check-failed', storeId]).catch(()=>{});
  }
}


// Admin access tokens and Stripe-account scoping.
// Set SUBLOOP_AUTH_SECRET in Railway for tokens that remain valid after a deploy/restart.
const SUBLOOP_AUTH_SECRET = process.env.SUBLOOP_AUTH_SECRET || crypto.randomBytes(48).toString('hex');
const ANALYST_DEFAULT_SECTIONS = ['dashboard','customers','payments','forecast','summary','mrr','recovery','shopify-dashboard','shopify-customers','shopify-orders','shopify-subscriptions'];
// View-only users may be assigned any non-administrative operating/reporting page, but cannot write.
const ANALYST_ASSIGNABLE_SECTIONS = ['dashboard','activity','customers','subscriptions','payments','links','accounts','forecast','summary','mrr','recovery','webhooks','shopify-dashboard','shopify-activity','shopify-customers','shopify-subscriptions','shopify-orders','shopify-products','shopify-stores','shopify-recovery'];
// Custom users manage selected operating pages only; all operations remain constrained to their account scope.
const CUSTOM_ASSIGNABLE_SECTIONS = ['dashboard','activity','customers','subscriptions','payments','links','accounts','forecast','summary','mrr','recovery','webhooks','shopify-dashboard','shopify-activity','shopify-customers','shopify-subscriptions','shopify-orders','shopify-products','shopify-stores','shopify-recovery'];
function b64url(value) { return Buffer.from(value).toString('base64url'); }
function issueAdminToken(user, purpose='access', maxAgeMinutes=480) {
  const payload = { id: user.id, username: user.username, purpose, exp: Date.now() + (maxAgeMinutes * 60 * 1000) };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SUBLOOP_AUTH_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function parseAdminToken(token, purpose='access') {
  try {
    if (!token || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SUBLOOP_AUTH_SECRET).update(body).digest('base64url');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || data.purpose !== purpose || Number(data.exp) < Date.now()) return null;
    return data;
  } catch (_err) { return null; }
}
function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}
function normalizeAllowedAccountIds(user) {
  const list = Array.isArray(user?.allowed_account_ids) ? user.allowed_account_ids : [];
  return list.map(Number).filter(Number.isInteger);
}
function isOwnerOrAdmin(user) { return !!user && (user.role === 'owner' || user.role === 'admin'); }
function isReadOnlyUser(user) { return !!user && (user.role === 'analyst' || user.role === 'viewer'); }
function sanitizeSections(role, permissions) {
  const list = Array.isArray(permissions) ? [...new Set(permissions.map(String))] : [];
  if (role === 'analyst' || role === 'viewer') return list.filter(section => ANALYST_ASSIGNABLE_SECTIONS.includes(section));
  if (role === 'custom') return list.filter(section => CUSTOM_ASSIGNABLE_SECTIONS.includes(section));
  return [];
}
function userSections(user) {
  if (!user) return [];
  if (isOwnerOrAdmin(user)) return null;
  const allowed = sanitizeSections(user.role, user.permissions);
  return allowed.length ? allowed : (isReadOnlyUser(user) ? ANALYST_DEFAULT_SECTIONS : []);
}
function canUseSection(user, section) {
  const sections = userSections(user);
  return sections === null || sections.includes(section);
}
function scopedAccountIds(req) {
  if (!req.currentUser || isOwnerOrAdmin(req.currentUser) || req.currentUser.account_scope !== 'selected') return null;
  return normalizeAllowedAccountIds(req.currentUser);
}
function rowWithinScope(req, row) {
  const ids = scopedAccountIds(req);
  return ids === null || ids.includes(Number(row?.stripe_account_id));
}
function accessResponse(user) {
  return { role: user.role, username: user.username, permissions: user.permissions || [], account_scope: user.account_scope || 'all', allowed_account_ids: normalizeAllowedAccountIds(user) };
}
function sectionForApiPath(req) {
  const path = req.path;
  if (path.startsWith('/stats') || path.startsWith('/revenue-chart') || path.startsWith('/churn-alerts')) return 'dashboard';
  if (path.startsWith('/customers')) return 'customers';
  if (path.startsWith('/subscriptions')) return 'subscriptions';
  if (path.startsWith('/payments')) return 'payments';
  if (path.startsWith('/payment-link-accounts') || path.startsWith('/payment-links') || path.startsWith('/plan-templates')) return 'links';
  if (path.startsWith('/stripe-accounts')) return 'accounts';
  if (path.startsWith('/forecast')) return 'forecast';
  if (path.startsWith('/daily-summary')) return 'summary';
  if (path.startsWith('/mrr-history')) return 'mrr';
  if (path.startsWith('/recovery-rate')) return 'recovery';
  if (path.startsWith('/activity')) return 'activity';
  if (path.startsWith('/settings')) return 'settings';
  if (path.startsWith('/security')) return 'security';
  if (path.startsWith('/webhook-logs')) return 'webhooks';
  if (path.startsWith('/admin-users')) return 'admins';
  if (path.startsWith('/shopify/stores')) return 'shopify-stores';
  if (path.startsWith('/shopify/customers')) return 'shopify-customers';
  if (path.startsWith('/shopify/orders')) return 'shopify-orders';
  if (path.startsWith('/shopify/subscriptions')) return 'shopify-subscriptions';
  if (path.startsWith('/shopify/products')) return 'shopify-products';
  if (path.startsWith('/shopify/activity')) return 'shopify-activity';
  if (path.startsWith('/shopify/recovery')) return 'shopify-recovery';
  if (path.startsWith('/shopify/overview')) return 'shopify-dashboard';
  return null;
}
function requireOwnerOrAdmin(req, res) {
  if (!isOwnerOrAdmin(req.currentUser)) { res.status(403).json({ error: 'Owner or admin access required' }); return false; }
  return true;
}
function ensureRowScope(req, res, row) {
  if (!row || !rowWithinScope(req, row)) { res.status(403).json({ error: 'This Stripe account is not assigned to your access.' }); return false; }
  return true;
}

// Estimated currency conversion for analytics/dashboard only.
// Amounts are stored in their original Stripe currency; these helpers convert analytics totals to USD cents.
const USD_ESTIMATE_RATES = {
  usd: 1,
  gbp: 1.34,
  eur: 1.1702,
  cad: 0.7297,
  aud: 0.7152,
  nzd: 0.5855,
  chf: 1.279,
  sek: 0.1072,
  nok: 0.094,
  dkk: 0.1566,
  pln: 0.2761,
  czk: 0.04815,
  mad: 0.109,
  mxn: 0.0578,
  brl: 0.19,
  jpy: 0.00633,
  inr: 0.012,
  aed: 0.2723,
  sar: 0.2666
};
function usdRateSql(alias) {
  const c = alias ? `${alias}.currency` : 'currency';
  return `(CASE LOWER(COALESCE(${c}, 'usd'))
    WHEN 'usd' THEN 1
    WHEN 'gbp' THEN 1.34
    WHEN 'eur' THEN 1.1702
    WHEN 'cad' THEN 0.7297
    WHEN 'aud' THEN 0.7152
    WHEN 'nzd' THEN 0.5855
    WHEN 'chf' THEN 1.279
    WHEN 'sek' THEN 0.1072
    WHEN 'nok' THEN 0.094
    WHEN 'dkk' THEN 0.1566
    WHEN 'pln' THEN 0.2761
    WHEN 'czk' THEN 0.04815
    WHEN 'mad' THEN 0.109
    WHEN 'mxn' THEN 0.0578
    WHEN 'brl' THEN 0.19
    WHEN 'jpy' THEN 0.00633
    WHEN 'inr' THEN 0.012
    WHEN 'aed' THEN 0.2723
    WHEN 'sar' THEN 0.2666
    ELSE 1.0 END)`;
}
function usdAmountSql(alias) {
  const a = alias ? `${alias}.amount` : 'amount';
  return `ROUND(${a} * ${usdRateSql(alias)})`;
}
function toUsdCents(amount, currency) {
  const rate = USD_ESTIMATE_RATES[String(currency || 'usd').toLowerCase()] || 1;
  return Math.round((Number(amount) || 0) * rate);
}

async function ensureWebhookColumns() {
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_brand TEXT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_last4 TEXT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_exp_month INT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_exp_year INT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_country TEXT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_funding TEXT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method_type TEXT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS wallet_type TEXT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS wallet_checked BOOLEAN DEFAULT FALSE').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_fee INT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS net_amount INT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS balance_transaction_id TEXT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS financial_currency TEXT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS retry_of_payment_id INT REFERENCES payments(id)').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS was_failed BOOLEAN DEFAULT false').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS recovered_at TIMESTAMPTZ').catch(()=>{});
  await pool.query('ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT').catch(()=>{});
  await pool.query('ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_price_id TEXT').catch(()=>{});
  await pool.query('ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT').catch(()=>{});
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_uidx ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL').catch(()=>{});
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_payment_intent_uidx ON payments(stripe_payment_intent) WHERE stripe_payment_intent IS NOT NULL').catch(()=>{});
}


async function ensureShopifyTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS shopify_stores (
    id SERIAL PRIMARY KEY,
    name TEXT,
    shop_domain TEXT UNIQUE NOT NULL,
    access_token TEXT,
    status TEXT DEFAULT 'connected',
    webhook_status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(()=>{});
  await pool.query('ALTER TABLE shopify_stores ADD COLUMN IF NOT EXISTS scopes TEXT').catch(()=>{});
  await pool.query('ALTER TABLE shopify_stores ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ').catch(()=>{});
  await pool.query(`CREATE TABLE IF NOT EXISTS shopify_customers (
    id SERIAL PRIMARY KEY,
    shopify_store_id INT REFERENCES shopify_stores(id) ON DELETE CASCADE,
    shopify_customer_id TEXT,
    name TEXT,
    email TEXT,
    total_spent INT DEFAULT 0,
    currency TEXT DEFAULT 'usd',
    orders_count INT DEFAULT 0,
    subscriptions_count INT DEFAULT 0,
    last_order_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(()=>{});
  await pool.query(`CREATE TABLE IF NOT EXISTS shopify_orders (
    id SERIAL PRIMARY KEY,
    shopify_store_id INT REFERENCES shopify_stores(id) ON DELETE CASCADE,
    shopify_order_id TEXT,
    order_name TEXT,
    customer_name TEXT,
    amount INT DEFAULT 0,
    currency TEXT DEFAULT 'usd',
    financial_status TEXT,
    fulfillment_status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(()=>{});
  await pool.query(`CREATE TABLE IF NOT EXISTS shopify_subscription_contracts (
    id SERIAL PRIMARY KEY,
    shopify_store_id INT REFERENCES shopify_stores(id) ON DELETE CASCADE,
    contract_id TEXT,
    customer_name TEXT,
    product_title TEXT,
    amount INT DEFAULT 0,
    currency TEXT DEFAULT 'usd',
    billing_cycle TEXT,
    next_billing_at TIMESTAMPTZ,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(()=>{});
  await pool.query(`CREATE TABLE IF NOT EXISTS shopify_products (
    id SERIAL PRIMARY KEY,
    shopify_store_id INT REFERENCES shopify_stores(id) ON DELETE CASCADE,
    product_id TEXT,
    title TEXT,
    price INT DEFAULT 0,
    currency TEXT DEFAULT 'usd',
    subscription_available BOOLEAN DEFAULT FALSE,
    selling_plan TEXT,
    status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(()=>{});
  await pool.query(`CREATE TABLE IF NOT EXISTS shopify_billing_attempts (
    id SERIAL PRIMARY KEY,
    shopify_store_id INT REFERENCES shopify_stores(id) ON DELETE CASCADE,
    contract_id TEXT,
    customer_name TEXT,
    amount INT DEFAULT 0,
    currency TEXT DEFAULT 'usd',
    status TEXT,
    failure_reason TEXT,
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    recovered_at TIMESTAMPTZ
  )`).catch(()=>{});
  await pool.query(`CREATE TABLE IF NOT EXISTS shopify_activity (
    id SERIAL PRIMARY KEY,
    shopify_store_id INT REFERENCES shopify_stores(id) ON DELETE CASCADE,
    event_type TEXT,
    object_id TEXT,
    status TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(()=>{});
}

function intervalToDays(interval, count) {
  const n = Number(count || 1);
  if (interval === 'day') return 1 * n;
  if (interval === 'week') return 7 * n;
  if (interval === 'month') return 30 * n;
  if (interval === 'year') return 365 * n;
  return 30;
}

function dateFromUnixOrFallback(unixSeconds, intervalDays = 30) {
  if (unixSeconds) return new Date(unixSeconds * 1000).toISOString().split('T')[0];
  const d = new Date();
  d.setDate(d.getDate() + intervalDays);
  return d.toISOString().split('T')[0];
}

async function getCustomerPaymentMethod(stripe, customerId, preferredPaymentMethodId = null) {
  if (preferredPaymentMethodId && typeof preferredPaymentMethodId === 'string') {
    try { return await stripe.paymentMethods.retrieve(preferredPaymentMethodId); } catch(e) {}
  }
  try {
    const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
    return pms.data[0] || null;
  } catch(e) { return null; }
}


function stableImportId(usedAccount, seed) {
  const raw = String(seed || '').trim() || String(Date.now());
  const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 24);
  return `external_${usedAccount?.id || 'acct'}_${hash}`;
}

function cleanEmail(email) {
  if (!email) return null;
  const v = String(email).trim().toLowerCase();
  return v && v.includes('@') ? v : null;
}

async function upsertExternalCustomer(usedAccount, fallback = {}, cardDetails = {}) {
  await ensureWebhookColumns();
  const email = cleanEmail(fallback.email) || `${stableImportId(usedAccount, fallback.seed || fallback.name || 'unknown')}@stripe.local`;
  const name = fallback.name || email || 'Stripe Customer';
  const syntheticStripeId = fallback.syntheticId || stableImportId(usedAccount, fallback.seed || email || name);

  // If an external Stripe dashboard payment link gives the same email again, keep one customer row per Stripe account.
  const existingByEmail = await pool.query(
    `SELECT id, stripe_customer_id FROM customers WHERE LOWER(email)=LOWER($1) AND (stripe_account_id=$2 OR stripe_account_id IS NULL) ORDER BY created_at ASC LIMIT 1`,
    [email, usedAccount?.id || null]
  );

  if (existingByEmail.rows[0]) {
    await pool.query(
      `UPDATE customers SET name=COALESCE($1,name), stripe_account_id=COALESCE($2,stripe_account_id),
        stripe_payment_method=COALESCE($3,stripe_payment_method), card_brand=COALESCE($4,card_brand), card_last4=COALESCE($5,card_last4),
        card_exp_month=COALESCE($6,card_exp_month), card_exp_year=COALESCE($7,card_exp_year), status='active'
       WHERE id=$8`,
      [name, usedAccount?.id || null, fallback.paymentMethodId || null, cardDetails.brand || null, cardDetails.last4 || null, cardDetails.exp_month || null, cardDetails.exp_year || null, existingByEmail.rows[0].id]
    );
    console.log('[external-import] updated external customer:', email, 'local id:', existingByEmail.rows[0].id);
    return { id: existingByEmail.rows[0].id, email, name };
  }

  const existingBySynthetic = await pool.query('SELECT id FROM customers WHERE stripe_customer_id=$1', [syntheticStripeId]);
  if (existingBySynthetic.rows[0]) {
    await pool.query(
      `UPDATE customers SET email=COALESCE($1,email), name=COALESCE($2,name), stripe_account_id=COALESCE($3,stripe_account_id),
        stripe_payment_method=COALESCE($4,stripe_payment_method), card_brand=COALESCE($5,card_brand), card_last4=COALESCE($6,card_last4),
        card_exp_month=COALESCE($7,card_exp_month), card_exp_year=COALESCE($8,card_exp_year), status='active'
       WHERE id=$9`,
      [email, name, usedAccount?.id || null, fallback.paymentMethodId || null, cardDetails.brand || null, cardDetails.last4 || null, cardDetails.exp_month || null, cardDetails.exp_year || null, existingBySynthetic.rows[0].id]
    );
    console.log('[external-import] updated synthetic customer:', email, 'local id:', existingBySynthetic.rows[0].id);
    return { id: existingBySynthetic.rows[0].id, email, name };
  }

  const ins = await pool.query(
    `INSERT INTO customers (email,name,stripe_customer_id,stripe_payment_method,stripe_account_id,card_brand,card_last4,card_exp_month,card_exp_year,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING id`,
    [email, name, syntheticStripeId, fallback.paymentMethodId || null, usedAccount?.id || null, cardDetails.brand || null, cardDetails.last4 || null, cardDetails.exp_month || null, cardDetails.exp_year || null]
  );
  console.log('[external-import] saved external customer:', email, 'local id:', ins.rows[0].id, 'synthetic id:', syntheticStripeId);
  return { id: ins.rows[0].id, email, name };
}

async function resolveLocalCustomerForPayment(stripe, usedAccount, stripeCustomerId, preferredPaymentMethodId = null, fallback = {}, cardDetails = {}) {
  if (stripeCustomerId && typeof stripeCustomerId === 'object') stripeCustomerId = stripeCustomerId.id;
  if (stripeCustomerId && typeof stripeCustomerId === 'string') {
    try {
      const local = await upsertStripeCustomer(stripe, usedAccount, stripeCustomerId, preferredPaymentMethodId);
      if (local?.id) return local;
    } catch(e) {
      console.log('[external-import] could not retrieve Stripe customer, using fallback:', e.message);
    }
  }
  return upsertExternalCustomer(usedAccount, { ...fallback, paymentMethodId: preferredPaymentMethodId }, cardDetails);
}

async function upsertStripeCustomer(stripe, usedAccount, stripeCustomerId, preferredPaymentMethodId = null) {
  if (!stripeCustomerId || typeof stripeCustomerId !== 'string') return null;
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if (!customer || customer.deleted) return null;
  const pm = await getCustomerPaymentMethod(stripe, stripeCustomerId, preferredPaymentMethodId);
  const name = customer.name || customer.email || stripeCustomerId;
  const email = customer.email || `${stripeCustomerId}@stripe.local`;

  const existing = await pool.query('SELECT id FROM customers WHERE stripe_customer_id=$1', [stripeCustomerId]);
  if (!existing.rows[0]) {
    const ins = await pool.query(
      `INSERT INTO customers (email,name,stripe_customer_id,stripe_payment_method,stripe_account_id,card_brand,card_last4,card_exp_month,card_exp_year,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING id`,
      [email, name, stripeCustomerId, pm?.id || null, usedAccount?.id || null, pm?.card?.brand || null, pm?.card?.last4 || null, pm?.card?.exp_month || null, pm?.card?.exp_year || null]
    );
    console.log('[customer] saved:', email, 'local id:', ins.rows[0].id);
    return { id: ins.rows[0].id, email, name };
  }

  await pool.query(
    `UPDATE customers SET email=COALESCE($1,email), name=COALESCE($2,name), stripe_account_id=COALESCE($3,stripe_account_id),
      stripe_payment_method=COALESCE($4,stripe_payment_method), card_brand=COALESCE($5,card_brand), card_last4=COALESCE($6,card_last4),
      card_exp_month=COALESCE($7,card_exp_month), card_exp_year=COALESCE($8,card_exp_year), status='active'
     WHERE stripe_customer_id=$9`,
    [email, name, usedAccount?.id || null, pm?.id || null, pm?.card?.brand || null, pm?.card?.last4 || null, pm?.card?.exp_month || null, pm?.card?.exp_year || null, stripeCustomerId]
  );
  console.log('[customer] updated:', email, 'local id:', existing.rows[0].id);
  return { id: existing.rows[0].id, email, name };
}

async function saveSubscriptionFromStripe(stripe, usedAccount, subscriptionOrId, source = 'unknown') {
  await ensureWebhookColumns();
  if (!subscriptionOrId) {
    console.log('[subscription] no subscription id/object from', source);
    return null;
  }

  let stripeSub = subscriptionOrId;
  if (typeof subscriptionOrId === 'string') {
    stripeSub = await stripe.subscriptions.retrieve(subscriptionOrId, {
      expand: ['items.data.price', 'customer', 'latest_invoice']
    });
  }

  const subId = stripeSub.id;
  const stripeCustomerId = typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id;
  console.log('[subscription] retrieved:', subId, 'customer:', stripeCustomerId, 'status:', stripeSub.status, 'source:', source);
  if (!subId || !stripeCustomerId) return null;

  const firstItem = stripeSub.items?.data?.[0];
  const price = firstItem?.price || {};
  const amount = price.unit_amount || firstItem?.plan?.amount || 0;
  const currency = price.currency || firstItem?.plan?.currency || 'usd';
  const interval = price.recurring?.interval || firstItem?.plan?.interval || 'month';
  const intervalCount = price.recurring?.interval_count || firstItem?.plan?.interval_count || 1;
  const intervalDays = intervalToDays(interval, intervalCount);
  const nextBilling = dateFromUnixOrFallback(stripeSub.current_period_end || firstItem?.current_period_end, intervalDays);
  const invoiceId = typeof stripeSub.latest_invoice === 'string' ? stripeSub.latest_invoice : stripeSub.latest_invoice?.id || null;

  const localCustomer = await upsertStripeCustomer(stripe, usedAccount, stripeCustomerId, stripeSub.default_payment_method || null);
  if (!localCustomer?.id) return null;

  const existingByStripe = await pool.query('SELECT id FROM subscriptions WHERE stripe_subscription_id=$1', [subId]);
  if (existingByStripe.rows[0]) {
    await pool.query(
      `UPDATE subscriptions SET customer_id=$1, amount=$2, currency=$3, interval_days=$4, next_billing_date=$5, status=$6,
       stripe_price_id=$7, stripe_invoice_id=$8 WHERE id=$9`,
      [localCustomer.id, amount, currency, intervalDays, nextBilling, stripeSub.status || 'active', price.id || null, invoiceId, existingByStripe.rows[0].id]
    );
    console.log('[subscription] updated subscription:', subId, 'row id:', existingByStripe.rows[0].id);
    return existingByStripe.rows[0].id;
  }

  const ins = await pool.query(
    `INSERT INTO subscriptions (customer_id,amount,currency,interval_days,next_billing_date,status,stripe_subscription_id,stripe_price_id,stripe_invoice_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [localCustomer.id, amount, currency, intervalDays, nextBilling, stripeSub.status || 'active', subId, price.id || null, invoiceId]
  );
  console.log('[subscription] saved subscription:', subId, 'row id:', ins.rows[0].id, 'customer:', localCustomer.email, 'next billing:', nextBilling);
  await activityLog.add('subscription', `Subscription saved for ${localCustomer.email}`, localCustomer.id, amount).catch(()=>{});
  return ins.rows[0].id;
}

async function getInvoiceFromPaymentIntent(stripe, pi) {
  let invoice = pi.invoice || null;
  if (!invoice) {
    try {
      const fullPi = await stripe.paymentIntents.retrieve(pi.id, { expand: ['invoice', 'latest_charge'] });
      invoice = fullPi.invoice || null;
      pi.payment_method = pi.payment_method || fullPi.payment_method;
      pi.latest_charge = pi.latest_charge || fullPi.latest_charge;
    } catch(e) { console.log('[payment] could not expand PI invoice:', e.message); }
  }
  if (typeof invoice === 'string') {
    try { invoice = await stripe.invoices.retrieve(invoice, { expand: ['subscription', 'lines.data.price'] }); } catch(e) { console.log('[payment] could not retrieve invoice:', e.message); }
  }
  return invoice;
}


function normalizeCardBrand(brand) {
  if (!brand) return null;
  const b = String(brand).toLowerCase().trim().replace(/[\s-]+/g, '_');
  const aliases = {
    american_express: 'amex',
    master_card: 'mastercard',
    diners_club: 'diners',
    carte_bancaire: 'cartes_bancaires',
    cb: 'cartes_bancaires'
  };
  return aliases[b] || b;
}

async function getCardDetailsFromPaymentIntent(stripe, pi) {
  const details = { brand: null, last4: null, exp_month: null, exp_year: null, country: null, funding: null, billing_name: null, billing_email: null, payment_method_type: null, wallet_type: null };

  try {
    if ((!pi.latest_charge || typeof pi.latest_charge === 'string') || !pi.payment_method) {
      const fullPi = await stripe.paymentIntents.retrieve(pi.id, { expand: ['latest_charge', 'payment_method', 'invoice'] });
      pi.latest_charge = pi.latest_charge || fullPi.latest_charge;
      pi.payment_method = pi.payment_method || fullPi.payment_method;
      pi.invoice = pi.invoice || fullPi.invoice;
      pi.receipt_email = pi.receipt_email || fullPi.receipt_email;
    }
  } catch(e) {
    console.log('[payment] could not expand payment details from PI:', e.message);
  }

  let card = null;
  try {
    let charge = pi.latest_charge;
    if (charge && typeof charge === 'string') charge = await stripe.charges.retrieve(charge);
    const pmDetails = charge?.payment_method_details || null;
    details.payment_method_type = pmDetails?.type || null;
    card = pmDetails?.card || pmDetails?.amazon_pay?.funding?.card || null;
    details.wallet_type = card?.wallet?.type || null;
    details.billing_name = charge?.billing_details?.name || null;
    details.billing_email = cleanEmail(charge?.billing_details?.email) || null;
  } catch(e) {
    console.log('[payment] could not retrieve charge payment details:', e.message);
  }

  try {
    let pm = pi.payment_method;
    if (pm && typeof pm === 'string') pm = await stripe.paymentMethods.retrieve(pm);
    details.payment_method_type = details.payment_method_type || pm?.type || null;
    if (!card) card = pm?.card || null;
    details.wallet_type = details.wallet_type || card?.wallet?.type || null;
    details.billing_name = details.billing_name || pm?.billing_details?.name || null;
    details.billing_email = details.billing_email || cleanEmail(pm?.billing_details?.email) || null;
  } catch(e) {
    console.log('[payment] could not retrieve PaymentMethod details:', e.message);
  }

  if (card) {
    details.payment_method_type = details.payment_method_type || 'card';
    details.brand = normalizeCardBrand(card.brand);
    details.last4 = card.last4 || null;
    details.exp_month = card.exp_month || null;
    details.exp_year = card.exp_year || null;
    details.country = card.country || null;
    details.funding = card.funding || null;
  }
  return details;
}


async function getFinancialsFromPaymentIntent(stripe, pi) {
  const out = { stripe_fee: null, net_amount: null, balance_transaction_id: null, amount: null, currency: null, financial_currency: null };
  try {
    if (!pi?.id && typeof pi === 'string') {
      pi = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge.balance_transaction'] });
    } else if (pi?.id && (!pi.latest_charge || typeof pi.latest_charge === 'string' || !pi.latest_charge.balance_transaction)) {
      pi = await stripe.paymentIntents.retrieve(pi.id, { expand: ['latest_charge.balance_transaction'] });
    }
    let charge = pi.latest_charge;
    if (charge && typeof charge === 'string') charge = await stripe.charges.retrieve(charge, { expand: ['balance_transaction'] });
    let bt = charge?.balance_transaction || null;
    if (bt && typeof bt === 'string') bt = await stripe.balanceTransactions.retrieve(bt);
    if (bt) {
      out.stripe_fee = typeof bt.fee === 'number' ? bt.fee : null;
      out.net_amount = typeof bt.net === 'number' ? bt.net : null;
      out.balance_transaction_id = bt.id || null;
      out.amount = typeof bt.amount === 'number' ? bt.amount : null;
      out.currency = bt.currency || null;
      out.financial_currency = bt.currency || null;
    }
  } catch(e) {
    console.log('[payment] could not retrieve balance transaction:', e.message);
  }
  return out;
}

function subscriptionIdFromInvoice(invoice) {
  if (!invoice) return null;
  if (typeof invoice.subscription === 'string') return invoice.subscription;
  if (invoice.subscription?.id) return invoice.subscription.id;
  for (const line of (invoice.lines?.data || [])) {
    if (typeof line.subscription === 'string') return line.subscription;
    if (line.subscription?.id) return line.subscription.id;
    if (typeof line.parent?.subscription_item_details?.subscription === 'string') return line.parent.subscription_item_details.subscription;
  }
  return null;
}

async function savePaymentIntent(stripe, usedAccount, pi, forcedStatus = null, fallbackCustomer = {}) {
  await ensureWebhookColumns();
  if (!pi?.id && typeof pi === 'string') pi = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge', 'payment_method', 'invoice'] });
  if (!pi?.id) { console.log('[payment] missing PaymentIntent object'); return null; }

  // Always expand because Stripe Dashboard payment links can omit useful fields in webhook payload.
  try {
    const fullPi = await stripe.paymentIntents.retrieve(pi.id, { expand: ['latest_charge', 'payment_method', 'invoice'] });
    pi = { ...fullPi, ...pi, latest_charge: fullPi.latest_charge || pi.latest_charge, payment_method: fullPi.payment_method || pi.payment_method, invoice: fullPi.invoice || pi.invoice };
  } catch(e) {
    console.log('[payment] could not fully retrieve PI:', e.message);
  }

  const invoice = await getInvoiceFromPaymentIntent(stripe, pi);
  const invoiceId = typeof invoice === 'string' ? invoice : invoice?.id || null;
  const subId = subscriptionIdFromInvoice(invoice);
  console.log('[payment] PI:', pi.id, 'invoice:', invoiceId || '-', 'subscription:', subId || '-');

  const cardDetails = await getCardDetailsFromPaymentIntent(stripe, pi);
  const stripeCustomerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null;
  const fallback = {
    seed: pi.id,
    email: cleanEmail(fallbackCustomer.email) || cleanEmail(pi.receipt_email) || cardDetails.billing_email,
    name: fallbackCustomer.name || cardDetails.billing_name || fallbackCustomer.email || pi.id,
    paymentMethodId: typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id || null,
    syntheticId: stripeCustomerId ? null : stableImportId(usedAccount, 'pi_' + pi.id)
  };

  const localCustomer = await resolveLocalCustomerForPayment(stripe, usedAccount, stripeCustomerId, fallback.paymentMethodId, fallback, cardDetails);
  if (!localCustomer?.id) { console.log('[payment] could not resolve local customer for PI:', pi.id); return null; }

  if (cardDetails.brand || cardDetails.last4) {
    await pool.query(`UPDATE customers SET card_brand=COALESCE($1,card_brand), card_last4=COALESCE($2,card_last4), card_exp_month=COALESCE($3,card_exp_month), card_exp_year=COALESCE($4,card_exp_year) WHERE id=$5`,
      [cardDetails.brand, cardDetails.last4, cardDetails.exp_month, cardDetails.exp_year, localCustomer.id]).catch(()=>{});
    console.log('[payment] card details:', cardDetails.brand || '-', cardDetails.last4 || '-');
  }

  let localSubId = null;
  if (subId) {
    try { localSubId = await saveSubscriptionFromStripe(stripe, usedAccount, subId, 'payment_intent.' + pi.id); }
    catch(e) { console.error('[payment] failed saving related subscription:', e.message); }
  }

  const status = forcedStatus || (pi.status === 'succeeded' ? 'succeeded' : (pi.status || 'failed'));
  const failureReason = pi.last_payment_error?.message || pi.cancellation_reason || null;
  const financials = await getFinancialsFromPaymentIntent(stripe, pi);
  const amount = pi.amount_received || financials.amount || pi.amount || 0;
  const currency = pi.currency || financials.currency || 'usd';

  const existingPayment = await pool.query('SELECT id, status, was_failed, recovered_at FROM payments WHERE stripe_payment_intent=$1', [pi.id]);
  if (existingPayment.rows[0]) {
    await pool.query(`UPDATE payments SET customer_id=$1, subscription_id=COALESCE($2,subscription_id), amount=$3, currency=$4, status=$5, failure_reason=$6,
      stripe_invoice_id=COALESCE($7,stripe_invoice_id), card_brand=COALESCE($8,card_brand), card_last4=COALESCE($9,card_last4),
      card_exp_month=COALESCE($10,card_exp_month), card_exp_year=COALESCE($11,card_exp_year), card_country=COALESCE($12,card_country), card_funding=COALESCE($13,card_funding),
      stripe_fee=COALESCE($14,stripe_fee), net_amount=COALESCE($15,net_amount), balance_transaction_id=COALESCE($16,balance_transaction_id), financial_currency=COALESCE($17,financial_currency),
      was_failed=COALESCE(was_failed,false) OR $18='failed',
      recovered_at=CASE WHEN $18='succeeded' AND (COALESCE(was_failed,false) OR status='failed') THEN COALESCE(recovered_at,NOW()) ELSE recovered_at END
      WHERE id=$19`,
      [localCustomer.id, localSubId, amount, currency, status, failureReason, invoiceId, cardDetails.brand, cardDetails.last4, cardDetails.exp_month, cardDetails.exp_year, cardDetails.country, cardDetails.funding, financials.stripe_fee, financials.net_amount, financials.balance_transaction_id, financials.financial_currency, status, existingPayment.rows[0].id]);
    await pool.query(`UPDATE payments SET payment_method_type=COALESCE($1,payment_method_type), wallet_type=COALESCE($2,wallet_type), wallet_checked=TRUE WHERE id=$3`,
      [cardDetails.payment_method_type, cardDetails.wallet_type, existingPayment.rows[0].id]).catch(()=>{});
    console.log('[external-import] updated payment:', pi.id, 'customer:', localCustomer.email, 'method:', cardDetails.payment_method_type || '-', 'wallet:', cardDetails.wallet_type || '-');
    return existingPayment.rows[0].id;
  }

  const ins = await pool.query(
    `INSERT INTO payments (customer_id,subscription_id,stripe_payment_intent,amount,currency,status,failure_reason,stripe_invoice_id,card_brand,card_last4,card_exp_month,card_exp_year,card_country,card_funding,stripe_fee,net_amount,balance_transaction_id,financial_currency,was_failed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
    [localCustomer.id, localSubId, pi.id, amount, currency, status, failureReason, invoiceId, cardDetails.brand, cardDetails.last4, cardDetails.exp_month, cardDetails.exp_year, cardDetails.country, cardDetails.funding, financials.stripe_fee, financials.net_amount, financials.balance_transaction_id, financials.financial_currency, status==='failed']
  );
  await pool.query(`UPDATE payments SET payment_method_type=COALESCE($1,payment_method_type), wallet_type=COALESCE($2,wallet_type), wallet_checked=TRUE WHERE id=$3`,
    [cardDetails.payment_method_type, cardDetails.wallet_type, ins.rows[0].id]).catch(()=>{});
  console.log('[external-import] saved payment:', pi.id, 'row id:', ins.rows[0].id, 'customer:', localCustomer.email, 'method:', cardDetails.payment_method_type || '-', 'wallet:', cardDetails.wallet_type || '-');
  await activityLog.add('payment', `Payment ${status} for ${localCustomer.email}`, localCustomer.id, amount).catch(()=>{});
  return ins.rows[0].id;
}

async function handleInvoiceEvent(stripe, usedAccount, invoice, statusLabel = 'succeeded') {
  await ensureWebhookColumns();
  const subId = subscriptionIdFromInvoice(invoice);
  console.log('[invoice] event invoice:', invoice.id, 'subscription:', subId || '-', 'payment_intent:', invoice.payment_intent || '-');
  let localSubId = null;
  if (subId) localSubId = await saveSubscriptionFromStripe(stripe, usedAccount, subId, 'invoice.' + invoice.id);

  if (invoice.payment_intent) {
    try {
      const pi = await stripe.paymentIntents.retrieve(invoice.payment_intent, { expand: ['invoice'] });
      await savePaymentIntent(stripe, usedAccount, pi, statusLabel);
    } catch(e) { console.error('[invoice] could not save PI from invoice:', e.message); }
  }
  return localSubId;
}


async function retrieveFullCheckoutSession(stripe, session) {
  if (!session?.id) return session;
  try {
    return await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['customer', 'payment_intent', 'subscription', 'line_items.data.price']
    });
  } catch(e) {
    console.log('[external-import] could not retrieve checkout session:', e.message);
    return session;
  }
}

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event = null, usedAccount = null;
  try {
    await ensureWebhookColumns();
    const fullAccounts = await pool.query('SELECT * FROM stripe_accounts');

    for (const acc of fullAccounts.rows) {
      if (!acc.webhook_secret) continue;
      try {
        const stripe = Stripe(acc.secret_key);
        event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], acc.webhook_secret);
        usedAccount = acc;
        break;
      } catch(e) {}
    }

    if (!event) {
      console.error('[webhook] signature verification failed for all accounts');
      await webhookLogs.add({ event_type: 'verification_failed', account_name: null, status: 'failed', error: 'Invalid webhook signature' }).catch(()=>{});
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    await webhookLogs.add({ event_type: event.type, account_name: usedAccount?.name });
    const stripe = Stripe(usedAccount.secret_key);
    console.log('[webhook] received:', event.type, 'account:', usedAccount.name);

    try {
      if (event.type === 'checkout.session.completed') {
        const rawSession = event.data.object;
        const session = await retrieveFullCheckoutSession(stripe, rawSession);
        const sessionCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
        const sessionSubId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || null;
        const sessionPiId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
        const fallbackCustomer = {
          seed: session.id,
          email: cleanEmail(session.customer_details?.email) || cleanEmail(session.customer_email),
          name: session.customer_details?.name || session.customer_details?.email || session.customer_email || session.id
        };
        console.log('[external-import] checkout session:', session.id, 'customer:', sessionCustomerId || '-', 'mode:', session.mode || '-', 'subscription:', sessionSubId || '-', 'payment_intent:', sessionPiId || '-', 'email:', fallbackCustomer.email || '-');

        if (sessionCustomerId) {
          await resolveLocalCustomerForPayment(stripe, usedAccount, sessionCustomerId, session.payment_method || null, fallbackCustomer, {}).catch(e => console.error('[external-import] customer save error:', e.message));
        } else if (fallbackCustomer.email) {
          await upsertExternalCustomer(usedAccount, fallbackCustomer, {}).catch(e => console.error('[external-import] external customer save error:', e.message));
        }

        if (sessionSubId) {
          await saveSubscriptionFromStripe(stripe, usedAccount, sessionSubId, 'checkout.session.completed');
        } else {
          console.log('[external-import] checkout session has no subscription; treating as one-time payment. mode:', session.mode || '-');
        }

        if (sessionPiId) {
          const pi = typeof session.payment_intent === 'object' ? session.payment_intent : await stripe.paymentIntents.retrieve(sessionPiId, { expand: ['invoice', 'latest_charge', 'payment_method'] });
          await savePaymentIntent(stripe, usedAccount, pi, pi.status === 'succeeded' ? 'succeeded' : pi.status, fallbackCustomer);
        }
      }

      else if (event.type === 'payment_intent.succeeded') {
        await savePaymentIntent(stripe, usedAccount, event.data.object, 'succeeded');
      }

      else if (event.type === 'payment_intent.payment_failed') {
        await savePaymentIntent(stripe, usedAccount, event.data.object, 'failed');
      }

      else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
        await handleInvoiceEvent(stripe, usedAccount, event.data.object, 'succeeded');
      }

      else if (event.type === 'invoice.payment_failed') {
        await handleInvoiceEvent(stripe, usedAccount, event.data.object, 'failed');
      }

      else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
        await saveSubscriptionFromStripe(stripe, usedAccount, event.data.object, event.type);
      }

      else if (event.type === 'customer.subscription.deleted') {
        const stripeSub = event.data.object;
        console.log('[subscription] deleted/cancelled:', stripeSub.id);
        await saveSubscriptionFromStripe(stripe, usedAccount, stripeSub, event.type).catch(()=>{});
        await pool.query("UPDATE subscriptions SET status='cancelled' WHERE stripe_subscription_id=$1", [stripeSub.id]).catch(()=>{});
      }

      else if (event.type === 'customer.updated') {
        const customer = event.data.object;
        if (customer?.id) await upsertStripeCustomer(stripe, usedAccount, customer.id, null).catch(e => console.error('[customer.updated] error:', e.message));
      }

      else {
        console.log('[webhook] ignored event type:', event.type);
      }

      return res.json({ received: true });
    } catch(handlerErr) {
      console.error('[webhook] handler error:', handlerErr.message, handlerErr.stack);
      await webhookLogs.add({ event_type: event.type, account_name: usedAccount?.name, status: 'failed', error: handlerErr.message }).catch(()=>{});
      return res.status(500).json({ error: handlerErr.message });
    }
  } catch(err) {
    console.error('[webhook] fatal error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
});


app.use(express.json());
app.use('/icons', express.static(path.join(__dirname, 'public', 'icons')));
app.use(express.static(path.join(__dirname)));


// Require a verified session token for the application API and enforce page/read-only permissions.
app.use('/api', async (req, res, next) => {
  const openPaths = ['/auth/verify', '/auth/check', '/security/2fa/validate', '/shopify/install', '/shopify/callback'];
  if (openPaths.includes(req.path)) return next();
  try {
    const data = parseAdminToken(bearerToken(req), 'access');
    if (!data) return res.status(401).json({ error: 'Authentication required' });
    const user = await adminUsers.byId(data.id);
    if (!user) return res.status(401).json({ error: 'Access has been revoked' });
    req.currentUser = user;
    const selfSecurityPath = req.path === '/security/login-history' || req.path.startsWith('/security/2fa/');
    const sensitive = ['/admin-users', '/settings', '/debug'];
    if (sensitive.some(prefix => req.path.startsWith(prefix)) && !isOwnerOrAdmin(user)) {
      return res.status(403).json({ error: 'Owner or admin access required' });
    }
    // Every signed-in user may manage only their own 2FA and view only their own login activity.
    if (req.path.startsWith('/security') && !selfSecurityPath && !isOwnerOrAdmin(user)) {
      return res.status(403).json({ error: 'Owner or admin access required' });
    }
    // Stripe connection management stays protected: scoped users may inspect assigned accounts only.
    if (req.path.startsWith('/stripe-accounts') && req.method !== 'GET' && !isOwnerOrAdmin(user)) {
      return res.status(403).json({ error: 'Owner or admin access required' });
    }
    // A Custom user with Subscriptions management may run rebills, restricted below to assigned accounts.
    if (req.path.startsWith('/run-rebills') && !isOwnerOrAdmin(user)) {
      if (isReadOnlyUser(user)) return res.status(403).json({ error: 'View-only access' });
      if (!(user.role === 'custom' && canUseSection(user, 'subscriptions'))) {
        return res.status(403).json({ error: 'Subscriptions management access required' });
      }
    }
    const section = sectionForApiPath(req);
    // Dashboard reads recent payments/subscriptions/activity; customer details read subscription status.
    // These supporting reads grant no write actions and remain Stripe-account scoped.
    const dashboardSupportingRead = req.method === 'GET' && canUseSection(user, 'dashboard') && ['subscriptions','payments','activity'].includes(section);
    const customerSupportingRead = req.method === 'GET' && canUseSection(user, 'customers') && section === 'subscriptions';
    if (section && section !== 'security' && !canUseSection(user, section) && !dashboardSupportingRead && !customerSupportingRead) {
      return res.status(403).json({ error: 'Access restricted' });
    }
    if (section === 'security' && !selfSecurityPath && !isOwnerOrAdmin(user)) {
      return res.status(403).json({ error: 'Access restricted' });
    }
    if (isReadOnlyUser(user) && req.method !== 'GET' && !selfSecurityPath) return res.status(403).json({ error: 'View-only access' });
    next();
  } catch (err) { res.status(401).json({ error: 'Authentication required' }); }
});

// ── Stripe Accounts ───────────────────────────────────────────────────────────
function formatStripeRequirementKey(key) {
  const raw = String(key || '');
  const clean = raw
    .replace(/^individual\./, '')
    .replace(/^representative\./, '')
    .replace(/^company\./, '')
    .replace(/^business_profile\./, 'business profile.')
    .replace(/person_[^.]+\./, 'person.')
    .replace(/\./g, ' ')
    .replace(/_/g, ' ');

  if (/verification|document|id_number|identity|selfie|photo/i.test(clean)) {
    return 'ID / verification required';
  }
  if (/external account|bank account/i.test(clean)) {
    return 'Bank account required';
  }
  if (/business profile|url|mcc|product description/i.test(clean)) {
    return 'Business profile required';
  }
  if (/representative|owners|directors|executives|person|relationship/i.test(clean)) {
    return 'Representative / ownership details required';
  }
  if (/tax/i.test(clean)) {
    return 'Tax information required';
  }
  if (/tos acceptance/i.test(clean)) {
    return 'Terms acceptance required';
  }

  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function uniqueRequirements(items) {
  const seen = new Set();
  return (items || [])
    .map(formatStripeRequirementKey)
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function getStripeAccountDisplayStatus(accountRow) {
  const base = {
    account_status: 'closed',
    account_status_label: 'closed',
    account_status_reason: null,
    verification_needed: false,
    verification_details: [],
    raw_requirements_currently_due: [],
    raw_requirements_past_due: [],
    raw_requirements_eventually_due: [],
    disabled_reason: null,
    charges_enabled: false,
    payouts_enabled: false
  };

  if (!accountRow.secret_key || !String(accountRow.secret_key).startsWith('sk_')) {
    return {
      ...base,
      account_status_reason: 'Missing or invalid secret key',
      verification_details: ['Missing or invalid secret key']
    };
  }

  try {
    const stripe = new Stripe(accountRow.secret_key);
    const acc = await stripe.accounts.retrieve();

    const req = acc?.requirements || {};
    const disabledReason = req.disabled_reason || null;
    const chargesEnabled = !!acc?.charges_enabled;
    const payoutsEnabled = !!acc?.payouts_enabled;

    const currentlyDue = Array.isArray(req.currently_due) ? req.currently_due : [];
    const pastDue = Array.isArray(req.past_due) ? req.past_due : [];
    const details = uniqueRequirements([...pastDue, ...currentlyDue]);

    if (acc?.deleted) {
      return {
        ...base,
        account_status_reason: 'Stripe account deleted or closed',
        verification_details: ['Stripe account deleted or closed']
      };
    }

    // Main rule:
    // No action needed only when charges + payouts are enabled and Stripe has no requirements due now.
    const needsAction =
      !chargesEnabled ||
      !payoutsEnabled ||
      !!disabledReason ||
      currentlyDue.length > 0 ||
      pastDue.length > 0;

    if (needsAction) {
      const reason =
        disabledReason ||
        (!chargesEnabled && !payoutsEnabled ? 'Payments and payouts not enabled' :
          !chargesEnabled ? 'Payments access disabled' :
          !payoutsEnabled ? 'Payouts paused or disabled' :
          details[0] || 'Verification required');

      return {
        account_status: 'restricted',
        account_status_label: 'verification required',
        account_status_reason: reason,
        verification_needed: true,
        verification_details: details.length ? details : [reason],
        raw_requirements_currently_due: currentlyDue,
        raw_requirements_past_due: pastDue,
        raw_requirements_eventually_due: req.eventually_due || [],
        disabled_reason: disabledReason,
        charges_enabled: chargesEnabled,
        payouts_enabled: payoutsEnabled
      };
    }

    return {
      account_status: 'active',
      account_status_label: 'active',
      account_status_reason: null,
      verification_needed: false,
      verification_details: [],
      raw_requirements_currently_due: currentlyDue,
      raw_requirements_past_due: pastDue,
      raw_requirements_eventually_due: req.eventually_due || [],
      disabled_reason: disabledReason,
      charges_enabled: chargesEnabled,
      payouts_enabled: payoutsEnabled
    };
  } catch (err) {
    return {
      ...base,
      account_status_reason: err?.message || 'Unable to verify Stripe account',
      verification_details: [err?.message || 'Unable to verify Stripe account']
    };
  }
}

// Minimal account list for Payment Links. Custom users receive only assigned Stripe accounts.
app.get('/api/payment-link-accounts', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name, is_default FROM stripe_accounts ORDER BY created_at DESC, id DESC');
    const ids = scopedAccountIds(req);
    res.json(ids === null ? r.rows : r.rows.filter(account => ids.includes(Number(account.id))));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/stripe-accounts', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        id,
        name,
        is_default,
        created_at,
        secret_key,
        LEFT(secret_key,12)||'...' as key_preview
      FROM stripe_accounts
      ORDER BY created_at DESC, id DESC
    `);

    const accounts = await Promise.all(r.rows.map(async (account) => {
      const health = await getStripeAccountDisplayStatus(account);
      const { secret_key, ...safeAccount } = account;
      return { ...safeAccount, ...health };
    }));

    const ids = scopedAccountIds(req);
    res.json(ids === null ? accounts : accounts.filter(account => ids.includes(Number(account.id))));
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stripe-accounts/:id/verification-debug', async (req, res) => {
  try {
    const account = await stripeAccounts.byId(req.params.id);
    if (!account) return res.status(404).json({ error: 'Stripe account not found' });
    if (!ensureRowScope(req, res, { stripe_account_id: account.id })) return;
    if (!account.secret_key || !String(account.secret_key).startsWith('sk_')) {
      return res.status(400).json({ error: 'Missing or invalid secret key' });
    }

    const stripe = new Stripe(account.secret_key);
    const acc = await stripe.accounts.retrieve();

    let persons = [];
    let persons_error = null;

    try {
      const people = await stripe.accounts.listPersons(acc.id, { limit: 100 });
      persons = (people.data || []).map((p) => ({
        id: p.id,
        first_name: p.first_name || null,
        last_name: p.last_name || null,
        email: p.email || null,
        relationship: p.relationship || null,
        verification: p.verification || null,
        requirements: p.requirements || null,
        future_requirements: p.future_requirements || null
      }));
    } catch (err) {
      persons_error = err.message;
    }

    const debug = {
      local_account: {
        id: account.id,
        name: account.name,
        is_default: account.is_default,
        key_preview: account.secret_key ? account.secret_key.slice(0, 12) + '...' : null
      },
      stripe_account: {
        id: acc.id,
        type: acc.type,
        country: acc.country,
        email: acc.email,
        business_type: acc.business_type,
        charges_enabled: acc.charges_enabled,
        payouts_enabled: acc.payouts_enabled,
        details_submitted: acc.details_submitted,
        default_currency: acc.default_currency,
        capabilities: acc.capabilities || null,
        requirements: acc.requirements || null,
        future_requirements: acc.future_requirements || null,
        controller: acc.controller || null,
        company: acc.company ? {
          verification: acc.company.verification || null,
          structure: acc.company.structure || null
        } : null,
        individual: acc.individual ? {
          id: acc.individual.id,
          first_name: acc.individual.first_name || null,
          last_name: acc.individual.last_name || null,
          email: acc.individual.email || null,
          verification: acc.individual.verification || null,
          requirements: acc.individual.requirements || null,
          future_requirements: acc.individual.future_requirements || null
        } : null
      },
      persons_error,
      persons,
      interpreted_status: await getStripeAccountDisplayStatus(account)
    };

    res.json(debug);
  } catch (err) {
    console.error('[stripe-account-debug] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stripe-accounts', async (req, res) => {
  try {
    const { name, secret_key, webhook_secret } = req.body;
    if (!name || !secret_key) return res.status(400).json({ error: 'Name and secret key required' });
    await stripeAccounts.create({ name, secret_key, webhook_secret });
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/stripe-accounts/:id', async (req, res) => {
  try {
    const { name, secret_key, webhook_secret } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (secret_key && secret_key.trim()) {
      await pool.query('UPDATE stripe_accounts SET name=$1, secret_key=$2, webhook_secret=$3 WHERE id=$4', [name, secret_key.trim(), webhook_secret||null, req.params.id]);
    } else {
      await pool.query('UPDATE stripe_accounts SET name=$1, webhook_secret=$2 WHERE id=$3', [name, webhook_secret||null, req.params.id]);
    }
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/stripe-accounts/:id/default', async (req, res) => {
  try {
    await pool.query('UPDATE stripe_accounts SET is_default=false');
    await pool.query('UPDATE stripe_accounts SET is_default=true WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/stripe-accounts/default/clear', async (req, res) => {
  try {
    await pool.query('UPDATE stripe_accounts SET is_default=false');
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/stripe-accounts/:id', async (req, res) => { try { await stripeAccounts.delete(req.params.id); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });

// ── Customers ─────────────────────────────────────────────────────────────────
app.get('/api/customers', async (req, res) => { try { const list=await customers.all(); res.json(list.filter(c => rowWithinScope(req,c))); } catch(err) { res.status(500).json({ error: err.message }); } });
app.get('/api/customers/:id/details', async (req, res) => {
  try {
    const data = await customers.detail(req.params.id);
    if (!data.customer) return res.status(404).json({ error: 'Customer not found' });
    if (!ensureRowScope(req, res, data.customer)) return;
    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/customers', async (req, res) => {
  try {
    const { name, email, stripe_customer_id, stripe_payment_method, card_brand, card_last4, card_exp_month, card_exp_year, stripe_account_id, note } = req.body;
    if (!email || !stripe_customer_id) return res.status(400).json({ error: 'Email and Stripe ID required' });
    if (!ensureRowScope(req, res, { stripe_account_id })) return;
    await customers.upsert({ name, email, stripe_customer_id, stripe_payment_method, stripe_account_id, card_brand, card_last4, card_exp_month, card_exp_year });
    const c = await customers.byStripeId(stripe_customer_id);
    if (note) await customers.updateNote(c.id, note);
    res.json({ success: true, id: c.id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/customers/:id/status', async (req, res) => { try { const c=await customers.byId(req.params.id); if(!c) return res.status(404).json({ error:'Customer not found' }); if(!ensureRowScope(req,res,c)) return; await customers.updateStatus(req.params.id, req.body.status); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });
app.patch('/api/customers/:id/note', async (req, res) => { try { const c=await customers.byId(req.params.id); if(!c) return res.status(404).json({ error:'Customer not found' }); if(!ensureRowScope(req,res,c)) return; await customers.updateNote(req.params.id, req.body.note); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });
app.post('/api/customers/:id/portal', async (req, res) => {
  try {
    const c = await customers.byId(req.params.id);
    if (!c) return res.status(404).json({ error: 'Customer not found' });
    if (!ensureRowScope(req, res, c)) return;
    const acc = await stripeAccounts.byId(c.stripe_account_id);
    const stripe = require('stripe')(acc.secret_key);
    const session = await stripe.billingPortal.sessions.create({ customer: c.stripe_customer_id, return_url: process.env.BASE_URL || 'https://rebill-production.up.railway.app' });
    res.json({ url: session.url });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/customers/:id/charge-once', async (req, res) => {
  try {
    const { amount, description, currency } = req.body;
    const c = await customers.byId(req.params.id);
    if (!c) return res.status(404).json({ error: 'Customer not found' });
    if (!ensureRowScope(req, res, c)) return;
    const acc = await stripeAccounts.byId(c.stripe_account_id);
    const stripe = require('stripe')(acc.secret_key);
    const pi = await stripe.paymentIntents.create({ amount, currency: currency||'usd', customer: c.stripe_customer_id, payment_method: c.stripe_payment_method, confirm: true, description: description||'Manual invoice', off_session: true });
    await payments.insert({ customer_id: c.id, subscription_id: null, stripe_payment_intent: pi.id, amount, currency: currency||'usd', status: pi.status==='succeeded'?'succeeded':'failed', failure_reason: null });
    res.json({ success: pi.status==='succeeded', status: pi.status });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/customers/export', async (req, res) => {
  try {
    if (isReadOnlyUser(req.currentUser)) return res.status(403).json({ error: 'View-only access cannot export customer data' });
    const list = (await customers.all()).filter(c => rowWithinScope(req,c));
    const csv = ['Name,Email,Card,Status,Last Payment,Created,Total Paid'].concat(list.map(c=>`${c.name},${c.email},${c.card_brand||''} ${c.card_last4||''},${c.status},${c.last_payment_at||''},${c.created_at||''},${(c.total_paid||0)/100}`)).join('\n');
    res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=customers.csv'); res.send(csv);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Subscriptions ─────────────────────────────────────────────────────────────
async function scopedSubscription(req, res, id) {
  const r = await pool.query('SELECT s.*, c.stripe_account_id FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1', [id]);
  const sub = r.rows[0];
  if (!sub) { res.status(404).json({ error: 'Subscription not found' }); return null; }
  if (!ensureRowScope(req, res, sub)) return null;
  return sub;
}
app.get('/api/subscriptions', async (req, res) => { try { const list=await subscriptions.all(); res.json(list.filter(sub => rowWithinScope(req,sub))); } catch(err) { res.status(500).json({ error: err.message }); } });
app.post('/api/subscriptions', async (req, res) => { try { const c=await customers.byId(req.body.customer_id); if(!c) return res.status(404).json({ error:'Customer not found' }); if(!ensureRowScope(req,res,c)) return; await subscriptions.create(req.body); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });
app.patch('/api/subscriptions/:id', async (req, res) => {
  try {
    if (!(await scopedSubscription(req, res, req.params.id))) return;
    const { status, amount, next_billing_date, resume_date } = req.body;
    if (status) await subscriptions.updateStatus(req.params.id, status);
    if (amount) await subscriptions.updateAmount(req.params.id, parseInt(amount));
    if (next_billing_date) await pool.query('UPDATE subscriptions SET next_billing_date=$1 WHERE id=$2', [next_billing_date, req.params.id]);
    if (resume_date !== undefined) await subscriptions.setResumeDate(req.params.id, resume_date||null);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/subscriptions/:id/status', async (req, res) => {
  try {
    if (!(await scopedSubscription(req, res, req.params.id))) return;
    const { status, resume_date } = req.body;
    await subscriptions.updateStatus(req.params.id, status);
    if (status === 'paused' && resume_date) await subscriptions.setResumeDate(req.params.id, resume_date);
    if (status === 'active') await subscriptions.setResumeDate(req.params.id, null);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/subscriptions/:id/amount', async (req, res) => {
  try {
    if (!(await scopedSubscription(req, res, req.params.id))) return;
    await subscriptions.updateAmount(req.params.id, parseInt(req.body.amount));
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/subscriptions/:id/charge', async (req, res) => {
  try {
    if (!(await scopedSubscription(req, res, req.params.id))) return;
    const allSubs = await subscriptions.all();
    const sub = allSubs.find(s => s.id === parseInt(req.params.id));
    if (!sub) return res.status(404).json({ error: 'Not found' });
    const c = await customers.byId(sub.customer_id);
    const acc = await stripeAccounts.byId(c.stripe_account_id);
    const stripe = require('stripe')(acc.secret_key);
    const pi = await stripe.paymentIntents.create({ amount: sub.amount, currency: sub.currency, customer: c.stripe_customer_id, payment_method: c.stripe_payment_method, off_session: true, confirm: true });
    await payments.insert({ customer_id: c.id, subscription_id: sub.id, stripe_payment_intent: pi.id, amount: sub.amount, currency: sub.currency, status: 'succeeded', failure_reason: null });
    await subscriptions.advanceBillingDate(sub.id, sub.interval_days);
    await activityLog.add('charge', `Manual charge of ${(sub.amount/100).toFixed(2)} for ${c.email}`, c.id, sub.amount);
    res.json({ success: true, paymentIntentId: pi.id });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});
app.delete('/api/subscriptions/:id', async (req, res) => { try { if (!(await scopedSubscription(req,res,req.params.id))) return; await subscriptions.updateStatus(req.params.id, 'cancelled'); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });

// ── Payments ──────────────────────────────────────────────────────────────────
app.get('/api/payments', async (req, res) => { try { const list=await payments.recent(1000); res.json(list.filter(p => rowWithinScope(req,p))); } catch(err) { res.status(500).json({ error: err.message }); } });
app.get('/api/payments/:id/financials', async (req, res) => {
  try {
    await ensureWebhookColumns();
    const r = await pool.query(`SELECT p.*, c.stripe_account_id, sa.secret_key, sa.name AS account_name
      FROM payments p
      JOIN customers c ON c.id=p.customer_id
      LEFT JOIN stripe_accounts sa ON sa.id=c.stripe_account_id
      WHERE p.id=$1`, [req.params.id]);
    const payment = r.rows[0];
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (!ensureRowScope(req, res, payment)) return;
    if (!payment.stripe_payment_intent) return res.json(payment);
    if (!payment.secret_key) return res.status(400).json({ error: 'Stripe account secret key not found for this payment' });
    const stripe = require('stripe')(payment.secret_key);
    const pi = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent, { expand: ['latest_charge.balance_transaction', 'payment_method', 'invoice'] });
    const financials = await getFinancialsFromPaymentIntent(stripe, pi);
    const cardDetails = await getCardDetailsFromPaymentIntent(stripe, pi);
    const invoice = await getInvoiceFromPaymentIntent(stripe, pi);
    const invoiceId = typeof invoice === 'string' ? invoice : invoice?.id || payment.stripe_invoice_id || null;
    await pool.query(`UPDATE payments SET
      stripe_fee=COALESCE($1,stripe_fee), net_amount=COALESCE($2,net_amount), balance_transaction_id=COALESCE($3,balance_transaction_id), financial_currency=COALESCE($4,financial_currency),
      stripe_invoice_id=COALESCE($5,stripe_invoice_id), card_brand=COALESCE($6,card_brand), card_last4=COALESCE($7,card_last4),
      card_exp_month=COALESCE($8,card_exp_month), card_exp_year=COALESCE($9,card_exp_year), card_country=COALESCE($10,card_country), card_funding=COALESCE($11,card_funding)
      WHERE id=$12`, [financials.stripe_fee, financials.net_amount, financials.balance_transaction_id, financials.financial_currency, invoiceId, cardDetails.brand, cardDetails.last4, cardDetails.exp_month, cardDetails.exp_year, cardDetails.country, cardDetails.funding, payment.id]);
    await pool.query(`UPDATE payments SET payment_method_type=COALESCE($1,payment_method_type), wallet_type=COALESCE($2,wallet_type), wallet_checked=TRUE WHERE id=$3`,
      [cardDetails.payment_method_type, cardDetails.wallet_type, payment.id]).catch(()=>{});
    const updated = await pool.query(`SELECT p.*, c.email, c.name, COALESCE(p.card_brand,c.card_brand) AS card_brand, COALESCE(p.card_last4,c.card_last4) AS card_last4, sa.name AS account_name
      FROM payments p JOIN customers c ON c.id=p.customer_id LEFT JOIN stripe_accounts sa ON sa.id=c.stripe_account_id WHERE p.id=$1`, [payment.id]);
    res.json(updated.rows[0] || payment);
  } catch(err) {
    console.error('[payment-financials] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/payments/:id/retry', async (req, res) => {
  try {
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS retry_of_payment_id INT REFERENCES payments(id)').catch(()=>{});
    const r = await pool.query('SELECT p.*, c.stripe_customer_id, c.stripe_payment_method, c.stripe_account_id, c.email, c.name FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.id=$1', [req.params.id]);
    const p = r.rows[0];
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (!ensureRowScope(req, res, p)) return;
    if (p.status !== 'failed') return res.status(400).json({ error: 'Only failed payments can be retried' });
    const acc = await stripeAccounts.byId(p.stripe_account_id);
    const stripe = require('stripe')(acc.secret_key);
    const pi = await stripe.paymentIntents.create({ amount: p.amount, currency: p.currency||'usd', customer: p.stripe_customer_id, payment_method: p.stripe_payment_method, confirm: true, off_session: true });
    const status = pi.status==='succeeded'?'succeeded':'failed';
    await payments.insert({ customer_id: p.customer_id, subscription_id: p.subscription_id, stripe_payment_intent: pi.id, amount: p.amount, currency: p.currency, status, failure_reason: null, retry_of_payment_id: p.id });
    await activityLog.add('retry', `Retried payment for ${p.name}: ${status}`, p.customer_id, p.amount);
    res.json({ success: status==='succeeded', status, retry_of_payment_id: p.id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/payments/:id/note', async (req, res) => {
  try {
    const paymentScope = await pool.query('SELECT c.stripe_account_id FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.id=$1', [req.params.id]);
    if (!paymentScope.rows[0]) return res.status(404).json({ error: 'Payment not found' });
    if (!ensureRowScope(req, res, paymentScope.rows[0])) return;
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS note TEXT');
    await pool.query('UPDATE payments SET note=$1 WHERE id=$2', [req.body.note, req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/payments/export', async (req, res) => {
  try {
    if (isReadOnlyUser(req.currentUser)) return res.status(403).json({ error: 'View-only access cannot export payment data' });
    const list = (await payments.recent(10000)).filter(p => rowWithinScope(req,p));
    const csv = ['Customer,Email,Amount,Status,Date'].concat(list.map(p=>`${p.name||''},${p.email||''},${(p.amount||0)/100},${p.status},${p.created_at}`)).join('\n');
    res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=payments.csv'); res.send(csv);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Payment Links ─────────────────────────────────────────────────────────────
app.post('/api/payment-links', async (req, res) => {
  try {
    const { name, amount, currency, interval_days, stripe_account_id } = req.body;
    const acc = stripe_account_id ? await stripeAccounts.byId(stripe_account_id) : await stripeAccounts.default();
    if (!acc) return res.status(400).json({ error: 'No Stripe account found' });
    if (!ensureRowScope(req, res, { stripe_account_id: acc.id })) return;
    const stripe = require('stripe')(acc.secret_key);
    const product = await stripe.products.create({ name: name||'Subscription', metadata: { source: 'subloop' } });
    const intervalMap = { 7: 'week', 14: 'week', 30: 'month', 90: 'month', 365: 'year' };
    const recurringInterval = intervalMap[Number(interval_days)] || 'month';
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: amount,
      currency: currency||'usd',
      recurring: { interval: recurringInterval },
      metadata: { source: 'subloop', interval_days: String(interval_days || 30) }
    });
    console.log('[payment-link] created recurring price:', price.id, 'interval:', recurringInterval, 'amount:', amount, 'account:', acc.name);
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: { metadata: { source: 'subloop', interval_days: String(interval_days || 30) } },
      metadata: { source: 'subloop', type: 'subscription_link' }
    });
    console.log('[payment-link] created subscription payment link:', link.id, link.url);
    res.json({ success: true, url: link.url, price_id: price.id, payment_link_id: link.id });
  } catch(err) {
    console.error('[payment-links] ERROR:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ── Plan Templates ────────────────────────────────────────────────────────────
app.get('/api/plan-templates', async (req, res) => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS plan_templates (id SERIAL PRIMARY KEY, name TEXT, amount INT, currency TEXT DEFAULT 'usd', interval_days INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    const r = await pool.query('SELECT * FROM plan_templates ORDER BY created_at ASC');
    res.json(r.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/plan-templates', async (req, res) => { try { if (!isOwnerOrAdmin(req.currentUser)) return res.status(403).json({ error: 'Only an administrator can manage shared templates' }); const { name, amount, currency, interval_days } = req.body; await pool.query('INSERT INTO plan_templates (name,amount,currency,interval_days) VALUES ($1,$2,$3,$4)', [name, amount, currency||'usd', interval_days||30]); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });
app.delete('/api/plan-templates/:id', async (req, res) => { try { if (!isOwnerOrAdmin(req.currentUser)) return res.status(403).json({ error: 'Only an administrator can manage shared templates' }); await pool.query('DELETE FROM plan_templates WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });

// ── Run Rebills ───────────────────────────────────────────────────────────────
app.post('/api/run-rebills', async (req, res) => {
  try {
    const due = await subscriptions.due();
    const eligible = [];
    for (const sub of due) {
      const customer = await customers.byId(sub.customer_id);
      if (customer && rowWithinScope(req, customer)) eligible.push({ sub, customer });
    }
    let charged = 0, failed = 0;
    for (const item of eligible) {
      const sub = item.sub;
      const c = item.customer;
      try {
        const acc = await stripeAccounts.byId(c.stripe_account_id);
        const stripe = require('stripe')(acc.secret_key);
        const pi = await stripe.paymentIntents.create({ amount: sub.amount, currency: sub.currency||'usd', customer: c.stripe_customer_id, payment_method: c.stripe_payment_method, confirm: true, off_session: true });
        const status = pi.status==='succeeded'?'succeeded':'failed';
        await payments.insert({ customer_id: c.id, subscription_id: sub.id, stripe_payment_intent: pi.id, amount: sub.amount, currency: sub.currency||'usd', status, failure_reason: null });
        if (status==='succeeded') {
          charged++;
          await subscriptions.advanceBillingDate(sub.id, sub.interval_days);
          await activityLog.add('payment', `Charged ${(sub.amount/100).toFixed(2)} from ${c.name}`, c.id, sub.amount);
        } else {
          failed++;
          await activityLog.add('failed', `Failed charge for ${c.name}`, c.id, sub.amount);
        }
      } catch(e) { failed++; }
    }
    res.json({ success: true, charged, failed, total: eligible.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Activity ──────────────────────────────────────────────────────────────────
app.get('/api/activity', async (req, res) => {
  try {
    const username = req.currentUser ? req.currentUser.username : req.headers['x-username'];
    let list = (await activityLog.recent(100)).filter(row => rowWithinScope(req,row));
    if (username) {
      try {
        const userRow = await pool.query('SELECT role FROM admin_users WHERE LOWER(username)=LOWER($1)', [username]);
        if (userRow.rows[0] && userRow.rows[0].role === 'viewer') {
          list = list.filter(a => ['payment','failed','retry','charge','dunning','proration','resume'].includes(a.type));
        }
      } catch(e) {}
    }
    res.json(list);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Settings ──────────────────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await settingsDb.getAll();
    delete settings.two_fa_secret;
    delete settings.two_fa_secret_pending;
    delete settings.two_fa_enabled;
    res.json(settings);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/settings', async (req, res) => {
  try { await settingsDb.set(req.body.key, req.body.value); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/settings', async (req, res) => {
  try { await settingsDb.set(req.body.key, req.body.value); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Webhook Logs ──────────────────────────────────────────────────────────────
app.get('/api/webhook-logs', async (req, res) => { try { const list=await webhookLogs.recent(50); const ids=scopedAccountIds(req); if(ids===null) return res.json(list); const visible=await pool.query('SELECT name FROM stripe_accounts WHERE id=ANY($1::int[])',[ids]); const names=new Set(visible.rows.map(r=>r.name)); res.json(list.filter(w=>names.has(w.account_name))); } catch(err) { res.status(500).json({ error: err.message }); } });

// ── Security ──────────────────────────────────────────────────────────────────
// Security is personal: each signed-in user sees their own logins and controls their own authenticator.
app.get('/api/security/login-history', async (req, res) => {
  try { res.json(await security.recentLoginsForUser(req.currentUser.id, 20)); }
  catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/security/2fa/status', async (req, res) => {
  try { const state = await adminUsers.twoFAState(req.currentUser.id); res.json({ enabled: !!state.enabled }); }
  catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/security/2fa/setup', async (req, res) => {
  try {
    if (!speakeasy) return res.status(400).json({ error: 'speakeasy not installed' });
    const secret = speakeasy.generateSecret({ name: 'Subloop (' + req.currentUser.username + ')' });
    await adminUsers.setPending2FA(req.currentUser.id, secret.base32);
    const qr = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrCode: qr });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/security/2fa/verify', async (req, res) => {
  try {
    if (!speakeasy) return res.status(503).json({ valid: false, success: false, error: 'Authenticator verification is unavailable' });
    const state = await adminUsers.twoFAState(req.currentUser.id);
    if (!state.two_fa_secret_pending) return res.status(400).json({ error: 'No pending 2FA setup' });
    const valid = speakeasy.totp.verify({ secret: state.two_fa_secret_pending, encoding: 'base32', token: req.body.token, window: 2 });
    if (!valid) return res.json({ success: false, error: 'Invalid code' });
    await adminUsers.enable2FA(req.currentUser.id, state.two_fa_secret_pending);
    res.json({ success: true, valid: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/security/2fa/validate', async (req, res) => {
  try {
    const challenge = parseAdminToken(req.body.login_challenge, '2fa');
    if (!challenge) return res.status(401).json({ valid: false, error: 'Login session expired. Please sign in again.' });
    const user = await adminUsers.byId(challenge.id);
    if (!user) return res.status(401).json({ valid: false, error: 'Access has been revoked.' });
    const state = await adminUsers.twoFAState(user.id);
    if (!state.enabled) return res.json({ valid: true, token: issueAdminToken(user), ...accessResponse(user) });
    if (!speakeasy) return res.status(503).json({ valid: false, error: 'Authenticator verification is unavailable' });
    if (!state.two_fa_secret) return res.status(503).json({ valid: false, error: 'Authenticator configuration is missing' });
    const valid = speakeasy.totp.verify({ secret: state.two_fa_secret, encoding: 'base32', token: req.body.token, window: 2 });
    if (!valid) return res.json({ valid: false });
    res.json({ valid: true, token: issueAdminToken(user), ...accessResponse(user) });
  } catch(err) { res.status(500).json({ valid: false, error: 'Could not verify authenticator code' }); }
});
app.post('/api/security/2fa/disable', async (req, res) => {
  try { await adminUsers.disable2FA(req.currentUser.id); res.json({ success: true }); }
  catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Admin Users ───────────────────────────────────────────────────────────────
function cleanAccountAccessInput(role, accountScope, allowedAccountIds) {
  const readonlyRole = role === 'analyst' || role === 'viewer';
  const scope = (readonlyRole || role === 'custom') && accountScope === 'selected' ? 'selected' : 'all';
  const ids = Array.isArray(allowedAccountIds) ? [...new Set(allowedAccountIds.map(Number).filter(Number.isInteger))] : [];
  return { accountScope: scope, allowedAccountIds: scope === 'selected' ? ids : [] };
}
async function validateSelectedAccounts(scope, ids) {
  if (scope !== 'selected') return true;
  if (!ids.length) return false;
  const r = await pool.query('SELECT COUNT(*) AS n FROM stripe_accounts WHERE id=ANY($1::int[])', [ids]);
  return Number(r.rows[0]?.n) === ids.length;
}
function actorCanCreateManagedUser(actor, role) {
  if (!actor) return false;
  if (actor.role === 'owner') return ['admin','analyst','viewer','custom'].includes(role);
  if (actor.role === 'admin') return ['analyst','viewer','custom'].includes(role);
  return false;
}
function actorCanManageUser(actor, target) {
  if (!actor || !target) return false;
  if (actor.role === 'owner') return target.role !== 'owner';
  if (actor.role === 'admin') return ['analyst','viewer','custom'].includes(target.role);
  return false;
}
app.get('/api/admin-users', async (req, res) => {
  try {
    const list = await adminUsers.all();
    if (req.currentUser.role === 'owner') return res.json(list);
    res.json(list.map(({ two_fa_enabled, ...user }) => user));
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/admin-users', async (req, res) => {
  try {
    const { username, password, role, permissions, account_scope, allowed_account_ids } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const safeRole = ['admin','analyst','viewer','custom'].includes(role) ? role : null;
    if (!safeRole) return res.status(400).json({ error: 'Select a valid access level' });
    if (!actorCanCreateManagedUser(req.currentUser, safeRole)) {
      return res.status(403).json({ error: req.currentUser.role === 'admin' ? 'Only the Owner can grant Admin access' : 'Not allowed to create this access level' });
    }
    const access = cleanAccountAccessInput(safeRole, account_scope, allowed_account_ids);
    if (!(await validateSelectedAccounts(access.accountScope, access.allowedAccountIds))) return res.status(400).json({ error: 'Select at least one valid Stripe account' });
    await adminUsers.create(username, password, safeRole, sanitizeSections(safeRole, permissions), access.accountScope, access.allowedAccountIds);
    await activityLog.add('security', `New access user created: ${username}`);
    res.json({ success: true });
  } catch(err) {
    if (err.message.includes('unique')) return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});
app.delete('/api/admin-users/:id', async (req, res) => {
  try {
    const target = await adminUsers.byId(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!actorCanManageUser(req.currentUser, target)) {
      return res.status(403).json({ error: 'You cannot remove this user access' });
    }
    await adminUsers.delete(req.params.id);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/admin-users/:id/permissions', async (req, res) => {
  try {
    const { role, permissions, account_scope, allowed_account_ids } = req.body;
    const current = await adminUsers.byId(req.params.id);
    if (!current) return res.status(404).json({ error: 'User not found' });
    if (!actorCanManageUser(req.currentUser, current)) {
      return res.status(403).json({ error: 'You cannot edit this user access' });
    }
    const safeRole = ['admin','analyst','viewer','custom'].includes(role) ? role : current.role;
    if (!actorCanCreateManagedUser(req.currentUser, safeRole)) {
      return res.status(403).json({ error: req.currentUser.role === 'admin' ? 'Only the Owner can grant Admin access' : 'Not allowed to grant this access level' });
    }
    const access = cleanAccountAccessInput(safeRole, account_scope, allowed_account_ids);
    if (!(await validateSelectedAccounts(access.accountScope, access.allowedAccountIds))) return res.status(400).json({ error: 'Select at least one valid Stripe account' });
    await adminUsers.updateAccess(req.params.id, safeRole, sanitizeSections(safeRole, permissions), access.accountScope, access.allowedAccountIds);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/admin-users/:id/change-password', async (req, res) => {
  try {
    const target = await adminUsers.byId(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const isSelf = Number(target.id) === Number(req.currentUser.id);
    const ownerReset = req.currentUser.role === 'owner' && target.role !== 'owner';
    if (!isSelf && !ownerReset) return res.status(403).json({ error: 'You cannot reset this user password' });
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    await adminUsers.changePassword(req.params.id, password);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Owner-only oversight; secrets are never returned.
app.get('/api/admin-users/:id/security', async (req, res) => {
  try {
    if (req.currentUser.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
    const target = await adminUsers.byId(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const history = await security.recentLoginsForUser(target.id, 20);
    res.json({ username: target.username, two_fa_enabled: !!target.two_fa_enabled, login_history: history });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/admin-users/:id/security/reset-2fa', async (req, res) => {
  try {
    if (req.currentUser.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
    const target = await adminUsers.byId(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (Number(target.id) === Number(req.currentUser.id)) return res.status(400).json({ error: 'Disable your own 2FA from the Security page' });
    await adminUsers.disable2FA(target.id);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Auth ──────────────────────────────────────────────────────────────────────
function requestClientIp(req) {
  const forwarded = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.socket.remoteAddress || 'unknown');
}
function safeIntegerSetting(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = requestClientIp(req);
    const maxAttempts = safeIntegerSetting(await settingsDb.get('max_login_attempts'), 5, 3, 20);
    const lockoutMinutes = safeIntegerSetting(await settingsDb.get('lockout_minutes'), 15, 1, 60);
    const recentFailures = await security.recentFailures(ip, lockoutMinutes);

    if (recentFailures >= maxAttempts) {
      return res.status(429).json({
        success: false,
        locked: true,
        lockout_minutes: lockoutMinutes,
        error: `Too many failed login attempts. Try again after ${lockoutMinutes} minutes.`
      });
    }

    const user = await adminUsers.verify(username, password);
    if (user) {
      await adminUsers.updateLastLogin(user.id);
      await security.logAttempt(ip, true, user.id, user.username);
      const twoFaState = await adminUsers.twoFAState(user.id);
      if (twoFaState.enabled) return res.json({ success: true, requires_2fa: true, login_challenge: issueAdminToken(user, '2fa', 5), ...accessResponse(user) });
      return res.json({ success: true, token: issueAdminToken(user), ...accessResponse(user) });
    }

    const attemptedUser = username ? await adminUsers.byUsername(username) : null;
    await security.logAttempt(ip, false, attemptedUser ? attemptedUser.id : null, username || null);
    if (recentFailures + 1 >= maxAttempts) {
      return res.status(429).json({
        success: false,
        locked: true,
        lockout_minutes: lockoutMinutes,
        error: `Too many failed login attempts. Login locked for ${lockoutMinutes} minutes.`
      });
    }
    res.json({ success: false });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/auth/check', async (req, res) => {
  try {
    const token = parseAdminToken(bearerToken(req), 'access');
    if (!token) return res.json({ valid: false });
    const user = await adminUsers.byId(token.id);
    if (!user) return res.json({ valid: false });
    res.json({ valid: true, ...accessResponse(user) });
  } catch(err) { res.json({ valid: false }); }
});

// ── Stats & Dashboard ─────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const ids = scopedAccountIds(req);
    const r = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN s.status='active' THEN ${usdAmountSql('s')} ELSE 0 END),0) as mrr,
        COUNT(DISTINCT CASE WHEN s.status='active' THEN s.id END) as active_subscriptions,
        COUNT(DISTINCT c.id) as total_customers,
        COUNT(DISTINCT CASE WHEN c.card_last4 IS NOT NULL THEN c.id END) as saved_cards,
        COUNT(CASE WHEN p.status='failed' AND p.created_at >= NOW()-INTERVAL '30 days' THEN 1 END) as failed_payments,
        COALESCE(SUM(CASE WHEN p.status='succeeded' AND p.created_at >= DATE_TRUNC('month',NOW()) THEN ${usdAmountSql('p')} ELSE 0 END),0) as revenue_month,
        COALESCE(SUM(CASE WHEN p.status='succeeded' THEN ${usdAmountSql('p')} ELSE 0 END),0) as total_revenue,
        COUNT(DISTINCT CASE WHEN c.created_at >= NOW()-INTERVAL '30 days' THEN c.id END) as new_customers_30d
      FROM customers c
      LEFT JOIN subscriptions s ON s.customer_id=c.id
      LEFT JOIN payments p ON p.customer_id=c.id
      WHERE ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))
    `, [ids]);
    const row = r.rows[0];
    const sc = await pool.query("SELECT COUNT(*) as n FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.status='succeeded' AND p.created_at >= NOW()-INTERVAL '30 days' AND ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))", [ids]);
    const fc = await pool.query("SELECT COUNT(*) as n FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.status='failed' AND p.created_at >= NOW()-INTERVAL '30 days' AND ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))", [ids]);
    const total = parseInt(sc.rows[0].n)+parseInt(fc.rows[0].n);
    const custStats = await pool.query("SELECT COUNT(*) as total, COUNT(CASE WHEN status='cancelled' AND created_at >= NOW()-INTERVAL '30 days' THEN 1 END) as churned_30d FROM customers WHERE ($1::int[] IS NULL OR stripe_account_id=ANY($1::int[]))", [ids]);
    const cs = custStats.rows[0];
    const churnRate = parseInt(cs.total)>0?((parseInt(cs.churned_30d)||0)/parseInt(cs.total)*100).toFixed(1):0;
    const avgLtv = parseInt(cs.total)>0?Math.round(parseInt(row.total_revenue)/parseInt(cs.total)):0;
    res.json({ ...row, payment_success_rate: total>0?Math.round((parseInt(sc.rows[0].n)/total)*100):100, churn_rate: churnRate, avg_ltv: avgLtv, revenue_30d: row.revenue_month });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/revenue-chart', async (req, res) => {
  try {
    const ids = scopedAccountIds(req);
    const allTime = String(req.query.period || '').toLowerCase() === 'all';
    const dateCondition = allTime ? '' : " AND p.created_at >= NOW() - INTERVAL '60 days'";
    const r = await pool.query(`SELECT DATE(p.created_at) as day, SUM(CASE WHEN p.status='succeeded' THEN ${usdAmountSql('p')} ELSE 0 END) as revenue, COUNT(CASE WHEN p.status='succeeded' THEN 1 END) as count FROM payments p JOIN customers c ON c.id=p.customer_id WHERE ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))${dateCondition} GROUP BY DATE(p.created_at) ORDER BY day ASC`, [ids]);
    res.json(r.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/daily-summary', async (req, res) => {
  try {
    const ids = scopedAccountIds(req);
    const r = await pool.query(`SELECT COALESCE(SUM(CASE WHEN p.status='succeeded' AND p.created_at >= CURRENT_DATE THEN ${usdAmountSql('p')} ELSE 0 END),0) as revenue_today, COALESCE(COUNT(CASE WHEN p.status='succeeded' AND p.created_at >= CURRENT_DATE THEN 1 END),0) as payments_today, COALESCE(COUNT(CASE WHEN p.status='failed' AND p.created_at >= CURRENT_DATE THEN 1 END),0) as failed_today, COALESCE(SUM(CASE WHEN p.status='succeeded' AND p.created_at >= CURRENT_DATE - INTERVAL '7 days' THEN ${usdAmountSql('p')} ELSE 0 END),0) as revenue_7d, COALESCE(COUNT(CASE WHEN p.status='succeeded' AND p.created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END),0) as payments_7d, COALESCE(SUM(CASE WHEN p.status='succeeded' AND p.created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN ${usdAmountSql('p')} ELSE 0 END),0) as revenue_month, COALESCE(COUNT(CASE WHEN p.status='succeeded' AND p.created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 END),0) as payments_month FROM payments p JOIN customers c ON c.id=p.customer_id WHERE ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))`, [ids]);
    const c = await pool.query(`SELECT COUNT(*) as active_total, COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as new_today, COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as new_7d FROM customers WHERE status='active' AND ($1::int[] IS NULL OR stripe_account_id=ANY($1::int[]))`, [ids]);
    res.json({ ...r.rows[0], ...c.rows[0] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/forecast', async (req, res) => {
  try {
    const allSubs = (await subscriptions.all()).filter(sub => rowWithinScope(req, sub));
    const activeSubs = allSubs.filter(s => s.status === 'active');
    const now = new Date();
    let forecast30=0, forecast60=0, forecast90=0;
    activeSubs.forEach(s => {
      const next = new Date(s.next_billing_date);
      const diff = (next - now) / (1000*60*60*24);
      const usdAmount = toUsdCents(s.amount, s.currency);
      forecast30 += usdAmount * (Math.floor(30/s.interval_days) + (diff<=30?1:0));
      forecast60 += usdAmount * (Math.floor(60/s.interval_days) + (diff<=60?1:0));
      forecast90 += usdAmount * (Math.floor(90/s.interval_days) + (diff<=90?1:0));
    });
    res.json({ forecast30, forecast60, forecast90 });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/churn-alerts', async (req, res) => {
  try {
    const ids = scopedAccountIds(req);
    const cancelled = await pool.query(`SELECT c.id,c.name,c.email,s.updated_at as churned_at FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.status='cancelled' AND s.updated_at >= NOW()-INTERVAL '7 days' AND ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[])) ORDER BY s.updated_at DESC LIMIT 20`, [ids]);
    const failing = await pool.query(`SELECT c.id,c.name,c.email,s.dunning_count FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.dunning_count >= 3 AND s.status != 'cancelled' AND ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[])) ORDER BY s.dunning_count DESC LIMIT 20`, [ids]);
    res.json({ cancelled: cancelled.rows, failing: failing.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/mrr-history', async (req, res) => {
  try {
    const ids = scopedAccountIds(req);
    const r = await pool.query(`SELECT TO_CHAR(DATE_TRUNC('month', p.created_at), 'Mon YY') as month, DATE_TRUNC('month', p.created_at) as month_date, SUM(CASE WHEN p.status='succeeded' THEN ${usdAmountSql('p')} ELSE 0 END) as revenue FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.created_at >= NOW() - INTERVAL '12 months' AND ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[])) GROUP BY DATE_TRUNC('month', p.created_at) ORDER BY month_date ASC`, [ids]);
    res.json(r.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/recovery-rate', async (req, res) => {
  try {
    await ensureWebhookColumns();
    const ids = scopedAccountIds(req);
    const r = await pool.query(`
      WITH failed AS (
        SELECT p.*
        FROM payments p
        JOIN customers fc ON fc.id=p.customer_id
        WHERE (p.status='failed' OR COALESCE(p.was_failed,false)=true)
          AND p.created_at >= NOW()-INTERVAL '30 days'
          AND ($1::int[] IS NULL OR fc.stripe_account_id=ANY($1::int[]))
      ),
      recovered_successes AS (
        /* 1) A retry started through Subloop and linked to a failed payment. */
        SELECT DISTINCT s.id AS recovery_id
        FROM payments s
        JOIN failed f ON f.id=s.retry_of_payment_id
        WHERE s.status='succeeded'

        UNION

        /* 2) Stripe updates the same PaymentIntent from failed to succeeded. */
        SELECT DISTINCT f.id AS recovery_id
        FROM failed f
        WHERE f.recovered_at IS NOT NULL

        UNION

        /* 3) Stripe payment/invoice/subscription retry: later successful attempt for the same bill. */
        SELECT DISTINCT s.id AS recovery_id
        FROM payments s
        JOIN failed f
          ON s.customer_id=f.customer_id
         AND s.status='succeeded'
         AND s.created_at > f.created_at
         AND s.created_at <= f.created_at + INTERVAL '30 days'
         AND s.amount=f.amount
         AND LOWER(COALESCE(s.currency,'usd'))=LOWER(COALESCE(f.currency,'usd'))
         AND (
           (f.stripe_invoice_id IS NOT NULL AND s.stripe_invoice_id=f.stripe_invoice_id)
           OR (f.subscription_id IS NOT NULL AND s.subscription_id=f.subscription_id)
         )

        UNION

        /* 4) Customer self-retry for one-time checkout: same customer/amount/currency shortly after failure. */
        SELECT DISTINCT s.id AS recovery_id
        FROM payments s
        JOIN failed f
          ON s.customer_id=f.customer_id
         AND s.status='succeeded'
         AND s.created_at > f.created_at
         AND s.created_at <= f.created_at + INTERVAL '24 hours'
         AND s.amount=f.amount
         AND LOWER(COALESCE(s.currency,'usd'))=LOWER(COALESCE(f.currency,'usd'))
         AND COALESCE(s.subscription_id,0)=0
         AND COALESCE(f.subscription_id,0)=0
         AND (
           f.card_last4 IS NULL OR s.card_last4 IS NULL OR f.card_last4=s.card_last4
         )
      )
      SELECT
        (SELECT COUNT(*) FROM failed) AS total_failed,
        (SELECT COUNT(*) FROM recovered_successes) AS recovered
    `, [ids]);
    const row = r.rows[0] || {};
    const tf = parseInt(row.total_failed) || 0;
    const recovered = parseInt(row.recovered) || 0;
    const rate = tf > 0 ? Math.round((recovered / tf) * 100) : 0;
    res.json({ total_failed: tf, recovered, rate });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Shopify Platform OAuth ─────────────────────────────────────────────────
app.get('/api/shopify/install', async (req, res) => {
  try {
    const cfg = shopifyConfig();
    const shop = normalizeShopDomain(req.query.shop);
    if (!shop || !shop.endsWith('.myshopify.com')) return res.status(400).send('Invalid Shopify store domain. Use your-store.myshopify.com.');
    if (!cfg.apiKey || !cfg.apiSecret || !cfg.redirectUri) return res.status(500).send('Shopify OAuth is not configured. Add SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL and SHOPIFY_REDIRECT_URI in Railway, then redeploy.');
    const params = new URLSearchParams({ client_id: cfg.apiKey, scope: cfg.scopes, redirect_uri: cfg.redirectUri, state: signShopifyState(shop) });
    return res.redirect(`https://${shop}/admin/oauth/authorize?${params.toString()}`);
  } catch (err) { return res.status(500).send(err.message); }
});

app.get('/api/shopify/callback', async (req, res) => {
  try {
    const cfg = shopifyConfig();
    const shop = normalizeShopDomain(req.query.shop);
    const code = String(req.query.code || '');
    if (!shop || !code) return res.status(400).send('Missing Shopify shop or code.');
    if (!verifyShopifyQueryHmac(req.query)) return res.status(400).send('Invalid Shopify callback signature.');
    if (!verifyShopifyState(req.query.state, shop)) return res.status(400).send('Invalid or expired Shopify OAuth state. Try connecting again.');

    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: cfg.apiKey, client_secret: cfg.apiSecret, code })
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_description || tokenData.error || `Shopify token exchange failed (${tokenResponse.status})`);

    let shopName = shop;
    try {
      const data = await shopifyGraphql(shop, tokenData.access_token, `query { shop { name myshopifyDomain } }`);
      shopName = data?.shop?.name || shop;
    } catch (_) {}

    const r = await pool.query(`INSERT INTO shopify_stores (name, shop_domain, access_token, scopes, status, webhook_status, installed_at, updated_at)
      VALUES ($1,$2,$3,$4,'connected','pending',NOW(),NOW())
      ON CONFLICT (shop_domain) DO UPDATE SET name=EXCLUDED.name, access_token=EXCLUDED.access_token, scopes=EXCLUDED.scopes, status='connected', installed_at=COALESCE(shopify_stores.installed_at,NOW()), updated_at=NOW()
      RETURNING id`, [shopName, shop, tokenData.access_token, tokenData.scope || cfg.scopes]);
    await pool.query('INSERT INTO shopify_activity (shopify_store_id,event_type,status,object_id) VALUES ($1,$2,$3,$4)', [r.rows[0].id, 'store.oauth_connected', 'success', shop]).catch(()=>{});
    syncShopifyStoreBasics(r.rows[0].id, shop, tokenData.access_token).catch(()=>{});
    return res.redirect('/?platform=shopify&page=shopify-stores&shopify_connected=1');
  } catch (err) {
    console.error('[shopify oauth] callback failed:', err.message, err.stack);
    return res.status(500).send(`Shopify connection failed: ${err.message}`);
  }
});

// ── Shopify Platform (MVP scaffold) ──────────────────────────────────────────
app.get('/api/shopify/overview', async (req, res) => {
  try {
    const [stores, customers, orders, subs, attempts] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM shopify_stores'),
      pool.query('SELECT COUNT(*)::int AS c FROM shopify_customers'),
      pool.query('SELECT COUNT(*)::int AS c FROM shopify_orders'),
      pool.query('SELECT COUNT(*)::int AS c FROM shopify_subscription_contracts'),
      pool.query("SELECT COUNT(*) FILTER (WHERE status='failed')::int AS failed, COUNT(*) FILTER (WHERE recovered_at IS NOT NULL)::int AS recovered FROM shopify_billing_attempts")
    ]);
    const revenue = await pool.query('SELECT COALESCE(SUM(amount),0)::int AS total, COALESCE(MAX(currency),\'usd\') AS currency FROM shopify_orders').catch(()=>({ rows:[{ total:0, currency:'usd' }] }));
    const failed = attempts.rows[0]?.failed || 0;
    const recovered = attempts.rows[0]?.recovered || 0;
    res.json({ stores: stores.rows[0].c, customers: customers.rows[0].c, orders: orders.rows[0].c, subscriptions: subs.rows[0].c, revenue: revenue.rows[0].total, currency: revenue.rows[0].currency || 'usd', recovery_rate: failed ? Math.round((recovered / failed) * 100) : 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/shopify/stores', async (req, res) => {
  try { const r = await pool.query('SELECT id,name,shop_domain,status,webhook_status,created_at FROM shopify_stores ORDER BY created_at DESC, id DESC'); res.json(r.rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/shopify/stores', async (req, res) => {
  try {
    if (!requireOwnerOrAdmin(req, res)) return;
    const name = String(req.body.name || '').trim();
    const shopDomain = String(req.body.shop_domain || '').trim().replace(/^https?:\/\//,'').replace(/\/$/,'').toLowerCase();
    const accessToken = String(req.body.access_token || '').trim();
    if (!shopDomain || !shopDomain.endsWith('.myshopify.com')) return res.status(400).json({ error: 'Use a valid myshopify.com domain.' });
    const r = await pool.query(`INSERT INTO shopify_stores (name, shop_domain, access_token, status, webhook_status, updated_at)
      VALUES ($1,$2,$3,'connected','pending',NOW())
      ON CONFLICT (shop_domain) DO UPDATE SET name=EXCLUDED.name, access_token=COALESCE(NULLIF(EXCLUDED.access_token,''), shopify_stores.access_token), updated_at=NOW()
      RETURNING id,name,shop_domain,status,webhook_status,created_at`, [name || shopDomain, shopDomain, accessToken || null]);
    await pool.query('INSERT INTO shopify_activity (shopify_store_id,event_type,status,object_id) VALUES ($1,$2,$3,$4)', [r.rows[0].id, 'store.connected', 'success', shopDomain]).catch(()=>{});
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/shopify/customers', async (req, res) => {
  try { const r = await pool.query(`SELECT c.*, s.name AS store_name FROM shopify_customers c LEFT JOIN shopify_stores s ON s.id=c.shopify_store_id ORDER BY c.created_at DESC LIMIT 100`); res.json(r.rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/shopify/orders', async (req, res) => {
  try { const r = await pool.query(`SELECT o.*, s.name AS store_name FROM shopify_orders o LEFT JOIN shopify_stores s ON s.id=o.shopify_store_id ORDER BY o.created_at DESC LIMIT 100`); res.json(r.rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/shopify/subscriptions', async (req, res) => {
  try { const r = await pool.query(`SELECT sc.*, s.name AS store_name FROM shopify_subscription_contracts sc LEFT JOIN shopify_stores s ON s.id=sc.shopify_store_id ORDER BY sc.created_at DESC LIMIT 100`); res.json(r.rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/shopify/products', async (req, res) => {
  try { const r = await pool.query(`SELECT p.*, s.name AS store_name FROM shopify_products p LEFT JOIN shopify_stores s ON s.id=p.shopify_store_id ORDER BY p.created_at DESC LIMIT 100`); res.json(r.rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/shopify/activity', async (req, res) => {
  try { const r = await pool.query(`SELECT a.*, s.name AS store_name FROM shopify_activity a LEFT JOIN shopify_stores s ON s.id=a.shopify_store_id ORDER BY a.created_at DESC LIMIT 100`); res.json(r.rows); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/shopify/recovery', async (req, res) => {
  try {
    const r = await pool.query("SELECT COUNT(*) FILTER (WHERE status='failed')::int AS failed, COUNT(*) FILTER (WHERE recovered_at IS NOT NULL)::int AS recovered FROM shopify_billing_attempts WHERE attempted_at >= NOW() - INTERVAL '30 days'");
    const failed = r.rows[0]?.failed || 0; const recovered = r.rows[0]?.recovered || 0;
    res.json({ failed, recovered, rate: failed ? Math.round((recovered / failed) * 100) : 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/search', async (req, res) => {
  try {
    const ids = scopedAccountIds(req);
    const q = '%'+(req.query.q||'').trim()+'%';
    if (!req.query.q || req.query.q.trim().length < 2) return res.json({ customers:[], payments:[], subscriptions:[] });
    const [cust, pmts, subs] = await Promise.all([
      pool.query(`SELECT id,name,email,card_brand,card_last4,status FROM customers WHERE (name ILIKE $1 OR email ILIKE $1) AND ($2::int[] IS NULL OR stripe_account_id=ANY($2::int[])) LIMIT 5`, [q, ids]),
      pool.query(`SELECT p.id,c.name,c.email,p.amount,p.currency,p.status,p.created_at FROM payments p JOIN customers c ON c.id=p.customer_id WHERE (c.name ILIKE $1 OR c.email ILIKE $1) AND ($2::int[] IS NULL OR c.stripe_account_id=ANY($2::int[])) ORDER BY p.created_at DESC LIMIT 5`, [q, ids]),
      pool.query(`SELECT s.id,c.name,c.email,s.amount,s.currency,s.status FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE (c.name ILIKE $1 OR c.email ILIKE $1) AND ($2::int[] IS NULL OR c.stripe_account_id=ANY($2::int[])) LIMIT 5`, [q, ids]),
    ]);
    res.json({ customers: cust.rows, payments: pmts.rows, subscriptions: subs.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/ip-geo', async (req, res) => {
  try {
    const ip = req.query.ip;
    if (!ip || ip==='::1' || ip==='127.0.0.1') return res.json({ country: 'Local', code: null });
    const response = await fetch('https://ipapi.co/'+ip+'/json/');
    const data = await response.json();
    res.json({ country: data.country_name||null, code: data.country_code?data.country_code.toLowerCase():null });
  } catch(err) { res.json({ country: null, code: null }); }
});
app.get('/api/debug/webhook', async (req, res) => {
  const r = await pool.query('SELECT id, name, LEFT(webhook_secret,10) as ws_preview, webhook_secret IS NOT NULL as has_secret FROM stripe_accounts');
  res.json(r.rows);
});

app.get('/api/debug/admins', async (req, res) => {
  const results = {};
  try { const t1 = await pool.query('SELECT NOW() as time'); results.db_connected=true; results.db_time=t1.rows[0].time; } catch(e) { results.db_connected=false; }
  try { const t2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='admin_users'"); results.columns=t2.rows.map(r=>r.column_name); } catch(e) {}
  try { const t3 = await pool.query('SELECT COUNT(*) FROM admin_users'); results.row_count=t3.rows[0].count; } catch(e) {}
  res.json(results);
});

// ── Webhook ───────────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 8080;
// Database migrations, including admin access columns, finish once before accepting requests.
// API permission checks then use fast SELECT queries only; they never run ALTER TABLE during page loads.
init().then(async () => {
  await ensureShopifyTables();
  app.listen(PORT, () => console.log(`Subloop running on port ${PORT}`));
}).catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
