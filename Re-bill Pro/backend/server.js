require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const path = require('path');
const { init, pool, settingsDb, stripeAccounts, customers, subscriptions, payments, activityLog, webhookLogs, security } = require('./db');
let speakeasy, QRCode;
try { speakeasy = require('speakeasy'); QRCode = require('qrcode'); } catch(e) { console.log('[2FA] speakeasy/qrcode not installed yet'); }
const { initScheduler } = require('./scheduler');

const app = express();
app.use(cors());
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

async function getStripe(accountId) {
  let acc = accountId ? await stripeAccounts.byId(accountId) : null;
  if (!acc) acc = await stripeAccounts.default();
  return new Stripe(acc ? acc.secret_key : process.env.STRIPE_SECRET_KEY);
}

// ── Webhook ───────────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event, matchedAccount = null;
  const accs = await pool.query('SELECT * FROM stripe_accounts');
  for (const acc of accs.rows) {
    try {
      if (acc.webhook_secret) { event = Stripe.webhooks.constructEvent(req.body, sig, acc.webhook_secret); matchedAccount = acc; break; }
    } catch(e) {}
  }
  if (!event && process.env.STRIPE_WEBHOOK_SECRET) {
    try { event = Stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); }
    catch(e) { return res.status(400).send('Webhook Error: ' + e.message); }
  }
  if (!event) return res.status(400).send('No matching webhook secret');

  const logsEnabled = await settingsDb.get('webhook_logs_enabled');
  if (logsEnabled === 'true') await webhookLogs.add({ event_type: event.type, account_name: matchedAccount?.name });

  console.log('[webhook]', event.type, matchedAccount ? '→ '+matchedAccount.name : '');
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
        const sc = await stripe.customers.retrieve(customerId);
        const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
        const pm = pms.data[0]; const card = pm?.card || {};
        await customers.upsert({ email: sc.email, name: sc.name||sc.email, stripe_customer_id: sc.id, stripe_payment_method: pm?.id||null, stripe_account_id: matchedAccount?.id||null, card_brand: card.brand||null, card_last4: card.last4||null, card_exp_month: card.exp_month||null, card_exp_year: card.exp_year||null });
        const customer = await customers.byStripeId(sc.id);
        const existingSubs = await subscriptions.byCustomer(customer.id);
        if (existingSubs.length === 0) {
          const next = new Date(); next.setDate(next.getDate()+30);
          await subscriptions.create({ customer_id: customer.id, amount: pi.amount, currency: pi.currency, interval_days: 30, next_billing_date: next.toISOString().split('T')[0] });
        }
        await payments.insert({ customer_id: customer.id, subscription_id: null, stripe_payment_intent: pi.id, amount: pi.amount, currency: pi.currency, status: 'succeeded', failure_reason: null });
        await activityLog.add('payment', `Payment of ${(pi.amount/100).toFixed(2)} ${pi.currency.toUpperCase()} received from ${sc.email}`, customer.id, pi.amount);
        console.log('[webhook] ✓ Saved card for', sc.email);
      } catch(err) { console.error('[webhook] Error:', err.message); }
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      if (!pi.customer) break;
      const customer = await customers.byStripeId(pi.customer);
      if (!customer) break;
      await payments.insert({ customer_id: customer.id, subscription_id: null, stripe_payment_intent: pi.id, amount: pi.amount, currency: pi.currency, status: 'failed', failure_reason: pi.last_payment_error?.message||'Unknown' });
      await activityLog.add('failed', `Payment failed for ${customer.email}`, customer.id, pi.amount);
      break;
    }
  }
  res.json({ received: true });
});

// ── Settings ──────────────────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => { res.json(await settingsDb.getAll()); });
app.patch('/api/settings', async (req, res) => {
  const { key, value } = req.body;
  await settingsDb.set(key, value);
  res.json({ success: true });
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
app.patch('/api/stripe-accounts/:id/default', async (req, res) => { await stripeAccounts.setDefault(req.params.id); res.json({ success: true }); });
app.delete('/api/stripe-accounts/:id', async (req, res) => { await stripeAccounts.delete(req.params.id); res.json({ success: true }); });

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  const [pStats, allSubs, allCust, custStats] = await Promise.all([payments.stats(), subscriptions.all(), customers.all(), customers.stats()]);
  const activeSubs = allSubs.filter(s => s.status === 'active');
  const churnRate = parseInt(custStats.total) > 0 ? ((parseInt(custStats.churned_30d)||0) / parseInt(custStats.total) * 100).toFixed(1) : 0;
  const avgLtv = parseInt(custStats.total) > 0 ? Math.round(parseInt(pStats.total_revenue) / parseInt(custStats.total)) : 0;
  const successRate = (parseInt(pStats.succeeded_count)+parseInt(pStats.failed_count)) > 0
    ? (parseInt(pStats.succeeded_count)/(parseInt(pStats.succeeded_count)+parseInt(pStats.failed_count))*100).toFixed(1) : 100;
  res.json({
    mrr: activeSubs.reduce((s,sub) => s+(sub.amount*30/sub.interval_days), 0),
    active_subscriptions: activeSubs.length,
    dunning_subscriptions: allSubs.filter(s=>s.status==='dunning').length,
    failed_payments: parseInt(pStats.failed_count)||0,
    saved_cards: allCust.filter(c=>c.stripe_payment_method).length,
    total_revenue: parseInt(pStats.total_revenue)||0,
    total_customers: parseInt(custStats.total)||0,
    new_customers_30d: parseInt(custStats.new_30d)||0,
    churn_rate: churnRate,
    avg_ltv: avgLtv,
    payment_success_rate: successRate,
    revenue_30d: parseInt(pStats.revenue_30d)||0,
  });
});

app.get('/api/revenue-chart', async (req, res) => {
  const period = req.query.period || 'month';
  let interval;
  if (period === 'today' || period === 'yesterday') interval = '2 days';
  else if (period === 'week') interval = '7 days';
  else interval = '30 days';
  const r = await pool.query(`
    SELECT DATE_TRUNC('day', created_at) as day,
      SUM(CASE WHEN status='succeeded' THEN amount ELSE 0 END) as revenue,
      COUNT(CASE WHEN status='succeeded' THEN 1 END) as count
    FROM payments WHERE created_at >= NOW()-INTERVAL '${interval}'
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
    await customers.upsert({ name, email, stripe_customer_id, stripe_payment_method, stripe_account_id, card_brand, card_last4, card_exp_month: parseInt(card_exp_month)||null, card_exp_year: parseInt(card_exp_year)||null });
    const customer = await customers.byStripeId(stripe_customer_id);
    if (note) await customers.updateNote(customer.id, note);
    res.json({ success: true, id: customer.id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/customers/:id/status', async (req, res) => { await customers.updateStatus(req.params.id, req.body.status); res.json({ success: true }); });
app.patch('/api/customers/:id/note', async (req, res) => { await customers.updateNote(req.params.id, req.body.note); res.json({ success: true }); });
app.post('/api/customers/:id/portal', async (req, res) => {
  const customer = await customers.byId(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  try {
    const stripe = await getStripe(customer.stripe_account_id);
    const session = await stripe.billingPortal.sessions.create({ customer: customer.stripe_customer_id, return_url: process.env.BASE_URL||'http://localhost:8080' });
    res.json({ url: session.url });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/customers/export', async (req, res) => {
  const list = await customers.all();
  const header = 'Name,Email,Card Brand,Last 4,Status,Total Paid,Account,Created\n';
  const rows = list.map(c => [c.name||'', c.email, c.card_brand||'', c.card_last4||'', c.status, ((c.total_paid||0)/100).toFixed(2), c.account_name||'', new Date(c.created_at).toLocaleDateString()].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="customers.csv"');
  res.send(header+rows);
});

// ── Subscriptions ─────────────────────────────────────────────────────────────
app.get('/api/subscriptions', async (req, res) => { res.json(await subscriptions.all()); });
app.patch('/api/subscriptions/:id/amount', async (req, res) => {
  const { amount, prorate } = req.body;
  if (!amount||isNaN(amount)) return res.status(400).json({ error: 'Invalid amount' });
  const prorateEnabled = await settingsDb.get('proration_enabled');
  if (prorate && prorateEnabled === 'true') {
    // Proration: charge difference immediately
    try {
      const allSubs = await subscriptions.all();
      const sub = allSubs.find(s => s.id === parseInt(req.params.id));
      const customer = await customers.byId(sub.customer_id);
      const today = new Date();
      const nextBilling = new Date(sub.next_billing_date);
      const daysLeft = Math.max(0, Math.ceil((nextBilling - today) / (1000*60*60*24)));
      const daysTotal = sub.interval_days;
      const oldDailyRate = sub.amount / daysTotal;
      const newDailyRate = parseInt(amount) / daysTotal;
      const proratedDiff = Math.round((newDailyRate - oldDailyRate) * daysLeft);
      if (proratedDiff > 50) {
        const stripe = await getStripe(customer.stripe_account_id);
        const pi = await stripe.paymentIntents.create({ amount: proratedDiff, currency: sub.currency, customer: customer.stripe_customer_id, payment_method: customer.stripe_payment_method, off_session: true, confirm: true, description: 'Proration charge' });
        await payments.insert({ customer_id: customer.id, subscription_id: sub.id, stripe_payment_intent: pi.id, amount: proratedDiff, currency: sub.currency, status: 'succeeded', failure_reason: null });
        await activityLog.add('proration', `Proration charge of ${(proratedDiff/100).toFixed(2)} for ${customer.email}`, customer.id, proratedDiff);
      }
    } catch(err) { console.error('[proration]', err.message); }
  }
  await subscriptions.updateAmount(parseInt(req.params.id), parseInt(amount));
  res.json({ success: true });
});
app.patch('/api/subscriptions/:id/status', async (req, res) => {
  const { status, resume_date } = req.body;
  await subscriptions.updateStatus(req.params.id, status);
  if (status === 'paused' && resume_date) await subscriptions.setResumeDate(req.params.id, resume_date);
  if (status === 'active') await subscriptions.setResumeDate(req.params.id, null);
  res.json({ success: true });
});
app.post('/api/subscriptions/:id/charge', async (req, res) => {
  try {
    const allSubs = await subscriptions.all();
    const sub = allSubs.find(s => s.id === parseInt(req.params.id));
    if (!sub) return res.status(404).json({ error: 'Not found' });
    const customer = await customers.byId(sub.customer_id);
    const stripe = await getStripe(customer.stripe_account_id);
    const pi = await stripe.paymentIntents.create({ amount: sub.amount, currency: sub.currency, customer: customer.stripe_customer_id, payment_method: customer.stripe_payment_method, off_session: true, confirm: true });
    await payments.insert({ customer_id: customer.id, subscription_id: sub.id, stripe_payment_intent: pi.id, amount: sub.amount, currency: sub.currency, status: 'succeeded', failure_reason: null });
    await subscriptions.advanceBillingDate(sub.id, sub.interval_days);
    await activityLog.add('charge', `Manual charge of ${(sub.amount/100).toFixed(2)} for ${customer.email}`, customer.id, sub.amount);
    res.json({ success: true, paymentIntentId: pi.id });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Payments ──────────────────────────────────────────────────────────────────
app.get('/api/payments', async (req, res) => { res.json(await payments.recent(100)); });
app.post('/api/payments/:id/retry', async (req, res) => {
  try {
    const r = await pool.query('SELECT p.*, c.stripe_customer_id, c.stripe_payment_method, c.stripe_account_id, c.email FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.id=$1', [req.params.id]);
    const pmt = r.rows[0]; if (!pmt) return res.status(404).json({ error: 'Not found' });
    const stripe = await getStripe(pmt.stripe_account_id);
    const pi = await stripe.paymentIntents.create({ amount: pmt.amount, currency: pmt.currency, customer: pmt.stripe_customer_id, payment_method: pmt.stripe_payment_method, off_session: true, confirm: true });
    await payments.insert({ customer_id: pmt.customer_id, subscription_id: pmt.subscription_id, stripe_payment_intent: pi.id, amount: pmt.amount, currency: pmt.currency, status: 'succeeded', failure_reason: null });
    await activityLog.add('retry', `Retry payment succeeded for ${pmt.email}`, pmt.customer_id, pmt.amount);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/api/payments/export', async (req, res) => {
  const list = await payments.recent(10000);
  const header = 'Customer,Email,Amount,Currency,Status,Reason,Date,Stripe ID\n';
  const rows = list.map(p => [p.name||'', p.email, ((p.amount||0)/100).toFixed(2), p.currency, p.status, p.failure_reason||'', new Date(p.created_at).toLocaleDateString(), p.stripe_payment_intent||''].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="payments.csv"');
  res.send(header+rows);
});

// ── Payment Links ─────────────────────────────────────────────────────────────
app.post('/api/payment-links', async (req, res) => {
  try {
    const { amount, currency='usd', name='Subscription', interval_days=30, stripe_account_id } = req.body;
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

// ── Activity Log ──────────────────────────────────────────────────────────────
app.get('/api/activity', async (req, res) => { res.json(await activityLog.recent(100)); });

// ── Webhook Logs ──────────────────────────────────────────────────────────────
app.get('/api/webhook-logs', async (req, res) => { res.json(await webhookLogs.recent(100)); });

// ── Run Rebills (with dunning + auto-resume) ──────────────────────────────────
app.post('/api/run-rebills', async (req, res) => {
  const due = await subscriptions.due();
  const dunningEnabled = await settingsDb.get('dunning_enabled');
  const dunningDaysStr = await settingsDb.get('dunning_days') || '3,7,14';
  const dunningDays = dunningDaysStr.split(',').map(Number);
  const pauseAutoResume = await settingsDb.get('pause_auto_resume');
  let succeeded=0, failed=0, resumed=0;

  // Auto-resume paused subscriptions
  if (pauseAutoResume === 'true') {
    const toResume = await subscriptions.resumeDue();
    for (const sub of toResume) {
      await subscriptions.updateStatus(sub.id, 'active');
      await subscriptions.setResumeDate(sub.id, null);
      await activityLog.add('resume', `Subscription auto-resumed`, sub.customer_id);
      resumed++;
    }
  }

  // Process dunning retries
  if (dunningEnabled === 'true') {
    const dunning = await subscriptions.dunningDue();
    for (const sub of dunning) {
      try {
        const stripe = sub.stripe_secret_key ? new Stripe(sub.stripe_secret_key) : new Stripe(process.env.STRIPE_SECRET_KEY);
        const pi = await stripe.paymentIntents.create({ amount: sub.amount, currency: sub.currency, customer: sub.stripe_customer_id, payment_method: sub.stripe_payment_method, off_session: true, confirm: true });
        await payments.insert({ customer_id: sub.customer_id, subscription_id: sub.id, stripe_payment_intent: pi.id, amount: sub.amount, currency: sub.currency, status: 'succeeded', failure_reason: null });
        await subscriptions.advanceBillingDate(sub.id, sub.interval_days);
        await subscriptions.updateStatus(sub.id, 'active');
        await activityLog.add('dunning_success', `Dunning retry succeeded for ${sub.email}`, sub.customer_id, sub.amount);
        succeeded++;
      } catch(err) {
        const count = sub.dunning_count || 0;
        if (count >= dunningDays.length) {
          await subscriptions.updateStatus(sub.id, 'cancelled');
          await activityLog.add('dunning_cancelled', `Subscription cancelled after ${count} dunning retries for ${sub.email}`, sub.customer_id);
        } else {
          const nextRetryDays = dunningDays[count] || 7;
          const retryDate = new Date(); retryDate.setDate(retryDate.getDate()+nextRetryDays);
          await subscriptions.markDunning(sub.id, retryDate.toISOString().split('T')[0]);
          await activityLog.add('dunning_retry', `Dunning retry ${count+1} scheduled for ${sub.email}`, sub.customer_id);
        }
        failed++;
      }
    }
  }

  // Normal rebills
  for (const sub of due) {
    try {
      const stripe = sub.stripe_secret_key ? new Stripe(sub.stripe_secret_key) : new Stripe(process.env.STRIPE_SECRET_KEY);
      const pi = await stripe.paymentIntents.create({ amount: sub.amount, currency: sub.currency, customer: sub.stripe_customer_id, payment_method: sub.stripe_payment_method, off_session: true, confirm: true });
      await payments.insert({ customer_id: sub.customer_id, subscription_id: sub.id, stripe_payment_intent: pi.id, amount: sub.amount, currency: sub.currency, status: 'succeeded', failure_reason: null });
      await subscriptions.advanceBillingDate(sub.id, sub.interval_days);
      await activityLog.add('rebill', `Auto-rebill of ${(sub.amount/100).toFixed(2)} for ${sub.email}`, sub.customer_id, sub.amount);
      succeeded++;
    } catch(err) {
      await payments.insert({ customer_id: sub.customer_id, subscription_id: sub.id, stripe_payment_intent: null, amount: sub.amount, currency: sub.currency, status: 'failed', failure_reason: err.message });
      if (dunningEnabled === 'true') {
        const retryDate = new Date(); retryDate.setDate(retryDate.getDate()+(dunningDays[0]||3));
        await subscriptions.markDunning(sub.id, retryDate.toISOString().split('T')[0]);
        await activityLog.add('dunning_start', `Dunning started for ${sub.email}`, sub.customer_id);
      }
      failed++;
    }
  }

  res.json({ success: true, succeeded, failed, resumed, total: due.length });
});

// ── Security & 2FA ───────────────────────────────────────────────────────────

// Get 2FA setup QR code
app.post('/api/security/2fa/setup', async (req, res) => {
  if (!speakeasy) return res.status(500).json({ error: '2FA library not installed' });
  try {
    const secret = speakeasy.generateSecret({ name: 'Subloop', issuer: 'Subloop' });
    await settingsDb.set('two_fa_secret_pending', secret.base32);
    const qrUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrCode: qrUrl });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Verify and enable 2FA
app.post('/api/security/2fa/verify', async (req, res) => {
  if (!speakeasy) return res.status(500).json({ error: '2FA library not installed' });
  try {
    const { token } = req.body;
    const secret = await settingsDb.get('two_fa_secret_pending');
    if (!secret) return res.status(400).json({ error: 'No pending 2FA setup' });
    const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 2 });
    if (!verified) return res.status(400).json({ error: 'Invalid code' });
    await settingsDb.set('two_fa_secret', secret);
    await settingsDb.set('two_fa_enabled', 'true');
    await settingsDb.set('two_fa_secret_pending', '');
    await activityLog.add('security', '2FA enabled');
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Disable 2FA
app.post('/api/security/2fa/disable', async (req, res) => {
  await settingsDb.set('two_fa_enabled', 'false');
  await settingsDb.set('two_fa_secret', '');
  await activityLog.add('security', '2FA disabled');
  res.json({ success: true });
});

// Validate 2FA token (called from login)
app.post('/api/security/2fa/validate', async (req, res) => {
  if (!speakeasy) return res.json({ valid: true }); // skip if not installed
  try {
    const { token } = req.body;
    const secret = await settingsDb.get('two_fa_secret');
    if (!secret) return res.json({ valid: true });
    const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 2 });
    res.json({ valid });
  } catch(err) { res.json({ valid: false }); }
});

// Check if 2FA is enabled
app.get('/api/security/2fa/status', async (req, res) => {
  const enabled = await settingsDb.get('two_fa_enabled');
  res.json({ enabled: enabled === 'true' });
});

// Login attempt tracking
app.post('/api/security/login-attempt', async (req, res) => {
  const { success } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  await security.logAttempt(ip, success);
  if (success) await security.clearAttempts(ip);
  res.json({ success: true });
});

// Check if IP is locked out
app.get('/api/security/lockout-check', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const maxAttempts = parseInt(await settingsDb.get('max_login_attempts') || '5');
  const lockoutMins = parseInt(await settingsDb.get('lockout_minutes') || '15');
  const failures = await security.recentFailures(ip, lockoutMins);
  res.json({ locked: failures >= maxAttempts, failures, maxAttempts, lockoutMins });
});

// Recent login history
app.get('/api/security/login-history', async (req, res) => {
  res.json(await security.recentLogins(30));
});


// ── Revenue Forecast ──────────────────────────────────────────────────────────
app.get('/api/forecast', async (req, res) => {
  try {
    const allSubs = await subscriptions.all();
    const activeSubs = allSubs.filter(s => s.status === 'active');
    const now = new Date();
    let forecast30 = 0, forecast60 = 0, forecast90 = 0;
    activeSubs.forEach(s => {
      const next = new Date(s.next_billing_date);
      const diff = (next - now) / (1000*60*60*24);
      const cycles30 = Math.floor(30 / s.interval_days) + (diff <= 30 ? 1 : 0);
      const cycles60 = Math.floor(60 / s.interval_days) + (diff <= 60 ? 1 : 0);
      const cycles90 = Math.floor(90 / s.interval_days) + (diff <= 90 ? 1 : 0);
      forecast30 += s.amount * cycles30;
      forecast60 += s.amount * cycles60;
      forecast90 += s.amount * cycles90;
    });
    res.json({ forecast30, forecast60, forecast90, active_count: activeSubs.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Card Expiry Scanner ───────────────────────────────────────────────────────
app.get('/api/expiring-cards', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const now = new Date();
    const futureMonth = now.getMonth() + 1 + Math.ceil(days / 30);
    const futureYear = now.getFullYear() + Math.floor((now.getMonth() + Math.ceil(days / 30)) / 12);
    const r = await pool.query(`
      SELECT c.*, s.amount, s.interval_days, s.next_billing_date
      FROM customers c
      LEFT JOIN subscriptions s ON s.customer_id = c.id AND s.status = 'active'
      WHERE c.status = 'active'
        AND c.card_exp_month IS NOT NULL
        AND c.card_exp_year IS NOT NULL
        AND (
          c.card_exp_year < $1
          OR (c.card_exp_year = $1 AND c.card_exp_month <= $2)
        )
      ORDER BY c.card_exp_year ASC, c.card_exp_month ASC
    `, [futureYear, now.getMonth() + 1 + Math.ceil(days / 30)]);
    res.json(r.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Customer Tags ─────────────────────────────────────────────────────────────
app.patch('/api/customers/:id/tag', async (req, res) => {
  try {
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS tag TEXT').catch(()=>{});
    await pool.query('UPDATE customers SET tag=$1 WHERE id=$2', [req.body.tag, req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/customers/:id/tag', async (req, res) => {
  try {
    await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS tag TEXT').catch(()=>{});
    const r = await pool.query('SELECT tag FROM customers WHERE id=$1', [req.params.id]);
    res.json({ tag: r.rows[0]?.tag || null });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Blacklist ─────────────────────────────────────────────────────────────────
app.patch('/api/customers/:id/blacklist', async (req, res) => {
  try {
    await pool.query('UPDATE customers SET status=$1 WHERE id=$2', ['blacklisted', req.params.id]);
    await activityLog.add('blacklist', `Customer blacklisted`, req.params.id);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Manual Invoice (one-time charge) ─────────────────────────────────────────
app.post('/api/customers/:id/charge-once', async (req, res) => {
  try {
    const { amount, currency = 'usd', description = 'Manual invoice' } = req.body;
    const customer = await customers.byId(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    if (!customer.stripe_payment_method) return res.status(400).json({ error: 'No saved card' });
    const stripe = await getStripe(customer.stripe_account_id);
    const pi = await stripe.paymentIntents.create({
      amount: parseInt(amount),
      currency,
      customer: customer.stripe_customer_id,
      payment_method: customer.stripe_payment_method,
      off_session: true,
      confirm: true,
      description,
    });
    await payments.insert({ customer_id: customer.id, subscription_id: null, stripe_payment_intent: pi.id, amount: parseInt(amount), currency, status: 'succeeded', failure_reason: null });
    await activityLog.add('invoice', `Manual invoice of ${(amount/100).toFixed(2)} ${currency.toUpperCase()} charged to ${customer.email}`, customer.id, parseInt(amount));
    res.json({ success: true, paymentIntentId: pi.id });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Daily Summary ─────────────────────────────────────────────────────────────
app.get('/api/daily-summary', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(CASE WHEN status='succeeded' AND created_at >= CURRENT_DATE THEN 1 END) as payments_today,
        COALESCE(SUM(CASE WHEN status='succeeded' AND created_at >= CURRENT_DATE THEN amount ELSE 0 END),0) as revenue_today,
        COUNT(CASE WHEN status='failed' AND created_at >= CURRENT_DATE THEN 1 END) as failed_today,
        COUNT(CASE WHEN status='succeeded' AND created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as payments_7d,
        COALESCE(SUM(CASE WHEN status='succeeded' AND created_at >= CURRENT_DATE - INTERVAL '7 days' THEN amount ELSE 0 END),0) as revenue_7d,
        COUNT(CASE WHEN status='succeeded' AND created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 END) as payments_month,
        COALESCE(SUM(CASE WHEN status='succeeded' AND created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN amount ELSE 0 END),0) as revenue_month
      FROM payments
    `);
    const custR = await pool.query(`
      SELECT
        COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as new_today,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as new_7d,
        COUNT(CASE WHEN status='active' THEN 1 END) as active_total
      FROM customers
    `);
    res.json({ ...r.rows[0], ...custR.rows[0] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  await init();
  console.log(`\n🚀 Subloop running on http://localhost:${PORT}\n`);
  initScheduler();
});
