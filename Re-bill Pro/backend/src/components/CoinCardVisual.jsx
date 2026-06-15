import React from 'react'
import { Wifi } from './Icons'
import VisaLogo from './VisaLogo'
import cardLogo from '../assets/card-logo.png'

// The signature element: an original glassmorphic crypto card with holographic sheen.
export default function CoinCardVisual({ className = '', tilt = true, scheme = 'blue' }) {
  const bg =
    scheme === 'navy'
      ? 'linear-gradient(135deg, #001A4D 0%, #0052FF 60%, #3D7BFF 130%)'
      : 'linear-gradient(135deg, #0052FF 0%, #3D7BFF 45%, #5B6CFF 115%)'

  return (
    <div
      className={`relative aspect-[1.586/1] w-full overflow-hidden rounded-[26px] text-white shadow-card ${className}`}
      style={{ background: bg }}
    >
      {/* holographic sheen */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -inset-y-6 left-0 w-1/3 animate-sheen"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
            filter: 'blur(6px)',
          }}
        />
      </div>

      {/* soft orbs */}
      <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-neon/30 blur-3xl" />

      <div className="relative flex h-full flex-col justify-between p-6 sm:p-7">
        <div className="flex items-start justify-between">
          <div>
            <img src={cardLogo} alt="Coin Card" className="h-[26px] w-auto object-contain" />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-white/70">
              Virtual Card
            </p>
          </div>
          <Wifi size={26} className="rotate-90 text-white/90" />
        </div>

        {/* chip */}
        <div className="flex items-center gap-3">
          <div className="relative h-9 w-12 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 shadow-inner">
            <div className="absolute inset-1.5 rounded-sm border border-amber-600/30" />
            <div className="absolute left-1/2 top-1 h-7 w-px -translate-x-1/2 bg-amber-600/30" />
            <div className="absolute left-1.5 top-1/2 h-px w-9 -translate-y-1/2 bg-amber-600/30" />
          </div>
          <span className="font-mono text-[11px] tracking-[0.35em] text-white/80">ONCHAIN</span>
        </div>

        <div>
          <p className="font-mono text-base tracking-[0.18em] sm:text-lg">
            5417 •••• •••• 0xC4
          </p>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-widest text-white/60">
                Wallet linked
              </p>
              <p className="font-mono text-xs tracking-wide text-white/90">0x9F…2aE1</p>
            </div>
            <VisaLogo height={22} />
          </div>
        </div>
      </div>
    </div>
  )
}
