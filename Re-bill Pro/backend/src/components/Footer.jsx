import React, { useState } from 'react'
import { Arrow } from './Icons'
import footerLogo from '../assets/card-logo.png'

const COLS = [
  [
    'Product',
    [
      { label: 'Features', href: '/#features' },
      { label: 'Virtual Cards', href: '/#get-card' },
      { label: 'Networks', href: '/#networks' },
      { label: 'Security', href: '/#security' },
    ],
  ],
  [
    'Company',
    [
      { label: 'About', href: '/#top' },
      { label: 'FAQ', href: '/#faq' },
      { label: 'Contact', href: 'mailto:contact@getcoincard.xyz' },
    ],
  ],
  [
    'Legal',
    [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms & Conditions', href: '/terms' },
      { label: 'Cookie Policy', href: '/cookies' },
      { label: 'Compliance', href: '/compliance' },
    ],
  ],
]

export default function Footer() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  return (
    <footer
      className="relative overflow-hidden text-white"
      style={{ background: 'linear-gradient(160deg, #012169 0%, #001A4D 70%)' }}
    >
      <div className="pointer-events-none absolute -right-20 top-0 h-72 w-72 rounded-full bg-blue/30 blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <div className="flex items-center">
              <img
                src={footerLogo}
                alt="Coin Card"
                className="h-7 w-auto object-contain"
              />
            </div>
            <p className="mt-4 max-w-xs text-sm text-white/60">
              The crypto-connected virtual card for fast, flexible spending.
            </p>

            <div className="mt-8">
              <p className="font-display text-lg font-bold">Stay in the loop</p>
              <div className="mt-3 flex max-w-sm items-center gap-2 rounded-full bg-white/10 p-1.5 ring-1 ring-white/20">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@wallet.eth"
                  className="flex-1 bg-transparent px-4 py-2 text-sm text-white placeholder-white/40 outline-none"
                />
                <button
                  onClick={() => { if (email) setSent(true) }}
                  className="pill bg-white px-5 py-2.5 text-sm font-semibold text-ink"
                >
                  {sent ? 'Subscribed' : 'Subscribe'} <Arrow size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLS.map(([title, links]) => (
              <div key={title}>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/40">{title}</p>
                <ul className="mt-4 space-y-3">
                  {links.map((link) => (
                    <li key={link.label}>
                      <a href={link.href} className="text-sm text-white/70 transition-colors hover:text-white">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row">
          <p className="font-mono text-[11px] uppercase tracking-widest text-white/40">
            © {new Date().getFullYear()} CoinCard · Spend onchain
          </p>
          <p className="font-mono text-[11px] uppercase tracking-widest text-white/40">
            No monthly fees · No hidden fees
          </p>
        </div>
      </div>
    </footer>
  )
}
