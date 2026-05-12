import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="site"]'],
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Paper palette (light, default) — warm linen
        paper: {
          50:  '#fdfbf6',  // surface
          100: '#faf6ec',  // surface-2
          200: '#f6f2ea',  // bg
          300: '#efe9dc',  // bg-2
          400: '#d6cdb8',
          500: '#918a7d',  // muted-2
          600: '#6b6358',  // muted
          700: '#3d3830',
          800: '#2d2a23',  // ink-2
          900: '#1c1a16',  // ink
        },
        // Site palette (dark)
        site: {
          50:  '#f4ecdc',  // ink (inverted)
          100: '#e0d8c8',  // ink-2
          200: '#a89e8a',  // muted
          300: '#7d735f',  // muted-2
          400: '#4a443a',
          500: '#363229',
          600: '#2c2a25',  // surface-2
          700: '#25241f',  // surface
          800: '#232220',  // bg-2
          900: '#1a1916',  // bg
        },
        // Accent — burnt sienna (paper) / safety amber (site)
        accent: {
          50:  '#fbe9e2',
          100: '#f4d8cf',
          200: '#e8a890',
          300: '#d57e60',
          400: '#c46449',
          500: '#b4513a',
          600: '#923f2d',
          700: '#702f22',
        },
        amber: {
          50:  '#fdf2dd',
          100: '#f9e1b1',
          200: '#f5cd80',
          300: '#f0b850',
          400: '#f0a93f',
          500: '#d18d22',
          600: '#a16c19',
          700: '#6e4a10',
        },
        // Semantic
        good:   { DEFAULT: '#4a6b3f', tint: '#d8e3cd', dark: '#92c45e', 'dark-tint': '#27331c' },
        warn:   { DEFAULT: '#a96d1a', tint: '#f1d9b1', dark: '#f0a93f', 'dark-tint': '#3a2e15' },
        danger: { DEFAULT: '#98321f', tint: '#f4d4cd', dark: '#e36b4a', 'dark-tint': '#3a1f17' },
        info:   { DEFAULT: '#3b5a78', tint: '#d6dfe9', dark: '#7fb4d4', 'dark-tint': '#1f2b38' },
      },
      fontFamily: {
        serif: ['Newsreader', 'ui-serif', 'Georgia', 'Times New Roman', 'serif'],
        sans:  ['"Geist Variable"', 'Inter', ...defaultTheme.fontFamily.sans],
        mono:  ['"Geist Mono Variable"', ...defaultTheme.fontFamily.mono],
      },
      fontSize: {
        'eyebrow': ['10.5px', { lineHeight: '1', letterSpacing: '0.08em' }],
        'kpi':     ['32px',   { lineHeight: '1', letterSpacing: '-0.01em' }],
      },
      borderRadius: {
        huge: '18px',
      },
      boxShadow: {
        sm: '0 1px 0 rgba(28,26,22,.04), 0 1px 2px rgba(28,26,22,.04)',
        md: '0 1px 0 rgba(28,26,22,.04), 0 6px 18px rgba(28,26,22,.06)',
        lg: '0 12px 40px rgba(28,26,22,.12)',
      },
    },
  },
  plugins: [],
};
