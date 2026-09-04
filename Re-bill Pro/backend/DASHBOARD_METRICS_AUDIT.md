# Dashboard metrics audit

Definitions used by `/api/stats` and the dashboard cards:

- **MRR** — estimated USD monthly-normalized value of subscriptions whose current local status is `active`.
- **Revenue** — estimated USD value of successful payments in the current calendar month.
- **Active Subs** — number of subscription rows whose current status is `active`.
- **Customers** — the same visible customer population used by the Customers page: pending rows are excluded, and unpaid synthetic/import placeholders are hidden while paid imported customers remain visible.
- **New customers** — visible customers created in the current calendar month.
- **Avg LTV** — all-time estimated USD successful revenue divided by the same visible customer population as the Customers card.
- **Success Rate** — successful payment attempts divided by successful + failed attempts during the last 30 days. No attempts renders as `—` rather than 100%.
- **Failed Payments** — failed payment attempts during the last 30 days.
- **Churn Rate** — subscriptions canceled during the last 30 days divided by current live subscriptions plus subscriptions canceled during the same 30-day window. Old historical cancellations do not dilute the rate.
- **Payment Methods** — customers with a locally-known reusable Stripe customer/payment-method pair (`cus_...` + `pm_...`), not merely a card number seen on a one-off or failed payment.

The Revenue Overview period cards continue to use successful payments only.
