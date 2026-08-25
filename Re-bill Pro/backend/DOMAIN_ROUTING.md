# Subloop domain routing

Production defaults in this build:

- Login origin: `https://subloop.space`
- App origin: `https://app.subloop.space`
- Shared session cookie domain: `.subloop.space`

Both domains should point to the same Railway service on port 8080.

## Authentication flow

1. User signs in on `subloop.space`.
2. The backend creates an HttpOnly, Secure, SameSite=Lax session cookie scoped to `.subloop.space`.
3. The browser redirects to `app.subloop.space`.
4. The app validates the shared cookie before showing the dashboard.
5. Logout clears the shared cookie and returns to `subloop.space`.

The existing Railway hostname retains the legacy Bearer-token fallback for emergency/direct access.

## Optional Railway overrides

No new variables are required for the domains above. Optional overrides are:

- `SUBLOOP_LOGIN_ORIGIN`
- `SUBLOOP_APP_ORIGIN`
- `SUBLOOP_COOKIE_DOMAIN`

`SUBLOOP_AUTH_SECRET` must remain configured and stable so sessions remain valid across deploys.
