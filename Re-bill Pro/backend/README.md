# CoinCard

Premium Web3 virtual card landing page. Connect a wallet, pay $1 once, spend onchain.

## Stack
React 18 + Vite + Tailwind CSS. No backend. Wallet/payment buttons are visual placeholders.

## Run
```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
npm run preview  # preview the build
```

## Structure
- `src/App.jsx` — assembles all sections
- `src/components/` — Header, Hero, Features (bento), Wallets + Networks + CTA, HowItWorks, Security (bento), Enterprise (mock dashboard), Footer
- `src/components/Icons.jsx` — original stylized SVG marks for networks, wallets, and UI
- `src/components/CoinCardVisual.jsx` — the signature glassmorphic card
- `tailwind.config.js` — color tokens, animations

All branding, copy, card design, and icons are original to CoinCard.
