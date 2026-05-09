require('dotenv').config();

const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const path = require('path');
const { init, stripeAccounts, customers, subscriptions, payments } = require('./db');
const { initScheduler } = require('./scheduler');

const app = express();

app.use(cors());
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Helper: get Stripe instance for a given account ID (or default)
async function getStripe(accountId) {
  let account;
  if (accountId) {
    account = await stripeAccounts.byId(accountId);
  }
  if (!account) {
    account = await stripeAccounts.default();
  }
  if (!account) {
    return new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return new Stripe(account.secret_key);
}

// ── Webhook ───────────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  let matchedAccount = null;

  // Try to match webhook secret to a specific account
  const allAccounts = await stripeAccounts.all();

  // We need full account data (with secret) so query directly
  const { pool } = require('./db');
  const accountsWithSecrets = await pool.query('SELECT * FROM stripe_accounts');

  for (const acc of accountsWithSecrets.rows) {
    try {
      if (acc.webhook_secret) {
        event = Stripe.webhooks.constructEvent(req.body, sig, acc.webhook_secret);
        matchedAccount = acc;
        break;
      }
    } catch(e) { /* try next */ }
  }

  // Fallback to env webhook secret
  if (!event && process.env.STRIPE_WEBHOOK_SECRET) {
    try {
      event = Stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch(e) {
      return res.status(400).send('Webhook Error: ' + e.message);
    }
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
          if (sessions.data.length > 0 && sessions.data[0].customer) {
            customerId = sessions.data[0].customer;
          }
        } catch(e) {}
      }

      if (!customerId) { console.log('[webhook] No customer ID, skipping'); break; }

      try {
        const stripeCustomer = await stripe.customers.retrieve(customerId);
        const paymentMethods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
        const pm = paymentMethods.data[0];
        const card = pm?.card || {};

        await customers.upsert({
          email: stripeCustomer.email,
          name: stripeCustomer.name || stripeCustomer.email,
          stripe_customer_id: stripeCustomer.id,
          stripe_payment_method: pm?.id || null,
          stripe_account_id: matchedAccount?.id || null,
          card_brand: card.brand || null,
          card_last4: card.last4 || null,
          card_exp_month: card.exp_month || null,
          card_exp_year: card.exp_year || null,
        });

        const customer = await customers.byStripeId(stripeCustomer.id);
        const existingSubs = await subscriptions.byCustomer(customer.id);

        if (existingSubs.length === 0) {
          const nextDate = new Date();
          nextDate.setDate(nextDate.getDate() + 30);
          await subscriptions.create({
            customer_id: customer.id,
            amount: pi.amount,
            currency: pi.currency,
            interval_days: 30,
            next_billing_date: nextDate.toISOString().split('T')[0],
          });
        }

        await payments.insert({
          customer_id: customer.id,
          subscription_id: null,
          stripe_payment_intent: pi.id,
          amount: pi.amount,
          currency: pi.currency,
          status: 'succeeded',
          failure_reason: null,
        });

        console.log('[webhook] ✓ Saved card for', stripeCustomer.email);
      } catch(err) {
        console.error('[webhook] Error:', err.message);
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      if (!pi.customer) break;
      const customer = await customers.byStripeId(pi.customer);
      if (!customer) break;
      await payments.insert({
        customer_id: customer.id,
        subscription_id: null,
        stripe_payment_intent: pi.id,
        amount: pi.amount,
        currency: pi.currency,
        status: 'failed',
        failure_reason: pi.last_payment_error?.message || 'Unknown',
      });
      break;
    }
  }

  res.json({ received: true });
});

// ── Stripe Accounts API ───────────────────────────────────────────────────────
app.get('/api/stripe-accounts', async (req, res) => {
  res.json(await stripeAccounts.all());
});

app.post('/api/stripe-accounts', async (req, res) => {
  try {
    const { name, secret_key, webhook_secret } = req.body;
    if (!name || !secret_key) return res.status(400).json({ error: 'Name and secret key required' });
    // Validate the key by making a test API call
    const testStripe = new Stripe(secret_key);
    await testStripe.accounts.retrieve().catch(() => {}); // ignore error, just validate format
    const acc = await stripeAccounts.create({ name, secret_key, webhook_secret });
    res.json({ success: true, id: acc.id });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/stripe-accounts/:id/default', async (req, res) => {
  await stripeAccounts.setDefault(req.params.id);
  res.json({ success: true });
});

app.delete('/api/stripe-accounts/:id', async (req, res) => {
  await stripeAccounts.delete(req.params.id);
  res.json({ success: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  const stats = await payments.stats();
  const allSubs = await subscriptions.all();
  const activeSubs = allSubs.filter(s => s.status === 'active').length;
  const allCustomers = await customers.all();
  res.json({
    mrr: allSubs.filter(s => s.status === 'active').reduce((sum, s) => sum + (s.amount * 30 / s.interval_days), 0),
    active_subscriptions: activeSubs,
    failed_payments: parseInt(stats.failed_count) || 0,
    saved_cards: allCustomers.filter(c => c.stripe_payment_method).length,
    total_revenue: parseInt(stats.total_revenue) || 0,
  });
});

// ── Customers ─────────────────────────────────────────────────────────────────
app.get('/api/customers', async (req, res) => {
  res.json(await customers.all());
});

app.patch('/api/customers/:id/status', async (req, res) => {
  await customers.updateStatus(req.params.id, req.body.status);
  res.json({ success: true });
});

app.post('/api/customers/:id/portal', async (req, res) => {
  const customer = await customers.byId(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const stripe = await getStripe(customer.stripe_account_id);
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      return_url: process.env.BASE_URL || 'http://localhost:8080',
    });
    res.json({ url: session.url });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Subscriptions ─────────────────────────────────────────────────────────────
app.get('/api/subscriptions', async (req, res) => {
  res.json(await subscriptions.all());
});

app.patch('/api/subscriptions/:id/amount', async (req, res) => {
  const { amount } = req.body;
  if (!amount || isNaN(amount)) return res.status(400).json({ error: 'Invalid amount' });
  await subscriptions.updateAmount(parseInt(req.params.id), parseInt(amount));
  res.json({ success: true });
});

app.patch('/api/subscriptions/:id/status', async (req, res) => {
  await subscriptions.updateStatus(req.params.id, req.body.status);
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
      amount: sub.amount,
      currency: sub.currency,
      customer: customer.stripe_customer_id,
      payment_method: customer.stripe_payment_method,
      off_session: true,
      confirm: true,
    });

    await payments.insert({
      customer_id: customer.id,
      subscription_id: sub.id,
      stripe_payment_intent: pi.id,
      amount: sub.amount,
      currency: sub.currency,
      status: 'succeeded',
      failure_reason: null,
    });

    await subscriptions.advanceBillingDate(sub.id, sub.interval_days);
    res.json({ success: true, paymentIntentId: pi.id });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Payments ──────────────────────────────────────────────────────────────────
app.get('/api/payments', async (req, res) => {
  res.json(await payments.recent(100));
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
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Run rebills ───────────────────────────────────────────────────────────────
app.post('/api/run-rebills', async (req, res) => {
  const due = await subscriptions.due();
  let succeeded = 0, failed = 0;

  for (const sub of due) {
    try {
      const stripe = sub.stripe_secret_key ? new Stripe(sub.stripe_secret_key) : new Stripe(process.env.STRIPE_SECRET_KEY);
      const pi = await stripe.paymentIntents.create({
        amount: sub.amount,
        currency: sub.currency,
        customer: sub.stripe_customer_id,
        payment_method: sub.stripe_payment_method,
        off_session: true,
        confirm: true,
      });
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
  console.log(`   Webhook endpoint: http://localhost:${PORT}/webhook\n`);
  initScheduler();
});
