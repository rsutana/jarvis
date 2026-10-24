/**
 * Jarvis — Tailwind CSS tokens.
 * Source of truth: Design canvas › "14 · Foundations" board.
 * Every colour, radius and shadow used on the canvas maps to a token here.
 * Usage: bg-card, border-line, text-ink-muted, text-status-working, rounded-drawer, shadow-drawer …
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,ts,js}'],
  darkMode: 'class', // the app ships dark-only; keep `class="dark"` on <html>
  theme: {
    extend: {
      colors: {
        app: '#0B0D10',          // window + scene background
        sidebar: '#101317',      // secondary panels inside drawers
        card: '#14171C',         // cards, HUD pills
        raised: '#1A1E24',       // buttons, inputs hover
        well: '#0F1216',         // input background
        drawer: 'rgba(17,20,25,0.97)',
        hud: 'rgba(20,23,28,0.94)',
        tag: 'rgba(16,19,23,0.94)', // world-space labels over the 3D scene
        line: { DEFAULT: '#272C34', soft: '#22262D', strong: '#2F353E' },
        ink: { DEFAULT: '#E9EBEE', muted: '#A2A9B4', faint: '#8A919C', label: '#7D8590' },
        accent: { DEFAULT: '#8C9BFF', link: '#AEB8FF', hover: '#D3D8FF', tint: '#1B1F2B', ring: '#343C66', active: '#262B3A' },
        status: {
          working: '#4FD1B5',
          review: '#F2B544',
          blocked: '#FF8A7A',
          idle: '#6B727D',
          done: '#8C9BFF',
          danger: '#FF9C8E'
        },
        workspace: { teal: '#34B394', blue: '#4A7FE0', clay: '#D7655A', purple: '#8A6FE0', amber: '#E0A33A' },
        agent: { teal: '#5ED0C0', coral: '#FF8A7A', violet: '#B9A2FF', cyan: '#6FD3E8', amber: '#F2B544', lime: '#9FE07A', sky: '#7FB2FF', pink: '#FFB3D1', sand: '#E8C99A' }
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      fontSize: {
        label: ['11px', { lineHeight: '1.3', letterSpacing: '0.08em', fontWeight: '600' }], // + uppercase
        tiny: ['11.5px', '1.4'],
        small: ['12.5px', '1.45'],
        body: ['14px', '1.45'],
        title: ['17px', { lineHeight: '1.3', fontWeight: '600' }],
        h2: ['22px', { lineHeight: '1.25', fontWeight: '600' }],
        display: ['32px', { lineHeight: '1.15', fontWeight: '600' }]
      },
      borderRadius: { control: '8px', row: '10px', card: '12px', hud: '10px', dock: '14px', drawer: '16px' },
      boxShadow: {
        drawer: '0 24px 60px rgba(0,0,0,.55)',
        tag: '0 8px 20px rgba(0,0,0,.45)',
        dock: '0 10px 30px rgba(0,0,0,.5)',
        glowWorking: '0 0 18px rgba(79,209,181,.55)',
        glowAccent: '0 0 18px rgba(140,155,255,.6)'
      },
      spacing: { hud: '16px', 'drawer-top': '72px', 'drawer-bottom': '96px' },
      minHeight: { control: '40px', touch: '44px' },
      width: { 'drawer-sm': '360px', 'drawer-md': '620px', 'drawer-lg': '880px', 'drawer-xl': '1020px' }
    }
  },
  plugins: []
};
