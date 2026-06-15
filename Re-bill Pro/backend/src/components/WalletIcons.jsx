// Brand-accurate, multi-color wallet marks (self-contained colors, no currentColor).
// Simplified but recognizable reproductions of each wallet's official logo.
import React from 'react'

const S = ({ size = 28, children }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    {children}
  </svg>
)

export const MetaMask = ({ size }) => (
  <S size={size}>
    <path fill="#E2761B" d="M27.4 5.5l-9.1 6.7 1.7-4z" />
    <path fill="#E4761B" d="M4.6 5.5l9 6.8-1.6-4.1zM23.8 21.3l-2.4 3.7 5.2 1.4 1.5-5z" />
    <path fill="#E4761B" d="M3.9 21.4l1.5 5 5.2-1.4-2.4-3.7z" />
    <path fill="#E4761B" d="M10.3 14.5l-1.4 2.2 5.1.2-.2-5.5zm11.4 0l-3.6-3.2-.1 5.6 5.1-.2zM10.6 25l3.1-1.5-2.7-2.1zm7.7-1.5l3.1 1.5-.4-3.6z" />
    <path fill="#D7C1B3" d="M21.4 25l-3.1-1.5.2 2 .1.9zm-10.8 0l2.8 1.4.1-.9.2-2z" />
    <path fill="#233447" d="M13.5 19.6l-2.6-.8 1.8-.8zm5 0l.8-1.6 1.9.8z" />
    <path fill="#CD6116" d="M10.6 25l.5-3.7-2.9.1zm10.3-3.7l.5 3.7 2.4-3.6zm2.3-4.6l-5.1.2.5 2.6.8-1.6 1.9.8zm-12.6 2l1.9-.8.8 1.6.5-2.6-5.1-.2z" />
    <path fill="#E4751F" d="M8.9 16.7l2.1 4.2-.1-2.1zm12.3 2.1l-.1 2.1 2.1-4.2zm-7.2-1.9l-.5 2.6.6 3.3.1-4.3zm3.9 0l-.3 1.6.1 4.3.7-3.3z" />
    <path fill="#F6851B" d="M18.5 19.6l-.7 3.3.5.4 2.7-2.1.1-2.1zm-7.6-.6l.1 2.1 2.7 2.1.5-.4-.6-3.3z" />
    <path fill="#C0AD9E" d="M18.6 26.4l-.1-.9-.3-.2h-4.4l-.3.2-.1.9-2.8-1.4 1 .8 2 1.4h4.5l2-1.4 1-.8z" />
    <path fill="#161616" d="M18.3 23.5l-.5-.4h-3.6l-.5.4-.2 2 .3-.2h4.4l.3.2z" />
    <path fill="#763D16" d="M27.8 12.7l.8-3.7-1.2-3.5-9.1 6.7 3.5 3 5 1.4 1.1-1.3-.5-.3.8-.7-.6-.5.8-.6zM3.4 9l.8 3.7-.5.4.8.6-.6.5.8.7-.5.3 1.1 1.3 5-1.4 3.5-3-9.1-6.7z" />
    <path fill="#F6851B" d="M26.6 16.3l-5-1.4 1.5 2.3-2.1 4.2 2.8-.1h4.1zm-16.3-1.4l-5 1.4-1.3 5h4.1l2.8.1-2.1-4.2zm8 3l.3-5.4 1.4-3.9h-6.3l1.4 3.9.3 5.4.1 1.7v4.3h3.6v-4.3z" />
  </S>
)

export const Trust = ({ size }) => (
  <S size={size}>
    <path fill="#3375BB" d="M16 4l9 3.2v6.4c0 6-3.9 10.4-9 12.4-5.1-2-9-6.4-9-12.4V7.2z" />
    <path fill="#fff" d="M16 7.1v17.3c3.9-1.6 6.8-5.1 6.8-9.8V9.4z" opacity=".55" />
  </S>
)

export const Coinbase = ({ size }) => (
  <S size={size}>
    <circle cx="16" cy="16" r="16" fill="#0052FF" />
    <rect x="11" y="11" width="10" height="10" rx="2.2" fill="#fff" />
  </S>
)

export const WalletConnectLogo = ({ size }) => (
  <S size={size}>
    <circle cx="16" cy="16" r="16" fill="#3B99FC" />
    <path fill="#fff" d="M10.3 12.6c3.2-3.1 8.3-3.1 11.4 0l.4.4c.16.15.16.4 0 .56l-1.3 1.27a.2.2 0 01-.28 0l-.53-.52c-2.2-2.16-5.78-2.16-7.98 0l-.57.56a.2.2 0 01-.28 0l-1.3-1.27a.4.4 0 010-.56zm14.1 2.62l1.16 1.13a.4.4 0 010 .56l-5.22 5.1a.42.42 0 01-.57 0l-3.7-3.62a.1.1 0 00-.14 0l-3.7 3.62a.42.42 0 01-.58 0l-5.2-5.1a.4.4 0 010-.56l1.15-1.13a.42.42 0 01.57 0l3.7 3.62a.1.1 0 00.15 0l3.7-3.62a.42.42 0 01.57 0l3.7 3.62a.1.1 0 00.15 0l3.7-3.62a.42.42 0 01.58 0z" />
  </S>
)

export const Safe = ({ size }) => (
  <S size={size}>
    <circle cx="16" cy="16" r="16" fill="#12FF80" />
    <path fill="#121312" d="M20.5 11.5h-5.2a1.6 1.6 0 00-1.6 1.6v1.3a1.6 1.6 0 001.6 1.6h2.4a1.6 1.6 0 010 3.2H11v2.3h7a1.6 1.6 0 001.6-1.6v-1.3a1.6 1.6 0 00-1.6-1.6h-2.4a1.6 1.6 0 110-3.2h6.9zM12.5 13.8H10v2.3h2.5zM22 16.1h-2.5v2.3H22z" />
  </S>
)

export const Binance = ({ size }) => (
  <S size={size}>
    <circle cx="16" cy="16" r="16" fill="#F3BA2F" />
    <path fill="#fff" d="M12.1 14.4L16 10.5l3.9 3.9 2.3-2.3L16 6l-6.1 6.1zM6 16l2.3-2.3L10.5 16l-2.3 2.3zm6.1 1.6L16 21.5l3.9-3.9 2.3 2.3L16 26l-6.1-6.1zM21.5 16l2.3-2.3L26 16l-2.3 2.3zm-3.2 0L16 18.3 13.7 16 16 13.7z" />
  </S>
)

export const OKX = ({ size }) => (
  <S size={size}>
    <rect width="32" height="32" rx="7" fill="#000" />
    <g fill="#fff">
      <rect x="6" y="6" width="6.4" height="6.4" /><rect x="19.6" y="6" width="6.4" height="6.4" />
      <rect x="12.8" y="12.8" width="6.4" height="6.4" />
      <rect x="6" y="19.6" width="6.4" height="6.4" /><rect x="19.6" y="19.6" width="6.4" height="6.4" />
    </g>
  </S>
)

export const Phantom = ({ size }) => (
  <S size={size}>
    <circle cx="16" cy="16" r="16" fill="#AB9FF2" />
    <path fill="#fff" d="M9 17.5a7 7 0 0114 0v4.2c0 .9-1 1.4-1.8.9-.5.7-1.5.7-2 0-.6.7-1.6.7-2.2 0-.5.7-1.5.7-2 0-.6.7-1.6.7-2.2 0-.8.5-1.8 0-1.8-.9z" />
    <circle cx="12.8" cy="16.2" r="1.4" fill="#534BB1" />
    <circle cx="17" cy="16.2" r="1.4" fill="#534BB1" />
  </S>
)

export const Rabby = ({ size }) => (
  <S size={size}>
    <circle cx="16" cy="16" r="16" fill="#7084FF" />
    <path fill="#fff" d="M8 15.5c2-3 7-4 11-2.2 2.6 1.2 5 .8 5 .8s-.7 2.4-3.2 2.9c1.6.9 1.7 3.2 1.7 3.2s-3.3.9-6.8-.1c-3.6-1-9.6-2.6-7.4-4.6z" />
    <circle cx="20.5" cy="14.2" r=".9" fill="#7084FF" />
  </S>
)

export const Rainbow = ({ size }) => (
  <S size={size}>
    <rect width="32" height="32" rx="8" fill="#174299" />
    <path d="M6 11a15 15 0 0115 15h4A19 19 0 006 7z" fill="#FF4000" opacity="0"/>
    <path d="M6 9c9.4 0 17 7.6 17 17h3.5C26.5 14.7 17.3 5.5 6 5.5z" fill="#FF901E"/>
    <path d="M6 13c7.2 0 13 5.8 13 13h3.5C22.5 16.9 15.1 9.5 6 9.5z" fill="#FF40FF" opacity="0"/>
    <path d="M6 9c9.4 0 17 7.6 17 17h-4C19 18.8 13.2 13 6 13z" fill="#FF4000"/>
    <path d="M6 13c7.2 0 13 5.8 13 13h-4c0-5-4-9-9-9z" fill="#FFF700"/>
    <path d="M6 17a9 9 0 019 9h-4a5 5 0 00-5-5z" fill="#00AAFF"/>
    <path d="M6 21a5 5 0 015 5H6z" fill="#0080FF" opacity="0"/>
    <circle cx="6" cy="26" r="2.5" fill="#174299"/>
  </S>
)

export const Bitget = ({ size }) => (
  <S size={size}>
    <circle cx="16" cy="16" r="16" fill="#00F0FF" />
    <path fill="#1A1A1A" d="M13.5 7l-5 5 3 3-3 3 6 6 2.2-2.2-3.9-3.8 3.9-3.9-3.9-3.9 2.8-2.8z" />
  </S>
)

export const OneInch = ({ size }) => (
  <S size={size}>
    <circle cx="16" cy="16" r="16" fill="#1B314F" />
    <path fill="#fff" d="M9 9.5c3.5-2.5 8-1 10 2.5 1.4 2.6.5 6.2-2.4 7.6M17 22.5c-3.5 2.5-8 1-10-2.5" stroke="#fff" strokeWidth="1.6" fillRule="evenodd"/>
    <path fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" d="M9 9.8c3.4-2.3 7.7-.8 9.6 2.6 1.3 2.4.4 5.7-2.3 7M17 22.2c-3.4 2.3-7.7.8-9.6-2.6"/>
    <circle cx="9.3" cy="9.8" r="1.7" fill="#fff" />
    <path fill="#E2363C" d="M22 11l1.6-1.6-.5 2.2z" />
  </S>
)

export const Crypto = ({ size }) => (
  <S size={size}>
    <circle cx="16" cy="16" r="16" fill="#03316C" />
    <path fill="#fff" d="M16 6l8 4.6v9.2L16 26l-8-6.2V10.6z" opacity=".25" />
    <path fill="#fff" d="M16 8.5l5.8 3.4v6.8L16 22.8l-5.8-3.1v-6.8z" />
    <path fill="#03316C" d="M16 11l3.2 1.9v3.8L16 19l-3.2-1.6v-3.8z" />
  </S>
)
