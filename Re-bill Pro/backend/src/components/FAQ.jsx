import React, { useState } from 'react'

const FAQS = [
  {
    q: 'What is CoinCard?',
    a: 'CoinCard is a crypto-connected virtual card service that lets users activate a virtual card and manage card funding through supported crypto networks.',
  },
  {
    q: 'How does CoinCard work?',
    a: 'Connect your wallet, choose a supported network and token, approve once, activate your card for $1, and manage card funding from your crypto balance.',
  },
  {
    q: 'How much does it cost?',
    a: 'CoinCard has a one-time $1 activation fee. No monthly fee. No hidden subscription fee.',
  },
  {
    q: 'Which networks are supported?',
    a: 'CoinCard supports BNB Chain, Base, Polygon, and Ethereum.',
  },
  {
    q: 'Which tokens are supported?',
    a: 'CoinCard supports USDT and USDC on supported networks.',
  },
  {
    q: 'Do I need to connect my wallet?',
    a: 'Yes. CoinCard is wallet-connected. You use your wallet to approve the supported token before activation and funding.',
  },
  {
    q: 'What does “approve once” mean?',
    a: 'It means you give permission for a supported token on a supported network. After approval, CoinCard can process card funding only within that approved token/network flow.',
  },
  {
    q: 'Can CoinCard charge if my balance is not enough?',
    a: 'No. A charge only works if the token is approved and your wallet has enough balance. If the balance is too low, the transaction fails.',
  },
  {
    q: 'Can I check my balance?',
    a: 'Yes. Token balances and approval status can be checked on-chain for supported networks and tokens.',
  },
  {
    q: 'Is there KYC?',
    a: 'CoinCard is built for fast wallet-based onboarding. Keep this answer aligned with your final provider/legal setup before launch.',
  },
  {
    q: 'Can I use Apple Pay or Google Pay?',
    a: 'CoinCard is designed for virtual card spending. Apple Pay and Google Pay availability depends on the final card issuing provider and supported regions.',
  },
  {
    q: 'Can I use CoinCard anywhere?',
    a: 'CoinCard is designed for online virtual card spending where virtual cards are accepted. Availability may depend on merchant, region, and card provider rules.',
  },
  {
    q: 'Is CoinCard self-custody?',
    a: 'Your wallet stays yours. CoinCard only works after wallet permission. You should always review wallet approvals before confirming.',
  },
  {
    q: 'Can I revoke approval?',
    a: 'Yes. Token approvals can be revoked through your wallet or blockchain approval tools for the relevant network.',
  },
  {
    q: 'What happens if I choose the wrong network?',
    a: 'Tokens must be on the same network you select. For example, USDC on Base is different from USDC on Polygon. Always choose the correct network before approval.',
  },
  {
    q: 'Is Ethereum supported?',
    a: 'Yes. Ethereum is shown as a supported network, alongside BNB Chain, Base, and Polygon.',
  },
  {
    q: 'Is there a minimum balance?',
    a: 'There is no minimum balance required to activate beyond the $1 activation fee, but you need enough token balance for any card funding transaction.',
  },
  {
    q: 'When will my card be active?',
    a: 'The card is designed to activate after wallet connection, token approval, and the $1 activation step are completed.',
  },
]

const VISIBLE = 5

function Item({ item, isOpen, onToggle }) {
  return (
    <div className="border-b border-ink/10">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 py-5 text-left"
        aria-expanded={isOpen}
      >
        <span className="font-display text-lg font-semibold text-ink">{item.q}</span>
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink/5 text-ink transition-transform duration-300 ${
            isOpen ? 'rotate-45' : ''
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </span>
      </button>
      <div
        className={`grid overflow-hidden transition-all duration-300 ease-out ${
          isOpen ? 'grid-rows-[1fr] pb-5 opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0">
          <p className="max-w-2xl pr-12 text-[15px] leading-relaxed text-ink/65">{item.a}</p>
        </div>
      </div>
    </div>
  )
}

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState(0)
  const [expanded, setExpanded] = useState(false)

  const shown = expanded ? FAQS : FAQS.slice(0, VISIBLE)

  return (
    <section id="faq" className="bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <div className="text-center">
          <span className="eyebrow text-blue">FAQ</span>
          <h2 className="display mt-3 text-ink text-[clamp(2rem,5.5vw,3.6rem)]">
            Questions, answered.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-ink/60">
            Everything you need to know about spending crypto with CoinCard.
          </p>
        </div>

        <div className="mt-10">
          {shown.map((item, i) => (
            <Item
              key={i}
              item={item}
              isOpen={openIndex === i}
              onToggle={() => setOpenIndex(openIndex === i ? -1 : i)}
            />
          ))}
        </div>

        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={() => {
              setExpanded(!expanded)
              setOpenIndex(-1)
            }}
            className="pill bg-ink px-7 py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
          >
            {expanded ? 'Show less' : `Show ${FAQS.length - VISIBLE} more`}
          </button>
        </div>
      </div>
    </section>
  )
}
