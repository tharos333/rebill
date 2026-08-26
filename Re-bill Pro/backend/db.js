const { Pool } = require('pg');
const crypto = require('crypto');

// Passwords are stored as salted scrypt hashes. Legacy SHA-256 hashes from older
// Subloop builds remain valid and are upgraded automatically after a successful login.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}
function verifyPassword(password, storedHash) {
  const stored = String(storedHash || '');
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 3 || !parts[1] || !parts[2]) return false;
    try {
      const actual = crypto.scryptSync(String(password), parts[1], 64);
      const expected = Buffer.from(parts[2], 'hex');
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch (_err) { return false; }
  }
  // Legacy compatibility only. A successful login is immediately re-hashed with scrypt.
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const legacy = crypto.createHash('sha256').update(String(password)).digest('hex');
    try { return crypto.timingSafeEqual(Buffer.from(legacy, 'hex'), Buffer.from(stored, 'hex')); }
    catch (_err) { return false; }
  }
  return false;
}

function ownerBootstrapConfig() {
  return {
    username: String(process.env.SUBLOOP_OWNER_USERNAME || '').trim(),
    password: String(process.env.SUBLOOP_OWNER_PASSWORD || ''),
    forceReset: /^(1|true|yes|on)$/i.test(String(process.env.SUBLOOP_OWNER_FORCE_RESET || 'false').trim()),
  };
}
function validateBootstrapCredentials(username, password) {
  if (!username || !password) {
    throw new Error('No Owner account exists. Set SUBLOOP_OWNER_USERNAME and SUBLOOP_OWNER_PASSWORD in Railway, then redeploy.');
  }
  if (username.length < 3 || username.length > 80) throw new Error('SUBLOOP_OWNER_USERNAME must be 3-80 characters.');
  if (password.length < 8) throw new Error('SUBLOOP_OWNER_PASSWORD must be at least 8 characters.');
}
function platformAdminBootstrapConfig() {
  return {
    username: String(process.env.SUBLOOP_PLATFORM_ADMIN_USERNAME || '').trim(),
    password: String(process.env.SUBLOOP_PLATFORM_ADMIN_PASSWORD || ''),
    forceReset: /^(1|true|yes|on)$/i.test(String(process.env.SUBLOOP_PLATFORM_ADMIN_FORCE_RESET || 'false').trim()),
  };
}
function validatePlatformAdminCredentials(username, password) {
  if (!username || !password) return false;
  if (username.length < 3 || username.length > 80) throw new Error('SUBLOOP_PLATFORM_ADMIN_USERNAME must be 3-80 characters.');
  if (password.length < 8) throw new Error('SUBLOOP_PLATFORM_ADMIN_PASSWORD must be at least 8 characters.');
  return true;
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false }
});
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      is_main BOOLEAN DEFAULT false,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS workspaces_single_main_idx ON workspaces(is_main) WHERE is_main=true;
    CREATE TABLE IF NOT EXISTS licenses (
      id SERIAL PRIMARY KEY,
      workspace_id INT UNIQUE NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      customer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      plan TEXT NOT NULL,
      starts_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS licenses_status_idx ON licenses(status);
    CREATE INDEX IF NOT EXISTS licenses_expires_idx ON licenses(expires_at);
    CREATE TABLE IF NOT EXISTS platform_admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      last_login TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS stripe_accounts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      publishable_key TEXT,
      webhook_secret TEXT,
      is_default BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS embedded_checkout_sessions (
      id BIGSERIAL PRIMARY KEY,
      plan_token_hash TEXT NOT NULL,
      checkout_reference TEXT NOT NULL,
      stripe_account_id INT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(plan_token_hash, checkout_reference)
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
      paused_by_customer BOOLEAN DEFAULT false,
      status_before_cancel TEXT,
      stripe_subscription_id TEXT,
      stripe_price_id TEXT,
      stripe_invoice_id TEXT,
      dunning_count INT DEFAULT 0,
      last_failed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      ended_at TIMESTAMPTZ
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
      payment_method_type TEXT,
      wallet_type TEXT,
      wallet_checked BOOLEAN DEFAULT FALSE,
      stripe_invoice_id TEXT,
      stripe_fee INT,
      net_amount INT,
      balance_transaction_id TEXT,
      financial_currency TEXT,
      retry_of_payment_id INT REFERENCES payments(id),
      was_failed BOOLEAN DEFAULT false,
      recovered_at TIMESTAMPTZ,
      payment_origin TEXT,
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
      account_scope TEXT DEFAULT 'all',
      allowed_account_ids JSONB DEFAULT '[]'::jsonb,
      two_fa_enabled BOOLEAN DEFAULT false,
      two_fa_secret TEXT,
      two_fa_secret_pending TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_login TIMESTAMPTZ
    );
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS account_scope TEXT DEFAULT 'all';
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS allowed_account_ids JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS two_fa_enabled BOOLEAN DEFAULT false;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS two_fa_secret TEXT;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS two_fa_secret_pending TEXT;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS workspace_id INT;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false;
    CREATE TABLE IF NOT EXISTS login_attempts (
      id SERIAL PRIMARY KEY,
      admin_user_id INT REFERENCES admin_users(id) ON DELETE SET NULL,
      username TEXT,
      ip TEXT,
      success BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS admin_user_id INT REFERENCES admin_users(id) ON DELETE SET NULL;
    ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS username TEXT;
  `);
  const migrations = [
    'ALTER TABLE stripe_accounts ADD COLUMN IF NOT EXISTS workspace_id INT',
    'ALTER TABLE customers ADD COLUMN IF NOT EXISTS workspace_id INT',
    'ALTER TABLE embedded_checkout_sessions ADD COLUMN IF NOT EXISTS workspace_id INT',
    'ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS workspace_id INT',
    'ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS workspace_id INT',
    'ALTER TABLE settings ADD COLUMN IF NOT EXISTS workspace_id INT',
    'ALTER TABLE security ADD COLUMN IF NOT EXISTS workspace_id INT',
    'ALTER TABLE stripe_accounts ADD COLUMN IF NOT EXISTS publishable_key TEXT',
    'ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_account_id INT',
    'ALTER TABLE customers ADD COLUMN IF NOT EXISTS note TEXT',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS resume_date DATE',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paused_by_customer BOOLEAN DEFAULT false',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status_before_cancel TEXT',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_price_id TEXT',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ',
    'ALTER TABLE subscriptions ALTER COLUMN updated_at SET DEFAULT NOW()',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS dunning_count INT DEFAULT 0',
    'ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_brand TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_last4 TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_exp_month INT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_exp_year INT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_country TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_funding TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method_type TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS wallet_type TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS wallet_checked BOOLEAN DEFAULT FALSE',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_fee INT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS net_amount INT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS balance_transaction_id TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS financial_currency TEXT',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS retry_of_payment_id INT REFERENCES payments(id)',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS was_failed BOOLEAN DEFAULT false',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS recovered_at TIMESTAMPTZ',
    'ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_origin TEXT',
  ];
  for (const m of migrations) await pool.query(m).catch(() => {});

  // SaaS workspace foundation. Every record that existed before licensing belongs to
  // Main. This migration is additive and never deletes/recreates existing business data.
  await pool.query(`INSERT INTO workspaces (name,slug,is_main,status)
    VALUES ('Main','main',true,'active') ON CONFLICT (slug) DO NOTHING`);
  const mainWorkspace = (await pool.query("SELECT id FROM workspaces WHERE is_main=true OR slug='main' ORDER BY is_main DESC,id ASC LIMIT 1")).rows[0];
  if (!mainWorkspace) throw new Error('Could not initialize Main workspace');
  const mainWorkspaceId = mainWorkspace.id;
  const workspaceBackfills = [
    ['stripe_accounts','workspace_id'], ['customers','workspace_id'], ['embedded_checkout_sessions','workspace_id'],
    ['activity_log','workspace_id'], ['webhook_logs','workspace_id'], ['settings','workspace_id'], ['security','workspace_id'],
    ['admin_users','workspace_id']
  ];
  for (const [table,column] of workspaceBackfills) {
    await pool.query(`UPDATE ${table} SET ${column}=$1 WHERE ${column} IS NULL`, [mainWorkspaceId]).catch(()=>{});
    // Preserve today's single-workspace behavior for any legacy insert path that has
    // not yet been tenant-aware. Future customer-workspace inserts explicitly override it.
    await pool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${Number(mainWorkspaceId)}`).catch(()=>{});
  }
  // The original Main Owner becomes the installation-level Super Admin. Future
  // customer workspace owners will not receive this flag.
  await pool.query(`UPDATE admin_users SET is_super_admin=true
    WHERE workspace_id=$1 AND role='owner' AND id=(SELECT id FROM admin_users WHERE workspace_id=$1 AND role='owner' ORDER BY id ASC LIMIT 1)`, [mainWorkspaceId]).catch(()=>{});

  // Freeze the terminal lifecycle timestamp once. Reconciliation may update updated_at,
  // but must not make an old canceled subscription appear newer than a later one-time payment.
  await pool.query(`UPDATE subscriptions
    SET ended_at=COALESCE(ended_at,updated_at,created_at)
    WHERE LOWER(COALESCE(status,'')) IN ('canceled','cancelled','incomplete_expired') AND ended_at IS NULL`).catch(()=>{});
  // Owner bootstrap / recovery credentials live in Railway only. They are NOT a
  // source of truth after the Owner has been created: normal password/user/role
  // changes are made in Subloop and persist in PostgreSQL across redeploys.
  const ownerBootstrap = ownerBootstrapConfig();
  let ownerRow = (await pool.query("SELECT id, username FROM admin_users WHERE role='owner' ORDER BY id ASC LIMIT 1")).rows[0];

  if (!ownerRow) {
    validateBootstrapCredentials(ownerBootstrap.username, ownerBootstrap.password);
    const collision = await pool.query(
      'SELECT id FROM admin_users WHERE LOWER(username)=LOWER($1) LIMIT 1',
      [ownerBootstrap.username]
    );
    if (collision.rows[0]) {
      throw new Error('SUBLOOP_OWNER_USERNAME is already used by a non-Owner access user. Choose another username or change that user in Subloop.');
    }
    const inserted = await pool.query(
      "INSERT INTO admin_users (username, password_hash, role, workspace_id, is_super_admin) VALUES ($1, $2, 'owner', $3, true) RETURNING id, username",
      [ownerBootstrap.username, hashPassword(ownerBootstrap.password), mainWorkspaceId]
    );
    ownerRow = inserted.rows[0];
    // Fresh/bootstrap owners enroll their own 2FA inside Subloop; never inherit a
    // legacy shared authenticator secret from older builds.
    await pool.query("UPDATE settings SET value='false', updated_at=NOW() WHERE key='two_fa_enabled'").catch(()=>{});
    await pool.query("UPDATE settings SET value='', updated_at=NOW() WHERE key='two_fa_secret'").catch(()=>{});
    console.log(`[db] Initial Owner created from Railway bootstrap credentials: ${ownerRow.username}`);
  }
  await pool.query("UPDATE admin_users SET workspace_id=$1, is_super_admin=true WHERE id=$2", [mainWorkspaceId, ownerRow.id]).catch(()=>{});

  const defaults = {
    dunning_enabled: 'false', two_fa_enabled: 'false', two_fa_secret: '',
    session_timeout: '480',
    dunning_days: '3,7,14', pause_auto_resume: 'true', proration_enabled: 'false',
    churn_alert_enabled: 'false', bulk_actions_enabled: 'true',
    scheduled_billing_enabled: 'false', webhook_logs_enabled: 'true',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await pool.query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }

  // Optional emergency Owner recovery. This is deliberately inert unless the
  // Railway switch is explicitly enabled. A fingerprint marker means leaving the
  // switch enabled cannot overwrite a password changed later inside Subloop on
  // every deploy. To perform another recovery, change the Railway bootstrap
  // password (or username) and redeploy with FORCE_RESET enabled.
  if (ownerBootstrap.forceReset) {
    validateBootstrapCredentials(ownerBootstrap.username, ownerBootstrap.password);
    const fingerprint = crypto.createHash('sha256')
      .update(`${ownerBootstrap.username}\0${ownerBootstrap.password}`)
      .digest('hex');
    const resetMarkerKey = 'owner_force_reset_fingerprint_v1';
    const marker = (await pool.query('SELECT value FROM settings WHERE key=$1', [resetMarkerKey])).rows[0]?.value || '';
    if (marker !== fingerprint) {
      const collision = await pool.query(
        'SELECT id FROM admin_users WHERE LOWER(username)=LOWER($1) AND id<>$2 LIMIT 1',
        [ownerBootstrap.username, ownerRow.id]
      );
      if (collision.rows[0]) throw new Error('Cannot recover Owner: SUBLOOP_OWNER_USERNAME is already used by another access user.');
      await pool.query(`
        UPDATE admin_users
        SET username=$1,
            password_hash=$2,
            role='owner',
            two_fa_enabled=false,
            two_fa_secret=NULL,
            two_fa_secret_pending=NULL
        WHERE id=$3
      `, [ownerBootstrap.username, hashPassword(ownerBootstrap.password), ownerRow.id]);
      // Recovery must also remove stale 2FA, otherwise an older global 2FA
      // migration could immediately lock the recovered Owner out again.
      await pool.query("UPDATE settings SET value='false', updated_at=NOW() WHERE key='two_fa_enabled'").catch(()=>{});
      await pool.query("UPDATE settings SET value='', updated_at=NOW() WHERE key='two_fa_secret'").catch(()=>{});
      await pool.query(
        'INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()',
        [resetMarkerKey, fingerprint]
      );
      ownerRow.username = ownerBootstrap.username;
      console.log(`[db] Owner credentials recovered once from Railway for ${ownerBootstrap.username}`);
    }
  }
  // One-time migration: preserve any previously shared active 2FA secret on the Owner account only.
  // Other access users must enroll their own authenticator after this migration.
  await pool.query(`
    UPDATE admin_users
    SET two_fa_enabled=true,
        two_fa_secret=(SELECT value FROM settings WHERE key='two_fa_secret'),
        two_fa_secret_pending=NULL
    WHERE role='owner'
      AND COALESCE(two_fa_enabled,false)=false
      AND COALESCE(two_fa_secret,'')=''
      AND COALESCE((SELECT value FROM settings WHERE key='two_fa_enabled'),'false')='true'
      AND COALESCE((SELECT value FROM settings WHERE key='two_fa_secret'),'')<>''
  `).catch(()=>{});
  // A Stripe Customer/Subscription can exist even when the very first payment failed.
  // Keep those records internally for the Payments history, but do not treat them as
  // paying customers or active subscriptions until money has actually succeeded.
  await pool.query(`
    UPDATE customers c
    SET status='pending'
    WHERE LOWER(COALESCE(c.status,''))='active'
      AND EXISTS (SELECT 1 FROM payments p WHERE p.customer_id=c.id)
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.customer_id=c.id AND LOWER(p.status)='succeeded')
  `).catch(()=>{});
  await pool.query(`
    UPDATE subscriptions s
    SET status='incomplete', updated_at=NOW()
    WHERE s.amount > 0
      AND LOWER(COALESCE(s.status,''))='active'
      AND EXISTS (
        SELECT 1 FROM payments p
        WHERE p.customer_id=s.customer_id
          AND (p.subscription_id=s.id OR (s.stripe_invoice_id IS NOT NULL AND p.stripe_invoice_id=s.stripe_invoice_id))
      )
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE LOWER(p.status)='succeeded'
          AND (p.subscription_id=s.id OR (s.stripe_invoice_id IS NOT NULL AND p.stripe_invoice_id=s.stripe_invoice_id))
      )
  `).catch(()=>{});

  // Separate platform-admin account for /admin. This account is not a workspace user.
  // Railway variables bootstrap it once and do not overwrite it unless force reset is enabled.
  const platformBootstrap = platformAdminBootstrapConfig();
  const existingPlatform = (await pool.query('SELECT id, username FROM platform_admins ORDER BY id ASC LIMIT 1')).rows[0];
  if (!existingPlatform && validatePlatformAdminCredentials(platformBootstrap.username, platformBootstrap.password)) {
    await pool.query('INSERT INTO platform_admins (username,password_hash) VALUES ($1,$2)', [platformBootstrap.username, hashPassword(platformBootstrap.password)]);
    console.log(`[db] Platform admin created for ${platformBootstrap.username}`);
  } else if (existingPlatform && platformBootstrap.forceReset && validatePlatformAdminCredentials(platformBootstrap.username, platformBootstrap.password)) {
    await pool.query('UPDATE platform_admins SET username=$1,password_hash=$2,updated_at=NOW() WHERE id=$3', [platformBootstrap.username, hashPassword(platformBootstrap.password), existingPlatform.id]);
    console.log(`[db] Platform admin credentials force-reset for ${platformBootstrap.username}`);
  }

  const existing = await pool.query('SELECT COUNT(*) FROM stripe_accounts');
  if (parseInt(existing.rows[0].count) === 0 && process.env.STRIPE_SECRET_KEY) {
    await pool.query('INSERT INTO stripe_accounts (name,secret_key,publishable_key,webhook_secret,is_default) VALUES ($1,$2,$3,$4,true)',
      ['Default Account', process.env.STRIPE_SECRET_KEY, process.env.STRIPE_PUBLISHABLE_KEY || '', process.env.STRIPE_WEBHOOK_SECRET || '']);
  }
  console.log('[db] PostgreSQL ready');
}
const settingsDb = {
  get: async (key) => { const r = await pool.query('SELECT value FROM settings WHERE key=$1', [key]); return r.rows[0]?.value; },
  getAll: async () => { const r = await pool.query('SELECT key, value FROM settings ORDER BY key'); return Object.fromEntries(r.rows.map(r => [r.key, r.value])); },
  set: async (key, value) => { await pool.query('INSERT INTO settings (key,value,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()', [key, value]); },
};
const stripeAccounts = {
  all: async () => { const r = await pool.query("SELECT id, name, is_default, created_at, LEFT(secret_key,12)||'...' as key_preview, CASE WHEN COALESCE(publishable_key,'')<>'' THEN LEFT(publishable_key,12)||'...' ELSE NULL END as publishable_key_preview, COALESCE(publishable_key,'')<>'' AS has_publishable_key FROM stripe_accounts ORDER BY created_at DESC, id DESC"); return r.rows; },
  byId: async (id) => { const r = await pool.query('SELECT * FROM stripe_accounts WHERE id=$1', [id]); return r.rows[0]; },
  default: async () => { const r = await pool.query('SELECT * FROM stripe_accounts WHERE is_default=true LIMIT 1'); if (r.rows[0]) return r.rows[0]; const r2 = await pool.query('SELECT * FROM stripe_accounts ORDER BY created_at ASC LIMIT 1'); return r2.rows[0]; },
  create: async (data) => { const count = await pool.query('SELECT COUNT(*) FROM stripe_accounts'); const isDefault = parseInt(count.rows[0].count) === 0; const r = await pool.query('INSERT INTO stripe_accounts (name,secret_key,publishable_key,webhook_secret,is_default) VALUES ($1,$2,$3,$4,$5) RETURNING id', [data.name, data.secret_key, data.publishable_key || '', data.webhook_secret || '', isDefault]); return r.rows[0]; },
  setDefault: async (id) => { await pool.query('UPDATE stripe_accounts SET is_default=false'); await pool.query('UPDATE stripe_accounts SET is_default=true WHERE id=$1', [id]); },
  delete: async (id) => { await pool.query('DELETE FROM stripe_accounts WHERE id=$1', [id]); },
};
const customers = {
  all: async () => { const r = await pool.query(`
    WITH sub_stats AS (
      SELECT customer_id,
        COUNT(*) FILTER (WHERE LOWER(status) IN ('active','trialing','past_due','unpaid','canceling','paused')) as current_subs,
        COUNT(*) FILTER (WHERE LOWER(status)='active') as active_subs,
        COUNT(*) FILTER (WHERE LOWER(status)='paused') as paused_subs,
        COUNT(*) FILTER (WHERE LOWER(status)='paused' AND COALESCE(paused_by_customer,false)=true) as customer_paused_subs,
        COUNT(*) FILTER (WHERE LOWER(status)='canceling') as canceling_subs,
        COUNT(*) FILTER (WHERE LOWER(status)='trialing') as trialing_subs,
        COUNT(*) FILTER (WHERE LOWER(status)='past_due') as past_due_subs,
        COUNT(*) FILTER (WHERE LOWER(status)='unpaid') as unpaid_subs,
        COUNT(*) as historical_subs,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) NOT IN ('incomplete','incomplete_expired','pending')) as relationship_subs,
        MAX(CASE
          WHEN LOWER(COALESCE(status,'')) IN ('incomplete','incomplete_expired','pending') THEN NULL
          WHEN LOWER(COALESCE(status,'')) IN ('canceled','cancelled') THEN COALESCE(ended_at,updated_at,created_at)
          ELSE COALESCE(updated_at,created_at)
        END) as last_subscription_activity_at
      FROM subscriptions
      GROUP BY customer_id
    ),
    pay_stats AS (
      SELECT
        customer_id,
        COALESCE(SUM(CASE WHEN status='succeeded' THEN amount ELSE 0 END), 0) as total_paid,
        MAX(CASE WHEN status='succeeded' THEN created_at END) as last_payment_at,
        MAX(CASE WHEN status='succeeded' AND (payment_origin='one_time' OR (subscription_id IS NULL AND stripe_invoice_id IS NULL)) THEN created_at END) as last_one_time_payment_at,
        MAX(created_at) as last_any_payment_at
      FROM payments
      GROUP BY customer_id
    )
    SELECT
      c.*,
      sa.name as account_name,
      COALESCE((
        SELECT jsonb_object_agg(ct.currency, ct.total)
        FROM (
          SELECT LOWER(COALESCE(pp.currency,'usd')) AS currency, SUM(pp.amount)::bigint AS total
          FROM payments pp
          WHERE pp.customer_id=c.id AND LOWER(pp.status)='succeeded'
          GROUP BY LOWER(COALESCE(pp.currency,'usd'))
        ) ct
      ), '{}'::jsonb) as currency_totals,
      COALESCE(s.current_subs, 0) as current_subs,
      COALESCE(s.active_subs, 0) as active_subs,
      COALESCE(s.paused_subs, 0) as paused_subs,
      COALESCE(s.customer_paused_subs, 0) as customer_paused_subs,
      COALESCE(s.canceling_subs, 0) as canceling_subs,
      COALESCE(s.trialing_subs, 0) as trialing_subs,
      COALESCE(s.past_due_subs, 0) as past_due_subs,
      COALESCE(s.unpaid_subs, 0) as unpaid_subs,
      COALESCE(s.historical_subs, 0) as historical_subs,
      COALESCE(s.relationship_subs, 0) as relationship_subs,
      s.last_subscription_activity_at,
      COALESCE(p.total_paid, 0) as total_paid,
      p.last_payment_at,
      p.last_one_time_payment_at,
      p.last_any_payment_at,
      COALESCE(p.last_payment_at, c.created_at) as sort_date,
      pm.payment_method_type as primary_payment_method_type,
      pm.wallet_type as primary_wallet_type,
      COALESCE(pm.card_brand, c.card_brand) as primary_card_brand,
      COALESCE(pm.card_last4, c.card_last4) as primary_card_last4,
      COALESCE(pm.card_exp_month, c.card_exp_month) as primary_card_exp_month,
      COALESCE(pm.card_exp_year, c.card_exp_year) as primary_card_exp_year,
      pm.card_country as primary_card_country,
      pm.card_funding as primary_card_funding
    FROM customers c
    LEFT JOIN stripe_accounts sa ON sa.id = c.stripe_account_id
    LEFT JOIN sub_stats s ON s.customer_id = c.id
    LEFT JOIN pay_stats p ON p.customer_id = c.id
    LEFT JOIN LATERAL (
      SELECT payment_method_type, wallet_type, card_brand, card_last4, card_exp_month, card_exp_year, card_country, card_funding
      FROM payments
      WHERE customer_id=c.id
        AND (payment_method_type IS NOT NULL OR wallet_type IS NOT NULL OR card_brand IS NOT NULL OR card_last4 IS NOT NULL)
      ORDER BY CASE WHEN status='succeeded' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1
    ) pm ON true
    WHERE LOWER(COALESCE(c.status,'')) <> 'pending'
      AND NOT (
        COALESCE(p.total_paid, 0) = 0
        AND (
          COALESCE(c.email, '') ILIKE '%@stripe.local'
          OR COALESCE(c.stripe_customer_id, '') LIKE 'external_%'
          OR COALESCE(c.name, '') LIKE 'pi_%'
        )
      )
    ORDER BY
      CASE WHEN p.last_payment_at IS NOT NULL THEN 0 ELSE 1 END ASC,
      p.last_payment_at DESC NULLS LAST,
      COALESCE(p.total_paid, 0) DESC,
      c.created_at DESC
  `); return r.rows; },
  byId: async (id) => { const r = await pool.query('SELECT * FROM customers WHERE id=$1', [id]); return r.rows[0]; },
  byStripeId: async (sid) => { const r = await pool.query('SELECT * FROM customers WHERE stripe_customer_id=$1', [sid]); return r.rows[0]; },
  upsert: async (data) => { await pool.query(`INSERT INTO customers (email,name,stripe_customer_id,stripe_payment_method,stripe_account_id,card_brand,card_last4,card_exp_month,card_exp_year) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (stripe_customer_id) DO UPDATE SET stripe_payment_method=EXCLUDED.stripe_payment_method, stripe_account_id=EXCLUDED.stripe_account_id, card_brand=EXCLUDED.card_brand, card_last4=EXCLUDED.card_last4, card_exp_month=EXCLUDED.card_exp_month, card_exp_year=EXCLUDED.card_exp_year`, [data.email, data.name, data.stripe_customer_id, data.stripe_payment_method, data.stripe_account_id||null, data.card_brand, data.card_last4, data.card_exp_month, data.card_exp_year]); },
  updateStatus: async (id, status) => { await pool.query('UPDATE customers SET status=$1 WHERE id=$2', [status, id]); },
  updateNote: async (id, note) => { await pool.query('UPDATE customers SET note=$1 WHERE id=$2', [note, id]); },
  detail: async (id) => {
    const customerRes = await pool.query(`
      WITH sub_stats AS (
        SELECT customer_id,
          COUNT(*) FILTER (WHERE LOWER(status) IN ('active','trialing','past_due','unpaid','canceling','paused')) as current_subs,
          COUNT(*) FILTER (WHERE LOWER(status)='active') as active_subs,
          COUNT(*) FILTER (WHERE LOWER(status)='paused') as paused_subs,
          COUNT(*) FILTER (WHERE LOWER(status)='paused' AND COALESCE(paused_by_customer,false)=true) as customer_paused_subs,
          COUNT(*) FILTER (WHERE LOWER(status)='canceling') as canceling_subs,
          COUNT(*) FILTER (WHERE LOWER(status)='trialing') as trialing_subs,
          COUNT(*) FILTER (WHERE LOWER(status)='past_due') as past_due_subs,
          COUNT(*) FILTER (WHERE LOWER(status)='unpaid') as unpaid_subs,
          COUNT(*) as total_subs,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) NOT IN ('incomplete','incomplete_expired','pending')) as relationship_subs,
          MAX(CASE
            WHEN LOWER(COALESCE(status,'')) IN ('incomplete','incomplete_expired','pending') THEN NULL
            WHEN LOWER(COALESCE(status,'')) IN ('canceled','cancelled') THEN COALESCE(ended_at,updated_at,created_at)
            ELSE COALESCE(updated_at,created_at)
          END) as last_subscription_activity_at,
          MIN(next_billing_date) FILTER (WHERE LOWER(status) IN ('active','trialing','past_due')) as next_billing_date
        FROM subscriptions
        WHERE customer_id=$1
        GROUP BY customer_id
      ),
      pay_stats AS (
        SELECT customer_id,
          COALESCE(SUM(CASE WHEN status='succeeded' THEN amount ELSE 0 END),0) as total_paid,
          COUNT(*) FILTER (WHERE status='succeeded') as successful_payments,
          COUNT(*) FILTER (WHERE status='failed') as failed_payments,
          AVG(amount) FILTER (WHERE status='succeeded') as avg_payment,
          MAX(created_at) FILTER (WHERE status='succeeded' AND (payment_origin='one_time' OR (subscription_id IS NULL AND stripe_invoice_id IS NULL))) as last_one_time_payment_at
        FROM payments
        WHERE customer_id=$1
        GROUP BY customer_id
      )
      SELECT c.*, sa.name as account_name,
        COALESCE((
        SELECT jsonb_object_agg(ct.currency, ct.total)
        FROM (
          SELECT LOWER(COALESCE(pp.currency,'usd')) AS currency, SUM(pp.amount)::bigint AS total
          FROM payments pp
          WHERE pp.customer_id=c.id AND LOWER(pp.status)='succeeded'
          GROUP BY LOWER(COALESCE(pp.currency,'usd'))
        ) ct
      ), '{}'::jsonb) as currency_totals,
        COALESCE(ss.current_subs,0) as current_subs,
        COALESCE(ss.active_subs,0) as active_subs,
        COALESCE(ss.paused_subs,0) as paused_subs,
        COALESCE(ss.customer_paused_subs,0) as customer_paused_subs,
        COALESCE(ss.canceling_subs,0) as canceling_subs,
        COALESCE(ss.trialing_subs,0) as trialing_subs,
        COALESCE(ss.past_due_subs,0) as past_due_subs,
        COALESCE(ss.unpaid_subs,0) as unpaid_subs,
        COALESCE(ss.total_subs,0) as total_subs,
        COALESCE(ss.relationship_subs,0) as relationship_subs,
        ss.last_subscription_activity_at,
        ss.next_billing_date,
        COALESCE(ps.total_paid,0) as total_paid,
        COALESCE(ps.successful_payments,0) as successful_payments,
        COALESCE(ps.failed_payments,0) as failed_payments,
        COALESCE(ps.avg_payment,0) as avg_payment,
        ps.last_one_time_payment_at,
        lp.amount as last_payment_amount,
        lp.currency as last_payment_currency,
        lp.created_at as last_payment_at,
        lp.status as last_payment_status,
        pm.payment_method_type as primary_payment_method_type,
        pm.wallet_type as primary_wallet_type,
        COALESCE(pm.card_brand, c.card_brand) as primary_card_brand,
        COALESCE(pm.card_last4, c.card_last4) as primary_card_last4,
        COALESCE(pm.card_exp_month, c.card_exp_month) as primary_card_exp_month,
        COALESCE(pm.card_exp_year, c.card_exp_year) as primary_card_exp_year,
        pm.card_country as primary_card_country,
        pm.card_funding as primary_card_funding,
        pm.card_country as card_country,
        pm.card_funding as card_funding
      FROM customers c
      LEFT JOIN stripe_accounts sa ON sa.id=c.stripe_account_id
      LEFT JOIN sub_stats ss ON ss.customer_id=c.id
      LEFT JOIN pay_stats ps ON ps.customer_id=c.id
      LEFT JOIN LATERAL (
        SELECT amount, currency, created_at, status
        FROM payments
        WHERE customer_id=c.id
          AND status='succeeded'
        ORDER BY created_at DESC
        LIMIT 1
      ) lp ON true
      LEFT JOIN LATERAL (
        SELECT payment_method_type, wallet_type, card_brand, card_last4, card_exp_month, card_exp_year, card_country, card_funding
        FROM payments
        WHERE customer_id=c.id
          AND (payment_method_type IS NOT NULL OR wallet_type IS NOT NULL OR card_brand IS NOT NULL OR card_last4 IS NOT NULL)
        ORDER BY CASE WHEN status='succeeded' THEN 0 ELSE 1 END, created_at DESC
        LIMIT 1
      ) pm ON true
      WHERE c.id=$1
      LIMIT 1
    `,[id]);

    // Customer drawer activity must not hide older orders behind a small recent-payment cap.
    // Return the complete payment history for this customer, newest first. The drawer itself
    // is already scrollable, so every successful order and failed attempt remains inspectable.
    const recentRes = await pool.query(`
      SELECT id, amount, currency, status, failure_reason, created_at
      FROM payments
      WHERE customer_id=$1
      ORDER BY created_at DESC, id DESC
    `,[id]);

    return { customer: customerRes.rows[0] || null, recent_payments: recentRes.rows };
  },
  stats: async () => { const r = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='active' THEN 1 END) as active, COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_30d, COUNT(CASE WHEN status='cancelled' AND created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as churned_30d FROM customers`); return r.rows[0]; },
};
const subscriptions = {
  all: async () => { const r = await pool.query(`
    WITH sub_pay_stats AS (
      SELECT
        subscription_id,
        MAX(CASE WHEN status='succeeded' THEN created_at END) as last_subscription_payment_at,
        MAX(created_at) as last_subscription_attempt_at
      FROM payments
      WHERE subscription_id IS NOT NULL
      GROUP BY subscription_id
    ),
    customer_pay_stats AS (
      SELECT
        customer_id,
        MAX(CASE WHEN status='succeeded' THEN created_at END) as last_customer_payment_at,
        MAX(created_at) as last_customer_attempt_at
      FROM payments
      GROUP BY customer_id
    )
    SELECT
      s.*,
      c.email,
      c.name,
      c.card_brand,
      c.card_last4,
      c.stripe_account_id,
      sa.name as account_name,
      COALESCE(
        sp.last_subscription_payment_at,
        cp.last_customer_payment_at,
        sp.last_subscription_attempt_at,
        cp.last_customer_attempt_at,
        s.created_at
      ) as order_sort_date
    FROM subscriptions s
    JOIN customers c ON c.id=s.customer_id
    LEFT JOIN stripe_accounts sa ON sa.id=c.stripe_account_id
    LEFT JOIN sub_pay_stats sp ON sp.subscription_id=s.id
    LEFT JOIN customer_pay_stats cp ON cp.customer_id=s.customer_id
    WHERE LOWER(COALESCE(c.status,'')) <> 'pending'
      AND LOWER(COALESCE(s.status,'')) NOT IN ('incomplete','incomplete_expired','pending')
    ORDER BY
      order_sort_date DESC NULLS LAST,
      s.created_at DESC,
      s.id DESC
  `); return r.rows; },
  byCustomer: async (cid) => { const r = await pool.query('SELECT * FROM subscriptions WHERE customer_id=$1', [cid]); return r.rows; },
  due: async () => { const r = await pool.query(`SELECT s.*, c.stripe_customer_id, c.stripe_payment_method, c.email, c.name, c.stripe_account_id, sa.secret_key as stripe_secret_key FROM subscriptions s JOIN customers c ON c.id=s.customer_id LEFT JOIN stripe_accounts sa ON sa.id=c.stripe_account_id WHERE s.status='active' AND c.status='active' AND s.next_billing_date <= CURRENT_DATE`); return r.rows; },
  dunningDue: async () => [], // Legacy compatibility only; Stripe Billing owns renewal retries.
  resumeDue: async () => { const r = await pool.query(`SELECT * FROM subscriptions WHERE status='paused' AND resume_date IS NOT NULL AND resume_date <= CURRENT_DATE`); return r.rows; },
  create: async (data) => { await pool.query('INSERT INTO subscriptions (customer_id,amount,currency,interval_days,next_billing_date) VALUES ($1,$2,$3,$4,$5)', [data.customer_id, data.amount, data.currency, data.interval_days, data.next_billing_date]); },
  advanceBillingDate: async () => false, // Disabled: Stripe Billing owns the subscription schedule.
  updateStatus: async (id, status) => { await pool.query("UPDATE subscriptions SET status=$1, ended_at=CASE WHEN LOWER($1) IN ('canceled','cancelled','incomplete_expired') THEN COALESCE(ended_at,NOW()) ELSE NULL END, updated_at=NOW() WHERE id=$2", [status, id]); },
  updateAmount: async (id, amount) => { await pool.query('UPDATE subscriptions SET amount=$1, updated_at=NOW() WHERE id=$2', [amount, id]); },
  setResumeDate: async (id, date) => { await pool.query('UPDATE subscriptions SET resume_date=$1, updated_at=NOW() WHERE id=$2', [date, id]); },
  setPausedByCustomer: async (id, value) => { await pool.query('UPDATE subscriptions SET paused_by_customer=$1, updated_at=NOW() WHERE id=$2', [!!value, id]); },
  setStatusBeforeCancel: async (id, status) => { await pool.query('UPDATE subscriptions SET status_before_cancel=$1, updated_at=NOW() WHERE id=$2', [status || null, id]); },
  markDunning: async () => false, // Disabled: Stripe Billing owns retries/dunning.
};
const payments = {
  recent: async (limit=50) => { const r = await pool.query('SELECT p.*, c.email, c.name, c.stripe_account_id, COALESCE(p.card_brand,c.card_brand) AS card_brand, COALESCE(p.card_last4,c.card_last4) AS card_last4, sa.name AS account_name FROM payments p JOIN customers c ON c.id=p.customer_id LEFT JOIN stripe_accounts sa ON sa.id=c.stripe_account_id ORDER BY p.created_at DESC LIMIT $1', [limit]); return r.rows; },
  byCustomer: async (cid) => { const r = await pool.query('SELECT * FROM payments WHERE customer_id=$1 ORDER BY created_at DESC', [cid]); return r.rows; },
  stats: async () => { const r = await pool.query(`SELECT COUNT(CASE WHEN status='succeeded' THEN 1 END) as succeeded_count, COUNT(CASE WHEN status='failed' THEN 1 END) as failed_count, COALESCE(SUM(CASE WHEN status='succeeded' THEN amount ELSE 0 END),0) as total_revenue, COUNT(CASE WHEN status='succeeded' AND created_at >= NOW()-INTERVAL '30 days' THEN 1 END) as count_30d, COALESCE(SUM(CASE WHEN status='succeeded' AND created_at >= NOW()-INTERVAL '30 days' THEN amount ELSE 0 END),0) as revenue_30d FROM payments`); return r.rows[0]; },
  insert: async (data) => { await pool.query('INSERT INTO payments (customer_id,subscription_id,stripe_payment_intent,amount,currency,status,failure_reason,card_brand,card_last4,card_exp_month,card_exp_year,card_country,card_funding,stripe_invoice_id,stripe_fee,net_amount,balance_transaction_id,financial_currency,retry_of_payment_id,was_failed,recovered_at,payment_origin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)', [data.customer_id, data.subscription_id, data.stripe_payment_intent, data.amount, data.currency, data.status, data.failure_reason, data.card_brand||null, data.card_last4||null, data.card_exp_month||null, data.card_exp_year||null, data.card_country||null, data.card_funding||null, data.stripe_invoice_id||null, data.stripe_fee??null, data.net_amount??null, data.balance_transaction_id||null, data.financial_currency||null, data.retry_of_payment_id||null, data.was_failed ?? (data.status==='failed'), data.recovered_at||null, data.payment_origin||null]); },
};
const activityLog = {
  add: async (type, description, customer_id=null, amount=null) => { await pool.query('INSERT INTO activity_log (type,description,customer_id,amount) VALUES ($1,$2,$3,$4)', [type, description, customer_id, amount]).catch(()=>{}); },
  recent: async (limit=50) => { const r = await pool.query('SELECT a.*, c.name as customer_name, c.email, c.stripe_account_id FROM activity_log a LEFT JOIN customers c ON c.id=a.customer_id ORDER BY a.created_at DESC LIMIT $1', [limit]); return r.rows; },
};
const webhookLogs = {
  add: async (data) => { await pool.query('INSERT INTO webhook_logs (event_type,account_name,status,error) VALUES ($1,$2,$3,$4)', [data.event_type, data.account_name||null, data.status||'ok', data.error||null]).catch(()=>{}); },
  recent: async (limit=50) => { const r = await pool.query('SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT $1', [limit]); return r.rows; },
};
const security = {
  logAttempt: async (ip, success, adminUserId=null, username=null) => {
    await pool.query('INSERT INTO login_attempts (admin_user_id, username, ip, success) VALUES ($1,$2,$3,$4)', [adminUserId, username, ip, success]).catch(()=>{});
  },
  recentLoginsForUser: async (adminUserId, limit=20) => {
    const r = await pool.query('SELECT id, ip, success, created_at FROM login_attempts WHERE admin_user_id=$1 ORDER BY created_at DESC LIMIT $2', [adminUserId, limit]);
    return r.rows;
  },
};
const adminUsers = {
  all: async () => {
    const r = await pool.query("SELECT id, username, role, COALESCE(permissions, '[]') as permissions, COALESCE(account_scope,'all') AS account_scope, COALESCE(allowed_account_ids,'[]') AS allowed_account_ids, COALESCE(two_fa_enabled,false) AS two_fa_enabled, workspace_id, COALESCE(is_super_admin,false) AS is_super_admin, created_at, last_login FROM admin_users ORDER BY created_at ASC");
    return r.rows;
  },
  byId: async (id) => { const r = await pool.query("SELECT id, username, role, COALESCE(permissions,'[]') AS permissions, COALESCE(account_scope,'all') AS account_scope, COALESCE(allowed_account_ids,'[]') AS allowed_account_ids, COALESCE(two_fa_enabled,false) AS two_fa_enabled, workspace_id, COALESCE(is_super_admin,false) AS is_super_admin, created_at, last_login FROM admin_users WHERE id=$1", [id]); return r.rows[0]; },
  byUsername: async (username) => { const r = await pool.query('SELECT * FROM admin_users WHERE LOWER(username)=LOWER($1)', [username]); return r.rows[0]; },
  create: async (username, password, role='admin', permissions=[], accountScope='all', allowedAccountIds=[]) => {
    const hash = hashPassword(password);
    await pool.query('INSERT INTO admin_users (username, password_hash, role, permissions, account_scope, allowed_account_ids) VALUES ($1,$2,$3,$4,$5,$6)', [username, hash, role, JSON.stringify(permissions), accountScope, JSON.stringify(allowedAccountIds)]);
  },
  delete: async (id) => { await pool.query('DELETE FROM admin_users WHERE id=$1', [id]); },
  updateLastLogin: async (id) => { await pool.query('UPDATE admin_users SET last_login=NOW() WHERE id=$1', [id]); },
  changePassword: async (id, newPassword) => { const hash = hashPassword(newPassword); await pool.query('UPDATE admin_users SET password_hash=$1 WHERE id=$2', [hash, id]); },
  updateAccess: async (id, role, permissions, accountScope, allowedAccountIds) => {
    await pool.query('UPDATE admin_users SET role=$1, permissions=$2, account_scope=$3, allowed_account_ids=$4 WHERE id=$5', [role, JSON.stringify(permissions || []), accountScope || 'all', JSON.stringify(allowedAccountIds || []), id]);
  },
  updatePermissions: async (id, permissions) => { await pool.query('UPDATE admin_users SET permissions=$1 WHERE id=$2', [JSON.stringify(permissions), id]); },
  twoFAState: async (id) => {
    const r = await pool.query('SELECT COALESCE(two_fa_enabled,false) AS enabled, two_fa_secret, two_fa_secret_pending FROM admin_users WHERE id=$1', [id]);
    return r.rows[0] || { enabled:false, two_fa_secret:null, two_fa_secret_pending:null };
  },
  setPending2FA: async (id, secret) => { await pool.query('UPDATE admin_users SET two_fa_secret_pending=$1 WHERE id=$2', [secret, id]); },
  enable2FA: async (id, secret) => { await pool.query('UPDATE admin_users SET two_fa_enabled=true, two_fa_secret=$1, two_fa_secret_pending=NULL WHERE id=$2', [secret, id]); },
  disable2FA: async (id) => { await pool.query('UPDATE admin_users SET two_fa_enabled=false, two_fa_secret=NULL, two_fa_secret_pending=NULL WHERE id=$1', [id]); },
  verify: async (username, password) => {
    const r = await pool.query('SELECT * FROM admin_users WHERE LOWER(username)=LOWER($1) LIMIT 1', [username]);
    const user = r.rows[0] || null;
    if (!user || !verifyPassword(password, user.password_hash)) return null;
    if (!String(user.password_hash || '').startsWith('scrypt$')) {
      const upgradedHash = hashPassword(password);
      await pool.query('UPDATE admin_users SET password_hash=$1 WHERE id=$2', [upgradedHash, user.id]);
      user.password_hash = upgradedHash;
    }
    return user;
  },
};
const platformAdmins = {
  configured: async () => { const r = await pool.query('SELECT COUNT(*)::int AS count FROM platform_admins'); return Number(r.rows[0]?.count || 0) > 0; },
  byId: async (id) => { const r = await pool.query('SELECT id,username,created_at,last_login FROM platform_admins WHERE id=$1', [id]); return r.rows[0] || null; },
  verify: async (username,password) => {
    const r = await pool.query('SELECT * FROM platform_admins WHERE LOWER(username)=LOWER($1) LIMIT 1', [username]);
    const user = r.rows[0] || null;
    if (!user || !verifyPassword(password, user.password_hash)) return null;
    if (!String(user.password_hash || '').startsWith('scrypt$')) {
      const upgraded = hashPassword(password);
      await pool.query('UPDATE platform_admins SET password_hash=$1,updated_at=NOW() WHERE id=$2', [upgraded,user.id]);
    }
    await pool.query('UPDATE platform_admins SET last_login=NOW() WHERE id=$1', [user.id]);
    return { id:user.id, username:user.username };
  },
};
module.exports = { init, pool, settingsDb, stripeAccounts, customers, subscriptions, payments, activityLog, webhookLogs, security, adminUsers, platformAdmins };
