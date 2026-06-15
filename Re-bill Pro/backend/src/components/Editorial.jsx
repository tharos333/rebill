import React from 'react'

export default function Editorial() {
  return (
    <section className="relative overflow-hidden bg-[#F7F3EC] py-12 sm:py-16">
      {/* faint grid backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(#0D0A14 1px, transparent 1px), linear-gradient(90deg, #0D0A14 1px, transparent 1px)',
          backgroundSize: '54px 54px',
        }}
      />
      <div className="relative mx-auto max-w-6xl px-5 text-center sm:px-8">
        <h2 className="display text-navy text-[clamp(1.6rem,5vw,3.6rem)]">
          Your crypto. Your card. <span className="text-blue">Onchain.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg text-ink/60">
          A virtual card built for crypto holders who want to spend without
          banks, delays, or unnecessary steps.
        </p>
      </div>
    </section>
  )
}
