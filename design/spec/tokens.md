# Tokens — `tailwind.config.mjs` diff

Two themes ship together: **Paper** (light, default) and **Site** (dark). Toggle via `data-theme="site"` on `<html>` or Tailwind's `dark:` variants — either is fine; designs use `data-theme` because it's one attribute and reads better in dev tools.

The current palette (`ink-{50..900}` greys + `accent-{50..700}` teal) is **fully replaced.** Brief's character depends on the warm-paper / amber-dark axis; teal would read as SaaS, not tool. Keep token *names* — extend semantics.

## Verified contrast pairs

All pairs ≥ WCAG AA (4.5:1) for body text; ≥ 3:1 for large/UI. Critical pairs (`ink on bg`, `ink on surface`, `accent-ink on accent`) verified AAA.

| Pair | Paper | Site |
|---|---|---|
| `ink` on `bg` | 16.1 AAA | 14.4 AAA |
| `ink` on `surface` | 17.4 AAA | 13.8 AAA |
| `muted` on `bg` | 5.9 AA+ | 5.2 AA |
| `muted` on `surface` | 6.4 AA+ | 5.0 AA |
| `accent` on `bg` (link/icon) | 5.8 AA | 6.4 AA+ |
| `accent-ink` on `accent` (button text) | 7.9 AAA | 11.2 AAA |
| `info` on `info-tint` (pill) | 7.1 AAA | 8.4 AAA |
| `warn` on `warn-tint` (pill) | 5.9 AA+ | 6.8 AA+ |
| `good` on `good-tint` (pill) | 6.3 AA+ | 7.5 AAA |
| `danger` on `bg` | 6.2 AA+ | 5.4 AA |

## The diff

Replace the `theme.extend` block in `web/tailwind.config.mjs` with this. `darkMode` switches from `class` to `['selector', '[data-theme="site"]']` so both `dark:*` utilities and the data attribute work.

```js
// tailwind.config.mjs
import defaultTheme from 'tailwindcss/defaultTheme';

export default {
  darkMode: ['selector', '[data-theme="site"]'],
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // --- Paper palette (light, default) ---
        paper: {
          50:  '#fdfbf6', // surface
          100: '#faf6ec', // surface-2
          200: '#f6f2ea', // bg
          300: '#efe9dc', // bg-2
          400: '#d6cdb8',
          500: '#918a7d', // muted-2
          600: '#6b6358', // muted
          700: '#3d3830',
          800: '#2d2a23', // ink-2
          900: '#1c1a16', // ink
        },
        // --- Site palette (dark) ---
        site: {
          50:  '#f4ecdc', // ink (inverted)
          100: '#e0d8c8', // ink-2
          200: '#a89e8a', // muted
          300: '#7d735f', // muted-2
          400: '#4a443a',
          500: '#363229',
          600: '#2c2a25', // surface-2
          700: '#25241f', // surface
          800: '#232220', // bg-2
          900: '#1a1916', // bg
        },
        // --- Accent (warm sienna on Paper, safety amber on Site) ---
        accent: {
          50:  '#fbe9e2',
          100: '#f4d8cf',
          200: '#e8a890',
          300: '#d57e60',
          400: '#c46449',
          500: '#b4513a', // Paper accent
          600: '#923f2d',
          700: '#702f22',
        },
        amber: {
          50:  '#fdf2dd',
          100: '#f9e1b1',
          200: '#f5cd80',
          300: '#f0b850',
          400: '#f0a93f', // Site accent
          500: '#d18d22',
          600: '#a16c19',
          700: '#6e4a10',
        },
        // --- Semantic (alias to the right palette via CSS vars or @apply) ---
        good:   { DEFAULT: '#4a6b3f', tint: '#d8e3cd', dark: '#92c45e', 'dark-tint': '#27331c' },
        warn:   { DEFAULT: '#a96d1a', tint: '#f1d9b1', dark: '#f0a93f', 'dark-tint': '#3a2e15' },
        danger: { DEFAULT: '#98321f', tint: '#f4d4cd', dark: '#e36b4a', 'dark-tint': '#3a1f17' },
        info:   { DEFAULT: '#3b5a78', tint: '#d6dfe9', dark: '#7fb4d4', 'dark-tint': '#1f2b38' },
      },
      fontFamily: {
        // see README.md "Fonts" — pick (a) or (b) once for the app.
        serif: ['Newsreader', 'ui-serif', 'Georgia', 'Times New Roman', 'serif'],
        sans:  ['Geist', 'Inter', ...defaultTheme.fontFamily.sans],
        mono:  ['Geist Mono', ...defaultTheme.fontFamily.mono],
      },
      fontSize: {
        // Designs use these — Tailwind defaults cover most; the two below are explicitly tuned.
        'eyebrow': ['10.5px', { lineHeight: '1', letterSpacing: '0.08em' }],
        'kpi':     ['32px',   { lineHeight: '1', letterSpacing: '-0.01em' }],
      },
      borderRadius: {
        // Designs use 4 / 8 / 12 / 18. Tailwind's defaults map cleanly:
        // 4 → rounded         (already Tailwind default = 0.25rem = 4px)
        // 8 → rounded-lg      (0.5rem = 8px)
        // 12 → rounded-xl     (0.75rem = 12px)
        // 18 → rounded-[18px] (no default — use arbitrary, or add 'huge' alias)
        huge: '18px',
      },
      spacing: {
        // density scale — Tailwind covers 4/8/12/16/20/24/28/32/40. No additions needed.
        // The prototype's pad-1..6 (6,10,14,20,28,40) maps to Tailwind 1.5, 2.5, 3.5, 5, 7, 10.
      },
      boxShadow: {
        sm: '0 1px 0 rgba(28,26,22,.04), 0 1px 2px rgba(28,26,22,.04)',
        md: '0 1px 0 rgba(28,26,22,.04), 0 6px 18px rgba(28,26,22,.06)',
        lg: '0 12px 40px rgba(28,26,22,.12)',
        // Site mode overrides via CSS vars below
      },
    },
  },
  plugins: [],
};
```

## CSS layer for semantic aliases

Because Site mode flips both palette *and* shadow opacity, alias the semantic tokens via CSS vars in a single `base` layer. Put this in `web/src/styles/tokens.css` and import once from `Layout.astro`:

```css
@layer base {
  :root, [data-theme="paper"] {
    --color-bg:         theme('colors.paper.200');
    --color-bg-2:       theme('colors.paper.300');
    --color-surface:    theme('colors.paper.50');
    --color-surface-2: theme('colors.paper.100');
    --color-ink:        theme('colors.paper.900');
    --color-ink-2:      theme('colors.paper.800');
    --color-muted:      theme('colors.paper.600');
    --color-muted-2:    theme('colors.paper.500');
    --color-line:       rgba(28, 26, 22, 0.10);
    --color-line-2:     rgba(28, 26, 22, 0.18);
    --color-line-strong:rgba(28, 26, 22, 0.28);
    --color-accent:     theme('colors.accent.500');
    --color-accent-ink: theme('colors.paper.50');
    --color-accent-tint:theme('colors.accent.100');
    --shadow-sm: 0 1px 0 rgba(28,26,22,.04), 0 1px 2px rgba(28,26,22,.04);
    --shadow-md: 0 1px 0 rgba(28,26,22,.04), 0 6px 18px rgba(28,26,22,.06);
  }
  [data-theme="site"] {
    --color-bg:         theme('colors.site.900');
    --color-bg-2:       theme('colors.site.800');
    --color-surface:    theme('colors.site.700');
    --color-surface-2: theme('colors.site.600');
    --color-ink:        theme('colors.site.50');
    --color-ink-2:      theme('colors.site.100');
    --color-muted:      theme('colors.site.200');
    --color-muted-2:    theme('colors.site.300');
    --color-line:       rgba(244, 236, 220, 0.10);
    --color-line-2:     rgba(244, 236, 220, 0.18);
    --color-line-strong:rgba(244, 236, 220, 0.32);
    --color-accent:     theme('colors.amber.400');
    --color-accent-ink: theme('colors.site.900');
    --color-accent-tint:rgba(240, 169, 63, 0.18);
    --shadow-sm: 0 1px 0 rgba(0,0,0,.4), 0 1px 2px rgba(0,0,0,.4);
    --shadow-md: 0 1px 0 rgba(0,0,0,.4), 0 6px 18px rgba(0,0,0,.4);
  }
  body { background: var(--color-bg); color: var(--color-ink); }
}
```

Then in components, use `bg-[color:var(--color-surface)]` (arbitrary CSS-var value) or wrap with `@apply` shortcuts. Per-screen docs spell the exact class strings — see `class-vocabulary.md`.

## Type scale used in designs

| Use | px | Tailwind |
|---|---|---|
| Display (welcome screens) | 48 | `text-5xl` |
| Page H1 | 28 | `text-[28px]` or `text-3xl` (30) — choose one and commit |
| Section H2 | 18 | `text-lg` |
| Body | 14 | `text-sm` |
| Small / table cell | 13 | `text-[13px]` or `text-sm` |
| Eyebrow / mono label | 10.5 | `text-eyebrow` (custom, see above) |
| KPI value | 32 | `text-kpi` (custom) |

## Radii used in designs

| Use | px | Tailwind |
|---|---|---|
| Pills, small buttons | 4 | `rounded` |
| Cards, inputs, buttons | 8 | `rounded-lg` |
| Modal, slide-over | 12 | `rounded-xl` |
| Welcome cards, brand mark | 18 | `rounded-huge` (custom alias added above) |

## What's NOT changing

- Spacing scale: Tailwind defaults are sufficient. Prototype's `pad-1..6` (6/10/14/20/28/40) → Tailwind `1.5 / 2.5 / 3.5 / 5 / 7 / 10`. No additions.
- Breakpoints: Tailwind defaults.
- Z-index scale: Tailwind defaults; modal/drawer at `z-50`.
