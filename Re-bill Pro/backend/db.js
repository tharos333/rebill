const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false }
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      stripe_customer_id TEXT UNIQUE NOT NULL,
      stripe_payment_method TEXT,
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
  console.log('[db] PostgreSQL tables ready');
}

const customers = {
  all: async () => {
    const r = await pool.query(`
      SELECT c.*, 
        COUNT(CASE WHEN s.status='active' THEN 1 END) as active_subs,
        COALESCE(SUM(CASE WHEN p.status='succeeded' THEN p.amount ELSE 0 END), 0) as total_paid
      FROM customers c
      LEFT JOIN subscriptions s ON s.customer_id = c.id
      LEFT JOIN payments p ON p.customer_id = c.id
      GROUP BY c.id ORDER BY c.created_at DESC
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
      INSERT INTO customers (email, name, stripe_customer_id, stripe_payment_method, card_brand, card_last4, card_exp_month, card_exp_year)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (stripe_customer_id) DO UPDATE SET
        stripe_payment_method=EXCLUDED.stripe_payment_method,
        card_brand=EXCLUDED.card_brand,
        card_last4=EXCLUDED.card_last4,
        card_exp_month=EXCLUDED.card_exp_month,
        card_exp_year=EXCLUDED.card_exp_year
    `, [data.email, data.name, data.stripe_customer_id, data.stripe_payment_method, data.card_brand, data.card_last4, data.card_exp_month, data.card_exp_year]);
  },
  updateStatus: async (id, status) => {
    await pool.query('UPDATE customers SET status=$1 WHERE id=$2', [status, id]);
  },
};

const subscriptions = {
  all: async () => {
    const r = await pool.query(`
      SELECT s.*, c.email, c.name, c.card_brand, c.card_last4
      FROM subscriptions s JOIN customers c ON c.id=s.customer_id
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
      SELECT s.*, c.stripe_customer_id, c.stripe_payment_
