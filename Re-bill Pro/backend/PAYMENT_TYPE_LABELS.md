# Payment type labels

Subloop distinguishes payment source in the Payment drawer without repeating
the payment method, which is displayed separately:

- `Subscription payment` — first/other subscription invoice payment.
- `Subscription renewal` — automatic Stripe renewal (`billing_reason=subscription_cycle`).
- `Recurring payment` — saved-card charge triggered by Subloop from a subscription, including retries.
- `One-time payment` — standalone customer charge not tied to a subscription.
- `Migration verification` — verification payment used while moving a saved payment method.

New PaymentIntents created by Subloop include safe metadata identifying the payment origin and local subscription id. No secret data is placed in metadata.
