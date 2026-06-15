import React from 'react'
import { Users, Arrow } from './Icons'

const TEAM = [
  { name: 'Wallet · 0x4F…91', role: 'Operations', pct: 72, spend: '$1,440' },
  { name: 'Wallet · 0xA2…3c', role: 'Marketing', pct: 48, spend: '$960' },
  { name: 'Wallet · 0x77…d0', role: 'Engineering', pct: 90, spend: '$1,800' },
]

export default function Enterprise() {
  return (
    <section id="enterprise" className="bg-[#EEF4FF] py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="eyebrow text-blue">Enterprise</span>
            <h2 className="display mt-3 text-ink text-[clamp(2rem,5.5vw,3.6rem)]">
              Built for teams.
            </h2>
            <p className="mt-4 max-w-md text-base text-ink/60">
              Manage multiple cards, wallet permissions, and team spending from
              one dashboard.
            </p>
            <a href="#get-card" className="pill-dark mt-8 text-sm font-semibold">
              Talk to us <Arrow size={16} />
            </a>
          </div>

          {/* mock dashboard */}
          <div className="rounded-5xl bg-white p-7 shadow-card ring-1 ring-black/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue/10 text-blue">
                  <Users size={20} />
                </span>
                <span className="font-display text-lg font-bold tracking-tight text-ink">
                  Team spending
                </span>
              </div>
              <span className="rounded-full bg-neon/20 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wide text-emerald-600">
                Live
              </span>
            </div>

            <div className="mt-6 space-y-5">
              {TEAM.map((m) => (
                <div key={m.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-ink">{m.name}</span>
                    <span className="font-mono text-ink/60">{m.spend}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-cream">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue to-blue-light"
                        style={{ width: `${m.pct}%` }}
                      />
                    </div>
                    <span className="w-20 text-right font-mono text-[11px] uppercase tracking-wide text-ink/40">
                      {m.role}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              {[['Cards', '12'], ['Networks', '5'], ['Monthly fee', '$0']].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-cream px-4 py-3 text-center">
                  <p className="font-display text-xl font-bold text-ink">{v}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-ink/40">{k}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
