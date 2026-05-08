// scheduler.js — runs daily to charge due subscriptions
const cron = require('node-cron');
const Stripe = require('stripe');
const { subscriptions, payments, customers } = require('./db');
const { sendFailedPaymentEmail, sendReceiptEmail } = require('./mailer');

let stripe;

function initScheduler() {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Run every day at 9:00 AM UTC
  cron.schedule('0 9 * * *', () => {
    console.log('[scheduler] Running daily rebill job...');
    processDueSubscriptions();
  });

  console.log('[scheduler] Daily rebill cron initialized (runs at 09:00 UTC)');
}

async function processDueSubscriptions() {
  const due = subscriptions.due();
  console.log(`[scheduler] Found ${due.length} subscription(s) due for billing`);

  for (const sub of due) {
    await chargeSubscription(sub);
  }
}

async function chargeSubscription(sub) {
  console.log(`[scheduler] Charging customer ${sub.email} — $${(sub.amount / 100).toFixed(2)}`);

  try {
    const pi = await stripe.paymentIntents.create({
      amount: sub.amount,
      currency: sub.currency,
      customer: sub.stripe_customer_id,
      payment_method: sub.stripe_payment_method,
      off_session: true,
      confirm: true,
      description: `Rebill subscription #${sub.id}`,
      metadata: {
        subscription_id: String(sub.id),
        customer_email: sub.email,
      },
    });

    // Record success
    payments.insert({
      customer_id: sub.customer_id,
      subscription_id: sub.id,
      stripe_payment_intent: pi.id,
      amount: sub.amount,
      currency: sub.currency,
      status: 'succeeded',
      failure_reason: null,
    });

    // Advance to next billing date
    subscriptions.advanceBillingDate(sub.id, sub.interval_days);

    // Send receipt
    await sendReceiptEmail({
      email: sub.email,
      name: sub.name,
      amount: sub.amount,
      currency: sub.currency,
      paymentIntentId: pi.id,
    });

    console.log(`[scheduler] ✓ Charged ${sub.email}: ${pi.id}`);
    return { success: true, paymentIntentId: pi.id };

  } catch (err) {
    const failureReason = err.raw?.message || err.message || 'Unknown error';
    console.error(`[scheduler] ✗ Failed to charge ${sub.email}: ${failureReason}`);

    // Record failure
    payments.insert({
      customer_id: sub.customer_id,
      subscription_id: sub.id,
      stripe_payment_intent: null,
      amount: sub.amount,
      currency: sub.currency,
      status: 'failed',
      failure_reason: failureReason,
    });

    // Send failure email with card update link (Stripe Customer Portal)
    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: process.env.BASE_URL || 'http://localhost:3001',
      });

      await sendFailedPaymentEmail({
        email: sub.email,
        name: sub.name,
        amount: sub.amount,
        currency: sub.currency,
        updateUrl: portalSession.url,
      });
    } catch (portalErr) {
      console.error('[scheduler] Could not create portal session:', portalErr.message);
    }

    return { success: false, error: failureReason };
  }
}

module.exports = { initScheduler, chargeSubscription, processDueSubscriptions };
