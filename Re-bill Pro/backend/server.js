require('dotenv').config();

const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const path = require('path');
const { init, customers, subscriptions, payments } = require('./db');
const { initScheduler, chargeSubscription } = require('./scheduler');
const { sendFailedPaymentEmail } = require('./mailer');

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Webhook ──────────────────────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[webhook] Event: ${event.type}`);

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
        const paymentMethods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
        const pm = paymentMethods.data[0];
        const card = pm?.card || {};

        await customers.upsert({
          email: stripeCustomer.email,
          name: stripeCustomer.name || stripeCustomer.email,
          stripe_customer_id: stripeCustomer.id,
          stripe_payment_method: pm?.id || null,
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

        console.log(`[webhook] ✓ Saved card for ${stripeCustomer.email}`);
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

// ── API ───────────────────────────────────────────────────────────────────────

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

app.get('/api/customers', async (req, res) => {
  res.json(await customers.all());
});

app.get('/api/customers/:id', async (req, res) => {
  const c = await customers.byId(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.subscriptions = await subscriptions.byCustomer(c.id);
  c.payments = await payments.byCustomer(c.id);
  res.json(c);
});

app.patch('/api/customers/:id/status', async (req, res) => {
  const { status } = req.body;
  await customers.updateStatus(req.params.id, status);
  res.json({ success: true });
});

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
  const { status } = req.body;
  await subscriptions.updateStatus(req.params.id, status);
  res.json({ success: true });
});

app.post('/api/subscriptions/:id/charge', async (req, res) => {
  const allSubs = await subscriptions.all();
  const sub = allSubs.find(s => s.id === parseInt(req.params.id));
  if (!sub) return res.status(404).json({ error: 'Not found' });
  const customer = await customers.byId(sub.customer_id);
  const result = await chargeSubscription({ ...sub, ...customer });
  res.json(result);
});

app.get('/api/payments', async (req, res) => {
  res.json(await payments.recent(100));
});

app.post('/api/payment-links', async (req, res) => {
  try {
    const { amount, currency = 'usd', name = 'Rebill Subscription', interval_days = 30 } = req.body;
    const price = await stripe.prices.create({ unit_amount: amount, currency, product_data: { name } });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      payment_intent_data: { setup_future_usage: 'off_session' },
      customer_creation: 'always',
      after_completion: { type: 'hosted_confirmation', hosted_confirmation: { custom_message: 'Thank you! Your subscription is active.' } },
    });
    res.json({ url: link.url, id: link.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/customers/:id/portal', async (req, res) => {
  const customer = await customers.byId(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
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

app.post('/api/run-rebills', async (req, res) => {
  const { processDueSubscriptions } = require('./scheduler');
  await processDueSubscriptions();
  res.json({ success: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  await init();
  console.log(`\n🚀 Rebill server running on http://localhost:${PORT}`);
  console.log(`   Webhook endpoint: http://localhost:${PORT}/webhook\n`);
  initScheduler();
});
