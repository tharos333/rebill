# Admin Sign out — exact official-app cascade fix

Build: `20260828-signout-exact-cascade-2`

Root cause of the repeated mismatch: the official app's Disconnect appearance is produced by CSS **cascade order**, not by the `.btn-disconnect` rule in isolation. In `index.html`, `.btn-disconnect` is declared before the generic `.btn`, so the generic rule wins at rest; on hover, the generic hover keeps the normal button background/border while `.btn-disconnect:hover` supplies the red text/icon color.

This build copies that same rule order and the same SVG/button markup into `admin.html`. It removes the previous inline mouseenter/mouseleave styling and does not add a late high-specificity override.
