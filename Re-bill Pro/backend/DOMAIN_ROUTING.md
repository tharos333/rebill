# Subloop domain routing

Production defaults in this build:

- Login origin: `https://subloop.cloud`
- App origin: `https://app.subloop.cloud`
- Checkout origin: `https://pay.velton.cloud`
- Shared session cookie domain: `.subloop.cloud`

All three domains should point to the same Railway service on port 8080.

## Authentication flow

1. User signs in on `subloop.cloud`.
2. The backend creates an HttpOnly, Secure, SameSite=Lax session cookie scoped to `.subloop.cloud`.
3. The browser redirects to `app.subloop.cloud`.
4. The app validates the shared cookie before showing the dashboard.
5. Logout clears the shared cookie and returns to `subloop.cloud`.

## Hosted checkout and legacy redirects

- New payment links use `https://pay.velton.cloud/{id}`.
- `subloop.space/pay/{id}` and `app.subloop.space/pay/{id}` redirect to the matching Velton checkout.
- Other browser paths on `subloop.space` redirect to `subloop.cloud`.
- Other browser paths on `app.subloop.space` redirect to `app.subloop.cloud`.
- Keep both legacy `.space` Railway domains connected so existing links continue working.

The existing Railway hostname retains the legacy Bearer-token fallback for emergency/direct access.

## Optional Railway overrides

No new variables are required for the domains above. Optional overrides are:

- `SUBLOOP_LOGIN_ORIGIN`
- `SUBLOOP_APP_ORIGIN`
- `SUBLOOP_CHECKOUT_ORIGIN`
- `SUBLOOP_COOKIE_DOMAIN`
- `SUBLOOP_LEGACY_LOGIN_ORIGIN`
- `SUBLOOP_LEGACY_APP_ORIGIN`

`SUBLOOP_AUTH_SECRET` must remain configured and stable so sessions remain valid across deploys.
