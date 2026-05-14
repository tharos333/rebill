const express = require('express');
const app = express();
const path = require('path');
const { init, pool, settingsDb, stripeAccounts, customers, subscriptions, payments, activityLog, webhookLogs, security, adminUsers } = require('./db');
let speakeasy, QRCode;
try { speakeasy = require('speakeasy'); QRCode = require('qrcode'); } catch(e) {}


const Stripe = require('stripe');

function centsToMoney(amount, currency = 'usd') {
  return `${((amount || 0) / 100).toFixed(2)} ${String(currency || 'usd').toUpperCase()}`;
}

function getSafeCustomerEmail(customer, fallbackId) {
  if (customer && !customer.deleted && customer.email) return customer.email;
  return `${fallbackId || 'unknown-customer'}@stripe.local`;
}

function getSafeCustomerName(customer, email, fallbackId) {
  if (customer && !customer.deleted && customer.name) return customer.name;
  return email || fallbackId || 'Stripe Customer';
}

async function findStripeAccountForWebhook(rawBody, signature) {
  const accountsResult = await pool.query(
    'SELECT * FROM stripe_accounts WHERE COALESCE(webhook_secret, $1) <> $1 ORDER BY is_default DESC, created_at ASC',
    ['']
  );

  let lastError = null;
  for (const account of accountsResult.rows) {
    try {
      const stripe = new Stripe(account.secret_key);
      const event = stripe.webhooks.constructEvent(rawBody, signature, account.webhook_secret.trim());
      return { event, account, stripe };
    } catch (err) {
      lastError = err;
    }
  }

  return { event: null, account: null, stripe: null, lastError };
}

async function getPaymentMethodDetails(stripe, paymentIntent) {
  let paymentMethodId = typeof paymentIntent.payment_method === 'string' ? paymentIntent.payment_method : paymentIntent.payment_method?.id;

  if (!paymentMethodId && paymentIntent.latest_charge) {
    try {
      const chargeId = typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.latest_charge.id;
      const charge = await stripe.charges.retrieve(chargeId);
      paymentMethodId = typeof charge.payment_method === 'string' ? charge.payment_method : null;
    } catch (err) {
      console.warn('[webhook] could not retrieve latest_charge payment method:', err.message);
    }
  }

  if (paymentMethodId) {
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      return {
        id: pm.id,
        brand: pm.card?.brand || null,
        last4: pm.card?.last4 || null,
        exp_month: pm.card?.exp_month || null,
        exp_year: pm.card?.exp_year || null,
      };
    } catch (err) {
      console.warn('[webhook] could not retrieve payment method:', err.message);
      return { id: paymentMethodId, brand: null, last4: null, exp_month: null, exp_year: null };
    }
  }

  if (paymentIntent.customer) {
    try {
      const pms = await stripe.paymentMethods.list({ customer: paymentIntent.customer, type: 'card', limit: 1 });
      const pm = pms.data[0];
      if (pm) {
        return {
          id: pm.id,
          brand: pm.card?.brand || null,
          last4: pm.card?.last4 || null,
          exp_month: pm.card?.exp_month || null,
          exp_year: pm.card?.exp_year || null,
        };
      }
    } catch (err) {
      console.warn('[webhook] could not list customer payment methods:', err.message);
    }
  }

  return { id: null, brand: null, last4: null, exp_month: null, exp_year: null };
}

async function upsertStripeCustomerFromPaymentIntent(stripe, account, paymentIntent) {
  const stripeCustomerId = typeof paymentIntent.customer === 'string' ? paymentIntent.customer : paymentIntent.customer?.id;
  if (!stripeCustomerId) return null;

  let customer = null;
  try {
    customer = await stripe.customers.retrieve(stripeCustomerId);
  } catch (err) {
    console.warn('[webhook] could not retrieve customer from Stripe:', err.message);
  }

  const email = getSafeCustomerEmail(customer, stripeCustomerId);
  const name = getSafeCustomerName(customer, email, stripeCustomerId);
  const pm = await getPaymentMethodDetails(stripe, paymentIntent);

  const result = await pool.query(
    `INSERT INTO customers
      (email, name, stripe_customer_id, stripe_payment_method, stripe_account_id, card_brand, card_last4, card_exp_month, card_exp_year, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')
     ON CONFLICT (stripe_customer_id) DO UPDATE SET
       email = COALESCE(NULLIF(EXCLUDED.email, ''), customers.email),
       name = COALESCE(NULLIF(EXCLUDED.name, ''), customers.name),
       stripe_payment_method = COALESCE(EXCLUDED.stripe_payment_method, customers.stripe_payment_method),
       stripe_account_id = COALESCE(EXCLUDED.stripe_account_id, customers.stripe_account_id),
       card_brand = COALESCE(EXCLUDED.card_brand, customers.card_brand),
       card_last4 = COALESCE(EXCLUDED.card_last4, customers.card_last4),
       card_exp_month = COALESCE(EXCLUDED.card_exp_month, customers.card_exp_month),
       card_exp_year = COALESCE(EXCLUDED.card_exp_year, customers.card_exp_year),
       status = 'active'
     RETURNING id, email, name`,
    [email, name, stripeCustomerId, pm.id, account.id, pm.brand, pm.last4, pm.exp_month, pm.exp_year]
  );

  return result.rows[0];
}

async function savePaymentIntent(stripe, account, paymentIntent, statusOverride = null, failureReasonOverride = null) {
  if (!paymentIntent || !paymentIntent.id) return { saved: false, reason: 'missing_payment_intent' };

  const stripeCustomerId = typeof paymentIntent.customer === 'string' ? paymentIntent.customer : paymentIntent.customer?.id;
  if (!stripeCustomerId) return { saved: false, reason: 'payment_intent_has_no_customer' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Prevent two Stripe events, for example checkout.session.completed and payment_intent.succeeded,
    // from inserting the same PaymentIntent at the same time.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [paymentIntent.id]);

    const duplicate = await client.query('SELECT id FROM payments WHERE stripe_payment_intent=$1 LIMIT 1', [paymentIntent.id]);
    if (duplicate.rows[0]) {
      await client.query('COMMIT');
      return { saved: false, reason: 'duplicate', payment_id: duplicate.rows[0].id };
    }

    // Use the normal pool for Stripe API/customer helper work before final insert.
    // It is okay because the advisory lock stays open in this transaction.
    const dbCustomer = await upsertStripeCustomerFromPaymentIntent(stripe, account, paymentIntent);
    if (!dbCustomer) {
      await client.query('ROLLBACK');
      return { saved: false, reason: 'customer_not_saved' };
    }

    const status = statusOverride || (paymentIntent.status === 'succeeded' ? 'succeeded' : paymentIntent.status || 'unknown');
    const failureReason = failureReasonOverride || paymentIntent.last_payment_error?.message || null;

    const inserted = await client.query(
      `INSERT INTO payments (customer_id, subscription_id, stripe_payment_intent, amount, currency, status, failure_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [dbCustomer.id, null, paymentIntent.id, paymentIntent.amount || paymentIntent.amount_received || 0, paymentIntent.currency || 'usd', status, failureReason]
    );

    await client.query('COMMIT');
    await activityLog.add(
      status === 'succeeded' ? 'payment' : 'failed',
      `${status === 'succeeded' ? 'Payment received' : 'Payment failed'}: ${centsToMoney(paymentIntent.amount || paymentIntent.amount_received || 0, paymentIntent.currency)} from ${dbCustomer.email}`,
      dbCustomer.id,
      paymentIntent.amount || paymentIntent.amount_received || 0
    );

    return { saved: true, payment_id: inserted.rows[0].id, customer_email: dbCustomer.email };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];

  try {
    const { event, account, stripe, lastError } = await findStripeAccountForWebhook(req.body, signature);

    if (!event) {
      console.error('[webhook] signature verification failed:', lastError?.message || 'No matching webhook_secret');
      await webhookLogs.add({
        event_type: 'signature_verification_failed',
        account_name: null,
        status: 'error',
        error: lastError?.message || 'No matching webhook_secret',
      });
      // Return 400 so Stripe retries instead of silently losing real events.
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }

    console.log(`[webhook] received ${event.type} for account ${account.name}`);
    await webhookLogs.add({ event_type: event.type, account_name: account.name, status: 'ok' });

    if (event.type === 'payment_intent.succeeded') {
      const result = await savePaymentIntent(stripe, account, event.data.object, 'succeeded');
      console.log('[webhook] payment_intent.succeeded result:', result);
    }

    else if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object;
      const result = await savePaymentIntent(stripe, account, pi, 'failed', pi.last_payment_error?.message || 'Payment failed');
      console.log('[webhook] payment_intent.payment_failed result:', result);
    }

    else if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      // Checkout can arrive before payment_intent.succeeded. Save it here too, but the
      // advisory lock + duplicate check makes the later PaymentIntent event a no-op.
      if (session.payment_intent) {
        const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
        const result = await savePaymentIntent(stripe, account, pi, pi.status === 'succeeded' ? 'succeeded' : pi.status);
        console.log('[webhook] checkout.session.completed payment result:', result);
      } else if (session.customer) {
        // Subscription-mode Payment Links often do not have session.payment_intent.
        // Still save/update the customer so the customer appears in the app.
        const customer = await stripe.customers.retrieve(session.customer);
        const fakePaymentIntentForCustomer = {
          id: null,
          customer: session.customer,
          payment_method: session.payment_method || null,
          latest_charge: null,
          amount: session.amount_total || 0,
          currency: session.currency || 'usd',
          status: session.payment_status === 'paid' ? 'succeeded' : session.payment_status,
        };
        await upsertStripeCustomerFromPaymentIntent(stripe, account, fakePaymentIntentForCustomer);
        console.log('[webhook] checkout.session.completed saved customer only:', customer.email || session.customer);
      } else {
        console.log('[webhook] checkout.session.completed has no customer/payment_intent, skipped');
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('[webhook] handler error:', err.message, err.stack);
    await webhookLogs.add({
      event_type: 'handler_error',
      account_name: null,
      status: 'error',
      error: err.message,
    });
    // Return 500 so Stripe retries. Do not return 200 when the database save failed.
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Stripe Accounts ───────────────────────────────────────────────────────────
app.get('/api/stripe-accounts', async (req, res) => { try { res.json(await stripeAccounts.all()); } catch(err) { res.status(500).json({ error: err.message }); } });
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
    const csv = ['Name,Email,Card,Status,Total Paid'].concat(list.map(c=>`${c.name},${c.email},${c.card_brand||''} ${c.card_last4||''},${c.status},${(c.total_paid||0)/100}`)).join('\n');
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
app.get('/api/payments', async (req, res) => { try { res.json(await payments.recent(200)); } catch(err) { res.status(500).json({ error: err.message }); } });
app.post('/api/payments/:id/retry', async (req, res) => {
  try {
    const r = await pool.query('SELECT p.*, c.stripe_customer_id, c.stripe_payment_method, c.stripe_account_id, c.email, c.name FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.id=$1', [req.params.id]);
    const p = r.rows[0]; if (!p) return res.status(404).json({ error: 'Not found' });
    const acc = await stripeAccounts.byId(p.stripe_account_id);
    const stripe = require('stripe')(acc.secret_key);
    const pi = await stripe.paymentIntents.create({ amount: p.amount, currency: p.currency||'usd', customer: p.stripe_customer_id, payment_method: p.stripe_payment_method, confirm: true, off_session: true });
    const status = pi.status==='succeeded'?'succeeded':'failed';
    await payments.insert({ customer_id: p.customer_id, subscription_id: p.subscription_id, stripe_payment_intent: pi.id, amount: p.amount, currency: p.currency, status, failure_reason: null });
    await activityLog.add('retry', `Retried payment for ${p.name}: ${status}`, p.customer_id, p.amount);
    res.json({ success: status==='succeeded', status });
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
    const product = await stripe.products.create({ name: name||'Subscription' });
    const intervalMap = { 7: 'week', 14: 'week', 30: 'month', 90: 'month', 365: 'year' };
    const price = await stripe.prices.create({ product: product.id, unit_amount: amount, currency: currency||'usd', recurring: { interval: intervalMap[interval_days]||'month' } });
    const link = await stripe.paymentLinks.create({ line_items: [{ price: price.id, quantity: 1 }], subscription_data: { metadata: { source: 'subloop' } } });
    res.json({ success: true, url: link.url });
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
    if (!speakeasy) return res.json({ valid: true, success: true });
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
    if (!speakeasy) return res.json({ valid: true });
    const enabled = await settingsDb.get('two_fa_enabled');
    if (enabled !== 'true') return res.json({ valid: true });
    const secret = await settingsDb.get('two_fa_secret');
    if (!secret) return res.json({ valid: true });
    const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token: req.body.token, window: 2 });
    res.json({ valid });
  } catch(err) { res.json({ valid: false }); }
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
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const user = await adminUsers.verify(username, password);
    if (user) {
      await adminUsers.updateLastLogin(user.id);
      await security.logAttempt(ip, true);
      res.json({ success: true, role: user.role, username: user.username, permissions: user.permissions || [] });
    } else {
      await security.logAttempt(ip, false);
      res.json({ success: false });
    }
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
        COALESCE(SUM(CASE WHEN s.status='active' THEN s.amount ELSE 0 END),0) as mrr,
        COUNT(DISTINCT CASE WHEN s.status='active' THEN s.id END) as active_subscriptions,
        COUNT(DISTINCT c.id) as total_customers,
        COUNT(DISTINCT CASE WHEN c.card_last4 IS NOT NULL THEN c.id END) as saved_cards,
        COUNT(CASE WHEN p.status='failed' AND p.created_at >= NOW()-INTERVAL '30 days' THEN 1 END) as failed_payments,
        COALESCE(SUM(CASE WHEN p.status='succeeded' AND p.created_at >= DATE_TRUNC('month',NOW()) THEN p.amount ELSE 0 END),0) as revenue_month,
        COALESCE(SUM(CASE WHEN p.status='succeeded' THEN p.amount ELSE 0 END),0) as total_revenue,
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
    const r = await pool.query(`SELECT DATE(created_at) as day, SUM(CASE WHEN status='succeeded' THEN amount ELSE 0 END) as revenue, COUNT(CASE WHEN status='succeeded' THEN 1 END) as count FROM payments WHERE created_at >= NOW() - INTERVAL '60 days' GROUP BY DATE(created_at) ORDER BY day ASC`);
    res.json(r.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/daily-summary', async (req, res) => {
  try {
    const r = await pool.query(`SELECT COALESCE(SUM(CASE WHEN status='succeeded' AND created_at >= CURRENT_DATE THEN amount ELSE 0 END),0) as revenue_today, COALESCE(COUNT(CASE WHEN status='succeeded' AND created_at >= CURRENT_DATE THEN 1 END),0) as payments_today, COALESCE(COUNT(CASE WHEN status='failed' AND created_at >= CURRENT_DATE THEN 1 END),0) as failed_today, COALESCE(SUM(CASE WHEN status='succeeded' AND created_at >= CURRENT_DATE - INTERVAL '7 days' THEN amount ELSE 0 END),0) as revenue_7d, COALESCE(COUNT(CASE WHEN status='succeeded' AND created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END),0) as payments_7d, COALESCE(SUM(CASE WHEN status='succeeded' AND created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN amount ELSE 0 END),0) as revenue_month, COALESCE(COUNT(CASE WHEN status='succeeded' AND created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 END),0) as payments_month FROM payments`);
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
      forecast30 += s.amount * (Math.floor(30/s.interval_days) + (diff<=30?1:0));
      forecast60 += s.amount * (Math.floor(60/s.interval_days) + (diff<=60?1:0));
      forecast90 += s.amount * (Math.floor(90/s.interval_days) + (diff<=90?1:0));
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
    const r = await pool.query(`SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YY') as month, DATE_TRUNC('month', created_at) as month_date, SUM(CASE WHEN status='succeeded' THEN amount ELSE 0 END) as revenue FROM payments WHERE created_at >= NOW() - INTERVAL '12 months' GROUP BY DATE_TRUNC('month', created_at) ORDER BY month_date ASC`);
    res.json(r.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/recovery-rate', async (req, res) => {
  try {
    const r = await pool.query(`SELECT COUNT(CASE WHEN status='failed' THEN 1 END) as total_failed, COUNT(CASE WHEN status='succeeded' THEN 1 END) as total_succeeded FROM payments WHERE created_at >= NOW()-INTERVAL '30 days'`);
    const row = r.rows[0];
    const tf=parseInt(row.total_failed)||0, ts=parseInt(row.total_succeeded)||0;
    res.json({ total_failed: tf, recovered: 0, rate: (tf+ts)>0?Math.round((ts/(tf+ts))*100):0, total_succeeded: ts });
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
