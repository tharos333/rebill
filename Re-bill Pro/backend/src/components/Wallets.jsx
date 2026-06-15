import React from 'react'
import {
  MetaMask, Trust, Coinbase, WalletConnectLogo, Safe, Binance, OKX,
  Phantom, Rabby, Rainbow, Bitget, OneInch, Crypto,
} from './WalletIcons'
import {
  BNB as NetBnb, Base as NetBase, Polygon as NetPolygon,
  Ethereum as NetEthereum, Arbitrum as NetArbitrum,
  Optimism as NetOptimism, Solana as NetSolana,
} from './CoinIcons'

const WALLETS = [
  ['MetaMask', MetaMask], ['Trust Wallet', Trust], ['Coinbase Wallet', Coinbase],
  ['WalletConnect', WalletConnectLogo], ['Safe', Safe], ['Binance Web3', Binance],
  ['OKX Wallet', OKX], ['Phantom', Phantom], ['Rabby', Rabby],
  ['Rainbow', Rainbow], ['Bitget Wallet', Bitget], ['1inch Wallet', OneInch],
  ['Crypto.com', Crypto],
]

const NETWORKS = [
  ['BNB Chain', NetBnb, 'USDT'], ['Base', NetBase, 'USDC'], ['Polygon', NetPolygon, 'USDC'],
  ['Ethereum', NetEthereum, 'USDT / USDC'], ['Arbitrum', NetArbitrum, ''],
  ['Optimism', NetOptimism, ''], ['Solana', NetSolana, ''],
]

function Badge({ label, Icon, flat = false }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2.5 rounded-full bg-white px-5 py-3 ring-1 ring-black/[0.06] ${
        flat ? 'shadow-[0_2px_8px_-4px_rgba(13,10,20,0.12)]' : 'shadow-soft'
      }`}
    >
      <Icon size={24} />
      <span className="whitespace-nowrap text-sm font-semibold text-ink">{label}</span>
    </span>
  )
}

function NetworkBadge({ label, Icon, token }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-3 rounded-full bg-white px-5 py-3 shadow-soft ring-1 ring-black/[0.06]">
      <Icon size={26} />
      <span className="flex flex-col leading-tight">
        <span className="whitespace-nowrap text-sm font-semibold text-ink">{label}</span>
        {token && <span className="font-mono text-[10px] uppercase tracking-wide text-ink/40">{token}</span>}
      </span>
    </span>
  )
}

// Infinite marquee row. Content is duplicated so the -50% translate loops seamlessly.
function MarqueeRow({ items, reverse = false, duration }) {
  const doubled = [...items, ...items]
  return (
    <div className="group relative py-1">
      <div
        className={`flex w-max gap-3 ${reverse ? 'animate-marqueeRev' : 'animate-marquee'} group-hover:[animation-play-state:paused]`}
        style={duration ? { animationDuration: duration } : undefined}
      >
        {doubled.map(([label, Icon], i) => (
          <Badge key={`${label}-${i}`} label={label} Icon={Icon} flat />
        ))}
      </div>
    </div>
  )
}

export default function Wallets() {
  // Two staggered rows (same scroll direction). Offset the split so the
  // rows don't show identical badges stacked on top of each other.
  const ROW_A = [...WALLETS.slice(0, 7), ['+400 more', PlusBadge]]
  const ROW_B = [...WALLETS.slice(7), ...WALLETS.slice(0, 3)]

  return (
    <section id="networks" className="bg-[#F7F3EC] pb-16 pt-16 sm:pb-24 sm:pt-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {/* wallets — slider */}
        <div className="overflow-hidden rounded-6xl bg-white p-8 shadow-soft ring-1 ring-black/5 sm:p-12">
          <div className="max-w-2xl">
            <span className="eyebrow text-blue">Bring your own</span>
            <h2 className="display mt-3 text-ink text-[clamp(1.9rem,5vw,3.2rem)]">
              Bring any wallet.
            </h2>
            <p className="mt-4 text-base text-ink/60">
              CoinCard connects through major wallet flows, so your favorite
              wallets work out of the box.
            </p>
          </div>

          {/* two staggered rows, same direction — soft fade only at far edges */}
          <div className="relative mt-8">
            <div className="space-y-3 overflow-hidden py-1">
              <MarqueeRow items={ROW_A} duration="46s" />
              <MarqueeRow items={ROW_B} duration="54s" />
            </div>
            {/* localized edge fades (white card -> transparent), far left/right only */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-white to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white to-transparent" />
          </div>
        </div>

        {/* networks */}
        <div className="mt-14 sm:mt-20">
          <span className="eyebrow text-blue">Multi-chain</span>
          <h2 className="display mt-3 text-ink text-[clamp(1.9rem,5vw,3.2rem)]">
            Supported blockchains
          </h2>
          <p className="mt-4 max-w-xl text-base text-ink/60">
            Activate and manage your card funding across the networks crypto
            users already trust.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {NETWORKS.map(([label, Icon, token]) => (
              <NetworkBadge key={label} label={label} Icon={Icon} token={token} />
            ))}
          </div>
        </div>

        {/* dark CTA block */}
        <div
          id="get-card"
          className="relative mt-12 overflow-hidden rounded-6xl p-10 text-white sm:mt-16 sm:p-16"
          style={{ background: 'linear-gradient(140deg, #001A4D 0%, #012169 55%, #0052FF 130%)' }}
        >
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-blue/40 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-neon/10 blur-3xl" />
          <div className="relative">
            <span className="eyebrow text-neon">One-time fee — never again</span>
            <h2 className="display mt-4 text-[clamp(2.6rem,8vw,5.5rem)]">
              Get started
            </h2>
            <p className="mt-4 max-w-md text-base text-white/70">
              Activate your CoinCard for $1 and start spending from your crypto
              wallet.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#get-card" className="pill bg-white px-8 py-4 text-base font-semibold text-ink transition-transform hover:-translate-y-0.5">
                Get your card — $1
              </a>
              <a href="#networks" className="pill px-8 py-4 text-base font-semibold text-white ring-1 ring-white/30 transition-colors hover:bg-white/10">
                View supported networks
              </a>
            </div>
            <p className="mt-6 font-mono text-[11px] uppercase tracking-widest text-white/60">
              No monthly fees • No hidden fees • Wallet-connected
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function PlusBadge({ size = 24 }) {
  return (
    <span
      className="grid place-items-center rounded-full bg-navy font-mono text-[10px] font-bold text-neon"
      style={{ width: size, height: size }}
    >
      +
    </span>
  )
}
