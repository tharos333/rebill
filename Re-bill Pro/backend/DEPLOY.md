# Railway deployment

This folder is flattened so it can be deployed directly as the Railway service root.

1. Upload/push the contents of this folder to the repository/service root.
2. Keep your existing Railway `DATABASE_URL` and other environment variables.
3. Deploy. Database migrations run automatically at startup.
4. Open Subloop → **Stripe Accounts** → **Edit** → add the matching `pk_...` publishable key.
5. Open **Payment Links** → generate a plan → copy the new **Embedded checkout token**.
6. Use that token in your storefront integration described in `EMBEDDED_CHECKOUT.md`.

Recommended Railway variable after you know your storefront domain:

`CHECKOUT_ALLOWED_ORIGINS=https://yourstore.com,https://www.yourstore.com`
