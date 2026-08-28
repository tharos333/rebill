# Platform Admin sign-out real fix

Build: `20260828-admin-signout-runtime-enforced-4`

The repeated visual failure was a deployment/source mismatch: the live `/admin` page was still rendering the old button markup (no logout icon), proving the edited `admin.html` was not the file actually being served.

This build fixes the button in two independent places:

1. `admin.html` contains the exact logout icon and neutral-idle/red-text-hover behavior.
2. `server.js` enforces the same markup/style at runtime on `/admin`, even if an older `admin.html` is accidentally present.

The deploy ZIP is flattened: `server.js`, `admin.html`, `package.json`, etc. are at ZIP root so Railway/GitHub cannot silently keep serving a stale root copy.
