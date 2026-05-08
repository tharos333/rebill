const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, 'db.json'));
const db = low(adapter);

db.defaults({
  customers: [],
  subscriptions: [],
  payments: [],
  _nextId: { customers: 1, subscriptions: 1, payments: 1 }
}).write();

function nextId(table) {
  const id = db.get(`_nextId.${table}`).value();
  db.set(`_nextId.${table}`, id + 1).write();
  return id;
}

const customers = {
  all: () => db.get('customers').value(),
  byId: (id) => db.get('customers').find({ id }).value(),
  byStripeId: (stripeId) => db.get('customers').find({ stripe_customer_id: stripeId }).value(),
  upsert: (data) => {
    const existing = db.get('customers').find({ stripe_customer_id: data.stripe_customer_id }).value();
    if (existing) {
      db.get('customers').find({ stripe_customer_id: data.stripe_customer_id }).assign(data).write();
    } else {
      db.get('customers').push({ id: nextId('customers'), status: 'active', created_at: new Date().toISOString(), ...data }).write();
    }
  },
  updateStatus: (id, status) => db.get('customers').find({ id }).assign({ status }).write(),
};

const subscriptions = {
  all: () => {
    const subs = db.get('subscriptions').value();
    return subs.map(s => {
      const c = db.get('customers').find({ id: s.customer_id }).value() || {};
      return { ...s, email: c.email, name: c.name, card_brand: c.card_brand, card_last4: c.card_last4 };
    });
  },
  byCustomer: (customerId) => db.get('subscriptions').filter({ customer_id: customerId }).value(),
  due: () => {
    const today = new Date().toISOString().split('T')[0];
    const subs = db.get('subscriptions').filter({ status: 'active' }).value();
    return subs.filter(s => s.next_billing_date <= today).map(s => {
      const c = db.get('customers').find({ id: s.customer_id, status: 'active' }).value();
      if (!c) return null;
      return { ...s, ...c };
    }).filter(Boolean);
  },
  create: (data) => db.get('subscriptions').push({ id: nextId('subscriptions'), status: 'active', created_at: new Date().toISOString(), ...data }).write(),
  advanceBillingDate: (id, intervalDays) => {
    const sub = db.get('subscriptions').find({ id }).value();
    const next = new Date(sub.next_billing_date);
    next.setDate(next.getDate() + intervalDays);
    db.get('subscriptions').find({ id }).assign({ next_billing_date: next.toISOString().split('T')[0] }).write();
  },
  updateStatus: (id, status) => db.get('subscriptions').find({ id }).assign({ status }).write(),
};

const payments = {
  recent: (limit = 50) => {
    const pmts = db.get('payments').value().slice(-limit).reverse();
    return pmts.map(p => {
      const c = db.get('customers').find({ id: p.customer_id }).value() || {};
      return { ...p, email: c.email, name: c.name };
    });
  },
  byCustomer: (customerId) => db.get('payments').filter({ customer_id: customerId }).value(),
  stats: () => {
    const pmts = db.get('payments').value();
    return {
      succeeded_count: pmts.filter(p => p.status === 'succeeded').length,
      failed_count: pmts.filter(p => p.status === 'failed').length,
      total_revenue: pmts.filter(p => p.status === 'succeeded').reduce((s, p) => s + p.amount, 0),
      unique_customers: new Set(pmts.map(p => p.customer_id)).size,
    };
  },
  insert: (data) => db.get('payments').push({ id: nextId('payments'), created_at: new Date().toISOString(), ...data }).write(),
};

module.exports = { db, customers, subscriptions, payments };
