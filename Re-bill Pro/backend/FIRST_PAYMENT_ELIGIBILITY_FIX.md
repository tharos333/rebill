# First-payment eligibility fix

Subloop now treats a Stripe customer/subscription created by checkout as provisional until the first paid charge succeeds.

- Failed first payment: payment stays visible in Payments, customer is kept internally as `pending`, subscription as `incomplete`, and neither appears in the normal Customers/Subscriptions lists.
- Successful first payment: pending customer is promoted to `active`; the paid subscription is promoted to `active`.
- Existing failed-only records are corrected on startup so they no longer appear as active customers/subscriptions.
- Stripe invoice/payment state is checked before a positive-price subscription is shown as Active.
