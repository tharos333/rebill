// server.js — Rebill backend
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const path = require('path');
const { customers, subscriptions, payments } = require('./db');
const { initScheduler, chargeSubscription } = require('./scheduler');
const { sendFailedPaymentEmail } = require('./mailer');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());

// Raw body needed for Stripe webhook signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname)));

// ── Stripe Webhook ────────────────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] Invalid signature:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[webhook] Event: ${event.type}`);

  switch (event.type) {

    // ── Customer paid via Payment Link ──────────────────────────────────────
   case 'payment_intent.succeeded': {
  const pi = event.data.object;

  let customerId = pi.customer;

  if (!customerId) {
    try {
      const sessions = await stripe.checkout.sessions.list({
        payment_intent: pi.id,
        limit: 1,
      });
      if (sessions.data.length > 0 && sessions.data[0].customer) {
        customerId = sessions.data[0].customer;
      }
    } catch(e) {
      console.log('[webhook] No session found:', e.message);
    }
  }

  if (!customerId) {
    console.log('[webhook] No customer ID found, skipping');
    break;
  }

  try {
    const stripeCustomer = await stripe.customers.retrieve(customerId);
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
      limit: 1,
    });

    const pm = paymentMethods.data[0];
    const card = pm?.card || {};

    customers.upsert({
      email: stripeCustomer.email,
      name: stripeCustomer.name || stripeCustomer.email,
      stripe_customer_id: stripeCustomer.id,
      stripe_payment_method: pm?.id || null,
      card_brand: card.brand || null,
      card_last4: card.last4 || null,
      card_exp_month: card.exp_month || null,
      card_exp_year: card.exp_year || null,
    });

    const customer = customers.byStripeId(stripeCustomer.id);
    const existingSubs = subscriptions.byCustomer(customer.id);

    if (existingSubs.length === 0) {
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + 30);
      subscriptions.create({
        customer_id: customer.id,
        amount: pi.amount,
        currency: pi.currency,
        interval_days: 30,
        next_billing_date: nextDate.toISOString().split('T')[0],
      });
    }

    payments.insert({
      customer_id: customer.id,
      subscription_id: null,
      stripe_payment_intent: pi.id,
      amount: pi.amount,
      currency: pi.currency,
      status: 'succeeded',
      failure_reason: null,
    });

    console.log(`[webhook] ✓ Saved card for ${stripeCustomer.email}`);
  } catch(err) {
    console.error('[webhook] Error:', err.message);
  }
  break;
}
    // ── Payment failed ──────────────────────────────────────────────────────
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      if (!pi.customer) break;

      const customer = customers.byStripeId(pi.customer);
      if (!customer) break;

      payments.insert({
        customer_id: customer.id,
        subscription_id: null,
        stripe_payment_intent: pi.id,
        amount: pi.amount,
        currency: pi.currency,
        status: 'failed',
        failure_reason: pi.last_payment_error?.message || 'Unknown',
      });

      console.log(`[webhook] ✗ Payment failed for ${customer.email}`);
      break;
    }

    // ── Customer updated their payment method ───────────────────────────────
    case 'customer.updated': {
      const sc = event.data.object;
      const defPm = sc.invoice_settings?.default_payment_method;
      if (!defPm) break;

      const pm = await stripe.paymentMethods.retrieve(defPm);
      const card = pm.card || {};
      const customer = customers.byStripeId(sc.id);
      if (!customer) break;

      customers.upsert({
        email: sc.email,
        name: sc.name || sc.email,
        stripe_customer_id: sc.id,
        stripe_payment_method: pm.id,
        card_brand: card.brand || null,
        card_last4: card.last4 || null,
        card_exp_month: card.exp_month || null,
        card_exp_year: card.exp_year || null,
      });

      console.log(`[webhook] Updated payment method for ${sc.email}`);
      break;
    }
  }

  res.json({ received: true });
});

// ── API Routes ────────────────────────────────────────────────────────────────

// Dashboard stats
app.get('/api/stats', (req, res) => {
  const stats = payments.stats();
  const allSubs = subscriptions.all();
  const activeSubs = allSubs.filter(s => s.status === 'active').length;
  const dueSubs = allSubs.filter(s => {
    return s.status === 'active' && new Date(s.next_billing_date) <= new Date();
  }).length;

  res.json({
    mrr: allSubs
      .filter(s => s.status === 'active')
      .reduce((sum, s) => sum + (s.amount * 30 / s.interval_days), 0),
    active_subscriptions: activeSubs,
    failed_payments: stats.failed_count || 0,
    saved_cards: customers.all().filter(c => c.stripe_payment_method).length,
    total_revenue: stats.total_revenue || 0,
    due_today: dueSubs,
  });
});

// List all customers
app.get('/api/customers', (req, res) => {
  res.json(customers.all());
});

// Get single customer with their subs & payments
app.get('/api/customers/:id', (req, res) => {
  const c = customers.byId(req.params.id);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  c.subscriptions = subscriptions.byCustomer(c.id);
  c.payments = payments.byCustomer(c.id);
  res.json(c);
});

// Pause / resume / cancel a customer
app.patch('/api/customers/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'paused', 'cancelled'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  customers.updateStatus(req.params.id, status);
  res.json({ success: true });
});

// List all subscriptions
app.get('/api/subscriptions', (req, res) => {
  res.json(subscriptions.all());
});

// Pause / resume / cancel a subscription
app.patch('/api/subscriptions/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'paused', 'cancelled'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  subscriptions.updateStatus(req.params.id, status);
  res.json({ success: true });
});

// Manually trigger a charge for a subscription NOW
app.post('/api/subscriptions/:id/charge', async (req, res) => {
  const allSubs = subscriptions.all();
  const sub = allSubs.find(s => s.id === parseInt(req.params.id));
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  const customer = customers.byId(sub.customer_id);
  const result = await chargeSubscription({ ...sub, ...customer });
  res.json(result);
});

// Recent payments
app.get('/api/payments', (req, res) => {
  res.json(payments.recent(100));
});

// Create a Stripe Payment Link (with card saving enabled)
app.post('/api/payment-links', async (req, res) => {
  try {
    const { amount, currency = 'usd', name = 'Rebill Subscription', interval_days = 30 } = req.body;

    // Create a one-time price
    const price = await stripe.prices.create({
      unit_amount: amount,
      currency,
      product_data: { name },
    });

    // Create payment link with card saving
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata: { interval_days: String(interval_days) },
      },
      after_completion: {
        type: 'hosted_confirmation',
        hosted_confirmation: { custom_message: 'Thank you! Your subscription is active.' },
      },
    });

    res.json({ url: link.url, id: link.id });
  } catch (err) {
    console.error('[api] Payment link error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create Stripe Customer Portal session (for card updates)
app.post('/api/customers/:id/portal', async (req, res) => {
  const customer = customers.byId(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      return_url: process.env.BASE_URL || 'http://localhost:3001',
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run rebill job manually (useful for testing)
app.post('/api/run-rebills', async (req, res) => {
  const { processDueSubscriptions } = require('./scheduler');
  await processDueSubscriptions();
  res.json({ success: true, message: 'Rebill job executed' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Rebill server running on http://localhost:${PORT}`);
  console.log(`   Webhook endpoint: http://localhost:${PORT}/webhook\n`);
  initScheduler();
});
