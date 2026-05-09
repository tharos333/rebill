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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_account_id INT').catch(() => {});

  const existing = await pool.query('SELECT COUNT(*) FROM stripe_accounts');
  if (parseInt(existing.rows[0].count) === 0 && process.env.STRIPE_SECRET_KEY) {
    await pool.query(
      'INSERT INTO stripe_accounts (name, secret_key, webhook_secret, is_default) VALUES ($1,$2,$3,true)',
      ['Default Account', process.env.STRIPE_SECRET_KEY, process.env.STRIPE_WEBHOOK_SECRET || '']
    );
    console.log('[db] Default Stripe account created from env');
  }

  console.log('[db] PostgreSQL tables ready');
}

const stripeAccounts = {
  all: async () => {
    const r = await pool.query("SELECT id, name, is_default, created_at, LEFT(secret_key, 12) || '...' as key_preview FROM stripe_accounts ORDER BY created_at ASC");
    return r.rows;
  },
  byId: async (id) => {
    const r = await pool.query('SELECT * FROM stripe_accounts WHERE id=$1', [id]);
    return r.rows[0];
  },
  default: async () => {
    const r = await pool.query('SELECT * FROM stripe_accounts WHERE is_default=true LIMIT 1');
    if (r.rows[0]) return r.rows[0];
    const r2 = await pool.query('SELECT * FROM stripe_accounts ORDER BY created_at ASC LIMIT 1');
    return r2.rows[0];
  },
  create: async (data) => {
    const count = await pool.query('SELECT COUNT(*) FROM stripe_accounts');
    const isDefault = parseInt(count.rows[0].count) === 0;
    const r = await pool.query(
      'INSERT INTO stripe_accounts (name, secret_key, webhook_secret, is_default) VALUES ($1,$2,$3,$4) RETURNING id',
      [data.name, data.secret_key, data.webhook_secret || '', isDefault]
    );
    return r.rows[0];
  },
  setDefault: async (id) => {
    await pool.query('UPDATE stripe_accounts SET is_default=false');
    await pool.query('UPDATE stripe_accounts SET is_default=true WHERE id=$1', [id]);
  },
  delete: async (id) => {
    await pool.query('DELETE FROM stripe_accounts WHERE id=$1', [id]);
  },
  byWebhookSecret: async (secret) => {
    const r = await pool.query('SELECT * FROM stripe_accounts WHERE webhook_secret=$1', [secret]);
    return r.rows[0];
  },
};

const customers = {
  all: async () => {
    const r = await pool.query(`
      SELECT c.*, sa.name as account_name,
        COUNT(CASE WHEN s.status='active' THEN 1 END) as active_subs,
        COALESCE(SUM(CASE WHEN p.status='succeeded' THEN p.amount ELSE 0 END), 0) as total_paid
      FROM customers c
      LEFT JOIN stripe_accounts sa ON sa.id = c.stripe_account_id
      LEFT JOIN subscriptions s ON s.customer_id = c.id
      LEFT JOIN payments p ON p.customer_id = c.id
      GROUP BY c.id, sa.name ORDER BY c.created_at DESC
    `);
    return r.rows;
  },
  byId: async (id) => {
    const r = await pool.query('SELECT * FROM customers WHERE id=$1', [id]);
    return r.rows[0];
  },
  byStripeId: async (stripeId) => {
    const r = await pool.query('SELECT * FROM customers WHERE stripe_customer_id=$1', [stripeId]);
    return r.rows[0];
  },
  upsert: async (data) => {
    await pool.query(`
      INSERT INTO customers (email, name, stripe_customer_id, stripe_payment_method, stripe_account_id, card_brand, card_last4, card_exp_month, card_exp_year)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (stripe_customer_id) DO UPDATE SET
        stripe_payment_method=EXCLUDED.stripe_payment_method,
        stripe_account_id=EXCLUDED.stripe_account_id,
        card_brand=EXCLUDED.card_brand,
        card_last4=EXCLUDED.card_last4,
        card_exp_month=EXCLUDED.card_exp_month,
        card_exp_year=EXCLUDED.card_exp_year
    `, [data.email, data.name, data.stripe_customer_id, data.stripe_payment_method, data.stripe_account_id || null, data.card_brand, data.card_last4, data.card_exp_month, data.card_exp_year]);
  },
  updateStatus: async (id, status) => {
    await pool.query('UPDATE customers SET status=$1 WHERE id=$2', [status, id]);
  },
};

const subscriptions = {
  all: async () => {
    const r = await pool.query(`
      SELECT s.*, c.email, c.name, c.card_brand, c.card_last4, c.stripe_account_id, sa.name as account_name
      FROM subscriptions s
      JOIN customers c ON c.id=s.customer_id
      LEFT JOIN stripe_accounts sa ON sa.id = c.stripe_account_id
      ORDER BY s.next_billing_date ASC
    `);
    return r.rows;
  },
  byCustomer: async (customerId) => {
    const r = await pool.query('SELECT * FROM subscriptions WHERE customer_id=$1', [customerId]);
    return r.rows;
  },
  due: async () => {
    const r = await pool.query(`
      SELECT s.*, c.stripe_customer_id, c.stripe_payment_method, c.email, c.name, c.stripe_account_id,
        sa.secret_key as stripe_secret_key
      FROM subscriptions s
      JOIN customers c ON c.id=s.customer_id
      LEFT JOIN stripe_accounts sa ON sa.id = c.stripe_account_id
      WHERE s.status='active' AND c.status='active' AND s.next_billing_date <= CURRENT_DATE
    `);
    return r.rows;
  },
  create: async (data) => {
    await pool.query(`
      INSERT INTO subscriptions (customer_id, amount, currency, interval_days, next_billing_date)
      VALUES ($1,$2,$3,$4,$5)
    `, [data.customer_id, data.amount, data.currency, data.interval_days, data.next_billing_date]);
  },
  advanceBillingDate: async (id, intervalDays) => {
    await pool.query(`UPDATE subscriptions SET next_billing_date = next_billing_date + $1 * INTERVAL '1 day' WHERE id=$2`, [intervalDays, id]);
  },
  updateStatus: async (id, status) => {
    await pool.query('UPDATE subscriptions SET status=$1 WHERE id=$2', [status, id]);
  },
  updateAmount: async (id, amount) => {
    await pool.query('UPDATE subscriptions SET amount=$1 WHERE id=$2', [amount, id]);
  },
};

const payments = {
  recent: async (limit = 50) => {
    const r = await pool.query(`
      SELECT p.*, c.email, c.name FROM payments p
      JOIN customers c ON c.id=p.customer_id
      ORDER BY p.created_at DESC LIMIT $1
    `, [limit]);
    return r.rows;
  },
  byCustomer: async (customerId) => {
    const r = await pool.query('SELECT * FROM payments WHERE customer_id=$1 ORDER BY created_at DESC', [customerId]);
    return r.rows;
  },
  stats: async () => {
    const r = await pool.query(`
      SELECT
        COUNT(CASE WHEN status='succeeded' THEN 1 END) as succeeded_count,
        COUNT(CASE WHEN status='failed' THEN 1 END) as failed_count,
        COALESCE(SUM(CASE WHEN status='succeeded' THEN amount ELSE 0 END), 0) as total_revenue
      FROM payments
    `);
    return r.rows[0];
  },
  insert: async (data) => {
    await pool.query(`
      INSERT INTO payments (customer_id, subscription_id, stripe_payment_intent, amount, currency, status, failure_reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [data.customer_id, data.subscription_id, data.stripe_payment_intent, data.amount, data.currency, data.status, data.failure_reason]);
  },
};

module.exports = { init, pool, stripeAccounts, customers, subscriptions, payments };
