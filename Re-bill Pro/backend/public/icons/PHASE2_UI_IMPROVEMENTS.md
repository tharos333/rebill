# Subloop Phase 2 UI Improvements

This build is based on the Phase 1 rebill-safe deploy.

## Added
- Live rebill-card preview in the Customer drawer.
- Shows the card Subloop would actually choose right now.
- Shows why that card was selected: Subscription default, Customer default, Saved in Subloop, or Newest saved card.
- Adds a "Will be charged" indicator.
- Failed payment details now show a clear recommended action based on the Stripe failure reason (Retry later, Customer action required, Update card, Do not retry now, etc.).

## Unchanged
- Existing transactions are not edited.
- Existing Stripe subscription/payment IDs are untouched.
- Phase 1 card-selection and off-session logic remains in place.
- No attempt is made to bypass Stripe/Radar.
