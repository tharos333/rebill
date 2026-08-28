# Phase 1 — Rebill reliability

This deploy keeps the existing Subloop UI and historical data unchanged.

Changes:
- Rebill card selection now prefers the Stripe subscription default card, then the customer invoice default card, then the locally saved card, then the newest attached card.
- The selected Stripe PaymentMethod is synchronized back to the local customer record.
- Manual one-time charges, subscription charges, failed-payment retries, and local scheduled rebills use the resolver.
- `/api/run-rebills` skips subscriptions that already have a real `stripe_subscription_id`, because Stripe Billing renews those automatically. This prevents duplicate renewal charges.
- Existing `off_session: true` and `confirm: true` behavior is preserved.
- No historical payments, customers, or subscriptions are rewritten.
