import React from 'react'
import { Bolt, Wifi } from './Icons'
import { Ethereum, USDC, USDT, BNB, Solana } from './CoinIcons'
import VisaLogo from './VisaLogo'
import cardLogo from '../assets/card-logo.png'
import referralUser1 from '../assets/referral-user-1.png'
import referralUser2 from '../assets/referral-user-2.png'
import referralUser3 from '../assets/referral-user-3.png'

/* Bitcoin coin */
const BTC = ({ size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="16" cy="16" r="16" fill="#F7931A" />
    <path fill="#fff" d="M22 14.1c.3-1.9-1.2-3-3.2-3.6l.7-2.6-1.6-.4-.6 2.6c-.4-.1-.9-.2-1.3-.3l.6-2.6-1.6-.4-.7 2.6c-.3-.1-.7-.2-1-.2l-2.2-.6-.4 1.7s1.2.3 1.2.3c.7.2.8.6.8.9l-.8 3c0 .1.1.1.1.1l-.1 0-1.1 4.2c-.1.2-.3.5-.7.4 0 0-1.2-.3-1.2-.3l-.8 1.8 2.1.5c.4.1.8.2 1.1.3l-.7 2.7 1.6.4.7-2.6c.4.1.9.2 1.3.3l-.7 2.6 1.6.4.7-2.7c2.7.5 4.8.3 5.6-2.2.7-2-.0-3.1-1.4-3.9 1.1-.2 1.9-1 2.1-2.4zm-3.7 5.2c-.5 2-3.8.9-4.9.6l.9-3.5c1.1.3 4.5.8 4 2.9zm.5-5.2c-.4 1.8-3.2.9-4.1.7l.8-3.2c.9.2 3.8.6 3.3 2.5z" />
  </svg>
)

function RewardCurrencyBadge() {
  return (
    <div className="relative z-10 h-28 w-28 [perspective:1200px]">
      <div className="absolute inset-0 rounded-full bg-neon/35 blur-2xl" />
      <div className="relative grid h-full w-full place-items-center rounded-full bg-gradient-to-br from-[#B6FF3C] via-[#78EE5F] to-[#37D66E] text-ink shadow-[inset_0_2px_12px_rgba(255,255,255,0.28),0_18px_60px_-8px_rgba(182,255,60,0.72)]">
        <span className="font-display text-[3.4rem] font-black leading-none tracking-[-0.04em]">
          $
        </span>
      </div>
    </div>
  )
}

/* Apple / Google pay marks */
const ApplePay = () => (
  <span className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-white">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.02-3.77-2.04-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.47 7.83 1.3 10.4.86 1.26 1.89 2.67 3.23 2.62 1.3-.05 1.79-.84 3.36-.84s2.01.84 3.39.81c1.4-.02 2.28-1.28 3.14-2.55.99-1.46 1.4-2.88 1.42-2.95-.03-.01-2.72-1.04-2.75-4.15M14.46 4.4c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.69-3.02 1.55-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.58 3.03-1.45"/></svg>
    <span className="text-sm font-semibold">Apple Pay</span>
  </span>
)
const GooglePay = () => (
  <span className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-ink ring-1 ring-black/10">
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M12 11v2.8h3.9c-.17 1-.68 1.85-1.45 2.42v2h2.34C18.13 16.9 19 14.66 19 12c0-.62-.06-1.22-.16-1.8z" transform="translate(1.5 -.2)"/><path fill="#34A853" d="M12 19c1.95 0 3.59-.64 4.78-1.75l-2.34-1.8c-.65.43-1.48.69-2.44.69-1.88 0-3.47-1.27-4.04-2.97H5.54v1.86A7.2 7.2 0 0 0 12 19" transform="translate(1.5 -.2)"/><path fill="#FBBC05" d="M7.96 13.17a4.3 4.3 0 0 1-.23-1.37c0-.48.08-.94.23-1.37V8.57H5.54A7.2 7.2 0 0 0 4.8 11.8c0 1.16.28 2.26.74 3.23z" transform="translate(1.5 -.2)"/><path fill="#EA4335" d="M12 7.46c1.06 0 2.01.37 2.76 1.08l2.07-2.07C15.59 5.27 13.95 4.6 12 4.6a7.2 7.2 0 0 0-6.46 3.97l2.42 1.86C8.53 8.73 10.12 7.46 12 7.46" transform="translate(1.5 -.2)"/></svg>
    <span className="text-sm font-semibold">Google Pay</span>
  </span>
)

/* Fanned stack of mini cards */
function CardStack() {
  return (
    <div className="relative mt-auto h-52">
      <div className="absolute bottom-3 left-3 h-32 w-48 -rotate-[10deg] rounded-3xl bg-white/[0.07] ring-1 ring-white/10" />
      <div className="absolute bottom-4 left-10 h-32 w-48 -rotate-[4deg] rounded-3xl bg-white/[0.1] ring-1 ring-white/10" />
      <div
        className="absolute bottom-6 left-16 flex h-32 w-56 rotate-[4deg] flex-col overflow-hidden rounded-3xl p-4 ring-1 ring-white/10 shadow-[0_22px_48px_-18px_rgba(0,0,0,0.55)]"
        style={{ background: 'linear-gradient(135deg,#0052FF,#3D7BFF)' }}
      >
        <div className="flex items-center justify-between">
          <img src={cardLogo} alt="Coin Card" className="h-[14px] w-auto object-contain" />
          <Wifi size={13} className="rotate-90 text-white/70" />
        </div>
        <div className="mt-auto flex items-end justify-between gap-3">
          <p className="font-mono text-[12px] tracking-widest text-white">4821 •••• 0xC4</p>
          <VisaLogo height={12} />
        </div>
      </div>
    </div>
  )
}

const TEAM = [
  ['Engineering', 84, '$6,120'],
  ['Operations', 61, '$3,480'],
  ['Marketing', 92, '$7,950'],
  ['Design', 38, '$1,610'],
]

export default function Perks() {
  return (
    <section className="bg-[#F7F3EC] py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow text-blue">More than a card</span>
          <h2 className="display mt-3 text-ink text-[clamp(2rem,5.5vw,3.6rem)]">
            One wallet. Every perk.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-ink/60">
            Issue cards for any budget, earn on what you spend, and run a whole
            team — without leaving self-custody.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3 lg:auto-rows-fr">
          {/* Unlimited virtual cards (navy) */}
          <article className="relative flex flex-col overflow-hidden rounded-5xl bg-navy p-7 text-white shadow-soft">
            <h3 className="font-display text-2xl font-bold tracking-tight">
              A card for every budget.
            </h3>
            <p className="mt-2 text-sm text-white/60">
              Spin up unlimited virtual cards — one per project, person, or plan.
            </p>
            <CardStack />
          </article>

          {/* Earn (center, tall) */}
          <article className="relative flex flex-col items-center overflow-hidden rounded-5xl px-6 py-10 text-center text-white shadow-card md:col-span-2 md:p-8 lg:col-span-1 lg:row-span-2"
            style={{ background: 'radial-gradient(110% 70% at 50% 12%, #0A2E80 0%, #001A4D 55%, #00102E 120%)' }}>
            <span className="eyebrow text-neon">Rewards</span>
            <h3 className="display relative mt-3 text-[clamp(2.2rem,4.5vw,3.2rem)] text-white leading-[0.95]">
              Cash back,<br /><span className="text-neon">paid in crypto.</span>
            </h3>
            <p className="mt-4 max-w-xs text-sm text-white/60">
              Up to 3% back on every purchase, settled straight to your wallet.
            </p>

            {/* coin orbit — fills the vertical space */}
            <div className="relative my-auto grid h-[22rem] w-full place-items-center py-8 md:h-72 md:py-6">
              {/* orbit rings */}
              <span className="absolute h-64 w-64 rounded-full border border-white/[0.06]" />
              <span className="absolute h-44 w-44 rounded-full border border-white/[0.08]" />
              {/* central glow + $ coin */}
              <span className="absolute h-40 w-40 rounded-full bg-neon/20 blur-3xl" />
              <RewardCurrencyBadge />
              {/* evenly spaced coins moving around the center $ */}
              <div
                className="absolute left-1/2 top-1/2 h-64 w-64"
                style={{ transform: 'translate(-50%, -50%)' }}
              >
                <div
                  className="relative h-full w-full animate-orbit will-change-transform motion-reduce:animate-none"
                  style={{ animationDuration: '22s' }}
                >
                  {[
                    { Coin: BTC, angle: -90, iconSize: 30 },
                    { Coin: Ethereum, angle: -30, iconSize: 26 },
                    { Coin: BNB, angle: 30, iconSize: 24 },
                    { Coin: USDC, angle: 90, iconSize: 26 },
                    { Coin: USDT, angle: 150, iconSize: 24 },
                    { Coin: Solana, angle: 210, iconSize: 26 },
                  ].map(({ Coin, angle, iconSize }) => {
                    const radius = 122

                    return (
                      <span
                        key={angle}
                        className="absolute left-1/2 top-1/2 grid h-11 w-11 place-items-center rounded-full bg-white/5 ring-1 ring-white/10 backdrop-blur"
                        style={{
                          transform: `translate(-50%, -50%) rotate(${angle}deg) translateX(${radius}px)`,
                        }}
                      >
                        <span style={{ transform: `rotate(${-angle}deg)` }}>
                          <span
                            className="block animate-orbit will-change-transform motion-reduce:animate-none"
                            style={{ animationDuration: '22s', animationDirection: 'reverse' }}
                          >
                            <Coin size={iconSize} />
                          </span>
                        </span>
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="mt-auto flex w-full items-center justify-center gap-3">
              <span className="rounded-full bg-neon/15 px-4 py-1.5 font-mono text-xs font-bold text-neon ring-1 ring-neon/30">+3% back</span>
              <span className="rounded-full bg-white/10 px-4 py-1.5 font-mono text-xs font-bold text-white/80">+$1.27 earned</span>
            </div>
          </article>

          {/* Enterprise team controls (deep navy) */}
          <article className="relative overflow-hidden rounded-5xl bg-[#02123a] p-7 text-white shadow-soft">
            <h3 className="font-display text-2xl font-bold tracking-tight">Controls for the whole team.</h3>
            <p className="mt-2 text-sm text-white/60">Per-wallet limits across every chain, one dashboard.</p>
            <div className="mt-6 flex items-center justify-between font-mono text-[10px] uppercase tracking-wide text-white/40">
              <span>Team</span><span>Spent</span>
            </div>
            <div className="mt-3 space-y-3.5">
              {TEAM.map(([name, pct, spend]) => (
                <div key={name} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs font-semibold">{name}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span className="block h-full rounded-full bg-gradient-to-r from-neon to-blue-light" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-16 shrink-0 text-right font-mono text-xs text-white/80">{spend}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
              <span className="text-xs text-white/50">Total this month</span>
              <span className="font-display text-xl font-bold text-neon">$19,160</span>
            </div>
          </article>

          {/* Referral rewards (sky) */}
          <article className="relative overflow-hidden rounded-5xl bg-sky p-7 text-navy shadow-soft">
            <h3 className="font-display text-2xl font-bold tracking-tight">Invite friends, earn together.</h3>
            <p className="mt-2 text-sm text-navy/70">Both sides earn crypto on every card activation.</p>
            <div className="mt-8 flex items-center gap-4 sm:gap-5">
              <div className="flex shrink-0 -space-x-2.5">
                {[referralUser1, referralUser2, referralUser3].map((src, i) => (
                  <span key={i} className="block h-10 w-10 overflow-hidden rounded-full border-2 border-white shadow-[0_10px_24px_-14px_rgba(0,26,77,0.45)]">
                    <img src={src} alt="Referral user" className="h-full w-full object-cover" />
                  </span>
                ))}
                <span className="grid h-10 w-10 place-items-center rounded-full border-2 border-white bg-neon text-ink shadow-[0_10px_24px_-14px_rgba(0,26,77,0.45)]"><Bolt size={16} /></span>
              </div>
              <div className="flex flex-col justify-center">
                <p className="font-display text-2xl font-bold leading-none">$25 each</p>
                <p className="mt-1 text-xs leading-none text-navy/60">per friend who activates</p>
              </div>
            </div>
          </article>

          {/* Apple & Google Pay (blue) */}
          <article className="relative flex flex-col overflow-hidden rounded-5xl bg-blue p-7 text-white shadow-soft">
            <h3 className="font-display text-2xl font-bold tracking-tight">Add to Apple &amp; Google Pay.</h3>
            <p className="mt-2 text-sm text-white/70">Tap to pay in seconds, anywhere contactless works.</p>
            <div className="my-7 grid place-items-center">
              <span className="grid h-20 w-20 place-items-center rounded-full bg-white/10 ring-1 ring-white/20">
                <Wifi size={30} className="rotate-90 text-white" />
              </span>
            </div>
            <div className="mt-auto flex flex-wrap gap-3">
              <ApplePay />
              <GooglePay />
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
