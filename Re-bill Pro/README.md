# Rebill — Stripe-powered Subscription & Rebilling App

A self-hosted rebilling platform. Customers pay once via a Stripe Payment Link,
their card is saved automatically, and your backend charges them on a schedule.

---

## Architecture

```
Customer → Stripe Payment Link → Stripe saves card
                                        ↓
                            Webhook: payment_intent.succeeded
                                        ↓
                              Your backend stores:
                              - stripe_customer_id
                              - stripe_payment_method
                                        ↓
                         Daily cron at 09:00 UTC rebills
                         all due subscriptions via API
```

---

## Setup — Step by Step

### Step 1 — Install dependencies

```bash
cd backend
npm install
```

### Step 2 — Configure environment variables

```bash
cp .env.example .env
```

Then open `.env` and fill in:

- `STRIPE_SECRET_KEY` → from Stripe Dashboard > Developers > API keys
- `STRIPE_WEBHOOK_SECRET` → you'll get this in Step 4
- `SMTP_*` → optional, for failed payment emails (Gmail app password works)

### Step 3 — Enable Stripe Customer Portal

Go to: https://dashboard.stripe.com/test/settings/billing/portal

Enable it (required for the "Update card" button to work).

### Step 4 — Set up the Stripe webhook

**Option A: Local development with Stripe CLI**

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe login
stripe listen --forward-to localhost:3001/webhook
```

Copy the webhook signing secret it prints (starts with `whsec_`) into your `.env`.

**Option B: Production**

1. Go to Stripe Dashboard > Developers > Webhooks
2. Add endpoint: `https://yourdomain.com/webhook`
3. Select events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `customer.updated`
4. Copy the signing secret into your `.env`

### Step 5 — Start the server

```bash
npm start
# or for development with auto-reload:
npm run dev
```

Server starts at: http://localhost:3001

Dashboard at: http://localhost:3001 (opens automatically)

### Step 6 — Create your first Payment Link

1. Open the dashboard → click "Payment Links" in sidebar
2. Fill in product name, amount, currency, rebill interval
3. Click "Generate payment link"
4. Share the link with your customer

### Step 7 — Test it

Use Stripe test cards:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Requires auth: `4000 0025 0000 3155`

After a test payment, the customer appears in your dashboard with their card saved.

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Dashboard metrics |
| GET | `/api/customers` | List all customers |
| PATCH | `/api/customers/:id/status` | Pause / resume / cancel |
| POST | `/api/customers/:id/portal` | Stripe card update portal |
| GET | `/api/subscriptions` | List all subscriptions |
| PATCH | `/api/subscriptions/:id/status` | Update subscription status |
| POST | `/api/subscriptions/:id/charge` | Charge a subscription now |
| GET | `/api/payments` | Payment history |
| POST | `/api/payment-links` | Create Stripe payment link |
| POST | `/api/run-rebills` | Manually trigger rebill job |
| POST | `/webhook` | Stripe webhook receiver |

---

## Deployment (Production)

1. Deploy to a VPS (DigitalOcean, Railway, Render, etc.)
2. Set `BASE_URL` in `.env` to your domain
3. Update the Stripe webhook endpoint to your domain
4. Run behind a reverse proxy (nginx) with HTTPS
5. Use a process manager: `pm2 start server.js`

---

## File Structure

```
rebill/
├── backend/
│   ├── server.js       — Express app, all API routes, webhook handler
│   ├── db.js           — SQLite database schema & helpers
│   ├── scheduler.js    — Daily cron job for rebilling
│   ├── mailer.js       — Failed payment & receipt emails
│   ├── .env.example    — Environment variable template
│   └── package.json
└── frontend/
    └── public/
        └── index.html  — Full dashboard UI (served by backend)
```
