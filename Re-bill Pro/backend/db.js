const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false }
});
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stripe_accounts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      webhook_secret TEXT,
      is_default BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      stripe_customer_id TEXT UNIQUE NOT NULL,
      stripe_payment_method TEXT,
      stripe_account_id INT,
      card_brand TEXT,
      card_last4 TEXT,
      card_exp_month INT,
      card_exp_year INT,
      status TEXT DEFAULT 'active',
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      customer_id INT REFERENCES customers(id),
      amount INT NOT NULL,
      currency TEXT DEFAULT 'usd',
      interval_days INT DEFAULT 30,
      next_billing_date DATE NOT NULL,
      status TEXT DEFAULT 'active',
      resume_date DATE,
      dunning_count INT DEFAULT 0,
      last_failed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      customer_id INT REFERENCES customers(id),
      subscription_id INT REFERENCES subscriptions(id),
      stripe_payment_intent TEXT,
      amount INT NOT NULL,
      currency TEXT DEFAULT 'usd',
      status TEXT NOT NULL,
      failure_reason TEXT,
      card_brand TEXT,
      card_last4 TEXT,
      card_exp_month INT,
      card_exp_year INT,
      card_country TEXT,
      card_funding TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      customer_id INT,
      amount INT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      account_name TEXT,
      status TEXT DEFAULT 'ok',
      error TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS security (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      permissions JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_login TIMESTAMPTZ
    );
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb;
    CREATE TABLE IF NOT EXISTS login_attempts (
      id SERIAL PRIMARY KEY,
      ip TEXT,
      success BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  const migrations = [
    'ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_account_id INT',
    'ALTER TABLE customers ADD COLUMN IF NOT EXISTS note TEXT',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS resume_date DATE',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS dunning_count INT DEFAULT 0',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_brand TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_last4 TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_exp_month INT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_exp_year INT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_country TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_funding TEXT',
  ];
  for (const m of migrations) await pool.query(m).catch(() => {});
  const adminCount = await pool.query('SELECT COUNT(*) FROM admin_users');
  if (parseInt(adminCount.rows[0].count) === 0) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update('IssoMoussa544@###').digest('hex');
    await pool.query("INSERT INTO admin_users (username, password_hash, role) VALUES ($1, $2, 'owner')", ['Tharos333', hash]).catch(()=>{});
  }
  const defaults = {
    dunning_enabled: 'false', two_fa_enabled: 'false', two_fa_secret: '',
    session_timeout: '480', max_login_attempts: '5', lockout_minutes: '15',
    dunning_days: '3,7,14', pause_auto_resume: 'true', proration_enabled: 'false',
    churn_alert_enabled: 'false', bulk_actions_enabled: 'true',
    scheduled_billing_enabled: 'true', webhook_logs_enabled: 'true',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await pool.query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
  const existing = await pool.query('SELECT COUNT(*) FROM stripe_accounts');
  if (parseInt(existing.rows[0].count) === 0 && process.env.STRIPE_SECRET_KEY) {
    await pool.query('INSERT INTO stripe_accounts (name,secret_key,webhook_secret,is_default) VALUES ($1,$2,$3,true)',
      ['Default Account', process.env.STRIPE_SECRET_KEY, process.env.STRIPE_WEBHOOK_SECRET || '']);
  }
  console.log('[db] PostgreSQL ready');
}
const settingsDb = {
  get: async (key) => { const r = await pool.query('SELECT value FROM settings WHERE key=$1', [key]); return r.rows[0]?.value; },
  getAll: async () => { const r = await pool.query('SELECT key, value FROM settings ORDER BY key'); return Object.fromEntries(r.rows.map(r => [r.key, r.value])); },
  set: async (key, value) => { await pool.query('INSERT INTO settings (key,value,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()', [key, value]); },
};
const stripeAccounts = {
  all: async () => { const r = await pool.query("SELECT id, name, is_default, created_at, LEFT(secret_key,12)||'...' as key_preview FROM stripe_accounts ORDER BY created_at ASC"); return r.rows; },
  byId: async (id) => { const r = await pool.query('SELECT * FROM stripe_accounts WHERE id=$1', [id]); return r.rows[0]; },
  default: async () => { const r = await pool.query('SELECT * FROM stripe_accounts WHERE is_default=true LIMIT 1'); if (r.rows[0]) return r.rows[0]; const r2 = await pool.query('SELECT * FROM stripe_accounts ORDER BY created_at ASC LIMIT 1'); return r2.rows[0]; },
  create: async (data) => { const count = await pool.query('SELECT COUNT(*) FROM stripe_accounts'); const isDefault = parseInt(count.rows[0].count) === 0; const r = await pool.query('INSERT INTO stripe_accounts (name,secret_key,webhook_secret,is_default) VALUES ($1,$2,$3,$4) RETURNING id', [data.name, data.secret_key, data.webhook_secret || '', isDefault]); return r.rows[0]; },
  setDefault: async (id) => { await pool.query('UPDATE stripe_accounts SET is_default=false'); await pool.query('UPDATE stripe_accounts SET is_default=true WHERE id=$1', [id]); },
  delete: async (id) => { await pool.query('DELETE FROM stripe_accounts WHERE id=$1', [id]); },
};
const customers = {
  all: async () => { const r = await pool.query(`SELECT c.*, sa.name as account_name, COUNT(CASE WHEN s.status='active' THEN 1 END) as active_subs, COALESCE(SUM(CASE WHEN p.status='succeeded' THEN p.amount ELSE 0 END),0) as total_paid FROM customers c LEFT JOIN stripe_accounts sa ON sa.id=c.stripe_account_id LEFT JOIN subscriptions s ON s.customer_id=c.id LEFT JOIN payments p ON p.customer_id=c.id GROUP BY c.id, sa.name ORDER BY c.created_at DESC`); return r.rows; },
  byId: async (id) => { const r = await pool.query('SELECT * FROM customers WHERE id=$1', [id]); return r.rows[0]; },
  byStripeId: async (sid) => { const r = await pool.query('SELECT * FROM customers WHERE stripe_customer_id=$1', [sid]); return r.rows[0]; },
  upsert: async (data) => { await pool.query(`INSERT INTO customers (email,name,stripe_customer_id,stripe_payment_method,stripe_account_id,card_brand,card_last4,card_exp_month,card_exp_year) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (stripe_customer_id) DO UPDATE SET stripe_payment_method=EXCLUDED.stripe_payment_method, stripe_account_id=EXCLUDED.stripe_account_id, card_brand=EXCLUDED.card_brand, card_last4=EXCLUDED.card_last4, card_exp_month=EXCLUDED.card_exp_month, card_exp_year=EXCLUDED.card_exp_year`, [data.email, data.name, data.stripe_customer_id, data.stripe_payment_method, data.stripe_account_id||null, data.card_brand, data.card_last4, data.card_exp_month, data.card_exp_year]); },
  updateStatus: async (id, status) => { await pool.query('UPDATE customers SET status=$1 WHERE id=$2', [status, id]); },
  updateNote: async (id, note) => { await pool.query('UPDATE customers SET note=$1 WHERE id=$2', [note, id]); },
  stats: async () => { const r = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='active' THEN 1 END) as active, COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_30d, COUNT(CASE WHEN status='cancelled' AND created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as churned_30d FROM customers`); return r.rows[0]; },
};
const subscriptions = {
  all: async () => { const r = await pool.query(`SELECT s.*, c.email, c.name, c.card_brand, c.card_last4, c.stripe_account_id, sa.name as account_name FROM subscriptions s JOIN customers c ON c.id=s.customer_id LEFT JOIN stripe_accounts sa ON sa.id=c.stripe_account_id ORDER BY s.next_billing_date ASC`); return r.rows; },
  byCustomer: async (cid) => { const r = await pool.query('SELECT * FROM subscriptions WHERE customer_id=$1', [cid]); return r.rows; },
  due: async () => { const r = await pool.query(`SELECT s.*, c.stripe_customer_id, c.stripe_payment_method, c.email, c.name, c.stripe_account_id, sa.secret_key as stripe_secret_key FROM subscriptions s JOIN customers c ON c.id=s.customer_id LEFT JOIN stripe_accounts sa ON sa.id=c.stripe_account_id WHERE s.status='active' AND c.status='active' AND s.next_billing_date <= CURRENT_DATE`); return r.rows; },
  dunningDue: async () => { const r = await pool.query(`SELECT s.*, c.stripe_customer_id, c.stripe_payment_method, c.email, c.name, c.stripe_account_id, sa.secret_key as stripe_secret_key FROM subscriptions s JOIN customers c ON c.id=s.customer_id LEFT JOIN stripe_accounts sa ON sa.id=c.stripe_account_id WHERE s.status='dunning' AND c.status='active' AND s.next_billing_date <= CURRENT_DATE`); return r.rows; },
  resumeDue: async () => { const r = await pool.query(`SELECT * FROM subscriptions WHERE status='paused' AND resume_date IS NOT NULL AND resume_date <= CURRENT_DATE`); return r.rows; },
  create: async (data) => { await pool.query('INSERT INTO subscriptions (customer_id,amount,currency,interval_days,next_billing_date) VALUES ($1,$2,$3,$4,$5)', [data.customer_id, data.amount, data.currency, data.interval_days, data.next_billing_date]); },
  advanceBillingDate: async (id, days) => { await pool.query("UPDATE subscriptions SET next_billing_date=next_billing_date+$1*INTERVAL '1 day', dunning_count=0, last_failed_at=NULL WHERE id=$2", [days, id]); },
  updateStatus: async (id, status) => { await pool.query('UPDATE subscriptions SET status=$1 WHERE id=$2', [status, id]); },
  updateAmount: async (id, amount) => { await pool.query('UPDATE subscriptions SET amount=$1 WHERE id=$2', [amount, id]); },
  setResumeDate: async (id, date) => { await pool.query('UPDATE subscriptions SET resume_date=$1 WHERE id=$2', [date, id]); },
  markDunning: async (id, retryDate) => { await pool.query("UPDATE subscriptions SET status='dunning', next_billing_date=$1, dunning_count=dunning_count+1, last_failed_at=NOW() WHERE id=$2", [retryDate, id]); },
};
const payments = {
  recent: async (limit=50) => { const r = await pool.query(`SELECT p.*, COALESCE(c.email, '') AS email, COALESCE(c.name, 'Stripe Customer') AS name, COALESCE(p.card_brand,c.card_brand) AS card_brand, COALESCE(p.card_last4,c.card_last4) AS card_last4 FROM payments p LEFT JOIN customers c ON c.id=p.customer_id ORDER BY p.created_at DESC LIMIT $1`, [limit]); return r.rows; },
  byCustomer: async (cid) => { const r = await pool.query('SELECT * FROM payments WHERE customer_id=$1 ORDER BY created_at DESC', [cid]); return r.rows; },
  stats: async () => { const r = await pool.query(`SELECT COUNT(CASE WHEN status='succeeded' THEN 1 END) as succeeded_count, COUNT(CASE WHEN status='failed' THEN 1 END) as failed_count, COALESCE(SUM(CASE WHEN status='succeeded' THEN amount ELSE 0 END),0) as total_revenue, COUNT(CASE WHEN status='succeeded' AND created_at >= NOW()-INTERVAL '30 days' THEN 1 END) as count_30d, COALESCE(SUM(CASE WHEN status='succeeded' AND created_at >= NOW()-INTERVAL '30 days' THEN amount ELSE 0 END),0) as revenue_30d FROM payments`); return r.rows[0]; },
  insert: async (data) => { await pool.query('INSERT INTO payments (customer_id,subscription_id,stripe_payment_intent,amount,currency,status,failure_reason,card_brand,card_last4,card_exp_month,card_exp_year,card_country,card_funding) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [data.customer_id, data.subscription_id, data.stripe_payment_intent, data.amount, data.currency, data.status, data.failure_reason, data.card_brand||null, data.card_last4||null, data.card_exp_month||null, data.card_exp_year||null, data.card_country||null, data.card_funding||null]); },
};
const activityLog = {
  add: async (type, description, customer_id=null, amount=null) => { await pool.query('INSERT INTO activity_log (type,description,customer_id,amount) VALUES ($1,$2,$3,$4)', [type, description, customer_id, amount]).catch(()=>{}); },
  recent: async (limit=50) => { const r = await pool.query('SELECT a.*, c.name as customer_name, c.email FROM activity_log a LEFT JOIN customers c ON c.id=a.customer_id ORDER BY a.created_at DESC LIMIT $1', [limit]); return r.rows; },
};
const webhookLogs = {
  add: async (data) => { await pool.query('INSERT INTO webhook_logs (event_type,account_name,status,error) VALUES ($1,$2,$3,$4)', [data.event_type, data.account_name||null, data.status||'ok', data.error||null]).catch(()=>{}); },
  recent: async (limit=50) => { const r = await pool.query('SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT $1', [limit]); return r.rows; },
};
const security = {
  logAttempt: async (ip, success) => { await pool.query('INSERT INTO login_attempts (ip, success) VALUES ($1,$2)', [ip, success]).catch(()=>{}); },
  recentFailures: async (ip, minutes=15) => { const r = await pool.query("SELECT COUNT(*) FROM login_attempts WHERE ip=$1 AND success=false AND created_at > NOW()-INTERVAL '1 minute'*$2", [ip, minutes]); return parseInt(r.rows[0].count)||0; },
  clearAttempts: async (ip) => { await pool.query('DELETE FROM login_attempts WHERE ip=$1', [ip]).catch(()=>{}); },
  recentLogins: async (limit=20) => { const r = await pool.query('SELECT * FROM login_attempts ORDER BY created_at DESC LIMIT $1', [limit]); return r.rows; },
};
const adminUsers = {
  all: async () => {
    await pool.query("ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'");
    await pool.query('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ');
    const r = await pool.query("SELECT id, username, role, COALESCE(permissions, '[]') as permissions, created_at, last_login FROM admin_users ORDER BY created_at ASC");
    return r.rows;
  },
  byUsername: async (username) => { const r = await pool.query('SELECT * FROM admin_users WHERE username=$1', [username]); return r.rows[0]; },
  create: async (username, password, role='admin', permissions=[]) => { const crypto = require('crypto'); const hash = crypto.createHash('sha256').update(password).digest('hex'); await pool.query('INSERT INTO admin_users (username, password_hash, role, permissions) VALUES ($1,$2,$3,$4)', [username, hash, role, JSON.stringify(permissions)]); },
  delete: async (id) => { await pool.query('DELETE FROM admin_users WHERE id=$1', [id]); },
  updateLastLogin: async (id) => { await pool.query('UPDATE admin_users SET last_login=NOW() WHERE id=$1', [id]); },
  changePassword: async (id, newPassword) => { const crypto = require('crypto'); const hash = crypto.createHash('sha256').update(newPassword).digest('hex'); await pool.query('UPDATE admin_users SET password_hash=$1 WHERE id=$2', [hash, id]); },
  updatePermissions: async (id, permissions) => { await pool.query('UPDATE admin_users SET permissions=$1 WHERE id=$2', [JSON.stringify(permissions), id]); },
  verify: async (username, password) => { const crypto = require('crypto'); const hash = crypto.createHash('sha256').update(password).digest('hex'); const r = await pool.query('SELECT * FROM admin_users WHERE username=$1 AND password_hash=$2', [username, hash]); return r.rows[0] || null; },
};
module.exports = { init, pool, settingsDb, stripeAccounts, customers, subscriptions, payments, activityLog, webhookLogs, security, adminUsers };
