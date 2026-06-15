import React from 'react'
import { Arrow } from './Icons'

const COMPANY = {
  name: 'CoinCard Global, Inc.',
  address1: '1209 N Orange St',
  address2: 'Wilmington, DE 19801',
  country: 'United States',
  email: 'contact@getcoincard.xyz',
}

const EFFECTIVE_DATE = 'June 15, 2026'

const PAGES = {
  privacy: {
    eyebrow: 'Privacy',
    title: 'Privacy Policy',
    intro: 'This Privacy Policy explains how CoinCard Global, Inc. collects, uses, stores, protects, and shares information when you visit our website, connect a wallet, use our virtual card services, contact us, or interact with our platform.',
    content: `
## Effective Date

${EFFECTIVE_DATE}

## 1. Who we are

CoinCard is a crypto-connected virtual card service that allows users to connect a wallet, activate a virtual card, and manage card-related funding through supported crypto networks.

For privacy purposes, the company responsible for this Privacy Policy is:

- ${COMPANY.name}
- ${COMPANY.address1}
- ${COMPANY.address2}
- ${COMPANY.country}
- Email: ${COMPANY.email}

## 2. Information we collect

We may collect different types of information depending on how you use CoinCard.

### Account and contact information

When you contact us, request support, subscribe to updates, or create an account, we may collect:

- Name
- Email address
- Support messages
- Account preferences
- Communication history
- Any information you choose to send to us

### Wallet and blockchain information

When you connect a wallet or interact with CoinCard, we may collect or process:

- Public wallet address
- Connected blockchain network
- Selected token
- Wallet connection status
- Token approval status
- Transaction hashes
- Smart contract interaction records
- On-chain activity related to CoinCard usage
- Card activation status
- Network and token selection
- Wallet balance information required to display or process service activity

Blockchain data is public by nature. Your public wallet address, transaction hashes, token approvals, and related activity may be visible on public block explorers.

### Card and transaction-related information

Depending on the services you use and the partners involved, we may process:

- Virtual card activation status
- Card-related funding events
- Payment authorization status
- Transaction amount
- Transaction currency
- Transaction date and time
- Merchant category
- Declined or failed payment information
- Card funding records
- Risk and fraud signals
- Card usage records required to operate the service

We do not publicly display your full card number. Sensitive card data may be handled by card issuing, payment processing, or infrastructure partners.

### Technical information

When you visit our website or use our platform, we may collect:

- IP address
- Device type
- Browser type
- Operating system
- Approximate location based on IP address
- Pages visited
- Session activity
- Referral source
- Error logs
- Security logs
- Cookie identifiers
- Analytics events

### Compliance and risk information

To protect CoinCard and comply with applicable rules, we may collect or process:

- Wallet risk signals
- Fraud indicators
- Sanctions screening results
- Abuse reports
- Suspicious activity indicators
- Restricted jurisdiction signals
- Information required by law, card issuers, payment processors, compliance providers, or other service partners

Although CoinCard is designed to provide a simple and fast experience, we may request additional information or restrict access where required by law, partner requirements, issuer rules, payment network rules, risk controls, or compliance obligations.

## 3. How we use information

We use information to:

- Provide and operate CoinCard
- Allow wallet connection
- Activate and manage virtual card access
- Process card-related activity
- Display supported networks and wallet activity
- Verify wallet permissions and approvals
- Prevent fraud, misuse, abuse, and unauthorized activity
- Monitor platform security
- Improve the website and user experience
- Respond to support requests
- Send service updates
- Maintain logs and records
- Comply with applicable laws and partner requirements
- Enforce our Terms and policies
- Protect CoinCard, users, partners, and the wider ecosystem

## 4. Legal bases for processing

Depending on your location, we may process personal information under one or more legal bases:

- Performance of a contract, when processing is necessary to provide the service you request
- Legitimate interests, when processing is necessary to secure, improve, and protect CoinCard
- Consent, when you choose to receive marketing communications or accept optional cookies
- Legal obligations, when processing is required for compliance, fraud prevention, sanctions controls, recordkeeping, or regulatory duties

## 5. How we share information

We may share information with:

- Card issuing partners
- Payment processors
- Blockchain infrastructure providers
- Wallet connection providers
- Cloud hosting providers
- Analytics providers
- Security providers
- Fraud prevention providers
- Compliance and sanctions screening providers
- Customer support tools
- Professional advisors
- Law enforcement, regulators, or courts where required
- Business partners involved in providing the service

We do not sell your personal information to advertisers.

## 6. Blockchain transparency

Blockchain transactions are public and may be permanent. If you interact with CoinCard through a public blockchain, your wallet address, transaction hashes, token approvals, and related activity may be visible publicly.

CoinCard cannot delete, reverse, hide, or modify public blockchain records.

## 7. Wallet permissions and approvals

Some CoinCard features may require wallet approval or token permission through a smart contract. You are responsible for reviewing all wallet prompts before signing.

You may be able to revoke token approvals through your wallet, a blockchain explorer, or third-party approval management tools. Revoking permissions may limit or disable some CoinCard features.

CoinCard will never ask for your private key or seed phrase.

## 8. Data retention

We keep information only as long as reasonably necessary for:

- Providing the service
- Security and fraud prevention
- Dispute resolution
- Legal and compliance obligations
- Accounting and recordkeeping
- Enforcing our agreements
- Improving our product

Some blockchain data may remain publicly available permanently because blockchain networks are decentralized and outside CoinCard’s control.

## 9. Security

We use reasonable technical and organizational measures to protect information. These may include:

- Encryption where appropriate
- Access controls
- Security monitoring
- Infrastructure protections
- Audit logs
- Limited internal access
- Risk review processes

No online service is completely secure. You are responsible for protecting your wallet, private keys, seed phrase, device, and account credentials.

## 10. Your privacy rights

Depending on your location, you may have rights to:

- Access your personal information
- Correct inaccurate information
- Delete certain information
- Restrict processing
- Object to processing
- Request data portability
- Withdraw consent
- Complain to a privacy authority

To make a privacy request, contact us at ${COMPANY.email}.

We may need to verify your request before responding. Some requests may be limited where we must retain information for legal, security, fraud prevention, compliance, or recordkeeping reasons.

## 11. International transfers

CoinCard may process information in countries other than where you live. These countries may have different data protection laws. Where required, we use appropriate safeguards for international data transfers.

## 12. Children

CoinCard is not intended for children. You must be at least 18 years old, or the age of legal majority in your jurisdiction, to use CoinCard.

## 13. Marketing communications

If you subscribe to updates, we may send you product news, announcements, or marketing messages. You can unsubscribe at any time by using the unsubscribe link in the email or by contacting us.

## 14. Third-party links

Our website may link to third-party websites, wallets, block explorers, payment partners, or tools. We are not responsible for their privacy practices. You should review their policies before using them.

## 15. Changes to this Privacy Policy

We may update this Privacy Policy from time to time. The updated version will be posted on this page with a new effective date. Continued use of CoinCard after changes means you accept the updated Privacy Policy.

## 16. Contact us

For privacy questions, contact:

- ${COMPANY.name}
- ${COMPANY.address1}
- ${COMPANY.address2}
- ${COMPANY.country}
- Email: ${COMPANY.email}
`,
  },
  terms: {
    eyebrow: 'Terms',
    title: 'Terms & Conditions',
    intro: 'These Terms & Conditions govern your access to and use of CoinCard, including our website, wallet connection features, virtual card activation flow, card-related services, smart contract interactions, and related tools.',
    content: `
## Effective Date

${EFFECTIVE_DATE}

## 1. About CoinCard

CoinCard is a crypto-connected virtual card service. Users may connect a supported wallet, choose a supported network or token, activate a virtual card, and use supported card-related features.

CoinCard is operated by:

- ${COMPANY.name}
- ${COMPANY.address1}
- ${COMPANY.address2}
- ${COMPANY.country}
- Email: ${COMPANY.email}

CoinCard is not a bank. CoinCard does not provide investment, tax, legal, or financial advice. Card issuing, payment processing, settlement, compliance, custody, or related services may be provided by third-party partners.

## 2. Eligibility

You may use CoinCard only if:

- You are at least 18 years old
- You have legal capacity to enter into these Terms
- You are not located in a restricted jurisdiction
- You are not subject to sanctions
- Your use is lawful under applicable laws
- You are using CoinCard for lawful purposes only
- You comply with these Terms and all related policies

We may refuse, suspend, restrict, or terminate access at any time if we believe you are not eligible or your use creates legal, compliance, security, or business risk.

## 3. Wallet connection

To use CoinCard, you may need to connect a supported crypto wallet. You are responsible for:

- Using a secure wallet
- Reviewing all wallet prompts before signing
- Protecting your private keys and seed phrase
- Confirming the correct network and token
- Maintaining enough token balance for intended activity
- Revoking approvals if you no longer want to use the service

CoinCard will never ask for your private key or seed phrase.

## 4. Token approvals

Some CoinCard features may require token approval through a smart contract. By approving a token permission, you authorize the relevant smart contract to interact with the approved token according to the approval terms shown in your wallet.

You are responsible for reviewing approval amounts, supported networks, contract addresses, and transaction details before confirming.

You may revoke approvals using your wallet, a blockchain explorer, or supported approval management tools. Revoking approvals may stop some CoinCard features from working.

## 5. Card activation

CoinCard may offer virtual card activation for a stated activation fee, such as $1, where available.

The activation fee may be one-time unless stated otherwise. Fees may change in the future. We will display applicable fees before you confirm an action.

Card activation may depend on:

- Network availability
- Token availability
- Wallet approval
- Payment confirmation
- Issuer approval
- Compliance review
- Partner availability
- Technical availability

Payment of an activation fee does not guarantee permanent access if your account, wallet, jurisdiction, transaction, or activity becomes restricted.

## 6. Card usage

If your virtual card is activated, you may use it only where supported by the issuer, payment network, merchants, and applicable laws.

Transactions may be declined for reasons including:

- Insufficient funds
- Unsupported merchant
- Unsupported country or region
- Issuer restrictions
- Risk controls
- Compliance screening
- Network issues
- Expired or revoked wallet permissions
- Payment processor limitations
- Suspected fraud or abuse

CoinCard is not responsible for merchant refusal, payment network outages, issuer decisions, third-party processing failures, or blockchain network issues.

## 7. No guarantee of uninterrupted service

CoinCard may be unavailable, delayed, limited, or interrupted due to:

- Maintenance
- Blockchain congestion
- RPC or node issues
- Wallet provider outages
- Card issuer downtime
- Payment processor downtime
- Security incidents
- Regulatory requirements
- Force majeure events
- Third-party service failures

We do not guarantee uninterrupted, error-free, or permanent availability.

## 8. Supported networks and tokens

CoinCard may support selected networks and tokens. Supported networks and tokens may change at any time.

You are responsible for selecting the correct network and token. Sending funds or interacting with the wrong network, wrong contract, unsupported token, or wrong address may result in permanent loss.

## 9. Crypto risks

Crypto assets involve risk. By using CoinCard, you understand that:

- Blockchain transactions may be irreversible
- Token prices may change quickly
- Network fees may vary
- Wallet approvals may create risk if misused
- Smart contracts may contain vulnerabilities
- Public blockchain data may reveal activity
- Lost private keys cannot be recovered by CoinCard
- Incorrect transactions may be unrecoverable

You use crypto features at your own risk.

## 10. Prohibited use

You may not use CoinCard for:

- Illegal activity
- Fraud
- Money laundering
- Terrorist financing
- Sanctions evasion
- Scams
- Stolen funds
- Unauthorized access
- Market manipulation
- Circumventing compliance controls
- Purchasing prohibited goods or services
- Abusing card networks or merchants
- Violating issuer or processor rules
- Violating any applicable law

We may block, suspend, review, report, or terminate activity that we believe violates these Terms.

## 11. Restricted jurisdictions

CoinCard may not be available in all countries or regions. We may restrict access based on:

- Sanctions
- Local laws
- Issuer availability
- Payment partner rules
- Risk controls
- Regulatory requirements
- Internal policies

You may not use CoinCard if doing so is unlawful where you are located.

## 12. Compliance checks

CoinCard may conduct compliance, fraud, wallet risk, sanctions, or transaction monitoring checks. We may request information or documents where required by law, issuer rules, processor rules, risk review, or partner requirements.

If you do not provide requested information, we may restrict, suspend, or terminate access.

## 13. User responsibilities

You agree to:

- Provide accurate information
- Use only wallets you control or are authorized to use
- Keep your wallet secure
- Review transactions before signing
- Comply with laws
- Use CoinCard only for lawful purposes
- Pay applicable fees
- Not attempt to exploit, attack, or manipulate the platform
- Not misrepresent your identity, location, or eligibility

## 14. Fees

CoinCard may charge fees, including activation fees, service fees, network fees, or other disclosed charges.

Blockchain network fees are not controlled by CoinCard. Third-party fees may also apply from issuers, processors, wallets, exchanges, or networks.

Fees are shown where applicable before you confirm an action.

## 15. Refunds

Unless required by law or clearly stated otherwise, activation fees and blockchain transaction fees may be non-refundable.

Refunds may not be available for:

- Completed blockchain transactions
- Incorrect network selection
- User error
- Wallet approval mistakes
- Rejected transactions caused by user ineligibility
- Fees paid to third parties
- Violation of these Terms

## 16. Intellectual property

CoinCard, including its name, design, logos, website, text, graphics, software, and brand assets, belongs to CoinCard Global, Inc. or its licensors.

You may not copy, modify, distribute, sell, or use CoinCard assets without written permission.

## 17. Third-party services

CoinCard may rely on third-party providers, including wallets, blockchain networks, card issuers, payment processors, analytics providers, infrastructure providers, and compliance tools.

We are not responsible for third-party services, terms, outages, fees, or decisions.

## 18. Disclaimer

CoinCard is provided on an “as is” and “as available” basis. We do not guarantee that the service will be uninterrupted, secure, error-free, or suitable for your needs.

We do not provide investment, legal, tax, or financial advice.

## 19. Limitation of liability

To the maximum extent permitted by law, CoinCard Global, Inc. will not be liable for indirect, incidental, special, consequential, or punitive damages, including lost profits, lost funds, lost data, loss of access, failed transactions, blockchain errors, wallet compromise, issuer decisions, or third-party failures.

## 20. Indemnification

You agree to indemnify and hold CoinCard Global, Inc. harmless from claims, damages, losses, liabilities, costs, and expenses arising from:

- Your use of CoinCard
- Your violation of these Terms
- Your violation of law
- Your misuse of wallet approvals
- Your fraud, abuse, or unauthorized activity
- Your infringement of third-party rights

## 21. Suspension and termination

We may suspend or terminate your access if:

- You violate these Terms
- Your activity appears risky or suspicious
- Required by law or partner rules
- Your wallet is linked to prohibited activity
- You are in a restricted jurisdiction
- We discontinue the service
- You create security or operational risk

## 22. Changes to the service

We may add, remove, modify, suspend, or discontinue any feature at any time, including supported networks, tokens, card features, fees, wallet support, or partner availability.

## 23. Changes to these Terms

We may update these Terms from time to time. The updated Terms will be posted on this page with a new effective date. Continued use of CoinCard means you accept the updated Terms.

## 24. Governing law

These Terms are governed by the laws of the State of Delaware, United States, unless mandatory laws in your location require otherwise.

## 25. Contact

For questions about these Terms, contact:

- ${COMPANY.name}
- ${COMPANY.address1}
- ${COMPANY.address2}
- ${COMPANY.country}
- Email: ${COMPANY.email}
`,
  },
  cookies: {
    eyebrow: 'Cookies',
    title: 'Cookie Policy',
    intro: 'This Cookie Policy explains how CoinCard uses cookies and similar technologies on our website and platform.',
    content: `
## Effective Date

${EFFECTIVE_DATE}

## 1. What cookies are

Cookies are small files placed on your device when you visit a website. Similar technologies include local storage, pixels, tags, SDKs, and tracking scripts.

They help websites function, remember preferences, improve performance, secure services, and understand usage.

## 2. How CoinCard uses cookies

CoinCard may use cookies and similar technologies to:

- Operate the website
- Keep sessions secure
- Remember preferences
- Improve performance
- Measure website traffic
- Understand product usage
- Detect abuse or fraud
- Support customer service
- Improve marketing and communication

## 3. Types of cookies we use

### Strictly necessary cookies

These cookies are required for the website or service to work. They may support:

- Page loading
- Security
- Session management
- Wallet connection flow
- Fraud prevention
- Cookie preference storage

You cannot disable necessary cookies through our cookie tool because the website may not function properly without them.

### Functional cookies

These cookies help remember preferences, such as:

- Language
- Region
- Display preferences
- Cookie choices
- Interface settings

### Analytics cookies

These cookies help us understand how visitors use CoinCard, such as:

- Pages visited
- Time spent on pages
- Buttons clicked
- Device type
- Traffic source
- Error events
- General usage trends

We use analytics to improve the website and product.

### Marketing cookies

If used, these cookies may help us measure campaigns, understand referrals, or show relevant content.

We do not use cookies to access your private keys or seed phrase.

## 4. Third-party cookies

Some cookies may be placed by third-party providers, such as:

- Analytics providers
- Hosting providers
- Security providers
- Customer support tools
- Marketing tools
- Wallet connection or infrastructure providers

These providers may process information according to their own policies.

## 5. Cookie consent

Where required, we will ask for your consent before using non-essential cookies. You can accept, reject, or manage cookie preferences through the cookie banner or settings tool where available.

You can change your preferences at any time.

## 6. Managing cookies in your browser

You can control cookies through your browser settings. You may block or delete cookies, but some parts of the website may not work correctly if cookies are disabled.

## 7. Do Not Track

Some browsers send “Do Not Track” signals. Because there is no universal standard for these signals, our website may not respond to them automatically.

## 8. Updates to this Cookie Policy

We may update this Cookie Policy from time to time. The updated version will be posted on this page with a new effective date.

## 9. Contact

For cookie or privacy questions, contact:

- ${COMPANY.name}
- ${COMPANY.address1}
- ${COMPANY.address2}
- ${COMPANY.country}
- Email: ${COMPANY.email}
`,
  },
  compliance: {
    eyebrow: 'Compliance',
    title: 'Compliance Statement',
    intro: 'CoinCard is designed to make crypto-connected virtual cards simple, fast, and secure. At the same time, CoinCard takes compliance, platform integrity, fraud prevention, sanctions controls, and user protection seriously.',
    content: `
## Effective Date

${EFFECTIVE_DATE}

This Compliance Statement explains the principles we follow to protect CoinCard, users, partners, and the wider ecosystem.

## 1. Our compliance approach

CoinCard aims to provide a low-friction user experience while maintaining responsible controls. Depending on applicable laws, issuer requirements, processor rules, partner requirements, jurisdiction, transaction activity, and risk signals, CoinCard may apply compliance checks or restrictions.

CoinCard may review:

- Wallet risk
- Transaction activity
- Supported jurisdictions
- Sanctions exposure
- Fraud indicators
- Abuse patterns
- Issuer or processor requirements
- Suspicious activity signals

## 2. No illegal use

CoinCard may not be used for illegal, restricted, or abusive activity, including:

- Money laundering
- Terrorist financing
- Sanctions evasion
- Fraud
- Scams
- Use of stolen funds
- Unauthorized transactions
- Identity misuse
- Market manipulation
- Purchase of prohibited goods or services
- Circumventing compliance controls
- Violating issuer or payment network rules

We may suspend, block, reject, review, or report activity that appears unlawful, suspicious, or prohibited.

## 3. Sanctions compliance

CoinCard may restrict access for users, wallets, entities, jurisdictions, or transactions connected to sanctions risk. This may include screening against sanctions lists, restricted jurisdictions, wallet risk databases, blockchain analytics tools, or partner compliance systems.

You may not use CoinCard if you are subject to sanctions or located in a jurisdiction where CoinCard is restricted.

## 4. Wallet screening and transaction monitoring

CoinCard may use blockchain analytics, risk scoring, transaction monitoring, and fraud detection tools to identify suspicious or prohibited activity.

Wallets or transactions may be reviewed, delayed, restricted, or blocked if they appear connected to:

- Sanctioned addresses
- Illicit funds
- Mixer or obfuscation services
- Darknet markets
- Fraud reports
- Phishing activity
- High-risk counterparties
- Stolen funds
- Suspicious transaction patterns

## 5. KYC and information requests

CoinCard may aim to provide a simple onboarding experience. However, we may request information or documents where required by:

- Applicable law
- Issuer requirements
- Payment processor rules
- Compliance review
- Fraud prevention
- Sanctions controls
- Risk management
- Law enforcement requests
- Partner policies

Failure to provide requested information may result in restricted, suspended, or terminated access.

## 6. Supported jurisdictions

CoinCard may not be available in all regions. Access may be limited based on law, issuer availability, card network rules, partner requirements, sanctions, or internal risk policies.

Users are responsible for ensuring that use of CoinCard is legal in their location.

## 7. Card network and issuer rules

Virtual card services may be subject to issuer, processor, bank, payment network, merchant, and compliance rules. CoinCard may enforce these rules even if they are not listed individually on our website.

Transactions may be declined or restricted due to:

- Merchant category
- Country
- Transaction size
- Risk scoring
- Processor rules
- Issuer rules
- Legal restrictions
- Fraud indicators
- Compliance requirements

## 8. Self-custody and wallet control

CoinCard does not ask for your seed phrase or private key. You are responsible for your wallet security, private keys, approvals, devices, and transaction confirmations.

You should only approve wallet transactions you understand.

## 9. Smart contract and token approval controls

When a wallet approval is required, users must review the approval before signing. CoinCard may support tools or guidance to help users understand or revoke approvals, but users remain responsible for managing their own wallet permissions.

## 10. Reporting suspicious activity

If you believe CoinCard is being used for fraud, abuse, scams, stolen funds, or prohibited activity, contact us immediately at ${COMPANY.email}.

Please include as much information as possible, such as wallet address, transaction hash, date, screenshots, or description of the activity.

## 11. Law enforcement requests

Law enforcement or regulatory authorities may contact ${COMPANY.email}.

Requests should include official contact information, legal authority, relevant wallet addresses, transaction hashes, user identifiers, and clear instructions.

CoinCard may preserve, disclose, or provide information where required by applicable law or valid legal process.

## 12. User responsibility

Users are responsible for:

- Using CoinCard lawfully
- Keeping wallets secure
- Avoiding prohibited activity
- Understanding wallet approvals
- Complying with local laws
- Providing accurate information when requested
- Not attempting to bypass controls
- Not using CoinCard in restricted jurisdictions

## 13. Changes to compliance controls

CoinCard may update compliance controls at any time based on law, risk, partner requirements, issuer rules, payment network requirements, or internal policy.

## 14. Contact

For compliance questions, contact:

- ${COMPANY.name}
- ${COMPANY.address1}
- ${COMPANY.address2}
- ${COMPANY.country}
- Email: ${COMPANY.email}
`,
  },
}

function slugToPage(slug) {
  return PAGES[slug] || PAGES.privacy
}

function LegalBody({ content }) {
  const blocks = []
  const lines = content.trim().split('\n')
  let paragraph = []
  let list = []

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'p', text: paragraph.join(' ') })
      paragraph = []
    }
  }

  const flushList = () => {
    if (list.length) {
      blocks.push({ type: 'ul', items: list })
      list = []
    }
  }

  lines.forEach((raw) => {
    const line = raw.trim()

    if (!line) {
      flushParagraph()
      flushList()
      return
    }

    if (line.startsWith('### ')) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'h3', text: line.replace('### ', '') })
      return
    }

    if (line.startsWith('## ')) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'h2', text: line.replace('## ', '') })
      return
    }

    if (line.startsWith('- ')) {
      flushParagraph()
      list.push(line.replace('- ', ''))
      return
    }

    flushList()
    paragraph.push(line)
  })

  flushParagraph()
  flushList()

  return (
    <div className="legal-copy mt-10 space-y-6">
      {blocks.map((block, index) => {
        if (block.type === 'h2') {
          return (
            <h2 key={index} className="pt-8 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {block.text}
            </h2>
          )
        }

        if (block.type === 'h3') {
          return (
            <h3 key={index} className="pt-3 font-display text-xl font-bold tracking-tight text-ink">
              {block.text}
            </h3>
          )
        }

        if (block.type === 'ul') {
          return (
            <ul key={index} className="grid gap-2.5 rounded-3xl bg-white p-5 shadow-soft ring-1 ring-black/5 sm:p-6">
              {block.items.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink/70 sm:text-base">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )
        }

        return (
          <p key={index} className="text-sm leading-7 text-ink/68 sm:text-base sm:leading-8">
            {block.text}
          </p>
        )
      })}
    </div>
  )
}

export default function LegalPage({ slug }) {
  const page = slugToPage(slug)

  return (
    <main className="bg-[#FBF9F4] pt-28 sm:pt-32">
      <section className="relative overflow-hidden pb-16 sm:pb-24">
        <div className="pointer-events-none absolute -right-32 top-10 h-80 w-80 rounded-full bg-blue/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-32 top-60 h-80 w-80 rounded-full bg-neon/20 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-5 sm:px-8">
          <a href="/" className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink shadow-soft ring-1 ring-black/5 transition-transform hover:-translate-y-0.5">
            <Arrow size={15} className="rotate-180" />
            Back to home
          </a>

          <div className="mt-10 rounded-[2rem] bg-white/70 p-6 shadow-soft ring-1 ring-black/5 backdrop-blur sm:rounded-5xl sm:p-10">
            <span className="eyebrow text-blue">{page.eyebrow}</span>
            <h1 className="display mt-3 text-ink text-[clamp(2.4rem,8vw,5rem)] leading-[0.95]">
              {page.title}
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-8 text-ink/65 sm:text-lg">
              {page.intro}
            </p>
          </div>

          <LegalBody content={page.content} />
        </div>
      </section>
    </main>
  )
}
