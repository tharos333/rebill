const express = require('express');
const app = express();
const path = require('path');
const { init, pool, settingsDb, stripeAccounts, customers, subscriptions, payments, activityLog, webhookLogs, security, adminUsers } = require('./db');
let speakeasy, QRCode;
try { speakeasy = require('speakeasy'); QRCode = require('qrcode'); } catch(e) {}

const Stripe = require('stripe');
const crypto = require('crypto');
const { initScheduler } = require('./scheduler');


// Admin access tokens and Stripe-account scoping.
// Set SUBLOOP_AUTH_SECRET in Railway for tokens that remain valid after a deploy/restart.
const SUBLOOP_AUTH_SECRET = process.env.SUBLOOP_AUTH_SECRET || crypto.randomBytes(48).toString('hex');
const SUBLOOP_LOGIN_ORIGIN = String(process.env.SUBLOOP_LOGIN_ORIGIN || 'https://subloop.space').replace(/\/$/, '');
const SUBLOOP_APP_ORIGIN = String(process.env.SUBLOOP_APP_ORIGIN || 'https://app.subloop.space').replace(/\/$/, '');
const SUBLOOP_LOGIN_HOST = new URL(SUBLOOP_LOGIN_ORIGIN).hostname.toLowerCase();
const SUBLOOP_APP_HOST = new URL(SUBLOOP_APP_ORIGIN).hostname.toLowerCase();
const SUBLOOP_COOKIE_DOMAIN = process.env.SUBLOOP_COOKIE_DOMAIN || '.subloop.space';
const SUBLOOP_SESSION_COOKIE = 'subloop_session';
const SUBLOOP_SESSION_MINUTES = 480;
const ANALYST_DEFAULT_SECTIONS = ['dashboard','customers','payments','forecast','summary','mrr','recovery'];
// View-only users may be assigned any non-administrative operating/reporting page, but cannot write.
const ANALYST_ASSIGNABLE_SECTIONS = ['dashboard','activity','customers','subscriptions','payments','links','accounts','forecast','summary','mrr','recovery','webhooks'];
// Custom users manage selected operating pages only; all operations remain constrained to their account scope.
const CUSTOM_ASSIGNABLE_SECTIONS = ['dashboard','activity','customers','subscriptions','payments','links','accounts','forecast','summary','mrr','recovery','webhooks'];
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
function requestHostname(req) {
  const raw = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  return raw.replace(/:\d+$/, '');
}
function isSubloopDomainHost(host) {
  host = String(host || '').toLowerCase();
  return host === SUBLOOP_LOGIN_HOST || host === SUBLOOP_APP_HOST || host === 'subloop.space' || host.endsWith('.subloop.space');
}
function cookieToken(req) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== SUBLOOP_SESSION_COOKIE) continue;
    try { return decodeURIComponent(part.slice(idx + 1).trim()); } catch (_err) { return part.slice(idx + 1).trim(); }
  }
  return '';
}
function requestAccessToken(req) { return cookieToken(req) || bearerToken(req); }
function sessionCookieOptions(req, clearing=false) {
  const host = requestHostname(req);
  const options = {
    httpOnly: true,
    secure: !(host === 'localhost' || host === '127.0.0.1'),
    sameSite: 'lax',
    path: '/'
  };
  if (isSubloopDomainHost(host)) options.domain = SUBLOOP_COOKIE_DOMAIN;
  if (!clearing) options.maxAge = SUBLOOP_SESSION_MINUTES * 60 * 1000;
  return options;
}
function setAdminSessionCookie(req, res, token) {
  res.cookie(SUBLOOP_SESSION_COOKIE, token, sessionCookieOptions(req));
}
function clearAdminSessionCookie(req, res) {
  res.clearCookie(SUBLOOP_SESSION_COOKIE, sessionCookieOptions(req, true));
}
function authTokenForJson(req, token) {
  // On subloop.space/app.subloop.space, authentication is intentionally HttpOnly-cookie based.
  // Keep the legacy token response only for non-Subloop hosts (for example the Railway fallback URL).
  return isSubloopDomainHost(requestHostname(req)) ? {} : { token };
}
function normalizeAllowedAccountIds(user) {
  const list = Array.isArray(user?.allowed_account_ids) ? user.allowed_account_ids : [];
  return list.map(Number).filter(Number.isInteger);
}
function isOwnerOrAdmin(user) { return !!user && (user.role === 'owner' || user.role === 'admin'); }
function isSuperAdmin(user) { return !!user && user.role === 'owner' && user.is_super_admin === true; }
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
  return { role: user.role, username: user.username, permissions: user.permissions || [], account_scope: user.account_scope || 'all', allowed_account_ids: normalizeAllowedAccountIds(user), workspace_id: user.workspace_id || null, is_super_admin: !!user.is_super_admin };
}
function sectionForApiPath(req) {
  const path = req.path;
  if (path.startsWith('/stats') || path.startsWith('/revenue-chart') || path.startsWith('/churn-alerts')) return 'dashboard';
  if (path.startsWith('/customers')) return 'customers';
  if (path.startsWith('/subscriptions')) return 'subscriptions';
  if (path.startsWith('/payments')) return 'payments';
  if (path.startsWith('/payment-link-accounts') || path.startsWith('/payment-links') || path.startsWith('/plan-templates') || path.startsWith('/embedded-checkout-token')) return 'links';
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
  if (path.startsWith('/licenses')) return 'licenses';
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
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_origin TEXT').catch(()=>{});
  await pool.query('ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT').catch(()=>{});
  await pool.query('ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_price_id TEXT').catch(()=>{});
  await pool.query('ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT').catch(()=>{});
  await pool.query('ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paused_by_customer BOOLEAN DEFAULT false').catch(()=>{});
  await pool.query('ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status_before_cancel TEXT').catch(()=>{});
  await pool.query('ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ').catch(()=>{});
  await pool.query('ALTER TABLE subscriptions ALTER COLUMN updated_at SET DEFAULT NOW()').catch(()=>{});
  await pool.query('UPDATE subscriptions SET updated_at=created_at WHERE updated_at IS NULL').catch(()=>{});
  await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT').catch(()=>{});
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_uidx ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL').catch(()=>{});
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_payment_intent_uidx ON payments(stripe_payment_intent) WHERE stripe_payment_intent IS NOT NULL').catch(()=>{});
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

function normalizeSubStatus(value) {
  const raw = String(value || '').toLowerCase().trim().replace(/-/g, '_');
  if (raw === 'cancelled') return 'canceled';
  if (raw === 'cancelling') return 'canceling';
  return raw;
}

const CURRENT_SUB_STATUSES = new Set(['active','paused','canceling','trialing','past_due','unpaid']);
const AUTO_CHARGE_SUB_STATUSES = new Set(['active','trialing','past_due']);
function isCurrentSubscriptionStatus(value) { return CURRENT_SUB_STATUSES.has(normalizeSubStatus(value)); }
function willStripeAttemptRecurringBilling(value) { return AUTO_CHARGE_SUB_STATUSES.has(normalizeSubStatus(value)); }

async function reconcileCustomerLifecycle(customerId, options = {}) {
  if (!customerId) return null;
  const r = await pool.query(`
    SELECT c.status,
      COUNT(s.id)::int AS total_subs,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(s.status,''))='active')::int AS active_subs,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(s.status,''))='trialing')::int AS trialing_subs,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(s.status,''))='past_due')::int AS past_due_subs,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(s.status,''))='unpaid')::int AS unpaid_subs,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(s.status,''))='canceling')::int AS canceling_subs,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(s.status,''))='paused')::int AS paused_subs,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(s.status,''))='paused' AND COALESCE(s.paused_by_customer,false)=true)::int AS customer_paused_subs,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(s.status,'')) IN ('incomplete','incomplete_expired','pending'))::int AS incomplete_subs,
      COUNT(*) FILTER (WHERE s.id IS NOT NULL AND LOWER(COALESCE(s.status,'')) NOT IN ('incomplete','incomplete_expired','pending'))::int AS relationship_subs,
      MAX(CASE
        WHEN LOWER(COALESCE(s.status,'')) IN ('incomplete','incomplete_expired','pending') THEN NULL
        WHEN LOWER(COALESCE(s.status,'')) IN ('canceled','cancelled') THEN COALESCE(s.ended_at,s.updated_at,s.created_at)
        ELSE COALESCE(s.updated_at,s.created_at)
      END) AS last_sub_activity,
      (SELECT MAX(p.created_at) FROM payments p WHERE p.customer_id=c.id AND LOWER(p.status)='succeeded' AND (p.payment_origin='one_time' OR (p.subscription_id IS NULL AND p.stripe_invoice_id IS NULL))) AS last_one_time_success,
      (SELECT COUNT(*)::int FROM payments p WHERE p.customer_id=c.id AND LOWER(p.status)='succeeded') AS successful_payments
    FROM customers c
    LEFT JOIN subscriptions s ON s.customer_id=c.id
    WHERE c.id=$1
    GROUP BY c.id,c.status
  `, [customerId]);
  const row = r.rows[0];
  if (!row) return null;

  let target;
  if (row.active_subs > 0 || row.trialing_subs > 0) target = 'active';
  else if (row.past_due_subs > 0) target = 'past_due';
  else if (row.unpaid_subs > 0) target = 'unpaid';
  else if (row.canceling_subs > 0) target = 'canceling';
  else if (row.paused_subs > 0) {
    // Individually paused subscriptions do not pause the customer record. A true
    // customer-level pause is identified by paused_by_customer.
    target = row.customer_paused_subs > 0 ? 'paused' : 'active';
  } else if (row.incomplete_subs > 0 && row.relationship_subs === 0) {
    // Incomplete/pending records have never established a recurring relationship.
    // A brand-new customer stays internal pending; an existing one-time customer stays one-time active.
    target = row.successful_payments > 0 ? 'active' : 'pending';
  } else if (row.relationship_subs > 0) {
    const oneTimeAfterSubscription = row.last_one_time_success && row.last_sub_activity && new Date(row.last_one_time_success) > new Date(row.last_sub_activity);
    target = (options.oneTimeSuccess || oneTimeAfterSubscription) ? 'active' : 'canceled';
  } else target = row.successful_payments > 0 ? 'active' : normalizeSubStatus(row.status || 'active');

  await pool.query("UPDATE customers SET status=$1 WHERE id=$2 AND LOWER(COALESCE(status,''))<>$1", [target, customerId]).catch(()=>{});
  return target;
}

async function reconcileExistingCustomerLifecycles() {
  const r = await pool.query('SELECT id FROM customers ORDER BY id');
  for (const row of r.rows) {
    await reconcileCustomerLifecycle(row.id).catch(err => {
      console.log('[customer-reconcile] could not reconcile customer', row.id, err.message);
    });
  }
  console.log(`[customer-reconcile] checked ${r.rows.length} existing customer lifecycle(s)`);
}

function paymentMethodId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id || null;
}

async function retrieveAttachedPaymentMethod(stripe, customerId, candidate) {
  const id = paymentMethodId(candidate);
  if (!id) return null;
  try {
    const pm = typeof candidate === 'object' && candidate.id ? candidate : await stripe.paymentMethods.retrieve(id);
    const attachedCustomer = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id || null;
    // Off-session reuse is allowed only when Stripe says this PaymentMethod is attached
    // to this exact Customer. A card used once but left unattached is not reusable.
    if (!attachedCustomer || attachedCustomer !== customerId) return null;
    if (pm.type !== 'card') return null;
    return pm;
  } catch(e) {
    return null;
  }
}

// Pick the safest/most relevant saved card for a recurring charge.
// We also keep the selection source so the UI can show exactly which card will be charged.
async function resolveBestPaymentMethodInfo(stripe, customerId, options = {}) {
  if (!customerId) return { paymentMethod: null, source: null, sourceLabel: null };
  const candidates = [];

  if (options.subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(options.subscriptionId, {
        expand: ['default_payment_method']
      });
      if (sub?.default_payment_method) {
        candidates.push({
          candidate: sub.default_payment_method,
          source: 'subscription_default',
          sourceLabel: 'Subscription default'
        });
      }
    } catch(e) {
      console.log('[payment-method] could not read subscription default:', e.message);
    }
  }

  if (options.preferredPaymentMethodId) {
    candidates.push({
      candidate: options.preferredPaymentMethodId,
      source: 'preferred',
      sourceLabel: 'Preferred saved card'
    });
  }

  try {
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ['invoice_settings.default_payment_method']
    });
    if (customer && !customer.deleted && customer.invoice_settings?.default_payment_method) {
      candidates.push({
        candidate: customer.invoice_settings.default_payment_method,
        source: 'customer_default',
        sourceLabel: 'Customer default'
      });
    }
  } catch(e) {
    console.log('[payment-method] could not read customer default:', e.message);
  }

  if (options.localPaymentMethodId) {
    candidates.push({
      candidate: options.localPaymentMethodId,
      source: 'subloop_saved',
      sourceLabel: 'Saved in Subloop'
    });
  }

  const seen = new Set();
  for (const entry of candidates) {
    const id = paymentMethodId(entry.candidate);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const pm = await retrieveAttachedPaymentMethod(stripe, customerId, entry.candidate);
    if (pm) return { paymentMethod: pm, source: entry.source, sourceLabel: entry.sourceLabel };
  }

  try {
    const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 10 });
    const ordered = [...(pms.data || [])].sort((a, b) => (b.created || 0) - (a.created || 0));
    for (const pm of ordered) {
      if (seen.has(pm.id)) continue;
      const usable = await retrieveAttachedPaymentMethod(stripe, customerId, pm);
      if (usable) {
        return {
          paymentMethod: usable,
          source: 'newest_saved',
          sourceLabel: 'Newest saved card'
        };
      }
    }
  } catch(e) {
    console.log('[payment-method] could not list customer cards:', e.message);
  }

  return { paymentMethod: null, source: null, sourceLabel: null };
}

async function resolveBestPaymentMethod(stripe, customerId, options = {}) {
  const info = await resolveBestPaymentMethodInfo(stripe, customerId, options);
  return info.paymentMethod;
}

async function syncLocalPaymentMethod(localCustomerId, pm) {
  if (!localCustomerId || !pm?.id) return;
  await pool.query(
    `UPDATE customers SET stripe_payment_method=$1, card_brand=COALESCE($2,card_brand), card_last4=COALESCE($3,card_last4),
      card_exp_month=COALESCE($4,card_exp_month), card_exp_year=COALESCE($5,card_exp_year) WHERE id=$6`,
    [pm.id, pm.card?.brand || null, pm.card?.last4 || null, pm.card?.exp_month || null, pm.card?.exp_year || null, localCustomerId]
  ).catch(()=>{});
}

async function getCustomerPaymentMethod(stripe, customerId, preferredPaymentMethodId = null) {
  return resolveBestPaymentMethod(stripe, customerId, { preferredPaymentMethodId });
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
        card_exp_month=COALESCE($6,card_exp_month), card_exp_year=COALESCE($7,card_exp_year)
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
        card_exp_month=COALESCE($7,card_exp_month), card_exp_year=COALESCE($8,card_exp_year)
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
      card_exp_month=COALESCE($7,card_exp_month), card_exp_year=COALESCE($8,card_exp_year)
     WHERE stripe_customer_id=$9`,
    [email, name, usedAccount?.id || null, pm?.id || null, pm?.card?.brand || null, pm?.card?.last4 || null, pm?.card?.exp_month || null, pm?.card?.exp_year || null, stripeCustomerId]
  );
  console.log('[customer] updated:', email, 'local id:', existing.rows[0].id);
  return { id: existing.rows[0].id, email, name };
}

async function subscriptionPaymentIsConfirmed(stripe, stripeSub, invoiceId = null) {
  try {
    // Free subscriptions/trials do not require an initial charge. Paid plans do.
    const item = stripeSub?.items?.data?.[0];
    const amount = Number(item?.price?.unit_amount ?? item?.plan?.amount ?? 0);
    if (amount <= 0 || stripeSub?.status === 'trialing') return true;

    let invoice = stripeSub?.latest_invoice || null;
    if (typeof invoice === 'string') {
      try { invoice = await stripe.invoices.retrieve(invoice, { expand: ['payment_intent'] }); }
      catch (_e) { invoice = null; }
    }
    if (!invoice && invoiceId) {
      try { invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['payment_intent'] }); }
      catch (_e) { invoice = null; }
    }
    if (!invoice) return false;
    if (invoice.paid === true || String(invoice.status || '').toLowerCase() === 'paid' || Number(invoice.amount_paid || 0) > 0) return true;

    let pi = invoice.payment_intent || null;
    if (typeof pi === 'string') {
      try { pi = await stripe.paymentIntents.retrieve(pi); } catch (_e) { pi = null; }
    }
    return !!(pi && String(pi.status || '').toLowerCase() === 'succeeded');
  } catch (e) {
    console.log('[subscription] payment confirmation check failed:', e.message);
    return false;
  }
}

async function syncFirstPaymentEligibility(customerId, subscriptionId, paymentStatus) {
  if (!customerId) return;
  const normalized = String(paymentStatus || '').toLowerCase();

  if (subscriptionId) {
    const paid = await pool.query(
      "SELECT 1 FROM payments WHERE subscription_id=$1 AND LOWER(status)='succeeded' LIMIT 1",
      [subscriptionId]
    ).catch(()=>({ rows: [] }));
    const hasSubscriptionSuccess = !!paid.rows[0] || normalized === 'succeeded';

    if (hasSubscriptionSuccess) {
      // Eligibility is subscription-specific: an older successful payment from this customer
      // must never activate a different new subscription whose first invoice failed.
      await pool.query(
        "UPDATE subscriptions SET status='active', updated_at=NOW() WHERE id=$1 AND LOWER(COALESCE(status,'')) IN ('pending','incomplete')",
        [subscriptionId]
      ).catch(()=>{});
    } else if (['failed','requires_payment_method','requires_action'].includes(normalized)) {
      // Only the first-payment failure makes a subscription incomplete. Renewal failures for
      // an already-paid subscription remain owned by Stripe's past_due/unpaid lifecycle.
      await pool.query(
        `UPDATE subscriptions s SET status='incomplete', updated_at=NOW()
         WHERE s.id=$1 AND s.amount>0
           AND LOWER(COALESCE(s.status,'')) IN ('active','pending','incomplete')
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.subscription_id=s.id AND LOWER(p.status)='succeeded')`,
        [subscriptionId]
      ).catch(()=>{});
    }
    await reconcileCustomerLifecycle(customerId).catch(()=>{});
    return;
  }

  // Standalone one-time payments never alter subscription state. A successful one-time
  // payment can make a customer current again after old subscriptions were canceled.
  if (normalized === 'succeeded') await reconcileCustomerLifecycle(customerId, { oneTimeSuccess: true }).catch(()=>{});
  else await reconcileCustomerLifecycle(customerId).catch(()=>{});
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
  // Mirror Stripe billing controls into Subloop. A subscription scheduled to end
  // remains active in Stripe, so show it as "canceling" until the period ends.
  // This must take precedence over pause_collection so the user can see/undo the cancellation.
  let localSubscriptionStatus = stripeSub.status === 'canceled'
    ? 'canceled'
    : (stripeSub.cancel_at_period_end ? 'canceling' : (stripeSub.pause_collection ? 'paused' : (stripeSub.status || 'active')));

  const localCustomer = await upsertStripeCustomer(stripe, usedAccount, stripeCustomerId, stripeSub.default_payment_method || null);
  if (!localCustomer?.id) return null;

  const existingByStripe = await pool.query('SELECT id FROM subscriptions WHERE stripe_subscription_id=$1', [subId]);

  // Never expose a paid subscription as Active until its first payment is actually confirmed.
  // Stripe may already have cus_*/sub_* objects after a failed first attempt; those are not
  // paying customers in Subloop. Keep them internally as pending/incomplete for payment history.
  if (amount > 0 && localSubscriptionStatus === 'active') {
    let paymentConfirmed = await subscriptionPaymentIsConfirmed(stripe, stripeSub, invoiceId);
    if (!paymentConfirmed && existingByStripe.rows[0]) {
      const localPaid = await pool.query(
        "SELECT 1 FROM payments WHERE subscription_id=$1 AND LOWER(status)='succeeded' LIMIT 1",
        [existingByStripe.rows[0].id]
      ).catch(()=>({rows:[]}));
      paymentConfirmed = !!localPaid.rows[0];
    }
    if (!paymentConfirmed && invoiceId) {
      const invoicePaid = await pool.query(
        "SELECT 1 FROM payments WHERE stripe_invoice_id=$1 AND LOWER(status)='succeeded' LIMIT 1",
        [invoiceId]
      ).catch(()=>({rows:[]}));
      paymentConfirmed = !!invoicePaid.rows[0];
    }
    if (!paymentConfirmed) localSubscriptionStatus = 'incomplete';
  }
  if (existingByStripe.rows[0]) {
    await pool.query(
      `UPDATE subscriptions SET customer_id=$1, amount=$2, currency=$3, interval_days=$4, next_billing_date=$5, status=$6,
       stripe_price_id=$7, stripe_invoice_id=$8, updated_at=NOW(),
       ended_at=CASE WHEN LOWER($6) IN ('canceled','cancelled','incomplete_expired') THEN COALESCE(ended_at,NOW()) ELSE NULL END
       WHERE id=$9`,
      [localCustomer.id, amount, currency, intervalDays, nextBilling, localSubscriptionStatus, price.id || null, invoiceId, existingByStripe.rows[0].id]
    );
    await reconcileCustomerLifecycle(localCustomer.id).catch(()=>{});
    console.log('[subscription] updated subscription:', subId, 'row id:', existingByStripe.rows[0].id, 'status:', localSubscriptionStatus);
    return existingByStripe.rows[0].id;
  }

  const ins = await pool.query(
    `INSERT INTO subscriptions (customer_id,amount,currency,interval_days,next_billing_date,status,stripe_subscription_id,stripe_price_id,stripe_invoice_id,updated_at,ended_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),CASE WHEN LOWER($6) IN ('canceled','cancelled','incomplete_expired') THEN NOW() ELSE NULL END) RETURNING id`,
    [localCustomer.id, amount, currency, intervalDays, nextBilling, localSubscriptionStatus, subId, price.id || null, invoiceId]
  );
  await reconcileCustomerLifecycle(localCustomer.id).catch(()=>{});
  console.log('[subscription] saved subscription:', subId, 'row id:', ins.rows[0].id, 'customer:', localCustomer.email, 'next billing:', nextBilling, 'status:', localSubscriptionStatus);
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
  if (typeof invoice.parent?.subscription_details?.subscription === 'string') return invoice.parent.subscription_details.subscription;
  if (invoice.parent?.subscription_details?.subscription?.id) return invoice.parent.subscription_details.subscription.id;
  for (const line of (invoice.lines?.data || [])) {
    if (typeof line.subscription === 'string') return line.subscription;
    if (line.subscription?.id) return line.subscription.id;
    if (typeof line.parent?.subscription_item_details?.subscription === 'string') return line.parent.subscription_item_details.subscription;
  }
  return null;
}

function paymentOriginFromStripeContext(pi, invoice, hasSubscription) {
  const explicit = String(pi?.metadata?.subloop_payment_origin || '').toLowerCase();
  if (['rebill','recurring_manual','one_time','subscription_initial','subscription_renewal'].includes(explicit)) return explicit;
  const reason = String(invoice?.billing_reason || '').toLowerCase();
  if (hasSubscription) {
    if (reason === 'subscription_create') return 'subscription_initial';
    if (reason === 'subscription_cycle') return 'subscription_renewal';
    return 'subscription';
  }
  return 'one_time';
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
  // Subloop manual recurring charges are standalone PaymentIntents, so Stripe has no invoice/subscription
  // relationship to infer from. Preserve the local subscription id in PaymentIntent metadata.
  if (!localSubId && pi?.metadata?.subloop_subscription_id) {
    const metadataSubId = parseInt(pi.metadata.subloop_subscription_id, 10);
    if (Number.isFinite(metadataSubId)) {
      const owned = await pool.query(`SELECT s.id FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1 AND c.id=$2 AND c.stripe_account_id=$3`, [metadataSubId, localCustomer.id, usedAccount.id]).catch(()=>({rows:[]}));
      if (owned.rows[0]) localSubId = owned.rows[0].id;
    }
  }
  const paymentOrigin = paymentOriginFromStripeContext(pi, invoice, !!(subId || localSubId));

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
      recovered_at=CASE WHEN $18='succeeded' AND (COALESCE(was_failed,false) OR status='failed') THEN COALESCE(recovered_at,NOW()) ELSE recovered_at END,
      payment_origin=COALESCE($19,payment_origin)
      WHERE id=$20`,
      [localCustomer.id, localSubId, amount, currency, status, failureReason, invoiceId, cardDetails.brand, cardDetails.last4, cardDetails.exp_month, cardDetails.exp_year, cardDetails.country, cardDetails.funding, financials.stripe_fee, financials.net_amount, financials.balance_transaction_id, financials.financial_currency, status, paymentOrigin, existingPayment.rows[0].id]);
    await pool.query(`UPDATE payments SET payment_method_type=COALESCE($1,payment_method_type), wallet_type=COALESCE($2,wallet_type), wallet_checked=TRUE WHERE id=$3`,
      [cardDetails.payment_method_type, cardDetails.wallet_type, existingPayment.rows[0].id]).catch(()=>{});
    await syncFirstPaymentEligibility(localCustomer.id, localSubId, status).catch(e => console.error('[payment] eligibility sync failed:', e.message));
    console.log('[external-import] updated payment:', pi.id, 'customer:', localCustomer.email, 'method:', cardDetails.payment_method_type || '-', 'wallet:', cardDetails.wallet_type || '-');
    return existingPayment.rows[0].id;
  }

  const ins = await pool.query(
    `INSERT INTO payments (customer_id,subscription_id,stripe_payment_intent,amount,currency,status,failure_reason,stripe_invoice_id,card_brand,card_last4,card_exp_month,card_exp_year,card_country,card_funding,stripe_fee,net_amount,balance_transaction_id,financial_currency,was_failed,payment_origin)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
    [localCustomer.id, localSubId, pi.id, amount, currency, status, failureReason, invoiceId, cardDetails.brand, cardDetails.last4, cardDetails.exp_month, cardDetails.exp_year, cardDetails.country, cardDetails.funding, financials.stripe_fee, financials.net_amount, financials.balance_transaction_id, financials.financial_currency, status==='failed', paymentOrigin]
  );
  await pool.query(`UPDATE payments SET payment_method_type=COALESCE($1,payment_method_type), wallet_type=COALESCE($2,wallet_type), wallet_checked=TRUE WHERE id=$3`,
    [cardDetails.payment_method_type, cardDetails.wallet_type, ins.rows[0].id]).catch(()=>{});
  await syncFirstPaymentEligibility(localCustomer.id, localSubId, status).catch(e => console.error('[payment] eligibility sync failed:', e.message));
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


// ── Embedded checkout helpers ─────────────────────────────────────────────────
// A signed embed token is intentionally safe to place in a public checkout page.
// It identifies only a Stripe account + recurring Price. Secret keys never leave Subloop.
async function getCheckoutSigningSecret() {
  let value = await settingsDb.get('checkout_signing_secret');
  if (!value) {
    value = crypto.randomBytes(48).toString('hex');
    await settingsDb.set('checkout_signing_secret', value);
  }
  return value;
}

async function signCheckoutPlan(payload) {
  const secret = await getCheckoutSigningSecret();
  const body = Buffer.from(JSON.stringify({ v: 1, ...payload })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

async function verifyCheckoutPlan(token) {
  try {
    const raw = String(token || '');
    const parts = raw.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const secret = await getCheckoutSigningSecret();
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || data.v !== 1 || !Number.isInteger(Number(data.account_id)) || !String(data.price_id || '').startsWith('price_')) return null;
    return data;
  } catch (_err) { return null; }
}

function checkoutTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function cleanCheckoutString(value, max = 200) {
  const out = String(value || '').trim();
  return out ? out.slice(0, max) : null;
}

function normalizeCheckoutAddress(input) {
  if (!input || typeof input !== 'object') return null;
  const address = {
    line1: cleanCheckoutString(input.line1 || input.address, 200),
    line2: cleanCheckoutString(input.line2 || input.apartment, 200),
    city: cleanCheckoutString(input.city, 100),
    state: cleanCheckoutString(input.state || input.region, 100),
    postal_code: cleanCheckoutString(input.postal_code || input.postcode || input.zip, 40),
    country: cleanCheckoutString(input.country, 2)?.toUpperCase() || null,
  };
  Object.keys(address).forEach((key) => { if (!address[key]) delete address[key]; });
  return Object.keys(address).length ? address : null;
}

function embeddedStripeClient(account) {
  // The custom subscription flow uses the same API version as the current Stripe
  // Dashboard webhook destination. Override with STRIPE_CHECKOUT_API_VERSION if needed.
  return Stripe(account.secret_key, { apiVersion: process.env.STRIPE_CHECKOUT_API_VERSION || '2026-07-29.dahlia' });
}

function keysMatchMode(account) {
  const sk = String(account?.secret_key || '');
  const pk = String(account?.publishable_key || '');
  if (!pk.startsWith('pk_')) return false;
  if (sk.startsWith('sk_live_')) return pk.startsWith('pk_live_');
  if (sk.startsWith('sk_test_')) return pk.startsWith('pk_test_');
  return true;
}

async function resolveEmbeddedPlan(token) {
  const plan = await verifyCheckoutPlan(token);
  if (!plan) throw Object.assign(new Error('Invalid embedded checkout token'), { statusCode: 400 });
  const account = await stripeAccounts.byId(plan.account_id);
  if (!account) throw Object.assign(new Error('Stripe account no longer exists'), { statusCode: 404 });
  if (!account.publishable_key || !keysMatchMode(account)) {
    throw Object.assign(new Error('Add the matching Stripe publishable key (pk_...) to this Stripe account in Subloop'), { statusCode: 409 });
  }
  const stripe = embeddedStripeClient(account);
  const price = await stripe.prices.retrieve(plan.price_id, { expand: ['product'] });
  if (!price || !price.active || !price.recurring || typeof price.unit_amount !== 'number') {
    throw Object.assign(new Error('This embedded checkout Price is inactive or is not a fixed recurring Price'), { statusCode: 409 });
  }
  return { plan, account, stripe, price };
}

function subscriptionClientSecret(subscription) {
  if (subscription?.pending_setup_intent) {
    const si = subscription.pending_setup_intent;
    return { type: 'setup', clientSecret: typeof si === 'string' ? null : si.client_secret || null };
  }
  const invoice = subscription?.latest_invoice;
  const secret = invoice && typeof invoice !== 'string' ? invoice.confirmation_secret?.client_secret || null : null;
  return secret ? { type: 'payment', clientSecret: secret } : { type: 'none', clientSecret: null };
}

// Public checkout API CORS. If CHECKOUT_ALLOWED_ORIGINS is empty, signed plan tokens may
// be used from any HTTPS origin (similar to a public Payment Link). In production, set it
// to your storefront domains, comma-separated.
const CHECKOUT_ALLOWED_ORIGINS = String(process.env.CHECKOUT_ALLOWED_ORIGINS || '')
  .split(',').map((v) => v.trim()).filter(Boolean);
function checkoutCors(req, res, next) {
  const origin = String(req.headers.origin || '');
  if (origin && CHECKOUT_ALLOWED_ORIGINS.length && !CHECKOUT_ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Checkout origin is not allowed' });
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  else if (!CHECKOUT_ALLOWED_ORIGINS.length) res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

const checkoutRateBuckets = new Map();
function checkoutRateLimit(req, res, next) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const limit = 60;
  const bucket = checkoutRateBuckets.get(ip);
  if (!bucket || now - bucket.started > windowMs) checkoutRateBuckets.set(ip, { started: now, count: 1 });
  else {
    bucket.count += 1;
    if (bucket.count > limit) return res.status(429).json({ error: 'Too many checkout requests. Please try again shortly.' });
  }
  if (checkoutRateBuckets.size > 5000) {
    for (const [key, value] of checkoutRateBuckets.entries()) if (now - value.started > windowMs) checkoutRateBuckets.delete(key);
  }
  next();
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

      else if (event.type === 'invoice.payment_action_required') {
        await handleInvoiceEvent(stripe, usedAccount, event.data.object, 'requires_action');
      }

      else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
        await saveSubscriptionFromStripe(stripe, usedAccount, event.data.object, event.type);
      }

      else if (event.type === 'customer.subscription.deleted') {
        const stripeSub = event.data.object;
        console.log('[subscription] deleted/canceled:', stripeSub.id);
        const localSubId = await saveSubscriptionFromStripe(stripe, usedAccount, stripeSub, event.type).catch(()=>null);
        const local = await pool.query("UPDATE subscriptions SET status='canceled', status_before_cancel=NULL, paused_by_customer=false, resume_date=NULL, ended_at=COALESCE(ended_at,NOW()), updated_at=NOW() WHERE stripe_subscription_id=$1 RETURNING customer_id", [stripeSub.id]).catch(()=>null);
        const customerId = local?.rows?.[0]?.customer_id;
        if (customerId) await reconcileCustomerLifecycle(customerId).catch(()=>{});
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



// ── Public embedded subscription checkout API ─────────────────────────────────
app.use('/checkout', checkoutCors, checkoutRateLimit);

app.get('/checkout/config', async (req, res) => {
  try {
    const { account, price } = await resolveEmbeddedPlan(req.query.token);
    const product = price.product && typeof price.product !== 'string' ? price.product : null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      publishableKey: account.publishable_key,
      priceId: price.id,
      productName: product?.name || 'Subscription',
      amount: price.unit_amount,
      currency: String(price.currency || 'usd').toLowerCase(),
      interval: price.recurring.interval,
      intervalCount: price.recurring.interval_count || 1,
      elementsOptions: {
        mode: 'subscription',
        amount: price.unit_amount,
        currency: String(price.currency || 'usd').toLowerCase(),
        paymentMethodTypes: ['card']
      }
    });
  } catch (err) {
    console.error('[embedded-checkout] config error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/checkout/create-subscription', async (req, res) => {
  try {
    const token = req.body?.token;
    const checkoutReference = cleanCheckoutString(req.body?.checkout_reference, 120);
    const email = cleanEmail(req.body?.customer?.email || req.body?.email);
    const firstName = cleanCheckoutString(req.body?.customer?.first_name, 100);
    const lastName = cleanCheckoutString(req.body?.customer?.last_name, 100);
    const suppliedName = cleanCheckoutString(req.body?.customer?.name || req.body?.name, 200);
    const name = suppliedName || [firstName, lastName].filter(Boolean).join(' ') || null;
    const phone = cleanCheckoutString(req.body?.customer?.phone || req.body?.phone, 50);
    const address = normalizeCheckoutAddress(req.body?.customer?.address || req.body?.address);

    if (!checkoutReference || !/^[A-Za-z0-9._:-]{6,120}$/.test(checkoutReference)) {
      return res.status(400).json({ error: 'checkout_reference is required (6-120 letters/numbers/._:-)' });
    }
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid customer email is required' });

    const { account, stripe, price } = await resolveEmbeddedPlan(token);
    const planHash = checkoutTokenHash(token);

    // Return the existing Stripe Subscription for retries/double-clicks using the same checkout reference.
    const existing = await pool.query(
      'SELECT * FROM embedded_checkout_sessions WHERE plan_token_hash=$1 AND checkout_reference=$2 LIMIT 1',
      [planHash, checkoutReference]
    );
    if (existing.rows[0]?.stripe_subscription_id) {
      const subscription = await stripe.subscriptions.retrieve(existing.rows[0].stripe_subscription_id, {
        expand: ['latest_invoice.confirmation_secret', 'pending_setup_intent', 'items.data.price']
      });
      const confirmation = subscriptionClientSecret(subscription);
      return res.json({
        success: true,
        reused: true,
        type: confirmation.type,
        clientSecret: confirmation.clientSecret,
        subscriptionId: subscription.id,
        customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
        status: subscription.status
      });
    }

    let customer = null;
    const matching = await stripe.customers.list({ email, limit: 1 });
    if (matching.data?.[0] && !matching.data[0].deleted) {
      customer = await stripe.customers.update(matching.data[0].id, {
        ...(name ? { name } : {}),
        ...(phone ? { phone } : {}),
        ...(address ? { address } : {}),
        metadata: { ...matching.data[0].metadata, subloop_source: 'embedded_checkout' }
      });
    } else {
      customer = await stripe.customers.create({
        email,
        ...(name ? { name } : {}),
        ...(phone ? { phone } : {}),
        ...(address ? { address } : {}),
        metadata: { subloop_source: 'embedded_checkout' }
      });
    }

    const shipping = address && name ? { name, address, ...(phone ? { phone } : {}) } : null;
    if (shipping) customer = await stripe.customers.update(customer.id, { shipping });

    const idempotencyKey = crypto.createHash('sha256').update(`${planHash}|${checkoutReference}`).digest('hex');
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card']
      },
      metadata: {
        source: 'subloop_embedded_checkout',
        checkout_reference: checkoutReference
      },
      expand: ['latest_invoice.confirmation_secret', 'pending_setup_intent', 'items.data.price']
    }, { idempotencyKey });

    await pool.query(
      `INSERT INTO embedded_checkout_sessions (plan_token_hash,checkout_reference,stripe_account_id,stripe_customer_id,stripe_subscription_id,updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (plan_token_hash,checkout_reference)
       DO UPDATE SET stripe_account_id=EXCLUDED.stripe_account_id,stripe_customer_id=EXCLUDED.stripe_customer_id,stripe_subscription_id=EXCLUDED.stripe_subscription_id,updated_at=NOW()`,
      [planHash, checkoutReference, account.id, customer.id, subscription.id]
    );

    // Save immediately as incomplete; normal Stripe webhooks update it to active/paid after confirmation.
    await saveSubscriptionFromStripe(stripe, account, subscription, 'embedded.checkout.created').catch((e) => {
      console.error('[embedded-checkout] local subscription save failed:', e.message);
    });

    const confirmation = subscriptionClientSecret(subscription);
    res.json({
      success: true,
      reused: false,
      type: confirmation.type,
      clientSecret: confirmation.clientSecret,
      subscriptionId: subscription.id,
      customerId: customer.id,
      status: subscription.status
    });
  } catch (err) {
    console.error('[embedded-checkout] create subscription error:', err.message, err.stack);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Require a verified session token for the application API and enforce page/read-only permissions.
app.use('/api', async (req, res, next) => {
  const openPaths = ['/auth/verify', '/auth/check', '/auth/logout', '/security/2fa/validate'];
  if (openPaths.includes(req.path)) return next();
  try {
    const data = parseAdminToken(requestAccessToken(req), 'access');
    if (!data) return res.status(401).json({ error: 'Authentication required' });
    const user = await adminUsers.byId(data.id);
    if (!user) return res.status(401).json({ error: 'Access has been revoked' });
    req.currentUser = user;
    const selfSecurityPath = req.path === '/security/login-history' || req.path.startsWith('/security/2fa/');
    const sensitive = ['/admin-users', '/settings', '/debug', '/licenses'];
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
        CASE WHEN COALESCE(publishable_key,'')<>'' THEN LEFT(publishable_key,12)||'...' ELSE NULL END as publishable_key_preview,
        COALESCE(publishable_key,'')<>'' AS has_publishable_key,
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
    if (!requireOwnerOrAdmin(req, res)) return;
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
    const { name, secret_key, publishable_key, webhook_secret } = req.body;
    if (!name || !secret_key) return res.status(400).json({ error: 'Name and secret key required' });
    if (publishable_key && !String(publishable_key).startsWith('pk_')) return res.status(400).json({ error: 'Publishable key must start with pk_' });
    await stripeAccounts.create({ name, secret_key, publishable_key, webhook_secret });
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/stripe-accounts/:id', async (req, res) => {
  try {
    const { name, secret_key, publishable_key, webhook_secret } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (publishable_key && !String(publishable_key).startsWith('pk_')) return res.status(400).json({ error: 'Publishable key must start with pk_' });
    const updates = ['name=$1'];
    const values = [name];
    if (secret_key && secret_key.trim()) { values.push(secret_key.trim()); updates.push(`secret_key=$${values.length}`); }
    if (publishable_key && publishable_key.trim()) { values.push(publishable_key.trim()); updates.push(`publishable_key=$${values.length}`); }
    if (webhook_secret && webhook_secret.trim()) { values.push(webhook_secret.trim()); updates.push(`webhook_secret=$${values.length}`); }
    values.push(req.params.id);
    await pool.query(`UPDATE stripe_accounts SET ${updates.join(', ')} WHERE id=$${values.length}`, values);
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
app.delete('/api/stripe-accounts/:id', async (req, res) => {
  try {
    if (!requireOwnerOrAdmin(req, res)) return;
    const account = await stripeAccounts.byId(req.params.id);
    if (!account) return res.status(404).json({ error: 'Stripe account not found' });
    const deps = await pool.query(`
      SELECT
        COUNT(DISTINCT c.id)::int AS customers,
        COUNT(DISTINCT s.id)::int AS subscriptions,
        COUNT(DISTINCT p.id)::int AS payments
      FROM customers c
      LEFT JOIN subscriptions s ON s.customer_id=c.id
      LEFT JOIN payments p ON p.customer_id=c.id
      WHERE c.stripe_account_id=$1
    `, [req.params.id]);
    const d = deps.rows[0] || {};
    if ((d.customers||0) > 0 || (d.subscriptions||0) > 0 || (d.payments||0) > 0) {
      return res.status(409).json({ error: 'Cannot delete this Stripe account while customer, subscription, or payment history is linked to it.', dependencies: d });
    }
    await stripeAccounts.delete(req.params.id);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Customers ─────────────────────────────────────────────────────────────────
app.get('/api/customers', async (req, res) => { try { const list=await customers.all(); res.json(list.filter(c => rowWithinScope(req,c))); } catch(err) { res.status(500).json({ error: err.message }); } });
app.get('/api/customers/:id/details', async (req, res) => {
  try {
    // Repair any stale customer status before rendering the drawer. This covers
    // older records that were canceled before lifecycle reconciliation existed.
    await reconcileCustomerLifecycle(req.params.id).catch(()=>{});
    const data = await customers.detail(req.params.id);
    if (!data.customer) return res.status(404).json({ error: 'Customer not found' });
    if (!ensureRowScope(req, res, data.customer)) return;

    // Live recurring-payment preview: show the exact saved card Subloop would choose right now.
    // This is read-only and does not modify any Stripe object or old transaction.
    data.rebill_payment_method = null;
    try {
      const c = data.customer;
      if (c.stripe_customer_id && c.stripe_account_id) {
        const acc = await stripeAccounts.byId(c.stripe_account_id);
        if (acc?.secret_key) {
          const stripe = require('stripe')(acc.secret_key);
          const subResult = await pool.query(`
            SELECT stripe_subscription_id
            FROM subscriptions
            WHERE customer_id=$1
              AND stripe_subscription_id IS NOT NULL
              AND stripe_subscription_id LIKE 'sub_%'
              AND LOWER(COALESCE(status,'')) NOT IN ('cancelled','canceled','incomplete_expired')
            ORDER BY
              CASE WHEN LOWER(COALESCE(status,''))='active' THEN 0
                   WHEN LOWER(COALESCE(status,''))='trialing' THEN 1
                   WHEN LOWER(COALESCE(status,''))='past_due' THEN 2
                   ELSE 3 END,
              next_billing_date ASC NULLS LAST,
              id DESC
            LIMIT 1
          `, [c.id]);
          const subscriptionId = subResult.rows[0]?.stripe_subscription_id || null;
          const info = await resolveBestPaymentMethodInfo(stripe, c.stripe_customer_id, {
            subscriptionId,
            localPaymentMethodId: c.stripe_payment_method
          });
          const pm = info.paymentMethod;
          if (pm) {
            data.rebill_payment_method = {
              id: pm.id,
              type: pm.type || 'card',
              brand: pm.card?.brand || null,
              last4: pm.card?.last4 || null,
              exp_month: pm.card?.exp_month || null,
              exp_year: pm.card?.exp_year || null,
              funding: pm.card?.funding || null,
              country: pm.card?.country || null,
              source: info.source,
              source_label: info.sourceLabel,
              subscription_id: subscriptionId
            };
          }
        }
      }
    } catch(previewErr) {
      console.log('[recurring-preview] could not build preview:', previewErr.message);
    }

    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/customers', async (req, res) => {
  try {
    const { stripe_customer_id, stripe_account_id, note } = req.body;
    if (!stripe_customer_id || !String(stripe_customer_id).startsWith('cus_')) return res.status(400).json({ error: 'A valid Stripe customer ID (cus_...) is required' });
    const account = stripe_account_id ? await stripeAccounts.byId(stripe_account_id) : await stripeAccounts.default();
    if (!account) return res.status(400).json({ error: 'Select a Stripe account first' });
    if (!ensureRowScope(req, res, { stripe_account_id: account.id })) return;
    if (!account.secret_key) return res.status(400).json({ error: 'Stripe account secret key is missing' });
    const stripe = new Stripe(account.secret_key);
    const c = await upsertStripeCustomer(stripe, account, String(stripe_customer_id).trim(), null);
    if (!c?.id) return res.status(404).json({ error: 'Stripe customer could not be retrieved' });
    if (note) await customers.updateNote(c.id, note);
    await reconcileCustomerLifecycle(c.id).catch(()=>{});
    res.json({ success: true, id: c.id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
async function stripeSubscriptionClientForLocalSub(localSub) {
  if (!localSub?.stripe_subscription_id) return null;
  const account = await stripeAccounts.byId(localSub.stripe_account_id);
  if (!account?.secret_key) throw new Error('Stripe account secret key not found');
  return require('stripe')(account.secret_key);
}

function pauseResumeTimestamp(dateValue) {
  if (!dateValue) return null;
  const t = Math.floor(new Date(String(dateValue) + 'T00:00:00Z').getTime() / 1000);
  return Number.isFinite(t) && t > Math.floor(Date.now()/1000) ? t : null;
}

async function syncStripeSubscriptionState(localSub, targetStatus, options = {}) {
  if (!localSub?.stripe_subscription_id) return { stripeManaged: false };
  const stripe = await stripeSubscriptionClientForLocalSub(localSub);
  const remote = await stripe.subscriptions.retrieve(localSub.stripe_subscription_id);

  if (targetStatus === 'paused') {
    if (remote.status === 'canceled') throw new Error('This Stripe subscription is already canceled');
    // For normal active Stripe subscriptions, pause payment collection. Stripe keeps
    // status=active, so Subloop mirrors pause_collection as status=paused.
    if (remote.status !== 'paused') {
      const pauseCollection = { behavior: 'void' };
      const resumesAt = pauseResumeTimestamp(options.resumeDate);
      if (resumesAt) pauseCollection.resumes_at = resumesAt;
      await stripe.subscriptions.update(localSub.stripe_subscription_id, { pause_collection: pauseCollection });
    }
    return { stripeManaged: true };
  }

  if (targetStatus === 'active') {
    if (remote.status === 'canceled') throw new Error('Canceled Stripe subscriptions cannot be reactivated');

    // If this subscription was only scheduled to cancel, undo that first.
    // This preserves the same sub_xxx and normal renewal schedule.
    if (remote.cancel_at_period_end) {
      await stripe.subscriptions.update(localSub.stripe_subscription_id, { cancel_at_period_end: false });
      // A canceling subscription was originally live; if it also has pause_collection,
      // leave the pause in place unless this call is explicitly resuming a paused subscription.
      if (String(localSub.status || '').toLowerCase() === 'canceling') {
        const restoredStatus = (remote.status === 'paused' || !!remote.pause_collection || String(localSub.status_before_cancel || '').toLowerCase() === 'paused') ? 'paused' : 'active';
        return { stripeManaged: true, reactivated: true, restoredStatus };
      }
    }

    if (remote.status === 'paused') {
      await stripe.subscriptions.resume(localSub.stripe_subscription_id, { billing_cycle_anchor: 'unchanged' });
    } else if (remote.pause_collection) {
      await stripe.subscriptions.update(localSub.stripe_subscription_id, { pause_collection: '' });
    }
    return { stripeManaged: true };
  }

  if (targetStatus === 'canceling') {
    if (remote.status === 'canceled') throw new Error('This Stripe subscription is already canceled');
    if (!remote.cancel_at_period_end) {
      const updated = await stripe.subscriptions.update(localSub.stripe_subscription_id, { cancel_at_period_end: true });
      return { stripeManaged: true, cancelAtPeriodEnd: true, currentPeriodEnd: updated.current_period_end || null };
    }
    return { stripeManaged: true, cancelAtPeriodEnd: true, currentPeriodEnd: remote.current_period_end || null };
  }

  // Permanent immediate cancellation. This cannot be undone on the same Stripe subscription.
  if (targetStatus === 'cancelled' || targetStatus === 'canceled') {
    if (remote.status !== 'canceled') await stripe.subscriptions.cancel(localSub.stripe_subscription_id);
    return { stripeManaged: true, canceledImmediately: true };
  }

  return { stripeManaged: true };
}

async function customerSubscriptionsWithScope(customerId) {
  const r = await pool.query(`SELECT s.*, c.stripe_account_id, c.stripe_customer_id
    FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.customer_id=$1 ORDER BY s.id ASC`, [customerId]);
  return r.rows;
}

app.patch('/api/customers/:id/status', async (req, res) => {
  try {
    const c = await customers.byId(req.params.id);
    if (!c) return res.status(404).json({ error:'Customer not found' });
    if (!ensureRowScope(req,res,c)) return;
    const target = normalizeSubStatus(req.body.status || '');
    if (!['active','paused','canceling','canceled'].includes(target)) return res.status(400).json({ error:'Invalid customer status' });

    const subs = await customerSubscriptionsWithScope(c.id);
    let changed = 0;

    if (target === 'paused') {
      const pauseable = new Set(['active','trialing','past_due']);
      for (const sub of subs.filter(s => pauseable.has(normalizeSubStatus(s.status)))) {
        await syncStripeSubscriptionState(sub, 'paused');
        await pool.query("UPDATE subscriptions SET status='paused', paused_by_customer=true, resume_date=NULL, updated_at=NOW() WHERE id=$1", [sub.id]);
        changed++;
      }
      const status = await reconcileCustomerLifecycle(c.id);
      await activityLog.add('subscription', `Paused customer ${c.email} and ${changed} subscription(s)`, c.id, null).catch(()=>{});
      return res.json({ success:true, status, subscriptions_changed:changed });
    }

    if (target === 'active') {
      const cancelingSubs = subs.filter(sub => normalizeSubStatus(sub.status) === 'canceling');
      if (cancelingSubs.length && normalizeSubStatus(c.status) === 'canceling') {
        for (const sub of cancelingSubs) {
          const result = await syncStripeSubscriptionState(sub, 'active');
          const restore = normalizeSubStatus(result.restoredStatus || sub.status_before_cancel || 'active');
          const restored = restore === 'paused' ? 'paused' : 'active';
          await pool.query("UPDATE subscriptions SET status=$1, status_before_cancel=NULL, ended_at=NULL, updated_at=NOW() WHERE id=$2", [restored, sub.id]);
          changed++;
        }
        const status = await reconcileCustomerLifecycle(c.id);
        await activityLog.add('resume', `Reactivated ${changed} scheduled cancellation(s) for ${c.email}`, c.id, null).catch(()=>{});
        return res.json({ success:true, status, subscriptions_changed:changed, action:'reactivated' });
      }

      // Resume customer only reverses subscriptions paused by the customer-level action.
      for (const sub of subs.filter(s => s.paused_by_customer && normalizeSubStatus(s.status) === 'paused')) {
        await syncStripeSubscriptionState(sub, 'active');
        await pool.query("UPDATE subscriptions SET status='active', paused_by_customer=false, resume_date=NULL, ended_at=NULL, updated_at=NOW() WHERE id=$1", [sub.id]);
        changed++;
      }
      const status = await reconcileCustomerLifecycle(c.id);
      await activityLog.add('resume', `Resumed customer ${c.email} and ${changed} customer-paused subscription(s)`, c.id, null).catch(()=>{});
      return res.json({ success:true, status, subscriptions_changed:changed, action:'resumed' });
    }

    if (target === 'canceling') {
      const cancellable = new Set(['active','trialing','past_due','unpaid','paused']);
      for (const sub of subs.filter(s => cancellable.has(normalizeSubStatus(s.status)))) {
        const previous = normalizeSubStatus(sub.status);
        await syncStripeSubscriptionState(sub, 'canceling');
        await pool.query("UPDATE subscriptions SET status_before_cancel=$1, status='canceling', updated_at=NOW() WHERE id=$2", [previous, sub.id]);
        changed++;
      }
      const status = await reconcileCustomerLifecycle(c.id);
      await activityLog.add('subscription', `Scheduled ${changed} subscription(s) to cancel at period end for ${c.email}`, c.id, null).catch(()=>{});
      return res.json({ success:true, status, subscriptions_changed:changed, action:'scheduled_cancel' });
    }

    // Explicit Cancel now: immediately and permanently cancel every current subscription.
    for (const sub of subs.filter(s => !['canceled','incomplete_expired'].includes(normalizeSubStatus(s.status)))) {
      await syncStripeSubscriptionState(sub, 'canceled');
      await pool.query("UPDATE subscriptions SET status='canceled', status_before_cancel=NULL, paused_by_customer=false, resume_date=NULL, ended_at=COALESCE(ended_at,NOW()), updated_at=NOW() WHERE id=$1", [sub.id]);
      changed++;
    }
    const status = await reconcileCustomerLifecycle(c.id);
    await activityLog.add('subscription', `Immediately canceled all subscriptions for ${c.email} (${changed})`, c.id, null).catch(()=>{});
    return res.json({ success:true, status, subscriptions_changed:changed, action:'canceled_now' });
  } catch(err) {
    console.error('[customer-status] sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/customers/:id/subscriptions/resume-paused', async (req, res) => {
  try {
    const c = await customers.byId(req.params.id);
    if (!c) return res.status(404).json({ error:'Customer not found' });
    if (!ensureRowScope(req,res,c)) return;

    const subs = await customerSubscriptionsWithScope(c.id);
    let changed = 0;
    for (const sub of subs.filter(s => String(s.status||'').toLowerCase() === 'paused')) {
      await syncStripeSubscriptionState(sub, 'active');
      await pool.query("UPDATE subscriptions SET status='active', paused_by_customer=false, resume_date=NULL, ended_at=NULL, updated_at=NOW() WHERE id=$1", [sub.id]);
      changed++;
    }
    const status = await reconcileCustomerLifecycle(c.id);
    await activityLog.add('resume', `Resumed ${changed} individually paused subscription(s) for ${c.email}`, c.id, null).catch(()=>{});
    return res.json({ success:true, status, subscriptions_changed:changed });
  } catch(err) {
    console.error('[customer-resume-paused] sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/customers/:id/note', async (req, res) => { try { const c=await customers.byId(req.params.id); if(!c) return res.status(404).json({ error:'Customer not found' }); if(!ensureRowScope(req,res,c)) return; await customers.updateNote(req.params.id, req.body.note); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });
app.post('/api/customers/:id/portal', async (req, res) => {
  try {
    const c = await customers.byId(req.params.id);
    if (!c) return res.status(404).json({ error: 'Customer not found' });
    if (!ensureRowScope(req, res, c)) return;
    if (!String(c.stripe_customer_id || '').startsWith('cus_')) return res.status(400).json({ error: 'Stripe Customer Portal is unavailable for imported/external customer records' });
    const acc = await stripeAccounts.byId(c.stripe_account_id);
    if (!acc?.secret_key) return res.status(400).json({ error: 'Stripe account secret key not found' });
    const stripe = require('stripe')(acc.secret_key);
    const session = await stripe.billingPortal.sessions.create({ customer: c.stripe_customer_id, return_url: SUBLOOP_APP_ORIGIN });
    res.json({ url: session.url });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/customers/:id/charge-once', async (req, res) => {
  try {
    const { amount, description, currency } = req.body;
    if (!Number.isInteger(Number(amount)) || Number(amount) <= 0) return res.status(400).json({ error: 'A positive amount is required' });
    if (!currency || !/^[a-zA-Z]{3}$/.test(String(currency))) return res.status(400).json({ error: 'Currency is required for a one-time charge' });
    const chargeCurrency = String(currency).toLowerCase();
    const identifier = String(req.params.id || '').trim();
    const c = identifier.startsWith('cus_') ? await customers.byStripeId(identifier) : await customers.byId(identifier);
    if (!c) return res.status(404).json({ error: 'Customer not found' });
    if (!ensureRowScope(req, res, c)) return;
    if (!String(c.stripe_customer_id || '').startsWith('cus_')) return res.status(400).json({ error: 'A real Stripe customer is required for a one-time charge' });
    const acc = await stripeAccounts.byId(c.stripe_account_id);
    if (!acc?.secret_key) return res.status(400).json({ error: 'Stripe account secret key not found' });
    const stripe = require('stripe')(acc.secret_key);
    const pm = await resolveBestPaymentMethod(stripe, c.stripe_customer_id, { localPaymentMethodId: c.stripe_payment_method });
    if (!pm) return res.status(400).json({ error: 'No usable saved card found for this customer' });
    await syncLocalPaymentMethod(c.id, pm);
    try {
      const pi = await stripe.paymentIntents.create({ amount: Number(amount), currency: chargeCurrency, customer: c.stripe_customer_id, payment_method: pm.id, confirm: true, description: description||'Manual invoice', off_session: true, metadata: { subloop_payment_origin: 'one_time' } });
      await savePaymentIntent(stripe, acc, pi, pi.status==='succeeded'?'succeeded':pi.status, { email:c.email, name:c.name }).catch(async () => {
        await payments.insert({ customer_id: c.id, subscription_id: null, stripe_payment_intent: pi.id, amount: Number(amount), currency: chargeCurrency, status: pi.status==='succeeded'?'succeeded':'failed', failure_reason: null, payment_origin: 'one_time' });
      });
      await reconcileCustomerLifecycle(c.id, pi.status==='succeeded'?{oneTimeSuccess:true}:{}).catch(()=>{});
      return res.json({ success: pi.status==='succeeded', status: pi.status });
    } catch(chargeErr) {
      const failedPi = chargeErr?.payment_intent || chargeErr?.raw?.payment_intent || null;
      if (failedPi?.id) {
        await savePaymentIntent(stripe, acc, failedPi, 'failed', { email:c.email, name:c.name }).catch(()=>{});
        await reconcileCustomerLifecycle(c.id).catch(()=>{});
        return res.status(402).json({ success:false, status:'failed', error:chargeErr.message });
      }
      throw chargeErr;
    }
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/customers/export', async (req, res) => {
  try {
    if (isReadOnlyUser(req.currentUser)) return res.status(403).json({ error: 'View-only access cannot export customer data' });
    const list = (await customers.all()).filter(c => rowWithinScope(req,c));
    const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const groupedPaid = (customer) => {
      let totals = customer.currency_totals || {};
      if (typeof totals === 'string') { try { totals = JSON.parse(totals); } catch (_e) { totals = {}; } }
      return Object.entries(totals || {})
        .filter(([, amount]) => Number(amount || 0) !== 0)
        .sort(([a],[b]) => a.localeCompare(b))
        .map(([currency, amount]) => `${String(currency).toUpperCase()} ${(Number(amount || 0)/100).toFixed(2)}`)
        .join(' | ');
    };
    const rows = list.map(c => [
      c.name, c.email, `${c.card_brand||''} ${c.card_last4||''}`.trim(), c.status,
      c.last_payment_at||'', c.created_at||'', groupedPaid(c)
    ].map(csvCell).join(','));
    const csv = ['Name,Email,Card,Status,Last Payment,Created,Total Paid by Currency'].concat(rows).join('\n');
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
    if (status !== undefined || amount !== undefined) return res.status(400).json({ error: 'Use the dedicated Stripe-synced status or amount action' });
    if (next_billing_date) await pool.query('UPDATE subscriptions SET next_billing_date=$1, updated_at=NOW() WHERE id=$2', [next_billing_date, req.params.id]);
    if (resume_date !== undefined) await subscriptions.setResumeDate(req.params.id, resume_date||null);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/subscriptions/:id/status', async (req, res) => {
  try {
    const sub = await scopedSubscription(req, res, req.params.id);
    if (!sub) return;
    const requested = normalizeSubStatus(req.body.status || '');
    const resume_date = req.body.resume_date || null;
    const current = normalizeSubStatus(sub.status);
    if (!['active','paused','canceling','canceled'].includes(requested)) return res.status(400).json({ error:'Invalid subscription status' });

    // Enforce lifecycle transitions on the API, not only in the UI. A terminal canceled
    // subscription cannot be revived on the same sub_xxx; create a new subscription instead.
    if (requested === 'active' && !['active','paused','canceling'].includes(current)) {
      return res.status(409).json({ error: current === 'canceled' ? 'Canceled subscriptions cannot be reactivated; create a new subscription' : `A ${current || 'non-live'} subscription cannot be resumed` });
    }
    if (requested === 'paused' && !['active','trialing','past_due'].includes(current)) {
      return res.status(409).json({ error:'Only an Active, Trialing, or Past due subscription can be paused' });
    }

    if (requested === 'canceling') {
      if (!['active','trialing','past_due','unpaid','paused'].includes(current)) return res.status(400).json({ error:'Only a live subscription can be scheduled for cancellation' });
      await syncStripeSubscriptionState(sub, 'canceling');
      await pool.query("UPDATE subscriptions SET status_before_cancel=$1, status='canceling', updated_at=NOW() WHERE id=$2", [current, sub.id]);
    } else if (requested === 'active' && normalizeSubStatus(sub.status) === 'canceling') {
      const result = await syncStripeSubscriptionState(sub, 'active');
      const restore = normalizeSubStatus(result.restoredStatus || sub.status_before_cancel || 'active');
      const restored = restore === 'paused' ? 'paused' : 'active';
      await pool.query("UPDATE subscriptions SET status=$1, status_before_cancel=NULL, ended_at=NULL, updated_at=NOW() WHERE id=$2", [restored, sub.id]);
    } else {
      await syncStripeSubscriptionState(sub, requested, { resumeDate: resume_date });
      await subscriptions.updateStatus(req.params.id, requested);
      if (requested === 'paused') {
        await subscriptions.setPausedByCustomer(req.params.id, false);
        await subscriptions.setResumeDate(req.params.id, resume_date || null);
      }
      if (requested === 'active' || requested === 'canceled') {
        await subscriptions.setPausedByCustomer(req.params.id, false);
        await subscriptions.setResumeDate(req.params.id, null);
        if (requested === 'canceled') await subscriptions.setStatusBeforeCancel(req.params.id, null);
      }
    }

    const finalSub = await pool.query('SELECT status FROM subscriptions WHERE id=$1', [sub.id]);
    const status = normalizeSubStatus(finalSub.rows[0]?.status || requested);
    const customerStatus = await reconcileCustomerLifecycle(sub.customer_id);
    res.json({ success: true, status, customer_status: customerStatus, stripe_synced: !!sub.stripe_subscription_id });
  } catch(err) {
    console.error('[subscription-status] sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});
app.patch('/api/subscriptions/:id/amount', async (req, res) => {
  try {
    const sub = await scopedSubscription(req, res, req.params.id);
    if (!sub) return;
    const amount = Number(req.body.amount);
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'A positive amount in the smallest currency unit is required' });
    if (normalizeSubStatus(sub.status) === 'canceled') return res.status(400).json({ error: 'A canceled subscription cannot be repriced' });

    if (!sub.stripe_subscription_id) {
      await subscriptions.updateAmount(sub.id, amount);
      return res.json({ success:true, stripe_synced:false, amount });
    }

    const account = await stripeAccounts.byId(sub.stripe_account_id);
    if (!account?.secret_key) return res.status(400).json({ error: 'Stripe account secret key not found' });
    const stripe = new Stripe(account.secret_key);
    const remote = await stripe.subscriptions.retrieve(sub.stripe_subscription_id, { expand:['items.data.price.product'] });
    if (remote.status === 'canceled') return res.status(400).json({ error: 'Stripe has already canceled this subscription' });
    const item = remote.items?.data?.[0];
    const oldPrice = item?.price;
    const productId = typeof oldPrice?.product === 'string' ? oldPrice.product : oldPrice?.product?.id;
    if (!item?.id || !productId || !oldPrice?.currency || !oldPrice?.recurring?.interval) {
      return res.status(400).json({ error: 'This Stripe subscription price cannot be safely replaced' });
    }
    const newPrice = await stripe.prices.create({
      unit_amount: amount,
      currency: oldPrice.currency,
      product: productId,
      recurring: { interval: oldPrice.recurring.interval, interval_count: oldPrice.recurring.interval_count || 1 },
      metadata: { subloop_replacement_for: oldPrice.id || '', subloop_subscription_id: String(sub.id) }
    });
    const prorationSetting = String(await settingsDb.get('proration_enabled') || 'false').toLowerCase();
    const proration_behavior = ['true','1','yes','on'].includes(prorationSetting) ? 'create_prorations' : 'none';
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id:item.id, price:newPrice.id }],
      proration_behavior
    });
    await pool.query('UPDATE subscriptions SET amount=$1, currency=$2, stripe_price_id=$3, updated_at=NOW() WHERE id=$4', [amount, oldPrice.currency, newPrice.id, sub.id]);
    await saveSubscriptionFromStripe(stripe, account, sub.stripe_subscription_id, 'subscription.amount.updated').catch(()=>{});
    res.json({ success:true, stripe_synced:true, amount, stripe_price_id:newPrice.id, proration_behavior });
  } catch(err) {
    console.error('[subscription-amount] sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/subscriptions/:id/charge', async (req, res) => {
  try {
    const sub = await scopedSubscription(req, res, req.params.id);
    if (!sub) return;
    if (normalizeSubStatus(sub.status) !== 'active') return res.status(409).json({ success:false, error:'Manual recurring charges are allowed only on an Active subscription' });
    const c = await customers.byId(sub.customer_id);
    if (!String(c?.stripe_customer_id || '').startsWith('cus_')) return res.status(400).json({ success:false, error:'A valid Stripe customer is required' });
    const acc = await stripeAccounts.byId(c.stripe_account_id);
    if (!acc?.secret_key) return res.status(400).json({ success:false, error:'Stripe account secret key not found' });
    const stripe = new Stripe(acc.secret_key);
    const pm = await resolveBestPaymentMethod(stripe, c.stripe_customer_id, {
      subscriptionId: sub.stripe_subscription_id || null,
      localPaymentMethodId: c.stripe_payment_method
    });
    if (!pm) return res.status(400).json({ success:false, error:'No reusable saved card attached to this Stripe customer' });
    await syncLocalPaymentMethod(c.id, pm);
    try {
      const pi = await stripe.paymentIntents.create({
        amount: sub.amount,
        currency: sub.currency,
        customer: c.stripe_customer_id,
        payment_method: pm.id,
        off_session: true,
        confirm: true,
        metadata: { subloop_payment_origin:'recurring_manual', subloop_subscription_id:String(sub.id) }
      });
      await savePaymentIntent(stripe, acc, pi, pi.status === 'succeeded' ? 'succeeded' : pi.status);
      await activityLog.add('charge', `Manual recurring charge of ${(sub.amount/100).toFixed(2)} ${String(sub.currency||'').toUpperCase()} for ${c.email}`, c.id, sub.amount);
      // Deliberately do NOT alter next_billing_date: Stripe Billing owns the renewal schedule.
      res.json({ success:pi.status==='succeeded', status:pi.status, paymentIntentId:pi.id, renewal_date_unchanged:true });
    } catch(chargeErr) {
      if (chargeErr?.payment_intent) await savePaymentIntent(stripe, acc, chargeErr.payment_intent, 'failed').catch(()=>{});
      return res.status(402).json({ success:false, error:chargeErr.message });
    }
  } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});
app.delete('/api/subscriptions/:id', async (req, res) => {
  try {
    const sub = await scopedSubscription(req,res,req.params.id);
    if (!sub) return;
    await syncStripeSubscriptionState(sub, 'canceled');
    await subscriptions.updateStatus(req.params.id, 'canceled');
    await subscriptions.setStatusBeforeCancel(req.params.id, null);
    await subscriptions.setPausedByCustomer(req.params.id, false);
    await subscriptions.setResumeDate(req.params.id, null);
    const customerStatus = await reconcileCustomerLifecycle(sub.customer_id);
    res.json({ success: true, status:'canceled', customer_status:customerStatus, stripe_synced: !!sub.stripe_subscription_id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

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
    const invoiceSubId = subscriptionIdFromInvoice(invoice);
    let resolvedOrigin = payment.payment_origin || null;
    let inferredLocalSubId = payment.subscription_id || null;
    if (!resolvedOrigin) {
      const explicitOrigin = String(pi?.metadata?.subloop_payment_origin || '').toLowerCase();
      if (explicitOrigin) {
        resolvedOrigin = paymentOriginFromStripeContext(pi, invoice, !!(invoiceSubId || payment.subscription_id));
      } else if (invoiceSubId || payment.subscription_id) {
        resolvedOrigin = paymentOriginFromStripeContext(pi, invoice, true);
      } else if (pi.description) {
        // Standalone charges created from Subloop's one-time invoice UI always have a description.
        resolvedOrigin = 'one_time';
      } else {
        // Legacy Subloop recurring charges (created before payment-origin metadata existed) had no invoice
        // and no description. If this customer has exactly one subscription, safely associate it.
        const candidates = await pool.query('SELECT id FROM subscriptions WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 2', [payment.customer_id]).catch(()=>({rows:[]}));
        if (candidates.rows.length === 1) {
          inferredLocalSubId = candidates.rows[0].id;
          resolvedOrigin = 'rebill';
        } else {
          resolvedOrigin = 'one_time';
        }
      }
    }
    await pool.query(`UPDATE payments SET
      stripe_fee=COALESCE($1,stripe_fee), net_amount=COALESCE($2,net_amount), balance_transaction_id=COALESCE($3,balance_transaction_id), financial_currency=COALESCE($4,financial_currency),
      stripe_invoice_id=COALESCE($5,stripe_invoice_id), card_brand=COALESCE($6,card_brand), card_last4=COALESCE($7,card_last4),
      card_exp_month=COALESCE($8,card_exp_month), card_exp_year=COALESCE($9,card_exp_year), card_country=COALESCE($10,card_country), card_funding=COALESCE($11,card_funding),
      payment_origin=COALESCE(payment_origin,$12), subscription_id=COALESCE(subscription_id,$13)
      WHERE id=$14`, [financials.stripe_fee, financials.net_amount, financials.balance_transaction_id, financials.financial_currency, invoiceId, cardDetails.brand, cardDetails.last4, cardDetails.exp_month, cardDetails.exp_year, cardDetails.country, cardDetails.funding, resolvedOrigin, inferredLocalSubId, payment.id]);
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
    const r = await pool.query(`SELECT p.*, c.stripe_customer_id, c.stripe_payment_method, c.stripe_account_id, c.email, c.name, s.stripe_subscription_id
      FROM payments p
      JOIN customers c ON c.id=p.customer_id
      LEFT JOIN subscriptions s ON s.id=p.subscription_id
      WHERE p.id=$1`, [req.params.id]);
    const p = r.rows[0];
    if (!p) return res.status(404).json({ error:'Not found' });
    if (!ensureRowScope(req,res,p)) return;
    if (normalizeSubStatus(p.status) !== 'failed') return res.status(400).json({ error:'Only failed payments can be retried' });
    const acc = await stripeAccounts.byId(p.stripe_account_id);
    if (!acc?.secret_key) return res.status(400).json({ error:'Stripe account secret key not found' });
    const stripe = new Stripe(acc.secret_key);
    const pm = await resolveBestPaymentMethod(stripe, p.stripe_customer_id, {
      subscriptionId:p.stripe_subscription_id || null,
      localPaymentMethodId:p.stripe_payment_method
    });
    if (!pm) return res.status(400).json({ error:'No reusable saved card attached to this Stripe customer' });
    await syncLocalPaymentMethod(p.customer_id, pm);

    let invoiceId = p.stripe_invoice_id || null;
    if (!invoiceId && p.stripe_payment_intent) {
      const originalPi = await stripe.paymentIntents.retrieve(p.stripe_payment_intent, { expand:['invoice'] }).catch(()=>null);
      invoiceId = typeof originalPi?.invoice === 'string' ? originalPi.invoice : originalPi?.invoice?.id || null;
    }

    // Stripe subscription failures must retry/pay the actual invoice. Creating a separate
    // PaymentIntent would leave Stripe Billing's invoice unpaid and the subscription past due.
    if (invoiceId && (p.subscription_id || p.stripe_subscription_id)) {
      const invoice = await stripe.invoices.retrieve(invoiceId, { expand:['subscription','payment_intent'] });
      if (invoice.status === 'paid') return res.status(409).json({ error:'This Stripe invoice is already paid' });
      const originalPiId = p.stripe_payment_intent || (typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id || null);

      // Preserve the original failed attempt as Failed. The successful invoice retry gets its own
      // payment row even when Stripe reuses the same PaymentIntent identifier.
      if (originalPiId && p.stripe_payment_intent === originalPiId) {
        await pool.query('UPDATE payments SET stripe_payment_intent=NULL WHERE id=$1', [p.id]);
      }
      try {
        const paidInvoice = await stripe.invoices.pay(invoiceId, { payment_method:pm.id });
        const retryPiId = typeof paidInvoice.payment_intent === 'string' ? paidInvoice.payment_intent : paidInvoice.payment_intent?.id || originalPiId;
        let newPaymentId = null;
        if (retryPiId) {
          const retryPi = await stripe.paymentIntents.retrieve(retryPiId, { expand:['invoice','latest_charge','payment_method'] });
          newPaymentId = await savePaymentIntent(stripe, acc, retryPi, paidInvoice.status === 'paid' ? 'succeeded' : (retryPi.status || 'failed'));
        } else {
          await handleInvoiceEvent(stripe, acc, paidInvoice, paidInvoice.status === 'paid' ? 'succeeded' : 'failed');
          const pr = await pool.query('SELECT id FROM payments WHERE stripe_invoice_id=$1 ORDER BY created_at DESC LIMIT 1', [invoiceId]);
          newPaymentId = pr.rows[0]?.id || null;
        }
        if (newPaymentId && Number(newPaymentId) !== Number(p.id)) await pool.query('UPDATE payments SET retry_of_payment_id=$1 WHERE id=$2', [p.id, newPaymentId]);
        await reconcileCustomerLifecycle(p.customer_id).catch(()=>{});
        await activityLog.add('retry', `Retried Stripe invoice for ${p.name}: ${paidInvoice.status}`, p.customer_id, p.amount);
        return res.json({ success:paidInvoice.status==='paid', status:paidInvoice.status, invoice_id:invoiceId, retry_of_payment_id:p.id, payment_id:newPaymentId });
      } catch(invoiceErr) {
        if (originalPiId) await pool.query('UPDATE payments SET stripe_payment_intent=$1 WHERE id=$2 AND stripe_payment_intent IS NULL', [originalPiId,p.id]).catch(()=>{});
        throw invoiceErr;
      }
    }

    // Standalone one-time/manual-recurring retry: no Stripe Billing invoice exists to pay.
    const retryOrigin = p.subscription_id ? 'recurring_manual' : 'one_time';
    const retryMetadata = { subloop_payment_origin:retryOrigin };
    if (p.subscription_id) retryMetadata.subloop_subscription_id = String(p.subscription_id);
    try {
      const pi = await stripe.paymentIntents.create({ amount:p.amount, currency:p.currency||'usd', customer:p.stripe_customer_id, payment_method:pm.id, confirm:true, off_session:true, metadata:retryMetadata });
      const status = pi.status==='succeeded' ? 'succeeded' : pi.status;
      const paymentId = await savePaymentIntent(stripe, acc, pi, status);
      if (paymentId) await pool.query('UPDATE payments SET retry_of_payment_id=$1 WHERE id=$2', [p.id,paymentId]);
      await activityLog.add('retry', `Retried payment for ${p.name}: ${status}`, p.customer_id, p.amount);
      return res.json({ success:status==='succeeded', status, retry_of_payment_id:p.id, payment_id:paymentId });
    } catch(retryErr) {
      if (retryErr?.payment_intent) {
        const paymentId = await savePaymentIntent(stripe, acc, retryErr.payment_intent, 'failed').catch(()=>null);
        if (paymentId) await pool.query('UPDATE payments SET retry_of_payment_id=$1 WHERE id=$2', [p.id,paymentId]).catch(()=>{});
      }
      return res.status(402).json({ success:false, error:retryErr.message });
    }
  } catch(err) {
    console.error('[payment-retry] failed:', err.message);
    res.status(500).json({ error:err.message });
  }
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
    const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = list.map(p => [p.name||'', p.email||'', ((p.amount||0)/100).toFixed(2), String(p.currency||'usd').toUpperCase(), p.status, p.created_at].map(csvCell).join(','));
    const csv = ['Customer,Email,Amount,Currency,Status,Date'].concat(rows).join('\n');
    res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=payments.csv'); res.send(csv);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Embedded Checkout Token ──────────────────────────────────────────────────
app.post('/api/embedded-checkout-token', async (req, res) => {
  try {
    const { stripe_account_id, price_id } = req.body || {};
    const acc = stripe_account_id ? await stripeAccounts.byId(stripe_account_id) : await stripeAccounts.default();
    if (!acc) return res.status(400).json({ error: 'No Stripe account found' });
    if (!ensureRowScope(req, res, { stripe_account_id: acc.id })) return;
    if (!price_id || !String(price_id).startsWith('price_')) return res.status(400).json({ error: 'A recurring Stripe price_id is required' });
    const stripe = embeddedStripeClient(acc);
    const price = await stripe.prices.retrieve(price_id);
    if (!price.active || !price.recurring || typeof price.unit_amount !== 'number') return res.status(400).json({ error: 'Price must be an active fixed recurring Price' });
    const embed_token = await signCheckoutPlan({ account_id: Number(acc.id), price_id: price.id });
    res.json({ success: true, embed_token, embed_ready: !!acc.publishable_key && keysMatchMode(acc) });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    const intervalMap = {
      7: { interval: 'week', interval_count: 1 },
      14: { interval: 'week', interval_count: 2 },
      30: { interval: 'month', interval_count: 1 },
      90: { interval: 'month', interval_count: 3 },
      365: { interval: 'year', interval_count: 1 }
    };
    const recurring = intervalMap[Number(interval_days)] || intervalMap[30];
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: amount,
      currency: currency||'usd',
      recurring,
      metadata: { source: 'subloop', interval_days: String(interval_days || 30) }
    });
    console.log('[payment-link] created recurring price:', price.id, 'interval:', recurring.interval, 'count:', recurring.interval_count, 'amount:', amount, 'account:', acc.name);
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: { metadata: { source: 'subloop', interval_days: String(interval_days || 30) } },
      metadata: { source: 'subloop', type: 'subscription_link' }
    });
    console.log('[payment-link] created subscription payment link:', link.id, link.url);
    const embed_token = await signCheckoutPlan({ account_id: Number(acc.id), price_id: price.id });
    res.json({
      success: true,
      url: link.url,
      price_id: price.id,
      payment_link_id: link.id,
      embed_token,
      embed_ready: !!acc.publishable_key && keysMatchMode(acc)
    });
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

// ── Legacy recurring engine disabled ───────────────────────────────────────────
// Stripe Billing is the only automatic renewal engine. Keeping this endpoint non-operational
// prevents a second PaymentIntent from being created for an invoice Stripe is already retrying.
app.post('/api/run-rebills', async (_req, res) => {
  res.status(410).json({ error:'Automatic recurring charges are owned by Stripe Billing. The legacy Subloop recurring runner is disabled.' });
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
    if (!state.enabled) {
      const accessToken = issueAdminToken(user, 'access', SUBLOOP_SESSION_MINUTES);
      setAdminSessionCookie(req, res, accessToken);
      return res.json({ valid: true, ...authTokenForJson(req, accessToken), ...accessResponse(user) });
    }
    if (!speakeasy) return res.status(503).json({ valid: false, error: 'Authenticator verification is unavailable' });
    if (!state.two_fa_secret) return res.status(503).json({ valid: false, error: 'Authenticator configuration is missing' });
    const valid = speakeasy.totp.verify({ secret: state.two_fa_secret, encoding: 'base32', token: req.body.token, window: 2 });
    if (!valid) return res.json({ valid: false });
    const accessToken = issueAdminToken(user, 'access', SUBLOOP_SESSION_MINUTES);
    setAdminSessionCookie(req, res, accessToken);
    res.json({ valid: true, ...authTokenForJson(req, accessToken), ...accessResponse(user) });
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


// ── SaaS Licenses / Workspaces (Super Admin only) ────────────────────────────
function requireSuperAdmin(req, res) {
  if (!isSuperAdmin(req.currentUser)) { res.status(403).json({ error: 'Subloop Super Admin access required' }); return false; }
  return true;
}
function normalizeLicensePlan(value) {
  const v = String(value || '').toLowerCase().trim().replace(/[-\s]/g, '_');
  if (['3_month','3_months','quarterly'].includes(v)) return '3_months';
  if (['12_month','12_months','year','yearly','annual'].includes(v)) return '12_months';
  if (['lifetime','life'].includes(v)) return 'lifetime';
  return null;
}
function addCalendarMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
function licenseExpiryForPlan(plan, start = new Date()) {
  if (plan === 'lifetime') return null;
  return addCalendarMonths(start, plan === '3_months' ? 3 : 12);
}
function slugBaseForWorkspace(name, email) {
  const base = String(name || email || 'workspace').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40) || 'workspace';
  return base;
}
async function uniqueWorkspaceSlug(name, email) {
  const base = slugBaseForWorkspace(name, email);
  for (let i=0;i<20;i++) {
    const suffix = i === 0 ? '' : '-' + crypto.randomBytes(2).toString('hex');
    const slug = (base + suffix).slice(0,48);
    const exists = await pool.query('SELECT 1 FROM workspaces WHERE slug=$1 LIMIT 1',[slug]);
    if (!exists.rows[0]) return slug;
  }
  return base.slice(0,35) + '-' + crypto.randomBytes(6).toString('hex');
}
async function expireLicenses() {
  await pool.query(`UPDATE licenses SET status='expired', updated_at=NOW()
    WHERE status='active' AND expires_at IS NOT NULL AND expires_at <= NOW()`);
  await pool.query(`UPDATE workspaces w SET status='expired', updated_at=NOW()
    FROM licenses l WHERE l.workspace_id=w.id AND l.status='expired' AND w.is_main=false AND w.status<>'expired'`);
}
app.get('/api/licenses', async (req,res) => {
  try {
    if (!requireSuperAdmin(req,res)) return;
    await expireLicenses();
    const r = await pool.query(`SELECT l.*, w.name AS workspace_name, w.slug AS workspace_slug, w.status AS workspace_status,
      (SELECT COUNT(*)::int FROM stripe_accounts sa WHERE sa.workspace_id=w.id) AS stripe_accounts,
      (SELECT COUNT(*)::int FROM admin_users au WHERE au.workspace_id=w.id) AS users
      FROM licenses l JOIN workspaces w ON w.id=l.workspace_id
      ORDER BY CASE WHEN l.status='active' THEN 0 WHEN l.status='suspended' THEN 1 ELSE 2 END,
        COALESCE(l.expires_at,'9999-12-31'::timestamptz) ASC, l.created_at DESC`);
    res.json(r.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/licenses', async (req,res) => {
  const client = await pool.connect();
  try {
    if (!requireSuperAdmin(req,res)) return;
    const customerName = String(req.body.customer_name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const plan = normalizeLicensePlan(req.body.plan);
    const notes = String(req.body.notes || '').trim().slice(0,2000);
    if (!customerName) return res.status(400).json({ error:'Customer name is required' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error:'Enter a valid email address' });
    if (!plan) return res.status(400).json({ error:'Select 3 months, 12 months, or lifetime' });
    const slug = await uniqueWorkspaceSlug(customerName,email);
    const startsAt = new Date();
    const expiresAt = licenseExpiryForPlan(plan,startsAt);
    await client.query('BEGIN');
    const w = await client.query(`INSERT INTO workspaces (name,slug,is_main,status) VALUES ($1,$2,false,'licensed') RETURNING id,name,slug`,[customerName,slug]);
    const l = await client.query(`INSERT INTO licenses (workspace_id,customer_name,email,plan,starts_at,expires_at,status,notes)
      VALUES ($1,$2,$3,$4,$5,$6,'active',$7) RETURNING *`,[w.rows[0].id,customerName,email,plan,startsAt,expiresAt,notes||null]);
    await client.query('COMMIT');
    res.json({ success:true, license:l.rows[0], workspace:w.rows[0] });
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ error:err.message });
  } finally { client.release(); }
});
app.post('/api/licenses/:id/extend', async (req,res) => {
  try {
    if (!requireSuperAdmin(req,res)) return;
    const months = Number(req.body.months);
    if (![3,12].includes(months)) return res.status(400).json({ error:'Extension must be 3 or 12 months' });
    const current = (await pool.query('SELECT * FROM licenses WHERE id=$1',[req.params.id])).rows[0];
    if (!current) return res.status(404).json({ error:'License not found' });
    const base = current.expires_at && new Date(current.expires_at) > new Date() ? new Date(current.expires_at) : new Date();
    const expires = addCalendarMonths(base,months);
    await pool.query(`UPDATE licenses SET plan=$1, expires_at=$2, status='active', updated_at=NOW() WHERE id=$3`,[months===3?'3_months':'12_months',expires,current.id]);
    await pool.query(`UPDATE workspaces SET status='licensed',updated_at=NOW() WHERE id=$1`,[current.workspace_id]);
    res.json({ success:true, expires_at:expires });
  } catch(err) { res.status(500).json({ error:err.message }); }
});
app.post('/api/licenses/:id/lifetime', async (req,res) => {
  try {
    if (!requireSuperAdmin(req,res)) return;
    const r=await pool.query(`UPDATE licenses SET plan='lifetime', expires_at=NULL, status='active', updated_at=NOW() WHERE id=$1 RETURNING workspace_id`,[req.params.id]);
    if(!r.rows[0]) return res.status(404).json({error:'License not found'});
    await pool.query(`UPDATE workspaces SET status='licensed',updated_at=NOW() WHERE id=$1`,[r.rows[0].workspace_id]);
    res.json({success:true});
  } catch(err){res.status(500).json({error:err.message});}
});
app.post('/api/licenses/:id/suspend', async (req,res) => {
  try {
    if (!requireSuperAdmin(req,res)) return;
    const r=await pool.query(`UPDATE licenses SET status='suspended',updated_at=NOW() WHERE id=$1 RETURNING workspace_id`,[req.params.id]);
    if(!r.rows[0]) return res.status(404).json({error:'License not found'});
    await pool.query(`UPDATE workspaces SET status='suspended',updated_at=NOW() WHERE id=$1`,[r.rows[0].workspace_id]);
    res.json({success:true});
  } catch(err){res.status(500).json({error:err.message});}
});
app.post('/api/licenses/:id/reactivate', async (req,res) => {
  try {
    if (!requireSuperAdmin(req,res)) return;
    const current=(await pool.query('SELECT * FROM licenses WHERE id=$1',[req.params.id])).rows[0];
    if(!current) return res.status(404).json({error:'License not found'});
    if(current.expires_at && new Date(current.expires_at)<=new Date()) return res.status(400).json({error:'This license is expired. Extend it or make it lifetime first.'});
    await pool.query(`UPDATE licenses SET status='active',updated_at=NOW() WHERE id=$1`,[current.id]);
    await pool.query(`UPDATE workspaces SET status='licensed',updated_at=NOW() WHERE id=$1`,[current.workspace_id]);
    res.json({success:true});
  } catch(err){res.status(500).json({error:err.message});}
});
app.delete('/api/licenses/:id', async (req,res) => {
  const client=await pool.connect();
  try {
    if (!requireSuperAdmin(req,res)) return;
    const current=(await client.query(`SELECT l.*,w.is_main FROM licenses l JOIN workspaces w ON w.id=l.workspace_id WHERE l.id=$1`,[req.params.id])).rows[0];
    if(!current) return res.status(404).json({error:'License not found'});
    if(current.is_main) return res.status(400).json({error:'Main workspace cannot be deleted'});
    const deps=await client.query(`SELECT
      (SELECT COUNT(*) FROM stripe_accounts WHERE workspace_id=$1)::int AS accounts,
      (SELECT COUNT(*) FROM admin_users WHERE workspace_id=$1)::int AS users`,[current.workspace_id]);
    if(Number(deps.rows[0].accounts)>0 || Number(deps.rows[0].users)>0) return res.status(409).json({error:'This workspace already has users or Stripe accounts. Suspend it instead of deleting it.'});
    await client.query('BEGIN');
    await client.query('DELETE FROM licenses WHERE id=$1',[current.id]);
    await client.query('DELETE FROM workspaces WHERE id=$1',[current.workspace_id]);
    await client.query('COMMIT');
    res.json({success:true});
  } catch(err){await client.query('ROLLBACK').catch(()=>{});res.status(500).json({error:err.message});}
  finally{client.release();}
});

// ── Auth ──────────────────────────────────────────────────────────────────────
function requestClientIp(req) {
  const forwarded = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.socket.remoteAddress || 'unknown');
}
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = requestClientIp(req);

    // No failed-login lockout: always verify the supplied credentials immediately.
    const user = await adminUsers.verify(username, password);
    if (user) {
      await adminUsers.updateLastLogin(user.id);
      await security.logAttempt(ip, true, user.id, user.username);
      const twoFaState = await adminUsers.twoFAState(user.id);
      if (twoFaState.enabled) return res.json({ success: true, requires_2fa: true, login_challenge: issueAdminToken(user, '2fa', 5), ...accessResponse(user) });
      const accessToken = issueAdminToken(user, 'access', SUBLOOP_SESSION_MINUTES);
      setAdminSessionCookie(req, res, accessToken);
      return res.json({ success: true, ...authTokenForJson(req, accessToken), ...accessResponse(user) });
    }

    const attemptedUser = username ? await adminUsers.byUsername(username) : null;
    await security.logAttempt(ip, false, attemptedUser ? attemptedUser.id : null, username || null);
    res.json({ success: false });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/auth/check', async (req, res) => {
  try {
    const token = parseAdminToken(requestAccessToken(req), 'access');
    if (!token) return res.json({ valid: false });
    const user = await adminUsers.byId(token.id);
    if (!user) return res.json({ valid: false });
    res.json({ valid: true, ...accessResponse(user) });
  } catch(err) { res.json({ valid: false }); }
});
app.post('/api/auth/logout', (req, res) => {
  clearAdminSessionCookie(req, res);
  res.json({ success: true });
});

// Manual repair path for missed Stripe webhooks. This is intentionally Owner/Admin only.
app.post('/api/reconcile-stripe', async (req, res) => {
  try {
    if (!requireOwnerOrAdmin(req,res)) return;
    const ids = scopedAccountIds(req);
    const accountRows = await pool.query('SELECT * FROM stripe_accounts WHERE ($1::int[] IS NULL OR id=ANY($1::int[])) ORDER BY id', [ids]);
    let subscriptionsSeen = 0;
    let errors = 0;
    const error_samples = [];
    for (const account of accountRows.rows) {
      if (!account.secret_key) continue;
      const stripe = new Stripe(account.secret_key);
      let starting_after;
      do {
        const page = await stripe.subscriptions.list({ status:'all', limit:100, ...(starting_after ? { starting_after } : {}) });
        for (const remote of page.data || []) {
          try {
            await saveSubscriptionFromStripe(stripe, account, remote, 'manual.reconcile');
            subscriptionsSeen++;
          } catch(err) {
            errors++;
            if (error_samples.length < 10) error_samples.push({ subscription_id:remote.id, error:err.message });
          }
        }
        starting_after = page.has_more && page.data?.length ? page.data[page.data.length-1].id : null;
      } while (starting_after);
    }
    res.json({ success:errors===0, accounts_checked:accountRows.rows.length, subscriptions_reconciled:subscriptionsSeen, errors, error_samples });
  } catch(err) {
    console.error('[reconcile-stripe] failed:', err.message);
    res.status(500).json({ error:err.message });
  }
});

// ── Stats & Dashboard ─────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const ids = scopedAccountIds(req);
    // Keep customer, subscription and payment aggregates independent. Joining all three tables
    // multiplies rows (N subscriptions x M payments) and inflates MRR/revenue/counts.
    const [customerAgg, subscriptionAgg, paymentAgg, churnAgg, ltvAgg] = await Promise.all([
      pool.query(`WITH pay_stats AS (
          SELECT customer_id,
            COALESCE(SUM(CASE WHEN LOWER(status)='succeeded' THEN amount ELSE 0 END),0)::bigint AS total_paid
          FROM payments
          GROUP BY customer_id
        ), eligible AS (
          SELECT c.*
          FROM customers c
          LEFT JOIN pay_stats p ON p.customer_id=c.id
          WHERE ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))
            AND LOWER(COALESCE(c.status,'')) <> 'pending'
            AND NOT (
              COALESCE(p.total_paid,0)=0
              AND (
                COALESCE(c.email,'') ILIKE '%@stripe.local'
                OR COALESCE(c.stripe_customer_id,'') LIKE 'external_%'
                OR COALESCE(c.name,'') LIKE 'pi_%'
              )
            )
        )
        SELECT
          COUNT(*)::int AS total_customers,
          -- Count only locally-known reusable Stripe payment methods. Card details from a
          -- one-off/failed PaymentIntent are not enough to call a card "saved for reuse".
          COUNT(*) FILTER (
            WHERE COALESCE(stripe_customer_id,'') LIKE 'cus_%'
              AND COALESCE(stripe_payment_method,'') LIKE 'pm_%'
          )::int AS saved_cards,
          COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month',NOW()))::int AS new_customers_30d
        FROM eligible`, [ids]),
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE LOWER(COALESCE(s.status,''))='active')::int AS active_subscriptions,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(s.status,''))='active' THEN
          ROUND((CASE
            WHEN s.interval_days BETWEEN 360 AND 370 THEN s.amount::numeric/12
            WHEN s.interval_days BETWEEN 89 AND 93 THEN s.amount::numeric/3
            WHEN s.interval_days BETWEEN 28 AND 31 THEN s.amount::numeric
            WHEN s.interval_days BETWEEN 13 AND 15 THEN s.amount::numeric*26/12
            WHEN s.interval_days BETWEEN 6 AND 8 THEN s.amount::numeric*52/12
            ELSE s.amount::numeric*30.4375/NULLIF(s.interval_days,0)
          END) * ${usdRateSql('s')}) ELSE 0 END),0)::bigint AS mrr
        FROM subscriptions s
        JOIN customers c ON c.id=s.customer_id
        WHERE ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))`, [ids]),
      pool.query(`SELECT
        COUNT(*) FILTER (
          WHERE (LOWER(p.status)='failed' OR COALESCE(p.was_failed,false)=true)
            AND p.created_at >= NOW()-INTERVAL '30 days'
        )::int AS failed_payments,
        COUNT(*) FILTER (WHERE LOWER(p.status)='succeeded' AND p.created_at >= NOW()-INTERVAL '30 days')::int AS succeeded_30d,
        COALESCE(SUM(CASE WHEN LOWER(p.status)='succeeded' AND p.created_at >= DATE_TRUNC('month',NOW()) THEN ${usdAmountSql('p')} ELSE 0 END),0)::bigint AS revenue_month,
        COALESCE(SUM(CASE WHEN LOWER(p.status)='succeeded' THEN ${usdAmountSql('p')} ELSE 0 END),0)::bigint AS total_revenue
        FROM payments p JOIN customers c ON c.id=p.customer_id
        WHERE ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))`, [ids]),
      pool.query(`SELECT
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(s.status,'')) IN ('canceled','cancelled')
            AND COALESCE(s.ended_at,s.updated_at,s.created_at) >= NOW()-INTERVAL '30 days'
        )::int AS churned_30d,
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(s.status,'')) IN ('active','paused','canceling','trialing','past_due','unpaid')
        )::int AS live_subscriptions
        FROM subscriptions s JOIN customers c ON c.id=s.customer_id
        WHERE ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))`, [ids]),
      pool.query(`WITH pay_stats AS (
          SELECT p.customer_id,
            COALESCE(SUM(CASE WHEN LOWER(p.status)='succeeded' THEN p.amount ELSE 0 END),0)::bigint AS total_paid_original,
            COALESCE(SUM(CASE WHEN LOWER(p.status)='succeeded' THEN ${usdAmountSql('p')} ELSE 0 END),0)::bigint AS total_paid_usd
          FROM payments p
          GROUP BY p.customer_id
        ), eligible AS (
          SELECT c.id, COALESCE(p.total_paid_usd,0)::bigint AS total_paid_usd
          FROM customers c
          LEFT JOIN pay_stats p ON p.customer_id=c.id
          WHERE ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))
            AND LOWER(COALESCE(c.status,'')) <> 'pending'
            AND NOT (
              COALESCE(p.total_paid_original,0)=0
              AND (
                COALESCE(c.email,'') ILIKE '%@stripe.local'
                OR COALESCE(c.stripe_customer_id,'') LIKE 'external_%'
                OR COALESCE(c.name,'') LIKE 'pi_%'
              )
            )
        )
        SELECT COUNT(*)::int AS customers, COALESCE(SUM(total_paid_usd),0)::bigint AS total_paid
        FROM eligible`, [ids])
    ]);
    const c = customerAgg.rows[0] || {};
    const sub = subscriptionAgg.rows[0] || {};
    const pay = paymentAgg.rows[0] || {};
    const churn = churnAgg.rows[0] || {};
    const ltv = ltvAgg.rows[0] || {};
    const attempts = Number(pay.succeeded_30d||0) + Number(pay.failed_payments||0);
    // 30-day churn is terminal cancellations in the window divided by the
    // subscriptions still live plus those that churned in that same window. Old
    // historical cancellations do not dilute today's churn rate.
    const churned30d = Number(churn.churned_30d||0);
    const churnPopulation = Number(churn.live_subscriptions||0) + churned30d;
    const churnRate = churnPopulation > 0 ? ((churned30d/churnPopulation)*100).toFixed(1) : '0.0';
    const avgLtv = Number(ltv.customers||0) > 0 ? Math.round(Number(ltv.total_paid||0)/Number(ltv.customers)) : 0;
    res.json({
      ...c, ...sub, ...pay,
      payment_success_rate: attempts > 0 ? Math.round((Number(pay.succeeded_30d||0)/attempts)*100) : null,
      churn_rate: churnRate,
      avg_ltv: avgLtv,
      revenue_30d: pay.revenue_month,
      analytics_currency:'usd',
      analytics_estimated:true
    });
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
    const r = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN LOWER(p.status)='succeeded' AND p.created_at >= CURRENT_DATE THEN ${usdAmountSql('p')} ELSE 0 END),0)::bigint AS revenue_today,
        COUNT(*) FILTER (WHERE LOWER(p.status)='succeeded' AND p.created_at >= CURRENT_DATE)::int AS payments_today,
        COUNT(*) FILTER (
          WHERE (LOWER(p.status)='failed' OR COALESCE(p.was_failed,false)=true)
            AND p.created_at >= CURRENT_DATE
        )::int AS failed_today,
        COALESCE(SUM(CASE WHEN LOWER(p.status)='succeeded' AND p.created_at >= DATE_TRUNC('week', CURRENT_DATE) THEN ${usdAmountSql('p')} ELSE 0 END),0)::bigint AS revenue_7d,
        COUNT(*) FILTER (WHERE LOWER(p.status)='succeeded' AND p.created_at >= DATE_TRUNC('week', CURRENT_DATE))::int AS payments_7d,
        COALESCE(SUM(CASE WHEN LOWER(p.status)='succeeded' AND p.created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN ${usdAmountSql('p')} ELSE 0 END),0)::bigint AS revenue_month,
        COUNT(*) FILTER (WHERE LOWER(p.status)='succeeded' AND p.created_at >= DATE_TRUNC('month', CURRENT_DATE))::int AS payments_month
      FROM payments p
      JOIN customers c ON c.id=p.customer_id
      WHERE ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))
    `, [ids]);
    const c = await pool.query(`
      WITH pay_stats AS (
        SELECT customer_id,
          COALESCE(SUM(CASE WHEN LOWER(status)='succeeded' THEN amount ELSE 0 END),0)::bigint AS total_paid
        FROM payments
        GROUP BY customer_id
      ), eligible AS (
        SELECT c.*
        FROM customers c
        LEFT JOIN pay_stats p ON p.customer_id=c.id
        WHERE ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))
          AND LOWER(COALESCE(c.status,'')) <> 'pending'
          AND NOT (
            COALESCE(p.total_paid,0)=0
            AND (
              COALESCE(c.email,'') ILIKE '%@stripe.local'
              OR COALESCE(c.stripe_customer_id,'') LIKE 'external_%'
              OR COALESCE(c.name,'') LIKE 'pi_%'
            )
          )
      )
      SELECT
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status,''))='active')::int AS active_total,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS new_today,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('week', CURRENT_DATE))::int AS new_7d
      FROM eligible
    `, [ids]);
    res.json({ ...r.rows[0], ...c.rows[0] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/forecast', async (req, res) => {
  try {
    const allSubs = (await subscriptions.all()).filter(sub => rowWithinScope(req, sub));
    const activeSubs = allSubs.filter(s => s.status === 'active');
    const now = new Date();
    let forecast30=0, forecast60=0, forecast90=0;
    const occurrencesWithin = (nextDate, intervalDays, horizonDays) => {
      const interval = Number(intervalDays || 0);
      if (!Number.isFinite(interval) || interval <= 0 || !nextDate || Number.isNaN(nextDate.getTime())) return 0;
      const dayMs = 1000*60*60*24;
      const intervalMs = interval * dayMs;
      let nextMs = nextDate.getTime();
      const nowMs = now.getTime();

      // A stale local next_billing_date must not make an already-missed charge count as
      // upcoming (or create an extra occurrence). Roll it to the first future cycle.
      if (nextMs < nowMs) {
        const missedCycles = Math.ceil((nowMs - nextMs) / intervalMs);
        nextMs += missedCycles * intervalMs;
      }

      const horizonMs = nowMs + (horizonDays * dayMs);
      if (nextMs > horizonMs) return 0;
      return 1 + Math.floor((horizonMs - nextMs) / intervalMs);
    };
    activeSubs.forEach(s => {
      const next = s.next_billing_date ? new Date(s.next_billing_date) : null;
      const usdAmount = toUsdCents(s.amount, s.currency);
      forecast30 += usdAmount * occurrencesWithin(next, s.interval_days, 30);
      forecast60 += usdAmount * occurrencesWithin(next, s.interval_days, 60);
      forecast90 += usdAmount * occurrencesWithin(next, s.interval_days, 90);
    });
    res.json({ forecast30, forecast60, forecast90 });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/churn-alerts', async (req, res) => {
  try {
    const ids = scopedAccountIds(req);
    const cancelled = await pool.query(`SELECT c.id,c.name,c.email,COALESCE(s.ended_at,s.updated_at,s.created_at) as churned_at FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE LOWER(COALESCE(s.status,'')) IN ('canceled','cancelled') AND COALESCE(s.ended_at,s.updated_at,s.created_at) >= NOW()-INTERVAL '7 days' AND ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[])) ORDER BY COALESCE(s.ended_at,s.updated_at,s.created_at) DESC LIMIT 20`, [ids]);
    const failing = await pool.query(`
      SELECT c.id,c.name,c.email,s.id AS subscription_id,LOWER(COALESCE(s.status,'')) AS subscription_status,
        COUNT(p.id) FILTER (WHERE LOWER(COALESCE(p.status,''))='failed' AND p.created_at >= NOW()-INTERVAL '30 days')::int AS failure_count
      FROM subscriptions s
      JOIN customers c ON c.id=s.customer_id
      LEFT JOIN payments p ON p.subscription_id=s.id
      WHERE LOWER(COALESCE(s.status,'')) IN ('past_due','unpaid')
        AND ($1::int[] IS NULL OR c.stripe_account_id=ANY($1::int[]))
      GROUP BY c.id,c.name,c.email,s.id,s.status
      ORDER BY CASE WHEN LOWER(COALESCE(s.status,''))='unpaid' THEN 0 ELSE 1 END, failure_count DESC, s.id DESC
      LIMIT 20`, [ids]);
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
        SELECT DISTINCT f.id AS recovery_id
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
        SELECT DISTINCT f.id AS recovery_id
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
        SELECT DISTINCT f.id AS recovery_id
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
    const rate = tf > 0 ? Math.round((recovered / tf) * 100) : null;
    res.json({ total_failed: tf, recovered, rate });
  } catch(err) { res.status(500).json({ error: err.message }); }
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
app.get('*', async (req, res) => {
  try {
    const host = requestHostname(req);
    const parsed = parseAdminToken(cookieToken(req), 'access');
    let validCookieSession = false;
    if (parsed) validCookieSession = !!(await adminUsers.byId(parsed.id));

    if (host === SUBLOOP_LOGIN_HOST && validCookieSession) {
      return res.redirect(302, SUBLOOP_APP_ORIGIN + '/');
    }
    if (host === SUBLOOP_APP_HOST && !validCookieSession) {
      return res.redirect(302, SUBLOOP_LOGIN_ORIGIN + '/');
    }
    return res.sendFile(path.join(__dirname, 'index.html'));
  } catch (_err) {
    return res.sendFile(path.join(__dirname, 'index.html'));
  }
});

const PORT = process.env.PORT || 8080;
// Database migrations, including admin access columns, finish once before accepting requests.
// API permission checks then use fast SELECT queries only; they never run ALTER TABLE during page loads.
init().then(async () => {
  // One startup pass repairs legacy/stale customer rows (for example an Active
  // customer whose final subscription had already been canceled in an older build).
  await reconcileExistingCustomerLifecycles().catch(err => console.log('[customer-reconcile] startup pass failed:', err.message));
  initScheduler({ reconcileCustomerLifecycle });
  app.listen(PORT, () => console.log(`Subloop running on port ${PORT}`));
}).catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
