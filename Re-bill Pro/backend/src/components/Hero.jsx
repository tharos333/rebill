import React from 'react'
import CoinCardVisual from './CoinCardVisual'
import { Check } from './Icons'

const PARTICLES = [
  { l: '8%', t: '18%', s: 10, d: '0s' },
  { l: '18%', t: '62%', s: 6, d: '1.2s' },
  { l: '30%', t: '30%', s: 8, d: '2s' },
  { l: '72%', t: '22%', s: 7, d: '0.5s' },
  { l: '85%', t: '55%', s: 11, d: '1.8s' },
  { l: '62%', t: '70%', s: 6, d: '2.6s' },
  { l: '92%', t: '32%', s: 5, d: '3.1s' },
  { l: '46%', t: '14%', s: 5, d: '1.4s' },
]

export default function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* blue gradient field */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% -10%, #3D7BFF 0%, #0052FF 42%, #003ECC 78%, #001A4D 100%)',
        }}
      />
      {/* circular background shapes */}
      <div className="pointer-events-none absolute -left-24 top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute -right-16 top-10 h-80 w-80 rounded-full bg-sky/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-neon/10 blur-3xl" />

      {/* floating crypto particles */}
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="pointer-events-none absolute hidden animate-float rounded-full bg-white/40 sm:block"
          style={{
            left: p.l,
            top: p.t,
            width: p.s,
            height: p.s,
            animationDelay: p.d,
            boxShadow: '0 0 12px rgba(255,255,255,0.6)',
          }}
        />
      ))}

      <div className="relative mx-auto max-w-7xl px-5 pb-20 pt-36 sm:px-8 sm:pb-28 sm:pt-44">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="display text-white text-[clamp(2.8rem,9vw,6.2rem)]">
            Spend crypto.
            <br />
            Get your card.
            <br />
            <span className="text-neon">For $1.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-base text-white/80 sm:text-lg">
            Connect your wallet, activate once, and start spending from your
            crypto balance. No monthly fees. No hidden charges. No paperwork.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#get-card" className="pill bg-white px-8 py-4 text-base font-semibold text-ink shadow-card transition-transform hover:-translate-y-0.5">
              Get your card — $1
            </a>
            <a href="#networks" className="pill px-8 py-4 text-base font-semibold text-white ring-1 ring-white/30 transition-colors hover:bg-white/10">
              View supported networks
            </a>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-widest text-white/70">
            {['No monthly fees', 'Wallet-connected', 'Multi-chain ready'].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-neon" /> {t}
              </span>
            ))}
          </div>
        </div>

        {/* signature card */}
        <div className="relative mx-auto mt-16 max-w-md animate-floatSlow">
          <div className="absolute -inset-6 rounded-[40px] bg-white/10 blur-2xl" />
          <div className="relative rotate-[-4deg] transition-transform duration-500 hover:rotate-0">
            <CoinCardVisual scheme="blue" />
          </div>
        </div>
      </div>

      {/* curved transition into cream */}
      <div className="relative h-12 sm:h-20">
        <svg viewBox="0 0 1440 120" preserveAspectRatio="none" className="absolute bottom-0 h-full w-full">
          <path d="M0,120 L1440,120 L1440,40 C1080,110 360,110 0,40 Z" fill="#F7F3EC" />
        </svg>
      </div>
    </section>
  )
}
