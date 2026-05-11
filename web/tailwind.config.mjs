/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50:  '#f7f8fa',
          100: '#eef0f4',
          200: '#dbe0e8',
          300: '#b8c0cc',
          400: '#8d97a8',
          500: '#5f6b80',
          600: '#414b5e',
          700: '#2c3447',
          800: '#1a2032',
          900: '#0e1322',
        },
        accent: {
          50:  '#eef9ff',
          500: '#1f77b4',
          600: '#155e93',
          700: '#0e4774',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Inter', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
