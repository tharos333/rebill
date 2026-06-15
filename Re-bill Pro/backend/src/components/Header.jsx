import React, { useState } from 'react'
import { Globe } from './Icons'
import logoMark from '../assets/coincard-logo.png'

const NAV = ['Features', 'Networks', 'Security', 'Enterprise']

export default function Header() {
  const [open, setOpen] = useState(false)

  return (
    <header className="fixed left-0 right-0 top-0 z-50 h-[72px] bg-white shadow-soft">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-5 sm:px-8">
        <a href="/" className="flex items-center" aria-label="CoinCard home">
          <img
            src={logoMark}
            alt="CoinCard"
            className="h-[26px] w-auto"
          />
        </a>

        <nav className="hidden items-center gap-9 md:flex">
          {NAV.map((item) => (
            <a
              key={item}
              href={`/#${item.toLowerCase()}`}
              className="text-sm font-medium text-ink/70 transition-colors hover:text-ink"
            >
              {item}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button
            aria-label="Change language"
            className="hidden h-10 w-10 place-items-center rounded-full text-ink/60 transition-colors hover:bg-black/5 hover:text-ink sm:grid"
          >
            <Globe size={20} />
          </button>
          <a href="/#get-card" className="pill-dark hidden px-5 py-2.5 text-sm font-semibold tracking-wide md:inline-flex">
            CLAIM YOUR CARD
          </a>
          <button
            aria-label="Menu"
            onClick={() => setOpen((v) => !v)}
            className="grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-black/5 md:hidden"
          >
            <div className="space-y-1.5">
              <span className="block h-0.5 w-5 bg-ink" />
              <span className="block h-0.5 w-5 bg-ink" />
            </div>
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-black/5 bg-white px-5 py-3 shadow-soft md:hidden">
          <nav className="flex flex-col gap-2">
            {NAV.map((item) => (
              <a
                key={item}
                href={`/#${item.toLowerCase()}`}
                onClick={() => setOpen(false)}
                className="py-1 text-[15px] font-medium text-ink/80"
              >
                {item}
              </a>
            ))}
            <a
              href="/#get-card"
              onClick={() => setOpen(false)}
              className="mt-1 inline-flex w-fit items-center justify-center rounded-full bg-ink px-4 py-2 text-xs font-semibold tracking-wide text-white shadow-pill"
            >
              CLAIM YOUR CARD
            </a>
          </nav>
        </div>
      )}
    </header>
  )
}
