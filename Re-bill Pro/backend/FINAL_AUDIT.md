# Subloop final logic audit baseline — 2026-08-24

This build consolidates the customer, subscription, payment and Stripe-state logic into one audited baseline.

## Lifecycle rules checked/fixed
- A paid subscription is not exposed as live until that subscription has a confirmed successful first payment.
- Failed-first Stripe customers/subscriptions remain internal (`pending` / `incomplete`) for payment history only.
- Trialing/free subscriptions are allowed to exist without an initial charge.
- Customer lifecycle is derived from the complete set of subscription states:
  - all live subscriptions scheduled to end -> customer `canceling`
  - customer-level pause -> customer `paused`
  - individual subscription pause -> customer remains `active`, billing status shows `paused`
  - all subscriptions finally canceled -> customer `canceled`
  - a later genuine one-time payment may make that customer active again without reviving an old subscription.
- Safe cancellation uses Stripe `cancel_at_period_end`; Reactivate clears it and restores the prior collection state.
- A cancellation scheduled while paused restores the actual Stripe pause when reactivated. An expired auto-resume date does not recreate a stale pause.
- Stripe-managed pause/cancel state is reconciled hourly to repair delayed/missed webhooks.

## Payment rules checked/fixed
- Stripe invoice failures retry the real invoice, not a separate PaymentIntent.
- Manual recurring-charge retries are blocked after the related subscription is no longer active.
- A manual recurring charge on a Stripe-managed subscription does not move its automatic renewal date.
- Recovery-rate logic no longer mistakes a later normal subscription cycle for recovery of an older failure.
- Payment timestamps use the Stripe PaymentIntent creation time for new imported payments, avoiding late-webhook lifecycle mistakes.
- `Last successful payment` ignores later failed attempts.

## Customer drawer rules checked/fixed
- One-time/current non-recurring customer: `Saved payment method`, no `Will be charged`, no recurring controls.
- Active/trialing recurring customer: recurring payment method and appropriate billing state.
- Individually paused subscription: `Paused subscriptions` + `Billing status: Paused` + `Resume subscription`.
- Final canceled subscription: saved payment method only, no `Will be charged`, no `Selected by`, full-width `View card`.
- Historical canceled subscription + later one-time payment is treated as current one-time billing, not as a live recurring schedule.
- Status colors are consistent: Active green, Paused blue, Canceling amber, Canceled/Failed red.

## Billing engine / reporting checks
- Stripe Billing remains the only automatic subscription renewal/retry engine; legacy Subloop automatic recurring runner is disabled.
- Dashboard aggregates avoid row multiplication and MRR is normalized by interval.
- Churn uses subscription customers, not one-time customers.
- Forecast uses active subscriptions only and calendar-aware monthly/quarterly/yearly advancement.
- Mixed currencies are not presented as one exact customer total.

## UI / safety checks
- No native browser `alert()`, `confirm()` or `prompt()` remains in the main UI.
- Pause resume-date UI requires a future date; backend validates it too.
- User-facing legacy `rebill/rebilling` wording is removed in favor of recurring-payment language.

## Validation performed
- `node --check server.js`
- `node --check db.js`
- `node --check scheduler.js`
- `node --check mailer.js`
- all inline JavaScript blocks in `index.html` syntax checked
- no duplicate Express method/path registrations found
- no duplicate named JavaScript functions found
- no native browser confirmation calls found

This is the clean audited code baseline. Stripe account-specific behavior (Radar, issuer declines, account capabilities, unusual legacy Stripe objects, and live webhook timing) can only be fully validated with real test/live events after deployment.
