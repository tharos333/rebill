# Railway deployment

This folder is flattened so it can be deployed directly as the Railway service root.

## Required Railway variables

Keep your existing `DATABASE_URL` and Stripe-related variables.

For Subloop admin access, use Railway only to bootstrap/recover the Owner account:

```text
SUBLOOP_OWNER_USERNAME=your-owner-username
SUBLOOP_OWNER_PASSWORD=your-strong-initial-password
SUBLOOP_OWNER_FORCE_RESET=false
```

Also set a stable signing secret so admin sessions remain valid across restarts:

```text
SUBLOOP_AUTH_SECRET=use-a-long-random-secret-here
```

### How Owner credentials work

- If the database has **no Owner account**, Subloop creates the first Owner from `SUBLOOP_OWNER_USERNAME` and `SUBLOOP_OWNER_PASSWORD`.
- If an Owner already exists, Railway credentials do **not** overwrite it during normal deploys.
- Password changes made in **Subloop → Admin/Security** update PostgreSQL and remain valid across redeploys.
- All additional Admin/Analyst/Viewer/Custom users are created and managed only inside Subloop. Do not create Railway variables for them.
- There are no hard-coded default Owner credentials in the source.

### Emergency Owner recovery

Only if you lose access:

1. Set the desired `SUBLOOP_OWNER_USERNAME` and `SUBLOOP_OWNER_PASSWORD` in Railway.
2. Set `SUBLOOP_OWNER_FORCE_RESET=true`.
3. Redeploy once and log in with those Railway credentials.
4. Change the password inside Subloop if desired.
5. Set `SUBLOOP_OWNER_FORCE_RESET=false` again.

The recovery action is fingerprinted, so leaving the switch enabled does not reset an in-app password on every redeploy. A future recovery requires changing the Railway Owner username/password while the switch is enabled.

## Deploy

1. Upload/push the contents of this folder to the repository/service root.
2. Confirm the Railway variables above and your existing `DATABASE_URL` are present.
3. Deploy. Database migrations run automatically at startup.
4. Open Subloop → **Stripe Accounts** → **Edit** → add the matching `pk_...` publishable key.
5. Open **Payment Links** → generate a plan → copy the new **Embedded checkout token**.
6. Use that token in your storefront integration described in `EMBEDDED_CHECKOUT.md`.

Recommended Railway variable after you know your storefront domain:

```text
CHECKOUT_ALLOWED_ORIGINS=https://yourstore.com,https://www.yourstore.com
```
