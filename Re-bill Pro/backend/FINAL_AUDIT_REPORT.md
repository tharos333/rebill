# Subloop — Final Consolidated Audit

This build consolidates the lifecycle/payment/UI audit fixes into one deployable project.

## Final verification

- Node syntax: `server.js`, `db.js`, `scheduler.js`, and both inline `index.html` script blocks passed.
- State/static matrix: **72/72 checks passed**.
- Native browser `confirm()` / `alert()` calls: none found in the live app code.
- Legacy Subloop automatic recurring-charge engine: disabled; scheduler is auto-resume maintenance only.
- Stale `public/icons/index.html` application copy: removed.

## Lifecycle rules verified

- First successful payment eligibility is subscription-specific.
- A new failed first subscription payment cannot be activated by an older successful payment from the same customer.
- `incomplete`, `incomplete_expired`, and `pending` records do not establish a recurring relationship by themselves.
- Individually paused subscription: customer record can stay Active; drawer billing status shows Paused.
- Customer-level pause marks/recovers only subscriptions paused by that customer-level action.
- Cancel-at-period-end uses Canceling and can be reactivated on the same Stripe subscription.
- Paused-before-cancel restores to Paused after reactivation.
- Fully Canceled subscriptions cannot be reactivated through the API; create a new subscription.
- Historical canceled subscription + later one-time success returns the UI to one-time behavior when no live recurring relationship remains.

## Payment/Billing rules verified

- Manual recurring charge: Active-only and does not move Stripe/Subloop renewal dates.
- Failed Stripe subscription invoice retry pays the actual Stripe invoice.
- Stripe Billing owns automatic renewals and dunning.
- Saved cards are considered reusable only when attached to the exact Stripe Customer.
- Manual one-time charges require an explicit currency.
- Subscription amount edits replace/update the real Stripe Price/Subscription.
- Last successful payment, successful counts, averages, and revenue calculations ignore failed attempts where appropriate.

## Analytics/currency rules verified

- MRR is normalized to a monthly equivalent and presented as estimated USD when currencies are converted.
- Dashboard aggregates are split to avoid customer × subscription × payment row multiplication.
- Churn uses stable `ended_at` cancellation time and subscription records rather than one-time customers.
- Forecast counts only Active subscriptions and no longer double-counts renewals inside a horizon.
- Customer UI totals are grouped by original currency.
- Customer CSV exports use `Total Paid by Currency` rather than adding unlike currencies.
- Payment CSV includes the original currency.

## Important deployment note

The automated audit is code-level/static and state-matrix verification. It does not execute live Stripe API calls against your production Stripe account or production PostgreSQL database. After deployment, verify one test subscription for webhook delivery, pause/resume, scheduled cancellation/reactivation, and a failed-invoice retry using Stripe test mode before applying the same actions to live customers.
