# Subloop Platform Admin

The license manager is available only at:

- `https://app.subloop.space/admin`

It uses a separate platform-admin account and session from normal Subloop workspace users.

## Railway variables

Set these before the first deployment of the platform-admin build:

- `SUBLOOP_PLATFORM_ADMIN_USERNAME`
- `SUBLOOP_PLATFORM_ADMIN_PASSWORD` (minimum 8 characters)
- `SUBLOOP_PLATFORM_ADMIN_FORCE_RESET=false`

The credentials are hashed with scrypt and stored in PostgreSQL on first bootstrap. Normal redeploys do not overwrite them.

For recovery, set the desired Railway credentials and temporarily set `SUBLOOP_PLATFORM_ADMIN_FORCE_RESET=true`, deploy once, then return it to `false`.
