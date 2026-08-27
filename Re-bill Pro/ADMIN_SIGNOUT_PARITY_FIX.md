# Admin Sign out parity fix — 2026-08-28

The Platform Admin `Sign out` control now uses the same visual interaction as the main app `Disconnect` control:

- Neutral text, background, and border at rest.
- Red text/icon, red border, and subtle red background only on hover.
- Same 34px control height, 13px icon, spacing, radius, and transition.
- Uses the same logout-arrow SVG as the main app.
- Old inline mouseenter/mouseleave styling was removed.
- Final high-specificity CSS is placed last in `admin.html` so older danger-button rules cannot override it.
- `/admin` response header build marker: `X-Subloop-Admin-Build: 20260828-signout-parity-1`.

The Admin sign-out button was verified in headless Chromium in both rest and hover states.
