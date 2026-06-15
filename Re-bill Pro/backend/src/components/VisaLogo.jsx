import React from 'react'

// Visa wordmark recreated as an inline SVG for crisp rendering on cards.
// Official proportions and letterforms; color via `fill` (white by default).
export default function VisaLogo({ height = 16, fill = '#FFFFFF', className = '' }) {
  const width = (height * 1000) / 324
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 1000 324"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Visa"
      role="img"
    >
      <g fill={fill}>
        <path d="M651.6 4.6c-70.9 0-134.3 36.8-134.3 104.7 0 77.9 112.4 83.3 112.4 122.4 0 16.5-18.9 31.2-51.1 31.2-45.8 0-80-20.6-80-20.6l-14.6 68.5s39.4 17.4 91.7 17.4c77.5 0 138.5-38.6 138.5-107.7 0-82.3-112.9-87.5-112.9-123.8 0-12.9 15.5-27.1 47.6-27.1 36.3 0 65.9 15 65.9 15l14.3-66.2s-32.2-13.8-77-13.8z" />
        <path d="M2.1 9.6L.4 19.5s29.8 5.5 56.7 16.3c34.6 12.5 37 19.8 42.9 42.4l63.4 244.6h85L379.3 9.6h-84.8L226.3 224.2 198.6 78.6c-2.5-16.7-15.4-69-79.2-69H2.1z" />
        <path d="M425.4 9.6L358.9 322.8h80.9L506 9.6h-80.6z" />
        <path d="M838.7 9.6c-15.6 0-23.7 8.3-29.7 22.9L690.5 322.8h84.8l16.4-47.4h103.4l10 47.4h74.8L913.6 9.6h-74.9zM815.2 209.1l42.5-122.8 23.9 122.8h-66.4z" />
      </g>
    </svg>
  )
}
