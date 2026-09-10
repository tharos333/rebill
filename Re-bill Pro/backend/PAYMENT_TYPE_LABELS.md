# Payment type labels

Subloop distinguishes payment source in the Payment drawer without repeating
the payment method, which is displayed separately:

- `Subscription payment` — first/other subscription invoice payment.
- `Subscription renewal` — automatic Stripe renewal (`billing_reason=subscription_cycle`).
- `Recurring payment` — saved-card charge triggered by Subloop from a subscription, including retries.
- `One-time payment` — standalone customer charge not tied to a subscription.
- `Migration verification` — verification payment used while moving a saved payment method.

New PaymentIntents created by Subloop include safe metadata identifying the payment origin and local subscription id. No secret data is placed in metadata.

## Checkout source labels

Payment type and checkout source are separate. The canonical source labels are:

- `Subloop payment link` — both legacy Subloop-hosted links and current links hosted at `pay.velton.cloud`.
- `Embedded checkout` — token-based store checkout integrations, including WooCommerce.
- `Stripe payment link` — a native Stripe Payment Link created through Subloop.
- `Subloop manual payment` — a one-time saved-card charge started inside the Subloop dashboard.
- `Subloop recurring charge` — a manual recurring charge or standalone recurring retry started inside Subloop.
- `Migration verification` — a test or live payment created by the migration workflow.
- `Stripe payment` — an external Stripe payment that has no Subloop source marker.

Automatic Stripe subscription renewals inherit the checkout source stored on the
Stripe Subscription. Checkout-source detection version 5 rechecks older payments
when their details are opened, fixing stale `Embedded checkout`, blank, and legacy
Velton values without changing the payment itself.
