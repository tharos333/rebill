import React from 'react'
import Header from './components/Header'
import Hero from './components/Hero'
import Editorial from './components/Editorial'
import Features from './components/Features'
import Wallets from './components/Wallets'
import HowItWorks from './components/HowItWorks'
import Security from './components/Security'
import Perks from './components/Perks'
import Mission from './components/Mission'
import Enterprise from './components/Enterprise'
import FAQ from './components/FAQ'
import Footer from './components/Footer'
import LegalPage from './components/LegalPages'

const LEGAL_ROUTES = ['privacy', 'terms', 'cookies', 'compliance']

export default function App() {
  const path = window.location.pathname.replace(/^\//, '').replace(/\/$/, '')
  const legalSlug = LEGAL_ROUTES.includes(path) ? path : null

  return (
    <div className="relative min-h-screen bg-cream font-body">
      <div className="grain" />
      <Header />

      {legalSlug ? (
        <LegalPage slug={legalSlug} />
      ) : (
        <>
          <main>
            <Hero />
            <Editorial />
            <Features />
            <Wallets />
            <HowItWorks />
            <Security />
            <Mission />
            <Enterprise />
            <Perks />
          </main>
          <FAQ />
        </>
      )}

      <Footer />
    </div>
  )
}
