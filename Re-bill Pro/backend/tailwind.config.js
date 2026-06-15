/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0D0A14',
        cream: '#F7F3EC',
        creamDeep: '#F0EADD',
        blue: {
          DEFAULT: '#0052FF',
          light: '#3D7BFF',
          deep: '#003ECC',
        },
        navy: {
          DEFAULT: '#001A4D',
          light: '#012169',
          mid: '#0A2E80',
        },
        neon: '#B6FF3C',
        grape: '#5B6CFF',
        sky: '#7FD8FF',
        blush: '#7FB0FF',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        '4xl': '28px',
        '5xl': '36px',
        '6xl': '44px',
      },
      boxShadow: {
        soft: '0 12px 40px -12px rgba(30,16,51,0.18)',
        card: '0 30px 80px -24px rgba(30,16,51,0.45)',
        pill: '0 6px 20px -6px rgba(13,10,20,0.35)',
      },
      keyframes: {
        float: {
          '0%,100%': { transform: 'translateY(0) rotate(var(--r,0deg))' },
          '50%': { transform: 'translateY(-18px) rotate(var(--r,0deg))' },
        },
        floatSlow: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        sheen: {
          '0%': { transform: 'translateX(-120%) rotate(8deg)' },
          '60%,100%': { transform: 'translateX(220%) rotate(8deg)' },
        },
        orbit: {
          'from': { transform: 'rotate(0deg)' },
          'to': { transform: 'rotate(360deg)' },
        },
        rise: {
          'from': { opacity: '0', transform: 'translateY(24px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        marquee: {
          'from': { transform: 'translateX(0)' },
          'to': { transform: 'translateX(-50%)' },
        },
        marqueeRev: {
          'from': { transform: 'translateX(-50%)' },
          'to': { transform: 'translateX(0)' },
        },
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        floatSlow: 'floatSlow 8s ease-in-out infinite',
        sheen: 'sheen 5s ease-in-out infinite',
        orbit: 'orbit 26s linear infinite',
        rise: 'rise 0.7s cubic-bezier(0.16,1,0.3,1) both',
        marquee: 'marquee 45s linear infinite',
        marqueeRev: 'marqueeRev 45s linear infinite',
      },
    },
  },
  plugins: [],
}
