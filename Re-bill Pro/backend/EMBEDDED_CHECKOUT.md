# Subloop Embedded Stripe Subscription Checkout

This build keeps the existing Stripe Payment Link and embedded storefront flows, and also provides a Subloop-hosted Stripe Payment Element checkout.

## What changed

- Stripe Accounts now accept a **Publishable key (`pk_...`)** in addition to the existing secret key and webhook secret.
- Generating a Payment Link now also generates an **embedded checkout token** for the same recurring Stripe Price.
- Generating a Payment Link automatically creates a short Subloop URL: `https://app.subloop.space/pay/{id}`.
- Opening that URL automatically loads the matching embedded checkout token; customers never need to paste it.
- New public endpoints:
  - `GET /checkout/config?token=...`
  - `GET /checkout/hosted/:id/config`
  - `POST /checkout/create-subscription`
- New subscriptions are created with `payment_behavior=default_incomplete` and `save_default_payment_method=on_subscription`.
- The first payment is confirmed in the browser with Stripe Payment Element.
- The existing webhook keeps subscriptions/payments synchronized in Subloop.
- `invoice.payment_action_required` is now handled.
- Checkout creation is idempotent for the same `checkout_reference`.

## 1. After deployment

Open **Stripe Accounts** in Subloop and edit the Stripe account used for the storefront.

Add its matching publishable key:

- Live account: `sk_live_...` + `pk_live_...`
- Test account: `sk_test_...` + `pk_test_...`

Leaving the existing secret/webhook fields blank while editing keeps them unchanged.

## 2. Generate a plan

Go to **Payment Links** and generate the subscription as usual.

Subloop now creates all three representations of the same recurring Stripe Price:

- Subloop hosted checkout (`app.subloop.space/pay/...`) — displayed as the main hosted link
- Stripe Payment Link (`buy.stripe.com/...`) — retained as a backend fallback
- Embedded checkout token

Send the Subloop hosted checkout URL directly to a customer. For checkout inside an external storefront, use the **embedded checkout token**.

You can later move hosted checkout to `buy.subloop.space` without changing checkout or rebilling code. Set this Railway variable and connect that domain to the same service:

```text
SUBLOOP_CHECKOUT_ORIGIN=https://buy.subloop.space
```

## 3. Storefront flow

The storefront should first load the public config:

```js
const token = 'PASTE_EMBED_TOKEN_HERE';
const SUBLOOP_BASE = 'https://rebill-production.up.railway.app';

const config = await fetch(
  `${SUBLOOP_BASE}/checkout/config?token=${encodeURIComponent(token)}`
).then(r => r.json());
```

The response contains the Stripe publishable key and trusted price data:

```js
{
  publishableKey: 'pk_...',
  amount: 4860,
  currency: 'gbp',
  interval: 'month',
  intervalCount: 1,
  elementsOptions: {
    mode: 'subscription',
    amount: 4860,
    currency: 'gbp',
    paymentMethodTypes: ['card']
  }
}
```

Initialize Stripe Elements with those values. Do not take the amount/currency from browser-editable fields.

## 4. React / Lovable example

Install:

```bash
npm install @stripe/stripe-js @stripe/react-stripe-js
```

Use a stable `checkout_reference` for one checkout attempt. It can be your order/cart ID or a UUID generated once when the checkout starts. Do not generate a new value on every button click.

```jsx
import { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';

const SUBLOOP_BASE = 'https://rebill-production.up.railway.app';
const EMBED_TOKEN = 'PASTE_EMBED_TOKEN_HERE';

function PaymentForm({ customer, checkoutReference }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements || loading) return;

    setLoading(true);
    setError('');

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || 'Please check your payment details.');
      setLoading(false);
      return;
    }

    const response = await fetch(`${SUBLOOP_BASE}/checkout/create-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: EMBED_TOKEN,
        checkout_reference: checkoutReference,
        customer: {
          email: customer.email,
          first_name: customer.firstName,
          last_name: customer.lastName,
          phone: customer.phone,
          address: {
            line1: customer.address,
            line2: customer.apartment,
            city: customer.city,
            postal_code: customer.postcode,
            country: customer.countryCode,
          },
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Could not create subscription.');
      setLoading(false);
      return;
    }

    if (data.type === 'none') {
      window.location.assign('/thank-you');
      return;
    }

    const confirm = data.type === 'setup'
      ? stripe.confirmSetup.bind(stripe)
      : stripe.confirmPayment.bind(stripe);

    const { error: confirmError } = await confirm({
      elements,
      clientSecret: data.clientSecret,
      confirmParams: {
        return_url: `${window.location.origin}/thank-you`,
      },
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message || 'Payment failed.');
      setLoading(false);
      return;
    }

    // Card payments that do not require a redirect arrive here immediately.
    window.location.assign('/thank-you');
  }

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && <div>{error}</div>}
      <button type="submit" disabled={!stripe || loading}>
        {loading ? 'Processing…' : 'Pay'}
      </button>
    </form>
  );
}

export default function EmbeddedSubscriptionCheckout({ customer, checkoutReference }) {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    fetch(`${SUBLOOP_BASE}/checkout/config?token=${encodeURIComponent(EMBED_TOKEN)}`)
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Checkout unavailable');
        return body;
      })
      .then(setConfig)
      .catch(console.error);
  }, []);

  const stripePromise = useMemo(
    () => config ? loadStripe(config.publishableKey) : null,
    [config]
  );

  if (!config || !stripePromise) return <div>Loading secure payment…</div>;

  return (
    <Elements stripe={stripePromise} options={config.elementsOptions}>
      <PaymentForm customer={customer} checkoutReference={checkoutReference} />
    </Elements>
  );
}
```

## 5. CORS restriction (recommended)

By default, a valid signed embed token can be used from any origin, similarly to a public payment link.

On Railway, set:

```text
CHECKOUT_ALLOWED_ORIGINS=https://yourstore.com,https://www.yourstore.com
```

For Lovable preview/testing, add its preview domain too.

## 6. Webhook events

Keep the existing webhook endpoint `/webhook` and the events already configured, including:

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `invoice.paid`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.updated`
- `checkout.session.completed` (still needed for old hosted Payment Links)

The embedded Payment Element flow does **not** depend on `checkout.session.completed`.

## 7. Test before live

Use a Stripe test account and matching `sk_test_...` / `pk_test_...` keys first. Confirm:

1. Card fields display on your storefront.
2. First payment succeeds.
3. Stripe creates `cus_...` and `sub_...`.
4. Subloop shows the customer/subscription/payment.
5. The subscription's payment method is saved for future Stripe subscription invoices.
6. 3DS/authentication-required cards complete correctly.
