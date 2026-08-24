# Payment type labels

Subloop now distinguishes payment source in the Payment drawer:

- `Subscription card payment` — first/other subscription invoice payment.
- `Subscription renewal card payment` — automatic Stripe renewal (`billing_reason=subscription_cycle`).
- `Rebill card payment` — saved-card charge triggered by Subloop from a subscription, including retries.
- `One-time card payment` — standalone customer charge not tied to a subscription.

New PaymentIntents created by Subloop include safe metadata identifying the payment origin and local subscription id. No secret data is placed in metadata.
