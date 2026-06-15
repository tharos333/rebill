import React from 'react'

/* Small circular floating tokens (coins + card chips), all the same size family */
function FloatToken({ children, className = '', size = 56, style }) {
  return (
    <span
      className={`pointer-events-none absolute grid place-items-center rounded-full shadow-card ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      {children}
    </span>
  )
}

/* Bitcoin coin */
const BTC = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="16" cy="16" r="16" fill="#F7931A" />
    <path fill="#fff" d="M22 14.1c.3-1.9-1.2-3-3.2-3.6l.7-2.6-1.6-.4-.6 2.6c-.4-.1-.9-.2-1.3-.3l.6-2.6-1.6-.4-.7 2.6c-.3-.1-.7-.2-1-.2l-2.2-.6-.4 1.7s1.2.3 1.2.3c.7.2.8.6.8.9l-.8 3c0 .1.1.1.1.1l-.1 0-1.1 4.2c-.1.2-.3.5-.7.4 0 0-1.2-.3-1.2-.3l-.8 1.8 2.1.5c.4.1.8.2 1.1.3l-.7 2.7 1.6.4.7-2.6c.4.1.9.2 1.3.3l-.7 2.6 1.6.4.7-2.7c2.7.5 4.8.3 5.6-2.2.7-2-.0-3.1-1.4-3.9 1.1-.2 1.9-1 2.1-2.4zm-3.7 5.2c-.5 2-3.8.9-4.9.6l.9-3.5c1.1.3 4.5.8 4 2.9zm.5-5.2c-.4 1.8-3.2.9-4.1.7l.8-3.2c.9.2 3.8.6 3.3 2.5z" />
  </svg>
)

/* Credit-card chip token (small card icon inside a coin-sized circle) */
const CardToken = ({ size = 56, bg }) => (
  <span className="grid h-full w-full place-items-center rounded-full" style={{ background: bg }}>
    <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="3" fill="#fff" />
      <rect x="2.5" y="8" width="19" height="2.6" fill="rgba(0,0,0,0.35)" />
      <rect x="5.5" y="14.5" width="6" height="1.8" rx="0.9" fill="rgba(0,0,0,0.25)" />
    </svg>
  </span>
)

const Symbol = ({ char, bg, color = '#fff' }) => (
  <span className="grid h-full w-full place-items-center rounded-full" style={{ background: bg }}>
    <span className="font-display text-xl font-bold" style={{ color }}>{char}</span>
  </span>
)

export default function Mission() {
  return (
    <section className="relative overflow-hidden py-28 sm:py-36 text-white">
      {/* deep navy field */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 90% at 50% 30%, #0A2E80 0%, #012169 50%, #001233 110%)' }}
      />
      {/* faint connecting grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />
      <div className="pointer-events-none absolute -left-24 top-10 h-96 w-96 rounded-full bg-blue/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-neon/10 blur-3xl" />

      {/* floating tokens — coins + card chips, balanced around the headline */}
      <FloatToken size={58} className="left-[9%] top-[26%] hidden animate-float md:grid" style={{ animationDelay: '0.2s' }}>
        <BTC size={58} />
      </FloatToken>
      <FloatToken size={52} className="left-[15%] bottom-[24%] hidden animate-floatSlow md:grid" style={{ animationDelay: '1.0s' }}>
        <Symbol char="€" bg="linear-gradient(135deg,#3D7BFF,#0052FF)" />
      </FloatToken>
      <FloatToken size={50} className="left-[7%] top-[58%] hidden animate-float md:grid" style={{ animationDelay: '1.5s' }}>
        <CardToken size={50} bg="linear-gradient(135deg,#5B6CFF,#3D7BFF)" />
      </FloatToken>

      <FloatToken size={54} className="right-[10%] top-[24%] hidden animate-floatSlow md:grid" style={{ animationDelay: '0.5s' }}>
        <Symbol char="$" bg="linear-gradient(135deg,#B6FF3C,#7CCB1E)" color="#0D0A14" />
      </FloatToken>
      <FloatToken size={50} className="right-[14%] bottom-[26%] hidden animate-float md:grid" style={{ animationDelay: '1.2s' }}>
        <Symbol char="£" bg="linear-gradient(135deg,#3D7BFF,#0052FF)" />
      </FloatToken>
      <FloatToken size={56} className="right-[7%] top-[56%] hidden animate-floatSlow md:grid" style={{ animationDelay: '0.8s' }}>
        <CardToken size={56} bg="linear-gradient(135deg,#0052FF,#3D7BFF)" />
      </FloatToken>

      <div className="relative mx-auto max-w-4xl px-5 text-center sm:px-8">
        <span className="eyebrow inline-flex items-center gap-2 text-neon">
          <span className="h-1.5 w-1.5 rounded-full bg-neon" /> Why we built it
        </span>
        <h2 className="display mt-6 text-[clamp(2rem,6vw,4.4rem)]">
          Crypto should move like money —
          <br />
          <span className="text-neon">instant, borderless,</span>
          <br />
          and yours.
        </h2>
        <p className="mx-auto mt-8 max-w-xl text-lg text-white/70">
          CoinCard is built for a world where your wallet is your financial home
          and your card is the bridge to everyday spending.
        </p>
        <p className="mt-10 font-mono text-xs uppercase tracking-[0.3em] text-white/40">
          — The CoinCard principle
        </p>
      </div>
    </section>
  )
}
