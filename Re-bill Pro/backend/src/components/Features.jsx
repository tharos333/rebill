import React from 'react'
import { Check, Phone, Lock, WMeta, WConnect } from './Icons'
import { Ethereum, USDC, Base, BNB, Polygon } from './CoinIcons'

function BalanceRow({ Icon, label, amount }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-black/5">
      <div className="flex items-center gap-3">
        <Icon size={32} />
        <span className="text-sm font-semibold text-ink">{label}</span>
      </div>
      <span className="font-mono text-sm text-ink/70">{amount}</span>
    </div>
  )
}

export default function Features() {
  return (
    <section id="features" className="bg-[#FAF8F2] py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="max-w-2xl">
          <span className="eyebrow text-blue">What you get</span>
          <h2 className="display mt-3 text-ink text-[clamp(2rem,5vw,3.4rem)]">
            Built to spend,
            <br />not to wait.
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3 md:auto-rows-fr">
          <article className="group flex flex-col rounded-5xl bg-white p-7 shadow-soft ring-1 ring-black/5 md:row-span-2">
            <h3 className="font-display text-2xl font-bold tracking-tight text-ink">
              Direct from your wallet.
            </h3>
            <p className="mt-2 text-sm text-ink/60">
              Connect your wallet and activate your virtual card in minutes.
            </p>
            <div className="mt-6 space-y-3">
              <BalanceRow Icon={Ethereum} label="Ethereum" amount="2.4108 ETH" />
              <BalanceRow Icon={USDC} label="USDC" amount="1,920.00" />
              <BalanceRow Icon={Base} label="Base" amount="0.88 ETH" />
            </div>
            <div className="mt-auto pt-5">
              <div className="flex items-center gap-2 rounded-2xl bg-navy px-4 py-3 text-white">
                <WConnect size={18} className="text-neon" />
                <span className="text-xs font-medium">Connected via WalletConnect</span>
              </div>
            </div>
          </article>

          <article className="flex flex-col justify-between rounded-5xl bg-navy p-7 text-white shadow-soft">
            <div>
              <h3 className="font-display text-2xl font-bold tracking-tight">Only $1 to activate.</h3>
              <p className="mt-2 text-sm text-white/70">
                One-time activation. No monthly fees. No hidden charges.
              </p>
            </div>
            <div className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-neon px-4 py-2 text-ink">
              <Check size={16} />
              <span className="font-mono text-sm font-bold">$1.00 · PAID ONCE</span>
            </div>
          </article>

          <article className="flex flex-col rounded-5xl bg-white p-7 shadow-soft ring-1 ring-black/5">
            <div className="mb-4 inline-grid h-11 w-11 place-items-center rounded-2xl bg-blue/10 text-blue">
              <Phone size={22} />
            </div>
            <h3 className="font-display text-2xl font-bold tracking-tight text-ink">Spend anywhere.</h3>
            <p className="mt-2 text-sm text-ink/60">
              Use your virtual card online anywhere virtual cards are accepted.
            </p>
          </article>

          <article className="relative overflow-hidden rounded-5xl bg-gradient-to-br from-blue to-blue-light p-7 text-white shadow-soft">
            <h3 className="font-display text-2xl font-bold tracking-tight">All your networks.</h3>
            <p className="mt-2 max-w-xs text-sm text-white/80">
              Choose your network and token before activation.
            </p>
            <div className="relative mx-auto mt-6 h-32 w-32">
              <div className="absolute inset-0 animate-orbit rounded-full border border-dashed border-white/30" />
              <div className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-blue shadow">
                <span className="h-4 w-6 rounded-[3px] bg-blue" />
              </div>
              {[Base, BNB, Polygon, Ethereum].map((Ico, i) => {
                const ang = (i / 4) * Math.PI * 2 - Math.PI / 2
                const x = 50 + 42 * Math.cos(ang)
                const y = 50 + 42 * Math.sin(ang)
                return (
                  <span
                    key={i}
                    className="absolute grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white shadow"
                    style={{ left: `${x}%`, top: `${y}%` }}
                  >
                    <Ico size={26} />
                  </span>
                )
              })}
            </div>
          </article>

          <article className="flex flex-col rounded-5xl bg-white p-7 shadow-soft ring-1 ring-black/5">
            <h3 className="font-display text-2xl font-bold tracking-tight text-ink">No KYC flow.</h3>
            <p className="mt-2 text-sm text-ink/60">
              Fast onboarding without long bank paperwork.
            </p>
            <div className="mt-auto space-y-3 pt-6">
              <div className="flex items-center gap-3 rounded-2xl bg-cream px-4 py-3">
                <Lock size={18} className="text-ink/50" />
                <span className="font-mono text-sm tracking-[0.3em] text-ink/70">••••••••</span>
              </div>
              <button className="flex w-full items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white">
                <WMeta size={18} className="text-blue-light" /> Connect wallet
              </button>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
