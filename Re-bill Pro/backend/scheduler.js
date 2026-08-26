// scheduler.js — maintenance only. Stripe Billing owns automatic subscription renewals.
const cron = require('node-cron');
const Stripe = require('stripe');
const { pool, settingsDb } = require('./db');

let running = false;
let started = false;

function normalizeStatus(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'cancelled') return 'canceled';
  if (v === 'cancelling') return 'canceling';
  return v;
}

async function processAutoResumes(reconcileCustomerLifecycle = null) {
  if (running) return { skipped: true, reason: 'already_running' };
  running = true;
  let resumed = 0;
  let canceled = 0;
  let failed = 0;
  try {
    const due = await pool.query(`
      SELECT s.*, c.stripe_account_id, c.workspace_id, sa.secret_key,
        w.is_main, l.status AS license_status, l.expires_at
      FROM subscriptions s
      JOIN customers c ON c.id=s.customer_id
      LEFT JOIN stripe_accounts sa ON sa.id=c.stripe_account_id
      LEFT JOIN workspaces w ON w.id=c.workspace_id
      LEFT JOIN licenses l ON l.workspace_id=c.workspace_id
      WHERE LOWER(COALESCE(s.status,''))='paused'
        AND s.resume_date IS NOT NULL
        AND s.resume_date <= CURRENT_DATE
      ORDER BY s.resume_date ASC, s.id ASC
    `);

    for (const sub of due.rows) {
      try {
        // Main always remains operational. Licensed customer workspaces only run
        // maintenance while their Subloop access is active.
        if (!sub.is_main) {
          const expired = sub.expires_at && new Date(sub.expires_at).getTime() <= Date.now();
          if (String(sub.license_status||'').toLowerCase() !== 'active' || expired) continue;
        }
        const enabled = String(await settingsDb.getForWorkspace(sub.workspace_id,'pause_auto_resume') || 'true').toLowerCase();
        if (!['true','1','yes','on'].includes(enabled)) continue;
        let nextStatus = 'active';
        if (sub.stripe_subscription_id) {
          if (!sub.secret_key) throw new Error('Stripe account secret key not found');
          const stripe = new Stripe(sub.secret_key);
          let remote = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
          if (remote.status === 'canceled') {
            nextStatus = 'canceled';
            canceled++;
          } else if (remote.status === 'paused') {
            remote = await stripe.subscriptions.resume(sub.stripe_subscription_id, { billing_cycle_anchor:'unchanged' });
            nextStatus = normalizeStatus(remote.status) || 'active';
            resumed++;
          } else if (remote.pause_collection) {
            remote = await stripe.subscriptions.update(sub.stripe_subscription_id, { pause_collection:'' });
            nextStatus = normalizeStatus(remote.status) || 'active';
            resumed++;
          } else {
            nextStatus = normalizeStatus(remote.status) || 'active';
            resumed++;
          }
        } else {
          resumed++;
        }

        await pool.query(
          `UPDATE subscriptions
           SET status=$1, resume_date=NULL, paused_by_customer=false, ended_at=CASE WHEN $1='canceled' THEN COALESCE(ended_at,NOW()) ELSE NULL END, updated_at=NOW()
           WHERE id=$2`,
          [nextStatus, sub.id]
        );
        if (typeof reconcileCustomerLifecycle === 'function') {
          await reconcileCustomerLifecycle(sub.customer_id).catch(()=>{});
        }
      } catch (err) {
        failed++;
        console.error('[scheduler] auto-resume failed for subscription', sub.id, err.message);
      }
    }
    if (due.rows.length) console.log(`[scheduler] auto-resume checked ${due.rows.length}: resumed=${resumed} canceled=${canceled} failed=${failed}`);
    return { checked: due.rows.length, resumed, canceled, failed };
  } finally {
    running = false;
  }
}

function initScheduler(options = {}) {
  if (started) return;
  started = true;
  // Hourly maintenance only. No charging/retry job exists here.
  cron.schedule('15 * * * *', () => {
    processAutoResumes(options.reconcileCustomerLifecycle).catch(err => console.error('[scheduler] maintenance error:', err.message));
  });
  // Also reconcile overdue resume dates once at boot.
  processAutoResumes(options.reconcileCustomerLifecycle).catch(err => console.error('[scheduler] startup maintenance error:', err.message));
  console.log('[scheduler] Auto-resume maintenance initialized (hourly at :15 UTC); Stripe Billing owns renewals');
}

module.exports = { initScheduler, processAutoResumes };
