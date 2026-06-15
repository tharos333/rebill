import React from 'react'
import { Shield, Snow, Pulse, Check, Sliders, Bell, Lock } from './Icons'

/* ---------- Featured emblem with animated rings ---------- */
function ShieldEmblem() {
  return (
    <div className="relative grid h-36 w-36 place-items-center">
      <span className="absolute inset-0 rounded-full border border-neon/20" />
      <span className="absolute inset-4 rounded-full border border-neon/30" />
      <span className="absolute inset-8 rounded-full bg-neon/10 blur-md" />
      <span className="relative grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-neon to-emerald-500 text-ink shadow-[0_12px_40px_-8px_rgba(182,255,60,0.6)]">
        <Shield size={38} />
      </span>
    </div>
  )
}

export default function Security() {
  return (
    <section id="security" className="bg-[linear-gradient(180deg,#F0F8FF_0%,#F2FFF1_100%)] py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="max-w-2xl">
          <span className="eyebrow text-blue">Security</span>
          <h2 className="display mt-3 text-ink text-[clamp(2rem,5.5vw,3.6rem)]">
            Safe by design.
          </h2>
          <p className="mt-4 text-base text-ink/60">
            Self-custody stays self-custody. You approve first. CoinCard only
            works after wallet permission.
          </p>
        </div>

        <div className="mt-12 flex flex-col gap-5 lg:flex-row lg:items-stretch">
          {/* ===== Featured (left, ~40%) ===== */}
          <article className="relative flex flex-col overflow-hidden rounded-5xl bg-navy p-8 text-white lg:w-[40%] lg:shrink-0">
            <div className="pointer-events-none absolute -right-20 -top-16 h-64 w-64 rounded-full bg-blue/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-12 h-64 w-64 rounded-full bg-neon/10 blur-3xl" />

            <div className="relative">
              <span className="eyebrow text-neon">Maximum security</span>
              <h3 className="mt-3 font-display text-[1.7rem] font-bold leading-tight tracking-tight">
                Built to be verified, not trusted.
              </h3>

              {/* security controls — freeze, monitor, permissions */}
              <div className="mt-5 flex flex-wrap gap-2">
                {['Freeze', 'Monitor', 'Permissions'].map((t) => (
                  <span key={t} className="rounded-full bg-white/10 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wide text-white/75 ring-1 ring-white/15">
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative my-6 flex justify-center">
              <ShieldEmblem />
            </div>

            <p className="relative max-w-sm text-sm leading-relaxed text-white/70">
              Encrypted by default, with onchain transparency you can verify
              yourself. Your keys never leave your wallet — CoinCard only gives
              them a checkout.
            </p>

            {/* live status row */}
            <div className="relative mt-6 flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-neon/20 text-neon">
                <Lock size={18} />
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold">Wallet permission active</p>
                <p className="font-mono text-[11px] text-white/40">0x9F…2aE1 · approved</p>
              </div>
              <span className="rounded-full bg-neon/20 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-neon">
                Live
              </span>
            </div>

            <div className="relative mt-5 flex flex-wrap gap-2">
              {['AES-256', 'Onchain', 'Self-custody'].map((t) => (
                <span key={t} className="rounded-full bg-white/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-white/70 ring-1 ring-white/15">
                  {t}
                </span>
              ))}
            </div>
          </article>

          {/* ===== Right: tidy 2-col grid of equal cards ===== */}
          <div className="grid flex-1 gap-5 sm:grid-cols-2">
          {/* ===== Instant freeze (blue, with toggle) ===== */}
          <article className="relative flex flex-col justify-between overflow-hidden rounded-5xl bg-blue p-7 text-white shadow-soft min-h-[220px]">
            <div className="flex items-start justify-between">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15"><Snow size={22} /></span>
              {/* freeze toggle */}
              <span className="flex h-7 w-12 items-center rounded-full bg-white/25 p-1">
                <span className="ml-auto h-5 w-5 rounded-full bg-white shadow" />
              </span>
            </div>
            <div className="mt-8">
              <h3 className="font-display text-xl font-bold tracking-tight">Instant freeze</h3>
              <p className="mt-1.5 text-sm text-white/80">Pause spending in one tap, unfreeze just as fast.</p>
            </div>
          </article>

          {/* ===== Real-time monitoring (neon, with pulse line) ===== */}
          <article className="relative flex flex-col justify-between overflow-hidden rounded-5xl bg-neon p-7 text-ink shadow-soft min-h-[220px]">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-ink/10"><Pulse size={22} /></span>
            <svg viewBox="0 0 120 28" className="mt-4 h-7 w-full" fill="none" aria-hidden="true">
              <path d="M0 14h22l6-9 7 18 6-12 5 6h20l6-7 7 14 6-10h22" stroke="#0D0A14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="mt-4">
              <h3 className="font-display text-xl font-bold tracking-tight">Real-time monitoring</h3>
              <p className="mt-1.5 text-sm text-ink/70">See every transaction the moment it happens.</p>
            </div>
          </article>

          {/* ===== No monthly fees (white, $0 badge) ===== */}
          <article className="relative flex flex-col justify-between rounded-5xl bg-white p-7 text-ink shadow-soft ring-1 ring-black/5 min-h-[220px]">
            <div className="flex items-center justify-between">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-600"><Check size={22} /></span>
              <span className="font-display text-3xl font-black text-ink/90">$0<span className="text-base font-bold text-ink/40">/mo</span></span>
            </div>
            <div className="mt-8">
              <h3 className="font-display text-xl font-bold tracking-tight">No monthly fees</h3>
              <p className="mt-1.5 text-sm text-ink/60">Pay once. Keep your card. Forever.</p>
            </div>
          </article>

          {/* ===== Permission control (sky, slider rows) ===== */}
          <article className="relative flex flex-col justify-between overflow-hidden rounded-5xl bg-sky p-7 text-navy shadow-soft min-h-[220px]">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-navy/10"><Sliders size={22} /></span>
            <div className="mt-5 space-y-2">
              {[['Online payments', true], ['Withdrawals', false]].map(([label, on]) => (
                <div key={label} className="flex items-center justify-between rounded-xl bg-white/50 px-3 py-2">
                  <span className="text-xs font-semibold">{label}</span>
                  <span className={`flex h-5 w-9 items-center rounded-full p-0.5 ${on ? 'bg-navy' : 'bg-navy/20'}`}>
                    <span className={`h-4 w-4 rounded-full bg-white shadow ${on ? 'ml-auto' : ''}`} />
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <h3 className="font-display text-xl font-bold tracking-tight">Permission control</h3>
              <p className="mt-1.5 text-sm text-navy/70">Decide exactly what your card can touch.</p>
            </div>
          </article>

          {/* ===== Fraud alerts (periwinkle, ping) ===== */}
          <article className="relative flex flex-col justify-between overflow-hidden rounded-5xl bg-blush p-7 text-navy shadow-soft min-h-[220px]">
            <div className="flex items-start justify-between">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-navy/10"><Bell size={22} /></span>
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-navy/40" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-navy" />
              </span>
            </div>
            <div className="mt-8">
              <h3 className="font-display text-xl font-bold tracking-tight">Fraud alerts</h3>
              <p className="mt-1.5 text-sm text-navy/70">Get pinged the instant something looks off.</p>
            </div>
          </article>

          {/* ===== Biometric unlock (deep blue, fills the void) ===== */}
          <article className="relative flex flex-col justify-between overflow-hidden rounded-5xl bg-grape p-7 text-white shadow-soft min-h-[220px]">
            <div className="pointer-events-none absolute -right-10 -bottom-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            <div className="relative flex items-start justify-between">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15">
                {/* fingerprint glyph */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 11c0 3.5-.4 6-1.5 8" />
                  <path d="M8.5 6.5A6 6 0 0 1 18 11c0 1.2 0 2.4-.2 3.5" />
                  <path d="M6 12a6 6 0 0 1 .8-4" />
                  <path d="M9 11a3 3 0 0 1 6 0c0 2.5-.3 4.7-1 6.8" />
                  <path d="M12 11v1c0 2.5-.4 4.8-1.2 7" />
                  <path d="M6.5 16c.4-1 .5-2 .5-3" />
                </svg>
              </span>
              <span className="rounded-full bg-white/15 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-white/80">
                Active
              </span>
            </div>
            <div className="mt-8">
              <h3 className="font-display text-xl font-bold tracking-tight">Biometric unlock</h3>
              <p className="mt-1.5 text-sm text-white/75">Face or fingerprint to approve every spend.</p>
            </div>
          </article>
          </div>
        </div>
      </div>
    </section>
  )
}
