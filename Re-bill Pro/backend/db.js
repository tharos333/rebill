// db.js — SQLite database setup
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'rebill.db'));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    email                TEXT NOT NULL UNIQUE,
    name                 TEXT,
    stripe_customer_id   TEXT NOT NULL UNIQUE,
    stripe_payment_method TEXT,
    card_brand           TEXT,
    card_last4           TEXT,
    card_exp_month       INTEGER,
    card_exp_year        INTEGER,
    status               TEXT DEFAULT 'active',   -- active | paused | cancelled
    created_at           TEXT DEFAULT (datetime('now')),
    updated_at           TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id          INTEGER NOT NULL REFERENCES customers(id),
    amount               INTEGER NOT NULL,         -- in cents
    currency             TEXT DEFAULT 'usd',
    interval_days        INTEGER DEFAULT 30,
    next_billing_date    TEXT NOT NULL,
    status               TEXT DEFAULT 'active',   -- active | paused | cancelled
    created_at           TEXT DEFAULT (datetime('now')),
    updated_at           TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id           INTEGER NOT NULL REFERENCES customers(id),
    subscription_id       INTEGER REFERENCES subscriptions(id),
    stripe_payment_intent TEXT,
    amount                INTEGER NOT NULL,
    currency              TEXT DEFAULT 'usd',
    status                TEXT NOT NULL,          -- succeeded | failed | pending
    failure_reason        TEXT,
    created_at            TEXT DEFAULT (datetime('now'))
  );
`);

// ── Helpers ───────────────────────────────────────────────────────────────────

const customers = {
  all: () => db.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM subscriptions s WHERE s.customer_id = c.id AND s.status = 'active') AS active_subs,
      (SELECT SUM(amount) FROM payments p WHERE p.customer_id = c.id AND p.status = 'succeeded') AS total_paid
    FROM customers c ORDER BY c.created_at DESC
  `).all(),

  byId: (id) => db.prepare('SELECT * FROM customers WHERE id = ?').get(id),

  byStripeId: (stripeId) => db.prepare('SELECT * FROM customers WHERE stripe_customer_id = ?').get(stripeId),

  upsert: (data) => db.prepare(`
    INSERT INTO customers (email, name, stripe_customer_id, stripe_payment_method, card_brand, card_last4, card_exp_month, card_exp_year)
    VALUES (@email, @name, @stripe_customer_id, @stripe_payment_method, @card_brand, @card_last4, @card_exp_month, @card_exp_year)
    ON CONFLICT(stripe_customer_id) DO UPDATE SET
      stripe_payment_method = excluded.stripe_payment_method,
      card_brand = excluded.card_brand,
      card_last4 = excluded.card_last4,
      card_exp_month = excluded.card_exp_month,
      card_exp_year = excluded.card_exp_year,
      updated_at = datetime('now')
  `).run(data),

  updateStatus: (id, status) => db.prepare(
    'UPDATE customers SET status = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(status, id),
};

const subscriptions = {
  all: () => db.prepare(`
    SELECT s.*, c.email, c.name, c.card_brand, c.card_last4
    FROM subscriptions s JOIN customers c ON c.id = s.customer_id
    ORDER BY s.next_billing_date ASC
  `).all(),

  byCustomer: (customerId) => db.prepare(
    'SELECT * FROM subscriptions WHERE customer_id = ? ORDER BY created_at DESC'
  ).all(customerId),

  due: () => db.prepare(`
    SELECT s.*, c.stripe_customer_id, c.stripe_payment_method, c.email, c.name
    FROM subscriptions s JOIN customers c ON c.id = s.customer_id
    WHERE s.status = 'active' AND c.status = 'active' AND date(s.next_billing_date) <= date('now')
  `).all(),

  create: (data) => db.prepare(`
    INSERT INTO subscriptions (customer_id, amount, currency, interval_days, next_billing_date)
    VALUES (@customer_id, @amount, @currency, @interval_days, @next_billing_date)
  `).run(data),

  advanceBillingDate: (id, intervalDays) => db.prepare(`
    UPDATE subscriptions
    SET next_billing_date = date(next_billing_date, '+' || ? || ' days'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(intervalDays, id),

  updateStatus: (id, status) => db.prepare(
    'UPDATE subscriptions SET status = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(status, id),
};

const payments = {
  recent: (limit = 50) => db.prepare(`
    SELECT p.*, c.email, c.name FROM payments p
    JOIN customers c ON c.id = p.customer_id
    ORDER BY p.created_at DESC LIMIT ?
  `).all(limit),

  byCustomer: (customerId) => db.prepare(
    'SELECT * FROM payments WHERE customer_id = ? ORDER BY created_at DESC'
  ).all(customerId),

  stats: () => db.prepare(`
    SELECT
      COUNT(CASE WHEN status = 'succeeded' THEN 1 END) AS succeeded_count,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed_count,
      SUM(CASE WHEN status = 'succeeded' THEN amount ELSE 0 END) AS total_revenue,
      COUNT(DISTINCT customer_id) AS unique_customers
    FROM payments
  `).get(),

  insert: (data) => db.prepare(`
    INSERT INTO payments (customer_id, subscription_id, stripe_payment_intent, amount, currency, status, failure_reason)
    VALUES (@customer_id, @subscription_id, @stripe_payment_intent, @amount, @currency, @status, @failure_reason)
  `).run(data),
};

module.exports = { db, customers, subscriptions, payments };
