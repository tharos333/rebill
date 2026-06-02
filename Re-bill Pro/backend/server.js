const express = require('express');
const app = express();
const path = require('path');
const { init, pool, settingsDb, stripeAccounts, customers, subscriptions, payments, activityLog, webhookLogs, security, adminUsers } = require('./db');
let speakeasy, QRCode;
try { speakeasy = require('speakeasy'); QRCode = require('qrcode'); } catch(e) {}

const Stripe = require('stripe');
const crypto = require('crypto');

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

    res.json(accounts);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stripe-accounts/:id/verification-debug', async (req, res) => {
  try {
    const account = await stripeAccounts.byId(req.params.id);
    if (!account) return res.status(404).json({ error: 'Stripe account not found' });
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
app.delete('/api/stripe-accounts/:id', async (req, res) => { try { await stripeAccounts.delete(req.params.id); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });

// ── Customers ─────────────────────────────────────────────────────────────────
app.get('/api/customers', async (req, res) => { try { res.json(await customers.all()); } catch(err) { res.status(500).json({ error: err.message }); } });
app.get('/api/customers/:id/details', async (req, res) => {
  try {
    const data = await customers.detail(req.params.id);
    if (!data.customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/customers', async (req, res) => {
  try {
    const { name, email, stripe_customer_id, stripe_payment_method, card_brand, card_last4, card_exp_month, card_exp_year, stripe_account_id, note } = req.body;
    if (!email || !stripe_customer_id) return res.status(400).json({ error: 'Email and Stripe ID required' });
    await customers.upsert({ name, email, stripe_customer_id, stripe_payment_method, stripe_account_id, card_brand, card_last4, card_exp_month, card_exp_year });
    const c = await customers.byStripeId(stripe_customer_id);
    if (note) await customers.updateNote(c.id, note);
    res.json({ success: true, id: c.id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/customers/:id/status', async (req, res) => { try { await customers.updateStatus(req.params.id, req.body.status); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });
app.patch('/api/customers/:id/note', async (req, res) => { try { await customers.updateNote(req.params.id, req.body.note); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });
app.post('/api/customers/:id/portal', async (req, res) => {
  try {
    const c = await customers.byId(req.params.id);
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
    const acc = await stripeAccounts.byId(c.stripe_account_id);
    const stripe = require('stripe')(acc.secret_key);
    const pi = await stripe.paymentIntents.create({ amount, currency: currency||'usd', customer: c.stripe_customer_id, payment_method: c.stripe_payment_method, confirm: true, description: description||'Manual invoice', off_session: true });
    await payments.insert({ customer_id: c.id, subscription_id: null, stripe_payment_intent: pi.id, amount, currency: currency||'usd', status: pi.status==='succeeded'?'succeeded':'failed', failure_reason: null });
    res.json({ success: pi.status==='succeeded', status: pi.status });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/customers/export', async (req, res) => {
  try {
    const list = await customers.all();
    const csv = ['Name,Email,Card,Status,Last Payment,Created,Total Paid'].concat(list.map(c=>`${c.name},${c.email},${c.card_brand||''} ${c.card_last4||''},${c.status},${c.last_payment_at||''},${c.created_at||''},${(c.total_paid||0)/100}`)).join('\n');
    res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=customers.csv'); res.send(csv);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Subscriptions ─────────────────────────────────────────────────────────────
app.get('/api/subscriptions', async (req, res) => { try { res.json(await subscriptions.all()); } catch(err) { res.status(500).json({ error: err.message }); } });
app.post('/api/subscriptions', async (req, res) => { try { await subscriptions.create(req.body); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });
app.patch('/api/subscriptions/:id', async (req, res) => {
  try {
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
    const { status, resume_date } = req.body;
    await subscriptions.updateStatus(req.params.id, status);
    if (status === 'paused' && resume_date) await subscriptions.setResumeDate(req.params.id, resume_date);
    if (status === 'active') await subscriptions.setResumeDate(req.params.id, null);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/subscriptions/:id/amount', async (req, res) => {
  try {
    await subscriptions.updateAmount(req.params.id, parseInt(req.body.amount));
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/subscriptions/:id/charge', async (req, res) => {
  try {
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
app.delete('/api/subscriptions/:id', async (req, res) => { try { await subscriptions.updateStatus(req.params.id, 'cancelled'); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });

// ── Payments ──────────────────────────────────────────────────────────────────
app.get('/api/payments', async (req, res) => { try { res.json(await payments.recent(1000)); } catch(err) { res.status(500).json({ error: err.message }); } });
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
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS note TEXT');
    await pool.query('UPDATE payments SET note=$1 WHERE id=$2', [req.body.note, req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/payments/export', async (req, res) => {
  try {
    const list = await payments.recent(10000);
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
app.post('/api/plan-templates', async (req, res) => { try { const { name, amount, currency, interval_days } = req.body; await pool.query('INSERT INTO plan_templates (name,amount,currency,interval_days) VALUES ($1,$2,$3,$4)', [name, amount, currency||'usd', interval_days||30]); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });
app.delete('/api/plan-templates/:id', async (req, res) => { try { await pool.query('DELETE FROM plan_templates WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); } });

// ── Run Rebills ───────────────────────────────────────────────────────────────
app.post('/api/run-rebills', async (req, res) => {
  try {
    const due = await subscriptions.due();
    let charged = 0, failed = 0;
    for (const sub of due) {
      try {
        const c = await customers.byId(sub.customer_id);
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
    res.json({ success: true, charged, failed, total: due.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Activity ──────────────────────────────────────────────────────────────────
app.get('/api/activity', async (req, res) => {
  try {
    const username = req.headers['x-username'];
    let list = await activityLog.recent(100);
    if (username) {
      try {
        const userRow = await pool.query('SELECT role FROM admin_users WHERE username=$1', [username]);
        if (userRow.rows[0] && userRow.rows[0].role === 'viewer') {
          list = list.filter(a => ['payment','failed','retry','charge','dunning','proration','resume'].includes(a.type));
        }
      } catch(e) {}
    }
    res.json(list);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Settings ──────────────────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => { try { res.json(await settingsDb.getAll()); } catch(err) { res.status(500).json({ error: err.message }); } });
app.post('/api/settings', async (req, res) => {
  try { await settingsDb.set(req.body.key, req.body.value); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/settings', async (req, res) => {
  try { await settingsDb.set(req.body.key, req.body.value); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Webhook Logs ──────────────────────────────────────────────────────────────
app.get('/api/webhook-logs', async (req, res) => { try { res.json(await webhookLogs.recent(50)); } catch(err) { res.status(500).json({ error: err.message }); } });

// ── Security ──────────────────────────────────────────────────────────────────
app.get('/api/security/login-history', async (req, res) => { try { res.json(await security.recentLogins(20)); } catch(err) { res.status(500).json({ error: err.message }); } });
app.get('/api/security/2fa/status', async (req, res) => {
  try {
    const enabled = await settingsDb.get('two_fa_enabled');
    res.json({ enabled: enabled === 'true' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/security/2fa/setup', async (req, res) => {
  try {
    if (!speakeasy) return res.status(400).json({ error: 'speakeasy not installed' });
    const secret = speakeasy.generateSecret({ name: 'Subloop' });
    await settingsDb.set('two_fa_secret_pending', secret.base32);
    const qr = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrCode: qr });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/security/2fa/verify', async (req, res) => {
  try {
    if (!speakeasy) return res.status(503).json({ valid: false, success: false, error: 'Authenticator verification is unavailable' });
    const secret = await settingsDb.get('two_fa_secret_pending');
    if (!secret) return res.status(400).json({ error: 'No pending 2FA setup' });
    const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token: req.body.token, window: 2 });
    if (!valid) return res.json({ success: false, error: 'Invalid code' });
    await settingsDb.set('two_fa_secret', secret);
    await settingsDb.set('two_fa_enabled', 'true');
    await settingsDb.set('two_fa_secret_pending', '');
    res.json({ success: true, valid: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/security/2fa/validate', async (req, res) => {
  try {
    const enabled = await settingsDb.get('two_fa_enabled');
    if (enabled !== 'true') return res.json({ valid: true });
    if (!speakeasy) return res.status(503).json({ valid: false, error: 'Authenticator verification is unavailable' });
    const secret = await settingsDb.get('two_fa_secret');
    if (!secret) return res.status(503).json({ valid: false, error: 'Authenticator configuration is missing' });
    const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token: req.body.token, window: 2 });
    res.json({ valid });
  } catch(err) { res.status(500).json({ valid: false, error: 'Could not verify authenticator code' }); }
});
app.post('/api/security/2fa/disable', async (req, res) => {
  try { await settingsDb.set('two_fa_enabled', 'false'); await settingsDb.set('two_fa_secret', ''); res.json({ success: true }); } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Admin Users ───────────────────────────────────────────────────────────────
app.get('/api/admin-users', async (req, res) => { try { res.json(await adminUsers.all()); } catch(err) { res.status(500).json({ error: err.message }); } });
app.post('/api/admin-users', async (req, res) => {
  try {
    const { username, password, role, permissions } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    await adminUsers.create(username, password, role || 'admin', permissions || []);
    await activityLog.add('security', `New admin user created: ${username}`);
    res.json({ success: true });
  } catch(err) {
    if (err.message.includes('unique')) return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});
app.delete('/api/admin-users/:id', async (req, res) => {
  try {
    const all = await adminUsers.all();
    if (all.length <= 1) return res.status(400).json({ error: 'Cannot delete the last admin user' });
    await adminUsers.delete(req.params.id);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/admin-users/:id/permissions', async (req, res) => {
  try {
    const { role, permissions } = req.body;
    const current = await pool.query('SELECT role FROM admin_users WHERE id=$1', [req.params.id]);
    if (current.rows[0]?.role === 'owner') return res.status(400).json({ error: 'Cannot change owner role' });
    if (role) await pool.query('UPDATE admin_users SET role=$1 WHERE id=$2', [role, req.params.id]);
    await adminUsers.updatePermissions(req.params.id, permissions || []);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/admin-users/:id/change-password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    await adminUsers.changePassword(req.params.id, password);
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
      await security.logAttempt(ip, true);
      return res.json({ success: true, role: user.role, username: user.username, permissions: user.permissions || [] });
    }

    await security.logAttempt(ip, false);
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
    const { username } = req.body;
    if (!username) return res.json({ valid: false });
    const r = await pool.query('SELECT id, username, role, permissions FROM admin_users WHERE username=$1', [username]);
    if (!r.rows[0]) return res.json({ valid: false });
    res.json({ valid: true, role: r.rows[0].role, permissions: r.rows[0].permissions || [] });
  } catch(err) { res.json({ valid: true, role: 'owner', permissions: [] }); }
});

// ── Stats & Dashboard ─────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
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
    `);
    const row = r.rows[0];
    const sc = await pool.query("SELECT COUNT(*) as n FROM payments WHERE status='succeeded' AND created_at >= NOW()-INTERVAL '30 days'");
    const fc = await pool.query("SELECT COUNT(*) as n FROM payments WHERE status='failed' AND created_at >= NOW()-INTERVAL '30 days'");
    const total = parseInt(sc.rows[0].n)+parseInt(fc.rows[0].n);
    const custStats = await pool.query("SELECT COUNT(*) as total, COUNT(CASE WHEN status='cancelled' AND created_at >= NOW()-INTERVAL '30 days' THEN 1 END) as churned_30d FROM customers");
    const cs = custStats.rows[0];
    const churnRate = parseInt(cs.total)>0?((parseInt(cs.churned_30d)||0)/parseInt(cs.total)*100).toFixed(1):0;
    const avgLtv = parseInt(cs.total)>0?Math.round(parseInt(row.total_revenue)/parseInt(cs.total)):0;
    res.json({
      ...row,
      payment_success_rate: total>0?Math.round((parseInt(sc.rows[0].n)/total)*100):100,
      churn_rate: churnRate,
      avg_ltv: avgLtv,
      revenue_30d: row.revenue_month
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/revenue-chart', async (req, res) => {
  try {
    const allTime = String(req.query.period || '').toLowerCase() === 'all';
    const dateFilter = allTime ? '' : " WHERE created_at >= NOW() - INTERVAL '60 days'";
    const r = await pool.query(`SELECT DATE(created_at) as day, SUM(CASE WHEN status='succeeded' THEN ${usdAmountSql()} ELSE 0 END) as revenue, COUNT(CASE WHEN status='succeeded' THEN 1 END) as count FROM payments${dateFilter} GROUP BY DATE(created_at) ORDER BY day ASC`);
    res.json(r.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/daily-summary', async (req, res) => {
  try {
    const r = await pool.query(`SELECT COALESCE(SUM(CASE WHEN status='succeeded' AND created_at >= CURRENT_DATE THEN ${usdAmountSql()} ELSE 0 END),0) as revenue_today, COALESCE(COUNT(CASE WHEN status='succeeded' AND created_at >= CURRENT_DATE THEN 1 END),0) as payments_today, COALESCE(COUNT(CASE WHEN status='failed' AND created_at >= CURRENT_DATE THEN 1 END),0) as failed_today, COALESCE(SUM(CASE WHEN status='succeeded' AND created_at >= CURRENT_DATE - INTERVAL '7 days' THEN ${usdAmountSql()} ELSE 0 END),0) as revenue_7d, COALESCE(COUNT(CASE WHEN status='succeeded' AND created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END),0) as payments_7d, COALESCE(SUM(CASE WHEN status='succeeded' AND created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN ${usdAmountSql()} ELSE 0 END),0) as revenue_month, COALESCE(COUNT(CASE WHEN status='succeeded' AND created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 END),0) as payments_month FROM payments`);
    const c = await pool.query(`SELECT COUNT(*) as active_total, COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as new_today, COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as new_7d FROM customers WHERE status='active'`);
    res.json({ ...r.rows[0], ...c.rows[0] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/forecast', async (req, res) => {
  try {
    const allSubs = await subscriptions.all();
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
    const cancelled = await pool.query(`SELECT c.id,c.name,c.email,s.updated_at as churned_at FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.status='cancelled' AND s.updated_at >= NOW()-INTERVAL '7 days' ORDER BY s.updated_at DESC LIMIT 20`);
    const failing = await pool.query(`SELECT c.id,c.name,c.email,s.dunning_count FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.dunning_count >= 3 AND s.status != 'cancelled' ORDER BY s.dunning_count DESC LIMIT 20`);
    res.json({ cancelled: cancelled.rows, failing: failing.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/mrr-history', async (req, res) => {
  try {
    const r = await pool.query(`SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YY') as month, DATE_TRUNC('month', created_at) as month_date, SUM(CASE WHEN status='succeeded' THEN ${usdAmountSql()} ELSE 0 END) as revenue FROM payments WHERE created_at >= NOW() - INTERVAL '12 months' GROUP BY DATE_TRUNC('month', created_at) ORDER BY month_date ASC`);
    res.json(r.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/recovery-rate', async (req, res) => {
  try {
    await ensureWebhookColumns();
    const r = await pool.query(`
      WITH failed AS (
        SELECT p.*
        FROM payments p
        WHERE (p.status='failed' OR COALESCE(p.was_failed,false)=true)
          AND p.created_at >= NOW()-INTERVAL '30 days'
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
    `);
    const row = r.rows[0] || {};
    const tf = parseInt(row.total_failed) || 0;
    const recovered = parseInt(row.recovered) || 0;
    const rate = tf > 0 ? Math.round((recovered / tf) * 100) : 0;
    res.json({ total_failed: tf, recovered, rate });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/search', async (req, res) => {
  try {
    const q = '%'+(req.query.q||'').trim()+'%';
    if (!req.query.q || req.query.q.trim().length < 2) return res.json({ customers:[], payments:[], subscriptions:[] });
    const [cust, pmts, subs] = await Promise.all([
      pool.query(`SELECT id,name,email,card_brand,card_last4,status FROM customers WHERE name ILIKE $1 OR email ILIKE $1 LIMIT 5`, [q]),
      pool.query(`SELECT p.id,c.name,c.email,p.amount,p.currency,p.status,p.created_at FROM payments p JOIN customers c ON c.id=p.customer_id WHERE c.name ILIKE $1 OR c.email ILIKE $1 ORDER BY p.created_at DESC LIMIT 5`, [q]),
      pool.query(`SELECT s.id,c.name,c.email,s.amount,s.currency,s.status FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE c.name ILIKE $1 OR c.email ILIKE $1 LIMIT 5`, [q]),
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
init().then(() => {
  app.listen(PORT, () => console.log(`Subloop running on port ${PORT}`));
}).catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
