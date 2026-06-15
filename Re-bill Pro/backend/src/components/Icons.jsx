// Original, lightweight SVG glyphs. Stylized brand-agnostic marks — not official logos.
import React from 'react'

const wrap = (children, vb = '0 0 24 24') => ({ size = 24, className = '' }) => (
  <svg width={size} height={size} viewBox={vb} fill="none" className={className} aria-hidden="true">
    {children}
  </svg>
)

/* ---------- UI glyphs ---------- */
export const Globe = wrap(<>
  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
  <path d="M3 12h18M12 3c2.5 2.5 2.5 15.5 0 18M12 3c-2.5 2.5-2.5 15.5 0 18" stroke="currentColor" strokeWidth="1.6" />
</>)
export const Lock = wrap(<>
  <rect x="5" y="10" width="14" height="10" rx="3" stroke="currentColor" strokeWidth="1.8" />
  <path d="M8 10V8a4 4 0 0 1 8 0v2" stroke="currentColor" strokeWidth="1.8" />
  <circle cx="12" cy="15" r="1.4" fill="currentColor" />
</>)
export const Shield = wrap(<>
  <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
</>)
export const Snow = wrap(<>
  <path d="M12 2v20M4 7l16 10M20 7L4 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  <path d="M12 6l2-2-2-2-2 2 2 2ZM12 18l2 2-2 2-2-2 2-2Z" fill="currentColor" />
</>)
export const Pulse = wrap(<>
  <path d="M3 12h4l2-6 4 12 2-6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
</>)
export const Bell = wrap(<>
  <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
</>)
export const Sliders = wrap(<>
  <path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  <circle cx="16" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.8" />
  <circle cx="8" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.8" />
</>)
export const Check = wrap(<>
  <path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
</>)
export const Bolt = wrap(<>
  <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor" />
</>)
export const Wifi = wrap(<>
  <path d="M2 8.5C7 4 17 4 22 8.5M5 12c4-3.5 10-3.5 14 0M8.5 15.5c2-1.8 5-1.8 7 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
</>)
export const Arrow = wrap(<>
  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
</>)
export const Phone = wrap(<>
  <rect x="6" y="2" width="12" height="20" rx="3" stroke="currentColor" strokeWidth="1.8" />
  <path d="M10 5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
</>)
export const Users = wrap(<>
  <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
  <path d="M3 20a6 6 0 0 1 12 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  <path d="M16 5.5a3 3 0 0 1 0 5.5M17 14.5a6 6 0 0 1 4 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
</>)

/* ---------- Network marks (stylized originals) ---------- */
export const NetEthereum = wrap(<>
  <path d="M12 2l6 10-6 3.5L6 12 12 2Z" fill="currentColor" opacity="0.85" />
  <path d="M12 16.8L18 13l-6 9-6-9 6 3.8Z" fill="currentColor" opacity="0.55" />
</>)
export const NetBase = wrap(<>
  <circle cx="12" cy="12" r="10" fill="currentColor" />
  <path d="M11.5 6a6 6 0 1 0 0 12c2.7 0 4.95-1.8 5.7-4.2H8.4v-3.6h8.8C16.45 7.8 14.2 6 11.5 6Z" fill="#fff" />
</>)
export const NetBnb = wrap(<>
  <path d="M12 3l2.6 2.6L9.3 11l-2.6-2.6L12 3ZM6.4 8.6L9 11.2 6.4 13.8 3.8 11.2 6.4 8.6ZM17.6 8.6l2.6 2.6-2.6 2.6L15 11.2l2.6-2.6ZM12 12.2l2.6 2.6L12 17.4 9.4 14.8 12 12.2ZM12 18.6l-2.6-2.6L12 21l2.6-2.6L12 18.6Z" fill="currentColor" />
</>)
export const NetPolygon = wrap(<>
  <path d="M16 8.5l-4-2.3-4 2.3v4.6l4 2.3 4-2.3M9.5 14.8L5.5 12.5V8M18.5 8v4.5l-4 2.3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
</>)
export const NetArbitrum = wrap(<>
  <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.6" />
  <path d="M12 6l4 11h-2.2l-1.8-5-1.8 5H8L12 6Z" fill="currentColor" />
</>)
export const NetOptimism = wrap(<>
  <circle cx="12" cy="12" r="9.5" fill="currentColor" />
  <circle cx="9" cy="12" r="2.4" stroke="#fff" strokeWidth="1.8" />
  <path d="M14 9.6h2.4a2 2 0 0 1 0 4H14.6l-.6 .8M14 14.4l1-4.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
</>)
export const NetSolana = wrap(<>
  <path d="M6 7.5h11l-2.2 2.2H3.8L6 7.5ZM6 14.3h11L14.8 16.5H3.8L6 14.3ZM8.2 10.9h11L17 13.1H6L8.2 10.9Z" fill="currentColor" />
</>, '0 0 22 24')

/* ---------- Wallet marks (stylized originals) ---------- */
export const WMeta = wrap(<>
  <path d="M3 4l7 5-1.5 3L3 9V4ZM21 4l-7 5 1.5 3L21 9V4ZM7 18l2-3h6l2 3-3 2H10l-3-2Z" fill="currentColor" />
</>)
export const WTrust = wrap(<>
  <path d="M12 3l7 2.5V11c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V5.5L12 3Z" fill="currentColor" />
</>)
export const WCoinbase = wrap(<>
  <circle cx="12" cy="12" r="9.5" fill="currentColor" />
  <rect x="8.5" y="8.5" width="7" height="7" rx="1.6" fill="#fff" />
</>)
export const WConnect = wrap(<>
  <path d="M6.5 9.5c3-3 8-3 11 0l-1.6 1.6c-2.1-2-5.7-2-7.8 0L6.5 9.5ZM5 13l2 2 1.5-1.5L7 12 5 13ZM17 13l-1.5 1L17 15.5 19 13.5 17 13Z" fill="currentColor" />
  <circle cx="12" cy="14.5" r="1.8" fill="currentColor" />
</>)
export const WSafe = wrap(<>
  <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.8" />
  <path d="M14 9h-3a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3h-3M8 8.5v-1M8 16.5v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
</>)
export const WBinance = NetBnb
export const WOkx = wrap(<>
  <rect x="3" y="3" width="6" height="6" fill="currentColor" /><rect x="15" y="3" width="6" height="6" fill="currentColor" />
  <rect x="9" y="9" width="6" height="6" fill="currentColor" />
  <rect x="3" y="15" width="6" height="6" fill="currentColor" /><rect x="15" y="15" width="6" height="6" fill="currentColor" />
</>)
export const WPhantom = wrap(<>
  <path d="M4 13a8 8 0 0 1 16 0v5c0 1-1 1.5-2 1-1 .8-2 .8-3 0-1 .8-2 .8-3 0-1 .5-2 0-2-1v-5Z" fill="currentColor" />
  <circle cx="9" cy="12" r="1.3" fill="#fff" /><circle cx="14" cy="12" r="1.3" fill="#fff" />
</>)
export const WRabby = wrap(<>
  <path d="M3 11c2-4 8-5 12-3 3 1.5 6 1 6 1s-1 3-4 3.5c2 1 2 4 2 4s-4 1-8 0-9-3.5-8-8.5Z" fill="currentColor" />
  <circle cx="16" cy="10" r="1" fill="#fff" />
</>)
export const WRainbow = wrap(<>
  <path d="M4 18a14 14 0 0 1 16 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  <path d="M7 18a8 8 0 0 1 10 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" />
  <path d="M10 18a3.5 3.5 0 0 1 4 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.4" />
</>)
export const WBitget = wrap(<>
  <path d="M11 3L5 9l3 3-3 3 6 6 2-2-4-4 4-4-4-4 4-4-2-0Z" fill="currentColor" />
</>)
export const WOneInch = wrap(<>
  <path d="M5 6c4-3 9-1 11 3 1.5 3 0 7-3 8M16 17c-4 3-9 1-11-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  <circle cx="6" cy="6" r="1.6" fill="currentColor" />
</>)
export const WCrypto = wrap(<>
  <path d="M12 2l8 4.6v9.2L12 22l-8-6.2V6.6L12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  <path d="M12 7l4 2.5v5L12 17l-4-2.5v-5L12 7Z" fill="currentColor" opacity="0.7" />
</>)
