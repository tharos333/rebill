require('dotenv').config();

const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const path = require('path');
const { init, pool, stripeAccounts, customers, subscriptions, payments } = require('./db');
const { initScheduler } = require('./scheduler');

const app = express();

app.use(cors());
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

async function getStripe(accountId) {
  let account;
  if (accountId) account = await stripeAccounts.byId(accountId);
  if (!account) account = await stripeAccounts.default();
  if (!account) return new Stripe(process.env.STRIPE_SECRET_KEY);
  return new Stripe(account.secret_key);
}

// ── Webhook ───────────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event, matchedAccount = null;
  const accountsWithSecrets = await pool.query('SELECT * FROM stripe_accounts');
  for (const acc of accountsWithSecrets.rows) {
    try {
      if (acc.webhook_secret) {
        event = Stripe.webhooks.constructEvent(req.body, sig, acc.webhook_secret);
        matchedAccount = acc; break;
      }
    } catch(e) {}
  }
  if (!event && process.env.STRIPE_WEBHOOK_SECRET) {
    try { event = Stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); }
    catch(e) { return res.status(400).send('Webhook Error: ' + e.message); }
  }
  if (!event) return res.status(400).send('No matching webhook secret');
  console.log('[webhook] Event:', event.type, matchedAccount ? '→ ' + matchedAccount.name : '');
  const stripe = matchedAccount ? new Stripe(matchedAccount.secret_key) : new Stripe(process.env.STRIPE_SECRET_KEY);

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      let customerId = pi.customer;
      if (!customerId) {
        try {
          const sessions = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
          if (sessions.data.length > 0 && sessions.data[0].customer) customerId = sessions.data[0].customer;
        } catch(e) {}
      }
      if (!customerId) { console.log('[webhook] No customer ID, skipping'); break; }
      try {
        const stripeCustomer = await stripe.customers.retrieve(customerId);
        const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
        const pm = pms.data[0]; const card = pm?.card || {};
        await customers.upsert({
          email: stripeCustomer.email, name: stripeCustomer.name || stripeCustomer.email,
          stripe_customer_id: stripeCustomer.id, stripe_payment_method: pm?.id || null,
          stripe_account_id: matchedAccount?.id || null,
          card_brand: card.brand || null, card_last4: card.last4 || null,
          card_exp_month: card.exp_month || null, card_exp_year: card.exp_year || null,
        });
        const customer = await customers.byStripeId(stripeCustomer.id);
        const existingSubs = await subscriptions.byCustomer(customer.id);
        if (existingSubs.length === 0) {
          const nextDate = new Date(); nextDate.setDate(nextDate.getDate() + 30);
          await subscriptions.create({ customer_id: customer.id, amount: pi.amount, currency: pi.currency, interval_days: 30, next_billing_date: nextDate.toISOString().split('T')[0] });
        }
        await payments.insert({ customer_id: customer.id, subscription_id: null, stripe_payment_intent: pi.id, amount: pi.amount, currency: pi.currency, status: 'succeeded', failure_reason: null });
        console.log('[webhook] ✓ Saved card for', stripeCustomer.email);
      } catch(err) { console.error('[webhook] Error:', err.message); }
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      if (!pi.customer) break;
      const customer = await customers.byStripeId(pi.customer);
      if (!customer) break;
      await payments.insert({ customer_id: customer.id, subscription_id: null, stripe_payment_intent: pi.id, amount: pi.amount, currency: pi.currency, status: 'failed', failure_reason: pi.last_payment_error?.message || 'Unknown' });
      break;
    }
  }
  res.json({ received: true });
});

// ── Stripe Accounts ───────────────────────────────────────────────────────────
app.get('/api/stripe-accounts', async (req, res) => { res.json(await stripeAccounts.all()); });
app.post('/api/stripe-accounts', async (req, res) => {
  try {
    const { name, secret_key, webhook_secret } = req.body;
    if (!name || !secret_key) return res.status(400).json({ error: 'Name and secret key required' });
    const acc = await stripeAccounts.create({ name, secret_key, webhook_secret });
    res.json({ success: true, id: acc.id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/stripe-accounts/:id/default', async (req, res) => {
  await stripeAccounts.setDefault(req.params.id); res.json({ success: true });
});
app.delete('/api/stripe-accounts/:id', async (req, res) => {
  await stripeAccounts.delete(req.params.id); res.json({ success: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  const stats = await payments.stats();
  const allSubs = await subscriptions.all();
  const allCustomers = await customers.all();
  res.json({
    mrr: allSubs.filter(s => s.status === 'active').reduce((sum, s) => sum + (s.amount * 30 / s.interval_days), 0),
    active_subscriptions: allSubs.filter(s => s.status === 'active').length,
    failed_payments: parseInt(stats.failed_count) || 0,
    saved_cards: allCustomers.filter(c => c.stripe_payment_method).length,
    total_revenue: parseInt(stats.total_revenue) || 0,
    total_customers: allCustomers.length,
  });
});

// ── Revenue chart data ────────────────────────────────────────────────────────
app.get('/api/revenue-chart', async (req, res) => {
  const r = await pool.query(`
    SELECT DATE_TRUNC('day', created_at) as day,
      SUM(CASE WHEN status='succeeded' THEN amount ELSE 0 END) as revenue,
      COUNT(CASE WHEN status='succeeded' THEN 1 END) as count
    FROM payments
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY day ORDER BY day ASC
  `);
  res.json(r.rows);
});

// ── Customers ─────────────────────────────────────────────────────────────────
app.get('/api/customers', async (req, res) => { res.json(await customers.all()); });

app.post('/api/customers', async (req, res) => {
  try {
    const { name, email, stripe_customer_id, stripe_payment_method, card_brand, card_last4, card_exp_month, card_exp_year, stripe_account_id, note } = req.body;
    if (!email || !stripe_customer_id) return res.status(400).json({ error: 'Email and Stripe customer ID required' });
    await customers.upsert({ name, email, stripe_customer_id, stripe_payment_method, stripe_account_id, card_brand, card_last4, card_exp_month: parseInt(card_exp_month) || null, card_exp_year: parseInt(card_exp_year) || null });
    const customer = await customers.byStripeId(stripe_customer_id);
    if (note) await customers.updateNote(customer.id, note);
    res.json({ success: true, id: customer.id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/customers/:id/status', async (req, res) => {
  await customers.updateStatus(req.params.id, req.body.status); res.json({ success: true });
});

app.patch('/api/customers/:id/note', async (req, res) => {
  await customers.updateNote(req.params.id, req.body.note); res.json({ success: true });
});

app.post('/api/customers/:id/portal', async (req, res) => {
  const customer = await customers.byId(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const stripe = await getStripe(customer.stripe_account_id);
    const session = await stripe.billingPortal.sessions.create({ customer: customer.stripe_customer_id, return_url: process.env.BASE_URL || 'http://localhost:8080' });
    res.json({ url: session.url });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// CSV export
app.get('/api/customers/export', async (req, res) => {
  const list = await customers.all();
  const header = 'Name,Email,Card Brand,Last 4,Status,Total Paid,Account,Created\n';
  const rows = list.map(c => [
    c.name || '', c.email, c.card_brand || '', c.card_last4 || '',
    c.status, ((c.total_paid || 0) / 100).toFixed(2),
    c.account_name || '', new Date(c.created_at).toLocaleDateString()
  ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
  res.send(header + rows);
});

// ── Subscriptions ─────────────────────────────────────────────────────────────
app.get('/api/subscriptions', async (req, res) => { res.json(await subscriptions.all()); });

app.patch('/api/subscriptions/:id/amount', async (req, res) => {
  const { amount } = req.body;
  if (!amount || isNaN(amount)) return res.status(400).json({ error: 'Invalid amount' });
  await subscriptions.updateAmount(parseInt(req.params.id), parseInt(amount));
  res.json({ success: true });
});

app.patch('/api/subscriptions/:id/status', async (req, res) => {
  await subscriptions.updateStatus(req.params.id, req.body.status); res.json({ success: true });
});

app.patch('/api/subscriptions/:id/billing-date', async (req, res) => {
  await pool.query('UPDATE subscriptions SET next_billing_date=$1 WHERE id=$2', [req.body.date, req.params.id]);
  res.json({ success: true });
});

app.post('/api/subscriptions/:id/charge', async (req, res) => {
  try {
    const allSubs = await subscriptions.all();
    const sub = allSubs.find(s => s.id === parseInt(req.params.id));
    if (!sub) return res.status(404).json({ error: 'Not found' });
    const customer = await customers.byId(sub.customer_id);
    const stripe = await getStripe(customer.stripe_account_id);
    const pi = await stripe.paymentIntents.create({
      amount: sub.amount, currency: sub.currency,
      customer: customer.stripe_customer_id, payment_method: customer.stripe_payment_method,
      off_session: true, confirm: true,
    });
    await payments.insert({ customer_id: customer.id, subscription_id: sub.id, stripe_payment_intent: pi.id, amount: sub.amount, currency: sub.currency, status: 'succeeded', failure_reason: null });
    await subscriptions.advanceBillingDate(sub.id, sub.interval_days);
    res.json({ success: true, paymentIntentId: pi.id });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Payments ──────────────────────────────────────────────────────────────────
app.get('/api/payments', async (req, res) => { res.json(await payments.recent(100)); });

app.post('/api/payments/:id/retry', async (req, res) => {
  try {
    const r = await pool.query('SELECT p.*, c.stripe_customer_id, c.stripe_payment_method, c.stripe_account_id FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.id=$1', [req.params.id]);
    const pmt = r.rows[0];
    if (!pmt) return res.status(404).json({ error: 'Not found' });
    const stripe = await getStripe(pmt.stripe_account_id);
    const pi = await stripe.paymentIntents.create({
      amount: pmt.amount, currency: pmt.currency,
      customer: pmt.stripe_customer_id, payment_method: pmt.stripe_payment_method,
      off_session: true, confirm: true,
    });
    await payments.insert({ customer_id: pmt.customer_id, subscription_id: pmt.subscription_id, stripe_payment_intent: pi.id, amount: pmt.amount, currency: pmt.currency, status: 'succeeded', failure_reason: null });
    res.json({ success: true });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// Payments CSV export
app.get('/api/payments/export', async (req, res) => {
  const list = await payments.recent(10000);
  const header = 'Customer,Email,Amount,Currency,Status,Reason,Date,Stripe ID\n';
  const rows = list.map(p => [
    p.name || '', p.email, ((p.amount || 0) / 100).toFixed(2), p.currency,
    p.status, p.failure_reason || '', new Date(p.created_at).toLocaleDateString(),
    p.stripe_payment_intent || ''
  ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
  res.send(header + rows);
});

// ── Payment Links ─────────────────────────────────────────────────────────────
app.post('/api/payment-links', async (req, res) => {
  try {
    const { amount, currency = 'usd', name = 'Subscription', interval_days = 30, stripe_account_id } = req.body;
    const stripe = await getStripe(stripe_account_id);
    const price = await stripe.prices.create({ unit_amount: amount, currency, product_data: { name } });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      payment_intent_data: { setup_future_usage: 'off_session' },
      customer_creation: 'always',
      after_completion: { type: 'hosted_confirmation', hosted_confirmation: { custom_message: 'Thank you! Your subscription is active.' } },
    });
    res.json({ url: link.url, id: link.id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Run rebills ───────────────────────────────────────────────────────────────
app.post('/api/run-rebills', async (req, res) => {
  const due = await subscriptions.due();
  let succeeded = 0, failed = 0;
  for (const sub of due) {
    try {
      const stripe = sub.stripe_secret_key ? new Stripe(sub.stripe_secret_key) : new Stripe(process.env.STRIPE_SECRET_KEY);
      const pi = await stripe.paymentIntents.create({ amount: sub.amount, currency: sub.currency, customer: sub.stripe_customer_id, payment_method: sub.stripe_payment_method, off_session: true, confirm: true });
      await payments.insert({ customer_id: sub.customer_id, subscription_id: sub.id, stripe_payment_intent: pi.id, amount: sub.amount, currency: sub.currency, status: 'succeeded', failure_reason: null });
      await subscriptions.advanceBillingDate(sub.id, sub.interval_days);
      succeeded++;
    } catch(err) {
      await payments.insert({ customer_id: sub.customer_id, subscription_id: sub.id, stripe_payment_intent: null, amount: sub.amount, currency: sub.currency, status: 'failed', failure_reason: err.message });
      failed++;
    }
  }
  res.json({ success: true, succeeded, failed, total: due.length });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  await init();
  console.log(`\n🚀 Subloop server running on http://localhost:${PORT}`);
  console.log(`   Webhook: http://localhost:${PORT}/webhook\n`);
  initScheduler();
});
