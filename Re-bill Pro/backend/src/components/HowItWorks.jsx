import React from 'react'
import { Check, Lock, Wifi, Arrow } from './Icons'
import { MetaMask, Coinbase, WalletConnectLogo } from './WalletIcons'
import { Ethereum, USDC, Base } from './CoinIcons'
import VisaLogo from './VisaLogo'
import cardLogo from '../assets/card-logo.png'

/* ===== Light, elegant mini-visuals (match the cream aesthetic) ===== */

function VisualConnect({ accent }) {
  return (
    <div className="rounded-3xl bg-cream/70 p-4 ring-1 ring-black/[0.04]">
      <div className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-3 shadow-soft ring-1 ring-black/5">
        <Lock size={15} className="text-ink/30" />
        <span className="text-xs text-ink/40">Password</span>
        <span className="ml-auto font-mono text-xs tracking-widest text-ink/50">••••••</span>
      </div>
      <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-blue to-blue-light py-2.5 text-xs font-semibold text-white">
        Connect wallet
      </div>
      <div className="mt-2.5 flex items-center justify-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-soft ring-1 ring-black/5"><MetaMask size={18} /></span>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-soft ring-1 ring-black/5"><Coinbase size={18} /></span>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-soft ring-1 ring-black/5"><WalletConnectLogo size={18} /></span>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-[10px] font-bold text-ink/40 shadow-soft ring-1 ring-black/5">+97</span>
      </div>
    </div>
  )
}

function VisualCard({ accent }) {
  return (
    <div className="rounded-3xl bg-cream/70 p-4 ring-1 ring-black/[0.04]">
      <div className="relative overflow-hidden rounded-2xl p-4 shadow-soft" style={{ background: 'linear-gradient(135deg,#0052FF,#3D7BFF 55%,#5B6CFF)' }}>
        {/* bright sweeping sheen */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -inset-y-8 left-0 w-1/3 animate-sheen"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)', filter: 'blur(8px)' }}
          />
        </div>
        {/* glossy top highlight */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-2xl bg-gradient-to-b from-white/25 to-transparent" />
        {/* soft sheen orbs */}
        <div className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-white/20 blur-xl" />
        <div className="pointer-events-none absolute -bottom-8 -left-4 h-20 w-20 rounded-full bg-neon/20 blur-xl" />

        <div className="relative flex items-center justify-between">
          <img src={cardLogo} alt="Coin Card" className="h-4 w-auto object-contain" />
          <Wifi size={15} className="rotate-90 text-white/80" />
        </div>

        {/* chip */}
        <div className="relative mt-4 h-6 w-9 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 shadow-inner">
          <div className="absolute inset-1 rounded-[3px] border border-amber-600/30" />
        </div>

        <p className="relative mt-4 font-mono text-sm tracking-[0.18em] text-white">•••• •••• •••• 7842</p>

        <div className="relative mt-4 flex items-end justify-between">
          <div>
            <p className="font-mono text-[7px] uppercase tracking-widest text-white/60">Cardholder</p>
            <p className="text-xs font-semibold text-white">YOUR NAME</p>
          </div>
          <VisaLogo height={14} />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-soft ring-1 ring-black/5">
        <span className="text-sm font-semibold text-ink">Activate</span>
        <span className="rounded-full bg-neon px-3.5 py-1 font-mono text-sm font-bold text-ink">$1.00</span>
      </div>
    </div>
  )
}

function VisualLive({ accent }) {
  const rows = [
    { Icon: Ethereum, n: 'Ethereum', a: '2.41 ETH' },
    { Icon: USDC, n: 'USDC', a: '1,920.00' },
    { Icon: Base, n: 'Base', a: '0.88 ETH' },
  ]
  return (
    <div className="rounded-3xl bg-cream/70 p-4 ring-1 ring-black/[0.04]">
      <div className="rounded-2xl bg-white p-3.5 shadow-soft ring-1 ring-black/5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-neon text-ink"><Check size={15} /></span>
          <div>
            <p className="text-xs font-bold text-ink">Payment approved</p>
            <p className="text-[10px] text-ink/40">Apple Store · $248.00</p>
          </div>
          <span className="ml-auto font-mono text-[10px] text-ink/40">now</span>
        </div>
      </div>
      <div className="mt-2.5 space-y-1.5">
        {rows.map((r) => (
          <div key={r.n} className="flex items-center gap-2.5 rounded-xl bg-white px-3 py-2 shadow-soft ring-1 ring-black/5">
            <r.Icon size={20} />
            <span className="text-xs font-semibold text-ink">{r.n}</span>
            <span className="ml-auto font-mono text-[11px] text-ink/50">{r.a}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const STEPS = [
  {
    num: '01', label: 'Get set up', title: 'Sign up & connect',
    text: 'Create your account and connect your wallet in one tap.',
    bullets: ['Password-only onboarding', 'Connect MetaMask & 100+ wallets', 'Your keys stay yours'],
    Visual: VisualConnect,
  },
  {
    num: '02', label: 'Choose & activate', title: 'Pick your card for $1',
    text: 'Choose your virtual card and activate it with one flat dollar.',
    bullets: ['Flat $1 — one time', 'Virtual card issued instantly', 'No monthly fees'],
    Visual: VisualCard,
  },
  {
    num: '03', label: 'Go live', title: 'Spend anywhere',
    text: 'Use your card online and fund spending from your connected crypto wallet.',
    bullets: ['Apple Pay & Google Pay ready', 'Real-time wallet-based funding', 'Spend globally where supported'],
    Visual: VisualLive,
  },
]

const ACCENTS = [
  {
    num: 'text-[#8EA4D8]',
    chip: 'bg-[#8EA4D8]/15 text-[#41649D]',
    check: 'bg-[#0A2E80] text-white',
    solid: 'bg-[#8EA4D8]',
    bar: 'from-[#8EA4D8] to-[#0052FF]',
  },
  {
    num: 'text-[#0052FF]',
    chip: 'bg-[#0052FF]/10 text-[#0052FF]',
    check: 'bg-[#0052FF] text-white',
    solid: 'bg-[#0052FF]',
    bar: 'from-[#0052FF] to-[#3D7BFF]',
  },
  {
    num: 'text-[#55DDB2]',
    chip: 'bg-[#B6FF3C]/25 text-[#0C7A55]',
    check: 'bg-[#19B98D] text-white',
    solid: 'bg-[#55DDB2]',
    bar: 'from-[#55DDB2] to-[#B6FF3C]',
  },
]

export default function HowItWorks() {
  return (
    <section className="bg-[#FBF9F4] py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {/* heading */}
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow text-blue">How it works</span>
          <h2 className="display mt-3 text-ink text-[clamp(2rem,5.5vw,3.6rem)]">
            Live in minutes, not days.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-ink/60">
            No banks, no paperwork, no waiting. Three steps stand between you and
            spending from crypto.
          </p>
        </div>

        {/* three steps together */}
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => {
            const a = ACCENTS[i]
            return (
              <article
                key={s.num}
                className="relative flex flex-col overflow-hidden rounded-5xl bg-white p-7 pt-8 shadow-soft ring-1 ring-black/5 transition-transform duration-300 hover:-translate-y-1.5"
              >
                {/* unifying accent bar */}
                <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${a.bar}`} />

                {/* number + label */}
                <div className="flex items-center justify-between">
                  <span className={`font-display text-6xl font-bold leading-none ${a.num} opacity-80`}>
                    {s.num}
                  </span>
                  <span className={`eyebrow rounded-full px-3 py-1.5 ${a.chip}`}>{s.label}</span>
                </div>

                <h3 className="mt-5 font-display text-2xl font-bold tracking-tight text-ink">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink/60">{s.text}</p>

                <ul className="mt-5 space-y-2.5">
                  {s.bullets.map((b) => (
                    <li key={b} className="flex items-center gap-2.5 text-sm font-medium text-ink">
                      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${a.check}`}>
                        <Check size={12} />
                      </span>
                      {b}
                    </li>
                  ))}
                </ul>

                <div className="mt-auto pt-6">
                  <s.Visual accent={a} />
                </div>
              </article>
            )
          })}
        </div>

        <div className="mt-12 flex justify-center">
          <a href="#get-card" className="pill-dark text-sm font-semibold">
            Get your card — $1 <Arrow size={16} />
          </a>
        </div>
      </div>
    </section>
  )
}
